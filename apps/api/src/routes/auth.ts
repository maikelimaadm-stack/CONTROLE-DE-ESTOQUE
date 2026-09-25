import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DomainError } from "@agro/shared";
import { verifyLocalPassword } from "../plugins/auth.js";
import { hasPermission } from "../lib/context.js";
import { contarNaoLidas } from "../lib/notificacao.js";
import { empresasVisiveisNaOrganizacao } from "../lib/empresa.js";
import { allPermissionKeys } from "@agro/domain";
import { resolverIdioma } from "@erp/plataforma";
import { withTx } from "@agro/db";
import { runService } from "../lib/service.js";

/**
 * CAPACIDADES DECLARADAS NA DESCOBERTA (`GET /auth/context`, que toda tela já carrega). ADITIVAS: a web que não
 * as conhece as ignora; a web nova só mostra e envia um campo quando a API declara a versão EXATA que sabe usar.
 *
 * `loteNaEntrada` (R1-1 c, PR #62): esta API entende o lote e a validade da devolução, a validade da correção para
 * cima e a validade da produção de ração. A API anterior NÃO os entende — os schemas dela não são estritos e
 * DESCARTAM essas chaves em silêncio (a devolução entraria sem lote; o ajuste para cima gravaria o lote sem a
 * validade, e a escolha automática por validade poria esse lote por último). Sem a declaração, a web nova não
 * oferece nem envia esses campos: numa janela em que a web suba antes da API, ou numa reversão só da API, o
 * pedido chega à API anterior exatamente como a web anterior o mandaria.
 */
export const CAPACIDADE_LOTE_NA_ENTRADA = 1;
/**
 * `codigoAutomatico` (CADASTROS AJUSTES 01, decisão 257 D): esta API GERA o código das árvores com código e dos
 * cadastros sequenciais, recusa código digitado diferente do gerado e tem a Numeração dos cadastros (Zerar).
 * Sem a declaração (API anterior), a web mostra o código digitável com sugestão e não mostra a Numeração.
 */
export const CAPACIDADE_CODIGO_AUTOMATICO = 1;
/**
 * `moverComFilhos` (decisão 257 D-5): esta API tem o Mover com renumeração do galho (`/mover/previa` e `/mover`).
 * Sem a declaração, a web oferece o Mover de antes (só registro sem filhos, pela edição).
 */
export const CAPACIDADE_MOVER_COM_FILHOS = 1;

/**
 * `consultaCnpjJanela` (CADASTROS AJUSTES 01, decisão 257): esta API entende os campos novos do Parceiro (0030:
 * matriz, RG, CAEPF, sexo, site, caixa postal, latitude/longitude, e-mail NF-e, calcula FUNRURAL) e as regras de
 * tipo de pessoa deles, e a web pode usar a janela "Consultar CNPJ" com Importar. A API anterior RECUSA essas chaves
 * (schema estrito, 422 no corpo inteiro): sem a declaração a web não mostra nem envia os campos e usa a consulta antiga.
 */
export const CAPACIDADE_CONSULTA_CNPJ_JANELA = 1;

export default async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", { config: { rateLimit: { max: app.config.LOGIN_RATE_LIMIT_MAX, timeWindow: "1 minute" } } }, async (req) => {
    if (app.config.AUTH_MODE !== "local") throw new DomainError("VALIDATION_ERROR", "Login local desabilitado: use Supabase Auth");
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(6) }).parse(req.body);
    const user = await verifyLocalPassword(app.db, email.toLowerCase(), password);
    if (!user) throw new DomainError("UNAUTHENTICATED", "E-mail ou senha inválidos");
    await app.db.query("insert into erp.audit_logs(user_id,entity,entity_id,action,ip) values ($1::uuid,'users',$1::text,'login',$2)", [user.id, req.ip]);
    return { token: await app.issueLocalToken(user), user };
  });

  // Organizações do usuário autenticado (para seleção de contexto)
  app.get("/auth/me", async (req) => {
    if (!req.auth) throw new DomainError("UNAUTHENTICATED", "Autenticação necessária");
    const uid = req.auth.id;
    const orgs = await withTx(app.db, { orgId: null, userId: uid }, (tx) => tx.query<{ id: string; name: string; is_owner: boolean; role_name: string | null }>(
      "select m.organization_id as id, (select name from erp.organizations o where o.id=m.organization_id) as name, m.is_owner, (select name from erp.roles r where r.id=m.role_id) as role_name from erp.organization_members m where m.user_id=$1 and m.is_active order by 2", [uid]));
    return { user: req.auth, organizations: orgs.rows };
  });

  // Contexto completo da organização selecionada: empresas, permissões, favoritos, parâmetros
  app.get("/auth/context", async (req) => runService(app, req, null, async (ctx) => {
    // Empresas que o usuário enxerga em ALGUM módulo (é o seletor de contexto de trabalho; a autorização
    // efetiva de cada tela continua sendo a do módulo daquela tela).
    const empresas = await empresasVisiveisNaOrganizacao(ctx);
    const fav = await ctx.tx.query("select route,label,position from erp.user_favorites where user_id=$1 and organization_id=$2 order by position", [ctx.user.id, ctx.orgId]);
    const org = await ctx.tx.query<{ name: string; parameters: unknown; idioma_padrao: string }>("select name, parameters, idioma_padrao from erp.organizations where id=$1", [ctx.orgId]);
    const idiomaUsuario = await ctx.tx.query<{ idioma: string | null }>("select idioma from erp.users where id=$1", [ctx.user.id]);
    const perms = ctx.membership.isOwner ? allPermissionKeys() : [...ctx.permissions];
    // O badge usa EXATAMENTE a mesma autoridade da listagem: contador e caixa divergirem é como o usuário
    // acaba com "3 não lidas" e uma caixa com uma linha — ou com o número de avisos que não pode ver.
    // A regra mora num lugar só (`contarNaoLidas`), e é a mesma que GET /admin/notifications devolve.
    const unread = await contarNaoLidas(ctx);
    const idioma = { organizacao: org.rows[0]?.idioma_padrao ?? null, usuario: idiomaUsuario.rows[0]?.idioma ?? null, efetivo: resolverIdioma({ usuario: idiomaUsuario.rows[0]?.idioma ?? null, organizacao: org.rows[0]?.idioma_padrao ?? null }) };
    // `empresas` é o campo CANÔNICO e, desde PRE-BASE2-05B, o ÚNICO. O apelido saiu junto com o aliasador
    // de resposta: o cliente em produção já lê só este campo, e mantê-lo duplicado deixaria a resposta com
    // duas verdades que ninguém garante que continuariam iguais.
    return { user: ctx.user, organization: { id: ctx.orgId, name: org.rows[0]?.name, parameters: org.rows[0]?.parameters ?? {} }, isOwner: ctx.membership.isOwner, empresas, permissions: perms, favorites: fav.rows, unreadNotifications: unread.total, canViewUsers: hasPermission(ctx, "users.view"), idioma, capacidades: { loteNaEntrada: CAPACIDADE_LOTE_NA_ENTRADA, codigoAutomatico: CAPACIDADE_CODIGO_AUTOMATICO, moverComFilhos: CAPACIDADE_MOVER_COM_FILHOS, consultaCnpjJanela: CAPACIDADE_CONSULTA_CNPJ_JANELA } };
  }));
}
