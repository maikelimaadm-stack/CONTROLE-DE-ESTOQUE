import { test, expect, type Locator, type Page, type Response } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { D } from "@agro/shared";
import { configuracaoNeutraTopV5 } from "@agro/domain";
import { api, empresaAtiva, login, uniq } from "./helpers";
import { codigoTopE2E, excluirTopE2E } from "./top-config-08-comum";

/**
 * OPERACOES-01 F9 · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (decisão 286; a janela "API antes do web").
 *
 * POR QUE ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` (sem âncora): este arquivo entra pelo fim do nome, e o `playwright.config.ts` comum o
 * ignora pelo mesmo padrão. Arquivo PRÓPRIO: o `skew-web-anterior.spec.ts` é compartilhado entre PRs (PRE-PR-02).
 *
 * O QUE SE MEDE. A F9 mexe nas rotas que a tela de hoje usa (o título, a baixa, a lista, a natureza) — e o combinado é
 * que elas recebem os CORPOS de hoje e devolvem as chaves de hoje (só acréscimos). O navegador roda o bundle EXATO da
 * base:
 *   (a) a conta a pagar lançada pela tela antiga (o corpo sem `tipo_operacao_id`) → 201, um título sem TOP;
 *   (b) a baixa pela tela antiga (o corpo sem `imovel_rural_id`), numa empresa com imóvel padrão → 201, "Baixada", e a
 *       baixa e o movimento com o imóvel PADRÃO (o acréscimo do servidor, que o cliente antigo não precisa conhecer);
 *   (c) a lista antiga de contas a receber NÃO mostra o título previsto de um pedido (premissa: a API o lista em
 *       `status=previsto`, pelo MESMO filtro) e os totais não o somam;
 *   (d) a natureza salva pela tela antiga (o corpo sem `tipo_lcdpr`) → 200, e o tipo no LCDPR gravado continua.
 *
 * O MUNDO É O DO WEB DA BASE. Perguntar à API no ar daria sempre "novo" e não diria nada sobre o cliente. A pergunta vai
 * à ÁRVORE DA BASE montada em `.api-anterior`, no commit dela: o web da base conhece a TOP no lançamento
 * (`/api/financeiro/tops`)? Não → mundo LEGADO (a base de hoje, 622f194): (a), (b) e (d) são feitos PELAS TELAS
 * antigas. Sim → mundo NOVO (a base já com a F9): o web da base é o desta fase, e (a), (b) e (d) são cobrados pelo
 * CORPO de hoje direto na API. (c) passa pela lista antiga nos dois mundos (ela continua viva pela URL). A API deste
 * HEAD é PREMISSA: ela declara as duas capacidades — é ela que está sendo julgada.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
type Mundo = "legado" | "novo";

function mundoDoWebDaBase(): Mundo {
  const arvore = path.resolve(__dirname, "../../..", ".api-anterior");
  let ocorrencias = "";
  try {
    ocorrencias = execFileSync("git", ["grep", "-c", "-F", "/api/financeiro/tops", "HEAD", "--", "apps/web/src"], { cwd: arvore }).toString().trim();
  } catch (e) {
    // `git grep` sai 1 sem ocorrência; qualquer outra saída (árvore ausente, git quebrado) é ERRO, nunca o ramo fácil.
    if ((e as { status?: number }).status !== 1) throw new Error(`não foi possível medir a árvore da base em ${arvore}: ${String(e)}`);
  }
  const mundo: Mundo = ocorrencias ? "novo" : "legado";
  console.log(`[skew] OPERACOES-01 F9 · K-2 · o web da base ${ocorrencias ? "CONHECE" : "NÃO conhece"} a TOP no lançamento (${ocorrencias.replace(/\n/g, ", ") || "0 ocorrências"}) → mundo ${mundo}`);
  return mundo;
}

/** A PREMISSA: a API no ar é a desta fase — declara o financeiro pela TOP e o LCDPR, na forma e versão exatas. */
async function premissaDaApi(page: Page) {
  expect(await api(page, "GET", "/api/financeiro/capacidades"), "premissa: a API julgada declara o financeiro pela TOP").toEqual({ centralFinanceira: 1, financeiroPelaTop: 1 });
  const ctx = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/auth/context");
  expect(ctx.capacidades?.["lcdpr"], "premissa: a API julgada declara o LCDPR").toBe(1);
}

