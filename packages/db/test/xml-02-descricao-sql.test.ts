import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { TEST_URL } from "./setup.js";
import {
  TRADUCAO_DA_DESCRICAO_DE,
  TRADUCAO_DA_DESCRICAO_PARA,
  acimaDoLimiarDaDescricao,
  decidirPelaDescricao,
  normalizarDescricao,
  pontuacaoDaDescricao,
  sqlAcimaDoLimiarDaDescricao,
  sqlDescricaoNormalizada,
  sqlLexemasDaDescricao,
  sqlLexemasEmComum,
  sqlLexemasNoTotal,
  type CandidatoDaDescricao
} from "@agro/domain";

/**
 * XML-02 (decisão 314) — a descrição do produto, PROVADA CONTRA O POSTGRES: a normalização de
 * `packages/domain/src/descricao-do-produto.ts` dá a MESMA saída em TypeScript e na expressão SQL que o domínio
 * constrói (as mesmas duas strings do translate, como parâmetro), e a pontuação/limiar calculados no SQL REAL dão os
 * mesmos números que o domínio, na nota da fase 0.
 *
 * Só SELECT sobre valores: não precisa de schema, não cria nem apaga nada. Sem extensão: só o Postgres de fábrica
 * (translate, regexp_replace, btrim, to_tsvector('pg_catalog.portuguese'), tsvector_to_array).
 */
let db: Db;
beforeAll(() => { db = createPool(TEST_URL, { max: 2 }); });
afterAll(async () => { await db.end(); });

/** Descrições reais de agro (insumo, nutrição, sanidade, cerca, combustível), com acento, hífen, barra, vírgula e espaço duplo. */
const CORPO = [
  "RAÇÃO BOVINA ENGORDA",
  "RACAO BOVINA ENGORDA 25KG",
  "FERTILIZANTE FOLIAR CÁLCIO-BORO",
  "FERTILIZANTE FOLIAR CALCIO BORO 1L",
  "SAL MINERAL PROTEINADO",
  "PROTEINADO SAL  MINERAL",
  "HERBICIDA GLIFOSATO 480",
  "GLIFOSATO HERBICIDA 480 G/L",
  "RAÇÃO EQUINA MANUTENÇÃO",
  "SAL COMUM GROSSO",
  "HERBICIDA 2,4-D 806",
  "FERTILIZANTE NPK 20-05-20",
  "RAÇÃO BOVINA LACTAÇÃO",
  "ADUBO NPK 04-14-08",
  "ADUBO NPK 04-14-08 ORGANICO",
  "PARAFUSO SEXTAVADO 3/8",
  "LUVA NITRILICA TAM G",
  "SEMENTE DE MILHO HÍBRIDO AG-1051 SC 20KG",
  "SEMENTE SOJA BRS 284 RR - PENEIRA 6,0",
  "UREIA AGRÍCOLA 45% N - BIG BAG 1.000KG",
  "CLORETO DE POTÁSSIO 60% K2O",
  "SUPERFOSFATO SIMPLES 18% P2O5  GRANULADO",
  "ÓLEO DIESEL S-10  (LITRO)",
  "VACINA FEBRE AFTOSA 15ML/5 DOSES",
  "IVERMECTINA 1% INJETÁVEL 500ML",
  "ARAME FARPADO 500M Nº 16",
  "MOURÃO DE EUCALIPTO TRATADO 2,20M Ø 10/12",
  "FUNGICIDA AZOXISTROBINA + CIPROCONAZOL 200/80 G/L",
  "INSETICIDA LAMBDA-CIALOTRINA 50 g/L CE",
  "CALCÁRIO DOLOMÍTICO PRNT 90%",
  "SILAGEM DE MILHO — TONELADA",
  "NÚCLEO MINERAL P/ GADO DE CORTE 30KG",
  "Ração Pré-Inicial Suínos 'Fase 1' 40kg",
  "FENO DE TIFTON\tFARDO 12KG",
  "SEMENTE BRAQUIÁRIA BRIZANTHA CV. MARANDU - VC 80%",
  "TRIGO PÃO BRS GUAMIRIM — SAFRA 2024/2025",
  "LINGÜIÇA CALABRESA (CONSUMO INTERNO)",
  "ÁGUA SANITÁRIA 2,5% 5L",
  "  SAL MINERAL 80P  ",
  "ADUBO 10.10.10 (SACO 50KG)",
  "BOTA PVC Nº 42",
  "RAÇÃO BOVINA ENGORDA", // NFD: a cedilha e o til escritos SEPARADOS da letra
  "PEÇA – COLHEITADEIRA Nº 123/A",
  "Óleo 2T p/ Roçadeira 500 ml",
  "İSCA FORMICIDA K", // İ (U+0130) e o sinal Kelvin (U+212A): fora da tabela; o lower() do banco os trataria diferente
  "",
  " - / - "
];

