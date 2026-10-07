import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLASSES_CONDICAO_PASTO,
  ROTULO_ORDENACAO_CONDICAO,
  badgePrincipalCondicao,
  montarLutCondicaoPasto,
  resumirCondicaoPasto
} from "@agro/domain";

const mapaGeralSrc = readFileSync(resolve(__dirname, "mapa-geral.tsx"), "utf8");
const barraSrc = readFileSync(resolve(__dirname, "barra-camadas.tsx"), "utf8");
const legendaSrc = readFileSync(resolve(__dirname, "legenda-condicao.tsx"), "utf8");
const rastersCondSrc = readFileSync(resolve(__dirname, "rasters-condicao.ts"), "utf8");

describe("SAT-COND-01 — UI estática (UI-01..UI-10)", () => {
  it("UI-01 abre em Condição do Pasto", () => {
    expect(mapaGeralSrc).toContain('useState<ModoMapaPasto>("operacional")');
    expect(mapaGeralSrc).toContain("TEMA_DEFAULT");
    expect(barraSrc).toContain("TEMAS_MAPA_PASTO");
    expect(barraSrc).toContain("mapa-tema");
    expect(barraSrc).toContain('prefixoTestId="mapa-tema"');
  });

  it("UI-02 não exige índice na barra principal", () => {
    expect(barraSrc).toContain('modo === "tecnico"');
    expect(barraSrc).toMatch(/Índice[\s\S]*mapa-grupo-indice/);
    expect(mapaGeralSrc).toContain("Dados técnicos");
  });

  it("UI-03 legenda ha/%", () => {
    expect(legendaSrc).toContain("legenda-ha-");
    expect(legendaSrc).toContain("legenda-pct-");
    expect(legendaSrc).toContain("Resolução analítica: 20 m");
  });

  it("UI-04/05 click filtra e segundo click limpa", () => {
    expect(legendaSrc).toContain("onClick={() => p.onClasse(ativo ? null : c.codigo)}");
  });

  it("UI-06 ESC limpa", () => {
    expect(mapaGeralSrc).toContain('if (e.key !== "Escape") return');
    expect(mapaGeralSrc).toContain("setClasseFiltro(null)");
  });

  it("UI-07 lista ordena", () => {
    expect(mapaGeralSrc).toContain("ordenarAreasCondicao");
    expect(mapaGeralSrc).toContain("mapa-ordenacao-condicao");
    expect(Object.keys(ROTULO_ORDENACAO_CONDICAO)).toEqual(["atencao", "nome", "area", "solo", "baixa", "estresse"]);
  });

  it("UI-08 click área abre painel/dialog central", () => {
    expect(mapaGeralSrc).toContain("DialogAreaCondicao");
    expect(legendaSrc).toContain("painel-area-condicao");
    expect(legendaSrc).toContain("barra-empilhada-condicao");
  });

  it("UI-09 Dados técnicos contém índices", () => {
    expect(barraSrc).toContain("mapa-dados-tecnicos");
    expect(mapaGeralSrc).toContain("<CondicaoDaArea");
    expect(mapaGeralSrc).toContain('setExperiencia("tecnico")');
  });

  it("UI-10 siglas não dominam a tela principal", () => {
    expect(barraSrc).not.toMatch(/modo === "operacional"[\s\S]{0,80}mapa-grupo-indice/);
    expect(mapaGeralSrc).toContain("Analise pastos uma vez");
    expect(CLASSES_CONDICAO_PASTO.every((c) => !/NDVI|EVI2|MSAVI2/.test(c.nome))).toBe(true);
  });

  it("LUT categórica: destaque reduz as outras; operacional sem PNG", () => {
    const lut = montarLutCondicaoPasto({ classeDestaque: 5 });
    expect(lut[5 * 4 + 3]).toBe(255);
    expect(lut[1 * 4 + 3]).toBeLessThan(255);
    expect(mapaGeralSrc).toContain("modoOperacional ? new Map()");
    expect(mapaGeralSrc).toContain("OPACIDADE_PNG_SOB_ZONAS");
  });

  it("UI-11 sem CTA local Gerar mapa / Analisar condição (MAPA-UX-02)", () => {
    expect(legendaSrc).not.toContain("Gerar mapa de condição");
    expect(legendaSrc).not.toContain("Analisar condição");
    expect(legendaSrc).not.toContain("condicao-pasto-gerar-mapa");
    expect(legendaSrc).not.toContain("condicao-pasto-analisar");
    expect(mapaGeralSrc).not.toContain("gerarMapaCondicao");
  });

  it("404 da listagem é rota ausente; o efeito depende de idsKey, não do array ids", () => {
    expect(rastersCondSrc).toContain("rotaAusenteRef");
    expect(rastersCondSrc).toContain("ehRotaAusenteDaCondicao");
    expect(rastersCondSrc).toContain("e instanceof ApiError && e.status === 404");
    expect(rastersCondSrc).toContain("}, [idsKey, idsResumoKey, chaveData, p.ativo, pode, classe, diaPedido, cache, assinaturas, versao]);");
    expect(rastersCondSrc).not.toMatch(/cache, ids, assinaturas/);
  });

  it("badge e paleta versionada", () => {
    const r = resumirCondicaoPasto({ contagem: { 0: 0, 1: 80, 2: 20, 3: 0, 4: 0, 5: 0, 6: 0 }, areaTotalHa: 100 });
    expect(badgePrincipalCondicao(r).rotulo).toBe("Boa cobertura");
    expect(CLASSES_CONDICAO_PASTO.map((c) => c.cor)).toEqual(["#E0E0E0", "#1B5E20", "#7CB342", "#F9A825", "#EF6C00", "#BF360C", "#1565C0"]);
  });
});
