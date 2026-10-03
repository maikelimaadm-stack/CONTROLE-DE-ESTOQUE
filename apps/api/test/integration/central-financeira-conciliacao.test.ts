import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CENTRAL FINANCEIRA — CONCILIAÇÃO OFX (OPERACOES-01 F8, decisão 285).
 *
 * Um extrato OFX SINTÉTICO, montado aqui, com uma transação de cada caso e movimentos semeados para casar:
 *   T1 +150,00 em 10/05 ↔ M1 +150,00 em 10/05 ............ "Encontrado" (conciliado na importação)
 *   T2 −89.90  em 14/05 ↔ M2 −89,90  em 12/05 (2 dias) ... "Sugestão"
 *   T3 −100    em 16/05 ↔ M3 −40 (15/05) + M4 −60 (16/05)  "Soma de vários"
 *   T4 −33,33  em 20/05 (sem par) ........................ "Sem sugestão" → criar lançamento pelo extrato (tarifa)
 *   T5 −12.00  em 22/05 (sem par) ........................ "Sem sugestão" → soma errada, outra conta, ignorar
 * e uma linha ilegível (recusada com motivo). Prova: a conciliação automática SÓ do encontrado; as sugestões do
 * domínio no detalhe; confirmar a sugestão e a soma (a marca no MOVIMENTO); soma errada → 422; movimento de outra
 * conta → 404; transação já conciliada → 409; criar lançamento; ignorar até a importação ficar conciliada; desfazer;
 * a conta validada (outra conta no ACCTID, inativa, de outra organização); FITID repetido; "1.234,56" em decimal.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let CONTA = ""; let OUTRA_CONTA = ""; let INATIVA = ""; let OUTRA_ORG = ""; let CONTA_ALHEIA = "";
let M1 = ""; let M2 = ""; let M3 = ""; let M4 = ""; let M5 = ""; let M6 = "";
let IMPORTACAO = "";
const T: Record<string, string> = {};
let seq = 0;
type Json = Record<string, unknown> & { error?: { code: string; message: string } };
const j = (r: { json: () => unknown }) => r.json() as Json;

const conta = async (code: string, o: { numero?: string; ativa?: boolean; org?: string } = {}) =>
  (await admin.query<{ id: string }>(
    "insert into erp.bank_accounts(organization_id,code,description,type,opening_balance,is_active,account_number) values ($1,$2,$3,'checking',0,$4,$5) returning id",
    [o.org ?? h.demo.orgId, code, `[F8] ${code}`, o.ativa ?? true, o.numero ?? null])).rows[0]!.id;
const movimento = async (contaId: string, data: string, tipo: "in" | "out", valor: string) =>
  (await admin.query<{ id: string }>(
    "insert into erp.bank_movements(organization_id,code,bank_account_id,empresa_id,movement_date,type,category_type,amount) values ($1,$2,$3,$4,$5,$6,$6,$7) returning id",
    [h.demo.orgId, `F8C${String(++seq).padStart(4, "0")}`, contaId, I.empresa, data, tipo, valor])).rows[0]!.id;

