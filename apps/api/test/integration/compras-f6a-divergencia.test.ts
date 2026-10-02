import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configuracaoNeutraTopV5, type ConfiguracaoTipoOperacaoV5 } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, cfg4, top, versaoAtualNoBanco, produto,
  itemCompra, corpoCompra, compraLancada, confirmarCompra, previaCompra, receberPedido, corpoReceber,
  movimentosDe, titulosDe, situacaoNoBanco, auditoriaDe,
  type Erro, type ItemCompra,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F6a (decisão 283) — A DIVERGÊNCIA COM O PEDIDO NA CONFIRMAÇÃO DA COMPRA (plano F6a §1.3.10; DV-1..DV-5).
 *
 * A seção `divergenciaPedido` do formato 5, na TOP DA COMPRA, compara a compra gerada de um pedido com ele: o preço
 * unitário líquido (por linha) e a quantidade contra o saldo antes desta compra (por item do pedido).
 *   · DV-1 sem a seção (formato 4) ou "Nenhuma" (o neutro do 5): a prévia SEM a chave `divergencia` — o corpo de hoje,
 *          chave por chave — e a compra confirma, mesmo divergindo;
 *   · DV-2 "Avisar": a prévia mostra os itens (preço e quantidade, sinal e %), `podeConfirmar` verdadeiro, confirma, e
 *          a auditoria "confirm" guarda o aviso;
 *   · DV-3 "Bloquear": acima da tolerância, a prévia recusa DIVERGENCIA_COM_O_PEDIDO com os itens acima, o confirmar dá
 *          409 e NADA é gravado; dentro da tolerância, confirma;
 *   · DV-4 compra SEM origem com TOP "Bloquear": nada se compara, sem a chave, confirma;
 *   · DV-5 confirmação automática com "Bloquear": a compra gerada fica salva e aberta, `confirmacaoAutomatica`
 *          "recusada" com o código (o MESMO corpo do /confirm).
 *
 * O QUE CONTA COMO PROVA: a situação, os movimentos, os títulos e a trilha LIDOS NO BANCO (`c.admin`); toda recusa
 * "sem efeito" com a premissa ao lado (a compra igual ao pedido, ou dentro da tolerância, confirma).
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const MSG_DIVERGENCIA = "A compra diverge do pedido além da tolerância desta operação.";
/** As chaves da prévia de HOJE, na ordem (`previaDaConfirmacao` da COMPRAS-01). */
const CHAVES_DA_PREVIA = ["contractVersion", "podeConfirmar", "recusas", "estoque", "financeiro", "politica"];

// ─────────────── TOPs ───────────────

