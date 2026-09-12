import { describe, it, expect } from "vitest";
import { allPermissionKeys } from "../src/permissions.js";
import {
  MANEJOS_REBANHO, MOVIMENTACOES_INTERNAS, MOVIMENTACOES_REBANHO, TODOS_TIPOS_MOVIMENTACAO,
  permissaoManejo, permissaoMovimentacao, tiposManejoVisiveis, tiposMovimentacaoVisiveis
} from "../src/rebanho.js";

/**
 * FONTE ÚNICA DA MATRIZ DE REBANHO. Estes testes existem para que a matriz não volte a ser copiada em três
 * lugares: se um tipo entrar aqui sem permissão no catálogo, ou se algum tipo interno ganhar porta funcional
 * por engano, o gate quebra.
 */
const PERMS = new Set(allPermissionKeys());

describe("matriz de permissão por tipo", () => {
  it("toda operação com tela tem as quatro permissões no catálogo", () => {
    for (const o of [...MOVIMENTACOES_REBANHO, ...MANEJOS_REBANHO]) {
      for (const acao of ["view", "create", "edit", "delete"] as const) {
        expect(PERMS.has(`${o.recurso}.${acao}`), `${o.tipo}.${acao}`).toBe(true);
      }
    }
  });
  it("cada tipo resolve a SUA permissão — nunca a de outro tipo", () => {
    for (const o of MOVIMENTACOES_REBANHO) expect(permissaoMovimentacao(o.tipo, "view")).toBe(`${o.recurso}.view`);
    for (const o of MANEJOS_REBANHO) expect(permissaoManejo(o.tipo, "create")).toBe(`${o.recurso}.create`);
    const recursos = new Set(MOVIMENTACOES_REBANHO.map((o) => o.recurso));
    expect(recursos.size, "movimentações compartilhando recurso").toBe(MOVIMENTACOES_REBANHO.length);
  });
  it("FAIL-CLOSED: tipo interno, desconhecido, vazio ou nulo devolve null (quem chama nega)", () => {
    for (const t of [...MOVIMENTACOES_INTERNAS, "", "inexistente", null, undefined]) {
      expect(permissaoMovimentacao(t, "view"), String(t)).toBeNull();
      expect(permissaoMovimentacao(t, "create"), String(t)).toBeNull();
      expect(permissaoMovimentacao(t, "delete"), String(t)).toBeNull();
    }
    for (const t of ["", "inexistente", "inventory", null, undefined]) expect(permissaoManejo(t, "view"), String(t)).toBeNull();
  });
  it("movimentação interna nunca herda a permissão de venda", () => {
    for (const t of MOVIMENTACOES_INTERNAS) expect(permissaoMovimentacao(t, "view")).not.toBe("animal_sales.view");
  });
  it("tipos internos e operacionais não se sobrepõem e cobrem a coluna discriminadora inteira", () => {
    const operacionais = MOVIMENTACOES_REBANHO.map((o) => o.tipo);
    expect(operacionais.filter((t) => MOVIMENTACOES_INTERNAS.includes(t))).toEqual([]);
    expect([...TODOS_TIPOS_MOVIMENTACAO].sort()).toEqual([...operacionais, ...MOVIMENTACOES_INTERNAS].sort());
  });
});

describe("tipos visíveis alimentam a listagem", () => {
  it("quem só tem venda vê apenas venda", () => {
    expect(tiposMovimentacaoVisiveis((p) => p === "animal_sales.view")).toEqual(["sale"]);
  });
  it("quem não tem nenhuma permissão de rebanho não vê tipo algum", () => {
    expect(tiposMovimentacaoVisiveis(() => false)).toEqual([]);
    expect(tiposManejoVisiveis(() => false)).toEqual([]);
  });
  it("quem tem tudo vê exatamente os tipos com tela (nenhum interno)", () => {
    expect(tiposMovimentacaoVisiveis(() => true)).toEqual(MOVIMENTACOES_REBANHO.map((o) => o.tipo));
    expect(tiposMovimentacaoVisiveis(() => true).some((t) => MOVIMENTACOES_INTERNAS.includes(t))).toBe(false);
  });
});
