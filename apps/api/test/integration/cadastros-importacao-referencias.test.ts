import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * Importação de cadastros — REFERÊNCIAS (correção R1 da PR #59).
 *
 * Cada item da aba "Listas" aponta para UM registro: o texto leva o que distingue o registro na tela
 * (empresa do armazém, grupo da categoria, caminho do endereçamento, "(padrão)" da unidade do sistema) e,
 * se ainda assim repetir, o começo do UUID. O reconhecimento de um valor digitado segue três estágios —
 * texto exato da lista, rótulo/código exato, e só então sem diferenciar maiúsculas — e para no primeiro
 * que acha algo: mais de um registro ali é recusa ("ambíguo"), nunca um palpite.
 *
 * O armazém respeita o escopo de empresa do MÓDULO DO ARMAZÉM (estoque): quem não enxerga a empresa B não
 * vê nem casa armazém dela — e a recusa é a mesma de um valor inexistente.
 */
let h: Harness; let admin: Db;
type Hdr = Record<string, string>;
interface Erro { linha: number; coluna: string | null; mensagem: string }
interface Resultado { linhas: number; gravadas: number; erros: Erro[]; simulacao: boolean }
const j = (r: { body: string }) => JSON.parse(r.body) as Resultado;

const ambiguo = (valor: string, plural: string) => `"${valor}" corresponde a mais de um registro de ${plural}. Use o valor exatamente como está na aba Listas.`;
const naoEncontrado = (valor: string, plural: string) => `"${valor}" não encontrado em ${plural}. Use um valor da aba Listas.`;

const modelo = async (key: string, headers: Hdr = h.headers()) => {
  const r = await h.app.inject({ method: "GET", url: `/api/imports/${key}/modelo`, headers });
  expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer); return wb;
};
const importar = async (wb: ExcelJS.Workbook, key: string, opts: { simular?: boolean; headers?: Hdr } = {}) =>
  h.app.inject({ method: "POST", url: `/api/imports/${key}?simular=${opts.simular ? 1 : 0}`, headers: { ...(opts.headers ?? h.headers()), "content-type": "application/json" }, payload: { arquivo_base64: Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer).toString("base64") } });
const cabecalho = (wb: ExcelJS.Workbook) => { const r: string[] = []; wb.getWorksheet("Dados")!.getRow(1).eachCell((c) => r.push(String(c.value))); return r; };
/** Coluna da aba Dados pelo rótulo (com ou sem o " *" do obrigatório). Coluna ausente reprova — nunca escreve na coluna 0. */
const col = (wb: ExcelJS.Workbook, rotulo: string) => {
  const cab = cabecalho(wb); const n = cab.findIndex((t) => t === rotulo || t === `${rotulo} *`) + 1;
  expect(n, `coluna "${rotulo}" no modelo (${cab.join(" | ")})`).toBeGreaterThan(0); return n;
};
/** Valores da aba Listas para a coluna `chave`. Lista ausente reprova. */
const listaDe = (wb: ExcelJS.Workbook, chave: string) => {
  const ws = wb.getWorksheet("Listas")!; let c = 0; ws.getRow(1).eachCell((x, n) => { if (x.value === chave) c = n; });
  expect(c, `lista "${chave}" na aba Listas`).toBeGreaterThan(0);
  const out: string[] = []; for (let i = 2; i <= ws.rowCount; i++) { const v = ws.getRow(i).getCell(c).value; if (v !== null && v !== undefined && v !== "") out.push(String(v)); } return out;
};
const vezes = (lista: string[], texto: string) => lista.filter((x) => x === texto).length;
/** Preenche uma linha da aba Dados pelo rótulo de cada coluna. */
const preencher = (wb: ExcelJS.Workbook, linha: number, valores: Record<string, string>) => {
  const row = wb.getWorksheet("Dados")!.getRow(linha);
  for (const [rotulo, v] of Object.entries(valores)) row.getCell(col(wb, rotulo)).value = v;
  row.commit();
};
/**
 * Produto mínimo válido. Referências da base pelo RÓTULO exato (únicos no seed): o assunto de cada teste é a
 * coluna que ele sobrescreve, não estas. "Controla estoque" = Não dispensa a categoria financeira.
 */
const produto = (wb: ExcelJS.Workbook, linha: number, descricao: string, extra: Record<string, string> = {}) =>
  preencher(wb, linha, { "Descrição": descricao, "1ª Un. Medida": "un", "Grupo": "Rações e Suplementos", "Controla estoque": "Não", ...extra });
