import { expect, type Page } from "@playwright/test";
export const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? "admin@demo.local", password: process.env.E2E_ADMIN_PASSWORD ?? "Demo@12345" };
export async function login(page: Page, u = ADMIN) {
  await page.goto("/login"); await page.fill("#email", u.email); await page.fill("#password", u.password); await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
}
/** Sai pelo menu do usuário (shell): avatar → "Sair". */
export async function logout(page: Page) {
  await page.getByLabel("Usuário").click(); await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}
/** Seleciona uma opção em um RefSelect (popover com busca). */
export async function pickRef(page: Page, fieldLabel: string, search: string) {
  const field = page.locator("label", { hasText: fieldLabel }).first().locator("..");
  await field.locator("button").first().click();
  const input = page.getByPlaceholder("Pesquisar..."); await input.fill(search);
  await page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last().getByRole("option", { name: new RegExp(search.slice(0, 12), "i") }).first().click();
}
export const uniq = (p: string) => `${p} ${Date.now().toString(36)}`;

export async function api<T = Record<string, unknown>>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  return page.evaluate(async ({ method, path, body, base }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text(); const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`);
    return data as T;
  }, { method, path, body, base });
}
/**
 * Empresa efetiva para criar lançamento, pela MESMA regra do app (`useEmpresaPadrao`, features/docs/shared):
 * a empresa da sessão, ou a primeira do contexto. No harness a sessão começa em "Todas as empresas", e
 * `session.empresaId` é `null` — foi isso que reprovou a primeira versão destes testes com 422.
 */
export async function empresaAtiva(page: Page): Promise<string> {
  const daSessao = await page.evaluate(() => (JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { empresaId: string | null }).empresaId);
  if (daSessao) return daSessao;
  const ctx = await api<{ empresas?: { id: string }[] }>(page, "GET", "/api/auth/context");
  const id = ctx.empresas?.[0]?.id;
  expect(id, "o contexto precisa expor ao menos uma empresa visível").toBeTruthy();
  return id!;
}

/** Primeiro id de um recurso, pela listagem oficial. */
export async function primeiroId(page: Page, path: string): Promise<string> {
  const r = await api<{ items: { id: string }[] }>(page, "GET", path);
  const id = r.items?.[0]?.id;
  expect(id, `sem registro em ${path} para montar a fixture`).toBeTruthy();
  return id!;
}

/**
 * A ETAPA DE ESCOLHA DO TIPO DE OPERAÇÃO (TOP-CONFIG-02B).
 *
 * `/vendas/<variante>/new` NÃO abre mais o formulário: abre o lançador. Quem quer chegar ao formulário
 * escolhe a operação primeiro. O passo mora aqui porque três specs precisam dele — duplicá-lo faria cada
 * um envelhecer por conta própria no dia em que o lançador mudar.
 */
export async function abrirLancamentoDeVendas(page: Page, variante: string) {
  await page.goto(`/vendas/${variante}/new`);
  await expect(page.getByTestId("top-lancador"), "sem TOP na URL, a rota /new abre o lançador").toBeVisible();
}

/**
 * Escolhe a TOP no lançador e confirma. Só retorna quando o formulário montou de fato — devolver antes
 * faria o teste seguinte medir uma tela em transição e culpar a asserção errada.
 */
export async function escolherTopEContinuar(page: Page, topId: string) {
  await page.locator(`[data-testid="top-opcao"][data-top-id="${topId}"]`).click();
  await page.getByTestId("top-continuar").click();
  await expect(page.getByTestId("top-contexto"), "depois de Continuar, o formulário abre contextualizado").toBeVisible();
  await expect(page, "a escolha fica na URL, para sobreviver a refresh e a Voltar/Avançar").toHaveURL(new RegExp(`tipo_operacao_id=${topId}`));
}

/**
 * Abre uma aba do painel inferior da Central de Vendas (VISUAL-UX-01): Totais · Financeiro · Frete ·
 * Fiscal · Observações. Os campos dessas abas continuam ligados ao MESMO estado de antes — só a
 * posição na tela mudou —, então quem precisa digitar neles abre a aba primeiro, como o usuário faz.
 * Só retorna quando o painel da aba está visível: preencher durante a troca mediria a aba errada.
 */
export async function abrirAbaDoLancamento(page: Page, nome: "Totais" | "Financeiro" | "Frete e transporte" | "Fiscal" | "Observações") {
  const aba = page.getByTestId("central-vendas-painel").getByRole("tab", { name: nome });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("central-vendas-painel").getByRole("tabpanel")).toBeVisible();
}

/**
 * Escolhe o primeiro produto REAL na primeira linha de itens da Central de Vendas (VISUAL-UX-01 R1):
 * abre a pesquisa ancorada à célula de produto e clica na primeira opção que o servidor devolveu.
 */
export async function escolherPrimeiroProdutoDaLinha(page: Page) {
  await page.getByTestId("central-vendas-linha").first().getByTestId("central-vendas-produto").click();
  await page.getByTestId("central-vendas-pesquisa").getByRole("option").first().click();
  await expect(page.getByTestId("central-vendas-pesquisa")).toHaveCount(0);
}
