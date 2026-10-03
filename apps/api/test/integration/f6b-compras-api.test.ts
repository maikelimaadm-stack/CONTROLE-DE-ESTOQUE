import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { configuracaoNeutraTopV5, type ConfiguracaoTipoOperacaoV4, type ConfiguracaoTipoOperacaoV5 } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, unico, cfg4, top, versaoAtualNoBanco, usuario, escopos, produto, DATA,
  itemCompra, corpoCompra, compraLancada, lerCompra, aprovar, reprovar, decisoesDe,
  type Hdr, type Resposta, type Erro, type ItemCompra, type Produto,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F6b (decisão 283) — OS TRÊS ACRÉSCIMOS DE API DAS TELAS DE COMPRAS (plano F6b §1.3, A1–A3; SP-1..SP-4).
 *
 *   · SP-1 A1 — `GET /api/aprovacoes/compras/:id` lê também o PEDIDO: a situação pela conta do FINALIZAR, com a
 *          cobertura do valor (pendente → aprovado → o vencedor mais caro → pendente com a última decisão → aprovado →
 *          finalizado = nao_aberto, sem ler a TOP), sem ler os orçamentos do pedido nem os preços deles; a TOP neutra →
 *          nao_exigida; o formato 5 → pendente → reprovado;
 *   · SP-2 A1 — as recusas: sem `pedidos_compra.view` o pedido é a MESMA 404 de inexistente; sem `compras.view`, 403
 *          antes de ler; o orçamento, o pedido fora do escopo e o id malformado (que nunca vai ao SQL) → a MESMA 404;
 *          parâmetro → 422;
 *   · SP-3 A2 — `/proximos-passos` ganha `orcamentos` no FIM, só com `orcamentos_compra.create` (sem ela, a chave não
 *          existe); as duas espécies saem da MESMA leitura da política (uma, com e sem a capacidade); `items` continua
 *          só a compra, igual ao de hoje;
 *   · SP-4 A3 — a leitura do pedido: cada orçamento com a condição (código e nome) e o preço de cada item, em UMA
 *          consulta; sem `orcamentos_compra.view`, nada roda nem aparece; 1 e 3 orçamentos = as MESMAS consultas.
 *
 * O QUE CONTA COMO PROVA (o molde da TOP-CONFIG-08 e da F2): a situação é conferida contra a PRÉVIA DA FINALIZAÇÃO (a
 * MESMA conta, pela rota do finalizar) e contra as decisões que o BANCO guarda; os preços, contra as linhas do banco
 * (testemunha `c.admin`, superusuário sem RLS); "não roda" é medido pelo espião de consultas (`pg.Client`); toda
 * recusa vem com a PREMISSA ao lado (o mesmo usuário, ou o mesmo documento, passa sem o obstáculo).
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── chamadas ───────────────

type SituacaoDoPedido = "nao_aberto" | "nao_exigida" | "pendente" | "aprovado" | "reprovado";
interface UltimaDecisao { decisao: "aprovado" | "reprovado"; observacao: string | null; decididoPor: { id: string; nome: string }; decididoEm: string }
interface Situacao { situacao: SituacaoDoPedido; ultimaDecisao: UltimaDecisao | null }

const inject = (method: "GET" | "POST", url: string, headers: Hdr = c.h.headers(), payload?: unknown): Promise<Resposta> =>
  c.ligada.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

/** O GET da situação, cru. `query` é o texto depois do `?`. */
const lerSituacao = (id: string, headers: Hdr = c.h.headers(), query = ""): Promise<Resposta> =>
  inject("GET", `/api/aprovacoes/compras/${id}${query ? `?${query}` : ""}`, headers);
/** O GET da situação que DEVE responder 200; confere as chaves EXATAS do contrato. */
async function situacao(id: string, headers: Hdr = c.h.headers()): Promise<Situacao> {
  const r = await lerSituacao(id, headers);
  expect(r.statusCode, `${id}: ${r.body}`).toBe(200);
  const b = j(r);
  expect(Object.keys(b), "o contrato da resposta: só as duas chaves").toEqual(["situacao", "ultimaDecisao"]);
  return b as unknown as Situacao;
}

/** A prévia da finalização do pedido (a conta do finalizar, F6a): a premissa da situação. */
async function previaDaFinalizacao(id: string): Promise<{ podeFinalizar: boolean; aprovacao: { situacao: string } | null; recusas: Erro[] }> {
  const r = await inject("GET", `/api/compras/pedidos/${id}/previa-finalizacao`);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as { podeFinalizar: boolean; aprovacao: { situacao: string } | null; recusas: Erro[] };
}