const criar = async (key: string, corpo: Record<string, unknown>, headers: Hdr = h.headers()) => {
  const r = await h.app.inject({ method: "POST", url: `/api/resources/${key}`, headers, payload: corpo });
  expect(r.statusCode, `${key}: ${r.body}`).toBe(201);
  return (JSON.parse(r.body) as { id: string }).id;
};
const contarProdutos = async () => Number((await admin.query<{ n: string }>("select count(*) n from erp.products where organization_id=$1", [h.demo.orgId])).rows[0]!.n);
/** O produto gravado com esta descrição (exatamente um). */
const gravado = async (descricao: string) => {
  const r = await admin.query<{ id: string; measurement_id: string; group_id: string; category_id: string; kind_id: string; cultivation_id: string | null; default_warehouse_id: string | null; addressing_id: string | null }>(
    "select id, measurement_id, group_id, category_id, kind_id, cultivation_id, default_warehouse_id, addressing_id from erp.products where organization_id=$1 and description=$2 and deleted_at is null", [h.demo.orgId, descricao]);
  expect(r.rows.length, `produto "${descricao}" gravado uma vez`).toBe(1);
  return r.rows[0]!;
};
const aceitou = (r: { statusCode: number; body: string }, n: number) => { expect(r.statusCode, r.body).toBe(201); expect(j(r)).toMatchObject({ linhas: n, gravadas: n, erros: [] }); };
const recusou = (r: { statusCode: number; body: string }, erros: Erro[]) => { expect(r.statusCode, r.body).toBe(422); expect(j(r).erros).toEqual(erros); expect(j(r).gravadas).toBe(0); };

let A = ""; let B = ""; let nomeA = ""; let nomeB = "";
/** Texto esperado de um armazém na lista, montado do BANCO (sigla - descrição (empresa)). */
const textosDeArmazens = async (ids: string[] | null) => (await admin.query<{ t: string }>(
  `select w.initials || ' - ' || w.description || ' (' || e.name || ')' t from erp.warehouses w join erp.empresas e on e.id=w.empresa_id
    where w.organization_id=$1 and w.is_active and w.deleted_at is null ${ids ? "and w.id = any($2::uuid[])" : ""}`, ids ? [h.demo.orgId, ids] : [h.demo.orgId])).rows.map((x) => x.t).sort();
const fabDe = async (empresa: string) => {
  const r = await admin.query<{ id: string }>("select id from erp.warehouses where organization_id=$1 and empresa_id=$2 and initials='FAB' and description='Fábrica de Ração' and is_active and deleted_at is null", [h.demo.orgId, empresa]);
  expect(r.rows.length, "a semente cria UM 'Fábrica de Ração' por empresa").toBe(1); return r.rows[0]!.id;
};

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 });
  A = h.demo.empresaIds[0]!; B = h.demo.empresaIds[1]!;
  const emp = await admin.query<{ id: string; name: string }>("select id, name from erp.empresas where organization_id=$1 and id = any($2::uuid[])", [h.demo.orgId, [A, B]]);
  nomeA = emp.rows.find((x) => x.id === A)!.name; nomeB = emp.rows.find((x) => x.id === B)!.name;
  expect(nomeA).not.toBe(nomeB);
}, 180_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("armazéns homônimos em duas empresas", () => {
  it("R1: a lista traz 'SIGLA - Descrição (Empresa)' — um item distinto por armazém ativo, igual ao que o banco tem", async () => {
    const fabA = await fabDe(A); const fabB = await fabDe(B);
    expect(fabA).not.toBe(fabB);
    const lista = listaDe(await modelo("products"), "Armazém padrão");
    const esperado = await textosDeArmazens(null);
    expect(esperado.length, "semente: ALM, FAB e SILO em cada empresa").toBeGreaterThanOrEqual(6);
    expect([...lista].sort()).toEqual(esperado);
    expect(vezes(lista, `FAB - Fábrica de Ração (${nomeA})`)).toBe(1);
    expect(vezes(lista, `FAB - Fábrica de Ração (${nomeB})`)).toBe(1);
    expect(new Set(lista.map((x) => x.toLocaleLowerCase("pt-BR"))).size, "nenhum texto repetido").toBe(lista.length);
    expect(lista.filter((x) => /\[[0-9a-f]{8}\]$/.test(x)), "nome qualificado dispensa o desempate por UUID").toEqual([]);
  });

  it("R2: o valor da lista grava o armazém da empresa CERTA (também sem diferenciar maiúsculas); 'Fábrica de Ração' nu é recusado como ambíguo e nada é gravado", async () => {
    const fabA = await fabDe(A); const fabB = await fabDe(B);
    const wb = await modelo("products");
    produto(wb, 2, "Ref Armazém B", { "Armazém padrão": `FAB - Fábrica de Ração (${nomeB})` });
    produto(wb, 3, "Ref Armazém A", { "Armazém padrão": `FAB - Fábrica de Ração (${nomeA})` });
    produto(wb, 4, "Ref Armazém B minúsculo", { "Armazém padrão": `fab - fábrica de ração (${nomeB.toLocaleLowerCase("pt-BR")})` });
    aceitou(await importar(wb, "products"), 3);
    expect((await gravado("Ref Armazém B")).default_warehouse_id).toBe(fabB);
    expect((await gravado("Ref Armazém A")).default_warehouse_id).toBe(fabA);
    expect((await gravado("Ref Armazém B minúsculo")).default_warehouse_id).toBe(fabB);

    const wb2 = await modelo("products");
    produto(wb2, 2, "Ref Armazém Ambíguo", { "Armazém padrão": "Fábrica de Ração" });
    const antes = await contarProdutos();
    recusou(await importar(wb2, "products"), [{ linha: 2, coluna: "Armazém padrão", mensagem: ambiguo("Fábrica de Ração", "Armazéns") }]);
    expect(await contarProdutos()).toBe(antes);
    expect((await admin.query("select 1 from erp.products where description='Ref Armazém Ambíguo'")).rowCount).toBe(0);
  });
});

