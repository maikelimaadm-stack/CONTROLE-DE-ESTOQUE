import { test, expect, type Locator, type Page } from "@playwright/test";
import { entendeSaldoInicialEstoque, familiaOperacionalDeDocumentoEstoque } from "@agro/domain";
import { login, api } from "./helpers";
import { cadastroDeEstoque, hojeISO } from "./estoque-01-comum";
import { cfg5, criarTopViaApi, detalheTopNoServidor } from "./top-config-08-comum";
import { fonteDoWebContem, shaDaBase } from "./skew-fonte-da-base";

/**
 * OPERACOES-01 F11 · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (decisão 288; a janela "API antes do web").
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD). Arquivo próprio
 * (molde `top-config-08-skew-web-anterior.spec.ts`).
 *
 * O QUE SE MEDE. A API desta fase só ACRESCENTA no `operation-types` da entrada (`capacidades.saldoInicial` e
 * `items[].saldoInicial`), e a rota antiga do saldo inicial (`POST /api/stock/opening-balances`) continua com o mesmo
 * corpo e a mesma resposta — mas passa a recusar (409, a MESMA mensagem de sempre) também o saldo inicial vivo que veio
 * de um DOCUMENTO NOVO (a entrada da Central com a TOP marcada): a regra é uma só. O navegador roda o bundle EXATO da
 * base, e:
 *   · o diálogo antigo da Implantação grava pela rota antiga (201) numa chave sem saldo inicial;
 *   · na chave em que o documento novo deu o saldo inicial, o MESMO diálogo recebe o 409 e mostra a mensagem (toast); o
 *     razão não ganha linha, e a lista antiga não ganha documento.
 *
 * O MUNDO, NESTE SENTIDO, É O DO WEB DA BASE, lido do FONTE do commit dela (`fonteDoWebContem`): o painel antigo com o
 * "Adicionar novo" (a premissa: é ele que se dirige) e, se o web da base já for o da F11 (a marca
 * `implantacao-saldo-inicial-dica`), a dica aparece — a TOP marcada do caso é DESATIVADA depois de lançar o documento,
 * para a Implantação da base não ter TOP marcada para oferecer. A API deste HEAD é PREMISSA: declara `saldoInicial`.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const ROTA_IMPLANTACAO = "/configuracoes?tab=implantacao&sub=estoque";
const MENSAGEM = "Já existe estoque inicial confirmado para este produto/local de estoque/lote";

/** O painel antigo (o que o caso dirige) e a marca do painel da F11, no fonte do web da base. */
const MARCA_DO_PAINEL_ANTIGO = "title=\"Estoques Iniciais\"";
const MARCA_DO_BOTAO_ANTIGO = ">Adicionar novo</Button>";
const MARCA_DA_F11 = "data-testid=\"implantacao-saldo-inicial-dica\"";

/** Cabeçalhos da sessão gravada pelo web da base depois do login, para falar com a API deste HEAD direto. Nunca impressos. */
async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/** Vigia do navegador: CORS morto e erro de contrato (404, 422, 5xx) não passam calados. O 409 do caso é RESPOSTA. */
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

