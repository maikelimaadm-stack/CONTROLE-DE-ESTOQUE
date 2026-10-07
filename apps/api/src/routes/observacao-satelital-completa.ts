/**
 * ROTAS DA OBSERVAÇÃO SATELITAL COMPLETA — SAT-BUNDLE-01A [F1] + R1.
 *
 * GET  /api/mapa/areas/:areaId/observacao-satelital-completa
 * GET  /api/mapa/observacoes-satelitais-completas/resumo
 * POST /api/satelite/areas/:areaId/produtos-observacao/reparar
 *
 * Capacidade: view nas GETs; create no reparo. Fora de escopo → 404.
 * Sem PNG, sem geometria, sem segredo.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { isISODate } from "@agro/shared";
import { runService } from "../lib/service.js";
import { DomainError, err } from "../lib/errors.js";
import { lerObservacaoSatelitalCompleta, lerResumosObservacoesCompletas } from "../lib/satelite/ler-observacao-completa.js";
import { repararProdutoPrincipalObservacao } from "../lib/satelite/garantir-produtos-observacao.js";
import { PERMISSAO_PEDIR_ANALISE, PERMISSAO_VER_ANALISE, exigir } from "./analises-satelitais.js";
import { AREAS_POR_LISTAGEM_MAXIMO } from "./rasters-satelitais.js";

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MSG_AREA = "Área não encontrada";
const MSG_OBS = "Observação satelital completa não encontrada";

const diaCivil = z.string().refine(isISODate, "Data inválida (use AAAA-MM-DD civil)");
const inteiroPositivo = (maximo: number) =>
  z.string().regex(/^[1-9]\d{0,8}$/).transform(Number).pipe(z.number().int().min(1).max(maximo));

const areaQuery = z.object({
  data_imagem: diaCivil.optional()
}).strict();

const resumoQuery = z.object({
  area_ids: z.string().transform((v) => v.split(",")).pipe(
    z.array(z.string().regex(UUID_CANONICO)).min(1).max(AREAS_POR_LISTAGEM_MAXIMO)
      .refine((l) => new Set(l).size === l.length, "Área repetida")),
  data_imagem: diaCivil.optional(),
  pagina: inteiroPositivo(1_000_000).default(1),
  tamanho: inteiroPositivo(AREAS_POR_LISTAGEM_MAXIMO).default(50)
}).strict();

const reparoCorpo = z.object({
  data_imagem: diaCivil.optional(),
  /** Atribuição opcional ao ledger da consulta de origem. */
  consulta_id: z.string().regex(UUID_CANONICO).optional(),
  consulta_item_id: z.string().regex(UUID_CANONICO).optional()
}).strict();

function idArea(req: FastifyRequest): string {
  const id = String((req.params as Record<string, string | undefined>).areaId ?? "");
  if (!FORMA_UUID.test(id)) throw err("NOT_FOUND", MSG_AREA);
  return id.toLowerCase();
}

export default async function observacaoSatelitalCompletaRoutes(app: FastifyInstance) {
  app.get("/mapa/areas/:areaId/observacao-satelital-completa", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = areaQuery.parse(req.query);
    const areaId = idArea(req);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const obs = await lerObservacaoSatelitalCompleta(ctx, areaId, q.data_imagem);
      if (!obs) throw err("NOT_FOUND", MSG_OBS);
      return obs;
    });
  });

  app.get("/mapa/observacoes-satelitais-completas/resumo", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = resumoQuery.parse(req.query);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const { itens, tem_mais } = await lerResumosObservacoesCompletas(ctx, q.area_ids, {
        dataImagem: q.data_imagem, pagina: q.pagina, tamanho: q.tamanho
      });
      return {
        itens,
        pagina: q.pagina,
        tamanho: q.tamanho,
        tem_mais,
        data_imagem: q.data_imagem ?? null
      };
    });
  });

  /**
   * REPAIR — gera só o mapa de condição a partir da Statistical já gravada.
   * Idempotente: mapa existente → reutilizado (0 Process). NÃO reexecuta Statistical.
   * Sem transação DB durante HTTP externo.
   */
  app.post("/satelite/areas/:areaId/produtos-observacao/reparar", async (req, reply) => {
    const ctxPedido = exigir(app, req, PERMISSAO_PEDIR_ANALISE);
    const areaId = idArea(req);
    const corpo = req.body === undefined || req.body === null
      ? {}
      : reparoCorpo.parse(req.body);
    try {
      const r = await repararProdutoPrincipalObservacao(
        {
          db: app.db,
          cliente: app.clienteCopernicus,
          limiteAvulso: app.limiteAvulsoSatelite,
          log: req.log,
          copernicusEnabled: app.config.COPERNICUS_ENABLED,
          armazenamento: app.armazenamentoRaster
        },
        {
          orgId: ctxPedido.orgId,
          userId: ctxPedido.user.id,
          areaId,
          dataImagem: corpo.data_imagem,
          consultaId: corpo.consulta_id ?? null,
          consultaItemId: corpo.consulta_item_id ?? null,
          politica: "principal"
        }
      );
      const reutilizada = r.condicao.status === "reutilizado";
      return reply.status(reutilizada ? 200 : (r.condicao.status === "pronto" ? 201 : 200)).send({
        area_id: r.area_id,
        data_imagem: r.data_imagem,
        condicao: r.condicao,
        chamadas_process: r.chamadas_process,
        reutilizacoes: r.reutilizacoes,
        politica: r.politica,
        rasters_tecnicos: "lazy"
      });
    } catch (e) {
      if (e instanceof DomainError) {
        const d = e.details as { tentar_apos_segundos?: number | null } | undefined;
        if (typeof d?.tentar_apos_segundos === "number") reply.header("retry-after", String(d.tentar_apos_segundos));
      }
      throw e;
    }
  });
}
