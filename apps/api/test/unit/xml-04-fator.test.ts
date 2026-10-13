import { describe, it, expect } from "vitest";
import type { ItemDaNota, NotaFiscalLida, VinculoDoItemDaNota } from "@agro/domain";
import {
  divergenciaDoFator, fatorDoItemPelaNota, vinculosDosItens, type CadastroDoProduto, type UnidadeDoCadastro, type UnidadeDoProduto,
} from "../../src/lib/importacao-nfe-conferencia.js";
import type { ServiceCtx } from "../../src/lib/context.js";

/**
 * XML-04 (decisão 318) — O FATOR VEM DO CADASTRO, PELO uCom DA NOTA.
 *
 * Em todo caminho que acha produto (lembrado, código no fornecedor, código de barras, referência, descrição), o fator é
 * o do cadastro para a unidade da nota: a principal (1), uma unidade VIVA e DE COMPRA do produto (o fator dela) ou a
 * PERGUNTA — nunca 1 em silêncio. O código de barras de OUTRA unidade do produto põe o fator em dúvida; ele nunca dá
 * fator. O vínculo lembrado VENCE (a decisão explícita do operador) e o cadastro só aparece quando o contradiz. A decisão
 * é uma função PURA (testada aqui, caso a caso); a consulta é UMA para a nota inteira (CONTADA aqui, com um contexto
 * falso que obedece aos filtros do SQL: o que está sob teste é a forma de perguntar). A exclusão (`deleted_at`) na base
 * real é da integração.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const u = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const p = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = (id: string, simbolo: string): UnidadeDoCadastro => ({ id, simbolo, daOrganizacao: true });
const sistema = (id: string, simbolo: string): UnidadeDoCadastro => ({ id, simbolo, daOrganizacao: false });
const linha = (measurementId: string, fator: string, tipoFator: "multiply" | "divide", o: Partial<UnidadeDoProduto> = {}): UnidadeDoProduto =>
  ({ measurementId, fator, tipoFator, usoCompra: true, codigoBarras: null, ...o });
const produto = (measurementId: string, unidades: UnidadeDoProduto[] = [], codigoBarras: string | null = null): CadastroDoProduto =>
  ({ measurementId, codigoBarras, unidades });
const doItem = (unidade: string, ean: string | null = null) => ({ unidade, ean });

const UN = u(1); const CX = u(3); const KG = u(4); const G = u(5);
const UNIDADES = [sistema(UN, "UN"), sistema(u(2), "CX"), org(CX, "CX"), sistema(KG, "KG"), sistema(G, "G")];
const EAN = "7891234567895"; const EAN_CX = "17891234567892"; const EAN_OUTRO = "7890000000001";

describe("fatorDoItemPelaNota — a decisão (pura)", () => {
  it("o uCom é a unidade PRINCIPAL do produto ⇒ 1, multiplica", () => {
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN), doItem(" un "))).toEqual(
      { fator: "1", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_principal", unidadeDaNota: "UN" } });
  });

  it("o uCom é uma unidade VIVA e DE COMPRA do produto ⇒ o fator e o tipo DELA (multiplica e divide)", () => {
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12.000000", "multiply")]), doItem("CX"))).toEqual(
      { fator: "12.000000", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: "CX" } });
    expect(fatorDoItemPelaNota(UNIDADES, produto(KG, [linha(G, "1000.000000", "divide")]), doItem("g"))).toEqual(
      { fator: "1000.000000", tipoFator: "divide", fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: "G" } });
  });

  it("uCom fora do cadastro ⇒ PERGUNTA (fator 1 só pela web anterior) — nunca 1 em silêncio (R1)", () => {
    const pergunta = { fator: "1", tipoFator: "multiply", fatorPelaNota: { origem: "pergunta", unidadeDaNota: "PCT", motivo: "unidade_fora_do_cadastro" } };
    // O símbolo não existe no cadastro de unidades.
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply")]), doItem("PCT"))).toEqual(pergunta);
    // A unidade existe, mas o produto não a tem (nem principal, nem linha).
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN), doItem("KG")).fatorPelaNota).toEqual({ origem: "pergunta", unidadeDaNota: "KG", motivo: "unidade_fora_do_cadastro" });
    // uCom vazio.
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN), doItem("  ")).fatorPelaNota).toEqual({ origem: "pergunta", unidadeDaNota: "", motivo: "unidade_fora_do_cadastro" });
    // Produto sem cadastro (a consulta não o trouxe).
    expect(fatorDoItemPelaNota(UNIDADES, null, doItem("UN")).fatorPelaNota).toEqual({ origem: "pergunta", unidadeDaNota: "UN", motivo: "unidade_fora_do_cadastro" });
  });

  it("a linha da unidade SEM uso de compra (só venda) ⇒ PERGUNTA (R2)", () => {
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "6", "multiply", { usoCompra: false })]), doItem("CX")).fatorPelaNota)
      .toEqual({ origem: "pergunta", unidadeDaNota: "CX", motivo: "unidade_fora_do_cadastro" });
  });

  it("só decide pelo que recebe: a linha que a consulta não trouxe (a excluída — R3) não dá fator", () => {
    const comLinha = produto(UN, [linha(CX, "24", "multiply")]);
    expect(fatorDoItemPelaNota(UNIDADES, comLinha, doItem("CX")).fatorPelaNota.origem).toBe("unidade_do_produto");
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, []), doItem("CX")).fatorPelaNota.origem).toBe("pergunta");
  });

  it("duas linhas de compra da MESMA unidade com fatores diferentes ⇒ PERGUNTA, nunca a primeira; iguais (em número) ⇒ o fator", () => {
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply"), linha(CX, "6", "multiply")]), doItem("CX")).fatorPelaNota.origem).toBe("pergunta");
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply"), linha(CX, "12", "divide")]), doItem("CX")).fatorPelaNota.origem).toBe("pergunta");
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply"), linha(CX, "12.000000", "multiply")]), doItem("CX")))
      .toMatchObject({ fator: "12", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_do_produto" } });
    // A linha só de venda da mesma unidade não entra na conta.
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply"), linha(CX, "6", "multiply", { usoCompra: false })]), doItem("CX")).fator).toBe("12");
  });

  it("o cEAN é o código de barras de OUTRA unidade do produto ⇒ PERGUNTA (codigo_de_barras_de_outra_unidade)", () => {
    const outra = { origem: "pergunta", unidadeDaNota: "CX", motivo: "codigo_de_barras_de_outra_unidade" };
    // O GTIN é o da principal (UN), a nota diz CX (de compra, fator 12).
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply")], EAN), doItem("CX", EAN))).toEqual(
      { fator: "1", tipoFator: "multiply", fatorPelaNota: outra });
    // O GTIN é o de uma linha SÓ DE VENDA de outra unidade (KG): conta também.
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply"), linha(KG, "5", "multiply", { usoCompra: false, codigoBarras: EAN })]), doItem("CX", EAN)).fatorPelaNota)
      .toEqual(outra);
    // A nota diz a principal e o GTIN é o da caixa.
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply", { codigoBarras: EAN_CX })]), doItem("UN", EAN_CX)).fatorPelaNota)
      .toEqual({ origem: "pergunta", unidadeDaNota: "UN", motivo: "codigo_de_barras_de_outra_unidade" });
  });

  it("o cEAN é o código de barras da MESMA unidade ⇒ o fator do cadastro (o código de barras não muda nada)", () => {
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply", { codigoBarras: EAN_CX })], EAN), doItem("CX", EAN_CX)))
      .toEqual({ fator: "12", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: "CX" } });
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply", { codigoBarras: EAN_CX })], ` ${EAN} `), doItem("UN", EAN)))
      .toEqual({ fator: "1", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_principal", unidadeDaNota: "UN" } });
    // O GTIN também numa outra unidade e na da nota: a da nota está entre elas, não há dúvida.
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply", { codigoBarras: EAN })], EAN), doItem("CX", EAN)).fatorPelaNota.origem)
      .toBe("unidade_do_produto");
  });

  it("o cEAN que não é de unidade do produto (ou SEM GTIN) é ignorado; o código de barras nunca DÁ fator", () => {
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply")], EAN), doItem("CX", EAN_OUTRO)).fatorPelaNota.origem).toBe("unidade_do_produto");
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply")], EAN), doItem("CX", "SEM GTIN")).fatorPelaNota.origem).toBe("unidade_do_produto");
    // O GTIN casa a linha da caixa, mas a nota diz uma unidade fora do cadastro: pergunta pela unidade, não fator 12.
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply", { codigoBarras: EAN_CX })]), doItem("PCT", EAN_CX)))
      .toEqual({ fator: "1", tipoFator: "multiply", fatorPelaNota: { origem: "pergunta", unidadeDaNota: "PCT", motivo: "unidade_fora_do_cadastro" } });
  });

  it("a unidade da ORGANIZAÇÃO vence a do sistema: o uCom vira a da organização, e é ela que o produto precisa ter", () => {
    // CX: a do sistema é u(2), a da organização é CX (u3). O produto com a principal na do sistema não a tem.
    expect(fatorDoItemPelaNota(UNIDADES, produto(u(2)), doItem("CX")).fatorPelaNota.origem).toBe("pergunta");
    expect(fatorDoItemPelaNota(UNIDADES, produto(CX), doItem("CX")).fatorPelaNota.origem).toBe("unidade_principal");
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(u(2), "6", "multiply")]), doItem("CX")).fatorPelaNota.origem).toBe("pergunta");
    // Duas da organização com o símbolo: nenhuma — pergunta.
    expect(fatorDoItemPelaNota([...UNIDADES, org(u(9), "cx")], produto(CX), doItem("CX")).fatorPelaNota.origem).toBe("pergunta");
  });
});

describe("fatorDoItemPelaNota — o vínculo lembrado VENCE", () => {
  const lembrado = (fator: string, tipoFator: "multiply" | "divide" = "multiply") => ({ fator, tipoFator });

  it("o cadastro concorda (em número: 12 = 12,000000) ⇒ o fator do vínculo, cadastro null", () => {
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12.000000", "multiply")]), doItem("CX"), lembrado("12"))).toEqual(
      { fator: "12", tipoFator: "multiply", fatorPelaNota: { origem: "vinculo", unidadeDaNota: "CX", cadastro: null } });
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN), doItem("UN"), lembrado("1.000000")).fatorPelaNota)
      .toEqual({ origem: "vinculo", unidadeDaNota: "UN", cadastro: null });
  });

  it("o cadastro discorda (número ou tipo) ⇒ o fator do vínculo VALE, e o cadastro vem com os números dele", () => {
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12.000000", "multiply")]), doItem("CX"), lembrado("6.000000"))).toEqual(
      { fator: "6.000000", tipoFator: "multiply", fatorPelaNota: { origem: "vinculo", unidadeDaNota: "CX", cadastro: { fator: "12.000000", tipoFator: "multiply" } } });
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12.000000", "divide")]), doItem("CX"), lembrado("12.000000"))).toEqual(
      { fator: "12.000000", tipoFator: "multiply", fatorPelaNota: { origem: "vinculo", unidadeDaNota: "CX", cadastro: { fator: "12.000000", tipoFator: "divide" } } });
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN), doItem("UN"), lembrado("6.000000")).fatorPelaNota)
      .toEqual({ origem: "vinculo", unidadeDaNota: "UN", cadastro: { fator: "1", tipoFator: "multiply" } });
  });

  it("o cadastro não respalda (uCom fora do cadastro, linha só de venda, GTIN de outra unidade) ⇒ cadastro null, o fator do vínculo", () => {
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN), doItem("PCT"), lembrado("6.000000"))).toEqual(
      { fator: "6.000000", tipoFator: "multiply", fatorPelaNota: { origem: "vinculo", unidadeDaNota: "PCT", cadastro: null } });
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply", { usoCompra: false })]), doItem("CX"), lembrado("6")).fatorPelaNota)
      .toEqual({ origem: "vinculo", unidadeDaNota: "CX", cadastro: null });
    expect(fatorDoItemPelaNota(UNIDADES, produto(UN, [linha(CX, "12", "multiply")], EAN), doItem("CX", EAN), lembrado("6", "divide"))).toEqual(
      { fator: "6", tipoFator: "divide", fatorPelaNota: { origem: "vinculo", unidadeDaNota: "CX", cadastro: null } });
  });
});

// ─────────────── a divergência do fator (não bloqueia) ───────────────

const PRODUTO = { id: p(1), codigo: "P-1", descricao: "Produto 1", unidade: "UN", controleLote: "nenhum" as const, controlaEstoque: true };

describe("divergenciaDoFator — a pergunta e o vínculo contrariado, sem bloquear", () => {
  it("PERGUNTA pela unidade: fator_a_informar, com a unidade da nota e o produto", () => {
    const v: VinculoDoItemDaNota = { situacao: "sugerido", origem: "reference", produto: PRODUTO, fator: "1", tipoFator: "multiply",
      fatorPelaNota: { origem: "pergunta", unidadeDaNota: "PCT", motivo: "unidade_fora_do_cadastro" } };
    expect(divergenciaDoFator(3, v)).toEqual({ codigo: "fator_a_informar", nItem: 3, bloqueia: false,
      mensagem: "Item 3: a unidade PCT da nota não é unidade de compra do produto P-1 no cadastro: informe o fator." });
  });

  it("PERGUNTA pelo código de barras: fator_a_informar, dizendo que o GTIN é de outra unidade", () => {
    const v: VinculoDoItemDaNota = { situacao: "sugerido", origem: "codigo_barras", produto: PRODUTO, fator: "1", tipoFator: "multiply",
      fatorPelaNota: { origem: "pergunta", unidadeDaNota: "CX", motivo: "codigo_de_barras_de_outra_unidade" } };
    expect(divergenciaDoFator(1, v)).toEqual({ codigo: "fator_a_informar", nItem: 1, bloqueia: false,
      mensagem: "Item 1: o código de barras da nota é de outra unidade do produto P-1: confira o fator." });
  });

  it("o lembrado que o cadastro contradiz: os DOIS números, e vale o do vínculo", () => {
    const v: VinculoDoItemDaNota = { situacao: "lembrado", produto: PRODUTO, fator: "6.000000", tipoFator: "multiply",
      fatorPelaNota: { origem: "vinculo", unidadeDaNota: "CX", cadastro: { fator: "12.000000", tipoFator: "divide" } } };
    expect(divergenciaDoFator(2, v)).toEqual({ codigo: "fator_do_vinculo_diferente_do_cadastro", nItem: 2, bloqueia: false,
      mensagem: "Item 2: o vínculo lembrado usa fator 6 (multiplica); o cadastro do produto P-1, para a unidade CX, diz 12 (divide). Vale o do vínculo: confira." });
  });

  it("nada a dizer: o cadastro respalda, o lembrado concorda, sem produto ou a API anterior (sem fatorPelaNota)", () => {
    const base = { situacao: "sugerido" as const, origem: "reference" as const, produto: PRODUTO, fator: "1", tipoFator: "multiply" as const };
    expect(divergenciaDoFator(1, { ...base, fatorPelaNota: { origem: "unidade_principal", unidadeDaNota: "UN" } })).toBeNull();
    expect(divergenciaDoFator(1, { ...base, fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: "CX" } })).toBeNull();
    expect(divergenciaDoFator(1, { situacao: "lembrado", produto: PRODUTO, fator: "6", tipoFator: "multiply",
      fatorPelaNota: { origem: "vinculo", unidadeDaNota: "CX", cadastro: null } })).toBeNull();
    expect(divergenciaDoFator(1, base)).toBeNull();
    expect(divergenciaDoFator(1, { situacao: "nenhum", preenchimento: { description: "x", ncm_code: null, barcode: null } })).toBeNull();
    expect(divergenciaDoFator(1, { situacao: "ambiguo", candidatos: [PRODUTO] })).toBeNull();
  });
});

// ─────────────── a consulta: uma só, para a nota inteira ───────────────

const FORNECEDOR = "dddddddd-0000-4000-8000-000000000001";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
/** As unidades de medida que o banco falso conhece (o recorte da organização é o da consulta). */
const CADASTRO_DE_UNIDADES = [
  { id: UN, organization_id: null, symbol: "UN" }, { id: u(2), organization_id: null, symbol: "CX" }, { id: CX, organization_id: ORG, symbol: "cx" },
  { id: KG, organization_id: null, symbol: "KG" }, { id: G, organization_id: null, symbol: "G" }, { id: u(8), organization_id: OUTRA_ORG, symbol: "PCT" },
];
/** Os produtos: P1 (UN; caixa de 12, de compra, com GTIN), P2 (KG; grama, divide 1000), P3 (UN; caixa só de VENDA), P4 (UN; caixa EXCLUÍDA). */
const PRODUTOS = [
  { id: p(1), code: "P-1", measurement_id: UN, barcode: EAN, deleted: false },
  { id: p(2), code: "P-2", measurement_id: KG, barcode: null, deleted: false },
  { id: p(3), code: "P-3", measurement_id: UN, barcode: null, deleted: false },
  { id: p(4), code: "P-4", measurement_id: UN, barcode: null, deleted: false },
];
const LINHAS = [
  { product_id: p(1), measurement_id: CX, fator: "12.000000", tipo_fator: "multiply", uso_compra: true, codigo_barras: EAN_CX, deleted: false },
  { product_id: p(2), measurement_id: G, fator: "1000.000000", tipo_fator: "divide", uso_compra: true, codigo_barras: null, deleted: false },
  { product_id: p(3), measurement_id: CX, fator: "6.000000", tipo_fator: "multiply", uso_compra: false, codigo_barras: null, deleted: false },
  { product_id: p(4), measurement_id: CX, fator: "24.000000", tipo_fator: "multiply", uso_compra: true, codigo_barras: null, deleted: true },
];
const colunasDoProduto = (id: string) => {
  const x = PRODUTOS.find((y) => y.id === id)!;
  return { id: x.id, codigo: x.code, descricao: `Produto ${x.code}`, unidade: "UN", controle_lote: "nenhum", controla_estoque: true };
};

