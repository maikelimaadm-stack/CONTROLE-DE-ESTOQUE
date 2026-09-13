import { describe, it, expect } from "vitest";
import { colunaDiscriminadora, formatarIdGlobal, interpretarIdGlobal, tabelaTecnica, variantesDeclaradas } from "@erp/plataforma";
import {
  CONSULTA_CADASTRO, ENTIDADES_ID_GLOBAL, elegivelAIdGlobal, entidadeIdGlobal,
  resolverRegistroGlobal, tiposEntidadeIdGlobal, validarRegistroIdGlobal
} from "../src/id-global.js";
import { MOVIMENTACOES_INTERNAS, MANEJOS_REBANHO, MOVIMENTACOES_REBANHO } from "../src/rebanho.js";
import { DICIONARIO_DE_DADOS } from "../dicionario-dados.mjs";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("registry de elegibilidade", () => {
  it("é internamente consistente (sem duplicados, rota com :id, permissão válida, nada técnico)", () => {
    expect(validarRegistroIdGlobal()).toEqual([]);
  });
  it("entidades com identidade própria são elegíveis", () => {
    for (const t of ["input_entries", "financial_titles", "animals", "service_orders", "products", "roles"]) {
      expect(elegivelAIdGlobal(t), t).toBe(true);
    }
  });
  it("linhas técnicas NUNCA são elegíveis", () => {
    for (const t of ["input_entry_items", "title_apportionments", "member_farms", "role_permissions", "service_order_lines"]) {
      expect(elegivelAIdGlobal(t), t).toBe(false);
      expect(tabelaTecnica(`erp.${t}`).tecnica, t).toBe(true);
    }
  });
  it("infraestrutura interna não é elegível", () => {
    expect(tabelaTecnica("erp.code_sequences").tecnica).toBe(true);
    expect(tabelaTecnica("erp.sequencias_id_global").tecnica).toBe(true);
    expect(tabelaTecnica("erp.registros_globais").tecnica).toBe(true);
    expect(tabelaTecnica("erp.input_entries").tecnica).toBe(false);
  });
});

describe("formato do ID Global", () => {
  it("exibe com # e aceita as duas grafias na leitura", () => {
    expect(formatarIdGlobal(55)).toBe("#55");
    expect(formatarIdGlobal("#55")).toBe("#55");
    expect(interpretarIdGlobal("#55")).toBe(55);
    expect(interpretarIdGlobal(" 55 ")).toBe(55);
    expect(interpretarIdGlobal(55)).toBe(55);
  });
  it("recusa entrada inválida sem lançar", () => {
    for (const v of ["", "#", "abc", "#0", "-3", "1.5", "#12a", null, undefined, {}]) expect(interpretarIdGlobal(v as unknown), String(v)).toBeNull();
  });
});

