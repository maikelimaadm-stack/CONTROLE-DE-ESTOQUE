import { test, expect, type Locator, type Page } from "@playwright/test";
import { D, money } from "@agro/shared";
import { login, api, empresaAtiva } from "./helpers";

/**
 * CENTRAL FINANCEIRA · CONCILIAÇÃO OFX (OPERACOES-01 F8, decisão 285) — o caminho principal e as duas recusas da tela.
 *
 * O extrato é SINTÉTICO, montado aqui: nenhum arquivo de banco real entra no repositório. Os movimentos são semeados
 * pela API na conta BB do seed (com rateio), em datas próprias deste arquivo (maio de 2033, onde nenhum outro spec
 * lança) e com valores de centavos únicos por execução — a sugestão do servidor só pode casar com o que este teste
 * criou. A premissa (movimento livre, conta do arquivo diferente da cadastrada, nenhuma importação nova) e a conclusão
 * (a marca de conciliado no MOVIMENTO) são conferidas pela API; a tela é conferida pelo que o usuário vê.
 */

type Movimento = { id: string; reconciled_at: string | null; ofx_transaction_id: string | null };
interface Refs { conta: { id: string; conta: string }; empresa: string; receita: string; despesa: string; centro: string }

/** Um número por execução: os valores do arquivo e dos movimentos não colidem com outra execução no mesmo banco. */
const SEMENTE = Date.now() % 900 + 100;
const centavos = (n: number) => String((SEMENTE + n) % 100).padStart(2, "0");
const ofxSintetico = (acctid: string, transacoes: { fitid: string; data: string; valor: string; memo: string }[]) => [
  "OFXHEADER:100", "DATA:OFXSGML", "VERSION:102", "ENCODING:USASCII", "",
  "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL",
  `<BANKACCTFROM><BANKID>001<BRANCHID>1234<ACCTID>${acctid}<ACCTTYPE>CHECKING</BANKACCTFROM>`,
  "<BANKTRANLIST>",
  ...transacoes.map((t) => `<STMTTRN><TRNTYPE>${t.valor.startsWith("-") ? "DEBIT" : "CREDIT"}<DTPOSTED>${t.data.replace(/-/g, "")}120000<TRNAMT>${t.valor}<FITID>${t.fitid}<MEMO>${t.memo}</STMTTRN>`),
  "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
].join("\n");

async function refs(page: Page): Promise<Refs> {
  const contas = await api<{ itens: { id: string; codigo: string; conta: string }[] }>(page, "GET", "/api/financeiro/contas?ativas=1&pageSize=200");
  const bb = contas.itens.find((c) => c.codigo === "BB");
  expect(bb, "premissa: a conta BB do seed existe e está ativa").toBeTruthy();
  const primeiro = async (path: string) => {
    const r = await api<{ items: { id: string }[] }>(page, "GET", path);
    expect(r.items[0], `premissa: ${path} tem registro no seed`).toBeTruthy();
    return r.items[0]!.id;
  };
  return {
    conta: bb!, empresa: await empresaAtiva(page),
    receita: await primeiro("/api/resources/financial_categories?kind=analytic&nature=income&pageSize=1"),
    despesa: await primeiro("/api/resources/financial_categories?kind=analytic&nature=expense&pageSize=1"),
    centro: await primeiro("/api/resources/cost_centers?kind=analytic&pageSize=1")
  };
}
async function lancar(page: Page, r: Refs, tipo: "in" | "out", data: string, valor: string, nota: string): Promise<string> {
  const m = await api<{ id: string }>(page, "POST", "/api/financial/bank-movements", {
    empresa_id: r.empresa, bank_account_id: r.conta.id, movement_date: data, type: tipo, category_type: tipo, amount: valor, note: nota,
    apportionment: [{ financial_category_id: tipo === "in" ? r.receita : r.despesa, cost_center_id: r.centro, percentage: "100" }]
  });
  return m.id;
}
const movimento = (page: Page, id: string) => api<Movimento>(page, "GET", `/api/financial/bank-movements/${id}`);
const linha = (page: Page, fitid: string) => page.getByTestId("b1-row").filter({ has: page.locator(`[data-testid="fin-ofx-transacao"][data-fitid="${fitid}"]`) });
const marca = (page: Page, fitid: string) => page.locator(`[data-testid="fin-ofx-transacao"][data-fitid="${fitid}"]`);

