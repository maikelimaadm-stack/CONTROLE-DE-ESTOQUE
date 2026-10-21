import type { Locator, Page, Response } from "@playwright/test";
import { configuracaoNeutraTopV5, enumLabel, type ConfiguracaoTipoOperacaoV5 } from "@agro/domain";
import { D } from "@agro/shared";
import { api, login, uniq } from "./helpers";
import { codigoTop, criarTop, type Opcao } from "./central-compras-fixtures";
import { campoDoFormulario, escolherNoSeletor } from "./xml-02-comum";
import {
  TESTIDS_DA_XML04, abrirConferenciaDaXml04, caminho, cenarioDaXml04, compraNoBanco, contarPedidosDaTop, dataComoSeDigita, duplicatasQueSomam, expect, expectCamposAvancadosAusentes, fatorNoCorpoDoItem, importarNotaDaXml04, irParaAba,
  ligacaoNoBanco, ligacoesVivasDoCodigo, nDo, notaDoCenario, quantidadeNotaBR, seletorVazio, test, textoNormalizado, vinculoNoFio, vinculosDoFornecedor,
  type CenarioDaXml04, type ConferenciaNoFioDaXml04
} from "./xml-04-comum";

/**
 * XML-04 (decisão 318) — A TELA DA CONFERÊNCIA: o FATOR vem do cadastro, a FORMA vem da nota, a DUPLICATA diz por quê.
 * Web e API DESTE HEAD (a suíte comum; os dois sentidos do skew têm specs próprios).
 *
 * ┌─ OS CASOS ──────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ X4-T1  O FATOR, item a item, na nota de 10 itens do cenário (`xml-04-comum.ts`): (a) os 4 da unidade         │
 * │        PRINCIPAL com o fator 1 e a origem; (b) as 3 ALTERNATIVAS com o fator do cadastro e a origem; (c) os 2 │
 * │        de uCom FORA do cadastro com o campo VAZIO, a pergunta dizendo a unidade e o "Gerar compra" bloqueado  │
 * │        até digitar — digitado, a origem vira "informado na tela"; (d) o LEMBRADO que discorda do cadastro com │
 * │        o fator do vínculo e o aviso com os DOIS números; (j) o "Gerar compra" com tudo resolvido, conferido  │
 * │        NO BANCO: o fator de cada item, a forma da nota no documento e o vínculo que só nasce no gerar.       │
 * │ X4-T2  A FORMA PELA NOTA: (e) o tPag ligado vem escolhido com a origem; sem ligação, a pergunta com o código │
 * │        e o caminho do cadastro; dois `<detPag>` (um deles ligado), a pergunta de mais de uma forma; sem       │
 * │        `<detPag>`, a pergunta de que a nota não diz; (f) a escolha do operador VENCE a da nota e vai gravada. │
 * │ X4-T3  A FORMA E A TOP (a regra da 311): a TOP que COBRA a forma com um padrão e DEIXA trocar — a nota vence  │
 * │        o padrão; sem a forma da nota, vale o padrão (com a origem). (g) A TOP que cobra e NÃO deixa trocar,   │
 * │        com a forma da nota diferente: vale a da TOP, o campo TRAVADO e o aviso com as duas; gravada a da TOP. │
 * │ X4-T4  (h) A DUPLICATA QUE NÃO FECHA diz os três números e CADA comparação que falhou, com a diferença — as   │
 * │        duas, só a da soma, só a do líquido —; sem duplicatas por falta de vencimento e sem duplicatas dizem  │
 * │        o motivo; as que fecham continuam a tabela (a regra não mudou).                                        │
 * │ X4-T5  (i) O cadastro "Formas de Pagamento da NF-e" abre pelo MENU (Configurações › Financeiro, na subaba     │
 * │        certa) e cria a ligação de um código a uma forma do SISTEMA.                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O SERVIDOR É O ÁRBITRO. Cada caso lê a PREMISSA no fio (a conferência que a própria tela recebeu: `fatorPelaNota`,
 * `financeiro.forma`, `financeiro.parcelas`), captura o POST REAL do "Gerar compra" e lê o GRAVADO no banco do E2E (só
 * SELECT: `compraNoBanco`, `vinculosDoFornecedor`, `ligacaoNoBanco`). Os textos são conferidos por EXTENSO — o texto é
 * o produto desta fatia ("número na mão, nunca 'confira'").
 *
 * OS DADOS: o cenário nasce pela API (as portas de `central-compras-fixtures`, excluídas no fim do caso); as ligações
 * tPag → forma são fixture do caso (`ligacoes`, desligadas no fim): T1 e T3 ligam o 15, T2 liga o 03 e T5 cria o 10
 * pela tela; os códigos que o caso usa SEM ligação (04 e 17) e os que ele liga são conferidos antes, no banco, sem
 * ligação viva. As compras, as importações e os vínculos lembrados ficam (ledger e cadastro que não se apaga; decisão 247).
 */

