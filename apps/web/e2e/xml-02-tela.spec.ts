import type { Locator, Page } from "@playwright/test";
import { api, login } from "./helpers";
import { test as testeDaCentral, expect, criarCadastro } from "./central-compras-fixtures";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import {
  API, ROTULO, TEXTO_DA_CONFERENCIA_DA_REFERENCIA, TEXTO_DA_CONFERENCIA_DO_PALPITE, abrirConferencia, caixaDoProduto, caminho, campoDoFormulario, cenarioDaXml02,
  escapar, escolherNoSeletor, gerarCompraPelaTela, importarNota, itemDo, lembrarNoCorpo, lerConferencia, produtoDo, resumoDoVinculo, rotuloDoCampoDoProduto,
  totalDeVinculosLembrados, vinculoDe, vinculosLembradosDo, type CenarioDaXml02, type ConferenciaNoFio
} from "./xml-02-comum";

/**
 * XML-02 (decisão 314) — O ITEM DA NOTA ENCONTRA O PRODUTO QUE JÁ EXISTE, NA TELA DA CONFERÊNCIA. Os casos X2-T1 a X2-T6.
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA (web e API deste HEAD; o cenário em `xml-02-comum.ts`) ──────────────────────────┐
 * │ Os PALPITES na tela são dois (decisão 314 e a do dono no 21214fd5): a DESCRIÇÃO semelhante e a REFERÊNCIA do │
 * │ produto (identidade no servidor, palpite na tela). Os dois vêm escolhidos, com "Lembrar" DESMARCADO, a linha │
 * │ que pede a conferência e "Criar produto". A identidade da tela é o código do fornecedor e o código de barras.│
 * │ X2-T1 a tela diz DE ONDE veio o sugerido: o item da DESCRIÇÃO semelhante com "Sugerido (descrição           │
 * │       semelhante)", a linha que pede a conferência, o produto já escolhido, "Lembrar" DESMARCADO e "Criar      │
 * │       produto" (o diálogo abre com a descrição, a NCM e a unidade da nota); o da REFERÊNCIA com "Sugerido      │
 * │       (referência do produto)", a linha DELA, o produto escolhido, "Lembrar" DESMARCADO e "Criar produto" (o   │
 * │       diálogo com a descrição e a NCM da nota, sem unidade: a referência não traz pré-preenchimento). O GET   │
 * │       da conferência no fio é o mesmo da leitura direta, e traz o pré-preenchimento só no da descrição.      │
 * │ X2-T2 R7, PELO FIO E PELO BANCO: o "Gerar compra" sem tocar no "Lembrar" manda `lembrar_vinculo: false` nos  │
 * │       DOIS (descrição e referência), 201; `erp.produto_fornecedor_vinculos` NÃO ganha nenhum par do          │
 * │       fornecedor (contado antes e depois); a nota seguinte do mesmo fornecedor traz os dois de novo como      │
 * │       SUGERIDOS (descrição e referência), nenhum lembrado (o palpite não virou vínculo).                     │
 * │ X2-T3 marcar o "Lembrar" dos dois palpites é a confirmação: o corpo manda `true` nos dois e o banco ganha os │
 * │       dois pares; a nota seguinte traz os dois LEMBRADOS.                                                    │
 * │ X2-T4 o LOTE: o sugerido pela descrição NÃO entra no "Criar N produtos da nota" enquanto tem o produto       │
 * │       escolhido; tirado o produto (o "Limpar" da caixa), entra (`data-quantidade` sobe 1) — e o da           │
 * │       referência nunca entra, nem com o produto nem sem ele (o lote olha a identidade do servidor).          │
 * │ X2-T5 a TROCA DE FORNECEDOR (o parceiro ambíguo, escolhido na aba Cabeçalho) não leva o "Lembrar" marcado    │
 * │       para os palpites: a descrição e a referência voltam desmarcadas; a marcação que a pessoa mudou num item │
 * │       de identidade da tela (o código de barras, desmarcado à mão) fica.                                     │
 * │ X2-T6 a pessoa CORRIGE o palpite e a escolha DELA é lembrada (`lembrarAoTrocarProduto`, achado do A5): a      │
 * │       referência aponta para o produto errado e a pessoa escolhe OUTRO no seletor ⇒ "Lembrar" MARCADO; de     │
 * │       volta ao produto do palpite ⇒ desmarcado; outro de novo ⇒ marcado. O palpite da descrição trocado pelo  │
 * │       "Criar produto" ⇒ o produto criado escolhido e "Lembrar" marcado. O Gerar compra manda os produtos       │
 * │       ESCOLHIDOS com `lembrar_vinculo: true`, 201; o banco ganha os dois pares → os produtos escolhidos (0 → 2) │
 * │       e a nota seguinte traz os dois LEMBRADOS, com os produtos da pessoa.                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O XML é SINTÉTICO (`notaSinteticaDeVariosItens`). Os cadastros do caso nascem pela API e são excluídos (lógica)
 * pela fixture da Central no fim do caso, verde ou não; o produto que a TELA cria ("Criar produto", no X2-T6), pela
 * fixture `produtosDaTela` daqui, também verde ou não. As compras e as importações ficam (ledger; decisão 247), e os
 * vínculos lembrados também (cadastro da organização que não se apaga; o fornecedor de cada caso é novo). O banco é
 * lido só com SELECT, recortado pelo fornecedor do caso.
 */

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A fixture: os produtos que a TELA criou (o diálogo "Criar produto"), excluídos (lógica) no fim do caso — verde ou não. */
const test = testeDaCentral.extend<{ produtosDaTela: Set<string> }>({
  produtosDaTela: async ({ page }, use) => {
    const ids = new Set<string>();
    await use(ids);
    if (ids.size === 0) return;
    const falhas: string[] = [];
    let cabecalhos: Record<string, string> | null = null;
    try { cabecalhos = await cabecalhosDaSessao(page); } catch (e) { falhas.push(`credencial da sessão: ${mensagem(e)}`); }
    for (const id of [...ids].reverse()) {
      if (!cabecalhos) { falhas.push(`products ${id}: não excluído (sem a credencial da sessão)`); continue; }
      try {
        const r = await page.request.fetch(`${API}/api/resources/products/${id}`, { method: "DELETE", headers: cabecalhos });
        if (!r.ok()) falhas.push(`products ${id}: ${r.status()} ${(await r.text()).slice(0, 200)}`);
      } catch (e) { falhas.push(`products ${id}: ${mensagem(e)}`); }
    }
    expect(falhas, "a limpeza excluiu os produtos que a tela criou").toEqual([]);
  }
});

