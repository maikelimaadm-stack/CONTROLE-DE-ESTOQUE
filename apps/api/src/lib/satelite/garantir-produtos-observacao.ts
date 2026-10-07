/**
 * ORQUESTRAÇÃO DOS PRODUTOS ESPACIAIS DA OBSERVAÇÃO COMPLETA — SAT-BUNDLE-01A R1.
 *
 * Política automática `principal` (default do worker):
 *   A) mapa condição v3 SOMENTE
 *
 * Rasters técnicos (NDVI, EVI2, NDRE, NDMI, MSAVI2, BSI): LAZY / on-demand via
 * `gerarOuReutilizarRasterIndice` (rota POST). NÃO são gerados automaticamente.
 *
 * Best-effort: falha do Process NÃO apaga Statistical.
 * Cache: produto existente → reutilizado (sem nova chamada Process).
 * Sem transação DB longa envolvendo HTTP externo.
 */
import { withTx, type Db } from "@agro/db";
import {
  INDICES_BUNDLE_ESSENCIAL, VERSAO_METODO_PASTAGEM_ESSENCIAL,
  type IdIndiceSatelite, type StatusProdutoEspacial
} from "@agro/domain";
import { empresaScopeSql, hasPermission } from "../context.js";
import { DomainError } from "../errors.js";
import { PERMISSAO_PEDIR_ANALISE } from "../../routes/analises-satelitais.js";
import type { ClienteCopernicus } from "./copernicus.js";
import { MODULO_EXECUTOR, contextoDoCriador } from "./contexto-worker.js";
import type { LimiteAvulsoSatelite } from "./limite-avulso.js";
import type { ArmazenamentoRaster } from "./armazenamento-raster.js";
import {
  gerarOuReutilizarMapaCondicao,
  type DependenciasGerarMapaCondicao, type LogMapaCondicao
} from "./gerar-mapa-condicao.js";
import {
  gerarOuReutilizarRasterIndice, type DependenciasGerarRaster
} from "./gerar-raster-indice.js";

/** Política de geração automática: só o mapa principal (default) ou um raster explícito. */
export type PoliticaProdutosObservacao = "principal" | "raster_explicito";

export interface ResultadoProduto {
  chave: string;
  status: StatusProdutoEspacial;
  id: string | null;
  erro?: string;
}

export interface ResultadoProdutosObservacao {
  area_id: string;
  data_imagem: string | null;
  condicao: ResultadoProduto;
  rasters: Record<IdIndiceSatelite, ResultadoProduto>;
  chamadas_process: number;
  reutilizacoes: number;
  politica: PoliticaProdutosObservacao;
}

export interface DependenciasGarantirProdutos {
  db: Db;
  cliente: ClienteCopernicus;
  limiteAvulso: LimiteAvulsoSatelite;
  log: LogMapaCondicao;
  copernicusEnabled: boolean;
  armazenamento: ArmazenamentoRaster;
  /** Dedup de rasters em voo deste processo (worker / reparo). */
  emAndamentoRaster?: Map<string, Promise<{ puCabecalho: string | null }>>;
}

export interface PedidoGarantirProdutos {
  orgId: string;
  userId: string;
  areaId: string;
  dataImagem?: string;
  /** Contexto da consulta em lote — atribui o Process automático ao ledger. */
  consultaId?: string | null;
  consultaItemId?: string | null;
  /**
   * `principal` (default): só condição v3.
   * `raster_explicito`: gera UM raster técnico pedido em `indiceRaster` (lazy).
   */
  politica?: PoliticaProdutosObservacao;
  /** Obrigatório quando politica = raster_explicito. */
  indiceRaster?: IdIndiceSatelite;
}

interface AnaliseIrma {
  id: string;
  indice: IdIndiceSatelite;
  observacao_inicio: Date;
}

