import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  c, iniciar, encerrar, j, erro, unico, cfg4, top, versaoAtualNoBanco, usuario, escopos, produto, DATA,
  itemCompra, corpoCompra, compraLancada, lerCompra, receberPedido, corpoReceber, aprovar, fila, movimentosDe, titulosDe,
  type Hdr, type Resposta, type Erro, type ItemCompra, type Produto,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F6a (decisão 283) — O ORÇAMENTO DE COMPRA PELA API (plano F6a §1.3.1, §1.3.4 a §1.3.8, §1.4; OR-1..OR-7).
 *
 *   · OR-1 aprovado para orçamento: quem e quando, uma vez, com o pedido aberto; `compras.edit` ∧ a leitura do pedido;
 *   · OR-2 criar: só de pedido aprovado e aberto, com a TOP do leque do pedido; puxa TODOS os itens; um por
 *          fornecedor (cancelar libera); ID Global; nenhum efeito em estoque ou financeiro; as recusas 422;
 *   · OR-3 editar (PUT substitui): preços, prazo, validade, condição; os totais; as recusas; o pedido não aberto;
 *   · OR-4 escolher o vencedor: leva fornecedor, preços (desconto zerado) e condição ao pedido, com o frete dele; os
 *          outros "não escolhidos"; replay; segundo vencedor; pedido com compra; pedido finalizado; condição da TOP
 *          do PEDIDO; o vencedor sem condição mantém a do pedido; permissões e a MESMA 404;
 *   · OR-5 o fluxo completo pela API: pedido "A partir de um valor" → aprovado para orçamento → 2 orçamentos →
 *          vencedor → finalizar 409 → aprovar na fila → finalizar 200 → receber 201;
 *   · OR-6 escopo: quem só vê a empresa A não lê, não lista e não altera orçamento da B (a MESMA 404); a lista única;
 *          a leitura do pedido só traz os orçamentos a quem tem orcamentos_compra.view;
 *   · OR-7 as portas de leitura do lançamento (operation-types, regras da operação, layout) e as regras da TOP.
 *
 * O QUE CONTA COMO PROVA (o molde da TOP-CONFIG-08): situação, valores, itens, vínculos, ID Global e trilha LIDOS NO
 * BANCO pela testemunha (`c.admin`, superusuário sem RLS); toda recusa "sem efeito" vem com a PREMISSA ao lado (o
 * mesmo cenário, sem o obstáculo, passa).
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── mensagens, escritas à mão (o contrato da F6a) ───────────────

const MSG_APROVAR_SO_ABERTO = "Só pedido aberto é aprovado para orçamento.";
const MSG_JA_APROVADO = "Este pedido já está aprovado para orçamento.";
const MSG_ORC_SO_PEDIDO_ABERTO = "Só pedido aberto recebe orçamento.";
const MSG_NAO_APROVADO = "Este pedido não está aprovado para orçamento.";
const MSG_SEM_TOP = "A TOP deste pedido não tem orçamento nas próximas operações.";
const MSG_FORNECEDOR_REPETIDO = "Este pedido já tem orçamento deste fornecedor.";
const MSG_JA_TEM_VENCEDOR = "Este pedido já tem orçamento vencedor.";
const MSG_ORC_NAO_ABERTO = "Este orçamento não está aberto.";
const MSG_ORC_PEDIDO_NAO_ABERTO = "O pedido deste orçamento não está aberto.";
const MSG_VENCEDOR_SO_ABERTO = "O vencedor só é escolhido com o pedido aberto.";
const MSG_VENCEDOR_COM_COMPRA = "Este pedido já gerou compra: o orçamento vencedor não pode mais ser escolhido.";
const MSG_PRECO_DOS_ITENS = "Informe o preço de cada item do orçamento, uma vez cada.";
const MSG_ITEM_DE_OUTRO = "Item que não é deste pedido.";
const MSG_VALIDADE = "A validade do orçamento não pode ser anterior à data do documento.";
const MSG_CASAS = "O valor unitário aceita no máximo 6 casas decimais";
const MSG_FORNECEDOR_INVALIDO = "Fornecedor inválido: escolha uma pessoa cadastrada como fornecedor";
const MSG_CONDICAO_NAO_PERMITIDA = "Esta operação não aceita esta condição de pagamento.";
const MSG_PENDENTE_PEDIDO = "Este pedido precisa de aprovação antes de ser finalizado.";

// ─────────────── chamadas ───────────────

const comChave = (headers: Hdr, chave?: string): Hdr => (chave ? { ...headers, "idempotency-key": chave } : headers);
const inject = (method: "GET" | "POST" | "PUT", url: string, headers: Hdr = c.h.headers(), payload?: unknown): Promise<Resposta> =>
  c.ligada.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

const aprovarParaOrcamento = (pedidoId: string, headers: Hdr = c.h.headers(), chave?: string, payload: unknown = {}) =>
  inject("POST", `/api/compras/pedidos/${pedidoId}/aprovar-para-orcamento`, comChave(headers, chave), payload);
const criarOrcamento = (pedidoId: string, corpo: unknown, headers: Hdr = c.h.headers(), chave?: string) =>
  inject("POST", `/api/compras/pedidos/${pedidoId}/orcamentos`, comChave(headers, chave), corpo);
const editarOrcamento = (id: string, corpo: unknown, headers: Hdr = c.h.headers(), chave?: string) =>
  inject("PUT", `/api/compras/orcamentos/${id}`, comChave(headers, chave), corpo);
const cancelarOrcamento = (id: string, headers: Hdr = c.h.headers(), chave?: string, payload: unknown = {}) =>
  inject("POST", `/api/compras/orcamentos/${id}/cancel`, comChave(headers, chave), payload);
const escolher = (pedidoId: string, orcamentoId: string, headers: Hdr = c.h.headers(), chave?: string, payload: unknown = {}) =>
  inject("POST", `/api/compras/pedidos/${pedidoId}/orcamentos/${orcamentoId}/escolher`, comChave(headers, chave), payload);
const lerOrcamento = (id: string, headers: Hdr = c.h.headers()) => inject("GET", `/api/compras/orcamentos/${id}`, headers);
const finalizar = (id: string, headers: Hdr = c.h.headers()) => inject("POST", `/api/compras/pedidos/${id}/finalizar`, headers, {});

// ─────────────── cenário ───────────────

/** Uma TOP nova da família, com a PREMISSA de que o banco guardou a versão no formato pedido. */
async function topNoFormato(codigoBase: string, configuracao: { versaoSchema: number }, extra: Record<string, unknown> = {}): Promise<string> {
  const id = await top(codigoBase, { configuracao, ...extra });
  expect((await versaoAtualNoBanco(id)).configuracao_schema_version, `premissa: a versão de ${codigoBase} está no formato ${configuracao.versaoSchema}`)
    .toBe(configuracao.versaoSchema);
  return id;
}

/** Um fornecedor NOVO (superusuário), vivo. `fornecedor: false` = uma pessoa que NÃO é fornecedor. */
async function pessoa(nome: string, fornecedor = true): Promise<{ id: string; nome: string }> {
  const s = unico();
  const r = await c.admin.query<{ id: string; name: string }>(
    "insert into erp.people (organization_id, code, name, person_type, is_provider, is_client) values ($1, $2, $3, 'legal', $4, $5) returning id, name",
    [c.h.demo.orgId, `F6A${s}`, `${nome} ${s}`, fornecedor, !fornecedor]);
  return { id: r.rows[0]!.id, nome: r.rows[0]!.name };
}
const fornecedor = (nome = "Fornecedor F6a") => pessoa(nome);

/** Uma condição de pagamento NOVA: 1 parcela a 30 dias. */
async function condicao(): Promise<string> {
  const s = unico();
  return (await c.admin.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,1,30,'intervalo',30,false) returning id",
    [c.h.demo.orgId, `F6A-${s}`, `Condição F6a ${s}`])).rows[0]!.id;
}

type PedidoCriado = { id: string; codigo: string; itens: { id: string; quantidade: string }[] };
/** Um pedido lançado pela API com a TOP dada, e os itens dele no banco (na ordem da posição). */
async function pedido(itens: ItemCompra[], topPedido: string = c.tops.pedidoCompra, extra: Record<string, unknown> = {}): Promise<PedidoCriado> {
  const p = await compraLancada("pedido", corpoCompra(itens, { tipo_operacao_id: topPedido, ...extra }, "pedido"));
  const linhas = (await c.admin.query<{ id: string; quantidade: string }>(
    "select id, quantidade::text from erp.documentos_compra_itens where documento_id=$1 order by posicao, id", [p.id])).rows;
  expect(linhas, "premissa: o pedido tem os itens do corpo").toHaveLength(itens.length);
  expect(p.situacao, "premissa: o pedido nasce aberto").toBe("aberto");
  return { id: p.id, codigo: String(p.codigo), itens: linhas };
}

interface Cotacao { topOrc: string; topCompra: string | null; topPedido: string; ped: PedidoCriado; produtos: [Produto, Produto] }
/**
 * O CENÁRIO DA COTAÇÃO: a TOP de orçamento (formato 4 neutro, ou a dada), a TOP de pedido com a aresta para ela (e
 * para uma TOP de compra "Em partes", com `comCompra`), um pedido de dois itens — 3 × 10,00 e 2 × 5,00 = 40,00 — e,
 * salvo `aprovado: false`, o pedido aprovado para orçamento.
 */
async function cotacao(o: {
  topOrc?: string; configPedido?: { versaoSchema: number }; condicoesPedido?: string[]; condicoesOrcamento?: string[];
  comCompra?: boolean; aprovado?: boolean; itens?: (p: [Produto, Produto]) => ItemCompra[]; extraPedido?: Record<string, unknown>;
} = {}): Promise<Cotacao> {
  const topOrc = o.topOrc ?? await topNoFormato("compras.orcamento", cfg4(), o.condicoesOrcamento ? { condicoesPermitidas: o.condicoesOrcamento } : {});
  const topCompra = o.comCompra ? await topNoFormato("compras.compra", cfg4()) : null;
  const destinos = [{ tipoOperacaoId: topOrc, ordem: 0, emPartes: false }, ...(topCompra ? [{ tipoOperacaoId: topCompra, ordem: 1, emPartes: true }] : [])];
  const topPedido = await topNoFormato("compras.pedido", o.configPedido ?? cfg4(), { destinos, ...(o.condicoesPedido ? { condicoesPermitidas: o.condicoesPedido } : {}) });
  const produtos: [Produto, Produto] = [await produto(), await produto()];
  const itens = o.itens ? o.itens(produtos) : [itemCompra(produtos[0].id, "3", "10.00"), itemCompra(produtos[1].id, "2", "5.00")];
  const ped = await pedido(itens, topPedido, o.extraPedido);
  if (o.aprovado !== false) {
    const r = await aprovarParaOrcamento(ped.id);
    expect(r.statusCode, `premissa: o pedido é aprovado para orçamento — ${r.body}`).toBe(200);
  }
  return { topOrc, topCompra, topPedido, ped, produtos };
}