/** Um campo de referência do FORMULÁRIO do produto: abre a caixa, pesquisa e escolhe a opção de rótulo EXATO. */
async function escolherNoFormulario(page: Page, campo: Locator, rotulo: string, nome: string) {
  await campo.locator("[role='combobox']").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(rotulo);
  await painel.getByRole("option").filter({ has: page.locator("span.truncate", { hasText: new RegExp(`^${escapar(rotulo)}$`) }) }).first().click();
  await expect(campo.locator("[role='combobox']").first(), `${nome}: a caixa ficou com a escolha`).toContainText(rotulo);
}

/**
 * As premissas do cenário D + R (+ N, + G), pela leitura direta: a origem de cada sugerido e o pré-preenchimento só no da
 * descrição (o servidor não mudou com o 21214fd5: a referência continua identidade para ele, sem pré-preenchimento).
 */
function premissasDoCenario(c: CenarioDaXml02, conf: ConferenciaNoFio, contexto: string) {
  const d = itemDo(c, "D"); const r = itemDo(c, "R");
  expect(resumoDoVinculo(vinculoDe(conf, d)), `${contexto}: o item ${d} é SUGERIDO pela DESCRIÇÃO, com o produto cadastrado à mão`).toEqual(["sugerido", "descricao", produtoDo(c, "D").id]);
  expect(resumoDoVinculo(vinculoDe(conf, r)), `${contexto}: o item ${r} é SUGERIDO pela REFERÊNCIA`).toEqual(["sugerido", "reference", produtoDo(c, "R").id]);
  const itemD = c.itens[d - 1]!;
  expect(vinculoDe(conf, d).preenchimento, `${contexto}: o palpite da descrição leva o pré-preenchimento da nota (o do sem vínculo), com a unidade do uCom`)
    .toEqual({ description: itemD.descricao, ncm_code: itemD.ncm, barcode: null, measurement_id: c.unidadeDe(itemD.unidade).id });
  expect(Object.hasOwn(vinculoDe(conf, r), "preenchimento"), `${contexto}: a referência (identidade no servidor) NÃO leva pré-preenchimento`).toBe(false);
  if (c.n.N) expect(resumoDoVinculo(vinculoDe(conf, c.n.N)), `${contexto}: o item sem produto no cadastro fica sem vínculo`).toEqual(["nenhum", null, null]);
  if (c.n.G) {
    expect(resumoDoVinculo(vinculoDe(conf, c.n.G)), `${contexto}: o item ${c.n.G} é SUGERIDO pelo CÓDIGO DE BARRAS (identidade, sem fornecedor)`).toEqual(["sugerido", "codigo_barras", produtoDo(c, "G").id]);
    expect(Object.hasOwn(vinculoDe(conf, c.n.G), "preenchimento"), `${contexto}: o código de barras NÃO leva pré-preenchimento`).toBe(false);
  }
}

/* ═════════════════════════════════ X2-T1 ═════════════════════════════════ */

