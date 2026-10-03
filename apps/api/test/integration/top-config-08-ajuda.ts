import { expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import {
  CHAVES_MODULO_EMPRESA, SEGMENTO_DA_ESPECIE_ESTOQUE,
  configuracaoNeutraTopV3, configuracaoNeutraTopV4,
  type ConfiguracaoTipoOperacaoV3, type ConfiguracaoTipoOperacaoV4, type EspecieEstoque, type EspecieEstoqueDaCentral,
} from "@agro/domain";
import { appCom, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-08 (decisão 277) — O CENÁRIO DOS TESTES DE INTEGRAÇÃO DAS REGRAS GERAIS E DA APROVAÇÃO (F4, CA, SI, AP).
 *
 * Cada arquivo `top-config-08-*.test.ts` sobe o PRÓPRIO harness (banco recriado) e usa este cenário. O estado é do
 * módulo — o vitest isola os módulos por arquivo —, preenchido por `iniciar()` no `beforeAll`.
 *
 * UMA INSTÂNCIA SÓ PARA TUDO: a `ligada` (`TOP_EFFECTS_RUNTIME_V1_ENABLED=1`), que é a de produção desde 26/09/2026
 * (DEPLOYMENT, TOP-CONFIG-04A). É por ela que as TOPs nascem — a porta administrativa exige o gate para o formato 3
 * e o 4 — e é por ela que os documentos são lançados, confirmados e aprovados. A instância do harness (`c.h.app`, gate
 * desligado) continua à mão para quem quiser medir a outra.
 *
 * O QUE CONTA COMO PROVA (o molde da COMPRAS-01 e do ESTOQUE-01): nenhuma asserção decisiva é só status HTTP. A
 * situação do documento, os movimentos de estoque, os títulos, as decisões de aprovação, a trilha e as versões da TOP
 * são LIDOS NO BANCO por conexão própria de superusuário (`c.admin`, sem RLS), pela origem (`source_type`,
 * `source_id`) ou pelo id. Toda asserção de "zero efeito" vem com a PREMISSA ao lado: o mesmo cenário, corrigido,
 * produz o efeito — senão "zero" poderia ser só um cenário que nunca funcionaria.
 *
 * Cada caso cria a PRÓPRIA TOP e o PRÓPRIO produto (`produtoComSaldo`): nenhum caso lê o saldo de outro, e a ordem
 * de execução não importa. As TOPs neutras do formato 4 de `c.tops` são só o padrão dos corpos de compra e de
 * estoque (lá a TOP é obrigatória); o caso que mede uma regra cria a sua com `top(codigoBase, { configuracao })`.
 */

export type Hdr = Record<string, string>;
export type Resposta = { statusCode: number; body: string; json: () => unknown };
export type Detalhe = { path: string; message: string };
export type Erro = { code: string; message: string; details?: unknown };
export const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
/** O corpo de erro (`{ code, message, details }`) de uma resposta que DEVE ser erro. */
export function erro(r: Resposta): Erro {
  const e = j(r).error;
  expect(e, `a resposta é um erro: ${r.body}`).toBeDefined();
  return e!;
}

/** A data dos documentos (mês aberto). */
export const DATA = "2026-09-10";

type Ids = Awaited<ReturnType<typeof ids>>;
/** Os ids do seed, já conferidos: cada um EXISTE (um `undefined` aqui viraria um filtro que não filtra nada). */
export type IdsConferidos = { [K in keyof Ids]-?: string };

/** As TOPs NEUTRAS do formato 4 que os corpos usam quando o caso não diz qual (compra e estoque exigem TOP). */
export type TopsPadrao = Record<"venda" | "compra" | "pedidoCompra" | EspecieEstoqueDaCentral, string>;

export interface Cenario {
  h: Harness;
  /** A instância com o gate da execução configurada LIGADO (o de produção): TOPs, documentos e aprovações. */
  ligada: FastifyInstance;
  I: IdsConferidos;
  /** Conexão própria de superusuário (sem RLS): a testemunha. */
  admin: Db;
  tops: TopsPadrao;
}
export const c = {} as Cenario;

let seq = 0;
export const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}${Math.random().toString(36).slice(2, 5)}`;

export async function iniciar(): Promise<void> {
  c.h = await harness();
  c.ligada = await appCom(c.h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  const lidos = await ids(c.h);
  for (const [chave, valor] of Object.entries(lidos)) expect(valor, `premissa: o seed tem ${chave}`).toEqual(expect.any(String));
  c.I = lidos as IdsConferidos;
  c.admin = createPool(TEST_URL, { max: 4 });
  c.tops = {
    venda: await top("vendas.venda", { configuracao: cfg4() }),
    compra: await top("compras.compra", { configuracao: cfg4() }),
    pedidoCompra: await top("compras.pedido", { configuracao: cfg4() }),
    entrada: await top("estoque.entrada", { configuracao: cfg4() }),
    saida: await top("estoque.saida", { configuracao: cfg4() }),
    transferencia: await top("estoque.transferencia", { configuracao: cfg4() }),
    ajuste: await top("estoque.ajuste", { configuracao: cfg4() }),
  };
}
export async function encerrar(): Promise<void> {
  await c.ligada?.close(); await c.h?.app.close(); await c.h?.db.end(); await c.admin?.end();
}

// ─────────────── a configuração da TOP ───────────────

/** O neutro do FORMATO 4 (o do domínio), com o ajuste do caso. Cada chamada devolve um objeto novo. */
export function cfg4(ajuste: (x: ConfiguracaoTipoOperacaoV4) => void = () => {}): ConfiguracaoTipoOperacaoV4 {
  const x = configuracaoNeutraTopV4();
  ajuste(x);
  return x;
}
/** O neutro do FORMATO 3 (o do domínio), com o ajuste do caso — o corte: nele as regras gerais só declaram. */
export function cfg3(ajuste: (x: ConfiguracaoTipoOperacaoV3) => void = () => {}): ConfiguracaoTipoOperacaoV3 {
  const x = configuracaoNeutraTopV3();
  ajuste(x);
  return x;
}

// ─────────────── a TOP, pela porta administrativa ───────────────

/** O POST da TOP, cru (para medir a recusa). `extra` aceita `configuracao`, `destinos`, `condicoesPermitidas`… */
export function criarTop(codigoBase: string, extra: Record<string, unknown> = {}, headers?: Hdr): Promise<Resposta> {
  return c.ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: headers ?? c.h.headers(),
    payload: { codigo: `8${String(++seq).padStart(4, "0")}${Math.floor(Math.random() * 90 + 10)}`, codigoBase, nome: `TOP ${codigoBase} ${seq}`, ...extra } });
}
/** Uma TOP da família, pela porta administrativa (a `ligada`, como a porta exige para os formatos 3 e 4). */
export async function top(codigoBase: string, extra: Record<string, unknown> = {}, headers?: Hdr): Promise<string> {
  const r = await criarTop(codigoBase, extra, headers);
  expect(r.statusCode, `premissa: a TOP ${codigoBase} é cadastrada — ${r.body}`).toBe(201);
  return (j(r) as { id: string }).id;
}
export const detalheTop = (topId: string): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${topId}`, headers: c.h.headers() });
/** A revisão ATUAL da TOP (a otimista do PUT), lida pela rota. */
export async function revisaoTop(topId: string): Promise<number> {
  const d = await detalheTop(topId);
  expect(d.statusCode, d.body).toBe(200);
  return j(d).revisao as number;
}
/** O PUT da TOP, cru, com a revisão atual já posta (o corpo pode trazer outra, que prevalece). */
export async function editarTop(topId: string, corpo: Record<string, unknown>): Promise<Resposta> {
  return c.ligada.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${topId}`, headers: c.h.headers(),
    payload: { revisao: await revisaoTop(topId), ...corpo } });
}
/** Grava a configuração na TOP pelo PUT (revisão atual). Devolve o corpo: `versao` diz se nasceu versão nova. */
export async function novaVersao(topId: string, configuracao: unknown): Promise<{ versao: number; revisao: number }> {
  const r = await editarTop(topId, { configuracao });
  expect(r.statusCode, `premissa: a configuração é gravada — ${r.body}`).toBe(200);
  return j(r) as { versao: number; revisao: number };
}
/** A versão CORRENTE da TOP como o BANCO a guarda. */
export async function versaoAtualNoBanco(topId: string): Promise<{ id: string; versao: number; configuracao_schema_version: number; configuracao: Record<string, unknown> }> {
  const r = await c.admin.query<{ id: string; versao: number; configuracao_schema_version: number; configuracao: Record<string, unknown> }>(
    `select v.id, v.versao, v.configuracao_schema_version, v.configuracao from erp.tipos_operacao_versoes v
       join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao where t.id = $1`, [topId]);
  expect(r.rows, "premissa: a TOP tem versão corrente").toHaveLength(1);
  return r.rows[0]!;
}
/**
 * Uma versão NOVA da TOP escrita DIRETO NO BANCO (superusuário), e já tornada a corrente: o único jeito de ter uma
 * versão que a porta administrativa recusaria (a matriz da família, ou o leitor estrito). A coluna e o payload
 * concordam no número do formato (o CHECK da 0022). Devolve o id da versão nova.
 */
export async function versaoDireta(topId: string, configuracao: object): Promise<string> {
  const v = (await c.admin.query<{ id: string; versao: number }>(
    `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
     select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, $2::jsonb, ($2::jsonb ->> 'versaoSchema')::int
       from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
      where t.id = $1
     returning id, versao`, [topId, JSON.stringify(configuracao)])).rows[0]!;
  const u = await c.admin.query("update erp.tipos_operacao set versao_atual = $2 where id = $1", [topId, v.versao]);
  expect(u.rowCount, "premissa: a versão direta virou a corrente").toBe(1);
  return v.id;
}
/** TODAS as versões da TOP no banco, em ordem. */
export async function versoesNoBanco(topId: string): Promise<{ versao: number; configuracao_schema_version: number }[]> {
  return (await c.admin.query<{ versao: number; configuracao_schema_version: number }>(
    "select versao, configuracao_schema_version from erp.tipos_operacao_versoes where tipo_operacao_id = $1 order by versao", [topId])).rows;
}

// ─────────────── pessoas ───────────────

export type Escopo = { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] };
/** Todos os módulos com todas as empresas — ou, para os módulos dados, só as empresas dadas. */
export function escopos(selecionados: Partial<Record<string, string[]>> = {}): Escopo[] {
  return CHAVES_MODULO_EMPRESA.map((modulo) => {
    const empresas = selecionados[modulo];
    return empresas ? { modulo, modo: "selecionadas" as const, empresas: [...empresas] } : { modulo, modo: "todas" as const, empresas: [] };
  });
}
/**
 * Um membro NOVO com um papel de EXATAMENTE estas permissões (pela API administrativa, o caminho real). Devolve os
 * cabeçalhos dele. `escopo` padrão: todas as empresas em todos os módulos.
 */
export async function usuario(nome: string, perms: string[], escopo: Escopo[] = escopos()): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico()}@tc08.local`;
  const papel = await c.h.app.inject({ method: "POST", url: "/api/admin/roles", headers: c.h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, `premissa: o papel nasce — ${papel.body}`).toBe(201);
  const v = await c.h.app.inject({ method: "POST", url: "/api/admin/members", headers: c.h.headers(),
    payload: { name: nome, email, password: "Restrito@12345", role_id: j(papel).id, escopos_empresas: escopo } });
  expect(v.statusCode, `premissa: o membro nasce — ${v.body}`).toBe(201);
  const login = await c.h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": c.h.demo.orgId };
}

// ─────────────── produto e saldo ───────────────

export interface Produto { id: string; nome: string }

/** Produto NOVO por SQL (admin), com controle de estoque, no modelo de um do seed. Nasce sem saldo. */
export async function produto(opcoes: { controla?: boolean } = {}): Promise<Produto> {
  const m = (await c.admin.query<Record<string, string>>("select measurement_id, group_id, category_id, kind_id, financial_category_id from erp.products where id=$1", [c.I.product2])).rows[0]!;
  const s = unico();
  const r = await c.admin.query<{ id: string; description: string }>(
    `insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, kind_id, financial_category_id, control_stock, controle_lote, has_lot, is_active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'nenhum',false,true) returning id, description`,
    [c.h.demo.orgId, `T8${s}`, `Produto TC08 ${s}`, m.measurement_id, m.group_id, m.category_id, m.kind_id, m.financial_category_id, opcoes.controla ?? true]);
  return { id: r.rows[0]!.id, nome: r.rows[0]!.description };
}
/** Estoque inicial pela API (`/api/stock/opening-balances`): o saldo de partida do caso. */
export async function saldoInicial(produtoId: string, quantidade: string, armazem: string = c.I.warehouse, custo = "10"): Promise<void> {
  const r = await c.h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: c.h.headers(),
    payload: { empresa_id: c.I.empresa, warehouse_id: armazem, product_id: produtoId, quantity: quantidade, unit_value: custo } });
  expect(r.statusCode, `premissa: o estoque inicial entra — ${r.body}`).toBe(201);
}
/** Produto NOVO com controle de estoque e `quantidade` de saldo no armazém (padrão: ALM da 1ª empresa). */
export async function produtoComSaldo(quantidade: string, armazem: string = c.I.warehouse): Promise<Produto> {
  const p = await produto();
  if (quantidade !== "0") await saldoInicial(p.id, quantidade, armazem);
  return p;
}
/** O saldo no banco (4 casas, como a coluna). */
export async function saldo(produtoId: string, armazem: string = c.I.warehouse): Promise<string> {
  return (await c.admin.query<{ q: string }>(
    "select coalesce(sum(quantity),0)::numeric(18,4)::text q from erp.stock_balances where warehouse_id=$1 and product_id=$2", [armazem, produtoId])).rows[0]!.q;
}