/** Escolhe a opção num RefSelect DENTRO do escopo (a lista atrás do diálogo tem outro "Conta bancária", o do filtro). */
async function escolherRef(page: Page, escopo: Locator, rotulo: string, busca: string) {
  await escopo.locator("label", { hasText: rotulo }).first().locator("..").locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(busca);
  await painel.getByRole("option", { name: new RegExp(busca.slice(0, 12), "i") }).first().click();
}

/** A importação pela TELA: Conciliação → Importar OFX → conta, descrição e o arquivo sintético. */
async function importarPelaTela(page: Page, descricao: string, conteudo: string) {
  await page.goto("/financeiro?tab=conciliacao");
  await expect(page.getByTestId("fin-conciliacao")).toBeVisible();
  await page.getByTestId("fin-ofx-importar").click();
  const dialogo = page.getByTestId("fin-dialogo-ofx-importar");
  await expect(dialogo).toBeVisible();
  await escolherRef(page, dialogo, "Conta bancária", "Banco do Brasil");
  await dialogo.getByLabel(/^Descrição/).fill(descricao);
  await dialogo.getByTestId("fin-ofx-arquivo").setInputFiles({ name: "extrato.ofx", mimeType: "application/x-ofx", buffer: Buffer.from(conteudo, "utf8") });
  await dialogo.getByTestId("fin-ofx-importar-confirmar").click();
}

