import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { login, ADMIN } from "./helpers";

/**
 * OPERACOES-01 F8 · BANCOS E CAIXA com escopo de empresa (decisão 285 item 12; MULTI-COMPANY §7).
 *
 * Uma conta COMPARTILHADA por duas empresas (A e B) com movimentos de A, de B e um sem empresa. O proprietário vê a
 * conta inteira (saldo inicial 1000 + 100 + 500 − 30 − 45 + 9 = 1534) e NENHUM aviso; o membro com escopo financeiro
 * só em A vê só A — saldo 70 (100 − 30), sem o saldo inicial e sem o movimento sem empresa —, nada de B na tela, e o
 * aviso de que aquele é o saldo das empresas dele, não o da conta inteira.
 *
 * O teste é dono do próprio dado: conta, movimentos, papel e usuário nascem aqui, com sufixo único (o `retries` do CI
 * roda o `beforeAll` de novo). Nada depende do que o seed escolheu como primeira conta ou primeira empresa.
 */
const BANCO = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
const sql = (c: string) => execFileSync("psql", [BANCO, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();
const linha1 = (texto: string) => texto.split("\n")[0]!;

const SUF = Date.now().toString(36).toUpperCase();
const CODIGO = `E2EESC${SUF}`;
const MEMBRO = { email: `e2e-escopo-a-${SUF.toLowerCase()}@demo.local`, password: ADMIN.password };
let CONTA = "";

test.beforeAll(() => {
  const org = sql(`select m.organization_id from erp.organization_members m join erp.users u on u.id=m.user_id where u.email='${ADMIN.email}' and m.is_owner limit 1`);
  const empresas = sql(`select id from erp.empresas where organization_id='${org}' and deleted_at is null order by code limit 2`).split("\n");
  expect(empresas, "pré-condição do seed: duas empresas na organização").toHaveLength(2);
  const [A, B] = empresas as [string, string];
  CONTA = linha1(sql(`insert into erp.bank_accounts(organization_id,code,description,type,opening_balance) values ('${org}','${CODIGO}','[E2E] Conta compartilhada ${SUF}','checking',1000) returning id`));
  const mov = (empresa: string | null, data: string, tipo: "in" | "out", valor: string, rotulo: string) =>
    sql(`insert into erp.bank_movements(organization_id,code,bank_account_id,empresa_id,movement_date,type,category_type,amount,status,note,document)
         values ('${org}','E2EX-${SUF}-${rotulo}','${CONTA}',${empresa ? `'${empresa}'` : "null"},'${data}','${tipo}','${tipo}',${valor},'confirmed','[E2E] Lançamento ${rotulo} ${SUF}','DOC-${rotulo}-${SUF}')`);
  mov(A, "2034-05-01", "in", "100", "A1"); mov(B, "2034-05-02", "in", "500", "B1"); mov(A, "2034-05-03", "out", "30", "A2");
  mov(B, "2034-05-04", "out", "45", "B2"); mov(null, "2034-05-05", "in", "9", "N1");
  const papel = linha1(sql(`insert into erp.roles(organization_id,name) values ('${org}','[E2E] Escopo A ${SUF}') returning id`));
  sql(`insert into erp.role_permissions(role_id,permission_key) values ('${papel}','bank_accounts.view'),('${papel}','bank_movements.view')`);
  const u = linha1(sql(`insert into erp.users(email,name,password_hash) select '${MEMBRO.email}','E2E Escopo A ${SUF}',password_hash from erp.users where email='${ADMIN.email}' returning id`));
  const m = linha1(sql(`insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ('${org}','${u}','${papel}',false,true) returning id`));
  sql(`insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ('${org}','${m}','financeiro','selecionadas')`);
  sql(`insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ('${org}','${m}','financeiro','selecionadas','${A}')`);
});

const lancamento = (page: Page, rotulo: string) => page.getByText(`[E2E] Lançamento ${rotulo} ${SUF}`);

test("BC-1 — proprietário: extrato e contas da conta compartilhada com o saldo da conta inteira, sem aviso de recorte", async ({ page }) => {
  await login(page);
  await page.goto(`/financeiro?tab=bancos&sub=extrato&conta=${CONTA}`);
  await expect(page.getByTestId("fin-extrato")).toBeVisible();
  await expect(page.getByTestId("fin-saldo-real")).toHaveAttribute("data-valor", "1534.00");
  await expect(page.getByTestId("fin-saldo-conciliado")).toHaveAttribute("data-valor", "1000.00");
  for (const r of ["A1", "B1", "A2", "B2", "N1"]) await expect(lancamento(page, r), r).toBeVisible();
  await expect(page.getByTestId("fin-saldo-escopo-parcial")).toHaveCount(0);

  await page.goto("/financeiro?tab=bancos&sub=contas");
  await expect(page.getByTestId("fin-contas")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(CODIGO) })).toContainText("1.534,00");
  await expect(page.getByTestId("fin-saldo-escopo-parcial")).toHaveCount(0);
});

test("BC-2 — escopo financeiro só em A: extrato e conta mostram só A (saldo 70, sem o saldo inicial), nada de B e o aviso de recorte", async ({ page }) => {
  await login(page, MEMBRO);
  await page.goto(`/financeiro?tab=bancos&sub=extrato&conta=${CONTA}`);
  await expect(page.getByTestId("fin-extrato")).toBeVisible();
  await expect(page.getByTestId("fin-saldo-real")).toHaveAttribute("data-valor", "70.00");
  await expect(page.getByTestId("fin-saldo-conciliado")).toHaveAttribute("data-valor", "0.00");
  await expect(lancamento(page, "A1")).toBeVisible();
  await expect(lancamento(page, "A2")).toBeVisible();
  for (const proibido of ["B1", "B2", "N1"]) {
    await expect(lancamento(page, proibido), proibido).toHaveCount(0);
    await expect(page.getByText(`DOC-${proibido}-${SUF}`), `documento ${proibido}`).toHaveCount(0);
  }
  await expect(page.getByTestId("fin-saldo-escopo-parcial")).toContainText("Saldo das suas empresas");

  await page.goto("/financeiro?tab=bancos&sub=contas");
  await expect(page.getByTestId("fin-contas")).toBeVisible();
  const linha = page.getByRole("row", { name: new RegExp(CODIGO) });
  await expect(linha).toContainText("70,00");
  await expect(linha).not.toContainText("1.534,00");
  await expect(page.getByTestId("fin-saldo-escopo-parcial")).toContainText("Não é o saldo da conta inteira");
});
