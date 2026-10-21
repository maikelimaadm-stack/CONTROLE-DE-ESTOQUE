import type { Page } from "@playwright/test";
import { D } from "@agro/shared";
import { login, api } from "./helpers";
import {
  COBRANCA_DO_CENARIO, ITENS_DO_CENARIO, Gestos, TESTIDS_DA_XML04, cadastroDaLigacaoNoDominio, caminho, cenarioDaXml04, comparacoesDasDuplicatas, dataComoSeDigita,
  escolherNoSeletorContando, expect, expectCamposAvancadosAusentes, fatorNoCorpoDoItem, fatorSemRespaldo, formasDoNumeroNoTexto, marcasDaXml04NoFio, origemDoFator, seletorVazio, test, textoNormalizado, vinculoLembrado,
  type OrigemDoFator
} from "./xml-04-comum";

/**
 * XML-04 — A MEDIÇÃO: o FATOR, a FORMA DE PAGAMENTO e o VENCIMENTO na conferência da NF-e de compra. O MESMO spec mede
 * o mundo de HOJE (a base) e o mundo NOVO (o fim da fatia): o que é novo é lido por propriedade própria da resposta
 * (`CAMPOS_NOVOS_DA_XML04`, em `xml-04-comum.ts`) e só usado quando existe. O cenário (10 itens, um fornecedor, o tPag
 * 15, as duplicatas que não fecham) está descrito em `xml-04-comum.ts`.
 *
 * ┌─ AS MEDIDAS (definição operacional, IGUAL nos dois mundos; nenhuma é asserção) ─────────────────────────────────┐
 * │ Todas lidas na conferência ABERTA, antes de qualquer gesto (fase A); E4 conta os gestos da fase B.            │
 * │                                                                                                                │
 * │ E1 = quantos fatores o operador tem de DIGITAR ou CONFERIR. Cada item conta UMA vez, pela primeira regra que   │
 * │      o pega, nesta ordem:                                                                                      │
 * │   (a) DIGITAR: o campo "Fator" (`importacao-item-<n>-fator`) ao abrir NÃO é o fator certo do cenário (vazio,   │
 * │       inválido ou outro número; a "Conversão" `importacao-item-<n>-tipo-fator` diferente de "multiply" também);│
 * │   (b) CONFERIR O CHUTE: o fator está certo, mas não tem respaldo nem do cadastro nem do vínculo — mundo novo:   │
 * │       `vinculo.fatorPelaNota.origem === "pergunta"`; mundo de hoje (sem a propriedade): o sugerido pela         │
 * │       referência ou pela descrição (o `FATOR_SEM_UNIDADE` do servidor, sempre 1) e o nenhum/ambíguo (o "1" com  │
 * │       que a tela nasce);                                                                                       │
 * │   (c) CONFERIR O AVISO: a tela marca o fator do item para conferir — (c1) divergência do servidor com o nItem   │
 * │       e "fator" no código; (c2) no cartão do item, um elemento com `data-testid` `importacao-item-<n>-…` que    │
 * │       contém "fator" e "aviso"/"confer"/"diverg" (fora o campo e a conversão); (c3) na aba Divergências, uma    │
 * │       linha com "fator" no `data-codigo` que começa por "Item <n>:"; (c4) no fio, a marca de aviso em            │
 * │       `vinculo.fatorPelaNota` (uma propriedade booleana verdadeira de aviso — no nome REAL do contrato da        │
 * │       XML-04, o `cadastro` do `vinculo`, que só vem quando o cadastro diz OUTRO fator). Hoje não existe nenhuma  │
 * │       das quatro para o fator.                                                                                 │
 * │ E2 = a forma de pagamento é PERGUNTADA? "sim" quando o campo `importacao-forma` (aba Financeiro) está VAZIO ao   │
 * │      abrir (o gatilho do seletor com `is-empty`); "nao" quando já vem preenchido.                              │
 * │ E3 = com as duplicatas que não fecham, quantos dos TRÊS números aparecem no texto da conferência, em qualquer   │
 * │      das 5 abas (Cabeçalho, Itens, Pedido, Financeiro, Divergências): Σ das duplicatas, o líquido (vLiq da     │
 * │      fatura) e o total da compra (= vNF: no fim, a compra gerada TEM de valer isso). Cada número é procurado    │
 * │      formatado como a tela escreve dinheiro ("R$ 5.700,00" / "5.700,00") e cru ("5700.00"); 0 a 3.            │
 * │ E2 sem ligação = a MESMA medida do E2, lida ANTES de o tPag da nota ser ligado a uma forma (a conferência      │
 * │      aberta uma vez, sem nenhum gesto, só para isto). No mundo novo o E2 é lido DEPOIS da ligação: é o mundo em │
 * │      que o dono já ligou o código no cadastro (no E2E a ligação é fixture do caso, `ligacoes`); na base não há   │
 * │      cadastro de ligação, e os dois E2 são o mesmo mundo.                                                       │
 * │ E3b = DENTRO da explicação das duplicatas — o texto de todo elemento da aba Financeiro cujo `data-testid` começa │
 * │      por `importacao-parcelas-` e de toda linha da aba Divergências cujo `data-codigo` contém "parcelas" —:     │
 * │      (números) quantos dos TRÊS números do E3 aparecem (as mesmas formas: formatado e cru), 0 a 3; e            │
 * │      (comparação) "sim" quando TODA comparação que falhou é nomeada com a diferença — as comparações da regra  │
 * │      (Σ × líquido, líquido × total; falha acima de R$ 0,01) contadas pelo teste sobre os números do cenário     │
 * │      (`comparacoesDasDuplicatas`), e a diferença absoluta de cada uma que falhou presente na explicação (as      │
 * │      mesmas formas) —; "nao" quando falta alguma.                                                              │
 * │ E4 = os gestos do "operador mínimo", da conferência aberta (recarregada, fase B) até a compra gerada (o 201):   │
 * │      cada click / fill / selectOption / check — e o Enter que confirma a data digitada no calendário do        │
 * │      sistema (press) — passa pelo contador único (`Gestos`). O operador mínimo:                                 │
 * │        · TOP: escolhe a TOP do caso se o campo não estiver nela (selectOption);                                 │
 * │        · aba Itens: só se algum item pede ação (click); FATOR: digita o certo só onde o campo está errado ou    │
 * │          vazio (fill); CONVERSÃO: só se não for "multiply" (selectOption); LOCAL: só se a TOP o exige           │
 * │          (`regras-da-operacao`.exigeArmazem) e o item está sem (3 gestos do seletor);                           │
 * │        · aba Financeiro: só se algo ali pede ação (click); FORMA: só se vazia, escolhe a do cenário ("Boleto",  │
 * │          3 gestos: abrir, buscar, escolher); VENCIMENTO: com a tela na condição de pagamento (as parcelas da    │
 * │          nota não servem) e condição E vencimento vazios, digita o vencimento da 1ª duplicata (fill + Enter);   │
 * │          NATUREZA e CENTRO do documento: só se a TOP gera título sem o par padrão e o campo está vazio          │
 * │          (3 gestos cada);                                                                                      │
 * │        · "Gerar compra" (click) e espera o 201.                                                                │
 * │      A conta é a dos gestos EXECUTADOS (a lista sai inteira), nunca uma fórmula.                               │
 * │ Saída: UMA linha `XML04_MEDICAO {"mundo","antes","depois"}` — `antes` é o medido NA BASE (`MEDIDO_NA_BASE`,    │
 * │ abaixo), `depois` o desta execução com `E1`,`E1_itens`,`E2`,`E2_semLigacao`,`E3`,`E3b`,`E4`,`gestos` — e      │
 * │ `test.info().annotations`. Na base, `depois` É o antes (e o spec confere que reproduz `MEDIDO_NA_BASE`).       │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * As ASSERÇÕES DOS DOIS MUNDOS são premissas anti-vácuo: a conferência pendente, da empresa ativa, com o fornecedor
 * encontrado pelo emitente; os 9 primeiros sugeridos pela REFERÊNCIA com o produto do cenário; o 10º LEMBRADO com o
 * produto dele (e o banco testemunha o vínculo com o fator 6); a nota lida com Σ duplicatas, líquido e vNF do
 * cenário; o mundo do FIO igual ao do DOMÍNIO da árvore (o cadastro da ligação existe ⇔ a conferência traz as marcas
 * da XML-04); e, no fim, a compra GERADA (201, aberta) com o total = vNF e CADA item com o fator CERTO e a quantidade
 * interna = qCom × fator — o operador mínimo chegou ao resultado certo, senão nenhum número vale.
 *
 * O MUNDO NOVO É AFIRMADO (a fatia, decisão 318): E1 = 3 — os dois fatores PERGUNTADOS (U1, U2: o uCom fora do
 * cadastro) e o LEMBRADO que discorda do cadastro (V) —; E2 = "nao" com o tPag ligado e "sim" sem a ligação; E3b = os
 * três números e as comparações nomeadas; E4 MENOR que o da base. Na base, o spec confere que reproduz o que foi
 * medido nela (`MEDIDO_NA_BASE`): o "antes" desta linha não é um número digitado, é um número que este spec mede.
 */

