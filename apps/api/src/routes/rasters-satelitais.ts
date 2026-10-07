import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTx } from "@agro/db";
import {
  INDICES_RASTER, VERSAO_METODO_PASTAGEM_ESSENCIAL,
  encodingRasterPorVersao, moduloDaPermissao, type IdIndiceRaster
} from "@agro/domain";
import { isISODate } from "@agro/shared";
import { runService } from "../lib/service.js";
import { DomainError, err } from "../lib/errors.js";
import { empresaScopeSql, hasPermission, scopedById, type ServiceCtx } from "../lib/context.js";
import { lerDadosDoMembro, vinculoDoMembro } from "../lib/contexto-membro.js";
import { FORMATO_RASTER } from "../lib/satelite/raster.js";
import { criarAssinadorUrlRaster } from "../lib/satelite/url-assinada.js";
import {
  MSG_ANALISE_NAO_ENCONTRADA, MSG_RASTER_NAO_ENCONTRADO,
  gerarOuReutilizarRasterIndice, planejarRasterIndice, lerRasterDaChave,
  type LinhaRaster
} from "../lib/satelite/gerar-raster-indice.js";
import {
  MSG_ANALISE_DESLIGADA, PERMISSAO_PEDIR_ANALISE, PERMISSAO_VER_ANALISE, exigir
} from "./analises-satelitais.js";

export {
  MSG_ANALISE_NAO_ENCONTRADA, MSG_RASTER_NAO_ENCONTRADO, MSG_SEM_OBSERVACAO, MSG_GEOMETRIA_ALTERADA,
  MSG_METODO_DESCONHECIDO, MSG_PROVEDOR_INDISPONIVEL_RASTER, MSG_ARMAZENAMENTO_FALHOU, MSG_RASTER_DISPUTADO
} from "../lib/satelite/gerar-raster-indice.js";

const INDICES_RASTER_ENUM = INDICES_RASTER as unknown as [IdIndiceRaster, ...IdIndiceRaster[]];

/**
 * IMAGEM POR PIXEL DA ANÁLISE (SAT-06 / SAT-BUNDLE-01A) — Process API do Copernicus.
 *
 *   POST /api/mapa/analises-satelitais/:analiseId/raster   gera (ou reaproveita) via serviço interno
 *   GET  /api/mapa/analises-satelitais/:analiseId/raster   a imagem da análise, se já gerada (404 se não)
 *   GET  /api/mapa/rasters?area_ids=…&indice&pagina&tamanho  listagem operacional (sem gerar)
 *   GET  /api/mapa/rasters/:rasterId/arquivo?t=<token>      PNG pela URL assinada
 *
 * Geração: `gerarOuReutilizarRasterIndice` (mesmo serviço do worker / bundle completo).
 */
export const AREAS_POR_LISTAGEM_MAXIMO = 200;
const TAMANHO_PAGINA_PADRAO = 50;

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const corpoVazio = z.object({}).strict();
const semQuery = z.object({}).strict();
const inteiroPositivo = (maximo: number) => z.string().regex(/^[1-9]\d{0,8}$/).transform(Number).pipe(z.number().int().min(1).max(maximo));
const diaCivil = z.string().refine(isISODate, "Data inválida (use AAAA-MM-DD civil)");
const listaQuery = z.object({
  area_ids: z.string().transform((v) => v.split(",")).pipe(
    z.array(z.string().regex(UUID_CANONICO)).min(1).max(AREAS_POR_LISTAGEM_MAXIMO).refine((l) => new Set(l).size === l.length, "Área repetida")),
  indice: z.enum(INDICES_RASTER_ENUM).default("ndvi"),
  data_imagem: diaCivil.optional(),
  contexto: z.enum(["condicao"]).optional(),
  pagina: inteiroPositivo(1_000_000).default(1),
  tamanho: inteiroPositivo(AREAS_POR_LISTAGEM_MAXIMO).default(TAMANHO_PAGINA_PADRAO)
}).strict();
const arquivoQuery = z.object({ t: z.string().max(512).optional() }).strict();

const COLUNAS_RASTER = ["id", "empresa_id", "analise_id", "area_id", "indice", "tipo", "data_imagem", "largura", "altura", "cantos_lnglat",
  "escala_min", "escala_max", "resolucao_m", "versao_evalscript", "geometria_sha256"];
