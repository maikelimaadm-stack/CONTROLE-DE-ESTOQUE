import { describe, it, expect } from "vitest";
import type { ItemDaNota, NotaFiscalLida } from "@agro/domain";
import { unidadeDoCadastroPelaNota, vinculosDosItens, type UnidadeDoCadastro } from "../../src/lib/importacao-nfe-conferencia.js";
import type { ServiceCtx } from "../../src/lib/context.js";

/**
 * XML-01 (decisão 312) — A UNIDADE DO PRODUTO, DO uCom DA NOTA.
 *
 * O produto que nasce de um item sem vínculo traz `measurement_id` só quando o uCom casa com UMA unidade: a da
 * organização vence a do sistema; mais de uma, nenhuma ou uCom vazio ⇒ a chave não vem. Unidade errada num produto é
 * custo errado para sempre — por isso a decisão é uma função PURA (testada aqui, linha por linha) e a consulta é UMA
 * para a nota inteira (CONTADA aqui, com um contexto falso: o que está sob teste é a forma de perguntar).
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const u = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = (id: string, simbolo: string): UnidadeDoCadastro => ({ id, simbolo, daOrganizacao: true });
const sistema = (id: string, simbolo: string): UnidadeDoCadastro => ({ id, simbolo, daOrganizacao: false });

describe("unidadeDoCadastroPelaNota — a decisão (pura)", () => {
  it("a da organização, exatamente uma, vence a do sistema (mesmo que o sistema também tenha)", () => {
    expect(unidadeDoCadastroPelaNota([sistema(u(1), "KG"), org(u(2), "KG")], "KG")).toBe(u(2));
    // A ordem das linhas não decide nada.
    expect(unidadeDoCadastroPelaNota([org(u(2), "KG"), sistema(u(1), "KG")], "KG")).toBe(u(2));
  });

  it("a organização com DUAS ⇒ nenhuma — e não cai para a do sistema", () => {
    expect(unidadeDoCadastroPelaNota([org(u(2), "KG"), org(u(3), "kg"), sistema(u(1), "KG")], "KG")).toBeNull();
    expect(unidadeDoCadastroPelaNota([org(u(2), "KG"), org(u(3), " KG ")], "KG")).toBeNull();
  });

  it("só o sistema, exatamente uma ⇒ ela", () => {
    expect(unidadeDoCadastroPelaNota([sistema(u(1), "KG")], "KG")).toBe(u(1));
    // Uma da organização com OUTRO símbolo não tira a do sistema.
    expect(unidadeDoCadastroPelaNota([org(u(4), "UN"), sistema(u(1), "KG")], "KG")).toBe(u(1));
  });

  it("o sistema com DUAS ⇒ nenhuma", () => {
    expect(unidadeDoCadastroPelaNota([sistema(u(1), "KG"), sistema(u(5), "kg")], "KG")).toBeNull();
  });

  it("nenhuma unidade com o símbolo ⇒ nenhuma", () => {
    expect(unidadeDoCadastroPelaNota([], "KG")).toBeNull();
    expect(unidadeDoCadastroPelaNota([org(u(4), "UN"), sistema(u(6), "CX")], "KG")).toBeNull();
  });

  it("símbolo com espaço nas pontas e caixa diferente casa pelo normalizado (dos dois lados)", () => {
    expect(unidadeDoCadastroPelaNota([org(u(2), " kg ")], "KG")).toBe(u(2));
    expect(unidadeDoCadastroPelaNota([sistema(u(1), "Kg")], " kg ")).toBe(u(1));
    expect(unidadeDoCadastroPelaNota([org(u(7), "m3")], "M3")).toBe(u(7));
  });

  it("uCom vazio ⇒ nenhuma (nem uma unidade de símbolo vazio casa)", () => {
    expect(unidadeDoCadastroPelaNota([org(u(2), "KG"), sistema(u(8), ""), org(u(9), "   ")], "")).toBeNull();
    expect(unidadeDoCadastroPelaNota([org(u(2), "KG"), sistema(u(8), "")], "   ")).toBeNull();
  });

  it("sem semelhança: \"KG\" nunca casa \"KGS\" nem \"K\" (e vice-versa)", () => {
    expect(unidadeDoCadastroPelaNota([org(u(10), "KGS"), sistema(u(11), "K")], "KG")).toBeNull();
    expect(unidadeDoCadastroPelaNota([org(u(10), "KGS"), org(u(11), "K"), sistema(u(12), "KG")], "KG")).toBe(u(12));
    expect(unidadeDoCadastroPelaNota([org(u(2), "KG")], "KGS")).toBeNull();
    expect(unidadeDoCadastroPelaNota([org(u(2), "KG")], "K")).toBeNull();
    expect(unidadeDoCadastroPelaNota([org(u(2), "K G")], "KG")).toBeNull();
  });

  it("a mesma linha repetida é UMA unidade (não vira \"mais de uma\")", () => {
    expect(unidadeDoCadastroPelaNota([org(u(2), "KG"), org(u(2), "KG")], "KG")).toBe(u(2));
  });
});

// ─────────────── a consulta: uma só, para os uCom distintos dos itens sem vínculo ───────────────

/** O cadastro de unidades que o banco falso conhece (o recorte da organização é o da consulta, conferido abaixo). */
const CADASTRO = [
  { id: u(1), organization_id: null, symbol: "KG" },
  { id: u(2), organization_id: ORG, symbol: "kg" },
  { id: u(3), organization_id: null, symbol: "UN" },
  { id: u(4), organization_id: OUTRA_ORG, symbol: "CX" },
  { id: u(5), organization_id: null, symbol: "LT" },
  { id: u(6), organization_id: null, symbol: " lt " },
];
const EAN = "7891234567895";