test("X2-T1 — a tela diz de onde veio o sugerido: a descrição semelhante e a referência são PALPITE — vêm com o produto, a linha que pede a conferência, \"Lembrar\" DESMARCADO e \"Criar produto\" (o diálogo com a descrição e a NCM da nota; a unidade só no da descrição)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenarioDaXml02(page, "T1", ["D", "R", "N"]);
  const d = itemDo(c, "D"); const r = itemDo(c, "R"); const semProduto = itemDo(c, "N");
  const pd = produtoDo(c, "D"); const pr = produtoDo(c, "R");
  const { id } = await importarNota(page, c);
  const direta = await lerConferencia(page, id);
  expect(direta, "premissa: a importação pendente, da empresa ativa, com o fornecedor (novo) encontrado pelo emitente")
    .toMatchObject({ situacao: "pendente", empresa: { id: c.empresa }, parceiro: { situacao: "encontrado", id: c.fornecedor }, fornecedorEscolhido: c.fornecedor });
  premissasDoCenario(c, direta, "premissa (leitura direta)");

  const noFio = await abrirConferencia(page, id);
  expect(noFio.itens.map((i) => [i.nItem, i.vinculo]), "o GET que a tela fez traz os MESMOS vínculos da leitura direta").toEqual(direta.itens.map((i) => [i.nItem, i.vinculo]));
  premissasDoCenario(c, noFio, "no fio");

  // O PALPITE DA DESCRIÇÃO: o rótulo, a linha da conferência, o produto escolhido, "Lembrar" desmarcado, "Criar produto".
  await expect(page.getByTestId(`importacao-item-${d}`)).toHaveAttribute("data-vinculo", "sugerido");
  await expect(page.getByTestId(`importacao-item-${d}-vinculo`), "o rótulo diz a origem").toHaveText(ROTULO.descricao);
  await expect(page.getByTestId(`importacao-item-${d}-sugestao-descricao`), "a linha que pede a conferência").toHaveText(TEXTO_DA_CONFERENCIA_DO_PALPITE);
  await expect(page.getByTestId(`importacao-item-${d}-sugestao-referencia`), "a linha da referência é só da referência").toHaveCount(0);
  await expect(caixaDoProduto(page, d), "o produto sugerido vem escolhido").toContainText(`${pd.codigo} — ${pd.descricao}`);
  await expect(page.getByTestId(`importacao-item-${d}-quantidade-interna`), "com o produto, a quantidade interna é calculada (fator 1)").toHaveText("5.0000");
  await expect(page.getByTestId(`importacao-item-${d}-fator`), "o fator do caminho 5 é 1").toHaveValue("1");
  await expect(page.getByTestId(`importacao-item-${d}-lembrar`), "R7: o palpite nasce com \"Lembrar\" DESMARCADO").not.toBeChecked();
  await expect(page.getByTestId(`importacao-item-${d}-criar-produto`), "o palpite oferece \"Criar produto\", como o sem vínculo").toBeVisible();

  // O PALPITE DA REFERÊNCIA (decisão do dono): o rótulo, a linha DELA, o produto escolhido, "Lembrar" desmarcado, "Criar produto".
  await expect(page.getByTestId(`importacao-item-${r}`)).toHaveAttribute("data-vinculo", "sugerido");
  await expect(page.getByTestId(`importacao-item-${r}-vinculo`), "o rótulo diz a origem").toHaveText(ROTULO.referencia);
  await expect(page.getByTestId(`importacao-item-${r}-sugestao-referencia`), "a linha que pede a conferência da referência").toHaveText(TEXTO_DA_CONFERENCIA_DA_REFERENCIA);
  await expect(page.getByTestId(`importacao-item-${r}-sugestao-descricao`), "a linha da descrição é só da descrição").toHaveCount(0);
  await expect(caixaDoProduto(page, r), "o produto da referência vem escolhido").toContainText(`${pr.codigo} — ${pr.descricao}`);
  await expect(page.getByTestId(`importacao-item-${r}-quantidade-interna`), "com o produto, a quantidade interna é calculada (fator 1)").toHaveText("2.0000");
  await expect(page.getByTestId(`importacao-item-${r}-fator`), "o fator do caminho 4 é 1").toHaveValue("1");
  await expect(page.getByTestId(`importacao-item-${r}-lembrar`), "R7: a referência é palpite na tela e nasce com \"Lembrar\" DESMARCADO").not.toBeChecked();
  await expect(page.getByTestId(`importacao-item-${r}-criar-produto`), "a referência oferece \"Criar produto\"").toBeVisible();

  // O SEM VÍNCULO segue como antes (as linhas do palpite são só do palpite).
  await expect(page.getByTestId(`importacao-item-${semProduto}-vinculo`)).toHaveText(ROTULO.semVinculo);
  await expect(page.getByTestId(`importacao-item-${semProduto}-sugestao-descricao`)).toHaveCount(0);
  await expect(page.getByTestId(`importacao-item-${semProduto}-sugestao-referencia`)).toHaveCount(0);
  await expect(page.getByTestId(`importacao-item-${semProduto}-lembrar`), "o sem vínculo nasce com \"Lembrar\" marcado, como sempre").toBeChecked();
  await expect(page.getByTestId(`importacao-item-${semProduto}-criar-produto`)).toBeVisible();

  // O DIÁLOGO DE UM ITEM, pelo palpite da descrição: a descrição, a NCM e a unidade da NOTA (não as do produto sugerido).
  const itemD = c.itens[d - 1]!;
  await page.getByTestId(`importacao-item-${d}-criar-produto`).click();
  const dialogo = page.getByTestId("importacao-cadastro-products");
  await expect(dialogo, "o cadastro de produto pelo item abriu").toBeVisible();
  await expect(dialogo.getByTestId("b1-form"), "o formulário carregou").toBeVisible();
  await expect(dialogo.locator("input[name='description']"), "a descrição da NOTA").toHaveValue(itemD.descricao);
  await expect(dialogo.getByTestId("ref-ncm-codigo").first(), "a NCM da nota").toHaveValue(/^2309\.?90\.?90$/);
  await expect(campoDoFormulario(dialogo, rotuloDoCampoDoProduto("measurement_id")).getByRole("combobox"), "a unidade do uCom já vem escolhida").toContainText(c.unidadeDe(itemD.unidade).label);
  await dialogo.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialogo, "Cancelar fecha o diálogo sem criar nada").toBeHidden();
  await expect(caixaDoProduto(page, d), "o item continua com o produto sugerido").toContainText(`${pd.codigo} — ${pd.descricao}`);
  await expect(page.getByTestId(`importacao-item-${d}-lembrar`), "e com \"Lembrar\" desmarcado").not.toBeChecked();

  // O DIÁLOGO pelo palpite da REFERÊNCIA: a descrição e a NCM da NOTA; sem pré-preenchimento, a unidade fica por escolher.
  const itemR = c.itens[r - 1]!;
  await page.getByTestId(`importacao-item-${r}-criar-produto`).click();
  await expect(dialogo, "o cadastro de produto pelo item da referência abriu").toBeVisible();
  await expect(dialogo.getByTestId("b1-form"), "o formulário carregou").toBeVisible();
  await expect(dialogo.locator("input[name='description']"), "a descrição da NOTA (não a do produto da referência)").toHaveValue(itemR.descricao);
  await expect(dialogo.getByTestId("ref-ncm-codigo").first(), "a NCM da nota").toHaveValue(/^3824\.?99\.?29$/);
  await expect(campoDoFormulario(dialogo, rotuloDoCampoDoProduto("measurement_id")).getByRole("combobox"), "sem pré-preenchimento, nenhuma unidade escolhida").toHaveText("Selecione");
  await dialogo.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialogo, "Cancelar fecha o diálogo sem criar nada").toBeHidden();
  await expect(caixaDoProduto(page, r), "o item continua com o produto da referência").toContainText(`${pr.codigo} — ${pr.descricao}`);
  await expect(page.getByTestId(`importacao-item-${r}-lembrar`), "e com \"Lembrar\" desmarcado").not.toBeChecked();
  console.log(`[X2-T1] item ${d}: "${ROTULO.descricao}" + conferência + Lembrar desmarcado + Criar produto | item ${r}: "${ROTULO.referencia}" + conferência + Lembrar desmarcado + Criar produto | item ${semProduto}: "${ROTULO.semVinculo}"`
    + ` | preenchimento do palpite no fio = ${JSON.stringify(vinculoDe(noFio, d).preenchimento)}; da referência = ${JSON.stringify(vinculoDe(noFio, r).preenchimento ?? null)}`);
});