const MULTIPLICA = enumLabel("tipo_fator_conversao", "multiply");
const doItem = (page: Page, n: number, sufixo: string) => page.getByTestId(`importacao-item-${n}-${sufixo}`);
const campoDaForma = (page: Page) => page.getByTestId("importacao-forma");
const textoDe = async (l: Locator) => textoNormalizado(await l.innerText());

/** Uma forma de pagamento do seed pelo nome EXATO (a da organização ou do sistema). */
async function formaDoSeed(page: Page, nome: string): Promise<Opcao> {
  const achadas = (await api<Opcao[]>(page, "GET", "/api/resources/payment_methods/options")).filter((f) => f.label === nome);
  expect(achadas.map((f) => f.label), `premissa: o seed tem UMA forma de pagamento "${nome}"`).toHaveLength(1);
  return achadas[0]!;
}

/** A forma da conferência no fio, como `[situacao, tPag|quantidade, forma.id]`. */
function formaNoFio(conf: ConferenciaNoFioDaXml04): unknown[] {
  const f = conf.financeiro.forma;
  expect(f, "premissa: a API deste HEAD declara `financeiro.forma`").toBeTruthy();
  const forma = f!["forma"] as { id?: string } | undefined;
  return [f!.situacao, f!["tPag"] ?? f!["quantidade"] ?? null, forma?.id ?? null];
}

/** O campo da forma na aba Financeiro: a origem declarada, a trava, o que o seletor mostra e os três textos. */
async function formaNaTela(page: Page) {
  await irParaAba(page, "financeiro");
  const campo = campoDaForma(page);
  const texto = async (testid: string) => { const l = page.getByTestId(testid); return (await l.count()) > 0 ? await textoDe(l) : null; };
  return {
    origem: await campo.getAttribute(TESTIDS_DA_XML04.formaAtributoOrigem), travada: await campo.getAttribute(TESTIDS_DA_XML04.formaAtributoTrava),
    vazia: await seletorVazio(campo), mostra: textoNormalizado((await campo.getByRole("combobox").innerText()).trim()),
    habilitada: await campo.getByRole("combobox").isEnabled(),
    origemTexto: await texto(TESTIDS_DA_XML04.formaOrigem), pergunta: await texto(TESTIDS_DA_XML04.formaPergunta), aviso: await texto(TESTIDS_DA_XML04.formaAviso)
  };
}

/** A natureza e o centro do documento (a TOP gera título) na aba Financeiro. */
async function classificarODocumento(page: Page, c: CenarioDaXml04) {
  await irParaAba(page, "financeiro");
  await escolherNoSeletor(page, page.getByTestId("importacao-natureza"), c.ref.natureza.label, "Natureza de despesa da compra");
  await escolherNoSeletor(page, page.getByTestId("importacao-centro"), c.ref.centro.label, "Centro de resultado da compra");
}

interface CorpoDoGerar { financeiro: { forma_pagamento_id: string | null }; itens: { n_item: number; produto_id: string; fator: string; tipo_fator: string; lembrar_vinculo?: boolean }[] }

/** O clique no "Gerar compra" e o 201: o corpo que foi no fio e a compra. */
async function gerarCompra(page: Page, importacaoId: string) {
  const gerar = page.getByTestId("importacao-gerar-compra");
  await expect(gerar, "nada bloqueia o Gerar compra").toBeEnabled();
  const post = page.waitForResponse((r: Response) => r.request().method() === "POST" && caminho(r) === `/api/compras/importacoes/${importacaoId}/gerar-compra`, { timeout: 30_000 });
  await gerar.click();
  const resposta = await post;
  const texto = await resposta.text();
  expect(resposta.status(), `a compra foi gerada (201): ${texto.slice(0, 400)}`).toBe(201);
  return { corpo: resposta.request().postDataJSON() as CorpoDoGerar, compra: JSON.parse(texto) as { id: string; situacao: string; valor_total: string } };
}

/** As linhas da aba Divergências: `[código, bloqueia, texto]`. */
async function divergenciasNaTela(page: Page): Promise<[string, string, string][]> {
  await irParaAba(page, "divergencias");
  return page.getByTestId("importacao-divergencia").evaluateAll((els) => els.map((e) => [e.getAttribute("data-codigo") ?? "", e.getAttribute("data-bloqueia") ?? "", (e as HTMLElement).innerText] as [string, string, string]));
}

/* ═════════════════════════════════════════════ X4-T1 ═════════════════════════════════════════════ */

