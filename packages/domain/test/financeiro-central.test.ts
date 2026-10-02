import { describe, it, expect } from "vitest";
import { D, DomainError } from "@agro/shared";
import * as dominio from "../src/index.js";
import { settlementNet } from "../src/financial.js";
import {
  CAPACIDADE_CENTRAL_FINANCEIRA, entendeCentralFinanceira,
  SITUACOES_TITULO, situacaoDoTitulo, CARTOES_TITULO, ORIGENS_DO_TITULO, grupoDaOrigem, tituloDeDocumento, CAMPOS_TRAVADOS_PELA_ORIGEM,
  alteracoesTravadasPelaOrigem, type TituloComparavel,
  diferencaDoRateio, exigirRateioFechado, ratearPorProporcao,
  conferirValoresDaBaixa, COMPONENTES_BAIXA, chaveDaNaturezaPadrao, NATUREZA_ESPERADA, type ComponenteBaixa,
  valorDoOfx, lerOfx, contaDoOfxConfere, MIN_DIGITOS_DO_SUFIXO_DA_CONTA, sugerirConciliacao, type MovimentoCandidato,
  inicioDoPeriodo, periodosDoIntervalo, GRUPOS_DRE, grupoDreDasNaturezas, montarDre, type NaturezaParaDre,
  ROTULOS_FINANCEIRO, rotuloFinanceiro, rotuloDoCartaoBaixados, TOM_DA_SITUACAO_TITULO
} from "../src/financeiro-central.js";

/** Executa e devolve o DomainError lançado (falha o teste se nada for lançado ou se o erro for de outro tipo). */
function erroDe(f: () => unknown): DomainError {
  try {
    f();
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error("esperava um DomainError e nada foi lançado");
}

describe("barril da Central Financeira", () => {
  it("index.ts exporta o domínio novo pelo barril (uma linha só)", () => {
    expect(typeof dominio.conferirValoresDaBaixa).toBe("function");
    expect(dominio.ROTULOS_FINANCEIRO).toBe(ROTULOS_FINANCEIRO);
    expect(dominio.CAPACIDADE_CENTRAL_FINANCEIRA).toBe(1);
  });
});

describe("capacidade da Central Financeira", () => {
  it("só a forma e a versão exatas ligam a Central; o resto é a tela de hoje", () => {
    expect(CAPACIDADE_CENTRAL_FINANCEIRA).toBe(1);
    expect(entendeCentralFinanceira({ centralFinanceira: 1 })).toBe(true);
    expect(entendeCentralFinanceira({ centralFinanceira: 1, outra: true })).toBe(true);
    for (const r of [{ centralFinanceira: 2 }, { centralFinanceira: "1" }, null, undefined, {}, [], 1, "1", { central: 1 }]) {
      expect(entendeCentralFinanceira(r)).toBe(false);
    }
  });
});

describe("situação do título", () => {
  const hoje = "2026-10-02";
  it("aberto é calculado pela data: vencido antes de hoje; vencendo hoje ou depois é a vencer", () => {
    expect("2026-10-01" < hoje).toBe(true);
    expect(situacaoDoTitulo({ status: "open", dueDate: "2026-10-01" }, hoje)).toBe("vencido");
    expect(situacaoDoTitulo({ status: "open", dueDate: hoje }, hoje)).toBe("a_vencer");
    expect(situacaoDoTitulo({ status: "open", dueDate: "2026-10-03" }, hoje)).toBe("a_vencer");
    // data-hora vinda do banco é lida pelos 10 primeiros caracteres
    expect(situacaoDoTitulo({ status: "open", dueDate: "2026-10-01T00:00:00.000Z" }, hoje)).toBe("vencido");
  });
  it("parcial, baixado, previsto e cancelado vêm do status gravado (parcial vencido continua parcial)", () => {
    expect(situacaoDoTitulo({ status: "partially_paid", dueDate: "2026-01-01" }, hoje)).toBe("parcial");
    expect(situacaoDoTitulo({ status: "paid", dueDate: "2026-01-01" }, hoje)).toBe("baixado");
    expect(situacaoDoTitulo({ status: "previsto", dueDate: "2026-12-01" }, hoje)).toBe("previsto");
    expect(situacaoDoTitulo({ status: "cancelled", dueDate: "2026-01-01" }, hoje)).toBe("cancelado");
  });
  it("status desconhecido é erro, nunca \"a vencer\"", () => {
    const e = erroDe(() => situacaoDoTitulo({ status: "aberto", dueDate: "2026-12-01" }, hoje));
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.message).toBe("Situação de título desconhecida");
  });
  it("cada situação e cada cartão têm rótulo e cada situação tem tom central", () => {
    expect(Object.keys(ROTULOS_FINANCEIRO.situacao_titulo)).toEqual([...SITUACOES_TITULO]);
    expect(Object.keys(ROTULOS_FINANCEIRO.cartao_titulo)).toEqual([...CARTOES_TITULO]);
    expect(Object.keys(TOM_DA_SITUACAO_TITULO).sort()).toEqual([...SITUACOES_TITULO].sort());
    expect(TOM_DA_SITUACAO_TITULO).toEqual({ a_vencer: "info", vencido: "negative", parcial: "warning", baixado: "positive", previsto: "neutral", cancelado: "neutral" });
  });
});

