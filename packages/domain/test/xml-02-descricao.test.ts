/**
 * XML-02 (decisão 314) — a descrição do produto: normalização, pontuação, limiar, teto e a decisão do 5º caminho.
 * Sem banco: a prova de que a expressão SQL dá a MESMA saída que `normalizarDescricao`, e de que os lexemas abaixo são
 * os do Postgres, é o teste de integração `packages/db/test/xml-02-descricao-sql.test.ts`.
 * Cada teste afirma a PREMISSA junto da CONCLUSÃO.
 */
import { describe, expect, it } from "vitest";
import {
  CONFIGURACAO_TEXTUAL_DA_DESCRICAO,
  LIMIAR_DA_DESCRICAO,
  TETO_DE_CANDIDATOS_DA_DESCRICAO,
  TRADUCAO_DA_DESCRICAO_DE,
  TRADUCAO_DA_DESCRICAO_PARA,
  acimaDoLimiarDaDescricao,
  compararCandidatosDaDescricao,
  decidirPelaDescricao,
  mesmoNcm,
  normalizarDescricao,
  pontuacaoDaDescricao,
  sqlAcimaDoLimiarDaDescricao,
  sqlDescricaoNormalizada,
  sqlLexemasDaDescricao,
  sqlLexemasEmComum,
  sqlLexemasNoTotal,
  traduzirComoOPostgres,
  type CandidatoDaDescricao
} from "../src/index.js";