async function normalizadasNoBanco(textos: string[], sql = sqlDescricaoNormalizada("t.d", "$2", "$3")): Promise<string[]> {
  const r = await db.query<{ n: string }>(
    `select ${sql} as n from unnest($1::text[]) with ordinality as t(d, i) order by t.i`,
    [textos, TRADUCAO_DA_DESCRICAO_DE, TRADUCAO_DA_DESCRICAO_PARA]);
  return r.rows.map((x) => x.n);
}

describe("XML-02 — normalizarDescricao (TS) = sqlDescricaoNormalizada (SQL), descrição a descrição", () => {
  it("o corpo é real e não é trivial (premissa): 40+ descrições, com acento, hífen, barra, vírgula, espaço duplo e NFD", () => {
    expect(CORPO.length).toBeGreaterThanOrEqual(40);
    expect(CORPO.filter((d) => /[À-ÿ]/.test(d)).length).toBeGreaterThanOrEqual(15);
    expect(CORPO.filter((d) => d.includes("-")).length).toBeGreaterThanOrEqual(8);
    expect(CORPO.filter((d) => d.includes("/")).length).toBeGreaterThanOrEqual(8);
    expect(CORPO.filter((d) => /\d,\d/.test(d)).length).toBeGreaterThanOrEqual(4);
    expect(CORPO.filter((d) => /\s\s/.test(d)).length).toBeGreaterThanOrEqual(4);
    expect(CORPO.some((d) => /[̀-ͯ]/.test(d))).toBe(true);
    // a normalização MUDA quase tudo (senão a igualdade abaixo seria entre textos intocados)
    expect(CORPO.filter((d) => normalizarDescricao(d) !== d).length).toBeGreaterThanOrEqual(CORPO.length - 1);
  });

  it("a saída do banco é IGUAL à do TypeScript em cada uma das descrições", async () => {
    const banco = await normalizadasNoBanco(CORPO);
    expect(banco).toHaveLength(CORPO.length);
    expect(banco).toEqual(CORPO.map((d) => normalizarDescricao(d)));
    // amostras escritas (a igualdade não pode ser a de duas implementações igualmente erradas)
    expect(banco[CORPO.indexOf("ADUBO NPK 04-14-08")]).toBe("adubo npk 04 14 08");
    expect(banco[CORPO.indexOf("PROTEINADO SAL  MINERAL")]).toBe("proteinado sal mineral");
    expect(banco[CORPO.indexOf("HERBICIDA 2,4-D 806")]).toBe("herbicida 2 4 d 806");
    expect(banco[CORPO.indexOf("RAÇÃO BOVINA ENGORDA")]).toBe("racao bovina engorda");
    expect(banco[CORPO.indexOf("Ração Pré-Inicial Suínos 'Fase 1' 40kg")]).toBe("racao pre inicial suinos fase 1 40kg");
  });

  it("nulo vira '' nos dois lados", async () => {
    const r = await db.query<{ n: string }>(`select ${sqlDescricaoNormalizada("t.d", "$1", "$2")} as n from (select null::text as d) t`,
      [TRADUCAO_DA_DESCRICAO_DE, TRADUCAO_DA_DESCRICAO_PARA]);
    expect(r.rows[0]!.n).toBe("");
    expect(normalizarDescricao(null)).toBe("");
  });

  it("REVERSA: com lower() no lugar de A–Z e das maiúsculas no translate, o SQL DIVERGE do TypeScript em qualquer locale", async () => {
    // A variante "lower(), depois o translate só das minúsculas acentuadas". Num banco "C", lower('Á') = 'Á' e a
    // maiúscula acentuada vira espaço; em C.UTF-8/en_US, lower('İ') = 'i' e lower(U+212A) = 'k'. Uma das duas sempre acontece.
    const de = [...TRADUCAO_DA_DESCRICAO_DE].slice(26 + 24).join("");
    const para = [...TRADUCAO_DA_DESCRICAO_PARA].slice(26 + 24).join("");
    const r = await db.query<{ n: string }>(
      `select btrim(regexp_replace(translate(lower(t.d), $2::text, $3::text), '[^a-z0-9]+', ' ', 'g')) as n
         from unnest($1::text[]) with ordinality as t(d, i) order by t.i`, [CORPO, de, para]);
    const divergentes = CORPO.filter((d, i) => r.rows[i]!.n !== normalizarDescricao(d));
    expect(divergentes.length).toBeGreaterThan(0);
  });
});

