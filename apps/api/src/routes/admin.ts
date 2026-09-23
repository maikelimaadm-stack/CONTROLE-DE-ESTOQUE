import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { CADASTROS_CODIGO_HIERARQUICO, MASCARA_CODIGO_PADRAO, PARAMETRO_MASCARAS_CODIGO, mascaraValida, PERMISSION_RESOURCES, ACTION_LABELS, MODULOS_ESCOPO_EMPRESA, allPermissionKeys, modulosDasPermissoes } from "@agro/domain";
import { runService, audit } from "../lib/service.js";
import { notFound, validation, denied } from "../lib/errors.js";
import { hasPermission } from "../lib/context.js";
import { contarNaoLidas, criarNotificacao, visibilidadeNotificacaoSql } from "../lib/notificacao.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { escopoEmpresaSchema, gravarEscoposAuditado, type EscopoEmpresaEntrada } from "../lib/escopo-admin.js";
import { atribuirIdGlobal , paginaComIdGlobal } from "../lib/id-global.js";
import { recusarEscopoAchatado } from "../lib/contrato-legado.js";
import { CHAVE_ORIGEM_SEED, withTx } from "@agro/db";
import { DomainError } from "@agro/shared";

/**
 * Acesso por empresa pedido na requisição — contrato ÚNICO desde PRE-BASE2-05B: `escopos_empresas`.
 * `null` = não mexer no que já existe.
 */
const escoposPedidos = (d: { escopos_empresas?: EscopoEmpresaEntrada[] }): EscopoEmpresaEntrada[] | null => d.escopos_empresas ?? null;

/**
 * Quantos vínculos (ativos ou não) o usuário tem em OUTRAS organizações. A RLS de `organization_members`
 * só mostra, dentro do contexto de uma organização, os vínculos DELA; a leitura é feita numa transação
 * própria sob a identidade do usuário alvo (`app.user_id`), o mesmo caminho de `/auth/me`, sem migration.
 */
async function vinculosForaDaOrganizacao(app: FastifyInstance, userId: string, orgId: string): Promise<number> {
  const r = await withTx(app.db, { orgId: null, userId }, (tx) => tx.query<{ n: number }>("select count(*)::int n from erp.organization_members where user_id=$1 and organization_id<>$2", [userId, orgId]));
  return r.rows[0]?.n ?? 0;
}

