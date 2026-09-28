import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { configuracaoNeutraTopV2, configuracaoNeutraTopV3 } from "@agro/domain";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-05 — A API DA TOP NO FORMATO 3 (contrato §3).
 *
 * TR-A1: capacidades, formato 3, "formato não retrocede", CFOP por família.
 * TR-A2: condições permitidas (mesmo molde de `destinos`): presença = declaração, ausência = preservar/copiar,
 * mesmo conjunto = no-op, recusa ÚNICA para inexistente/outra organização/inativa/excluída, repetida, teto 50.
 * O estado é lido direto da tabela (conexão de observação), nunca só pelo que a rota conta.
 */
let h: Harness;
let admin: Db;
let org: string;
let outraOrg: string;
const C: Record<"a" | "b" | "c" | "inativa" | "excluida" | "outra", string> = { a: "", b: "", c: "", inativa: "", excluida: "", outra: "" };

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 2 });
  org = h.demo.orgId;
  outraOrg = (await admin.query<{ id: string }>(
    "insert into erp.organizations(name,slug) values ('TR-A outra','tr-a-outra-top05') returning id")).rows[0]!.id;
  const nova = async (o: string, code: string, nome: string, extra = "") =>
    (await admin.query<{ id: string }>(
      `insert into erp.condicoes_pagamento (organization_id, code, nome${extra ? ", is_active, deleted_at" : ""})
       values ($1,$2,$3${extra}) returning id`, [o, code, nome])).rows[0]!.id;
  C.a = await nova(org, "TRA-A", "TR-A à vista");
  C.b = await nova(org, "TRA-B", "TR-A 30 dias");
  C.c = await nova(org, "TRA-C", "TR-A 60 dias");
  C.inativa = await nova(org, "TRA-I", "TR-A inativa", ", false, null");
  C.excluida = await nova(org, "TRA-X", "TR-A excluída", ", true, now()");
  C.outra = await nova(outraOrg, "TRA-O", "TR-A outra org");
});
afterAll(async () => { await h.app.close(); await h.db.end(); await admin.end(); });

const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown>;
const erro = (r: { json: () => unknown }) => (r.json() as { error: { code: string; details: unknown } }).error;
let seq = 0;
const codigo = () => `25${String(++seq).padStart(2, "0")}`;

const criar = (codigoBase: string, extra: Record<string, unknown> = {}) =>
  h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: codigo(), codigoBase, nome: `TR-A ${seq}`, ...extra } });
async function criarOk(codigoBase: string, extra: Record<string, unknown> = {}) {
  const r = await criar(codigoBase, extra);
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}
const detalhe = (id: string) => h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers() });
const editar = (id: string, corpo: Record<string, unknown>) =>
  h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers(), payload: corpo });
