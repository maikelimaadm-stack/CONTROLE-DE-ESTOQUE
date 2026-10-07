/**
 * ORQUESTRAÇÃO DOS PRODUTOS ESPACIAIS DA OBSERVAÇÃO COMPLETA — SAT-BUNDLE-01C.
 *
 * Política automática `principal` (default do worker / reparo):
 *   materializa os 7 produtos (condição v3 + 6 rasters) com no máximo 1 Process TAR.
 *
 * Política `raster_explicito`: gera UM raster técnico sob demanda (rota legada POST).
 * Internamente pode reutilizar o mesmo pipeline de cache; não dispara 7 Process.
 *
 * Identidade temporal: quando `identidade` (ou `analiseIdReferencia`) vem no pedido,
 * os produtos são daquela observação — nunca do “latest”.
 *
 * Fail-closed operacional: `garantirProdutoCondicaoOperacional` /
 * `repararProdutoPrincipalObservacao` devolvem pronto | reutilizado | falhou.
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
import type { IdentidadeObservacaoMapa, LogMapaCondicao } from "./gerar-mapa-condicao.js";
import {
  gerarOuReutilizarRasterIndice, type DependenciasGerarRaster
} from "./gerar-raster-indice.js";
import {
  materializarProdutosDaObservacao, materializarProdutosOperacional,
  type DependenciasMaterializar, type ResultadoMaterializacaoObservacao,
  type ResultadoProdutoMaterializado
} from "./materializar-produtos-observacao.js";
import type { IdOutputBundleEspacial } from "./evalscript-bundle-espacial.js";

/** Política de geração automática: bundle completo (default) ou um raster explícito. */
export type PoliticaProdutosObservacao = "principal" | "raster_explicito";

/** Desfecho operacional do bundle obrigatório (7 produtos). */
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
  /** Outputs pedidos na Process TAR (vazio se cache total). */
  outputs_solicitados: IdOutputBundleEspacial[];
  /** Outputs já presentes antes da Process. */
  outputs_reutilizados: IdOutputBundleEspacial[];
  /** Todos os 7 obrigatórios presentes. */
  completo: boolean;
}