describe("origem do título", () => {
  it("nulo e manual são avulsos; cada source_type cai no seu grupo; desconhecido é outros", () => {
    expect(grupoDaOrigem(null)).toBe("avulso");
    expect(grupoDaOrigem(undefined)).toBe("avulso");
    expect(grupoDaOrigem("manual")).toBe("avulso");
    for (const [grupo, tipos] of Object.entries(ORIGENS_DO_TITULO)) {
      expect(tipos.length).toBeGreaterThan(0);
      for (const t of tipos) expect(grupoDaOrigem(t)).toBe(grupo);
    }
    expect(grupoDaOrigem("sales_documents")).toBe("venda");
    expect(grupoDaOrigem("dfe_documents")).toBe("nota");
    expect(grupoDaOrigem("contratos")).toBe("outros");
    expect(Object.keys(ROTULOS_FINANCEIRO.origem_titulo)).toEqual([...Object.keys(ORIGENS_DO_TITULO), "outros"]);
  });
  it("título de documento é o que tem origem e não é manual", () => {
    expect(tituloDeDocumento(null)).toBe(false);
    expect(tituloDeDocumento(undefined)).toBe(false);
    expect(tituloDeDocumento("manual")).toBe(false);
    expect(tituloDeDocumento("sales_documents")).toBe(true);
    expect(tituloDeDocumento("algo_novo")).toBe(true);
  });
});

describe("campos travados pela origem", () => {
  const atual: TituloComparavel = {
    empresa_id: "0f6b8a3e-1111-4c4c-9d9d-aaaaaaaaaaaa",
    number: "000123",
    person_id: "7c1d2e3f-2222-4c4c-9d9d-bbbbbbbbbbbb",
    amount: "100.00",
    discount: "0.00",
    emission_date: "2026-09-01",
    apportionment: [
      { financial_category_id: "c1", cost_center_id: "cc1", chart_account_id: null, harvest_id: null, area_id: null, percentage: "60.0000", amount: "60.00" },
      { financial_category_id: "c2", cost_center_id: "cc2", chart_account_id: null, harvest_id: "s1", area_id: null, percentage: "40.0000", amount: "40.00" }
    ]
  };
  const igualEmOutraForma = {
    empresa_id: atual.empresa_id.toUpperCase(),
    number: "000123",
    person_id: atual.person_id!.toUpperCase(),
    amount: "100",
    discount: "0",
    emission_date: "2026-09-01T00:00",
    due_date: "2026-12-01",
    apportionment: [
      { financial_category_id: "C2", cost_center_id: "CC2", harvest_id: "S1", percentage: "40" },
      { financial_category_id: "c1", cost_center_id: "cc1", percentage: "60.0" }
    ]
  };
  it("o corpo inteiro da web anterior, com os mesmos valores em outra forma, não altera nada", () => {
    expect(igualEmOutraForma.amount).not.toBe(atual.amount);
    expect(igualEmOutraForma.emission_date).not.toBe(atual.emission_date);
    expect(alteracoesTravadasPelaOrigem(atual, igualEmOutraForma)).toEqual([]);
    const porValor = { ...igualEmOutraForma, apportionment: [{ financial_category_id: "c2", cost_center_id: "cc2", harvest_id: "s1", amount: "40" }, { financial_category_id: "c1", cost_center_id: "cc1", amount: "60.0" }] };
    expect(alteracoesTravadasPelaOrigem(atual, porValor)).toEqual([]);
  });
  it("campos ausentes do pedido não contam (vencimento e observação ficam livres)", () => {
    expect(alteracoesTravadasPelaOrigem(atual, { due_date: "2027-01-01", note: "nova", conta_prevista_id: "x" })).toEqual([]);
    expect(alteracoesTravadasPelaOrigem(atual, { amount: undefined })).toEqual([]);
  });
  it("valor, parceiro e rateio diferentes são listados, na ordem dos campos travados", () => {
    const pedido = { ...igualEmOutraForma, amount: "150", person_id: "outra-pessoa", apportionment: [{ financial_category_id: "c1", cost_center_id: "cc1", percentage: "50" }, { financial_category_id: "c2", cost_center_id: "cc2", harvest_id: "s1", percentage: "50" }] };
    expect(alteracoesTravadasPelaOrigem(atual, pedido)).toEqual(["person_id", "amount", "apportionment"]);
    expect(alteracoesTravadasPelaOrigem(atual, { emission_date: "2026-09-02", empresa_id: "outra", number: "124", discount: "1" })).toEqual(["empresa_id", "number", "discount", "emission_date"]);
    expect([...CAMPOS_TRAVADOS_PELA_ORIGEM]).toEqual(["empresa_id", "number", "person_id", "amount", "discount", "emission_date", "apportionment"]);
  });
  it("rateio é multiconjunto: trocar a safra de uma linha, repetir linha ou mandar texto inválido é alteração", () => {
    expect(alteracoesTravadasPelaOrigem(atual, { apportionment: [{ financial_category_id: "c1", cost_center_id: "cc1", percentage: "60" }, { financial_category_id: "c2", cost_center_id: "cc2", percentage: "40" }] })).toEqual(["apportionment"]);
    expect(alteracoesTravadasPelaOrigem(atual, { apportionment: [{ financial_category_id: "c1", cost_center_id: "cc1", percentage: "60" }, { financial_category_id: "c1", cost_center_id: "cc1", percentage: "40" }] })).toEqual(["apportionment"]);
    expect(alteracoesTravadasPelaOrigem(atual, { apportionment: null, amount: "abc" })).toEqual(["amount", "apportionment"]);
  });
});

