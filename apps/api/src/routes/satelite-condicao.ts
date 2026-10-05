/**
 * CONDIÇÃO DA ÁREA / MULTI-ÍNDICE — SAT-08, decisão 299.
 *
 *   GET  /api/satelite/catalogo-indices
 *   GET  /api/satelite/areas/:areaId/resumo
 *   GET  /api/satelite/areas/:areaId/historico?indice=&limite=&antes=
 *   POST /api/mapa/areas/:areaId/analises-satelitais/condicao   body {} — bundle essencial
 *
 * Sem UI grande. Cliente NÃO manda geometria, fórmula, empresa como autorização nem secret.
 * CAPACIDADE × ESCOPO; fora do escopo = mesma 404.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AVISO_VEGETACAO_NAO_E_CAPIM,
  BUNDLE_PASTAGEM_ESSENCIAL,
  CATALOGO_INDICES,
  COLECAO_SENTINEL2_L2A,
  HISTORICO_ANALISE_SATELITAL_MAXIMO,
  HISTORICO_ANALISE_SATELITAL_PADRAO,
  INDICES_BUNDLE_ESSENCIAL,
  INDICES_SATELITE,
  PROVEDOR_COPERNICUS,
  VERSAO_CATALOGO_INDICES,
  VERSAO_METODO_PASTAGEM_ESSENCIAL,
  deltaPercentual,
  tendenciaCurta,
  type IdIndiceSatelite
} from "@agro/domain";
import { runService } from "../lib/service.js";
import { err, type DomainError } from "../lib/errors.js";
import { empresaScopeSql, scopedById, type ServiceCtx } from "../lib/context.js";
import { FalhaCopernicus, type RegistroChamada } from "../lib/satelite/copernicus.js";
import { gravarConsumo } from "../lib/satelite/consumo.js";
import { lerContagemChamadas } from "../lib/satelite/limite-global.js";
import {
  EVALSCRIPT_PASTAGEM_SHA256,
  RESOLUCAO_AGREGACAO_M,
  escolherObservacaoPastagem,
  interpretarEstatisticaMulti,
  montarCorpoPastagem,
  qualidadeBundleDeCoberturas,
  type QualidadeBundle,
  type ResultadoIndicePastagem,
  type ResultadoPastagem
} from "../lib/satelite/pastagem-essencial.js";
import { janelaPadrao, type Janela } from "../lib/satelite/ndvi.js";
import {
  MSG_ANALISE_DESLIGADA, MSG_AREA_NAO_ENCONTRADA, MSG_JANELA_DISPUTADA, MSG_LIMITE_ANALISES, MSG_LIMITE_PROVEDOR,
  MSG_POLIGONO_MUDOU, MSG_PROVEDOR_INDISPONIVEL, PERMISSAO_PEDIR_ANALISE, PERMISSAO_VER_ANALISE,
  exigir, prepararPoligono, type AreaLida
} from "./analises-satelitais.js";

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const corpoVazio = z.object({}).strict();
const semQuery = z.object({}).strict();
const indiceEnum = z.enum(INDICES_SATELITE as [string, ...string[]]);
const historicoQuery = z.object({
  indice: indiceEnum.default("ndvi"),
  limite: z.coerce.number().int().min(1).max(HISTORICO_ANALISE_SATELITAL_MAXIMO).default(HISTORICO_ANALISE_SATELITAL_PADRAO),
  antes: z.iso.datetime({ offset: true }).optional()
}).strict();

function erroDoProvedor(f: FalhaCopernicus): DomainError {
  if (f.tipo === "limite") return err("RATE_LIMITED", MSG_LIMITE_PROVEDOR, { motivo: "limite_provedor", tentar_apos_segundos: f.tentarAposSegundos });
  return err("CONSULTA_INDISPONIVEL", MSG_PROVEDOR_INDISPONIVEL, { motivo: f.tipo });
}

function idDaArea(req: FastifyRequest): string {
  const id = String((req.params as { areaId?: string }).areaId ?? "");
  if (!FORMA_UUID.test(id)) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
  return id;
}

async function lerAreaNoEscopo(ctx: ServiceCtx, areaId: string): Promise<AreaLida> {
  const sc = scopedById(ctx, "a", areaId);
  const r = await ctx.tx.query<AreaLida>(
    `select a.id, a.empresa_id, a.geometria,
            case when a.geometria is null then null else encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex') end as geometria_sha256
       from erp.areas a
      where a.id = $1 and a.organization_id = $2 and a.deleted_at is null${sc.sql}`, sc.params);
  if (!r.rows[0]) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
  return r.rows[0];
}

function dtoIndice(r: ResultadoIndicePastagem, analiseId: string | null) {
  return {
    id: analiseId,
    indice: r.indice,
    versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL,
    situacao: r.situacao,
    motivo_qualidade: r.motivo,
    observacao_inicio: r.observacao?.inicio.toISOString() ?? null,
    observacao_fim: r.observacao?.fim.toISOString() ?? null,
    valor_medio: r.valores?.medio ?? null,
    valor_minimo: r.valores?.minimo ?? null,
    valor_maximo: r.valores?.maximo ?? null,
    desvio_padrao: r.valores?.desvio ?? null,
    percentis: r.percentis,
    histograma: r.histograma,
    cobertura_valida: r.cobertura,
    resolucao_m: String(r.resolucao_m),
    resolucao_nativa_m: String(r.resolucao_nativa_m),
    qualidade: r.qualidade
  };
}

async function gravarIndice(
  ctx: ServiceCtx,
  area: AreaLida,
  janela: Janela,
  r: ResultadoIndicePastagem,
  pastagem: ResultadoPastagem,
  consultaItemId: string | null,
  dataAlvo: string | null
): Promise<string> {
  const c = r.situacao === "concluida" ? r : null;
  const pixelsGeom = c?.pixels?.geometria ?? (r.situacao === "sem_observacao_util" ? (r.pixels?.geometria ?? null) : null);
  const chave: unknown[] = [
    ctx.orgId, area.id, PROVEDOR_COPERNICUS, COLECAO_SENTINEL2_L2A, r.indice, VERSAO_METODO_PASTAGEM_ESSENCIAL,
    area.geometria_sha256, janela.inicio, janela.fim
  ];
  const g = await ctx.tx.query<{ id: string }>(
    `insert into erp.analises_satelitais (organization_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256, janela_inicio, janela_fim,
        empresa_id, resolucao_m, situacao, motivo_qualidade, observacao_inicio, observacao_fim, valor_medio, valor_minimo, valor_maximo, desvio_padrao,
        pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria, cobertura_valida, metadados_provedor, criado_por,
        consulta_item_id, resolucao_nativa_m, data_alvo, evalscript_sha256)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25::jsonb, $26, $27, $28, $29, $30)
     on conflict on constraint uq_analises_satelitais_janela do nothing
     returning id`,
    [...chave, area.empresa_id, String(r.resolucao_m), r.situacao, r.motivo,
      c?.observacao?.inicio ?? null, c?.observacao?.fim ?? null,
      c?.valores?.medio ?? null, c?.valores?.minimo ?? null, c?.valores?.maximo ?? null, c?.valores?.desvio ?? null,
      c?.pixels?.amostra ?? null, c?.pixels?.semDado ?? null, c?.pixels?.validos ?? null, pixelsGeom,
      c?.cobertura ?? null, JSON.stringify(r.metadados), ctx.user.id, consultaItemId, r.resolucao_nativa_m, dataAlvo, EVALSCRIPT_PASTAGEM_SHA256]
  );
  let analiseId: string;
  if (g.rowCount === 1) analiseId = g.rows[0]!.id;
  else {
    const params: unknown[] = [...chave, dataAlvo];
    const escopo = empresaScopeSql(ctx, "s", params);
    const e = await ctx.tx.query<{ id: string }>(
      `select s.id from erp.analises_satelitais s
        where s.organization_id = $1 and s.area_id = $2 and s.provedor = $3 and s.colecao = $4 and s.indice = $5 and s.versao_metodo = $6
          and s.geometria_sha256 = $7 and s.janela_inicio = $8 and s.janela_fim = $9 and s.data_alvo is not distinct from $10::date${escopo}`, params);
    if (e.rowCount !== 1) throw new Error("análise multi-índice: chave existe e não foi relida");
    analiseId = e.rows[0]!.id;
  }

  await ctx.tx.query(
    `insert into erp.analises_satelitais_ext (analise_id, organization_id, empresa_id, area_id, percentis, histograma, qualidade, indicadores_derivados, versao_distribuicao)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
     on conflict on constraint uq_analises_sat_ext_analise do nothing`,
    [
      analiseId, ctx.orgId, area.empresa_id, area.id,
      r.percentis ? JSON.stringify(r.percentis) : null,
      r.histograma ? JSON.stringify(r.histograma) : null,
      JSON.stringify(r.qualidade),
      r.indice === "ndvi" ? JSON.stringify(pastagem.indicadores) : null,
      pastagem.versao_metodo
    ]
  );
  return analiseId;
}

export async function gravarBundlePastagem(
  ctx: ServiceCtx,
  area: AreaLida,
  janela: Janela,
  pastagem: ResultadoPastagem,
  consultaItemId: string | null = null,
  dataAlvo: string | null = null
): Promise<{ ids: Record<IdIndiceSatelite, string>; referenciaId: string }> {
  const ids = {} as Record<IdIndiceSatelite, string>;
  for (const r of pastagem.indices) {
    ids[r.indice] = await gravarIndice(ctx, area, janela, r, pastagem, consultaItemId, dataAlvo);
  }
  return { ids, referenciaId: ids.ndvi };
}

async function lerBundleDaJanela(ctx: ServiceCtx, area: AreaLida, janela: Janela): Promise<Record<IdIndiceSatelite, string> | null> {
  const params: unknown[] = [
    ctx.orgId, area.id, PROVEDOR_COPERNICUS, COLECAO_SENTINEL2_L2A, VERSAO_METODO_PASTAGEM_ESSENCIAL,
    area.geometria_sha256, janela.inicio, janela.fim, INDICES_BUNDLE_ESSENCIAL
  ];
  const escopo = empresaScopeSql(ctx, "s", params);
  const r = await ctx.tx.query<{ id: string; indice: IdIndiceSatelite }>(
    `select s.id, s.indice from erp.analises_satelitais s
      where s.organization_id = $1 and s.area_id = $2 and s.provedor = $3 and s.colecao = $4 and s.versao_metodo = $5
        and s.geometria_sha256 = $6 and s.janela_inicio = $7 and s.janela_fim = $8
        and s.indice = any($9::text[]) and s.data_alvo is null${escopo}`, params);
  if (r.rows.length === 0) return null;
  if (r.rows.length !== INDICES_BUNDLE_ESSENCIAL.length) return null;
  const ids = {} as Record<IdIndiceSatelite, string>;
  for (const row of r.rows) ids[row.indice] = row.id;
  for (const id of INDICES_BUNDLE_ESSENCIAL) if (!ids[id]) return null;
  return ids;
}

interface LinhaResumo {
  id: string; indice: IdIndiceSatelite; situacao: string; motivo_qualidade: string | null;
  observacao_inicio: Date | null; observacao_fim: Date | null;
  valor_medio: string | null; valor_minimo: string | null; valor_maximo: string | null; desvio_padrao: string | null;
  cobertura_valida: string | null; resolucao_m: string; resolucao_nativa_m: string | null; versao_metodo: string;
  geometria_sha256: string; janela_inicio: Date; janela_fim: Date; data_alvo: string | null;
  pixels_geometria: number | null; created_at: Date;
  percentis: unknown; histograma: unknown; qualidade: unknown; indicadores_derivados: unknown;
}

/** Chave do bundle: mesmos campos que a unicidade efetiva + observação (quando concluída). */
interface ChaveBundle {
  geometria_sha256: string;
  janela_inicio: Date;
  janela_fim: Date;
  data_alvo: string | null;
  observacao_inicio: Date | null;
  observacao_fim: Date | null;
}