describe("unidade de medida da organização com a sigla da padrão", () => {
  let kgPadrao = ""; let kgOrg = ""; let lPadrao = ""; let lOrg = ""; let unPadrao = "";
  const unidade = async (org: boolean, simbolo: string) => {
    const r = await admin.query<{ id: string }>(`select id from erp.measurement_units where symbol=$1 and ${org ? "organization_id=$2" : "organization_id is null and $2::uuid is not null"}`, [simbolo, h.demo.orgId]);
    expect(r.rows.length, `unidade ${simbolo} (${org ? "organização" : "padrão"})`).toBe(1); return r.rows[0]!.id;
  };
  beforeAll(async () => {
    kgOrg = await criar("measurement_units", { symbol: "kg", name: "Quilo Agro Real", decimals: 3 });
    lOrg = await criar("measurement_units", { symbol: "l", name: "Litro Agro Real", decimals: 3 });
    kgPadrao = await unidade(false, "kg"); lPadrao = await unidade(false, "L"); unPadrao = await unidade(false, "un");
    expect(await unidade(true, "kg")).toBe(kgOrg); expect(await unidade(true, "l")).toBe(lOrg);
  });

  it("R3: as duas 'kg' aparecem distintas — '(padrão)' só na do sistema — e cada texto grava o id certo", async () => {
    const wb = await modelo("products");
    const lista = listaDe(wb, "1ª Un. Medida");
    const total = await admin.query<{ padrao: string; org: string }>("select count(*) filter (where organization_id is null) padrao, count(*) filter (where organization_id=$1) org from erp.measurement_units where organization_id is null or organization_id=$1", [h.demo.orgId]);
    const nPadrao = Number(total.rows[0]!.padrao); const nOrg = Number(total.rows[0]!.org);
    expect(nPadrao).toBeGreaterThan(20); expect(nOrg).toBe(2);
    expect(lista.length).toBe(nPadrao + nOrg);
    expect(lista.filter((x) => x.endsWith(" (padrão)")).length, "'(padrão)' marca exatamente as do sistema").toBe(nPadrao);
    expect(vezes(lista, "kg - Quilograma (padrão)")).toBe(1);
    expect(vezes(lista, "kg - Quilo Agro Real")).toBe(1);
    expect(vezes(lista, "L - Litro (padrão)")).toBe(1);
    expect(vezes(lista, "l - Litro Agro Real")).toBe(1);
    produto(wb, 2, "Ref Unidade Padrão", { "1ª Un. Medida": "kg - Quilograma (padrão)" });
    produto(wb, 3, "Ref Unidade Organização", { "1ª Un. Medida": "kg - Quilo Agro Real" });
    aceitou(await importar(wb, "products"), 2);
    expect((await gravado("Ref Unidade Padrão")).measurement_id).toBe(kgPadrao);
    expect((await gravado("Ref Unidade Organização")).measurement_id).toBe(kgOrg);
    expect(kgPadrao).not.toBe(kgOrg);
  });

  it("R4: sigla exata com maiúsculas diferentes resolve no estágio EXATO antes do solto ('L' ≠ 'l'); 'UN' só casa no solto; 'kg' e 'Kg' com duas candidatas são ambíguos", async () => {
    const wb = await modelo("products");
    produto(wb, 2, "Ref Sigla L", { "1ª Un. Medida": "L" });
    produto(wb, 3, "Ref Sigla l", { "1ª Un. Medida": "l" });
    produto(wb, 4, "Ref Sigla UN", { "1ª Un. Medida": "UN" });
    aceitou(await importar(wb, "products"), 3);
    expect((await gravado("Ref Sigla L")).measurement_id, "'L' exato = Litro do sistema (sem maiúsculas seriam dois)").toBe(lPadrao);
    expect((await gravado("Ref Sigla l")).measurement_id, "'l' exato = litro da organização").toBe(lOrg);
    expect((await gravado("Ref Sigla UN")).measurement_id, "'UN' só existe sem diferenciar maiúsculas: 'un'").toBe(unPadrao);

    const wb2 = await modelo("products");
    produto(wb2, 2, "Ref Sigla kg", { "1ª Un. Medida": "kg" });
    produto(wb2, 3, "Ref Sigla Kg", { "1ª Un. Medida": "Kg" });
    const antes = await contarProdutos();
    recusou(await importar(wb2, "products"), [
      { linha: 2, coluna: "1ª Un. Medida", mensagem: ambiguo("kg", "Unidades de Medida") },
      { linha: 3, coluna: "1ª Un. Medida", mensagem: ambiguo("Kg", "Unidades de Medida") },
    ]);
    expect(await contarProdutos()).toBe(antes);
  });
});