function ctxFalso() {
  const consultas: { sql: string; params: unknown[] }[] = [];
  const ctx = {
    orgId: ORG,
    tx: {
      query: async (sql: string, params: unknown[] = []) => {
        consultas.push({ sql, params });
        if (sql.includes("from erp.measurement_units mu")) {
          const [orgId, simbolos] = params as [string, string[]];
          const rows = CADASTRO
            .filter((x) => (x.organization_id === orgId || x.organization_id === null) && simbolos.includes(x.symbol.trim().toUpperCase()))
            .map((x) => ({ id: x.id, simbolo: x.symbol, da_organizacao: x.organization_id !== null }));
          return { rows, rowCount: rows.length };
        }
        if (sql.includes("btrim(p.barcode)")) {
          const rows = [{ ean: EAN, fator: "1", tipo_fator: "multiply", ordem: 0, id: u(99), codigo: "P-1", descricao: "Produto do EAN", unidade: "UN", controle_lote: "nenhum", controla_estoque: true }];
          return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: 0 };
      },
    },
  } as unknown as ServiceCtx;
  return { ctx, consultas };
}

const item = (nItem: number, unidade: string, ean: string | null = null): ItemDaNota => ({
  nItem, codigo: `C${nItem}`, ean, descricao: `Item ${nItem}`, ncm: "10063021", cfop: "5102", unidade, quantidade: "1.0000",
  valorUnitario: "10.00", valorProdutos: "10.00", desconto: "0.00", frete: "0.00", seguro: "0.00", outras: "0.00", ipi: "0.00",
  icmsSt: "0.00", icms: "0.00", xPed: null, nItemPed: null, rastro: [],
});
const notaCom = (itens: ItemDaNota[]) => ({ itens }) as unknown as NotaFiscalLida;
const consultasDeUnidade = (c: { sql: string; params: unknown[] }[]) => c.filter((x) => x.sql.includes("from erp.measurement_units mu"));

describe("vinculosDosItens — a unidade numa consulta só", () => {
  it("vários itens sem vínculo: UMA consulta, com os uCom DISTINTOS e normalizados, recortada pela organização", async () => {
    const { ctx, consultas } = ctxFalso();
    const v = await vinculosDosItens(ctx, notaCom([item(1, "KG"), item(2, " kg"), item(3, "UN"), item(4, "LT"), item(5, "PCT")]), null);
    expect(consultas).toHaveLength(1);
    const [q] = consultasDeUnidade(consultas);
    expect(q!.params[0]).toBe(ORG);
    expect([...(q!.params[1] as string[])].sort()).toEqual(["KG", "LT", "PCT", "UN"]);
    expect(q!.sql).toContain("upper(btrim(mu.symbol)) = any($2::text[])");
    expect(q!.sql).toContain("mu.organization_id = $1 or mu.organization_id is null");
    const preenchimento = (n: number) => { const x = v.get(n); if (x?.situacao !== "nenhum") throw new Error(`item ${n} não é "nenhum"`); return x.preenchimento; };
    // KG: a da organização (u2) vence a do sistema (u1).
    expect(preenchimento(1)).toEqual({ description: "Item 1", ncm_code: "10063021", barcode: null, measurement_id: u(2) });
    expect(preenchimento(2).measurement_id).toBe(u(2));
    // UN: só a do sistema, uma.
    expect(preenchimento(3).measurement_id).toBe(u(3));
    // LT: duas do sistema ⇒ a chave NÃO vem (nem nula).
    expect(Object.prototype.hasOwnProperty.call(preenchimento(4), "measurement_id")).toBe(false);
    // PCT: nenhuma ⇒ a chave NÃO vem.
    expect(Object.prototype.hasOwnProperty.call(preenchimento(5), "measurement_id")).toBe(false);
    expect(preenchimento(5)).toEqual({ description: "Item 5", ncm_code: "10063021", barcode: null });
  });

  it("nenhum item sem vínculo com uCom: NENHUMA consulta de unidade, e a chave não vem", async () => {
    const { ctx, consultas } = ctxFalso();
    const v = await vinculosDosItens(ctx, notaCom([item(1, ""), item(2, "   ")]), null);
    expect(consultas).toHaveLength(0);
    for (const n of [1, 2]) {
      const x = v.get(n);
      expect(x?.situacao).toBe("nenhum");
      expect(x?.situacao === "nenhum" && Object.prototype.hasOwnProperty.call(x.preenchimento, "measurement_id")).toBe(false);
    }
  });

  it("o item que JÁ tem vínculo não entra na consulta da unidade (só os `nenhum`)", async () => {
    const { ctx, consultas } = ctxFalso();
    const v = await vinculosDosItens(ctx, notaCom([item(1, "CX", EAN), item(2, "UN")]), null);
    expect(v.get(1)?.situacao).toBe("sugerido");
    const unidade = consultasDeUnidade(consultas);
    expect(unidade).toHaveLength(1);
    expect(unidade[0]!.params[1]).toEqual(["UN"]);
  });

  it("todos os itens com vínculo: nenhuma consulta de unidade", async () => {
    const { ctx, consultas } = ctxFalso();
    await vinculosDosItens(ctx, notaCom([item(1, "KG", EAN), item(2, "UN", EAN)]), null);
    expect(consultasDeUnidade(consultas)).toHaveLength(0);
  });

  it("a unidade de OUTRA organização nunca é a do produto", async () => {
    const { ctx } = ctxFalso();
    const v = await vinculosDosItens(ctx, notaCom([item(1, "CX")]), null);
    const x = v.get(1);
    expect(x?.situacao === "nenhum" && Object.prototype.hasOwnProperty.call(x.preenchimento, "measurement_id")).toBe(false);
  });
});
