import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db, type DemoOrg } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-05 · BANCO (0033) — TR-B.
 * erp.tipos_operacao_versao_condicoes (imutável, RLS de tenant, FKs compostas) e a porta estreita
 * erp.situacao_atraso_cliente (SECURITY DEFINER; org/usuário só da GUC; capacidade reconferida dentro: pelo menos uma das
 * seis — budgets/orders/sales .create ou .edit).
 * SQL direto: `admin` = superusuário (fixtures); `h.db` = erp_app (sem bypass de RLS), como a API.
 */
let h: Harness; let admin: Db; let outra: DemoOrg;
const um = async <T>(sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows[0] as T;
const TABELA = "erp.tipos_operacao_versao_condicoes";

type Linha = { titulos: number; total: string; vencimento_mais_antigo: string | null };
/** Chama a porta como a API chama: conexão erp_app, GUC por transação. */
async function situacao(org: string | null, user: string | null, cliente: string, tolerancia: number): Promise<Linha[]> {
  const cli = await h.db.connect();
  try {
    await cli.query("begin");
    if (org) await cli.query("select set_config('app.org_id',$1,true)", [org]);
    if (user) await cli.query("select set_config('app.user_id',$1,true)", [user]);
    const r = await cli.query<Linha>(
      "select titulos, total::text as total, vencimento_mais_antigo::text as vencimento_mais_antigo from erp.situacao_atraso_cliente($1,$2)",
      [cliente, tolerancia]);
    await cli.query("rollback");
    return r.rows;
  } finally { cli.release(); }
}

async function usuarioComPapel(org: string, email: string, permissoes: string[]): Promise<string> {
  const papel = (await um<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [org, `[TEST] ${email}`])).id;
  for (const p of permissoes) await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2)", [papel, p]);
  const u = (await um<{ id: string }>("insert into erp.users(email,name) values ($1,$2) returning id", [email, email])).id;
  await admin.query("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true)", [org, u, papel]);
  return u;
}

let seq = 0;
/** TOP + versão 1 por SQL direto (superusuário): a demo não semeia TOP e a tabela nova só precisa da âncora. */
async function novaVersao(org: string): Promise<{ id: string; tipo_operacao_id: string }> {
  seq += 1;
  // Um único comando: a FK tipos_operacao → versão atual só fecha com as duas linhas.
  return um<{ id: string; tipo_operacao_id: string }>(
    `with t as (insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,'vendas.pedido') returning id)
     insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) select $1, t.id, 1, 'TOP B1' from t returning id, tipo_operacao_id`,
    [org, `B1T${seq}${Math.random().toString(36).slice(2, 6)}`]);
}
async function titulo(o: { org: string; empresa: string; pessoa: string; direcao?: string; status?: string; valor: string; pago?: string; desconto?: string; venceHa: number; excluido?: boolean }) {
  seq += 1;
  await admin.query(
    `insert into erp.financial_titles (organization_id, empresa_id, code, direction, number, person_id, amount, discount, paid_amount, status, emission_date, due_date, deleted_at)
     values ($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10,current_date - 60, current_date - $11::int, case when $12 then now() else null end)`,
    [o.org, o.empresa, `TB${seq}-${Math.random().toString(36).slice(2, 8)}`, o.direcao ?? "receivable", `N${seq}`, o.pessoa, o.valor, o.desconto ?? "0", o.pago ?? "0", o.status ?? "open", o.venceHa, o.excluido ?? false]);
}

