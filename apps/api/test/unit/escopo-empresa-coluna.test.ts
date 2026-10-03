import { describe, it, expect } from "vitest";
import { AUTORIZACAO_PROPRIETARIO, autorizacaoPorModulo } from "@erp/plataforma";
import {
  empresaScope, empresaScopeAgregado, empresaScopeBuilder, empresaScopePar, empresaScopeSql, scopedById, sqlComEscopo,
  type ParamBuilder, type RequestContext
} from "../../src/lib/context.js";

/**
 * OPERACOES-01 F12 (decisão 288) — o escopo de empresa RECUSA a coluna solta.
 *
 * `exists (select 1 from erp.membro_empresas me where … and me.empresa_id=empresa_id)`: dentro da subconsulta o nome
 * solto é a coluna da própria membro_empresas, e o predicado vira constante ("o membro tem alguma empresa no módulo").
 * Todo helper de escopo passa por `colunaDeEmpresa`, que agora LANÇA para a coluna solta — para qualquer contexto,
 * inclusive o proprietário (que não emite o `exists`, e por isso esconderia o erro nos testes de dono). Com alias ou
 * qualificada, o predicado amarra a coluna da LINHA (`me.empresa_id=<alias>.empresa_id`).
 */
const ctx = (dono: boolean): RequestContext => ({
  user: { id: "00000000-0000-4000-8000-000000000001", email: "u@x", name: "U" },
  orgId: "00000000-0000-4000-8000-0000000000aa",
  empresaId: null,
  moduloEmpresa: "financeiro",
  membership: {
    orgId: "00000000-0000-4000-8000-0000000000aa", orgName: "t", roleId: null, isOwner: dono,
    memberId: "00000000-0000-4000-8000-0000000000bb",
    escopos: dono ? AUTORIZACAO_PROPRIETARIO : autorizacaoPorModulo([["financeiro", "selecionadas"]])
  },
  permissions: new Set<string>()
});
const construtor = (): ParamBuilder & { params: unknown[] } => { const params: unknown[] = []; return { params, add: (v) => { params.push(v); return `$${params.length}`; } }; };

/** Cada helper de escopo chamado com a coluna pedida. */
const HELPERS: [string, (c: RequestContext, col: string) => unknown][] = [
  ["empresaScope", (c, col) => empresaScope(c, col, [])],
  ["empresaScope nullable", (c, col) => empresaScope(c, col, [], { nullable: true })],
  ["empresaScopeSql", (c, col) => empresaScopeSql(c, col, [])],
  ["scopedById", (c, col) => scopedById(c, col, "00000000-0000-4000-8000-0000000000cc")],
  ["empresaScopeBuilder", (c, col) => empresaScopeBuilder(c, col, construtor())],
  ["empresaScopeAgregado", (c, col) => empresaScopeAgregado(c, col, [], ["00000000-0000-4000-8000-0000000000dd"])],
  ["empresaScopePar", (c, col) => empresaScopePar(c, [col, "t.empresa_destino_id"], [])],
  ["{{escopo:…}}", (c, col) => sqlComEscopo(c, `select 1 from erp.financial_titles t where {{escopo:${col}}}`, [])],
  ["{{escopo_nulo:…|modulo}}", (c, col) => sqlComEscopo(c, `select 1 from erp.financial_titles t where {{escopo_nulo:${col}|financeiro}}`, [])]
];
const SOLTA = /^escopo de empresa com a coluna solta "empresa_id": qualifique pela tabela \(alias\.empresa_id\)/;

describe("OPERACOES-01 F12 — escopo de empresa: a coluna solta é recusada", () => {
  it.each([["selecionadas", false], ["proprietário", true]] as [string, boolean][])("a coluna SOLTA lança em todo helper (%s)", (_n, dono) => {
    for (const [nome, chamar] of HELPERS) expect(() => chamar(ctx(dono), "empresa_id"), nome).toThrow(SOLTA);
  });

  it("com alias ou qualificada passa, e o predicado amarra a coluna da LINHA", () => {
    const sel = ctx(false);
    // Premissa: o contexto restrito emite o `exists` (sem ele, "amarra" não seria testado).
    expect(empresaScope(sel, "t", [])).toHaveLength(1);
    for (const [col, amarra] of [["t", "t.empresa_id"], ["t.empresa_id", "t.empresa_id"], ['"warehouses".empresa_id', '"warehouses".empresa_id'], ["f.id", "f.id"]]) {
      for (const [nome, chamar] of HELPERS) {
        const texto = JSON.stringify(chamar(sel, col!));
        expect([nome, col, texto.includes(`me.empresa_id=${JSON.stringify(amarra).slice(1, -1)}`)]).toEqual([nome, col, true]);
        expect([nome, col, /me\.empresa_id=empresa_id\b/.test(texto)]).toEqual([nome, col, false]);
      }
    }
    // O proprietário (escopo total) passa sem recorte de autorização — e sem lançar.
    expect(empresaScope(ctx(true), "t", [])).toEqual([]);
  });
});
