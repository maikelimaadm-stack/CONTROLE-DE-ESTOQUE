import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { getResource } from "@agro/domain";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS Fase 6 — PRODUTOS: ficha em abas (migration 0029). PR-1..PR-8.
 * Toda recusa confere o BANCO (nada gravado); todo aceite confere a linha gravada.
 */
let h: Harness; let admin: Db; let I: Awaited<ReturnType<typeof ids>>;
type Resp = { statusCode: number; body: string };
type Det = { path: string; message: string; aba?: string; detalhe?: string; linha?: number };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const post = (payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: "/api/resources/products", headers: hdr(), payload });
const put = (id: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `/api/resources/products/${id}`, headers: hdr(), payload });
const get = (url: string) => h.app.inject({ method: "GET", url, headers: h.headers() });
const criado = (r: Resp) => { expect(r.statusCode, r.body).toBe(201); return j(r).id as string; };
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await um<{ n: string }>(sql, p))!.n);
const nome = (s: string) => `PR ${s} ${Math.random().toString(36).slice(2, 8)}`;
const detalhes = (r: Resp) => j(r).error.details as Det[];
let base: Record<string, unknown>; let un: string; let kg: string; let lt: string;
const porNome = (x: string) => n("select count(*)::text n from erp.products where organization_id=$1 and description=$2", [h.demo.orgId, x]);
const saldoInicial = (product_id: string, extra: Record<string, unknown> = {}) => h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: hdr(), payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id, quantity: "10", unit_value: "5", ...extra } });
const baixa = (product_id: string, item: Record<string, unknown> = {}, quantity = "10") => h.app.inject({ method: "POST", url: "/api/stock/writeoffs", headers: hdr(), payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, writeoff_date: "2026-09-20", reason: "loss", justification: "teste PR", items: [{ product_id, quantity, ...item }] } });
const movimentos = (p: string) => n("select count(*)::text n from erp.stock_movements where product_id=$1", [p]);

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 }); I = await ids(h);
  const org = h.demo.orgId;
  const grupo = (await um<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='analytic' and deleted_at is null order by code limit 1", [org]))!.id;
  const u = async (s: string) => (await um<{ id: string }>("select id from erp.measurement_units where (organization_id is null or organization_id=$1) and upper(symbol)=$2 order by organization_id nulls last limit 1", [org, s]))?.id;
  un = (await u("UN"))!; kg = (await u("KG"))!; lt = (await u("L")) ?? (await u("LT"))!;
  base = { group_id: grupo, measurement_id: un, financial_category_id: I.category };
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("PR-1 — ficha em abas: campos novos gravados e lidos", () => {
  it("abas declaradas no registry; marca, fabricante, tipo do item, máximo, origem, CEST e MAPA gravam; CEST fora do formato 422", async () => {
    const def = getResource("products")!;
    expect(def.abas!.map((a) => a.key)).toEqual(["geral", "estoque", "unidades", "fiscal", "compras", "custos", "agro", "historico", "anexos"]);
    const x = nome("geral");
    const id = criado(await post({ ...base, description: x, marca: "Marca X", fabricante: "Fab Y", tipo_item: "07", estoque_maximo: "500", origem: "0", cest: "28.038.00", registro_mapa: "PR-12345", controle_lote: "nenhum" }));
    expect(await um("select marca, fabricante, tipo_item, estoque_maximo::text, origem, cest, registro_mapa, controle_lote, has_lot from erp.products where id=$1", [id]))
      .toEqual({ marca: "Marca X", fabricante: "Fab Y", tipo_item: "07", estoque_maximo: "500.0000", origem: 0, cest: "2803800", registro_mapa: "PR-12345", controle_lote: "nenhum", has_lot: false });
    const g = j(await get(`/api/resources/products/${id}`));
    expect(g).toMatchObject({ marca: "Marca X", unidades: [], fornecedores: [] });
    const y = nome("cest");
    const r = await post({ ...base, description: y, cest: "123" });
    expect(r.statusCode, r.body).toBe(422); expect(detalhes(r)[0]).toMatchObject({ path: "cest", aba: "fiscal" });
    expect(await porNome(y)).toBe(0);
    const t = await post({ ...base, description: y, tipo_item: "55" });
    expect(t.statusCode).toBe(422); expect(await porNome(y)).toBe(0);
  });
});

describe("PR-2 — controle de lote exige lote na entrada e na saída", () => {
  it("lote: entrada sem lote 422 (nada gravado); com lote 201; saída sem lote ESCOLHE o lote (R1-1); saída com lote 201", async () => {
    const p = criado(await post({ ...base, description: nome("lote"), controle_lote: "lote" }));
    const e = await saldoInicial(p);
    expect(e.statusCode, e.body).toBe(422); expect(j(e).error.message).toMatch(/informe o lote/);
    expect(await movimentos(p)).toBe(0);
    expect((await saldoInicial(p, { provider_lot: "L-1" })).statusCode).toBe(201);
    // R1-1 (decisão do Maike, opção b): a saída sem lote não é mais recusada — a API escolhe o lote pela validade
    // e o movimento gravado leva o lote escolhido (o gatilho da 0029 continua exigindo lote em todo INSERT).
    const s = await baixa(p, {}, "3");
    expect(s.statusCode, s.body).toBe(201);
    expect(await um("select provider_lot, quantity::text from erp.stock_movements where product_id=$1 and direction=-1", [p])).toEqual({ provider_lot: "L-1", quantity: "3.0000" });
    expect(await movimentos(p)).toBe(2);
    const ok = await baixa(p, { provider_lot: "L-1" }, "3");
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await um("select quantity::text from erp.stock_balances where product_id=$1 and provider_lot='L-1'", [p])).toEqual({ quantity: "4.0000" });
  });
  it("lote + validade: entrada sem validade 422; com validade 201", async () => {
    const p = criado(await post({ ...base, description: nome("validade"), controle_lote: "lote_validade" }));
    const e = await saldoInicial(p, { provider_lot: "V-1" });
    expect(e.statusCode, e.body).toBe(422); expect(j(e).error.message).toMatch(/validade/);
    expect(await movimentos(p)).toBe(0);
    expect((await saldoInicial(p, { provider_lot: "V-1", expiration_date: "2027-06-30" })).statusCode).toBe(201);
  });
  it("o GATILHO é a autoridade: movimento gravado direto sem lote é recusado pelo banco", async () => {
    const p = criado(await post({ ...base, description: nome("gatilho"), controle_lote: "lote" }));
    const erro = await admin.query(
      `insert into erp.stock_movements (organization_id, empresa_id, warehouse_id, product_id, movement_type, direction, quantity, source_type, source_id, movement_date)
       values ($1,$2,$3,$4,'entry',1,1,'teste',gen_random_uuid(),current_date)`, [h.demo.orgId, I.empresa, I.warehouse, p]).then(() => null, (x: Error) => x.message);
    expect(erro).toMatch(/informe o lote/);
  });
  it("sem controle: movimento sem lote continua aceito (comportamento de hoje)", async () => {
    const p = criado(await post({ ...base, description: nome("sem controle") }));
    expect((await saldoInicial(p)).statusCode).toBe(201);
  });
});

