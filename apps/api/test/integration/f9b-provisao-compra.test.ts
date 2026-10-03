import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { D } from "@agro/shared";
import { c, iniciar, encerrar, j, erro, DATA, produto, type Produto } from "./top-config-08-ajuda.js";
import {
  topCompraNo5, topPedidoNo5, topOrcamentoNo4, cadastroDespesa, centro, contaNova, ativarConta, umTipoDeTitulo, pedidoCompra, corpoPedido, lancarPedido,
  finalizar, finalizado, recebido, confirmar, confirmada, cancelar, encerrar as encerrarSaldo, previaDaConfirmacao, vencedorEscolhido, situacaoDe,
  titulosDe, previstos, parcelas, rateio, trilhaProvisao, contar, baixasDe, VENCIMENTOS, type TopNo5, type PedidoCompra
} from "./f9b-ajuda.js";

/**
 * OPERACOES-01 F9b (decisão 286) — A PROVISÃO DO PEDIDO DE COMPRA FINALIZADO (`lib/financeiro-provisao.ts`, a fonte
 * `documentos_compra`; plano F9b §4.2, PC-1..PC-11).
 *
 * O pedido de compra cuja versão congelada da TOP está no formato 5 com `financeiroPadrao.provisao` ligada promete o caixa
 * ao ser FINALIZADO: títulos a PAGAR na situação `previsto` (0045). A sincronização é idempotente e roda a cada evento que
 * muda o que o pedido ainda promete:
 *   · PC-1 salvar não provisiona; finalizar → 2 previstos de 500 nos vencimentos do plano (premissa: no formato 4, nenhum);
 *   · PC-2 receber 400 em partes não muda; confirmar a compra → os títulos de verdade de 400 e previstos de 600, os de 1000
 *          CANCELADOS com trilha — nenhuma linha apagada;
 *   · PC-3 cancelar a compra confirmada → o previsto volta a 1000;
 *   · PC-4 encerrar o saldo com uma compra aberta de 400 → previsto de 400; confirmar → nenhum vivo;
 *   · PC-5 cancelar o pedido finalizado → todos cancelados com "Pedido cancelado: <motivo>";
 *   · PC-6 receber tudo por 900 → convertido, previsto de 900; confirmar → nenhum vivo ("nada mais a gerar");
 *   · PC-7 cancelar a compra que converteu o pedido → ele volta a finalizado e o previsto a 1000 — a confirmada (estorno)
 *          e a ABERTA (PC-7b, recebida por 900: o cancelamento sem estorno, na rota de compras);
 *   · PC-8 o salvar recusa a falta de classificação e a troca proibida (o pedido não se edita) — também com o total ZERO,
 *          que o vencedor do orçamento muda depois sem passar pelo salvar (PC-8c: o caminho que deixaria o pedido preso);
 *   · PC-9 o pedido nunca finalizado não provisiona (neutro = hoje);
 *   · PC-10 a conta padrão inativada recusa o finalizar, nada gravado — e a confirmação e o estorno da compra gerada
 *          (PC-10b, o R2), com a prévia da confirmação sem antecipar a recusa (a escolha 7 do plano);
 *   · PC-11 o previsto a pagar não recebe baixa.
 *
 * TESTEMUNHA: o superusuário (`c.admin`) lê os títulos, os rateios, a situação e a trilha no banco. "Nada apagado" é a
 * contagem antes e depois (só cresce). As TOPs nascem PELA API no formato 5, com os padrões no corpo (`f9b-ajuda`). O
 * receber leva a natureza e o centro do seed: a compra é classificada pelo documento (o assunto aqui é a provisão). As
 * mensagens esperadas estão escritas AQUI, à mão.
 */
beforeAll(async () => {
  await iniciar();
  tipoTitulo = await umTipoDeTitulo();
  natureza = await cadastroDespesa("Despesa prevista PC");
  centroC = await centro("Centro previsto PC");
  prod = await produto();
  topCompra = await topCompraNo5();
  topProv = await topPedidoNo5(topCompra.id, { secao: { provisao: true }, padroes: { naturezaId: natureza, centroCustoId: centroC, tipoTituloId: tipoTitulo, contaBancariaId: c.I.bankAccount } });
}, 240_000);
afterAll(encerrar);