/**
 * A nota da fase 0 contra o CADASTRO INTEIRO do E2E: o seed (packages/db/src/seed.ts, código menor), a fixture da
 * medição (apps/web/e2e/xml-02-medicao.spec.ts) e os dois do falso positivo — os MESMOS de
 * packages/domain/test/xml-02-descricao.test.ts, com os lexemas esperados. [rótulo, descrição, lexemas, código]
 */
const PRODUTOS: [string, string, string[], string][] = [
  ["S1", "Sal Mineral 80 Proteinado 25kg", ["25kg", "80", "mineral", "protein", "sal"], "00001"],
  ["S2", "Ração Confinamento 18% 40kg", ["18", "40kg", "confin", "raca"], "00002"],
  ["S3", "Vacina Aftosa 50 doses", ["50", "aftos", "dos", "vacin"], "00003"],
  ["S4", "Ivermectina 1% 500mL", ["1", "500ml", "ivermectin"], "00004"],
  ["S5", "Adubo NPK 04-14-08 50kg", ["04", "08", "14", "50kg", "adub", "npk"], "00005"],
  ["S6", "Óleo Diesel S10", ["diesel", "ole", "s10"], "00006"],
  ["S7", "Filtro de Óleo Trator", ["filtr", "ole", "trator"], "00007"],
  ["S8", "Soja em Grãos", ["gra", "soj"], "00008"],
  ["G1", "ESPALHANTE ADESIVO AGRICOLA", ["ades", "agricol", "espalh"], "00011"],
  ["G2", "INOCULANTE TURFOSO PARA SOJA", ["inocul", "soj", "turfos"], "00012"],
  ["G3", "ARAME FARPADO ROLO 500 M", ["500", "aram", "farp", "m", "rol"], "00013"],
  ["G4", "MANGUEIRA DE PVC 1/2", ["1", "2", "mangueir", "pvc"], "00014"],
  ["M1", "RAÇÃO BOVINA ENGORDA", ["bovin", "engord", "raca"], "00015"],
  ["M2", "FERTILIZANTE FOLIAR CÁLCIO-BORO", ["bor", "calci", "fertiliz", "foli"], "00016"],
  ["M3", "SAL MINERAL PROTEINADO", ["mineral", "protein", "sal"], "00017"],
  ["M4", "HERBICIDA GLIFOSATO 480", ["480", "glifosat", "herbic"], "00018"],
  ["R1", "PRODUTO REFERENCIADO UM", ["produt", "referenc"], "00019"],
  ["R2", "PRODUTO REFERENCIADO DOIS", ["dois", "produt", "referenc"], "00020"],
  ["D1", "RAÇÃO EQUINA MANUTENÇÃO", ["equin", "manutenca", "raca"], "00021"],
  ["D2", "SAL COMUM GROSSO", ["comum", "gross", "sal"], "00022"],
  ["D3", "HERBICIDA 2,4-D 806", ["2", "4", "806", "d", "herbic"], "00023"],
  ["D4", "FERTILIZANTE NPK 20-05-20", ["05", "20", "fertiliz", "npk"], "00024"],
  ["D5", "RAÇÃO BOVINA LACTAÇÃO", ["bovin", "lactaca", "raca"], "00025"],
  ["F1", "ADUBO NPK 04-14-08", ["04", "08", "14", "adub", "npk"], "00031"],
  ["F2", "ADUBO NPK 04-14-08 ORGANICO", ["04", "08", "14", "adub", "npk", "organ"], "00032"]
];
/** Os itens que chegam ao 5º caminho (G1..G4 casam antes, pelo código de barras). */
const ITENS: [string, string, string[]][] = [
  ["M1", "RACAO BOVINA ENGORDA 25KG", ["25kg", "bovin", "engord", "raca"]],
  ["M2", "FERTILIZANTE FOLIAR CALCIO BORO 1L", ["1l", "bor", "calci", "fertiliz", "foli"]],
  ["M3", "PROTEINADO SAL  MINERAL", ["mineral", "protein", "sal"]],
  ["M4", "GLIFOSATO HERBICIDA 480 G/L", ["480", "g", "glifosat", "herbic", "l"]],
  ["R1", "ITEM TECNICO ALFA", ["alfa", "item", "tecnic"]],
  ["R2", "ITEM TECNICO BETA", ["bet", "item", "tecnic"]],
  ["N1", "PARAFUSO SEXTAVADO 3/8", ["3", "8", "parafus", "sextav"]],
  ["N2", "LUVA NITRILICA TAM G", ["g", "luv", "nitril", "tam"]],
  ["FP", "ADUBO NPK 04-14-08", ["04", "08", "14", "adub", "npk"]]
];
const DEVEM_CASAR = ["M1×M1", "M2×M2", "M3×M3", "M4×M4", "FP×F1", "FP×F2"];
/** Acima é aceitável: o mesmo produto em outra embalagem (o operador escolhe entre os dois). */
const PLAUSIVEIS = ["M3×S1", "FP×S5"];