export default async function adminRoutes(app: FastifyInstance) {
  // ---------- Catálogo de permissões (árvore para a tela de perfis) ----------
  app.get("/admin/permissions", async (req) => { app.requireCtx(req); return PERMISSION_RESOURCES.map((r) => ({ ...r, actions: r.actions.map((a) => ({ key: `${r.key}.${a}`, action: a, label: ACTION_LABELS[a] ?? a })) })); });

  // ---------- Perfis ----------
  app.get("/admin/roles", async (req) => runService(app, req, "roles.view", async (ctx) => {
    const r = await ctx.tx.query("select r.id, r.name, r.description, r.is_system, r.created_at, r.updated_at, (select count(*) from erp.role_permissions rp where rp.role_id=r.id)::int as permission_count, (select count(*) from erp.organization_members m where m.role_id=r.id)::int as member_count from erp.roles r where r.organization_id=$1 and r.deleted_at is null order by r.name", [ctx.orgId]);
    return paginaComIdGlobal(ctx, "roles", { items: r.rows as Record<string, unknown>[], total: r.rowCount });
  }));
  app.get("/admin/roles/:id", async (req) => runService(app, req, "roles.view", async (ctx) => {
    const { id } = req.params as { id: string };
    const r = await ctx.tx.query("select id,name,description,is_system from erp.roles where id=$1 and organization_id=$2 and deleted_at is null", [id, ctx.orgId]);
    if (!r.rows[0]) throw notFound("Perfil");
    const p = await ctx.tx.query<{ permission_key: string }>("select permission_key from erp.role_permissions where role_id=$1", [id]);
    return { ...r.rows[0], permissions: p.rows.map((x) => x.permission_key) };
  }));
  const roleSchema = z.object({ name: z.string().min(1).max(80), description: z.string().max(200).optional().nullable(), permissions: z.array(z.string()).default([]) });
  app.post("/admin/roles", async (req, reply) => reply.status(201).send(await runService(app, req, "roles.create", async (ctx) => {
    const d = roleSchema.parse(req.body);
    const valid = new Set(allPermissionKeys()); const bad = d.permissions.filter((p) => !valid.has(p)); if (bad.length) throw validation("Permissões inválidas", bad);
    const r = await ctx.tx.query<{ id: string }>("insert into erp.roles(organization_id,name,description) values ($1,$2,$3) returning id", [ctx.orgId, d.name, d.description ?? null]);
    await atribuirIdGlobal(ctx, "roles", r.rows[0]!.id);
    for (const p of d.permissions) await ctx.tx.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2) on conflict do nothing", [r.rows[0]!.id, p]);
    await audit(ctx.tx, ctx, "roles", r.rows[0]!.id, "create", { permissions: d.permissions.length });
    return { id: r.rows[0]!.id };
  })));
  app.put("/admin/roles/:id", async (req) => runService(app, req, "roles.edit", async (ctx) => {
    const { id } = req.params as { id: string }; const d = roleSchema.parse(req.body);
    const cur = await ctx.tx.query<{ is_system: boolean }>("select is_system from erp.roles where id=$1 and organization_id=$2 and deleted_at is null", [id, ctx.orgId]);
    if (!cur.rows[0]) throw notFound("Perfil");
    await ctx.tx.query("update erp.roles set name=$3, description=$4 where id=$1 and organization_id=$2", [id, ctx.orgId, d.name, d.description ?? null]);
    if (!cur.rows[0].is_system) {
      await ctx.tx.query("delete from erp.role_permissions where role_id=$1", [id]);
      for (const p of d.permissions) await ctx.tx.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2) on conflict do nothing", [id, p]);
    }
    await audit(ctx.tx, ctx, "roles", id, "update", { permissions: d.permissions.length });
    app.clearContextCache(); // perfil/permissões/fazendas mudaram: próxima requisição recarrega o contexto
    return { id };
  }));
  app.delete("/admin/roles/:id", async (req) => runService(app, req, "roles.delete", async (ctx) => {
    const { id } = req.params as { id: string };
    const cur = await ctx.tx.query<{ is_system: boolean }>("select is_system from erp.roles where id=$1 and organization_id=$2", [id, ctx.orgId]);
    if (!cur.rows[0]) throw notFound("Perfil"); if (cur.rows[0].is_system) throw validation("Perfil de sistema não pode ser excluído");
    const inUse = await ctx.tx.query("select 1 from erp.organization_members where role_id=$1 and is_active limit 1", [id]); if (inUse.rowCount) throw validation("Perfil em uso por usuários");
    await ctx.tx.query("update erp.roles set deleted_at=now() where id=$1", [id]);
    app.clearContextCache(); // perfil/permissões/fazendas mudaram: próxima requisição recarrega o contexto
    return { id, deleted: true };
  }));

  // ---------- Usuários/membros da organização ----------
  app.get("/admin/members", async (req) => runService(app, req, "users.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query);
    const where = ["m.organization_id=$1"]; const params: unknown[] = [ctx.orgId];
    if (q.search) { params.push(`%${q.search}%`); where.push(`(u.name ilike $${params.length} or u.email::text ilike $${params.length})`); }
    const total = await ctx.tx.query<{ n: string }>(`select count(*) n from erp.organization_members m join erp.users u on u.id=m.user_id where ${where.join(" and ")}`, params);
    const r = await ctx.tx.query(`select m.id as member_id, u.id, u.name, u.email, u.phone, u.is_active as user_active, m.is_active, m.is_owner, m.role_id, r.name as role_name, u.last_login_at, m.created_at, (select coalesce(json_agg(json_build_object('modulo', e.modulo, 'modo', e.modo, 'empresas', coalesce((select array_agg(me.empresa_id) from erp.membro_empresas me where me.organization_id=e.organization_id and me.membro_id=e.membro_id and me.modulo=e.modulo), '{}')) order by e.modulo), '[]'::json) from erp.membro_escopos_empresa e where e.organization_id=m.organization_id and e.membro_id=m.id) as escopos_empresas from erp.organization_members m join erp.users u on u.id=m.user_id left join erp.roles r on r.id=m.role_id where ${where.join(" and ")} order by u.name limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    // A RESPOSTA é canônica desde PRE-BASE2-05B: só `escopos_empresas`. O campo achatado saiu — ele só
    // conseguia representar a configuração quando todos os módulos coincidiam, e devolvia `null` no resto.
    const items = r.rows.map((x) => {
      const escopos = ((x as { escopos_empresas: EscopoEmpresaEntrada[] }).escopos_empresas ?? []).map((e) => ({ ...e, empresas: e.empresas ?? [] }));
      return { ...(x as Record<string, unknown>), escopos_empresas: escopos };
    });
    return { items, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize };
  }));
  /**
   * Catálogo de módulos de ACESSO POR EMPRESA para a tela de administração. Com `role_id`, diz também em
   * quais módulos aquele perfil tem permissão FUNCIONAL — a tela desabilita os demais, porque escopo sem
   * capacidade não dá acesso a nada (a interseção é E, nunca OU). Desabilitar é informação, não autorização.
   */
  app.get("/admin/modulos-empresa", async (req) => runService(app, req, "users.view", async (ctx) => {
    const { role_id: roleId } = req.query as { role_id?: string };
    let comPermissao: string[] | null = null;
    if (roleId) {
      const r = await ctx.tx.query<{ permission_key: string }>(
        "select rp.permission_key from erp.role_permissions rp join erp.roles ro on ro.id=rp.role_id where rp.role_id=$1 and ro.organization_id=$2", [roleId, ctx.orgId]);
      comPermissao = modulosDasPermissoes(r.rows.map((x) => x.permission_key));
    }
    return { items: MODULOS_ESCOPO_EMPRESA.map((m) => ({ ...m, tem_permissao: comPermissao ? comPermissao.includes(m.chave) : null })) };
  }));
  const memberSchema = z.object({ name: z.string().min(1), email: z.string().email(), phone: z.string().optional().nullable(), password: z.string().min(8).optional(), role_id: z.string().uuid().nullable().optional(), escopos_empresas: z.array(escopoEmpresaSchema).optional(), is_active: z.boolean().default(true), boss_user_ids: z.array(z.string().uuid()).default([]) });
  app.post("/admin/members", async (req, reply) => reply.status(201).send(await runService(app, req, "users.create", async (ctx) => {
    recusarEscopoAchatado(req.body);
    const d = memberSchema.parse(req.body);
    // `erp.users` é GLOBAL (um usuário, várias organizações). Cadastrar NUNCA altera usuário que já existe:
    // o antigo "on conflict do update" deixava o admin de QUALQUER organização trocar nome e senha de um
    // usuário de outra e entrar como ele (GO-LIVE-01 R1). Sem convite nem seletor de organização, vincular
    // usuário existente não é suportado — e a recusa não diz a qual organização o e-mail pertence.
    const email = d.email.toLowerCase();
    const existente = await ctx.tx.query<{ id: string }>("select id from erp.users where email=$1", [email]);
    if (existente.rows[0]) {
      const membro = await ctx.tx.query("select 1 from erp.organization_members where organization_id=$1 and user_id=$2", [ctx.orgId, existente.rows[0].id]);
      if (membro.rowCount) throw new DomainError("CONFLICT", "Este usuário já é membro desta organização. Use a edição do usuário.");
      throw new DomainError("CONFLICT", "Já existe um usuário com este e-mail. Vincular um usuário existente não é suportado; use outro e-mail.");
    }
    const hash = d.password ? await bcrypt.hash(d.password, 10) : null;
    const u = await ctx.tx.query<{ id: string }>("insert into erp.users(email,name,phone,password_hash) values ($1,$2,$3,$4) returning id", [email, d.name, d.phone ?? null, hash]);
    const m = await ctx.tx.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_active) values ($1,$2,$3,$4) on conflict (organization_id,user_id) do update set role_id=excluded.role_id, is_active=excluded.is_active returning id", [ctx.orgId, u.rows[0]!.id, d.role_id ?? null, d.is_active]);
    // Corpo SEM `escopos_empresas` = nenhum módulo configurado = NENHUMA empresa (fail-closed). Um fallback
    // anterior traduzia a ausência em modo `todas` nos onze módulos — criava o membro enxergando a
    // organização inteira, e a auditoria registrava a concessão total como se tivesse sido pedida.
    await gravarEscoposAuditado(ctx, m.rows[0]!.id, escoposPedidos(d) ?? []);
    await ctx.tx.query("delete from erp.user_bosses where organization_id=$1 and user_id=$2", [ctx.orgId, u.rows[0]!.id]);
    for (const b of d.boss_user_ids) await ctx.tx.query("insert into erp.user_bosses(organization_id,user_id,boss_user_id) values ($1,$2,$3) on conflict do nothing", [ctx.orgId, u.rows[0]!.id, b]);
    await audit(ctx.tx, ctx, "users", u.rows[0]!.id, "create");
    app.clearContextCache(); // perfil/permissões/fazendas mudaram: próxima requisição recarrega o contexto
    return { id: u.rows[0]!.id, member_id: m.rows[0]!.id };
  })));
  app.put("/admin/members/:userId", async (req) => runService(app, req, "users.edit", async (ctx) => {
    recusarEscopoAchatado(req.body);
    const { userId } = req.params as { userId: string }; const d = memberSchema.partial().parse(req.body);
    const m = await ctx.tx.query<{ id: string; is_owner: boolean }>("select id, is_owner from erp.organization_members where organization_id=$1 and user_id=$2", [ctx.orgId, userId]);
    if (!m.rows[0]) throw notFound("Usuário");
    // O e-mail é a identidade de login e não é editável: aceitar e ignorar seria configuração que parece
    // funcionar (GO-LIVE-01 R1-2). Igual ao atual passa, porque a tela reenvia o objeto inteiro.
    if (d.email !== undefined) {
      const atual = (await ctx.tx.query<{ email: string }>("select email from erp.users where id=$1", [userId])).rows[0]?.email;
      if (d.email.toLowerCase() !== atual?.toLowerCase()) throw validation("O e-mail do usuário não pode ser alterado.");
    }
    // Nome, telefone e senha são do USUÁRIO global. Só a organização que é a única do usuário pode alterá-los;
    // senão o admin de uma troca a senha que vale nas outras (GO-LIVE-01 R1-1). O vínculo desta organização
    // (perfil, ativo, escopos, chefes) continua editável abaixo.
    if ((d.name || d.phone !== undefined || d.password) && await vinculosForaDaOrganizacao(app, userId, ctx.orgId) > 0) {
      throw new DomainError("CONFLICT", "Nome, telefone e senha deste usuário não podem ser alterados por esta organização, porque ele também pertence a outra.");
    }
    if (d.name || d.phone !== undefined || d.password) await ctx.tx.query("update erp.users set name=coalesce($2,name), phone=coalesce($3,phone), password_hash=coalesce($4,password_hash) where id=$1", [userId, d.name ?? null, d.phone ?? null, d.password ? await bcrypt.hash(d.password, 10) : null]);
    if (d.role_id !== undefined || d.is_active !== undefined) {
      if (m.rows[0].is_owner && d.is_active === false) throw validation("Proprietário não pode ser desativado");
      await ctx.tx.query("update erp.organization_members set role_id=coalesce($3,role_id), is_active=coalesce($4,is_active) where id=$1 and organization_id=$2", [m.rows[0].id, ctx.orgId, d.role_id ?? null, d.is_active ?? null]);
    }
    // trocar de perfil (role_id) NÃO apaga o acesso por empresa: são dimensões independentes (o quê × onde)
    const escopos = escoposPedidos(d);
    if (escopos) await gravarEscoposAuditado(ctx, m.rows[0].id, escopos);
    if (d.boss_user_ids) { await ctx.tx.query("delete from erp.user_bosses where organization_id=$1 and user_id=$2", [ctx.orgId, userId]); for (const b of d.boss_user_ids) await ctx.tx.query("insert into erp.user_bosses(organization_id,user_id,boss_user_id) values ($1,$2,$3) on conflict do nothing", [ctx.orgId, userId, b]); }
    await audit(ctx.tx, ctx, "users", userId, "update");
    app.clearContextCache(); // perfil/permissões/fazendas mudaram: próxima requisição recarrega o contexto
    return { id: userId };
  }));

  // ---------- Parametrizações do tenant ----------
  app.get("/admin/parameters", async (req) => runService(app, req, null, async (ctx) => (await ctx.tx.query("select parameters from erp.organizations where id=$1", [ctx.orgId])).rows[0]));
  app.put("/admin/parameters", async (req) => runService(app, req, "tenant_parameters.edit", async (ctx) => {
    // Máscara de código por cadastro hierárquico: só cadastros conhecidos e só máscara válida (422), nunca
    // descartada em silêncio — uma máscara ignorada faria o servidor recusar códigos que a tela sugeriu.
    const mascaras = z.object(Object.fromEntries(CADASTROS_CODIGO_HIERARQUICO.map((c) => [c, z.string().refine(mascaraValida, `Máscara inválida. Use 9 para cada dígito e ponto entre níveis (ex.: ${MASCARA_CODIGO_PADRAO}).`).optional()]))).strict();
    const d = z.object({ calc_icms_desonerado: z.boolean().optional(), financial_freeze_scope: z.enum(["organization", "farm"]).optional(), [PARAMETRO_MASCARAS_CODIGO]: mascaras.optional() }).passthrough().parse(req.body);
    // A marca de origem (GO-LIVE-01) é quem diz ao seed demo onde ele pode escrever. Pela tela, ela só pode
    // voltar como veio (a tela reenvia o objeto inteiro); qualquer mudança é recusada, nunca ignorada.
    if (CHAVE_ORIGEM_SEED in d) {
      const atual = (await ctx.tx.query<{ v: unknown }>("select parameters->$2 as v from erp.organizations where id=$1", [ctx.orgId, CHAVE_ORIGEM_SEED])).rows[0]?.v ?? null;
      if (JSON.stringify(d[CHAVE_ORIGEM_SEED] ?? null) !== JSON.stringify(atual)) throw validation(`O parâmetro "${CHAVE_ORIGEM_SEED}" não pode ser alterado.`);
    }
    await ctx.tx.query("update erp.organizations set parameters = parameters || $2::jsonb where id=$1", [ctx.orgId, JSON.stringify(d)]);
    await audit(ctx.tx, ctx, "organizations", ctx.orgId, "update", d);
    return d;
  }));

  // ---------- Favoritos ----------
  app.put("/admin/favorites", async (req) => runService(app, req, null, async (ctx) => {
    const d = z.array(z.object({ route: z.string().min(1), label: z.string().min(1) })).max(30).parse(req.body);
    await ctx.tx.query("delete from erp.user_favorites where user_id=$1 and organization_id=$2", [ctx.user.id, ctx.orgId]);
    for (const [i, f] of d.entries()) await ctx.tx.query("insert into erp.user_favorites(user_id,organization_id,route,label,position) values ($1,$2,$3,$4,$5)", [ctx.user.id, ctx.orgId, f.route, f.label, i]);
    return d;
  }));

  // ---------- Notificações ----------
  // A autorização entra ANTES do LIMIT: filtrar depois devolveria "as 50 mais recentes da organização,
  // menos as proibidas" — que para um usuário restrito podem ser três. O contrato é "as 50 mais recentes
  // ENTRE AS QUE ELE PODE VER". `lida` vem do recibo do USUÁRIO, não do read_at legado.
  app.get("/admin/notifications", async (req) => runService(app, req, null, async (ctx) => {
    const p: unknown[] = [];
    const visivel = visibilidadeNotificacaoSql(ctx, "n", p);
    const usuario = `$${p.push(ctx.user.id)}`;
    const r = await ctx.tx.query(
      `select n.id, n.kind, n.title, n.body, n.route, n.created_at,
              (l.usuario_id is not null) as read,
              l.lida_em as read_at
         from erp.notifications n
         left join erp.notificacao_leituras l
           on l.organization_id = n.organization_id and l.notificacao_id = n.id and l.usuario_id = ${usuario}
        where ${visivel}
        order by n.created_at desc limit 50`, p);
    // `read` por item é APRESENTAÇÃO (o ponto na linha do menu); o CONTADOR não se deriva dele — a caixa é
    // truncada em 50 e quem tem 80 não lidas precisa ver 80. Por isso o número vem da autoridade única.
    const naoLidas = await contarNaoLidas(ctx);
    return { items: r.rows, unread: naoLidas.total, unreadTruncado: naoLidas.truncado };
  }));
  // Marca como lidas só as que ELE vê e ainda não leu — set-based, sem tocar na leitura de mais ninguém.
  app.post("/admin/notifications/read-all", async (req) => runService(app, req, null, async (ctx) => {
    const p: unknown[] = [];
    const visivel = visibilidadeNotificacaoSql(ctx, "n", p);
    const usuario = `$${p.push(ctx.user.id)}`;
    const r = await ctx.tx.query(
      `insert into erp.notificacao_leituras (organization_id, notificacao_id, usuario_id)
       select n.organization_id, n.id, ${usuario} from erp.notifications n where ${visivel}
       on conflict do nothing`, p);
    return { ok: true, marcadas: r.rowCount ?? 0 };
  }));
  // Antes de gravar o recibo é preciso PROVAR que a notificação é visível: sem isso, qualquer usuário
  // marcava qualquer linha da organização (inclusive de empresa proibida) e confirmava a existência dela.
  app.post("/admin/notifications/:id/read", async (req) => runService(app, req, null, async (ctx) => {
    const p: unknown[] = [];
    const visivel = visibilidadeNotificacaoSql(ctx, "n", p);
    const id = `$${p.push((req.params as { id: string }).id)}`;
    const r = await ctx.tx.query(`select n.id from erp.notifications n where ${visivel} and n.id = ${id}`, p);
    if (!r.rowCount) throw notFound("Notificação");   // 404, não 403: nada a revelar sobre existência
    await ctx.tx.query(
      "insert into erp.notificacao_leituras (organization_id, notificacao_id, usuario_id) values ($1,$2,$3) on conflict do nothing",
      [ctx.orgId, (req.params as { id: string }).id, ctx.user.id]);
    return { ok: true };
  }));
  /** Gera notificações derivadas do estado atual (compras pendentes, estoque mínimo, títulos vencendo, aniversariantes, documentos vencendo). Idempotente por dia. */
  /**
   * Gera as notificações derivadas do estado atual. Cada linha nasce CLASSIFICADA (escopo, módulo,
   * empresa, capacidade) — nenhuma nasce ambígua para ser autorizada por omissão depois. Idempotente
   * no dia, com a empresa dentro da chave de deduplicação.
   */
  // Exige capacidade: a geração varre a organização INTEIRA e materializa linhas para todas as empresas.
  // Com a porta aberta (`permission: null`), um membro sem permissão nenhuma disparava as cinco varreduras
  // e media o tempo de resposta — que cresce com o volume de pendências de empresas que ele não enxerga.
  // O botão que dispara isto vive na tela de administração de notificações, onde a capacidade já é a regra.
  app.post("/admin/notifications/refresh", async (req) => runService(app, req, "notifications.view", async (ctx) => {
    // A deduplicação é "procura e insere": duas execuções simultâneas (o app chama isto ao abrir a caixa,
    // e duas abas abrem juntas) passam as duas pela procura vazia e inserem a mesma linha. Uma trava por
    // organização serializa as gerações sem prender o resto do banco.
    await ctx.tx.query("select pg_advisory_xact_lock(hashtext($1 || ':notificacoes'))", [ctx.orgId]);

    // Compras: a solicitação nasce numa empresa concreta -> escopo de empresa.
    // Duas exclusoes, pela mesma razao — nao gerar aviso que ninguem consegue ler:
    //  - `r.deleted_at is null`: solicitacao logicamente excluida nao existe para as rotas oficiais
    //    (apps/api/src/routes/supply.ts) e nao pode continuar rendendo alerta diario;
    //  - empresa ATIVA: `erp.tem_acesso_empresa` exige `deleted_at is null` e o ramo `empresa` da leitura
    //    chama essa funcao SEM atalho de proprietario, entao um aviso de empresa desativada nasce invisivel
    //    para todos — inclusive para o dono — e volta a nascer todo dia. Mesmo cuidado que a consulta de
    //    documentos ja tem logo abaixo.
    const pend = await ctx.tx.query<{ code: string; id: string; days: number; empresa_id: string; current_responsible_user_id: string | null }>(
      `select r.code, r.id, r.empresa_id, extract(day from now()-r.status_changed_at)::int as days, r.current_responsible_user_id
         from erp.purchase_requests r
         join erp.empresas f on f.id = r.empresa_id and f.deleted_at is null
        where r.organization_id=$1 and r.deleted_at is null
          and r.status not in ('finished','cancelled') and r.status_changed_at < now() - interval '3 days'`, [ctx.orgId]);
    for (const p of pend.rows) {
      // O responsavel e apenas PEDIDO: quem decide se ele fica como destinatario e `criarNotificacao`, que
      // pergunta as duas autoridades do banco (capacidade E escopo) e rebaixa para difusao se ele nao veria
      // a linha. Checar so o escopo aqui — como se fazia — deixava o aviso morto quando faltava a capacidade.
      await criarNotificacao(ctx, { kind: "purchase_pending", title: `Compras nº ${p.code} pendente há ${p.days} dia(s)`,
        route: `/suprimentos/view/${p.id}`, userId: p.current_responsible_user_id, empresaId: p.empresa_id,
        entidadeOrigem: "purchase_requests", idOrigem: p.id });
    }

    // Estoque mínimo: `products.min_stock` é cadastro da ORGANIZAÇÃO e o saldo somado é de todos os
    // armazéns. O número é agregado organizacional do módulo — quem tem `selecionadas` não o consolida.
    const low = await ctx.tx.query<{ description: string; id: string }>("select p.description, p.id from erp.products p where p.organization_id=$1 and p.min_stock > 0 and coalesce((select sum(quantity) from erp.stock_balances sb where sb.product_id=p.id),0) <= p.min_stock and p.deleted_at is null", [ctx.orgId]);
    for (const l of low.rows) {
      await criarNotificacao(ctx, { kind: "stock_min", title: `Estoque mínimo atingido: ${l.description}`,
        route: `/estoque?tab=estoque&sub=saldo&product_id=${l.id}`, entidadeOrigem: "products", idOrigem: l.id });
    }

    // Títulos vencendo: DUAS correções de semântica no mesmo lugar.
    //  1. a rota leva para CONTAS A PAGAR, então a contagem é de pagar. Antes somava pagar e receber sob
    //     rota e permissão de pagar — número que a permissão exibida não autorizava;
    //  2. a contagem é POR EMPRESA. `financial_titles.empresa_id` é obrigatório, então este número se decompõe
    //     sem mudar de significado — diferente do estoque mínimo, que é cadastro da organização. Um
    //     agregado da organização inteira sumiria para quem tem `selecionadas`, tirando dele um aviso
    //     sobre títulos que ele vê na própria tela de Contas a Pagar.
    const due = await ctx.tx.query<{ n: string; empresa_id: string }>(
      `select count(*) n, empresa_id from erp.financial_titles
        where organization_id=$1 and direction='payable' and status in ('open','partially_paid')
          and deleted_at is null and due_date between current_date and current_date + 3
        group by empresa_id`, [ctx.orgId]);
    for (const t of due.rows) {
      await criarNotificacao(ctx, { kind: "title_due", title: `${t.n} título(s) a pagar vencendo nos próximos 3 dias`,
        route: "/financeiro?tab=contas&sub=pagar&due_soon=1", empresaId: t.empresa_id, dedupe: `title_due:${t.empresa_id}` });
    }

    // Aniversário: cadastro de pessoas da organização, sem dimensão de empresa.
    const bday = await ctx.tx.query<{ name: string; id: string; birthday: string }>("select p.name, p.id, e.birthday from erp.employee_profiles e join erp.people p on p.id=e.person_id where p.organization_id=$1 and e.is_active and to_char(e.birthday,'MM-DD')=to_char(current_date,'MM-DD')", [ctx.orgId]);
    for (const b of bday.rows) {
      await criarNotificacao(ctx, { kind: "birthday", title: `${b.name} está fazendo aniversário hoje`,
        route: "/pessoas?tab=pessoas&role=employee", dedupe: `birthday:${b.id}`, entidadeOrigem: "people", idOrigem: b.id });
    }

    // Documento: a empresa é ANULÁVEL. Com empresa, é aviso daquela empresa; sem empresa, é da
    // organização — e esconder o documento institucional de quem tem a capacidade seria o erro inverso.
    // Empresa desativada é excluída na origem: `erp.tem_acesso_empresa` exige `deleted_at is null`, então
    // o aviso de um documento dela nasceria invisível para todo mundo — inclusive para o proprietário —
    // e se acumularia um por dia, sem ninguém poder lê-lo nem marcá-lo como lido.
    const docs = await ctx.tx.query<{ title: string; id: string; empresa_id: string | null }>(
      `select d.title, d.id, d.empresa_id from erp.documents d
        where d.organization_id=$1 and d.status='active' and d.expiration_date between current_date and current_date + 15
          and (d.empresa_id is null or exists (select 1 from erp.empresas f where f.id=d.empresa_id and f.deleted_at is null))`, [ctx.orgId]);
    for (const d of docs.rows) {
      await criarNotificacao(ctx, { kind: "document_expiring", title: `Documento vencendo: ${d.title}`,
        route: `/cadastros/documents/${d.id}`, empresaId: d.empresa_id,
        ...(d.empresa_id ? {} : { escopoOverride: "organizacao" as const }),
        entidadeOrigem: "documents", idOrigem: d.id });
    }
    return { ok: true };
  }));

  // ---------- Auditoria ----------
  app.get("/admin/audit", async (req) => runService(app, req, "audit_logs.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
    // colunas com alias: a leitura ganhou um join no índice global e `entity` sem prefixo viraria ambíguo
    const where = ["a.organization_id=$1"]; const params: unknown[] = [ctx.orgId];
    if (f.entity) { params.push(f.entity); where.push(`a.entity=$${params.length}`); }
    if (f.entity_id) { params.push(f.entity_id); where.push(`a.entity_id=$${params.length}`); }
    if (f.user_id) { params.push(f.user_id); where.push(`a.user_id=$${params.length}`); }
    if (f.created_at_from) { params.push(f.created_at_from); where.push(`a.created_at >= $${params.length}`); }
    if (f.created_at_to) { params.push(f.created_at_to); where.push(`a.created_at < ($${params.length}::date + 1)`); }
    const total = await ctx.tx.query<{ n: string }>(`select count(*) n from erp.audit_logs a where ${where.join(" and ")}`, params);
    // `audit_logs.id` é um bigint PRÓPRIO da auditoria e NÃO é ID Global: exibi-lo com "#" confundiria dois
    // identificadores que crescem no mesmo formato e nunca coincidem. O ID Global do registro auditado vem
    // por LEFT JOIN no índice central, no momento da leitura — copiá-lo para dentro do log envelheceria
    // (o número é do registro, não do evento) e obrigaria a reescrever milhões de linhas no backfill.
    // Evento técnico, ou de entidade fora do catálogo, simplesmente não tem ID Global: `null`, sem invenção.
    // `audit_logs.entity_id` é TEXTO (a auditoria registra eventos de coisas que nem sempre têm UUID), então
    // a junção compara `id_entidade::text`: converter o lado do TEXTO para uuid explodiria no primeiro
    // evento técnico cujo identificador não é um UUID.
    const r = await ctx.tx.query(`select a.id,a.entity,a.entity_id,a.action,a.before,a.after,a.metadata,a.ip,a.created_at,u.name as user_name,
        g.id_global as id_global
      from erp.audit_logs a
      left join erp.users u on u.id=a.user_id
      left join erp.registros_globais g on g.organization_id = a.organization_id and g.tipo_entidade = a.entity and g.id_entidade::text = a.entity_id
      where ${where.join(" and ")} order by a.id desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return { items: r.rows, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize };
  }));

  // ---------- Perfil do usuário ----------
  app.put("/admin/profile", async (req) => runService(app, req, null, async (ctx) => {
    const d = z.object({ name: z.string().min(1).optional(), phone: z.string().optional().nullable(), password: z.string().min(8).optional(), current_password: z.string().optional() }).parse(req.body);
    if (d.password) {
      if (app.config.AUTH_MODE === "local") {
        const u = await ctx.tx.query<{ password_hash: string | null }>("select password_hash from erp.users where id=$1", [ctx.user.id]);
        if (!d.current_password || !u.rows[0]?.password_hash || !(await bcrypt.compare(d.current_password, u.rows[0].password_hash))) throw denied("senha atual inválida");
        await ctx.tx.query("update erp.users set password_hash=$2 where id=$1", [ctx.user.id, await bcrypt.hash(d.password, 10)]);
        // Evento de segurança, como a mudança de escopo: ator, horário e IP. SEM metadata e SEM antes/depois
        // — a senha e o hash não entram na trilha, e não há nada além do fato a registrar.
        await audit(ctx.tx, ctx, "users", ctx.user.id, "password_change");
      } else throw validation("Troca de senha é feita pelo Supabase Auth");
    }
    await ctx.tx.query("update erp.users set name=coalesce($2,name), phone=coalesce($3,phone) where id=$1", [ctx.user.id, d.name ?? null, d.phone ?? null]);
    return { ok: true, can: hasPermission(ctx, "users.view") };
  }));
}