// CADASTROS-ESTRUTURA: Categoria e Classe saíram do produto (o Grupo virou árvore). O caso "mesmo nome em ramos
// diferentes" passou a ser do próprio GRUPO: o código distingue os dois na lista, e o nome nu é ambíguo.
describe("grupo com o mesmo nome em ramos diferentes da árvore", () => {
  it("R5: 'código - nome' distintos na lista, cada um grava o registro certo; o nome nu é ambíguo", async () => {
    const pai = async (code: string) => (await admin.query<{ id: string }>("select id from erp.product_groups where organization_id=$1 and code=$2", [h.demo.orgId, code])).rows[0]!.id;
    const gAlfa = await criar("product_groups", { code: "1.09", name: "Grupo Comum", parent_id: await pai("1") });
    const gBeta = await criar("product_groups", { code: "2.09", name: "Grupo Comum", parent_id: await pai("2") });
    const wb = await modelo("products");
    const grupos = listaDe(wb, "Grupo");
    expect(vezes(grupos, "1.09 - Grupo Comum")).toBe(1);
    expect(vezes(grupos, "2.09 - Grupo Comum")).toBe(1);
    expect(vezes(grupos, "2.01 - Rações e Suplementos"), "os da semente também vêm com o código").toBe(1);

    produto(wb, 2, "Ref Classificação Beta", { "Grupo": "2.09 - Grupo Comum" });
    produto(wb, 3, "Ref Classificação Alfa", { "Grupo": "1.09 - Grupo Comum" });
    aceitou(await importar(wb, "products"), 2);
    expect(await gravado("Ref Classificação Beta")).toMatchObject({ group_id: gBeta, category_id: null, kind_id: null });
    expect(await gravado("Ref Classificação Alfa")).toMatchObject({ group_id: gAlfa, category_id: null, kind_id: null });

    const wb2 = await modelo("products");
    produto(wb2, 2, "Ref Grupo Nu", { "Grupo": "Grupo Comum" });
    const antes = await contarProdutos();
    recusou(await importar(wb2, "products"), [
      { linha: 2, coluna: "Grupo", mensagem: ambiguo("Grupo Comum", "Grupos de Produtos") },
    ]);
    expect(await contarProdutos()).toBe(antes);
  });
});

describe("variedade", () => {
  it("R6: 'Variedade (Cultura)' — a mesma variedade em duas culturas aparece distinta, grava a certa, e o nome nu é ambíguo", async () => {
    const soja = await criar("cultivations", { crop: "Soja Ref", variety: "Precoce Ref" });
    const milho = await criar("cultivations", { crop: "Milho Ref", variety: "Precoce Ref" });
    const wb = await modelo("products");
    const lista = listaDe(wb, "Variedade");
    const n = Number((await admin.query<{ n: string }>("select count(*) n from erp.cultivations where organization_id=$1 and is_active", [h.demo.orgId])).rows[0]!.n);
    expect(n).toBeGreaterThanOrEqual(2); expect(lista.length).toBe(n);
    expect(vezes(lista, "Precoce Ref (Soja Ref)")).toBe(1);
    expect(vezes(lista, "Precoce Ref (Milho Ref)")).toBe(1);
    produto(wb, 2, "Ref Variedade Milho", { "Variedade": "Precoce Ref (Milho Ref)" });
    produto(wb, 3, "Ref Variedade Soja", { "Variedade": "Precoce Ref (Soja Ref)" });
    aceitou(await importar(wb, "products"), 2);
    expect((await gravado("Ref Variedade Milho")).cultivation_id).toBe(milho);
    expect((await gravado("Ref Variedade Soja")).cultivation_id).toBe(soja);

    const wb2 = await modelo("products");
    produto(wb2, 2, "Ref Variedade Nua", { "Variedade": "Precoce Ref" });
    recusou(await importar(wb2, "products"), [{ linha: 2, coluna: "Variedade", mensagem: ambiguo("Precoce Ref", "Variedades/Culturas") }]);
  });
});

