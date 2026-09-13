import { describe, it, expect } from "vitest";
import { autorizacaoPorModulo, AUTORIZACAO_PROPRIETARIO, escopoDoModulo, moduloAcessivel } from "@erp/plataforma";
import { allPermissionKeys, PERMISSION_RESOURCES } from "../src/permissions.js";
import {
  CHAVES_MODULO_EMPRESA, EXCECOES_ESCOPO, MODULOS_ESCOPO_EMPRESA, escopoDaPermissao, escopoDoRecurso,
  moduloDaPermissao, modulosDasPermissoes, moduloEmpresaValido, recursoDaPermissao,
  resumoClassificacaoEscopo, validarClassificacaoEscopo
} from "../src/escopo-permissao.js";

/**
 * A classificação de escopo é a metade "ONDE" da autorização. Se um recurso ficar sem classificação, a porta
 * dele não sabe qual módulo aplicar — e o que não sabe o escopo não pode ser liberado. Por isso o gate é
 * exaustivo: TODA permission key do catálogo real precisa cair em organização ou em empresa+módulo válido.
 */
describe("catálogo de módulos de escopo empresarial", () => {
  it("é íntegro e não inclui Início, Relatórios nem Configurações como escopo próprio", () => {
    expect(validarClassificacaoEscopo()).toEqual([]);
    for (const proibido of ["inicio", "relatorios", "configuracoes", "painel", "admin"]) {
      expect(moduloEmpresaValido(proibido), proibido).toBe(false);
    }
  });
  it("os módulos de negócio esperados existem", () => {
    for (const m of ["compras", "estoque", "financeiro", "vendas", "pecuaria", "confinamento", "frota_ativos", "pessoas_rh", "ordens_servico", "fiscal"]) {
      expect(moduloEmpresaValido(m), m).toBe(true);
    }
    expect(MODULOS_ESCOPO_EMPRESA.length).toBe(CHAVES_MODULO_EMPRESA.length);
  });
});

describe("classificação de TODA permissão", () => {
  it("nenhuma permission key fica ambígua", () => {
    const semClassificacao = allPermissionKeys().filter((k) => !escopoDaPermissao(k));
    expect(semClassificacao).toEqual([]);
    expect(allPermissionKeys().length).toBeGreaterThan(700);
  });
  it("a ação é sempre o último segmento — recursos com ponto continuam íntegros", () => {
    expect(recursoDaPermissao("payables.view")).toBe("payables");
    expect(recursoDaPermissao("report.dre.export")).toBe("report.dre");
    expect(recursoDaPermissao("integration.cta_smart.sync")).toBe("integration.cta_smart");
    expect(moduloDaPermissao("report.dre.view")).toBe("financeiro");
  });
  it("recurso de empresa devolve módulo; recurso de organização devolve null", () => {
    expect(moduloDaPermissao("stock_writeoffs.create")).toBe("estoque");
    expect(moduloDaPermissao("payables.view")).toBe("financeiro");
    expect(moduloDaPermissao("animals.view")).toBe("pecuaria");
    expect(moduloDaPermissao("fuel_supplies.view")).toBe("frota_ativos");
    expect(moduloDaPermissao("service_orders.view")).toBe("ordens_servico");
    expect(moduloDaPermissao("users.view")).toBeNull();
    expect(moduloDaPermissao("roles.edit")).toBeNull();
    expect(moduloDaPermissao("tenant_parameters.edit")).toBeNull();
  });
  it("permissão desconhecida LANÇA — porta nova sem classificação não vira acesso irrestrito", () => {
    expect(() => moduloDaPermissao("recurso_inventado.view")).toThrowError(/sem classificação/i);
  });
  it("relatórios e painéis respeitam o módulo da INFORMAÇÃO, não uma gaveta genérica", () => {
    expect(moduloDaPermissao("report.payables.view")).toBe("financeiro");
    expect(moduloDaPermissao("report.animals.view")).toBe("pecuaria");
    expect(moduloDaPermissao("report.stock_movement.view")).toBe("estoque");
    expect(moduloDaPermissao("report.machines.view")).toBe("frota_ativos");
    expect(moduloDaPermissao("report.sales_client.view")).toBe("vendas");
    expect(moduloDaPermissao("dashboard.financial.view")).toBe("financeiro");
    expect(moduloDaPermissao("dashboard.livestock.view")).toBe("pecuaria");
    expect(moduloDaPermissao("dashboard.feedlot.view")).toBe("confinamento");
    // o painel inicial combina áreas: a capacidade é da organização e cada bloco aplica o módulo da sua fonte
    expect(moduloDaPermissao("dashboard.home.view")).toBeNull();
  });
  it("todo recurso classificado como organização com tabela de empresa tem justificativa registrada", () => {
    for (const k of Object.keys(EXCECOES_ESCOPO)) {
      expect(escopoDoRecurso(k)?.tipo, k).toBe("organizacao");
      expect(EXCECOES_ESCOPO[k]!.length, k).toBeGreaterThan(40);
    }
  });
  it("a distribuição cobre o catálogo inteiro", () => {
    const r = resumoClassificacaoEscopo();
    expect(r.organizacao + r.empresa).toBe(PERMISSION_RESOURCES.length);
    expect(r.empresa).toBeGreaterThan(r.organizacao);
    for (const m of CHAVES_MODULO_EMPRESA) expect(r.porModulo[m], m).toBeGreaterThan(0);
  });
  it("módulos de um conjunto de permissões (para a tela de administração)", () => {
    expect(modulosDasPermissoes(["payables.view", "animals.view", "users.view"])).toEqual(["financeiro", "pecuaria"]);
    expect(modulosDasPermissoes(["users.view", "roles.edit"])).toEqual([]);
  });
});

describe("interseção capacidade × escopo (mecanismo neutro + classificação do produto)", () => {
  const joao = autorizacaoPorModulo([["estoque", "todas"], ["financeiro", "selecionadas"]]);

  it("módulo sem configuração é fail-closed — nem o dono da permissão entra", () => {
    expect(escopoDoModulo(joao, moduloDaPermissao("animals.view"))).toEqual({ tipo: "nenhuma" });
    expect(moduloAcessivel(joao, "pecuaria")).toBe(false);
  });
  it("modo todas e modo selecionadas convivem em módulos diferentes do MESMO usuário", () => {
    expect(escopoDoModulo(joao, moduloDaPermissao("stocks.view"))).toEqual({ tipo: "todas" });
    expect(escopoDoModulo(joao, moduloDaPermissao("payables.view"))).toEqual({ tipo: "selecionadas" });
  });
  it("proprietário enxerga todos os módulos, inclusive os criados depois", () => {
    for (const m of [...CHAVES_MODULO_EMPRESA, "modulo_futuro"]) {
      expect(escopoDoModulo(AUTORIZACAO_PROPRIETARIO, m), m).toEqual({ tipo: "todas" });
    }
  });
  it("recurso de organização não tem módulo a cruzar: a capacidade basta", () => {
    expect(moduloDaPermissao("users.view")).toBeNull();
    // escopo de módulo nulo em usuário não-proprietário é "nenhuma": quem chama trata organização antes
    expect(escopoDoModulo(joao, null)).toEqual({ tipo: "nenhuma" });
  });
});