const aprovarParaOrcamento = (pedidoId: string) => inject("POST", `/api/compras/pedidos/${pedidoId}/aprovar-para-orcamento`, c.h.headers(), {});
const criarOrcamento = (pedidoId: string, corpo: unknown) => inject("POST", `/api/compras/pedidos/${pedidoId}/orcamentos`, c.h.headers(), corpo);
const escolher = (pedidoId: string, orcamentoId: string) => inject("POST", `/api/compras/pedidos/${pedidoId}/orcamentos/${orcamentoId}/escolher`, c.h.headers(), {});
const finalizar = (id: string) => inject("POST", `/api/compras/pedidos/${id}/finalizar`, c.h.headers(), {});
const proximosPassos = (id: string, headers: Hdr = c.h.headers()) => inject("GET", `/api/compras/pedidos/${id}/proximos-passos`, headers);
const lerOrcamento = (id: string, headers: Hdr = c.h.headers()) => inject("GET", `/api/compras/orcamentos/${id}`, headers);

/** A decisão que DEVE ter passado (200): o `decididoEm` dela. */
function decididoEm(r: Resposta): string {
  expect(r.statusCode, r.body).toBe(200);
  return (j(r).aprovacao as { decididoEm: string }).decididoEm;
}

// ─────────────── o espião de consultas (o molde do SA-8) ───────────────

/** As SQL que a aplicação mandou ao banco durante `fn` (o espião de `pg.Client.prototype.query`). */
async function comConsultas(fn: () => Promise<Resposta>): Promise<{ r: Resposta; sqls: string[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await fn();
    const sqls = espiao.mock.calls.map((x) => (typeof x[0] === "string" ? x[0] : (x[0] as { text?: unknown } | undefined)?.text)).filter((x): x is string => typeof x === "string");
    return { r, sqls };
  } finally { espiao.mockRestore(); }
}
const quantas = (sqls: string[], re: RegExp) => sqls.filter((s) => re.test(s)).length;
/** A leitura da versão congelada da TOP (`lerVersaoCongeladaTop`) — a "TOP lida" da conta. */
const SQL_VERSAO_TOP = /select v\.configuracao, t\.codigo_base\s+from erp\.tipos_operacao_versoes v\b/;
/** Qualquer leitura do documento de compra (a da espécie, a do GET por id). */
const SQL_DOCUMENTO = /from erp\.documentos_compra d\b/;
/** A política de destinos da versão do pedido (`linhasDaPoliticaDeDestinos`): todas as espécies numa leitura. */
const SQL_POLITICA = /from erp\.tipos_operacao_versoes vo\b/;
/** A lista dos orçamentos do pedido (na leitura do pedido). */
const SQL_ORCAMENTOS = /from erp\.documentos_compra o\s+join erp\.people fo\b[\s\S]*o\.pedido_orcado_id = \$2/;
/** Os preços por item dos orçamentos do pedido (A3). */
const SQL_ITENS_DOS_ORCAMENTOS = /from erp\.documentos_compra_itens i\s+join erp\.documentos_compra o on o\.id = i\.documento_id[\s\S]*o\.pedido_orcado_id = \$2/;

// ─────────────── cenário ───────────────

type Cfg = ConfiguracaoTipoOperacaoV4 | ConfiguracaoTipoOperacaoV5;
const sempre = (x: Cfg) => { x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null; };
/** O neutro do FORMATO 5 do domínio, com o ajuste do caso. */
function cfg5(ajuste: (x: ConfiguracaoTipoOperacaoV5) => void = () => {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  ajuste(x);
  return x;
}

/** Uma TOP nova da família, com a PREMISSA de que o banco guardou a versão no formato pedido. */
async function topNoFormato(codigoBase: string, configuracao: { versaoSchema: number }, extra: Record<string, unknown> = {}): Promise<string> {
  const id = await top(codigoBase, { configuracao, ...extra });
  expect((await versaoAtualNoBanco(id)).configuracao_schema_version, `premissa: a versão de ${codigoBase} está no formato ${configuracao.versaoSchema}`)
    .toBe(configuracao.versaoSchema);
  return id;
}

/** Um fornecedor NOVO (superusuário), vivo. */
async function fornecedor(): Promise<{ id: string; nome: string }> {
  const s = unico();
  const r = await c.admin.query<{ id: string; name: string }>(
    "insert into erp.people (organization_id, code, name, person_type, is_provider, is_client) values ($1, $2, $3, 'legal', true, false) returning id, name",
    [c.h.demo.orgId, `F6B${s}`, `Fornecedor F6b ${s}`]);
  return { id: r.rows[0]!.id, nome: r.rows[0]!.name };
}

/** Uma condição de pagamento NOVA (1 parcela a 30 dias), com o código e o nome que o banco guardou. */
async function condicao(): Promise<{ id: string; codigo: string; nome: string }> {
  const s = unico();
  const r = await c.admin.query<{ id: string; code: string; nome: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,1,30,'intervalo',30,false) returning id, code, nome",
    [c.h.demo.orgId, `F6B-${s}`, `Condição F6b ${s}`]);
  return { id: r.rows[0]!.id, codigo: r.rows[0]!.code, nome: r.rows[0]!.nome };
}