/** O corpo de criar orçamento: a TOP, o fornecedor e a data aberta; o resto em `extra`. */
const corpoOrcamento = (topOrc: string, fornecedorId: string, extra: Record<string, unknown> = {}) =>
  ({ tipo_operacao_id: topOrc, fornecedor_id: fornecedorId, data_documento: DATA, ...extra });

/** Cria o orçamento e devolve o corpo (premissa: 201). */
async function orcamentoCriado(pedidoId: string, corpo: unknown, headers?: Hdr): Promise<Record<string, unknown> & { id: string }> {
  const r = await criarOrcamento(pedidoId, corpo, headers);
  expect(r.statusCode, `premissa: o orçamento é criado — ${r.body}`).toBe(201);
  return j(r) as Record<string, unknown> & { id: string };
}

// ─────────────── testemunhas no banco ───────────────

interface DocNoBanco {
  especie: string; situacao: string; codigo: string; empresa_id: string; fornecedor_id: string; tipo_operacao_id: string;
  tipo_operacao_versao_id: string; pedido_orcado_id: string | null; condicao_pagamento_id: string | null; prazo_entrega_dias: number | null;
  validade_orcamento: string | null; observacao: string | null; plano_parcelas: unknown; parcelas_ajustadas: boolean;
  valor_itens: string; frete: string; outras_despesas: string; desconto: string; valor_total: string;
  aprovado_orcamento_em: Date | null; aprovado_orcamento_por: string | null; origem_documento_id: string | null; criado_por: string | null;
}
async function doc(id: string): Promise<DocNoBanco> {
  const r = await c.admin.query<DocNoBanco>(
    `select especie, situacao, codigo, empresa_id, fornecedor_id, tipo_operacao_id, tipo_operacao_versao_id, pedido_orcado_id,
            condicao_pagamento_id, prazo_entrega_dias, validade_orcamento, observacao, plano_parcelas, parcelas_ajustadas,
            valor_itens::text, frete::text, outras_despesas::text, desconto::text, valor_total::text,
            aprovado_orcamento_em, aprovado_orcamento_por, origem_documento_id, criado_por
       from erp.documentos_compra where id = $1`, [id]);
  expect(r.rows, `premissa: o documento ${id} existe`).toHaveLength(1);
  return r.rows[0]!;
}
interface ItemNoBanco {
  id: string; produto_id: string; armazem_id: string | null; quantidade: string; valor_unitario: string; desconto: string;
  desconto_percentual: string; valor_total: string; posicao: number; item_pedido_orcado_id: string | null; origem_item_id: string | null;
  lote: string | null; validade: string | null;
}
async function itensDe(id: string): Promise<ItemNoBanco[]> {
  return (await c.admin.query<ItemNoBanco>(
    `select id, produto_id, armazem_id, quantidade::text, valor_unitario::text, desconto::text, desconto_percentual::text, valor_total::text,
            posicao, item_pedido_orcado_id, origem_item_id, lote, validade
       from erp.documentos_compra_itens where documento_id = $1 order by posicao, id`, [id])).rows;
}
/** Os orçamentos do pedido (inclusive cancelados), na ordem em que nasceram. */
async function orcamentosDe(pedidoId: string): Promise<{ id: string; situacao: string; fornecedor_id: string }[]> {
  return (await c.admin.query<{ id: string; situacao: string; fornecedor_id: string }>(
    "select id, situacao, fornecedor_id from erp.documentos_compra where pedido_orcado_id = $1 and especie = 'orcamento' order by created_at, id", [pedidoId])).rows;
}
/**
 * A trilha da ação. As de serviço sem par no gatilho (aprovar_para_orcamento, cancel, escolher_vencedor, escolhido,
 * nao_escolhido) saem inteiras; "create" e "update" o gatilho da tabela também grava — `doServico` fica com as do
 * serviço (as que têm metadata).
 */
async function trilha(id: string, action: string, doServico = false) {
  return (await c.admin.query<{ user_id: string | null; metadata: Record<string, unknown> | null; before: unknown; after: unknown }>(
    `select user_id, metadata, before, after from erp.audit_logs
      where entity = 'documentos_compra' and entity_id = $1 and action = $2 ${doServico ? "and metadata is not null" : ""} order by id`,
    [id, action])).rows;
}

type LinhaFila = { id: string; especie: string; situacao: string; valor: string | null; ultimaDecisao: { decisao: string } | null };
/** A fila de compras INTEIRA de quem pergunta (página de 1000, conferida contra o total). */
async function filaDeCompras(headers: Hdr = c.h.headers()): Promise<LinhaFila[]> {
  const r = await fila("compras", headers, { pageSize: 1000 });
  expect(r.statusCode, r.body).toBe(200);
  const f = j(r) as unknown as { items: LinhaFila[]; total: number };
  expect(f.items.length, "premissa: a página de 1000 traz a fila inteira").toBe(f.total);
  return f.items;
}

/** A 404 do GET por id do orçamento (o corpo de referência de "não existe para você"). */
async function ref404(): Promise<Erro> {
  const r = await lerOrcamento("00000000-0000-4000-8000-0000000000f6");
  expect(r.statusCode).toBe(404);
  return erro(r);
}

// ─────────────── OR-1 ───────────────

describe("OR-1 aprovado para orçamento", () => {
  it("OR-1a 200 com quem e quando; o banco; a trilha; o replay devolve o MESMO corpo; a segunda vez → 409; a leitura traz o nome", async () => {
    const k = await cotacao({ aprovado: false });
    expect((await doc(k.ped.id)).aprovado_orcamento_em, "premissa: o pedido nasce sem aprovação para orçamento").toBeNull();
    const chave = `f6a-or1a-${unico()}`;
    const r1 = await aprovarParaOrcamento(k.ped.id, c.h.headers(), chave);
    expect(r1.statusCode, r1.body).toBe(200);
    const b = j(r1);
    expect(Object.keys(b)).toEqual(["id", "aprovado_orcamento_em", "aprovado_orcamento_por"]);
    expect([b.id, b.aprovado_orcamento_por]).toEqual([k.ped.id, c.h.demo.adminUserId]);
    const db = await doc(k.ped.id);
    expect([db.situacao, db.aprovado_orcamento_por]).toEqual(["aberto", c.h.demo.adminUserId]);
    expect(db.aprovado_orcamento_em!.toISOString()).toBe(b.aprovado_orcamento_em);
    const depois = { aprovado_orcamento_em: b.aprovado_orcamento_em, aprovado_orcamento_por: c.h.demo.adminUserId };
    expect(await trilha(k.ped.id, "aprovar_para_orcamento")).toEqual([{ user_id: c.h.demo.adminUserId, metadata: null,
      before: { aprovado_orcamento_em: null, aprovado_orcamento_por: null }, after: depois }]);
    // O REPLAY: a mesma chave → o mesmo corpo, nenhuma trilha nova (e nenhum 409 de "já aprovado").
    const r2 = await aprovarParaOrcamento(k.ped.id, c.h.headers(), chave);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(r2)).toEqual(b);
    expect(await trilha(k.ped.id, "aprovar_para_orcamento")).toHaveLength(1);
    // Sem a chave: já aprovado → 409, e o carimbo não muda.
    const r3 = await aprovarParaOrcamento(k.ped.id);
    expect(r3.statusCode, r3.body).toBe(409);
    expect(erro(r3)).toEqual({ code: "CONFLICT", message: MSG_JA_APROVADO });
    expect((await doc(k.ped.id)).aprovado_orcamento_em!.toISOString()).toBe(b.aprovado_orcamento_em);
    // A leitura do pedido traz quem aprovou.
    const lido = j(await lerCompra("pedido", k.ped.id));
    expect([lido.aprovado_orcamento_por, lido.aprovado_orcamento_por_nome]).toEqual([c.h.demo.adminUserId, expect.any(String)]);
  });

  it("OR-1b corpo com chave desconhecida → 422; sem compras.edit → 403; com compras.edit e sem pedidos_compra.view → 403; nada muda; premissa: com as duas, aprova", async () => {
    const k = await cotacao({ aprovado: false });
    const corpoRuim = await aprovarParaOrcamento(k.ped.id, c.h.headers(), undefined, { motivo: "x" });
    expect(corpoRuim.statusCode, corpoRuim.body).toBe(422);
    const semCompras = await usuario("Sem compras edit F6a", ["pedidos_compra.view", "pedidos_compra.edit", "compras.view"]);
    expect((await lerCompra("pedido", k.ped.id, semCompras)).statusCode, "premissa: ele VÊ o pedido").toBe(200);
    expect((await aprovarParaOrcamento(k.ped.id, semCompras)).statusCode).toBe(403);
    const semLeitura = await usuario("Sem leitura do pedido F6a", ["compras.view", "compras.edit"]);
    const r = await aprovarParaOrcamento(k.ped.id, semLeitura);
    expect(r.statusCode, r.body).toBe(403);
    expect(erro(r).code).toBe("PERMISSION_DENIED");
    expect((await doc(k.ped.id)).aprovado_orcamento_em).toBeNull();
    expect(await trilha(k.ped.id, "aprovar_para_orcamento")).toEqual([]);
    const comAsDuas = await usuario("Aprovador para orçamento F6a", ["compras.edit", "pedidos_compra.view"]);
    expect((await aprovarParaOrcamento(k.ped.id, comAsDuas)).statusCode).toBe(200);
    expect((await doc(k.ped.id)).aprovado_orcamento_em).not.toBeNull();
  });

  it("OR-1c o que não está aberto → 409 'Só pedido aberto é aprovado para orçamento.' (finalizado e cancelado), sem efeito", async () => {
    const finalizado = await cotacao({ aprovado: false });
    expect((await finalizar(finalizado.ped.id)).statusCode, "premissa: o pedido é finalizado").toBe(200);
    const cancelado = await cotacao({ aprovado: false });
    expect((await inject("POST", `/api/compras/pedidos/${cancelado.ped.id}/cancel`, c.h.headers(), {})).statusCode, "premissa: o pedido é cancelado").toBe(200);
    for (const [k, situacao] of [[finalizado, "finalizado"], [cancelado, "cancelado"]] as const) {
      expect((await doc(k.ped.id)).situacao).toBe(situacao);
      const r = await aprovarParaOrcamento(k.ped.id);
      expect(r.statusCode, r.body).toBe(409);
      expect(erro(r)).toEqual({ code: "CONFLICT", message: MSG_APROVAR_SO_ABERTO });
      expect((await doc(k.ped.id)).aprovado_orcamento_em).toBeNull();
    }
  });

  it("OR-1d a MESMA 404 do GET: inexistente, malformado, compra na porta do pedido e pedido de outra empresa fora do escopo; premissa: quem vê a empresa 2 aprova", async () => {
    const ref = await ref404();
    const p = await produto();
    const compra = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")]));
    const daEmpresa2 = await pedido([itemCompra(p.id, "1", "10.00", { armazem_id: c.I.warehouseEmpresa2 })], c.tops.pedidoCompra, { empresa_id: c.I.empresa2 });
    const soA = await usuario("Aprovador só da A F6a", ["compras.edit", "pedidos_compra.view"], escopos({ compras: [c.I.empresa] }));
    const casos: { nome: string; id: string; headers: Hdr }[] = [
      { nome: "inexistente", id: "00000000-0000-4000-8000-0000000000aa", headers: c.h.headers() },
      { nome: "malformado", id: "nao-e-uuid", headers: c.h.headers() },
      { nome: "compra na porta do pedido", id: compra.id, headers: c.h.headers() },
      { nome: "pedido da empresa 2 para quem só vê a 1", id: daEmpresa2.id, headers: soA },
    ];
    for (const caso of casos) {
      const r = await aprovarParaOrcamento(caso.id, caso.headers);
      expect(r.statusCode, `${caso.nome}: ${r.body}`).toBe(404);
      expect(erro(r), caso.nome).toEqual(ref);
    }
    expect((await doc(compra.id)).aprovado_orcamento_em).toBeNull();
    expect((await doc(daEmpresa2.id)).aprovado_orcamento_em).toBeNull();
    expect((await aprovarParaOrcamento(daEmpresa2.id)).statusCode).toBe(200);
  });
});