test.describe("Central Financeira · conciliação OFX", () => {
  test("OFX sintético: o Encontrado concilia na importação, a Sugestão e a Soma de vários pela confirmação — as três Conciliadas e a marca nos 4 movimentos", async ({ page }) => {
    await login(page);
    const r = await refs(page);
    const sufixo = `${Date.now().toString(36)}`;
    // Valores únicos (centavos da semente) e combinações que não se cruzam: M2+M3a, M2+M3b e M2+M3a+M3b > V3.
    const v1 = `5${SEMENTE}.${centavos(1)}`; const v2 = `3${SEMENTE}.${centavos(2)}`;
    const v3a = `1${SEMENTE}.${centavos(3)}`; const v3b = `2${SEMENTE}.${centavos(4)}`; const v3 = money(D(v3a).plus(v3b));
    const m1 = await lancar(page, r, "out", "2033-05-10", v1, `E2E conciliação exata ${sufixo}`);
    const m2 = await lancar(page, r, "in", "2033-05-12", v2, `E2E conciliação sugestão ${sufixo}`);
    const m3a = await lancar(page, r, "in", "2033-05-11", v3a, `E2E conciliação soma A ${sufixo}`);
    const m3b = await lancar(page, r, "in", "2033-05-12", v3b, `E2E conciliação soma B ${sufixo}`);
    for (const id of [m1, m2, m3a, m3b]) expect((await movimento(page, id)).reconciled_at, "premissa: o movimento nasce sem a marca de conciliado").toBeNull();
    const f = { exata: `E2E-EXATA-${sufixo}`, sugestao: `E2E-SUG-${sufixo}`, soma: `E2E-SOMA-${sufixo}` };
    const conteudo = ofxSintetico(r.conta.conta, [
      { fitid: f.exata, data: "2033-05-10", valor: `-${v1}`, memo: "TARIFA PACOTE" },
      { fitid: f.sugestao, data: "2033-05-10", valor: v2, memo: "TED RECEBIDA" },
      { fitid: f.soma, data: "2033-05-11", valor: v3, memo: "DEPOSITOS" }
    ]);

    await importarPelaTela(page, `Extrato E2E ${sufixo}`, conteudo);
    await expect(page, "a importação abre o detalhe novo").toHaveURL(/\/financeiro\/ofx\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("fin-ofx-detalhe")).toBeVisible();

    // Encontrado (mesmo valor e mesma data, 1:1) → conciliado já na importação.
    await expect(marca(page, f.exata)).toHaveAttribute("data-situacao", "matched");
    await expect(linha(page, f.exata)).toContainText("Conciliada");
    // Sugestão (mesmo valor, data +2 dias) → só com a confirmação humana.
    await expect(marca(page, f.sugestao)).toHaveAttribute("data-situacao", "pending");
    await expect(marca(page, f.sugestao)).toHaveAttribute("data-sugestao", "sugestao");
    await expect(linha(page, f.sugestao)).toContainText("Sugestão");
    // Soma de vários (dois movimentos que somam o valor do extrato).
    await expect(marca(page, f.soma)).toHaveAttribute("data-sugestao", "soma");
    await expect(linha(page, f.soma)).toContainText("Soma de vários");

    await linha(page, f.sugestao).getByTestId("fin-ofx-confirmar").click();
    await expect(marca(page, f.sugestao)).toHaveAttribute("data-situacao", "matched");
    await linha(page, f.soma).getByTestId("fin-ofx-confirmar").click();
    await expect(marca(page, f.soma)).toHaveAttribute("data-situacao", "matched");
    for (const fitid of Object.values(f)) await expect(linha(page, fitid), `${fitid} aparece Conciliada`).toContainText("Conciliada");

    // Conclusão no servidor: a marca está nos QUATRO movimentos, cada um ligado à sua transação.
    const tid = async (fitid: string) => (await marca(page, fitid).getAttribute("data-transacao-id"))!;
    const esperado: [string, string][] = [[m1, await tid(f.exata)], [m2, await tid(f.sugestao)], [m3a, await tid(f.soma)], [m3b, await tid(f.soma)]];
    for (const [id, t] of esperado) {
      const m = await movimento(page, id);
      expect(m.reconciled_at, `o movimento ${id} ficou conciliado`).not.toBeNull();
      expect(m.ofx_transaction_id, `o movimento ${id} aponta para a transação certa`).toBe(t);
    }
  });

  test("recusa: OFX de OUTRA conta → a mensagem do servidor na tela e nenhuma importação nova", async ({ page }) => {
    await login(page);
    const r = await refs(page);
    const outra = "99999999";
    expect(r.conta.conta.replace(/\D/g, ""), "premissa: a conta do arquivo NÃO é a cadastrada na BB").not.toBe(outra);
    const contar = async () => (await api<{ total: number }>(page, "GET", "/api/financeiro/conciliacao/importacoes?pageSize=1")).total;
    const antes = await contar();
    const sufixo = Date.now().toString(36);
    await importarPelaTela(page, `Extrato de outra conta ${sufixo}`, ofxSintetico(outra, [{ fitid: `E2E-OUTRA-${sufixo}`, data: "2033-05-20", valor: `7${SEMENTE}.${centavos(5)}`, memo: "CREDITO" }]));
    await expect(page.getByTestId("fin-ofx-importar-erro")).toContainText("O arquivo OFX é de outra conta");
    await expect(page, "a tela continua na lista: nada foi importado").not.toHaveURL(/\/financeiro\/ofx\//);
    expect(await contar(), "nenhuma importação nova no servidor").toBe(antes);
  });

  test("Desfazer com motivo: a transação volta a Pendente e o movimento fica livre", async ({ page }) => {
    await login(page);
    const r = await refs(page);
    const sufixo = Date.now().toString(36);
    const valor = `4${SEMENTE}.${centavos(6)}`;
    const id = await lancar(page, r, "in", "2033-05-25", valor, `E2E desfazer ${sufixo}`);
    const fitid = `E2E-DESF-${sufixo}`;
    const imp = await api<{ id: string; conciliadas_automaticamente: number }>(page, "POST", "/api/financeiro/conciliacao/importacoes", {
      conta_id: r.conta.id, descricao: `Extrato desfazer ${sufixo}`, conteudo: ofxSintetico(r.conta.conta, [{ fitid, data: "2033-05-25", valor, memo: "CREDITO" }])
    });
    expect(imp.conciliadas_automaticamente, "premissa: o Encontrado foi conciliado na importação").toBe(1);
    expect((await movimento(page, id)).reconciled_at, "premissa: o movimento está conciliado").not.toBeNull();

    await page.goto(`/financeiro/ofx/${imp.id}`);
    await expect(marca(page, fitid)).toHaveAttribute("data-situacao", "matched");
    await linha(page, fitid).getByTestId("fin-ofx-desfazer").click();
    const dialogo = page.getByRole("dialog");
    await dialogo.getByLabel(/^Motivo/).fill("Conciliado com o movimento errado");
    await dialogo.getByRole("button", { name: "Desfazer" }).click();
    await expect(marca(page, fitid)).toHaveAttribute("data-situacao", "pending");
    await expect(linha(page, fitid)).toContainText("Pendente");

    const m = await movimento(page, id);
    expect(m.reconciled_at, "o movimento perdeu a marca de conciliado").toBeNull();
    expect(m.ofx_transaction_id, "e o vínculo com a transação").toBeNull();
  });
});