/** O código e o nome da versão corrente de uma TOP (o que o leque de `/proximos-passos` mostra). */
async function topNoBanco(topId: string): Promise<{ codigo: string; nome: string }> {
  const r = await c.admin.query<{ codigo: string; nome: string }>(
    `select t.codigo, v.nome from erp.tipos_operacao t
       join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.versao = t.versao_atual where t.id = $1`, [topId]);
  expect(r.rows, "premissa: a TOP tem versão corrente").toHaveLength(1);
  return r.rows[0]!;
}

type PedidoCriado = { id: string; codigo: string; itens: { id: string }[] };
/** Um pedido lançado pela API com a TOP dada, e os itens dele no banco (na ordem da posição). */
async function pedido(itens: ItemCompra[], topPedido: string = c.tops.pedidoCompra, extra: Record<string, unknown> = {}, headers?: Hdr): Promise<PedidoCriado> {
  const p = await compraLancada("pedido", corpoCompra(itens, { tipo_operacao_id: topPedido, ...extra }, "pedido"), headers);
  const linhas = (await c.admin.query<{ id: string }>("select id from erp.documentos_compra_itens where documento_id=$1 order by posicao, id", [p.id])).rows;
  expect(linhas, "premissa: o pedido tem os itens do corpo").toHaveLength(itens.length);
  expect(p.situacao, "premissa: o pedido nasce aberto").toBe("aberto");
  return { id: p.id, codigo: String(p.codigo), itens: linhas };
}

interface Cotacao { topOrc: string; topCompra: string | null; topPedido: string; ped: PedidoCriado; produtos: [Produto, Produto] }
/**
 * O CENÁRIO DA COTAÇÃO (o molde da F6a): a TOP de orçamento (formato 4 neutro), a TOP de pedido com a aresta para ela
 * (ordem 0) e, com `comCompra`, para uma TOP de compra "Em partes" (ordem 1); um pedido de dois itens — 3 × 10,00 e
 * 2 × 5,00 = 40,00 — e, salvo `aprovado: false`, o pedido aprovado para orçamento.
 */
async function cotacao(o: { configPedido?: Cfg; condicoesOrcamento?: string[]; comCompra?: boolean; aprovado?: boolean; extraPedido?: Record<string, unknown>; armazem?: string } = {}): Promise<Cotacao> {
  const topOrc = await topNoFormato("compras.orcamento", cfg4(), o.condicoesOrcamento ? { condicoesPermitidas: o.condicoesOrcamento } : {});
  const topCompra = o.comCompra ? await topNoFormato("compras.compra", cfg4()) : null;
  const destinos = [{ tipoOperacaoId: topOrc, ordem: 0, emPartes: false }, ...(topCompra ? [{ tipoOperacaoId: topCompra, ordem: 1, emPartes: true }] : [])];
  const topPedido = await topNoFormato("compras.pedido", o.configPedido ?? cfg4(), { destinos });
  const produtos: [Produto, Produto] = [await produto(), await produto()];
  const armazem = o.armazem ? { armazem_id: o.armazem } : {};
  const ped = await pedido([itemCompra(produtos[0].id, "3", "10.00", armazem), itemCompra(produtos[1].id, "2", "5.00", armazem)], topPedido, o.extraPedido);
  if (o.aprovado !== false) expect((await aprovarParaOrcamento(ped.id)).statusCode, "premissa: o pedido é aprovado para orçamento").toBe(200);
  return { topOrc, topCompra, topPedido, ped, produtos };
}

/** Cria um orçamento do pedido com os preços por item (na ordem dos itens do pedido) e devolve o id e o código. */
async function orcamento(k: Cotacao, precos: string[], extra: Record<string, unknown> = {}): Promise<{ id: string; codigo: string; fornecedor: { id: string; nome: string } }> {
  const f = await fornecedor();
  const itens = precos.map((valor_unitario, i) => ({ item_pedido_id: k.ped.itens[i]!.id, valor_unitario }));
  const r = await criarOrcamento(k.ped.id, { tipo_operacao_id: k.topOrc, fornecedor_id: f.id, data_documento: DATA, itens, ...extra });
  expect(r.statusCode, `premissa: o orçamento é criado — ${r.body}`).toBe(201);
  return { id: j(r).id as string, codigo: j(r).codigo as string, fornecedor: f };
}

/** As linhas de preço de um orçamento no BANCO (a testemunha da A3), na ordem da posição. */
async function precosNoBanco(orcamentoId: string): Promise<{ item_pedido_orcado_id: string; valor_unitario: string; valor_total: string }[]> {
  return (await c.admin.query<{ item_pedido_orcado_id: string; valor_unitario: string; valor_total: string }>(
    `select item_pedido_orcado_id, valor_unitario::text, valor_total::text from erp.documentos_compra_itens
      where documento_id = $1 order by posicao, id`, [orcamentoId])).rows;
}