type Consulta = { sql: string; params: unknown[] };
const ehDoCadastro = (sql: string) => sql.includes("from erp.measurement_units mu");

/**
 * O banco falso: cada consulta pelo que pergunta; a do cadastro OBEDECE aos filtros de exclusão do próprio SQL.
 * `ambiguoNoFornecedor`: o código F2 no fornecedor é de DOIS produtos.
 */
function ctxFalso(o: { ambiguoNoFornecedor?: boolean } = {}) {
  const consultas: Consulta[] = [];
  const ctx = {
    orgId: ORG,
    tx: {
      query: async (sql: string, params: unknown[] = []) => {
        consultas.push({ sql, params });
        const resposta = (rows: unknown[]) => ({ rows, rowCount: rows.length });
        if (ehDoCadastro(sql)) {
          const [orgId, simbolos, ids] = params as [string, string[], string[]];
          const unidades = CADASTRO_DE_UNIDADES
            .filter((x) => (x.organization_id === orgId || x.organization_id === null) && simbolos.includes(x.symbol.trim().toUpperCase()))
            .map((x) => ({ tipo: "unidade", id: x.id, simbolo: x.symbol, da_organizacao: x.organization_id !== null,
              measurement_id: null, codigo_barras: null, fator: null, tipo_fator: null, uso_compra: null }));
          const produtos = PRODUTOS.filter((x) => ids.includes(x.id) && !(x.deleted && sql.includes("p.deleted_at is null")))
            .map((x) => ({ tipo: "produto", id: x.id, simbolo: null, da_organizacao: null, measurement_id: x.measurement_id, codigo_barras: x.barcode,
              fator: null, tipo_fator: null, uso_compra: null }));
          const linhas = LINHAS.filter((x) => ids.includes(x.product_id) && !(x.deleted && sql.includes("pu.deleted_at is null")))
            .map((x) => ({ tipo: "unidade_do_produto", id: x.product_id, simbolo: null, da_organizacao: null, measurement_id: x.measurement_id,
              codigo_barras: x.codigo_barras, fator: x.fator, tipo_fator: x.tipo_fator, uso_compra: x.uso_compra }));
          return resposta([...linhas, ...unidades, ...produtos]);
        }
        if (sql.includes("from erp.produto_fornecedor_vinculos v")) {
          const [, , codigos, unidades] = params as [string, string, string[], string[]];
          const lembrado = codigos.some((c, k) => c === "L1" && unidades[k] === "CX");
          return resposta(lembrado ? [{ codigo_fornecedor: "L1", unidade_fornecedor: "CX", fator: "6.000000", tipo_fator: "multiply", ...colunasDoProduto(p(1)) }] : []);
        }
        if (sql.includes("from erp.produto_fornecedores pf")) {
          const [, , codigos] = params as [string, string, string[]];
          if (!codigos.includes("F2")) return resposta([]);
          return resposta([{ codigo_no_fornecedor: "F2", ...colunasDoProduto(p(3)) },
            ...(o.ambiguoNoFornecedor ? [{ codigo_no_fornecedor: "F2", ...colunasDoProduto(p(2)) }] : [])]);
        }
        if (sql.includes("btrim(p.barcode) = any(")) {
          const [, eans] = params as [string, string[]];
          return resposta(eans.includes(EAN) ? [{ ean: EAN, ordem: 0, ...colunasDoProduto(p(1)) }] : []);
        }
        if (sql.includes("btrim(p.reference)")) {
          const [, codigos] = params as [string, string[]];
          const porReferencia: Record<string, string> = { R4: p(2), R7: p(4), R8: p(1) };
          return resposta(codigos.filter((c) => porReferencia[c]).map((c) => ({ referencia: c, ...colunasDoProduto(porReferencia[c]!) })));
        }
        if (sql.includes("to_tsvector(")) {
          const [, , , descricoes, nItens] = params as [string, string, string, string[], number[]];
          const k = descricoes.indexOf("DESCRICAO DO P1");
          return resposta(k < 0 ? [] : [{ n_item: nItens[k], posicao: 1, acima_do_limiar: 1, comuns: 3, total: 3, ncm_produto: null, ...colunasDoProduto(p(1)) }]);
        }
        return resposta([]);
      },
    },
  } as unknown as ServiceCtx;
  return { ctx, consultas };
}

