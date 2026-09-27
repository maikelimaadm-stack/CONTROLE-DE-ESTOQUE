import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { FAMILIAS_COM_LAYOUT, LAYOUT_DO_SISTEMA, type EstruturaLayout, type CampoDoLayout } from "@agro/domain";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * VENDAS-A3-1c — configurador visual: zonas e grupo do cabeçalho (decisão 261).
 *  LC-A1  PUT /api/admin/layouts-documento/:id: campo do documento em qualquer zona (Vencimento numa aba, Observação no
 *         cabeçalho) → 200 e gravado; "Parcelamento" no cabeçalho → 422 no caminho; grupo desconhecido → 422 (zod);
 *         grupo em campo de aba → 422; layout sem grupo continua 200.
 *  LC-A2  textos ao usuário: "família" → "movimento", com o MESMO código de erro.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
const j = (r: { body: string }) => JSON.parse(r.body);
const URL_ = "/api/admin/layouts-documento";
const FAM = "vendas.pedido";
const OUTRA_FAM = FAMILIAS_COM_LAYOUT.find((f) => f !== FAM);
const req = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown): Promise<Resp> =>
  h.app.inject({ method, url, headers: payload === undefined ? h.headers() : { ...h.headers(), "content-type": "application/json" }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) }) as unknown as Promise<Resp>;
let seq = 0;
const um = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0] as T;
const estruturaGravada = async (id: string) => (await um<{ estrutura: EstruturaLayout }>("select estrutura from erp.layouts_documento where id=$1", [id])).estrutura;

async function criarLayout(nome: string, familia = FAM): Promise<string> {
  const r = await req("POST", URL_, { familia, nome: `${nome} ${++seq}` });
  if (r.statusCode !== 201) throw new Error(r.body);
  return j(r).id as string;
}
async function criarTop(codigoBase: string): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(), payload: { codigo: `C${Date.now().toString(36).slice(-4)}${++seq}`, codigoBase, nome: `TOP A3-1c ${seq}` } });
  if (r.statusCode !== 201) throw new Error(r.body);
  return j(r).id as string;
}