describe("rateio em R$ que fecha em zero", () => {
  it("fecha: diferença zero não lança", () => {
    expect(diferencaDoRateio("100.00", ["60", 40])).toBe("0.00");
    expect(() => exigirRateioFechado("100.00", [{ amount: "60.00" }, { amount: 40 }])).not.toThrow();
  });
  it("sobra: soma maior que o título é recusada com a diferença", () => {
    expect(diferencaDoRateio("100.00", ["60", "50"])).toBe("-10.00");
    const e = erroDe(() => exigirRateioFechado("100.00", [{ amount: "60" }, { amount: "50" }]));
    expect(e.code).toBe("APPORTIONMENT_MISMATCH");
    expect(e.message).toBe("O rateio soma R$ 110.00 e o título vale R$ 100.00: ajuste R$ 10.00 para fechar.");
    expect(e.details).toEqual({ total: "100.00", soma: "110.00", diferenca: "-10.00" });
  });
  it("falta: soma menor (mesmo por um centavo) é recusada", () => {
    expect(diferencaDoRateio("100.00", ["99.99"])).toBe("0.01");
    const e = erroDe(() => exigirRateioFechado("100.00", [{ amount: "99.99" }]));
    expect(e.code).toBe("APPORTIONMENT_MISMATCH");
    expect(e.message).toBe("O rateio soma R$ 99.99 e o título vale R$ 100.00: ajuste R$ 0.01 para fechar.");
    expect(e.details).toEqual({ total: "100.00", soma: "99.99", diferenca: "0.01" });
  });
  it("linha sem valor é recusada antes da soma", () => {
    for (const vazio of [undefined, null, ""]) {
      const e = erroDe(() => exigirRateioFechado("100.00", [{ amount: "100" }, { amount: vazio }]));
      expect(e.code).toBe("VALIDATION_ERROR");
      expect(e.message).toBe("Informe o valor de cada linha do rateio");
    }
    expect(erroDe(() => exigirRateioFechado("100.00", [{}])).message).toBe("Informe o valor de cada linha do rateio");
  });
  it("ratear por proporção: soma exata, resíduo na última linha e os outros campos preservados", () => {
    const base = [{ amount: "100", natureza: "a" }, { amount: "100", natureza: "b" }, { amount: "100", natureza: "c" }];
    const r = ratearPorProporcao("100.00", base);
    expect(r.map((l) => l.amount)).toEqual(["33.33", "33.33", "33.34"]);
    expect(r.map((l) => l.natureza)).toEqual(["a", "b", "c"]);
    expect(D(r[0]!.amount).plus(r[1]!.amount).plus(r[2]!.amount).toFixed(2)).toBe("100.00");
    const desigual = ratearPorProporcao("10.01", [{ amount: "60" }, { amount: "40" }]);
    expect(desigual.map((l) => l.amount)).toEqual(["6.01", "4.00"]);
    expect(ratearPorProporcao("0", base).map((l) => l.amount)).toEqual(["0.00", "0.00", "0.00"]);
  });
  it("ratear por proporção sem base (vazia ou soma zero) é recusado", () => {
    expect(erroDe(() => ratearPorProporcao("10.00", [])).message).toBe("Rateio base vazio");
    const e = erroDe(() => ratearPorProporcao("10.00", [{ amount: "0" }, { amount: "0.00" }]));
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.message).toBe("Rateio base vazio");
  });
});

