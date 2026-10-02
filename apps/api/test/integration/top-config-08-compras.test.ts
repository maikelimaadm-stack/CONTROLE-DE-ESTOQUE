import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configuracaoNeutraTop, configuracaoNeutraTopV2, mensagemAprovacaoReprovada } from "@agro/domain";
import { fromPgError } from "../../src/lib/errors.js";
import {
  c, iniciar, encerrar, j, erro, unico, cfg3, cfg4, top, versaoAtualNoBanco, usuario, produto, saldo,
  itemCompra, corpoCompra, lancarCompra, compraLancada, confirmarCompra, previaCompra, receberPedido, corpoReceber,
  aprovar, reprovar, movimentosDe, titulosDe, situacaoNoBanco, auditoriaDe, decisoesDe,
  type Resposta, type Erro, type ItemCompra,
} from "./top-config-08-ajuda.js";

/**
 * TOP-CONFIG-08 (decisão 277) — AS REGRAS GERAIS E A APROVAÇÃO NA COMPRA (SPEC §3, §4, §5 e §13).
 *
 * O ciclo da COMPRA com a versão congelada da TOP no FORMATO 4: a confirmação automática no POST e no RECEBER do
 * pedido (CA-7), o corte do formato 3 (CA-9), a idempotência (CA-10), o corpo de hoje sem a automática (CA-11), o
 * documento sem itens (SI-1, SI-2), a aprovação (AP-7, AP-8) e a guarda de transição do banco (AP-12). A aprovação
 * de VENDA e a fila são do `top-config-08-aprovacao.test.ts`; o estoque, do `top-config-08-estoque.test.ts`.
 *
 * O QUE CONTA COMO PROVA (o molde da COMPRAS-01): nenhuma asserção decisiva é só status HTTP. A situação da compra, a
 * entrada no estoque, a conta a pagar, as decisões de aprovação e a trilha são LIDAS NO BANCO pela testemunha
 * (`c.admin`, superusuário sem RLS), pela origem. Toda asserção de "zero efeito" vem com a PREMISSA ao lado: o mesmo
 * documento, com o obstáculo tirado, produz o efeito — senão "zero" poderia ser só um cenário que nunca confirmaria.
 *
 * "O CORPO DE HOJE" é literal: as chaves que o POST e o receber respondem na `origin/main` desta fatia
 * (`lancar` e `receberPedido`), conferidas também contra um POST formato 3 vivo.
 */

beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── o corpo de hoje e as mensagens exatas ───────────────

/** As chaves do POST de documento de compra de hoje (`lancar`), na ordem. */
const CHAVES_DO_POST = ["id", "codigo", "especie", "situacao", "valor_itens", "valor_total"];
/** As chaves do receber pedido de hoje: o corpo de `lancar` + a origem e a situação do pedido. */
const CHAVES_DO_RECEBER = [...CHAVES_DO_POST, "from", "pedidoSituacao"];

/** A recusa de HOJE para os itens vazios da compra (o esquema estrito, pelo plugin de erros). */
const RECUSA_DOS_ITENS_VAZIOS: Erro = { code: "VALIDATION_ERROR", message: "itens: Valor mínimo: 1", details: [{ path: "itens", message: "Valor mínimo: 1" }] };

const MSG_PENDENTE = "Este documento precisa de aprovação antes de ser confirmado.";
const MSG_NAO_EXIGIDA = "Este documento não precisa de aprovação.";
const MSG_SO_ABERTO = "Só documento aberto passa por aprovação.";
const MSG_GUARDA_REPROVADO = "Este documento foi reprovado e não pode ser confirmado.";

// ─────────────── as TOPs do caso ───────────────

const automatica = cfg4((x) => { x.geral.confirmacao = "automatica"; });
/**
 * Uma TOP de compra NOVA com a configuração dada (cada caso cria a sua), com a PREMISSA de que o banco guardou a
 * versão no formato pedido: um 4 que virasse 3 no caminho (ou um 1 promovido) mediria outro corte.
 */
async function topCompra(configuracao: { versaoSchema: number }): Promise<string> {
  const id = await top("compras.compra", { configuracao });
  expect((await versaoAtualNoBanco(id)).configuracao_schema_version, "premissa: a versão congelada está no formato pedido").toBe(configuracao.versaoSchema);
  return id;
}

// ─────────────── leituras ───────────────

type Corpo = Record<string, unknown> & { id: string; situacao?: string; confirmacaoAutomatica?: unknown };
const corpo = (r: Resposta) => j(r) as Corpo;

/** O que a compra é NO BANCO: situação, movimentos, títulos e as auditorias "confirm". */
async function efeitos(id: string) {
  return {
    situacao: await situacaoNoBanco("documentos_compra", id),
    movimentos: await movimentosDe("documentos_compra", id),
    titulos: await titulosDe("documentos_compra", id),
    confirmacoes: await auditoriaDe("documentos_compra", id, "confirm"),
  };
}

/** O resumo de "nada aconteceu": aberta, sem movimento, sem título, sem auditoria "confirm". */
async function semEfeito(id: string) {
  const e = await efeitos(id);
  return [e.situacao, e.movimentos.length, e.titulos.length, e.confirmacoes.length];
}

/** A compra confirmada com UMA entrada do produto e UM título a pagar do total — lida no banco. */
async function esperarConfirmada(id: string, p: { produtoId: string; quantidade: string; total: string }) {
  const e = await efeitos(id);
  expect(e.situacao).toBe("confirmado");
  expect(e.movimentos.map((m) => [m.movement_type, m.direction, Number(m.quantity), m.product_id, m.warehouse_id]))
    .toEqual([["receipt", 1, Number(p.quantidade), p.produtoId, c.I.warehouse]]);
  expect(e.titulos.map((t) => [t.direction, t.status, t.amount])).toEqual([["payable", "open", p.total]]);
  expect(e.confirmacoes).toHaveLength(1);
  return e;
}

/** Os itens do documento de compra no banco (o pedido, para montar o receber). */
async function itensNoBanco(id: string): Promise<{ id: string; quantidade: string }[]> {
  return (await c.admin.query<{ id: string; quantidade: string }>(
    "select id, quantidade::text from erp.documentos_compra_itens where documento_id=$1 order by posicao, id", [id])).rows;
}

/** O pedido de compra com a aresta para a TOP de compra de destino (inteiro, sem "Em partes"), e os itens dele. */
async function pedidoPara(topCompraDestino: string, itens: ItemCompra[], configuracaoPedido: unknown = cfg4()) {
  const topPedido = await top("compras.pedido", { configuracao: configuracaoPedido, destinos: [{ tipoOperacaoId: topCompraDestino, ordem: 0, emPartes: false }] });
  const p = await compraLancada("pedido", corpoCompra(itens, { tipo_operacao_id: topPedido }, "pedido"));
  const linhas = await itensNoBanco(p.id);
  expect(linhas, "premissa: o pedido tem os itens do corpo").toHaveLength(itens.length);
  return { id: p.id, itens: linhas };
}

