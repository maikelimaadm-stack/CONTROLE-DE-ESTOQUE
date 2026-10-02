import { expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import {
  CHAVES_MODULO_EMPRESA, configuracaoNeutraTopV4, configuracaoNeutraTopV5,
  type ConfiguracaoTipoOperacaoV5, type SecaoFinanceiroPadrao
} from "@agro/domain";
import { appCom, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * OPERACOES-01 F9a (decisão 286) — O CENÁRIO DOS TESTES DE INTEGRAÇÃO DO FINANCEIRO PELA TOP E DO LCDPR (P4 e P5).
 *
 * Cada arquivo `f9a-*.test.ts` sobe o PRÓPRIO harness (banco recriado) e usa este cenário; o estado é do módulo (o
 * vitest isola os módulos por arquivo), preenchido por `iniciarF9a()` no `beforeAll`.
 *
 * DUAS INSTÂNCIAS no mesmo banco: a do harness (`f9.h.app`, gate da execução configurada DESLIGADO) e a `ligada`
 * (`TOP_EFFECTS_RUNTIME_V1_ENABLED=1`, a de produção desde 26/09/2026), pela qual as TOPs nos formatos 4 e 5 nascem —
 * a porta administrativa exige o gate para eles. O financeiro não depende do gate.
 *
 * TESTEMUNHA: `f9.admin`, conexão própria de SUPERUSUÁRIO (sem RLS). Toda asserção decisiva lê o banco por ela (a
 * situação do título, a TOP gravada, o imóvel da baixa e dos movimentos, a trilha); "nada gravado" é sempre a
 * contagem antes e depois, nunca só o status HTTP.
 *
 * FIXTURES DECLARADAS (o caminho de verdade é provado em outro pacote, e o atalho aqui é dito com o motivo):
 *   · os PADRÕES FINANCEIROS da TOP (`criarTopNo5(…, { padroes })`) são INSERIDOS pelo superusuário em
 *     `erp.tipos_operacao_versao_financeiro`: a gravação pela API da TOP é do P3 (`f9a-top-financeiro-padrao`); a
 *     linha é a mesma que aquela porta grava (a versão corrente, a TOP, a organização);
 *   · o TÍTULO PREVISTO (`previstoDireto`) é INSERIDO pelo superusuário com a origem de um pedido de venda REAL (criado
 *     pela API): o caminho de verdade (a provisão ao salvar o pedido) é provado no P5 (`f9a-provisao-venda`). A linha
 *     satisfaz os CHECKs da 0045 (pago zero, origem de documento) e tem rateio, como a provisão grava.
 */
export type Hdr = Record<string, string>;
export type Resposta = { statusCode: number; body: string; json: () => unknown };
export type Erro = { code: string; message: string; details?: { path: unknown; message: string }[] };
export const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
/** O corpo de erro (`{ code, message, details }`) de uma resposta que DEVE ser erro. */
export function erro(r: Resposta): Erro {
  const e = j(r).error;
  expect(e, `a resposta é um erro: ${r.body}`).toBeDefined();
  return e!;
}

/** A data dos lançamentos (mês aberto). */
export const DATA = "2026-09-10";

type Ids = Awaited<ReturnType<typeof ids>>;
export type IdsConferidos = { [K in keyof Ids]-?: string };

export interface CenarioF9a {
  h: Harness;
  /** A instância com o gate da execução configurada LIGADO: as TOPs nos formatos 4 e 5 e os documentos com TOP. */
  ligada: FastifyInstance;
  I: IdsConferidos;
  /** Superusuário, sem RLS: a testemunha. */
  admin: Db;
}
export const f9 = {} as CenarioF9a;

let seq = 0;
export const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}${Math.random().toString(36).slice(2, 5)}`;

export async function iniciarF9a(): Promise<void> {
  f9.h = await harness();
  f9.ligada = await appCom(f9.h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  const lidos = await ids(f9.h);
  for (const [chave, valor] of Object.entries(lidos)) expect(valor, `premissa: o seed tem ${chave}`).toEqual(expect.any(String));
  f9.I = lidos as IdsConferidos;
  f9.admin = createPool(TEST_URL, { max: 4 });
}
export async function encerrarF9a(): Promise<void> {
  await f9.ligada?.close(); await f9.h?.app.close(); await f9.h?.db.end(); await f9.admin?.end();
}

/** Uma linha (a primeira) de uma consulta da testemunha. */
export async function linha<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await f9.admin.query<T>(sql, params);
  expect(r.rows.length, `premissa: a consulta devolve uma linha — ${sql}`).toBeGreaterThan(0);
  return r.rows[0]!;
}
/** Todas as linhas de uma consulta da testemunha. */
export async function linhas<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await f9.admin.query<T>(sql, params)).rows;
}

// ─────────────── a TOP ───────────────

/** Os padrões financeiros de uma versão (a tabela da 0045). */
export type PadroesDaTop = Partial<{ naturezaId: string; centroCustoId: string; tipoTituloId: string; formaPagamentoId: string; contaBancariaId: string }>;
export interface TopCriada { id: string; versaoId: string; codigo: string; nome: string }

/** O formato 5 neutro (o do domínio) com a seção `financeiroPadrao` ajustada. Cada chamada devolve um objeto novo. */
export function cfg5(secao: Partial<SecaoFinanceiroPadrao> = {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  x.financeiroPadrao = { ...x.financeiroPadrao, ...secao };
  return x;
}

/** O POST da TOP pela porta administrativa (a `ligada`), cru. */
export function postarTop(codigoBase: string, extra: Record<string, unknown> = {}): Promise<Resposta> {
  const n = unico();
  return f9.ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: f9.h.headers(),
    payload: { codigo: `9${n}`.slice(0, 20), codigoBase, nome: `TOP ${codigoBase} ${n}`, ...extra } });
}

/** A versão CORRENTE da TOP como o banco a guarda. */
export async function versaoCorrente(topId: string): Promise<{ id: string; versao: number; nome: string; codigo: string }> {
  return linha<{ id: string; versao: number; nome: string; codigo: string }>(
    `select v.id::text as id, v.versao, v.nome, t.codigo from erp.tipos_operacao_versoes v
       join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao where t.id = $1`, [topId]);
}

/** Os padrões da versão, INSERIDOS pelo superusuário (fixture: a gravação pela API da TOP é provada no P3). */
export async function padroesNaVersao(topId: string, versaoId: string, p: PadroesDaTop): Promise<void> {
  const r = await f9.admin.query(
    `insert into erp.tipos_operacao_versao_financeiro (organization_id, origem_versao_id, origem_tipo_operacao_id, natureza_id, centro_custo_id, tipo_titulo_id, forma_pagamento_id, conta_bancaria_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [f9.h.demo.orgId, versaoId, topId, p.naturezaId ?? null, p.centroCustoId ?? null, p.tipoTituloId ?? null, p.formaPagamentoId ?? null, p.contaBancariaId ?? null]);
  expect(r.rowCount, "premissa: os padrões da versão foram gravados").toBe(1);
}

