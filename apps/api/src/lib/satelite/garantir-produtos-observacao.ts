/**
 * ORQUESTRAÇÃO DOS PRODUTOS ESPACIAIS DA OBSERVAÇÃO COMPLETA — SAT-BUNDLE-01A R2.
 *
 * Política automática `principal` (default do worker):
 *   A) mapa condição v3 SOMENTE
 *
 * Rasters técnicos (NDVI, EVI2, NDRE, NDMI, MSAVI2, BSI): LAZY / on-demand via
 * `gerarOuReutilizarRasterIndice` (rota POST). NÃO são gerados automaticamente.
 *
 * Identidade temporal: quando `identidade` (ou `analiseIdReferencia`) vem no pedido,
 * o mapa é daquela observação — nunca do “latest”.
 *
 * Fail-closed operacional: `garantirProdutoCondicaoOperacional` devolve
 * pronto | reutilizado | falhou. Best-effort (`tentarGarantir…`) só para caminhos
 * que explicitamente engolem falha; o worker/reparo de consulta usam o operacional.
 *
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
  type DependenciasGerarMapaCondicao, type IdentidadeObservacaoMapa, type LogMapaCondicao
} from "./gerar-mapa-condicao.js";
import {
  gerarOuReutilizarRasterIndice, type DependenciasGerarRaster
} from "./gerar-raster-indice.js";

/** Política de geração automática: só o mapa principal (default) ou um raster explícito. */
export type PoliticaProdutosObservacao = "principal" | "raster_explicito";

/** Desfecho operacional do produto obrigatório (mapa condição). */
export type StatusProdutoCondicaoOperacional = "pronto" | "reutilizado" | "falhou";

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

export interface ResultadoProdutoCondicaoOperacional {
  status: StatusProdutoCondicaoOperacional;
  area_id: string;
  data_imagem: string | null;
  mapa_id: string | null;
  chamadas_process: number;
  erro?: string;
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
  /** Identidade temporal EXATA — obrigatória no worker e no reparo de item. */
  identidade?: IdentidadeObservacaoMapa;
  /** Alternativa: carregar identidade a partir da análise de referência do bundle. */
  analiseIdReferencia?: string;
  /** Contexto da consulta em lote — atribui o Process automático ao ledger (só fluxos internos). */
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
  observacao_fim: Date;
  geometria_sha256: string;
}

async function lerIdentidadeDaAnalise(
  dep: DependenciasGarantirProdutos, p: PedidoGarantirProdutos, analiseId: string
): Promise<IdentidadeObservacaoMapa | null> {
  return withTx(dep.db, { orgId: p.orgId, userId: p.userId, modulo: MODULO_EXECUTOR }, async (tx) => {
    const ctx = await contextoDoCriador(tx, p.orgId, p.userId);
    if (!ctx || !hasPermission(ctx, PERMISSAO_PEDIR_ANALISE)) return null;
    const params: unknown[] = [ctx.orgId, analiseId, p.areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL];
    const escopo = empresaScopeSql(ctx, "s", params);
    const r = await ctx.tx.query<{ observacao_inicio: Date; observacao_fim: Date; geometria_sha256: string }>(
      `select s.observacao_inicio, s.observacao_fim, s.geometria_sha256
         from erp.analises_satelitais s
        where s.organization_id = $1 and s.id = $2 and s.area_id = $3
          and s.versao_metodo = $4 and s.situacao = 'concluida'
          and s.observacao_inicio is not null and s.observacao_fim is not null${escopo}
        limit 1`, params);
    const row = r.rows[0];
    if (!row) return null;
    return {
      observacaoInicio: row.observacao_inicio,
      observacaoFim: row.observacao_fim,
      geometriaSha256: row.geometria_sha256
    };
  });
}

async function resolverIdentidade(
  dep: DependenciasGarantirProdutos, p: PedidoGarantirProdutos
): Promise<IdentidadeObservacaoMapa | undefined> {
  if (p.identidade) return p.identidade;
  if (p.analiseIdReferencia) {
    return (await lerIdentidadeDaAnalise(dep, p, p.analiseIdReferencia)) ?? undefined;
  }
  return undefined;
}

