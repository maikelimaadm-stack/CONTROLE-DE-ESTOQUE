import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * O ID GLOBAL É UM LOCALIZADOR DA ORGANIZAÇÃO — A EMPRESA SELECIONADA NÃO DECIDE (PRE-BASE2-04).
 *
 * Há duas coisas parecidas e de natureza oposta:
 *   • a EMPRESA SELECIONADA (o cabeçalho de contexto) — contexto de TRABALHO, um filtro de tela;
 *   • o ESCOPO REAL do registro — empresa ATUAL da fonte dentro do módulo da permissão daquele registro.
 * A segunda é autoridade; a primeira nunca foi. Um usuário com Estoque só na empresa A e Financeiro só na B
 * é o caso normal, não o exótico: enquanto trabalha no Estoque de A ele precisa localizar `#N` de um título
 * da B — senão o localizador "global" só alcança a empresa que por acaso está selecionada.
 *
 * E o defeito não parava no falso negativo. `validarEmpresaSelecionada` responde 403, e um 403 no meio de uma
 * superfície inteiramente 404 é um ORÁCULO: ele diz "este número existe, só o seu contexto não bate" —
 * exatamente o que a anti-enumeração do ID Global proíbe.
 *
 * Estes testes provam os dois sentidos (A selecionada abrindo registro de B e vice-versa), provam que ignorar
 * a SELEÇÃO não é ignorar o ESCOPO (registro realmente fora continua 404) e provam que a correção é LOCAL:
 * a rota operacional comum continua recusando com 403 uma seleção explícita inválida no módulo.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { id?: string; error?: { code: string; message: string } };
const superficie = (r: { statusCode: number; json: () => unknown }) => ({ status: r.statusCode, code: j(r).error?.code, message: j(r).error?.message });
const resolver = (n: number, headers: Hdr) => h.app.inject({ method: "GET", url: `/api/registros-globais/${n}`, headers });
const reverso = (tipo: string, id: string, headers: Hdr) => h.app.inject({ method: "GET", url: `/api/registros-globais/entidade/${tipo}/${id}`, headers });
const idGlobalDe = async (tipo: string, id: string): Promise<number> =>
  Number((await admin.query<{ id_global: string }>("select id_global from erp.registros_globais where organization_id=$1 and tipo_entidade=$2 and id_entidade=$3", [h.demo.orgId, tipo, id])).rows[0]!.id_global);

/** Sessão do usuário restrito COM uma empresa explicitamente selecionada (ou nenhuma). */
const comEmpresa = (base: Hdr, empresa: string | null): Hdr => (empresa ? { ...base, "x-empresa-id": empresa } : base);

let ESTOQUE_A = ""; let GID_ESTOQUE_A = 0;
let FIN_B = ""; let GID_FIN_B = 0;
let FIN_A = ""; let GID_FIN_A = 0;
let ANIMAL_A = ""; let GID_ANIMAL_A = 0;
let hdrU: Hdr; let A = ""; let B = "";

beforeAll(async () => {
  h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 2 });
  A = I.empresa; B = I.empresa2;

  const criar = async (url: string, payload: Record<string, unknown>) => {
    const r = await h.app.inject({ method: "POST", url, headers: h.headers(), payload });
    expect(r.statusCode, `${url}: ${r.body}`).toBe(201);
    return String(j(r).id);
  };
  ESTOQUE_A = await criar("/api/stock/input-entries", { empresa_id: A, entry_date: "2031-06-01", items: [{ product_id: I.product, quantity: "4", unit_value: "5", warehouse_id: I.warehouse, financial_category_id: I.category, cost_center_id: I.costCenter }] });
  GID_ESTOQUE_A = await idGlobalDe("input_entries", ESTOQUE_A);
  const pagavel = (empresa: string, numero: string) => ({ empresa_id: empresa, number: numero, person_id: I.provider, amount: "10", emission_date: "2031-06-01", due_date: "2031-07-01", note: "escopo", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] });
  FIN_B = await criar("/api/financial/payables", pagavel(B, "SEL-B"));
  GID_FIN_B = await idGlobalDe("financial_titles", FIN_B);
  FIN_A = await criar("/api/financial/payables", pagavel(A, "SEL-A"));
  GID_FIN_A = await idGlobalDe("financial_titles", FIN_A);
  // Registro de um módulo em que o usuário não tem capacidade nenhuma: a terceira negativa da comparação.
  const esp = (await admin.query<{ species_id: string }>("select species_id from erp.animals limit 1")).rows[0]!.species_id;
  const cat = (await admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]!.id;
  ANIMAL_A = await criar("/api/livestock/animals", { empresa_id: A, species_id: esp, category_id: cat, entry_date: "2031-06-01", sex: "M", identifications: [{ identification_type_id: I.idType, value: "SEL-1", is_primary: true }] });
  GID_ANIMAL_A = await idGlobalDe("animals", ANIMAL_A);

  // A MATRIZ DO CENÁRIO: Estoque só na empresa A, Financeiro só na empresa B. Nenhum outro módulo.
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: "Perfil Seleção Cruzada", permissions: ["input_entries.view", "payables.view"] } });
  expect(papel.statusCode, papel.body).toBe(201);
  const membro = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: {
    name: "Seleção Cruzada", email: "selecao-cruzada@demo.local", password: "Selecao@12345", role_id: j(papel).id,
    escopos_empresas: [{ modulo: "estoque", modo: "selecionadas", empresas: [A] }, { modulo: "financeiro", modo: "selecionadas", empresas: [B] }]
  } });
  expect(membro.statusCode, membro.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "selecao-cruzada@demo.local", password: "Selecao@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  hdrU = { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("localização cruzada: a empresa selecionada é contexto, não autoridade", () => {
  it("empresa A selecionada + título do Financeiro/B que o usuário PODE ver → 200", async () => {
    const r = await resolver(GID_FIN_B, comEmpresa(hdrU, A));
    expect(r.statusCode, `o localizador global não pode depender de qual empresa está na tela: ${r.body}`).toBe(200);
    const b = j(r);
    expect(b["idEntidade"]).toBe(FIN_B);
    expect(b["empresaId"], "a empresa devolvida é a do REGISTRO, não a selecionada").toBe(B);
    expect(b["rota"]).toBe(`/financeiro/contas-a-pagar/${FIN_B}`);
  });

  it("empresa B selecionada + entrada do Estoque/A que o usuário PODE ver → 200 (sentido inverso)", async () => {
    const r = await resolver(GID_ESTOQUE_A, comEmpresa(hdrU, B));
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)["idEntidade"]).toBe(ESTOQUE_A);
    expect(j(r)["empresaId"]).toBe(A);
  });

  it("sem empresa selecionada (contexto 'todas') os dois continuam abrindo", async () => {
    expect((await resolver(GID_FIN_B, hdrU)).statusCode).toBe(200);
    expect((await resolver(GID_ESTOQUE_A, hdrU)).statusCode).toBe(200);
  });

  it("IGNORAR A SELEÇÃO NÃO É IGNORAR O ESCOPO: título do Financeiro/A continua 404", async () => {
    // O usuário tem Financeiro apenas na B. Selecionar a A não compra acesso nenhum — nos dois contextos.
    for (const selecionada of [A, B, null]) {
      const r = await resolver(GID_FIN_A, comEmpresa(hdrU, selecionada));
      expect(r.statusCode, `selecionada=${selecionada ?? "todas"}: ${r.body}`).toBe(404);
    }
  });

  it("o caminho INVERSO segue exatamente a mesma regra", async () => {
    const permitido = await reverso("financial_titles", FIN_B, comEmpresa(hdrU, A));
    expect(permitido.statusCode, permitido.body).toBe(200);
    expect(j(permitido)["idGlobal"]).toBe(GID_FIN_B);
    const negado = await reverso("financial_titles", FIN_A, comEmpresa(hdrU, A));
    expect(negado.statusCode, "fora do escopo REAL continua negado").toBe(404);
  });
});