describe("XML-02 — as duas strings do translate", () => {
  const de = [...TRADUCAO_DA_DESCRICAO_DE];
  const para = [...TRADUCAO_DA_DESCRICAO_PARA];

  it("DE tem A–Z, as 24+24 acentuadas e as 112 marcas combinantes (U+0300–U+036F); PARA tem 26 + 24 + 24", () => {
    expect(de).toHaveLength(26 + 24 + 24 + 0x70);
    expect(para).toHaveLength(26 + 24 + 24);
    expect(new Set(de).size).toBe(de.length); // sem repetição: a primeira ocorrência nunca esconde outra
    expect(de.slice(para.length)).toEqual(Array.from({ length: 0x70 }, (_, i) => String.fromCodePoint(0x300 + i)));
    expect(para.every((c) => /^[a-z]$/.test(c))).toBe(true); // o PARA só tem a–z
  });

  it("cada letra do português (e a maiúscula) vira a letra sem acento; A–Z vira a–z; a marca combinante é apagada", () => {
    const esperado: Record<string, string> = {
      á: "a", à: "a", â: "a", ã: "a", ä: "a", é: "e", ê: "e", è: "e", ë: "e", í: "i", ì: "i", î: "i", ï: "i",
      ó: "o", ò: "o", ô: "o", õ: "o", ö: "o", ú: "u", ù: "u", û: "u", ü: "u", ç: "c", ñ: "n"
    };
    expect(Object.keys(esperado)).toHaveLength(24);
    for (const [letra, base] of Object.entries(esperado)) {
      expect(normalizarDescricao(letra), letra).toBe(base);
      expect(normalizarDescricao(letra.toUpperCase()), letra.toUpperCase()).toBe(base);
    }
    expect(normalizarDescricao("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(normalizarDescricao("RAÇÃO")).toBe("racao"); // NFD: a letra + a marca, separadas
    expect(normalizarDescricao("RAÇÃO")).toBe(normalizarDescricao("RAÇÃO"));
  });

  it("traduzirComoOPostgres segue o translate: posição a posição, sem par ⇒ apaga, fora de DE ⇒ fica", () => {
    expect(traduzirComoOPostgres("12345", "143", "ax")).toBe("a2x5");
    expect(traduzirComoOPostgres("aabb", "aa", "xy")).toBe("xxbb"); // a primeira ocorrência em DE vale
  });
});

describe("XML-02 — a normalização", () => {
  const casos: [string | null | undefined, string][] = [
    ["RAÇÃO BOVINA ENGORDA", "racao bovina engorda"],
    ["FERTILIZANTE FOLIAR CÁLCIO-BORO", "fertilizante foliar calcio boro"],
    ["PROTEINADO SAL  MINERAL", "proteinado sal mineral"],
    ["GLIFOSATO HERBICIDA 480 G/L", "glifosato herbicida 480 g l"],
    ["ADUBO NPK 04-14-08", "adubo npk 04 14 08"],
    ["HERBICIDA 2,4-D 806", "herbicida 2 4 d 806"],
    ["UREIA AGRÍCOLA 45% N - BIG BAG 1.000KG", "ureia agricola 45 n big bag 1 000kg"],
    ["  ARAME FARPADO Nº 16\t500M  ", "arame farpado n 16 500m"],
    ["MOURÃO Ø 10/12 TRATADO", "mourao 10 12 tratado"], // Ø (fora do português) e o espaço sem quebra viram espaço
    ["İSCA K", "sca"], // İ (U+0130) e o sinal Kelvin (U+212A) não estão na tabela: viram espaço, sem lower() de locale
    ["", ""],
    ["--- / ---", ""],
    [null, ""],
    [undefined, ""]
  ];
  it.each(casos)("%j → %j", (entrada, saida) => {
    expect(normalizarDescricao(entrada)).toBe(saida);
  });

  it("a saída só tem a–z, 0–9 e espaço simples, sem espaço nas pontas; normalizar de novo não muda nada", () => {
    for (const [entrada] of casos) {
      const n = normalizarDescricao(entrada);
      expect(n).toMatch(/^(?:[a-z0-9]+(?: [a-z0-9]+)*)?$/);
      expect(normalizarDescricao(n)).toBe(n);
    }
  });
});

describe("XML-02 — a mesma regra em SQL (construtores)", () => {
  it("a expressão é translate → regexp_replace → btrim, com DE/PARA como parâmetros e sem lower()", () => {
    const sql = sqlDescricaoNormalizada("p.description", "$3", "$4");
    expect(sql).toBe(`btrim(regexp_replace(translate(coalesce(p.description, ''), $3::text, $4::text), '[^a-z0-9]+', ' ', 'g'))`);
    expect(sql).not.toMatch(/lower|upper|unaccent|similarity/i);
    expect(sqlLexemasDaDescricao("t.d", "$1", "$2")).toBe(
      `tsvector_to_array(to_tsvector('pg_catalog.portuguese'::regconfig, ${sqlDescricaoNormalizada("t.d", "$1", "$2")}))`);
    expect(CONFIGURACAO_TEXTUAL_DA_DESCRICAO).toBe("pg_catalog.portuguese");
    expect(sqlLexemasEmComum("li.lex", "lp.lex")).toBe("cardinality(array(select unnest(li.lex) intersect select unnest(lp.lex)))");
    expect(sqlLexemasNoTotal("li.lex", "lp.lex")).toBe("cardinality(array(select unnest(li.lex) union select unnest(lp.lex)))");
    expect(sqlAcimaDoLimiarDaDescricao("x.comuns", "x.total")).toBe("(x.comuns * 2 > x.total * 1)");
  });

  it("recusa coluna que não é identificador simples e parâmetro que não é $n (nada de entrada do usuário no SQL)", () => {
    expect(() => sqlDescricaoNormalizada("p.description); drop table erp.products; --", "$1", "$2")).toThrow(/identificador/);
    expect(() => sqlDescricaoNormalizada("P.Description", "$1", "$2")).toThrow(/identificador/);
    expect(() => sqlDescricaoNormalizada("a.b.c", "$1", "$2")).toThrow(/identificador/);
    expect(() => sqlDescricaoNormalizada("p.description", "'x'", "$2")).toThrow(/parâmetro/);
    expect(() => sqlDescricaoNormalizada("p.description", "$1", "$0")).toThrow(/parâmetro/);
    expect(() => sqlDescricaoNormalizada("p.description", "$1", "$2::text")).toThrow(/parâmetro/);
    expect(() => sqlLexemasEmComum("a", "b) or (1=1")).toThrow(/identificador/);
    expect(() => sqlAcimaDoLimiarDaDescricao("1", "x")).toThrow(/identificador/);
  });
});

describe("XML-02 — a pontuação (Jaccard dos lexemas, em inteiros) e o limiar (maioria estrita)", () => {
  it("comuns = |A ∩ B|, total = |A ∪ B|; repetição não conta; vazio dá 0/0", () => {
    expect(pontuacaoDaDescricao(["raca", "bovin", "engord", "25kg"], ["bovin", "engord", "raca"])).toEqual({ comuns: 3, total: 4 });
    expect(pontuacaoDaDescricao(["a", "a", "b"], ["b", "b"])).toEqual({ comuns: 1, total: 2 });
    expect(pontuacaoDaDescricao([], [])).toEqual({ comuns: 0, total: 0 });
    expect(pontuacaoDaDescricao(["a"], [])).toEqual({ comuns: 0, total: 1 });
  });

  it("o limiar é 1/2 ESTRITO: exatamente a metade NÃO conta; logo acima conta; 0/0 nunca conta", () => {
    expect(LIMIAR_DA_DESCRICAO).toEqual({ numerador: 1, denominador: 2 });
    expect(Object.isFrozen(LIMIAR_DA_DESCRICAO)).toBe(true);
    expect(acimaDoLimiarDaDescricao({ comuns: 1, total: 2 })).toBe(false); // = 1/2
    expect(acimaDoLimiarDaDescricao({ comuns: 2, total: 4 })).toBe(false); // = 1/2
    expect(acimaDoLimiarDaDescricao({ comuns: 3, total: 6 })).toBe(false); // = 1/2
    expect(acimaDoLimiarDaDescricao({ comuns: 3, total: 5 })).toBe(true); // 0,6
    expect(acimaDoLimiarDaDescricao({ comuns: 4, total: 7 })).toBe(true); // 0,571…
    expect(acimaDoLimiarDaDescricao({ comuns: 2, total: 5 })).toBe(false); // 0,4
    expect(acimaDoLimiarDaDescricao({ comuns: 1, total: 1 })).toBe(true);
    expect(acimaDoLimiarDaDescricao({ comuns: 0, total: 0 })).toBe(false);
  });

  it("pontuação inválida é erro de programação (lança), não 'não casou'", () => {
    for (const p of [{ comuns: 3, total: 2 }, { comuns: -1, total: 2 }, { comuns: 1.5, total: 3 }, { comuns: Number.NaN, total: 1 }, { comuns: 1, total: Infinity }]) {
      expect(() => acimaDoLimiarDaDescricao(p), JSON.stringify(p)).toThrow(RangeError);
    }
  });
});

/**
 * A CALIBRAÇÃO na nota da fase 0, contra o CADASTRO INTEIRO do E2E: os produtos da fixture da medição
 * (apps/web/e2e/xml-02-medicao.spec.ts: G1..G4, M1..M4, R1, R2 e os 5 distratores, com as NCM de lá), os 8 do seed
 * (packages/db/src/seed.ts, sem NCM, criados ANTES — código menor) e os dois do falso positivo. Os lexemas são os que
 * o Postgres devolve (a integração confere cada um no banco, com os mesmos construtores). Esta tabela escolheu o limiar.
 */
interface Descrito { descricao: string; lexemas: string[]; ncm: string | null; codigo: string }
const PRODUTOS: Record<string, Descrito> = {
  S1: { descricao: "Sal Mineral 80 Proteinado 25kg", lexemas: ["25kg", "80", "mineral", "protein", "sal"], ncm: null, codigo: "00001" },
  S2: { descricao: "Ração Confinamento 18% 40kg", lexemas: ["18", "40kg", "confin", "raca"], ncm: null, codigo: "00002" },
  S3: { descricao: "Vacina Aftosa 50 doses", lexemas: ["50", "aftos", "dos", "vacin"], ncm: null, codigo: "00003" },
  S4: { descricao: "Ivermectina 1% 500mL", lexemas: ["1", "500ml", "ivermectin"], ncm: null, codigo: "00004" },
  S5: { descricao: "Adubo NPK 04-14-08 50kg", lexemas: ["04", "08", "14", "50kg", "adub", "npk"], ncm: null, codigo: "00005" },
  S6: { descricao: "Óleo Diesel S10", lexemas: ["diesel", "ole", "s10"], ncm: null, codigo: "00006" },
  S7: { descricao: "Filtro de Óleo Trator", lexemas: ["filtr", "ole", "trator"], ncm: null, codigo: "00007" },
  S8: { descricao: "Soja em Grãos", lexemas: ["gra", "soj"], ncm: null, codigo: "00008" },
  G1: { descricao: "ESPALHANTE ADESIVO AGRICOLA", lexemas: ["ades", "agricol", "espalh"], ncm: "34029090", codigo: "00011" },
  G2: { descricao: "INOCULANTE TURFOSO PARA SOJA", lexemas: ["inocul", "soj", "turfos"], ncm: "38249929", codigo: "00012" },
  G3: { descricao: "ARAME FARPADO ROLO 500 M", lexemas: ["500", "aram", "farp", "m", "rol"], ncm: "73130000", codigo: "00013" },
  G4: { descricao: "MANGUEIRA DE PVC 1/2", lexemas: ["1", "2", "mangueir", "pvc"], ncm: "39173900", codigo: "00014" },
  M1: { descricao: "RAÇÃO BOVINA ENGORDA", lexemas: ["bovin", "engord", "raca"], ncm: "23099090", codigo: "00015" },
  M2: { descricao: "FERTILIZANTE FOLIAR CÁLCIO-BORO", lexemas: ["bor", "calci", "fertiliz", "foli"], ncm: "31059090", codigo: "00016" },
  M3: { descricao: "SAL MINERAL PROTEINADO", lexemas: ["mineral", "protein", "sal"], ncm: "23099010", codigo: "00017" },
  M4: { descricao: "HERBICIDA GLIFOSATO 480", lexemas: ["480", "glifosat", "herbic"], ncm: "38089329", codigo: "00018" },
  R1: { descricao: "PRODUTO REFERENCIADO UM", lexemas: ["produt", "referenc"], ncm: "38249929", codigo: "00019" },
  R2: { descricao: "PRODUTO REFERENCIADO DOIS", lexemas: ["dois", "produt", "referenc"], ncm: "31051000", codigo: "00020" },
  D1: { descricao: "RAÇÃO EQUINA MANUTENÇÃO", lexemas: ["equin", "manutenca", "raca"], ncm: "23099090", codigo: "00021" },
  D2: { descricao: "SAL COMUM GROSSO", lexemas: ["comum", "gross", "sal"], ncm: "25010090", codigo: "00022" },
  D3: { descricao: "HERBICIDA 2,4-D 806", lexemas: ["2", "4", "806", "d", "herbic"], ncm: "38089329", codigo: "00023" },
  D4: { descricao: "FERTILIZANTE NPK 20-05-20", lexemas: ["05", "20", "fertiliz", "npk"], ncm: "31052000", codigo: "00024" },
  D5: { descricao: "RAÇÃO BOVINA LACTAÇÃO", lexemas: ["bovin", "lactaca", "raca"], ncm: "23099090", codigo: "00025" },
  F1: { descricao: "ADUBO NPK 04-14-08", lexemas: ["04", "08", "14", "adub", "npk"], ncm: null, codigo: "00031" },
  F2: { descricao: "ADUBO NPK 04-14-08 ORGANICO", lexemas: ["04", "08", "14", "adub", "npk", "organ"], ncm: null, codigo: "00032" }
};
/** Os itens que chegam ao 5º caminho (G1..G4 casam antes, pelo código de barras: ficam fora da calibração). */
const ITENS: Record<string, Omit<Descrito, "codigo">> = {
  M1: { descricao: "RACAO BOVINA ENGORDA 25KG", lexemas: ["25kg", "bovin", "engord", "raca"], ncm: "23099090" },
  M2: { descricao: "FERTILIZANTE FOLIAR CALCIO BORO 1L", lexemas: ["1l", "bor", "calci", "fertiliz", "foli"], ncm: "31059090" },
  M3: { descricao: "PROTEINADO SAL  MINERAL", lexemas: ["mineral", "protein", "sal"], ncm: "23099010" },
  M4: { descricao: "GLIFOSATO HERBICIDA 480 G/L", lexemas: ["480", "g", "glifosat", "herbic", "l"], ncm: "38089329" },
  R1: { descricao: "ITEM TECNICO ALFA", lexemas: ["alfa", "item", "tecnic"], ncm: "38249929" },
  R2: { descricao: "ITEM TECNICO BETA", lexemas: ["bet", "item", "tecnic"], ncm: "31051000" },
  N1: { descricao: "PARAFUSO SEXTAVADO 3/8", lexemas: ["3", "8", "parafus", "sextav"], ncm: "73181500" },
  N2: { descricao: "LUVA NITRILICA TAM G", lexemas: ["g", "luv", "nitril", "tam"], ncm: "40151900" },
  FP: { descricao: "ADUBO NPK 04-14-08", lexemas: ["04", "08", "14", "adub", "npk"], ncm: null }
};
/** DEVEM ficar acima: os 4 pares e os DOIS do falso positivo. */
const DEVEM_CASAR = ["M1×M1", "M2×M2", "M3×M3", "M4×M4", "FP×F1", "FP×F2"];
/** PLAUSÍVEIS (acima é aceitável: o mesmo produto em outra embalagem; o operador escolhe entre os dois). */
const PLAUSIVEIS = ["M3×S1", "FP×S5"];

function candidatosDoItem(item: string, ncmDoItem: string | null = ITENS[item]!.ncm, ncmDe: (rotulo: string) => string | null = (r) => PRODUTOS[r]!.ncm): CandidatoDaDescricao[] {
  return Object.entries(PRODUTOS).map(([rotulo, p]) => ({
    id: rotulo, codigo: p.codigo, mesmoNcm: mesmoNcm(ncmDoItem, ncmDe(rotulo)),
    ...pontuacaoDaDescricao(ITENS[item]!.lexemas, p.lexemas)
  }));
}
const ids = (d: ReturnType<typeof decidirPelaDescricao>) =>
  (d.situacao === "ambiguo" ? d.candidatos.map((c) => c.id) : d.situacao === "sugerido" ? [d.candidato.id] : []);

describe("XML-02 — a calibração na nota da fase 0 (o limiar com a margem mais larga)", () => {
  it("acima do limiar: EXATAMENTE os 6 que devem casar e os 2 plausíveis; a margem é 1/10 de cada lado", () => {
    const acima: string[] = [];
    let menorQueDeveCasar = Infinity;
    let maiorQueNaoDeveCasar = -Infinity;
    let pares = 0;
    for (const item of Object.keys(ITENS)) {
      for (const produto of Object.keys(PRODUTOS)) {
        const k = `${item}×${produto}`;
        const p = pontuacaoDaDescricao(ITENS[item]!.lexemas, PRODUTOS[produto]!.lexemas);
        const j = p.comuns / p.total;
        pares += 1;
        if (acimaDoLimiarDaDescricao(p)) acima.push(k);
        if (DEVEM_CASAR.includes(k)) menorQueDeveCasar = Math.min(menorQueDeveCasar, j);
        else if (!PLAUSIVEIS.includes(k)) maiorQueNaoDeveCasar = Math.max(maiorQueNaoDeveCasar, j);
      }
    }
    expect(pares).toBe(9 * 25);
    expect(acima.sort()).toEqual([...DEVEM_CASAR, ...PLAUSIVEIS].sort());
    expect(menorQueDeveCasar).toBeCloseTo(3 / 5, 12); // M4: o "G/L" sobra
    expect(maiorQueNaoDeveCasar).toBeCloseTo(2 / 5, 12); // M1 × "RAÇÃO BOVINA LACTAÇÃO"
    const limiar = LIMIAR_DA_DESCRICAO.numerador / LIMIAR_DA_DESCRICAO.denominador;
    expect(limiar).toBe((menorQueDeveCasar + maiorQueNaoDeveCasar) / 2); // o meio do intervalo
  });

  it("os perigosos do M1 ficam abaixo: RAÇÃO BOVINA LACTAÇÃO 2/5 e Ração Confinamento 1/7; o M1 fica em 3/4", () => {
    expect(pontuacaoDaDescricao(ITENS.M1!.lexemas, PRODUTOS.D5!.lexemas)).toEqual({ comuns: 2, total: 5 });
    expect(pontuacaoDaDescricao(ITENS.M1!.lexemas, PRODUTOS.S2!.lexemas)).toEqual({ comuns: 1, total: 7 });
    expect(pontuacaoDaDescricao(ITENS.M1!.lexemas, PRODUTOS.M1!.lexemas)).toEqual({ comuns: 3, total: 4 });
  });

  it("a decisão de cada item: M1, M2, M4 sugeridos (o certo); M3 ambíguo com os dois SAL MINERAL; FP ambíguo com 3; R e N nenhum", () => {
    for (const m of ["M1", "M2", "M4"]) {
      const d = decidirPelaDescricao(candidatosDoItem(m));
      expect(d, m).toMatchObject({ situacao: "sugerido", origem: "descricao", candidato: { id: m } });
    }
    const m3 = decidirPelaDescricao(candidatosDoItem("M3"));
    expect(m3).toMatchObject({ situacao: "ambiguo", acimaDoLimiar: 2 });
    expect(ids(m3)).toEqual(["M3", "S1"]); // 3/3 antes de 3/5: o certo vem primeiro, nada escolhido
    const fp = decidirPelaDescricao(candidatosDoItem("FP"));
    expect(fp).toMatchObject({ situacao: "ambiguo", acimaDoLimiar: 3 });
    expect(ids(fp)).toEqual(["F1", "S5", "F2"]); // 5/5; depois o EMPATE 5/6, sem NCM, pelo código
    for (const n of ["R1", "R2", "N1", "N2"]) expect(decidirPelaDescricao(candidatosDoItem(n)), n).toEqual({ situacao: "nenhum" });
  });

  it("o NCM de propósito igual ao dos distratores (D1 e D5 = M1; D3 = M4) não os traz: continuam abaixo e o M1/M4 sugerido", () => {
    for (const [item, distratores] of [["M1", ["D1", "D5"]], ["M4", ["D3"]]] as const) {
      const lista = candidatosDoItem(item);
      for (const d of distratores) expect(lista.find((c) => c.id === d), `${item}×${d}`).toMatchObject({ mesmoNcm: true });
      // premissa: o NCM é igual de verdade; conclusão: a decisão é a mesma de sem NCM nenhum
      const comNcm = decidirPelaDescricao(lista);
      const semNcm = decidirPelaDescricao(lista.map((c) => ({ ...c, mesmoNcm: false })));
      expect([comNcm.situacao, ids(comNcm)]).toEqual([semNcm.situacao, ids(semNcm)]);
      expect(comNcm).toMatchObject({ situacao: "sugerido", candidato: { id: item, mesmoNcm: true } });
      // e mesmo tirando o NCM do certo e deixando só nos distratores
      const soNosDistratores = decidirPelaDescricao(candidatosDoItem(item, ITENS[item]!.ncm, (r) => (r === item ? null : PRODUTOS[r]!.ncm)));
      expect(soNosDistratores).toMatchObject({ situacao: "sugerido", candidato: { id: item } });
    }
  });

  it("o NCM no EMPATE do falso positivo (F2 e S5, os dois 5/6) só muda a ORDEM dos dois; a situação e o conjunto ficam", () => {
    const semNcm = decidirPelaDescricao(candidatosDoItem("FP"));
    const ncmNoF2 = decidirPelaDescricao(candidatosDoItem("FP", "31052000", (r) => (r === "F2" ? "31052000" : PRODUTOS[r]!.ncm)));
    expect(ids(semNcm)).toEqual(["F1", "S5", "F2"]);
    expect(ids(ncmNoF2)).toEqual(["F1", "F2", "S5"]);
    expect(ncmNoF2.situacao).toBe(semNcm.situacao);
    expect([...ids(ncmNoF2)].sort()).toEqual([...ids(semNcm)].sort());
    // o F1 (5/5) continua primeiro mesmo com o NCM só no S5: o NCM não passa por cima da pontuação
    expect(ids(decidirPelaDescricao(candidatosDoItem("FP", "31052000", (r) => (r === "S5" ? "31052000" : null))))).toEqual(["F1", "S5", "F2"]);
    expect(ids(decidirPelaDescricao(candidatosDoItem("FP", "31052000", (r) => (r === "F2" || r === "S5" ? "31052000" : null))))).toEqual(["F1", "S5", "F2"]);
  });
});

function candidato(id: string, comuns: number, total: number, extra: Partial<CandidatoDaDescricao> = {}): CandidatoDaDescricao {
  return { id, codigo: id.toUpperCase(), comuns, total, mesmoNcm: false, ...extra };
}

describe("XML-02 — a decisão pura", () => {
  it("nenhum candidato, ou nenhum acima do limiar ⇒ nenhum", () => {
    expect(decidirPelaDescricao([])).toEqual({ situacao: "nenhum" });
    expect(decidirPelaDescricao([candidato("a", 2, 5), candidato("b", 1, 2), candidato("c", 0, 0)])).toEqual({ situacao: "nenhum" });
  });

  it("a FRONTEIRA: exatamente 1/2 não conta (nenhum); 3/5 sozinho conta (sugerido)", () => {
    expect(decidirPelaDescricao([candidato("a", 2, 4)])).toEqual({ situacao: "nenhum" });
    expect(decidirPelaDescricao([candidato("a", 3, 5)])).toEqual({ situacao: "sugerido", origem: "descricao", candidato: candidato("a", 3, 5) });
    // a metade ao lado de um acima: continua um só acima ⇒ sugerido, não ambíguo
    const d = decidirPelaDescricao([candidato("meio", 2, 4), candidato("a", 3, 5)]);
    expect(d).toMatchObject({ situacao: "sugerido", candidato: { id: "a" } });
  });

  it("exatamente 1 acima ⇒ sugerido, com o próprio objeto do candidato (o resto da linha vem junto)", () => {
    const comProduto = { ...candidato("x", 3, 4), produto: { descricao: "RAÇÃO BOVINA ENGORDA" } };
    const d = decidirPelaDescricao([candidato("y", 1, 4), comProduto]);
    expect(d.situacao).toBe("sugerido");
    if (d.situacao === "sugerido") expect(d.candidato).toBe(comProduto);
  });

  it("mais de 1 acima ⇒ ambíguo, ordenado por pontuação (frações em inteiros), nada escolhido", () => {
    const d = decidirPelaDescricao([candidato("b", 5, 6), candidato("a", 2, 3), candidato("c", 1, 1), candidato("z", 1, 3)]);
    expect(d.situacao).toBe("ambiguo");
    if (d.situacao === "ambiguo") {
      expect(d.candidatos.map((c) => c.id)).toEqual(["c", "b", "a"]); // 1 > 5/6 > 2/3; 1/3 fica de fora
      expect(d.acimaDoLimiar).toBe(3);
    }
    expect(d).not.toHaveProperty("candidato");
  });

  it("o TETO: 7 acima ⇒ os 5 primeiros, e acimaDoLimiar = 7", () => {
    expect(TETO_DE_CANDIDATOS_DA_DESCRICAO).toBe(5);
    const sete = [6, 7, 8, 9, 10, 11, 12].map((t, i) => candidato(`p${i}`, t - 1, t)); // 5/6 < 6/7 < … < 11/12
    const d = decidirPelaDescricao(sete);
    expect(d.situacao).toBe("ambiguo");
    if (d.situacao === "ambiguo") {
      expect(d.candidatos.map((c) => c.id)).toEqual(["p6", "p5", "p4", "p3", "p2"]);
      expect(d.acimaDoLimiar).toBe(7);
    }
  });

  it("a ordem de ENTRADA não importa: qualquer permutação dá a mesma decisão", () => {
    const base = [candidato("a", 3, 4, { codigo: "00002" }), candidato("b", 3, 4, { codigo: "00001" }), candidato("c", 4, 5), candidato("d", 1, 4)];
    const esperado = decidirPelaDescricao(base);
    for (const perm of [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) expect(decidirPelaDescricao(perm.map((i) => base[i]!))).toEqual(esperado);
    if (esperado.situacao === "ambiguo") expect(esperado.candidatos.map((c) => c.id)).toEqual(["c", "b", "a"]); // empate 3/4: código
  });

  it("o mesmo produto repetido conta uma vez (fica a melhor posição)", () => {
    const d = decidirPelaDescricao([candidato("a", 3, 5), candidato("a", 3, 4)]);
    expect(d).toMatchObject({ situacao: "sugerido", candidato: { id: "a", comuns: 3, total: 4 } });
  });

  it("pontuação inválida em QUALQUER candidato lança (nem abaixo do limiar ela some em silêncio)", () => {
    expect(() => decidirPelaDescricao([candidato("a", 3, 4), candidato("b", 5, 2)])).toThrow(RangeError);
  });
});

describe("XML-02 — o NCM nunca casa sozinho: só desempata a ordem entre pontuações IGUAIS", () => {
  it("mesmoNcm compara só os dígitos e exige os dois preenchidos", () => {
    expect(mesmoNcm("23099090", "23099090")).toBe(true);
    expect(mesmoNcm("2309.90.90", "23099090")).toBe(true);
    expect(mesmoNcm("23099090", "31052000")).toBe(false);
    expect(mesmoNcm(null, null)).toBe(false);
    expect(mesmoNcm("", "")).toBe(false);
    expect(mesmoNcm("23099090", null)).toBe(false);
  });

  it("no empate de pontuação, o de mesmo NCM vem primeiro; com pontuação diferente, o NCM não passa na frente", () => {
    const semNcm = candidato("a", 3, 4, { codigo: "00001" });
    const comNcm = candidato("b", 3, 4, { codigo: "00002", mesmoNcm: true });
    const melhorSemNcm = candidato("c", 4, 5, { codigo: "00003" });
    expect(compararCandidatosDaDescricao(comNcm, semNcm)).toBeLessThan(0);
    expect(compararCandidatosDaDescricao(melhorSemNcm, comNcm)).toBeLessThan(0);
    const d = decidirPelaDescricao([semNcm, comNcm, melhorSemNcm]);
    if (d.situacao !== "ambiguo") throw new Error(d.situacao);
    expect(d.candidatos.map((c) => c.id)).toEqual(["c", "b", "a"]);
  });

  it("o NCM não cria candidato (mesmo NCM abaixo do limiar continua fora) e não muda a situação nem o conjunto", () => {
    expect(decidirPelaDescricao([candidato("a", 1, 2, { mesmoNcm: true }), candidato("b", 0, 3, { mesmoNcm: true })])).toEqual({ situacao: "nenhum" });
    const casos: CandidatoDaDescricao[][] = [
      [candidato("a", 3, 4)],
      [candidato("a", 3, 4), candidato("b", 5, 6), candidato("c", 1, 3)],
      [candidato("a", 2, 4), candidato("b", 2, 5)],
      candidatosDoItem("FP"),
      candidatosDoItem("M1"),
      candidatosDoItem("M3")
    ];
    for (const lista of casos) {
      const sem = decidirPelaDescricao(lista.map((c) => ({ ...c, mesmoNcm: false })));
      for (const marcado of lista.map((c) => c.id)) {
        const com = decidirPelaDescricao(lista.map((c) => ({ ...c, mesmoNcm: c.id === marcado })));
        expect(com.situacao).toBe(sem.situacao);
        expect([...ids(com)].sort()).toEqual([...ids(sem)].sort());
      }
    }
  });

  it("o falso positivo continua ambíguo com o NCM só em um dos candidatos (o NCM não escolhe)", () => {
    for (const marcado of ["F1", "F2", "S5"]) {
      const d = decidirPelaDescricao(candidatosDoItem("FP").map((c) => ({ ...c, mesmoNcm: c.id === marcado })));
      expect(d, marcado).toMatchObject({ situacao: "ambiguo", acimaDoLimiar: 3 });
      expect(ids(d)[0], marcado).toBe("F1"); // 5/5 > 5/6: a pontuação manda
    }
  });
});