const MSG = {
  semClassificacao: "Esta operação provisiona contas a pagar ao finalizar o pedido: informe a natureza financeira e o centro de resultado, ou configure os padrões da TOP.",
  troca: "Esta operação não deixa trocar a natureza e o centro de resultado: use o padrão da TOP.",
  contaInutilizavel: "A conta padrão da operação está inativa ou foi excluída: ajuste os padrões da TOP.",
  baixaNoPrevisto: "Título previsto não recebe baixa: ele dá lugar ao título de verdade quando o documento é faturado.",
} as const;

let tipoTitulo = ""; let natureza = ""; let centroC = "";
let prod: Produto; let topCompra: TopNo5; let topProv: TopNo5;

const usuario = () => c.h.demo.adminUserId;
const pedido = (top: TopNo5 | string, extra: Record<string, unknown> = {}): Promise<PedidoCompra> =>
  pedidoCompra(typeof top === "string" ? top : top.id, prod.id, extra);
/** Um pedido na TOP que provisiona, já finalizado, com a premissa dos previstos de 1000. */
async function pedidoFinalizado(): Promise<PedidoCompra> {
  const p = await pedido(topProv);
  await finalizado(p.id);
  expect(parcelas((await previstos(p.id)).vivos), "premissa: o pedido finalizado prevê 1000").toEqual([["500.00", VENCIMENTOS[0]], ["500.00", VENCIMENTOS[1]]]);
  return p;
}
const soma = (ts: readonly { amount: string }[]) => ts.reduce((s, t) => s.plus(t.amount), D(0)).toFixed(2);
const ids = (ts: readonly { id: string }[]) => ts.map((t) => t.id).sort();

// ---------------------------------------------------------------------------------------------------------------
describe("PC-1 — finalizar o pedido provisiona a pagar", () => {
  it("salvar não provisiona; finalizar → 2 previstos de 500 com origem, fornecedor, TOP, versão, tipo de título, conta e o rateio da TOP; no formato 4, nenhum", async () => {
    const p4 = await pedido(c.tops.pedidoCompra);
    await finalizado(p4.id);
    expect(await situacaoDe(p4.id), "premissa: o pedido do formato 4 foi finalizado").toBe("finalizado");
    expect(await titulosDe(p4.id), "premissa: o MESMO pedido numa TOP no formato 4 não provisiona").toEqual([]);
    expect(await trilhaProvisao(p4.id), "premissa: e não deixa trilha de provisão").toEqual([]);

    const p = await pedido(topProv);
    expect(await titulosDe(p.id), "salvar o pedido não provisiona").toEqual([]);
    const r = await finalizar(p.id);
    expect(r.statusCode, r.body).toBe(200);
    expect(Object.keys(j(r)), "a resposta do finalizar é a de hoje").toEqual(["id", "situacao", "finalizado_em", "finalizado_por"]);

    const { todos, vivos } = await previstos(p.id);
    expect(todos.length).toBe(2);
    expect(parcelas(vivos)).toEqual([["500.00", VENCIMENTOS[0]], ["500.00", VENCIMENTOS[1]]]);
    expect(vivos.map((t) => t.number).sort()).toEqual([`PC-${p.codigo}-1`, `PC-${p.codigo}-2`]);
    for (const t of vivos) {
      expect(t).toMatchObject({
        direction: "payable", person_id: c.I.provider, empresa_id: c.I.empresa, paid_amount: "0.00", cancel_reason: null,
        tipo_operacao_id: topProv.id, tipo_operacao_versao_id: topProv.versaoId, title_type_id: tipoTitulo, conta_prevista_id: c.I.bankAccount,
      });
      expect(await rateio(t.id)).toEqual([{ natureza, centro: centroC, percentage: "100.00", amount: "500.00" }]);
    }
    const tr = await trilhaProvisao(p.id);
    expect(tr.length, "uma trilha de provisão: a do finalizar").toBe(1);
    expect(tr[0]!.metadata).toMatchObject({ motivo: "Pedido finalizado", alvo: "1000.00", cancelados: [] });
    expect([...tr[0]!.metadata.criados].sort()).toEqual(ids(vivos));
    expect(tr[0]!.user_id).toBe(usuario());
  });
});

