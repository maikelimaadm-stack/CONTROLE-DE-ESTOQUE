import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TIPOS_NOTIFICACAO, MODULOS_ESCOPO_EMPRESA, allPermissionKeys } from "@agro/domain";

/**
 * GATE DE CATÁLOGO: registry (TypeScript) × erp.tipos_notificacao (banco).
 *
 * A autorização da notificação é decidida nos DOIS lados — o helper resolve escopo pelo registry, e o banco
 * recusa qualquer combinação fora do catálogo. Duas verdades que podem divergir: acrescentar um tipo no
 * registry e esquecer a migration faz o insert estourar em produção; acrescentar uma linha no catálogo e
 * esquecer o registry cria uma combinação gravável que nenhum código revisou. Este gate trava as duas
 * direções, e mais: que nenhum tipo empresarial tenha `organizacao` liberado no catálogo, que é a forma
 * mais ampla de visibilidade e o vazamento que a 0012 fecha.
 */
const SQL = readFileSync(new URL("../../../../supabase/migrations/0012_notification_scope.sql", import.meta.url), "utf8");

interface LinhaCatalogo { kind: string; escopo: string; moduloRef: string; permissao: string }

/** Lê as linhas do `insert into erp.tipos_notificacao` da própria migration (fonte publicada, não uma cópia). */
const CATALOGO: LinhaCatalogo[] = (() => {
  const bloco = SQL.split("insert into erp.tipos_notificacao")[1];
  expect(bloco, "a migration 0012 precisa semear erp.tipos_notificacao").toBeTruthy();
  const ate = bloco!.split("on conflict")[0]!;
  const linhas: LinhaCatalogo[] = [];
  const re = /\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z_-]+)'\s*,\s*'([a-z_.]+)'\s*,/g;
  for (const m of ate.matchAll(re)) linhas.push({ kind: m[1]!, escopo: m[2]!, moduloRef: m[3]!, permissao: m[4]! });
  return linhas;
})();

const chave = (l: LinhaCatalogo) => `${l.kind}|${l.escopo}|${l.moduloRef}|${l.permissao}`;

describe("catálogo de tipos de notificação", () => {
  it("a migration semeia um catálogo não vazio", () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(TIPOS_NOTIFICACAO.length);
  });

  it("toda forma CANÔNICA do registry existe no catálogo do banco", () => {
    for (const t of TIPOS_NOTIFICACAO) {
      const esperada = `${t.kind}|${t.escopo}|${t.modulo ?? "-"}|${t.permissionKey}`;
      expect(CATALOGO.map(chave), `${t.kind}: forma canônica ausente na 0012`).toContain(esperada);
    }
  });

  it("todo tipo que declara empresa opcional tem a forma de organização declarada, e só ele", () => {
    const comOrganizacao = new Set(CATALOGO.filter((l) => l.escopo === "organizacao").map((l) => l.kind));
    for (const t of TIPOS_NOTIFICACAO) {
      const podeOrganizacao = t.escopo === "organizacao" || t.empresaOpcional === true;
      expect(comOrganizacao.has(t.kind), `${t.kind}: escopo de organização ${podeOrganizacao ? "deveria" : "NÃO pode"} estar no catálogo`).toBe(podeOrganizacao);
    }
  });

  it("nenhuma linha do catálogo é de um tipo que o registry não conhece", () => {
    const conhecidos = new Set(TIPOS_NOTIFICACAO.map((t) => t.kind));
    for (const l of CATALOGO) expect(conhecidos.has(l.kind), `${l.kind} está no banco e não no registry`).toBe(true);
  });

  it("toda linha usa a capacidade declarada pelo tipo — o catálogo não inventa permissão", () => {
    const permissaoDo = new Map(TIPOS_NOTIFICACAO.map((t) => [t.kind, t.permissionKey]));
    for (const l of CATALOGO) expect(l.permissao, `${l.kind}`).toBe(permissaoDo.get(l.kind));
  });

  it("toda capacidade usada existe de verdade no catálogo de permissões", () => {
    const reais = new Set(allPermissionKeys());
    for (const t of TIPOS_NOTIFICACAO) expect(reais.has(t.permissionKey), `${t.kind}: ${t.permissionKey} não é permissão real`).toBe(true);
  });

  it("todo módulo usado é do catálogo de módulos de escopo empresarial", () => {
    const modulos = new Set(MODULOS_ESCOPO_EMPRESA.map((m) => m.chave));
    for (const l of CATALOGO) if (l.moduloRef !== "-") expect(modulos.has(l.moduloRef), l.moduloRef).toBe(true);
    for (const t of TIPOS_NOTIFICACAO) if (t.modulo) expect(modulos.has(t.modulo), t.modulo).toBe(true);
  });

  it("escopo e módulo são coerentes em toda linha (mesma regra da constraint do banco)", () => {
    for (const l of CATALOGO) {
      if (l.escopo === "organizacao") expect(l.moduloRef, `${l.kind}: organização não tem módulo`).toBe("-");
      else expect(l.moduloRef, `${l.kind}: ${l.escopo} exige módulo`).not.toBe("-");
    }
  });

  it("o registry declara capacidade para todos os tipos — nenhuma linha visível sem capacidade", () => {
    for (const t of TIPOS_NOTIFICACAO) expect(t.permissionKey, t.kind).toBeTruthy();
  });
});
