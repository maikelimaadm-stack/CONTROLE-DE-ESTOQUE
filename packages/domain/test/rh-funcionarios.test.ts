import { describe, it, expect } from "vitest";
import { campoVisivel, chavesBarradas, getResource } from "../src/index.js";

/**
 * CADASTROS Fase 5 — a declaração do cadastro `funcionarios` (a API aplica; aqui se prova que o registry diz o
 * que a decisão 255 promete). A coerência geral das abas é de `ficha-em-abas.test.ts`.
 */
const def = getResource("funcionarios")!;
const campoDoPerfil = (nome: string) => def.perfis!.flatMap((p) => p.fields).find((f) => f.name === nome);

describe("funcionarios — registry", () => {
  it("é o parceiro (tabela people) com recorte fixo de Funcionário e permissão employees", () => {
    expect(def).toBeDefined();
    expect(def.table).toBe("people");
    expect(def.permission).toBe("employees");
    expect(def.filtroFixo).toEqual({ is_employee: true });
  });

  it("nasce pelo CPF, nunca pela porta genérica", () => {
    expect(def.criacao?.rota).toBe("/api/hr/funcionarios/por-cpf");
    expect(def.criacao?.campos).toEqual(["document", "name"]);
  });

  it("salário base, valor hora, meta e comissão são SIGILOSOS (employees.edit); nenhum outro campo é (R1-2)", () => {
    for (const n of ["base_salary", "hour_value", "goal_salary", "commission_percent"]) expect(campoDoPerfil(n)?.sigilo, n).toBe("employees.edit");
    const sigilosos = [...def.fields, ...def.perfis!.flatMap((p) => p.fields), ...def.detalhes!.flatMap((d) => d.fields)].filter((f) => f.sigilo).map((f) => f.name);
    expect(sigilosos.sort()).toEqual(["base_salary", "commission_percent", "goal_salary", "hour_value"]);
  });

  it("Funções: salário e valor hora com o MESMO sigilo da ficha (R1-2)", () => {
    const f = getResource("job_functions")!;
    expect(f.fields.filter((x) => x.sigilo).map((x) => [x.name, x.sigilo])).toEqual([["base_salary", "employees.edit"], ["hour_value", "employees.edit"]]);
  });

  it("grades que gravam OUTRO cadastro obedecem às permissões dele (R1-2): Eventos fixos = employee_events.*, Equipes = teams.*", () => {
    const d = (k: string) => def.detalhes!.find((x) => x.key === k)!;
    expect(d("eventos").permissoes).toEqual({ ler: "employee_events.view", criar: "employee_events.create", editar: "employee_events.edit", excluir: "employee_events.delete" });
    expect(d("equipes").permissoes).toEqual({ ler: "teams.view", criar: "teams.edit", editar: "teams.edit", excluir: "teams.edit" });
    // a MESMA pergunta da API e da tela: sem a leitura a grade é barrada; sem nenhuma escrita, barrada na edição
    const so = (ps: string[]) => (p: string) => ps.includes(p);
    expect([...chavesBarradas(def, "permissaoDeLeitura", so(["employees.view"]))].sort()).toEqual(["equipes", "eventos"]);
    expect([...chavesBarradas(def, "permissaoDeLeitura", so(["employee_events.view", "teams.view"]))]).toEqual([]);
    expect([...chavesBarradas(def, "permissaoDeEdicao", so(["employee_events.view", "teams.view"]))].sort()).toEqual(["equipes", "eventos"]);
    expect([...chavesBarradas(def, "permissaoDeEdicao", so(["employee_events.create"]))]).toEqual(["equipes"]);
    expect(campoVisivel(campoDoPerfil("base_salary")!, so(["employees.view"]))).toBe(false);
    expect(campoVisivel(campoDoPerfil("base_salary")!, so(["employees.edit"]))).toBe(true);
    expect(campoVisivel(campoDoPerfil("jornada_semanal")!, so([]))).toBe(true);
  });

  it("aba Pessoal exige people.edit e cobre TODOS os campos do principal que se gravam", () => {
    const pessoal = def.abas!.find((a) => a.key === "pessoal")!;
    expect(pessoal.permissaoDeEdicao).toBe("people.edit");
    const gravaveis = def.fields.filter((f) => !f.readOnly);
    expect(gravaveis.length).toBeGreaterThan(0);
    for (const f of gravaveis) expect(pessoal.secoes, f.name).toContain(f.section);
  });

  it("todos os perfis são a MESMA linha 1:1 de employee_profiles; abas na ordem da spec", () => {
    expect(new Set(def.perfis!.map((p) => `${p.table}:${p.chavePai}`))).toEqual(new Set(["employee_profiles:person_id"]));
    expect(def.abas!.map((a) => a.label)).toEqual(["Pessoal", "Admissão e lotação", "Remuneração", "Documentos", "Pagamento", "Desligamento", "Eventos fixos", "Usuário do sistema"]);
  });

  it("Funções buscam o CBO na referência oficial", () => {
    expect(getResource("job_functions")!.fields.find((f) => f.name === "cbo_code")?.busca).toBe("cbo");
  });
});