async function lerLinhasDaChave(
  ctx: ServiceCtx,
  areaId: string,
  chave: ChaveBundle,
  soConcluidas: boolean
): Promise<LinhaResumo[]> {
  const params: unknown[] = [
    ctx.orgId, areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL, INDICES_BUNDLE_ESSENCIAL,
    chave.geometria_sha256, chave.janela_inicio, chave.janela_fim, chave.data_alvo,
    chave.observacao_inicio, chave.observacao_fim
  ];
  const escopo = empresaScopeSql(ctx, "s", params);
  const filtroSit = soConcluidas ? " and s.situacao = 'concluida'" : "";
  const r = await ctx.tx.query<LinhaResumo>(
    `select s.id, s.indice, s.situacao, s.motivo_qualidade, s.observacao_inicio, s.observacao_fim,
            s.valor_medio::text, s.valor_minimo::text, s.valor_maximo::text, s.desvio_padrao::text,
            s.cobertura_valida::text, s.resolucao_m::text, s.resolucao_nativa_m::text, s.versao_metodo,
            s.geometria_sha256, s.janela_inicio, s.janela_fim, s.data_alvo::text, s.pixels_geometria, s.created_at,
            e.percentis, e.histograma, e.qualidade, e.indicadores_derivados
       from erp.analises_satelitais s
       left join erp.analises_satelitais_ext e on e.analise_id = s.id
      where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3 and s.indice = any($4::text[])
        and s.geometria_sha256 = $5 and s.janela_inicio = $6 and s.janela_fim = $7
        and s.data_alvo is not distinct from $8::date
        and s.observacao_inicio is not distinct from $9::timestamptz
        and s.observacao_fim is not distinct from $10::timestamptz${filtroSit}${escopo}`, params);
  return r.rows;
}