describe("rota e permissão vêm do MESMO registro", () => {
  it("entidade fixa resolve rota e permissão sem consultar discriminador", () => {
    expect(resolverRegistroGlobal("input_entries", ID)).toEqual({ rota: `/estoque/entradas/${ID}`, permissao: "input_entries.view" });
    expect(colunaDiscriminadora(entidadeIdGlobal("input_entries")!)).toBeNull();
  });

  it("título financeiro: pagar e receber têm permissões DIFERENTES", () => {
    expect(resolverRegistroGlobal("financial_titles", ID, { direction: "payable" }))
      .toEqual({ rota: `/financeiro/contas-a-pagar/${ID}`, permissao: "payables.view" });
    expect(resolverRegistroGlobal("financial_titles", ID, { direction: "receivable" }))
      .toEqual({ rota: `/financeiro/contas-a-receber/${ID}`, permissao: "receivables.view" });
  });

  it("documento de venda: orçamento, pedido e venda têm permissões DIFERENTES", () => {
    expect(resolverRegistroGlobal("sales_documents", ID, { kind: "budget" })).toEqual({ rota: `/vendas/budgets/${ID}`, permissao: "budgets.view" });
    expect(resolverRegistroGlobal("sales_documents", ID, { kind: "order" })).toEqual({ rota: `/vendas/orders/${ID}`, permissao: "orders.view" });
    expect(resolverRegistroGlobal("sales_documents", ID, { kind: "sale" })).toEqual({ rota: `/vendas/sales/${ID}`, permissao: "sales.view" });
  });

  it("manejo e movimentação: uma permissão por tipo, igual à matriz funcional já usada nos anexos", () => {
    for (const o of MANEJOS_REBANHO) {
      expect(resolverRegistroGlobal("animal_handlings", ID, { handling_type: o.tipo }), o.tipo).toEqual({ rota: `/pecuaria/manejo/${o.tipo}/${ID}`, permissao: `${o.recurso}.view` });
    }
    for (const o of MOVIMENTACOES_REBANHO) {
      expect(resolverRegistroGlobal("animal_movements", ID, { movement_type: o.tipo }), o.tipo).toEqual({ rota: `/pecuaria/movimentacoes/${o.tipo}/${ID}`, permissao: `${o.recurso}.view` });
    }
  });

  it("FAIL-CLOSED: discriminador ausente, desconhecido ou de outro tipo NEGA (nunca cai em permissão mais ampla)", () => {
    expect(resolverRegistroGlobal("financial_titles", ID)).toBeNull();
    expect(resolverRegistroGlobal("financial_titles", ID, { direction: "outro" })).toBeNull();
    expect(resolverRegistroGlobal("financial_titles", ID, { direction: null })).toBeNull();
    // tipos de movimentação que são efeito de outra operação e não têm tela própria
    for (const t of MOVIMENTACOES_INTERNAS) {
      expect(resolverRegistroGlobal("animal_movements", ID, { movement_type: t }), t).toBeNull();
    }
    expect(resolverRegistroGlobal("nao_existe", ID)).toBeNull();
  });

  it("nenhuma entidade com variantes resolve todas para a mesma permissão", () => {
    for (const e of ENTIDADES_ID_GLOBAL) {
      if (e.resolucao.tipo !== "variante") continue;
      const permissoes = new Set(Object.values(e.resolucao.variantes).map((v) => v.permissao));
      expect(permissoes.size, `${e.tipoEntidade}: variantes com permissão única deveriam ser resolução fixa`).toBeGreaterThan(1);
    }
  });

  it("toda variante declarada tem rota e permissão próprias e resolvíveis", () => {
    for (const e of ENTIDADES_ID_GLOBAL) {
      const coluna = colunaDiscriminadora(e);
      if (!coluna) continue;
      for (const valor of variantesDeclaradas(e)) {
        const r = resolverRegistroGlobal(e.tipoEntidade, ID, { [coluna]: valor });
        expect(r, `${e.tipoEntidade}[${valor}]`).not.toBeNull();
        expect(r!.rota).toContain(ID);
        expect(r!.permissao).toMatch(/^[a-z_]+\.[a-z_]+$/);
      }
    }
  });
});

describe("rota canônica de cadastro abre em consulta", () => {
  it("cadastros genéricos (Modelo Base1) usam o modo de visualização, não o de edição", () => {
    for (const t of ["products", "people", "equipments"]) {
      const r = resolverRegistroGlobal(t, ID)!;
      expect(r.rota, t).toBe(`/cadastros/${t}/${ID}${CONSULTA_CADASTRO}`);
    }
  });
  it("telas de detalhe próprias não recebem o parâmetro de consulta", () => {
    expect(resolverRegistroGlobal("roles", ID)!.rota).toBe(`/admin/perfis/${ID}`);
    expect(resolverRegistroGlobal("service_orders", ID)!.rota).toBe(`/os/${ID}`);
  });
});

describe("dicionário de dados × registry de ID Global", () => {
  it("as duas fontes concordam sobre quem recebe ID Global", () => {
    const doDicionario = DICIONARIO_DE_DADOS.filter((e) => e.idGlobal).map((e) => e.tabela.replace(/^erp\./, "")).sort();
    expect(doDicionario).toEqual(tiposEntidadeIdGlobal().sort());
  });
  it("as rotas canônicas do dicionário são as mesmas do registry, variante a variante", () => {
    for (const e of DICIONARIO_DE_DADOS.filter((d) => d.idGlobal)) {
      const tipo = e.tabela.replace(/^erp\./, "");
      const entidade = entidadeIdGlobal(tipo)!;
      if (e.discriminador || e.rotas) {
        expect(colunaDiscriminadora(entidade), e.codigo).toBe(e.discriminador);
        expect(Object.keys(e.rotas ?? {}).sort(), e.codigo).toEqual(variantesDeclaradas(entidade).sort());
        for (const [valor, rota] of Object.entries(e.rotas ?? {})) {
          expect(resolverRegistroGlobal(tipo, ":id", { [e.discriminador!]: valor })!.rota, `${e.codigo}[${valor}]`).toBe(rota);
        }
      } else {
        expect(colunaDiscriminadora(entidade), e.codigo).toBeNull();
        expect(e.rota, e.codigo).toBe(resolverRegistroGlobal(tipo, ":id")!.rota);
      }
    }
  });
});