// ─────────────── OR-2 ───────────────

describe("OR-2 criar o orçamento a partir do pedido", () => {
  it("OR-2a pedido sem aprovação para orçamento → 409, nada criado; premissa: aprovado, cria", async () => {
    const k = await cotacao({ aprovado: false });
    const f = await fornecedor();
    const r = await criarOrcamento(k.ped.id, corpoOrcamento(k.topOrc, f.id));
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual({ code: "CONFLICT", message: MSG_NAO_APROVADO });
    expect(await orcamentosDe(k.ped.id)).toEqual([]);
    expect((await aprovarParaOrcamento(k.ped.id)).statusCode).toBe(200);
    await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id));
    expect(await orcamentosDe(k.ped.id)).toHaveLength(1);
  });

  it("OR-2b TOP fora do leque do pedido → 422 TIPO_OPERACAO_INDISPONIVEL (sem aresta, outra TOP de orçamento, a TOP de compra do leque); premissa: a do leque cria", async () => {
    const indisponivel: Erro = { code: "TIPO_OPERACAO_INDISPONIVEL", message: MSG_SEM_TOP };
    const k = await cotacao({ comCompra: true });
    const f = await fornecedor();
    // Um pedido cuja TOP não declara próximas operações (a neutra do cenário), aprovado para orçamento.
    const p = await produto();
    const semAresta = await pedido([itemCompra(p.id, "1", "10.00")]);
    expect((await aprovarParaOrcamento(semAresta.id)).statusCode).toBe(200);
    const outraTopOrc = await topNoFormato("compras.orcamento", cfg4());
    const casos: { nome: string; pedidoId: string; topId: string }[] = [
      { nome: "TOP do pedido sem aresta", pedidoId: semAresta.id, topId: k.topOrc },
      { nome: "outra TOP de orçamento, fora do leque", pedidoId: k.ped.id, topId: outraTopOrc },
      { nome: "a TOP de COMPRA do leque", pedidoId: k.ped.id, topId: k.topCompra! },
    ];
    for (const caso of casos) {
      const r = await criarOrcamento(caso.pedidoId, corpoOrcamento(caso.topId, f.id));
      expect(r.statusCode, `${caso.nome}: ${r.body}`).toBe(422);
      expect(erro(r), caso.nome).toEqual(indisponivel);
    }
    expect([await orcamentosDe(semAresta.id), await orcamentosDe(k.ped.id)]).toEqual([[], []]);
    await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id));
  });

  it("OR-2c puxa TODOS os itens (produto, Local de estoque, quantidade, posição, vínculo), preço do corpo ou 0; ID Global; trilha; sem estoque nem financeiro; o pedido não muda; replay", async () => {
    const cond = await condicao();
    const k = await cotacao({ condicoesOrcamento: [cond] });
    const f = await fornecedor();
    const pedidoAntes = await doc(k.ped.id);
    const itensDoPedidoAntes = await itensDe(k.ped.id);
    const chave = `f6a-or2c-${unico()}`;
    const corpo = corpoOrcamento(k.topOrc, f.id, { condicao_pagamento_id: cond.toUpperCase(), prazo_entrega_dias: 15, validade_orcamento: "2026-10-31",
      observacao: "  Cotação por e-mail  ", itens: [{ item_pedido_id: k.ped.itens[1]!.id, valor_unitario: "4.123456" }] });
    const r = await criarOrcamento(k.ped.id, corpo, c.h.headers(), chave);
    expect(r.statusCode, r.body).toBe(201);
    const b = j(r);
    expect(Object.keys(b)).toEqual(["id", "codigo", "especie", "situacao", "pedido_orcado_id", "fornecedor_id", "valor_itens", "valor_total"]);
    const id = b.id as string;
    // 2 × 4,123456 = 8,246912 → 8,25; o item sem preço no corpo vale 0.
    expect(b).toEqual({ id, codigo: expect.any(String), especie: "orcamento", situacao: "aberto", pedido_orcado_id: k.ped.id, fornecedor_id: f.id, valor_itens: "8.25", valor_total: "8.25" });

    // NO BANCO: o cabeçalho.
    const versaoOrc = await versaoAtualNoBanco(k.topOrc);
    const db = await doc(id);
    expect(db).toMatchObject({ especie: "orcamento", situacao: "aberto", codigo: b.codigo, empresa_id: c.I.empresa, fornecedor_id: f.id,
      tipo_operacao_id: k.topOrc, tipo_operacao_versao_id: versaoOrc.id, pedido_orcado_id: k.ped.id, condicao_pagamento_id: cond,
      prazo_entrega_dias: 15, validade_orcamento: "2026-10-31", observacao: "Cotação por e-mail", plano_parcelas: null,
      valor_itens: "8.25", frete: "0.00", outras_despesas: "0.00", desconto: "0.00", valor_total: "8.25",
      aprovado_orcamento_em: null, origem_documento_id: null, criado_por: c.h.demo.adminUserId });
    // Os itens: TODOS os do pedido, na ordem dele, ligados pelo vínculo próprio (nunca pela origem), sem lote/validade.
    const [i0, i1] = itensDoPedidoAntes;
    expect((await itensDe(id)).map(({ id: _id, ...x }) => x)).toEqual([
      { produto_id: i0!.produto_id, armazem_id: i0!.armazem_id, quantidade: "3.0000", valor_unitario: "0.000000", desconto: "0.00", desconto_percentual: "0.0000",
        valor_total: "0.00", posicao: 0, item_pedido_orcado_id: i0!.id, origem_item_id: null, lote: null, validade: null },
      { produto_id: i1!.produto_id, armazem_id: i1!.armazem_id, quantidade: "2.0000", valor_unitario: "4.123456", desconto: "0.00", desconto_percentual: "0.0000",
        valor_total: "8.25", posicao: 1, item_pedido_orcado_id: i1!.id, origem_item_id: null, lote: null, validade: null },
    ]);
    expect(i0!.armazem_id, "premissa: o item do pedido tem Local de estoque").toBe(c.I.warehouse);
    // O ID Global, com a rota do orçamento.
    const g = (await c.admin.query<{ id_global: string; rota_canonica: string; tipo_entidade: string }>(
      "select id_global::text, rota_canonica, tipo_entidade from erp.registros_globais where id_entidade = $1", [id])).rows;
    expect(g).toHaveLength(1);
    expect([g[0]!.tipo_entidade, g[0]!.rota_canonica, Number(g[0]!.id_global) > 0]).toEqual(["documentos_compra", `/compras/orcamentos/${id}`, true]);
    // A trilha do serviço.
    expect((await trilha(id, "create", true)).map((x) => x.metadata)).toEqual([{ especie: "orcamento", codigo: b.codigo, pedido: k.ped.id,
      tipoOperacaoId: k.topOrc, tipoOperacaoVersaoId: versaoOrc.id, fornecedorId: f.id }]);
    // NENHUM efeito: nem estoque, nem título.
    expect(await movimentosDe("documentos_compra", id)).toEqual([]);
    expect(await titulosDe("documentos_compra", id)).toEqual([]);
    // O PEDIDO não muda: cabeçalho e itens iguais, e o saldo inteiro (o orçamento não consome).
    expect(await doc(k.ped.id)).toEqual(pedidoAntes);
    expect(await itensDe(k.ped.id)).toEqual(itensDoPedidoAntes);
    const lidoPedido = j(await lerCompra("pedido", k.ped.id));
    expect((lidoPedido.itens as { recebido: string; saldo: string }[]).map((i) => [i.recebido, i.saldo])).toEqual([["0.0000", "3.0000"], ["0.0000", "2.0000"]]);
    // OPERACOES-01 F6b: + a condição (código e nome) e o preço de cada item, no fim — os valores do banco.
    const condNoBanco = (await c.admin.query<{ code: string; nome: string }>("select code, nome from erp.condicoes_pagamento where id = $1", [cond])).rows[0]!;
    expect(lidoPedido.orcamentos).toEqual([{ id, codigo: b.codigo, situacao: "aberto", fornecedor_id: f.id, fornecedor_nome: f.nome,
      condicao_pagamento_id: cond, prazo_entrega_dias: 15, validade_orcamento: "2026-10-31", valor_total: "8.25",
      condicao_pagamento_codigo: condNoBanco.code, condicao_pagamento_nome: condNoBanco.nome,
      itens: [{ item_pedido_orcado_id: i0!.id, valor_unitario: "0.000000", valor_total: "0.00" }, { item_pedido_orcado_id: i1!.id, valor_unitario: "4.123456", valor_total: "8.25" }] }]);
    // A LEITURA do orçamento pela porta dele.
    const lido = await lerOrcamento(id);
    expect(lido.statusCode, lido.body).toBe(200);
    expect(j(lido)).toMatchObject({ id, especie: "orcamento", pedido_orcado_id: k.ped.id, pedido_orcado_codigo: k.ped.codigo, fornecedor_nome: f.nome });
    expect(Object.hasOwn(j(lido), "orcamentos") || Object.hasOwn(j(lido), "compras_geradas"), "o orçamento não tem orçamentos nem compras geradas").toBe(false);
    // O REPLAY: o mesmo corpo, e continua UM orçamento.
    const r2 = await criarOrcamento(k.ped.id, corpo, c.h.headers(), chave);
    expect(r2.statusCode, r2.body).toBe(201);
    expect(j(r2)).toEqual(b);
    expect(await orcamentosDe(k.ped.id)).toHaveLength(1);
  });

  it("OR-2d um orçamento VIVO por fornecedor: o mesmo fornecedor → 409; outro fornecedor cria; cancelar libera; cancelar duas vezes → 409", async () => {
    const k = await cotacao();
    const f = await fornecedor(); const g = await fornecedor();
    const o1 = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id));
    const repetido = await criarOrcamento(k.ped.id, corpoOrcamento(k.topOrc, f.id));
    expect(repetido.statusCode, repetido.body).toBe(409);
    expect(erro(repetido)).toEqual({ code: "CONFLICT", message: MSG_FORNECEDOR_REPETIDO });
    const o2 = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, g.id));
    expect((await orcamentosDe(k.ped.id)).map((o) => [o.id, o.fornecedor_id, o.situacao])).toEqual([[o1.id, f.id, "aberto"], [o2.id, g.id, "aberto"]]);
    // CANCELAR: o motivo fica na trilha; o orçamento do outro fornecedor não muda.
    const cancelado = await cancelarOrcamento(o1.id, c.h.headers(), undefined, { motivo: "Preço vencido" });
    expect(cancelado.statusCode, cancelado.body).toBe(200);
    expect(j(cancelado)).toEqual({ id: o1.id, situacao: "cancelado" });
    expect((await trilha(o1.id, "cancel")).map((x) => [x.metadata, x.before, x.after])).toEqual([[{ motivo: "Preço vencido" }, { situacao: "aberto" }, { situacao: "cancelado" }]]);
    // Cancelar libera o fornecedor.
    const o3 = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id));
    expect((await orcamentosDe(k.ped.id)).map((o) => [o.id, o.situacao])).toEqual([[o1.id, "cancelado"], [o2.id, "aberto"], [o3.id, "aberto"]]);
    const deNovo = await cancelarOrcamento(o1.id);
    expect(deNovo.statusCode, deNovo.body).toBe(409);
    expect(erro(deNovo)).toEqual({ code: "ALREADY_CANCELLED", message: "Documento já cancelado" });
  });

  it("OR-2e recusas 422 sem efeito (corpo, preço, item, casas, validade, prazo, fornecedor); premissa: o corpo corrigido cria", async () => {
    const k = await cotacao();
    const f = await fornecedor();
    const naoFornecedor = await pessoa("Cliente F6a", false);
    const p = await produto();
    const outro = await pedido([itemCompra(p.id, "1", "10.00")]);
    const [i0, i1] = k.ped.itens;
    const item = (id: string, valor: unknown) => ({ item_pedido_id: id, valor_unitario: valor });
    const casos: { nome: string; corpo: Record<string, unknown>; esperado?: Erro }[] = [
      { nome: "chave desconhecida", corpo: corpoOrcamento(k.topOrc, f.id, { frete: "1.00" }) },
      { nome: "preço como número JSON", corpo: corpoOrcamento(k.topOrc, f.id, { itens: [item(i0!.id, 10)] }) },
      { nome: "preço com vírgula", corpo: corpoOrcamento(k.topOrc, f.id, { itens: [item(i0!.id, "1,5")] }) },
      { nome: "preço negativo", corpo: corpoOrcamento(k.topOrc, f.id, { itens: [item(i0!.id, "-1")] }) },
      { nome: "prazo acima de 3650", corpo: corpoOrcamento(k.topOrc, f.id, { prazo_entrega_dias: 3651 }) },
      { nome: "item de outro pedido", corpo: corpoOrcamento(k.topOrc, f.id, { itens: [item(outro.itens[0]!.id, "1")] }),
        esperado: { code: "VALIDATION_ERROR", message: MSG_ITEM_DE_OUTRO, details: [{ path: "itens[0].item_pedido_id", message: MSG_ITEM_DE_OUTRO }] } },
      { nome: "item repetido", corpo: corpoOrcamento(k.topOrc, f.id, { itens: [item(i1!.id, "1"), item(i1!.id, "2")] }),
        esperado: { code: "VALIDATION_ERROR", message: MSG_ITEM_DE_OUTRO, details: [{ path: "itens[1].item_pedido_id", message: MSG_ITEM_DE_OUTRO }] } },
      { nome: "sete casas", corpo: corpoOrcamento(k.topOrc, f.id, { itens: [item(i0!.id, "1.1234567")] }),
        esperado: { code: "VALIDATION_ERROR", message: MSG_CASAS, details: [{ path: "itens[0].valor_unitario", message: MSG_CASAS }] } },
      { nome: "validade antes da data", corpo: corpoOrcamento(k.topOrc, f.id, { validade_orcamento: "2026-09-09" }),
        esperado: { code: "VALIDATION_ERROR", message: MSG_VALIDADE, details: [{ path: "validade_orcamento", message: MSG_VALIDADE }] } },
      { nome: "pessoa que não é fornecedor", corpo: corpoOrcamento(k.topOrc, naoFornecedor.id),
        esperado: { code: "VALIDATION_ERROR", message: MSG_FORNECEDOR_INVALIDO, details: [{ path: "fornecedor_id", message: MSG_FORNECEDOR_INVALIDO }] } },
    ];
    for (const caso of casos) {
      const r = await criarOrcamento(k.ped.id, caso.corpo);
      expect(r.statusCode, `${caso.nome}: ${r.body}`).toBe(422);
      if (caso.esperado) expect(erro(r), caso.nome).toEqual(caso.esperado);
      else expect(erro(r).code, caso.nome).toBe("VALIDATION_ERROR");
    }
    expect(await orcamentosDe(k.ped.id)).toEqual([]);
    // Premissa: o mesmo pedido, com o corpo corrigido (validade no dia da data, preço de 6 casas), cria.
    const ok = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id, { validade_orcamento: DATA, prazo_entrega_dias: 3650, itens: [item(i0!.id, "1.123456")] }));
    expect(ok.valor_total).toBe("3.37");
  });

  it("OR-2f sem orcamentos_compra.create → 403; com ela e sem pedidos_compra.view → 403; nada criado; premissa: com as duas, cria", async () => {
    const k = await cotacao();
    const f = await fornecedor();
    const semCriar = await usuario("Sem criar orçamento F6a", ["pedidos_compra.view", "orcamentos_compra.view", "orcamentos_compra.edit"]);
    const semPedido = await usuario("Sem ler pedido F6a", ["orcamentos_compra.view", "orcamentos_compra.create"]);
    for (const [nome, headers] of [["sem criar", semCriar], ["sem ler o pedido", semPedido]] as const) {
      const r = await criarOrcamento(k.ped.id, corpoOrcamento(k.topOrc, f.id), headers);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(403);
      expect(erro(r).code, nome).toBe("PERMISSION_DENIED");
    }
    expect(await orcamentosDe(k.ped.id)).toEqual([]);
    const comAsDuas = await usuario("Cotador F6a", ["pedidos_compra.view", "orcamentos_compra.create"]);
    await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id), comAsDuas);
  });
});

