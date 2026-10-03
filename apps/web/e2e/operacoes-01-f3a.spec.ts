import { test, expect, type Locator, type Page } from "@playwright/test";
import { enumOptions } from "@agro/domain";
import { login, api } from "./helpers";
import { cadastroDeEstoque, hojeISO } from "./estoque-01-comum";

/**
 * OPERACOES-01 · F3a (decisão 280) — o que a fase muda NA TELA, em três cenários (o detalhe da regra mora no teste de
 * domínio `packages/domain/test/operacoes-01-f3a.test.ts` e no de API `operacoes-01-f3a-pesquisa-pessoas.test.ts`):
 *
 *   · F3A-W1 — o motivo da baixa `payment_with_product` tem rótulo: a lista de saídas diretas mostra "Pagamento com
 *     produto" (nunca o valor cru) e o formulário oferece os 13 motivos da fonte única (`enumOptions`);
 *   · F3A-W2 — o seletor de Parceiros acha por CNPJ com máscara, por razão social em minúsculas e por CNPJ alfanumérico
 *     em minúsculas. O web NÃO mudou: quem acha é o servidor, e o fio prova (o pedido leva só `search`, e o rótulo da
 *     opção não contém o que foi digitado — quem casou foi a razão social ou o documento normalizado);
 *   · F3A-W3 — "Local de estoque" / "Locais de estoque" nos títulos e campos do cadastro e da transferência.
 *
 * Tudo nasce pela API, no próprio teste, com nome e documento novos a cada execução: a conta nunca depende do que outro
 * spec deixou no banco, e nada é apagado (decisão 247). Os dois sentidos do version skew estão em arquivos próprios
 * (`operacoes-01-f3a-skew-api-producao.spec.ts` e `operacoes-01-f3a-skew-web-anterior.spec.ts`), fora desta suíte.
 */

type Opcao = { id: string; label: string; code: string | null };