/** Extrato OFX (SGML) sintético: uma conta e as transações pedidas. */
function ofx(acctid: string, transacoes: { fitid: string; data: string; valor: string; memo?: string }[]): string {
  const linhas = transacoes.map((t) => `<STMTTRN>\n<TRNTYPE>OTHER\n<DTPOSTED>${t.data}120000[-3:BRT]\n<TRNAMT>${t.valor}\n<FITID>${t.fitid}\n<MEMO>${t.memo ?? "Lançamento"}\n</STMTTRN>`).join("\n");
  return `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX>\n<BANKMSGSRSV1>\n<STMTTRNRS>\n<STMTRS>\n<CURDEF>BRL\n<BANKACCTFROM>\n<BANKID>001\n<BRANCHID>1234\n<ACCTID>${acctid}\n<ACCTTYPE>CHECKING\n</BANKACCTFROM>\n<BANKTRANLIST>\n<DTSTART>20310501\n<DTEND>20310531\n${linhas}\n</BANKTRANLIST>\n</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>\n`;
}
const post = (url: string, payload: unknown, extra: Record<string, string> = {}) => h.app.inject({ method: "POST", url, payload: payload as Record<string, unknown>, headers: h.headers(extra) });
const get = (url: string) => h.app.inject({ method: "GET", url, headers: h.headers() });
const importar = (contaId: string, conteudo: string) => post("/api/financeiro/conciliacao/importacoes", { conta_id: contaId, descricao: "Extrato de maio", conteudo });
const movimentoLido = async (id: string) => (await admin.query<{ conciliado: boolean; ofx_transaction_id: string | null }>(
  "select reconciled_at is not null as conciliado, ofx_transaction_id from erp.bank_movements where id=$1", [id])).rows[0]!;
const transacaoLida = async (id: string) => (await admin.query<{ status: string; bank_movement_id: string | null }>("select status, bank_movement_id from erp.ofx_transactions where id=$1", [id])).rows[0]!;
const situacaoDaImportacao = async (id: string) => (await admin.query<{ status: string }>("select status from erp.ofx_imports where id=$1", [id])).rows[0]!.status;
const importacoesDa = async (contaId: string) => Number((await admin.query<{ n: string }>("select count(*) n from erp.ofx_imports where bank_account_id=$1", [contaId])).rows[0]!.n);

beforeAll(async () => {
  h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 3 });
  CONTA = await conta("OFX1", { numero: "0001234-5" });
  OUTRA_CONTA = await conta("OFX2", { numero: "777-1" });
  INATIVA = await conta("OFX-INAT", { numero: "0001234-5", ativa: false });
  OUTRA_ORG = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Outra F8 OFX','outra-f8-ofx') returning id")).rows[0]!.id;
  CONTA_ALHEIA = await conta("OFX-ALHEIA", { numero: "0001234-5", org: OUTRA_ORG });
  M1 = await movimento(CONTA, "2031-05-10", "in", "150.00");
  M2 = await movimento(CONTA, "2031-05-12", "out", "89.90");
  M3 = await movimento(CONTA, "2031-05-15", "out", "40.00");
  M4 = await movimento(CONTA, "2031-05-16", "out", "60.00");
  M6 = await movimento(CONTA, "2031-05-21", "out", "30.00");
  M5 = await movimento(OUTRA_CONTA, "2031-05-22", "out", "12.00");
}, 180_000);

afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("conciliação de um OFX sintético", () => {
  it("importa: só o ENCONTRADO é conciliado na hora; a linha ilegível vai para recusadas com o motivo", async () => {
    // Premissa: nenhum movimento da conta está conciliado.
    expect((await admin.query("select 1 from erp.bank_movements where bank_account_id=$1 and reconciled_at is not null", [CONTA])).rowCount).toBe(0);
    const r = await importar(CONTA, ofx("0001234-5", [
      { fitid: "F8-T1", data: "20310510", valor: "150,00", memo: "Recebimento cliente" },
      { fitid: "F8-T2", data: "20310514", valor: "-89.90", memo: "Fornecedor &amp; cia" },
      { fitid: "F8-T3", data: "20310516", valor: "-100" },
      { fitid: "F8-T4", data: "20310520", valor: "-33,33", memo: "Tarifa pacote" },
      { fitid: "F8-T5", data: "20310522", valor: "-12.00" },
      { fitid: "F8-BAD", data: "20310523", valor: "abc" }
    ]));
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r)).toMatchObject({ transacoes: 5, duplicadas: 0, conciliadas_automaticamente: 1, recusadas: [{ fitid: "F8-BAD", motivo: "Valor inválido no extrato: abc" }] });
    IMPORTACAO = String(j(r)["id"]);
    const linhas = await admin.query<{ id: string; fitid: string; amount: string; memo: string }>("select id, fitid, amount::text, memo from erp.ofx_transactions where import_id=$1 order by fitid", [IMPORTACAO]);
    for (const l of linhas.rows) T[l.fitid] = l.id;
    expect(linhas.rows.map((l) => [l.fitid, l.amount])).toEqual([["F8-T1", "150.00"], ["F8-T2", "-89.90"], ["F8-T3", "-100.00"], ["F8-T4", "-33.33"], ["F8-T5", "-12.00"]]);
    expect(linhas.rows.find((l) => l.fitid === "F8-T2")!.memo).toBe("Fornecedor & cia");
    // A marca de conciliado mora no MOVIMENTO.
    expect(await movimentoLido(M1)).toEqual({ conciliado: true, ofx_transaction_id: T["F8-T1"] });
    expect(await transacaoLida(T["F8-T1"]!)).toEqual({ status: "matched", bank_movement_id: M1 });
    for (const m of [M2, M3, M4, M6]) expect((await movimentoLido(m)).conciliado, "só o encontrado é automático").toBe(false);
    expect(await situacaoDaImportacao(IMPORTACAO)).toBe("reconciling");
    // A importação recebe ID Global e aparece na lista paginada com as contagens.
    const lista = await get(`/api/financeiro/conciliacao/importacoes?conta_id=${CONTA}`);
    expect(lista.statusCode, lista.body).toBe(200);
    expect(j(lista)["idGlobal"]).toMatchObject({ tipoEntidade: "ofx_imports" });
    expect((j(lista)["itens"] as Record<string, unknown>[])[0]).toMatchObject({ id: IMPORTACAO, transacoes: 5, conciliadas: 1, ignoradas: 0, pendentes: 4, situacao: "reconciling" });
    expect((j(lista)["itens"] as Record<string, unknown>[])[0]!["id_global"]).not.toBeNull();
  });

  it("o detalhe traz as sugestões do domínio: sugestão, soma de vários e sem sugestão", async () => {
    const r = await get(`/api/financeiro/conciliacao/importacoes/${IMPORTACAO}`);
    expect(r.statusCode, r.body).toBe(200);
    const tr = (j(r)["transacoes"] as { fitid: string; situacao: string; movimentos: { id: string }[]; sugestao: { tipo: string; grupos: { id: string }[][] } | null }[]);
    const por = Object.fromEntries(tr.map((t) => [t.fitid, t]));
    expect(por["F8-T1"]).toMatchObject({ situacao: "matched", sugestao: null });
    expect(por["F8-T1"]!.movimentos.map((m) => m.id)).toEqual([M1]);
    expect(por["F8-T2"]!.sugestao!.tipo).toBe("sugestao");
    expect(por["F8-T2"]!.sugestao!.grupos.map((g) => g.map((m) => m.id))).toEqual([[M2]]);
    expect(por["F8-T3"]!.sugestao!.tipo).toBe("soma");
    expect(por["F8-T3"]!.sugestao!.grupos.map((g) => g.map((m) => m.id))).toEqual([[M3, M4]]);
    expect(por["F8-T4"]!.sugestao).toEqual({ tipo: "nenhuma", grupos: [] });
    expect(por["F8-T5"]!.sugestao).toEqual({ tipo: "nenhuma", grupos: [] });
  });

  it("confirma a sugestão e a soma: a marca vai para cada movimento; a transação guarda o de menor código", async () => {
    const a = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T2"]}/confirmar`, { movimento_ids: [M2] });
    expect(a.statusCode, a.body).toBe(200);
    expect(await movimentoLido(M2)).toEqual({ conciliado: true, ofx_transaction_id: T["F8-T2"] });
    const b = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T3"]}/confirmar`, { movimento_ids: [M4, M3] });
    expect(b.statusCode, b.body).toBe(200);
    expect(await movimentoLido(M3)).toEqual({ conciliado: true, ofx_transaction_id: T["F8-T3"] });
    expect(await movimentoLido(M4)).toEqual({ conciliado: true, ofx_transaction_id: T["F8-T3"] });
    expect(await transacaoLida(T["F8-T3"]!)).toEqual({ status: "matched", bank_movement_id: M3 });
  });

  it("soma errada → 422 com os dois valores; movimento de OUTRA conta → 404; já conciliada → 409 — e nada muda", async () => {
    const errada = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T5"]}/confirmar`, { movimento_ids: [M6] });
    expect(errada.statusCode, errada.body).toBe(422);
    expect(j(errada).error!.message).toBe("A soma dos movimentos (R$ -30,00) difere do valor do extrato (R$ -12,00)");
    // Premissa: M5 existe, está confirmado e livre, com o MESMO valor da T5 — mas é de outra conta.
    expect((await admin.query("select 1 from erp.bank_movements where id=$1 and bank_account_id=$2 and amount=12 and reconciled_at is null", [M5, OUTRA_CONTA])).rowCount).toBe(1);
    const outra = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T5"]}/confirmar`, { movimento_ids: [M5] });
    expect(outra.statusCode, outra.body).toBe(404);
    expect(j(outra).error!.message).toBe("Movimento não encontrado");
    const ja = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T1"]}/confirmar`, { movimento_ids: [M6] });
    expect(ja.statusCode, ja.body).toBe(409);
    expect(j(ja).error!.message).toBe("Transação já conciliada ou ignorada: desfaça antes");
    expect((await movimentoLido(M6)).conciliado).toBe(false);
    expect((await movimentoLido(M5)).conciliado).toBe(false);
    expect((await transacaoLida(T["F8-T5"]!)).status).toBe("pending");
    const repetido = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T5"]}/confirmar`, { movimento_ids: [M6, M6] });
    expect(repetido.statusCode).toBe(422);
  });

  it("cria o lançamento pelo extrato (tarifa): movimento com origem 'ofx', rateio e já conciliado", async () => {
    const semEmpresa = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T4"]}/criar-lancamento`, { empresa_id: null, rateio: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: 100 }] });
    expect(semEmpresa.statusCode).toBe(422);
    const r = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T4"]}/criar-lancamento`, {
      empresa_id: I.empresa, rateio: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: 100 }], observacao: "Tarifa do pacote"
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = String(j(r)["movimento_id"]);
    const m = await admin.query<{ source_type: string; source_id: string; type: string; amount: string; bank_account_id: string; conciliado: boolean; ofx_transaction_id: string; note: string }>(
      "select source_type, source_id, type, amount::text, bank_account_id, reconciled_at is not null as conciliado, ofx_transaction_id, note from erp.bank_movements where id=$1", [id]);
    expect(m.rows[0]).toEqual({ source_type: "ofx", source_id: T["F8-T4"], type: "out", amount: "33.33", bank_account_id: CONTA, conciliado: true, ofx_transaction_id: T["F8-T4"], note: "Tarifa do pacote" });
    const rateio = await admin.query<{ financial_category_id: string; amount: string }>("select financial_category_id, amount::text from erp.bank_movement_apportionments where movement_id=$1", [id]);
    expect(rateio.rows).toEqual([{ financial_category_id: I.category, amount: "33.33" }]);
    expect(await transacaoLida(T["F8-T4"]!)).toEqual({ status: "matched", bank_movement_id: id });
  });

  it("ignorar a última pendente deixa a importação CONCILIADA", async () => {
    expect(await situacaoDaImportacao(IMPORTACAO)).toBe("reconciling");
    const r = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T5"]}/ignorar`, { motivo: "Lançada por outro caminho" });
    expect(r.statusCode, r.body).toBe(200);
    expect((await transacaoLida(T["F8-T5"]!)).status).toBe("ignored");
    expect(await situacaoDaImportacao(IMPORTACAO)).toBe("reconciled");
    const outraVez = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T5"]}/ignorar`, {});
    expect(outraVez.statusCode).toBe(409);
  });

  it("desfazer: a soma volta a pendente e solta os movimentos; ignorada volta a pendente; pendente → 409", async () => {
    const semMotivo = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T3"]}/desfazer`, {});
    expect(semMotivo.statusCode).toBe(422);
    const r = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T3"]}/desfazer`, { motivo: "Vinculado errado" });
    expect(r.statusCode, r.body).toBe(200);
    expect(await transacaoLida(T["F8-T3"]!)).toEqual({ status: "pending", bank_movement_id: null });
    expect(await movimentoLido(M3)).toEqual({ conciliado: false, ofx_transaction_id: null });
    expect(await movimentoLido(M4)).toEqual({ conciliado: false, ofx_transaction_id: null });
    expect(await situacaoDaImportacao(IMPORTACAO)).toBe("reconciling");
    const trilha = await admin.query<{ metadata: { motivo: string } }>("select metadata from erp.audit_logs where entity='ofx_transactions' and entity_id=$1 and action='unreconcile'", [T["F8-T3"]]);
    expect(trilha.rows.map((x) => x.metadata.motivo)).toEqual(["Vinculado errado"]);
    const ignorada = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T5"]}/desfazer`, { motivo: "Revisar" });
    expect(ignorada.statusCode, ignorada.body).toBe(200);
    expect((await transacaoLida(T["F8-T5"]!)).status).toBe("pending");
    const nada = await post(`/api/financeiro/conciliacao/transacoes/${T["F8-T5"]}/desfazer`, { motivo: "De novo" });
    expect(nada.statusCode).toBe(409);
    expect(j(nada).error!.message).toBe("Nada a desfazer");
  });

  it("vincular à mão: os candidatos são da conta, do mesmo sinal, livres, os mais próximos primeiro", async () => {
    // Premissas: M1 é ENTRADA e livre (sinal oposto ao da T5); M2 está conciliado; M5 tem o valor da T5, mas é de outra conta.
    expect(await movimentoLido(M2)).toMatchObject({ conciliado: true });
    expect((await admin.query("select 1 from erp.bank_movements where id=$1 and type='in' and reconciled_at is not null", [M1])).rowCount).toBe(1);
    const r = await get(`/api/financeiro/conciliacao/transacoes/${T["F8-T5"]}/candidatos`);
    expect(r.statusCode, r.body).toBe(200);
    // T5 é de 22/05: M6 (21/05), M4 (16/05), M3 (15/05) — soltos pelo "desfazer" acima.
    expect(((j(r)["itens"]) as { id: string; valor: string }[]).map((x) => [x.id, x.valor])).toEqual([[M6, "-30.00"], [M4, "-60.00"], [M3, "-40.00"]]);
    expect(j(r)["total"]).toBe(3);
    const pagina2 = await get(`/api/financeiro/conciliacao/transacoes/${T["F8-T5"]}/candidatos?pageSize=1&page=2`);
    expect(((j(pagina2)["itens"]) as { id: string }[]).map((x) => x.id)).toEqual([M4]);
    const busca = await get(`/api/financeiro/conciliacao/transacoes/${T["F8-T5"]}/candidatos?busca=F8C0004`);
    expect(((j(busca)["itens"]) as { id: string }[]).map((x) => x.id), "busca pelo código do movimento").toEqual([M4]);
  });

  it("segunda importação: FITID já importado nesta conta não entra (duplicadas); '1.234,56' vira 1234.56", async () => {
    const r = await importar(CONTA, ofx("0001234-5", [{ fitid: "F8-T1", data: "20310510", valor: "150,00" }, { fitid: "F8-T6", data: "20310525", valor: "1.234,56" }]));
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r)).toMatchObject({ transacoes: 1, duplicadas: 1, recusadas: [], conciliadas_automaticamente: 0 });
    const t6 = await admin.query<{ fitid: string; amount: string }>("select fitid, amount::text from erp.ofx_transactions where import_id=$1", [j(r)["id"]]);
    expect(t6.rows).toEqual([{ fitid: "F8-T6", amount: "1234.56" }]);
    const tudoRepetido = await importar(CONTA, ofx("0001234-5", [{ fitid: "F8-T6", data: "20310525", valor: "1.234,56" }]));
    expect(tudoRepetido.statusCode).toBe(422);
  });
});