/** O receber do pedido INTEIRO para a TOP de compra de destino. */
const receberTudo = (pedido: { id: string; itens: { id: string; quantidade: string }[] }, topDestino: string, extra: Record<string, unknown> = {}, chave?: string) =>
  receberPedido(pedido.id, corpoReceber(topDestino, pedido.itens.map((i) => ({ item_origem_id: i.id, quantidade: i.quantidade })), extra), chave);

/** A compra gerada pelo receber, lida no banco pela origem (todas, inclusive canceladas). */
async function comprasGeradas(pedidoId: string): Promise<string[]> {
  return (await c.admin.query<{ id: string }>("select id from erp.documentos_compra where origem_documento_id=$1 order by created_at, id", [pedidoId])).rows.map((x) => x.id);
}

/**
 * O MÊS CONGELADO da 1ª empresa (`financial_freezes`, a porta de `assert_period_open`). Cada caso usa um mês só dele
 * (2025): o resto do arquivo lança em setembro de 2026 e nunca esbarra no congelamento. Devolve o descongelar.
 */
async function congelar(ano: number, mes: number): Promise<() => Promise<void>> {
  const id = (await c.admin.query<{ id: string }>(
    "insert into erp.financial_freezes(organization_id, empresa_id, year, month, is_frozen) values ($1,$2,$3,$4,true) returning id",
    [c.h.demo.orgId, c.I.empresa, ano, mes])).rows[0]!.id;
  return async () => { await c.admin.query("update erp.financial_freezes set is_frozen=false where id=$1", [id]); };
}

/**
 * A trilha do SERVIÇO (`audit()`, sempre com metadata). O gatilho `erp.audit_row()` grava, para a mesma linha, um
 * "create"/"update" SEM metadata (com o `after`): é a trilha da tabela, não a do serviço, e fica de fora.
 */
async function trilhaDoServico(id: string, action?: string) {
  return (await auditoriaDe("documentos_compra", id, action)).filter((a) => a.metadata !== null);
}

/** Quem salvou: o `user_id` da auditoria "create" do serviço (o membro do caso não tem o id à mão). */
async function autorDoCreate(id: string): Promise<string> {
  const a = await trilhaDoServico(id, "create");
  expect(a, "premissa: a compra foi auditada pelo serviço ao ser criada").toHaveLength(1);
  return a[0]!.user_id!;
}

// ─────────────── CA-7 ───────────────

describe("CA-7 compra com TOP formato 4 Automática: POST e receber confirmam no fim; a recusa deixa salva e aberta", () => {
  it("CA-7a POST → 201 'confirmado', {confirmado:true}; entrada e conta a pagar no banco; auditoria 'confirm' com automatica:true por quem salvou; a manual sem a chave", async () => {
    const topId = await topCompra(automatica);
    const v = await versaoAtualNoBanco(topId);
    expect([v.configuracao_schema_version, (v.configuracao.geral as Record<string, unknown>).confirmacao], "premissa: a versão congelada é formato 4 Automática").toEqual([4, "automatica"]);
    // Quem salva é um membro com a capacidade da confirmação manual (compras.edit), não o administrador.
    const comprador = await usuario("Comprador CA7", ["compras.view", "compras.create", "compras.edit"]);
    const p = await produto();
    const r = await lancarCompra("compra", corpoCompra([itemCompra(p.id, "3", "10.00")], { tipo_operacao_id: topId }), comprador);
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    // O corpo de hoje + a chave nova (aditiva), e a situação da compra confirmada.
    expect(Object.keys(b)).toEqual([...CHAVES_DO_POST, "confirmacaoAutomatica"]);
    expect([b.situacao, b.confirmacaoAutomatica, b.valor_total]).toEqual(["confirmado", { confirmado: true }, "30.00"]);
    // NO BANCO: confirmada, a entrada do produto, a conta a pagar do total e UMA confirmação.
    const e = await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "3", total: "30.00" });
    expect(await saldo(p.id)).toBe("3.0000");
    // "No fim mesmo": a confirmação vem DEPOIS da auditoria "create", e quem confirma é QUEM SALVOU.
    expect((await trilhaDoServico(b.id)).map((a) => a.action)).toEqual(["create", "confirm"]);
    const autor = await autorDoCreate(b.id);
    expect(autor).not.toBe(c.h.demo.adminUserId);
    expect(e.confirmacoes[0]!.user_id).toBe(autor);
    const auto = e.confirmacoes[0]!.metadata!;
    expect(auto.automatica).toBe(true);

    // A MANUAL (POST /confirm) da mesma família: a auditoria é a de hoje, SEM a chave — nem `automatica: false`.
    const q = await produto();
    const manual = await compraLancada("compra", corpoCompra([itemCompra(q.id, "3", "10.00")]));
    expect(manual.situacao, "premissa: a TOP neutra do formato 4 é Manual — a compra fica aberta").toBe("aberto");
    const rc = await confirmarCompra(manual.id);
    expect(rc.statusCode, rc.body).toBe(200);
    const m = (await esperarConfirmada(manual.id, { produtoId: q.id, quantidade: "3", total: "30.00" })).confirmacoes[0]!.metadata!;
    expect(Object.hasOwn(m, "automatica")).toBe(false);
    // O MESMO metadata da manual + `automatica: true`: a mesma confirmação, não uma segunda.
    expect(Object.keys(auto).sort()).toEqual([...Object.keys(m), "automatica"].sort());
    expect(auto.tipoOperacaoVersaoId).toBe(v.id);
  });

  it("CA-7b sem compras.edit → 201, salva e aberta, motivo 'sem_permissao' (a TOP não dá poder); premissa: com a capacidade, confirma", async () => {
    const topId = await topCompra(automatica);
    const semEdit = await usuario("Comprador sem edit", ["compras.view", "compras.create"]);
    const p = await produto();
    const r = await lancarCompra("compra", corpoCompra([itemCompra(p.id, "2", "10.00")], { tipo_operacao_id: topId }), semEdit);
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect([b.situacao, b.confirmacaoAutomatica]).toEqual(["aberto", { confirmado: false, motivo: "sem_permissao" }]);
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
    // Premissa: a MESMA compra confirma pela porta manual de quem tem a capacidade.
    expect((await confirmarCompra(b.id)).statusCode).toBe(200);
    await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "2", total: "20.00" });
  });

  it("CA-7c receber pedido → a compra GERADA (TOP de destino formato 4 Automática) confirmada; pedido convertido; resposta 'confirmado'", async () => {
    const topDestino = await topCompra(automatica);
    const p = await produto();
    // O pedido usa uma TOP formato 4 MANUAL: a compra gerada segue a versão congelada DELA (a de destino).
    const pedido = await pedidoPara(topDestino, [itemCompra(p.id, "4", "10.00")]);
    const r = await receberTudo(pedido, topDestino);
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect(Object.keys(b)).toEqual([...CHAVES_DO_RECEBER, "confirmacaoAutomatica"]);
    expect([b.situacao, b.confirmacaoAutomatica, b.from, b.pedidoSituacao]).toEqual(["confirmado", { confirmado: true }, pedido.id, "convertido"]);
    expect(await comprasGeradas(pedido.id)).toEqual([b.id]);
    const e = await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "4", total: "40.00" });
    expect(e.confirmacoes[0]!.metadata!.automatica).toBe(true);
    // A confirmação vem DEPOIS de o pedido virar convertido e da auditoria "convert" (a ordem da trilha, pelo id).
    expect(await situacaoNoBanco("documentos_compra", pedido.id)).toBe("convertido");
    expect((await auditoriaDe("documentos_compra", pedido.id, "convert")).map((a) => a.metadata!.to)).toEqual([b.id]);
    const ordem = (await c.admin.query<{ action: string }>(
      `select action from erp.audit_logs
        where entity = 'documentos_compra' and ((entity_id = $1 and action = 'convert') or (entity_id = $2 and action = 'confirm'))
        order by id`, [pedido.id, b.id])).rows;
    expect(ordem.map((a) => a.action)).toEqual(["convert", "confirm"]);
  });

  it("CA-7d POST com período fechado → 201, salva e ABERTA, 'recusada' com o erro IGUAL ao do /confirm; nada de estoque nem título; descongelado, confirma", async () => {
    const topId = await topCompra(automatica);
    const p = await produto();
    const descongelar = await congelar(2025, 5);
    const r = await lancarCompra("compra", corpoCompra([itemCompra(p.id, "5", "10.00")], { tipo_operacao_id: topId, data_documento: "2025-05-12" }));
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect(b.situacao).toBe("aberto");
    const ca = b.confirmacaoAutomatica as { confirmado: boolean; motivo: string; erro: Erro };
    expect([ca.confirmado, ca.motivo]).toEqual([false, "recusada"]);
    // SALVA (a auditoria "create" e a linha existem) e ABERTA, sem efeito nenhum.
    expect(await autorDoCreate(b.id)).toBe(c.h.demo.adminUserId);
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
    expect(await saldo(p.id)).toBe("0.0000");
    // O erro é o MESMO corpo que o POST /confirm dá à mesma compra.
    const manual = await confirmarCompra(b.id);
    expect(manual.statusCode).toBe(409);
    expect(ca.erro).toEqual(erro(manual));
    expect(ca.erro.code).toBe("PERIOD_FROZEN");
    // Premissa: com o mês aberto, a MESMA compra confirma — a recusa era o período, não o cenário.
    await descongelar();
    expect((await confirmarCompra(b.id)).statusCode).toBe(200);
    await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "5", total: "50.00" });
  });

  it("CA-7e receber com período fechado → a gerada salva e ABERTA, 'recusada' (erro igual ao do /confirm); o pedido convertido como hoje", async () => {
    const topDestino = await topCompra(automatica);
    const p = await produto();
    const pedido = await pedidoPara(topDestino, [itemCompra(p.id, "2", "10.00")]);
    const descongelar = await congelar(2025, 6);
    const r = await receberTudo(pedido, topDestino, { data_documento: "2025-06-12" });
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect([b.situacao, b.pedidoSituacao, b.from]).toEqual(["aberto", "convertido", pedido.id]);
    const ca = b.confirmacaoAutomatica as { confirmado: boolean; motivo: string; erro: Erro };
    expect([ca.confirmado, ca.motivo]).toEqual([false, "recusada"]);
    // O recebimento ficou inteiro: a compra gerada existe, ligada ao pedido, e o pedido virou convertido.
    expect(await comprasGeradas(pedido.id)).toEqual([b.id]);
    expect(await situacaoNoBanco("documentos_compra", pedido.id)).toBe("convertido");
    expect(await auditoriaDe("documentos_compra", pedido.id, "convert")).toHaveLength(1);
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
    const manual = await confirmarCompra(b.id);
    expect(ca.erro).toEqual(erro(manual));
    // Premissa: descongelado, a gerada confirma pela porta manual.
    await descongelar();
    expect((await confirmarCompra(b.id)).statusCode).toBe(200);
    await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "2", total: "20.00" });
  });
});