const colunasRaster = (alias: string) => COLUNAS_RASTER.map((c) => `${alias}.${c}`).join(", ");

function idDoCaminho(req: FastifyRequest, nome: "analiseId" | "rasterId", mensagem: string): string {
  const id = String((req.params as Record<string, string | undefined>)[nome] ?? "");
  if (!FORMA_UUID.test(id)) throw err("NOT_FOUND", mensagem);
  return id.toLowerCase();
}

export default async function rastersSatelitaisRoutes(app: FastifyInstance) {
  const { COPERNICUS_ENABLED } = app.config;
  const cliente = app.clienteCopernicus;
  const limiteAvulso = app.limiteAvulsoSatelite;
  const armazenamento = app.armazenamentoRaster;
  const assinador = criarAssinadorUrlRaster(app.config);
  const moduloLeitura = moduloDaPermissao(PERMISSAO_VER_ANALISE);
  /** Dedup em voo desta instância Fastify (não compartilhar entre réplicas no mesmo Node de teste). */
  const emAndamentoRaster = new Map<string, Promise<{ puCabecalho: string | null }>>();

  function paraDto(l: LinhaRaster, orgId: string, userId: string) {
    const { token, expira } = assinador.assinar({ rasterId: l.id, organizationId: orgId, userId });
    const enc = encodingRasterPorVersao(l.versao_evalscript);
    const escalaMin = Number(l.escala_min);
    const escalaMax = Number(l.escala_max);
    const alvo = enc?.processingResolutionM ?? null;
    return {
      id: l.id, analise_id: l.analise_id, area_id: l.area_id, indice: l.indice, tipo: l.tipo, data_imagem: l.data_imagem,
      largura: l.largura, altura: l.altura, cantos_lnglat: l.cantos_lnglat,
      escala_min: escalaMin, escala_max: escalaMax, resolucao_m: l.resolucao_m,
      resolucao_reduzida: alvo !== null ? l.resolucao_m > alvo : false,
      geometria_sha256: l.geometria_sha256,
      encoding_version: l.versao_evalscript,
      nodata: enc?.nodata ?? null,
      bits: enc?.bits ?? null,
      native_resolution_m: enc?.nativeResolutionM ?? null,
      processing_resolution_m: enc?.processingResolutionM ?? null,
      url_assinada: `/api/mapa/rasters/${l.id}/arquivo?t=${token}`,
      expira_em: new Date(expira * 1000).toISOString()
    };
  }

  app.post("/mapa/analises-satelitais/:analiseId/raster", async (req, reply) => {
    const ctxPedido = exigir(app, req, PERMISSAO_PEDIR_ANALISE);
    semQuery.parse(req.query);
    if (req.body !== undefined && req.body !== null) corpoVazio.parse(req.body);
    const analiseId = idDoCaminho(req, "analiseId", MSG_ANALISE_NAO_ENCONTRADA);
    if (!COPERNICUS_ENABLED) throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "desligada" });
    if (!cliente.configurado) throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "configuracao" });

    try {
      const r = await gerarOuReutilizarRasterIndice({
        db: app.db,
        cliente,
        limiteAvulso,
        log: req.log,
        copernicusEnabled: COPERNICUS_ENABLED,
        armazenamento,
        emAndamento: emAndamentoRaster
      }, { orgId: ctxPedido.orgId, userId: ctxPedido.user.id, analiseId });

      return reply.status(r.reutilizada ? 200 : 201)
        .send({ raster: paraDto(r.raster, ctxPedido.orgId, ctxPedido.user.id), reutilizada: r.reutilizada });
    } catch (e) {
      if (e instanceof DomainError && e.code === "RATE_LIMITED") {
        const s = (e.details as { tentar_apos_segundos?: unknown } | undefined)?.tentar_apos_segundos;
        if (typeof s === "number" && Number.isFinite(s)) reply.header("retry-after", String(s));
      }
      throw e;
    }
  });

  app.get("/mapa/analises-satelitais/:analiseId/raster", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    semQuery.parse(req.query);
    const analiseId = idDoCaminho(req, "analiseId", MSG_ANALISE_NAO_ENCONTRADA);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      let plano;
      try {
        plano = await planejarRasterIndice(ctx, analiseId);
      } catch (e) {
        if (e instanceof DomainError && e.code === "VALIDATION_ERROR") throw err("NOT_FOUND", MSG_RASTER_NAO_ENCONTRADO);
        throw e;
      }
      const raster = await lerRasterDaChave(ctx, plano.chave);
      if (!raster) throw err("NOT_FOUND", MSG_RASTER_NAO_ENCONTRADO);
      return paraDto(raster, ctx.orgId, ctx.user.id);
    });
  });

  app.get("/mapa/rasters", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = listaQuery.parse(req.query);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const condicao = q.contexto === "condicao";
      const params: unknown[] = [ctx.orgId, q.area_ids, q.indice];
      const escopoArea = empresaScopeSql(ctx, "a", params);
      const escopoRaster = empresaScopeSql(ctx, "r", params);
      const escopoAnalise = empresaScopeSql(ctx, "s", params);
      let filtroMetodo = "";
      if (condicao) {
        params.push(VERSAO_METODO_PASTAGEM_ESSENCIAL);
        filtroMetodo = ` and s.versao_metodo = $${params.length}`;
      }
      let filtroData = "";
      if (q.data_imagem) {
        params.push(q.data_imagem);
        filtroData = ` and (s.observacao_inicio at time zone 'UTC')::date = $${params.length}::date`;
      }
      params.push(q.tamanho + 1, (q.pagina - 1) * q.tamanho);
      const limite = `$${params.length - 1}`, deslocamento = `$${params.length}`;
      const hashArea = `encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex')`;
      const lateral = `select ${colunasRaster("r")}
             from (
               select s.id as analise_id
                 from erp.analises_satelitais s
                where s.organization_id = $1 and s.area_id = a.id and s.indice = $3
                  and s.situacao = 'concluida' and s.observacao_inicio is not null
                  and s.geometria_sha256 = ${hashArea}${filtroMetodo}${filtroData}${escopoAnalise}
                order by s.observacao_inicio desc, s.created_at desc, s.id desc
                limit 1
             ) util
             join erp.satelite_rasters r
               on r.organization_id = $1 and r.empresa_id = a.empresa_id and r.area_id = a.id
              and r.analise_id = util.analise_id and r.indice = $3
              and r.geometria_sha256 = ${hashArea}${escopoRaster}
            limit 1`;
      const r = await ctx.tx.query<LinhaRaster>(
        `select ${colunasRaster("x")}
           from erp.areas a
           cross join lateral (${lateral}) x
          where a.organization_id = $1 and a.id = any($2::uuid[]) and a.deleted_at is null
            and a.geometria is not null${escopoArea}
          order by a.code, a.id
          limit ${limite} offset ${deslocamento}`, params);
      const itens = r.rows.slice(0, q.tamanho).map((l) => paraDto(l, ctx.orgId, ctx.user.id));
      return {
        itens, pagina: q.pagina, tamanho: q.tamanho, tem_mais: r.rows.length > q.tamanho,
        modo: q.data_imagem ? "data" : "ultima",
        data_imagem: q.data_imagem ?? null,
        contexto: q.contexto ?? null,
        versao_metodo: condicao ? VERSAO_METODO_PASTAGEM_ESSENCIAL : null
      };
    });
  });

  app.get("/mapa/rasters/:rasterId/arquivo", async (req, reply) => {
    const q = arquivoQuery.parse(req.query);
    const rasterId = idDoCaminho(req, "rasterId", MSG_RASTER_NAO_ENCONTRADO);
    const conteudo = assinador.verificar(q.t, rasterId);
    if (!conteudo) throw err("NOT_FOUND", MSG_RASTER_NAO_ENCONTRADO);
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
      const sc = scopedById(ctx, "r", rasterId);
      const r = await tx.query<{ empresa_id: string; storage_path: string }>(
        `select r.empresa_id, r.storage_path from erp.satelite_rasters r where r.id = $1 and r.organization_id = $2${sc.sql}`, sc.params);
      const linha = r.rows[0];
      if (!linha) return null;
      return armazenamento.ler(tx, { orgId: ctx.orgId, storagePath: linha.storage_path, empresaId: linha.empresa_id });
    });
    if (!png) throw err("NOT_FOUND", MSG_RASTER_NAO_ENCONTRADO);
    const restante = Math.max(1, conteudo.expira - Math.floor(Date.now() / 1000));
    return reply
      .header("content-type", FORMATO_RASTER)
      .header("cache-control", `private, max-age=${restante}`)
      .header("x-content-type-options", "nosniff")
      .send(png);
  });
}