// ─────────────── idempotência ───────────────

const comChave = (headers: Hdr, chave?: string): Hdr => (chave ? { ...headers, "idempotency-key": chave } : headers);

// ─────────────── VENDA (/api/sales/sales) ───────────────

export type ItemVenda = { product_id: string; warehouse_id?: string | null; quantity: string; unit_price: string } & Record<string, unknown>;
/** Um item de venda no ALM da 1ª empresa. */
export const itemVenda = (produtoId: string, quantidade = "1", preco = "10.00", extra: Record<string, unknown> = {}): ItemVenda =>
  ({ product_id: produtoId, warehouse_id: c.I.warehouse, quantity: quantidade, unit_price: preco, ...extra });
/**
 * O corpo da venda: 1ª empresa, cliente do seed, a data aberta. SEM TOP por padrão (a venda aceita); a do caso vem
 * em `extra.tipo_operacao_id`.
 */
export function corpoVenda(itens: ItemVenda[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { empresa_id: c.I.empresa, document_date: DATA, client_id: c.I.client, items: itens, ...extra };
}
export const lancarVenda = (corpo: Record<string, unknown>, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: "/api/sales/sales", headers: comChave(headers, chave), payload: corpo });
export async function vendaLancada(corpo: Record<string, unknown>, headers?: Hdr): Promise<Record<string, unknown> & { id: string }> {
  const r = await lancarVenda(corpo, headers);
  expect(r.statusCode, `premissa: a venda é lançada — ${r.body}`).toBe(201);
  return j(r) as Record<string, unknown> & { id: string };
}
/** O PUT da venda (sem Idempotency-Key, como a rota). */
export const editarVenda = (id: string, corpo: Record<string, unknown>, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "PUT", url: `/api/sales/sales/${id}`, headers, payload: corpo });
/** O PATCH da venda (EDITAR-01): corpo `{ version, ...só o que muda }`. */
export const patchVenda = (id: string, corpo: Record<string, unknown>, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "PATCH", url: `/api/sales/sales/${id}`, headers: comChave(headers, chave), payload: corpo });
export const confirmarVenda = (id: string, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/sales/sales/${id}/confirm`, headers: comChave(headers, chave) });
export const previaVenda = (id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/sales/sales/${id}/previa-confirmacao`, headers });
export const lerVenda = (id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/sales/sales/${id}`, headers });
/** A conversão de orçamento (`budgets`) ou pedido (`orders`) de venda: `corpo` = `{ tipo_operacao_id?, itens? }`. */
export const converterVenda = (variante: "budgets" | "orders", id: string, corpo: Record<string, unknown> = {}, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/sales/${variante}/${id}/convert`, headers: comChave(headers, chave), payload: corpo });
/** A `version` da venda (0039) como o BANCO a guarda, em string (bigint). */
export async function versaoDaVenda(id: string): Promise<string> {
  return (await c.admin.query<{ v: string }>("select version::text v from erp.sales_documents where id=$1", [id])).rows[0]!.v;
}