// ─────────────── CA-9 ───────────────

describe("CA-9 o corte: versão no formato 3 com 'automatica' gravado (como produção) NÃO confirma", () => {
  /** O que a TOP de pedido de compra de produção declara (formato 3): Automática, Sem itens Permitido, Alteração Permitida. */
  const comoProducao = () => cfg3((x) => { x.geral.confirmacao = "automatica"; x.geral.documentoSemItens = "permitido"; x.geral.alteracaoAposConfirmacao = "permitida"; });

  it("CA-9a POST de compra com TOP formato 3 Automática → o corpo de hoje, sem a chave; aberta e sem efeito; premissa: o /confirm confirma", async () => {
    const topId = await topCompra(comoProducao());
    const v = await versaoAtualNoBanco(topId);
    expect([v.configuracao_schema_version, (v.configuracao.geral as Record<string, unknown>).confirmacao], "premissa: formato 3 com 'automatica' gravado").toEqual([3, "automatica"]);
    const p = await produto();
    const r = await lancarCompra("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId }));
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect(Object.keys(b)).toEqual(CHAVES_DO_POST);
    expect(b.situacao).toBe("aberto");
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
    expect((await confirmarCompra(b.id)).statusCode).toBe(200);
    await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "1", total: "10.00" });
  });

  it("CA-9b receber: pedido com a TOP de produção (formato 3 Automática) para compra formato 3 Automática → o corpo de hoje; a gerada aberta", async () => {
    const topDestino = await topCompra(comoProducao());
    const p = await produto();
    const pedido = await pedidoPara(topDestino, [itemCompra(p.id, "2", "10.00")], comoProducao());
    const r = await receberTudo(pedido, topDestino);
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect(Object.keys(b)).toEqual(CHAVES_DO_RECEBER);
    expect([b.situacao, b.pedidoSituacao]).toEqual(["aberto", "convertido"]);
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
  });

  it("CA-9c a automática do PEDIDO não passa para a compra gerada: pedido formato 3 Automática → destino formato 4 Manual → aberta, sem a chave", async () => {
    const topDestino = await topCompra(cfg4());
    const p = await produto();
    const pedido = await pedidoPara(topDestino, [itemCompra(p.id, "1", "10.00")], comoProducao());
    const b = corpo(await receberTudo(pedido, topDestino));
    expect(Object.keys(b)).toEqual(CHAVES_DO_RECEBER);
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
  });
});

// ─────────────── CA-10 ───────────────