test("X4-T1 — aba Itens sem fator na tela: quantidade da nota em pt-BR, corpo com fator automático (cadastro/vínculo ou \"1\"); o Gerar grava a compra, a forma da nota e os vínculos lembrados", async ({ page, ligacoes }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDaXml04(page);
  await ligacoes.ligar("15", c.formaCerta.id);
  const id = await importarNotaDaXml04(page, c, c.nota);
  const pedidosDaTop = contarPedidosDaTop(page, id);
  const conf = await abrirConferenciaDaXml04(page, id, c.top);

  // PREMISSA NO FIO: a origem de cada fator, a forma da nota e os avisos do servidor (nenhum bloqueia)
  const papeis = c.itensDoCenario;
  for (const [k, i] of papeis.entries()) {
    const v = vinculoNoFio(conf, k + 1);
    const esperado = i.grupo === "principal" ? { origem: "unidade_principal", unidadeDaNota: i.uCom }
      : i.grupo === "alternativa" ? { origem: "unidade_do_produto", unidadeDaNota: i.uCom }
        : i.grupo === "fora_do_cadastro" ? { origem: "pergunta", unidadeDaNota: i.uCom, motivo: "unidade_fora_do_cadastro" }
          : { origem: "vinculo", unidadeDaNota: i.uCom, cadastro: { fator: D(i.alternativa!.fator).toFixed(6), tipoFator: "multiply" } };
    const fpn = v.fatorPelaNota;
    expect(fpn ? { ...fpn, ...(fpn.cadastro ? { cadastro: { ...fpn.cadastro, fator: D(fpn.cadastro.fator).toFixed(6) } } : {}) } : null, `premissa no fio: o fatorPelaNota do ${i.papel}`).toEqual(esperado);
    const fatorDoServidor = i.grupo === "principal" || i.grupo === "fora_do_cadastro" ? "1" : i.grupo === "alternativa" ? i.alternativa!.fator : i.fatorDoVinculo!;
    expect([v.situacao, v.produto?.id, D(v.fator ?? "0").toFixed(), v.tipoFator], `premissa no fio: o vínculo do ${i.papel} (o "1" da pergunta é só compatibilidade)`)
      .toEqual([i.grupo === "vinculo" ? "lembrado" : "sugerido", c.produtos.get(k + 1)!.id, fatorDoServidor, "multiply"]);
  }
  expect(formaNoFio(conf), "premissa no fio: a forma da nota, ligada").toEqual(["ligada", "15", c.formaCerta.id]);
  const n = { U1: nDo(c, "U1"), U2: nDo(c, "U2"), V: nDo(c, "V") };
  expect(conf.divergencias.filter((d) => /fator/.test(d.codigo)).map((d) => [d.codigo, d.nItem, d.bloqueia]), "premissa no fio: os avisos do fator do servidor (nenhum bloqueia)")
    .toEqual([["fator_a_informar", n.U1, false], ["fator_a_informar", n.U2, false], ["fator_do_vinculo_diferente_do_cadastro", n.V, false]]);

  await irParaAba(page, "itens");
  for (const [k, i] of papeis.entries()) {
    const k1 = k + 1;
    await expectCamposAvancadosAusentes(page, k1);
    await expect(doItem(page, k1, "quantidade-nota"), `${i.papel}: quantidade da nota em pt-BR`).toHaveText(quantidadeNotaBR(i.quantidade));
  }
  await expect(page.getByTestId("importacao-criar-produtos"), "o lote Criar produtos da nota continua na aba").toBeVisible();
  const doFator = (await divergenciasNaTela(page)).filter(([codigo]) => /fator/.test(codigo));
  expect(doFator.filter(([, bloqueia]) => bloqueia === "sim"), "sem bloqueio de fator na tela (avisos do servidor podem aparecer)").toEqual([]);

  // O FINANCEIRO resolvido: a forma da nota (ligada) já escolhida; o vencimento (a condição: as duplicatas não fecham), a natureza e o centro.
  const forma = await formaNaTela(page);
  // O CONTROLE POSITIVO do contador do sentido 1 do skew: a conferência que declara a forma da nota pergunta a TOP escolhida.
  expect(pedidosDaTop.filter((p) => p.endsWith(`/api/compras/compras/regras-da-operacao`)).length, "no fio: a tela perguntou as regras da TOP escolhida").toBeGreaterThan(0);
  expect(forma, "a forma da nota vem escolhida, com a origem").toMatchObject({
    origem: "nota", travada: null, vazia: false, mostra: c.formaCerta.label, habilitada: true,
    origemTexto: "Forma de pagamento da nota (código 15 — Boleto bancário).", pergunta: null, aviso: null
  });
  const vencimento = page.getByTestId("importacao-aba-financeiro").getByLabel("Vencimento", { exact: true });
  await vencimento.fill(dataComoSeDigita("2026-11-16"));
  await vencimento.press("Enter");
  await expect(page.getByTestId("importacao-vencimento")).toHaveValue("2026-11-16");
  await classificarODocumento(page, c);

  const codigoU1 = c.codigoDo("U1"); const codigoU2 = c.codigoDo("U2"); const codigoV = c.codigoDo("V");
  const doV = `${codigoV}|CX|${c.produtos.get(n.V)!.id}|multiply|6`;
  expect(vinculosDoFornecedor(c.fornecedor), "(j) antes do Gerar: só o vínculo prévio do V").toEqual([doV]);

  const { corpo, compra } = await gerarCompra(page, id);
  expect(compra.situacao, "(j) a compra nasceu aberta").toBe("aberto");
  expect(D(compra.valor_total).toFixed(2), "(j) com o total da nota").toBe(c.nota.vNF);
  const fatoresCertos = papeis.map((i, k) => fatorNoCorpoDoItem(i, vinculoNoFio(conf, k + 1)));
  expect(corpo.itens.map((i) => [i.n_item, D(i.fator).toFixed(), i.tipo_fator, i.lembrar_vinculo ?? null]), "(j) o corpo: fator automático e lembrar_vinculo true em todos")
    .toEqual(papeis.map((i, k) => [k + 1, D(fatoresCertos[k]).toFixed(), "multiply", true]));
  expect(corpo.financeiro.forma_pagamento_id, "(j) o corpo: a forma da nota").toBe(c.formaCerta.id);
  const gravada = compraNoBanco(compra.id);
  expect(gravada, "(j) NO BANCO: a forma da nota no documento e o fator de cada item").toEqual({
    forma: c.formaCerta.id, itens: papeis.map((_, k) => `${k + 1}|${c.produtos.get(k + 1)!.id}|multiply|${fatoresCertos[k]}`)
  });
  expect(vinculosDoFornecedor(c.fornecedor), "(j) NO BANCO: U1 e U2 nasceram no Gerar com fator 1; o V continua")
    .toEqual([`${codigoU1}|BD|${c.produtos.get(n.U1)!.id}|multiply|1`, `${codigoU2}|FD|${c.produtos.get(n.U2)!.id}|multiply|1`, doV].sort());
});