describe("endereçamento em caminho", () => {
  let prateleira = ""; let baia1 = ""; let baia2 = "";
  beforeAll(async () => {
    const setor = await criar("addressings", { description: "Setor Ref" });
    const corredor = await criar("addressings", { description: "Corredor Ref", parent_id: setor });
    prateleira = await criar("addressings", { description: "Prateleira Ref", parent_id: corredor });
    const setorDup = await criar("addressings", { description: "Setor Dup" });
    baia1 = await criar("addressings", { description: "Baia Dup", parent_id: setorDup });
    baia2 = await criar("addressings", { description: "Baia Dup", parent_id: setorDup });
  });

  it("R7: 'A > B > C' na lista; dois com o mesmo caminho recebem ' [xxxxxxxx]' e o valor com sufixo grava o certo; sem sufixo é recusado", async () => {
    const wb = await modelo("products");
    const lista = listaDe(wb, "Endereçamento");
    const n = Number((await admin.query<{ n: string }>("select count(*) n from erp.addressings where organization_id=$1 and deleted_at is null", [h.demo.orgId])).rows[0]!.n);
    expect(n).toBeGreaterThanOrEqual(6); expect(lista.length).toBe(n);
    for (const t of ["Setor Ref", "Setor Ref > Corredor Ref", "Setor Ref > Corredor Ref > Prateleira Ref", "Setor Dup"]) expect(vezes(lista, t), t).toBe(1);
    const dup1 = `Setor Dup > Baia Dup [${baia1.slice(0, 8)}]`; const dup2 = `Setor Dup > Baia Dup [${baia2.slice(0, 8)}]`;
    expect(dup1).not.toBe(dup2);
    expect(vezes(lista, dup1)).toBe(1); expect(vezes(lista, dup2)).toBe(1);
    expect(vezes(lista, "Setor Dup > Baia Dup"), "o texto repetido não fica sem desempate").toBe(0);
    expect(lista.filter((x) => /\[[0-9a-f]{8}\]$/.test(x)).length, "só os repetidos ganham sufixo").toBe(2);

    produto(wb, 2, "Ref Endereço Prateleira", { "Endereçamento": "Setor Ref > Corredor Ref > Prateleira Ref" });
    produto(wb, 3, "Ref Endereço Baia 2", { "Endereçamento": dup2 });
    produto(wb, 4, "Ref Endereço Baia 1", { "Endereçamento": dup1 });
    aceitou(await importar(wb, "products"), 3);
    expect((await gravado("Ref Endereço Prateleira")).addressing_id).toBe(prateleira);
    expect((await gravado("Ref Endereço Baia 2")).addressing_id).toBe(baia2);
    expect((await gravado("Ref Endereço Baia 1")).addressing_id).toBe(baia1);

    const wb2 = await modelo("products");
    produto(wb2, 2, "Ref Endereço Rótulo Nu", { "Endereçamento": "Baia Dup" });
    produto(wb2, 3, "Ref Endereço Caminho Sem Sufixo", { "Endereçamento": "Setor Dup > Baia Dup" });
    const antes = await contarProdutos();
    const r = await importar(wb2, "products");
    expect(r.statusCode, r.body).toBe(422);
    const erros = j(r).erros;
    expect(erros).toHaveLength(2);
    expect(erros[0]).toEqual({ linha: 2, coluna: "Endereçamento", mensagem: ambiguo("Baia Dup", "Endereçamentos") });
    // o caminho sem desempate não é texto da lista: recusado (nunca um dos dois escolhido em silêncio)
    expect(erros[1]).toMatchObject({ linha: 3, coluna: "Endereçamento" });
    expect([naoEncontrado("Setor Dup > Baia Dup", "Endereçamentos"), ambiguo("Setor Dup > Baia Dup", "Endereçamentos")]).toContain(erros[1]!.mensagem);
    expect(await contarProdutos()).toBe(antes);
  });
});

