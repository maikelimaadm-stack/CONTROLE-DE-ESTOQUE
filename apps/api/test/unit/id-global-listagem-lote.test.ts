import { describe, it, expect } from "vitest";
import { anexarIdsGlobais, paginaComIdGlobal } from "../../src/lib/id-global.js";
import type { ServiceCtx } from "../../src/lib/context.js";

/**
 * ENRIQUECIMENTO EM LOTE — A GARANTIA É ARITMÉTICA (PRE-BASE2-05B.1).
 *
 * O requisito "uma página = no máximo UMA consulta extra" não se prova lendo o código: prova-se CONTANDO.
 * Uma refatoração inocente (um `for` com `await` dentro, um `map` assíncrono por linha) transformaria a
 * listagem de 100 linhas em 100 idas ao banco sem mudar uma única asserção funcional — e só apareceria em
 * produção, como lentidão. Por isso este arquivo conta consultas, e não resultados.
 *
 * O contexto aqui é falso de propósito: o que está sob teste é a FORMA de perguntar, não a resposta do banco.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const uuid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

function ctxFalso(numeros: Record<string, number> = {}) {
  const consultas: { sql: string; params: unknown[] }[] = [];
  const ctx = {
    orgId: ORG,
    tx: {
      query: async (sql: string, params: unknown[] = []) => {
        consultas.push({ sql, params });
        const ids = (params[2] as string[] | undefined) ?? [];
        return { rows: ids.filter((id) => numeros[id] !== undefined).map((id) => ({ id_entidade: id, id_global: String(numeros[id]) })), rowCount: 0 };
      }
    }
  } as unknown as ServiceCtx;
  return { ctx, consultas };
}

describe("uma página, uma consulta", () => {
  it("100 linhas produzem EXATAMENTE uma consulta — nunca uma por linha", async () => {
    const linhas = Array.from({ length: 100 }, (_, i) => ({ id: uuid(i), nome: `linha ${i}` }));
    const { ctx, consultas } = ctxFalso(Object.fromEntries(linhas.map((l, i) => [l.id, i + 1])));
    const saida = await anexarIdsGlobais(ctx, "products", linhas);
    expect(consultas).toHaveLength(1);
    expect(saida).toHaveLength(100);
    expect(saida[0]!.id_global).toBe(1);
    expect(saida[99]!.id_global).toBe(100);
  });

  it("página vazia não consulta nada", async () => {
    const { ctx, consultas } = ctxFalso();
    expect(await anexarIdsGlobais(ctx, "products", [])).toEqual([]);
    expect(consultas).toHaveLength(0);
  });

  it("ids repetidos (a mesma entidade em duas linhas) viajam UMA vez só", async () => {
    const { ctx, consultas } = ctxFalso({ [uuid(1)]: 7 });
    await anexarIdsGlobais(ctx, "products", [{ id: uuid(1) }, { id: uuid(1) }, { id: uuid(1) }]);
    expect(consultas).toHaveLength(1);
    expect((consultas[0]!.params[2] as string[])).toEqual([uuid(1)]);
  });

  it("a consulta é sempre recortada por organização E tipo de entidade", async () => {
    const { ctx, consultas } = ctxFalso();
    await anexarIdsGlobais(ctx, "animals", [{ id: uuid(3) }]);
    expect(consultas[0]!.params[0]).toBe(ORG);
    expect(consultas[0]!.params[1]).toBe("animals");
    expect(consultas[0]!.sql).toContain("organization_id=$1");
    expect(consultas[0]!.sql).toContain("tipo_entidade=$2");
  });
});

describe("ausência de número é resposta, não falha", () => {
  it("registro sem índice global sai com id_global nulo", async () => {
    const { ctx } = ctxFalso({ [uuid(1)]: 5 });
    const saida = await anexarIdsGlobais(ctx, "animal_movements", [{ id: uuid(1) }, { id: uuid(2) }]);
    expect(saida.map((x) => x.id_global)).toEqual([5, null]);
  });

  it("linha sem id, ou com id que não é UUID, sai nula — e não vai para o banco", async () => {
    const { ctx, consultas } = ctxFalso({ [uuid(1)]: 5 });
    const saida = await anexarIdsGlobais(ctx, "products", [{ id: uuid(1) }, { id: null }, { id: "nao-e-uuid" }, {}]);
    expect(saida.map((x) => x.id_global)).toEqual([5, null, null, null]);
    expect((consultas[0]!.params[2] as string[]), "só UUID chega à coluna uuid — nada de texto livre").toEqual([uuid(1)]);
  });

  it("coluna de id alternativa é respeitada sem mexer no resto da linha", async () => {
    const { ctx } = ctxFalso({ [uuid(9)]: 42 });
    const saida = await anexarIdsGlobais(ctx, "products", [{ id: uuid(1), movement_id: uuid(9) }], { coluna: "movement_id" });
    expect(saida[0]!.id_global).toBe(42);
    expect(saida[0]!.id).toBe(uuid(1));
  });
});

describe("a página DECLARA o tipo, e o cliente não precisa do catálogo", () => {
  it("a marca traz tipo e rótulo do catálogo, preservando o resto da resposta", async () => {
    const { ctx } = ctxFalso({ [uuid(1)]: 3 });
    const pagina = await paginaComIdGlobal(ctx, "financial_titles", { items: [{ id: uuid(1) }] as Record<string, unknown>[], total: 1, page: 1, pageSize: 20, totals: { amount: "10" } });
    expect(pagina.idGlobal).toEqual({ tipoEntidade: "financial_titles", rotulo: "Título Financeiro" });
    expect(pagina.total).toBe(1);
    expect(pagina.totals).toEqual({ amount: "10" });
    expect(pagina.items[0]!["id_global"]).toBe(3);
  });

  it("tipo fora do catálogo é ERRO do chamador, nunca uma listagem silenciosamente sem número", async () => {
    const { ctx } = ctxFalso();
    await expect(anexarIdsGlobais(ctx, "purchase_request", [{ id: uuid(1) }])).rejects.toThrow(/sem ID Global/i);
    await expect(paginaComIdGlobal(ctx, "nao_existe", { items: [] })).rejects.toThrow(/sem ID Global/i);
  });
});