/**
 * Monta o bundle completo a partir da chave, ou null se o conjunto não tiver exatamente os 6
 * índices (fail-closed: nunca mistura execuções distintas).
 */
function montarBundleOuNull(linhas: LinhaResumo[]): LinhaResumo[] | null {
  if (linhas.length !== INDICES_BUNDLE_ESSENCIAL.length) return null;
  const porIndice = new Map(linhas.map((l) => [l.indice, l]));
  const ordenadas: LinhaResumo[] = [];
  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    const l = porIndice.get(id);
    if (!l) return null;
    ordenadas.push(l);
  }
  return ordenadas;
}

async function lerUltimaObservacaoUtil(ctx: ServiceCtx, areaId: string): Promise<LinhaResumo[] | null> {
  // Candidatos: análises NDVI concluídas do método ativo, da mais recente observação para a mais antiga.
  const params: unknown[] = [ctx.orgId, areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL];
  const escopo = empresaScopeSql(ctx, "s", params);
  const refs = await ctx.tx.query<{
    geometria_sha256: string; janela_inicio: Date; janela_fim: Date; data_alvo: string | null;
    observacao_inicio: Date; observacao_fim: Date;
  }>(
    `select s.geometria_sha256, s.janela_inicio, s.janela_fim, s.data_alvo::text,
            s.observacao_inicio, s.observacao_fim
       from erp.analises_satelitais s
      where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3
        and s.indice = 'ndvi' and s.situacao = 'concluida'
        and s.observacao_inicio is not null and s.observacao_fim is not null${escopo}
      order by s.observacao_inicio desc, s.created_at desc`, params);
  for (const ref of refs.rows) {
    const linhas = await lerLinhasDaChave(ctx, areaId, {
      geometria_sha256: ref.geometria_sha256,
      janela_inicio: ref.janela_inicio,
      janela_fim: ref.janela_fim,
      data_alvo: ref.data_alvo,
      observacao_inicio: ref.observacao_inicio,
      observacao_fim: ref.observacao_fim
    }, true);
    const bundle = montarBundleOuNull(linhas);
    if (bundle && bundle.every((l) => l.situacao === "concluida")) return bundle;
  }
  return null;
}