describe("PC-2 e PC-3 — a compra confirmada dá lugar ao previsto, e estornada o devolve", () => {
  it("PC-2 receber 400 em partes não muda; confirmar → títulos de verdade de 400 e previstos de 600; os de 1000 cancelados com trilha, nenhum apagado", async () => {
    const p = await pedidoFinalizado();
    const antes = (await previstos(p.id)).vivos;
    const compra = await recebido(p, topCompra.id, "4");
    expect(await situacaoDe(p.id), "premissa: recebido em parte, o pedido segue finalizado").toBe("finalizado");
    expect(ids((await previstos(p.id)).vivos), "a compra ABERTA não realiza: os mesmos previstos").toEqual(ids(antes));
    const linhasAntes = await contar("financial_titles");

    await confirmada(compra.id);
    const reais = await titulosDe(compra.id);
    expect(reais.length, "premissa: a compra gerou os títulos de verdade").toBeGreaterThan(0);
    expect(reais.every((t) => t.status === "open" && t.direction === "payable")).toBe(true);
    expect(soma(reais)).toBe("400.00");
    const depois = await previstos(p.id);
    expect(parcelas(depois.vivos)).toEqual([["300.00", VENCIMENTOS[0]], ["300.00", VENCIMENTOS[1]]]);
    expect(ids(depois.cancelados)).toEqual(ids(antes));
    for (const t of depois.cancelados) expect(t).toMatchObject({ cancel_reason: `Compra ${compra.codigo} confirmada`, cancelled_by: usuario() });
    const quando = await c.admin.query<{ cancelado: boolean }>("select cancelled_at is not null as cancelado from erp.financial_titles where id = any($1::uuid[])", [ids(depois.cancelados)]);
    expect(quando.rows.every((x) => x.cancelado)).toBe(true);
    // NADA APAGADO: só cresce — os 2 previstos novos e os títulos da compra.
    expect(depois.todos.length).toBe(4);
    expect(await contar("financial_titles")).toBe(linhasAntes + 2 + reais.length);
    expect((await trilhaProvisao(p.id)).map((x) => [x.metadata.motivo, x.metadata.alvo])).toEqual([["Pedido finalizado", "1000.00"], [`Compra ${compra.codigo} confirmada`, "600.00"]]);
  });

  it("PC-3 cancelar a compra confirmada → o previsto volta a 1000, e os de 600 saem com \"Compra … cancelada\"; o pedido continua finalizado", async () => {
    const p = await pedidoFinalizado();
    const compra = await recebido(p, topCompra.id, "4");
    await confirmada(compra.id);
    const de600 = (await previstos(p.id)).vivos;
    expect(parcelas(de600), "premissa: previstos de 600 depois da compra").toEqual([["300.00", VENCIMENTOS[0]], ["300.00", VENCIMENTOS[1]]]);
    const linhasAntes = await contar("financial_titles");

    const r = await cancelar("compras", compra.id, "Nota devolvida");
    expect(r.statusCode, r.body).toBe(200);
    expect(await situacaoDe(compra.id), "premissa: a compra foi estornada").toBe("cancelado");
    expect((await titulosDe(compra.id)).every((t) => t.status === "cancelled"), "premissa: os títulos da compra saíram com ela").toBe(true);
    const depois = await previstos(p.id);
    expect(parcelas(depois.vivos)).toEqual([["500.00", VENCIMENTOS[0]], ["500.00", VENCIMENTOS[1]]]);
    const saidos = depois.cancelados.filter((t) => de600.some((x) => x.id === t.id));
    expect(saidos.length).toBe(2);
    for (const t of saidos) expect(t).toMatchObject({ cancel_reason: `Compra ${compra.codigo} cancelada`, cancelled_by: usuario() });
    expect(await situacaoDe(p.id)).toBe("finalizado");
    expect(await contar("financial_titles"), "nada apagado: só os 2 previstos novos").toBe(linhasAntes + 2);
  });
});