let clienteA = ""; let clienteB = ""; let clienteVazio = ""; let comPedido = ""; let semVenda = "";

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 });
  outra = await seedDemo(admin, { slug: "top05-b1-outra", orgName: "Outra TOP05 B1", adminEmail: "outra-top05-b1@demo.local" }, () => {});
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("TR-B tabela erp.tipos_operacao_versao_condicoes", () => {
  it("TR-B nasce vazia (a migration não grava dados, e o seed também não)", async () => {
    expect((await um<{ n: string }>(`select count(*)::text as n from ${TABELA}`)).n).toBe("0");
  });

  it("TR-B RLS habilitada e FORÇADA, com política ÚNICA tenant_isolation", async () => {
    const c = await um<{ rls: boolean; forca: boolean }>("select relrowsecurity as rls, relforcerowsecurity as forca from pg_class where oid = $1::regclass", [TABELA]);
    expect(c).toEqual({ rls: true, forca: true });
    const pol = (await admin.query<{ policyname: string }>("select policyname from pg_policies where schemaname='erp' and tablename='tipos_operacao_versao_condicoes'")).rows.map((r) => r.policyname);
    expect(pol).toEqual(["tenant_isolation"]);
  });

  it("TR-B erp_app: select/insert sim, update/delete negados; gatilho recusa update/delete até para o superusuário", async () => {
    const priv = await um<Record<string, boolean>>(
      `select has_table_privilege('erp_app',$1,'select') as s, has_table_privilege('erp_app',$1,'insert') as i,
              has_table_privilege('erp_app',$1,'update') as u, has_table_privilege('erp_app',$1,'delete') as d`, [TABELA]);
    expect(priv).toEqual({ s: true, i: true, u: false, d: false });

    const v = await novaVersao(h.demo.orgId);
    const cond = (await um<{ id: string }>("insert into erp.condicoes_pagamento (organization_id, code, nome) values ($1,$2,$3) returning id", [h.demo.orgId, `B1-${Math.random()}`, `B1 ${Math.random()}`])).id;

    const cli = await h.db.connect();
    let linhaId = "";
    try {
      await cli.query("begin");
      await cli.query("select set_config('app.org_id',$1,true)", [h.demo.orgId]);
      const ins = await cli.query<{ id: string }>(
        `insert into ${TABELA} (organization_id, origem_versao_id, origem_tipo_operacao_id, condicao_pagamento_id) values ($1,$2,$3,$4) returning id`,
        [h.demo.orgId, v.id, v.tipo_operacao_id, cond]);
      expect(ins.rowCount).toBe(1);
      linhaId = ins.rows[0]!.id;
      expect((await cli.query(`select id from ${TABELA} where id=$1`, [linhaId])).rowCount).toBe(1);
      await cli.query("commit");

      // Outra organização (erp_app) não enxerga nem insere para a demo.
      await cli.query("begin");
      await cli.query("select set_config('app.org_id',$1,true)", [outra.orgId]);
      expect((await cli.query(`select id from ${TABELA} where id=$1`, [linhaId])).rowCount).toBe(0);
      await expect(cli.query(`insert into ${TABELA} (organization_id, origem_versao_id, origem_tipo_operacao_id, condicao_pagamento_id) values ($1,$2,$3,$4)`,
        [h.demo.orgId, v.id, v.tipo_operacao_id, cond])).rejects.toMatchObject({ code: "42501" });
      await cli.query("rollback");

      await cli.query("begin");
      await cli.query("select set_config('app.org_id',$1,true)", [h.demo.orgId]);
      await expect(cli.query(`update ${TABELA} set criado_em = now() where id=$1`, [linhaId])).rejects.toMatchObject({ code: "42501" });
      await cli.query("rollback");
      await cli.query("begin");
      await cli.query("select set_config('app.org_id',$1,true)", [h.demo.orgId]);
      await expect(cli.query(`delete from ${TABELA} where id=$1`, [linhaId])).rejects.toMatchObject({ code: "42501" });
      await cli.query("rollback");
    } finally { cli.release(); }

    await expect(admin.query(`update ${TABELA} set criado_em = now() where id=$1`, [linhaId])).rejects.toThrow(/TIPO_OPERACAO_CONDICAO_IMUTAVEL/);
    await expect(admin.query(`delete from ${TABELA} where id=$1`, [linhaId])).rejects.toThrow(/TIPO_OPERACAO_CONDICAO_IMUTAVEL/);
    expect((await um<{ n: string }>(`select count(*)::text as n from ${TABELA} where id=$1`, [linhaId])).n).toBe("1");

    // unique (versão, condição)
    await expect(admin.query(`insert into ${TABELA} (organization_id, origem_versao_id, origem_tipo_operacao_id, condicao_pagamento_id) values ($1,$2,$3,$4)`,
      [h.demo.orgId, v.id, v.tipo_operacao_id, cond])).rejects.toMatchObject({ code: "23505", constraint: "uq_tipos_operacao_versao_condicoes" });
  });

  it("TR-B FK composta recusa condição de OUTRA organização e versão de outra TOP / outra organização", async () => {
    const v1 = await novaVersao(h.demo.orgId); const v2 = await novaVersao(h.demo.orgId); const vOutra = await novaVersao(outra.orgId);
    const nova = async (org: string) => (await um<{ id: string }>("insert into erp.condicoes_pagamento (organization_id, code, nome) values ($1,$2,$3) returning id", [org, `B1F-${Math.random()}`, `B1F ${Math.random()}`])).id;
    const condDemo = await nova(h.demo.orgId); const condOutra = await nova(outra.orgId);
    const ins = (org: string, versao: string, top: string, cond: string) => admin.query(
      `insert into ${TABELA} (organization_id, origem_versao_id, origem_tipo_operacao_id, condicao_pagamento_id) values ($1,$2,$3,$4)`, [org, versao, top, cond]);

    await expect(ins(h.demo.orgId, v1.id, v1.tipo_operacao_id, condOutra)).rejects.toMatchObject({ code: "23503", constraint: "fk_tipos_operacao_versao_condicoes_condicao" });
    await expect(ins(h.demo.orgId, v1.id, v2.tipo_operacao_id, condDemo)).rejects.toMatchObject({ code: "23503", constraint: "fk_tipos_operacao_versao_condicoes_origem" });
    await expect(ins(h.demo.orgId, vOutra.id, vOutra.tipo_operacao_id, condDemo)).rejects.toMatchObject({ code: "23503", constraint: "fk_tipos_operacao_versao_condicoes_origem" });
    await expect(ins(outra.orgId, vOutra.id, vOutra.tipo_operacao_id, condDemo)).rejects.toMatchObject({ code: "23503", constraint: "fk_tipos_operacao_versao_condicoes_condicao" });
    // premissa positiva: a combinação coerente entra (a recusa acima é da FK, não do insert em si)
    await expect(ins(h.demo.orgId, v2.id, v2.tipo_operacao_id, condDemo)).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("TR-B função erp.situacao_atraso_cliente (porta estreita)", () => {
  it("TR-B prosecdef, search_path fixo, public sem execute, erp_app com execute", async () => {
    const f = await um<{ sec: boolean; cfg: string[] | null; pub: boolean; app: boolean }>(
      `select p.prosecdef as sec, p.proconfig as cfg,
              has_function_privilege('public','erp.situacao_atraso_cliente(uuid,integer)','execute') as pub,
              has_function_privilege('erp_app','erp.situacao_atraso_cliente(uuid,integer)','execute') as app
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='erp' and p.proname='situacao_atraso_cliente'`);
    expect(f.sec).toBe(true);
    expect(f.cfg).toContain("search_path=erp, pg_temp");
    expect(f.pub).toBe(false);
    expect(f.app).toBe(true);
  });

  describe("agregados", () => {
    beforeAll(async () => {
      const pessoas = (await admin.query<{ id: string }>("select id from erp.people where organization_id=$1 and deleted_at is null order by id limit 3", [h.demo.orgId])).rows.map((r) => r.id);
      expect(pessoas.length, "premissa: a demo tem 3 pessoas").toBe(3);
      [clienteA, clienteB, clienteVazio] = pessoas as [string, string, string];
      expect(h.demo.empresaIds.length, "premissa: a demo tem 2 empresas").toBeGreaterThanOrEqual(2);
      const [e1, e2] = h.demo.empresaIds as [string, string];
      const org = h.demo.orgId;
      // CONTAM (tolerância 3): empresa 1 e empresa 2, aberto e parcialmente pago, e o limite de um dia além (−4).
      await titulo({ org, empresa: e1, pessoa: clienteA, valor: "100.10", venceHa: 10 });
      await titulo({ org, empresa: e2, pessoa: clienteA, status: "partially_paid", valor: "200.00", pago: "50.05", venceHa: 5 });
      await titulo({ org, empresa: e1, pessoa: clienteA, valor: "0.03", venceHa: 4 });
      // NÃO CONTAM
      await titulo({ org, empresa: e1, pessoa: clienteA, status: "paid", valor: "30.00", pago: "30.00", venceHa: 20 });
      await titulo({ org, empresa: e1, pessoa: clienteA, status: "cancelled", valor: "40.00", venceHa: 20 });
      await titulo({ org, empresa: e2, pessoa: clienteA, valor: "50.00", venceHa: 20, excluido: true });
      await titulo({ org, empresa: e1, pessoa: clienteA, direcao: "payable", valor: "60.00", venceHa: 20 });
      await titulo({ org, empresa: e1, pessoa: clienteA, valor: "10.00", desconto: "10.00", venceHa: 20 });
      await titulo({ org, empresa: e1, pessoa: clienteB, valor: "70.00", venceHa: 20 });
      await titulo({ org: outra.orgId, empresa: outra.empresaIds[0]!, pessoa: clienteA, valor: "90.00", venceHa: 20 });
      // limite: vencimento = hoje − tolerância (3) NÃO conta com tolerância 3; conta com tolerância 0.
      await titulo({ org, empresa: e2, pessoa: clienteA, valor: "80.00", venceHa: 3 });

      comPedido = await usuarioComPapel(org, "top05-b1-pedido@demo.local", ["orders.create"]);
      semVenda = await usuarioComPapel(org, "top05-b1-sem-venda@demo.local", []);
    });

    it("TR-B soma as DUAS empresas, numeric exato, vencimento mais antigo; exclui pagos/cancelados/excluídos/a pagar/saldo 0/outro cliente/outra org/limite", async () => {
      const esperadoMaisAntigo = (await um<{ d: string }>("select (current_date - 10)::text as d")).d;
      expect(await situacao(h.demo.orgId, comPedido, clienteA, 3)).toEqual([{ titulos: 3, total: "250.08", vencimento_mais_antigo: esperadoMaisAntigo }]);
      // dono também passa pela porta
      expect(await situacao(h.demo.orgId, h.demo.adminUserId, clienteA, 3)).toEqual([{ titulos: 3, total: "250.08", vencimento_mais_antigo: esperadoMaisAntigo }]);
      // tolerância 0: o de "hoje − 3" passa a contar (due_date < current_date − tolerância)
      expect(await situacao(h.demo.orgId, comPedido, clienteA, 0)).toEqual([{ titulos: 4, total: "330.08", vencimento_mais_antigo: esperadoMaisAntigo }]);
      // tolerância 365 (máximo) é aceita: autorizada, uma linha, nada vencido além disso
      expect(await situacao(h.demo.orgId, comPedido, clienteA, 365)).toEqual([{ titulos: 0, total: "0", vencimento_mais_antigo: null }]);
      // cliente sem título: UMA linha zerada
      expect(await situacao(h.demo.orgId, comPedido, clienteVazio, 0)).toEqual([{ titulos: 0, total: "0", vencimento_mais_antigo: null }]);
      // outro cliente só vê o seu
      expect(await situacao(h.demo.orgId, comPedido, clienteB, 3)).toEqual([{ titulos: 1, total: "70.00", vencimento_mais_antigo: (await um<{ d: string }>("select (current_date - 20)::text as d")).d }]);
      // a outra organização, pela GUC dela, só enxerga o título dela para o mesmo id de pessoa
      expect(await situacao(outra.orgId, outra.adminUserId, clienteA, 3)).toEqual([{ titulos: 1, total: "90.00", vencimento_mais_antigo: (await um<{ d: string }>("select (current_date - 20)::text as d")).d }]);
    });

    it("TR-B sem nenhuma das seis (budgets/orders/sales .create ou .edit) → zero linhas", async () => {
      expect(await situacao(h.demo.orgId, semVenda, clienteA, 3)).toEqual([]);
      // membro de OUTRA organização com a GUC desta → não é membro aqui → zero linhas
      expect(await situacao(h.demo.orgId, outra.adminUserId, clienteA, 3)).toEqual([]);
    });

    it("TR-B tolerância −1 ou 366 → zero linhas (nunca amplia)", async () => {
      expect(await situacao(h.demo.orgId, comPedido, clienteA, -1)).toEqual([]);
      expect(await situacao(h.demo.orgId, comPedido, clienteA, 366)).toEqual([]);
    });

    it("TR-B sem GUC de organização (ou de usuário) → zero linhas", async () => {
      expect(await situacao(null, comPedido, clienteA, 3)).toEqual([]);
      expect(await situacao(h.demo.orgId, null, clienteA, 3)).toEqual([]);
    });
  });
});
