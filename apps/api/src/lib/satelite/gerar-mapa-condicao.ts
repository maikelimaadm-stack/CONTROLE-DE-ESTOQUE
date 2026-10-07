/**
 * GERAÇÃO / REUTILIZAÇÃO DO MAPA DE CONDIÇÃO DO PASTO — MAPA-UX-02 / SAT-BUNDLE-01A.
 *
 * Serviço interno compartilhado pela rota HTTP (`POST …/condicao-pasto`) e pelo worker
 * (`garantirProdutosDaObservacaoCompleta`). Sem transação aberta durante HTTP externo.
 *
 * Identidade do cache inclui `VERSAO_CLASSIFICADOR_CONDICAO_PASTO` (v3): precedência conservadora
 * + máscara geométrica. Linhas v1/v2 permanecem no banco; a listagem operacional só serve v3.
 */
import { createHash } from "node:crypto";
import { withTx, type Db } from "@agro/db";
import {
  CHAVE_MAPA_CONDICAO_PASTO, COLECAO_SENTINEL2_L2A, TIPO_MAPA_CONDICAO_PASTO,
  VERSAO_CLASSIFICADOR_CONDICAO_PASTO, VERSAO_EVALSCRIPT_CONDICAO_PASTO, VERSAO_METODO_PASTAGEM_ESSENCIAL,
  aplicarMascaraPoligonoNosPixels, contarPixelsCondicaoComMascara, resumirCondicaoPasto
} from "@agro/domain";
import { empresaScopeSql, hasPermission, scopedById, type ServiceCtx } from "../context.js";
import { DomainError, err, validation } from "../errors.js";
import {
  MSG_ANALISE_DESLIGADA, MSG_AREA_NAO_ENCONTRADA, MSG_LIMITE_ANALISES, MSG_LIMITE_PROVEDOR,
  MSG_POLIGONO_FORA_DO_FORMATO, PERMISSAO_PEDIR_ANALISE
} from "../../routes/analises-satelitais.js";
import { MSG_PROVEDOR_INDISPONIVEL_RASTER, MSG_ARMAZENAMENTO_FALHOU } from "../../routes/rasters-satelitais.js";
import { FalhaCopernicus, camposLogErroProvedor, type ClienteCopernicus, type RegistroChamada } from "./copernicus.js";
import { gravarConsumo, lerPuDoCabecalho } from "./consumo.js";
import { MODULO_EXECUTOR, contextoDoCriador } from "./contexto-worker.js";
import { lerPoligono, type PoligonoGeoJson } from "./geometria.js";
import { lerContagemChamadas } from "./limite-global.js";
import type { LimiteAvulsoSatelite } from "./limite-avulso.js";
import { mascaraPoligonoNaGrade } from "./mascara-poligono-raster.js";
import { escreverPngCinza8, lerPngCinza8 } from "./png.js";
import { CRS_RASTER, FORMATO_RASTER, dataImagemUtc, type GradeRaster } from "./raster.js";
import {
  caminhoDoMapaCondicao, chaveCacheCondicaoPasto, montarCorpoProcessoCondicao, planejarGradeCondicao
} from "./raster-condicao-pasto.js";
import { armazenamentoMapaCondicao } from "./armazenamento-mapa-condicao.js";