describe("PR-3 — mudar o controle com saldo → 422; sem saldo pode; movimentos existentes não mudam", () => {
  // R1-1 g: a mensagem EXATA — o saldo conferido é o da organização inteira, e "transfira" não resolve
  const MSG = "O produto tem saldo em estoque: zere o saldo em todos os armazéns antes de mudar o controle de lote.";
  it("com saldo 422 'zere o saldo em todos os armazéns' (API e banco); saldo zerado → muda; o movimento antigo fica igual", async () => {
    const p = criado(await post({ ...base, description: nome("muda") }));
    expect((await saldoInicial(p)).statusCode).toBe(201);
    const antes = (await admin.query("select * from erp.stock_movements where product_id=$1 order by created_at", [p])).rows;
    const r = await put(p, { controle_lote: "lote" });
    expect(r.statusCode, r.body).toBe(422); expect(j(r).error.message).toBe(MSG);
    expect(detalhes(r)[0]).toMatchObject({ path: "controle_lote", aba: "estoque" });
    expect(await um("select controle_lote from erp.products where id=$1", [p])).toEqual({ controle_lote: "nenhum" });
    const db = await admin.query("update erp.products set controle_lote='lote' where id=$1", [p]).then(() => null, (x: Error) => x.message);
    expect(db).toBe(`VALIDATION_ERROR: ${MSG}`);
    // web anterior (has_lot) também não escapa
    expect((await put(p, { has_lot: true })).statusCode).toBe(422);
    expect((await baixa(p)).statusCode).toBe(201);
    const ok = await put(p, { controle_lote: "lote_validade" });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await um("select controle_lote, has_lot from erp.products where id=$1", [p])).toEqual({ controle_lote: "lote_validade", has_lot: true });
    const depois = (await admin.query("select * from erp.stock_movements where product_id=$1 order by created_at", [p])).rows;
    expect(depois.slice(0, antes.length)).toEqual(antes);
  });
});