/** O administrador do harness (quem decide quando o caso não diz outro). */
async function admin(): Promise<{ id: string; nome: string }> {
  const nome = (await c.admin.query<{ name: string }>("select name from erp.users where id=$1", [c.h.demo.adminUserId])).rows[0]!.name;
  return { id: c.h.demo.adminUserId, nome };
}

// ─────────────── SP-1 ───────────────

describe("SP-1 A1 — a situação do PEDIDO pela conta do finalizar (com a cobertura do valor)", () => {
  it("SP-1a 'Sempre': pendente → aprovado → o vencedor mais caro → pendente com a última decisão → aprovado de novo → finalizado = nao_aberto, sem ler a TOP", async () => {
    const k = await cotacao({ configPedido: cfg4(sempre), aprovado: false });
    const quem = await admin();

    // PENDENTE, sem decisão — a prévia da finalização faz a MESMA conta.
    expect(await situacao(k.ped.id)).toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(await previaDaFinalizacao(k.ped.id), "premissa: a prévia diz o mesmo — pendente")
      .toMatchObject({ podeFinalizar: false, aprovacao: { situacao: "pendente" } });

    // APROVADO pela fila, com quem, quando e a observação.
    const em1 = decididoEm(await aprovar("compras", k.ped.id, { observacao: "Pedido conferido" }));
    const primeira: UltimaDecisao = { decisao: "aprovado", observacao: "Pedido conferido", decididoPor: quem, decididoEm: em1 };
    expect(await situacao(k.ped.id)).toEqual({ situacao: "aprovado", ultimaDecisao: primeira });
    expect(await previaDaFinalizacao(k.ped.id), "premissa: a prévia diz o mesmo — aprovado").toMatchObject({ podeFinalizar: true, aprovacao: { situacao: "aprovado" } });

    // O VENCEDOR MAIS CARO: 3 × 12,00 + 2 × 6,00 = 48,00 > os 40,00 aprovados — a aprovação deixa de COBRIR.
    expect((await aprovarParaOrcamento(k.ped.id)).statusCode).toBe(200);
    const caro = await orcamento(k, ["12.00", "6.00"]);
    await orcamento(k, ["9.00", "4.00"]);
    const v = await escolher(k.ped.id, caro.id);
    expect(v.statusCode, v.body).toBe(200);
    const decisoes = await decisoesDe("aprovacoes_compra", k.ped.id);
    expect(decisoes.map((d) => [d.decisao, d.valor_documento]), "premissa: a última decisão é a aprovação de 40,00").toEqual([["aprovado", "40.00"]]);
    expect((await c.admin.query<{ v: string }>("select valor_total::text v from erp.documentos_compra where id=$1", [k.ped.id])).rows[0]!.v,
      "premissa: o vencedor levou o pedido a 48,00").toBe("48.00");
    expect(await situacao(k.ped.id), "a aprovação que não cobre volta a pendente; a última decisão continua a de antes")
      .toEqual({ situacao: "pendente", ultimaDecisao: primeira });
    expect(await previaDaFinalizacao(k.ped.id), "premissa: a prévia diz o mesmo — pendente").toMatchObject({ podeFinalizar: false, aprovacao: { situacao: "pendente" } });

    // APROVADO DE NOVO: cobre os 48,00.
    const em2 = decididoEm(await aprovar("compras", k.ped.id, {}));
    const segunda: UltimaDecisao = { decisao: "aprovado", observacao: null, decididoPor: quem, decididoEm: em2 };
    const aberto = await comConsultas(() => lerSituacao(k.ped.id));
    expect([aberto.r.statusCode, j(aberto.r)]).toEqual([200, { situacao: "aprovado", ultimaDecisao: segunda }]);
    expect(quantas(aberto.sqls, SQL_VERSAO_TOP), "premissa: no aberto a TOP é lida (uma vez)").toBe(1);
    // A conta não usa os orçamentos: a situação não os lê, nem os preços — PREMISSA: o mesmo usuário, na leitura do
    // MESMO pedido, lê os dois (ele tem `orcamentos_compra.view`, e o pedido tem orçamentos com itens).
    const leitura = await comConsultas(() => inject("GET", `/api/compras/pedidos/${k.ped.id}`));
    expect(leitura.r.statusCode, leitura.r.body).toBe(200);
    expect([quantas(leitura.sqls, SQL_ORCAMENTOS), quantas(leitura.sqls, SQL_ITENS_DOS_ORCAMENTOS)], "premissa: a leitura do pedido lê os orçamentos e os preços")
      .toEqual([1, 1]);
    expect([quantas(aberto.sqls, SQL_ORCAMENTOS), quantas(aberto.sqls, SQL_ITENS_DOS_ORCAMENTOS)], "a situação não lê os orçamentos nem os preços").toEqual([0, 0]);

    // FINALIZADO → nao_aberto, com a última decisão, e a TOP NÃO é lida.
    const fin = await finalizar(k.ped.id);
    expect(fin.statusCode, fin.body).toBe(200);
    const fechado = await comConsultas(() => lerSituacao(k.ped.id));
    expect([fechado.r.statusCode, j(fechado.r)]).toEqual([200, { situacao: "nao_aberto", ultimaDecisao: segunda }]);
    expect(quantas(fechado.sqls, SQL_VERSAO_TOP), "o pedido que não está aberto não lê a TOP").toBe(0);
    expect(quantas(fechado.sqls, SQL_DOCUMENTO), "premissa: o espião viu a leitura do documento").toBeGreaterThan(0);
    expect(await decisoesDe("aprovacoes_compra", k.ped.id), "ler a situação não grava decisão").toHaveLength(2);
  });

  it("SP-1b TOP neutra → nao_exigida; formato 5 'Sempre' → pendente → reprovado (a prévia diz o mesmo)", async () => {
    const p = await produto();
    const neutro = await pedido([itemCompra(p.id, "1", "10.00")]);
    expect(await situacao(neutro.id)).toEqual({ situacao: "nao_exigida", ultimaDecisao: null });
    expect(await previaDaFinalizacao(neutro.id), "premissa: a prévia diz o mesmo").toMatchObject({ podeFinalizar: true, aprovacao: { situacao: "nao_exigida" } });

    // No 5, a aprovação do pedido anda junto com "Exigir pedido finalizado para receber" (decisão do Maike de 03/10).
    const t5 = await topNoFormato("compras.pedido", cfg5((x) => { sempre(x); x.fluxoCompra.exigeFinalizar = true; }));
    const ped5 = await pedido([itemCompra(p.id, "2", "10.00")], t5);
    expect(await situacao(ped5.id)).toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(await previaDaFinalizacao(ped5.id), "premissa: a prévia diz o mesmo").toMatchObject({ aprovacao: { situacao: "pendente" } });
    const r = await reprovar("compras", ped5.id, { motivo: "Fornecedor bloqueado" });
    expect(r.statusCode, r.body).toBe(200);
    const em = (j(r).aprovacao as { decididoEm: string }).decididoEm;
    expect(await situacao(ped5.id)).toEqual({ situacao: "reprovado",
      ultimaDecisao: { decisao: "reprovado", observacao: "Fornecedor bloqueado", decididoPor: await admin(), decididoEm: em } });
    const previa = await previaDaFinalizacao(ped5.id);
    expect([previa.aprovacao, previa.recusas.map((x) => x.code)], "premissa: a prévia diz o mesmo — reprovado").toEqual([{ situacao: "reprovado" }, ["APROVACAO_REPROVADA"]]);
  });
});