describe("baixa na semântica B", () => {
  it("erros na ordem: valor não positivo vem antes de componente negativo", () => {
    const e = erroDe(() => conferirValoresDaBaixa("100.00", { valor: "0", juros: "-1" }));
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.message).toBe("Valor baixado deve ser positivo");
    expect(erroDe(() => conferirValoresDaBaixa("100.00", { valor: "-5" })).message).toBe("Valor baixado deve ser positivo");
  });
  it("erros na ordem: componente negativo vem antes de desconto maior que o valor", () => {
    for (const campo of ["desconto", "juros", "multa", "acrescimo", "tarifa"] as const) {
      const e = erroDe(() => conferirValoresDaBaixa("100.00", { valor: "10", desconto: "20", [campo]: "-0.01" }));
      expect(e.message).toBe("Juros, multa, acréscimo, desconto e tarifa não podem ser negativos");
    }
  });
  it("erros na ordem: desconto maior que o valor vem antes do excedente com desconto", () => {
    const e = erroDe(() => conferirValoresDaBaixa("100.00", { valor: "10", desconto: "10.01", excedente: "credito" }));
    expect(e.message).toBe("O desconto não pode ser maior que o valor baixado");
  });
  it("erros na ordem: excedente com desconto vem antes de exceder o saldo", () => {
    const e = erroDe(() => conferirValoresDaBaixa("100.00", { valor: "150", desconto: "1", excedente: "credito" }));
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.message).toBe("O excedente só vira crédito sem desconto");
  });
  it("valor acima do saldo sem excedente é PAYMENT_EXCEEDS_BALANCE", () => {
    const e = erroDe(() => conferirValoresDaBaixa("100.00", { valor: "100.01" }));
    expect(e.code).toBe("PAYMENT_EXCEEDS_BALANCE");
    expect(e.message).toBe("Valor baixado excede o saldo do título");
    expect(e.details).toEqual({ saldo: "100.00", valor: "100.01" });
  });
  it("deixar o saldo em aberto: valor menor que o saldo, sem desconto, baixa só o valor", () => {
    const b = conferirValoresDaBaixa("1000.00", { valor: "400" });
    expect(D(b.aplicado).lt("1000")).toBe(true);
    expect(b).toMatchObject({ aplicado: "400.00", desconto: "0.00", credito: "0.00", liquidoPrincipal: "400.00", liquidoTotal: "400.00" });
  });
  it("dar como desconto: valor = saldo com desconto quita o título e o caixa é saldo − desconto", () => {
    const b = conferirValoresDaBaixa("1000.00", { valor: "1000", desconto: "50" });
    expect(b.aplicado).toBe("1000.00");
    expect(b.liquidoPrincipal).toBe("950.00");
    expect(b.credito).toBe("0.00");
  });
  it("o desconto é abatido UMA vez: título cai o valor, caixa + desconto = valor (o defeito sumia com 50)", () => {
    const b = conferirValoresDaBaixa("1000.00", { valor: "550", desconto: "50" });
    expect(b.aplicado).toBe("550.00");
    expect(b.liquidoPrincipal).toBe("500.00");
    expect(D(b.liquidoPrincipal).plus(b.desconto).eq(b.aplicado)).toBe(true);
  });
  it("excedente vira crédito: quita pelo saldo e devolve o excedente; sem excedente de fato, crédito zero", () => {
    const b = conferirValoresDaBaixa("1000.00", { valor: "1200", excedente: "credito" });
    expect(D("1200").gt("1000")).toBe(true);
    expect(b).toMatchObject({ aplicado: "1000.00", credito: "200.00", liquidoPrincipal: "1200.00", liquidoTotal: "1200.00" });
    const semSobra = conferirValoresDaBaixa("1000.00", { valor: "300", excedente: "credito" });
    expect(semSobra).toMatchObject({ aplicado: "300.00", credito: "0.00", liquidoPrincipal: "300.00" });
  });
  it("juros, multa, acréscimo e ajuste entram no líquido total; a tarifa fica fora", () => {
    const semTarifa = conferirValoresDaBaixa("500.00", { valor: "500", desconto: "10", juros: "3", multa: "2", acrescimo: "1", ajusteCambial: "-0.50" });
    const comTarifa = conferirValoresDaBaixa("500.00", { valor: "500", desconto: "10", juros: "3", multa: "2", acrescimo: "1", ajusteCambial: "-0.50", tarifa: "7.90" });
    expect(comTarifa.tarifa).toBe("7.90");
    expect(semTarifa.liquidoTotal).toBe("495.50");
    expect(comTarifa.liquidoTotal).toBe(semTarifa.liquidoTotal);
    expect(comTarifa.liquidoTotal).toBe(settlementNet({ amount: "500", discount: "10", interest: "3", penalty: "2", increase: "1", exchangeAdjustment: "-0.50" }));
  });
  it("chave da natureza padrão: 8 combinações por direção e a tarifa sempre bancária", () => {
    const esperado: Record<string, [string, string]> = {
      juros: ["juros_pagos_id", "juros_recebidos_id"],
      multa: ["multa_paga_id", "multa_recebida_id"],
      acrescimo: ["acrescimo_pago_id", "acrescimo_recebido_id"],
      desconto: ["desconto_obtido_id", "desconto_concedido_id"],
      tarifa: ["tarifa_bancaria_id", "tarifa_bancaria_id"]
    };
    expect([...COMPONENTES_BAIXA]).toEqual(["juros", "multa", "acrescimo", "tarifa"]);
    for (const componente of [...COMPONENTES_BAIXA, "desconto"] as const) {
      expect(chaveDaNaturezaPadrao(componente, "payable")).toBe(esperado[componente]![0]);
      expect(chaveDaNaturezaPadrao(componente, "receivable")).toBe(esperado[componente]![1]);
    }
    expect(erroDe(() => chaveDaNaturezaPadrao("ferias" as unknown as ComponenteBaixa, "payable")).code).toBe("VALIDATION_ERROR");
  });
  it("natureza esperada: pago e tarifa e desconto concedido são despesa; recebido e desconto obtido são receita", () => {
    expect(NATUREZA_ESPERADA).toEqual({
      juros_pagos_id: "expense", juros_recebidos_id: "income", multa_paga_id: "expense", multa_recebida_id: "income",
      acrescimo_pago_id: "expense", acrescimo_recebido_id: "income", desconto_obtido_id: "income", desconto_concedido_id: "expense",
      tarifa_bancaria_id: "expense"
    });
  });
});

describe("valor do OFX", () => {
  it("os exemplos do contrato", () => {
    expect(valorDoOfx("1.234,56")).toBe("1234.56");
    expect(valorDoOfx("-150,5")).toBe("-150.50");
    expect(valorDoOfx("1,234.56")).toBe("1234.56");
    expect(valorDoOfx("1000")).toBe("1000.00");
    expect(valorDoOfx("+20.1")).toBe("20.10");
    expect(valorDoOfx("1.234.567")).toBe("1234567.00");
  });
  it("os inválidos do contrato viram null (nunca um número adivinhado)", () => {
    for (const t of ["12.345", "1,2,3", "abc", "", "1.2.3"]) expect(valorDoOfx(t)).toBeNull();
  });
  it("espaços saem; sinal único; mais de 2 casas, milhar torto e sinal duplo viram null", () => {
    expect(valorDoOfx(" -1 234,56 ")).toBe("-1234.56");
    expect(valorDoOfx("-0,50")).toBe("-0.50");
    for (const t of ["1.234,567", "12.34,56", "--5", "+-5", "R$ 10", ".50", "10.", "1e3", "0x10"]) expect(valorDoOfx(t)).toBeNull();
  });
});