/* ═════════════════════════════════════════════ X4-T2 ═════════════════════════════════════════════ */

test("X4-T2 — a FORMA PELA NOTA: o tPag ligado vem escolhido com a origem; sem ligação, dois detPag ou sem detPag, a pergunta com o porquê; a escolha do operador vence a da nota e vai gravada", async ({ page, ligacoes }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDaXml04(page, { papeis: ["P1"] });
  const credito = await formaDoSeed(page, "Cartão de Crédito");
  const pix = await formaDoSeed(page, "Pix");
  await ligacoes.ligar("03", credito.id);
  for (const codigo of ["04", "17"]) expect(ligacoesVivasDoCodigo(codigo), `premissa: o código ${codigo} não tem ligação viva`).toEqual([]);
  const fechadas = { descontoDaFatura: "0.00", duplicatas: duplicatasQueSomam(c.nota.vNF) };

  // SEM LIGAÇÃO: a pergunta com o código, o rótulo do leiaute e o caminho do cadastro
  const semLigacao = await importarNotaDaXml04(page, c, notaDoCenario(c, { pagamentos: ["04"], ...fechadas }));
  expect(formaNoFio(await abrirConferenciaDaXml04(page, semLigacao, c.top)), "premissa no fio: o tPag 04 sem ligação").toEqual(["sem_ligacao", "04", null]);
  expect(await formaNaTela(page), "(e) sem ligação: o campo vazio e a pergunta").toMatchObject({
    origem: "pergunta", vazia: true, origemTexto: null, aviso: null,
    pergunta: "O código 04 (Cartão de débito) da nota não está ligado a uma forma de pagamento da organização: ligue em Configurações › Financeiro › Formas de Pagamento da NF-e, ou escolha a forma."
  });

  // DOIS <detPag> (um deles LIGADO): nenhuma forma — nunca "o primeiro"
  const duas = await importarNotaDaXml04(page, c, notaDoCenario(c, { pagamentos: ["03", "17"], ...fechadas }));
  expect(formaNoFio(await abrirConferenciaDaXml04(page, duas, c.top)), "premissa no fio: duas formas").toEqual(["varias", 2, null]);
  expect(await formaNaTela(page), "(e) dois detPag: o campo vazio e a pergunta de mais de uma forma").toMatchObject({
    origem: "pergunta", vazia: true, origemTexto: null, aviso: null, pergunta: "A nota traz 2 formas de pagamento (detPag): escolha a forma."
  });

  // SEM <detPag>: a nota não diz a forma
  const nenhuma = await importarNotaDaXml04(page, c, notaDoCenario(c, { pagamentos: [], ...fechadas }));
  expect(formaNoFio(await abrirConferenciaDaXml04(page, nenhuma, c.top)), "premissa no fio: sem tPag").toEqual(["sem_tpag", null, null]);
  expect(await formaNaTela(page), "(e) sem detPag: o campo vazio e a pergunta").toMatchObject({
    origem: "pergunta", vazia: true, origemTexto: null, aviso: null, pergunta: "A nota não diz a forma de pagamento: escolha a forma."
  });

  // LIGADA: a forma da nota vem escolhida, com a origem
  const ligada = await importarNotaDaXml04(page, c, notaDoCenario(c, { pagamentos: ["03"], ...fechadas }));
  const conf = await abrirConferenciaDaXml04(page, ligada, c.top);
  expect(formaNoFio(conf), "premissa no fio: o tPag 03 ligado").toEqual(["ligada", "03", credito.id]);
  expect(conf.financeiro.parcelas.situacao, "premissa: as duplicatas fecham (as parcelas da nota servem)").toBe("conferem");
  expect(await formaNaTela(page), "(e) ligada: a forma da nota escolhida, com a origem").toMatchObject({
    origem: "nota", travada: null, vazia: false, mostra: credito.label, habilitada: true,
    origemTexto: "Forma de pagamento da nota (código 03 — Cartão de crédito).", pergunta: null, aviso: null
  });

  // (f) O OPERADOR troca a forma: a escolha dele vence a da nota (e nenhum recálculo a apaga)
  await escolherNoSeletor(page, campoDaForma(page), pix.label, "Forma de pagamento");
  expect(await formaNaTela(page), "(f) a escolha do operador vence: sem a origem da nota").toMatchObject({ origem: "operador", vazia: false, mostra: pix.label, origemTexto: null, pergunta: null, aviso: null });
  await irParaAba(page, "itens");
  await classificarODocumento(page, c);
  expect(await formaNaTela(page), "(f) depois de outras abas e campos, a escolha continua").toMatchObject({ origem: "operador", mostra: pix.label });
  const { corpo, compra } = await gerarCompra(page, ligada);
  expect(corpo.financeiro.forma_pagamento_id, "(f) o corpo: a forma do operador").toBe(pix.id);
  expect(compraNoBanco(compra.id).forma, "(f) NO BANCO: a forma do operador").toBe(pix.id);
});