/* ═════════════════════════════════ X2-T2 ═════════════════════════════════ */

test("X2-T2 — R7 pelo fio e pelo banco: o Gerar compra sem tocar no \"Lembrar\" manda lembrar_vinculo false nos DOIS palpites (descrição e referência), dá 201 e o fornecedor ganha ZERO vínculo; a nota seguinte traz os dois de novo como sugeridos", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenarioDaXml02(page, "T2", ["D", "R"]);
  const d = itemDo(c, "D"); const r = itemDo(c, "R");
  const pd = produtoDo(c, "D"); const pr = produtoDo(c, "R");
  const { id, nota } = await importarNota(page, c);
  premissasDoCenario(c, await lerConferencia(page, id), "premissa");
  const antes = vinculosLembradosDo(c.fornecedor);
  const totalAntes = totalDeVinculosLembrados();
  expect(antes, "premissa: o fornecedor do caso é novo — nenhum vínculo lembrado no banco").toEqual([]);

  await abrirConferencia(page, id, c.top);
  // Ninguém toca no "Lembrar": a tela gera com o que ela mesma decidiu.
  const marcadoNaTela = { [d]: await page.getByTestId(`importacao-item-${d}-lembrar`).isChecked(), [r]: await page.getByTestId(`importacao-item-${r}-lembrar`).isChecked() };
  const g = await gerarCompraPelaTela(page, c, id, [d, r]);
  expect.soft(lembrarNoCorpo(g.corpo), "R7 NO FIO: os dois palpites (a descrição e a referência) vão com lembrar_vinculo false").toEqual([[d, pd.id, false], [r, pr.id, false]]);
  expect(g.status, `a compra foi gerada: ${g.texto.slice(0, 300)}`).toBe(201);
  expect(g.compra, "a compra nasce ABERTA, com o total da nota").toMatchObject({ situacao: "aberto", valor_total: nota.vNF, importacao_id: id });

  // R7 NO BANCO: nenhum par do fornecedor (nem o da descrição, nem o da referência).
  const depois = vinculosLembradosDo(c.fornecedor);
  const totalDepois = totalDeVinculosLembrados();
  expect(depois, "R7 NO BANCO: o Gerar NÃO gravou vínculo nenhum do fornecedor (os dois eram palpite)").toEqual([]);
  expect(depois.length - antes.length, "R7 NO BANCO: o fornecedor ganhou ZERO vínculo (contado antes e depois)").toBe(0);

  // A NOTA SEGUINTE do mesmo fornecedor: os dois continuam palpite (nada os lembrou).
  const seguinte = await importarNota(page, c);
  const conf2 = await lerConferencia(page, seguinte.id);
  expect([resumoDoVinculo(vinculoDe(conf2, d)), resumoDoVinculo(vinculoDe(conf2, r))], "a nota seguinte: a descrição e a referência de novo SUGERIDAS, nenhuma lembrada")
    .toEqual([["sugerido", "descricao", pd.id], ["sugerido", "reference", pr.id]]);
  console.log(`[X2-T2] Lembrar na tela ao gerar: item ${d}=${String(marcadoNaTela[d])}, item ${r}=${String(marcadoNaTela[r])} | corpo ${JSON.stringify(lembrarNoCorpo(g.corpo).map(([n, , l]) => [n, l]))} | gerar ${g.status}`
    + ` | vínculos do fornecedor: antes=${antes.length}, depois=${depois.length} | tabela inteira: antes=${totalAntes}, depois=${totalDepois}`
    + ` | nota seguinte: item ${d}=${vinculoDe(conf2, d).situacao}/${String(vinculoDe(conf2, d).origem)}, item ${r}=${vinculoDe(conf2, r).situacao}/${String(vinculoDe(conf2, r).origem)}`);
});

/* ═════════════════════════════════ X2-T3 ═════════════════════════════════ */