describe("PC-4 e PC-5 — encerrar o saldo e cancelar o pedido", () => {
  it("PC-4 encerrar com uma compra aberta de 400 → previsto de 400; confirmar a compra → nenhum previsto vivo", async () => {
    const p = await pedidoFinalizado();
    const compra = await recebido(p, topCompra.id, "4");
    const motivo = "Fornecedor não entrega o resto";
    const r = await encerrarSaldo(p.id, motivo);
    expect(r.statusCode, r.body).toBe(200);
    expect(await situacaoDe(p.id), "premissa: o saldo foi encerrado").toBe("convertido");
    const encerrado = await previstos(p.id);
    expect(parcelas(encerrado.vivos)).toEqual([["200.00", VENCIMENTOS[0]], ["200.00", VENCIMENTOS[1]]]);
    expect(encerrado.cancelados.map((t) => t.cancel_reason)).toEqual([`Saldo do pedido encerrado: ${motivo}`, `Saldo do pedido encerrado: ${motivo}`]);

    await confirmada(compra.id);
    const fim = await previstos(p.id);
    expect(fim.vivos).toEqual([]);
    expect(fim.todos.length, "nada apagado: 2 + 2, todos cancelados").toBe(4);
    expect(fim.cancelados.filter((t) => encerrado.vivos.some((x) => x.id === t.id)).map((t) => t.cancel_reason))
      .toEqual([`Compra ${compra.codigo} confirmada`, `Compra ${compra.codigo} confirmada`]);
    expect((await trilhaProvisao(p.id)).map((x) => x.metadata.alvo)).toEqual(["1000.00", "400.00", "0.00"]);
  });

  it("PC-5 cancelar o pedido finalizado sem compra → todos os previstos cancelados com \"Pedido cancelado: <motivo>\"", async () => {
    const p = await pedidoFinalizado();
    const r = await cancelar("pedidos", p.id, "Pedido em duplicidade");
    expect(r.statusCode, r.body).toBe(200);
    expect(await situacaoDe(p.id), "premissa: o pedido foi cancelado").toBe("cancelado");
    const { todos, vivos } = await previstos(p.id);
    expect(vivos).toEqual([]);
    expect(todos.map((t) => [t.status, t.cancel_reason, t.cancelled_by])).toEqual([
      ["cancelled", "Pedido cancelado: Pedido em duplicidade", usuario()], ["cancelled", "Pedido cancelado: Pedido em duplicidade", usuario()]]);
  });
});

