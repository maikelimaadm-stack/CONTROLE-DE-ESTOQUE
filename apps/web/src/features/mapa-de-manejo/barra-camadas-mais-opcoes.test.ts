import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const barraSrc = readFileSync(resolve(__dirname, "barra-camadas.tsx"), "utf8");

describe("Mais opções — conteúdo real no operacional", () => {
  it("painel secundário abre com Mais opções sem exigir modo técnico", () => {
    expect(barraSrc).toContain('data-testid="mapa-mais-opcoes"');
    expect(barraSrc).toContain('data-testid="mapa-mais-opcoes-painel"');
    expect(barraSrc).toContain("painelSecundarioAberto");
    // Não exige modo === tecnico para mostrar o painel de Mais opções
    expect(barraSrc).toMatch(/painelSecundarioAberto && \(/);
    expect(barraSrc).not.toMatch(/maisOpcoes \|\| modo === "tecnico"\) && modo === "tecnico"/);
  });

  it("Dados técnicos fica dentro do painel, não na barra principal concorrente", () => {
    expect(barraSrc).toContain('data-testid="mapa-dados-tecnicos"');
    // Único botão Dados técnicos no painel secundário
    expect(barraSrc.match(/data-testid="mapa-dados-tecnicos"/g)?.length).toBe(1);
    expect(barraSrc).toContain("mapa-mais-opcoes-painel");
  });

  it("Áreas (lista) não depende de comSatelite", () => {
    const idxAcoes = barraSrc.indexOf('data-testid="mapa-grupo-acoes"');
    const idxLista = barraSrc.indexOf('data-testid="mapa-abrir-lista"');
    const trecho = barraSrc.slice(idxAcoes, idxLista + 80);
    expect(trecho).toContain("onAbrirLista");
    // O botão Analisar áreas continua condicionado a comSatelite
    expect(barraSrc).toMatch(/\{p\.comSatelite && \(\s*<Button[\s\S]*?mapa-nova-consulta/);
  });

  it("mobile usa seletor compacto de visualização", () => {
    expect(barraSrc).toContain('data-testid="mapa-tema-select"');
    expect(barraSrc).toContain("md:hidden");
  });
});