const sorteio = (alfabeto: string, n: number) => Array.from({ length: n }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]!).join("");
const LETRAS = "abcdefghijklmnopqrstuvwxyz"; const DIGITOS = "0123456789";
/** CNPJ válido (numérico ou alfanumérico) a partir das 12 primeiras posições: valor = ASCII − 48, pesos da IN RFB 2.229/2024 (molde de `cadastros-parceiros.test.ts`). */
const cnpjDe = (base12: string) => { const v = (c: string) => c.charCodeAt(0) - 48; const dv = (s: string, p: number[]) => { const r = p.reduce((a, x, i) => a + v(s[i]!) * x, 0) % 11; return r < 2 ? 0 : 11 - r; }; const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return `${base12}${d1}${dv(`${base12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`; };
const fmtCnpj = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

/** Abre o seletor de referência de um campo do formulário de cadastro (`b1-form`), achado pelo rótulo. */
async function abrirSeletor(page: Page, rotulo: RegExp) {
  const rotulos = page.getByTestId("b1-form").locator("label", { hasText: rotulo });
  await expect(rotulos, `o formulário tem o campo ${rotulo}`).toHaveCount(1);
  // a caixa do campo é a irmã do rótulo: o pai dos dois é o campo
  const campo = rotulos.locator("..");
  await campo.getByRole("combobox").click();
  const painel = page.locator(".cmd-panel");
  await expect(painel.getByPlaceholder("Pesquisar..."), "a pesquisa do seletor abriu").toBeVisible();
  return { campo, painel };
}

/**
 * Digita no seletor aberto e devolve a resposta do SERVIDOR a ESTE texto (não a um pedido anterior que chegou
 * atrasado). Premissa no fio: o pedido leva SÓ `search`, igual ao digitado — o web não pede página, nem filtra.
 */
async function pesquisarNoSeletor(page: Page, painel: Locator, texto: string): Promise<Opcao[]> {
  const resposta = page.waitForResponse((r) => { const u = new URL(r.url()); return u.pathname === "/api/resources/people/options" && u.searchParams.get("search") === texto; });
  await painel.getByPlaceholder("Pesquisar...").fill(texto);
  const r = await resposta;
  expect(r.status(), `a pesquisa "${texto}" responde 200`).toBe(200);
  expect([...new URL(r.url()).searchParams.keys()], "o pedido do seletor leva só `search` (sem page/pageSize, sem filtro)").toEqual(["search"]);
  const corpo = (await r.json()) as Opcao[];
  expect(Array.isArray(corpo), "a resposta continua um array").toBe(true);
  return corpo;
}

test("F3A-W1 · o motivo payment_with_product aparece como \"Pagamento com produto\" na lista de saídas diretas, e o formulário oferece os 13 motivos do domínio", async ({ page }) => {
  await login(page);
  const c = await cadastroDeEstoque(page);
  await api(page, "POST", "/api/stock/opening-balances", { empresa_id: c.empresa, warehouse_id: c.armazem, product_id: c.produto, quantity: "5", unit_value: "3" });
  const baixa = await api<{ id: string; code: string }>(page, "POST", "/api/stock/writeoffs", {
    empresa_id: c.empresa, writeoff_date: hojeISO(), reason: "payment_with_product", warehouse_id: c.armazem,
    justification: "F3A-W1 pagamento com produto", items: [{ product_id: c.produto, quantity: "1" }]
  });
  // PREMISSA: a API gravou o valor cru — é ele que a lista recebe e tem de traduzir
  const lida = await api<{ reason: string; code: string }>(page, "GET", `/api/stock/writeoffs/${baixa.id}`);
  expect(lida.reason, "premissa: a baixa foi gravada com o motivo payment_with_product").toBe("payment_with_product");
  expect(lida.code, "premissa: o código da resposta é o do registro").toBe(baixa.code);

  await page.goto("/estoque?tab=operacoes&sub=diretas");
  const lista = page.getByTestId("b1-list");
  await expect(lista, "a lista de saídas diretas abre").toBeVisible();
  // a linha é achada pelo CÓDIGO, pelo filtro da grade (o servidor recorta: `code__contains`)
  await page.getByRole("button", { name: "Filtro Código", exact: true }).click();
  await page.getByRole("textbox", { name: "Código", exact: true }).fill(baixa.code);
  await page.keyboard.press("Enter");
  const linha = lista.getByTestId("b1-row").filter({ has: page.getByRole("cell", { name: baixa.code, exact: true }) });
  await expect(linha, "a baixa criada aparece na lista").toHaveCount(1);

  // a célula da coluna "Motivo" (a posição sai do cabeçalho, não de um número fixo)
  const titulos = (await lista.locator("thead th").allInnerTexts()).map((t) => t.trim());
  const iMotivo = titulos.indexOf("Motivo");
  expect(iMotivo, `premissa: a lista tem a coluna Motivo (${JSON.stringify(titulos)})`).toBeGreaterThan(0);
  await expect(linha.locator("td"), "premissa: a linha tem uma célula por coluna do cabeçalho").toHaveCount(titulos.length);
  await expect(linha.locator("td").nth(iMotivo), "o motivo sai pelo rótulo").toHaveText("Pagamento com produto");
  await expect(linha, "o valor cru nunca aparece").not.toContainText("payment_with_product");

  // o formulário de nova baixa: os motivos são os da fonte única, na ordem dela (o CHECK da 0003)
  const motivos = enumOptions("writeoff_reason");
  expect(motivos.length, "premissa: o domínio declara os 13 motivos do CHECK").toBe(13);
  expect(motivos, "premissa: com o rótulo do motivo que faltava").toContainEqual({ value: "payment_with_product", label: "Pagamento com produto" });
  await page.goto("/estoque/baixas/new");
  await expect(page.getByRole("heading", { name: "Nova baixa de estoque" })).toBeVisible();
  const select = page.getByLabel(/^Motivo da baixa/);
  const oferecidos = await select.locator("option").evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, label: (o.textContent ?? "").trim() })));
  expect(oferecidos, "o formulário oferece exatamente os 13 motivos do domínio, com o rótulo de cada um").toEqual(motivos);
});

test("F3A-W2 · o seletor de Parceiros acha por CNPJ com máscara, por razão social em minúsculas e por CNPJ alfanumérico em minúsculas — e a escolha aparece na caixa", async ({ page }) => {
  await login(page);
  const s = sorteio(LETRAS, 7);
  // documentos novos a cada execução; matriz "0001" com raiz que começa por 7, e um alfanumérico com letras de verdade
  const cnpjNum = cnpjDe(`7${sorteio(DIGITOS, 7)}0001`);
  const cnpjAlfa = cnpjDe(`${sorteio("ABCDEFGHJKLMNPQRSTUVWXYZ", 2)}${sorteio(DIGITOS, 2)}${sorteio("ABCDEFGHJKLMNPQRSTUVWXYZ", 2)}${sorteio(DIGITOS, 6)}`);
  const nomeNum = `W2 Fantasia ${s}`; const nomeAlfa = `W2 Alfa ${s}`;
  const pjNum = await api<{ id: string }>(page, "POST", "/api/resources/people", { person_type: "legal", name: nomeNum, legal_name: `W2 Razão ${s} Ltda`, document: fmtCnpj(cnpjNum), is_client: true });
  const pjAlfa = await api<{ id: string }>(page, "POST", "/api/resources/people", { person_type: "legal", name: nomeAlfa, legal_name: `W2 Outra ${s} SA`, document: fmtCnpj(cnpjAlfa), is_client: true });
  // PREMISSA: o servidor guarda o documento SEM máscara e com as letras em maiúsculas — o que se digita abaixo (com
  // máscara, em minúsculas) só casa pela normalização, nunca por igualdade de texto
  for (const [id, cnpj] of [[pjNum.id, cnpjNum], [pjAlfa.id, cnpjAlfa]] as const) {
    const p = await api<{ document: string }>(page, "GET", `/api/resources/people/${id}`);
    expect(p.document, "premissa: o documento gravado é o normalizado").toBe(cnpj);
  }
  expect(/[A-Z]/.test(cnpjAlfa), "premissa: o CNPJ alfanumérico tem letras").toBe(true);

  // todo pedido do seletor de pessoas, no fio
  const pedidos: URL[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname === "/api/resources/people/options") pedidos.push(u); });

  await page.goto("/cadastros/teams/new");
  await expect(page.getByTestId("b1-form"), "o formulário de Equipe abre").toBeVisible();
  const { campo, painel } = await abrirSeletor(page, /^Encarregado/);
  const opcao = (nome: string) => painel.getByRole("option", { name: literal(nome) });

  // (a) CNPJ numérico COM máscara
  const a = fmtCnpj(cnpjNum);
  const ra = await pesquisarNoSeletor(page, painel, a);
  const itemA = ra.find((o) => o.id === pjNum.id);
  expect(itemA, "o servidor acha o parceiro pelo CNPJ com máscara").toBeTruthy();
  expect(itemA!.label, "o rótulo é o nome fantasia").toBe(nomeNum);
  expect(itemA!.label.includes(a) || itemA!.label.includes(cnpjNum), "premissa: o rótulo não contém o documento — quem casou foi o documento normalizado").toBe(false);
  expect(ra.map((o) => o.id), "o outro parceiro não casa").not.toContain(pjAlfa.id);
  await expect(opcao(nomeNum), "a opção aparece na tela").toBeVisible();
  await expect(opcao(nomeAlfa)).toHaveCount(0);

  // (b) razão social em minúsculas
  const b = `w2 razão ${s}`;
  const rb = await pesquisarNoSeletor(page, painel, b);
  expect(rb.map((o) => o.id), "o servidor acha pela razão social").toContain(pjNum.id);
  expect(rb.map((o) => o.id)).not.toContain(pjAlfa.id);
  expect(nomeNum.toLowerCase().includes(b), "premissa: o rótulo não contém o texto — quem casou foi a razão social").toBe(false);
  await expect(opcao(nomeNum)).toBeVisible();
  await expect(opcao(nomeAlfa)).toHaveCount(0);

  // (c) CNPJ alfanumérico em minúsculas, com máscara
  const cTexto = fmtCnpj(cnpjAlfa).toLowerCase();
  expect(cTexto, "premissa: o texto digitado tem letras minúsculas").not.toBe(cTexto.toUpperCase());
  const rc = await pesquisarNoSeletor(page, painel, cTexto);
  expect(rc.map((o) => o.id), "o servidor acha pelo CNPJ alfanumérico (as letras contam)").toContain(pjAlfa.id);
  expect(rc.map((o) => o.id)).not.toContain(pjNum.id);
  await expect(opcao(nomeAlfa)).toBeVisible();
  await expect(opcao(nomeNum)).toHaveCount(0);
  await opcao(nomeAlfa).click();
  await expect(painel, "escolher fecha o seletor").toHaveCount(0);
  await expect(campo.getByRole("combobox"), "a escolha aparece na caixa").toHaveText(nomeAlfa);

  expect(pedidos.length, "premissa: o fio registrou os pedidos do seletor").toBeGreaterThanOrEqual(3);
  for (const u of pedidos) expect([...u.searchParams.keys()].filter((k) => k !== "search"), `${u.search}: o web só manda \`search\``).toEqual([]);
});

