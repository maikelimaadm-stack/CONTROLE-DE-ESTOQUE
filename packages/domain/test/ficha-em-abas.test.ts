import { describe, it, expect } from "vitest";
import { RESOURCES, allPermissionKeys, getResource } from "../src/index.js";

/**
 * FICHA EM ABAS (decisão 253): a declaração de todo cadastro com `abas` é COERENTE — nenhuma aba aponta para
 * grade, perfil ou seção que não existe, e nenhum campo com seção fica fora de todas as abas (sumiria da tela
 * em silêncio). Vale para Parceiros hoje e para as fases 5 a 7 sem teste novo.
 */
const comFicha = RESOURCES.filter((r) => r.abas?.length);

describe("ficha em abas — declaração coerente", () => {
  it("há pelo menos um cadastro com ficha (Parceiros)", () => {
    expect(comFicha.map((r) => r.key)).toContain("people");
  });
  for (const def of comFicha) {
    it(`${def.key}: abas, seções, grades, perfis, cabeçalho e campos rápidos existem`, () => {
      const chaves = def.abas!.map((a) => a.key);
      expect(new Set(chaves).size).toBe(chaves.length);
      const secoes = new Set(def.fields.map((f) => f.section).filter(Boolean));
      const nomes = new Set(def.fields.map((f) => f.name));
      for (const a of def.abas!) {
        for (const s of a.secoes ?? []) expect(secoes.has(s), `${a.key} → seção ${s}`).toBe(true);
        for (const d of a.detalhes ?? []) expect(def.detalhes?.some((x) => x.key === d), `${a.key} → detalhe ${d}`).toBe(true);
        for (const p of a.perfis ?? []) expect(def.perfis?.some((x) => x.key === p), `${a.key} → perfil ${p}`).toBe(true);
        if (a.visivelQuando) expect(nomes.has(a.visivelQuando.field)).toBe(true);
      }
      const nasAbas = new Set(def.abas!.flatMap((a) => a.secoes ?? []));
      for (const s of secoes) expect(nasAbas.has(s!), `seção ${s} fora de todas as abas`).toBe(true);
      for (const n of [...(def.cabecalho ?? []), ...(def.camposRapidos ?? [])]) expect(nomes.has(n), n).toBe(true);
      for (const p of def.perfis ?? []) if (p.ativoPor) expect(def.fields.find((f) => f.name === p.ativoPor)?.type).toBe("boolean");
      // toda permissão declarada (aba, grade de outro cadastro, sigilo) EXISTE no catálogo: uma chave com erro de
      // digitação nunca é concedida e barraria a todos em silêncio (R1-2)
      const catalogo = new Set(allPermissionKeys());
      const declaradas = [
        ...def.abas!.flatMap((a) => [a.permissaoDeLeitura, a.permissaoDeEdicao]),
        ...(def.detalhes ?? []).flatMap((d) => (d.permissoes ? Object.values(d.permissoes) : [])),
        ...[...def.fields, ...(def.perfis ?? []).flatMap((p) => p.fields), ...(def.detalhes ?? []).flatMap((d) => d.fields)].map((f) => f.sigilo)
      ].filter((x): x is string => Boolean(x));
      for (const p of declaradas) expect(catalogo.has(p), p).toBe(true);
      // a chave do corpo não colide com campo do principal
      for (const k of [...(def.detalhes ?? []).map((d) => d.key), ...(def.perfis ?? []).map((p) => p.key)]) expect(nomes.has(k), k).toBe(false);
    });
  }
  it("SIGILO de qualquer cadastro (com ou sem ficha) é uma permissão do catálogo (R1-2)", () => {
    const catalogo = new Set(allPermissionKeys());
    const todos = RESOURCES.flatMap((r) => [...r.fields, ...(r.perfis ?? []).flatMap((p) => p.fields), ...(r.detalhes ?? []).flatMap((d) => d.fields)].filter((f) => f.sigilo).map((f) => `${r.key}.${f.name}:${f.sigilo}`));
    expect(todos.length).toBeGreaterThanOrEqual(6);
    for (const x of todos) expect(catalogo.has(x.split(":")[1]!), x).toBe(true);
  });
  it("Parceiro: tipos no cabeçalho e no cadastro rápido; situação na Receita só leitura", () => {
    const p = getResource("people")!;
    for (const t of ["is_client", "is_provider", "is_transporter", "is_employee", "is_proprietary"]) { expect(p.cabecalho).toContain(t); expect(p.camposRapidos).toContain(t); }
    expect(p.fields.find((f) => f.name === "situacao_receita")?.readOnly).toBe(true);
    expect(p.label).toBe("Parceiro");
  });
});