describe("a conta da importação é validada", () => {
  it("ACCTID de outra conta → 422 com a conta do arquivo, e nada importado", async () => {
    const antes = await importacoesDa(CONTA);
    const r = await importar(CONTA, ofx("9999-0", [{ fitid: "X-1", data: "20310510", valor: "1,00" }]));
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.message).toBe("O arquivo OFX é de outra conta (conta do arquivo: 9999-0).");
    expect(await importacoesDa(CONTA)).toBe(antes);
  });

  it("conta inativa ou de outra organização → a mesma 422 'Conta bancária inválida'", async () => {
    // Premissas: as duas existem, com o MESMO número de conta do arquivo.
    expect((await admin.query("select 1 from erp.bank_accounts where id=$1 and not is_active", [INATIVA])).rowCount).toBe(1);
    expect((await admin.query("select 1 from erp.bank_accounts where id=$1 and organization_id=$2", [CONTA_ALHEIA, OUTRA_ORG])).rowCount).toBe(1);
    for (const c of [INATIVA, CONTA_ALHEIA]) {
      const r = await importar(c, ofx("0001234-5", [{ fitid: "Y-1", data: "20310510", valor: "1,00" }]));
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error!.message).toBe("Conta bancária inválida");
      expect(await importacoesDa(c)).toBe(0);
    }
  });

  it("nenhuma transação válida → 422", async () => {
    const r = await importar(CONTA, ofx("0001234-5", [{ fitid: "Z-1", data: "20319999", valor: "1,00" }]));
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.message).toBe("Nenhuma transação válida no arquivo OFX");
  });
});

