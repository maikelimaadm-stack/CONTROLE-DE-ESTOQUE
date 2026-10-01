import { expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import { CHAVES_MODULO_EMPRESA, SEGMENTO_DA_ESPECIE_ESTOQUE, type EspecieEstoque } from "@agro/domain";
import { appCom, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * ESTOQUE-01 (decisão 274) — O CENÁRIO DOS TESTES DE INTEGRAÇÃO DO DOCUMENTO DE ESTOQUE (ES-1..ES-11).
 *
 * Cada arquivo `estoque-01-*.test.ts` sobe o PRÓPRIO harness (banco recriado) e usa este cenário. O estado é do
 * módulo — o vitest isola os módulos por arquivo —, preenchido por `iniciar()` no `beforeAll`.
 *
 * O QUE CONTA COMO PROVA (o molde da COMPRAS-01): nenhuma asserção decisiva é só status HTTP. Movimentos, saldos,
 * custo médio, situação e itens do documento são LIDOS NO BANCO por conexão própria de superusuário (sem RLS), pela
 * origem do ledger (`source_type = 'documentos_estoque'`, `source_id`). Toda asserção de "zero efeito" vem com a
 * PREMISSA ao lado: o mesmo cenário, corrigido, produz o efeito.
 *
 * Cada caso cria o PRÓPRIO produto (e, quando precisa, o próprio armazém): nenhum caso lê o saldo de outro, e a
 * ordem de execução não importa.
 */

export type Hdr = Record<string, string>;
export type Resposta = { statusCode: number; body: string; json: () => unknown };
export type Detalhe = { path: string; message: string };
export type Erro = { code: string; message: string; details?: unknown };
export const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };

/** A data dos documentos (mês aberto). */
export const DATA = "2026-09-10";

type Ids = Awaited<ReturnType<typeof ids>>;
/** Os ids do seed, já conferidos: cada um EXISTE (um `undefined` aqui viraria um filtro que não filtra nada). */
export type IdsConferidos = { [K in keyof Ids]-?: string };

export interface Cenario {
  h: Harness;
  /** A instância com o gate da execução configurada LIGADO (o de produção): é por ela que as TOPs nascem. */
  ligada: FastifyInstance;
  I: IdsConferidos;
  admin: Db;
  /** Uma TOP ativa de cada família de estoque, cadastrada pela API administrativa. */
  tops: Record<EspecieEstoque, string>;
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
    entrada: await top("estoque.entrada"), saida: await top("estoque.saida"),
    transferencia: await top("estoque.transferencia"), ajuste: await top("estoque.ajuste"),
  };
}
export async function encerrar(): Promise<void> {
  await c.ligada?.close(); await c.h?.app.close(); await c.h?.db.end(); await c.admin?.end();
}

// ─────────────── cadastros ───────────────

/** Uma TOP da família, pela porta administrativa (a `ligada`, como a porta exige para o formato 3). */
export async function top(codigoBase: string, extra: Record<string, unknown> = {}, headers?: Hdr): Promise<string> {
  const r = await c.ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: headers ?? c.h.headers(),
    payload: { codigo: `74${String(++seq).padStart(4, "0")}${Math.floor(Math.random() * 90 + 10)}`, codigoBase, nome: `TOP ${codigoBase} ${seq}`, ...extra } });
  expect(r.statusCode, `premissa: a TOP ${codigoBase} é cadastrada — ${r.body}`).toBe(201);
  return (j(r) as { id: string }).id;
}

export type ControleLote = "nenhum" | "lote" | "lote_validade";
export interface Produto { id: string; nome: string }

/** Produto NOVO por SQL (admin), no modelo de um do seed. Nasce sem saldo. */
export async function produto(opcoes: { controla?: boolean; lote?: ControleLote; ativo?: boolean } = {}): Promise<Produto> {
  const m = (await c.admin.query<Record<string, string>>("select measurement_id, group_id, category_id, kind_id, financial_category_id from erp.products where id=$1", [c.I.product2])).rows[0]!;
  const s = unico();
  const lote = opcoes.lote ?? "nenhum";
  const r = await c.admin.query<{ id: string; description: string }>(
    `insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, kind_id, financial_category_id, control_stock, controle_lote, has_lot, is_active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, description`,
    [c.h.demo.orgId, `ES${s}`, `Produto ES ${s}`, m.measurement_id, m.group_id, m.category_id, m.kind_id, m.financial_category_id, opcoes.controla ?? true, lote, lote !== "nenhum", opcoes.ativo ?? true]);
  return { id: r.rows[0]!.id, nome: r.rows[0]!.description };
}

/** Armazém NOVO por SQL (admin), da empresa pedida (padrão: a 1ª). */
export async function armazem(opcoes: { empresa?: string; ativo?: boolean } = {}): Promise<string> {
  const s = unico();
  return (await c.admin.query<{ id: string }>(
    "insert into erp.warehouses (organization_id, empresa_id, initials, description, is_active) values ($1,$2,$3,$4,$5) returning id",
    [c.h.demo.orgId, opcoes.empresa ?? c.I.empresa, `E${s}`.slice(0, 20), `Armazém ES ${s}`, opcoes.ativo ?? true])).rows[0]!.id;
}