describe("CA-10 idempotência: a mesma Idempotency-Key devolve o mesmo corpo e não confirma de novo", () => {
  it("CA-10a POST: duas vezes a mesma chave → o mesmo corpo; UMA compra, UMA auditoria 'confirm', UM movimento, UM título", async () => {
    const topId = await topCompra(automatica);
    const p = await produto();
    const chave = `tc08-ca10a-${unico()}`;
    const corpoDoPost = corpoCompra([itemCompra(p.id, "6", "10.00")], { tipo_operacao_id: topId });
    const r1 = await lancarCompra("compra", corpoDoPost, c.h.headers(), chave);
    const r2 = await lancarCompra("compra", corpoDoPost, c.h.headers(), chave);
    expect([r1.statusCode, r2.statusCode], r2.body).toEqual([201, 201]);
    expect(j(r2)).toEqual(j(r1));
    expect(corpo(r1).confirmacaoAutomatica).toEqual({ confirmado: true });
    const compras = (await c.admin.query<{ id: string }>("select id from erp.documentos_compra where tipo_operacao_id=$1", [topId])).rows;
    expect(compras.map((x) => x.id)).toEqual([corpo(r1).id]);
    await esperarConfirmada(corpo(r1).id, { produtoId: p.id, quantidade: "6", total: "60.00" });
    expect(await saldo(p.id)).toBe("6.0000");
  });

  it("CA-10b POST recusado: o replay devolve o corpo gravado ('recusada') mesmo depois de o período abrir — nunca tenta confirmar de novo", async () => {
    const topId = await topCompra(automatica);
    const p = await produto();
    const chave = `tc08-ca10b-${unico()}`;
    const corpoDoPost = corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId, data_documento: "2025-07-15" });
    const descongelar = await congelar(2025, 7);
    const r1 = await lancarCompra("compra", corpoDoPost, c.h.headers(), chave);
    expect(r1.statusCode, r1.body).toBe(201);
    expect((corpo(r1).confirmacaoAutomatica as { motivo: string }).motivo).toBe("recusada");
    await descongelar();
    const r2 = await lancarCompra("compra", corpoDoPost, c.h.headers(), chave);
    expect(j(r2)).toEqual(j(r1));
    expect(await semEfeito(corpo(r1).id)).toEqual(["aberto", 0, 0, 0]);
    // Premissa: a compra confirmaria agora — o replay é que não tenta.
    expect((await confirmarCompra(corpo(r1).id)).statusCode).toBe(200);
  });

  it("CA-10c receber: duas vezes a mesma chave → o mesmo corpo; UMA compra gerada, UMA auditoria 'confirm', UM movimento", async () => {
    const topDestino = await topCompra(automatica);
    const p = await produto();
    const pedido = await pedidoPara(topDestino, [itemCompra(p.id, "3", "10.00")]);
    const chave = `tc08-ca10c-${unico()}`;
    const r1 = await receberTudo(pedido, topDestino, {}, chave);
    const r2 = await receberTudo(pedido, topDestino, {}, chave);
    expect([r1.statusCode, r2.statusCode], r2.body).toEqual([201, 201]);
    expect(j(r2)).toEqual(j(r1));
    expect(corpo(r1).confirmacaoAutomatica).toEqual({ confirmado: true });
    expect(await comprasGeradas(pedido.id)).toEqual([corpo(r1).id]);
    expect(await auditoriaDe("documentos_compra", pedido.id, "convert")).toHaveLength(1);
    await esperarConfirmada(corpo(r1).id, { produtoId: p.id, quantidade: "3", total: "30.00" });
  });
});

// ─────────────── CA-11 ───────────────

describe("CA-11 formato 1 a 3, ou Manual: a resposta não tem confirmacaoAutomatica — o corpo é o de hoje, chave por chave", () => {
  it("CA-11a POST: formato 1, 2, 3 e 4 Manual (inclusive com outra regra fora do neutro) e o PEDIDO → as chaves do POST formato 3", async () => {
    const p = await produto();
    const lancado = async (configuracao: { versaoSchema: number }) => {
      const r = await lancarCompra("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: await topCompra(configuracao) }));
      expect(r.statusCode, r.body).toBe(201);
      return corpo(r);
    };
    const formato3 = await lancado(cfg3());
    expect(Object.keys(formato3), "premissa: o formato 3 responde o corpo de hoje").toEqual(CHAVES_DO_POST);
    for (const configuracao of [configuracaoNeutraTop(), configuracaoNeutraTopV2(), cfg4(), cfg4((x) => { x.geral.documentoSemItens = "permitido"; x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = "99999.00"; })]) {
      const b = await lancado(configuracao);
      expect(Object.keys(b), `formato ${configuracao.versaoSchema}`).toEqual(Object.keys(formato3));
      expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
    }
    // O pedido nunca confirma: o POST dele é o de hoje, mesmo com TOP formato 4.
    const pedido = await lancarCompra("pedido", corpoCompra([itemCompra(p.id, "1", "10.00")], {}, "pedido"));
    expect(pedido.statusCode, pedido.body).toBe(201);
    expect(Object.keys(corpo(pedido))).toEqual(CHAVES_DO_POST);
  });

  it("CA-11b receber para destino formato 4 Manual ou formato 3 → as chaves do receber de hoje", async () => {
    for (const configuracao of [cfg4(), cfg3()]) {
      const topDestino = await topCompra(configuracao);
      const p = await produto();
      const pedido = await pedidoPara(topDestino, [itemCompra(p.id, "1", "10.00")]);
      const r = await receberTudo(pedido, topDestino);
      expect(r.statusCode, r.body).toBe(201);
      expect(Object.keys(corpo(r))).toEqual(CHAVES_DO_RECEBER);
      expect(await semEfeito(corpo(r).id)).toEqual(["aberto", 0, 0, 0]);
    }
  });
});

// ─────────────── SI-1 ───────────────

describe("SI-1 compra formato 4 com 'Documento sem itens: Permitido'", () => {
  const permitido = () => cfg4((x) => { x.geral.documentoSemItens = "permitido"; });

  it("SI-1a itens [] → 201; confirmar → confirmada SEM movimento; total 0 → SEM título; premissa: com item, a mesma TOP dá entrada e título", async () => {
    const topId = await topCompra(permitido());
    const r = await lancarCompra("compra", corpoCompra([], { tipo_operacao_id: topId }));
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect(Object.keys(b)).toEqual(CHAVES_DO_POST);
    expect([b.situacao, b.valor_itens, b.valor_total]).toEqual(["aberto", "0.00", "0.00"]);
    expect(await itensNoBanco(b.id)).toEqual([]);
    const rc = await confirmarCompra(b.id);
    expect(rc.statusCode, rc.body).toBe(200);
    const e = await efeitos(b.id);
    expect([e.situacao, e.movimentos.length, e.titulos.length, e.confirmacoes.length]).toEqual(["confirmado", 0, 0, 1]);
    // Premissa: a MESMA TOP, com item, dá entrada e gera a conta a pagar (o "zero" acima é do documento vazio).
    const p = await produto();
    const comItem = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId }));
    expect((await confirmarCompra(comItem.id)).statusCode).toBe(200);
    await esperarConfirmada(comItem.id, { produtoId: p.id, quantidade: "1", total: "10.00" });
  });

  it("SI-1b itens [] com frete → o título é o do total, sem movimento", async () => {
    const topId = await topCompra(permitido());
    const b = await compraLancada("compra", corpoCompra([], { tipo_operacao_id: topId, frete: "15.00", outras_despesas: "2.50" }));
    expect(b.valor_total).toBe("17.50");
    expect((await confirmarCompra(b.id)).statusCode).toBe(200);
    const e = await efeitos(b.id);
    expect([e.situacao, e.movimentos.length]).toEqual(["confirmado", 0]);
    expect(e.titulos.map((t) => [t.direction, t.status, t.amount])).toEqual([["payable", "open", "17.50"]]);
  });

  it("SI-1c Permitido + Automática: itens [] → 201 já confirmada, sem movimento e sem título", async () => {
    const topId = await topCompra(cfg4((x) => { x.geral.documentoSemItens = "permitido"; x.geral.confirmacao = "automatica"; }));
    const r = await lancarCompra("compra", corpoCompra([], { tipo_operacao_id: topId }));
    expect(r.statusCode, r.body).toBe(201);
    expect([corpo(r).situacao, corpo(r).confirmacaoAutomatica]).toEqual(["confirmado", { confirmado: true }]);
    const e = await efeitos(corpo(r).id);
    expect([e.situacao, e.movimentos.length, e.titulos.length]).toEqual(["confirmado", 0, 0]);
    expect(e.confirmacoes.map((a) => a.metadata!.automatica)).toEqual([true]);
  });
});