const item = (nItem: number, codigo: string, unidade: string, o: { ean?: string; descricao?: string } = {}): ItemDaNota => ({
  nItem, codigo, ean: o.ean ?? null, descricao: o.descricao ?? `Item ${nItem}`, ncm: "10063021", cfop: "5102", unidade, quantidade: "1.0000",
  valorUnitario: "10.00", valorProdutos: "10.00", desconto: "0.00", frete: "0.00", seguro: "0.00", outras: "0.00", ipi: "0.00",
  icmsSt: "0.00", icms: "0.00", xPed: null, nItemPed: null, rastro: [],
});
const notaCom = (itens: ItemDaNota[]) => ({ itens }) as unknown as NotaFiscalLida;
/** Os sete caminhos da nota: lembrado, código no fornecedor, código de barras, referência (3) e descrição, e um sem produto. */
const SETE = [
  item(1, "L1", "cx"),                                   // lembrado (fator 6) — o cadastro de P1 diz 12 para a caixa
  item(2, "F2", "CX"),                                   // código no fornecedor → P3, cuja caixa é só de VENDA
  item(3, "X3", "CX", { ean: EAN }),                      // código de barras → P1; o GTIN é o da principal (UN), a nota diz CX
  item(4, "R4", "G"),                                    // referência → P2, grama (divide 1000)
  item(5, "Z5", "UN", { descricao: "DESCRICAO DO P1" }), // descrição → P1, a principal
  item(6, "Z6", "KG"),                                   // nenhum: a unidade do produto a criar
  item(7, "R7", "CX"),                                   // referência → P4, cuja caixa foi EXCLUÍDA
];