async function lerUltimaTentativa(ctx: ServiceCtx, areaId: string): Promise<LinhaResumo[] | null> {
  const params: unknown[] = [ctx.orgId, areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL];
  const escopo = empresaScopeSql(ctx, "s", params);
  const refs = await ctx.tx.query<{
    geometria_sha256: string; janela_inicio: Date; janela_fim: Date; data_alvo: string | null;
    observacao_inicio: Date | null; observacao_fim: Date | null;
  }>(
    `select s.geometria_sha256, s.janela_inicio, s.janela_fim, s.data_alvo::text,
            s.observacao_inicio, s.observacao_fim
       from erp.analises_satelitais s
      where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3
        and s.indice = 'ndvi'${escopo}
      order by s.created_at desc
      limit 20`, params);
  for (const ref of refs.rows) {
    const linhas = await lerLinhasDaChave(ctx, areaId, {
      geometria_sha256: ref.geometria_sha256,
      janela_inicio: ref.janela_inicio,
      janela_fim: ref.janela_fim,
      data_alvo: ref.data_alvo,
      observacao_inicio: ref.observacao_inicio,
      observacao_fim: ref.observacao_fim
    }, false);
    const bundle = montarBundleOuNull(linhas);
    if (bundle) return bundle;
  }
  return null;
}