describe("PR-4 — Unidades e embalagens", () => {
  it("repete a padrão → 422 na aba e linha; fator 0 → 422; nada gravado; grade válida grava; PUT sem a grade não mexe", async () => {
    const x = nome("unid");
    const r = await post({ ...base, description: x, unidades: [{ measurement_id: kg, tipo_fator: "multiply", fator: "25" }, { measurement_id: un, tipo_fator: "multiply", fator: "2" }] });
    expect(r.statusCode, r.body).toBe(422); expect(detalhes(r)[0]).toMatchObject({ aba: "unidades", detalhe: "unidades", linha: 2 });
    expect(await porNome(x)).toBe(0);
    const f0 = await post({ ...base, description: x, unidades: [{ measurement_id: kg, tipo_fator: "multiply", fator: "0" }] });
    expect(f0.statusCode, f0.body).toBe(422); expect(detalhes(f0)[0]).toMatchObject({ detalhe: "unidades", linha: 1 });
    expect(await porNome(x)).toBe(0);
    const id = criado(await post({ ...base, description: x, unidades: [{ measurement_id: kg, tipo_fator: "multiply", fator: "25", codigo_barras: "789", uso_compra: true, uso_venda: false }] }));
    expect(await um("select fator::text, codigo_barras, uso_compra, uso_venda from erp.produto_unidades where product_id=$1 and deleted_at is null", [id])).toEqual({ fator: "25.000000", codigo_barras: "789", uso_compra: true, uso_venda: false });
    expect((await put(id, { marca: "outra" })).statusCode).toBe(200);
    expect(await n("select count(*)::text n from erp.produto_unidades where product_id=$1 and deleted_at is null", [id])).toBe(1);
    // trocar a padrão para uma unidade que está na grade (sem mandar a grade) → 422
    const tr = await put(id, { measurement_id: kg });
    expect(tr.statusCode, tr.body).toBe(422);
    // banco: linha direta repetindo a padrão é recusada
    const db = await admin.query("insert into erp.produto_unidades (organization_id, product_id, measurement_id, fator) values ($1,$2,$3,1)", [h.demo.orgId, id, un]).then(() => null, (e: Error) => e.message);
    expect(db).toMatch(/unidade padrão/);
    void lt;
  });
});

describe("PR-5 — Fiscal: taxes como campos, chave desconhecida preservada", () => {
  it("PUT com uma chave conhecida funde; chave desconhecida e reform continuam; null remove; tipo inválido 422", async () => {
    const id = criado(await post({ ...base, description: nome("taxes"), taxes: { cfop_out_internal: "5102", chave_do_futuro: "manter", reform: { cst_ibs_cbs: "000" } } }));
    const r = await put(id, { taxes: { cst_pis: "01" } });
    expect(r.statusCode, r.body).toBe(200);
    expect((await um<{ taxes: unknown }>("select taxes from erp.products where id=$1", [id]))!.taxes).toEqual({ cfop_out_internal: "5102", chave_do_futuro: "manter", reform: { cst_ibs_cbs: "000" }, cst_pis: "01" });
    expect((await put(id, { taxes: { cfop_out_internal: null } })).statusCode).toBe(200);
    expect((await um<{ taxes: Record<string, unknown> }>("select taxes from erp.products where id=$1", [id]))!.taxes).toEqual({ chave_do_futuro: "manter", reform: { cst_ibs_cbs: "000" }, cst_pis: "01" });
    const bad = await put(id, { taxes: { perc_icms: "doze" } });
    expect(bad.statusCode, bad.body).toBe(422);
  });
  it("as chaves dos campos fiscais são as da Regra Fiscal (uma fonte)", () => {
    const regra = getResource("tax_rules")!.fields.map((f) => f.name);
    const taxes = getResource("products")!.fields.find((f) => f.name === "taxes")!;
    for (const c of taxes.camposJson!) expect(regra, c.name).toContain(c.name);
  });
});