// ─────────────── SP-2 ───────────────

describe("SP-2 A1 — as recusas: a MESMA 404, o 403 antes de ler e o 422", () => {
  it("SP-2a compras.view sem pedidos_compra.view → o pedido é a MESMA 404 de inexistente (premissa: o mesmo usuário lê a compra); pedidos_compra.view sem compras.view → 403 antes de ler (premissa: ele lê o pedido)", async () => {
    const k = await cotacao({ configPedido: cfg4(sempre), aprovado: false });
    const compraSempre = await topNoFormato("compras.compra", cfg4(sempre));
    const compra = (await compraLancada("compra", corpoCompra([itemCompra((await produto()).id, "1", "10.00")], { tipo_operacao_id: compraSempre }))).id;
    const referencia = await lerSituacao(randomUUID());
    expect(referencia.statusCode, referencia.body).toBe(404);
    expect(erro(referencia)).toEqual({ code: "NOT_FOUND", message: "Documento não encontrado" });

    const soCompras = await usuario("Só vê compras F6b", ["compras.view"]);
    const r = await lerSituacao(k.ped.id, soCompras);
    expect([r.statusCode, r.body], "o pedido sem pedidos_compra.view: a MESMA 404").toEqual([404, referencia.body]);
    expect(await situacao(compra, soCompras), "premissa: o mesmo usuário lê a situação de uma compra").toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(await situacao(k.ped.id), "premissa: o pedido existe e tem situação (o administrador a lê)").toEqual({ situacao: "pendente", ultimaDecisao: null });

    const soPedidos = await usuario("Só vê pedidos de compra F6b", ["pedidos_compra.view"]);
    for (const alvo of [k.ped.id, compra, "nao-e-uuid"]) {
      const { r: negado, sqls } = await comConsultas(() => lerSituacao(alvo, soPedidos, "foo=1"));
      expect([alvo, negado.statusCode], negado.body).toEqual([alvo, 403]);
      expect(erro(negado).code).toBe("PERMISSION_DENIED");
      expect(quantas(sqls, /erp\.(documentos_compra|tipos_operacao_versoes|aprovacoes_compra)\b/), "nenhuma leitura do documento, da TOP ou da decisão").toBe(0);
    }
    const g = await lerCompra("pedido", k.ped.id, soPedidos);
    expect(g.statusCode, `premissa: ele lê o pedido pela porta do pedido — ${g.body}`).toBe(200);
  });

  it("SP-2b orçamento, pedido de outra empresa fora do escopo, inexistente e id malformado → a MESMA 404 (o malformado nunca vai ao SQL); parâmetro → 422 antes da 404", async () => {
    const k = await cotacao();
    const o = await orcamento(k, ["10.00", "5.00"]);
    const kB = await cotacao({ extraPedido: { empresa_id: c.I.empresa2 }, armazem: c.I.warehouseEmpresa2, aprovado: false });
    const soA = await usuario("Vê compras e pedidos só da A F6b", ["compras.view", "pedidos_compra.view"], escopos({ compras: [c.I.empresa] }));
    const naoExiste = randomUUID();
    const referencia = await lerSituacao(naoExiste);
    expect(referencia.statusCode, referencia.body).toBe(404);

    const casos: { nome: string; id: string; headers?: Hdr }[] = [
      { nome: "orçamento de compra", id: o.id },
      { nome: "pedido da empresa 2 para quem só vê a 1", id: kB.ped.id, headers: soA },
      { nome: "inexistente", id: naoExiste, headers: soA },
      { nome: "id malformado", id: "nao-e-uuid" },
      { nome: "id malformado (quase uuid)", id: `${naoExiste.slice(0, -1)}x` },
    ];
    for (const caso of casos) {
      const r = await lerSituacao(caso.id, caso.headers);
      expect([caso.nome, r.statusCode, r.body]).toEqual([caso.nome, 404, referencia.body]);
    }
    // O MALFORMADO NUNCA VAI AO SQL (22P02 seria 500): nenhuma leitura do documento.
    const { r: malformado, sqls } = await comConsultas(() => lerSituacao("nao-e-uuid"));
    expect([malformado.statusCode, quantas(sqls, SQL_DOCUMENTO)]).toEqual([404, 0]);

    // PREMISSAS: legíveis por quem os enxerga — o orçamento pela porta dele; o pedido da A por quem só vê a A; o da B pelo administrador.
    expect((await lerOrcamento(o.id)).statusCode, "premissa: o orçamento existe").toBe(200);
    const kA = await cotacao({ aprovado: false });
    expect(await situacao(kA.ped.id, soA), "premissa: quem só vê a A lê o pedido da A").toEqual({ situacao: "nao_exigida", ultimaDecisao: null });
    expect(await situacao(kB.ped.id), "premissa: o pedido da B existe").toEqual({ situacao: "nao_exigida", ultimaDecisao: null });

    // PARÂMETRO → 422, antes da 404 e antes de ler.
    for (const alvo of [kA.ped.id, naoExiste]) {
      const r = await lerSituacao(alvo, c.h.headers(), "foo=1");
      expect([alvo, r.statusCode], r.body).toEqual([alvo, 422]);
      expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message: "Parâmetro não reconhecido na situação da aprovação",
        details: [{ path: "foo", message: "Parâmetro não reconhecido na situação da aprovação" }] });
    }
  });
});