/** Uma TOP da família no FORMATO 5 (pela API), com a seção `financeiroPadrao` e, se pedidos, os padrões da versão. */
export async function criarTopNo5(familia: string, o: { secao?: Partial<SecaoFinanceiroPadrao>; padroes?: PadroesDaTop; padrao?: boolean } = {}): Promise<TopCriada> {
  const r = await postarTop(familia, { configuracao: cfg5(o.secao), ...(o.padrao ? { padrao: true } : {}) });
  expect(r.statusCode, `premissa: a TOP ${familia} nasce no formato 5 — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  const v = await versaoCorrente(id);
  const formato = await linha<{ f: number }>("select configuracao_schema_version as f from erp.tipos_operacao_versoes where id=$1", [v.id]);
  expect(formato.f, "premissa: a versão está no formato 5").toBe(5);
  if (o.padroes) await padroesNaVersao(id, v.id, o.padroes);
  return { id, versaoId: v.id, codigo: v.codigo, nome: v.nome };
}

/** Uma TOP da família no FORMATO 4 neutro (pela API) — a seção do 5 não existe nela. */
export async function criarTopNo4(familia: string): Promise<TopCriada> {
  const r = await postarTop(familia, { configuracao: configuracaoNeutraTopV4() });
  expect(r.statusCode, `premissa: a TOP ${familia} nasce no formato 4 — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  const v = await versaoCorrente(id);
  return { id, versaoId: v.id, codigo: v.codigo, nome: v.nome };
}

// ─────────────── pessoas e escopo ───────────────

export type Escopo = { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] };
/** Todos os módulos com todas as empresas — ou, para os módulos dados, só as empresas dadas. */
export function escopos(selecionados: Partial<Record<string, string[]>> = {}): Escopo[] {
  return CHAVES_MODULO_EMPRESA.map((modulo) => {
    const empresas = selecionados[modulo];
    return empresas ? { modulo, modo: "selecionadas" as const, empresas: [...empresas] } : { modulo, modo: "todas" as const, empresas: [] };
  });
}
/** Um membro NOVO com EXATAMENTE estas permissões (pela API administrativa). Devolve os cabeçalhos dele. */
export async function usuario(nome: string, perms: string[], escopo: Escopo[] = escopos()): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico()}@f9a.local`;
  const papel = await f9.h.app.inject({ method: "POST", url: "/api/admin/roles", headers: f9.h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, `premissa: o papel nasce — ${papel.body}`).toBe(201);
  const v = await f9.h.app.inject({ method: "POST", url: "/api/admin/members", headers: f9.h.headers(),
    payload: { name: nome, email, password: "Restrito@12345", role_id: j(papel).id, escopos_empresas: escopo } });
  expect(v.statusCode, `premissa: o membro nasce — ${v.body}`).toBe(201);
  const login = await f9.h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": f9.h.demo.orgId };
}

// ─────────────── LCDPR ───────────────

/** Um imóvel rural pelo CADASTRO GENÉRICO (`POST /api/resources/imoveis_rurais`), o caminho real. */
export async function imovel(empresa: string, o: { padrao?: boolean; nome?: string; cib?: string | null } = {}): Promise<string> {
  const n = unico();
  const r = await f9.h.app.inject({ method: "POST", url: "/api/resources/imoveis_rurais", headers: f9.h.headers(),
    payload: { empresa_id: empresa, nome: o.nome ?? `Imóvel ${n}`, ...(o.cib ? { cib: o.cib } : {}), tipo_exploracao: "individual", participacao: "100", padrao: o.padrao ?? false } });
  expect(r.statusCode, `premissa: o imóvel rural é cadastrado — ${r.body}`).toBe(201);
  return j(r).id as string;
}

// ─────────────── títulos e baixas ───────────────

/** Um pedido de venda REAL (pela API, sem TOP ou com a TOP dada), para ser a origem de um previsto. */
export async function pedidoDeVenda(o: { tipoOperacaoId?: string; valor?: string } = {}): Promise<{ id: string; code: string }> {
  const r = await f9.ligada.inject({ method: "POST", url: "/api/sales/orders", headers: f9.h.headers(),
    payload: { empresa_id: f9.I.empresa, document_date: DATA, client_id: f9.I.client, ...(o.tipoOperacaoId ? { tipo_operacao_id: o.tipoOperacaoId } : {}),
      items: [{ product_id: f9.I.product2, warehouse_id: f9.I.warehouse, quantity: "1", unit_price: o.valor ?? "300.00" }] } });
  expect(r.statusCode, `premissa: o pedido de venda nasce — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  const d = await linha<{ code: string; kind: string }>("select code, kind from erp.sales_documents where id=$1", [id]);
  expect(d.kind, "premissa: é um pedido").toBe("order");
  return { id, code: d.code };
}