describe("escopo: membro com estoque só na empresa A", () => {
  let M: Hdr = {}; let membroId = "";
  beforeAll(async () => {
    const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: "Perfil Importação Referências", permissions: ["products.view", "products.create", "warehouses.view", "payables.view"] } });
    expect(papel.statusCode, papel.body).toBe(201);
    const email = "importacao-referencias@demo.local";
    // FINANCEIRO na empresa B: a união dos módulos inclui B — só o recorte pelo módulo do ARMAZÉM (estoque) a exclui
    const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: {
      name: "Importador Estoque A", email, password: "Escopo@12345", role_id: (JSON.parse(papel.body) as { id: string }).id,
      escopos_empresas: [{ modulo: "estoque", modo: "selecionadas", empresas: [A] }, { modulo: "financeiro", modo: "selecionadas", empresas: [B] }],
    } });
    expect(vinculo.statusCode, vinculo.body).toBe(201);
    membroId = (JSON.parse(vinculo.body) as { member_id: string }).member_id;
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Escopo@12345" } });
    expect(login.statusCode, login.body).toBe(200);
    M = { authorization: `Bearer ${(JSON.parse(login.body) as { token: string }).token}`, "x-org-id": h.demo.orgId };
  });

  it("R8: a lista de armazéns do modelo é a MESMA de GET /resources/warehouses/options desse membro — só os da empresa A", async () => {
    const escopos = await admin.query<{ modulo: string; modo: string; empresas: string[] }>(
      `select e.modulo, e.modo, array(select me.empresa_id::text from erp.membro_empresas me where me.organization_id=e.organization_id and me.membro_id=e.membro_id and me.modulo=e.modulo) empresas
         from erp.membro_escopos_empresa e where e.organization_id=$1 and e.membro_id=$2 order by e.modulo`, [h.demo.orgId, membroId]);
    expect(escopos.rows).toEqual([{ modulo: "estoque", modo: "selecionadas", empresas: [A] }, { modulo: "financeiro", modo: "selecionadas", empresas: [B] }]);

    const opcoes = await h.app.inject({ method: "GET", url: "/api/resources/warehouses/options", headers: M });
    expect(opcoes.statusCode, opcoes.body).toBe(200);
    const idsOpcoes = (JSON.parse(opcoes.body) as { id: string }[]).map((x) => x.id);
    const deA = await admin.query<{ id: string; empresa_id: string }>("select id, empresa_id from erp.warehouses where organization_id=$1 and empresa_id=$2 and is_active and deleted_at is null", [h.demo.orgId, A]);
    expect(deA.rows.length).toBeGreaterThanOrEqual(3);
    expect([...idsOpcoes].sort(), "options do membro = armazéns ativos da empresa A").toEqual(deA.rows.map((x) => x.id).sort());

    const doMembro = listaDe(await modelo("products", M), "Armazém padrão");
    expect([...doMembro].sort()).toEqual(await textosDeArmazens(idsOpcoes));
    expect(doMembro.some((x) => x.endsWith(`(${nomeB})`)), "nenhum armazém da empresa B").toBe(false);
    // premissa: a empresa B TEM armazéns, e quem enxerga as duas os recebe na lista
    const doAdmin = listaDe(await modelo("products"), "Armazém padrão");
    expect(doAdmin.filter((x) => x.endsWith(`(${nomeB})`)).length).toBeGreaterThanOrEqual(3);
    expect(doAdmin.length).toBeGreaterThan(doMembro.length);
  });

  it("R9: armazém da empresa B → 'não encontrado' (mesma mensagem de inexistente); 'Fábrica de Ração' nu resolve para o de A, sem 'ambíguo'", async () => {
    const fabA = await fabDe(A);
    const textoB = `FAB - Fábrica de Ração (${nomeB})`;
    const wb = await modelo("products", M);
    produto(wb, 2, "Ref Escopo B", { "Armazém padrão": textoB });
    produto(wb, 3, "Ref Escopo Inexistente", { "Armazém padrão": "Armazém Que Nunca Existiu" });
    const antes = await contarProdutos();
    recusou(await importar(wb, "products", { headers: M }), [
      { linha: 2, coluna: "Armazém padrão", mensagem: naoEncontrado(textoB, "Armazéns") },
      { linha: 3, coluna: "Armazém padrão", mensagem: naoEncontrado("Armazém Que Nunca Existiu", "Armazéns") },
    ]);
    expect(await contarProdutos()).toBe(antes);

    // o MESMO arquivo, para quem enxerga as duas empresas, é ambíguo (prévia: nada é gravado)
    const wbAdmin = await modelo("products");
    produto(wbAdmin, 2, "Ref Escopo Nu Admin", { "Armazém padrão": "Fábrica de Ração" });
    recusou(await importar(wbAdmin, "products", { simular: true }), [{ linha: 2, coluna: "Armazém padrão", mensagem: ambiguo("Fábrica de Ração", "Armazéns") }]);

    const wb2 = await modelo("products", M);
    produto(wb2, 2, "Ref Escopo Nu Membro", { "Armazém padrão": "Fábrica de Ração" });
    aceitou(await importar(wb2, "products", { headers: M }), 1);
    expect((await gravado("Ref Escopo Nu Membro")).default_warehouse_id).toBe(fabA);
  });
});