// ─────────────── SI-2 ───────────────

describe("SI-2 itens [] fora do Permitido do formato 4 → o 422 de HOJE; com TOP, a recusa da TOP vem antes", () => {
  it("SI-2a formato 1, 2 e 3 (mesmo com Permitido gravado), formato 4 Proibido e o PEDIDO → 422 idêntico; premissa: com um item, 201", async () => {
    const p = await produto();
    const casos: { nome: string; especie: "compra" | "pedido"; topId: string }[] = [
      { nome: "formato 1", especie: "compra", topId: await topCompra(configuracaoNeutraTop()) },
      { nome: "formato 2", especie: "compra", topId: await topCompra(configuracaoNeutraTopV2()) },
      { nome: "formato 3 com Permitido gravado", especie: "compra", topId: await topCompra(cfg3((x) => { x.geral.documentoSemItens = "permitido"; })) },
      { nome: "formato 4 Proibido", especie: "compra", topId: c.tops.compra },
      { nome: "pedido formato 4", especie: "pedido", topId: c.tops.pedidoCompra },
    ];
    for (const caso of casos) {
      const vazio = await lancarCompra(caso.especie, corpoCompra([], { tipo_operacao_id: caso.topId }, caso.especie));
      expect(vazio.statusCode, `${caso.nome}: ${vazio.body}`).toBe(422);
      expect(erro(vazio), caso.nome).toEqual(RECUSA_DOS_ITENS_VAZIOS);
      // Os itens vazios eram o ÚNICO defeito: o mesmo corpo, com um item, é aceito.
      const comItem = await lancarCompra(caso.especie, corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: caso.topId }, caso.especie));
      expect(comItem.statusCode, `${caso.nome}: ${comItem.body}`).toBe(201);
    }
  });

  it("SI-2b sem TOP: a recusa dos itens vem junto da leitura do corpo, como hoje (o 422 do esquema estrito, com os dois campos)", async () => {
    const semTop = corpoCompra([], {});
    delete semTop.tipo_operacao_id;
    const r = await lancarCompra("compra", semTop);
    expect(r.statusCode, r.body).toBe(422);
    // A recusa da TOP ausente, sozinha (o mesmo corpo com um item), é a primeira; a dos itens vem ao lado.
    const p = await produto();
    const soTop = corpoCompra([itemCompra(p.id)], {});
    delete soTop.tipo_operacao_id;
    const r1 = await lancarCompra("compra", soTop);
    expect(r1.statusCode, r1.body).toBe(422);
    const sozinha = erro(r1);
    expect(sozinha.details).toEqual([{ path: "tipo_operacao_id", message: "Campo obrigatório" }]);
    expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message: sozinha.message, details: [...(sozinha.details as unknown[]), { path: "itens", message: "Valor mínimo: 1" }] });
  });

  it("SI-2c a ORDEM nova, declarada: TOP inexistente (ou de outra família) e empresa sem acesso + itens [] → a recusa da TOP / da empresa, a MESMA do corpo com item", async () => {
    const p = await produto();
    const casos: { nome: string; extra: Record<string, unknown> }[] = [
      { nome: "TOP inexistente", extra: { tipo_operacao_id: "00000000-0000-4000-8000-0000000000aa" } },
      { nome: "TOP de pedido na compra", extra: { tipo_operacao_id: c.tops.pedidoCompra } },
      { nome: "empresa inexistente", extra: { empresa_id: "00000000-0000-4000-8000-0000000000bb" } },
    ];
    const recusas: Erro[] = [];
    for (const caso of casos) {
      const vazio = await lancarCompra("compra", corpoCompra([], caso.extra));
      const comItem = await lancarCompra("compra", corpoCompra([itemCompra(p.id)], caso.extra));
      expect(vazio.statusCode, `${caso.nome}: ${vazio.body}`).toBe(comItem.statusCode);
      expect(erro(vazio), caso.nome).toEqual(erro(comItem));
      expect(erro(vazio), `${caso.nome}: não é a recusa dos itens`).not.toEqual(RECUSA_DOS_ITENS_VAZIOS);
      recusas.push(erro(vazio));
    }
    expect(recusas.map((e) => [e.code, e.message])).toEqual([
      ["TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento"],
      ["TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento"],
      ["VALIDATION_ERROR", "Sem acesso à empresa informada"],
    ]);
    // O PEDIDO não mudou: TOP inexistente + itens [] continua recusando pelos itens, antes da TOP (como hoje).
    const pedido = await lancarCompra("pedido", corpoCompra([], { tipo_operacao_id: "00000000-0000-4000-8000-0000000000aa" }, "pedido"));
    expect(erro(pedido)).toEqual(RECUSA_DOS_ITENS_VAZIOS);
  });

  it("SI-2d TOP formato 4 Permitido + itens [] + OUTRO defeito → o 422 do esquema ESTRITO (com a recusa dos itens ao lado), como hoje", async () => {
    const topId = await topCompra(cfg4((x) => { x.geral.documentoSemItens = "permitido"; }));
    const p = await produto();
    // O outro defeito sozinho (o mesmo corpo com um item) — e o mesmo corpo com itens vazios: a recusa é a do estrito.
    const sozinha = erro(await lancarCompra("compra", corpoCompra([itemCompra(p.id)], { tipo_operacao_id: topId, data_documento: "2026-13-40" })));
    expect(sozinha.details).toEqual([{ path: "data_documento", message: expect.any(String) }]);
    const r = await lancarCompra("compra", corpoCompra([], { tipo_operacao_id: topId, data_documento: "2026-13-40" }));
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message: "Dados inválidos", details: [...(sozinha.details as unknown[]), { path: "itens", message: "Valor mínimo: 1" }] });
    // Premissa: sem o outro defeito, a MESMA TOP aceita os itens vazios (SI-1).
    expect((await lancarCompra("compra", corpoCompra([], { tipo_operacao_id: topId }))).statusCode).toBe(201);
  });
});

// ─────────────── AP-7 / AP-8 ───────────────

const sempre = () => cfg4((x) => { x.aprovacao.politica = "sempre"; });
const porValor = (minimo: string) => cfg4((x) => { x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = minimo; });