test("X2-T3 — marcar o \"Lembrar\" dos dois palpites é a confirmação: o corpo manda true nos dois, o banco ganha os dois pares e a nota seguinte traz os dois LEMBRADOS", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenarioDaXml02(page, "T3", ["D", "R"]);
  const d = itemDo(c, "D"); const r = itemDo(c, "R");
  const pd = produtoDo(c, "D"); const pr = produtoDo(c, "R");
  const { id } = await importarNota(page, c);
  premissasDoCenario(c, await lerConferencia(page, id), "premissa");
  expect(vinculosLembradosDo(c.fornecedor), "premissa: o fornecedor do caso é novo — nenhum vínculo lembrado").toEqual([]);

  await abrirConferencia(page, id, c.top);
  for (const k of [d, r]) {
    const lembrar = page.getByTestId(`importacao-item-${k}-lembrar`);
    await expect(lembrar, `premissa: o palpite do item ${k} nasce desmarcado`).not.toBeChecked();
    await lembrar.check();
    await expect(lembrar, `a pessoa marcou o item ${k}`).toBeChecked();
  }
  const g = await gerarCompraPelaTela(page, c, id, [d, r]);
  expect(lembrarNoCorpo(g.corpo), "marcados pela pessoa, os dois palpites vão com lembrar_vinculo true").toEqual([[d, pd.id, true], [r, pr.id, true]]);
  expect(g.status, `a compra foi gerada: ${g.texto.slice(0, 300)}`).toBe(201);
  const itemD = c.itens[d - 1]!; const itemR = c.itens[r - 1]!;
  const depois = vinculosLembradosDo(c.fornecedor);
  expect(depois, "o banco ganhou os DOIS pares: os dois palpites confirmados")
    .toEqual([`${itemD.codigo}|${itemD.unidade}|${pd.id}`, `${itemR.codigo}|${itemR.unidade}|${pr.id}`].sort());
  const conf2 = await lerConferencia(page, (await importarNota(page, c)).id);
  expect([resumoDoVinculo(vinculoDe(conf2, d)), resumoDoVinculo(vinculoDe(conf2, r))], "a nota seguinte: os dois LEMBRADOS")
    .toEqual([["lembrado", null, pd.id], ["lembrado", null, pr.id]]);
  console.log(`[X2-T3] Lembrar marcado pela pessoa nos itens ${d} e ${r} | corpo ${JSON.stringify(lembrarNoCorpo(g.corpo).map(([n, , l]) => [n, l]))} | gerar ${g.status} | vínculos do fornecedor depois=${depois.length} | nota seguinte: ${vinculoDe(conf2, d).situacao}/${vinculoDe(conf2, r).situacao}`);
});

/* ═════════════════════════════════ X2-T4 ═════════════════════════════════ */

test("X2-T4 — o lote: o sugerido pela descrição NÃO entra no \"Criar N produtos da nota\" enquanto tem o produto escolhido; tirado o produto, entra (data-quantidade sobe 1); a referência nunca entra, nem com o produto nem sem ele", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenarioDaXml02(page, "T4", ["D", "R", "N"]);
  const d = itemDo(c, "D"); const r = itemDo(c, "R"); const semProduto = itemDo(c, "N");
  const { id } = await importarNota(page, c);
  const conf = await lerConferencia(page, id);
  premissasDoCenario(c, conf, "premissa");
  expect(conf.capacidades, "premissa: a API deste HEAD declara a capacidade do lote").toEqual({ criarProdutosDaNota: 1 });
  expect(vinculoDe(conf, semProduto).preenchimento?.["measurement_id"], "premissa: o sem vínculo com a unidade resolvida (é candidato)").toBe(c.unidadeDe("UN").id);

  const pedidosAoLote: string[] = [];
  page.on("request", (x) => { if (caminho(x).endsWith("/criar-produtos")) pedidosAoLote.push(`${x.method()} ${caminho(x)}`); });
  await abrirConferencia(page, id);
  const botao = page.getByTestId("importacao-criar-produtos");
  await expect(botao, "com os produtos sugeridos escolhidos, o lote conta SÓ o sem vínculo").toHaveAttribute("data-quantidade", "1");
  await expect(botao).toHaveText("Criar 1 produto da nota");
  const quantidadeAntes = Number(await botao.getAttribute("data-quantidade"));
  await botao.click();
  const dialogo = page.getByTestId("importacao-criar-produtos-dialogo");
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByTestId(`importacao-criar-produtos-item-${semProduto}`), "o sem vínculo está na lista").toBeVisible();
  await expect(dialogo.getByTestId(`importacao-criar-produtos-item-${d}`), "o palpite com o produto escolhido NÃO está na lista").toHaveCount(0);
  await expect(dialogo.getByTestId(`importacao-criar-produtos-item-${r}`), "a referência com o produto não está na lista").toHaveCount(0);
  await expect(dialogo.getByTestId(`importacao-criar-produtos-fora-${r}`), "nem entre os de fora").toHaveCount(0);
  await dialogo.getByTestId("dialog-close").click();
  await expect(dialogo).toBeHidden();

  // A PESSOA TIRA o produto sugerido pela descrição (o "Limpar" da caixa): o item fica sem produto e passa a ser candidato do lote.
  await page.getByTestId(`importacao-item-${d}-produto`).getByRole("button", { name: "Limpar" }).click();
  await expect(caixaDoProduto(page, d), "a caixa ficou vazia").toHaveText("Selecione");
  await expect(page.getByTestId(`importacao-item-${d}-quantidade-interna`), "sem produto, sem quantidade interna").toHaveText("—");
  await expect(page.getByTestId(`importacao-item-${d}-sugestao-descricao`), "sem o produto sugerido, a linha da conferência some").toHaveCount(0);
  await expect(page.getByTestId(`importacao-item-${d}-vinculo`), "o rótulo continua o da origem").toHaveText(ROTULO.descricao);
  await expect(page.getByTestId(`importacao-item-${d}-criar-produto`), "e o \"Criar produto\" continua").toBeVisible();
  await expect(botao, "tirado o produto, o palpite ENTRA no lote: sobe 1").toHaveAttribute("data-quantidade", String(quantidadeAntes + 1));
  await expect(botao).toHaveText("Criar 2 produtos da nota");

  // A PESSOA TIRA também o produto da referência: o item fica sem produto, mas o lote NÃO o conta (o lote olha a identidade).
  await page.getByTestId(`importacao-item-${r}-produto`).getByRole("button", { name: "Limpar" }).click();
  await expect(caixaDoProduto(page, r), "a caixa da referência ficou vazia").toHaveText("Selecione");
  await expect(page.getByTestId(`importacao-item-${r}-quantidade-interna`), "sem produto, sem quantidade interna").toHaveText("—");
  await expect(page.getByTestId(`importacao-item-${r}-sugestao-referencia`), "sem o produto sugerido, a linha da conferência da referência some").toHaveCount(0);
  await expect(page.getByTestId(`importacao-item-${r}-vinculo`), "o rótulo continua o da origem").toHaveText(ROTULO.referencia);
  await expect(page.getByTestId(`importacao-item-${r}-criar-produto`), "e o \"Criar produto\" de UM item continua").toBeVisible();
  await expect(botao, "sem o produto da referência, o lote NÃO sobe: a referência nunca entra").toHaveAttribute("data-quantidade", String(quantidadeAntes + 1));
  await expect(botao).toHaveText("Criar 2 produtos da nota");
  await botao.click();
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByTestId(`importacao-criar-produtos-item-${d}-marcado`), "o palpite sem produto está na lista, marcado").toBeChecked();
  await expect(dialogo.getByTestId(`importacao-criar-produtos-item-${semProduto}-marcado`)).toBeChecked();
  await expect(dialogo.getByTestId(`importacao-criar-produtos-item-${r}`), "a referência sem produto continua fora da lista").toHaveCount(0);
  await expect(dialogo.getByTestId(`importacao-criar-produtos-fora-${r}`), "e fora dos de fora").toHaveCount(0);
  await dialogo.getByTestId("dialog-close").click();
  await expect(dialogo).toBeHidden();
  expect(pedidosAoLote, "nada foi pedido ao lote: abrir e fechar o diálogo não chama o servidor").toEqual([]);
  console.log(`[X2-T4] data-quantidade com os produtos sugeridos=${quantidadeAntes}; tirado o da descrição=${quantidadeAntes + 1}; tirado também o da referência=${await botao.getAttribute("data-quantidade")} | requisições ao lote=${pedidosAoLote.length}`);
});