// ─────────────── COMPRA (/api/compras/compras e /api/compras/pedidos) ───────────────

export type EspecieCompra = "compra" | "pedido";
const SEGMENTO_COMPRA: Record<EspecieCompra, string> = { compra: "compras", pedido: "pedidos" };
export type ItemCompra = { produto_id: string; armazem_id?: string | null; quantidade: string; valor_unitario: string } & Record<string, unknown>;
export const itemCompra = (produtoId: string, quantidade = "1", valor = "10.00", extra: Record<string, unknown> = {}): ItemCompra =>
  ({ produto_id: produtoId, armazem_id: c.I.warehouse, quantidade, valor_unitario: valor, ...extra });
/**
 * O corpo da compra (ou do pedido de compra): 1ª empresa, fornecedor do seed, a data aberta e a TOP neutra do formato
 * 4 da espécie. A compra leva natureza e centro (o título a pagar os exige); o pedido não tem financeiro.
 */
export function corpoCompra(itens: ItemCompra[], extra: Record<string, unknown> = {}, especie: EspecieCompra = "compra"): Record<string, unknown> {
  return { empresa_id: c.I.empresa, tipo_operacao_id: especie === "compra" ? c.tops.compra : c.tops.pedidoCompra, fornecedor_id: c.I.provider, data_documento: DATA,
    ...(especie === "compra" ? { categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter } : {}), itens, ...extra };
}
export const lancarCompra = (especie: EspecieCompra, corpo: Record<string, unknown>, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/compras/${SEGMENTO_COMPRA[especie]}`, headers: comChave(headers, chave), payload: corpo });
export async function compraLancada(especie: EspecieCompra, corpo: Record<string, unknown>, headers?: Hdr): Promise<Record<string, unknown> & { id: string }> {
  const r = await lancarCompra(especie, corpo, headers);
  expect(r.statusCode, `premissa: o documento de compra é lançado — ${r.body}`).toBe(201);
  return j(r) as Record<string, unknown> & { id: string };
}
export const confirmarCompra = (id: string, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/compras/compras/${id}/confirm`, headers: comChave(headers, chave), payload: {} });
export const previaCompra = (id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/compras/compras/${id}/previa-confirmacao`, headers });
export const lerCompra = (especie: EspecieCompra, id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/compras/${SEGMENTO_COMPRA[especie]}/${id}`, headers });
/**
 * O RECEBER do pedido (`/convert`): gera a compra. `corpo` = `{ tipo_operacao_id, data_documento, itens: [{ item_origem_id,
 * quantidade, valor_unitario?, armazem_id? }], categoria_financeira_id, centro_custo_id, … }` (o de COMPRAS-02).
 */