describe("AP-7 compra: o ciclo da aprovação (Sempre e A partir de um valor)", () => {
  it("AP-7a Sempre: confirmar → 409 PENDENTE (prévia lista, podeConfirmar false) → reprovar → 409 REPROVADA com o motivo → aprovar → confirma", async () => {
    const topId = await topCompra(sempre());
    const v = await versaoAtualNoBanco(topId);
    const p = await produto();
    const b = await compraLancada("compra", corpoCompra([itemCompra(p.id, "3", "10.00")], { tipo_operacao_id: topId }));
    expect(Object.keys(b), "Manual: o corpo de hoje").toEqual(CHAVES_DO_POST);

    // PENDENTE: a confirmação recusa antes de qualquer efeito, com os details do contrato.
    const pendente = await confirmarCompra(b.id);
    expect(pendente.statusCode, pendente.body).toBe(409);
    expect(erro(pendente)).toEqual({ code: "APROVACAO_PENDENTE", message: MSG_PENDENTE, details: { politica: "sempre", valorMinimo: null, valorDocumento: "30.00" } });
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
    // A prévia lista a MESMA recusa, no mesmo formato, e só ela.
    const pv = await previaCompra(b.id);
    expect(pv.statusCode, pv.body).toBe(200);
    expect([j(pv).podeConfirmar, j(pv).recusas]).toEqual([false, [erro(pendente)]]);

    // REPROVAR: uma decisão gravada, a compra aberta, a auditoria "reject" no documento.
    const motivo = "Preço acima do combinado";
    const rr = await reprovar("compras", b.id, { motivo });
    expect(rr.statusCode, rr.body).toBe(200);
    expect(j(rr)).toEqual({ aprovacao: { decisao: "reprovado", decididoEm: expect.any(String) } });
    const [reprovada] = await decisoesDe("aprovacoes_compra", b.id);
    expect(reprovada).toMatchObject({ decisao: "reprovado", observacao: motivo, decidido_por: c.h.demo.adminUserId, empresa_id: c.I.empresa,
      tipo_operacao_id: topId, tipo_operacao_versao_id: v.id, valor_documento: "30.00" });
    expect((await auditoriaDe("documentos_compra", b.id, "reject")).map((a) => a.metadata)).toEqual([{ motivo }]);
    const recusada = await confirmarCompra(b.id);
    expect(recusada.statusCode, recusada.body).toBe(409);
    expect(erro(recusada)).toEqual({ code: "APROVACAO_REPROVADA", message: "Este documento foi reprovado: Preço acima do combinado.",
      details: { motivo, decididoPor: { id: c.h.demo.adminUserId, nome: expect.any(String) }, decididoEm: (j(rr).aprovacao as { decididoEm: string }).decididoEm } });
    expect(j(await previaCompra(b.id)).recusas).toEqual([erro(recusada)]);
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);

    // APROVAR depois: decisão NOVA (a história fica) e a confirmação passa.
    const ra = await aprovar("compras", b.id, { observacao: "Renegociado" });
    expect(ra.statusCode, ra.body).toBe(200);
    expect(j(ra)).toEqual({ aprovacao: { decisao: "aprovado", decididoEm: expect.any(String) } });
    expect((await decisoesDe("aprovacoes_compra", b.id)).map((d) => [d.decisao, d.observacao])).toEqual([["reprovado", motivo], ["aprovado", "Renegociado"]]);
    expect((await auditoriaDe("documentos_compra", b.id, "approve")).map((a) => a.metadata)).toEqual([{ observacao: "Renegociado" }]);
    const pvOk = await previaCompra(b.id);
    expect([j(pvOk).podeConfirmar, j(pvOk).recusas]).toEqual([true, []]);
    expect((await confirmarCompra(b.id)).statusCode).toBe(200);
    await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "3", total: "30.00" });
  });

  it("AP-7a2 o motivo que JÁ fecha a frase (\"Preço alto.\") → o 409 diz \"…reprovado: Preço alto.\", com UM ponto final só; a prévia diz o mesmo", async () => {
    const topId = await topCompra(sempre());
    const p = await produto();
    const b = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId }));
    const motivo = "Preço alto.";
    const rr = await reprovar("compras", b.id, { motivo });
    expect(rr.statusCode, rr.body).toBe(200);
    expect((await decisoesDe("aprovacoes_compra", b.id)).map((d) => [d.decisao, d.observacao]),
      "premissa: o motivo gravado já termina em ponto").toEqual([["reprovado", motivo]]);

    const recusada = await confirmarCompra(b.id);
    expect(recusada.statusCode, recusada.body).toBe(409);
    expect(erro(recusada)).toEqual({ code: "APROVACAO_REPROVADA", message: "Este documento foi reprovado: Preço alto.",
      details: { motivo, decididoPor: { id: c.h.demo.adminUserId, nome: expect.any(String) }, decididoEm: (j(rr).aprovacao as { decididoEm: string }).decididoEm } });
    expect(erro(recusada).message.match(/\.+$/u)?.[0], "UM ponto final só, nunca \"..\"").toBe(".");
    expect(erro(recusada).message, "o texto à mão e a função do domínio dizem o mesmo").toBe(mensagemAprovacaoReprovada(motivo));
    expect(j(await previaCompra(b.id)).recusas).toEqual([erro(recusada)]);
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
  });

  it("AP-7b A partir de 1500.00: total 1500.00 (com frete) exige e, aprovada, confirma; 1499.99 não exige (aprovar → 409 NAO_EXIGIDA) e confirma direto", async () => {
    const topId = await topCompra(porValor("1500.00"));
    const p = await produto();
    // O total ATUAL do documento: itens 1400.00 + frete 100.00 = 1500.00 → "a partir de" inclui o igual.
    const limite = await compraLancada("compra", corpoCompra([itemCompra(p.id, "2", "700.00")], { tipo_operacao_id: topId, frete: "100.00" }));
    expect(limite.valor_total).toBe("1500.00");
    const pendente = await confirmarCompra(limite.id);
    expect(pendente.statusCode, pendente.body).toBe(409);
    expect(erro(pendente)).toEqual({ code: "APROVACAO_PENDENTE", message: MSG_PENDENTE, details: { politica: "por_valor", valorMinimo: "1500.00", valorDocumento: "1500.00" } });
    expect(await semEfeito(limite.id)).toEqual(["aberto", 0, 0, 0]);
    expect((await aprovar("compras", limite.id)).statusCode).toBe(200);
    expect((await confirmarCompra(limite.id)).statusCode).toBe(200);
    await esperarConfirmada(limite.id, { produtoId: p.id, quantidade: "2", total: "1500.00" });

    const q = await produto();
    const abaixo = await compraLancada("compra", corpoCompra([itemCompra(q.id, "1", "1499.99")], { tipo_operacao_id: topId }));
    const naoExigida = await aprovar("compras", abaixo.id);
    expect(naoExigida.statusCode, naoExigida.body).toBe(409);
    expect(erro(naoExigida)).toEqual({ code: "APROVACAO_NAO_EXIGIDA", message: MSG_NAO_EXIGIDA });
    expect(await decisoesDe("aprovacoes_compra", abaixo.id)).toEqual([]);
    expect([j(await previaCompra(abaixo.id)).podeConfirmar]).toEqual([true]);
    expect((await confirmarCompra(abaixo.id)).statusCode).toBe(200);
    await esperarConfirmada(abaixo.id, { produtoId: q.id, quantidade: "1", total: "1499.99" });
  });

  it("AP-7c Automática + Sempre: salvar → aberta, 'aguardando_aprovacao'; aprovar → confirma no mesmo pedido, pelo aprovador (com a capacidade DELE)", async () => {
    const topId = await topCompra(cfg4((x) => { x.geral.confirmacao = "automatica"; x.aprovacao.politica = "sempre"; }));
    const p = await produto();
    const r = await lancarCompra("compra", corpoCompra([itemCompra(p.id, "2", "10.00")], { tipo_operacao_id: topId }));
    expect(r.statusCode, r.body).toBe(201);
    const b = corpo(r);
    expect([b.situacao, b.confirmacaoAutomatica]).toEqual(["aberto", { confirmado: false, motivo: "aguardando_aprovacao" }]);
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);

    const aprovador = await usuario("Aprovador de compras", ["compras.view", "compras.approve", "compras.edit"]);
    const ra = await aprovar("compras", b.id, {}, aprovador);
    expect(ra.statusCode, ra.body).toBe(200);
    expect(j(ra)).toEqual({ aprovacao: { decisao: "aprovado", decididoEm: expect.any(String) }, confirmacaoAutomatica: { confirmado: true } });
    const e = await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "2", total: "20.00" });
    // Quem confirmou foi o APROVADOR (o autor da decisão), não quem salvou.
    const [decisao] = await decisoesDe("aprovacoes_compra", b.id);
    expect(decisao!.decidido_por).not.toBe(await autorDoCreate(b.id));
    expect([e.confirmacoes[0]!.user_id, e.confirmacoes[0]!.metadata!.automatica]).toEqual([decisao!.decidido_por, true]);
  });

  it("AP-7d Automática + Sempre, aprovador SEM compras.edit → aprovado e aberto, 'sem_permissao'; premissa: a confirmação manual passa", async () => {
    const topId = await topCompra(cfg4((x) => { x.geral.confirmacao = "automatica"; x.aprovacao.politica = "sempre"; }));
    const p = await produto();
    const b = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId }));
    const aprovador = await usuario("Aprovador sem edit", ["compras.view", "compras.approve"]);
    const ra = await aprovar("compras", b.id, {}, aprovador);
    expect(ra.statusCode, ra.body).toBe(200);
    expect(j(ra).confirmacaoAutomatica).toEqual({ confirmado: false, motivo: "sem_permissao" });
    expect((await decisoesDe("aprovacoes_compra", b.id)).map((d) => d.decisao)).toEqual(["aprovado"]);
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
    expect((await confirmarCompra(b.id)).statusCode).toBe(200);
    await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "1", total: "10.00" });
  });

  it("AP-7e receber pedido para compra Automática + Sempre → a gerada aberta, 'aguardando_aprovacao'; o pedido convertido; aprovar → confirma", async () => {
    const topDestino = await topCompra(cfg4((x) => { x.geral.confirmacao = "automatica"; x.aprovacao.politica = "sempre"; }));
    const p = await produto();
    const pedido = await pedidoPara(topDestino, [itemCompra(p.id, "2", "10.00")]);
    const b = corpo(await receberTudo(pedido, topDestino));
    expect([b.situacao, b.pedidoSituacao, b.confirmacaoAutomatica]).toEqual(["aberto", "convertido", { confirmado: false, motivo: "aguardando_aprovacao" }]);
    expect(await semEfeito(b.id)).toEqual(["aberto", 0, 0, 0]);
    const ra = await aprovar("compras", b.id);
    expect(j(ra).confirmacaoAutomatica).toEqual({ confirmado: true });
    await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "2", total: "20.00" });
  });
  it("AP-7f aprovar com a mesma Idempotency-Key: o mesmo corpo (com o resultado da automática); UMA decisão, UMA confirmação", async () => {
    const topId = await topCompra(cfg4((x) => { x.geral.confirmacao = "automatica"; x.aprovacao.politica = "sempre"; }));
    const p = await produto();
    const b = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId }));
    const chave = `tc08-ap7f-${unico()}`;
    const r1 = await aprovar("compras", b.id, { observacao: "Ok" }, c.h.headers(), chave);
    const r2 = await aprovar("compras", b.id, { observacao: "Ok" }, c.h.headers(), chave);
    expect([r1.statusCode, r2.statusCode], r2.body).toEqual([200, 200]);
    expect(j(r2)).toEqual(j(r1));
    expect(j(r1).confirmacaoAutomatica).toEqual({ confirmado: true });
    expect(await decisoesDe("aprovacoes_compra", b.id)).toHaveLength(1);
    await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "1", total: "10.00" });
  });

  /**
   * O id da URL em MAIÚSCULAS é o MESMO documento (a forma de UUID aceita as duas caixas), e a decisão fala dele pelo
   * id CANÔNICO, em minúsculas — o da venda (`bruto.toLowerCase()`) e o do estoque (`doc.id`). `audit_logs.entity_id`
   * é texto: gravado como veio, a trilha "approve" ficaria num id que nenhuma leitura do documento procura; e o hash da
   * idempotência com o texto cru tornaria o reenvio do MESMO pedido, escrito em minúsculas, um 409 "corpo diferente".
   */
  it("AP-7g id em MAIÚSCULAS: a trilha 'approve' grava o id em minúsculas; o replay com a mesma chave e o id em minúsculas devolve o MESMO corpo", async () => {
    const topId = await topCompra(sempre());
    const p = await produto();
    const b = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId }));
    const maiusculo = b.id.toUpperCase();
    expect(maiusculo, "premissa: o id tem letra (a caixa muda o texto)").not.toBe(b.id);
    const chave = `tc08-ap7g-${unico()}`;
    const r1 = await aprovar("compras", maiusculo, { observacao: "Caixa alta" }, c.h.headers(), chave);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(j(r1)).toEqual({ aprovacao: { decisao: "aprovado", decididoEm: expect.any(String) } });
    // A trilha está no id CANÔNICO, e nenhuma linha dela ficou no id em maiúsculas.
    expect((await trilhaDoServico(b.id, "approve")).map((a) => a.metadata)).toEqual([{ observacao: "Caixa alta" }]);
    expect(await auditoriaDe("documentos_compra", maiusculo)).toEqual([]);

    // O REPLAY: a mesma chave, o mesmo corpo, o id em minúsculas → o MESMO corpo gravado; nenhuma decisão nem trilha nova.
    const r2 = await aprovar("compras", b.id, { observacao: "Caixa alta" }, c.h.headers(), chave);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(r2)).toEqual(j(r1));
    expect((await decisoesDe("aprovacoes_compra", b.id)).map((d) => [d.decisao, d.observacao])).toEqual([["aprovado", "Caixa alta"]]);
    expect(await trilhaDoServico(b.id, "approve")).toHaveLength(1);
    // PREMISSA: a decisão valeu para o documento — a confirmação passa.
    expect((await confirmarCompra(b.id)).statusCode).toBe(200);
    await esperarConfirmada(b.id, { produtoId: p.id, quantidade: "1", total: "10.00" });
  });
});