/**
 * O MUNDO DE HOJE, MEDIDO POR ESTE SPEC NA BASE (origin/main 33291879, web e API da base sobre o banco do E2E migrado por
 * este HEAD): E1..E4 pelo A0 na fase 0 e de novo, com E2 sem ligação e E3b, pelo A4 no fim da fatia (o mesmo arquivo
 * copiado para a árvore da base). Na base o spec REPROVA se a medida mudar.
 */
const MEDIDO_NA_BASE = { commit: "332918798b039a0b2cf61c9334c30644a167e532", E1: 10, E2: "sim", E2_semLigacao: "sim", E3: 3, E3b: { numeros: 2, comparacao: "nao" }, E4: 21 } as const;

const ABAS = ["cabecalho", "itens", "pedido", "financeiro", "divergencias"] as const;
type Aba = (typeof ABAS)[number];

interface VinculoNoFio { situacao: string; origem?: string; produto?: { id: string }; fator?: string; tipoFator?: string }
interface ConferenciaNoFio {
  id: string; situacao: string; empresa: { id: string }; fornecedorEscolhido: string | null; parceiro: { situacao: string; id?: string };
  nota: { itens: { nItem: number; codigo: string; unidade: string; quantidade: string }[]; totais: { nota: string };
    fatura: { liquido: string | null } | null; duplicatas: { numero: string; vencimento: string; valor: string }[] };
  itens: { nItem: number; vinculo: VinculoNoFio }[];
  divergencias: { codigo: string; mensagem: string; nItem: number | null; bloqueia: boolean }[];
  financeiro: { parcelas: { situacao: string }; forma?: unknown };
}