async function lerAnalisesDaObservacao(
  dep: DependenciasGarantirProdutos, p: PedidoGarantirProdutos, identidade?: IdentidadeObservacaoMapa
): Promise<{ analises: AnaliseIrma[]; dataImagem: string | null }> {
  return withTx(dep.db, { orgId: p.orgId, userId: p.userId, modulo: MODULO_EXECUTOR }, async (tx) => {
    const ctx = await contextoDoCriador(tx, p.orgId, p.userId);
    if (!ctx || !hasPermission(ctx, PERMISSAO_PEDIR_ANALISE)) {
      return { analises: [], dataImagem: null };
    }
    const params: unknown[] = [ctx.orgId, p.areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL];
    const escopoArea = empresaScopeSql(ctx, "a", params);
    let filtroAncora = "";
    if (identidade) {
      params.push(identidade.observacaoInicio, identidade.observacaoFim, identidade.geometriaSha256);
      filtroAncora = ` and s.observacao_inicio = $${params.length - 2}
        and s.observacao_fim = $${params.length - 1}
        and s.geometria_sha256 = $${params.length}`;
    } else if (p.dataImagem) {
      params.push(p.dataImagem);
      filtroAncora = ` and (s.observacao_inicio at time zone 'UTC')::date = $${params.length}::date`;
    }
    // Âncora técnica NDVI só para localizar a observação; o contrato não “é NDVI”.
    // Sem identidade: latest do contorno atual (rota manual). Com identidade: EXATA.
    const ancora = await ctx.tx.query<{ observacao_inicio: Date; observacao_fim: Date; geometria_sha256: string }>(
      `select s.observacao_inicio, s.observacao_fim, s.geometria_sha256
         from erp.analises_satelitais s
         join erp.areas a on a.organization_id = s.organization_id and a.id = s.area_id and a.deleted_at is null
        where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3
          and s.indice = 'ndvi' and s.situacao = 'concluida'
          and s.observacao_inicio is not null and s.observacao_fim is not null
          and s.geometria_sha256 = encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex')
          ${filtroAncora}${escopoArea}
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
      `select s.id, s.indice, s.observacao_inicio, s.observacao_fim, s.geometria_sha256
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
  const identidade = await resolverIdentidade(dep, pedido);
  const { analises, dataImagem } = await lerAnalisesDaObservacao(dep, pedido, identidade);
  const porIndice = new Map(analises.map((a) => [a.indice, a]));

  // Se o pedido não trouxe identidade mas a âncora resolveu uma observação, propaga-a ao mapa.
  const identidadeEfetiva: IdentidadeObservacaoMapa | undefined = identidade ?? (
    analises[0]
      ? {
        observacaoInicio: analises[0].observacao_inicio,
        observacaoFim: analises[0].observacao_fim,
        geometriaSha256: analises[0].geometria_sha256
      }
      : undefined
  );

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
        identidade: identidadeEfetiva,
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
 * Caminho OPERACIONAL do produto obrigatório — retorna pronto | reutilizado | falhou.
 * Falha NÃO é engolida como sucesso. Worker e reparo de consulta usam isto.
 */
export async function garantirProdutoCondicaoOperacional(
  dep: DependenciasGarantirProdutos,
  pedido: PedidoGarantirProdutos
): Promise<ResultadoProdutoCondicaoOperacional> {
  const r = await garantirProdutosDaObservacaoCompleta(dep, {
    ...pedido,
    politica: "principal"
  });
  if (r.condicao.status === "pronto") {
    return {
      status: "pronto",
      area_id: r.area_id,
      data_imagem: r.data_imagem,
      mapa_id: r.condicao.id,
      chamadas_process: r.chamadas_process
    };
  }
  if (r.condicao.status === "reutilizado") {
    return {
      status: "reutilizado",
      area_id: r.area_id,
      data_imagem: r.data_imagem,
      mapa_id: r.condicao.id,
      chamadas_process: 0
    };
  }
  return {
    status: "falhou",
    area_id: r.area_id,
    data_imagem: r.data_imagem,
    mapa_id: null,
    chamadas_process: r.chamadas_process,
    erro: r.condicao.erro ?? "falhou"
  };
}

/**
 * Reparo idempotente do produto principal (mapa de condição).
 * Reutiliza Statistical gravada — NÃO chama Statistical de novo.
 * Mapa existente → 0 Process. Sem transação DB durante HTTP externo.
 * Retorno operacional (fail-closed).
 */
export async function repararProdutoPrincipalObservacao(
  dep: DependenciasGarantirProdutos,
  pedido: PedidoGarantirProdutos
): Promise<ResultadoProdutoCondicaoOperacional> {
  return garantirProdutoCondicaoOperacional(dep, pedido);
}

/**
 * Best-effort legado: nunca propaga. NÃO usar no fechamento de consulta nem no worker
 * quando a reserva/fechamento dependem do produto — use `garantirProdutoCondicaoOperacional`.
 */
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