/* ═════════════════════════════════ X2-T5 ═════════════════════════════════ */

test("X2-T5 — a troca de fornecedor não leva o \"Lembrar\" marcado para os palpites: a descrição e a referência voltam desmarcadas; a marcação que a pessoa mudou no item do código de barras (identidade) fica", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenarioDaXml02(page, "T5", ["D", "R", "G"], { parceiroAmbiguo: true });
  const d = itemDo(c, "D"); const r = itemDo(c, "R"); const gtin = itemDo(c, "G");
  const pd = produtoDo(c, "D"); const pr = produtoDo(c, "R"); const pg = produtoDo(c, "G");
  const { id } = await importarNota(page, c);
  const semEscolha = await lerConferencia(page, id);
  expect([semEscolha.parceiro.situacao, semEscolha.fornecedorEscolhido], "premissa: o parceiro AMBÍGUO, nenhum fornecedor escolhido").toEqual(["ambiguo", null]);
  premissasDoCenario(c, semEscolha, "premissa (sem fornecedor: os caminhos 3 a 5)");

  await abrirConferencia(page, id);
  const lembrarD = page.getByTestId(`importacao-item-${d}-lembrar`);
  const lembrarR = page.getByTestId(`importacao-item-${r}-lembrar`);
  const lembrarG = page.getByTestId(`importacao-item-${gtin}-lembrar`);
  await expect(lembrarD, "premissa: o palpite da descrição nasce desmarcado").not.toBeChecked();
  await expect(lembrarR, "premissa: o palpite da referência nasce desmarcado").not.toBeChecked();
  await expect(lembrarG, "premissa: o código de barras (identidade) nasce marcado").toBeChecked();
  await lembrarD.check();
  await lembrarR.check();
  await lembrarG.uncheck();
  await expect(lembrarD).toBeChecked();
  await expect(lembrarR).toBeChecked();
  await expect(lembrarG).not.toBeChecked();

  // A ESCOLHA DO FORNECEDOR (aba Cabeçalho): a tela relê a conferência com ele, e os vínculos são refeitos.
  const relida = page.waitForResponse((x) => x.request().method() === "GET" && caminho(x) === `/api/compras/importacoes/${id}` && new URL(x.url()).searchParams.get("fornecedor_id") === c.fornecedor, { timeout: 20_000 });
  await page.getByTestId("importacao-aba-cabecalho-rotulo").click();
  await page.getByTestId("importacao-parceiro-escolha").selectOption(c.fornecedor);
  const conf2 = (await (await relida).json()) as ConferenciaNoFio;
  expect(conf2.fornecedorEscolhido, "no fio: a conferência relida com o fornecedor escolhido").toBe(c.fornecedor);
  premissasDoCenario(c, conf2, "no fio, com o fornecedor (nada lembrado: o fornecedor é novo)");
  await expect(page.getByTestId("importacao-conferencia")).toHaveAttribute("data-relendo", "nao");
  await page.getByTestId("importacao-aba-itens-rotulo").click();
  await expect(lembrarD, "o palpite da descrição refeito volta DESMARCADO (a marcação com o fornecedor anterior não vale para este)").not.toBeChecked();
  await expect(lembrarR, "o palpite da referência refeito volta DESMARCADO").not.toBeChecked();
  await expect(lembrarG, "a marcação que a pessoa mudou no código de barras (identidade) fica: desmarcado à mão continua desmarcado").not.toBeChecked();
  await expect(caixaDoProduto(page, d), "o palpite refeito traz o mesmo produto").toContainText(`${pd.codigo} — ${pd.descricao}`);
  await expect(caixaDoProduto(page, r), "a referência refeita traz o mesmo produto").toContainText(`${pr.codigo} — ${pr.descricao}`);
  await expect(caixaDoProduto(page, gtin), "o código de barras refeito traz o mesmo produto").toContainText(`${pg.codigo} — ${pg.descricao}`);
  await expect(page.getByTestId(`importacao-item-${d}-sugestao-descricao`)).toHaveText(TEXTO_DA_CONFERENCIA_DO_PALPITE);
  await expect(page.getByTestId(`importacao-item-${r}-sugestao-referencia`)).toHaveText(TEXTO_DA_CONFERENCIA_DA_REFERENCIA);
  await expect(page.getByTestId(`importacao-item-${gtin}-vinculo`), "o código de barras continua identidade").toHaveText(ROTULO.codigoDeBarras);
  await expect(page.getByTestId(`importacao-item-${gtin}-sugestao-descricao`), "a identidade não pede conferência").toHaveCount(0);
  await expect(page.getByTestId(`importacao-item-${gtin}-sugestao-referencia`)).toHaveCount(0);
  console.log(`[X2-T5] antes da troca: Lembrar item ${d}=marcado pela pessoa, item ${r}=marcado pela pessoa, item ${gtin}=desmarcado pela pessoa`
    + ` | depois da troca (fornecedor escolhido): item ${d}=${String(await lembrarD.isChecked())}, item ${r}=${String(await lembrarR.isChecked())}, item ${gtin}=${String(await lembrarG.isChecked())}`);
});