function cfg5(ajuste: (x: ConfiguracaoTipoOperacaoV5) => void = () => {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  ajuste(x);
  return x;
}
type Modo = "nenhuma" | "avisa" | "bloqueia";
const divergencia = (modo: Modo, preco = "0", quantidade = "0", ajuste: (x: ConfiguracaoTipoOperacaoV5) => void = () => {}) => cfg5((x) => {
  x.divergenciaPedido = { modo, toleranciaPrecoPercentual: preco, toleranciaQuantidadePercentual: quantidade };
  ajuste(x);
});

async function topNoFormato(codigoBase: string, configuracao: { versaoSchema: number }, extra: Record<string, unknown> = {}): Promise<string> {
  const id = await top(codigoBase, { configuracao, ...extra });
  expect((await versaoAtualNoBanco(id)).configuracao_schema_version, `premissa: a versão de ${codigoBase} está no formato ${configuracao.versaoSchema}`)
    .toBe(configuracao.versaoSchema);
  return id;
}

/**
 * A TOP de compra com a configuração do caso (com a premissa de que a seção GRAVADA é a pedida) e uma TOP de pedido
 * (formato 4 neutro) com a aresta para ela — "Em partes" por padrão, para receber parte do saldo.
 */
async function tops(configuracaoCompra: { versaoSchema: number }, emPartes = true) {
  const compra = await topNoFormato("compras.compra", configuracaoCompra);
  if ("divergenciaPedido" in configuracaoCompra) {
    expect((await versaoAtualNoBanco(compra)).configuracao.divergenciaPedido, "premissa: a seção gravada é a do caso")
      .toEqual((configuracaoCompra as ConfiguracaoTipoOperacaoV5).divergenciaPedido);
  }
  const pedido = await topNoFormato("compras.pedido", cfg4(), { destinos: [{ tipoOperacaoId: compra, ordem: 0, emPartes }] });
  return { compra, pedido };
}

/** Um pedido (TOP dada) e os itens dele no banco, na ordem. */
async function pedido(topPedido: string, itens: ItemCompra[]) {
  const p = await compraLancada("pedido", corpoCompra(itens, { tipo_operacao_id: topPedido }, "pedido"));
  const linhas = (await c.admin.query<{ id: string }>("select id from erp.documentos_compra_itens where documento_id=$1 order by posicao, id", [p.id])).rows;
  expect(linhas, "premissa: o pedido tem os itens do corpo").toHaveLength(itens.length);
  return { id: p.id, itens: linhas.map((l) => l.id) };
}

/** Recebe o pedido na TOP de compra: uma linha por item, com quantidade e valor unitário dados. Devolve o corpo. */
async function receber(p: { id: string; itens: string[] }, topCompra: string, linhas: { quantidade: string; valor: string }[]) {
  const r = await receberPedido(p.id, corpoReceber(topCompra, linhas.map((l, i) => ({ item_origem_id: p.itens[i]!, quantidade: l.quantidade, valor_unitario: l.valor }))));
  expect(r.statusCode, `premissa: o pedido é recebido — ${r.body}`).toBe(201);
  return j(r) as Record<string, unknown> & { id: string };
}

/** As linhas da compra no banco (id), na ordem, e o "código - descrição" do produto. */
async function linhasDaCompra(id: string): Promise<string[]> {
  return (await c.admin.query<{ id: string }>("select id from erp.documentos_compra_itens where documento_id=$1 order by posicao, id", [id])).rows.map((x) => x.id);
}
async function nomeDoProduto(id: string): Promise<string> {
  return (await c.admin.query<{ n: string }>("select code || ' - ' || description n from erp.products where id=$1", [id])).rows[0]!.n;
}

/** "Nada aconteceu": aberta, sem movimento, sem título, sem auditoria "confirm". */
async function semEfeito(id: string) {
  return [await situacaoNoBanco("documentos_compra", id), (await movimentosDe("documentos_compra", id)).length,
    (await titulosDe("documentos_compra", id)).length, (await auditoriaDe("documentos_compra", id, "confirm")).length];
}
/** Confirmada, com entrada e título — lido no banco. */
async function confirmada(id: string) {
  return [await situacaoNoBanco("documentos_compra", id), (await movimentosDe("documentos_compra", id)).length > 0,
    (await titulosDe("documentos_compra", id)).length > 0, (await auditoriaDe("documentos_compra", id, "confirm")).length];
}
const CONFIRMADA = ["confirmado", true, true, 1];

// ─────────────── DV-1 ───────────────

describe("DV-1 sem a seção ou 'Nenhuma': o corpo de hoje e a compra confirma, mesmo divergindo", () => {
  it("DV-1a formato 4 e o neutro do 5: prévia sem `divergencia` (as chaves de hoje), confirma; a auditoria sem a chave", async () => {
    for (const configuracao of [cfg4(), cfg5()]) {
      const t = await tops(configuracao);
      const p = await produto();
      const ped = await pedido(t.pedido, [itemCompra(p.id, "10", "10.00")]);
      const compra = await receber(ped, t.compra, [{ quantidade: "6", valor: "12.00" }]);
      // Premissa: a compra DIVERGE do pedido (preço 12 contra 10, 6 de 10) — a ausência não é falta de divergência.
      const precos = (await c.admin.query<{ v: string }>("select valor_unitario::text v from erp.documentos_compra_itens where id = any($1::uuid[]) order by valor_unitario",
        [[ped.itens[0]!, (await linhasDaCompra(compra.id))[0]!]])).rows.map((x) => x.v);
      expect(precos, `formato ${configuracao.versaoSchema}`).toEqual(["10.000000", "12.000000"]);
      const pv = await previaCompra(compra.id);
      expect(pv.statusCode, pv.body).toBe(200);
      expect(Object.keys(j(pv)), `formato ${configuracao.versaoSchema}`).toEqual(CHAVES_DA_PREVIA);
      expect([j(pv).podeConfirmar, j(pv).recusas]).toEqual([true, []]);
      expect((await confirmarCompra(compra.id)).statusCode).toBe(200);
      expect(await confirmada(compra.id)).toEqual(CONFIRMADA);
      const [conf] = await auditoriaDe("documentos_compra", compra.id, "confirm");
      expect(Object.hasOwn(conf!.metadata!, "divergencia")).toBe(false);
    }
  });
});

// ─────────────── DV-2 ───────────────

describe("DV-2 'Avisar': a prévia mostra, a compra confirma e a auditoria guarda o aviso", () => {
  it("DV-2a preço para mais (acima e dentro da tolerância) e quantidade parcial: os itens com sinal e %, na ordem; podeConfirmar", async () => {
    const t = await tops(divergencia("avisa", "5.5", "10"));
    const p1 = await produto(); const p2 = await produto();
    const ped = await pedido(t.pedido, [itemCompra(p1.id, "10", "10.00"), itemCompra(p2.id, "4", "25.00")]);
    const compra = await receber(ped, t.compra, [{ quantidade: "6", valor: "12.00" }, { quantidade: "4", valor: "25.50" }]);
    const [l1, l2] = await linhasDaCompra(compra.id);
    const n1 = await nomeDoProduto(p1.id); const n2 = await nomeDoProduto(p2.id);
    const esperado = {
      modo: "avisa", toleranciaPrecoPercentual: "5.5", toleranciaQuantidadePercentual: "10",
      itens: [
        { campo: "preco", itemPedidoId: ped.itens[0], itemIds: [l1], produto: n1, valorPedido: "10.000000", valorCompra: "12.000000", diferencaPercentual: "20.00", acimaDaTolerancia: true },
        { campo: "quantidade", itemPedidoId: ped.itens[0], itemIds: [l1], produto: n1, valorPedido: "10.0000", valorCompra: "6.0000", diferencaPercentual: "-40.00", acimaDaTolerancia: true },
        // 25.50 contra 25.00: +2% (dentro dos 5.5%); a quantidade do 2º item é o saldo inteiro — não diverge.
        { campo: "preco", itemPedidoId: ped.itens[1], itemIds: [l2], produto: n2, valorPedido: "25.000000", valorCompra: "25.500000", diferencaPercentual: "2.00", acimaDaTolerancia: false },
      ],
      bloqueia: false,
    };
    const pv = await previaCompra(compra.id);
    expect(pv.statusCode, pv.body).toBe(200);
    // O corpo de hoje + `divergencia` no FIM.
    expect(Object.keys(j(pv))).toEqual([...CHAVES_DA_PREVIA, "divergencia"]);
    expect(j(pv).divergencia).toEqual(esperado);
    expect([j(pv).podeConfirmar, j(pv).recusas]).toEqual([true, []]);
    // Confirma, e a auditoria "confirm" guarda o aviso (modo e itens).
    expect((await confirmarCompra(compra.id)).statusCode).toBe(200);
    expect(await confirmada(compra.id)).toEqual(CONFIRMADA);
    const [conf] = await auditoriaDe("documentos_compra", compra.id, "confirm");
    expect(conf!.metadata!.divergencia).toEqual({ modo: "avisa", itens: esperado.itens });
  });

  it("DV-2b preço para menos (o desconto da compra entra no líquido); a compra igual ao pedido → `divergencia` com itens [] e sem a chave na auditoria", async () => {
    const t = await tops(divergencia("avisa"));
    const p = await produto();
    const ped = await pedido(t.pedido, [itemCompra(p.id, "4", "10.00")]);
    // 4 × 10.00 − 2.00 de desconto = 38.00 → líquido 9.50 (−5%).
    const r = await receberPedido(ped.id, corpoReceber(t.compra, [{ item_origem_id: ped.itens[0]!, quantidade: "4", valor_unitario: "10.00", desconto: "2.00" }]));
    expect(r.statusCode, r.body).toBe(201);
    const compra = j(r) as { id: string };
    const [l1] = await linhasDaCompra(compra.id);
    expect(j(await previaCompra(compra.id)).divergencia).toEqual({ modo: "avisa", toleranciaPrecoPercentual: "0", toleranciaQuantidadePercentual: "0", bloqueia: false,
      itens: [{ campo: "preco", itemPedidoId: ped.itens[0], itemIds: [l1], produto: await nomeDoProduto(p.id), valorPedido: "10.000000", valorCompra: "9.500000", diferencaPercentual: "-5.00", acimaDaTolerancia: true }] });

    const igual = await pedido(t.pedido, [itemCompra(p.id, "4", "10.00")]);
    const compraIgual = await receber(igual, t.compra, [{ quantidade: "4", valor: "10.00" }]);
    expect(j(await previaCompra(compraIgual.id)).divergencia).toEqual({ modo: "avisa", toleranciaPrecoPercentual: "0", toleranciaQuantidadePercentual: "0", itens: [], bloqueia: false });
    expect((await confirmarCompra(compraIgual.id)).statusCode).toBe(200);
    const [conf] = await auditoriaDe("documentos_compra", compraIgual.id, "confirm");
    expect(Object.hasOwn(conf!.metadata!, "divergencia"), "sem divergência, a auditoria é a de hoje").toBe(false);
  });
});

// ─────────────── DV-3 ───────────────

describe("DV-3 'Bloquear': acima da tolerância recusa sem efeito; dentro, confirma", () => {
  it("DV-3a preço +20% com tolerância de 5%: prévia recusa com os itens acima; confirmar 409 e nada gravado; premissa: +4% confirma", async () => {
    const t = await tops(divergencia("bloqueia", "5", "50"));
    const p = await produto();
    const ped = await pedido(t.pedido, [itemCompra(p.id, "10", "10.00")]);
    const compra = await receber(ped, t.compra, [{ quantidade: "6", valor: "12.00" }]);
    const [l1] = await linhasDaCompra(compra.id);
    const nome = await nomeDoProduto(p.id);
    const preco = { campo: "preco", itemPedidoId: ped.itens[0], itemIds: [l1], produto: nome, valorPedido: "10.000000", valorCompra: "12.000000", diferencaPercentual: "20.00", acimaDaTolerancia: true };
    const quantidade = { campo: "quantidade", itemPedidoId: ped.itens[0], itemIds: [l1], produto: nome, valorPedido: "10.0000", valorCompra: "6.0000", diferencaPercentual: "-40.00", acimaDaTolerancia: false };
    const recusa: Erro = { code: "DIVERGENCIA_COM_O_PEDIDO", message: MSG_DIVERGENCIA, details: { itens: [preco] } };

    const pv = await previaCompra(compra.id);
    expect(pv.statusCode, pv.body).toBe(200);
    expect([j(pv).podeConfirmar, j(pv).recusas]).toEqual([false, [recusa]]);
    expect(j(pv).divergencia).toEqual({ modo: "bloqueia", toleranciaPrecoPercentual: "5", toleranciaQuantidadePercentual: "50", itens: [preco, quantidade], bloqueia: true });
    const r = await confirmarCompra(compra.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual(recusa);
    expect(await semEfeito(compra.id)).toEqual(["aberto", 0, 0, 0]);

    // Premissa: a MESMA TOP, com o preço dentro da tolerância (+4%), confirma.
    const ped2 = await pedido(t.pedido, [itemCompra(p.id, "10", "10.00")]);
    const dentro = await receber(ped2, t.compra, [{ quantidade: "6", valor: "10.40" }]);
    const pv2 = j(await previaCompra(dentro.id));
    expect([pv2.podeConfirmar, (pv2.divergencia as { bloqueia: boolean; itens: { acimaDaTolerancia: boolean }[] }).bloqueia]).toEqual([true, false]);
    expect((pv2.divergencia as { itens: { campo: string; diferencaPercentual: string; acimaDaTolerancia: boolean }[] }).itens.map((i) => [i.campo, i.diferencaPercentual, i.acimaDaTolerancia]))
      .toEqual([["preco", "4.00", false], ["quantidade", "-40.00", false]]);
    expect((await confirmarCompra(dentro.id)).statusCode).toBe(200);
    expect(await confirmada(dentro.id)).toEqual(CONFIRMADA);
  });

  it("DV-3b a quantidade contra o saldo ANTES desta compra: a 2ª parte que fecha o saldo não diverge; a tolerância no limite (=) não passa", async () => {
    const t = await tops(divergencia("bloqueia", "0", "40"));
    const p = await produto();
    const ped = await pedido(t.pedido, [itemCompra(p.id, "10", "10.00")]);
    // 1ª parte: 6 de 10 → −40%, exatamente a tolerância: NÃO passa (comparação estrita).
    const primeira = await receber(ped, t.compra, [{ quantidade: "6", valor: "10.00" }]);
    const pv1 = j(await previaCompra(primeira.id));
    expect((pv1.divergencia as { itens: unknown[] }).itens).toEqual([expect.objectContaining({ campo: "quantidade", valorPedido: "10.0000", valorCompra: "6.0000", diferencaPercentual: "-40.00", acimaDaTolerancia: false })]);
    expect(pv1.podeConfirmar).toBe(true);
    expect((await confirmarCompra(primeira.id)).statusCode).toBe(200);
    // 2ª parte: os 4 que faltam — o saldo antes desta compra é 4: sem divergência de quantidade.
    const segunda = await receber(ped, t.compra, [{ quantidade: "4", valor: "10.00" }]);
    expect((j(await previaCompra(segunda.id)).divergencia as { itens: unknown[] }).itens).toEqual([]);
    expect((await confirmarCompra(segunda.id)).statusCode).toBe(200);
  });
});

// ─────────────── DV-4 ───────────────

describe("DV-4 compra SEM origem: nada se compara", () => {
  it("DV-4a TOP 'Bloquear' com tolerância 0 e compra direta: prévia sem `divergencia` (as chaves de hoje), confirma", async () => {
    const t = await tops(divergencia("bloqueia"));
    const p = await produto();
    const compra = await compraLancada("compra", corpoCompra([itemCompra(p.id, "3", "12.00")], { tipo_operacao_id: t.compra }));
    const pv = await previaCompra(compra.id);
    expect(pv.statusCode, pv.body).toBe(200);
    expect(Object.keys(j(pv))).toEqual(CHAVES_DA_PREVIA);
    expect(j(pv).podeConfirmar).toBe(true);
    expect((await confirmarCompra(compra.id)).statusCode).toBe(200);
    expect(await confirmada(compra.id)).toEqual(CONFIRMADA);
  });
});

// ─────────────── DV-5 ───────────────

describe("DV-5 confirmação automática com 'Bloquear'", () => {
  it("DV-5a o receber gera a compra salva e ABERTA, 'recusada' com DIVERGENCIA_COM_O_PEDIDO (o MESMO corpo do /confirm); premissa: igual ao pedido, confirma sozinha", async () => {
    const t = await tops(divergencia("bloqueia", "0", "0", (x) => { x.geral.confirmacao = "automatica"; }), false);
    const p = await produto();
    const ped = await pedido(t.pedido, [itemCompra(p.id, "2", "10.00")]);
    const compra = await receber(ped, t.compra, [{ quantidade: "2", valor: "12.00" }]);
    expect([compra.situacao, compra.pedidoSituacao]).toEqual(["aberto", "convertido"]);
    const ca = compra.confirmacaoAutomatica as { confirmado: boolean; motivo: string; erro: Erro };
    expect([ca.confirmado, ca.motivo, ca.erro.code, ca.erro.message]).toEqual([false, "recusada", "DIVERGENCIA_COM_O_PEDIDO", MSG_DIVERGENCIA]);
    expect(await semEfeito(compra.id)).toEqual(["aberto", 0, 0, 0]);
    const manual = await confirmarCompra(compra.id);
    expect(manual.statusCode, manual.body).toBe(409);
    expect(ca.erro).toEqual(erro(manual));

    const igual = await pedido(t.pedido, [itemCompra(p.id, "2", "10.00")]);
    const ok = await receber(igual, t.compra, [{ quantidade: "2", valor: "10.00" }]);
    expect([ok.situacao, ok.confirmacaoAutomatica]).toEqual(["confirmado", { confirmado: true }]);
    expect(await confirmada(ok.id)).toEqual(CONFIRMADA);
  });
});