describe("PR-6 — Compras: fornecedores do produto", () => {
  it("parceiro sem tipo Fornecedor → 422 na linha; dois preferenciais → 422; fornecedor válido grava", async () => {
    const naoForn = (await um<{ id: string }>("select id from erp.people where organization_id=$1 and not is_provider and deleted_at is null limit 1", [h.demo.orgId]))!.id;
    const x = nome("forn");
    const r = await post({ ...base, description: x, fornecedores: [{ person_id: I.provider, codigo_no_fornecedor: "A1" }, { person_id: naoForn }] });
    expect(r.statusCode, r.body).toBe(422); expect(detalhes(r)[0]).toMatchObject({ aba: "compras", detalhe: "fornecedores", linha: 2 });
    expect(await porNome(x)).toBe(0);
    const outro = (await um<{ id: string }>("select id from erp.people where organization_id=$1 and is_provider and deleted_at is null and id<>$2 limit 1", [h.demo.orgId, I.provider]))?.id;
    if (outro) {
      const p2 = await post({ ...base, description: x, fornecedores: [{ person_id: I.provider, preferencial: true }, { person_id: outro, preferencial: true }] });
      expect(p2.statusCode, p2.body).toBe(422); expect(await porNome(x)).toBe(0);
    }
    const id = criado(await post({ ...base, description: x, fornecedores: [{ person_id: I.provider, codigo_no_fornecedor: "A1", measurement_id: kg, preferencial: true }] }));
    expect(await um("select codigo_no_fornecedor, preferencial from erp.produto_fornecedores where product_id=$1", [id])).toEqual({ codigo_no_fornecedor: "A1", preferencial: true });
    const db = await admin.query("insert into erp.produto_fornecedores (organization_id, product_id, person_id) values ($1,$2,$3)", [h.demo.orgId, id, naoForn]).then(() => null, (e: Error) => e.message);
    expect(db).toMatch(/tipo Fornecedor/);
  });
});

describe("PR-7 — skew: has_lot legado derivado; corpo estrito", () => {
  it("web anterior: has_lot=true grava 'lote', false grava 'nenhum'; has_lot continua na leitura; chave desconhecida 422", async () => {
    const id = criado(await post({ ...base, description: nome("legado"), has_lot: true }));
    expect(await um("select controle_lote, has_lot from erp.products where id=$1", [id])).toEqual({ controle_lote: "lote", has_lot: true });
    expect(j(await get(`/api/resources/products/${id}`)).has_lot).toBe(true);
    expect((await put(id, { has_lot: false })).statusCode).toBe(200);
    expect(await um("select controle_lote, has_lot from erp.products where id=$1", [id])).toEqual({ controle_lote: "nenhum", has_lot: false });
    // lote + validade não é rebaixado por um has_lot=true da web anterior
    expect((await put(id, { controle_lote: "lote_validade" })).statusCode).toBe(200);
    expect((await put(id, { has_lot: true, description: nome("legado 2") })).statusCode).toBe(200);
    expect(await um("select controle_lote from erp.products where id=$1", [id])).toEqual({ controle_lote: "lote_validade" });
    // gravação direta (API anterior à 0029 grava has_lot): o gatilho deriva o controle
    await admin.query("update erp.products set has_lot=false where id=$1", [id]);
    expect(await um("select controle_lote from erp.products where id=$1", [id])).toEqual({ controle_lote: "nenhum" });
    const r = await put(id, { campo_que_nao_existe: 1 });
    expect(r.statusCode).toBe(422);
  });
});

describe("PR-8 — Histórico e saldo por lote", () => {
  it("histórico: quem, quando, o quê (principal e grades); 404 para inexistente; saldo por lote no /stock/balances", async () => {
    const id = criado(await post({ ...base, description: nome("hist"), controle_lote: "lote" }));
    expect((await put(id, { marca: "M", unidades: [{ measurement_id: kg, tipo_fator: "multiply", fator: "5" }] })).statusCode).toBe(200);
    const r = await get(`/api/resources/products/${id}/historico`);
    expect(r.statusCode, r.body).toBe(200);
    const ev = j(r).items as { acao: string; onde: string; campos: string[]; quem: string | null }[];
    expect(ev.some((e) => e.acao === "create" && e.onde === "Produto")).toBe(true);
    expect(ev.some((e) => e.acao === "update" && e.campos.includes("Marca"))).toBe(true);
    expect(ev.some((e) => e.acao === "create" && e.onde === "Unidades alternativas e embalagens")).toBe(true);
    expect(ev.every((e) => typeof e.quem === "string")).toBe(true);
    expect(JSON.stringify(ev)).not.toContain("\"before\"");
    expect((await get("/api/resources/products/00000000-0000-4000-8000-000000000000/historico")).statusCode).toBe(404);
    expect((await saldoInicial(id, { provider_lot: "H-1" })).statusCode).toBe(201);
    expect((await saldoInicial(id, { provider_lot: "H-2", quantity: "4" })).statusCode).toBe(201);
    const s = j(await get(`/api/stock/balances?product_id=${id}&pageSize=100`)).items as { provider_lot: string; quantity: string }[];
    expect(s.map((x) => [x.provider_lot, Number(x.quantity)]).sort()).toEqual([["H-1", 10], ["H-2", 4]]);
  });
});
