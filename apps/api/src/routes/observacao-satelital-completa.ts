/**
 * ROTAS DA OBSERVAÇÃO SATELITAL COMPLETA — SAT-BUNDLE-01A [F1].
 *
 * GET /api/mapa/areas/:areaId/observacao-satelital-completa
 * GET /api/mapa/observacoes-satelitais-completas/resumo
 *
 * Capacidade: analises_satelitais.view × escopo. Fora de escopo → 404.
 * Sem PNG, sem geometria, sem segredo.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { isISODate } from "@agro/shared";
import { runService } from "../lib/service.js";
import { err } from "../lib/errors.js";
import { lerObservacaoSatelitalCompleta, lerResumosObservacoesCompletas } from "../lib/satelite/ler-observacao-completa.js";
import { PERMISSAO_VER_ANALISE, exigir } from "./analises-satelitais.js";
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
}
