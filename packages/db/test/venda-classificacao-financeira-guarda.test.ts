import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O QUE A 0024 PROMETEU, PROVADO CONTRA O BANCO (VENDAS-A1).
 *
 * A1-D1 — a classificação do documento só aponta para cadastro da PRÓPRIA organização, e anda em PAR. As duas
 * coisas são do banco, não só da API: uma FK de coluna única provaria que a categoria existe, não que é do
 * tenant do documento; e meio par obrigaria a confirmação a completar a outra metade pela ordem do código.
 *
 * A1-D2 — a GUARDA: venda classificada NUNCA entra em confirmed/invoiced por um binário que ignora a
 * classificação. "Um binário que ignora" é modelado como ele é na vida real: uma transação do papel da
 * aplicação (`erp_app_test`, sem bypass de RLS) que move o status SEM gravar a marca
 * `app.venda_classificacao_financeira` — é o que o binário anterior à VENDAS-A1 faz, porque não sabe que ela
 * existe. E a contraprova, sem a qual o gatilho poderia estar recusando TUDO: venda sem classificação,
 * faturamento de venda já confirmada e cancelamento passam sem marca.
 */
let db: Db; let app: Db; let demo: DemoOrg; let outraOrg: string;
let catOk: string; let ccOk: string; let catVizinha: string; let ccVizinho: string;
beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  // A URL do papel é MONTADA, não trocada por texto: `TEST_URL` traz `postgres:postgres@`, e um replace de
  // "postgres@" viraria `postgres:erp_app_test:erp_app_test@` — o superusuário, que ignora a RLS.
  const urlApp = new URL(TEST_URL); urlApp.username = "erp_app_test"; urlApp.password = "erp_app_test";
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? urlApp.toString(), { max: 3 });
  // A premissa de toda a suíte: quem move o status é o papel da aplicação, não o superusuário.
  expect((await app.query<{ u: string }>("select current_user as u")).rows[0]!.u).toBe("erp_app_test");
  outraOrg = (await db.query<{ id: string }>("insert into erp.organizations(name) values ('[TEST] vizinha A1-D') returning id")).rows[0]!.id;
  const cat = async (org: string, code: string) => (await db.query<{ id: string }>(
    "insert into erp.financial_categories(organization_id,code,name,nature,kind) values ($1,$2,$3,'income','analytic') returning id", [org, code, `Cat ${code}`])).rows[0]!.id;
  const cc = async (org: string, code: string) => (await db.query<{ id: string }>(
    "insert into erp.cost_centers(organization_id,code,name,kind) values ($1,$2,$3,'analytic') returning id", [org, code, `CC ${code}`])).rows[0]!.id;
  catOk = await cat(demo.orgId, "9.D.1"); ccOk = await cc(demo.orgId, "9.D.1");
  catVizinha = await cat(outraOrg, "9.D.1"); ccVizinho = await cc(outraOrg, "9.D.1");
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