describe("PC-6 e PC-7 — o pedido convertido inteiro, e reaberto", () => {
  it("PC-6 receber tudo por 900 → convertido e previsto de 900; confirmar → nenhum previsto vivo (os 100 de diferença não ficam previstos)", async () => {
    const p = await pedidoFinalizado();
    const compra = await recebido(p, topCompra.id, "10", "90.00");
    expect(await situacaoDe(p.id), "premissa: o pedido foi convertido inteiro").toBe("convertido");
    const doBanco = (await c.admin.query<{ pedido: string; compra: string }>(
      "select (select valor_total::text from erp.documentos_compra where id=$1) as pedido, (select valor_total::text from erp.documentos_compra where id=$2) as compra",
      [p.id, compra.id])).rows[0]!;
    expect(doBanco, "premissa: a compra vale 900 e o pedido 1000 (a fórmula \"pedido − confirmadas\" deixaria 100)").toEqual({ pedido: "1000.00", compra: "900.00" });
    const convertido = await previstos(p.id);
    expect(parcelas(convertido.vivos)).toEqual([["450.00", VENCIMENTOS[0]], ["450.00", VENCIMENTOS[1]]]);
    expect(convertido.cancelados.map((t) => t.cancel_reason)).toEqual([`Recebido na compra ${compra.codigo}`, `Recebido na compra ${compra.codigo}`]);

    await confirmada(compra.id);
    const { todos, vivos } = await previstos(p.id);
    expect(vivos, "nenhuma diferença fica prevista").toEqual([]);
    expect(todos.filter((t) => convertido.vivos.some((x) => x.id === t.id)).map((t) => t.cancel_reason))
      .toEqual([`Compra ${compra.codigo} confirmada`, `Compra ${compra.codigo} confirmada`]);
    expect(soma(await titulosDe(compra.id)), "o título de verdade é o da compra").toBe("900.00");
  });

  it("PC-7 recebido inteiro e confirmado (nenhum previsto) → cancelar a compra reabre o pedido como finalizado e o previsto volta a 1000", async () => {
    const p = await pedidoFinalizado();
    const de1000 = (await previstos(p.id)).vivos;
    const compra = await recebido(p, topCompra.id, "10");
    expect(await situacaoDe(p.id), "premissa: convertido").toBe("convertido");
    expect(ids((await previstos(p.id)).vivos), "convertido pelo mesmo valor: a compra aberta ainda promete os mesmos 1000").toEqual(ids(de1000));
    await confirmada(compra.id);
    expect((await previstos(p.id)).vivos, "premissa: confirmada a compra, nenhum previsto vivo").toEqual([]);

    const r = await cancelar("compras", compra.id);
    expect(r.statusCode, r.body).toBe(200);
    expect(await situacaoDe(p.id), "o pedido volta a finalizado (lido no banco)").toBe("finalizado");
    const { vivos, todos } = await previstos(p.id);
    expect(parcelas(vivos)).toEqual([["500.00", VENCIMENTOS[0]], ["500.00", VENCIMENTOS[1]]]);
    expect(ids(vivos).some((id) => de1000.some((x) => x.id === id)), "são previstos NOVOS (os antigos ficam cancelados)").toBe(false);
    expect(todos.length, "nada apagado: 2 + 2").toBe(4);
  });

  it("PC-7b recebido inteiro por 900 (convertido, previsto de 900) → cancelar a compra ABERTA reabre o pedido como finalizado, o previsto volta a 1000 e os de 900 saem com \"Compra … cancelada\"", async () => {
    const p = await pedidoFinalizado();
    const compra = await recebido(p, topCompra.id, "10", "90.00");
    expect(await situacaoDe(p.id), "premissa: convertido").toBe("convertido");
    expect(await situacaoDe(compra.id), "premissa: a compra gerada segue ABERTA — o cancelamento sem estorno, na rota de compras").toBe("aberto");
    expect(await titulosDe(compra.id), "premissa: a compra aberta não tem título").toEqual([]);
    const de900 = (await previstos(p.id)).vivos;
    expect(parcelas(de900), "premissa: o pedido convertido prevê o que virou compra (900)").toEqual([["450.00", VENCIMENTOS[0]], ["450.00", VENCIMENTOS[1]]]);
    const linhasAntes = await contar("financial_titles");

    const r = await cancelar("compras", compra.id, "Recebimento lançado errado");
    expect(r.statusCode, r.body).toBe(200);
    expect(await situacaoDe(compra.id), "premissa: a compra foi cancelada").toBe("cancelado");
    expect(await situacaoDe(p.id), "o pedido volta a finalizado (lido no banco)").toBe("finalizado");
    const depois = await previstos(p.id);
    expect(parcelas(depois.vivos)).toEqual([["500.00", VENCIMENTOS[0]], ["500.00", VENCIMENTOS[1]]]);
    const saidos = depois.cancelados.filter((t) => de900.some((x) => x.id === t.id));
    expect(saidos.length, "os 2 previstos de 900 saíram").toBe(2);
    for (const t of saidos) expect(t).toMatchObject({ cancel_reason: `Compra ${compra.codigo} cancelada`, cancelled_by: usuario() });
    expect(await contar("financial_titles"), "nada apagado: só os 2 previstos novos").toBe(linhasAntes + 2);
    expect((await trilhaProvisao(p.id)).map((x) => [x.metadata.motivo, x.metadata.alvo])).toEqual([
      ["Pedido finalizado", "1000.00"], [`Recebido na compra ${compra.codigo}`, "900.00"], [`Compra ${compra.codigo} cancelada`, "1000.00"]]);
  });
});