describe("inexistente, inativo e excluído", () => {
  it("R10: os três recebem a MESMA mensagem '\"X\" não encontrado em <labelPlural>. Use um valor da aba Listas.'", async () => {
    const ina = await criar("warehouses", { empresa_id: A, initials: "INA", description: "Armazém Inativo Ref", type: "inputs" });
    const exc = await criar("warehouses", { empresa_id: A, initials: "EXC", description: "Armazém Excluído Ref", type: "inputs" });
    const grupo = await criar("product_groups", { code: "4", name: "Grupo Inativo Ref" });
    const endereco = await criar("addressings", { description: "Endereço Excluído Ref" });
    const textoIna = `INA - Armazém Inativo Ref (${nomeA})`; const textoExc = `EXC - Armazém Excluído Ref (${nomeA})`;
    // premissa: enquanto ativos e vivos, os quatro estão na lista com exatamente estes textos
    const antesWb = await modelo("products");
    expect(vezes(listaDe(antesWb, "Armazém padrão"), textoIna)).toBe(1);
    expect(vezes(listaDe(antesWb, "Armazém padrão"), textoExc)).toBe(1);
    expect(vezes(listaDe(antesWb, "Grupo"), "4 - Grupo Inativo Ref")).toBe(1);
    expect(vezes(listaDe(antesWb, "Endereçamento"), "Endereço Excluído Ref")).toBe(1);

    const put = async (key: string, id: string) => { const r = await h.app.inject({ method: "PUT", url: `/api/resources/${key}/${id}`, headers: h.headers(), payload: { is_active: false } }); expect(r.statusCode, r.body).toBe(200); };
    const del = async (key: string, id: string) => { const r = await h.app.inject({ method: "DELETE", url: `/api/resources/${key}/${id}`, headers: h.headers() }); expect(r.statusCode, r.body).toBe(200); };
    await put("warehouses", ina); await put("product_groups", grupo);
    await del("warehouses", exc); await del("addressings", endereco);
    // os registros CONTINUAM no banco — inativo ou excluído logicamente, não apagado
    expect((await admin.query("select 1 from erp.warehouses where id=$1 and not is_active and deleted_at is null", [ina])).rowCount).toBe(1);
    expect((await admin.query("select 1 from erp.warehouses where id=$1 and deleted_at is not null", [exc])).rowCount).toBe(1);
    expect((await admin.query("select 1 from erp.product_groups where id=$1 and not is_active", [grupo])).rowCount).toBe(1);
    expect((await admin.query("select 1 from erp.addressings where id=$1 and deleted_at is not null", [endereco])).rowCount).toBe(1);

    const wb = await modelo("products");
    const armazens = listaDe(wb, "Armazém padrão");
    expect(armazens.some((x) => x.includes("Armazém Inativo Ref") || x.includes("Armazém Excluído Ref"))).toBe(false);
    expect(listaDe(wb, "Grupo")).not.toContain("4 - Grupo Inativo Ref");
    expect(listaDe(wb, "Endereçamento").some((x) => x.includes("Endereço Excluído Ref"))).toBe(false);

    const casos: [string, string, string][] = [
      ["Armazém padrão", `ZZZ - Armazém Que Não Existe (${nomeA})`, "Armazéns"],
      ["Armazém padrão", textoIna, "Armazéns"],
      ["Armazém padrão", textoExc, "Armazéns"],
      ["Armazém padrão", "Armazém Inativo Ref", "Armazéns"],
      ["Armazém padrão", "Armazém Excluído Ref", "Armazéns"],
      ["Grupo", "Grupo Inativo Ref", "Grupos de Produtos"],
      ["Endereçamento", "Endereço Excluído Ref", "Endereçamentos"],
    ];
    casos.forEach(([coluna, valor], k) => produto(wb, k + 2, `Ref Recusa ${k}`, { [coluna]: valor }));
    const antes = await contarProdutos();
    const r = await importar(wb, "products");
    recusou(r, casos.map(([coluna, valor, plural], k) => ({ linha: k + 2, coluna, mensagem: naoEncontrado(valor, plural) })));
    // uma frase só para os casos: trocado o valor e o cadastro, sobra o mesmo texto
    const moldes = new Set(j(r).erros.map((e, k) => e.mensagem.replace(`"${casos[k]![1]}"`, "\"X\"").replace(casos[k]![2], "<cadastro>")));
    expect([...moldes]).toEqual(["\"X\" não encontrado em <cadastro>. Use um valor da aba Listas."]);
    expect(await contarProdutos()).toBe(antes);
  });
});