test("F3A-W3 · \"Local de estoque\" e \"Locais de estoque\" no cadastro e na transferência", async ({ page }) => {
  await login(page);
  // o CADASTRO: a importação diz o plural, e o registro novo diz o singular (rótulos do registro de cadastros)
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first(), "premissa: a lista de locais de estoque tem registros").toBeVisible();
  await page.getByLabel("Mais opções").click();
  await page.getByRole("menuitem", { name: "Importar planilha" }).click();
  const importar = page.getByTestId("importar-dialogo");
  await expect(importar.getByRole("heading", { name: "Importar locais de estoque", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(importar).toHaveCount(0);
  await page.getByRole("button", { name: "Novo", exact: true }).click();
  await expect(page.getByTestId("b1-form"), "o registro novo diz o singular").toContainText("Novo local de estoque");

  // a TRANSFERÊNCIA entre locais de estoque: título, tipo e os dois campos
  await page.goto("/estoque/transferencias/new?kind=warehouse");
  await expect(page.getByRole("heading", { name: "Transferência entre locais de estoque", exact: true })).toBeVisible();
  const tipo = page.getByLabel("Tipo de movimentação");
  await expect(tipo).toHaveValue("warehouse");
  await expect(tipo.locator("option:checked")).toHaveText("Entre locais de estoque");
  const rotulos = page.locator("label");
  await expect(rotulos.filter({ hasText: /^Local de estoque \*$/ }), "o campo da origem").toHaveCount(1);
  await expect(rotulos.filter({ hasText: /^Local de estoque de destino \*$/ }), "o campo do destino").toHaveCount(1);
  // e entre empresas: "Transferência de estoque entre empresas", com o destino ainda dito local de estoque
  await tipo.selectOption("farm");
  await expect(page.getByRole("heading", { name: "Transferência de estoque entre empresas", exact: true })).toBeVisible();
  await expect(rotulos.filter({ hasText: /^Empresa destino \*$/ })).toHaveCount(1);
  await expect(rotulos.filter({ hasText: /^Local de estoque de destino \*$/ })).toHaveCount(1);
});
