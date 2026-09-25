import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linhasDeEstados, linhasDeMunicipios, linhasDeBancos, linhasDeNcm, linhasDeCbo, lerCsvDeReferencia, escreverCsv } from "../../../../scripts/referencias/lib.mjs";

/**
 * RF-1 — CARGAS DAS REFERÊNCIAS OFICIAIS (CADASTROS Fase 3).
 *
 * Duas metades, sem rede nenhuma:
 *  (a) as TRANSFORMAÇÕES sobre fixtures no formato real de cada fonte — inclusive o município com
 *      `microrregiao: null` que o IBGE devolve para município novo (a UF sai do prefixo do código IBGE);
 *  (b) os ARQUIVOS VERSIONADOS (supabase/referencias/*.csv) com os números reais da carga.
 * A contagem no BANCO (e a carga 2x) é conferida em test/integration/referencias-oficiais.test.ts.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const csv = (nome: string) => lerCsvDeReferencia(fs.readFileSync(path.join(RAIZ, "supabase", "referencias", `${nome}.csv`), "utf8"));

const UF = (id: number, sigla: string, nome: string) => ({ id, sigla, nome, regiao: { id: 1, sigla: "X", nome: "X" } });
const ESTADOS_JSON = JSON.stringify([UF(17, "TO", "Tocantins"), UF(51, "MT", "Mato Grosso"), UF(35, "SP", "São Paulo")]);
const MUN = (id: number, nome: string, ufMicro: string | null) => ({ id, nome, microrregiao: ufMicro ? { id: 1, nome: "m", mesorregiao: { id: 1, nome: "m", UF: { id: 0, sigla: ufMicro, nome: "?" } } } : null });

describe("RF-1 (a) transformações sobre fixture", () => {
  const estados = linhasDeEstados(ESTADOS_JSON);
  it("UF pelos 2 primeiros dígitos do código IBGE, inclusive com microrregiao nula", () => {
    // o fixture põe uma UF ERRADA na microrregião de Gurupi: quem lê a microrregião erra, quem lê o prefixo acerta
    const m = linhasDeMunicipios(JSON.stringify([MUN(1709500, "Gurupi", "SP"), MUN(5101837, "Boa Esperança do Norte", null), MUN(3550308, "São Paulo", "SP")]), estados);
    expect(m).toEqual([[1709500, "Gurupi", "TO"], [3550308, "São Paulo", "SP"], [5101837, "Boa Esperança do Norte", "MT"]]);
  });
  it("código IBGE sem UF correspondente PARA a geração (nada inventado)", () => {
    expect(() => linhasDeMunicipios(JSON.stringify([MUN(9999999, "X", "TO")]), estados)).toThrow(/sem UF/);
  });
  it("bancos: só participante com COMPE de 3 dígitos; ISPB e nome extenso", () => {
    const t = "﻿ISPB,Nome_Reduzido,Número_Código,Participa_da_Compe,Acesso_Principal,Nome_Extenso,Início_da_Operação\n00000000,BCO DO BRASIL S.A.,001,Sim,RSFN,Banco do Brasil S.A.,22/04/2002\n00038166,Bacen,n/a,Não,RSFN,Banco Central do Brasil,22/04/2002\n18236120,NU PAGAMENTOS,260,Sim,RSFN,\"NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO\",01/01/2020\n";
    expect(linhasDeBancos(t)).toEqual([["001", "00000000", "Banco do Brasil S.A."], ["260", "18236120", "NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO"]]);
  });
  it("NCM: código só dígitos, nível pelo tamanho, tags HTML fora, vigência em ISO", () => {
    const j = JSON.stringify({ Data_Ultima_Atualizacao_NCM: "Vigente em 24/09/2026", Nomenclaturas: [
      { Codigo: "01.02", Descricao: "Animais vivos da espécie bovina.", Data_Inicio: "01/04/2022", Data_Fim: "31/12/9999" },
      { Codigo: "0102.21.10", Descricao: "Prenhes ou <i>com cria</i> ao pé", Data_Inicio: "01/04/2022", Data_Fim: "30/09/2026" }] });
    expect(linhasDeNcm(j).linhas).toEqual([["0102", 4, "Animais vivos da espécie bovina.", "2022-04-01", "9999-12-31"], ["01022110", 8, "Prenhes ou com cria ao pé", "2022-04-01", "2026-09-30"]]);
  });
  it("CBO: ISO-8859-1 convertido para UTF-8 com os acentos certos", () => {
    const latin1 = Buffer.from("CODIGO;TITULO\r\n622005;Caseiro (agricultura)\r\n114305;Dirigente e administrador de organização religiosa\r\n", "latin1");
    expect(linhasDeCbo(latin1)).toEqual([["114305", "Dirigente e administrador de organização religiosa"], ["622005", "Caseiro (agricultura)"]]);
  });
  it("CSV de saída faz ida e volta com vírgula, aspas e # no conteúdo", () => {
    const t = escreverCsv({ fonte: "x", linhas: 1 }, ["a", "b"], [["1", 'Tem, vírgula "e" #']]);
    expect(lerCsvDeReferencia(t)).toEqual({ meta: { fonte: "x", linhas: "1" }, colunas: ["a", "b"], linhas: [["1", 'Tem, vírgula "e" #']] });
  });
});

describe("RF-1 (b) arquivos versionados com a carga real", () => {
  it("27 UFs", () => expect(csv("estados").linhas).toHaveLength(27));
  it("≥ 5.570 municípios, cada um com a UF do prefixo IBGE", () => {
    const uf = new Map(csv("estados").linhas.map(([s, , c]) => [c, s]));
    const m = csv("municipios").linhas;
    expect(m.length).toBeGreaterThanOrEqual(5570);
    expect(m.filter(([id, , u]) => uf.get(id!.slice(0, 2)) !== u)).toEqual([]);
    expect(m.find(([id]) => id === "1709500")).toEqual(["1709500", "Gurupi", "TO"]);
    expect(m.find(([id]) => id === "3550308")).toEqual(["3550308", "São Paulo", "SP"]);
  });
  it("bancos 001, 104, 237, 341 e 260 presentes, com ISPB", () => {
    const b = new Map(csv("bancos").linhas.map(([c, i]) => [c, i]));
    for (const c of ["001", "104", "237", "341", "260"]) expect(b.get(c), c).toMatch(/^\d{8}$/);
  });
  it("NCM: mais de 10.000 códigos de 8 dígitos", () => expect(csv("ncm").linhas.filter(([c, n]) => c!.length === 8 && n === "8").length).toBeGreaterThan(10000));
  it("CBO: mais de 2.000 ocupações de 6 dígitos, acentos em UTF-8", () => {
    const c = csv("cbo").linhas;
    expect(c.filter(([cod]) => /^\d{6}$/.test(cod!)).length).toBeGreaterThan(2000);
    expect(c.some(([, t]) => t!.includes("ção"))).toBe(true);
    expect(c.some(([, t]) => /�|Ã§|Ã£/.test(t!))).toBe(false);
  });
  it("cabeçalho de procedência completo em todos (URL, data, quantidade, sha256)", () => {
    for (const n of ["estados", "municipios", "bancos", "ncm", "cbo"]) {
      const { meta, linhas } = csv(n);
      expect(meta["fonte"], n).toMatch(/^https:\/\//);
      expect(meta["baixado_em"], n).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number(meta["linhas"]), n).toBe(linhas.length);
      expect(meta["sha256_bruto"], n).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
