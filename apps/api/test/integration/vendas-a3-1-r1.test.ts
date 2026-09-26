import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { LAYOUT_DO_SISTEMA } from "@agro/domain";
import { escoposDeTodosOsModulos, harness, TEST_URL, type Harness } from "./setup.js";

/**
 * VENDAS-A3-1 · R1.
 *  R1-A1  campo que sempre tem valor (Parcelamento) não aceita "obrigatório" no PUT do layout.
 *  R1-B*  GET /api/admin/layouts-documento/efetivo — a linha "Layout do documento" da TOP pela porta de Configurações
 *         (tipos_operacao.view), TOP ativa ou inativa, com a MESMA 404 para tudo que não é TOP viva com layout.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body);
const URL_ = "/api/admin/layouts-documento";
const EFETIVO = `${URL_}/efetivo`;
const req = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, headers = h.headers()) =>
  h.app.inject({ method, url, headers: payload === undefined ? headers : { ...headers, "content-type": "application/json" }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
let seq = 0;
async function criarTop(codigoBase: string, headers = h.headers()): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers, payload: { codigo: `R${Date.now().toString(36).slice(-4)}${++seq}`, codigoBase, nome: `TOP R1 ${codigoBase} ${seq}` } });
  if (r.statusCode !== 201) throw new Error(r.body);
  return j(r).id as string;
}
async function criarLayout(familia: string, nome: string): Promise<string> {
  const r = await req("POST", URL_, { familia, nome: `${nome} ${++seq}` });
  if (r.statusCode !== 201) throw new Error(r.body);
  return j(r).id as string;
}
const efetivo = (topId: string, headers = h.headers()) => req("GET", `${EFETIVO}?tipoOperacaoId=${topId}`, undefined, headers);

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("R1-A1 Parcelamento obrigatório é recusado no PUT do layout", () => {
  it("422 VALIDATION_ERROR no caminho .obrigatorio do campo, com a mensagem do domínio", async () => {
    const id = await criarLayout("vendas.pedido", "R1-A1");
    const est = LAYOUT_DO_SISTEMA("vendas.pedido");
    const ai = est.rodape.findIndex((a) => a.campos.some((c) => c.campo === "installment_plan"));
    const ci = est.rodape[ai]!.campos.findIndex((c) => c.campo === "installment_plan");
    est.rodape[ai]!.campos[ci] = { ...est.rodape[ai]!.campos[ci]!, obrigatorio: true };
    const r = await req("PUT", `${URL_}/${id}`, { estrutura: est });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.code).toBe("VALIDATION_ERROR");
    expect(j(r).error.details).toContainEqual({ path: `rodape[${ai}].campos[${ci}].obrigatorio`, message: "\"Parcelamento\" sempre tem valor: não pode ser obrigatório." });
    expect((await admin.query("select estrutura from erp.layouts_documento where id=$1", [id])).rows[0]!.estrutura, "nada gravado").toEqual(LAYOUT_DO_SISTEMA("vendas.pedido"));
  });
});

describe("R1-B rota de Configurações do layout efetivo da TOP", () => {
  it("R1-B1 ligado · padrão da família · sistema (origem, nome e id)", async () => {
    // família orçamento, só deste teste: sem padrão → sistema; com padrão → padrão; ligada → ligado
    const top = await criarTop("vendas.orcamento");
    const s = await efetivo(top);
    expect(s.statusCode, s.body).toBe(200);
    expect(j(s)).toEqual({ origem: "sistema", nome: null, id: null });

    const padrao = await criarLayout("vendas.orcamento", "R1-B1 padrão");
    expect((await req("POST", `${URL_}/${padrao}/padrao`, {})).statusCode).toBe(200);
    try {
      const nomePadrao = j(await req("GET", `${URL_}/${padrao}`)).nome as string;
      expect(j(await efetivo(top))).toEqual({ origem: "padrao_da_familia", nome: nomePadrao, id: padrao });

      const ligado = await criarLayout("vendas.orcamento", "R1-B1 ligado");
      expect((await req("PUT", `${URL_}/${ligado}/tops`, { tipoOperacaoIds: [top] })).statusCode).toBe(200);
      const nomeLigado = j(await req("GET", `${URL_}/${ligado}`)).nome as string;
      expect(j(await efetivo(top))).toEqual({ origem: "ligado", nome: nomeLigado, id: ligado });
    } finally {
      await req("POST", `${URL_}/${padrao}/ativo`, { ativo: false });
    }
  });

  it("R1-B2 TOP INATIVA ligada → 200 com origem ligado", async () => {
    const top = await criarTop("vendas.pedido");
    const l = await criarLayout("vendas.pedido", "R1-B2");
    expect((await req("PUT", `${URL_}/${l}/tops`, { tipoOperacaoIds: [top] })).statusCode).toBe(200);
    await admin.query("update erp.tipos_operacao set ativo=false where id=$1", [top]);
    expect((await admin.query("select ativo from erp.tipos_operacao where id=$1", [top])).rows[0]!.ativo, "premissa: TOP inativa").toBe(false);
    const r = await efetivo(top);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ origem: "ligado", id: l });
  });

  it("R1-B3 excluída, outra organização, inexistente, id malformado e família sem layout → a MESMA 404", async () => {
    const excluida = await criarTop("vendas.pedido");
    await admin.query("update erp.tipos_operacao set excluido_em=now() where id=$1", [excluida]);
    const o = await seedDemo(admin, { orgName: "[TEST] Org R1", adminEmail: "admin-r1@demo.local", adminPassword: "Demo@12345", slug: "orgr1" }, () => {});
    const tok = j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-r1@demo.local", password: "Demo@12345" } })).token as string;
    const deOutra = await criarTop("vendas.pedido", { authorization: `Bearer ${tok}`, "x-org-id": o.orgId });
    const compras = await criarTop("compras.solicitacao");
    const respostas = await Promise.all([excluida, deOutra, "00000000-0000-4000-8000-000000000000", "nao-e-uuid", compras].map((id) => efetivo(id)));
    for (const r of respostas) expect(r.statusCode, r.body).toBe(404);
    expect(new Set(respostas.map((r) => r.body)).size, "corpos idênticos").toBe(1);
  });

  it("R1-B4 perfil só com tipos_operacao.view: 200 na rota nova, 403 na de vendas", async () => {
    const top = await criarTop("vendas.pedido");
    const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil R1-B4 ${++seq}`, permissions: ["tipos_operacao.view"] } });
    expect(papel.statusCode, papel.body).toBe(201);
    const email = `r1b4-${seq}@demo.local`;
    const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: "Só configura TOP", email, password: "Config@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
    expect(vinculo.statusCode, vinculo.body).toBe(201);
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Config@12345" } });
    expect(login.statusCode, login.body).toBe(200);
    const hdr = { authorization: `Bearer ${j(login).token as string}`, "x-org-id": h.demo.orgId };
    const nova = await efetivo(top, hdr);
    expect(nova.statusCode, nova.body).toBe(200);
    expect(j(nova).origem).toBeDefined();
    const vendas = await h.app.inject({ method: "GET", url: `/api/sales/orders/layout-efetivo?tipo_operacao_id=${top}`, headers: hdr });
    expect(vendas.statusCode, vendas.body).toBe(403);
  });

  it("R1-B5 /efetivo não é tratado como /:id", async () => {
    const semParametro = await req("GET", EFETIVO);
    expect(semParametro.statusCode, semParametro.body).toBe(422); // query estrita: parâmetro ausente
    expect((await req("GET", `${EFETIVO}?tipoOperacaoId=x&extra=1`)).statusCode, "chave desconhecida").toBe(422);
    const top = await criarTop("vendas.pedido");
    const r = await efetivo(top);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).not.toHaveProperty("estrutura"); // o /:id devolveria o layout (com estrutura) ou a 404 de "Layout"
    expect(Object.keys(j(r)).sort()).toEqual(["id", "nome", "origem"]);
  });
});