/* ═════════════════════════════════════════════ X4-T3 ═════════════════════════════════════════════ */

/** A execução CONFIGURADA que cobra a forma de pagamento; `documentoTroca` diz se o documento pode trocar os padrões. */
function cobraAForma(documentoTroca: boolean): ConfiguracaoTipoOperacaoV5 {
  const c = configuracaoNeutraTopV5();
  return {
    ...c,
    execucao: { estoque: "configurada", financeiro: "configurada" },
    estoque: { ...c.estoque, atualizacao: "entrada", exigeArmazem: false },
    financeiro: { ...c.financeiro, atualizacao: "pagar", exigeFormaPagamento: true, exigeVencimento: false },
    financeiroPadrao: { ...c.financeiroPadrao, documentoTroca }
  };
}

/** A TOP do caso no formato 5, cobrando a forma, com a forma `forma` de padrão financeiro (o resto sem padrão). */
async function topQueCobra(page: Page, rotulo: string, documentoTroca: boolean, forma: Opcao) {
  const top = await criarTop(page, {
    codigo: codigoTop("x4g"), codigoBase: "compras.compra", nome: uniq(`XML04 ${rotulo}`), configuracao: cobraAForma(documentoTroca),
    padroesFinanceiros: { naturezaId: null, centroCustoId: null, tipoTituloId: null, formaPagamentoId: forma.id, contaBancariaId: null }
  });
  const regras = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/regras-da-operacao?tipo_operacao_id=${top.id}`);
  const padroes = regras["padroes"] as { formaPagamento?: { id?: string } | null } | null;
  const secao = regras["secao"] as { documentoTroca?: boolean } | null;
  expect([regras["geraTitulos"], regras["exigeFormaPagamento"], secao?.documentoTroca, padroes?.formaPagamento?.id ?? null],
    `premissa no fio: a TOP ${rotulo} gera título, cobra a forma, ${documentoTroca ? "deixa" : "NÃO deixa"} trocar e tem a forma de padrão`)
    .toEqual([true, true, documentoTroca, forma.id]);
  return top.id;
}

test("X4-T3 — a FORMA E A TOP (a regra da 311): a TOP que cobra e deixa trocar — a nota vence o padrão, e sem a forma da nota vale o padrão; a TOP que cobra e NÃO deixa trocar — vale a dela, o campo travado e o aviso com as duas, e é a dela que vai gravada", async ({ page, ligacoes }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDaXml04(page, { papeis: ["P1"] });
  const pix = await formaDoSeed(page, "Pix");
  await ligacoes.ligar("15", c.formaCerta.id);
  expect(ligacoesVivasDoCodigo("04"), "premissa: o código 04 não tem ligação viva").toEqual([]);
  const livre = await topQueCobra(page, "cobra e deixa trocar", true, pix);
  const trava = await topQueCobra(page, "cobra e trava", false, pix);
  const fechadas = { descontoDaFatura: "0.00", duplicatas: duplicatasQueSomam(c.nota.vNF) };

  // DEGRAU 3: sem a forma da nota (o tPag sem ligação), a TOP que cobra semeia o padrão dela, com a origem
  const semLigacao = await importarNotaDaXml04(page, c, notaDoCenario(c, { pagamentos: ["04"], ...fechadas }));
  expect(formaNoFio(await abrirConferenciaDaXml04(page, semLigacao, livre)), "premissa no fio: sem ligação").toEqual(["sem_ligacao", "04", null]);
  expect(await formaNaTela(page), "degrau 3: o padrão da TOP que cobra a forma, com a origem").toMatchObject({
    origem: "top", travada: null, vazia: false, mostra: pix.label, habilitada: true, origemTexto: "Forma de pagamento padrão da TOP desta compra.", pergunta: null, aviso: null
  });

  // DEGRAU 2 > 3: a forma da NOTA vence o padrão da TOP que deixa trocar (a nota vale para AQUELE documento)
  const ligada = await importarNotaDaXml04(page, c, notaDoCenario(c, { pagamentos: ["15"], ...fechadas }));
  expect(formaNoFio(await abrirConferenciaDaXml04(page, ligada, livre)), "premissa no fio: o tPag 15 ligado").toEqual(["ligada", "15", c.formaCerta.id]);
  expect(await formaNaTela(page), "a nota vence o padrão da TOP que deixa trocar").toMatchObject({
    origem: "nota", travada: null, mostra: c.formaCerta.label, habilitada: true, origemTexto: "Forma de pagamento da nota (código 15 — Boleto bancário).", aviso: null
  });

  // (g) A TOP QUE NÃO DEIXA TROCAR, com a forma da nota diferente: vale a da TOP, o campo travado e o aviso com as duas
  await irParaAba(page, "cabecalho");
  await page.getByTestId("importacao-top").selectOption(trava);
  await expect(page.getByTestId("importacao-top")).toHaveValue(trava);
  await irParaAba(page, "financeiro");
  await expect(campoDaForma(page), "(g) a forma trava pela TOP (as regras da TOP nova chegaram)").toHaveAttribute(TESTIDS_DA_XML04.formaAtributoTrava, "true");
  expect(await formaNaTela(page), "(g) vale a da TOP, travada, e o aviso diz as duas").toMatchObject({
    origem: "top", travada: "true", vazia: false, mostra: pix.label, habilitada: false, origemTexto: null, pergunta: null,
    aviso: "A nota diz Boleto (código 15 — Boleto bancário), mas a TOP desta compra não deixa trocar a forma de pagamento: vale a dela, Pix."
  });
  await classificarODocumento(page, c);
  const { corpo, compra } = await gerarCompra(page, ligada);
  expect(corpo.financeiro.forma_pagamento_id, "(g) o corpo: a forma da TOP").toBe(pix.id);
  expect(compraNoBanco(compra.id).forma, "(g) NO BANCO: a forma da TOP").toBe(pix.id);
});

/* ═════════════════════════════════════════════ X4-T4 ═════════════════════════════════════════════ */

test("X4-T4 — a DUPLICATA QUE NÃO FECHA diz por quê: os três números e cada comparação que falhou, com a diferença; sem duplicatas (e por falta de vencimento) diz o motivo; as que fecham continuam a tabela", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDaXml04(page, { papeis: ["P1"] });
  const vNF = c.nota.vNF;
  expect(vNF, "premissa: o recorte P1 vale R$ 250,00").toBe("250.00");

  /** Importa a nota, abre a conferência com a TOP do caso e lê a explicação da aba Financeiro e a divergência do servidor. */
  const explicacao = async (rotulo: string, o: { descontoDaFatura: string; duplicatas: ReturnType<typeof duplicatasQueSomam> }) => {
    const id = await importarNotaDaXml04(page, c, notaDoCenario(c, { pagamentos: [], ...o }));
    const conf = await abrirConferenciaDaXml04(page, id, c.top);
    await irParaAba(page, "financeiro");
    const aba = page.getByTestId("importacao-aba-financeiro");
    const textos = async (testid: string) => aba.getByTestId(testid).evaluateAll((els) => els.map((e) => [e.getAttribute("data-falha"), (e as HTMLElement).innerText] as [string | null, string]));
    const usar = page.getByTestId("importacao-usar-condicao");
    const lido = {
      resumo: (await textos("importacao-parcelas-indisponiveis")).map(([, t]) => textoNormalizado(t)),
      numeros: (await textos(TESTIDS_DA_XML04.parcelasNumeros)).map(([, t]) => textoNormalizado(t)),
      falhas: (await textos(TESTIDS_DA_XML04.parcelasFalha)).map(([f, t]) => [f, textoNormalizado(t)]),
      tabela: await aba.getByTestId("importacao-parcela").count(),
      usarCondicao: { marcado: await usar.isChecked(), habilitado: await usar.isEnabled() }
    };
    const servidor = conf.divergencias.filter((d) => d.codigo === "parcelas_nao_conferem").map((d) => d.mensagem);
    console.log(`[X4-T4] ${rotulo}: ${JSON.stringify({ parcelas: conf.financeiro.parcelas.situacao, ...lido, servidor })}`);
    return { conf, ...lido, servidor };
  };
  const condicaoForcada = { marcado: true, habilitado: false };

  // AS DUAS FALHAM: Σ 200 × líquido 240 (vLiq) × total 250
  const duas = await explicacao("as duas", { descontoDaFatura: "10.00", duplicatas: duplicatasQueSomam("200.00") });
  expect(duas.conf.financeiro.parcelas, "premissa no fio: não conferem, as duas comparações").toMatchObject({ situacao: "nao_conferem", soma: "200.00", liquido: "240.00", falhas: ["soma_diferente_do_liquido", "liquido_diferente_do_total"] });
  expect({ resumo: duas.resumo, numeros: duas.numeros, falhas: duas.falhas, tabela: duas.tabela, usarCondicao: duas.usarCondicao }, "(h) as duas: os três números e as duas comparações, com a diferença").toEqual({
    resumo: ["As duplicatas da nota não conferem: a compra usa a condição de pagamento."],
    numeros: ["Soma das duplicatas: R$ 200,00 · Líquido da fatura (vLiq): R$ 240,00 · Total da compra: R$ 250,00."],
    falhas: [["soma_diferente_do_liquido", "A soma das duplicatas fica R$ 40,00 abaixo do líquido."], ["liquido_diferente_do_total", "O líquido fica R$ 10,00 abaixo do total da compra."]],
    tabela: 0, usarCondicao: condicaoForcada
  });
  expect(duas.servidor, "(h) e o aviso do servidor também diz os três números e as diferenças").toEqual([
    "As duplicatas não conferem: Σ vDup 200.00 × líquido (fatura, vLiq) 240.00 — diferença -40.00; líquido 240.00 × total da compra 250.00 — diferença -10.00. Use a condição de pagamento."]);
  const naLista = (await divergenciasNaTela(page)).filter(([codigo]) => codigo === "parcelas_nao_conferem");
  expect(naLista.map(([, bloqueia, texto]) => [bloqueia, textoNormalizado(texto).replace(/\s*Ir para .*$/, "")]), "(h) na aba Divergências, o aviso do servidor (não bloqueia)")
    .toEqual([["nao", `Aviso: ${duas.servidor[0]}`]]);

  // SÓ A SOMA: Σ 230 × líquido 250 (vLiq = vNF) — a do líquido NÃO aparece
  const soma = await explicacao("só a soma", { descontoDaFatura: "0.00", duplicatas: duplicatasQueSomam("230.00") });
  expect({ numeros: soma.numeros, falhas: soma.falhas, usarCondicao: soma.usarCondicao }, "(h) só a soma: a comparação que falhou e só ela").toEqual({
    numeros: ["Soma das duplicatas: R$ 230,00 · Líquido da fatura (vLiq): R$ 250,00 · Total da compra: R$ 250,00."],
    falhas: [["soma_diferente_do_liquido", "A soma das duplicatas fica R$ 20,00 abaixo do líquido."]], usarCondicao: condicaoForcada
  });

  // SÓ O LÍQUIDO: Σ 240 = líquido 240 × total 250
  const liquido = await explicacao("só o líquido", { descontoDaFatura: "10.00", duplicatas: duplicatasQueSomam("240.00") });
  expect({ numeros: liquido.numeros, falhas: liquido.falhas, usarCondicao: liquido.usarCondicao }, "(h) só o líquido: a comparação que falhou e só ela").toEqual({
    numeros: ["Soma das duplicatas: R$ 240,00 · Líquido da fatura (vLiq): R$ 240,00 · Total da compra: R$ 250,00."],
    falhas: [["liquido_diferente_do_total", "O líquido fica R$ 10,00 abaixo do total da compra."]], usarCondicao: condicaoForcada
  });

  // SEM DUPLICATAS POR FALTA DE VENCIMENTO: uma <dup> sem <dVenc> — o leitor descarta todas, e a tela diz o motivo
  const semVencimento = await explicacao("sem vencimento", { descontoDaFatura: "0.00", duplicatas: [{ numero: "001", vencimento: null, valor: "125.00" }, { numero: "002", vencimento: "2026-12-16", valor: "125.00" }] });
  expect(semVencimento.conf.financeiro.parcelas, "premissa no fio: sem duplicatas, pela falta de vencimento").toEqual({ situacao: "sem_duplicatas", motivo: "duplicata_sem_vencimento", origem: "nota" });
  expect({ resumo: semVencimento.resumo, numeros: semVencimento.numeros, falhas: semVencimento.falhas, usarCondicao: semVencimento.usarCondicao }, "(h) sem vencimento: o motivo").toEqual({
    resumo: ["A nota trouxe duplicatas sem vencimento: a compra usa a condição de pagamento."], numeros: [], falhas: [], usarCondicao: condicaoForcada
  });

  // SEM DUPLICATAS: a nota não as traz
  const sem = await explicacao("sem duplicatas", { descontoDaFatura: "0.00", duplicatas: [] });
  expect(sem.conf.financeiro.parcelas, "premissa no fio: sem duplicatas").toEqual({ situacao: "sem_duplicatas", motivo: "nota_sem_duplicatas", origem: "nota" });
  expect({ resumo: sem.resumo, numeros: sem.numeros, falhas: sem.falhas }, "(h) sem duplicatas: o motivo").toEqual({
    resumo: ["A nota não traz duplicatas: a compra usa a condição de pagamento."], numeros: [], falhas: []
  });

  // AS QUE FECHAM (a regra não mudou): a tabela das duplicatas, nenhuma explicação, e "usar a condição" livre
  const fecham = await explicacao("fecham", { descontoDaFatura: "0.00", duplicatas: duplicatasQueSomam(vNF) });
  expect(fecham.conf.financeiro.parcelas.situacao, "premissa no fio: conferem").toBe("conferem");
  expect({ resumo: fecham.resumo, numeros: fecham.numeros, falhas: fecham.falhas, tabela: fecham.tabela, usarCondicao: fecham.usarCondicao }, "as que fecham: a tabela, sem explicação").toEqual({
    resumo: [], numeros: [], falhas: [], tabela: 2, usarCondicao: { marcado: false, habilitado: true }
  });
});

/* ═════════════════════════════════════════════ X4-T5 ═════════════════════════════════════════════ */

/**
 * O ponteiro que termina um clique SOBRE a barra de módulos (o item do mega-menu; a opção de uma lista que abriu para
 * cima) abre, por hover, o mega-menu do módulo de baixo dele — e o painel cobre o formulário. Tira o ponteiro de lá e
 * fecha o que estiver aberto (o mesmo gesto de `navegacao.spec.ts`), conferindo que fechou.
 */
async function semMegaMenu(page: Page) {
  await page.mouse.move(0, 400);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mega-menu"), "nenhum mega-menu aberto sobre o formulário").toBeHidden();
}

test("X4-T5 — o cadastro \"Formas de Pagamento da NF-e\" abre pelo menu Configurações › Financeiro, na subaba certa, e cria a ligação de um código a uma forma do sistema", async ({ page, ligacoes }) => {
  test.setTimeout(120_000);
  await login(page);
  const dinheiro = await formaDoSeed(page, "Dinheiro");
  expect(ligacoesVivasDoCodigo("10"), "premissa: o código 10 não tem ligação viva").toEqual([]);

  // O MENU: Configurações (na barra ou em "Mais") → o item do grupo Financeiro
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  let modulo = nav.getByTestId("nav-module").filter({ hasText: "Configurações" }).first();
  if (!(await modulo.isVisible())) { await nav.getByTestId("nav-more").click(); modulo = nav.getByTestId("nav-module").filter({ hasText: "Configurações" }).first(); await modulo.click(); } else await modulo.hover();
  const item = page.getByTestId("mega-menu").getByTestId("mega-item").filter({ has: page.getByText("Formas de Pagamento da NF-e", { exact: true }) });
  await expect(item, "o item está no menu de Configurações").toHaveCount(1);
  await expect(item).toHaveAttribute("href", "/configuracoes?tab=financeiro&sub=formas-pagamento-da-nfe");
  await item.click();
  await expect(page, "a rota canônica da subaba").toHaveURL(/\/configuracoes\?tab=financeiro&sub=formas-pagamento-da-nfe$/);
  await semMegaMenu(page);
  const subaba = page.locator("main").getByRole("tab", { name: "Formas de Pagamento da NF-e", exact: true });
  await expect(subaba, "a subaba CERTA está aberta (não a primeira do Financeiro)").toHaveAttribute("aria-selected", "true");
  const crumbs = page.getByRole("navigation", { name: "Navegação" });
  await expect(crumbs).toContainText("Financeiro");
  await expect(crumbs).toContainText("Formas de Pagamento da NF-e");

  // O NOVO: o código (a lista do leiaute) e a forma do SISTEMA
  await page.locator("main").getByRole("button", { name: /^Novo/ }).first().click();
  const codigo = page.getByLabel(/^Código da NF-e \(tPag\)( \*)?$/);
  await codigo.click();
  await page.locator("[data-radix-popper-content-wrapper], .cmd-panel").last().getByRole("option", { name: "10 — Vale alimentação", exact: true }).click();
  await expect(codigo).toContainText("10 — Vale alimentação");
  await semMegaMenu(page);
  // A forma é um seletor de referência (sem nome acessível próprio): achado pelo rótulo do campo do formulário.
  await escolherNoSeletor(page, campoDoFormulario(page.locator("main"), "Forma de pagamento"), dinheiro.label, "Forma de pagamento da ligação");
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/resources/formas_pagamento_da_nfe");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  const r = await resposta;
  const texto = await r.text();
  expect(r.status(), `a ligação foi gravada: ${texto.slice(0, 300)}`).toBe(201);
  const { id } = JSON.parse(texto) as { id: string };
  ligacoes.registrar(id, "10");
  expect(r.request().postDataJSON(), "o corpo da tela: o código e a forma").toMatchObject({ codigo_tpag: "10", forma_pagamento_id: dinheiro.id });
  const [cod, org, formaId, orgDaForma, excluida] = ligacaoNoBanco(id).split("|");
  expect({ cod, formaId, orgDaForma, excluida }, "NO BANCO: o código 10 ligado à forma do SISTEMA, viva").toEqual({ cod: "10", formaId: dinheiro.id, orgDaForma: "sistema", excluida: "nao" });
  expect(org, "NO BANCO: a ligação é da organização (o tenant)").toMatch(/^[0-9a-f-]{36}$/);
});