// ─────────────── SP-3 ───────────────

describe("SP-3 A2 — /proximos-passos ganha `orcamentos` no fim, só com orcamentos_compra.create", () => {
  it("SP-3a destinos [orçamento, compra]: items só a compra (o de hoje, chave por chave) e orcamentos = a TOP de orçamento, no FIM; sem a capacidade a chave não existe; a política é lida UMA vez, com e sem a capacidade", async () => {
    const k = await cotacao({ comCompra: true, aprovado: false });
    const [orc, compra] = [await topNoBanco(k.topOrc), await topNoBanco(k.topCompra!)];
    const passoCompra = { tipoOperacaoId: k.topCompra, codigo: compra.codigo, nome: compra.nome, codigoBase: "compras.compra", familiaRotulo: "Compra",
      especie: "compra", ordem: 1, emPartes: true };
    const passoOrcamento = { tipoOperacaoId: k.topOrc, codigo: orc.codigo, nome: orc.nome, codigoBase: "compras.orcamento", familiaRotulo: "Orçamento de compra",
      especie: "orcamento", ordem: 0, emPartes: false };

    const comCapacidade = await comConsultas(() => proximosPassos(k.ped.id));
    expect(comCapacidade.r.statusCode, comCapacidade.r.body).toBe(200);
    const b = j(comCapacidade.r);
    expect(Object.keys(b), "a chave nova no FIM").toEqual(["contractVersion", "politicaConfigurada", "items", "exigeFinalizar", "orcamentos"]);
    expect(b).toEqual({ contractVersion: 1, politicaConfigurada: true, items: [passoCompra], exigeFinalizar: false, orcamentos: [passoOrcamento] });
    expect(quantas(comCapacidade.sqls, SQL_POLITICA), "com a capacidade, a política é lida UMA vez (as duas espécies saem dela)").toBe(1);

    // SEM `orcamentos_compra.create`: o corpo de hoje, chave por chave — com a mesma leitura da política.
    const semCriar = await usuario("Vê pedido sem lançar orçamento F6b", ["pedidos_compra.view", "orcamentos_compra.view"]);
    const sem = await comConsultas(() => proximosPassos(k.ped.id, semCriar));
    expect(sem.r.statusCode, sem.r.body).toBe(200);
    const s = j(sem.r);
    expect(Object.keys(s)).toEqual(["contractVersion", "politicaConfigurada", "items", "exigeFinalizar"]);
    expect(s, "o corpo de hoje: o mesmo do administrador, sem a chave nova").toEqual({ contractVersion: 1, politicaConfigurada: true, items: [passoCompra], exigeFinalizar: false });
    expect(quantas(sem.sqls, SQL_POLITICA), "uma leitura da política, como com a capacidade").toBe(1);

    // PREMISSA ao lado: com `orcamentos_compra.create` (e nada além do que lê o pedido), a chave aparece.
    const comCriar = await usuario("Lança orçamento F6b", ["pedidos_compra.view", "orcamentos_compra.create"]);
    const cc = await proximosPassos(k.ped.id, comCriar);
    expect(cc.statusCode, cc.body).toBe(200);
    expect(j(cc).orcamentos, "premissa: a capacidade é a que decide").toEqual([passoOrcamento]);
  });

  it("SP-3b TOP sem destinos configurados → orcamentos [] (items [], política não configurada); destinos só de compra → orcamentos []", async () => {
    const p = await produto();
    const neutro = await pedido([itemCompra(p.id, "1", "10.00")]);
    const r = await proximosPassos(neutro.id);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ contractVersion: 1, politicaConfigurada: false, items: [], exigeFinalizar: false, orcamentos: [] });

    const topCompra = await topNoFormato("compras.compra", cfg4());
    const topPedido = await topNoFormato("compras.pedido", cfg4(), { destinos: [{ tipoOperacaoId: topCompra, ordem: 0, emPartes: false }] });
    const soCompra = await pedido([itemCompra(p.id, "1", "10.00")], topPedido);
    const r2 = await proximosPassos(soCompra.id);
    expect(r2.statusCode, r2.body).toBe(200);
    const b2 = j(r2) as { politicaConfigurada: boolean; items: { tipoOperacaoId: string }[]; orcamentos: unknown[] };
    expect([b2.politicaConfigurada, b2.items.map((x) => x.tipoOperacaoId)], "premissa: a política está configurada, com a compra").toEqual([true, [topCompra]]);
    expect(b2.orcamentos, "nenhuma TOP de orçamento no leque").toEqual([]);
  });
});

