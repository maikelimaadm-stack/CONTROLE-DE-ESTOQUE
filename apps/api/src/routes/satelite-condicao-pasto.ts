/**
 * MAPA INTEGRADO DE CONDIÇÃO DO PASTO — SAT-COND-01 (decisão 302).
 *
 *   POST /api/satelite/areas/:areaId/condicao-pasto   gera (ou reaproveita) o mapa categórico da última observação útil
 *   GET  /api/satelite/areas/:areaId/condicao-pasto   o mapa já gravado (404 se não)
 *   GET  /api/mapa/condicao-pasto?area_ids=&data_imagem=  listagem operacional (sem gerar)
 *   GET  /api/mapa/condicao-pasto/:mapaId/arquivo?t=   PNG pela URL assinada
 *
 * Sem transação aberta durante HTTP externo. Sem FK para uma análise de índice.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { withTx } from "@agro/db";
import {
  CHAVE_MAPA_CONDICAO_PASTO, COLECAO_SENTINEL2_L2A, TIPO_MAPA_CONDICAO_PASTO,
  VERSAO_CLASSIFICADOR_CONDICAO_PASTO, VERSAO_EVALSCRIPT_CONDICAO_PASTO, VERSAO_METODO_PASTAGEM_ESSENCIAL,
  aplicarMascaraPoligonoNosPixels, contarPixelsCondicaoComMascara, moduloDaPermissao, resumirCondicaoPasto
} from "@agro/domain";
import { isISODate } from "@agro/shared";
import { runService } from "../lib/service.js";
import { DomainError, err, validation } from "../lib/errors.js";
import { empresaScopeSql, hasPermission, scopedById, type ServiceCtx } from "../lib/context.js";
import { lerDadosDoMembro, vinculoDoMembro } from "../lib/contexto-membro.js";
import { FalhaCopernicus, camposLogErroProvedor, type RegistroChamada } from "../lib/satelite/copernicus.js";
import { gravarConsumo, lerPuDoCabecalho } from "../lib/satelite/consumo.js";
import { lerContagemChamadas } from "../lib/satelite/limite-global.js";
import { lerPoligono, type PoligonoGeoJson } from "../lib/satelite/geometria.js";
import { escreverPngCinza8, lerPngCinza8 } from "../lib/satelite/png.js";
import { CRS_RASTER, FORMATO_RASTER, dataImagemUtc, type GradeRaster } from "../lib/satelite/raster.js";
import {
  caminhoDoMapaCondicao, chaveCacheCondicaoPasto, montarCorpoProcessoCondicao, planejarGradeCondicao
} from "../lib/satelite/raster-condicao-pasto.js";
import { mascaraPoligonoNaGrade } from "../lib/satelite/mascara-poligono-raster.js";
import { armazenamentoMapaCondicao } from "../lib/satelite/armazenamento-mapa-condicao.js";
import { criarAssinadorUrlRaster } from "../lib/satelite/url-assinada.js";
import { resumoDoErro } from "../lib/satelite/executar-item.js";
import {
  MSG_ANALISE_DESLIGADA, MSG_AREA_NAO_ENCONTRADA, MSG_LIMITE_ANALISES, MSG_LIMITE_PROVEDOR,
  MSG_POLIGONO_FORA_DO_FORMATO, PERMISSAO_PEDIR_ANALISE, PERMISSAO_VER_ANALISE, exigir
} from "./analises-satelitais.js";
import { MSG_PROVEDOR_INDISPONIVEL_RASTER, MSG_ARMAZENAMENTO_FALHOU, AREAS_POR_LISTAGEM_MAXIMO } from "./rasters-satelitais.js";

export const MSG_MAPA_NAO_ENCONTRADO = "Mapa de condição não encontrado";
export const MSG_SEM_OBSERVACAO_CONDICAO = "Não há observação útil do bundle de pastagem no contorno atual; analise a condição antes de gerar o mapa.";
export const MSG_GEOMETRIA_ALTERADA_CONDICAO = "O polígono da área mudou depois da observação; peça uma análise nova antes de gerar o mapa.";

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const corpoVazio = z.object({}).strict();
const diaCivil = z.string().refine(isISODate, "Data inválida (use AAAA-MM-DD civil)");
const inteiroPositivo = (maximo: number) => z.string().regex(/^[1-9]\d{0,8}$/).transform(Number).pipe(z.number().int().min(1).max(maximo));
const listaQuery = z.object({
  area_ids: z.string().transform((v) => v.split(",")).pipe(
    z.array(z.string().regex(UUID_CANONICO)).min(1).max(AREAS_POR_LISTAGEM_MAXIMO).refine((l) => new Set(l).size === l.length, "Área repetida")),
  data_imagem: diaCivil.optional(),
  pagina: inteiroPositivo(1_000_000).default(1),
  tamanho: inteiroPositivo(AREAS_POR_LISTAGEM_MAXIMO).default(50)
}).strict();
const arquivoQuery = z.object({ t: z.string().max(512).optional() }).strict();
const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");

interface AreaCondicao {
  id: string; empresa_id: string; geometria: unknown; geometria_sha256: string | null; area_ha: string | null;
}
interface ObservacaoUtil {
  observacao_inicio: Date; observacao_fim: Date; geometria_sha256: string;
}
interface LinhaMapa {
  id: string; empresa_id: string; area_id: string; geometria_sha256: string; mapa: string; tipo: string;
  versao_classificador: string; versao_evalscript: string; data_imagem: string;
  observacao_inicio: Date; observacao_fim: Date;
  largura: number; altura: number; cantos_lnglat: unknown; resolucao_m: number;
  area_total_ha: string; resumo: unknown; storage_path: string;
}
const COLUNAS = [
  "id", "empresa_id", "area_id", "geometria_sha256", "mapa", "tipo", "versao_classificador", "versao_evalscript",
  "data_imagem", "observacao_inicio", "observacao_fim", "largura", "altura", "cantos_lnglat", "resolucao_m",
  "area_total_ha", "resumo", "storage_path"
];
const colunas = (a: string) => COLUNAS.map((c) => `${a}.${c}`).join(", ");

interface Plano {
  area: AreaCondicao; observacao: ObservacaoUtil; grade: GradeRaster; poligono: PoligonoGeoJson;
  dataImagem: string; chave: string; storagePath: string; areaTotalHa: number;
}

class FalhaArmazenamento extends Error {
  constructor(readonly puCabecalho: string | null, readonly causa: unknown) {
    super("armazenamento do mapa de condição falhou");
    this.name = "FalhaArmazenamentoMapaCondicao";
  }
}

function idDaArea(req: FastifyRequest): string {
  const id = String((req.params as { areaId?: string }).areaId ?? "");
  if (!FORMA_UUID.test(id)) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
  return id.toLowerCase();
}
function idDoMapa(req: FastifyRequest): string {
  const id = String((req.params as { mapaId?: string }).mapaId ?? "");
  if (!FORMA_UUID.test(id)) throw err("NOT_FOUND", MSG_MAPA_NAO_ENCONTRADO);
  return id.toLowerCase();
}

async function lerArea(ctx: ServiceCtx, areaId: string): Promise<AreaCondicao> {
  const sc = scopedById(ctx, "a", areaId);
  const r = await ctx.tx.query<AreaCondicao>(
    `select a.id, a.empresa_id, a.geometria, a.area_ha::text,
            case when a.geometria is null then null else encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex') end as geometria_sha256
       from erp.areas a
      where a.id = $1 and a.organization_id = $2 and a.deleted_at is null${sc.sql}`, sc.params);
  if (!r.rows[0]) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
  return r.rows[0];
}

async function lerObservacaoUtil(ctx: ServiceCtx, area: AreaCondicao, dataImagem?: string): Promise<ObservacaoUtil | null> {
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

async function lerMapaDaChave(ctx: ServiceCtx, chave: string): Promise<LinhaMapa | null> {
  const params: unknown[] = [ctx.orgId, chave];
  const escopo = empresaScopeSql(ctx, "m", params);
  const r = await ctx.tx.query<LinhaMapa>(
    `select ${colunas("m")} from erp.satelite_mapas_condicao m where m.organization_id = $1 and m.chave_cache = $2${escopo}`, params);
  return r.rows[0] ?? null;
}

function erroDoProvedor(f: FalhaCopernicus): DomainError {
  if (f.tipo === "limite") return err("RATE_LIMITED", MSG_LIMITE_PROVEDOR, { motivo: "limite_provedor", tentar_apos_segundos: f.tentarAposSegundos });
  return err("CONSULTA_INDISPONIVEL", MSG_PROVEDOR_INDISPONIVEL_RASTER, { motivo: f.tipo });
}

export default async function sateliteCondicaoPastoRoutes(app: FastifyInstance) {
  const { COPERNICUS_ENABLED } = app.config;
  const cliente = app.clienteCopernicus;
  const limiteAvulso = app.limiteAvulsoSatelite;
  const assinador = criarAssinadorUrlRaster(app.config);
  const moduloLeitura = moduloDaPermissao(PERMISSAO_VER_ANALISE);
  const emAndamento = new Map<string, Promise<{ puCabecalho: string | null; pixels: Uint8Array; mascara: Uint8Array }>>();

  function paraDto(l: LinhaMapa, orgId: string, userId: string) {
    const { token, expira } = assinador.assinar({ rasterId: l.id, organizationId: orgId, userId });
    return {
      id: l.id,
      area_id: l.area_id,
      mapa: l.mapa,
      tipo: l.tipo,
      versao_classificador: l.versao_classificador,
      versao_evalscript: l.versao_evalscript,
      data_imagem: l.data_imagem,
      observacao_inicio: l.observacao_inicio.toISOString(),
      observacao_fim: l.observacao_fim.toISOString(),
      geometria_sha256: l.geometria_sha256,
      largura: l.largura,
      altura: l.altura,
      cantos_lnglat: l.cantos_lnglat,
      resolucao_m: l.resolucao_m,
      resolucao_analitica_m: 20,
      area_total_ha: l.area_total_ha,
      resumo: l.resumo,
      url_assinada: `/api/mapa/condicao-pasto/${l.id}/arquivo?t=${token}`,
      expira_em: new Date(expira * 1000).toISOString()
    };
  }

  async function planejar(ctx: ServiceCtx, areaId: string, dataImagemPedido?: string): Promise<Plano> {
    const area = await lerArea(ctx, areaId);
    const observacao = await lerObservacaoUtil(ctx, area, dataImagemPedido);
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

  async function gerar(req: FastifyRequest, plano: Plano): Promise<{ puCabecalho: string | null; pixels: Uint8Array; mascara: Uint8Array }> {
    const registrar = (c: RegistroChamada) => app.log.info({
      satelite: {
        provedor: "copernicus_cdse", endpoint: c.endpoint, status: c.status, duracao_ms: c.duracaoMs,
        tentativa: c.tentativa, tipo_falha: c.tipoFalha, area_id: plano.area.id, mapa: CHAVE_MAPA_CONDICAO_PASTO,
        ...camposLogErroProvedor(c.erroProvedor)
      }
    }, "chamada ao provedor de satélite");
    const r = await cliente.processoComConsumo(
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
    // MAPA-UX-02: máscara geométrica — fora do polígono vira BYTE_FORA (não SEM_LEITURA).
    const mascara = mascaraPoligonoNaGrade(plano.poligono, plano.grade);
    const pixels = aplicarMascaraPoligonoNosPixels(img.pixels, mascara);
    const png = escreverPngCinza8(plano.grade.largura, plano.grade.altura, pixels);
    try {
      await runService(app, req, PERMISSAO_PEDIR_ANALISE, (ctx) =>
        armazenamentoMapaCondicao.gravar(ctx.tx, {
          orgId: ctx.orgId, empresaId: plano.area.empresa_id, storagePath: plano.storagePath, png, sha256: sha256Hex(png)
        }));
    } catch (e) {
      throw new FalhaArmazenamento(r.puCabecalho, e);
    }
    return { puCabecalho: r.puCabecalho, pixels, mascara };
  }

  async function gravarMapa(
    ctx: ServiceCtx,
    p: Plano,
    feita: { puCabecalho: string | null; pixels: Uint8Array; mascara: Uint8Array }
  ): Promise<LinhaMapa | null> {
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
    const r = await ctx.tx.query<LinhaMapa>(
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

  async function gravarConsumoCurto(puCabecalho: string | null, areaId: string, req: FastifyRequest) {
    await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx) => {
      const area = await lerArea(ctx, areaId);
      await gravarConsumo(ctx.tx, { organizationId: ctx.orgId, empresaId: area.empresa_id, consultaId: null, consultaItemId: null, puCabecalho });
    });
  }

  app.post("/satelite/areas/:areaId/condicao-pasto", async (req, reply) => {
    const ctxPedido = exigir(app, req, PERMISSAO_PEDIR_ANALISE);
    const q = z.object({ data_imagem: diaCivil.optional() }).strict().parse(req.query);
    if (req.body !== undefined && req.body !== null) corpoVazio.parse(req.body);
    const areaId = idDaArea(req);
    if (!COPERNICUS_ENABLED) throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "desligada" });
    if (!cliente.configurado) throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "configuracao" });

    const a = await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx) => {
      const plano = await planejar(ctx, areaId, q.data_imagem);
      const existente = await lerMapaDaChave(ctx, plano.chave);
      return { plano, existente, contagem: existente ? null : await lerContagemChamadas(ctx.tx) };
    });
    if (a.existente) return reply.status(200).send({ mapa: paraDto(a.existente, ctxPedido.orgId, ctxPedido.user.id), reutilizada: true });
    const { plano } = a;

    const chaveVoo = [ctxPedido.orgId, plano.area.id, plano.chave].join("|");
    let geracao = emAndamento.get(chaveVoo);
    const abriuChamada = !geracao;
    if (!geracao) {
      if (!limiteAvulso.admitir(ctxPedido.orgId, a.contagem)) throw err("RATE_LIMITED", MSG_LIMITE_ANALISES, { motivo: "limite_erp" });
      geracao = gerar(req, plano);
      emAndamento.set(chaveVoo, geracao);
      limiteAvulso.ocupar(ctxPedido.orgId);
    }
    try {
      let feita: { puCabecalho: string | null; pixels: Uint8Array; mascara: Uint8Array };
      try {
        feita = await geracao;
      } catch (e) {
        if (e instanceof FalhaCopernicus) {
          req.log.warn({ satelite: { area_id: plano.area.id, tipo_falha: e.tipo, status: e.status, ...camposLogErroProvedor(e.erroProvedor) } }, "mapa de condição não gerado");
          if (abriuChamada && e.puCabecalho !== undefined) await gravarConsumoCurto(e.puCabecalho, areaId, req);
          if (e.tentarAposSegundos !== null) reply.header("retry-after", String(e.tentarAposSegundos));
          throw erroDoProvedor(e);
        }
        if (e instanceof FalhaArmazenamento) {
          req.log.error({ satelite: { area_id: plano.area.id, etapa: "armazenamento", ...resumoDoErro(e.causa) } }, "mapa de condição gerado e não guardado");
          if (abriuChamada) await gravarConsumoCurto(e.puCabecalho, areaId, req);
          throw err("CONSULTA_INDISPONIVEL", MSG_ARMAZENAMENTO_FALHOU, { motivo: "armazenamento" });
        }
        throw e;
      }
      const desfecho = await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx) => {
        const area = await lerArea(ctx, areaId);
        if (area.geometria_sha256 !== plano.area.geometria_sha256) {
          await gravarConsumo(ctx.tx, { organizationId: ctx.orgId, empresaId: area.empresa_id, consultaId: null, consultaItemId: null, puCabecalho: feita.puCabecalho });
          throw validation(MSG_GEOMETRIA_ALTERADA_CONDICAO, { motivo: "geometria_alterada" });
        }
        const linha = await gravarMapa(ctx, plano, feita);
        if (abriuChamada) {
          await gravarConsumo(ctx.tx, { organizationId: ctx.orgId, empresaId: area.empresa_id, consultaId: null, consultaItemId: null, puCabecalho: feita.puCabecalho });
        }
        return linha ?? await lerMapaDaChave(ctx, plano.chave);
      });
      if (!desfecho) throw err("CONCURRENCY_CONFLICT", "O mapa desta observação foi disputado por outro pedido; peça de novo.");
      return reply.status(201).send({ mapa: paraDto(desfecho, ctxPedido.orgId, ctxPedido.user.id), reutilizada: false });
    } finally {
      if (abriuChamada) {
        emAndamento.delete(chaveVoo);
        limiteAvulso.liberar(ctxPedido.orgId);
      }
    }
  });

  app.get("/satelite/areas/:areaId/condicao-pasto", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = z.object({ data_imagem: diaCivil.optional() }).strict().parse(req.query);
    const areaId = idDaArea(req);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      let plano: Plano;
      try {
        plano = await planejar(ctx, areaId, q.data_imagem);
      } catch (e) {
        if (e instanceof DomainError && e.code === "VALIDATION_ERROR") throw err("NOT_FOUND", MSG_MAPA_NAO_ENCONTRADO);
        throw e;
      }
      const mapa = await lerMapaDaChave(ctx, plano.chave);
      if (!mapa) throw err("NOT_FOUND", MSG_MAPA_NAO_ENCONTRADO);
      return paraDto(mapa, ctx.orgId, ctx.user.id);
    });
  });

  app.get("/mapa/condicao-pasto", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = listaQuery.parse(req.query);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const params: unknown[] = [ctx.orgId, q.area_ids, VERSAO_CLASSIFICADOR_CONDICAO_PASTO, VERSAO_EVALSCRIPT_CONDICAO_PASTO];
      const escopoArea = empresaScopeSql(ctx, "a", params);
      const escopoMapa = empresaScopeSql(ctx, "m", params);
      let filtroData = "";
      if (q.data_imagem) {
        params.push(q.data_imagem);
        filtroData = ` and m.data_imagem = $${params.length}::date`;
      }
      params.push(q.tamanho + 1, (q.pagina - 1) * q.tamanho);
      const limite = `$${params.length - 1}`, deslocamento = `$${params.length}`;
      const hashArea = `encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex')`;
      const r = await ctx.tx.query<LinhaMapa>(
        `select ${colunas("m")}
           from erp.areas a
           join lateral (
             select ${colunas("m")}
               from erp.satelite_mapas_condicao m
              where m.organization_id = a.organization_id and m.area_id = a.id
                and m.geometria_sha256 = ${hashArea}
                and m.versao_classificador = $3 and m.versao_evalscript = $4
                ${filtroData}${escopoMapa}
              order by m.data_imagem desc, m.created_at desc
              limit 1
           ) m on true
          where a.organization_id = $1 and a.id = any($2::uuid[]) and a.deleted_at is null and a.geometria is not null
            ${escopoArea}
          order by a.id
          limit ${limite} offset ${deslocamento}`, params);
      const temMais = r.rows.length > q.tamanho;
      const itens = r.rows.slice(0, q.tamanho).map((l) => paraDto(l, ctx.orgId, ctx.user.id));
      return { itens, pagina: q.pagina, tamanho: q.tamanho, tem_mais: temMais };
    });
  });

  app.get("/mapa/condicao-pasto/:mapaId/arquivo", async (req, reply) => {
    const q = arquivoQuery.parse(req.query);
    const mapaId = idDoMapa(req);
    const conteudo = assinador.verificar(q.t, mapaId);
    if (!conteudo) throw err("NOT_FOUND", MSG_MAPA_NAO_ENCONTRADO);
    const png = await withTx(app.db, { orgId: conteudo.organizationId, userId: conteudo.userId, modulo: moduloLeitura }, async (tx) => {
      const usuario = await tx.query<{ id: string; email: string; name: string }>("select id, email, name from erp.users where id = $1 and is_active", [conteudo.userId]);
      const user = usuario.rows[0];
      if (!user) return null;
      const dados = await lerDadosDoMembro(tx, conteudo.organizationId, conteudo.userId);
      if (!dados) return null;
      const ctx: ServiceCtx = {
        user, orgId: conteudo.organizationId, empresaId: null, membership: vinculoDoMembro(dados), permissions: new Set(dados.perms),
        moduloEmpresa: moduloLeitura, tx
      };
      if (!hasPermission(ctx, PERMISSAO_VER_ANALISE)) return null;
      const sc = scopedById(ctx, "m", mapaId);
      const r = await tx.query<{ empresa_id: string; storage_path: string }>(
        `select m.empresa_id, m.storage_path from erp.satelite_mapas_condicao m where m.id = $1 and m.organization_id = $2${sc.sql}`, sc.params);
      const linha = r.rows[0];
      if (!linha) return null;
      return armazenamentoMapaCondicao.ler(tx, { orgId: ctx.orgId, storagePath: linha.storage_path, empresaId: linha.empresa_id });
    });
    if (!png) throw err("NOT_FOUND", MSG_MAPA_NAO_ENCONTRADO);
    const restante = Math.max(1, conteudo.expira - Math.floor(Date.now() / 1000));
    return reply
      .header("content-type", FORMATO_RASTER)
      .header("cache-control", `private, max-age=${restante}`)
      .header("x-content-type-options", "nosniff")
      .send(png);
  });
}