let seq = 0;
/** Venda aberta inserida direto (como o superusuário de migração monta cenário). */
async function venda(par: { cat: string | null; cc: string | null } = { cat: null, cc: null }): Promise<string> {
  seq += 1;
  const empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  const cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client limit 1", [demo.orgId])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, categoria_financeira_id, centro_custo_id)
     values ($1,$2,'sale',$3,'2026-09-01',$4,$5,$6) returning id`,
    [demo.orgId, empresa, `A1D-${seq}`, cliente, par.cat, par.cc])).rows[0]!.id;
}
const classificada = () => venda({ cat: catOk, cc: ccOk });

/** Move o status como o PAPEL DA APLICAÇÃO move, com ou sem a marca da classificação. */
async function moverComoApp(id: string, status: string, marca: string | null): Promise<void> {
  await withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "vendas" }, async (tx) => {
    if (marca !== null) await tx.query("select set_config('app.venda_classificacao_financeira', $1, true)", [marca]);
    const u = await tx.query("update erp.sales_documents set status=$3 where id=$1 and organization_id=$2", [id, demo.orgId, status]);
    // A premissa: a linha é visível e atualizável para o papel. Sem isto, "passou" poderia ser zero linha.
    expect(u.rowCount, "a venda precisa ser visível para o papel da aplicação").toBe(1);
  });
}
const statusDe = async (id: string) => (await db.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!.status;

describe("A1-D1 — FK composta com o tenant e CHECK do par", () => {
  it("A1-D1 premissa: o par da PRÓPRIA organização grava, no insert e no update", async () => {
    const id = await classificada();
    const sem = await venda();
    expect((await db.query("update erp.sales_documents set categoria_financeira_id=$2, centro_custo_id=$3 where id=$1", [sem, catOk, ccOk])).rowCount).toBe(1);
    expect(id).toEqual(expect.any(String));
  });

  it("A1-D1 categoria de OUTRA organização → violação da FK composta (insert e update)", async () => {
    await expect(venda({ cat: catVizinha, cc: ccOk })).rejects.toThrow(/fk_sales_documents_categoria_financeira/);
    const id = await classificada();
    await expect(db.query("update erp.sales_documents set categoria_financeira_id=$2 where id=$1", [id, catVizinha])).rejects.toThrow(/fk_sales_documents_categoria_financeira/);
  });

  it("A1-D1 centro de OUTRA organização → violação da FK composta (insert e update)", async () => {
    await expect(venda({ cat: catOk, cc: ccVizinho })).rejects.toThrow(/fk_sales_documents_centro_custo/);
    const id = await classificada();
    await expect(db.query("update erp.sales_documents set centro_custo_id=$2 where id=$1", [id, ccVizinho])).rejects.toThrow(/fk_sales_documents_centro_custo/);
  });

  it("A1-D1 par incompleto direto → violação do CHECK (insert com um só; update que zera um só)", async () => {
    await expect(venda({ cat: catOk, cc: null })).rejects.toThrow(/sales_documents_classificacao_par/);
    await expect(venda({ cat: null, cc: ccOk })).rejects.toThrow(/sales_documents_classificacao_par/);
    const id = await classificada();
    await expect(db.query("update erp.sales_documents set centro_custo_id=null where id=$1", [id])).rejects.toThrow(/sales_documents_classificacao_par/);
  });
});

describe("A1-D2 — a guarda: venda classificada só entra em confirmed/invoiced com a marca DELA", () => {
  it("A1-D2 o gatilho existe, está ligado, só no UPDATE de status; a função tem search_path fixo", async () => {
    const t = await db.query<{ tgenabled: string; def: string }>(
      `select t.tgenabled, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid=t.tgrelid
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='erp' and c.relname='sales_documents' and t.tgname='trg_sales_documents_classificacao_financeira'`);
    expect(t.rowCount).toBe(1);
    expect(t.rows[0]!.tgenabled).toBe("O");
    expect(t.rows[0]!.def).toContain("BEFORE UPDATE OF status");
    const f = await db.query<{ proconfig: string[] | null; prosecdef: boolean }>("select proconfig, prosecdef from pg_proc where proname='venda_classificacao_financeira_guarda'");
    expect(f.rows[0]!.prosecdef).toBe(false);
    expect(f.rows[0]!.proconfig?.join(",")).toContain("search_path");
  });

  it("A1-D2 classificada entrando em confirmed SEM a marca → recusa com código que o binário anterior mapeia; status intacto", async () => {
    const id = await classificada();
    await expect(moverComoApp(id, "confirmed", null)).rejects.toThrow(/^VALIDATION_ERROR: /);
    expect(await statusDe(id)).toBe("open");
  });

  it("A1-D2 aberta → faturada DIRETO sem a marca também é recusada", async () => {
    const id = await classificada();
    await expect(moverComoApp(id, "invoiced", null)).rejects.toThrow(/^VALIDATION_ERROR: /);
    expect(await statusDe(id)).toBe("open");
  });

  it("A1-D2 a marca de OUTRA venda não serve: ela é amarrada ao id", async () => {
    const outra = await classificada();
    const id = await classificada();
    await expect(moverComoApp(id, "confirmed", outra)).rejects.toThrow(/^VALIDATION_ERROR: /);
    expect(await statusDe(id)).toBe("open");
  });

  it("A1-D2 com a marca DESTA venda, passa — é o caminho do binário da VENDAS-A1", async () => {
    const id = await classificada();
    await moverComoApp(id, "confirmed", id);
    expect(await statusDe(id)).toBe("confirmed");
  });

  it("A1-D2 contraprova: venda SEM classificação confirma sem marca nenhuma", async () => {
    const id = await venda();
    await moverComoApp(id, "confirmed", null);
    expect(await statusDe(id)).toBe("confirmed");
  });

  it("A1-D2 confirmed → invoiced e o cancelamento passam sem a marca (só a ENTRADA é guardada)", async () => {
    const id = await classificada();
    await moverComoApp(id, "confirmed", id);
    await moverComoApp(id, "invoiced", null);
    expect(await statusDe(id)).toBe("invoiced");
    await moverComoApp(id, "cancelled", null);
    expect(await statusDe(id)).toBe("cancelled");
    // Cancelar uma venda classificada ainda ABERTA também passa.
    const aberta = await classificada();
    await moverComoApp(aberta, "cancelled", null);
    expect(await statusDe(aberta)).toBe("cancelled");
  });
});
