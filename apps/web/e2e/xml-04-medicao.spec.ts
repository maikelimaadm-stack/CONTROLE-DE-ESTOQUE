import type { Page } from "@playwright/test";
import { D } from "@agro/shared";
import { login, api } from "./helpers";
import { test, expect } from "./central-compras-fixtures";
import {
  COBRANCA_DO_CENARIO, ITENS_DO_CENARIO, Gestos, caminho, campoDeTPagNoDominio, cenarioDaXml04, dataComoSeDigita, escolherNoSeletorContando, fatorSemRespaldo,
  formasDoNumeroNoTexto, marcasDaXml04NoFio, origemDoFator, seletorVazio, vinculoLembrado, type OrigemDoFator
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
 * │       linha com "fator" no `data-codigo` que começa por "Item <n>:"; (c4) no fio, uma propriedade booleana       │
 * │       verdadeira de aviso em `vinculo.fatorPelaNota`. Hoje não existe nenhuma das quatro para o fator.          │
 * │ E2 = a forma de pagamento é PERGUNTADA? "sim" quando o campo `importacao-forma` (aba Financeiro) está VAZIO ao   │
 * │      abrir (o gatilho do seletor com `is-empty`); "nao" quando já vem preenchido.                              │
 * │ E3 = com as duplicatas que não fecham, quantos dos TRÊS números aparecem no texto da conferência, em qualquer   │
 * │      das 5 abas (Cabeçalho, Itens, Pedido, Financeiro, Divergências): Σ das duplicatas, o líquido (vLiq da     │
 * │      fatura) e o total da compra (= vNF: no fim, a compra gerada TEM de valer isso). Cada número é procurado    │
 * │      formatado como a tela escreve dinheiro ("R$ 5.700,00" / "5.700,00") e cru ("5700.00"); 0 a 3.            │
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
 * │ Saída: UMA linha `XML04_MEDICAO {"mundo","E1","E1_itens","E2","E3","E4","gestos"}` e `test.info().annotations`. │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * As ASSERÇÕES são premissas anti-vácuo, verdadeiras nos dois mundos: a conferência pendente, da empresa ativa, com o
 * fornecedor encontrado pelo emitente; os 9 primeiros sugeridos pela REFERÊNCIA com o produto do cenário; o 10º
 * LEMBRADO com o produto dele (e o banco testemunha o vínculo com o fator 6); a nota lida com Σ duplicatas, líquido e
 * vNF do cenário; e, no fim, a compra GERADA (201, aberta) com o total = vNF e CADA item com o fator CERTO e a
 * quantidade interna = qCom × fator — o operador mínimo chegou ao resultado certo, senão nenhum número vale.
 */

const ABAS = ["cabecalho", "itens", "pedido", "financeiro", "divergencias"] as const;
type Aba = (typeof ABAS)[number];

interface VinculoNoFio { situacao: string; origem?: string; produto?: { id: string }; fator?: string; tipoFator?: string }
interface ConferenciaNoFio {
  id: string; situacao: string; empresa: { id: string }; fornecedorEscolhido: string | null; parceiro: { situacao: string; id?: string };
  nota: { itens: { nItem: number; codigo: string; unidade: string; quantidade: string }[]; totais: { nota: string };
    fatura: { liquido: string | null } | null; duplicatas: { numero: string; vencimento: string; valor: string }[] };
  itens: { nItem: number; vinculo: VinculoNoFio }[];
  divergencias: { codigo: string; mensagem: string; nItem: number | null; bloqueia: boolean }[];
  financeiro: { parcelas: { situacao: string } };
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

interface ItemAoAbrir { n: number; fator: string; tipo: string; localVazio: boolean; marcasNaTela: string[] }
interface FinanceiroAoAbrir { formaVazia: boolean; modoCondicao: boolean; condicaoVazia: boolean; vencimentoVazio: boolean; naturezaVisivel: boolean; naturezaVazia: boolean; centroVazio: boolean }

test("XML-04 MEDIÇÃO — nota de 10 itens: fatores a digitar/conferir (E1), forma perguntada (E2), números das duplicatas que não fecham (E3) e gestos até a compra (E4)", async ({ page }) => {
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
  for (const aba of ABAS) {
    await page.getByTestId(`importacao-aba-${aba}-rotulo`).click();
    await expect(page.getByTestId(`importacao-aba-${aba}`), `medição: a aba ${aba} abriu`).toBeVisible();
    if (aba === "itens") {
      for (const n of ITENS_DO_CENARIO.map((_, k) => k + 1)) {
        const pede = `importacao-item-${n}`;
        const cartao = page.getByTestId(pede);
        await expect(cartao, `medição: o cartão do item ${n} mostra a situação da resposta`).toHaveAttribute("data-vinculo", vinculo(n).situacao);
        const testids = await cartao.locator("[data-testid]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
        const marcasNaTela = testids.filter((t) => t.startsWith(`${pede}-`) && t !== `${pede}-fator` && t !== `${pede}-tipo-fator` && /fator/i.test(t) && /aviso|confer|diverg/i.test(t));
        const local = page.getByTestId(`${pede}-local`);
        itensAoAbrir.set(n, {
          n, fator: await page.getByTestId(`${pede}-fator`).inputValue(), tipo: await page.getByTestId(`${pede}-tipo-fator`).inputValue(),
          localVazio: (await local.count()) > 0 ? await seletorVazio(local) : false, marcasNaTela
        });
      }
    }
    if (aba === "financeiro") {
      const vencimento = page.getByTestId("importacao-vencimento");
      const modoCondicao = (await vencimento.count()) > 0;
      const natureza = page.getByTestId("importacao-natureza");
      const naturezaVisivel = (await natureza.count()) > 0;
      financeiroAoAbrir = {
        formaVazia: await seletorVazio(page.getByTestId("importacao-forma")), modoCondicao,
        condicaoVazia: modoCondicao ? await seletorVazio(page.getByTestId("importacao-condicao")) : true,
        vencimentoVazio: modoCondicao ? (await vencimento.inputValue()) === "" : true,
        naturezaVisivel, naturezaVazia: naturezaVisivel ? await seletorVazio(natureza) : false,
        centroVazio: naturezaVisivel ? await seletorVazio(page.getByTestId("importacao-centro")) : false
      };
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
    const digitar = !fatorCerto(lido.fator, item.fatorCerto) || lido.tipo !== "multiply";
    const regra = digitar ? "a" : fatorSemRespaldo(origem) ? "b" : avisos.length > 0 ? "c" : null;
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

  /* ═════════════ FASE B — o OPERADOR MÍNIMO, da conferência aberta (recarregada) até a compra gerada ═════════════ */
  const regras = await api<{ geraTitulos: boolean; exigeArmazem: boolean; padroes: { natureza: unknown; centro: unknown } | null }>(
    page, "GET", `/api/compras/compras/regras-da-operacao?tipo_operacao_id=${c.top}`);
  const reaberta = await abrirConferencia(page, imp.id);
  expect(reaberta.itens, "premissa: a conferência reaberta é a mesma que foi medida").toEqual(conf.itens);
  const g = new Gestos();

  // CABEÇALHO: a TOP do caso
  const top = page.getByTestId("importacao-top");
  await expect(top, "a lista de TOPs de compra carregou").toBeVisible();
  if ((await top.inputValue()) !== c.top) await g.selectOption(top, c.top, "TOP de compra");
  await expect(top).toHaveValue(c.top);

  // ITENS: o fator onde está errado ou vazio; a conversão; o Local quando a TOP o exige
  const itensComAcao = E1_itens.filter((i) => !fatorCerto(i.fator, i.certo) || i.tipo !== "multiply" || (regras.exigeArmazem && itensAoAbrir.get(i.n)!.localVazio));
  if (itensComAcao.length > 0) {
    await g.click(page.getByTestId("importacao-aba-itens-rotulo"), "aba Itens");
    await expect(page.getByTestId("importacao-aba-itens")).toBeVisible();
    for (const i of itensComAcao) {
      const pede = `importacao-item-${i.n}`;
      const campo = page.getByTestId(`${pede}-fator`);
      await expect(campo, `item ${i.n}: o campo Fator reaberto é o que foi medido`).toHaveValue(i.fator);
      if (!fatorCerto(i.fator, i.certo)) await g.fill(campo, i.certo, `item ${i.n} fator`);
      if (i.tipo !== "multiply") await g.selectOption(page.getByTestId(`${pede}-tipo-fator`), "multiply", `item ${i.n} conversão`);
      if (regras.exigeArmazem && itensAoAbrir.get(i.n)!.localVazio) await escolherNoSeletorContando(page, g, page.getByTestId(`${pede}-local`), c.local.nome, `item ${i.n} Local`);
      const q = c.nota.itens[i.n - 1]!.quantidade;
      await expect(page.getByTestId(`${pede}-quantidade-interna`), `item ${i.n}: a quantidade interna é qCom × o fator certo`).toHaveText(D(q).times(D(i.certo)).toFixed(4));
    }
  }

  // FINANCEIRO: a forma (vazia), o vencimento (condição sem nada), a natureza e o centro (exigidos e vazios)
  const exigeClassificacao = regras.geraTitulos && !(regras.padroes?.natureza && regras.padroes?.centro);
  const pedeVencimento = fin.modoCondicao && fin.condicaoVazia && fin.vencimentoVazio;
  const pedeNatureza = exigeClassificacao && fin.naturezaVisivel && fin.naturezaVazia;
  const pedeCentro = exigeClassificacao && fin.naturezaVisivel && fin.centroVazio;
  if (fin.formaVazia || pedeVencimento || pedeNatureza || pedeCentro) {
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
    if (pedeNatureza) await escolherNoSeletorContando(page, g, page.getByTestId("importacao-natureza"), c.ref.natureza.label, "Natureza de despesa");
    if (pedeCentro) await escolherNoSeletorContando(page, g, page.getByTestId("importacao-centro"), c.ref.centro.label, "Centro de resultado");
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
  expect(porItem, "premissa: cada item da compra com o produto, o fator CERTO e a quantidade interna = qCom × fator")
    .toEqual(ITENS_DO_CENARIO.map((item, k) => [k + 1, c.produtos.get(k + 1)!.id, D(item.fatorCerto).toFixed(), "multiply", D(item.quantidade).times(D(item.fatorCerto)).toFixed(4)]));

  /* ── a saída ── */
  const marcas = marcasDaXml04NoFio(conf);
  const mundo = marcas.length > 0 ? "novo" : "main";
  const resultado = {
    mundo, E1, E1_itens: E1_itens.map((i) => ({ n: i.n, papel: i.papel, regra: i.regra, fator: i.fator, certo: i.certo, origem: i.origem })),
    E2, E3, E4: g.total, gestos: g.lista
  };
  console.log(`XML04_MEDICAO ${JSON.stringify(resultado)}`);
  test.info().annotations.push({ type: "XML04_MEDICAO", description: JSON.stringify(resultado) });
  test.info().annotations.push({ type: "XML04 detalhe", description: JSON.stringify({
    marcasDaXml04NoFio: marcas, campoDeTPagNoDominio: campoDeTPagNoDominio(), E1_avisos: E1_itens.map((i) => ({ n: i.n, tipo: i.tipo, avisos: i.avisos })),
    E2_financeiroAoAbrir: fin, E3: E3_detalhe, regrasDaTop: { geraTitulos: regras.geraTitulos, exigeArmazem: regras.exigeArmazem, padroes: regras.padroes !== null },
    parcelasDaConferencia: conf.financeiro.parcelas.situacao, divergenciasDoServidor: conf.divergencias.map((d) => d.codigo)
  }) });
});