export interface ResultadoProdutoCondicaoOperacional {
  status: StatusProdutoCondicaoOperacional;
  area_id: string;
  data_imagem: string | null;
  mapa_id: string | null;
  chamadas_process: number;
  erro?: string;
  produtos?: ResultadoProdutoMaterializado[];
  outputs_solicitados?: IdOutputBundleEspacial[];
  outputs_reutilizados?: IdOutputBundleEspacial[];
  completo?: boolean;
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
   * `principal` (default): 7 produtos via 1 Process multi-output.
   * `raster_explicito`: gera UM raster técnico pedido em `indiceRaster` (legado lazy).
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

function depMaterializar(dep: DependenciasGarantirProdutos): DependenciasMaterializar {
  return {
    db: dep.db, cliente: dep.cliente, limiteAvulso: dep.limiteAvulso,
    log: dep.log, copernicusEnabled: dep.copernicusEnabled, armazenamento: dep.armazenamento
  };
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

function mapearMaterializacao(
  r: ResultadoMaterializacaoObservacao,
  politica: PoliticaProdutosObservacao
): ResultadoProdutosObservacao {
  const porId = new Map(r.produtos.map((p) => [p.id, p]));
  const statusDe = (s: ResultadoProdutoMaterializado["status"]): StatusProdutoEspacial => {
    if (s === "pronto" || s === "reparado") return "pronto";
    if (s === "reutilizado") return "reutilizado";
    if (s === "falhou") return "falhou";
    return "indisponivel";
  };
  const cond = porId.get("condicao");
  const condicao: ResultadoProduto = cond
    ? { chave: "condicao_pasto", status: statusDe(cond.status), id: cond.recurso_id, ...(cond.erro ? { erro: cond.erro } : {}) }
    : { chave: "condicao_pasto", status: "indisponivel", id: null };
  const rasters = rastersNaoMaterializados();
  for (const indice of INDICES_BUNDLE_ESSENCIAL) {
    const p = porId.get(indice);
    if (p) {
      rasters[indice] = {
        chave: `raster_${indice}`, status: statusDe(p.status), id: p.recurso_id,
        ...(p.erro ? { erro: p.erro } : {})
      };
    }
  }
  return {
    area_id: r.area_id,
    data_imagem: r.data_imagem,
    condicao,
    rasters,
    chamadas_process: r.chamadas_process,
    reutilizacoes: r.outputs_reutilizados.length,
    politica,
    outputs_solicitados: r.outputs_solicitados,
    outputs_reutilizados: r.outputs_reutilizados,
    completo: r.completo
  };
}

/**
 * Garante os produtos automáticos (7 via TAR) ou UM raster explícito legado.
 */
export async function garantirProdutosDaObservacaoCompleta(
  dep: DependenciasGarantirProdutos,
  pedido: PedidoGarantirProdutos
): Promise<ResultadoProdutosObservacao> {
  const politica: PoliticaProdutosObservacao = pedido.politica ?? "principal";
  const identidade = await resolverIdentidade(dep, pedido);

  if (politica === "principal") {
    try {
      const r = await materializarProdutosDaObservacao(depMaterializar(dep), {
        orgId: pedido.orgId,
        userId: pedido.userId,
        areaId: pedido.areaId,
        dataImagem: pedido.dataImagem,
        identidade,
        analiseIdReferencia: pedido.analiseIdReferencia,
        consultaId: pedido.consultaId ?? null,
        consultaItemId: pedido.consultaItemId ?? null
      });
      return mapearMaterializacao(r, politica);
    } catch (e) {
      dep.log.warn({
        satelite: { area_id: pedido.areaId, etapa: "produtos_bundle", codigo: codigoErro(e) }
      }, "produtos do bundle espacial não garantidos");
      return {
        area_id: pedido.areaId,
        data_imagem: pedido.dataImagem ?? null,
        condicao: { chave: "condicao_pasto", status: "falhou", id: null, erro: codigoErro(e) },
        rasters: rastersNaoMaterializados(),
        chamadas_process: 0,
        reutilizacoes: 0,
        politica,
        outputs_solicitados: [],
        outputs_reutilizados: [],
        completo: false
      };
    }
  }

  // politica === raster_explicito — gera UM índice sob demanda (legado lazy).
  const { analises, dataImagem } = await lerAnalisesDaObservacao(dep, pedido, identidade);
  const porIndice = new Map(analises.map((a) => [a.indice, a]));
  const indice = pedido.indiceRaster;
  const rasters = rastersNaoMaterializados();
  const condicao: ResultadoProduto = { chave: "condicao_pasto", status: "indisponivel", id: null };
  if (!indice || !INDICES_BUNDLE_ESSENCIAL.includes(indice)) {
    return {
      area_id: pedido.areaId, data_imagem: dataImagem, condicao, rasters,
      chamadas_process: 0, reutilizacoes: 0, politica,
      outputs_solicitados: [], outputs_reutilizados: [], completo: false
    };
  }
  const analise = porIndice.get(indice);
  if (!analise) {
    rasters[indice] = { chave: `raster_${indice}`, status: "indisponivel", id: null };
    return {
      area_id: pedido.areaId, data_imagem: dataImagem, condicao, rasters,
      chamadas_process: 0, reutilizacoes: 0, politica,
      outputs_solicitados: [], outputs_reutilizados: [], completo: false
    };
  }
  const depRaster: DependenciasGerarRaster = {
    db: dep.db, cliente: dep.cliente, limiteAvulso: dep.limiteAvulso,
    log: dep.log, copernicusEnabled: dep.copernicusEnabled, armazenamento: dep.armazenamento,
    emAndamento: dep.emAndamentoRaster
  };
  let chamadas = 0;
  let reutilizacoes = 0;
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
    politica,
    outputs_solicitados: [],
    outputs_reutilizados: [],
    completo: false
  };
}

/**
 * Caminho OPERACIONAL do bundle obrigatório — retorna pronto | reutilizado | falhou.
 * Falha NÃO é engolida como sucesso. Worker e reparo de consulta usam isto.
 */
export async function garantirProdutoCondicaoOperacional(
  dep: DependenciasGarantirProdutos,
  pedido: PedidoGarantirProdutos
): Promise<ResultadoProdutoCondicaoOperacional> {
  const identidade = await resolverIdentidade(dep, pedido);
  const { status, resultado } = await materializarProdutosOperacional(depMaterializar(dep), {
    orgId: pedido.orgId,
    userId: pedido.userId,
    areaId: pedido.areaId,
    dataImagem: pedido.dataImagem,
    identidade,
    analiseIdReferencia: pedido.analiseIdReferencia,
    consultaId: pedido.consultaId ?? null,
    consultaItemId: pedido.consultaItemId ?? null
  });
  const mapa = resultado.produtos.find((p) => p.id === "condicao");
  return {
    status,
    area_id: resultado.area_id,
    data_imagem: resultado.data_imagem,
    mapa_id: mapa?.recurso_id ?? null,
    chamadas_process: resultado.chamadas_process,
    ...(status === "falhou" ? { erro: "produtos_bundle_falharam" } : {}),
    produtos: resultado.produtos,
    outputs_solicitados: resultado.outputs_solicitados,
    outputs_reutilizados: resultado.outputs_reutilizados,
    completo: resultado.completo
  };
}

/**
 * Reparo idempotente dos produtos do bundle (condição + rasters).
 * Reutiliza Statistical gravada — NÃO chama Statistical de novo.
 * Cache total → 0 Process. Parcial → 1 Process só com faltantes.
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
        completo: r.completo,
        outputs_solicitados: r.outputs_solicitados,
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