describe("leitura do OFX", () => {
  const sgml = [
    "OFXHEADER:100", "DATA:OFXSGML", "", "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL",
    "<BANKACCTFROM><BANKID>341<BRANCHID>1234<ACCTID>0012345-6<ACCTTYPE>CHECKING</BANKACCTFROM>",
    "<BANKTRANLIST><DTSTART>20260901<DTEND>20260930",
    "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260915120000[-3:BRT]<TRNAMT>-150,50<FITID>A1<CHECKNUM>77<MEMO>Tarifa pacote",
    "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260916<TRNAMT>1.234,56<FITID>A2<NAME>Cliente Silva",
    "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260917<TRNAMT>-10,00<MEMO>sem identificador",
    "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260231<TRNAMT>-10,00<FITID>A4",
    "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260918<TRNAMT>12.345<FITID>A5",
    "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260918<TRNAMT>0,00<FITID>A6",
    "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260919<TRNAMT>-5,00<FITID>A1",
    "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260919<FITID>A8",
    "</BANKTRANLIST><LEDGERBAL><BALAMT>999,99<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
  ].join("\n");
  it("SGML: conta, vírgula decimal, data com hora e fuso, MEMO ou NAME, cheque", () => {
    const r = lerOfx(sgml);
    expect(r.conta).toEqual({ banco: "341", agencia: "1234", conta: "0012345-6" });
    expect(r.transacoes).toEqual([
      { fitid: "A1", data: "2026-09-15", valor: "-150.50", memo: "Tarifa pacote", numeroCheque: "77" },
      { fitid: "A2", data: "2026-09-16", valor: "1234.56", memo: "Cliente Silva", numeroCheque: null }
    ]);
  });
  it("SGML: cada recusada vem com o motivo (nada some em silêncio)", () => {
    const r = lerOfx(sgml);
    expect(r.transacoes.length + r.recusadas.length).toBe(sgml.split("<STMTTRN>").length - 1);
    expect(r.recusadas).toEqual([
      { fitid: null, motivo: "Transação sem identificador (FITID)" },
      { fitid: "A4", motivo: "Data inválida" },
      { fitid: "A5", motivo: "Valor inválido no extrato: 12.345" },
      { fitid: "A6", motivo: "Valor zero" },
      { fitid: "A1", motivo: "Transação repetida no arquivo (mesmo FITID)" },
      { fitid: "A8", motivo: "Valor inválido no extrato: (vazio)" }
    ]);
  });
  it("XML: tags fechadas, ponto decimal e entidades no memorando", () => {
    const xml = `<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
      <BANKACCTFROM><BANKID>001</BANKID><BRANCHID>0001</BRANCHID><ACCTID>98765</ACCTID></BANKACCTFROM>
      <BANKTRANLIST>
        <STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261001</DTPOSTED><TRNAMT>2500.00</TRNAMT><FITID>X1</FITID><MEMO>Venda &amp; frete</MEMO></STMTTRN>
        <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261002</DTPOSTED><TRNAMT>-1,234.50</TRNAMT><FITID>X2</FITID></STMTTRN>
      </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const r = lerOfx(xml);
    expect(r.conta).toEqual({ banco: "001", agencia: "0001", conta: "98765" });
    expect(r.transacoes).toEqual([
      { fitid: "X1", data: "2026-10-01", valor: "2500.00", memo: "Venda & frete", numeroCheque: null },
      { fitid: "X2", data: "2026-10-02", valor: "-1234.50", memo: null, numeroCheque: null }
    ]);
    expect(r.recusadas).toEqual([]);
  });
  it("arquivo com extrato de outra conta: as transações dela são recusadas, não importadas na conta errada", () => {
    const doisExtratos = "<OFX><STMTRS><BANKACCTFROM><ACCTID>111</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20261001<TRNAMT>10,00<FITID>P1</BANKTRANLIST></STMTRS>"
      + "<STMTRS><BANKACCTFROM><ACCTID>222</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20261001<TRNAMT>20,00<FITID>Q1</BANKTRANLIST></STMTRS></OFX>";
    const r = lerOfx(doisExtratos);
    expect(r.conta.conta).toBe("111");
    expect(r.transacoes.map((t) => t.fitid)).toEqual(["P1"]);
    expect(r.recusadas).toEqual([{ fitid: "Q1", motivo: "Transação de outra conta do arquivo (conta 222)" }]);
  });
  it("conta do OFX confere: igual, com dígito ou zeros à esquerda, com agência antes; diferente; sem dígitos", () => {
    const conta = (c: string | null) => ({ banco: null, agencia: null, conta: c });
    expect(contaDoOfxConfere(conta("12345-6"), "123456")).toBe(true);
    expect(contaDoOfxConfere(conta("0012345-6"), "12345-6")).toBe(true);
    expect(contaDoOfxConfere(conta("1234/0012345-6"), "12345-6")).toBe(true);
    expect(contaDoOfxConfere(conta("98765"), "12345-6")).toBe(false);
    expect(contaDoOfxConfere(conta("000"), "123")).toBe(false);
    expect(contaDoOfxConfere(conta(null), "123")).toBeNull();
    expect(contaDoOfxConfere(conta("ABC"), "123")).toBeNull();
    expect(contaDoOfxConfere(conta("123"), null)).toBeNull();
  });
  it("conta do OFX: o 'termina com' exige ao menos 4 dígitos no lado curto — o cadastro '1' não casa com todo ACCTID terminado em 1", () => {
    const conta = (c: string | null) => ({ banco: null, agencia: null, conta: c });
    expect(MIN_DIGITOS_DO_SUFIXO_DA_CONTA).toBe(4);
    expect(contaDoOfxConfere(conta("98761"), "1"), "premissa: '98761' termina com '1', e não é a mesma conta").toBe(false);
    expect(contaDoOfxConfere(conta("1"), "98761")).toBe(false);
    expect(contaDoOfxConfere(conta("12345671"), "671")).toBe(false);
    expect(contaDoOfxConfere(conta("0001"), "1"), "iguais sem os zeros à esquerda continuam casando").toBe(true);
    expect(contaDoOfxConfere(conta("1234/5671"), "5671"), "4 dígitos: o sufixo vale (agência antes)").toBe(true);
  });
});

describe("sugestões de conciliação", () => {
  const mov = (id: string, data: string, valor: string): MovimentoCandidato => ({ id, data, valor });
  it("encontrado: um único movimento com o mesmo valor e a mesma data", () => {
    const r = sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "-150.50" }], [mov("m1", "2026-09-15", "-150.50"), mov("m2", "2026-09-15", "-150.00"), mov("m3", "2026-09-16", "-150.50")]);
    expect(r).toEqual([{ transacaoId: "t1", tipo: "encontrado", grupos: [["m1"]] }]);
  });
  it("dois exatos → sugestão, um grupo cada (decisão humana)", () => {
    const r = sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "100.00" }], [mov("mb", "2026-09-15", "100"), mov("ma", "2026-09-15", "100.00")]);
    expect(r).toEqual([{ transacaoId: "t1", tipo: "sugestao", grupos: [["ma"], ["mb"]] }]);
  });
  it("dois extratos iguais disputando um movimento: nenhum é \"encontrado\"", () => {
    const r = sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "100.00" }, { id: "t2", data: "2026-09-15", valor: "100.00" }], [mov("m1", "2026-09-15", "100.00")]);
    expect(r.map((s) => s.tipo)).toEqual(["sugestao", "sugestao"]);
    expect(r.map((s) => s.grupos)).toEqual([[["m1"]], [["m1"]]]);
  });
  it("±3 dias: mesmo valor na janela vira sugestão, pela distância, data e id", () => {
    const r = sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "100.00" }], [mov("m1", "2026-09-17", "100.00"), mov("m2", "2026-09-13", "100.00"), mov("m3", "2026-09-14", "100.00"), mov("m4", "2026-09-18", "100.00")]);
    expect(r).toEqual([{ transacaoId: "t1", tipo: "sugestao", grupos: [["m3"], ["m2"], ["m1"], ["m4"]] }]);
  });
  it("fora da janela: mesmo valor a 4 dias não sugere nada", () => {
    const r = sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "100.00" }], [mov("m1", "2026-09-19", "100.00"), mov("m2", "2026-09-11", "100.00")]);
    expect(r).toEqual([{ transacaoId: "t1", tipo: "nenhuma", grupos: [] }]);
  });
  it("soma de 2 e soma de 3, em centavos exatos (0,10 + 0,20 = 0,30)", () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    const dois = sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "0.30" }], [mov("a", "2026-09-15", "0.10"), mov("b", "2026-09-14", "0.20")]);
    expect(dois).toEqual([{ transacaoId: "t1", tipo: "soma", grupos: [["b", "a"]] }]);
    const tres = sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "600.00" }], [mov("a", "2026-09-15", "100.00"), mov("b", "2026-09-15", "200.00"), mov("c", "2026-09-16", "300.00")]);
    expect(tres).toEqual([{ transacaoId: "t1", tipo: "soma", grupos: [["a", "b", "c"]] }]);
  });
  it("soma: menos itens primeiro, depois menor distância total, depois ids; no máximo 3 grupos", () => {
    const movs = [mov("a", "2026-09-15", "200.00"), mov("b", "2026-09-15", "300.00"), mov("c", "2026-09-15", "100.00"), mov("d", "2026-09-17", "200.00"), mov("e", "2026-09-17", "400.00"), mov("f", "2026-09-15", "100.00")];
    const r = sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "500.00" }], movs);
    // pares: {a,b} Δ0, {b,d} Δ2, {e,c} Δ2, {e,f} Δ2; trios ficam de fora pelo teto de 3 grupos
    expect(r[0]!.tipo).toBe("soma");
    expect(r[0]!.grupos).toEqual([["a", "b"], ["b", "d"], ["c", "e"]]);
  });
  it("sinal oposto não soma; o mesmo sinal soma", () => {
    expect(sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "-300.00" }], [mov("a", "2026-09-15", "100.00"), mov("b", "2026-09-15", "200.00")])[0]!.tipo).toBe("nenhuma");
    const r = sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "-300.00" }], [mov("a", "2026-09-15", "-100.00"), mov("b", "2026-09-15", "200.00"), mov("c", "2026-09-15", "-200.00")]);
    expect(r[0]).toEqual({ transacaoId: "t1", tipo: "soma", grupos: [["a", "c"]] });
  });
  it("soma além do teto de itens (5 de 100 para 500) não é sugerida", () => {
    const movs = ["a", "b", "c", "d", "e"].map((id) => mov(id, "2026-09-15", "100.00"));
    expect(sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "500.00" }], movs)[0]!.tipo).toBe("nenhuma");
    expect(sugerirConciliacao([{ id: "t1", data: "2026-09-15", valor: "500.00" }], movs, { maxItensSoma: 5 })[0]!.grupos).toEqual([["a", "b", "c", "d", "e"]]);
  });
  it("determinística: duas chamadas e a ordem invertida dos movimentos dão a mesma saída", () => {
    const tx = [{ id: "t1", data: "2026-09-15", valor: "500.00" }, { id: "t2", data: "2026-09-16", valor: "200.00" }, { id: "t3", data: "2026-09-20", valor: "-1.00" }];
    const movs = [mov("a", "2026-09-15", "200.00"), mov("b", "2026-09-15", "300.00"), mov("c", "2026-09-17", "200.00"), mov("d", "2026-09-16", "100.00"), mov("e", "2026-09-14", "100.00")];
    const primeira = sugerirConciliacao(tx, movs);
    expect(sugerirConciliacao(tx, movs)).toEqual(primeira);
    expect(sugerirConciliacao(tx, movs.slice().reverse())).toEqual(primeira);
    expect(primeira.map((s) => s.transacaoId)).toEqual(["t1", "t2", "t3"]);
  });
  it("opções fora da faixa são recusadas (sem busca explosiva)", () => {
    expect(erroDe(() => sugerirConciliacao([], [], { maxCandidatosSoma: 100 })).code).toBe("VALIDATION_ERROR");
    expect(erroDe(() => sugerirConciliacao([], [], { janelaDias: 1.5 })).code).toBe("VALIDATION_ERROR");
    expect(sugerirConciliacao([], [], { janelaDias: 0 })).toEqual([]);
  });
});

describe("períodos do fluxo", () => {
  it("início do período: o dia, a segunda-feira ISO e o dia 1", () => {
    expect(new Date("2026-10-01T00:00:00Z").getUTCDay()).toBe(4); // quinta
    expect(inicioDoPeriodo("2026-10-01", "dia")).toBe("2026-10-01");
    expect(inicioDoPeriodo("2026-10-01", "semana")).toBe("2026-09-28");
    expect(new Date("2026-10-04T00:00:00Z").getUTCDay()).toBe(0); // domingo fecha a semana ISO
    expect(inicioDoPeriodo("2026-10-04", "semana")).toBe("2026-09-28");
    expect(inicioDoPeriodo("2026-09-28", "semana")).toBe("2026-09-28");
    expect(inicioDoPeriodo("2026-10-01T15:00:00Z", "mes")).toBe("2026-10-01");
    expect(inicioDoPeriodo("2026-02-28", "mes")).toBe("2026-02-01");
  });
  it("por dia, semana e mês: períodos inteiros e contíguos que cobrem o intervalo", () => {
    expect(periodosDoIntervalo("2026-09-29", "2026-10-01", "dia")).toEqual([
      { inicio: "2026-09-29", fim: "2026-09-29" }, { inicio: "2026-09-30", fim: "2026-09-30" }, { inicio: "2026-10-01", fim: "2026-10-01" }
    ]);
    expect(periodosDoIntervalo("2026-10-01", "2026-10-12", "semana")).toEqual([
      { inicio: "2026-09-28", fim: "2026-10-04" }, { inicio: "2026-10-05", fim: "2026-10-11" }, { inicio: "2026-10-12", fim: "2026-10-18" }
    ]);
    expect(periodosDoIntervalo("2026-01-15", "2026-03-02", "mes")).toEqual([
      { inicio: "2026-01-01", fim: "2026-01-31" }, { inicio: "2026-02-01", fim: "2026-02-28" }, { inicio: "2026-03-01", fim: "2026-03-31" }
    ]);
  });
  it("limite de 400 períodos; intervalo invertido ou data inválida são recusados", () => {
    expect(periodosDoIntervalo("2026-01-01", "2027-02-04", "dia")).toHaveLength(400);
    const msg = "Período inválido ou longo demais para o agrupamento escolhido";
    expect(erroDe(() => periodosDoIntervalo("2026-01-01", "2027-02-05", "dia")).message).toBe(msg);
    expect(erroDe(() => periodosDoIntervalo("2026-10-02", "2026-10-01", "dia")).message).toBe(msg);
    expect(erroDe(() => periodosDoIntervalo("2026-02-30", "2026-03-01", "mes")).message).toBe(msg);
    expect(periodosDoIntervalo("2000-01-01", "2033-04-30", "mes")).toHaveLength(400);
    expect(erroDe(() => periodosDoIntervalo("2000-01-01", "2033-05-01", "mes")).code).toBe("VALIDATION_ERROR");
  });
});

describe("DRE gerencial", () => {
  const nat = (id: string, parentId: string | null, codigo: string, nature: NaturezaParaDre["nature"], grupoDre: string | null = null, classification = "unclassified"): NaturezaParaDre =>
    ({ id, parentId, codigo, nome: `Natureza ${codigo}`, grupoDre, nature, classification });
  it("grupo da natureza: o próprio marcado, o do ancestral mais próximo, ou o derivado do tipo", () => {
    const naturezas = [
      nat("raiz", null, "1", "expense", "custos"),
      nat("filha", "raiz", "1.1", "expense"),
      nat("neta", "filha", "1.1.1", "expense", "deducoes"),
      nat("bisneta", "neta", "1.1.1.1", "income"),
      nat("rec", null, "2", "income"),
      nat("inv", null, "3", "expense", null, "capex"),
      nat("desp", null, "4", "expense", null, "opex"),
      nat("ambos", null, "5", "both"),
      nat("torto", null, "6", "income", "lucros")
    ];
    const g = grupoDreDasNaturezas(naturezas);
    expect(g.get("raiz")).toBe("custos");
    expect(g.get("filha")).toBe("custos");
    expect(g.get("neta")).toBe("deducoes");
    expect(g.get("bisneta")).toBe("deducoes");
    expect(g.get("rec")).toBe("receitas");
    expect(g.get("inv")).toBe("investimentos");
    expect(g.get("desp")).toBe("despesas");
    expect(g.get("ambos")).toBeNull();
    expect(g.get("torto")).toBe("receitas");
  });
  it("ciclo na árvore não laça: a subida para no nó repetido e cai no derivado", () => {
    const g = grupoDreDasNaturezas([nat("a", "b", "1", "income"), nat("b", "a", "2", "expense")]);
    expect(g.get("a")).toBe("receitas");
    expect(g.get("b")).toBe("despesas");
  });
  it("totais com sinal, grupos na ordem da DRE e naturezas por código", () => {
    const naturezas = [
      nat("vendas", null, "1.10", "income"), nat("servicos", null, "1.2", "income"),
      nat("impostos", null, "2", "expense", "deducoes"), nat("insumos", null, "3", "expense", "custos"),
      nat("admin", null, "4", "expense"), nat("trator", null, "5", "expense", null, "capex"),
      nat("ajuste", null, "6", "both"), nat("rendimento", null, "7", "both")
    ];
    const dre = montarDre([
      { naturezaId: "trator", valor: "-5000.00" }, { naturezaId: "vendas", valor: "10000.00" }, { naturezaId: "vendas", valor: "500.10" },
      { naturezaId: "servicos", valor: "1000.00" }, { naturezaId: "impostos", valor: "-950.05" }, { naturezaId: "insumos", valor: "-3000.00" },
      { naturezaId: "admin", valor: "-1200.00" }, { naturezaId: "ajuste", valor: "-10.00" }, { naturezaId: "rendimento", valor: "25.00" },
      { naturezaId: "sumida", valor: "-1.00" }
    ], naturezas);
    expect(dre.grupos.map((g) => g.grupo)).toEqual(["receitas", "deducoes", "custos", "despesas", "investimentos"]);
    expect(dre.grupos.map((g) => g.grupo)).toEqual([...GRUPOS_DRE]);
    const receitas = dre.grupos[0]!;
    expect(receitas.naturezas.map((n) => n.codigo)).toEqual(["1.2", "1.10", "7"]);
    expect(receitas.total).toBe("11525.10");
    const despesas = dre.grupos[3]!;
    expect(despesas.naturezas.map((n) => [n.nome, n.total])).toEqual([["Natureza não encontrada", "-1.00"], ["Natureza 4", "-1200.00"], ["Natureza 6", "-10.00"]]);
    expect(despesas.total).toBe("-1211.00");
    expect(dre.receitaLiquida).toBe("10575.05");
    expect(dre.resultadoOperacional).toBe("6364.05");
    expect(dre.investimentos).toBe("-5000.00");
    expect(dre.resultadoFinal).toBe("1364.05");
  });
  it("só os grupos com linha aparecem; sem linhas, tudo zero", () => {
    const dre = montarDre([{ naturezaId: "r", valor: "10" }], [nat("r", null, "1", "income")]);
    expect(dre.grupos).toEqual([{ grupo: "receitas", total: "10.00", naturezas: [{ id: "r", codigo: "1", nome: "Natureza 1", total: "10.00" }] }]);
    expect(montarDre([], [])).toEqual({ grupos: [], receitaLiquida: "0.00", resultadoOperacional: "0.00", investimentos: "0.00", resultadoFinal: "0.00" });
  });
});

describe("rótulos do financeiro", () => {
  it("vazio é \"Não informado\", desconhecido é \"Desconhecido\", conhecido é o texto (nunca o valor cru)", () => {
    expect(rotuloFinanceiro("situacao_titulo", "")).toBe("Não informado");
    expect(rotuloFinanceiro("situacao_titulo", null)).toBe("Não informado");
    expect(rotuloFinanceiro("situacao_titulo", undefined)).toBe("Não informado");
    expect(rotuloFinanceiro("situacao_titulo", "quitado")).toBe("Desconhecido");
    expect(rotuloFinanceiro("motivo_lote", "toString")).toBe("Desconhecido");
    expect(rotuloFinanceiro("situacao_titulo", "parcial")).toBe("Baixa parcial");
    expect(rotuloFinanceiro("motivo_lote", "credito_usado")).toBe("O crédito gerado já foi usado: estorne a compensação antes");
    expect(rotuloFinanceiro("sugestao_conciliacao", "soma")).toBe("Soma de vários");
  });
  it("cartão de baixados pela aba", () => {
    expect(rotuloDoCartaoBaixados("payable")).toBe("Pagos no período");
    expect(rotuloDoCartaoBaixados("receivable")).toBe("Recebidos no período");
    expect(rotuloDoCartaoBaixados("todos")).toBe("Baixados no período");
  });
  it("os domínios de rótulo cobrem as listas do domínio", () => {
    expect(Object.keys(ROTULOS_FINANCEIRO.grupo_dre)).toEqual([...GRUPOS_DRE]);
    expect(Object.keys(ROTULOS_FINANCEIRO.componente_baixa).sort()).toEqual([...COMPONENTES_BAIXA, "desconto"].sort());
    expect(Object.keys(ROTULOS_FINANCEIRO.sugestao_conciliacao)).toEqual(["encontrado", "sugestao", "soma", "nenhuma"]);
    expect(Object.keys(ROTULOS_FINANCEIRO)).toEqual([
      "situacao_titulo", "cartao_titulo", "origem_titulo", "componente_baixa", "tipo_transferencia", "sugestao_conciliacao",
      "situacao_conciliacao", "grupo_dre", "campo_periodo", "motivo_lote", "regime_dre"
    ]);
  });
});