interface Par { item: string; produto: string; lex_item: string[]; lex_produto: string[]; comuns: number; total: number; acima: boolean }

/** O par a par no SQL REAL, com os construtores do domínio (a forma que a consulta da conferência usa). */
async function paresNoBanco(): Promise<Par[]> {
  const r = await db.query<Par>(
    `with li as materialized (
       select t.r as item, t.i as ordem, ${sqlLexemasDaDescricao("t.d", "$5", "$6")} as lex
         from unnest($1::text[], $2::text[]) with ordinality as t(r, d, i)
     ), lp as materialized (
       select t.r as produto, t.i as ordem, ${sqlLexemasDaDescricao("t.d", "$5", "$6")} as lex
         from unnest($3::text[], $4::text[]) with ordinality as t(r, d, i)
     ), par as (
       select li.item, lp.produto, li.ordem as oi, lp.ordem as op, li.lex as lex_item, lp.lex as lex_produto,
              ${sqlLexemasEmComum("li.lex", "lp.lex")} as comuns, ${sqlLexemasNoTotal("li.lex", "lp.lex")} as total
         from li cross join lp
     )
     select item, produto, lex_item, lex_produto, comuns, total, ${sqlAcimaDoLimiarDaDescricao("comuns", "total")} as acima
       from par order by oi, op`,
    [ITENS.map((x) => x[0]), ITENS.map((x) => x[1]), PRODUTOS.map((x) => x[0]), PRODUTOS.map((x) => x[1]),
      TRADUCAO_DA_DESCRICAO_DE, TRADUCAO_DA_DESCRICAO_PARA]);
  return r.rows;
}