describe("anti-enumeração: nenhum 403 nasce do ID Global", () => {
  it("todas as negativas têm a MESMA superfície, com a empresa A selecionada", async () => {
    const hdr = comEmpresa(hdrU, A);
    const inexistente = await resolver(99_999_999, hdr);
    const foraDoEscopo = await resolver(GID_FIN_A, hdr);
    const semCapacidade = await resolver(GID_ANIMAL_A, hdr);
    const base = superficie(inexistente);
    expect(base.status).toBe(404);
    expect(superficie(foraDoEscopo), "registro real fora do escopo não pode ser distinguível de número inexistente").toEqual(base);
    expect(superficie(semCapacidade), "falta de capacidade também não").toEqual(base);
    for (const r of [inexistente, foraDoEscopo, semCapacidade]) expect(j(r).error?.code).toBe("NOT_FOUND");
  });

  it("o caminho inverso também nunca responde 403 por causa da seleção", async () => {
    for (const selecionada of [A, B]) {
      const r = await reverso("financial_titles", FIN_A, comEmpresa(hdrU, selecionada));
      expect(r.statusCode, `selecionada=${selecionada}: ${r.body}`).toBe(404);
      expect(j(r).error?.code).toBe("NOT_FOUND");
    }
  });
});

describe("UUID malformado no caminho inverso", () => {
  it("malformado e inexistente-mas-válido respondem a MESMA coisa, sem texto do PostgreSQL", async () => {
    const valido = await reverso("animals", "00000000-0000-4000-8000-000000000001", hdrU);
    const malformado = await reverso("animals", "nao-e-uuid", hdrU);
    expect(valido.statusCode).toBe(404);
    expect(malformado.statusCode, `um id malformado não pode virar 500: ${malformado.body}`).toBe(404);
    expect(superficie(malformado)).toEqual(superficie(valido));
    expect(malformado.body.toLowerCase()).not.toContain("invalid input syntax");
    expect(malformado.body.toLowerCase()).not.toContain("uuid");
    expect(malformado.body.toLowerCase()).not.toContain("postgres");
  });

  it("outras formas malformadas continuam sendo a mesma negativa", async () => {
    for (const bruto of ["123", "..", "%20", "00000000-0000-4000-8000-00000000000", "' or 1=1--"]) {
      const r = await reverso("animals", encodeURIComponent(bruto), hdrU);
      expect(r.statusCode, `${bruto}: ${r.body}`).toBe(404);
      expect(j(r).error?.code).toBe("NOT_FOUND");
    }
  });
});

describe("a correção é LOCAL: a rota operacional continua validando a empresa selecionada", () => {
  it("seleção explícita inválida no módulo continua 403 PERMISSION_DENIED", async () => {
    // Estoque do usuário é só a empresa A; ele pede explicitamente para trabalhar na B.
    const r = await h.app.inject({ method: "GET", url: "/api/stock/input-entries", headers: comEmpresa(hdrU, B) });
    expect(r.statusCode, `a rota comum não foi afrouxada junto: ${r.body}`).toBe(403);
    expect(j(r).error?.code).toBe("PERMISSION_DENIED");
  });

  it("a mesma rota com a empresa correta selecionada continua funcionando", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/stock/input-entries", headers: comEmpresa(hdrU, A) });
    expect(r.statusCode, r.body).toBe(200);
  });
});
