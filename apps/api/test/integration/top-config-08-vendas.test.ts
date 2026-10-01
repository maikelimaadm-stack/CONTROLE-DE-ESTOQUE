import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { configuracaoNeutraTop, configuracaoNeutraTopV2, type ConfiguracaoTipoOperacaoV4 } from "@agro/domain";
import { MSG_DOCUMENTO_MUDOU } from "../../src/routes/vendas-edicao-patch.js";
import {
  c, iniciar, encerrar, j, erro, unico, cfg3, cfg4, top, versaoAtualNoBanco, versaoDireta, usuario, produto, produtoComSaldo, saldoInicial, saldo,
  itemVenda, corpoVenda, lancarVenda, vendaLancada, editarVenda, patchVenda, confirmarVenda, lerVenda, converterVenda, versaoDaVenda,
  movimentosDe, titulosDe, situacaoNoBanco, auditoriaDe, decisoesDe,
  type Resposta, type Erro, type Hdr, type ItemVenda,
} from "./top-config-08-ajuda.js";

/**
 * TOP-CONFIG-08 (decisão 277) — AS REGRAS GERAIS NA VENDA (SPEC §3 e §4; casos CA-1..CA-6, CA-9..CA-12, SI-1, SI-2, SI-4).
 *
 * A VENDA com a versão congelada da TOP no FORMATO 4: a confirmação automática no fim de cada caminho que grava (POST,
 * PUT, PATCH e a venda GERADA pela conversão, inteira e em partes), as recusas que deixam a venda salva e aberta com o
 * porquê (saldo, período, capacidade, aprovação), o corte do formato 3 (CA-9), a idempotência (CA-10), o corpo de hoje
 * sem a automática (CA-11), a barreira das travas (CA-12) e o documento sem itens (SI-1, SI-2, SI-4). A aprovação em si
 * (rotas, fila, decisões) é do `top-config-08-aprovacao.test.ts`; a compra e o estoque, dos arquivos deles.
 *
 * O QUE CONTA COMO PROVA (o molde da COMPRAS-01 e do ESTOQUE-01): nenhuma asserção decisiva é só status HTTP. A situação
 * da venda, a saída do estoque, o título a receber, a versão (0039), as decisões de aprovação e a trilha são LIDOS NO
 * BANCO pela testemunha (`c.admin`, superusuário sem RLS), pela origem. Toda asserção de "zero efeito" vem com a PREMISSA
 * ao lado: a MESMA venda, com o obstáculo tirado, confirma — senão "zero" poderia ser só um cenário que nunca confirmaria.
 *
 * "O CORPO DE HOJE" é literal: as chaves que o POST/PUT (`writeDoc`: `{ id, ...totais }`), a conversão e o /confirm
 * respondem na `origin/main` desta fatia, conferidas também contra um POST formato 3 vivo (CA-11a).
 *
 * A ORDEM NOVA DAS RECUSAS (SPEC §4, declarada): com TOP, os itens vazios são decididos DEPOIS de saber a TOP — a recusa
 * da empresa e a da TOP vêm antes no POST; a 404, o 409 da versão e o 409 da situação vêm antes na PATCH. Sem TOP, e no
 * orçamento e no pedido, a ordem é a de hoje (os itens vazios recusados na leitura do corpo). SI-2 prova as duas.
 */

beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── o corpo de hoje e as mensagens exatas ───────────────

/** As chaves do POST e do PUT da venda de hoje: o `writeDoc` devolve `{ id, ...documentTotals }`. */
const CHAVES_DO_POST = ["id", "subtotal", "total"];
/** As chaves da conversão de hoje (`/convert`). */
const CHAVES_DA_CONVERSAO = ["id", "kind", "from"];
/** As chaves do POST /confirm de hoje. */
const CHAVES_DO_CONFIRM = ["id", "status", "title_ids"];

/** A recusa de HOJE dos itens vazios da venda: o `docSchema` estrito, pelo plugin de erros (e o `edicaoSchema` na PATCH). */
const RECUSA_DOS_ITENS_VAZIOS: Erro = { code: "VALIDATION_ERROR", message: "items: Valor mínimo: 1", details: [{ path: "items", message: "Valor mínimo: 1" }] };
/** `createTitles`: a recusa de hoje do título a receber de valor zero. */
const RECUSA_DO_TITULO: Erro = { code: "VALIDATION_ERROR", message: "Valor do título deve ser positivo" };
/** O 40P01/40001 pelo `fromPgError`: o 409 de hoje. */
const RECUSA_DA_CONCORRENCIA: Erro = { code: "CONCURRENCY_CONFLICT", message: "Conflito de concorrência, tente novamente" };
const MSG_PENDENTE = "Este documento precisa de aprovação antes de ser confirmado.";

// ─────────────── as TOPs do caso ───────────────

/** O neutro do formato 4 com "Confirmação: Automática" (e o ajuste do caso). */
const automatica = (ajuste: (x: ConfiguracaoTipoOperacaoV4) => void = () => {}) => cfg4((x) => { x.geral.confirmacao = "automatica"; ajuste(x); });
/** O neutro do formato 4 com "Documento sem itens: Permitido" (e o ajuste do caso). */
const semItens = (ajuste: (x: ConfiguracaoTipoOperacaoV4) => void = () => {}) => cfg4((x) => { x.geral.documentoSemItens = "permitido"; ajuste(x); });
/** O que as TOPs de produção declaram no formato 3 (o corte): Automática, Sem itens Permitido, Alteração Permitida. */
const comoProducao = () => cfg3((x) => { x.geral.confirmacao = "automatica"; x.geral.documentoSemItens = "permitido"; x.geral.alteracaoAposConfirmacao = "permitida"; });

/**
 * Uma TOP NOVA da família (venda, por padrão) com a configuração dada, com a PREMISSA de que o banco guardou a versão no
 * formato pedido: um 4 que virasse 3 no caminho (ou um 1 promovido) mediria outro corte.
 */
async function topVenda(configuracao: { versaoSchema: number }, codigoBase = "vendas.venda"): Promise<string> {
  const id = await top(codigoBase, { configuracao });
  expect((await versaoAtualNoBanco(id)).configuracao_schema_version, "premissa: a versão congelada está no formato pedido").toBe(configuracao.versaoSchema);
  return id;
}

// ─────────────── leituras ───────────────

type Corpo = Record<string, unknown> & { id: string; confirmacaoAutomatica?: unknown };
type Automatica = { confirmado: boolean; motivo?: string; erro?: Erro };
const corpo = (r: Resposta) => j(r) as Corpo;
const automaticaDe = (b: Record<string, unknown>) => b.confirmacaoAutomatica as Automatica;
/** `v + n` na `version` (bigint em string). */
const mais = (v: string, n: number) => (BigInt(v) + BigInt(n)).toString();

/** O que a venda é NO BANCO: situação, movimentos, títulos e as auditorias "confirm". */
async function efeitos(id: string) {
  return {
    status: await situacaoNoBanco("sales_documents", id),
    movimentos: await movimentosDe("sales_documents", id),
    titulos: await titulosDe("sales_documents", id),
    confirmacoes: await auditoriaDe("sales_documents", id, "confirm"),
  };
}
/** O resumo de "nada aconteceu": situação, quantos movimentos, quantos títulos, quantas auditorias "confirm". */
async function semEfeito(id: string): Promise<[string | null, number, number, number]> {
  const e = await efeitos(id);
  return [e.status, e.movimentos.length, e.titulos.length, e.confirmacoes.length];
}
/**
 * A venda confirmada, lida no banco: UMA saída por item dado (`[produto, quantidade]`, no ALM), UM título a receber do
 * total e UMA auditoria "confirm". Devolve a auditoria, para quem quer medir o metadata.
 */
async function esperarConfirmada(id: string, p: { saidas: [string, string][]; total: string }) {
  const e = await efeitos(id);
  expect(e.status, "confirmada no banco").toBe("confirmed");
  expect(e.movimentos.map((m) => [m.movement_type, m.direction, Number(m.quantity), m.product_id, m.warehouse_id]))
    .toEqual(p.saidas.map(([produtoId, q]) => ["sale", -1, Number(q), produtoId, c.I.warehouse]));
  expect(e.titulos.map((t) => [t.direction, t.amount])).toEqual([["receivable", p.total]]);
  expect(e.confirmacoes, "uma confirmação = uma auditoria").toHaveLength(1);
  return e.confirmacoes[0]!;
}
/**
 * Só os EVENTOS que as rotas gravam (`audit()`): o gatilho genérico `erp.audit_row()` também escreve na trilha da
 * venda — um "create" no INSERT e um "update" em cada UPDATE, sem metadata e com a foto da linha (`before`/`after`) —,
 * e essas linhas contam LINHA, não evento. Quem precisa saber se um UPDATE sobreviveu mede a `version` (0039).
 */
