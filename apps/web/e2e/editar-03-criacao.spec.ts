import { CLASSIFICACAO_DO_SEED, login, pickRef, preencherClassificacaoFinanceira } from "./helpers";
import { test, expect } from "./central-compras-fixtures";
import { abrirAba, cenarioDeVenda, escolherNaCelula, identidade, lerDoc, linhas, ouvirOFio, topDeVendaManual, type Cadastro } from "./editar-03-comum";

/**
 * EDITAR-03 (decisão 315) — A CRIAÇÃO DE VENDA CONTINUA A MESMA DEPOIS DO MOVIMENTO DO FORMULÁRIO.
 *
 * O formulário da Central de Vendas saiu da página `vendas/[kind]/new` para `features/sales/central-vendas-formulario.tsx`
 * (a edição é um RAMO dele). Este caso monta UMA venda por um cenário FIXO, pela tela, e confere o corpo do POST INTEIRO
 * — chave a chave, valor a valor — contra o corpo que o contrato da criação monta para aquele cenário, e o que o servidor
 * gravou. O MESMO arquivo rodou no fonte da base (o web sem a fatia: o fonte dela guardado à parte e restaurado por cópia,
 * `cmp` idêntico) e nesta árvore: os dois verdes, e a linha `CORPO-DA-CRIACAO-EDITAR-03` (os ids trocados pelo papel no
 * cenário, a data do dia por `<hoje>`) byte a byte igual nas duas (`docs/TESTING.md`, a linha da EDITAR-03).
 *
 * O cenário: a TOP de venda Manual do caso; o "Local de estoque" do cabeçalho em L1 (a linha nova nasce com ele); a
 * linha 1 com P1 em L1, 2 × 10; a linha 2 com P2, o local trocado na célula para L2, 1 × 5,5; o cliente do caso; a
 * natureza e o centro do seed; frete 3 e a observação.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const hojeUTC = () => new Date().toISOString().slice(0, 10);

test("E3-C1 — a criação de venda pela Central: o corpo do POST de um cenário fixo é EXATAMENTE o do contrato da criação (o mesmo da base), sem chave da edição; o servidor grava o mesmo", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDeVenda(page, "E3-C1");
  const top = await topDeVendaManual(page, "E3-C1");
  const antesDoDia = hojeUTC();

  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId("top-contexto"), "a Central abriu o formulário desta TOP").toBeVisible();
  // o Local de estoque do cabeçalho: L1
  const campoDoLocal = page.getByTestId("central-vendas-local-padrao");
  await campoDoLocal.locator("button").first().click();
  const painelDoLocal = page.locator("[data-radix-popper-content-wrapper]").last();
  await painelDoLocal.getByPlaceholder(/^Pesquisar/).first().fill(c.l1.nome);
  await painelDoLocal.getByRole("option", { name: c.l1.nome }).first().click();
  await expect(campoDoLocal).toContainText(c.l1.nome);

  const preencherLinha = async (i: number, produto: Cadastro, quantidade: string, unitario: string) => {
    await escolherNaCelula(page, linhas(page).nth(i).getByTestId("central-vendas-produto"), produto.nome);
    const linha = linhas(page).nth(i);
    if ((await linha.getAttribute("aria-selected")) !== "true") await linha.getByTestId("central-vendas-selecionar-item").click();
    await linha.getByLabel(`Quantidade do item ${i + 1}`).fill(quantidade);
    await linha.getByLabel(`Valor unitário do item ${i + 1}`).fill(unitario);
  };
  await page.getByTestId("central-vendas-adicionar-item").click();
  await expect(linhas(page).nth(0).getByTestId("central-vendas-armazem"), "a linha nova nasce com o local do cabeçalho").toContainText(c.l1.nome);
  await preencherLinha(0, c.p1, "2", "10");
  // a linha 2 nasce em L1 (onde P2 tem saldo: a pesquisa da saída só oferece o que tem saldo no local da linha); escolhido
  // o produto, o local da LINHA é trocado para L2 na célula — o cabeçalho continua L1
  await page.getByTestId("central-vendas-adicionar-item").click();
  await preencherLinha(1, c.p2, "1", "5.5");
  await escolherNaCelula(page, linhas(page).nth(1).getByTestId("central-vendas-armazem"), c.l2.nome);
  await expect(campoDoLocal, "trocar o local da linha não mexe no cabeçalho").toContainText(c.l1.nome);
  await pickRef(page, "Cliente", c.cliente.nome);
  await preencherClassificacaoFinanceira(page);
  await abrirAba(page, "Frete e transporte");
  await page.getByTestId("central-vendas-painel").getByLabel("Frete", { exact: true }).fill("3");
  await abrirAba(page, "Observações");
  await page.getByTestId("central-vendas-painel").getByLabel("Observação", { exact: true }).fill("criação E3-C1");

  const fio = ouvirOFio(page);
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/sales/sales");
  await page.getByTestId("central-vendas-salvar").click();
  const r = await resposta;
  fio.parar();
  expect(r.status(), "o POST gravou").toBe(201);
  const corpo = r.request().postDataJSON() as Record<string, unknown>;
  const depoisDoDia = hojeUTC();
  expect([antesDoDia, depoisDoDia], "a data do documento é a do dia (UTC, `todayISO`)").toContain(corpo["document_date"]);
  expect([CLASSIFICACAO_DO_SEED.categoria.nome, CLASSIFICACAO_DO_SEED.centro.nome], "premissa: a classificação da tela é a do cenário").toEqual(["Venda de Boi Gordo", "Adm Geral"]);

  // O CORPO DO CONTRATO DA CRIAÇÃO para este cenário — chave a chave (nenhuma chave da edição: nem `version`, nem `id`).
  expect(corpo, "o corpo do POST, inteiro").toEqual({
    empresa_id: c.empresa, document_date: corpo["document_date"], shipping_date: null, due_date: null, client_id: c.cliente.id, transporter_id: null,
    proprietary_id: null, driver_name: null, payment_method_id: null, freight: "3", freight_icms: "0", other_values: "0", discount: "0",
    note: "criação E3-C1", is_deductible: false, installment_plan: null,
    items: [
      { product_id: c.p1.id, warehouse_id: c.l1.id, quantity: "2", unit_price: "10", discount: "0", discount_percent: "0", note: null },
      { product_id: c.p2.id, warehouse_id: c.l2.id, quantity: "1", unit_price: "5.5", discount: "0", discount_percent: "0", note: null }
    ],
    tipo_operacao_id: top, categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id
  });
  expect(Object.keys(corpo), "as chaves na ORDEM de sempre").toEqual([
    "empresa_id", "document_date", "shipping_date", "due_date", "client_id", "transporter_id", "proprietary_id", "driver_name", "payment_method_id", "freight",
    "freight_icms", "other_values", "discount", "note", "is_deductible", "installment_plan", "items", "tipo_operacao_id", "categoria_financeira_id", "centro_custo_id"
  ]);
  expect(fio.escritas, "uma escrita só: o POST da criação (nenhuma PATCH)").toEqual(["POST /api/sales/sales"]);
  const { id } = (await r.json()) as { id: string };

  // O QUE O SERVIDOR GRAVOU: a consulta abre o documento salvo, e o GET confere os valores.
  await expect(page).toHaveURL(new RegExp(`/vendas/sales/${id}`));
  const gravado = await lerDoc(page, "sale", id);
  await expect(identidade(page)).toHaveText(gravado.code);
  const papel = new Map<string, string>([[c.empresa, "<empresa>"], [c.cliente.id, "<cliente>"], [c.l1.id, "<L1>"], [c.l2.id, "<L2>"], [c.p1.id, "<P1>"], [c.p2.id, "<P2>"],
    [top, "<top>"], [c.natureza.id, "<natureza>"], [c.centro.id, "<centro>"], [String(corpo["document_date"]), "<hoje>"]]);
  const normal = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "string" && papel.has(x) ? papel.get(x) : x));
  expect({
    status: gravado.status, version: gravado.version, total: gravado.total, freight: gravado.freight, note: gravado.note, tipo: gravado.tipo_operacao_id,
    classificacao: [gravado.categoria_financeira_id, gravado.centro_custo_id], itens: gravado.items.map((i) => [i.product_id, i.warehouse_id, i.quantity, i.unit_price])
  }, "o gravado").toEqual({
    status: "open", version: "0", total: "28.50", freight: "3.00", note: "criação E3-C1", tipo: top, classificacao: [c.natureza.id, c.centro.id],
    itens: [[c.p1.id, c.l1.id, "2.0000", "10.000000"], [c.p2.id, c.l2.id, "1.0000", "5.500000"]]
  });
  // A linha estável que a base e esta árvore comparam byte a byte (os ids pelo papel, a data por <hoje>).
  console.log(`CORPO-DA-CRIACAO-EDITAR-03 ${normal(corpo)}`);
  console.log(`GRAVADO-DA-CRIACAO-EDITAR-03 ${normal({ status: gravado.status, version: gravado.version, total: gravado.total, freight: gravado.freight, note: gravado.note, tipo: gravado.tipo_operacao_id, itens: gravado.items.map((i) => [i.product_id, i.warehouse_id, i.quantity, i.unit_price, i.note]) })}`);
});
