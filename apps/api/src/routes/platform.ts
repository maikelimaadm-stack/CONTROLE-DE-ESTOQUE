/**
 * ROTAS DE PLATAFORMA (PRE-BASE2-01): ID Global e preferência de idioma.
 *
 * Nada aqui é específico do nicho agro. A autoridade de escopo continua sendo a mesma do resto da API
 * (organização + permissão + escopo de empresa); esta camada só expõe a fundação já contratada.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DomainError } from "@agro/shared";
import { SUPPORTED_LOCALES, isSupportedLocale, matchLocale, parseGlobalId, resolveLocale } from "@agro/platform";
import { runService } from "../lib/service.js";
import { resolveGlobalRecord } from "../lib/global-id.js";

export default async function platformRoutes(app: FastifyInstance) {
  /**
   * Resolve um ID Global (#55 ou 55) no registro real. Fora do escopo (organização, permissão ou empresa)
   * responde 404 — nunca revela que o número existe em outro tenant/empresa.
   */
  app.get("/global-records/:globalId", async (req) => runService(app, req, null, async (ctx) => {
    const raw = (req.params as { globalId: string }).globalId;
    const id = parseGlobalId(raw);
    if (id === null) throw new DomainError("NOT_FOUND", "Nenhum registro encontrado para este ID Global");
    return resolveGlobalRecord(ctx, id);
  }));

  /** Idiomas publicados e o idioma efetivo do usuário nesta organização (usuário › organização › padrão). */
  app.get("/platform/language", async (req) => runService(app, req, null, async (ctx) => {
    const r = await ctx.tx.query<{ user_language: string | null; org_language: string }>(
      "select u.language as user_language, o.default_language as org_language from erp.users u cross join erp.organizations o where u.id=$1 and o.id=$2",
      [ctx.user.id, ctx.orgId]);
    const row = r.rows[0];
    return {
      supported: [...SUPPORTED_LOCALES],
      organization: row?.org_language ?? null,
      user: row?.user_language ?? null,
      effective: resolveLocale({ user: row?.user_language ?? null, organization: row?.org_language ?? null })
    };
  }));

  /** Define o idioma do usuário (nulo volta a seguir a organização). Só preferência: nenhum dado de negócio muda. */
  app.put("/platform/language", async (req) => runService(app, req, null, async (ctx) => {
    const { language } = z.object({ language: z.string().min(2).max(35).nullable() }).parse(req.body ?? {});
    if (language !== null && !isSupportedLocale(matchLocale(language))) {
      throw new DomainError("VALIDATION_ERROR", `Idioma não publicado: ${language}`);
    }
    const normalized = language === null ? null : matchLocale(language);
    await ctx.tx.query("update erp.users set language=$2 where id=$1", [ctx.user.id, normalized]);
    const org = await ctx.tx.query<{ default_language: string }>("select default_language from erp.organizations where id=$1", [ctx.orgId]);
    return { user: normalized, organization: org.rows[0]?.default_language ?? null, effective: resolveLocale({ user: normalized, organization: org.rows[0]?.default_language ?? null }) };
  }));
}