describe("vinculosDosItens — o fator pelo cadastro, numa consulta só", () => {
  it("TODOS os caminhos tiram o fator do cadastro pelo uCom; o caminho só decide QUAL produto", async () => {
    const { ctx } = ctxFalso();
    const v = await vinculosDosItens(ctx, notaCom(SETE), FORNECEDOR);
    const resumo = (n: number) => {
      const x = v.get(n)!;
      return x.situacao === "lembrado" || x.situacao === "sugerido"
        ? { situacao: x.situacao, origem: x.situacao === "sugerido" ? x.origem : null, produto: x.produto.id, fator: x.fator, tipoFator: x.tipoFator, fatorPelaNota: x.fatorPelaNota }
        : { situacao: x.situacao };
    };
    expect(resumo(1)).toEqual({ situacao: "lembrado", origem: null, produto: p(1), fator: "6.000000", tipoFator: "multiply",
      fatorPelaNota: { origem: "vinculo", unidadeDaNota: "CX", cadastro: { fator: "12.000000", tipoFator: "multiply" } } });
    expect(resumo(2)).toEqual({ situacao: "sugerido", origem: "codigo_fornecedor", produto: p(3), fator: "1", tipoFator: "multiply",
      fatorPelaNota: { origem: "pergunta", unidadeDaNota: "CX", motivo: "unidade_fora_do_cadastro" } });
    expect(resumo(3)).toEqual({ situacao: "sugerido", origem: "codigo_barras", produto: p(1), fator: "1", tipoFator: "multiply",
      fatorPelaNota: { origem: "pergunta", unidadeDaNota: "CX", motivo: "codigo_de_barras_de_outra_unidade" } });
    expect(resumo(4)).toEqual({ situacao: "sugerido", origem: "reference", produto: p(2), fator: "1000.000000", tipoFator: "divide",
      fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: "G" } });
    expect(resumo(5)).toEqual({ situacao: "sugerido", origem: "descricao", produto: p(1), fator: "1", tipoFator: "multiply",
      fatorPelaNota: { origem: "unidade_principal", unidadeDaNota: "UN" } });
    expect(resumo(7)).toEqual({ situacao: "sugerido", origem: "reference", produto: p(4), fator: "1", tipoFator: "multiply",
      fatorPelaNota: { origem: "pergunta", unidadeDaNota: "CX", motivo: "unidade_fora_do_cadastro" } });
    // Os que a nota pode cadastrar levam a unidade das MESMAS linhas: o nenhum (KG) e o sugerido pela descrição (UN).
    const seis = v.get(6);
    expect(seis).toEqual({ situacao: "nenhum", preenchimento: { description: "Item 6", ncm_code: "10063021", barcode: null, measurement_id: KG } });
    const cinco = v.get(5);
    expect(cinco?.situacao === "sugerido" && cinco.origem === "descricao" ? cinco.preenchimento : null)
      .toEqual({ description: "DESCRICAO DO P1", ncm_code: "10063021", barcode: null, measurement_id: UN });
  });

  it("UMA consulta do cadastro: os uCom DISTINTOS de todos os itens e os produtos achados; a exclusão filtrada no SQL", async () => {
    const { ctx, consultas } = ctxFalso();
    await vinculosDosItens(ctx, notaCom(SETE), FORNECEDOR);
    const doCadastro = consultas.filter((x) => ehDoCadastro(x.sql));
    expect(doCadastro).toHaveLength(1);
    const [q] = doCadastro;
    expect(q!.params[0]).toBe(ORG);
    expect([...(q!.params[1] as string[])].sort()).toEqual(["CX", "G", "KG", "UN"]);
    expect([...(q!.params[2] as string[])].sort()).toEqual([p(1), p(2), p(3), p(4)]);
    expect(q!.sql).toContain("mu.organization_id = $1 or mu.organization_id is null");
    expect(q!.sql).toContain("upper(btrim(mu.symbol)) = any($2::text[])");
    expect(q!.sql).toContain("pu.deleted_at is null");
    expect(q!.sql).toContain("p.deleted_at is null");
    // O código no fornecedor não traz mais o fator (nem a unidade alternativa sem filtro de uso de compra).
    const doFornecedor = consultas.find((x) => x.sql.includes("from erp.produto_fornecedores pf"))!;
    expect(doFornecedor.sql).not.toContain("produto_unidades");
    expect(doFornecedor.sql).not.toContain("fator");
  });

  it("a nota com o DOBRO de itens (os mesmos caminhos): o MESMO número de consultas (nenhuma por item)", async () => {
    const sete = ctxFalso();
    await vinculosDosItens(sete.ctx, notaCom(SETE), FORNECEDOR);
    const catorze = ctxFalso();
    await vinculosDosItens(catorze.ctx, notaCom([...SETE, ...SETE.map((i) => ({ ...i, nItem: i.nItem + 7 }))]), FORNECEDOR);
    expect(catorze.consultas.filter((x) => ehDoCadastro(x.sql)), "UMA do cadastro").toHaveLength(1);
    expect(catorze.consultas.length).toBe(sete.consultas.length);
    // Premissa: as consultas são as dos cinco caminhos (lembrado, fornecedor, GTIN, referência, descrição) e a do cadastro.
    expect(sete.consultas).toHaveLength(6);
  });

  it("sem uCom: NENHUMA consulta do cadastro — e o produto achado PERGUNTA o fator", async () => {
    const { ctx, consultas } = ctxFalso();
    const v = await vinculosDosItens(ctx, notaCom([item(1, "R4", "  "), item(2, "Z2", "")]), null);
    expect(consultas.filter((x) => ehDoCadastro(x.sql))).toHaveLength(0);
    const um = v.get(1);
    expect(um?.situacao === "sugerido" ? [um.fator, um.fatorPelaNota] : null)
      .toEqual(["1", { origem: "pergunta", unidadeDaNota: "", motivo: "unidade_fora_do_cadastro" }]);
  });

  it("sem produto achado e sem item a cadastrar (só ambíguos): nenhuma consulta do cadastro", async () => {
    const { ctx, consultas } = ctxFalso({ ambiguoNoFornecedor: true });
    const v = await vinculosDosItens(ctx, notaCom([item(1, "F2", "CX")]), FORNECEDOR);
    expect(v.get(1)?.situacao).toBe("ambiguo");
    expect(consultas.filter((x) => ehDoCadastro(x.sql))).toHaveLength(0);
  });
});