/** Estoque inicial pela API (`/api/stock/opening-balances`): o saldo de partida de cada caso. */
export async function saldoInicial(produtoId: string, quantidade: string, opcoes: { armazem?: string; custo?: string; lote?: string; validade?: string } = {}) {
  const r = await c.h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: c.h.headers(),
    payload: { empresa_id: c.I.empresa, warehouse_id: opcoes.armazem ?? c.I.warehouse, product_id: produtoId, quantity: quantidade, unit_value: opcoes.custo ?? "10",
      ...(opcoes.lote ? { provider_lot: opcoes.lote } : {}), ...(opcoes.validade ? { expiration_date: opcoes.validade } : {}) } });
  expect(r.statusCode, `premissa: o estoque inicial entra — ${r.body}`).toBe(201);
}

// ─────────────── a porta do documento ───────────────

export const seg = (e: EspecieEstoque) => SEGMENTO_DA_ESPECIE_ESTOQUE[e];
export type Item = Record<string, unknown> & { produto_id: string };

/** O corpo padrão: 1ª empresa, ALM (e SILO como destino na transferência), a TOP da espécie e a data aberta. */
export function corpo(especie: EspecieEstoque, itens: Item[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { empresa_id: c.I.empresa, tipo_operacao_id: c.tops[especie], armazem_id: c.I.warehouse,
    ...(especie === "transferencia" ? { armazem_destino_id: c.I.warehouse2 } : {}), data_documento: DATA, itens, ...extra };
}
export function lancar(especie: EspecieEstoque, itens: Item[], extra: Record<string, unknown> = {}, headers: Hdr = c.h.headers()): Promise<Resposta> {
  return c.h.app.inject({ method: "POST", url: `/api/estoque/${seg(especie)}`, headers, payload: corpo(especie, itens, extra) });
}
export async function lancado(especie: EspecieEstoque, itens: Item[], extra: Record<string, unknown> = {}, headers?: Hdr): Promise<string> {
  const r = await lancar(especie, itens, extra, headers);
  expect(r.statusCode, `premissa: o documento é lançado — ${r.body}`).toBe(201);
  return (j(r) as { id: string }).id;
}
export const ler = (especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "GET", url: `/api/estoque/${seg(especie)}/${id}`, headers });
export const previa = (especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "GET", url: `/api/estoque/${seg(especie)}/${id}/previa-confirmacao`, headers });
export function confirmar(especie: EspecieEstoque, id: string, opcoes: { chave?: string; headers?: Hdr } = {}): Promise<Resposta> {
  return c.h.app.inject({ method: "POST", url: `/api/estoque/${seg(especie)}/${id}/confirmar`,
    headers: { ...(opcoes.headers ?? c.h.headers()), ...(opcoes.chave ? { "idempotency-key": opcoes.chave } : {}) }, payload: {} });
}
export async function confirmado(especie: EspecieEstoque, id: string) {
  const r = await confirmar(especie, id);
  expect(r.statusCode, `premissa: o documento é confirmado — ${r.body}`).toBe(200);
  return j(r) as { id: string; situacao: string; movimentos: number };
}
export function cancelar(especie: EspecieEstoque, id: string, payload: Record<string, unknown> = {}, opcoes: { chave?: string; headers?: Hdr } = {}): Promise<Resposta> {
  return c.h.app.inject({ method: "POST", url: `/api/estoque/${seg(especie)}/${id}/cancelar`,
    headers: { ...(opcoes.headers ?? c.h.headers()), ...(opcoes.chave ? { "idempotency-key": opcoes.chave } : {}) }, payload });
}

/** Os caminhos apontados por um 422 (`details: [{ path }]`). */
export function caminhos(r: Resposta): string[] {
  const d = j(r).error?.details;
  return Array.isArray(d) ? (d as Detalhe[]).map((x) => x.path) : [];
}
/** Recusa no campo: status, código e o caminho em `details`. */
export function recusadoNoCampo(r: Resposta, caminho: string, status = 422) {
  expect(r.statusCode, r.body).toBe(status);
  expect(caminhos(r), `o ${status} aponta ${caminho}: ${r.body}`).toContain(caminho);
}

// ─────────────── testemunhas no banco (superusuário, sem RLS) ───────────────