describe("AP-8 compra: o que não passa por aprovação", () => {
  it("AP-8a não exige (formato 4 Sem aprovação; formato 3 com Sempre gravado) → 409 APROVACAO_NAO_EXIGIDA, sem decisão; confirma direto", async () => {
    const p = await produto();
    for (const configuracao of [cfg4(), cfg3((x) => { x.aprovacao.politica = "sempre"; })]) {
      const b = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: await topCompra(configuracao) }));
      for (const r of [await aprovar("compras", b.id), await reprovar("compras", b.id, { motivo: "Não" })]) {
        expect(r.statusCode, r.body).toBe(409);
        expect(erro(r)).toEqual({ code: "APROVACAO_NAO_EXIGIDA", message: MSG_NAO_EXIGIDA });
      }
      expect(await decisoesDe("aprovacoes_compra", b.id)).toEqual([]);
      expect((await confirmarCompra(b.id)).statusCode, `formato ${configuracao.versaoSchema}: confirma sem aprovação`).toBe(200);
    }
  });

  it("AP-8b confirmada ou cancelada → 409 CONFLICT 'Só documento aberto passa por aprovação.', sem decisão nova", async () => {
    const topId = await topCompra(sempre());
    const p = await produto();
    const confirmada = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId }));
    expect((await aprovar("compras", confirmada.id)).statusCode, "premissa: aberta, a aprovação é aceita").toBe(200);
    expect((await confirmarCompra(confirmada.id)).statusCode).toBe(200);
    const cancelada = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId }));
    const rc = await c.ligada.inject({ method: "POST", url: `/api/compras/compras/${cancelada.id}/cancel`, headers: c.h.headers(), payload: {} });
    expect(rc.statusCode, rc.body).toBe(200);
    for (const id of [confirmada.id, cancelada.id]) {
      const antes = (await decisoesDe("aprovacoes_compra", id)).length;
      for (const r of [await aprovar("compras", id), await reprovar("compras", id, { motivo: "Tarde demais" })]) {
        expect(r.statusCode, r.body).toBe(409);
        expect(erro(r)).toEqual({ code: "CONFLICT", message: MSG_SO_ABERTO });
      }
      expect(await decisoesDe("aprovacoes_compra", id)).toHaveLength(antes);
    }
  });

  it("AP-8c pedido de compra, id inexistente e id malformado → a MESMA 404 do GET; sem compras.approve → 403; reprovar sem motivo → 422", async () => {
    const topId = await topCompra(sempre());
    const p = await produto();
    const b = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId }));
    const pedido = await compraLancada("pedido", corpoCompra([itemCompra(p.id)], {}, "pedido"));
    const get404 = await c.ligada.inject({ method: "GET", url: `/api/compras/compras/${pedido.id}`, headers: c.h.headers() });
    expect(get404.statusCode).toBe(404);
    for (const id of [pedido.id, "00000000-0000-4000-8000-0000000000cc", "nao-e-uuid"]) {
      const r = await aprovar("compras", id);
      expect(r.statusCode, `${id}: ${r.body}`).toBe(404);
      expect(erro(r)).toEqual(erro(get404));
    }
    const semApprove = await usuario("Comprador sem aprovar", ["compras.view", "compras.edit"]);
    expect((await aprovar("compras", b.id, {}, semApprove)).statusCode).toBe(403);
    const semMotivo = await reprovar("compras", b.id, {});
    expect(semMotivo.statusCode, semMotivo.body).toBe(422);
    expect(await decisoesDe("aprovacoes_compra", b.id)).toEqual([]);
  });
});