describe("árvore: antecessor numa linha anterior do mesmo arquivo", () => {
  it("R11: categoria financeira — 'código - nome' de uma linha anterior vale como antecessor (prévia e gravação)", async () => {
    const existe = await admin.query("select 1 from erp.financial_categories where organization_id=$1 and code like '8%'", [h.demo.orgId]);
    expect(existe.rowCount, "premissa: códigos 8.* ainda não existem").toBe(0);
    const wb = await modelo("financial_categories");
    expect(listaDe(wb, "Antecessor").some((x) => x.startsWith("8"))).toBe(false);
    preencher(wb, 2, { "Código": "8", "Descrição": "Ref Raiz Imp", "Natureza": "Receita", "Classe": "Sintética" });
    preencher(wb, 3, { "Código": "8.01", "Descrição": "Ref Filha Imp", "Natureza": "Receita", "Classe": "Sintética", "Antecessor": "8 - Ref Raiz Imp" });
    preencher(wb, 4, { "Código": "8.01.001", "Descrição": "Ref Neta Imp", "Natureza": "Receita", "Classe": "Analítica", "Antecessor": "8.01 - Ref Filha Imp" });
    const previa = await importar(wb, "financial_categories", { simular: true });
    expect(previa.statusCode, previa.body).toBe(200);
    expect(j(previa)).toMatchObject({ linhas: 3, gravadas: 0, erros: [], simulacao: true });
    expect((await admin.query("select 1 from erp.financial_categories where organization_id=$1 and code like '8%'", [h.demo.orgId])).rowCount, "a prévia não grava").toBe(0);
    aceitou(await importar(wb, "financial_categories"), 3);
    const r = await admin.query<{ code: string; pai: string | null }>(
      "select c.code, p.code pai from erp.financial_categories c left join erp.financial_categories p on p.id=c.parent_id where c.organization_id=$1 and c.code like '8%' order by c.code", [h.demo.orgId]);
    expect(r.rows).toEqual([{ code: "8", pai: null }, { code: "8.01", pai: "8" }, { code: "8.01.001", pai: "8.01" }]);
  });

  it("R12: endereçamento — o pai criado numa linha anterior é reconhecido pelo CAMINHO, inclusive dois níveis abaixo; e o caminho de um existente também vale", async () => {
    const setor = await criar("addressings", { description: "Setor Árvore" });
    const prat = await criar("addressings", { description: "Prateleira Árvore", parent_id: setor });
    const existe = await admin.query("select 1 from erp.addressings where organization_id=$1 and description in ('Depósito Imp','Rua Imp','Nível Imp','Gaveta Imp')", [h.demo.orgId]);
    expect(existe.rowCount, "premissa: nenhum dos quatro existe").toBe(0);
    const wb = await modelo("addressings");
    expect(listaDe(wb, "Endereçamento pai")).toContain("Setor Árvore > Prateleira Árvore");
    preencher(wb, 2, { "Descrição": "Depósito Imp" });
    preencher(wb, 3, { "Descrição": "Rua Imp", "Endereçamento pai": "Depósito Imp" });
    preencher(wb, 4, { "Descrição": "Nível Imp", "Endereçamento pai": "Depósito Imp > Rua Imp" });
    preencher(wb, 5, { "Descrição": "Gaveta Imp", "Endereçamento pai": "Setor Árvore > Prateleira Árvore" });
    aceitou(await importar(wb, "addressings"), 4);
    const r = await admin.query<{ description: string; pai: string | null; pai_id: string | null }>(
      "select a.description, p.description pai, a.parent_id::text pai_id from erp.addressings a left join erp.addressings p on p.id=a.parent_id where a.organization_id=$1 and a.deleted_at is null and a.description in ('Depósito Imp','Rua Imp','Nível Imp','Gaveta Imp') order by a.description", [h.demo.orgId]);
    expect(r.rows.map(({ description, pai }) => ({ description, pai }))).toEqual([
      { description: "Depósito Imp", pai: null },
      { description: "Gaveta Imp", pai: "Prateleira Árvore" },
      { description: "Nível Imp", pai: "Rua Imp" },
      { description: "Rua Imp", pai: "Depósito Imp" },
    ]);
    expect(r.rows.find((x) => x.description === "Gaveta Imp")!.pai_id).toBe(prat);
    const rua = await admin.query<{ pai: string | null }>("select p.description pai from erp.addressings a join erp.addressings p on p.id=a.parent_id where a.organization_id=$1 and a.description='Rua Imp'", [h.demo.orgId]);
    expect(rua.rows).toEqual([{ pai: "Depósito Imp" }]);
  });
});
