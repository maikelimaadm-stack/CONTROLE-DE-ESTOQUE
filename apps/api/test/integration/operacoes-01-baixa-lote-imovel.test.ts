import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { f9, iniciarF9a, encerrarF9a, j, erro, DATA, linha, unico, contar, imovel, type Hdr } from "./f9a-ajuda.js";

/**
 * OPERACOES-01 (decisão 286) — O IMÓVEL RURAL NA BAIXA EM LOTE (`POST /api/financial/<direção>s/settle-batch`) com o
 * MESMO comportamento da baixa de um título (`…/:id/settle`, F9a):
 *   · BL-1 sem a chave → o imóvel PADRÃO da empresa de cada título (o de hoje); com o id de um imóvel da empresa → ele;
 *          com `null` ("Sem imóvel") → nenhum, mesmo com o padrão — na baixa, no movimento de cada título, no
 *          movimento único e na tarifa do lote;
 *   · BL-2 imóvel de outra empresa, inexistente, de outra organização, inativo ou excluído → a MESMA 422 (a mensagem
 *          e o campo da baixa unitária), e NADA gravado (baixas, movimentos e títulos contados antes e depois).
 * A testemunha (superusuário, sem RLS) lê o imóvel gravado em cada linha.
 */
beforeAll(iniciarF9a, 240_000);
afterAll(encerrarF9a);

const MSG_IMOVEL = "Imóvel rural inválido para a empresa do lançamento.";
const api = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, headers: Hdr = f9.h.headers()) =>
  f9.h.app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

/** A = padrão da 1ª empresa; B = outro da 1ª; C = da 2ª. */
const IM = { A: "", B: "", C: "" };
beforeAll(async () => {
  IM.A = await imovel(f9.I.empresa, { padrao: true, nome: "BL Imóvel A" });
  IM.B = await imovel(f9.I.empresa, { nome: "BL Imóvel B" });
  IM.C = await imovel(f9.I.empresa2, { nome: "BL Imóvel C" });
  const n = await api("PUT", "/api/financeiro/configuracoes/naturezas-padrao", { tarifa_bancaria_id: f9.I.category });
  expect(n.statusCode, n.body).toBe(200);
}, 120_000);

async function pagar(valor: string): Promise<string> {
  const r = await api("POST", "/api/financial/payables", {
    empresa_id: f9.I.empresa, number: `BL-${unico()}`, person_id: f9.I.provider, amount: valor, emission_date: DATA, due_date: DATA, note: "Lote imóvel",
    apportionment: [{ financial_category_id: f9.I.category, cost_center_id: f9.I.costCenter, percentage: "100" }]
  });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const lote = (ids: string[], extra: Record<string, unknown> = {}) =>
  api("POST", "/api/financial/payables/settle-batch", { ids, settlement_date: DATA, bank_account_id: f9.I.bankAccount, ...extra });
type Lote = { settled: number; items: { settlement_id: string; bank_movement_id: string }[]; tarifa_movimento_id: string | null };
const imovelDe = async (tabela: "title_settlements" | "bank_movements", id: string) =>
  (await linha<{ i: string | null }>(`select imovel_rural_id::text as i from erp.${tabela} where id=$1`, [id])).i;
/** O imóvel de cada baixa, de cada movimento e da tarifa do lote. */
async function imoveisDoLote(l: Lote): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (const it of l.items) out.push(await imovelDe("title_settlements", it.settlement_id), await imovelDe("bank_movements", it.bank_movement_id));
  if (l.tarifa_movimento_id) out.push(await imovelDe("bank_movements", l.tarifa_movimento_id));
  return out;
}