describe("PC-8 — o salvar do pedido cuja TOP provisiona", () => {
  it("sem natureza e centro nem no pedido nem na TOP → 422 em categoria_financeira_id, nada gravado; com a classificação no pedido, salva, finaliza e o previsto a leva", async () => {
    const semPadroes = await topPedidoNo5(topCompra.id, { secao: { provisao: true } });
    const [docsAntes, titulosAntes] = [await contar("documentos_compra"), await contar("financial_titles")];
    const r = await lancarPedido(corpoPedido(semPadroes.id, prod.id));
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message: MSG.semClassificacao, details: [{ path: "categoria_financeira_id", message: MSG.semClassificacao }] });
    expect([await contar("documentos_compra"), await contar("financial_titles")], "nada gravado: nem o pedido, nem título").toEqual([docsAntes, titulosAntes]);

    const p = await pedido(semPadroes, { categoria_financeira_id: natureza, centro_custo_id: centroC });
    await finalizado(p.id);
    const { vivos } = await previstos(p.id);
    expect(vivos.length, "premissa: com a classificação, provisiona").toBe(2);
    for (const t of vivos) expect(await rateio(t.id)).toEqual([{ natureza, centro: centroC, percentage: "100.00", amount: "500.00" }]);
    expect(vivos.every((t) => t.title_type_id === null && t.conta_prevista_id === null), "a TOP sem padrões não dá tipo nem conta").toBe(true);
  });

  it("a TOP que não deixa trocar + pedido com outra natureza e outro centro → 422 da troca, nada gravado; com os da TOP, salva", async () => {
    const semTroca = await topPedidoNo5(topCompra.id, { secao: { provisao: true, documentoTroca: false }, padroes: { naturezaId: natureza, centroCustoId: centroC } });
    expect([c.I.category, c.I.costCenter], "premissa: a natureza e o centro do seed são outros").not.toEqual([natureza, centroC]);
    const docsAntes = await contar("documentos_compra");
    const r = await lancarPedido(corpoPedido(semTroca.id, prod.id, { categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter }));
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual({ code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG.troca, details: { exigencias: [{ caminho: "financeiroPadrao.documentoTroca", mensagem: MSG.troca }] } });
    expect(await contar("documentos_compra"), "nada gravado").toBe(docsAntes);

    const p = await pedido(semTroca, { categoria_financeira_id: natureza, centro_custo_id: centroC });
    expect(await situacaoDe(p.id), "premissa: com a natureza e o centro da TOP, salva").toBe("aberto");
  });

  it("PC-8c o pedido de total ZERO também é conferido (o vencedor do orçamento grava o valor depois, sem o salvar): sem a classificação → 422, a troca → 422; com a classificação → vencedor de 1000 → finalizar provisiona", async () => {
    const topOrc = await topOrcamentoNo4();
    const semPadroes = await topPedidoNo5(topCompra.id, { secao: { provisao: true }, orcamento: topOrc });
    const semTroca = await topPedidoNo5(topCompra.id, { secao: { provisao: true, documentoTroca: false }, padroes: { naturezaId: natureza, centroCustoId: centroC } });
    const zero = { plano_parcelas: null, itens: [{ produto_id: prod.id, armazem_id: c.I.warehouse, quantidade: "10", valor_unitario: "0" }] };
    const [docsAntes, titulosAntes] = [await contar("documentos_compra"), await contar("financial_titles")];

    const r = await lancarPedido(corpoPedido(semPadroes.id, prod.id, zero));
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message: MSG.semClassificacao, details: [{ path: "categoria_financeira_id", message: MSG.semClassificacao }] });
    const rt = await lancarPedido(corpoPedido(semTroca.id, prod.id, { ...zero, categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter }));
    expect(rt.statusCode, rt.body).toBe(422);
    expect(erro(rt)).toEqual({ code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG.troca, details: { exigencias: [{ caminho: "financeiroPadrao.documentoTroca", mensagem: MSG.troca }] } });
    expect([await contar("documentos_compra"), await contar("financial_titles")], "nada gravado: nem pedido, nem título").toEqual([docsAntes, titulosAntes]);

    // PREMISSA e o caminho que prendia o pedido: com a classificação, o pedido de total zero salva; o vencedor grava 1000
    // no pedido aberto (sem passar pelo salvar); finalizar provisiona com o par do pedido.
    const p = await pedido(semPadroes, { ...zero, categoria_financeira_id: natureza, centro_custo_id: centroC });
    const valor = async () => (await c.admin.query<{ valor_total: string; situacao: string }>(
      "select valor_total::text as valor_total, situacao from erp.documentos_compra where id=$1", [p.id])).rows[0];
    expect(await valor(), "premissa: o pedido nasce com total zero").toEqual({ valor_total: "0.00", situacao: "aberto" });
    await vencedorEscolhido(p, topOrc, "100.00");
    expect(await valor(), "premissa: o vencedor gravou 1000 no pedido aberto").toEqual({ valor_total: "1000.00", situacao: "aberto" });
    await finalizado(p.id);
    const { vivos } = await previstos(p.id);
    expect(parcelas(vivos), "sem plano nem vencimento no pedido: uma parcela na data do documento").toEqual([["1000.00", DATA]]);
    expect(await rateio(vivos[0]!.id)).toEqual([{ natureza, centro: centroC, percentage: "100.00", amount: "1000.00" }]);
  });
});