async function lerAnterior(ctx: ServiceCtx, areaId: string, indice: string, antesDe: Date): Promise<LinhaResumo | null> {
  const params: unknown[] = [ctx.orgId, areaId, indice, VERSAO_METODO_PASTAGEM_ESSENCIAL, antesDe];
  const escopo = empresaScopeSql(ctx, "s", params);
  const r = await ctx.tx.query<LinhaResumo>(
    `select s.id, s.indice, s.situacao, s.motivo_qualidade, s.observacao_inicio, s.observacao_fim,
            s.valor_medio::text, s.valor_minimo::text, s.valor_maximo::text, s.desvio_padrao::text,
            s.cobertura_valida::text, s.resolucao_m::text, s.resolucao_nativa_m::text, s.versao_metodo,
            s.geometria_sha256, s.janela_inicio, s.janela_fim, s.data_alvo::text, s.pixels_geometria, s.created_at,
            e.percentis, e.histograma, e.qualidade, e.indicadores_derivados
       from erp.analises_satelitais s
       left join erp.analises_satelitais_ext e on e.analise_id = s.id
      where s.organization_id = $1 and s.area_id = $2 and s.indice = $3 and s.versao_metodo = $4
        and s.situacao = 'concluida' and s.observacao_inicio < $5${escopo}
      order by s.observacao_inicio desc
      limit 1`, params);
  return r.rows[0] ?? null;
}

function qualidadeDeLinhas(linhas: LinhaResumo[]): QualidadeBundle {
  const coberturas = {} as Record<IdIndiceSatelite, string | null>;
  const valid_ratios: Partial<Record<IdIndiceSatelite, string | null>> = {};
  let cloud_ratio: string | null = null;
  let scl_composition: Record<string, number> | null = null;
  let pixels_com_dado_fonte: number | null = null;
  let pixels_mascarados_qualidade: number | null = null;
  let pixelsGeometria = 0;
  const situacao = linhas.every((l) => l.situacao === "concluida") ? "concluida" as const : "sem_observacao_util" as const;
  const motivo = situacao === "concluida" ? null : (linhas[0]?.motivo_qualidade ?? null);
  for (const l of linhas) {
    coberturas[l.indice] = l.cobertura_valida;
    if (l.pixels_geometria != null) pixelsGeometria = l.pixels_geometria;
    const q = l.qualidade && typeof l.qualidade === "object" ? l.qualidade as Record<string, unknown> : null;
    if (q) {
      if (typeof q["valid_ratio"] === "string") valid_ratios[l.indice] = q["valid_ratio"];
      if (cloud_ratio === null && typeof q["cloud_ratio"] === "string") cloud_ratio = q["cloud_ratio"];
      if (scl_composition === null && q["scl_composition"] && typeof q["scl_composition"] === "object") {
        scl_composition = q["scl_composition"] as Record<string, number>;
      }
      const den = q["denominadores"] && typeof q["denominadores"] === "object"
        ? q["denominadores"] as Record<string, unknown> : null;
      if (den) {
        if (pixels_com_dado_fonte === null && typeof den["pixels_com_dado_fonte"] === "number") {
          pixels_com_dado_fonte = den["pixels_com_dado_fonte"];
        }
        if (pixels_mascarados_qualidade === null && typeof den["pixels_mascarados_qualidade"] === "number") {
          pixels_mascarados_qualidade = den["pixels_mascarados_qualidade"];
        }
        if (typeof den["pixels_geometricos"] === "number") pixelsGeometria = den["pixels_geometricos"];
      }
    }
  }
  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    if (!(id in coberturas)) coberturas[id] = null;
  }
  return qualidadeBundleDeCoberturas(coberturas, situacao, motivo, pixelsGeometria, {
    cloud_ratio, scl_composition, pixels_com_dado_fonte, pixels_mascarados_qualidade, valid_ratios
  });
}