// ─────────────── AP-12 ───────────────

/**
 * O UPDATE DIRETO aberto → confirmado (o que um binário anterior, sem o passo da aprovação, faria), numa transação
 * que SEMPRE volta: o superusuário (`c.admin`) ou o `erp_app` com o contexto de tenant do administrador (a pool do
 * harness, como a API). Devolve as linhas atualizadas, ou lança o erro do banco.
 */
async function updateDireto(comoApp: boolean, id: string): Promise<number> {
  const cli = await (comoApp ? c.h.db : c.admin).connect();
  try {
    await cli.query("begin");
    if (comoApp) {
      await cli.query("select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.modulo_empresa', 'compras', true)",
        [c.h.demo.orgId, c.h.demo.adminUserId]);
    }
    const r = await cli.query("update erp.documentos_compra set situacao='confirmado' where id=$1 and situacao='aberto'", [id]);
    return r.rowCount ?? 0;
  } finally {
    await cli.query("rollback");
    cli.release();
  }
}
const falhaDe = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { code?: string; message?: string });

describe("AP-12 compra: a guarda do banco barra aberto → confirmado sem aprovação vigente (CONFLICT); formato 1 a 3 nunca", () => {
  it("AP-12a formato 4 Sempre, sem decisão e reprovada → recusado (superusuário e erp_app), 409 CONFLICT sem details; aprovada → passa", async () => {
    const topId = await topCompra(sempre());
    const p = await produto();
    const b = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: topId }));
    for (const comoApp of [false, true]) {
      const e = await falhaDe(updateDireto(comoApp, b.id));
      expect(e, `sem decisão (${comoApp ? "erp_app" : "superusuário"})`).toMatchObject({ code: "P0001", message: `CONFLICT: ${MSG_PENDENTE}` });
      // A tradução que todo binário conhece: 409 CONFLICT, com a mensagem fixa e sem details.
      const d = fromPgError(e)!;
      expect([d.httpStatus, d.toJSON()]).toEqual([409, { code: "CONFLICT", message: MSG_PENDENTE, details: undefined }]);
    }
    expect((await reprovar("compras", b.id, { motivo: "Fora do orçamento" })).statusCode).toBe(200);
    // A mensagem é FIXA (igualdade exata): o motivo livre da reprovação não entra nela.
    for (const comoApp of [false, true]) {
      expect(await falhaDe(updateDireto(comoApp, b.id))).toMatchObject({ code: "P0001", message: `CONFLICT: ${MSG_GUARDA_REPROVADO}` });
    }
    // Premissa: aprovada, o MESMO UPDATE passa — a guarda não é uma recusa cega.
    expect((await aprovar("compras", b.id)).statusCode).toBe(200);
    for (const comoApp of [false, true]) expect(await updateDireto(comoApp, b.id)).toBe(1);
    expect(await situacaoNoBanco("documentos_compra", b.id), "a transação do teste voltou").toBe("aberto");
  });

  it("AP-12b formato 1, 2 e 3 com Sempre gravado, e formato 4 abaixo do valor mínimo → o UPDATE direto passa (superusuário e erp_app)", async () => {
    const p = await produto();
    const v1 = configuracaoNeutraTop(); v1.aprovacao.politica = "sempre";
    const v2 = configuracaoNeutraTopV2(); v2.aprovacao.politica = "sempre";
    const casos: { nome: string; configuracao: { versaoSchema: number } }[] = [
      { nome: "formato 1", configuracao: v1 },
      { nome: "formato 2", configuracao: v2 },
      { nome: "formato 3", configuracao: cfg3((x) => { x.aprovacao.politica = "sempre"; }) },
      { nome: "formato 4 abaixo do mínimo", configuracao: porValor("1000.00") },
    ];
    for (const caso of casos) {
      const b = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: await topCompra(caso.configuracao) }));
      for (const comoApp of [false, true]) expect(await updateDireto(comoApp, b.id), `${caso.nome} (${comoApp ? "erp_app" : "superusuário"})`).toBe(1);
    }
  });
});