// ─────────────── OR-3 ───────────────

describe("OR-3 editar o orçamento (PUT substitui)", () => {
  it("OR-3a preços, prazo, validade, condição e observação; os totais recalculados; a trilha só com o que mudou; replay", async () => {
    const cond1 = await condicao(); const cond2 = await condicao();
    const k = await cotacao({ condicoesOrcamento: [cond1, cond2] });
    const f = await fornecedor();
    const o = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id, { condicao_pagamento_id: cond1, prazo_entrega_dias: 10,
      validade_orcamento: "2026-10-01", observacao: "A", itens: [{ item_pedido_id: k.ped.itens[0]!.id, valor_unitario: "9.50" }] }));
    expect(o.valor_total, "premissa: 3 × 9,50 + 2 × 0").toBe("28.50");
    const [l0, l1] = await itensDe(o.id);
    const chave = `f6a-or3a-${unico()}`;
    const corpo = { condicao_pagamento_id: cond2, prazo_entrega_dias: 20, validade_orcamento: "2026-11-01", observacao: null,
      itens: [{ id: l1!.id, valor_unitario: "4.00" }, { id: l0!.id.toUpperCase(), valor_unitario: "9.00" }] };
    const r = await editarOrcamento(o.id, corpo, c.h.headers(), chave);
    expect(r.statusCode, r.body).toBe(200);
    const b = j(r);
    // A resposta é a leitura do orçamento: 3 × 9,00 + 2 × 4,00 = 35,00.
    expect(b).toMatchObject({ id: o.id, especie: "orcamento", situacao: "aberto", condicao_pagamento_id: cond2, prazo_entrega_dias: 20,
      validade_orcamento: "2026-11-01", observacao: null, valor_itens: "35.00", valor_total: "35.00" });
    expect((b.itens as { id: string; valor_unitario: string; valor_total: string }[]).map((i) => [i.id, i.valor_unitario, i.valor_total]))
      .toEqual([[l0!.id, "9.000000", "27.00"], [l1!.id, "4.000000", "8.00"]]);
    const db = await doc(o.id);
    expect([db.condicao_pagamento_id, db.prazo_entrega_dias, db.validade_orcamento, db.observacao, db.valor_itens, db.valor_total])
      .toEqual([cond2, 20, "2026-11-01", null, "35.00", "35.00"]);
    expect((await itensDe(o.id)).map((i) => [i.quantidade, i.valor_unitario, i.valor_total, i.item_pedido_orcado_id]))
      .toEqual([["3.0000", "9.000000", "27.00", l0!.item_pedido_orcado_id], ["2.0000", "4.000000", "8.00", l1!.item_pedido_orcado_id]]);
    // A trilha do serviço: o que mudou, antes e depois.
    expect(await trilha(o.id, "update", true)).toEqual([{ user_id: c.h.demo.adminUserId,
      metadata: { campos: ["condicao_pagamento_id", "prazo_entrega_dias", "validade_orcamento", "observacao", "valor_itens", "valor_total", "itens"] },
      before: { condicao_pagamento_id: cond1, prazo_entrega_dias: 10, validade_orcamento: "2026-10-01", observacao: "A", valor_itens: "28.50", valor_total: "28.50",
        itens: [{ id: l1!.id, valor_unitario: "0.000000" }, { id: l0!.id, valor_unitario: "9.500000" }] },
      after: { condicao_pagamento_id: cond2, prazo_entrega_dias: 20, validade_orcamento: "2026-11-01", observacao: null, valor_itens: "35.00", valor_total: "35.00",
        itens: [{ id: l1!.id, valor_unitario: "4.00" }, { id: l0!.id, valor_unitario: "9.00" }] } }]);
    // O REPLAY: o mesmo corpo, nenhuma trilha nova.
    const r2 = await editarOrcamento(o.id, corpo, c.h.headers(), chave);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(r2)).toEqual(b);
    expect(await trilha(o.id, "update", true)).toHaveLength(1);
    // O pedido não muda.
    expect((await doc(k.ped.id)).valor_total).toBe("40.00");
  });

  it("OR-3b recusas 422 sem efeito: itens incompleto/repetido/alheio, validade antes da data, condição fora das permitidas da TOP do orçamento, chave faltando; premissa: o PUT corrigido grava", async () => {
    const cond1 = await condicao(); const fora = await condicao();
    const k = await cotacao({ condicoesOrcamento: [cond1] });
    const f = await fornecedor();
    const o = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id));
    const [l0, l1] = await itensDe(o.id);
    const base = { condicao_pagamento_id: null, prazo_entrega_dias: null, validade_orcamento: null, observacao: null,
      itens: [{ id: l0!.id, valor_unitario: "1.00" }, { id: l1!.id, valor_unitario: "2.00" }] };
    const precoDosItens: Erro = { code: "VALIDATION_ERROR", message: MSG_PRECO_DOS_ITENS, details: [{ path: "itens", message: MSG_PRECO_DOS_ITENS }] };
    const casos: { nome: string; corpo: Record<string, unknown>; esperado?: Erro; status?: number }[] = [
      { nome: "itens incompletos", corpo: { ...base, itens: [{ id: l0!.id, valor_unitario: "1.00" }] }, esperado: precoDosItens },
      { nome: "item repetido", corpo: { ...base, itens: [...base.itens, { id: l0!.id, valor_unitario: "3.00" }] }, esperado: precoDosItens },
      { nome: "item do pedido no lugar da linha", corpo: { ...base, itens: [{ id: k.ped.itens[0]!.id, valor_unitario: "1.00" }, base.itens[1]!] }, esperado: precoDosItens },
      { nome: "validade antes da data", corpo: { ...base, validade_orcamento: "2026-09-01" },
        esperado: { code: "VALIDATION_ERROR", message: MSG_VALIDADE, details: [{ path: "validade_orcamento", message: MSG_VALIDADE }] } },
      { nome: "condição fora das permitidas", corpo: { ...base, condicao_pagamento_id: fora },
        esperado: { code: "CONDICAO_PAGAMENTO_NAO_PERMITIDA", message: MSG_CONDICAO_NAO_PERMITIDA, details: { campo: "condicao_pagamento_id" } } },
      { nome: "chave faltando (o PUT substitui)", corpo: { condicao_pagamento_id: null, prazo_entrega_dias: null, validade_orcamento: null, itens: base.itens } },
    ];
    for (const caso of casos) {
      const r = await editarOrcamento(o.id, caso.corpo);
      expect(r.statusCode, `${caso.nome}: ${r.body}`).toBe(422);
      if (caso.esperado) expect(erro(r), caso.nome).toEqual(caso.esperado);
      else expect(erro(r).code, caso.nome).toBe("VALIDATION_ERROR");
    }
    expect((await doc(o.id)).valor_total).toBe("0.00");
    expect((await itensDe(o.id)).map((i) => i.valor_unitario)).toEqual(["0.000000", "0.000000"]);
    expect(await trilha(o.id, "update", true)).toEqual([]);
    const ok = await editarOrcamento(o.id, { ...base, condicao_pagamento_id: cond1 });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await doc(o.id)).valor_total, "3 × 1,00 + 2 × 2,00").toBe("7.00");
  });

  it("OR-3c o pedido não aberto → 409 (pedido); o orçamento cancelado → 409 (orçamento); sem orcamentos_compra.edit → 403", async () => {
    const k = await cotacao();
    const f = await fornecedor(); const g = await fornecedor();
    const o = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id));
    const cancelado = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, g.id));
    expect((await cancelarOrcamento(cancelado.id)).statusCode).toBe(200);
    const corpoDe = async (id: string) => ({ condicao_pagamento_id: null, prazo_entrega_dias: 5, validade_orcamento: null, observacao: null,
      itens: (await itensDe(id)).map((i) => ({ id: i.id, valor_unitario: "1.00" })) });
    const semEditar = await usuario("Sem editar orçamento F6a", ["orcamentos_compra.view", "orcamentos_compra.create", "pedidos_compra.view"]);
    expect((await editarOrcamento(o.id, await corpoDe(o.id), semEditar)).statusCode).toBe(403);
    const rc = await editarOrcamento(cancelado.id, await corpoDe(cancelado.id));
    expect(rc.statusCode, rc.body).toBe(409);
    expect(erro(rc)).toEqual({ code: "CONFLICT", message: MSG_ORC_NAO_ABERTO });
    // Premissa: com o pedido aberto, o mesmo orçamento é editado.
    expect((await editarOrcamento(o.id, await corpoDe(o.id))).statusCode).toBe(200);
    expect((await finalizar(k.ped.id)).statusCode, "premissa: o pedido é finalizado").toBe(200);
    const antes = await doc(o.id);
    const rp = await editarOrcamento(o.id, { ...(await corpoDe(o.id)), prazo_entrega_dias: 9 });
    expect(rp.statusCode, rp.body).toBe(409);
    expect(erro(rp)).toEqual({ code: "CONFLICT", message: MSG_ORC_PEDIDO_NAO_ABERTO });
    expect(await doc(o.id)).toEqual(antes);
    expect(antes.situacao, "o orçamento continua aberto (finalizar não tem cascata)").toBe("aberto");
  });
});