/** Escolhe num RefSelect DENTRO do diálogo, pelo rótulo do campo (o painel de pesquisa é o último aberto). */
async function escolherNoDialogo(page: Page, dialogo: Locator, rotulo: string | RegExp, nome: string) {
  await dialogo.locator("label", { hasText: rotulo }).first().locator("..").locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: new RegExp(nome.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first().click();
}

/** O diálogo antigo da Implantação do web da base: preenche e salva; devolve o status do POST da rota antiga. */
async function lancarPeloDialogo(page: Page, c: { nomeArmazem: string; nomeProduto: string }, quantidade: string): Promise<number> {
  await page.getByRole("button", { name: "Adicionar novo" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByRole("heading", { name: "Novo estoque inicial" })).toBeVisible();
  // O rótulo do web da base: "Armazém" antes da troca de texto da OPERACOES-01 (F3), "Local de estoque" depois.
  await escolherNoDialogo(page, dialogo, /^(Local de estoque|Armazém)/, c.nomeArmazem);
  await escolherNoDialogo(page, dialogo, "Produto", c.nomeProduto);
  await dialogo.getByLabel("Quantidade total").fill(quantidade);
  await dialogo.getByLabel("Valor unitário").fill("4");
  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/stock/opening-balances");
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  return (await post).status();
}

const movimentosDoProduto = async (page: Page, armazem: string, produto: string) =>
  (await api<{ items: unknown[]; total: number }>(page, "GET", `/api/stock/movements?warehouse_id=${armazem}&product_id=${produto}&page=1&pageSize=50`)).total;

test("OP01-F11 · K-2 (sentido 2) — o diálogo antigo do web da base grava pela rota antiga (201) e recebe o 409 com a mesma mensagem quando o saldo inicial veio do documento novo", async ({ page }) => {
  const base = shaDaBase();
  // O MUNDO DO WEB DA BASE, lido do fonte do commit: o painel antigo com o "Adicionar novo" é a premissa do caso.
  expect(fonteDoWebContem(base, MARCA_DO_PAINEL_ANTIGO), "premissa: o web da base tem o painel antigo dos estoques iniciais").toBe(true);
  expect(fonteDoWebContem(base, MARCA_DO_BOTAO_ANTIGO), "premissa: e o 'Adicionar novo' dele").toBe(true);
  const baseComF11 = fonteDoWebContem(base, MARCA_DA_F11);
  console.log(`[skew] OP01-F11 · K-2 · o web da base ${baseComF11 ? "JÁ TEM" : "NÃO tem"} a Implantação da F11`);

  await login(page);
  const cab = await cabecalhosDaSessao(page);
  // PREMISSA: a API no ar é a desta fase — a entrada declara `saldoInicial`.
  const ops = await page.request.get(`${API}/api/estoque/entradas/operation-types`, { headers: cab });
  expect(ops.status()).toBe(200);
  expect(entendeSaldoInicialEstoque(((await ops.json()) as { capacidades?: unknown }).capacidades), "premissa: a API deste HEAD declara `saldoInicial`").toBe(true);

  // O SALDO INICIAL PELO DOCUMENTO NOVO na chave X (produto A), com a TOP marcada — depois a TOP é desativada.
  const familia = familiaOperacionalDeDocumentoEstoque("entrada");
  expect(familia, "premissa: a família da entrada no registry").toBe("estoque.entrada");
  const top = await criarTopViaApi(page, familia!, cfg5({}, (x) => ({ ...x, implantacao: { saldoInicial: true } })), { rotulo: "Saldo inicial K-2" });
  const a = await cadastroDeEstoque(page);
  const b = await cadastroDeEstoque(page);
  expect(b.armazem, "premissa: os dois produtos no mesmo local de estoque").toBe(a.armazem);
  const doc = await api<{ id: string }>(page, "POST", "/api/estoque/entradas", {
    empresa_id: a.empresa, tipo_operacao_id: top.id, armazem_id: a.armazem, data_documento: hojeISO(),
    itens: [{ produto_id: a.produto, quantidade: "2", custo_unitario: "5" }]
  });
  await api(page, "POST", `/api/estoque/entradas/${doc.id}/confirmar`, {});
  const lido = await api<{ movimentos: { movement_type: string }[] }>(page, "GET", `/api/estoque/entradas/${doc.id}`);
  expect(lido.movimentos.map((m) => m.movement_type), "premissa: o documento novo deu o saldo inicial da chave X").toEqual(["opening_balance"]);
  const revisao = (await detalheTopNoServidor(page, top.id)).revisao;
  await api(page, "PUT", `/api/admin/tipos-operacao/${top.id}`, { ativo: false, revisao });

  const v = vigiar(page);
  await page.goto(ROTA_IMPLANTACAO);
  await expect(page.getByRole("heading", { name: "Estoques Iniciais" }), "premissa: a Implantação da base abriu").toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar novo" }), "o 'Adicionar novo' do painel da base").toBeVisible();
  if (baseComF11) await expect(page.getByTestId("implantacao-saldo-inicial-dica"), "a base da F11 sem TOP marcada: a dica").toBeVisible();

  // (1) Chave sem saldo inicial (produto B): a rota antiga grava, como sempre.
  expect(await lancarPeloDialogo(page, b, "3"), "a API nova aceita o diálogo antigo").toBe(201);
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("table").getByText(b.nomeProduto).first(), "a linha aparece").toBeVisible();
  expect((await api<{ quantity: string }>(page, "GET", `/api/stock/balances/${b.armazem}/${b.produto}`)).quantity).toBe("3.0000");

  // (2) Chave X (produto A, saldo inicial do documento novo): 409 com a mesma mensagem; nada gravado.
  const antes = await movimentosDoProduto(page, a.armazem, a.produto);
  expect(antes, "premissa: o produto A tem o movimento do documento novo").toBe(1);
  expect(await lancarPeloDialogo(page, a, "1"), "a regra é uma só: a rota antiga recusa o saldo inicial do documento").toBe(409);
  await expect(page.getByText(MENSAGEM).first(), "o web da base mostra a mensagem do servidor").toBeVisible();
  expect(await movimentosDoProduto(page, a.armazem, a.produto), "o razão não ganhou linha").toBe(antes);
  const antigos = await api<{ total: number }>(page, "GET", `/api/stock/opening-balances?search=${encodeURIComponent(a.nomeProduto)}`);
  expect(antigos.total, "a lista antiga não ganhou documento do produto A").toBe(0);
  v.semErroDeContrato();
  v.semBloqueio();
});