export interface DocNoBanco { situacao: string; codigo: string; especie: string; tipo_operacao_id: string; tipo_operacao_versao_id: string; confirmado_por: string | null; cancelado_por: string | null; motivo_cancelamento: string | null }
export async function doc(id: string): Promise<DocNoBanco> {
  return (await c.admin.query<DocNoBanco>(
    "select situacao, codigo, especie, tipo_operacao_id, tipo_operacao_versao_id, confirmado_por, cancelado_por, motivo_cancelamento from erp.documentos_estoque where id=$1", [id])).rows[0]!;
}
export interface ItemNoBanco { posicao: number; produto_id: string; lote: string | null; validade: string | null; quantidade: string | null; quantidade_contada: string | null; custo_unitario: string | null; saldo_na_confirmacao: string | null; diferenca: string | null }
export async function itens(id: string): Promise<ItemNoBanco[]> {
  return (await c.admin.query<ItemNoBanco>(
    `select posicao, produto_id, lote, to_char(validade,'YYYY-MM-DD') as validade, quantidade::text, quantidade_contada::text, custo_unitario::text,
            saldo_na_confirmacao::text, diferenca::text
       from erp.documentos_estoque_itens where documento_id=$1 order by posicao`, [id])).rows;
}
export interface MovNoBanco { movement_type: string; direction: number; quantity: string; unit_cost: string; product_id: string; warehouse_id: string; provider_lot: string | null; expiration_date: string | null; movement_date: string; note: string | null }
/**
 * Os movimentos do documento no ledger (estornos inclusive). `created_at` é o início da TRANSAÇÃO — todos os
 * movimentos de uma confirmação empatam nele —, então dentro da mesma transação a ordem é FIXADA aqui (saída antes
 * de entrada, lote, armazém), e nunca a de inserção, que o banco não garante.
 */
export async function movimentos(id: string): Promise<MovNoBanco[]> {
  return (await c.admin.query<MovNoBanco>(
    `select movement_type, direction, quantity::text, unit_cost::text, product_id, warehouse_id, provider_lot,
            to_char(expiration_date,'YYYY-MM-DD') as expiration_date, to_char(movement_date,'YYYY-MM-DD') as movement_date, note
       from erp.stock_movements where source_type='documentos_estoque' and source_id=$1
      order by created_at, direction, provider_lot nulls first, warehouse_id, id`, [id])).rows;
}
/** Todos os movimentos do produto (qualquer origem): prova de que uma recusa não gravou nada. */
export async function movimentosDoProduto(produtoId: string): Promise<number> {
  return Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.stock_movements where product_id=$1", [produtoId])).rows[0]!.n);
}
/**
 * O saldo no banco. `lote` ausente: todos os lotes do produto no armazém; `""`: o balde SEM lote; texto: aquele lote.
 * Sempre com 4 casas, como a coluna.
 */
export async function saldo(armazemId: string, produtoId: string, lote?: string): Promise<string> {
  return (await c.admin.query<{ q: string }>(
    "select coalesce(sum(quantity),0)::numeric(18,4)::text q from erp.stock_balances where warehouse_id=$1 and product_id=$2 and ($3::text is null or provider_lot=$3)",
    [armazemId, produtoId, lote ?? null])).rows[0]!.q;
}
export async function custoMedio(armazemId: string, produtoId: string, lote = ""): Promise<string> {
  return (await c.admin.query<{ c: string }>(
    "select average_cost::text c from erp.stock_balances where warehouse_id=$1 and product_id=$2 and provider_lot=$3", [armazemId, produtoId, lote])).rows[0]!.c;
}
export async function contarDocumentos(): Promise<number> {
  return Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.documentos_estoque where organization_id=$1", [c.h.demo.orgId])).rows[0]!.n);
}

// ─────────────── pessoas ───────────────

export type Escopo = { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] };
/** Todos os módulos com todas as empresas — e, se pedido, o módulo estoque só com as empresas dadas. */
export function escopos(estoque?: string[]): Escopo[] {
  return CHAVES_MODULO_EMPRESA.map((modulo) => modulo === "estoque" && estoque
    ? { modulo, modo: "selecionadas" as const, empresas: [...estoque] }
    : { modulo, modo: "todas" as const, empresas: [] });
}
/** Um membro novo com o papel de exatamente estas permissões. Devolve os cabeçalhos dele. */
export async function membro(nome: string, perms: string[], escopo: Escopo[] = escopos()): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico()}@es01.local`;
  const papel = await c.h.app.inject({ method: "POST", url: "/api/admin/roles", headers: c.h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await c.h.app.inject({ method: "POST", url: "/api/admin/members", headers: c.h.headers(),
    payload: { name: nome, email, password: "Restrito@12345", role_id: j(papel).id, escopos_empresas: escopo } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await c.h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": c.h.demo.orgId };
}

// ─────────────── concorrência ───────────────

/**
 * DUAS REQUISIÇÕES EM PARALELO DE VERDADE, que leem o saldo ANTES de qualquer uma gravar.
 *
 * Uma conexão própria (superusuário) segura uma trava (`sqlTrava`) que as duas confirmações só pedem DEPOIS de ler
 * o saldo — a linha do saldo (`for update`), que o gatilho do movimento trava ao gravar, ou a linha do produto, que
 * ele atualiza. As duas são disparadas juntas; a barreira só é solta quando HÁ DUAS transações esperando trava no
 * banco (`pg_stat_activity`): então as duas já passaram da leitura (sem a trava do ajuste) ou uma espera a trava do
 * ajuste e a outra a barreira (com ela). É o que torna o caso determinístico: sem a barreira, "simultâneo" seria
 * uma questão de sorte do escalonador, e um verde por sorte não prova nada.
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
    // Se algo falhou antes de soltar, a barreira não pode ficar segurando as confirmações (nem voltar ao pool aberta).
    await barreira.query("rollback").catch(() => undefined);
    barreira.release();
  }
}
