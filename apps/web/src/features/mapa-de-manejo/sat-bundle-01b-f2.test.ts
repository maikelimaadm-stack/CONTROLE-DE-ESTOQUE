import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TEMAS_MAPA_PASTO, TEMA_DEFAULT, indiceFonteDoTema, statusAreaDoResumo,
  FAIXAS_UMIDADE, FAIXAS_VIGOR, FAIXAS_COBERTURA, FAIXAS_SOLO
} from "./temas-mapa-pasto";
import { OPACIDADE_PNG_SOB_ZONAS } from "./camada-zonas-condicao";
import { CLASSES_CONDICAO_PASTO } from "@agro/domain";

const dir = dirname(fileURLToPath(import.meta.url));
const src = (nome: string) => readFileSync(join(dir, nome), "utf8");

describe("SAT-BUNDLE-01B — contrato UI / NET / VIS / POP", () => {
  it("temas operacionais: 5 + default condição", () => {
    expect(TEMAS_MAPA_PASTO.map((t) => t.id)).toEqual([
      "condicao", "umidade", "vigor", "cobertura", "solo"
    ]);
    expect(TEMA_DEFAULT).toBe("condicao");
    expect(indiceFonteDoTema("umidade")).toBe("ndmi");
    expect(indiceFonteDoTema("vigor")).toBe("ndre");
    expect(indiceFonteDoTema("cobertura")).toBe("msavi2");
    expect(indiceFonteDoTema("solo")).toBe("bsi");
    expect(indiceFonteDoTema("condicao")).toBeNull();
  });

  it("VIS-01: modo operacional sem PNG (opacidade 0)", () => {
    expect(OPACIDADE_PNG_SOB_ZONAS).toBe(0);
  });

  it("VIS-03: condição boa = verde (não cinza)", () => {
    const boa = CLASSES_CONDICAO_PASTO.find((c) => c.id === "vegetacao_ativa_boa_cobertura");
    expect(boa).toBeTruthy();
    expect(boa!.cor.toLowerCase()).not.toMatch(/#94a3b8|#cbd5e1|#e2e8f0/);
    expect(boa!.cor.toLowerCase()).toMatch(/#[0-9a-f]{6}/);
  });

  it("faixas fixas (comparáveis entre pastos)", () => {
    expect(FAIXAS_UMIDADE.length).toBe(5);
    expect(FAIXAS_VIGOR.length).toBe(3);
    expect(FAIXAS_COBERTURA.length).toBe(3);
    expect(FAIXAS_SOLO.length).toBe(3);
    expect(FAIXAS_UMIDADE.map((f) => f.rotulo)).toEqual([
      "Muito baixa", "Baixa", "Moderada", "Adequada", "Alta"
    ]);
  });

  it("NET: troca de tema não referencia POST de consulta/raster/reparo", () => {
    const geral = src("mapa-geral.tsx");
    const barra = src("barra-camadas.tsx");
    expect(barra).toMatch(/mapa-tema/);
    expect(barra).toMatch(/Analisar áreas/);
    expect(barra).toMatch(/Dados técnicos/);
    expect(barra).not.toMatch(/Gerar raster/);
    expect(geral).toMatch(/onTema=\{\(t\) => \{ setTema\(t\)/);
    expect(geral).toMatch(/sincronizarZonasCondicaoNoMapa/);
    expect(geral).toMatch(/modoOperacional \? new Map\(\)/);
    expect(geral).toMatch(/temaExibido/);
  });

  it("POP: Gerar raster e Analisar área atual removidos do painel", () => {
    const area = src("condicao-area.tsx");
    expect(area).not.toMatch(/data-testid="condicao-gerar-raster"/);
    expect(area).not.toMatch(/data-testid="condicao-analisar-atual"/);
    expect(area).toMatch(/Analisar pastos|Analisar áreas/);
    expect(area).not.toMatch(/gerarRasterDaAnalise/);
  });

  it("POP: Dialog por tema + avisos científicos seguros", () => {
    const painel = src("painel-tema-pasto.tsx");
    expect(painel).toMatch(/Derivado do NDMI/);
    expect(painel).toMatch(/Sem score 0–100/);
    expect(painel).toMatch(/Não diagnostica erosão/);
    const legenda = src("legenda-condicao.tsx");
    expect(legenda).toMatch(/PainelTemaContinuo/);
    expect(legenda).toMatch(/tema \?\? "condicao"/);
  });

  it("SSOT status área a partir do resumo F1", () => {
    expect(statusAreaDoResumo({
      status_bundle: "completo", visual_pronto: true, condicao_disponivel: true, rasters_disponiveis: 6
    })).toBe("PRONTO");
    expect(statusAreaDoResumo({
      status_bundle: "sem_observacao", visual_pronto: false, condicao_disponivel: false, rasters_disponiveis: 0
    })).toBe("SEM_ANALISE");
    expect(statusAreaDoResumo({
      status_bundle: "produtos_parciais", visual_pronto: false, condicao_disponivel: true, rasters_disponiveis: 2
    })).toBe("PARCIAL");
  });

  it("observacao-completa: só GET", () => {
    const o = src("observacao-completa.ts");
    expect(o).toMatch(/observacoes-satelitais-completas\/resumo/);
    expect(o).toMatch(/observacao-satelital-completa/);
    expect(o).not.toMatch(/method:\s*[\"']POST[\"']/);
    expect(o).not.toMatch(/produtos-observacao\/reparar/);
  });

  it("toolbar: sem Família/Índice/Pixel/Render no modo operacional", () => {
    const barra = src("barra-camadas.tsx");
    expect(barra).toMatch(/setModo\("operacional"\)/);
    expect(barra).toMatch(/mapa-grupo-tema/);
    // Controles técnicos só dentro do bloco tecnico (painel Mais opções)
    const idxTecnico = barra.indexOf('modo === "tecnico" &&');
    expect(idxTecnico).toBeGreaterThan(0);
    expect(barra.indexOf("mapa-grupo-indice")).toBeGreaterThan(idxTecnico);
    expect(barra.indexOf("mapa-grupo-cor")).toBeGreaterThan(idxTecnico);
    expect(barra).toContain("mapa-mais-opcoes-painel");
  });
});
