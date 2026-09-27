import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { LAYOUT_DO_SISTEMA, type EstruturaLayout } from "@agro/domain";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * VENDAS-A3-1b — valor padrão de CADASTRO no layout e exportar/importar (decisão 260).
 *  LB-A1  gravar: registro válido → 200; inválido (fora do filtro, inativo, outra organização, inexistente) → a MESMA 422
 *  LB-A2  layout-efetivo de vendas: padroesDeCadastro com rótulo (e empresaId no armazém); estrutura SEM o registro;
 *         registro inativado depois sai de padroesDeCadastro e entra em padroesInvalidos
 *  LB-A3  GET admin: estrutura COMPLETA + os dois mapas
 *  LB-A4  exportar → importar na MESMA organização (padrões mantidos, "(importado)") e em OUTRA (padrões removidos e listados)
 *  LB-A5  importar: chave desconhecida, família, versão, formato, estrutura inválida e tamanho → 422; exportar de outra org → a MESMA 404
 */
let h: Harness; let admin: Db;
/** Fixtures do seed desta suíte (premissa: todas presentes — `definido` falha alto se faltar). */
let fx: { incomeCategory: string; category: string; warehouse: string; warehouseEmpresa2: string; empresa: string };
const definido = (v: string | undefined, nome: string): string => { if (!v) throw new Error(`fixture ausente: ${nome}`); return v; };
type Resp = { statusCode: number; body: string; headers: Record<string, unknown> };
const j = (r: { body: string }) => JSON.parse(r.body);
const URL_ = "/api/admin/layouts-documento";
const FAM = "vendas.pedido";
const req = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, headers = h.headers()): Promise<Resp> =>
  h.app.inject({ method, url, headers: payload === undefined ? headers : { ...headers, "content-type": "application/json" }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) }) as unknown as Promise<Resp>;
let seq = 0;
const um = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0] as T;

async function criarLayout(nome: string, headers = h.headers()): Promise<{ id: string; nome: string }> {
  const n = `${nome} ${++seq}`;
  const r = await req("POST", URL_, { familia: FAM, nome: n }, headers);
  if (r.statusCode !== 201) throw new Error(r.body);
  return { id: j(r).id as string, nome: n };
}
async function criarTop(headers = h.headers()): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers, payload: { codigo: `B${Date.now().toString(36).slice(-4)}${++seq}`, codigoBase: FAM, nome: `TOP A3-1b ${seq}` } });
  if (r.statusCode !== 201) throw new Error(r.body);
  return j(r).id as string;
}

/** Caminho (…valorPadrao) de um campo do cabeçalho/rodapé ou de uma coluna dos itens na estrutura. */
function caminhoDe(est: EstruturaLayout, campo: string): string {
  const ci = est.cabecalho.findIndex((c) => c.campo === campo);
  if (ci >= 0) return `cabecalho[${ci}].valorPadrao`;
  for (const [ai, a] of est.rodape.entries()) {
    const i = a.campos.findIndex((c) => c.campo === campo);
    if (i >= 0) return `rodape[${ai}].campos[${i}].valorPadrao`;
  }
  const ii = est.itens.findIndex((c) => c.campo === campo);
  if (ii >= 0) return `itens[${ii}].valorPadrao`;
  throw new Error(`campo ${campo} fora da estrutura`);
}
/** Estrutura do sistema com padrão de cadastro em cada campo dado (e, opcionalmente, não editável). */
function comPadroes(padroes: Record<string, string>, naoEditaveis: string[] = []): EstruturaLayout {
  const est = LAYOUT_DO_SISTEMA(FAM);
  const aplica = <T extends { campo: string; editavel?: boolean }>(c: T): T => (c.campo in padroes
    ? { ...c, valorPadrao: { tipo: "registro", id: padroes[c.campo]! }, ...(naoEditaveis.includes(c.campo) ? { editavel: false } : {}) }
    : c);
  return { ...est, cabecalho: est.cabecalho.map(aplica), rodape: est.rodape.map((a) => ({ ...a, campos: a.campos.map(aplica) })), itens: est.itens.map((c) => (c.campo in padroes ? { ...c, valorPadrao: { tipo: "registro" as const, id: padroes[c.campo]! } } : c)) };
}
const estruturaGravada = async (id: string) => (await um<{ estrutura: EstruturaLayout }>("select estrutura from erp.layouts_documento where id=$1", [id])).estrutura;
const temRegistro = (v: unknown) => JSON.stringify(v).includes("\"registro\"");