// ─────────────── OR-4 ───────────────

describe("OR-4 escolher o vencedor", () => {
  it("OR-4a leva fornecedor, preços (desconto do item zerado) e condição ao pedido, com o frete DELE; os outros não escolhidos; trilhas; replay", async () => {
    const cond = await condicao();
    // Pedido: 3 × 10,00 − 1,00 = 29,00 e 2 × 5,00 − 10% = 9,00 → 38,00; + frete 12 + outras 3 − desconto 5 = 48,00.
    const k = await cotacao({ condicoesPedido: [cond], condicoesOrcamento: [cond], extraPedido: { frete: "12.00", outras_despesas: "3.00", desconto: "5.00" },
      itens: ([p1, p2]) => [itemCompra(p1.id, "3", "10.00", { desconto: "1.00" }), itemCompra(p2.id, "2", "5.00", { desconto_percentual: "10" })] });
    const antes = await doc(k.ped.id);
    expect([antes.fornecedor_id, antes.condicao_pagamento_id, antes.valor_itens, antes.valor_total], "premissa: o pedido de antes").toEqual([c.I.provider, null, "38.00", "48.00"]);
    const fa = await fornecedor(); const fb = await fornecedor(); const fc = await fornecedor();
    const [i0, i1] = k.ped.itens;
    const preco = (a: string, b: string) => [{ item_pedido_id: i0!.id, valor_unitario: a }, { item_pedido_id: i1!.id, valor_unitario: b }];
    const oa = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, fa.id, { itens: preco("8.00", "4.00") }));
    const ob = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, fb.id, { condicao_pagamento_id: cond, prazo_entrega_dias: 7, itens: preco("9.50", "4.25") }));
    const oc = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, fc.id, { itens: preco("1.00", "1.00") }));
    expect((await cancelarOrcamento(oc.id)).statusCode).toBe(200);

    const chave = `f6a-or4a-${unico()}`;
    const r = await escolher(k.ped.id, ob.id, c.h.headers(), chave);
    expect(r.statusCode, r.body).toBe(200);
    // 3 × 9,50 + 2 × 4,25 = 37,00; + 12 + 3 − 5 = 47,00.
    const b = j(r);
    expect(b).toEqual({ pedido: { id: k.ped.id, situacao: "aberto", fornecedor_id: fb.id, condicao_pagamento_id: cond, valor_itens: "37.00", valor_total: "47.00" },
      vencedor: { id: ob.id, situacao: "escolhido" }, naoEscolhidos: [oa.id] });
    // NO BANCO: o pedido, com o plano da condição (1 parcela a 30 dias da data do pedido).
    expect(await doc(k.ped.id)).toMatchObject({ situacao: "aberto", fornecedor_id: fb.id, condicao_pagamento_id: cond, parcelas_ajustadas: false,
      plano_parcelas: { installments: 1, first_due_date: "2026-10-10", mode: "interval", interval_days: 30, has_down_payment: false },
      valor_itens: "37.00", frete: "12.00", outras_despesas: "3.00", desconto: "5.00", valor_total: "47.00" });
    expect((await itensDe(k.ped.id)).map((i) => [i.produto_id, i.quantidade, i.valor_unitario, i.desconto, i.desconto_percentual, i.valor_total]))
      .toEqual([[k.produtos[0].id, "3.0000", "9.500000", "0.00", "0.0000", "28.50"], [k.produtos[1].id, "2.0000", "4.250000", "0.00", "0.0000", "8.50"]]);
    expect((await orcamentosDe(k.ped.id)).map((o) => [o.id, o.situacao])).toEqual([[oa.id, "nao_escolhido"], [ob.id, "escolhido"], [oc.id, "cancelado"]]);
    // AS TRILHAS: o pedido (o que mudou), o vencedor e o não escolhido; o cancelado não ganha trilha.
    expect(await trilha(k.ped.id, "escolher_vencedor")).toEqual([{ user_id: c.h.demo.adminUserId, metadata: { orcamento: ob.id, naoEscolhidos: [oa.id] },
      before: { fornecedor_id: c.I.provider, condicao_pagamento_id: null, valor_itens: "38.00", valor_total: "48.00" },
      after: { fornecedor_id: fb.id, condicao_pagamento_id: cond, valor_itens: "37.00", valor_total: "47.00" } }]);
    expect((await trilha(ob.id, "escolhido")).map((x) => [x.metadata, x.before, x.after])).toEqual([[{ pedido: k.ped.id }, { situacao: "aberto" }, { situacao: "escolhido" }]]);
    expect((await trilha(oa.id, "nao_escolhido")).map((x) => [x.metadata, x.before, x.after])).toEqual([[{ pedido: k.ped.id, vencedor: ob.id }, { situacao: "aberto" }, { situacao: "nao_escolhido" }]]);
    expect(await trilha(oc.id, "nao_escolhido")).toEqual([]);
    // O REPLAY: o mesmo corpo; não escolhe de novo (nenhuma trilha nova).
    const r2 = await escolher(k.ped.id, ob.id, c.h.headers(), chave);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(r2)).toEqual(b);
    expect(await trilha(k.ped.id, "escolher_vencedor")).toHaveLength(1);
    // A leitura do pedido mostra os orçamentos com as situações novas.
    expect((j(await lerCompra("pedido", k.ped.id)).orcamentos as { id: string; situacao: string }[]).map((o) => o.situacao)).toEqual(["nao_escolhido", "escolhido", "cancelado"]);
  });

  it("OR-4b um vencedor por pedido: o não escolhido e o escolhido → 409 (não aberto); orçamento aberto depois do vencedor → 409 (já tem); criar depois → 409; editar e cancelar o escolhido → 409", async () => {
    const k = await cotacao();
    const fa = await fornecedor(); const fb = await fornecedor();
    const oa = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, fa.id));
    const ob = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, fb.id));
    expect((await escolher(k.ped.id, ob.id)).statusCode, "premissa: o primeiro vencedor é escolhido").toBe(200);
    const depoisDoVencedor = await doc(k.ped.id);
    for (const [nome, id] of [["o não escolhido", oa.id], ["o próprio vencedor, sem a chave", ob.id]] as const) {
      const r = await escolher(k.ped.id, id);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(409);
      expect(erro(r), nome).toEqual({ code: "CONFLICT", message: MSG_ORC_NAO_ABERTO });
    }
    // Criar orçamento depois do vencedor: a cotação está encerrada.
    const fc = await fornecedor();
    const tarde = await criarOrcamento(k.ped.id, corpoOrcamento(k.topOrc, fc.id));
    expect(tarde.statusCode, tarde.body).toBe(409);
    expect(erro(tarde)).toEqual({ code: "CONFLICT", message: MSG_JA_TEM_VENCEDOR });
    // Um orçamento ABERTO gravado direto no banco (o gatilho aceita: pedido aberto e aprovado) → escolher recusa: já tem vencedor.
    const versaoOrc = await versaoAtualNoBanco(k.topOrc);
    const avulso = (await c.admin.query<{ id: string }>(
      `insert into erp.documentos_compra (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, fornecedor_id,
          data_documento, valor_itens, valor_total, pedido_orcado_id, criado_por)
       values ($1, $2, 'orcamento', $3, $4, $5, $6, $7, 0, 0, $8, $9) returning id`,
      [c.h.demo.orgId, c.I.empresa, `F6A${unico()}`, k.topOrc, versaoOrc.id, fc.id, DATA, k.ped.id, c.h.demo.adminUserId])).rows[0]!.id;
    const ra = await escolher(k.ped.id, avulso);
    expect(ra.statusCode, ra.body).toBe(409);
    expect(erro(ra)).toEqual({ code: "CONFLICT", message: MSG_JA_TEM_VENCEDOR });
    expect((await orcamentosDe(k.ped.id)).map((o) => o.situacao)).toEqual(["nao_escolhido", "escolhido", "aberto"]);
    expect(await doc(k.ped.id)).toEqual(depoisDoVencedor);
    // O escolhido não se edita nem se cancela.
    const corpo = { condicao_pagamento_id: null, prazo_entrega_dias: null, validade_orcamento: null, observacao: null,
      itens: (await itensDe(ob.id)).map((i) => ({ id: i.id, valor_unitario: "1.00" })) };
    for (const r of [await editarOrcamento(ob.id, corpo), await cancelarOrcamento(ob.id)]) {
      expect(r.statusCode, r.body).toBe(409);
      expect(erro(r)).toEqual({ code: "CONFLICT", message: MSG_ORC_NAO_ABERTO });
    }
    expect((await doc(ob.id)).situacao).toBe("escolhido");
  });

  it("OR-4c o pedido que gerou compra (inclusive cancelada) → 409, o fornecedor dele fica; o pedido finalizado → 409", async () => {
    const k = await cotacao({ comCompra: true });
    const f = await fornecedor();
    const o = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id, { itens: [{ item_pedido_id: k.ped.itens[0]!.id, valor_unitario: "7.00" }] }));
    const parte = await receberPedido(k.ped.id, corpoReceber(k.topCompra!, [{ item_origem_id: k.ped.itens[0]!.id, quantidade: "1" }]));
    expect(parte.statusCode, `premissa: o pedido com orçamento vivo é recebido em parte — ${parte.body}`).toBe(201);
    const compraId = j(parte).id as string;
    for (const quando of ["com a compra viva", "com a compra cancelada"]) {
      const r = await escolher(k.ped.id, o.id);
      expect(r.statusCode, `${quando}: ${r.body}`).toBe(409);
      expect(erro(r), quando).toEqual({ code: "CONFLICT", message: MSG_VENCEDOR_COM_COMPRA });
      expect([(await doc(k.ped.id)).fornecedor_id, (await doc(o.id)).situacao], quando).toEqual([c.I.provider, "aberto"]);
      if (quando === "com a compra viva") expect((await inject("POST", `/api/compras/compras/${compraId}/cancel`, c.h.headers(), {})).statusCode).toBe(200);
    }
    expect((await doc(compraId)).situacao, "premissa: a compra foi cancelada").toBe("cancelado");

    const fin = await cotacao();
    const of = await orcamentoCriado(fin.ped.id, corpoOrcamento(fin.topOrc, f.id));
    expect((await finalizar(fin.ped.id)).statusCode, "premissa: o pedido é finalizado").toBe(200);
    const r = await escolher(fin.ped.id, of.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual({ code: "CONFLICT", message: MSG_VENCEDOR_SO_ABERTO });
    expect([(await doc(fin.ped.id)).situacao, (await doc(of.id)).situacao]).toEqual(["finalizado", "aberto"]);
  });

  it("OR-4d a condição do vencedor fora das permitidas da TOP do PEDIDO → 422, nada muda; premissa: no MESMO pedido, o orçamento com a condição permitida vence", async () => {
    const condA = await condicao(); const condB = await condicao();
    const k = await cotacao({ condicoesPedido: [condA], condicoesOrcamento: [condA, condB] });
    const fa = await fornecedor(); const fb = await fornecedor();
    const oa = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, fa.id, { condicao_pagamento_id: condA }));
    const ob = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, fb.id, { condicao_pagamento_id: condB }));
    const pedidoAntes = await doc(k.ped.id); const itensAntes = await itensDe(k.ped.id);
    const r = await escolher(k.ped.id, ob.id);
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual({ code: "CONDICAO_PAGAMENTO_NAO_PERMITIDA", message: MSG_CONDICAO_NAO_PERMITIDA, details: { campo: "condicao_pagamento_id" } });
    expect(await doc(k.ped.id)).toEqual(pedidoAntes);
    expect(await itensDe(k.ped.id)).toEqual(itensAntes);
    expect((await orcamentosDe(k.ped.id)).map((o) => o.situacao)).toEqual(["aberto", "aberto"]);
    const ok = await escolher(k.ped.id, oa.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await doc(k.ped.id)).condicao_pagamento_id).toBe(condA);
  });

  it("OR-4f o vencedor SEM condição não apaga a do pedido: ela fica (lida como gravada, mesmo inativada depois) e o plano sai dela; premissa: o pedido nasceu com a condição", async () => {
    const cond = await condicao();
    const k = await cotacao({ condicoesPedido: [cond], extraPedido: { condicao_pagamento_id: cond } });
    const antes = await doc(k.ped.id);
    expect([antes.condicao_pagamento_id, antes.valor_total], "premissa: o pedido nasceu com a condição, 40,00").toEqual([cond, "40.00"]);
    const f = await fornecedor();
    const [i0, i1] = k.ped.itens;
    const o = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id,
      { itens: [{ item_pedido_id: i0!.id, valor_unitario: "9.00" }, { item_pedido_id: i1!.id, valor_unitario: "4.00" }] }));
    expect((await doc(o.id)).condicao_pagamento_id, "premissa: o vencedor não tem condição").toBeNull();
    // A condição do pedido é inativada DEPOIS de gravada: o vencedor não a revalida (só refaz o plano com ela).
    await c.admin.query("update erp.condicoes_pagamento set is_active = false where id = $1", [cond]);
    const r = await escolher(k.ped.id, o.id);
    expect(r.statusCode, r.body).toBe(200);
    // 3 × 9,00 + 2 × 4,00 = 35,00.
    expect(j(r).pedido).toEqual({ id: k.ped.id, situacao: "aberto", fornecedor_id: f.id, condicao_pagamento_id: cond, valor_itens: "35.00", valor_total: "35.00" });
    expect(await doc(k.ped.id)).toMatchObject({ fornecedor_id: f.id, condicao_pagamento_id: cond, parcelas_ajustadas: false,
      plano_parcelas: { installments: 1, first_due_date: "2026-10-10", mode: "interval", interval_days: 30, has_down_payment: false },
      valor_itens: "35.00", valor_total: "35.00" });
    expect((await trilha(k.ped.id, "escolher_vencedor")).map((x) => [x.before, x.after])).toEqual([[
      { fornecedor_id: c.I.provider, condicao_pagamento_id: cond, valor_itens: "40.00", valor_total: "40.00" },
      { fornecedor_id: f.id, condicao_pagamento_id: cond, valor_itens: "35.00", valor_total: "35.00" }]]);
  });

  it("OR-4e corpo com chave → 422; sem orcamentos_compra.edit → 403; sem pedidos_compra.edit → 403; a MESMA 404 (orçamento de outro pedido, malformados); nada muda", async () => {
    const k = await cotacao(); const outra = await cotacao();
    const f = await fornecedor();
    const o = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id));
    const deOutro = await orcamentoCriado(outra.ped.id, corpoOrcamento(outra.topOrc, f.id));
    const ref = await ref404();
    expect((await escolher(k.ped.id, o.id, c.h.headers(), undefined, { motivo: "x" })).statusCode).toBe(422);
    const semOrcamento = await usuario("Sem editar orçamento no vencedor F6a", ["pedidos_compra.view", "pedidos_compra.edit", "orcamentos_compra.view"]);
    const semPedido = await usuario("Sem editar pedido no vencedor F6a", ["pedidos_compra.view", "orcamentos_compra.view", "orcamentos_compra.edit"]);
    for (const headers of [semOrcamento, semPedido]) expect((await escolher(k.ped.id, o.id, headers)).statusCode).toBe(403);
    const casos: [string, string, string][] = [
      ["orçamento de outro pedido", k.ped.id, deOutro.id],
      ["o pedido no lugar do orçamento", k.ped.id, k.ped.id],
      ["pedido malformado", "nao-e-uuid", o.id],
      ["orçamento malformado", k.ped.id, "nao-e-uuid"],
      ["orçamento na porta do pedido", o.id, o.id],
    ];
    for (const [nome, pedidoId, orcamentoId] of casos) {
      const r = await escolher(pedidoId, orcamentoId);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(404);
      expect(erro(r), nome).toEqual(ref);
    }
    expect([(await doc(o.id)).situacao, (await doc(deOutro.id)).situacao, (await doc(k.ped.id)).fornecedor_id]).toEqual(["aberto", "aberto", c.I.provider]);
    expect((await escolher(k.ped.id, o.id)).statusCode, "premissa: o administrador escolhe").toBe(200);
  });
});