/** Abre a conferência e devolve a resposta do GET que a PRÓPRIA tela fez (o fio). Termina na aba de entrada (Cabeçalho). */
async function abrirConferencia(page: Page, id: string): Promise<ConferenciaNoFio> {
  const leitura = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/importacoes/${id}`, { timeout: 20_000 });
  await page.goto(`/compras/importacoes/${id}`);
  const resposta = await leitura;
  expect(resposta.status(), "a tela leu a conferência (200)").toBe(200);
  const conf = (await resposta.json()) as ConferenciaNoFio;
  const raiz = page.getByTestId("importacao-conferencia");
  await expect(raiz, "a conferência desenhou, pendente").toHaveAttribute("data-situacao", "pendente");
  await expect(raiz).toHaveAttribute("data-relendo", "nao");
  await expect(page.getByText("A resposta do servidor não é a conferência que esta tela sabe ler."), "a tela leu a conferência").toHaveCount(0);
  await expect(page.getByTestId("importacao-aba-cabecalho"), "a conferência abre no Cabeçalho").toBeVisible();
  return conf;
}

/** O fator digitado é o certo? (texto decimal válido, igual ao certo) */
const fatorCerto = (valor: string, certo: string) => /^\d{1,12}(\.\d{1,6})?$/.test(valor) && D(valor).eq(D(certo));

interface ItemAoAbrir { n: number; fator: string; tipo: string; localVazio: boolean; marcasNaTela: string[]; temFatorNaTela: boolean }
interface FinanceiroAoAbrir { formaVazia: boolean; modoCondicao: boolean; condicaoVazia: boolean; vencimentoVazio: boolean }

/** A forma de pagamento ao abrir (aba Financeiro), sem nenhum gesto: vazia?, a origem declarada e o porquê do campo vazio. */
async function formaAoAbrir(page: Page) {
  await page.getByTestId("importacao-aba-financeiro-rotulo").click();
  await expect(page.getByTestId("importacao-aba-financeiro"), "medição: a aba Financeiro abriu").toBeVisible();
  const campo = page.getByTestId("importacao-forma");
  const pergunta = page.getByTestId(TESTIDS_DA_XML04.formaPergunta);
  return {
    vazia: await seletorVazio(campo), origem: await campo.getAttribute(TESTIDS_DA_XML04.formaAtributoOrigem),
    pergunta: (await pergunta.count()) > 0 ? textoNormalizado(await pergunta.innerText()) : null
  };
}

test("XML-04 MEDIÇÃO — nota de 10 itens: fatores a digitar/conferir (E1), forma perguntada (E2, com e sem a ligação do tPag), números das duplicatas que não fecham (E3, E3b) e gestos até a compra (E4)", async ({ page, ligacoes }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenarioDaXml04(page);
  const nV = ITENS_DO_CENARIO.findIndex((i) => i.grupo === "vinculo") + 1;
  const iV = ITENS_DO_CENARIO[nV - 1]!;
  expect(vinculoLembrado(c.fornecedor, c.codigoDo(iV.papel), iV.uCom), "premissa: o banco tem o vínculo lembrado do V (produto, multiplica, fator 6)")
    .toBe(`${c.produtos.get(nV)!.id}|multiply|${iV.fatorDoVinculo}`);

  // A IMPORTAÇÃO pela API (a mesma porta da tela), com a empresa ativa
  const imp = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", {
    nome_arquivo: `nfe-${c.nota.numero}.xml`, arquivo_base64: Buffer.from(c.nota.xml, "utf8").toString("base64"), empresa_id: c.empresa
  });

  /* ═════════════ E2 SEM LIGAÇÃO — a conferência aberta ANTES de o tPag ser ligado (nada aqui é gesto) ═════════════ */
  const semLigacao = await abrirConferencia(page, imp.id);
  const formaSemLigacao = await formaAoAbrir(page);
  const E2_semLigacao = formaSemLigacao.vazia ? "sim" : "nao";

  // O MUNDO EM QUE O DONO JÁ LIGOU: o tPag 15 da nota → a forma certa do cenário, pela porta do cadastro (fixture do
  // caso; sai no fim). Na base não há o cadastro: nada se liga (os dois E2 são o mesmo mundo).
  const cadastroDaLigacao = cadastroDaLigacaoNoDominio();
  const marcasSemLigacao = marcasDaXml04NoFio(semLigacao);
  expect(cadastroDaLigacao !== null, `premissa: o domínio desta árvore tem o cadastro da ligação ⇔ a conferência traz as marcas da XML-04 (${JSON.stringify(marcasSemLigacao)})`)
    .toBe(marcasSemLigacao.length > 0);
  if (cadastroDaLigacao) await ligacoes.ligar(COBRANCA_DO_CENARIO.tPag, c.formaCerta.id);

  /* ═════════════ FASE A — a conferência ABERTA, medida antes de qualquer gesto (nada aqui é gesto) ═════════════ */
  const conf = await abrirConferencia(page, imp.id);
  expect(conf, "premissa: a importação pendente, da empresa ativa, com o fornecedor encontrado pelo emitente")
    .toMatchObject({ id: imp.id, situacao: "pendente", empresa: { id: c.empresa }, parceiro: { situacao: "encontrado", id: c.fornecedor }, fornecedorEscolhido: c.fornecedor });
  expect(conf.nota.itens.map((i) => [i.nItem, i.codigo, i.unidade]), "premissa: as 10 linhas da nota, como declaradas")
    .toEqual(c.nota.itens.map((i) => [i.nItem, i.codigo, i.unidade.toUpperCase()]));
  expect([conf.nota.duplicatas.reduce((a, d) => a.plus(D(d.valor)), D(0)).toFixed(2), conf.nota.fatura?.liquido ? D(conf.nota.fatura.liquido).toFixed(2) : null, D(conf.nota.totais.nota).toFixed(2)],
    "premissa: o servidor leu Σ duplicatas, líquido e vNF do cenário").toEqual([c.nota.somaDasDuplicatas, c.nota.vLiq, c.nota.vNF]);
  const vinculo = (n: number): VinculoNoFio => {
    const i = conf.itens.find((x) => x.nItem === n);
    expect(i, `premissa: a conferência traz o vínculo do item ${n}`).toBeTruthy();
    return i!.vinculo;
  };
  for (const [k, item] of ITENS_DO_CENARIO.entries()) {
    const n = k + 1; const v = vinculo(n);
    if (item.grupo === "vinculo") expect([v.situacao, v.produto?.id], `premissa: o ${item.papel} vem pelo VÍNCULO LEMBRADO, com o produto dele`).toEqual(["lembrado", c.produtos.get(n)!.id]);
    else expect([v.situacao, v.origem, v.produto?.id], `premissa: o ${item.papel} é sugerido pela REFERÊNCIA, com o produto dele`).toEqual(["sugerido", "reference", c.produtos.get(n)!.id]);
  }

  const textos = {} as Record<Aba, string>;
  const itensAoAbrir = new Map<number, ItemAoAbrir>();
  let financeiroAoAbrir: FinanceiroAoAbrir | null = null;
  let divergenciasNaTela: { codigo: string; texto: string }[] = [];
  let explicacaoNoFinanceiro: { testid: string; texto: string }[] = [];
  for (const aba of ABAS) {
    await page.getByTestId(`importacao-aba-${aba}-rotulo`).click();
    await expect(page.getByTestId(`importacao-aba-${aba}`), `medição: a aba ${aba} abriu`).toBeVisible();
    if (aba === "itens") {
      for (const n of ITENS_DO_CENARIO.map((_, k) => k + 1)) {
        const pede = `importacao-item-${n}`;
        const cartao = page.getByTestId(pede);
        await expect(cartao, `medição: o cartão do item ${n} mostra a situação da resposta`).toHaveAttribute("data-vinculo", vinculo(n).situacao);
        const testids = await cartao.locator("[data-testid]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
        const campoFator = page.getByTestId(`${pede}-fator`);
        const temFatorNaTela = (await campoFator.count()) > 0;
        const marcasNaTela = temFatorNaTela ? testids.filter((t) => t.startsWith(`${pede}-`) && t !== `${pede}-fator` && t !== `${pede}-tipo-fator` && /fator/i.test(t) && /aviso|confer|diverg/i.test(t)) : [];
        const local = page.getByTestId(`${pede}-local`);
        const itemCenario = ITENS_DO_CENARIO[n - 1]!;
        itensAoAbrir.set(n, {
          n,
          fator: temFatorNaTela ? await campoFator.inputValue() : fatorNoCorpoDoItem(itemCenario, vinculo(n)),
          tipo: temFatorNaTela ? await page.getByTestId(`${pede}-tipo-fator`).inputValue() : "multiply",
          localVazio: (await local.count()) > 0 ? await seletorVazio(local) : false, marcasNaTela, temFatorNaTela
        });
        if (!temFatorNaTela) await expectCamposAvancadosAusentes(page, n);
      }
    }
    if (aba === "financeiro") {
      const vencimento = page.getByTestId("importacao-vencimento");
      const modoCondicao = (await vencimento.count()) > 0;
      financeiroAoAbrir = {
        formaVazia: await seletorVazio(page.getByTestId("importacao-forma")), modoCondicao,
        condicaoVazia: modoCondicao ? await seletorVazio(page.getByTestId("importacao-condicao")) : true,
        vencimentoVazio: modoCondicao ? (await vencimento.inputValue()) === "" : true
      };
      explicacaoNoFinanceiro = await page.getByTestId("importacao-aba-financeiro").locator('[data-testid^="importacao-parcelas-"]')
        .evaluateAll((els) => els.map((e) => ({ testid: e.getAttribute("data-testid") ?? "", texto: (e as HTMLElement).innerText })));
    }
    if (aba === "divergencias") {
      divergenciasNaTela = await page.getByTestId("importacao-divergencia").evaluateAll((els) => els.map((e) => ({ codigo: e.getAttribute("data-codigo") ?? "", texto: e.textContent ?? "" })));
    }
    textos[aba] = await page.getByTestId("importacao-conferencia").innerText();
  }
  expect(itensAoAbrir.size, "medição: os 10 cartões foram lidos").toBe(ITENS_DO_CENARIO.length);
  expect(financeiroAoAbrir, "medição: a aba Financeiro foi lida").not.toBeNull();
  const fin = financeiroAoAbrir!;

  /* ── E1 ── */
  const E1_itens = ITENS_DO_CENARIO.map((item, k) => {
    const n = k + 1;
    const lido = itensAoAbrir.get(n)!;
    const origem: OrigemDoFator = origemDoFator(vinculo(n));
    const c1 = conf.divergencias.filter((d) => d.nItem === n && /fator/i.test(d.codigo)).map((d) => `servidor:${d.codigo}`);
    const c3 = divergenciasNaTela.filter((d) => /fator/i.test(d.codigo) && d.texto.includes(`Item ${n}:`)).map((d) => `lista:${d.codigo}`);
    const avisos = [...c1, ...lido.marcasNaTela.map((t) => `tela:${t}`), ...c3, ...(origem.avisoNoFio ? [`fio:fatorPelaNota.${origem.avisoNoFio}`] : [])];
    const digitar = lido.temFatorNaTela && (!fatorCerto(lido.fator, item.fatorCerto) || lido.tipo !== "multiply");
    const regra = !lido.temFatorNaTela ? null : digitar ? "a" : fatorSemRespaldo(origem) ? "b" : avisos.length > 0 ? "c" : null;
    return { n, papel: item.papel, regra, fator: lido.fator, tipo: lido.tipo, certo: item.fatorCerto, origem: `${origem.doFio ? "fio" : "hoje"}:${origem.origem}`, avisos };
  });
  const E1 = E1_itens.filter((i) => i.regra !== null).length;

  /* ── E2 ── */
  const E2 = fin.formaVazia ? "sim" : "nao";

  /* ── E3 ── */
  const numeros = { somaDasDuplicatas: c.nota.somaDasDuplicatas, liquido: c.nota.vLiq, totalDaCompra: c.nota.vNF } as const;
  const E3_detalhe = Object.fromEntries(Object.entries(numeros).map(([nome, valor]) => [nome, {
    valor, onde: ABAS.flatMap((aba) => formasDoNumeroNoTexto(textos[aba], valor).map((forma) => `${aba}:${forma}`))
  }]));
  const E3 = Object.values(E3_detalhe).filter((x) => x.onde.length > 0).length;

  /* ── E3b ── */
  const explicacao = [
    ...explicacaoNoFinanceiro.map((x) => ({ onde: `financeiro:${x.testid}`, texto: x.texto })),
    ...divergenciasNaTela.filter((d) => /parcelas/i.test(d.codigo)).map((d) => ({ onde: `divergencias:${d.codigo}`, texto: d.texto }))
  ];
  const ondeNaExplicacao = (valor: string) => explicacao.flatMap((x) => formasDoNumeroNoTexto(x.texto, valor).map((forma) => `${x.onde}:${forma}`));
  const E3b_numeros = Object.fromEntries(Object.entries(numeros).map(([nome, valor]) => [nome, ondeNaExplicacao(valor)]));
  const E3b_comparacoes = comparacoesDasDuplicatas(numeros).map((x) => ({ ...x, naExplicacao: x.falhou ? ondeNaExplicacao(x.diferenca) : [] }));
  expect(E3b_comparacoes.some((x) => x.falhou), "premissa: no cenário alguma comparação da regra das duplicatas FALHA (senão E3b não mede nada)").toBe(true);
  const E3b = {
    numeros: Object.values(E3b_numeros).filter((onde) => onde.length > 0).length,
    comparacao: E3b_comparacoes.filter((x) => x.falhou).every((x) => x.naExplicacao.length > 0) ? "sim" : "nao"
  };

  /* ═════════════ FASE B — o OPERADOR MÍNIMO, da conferência aberta (recarregada) até a compra gerada ═════════════ */
  const regras = await api<{ exigeArmazem: boolean }>(page, "GET", `/api/compras/compras/regras-da-operacao?tipo_operacao_id=${c.top}`);
  const reaberta = await abrirConferencia(page, imp.id);
  expect(reaberta.itens, "premissa: a conferência reaberta é a mesma que foi medida").toEqual(conf.itens);
  const g = new Gestos();

  // CABEÇALHO: a TOP do caso
  const top = page.getByTestId("importacao-top");
  await expect(top, "a lista de TOPs de compra carregou").toBeVisible();
  if ((await top.inputValue()) !== c.top) await g.selectOption(top, c.top, "TOP de compra");
  await expect(top).toHaveValue(c.top);

  // ITENS: o fator onde está errado ou vazio; a conversão; o Local quando a TOP o exige
  const itensComAcao = E1_itens.filter((i) => {
    const ab = itensAoAbrir.get(i.n)!;
    const fatorPrecisa = ab.temFatorNaTela && (!fatorCerto(i.fator, i.certo) || i.tipo !== "multiply");
    return fatorPrecisa || (regras.exigeArmazem && ab.localVazio);
  });
  if (itensComAcao.length > 0) {
    await g.click(page.getByTestId("importacao-aba-itens-rotulo"), "aba Itens");
    await expect(page.getByTestId("importacao-aba-itens")).toBeVisible();
    for (const i of itensComAcao) {
      const pede = `importacao-item-${i.n}`;
      const ab = itensAoAbrir.get(i.n)!;
      if (ab.temFatorNaTela) {
        const campo = page.getByTestId(`${pede}-fator`);
        await expect(campo, `item ${i.n}: o campo Fator reaberto é o que foi medido`).toHaveValue(i.fator);
        if (!fatorCerto(i.fator, i.certo)) await g.fill(campo, i.certo, `item ${i.n} fator`);
        if (i.tipo !== "multiply") await g.selectOption(page.getByTestId(`${pede}-tipo-fator`), "multiply", `item ${i.n} conversão`);
      }
      if (regras.exigeArmazem && ab.localVazio) await escolherNoSeletorContando(page, g, page.getByTestId(`${pede}-local`), c.local.nome, `item ${i.n} Local`);
    }
  }

  // FINANCEIRO: a forma (vazia), o vencimento (condição sem nada) — natureza/centro saíram da conferência
  const pedeVencimento = fin.modoCondicao && fin.condicaoVazia && fin.vencimentoVazio;
  if (fin.formaVazia || pedeVencimento) {
    await g.click(page.getByTestId("importacao-aba-financeiro-rotulo"), "aba Financeiro");
    await expect(page.getByTestId("importacao-aba-financeiro")).toBeVisible();
    if (fin.formaVazia) await escolherNoSeletorContando(page, g, page.getByTestId("importacao-forma"), COBRANCA_DO_CENARIO.formaCerta, "Forma de pagamento");
    if (pedeVencimento) {
      // O calendário do sistema: digita dd/mm/aaaa no campo visível e o Enter confirma; o campo escondido guarda o ISO.
      const vencimento = COBRANCA_DO_CENARIO.duplicatas[0].vencimento;
      const campo = page.getByTestId("importacao-aba-financeiro").getByLabel("Vencimento", { exact: true });
      await g.fill(campo, dataComoSeDigita(vencimento), "Vencimento");
      await g.press(campo, "Enter", "Vencimento");
      await expect(page.getByTestId("importacao-vencimento"), "o vencimento virou a data ISO da 1ª duplicata").toHaveValue(vencimento);
    }
  }

  // GERAR COMPRA
  const gerar = page.getByTestId("importacao-gerar-compra");
  await expect(gerar, "nada bloqueia o Gerar compra").toBeEnabled();
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/importacoes/${imp.id}/gerar-compra`, { timeout: 30_000 });
  await g.click(gerar, "Gerar compra");
  const resposta = await post;
  const texto = await resposta.text();
  expect(resposta.status(), `a compra foi gerada (201): ${texto.slice(0, 300)}`).toBe(201);
  const compra = JSON.parse(texto) as { id: string; situacao: string; valor_total: string };

  /* ── PREMISSAS DO FIM: a compra é a CERTA (o operador mínimo chegou ao resultado do cenário) ── */
  expect([compra.situacao, D(compra.valor_total).toFixed(2)], "premissa: a compra nasceu ABERTA com o total = vNF (o total da compra do E3)").toEqual(["aberto", c.nota.vNF]);
  const gravada = await api<{ itens: Record<string, unknown>[] }>(page, "GET", `/api/compras/compras/${compra.id}`);
  const porItem = [...gravada.itens].sort((a, b) => Number(a["n_item_nota"]) - Number(b["n_item_nota"]))
    .map((i) => [Number(i["n_item_nota"]), String(i["produto_id"]), D(String(i["fator_conversao"])).toFixed(), String(i["tipo_fator_conversao"]), D(String(i["quantidade"])).toFixed(4)]);
  const fatorGravado = (item: (typeof ITENS_DO_CENARIO)[number]) => fatorNoCorpoDoItem(item);
  expect(porItem, "premissa: cada item com o produto, o fator do corpo automático e qCom × fator")
    .toEqual(ITENS_DO_CENARIO.map((item, k) => [k + 1, c.produtos.get(k + 1)!.id, D(fatorGravado(item)).toFixed(), "multiply", D(item.quantidade).times(D(fatorGravado(item))).toFixed(4)]));

  /* ── a saída ── */
  const marcas = marcasDaXml04NoFio(conf);
  const mundo = marcas.length > 0 ? "novo" : "main";
  expect(mundo === "novo", "premissa: o mundo do fio é o do domínio desta árvore (o cadastro da ligação existe ⇔ marcas da XML-04 na conferência)").toBe(cadastroDaLigacao !== null);
  const depois = {
    E1, E1_itens: E1_itens.map((i) => ({ n: i.n, papel: i.papel, regra: i.regra, fator: i.fator, certo: i.certo, origem: i.origem })),
    E2, E2_semLigacao, E3, E3b, E4: g.total, gestos: g.lista
  };
  const resultado = { mundo, antes: { ...MEDIDO_NA_BASE }, depois };
  console.log(`XML04_MEDICAO ${JSON.stringify(resultado)}`);
  console.log(`XML04_MEDICAO_DETALHE ${JSON.stringify({
    mundo, E2: { semLigacao: formaSemLigacao, ligada: { vazia: fin.formaVazia }, formaNoFio: conf.financeiro.forma ?? null },
    E3b: { numeros: E3b_numeros, comparacoes: E3b_comparacoes.map((x) => ({ codigo: x.codigo, falhou: x.falhou, diferenca: x.diferenca, naExplicacao: x.naExplicacao })) }
  })}`);
  test.info().annotations.push({ type: "XML04_MEDICAO", description: JSON.stringify(resultado) });
  test.info().annotations.push({ type: "XML04 detalhe", description: JSON.stringify({
    marcasDaXml04NoFio: marcas, cadastroDaLigacaoNoDominio: cadastroDaLigacao, E1_avisos: E1_itens.map((i) => ({ n: i.n, tipo: i.tipo, avisos: i.avisos })),
    E2_semLigacao: { ...formaSemLigacao, formaNoFio: semLigacao.financeiro.forma ?? null }, E2_financeiroAoAbrir: fin, formaNoFio: conf.financeiro.forma ?? null,
    E3: E3_detalhe, E3b: { numeros: E3b_numeros, comparacoes: E3b_comparacoes, explicacao },
    regrasDaTop: { geraTitulos: regras.geraTitulos, exigeArmazem: regras.exigeArmazem, padroes: regras.padroes !== null },
    parcelasDaConferencia: conf.financeiro.parcelas.situacao, divergenciasDoServidor: conf.divergencias.map((d) => d.codigo)
  }) });

  /* ── O MUNDO NOVO, AFIRMADO; a base, reproduzida ── */
  if (mundo === "novo") {
    const semFatorNaTela = ITENS_DO_CENARIO.every((_, k) => !itensAoAbrir.get(k + 1)!.temFatorNaTela);
    if (semFatorNaTela) {
      expect(E1, "XML-04 (sem fator na tela): E1 = 0 — nada a digitar/conferir").toBe(0);
      expect(E1_itens.every((i) => i.regra === null), "nenhum item entra na regra E1").toBe(true);
    } else {
      expect(E1_itens.filter((i) => i.regra !== null).map((i) => [i.papel, i.regra]), "XML-04: E1 = 3 — os dois fatores PERGUNTADOS e o lembrado que discorda")
        .toEqual([["U1", "a"], ["U2", "a"], ["V", "a"]]);
      expect(E1, `XML-04: E1 cai (base ${MEDIDO_NA_BASE.E1})`).toBeLessThan(MEDIDO_NA_BASE.E1);
    }
    expect([E2, E2_semLigacao], "XML-04: com o tPag ligado a forma NÃO é perguntada; sem a ligação, é").toEqual(["nao", "sim"]);
    expect(fin.formaVazia, "XML-04: a forma da nota veio escolhida").toBe(false);
    expect(E3, "XML-04: os três números continuam na conferência").toBe(3);
    expect(E3b, "XML-04: a explicação das duplicatas traz os TRÊS números e nomeia cada comparação que falhou, com a diferença").toEqual({ numeros: 3, comparacao: "sim" });
    expect(g.total, `XML-04: E4 cai (base ${MEDIDO_NA_BASE.E4})`).toBeLessThan(MEDIDO_NA_BASE.E4);
  } else {
    expect({ E1, E2, E2_semLigacao, E3, E3b, E4: g.total }, `a base reproduz o que foi medido nela (${MEDIDO_NA_BASE.commit.slice(0, 8)})`)
      .toEqual({ E1: MEDIDO_NA_BASE.E1, E2: MEDIDO_NA_BASE.E2, E2_semLigacao: MEDIDO_NA_BASE.E2_semLigacao, E3: MEDIDO_NA_BASE.E3, E3b: MEDIDO_NA_BASE.E3b, E4: MEDIDO_NA_BASE.E4 });
  }
});