describe("XML-02 — pontuação e limiar no SQL REAL, na nota da fase 0", () => {
  it("os lexemas do Postgres são os esperados (os mesmos que o teste do domínio usa)", async () => {
    const pares = await paresNoBanco();
    expect(pares).toHaveLength(ITENS.length * PRODUTOS.length);
    for (const [rotulo, , lexemas] of ITENS) expect(pares.find((p) => p.item === rotulo)!.lex_item, rotulo).toEqual(lexemas);
    for (const [rotulo, , lexemas] of PRODUTOS) expect(pares.find((p) => p.produto === rotulo)!.lex_produto, rotulo).toEqual(lexemas);
  });

  it("comuns/total e o limiar do SQL são os do TypeScript em todos os pares; acima = EXATAMENTE os 6 que devem casar e os 2 plausíveis", async () => {
    const pares = await paresNoBanco();
    for (const p of pares) {
      const ts = pontuacaoDaDescricao(p.lex_item, p.lex_produto);
      expect({ comuns: p.comuns, total: p.total }, `${p.item}×${p.produto}`).toEqual(ts);
      expect(p.acima, `${p.item}×${p.produto}`).toBe(acimaDoLimiarDaDescricao(ts));
    }
    const k = (p: Par) => `${p.item}×${p.produto}`;
    expect(pares.filter((p) => p.acima).map(k).sort()).toEqual([...DEVEM_CASAR, ...PLAUSIVEIS].sort());
    const j = (p: Par) => p.comuns / p.total;
    const deve = pares.filter((p) => DEVEM_CASAR.includes(k(p)));
    const naoDeve = pares.filter((p) => !DEVEM_CASAR.includes(k(p)) && !PLAUSIVEIS.includes(k(p)));
    expect(deve).toHaveLength(6);
    expect(naoDeve).toHaveLength(ITENS.length * PRODUTOS.length - 6 - 2);
    expect(Math.min(...deve.map(j))).toBeCloseTo(3 / 5, 12);
    expect(Math.max(...naoDeve.map(j))).toBeCloseTo(2 / 5, 12);
    expect(pares.find((p) => p.item === "M1" && p.produto === "D5")).toMatchObject({ comuns: 2, total: 5, acima: false });
    expect(pares.find((p) => p.item === "M1" && p.produto === "S2")).toMatchObject({ comuns: 1, total: 7, acima: false });
    expect(pares.find((p) => p.item === "M3" && p.produto === "S1")).toMatchObject({ comuns: 3, total: 5, acima: true });
  });

  it("a decisão sobre os candidatos do SQL: M1, M2, M4 sugeridos (o certo); M3 e o falso positivo ambíguos; R e N nenhum", async () => {
    const pares = await paresNoBanco();
    const codigo = new Map(PRODUTOS.map((x) => [x[0], x[3]]));
    const decisao = (item: string) => decidirPelaDescricao(pares.filter((p) => p.item === item).map((p): CandidatoDaDescricao =>
      ({ id: p.produto, codigo: codigo.get(p.produto)!, comuns: p.comuns, total: p.total, mesmoNcm: false })));
    for (const m of ["M1", "M2", "M4"]) expect(decisao(m), m).toMatchObject({ situacao: "sugerido", origem: "descricao", candidato: { id: m } });
    const m3 = decisao("M3");
    expect(m3).toMatchObject({ situacao: "ambiguo", acimaDoLimiar: 2 });
    if (m3.situacao === "ambiguo") expect(m3.candidatos.map((c) => c.id)).toEqual(["M3", "S1"]);
    const fp = decisao("FP");
    expect(fp).toMatchObject({ situacao: "ambiguo", acimaDoLimiar: 3 });
    if (fp.situacao === "ambiguo") expect(fp.candidatos.map((c) => c.id)).toEqual(["F1", "S5", "F2"]);
    for (const n of ["R1", "R2", "N1", "N2"]) expect(decisao(n), n).toEqual({ situacao: "nenhum" });
  });

  it("o limiar do SQL é o do TypeScript na FRONTEIRA (exatamente 1/2 não conta, nos dois lados)", async () => {
    const fronteira: [number, number][] = [[0, 0], [1, 1], [1, 2], [2, 4], [3, 6], [2, 3], [3, 5], [2, 5], [4, 7], [4, 8], [5, 9], [50, 99], [50, 100], [51, 100]];
    const r = await db.query<{ acima: boolean }>(
      `select ${sqlAcimaDoLimiarDaDescricao("t.comuns", "t.total")} as acima
         from unnest($1::int[], $2::int[]) with ordinality as t(comuns, total, i) order by t.i`,
      [fronteira.map((x) => x[0]), fronteira.map((x) => x[1])]);
    const ts = fronteira.map(([comuns, total]) => acimaDoLimiarDaDescricao({ comuns, total }));
    expect(r.rows.map((x) => x.acima)).toEqual(ts);
    expect(ts.filter(Boolean)).toHaveLength(7); // 1/1, 2/3, 3/5, 4/7, 5/9, 50/99, 51/100 — e nenhuma das metades
  });

  it("a leitura de produção do coordenador se repete aqui (premissa: o mesmo dicionário 'portuguese')", async () => {
    const r = await db.query<{ lex: string[] }>(`select tsvector_to_array(to_tsvector('pg_catalog.portuguese'::regconfig, $1)) as lex`,
      ["racao bovina 25kg sc adubo npk 04 14 08"]);
    expect([...r.rows[0]!.lex].sort()).toEqual(["04", "08", "14", "25kg", "adub", "bovin", "npk", "raca", "sc"]);
  });
});