// ─────────────── OR-5 ───────────────

describe("OR-5 o fluxo completo pela API", () => {
  it("OR-5 pedido 'A partir de 1000,00' → aprovado para orçamento → 2 orçamentos → vencedor → finalizar 409 → aprovar na fila → finalizar 200 → receber 201", async () => {
    const topCompra = await topNoFormato("compras.compra", cfg4());
    const topOrc = await topNoFormato("compras.orcamento", cfg4());
    const topPedido = await topNoFormato("compras.pedido", cfg4((x) => { x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = "1000.00"; }),
      { destinos: [{ tipoOperacaoId: topOrc, ordem: 0, emPartes: false }, { tipoOperacaoId: topCompra, ordem: 1, emPartes: false }] });
    const p1 = await produto(); const p2 = await produto();
    // O pedido nasce com preço de referência: 10 × 1,00 + 5 × 2,00 = 20,00 (abaixo do mínimo: não exige aprovação).
    const ped = await pedido([itemCompra(p1.id, "10", "1.00"), itemCompra(p2.id, "5", "2.00")], topPedido);
    const previa = (await inject("GET", `/api/compras/pedidos/${ped.id}/previa-finalizacao`)).json() as Record<string, unknown>;
    expect(previa, "premissa: com 20,00 a aprovação não é exigida").toMatchObject({ podeFinalizar: true, aprovacao: { situacao: "nao_exigida" } });

    expect((await aprovarParaOrcamento(ped.id)).statusCode).toBe(200);
    const fb = await fornecedor(); const fc = await fornecedor();
    const [i0, i1] = ped.itens;
    const ob = await orcamentoCriado(ped.id, corpoOrcamento(topOrc, fb.id, { itens: [{ item_pedido_id: i0!.id, valor_unitario: "80.00" }, { item_pedido_id: i1!.id, valor_unitario: "40.00" }] }));
    const oc = await orcamentoCriado(ped.id, corpoOrcamento(topOrc, fc.id, { itens: [{ item_pedido_id: i0!.id, valor_unitario: "95.00" }, { item_pedido_id: i1!.id, valor_unitario: "30.00" }] }));
    expect([ob.valor_total, oc.valor_total]).toEqual(["1000.00", "1100.00"]);

    // O vencedor leva os preços: 10 × 80 + 5 × 40 = 1000,00 — agora a TOP exige a aprovação.
    const v = await escolher(ped.id, ob.id);
    expect(v.statusCode, v.body).toBe(200);
    expect((await doc(ped.id))).toMatchObject({ fornecedor_id: fb.id, valor_total: "1000.00", situacao: "aberto" });
    expect((await orcamentosDe(ped.id)).map((o) => o.situacao)).toEqual(["escolhido", "nao_escolhido"]);

    const pendente = await finalizar(ped.id);
    expect(pendente.statusCode, pendente.body).toBe(409);
    expect(erro(pendente)).toEqual({ code: "APROVACAO_PENDENTE", message: MSG_PENDENTE_PEDIDO, details: { politica: "por_valor", valorMinimo: "1000.00", valorDocumento: "1000.00" } });
    expect((await filaDeCompras()).find((l) => l.id === ped.id)).toMatchObject({ especie: "pedido", situacao: "pendente", valor: "1000.00", ultimaDecisao: null });
    const aprovado = await aprovar("compras", ped.id, { observacao: "Vencedor da cotação" });
    expect(aprovado.statusCode, aprovado.body).toBe(200);
    const fin = await finalizar(ped.id);
    expect(fin.statusCode, fin.body).toBe(200);
    expect((await doc(ped.id)).situacao).toBe("finalizado");

    // Receber o pedido inteiro: a compra é do fornecedor VENCEDOR (o do pedido), com origem no pedido; o pedido converte.
    const rec = await receberPedido(ped.id, corpoReceber(topCompra, [
      { item_origem_id: i0!.id, quantidade: "10", valor_unitario: "80.00" }, { item_origem_id: i1!.id, quantidade: "5", valor_unitario: "40.00" }]));
    expect(rec.statusCode, rec.body).toBe(201);
    expect(j(rec)).toMatchObject({ from: ped.id, pedidoSituacao: "convertido" });
    const compra = await doc(j(rec).id as string);
    expect([compra.especie, compra.fornecedor_id, compra.origem_documento_id, compra.valor_total]).toEqual(["compra", fb.id, ped.id, "1000.00"]);
    expect((await doc(ped.id)).situacao).toBe("convertido");
    // Os orçamentos não mudam com a finalização nem com o recebimento.
    expect((await orcamentosDe(ped.id)).map((o) => o.situacao)).toEqual(["escolhido", "nao_escolhido"]);
  });
});

