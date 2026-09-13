/**
 * ROTAS DE PLATAFORMA (PRE-BASE2-01): ID Global e preferência de idioma.
 *
 * Nada aqui é específico de segmento de negócio. A autoridade de escopo continua sendo a mesma do resto da
 * API (organização + permissão do registro + escopo de empresa); esta camada só expõe a fundação contratada.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DomainError } from "@agro/shared";
import { IDIOMAS_PUBLICADOS, idiomaPublicado, interpretarIdGlobal, negociarIdioma, resolverIdioma } from "@erp/plataforma";
import { runService } from "../lib/service.js";
import { resolverRegistro } from "../lib/id-global.js";

export default async function plataformaRoutes(app: FastifyInstance) {
  /**
   * Resolve um ID Global (#55 ou 55) no registro real. Fora do escopo (organização, empresa ou permissão
   * daquele registro) responde 404 — nunca revela que o número existe em outro tenant, empresa ou tela.
   */
  app.get("/registros-globais/:idGlobal", async (req) => runService(app, req, null, async (ctx) => {
    const bruto = (req.params as { idGlobal: string }).idGlobal;
    const id = interpretarIdGlobal(bruto);
    if (id === null) throw new DomainError("NOT_FOUND", "Nenhum registro encontrado para este ID Global");
    return resolverRegistro(ctx, id);
  }));

  /** Idiomas publicados e o idioma efetivo do usuário nesta organização (usuário › organização › padrão). */
  app.get("/plataforma/idioma", async (req) => runService(app, req, null, async (ctx) => {
    const r = await ctx.tx.query<{ idioma_usuario: string | null; idioma_organizacao: string }>(
      "select u.idioma as idioma_usuario, o.idioma_padrao as idioma_organizacao from erp.users u cross join erp.organizations o where u.id=$1 and o.id=$2",
      [ctx.user.id, ctx.orgId]);
    const linha = r.rows[0];
    return {
      publicados: [...IDIOMAS_PUBLICADOS],
      organizacao: linha?.idioma_organizacao ?? null,
      usuario: linha?.idioma_usuario ?? null,
      efetivo: resolverIdioma({ usuario: linha?.idioma_usuario ?? null, organizacao: linha?.idioma_organizacao ?? null })
    };
  }));

  /** Define o idioma do usuário (nulo volta a seguir a organização). Só preferência: nenhum dado de negócio muda. */
  app.put("/plataforma/idioma", async (req) => runService(app, req, null, async (ctx) => {
    const { idioma } = z.object({ idioma: z.string().min(2).max(35).nullable() }).parse(req.body ?? {});
    if (idioma !== null && !idiomaPublicado(negociarIdioma(idioma))) {
      throw new DomainError("VALIDATION_ERROR", `Idioma não publicado: ${idioma}`);
    }
    const normalizado = idioma === null ? null : negociarIdioma(idioma);
    await ctx.tx.query("update erp.users set idioma=$2 where id=$1", [ctx.user.id, normalizado]);
    const org = await ctx.tx.query<{ idioma_padrao: string }>("select idioma_padrao from erp.organizations where id=$1", [ctx.orgId]);
    const organizacao = org.rows[0]?.idioma_padrao ?? null;
    return { usuario: normalizado, organizacao, efetivo: resolverIdioma({ usuario: normalizado, organizacao }) };
  }));
}