/** Vigia do navegador: CORS morto e erro de contrato não passam calados. */
function vigiar(page: Page) {
  const falhas: string[] = []; const respostas: { url: string; status: number }[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.url().includes("/api/")) respostas.push({ url: r.url(), status: r.status() }); });
  return {
    semBloqueio: () => expect(falhas, "nenhuma requisição do cliente em produção pode morrer no navegador").toEqual([]),
    semErroDeContrato: () => {
      const ruins = respostas.filter((r) => r.status === 404 || r.status === 422 || r.status >= 500);
      expect(ruins, `o cliente em produção não pode receber erro de contrato da API nova: ${JSON.stringify(ruins)}`).toEqual([]);
    }
  };
}

const chaves = (o: object) => Object.keys(o);
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const respostaDe = (page: Page, caminho: string, metodo: string) => page.waitForResponse((r: Response) => r.request().method() === metodo && new URL(r.url()).pathname === caminho);
async function um(page: Page, caminho: string): Promise<{ id: string; name: string }> {
  const r = await api<{ items: { id: string; name: string }[] }>(page, "GET", caminho);
  expect(r.items[0], `premissa: ${caminho} tem registro no seed`).toBeTruthy();
  return r.items[0]!;
}
/** Escolhe a opção num seletor de referência (o gatilho é o `combobox` da caixa), pela busca do painel. */
async function escolher(page: Page, gatilho: Locator, busca: string) {
  await gatilho.click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(busca);
  await painel.getByRole("option", { name: new RegExp(escapar(busca.slice(0, 20)), "i") }).first().click();
}
const caixaDoCampo = (escopo: Locator, rotulo: string) => escopo.locator("label", { hasText: rotulo }).first().locator("..").getByRole("combobox");