// ─────────────── OR-6 ───────────────

describe("OR-6 escopo de empresa e a lista única", () => {
  it("OR-6a quem só vê a empresa A não lê, não lista e não altera orçamento da B (a MESMA 404); premissa: na A, cria e lê", async () => {
    const ref = await ref404();
    const kB = await cotacao({ extraPedido: { empresa_id: c.I.empresa2 }, itens: ([p1]) => [itemCompra(p1.id, "1", "10.00", { armazem_id: c.I.warehouseEmpresa2 })] });
    const f = await fornecedor(); const g = await fornecedor();
    const oB = await orcamentoCriado(kB.ped.id, corpoOrcamento(kB.topOrc, f.id));
    expect((await doc(oB.id)).empresa_id, "premissa: o orçamento é da empresa do pedido (a 2)").toBe(c.I.empresa2);
    const soA = await usuario("Cotador só da A F6a", ["compras.edit", "pedidos_compra.view", "pedidos_compra.edit", "orcamentos_compra.view",
      "orcamentos_compra.create", "orcamentos_compra.edit", "orcamentos_compra.delete"], escopos({ compras: [c.I.empresa] }));
    const corpoPut = { condicao_pagamento_id: null, prazo_entrega_dias: 3, validade_orcamento: null, observacao: null,
      itens: (await itensDe(oB.id)).map((i) => ({ id: i.id, valor_unitario: "1.00" })) };
    const respostas: [string, Resposta][] = [
      ["ler", await lerOrcamento(oB.id, soA)],
      ["editar", await editarOrcamento(oB.id, corpoPut, soA)],
      ["cancelar", await cancelarOrcamento(oB.id, soA)],
      ["escolher", await escolher(kB.ped.id, oB.id, soA)],
      ["criar no pedido da B", await criarOrcamento(kB.ped.id, corpoOrcamento(kB.topOrc, g.id), soA)],
      ["aprovar para orçamento o pedido da B", await aprovarParaOrcamento(kB.ped.id, soA)],
    ];
    for (const [nome, r] of respostas) {
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(404);
      expect(erro(r), nome).toEqual(ref);
    }
    // A LISTA: o administrador vê o orçamento da B; quem só vê a A, não (nem pelo filtro do pedido).
    const lista = async (headers: Hdr, q = "") => {
      const r = await inject("GET", `/api/compras/orcamentos?pageSize=200${q}`, headers);
      expect(r.statusCode, r.body).toBe(200);
      return j(r) as { items: { id: string; especie: string }[]; total: number };
    };
    expect((await lista(c.h.headers())).items.map((x) => x.id), "premissa: a lista do administrador tem o orçamento da B").toContain(oB.id);
    expect((await lista(soA)).items.map((x) => x.id)).not.toContain(oB.id);
    expect((await lista(soA, `&pedido_orcado_id=${kB.ped.id}`)).total).toBe(0);
    // Nada mudou no orçamento nem no pedido da B.
    expect([(await doc(oB.id)).situacao, (await doc(oB.id)).prazo_entrega_dias, (await orcamentosDe(kB.ped.id)).length]).toEqual(["aberto", null, 1]);
    // Premissa: na empresa A, o mesmo usuário cria e lê.
    const kA = await cotacao();
    const oA = await orcamentoCriado(kA.ped.id, corpoOrcamento(kA.topOrc, f.id), soA);
    expect((await lerOrcamento(oA.id, soA)).statusCode).toBe(200);
    expect((await lista(soA)).items.map((x) => x.id)).toContain(oA.id);
  });

  it("OR-6b as portas não se cruzam: pedido e compra na porta do orçamento → a MESMA 404; a lista única só mostra o orçamento a pedido e com orcamentos_compra.view", async () => {
    const ref = await ref404();
    const k = await cotacao();
    const f = await fornecedor();
    const o = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id));
    const p = await produto();
    const compra = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")]));
    for (const [nome, id] of [["pedido", k.ped.id], ["compra", compra.id], ["malformado", "nao-e-uuid"]] as const) {
      const r = await lerOrcamento(id);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(404);
      expect(erro(r), nome).toEqual(ref);
    }
    expect((await lerOrcamento(o.id)).statusCode, "premissa: o orçamento é lido pela porta dele").toBe(200);
    const listaUnica = async (q: string, headers: Hdr = c.h.headers()) => {
      const r = await inject("GET", `/api/compras/documentos?pageSize=200&${q}`, headers);
      expect(r.statusCode, r.body).toBe(200);
      return j(r) as { items: { id: string; especie: string }[]; total: number };
    };
    expect((await listaUnica("")).items.map((x) => x.id), "o padrão de hoje: pedido e compra").not.toContain(o.id);
    expect((await listaUnica(`especie=orcamento&pedido_orcado_id=${k.ped.id}`)).items.map((x) => [x.id, x.especie])).toEqual([[o.id, "orcamento"]]);
    const soOrcamento = await usuario("Leitor de orçamento F6a", ["orcamentos_compra.view"]);
    const semOrcamento = await usuario("Leitor de compras F6a", ["compras.view", "pedidos_compra.view"]);
    expect((await listaUnica(`especie=orcamento&pedido_orcado_id=${k.ped.id}`, soOrcamento)).items.map((x) => x.id)).toEqual([o.id]);
    expect((await listaUnica(`especie=orcamento&pedido_orcado_id=${k.ped.id}`, semOrcamento)).total).toBe(0);
  });

  it("OR-6c a leitura do PEDIDO não é porta para o orçamento: sem orcamentos_compra.view a chave `orcamentos` não vem; com ela, vem; criar sem ver orçamento ainda recusa o fornecedor repetido", async () => {
    const k = await cotacao();
    const f = await fornecedor();
    const o = await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, f.id, { itens: [{ item_pedido_id: k.ped.itens[0]!.id, valor_unitario: "9.50" }] }));
    const soPedido = await usuario("Só lê pedido F6a", ["pedidos_compra.view"]);
    const pedidoEOrcamento = await usuario("Lê pedido e orçamento F6a", ["pedidos_compra.view", "orcamentos_compra.view"]);
    // Premissa: a porta do orçamento é negada a quem só lê pedido (falta a capacidade) e aberta a quem tem as duas.
    expect((await lerOrcamento(o.id, soPedido)).statusCode).toBe(403);
    expect((await lerOrcamento(o.id, pedidoEOrcamento)).statusCode).toBe(200);
    // Com as duas: o pedido traz o orçamento (fornecedor e valor: 3 × 9,50 + 2 × 0 = 28,50).
    const com = await lerCompra("pedido", k.ped.id, pedidoEOrcamento);
    expect(com.statusCode, com.body).toBe(200);
    expect((j(com).orcamentos as { id: string; fornecedor_id: string; valor_total: string }[]).map((x) => [x.id, x.fornecedor_id, x.valor_total]))
      .toEqual([[o.id, f.id, "28.50"]]);
    // Só com a do pedido: o MESMO pedido é lido, sem a chave — nem id, nem fornecedor, nem valor do orçamento.
    const sem = await lerCompra("pedido", k.ped.id, soPedido);
    expect(sem.statusCode, sem.body).toBe(200);
    expect(j(sem).id).toBe(k.ped.id);
    expect(Object.keys(j(sem))).not.toContain("orcamentos");
    expect(sem.body).not.toContain(o.id);
    // Criar pede orcamentos_compra.create (não "ver"): o fornecedor repetido continua recusado; premissa: outro fornecedor cria.
    const criador = await usuario("Cria orçamento sem ver F6a", ["pedidos_compra.view", "orcamentos_compra.create"]);
    const repetido = await criarOrcamento(k.ped.id, corpoOrcamento(k.topOrc, f.id), criador);
    expect(repetido.statusCode, repetido.body).toBe(409);
    expect(erro(repetido)).toEqual({ code: "CONFLICT", message: MSG_FORNECEDOR_REPETIDO });
    await orcamentoCriado(k.ped.id, corpoOrcamento(k.topOrc, (await fornecedor()).id), criador);
    expect(await orcamentosDe(k.ped.id)).toHaveLength(2);
  });
});

