import { test, expect } from "@playwright/test";
import { login, logout } from "./helpers";

/**
 * ACESSO POR EMPRESA (Configurações › Usuários): a tela de configuração tem fixtures próprias — cria o
 * usuário que ela mesma vai configurar, para não depender de estado deixado por outro teste.
 *
 * O que se verifica aqui é a TELA: a matriz por módulo existe, grava o modelo canônico e devolve o que
 * gravou. A autorização em si é provada no servidor (apps/api/test/integration/escopo-modulo.test.ts) —
 * interface nunca é prova de autorização.
 */
const email = `e2e-acesso-${Date.now()}@demo.local`;

test("matriz de acesso por empresa grava e relê o modelo por módulo", async ({ page }) => {
  await login(page);
  await page.goto("/admin/usuarios");
  await page.getByRole("button", { name: "Novo usuário" }).click();
  await page.getByRole("textbox", { name: "Nome *" }).fill("Usuário E2E Acesso");
  await page.getByRole("textbox", { name: "E-mail *" }).fill(email);
  await page.getByLabel(/Senha/).first().fill("Acesso@12345");

  // a matriz lista os módulos de negócio — Início/Relatórios/Configurações NÃO são escopos
  const linhaEstoque = page.getByLabel(/Acesso — Estoque/);
  await expect(linhaEstoque).toBeVisible();
  await expect(page.getByLabel(/Acesso — Relatórios/)).toHaveCount(0);

  await linhaEstoque.selectOption("selecionadas");
  await page.getByRole("checkbox").first().check();
  await page.getByLabel(/Acesso — Financeiro/).selectOption("todas");
  await page.getByRole("button", { name: "Salvar" }).click();

  // relê: o que voltou é o modelo canônico, módulo a módulo
  await expect(page.getByText("Usuário E2E Acesso").first()).toBeVisible();
  const linha = page.getByTestId("b1-row").filter({ hasText: "Usuário E2E Acesso" }).first();
  await linha.getByTestId("row-view").click();
  await expect(page.getByLabel(/Acesso — Estoque/)).toHaveValue("selecionadas");
  await expect(page.getByLabel(/Acesso — Financeiro/)).toHaveValue("todas");
  // módulo não configurado continua sem empresa nenhuma (fail-closed), e a tela mostra isso
  await expect(page.getByLabel(/Acesso — Pecuária/)).toHaveValue("");
});

/**
 * FLUXO REAL: o administrador configura o acesso por empresa e o USUÁRIO configurado passa a enxergar
 * exatamente aquilo — na sessão dele, não na do administrador.
 *
 * As fixtures são próprias (empresas da semente, lançamentos criados aqui) e o preparo usa a API autenticada
 * como administrador; a PROVA usa o token/sessão do usuário restrito.
 */
const restrito = { email: `e2e-restrito-${Date.now()}@demo.local`, password: "Restrito@12345" };