test.describe("OPERACOES-01 F9 · K-2 (sentido 2) — o web da base contra a API do financeiro pela TOP e do LCDPR", () => {
  test("(a) a conta a pagar pela tela antiga (sem `tipo_operacao_id`) → 201, um título sem TOP", async ({ page }) => {
    const mundo = mundoDoWebDaBase();
    await login(page);
    await premissaDaApi(page);
    const fornecedor = await um(page, "/api/resources/people?is_provider=true&pageSize=1");
    const despesa = await um(page, "/api/resources/financial_categories?kind=analytic&nature=expense&pageSize=1");
    const centro = await um(page, "/api/resources/cost_centers?kind=analytic&pageSize=1");
    const numero = `K2F9A-${Date.now().toString(36)}`.toUpperCase();
    const v = vigiar(page);
    let id: string;
    if (mundo === "legado") {
      await page.goto("/financeiro/contas-a-pagar/new");
      await page.getByLabel(/^Nº do documento/).fill(numero);
      await escolher(page, caixaDoCampo(page.locator("body"), "Fornecedor"), fornecedor.name);
      await page.getByLabel(/^Valor\b/).first().fill("210");
      await page.getByLabel(/^Observação/).fill(`K-2 F9 ${numero}`);
      const linha = page.locator("table").last().locator("tbody tr").first();
      await escolher(page, linha.getByRole("combobox").nth(0), despesa.name);
      await escolher(page, linha.getByRole("combobox").nth(1), centro.name);
      const criacao = respostaDe(page, "/api/financial/payables", "POST");
      await page.getByRole("button", { name: "Salvar" }).click();
      const r = await criacao;
      expect(chaves(r.request().postDataJSON() as object), "premissa: o web antigo manda o corpo de hoje, sem a TOP").not.toContain("tipo_operacao_id");
      expect(r.status(), "a API nova aceita o corpo de hoje").toBe(201);
      const corpo = await r.json() as { id: string; ids: string[] };
      for (const k of ["id", "ids"]) expect(chaves(corpo), `a criação responde a chave de hoje "${k}"`).toContain(k);
      id = corpo.id;
      await expect(page, "o web antigo abre o detalhe de hoje").toHaveURL(new RegExp(`/financeiro/contas-a-pagar/${id}$`));
    } else {
      id = (await api<{ id: string }>(page, "POST", "/api/financial/payables", {
        empresa_id: await empresaAtiva(page), number: numero, person_id: fornecedor.id, amount: "210.00", emission_date: "2033-07-01", due_date: "2033-07-30",
        note: `K-2 F9 ${numero}`, apportionment: [{ financial_category_id: despesa.id, cost_center_id: centro.id, percentage: "100" }]
      })).id;
    }
    const t = await api<{ number: string; amount: string; status: string; tipo_operacao_id: string | null; tipo_operacao: unknown }>(page, "GET", `/api/financial/payables/${id}`);
    expect([t.number, t.amount, t.status], "conclusão: o título de hoje").toEqual([numero, "210.00", "open"]);
    expect([t.tipo_operacao_id, t.tipo_operacao], "sem TOP, como hoje").toEqual([null, null]);
    v.semBloqueio(); v.semErroDeContrato();
  });

  test("(b) a baixa pela tela antiga, numa empresa com imóvel padrão → 201, \"Baixada\", e a baixa e o movimento com o imóvel padrão", async ({ page }) => {
    const mundo = mundoDoWebDaBase();
    await login(page);
    await premissaDaApi(page);
    const fornecedor = await um(page, "/api/resources/people?is_provider=true&pageSize=1");
    const despesa = await um(page, "/api/resources/financial_categories?kind=analytic&nature=expense&pageSize=1");
    const centro = await um(page, "/api/resources/cost_centers?kind=analytic&pageSize=1");
    const contas = await api<{ items: { id: string; code: string; description: string }[] }>(page, "GET", "/api/financial/bank-accounts/balances");
    const bb = contas.items.find((c) => c.code === "BB");
    expect(bb, "premissa: a conta BB do seed").toBeTruthy();
    // Empresa PRÓPRIA: o imóvel padrão é um por empresa e mudaria a baixa dos outros specs.
    const empresa = await api<{ id: string }>(page, "POST", "/api/resources/empresas", { name: uniq("K-2 F9 LCDPR"), is_active: true });
    const imovel = await api<{ id: string }>(page, "POST", "/api/resources/imoveis_rurais", { empresa_id: empresa.id, nome: uniq("Imóvel K-2"), tipo_exploracao: "individual", participacao: "100", padrao: true });
    const numero = `K2F9B-${Date.now().toString(36)}`.toUpperCase();
    const { id } = await api<{ id: string }>(page, "POST", "/api/financial/payables", {
      empresa_id: empresa.id, number: numero, person_id: fornecedor.id, amount: "500.00", discount: "0", emission_date: "2033-08-01", due_date: "2033-08-30",
      note: "K-2 F9 (b)", apportionment: [{ financial_category_id: despesa.id, cost_center_id: centro.id, percentage: "100" }]
    });
    expect((await api<{ balance: string }>(page, "GET", `/api/financial/payables/${id}`)).balance, "premissa: o saldo do título").toBe("500.00");
    const v = vigiar(page);
    if (mundo === "legado") {
      await page.goto(`/financeiro/contas-a-pagar/${id}`);
      await page.getByRole("button", { name: "Baixar", exact: true }).click();
      const dlg = page.getByRole("dialog");
      await escolher(page, caixaDoCampo(dlg, "Conta bancária"), "Banco do Brasil");
      const baixa = respostaDe(page, `/api/financial/payables/${id}/settle`, "POST");
      await dlg.getByRole("button", { name: "Confirmar baixa" }).click();
      const rs = await baixa;
      expect(chaves(rs.request().postDataJSON() as object), "premissa: o corpo de hoje, sem o imóvel").not.toContain("imovel_rural_id");
      expect(rs.status(), "a API nova aceita a baixa de hoje").toBe(201);
      for (const k of ["settlement_id", "title_id", "net_amount", "status", "balance", "bank_movement_id"]) expect(chaves(await rs.json() as object), `a baixa responde a chave de hoje "${k}"`).toContain(k);
      await expect(page.getByText("Baixada").first(), "a tela antiga diz que o título foi baixado").toBeVisible();
    } else {
      await api(page, "POST", `/api/financial/payables/${id}/settle`, {
        settlement_date: "2033-08-30", settlement_kind: "bank_movement", bank_account_id: bb!.id, cross_title_id: null, amount: "500.00", discount: "0",
        penalty: "0", interest: "0", increase: "0", note: null, movement_mode: "separate"
      });
    }
    const depois = await api<{ status: string; settlements: { status: string; imovel_rural_id: string | null; bank_movement_id: string }[] }>(page, "GET", `/api/financial/payables/${id}`);
    const s = depois.settlements.find((x) => x.status === "confirmed");
    expect([depois.status, s?.imovel_rural_id], "conclusão: baixado, e a baixa com o imóvel PADRÃO da empresa").toEqual(["paid", imovel.id]);
    const mov = await api<{ imovel_rural_id: string | null; amount: string }>(page, "GET", `/api/financial/bank-movements/${s!.bank_movement_id}`);
    expect([mov.amount, mov.imovel_rural_id], "o movimento da baixa com o mesmo imóvel").toEqual(["500.00", imovel.id]);
    v.semBloqueio(); v.semErroDeContrato();
  });

  test("(c) a lista antiga de contas a receber não mostra o previsto do pedido nem o soma nos totais", async ({ page }) => {
    mundoDoWebDaBase();
    await login(page);
    await premissaDaApi(page);
    const produto = await um(page, "/api/resources/products?pageSize=1");
    const cliente = await um(page, "/api/resources/people?is_client=true&pageSize=1");
    // A TOP de pedido que PROVISIONA (formato 5, a seção da F9; execução neutra — vale com o gate desligado).
    const configuracao = configuracaoNeutraTopV5();
    configuracao.financeiroPadrao = { ...configuracao.financeiroPadrao, provisao: true };
    const codigo = codigoTopE2E();
    const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: "vendas.pedido", nome: uniq("K-2 F9 provisão"), configuracao });
    let pedidoId: string | null = null;
    try {
      const pedido = await api<{ id: string }>(page, "POST", "/api/sales/orders", {
        empresa_id: await empresaAtiva(page), document_date: "2033-09-01", client_id: cliente.id, tipo_operacao_id: top.id,
        items: [{ product_id: produto.id, warehouse_id: null, quantity: "1", unit_price: "777.70" }]
      });
      pedidoId = pedido.id;
      const doc = await api<{ code: string }>(page, "GET", `/api/sales/orders/${pedido.id}`);
      const numero = `PED-${doc.code}`;
      // PREMISSA (API): o previsto existe e casa com o MESMO filtro pelo número — só pedido em `status=previsto`.
      const previstos = await api<{ items: { id: string; number: string; amount: string; status: string }[] }>(page, "GET", `/api/financial/receivables?status=previsto&number=${encodeURIComponent(numero)}`);
      const previsto = previstos.items.find((t) => t.number === numero && t.status === "previsto");
      expect(previsto, "premissa: a provisão criou o previsto do pedido, e a API o lista em status=previsto").toBeTruthy();
      expect(previsto!.amount).toBe("777.70");

      const v = vigiar(page);
      await page.goto("/financeiro?tab=contas&sub=receber");
      const faixa = page.locator("form").filter({ has: page.getByRole("button", { name: "Filtrar" }) }).first();
      await faixa.locator("label", { hasText: "Nº documento" }).locator("input").fill(numero);
      const lista = page.waitForResponse((r) => r.request().method() === "GET" && r.url().includes("/api/financial/receivables?") && r.url().includes(`number=${encodeURIComponent(numero)}`));
      await faixa.getByRole("button", { name: "Filtrar" }).click();
      const r = await lista;
      expect(r.status()).toBe(200);
      const corpo = await r.json() as { items: { id: string; amount: string; status: string }[]; total: number; totals: { amount: string; balance: string; paid: string } };
      expect(corpo.items.map((t) => t.id), "a lista antiga NÃO traz o previsto").not.toContain(previsto!.id);
      expect(corpo.items.some((t) => t.status === "previsto"), "nem previsto nenhum").toBe(false);
      const soma = corpo.items.reduce((a, t) => a.plus(t.amount), D(0));
      expect(D(corpo.totals.amount).eq(soma), `os totais são os das linhas listadas — o previsto (${previsto!.amount}) não entra`).toBe(true);
      await expect(page.getByTestId("b1-row").filter({ hasText: numero }), "a tela antiga não mostra o previsto").toHaveCount(0);
      v.semBloqueio(); v.semErroDeContrato();
    } finally {
      if (pedidoId) await api(page, "POST", `/api/sales/orders/${pedidoId}/cancel`, { reason: "Limpeza do skew K-2 da F9" }).catch((e: unknown) => console.warn(`[f9 K-2] cancelar o pedido ${pedidoId} falhou: ${String(e)}`));
      await excluirTopE2E(page, top.id);
    }
  });

  test("(d) a natureza salva pela tela antiga (sem `tipo_lcdpr`) → 200, e o tipo no LCDPR gravado continua", async ({ page }) => {
    const mundo = mundoDoWebDaBase();
    await login(page);
    await premissaDaApi(page);
    const pai = (await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/financial_categories?kind=synthetic&nature=income&pageSize=1")).items[0]?.id;
    expect(pai, "premissa: há natureza sintética de receita").toBeTruthy();
    const nome = uniq("K-2 F9 Natureza");
    const { id } = await api<{ id: string }>(page, "POST", "/api/resources/financial_categories", { name: nome, nature: "income", kind: "analytic", parent_id: pai, tipo_lcdpr: "receita" });
    expect((await api<{ tipo_lcdpr: string | null }>(page, "GET", `/api/resources/financial_categories/${id}`)).tipo_lcdpr, "premissa: a natureza tem o tipo 1 no LCDPR").toBe("receita");
    const novoNome = `${nome} editada`;
    const v = vigiar(page);
    if (mundo === "legado") {
      await page.goto(`/cadastros/financial_categories/${id}`);
      const editar = page.getByRole("button", { name: "Editar" });
      if (await editar.count()) await editar.first().click();
      await page.getByLabel("Descrição *", { exact: true }).fill(novoNome);
      const gravacao = respostaDe(page, `/api/resources/financial_categories/${id}`, "PUT");
      await page.getByRole("button", { name: "Salvar" }).click();
      const r = await gravacao;
      expect(chaves(r.request().postDataJSON() as object), "premissa: o web antigo não conhece o tipo no LCDPR").not.toContain("tipo_lcdpr");
      expect(r.status(), "a API nova aceita a natureza de hoje").toBe(200);
    } else {
      await api(page, "PUT", `/api/resources/financial_categories/${id}`, { name: novoNome });
    }
    const depois = await api<{ name: string; tipo_lcdpr: string | null }>(page, "GET", `/api/resources/financial_categories/${id}`);
    expect([depois.name, depois.tipo_lcdpr], "conclusão: o nome mudou e o tipo no LCDPR continua").toEqual([novoNome, "receita"]);
    v.semBloqueio(); v.semErroDeContrato();
  });
});
