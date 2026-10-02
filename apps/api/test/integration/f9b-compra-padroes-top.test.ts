import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { familiaOperacionalDeDocumentoCompra } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, criarTop, detalheTop, produto, itemCompra, corpoCompra, lancarCompra, compraLancada, previaCompra,
  confirmarCompra, auditoriaDe, movimentosDe, versaoAtualNoBanco, type Produto, type Resposta
} from "./top-config-08-ajuda.js";
import {
  COMPRA, PEDIDO_DE_COMPRA, cfg5Fin, topCompraNo5, topPedidoNo5, cadastroDespesa, centro, contaNova, ativarConta, umTipoDeTitulo,
  pedidoCompra, receber, situacaoDe, titulosDe, rateio, contar, type TopNo5
} from "./f9b-ajuda.js";

/**
 * OPERACOES-01 F9b (decisão 286) — A TOP NAS FAMÍLIAS DE COMPRAS E OS PADRÕES FINANCEIROS NA COMPRA (plano F9b §4.3;
 * TP-C1, CC-1..CC-5).
 *
 *   · TP-C1 a API da TOP aceita a seção e os padrões no pedido de compra e na compra (naturezas de despesa), e recusa a
 *           natureza de receita, a provisão na compra e "exigir" no pedido de compra;
 *   · CC-1  a compra SEM natureza e centro numa TOP no 5 com o par → salva, a prévia diz `padraoDaTop`, a confirmação
 *           classifica pelo par da TOP e leva o tipo de título, a conta prevista, a TOP e a versão para o título (também
 *           pelo RECEBER);
 *   · CC-2  com natureza e centro próprios (a TOP deixa trocar) → o rateio é o do documento; o tipo e a conta, da TOP;
 *   · CC-3  a TOP que não deixa trocar → 422 no SALVAR (a compra não se edita), também no receber;
 *   · CC-4  a conta padrão inativada depois de salvar → a prévia e a confirmação recusam, nada gerado;
 *   · CC-5  neutro = hoje (formato 4): a prévia, a auditoria e o título como hoje, mais a TOP e a versão no título.
 *
 * O QUE CONTA COMO PROVA: a TOP gravada (a linha dos padrões da versão), a compra, os títulos, o rateio, os movimentos e
 * a trilha LIDOS NO BANCO pela testemunha (`c.admin`); toda recusa "sem efeito" vem com a premissa ao lado. As mensagens
 * esperadas estão escritas AQUI, à mão.
 */
beforeAll(async () => {
  await iniciar();
  tipoTitulo = await umTipoDeTitulo();
  forma = (await c.admin.query<{ id: string }>("select id::text as id from erp.payment_methods where organization_id is null and is_active order by name, id limit 1")).rows[0]!.id;
  natureza = await cadastroDespesa("Despesa padrão da TOP CC");
  centroC = await centro("Centro padrão da TOP CC");
  prod = await produto();
  topPadrao = await topCompraNo5({ padroes: { naturezaId: natureza, centroCustoId: centroC, tipoTituloId: tipoTitulo, contaBancariaId: c.I.bankAccount } });
}, 240_000);
afterAll(encerrar);

const MSG = {
  naturezaPadrao: "Natureza padrão inválida para esta operação: escolha uma natureza analítica, ativa e do tipo da operação.",
  provisaoForaDaFamilia: "A provisão vale só no pedido de venda e no pedido de compra.",
  exigirForaDaFamilia: "O lançamento desta operação sempre informa natureza e centro: deixe \"Usar a 1ª natureza e o 1º centro por código (como hoje)\".",
  foraDaFamilia: "Esta operação não usa padrões financeiros.",
  envelope: "A configuração operacional enviada é inválida",
  naturezaObrigatoriaNoSalvar: "Informe a natureza financeira e o centro de resultado: esta compra gera contas a pagar",
  troca: "Esta operação não deixa trocar a natureza e o centro de resultado: use o padrão da TOP.",
  contaInutilizavel: "A conta padrão da operação está inativa ou foi excluída: ajuste os padrões da TOP.",
} as const;