async function lerAnalisesDaObservacao(
  dep: DependenciasGarantirProdutos, p: PedidoGarantirProdutos
): Promise<{ analises: AnaliseIrma[]; dataImagem: string | null }> {
  return withTx(dep.db, { orgId: p.orgId, userId: p.userId, modulo: MODULO_EXECUTOR }, async (tx) => {
    const ctx = await contextoDoCriador(tx, p.orgId, p.userId);
    if (!ctx || !hasPermission(ctx, PERMISSAO_PEDIR_ANALISE)) {
      return { analises: [], dataImagem: null };
    }
    // Âncora técnica NDVI só para localizar a observação; o contrato não “é NDVI”.
    const params: unknown[] = [ctx.orgId, p.areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL];
    const escopoArea = empresaScopeSql(ctx, "a", params);
    let filtroData = "";
    if (p.dataImagem) {
      params.push(p.dataImagem);
      filtroData = ` and (s.observacao_inicio at time zone 'UTC')::date = $${params.length}::date`;
    }
    const ancora = await ctx.tx.query<{ observacao_inicio: Date; observacao_fim: Date; geometria_sha256: string }>(
      `select s.observacao_inicio, s.observacao_fim, s.geometria_sha256
         from erp.analises_satelitais s
         join erp.areas a on a.organization_id = s.organization_id and a.id = s.area_id and a.deleted_at is null
        where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3
          and s.indice = 'ndvi' and s.situacao = 'concluida'
          and s.observacao_inicio is not null and s.observacao_fim is not null
          and s.geometria_sha256 = encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex')
          ${filtroData}${escopoArea}
        order by s.observacao_inicio desc, s.created_at desc, s.id desc
        limit 1`, params);
    const ref = ancora.rows[0];
    if (!ref) return { analises: [], dataImagem: null };

    const paramsI: unknown[] = [
      ctx.orgId, p.areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL,
      ref.observacao_inicio, ref.observacao_fim, ref.geometria_sha256,
      INDICES_BUNDLE_ESSENCIAL as unknown as string[]
    ];
    const escopo = empresaScopeSql(ctx, "s", paramsI);
    const r = await ctx.tx.query<AnaliseIrma>(
      `select s.id, s.indice, s.observacao_inicio
         from erp.analises_satelitais s
        where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3
          and s.situacao = 'concluida'
          and s.observacao_inicio = $4 and s.observacao_fim = $5
          and s.geometria_sha256 = $6
          and s.indice = any($7::text[])${escopo}`, paramsI);
    const dataImagem = ref.observacao_inicio.toISOString().slice(0, 10);
    return { analises: r.rows, dataImagem };
  });
}

function codigoErro(e: unknown): string {
  if (e instanceof DomainError) return e.code;
  if (e instanceof Error) return e.name;
  return typeof e;
}

function rastersNaoMaterializados(): Record<IdIndiceSatelite, ResultadoProduto> {
  const rasters = {} as Record<IdIndiceSatelite, ResultadoProduto>;
  for (const indice of INDICES_BUNDLE_ESSENCIAL) {
    rasters[indice] = { chave: `raster_${indice}`, status: "indisponivel", id: null };
  }
  return rasters;
}

/**
 * Garante o produto automático (condição v3) ou UM raster explícito.
 * Política default `principal`: NÃO gera os seis rasters técnicos.
 */
