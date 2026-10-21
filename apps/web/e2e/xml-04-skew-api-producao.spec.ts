import { test as testeSemNavegador, type Page } from "@playwright/test";
import { D } from "@agro/shared";
import { api, login } from "./helpers";
import { shaDaBase } from "./skew-fonte-da-base";
import { vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { escolherNoSeletor, expectCamposAvancadosAusentes, fonteDoCommitContem, fonteDoHeadContem } from "./xml-02-comum";
import {
  COMMITS_DA_XML04, MARCA_DA_XML04, TESTIDS_DA_XML04, abrirConferenciaDaXml04, apiDaBaseTemAXml04, caminho, cenarioDaXml04, comoATelaEscreve, compraNoBanco, contarPedidosDaTop, dataComoSeDigita, expect,
  fatorNoCorpoDoItem, importarNotaDaXml04, irParaAba, marcasDaXml04NoFio, nDo, test, testidsDaXml04NaTela, textoNormalizado, vinculoNoFio, type CenarioDaXml04, type ConferenciaNoFioDaXml04
} from "./xml-04-comum";

/**
 * XML-04 (decisão 318) · K1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (a janela "web antes da API" da
 * DEPLOYMENT, e a reversão só da API).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` (sem âncora: casa com o fim deste nome); o `playwright.config.ts` comum ignora o mesmo
 * padrão — este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD e o caso ficaria verde por vacuidade).
 * Sem passo no CI: o job `skew` roda a config inteira, e o arquivo entra pelo nome.
 *
 * O QUE SE MEDE. A tela deste HEAD só LÊ o que a XML-04 acrescentou à conferência (`itens[].vinculo.fatorPelaNota`,
 * `financeiro.forma`, os campos novos de `financeiro.parcelas`) e só pergunta a TOP (`/regras-da-operacao` e
 * `/layout-efetivo`) quando a conferência declara a forma da nota. A API da base não manda nada disso. O navegador roda o
 * bundle deste HEAD contra o binário EXATO da base, servindo o banco migrado e semeado por este HEAD, com a nota de 10
 * itens da medição (`xml-04-comum.ts`; o tPag 15 no `<pag>`, que a base não lê).
 *
 * O MUNDO DA API DA BASE é lido do FONTE do commit (`apiDaBaseTemAXml04`: o `apps/api/src` monta `fatorPelaNota`;
 * reprova quando não consegue ler) e CONFERIDO na conferência que a base responde — o fonte e o binário têm de contar a
 * mesma história, ou o caso reprova:
 *   · LEGADO (a base sem a XML-04): a tela é a de HOJE — o fator de cada item vem preenchido COMO O SERVIDOR MANDA
 *     (o "1" da referência e o 6 do vínculo), nenhuma origem, pergunta ou aviso do fator, nenhuma origem, pergunta ou
 *     aviso da forma (e o campo sem `data-origem`), ZERO pedido a `/regras-da-operacao` e a `/layout-efetivo` enquanto
 *     a conferência está aberta (contado no fio), e o "Gerar compra" dá 201 com o fator que a tela mostrou. O CORPO do
 *     "Gerar compra", MEDIDO no fio: as CHAVES — no topo, em `financeiro`, no `rateio` e em cada item — são EXATAMENTE as
 *     que a web da base manda para a mesma conferência (`CHAVES_DO_CORPO_NA_BASE`, lidas do fonte dela), na mesma ordem,
 *     e a forma vai vazia como hoje (`forma_pagamento_id: null`, nada gravado). A explicação
 *     das duplicatas NÃO depende da API: com o total calculado, a tela recalcula as parcelas com a regra do domínio que
 *     embute (`parcelasDaNota`) e diz os três números e as duas comparações — conferido por extenso;
 *   · NOVO (a base já com a XML-04, depois do merge): o comportamento deste HEAD — a origem do fator, o campo vazio na
 *     pergunta (a pessoa digita) e a TOP perguntada; o "Gerar compra" dá 201.
 * O VIGIA (`vigiar`, desde a abertura da conferência até o 201): nenhuma requisição morta no navegador
 * (`semBloqueio`) e nenhuma resposta 404, 422 ou 5xx da API da base à tela deste web (`semErroDeContrato`).
 *
 * PROVA REVERSA DO DETECTOR: o caso "detector" (sem navegador) roda `apiDaBaseTemAXml04` sobre dois commits fixos — a
 * main antes da XML-04 ⇒ falso; o commit da XML-04 na branch da fatia ⇒ verdadeiro.
 *
 * OS DADOS nascem pela API DA BASE (as portas de `central-compras-fixtures`, com a exclusão lógica no fim do caso);
 * nada se liga (a base não tem o cadastro da ligação). A compra, a importação e o vínculo lembrado ficam (decisão 247).
 */

/**
 * AS CHAVES DO CORPO DO "GERAR COMPRA" QUE A WEB DA BASE MANDA PARA ESTA CONFERÊNCIA — tiradas do fonte da base
 * (origin/main 33291879: `git show 33291879:apps/web/src/features/compras/importacao/estado.ts`, a função `corpo()`,
 * :343-378), na ORDEM em que ela as serializa. No mundo legado, o corpo que ESTE web manda à API da base tem de ter
 * exatamente estas chaves — nem uma a mais, nem uma a menos, na mesma ordem — no topo, em `financeiro`, no `rateio` e em
 * cada item. As chaves CONDICIONAIS da base, e por que esta conferência as tem ou não:
 *   · `financeiro.condicao_pagamento_id` e `financeiro.data_vencimento` só vão com `parcelas: "condicao"` (:359) — é o
 *     caso: as duplicatas do cenário não fecham e o vencimento é digitado (o caso confere `parcelas` no corpo);
 *   · o `rateio` "documento" (:348) leva `tipo`, `categoria_financeira_id` e `centro_custo_id` — é o caso (a natureza e
 *     o centro do documento); "por_valor" e "por_produto" (:346-347) teriam outras chaves e não rodam aqui;
 *   · `lote` e `validade` do item só vão com o item sem rastro E o lote (ou a validade) digitado (:373-374) — o caso
 *     não digita nenhum dos dois: não vão.
 */
const CHAVES_DO_CORPO_NA_BASE = {
  topo: ["tipo_operacao_id", "fornecedor_id", "data_entrada", "observacao", "transportadora_id", "pedido_id", "solicitacao_compra_id", "financeiro", "itens"],
  financeiro: ["parcelas", "condicao_pagamento_id", "data_vencimento", "forma_pagamento_id", "tipo_titulo_id", "classificacao_gasto", "rateio"],
  rateio: ["tipo", "categoria_financeira_id", "centro_custo_id"],
  item: ["n_item", "produto_id", "fator", "tipo_fator", "lembrar_vinculo", "armazem_id", "gera_estoque", "imobilizado", "item_origem_id", "categoria_financeira_id", "centro_custo_id"]
} as const;

/** O corpo do POST do "Gerar compra" como foi no fio: o que o K1 lê por nome (as chaves são medidas inteiras, por `Object.keys`). */
interface CorpoDoGerarNoFio {
  financeiro: Record<string, unknown> & { rateio: Record<string, unknown> };
  itens: (Record<string, unknown> & { n_item: number; fator: string })[];
}

/** PREMISSA: o que o ramo legado cobra ausente existe neste HEAD (sem ela, "não aparece" seria verde por vacuidade). */
function premissaDasMarcas() {
  for (const marca of [MARCA_DA_XML04.web, TESTIDS_DA_XML04.formaOrigem, TESTIDS_DA_XML04.formaPergunta, TESTIDS_DA_XML04.parcelasFalha, "regras-da-operacao?tipo_operacao_id="]) {
    expect(fonteDoHeadContem(marca, "apps/web/src/features/compras/importacao"), `premissa: o web deste HEAD (a conferência) tem ${marca}`).toBe(true);
  }
}

/** O mundo pelo FONTE do commit da base, conferido na conferência que a base respondeu: os dois têm de concordar. */
function mundoDaApiDaBase(conf: ConferenciaNoFioDaXml04): Mundo {
  const sha = shaDaBase();
  const mundo: Mundo = apiDaBaseTemAXml04(sha) ? "novo" : "legado";
  const marcas = marcasDaXml04NoFio(conf);
  console.log(`[skew] XML-04 · K1 · a API da base ${sha.slice(0, 8)} ${mundo === "novo" ? "TEM" : "NÃO tem"} ${MARCA_DA_XML04.api} → mundo ${mundo} · marcas no fio: ${JSON.stringify(marcas)}`);
  if (mundo === "legado") expect(marcas, "mundo legado: a conferência da base NÃO traz nada da XML-04").toEqual([]);
  else expect(marcas, "mundo novo: a conferência da base traz o fator pela nota e a forma").toEqual(expect.arrayContaining(["itens[].vinculo.fatorPelaNota", "financeiro.forma"]));
  return mundo;
}

/** O vencimento (a condição: as duplicatas não fecham), a natureza e o centro do documento, na aba Financeiro. */
async function resolverOFinanceiro(page: Page, c: CenarioDaXml04) {
  await irParaAba(page, "financeiro");
  const vencimento = page.getByTestId("importacao-aba-financeiro").getByLabel("Vencimento", { exact: true });
  await vencimento.fill(dataComoSeDigita("2026-11-16"));
  await vencimento.press("Enter");
  await expect(page.getByTestId("importacao-vencimento")).toHaveValue("2026-11-16");
  await escolherNoSeletor(page, page.getByTestId("importacao-natureza"), c.ref.natureza.label, "Natureza de despesa da compra");
  await escolherNoSeletor(page, page.getByTestId("importacao-centro"), c.ref.centro.label, "Centro de resultado da compra");
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * O DETECTOR — prova reversa, sem navegador
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

testeSemNavegador("XML-04 · K1 · prova reversa do detector da API da base: a main antes da XML-04 → false; o commit da XML-04 → true", () => {
  expect(fonteDoHeadContem(MARCA_DA_XML04.api, "apps/api/src"), `premissa: a API deste HEAD tem ${MARCA_DA_XML04.api}`).toBe(true);
  expect(apiDaBaseTemAXml04(COMMITS_DA_XML04.sem), `${COMMITS_DA_XML04.sem.slice(0, 8)} (a main com a XML-02): sem a XML-04`).toBe(false);
  expect(apiDaBaseTemAXml04(COMMITS_DA_XML04.com), `${COMMITS_DA_XML04.com.slice(0, 8)} (a XML-04 na branch da fatia): com a XML-04`).toBe(true);
  // O detector lê o fonte do COMMIT (e não a árvore de agora): no commit sem a XML-04, a conferência existe e não tem a marca.
  expect(fonteDoCommitContem(COMMITS_DA_XML04.sem, "export async function vinculosDosItens", "apps/api/src"), "premissa: a conferência existe no commit sem a XML-04").toBe(true);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K1 · A CONFERÊNCIA DESTE WEB SOBRE A API DA BASE, ATÉ O GERAR COMPRA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("XML-04 · K1 (sentido 1) — a conferência deste web sobre a API da base: sem fatorPelaNota nem financeiro.forma, o fator como o servidor manda, nenhuma origem, pergunta ou aviso novo, nenhum pedido à TOP no fio, e o Gerar compra dá 201; com eles, o comportamento deste HEAD", async ({ page }) => {
  test.setTimeout(240_000);
  premissaDasMarcas();
  await login(page);
  const c = await cenarioDaXml04(page);
  const id = await importarNotaDaXml04(page, c, c.nota);
  const direta = await api<ConferenciaNoFioDaXml04>(page, "GET", `/api/compras/importacoes/${id}`);
  expect(direta, "premissa: a importação pendente, com o fornecedor (novo) encontrado pelo emitente")
    .toMatchObject({ situacao: "pendente", empresa: { id: c.empresa }, parceiro: { situacao: "encontrado", id: c.fornecedor }, fornecedorEscolhido: c.fornecedor });
  const mundo = mundoDaApiDaBase(direta);

  const v = vigiar(page);
  const pedidosDaTop = contarPedidosDaTop(page, id);
  const noFio = await abrirConferenciaDaXml04(page, id, c.top);
  expect(noFio.itens.map((i) => [i.nItem, i.vinculo]), "a tela recebeu os MESMOS vínculos da leitura direta").toEqual(direta.itens.map((i) => [i.nItem, i.vinculo]));
  await irParaAba(page, "itens");
  const papeis = c.itensDoCenario;
  const nU = [nDo(c, "U1"), nDo(c, "U2")];

  const semFatorNaTela = (await page.getByTestId("importacao-item-1-fator").count()) === 0;
  if (mundo === "legado") {
    // A TELA DE HOJE: o fator de cada item como o servidor manda (se o campo existir); nenhuma marca da XML-04 nos cartões.
    for (const [k, i] of papeis.entries()) {
      const vin = vinculoNoFio(noFio, k + 1);
      const campo = page.getByTestId(`importacao-item-${k + 1}-fator`);
      if (await campo.count()) await expect(campo, `${i.papel}: o fator como o servidor manda (${vin.fator})`).toHaveValue(D(vin.fator ?? "0").toFixed());
    }
    expect(await testidsDaXml04NaTela(page), "a aba Itens de hoje: nenhuma origem, pergunta ou aviso do fator").toEqual([]);
    await irParaAba(page, "financeiro");
    const forma = page.getByTestId("importacao-forma");
    expect(await forma.getAttribute(TESTIDS_DA_XML04.formaAtributoOrigem), "a forma sem origem declarada (a base não manda a forma da nota)").toBeNull();
    expect(await forma.getAttribute(TESTIDS_DA_XML04.formaAtributoTrava), "a forma sem a trava da TOP").toBeNull();
    // A FORMA: nada da XML-04 (nem origem, nem pergunta, nem aviso). AS DUPLICATAS: a explicação NÃO depende da API —
    // com o total da compra calculado, a tela recalcula as parcelas com a regra do domínio que ela embute
    // (`parcelasDaNota`, a mesma do servidor) sobre a nota que a base leu; é a explicação certa, com os três números e
    // as duas comparações, e não uma afirmação sem base.
    expect(await testidsDaXml04NaTela(page), "a aba Financeiro: nada da forma; a explicação das duplicatas recalculada pela tela")
      .toEqual([TESTIDS_DA_XML04.parcelasNumeros, TESTIDS_DA_XML04.parcelasFalha, TESTIDS_DA_XML04.parcelasFalha]);
    expect(textoNormalizado(await page.getByTestId(TESTIDS_DA_XML04.parcelasNumeros).innerText()), "os três números, da regra do domínio recalculada pela tela")
      .toBe(`Soma das duplicatas: R$ ${comoATelaEscreve(c.nota.somaDasDuplicatas)} · Líquido da fatura (vLiq): R$ ${comoATelaEscreve(c.nota.vLiq)} · Total da compra: R$ ${comoATelaEscreve(c.nota.vNF)}.`);
    expect((await page.getByTestId(TESTIDS_DA_XML04.parcelasFalha).allInnerTexts()).map(textoNormalizado), "as duas comparações que falham, com a diferença")
      .toEqual([`A soma das duplicatas fica R$ ${comoATelaEscreve("279.00")} abaixo do líquido.`, `O líquido fica R$ ${comoATelaEscreve("50.00")} abaixo do total da compra.`]);
  } else if (semFatorNaTela) {
    for (let k = 1; k <= papeis.length; k++) await expectCamposAvancadosAusentes(page, k);
  } else {
    await expect(page.getByTestId(TESTIDS_DA_XML04.fatorOrigem(1)), "mundo novo: a origem do fator").toBeVisible();
    for (const k of nU) await expect(page.getByTestId(`importacao-item-${k}-fator`), `mundo novo: o item ${k} com o fator perguntado (vazio)`).toHaveValue("");
    for (const [k, fator] of [[nU[0]!, "20"], [nU[1]!, "10"]] as const) await page.getByTestId(`importacao-item-${k}-fator`).fill(fator);
  }

  await resolverOFinanceiro(page, c);
  const gerar = page.getByTestId("importacao-gerar-compra");
  await expect(gerar, "nada bloqueia o Gerar compra").toBeEnabled();
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/importacoes/${id}/gerar-compra`, { timeout: 30_000 });
  await gerar.click();
  const resposta = await post;
  const pedidosAteOGerar = [...pedidosDaTop];
  const texto = await resposta.text();
  expect(resposta.status(), `a base gera a compra deste web: ${texto.slice(0, 300)}`).toBe(201);
  const compra = JSON.parse(texto) as { id: string; situacao: string; valor_total: string };
  expect([compra.situacao, D(compra.valor_total).toFixed(2)], "a compra nasce ABERTA, com o total da nota").toEqual(["aberto", c.nota.vNF]);
  const corpo = resposta.request().postDataJSON() as CorpoDoGerarNoFio;
  const gravada = compraNoBanco(compra.id);
  const fatoresDoCorpo = corpo.itens.map((i) => D(i.fator).toFixed());
  expect(gravada.itens.map((l) => l.split("|")[3]), "o banco gravou o fator que a tela mandou").toEqual(fatoresDoCorpo);

  if (mundo === "legado") {
    expect(pedidosAteOGerar, "mundo legado: NENHUM pedido a /regras-da-operacao nem a /layout-efetivo com a conferência aberta (no fio)").toEqual([]);
    expect(fatoresDoCorpo, "mundo legado: o corpo leva o fator como o servidor mandou").toEqual(papeis.map((_, k) => D(vinculoNoFio(noFio, k + 1).fator ?? "0").toFixed()));
    expect([Object.hasOwn(corpo.financeiro, "forma_pagamento_id") ? corpo.financeiro["forma_pagamento_id"] : "ausente", gravada.forma], "mundo legado: a forma, como hoje (ninguém escolheu)").toEqual([null, null]);
    // O CORPO, MEDIDO: as chaves que a web da base manda para esta conferência, exatamente e na mesma ordem.
    expect([corpo.financeiro["parcelas"], corpo.financeiro.rateio["tipo"], corpo.itens.length], "premissa: as chaves condicionais da base — a condição (as duplicatas não fecham), o rateio do documento, os itens da nota")
      .toEqual(["condicao", "documento", papeis.length]);
    expect({ topo: Object.keys(corpo), financeiro: Object.keys(corpo.financeiro), rateio: Object.keys(corpo.financeiro.rateio), itens: corpo.itens.map((i) => Object.keys(i)) },
      "mundo legado: as CHAVES do corpo (topo, financeiro, rateio e cada item) são exatamente as da web da base para a mesma conferência")
      .toEqual({ topo: CHAVES_DO_CORPO_NA_BASE.topo, financeiro: CHAVES_DO_CORPO_NA_BASE.financeiro, rateio: CHAVES_DO_CORPO_NA_BASE.rateio, itens: papeis.map(() => CHAVES_DO_CORPO_NA_BASE.item) });
    console.log(`[skew] XML-04 · K1 · o corpo do Gerar: as chaves da web da base — topo ${Object.keys(corpo).length}, financeiro ${Object.keys(corpo.financeiro).length}, `
      + `rateio ${Object.keys(corpo.financeiro.rateio).length}, item ${CHAVES_DO_CORPO_NA_BASE.item.length} × ${corpo.itens.length} | forma_pagamento_id ${JSON.stringify(corpo.financeiro["forma_pagamento_id"])}`);
  } else {
    expect(pedidosAteOGerar.length, "mundo novo: a tela pergunta a TOP (a conferência declara a forma da nota)").toBeGreaterThan(0);
    if (semFatorNaTela) {
      expect(fatoresDoCorpo, "mundo novo (sem fator na tela): fatores automáticos no corpo").toEqual(papeis.map((item, k) => D(fatorNoCorpoDoItem(item, vinculoNoFio(noFio, k + 1))).toFixed()));
    }
  }
  console.log(`[skew] XML-04 · K1 · mundo ${mundo} | pedidos à TOP com a conferência aberta: ${pedidosAteOGerar.length} | gerar ${resposta.status()} | fatores no corpo ${JSON.stringify(fatoresDoCorpo)} | forma gravada ${gravada.forma ?? "nenhuma"}`);
  v.semBloqueio();
  v.semErroDeContrato();
});