/**
 * Um título PREVISTO inserido pelo superusuário (fixture: o caminho de verdade é a provisão do P5), com rateio, na
 * origem dada (um documento real). Valor líquido = `valor`; nada pago.
 */
export async function previstoDireto(o: {
  origemId: string; origemTipo?: string; direcao?: "payable" | "receivable"; valor?: string; vencimento?: string; emissao?: string;
  numero?: string; empresa?: string; pessoa?: string; natureza?: string; centro?: string; conta?: string | null;
  top?: { id: string; versaoId: string } | null; formaPagamento?: string;
}): Promise<string> {
  const direcao = o.direcao ?? "receivable";
  const valor = o.valor ?? "300.00";
  const code = `PRV${unico()}`;
  const t = await f9.admin.query<{ id: string }>(
    `insert into erp.financial_titles (organization_id, empresa_id, code, direction, number, person_id, payment_type, amount, emission_date, due_date, note,
                                       source_type, source_id, status, conta_prevista_id, tipo_operacao_id, tipo_operacao_versao_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'previsto',$14,$15,$16) returning id`,
    [f9.h.demo.orgId, o.empresa ?? f9.I.empresa, code, direcao, o.numero ?? code, o.pessoa ?? (direcao === "receivable" ? f9.I.client : f9.I.provider), o.formaPagamento ?? "single", valor,
      o.emissao ?? DATA, o.vencimento ?? DATA, `Previsto ${code}`, o.origemTipo ?? "sales_documents", o.origemId, o.conta ?? null, o.top?.id ?? null, o.top?.versaoId ?? null]);
  const id = t.rows[0]!.id;
  await f9.admin.query("insert into erp.title_apportionments (title_id, financial_category_id, cost_center_id, percentage, amount) values ($1,$2,$3,100,$4)",
    [id, o.natureza ?? (direcao === "receivable" ? f9.I.incomeCategory : f9.I.category), o.centro ?? f9.I.costCenter, valor]);
  const s = await linha<{ status: string; paid_amount: string }>("select status, paid_amount::text as paid_amount from erp.financial_titles where id=$1", [id]);
  expect(s, "premissa: o título é previsto e nada foi pago").toEqual({ status: "previsto", paid_amount: "0.00" });
  return id;
}