export async function garantirProdutosDaObservacaoCompleta(
  dep: DependenciasGarantirProdutos,
  pedido: PedidoGarantirProdutos
): Promise<ResultadoProdutosObservacao> {
  const politica: PoliticaProdutosObservacao = pedido.politica ?? "principal";
  const { analises, dataImagem } = await lerAnalisesDaObservacao(dep, pedido);
  const porIndice = new Map(analises.map((a) => [a.indice, a]));

  const depMapa: DependenciasGerarMapaCondicao = {
    db: dep.db, cliente: dep.cliente, limiteAvulso: dep.limiteAvulso,
    log: dep.log, copernicusEnabled: dep.copernicusEnabled
  };

  let chamadas = 0;
  let reutilizacoes = 0;

  let condicao: ResultadoProduto = {
    chave: "condicao_pasto", status: "indisponivel", id: null
  };

  if (politica === "principal") {
    try {
      const r = await gerarOuReutilizarMapaCondicao(depMapa, {
        orgId: pedido.orgId,
        userId: pedido.userId,
        areaId: pedido.areaId,
        dataImagem: pedido.dataImagem,
        consultaId: pedido.consultaId ?? null,
        consultaItemId: pedido.consultaItemId ?? null
      });
      if (r.reutilizada) reutilizacoes += 1;
      else chamadas += 1;
      condicao = {
        chave: "condicao_pasto",
        status: r.reutilizada ? "reutilizado" : "pronto",
        id: r.mapa.id
      };
    } catch (e) {
      dep.log.warn({
        satelite: { area_id: pedido.areaId, etapa: "produto_condicao", codigo: codigoErro(e) }
      }, "produto condição não garantido");
      condicao = { chave: "condicao_pasto", status: "falhou", id: null, erro: codigoErro(e) };
    }
    return {
      area_id: pedido.areaId,
      data_imagem: dataImagem,
      condicao,
      rasters: rastersNaoMaterializados(),
      chamadas_process: chamadas,
      reutilizacoes,
      politica
    };
  }

  // politica === raster_explicito — gera UM índice sob demanda (lazy).
  const indice = pedido.indiceRaster;
  const rasters = rastersNaoMaterializados();
  if (!indice || !INDICES_BUNDLE_ESSENCIAL.includes(indice)) {
    return {
      area_id: pedido.areaId, data_imagem: dataImagem, condicao, rasters,
      chamadas_process: 0, reutilizacoes: 0, politica
    };
  }
  const analise = porIndice.get(indice);
  if (!analise) {
    rasters[indice] = { chave: `raster_${indice}`, status: "indisponivel", id: null };
    return {
      area_id: pedido.areaId, data_imagem: dataImagem, condicao, rasters,
      chamadas_process: 0, reutilizacoes: 0, politica
    };
  }
  const depRaster: DependenciasGerarRaster = {
    db: dep.db, cliente: dep.cliente, limiteAvulso: dep.limiteAvulso,
    log: dep.log, copernicusEnabled: dep.copernicusEnabled, armazenamento: dep.armazenamento,
    emAndamento: dep.emAndamentoRaster
  };
  try {
    const r = await gerarOuReutilizarRasterIndice(depRaster, {
      orgId: pedido.orgId, userId: pedido.userId, analiseId: analise.id
    });
    if (r.reutilizada) reutilizacoes += 1;
    else chamadas += 1;
    rasters[indice] = {
      chave: `raster_${indice}`,
      status: r.reutilizada ? "reutilizado" : "pronto",
      id: r.raster.id
    };
  } catch (e) {
    dep.log.warn({
      satelite: { area_id: pedido.areaId, indice, etapa: "produto_raster", codigo: codigoErro(e) }
    }, "produto raster não garantido");
    rasters[indice] = {
      chave: `raster_${indice}`, status: "falhou", id: null, erro: codigoErro(e)
    };
  }
  return {
    area_id: pedido.areaId,
    data_imagem: dataImagem,
    condicao,
    rasters,
    chamadas_process: chamadas,
    reutilizacoes,
    politica
  };
}

/**
 * Reparo idempotente do produto principal (mapa de condição).
 * Reutiliza Statistical gravada — NÃO chama Statistical de novo.
 * Mapa existente → 0 Process. Sem transação DB durante HTTP externo.
 */
export async function repararProdutoPrincipalObservacao(
  dep: DependenciasGarantirProdutos,
  pedido: PedidoGarantirProdutos
): Promise<ResultadoProdutosObservacao> {
  return garantirProdutosDaObservacaoCompleta(dep, {
    ...pedido,
    politica: "principal"
  });
}

/** Best-effort para o worker: nunca propaga; Statistical permanece válido. */
export async function tentarGarantirProdutosAposPastagem(
  dep: DependenciasGarantirProdutos,
  pedido: PedidoGarantirProdutos
): Promise<void> {
  try {
    const r = await garantirProdutosDaObservacaoCompleta(dep, {
      ...pedido,
      politica: pedido.politica ?? "principal"
    });
    dep.log.info({
      satelite: {
        area_id: r.area_id,
        data_imagem: r.data_imagem,
        etapa: "produtos_observacao_completa",
        politica: r.politica,
        condicao: r.condicao.status,
        chamadas_process: r.chamadas_process,
        reutilizacoes: r.reutilizacoes,
        rasters: Object.fromEntries(
          INDICES_BUNDLE_ESSENCIAL.map((i) => [i, r.rasters[i].status])
        )
      }
    }, "produtos da observação completa garantidos");
  } catch (e) {
    dep.log.warn({
      satelite: { area_id: pedido.areaId, etapa: "produtos_observacao_completa", codigo: codigoErro(e) }
    }, "produtos da observação completa não garantidos");
  }
}