export const receberPedido = (pedidoId: string, corpo: Record<string, unknown>, chave?: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/compras/pedidos/${pedidoId}/convert`, headers: comChave(headers, chave), payload: corpo });
/** O corpo do receber: a TOP de compra de destino e os itens do pedido, com natureza e centro da compra. */
export const corpoReceber = (topCompra: string, itens: ({ item_origem_id: string; quantidade: string } & Record<string, unknown>)[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  tipo_operacao_id: topCompra, data_documento: DATA, categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter,
  itens: itens.map((i) => ({ valor_unitario: "10.00", armazem_id: c.I.warehouse, ...i })), ...extra,
});

// ─────────────── ESTOQUE (/api/estoque/<segmento>) ───────────────

export const seg = (e: EspecieEstoque) => SEGMENTO_DA_ESPECIE_ESTOQUE[e];
export type ItemEstoque = Record<string, unknown> & { produto_id: string };
/**
 * O corpo do documento de estoque: 1ª empresa, ALM (e SILO como destino na transferência), a TOP neutra do formato 4
 * da espécie (troque por `extra.tipo_operacao_id`) e a data aberta.
 */
export function corpoEstoque(especie: EspecieEstoqueDaCentral, itens: ItemEstoque[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { empresa_id: c.I.empresa, tipo_operacao_id: c.tops[especie], armazem_id: c.I.warehouse,
    ...(especie === "transferencia" ? { armazem_destino_id: c.I.warehouse2 } : {}), data_documento: DATA, itens, ...extra };
}
export const lancarEstoque = (especie: EspecieEstoqueDaCentral, itens: ItemEstoque[], extra: Record<string, unknown> = {}, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/estoque/${seg(especie)}`, headers: comChave(headers, chave), payload: corpoEstoque(especie, itens, extra) });
export async function estoqueLancado(especie: EspecieEstoqueDaCentral, itens: ItemEstoque[], extra: Record<string, unknown> = {}, headers?: Hdr): Promise<Record<string, unknown> & { id: string }> {
  const r = await lancarEstoque(especie, itens, extra, headers);
  expect(r.statusCode, `premissa: o documento de estoque é lançado — ${r.body}`).toBe(201);
  return j(r) as Record<string, unknown> & { id: string };
}
export const confirmarEstoque = (especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/estoque/${seg(especie)}/${id}/confirmar`, headers: comChave(headers, chave), payload: {} });
export const previaEstoque = (especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/estoque/${seg(especie)}/${id}/previa-confirmacao`, headers });
export const lerEstoque = (especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/estoque/${seg(especie)}/${id}`, headers });

// ─────────────── APROVAÇÃO (/api/aprovacoes/*) ───────────────

/** O alvo da decisão: a venda, a compra ou a ESPÉCIE do documento de estoque (o segmento sai dela). */
export type AlvoAprovacao = "vendas" | "compras" | EspecieEstoque;
const urlDaDecisao = (alvo: AlvoAprovacao, id: string, acao: "aprovar" | "reprovar") =>
  alvo === "vendas" || alvo === "compras" ? `/api/aprovacoes/${alvo}/${id}/${acao}` : `/api/aprovacoes/estoque/${seg(alvo)}/${id}/${acao}`;
/** POST aprovar. Venda: `corpo` = `{ version, observacao? }`; compra e estoque: `{ observacao? }`. */
export const aprovar = (alvo: AlvoAprovacao, id: string, corpo: Record<string, unknown> = {}, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: urlDaDecisao(alvo, id, "aprovar"), headers: comChave(headers, chave), payload: corpo });
/** POST reprovar. Venda: `corpo` = `{ version, motivo }`; compra e estoque: `{ motivo }`. */
export const reprovar = (alvo: AlvoAprovacao, id: string, corpo: Record<string, unknown>, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: urlDaDecisao(alvo, id, "reprovar"), headers: comChave(headers, chave), payload: corpo });
/** GET da fila do módulo, com a query (`page`, `pageSize`) pedida. */
export function fila(modulo: "vendas" | "compras" | "estoque", headers: Hdr = c.h.headers(), query: Record<string, string | number> = {}): Promise<Resposta> {
  const q = new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)])).toString();
  return c.ligada.inject({ method: "GET", url: `/api/aprovacoes/${modulo}${q ? `?${q}` : ""}`, headers });
}

// ─────────────── testemunhas no banco (superusuário, sem RLS) ───────────────

export type OrigemNoLedger = "sales_documents" | "documentos_compra" | "documentos_estoque";
export interface MovNoBanco { movement_type: string; direction: number; quantity: string; product_id: string; warehouse_id: string }
/** Os movimentos do documento no ledger (estornos inclusive), pela origem. */
export async function movimentosDe(sourceType: OrigemNoLedger, id: string): Promise<MovNoBanco[]> {
  return (await c.admin.query<MovNoBanco>(
    `select movement_type, direction, quantity::text, product_id, warehouse_id
       from erp.stock_movements where source_type=$1 and source_id=$2
      order by created_at, direction, warehouse_id, product_id, id`, [sourceType, id])).rows;
}
export interface TituloNoBanco { id: string; direction: string; status: string; amount: string; due_date: string; number: string }
/** Os títulos do documento, pela origem. */
export async function titulosDe(sourceType: OrigemNoLedger, id: string): Promise<TituloNoBanco[]> {
  return (await c.admin.query<TituloNoBanco>(
    `select id, direction, status, amount::text, to_char(due_date,'YYYY-MM-DD') due_date, number
       from erp.financial_titles where source_type=$1 and source_id=$2 order by due_date, number, id`, [sourceType, id])).rows;
}
/** A situação do documento no banco: `status` da venda, `situacao` da compra e do estoque. `null` = não existe. */
export async function situacaoNoBanco(tabela: OrigemNoLedger, id: string): Promise<string | null> {
  const coluna = tabela === "sales_documents" ? "status" : "situacao";
  return (await c.admin.query<{ s: string }>(`select ${coluna} s from erp.${tabela} where id=$1`, [id])).rows[0]?.s ?? null;
}
export interface AuditoriaNoBanco { action: string; user_id: string | null; metadata: Record<string, unknown> | null }
/** A trilha da entidade, em ordem; `action` filtra (ausente = todas). */
export async function auditoriaDe(entity: string, id: string, action?: string): Promise<AuditoriaNoBanco[]> {
  return (await c.admin.query<AuditoriaNoBanco>(
    `select action, user_id, metadata from erp.audit_logs where entity=$1 and entity_id=$2 and ($3::text is null or action=$3) order by id`,
    [entity, id, action ?? null])).rows;
}
export type TabelaAprovacao = "aprovacoes_venda" | "aprovacoes_compra" | "aprovacoes_estoque";
export interface DecisaoNoBanco {
  id: string; decisao: "aprovado" | "reprovado"; observacao: string | null; decidido_por: string; decidido_em: string;
  empresa_id: string; tipo_operacao_id: string; tipo_operacao_versao_id: string;
  /** Só na venda. */ versao_documento?: string;
  /** Venda e compra. */ valor_documento?: string;
}
/** As decisões do documento, na ordem em que foram gravadas (`id`). Só inserção: a história inteira fica. */
export async function decisoesDe(tabela: TabelaAprovacao, id: string): Promise<DecisaoNoBanco[]> {
  const proprias = tabela === "aprovacoes_venda" ? ", versao_documento::text, valor_documento::text" : tabela === "aprovacoes_compra" ? ", valor_documento::text" : "";
  return (await c.admin.query<DecisaoNoBanco>(
    `select id::text, decisao, observacao, decidido_por, decidido_em::text, empresa_id, tipo_operacao_id, tipo_operacao_versao_id${proprias}
       from erp.${tabela} where documento_id=$1 order by id`, [id])).rows;
}

// ─────────────── concorrência ───────────────

/**
 * DUAS REQUISIÇÕES EM PARALELO DE VERDADE (o molde do ESTOQUE-01).
 *
 * Uma conexão própria (superusuário) segura uma trava (`sqlTrava`) que as duas requisições pedem DEPOIS de começar.
 * As duas são disparadas juntas; a barreira só é solta quando HÁ DUAS transações esperando trava no banco
 * (`pg_stat_activity`). É o que torna o caso determinístico: sem a barreira, "simultâneo" seria uma questão de sorte
 * do escalonador, e um verde por sorte não prova nada.
 *
 * Devolve as duas respostas e quantas transações esperavam trava quando a barreira caiu (a premissa: 2).
 */
export async function emParaleloComBarreira(sqlTrava: string, params: unknown[], a: () => Promise<Resposta>, b: () => Promise<Resposta>):
  Promise<{ respostas: [Resposta, Resposta]; esperando: number }> {
  const barreira = await c.admin.connect();
  let esperando = 0;
  try {
    await barreira.query("begin");
    const travou = await barreira.query(sqlTrava, params);
    expect(travou.rowCount, "premissa: a barreira travou a linha").toBe(1);
    const pa = a(); const pb = b();
    const limite = Date.now() + 15_000;
    while (Date.now() < limite) {
      esperando = Number((await c.admin.query<{ n: string }>(
        "select count(*)::text n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and state = 'active'")).rows[0]!.n);
      if (esperando >= 2) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await barreira.query("rollback");
    const respostas = await Promise.all([pa, pb]) as [Resposta, Resposta];
    return { respostas, esperando };
  } finally {
    // Se algo falhou antes de soltar, a barreira não pode ficar segurando as requisições (nem voltar ao pool aberta).
    await barreira.query("rollback").catch(() => undefined);
    barreira.release();
  }
}