/** O orçamento de compra, perguntado ao registry: uma família de compras SEM perfil de padrões financeiros. */
const ORCAMENTO_DE_COMPRA = familiaOperacionalDeDocumentoCompra("orcamento")!;

let tipoTitulo = ""; let forma = ""; let natureza = ""; let centroC = "";
let prod: Produto; let topPadrao: TopNo5;

/** O corpo de uma compra de 10 (1 × 10) na TOP dada; sem `com`, SEM natureza e centro. */
const corpo = (topId: string, com?: { natureza: string; centro: string }) =>
  corpoCompra([itemCompra(prod.id, "1", "10.00")], { tipo_operacao_id: topId, categoria_financeira_id: com?.natureza ?? null, centro_custo_id: com?.centro ?? null });
type Previa = { podeConfirmar: boolean; recusas: unknown[]; financeiro: { classificacao: Record<string, unknown> | null } };
async function previa(id: string): Promise<Previa> {
  const r = await previaCompra(id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as Previa;
}
async function confirmada(id: string): Promise<void> {
  const r = await confirmarCompra(id);
  expect(r.statusCode, `premissa: a compra é confirmada — ${r.body}`).toBe(200);
}
const recusa = (caminho: string, mensagem: string, motivo = "combinacao_nao_suportada") => ({ caminho, motivo, mensagem });
function recusada(r: Resposta, recusas: unknown[]) {
  expect(r.statusCode, r.body).toBe(422);
  expect(erro(r)).toEqual({ code: "TIPO_OPERACAO_CONFIGURACAO_INVALIDA", message: MSG.envelope, details: { recusas } });
}
const contarTops = async () => Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1", [c.h.demo.orgId])).rows[0]!.n);
const cadastroDe = async (tabela: "financial_categories" | "cost_centers", id: string) =>
  (await c.admin.query<{ codigo: string; nome: string }>(`select code as codigo, name as nome from erp.${tabela} where id=$1`, [id])).rows[0]!;
/** A metadata da auditoria "confirm" da compra (uma só). */
async function auditoriaDaConfirmacao(id: string): Promise<Record<string, unknown>> {
  const a = await auditoriaDe("documentos_compra", id, "confirm");
  expect(a.length, "premissa: uma auditoria de confirmação").toBe(1);
  return a[0]!.metadata ?? {};
}

// ---------------------------------------------------------------------------------------------------------------
describe("TP-C1 — a API da TOP nas famílias de compras", () => {
  it("pedido de compra no 5 com a provisão e os padrões de despesa → 201 e o detalhe os devolve; receita, provisão na compra e \"exigir\" no pedido → 422, nada nasce; no orçamento de compra, a família sem perfil", async () => {
    const padroes = { naturezaId: natureza, centroCustoId: centroC, tipoTituloId: tipoTitulo, formaPagamentoId: forma, contaBancariaId: c.I.bankAccount };
    const r = await criarTop(PEDIDO_DE_COMPRA, { configuracao: cfg5Fin({ provisao: true }), padroesFinanceiros: padroes });
    expect(r.statusCode, r.body).toBe(201);
    const id = j(r).id as string;
    const v = await versaoAtualNoBanco(id);
    expect([v.configuracao_schema_version, v.configuracao.financeiroPadrao], "o formato 5 com a seção: só regras no JSON")
      .toEqual([5, { provisao: true, documentoTroca: true, semClassificacao: "padrao_legado" }]);
    const d = await detalheTop(id);
    expect(d.statusCode, d.body).toBe(200);
    const nat = await cadastroDe("financial_categories", natureza);
    const cen = await cadastroDe("cost_centers", centroC);
    expect(j(d).padroesFinanceiros).toMatchObject({
      natureza: { id: natureza, codigo: nat.codigo, nome: nat.nome }, centro: { id: centroC, codigo: cen.codigo, nome: cen.nome },
      tipoTitulo: { id: tipoTitulo }, formaPagamento: { id: forma }, conta: { id: c.I.bankAccount },
    });

    const antes = await contarTops();
    recusada(await criarTop(PEDIDO_DE_COMPRA, { configuracao: cfg5Fin({ provisao: true }), padroesFinanceiros: { ...padroes, naturezaId: c.I.incomeCategory } }),
      [recusa("padroesFinanceiros.naturezaId", MSG.naturezaPadrao, "valor_invalido")]);
    recusada(await criarTop(COMPRA, { configuracao: cfg5Fin({ provisao: true }) }), [recusa("financeiroPadrao.provisao", MSG.provisaoForaDaFamilia)]);
    recusada(await criarTop(PEDIDO_DE_COMPRA, { configuracao: cfg5Fin({ semClassificacao: "exigir" }) }), [recusa("financeiroPadrao.semClassificacao", MSG.exigirForaDaFamilia)]);
    // PREMISSA: os mesmos padrões numa família SEM perfil (o orçamento de compra) — a recusa é do perfil, não do corpo.
    recusada(await criarTop(ORCAMENTO_DE_COMPRA, { configuracao: cfg5Fin(), padroesFinanceiros: padroes }), [recusa("padroesFinanceiros", MSG.foraDaFamilia)]);
    expect(await contarTops(), "nada nasce").toBe(antes);
    // PREMISSA: a compra no 5 com os padrões de despesa (sem a provisão) nasce.
    expect((await criarTop(COMPRA, { configuracao: cfg5Fin(), padroesFinanceiros: padroes })).statusCode).toBe(201);
  });
});

describe("CC-1 — a compra sem natureza e centro usa o par da TOP", () => {
  it("salva; a prévia com o par da TOP e padraoDaTop; confirmar → rateio, tipo de título, conta prevista, TOP e versão; auditoria com origem \"padrão da TOP\"; no formato 4, a recusa de hoje", async () => {
    // PREMISSA: a MESMA compra numa TOP no formato 4 é recusada como hoje, e nada nasce.
    const docsAntes = await contar("documentos_compra");
    const r4 = await lancarCompra("compra", corpo(c.tops.compra));
    expect(r4.statusCode, r4.body).toBe(422);
    expect(erro(r4)).toEqual({ code: "VALIDATION_ERROR", message: MSG.naturezaObrigatoriaNoSalvar, details: [{ path: "categoria_financeira_id", message: MSG.naturezaObrigatoriaNoSalvar }] });
    expect(await contar("documentos_compra")).toBe(docsAntes);

    const compra = await compraLancada("compra", corpo(topPadrao.id));
    const doc = (await c.admin.query<{ categoria_financeira_id: string | null; centro_custo_id: string | null }>(
      "select categoria_financeira_id::text, centro_custo_id::text from erp.documentos_compra where id=$1", [compra.id])).rows[0];
    expect(doc, "premissa: a compra foi salva sem natureza e centro").toEqual({ categoria_financeira_id: null, centro_custo_id: null });

    const p = await previa(compra.id);
    const nat = await cadastroDe("financial_categories", natureza);
    const cen = await cadastroDe("cost_centers", centroC);
    expect([p.podeConfirmar, p.recusas]).toEqual([true, []]);
    expect(p.financeiro.classificacao).toEqual({ categoria: { id: natureza, ...nat }, centro: { id: centroC, ...cen }, padraoDaTop: true });

    await confirmada(compra.id);
    const titulos = await titulosDe(compra.id);
    expect(titulos.length).toBe(1);
    expect(titulos[0]).toMatchObject({ status: "open", direction: "payable", amount: "10.00", title_type_id: tipoTitulo, conta_prevista_id: c.I.bankAccount,
      tipo_operacao_id: topPadrao.id, tipo_operacao_versao_id: topPadrao.versaoId });
    expect(await rateio(titulos[0]!.id)).toEqual([{ natureza, centro: centroC, percentage: "100.00", amount: "10.00" }]);
    expect((await auditoriaDaConfirmacao(compra.id)).classificacaoFinanceira).toEqual({ categoriaFinanceiraId: natureza, centroCustoId: centroC, origem: "padrão da TOP" });
  });

  it("o RECEBER sem natureza e centro para essa TOP de compra → salva e confirma com o par da TOP", async () => {
    const topPedido = await topPedidoNo5(topPadrao.id);
    const p = await pedidoCompra(topPedido.id, prod.id);
    const r = await receber(p, topPadrao.id, "4", "100.00", { categoria_financeira_id: null, centro_custo_id: null });
    expect(r.statusCode, r.body).toBe(201);
    const compraId = j(r).id as string;
    const doc = (await c.admin.query<{ categoria_financeira_id: string | null; origem: string }>(
      "select categoria_financeira_id::text, origem_documento_id::text as origem from erp.documentos_compra where id=$1", [compraId])).rows[0];
    expect(doc, "premissa: a compra gerada do pedido, sem natureza").toEqual({ categoria_financeira_id: null, origem: p.id });
    await confirmada(compraId);
    const titulos = await titulosDe(compraId);
    expect(titulos.map((t) => [t.amount, t.tipo_operacao_id, t.title_type_id, t.conta_prevista_id])).toEqual([["400.00", topPadrao.id, tipoTitulo, c.I.bankAccount]]);
    expect(await rateio(titulos[0]!.id)).toEqual([{ natureza, centro: centroC, percentage: "100.00", amount: "400.00" }]);
    expect(await titulosDe(p.id), "o pedido sem provisão não ganha previsto").toEqual([]);
  });
});

describe("CC-2 — a compra com natureza e centro próprios numa TOP com padrões que deixa trocar", () => {
  it("o rateio é o do documento, sem padraoDaTop na prévia e sem origem na auditoria; o tipo de título e a conta prevista vêm da TOP", async () => {
    expect([c.I.category, c.I.costCenter], "premissa: a natureza e o centro do documento não são os da TOP").not.toEqual([natureza, centroC]);
    const compra = await compraLancada("compra", corpo(topPadrao.id, { natureza: c.I.category, centro: c.I.costCenter }));
    const p = await previa(compra.id);
    expect(p.podeConfirmar).toBe(true);
    expect(Object.keys(p.financeiro.classificacao ?? {})).toEqual(["categoria", "centro"]);
    expect(p.financeiro.classificacao).toMatchObject({ categoria: { id: c.I.category }, centro: { id: c.I.costCenter } });
    await confirmada(compra.id);
    const [t] = await titulosDe(compra.id);
    expect(t).toMatchObject({ title_type_id: tipoTitulo, conta_prevista_id: c.I.bankAccount, tipo_operacao_id: topPadrao.id, tipo_operacao_versao_id: topPadrao.versaoId });
    expect(await rateio(t!.id)).toEqual([{ natureza: c.I.category, centro: c.I.costCenter, percentage: "100.00", amount: "10.00" }]);
    expect((await auditoriaDaConfirmacao(compra.id)).classificacaoFinanceira).toEqual({ categoriaFinanceiraId: c.I.category, centroCustoId: c.I.costCenter });
  });
});

describe("CC-3 — a TOP que não deixa o documento trocar", () => {
  it("outra natureza → 422 no SALVAR, nada gravado; no receber, a mesma 422 e o pedido sem compra; com os da TOP, salva e confirma", async () => {
    const semTroca = await topCompraNo5({ secao: { documentoTroca: false }, padroes: { naturezaId: natureza, centroCustoId: centroC } });
    const esperado = { code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG.troca, details: { exigencias: [{ caminho: "financeiroPadrao.documentoTroca", mensagem: MSG.troca }] } };
    const docsAntes = await contar("documentos_compra");
    const r = await lancarCompra("compra", corpo(semTroca.id, { natureza: c.I.category, centro: c.I.costCenter }));
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual(esperado);
    expect(await contar("documentos_compra"), "nada gravado").toBe(docsAntes);

    const topPedido = await topPedidoNo5(semTroca.id);
    const p = await pedidoCompra(topPedido.id, prod.id);
    const docsComPedido = await contar("documentos_compra");
    const rr = await receber(p, semTroca.id, "4");
    expect(rr.statusCode, rr.body).toBe(422);
    expect(erro(rr)).toEqual(esperado);
    expect([await contar("documentos_compra"), await situacaoDe(p.id)], "o pedido sem compra gerada, aberto").toEqual([docsComPedido, "aberto"]);

    // PREMISSA: com a natureza e o centro da TOP, salva e confirma.
    const ok = await compraLancada("compra", corpo(semTroca.id, { natureza, centro: centroC }));
    await confirmada(ok.id);
    expect((await titulosDe(ok.id)).map((t) => t.status)).toEqual(["open"]);
  });
});

describe("CC-4 — a conta padrão inativada depois de salvar a compra", () => {
  it("a prévia recusa em padroesFinanceiros.contaBancariaId; confirmar → 422 sem título e sem movimento; reativada, confirma e o título leva a conta", async () => {
    const conta = await contaNova();
    const topConta = await topCompraNo5({ padroes: { naturezaId: natureza, centroCustoId: centroC, contaBancariaId: conta } });
    const compra = await compraLancada("compra", corpo(topConta.id));
    expect((await previa(compra.id)).podeConfirmar, "premissa: com a conta ativa, a compra confirmaria").toBe(true);
    await ativarConta(conta, false);
    const esperado = { code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG.contaInutilizavel,
      details: { exigencias: [{ caminho: "padroesFinanceiros.contaBancariaId", mensagem: MSG.contaInutilizavel }] } };
    const p = await previa(compra.id);
    expect([p.podeConfirmar, p.recusas]).toEqual([false, [esperado]]);
    const r = await confirmarCompra(compra.id);
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual(esperado);
    expect([await situacaoDe(compra.id), await titulosDe(compra.id), await movimentosDe("documentos_compra", compra.id)]).toEqual(["aberto", [], []]);

    await ativarConta(conta, true);
    await confirmada(compra.id);
    expect((await titulosDe(compra.id)).map((t) => t.conta_prevista_id)).toEqual([conta]);
    expect((await movimentosDe("documentos_compra", compra.id)).length, "premissa: confirmada, a compra deu entrada").toBe(1);
  });
});

describe("CC-5 — neutro = hoje (TOP no formato 4)", () => {
  it("a prévia e a auditoria com as chaves de hoje; o título sem tipo e sem conta da TOP, e COM a TOP e a versão da compra (o aditivo da F9b)", async () => {
    const versao4 = await versaoAtualNoBanco(c.tops.compra);
    expect(versao4.configuracao_schema_version, "premissa: a TOP de compra padrão está no formato 4").toBe(4);
    const compra = await compraLancada("compra", corpo(c.tops.compra, { natureza: c.I.category, centro: c.I.costCenter }));
    const p = await previa(compra.id);
    expect(p.podeConfirmar).toBe(true);
    expect(Object.keys(p.financeiro.classificacao ?? {})).toEqual(["categoria", "centro"]);
    await confirmada(compra.id);
    // A trilha é jsonb (o banco reordena as chaves): o conjunto exato de chaves, sem a `origem` da F9b.
    expect(Object.keys((await auditoriaDaConfirmacao(compra.id)).classificacaoFinanceira as Record<string, unknown>).sort()).toEqual(["categoriaFinanceiraId", "centroCustoId"]);
    const [t] = await titulosDe(compra.id);
    expect(t).toMatchObject({ title_type_id: null, conta_prevista_id: null, tipo_operacao_id: c.tops.compra, tipo_operacao_versao_id: versao4.id });
  });
});