// ─────────────── SP-4 ───────────────

describe("SP-4 A3 — a leitura do pedido: a condição e o preço por item de cada orçamento, sem N+1", () => {
  it("SP-4a dois orçamentos (com e sem condição, preços diferentes) → condição (código e nome, null sem ela) e itens = as linhas do banco, na ordem da posição", async () => {
    const cond = await condicao();
    const k = await cotacao({ condicoesOrcamento: [cond.id] });
    const oa = await orcamento(k, ["8.123456", "4.00"], { condicao_pagamento_id: cond.id, prazo_entrega_dias: 10, validade_orcamento: "2026-10-31" });
    const ob = await orcamento(k, ["9.50"]);
    const [i0, i1] = k.ped.itens;
    // 3 × 8,123456 = 24,370368 → 24,37; 2 × 4,00 = 8,00 → 32,37. O item sem preço no corpo vale 0: 3 × 9,50 = 28,50.
    const itensA = [{ item_pedido_orcado_id: i0!.id, valor_unitario: "8.123456", valor_total: "24.37" }, { item_pedido_orcado_id: i1!.id, valor_unitario: "4.000000", valor_total: "8.00" }];
    const itensB = [{ item_pedido_orcado_id: i0!.id, valor_unitario: "9.500000", valor_total: "28.50" }, { item_pedido_orcado_id: i1!.id, valor_unitario: "0.000000", valor_total: "0.00" }];
    expect([await precosNoBanco(oa.id), await precosNoBanco(ob.id)], "premissa: as linhas do banco").toEqual([itensA, itensB]);

    const lido = await lerCompra("pedido", k.ped.id);
    expect(lido.statusCode, lido.body).toBe(200);
    const orcamentos = j(lido).orcamentos as Record<string, unknown>[];
    expect(orcamentos.map((o) => Object.keys(o)), "as chaves de hoje e as novas no FIM").toEqual([0, 1].map(() => [
      "id", "codigo", "situacao", "fornecedor_id", "fornecedor_nome", "condicao_pagamento_id", "prazo_entrega_dias", "validade_orcamento", "valor_total",
      "condicao_pagamento_codigo", "condicao_pagamento_nome", "itens"]));
    expect(orcamentos).toEqual([
      { id: oa.id, codigo: oa.codigo, situacao: "aberto", fornecedor_id: oa.fornecedor.id, fornecedor_nome: oa.fornecedor.nome, condicao_pagamento_id: cond.id,
        prazo_entrega_dias: 10, validade_orcamento: "2026-10-31", valor_total: "32.37", condicao_pagamento_codigo: cond.codigo, condicao_pagamento_nome: cond.nome, itens: itensA },
      { id: ob.id, codigo: ob.codigo, situacao: "aberto", fornecedor_id: ob.fornecedor.id, fornecedor_nome: ob.fornecedor.nome, condicao_pagamento_id: null,
        prazo_entrega_dias: null, validade_orcamento: null, valor_total: "28.50", condicao_pagamento_codigo: null, condicao_pagamento_nome: null, itens: itensB },
    ]);
  });

  it("SP-4b sem orcamentos_compra.view: sem a chave e NENHUMA consulta dos orçamentos nem dos preços (premissa: com a capacidade, as duas rodam uma vez)", async () => {
    const k = await cotacao();
    await orcamento(k, ["10.00", "5.00"]);
    const semVer = await usuario("Vê pedido sem orçamento F6b", ["pedidos_compra.view"]);
    // Aquecimento (o que a autenticação lê uma vez não entra na conta).
    await lerCompra("pedido", k.ped.id, semVer); await lerCompra("pedido", k.ped.id);

    const sem = await comConsultas(() => lerCompra("pedido", k.ped.id, semVer));
    expect(sem.r.statusCode, sem.r.body).toBe(200);
    expect(Object.hasOwn(j(sem.r), "orcamentos"), "sem a capacidade, a chave não existe").toBe(false);
    expect([quantas(sem.sqls, SQL_ORCAMENTOS), quantas(sem.sqls, SQL_ITENS_DOS_ORCAMENTOS)], "nada dos orçamentos é lido").toEqual([0, 0]);

    const com = await comConsultas(() => lerCompra("pedido", k.ped.id));
    expect(com.r.statusCode, com.r.body).toBe(200);
    expect((j(com.r).orcamentos as unknown[]).length, "premissa: o administrador vê o orçamento").toBe(1);
    expect([quantas(com.sqls, SQL_ORCAMENTOS), quantas(com.sqls, SQL_ITENS_DOS_ORCAMENTOS)], "premissa: com a capacidade, uma de cada").toEqual([1, 1]);
  });

  it("SP-4c 1 e 3 orçamentos → as MESMAS consultas (uma dos preços, nunca uma por orçamento); sem orçamento, a dos preços não roda", async () => {
    const um = await cotacao();
    await orcamento(um, ["10.00", "5.00"]);
    const tres = await cotacao();
    for (const precos of [["10.00", "5.00"], ["11.00", "4.00"], ["9.00", "6.00"]]) await orcamento(tres, precos);
    const nenhum = await cotacao();
    // Aquecimento.
    for (const k of [um, tres, nenhum]) await lerCompra("pedido", k.ped.id);

    const c1 = await comConsultas(() => lerCompra("pedido", um.ped.id));
    const c3 = await comConsultas(() => lerCompra("pedido", tres.ped.id));
    const c0 = await comConsultas(() => lerCompra("pedido", nenhum.ped.id));
    expect([(j(c1.r).orcamentos as unknown[]).length, (j(c3.r).orcamentos as unknown[]).length, (j(c0.r).orcamentos as unknown[]).length],
      "premissa: 1, 3 e nenhum orçamento").toEqual([1, 3, 0]);
    expect((j(c3.r).orcamentos as { itens: unknown[] }[]).map((o) => o.itens.length), "premissa: os 3 com os preços dos 2 itens").toEqual([2, 2, 2]);
    expect([quantas(c1.sqls, SQL_ITENS_DOS_ORCAMENTOS), quantas(c3.sqls, SQL_ITENS_DOS_ORCAMENTOS)], "uma consulta dos preços, qualquer que seja o número").toEqual([1, 1]);
    expect(c1.sqls.length, "premissa: o espião contou consultas").toBeGreaterThan(0);
    expect(c3.sqls.length, "as mesmas consultas com 1 e com 3 orçamentos").toBe(c1.sqls.length);
    expect([quantas(c0.sqls, SQL_ORCAMENTOS), quantas(c0.sqls, SQL_ITENS_DOS_ORCAMENTOS)], "sem orçamento: a lista roda, a dos preços não").toEqual([1, 0]);
    expect(c0.sqls.length, "uma consulta a menos que com orçamento").toBe(c1.sqls.length - 1);
  });
});