/** Os títulos de uma origem (`source_type`, `source_id`), pela testemunha. */
export async function titulosDaOrigem(tipo: string, id: string) {
  return linhas<{ id: string; status: string; amount: string; due_date: string; tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null; title_type_id: string | null; conta_prevista_id: string | null; cancel_reason: string | null; cancelled_by: string | null }>(
    `select id::text as id, status, amount::text as amount, due_date::text as due_date, tipo_operacao_id::text as tipo_operacao_id, tipo_operacao_versao_id::text as tipo_operacao_versao_id,
            title_type_id::text as title_type_id, conta_prevista_id::text as conta_prevista_id, cancel_reason, cancelled_by::text as cancelled_by
       from erp.financial_titles where source_type=$1 and source_id=$2 order by due_date, installment_number, created_at`, [tipo, id]);
}

/**
 * Os movimentos de uma baixa: o PRINCIPAL (`bank_movement_id` da baixa) e os COMPONENTES (`title_settlement_id`),
 * com o imóvel e a TOP de cada um.
 */
export async function movimentosDaBaixa(baixaId: string) {
  return linhas<{ id: string; papel: "principal" | "componente"; componente: string | null; amount: string; imovel_rural_id: string | null; tipo_operacao_id: string | null; category_type: string }>(
    `select m.id::text as id, case when m.id = s.bank_movement_id then 'principal' else 'componente' end as papel, m.componente_baixa as componente,
            m.amount::text as amount, m.imovel_rural_id::text as imovel_rural_id, m.tipo_operacao_id::text as tipo_operacao_id, m.category_type
       from erp.title_settlements s join erp.bank_movements m on m.id = s.bank_movement_id or m.title_settlement_id = s.id
      where s.id = $1 order by (m.id = s.bank_movement_id) desc, m.componente_baixa nulls first, m.code`, [baixaId]);
}

/** A contagem de linhas de uma tabela da organização (para "nada gravado"). Tabela é literal do teste. */
export async function contar(tabela: "financial_titles" | "title_settlements" | "bank_movements" | "imoveis_rurais"): Promise<number> {
  return Number((await linha<{ n: string }>(`select count(*)::text as n from erp.${tabela} where organization_id=$1`, [f9.h.demo.orgId])).n);
}