async function dtoIndicesDoBundle(
  ctx: ServiceCtx,
  areaId: string,
  linhas: LinhaResumo[],
  comComparacao: boolean
): Promise<Record<string, unknown>> {
  const porIndice: Record<string, unknown> = {};
  for (const l of linhas) {
    let comparacao: unknown = null;
    if (comComparacao && l.situacao === "concluida" && l.observacao_inicio) {
      const ant = await lerAnterior(ctx, areaId, l.indice, l.observacao_inicio);
      if (ant?.valor_medio != null && l.valor_medio != null) {
        const delta = deltaPercentual(Number(l.valor_medio), Number(ant.valor_medio));
        comparacao = {
          anterior_id: ant.id,
          anterior_valor_medio: ant.valor_medio,
          anterior_observacao_inicio: ant.observacao_inicio?.toISOString() ?? null,
          delta_percentual: delta === null ? null : Number(delta.toFixed(2)),
          tendencia: tendenciaCurta(delta)
        };
      }
    }
    porIndice[l.indice] = {
      id: l.id, situacao: l.situacao, motivo_qualidade: l.motivo_qualidade,
      observacao_inicio: l.observacao_inicio?.toISOString() ?? null,
      observacao_fim: l.observacao_fim?.toISOString() ?? null,
      valor_medio: l.valor_medio, valor_minimo: l.valor_minimo, valor_maximo: l.valor_maximo, desvio_padrao: l.desvio_padrao,
      cobertura_valida: l.cobertura_valida, resolucao_m: l.resolucao_m, resolucao_nativa_m: l.resolucao_nativa_m,
      versao_metodo: l.versao_metodo, percentis: l.percentis, histograma: l.histograma, qualidade: l.qualidade,
      ...(comComparacao ? { comparacao_observacao_anterior: comparacao } : {})
    };
  }
  return porIndice;
}

function dtoCatalogo() {
  return {
    versao_catalogo: VERSAO_CATALOGO_INDICES,
    aviso: AVISO_VEGETACAO_NAO_E_CAPIM,
    bundles: [{
      id: BUNDLE_PASTAGEM_ESSENCIAL,
      versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL,
      indices: [...INDICES_BUNDLE_ESSENCIAL],
      resolucao_agregacao_m: RESOLUCAO_AGREGACAO_M,
      mascara: { dataMask: true, scl: true, cld: false, por_output: true }
    }],
    indices: INDICES_BUNDLE_ESSENCIAL.map((id) => {
      const c = CATALOGO_INDICES[id];
      return {
        id: c.id, nome: c.nome, versao: c.versao, formula: c.formula, bandas: [...c.bandas],
        resolucao_nativa_m: c.resolucaoNativaM,
        dominio: c.dominio,
        faixa_persistivel: c.faixaPersistivel,
        faixa_operacional: c.faixaOperacional,
        faixa_visual: c.faixaVisual,
        finalidade: c.finalidade,
        limitacoes: [...c.limitacoes], status: c.status, familia: c.familia, pergunta: c.pergunta
      };
    })
  };
}

type ChamadaPastagem = { resultado: ResultadoPastagem; puCabecalho: string | null };

