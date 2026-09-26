import { describe, it, expect } from "vitest";
import { LAYOUT_DO_SISTEMA, type EstruturaLayout } from "@agro/domain";
import { conferirPadroesRegistro } from "../../src/lib/layout-documento.js";
import type { ServiceCtx } from "../../src/lib/context.js";

/**
 * VENDAS-A3-1b · conferência do padrão de CADASTRO — a FORMA de perguntar ao banco (contexto falso de propósito).
 * UMA consulta por recurso presente (`= any($1::uuid[])`, organização em `$2`), nunca uma por campo; id fora da forma
 * UUID nunca chega ao banco; o filtro do catálogo decide cada campo mesmo quando o registro é o mesmo; a ordem dos
 * inválidos é a da estrutura. A resposta do banco (recorte, ativo, vivo) é provada na integração.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const u = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Linha = Record<string, unknown> & { id: string };

function ctxFalso(tabelas: Record<string, Linha[]>) {
  const consultas: { tabela: string; sql: string; params: unknown[] }[] = [];
  const ctx = {
    orgId: ORG,
    tx: {
      query: async (sql: string, params: unknown[] = []) => {
        const tabela = /from erp\.(\w+) t/.exec(sql)?.[1] ?? "?";
        consultas.push({ tabela, sql, params });
        const ids = params[0] as string[];
        const rows = (tabelas[tabela] ?? []).filter((l) => ids.includes(l.id));
        return { rows, rowCount: rows.length };
      }
    }
  } as unknown as ServiceCtx;
  return { ctx, consultas };
}

function com(padroes: Record<string, string>): EstruturaLayout {
  const e = structuredClone(LAYOUT_DO_SISTEMA("vendas.venda"));
  for (const x of e.cabecalho) if (padroes[x.campo]) x.valorPadrao = { tipo: "registro", id: padroes[x.campo]! };
  for (const a of e.rodape) for (const x of a.campos) if (padroes[x.campo]) x.valorPadrao = { tipo: "registro", id: padroes[x.campo]! };
  for (const x of e.itens) if (padroes[`itens.${x.campo}`]) x.valorPadrao = { tipo: "registro", id: padroes[`itens.${x.campo}`]! };
  return e;
}

const pessoa = (id: string, f: Partial<Record<"f_cliente" | "f_proprietario" | "f_transportadora", boolean>>, rotulo = `Pessoa ${id.slice(-2)}`): Linha =>
  ({ id, rotulo, empresa_id: null, f_cliente: false, f_proprietario: false, f_transportadora: false, ...f });

describe("conferirPadroesRegistro — lote e whitelist", () => {
  it("sem padrão registro: nenhuma consulta", async () => {
    const { ctx, consultas } = ctxFalso({});
    const r = await conferirPadroesRegistro(ctx, "vendas.venda", LAYOUT_DO_SISTEMA("vendas.venda"));
    expect(consultas).toHaveLength(0);
    expect([...r.validos]).toEqual([]);
    expect(r.invalidos).toEqual([]);
  });

  it("oito padrões em seis cadastros → EXATAMENTE seis consultas, uma por recurso, com os ids em lote", async () => {
    const tabelas = {
      people: [pessoa(u(1), { f_cliente: true }, "Cliente A"), pessoa(u(2), { f_proprietario: true }, "Dono B"), pessoa(u(3), { f_transportadora: true }, "Transp C")],
      payment_methods: [{ id: u(4), rotulo: "Pix", empresa_id: null, f_todos: true }],
      financial_categories: [{ id: u(5), rotulo: "Venda de gado", empresa_id: null, f_analitica_receita: true }],
      cost_centers: [{ id: u(6), rotulo: "Pecuária", empresa_id: null, f_analitico: true }],
      condicoes_pagamento: [{ id: u(7), rotulo: "30 dias", empresa_id: null, f_todos: true }],
      warehouses: [{ id: u(8), rotulo: "Almoxarifado", empresa_id: u(99), f_todos: true }]
    };
    const { ctx, consultas } = ctxFalso(tabelas);
    const r = await conferirPadroesRegistro(ctx, "vendas.venda", com({
      client_id: u(1), proprietary_id: u(2), transporter_id: u(3), payment_method_id: u(4), categoria_financeira_id: u(5),
      centro_custo_id: u(6), condicao_pagamento_id: u(7), "itens.warehouse_id": u(8)
    }));
    expect(consultas.map((c) => c.tabela).sort()).toEqual(["condicoes_pagamento", "cost_centers", "financial_categories", "payment_methods", "people", "warehouses"]);
    for (const c of consultas) {
      expect(c.sql).toContain("t.id = any($1::uuid[])");
      expect(c.params[1]).toBe(ORG);
    }
    expect((consultas.find((c) => c.tabela === "people")!.params[0] as string[]).sort()).toEqual([u(1), u(2), u(3)]);
    expect(r.invalidos).toEqual([]);
    expect(Object.fromEntries(r.validos)).toEqual({
      client_id: { id: u(1), rotulo: "Cliente A" }, proprietary_id: { id: u(2), rotulo: "Dono B" }, transporter_id: { id: u(3), rotulo: "Transp C" },
      payment_method_id: { id: u(4), rotulo: "Pix" }, categoria_financeira_id: { id: u(5), rotulo: "Venda de gado" },
      centro_custo_id: { id: u(6), rotulo: "Pecuária" }, condicao_pagamento_id: { id: u(7), rotulo: "30 dias" },
      "itens.warehouse_id": { id: u(8), rotulo: "Almoxarifado", empresaId: u(99) }
    });
  });

  it("o MESMO registro em dois campos: uma consulta com o id uma vez; cada campo julgado pelo SEU filtro", async () => {
    const { ctx, consultas } = ctxFalso({ people: [pessoa(u(1), { f_cliente: true }, "Só cliente")] });
    const r = await conferirPadroesRegistro(ctx, "vendas.venda", com({ client_id: u(1), transporter_id: u(1) }));
    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.params[0]).toEqual([u(1)]);
    expect([...r.validos.keys()]).toEqual(["client_id"]);
    expect(r.invalidos).toEqual([{ chave: "transporter_id", caminho: "rodape[2].campos[0].valorPadrao", rotulo: "Transportadora" }]);
  });

  it("id fora da forma UUID nunca chega ao banco; inexistente é inválido; a ordem dos inválidos é a da estrutura", async () => {
    const { ctx, consultas } = ctxFalso({ people: [] });
    const r = await conferirPadroesRegistro(ctx, "vendas.venda", com({ client_id: "nao-e-uuid", proprietary_id: u(2), "itens.warehouse_id": "1; drop table x" }));
    expect(consultas.map((c) => c.tabela)).toEqual(["people"]);
    expect(consultas[0]!.params[0]).toEqual([u(2)]);
    expect(r.invalidos.map((x) => x.chave)).toEqual(["client_id", "proprietary_id", "itens.warehouse_id"]);
    expect(r.invalidos.map((x) => x.caminho)).toEqual(["cabecalho[0].valorPadrao", "cabecalho[8].valorPadrao", "itens[2].valorPadrao"]);
  });

  it("UUID em maiúsculas é consultado na forma canônica e devolve o id do cadastro", async () => {
    const { ctx, consultas } = ctxFalso({ condicoes_pagamento: [{ id: u(7), rotulo: "30 dias", empresa_id: null, f_todos: true }] });
    const r = await conferirPadroesRegistro(ctx, "vendas.venda", com({ condicao_pagamento_id: u(7).toUpperCase() }));
    expect(consultas[0]!.params[0]).toEqual([u(7)]);
    expect(r.validos.get("condicao_pagamento_id")).toEqual({ id: u(7), rotulo: "30 dias" });
  });

  it("campo sem `referencia` no catálogo (família sem catálogo) → inválido, sem consulta", async () => {
    const { ctx, consultas } = ctxFalso({});
    const r = await conferirPadroesRegistro(ctx, "estoque.baixa", com({ client_id: u(1) }));
    expect(consultas).toHaveLength(0);
    expect(r.invalidos.map((x) => x.chave)).toEqual(["client_id"]);
  });
});