const SO_EVENTOS_DA_ROTA = "not (metadata is null and (before is not null or after is not null))";
/** As ações dos eventos da venda, na ordem em que foram gravados. */
async function trilha(id: string): Promise<string[]> {
  return (await c.admin.query<{ action: string }>(
    `select action from erp.audit_logs where entity='sales_documents' and entity_id=$1 and ${SO_EVENTOS_DA_ROTA} order by id`, [id])).rows.map((x) => x.action);
}
/** O evento `action` da venda (exatamente um): a ordem de gravação (`id`) e quem o gravou — para provar o "no fim" e o autor. */
async function eventoDa(entityId: string, action: string): Promise<{ ordem: bigint; autor: string | null }> {
  const r = await c.admin.query<{ id: string; user_id: string | null }>(
    `select id::text, user_id from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action=$2 and ${SO_EVENTOS_DA_ROTA} order by id`, [entityId, action]);
  expect(r.rows, `premissa: um evento "${action}"`).toHaveLength(1);
  return { ordem: BigInt(r.rows[0]!.id), autor: r.rows[0]!.user_id };
}
/** Quantas vendas, orçamentos e pedidos a organização tem (o "nada nasceu" das recusas do POST). */
async function contarDocumentos(): Promise<number> {
  return Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.sales_documents where organization_id=$1", [c.h.demo.orgId])).rows[0]!.n);
}
/** Os itens do documento no banco, na ordem (o pedido, para montar a parte; a venda, para "sem itens"). */
async function itensNoBanco(id: string): Promise<{ id: string; quantity: string }[]> {
  return (await c.admin.query<{ id: string; quantity: string }>(
    "select id, quantity::text from erp.sales_document_items where document_id=$1 order by position, id", [id])).rows;
}
/** O total gravado no cabeçalho. */
async function totalNoBanco(id: string): Promise<string> {
  return (await c.admin.query<{ t: string }>("select total::text t from erp.sales_documents where id=$1", [id])).rows[0]!.t;
}

/**
 * O MÊS CONGELADO da 1ª empresa (`financial_freezes`, a porta de `assert_period_open`). Cada caso usa um mês só dele
 * (2025): o resto do arquivo lança em setembro de 2026 (e a conversão, hoje) e nunca esbarra no congelamento.
 */
async function congelar(ano: number, mes: number): Promise<() => Promise<void>> {
  const id = (await c.admin.query<{ id: string }>(
    "insert into erp.financial_freezes(organization_id, empresa_id, year, month, is_frozen) values ($1,$2,$3,$4,true) returning id",
    [c.h.demo.orgId, c.I.empresa, ano, mes])).rows[0]!.id;
  return async () => { await c.admin.query("update erp.financial_freezes set is_frozen=false where id=$1", [id]); };
}

// ─────────────── orçamento e pedido ───────────────