describe("a MESMA 404 para transação malformada, inexistente ou de outra organização", () => {
  it("confirmar, candidatos, ignorar e desfazer", async () => {
    const impAlheia = (await admin.query<{ id: string }>(
      "insert into erp.ofx_imports(organization_id,code,description,bank_account_id,start_date,end_date) values ($1,'9001','Alheia',$2,'2031-05-01','2031-05-01') returning id", [OUTRA_ORG, CONTA_ALHEIA])).rows[0]!.id;
    const tAlheia = (await admin.query<{ id: string }>(
      "insert into erp.ofx_transactions(import_id,organization_id,fitid,posted_date,amount,status) values ($1,$2,'AL-1','2031-05-01',10,'pending') returning id", [impAlheia, OUTRA_ORG])).rows[0]!.id;
    for (const tid of ["nao-e-uuid", "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a", tAlheia]) {
      for (const [metodo, sufixo, corpo] of [["POST", "confirmar", { movimento_ids: [M6] }], ["GET", "candidatos", undefined], ["POST", "ignorar", {}], ["POST", "desfazer", { motivo: "x" }]] as const) {
        const r = await h.app.inject({ method: metodo, url: `/api/financeiro/conciliacao/transacoes/${tid}/${sufixo}`, payload: corpo, headers: h.headers() });
        expect(r.statusCode, `${tid} ${sufixo}: ${r.body}`).toBe(404);
        expect(j(r).error!.message).toBe("Transação não encontrada");
      }
    }
    expect((await transacaoLida(tAlheia)).status).toBe("pending");
    const importacaoAlheia = await get(`/api/financeiro/conciliacao/importacoes/${impAlheia}`);
    expect(importacaoAlheia.statusCode).toBe(404);
  });
});