// outra organização (LB-A1 registro de fora, LB-A4 importar lá, LB-A5 exportar de lá)
let outra: { orgId: string; headers: Record<string, string>; natureza: string };
let condicao: string; let transportadora: string; let sintetica: string;

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 });
  const f = await ids(h);
  fx = { incomeCategory: definido(f.incomeCategory, "natureza de receita"), category: definido(f.category, "natureza de despesa"), warehouse: definido(f.warehouse, "armazém"), warehouseEmpresa2: definido(f.warehouseEmpresa2, "armazém da empresa 2"), empresa: definido(f.empresa, "empresa") };
  const c = await h.app.inject({ method: "POST", url: "/api/resources/condicoes_pagamento", headers: h.headers(), payload: { nome: "LB 30 dias", parcelas: 1, dias_primeira_parcela: 30, modo: "intervalo" } });
  if (c.statusCode !== 201) throw new Error(c.body);
  condicao = j(c).id as string;
  const t = await h.app.inject({ method: "POST", url: "/api/resources/people", headers: h.headers(), payload: { name: "LB Transportadora", person_type: "legal", is_transporter: true } });
  if (t.statusCode !== 201) throw new Error(t.body);
  transportadora = j(t).id as string;
  sintetica = (await um<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and nature='income' and kind='synthetic' and deleted_at is null and is_active order by code limit 1", [h.demo.orgId])).id;
  const o = await seedDemo(admin, { orgName: "[TEST] Org A3-1b", adminEmail: "admin-a31b@demo.local", adminPassword: "Demo@12345", slug: "orga31b" }, () => {});
  const tok = j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-a31b@demo.local", password: "Demo@12345" } })).token as string;
  outra = { orgId: o.orgId, headers: { authorization: `Bearer ${tok}`, "x-org-id": o.orgId },
    natureza: (await um<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and nature='income' and kind='analytic' and deleted_at is null order by code limit 1", [o.orgId])).id };
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("LB-A1 gravar layout com padrão de cadastro", () => {
  it("natureza, condição e armazém válidos → 200 e a estrutura gravada com os ids", async () => {
    expect(sintetica && condicao && transportadora && outra.natureza, "premissas").toBeTruthy();
    const { id } = await criarLayout("LB-A1 válido");
    const est = comPadroes({ categoria_financeira_id: fx.incomeCategory, condicao_pagamento_id: condicao, warehouse_id: fx.warehouse, transporter_id: transportadora }, ["categoria_financeira_id"]);
    const r = await req("PUT", `${URL_}/${id}`, { estrutura: est });
    expect(r.statusCode, r.body).toBe(200);
    expect(await estruturaGravada(id)).toEqual(est);
  });

  it("natureza de despesa, sintética, inativa, de outra organização e inexistente → a MESMA 422 no caminho; nada gravado", async () => {
    const { id } = await criarLayout("LB-A1 inválido");
    const inativa = (await um<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and nature='income' and kind='analytic' and deleted_at is null and id<>$2 order by code limit 1", [h.demo.orgId, fx.incomeCategory])).id;
    await admin.query("update erp.financial_categories set is_active=false where id=$1", [inativa]);
    try {
      const casos = [fx.category, sintetica, inativa, outra.natureza, "00000000-0000-4000-8000-000000000000"];
      const caminho = caminhoDe(LAYOUT_DO_SISTEMA(FAM), "categoria_financeira_id");
      const respostas: Resp[] = [];
      for (const natureza of casos) {
        const r = await req("PUT", `${URL_}/${id}`, { estrutura: comPadroes({ categoria_financeira_id: natureza }) });
        expect(r.statusCode, `${natureza}: ${r.body}`).toBe(422);
        expect(j(r).error.code).toBe("VALIDATION_ERROR");
        expect(j(r).error.details).toEqual([{ path: caminho, message: "Registro padrão inválido para \"Natureza\"." }]);
        respostas.push(r);
      }
      expect(new Set(respostas.map((r) => r.body)).size, "corpos idênticos para os cinco casos").toBe(1);
      expect(temRegistro(await estruturaGravada(id)), "nada gravado").toBe(false);
    } finally {
      await admin.query("update erp.financial_categories set is_active=true where id=$1", [inativa]);
    }
  });

  it("pessoa que não é transportadora na Transportadora → 422 no caminho do campo", async () => {
    const { id } = await criarLayout("LB-A1 transp");
    const naoTransp = (await um<{ id: string }>("select id from erp.people where organization_id=$1 and is_client and not is_transporter and deleted_at is null limit 1", [h.demo.orgId])).id;
    const r = await req("PUT", `${URL_}/${id}`, { estrutura: comPadroes({ transporter_id: naoTransp }) });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.details).toEqual([{ path: caminhoDe(LAYOUT_DO_SISTEMA(FAM), "transporter_id"), message: "Registro padrão inválido para \"Transportadora\"." }]);
  });

  it("POST com estrutura de registro de outra organização → a mesma 422, layout não criado", async () => {
    const nome = `LB-A1 post ${++seq}`;
    const r = await req("POST", URL_, { familia: FAM, nome, estrutura: comPadroes({ warehouse_id: fx.warehouseEmpresa2, categoria_financeira_id: outra.natureza }) });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.details).toEqual([{ path: caminhoDe(LAYOUT_DO_SISTEMA(FAM), "categoria_financeira_id"), message: "Registro padrão inválido para \"Natureza\"." }]);
    expect(await um("select count(*)::int n from erp.layouts_documento where nome=$1", [nome])).toEqual({ n: 0 });
  });
});

describe("LB-A2 layout-efetivo de vendas", () => {
  it("padroesDeCadastro com rótulo (e empresaId no armazém); estrutura sem registro; inativar move para padroesInvalidos", async () => {
    const { id } = await criarLayout("LB-A2");
    const est = comPadroes({ categoria_financeira_id: fx.incomeCategory, warehouse_id: fx.warehouse }, ["categoria_financeira_id"]);
    expect((await req("PUT", `${URL_}/${id}`, { estrutura: est })).statusCode).toBe(200);
    const top = await criarTop();
    expect((await req("PUT", `${URL_}/${id}/tops`, { tipoOperacaoIds: [top] })).statusCode).toBe(200);
    const efetivo = () => req("GET", `/api/sales/orders/layout-efetivo?tipo_operacao_id=${top}`);
    const nat = await um<{ name: string }>("select name from erp.financial_categories where id=$1", [fx.incomeCategory]);
    const arm = await um<{ description: string; empresa_id: string }>("select description, empresa_id from erp.warehouses where id=$1", [fx.warehouse]);

    const r = await efetivo();
    expect(r.statusCode, r.body).toBe(200);
    const b = j(r);
    expect(b.origem).toBe("ligado");
    expect(b.padroesDeCadastro).toEqual({
      categoria_financeira_id: { id: fx.incomeCategory, rotulo: nat.name },
      "itens.warehouse_id": { id: fx.warehouse, rotulo: arm.description, empresaId: arm.empresa_id },
    });
    expect(b.padroesInvalidos).toEqual([]);
    expect(temRegistro(b.estrutura), "estrutura da resposta sem padrão de cadastro").toBe(false);
    const campoNat = (b.estrutura as EstruturaLayout).cabecalho.find((c) => c.campo === "categoria_financeira_id");
    expect(campoNat, "o campo continua na estrutura").toBeDefined();
    expect(campoNat!.editavel, "editavel preservado").toBe(false);
    expect(campoNat).not.toHaveProperty("valorPadrao");
    expect(await estruturaGravada(id), "o banco guarda o registro").toEqual(est);

    await admin.query("update erp.financial_categories set is_active=false where id=$1", [fx.incomeCategory]);
    try {
      const d = j(await efetivo());
      expect(d.padroesDeCadastro).toEqual({ "itens.warehouse_id": { id: fx.warehouse, rotulo: arm.description, empresaId: arm.empresa_id } });
      expect(d.padroesInvalidos).toEqual(["categoria_financeira_id"]);
      expect(temRegistro(d.estrutura)).toBe(false);
    } finally {
      await admin.query("update erp.financial_categories set is_active=true where id=$1", [fx.incomeCategory]);
    }
  });

  it("layout sem padrão de cadastro → a resposta de hoje, com as MESMAS chaves e a estrutura gravada", async () => {
    const { id } = await criarLayout("LB-A2 sem");
    const top = await criarTop();
    expect((await req("PUT", `${URL_}/${id}/tops`, { tipoOperacaoIds: [top] })).statusCode).toBe(200);
    const b = j(await req("GET", `/api/sales/orders/layout-efetivo?tipo_operacao_id=${top}`));
    expect(Object.keys(b).sort()).toEqual(["estrutura", "id", "nome", "origem"]);
    expect(b.estrutura).toEqual(await estruturaGravada(id));
  });
});

describe("LB-A3 GET do administrador", () => {
  it("estrutura COMPLETA (com os ids) + padroesDeCadastro + padroesInvalidos", async () => {
    const { id } = await criarLayout("LB-A3");
    const est = comPadroes({ categoria_financeira_id: fx.incomeCategory, warehouse_id: fx.warehouse, condicao_pagamento_id: condicao });
    expect((await req("PUT", `${URL_}/${id}`, { estrutura: est })).statusCode).toBe(200);
    await admin.query("update erp.condicoes_pagamento set is_active=false where id=$1", [condicao]);
    try {
      const r = await req("GET", `${URL_}/${id}`);
      expect(r.statusCode, r.body).toBe(200);
      const b = j(r);
      expect(b.estrutura).toEqual(est);
      expect(Object.keys(b.padroesDeCadastro).sort()).toEqual(["categoria_financeira_id", "itens.warehouse_id"]);
      expect(b.padroesDeCadastro["itens.warehouse_id"]).toMatchObject({ id: fx.warehouse, empresaId: fx.empresa });
      expect(b.padroesInvalidos).toEqual(["condicao_pagamento_id"]);
    } finally {
      await admin.query("update erp.condicoes_pagamento set is_active=true where id=$1", [condicao]);
    }
  });
});

describe("LB-A4 exportar e importar", () => {
  it("mesma organização: padrões mantidos, \"(importado)\" e \"(importado 2)\", sem TOP e não padrão; outra: removidos e listados (campo travado sem padrão → 422)", async () => {
    const { id, nome } = await criarLayout("LB-A4");
    const est = comPadroes({ categoria_financeira_id: fx.incomeCategory, warehouse_id: fx.warehouse }, ["categoria_financeira_id"]);
    expect((await req("PUT", `${URL_}/${id}`, { estrutura: est })).statusCode).toBe(200);
    expect((await req("POST", `${URL_}/${id}/padrao`, {})).statusCode).toBe(200);
    const top = await criarTop();
    expect((await req("PUT", `${URL_}/${id}/tops`, { tipoOperacaoIds: [top] })).statusCode).toBe(200);
    const code = (await um<{ code: string }>("select code from erp.layouts_documento where id=$1", [id])).code;
    try {
      const e = await req("GET", `${URL_}/${id}/exportar`);
      expect(e.statusCode, e.body).toBe(200);
      expect(String(e.headers["content-disposition"])).toBe(`attachment; filename="layout-${code}.json"`);
      expect(String(e.headers["content-type"])).toMatch(/^application\/json/);
      const arquivo = j(e);
      expect(arquivo).toEqual({ formato: "layout-documento", versao: 1, familia: FAM, nome, estrutura: est });

      const i1 = await req("POST", `${URL_}/importar`, arquivo);
      expect(i1.statusCode, i1.body).toBe(201);
      expect(j(i1)).toMatchObject({ nome: `${nome} (importado)`, removidos: [] });
      expect(Object.keys(j(i1)).sort()).toEqual(["code", "id", "nome", "removidos"]);
      const novo = j(i1).id as string;
      expect(j(i1).code).not.toBe(code);
      const linha = await um<Record<string, unknown>>("select organization_id, familia, padrao, is_active, estrutura, code from erp.layouts_documento where id=$1", [novo]);
      expect(linha).toMatchObject({ organization_id: h.demo.orgId, familia: FAM, padrao: false, is_active: true, estrutura: est, code: j(i1).code });
      expect(await um("select count(*)::int n from erp.layout_documento_tops where layout_id=$1", [novo]), "sem TOP").toEqual({ n: 0 });
      expect(await um("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='layouts_documento' and entity_id=$2 and action='import'", [h.demo.orgId, novo])).toEqual({ n: 1 });
      const admin1 = j(await req("GET", `${URL_}/${novo}`));
      expect(Object.keys(admin1.padroesDeCadastro).sort()).toEqual(["categoria_financeira_id", "itens.warehouse_id"]);

      const i2 = await req("POST", `${URL_}/importar`, arquivo);
      expect(i2.statusCode, i2.body).toBe(201);
      expect(j(i2).nome).toBe(`${nome} (importado 2)`);

      // OUTRA organização: a natureza e o armazém de cá não valem lá → REMOVIDOS; o resto passa pelo validador.
      // (a) a Natureza do arquivo é obrigatória e NÃO editável: sem o padrão removido ela reprova → 422 no caminho, nada criado
      const antesLa = await um<{ n: number }>("select count(*)::int n from erp.layouts_documento where organization_id=$1", [outra.orgId]);
      const travada = await req("POST", `${URL_}/importar`, arquivo, outra.headers);
      expect(travada.statusCode, travada.body).toBe(422);
      expect(j(travada).error.details).toEqual([{ path: caminhoDe(est, "categoria_financeira_id"), message: "\"Natureza\" é obrigatório e não editável: informe o valor padrão." }]);
      expect(await um("select count(*)::int n from erp.layouts_documento where organization_id=$1", [outra.orgId]), "nada criado lá").toEqual(antesLa);
      // (b) o mesmo layout com a Natureza editável: 201, os dois padrões removidos e listados, o resto do layout fica
      const editavel = { ...arquivo, estrutura: comPadroes({ categoria_financeira_id: fx.incomeCategory, warehouse_id: fx.warehouse }) };
      const o = await req("POST", `${URL_}/importar`, editavel, outra.headers);
      expect(o.statusCode, o.body).toBe(201);
      expect(j(o).nome, "nome livre lá").toBe(nome);
      expect([...j(o).removidos].sort((a: { campo: string }, b: { campo: string }) => a.campo.localeCompare(b.campo))).toEqual([
        { campo: "categoria_financeira_id", motivo: "Registro padrão não vale nesta organização." },
        { campo: "itens.warehouse_id", motivo: "Registro padrão não vale nesta organização." },
      ]);
      const la = await um<{ organization_id: string; padrao: boolean; estrutura: EstruturaLayout }>("select organization_id, padrao, estrutura from erp.layouts_documento where id=$1", [j(o).id]);
      expect(la.organization_id).toBe(outra.orgId);
      expect(la.padrao).toBe(false);
      expect(temRegistro(la.estrutura), "padrões removidos").toBe(false);
      expect(la.estrutura, "só os padrões saíram").toEqual(LAYOUT_DO_SISTEMA(FAM));
      expect(await um("select count(*)::int n from erp.layout_documento_tops where layout_id=$1", [j(o).id])).toEqual({ n: 0 });
    } finally {
      await req("POST", `${URL_}/${id}/ativo`, { ativo: false });
    }
  });
});

describe("LB-A5 recusas do importar e do exportar", () => {
  it("chave desconhecida, família, versão, formato, estrutura inválida e acima de 64 KiB → 422; nada criado", async () => {
    const base = { formato: "layout-documento", versao: 1, familia: FAM, nome: `LB-A5 ${++seq}`, estrutura: LAYOUT_DO_SISTEMA(FAM) };
    const antes = await um<{ n: number }>("select count(*)::int n from erp.layouts_documento where organization_id=$1", [h.demo.orgId]);
    const est = LAYOUT_DO_SISTEMA(FAM);
    const ai = est.rodape.findIndex((a) => a.campos.some((c) => c.campo === "installment_plan"));
    const ci = est.rodape[ai]!.campos.findIndex((c) => c.campo === "installment_plan");
    est.rodape[ai]!.campos[ci] = { ...est.rodape[ai]!.campos[ci]!, obrigatorio: true };
    const casos: [string, unknown, string | null][] = [
      ["chave desconhecida", { ...base, extra: 1 }, null],
      ["família fora", { ...base, familia: "compras.solicitacao" }, "familia"],
      ["versão fora", { ...base, versao: 2 }, "versao"],
      ["formato fora", { ...base, formato: "outro" }, "formato"],
      ["estrutura inválida", { ...base, estrutura: est }, `rodape[${ai}].campos[${ci}].obrigatorio`],
      ["acima de 64 KiB", { ...base, nome: "x".repeat(70_000) }, null],
    ];
    for (const [rotulo, corpo, caminho] of casos) {
      const r = await req("POST", `${URL_}/importar`, corpo);
      expect(r.statusCode, `${rotulo}: ${r.body}`).toBe(422);
      if (caminho) expect((j(r).error.details as { path: string }[]).map((d) => d.path), rotulo).toContain(caminho);
    }
    expect(await um("select count(*)::int n from erp.layouts_documento where organization_id=$1", [h.demo.orgId]), "nada criado").toEqual(antes);
  });

  it("exportar layout de outra organização, inexistente, excluído e id malformado → a MESMA 404 da leitura", async () => {
    const deLa = await criarLayout("LB-A5 de lá", outra.headers);
    const excluido = await criarLayout("LB-A5 excluído");
    await admin.query("update erp.layouts_documento set deleted_at=now() where id=$1", [excluido.id]);
    const alvos = [deLa.id, excluido.id, "00000000-0000-4000-8000-000000000000", "nao-e-uuid"];
    const exportar = await Promise.all(alvos.map((x) => req("GET", `${URL_}/${x}/exportar`)));
    const ler = await Promise.all(alvos.map((x) => req("GET", `${URL_}/${x}`)));
    for (const r of [...exportar, ...ler]) expect(r.statusCode, r.body).toBe(404);
    expect(new Set([...exportar, ...ler].map((r) => r.body)).size, "corpos idênticos, iguais aos da leitura").toBe(1);
    expect((await req("GET", `${URL_}/${deLa.id}/exportar`, undefined, outra.headers)).statusCode, "lá ele existe").toBe(200);
  });
});
