import { describe, it, expect } from "vitest";
import { parseOfx } from "../../src/routes/financial.js";
import { fromPgError } from "../../src/lib/errors.js";
describe("parser OFX", () => {
  it("lê transações SGML", () => {
    const ofx = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260901120000[-3:BRT]<TRNAMT>-150.50<FITID>A1<MEMO>PAGTO FORNECEDOR</STMTTRN>\n<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260902<TRNAMT>1000.00<FITID>A2<NAME>DEPOSITO</STMTTRN>\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const t = parseOfx(ofx);
    // O valor sai como TEXTO decimal com sinal (OPERACOES-01 F8): o parser antigo devolvia `number` (ponto flutuante).
    expect(t).toEqual([{ fitid: "A1", date: "2026-09-01", amount: "-150.50", memo: "PAGTO FORNECEDOR", checkNumber: null }, { fitid: "A2", date: "2026-09-02", amount: "1000.00", memo: "DEPOSITO", checkNumber: null }]);
  });
  it("lê vírgula decimal e milhar sem ponto flutuante, e deixa de fora a transação ilegível", () => {
    const ofx = `<OFX><STMTRS><BANKACCTFROM><BANKID>001<ACCTID>56789-0</BANKACCTFROM><BANKTRANLIST>\n<STMTTRN><DTPOSTED>20260903<TRNAMT>1.234,56<FITID>B1</STMTTRN>\n<STMTTRN><DTPOSTED>20260903<TRNAMT>abc<FITID>B2</STMTTRN>\n</BANKTRANLIST></STMTRS></OFX>`;
    const t = parseOfx(ofx);
    // premissa: o texto "1.234,56" virava NaN no parser antigo (`Number("1.234.56")`)
    expect(Number("1.234,56".replace(",", "."))).toBeNaN();
    expect(t).toEqual([{ fitid: "B1", date: "2026-09-03", amount: "1234.56", memo: null, checkNumber: null }]);
  });
});
describe("mapeamento de erros do Postgres", () => {
  it("converte RAISE EXCEPTION com código de domínio", () => { expect(fromPgError({ code: "P0001", message: "INSUFFICIENT_STOCK: saldo 1 < 2" })?.code).toBe("INSUFFICIENT_STOCK"); expect(fromPgError({ code: "23505" })?.code).toBe("CONFLICT"); expect(fromPgError({ code: "42501" })?.code).toBe("PERMISSION_DENIED"); expect(fromPgError(new Error("x"))).toBeNull(); });
});