/* ═════════════════════════════════ X2-T6 ═════════════════════════════════ */

test("X2-T6 — a pessoa corrige o palpite e a escolha dela é lembrada: a referência trocada no seletor por OUTRO produto marca o \"Lembrar\" (de volta ao palpite desmarca), a descrição trocada pelo \"Criar produto\" também; o Gerar compra manda os produtos escolhidos com lembrar_vinculo true, 201, o banco ganha os dois pares e a nota seguinte os traz LEMBRADOS", async ({ page, produtosDaTela }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDaXml02(page, "T6", ["R", "D"]);
  const r = itemDo(c, "R"); const d = itemDo(c, "D");
  const pr = produtoDo(c, "R"); const pd = produtoDo(c, "D");
  const itemR = c.itens[r - 1]!; const itemD = c.itens[d - 1]!;
  // O PRODUTO CERTO do item da referência: a referência aponta para o produto do papel R (o ERRADO, para esta pessoa);
  // o certo é outro cadastro, sem referência, sem código de barras e sem palavra em comum com a nota.
  const certoCriado = await criarCadastro(page, "products", {
    description: `ESCOLHA CERTA DA PESSOA ${c.tok}`, group_id: c.ref.grupo.id, measurement_id: c.unidadeDe(itemR.unidade).id, financial_category_id: c.ref.natureza.id, ncm_code: itemR.ncm
  });
  const rowCerto = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${certoCriado.id}`);
  const certo = { id: certoCriado.id, codigo: String(rowCerto["code"] ?? ""), descricao: String(rowCerto["description"]) };
  expect([certo.descricao, rowCerto["reference"] ?? null, rowCerto["barcode"] ?? null], "premissa: o produto certo, sem referência e sem código de barras").toEqual([`ESCOLHA CERTA DA PESSOA ${c.tok}`, null, null]);
  expect(certo.id, "premissa: o produto certo NÃO é o da referência").not.toBe(pr.id);

  const { id, nota } = await importarNota(page, c);
  premissasDoCenario(c, await lerConferencia(page, id), "premissa");
  const antes = vinculosLembradosDo(c.fornecedor);
  expect(antes, "premissa: o fornecedor do caso é novo — nenhum vínculo lembrado no banco").toEqual([]);

  await abrirConferencia(page, id, c.top);
  const lembrarR = page.getByTestId(`importacao-item-${r}-lembrar`);
  const lembrarD = page.getByTestId(`importacao-item-${d}-lembrar`);
  const seletorR = page.getByTestId(`importacao-item-${r}-produto`);
  await expect(caixaDoProduto(page, r), "premissa: a referência vem com o produto ERRADO escolhido").toContainText(`${pr.codigo} — ${pr.descricao}`);
  await expect(lembrarR, "premissa: o palpite da referência nasce desmarcado").not.toBeChecked();
  await expect(lembrarD, "premissa: o palpite da descrição nasce desmarcado").not.toBeChecked();

  // A REFERÊNCIA CORRIGIDA NO SELETOR: outro produto ⇒ marcado; de volta ao do palpite ⇒ desmarcado; o outro de novo ⇒ marcado.
  await escolherNoSeletor(page, seletorR, certo.descricao, `Produto do item ${r} (o certo)`);
  await expect.soft(lembrarR, "a pessoa trocou o palpite por OUTRO produto: \"Lembrar\" MARCADO").toBeChecked();
  await expect(page.getByTestId(`importacao-item-${r}-sugestao-referencia`), "com outro produto, a linha da conferência do palpite some").toHaveCount(0);
  await expect(page.getByTestId(`importacao-item-${r}-vinculo`), "o rótulo continua o da origem").toHaveText(ROTULO.referencia);
  await escolherNoSeletor(page, seletorR, pr.descricao, `Produto do item ${r} (de volta ao palpite)`);
  await expect(lembrarR, "de volta ao produto do palpite: \"Lembrar\" DESMARCADO").not.toBeChecked();
  await expect(page.getByTestId(`importacao-item-${r}-sugestao-referencia`), "de volta ao palpite, a linha volta").toHaveText(TEXTO_DA_CONFERENCIA_DA_REFERENCIA);
  await escolherNoSeletor(page, seletorR, certo.descricao, `Produto do item ${r} (o certo, de novo)`);
  await expect.soft(lembrarR, "o outro produto de novo: \"Lembrar\" MARCADO").toBeChecked();
  await expect(caixaDoProduto(page, r), "o item fica com o produto da pessoa").toContainText(certo.descricao);
  // XML-04 (decisão 318): o fator que veio do cadastro do produto do palpite NÃO segue para o produto da pessoa — o
  // campo esvazia e a tela pergunta; a pessoa informa o fator do produto certo (a mesma unidade da nota: 1).
  const fatorR = page.getByTestId(`importacao-item-${r}-fator`);
  await expect(fatorR, "o produto foi trocado: o fator do palpite não segue para o produto da pessoa").toHaveValue("");
  await expect(page.getByTestId(`importacao-item-${r}-fator-pergunta`)).toHaveText("O produto foi trocado: informe o fator do produto escolhido.");
  await fatorR.fill("1");
  await expect(page.getByTestId(`importacao-item-${r}-fator-pergunta`), "digitado: a pergunta sai").toHaveCount(0);

  // A DESCRIÇÃO CORRIGIDA PELO "CRIAR PRODUTO": o produto criado fica escolhido e o "Lembrar" marcado.
  await page.getByTestId(`importacao-item-${d}-criar-produto`).click();
  const dialogo = page.getByTestId("importacao-cadastro-products");
  await expect(dialogo, "o cadastro de produto pelo item abriu").toBeVisible();
  await expect(dialogo.getByTestId("b1-form"), "o formulário carregou").toBeVisible();
  await expect(dialogo.locator("input[name='description']"), "a descrição da NOTA").toHaveValue(itemD.descricao);
  await escolherNoFormulario(page, campoDoFormulario(dialogo, rotuloDoCampoDoProduto("group_id")), c.ref.grupo.label, "Grupo do produto");
  await dialogo.getByRole("tab", { name: "Custos e venda" }).click();
  await escolherNoFormulario(page, campoDoFormulario(dialogo, rotuloDoCampoDoProduto("financial_category_id")), c.ref.natureza.label, "Natureza de custo do produto");
  const post = page.waitForResponse((x) => x.request().method() === "POST" && caminho(x) === "/api/resources/products", { timeout: 20_000 });
  await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
  const resposta = await post;
  expect(resposta.status(), `o produto foi criado pela tela: ${resposta.status()}`).toBe(201);
  const criado = (await resposta.json()) as { id: string; code: string; description: string };
  produtosDaTela.add(criado.id);
  expect([criado.description, criado.id === pd.id], "o produto criado tem a descrição da nota e NÃO é o do palpite").toEqual([itemD.descricao, false]);
  await expect(dialogo, "o diálogo fecha depois do 201").toBeHidden();
  await expect(caixaDoProduto(page, d), "o item recebe o produto criado").toContainText(criado.description);
  await expect.soft(lembrarD, "o palpite trocado pelo produto criado: \"Lembrar\" MARCADO").toBeChecked();
  await expect(page.getByTestId(`importacao-item-${d}-sugestao-descricao`), "com o produto criado, a linha da conferência do palpite some").toHaveCount(0);

  // O "GERAR COMPRA": os produtos ESCOLHIDOS, com lembrar_vinculo true, e os dois pares no banco.
  const marcadoAoGerar = { [r]: await lembrarR.isChecked(), [d]: await lembrarD.isChecked() };
  const g = await gerarCompraPelaTela(page, c, id, [r, d]);
  expect.soft(lembrarNoCorpo(g.corpo), "NO FIO: os produtos que a pessoa escolheu, com lembrar_vinculo true").toEqual([[r, certo.id, true], [d, criado.id, true]]);
  expect(g.status, `a compra foi gerada: ${g.texto.slice(0, 300)}`).toBe(201);
  expect(g.compra, "a compra nasce ABERTA, com o total da nota").toMatchObject({ situacao: "aberto", valor_total: nota.vNF, importacao_id: id });
  const depois = vinculosLembradosDo(c.fornecedor);
  expect(depois, "NO BANCO: os dois pares (código, unidade) → os produtos ESCOLHIDOS pela pessoa (nunca os do palpite)")
    .toEqual([`${itemR.codigo}|${itemR.unidade}|${certo.id}`, `${itemD.codigo}|${itemD.unidade}|${criado.id}`].sort());
  expect(depois.length - antes.length, "NO BANCO: o fornecedor ganhou DOIS vínculos (contado antes e depois)").toBe(2);

  // A NOTA SEGUINTE do mesmo fornecedor: os dois LEMBRADOS, com os produtos da pessoa.
  const conf2 = await lerConferencia(page, (await importarNota(page, c)).id);
  expect([resumoDoVinculo(vinculoDe(conf2, r)), resumoDoVinculo(vinculoDe(conf2, d))], "a nota seguinte: os dois LEMBRADOS, com os produtos escolhidos")
    .toEqual([["lembrado", null, certo.id], ["lembrado", null, criado.id]]);
  console.log(`[X2-T6] item ${r} (referência → ${pr.codigo}): trocado no seletor por ${certo.codigo}, Lembrar=${String(marcadoAoGerar[r])} | item ${d} (descrição → ${pd.codigo}): Criar produto ${resposta.status()} → ${criado.code}, Lembrar=${String(marcadoAoGerar[d])}`
    + ` | corpo ${JSON.stringify(lembrarNoCorpo(g.corpo).map(([n, , l]) => [n, l]))} | gerar ${g.status} | vínculos do fornecedor: antes=${antes.length}, depois=${depois.length}`
    + ` | nota seguinte: item ${r}=${vinculoDe(conf2, r).situacao}, item ${d}=${vinculoDe(conf2, d).situacao}`);
});