test("o usuário configurado enxerga Estoque na empresa A e Financeiro na empresa B", async ({ page }) => {
  await login(page);
  const admin = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string });
  const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3333";
  const comoAdmin = { Authorization: `Bearer ${admin.token}`, "X-Org-Id": admin.orgId, "Content-Type": "application/json" };
  const pedir = async (url: string, data?: unknown, headers: Record<string, string> = comoAdmin) => {
    const r = data === undefined
      ? await page.request.get(`${API}${url}`, { headers })
      : await page.request.post(`${API}${url}`, { headers, data: data as Record<string, unknown> });
    return { status: r.status(), body: (await r.text()) ? JSON.parse(await r.text()) : null };
  };

  // empresas da organização: A e B
  const ctx = await pedir("/api/auth/context");
  const empresas = (ctx.body.farms as { id: string; name: string }[]).slice(0, 2);
  const [A, B] = empresas;
  expect(A && B, "a semente precisa ter duas empresas").toBeTruthy();

  // fixtures em CADA empresa: uma entrada de estoque e um título a pagar
  const refs = await pedir("/api/admin/members?pageSize=1");
  expect(refs.status).toBe(200);
  const um = async (recurso: string) => (await pedir(`/api/resources/${recurso}?pageSize=1`)).body.items[0].id as string;
  const [produto, fornecedor, categoria, centro] = await Promise.all([um("products"), um("people"), um("financial_categories"), um("cost_centers")]);
  const armazem = async (farmId: string) => (await pedir(`/api/resources/warehouses?pageSize=50`)).body.items.find((w: { farm_id: string }) => w.farm_id === farmId).id as string;
  const entrada = async (farmId: string, marca: string) => pedir("/api/stock/input-entries", {
    farm_id: farmId, entry_date: "2026-09-01", note: marca,
    items: [{ product_id: produto, quantity: "3", unit_value: "2", warehouse_id: await armazem(farmId), financial_category_id: categoria, cost_center_id: centro }]
  });
  const titulo = (farmId: string, numero: string) => pedir("/api/financial/payables", {
    farm_id: farmId, number: numero, person_id: fornecedor, amount: "77.00", emission_date: "2026-09-01", due_date: "2026-03-15", note: "E2E acesso",
    apportionment: [{ financial_category_id: categoria, cost_center_id: centro, percentage: "100" }]
  });
  const eA = await entrada(A!.id, "E2E-ESTOQUE-A"); const eB = await entrada(B!.id, "E2E-ESTOQUE-B");
  const tA = await titulo(A!.id, "E2E-FIN-A"); const tB = await titulo(B!.id, "E2E-FIN-B");
  for (const r of [eA, eB, tA, tB]) expect(r.status, JSON.stringify(r.body)).toBe(201);

  // perfil com as duas capacidades e usuário com escopos diferentes por módulo
  const papel = await pedir("/api/admin/roles", { name: `Perfil E2E ${Date.now()}`, permissions: ["input_entries.view", "stocks.view", "payables.view", "warehouses.view"] });
  expect(papel.status).toBe(201);
  const membro = await pedir("/api/admin/members", {
    name: "Usuário E2E Restrito", email: restrito.email, password: restrito.password, role_id: papel.body.id,
    escopos_empresas: [
      { modulo: "estoque", modo: "selecionadas", empresas: [A!.id] },
      { modulo: "financeiro", modo: "selecionadas", empresas: [B!.id] }
    ]
  });
  expect(membro.status, JSON.stringify(membro.body)).toBe(201);

  // ---- daqui em diante, TUDO é na sessão do usuário restrito ----
  await logout(page);
  await login(page, restrito);
  const sessao = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string });
  const comoUsuario = { Authorization: `Bearer ${sessao.token}`, "X-Org-Id": sessao.orgId };
  const comoUsuarioEm = (farmId: string) => ({ ...comoUsuario, "X-Farm-Id": farmId });

  const estoque = await pedir("/api/stock/input-entries?pageSize=100", undefined, comoUsuario);
  const idsEstoque = (estoque.body.items as { id: string }[]).map((x) => x.id);
  expect(idsEstoque, "entrada da empresa A visível no Estoque").toContain(eA.body.id);
  expect(idsEstoque, "entrada da empresa B NÃO pode aparecer no Estoque").not.toContain(eB.body.id);

  const financeiro = await pedir("/api/financial/payables?pageSize=100", undefined, comoUsuario);
  const idsFin = (financeiro.body.items as { id: string }[]).map((x) => x.id);
  expect(idsFin, "título da empresa B visível no Financeiro").toContain(tB.body.id);
  expect(idsFin, "título da empresa A NÃO pode aparecer no Financeiro").not.toContain(tA.body.id);

  // seleção explícita de empresa proibida NAQUELE módulo é recusada pelo servidor
  expect((await pedir("/api/stock/input-entries", undefined, comoUsuarioEm(B!.id))).status, "X-Farm-Id=B no Estoque").toBe(403);
  expect((await pedir("/api/financial/payables", undefined, comoUsuarioEm(A!.id))).status, "X-Farm-Id=A no Financeiro").toBe(403);
  // e a seleção permitida continua funcionando
  expect((await pedir("/api/stock/input-entries", undefined, comoUsuarioEm(A!.id))).status).toBe(200);
  expect((await pedir("/api/financial/payables", undefined, comoUsuarioEm(B!.id))).status).toBe(200);

  // a interface do usuário restrito monta e mostra o mesmo recorte
  // (o nome da outra empresa ainda aparece no seletor do cabeçalho — ela é visível em OUTRO módulo;
  //  a prova é sobre as LINHAS da lista)
  await page.goto("/estoque?tab=recebimentos&sub=manuais");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  await expect(page.getByTestId("b1-row").filter({ hasText: B!.name }), "linha da empresa B no Estoque").toHaveCount(0);
  await page.goto("/financeiro/contas-a-pagar");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  await expect(page.getByTestId("b1-row").filter({ hasText: A!.name }), "linha da empresa A no Financeiro").toHaveCount(0);
});
