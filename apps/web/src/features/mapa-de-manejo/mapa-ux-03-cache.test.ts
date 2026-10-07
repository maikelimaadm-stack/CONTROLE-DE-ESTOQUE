import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CacheRasters } from "./cache-rasters";

const rastersCondSrc = readFileSync(resolve(__dirname, "rasters-condicao.ts"), "utf8");
const mapaGeralSrc = readFileSync(resolve(__dirname, "mapa-geral.tsx"), "utf8");

describe("MAPA-UX-03 — CACHE estável (CACHE-01..04)", () => {
  it("CACHE-01: !ativo não limpa resumosRef nem setPorArea(new Map()) / setResumos(new Map())", () => {
    expect(rastersCondSrc).toMatch(/if \(!p\.ativo \|\| !pode\) \{\s*setAtualizando\(false\);\s*return;/);
    expect(rastersCondSrc).not.toMatch(/if \(!p\.ativo \|\| !pode\) \{[\s\S]{0,200}cache\.limpar\(\)/);
    expect(rastersCondSrc).not.toMatch(/if \(!p\.ativo \|\| !pode\) \{[\s\S]{0,200}setPorArea\(new Map\(\)\)/);
    expect(rastersCondSrc).not.toMatch(/if \(!p\.ativo \|\| !pode\) \{[\s\S]{0,200}setResumos\(new Map\(\)\)/);
    expect(rastersCondSrc).not.toMatch(/if \(!p\.ativo \|\| !pode\) \{[\s\S]{0,280}resumosRef\.current = new Map/);
  });

  it("CACHE-02: troca de data usa SWR — não zera React state em mudou=true", () => {
    expect(rastersCondSrc).toContain("trocarContextoPreservando");
    expect(rastersCondSrc).toContain("NÃO limpa resumosRef");
    expect(rastersCondSrc).not.toMatch(/if \(mudou\) \{[\s\S]{0,180}setPorArea\(new Map\(\)\)/);
    expect(rastersCondSrc).not.toMatch(/if \(mudou\) \{[\s\S]{0,180}setResumos\(new Map\(\)\)/);
    expect(rastersCondSrc).not.toMatch(/if \(mudou\) \{[\s\S]{0,180}resumosRef\.current = new Map\(\)/);
  });

  it("CACHE-03: viewport trim só no cache pesado; resumos cobrem areaIdsResumo", () => {
    expect(rastersCondSrc).toContain("areaIdsResumo?");
    expect(rastersCondSrc).toContain("cache.manter(new Set(idsViewport))");
    expect(rastersCondSrc).toContain("resumosRef permanece intacto");
    expect(mapaGeralSrc).toContain("areaIdsResumo: areas.map((a) => a.id)");
    // SAT-BUNDLE-01B R2: no modo operacional o cache pesado usa idsDetalhe (zoom); senão o viewport.
    expect(mapaGeralSrc).toContain("areaIds: modoOperacional ? idsDetalhe : selecao.ids");
  });

  it("CACHE-04: erro de fetch preserva snapshot e expõe erroAtualizacao; sucesso é atômico", () => {
    expect(rastersCondSrc).toContain("erroAtualizacao");
    expect(rastersCondSrc).toContain("atualizando");
    expect(rastersCondSrc).toContain("CACHE-04: erro mantém snapshot anterior");
    expect(rastersCondSrc).toContain('setSituacao("erro")');
    expect(rastersCondSrc).toMatch(/setErroAtualizacao\([\s\S]{0,200}setSituacao\("erro"\)/);
    expect(rastersCondSrc).toContain("setPorArea(cache.snapshot())");
    expect(rastersCondSrc).toContain("recarregar");
    expect(rastersCondSrc).toContain("incorporarDto");
  });

  it("CacheRasters.trocarContextoPreservando devolve órfãs sem liberar", () => {
    const liberados: string[] = [];
    const cache = new CacheRasters<{ dto: { indice: string; data_imagem: string; area_id: string; geometria_sha256?: string | null }; id: string }>(
      (e) => { liberados.push(e.id); }
    );
    cache.trocarContexto("condicao_pasto|2024-01-01");
    cache.guardar("a1", {
      id: "e1",
      dto: { indice: "condicao_pasto", data_imagem: "2024-01-01", area_id: "a1", geometria_sha256: "h1" }
    });
    const r = cache.trocarContextoPreservando("condicao_pasto|2024-02-01");
    expect(r.mudou).toBe(true);
    expect(r.orfas).toHaveLength(1);
    expect(r.orfas[0]!.id).toBe("e1");
    expect(liberados).toEqual([]);
    expect(cache.tamanho).toBe(0);
  });
});