describe("PC-9 — neutro = hoje: o pedido nunca finalizado não provisiona", () => {
  it("pedido ABERTO numa TOP que provisiona: receber e confirmar → nenhum previsto e nenhuma trilha; finalizado depois, provisiona o que falta", async () => {
    const p = await pedido(topProv);
    const compra = await recebido(p, topCompra.id, "4");
    await confirmada(compra.id);
    expect(await situacaoDe(p.id), "premissa: o pedido segue aberto").toBe("aberto");
    expect(soma(await titulosDe(compra.id)), "premissa: a compra gerou os títulos de verdade").toBe("400.00");
    expect(await titulosDe(p.id), "nenhum previsto").toEqual([]);
    expect(await trilhaProvisao(p.id), "nenhuma trilha de provisão").toEqual([]);

    // PREMISSA: a MESMA TOP, com o MESMO pedido finalizado, provisiona — o que falta (1000 − 400).
    await finalizado(p.id);
    expect(parcelas((await previstos(p.id)).vivos)).toEqual([["300.00", VENCIMENTOS[0]], ["300.00", VENCIMENTOS[1]]]);
  });
});

describe("PC-10 — a conta padrão inativada depois de gravada a TOP", () => {
  it("finalizar → 422 em padroesFinanceiros.contaBancariaId, o pedido continua aberto e sem título; reativada, finaliza e o previsto leva a conta", async () => {
    const conta = await contaNova();
    const topConta = await topPedidoNo5(topCompra.id, { secao: { provisao: true }, padroes: { naturezaId: natureza, centroCustoId: centroC, contaBancariaId: conta } });
    const p = await pedido(topConta);
    await ativarConta(conta, false);
    const titulosAntes = await contar("financial_titles");
    const r = await finalizar(p.id);
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual({ code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG.contaInutilizavel,
      details: { exigencias: [{ caminho: "padroesFinanceiros.contaBancariaId", mensagem: MSG.contaInutilizavel }] } });
    const cab = (await c.admin.query<{ situacao: string; finalizado: boolean }>("select situacao, finalizado_em is not null as finalizado from erp.documentos_compra where id=$1", [p.id])).rows[0];
    expect(cab, "o finalizar inteiro voltou").toEqual({ situacao: "aberto", finalizado: false });
    expect([await titulosDe(p.id), await contar("financial_titles")]).toEqual([[], titulosAntes]);

    await ativarConta(conta, true);
    await finalizado(p.id);
    const { vivos } = await previstos(p.id);
    expect(vivos.map((t) => [t.amount, t.conta_prevista_id])).toEqual([["500.00", conta], ["500.00", conta]]);
  });

  it("PC-10b a conta padrão do PEDIDO inativada barra também a confirmação e o estorno da compra gerada (422, nada gravado); a prévia da confirmação não antecipa; reativada, passa", async () => {
    const conta = await contaNova();
    const topConta = await topPedidoNo5(topCompra.id, { secao: { provisao: true }, padroes: { naturezaId: natureza, centroCustoId: centroC, contaBancariaId: conta } });
    const p = await pedido(topConta);
    await finalizado(p.id);
    const de1000 = (await previstos(p.id)).vivos;
    expect(de1000.map((t) => [t.amount, t.conta_prevista_id]), "premissa: o pedido finalizado prevê 1000 na conta padrão").toEqual([["500.00", conta], ["500.00", conta]]);
    const compra = await recebido(p, topCompra.id, "4");
    await ativarConta(conta, false);
    const recusaDaConta = { code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG.contaInutilizavel,
      details: { exigencias: [{ caminho: "padroesFinanceiros.contaBancariaId", mensagem: MSG.contaInutilizavel }] } };

    // A prévia da compra não olha a provisão do pedido de origem (a escolha 7 do plano): diz que pode.
    const pv = await previaDaConfirmacao(compra.id);
    expect(pv.statusCode, pv.body).toBe(200);
    expect(j(pv)).toMatchObject({ podeConfirmar: true, recusas: [] });
    const [titulosAntes, movimentosAntes] = [await contar("financial_titles"), await contar("stock_movements")];
    const r = await confirmar(compra.id);
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual(recusaDaConta);
    expect(await situacaoDe(compra.id), "a confirmação inteira voltou").toBe("aberto");
    expect([await titulosDe(compra.id), await contar("financial_titles"), await contar("stock_movements")]).toEqual([[], titulosAntes, movimentosAntes]);
    expect(ids((await previstos(p.id)).vivos), "os previstos de 1000 ficam").toEqual(ids(de1000));

    await ativarConta(conta, true);
    await confirmada(compra.id);
    const de600 = (await previstos(p.id)).vivos;
    expect(parcelas(de600), "premissa: reativada, a compra confirma e o previsto vai a 600").toEqual([["300.00", VENCIMENTOS[0]], ["300.00", VENCIMENTOS[1]]]);

    // O ESTORNO também é barrado pelo cadastro da TOP do PEDIDO (o previsto de volta a 1000 não consegue nascer).
    await ativarConta(conta, false);
    const linhasAntes = await contar("financial_titles");
    const e = await cancelar("compras", compra.id, "Nota devolvida");
    expect(e.statusCode, e.body).toBe(422);
    expect(erro(e)).toEqual(recusaDaConta);
    expect(await situacaoDe(compra.id), "o estorno inteiro voltou").toBe("confirmado");
    expect((await titulosDe(compra.id)).every((t) => t.status === "open"), "os títulos da compra seguem abertos").toBe(true);
    expect([ids((await previstos(p.id)).vivos), await contar("financial_titles")]).toEqual([ids(de600), linhasAntes]);

    await ativarConta(conta, true);
    const ok = await cancelar("compras", compra.id, "Nota devolvida");
    expect(ok.statusCode, ok.body).toBe(200);
    expect(parcelas((await previstos(p.id)).vivos), "reativada, o estorno devolve o previsto a 1000").toEqual([["500.00", VENCIMENTOS[0]], ["500.00", VENCIMENTOS[1]]]);
  });
});