export default async function sateliteCondicaoRoutes(app: FastifyInstance) {
  const { COPERNICUS_ENABLED } = app.config;
  const cliente = app.clienteCopernicus;
  const limiteAvulso = app.limiteAvulsoSatelite;
  const emAndamento = new Map<string, Promise<ChamadaPastagem>>();

  app.get("/satelite/catalogo-indices", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    semQuery.parse(req.query);
    return runService(app, req, PERMISSAO_VER_ANALISE, async () => dtoCatalogo());
  });

  app.get("/satelite/areas/:areaId/resumo", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    semQuery.parse(req.query);
    const areaId = idDaArea(req);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const area = await lerAreaNoEscopo(ctx, areaId);
      const util = await lerUltimaObservacaoUtil(ctx, area.id);
      const tentativa = await lerUltimaTentativa(ctx, area.id);

      let ultima_observacao_util: Record<string, unknown> | null = null;
      if (util) {
        const ndvi = util.find((l) => l.indice === "ndvi")!;
        ultima_observacao_util = {
          observacao_inicio: ndvi.observacao_inicio?.toISOString() ?? null,
          observacao_fim: ndvi.observacao_fim?.toISOString() ?? null,
          qualidade: qualidadeDeLinhas(util),
          indices: await dtoIndicesDoBundle(ctx, area.id, util, true),
          indicadores_derivados: ndvi.indicadores_derivados
        };
      }

      let ultima_tentativa: Record<string, unknown> | null = null;
      if (tentativa) {
        const ref = tentativa.find((l) => l.indice === "ndvi") ?? tentativa[0]!;
        ultima_tentativa = {
          situacao: ref.situacao,
          motivo_qualidade: ref.motivo_qualidade,
          criado_em: ref.created_at.toISOString(),
          observacao_inicio: ref.observacao_inicio?.toISOString() ?? null,
          observacao_fim: ref.observacao_fim?.toISOString() ?? null,
          qualidade: qualidadeDeLinhas(tentativa),
          indices: await dtoIndicesDoBundle(ctx, area.id, tentativa, false)
        };
      }

      return {
        area_id: area.id,
        versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL,
        ultima_observacao_util,
        ultima_tentativa,
        aviso: AVISO_VEGETACAO_NAO_E_CAPIM
      };
    });
  });

  app.get("/satelite/areas/:areaId/historico", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = historicoQuery.parse(req.query);
    const areaId = idDaArea(req);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const area = await lerAreaNoEscopo(ctx, areaId);
      const params: unknown[] = [ctx.orgId, area.id, q.indice, VERSAO_METODO_PASTAGEM_ESSENCIAL, q.limite];
      let filtroAntes = "";
      if (q.antes) { params.push(q.antes); filtroAntes = ` and s.created_at < $${params.length}::timestamptz`; }
      const escopo = empresaScopeSql(ctx, "s", params);
      const r = await ctx.tx.query<{
        id: string; situacao: string; motivo_qualidade: string | null;
        observacao_inicio: Date | null; observacao_fim: Date | null;
        valor_medio: string | null; valor_minimo: string | null; valor_maximo: string | null; desvio_padrao: string | null;
        cobertura_valida: string | null; created_at: Date; percentis: unknown; histograma: unknown; qualidade: unknown;
      }>(
        `select s.id, s.situacao, s.motivo_qualidade, s.observacao_inicio, s.observacao_fim,
                s.valor_medio::text, s.valor_minimo::text, s.valor_maximo::text, s.desvio_padrao::text,
                s.cobertura_valida::text, s.created_at, e.percentis, e.histograma, e.qualidade
           from erp.analises_satelitais s
           left join erp.analises_satelitais_ext e on e.analise_id = s.id
          where s.organization_id = $1 and s.area_id = $2 and s.indice = $3 and s.versao_metodo = $4${filtroAntes}${escopo}
          order by s.created_at desc
          limit $5`, params);
      return {
        area_id: area.id, indice: q.indice, versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL,
        itens: r.rows.map((l) => ({
          id: l.id, situacao: l.situacao, motivo_qualidade: l.motivo_qualidade,
          observacao_inicio: l.observacao_inicio?.toISOString() ?? null,
          observacao_fim: l.observacao_fim?.toISOString() ?? null,
          valor_medio: l.valor_medio, valor_minimo: l.valor_minimo, valor_maximo: l.valor_maximo, desvio_padrao: l.desvio_padrao,
          cobertura_valida: l.cobertura_valida, percentis: l.percentis, histograma: l.histograma, qualidade: l.qualidade,
          criado_em: l.created_at.toISOString()
        })),
        aviso: AVISO_VEGETACAO_NAO_E_CAPIM
      };
    });
  });

  app.post("/mapa/areas/:areaId/analises-satelitais/condicao", async (req, reply) => {
    const ctxPedido = exigir(app, req, PERMISSAO_PEDIR_ANALISE);
    semQuery.parse(req.query);
    if (req.body !== undefined && req.body !== null) corpoVazio.parse(req.body);
    const areaId = idDaArea(req);
    if (!COPERNICUS_ENABLED) throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "desligada" });
    if (!cliente.configurado) throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "configuracao" });
    const janela = janelaPadrao(Date.now());

    const a = await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx) => {
      const area = await lerAreaNoEscopo(ctx, areaId);
      const preparo = prepararPoligono(area, RESOLUCAO_AGREGACAO_M);
      const existente = await lerBundleDaJanela(ctx, area, janela);
      return { area, preparo, existente, contagem: existente ? null : await lerContagemChamadas(ctx.tx) };
    });

    if (a.existente) {
      return reply.status(200).send({
        area_id: a.area.id,
        versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL,
        analise_referencia_id: a.existente.ndvi,
        indices_ids: a.existente,
        reutilizada: true,
        aviso: AVISO_VEGETACAO_NAO_E_CAPIM
      });
    }

    const chave = [ctxPedido.orgId, a.area.id, a.area.geometria_sha256, "pastagem", janela.inicio.toISOString()].join("|");
    let chamada = emAndamento.get(chave);
    const abriuChamada = !chamada;
    if (!chamada) {
      if (!limiteAvulso.admitir(ctxPedido.orgId, a.contagem)) {
        throw err("RATE_LIMITED", MSG_LIMITE_ANALISES, { motivo: "limite_erp" });
      }
      const registrar = (c: RegistroChamada) => req.log.info({
        satelite: { provedor: PROVEDOR_COPERNICUS, endpoint: c.endpoint, status: c.status, duracao_ms: c.duracaoMs, tentativa: c.tentativa, tipo_falha: c.tipoFalha, area_id: a.area.id }
      }, "chamada ao provedor de satélite");
      chamada = cliente.estatisticaComConsumo(montarCorpoPastagem(a.preparo.poligono, janela, a.preparo.grade), registrar)
        .then((r) => {
          try {
            return {
              resultado: escolherObservacaoPastagem(interpretarEstatisticaMulti(r.corpo, janela), a.preparo.grade.pixelsGeometria, null),
              puCabecalho: r.puCabecalho
            };
          } catch (e) {
            if (e instanceof FalhaCopernicus) throw new FalhaCopernicus(e.tipo, e.status, e.tentarAposSegundos, r.puCabecalho);
            throw e;
          }
        });
      emAndamento.set(chave, chamada);
      chamada.finally(() => emAndamento.delete(chave)).catch(() => undefined);
      limiteAvulso.ocupar(ctxPedido.orgId);
    }

    try {
      let feita: ChamadaPastagem;
      try {
        feita = await chamada;
      } catch (e) {
        if (!(e instanceof FalhaCopernicus)) throw e;
        if (abriuChamada && e.puCabecalho !== undefined) {
          const puCabecalho = e.puCabecalho;
          await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx) => {
            const area = await lerAreaNoEscopo(ctx, areaId);
            await gravarConsumo(ctx.tx, { organizationId: ctx.orgId, empresaId: area.empresa_id, consultaId: null, consultaItemId: null, puCabecalho });
          });
        }
        if (e.tentarAposSegundos !== null) reply.header("retry-after", String(e.tentarAposSegundos));
        throw erroDoProvedor(e);
      }

      const desfecho = await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx) => {
        const area = await lerAreaNoEscopo(ctx, areaId);
        const consumo = () => (abriuChamada
          ? gravarConsumo(ctx.tx, { organizationId: ctx.orgId, empresaId: area.empresa_id, consultaId: null, consultaItemId: null, puCabecalho: feita.puCabecalho })
          : Promise.resolve(null));
        if (area.geometria_sha256 !== a.area.geometria_sha256) { await consumo(); return { conflito: MSG_POLIGONO_MUDOU as string }; }
        const { ids, referenciaId } = await gravarBundlePastagem(ctx, area, janela, feita.resultado);
        await consumo();
        const jaExistia = await lerBundleDaJanela(ctx, area, janela);
        if (!jaExistia) return { conflito: MSG_JANELA_DISPUTADA };
        return { ids, referenciaId, pastagem: feita.resultado, reutilizada: Object.values(ids).every((id) => a.existente?.[id as IdIndiceSatelite] === id) };
      });
      if ("conflito" in desfecho) {
        throw err("CONCURRENCY_CONFLICT", typeof desfecho.conflito === "string" ? desfecho.conflito : MSG_JANELA_DISPUTADA);
      }
      const ok = desfecho as { ids: Record<IdIndiceSatelite, string>; referenciaId: string; pastagem: ResultadoPastagem; reutilizada: boolean };
      return reply.status(201).send({
        area_id: a.area.id,
        versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL,
        analise_referencia_id: ok.referenciaId,
        situacao: ok.pastagem.situacao,
        motivo_qualidade: ok.pastagem.motivo,
        observacao_inicio: ok.pastagem.observacao?.inicio.toISOString() ?? null,
        observacao_fim: ok.pastagem.observacao?.fim.toISOString() ?? null,
        indices: ok.pastagem.indices.map((r) => dtoIndice(r, ok.ids[r.indice])),
        indicadores_derivados: ok.pastagem.indicadores,
        qualidade: ok.pastagem.qualidade,
        reutilizada: false,
        aviso: AVISO_VEGETACAO_NAO_E_CAPIM
      });
    } finally {
      if (abriuChamada) limiteAvulso.liberar(ctxPedido.orgId);
    }
  });
}
