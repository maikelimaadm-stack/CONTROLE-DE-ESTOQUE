import { test, expect, type Locator, type Page, type Response } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { login, api, uniq, empresaAtiva } from "./helpers";

/**
 * OPERACOES-01 F8 · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (decisão 285; a janela "API antes do web").
 *
 * POR QUE ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` (sem âncora): este arquivo entra pelo fim do nome, e o `playwright.config.ts` comum o
 * ignora pelo mesmo padrão (lá o web seria o deste HEAD e o caso não mediria o cliente anterior). Arquivo PRÓPRIO: o
 * `skew-web-anterior.spec.ts` é compartilhado entre PRs (PRE-PR-02).
 *
 * O QUE SE MEDE. A API da Central Financeira mexe nas rotas que a tela de hoje usa — e o combinado é que elas recebem
 * os CORPOS de hoje e devolvem as CHAVES de hoje (só acréscimos). O navegador roda o bundle EXATO da base:
 *   (a) a lista antiga de contas a pagar carrega, e `GET /api/financial/payables` responde as chaves e os tipos de hoje;
 *   (b) no detalhe antigo, a baixa com "Valor" = saldo e "Desconto" 10 dá título "Baixada" e o movimento de saldo − 10
 *       — exatamente o "Valor líquido do movimento" que a tela antiga mostra (o desconto agora conta UMA vez; antes a
 *       API somava valor + desconto e recusava essa baixa);
 *   (c) a baixa em lote antiga (corpo `ids`) responde 201 com `settled,total,items`; o cancelamento em lote antigo,
 *       `cancelled,skipped`; a importação OFX antiga (`bank_account_id, description, content`), 201 com
 *       `id,code,transactions,matched`.
 *
 * O MUNDO É O DO WEB DA BASE. Perguntar à API no ar daria sempre "novo" e não diria nada sobre o cliente. A pergunta vai
 * à ÁRVORE DA BASE montada em `.api-anterior`, no commit dela: o web da base conhece a capacidade da Central
 * (`/api/financeiro/capacidades`)? Não → mundo LEGADO (a base de hoje, 622f194): o detalhe do título é o de hoje e a
 * baixa (b) é feita pela tela. Sim → mundo NOVO (a base já com esta fase): o detalhe é o da Central, e (b) é cobrado
 * pelo CORPO de hoje direto na API. (a) e (c) passam pelas telas antigas nos dois mundos (continuam vivas pela URL). A
 * API deste HEAD é PREMISSA: ela declara a Central — é ela que está sendo julgada.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
type Mundo = "legado" | "novo";

function mundoDoWebDaBase(): Mundo {
  const arvore = path.resolve(__dirname, "../../..", ".api-anterior");
  let ocorrencias = "";
  try {
    ocorrencias = execFileSync("git", ["grep", "-c", "-F", "/api/financeiro/capacidades", "HEAD", "--", "apps/web/src"], { cwd: arvore }).toString().trim();
  } catch (e) {
    // `git grep` sai 1 sem ocorrência; qualquer outra saída (árvore ausente, git quebrado) é ERRO, nunca o ramo fácil.
    if ((e as { status?: number }).status !== 1) throw new Error(`não foi possível medir a árvore da base em ${arvore}: ${String(e)}`);
  }
  const mundo: Mundo = ocorrencias ? "novo" : "legado";
  console.log(`[skew] OPERACOES-01 F8 · K-2 · o web da base ${ocorrencias ? "CONHECE" : "NÃO conhece"} a Central Financeira (${ocorrencias.replace(/\n/g, ", ") || "0 ocorrências"}) → mundo ${mundo}`);
  return mundo;
}

/**
 * A PREMISSA: a API no ar é a desta fase — declara a Central Financeira, na forma e versão exatas. OPERACOES-01 F9
 * (decisão 286): a mesma resposta ganhou `financeiroPelaTop: 1` (aditiva); a API julgada declara as duas.
 */