// ─────────────── OR-7 ───────────────

describe("OR-7 as portas de leitura do lançamento e as regras da TOP do orçamento", () => {
  it("OR-7a operation-types: as capacidades de hoje + finalizacaoEOrcamento (a última), a família do orçamento e as TOPs dela; 403 sem orcamentos_compra.create", async () => {
    const topOrc = await topNoFormato("compras.orcamento", cfg4());
    const r = await inject("GET", "/api/compras/orcamentos/operation-types");
    expect(r.statusCode, r.body).toBe(200);
    const b = j(r);
    expect(Object.keys(b)).toEqual(["contractVersion", "capacidades", "family", "defaultId", "items"]);
    expect(b.contractVersion).toBe(1);
    expect(b.capacidades).toEqual({ classificacaoFinanceira: 1, condicaoPagamento: 1, layoutDocumento: 1, regrasDaOperacao: 1, finalizacaoEOrcamento: 1 });
    expect(Object.keys(b.capacidades as object)).toEqual(["classificacaoFinanceira", "condicaoPagamento", "layoutDocumento", "regrasDaOperacao", "finalizacaoEOrcamento"]);
    expect(b.family).toEqual({ code: "compras.orcamento", label: "Orçamento de compra" });
    expect((b.items as { id: string }[]).map((x) => x.id)).toContain(topOrc);
    const leitor = await usuario("Só lê orçamento F6a", ["orcamentos_compra.view"]);
    expect((await inject("GET", "/api/compras/orcamentos/operation-types", leitor)).statusCode).toBe(403);
  });

  it("OR-7b regras da operação e layout: o contrato do pedido com o mapa do orçamento; a MESMA 404 para TOP ausente, malformada e de outra família", async () => {
    const cond = await condicao();
    const topOrc = await topNoFormato("compras.orcamento", cfg4((x) => { x.geral.exigeObservacao = true; }), { condicoesPermitidas: [cond] });
    const r = await inject("GET", `/api/compras/orcamentos/regras-da-operacao?tipo_operacao_id=${topOrc}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ contractVersion: 1, formato: 4, exigencias: ["observacao"], condicoesPermitidas: [cond], geraTitulos: false,
      exigeFormaPagamento: false, exigeVencimento: false, exigeArmazem: false });
    const l = await inject("GET", `/api/compras/orcamentos/layout-efetivo?tipo_operacao_id=${topOrc}`);
    expect(l.statusCode, l.body).toBe(200);
    expect(j(l)).toMatchObject({ origem: "sistema" });
    const ausente = await inject("GET", "/api/compras/orcamentos/regras-da-operacao");
    expect(ausente.statusCode).toBe(404);
    const refTop = erro(ausente);
    for (const porta of ["regras-da-operacao", "layout-efetivo"]) {
      for (const [nome, q] of [["ausente", ""], ["malformada", "?tipo_operacao_id=nao-e-uuid"], ["de outra família", `?tipo_operacao_id=${c.tops.pedidoCompra}`]] as const) {
        const x = await inject("GET", `/api/compras/orcamentos/${porta}${q}`);
        expect(x.statusCode, `${porta} ${nome}: ${x.body}`).toBe(404);
        expect(erro(x), `${porta} ${nome}`).toEqual(refTop);
      }
    }
  });

  it("OR-7c a TOP do orçamento cobra ao criar: exigência da Geral (antes da condição) e condição permitida; premissa: atendidas, cria", async () => {
    const cond = await condicao(); const fora = await condicao();
    const topOrc = await topNoFormato("compras.orcamento", cfg4((x) => { x.geral.exigeObservacao = true; }), { condicoesPermitidas: [cond] });
    const k = await cotacao({ topOrc });
    const f = await fornecedor();
    const exigencia: Erro = { code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: "A operação exige dados que o documento não tem.",
      details: { exigencias: [{ caminho: "observacao", mensagem: "Observação é obrigatório nesta operação." }] } };
    const semObs = await criarOrcamento(k.ped.id, corpoOrcamento(topOrc, f.id, { condicao_pagamento_id: fora }));
    expect(semObs.statusCode, semObs.body).toBe(422);
    expect(erro(semObs), "as duas faltas: a exigência vem antes (o molde da compra)").toEqual(exigencia);
    const condFora = await criarOrcamento(k.ped.id, corpoOrcamento(topOrc, f.id, { condicao_pagamento_id: fora, observacao: "Com observação" }));
    expect(condFora.statusCode, condFora.body).toBe(422);
    expect(erro(condFora)).toEqual({ code: "CONDICAO_PAGAMENTO_NAO_PERMITIDA", message: MSG_CONDICAO_NAO_PERMITIDA, details: { campo: "condicao_pagamento_id" } });
    expect(await orcamentosDe(k.ped.id)).toEqual([]);
    await orcamentoCriado(k.ped.id, corpoOrcamento(topOrc, f.id, { condicao_pagamento_id: cond, observacao: "Com observação" }));
  });

  it("OR-7d o orçamento não é criado de pedido que não está aberto (finalizado) → 409; premissa: aberto, cria", async () => {
    const k = await cotacao();
    const f = await fornecedor();
    expect((await finalizar(k.ped.id)).statusCode).toBe(200);
    const r = await criarOrcamento(k.ped.id, corpoOrcamento(k.topOrc, f.id));
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual({ code: "CONFLICT", message: MSG_ORC_SO_PEDIDO_ABERTO });
    expect(await orcamentosDe(k.ped.id)).toEqual([]);
    const aberto = await cotacao();
    await orcamentoCriado(aberto.ped.id, corpoOrcamento(aberto.topOrc, f.id));
  });
});
