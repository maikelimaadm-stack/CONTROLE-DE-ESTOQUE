/**
 * MAPA INTEGRADO DE CONDIÇÃO DO PASTO — SAT-COND-01 (decisão 302) + MAPA-UX-02.
 *
 *   POST /api/satelite/areas/:areaId/condicao-pasto   gera (ou reaproveita) o mapa categórico da última observação útil
 *   GET  /api/satelite/areas/:areaId/condicao-pasto   o mapa já gravado (404 se não)
 *   GET  /api/mapa/condicao-pasto?area_ids=&data_imagem=  listagem operacional (sem gerar)
 *   GET  /api/mapa/condicao-pasto/:mapaId/arquivo?t=   PNG pela URL assinada
 *
 * A geração mora em `lib/satelite/gerar-mapa-condicao.ts` (também chamada pelo worker).
 * Sem FK para uma análise de índice.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTx } from "@agro/db";
import {
  VERSAO_CLASSIFICADOR_CONDICAO_PASTO, VERSAO_EVALSCRIPT_CONDICAO_PASTO, moduloDaPermissao
} from "@agro/domain";
import { isISODate } from "@agro/shared";
import { runService } from "../lib/service.js";
import { DomainError, err } from "../lib/errors.js";
import { empresaScopeSql, hasPermission, scopedById, type ServiceCtx } from "../lib/context.js";
import { lerDadosDoMembro, vinculoDoMembro } from "../lib/contexto-membro.js";
import { FORMATO_RASTER } from "../lib/satelite/raster.js";
import { armazenamentoMapaCondicao } from "../lib/satelite/armazenamento-mapa-condicao.js";
import { criarAssinadorUrlRaster } from "../lib/satelite/url-assinada.js";
import {
  MSG_GEOMETRIA_ALTERADA_CONDICAO, MSG_SEM_OBSERVACAO_CONDICAO,
  gerarOuReutilizarMapaCondicao, lerMapaDaChave, planejarMapaCondicao,
  type LinhaMapaCondicao
} from "../lib/satelite/gerar-mapa-condicao.js";
import {
  MSG_AREA_NAO_ENCONTRADA, PERMISSAO_PEDIR_ANALISE, PERMISSAO_VER_ANALISE, exigir
} from "./analises-satelitais.js";
import { AREAS_POR_LISTAGEM_MAXIMO } from "./rasters-satelitais.js";

export { MSG_GEOMETRIA_ALTERADA_CONDICAO, MSG_SEM_OBSERVACAO_CONDICAO };
export const MSG_MAPA_NAO_ENCONTRADO = "Mapa de condição não encontrado";

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

const COLUNAS = [
  "id", "empresa_id", "area_id", "geometria_sha256", "mapa", "tipo", "versao_classificador", "versao_evalscript",
  "data_imagem", "observacao_inicio", "observacao_fim", "largura", "altura", "cantos_lnglat", "resolucao_m",
  "area_total_ha", "resumo", "storage_path"
];
const colunas = (a: string) => COLUNAS.map((c) => `${a}.${c}`).join(", ");

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

export default async function sateliteCondicaoPastoRoutes(app: FastifyInstance) {
  const { COPERNICUS_ENABLED } = app.config;
  const cliente = app.clienteCopernicus;
  const limiteAvulso = app.limiteAvulsoSatelite;
  const assinador = criarAssinadorUrlRaster(app.config);
  const moduloLeitura = moduloDaPermissao(PERMISSAO_VER_ANALISE);

  function paraDto(l: LinhaMapaCondicao, orgId: string, userId: string) {
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

  app.post("/satelite/areas/:areaId/condicao-pasto", async (req, reply) => {
    const ctxPedido = exigir(app, req, PERMISSAO_PEDIR_ANALISE);
    const q = z.object({ data_imagem: diaCivil.optional() }).strict().parse(req.query);
    if (req.body !== undefined && req.body !== null) corpoVazio.parse(req.body);
    const areaId = idDaArea(req);
    try {
      const r = await gerarOuReutilizarMapaCondicao(
        {
          db: app.db,
          cliente,
          limiteAvulso,
          log: req.log,
          copernicusEnabled: COPERNICUS_ENABLED
        },
        { orgId: ctxPedido.orgId, userId: ctxPedido.user.id, areaId, dataImagem: q.data_imagem }
      );
      return reply.status(r.reutilizada ? 200 : 201).send({
        mapa: paraDto(r.mapa, ctxPedido.orgId, ctxPedido.user.id),
        reutilizada: r.reutilizada
      });
    } catch (e) {
      if (e instanceof DomainError) {
        const d = e.details as { tentar_apos_segundos?: number | null } | undefined;
        if (typeof d?.tentar_apos_segundos === "number") reply.header("retry-after", String(d.tentar_apos_segundos));
      }
      throw e;
    }
  });

  app.get("/satelite/areas/:areaId/condicao-pasto", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = z.object({ data_imagem: diaCivil.optional() }).strict().parse(req.query);
    const areaId = idDaArea(req);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      let plano;
      try {
        plano = await planejarMapaCondicao(ctx, areaId, q.data_imagem);
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
      const r = await ctx.tx.query<LinhaMapaCondicao>(
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