/** Mesmo contrato de log do worker — evita ciclo com `executar-item.ts`. */
export interface LogMapaCondicao {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

function resumoErroMapa(e: unknown): Record<string, unknown> {
  if (e instanceof FalhaCopernicus) {
    return { tipo_falha: e.tipo, status: e.status, ...camposLogErroProvedor(e.erroProvedor) };
  }
  if (e instanceof DomainError) {
    return { tipo_falha: "erro_interno", codigo: e.code };
  }
  const pg = (e && typeof e === "object" ? e : {}) as { code?: unknown; constraint?: unknown };
  return {
    tipo_falha: "erro_interno",
    nome: e instanceof Error ? e.name : typeof e,
    sqlstate: typeof pg.code === "string" ? pg.code : null,
    restricao: typeof pg.constraint === "string" ? pg.constraint : null
  };
}

export const MSG_SEM_OBSERVACAO_CONDICAO =
  "Não há observação útil do bundle de pastagem no contorno atual; analise a condição antes de gerar o mapa.";
export const MSG_GEOMETRIA_ALTERADA_CONDICAO =
  "O polígono da área mudou depois da observação; peça uma análise nova antes de gerar o mapa.";

const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Dedup de geração em voo neste processo (rota e worker compartilham). */
const emAndamento = new Map<string, Promise<GeracaoFeita>>();

export interface AreaCondicao {
  id: string; empresa_id: string; geometria: unknown; geometria_sha256: string | null; area_ha: string | null;
}
export interface ObservacaoUtil {
  observacao_inicio: Date; observacao_fim: Date; geometria_sha256: string;
}
export interface LinhaMapaCondicao {
  id: string; empresa_id: string; area_id: string; geometria_sha256: string; mapa: string; tipo: string;
  versao_classificador: string; versao_evalscript: string; data_imagem: string;
  observacao_inicio: Date; observacao_fim: Date;
  largura: number; altura: number; cantos_lnglat: unknown; resolucao_m: number;
  area_total_ha: string; resumo: unknown; storage_path: string;
}
export interface PlanoMapaCondicao {
  area: AreaCondicao; observacao: ObservacaoUtil; grade: GradeRaster; poligono: PoligonoGeoJson;
  dataImagem: string; chave: string; storagePath: string; areaTotalHa: number;
}

interface GeracaoFeita { puCabecalho: string | null; pixels: Uint8Array; mascara: Uint8Array }

const COLUNAS = [
  "id", "empresa_id", "area_id", "geometria_sha256", "mapa", "tipo", "versao_classificador", "versao_evalscript",
  "data_imagem", "observacao_inicio", "observacao_fim", "largura", "altura", "cantos_lnglat", "resolucao_m",
  "area_total_ha", "resumo", "storage_path"
] as const;
const colunas = (a: string) => COLUNAS.map((c) => `${a}.${c}`).join(", ");

export class FalhaArmazenamentoMapaCondicao extends Error {
  constructor(readonly puCabecalho: string | null, readonly causa: unknown) {
    super("armazenamento do mapa de condição falhou");
    this.name = "FalhaArmazenamentoMapaCondicao";
  }
}

export interface DependenciasGerarMapaCondicao {
  db: Db;
  cliente: ClienteCopernicus;
  limiteAvulso: LimiteAvulsoSatelite;
  log: LogMapaCondicao;
  copernicusEnabled: boolean;
}

export interface PedidoGerarMapaCondicao {
  orgId: string;
  userId: string;
  areaId: string;
  dataImagem?: string;
  /**
   * Contexto opcional da consulta em lote: Process automático do worker atribui o consumo
   * à consulta/item. Chamadas manuais/avulsas deixam null.
   */
  consultaId?: string | null;
  consultaItemId?: string | null;
}

function tenantDo(p: PedidoGerarMapaCondicao) {
  return { orgId: p.orgId, userId: p.userId, modulo: MODULO_EXECUTOR };
}

async function comCtx<T>(dep: DependenciasGerarMapaCondicao, p: PedidoGerarMapaCondicao, fn: (ctx: ServiceCtx) => Promise<T>): Promise<T> {
  return withTx(dep.db, tenantDo(p), async (tx) => {
    const ctx = await contextoDoCriador(tx, p.orgId, p.userId);
    if (!ctx) throw err("PERMISSION_DENIED", "Sem permissão");
    if (!hasPermission(ctx, PERMISSAO_PEDIR_ANALISE)) throw err("PERMISSION_DENIED", `Sem permissão: ${PERMISSAO_PEDIR_ANALISE}`);
    return fn(ctx);
  });
}

export async function lerAreaCondicao(ctx: ServiceCtx, areaId: string): Promise<AreaCondicao> {
  const sc = scopedById(ctx, "a", areaId);
  const r = await ctx.tx.query<AreaCondicao>(
    `select a.id, a.empresa_id, a.geometria, a.area_ha::text,
            case when a.geometria is null then null else encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex') end as geometria_sha256
       from erp.areas a
      where a.id = $1 and a.organization_id = $2 and a.deleted_at is null${sc.sql}`, sc.params);
  if (!r.rows[0]) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
  return r.rows[0];
}

export async function lerObservacaoUtilCondicao(
  ctx: ServiceCtx, area: AreaCondicao, dataImagem?: string
): Promise<ObservacaoUtil | null> {
  const params: unknown[] = [ctx.orgId, area.id, VERSAO_METODO_PASTAGEM_ESSENCIAL, area.geometria_sha256];
  const escopo = empresaScopeSql(ctx, "s", params);
  let filtroData = "";
  if (dataImagem) {
    params.push(dataImagem);
    filtroData = ` and (s.observacao_inicio at time zone 'UTC')::date = $${params.length}::date`;
  }
  // Prefere o contorno atual; se só houver observação do polígono anterior, devolve-a para o planejador
  // recusar com geometria_alterada (filtrar pelo SHA atual escondia o caso atrás de sem_observacao).
  const r = await ctx.tx.query<ObservacaoUtil>(
    `select s.observacao_inicio, s.observacao_fim, s.geometria_sha256
       from erp.analises_satelitais s
      where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3
        and s.indice = 'ndvi' and s.situacao = 'concluida'
        and s.observacao_inicio is not null and s.observacao_fim is not null${filtroData}${escopo}
      order by (s.geometria_sha256 = $4) desc nulls last, s.observacao_inicio desc, s.created_at desc
      limit 1`, params);
  return r.rows[0] ?? null;
}

export async function lerMapaDaChave(ctx: ServiceCtx, chave: string): Promise<LinhaMapaCondicao | null> {
  const params: unknown[] = [ctx.orgId, chave];
  const escopo = empresaScopeSql(ctx, "m", params);
  const r = await ctx.tx.query<LinhaMapaCondicao>(
    `select ${colunas("m")} from erp.satelite_mapas_condicao m where m.organization_id = $1 and m.chave_cache = $2${escopo}`, params);
  return r.rows[0] ?? null;
}

export async function planejarMapaCondicao(
  ctx: ServiceCtx, areaId: string, dataImagemPedido?: string
): Promise<PlanoMapaCondicao> {
  const area = await lerAreaCondicao(ctx, areaId);
  const observacao = await lerObservacaoUtilCondicao(ctx, area, dataImagemPedido);
  if (!observacao) throw validation(MSG_SEM_OBSERVACAO_CONDICAO, { motivo: "sem_observacao" });
  if (area.geometria_sha256 === null || area.geometria_sha256 !== observacao.geometria_sha256) {
    throw validation(MSG_GEOMETRIA_ALTERADA_CONDICAO, { motivo: "geometria_alterada" });
  }
  const poligono = lerPoligono(area.geometria);
  if (!poligono) throw validation(MSG_POLIGONO_FORA_DO_FORMATO, { motivo: "poligono_fora_do_formato" });
  let grade: GradeRaster;
  try { grade = planejarGradeCondicao(poligono); }
  catch (e) {
    if (e instanceof RangeError) throw validation(MSG_POLIGONO_FORA_DO_FORMATO, { motivo: "poligono_fora_do_formato" });
    throw e;
  }
  const dataImagem = dataImagemUtc(observacao.observacao_inicio);
  const chave = chaveCacheCondicaoPasto({
    areaId: area.id, geometriaSha256: observacao.geometria_sha256, dataImagem, colecao: COLECAO_SENTINEL2_L2A,
    versaoClassificador: VERSAO_CLASSIFICADOR_CONDICAO_PASTO, versaoEvalscript: VERSAO_EVALSCRIPT_CONDICAO_PASTO,
    resolucaoM: grade.resolucaoM, crs: CRS_RASTER, formato: FORMATO_RASTER
  });
  const storagePath = caminhoDoMapaCondicao({ orgId: ctx.orgId, areaId: area.id, dataImagem, chaveCache: chave });
  const areaTotalHa = area.area_ha !== null && Number.isFinite(Number(area.area_ha)) ? Number(area.area_ha) : 0;
  return { area, observacao, grade, poligono, dataImagem, chave, storagePath, areaTotalHa };
}

function erroDoProvedor(f: FalhaCopernicus): DomainError {
  if (f.tipo === "limite") {
    return err("RATE_LIMITED", MSG_LIMITE_PROVEDOR, { motivo: "limite_provedor", tentar_apos_segundos: f.tentarAposSegundos });
  }
  return err("CONSULTA_INDISPONIVEL", MSG_PROVEDOR_INDISPONIVEL_RASTER, {
    motivo: f.tipo, tentar_apos_segundos: f.tentarAposSegundos
  });
}

async function gravarArquivo(
  dep: DependenciasGerarMapaCondicao, p: PedidoGerarMapaCondicao, plano: PlanoMapaCondicao, png: Buffer, puCabecalho: string | null
): Promise<void> {
  try {
    await comCtx(dep, p, (ctx) =>
      armazenamentoMapaCondicao.gravar(ctx.tx, {
        orgId: ctx.orgId, empresaId: plano.area.empresa_id, storagePath: plano.storagePath, png, sha256: sha256Hex(png)
      }));
  } catch (e) {
    throw new FalhaArmazenamentoMapaCondicao(puCabecalho, e);
  }
}

async function gravarMapa(
  ctx: ServiceCtx, p: PlanoMapaCondicao, feita: GeracaoFeita
): Promise<LinhaMapaCondicao | null> {
  const paramsArq: unknown[] = [ctx.orgId, p.area.empresa_id, p.storagePath];
  const escopoArq = empresaScopeSql(ctx, "f", paramsArq);
  const arquivo = await ctx.tx.query(
    "select 1 from erp.satelite_mapas_condicao_arquivos f where f.organization_id = $1 and f.empresa_id = $2 and f.storage_path = $3" + escopoArq,
    paramsArq);
  if (arquivo.rowCount !== 1) throw new Error("mapa de condição: o arquivo gravado não está visível na fase de registro");
  const { contagem, pixelsForaPoligono } = contarPixelsCondicaoComMascara(feita.pixels, feita.mascara);
  const resumo = resumirCondicaoPasto({
    contagem, areaTotalHa: p.areaTotalHa, resolucaoM: p.grade.resolucaoM, pixelsForaPoligono
  });
  const g = p.grade;
  const valores: unknown[] = [
    ctx.orgId, p.area.empresa_id, ctx.user.id, p.area.id, p.observacao.geometria_sha256,
    CHAVE_MAPA_CONDICAO_PASTO, TIPO_MAPA_CONDICAO_PASTO, VERSAO_CLASSIFICADOR_CONDICAO_PASTO, VERSAO_EVALSCRIPT_CONDICAO_PASTO,
    p.dataImagem, p.observacao.observacao_inicio, p.observacao.observacao_fim, p.storagePath,
    g.largura, g.altura, g.bbox3857[0], g.bbox3857[1], g.bbox3857[2], g.bbox3857[3],
    JSON.stringify(g.cantosLngLat), g.resolucaoM, p.chave, p.areaTotalHa, JSON.stringify(resumo),
    lerPuDoCabecalho(feita.puCabecalho).pu
  ];
  const escopoOrigem = empresaScopeSql(ctx, "f", valores);
  const r = await ctx.tx.query<LinhaMapaCondicao>(
    `insert into erp.satelite_mapas_condicao (
        organization_id, empresa_id, criado_por, area_id, geometria_sha256, mapa, tipo, versao_classificador, versao_evalscript,
        data_imagem, observacao_inicio, observacao_fim, storage_path, sha256_arquivo, largura, altura,
        bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y, cantos_lnglat, resolucao_m, chave_cache, area_total_ha, resumo, pu_gasto)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12, f.storage_path, f.sha256_arquivo, $14, $15, $16, $17, $18, $19, $20::jsonb,
            $21, $22, $23, $24::jsonb, $25::numeric(14,4)
       from erp.satelite_mapas_condicao_arquivos f
      where f.organization_id = $1 and f.empresa_id = $2 and f.storage_path = $13${escopoOrigem}
     on conflict (organization_id, chave_cache) do nothing
     returning ${COLUNAS.join(", ")}`, valores);
  if (r.rowCount === 1) return r.rows[0]!;
  if (r.rowCount !== 0) throw new Error("mapa de condição: a gravação devolveu mais de uma linha");
  return null;
}

function idsConsulta(p: PedidoGerarMapaCondicao): { consultaId: string | null; consultaItemId: string | null } {
  return {
    consultaId: p.consultaId ?? null,
    consultaItemId: p.consultaItemId ?? null
  };
}

async function gravarConsumoCurto(
  dep: DependenciasGerarMapaCondicao, p: PedidoGerarMapaCondicao, areaId: string, puCabecalho: string | null
): Promise<void> {
  await comCtx(dep, p, async (ctx) => {
    const area = await lerAreaCondicao(ctx, areaId);
    const ids = idsConsulta(p);
    await gravarConsumo(ctx.tx, {
      organizationId: ctx.orgId,
      empresaId: area.empresa_id,
      consultaId: ids.consultaId,
      consultaItemId: ids.consultaItemId,
      puCabecalho,
      operacao: "process"
    });
  });
}

/**
 * Gera ou reutiliza o mapa categórico v2 da última observação útil do bundle pastagem.
 * Lança DomainError (e nunca FalhaCopernicus) — PU e log de falha do provedor ficam registrados aqui.
 */
export async function gerarOuReutilizarMapaCondicao(
  dep: DependenciasGerarMapaCondicao,
  pedido: PedidoGerarMapaCondicao
): Promise<{ mapa: LinhaMapaCondicao; reutilizada: boolean }> {
  if (!dep.copernicusEnabled) {
    throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "desligada" });
  }
  if (!dep.cliente.configurado) {
    throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "configuracao" });
  }

  const a = await comCtx(dep, pedido, async (ctx) => {
    const plano = await planejarMapaCondicao(ctx, pedido.areaId, pedido.dataImagem);
    const existente = await lerMapaDaChave(ctx, plano.chave);
    return { plano, existente, contagem: existente ? null : await lerContagemChamadas(ctx.tx) };
  });
  if (a.existente) return { mapa: a.existente, reutilizada: true };
  const { plano } = a;

  const chaveVoo = [pedido.orgId, plano.area.id, plano.chave].join("|");
  let geracao = emAndamento.get(chaveVoo);
  const abriuChamada = !geracao;
  if (!geracao) {
    if (!dep.limiteAvulso.admitir(pedido.orgId, a.contagem)) {
      throw err("RATE_LIMITED", MSG_LIMITE_ANALISES, { motivo: "limite_erp" });
    }
    geracao = (async (): Promise<GeracaoFeita> => {
      const registrar = (c: RegistroChamada) => dep.log.info({
        satelite: {
          provedor: "copernicus_cdse", endpoint: c.endpoint, status: c.status, duracao_ms: c.duracaoMs,
          tentativa: c.tentativa, tipo_falha: c.tipoFalha, area_id: plano.area.id, mapa: CHAVE_MAPA_CONDICAO_PASTO,
          ...camposLogErroProvedor(c.erroProvedor)
        }
      }, "chamada ao provedor de satélite");
      const r = await dep.cliente.processoComConsumo(
        montarCorpoProcessoCondicao(plano.grade, { inicio: plano.observacao.observacao_inicio, fim: plano.observacao.observacao_fim }),
        registrar);
      let img: { largura: number; altura: number; pixels: Uint8Array };
      try {
        img = lerPngCinza8(r.png, { largura: plano.grade.largura, altura: plano.grade.altura });
      } catch {
        throw new FalhaCopernicus("resposta_malformada", null, null, r.puCabecalho);
      }
      if (img.largura !== plano.grade.largura || img.altura !== plano.grade.altura) {
        throw new FalhaCopernicus("resposta_malformada", null, null, r.puCabecalho);
      }
      const mascara = mascaraPoligonoNaGrade(plano.poligono, plano.grade);
      const pixels = aplicarMascaraPoligonoNosPixels(img.pixels, mascara);
      const png = escreverPngCinza8(plano.grade.largura, plano.grade.altura, pixels);
      await gravarArquivo(dep, pedido, plano, png, r.puCabecalho);
      return { puCabecalho: r.puCabecalho, pixels, mascara };
    })();
    emAndamento.set(chaveVoo, geracao);
    dep.limiteAvulso.ocupar(pedido.orgId);
  }

  try {
    let feita: GeracaoFeita;
    try {
      feita = await geracao;
    } catch (e) {
      if (e instanceof FalhaCopernicus) {
        dep.log.warn({
          satelite: { area_id: plano.area.id, tipo_falha: e.tipo, status: e.status, ...camposLogErroProvedor(e.erroProvedor) }
        }, "mapa de condição não gerado");
        if (abriuChamada && e.puCabecalho !== undefined) {
          await gravarConsumoCurto(dep, pedido, pedido.areaId, e.puCabecalho);
        }
        throw erroDoProvedor(e);
      }
      if (e instanceof FalhaArmazenamentoMapaCondicao) {
        dep.log.error({
          satelite: { area_id: plano.area.id, etapa: "armazenamento", ...resumoErroMapa(e.causa) }
        }, "mapa de condição gerado e não guardado");
        if (abriuChamada) await gravarConsumoCurto(dep, pedido, pedido.areaId, e.puCabecalho);
        throw err("CONSULTA_INDISPONIVEL", MSG_ARMAZENAMENTO_FALHOU, { motivo: "armazenamento" });
      }
      throw e;
    }

    const desfecho = await comCtx(dep, pedido, async (ctx) => {
      const area = await lerAreaCondicao(ctx, pedido.areaId);
      const ids = idsConsulta(pedido);
      const consumoProcess = (pu: string | null) => gravarConsumo(ctx.tx, {
        organizationId: ctx.orgId,
        empresaId: area.empresa_id,
        consultaId: ids.consultaId,
        consultaItemId: ids.consultaItemId,
        puCabecalho: pu,
        operacao: "process"
      });
      if (area.geometria_sha256 !== plano.area.geometria_sha256) {
        await consumoProcess(feita.puCabecalho);
        throw validation(MSG_GEOMETRIA_ALTERADA_CONDICAO, { motivo: "geometria_alterada" });
      }
      const linha = await gravarMapa(ctx, plano, feita);
      if (abriuChamada) await consumoProcess(feita.puCabecalho);
      return linha ?? await lerMapaDaChave(ctx, plano.chave);
    });
    if (!desfecho) {
      throw err("CONCURRENCY_CONFLICT", "O mapa desta observação foi disputado por outro pedido; peça de novo.");
    }
    return { mapa: desfecho, reutilizada: false };
  } finally {
    if (abriuChamada) {
      emAndamento.delete(chaveVoo);
      dep.limiteAvulso.liberar(pedido.orgId);
    }
  }
}

/** Best-effort: falha do mapa NÃO propaga (só log warn). */
export async function tentarGerarMapaCondicaoAposPastagem(
  dep: DependenciasGerarMapaCondicao,
  pedido: PedidoGerarMapaCondicao
): Promise<void> {
  try {
    await gerarOuReutilizarMapaCondicao(dep, pedido);
  } catch (e) {
    dep.log.warn({
      satelite: { area_id: pedido.areaId, etapa: "mapa_condicao_automatico", ...resumoErroMapa(e) }
    }, "mapa de condição automático não gerado");
  }
}