/** Tira `campo` de onde estiver no cabeçalho/rodapé e devolve o campo e a estrutura sem ele. */
function tirar(est: EstruturaLayout, campo: string): { c: CampoDoLayout; est: EstruturaLayout } {
  const ci = est.cabecalho.findIndex((x) => x.campo === campo);
  if (ci >= 0) return { c: est.cabecalho[ci]!, est: { ...est, cabecalho: est.cabecalho.filter((_, i) => i !== ci) } };
  for (const a of est.rodape) {
    const c = a.campos.find((x) => x.campo === campo);
    if (c) return { c, est: { ...est, rodape: est.rodape.map((b) => (b === a ? { ...b, campos: b.campos.filter((x) => x !== c) } : b)) } };
  }
  throw new Error(`campo ${campo} fora da estrutura`);
}
const indiceDaAba = (est: EstruturaLayout, titulo: string) => {
  const i = est.rodape.findIndex((a) => a.aba === titulo);
  if (i < 0) throw new Error(`aba ${titulo} ausente`);
  return i;
};

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("LC-A1 zonas e grupo no PUT do layout", () => {
  it("Vencimento numa aba \"Financeiro\" e Observação no cabeçalho → 200 e a estrutura gravada", async () => {
    const id = await criarLayout("LC-A1 zonas");
    const semVenc = tirar(LAYOUT_DO_SISTEMA(FAM), "due_date");
    const venc = semVenc.c;
    let est = semVenc.est;
    const t = tirar(est, "note"); est = t.est;
    const fin = indiceDaAba(est, "Financeiro");
    est = { ...est, cabecalho: [...est.cabecalho, { ...t.c, grupo: "adicionais" }],
      rodape: est.rodape.map((a, i) => (i === fin ? { ...a, campos: [...a.campos, venc] } : a)) };
    const r = await req("PUT", `${URL_}/${id}`, { estrutura: est });
    expect(r.statusCode, r.body).toBe(200);
    const gravada = await estruturaGravada(id);
    expect(gravada).toEqual(est);
    expect(gravada.cabecalho.find((x) => x.campo === "note"), "Observação no cabeçalho, grupo adicionais").toMatchObject({ grupo: "adicionais" });
    expect(gravada.rodape[fin]!.campos.map((x) => x.campo)).toContain("due_date");
    expect(gravada.cabecalho.map((x) => x.campo)).not.toContain("due_date");
  });

  it("Parcelamento no cabeçalho → 422 VALIDATION_ERROR em cabecalho[i].campo; nada gravado", async () => {
    const id = await criarLayout("LC-A1 parcelamento");
    const antes = await estruturaGravada(id);
    const { c, est } = tirar(LAYOUT_DO_SISTEMA(FAM), "installment_plan");
    const invalida = { ...est, cabecalho: [...est.cabecalho, c] };
    const r = await req("PUT", `${URL_}/${id}`, { estrutura: invalida });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.code).toBe("VALIDATION_ERROR");
    expect(j(r).error.details).toContainEqual({ path: `cabecalho[${invalida.cabecalho.length - 1}].campo`, message: "\"Parcelamento\" só pode ficar numa aba do rodapé." });
    expect(await estruturaGravada(id), "nada gravado").toEqual(antes);
  });

  it("grupo desconhecido (\"xyz\") → 422 do contrato (zod) no caminho do grupo", async () => {
    const id = await criarLayout("LC-A1 grupo xyz");
    const est = LAYOUT_DO_SISTEMA(FAM);
    const payload = { estrutura: { ...est, cabecalho: est.cabecalho.map((x, i) => (i === 0 ? { ...x, grupo: "xyz" } : x)) } };
    const r = await req("PUT", `${URL_}/${id}`, payload);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.code).toBe("VALIDATION_ERROR");
    const caminhos = (j(r).error.details as { path: string }[]).map((d) => d.path);
    expect(caminhos.some((p) => /^estrutura\.cabecalho\.0\.grupo$/.test(p)), caminhos.join(",")).toBe(true);
  });

  it("grupo em campo de aba → 422 em rodape[a].campos[i].grupo", async () => {
    const id = await criarLayout("LC-A1 grupo aba");
    const est = LAYOUT_DO_SISTEMA(FAM);
    const a = est.rodape.findIndex((x) => x.campos.length > 0);
    const invalida = { ...est, rodape: est.rodape.map((x, i) => (i === a ? { ...x, campos: x.campos.map((c, k) => (k === 0 ? { ...c, grupo: "principal" as const } : c)) } : x)) };
    const r = await req("PUT", `${URL_}/${id}`, { estrutura: invalida });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.code).toBe("VALIDATION_ERROR");
    expect(j(r).error.details).toContainEqual({ path: `rodape[${a}].campos[0].grupo`, message: "Grupo só vale nos campos do cabeçalho." });
  });

  it("layout sem grupo algum continua 200 (compatibilidade)", async () => {
    const id = await criarLayout("LC-A1 sem grupo");
    const est = LAYOUT_DO_SISTEMA(FAM);
    const semGrupo = { ...est, cabecalho: est.cabecalho.map(({ grupo: _g, ...x }) => x) };
    expect(JSON.stringify(semGrupo)).not.toContain("\"grupo\"");
    const r = await req("PUT", `${URL_}/${id}`, { estrutura: semGrupo });
    expect(r.statusCode, r.body).toBe(200);
    expect(await estruturaGravada(id)).toEqual(semGrupo);
  });
});

describe("LC-A2 textos: \"movimento\" no lugar de \"família\", mesmo código", () => {
  it("PUT /:id/tops com TOP de outro movimento → 422 VALIDATION_ERROR com \"movimento\"", async () => {
    expect(OUTRA_FAM, "premissa: há outro movimento com layout").toBeTruthy();
    const id = await criarLayout("LC-A2 tops");
    const top = await criarTop(OUTRA_FAM!);
    const r = await req("PUT", `${URL_}/${id}/tops`, { tipoOperacaoIds: [top] });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.code).toBe("VALIDATION_ERROR");
    expect(j(r).error.message).toBe("TOP de outro movimento");
    expect(j(r).error.details).toEqual([{ path: "tipoOperacaoIds.0", message: `A TOP não é do movimento ${FAM} deste layout.` }]);
    expect(r.body).not.toMatch(/fam[ií]lia/i);
  });

  it("marcar layout inativo como padrão → 422 com \"movimento\"", async () => {
    const id = await criarLayout("LC-A2 padrão");
    expect((await req("POST", `${URL_}/${id}/ativo`, { ativo: false })).statusCode).toBe(200);
    const r = await req("POST", `${URL_}/${id}/padrao`, {});
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.code).toBe("VALIDATION_ERROR");
    expect(j(r).error.message).toBe("Layout inativo não pode ser o padrão do movimento");
    expect(r.body).not.toMatch(/fam[ií]lia/i);
  });
});