describe("PC-11 — o previsto a pagar não recebe baixa", () => {
  it("baixa no previsto → 409 sem baixa gravada; o título de verdade da compra recebe (premissa)", async () => {
    const p = await pedidoFinalizado();
    const compra = await recebido(p, topCompra.id, "4");
    await confirmada(compra.id);
    const real = (await titulosDe(compra.id))[0]!;
    const ok = await c.h.app.inject({ method: "POST", url: `/api/financial/payables/${real.id}/settle`, headers: c.h.headers(),
      payload: { settlement_date: DATA, bank_account_id: c.I.bankAccount, amount: "10.00" } });
    expect(ok.statusCode, `premissa: o título de verdade recebe baixa — ${ok.body}`).toBe(201);

    const previsto = (await previstos(p.id)).vivos[0]!;
    const r = await c.h.app.inject({ method: "POST", url: `/api/financial/payables/${previsto.id}/settle`, headers: c.h.headers(),
      payload: { settlement_date: DATA, bank_account_id: c.I.bankAccount, amount: "10.00" } });
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toMatchObject({ code: "CONFLICT", message: MSG.baixaNoPrevisto });
    expect(await baixasDe(previsto.id)).toBe(0);
    const depois = (await titulosDe(p.id)).find((t) => t.id === previsto.id)!;
    expect([depois.status, depois.paid_amount]).toEqual(["previsto", "0.00"]);
  });
});