type Variante = "budgets" | "orders";
const lancarDaVariante = (variante: Variante, corpoDoc: Record<string, unknown>, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/sales/${variante}`, headers, payload: corpoDoc });
const patchDaVariante = (variante: Variante, id: string, corpoDoc: Record<string, unknown>): Promise<Resposta> =>
  c.ligada.inject({ method: "PATCH", url: `/api/sales/${variante}/${id}`, headers: c.h.headers(), payload: corpoDoc });

/**
 * O PEDIDO de venda com a aresta para a TOP de venda de destino (`emPartes` dado), e os itens dele lidos no banco.
 * A TOP do pedido é o neutro do formato 4 (o pedido só aceita Manual): a gerada segue a versão DELA, a de destino.
 */
async function pedidoPara(topVendaDestino: string, itens: ItemVenda[], emPartes: boolean) {
  const topPedido = await top("vendas.pedido", { configuracao: cfg4(), destinos: [{ tipoOperacaoId: topVendaDestino, ordem: 0, emPartes }] });
  const r = await lancarDaVariante("orders", corpoVenda(itens, { tipo_operacao_id: topPedido }));
  expect(r.statusCode, `premissa: o pedido é lançado — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  const linhas = await itensNoBanco(id);
  expect(linhas, "premissa: o pedido tem os itens do corpo").toHaveLength(itens.length);
  return { id, itens: linhas };
}
/** As vendas geradas do documento de origem (todas, inclusive canceladas), em ordem. */
async function vendasGeradas(origemId: string): Promise<string[]> {
  return (await c.admin.query<{ id: string }>("select id from erp.sales_documents where origin_document_id=$1 order by created_at, id", [origemId])).rows.map((x) => x.id);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// CA-1
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("CA-1 POST com TOP formato 4 Automática: confirma no fim, por quem salvou", () => {
  it("CA-1 201, {confirmado:true}, confirmed; estoque baixado e título no banco; auditoria 'confirm' com automatica:true por quem salvou, depois do 'create'; a manual de outra venda, sem a chave", async () => {
    const topAuto = await topVenda(automatica());
    const v = await versaoAtualNoBanco(topAuto);
    expect((v.configuracao.geral as Record<string, unknown>).confirmacao, "premissa: a versão congelada é Automática").toBe("automatica");
    // Quem salva é um membro com a capacidade da confirmação manual (sales.edit), não o administrador.
    const vendedor = await usuario("Vendedor CA1", ["sales.view", "sales.create", "sales.edit"]);
    const p = await produtoComSaldo("10");

    const r = await lancarVenda(corpoVenda([itemVenda(p.id, "3", "20.00")], { tipo_operacao_id: topAuto }), vendedor);
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    // O corpo de hoje + a chave nova (aditiva), e só ela.
    expect(Object.keys(b)).toEqual([...CHAVES_DO_POST, "confirmacaoAutomatica"]);
    expect(automaticaDe(b)).toEqual({ confirmado: true });
    // O EFEITO, no banco: a saída de 3 do ALM, o título a receber do total, uma auditoria "confirm".
    const confirm = await esperarConfirmada(b.id, { saidas: [[p.id, "3"]], total: "60.00" });
    expect(await saldo(p.id), "o estoque saiu UMA vez").toBe("7.0000");
    expect(confirm.metadata).toMatchObject({ automatica: true, tipoOperacaoVersaoId: v.id });
    // "No fim": a confirmação vem DEPOIS do "create", na mesma requisição. Quem confirmou é quem salvou.
    expect(await trilha(b.id)).toEqual(["create", "confirm"]);
    const create = await eventoDa(b.id, "create");
    expect(create.autor, "premissa: quem salvou é o vendedor, não o administrador").not.toBe(c.h.demo.adminUserId);
    expect(confirm.user_id, "quem confirma é quem salvou").toBe(create.autor);
    expect(await decisoesDe("aprovacoes_venda", b.id), "sem aprovação exigida, nenhuma decisão").toEqual([]);

    // A MANUAL, de outra venda, numa TOP formato 4 Manual com a MESMA execução: o /confirm de hoje, e o metadata dela
    // é o da automática sem a chave — mesmas chaves, mesma execução. A automática não é um segundo caminho.
    const topManual = await topVenda(cfg4());
    const outra = await vendaLancada(corpoVenda([itemVenda(p.id, "2", "20.00")], { tipo_operacao_id: topManual }), vendedor);
    expect(Object.keys(outra), "a TOP Manual responde o corpo de hoje").toEqual(CHAVES_DO_POST);
    const m = await confirmarVenda(outra.id, vendedor);
    expect(m.statusCode, m.body).toBe(200);
    expect(Object.keys(j(m))).toEqual(CHAVES_DO_CONFIRM);
    const manual = await esperarConfirmada(outra.id, { saidas: [[p.id, "2"]], total: "40.00" });
    expect(manual.metadata, "a confirmação manual não ganha a chave da automática").not.toHaveProperty("automatica");
    const { automatica: _automatica, ...semAChave } = confirm.metadata!;
    expect(Object.keys(semAChave), "o MESMO metadata da manual, chave por chave").toEqual(Object.keys(manual.metadata!));
    expect(semAChave.execucao).toEqual(manual.metadata!.execucao);
    expect(semAChave.classificacaoFinanceira).toEqual(manual.metadata!.classificacaoFinanceira);
    expect(await saldo(p.id)).toBe("5.0000");
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// CA-2
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("CA-2 a confirmação recusa: a venda fica SALVA e ABERTA, com o erro do /confirm, e nada de efeito", () => {
  it("CA-2a saldo insuficiente → 201, aberta, 'recusada' com o erro IGUAL ao do /confirm; nada de estoque nem título; com saldo, o /confirm manual confirma (a marca não ficou)", async () => {
    const topAuto = await topVenda(automatica());
    const p = await produto();
    const r = await lancarVenda(corpoVenda([itemVenda(p.id, "2", "10.00")], { tipo_operacao_id: topAuto }));
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect(Object.keys(b)).toEqual([...CHAVES_DO_POST, "confirmacaoAutomatica"]);
    const ca = automaticaDe(b);
    expect([ca.confirmado, ca.motivo, ca.erro?.code]).toEqual([false, "recusada", "INSUFFICIENT_STOCK"]);
    // SALVA (a linha e o "create" existem) e ABERTA, sem efeito: o savepoint desfez a tentativa inteira, inclusive o
    // UPDATE da situação (a `version` da 0039 não subiu).
    expect(await trilha(b.id)).toEqual(["create"]);
    expect(await semEfeito(b.id)).toEqual(["open", 0, 0, 0]);
    expect(await versaoDaVenda(b.id), "nenhum UPDATE sobreviveu ao savepoint").toBe("0");
    expect(await saldo(p.id)).toBe("0.0000");
    // O erro é o MESMO corpo que o POST /confirm dá à mesma venda.
    const manual = await confirmarVenda(b.id);
    expect(manual.statusCode, manual.body).toBe(409);
    expect(ca.erro).toEqual(erro(manual));
    expect(await semEfeito(b.id)).toEqual(["open", 0, 0, 0]);
    // PREMISSA: com o saldo, a MESMA venda confirma pelo /confirm manual — a recusa era o saldo, não o cenário; e a
    // auditoria da manual é a de hoje, sem a chave.
    await saldoInicial(p.id, "5");
    const ok = await confirmarVenda(b.id);
    expect(ok.statusCode, ok.body).toBe(200);
    const confirm = await esperarConfirmada(b.id, { saidas: [[p.id, "2"]], total: "20.00" });
    expect(confirm.metadata).not.toHaveProperty("automatica");
    expect(await saldo(p.id)).toBe("3.0000");
  });

  it("CA-2b período fechado → 201, aberta, 'recusada' com o erro IGUAL ao do /confirm (PERIOD_FROZEN); nada de estoque nem título; descongelado, o /confirm manual confirma", async () => {
    const topAuto = await topVenda(automatica());
    const p = await produtoComSaldo("10");
    const descongelar = await congelar(2025, 3);
    const r = await lancarVenda(corpoVenda([itemVenda(p.id, "4", "10.00")], { tipo_operacao_id: topAuto, document_date: "2025-03-12" }));
    expect(r.statusCode, r.body).toBe(201);
    const ca = automaticaDe(corpo(r));
    const id = corpo(r).id;
    expect([ca.confirmado, ca.motivo, ca.erro?.code]).toEqual([false, "recusada", "PERIOD_FROZEN"]);
    expect(await trilha(id)).toEqual(["create"]);
    expect(await semEfeito(id)).toEqual(["open", 0, 0, 0]);
    expect(await saldo(p.id), "o estoque não se mexe").toBe("10.0000");
    const manual = await confirmarVenda(id);
    expect(manual.statusCode, manual.body).toBe(409);
    expect(ca.erro).toEqual(erro(manual));
    // PREMISSA: com o mês aberto, a MESMA venda confirma — a recusa era o período.
    await descongelar();
    const ok = await confirmarVenda(id);
    expect(ok.statusCode, ok.body).toBe(200);
    await esperarConfirmada(id, { saidas: [[p.id, "4"]], total: "40.00" });
    expect(await saldo(p.id)).toBe("6.0000");
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// CA-3, CA-4
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("CA-3 e CA-4 a TOP não dá poder, e a aprovação vem antes", () => {
  it("CA-3 quem salva sem sales.edit → 201, aberta, 'sem_permissao' (nada tentado); o /confirm dele é 403; quem tem a capacidade confirma a MESMA venda", async () => {
    const topAuto = await topVenda(automatica());
    const vendedor = await usuario("Vendedor sem edit CA3", ["sales.view", "sales.create"]);
    const p = await produtoComSaldo("10");
    const r = await lancarVenda(corpoVenda([itemVenda(p.id, "1", "15.00")], { tipo_operacao_id: topAuto }), vendedor);
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect(Object.keys(b)).toEqual([...CHAVES_DO_POST, "confirmacaoAutomatica"]);
    expect(automaticaDe(b)).toEqual({ confirmado: false, motivo: "sem_permissao" });
    expect(await trilha(b.id)).toEqual(["create"]);
    expect(await semEfeito(b.id)).toEqual(["open", 0, 0, 0]);
    expect(await saldo(p.id)).toBe("10.0000");
    // A capacidade é a da manual: ele também não confirma pela porta de hoje.
    expect((await confirmarVenda(b.id, vendedor)).statusCode).toBe(403);
    expect(await semEfeito(b.id)).toEqual(["open", 0, 0, 0]);
    // PREMISSA: a venda é confirmável — quem tem sales.edit a confirma.
    const ok = await confirmarVenda(b.id);
    expect(ok.statusCode, ok.body).toBe(200);
    await esperarConfirmada(b.id, { saidas: [[p.id, "1"]], total: "15.00" });
  });

  it("CA-4 aprovação exigida (Sempre; A partir de 1500.00 com total 1500.00) → 201, aberta, 'aguardando_aprovacao', sem decisão; o /confirm dá APROVACAO_PENDENTE; 1499.99 não exige e confirma", async () => {
    const p = await produtoComSaldo("10");
    const casos: { nome: string; topId: string; preco: string }[] = [
      { nome: "Sempre", topId: await topVenda(automatica((x) => { x.aprovacao.politica = "sempre"; })), preco: "10.00" },
      { nome: "A partir de 1500.00, total 1500.00", topId: await topVenda(automatica((x) => { x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = "1500.00"; })), preco: "1500.00" },
    ];
    for (const caso of casos) {
      const r = await lancarVenda(corpoVenda([itemVenda(p.id, "1", caso.preco)], { tipo_operacao_id: caso.topId }));
      expect(r.statusCode, `${caso.nome}: ${r.body}`).toBe(201);
      const b = corpo(r);
      expect(automaticaDe(b), caso.nome).toEqual({ confirmado: false, motivo: "aguardando_aprovacao" });
      expect(await trilha(b.id), caso.nome).toEqual(["create"]);
      expect(await semEfeito(b.id), caso.nome).toEqual(["open", 0, 0, 0]);
      expect(await decisoesDe("aprovacoes_venda", b.id), `${caso.nome}: a confirmação não decide nada`).toEqual([]);
      // O porquê é a aprovação: a porta manual recusa pelo MESMO passo.
      const manual = await confirmarVenda(b.id);
      expect(manual.statusCode, manual.body).toBe(409);
      expect([erro(manual).code, erro(manual).message]).toEqual(["APROVACAO_PENDENTE", MSG_PENDENTE]);
    }
    expect(await saldo(p.id), "nada saiu").toBe("10.0000");
    // PREMISSA: abaixo do limite a MESMA TOP não exige, e a automática confirma — o "aguardando" era a aprovação.
    const abaixo = await lancarVenda(corpoVenda([itemVenda(p.id, "1", "1499.99")], { tipo_operacao_id: casos[1]!.topId }));
    expect(abaixo.statusCode, abaixo.body).toBe(201);
    expect(automaticaDe(corpo(abaixo))).toEqual({ confirmado: true });
    await esperarConfirmada(corpo(abaixo).id, { saidas: [[p.id, "1"]], total: "1499.99" });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// CA-5
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("CA-5 conversão pedido → venda automática: a GERADA confirma pela versão DELA, no fim", () => {
  it("CA-5a inteira → 201, a gerada confirmada (saída e título), o pedido convertido; a confirmação depois do 'convert' e do 'create'", async () => {
    const topAuto = await topVenda(automatica());
    const p = await produtoComSaldo("10");
    const pedido = await pedidoPara(topAuto, [itemVenda(p.id, "4", "10.00")], false);
    const r = await converterVenda("orders", pedido.id, { tipo_operacao_id: topAuto });
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect(Object.keys(b)).toEqual([...CHAVES_DA_CONVERSAO, "confirmacaoAutomatica"]);
    expect([b.kind, b.from]).toEqual(["sale", pedido.id]);
    expect(automaticaDe(b)).toEqual({ confirmado: true });
    expect(await vendasGeradas(pedido.id)).toEqual([b.id]);
    expect(await situacaoNoBanco("sales_documents", pedido.id)).toBe("converted");
    const confirm = await esperarConfirmada(b.id, { saidas: [[p.id, "4"]], total: "40.00" });
    expect(confirm.metadata).toMatchObject({ automatica: true });
    // A versão que valeu é a da TOP de DESTINO, congelada na gerada (o pedido é formato 4 Manual).
    expect(confirm.metadata!.tipoOperacaoVersaoId).toBe((await versaoAtualNoBanco(topAuto)).id);
    // "No fim": depois de a origem ficar convertida (a auditoria "convert") e do "create" da gerada.
    const { ordem: confirmou } = await eventoDa(b.id, "confirm");
    expect(confirmou > (await eventoDa(pedido.id, "convert")).ordem).toBe(true);
    expect(confirmou > (await eventoDa(b.id, "create")).ordem).toBe(true);
    expect(await saldo(p.id)).toBe("6.0000");
  });

  it("CA-5b em partes: cada parte gerada confirma; a parte que recusa (sem saldo) fica aberta e a origem segue como hoje; a que zera o saldo converte o pedido", async () => {
    const topAuto = await topVenda(automatica());
    const p = await produto();
    const pedido = await pedidoPara(topAuto, [itemVenda(p.id, "5", "10.00")], true);
    const itemId = pedido.itens[0]!.id;
    // 1ª parte, SEM saldo: a gerada fica salva e aberta com o porquê; a origem continua aberta (ainda tem saldo).
    const r1 = await converterVenda("orders", pedido.id, { tipo_operacao_id: topAuto, itens: [{ item_id: itemId, quantidade: "2" }] });
    expect(r1.statusCode, r1.body).toBe(201);
    const b1 = corpo(r1);
    expect(Object.keys(b1)).toEqual([...CHAVES_DA_CONVERSAO, "confirmacaoAutomatica"]);
    const ca1 = automaticaDe(b1);
    expect([ca1.confirmado, ca1.motivo, ca1.erro?.code]).toEqual([false, "recusada", "INSUFFICIENT_STOCK"]);
    expect(await semEfeito(b1.id)).toEqual(["open", 0, 0, 0]);
    expect((await itensNoBanco(b1.id)).map((i) => i.quantity), "a parte foi gravada como hoje").toEqual(["2.0000"]);
    expect(await situacaoNoBanco("sales_documents", pedido.id)).toBe("open");
    const manual = await confirmarVenda(b1.id);
    expect(ca1.erro).toEqual(erro(manual));
    // 2ª parte, COM saldo, zerando o saldo do pedido: a gerada confirma e o pedido vira convertido.
    await saldoInicial(p.id, "10");
    const r2 = await converterVenda("orders", pedido.id, { tipo_operacao_id: topAuto, itens: [{ item_id: itemId, quantidade: "3" }] });
    expect(r2.statusCode, r2.body).toBe(201);
    const b2 = corpo(r2);
    expect(automaticaDe(b2)).toEqual({ confirmado: true });
    await esperarConfirmada(b2.id, { saidas: [[p.id, "3"]], total: "30.00" });
    expect(await situacaoNoBanco("sales_documents", pedido.id)).toBe("converted");
    expect(await vendasGeradas(pedido.id)).toEqual([b1.id, b2.id]);
    // PREMISSA da 1ª: com saldo, a MESMA parte confirma pela porta manual.
    expect((await confirmarVenda(b1.id)).statusCode).toBe(200);
    await esperarConfirmada(b1.id, { saidas: [[p.id, "2"]], total: "20.00" });
    expect(await saldo(p.id)).toBe("5.0000");
  });

  it("CA-5c inteira, sem saldo → a gerada salva e ABERTA, 'recusada' (erro igual ao do /confirm); o pedido convertido como hoje; com saldo, a gerada confirma", async () => {
    const topAuto = await topVenda(automatica());
    const p = await produto();
    const pedido = await pedidoPara(topAuto, [itemVenda(p.id, "2", "10.00")], false);
    const r = await converterVenda("orders", pedido.id, { tipo_operacao_id: topAuto });
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    const ca = automaticaDe(b);
    expect([ca.confirmado, ca.motivo, ca.erro?.code]).toEqual([false, "recusada", "INSUFFICIENT_STOCK"]);
    // A conversão ficou inteira: a gerada existe, ligada ao pedido, e o pedido virou convertido, com o "convert".
    expect(await vendasGeradas(pedido.id)).toEqual([b.id]);
    expect(await situacaoNoBanco("sales_documents", pedido.id)).toBe("converted");
    expect(await auditoriaDe("sales_documents", pedido.id, "convert")).toHaveLength(1);
    expect(await semEfeito(b.id)).toEqual(["open", 0, 0, 0]);
    const manual = await confirmarVenda(b.id);
    expect(manual.statusCode, manual.body).toBe(409);
    expect(ca.erro).toEqual(erro(manual));
    await saldoInicial(p.id, "5");
    expect((await confirmarVenda(b.id)).statusCode).toBe(200);
    await esperarConfirmada(b.id, { saidas: [[p.id, "2"]], total: "20.00" });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// CA-6
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("CA-6 PUT e PATCH de venda aberta automática confirmam no fim", () => {
  it("CA-6a PUT → 200, o corpo de hoje + {confirmado:true}, confirmada depois do 'update'; o reenvio → o 409 INVALID_STATUS_TRANSITION de hoje; PUT que troca para a TOP Automática confirma pela versão da TOP nova", async () => {
    const topAuto = await topVenda(automatica());
    const p = await produto();
    const base = corpoVenda([itemVenda(p.id, "2", "10.00")], { tipo_operacao_id: topAuto });
    const v = await vendaLancada(base);
    expect(automaticaDe(v).motivo, "premissa: sem saldo, a venda automática nasce salva e aberta").toBe("recusada");
    await saldoInicial(p.id, "10");

    const r = await editarVenda(v.id, { ...base, note: "editada" });
    expect(r.statusCode, r.body).toBe(200);
    const b = corpo(r);
    expect(Object.keys(b)).toEqual([...CHAVES_DO_POST, "confirmacaoAutomatica"]);
    expect(b.id).toBe(v.id);
    expect(automaticaDe(b)).toEqual({ confirmado: true });
    const confirm = await esperarConfirmada(v.id, { saidas: [[p.id, "2"]], total: "20.00" });
    expect(confirm.metadata).toMatchObject({ automatica: true });
    expect((await trilha(v.id)).slice(-2), "no fim: depois do 'update' do PUT").toEqual(["update", "confirm"]);
    // O PUT não tem chave de idempotência: o reenvio encontra a venda confirmada e recebe o 409 de hoje.
    const reenvio = await editarVenda(v.id, { ...base, note: "editada" });
    expect(reenvio.statusCode, reenvio.body).toBe(409);
    expect(erro(reenvio).code).toBe("INVALID_STATUS_TRANSITION");
    expect((await efeitos(v.id)).confirmacoes, "nada confirma duas vezes").toHaveLength(1);
    expect(await saldo(p.id)).toBe("8.0000");

    // A VERSÃO QUE VALE DEPOIS DO PUT: venda aberta numa TOP Manual; o PUT troca para a Automática → confirma.
    const topManual = await topVenda(cfg4());
    const baseManual = corpoVenda([itemVenda(p.id, "1", "30.00")], { tipo_operacao_id: topManual });
    const m = await vendaLancada(baseManual);
    expect(Object.keys(m), "premissa: a TOP Manual não tem a chave").toEqual(CHAVES_DO_POST);
    expect(await semEfeito(m.id)).toEqual(["open", 0, 0, 0]);
    const troca = await editarVenda(m.id, { ...baseManual, tipo_operacao_id: topAuto });
    expect(troca.statusCode, troca.body).toBe(200);
    expect(automaticaDe(corpo(troca))).toEqual({ confirmado: true });
    const confirmTroca = await esperarConfirmada(m.id, { saidas: [[p.id, "1"]], total: "30.00" });
    expect(confirmTroca.metadata!.tipoOperacaoVersaoId).toBe((await versaoAtualNoBanco(topAuto)).id);
  });

  it("CA-6b PATCH: a que grava confirma no fim e responde o documento RELIDO (version +1 sobre a da PATCH); version velha → 409 antes de tudo; sem mudança → sem a chave", async () => {
    const topAuto = await topVenda(automatica());
    const p = await produto();
    const v = await vendaLancada(corpoVenda([itemVenda(p.id, "2", "10.00")], { tipo_operacao_id: topAuto, note: "original" }));
    expect(automaticaDe(v).motivo, "premissa: sem saldo, a venda nasce salva e aberta").toBe("recusada");
    const v0 = await versaoDaVenda(v.id);

    // 1. A PATCH que grava, ainda sem saldo: a automática recusa, e a resposta é o documento gravado (o `depois`), com o porquê.
    const r1 = await patchVenda(v.id, { version: v0, note: "primeira" });
    expect(r1.statusCode, r1.body).toBe(200);
    const { confirmacaoAutomatica: ca1, ...doc1 } = corpo(r1);
    expect(ca1).toMatchObject({ confirmado: false, motivo: "recusada", erro: { code: "INSUFFICIENT_STOCK" } });
    expect(doc1, "a resposta é o documento como o GET o devolve").toEqual(j(await lerVenda(v.id)));
    expect([doc1.status, doc1.note, String(doc1.version)]).toEqual(["open", "primeira", mais(v0, 1)]);
    expect(await semEfeito(v.id)).toEqual(["open", 0, 0, 0]);

    await saldoInicial(p.id, "10");
    // 2. version VELHA → o 409 de hoje ANTES de tudo: nem grava nem confirma, mesmo com o saldo que agora confirmaria.
    const velha = await patchVenda(v.id, { version: v0, note: "velha" });
    expect(velha.statusCode, velha.body).toBe(409);
    expect(erro(velha)).toEqual({ code: "CONCURRENCY_CONFLICT", message: MSG_DOCUMENTO_MUDOU });
    expect(await versaoDaVenda(v.id)).toBe(mais(v0, 1));
    expect(await semEfeito(v.id)).toEqual(["open", 0, 0, 0]);
    // 3. SEM MUDANÇA (a observação gravada) → 200 com o GET, SEM a chave: não grava e não confirma.
    const igual = await patchVenda(v.id, { version: mais(v0, 1), note: "primeira" });
    expect(igual.statusCode, igual.body).toBe(200);
    expect(corpo(igual)).not.toHaveProperty("confirmacaoAutomatica");
    expect(j(igual)).toEqual(j(await lerVenda(v.id)));
    expect(await versaoDaVenda(v.id), "nada gravado").toBe(mais(v0, 1));
    expect(await semEfeito(v.id)).toEqual(["open", 0, 0, 0]);
    // 4. A PATCH que grava, com saldo → confirma no fim, e a resposta é o documento RELIDO: confirmado, e a `version`
    // da 0039 com o +1 da confirmação (+1 da PATCH, +1 do UPDATE da situação).
    const r2 = await patchVenda(v.id, { version: mais(v0, 1), note: "segunda" });
    expect(r2.statusCode, r2.body).toBe(200);
    const { confirmacaoAutomatica: ca2, ...doc2 } = corpo(r2);
    expect(ca2).toEqual({ confirmado: true });
    expect(doc2, "relido DEPOIS da confirmação").toEqual(j(await lerVenda(v.id)));
    expect([doc2.status, doc2.note, String(doc2.version)]).toEqual(["confirmed", "segunda", mais(v0, 3)]);
    expect(await versaoDaVenda(v.id)).toBe(mais(v0, 3));
    const confirm = await esperarConfirmada(v.id, { saidas: [[p.id, "2"]], total: "20.00" });
    expect(confirm.metadata).toMatchObject({ automatica: true });
    expect((await trilha(v.id)).slice(-2)).toEqual(["update", "confirm"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// CA-9
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("CA-9 o corte: versão no formato 3 com 'automatica' gravado (como produção) NÃO confirma", () => {
  it("CA-9 POST, PUT, PATCH e conversão com a TOP formato 3 'Automática' → o corpo de hoje, sem a chave, e a venda aberta; o /confirm manual a confirma", async () => {
    const topF3 = await topVenda(comoProducao());
    const v3 = await versaoAtualNoBanco(topF3);
    expect((v3.configuracao.geral as Record<string, unknown>).confirmacao, "premissa: o formato 3 GUARDA 'automatica'").toBe("automatica");
    const p = await produtoComSaldo("20");
    const base = corpoVenda([itemVenda(p.id, "1", "10.00")], { tipo_operacao_id: topF3 });

    const r = await lancarVenda(base);
    expect(r.statusCode, r.body).toBe(201);
    const id = corpo(r).id;
    expect(Object.keys(corpo(r)), "POST").toEqual(CHAVES_DO_POST);
    expect(await semEfeito(id)).toEqual(["open", 0, 0, 0]);
    const put = await editarVenda(id, { ...base, note: "put" });
    expect(put.statusCode, put.body).toBe(200);
    expect(Object.keys(corpo(put)), "PUT").toEqual(CHAVES_DO_POST);
    const patch = await patchVenda(id, { version: await versaoDaVenda(id), note: "patch" });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(corpo(patch), "PATCH").not.toHaveProperty("confirmacaoAutomatica");
    expect(j(patch)).toEqual(j(await lerVenda(id)));
    expect(await semEfeito(id), "nenhum caminho confirmou").toEqual(["open", 0, 0, 0]);
    // A conversão para a TOP formato 3: a gerada nasce aberta, e o corpo é o de hoje.
    const pedido = await pedidoPara(topF3, [itemVenda(p.id, "1", "10.00")], false);
    const conv = await converterVenda("orders", pedido.id, { tipo_operacao_id: topF3 });
    expect(conv.statusCode, conv.body).toBe(201);
    expect(Object.keys(corpo(conv)), "conversão").toEqual(CHAVES_DA_CONVERSAO);
    expect(await semEfeito(corpo(conv).id)).toEqual(["open", 0, 0, 0]);
    expect(await saldo(p.id), "nada saiu").toBe("20.0000");
    // PREMISSA: as vendas são confirmáveis — a manual as confirma; o que faltou foi só o formato 4.
    for (const venda of [id, corpo(conv).id]) {
      expect((await confirmarVenda(venda)).statusCode).toBe(200);
      await esperarConfirmada(venda, { saidas: [[p.id, "1"]], total: "10.00" });
    }
  });

  it("CA-9b a versão formato 3 'Automática' gravada DIRETO NO BANCO (sem passar pela porta administrativa) → POST e PATCH não confirmam; o /confirm manual confirma", async () => {
    // O corte medido SÓ na execução: a versão não nasce pelo cadastro da TOP, então a recusa (ou o aceite) dela
    // ali não entra na conta. Se a execução decidir pelo número do formato por conta própria, em vez do predicado
    // único do domínio, ou se o predicado abrir para o formato 3, a venda confirma e este caso fica vermelho.
    const topId = await topVenda(cfg4());
    await versaoDireta(topId, comoProducao());
    const v3 = await versaoAtualNoBanco(topId);
    expect([v3.configuracao_schema_version, (v3.configuracao.geral as Record<string, unknown>).confirmacao], "premissa: a corrente é a formato 3 'Automática'")
      .toEqual([3, "automatica"]);
    const p = await produtoComSaldo("20");
    const base = corpoVenda([itemVenda(p.id, "1", "10.00")], { tipo_operacao_id: topId });

    const r = await lancarVenda(base);
    expect(r.statusCode, r.body).toBe(201);
    const id = corpo(r).id;
    expect(Object.keys(corpo(r)), "POST: o corpo de hoje").toEqual(CHAVES_DO_POST);
    const patch = await patchVenda(id, { version: await versaoDaVenda(id), note: "patch" });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(corpo(patch), "PATCH").not.toHaveProperty("confirmacaoAutomatica");
    expect(await semEfeito(id), "nenhum caminho confirmou").toEqual(["open", 0, 0, 0]);
    expect(await saldo(p.id), "nada saiu").toBe("20.0000");
    // PREMISSA: a venda é confirmável — a manual a confirma.
    expect((await confirmarVenda(id)).statusCode).toBe(200);
    await esperarConfirmada(id, { saidas: [[p.id, "1"]], total: "10.00" });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// CA-10
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("CA-10 idempotência: a mesma chave devolve o MESMO corpo, com o resultado, e nunca confirma duas vezes", () => {
  it("CA-10a POST: o replay devolve o corpo gravado (com {confirmado:true}); uma venda, uma saída, um título, uma confirmação", async () => {
    const topAuto = await topVenda(automatica());
    const p = await produtoComSaldo("10");
    const base = corpoVenda([itemVenda(p.id, "2", "10.00")], { tipo_operacao_id: topAuto });
    const chave = `tc08-ca10-post-${unico()}`;
    const antes = await contarDocumentos();
    const r1 = await lancarVenda(base, c.h.headers(), chave);
    expect(r1.statusCode, r1.body).toBe(201);
    expect(automaticaDe(corpo(r1))).toEqual({ confirmado: true });
    const r2 = await lancarVenda(base, c.h.headers(), chave);
    expect(r2.statusCode, r2.body).toBe(201);
    expect(j(r2), "o replay é a resposta GRAVADA").toEqual(j(r1));
    expect(await contarDocumentos(), "uma venda só").toBe(antes + 1);
    await esperarConfirmada(corpo(r1).id, { saidas: [[p.id, "2"]], total: "20.00" });
    expect(await saldo(p.id), "o estoque saiu UMA vez").toBe("8.0000");
  });

  it("CA-10b PATCH: o replay devolve o documento gravado (confirmado, com a chave); a versão não sobe de novo; uma confirmação", async () => {
    const topAuto = await topVenda(automatica());
    const p = await produto();
    const v = await vendaLancada(corpoVenda([itemVenda(p.id, "1", "10.00")], { tipo_operacao_id: topAuto }));
    expect(automaticaDe(v).motivo, "premissa: nasce aberta (sem saldo)").toBe("recusada");
    await saldoInicial(p.id, "10");
    const pedidoPatch = { version: await versaoDaVenda(v.id), note: "com chave" };
    const chave = `tc08-ca10-patch-${unico()}`;
    const r1 = await patchVenda(v.id, pedidoPatch, c.h.headers(), chave);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(automaticaDe(corpo(r1))).toEqual({ confirmado: true });
    const versaoDepois = await versaoDaVenda(v.id);
    const r2 = await patchVenda(v.id, pedidoPatch, c.h.headers(), chave);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(r2)).toEqual(j(r1));
    expect(await versaoDaVenda(v.id), "o replay não grava").toBe(versaoDepois);
    await esperarConfirmada(v.id, { saidas: [[p.id, "1"]], total: "10.00" });
    expect(await saldo(p.id)).toBe("9.0000");
  });

  it("CA-10c conversão: o replay devolve o corpo gravado; uma gerada, uma confirmação", async () => {
    const topAuto = await topVenda(automatica());
    const p = await produtoComSaldo("10");
    const pedido = await pedidoPara(topAuto, [itemVenda(p.id, "3", "10.00")], false);
    const chave = `tc08-ca10-conv-${unico()}`;
    const r1 = await converterVenda("orders", pedido.id, { tipo_operacao_id: topAuto }, c.h.headers(), chave);
    expect(r1.statusCode, r1.body).toBe(201);
    expect(automaticaDe(corpo(r1))).toEqual({ confirmado: true });
    const r2 = await converterVenda("orders", pedido.id, { tipo_operacao_id: topAuto }, c.h.headers(), chave);
    expect(r2.statusCode, r2.body).toBe(201);
    expect(j(r2)).toEqual(j(r1));
    expect(await vendasGeradas(pedido.id), "uma gerada só").toEqual([corpo(r1).id]);
    await esperarConfirmada(corpo(r1).id, { saidas: [[p.id, "3"]], total: "30.00" });
    expect(await saldo(p.id)).toBe("7.0000");
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// CA-11
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("CA-11 formato 1 a 3, ou Manual: a resposta não tem confirmacaoAutomatica — o corpo é o de hoje, chave por chave", () => {
  it("CA-11a POST: sem TOP, formato 1, 2, 3 (o neutro e o de produção) e 4 Manual (inclusive com outra regra fora do neutro) → as chaves e os valores do POST formato 3", async () => {
    const p = await produtoComSaldo("50");
    const itens = [itemVenda(p.id, "2", "12.50")];
    const lancado = async (topId: string | null) => {
      const r = await lancarVenda(corpoVenda(itens, topId ? { tipo_operacao_id: topId } : {}));
      expect(r.statusCode, r.body).toBe(201);
      return corpo(r);
    };
    const { id: id3, ...valores3 } = await lancado(await topVenda(cfg3()));
    expect(["id", ...Object.keys(valores3)], "premissa: o formato 3 responde o corpo de hoje").toEqual(CHAVES_DO_POST);
    expect(await semEfeito(id3)).toEqual(["open", 0, 0, 0]);
    const casos: [string, string | null][] = [
      ["sem TOP", null],
      ["formato 1", await topVenda(configuracaoNeutraTop())],
      ["formato 2", await topVenda(configuracaoNeutraTopV2())],
      ["formato 3 de produção", await topVenda(comoProducao())],
      ["formato 4 Manual", await topVenda(cfg4())],
      ["formato 4 Manual, sem itens Permitido e aprovação acima do total", await topVenda(semItens((x) => { x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = "99999.00"; }))],
    ];
    for (const [nome, topId] of casos) {
      const { id, ...valores } = await lancado(topId);
      expect(["id", ...Object.keys(valores)], nome).toEqual(CHAVES_DO_POST);
      expect(valores, `${nome}: os mesmos valores`).toEqual(valores3);
      expect(await semEfeito(id), nome).toEqual(["open", 0, 0, 0]);
    }
  });

  it("CA-11b PUT, PATCH e conversão com a TOP formato 4 Manual → o corpo de hoje (o do formato 3), e nada confirma", async () => {
    const p = await produtoComSaldo("20");
    for (const [nome, configuracao] of [["formato 3", cfg3()], ["formato 4 Manual", cfg4()]] as const) {
      const topId = await topVenda(configuracao);
      const base = corpoVenda([itemVenda(p.id, "1", "10.00")], { tipo_operacao_id: topId });
      const v = await vendaLancada(base);
      const put = await editarVenda(v.id, { ...base, note: "put" });
      expect(put.statusCode, `${nome}: ${put.body}`).toBe(200);
      expect(Object.keys(corpo(put)), `${nome}: PUT`).toEqual(CHAVES_DO_POST);
      const patch = await patchVenda(v.id, { version: await versaoDaVenda(v.id), note: "patch" });
      expect(patch.statusCode, `${nome}: ${patch.body}`).toBe(200);
      expect(j(patch), `${nome}: PATCH = o GET, sem a chave`).toEqual(j(await lerVenda(v.id)));
      expect(corpo(patch)).not.toHaveProperty("confirmacaoAutomatica");
      expect(await semEfeito(v.id), nome).toEqual(["open", 0, 0, 0]);
      const pedido = await pedidoPara(topId, [itemVenda(p.id, "1", "10.00")], false);
      const conv = await converterVenda("orders", pedido.id, { tipo_operacao_id: topId });
      expect(conv.statusCode, `${nome}: ${conv.body}`).toBe(201);
      expect(Object.keys(corpo(conv)), `${nome}: conversão`).toEqual(CHAVES_DA_CONVERSAO);
      expect(await semEfeito(corpo(conv).id), nome).toEqual(["open", 0, 0, 0]);
    }
    expect(await saldo(p.id)).toBe("20.0000");
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// CA-12
// ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Quantas transações DESTE banco (o do agente; nenhum outro processo o usa) estão esperando trava agora. */
async function esperandoTrava(): Promise<number> {
  return Number((await c.admin.query<{ n: string }>(
    "select count(*)::text n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and state = 'active'")).rows[0]!.n);
}
/** Espera (sondando) até `n` transações esperarem trava, por no máximo 15 s. Devolve a última contagem. */
async function ateEsperarem(n: number): Promise<number> {
  const limite = Date.now() + 15_000;
  let esperando = await esperandoTrava();
  while (esperando < n && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 25));
    esperando = await esperandoTrava();
  }
  return esperando;
}
/** A promessa, ou a falha se ela não terminar em `ms` — "ninguém trava para sempre" com prazo CURTO, sem inflar o do teste. */
async function semPendurar<T>(p: Promise<T>, ms: number): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, rejeitar) => { relogio = setTimeout(() => rejeitar(new Error(`uma das requisições ficou pendurada por mais de ${ms} ms`)), ms); });
  try { return await Promise.race([p, prazo]); } finally { clearTimeout(relogio); }
}

/**
 * DUAS REQUISIÇÕES EM PARALELO DE VERDADE, EM ORDEM DE CHEGADA CONTROLADA (o molde de `emParaleloComBarreira` da
 * ajuda, com a ordem fixada).
 *
 * Uma conexão própria (superusuário) segura a linha `sqlTrava`. A `primeira` é disparada e SÓ DEPOIS de ela estar
 * esperando trava no banco a `segunda` é disparada; a barreira cai quando as duas esperam. A fila de uma linha no
 * Postgres é por ordem de chegada (a trava pesada da tupla), então quem pega a linha quando a barreira cai é a
 * `primeira` — é isso que torna o CICLO determinístico, e não a sorte do escalonador. Quem o Postgres escolhe como
 * vítima do 40P01 é decidido pelo detector (o primeiro `deadlock_timeout` que vence): por isso os casos aceitam as
 * duas vítimas e exigem que haja EXATAMENTE uma.
 */
async function emOrdemComBarreira(sqlTrava: string, params: unknown[], primeira: () => Promise<Resposta>, segunda: () => Promise<Resposta>):
  Promise<{ respostas: [Resposta, Resposta]; esperando: [number, number] }> {
  const barreira = await c.admin.connect();
  try {
    await barreira.query("begin");
    const travou = await barreira.query(sqlTrava, params);
    expect(travou.rowCount, "premissa: a barreira travou a linha").toBe(1);
    const pa = primeira();
    const e1 = await ateEsperarem(1);
    const pb = segunda();
    const e2 = await ateEsperarem(2);
    await barreira.query("rollback");
    const respostas = await semPendurar(Promise.all([pa, pb]), 20_000);
    return { respostas, esperando: [e1, e2] };
  } finally {
    // Se algo falhou antes de soltar, a barreira não pode ficar segurando as requisições (nem voltar ao pool aberta).
    await barreira.query("rollback").catch(() => undefined);
    barreira.release();
  }
}

describe("CA-12 barreira: POST de venda automática × confirmação manual de outra venda do MESMO produto", () => {
  /**
   * O CENÁRIO DO CICLO (SPEC §3, TRAVAS): a manual trava documento → linha de saldo (`postStock`) → contador do ID
   * Global (`createTitles`); o POST pega o contador no `writeDoc` e só depois, na automática, a linha de saldo. Cada um
   * segura o que o outro pede. A manual é de uma venda SEM TOP (a de sempre), do MESMO produto e armazém.
   */
  async function cenario() {
    const topAuto = await topVenda(automatica());
    const p = await produtoComSaldo("20");
    const outra = await vendaLancada(corpoVenda([itemVenda(p.id, "1", "10.00")]));
    expect(await semEfeito(outra.id), "premissa: a outra venda está aberta").toEqual(["open", 0, 0, 0]);
    return { p, outraId: outra.id, corpoAuto: corpoVenda([itemVenda(p.id, "2", "10.00")], { tipo_operacao_id: topAuto }) };
  }

  /**
   * O DESFECHO: as duas terminaram, e EXATAMENTE UMA perdeu o 40P01 com um dos resultados aceitos — a manual com o 409
   * CONCURRENCY_CONFLICT de hoje, ou a automática salva e aberta com "recusada" (o MESMO erro). A vencedora confirmou
   * com efeito; a perdedora, nada. Depois, a perdedora confirma pela porta manual (premissa: ela era confirmável).
   * Devolve quem perdeu.
   */
  async function desfecho(s: Awaited<ReturnType<typeof cenario>>, post: Resposta, manual: Resposta): Promise<"manual" | "automatica"> {
    expect(post.statusCode, `o POST sempre salva: ${post.body}`).toBe(201);
    const auto = corpo(post);
    const ca = automaticaDe(auto);
    const perdeuManual = manual.statusCode === 409 && erro(manual).code === "CONCURRENCY_CONFLICT";
    const perdeuAutomatica = ca.confirmado === false && ca.erro?.code === "CONCURRENCY_CONFLICT";
    expect([perdeuManual, perdeuAutomatica].filter(Boolean),
      `exatamente uma vítima do ciclo — manual: ${manual.statusCode} ${manual.body} / automática: ${JSON.stringify(ca)}`).toHaveLength(1);
    if (perdeuManual) {
      expect(erro(manual)).toEqual(RECUSA_DA_CONCORRENCIA);
      expect(ca).toEqual({ confirmado: true });
      await esperarConfirmada(auto.id, { saidas: [[s.p.id, "2"]], total: "20.00" });
      expect(await semEfeito(s.outraId), "a manual perdedora não deixou efeito").toEqual(["open", 0, 0, 0]);
      expect(await saldo(s.p.id)).toBe("18.0000");
      expect((await confirmarVenda(s.outraId)).statusCode, "premissa: a outra venda era confirmável").toBe(200);
      await esperarConfirmada(s.outraId, { saidas: [[s.p.id, "1"]], total: "10.00" });
    } else {
      expect(manual.statusCode, manual.body).toBe(200);
      expect(ca).toEqual({ confirmado: false, motivo: "recusada", erro: RECUSA_DA_CONCORRENCIA });
      expect(await trilha(auto.id), "a automática perdedora ficou SALVA").toEqual(["create"]);
      expect(await semEfeito(auto.id), "e ABERTA, sem efeito").toEqual(["open", 0, 0, 0]);
      await esperarConfirmada(s.outraId, { saidas: [[s.p.id, "1"]], total: "10.00" });
      expect(await saldo(s.p.id)).toBe("19.0000");
      expect((await confirmarVenda(auto.id)).statusCode, "premissa: a venda automática era confirmável").toBe(200);
      await esperarConfirmada(auto.id, { saidas: [[s.p.id, "2"]], total: "20.00" });
    }
    expect(await saldo(s.p.id), "no fim, as duas saíram uma vez cada").toBe("17.0000");
    return perdeuManual ? "manual" : "automatica";
  }

  it("CA-12a a manual chega PRIMEIRO à linha de saldo (o POST já segura o contador): o ciclo fecha, ninguém pendura, uma vítima só, com um resultado aceito", async () => {
    const s = await cenario();
    const { respostas: [manual, post], esperando } = await emOrdemComBarreira(
      "select 1 from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3 and provider_lot='' for update",
      [c.h.demo.orgId, c.I.warehouse, s.p.id],
      () => confirmarVenda(s.outraId),
      () => lancarVenda(s.corpoAuto));
    expect(esperando, "premissa: a manual esperou primeiro, e as duas esperavam quando a barreira caiu").toEqual([1, 2]);
    expect(["manual", "automatica"]).toContain(await desfecho(s, post, manual));
  });

  it("CA-12b o POST chega PRIMEIRO ao contador do ID Global (a manual já segura o saldo): o ciclo fecha, ninguém pendura, uma vítima só, com um resultado aceito", async () => {
    const s = await cenario();
    const { respostas: [post, manual], esperando } = await emOrdemComBarreira(
      "select 1 from erp.sequencias_id_global where organization_id=$1 for update",
      [c.h.demo.orgId],
      () => lancarVenda(s.corpoAuto),
      () => confirmarVenda(s.outraId));
    expect(esperando, "premissa: o POST esperou primeiro, e as duas esperavam quando a barreira caiu").toEqual([1, 2]);
    expect(["manual", "automatica"]).toContain(await desfecho(s, post, manual));
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// SI-1
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("SI-1 venda formato 4 com 'Documento sem itens: Permitido'", () => {
  it("SI-1a items [] → 201 sem itens; confirmar: total 0 a receber → a recusa de hoje do título, sem movimento; com frete → confirma sem movimento e com o título do total; o PUT para [] também passa", async () => {
    const topSem = await topVenda(semItens());
    const r = await lancarVenda(corpoVenda([], { tipo_operacao_id: topSem }));
    expect(r.statusCode, r.body).toBe(201);
    const zero = corpo(r);
    expect(Object.keys(zero), "Manual: o corpo de hoje").toEqual(CHAVES_DO_POST);
    expect([zero.subtotal, zero.total]).toEqual(["0.00", "0.00"]);
    expect(await itensNoBanco(zero.id)).toEqual([]);
    // Total 0 com a receber: a confirmação recusa como hoje, no título — e nada sai nem nasce.
    const c0 = await confirmarVenda(zero.id);
    expect(c0.statusCode, c0.body).toBe(422);
    expect(erro(c0)).toEqual(RECUSA_DO_TITULO);
    expect(await semEfeito(zero.id)).toEqual(["open", 0, 0, 0]);
    // Com frete: confirma, NENHUM movimento de estoque, e o título é do total.
    const comFrete = await vendaLancada(corpoVenda([], { tipo_operacao_id: topSem, freight: "100.00" }));
    expect(comFrete.total).toBe("100.00");
    const ok = await confirmarVenda(comFrete.id);
    expect(ok.statusCode, ok.body).toBe(200);
    await esperarConfirmada(comFrete.id, { saidas: [], total: "100.00" });
    // O PUT de uma venda com itens para [] também passa na versão Permitido.
    const p = await produtoComSaldo("5");
    const base = corpoVenda([itemVenda(p.id, "1", "10.00")], { tipo_operacao_id: topSem, freight: "5.00" });
    const v = await vendaLancada(base);
    expect(await itensNoBanco(v.id)).toHaveLength(1);
    const put = await editarVenda(v.id, { ...base, items: [] });
    expect(put.statusCode, put.body).toBe(200);
    expect(await itensNoBanco(v.id)).toEqual([]);
    expect(await totalNoBanco(v.id)).toBe("5.00");
  });

  it("SI-1b Permitido + Automática: total 0 → 201, aberta, 'recusada' com a recusa do título (igual ao /confirm); com frete → confirmada sem movimento, com o título do total", async () => {
    const topSemAuto = await topVenda(semItens((x) => { x.geral.confirmacao = "automatica"; }));
    const r = await lancarVenda(corpoVenda([], { tipo_operacao_id: topSemAuto }));
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect(automaticaDe(b)).toEqual({ confirmado: false, motivo: "recusada", erro: RECUSA_DO_TITULO });
    expect(await semEfeito(b.id)).toEqual(["open", 0, 0, 0]);
    expect(automaticaDe(b).erro).toEqual(erro(await confirmarVenda(b.id)));
    const comFrete = await lancarVenda(corpoVenda([], { tipo_operacao_id: topSemAuto, freight: "80.00" }));
    expect(comFrete.statusCode, comFrete.body).toBe(201);
    expect(automaticaDe(corpo(comFrete))).toEqual({ confirmado: true });
    await esperarConfirmada(corpo(comFrete).id, { saidas: [], total: "80.00" });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// SI-2
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("SI-2 sem TOP, formato 1 a 3, Proibido, orçamento e pedido: items [] → o 422 de hoje; e a ORDEM nova", () => {
  it("SI-2a POST: items [] como único defeito → o 422 IDÊNTICO ao de hoje em todos, e nada nasce; o MESMO corpo com Permitido passa (premissa)", async () => {
    const tops = {
      f1: await topVenda(configuracaoNeutraTop()),
      f2: await topVenda(configuracaoNeutraTopV2()),
      f3Producao: await topVenda(comoProducao()),
      f4Proibido: await topVenda(cfg4()),
      f4ProibidoAuto: await topVenda(automatica()),
      orcamento: await topVenda(cfg4(), "vendas.orcamento"),
      pedido: await topVenda(cfg4(), "vendas.pedido"),
    };
    const casos: [string, () => Promise<Resposta>][] = [
      ["venda sem TOP", () => lancarVenda(corpoVenda([]))],
      ["venda formato 1", () => lancarVenda(corpoVenda([], { tipo_operacao_id: tops.f1 }))],
      ["venda formato 2", () => lancarVenda(corpoVenda([], { tipo_operacao_id: tops.f2 }))],
      ["venda formato 3 com 'permitido' (produção)", () => lancarVenda(corpoVenda([], { tipo_operacao_id: tops.f3Producao }))],
      ["venda formato 4 Proibido", () => lancarVenda(corpoVenda([], { tipo_operacao_id: tops.f4Proibido }))],
      ["venda formato 4 Proibido e Automática", () => lancarVenda(corpoVenda([], { tipo_operacao_id: tops.f4ProibidoAuto }))],
      ["orçamento sem TOP", () => lancarDaVariante("budgets", corpoVenda([]))],
      ["orçamento formato 4", () => lancarDaVariante("budgets", corpoVenda([], { tipo_operacao_id: tops.orcamento }))],
      ["pedido sem TOP", () => lancarDaVariante("orders", corpoVenda([]))],
      ["pedido formato 4", () => lancarDaVariante("orders", corpoVenda([], { tipo_operacao_id: tops.pedido }))],
    ];
    const antes = await contarDocumentos();
    for (const [nome, lancar] of casos) {
      const r = await lancar();
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(erro(r), nome).toEqual(RECUSA_DOS_ITENS_VAZIOS);
    }
    expect(await contarDocumentos(), "nenhum documento nasceu").toBe(antes);
    // PREMISSA: o MESMO corpo, com a versão formato 4 Permitido, é aceito — a recusa era a versão, não o corpo.
    const ok = await lancarVenda(corpoVenda([], { tipo_operacao_id: await topVenda(semItens()) }));
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it("SI-2b items [] com OUTRO defeito: o erro é o do esquema ESTRITO, idêntico com e sem a versão Permitido", async () => {
    const topSem = await topVenda(semItens());
    const { client_id: _cliente, ...semCliente } = corpoVenda([]);
    const semTop = await lancarVenda(semCliente);
    const permitido = await lancarVenda({ ...semCliente, tipo_operacao_id: topSem });
    expect(semTop.statusCode, semTop.body).toBe(422);
    expect(permitido.statusCode, permitido.body).toBe(422);
    expect(erro(permitido), "o irmão falhou → responde o estrito, com os itens junto").toEqual(erro(semTop));
    expect((erro(semTop).details as { path: string }[]).map((d) => d.path).sort()).toEqual(["client_id", "items"]);
  });

  it("SI-2c PUT para items [] → o 422 de hoje: sem TOP (logo depois da leitura do corpo), formato 3 de produção e formato 4 Proibido (depois de saber a versão); nada gravado", async () => {
    const p = await produtoComSaldo("5");
    const casos: [string, string | null][] = [["sem TOP", null], ["formato 3 de produção", await topVenda(comoProducao())], ["formato 4 Proibido", await topVenda(cfg4())]];
    for (const [nome, topId] of casos) {
      const base = corpoVenda([itemVenda(p.id, "1", "10.00")], topId ? { tipo_operacao_id: topId } : {});
      const v = await vendaLancada(base);
      const versao = await versaoDaVenda(v.id);
      const r = await editarVenda(v.id, { ...base, items: [] });
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(erro(r), nome).toEqual(RECUSA_DOS_ITENS_VAZIOS);
      expect([await versaoDaVenda(v.id), (await itensNoBanco(v.id)).length], `${nome}: nada gravado`).toEqual([versao, 1]);
    }
  });

  it("SI-2d a ORDEM nova no POST (declarada): com TOP, a recusa da TOP e a da empresa vêm ANTES da dos itens; sem TOP, a dos itens vem primeiro, como hoje", async () => {
    const p = await produtoComSaldo("5");
    const itens = [itemVenda(p.id, "1", "10.00")];
    // TOP inexistente: a MESMA recusa com itens [] e com itens válidos — a TOP é decidida antes dos itens.
    const inexistente = randomUUID();
    const daTop = await lancarVenda(corpoVenda(itens, { tipo_operacao_id: inexistente }));
    expect(daTop.statusCode, daTop.body).toBe(422);
    expect(erro(daTop).code, "premissa: a recusa da TOP").toBe("TIPO_OPERACAO_INDISPONIVEL");
    const vazioInexistente = await lancarVenda(corpoVenda([], { tipo_operacao_id: inexistente }));
    expect(vazioInexistente.statusCode, vazioInexistente.body).toBe(422);
    expect(erro(vazioInexistente), "TOP inexistente + items [] → a recusa da TOP").toEqual(erro(daTop));
    // TOP de outra família (a de pedido na porta da venda): idem.
    const topPedido = await topVenda(cfg4(), "vendas.pedido");
    expect(erro(await lancarVenda(corpoVenda([], { tipo_operacao_id: topPedido }))), "TOP de outra família + items [] → a recusa da TOP")
      .toEqual(erro(await lancarVenda(corpoVenda(itens, { tipo_operacao_id: topPedido }))));
    // Empresa sem acesso: com TOP, a recusa da empresa vem antes; SEM TOP, a dos itens vem primeiro (a ordem de hoje).
    const topProibido = await topVenda(cfg4());
    const empresaAlheia = randomUUID();
    const daEmpresa = await lancarVenda(corpoVenda(itens, { tipo_operacao_id: topProibido, empresa_id: empresaAlheia }));
    expect(daEmpresa.statusCode, daEmpresa.body).toBe(422);
    expect(erro(daEmpresa).message, "premissa: a recusa da empresa").toBe("Sem acesso à empresa informada");
    expect(erro(await lancarVenda(corpoVenda([], { tipo_operacao_id: topProibido, empresa_id: empresaAlheia }))), "com TOP: a empresa antes dos itens").toEqual(erro(daEmpresa));
    expect(erro(await lancarVenda(corpoVenda([], { empresa_id: empresaAlheia }))), "sem TOP: os itens antes da empresa, como hoje").toEqual(RECUSA_DOS_ITENS_VAZIOS);
  });

  it("SI-2e a ORDEM nova na PATCH (declarada): com items [] a 404, o 409 da versão e o 409 da situação vêm ANTES; sozinho, o 422 de hoje; o orçamento recusa na forma, como hoje", async () => {
    const topProibido = await topVenda(cfg4());
    const p = await produtoComSaldo("5");
    const v = await vendaLancada(corpoVenda([itemVenda(p.id, "1", "10.00")], { tipo_operacao_id: topProibido }));
    const versao = await versaoDaVenda(v.id);
    // 404: id inexistente e id malformado — a MESMA 404 do GET por id.
    const naoExiste = randomUUID();
    const get404 = await lerVenda(naoExiste);
    expect(get404.statusCode).toBe(404);
    for (const id of [naoExiste, "nao-e-um-uuid"]) {
      const r = await patchVenda(id, { version: versao, items: [] });
      expect(r.statusCode, `${id}: ${r.body}`).toBe(404);
      expect(erro(r), id).toEqual(erro(get404));
    }
    // 409 da versão, antes dos itens.
    const velha = await patchVenda(v.id, { version: mais(versao, 7), items: [] });
    expect(velha.statusCode, velha.body).toBe(409);
    expect(erro(velha)).toEqual({ code: "CONCURRENCY_CONFLICT", message: MSG_DOCUMENTO_MUDOU });
    // Sozinho: o 422 de hoje, e nada gravado.
    const so = await patchVenda(v.id, { version: versao, items: [] });
    expect(so.statusCode, so.body).toBe(422);
    expect(erro(so)).toEqual(RECUSA_DOS_ITENS_VAZIOS);
    expect([await versaoDaVenda(v.id), (await itensNoBanco(v.id)).length]).toEqual([versao, 1]);
    // 409 da situação (confirmada), antes dos itens.
    expect((await confirmarVenda(v.id)).statusCode).toBe(200);
    const confirmada = await patchVenda(v.id, { version: await versaoDaVenda(v.id), items: [] });
    expect(confirmada.statusCode, confirmada.body).toBe(409);
    expect(erro(confirmada).code).toBe("INVALID_STATUS_TRANSITION");
    // O ORÇAMENTO não muda: o estrito recusa os itens vazios na FORMA, antes até da 404 — a ordem de hoje.
    const orc = await patchDaVariante("budgets", naoExiste, { version: "0", items: [] });
    expect(orc.statusCode, orc.body).toBe(422);
    expect(erro(orc)).toEqual(RECUSA_DOS_ITENS_VAZIOS);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// SI-4
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("SI-4 PATCH da venda para items []", () => {
  it("SI-4 Permitido → 200 (o GET, sem itens, total recalculado, version +1); Proibido → o 422 de hoje, nada gravado", async () => {
    const p = await produtoComSaldo("5");
    const permitida = await vendaLancada(corpoVenda([itemVenda(p.id, "2", "10.00")], { tipo_operacao_id: await topVenda(semItens()), freight: "7.00" }));
    const v0 = await versaoDaVenda(permitida.id);
    const r = await patchVenda(permitida.id, { version: v0, items: [] });
    expect(r.statusCode, r.body).toBe(200);
    expect(corpo(r), "Manual: sem a chave").not.toHaveProperty("confirmacaoAutomatica");
    expect(j(r)).toEqual(j(await lerVenda(permitida.id)));
    expect(await itensNoBanco(permitida.id)).toEqual([]);
    expect(await totalNoBanco(permitida.id), "o total sai do frete").toBe("7.00");
    expect(await versaoDaVenda(permitida.id)).toBe(mais(v0, 1));
    expect(await semEfeito(permitida.id)).toEqual(["open", 0, 0, 0]);

    const proibida = await vendaLancada(corpoVenda([itemVenda(p.id, "2", "10.00")], { tipo_operacao_id: await topVenda(cfg4()), freight: "7.00" }));
    const w0 = await versaoDaVenda(proibida.id);
    const recusa = await patchVenda(proibida.id, { version: w0, items: [] });
    expect(recusa.statusCode, recusa.body).toBe(422);
    expect(erro(recusa)).toEqual(RECUSA_DOS_ITENS_VAZIOS);
    expect([await versaoDaVenda(proibida.id), (await itensNoBanco(proibida.id)).length, await totalNoBanco(proibida.id)]).toEqual([w0, 1, "27.00"]);
  });
});