async function premissaDaApi(page: Page) {
  const cap = await api<Record<string, unknown>>(page, "GET", "/api/financeiro/capacidades");
  expect(cap, "premissa: a API julgada é a desta fase (declara a Central Financeira e o financeiro pela TOP)").toEqual({ centralFinanceira: 1, financeiroPelaTop: 1 });
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

interface Refs { empresa: string; fornecedor: string; despesa: string; centro: string; conta: { id: string; conta: string } }
async function refs(page: Page): Promise<Refs> {
  const um = async (p: string) => {
    const r = await api<{ items: { id: string }[] }>(page, "GET", p);
    expect(r.items[0], `premissa: ${p} tem registro no seed`).toBeTruthy();
    return r.items[0]!.id;
  };
  const contas = await api<{ items: { id: string; code: string; account_number: string }[] }>(page, "GET", "/api/financial/bank-accounts/balances");
  const bb = contas.items.find((c) => c.code === "BB");
  expect(bb, "premissa: a conta BB do seed").toBeTruthy();
  return {
    empresa: await empresaAtiva(page), fornecedor: await um("/api/resources/people?is_provider=true&pageSize=1"),
    despesa: await um("/api/resources/financial_categories?kind=analytic&nature=expense&pageSize=1"),
    centro: await um("/api/resources/cost_centers?kind=analytic&pageSize=1"), conta: { id: bb!.id, conta: bb!.account_number }
  };
}
/** Título a pagar pelo CORPO DE HOJE (o que o formulário antigo manda). */
async function tituloAPagar(page: Page, r: Refs, numero: string, valor: string): Promise<string> {
  const t = await api<{ id: string }>(page, "POST", "/api/financial/payables", {
    empresa_id: r.empresa, number: numero, person_id: r.fornecedor, amount: valor, discount: "0", emission_date: "2033-06-01", due_date: "2033-06-30",
    note: "K-2 F8", apportionment: [{ financial_category_id: r.despesa, cost_center_id: r.centro, percentage: "100" }]
  });
  return t.id;
}
/** Escolhe a opção num RefSelect DENTRO de um escopo (a lista antiga tem outro "Conta bancária" na faixa de filtros). */
async function escolherRef(page: Page, escopo: Locator, rotulo: string, busca: string) {
  await escopo.locator("label", { hasText: rotulo }).first().locator("..").locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(busca);
  await painel.getByRole("option", { name: new RegExp(busca.slice(0, 12), "i") }).first().click();
}
const chaves = (o: object) => Object.keys(o);
const respostaDe = (page: Page, trecho: string, metodo: string, tambem = "") => page.waitForResponse((res: Response) => res.url().includes(trecho) && res.url().includes(tambem) && res.request().method() === metodo);

/** A lista antiga, filtrada pelo prefixo do número (a faixa de filtros de hoje: "Nº documento" + Filtrar). */
async function listaAntigaFiltrada(page: Page, prefixo: string) {
  await page.goto("/financeiro?tab=contas&sub=pagar");
  const faixa = page.locator("form").filter({ has: page.getByRole("button", { name: "Filtrar" }) }).first();
  await faixa.locator("label", { hasText: "Nº documento" }).locator("input").fill(prefixo);
  // Só a resposta do FILTRO (a carga inicial da lista, sem filtro, pode chegar depois do clique).
  const lista = respostaDe(page, "/api/financial/payables?", "GET", `number=${encodeURIComponent(prefixo)}`);
  await faixa.getByRole("button", { name: "Filtrar" }).click();
  return lista;
}
const linhaDoTitulo = (page: Page, numero: string) => page.getByTestId("b1-row").filter({ hasText: numero });

test.describe("OPERACOES-01 F8 · K-2 (sentido 2) — o web da base contra a API da Central Financeira", () => {
  test("(a) a lista antiga de contas a pagar carrega com as chaves e os tipos de hoje; (c) a baixa e o cancelamento em lote antigos respondem o corpo de hoje", async ({ page }) => {
    mundoDoWebDaBase();
    await login(page);
    await premissaDaApi(page);
    const r = await refs(page);
    const prefixo = uniq("K2F8").replace(/\s+/g, "-");
    const [a, b, c, d] = ["A", "B", "C", "D"].map((x) => `${prefixo}-${x}`) as [string, string, string, string];
    for (const [n, v] of [[a, "100.00"], [b, "200.00"], [c, "300.00"], [d, "400.00"]] as const) await tituloAPagar(page, r, n, v);
    const v = vigiar(page);

    // (a) a lista antiga e a resposta de hoje, chave por chave
    const resposta = await (await listaAntigaFiltrada(page, prefixo)).json() as Record<string, unknown> & { items: Record<string, unknown>[]; totals: Record<string, unknown> };
    for (const k of ["items", "total", "page", "pageSize", "totals"]) expect(chaves(resposta), `a lista responde a chave de hoje "${k}"`).toContain(k);
    expect(typeof resposta.total).toBe("number"); expect(typeof resposta.page).toBe("number"); expect(typeof resposta.pageSize).toBe("number");
    for (const k of ["amount", "balance", "paid"]) expect(typeof resposta.totals[k], `totals.${k} continua TEXTO decimal`).toBe("string");
    expect(resposta.items.length, "premissa: o filtro devolveu os 4 títulos do teste").toBe(4);
    for (const item of resposta.items) {
      for (const k of ["id", "code", "number", "amount", "balance", "status", "status_label", "due_date"]) expect(chaves(item), `cada linha tem "${k}"`).toContain(k);
      expect(typeof item["amount"], "o valor continua texto decimal").toBe("string");
      expect(item["status"]).toBe("open");
    }
    await expect(linhaDoTitulo(page, a), "a tela antiga mostra a linha com a situação de hoje").toContainText("A vencer");
    await expect(page.getByTestId("b1-row")).toHaveCount(4);

    // (c) baixa em lote antiga: corpo `ids`, movimento "Um por título"
    await linhaDoTitulo(page, a).getByLabel("Selecionar linha").click();
    await linhaDoTitulo(page, b).getByLabel("Selecionar linha").click();
    await page.getByRole("button", { name: /Baixar selecionados/ }).click();
    const lote = page.getByRole("dialog");
    await expect(lote).toContainText("Baixa em lote (2 títulos)");
    await escolherRef(page, lote, "Conta bancária", "Banco do Brasil");
    const baixa = respostaDe(page, "/api/financial/payables/settle-batch", "POST");
    await lote.getByRole("button", { name: "Confirmar" }).click();
    const rb = await baixa;
    const corpoBaixa = rb.request().postDataJSON() as Record<string, unknown>;
    expect(chaves(corpoBaixa), "premissa: o web antigo manda o corpo de hoje (`ids`)").toContain("ids");
    expect(chaves(corpoBaixa)).not.toContain("itens");
    expect(rb.status(), "a API nova aceita o corpo de hoje").toBe(201);
    const jb = await rb.json() as { settled: number; total: string; items: unknown[] };
    for (const k of ["settled", "total", "items"]) expect(chaves(jb), `a baixa em lote responde a chave de hoje "${k}"`).toContain(k);
    expect(jb.settled).toBe(2); expect(jb.total).toBe("300.00"); expect(Array.isArray(jb.items)).toBe(true);
    await expect(linhaDoTitulo(page, a)).toContainText("Baixada");
    await expect(linhaDoTitulo(page, b)).toContainText("Baixada");

    // (c) cancelamento em lote antigo: corpo `{ ids }`, sem motivo
    await linhaDoTitulo(page, c).getByLabel("Selecionar linha").click();
    await linhaDoTitulo(page, d).getByLabel("Selecionar linha").click();
    await page.getByRole("button", { name: "Cancelar selecionados" }).click();
    const cancelamento = respostaDe(page, "/api/financial/payables/cancel-batch", "POST");
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    const rc = await cancelamento;
    expect(chaves(rc.request().postDataJSON() as object), "premissa: o corpo de hoje é só `ids`").toEqual(["ids"]);
    expect(rc.status()).toBe(200);
    const jc = await rc.json() as { cancelled: number; skipped: number };
    for (const k of ["cancelled", "skipped"]) expect(chaves(jc), `o cancelamento em lote responde a chave de hoje "${k}"`).toContain(k);
    expect(jc.cancelled).toBe(2); expect(jc.skipped).toBe(0);
    const depois = await api<{ items: { number: string; status: string }[] }>(page, "GET", `/api/financial/payables?number=${encodeURIComponent(prefixo)}&status=cancelled`);
    expect(depois.items.map((x) => x.number).sort(), "conclusão no servidor: os dois foram cancelados").toEqual([c, d]);
    v.semBloqueio(); v.semErroDeContrato();
  });

  test("(b) baixa com Valor = saldo e Desconto 10: título Baixado e o movimento de saldo − 10 (o líquido que a tela antiga mostra)", async ({ page }) => {
    const mundo = mundoDoWebDaBase();
    await login(page);
    await premissaDaApi(page);
    const r = await refs(page);
    const numero = uniq("K2F8B").replace(/\s+/g, "-");
    const id = await tituloAPagar(page, r, numero, "1000.00");
    const antes = await api<{ balance: string; status: string }>(page, "GET", `/api/financial/payables/${id}`);
    expect(antes.balance, "premissa: saldo do título").toBe("1000.00");
    const v = vigiar(page);
    if (mundo === "legado") {
      await page.goto(`/financeiro/contas-a-pagar/${id}`);
      await page.getByRole("button", { name: "Baixar" }).click();
      const dlg = page.getByRole("dialog");
      await escolherRef(page, dlg, "Conta bancária", "Banco do Brasil");
      await expect(dlg.getByLabel(/^Valor\b/).first(), "a tela antiga propõe o saldo inteiro como Valor").toHaveValue(/^1000(\.00?)?$/);
      await dlg.getByLabel(/^Desconto/).fill("10");
      await expect(dlg, "a tela antiga mostra o líquido = valor − desconto").toContainText(/Valor líquido do movimento:\s*R\$\s*990,00/);
      const baixa = respostaDe(page, `/api/financial/payables/${id}/settle`, "POST");
      await dlg.getByRole("button", { name: "Confirmar baixa" }).click();
      const rs = await baixa;
      const corpo = rs.request().postDataJSON() as Record<string, unknown>;
      expect(chaves(corpo), "premissa: o corpo de hoje, sem os campos novos").not.toContain("tarifa");
      expect(chaves(corpo)).not.toContain("excedente");
      expect(chaves(corpo)).not.toContain("adiantamento_id");
      expect(rs.status(), "a API nova aceita a baixa que a antiga recusava (valor + desconto > saldo)").toBe(201);
      for (const k of ["settlement_id", "title_id", "net_amount", "status", "balance", "bank_movement_id"]) expect(chaves(await rs.json() as object), `a baixa responde a chave de hoje "${k}"`).toContain(k);
      await expect(page.getByText("Baixada").first(), "o detalhe antigo mostra o título baixado").toBeVisible();
    } else {
      // Mundo novo: o detalhe da base já é o da Central; o corpo de HOJE é cobrado direto na API.
      await api(page, "POST", `/api/financial/payables/${id}/settle`, {
        settlement_date: "2033-06-30", settlement_kind: "bank_movement", bank_account_id: r.conta.id, cross_title_id: null, amount: "1000.00", discount: "10",
        penalty: "0", interest: "0", increase: "0", note: null, movement_mode: "separate"
      });
    }
    const depois = await api<{ status: string; balance: string; settlements: { bank_movement_id: string; net_amount: string; amount: string; discount: string; status: string }[] }>(page, "GET", `/api/financial/payables/${id}`);
    expect(depois.status, "conclusão: o título quitou pelo valor (que inclui o desconto)").toBe("paid");
    expect(depois.balance).toBe("0.00");
    const s = depois.settlements.find((x) => x.status === "confirmed")!;
    expect([s.amount, s.discount, s.net_amount], "a baixa: valor 1000, desconto 10, líquido 990").toEqual(["1000.00", "10.00", "990.00"]);
    const mov = await api<{ amount: string; type: string }>(page, "GET", `/api/financial/bank-movements/${s.bank_movement_id}`);
    expect([mov.type, mov.amount], "o movimento é a saída de saldo − desconto").toEqual(["out", "990.00"]);
    v.semBloqueio(); v.semErroDeContrato();
  });

  test("(c) a importação OFX antiga (`bank_account_id, description, content`) responde 201 com `id,code,transactions,matched` e casa o Encontrado", async ({ page }) => {
    mundoDoWebDaBase();
    await login(page);
    await premissaDaApi(page);
    const r = await refs(page);
    const sufixo = Date.now().toString(36);
    const valor = `6${Date.now() % 900 + 100}.${String(Date.now() % 97).padStart(2, "0")}`;
    const mov = await api<{ id: string }>(page, "POST", "/api/financial/bank-movements", {
      empresa_id: r.empresa, bank_account_id: r.conta.id, movement_date: "2033-06-15", type: "out", category_type: "out", amount: valor, note: `K-2 OFX ${sufixo}`,
      apportionment: [{ financial_category_id: r.despesa, cost_center_id: r.centro, percentage: "100" }]
    });
    const ofx = ["OFXHEADER:100", "DATA:OFXSGML", "", "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>",
      `<BANKACCTFROM><BANKID>001<BRANCHID>1234<ACCTID>${r.conta.conta}</BANKACCTFROM><BANKTRANLIST>`,
      `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20330615<TRNAMT>-${valor}<FITID>K2F8-${sufixo}<MEMO>PAGAMENTO</STMTTRN>`,
      "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"].join("\n");
    const v = vigiar(page);
    await page.goto("/financeiro?tab=caixa&sub=conciliacao");
    await page.getByRole("button", { name: "Importar OFX" }).click();
    const dlg = page.getByRole("dialog");
    await escolherRef(page, dlg, "Conta bancária", "Banco do Brasil");
    await dlg.getByLabel(/^Descrição/).fill(`K-2 OFX ${sufixo}`);
    await dlg.locator("input[type=file]").setInputFiles({ name: "extrato.ofx", mimeType: "application/x-ofx", buffer: Buffer.from(ofx, "utf8") });
    const importacao = respostaDe(page, "/api/financial/ofx-imports", "POST");
    await dlg.getByRole("button", { name: "Importar" }).click();
    const ri = await importacao;
    expect(chaves(ri.request().postDataJSON() as object).sort(), "premissa: o corpo de hoje").toEqual(["bank_account_id", "content", "description"]);
    expect(ri.status(), "a API nova aceita o corpo de hoje").toBe(201);
    const ji = await ri.json() as { id: string; code: string; transactions: number; matched: number };
    for (const k of ["id", "code", "transactions", "matched"]) expect(chaves(ji), `a importação responde a chave de hoje "${k}"`).toContain(k);
    expect([typeof ji.id, typeof ji.code, ji.transactions, ji.matched]).toEqual(["string", "string", 1, 1]);
    await expect(page, "o web antigo abre o detalhe de hoje").toHaveURL(new RegExp(`/financeiro/ofx/${ji.id}$`));
    expect((await api<{ reconciled_at: string | null }>(page, "GET", `/api/financial/bank-movements/${mov.id}`)).reconciled_at, "conclusão: o movimento ficou conciliado").not.toBeNull();
    v.semBloqueio(); v.semErroDeContrato();
  });
});