const versoes = (id: string) => h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}/versoes`, headers: h.headers() });
const revisao = async (id: string) => j(await detalhe(id)).revisao as number;

/** A versão corrente e as condições gravadas para ela — lidas da TABELA. */
async function noBanco(id: string) {
  const v = await admin.query<{ id: string; versao: number; configuracao_schema_version: number }>(
    `select v.id, v.versao, v.configuracao_schema_version from erp.tipos_operacao_versoes v
       join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao where t.id = $1`, [id]);
  expect(v.rows).toHaveLength(1);
  const c = await admin.query<{ condicao_pagamento_id: string }>(
    "select condicao_pagamento_id from erp.tipos_operacao_versao_condicoes where origem_versao_id = $1", [v.rows[0]!.id]);
  return { ...v.rows[0]!, condicoes: c.rows.map((x) => x.condicao_pagamento_id).sort() };
}
const ordenado = (xs: string[]) => [...xs].sort();

describe("TR-A1 — capacidades e formato 3", () => {
  it("TR-A1 capabilities: bloco restricoes {suportado:true, versaoSchema:3}; contractVersion e configuracao.versaoSchema intactos", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: h.headers() });
    expect(r.statusCode).toBe(200);
    const b = j(r);
    expect(b.restricoes).toEqual({ suportado: true, versaoSchema: 3 });
    expect(b.contractVersion).toBe(1);
    expect((b.configuracao as { versaoSchema: number }).versaoSchema).toBe(1);
  });

  it("TR-A1 POST formato 3 grava formato 3 e o detalhe devolve a configuração v3", async () => {
    const id = await criarOk("vendas.venda", { configuracao: configuracaoNeutraTopV3() });
    const d = j(await detalhe(id));
    expect((d.configuracao as { suportada: boolean; versaoSchema: number }).suportada).toBe(true);
    expect((d.configuracao as { versaoSchema: number }).versaoSchema).toBe(3);
    expect((await noBanco(id)).configuracao_schema_version).toBe(3);
    expect(d.condicoesPermitidas).toEqual([]);
  });

  it("TR-A1 v2 sobre v3 → 422 SCHEMA_NAO_SUPORTADO {versaoEnviada:2, versaoVigente:3}, nada gravado", async () => {
    const id = await criarOk("vendas.venda", { configuracao: configuracaoNeutraTopV3() });
    const antes = await noBanco(id);
    const r = await editar(id, { revisao: await revisao(id), configuracao: configuracaoNeutraTopV2() });
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r).code).toBe("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO");
    expect((erro(r).details as Record<string, unknown>)).toEqual({ versaoEnviada: 2, versaoVigente: 3 });
    expect(await noBanco(id)).toEqual(antes);
  });

  it("TR-A1 CFOP 1102 (entrada) numa TOP de vendas → 422 CONFIGURACAO_INVALIDA em fiscal.cfopDentroEstado", async () => {
    const cfg = configuracaoNeutraTopV3();
    const r = await criar("vendas.venda", { configuracao: { ...cfg, fiscal: { ...cfg.fiscal, habilitado: true, cfopDentroEstado: "1102" } } });
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r).code).toBe("TIPO_OPERACAO_CONFIGURACAO_INVALIDA");
    const recusas = (erro(r).details as { recusas: { caminho: string }[] }).recusas;
    expect(recusas.map((x) => x.caminho)).toContain("fiscal.cfopDentroEstado");
    // E pelo PUT, sobre uma TOP v3 existente.
    const id = await criarOk("vendas.venda", { configuracao: cfg });
    const p = await editar(id, { revisao: await revisao(id), configuracao: { ...cfg, fiscal: { ...cfg.fiscal, habilitado: true, cfopDentroEstado: "1102" } } });
    expect(p.statusCode, p.body).toBe(422);
    expect((erro(p).details as { recusas: { caminho: string }[] }).recusas.map((x) => x.caminho)).toContain("fiscal.cfopDentroEstado");
  });

  it("TR-A1 TOP v2 existente continua v2 e sem linhas de condição depois de editar só o nome", async () => {
    const id = await criarOk("vendas.venda", { configuracao: configuracaoNeutraTopV2() });
    const r = await editar(id, { revisao: await revisao(id), nome: "TR-A renomeada" });
    expect(r.statusCode, r.body).toBe(200);
    const b = await noBanco(id);
    expect(b.versao).toBe(2);
    expect(b.configuracao_schema_version).toBe(2);
    expect(b.condicoes).toEqual([]);
    expect(j(await detalhe(id)).condicoesPermitidas).toEqual([]);
  });
});

describe("TR-A2 — condições permitidas", () => {
  it("TR-A2 POST v3 com condições grava as linhas; detalhe e histórico trazem {id,codigo,nome}", async () => {
    const id = await criarOk("vendas.venda", { configuracao: configuracaoNeutraTopV3(), condicoesPermitidas: [C.b, C.a] });
    expect((await noBanco(id)).condicoes).toEqual(ordenado([C.a, C.b]));
    const d = j(await detalhe(id));
    expect(d.condicoesPermitidas).toEqual([
      { id: C.a, codigo: "TRA-A", nome: "TR-A à vista" },
      { id: C.b, codigo: "TRA-B", nome: "TR-A 30 dias" }
    ]);
    const hist = (j(await versoes(id)).items as { versao: number; condicoesPermitidas: { id: string; codigo: string; nome: string }[] }[]);
    expect(hist[0]!.condicoesPermitidas.map((x) => x.codigo)).toEqual(["TRA-A", "TRA-B"]);
  });

  it("TR-A2 PUT com condições AUSENTES preserva e COPIA para a versão nova; histórico mantém a de cada versão", async () => {
    const id = await criarOk("vendas.venda", { configuracao: configuracaoNeutraTopV3(), condicoesPermitidas: [C.a] });
    const v1 = await noBanco(id);
    const r = await editar(id, { revisao: await revisao(id), nome: "TR-A nome novo" });
    expect(r.statusCode, r.body).toBe(200);
    const v2 = await noBanco(id);
    expect(v2.versao).toBe(2);
    expect(v2.id).not.toBe(v1.id);
    expect(v2.condicoes).toEqual([C.a]);
    // Mudança do conjunto = versão nova; o histórico mostra o conjunto de CADA versão.
    const m = await editar(id, { revisao: await revisao(id), condicoesPermitidas: [C.a, C.c] });
    expect(m.statusCode, m.body).toBe(200);
    expect((await noBanco(id)).versao).toBe(3);
    const hist = (j(await versoes(id)).items as { versao: number; condicoesPermitidas: { id: string }[] }[]);
    expect(hist.map((x) => [x.versao, x.condicoesPermitidas.map((c) => c.id).sort()])).toEqual([
      [3, ordenado([C.a, C.c])], [2, [C.a]], [1, [C.a]]
    ]);
  });

  it("TR-A2 PUT com lista PRESENTE vazia limpa (versão nova sem linhas)", async () => {
    const id = await criarOk("vendas.venda", { configuracao: configuracaoNeutraTopV3(), condicoesPermitidas: [C.a, C.b] });
    const r = await editar(id, { revisao: await revisao(id), condicoesPermitidas: [] });
    expect(r.statusCode, r.body).toBe(200);
    const b = await noBanco(id);
    expect(b.versao).toBe(2);
    expect(b.condicoes).toEqual([]);
    expect(j(await detalhe(id)).condicoesPermitidas).toEqual([]);
  });

  it("TR-A2 mesmo conjunto (outra ordem) é no-op: nem versão nem revisão mudam", async () => {
    const id = await criarOk("vendas.venda", { configuracao: configuracaoNeutraTopV3(), condicoesPermitidas: [C.a, C.b] });
    const rev = await revisao(id);
    const r = await editar(id, { revisao: rev, condicoesPermitidas: [C.b, C.a] });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ versao: 1, revisao: rev });
    expect((await noBanco(id)).versao).toBe(1);
    expect(await revisao(id)).toBe(rev);
  });

  it("TR-A2 inexistente, outra organização, inativa e excluída → MESMA recusa em condicoesPermitidas.<i>; repetida tem a dela", async () => {
    const inexistente = "00000000-0000-4000-8000-000000000abc";
    const r = await criar("vendas.venda", { configuracao: configuracaoNeutraTopV3(),
      condicoesPermitidas: [C.a, inexistente, C.outra, C.inativa, C.excluida, C.a] });
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r).code).toBe("TIPO_OPERACAO_CONDICOES_INVALIDAS");
    const recusas = (erro(r).details as { recusas: { caminho: string; mensagem: string }[] }).recusas;
    const msg = "Condição de pagamento inexistente ou inativa.";
    expect(recusas).toEqual([
      { caminho: "condicoesPermitidas.1", mensagem: msg },
      { caminho: "condicoesPermitidas.2", mensagem: msg },
      { caminho: "condicoesPermitidas.3", mensagem: msg },
      { caminho: "condicoesPermitidas.4", mensagem: msg },
      { caminho: "condicoesPermitidas.5", mensagem: "Condição de pagamento repetida." }
    ]);
    // E pelo PUT: nada gravado (versão e linhas intactas).
    const id = await criarOk("vendas.venda", { configuracao: configuracaoNeutraTopV3(), condicoesPermitidas: [C.a] });
    const antes = await noBanco(id);
    const p = await editar(id, { revisao: await revisao(id), condicoesPermitidas: [C.outra] });
    expect(p.statusCode, p.body).toBe(422);
    expect((erro(p).details as { recusas: unknown[] }).recusas).toEqual([{ caminho: "condicoesPermitidas.0", mensagem: msg }]);
    expect(await noBanco(id)).toEqual(antes);
  });

  it("TR-A2 mais de 50 condições → 422, nada gravado", async () => {
    const muitas = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const r = await criar("vendas.venda", { configuracao: configuracaoNeutraTopV3(), condicoesPermitidas: muitas });
    expect(r.statusCode, r.body).toBe(422);
  });

  it("TR-A2 lista presente com configuração resultante v2 → 422 CONDICOES_INVALIDAS em condicoesPermitidas", async () => {
    const r = await criar("vendas.venda", { configuracao: configuracaoNeutraTopV2(), condicoesPermitidas: [C.a] });
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r).code).toBe("TIPO_OPERACAO_CONDICOES_INVALIDAS");
    expect((erro(r).details as { recusas: unknown[] }).recusas).toEqual([
      { caminho: "condicoesPermitidas", mensagem: "Condições permitidas exigem a configuração no formato 3." }
    ]);
    // PUT sobre TOP v2 sem mandar configuração: a resultante continua v2 → mesma recusa.
    const id = await criarOk("vendas.venda", { configuracao: configuracaoNeutraTopV2() });
    const p = await editar(id, { revisao: await revisao(id), condicoesPermitidas: [] });
    expect(p.statusCode, p.body).toBe(422);
    expect(erro(p).code).toBe("TIPO_OPERACAO_CONDICOES_INVALIDAS");
    expect((await noBanco(id)).versao).toBe(1);
  });

  it("TR-A2 auditoria da versão registra os ids das condições quando mudam", async () => {
    const id = await criarOk("vendas.venda", { configuracao: configuracaoNeutraTopV3(), condicoesPermitidas: [C.a] });
    await editar(id, { revisao: await revisao(id), condicoesPermitidas: [C.b] });
    const a = await admin.query<{ action: string; metadata: Record<string, unknown> }>(
      "select action, metadata from erp.audit_logs where entity_id = $1 order by created_at", [id]);
    const upd = a.rows.find((x) => x.action === "update");
    expect(upd?.metadata.condicoesPermitidas).toEqual([C.b]);
    expect(a.rows.find((x) => x.action === "create")?.metadata.condicoesPermitidas).toEqual([C.a]);
  });
});
