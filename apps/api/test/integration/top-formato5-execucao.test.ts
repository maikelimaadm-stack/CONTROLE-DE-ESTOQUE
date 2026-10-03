import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configuracaoNeutraTopV5, type ConfiguracaoTipoOperacaoV5 } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, cfg3, top, versaoAtualNoBanco, produto, produtoComSaldo, saldo,
  itemVenda, corpoVenda, lancarVenda, vendaLancada, confirmarVenda, lerVenda,
  itemCompra, corpoCompra, lancarCompra,
  estoqueLancado, confirmarEstoque, previaEstoque,
  aprovar, fila, movimentosDe, titulosDe, situacaoNoBanco, auditoriaDe, decisoesDe,
  type Resposta, type Erro,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F4 (decisão 281) — A EXECUÇÃO COM A VERSÃO CONGELADA NO FORMATO 5 (plano F4 §2 "Execução" e §4; X5-1..X5-4).
 *
 * O 5 executa TUDO o que o 4 executa — as regras gerais (confirmação automática), a aprovação (`erp.top_exige_aprovacao`
 * da 0041 trata ≥ 4) e a marca da 0023 —, pelo número GRAVADO na versão congelada. O corte da 277 continua: o MESMO
 * conteúdo no formato 3 só declara, e nada executa (a premissa de cada caso).
 *
 *   · X5-1 venda: TOP no 5 Automática → o POST confirma ao salvar (premissa: no 3, a venda fica aberta);
 *   · X5-2 aprovação da venda: TOP no 5 Sempre → 409 APROVACAO_PENDENTE, a venda na fila; aprovada, confirma
 *          (premissa: no 3, nem fila nem recusa);
 *   · X5-3 estoque — a linha mudada em `estoque-confirmacao.ts`: a prévia de uma entrada com TOP no 5 Sempre traz
 *          `recusas` com APROVACAO_PENDENTE e `podeConfirmar: false` (premissa: no 3, a chave `recusas` não existe);
 *   · X5-4 compra: TOP no 5 Automática → confirma ao salvar (premissa: no 5 Manual, fica aberta).
 *
 * O QUE CONTA COMO PROVA (o molde da TOP-CONFIG-08): a situação, os movimentos, os títulos, as decisões e a trilha LIDOS
 * NO BANCO pela testemunha (`c.admin`, superusuário sem RLS), pela origem; nunca só o status HTTP.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── as TOPs do caso ───────────────