describe("BL-1 — o imóvel do lote: ausente, informado e `null`", () => {
  it("SEM a chave (o de hoje): cada baixa, cada movimento e a tarifa com o PADRÃO da empresa", async () => {
    const r = await lote([await pagar("10.00"), await pagar("20.00")], { tarifa: "1.00" });
    expect(r.statusCode, r.body).toBe(201);
    const l = j(r) as unknown as Lote;
    expect([l.settled, Boolean(l.tarifa_movimento_id)], "premissa: duas baixas e a tarifa").toEqual([2, true]);
    expect(await imoveisDoLote(l)).toEqual([IM.A, IM.A, IM.A, IM.A, IM.A]);
  });

  it("COM o id de outro imóvel da empresa: ele vence o padrão, em tudo", async () => {
    const r = await lote([await pagar("11.00"), await pagar("21.00")], { tarifa: "1.00", imovel_rural_id: IM.B });
    expect(r.statusCode, r.body).toBe(201);
    expect(await imoveisDoLote(j(r) as unknown as Lote)).toEqual([IM.B, IM.B, IM.B, IM.B, IM.B]);
  });

  it("COM `null` (\"Sem imóvel\"): nenhum imóvel, mesmo com o padrão da empresa — no lote separado com tarifa e no movimento único", async () => {
    const r = await lote([await pagar("12.00"), await pagar("22.00")], { tarifa: "1.00", imovel_rural_id: null });
    expect(r.statusCode, r.body).toBe(201);
    const l = j(r) as unknown as Lote;
    expect([l.settled, Boolean(l.tarifa_movimento_id)], "premissa: duas baixas e a tarifa").toEqual([2, true]);
    expect(await imoveisDoLote(l)).toEqual([null, null, null, null, null]);
    const u = await lote([await pagar("13.00"), await pagar("23.00")], { movement_mode: "single", imovel_rural_id: null });
    expect(u.statusCode, u.body).toBe(201);
    const lu = j(u) as unknown as Lote;
    expect(new Set(lu.items.map((x) => x.bank_movement_id)).size, "premissa: um movimento só").toBe(1);
    expect(await imoveisDoLote(lu)).toEqual([null, null, null, null]);
  });
});

describe("BL-2 — as recusas do imóvel no lote: a MESMA 422 da baixa unitária, nada gravado", () => {
  it("de outra empresa, inexistente, de outra organização, inativo e excluído → 422 no campo `imovel_rural_id`; premissa: o válido passa nos mesmos títulos", async () => {
    const inativo = await imovel(f9.I.empresa, { nome: "BL Inativo" });
    const excluido = await imovel(f9.I.empresa, { nome: "BL Excluído" });
    await f9.admin.query("update erp.imoveis_rurais set is_active=false where id=$1", [inativo]);
    await f9.admin.query("update erp.imoveis_rurais set deleted_at=now() where id=$1", [excluido]);
    const outraOrg = (await linha<{ id: string }>("insert into erp.organizations(name,slug) values ($1,$2) returning id::text as id", [`[BL] ${unico()}`, `bl-${unico()}`])).id;
    const outraEmpresa = (await linha<{ id: string }>("insert into erp.empresas(organization_id,code,name) values ($1,1,'Empresa alheia BL') returning id::text as id", [outraOrg])).id;
    const alheio = (await linha<{ id: string }>("insert into erp.imoveis_rurais(organization_id,empresa_id,nome) values ($1,$2,'Imóvel alheio BL') returning id::text as id", [outraOrg, outraEmpresa])).id;
    const titulos = [await pagar("14.00"), await pagar("24.00")];
    const antes = [await contar("title_settlements"), await contar("bank_movements"), await contar("financial_titles")];
    for (const id of [IM.C, "00000000-0000-4000-8000-000000000000", alheio, inativo, excluido]) {
      const r = await lote(titulos, { tarifa: "1.00", imovel_rural_id: id });
      expect(r.statusCode, id).toBe(422);
      expect(erro(r), id).toEqual({ code: "VALIDATION_ERROR", message: MSG_IMOVEL, details: [{ path: ["imovel_rural_id"], message: MSG_IMOVEL }] });
    }
    expect([await contar("title_settlements"), await contar("bank_movements"), await contar("financial_titles")], "nada gravado").toEqual(antes);
    const ok = await lote(titulos, { imovel_rural_id: IM.B });
    expect(ok.statusCode, `premissa: o imóvel válido passa nos mesmos títulos — ${ok.body}`).toBe(201);
    expect((j(ok) as unknown as Lote).settled).toBe(2);
  });
});
