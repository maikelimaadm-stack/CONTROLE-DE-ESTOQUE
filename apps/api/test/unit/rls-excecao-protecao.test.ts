import { describe, it, expect } from "vitest";
// @ts-expect-error — classificação de RLS em JS puro, compartilhada com o gerador da matriz
import { protecaoDaExcecao, validarProtecaoDaExcecao, TABELAS_DE_EXCECAO } from "../../../../packages/domain/empresa-rls.mjs";

/**
 * A PROTEÇÃO DECLARADA TEM DE RECUSAR A POLÍTICA PERIGOSA (PRE-BASE2-05C-0).
 *
 * A primeira versão de `protecao` já cobrava nome, comando, permissividade e papéis — e ainda assim quatro
 * formas perigosas passavam verdes, todas alcançáveis por acidente:
 *   · `USING (true)` com `WITH CHECK` protegido (os dois textos eram concatenados antes da busca);
 *   · o inverso, `WITH CHECK (true)`;
 *   · papel EXTRA, porque a conferência era de subconjunto;
 *   · política PERMISSIVE extra convivendo com a correta — e PERMISSIVE combinam com OR.
 * E um quinto, do `api_child`: citar `tenant_visible` não prova o vínculo pai→filho.
 *
 * Estes casos rodam contra a função PURA, com linhas sintéticas de `pg_policies`. É o que permite provar a
 * RECUSA: montar essas políticas no banco de verdade exigiria DDL, e esta fatia é NO-DDL. O contraponto —
 * que a forma REAL do banco passa — é feito em `apps/api/test/integration/rls-matriz.test.ts`, contra o
 * `pg_policies` vivo. Um sem o outro não prova: só a dupla distingue "recusa o errado" de "recusa tudo".
 */
type Linha = { policyname: string; cmd: string; permissive: string; papeis: string[]; qual: string; with_check: string };

const JUNCAO = (pai: string, filho: string, coluna: string) =>
  `(EXISTS ( SELECT 1\n   FROM ${pai} p\n  WHERE ((p.id = ${filho}.${coluna}) AND erp.tenant_visible(p.organization_id))))`;

/**
 * A política REAL de erp.empresa_cost_centers, copiada do pg_policies (quebras de linha inclusive).
 *
 * A 05C-1 reescreveu essa política de `farm_id` para `empresa_id` e, na mesma fatia, trocou a coluna
 * declarada no SSOT (`packages/domain/empresa-rls.mjs`). É por isso que a grafia aqui mudou: este fixture
 * não é uma escolha de estilo, é uma cópia do que o banco responde hoje.
 */
const API_CHILD_REAL = JUNCAO("erp.empresas", "empresa_cost_centers", "empresa_id");
const linha = (extra: Partial<Linha> = {}): Linha => ({
  policyname: "api_child", cmd: "ALL", permissive: "PERMISSIVE", papeis: ["erp_app"],
  qual: API_CHILD_REAL, with_check: API_CHILD_REAL, ...extra
});
const conferir = (linhas: Linha[], tabela = "empresa_cost_centers") =>
  validarProtecaoDaExcecao(tabela, protecaoDaExcecao(tabela), linhas) as string[];