/** O neutro do FORMATO 5 (o do domínio), com o ajuste do caso. Cada chamada devolve um objeto novo. */
function cfg5(ajuste: (x: ConfiguracaoTipoOperacaoV5) => void = () => {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  ajuste(x);
  return x;
}
type ComRegras = { geral: { confirmacao: string }; aprovacao: { politica: string; valorMinimo: string | null } };
const automatica = <X extends ComRegras>(x: X): void => { x.geral.confirmacao = "automatica"; };
const sempre = <X extends ComRegras>(x: X): void => { x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null; };

/**
 * Uma TOP NOVA da família com a configuração dada, com a PREMISSA de que o banco guardou a versão no formato pedido:
 * um 5 que virasse 4 no caminho (ou um 3 promovido) mediria outro corte.
 */
async function topNoFormato(codigoBase: string, configuracao: { versaoSchema: number }): Promise<string> {
  const id = await top(codigoBase, { configuracao });
  expect((await versaoAtualNoBanco(id)).configuracao_schema_version, `premissa: a versão de ${codigoBase} está no formato ${configuracao.versaoSchema}`)
    .toBe(configuracao.versaoSchema);
  return id;
}

/** A mensagem e o código da recusa da aprovação, escritos à mão (o contrato da TOP-CONFIG-08). */
const MSG_PENDENTE = "Este documento precisa de aprovação antes de ser confirmado.";
const pendente = (valorDocumento: string | null): Erro =>
  ({ code: "APROVACAO_PENDENTE", message: MSG_PENDENTE, details: { politica: "sempre", valorMinimo: null, valorDocumento } });

/** O que a venda é NO BANCO: situação, movimentos, títulos e quantas auditorias "confirm". */
async function efeitosDaVenda(id: string) {
  return {
    status: await situacaoNoBanco("sales_documents", id),
    movimentos: (await movimentosDe("sales_documents", id)).map((m) => [m.movement_type, m.direction, Number(m.quantity)]),
    titulos: (await titulosDe("sales_documents", id)).map((t) => [t.direction, t.amount]),
    confirmacoes: (await auditoriaDe("sales_documents", id, "confirm")).length,
  };
}
const VENDA_SEM_EFEITO = { status: "open", movimentos: [], titulos: [], confirmacoes: 0 };

/** A `version` que a pessoa vê (o GET da venda): é ela que a decisão da venda manda. */
async function versaoVista(id: string): Promise<string> {
  const r = await lerVenda(id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r).version as string;
}
/** Os ids da fila de aprovação de vendas, inteira (página de 1000, conferida contra o total). */
async function filaDeVendas(): Promise<string[]> {
  const r = await fila("vendas", c.h.headers(), { pageSize: 1000 });
  expect(r.statusCode, r.body).toBe(200);
  const f = j(r) as unknown as { items: { id: string }[]; total: number };
  expect(f.items.length, "premissa: a página de 1000 traz a fila inteira").toBe(f.total);
  return f.items.map((x) => x.id);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// X5-1
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("X5-1 — venda com a TOP no 5 Automática: confirma ao salvar", () => {
  it("X5-1 201 com {confirmado:true}; confirmada no banco com a saída e o título; 'confirm' com automatica e execucao.origem 5; premissa: o MESMO no 3 fica aberta", async () => {
    const top5 = await topNoFormato("vendas.venda", cfg5(automatica));
    const v = await versaoAtualNoBanco(top5);
    expect((v.configuracao.geral as Record<string, unknown>).confirmacao, "premissa: a versão congelada é Automática").toBe("automatica");
    const p = await produtoComSaldo("10");
    const r = await lancarVenda(corpoVenda([itemVenda(p.id, "3", "20.00")], { tipo_operacao_id: top5 }));
    expect(r.statusCode, r.body).toBe(201);
    const b = j(r) as Record<string, unknown> & { id: string };
    expect(b.confirmacaoAutomatica).toEqual({ confirmado: true });
    // O EFEITO, no banco — e, por ter passado, a marca da 0023 foi gravada (a guarda exige a marca em todo formato ≥ 3).
    expect(await efeitosDaVenda(b.id)).toEqual({ status: "confirmed", movimentos: [["sale", -1, 3]], titulos: [["receivable", "60.00"]], confirmacoes: 1 });
    expect(await saldo(p.id)).toBe("7.0000");
    const confirm = (await auditoriaDe("sales_documents", b.id, "confirm"))[0]!;
    expect(confirm.metadata).toMatchObject({ automatica: true, tipoOperacaoVersaoId: v.id, execucao: { origem: 5, estoque: "legado", financeiro: "legado" } });

    // PREMISSA (o corte): o MESMO conteúdo no formato 3 só declara — a venda fica aberta, sem a chave nova.
    const top3 = await topNoFormato("vendas.venda", cfg3(automatica));
    expect((await versaoAtualNoBanco(top3)).configuracao.geral, "premissa: o 3 GUARDA 'automatica'").toMatchObject({ confirmacao: "automatica" });
    const r3 = await lancarVenda(corpoVenda([itemVenda(p.id, "1", "20.00")], { tipo_operacao_id: top3 }));
    expect(r3.statusCode, r3.body).toBe(201);
    const b3 = j(r3) as Record<string, unknown> & { id: string };
    expect(b3).not.toHaveProperty("confirmacaoAutomatica");
    expect(await efeitosDaVenda(b3.id)).toEqual(VENDA_SEM_EFEITO);
    // …e é confirmável: a manual a confirma (o que faltou foi só o formato que executa).
    expect((await confirmarVenda(b3.id)).statusCode).toBe(200);
    expect((await efeitosDaVenda(b3.id)).status).toBe("confirmed");
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// X5-2
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("X5-2 — aprovação da venda com a TOP no 5 Sempre", () => {
  it("X5-2 confirmar → 409 APROVACAO_PENDENTE (mensagem e details exatos), sem efeito; a venda está na fila; aprovada, confirma e sai da fila; premissa: no 3, nem fila nem recusa", async () => {
    const top5 = await topNoFormato("vendas.venda", cfg5(sempre));
    const p = await produtoComSaldo("10");
    const venda = await vendaLancada(corpoVenda([itemVenda(p.id, "2", "750.00")], { tipo_operacao_id: top5 }));

    const r = await confirmarVenda(venda.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual(pendente("1500.00"));
    expect(await efeitosDaVenda(venda.id), "a aprovação vem antes de qualquer efeito").toEqual(VENDA_SEM_EFEITO);
    expect(await filaDeVendas(), "a venda pendente está na fila de aprovação").toContain(venda.id);

    // Aprovada: a decisão é gravada, a confirmação passa, e ela sai da fila.
    const a = await aprovar("vendas", venda.id, { version: await versaoVista(venda.id) });
    expect(a.statusCode, a.body).toBe(200);
    expect((await decisoesDe("aprovacoes_venda", venda.id)).map((d) => d.decisao)).toEqual(["aprovado"]);
    const ok = await confirmarVenda(venda.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await efeitosDaVenda(venda.id)).toEqual({ status: "confirmed", movimentos: [["sale", -1, 2]], titulos: [["receivable", "1500.00"]], confirmacoes: 1 });
    expect(await filaDeVendas()).not.toContain(venda.id);

    // PREMISSA (o corte): a MESMA política no formato 3 não exige nada — fora da fila, e o /confirm passa direto.
    const top3 = await topNoFormato("vendas.venda", cfg3(sempre));
    const v3 = await vendaLancada(corpoVenda([itemVenda(p.id, "2", "750.00")], { tipo_operacao_id: top3 }));
    expect(await filaDeVendas()).not.toContain(v3.id);
    const ok3 = await confirmarVenda(v3.id);
    expect(ok3.statusCode, ok3.body).toBe(200);
    expect(await decisoesDe("aprovacoes_venda", v3.id)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// X5-3
// ───────────────────────────────────────────────────────────────────────────────────────────────────
interface Previa { podeConfirmar: boolean; recusas?: Erro[]; itens: unknown[] }
async function lerPrevia(id: string): Promise<Previa> {
  const r: Resposta = await previaEstoque("entrada", id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as Previa;
}

describe("X5-3 — a prévia do estoque com a TOP no 5 (a linha mudada em estoque-confirmacao.ts)", () => {
  it("X5-3 entrada com TOP no 5 Sempre: a prévia traz `recusas` [APROVACAO_PENDENTE] e podeConfirmar false, e o /confirmar a MESMA recusa; aprovada, [] e confirma; premissa: no 3, a chave não existe", async () => {
    const top5 = await topNoFormato("estoque.entrada", cfg5(sempre));
    const p = await produto();
    const { id } = await estoqueLancado("entrada", [{ produto_id: p.id, quantidade: "3", custo_unitario: "2" }], { tipo_operacao_id: top5 });

    const pv = await lerPrevia(id);
    expect(pv.recusas).toEqual([pendente(null)]);
    expect(pv.podeConfirmar, "o falso é só da recusa: a entrada não tem saldo a faltar").toBe(false);
    expect(pv.itens).toHaveLength(1);
    const r = await confirmarEstoque("entrada", id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r), "a prévia diz o que a confirmação diria").toEqual(pv.recusas![0]);
    expect(await movimentosDe("documentos_estoque", id)).toEqual([]);

    // Aprovada: a lista fica VAZIA (a chave continua, como no 4) e a confirmação passa.
    const a = await aprovar("entrada", id, {});
    expect(a.statusCode, a.body).toBe(200);
    const pv2 = await lerPrevia(id);
    expect([pv2.recusas, pv2.podeConfirmar]).toEqual([[], true]);
    const ok = await confirmarEstoque("entrada", id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await situacaoNoBanco("documentos_estoque", id)).toBe("confirmado");
    expect((await movimentosDe("documentos_estoque", id)).map((m) => [m.movement_type, m.quantity])).toEqual([["entry", "3.0000"]]);

    // PREMISSA (o corte): a MESMA política no formato 3 — a prévia é a de hoje, SEM a chave `recusas`, e confirma.
    const top3 = await topNoFormato("estoque.entrada", cfg3(sempre));
    const doc3 = await estoqueLancado("entrada", [{ produto_id: p.id, quantidade: "1", custo_unitario: "2" }], { tipo_operacao_id: top3 });
    const pv3 = await lerPrevia(doc3.id);
    expect(pv3).not.toHaveProperty("recusas");
    expect(pv3.podeConfirmar).toBe(true);
    expect((await confirmarEstoque("entrada", doc3.id)).statusCode).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// X5-4
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("X5-4 — compra com a TOP no 5 Automática: confirma ao salvar", () => {
  it("X5-4 201 'confirmado' com {confirmado:true}; a entrada e a conta a pagar no banco; premissa: no 5 Manual, a compra fica aberta e sem efeito", async () => {
    const top5 = await topNoFormato("compras.compra", cfg5(automatica));
    const p = await produto();
    const r = await lancarCompra("compra", corpoCompra([itemCompra(p.id, "3", "10.00")], { tipo_operacao_id: top5 }));
    expect(r.statusCode, r.body).toBe(201);
    const b = j(r) as Record<string, unknown> & { id: string };
    expect([b.situacao, b.confirmacaoAutomatica, b.valor_total]).toEqual(["confirmado", { confirmado: true }, "30.00"]);
    expect(await situacaoNoBanco("documentos_compra", b.id)).toBe("confirmado");
    expect((await movimentosDe("documentos_compra", b.id)).map((m) => [m.movement_type, m.direction, Number(m.quantity)])).toEqual([["receipt", 1, 3]]);
    expect((await titulosDe("documentos_compra", b.id)).map((t) => [t.direction, t.amount])).toEqual([["payable", "30.00"]]);
    expect((await auditoriaDe("documentos_compra", b.id, "confirm")).filter((a) => a.metadata !== null).map((a) => a.metadata!.automatica)).toEqual([true]);
    expect(await saldo(p.id)).toBe("3.0000");

    // PREMISSA: a TOP no 5 Manual (o neutro) — a compra fica aberta, sem a chave, sem movimento e sem título.
    const manual = await topNoFormato("compras.compra", cfg5());
    const q = await produto();
    const rm = await lancarCompra("compra", corpoCompra([itemCompra(q.id, "3", "10.00")], { tipo_operacao_id: manual }));
    expect(rm.statusCode, rm.body).toBe(201);
    const bm = j(rm) as Record<string, unknown> & { id: string };
    expect(bm.situacao).toBe("aberto");
    expect(bm).not.toHaveProperty("confirmacaoAutomatica");
    expect(await movimentosDe("documentos_compra", bm.id)).toEqual([]);
    expect(await titulosDe("documentos_compra", bm.id)).toEqual([]);
  });
});
