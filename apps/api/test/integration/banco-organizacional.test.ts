import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * SALDO, FLUXO E EXTRATO DE CONTA BANCÁRIA SÃO NÚMEROS DA ORGANIZAÇÃO (PRE-BASE2-03, correção).
 *
 * O contrato está escrito em `docs/AUTHORIZATION.md` e em `docs/MULTI-COMPANY-CONTRACT.md` §7: a conta é
 * cadastro da ORGANIZAÇÃO, o `opening_balance` dela não tem empresa, e por isso as três portas exigem a
 * capacidade de organização (`bank_accounts.view`) por cima da permissão financeira.
 *
 * A RLS empresarial quase transformou esse contrato num número falso. `erp.bank_movements` tem empresa e
 * virou company-scoped — corretamente. Mas as rotas de CONTA abrem a transação SEM módulo, e sem módulo o
 * recorte vale a UNIÃO das empresas do membro. O efeito não é um erro, é pior:
 *
 *     opening_balance (organização) 100  +  movimento da empresa A 10  =  110
 *     …e o movimento de 20 da empresa B simplesmente não aparece. O extrato do banco diz 130.
 *
 * Um saldo negado alguém investiga. Um saldo ERRADO ninguém questiona — ele só aparece na conciliação, meses
 * depois. Este arquivo fixa o número certo e, no mesmo fôlego, fixa que a correção NÃO afrouxou a RLS:
 * a listagem normal de movimentos continua recortada por empresa.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let CONTA = ""; let tokenParcial = ""; let OUTRA_ORG = "";
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string } };

beforeAll(async () => {
  h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 3 });

  const conta = await admin.query<{ id: string }>(
    "insert into erp.bank_accounts(organization_id,code,description,type,opening_balance) values ($1,'ORG1','Conta da organizacao','checking',100) returning id", [h.demo.orgId]);
  CONTA = conta.rows[0]!.id;
  // Um movimento em CADA empresa: é a diferença entre 110 e 130.
  for (const [empresa, valor, codigo] of [[I.empresa, 10, "ORGM1"], [I.empresa2, 20, "ORGM2"]] as const) {
    await admin.query(
      "insert into erp.bank_movements(organization_id,code,bank_account_id,empresa_id,movement_date,type,category_type,amount,status) values ($1,$2,$3,$4,'2031-03-01','in','in',$5,'confirmed')",
      [h.demo.orgId, codigo, CONTA, empresa, valor]);
  }

  // Membro com as capacidades de conta, mas enxergando só a empresa A no financeiro.
  const hash = (await admin.query<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'")).rows[0]!.password_hash;
  const papel = (await admin.query<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,'[TEST] Conta') returning id", [h.demo.orgId])).rows[0]!.id;
  await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,'bank_accounts.view'),($1,'bank_movements.view'),($1,'cash_flow.view'),($1,'report.bank_statement.view')", [papel]);
  const u = (await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", ["conta-parcial@demo.local", "Conta Parcial", hash])).rows[0]!.id;
  const m = (await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true) returning id", [h.demo.orgId, u, papel])).rows[0]!.id;
  await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,'financeiro','selecionadas')", [h.demo.orgId, m]);
  await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,'financeiro','selecionadas',$3)", [h.demo.orgId, m, I.empresa]);
  tokenParcial = (j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "conta-parcial@demo.local", password: "Demo@12345" } })) as unknown as { token: string }).token;

  // Outra organização com a sua própria conta: o agregado nunca pode enxergá-la.
  const o = await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Outra Banco','outra-banco') returning id");
  OUTRA_ORG = o.rows[0]!.id;
  const c2 = await admin.query<{ id: string }>("insert into erp.bank_accounts(organization_id,code,description,type,opening_balance) values ($1,'X','Conta alheia','checking',5000) returning id", [OUTRA_ORG]);
  await admin.query("insert into erp.bank_movements(organization_id,code,bank_account_id,empresa_id,movement_date,type,category_type,amount,status) values ($1,'X1',$2,null,'2031-03-01','in','in',7777,'confirmed')", [OUTRA_ORG, c2.rows[0]!.id]);
}, 180_000);

afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

const comoParcial = (url: string) => h.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tokenParcial}`, "x-org-id": h.demo.orgId } });

describe("o número da conta é da ORGANIZAÇÃO, mesmo para quem enxerga uma empresa só", () => {
  it("saldo = 100 + 10 + 20 = 130, e não 110", async () => {
    const r = await comoParcial("/api/financial/bank-accounts/balances");
    expect(r.statusCode, JSON.stringify(j(r))).toBe(200);
    const conta = j(r).items!.find((x) => x["id"] === CONTA)!;
    expect(Number(conta["balance"]), "o movimento da empresa que o membro não enxerga também é da conta").toBe(130);
  });

  it("fluxo de caixa fecha no mesmo número", async () => {
    const r = await comoParcial(`/api/financial/cash-flow?account_ids=${CONTA}&start_date=2031-01-01&end_date=2031-12-31&period=monthly`);
    expect(r.statusCode, JSON.stringify(j(r))).toBe(200);
    expect(Number(j(r)["opening_balance"]), "antes do período: só o saldo inicial da conta").toBe(100);
    expect(Number(j(r)["closing_balance"])).toBe(130);
  });

  it("o extrato lista os DOIS movimentos e fecha em 130", async () => {
    const r = await h.app.inject({
      method: "GET", url: `/api/reports/bank_statement?bank_account_id=${CONTA}&start_date=2031-01-01&end_date=2031-12-31`,
      headers: { authorization: `Bearer ${tokenParcial}`, "x-org-id": h.demo.orgId }
    });
    expect(r.statusCode, JSON.stringify(j(r))).toBe(200);
    const linhas = j(r).items ?? (j(r)["rows"] as Record<string, unknown>[]);
    expect(linhas.length, "um extrato que esconde lançamento não reconcilia").toBe(2);
    expect(Number(linhas[linhas.length - 1]!["balance"])).toBe(130);
  });
});

describe("a correção NÃO afrouxou a RLS", () => {
  it("a listagem normal de movimentos continua recortada por empresa", async () => {
    const r = await comoParcial("/api/financial/bank-movements?pageSize=100");
    expect(r.statusCode).toBe(200);
    const doTeste = (j(r).items ?? []).filter((x) => x["bank_account_id"] === CONTA);
    expect(doTeste.length, "aqui o recorte por empresa vale — é leitura de movimento, não agregado de conta").toBe(1);
  });

  it("o agregado organizacional nunca atravessa o tenant", async () => {
    const r = await comoParcial("/api/financial/bank-accounts/balances");
    const ids = (j(r).items ?? []).map((x) => x["id"]);
    const alheia = await admin.query<{ id: string }>("select id from erp.bank_accounts where organization_id=$1", [OUTRA_ORG]);
    for (const c of alheia.rows) expect(ids).not.toContain(c.id);
    // E o número tem de bater com a verdade DESTA organização, calculada sem RLS pelo pool administrativo.
    const esperado = await admin.query<{ v: string }>(
      `select coalesce(sum(a.opening_balance),0) + coalesce((select sum(case when m.type='in' then m.amount+m.interest else -(m.amount+m.interest) end)
         from erp.bank_movements m join erp.bank_accounts b on b.id=m.bank_account_id
        where b.organization_id=$1 and b.deleted_at is null and b.is_active and m.status='confirmed' and m.deleted_at is null),0) as v
         from erp.bank_accounts a where a.organization_id=$1 and a.deleted_at is null and a.is_active`, [h.demo.orgId]);
    const soma = (j(r).items ?? []).reduce((s, x) => s + Number(x["balance"]), 0);
    expect(soma, "nem a mais (vazamento) nem a menos (recorte indevido)").toBe(Number(esperado.rows[0]!.v));
  });

  it("sem a capacidade de ORGANIZAÇÃO, a porta continua fechada", async () => {
    // O operador tem permissões financeiras, mas não `bank_accounts.view`.
    const r = await h.app.inject({ method: "GET", url: "/api/financial/bank-accounts/balances", headers: h.opHeaders() });
    expect(r.statusCode).toBe(403);
  });
});