describe("proteção de exceção — o que precisa passar", () => {
  it("B2/B9 · a api_child REAL de erp.empresa_cost_centers passa", () => {
    expect(conferir([linha()])).toEqual([]);
  });

  it("a tenant_isolation REAL das tabelas de porta dinâmica passa", () => {
    const t: Linha = { policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE", papeis: ["authenticated", "erp_app"], qual: "erp.tenant_visible(organization_id)", with_check: "erp.tenant_visible(organization_id)" };
    for (const tabela of ["notifications", "registros_globais", "membro_empresas", "legado_escopo_empresa_v0"]) {
      expect(conferir([t], tabela), tabela).toEqual([]);
    }
  });

  it("os outros três api_child passam com o SEU pai — o pai não é sempre erp.empresas", () => {
    const casos = [
      ["authorizer_empresas", "erp.authorizers", "authorizer_id"],
      ["bank_account_empresas", "erp.bank_accounts", "bank_account_id"],
      ["proprietary_empresas", "erp.people", "person_id"]
    ] as const;
    for (const [tabela, pai, coluna] of casos) {
      const q = JUNCAO(pai, tabela, coluna);
      expect(conferir([linha({ qual: q, with_check: q })], tabela), tabela).toEqual([]);
    }
  });

  it("SEM apelido nenhum continua passando — a política qualifica pelo nome da tabela", () => {
    // `FROM erp.empresas WHERE …` é forma legítima, e uma captura de apelido ingênua engoliria a palavra
    // `WHERE` como se fosse o apelido: falso positivo que reprovaria a reescrita CORRETA da 05C-1.
    const q = "(EXISTS ( SELECT 1 FROM erp.empresas WHERE ((erp.empresas.id = empresa_cost_centers.empresa_id) AND erp.tenant_visible(erp.empresas.organization_id))))";
    expect(conferir([linha({ qual: q, with_check: q })])).toEqual([]);
  });

  it("apelido diferente e espaçamento diferente continuam passando — a forma, não a letra", () => {
    const q = `(EXISTS (SELECT 1 FROM erp.empresas AS pai WHERE pai.id = empresa_cost_centers.empresa_id AND erp.tenant_visible( pai.organization_id )))`;
    expect(conferir([linha({ qual: q, with_check: q })])).toEqual([]);
  });
});

describe("proteção de exceção — o que precisa REPROVAR", () => {
  it("B1 · política declarada ausente", () => {
    expect(conferir([linha({ policyname: "outra" })]).join(" | ")).toMatch(/falta a política api_child/);
  });

  it("B3 · USING (true) com WITH CHECK protegido — abre leitura e exclusão", () => {
    const p = conferir([linha({ qual: "true" })]).join(" | ");
    expect(p).toMatch(/USING não recorta nada/);
    expect(p, "e diz o que isso abre").toMatch(/leitura e exclusão/);
  });

  it("B4 · WITH CHECK (true) com USING protegido — abre inclusão e o lado novo do UPDATE", () => {
    expect(conferir([linha({ with_check: "true" })]).join(" | ")).toMatch(/WITH CHECK não recorta nada/);
  });

  it("WITH CHECK vazio conta como aberto, não como ausente", () => {
    expect(conferir([linha({ with_check: "" })]).join(" | ")).toMatch(/WITH CHECK não recorta nada/);
  });

  it("B5 · papel EXTRA não declarado", () => {
    expect(conferir([linha({ papeis: ["erp_app", "authenticated"] })]).join(" | ")).toMatch(/alcança \[authenticated, erp_app\], declarado \[erp_app\]/);
  });

  it("papel declarado FALTANDO também reprova — o conjunto é exato nos dois sentidos", () => {
    expect(conferir([linha({ papeis: [] })]).join(" | ")).toMatch(/alcança \[ninguém\]/);
  });

  it("B6 · política PERMISSIVE extra convivendo com a correta", () => {
    const extra: Linha = { policyname: "allow_all", cmd: "ALL", permissive: "PERMISSIVE", papeis: ["erp_app"], qual: "true", with_check: "true" };
    expect(conferir([linha(), extra]).join(" | ")).toMatch(/PERMISSIVE extra allow_all\/ALL.*combinam com OR/s);
  });

  it("B7 · cita tenant_visible mas NÃO junta com o pai", () => {
    const q = "erp.tenant_visible(organization_id)";
    const p = conferir([linha({ qual: q, with_check: q })]).join(" | ");
    expect(p).toMatch(/não junta com o cadastro pai declarado \(erp\.empresas\)/);
  });

  it("B8 · junta com o pai pela coluna ERRADA", () => {
    const q = JUNCAO("erp.empresas", "empresa_cost_centers", "cost_center_id");
    expect(conferir([linha({ qual: q, with_check: q })]).join(" | ")).toMatch(/não correlaciona o filho com o pai pela coluna declarada \(empresa_id\)/);
  });

  it("junta com o pai ERRADO", () => {
    const q = JUNCAO("erp.cost_centers", "empresa_cost_centers", "empresa_id");
    expect(conferir([linha({ qual: q, with_check: q })]).join(" | ")).toMatch(/não junta com o cadastro pai declarado/);
  });

  it("junta corretamente mas NÃO aplica o tenant ao pai", () => {
    const q = "(EXISTS ( SELECT 1 FROM erp.empresas p WHERE (p.id = empresa_cost_centers.empresa_id)))";
    expect(conferir([linha({ qual: q, with_check: q })]).join(" | ")).toMatch(/não aplica erp\.tenant_visible ao ORGANIZATION_ID DO PAI/);
  });

  it("aplica o tenant à coluna do FILHO em vez de à do pai", () => {
    const q = "(EXISTS ( SELECT 1 FROM erp.empresas p WHERE ((p.id = empresa_cost_centers.empresa_id) AND erp.tenant_visible(empresa_cost_centers.organization_id))))";
    expect(conferir([linha({ qual: q, with_check: q })]).join(" | ")).toMatch(/não aplica erp\.tenant_visible ao ORGANIZATION_ID DO PAI/);
  });

  it("DISJUNÇÃO · o predicado correto seguido de `OR true` abre a tabela inteira", () => {
    // O pior caso de todos: o predicado certo continua visível no texto, e é justamente isso que engana
    // quem lê. Qualquer busca por FORMA encontraria a junção — e ela não vale mais nada.
    const q = `${API_CHILD_REAL} OR true`;
    expect(conferir([linha({ qual: q, with_check: q })]).join(" | ")).toMatch(/USING contém OR.*ramo mais frouxo vence/s);
  });

  it("DISJUNÇÃO na tenant_direct também reprova", () => {
    const t: Linha = { policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE", papeis: ["authenticated", "erp_app"], qual: "erp.tenant_visible(organization_id) OR true", with_check: "erp.tenant_visible(organization_id)" };
    expect(conferir([t], "notifications").join(" | ")).toMatch(/contém OR/);
  });

  it("TENANT HOMÔNIMO · `tenant_visible` de outro schema não serve", () => {
    // Sem a âncora `erp.`, uma função de mesmo nome num schema do `search_path` do papel da aplicação
    // satisfaria o gate — que estaria conferindo outra função.
    const q = API_CHILD_REAL.replace(/erp\.tenant_visible/g, "outra.tenant_visible");
    expect(conferir([linha({ qual: q, with_check: q })]).join(" | ")).toMatch(/não aplica erp\.tenant_visible/);
  });

  it("comando e permissividade divergentes", () => {
    expect(conferir([linha({ cmd: "SELECT" })]).join(" | ")).toMatch(/comando SELECT, declarado ALL/);
    expect(conferir([linha({ permissive: "RESTRICTIVE" })]).join(" | ")).toMatch(/RESTRICTIVE, declarada PERMISSIVE/);
  });

  it("exceção sem `protecao` declarada", () => {
    expect((validarProtecaoDaExcecao("x", null, []) as string[]).join(" | ")).toMatch(/declarada como exceção sem .?protecao.?/);
  });
});

/**
 * B10 · O CONTRATO E A POLÍTICA MUDAM JUNTOS — E A 05C-1 JÁ FEZ A TROCA.
 *
 * `empresa_cost_centers` era a única exceção cujo vínculo era uma coluna LEGADA. A fatia destrutiva trocou
 * `farm_id` por `empresa_id` na política (`0017_purge_farm_legacy.sql`, item 6) E na declaração do SSOT
 * (`packages/domain/empresa-rls.mjs`). O acoplamento continua sendo a prova, só que agora medido do outro
 * lado: o DESVIO é voltar para a coluna legada, num lado só. Sem estes casos, alguém poderia reescrever a
 * política sem mexer no SSOT — ou o contrário — e a proteção passaria a apontar para uma coluna que não
 * governa nada, em silêncio.
 */
describe("B10 · a troca da 05C-1 tem de valer nos dois lados", () => {
  const comFarmId = JUNCAO("erp.empresas", "empresa_cost_centers", "farm_id");

  it("política de volta para farm_id com o SSOT já em empresa_id: REPROVA", () => {
    expect(conferir([linha({ qual: comFarmId, with_check: comFarmId })]).join(" | ")).toMatch(/coluna declarada \(empresa_id\)/);
  });

  it("SSOT de volta para farm_id com a política já em empresa_id: REPROVA", () => {
    const antiga = { ...(protecaoDaExcecao("empresa_cost_centers") as Record<string, unknown>), colunaVinculo: "farm_id" };
    const p = (validarProtecaoDaExcecao("empresa_cost_centers", antiga, [linha()]) as string[]).join(" | ");
    expect(p).toMatch(/coluna declarada \(farm_id\)/);
  });

  it("os dois em empresa_id — o estado de hoje: PASSA", () => {
    expect(conferir([linha()])).toEqual([]);
  });
});

describe("premissa", () => {
  it("há exceções declaradas, e toda uma delas tem proteção com família conhecida", () => {
    expect(TABELAS_DE_EXCECAO.length).toBeGreaterThan(0);
    for (const t of TABELAS_DE_EXCECAO as string[]) {
      const p = protecaoDaExcecao(t) as { familia: string; pai?: string; colunaVinculo?: string } | null;
      expect(p, t).toBeTruthy();
      expect(["tenant_direct", "api_child"], t).toContain(p!.familia);
      if (p!.familia === "api_child") { expect(p!.pai, t).toBeTruthy(); expect(p!.colunaVinculo, t).toBeTruthy(); }
    }
  });
});
