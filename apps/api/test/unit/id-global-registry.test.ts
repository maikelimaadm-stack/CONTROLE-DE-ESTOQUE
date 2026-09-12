import { describe, it, expect } from "vitest";
import { ENTIDADES_ID_GLOBAL, resolverRegistroGlobal, validarRegistroIdGlobal } from "@agro/domain";
import { colunaDiscriminadora, variantesDeclaradas } from "@erp/plataforma";
import { allPermissionKeys, MANEJOS_REBANHO, MOVIMENTACOES_INTERNAS, MOVIMENTACOES_REBANHO, TODOS_TIPOS_MOVIMENTACAO, permissaoManejo, permissaoMovimentacao } from "@agro/domain";
import { readFileSync } from "node:fs";
import { ATTACHMENT_PARENTS } from "../../src/lib/attachment-parent.js";

/**
 * O registry de ID Global vive no núcleo neutro (`@erp/plataforma`), que por contrato NUNCA importa o
 * catálogo de permissões do domínio. O cruzamento entre os dois acontece aqui, na API — que já depende dos
 * dois lados — para que segurança não fique dependendo de um texto livre nunca conferido.
 */
const CATALOGO = new Set(allPermissionKeys());

describe("registry de ID Global × catálogo de permissões", () => {
  it("o registry é estruturalmente íntegro", () => {
    expect(validarRegistroIdGlobal()).toEqual([]);
  });

  it("toda permissão declarada existe no catálogo real", () => {
    const desconhecidas: string[] = [];
    for (const e of ENTIDADES_ID_GLOBAL) {
      const r = e.resolucao;
      if (r.tipo === "fixa") {
        if (!CATALOGO.has(r.permissao)) desconhecidas.push(`${e.tipoEntidade}: ${r.permissao}`);
      } else {
        for (const [valor, v] of Object.entries(r.variantes)) {
          if (!CATALOGO.has(v.permissao)) desconhecidas.push(`${e.tipoEntidade}[${valor}]: ${v.permissao}`);
        }
      }
    }
    expect(desconhecidas).toEqual([]);
  });

  it("toda variante resolve rota e permissão, e nenhuma variante repete a permissão de outra", () => {
    for (const e of ENTIDADES_ID_GLOBAL) {
      const coluna = colunaDiscriminadora(e);
      if (!coluna) continue;
      const permissoes = new Set<string>();
      for (const valor of variantesDeclaradas(e)) {
        const resolvido = resolverRegistroGlobal(e.tipoEntidade, "id", { [coluna]: valor });
        expect(resolvido, `${e.tipoEntidade}[${valor}]`).not.toBeNull();
        expect(permissoes.has(resolvido!.permissao), `${e.tipoEntidade}[${valor}]: permissão repetida entre variantes`).toBe(false);
        permissoes.add(resolvido!.permissao);
      }
    }
  });

  /**
   * §12 — UMA FONTE SÓ. Os três consumidores da matriz de variantes de rebanho (registry de ID Global,
   * autorização de anexos e rotas operacionais) e o CHECK da coluna no banco não podem divergir. Se um tipo
   * entrar no banco sem entrar na fonte única — ou se algum consumidor voltar a manter cópia própria — este
   * teste quebra antes de virar brecha.
   */
  it("registry, anexos e rotas operacionais consomem a MESMA matriz de rebanho", () => {
    for (const o of MOVIMENTACOES_REBANHO) {
      const doRegistry = resolverRegistroGlobal("animal_movements", "id", { movement_type: o.tipo })?.permissao;
      const dosAnexos = (ATTACHMENT_PARENTS["animal_movements"]!.viewPerm as (r: Record<string, unknown>) => string | null)({ movement_type: o.tipo });
      expect(doRegistry, o.tipo).toBe(`${o.recurso}.view`);
      expect(dosAnexos, o.tipo).toBe(doRegistry);
      expect(permissaoMovimentacao(o.tipo, "view"), o.tipo).toBe(doRegistry);
    }
    for (const o of MANEJOS_REBANHO) {
      const doRegistry = resolverRegistroGlobal("animal_handlings", "id", { handling_type: o.tipo })?.permissao;
      const dosAnexos = (ATTACHMENT_PARENTS["animal_handlings"]!.viewPerm as (r: Record<string, unknown>) => string | null)({ handling_type: o.tipo });
      expect(doRegistry, o.tipo).toBe(`${o.recurso}.view`);
      expect(dosAnexos, o.tipo).toBe(doRegistry);
      expect(permissaoManejo(o.tipo, "view"), o.tipo).toBe(doRegistry);
    }
  });

  it("tipos internos são fail-closed nos três consumidores (sem ID Global, sem anexo, sem porta)", () => {
    for (const t of MOVIMENTACOES_INTERNAS) {
      expect(resolverRegistroGlobal("animal_movements", "id", { movement_type: t }), t).toBeNull();
      expect((ATTACHMENT_PARENTS["animal_movements"]!.viewPerm as (r: Record<string, unknown>) => string | null)({ movement_type: t }), t).toBeNull();
      expect(permissaoMovimentacao(t, "view"), t).toBeNull();
    }
  });

  it("a fonte única cobre exatamente os valores aceitos pelo banco (CHECK da coluna)", () => {
    const sql = readFileSync(new URL("../../../../supabase/migrations/0006_livestock.sql", import.meta.url), "utf8");
    const valores = (coluna: string) => {
      const m = new RegExp(`${coluna} text not null check \\(${coluna} in \\(([^)]*)\\)`, "s").exec(sql);
      return m![1]!.split(",").map((v) => v.trim().replace(/^'|'$/g, "")).filter(Boolean).sort();
    };
    expect(valores("movement_type")).toEqual([...TODOS_TIPOS_MOVIMENTACAO].sort());
    expect(valores("handling_type")).toEqual(MANEJOS_REBANHO.map((o) => o.tipo).sort());
  });

  it("o schema de criação de movimentação aceita só os tipos com tela própria", () => {
    const rota = readFileSync(new URL("../../src/routes/livestock.ts", import.meta.url), "utf8");
    const m = /movement_type: z\.enum\(\[([^\]]*)\]\)/.exec(rota);
    const aceitos = m![1]!.split(",").map((v) => v.trim().replace(/^"|"$/g, "")).filter(Boolean).sort();
    expect(aceitos).toEqual(MOVIMENTACOES_REBANHO.map((o) => o.tipo).sort());
  });
});
