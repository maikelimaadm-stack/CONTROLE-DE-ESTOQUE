import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { moduloDaPermissao } from "@agro/domain";
import { escoposDeTodosOsModulos, harness, TEST_URL, type Harness } from "./setup.js";

/**
 * MAPA-MANEJO-02 (decisão 306) — as rotas das CONFIGURAÇÕES DE ÍCONE DO MAPA (`/api/mapa/icones`,
 * `erp.configuracoes_de_icone`, migration 0062), MM2-12a..MM2-12c.
 *
 *   MM2-12a  criar (chaves EXATAS da linha), listar (filtros tipo_entidade e ativo; total e páginas; ordem tipo_entidade,
 *            categoria, id; a união das páginas é o semeado), detalhe, edição parcial (MISTO → categoria simples exige
 *            `categorias_misto: null` junto), exclusão LÓGICA (a linha fica com deleted_at; depois 404, o total cai 1 e a
 *            categoria pode ser recriada), duas MISTO aceitas, auditoria de create e update (`erp.audit_logs`).
 *   MM2-12b  cada capacidade separada (view, create, edit, delete — cada uma abre só a sua porta; sem nenhuma, 403 em
 *            todas, inclusive com id malformado); outro tenant e fora do escopo → a MESMA 404, corpo idêntico byte a byte
 *            ao do inexistente; categoria repetida → 409 (POST e PATCH); 422 com o caminho do campo — e, em cada recusa,
 *            NADA gravado (a fotografia da tabela e da auditoria antes = depois).
 *   MM2-12c  consulta da lista fora da forma canônica (paginação, filtros) → 422; a forma canônica no limite → 200.
 *
 * O cenário é semeado pela API (dono da organização demo) e pela testemunha (superusuário: `admin`), que também confere
 * o efeito no banco. As categorias criadas aqui são só [A-Z0-9] (`cat`): a ordem do banco é a mesma do `<` em qualquer
 * collation. O tipo `objeto_de_mapa` é RESERVADO ao caso da listagem (a premissa confere que ninguém mais o usa).
 */
let h: Harness; let admin: Db;
type Hdr = Record<string, string>;
type Config = {
  id: string; organization_id: string; empresa_id: string; tipo_entidade: string; categoria: string;
  categorias_misto: string[] | null; icone_url: string | null; cor_padrao: string | null; ativo: boolean;
  created_at: string; updated_at: string;
};
type Lista = { itens: Config[]; total: number; page: number; pageSize: number };
type Detalhe = { path: string; message: string };
type Erro = { error: { code: string; message: string; details?: Detalhe[] } };
type Conflito = { error: { code: string; message: string; details?: { constraint?: string } } };
type Escopo = { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] };
type Resposta = { statusCode: number; body: string };

/** As chaves da linha que a API devolve — nem uma a mais (deleted_at fica de fora), nem uma a menos. */
const CHAVES_DA_LINHA = ["ativo", "categoria", "categorias_misto", "cor_padrao", "created_at", "empresa_id", "icone_url", "id", "organization_id", "tipo_entidade", "updated_at"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";
const MALFORMADO = "nao-e-um-uuid";
const URL_A = "https://imagens.exemplo.test/mm2/a.png";
const URL_B = "https://imagens.exemplo.test/mm2/b.png";
const CORPO_404 = { error: { code: "NOT_FOUND", message: "Configuração de ícone não encontrada" } };
let seq = 0;
const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}`.toUpperCase();
/** Categoria canônica NOVA (maiúsculas e dígitos): nunca colide com outra do arquivo. */
const cat = (prefixo = "C") => `${prefixo}${unico()}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** A ordem do contrato da lista: tipo_entidade, categoria, id. */
const naOrdemDaLista = (a: Config, b: Config) => cmp(a.tipo_entidade, b.tipo_entidade) || cmp(a.categoria, b.categoria) || cmp(a.id, b.id);

let E1: string; let E2: string;
let outraOrg: { orgId: string; empresa: string; config: string };

const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, headers: Hdr = h.headers(), payload?: unknown) =>
  h.app.inject({ method, url, headers: payload === undefined ? headers : { ...headers, "content-type": "application/json" }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
const corpo = (extra: Record<string, unknown> = {}) => ({ empresa_id: E1, tipo_entidade: "lote", categoria: cat(), cor_padrao: "#336699", ...extra });
async function criar(c: Record<string, unknown>, headers: Hdr = h.headers()): Promise<Config> {
  const r = await req("POST", "/api/mapa/icones", headers, c);
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Config;
}
const listar = async (qs: string, headers: Hdr = h.headers()): Promise<Lista> => {
  const r = await req("GET", `/api/mapa/icones?${qs}`, headers);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Lista;
};
const erro = (body: string) => JSON.parse(body) as Erro;
/** A 422 com o caminho do campo: código, e o `path` (um só) em details. */
function recusadoEm(r: Resposta, path: string): Erro {
  expect(r.statusCode, r.body).toBe(422);
  const e = erro(r.body);
  expect(e.error.code).toBe("VALIDATION_ERROR");
  expect(e.error.details?.map((d) => d.path), r.body).toEqual([path]);
  return e;
}

async function membro(nome: string, perms: string[], escopos: readonly Escopo[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico().toLowerCase()}@mm2t3.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Restrito@12345", role_id: (papel.json() as { id: string }).id, escopos_empresas: escopos } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

/** A linha no banco (testemunha, sem RLS), viva ou excluída, no formato da API + `excluida`. */
type NoBanco = Config & { excluida: boolean };
async function noBanco(id: string): Promise<NoBanco | null> {
  const r = await admin.query<Omit<NoBanco, "created_at" | "updated_at"> & { created_at: Date; updated_at: Date }>(
    `select id::text as id, organization_id::text as organization_id, empresa_id::text as empresa_id, tipo_entidade, categoria,
            categorias_misto, icone_url, cor_padrao, ativo, created_at, updated_at, deleted_at is not null as excluida
       from erp.configuracoes_de_icone where id=$1`, [id]);
  const l = r.rows[0];
  return l ? { ...l, created_at: l.created_at.toISOString(), updated_at: l.updated_at.toISOString() } : null;
}
/**
 * FOTOGRAFIA de tudo o que uma gravação deixaria (testemunha): linhas da tabela (todas as organizações, vivas e
 * excluídas), linhas de auditoria da tabela e a última alteração. Recusa = fotografia igual antes e depois.
 */
type Fotografia = { linhas: number; auditoria: number; ultima: string };
async function fotografia(): Promise<Fotografia> {
  return (await admin.query<Fotografia>(
    `select (select count(*)::int from erp.configuracoes_de_icone) as linhas,
            (select count(*)::int from erp.audit_logs where entity='configuracoes_de_icone') as auditoria,
            (select coalesce(max(updated_at)::text, '') from erp.configuracoes_de_icone) as ultima`)).rows[0]!;
}
/** Vivas da organização demo (testemunha), com filtro opcional. */
const vivas = async (filtro = "", params: unknown[] = []) => Number((await admin.query<{ n: string }>(
  `select count(*) n from erp.configuracoes_de_icone where organization_id=$1 and deleted_at is null${filtro}`, [h.demo.orgId, ...params])).rows[0]!.n);

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 3 });
  E1 = h.demo.empresaIds[0]!; E2 = h.demo.empresaIds[1]!;
  expect(E2, "premissa: duas empresas no seed").toBeTruthy();
  expect(E1).not.toBe(E2);
  expect(moduloDaPermissao("icon_config.view"), "premissa: o módulo de escopo é pecuária").toBe("pecuaria");
  expect((await fotografia()).linhas, "premissa: o seed não cria configuração de ícone").toBe(0);
  const o = await seedDemo(admin, { orgName: "[TEST] Org MM2 T3", adminEmail: "admin-mm2t3@demo.local", adminPassword: "Demo@12345", slug: "orgmm2t3" }, () => {});
  const empresaOutra = o.empresaIds[0]!;
  const config = (await admin.query<{ id: string }>(
    `insert into erp.configuracoes_de_icone (organization_id, empresa_id, tipo_entidade, categoria, cor_padrao)
     values ($1,$2,'lote','OUTRAORG','#112233') returning id::text as id`, [o.orgId, empresaOutra])).rows[0]!.id;
  outraOrg = { orgId: o.orgId, empresa: empresaOutra, config };
  expect(outraOrg.orgId).not.toBe(h.demo.orgId);
}, 240_000);
afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

describe("MM2-12a — criar, listar, detalhe, editar, exclusão lógica e auditoria", () => {
  it("MM2-12a criar: 201 com as chaves EXATAS da linha, e a linha no banco é a devolvida", async () => {
    const antes = await fotografia();
    const categoria = cat("CRIA");
    const r = await req("POST", "/api/mapa/icones", h.headers(), { empresa_id: E1, tipo_entidade: "lote", categoria, icone_url: URL_A, cor_padrao: "#1a2B3c" });
    expect(r.statusCode, r.body).toBe(201);
    const c = r.json() as Config;
    expect(Object.keys(c).sort()).toEqual(CHAVES_DA_LINHA);
    expect(c).toEqual({
      id: expect.stringMatching(UUID), organization_id: h.demo.orgId, empresa_id: E1, tipo_entidade: "lote", categoria,
      categorias_misto: null, icone_url: URL_A, cor_padrao: "#1a2B3c", ativo: true, created_at: expect.any(String), updated_at: expect.any(String),
    });
    expect(await noBanco(c.id)).toEqual({ ...c, excluida: false });
    // uma linha e uma auditoria a mais — a fotografia enxerga a gravação (premissa das recusas do MM2-12b)
    const depois = await fotografia();
    expect([depois.linhas - antes.linhas, depois.auditoria - antes.auditoria]).toEqual([1, 1]);

    // só a imagem; só a cor e inativa; o MISTO com a lista
    const soImagem = await criar({ empresa_id: E1, tipo_entidade: "area", categoria: cat(), icone_url: URL_B });
    expect([soImagem.tipo_entidade, soImagem.icone_url, soImagem.cor_padrao, soImagem.ativo]).toEqual(["area", URL_B, null, true]);
    const inativa = await criar(corpo({ ativo: false }));
    expect([inativa.icone_url, inativa.cor_padrao, inativa.ativo]).toEqual([null, "#336699", false]);
    const [x, y] = [cat("X"), cat("Y")];
    const misto = await criar(corpo({ categoria: "MISTO", categorias_misto: [x, y] }));
    expect([misto.categoria, misto.categorias_misto]).toEqual(["MISTO", [x, y]]);
    for (const l of [soImagem, inativa, misto]) {
      expect(Object.keys(l).sort()).toEqual(CHAVES_DA_LINHA);
      expect(await noBanco(l.id)).toEqual({ ...l, excluida: false });
    }
  });

  it("MM2-12a listar: filtros tipo_entidade e ativo, total e páginas com pageSize pequeno, ordem tipo_entidade/categoria/id, a união das páginas = semeados", async () => {
    expect(await vivas(" and tipo_entidade='objeto_de_mapa'"), "premissa: objeto_de_mapa é só deste caso").toBe(0);
    const tag = `L${unico()}`;
    // fora de ordem de propósito; A e B inativas
    const semeados: Config[] = [];
    for (const [sufixo, ativo] of [["E", true], ["A", false], ["C", true], ["B", false], ["D", true]] as const) {
      semeados.push(await criar(corpo({ tipo_entidade: "objeto_de_mapa", categoria: `${tag}${sufixo}`, ativo })));
    }
    // duas MISTO com o MESMO conjunto, no mesmo (empresa, tipo): o desempate pelo id
    for (let i = 0; i < 2; i++) semeados.push(await criar(corpo({ tipo_entidade: "objeto_de_mapa", categoria: "MISTO", categorias_misto: [`${tag}A`, `${tag}B`] })));
    expect(await vivas(" and tipo_entidade='objeto_de_mapa'")).toBe(7);
    const esperado = [...semeados].sort(naOrdemDaLista).map((c) => c.id);
    expect(esperado.length).toBe(7);

    const q = "tipo_entidade=objeto_de_mapa&pageSize=3";
    const l1 = await listar(`${q}&page=1`);
    const l2 = await listar(`${q}&page=2`);
    const l3 = await listar(`${q}&page=3`);
    const l4 = await listar(`${q}&page=4`);
    expect([l1.total, l1.page, l1.pageSize, l1.itens.length]).toEqual([7, 1, 3, 3]);
    expect([l2.total, l2.page, l2.pageSize, l2.itens.length]).toEqual([7, 2, 3, 3]);
    expect([l3.total, l3.page, l3.pageSize, l3.itens.length]).toEqual([7, 3, 3, 1]);
    expect([l4.total, l4.page, l4.itens.length]).toEqual([7, 4, 0]);
    const paginas = [...l1.itens, ...l2.itens, ...l3.itens];
    // a união das páginas é exatamente o semeado, sem repetição, na ordem do contrato
    expect(new Set(paginas.map((c) => c.id)).size).toBe(7);
    expect(paginas.map((c) => c.id)).toEqual(esperado);
    expect(paginas.map((c) => c.categoria)).toEqual([`${tag}A`, `${tag}B`, `${tag}C`, `${tag}D`, `${tag}E`, "MISTO", "MISTO"]);
    // o item da lista é a linha inteira, igual à devolvida na criação
    const porId = new Map(semeados.map((c) => [c.id, c]));
    for (const c of paginas) expect(c).toEqual(porId.get(c.id));

    // filtro ativo
    const inativas = await listar("tipo_entidade=objeto_de_mapa&ativo=false");
    expect([inativas.total, inativas.itens.map((c) => c.categoria)]).toEqual([2, [`${tag}A`, `${tag}B`]]);
    expect(inativas.itens.every((c) => c.ativo === false)).toBe(true);
    const ativas = await listar("tipo_entidade=objeto_de_mapa&ativo=true");
    expect([ativas.total, ativas.itens.length]).toEqual([5, 5]);
    expect(ativas.itens.every((c) => c.ativo === true && c.tipo_entidade === "objeto_de_mapa")).toBe(true);

    // filtro tipo_entidade em outro tipo: só ele, e o total é o da testemunha
    const lotes = await listar("tipo_entidade=lote&pageSize=1000");
    expect(lotes.total).toBe(await vivas(" and tipo_entidade='lote'"));
    expect(lotes.total).toBeGreaterThan(0);
    expect(lotes.itens.length).toBe(lotes.total);
    expect(lotes.itens.every((c) => c.tipo_entidade === "lote")).toBe(true);

    // sem filtro: tudo o que está vivo na organização, na ordem tipo_entidade, categoria, id (entre tipos)
    const tudo = await listar("pageSize=1000");
    expect(tudo.total).toBe(await vivas());
    expect(tudo.itens.length).toBe(tudo.total);
    expect(new Set(tudo.itens.map((c) => c.tipo_entidade)).size, "premissa: a ordem é conferida entre tipos").toBe(3);
    expect(tudo.itens.map((c) => c.id)).toEqual([...tudo.itens].sort(naOrdemDaLista).map((c) => c.id));
    expect(tudo.itens.every((c) => c.organization_id === h.demo.orgId)).toBe(true);
    // só inativas, em todos os tipos
    const soInativas = await listar("ativo=false&pageSize=1000");
    expect(soInativas.total).toBe(await vivas(" and not ativo"));
    expect(soInativas.itens.every((c) => c.ativo === false)).toBe(true);
  });

  it("MM2-12a detalhe e edição parcial; trocar de MISTO para categoria simples exige categorias_misto: null junto", async () => {
    const c = await criar(corpo({ icone_url: URL_A, cor_padrao: "#112233" }));
    const d = await req("GET", `/api/mapa/icones/${c.id}`);
    expect(d.statusCode, d.body).toBe(200);
    expect(d.json()).toEqual(c);

    // PATCH parcial: só a cor muda; o resto fica
    const e1 = await req("PATCH", `/api/mapa/icones/${c.id}`, h.headers(), { cor_padrao: "#445566" });
    expect(e1.statusCode, e1.body).toBe(200);
    const p1 = e1.json() as Config;
    expect(p1).toEqual({ ...c, cor_padrao: "#445566", updated_at: expect.any(String) });
    expect(Date.parse(p1.updated_at)).toBeGreaterThanOrEqual(Date.parse(c.updated_at));
    expect(await noBanco(c.id)).toEqual({ ...p1, excluida: false });
    // tirar a imagem (fica só a cor) e desativar
    const e2 = await req("PATCH", `/api/mapa/icones/${c.id}`, h.headers(), { icone_url: null, ativo: false });
    expect(e2.statusCode, e2.body).toBe(200);
    const p2 = e2.json() as Config;
    expect(p2).toEqual({ ...p1, icone_url: null, ativo: false, updated_at: expect.any(String) });
    // trocar a categoria por outra canônica
    const nova = cat("NOVA");
    const e3 = await req("PATCH", `/api/mapa/icones/${c.id}`, h.headers(), { categoria: nova });
    expect(e3.statusCode, e3.body).toBe(200);
    const p3 = e3.json() as Config;
    expect(p3).toEqual({ ...p2, categoria: nova, updated_at: expect.any(String) });
    expect(Object.keys(p3).sort()).toEqual(CHAVES_DA_LINHA);
    expect((await req("GET", `/api/mapa/icones/${c.id}`)).json()).toEqual(p3);
    expect(await noBanco(c.id)).toEqual({ ...p3, excluida: false });

    // MISTO → categoria simples: só a categoria é 422 em categorias_misto, e nada muda
    const [x, y] = [cat("X"), cat("Y")];
    const m = await criar(corpo({ categoria: "MISTO", categorias_misto: [x, y], cor_padrao: "#778899" }));
    const fotoM = await fotografia();
    const simples = cat("S");
    recusadoEm(await req("PATCH", `/api/mapa/icones/${m.id}`, h.headers(), { categoria: simples }), "categorias_misto");
    expect(await noBanco(m.id)).toEqual({ ...m, excluida: false });
    expect(await fotografia()).toEqual(fotoM);
    // com categorias_misto: null junto, aceita
    const ok = await req("PATCH", `/api/mapa/icones/${m.id}`, h.headers(), { categoria: simples, categorias_misto: null });
    expect(ok.statusCode, ok.body).toBe(200);
    const pm = ok.json() as Config;
    expect(pm).toEqual({ ...m, categoria: simples, categorias_misto: null, updated_at: expect.any(String) });
    expect(await noBanco(m.id)).toEqual({ ...pm, excluida: false });
    // e de volta: simples → MISTO sem a lista é 422; com a lista, 200 (a lista volta na ordem enviada)
    recusadoEm(await req("PATCH", `/api/mapa/icones/${m.id}`, h.headers(), { categoria: "MISTO" }), "categorias_misto");
    expect(await noBanco(m.id)).toEqual({ ...pm, excluida: false });
    const volta = await req("PATCH", `/api/mapa/icones/${m.id}`, h.headers(), { categoria: "MISTO", categorias_misto: [y, x] });
    expect(volta.statusCode, volta.body).toBe(200);
    expect(volta.json()).toEqual({ ...pm, categoria: "MISTO", categorias_misto: [y, x], updated_at: expect.any(String) });
    // só a lista do MISTO muda
    const lista = await req("PATCH", `/api/mapa/icones/${m.id}`, h.headers(), { categorias_misto: [x, y, simples] });
    expect(lista.statusCode, lista.body).toBe(200);
    expect((lista.json() as Config).categorias_misto).toEqual([x, y, simples]);
    expect((await noBanco(m.id))?.categorias_misto).toEqual([x, y, simples]);
  });

  it("MM2-12a exclusão lógica: a linha FICA no banco com deleted_at; depois 404, o total da lista cai 1, e a categoria pode ser recriada", async () => {
    const categoria = cat("DEL");
    const c = await criar({ empresa_id: E1, tipo_entidade: "area", categoria, cor_padrao: "#010203" });
    const antes = await listar("tipo_entidade=area&pageSize=1000");
    expect(antes.itens.some((x) => x.id === c.id)).toBe(true);
    expect(antes.total).toBe(await vivas(" and tipo_entidade='area'"));

    const x = await req("DELETE", `/api/mapa/icones/${c.id}`);
    expect(x.statusCode, x.body).toBe(200);
    expect(x.json()).toEqual({ id: c.id, deleted: true });

    const d = await req("GET", `/api/mapa/icones/${c.id}`);
    expect(d.statusCode).toBe(404);
    expect(JSON.parse(d.body)).toEqual(CORPO_404);
    const depois = await listar("tipo_entidade=area&pageSize=1000");
    expect(depois.total).toBe(antes.total - 1);
    expect(depois.itens.some((y) => y.id === c.id)).toBe(false);
    // a linha continua no banco, com deleted_at (exclusão lógica, nunca física), e o resto como estava
    const fisico = await admin.query<{ n: string; excluidas: string }>(
      "select count(*) n, count(*) filter (where deleted_at is not null) excluidas from erp.configuracoes_de_icone where id=$1", [c.id]);
    expect(fisico.rows[0]).toEqual({ n: "1", excluidas: "1" });
    expect(await noBanco(c.id)).toMatchObject({ categoria, cor_padrao: "#010203", ativo: true, excluida: true });
    // ROW COUNT: excluir de novo, ou editar a excluída, não é sucesso sem efeito
    const foto = await fotografia();
    expect((await req("DELETE", `/api/mapa/icones/${c.id}`)).statusCode).toBe(404);
    expect((await req("PATCH", `/api/mapa/icones/${c.id}`, h.headers(), { cor_padrao: "#FFFFFF" })).statusCode).toBe(404);
    expect(await fotografia()).toEqual(foto);

    // a categoria pode ser recriada: o único vale só entre as vivas
    const deNovo = await criar({ empresa_id: E1, tipo_entidade: "area", categoria, cor_padrao: "#010203" });
    expect(deNovo.id).not.toBe(c.id);
    const porCategoria = await admin.query<{ vivas: string; excluidas: string }>(
      `select count(*) filter (where deleted_at is null) vivas, count(*) filter (where deleted_at is not null) excluidas
         from erp.configuracoes_de_icone where organization_id=$1 and empresa_id=$2 and tipo_entidade='area' and categoria=$3`, [h.demo.orgId, E1, categoria]);
    expect(porCategoria.rows[0]).toEqual({ vivas: "1", excluidas: "1" });
    expect((await listar("tipo_entidade=area&pageSize=1000")).total).toBe(antes.total);
  });

  it("MM2-12a duas MISTO com o mesmo conjunto na mesma empresa e tipo: as duas aceitas (o único deixa o MISTO de fora)", async () => {
    const [x, y] = [cat("X"), cat("Y")];
    const antes = await vivas(" and empresa_id=$2 and tipo_entidade='lote' and categoria='MISTO'", [E1]);
    const a = await criar(corpo({ categoria: "MISTO", categorias_misto: [x, y] }));
    const b = await criar(corpo({ categoria: "MISTO", categorias_misto: [x, y], icone_url: URL_A }));
    expect(a.id).not.toBe(b.id);
    expect([a.categorias_misto, b.categorias_misto]).toEqual([[x, y], [x, y]]);
    expect(await vivas(" and empresa_id=$2 and tipo_entidade='lote' and categoria='MISTO'", [E1])).toBe(antes + 2);
    expect((await noBanco(a.id))?.excluida).toBe(false);
    expect((await noBanco(b.id))?.excluida).toBe(false);
  });

  it("MM2-12a auditoria: o gatilho grava create e update em erp.audit_logs (a exclusão lógica é um update)", async () => {
    const c = await criar(corpo({ cor_padrao: "#0A0B0C" }));
    const e = await req("PATCH", `/api/mapa/icones/${c.id}`, h.headers(), { cor_padrao: "#0D0E0F" });
    expect(e.statusCode, e.body).toBe(200);
    const logs = async () => (await admin.query<{ action: string; organization_id: string; user_id: string | null; antes: string | null; depois: string | null; excluida_depois: boolean }>(
      `select action, organization_id::text as organization_id, user_id::text as user_id, before->>'cor_padrao' as antes,
              after->>'cor_padrao' as depois, (after->>'deleted_at') is not null as excluida_depois
         from erp.audit_logs where entity='configuracoes_de_icone' and entity_id=$1 order by id`, [c.id])).rows;
    const quem = { organization_id: h.demo.orgId, user_id: h.demo.adminUserId };
    expect(await logs()).toEqual([
      { action: "create", ...quem, antes: null, depois: "#0A0B0C", excluida_depois: false },
      { action: "update", ...quem, antes: "#0A0B0C", depois: "#0D0E0F", excluida_depois: false },
    ]);
    expect((await req("DELETE", `/api/mapa/icones/${c.id}`)).statusCode).toBe(200);
    expect(await logs()).toEqual([
      { action: "create", ...quem, antes: null, depois: "#0A0B0C", excluida_depois: false },
      { action: "update", ...quem, antes: "#0A0B0C", depois: "#0D0E0F", excluida_depois: false },
      { action: "update", ...quem, antes: "#0D0E0F", depois: "#0D0E0F", excluida_depois: true },
    ]);
  });
});

describe("MM2-12b — capacidade por capacidade (403), a MESMA 404 para quem não deve saber, 409 e 422 sem gravar nada", () => {
  const todas = () => escoposDeTodosOsModulos([]);

  it("MM2-12b cada capacidade sozinha abre só a sua porta; sem nenhuma, 403 em todas (inclusive com id malformado)", async () => {
    const alvo = await criar(corpo());
    const alvoDelete = await criar(corpo());
    const soView = await membro("MM2 view", ["icon_config.view"], todas());
    const soCreate = await membro("MM2 create", ["icon_config.create"], todas());
    const soEdit = await membro("MM2 edit", ["icon_config.edit"], todas());
    const soDelete = await membro("MM2 delete", ["icon_config.delete"], todas());
    const nenhuma = await membro("MM2 nenhuma", ["products.view"], todas());

    const prefixo = cat("CAP");
    // cada membro tenta criar uma categoria própria e pintar o alvo com uma cor própria
    const portas = async (headers: Hdr, marca: string, cor: string) => ({
      lista: (await req("GET", "/api/mapa/icones", headers)).statusCode,
      detalhe: (await req("GET", `/api/mapa/icones/${alvo.id}`, headers)).statusCode,
      cria: (await req("POST", "/api/mapa/icones", headers, corpo({ categoria: `${prefixo}${marca}` }))).statusCode,
      edita: (await req("PATCH", `/api/mapa/icones/${alvo.id}`, headers, { cor_padrao: cor })).statusCode,
    });
    expect(await portas(soView, "V", "#000001")).toEqual({ lista: 200, detalhe: 200, cria: 403, edita: 403 });
    expect(await portas(soCreate, "C", "#000002")).toEqual({ lista: 403, detalhe: 403, cria: 201, edita: 403 });
    expect(await portas(soEdit, "E", "#000003")).toEqual({ lista: 403, detalhe: 403, cria: 403, edita: 200 });
    expect(await portas(soDelete, "D", "#000004")).toEqual({ lista: 403, detalhe: 403, cria: 403, edita: 403 });
    expect(await portas(nenhuma, "N", "#000005")).toEqual({ lista: 403, detalhe: 403, cria: 403, edita: 403 });
    // só a delete exclui: as outras quatro levam 403 e a linha continua viva
    for (const [quem, hdr] of [["view", soView], ["create", soCreate], ["edit", soEdit], ["nenhuma", nenhuma]] as const) {
      expect([quem, (await req("DELETE", `/api/mapa/icones/${alvoDelete.id}`, hdr)).statusCode]).toEqual([quem, 403]);
    }
    expect((await noBanco(alvoDelete.id))?.excluida).toBe(false);
    expect((await req("DELETE", `/api/mapa/icones/${alvoDelete.id}`, soDelete)).statusCode).toBe(200);
    expect((await noBanco(alvoDelete.id))?.excluida).toBe(true);

    // o 403 é da capacidade, com o código de sempre
    const negado = erro((await req("GET", "/api/mapa/icones", nenhuma)).body);
    expect(negado.error.code).toBe("PERMISSION_DENIED");
    // efeito das portas abertas, e só delas: UMA criação (a do create) e UMA edição (a do edit)
    const criadas = await admin.query<{ categoria: string }>("select categoria from erp.configuracoes_de_icone where categoria like $1 order by categoria", [`${prefixo}%`]);
    expect(criadas.rows.map((r) => r.categoria)).toEqual([`${prefixo}C`]);
    expect(await noBanco(alvo.id)).toMatchObject({ cor_padrao: "#000003", excluida: false });
    const edicoes = await admin.query<{ n: string }>("select count(*) n from erp.audit_logs where entity='configuracoes_de_icone' and entity_id=$1 and action='update'", [alvo.id]);
    expect(edicoes.rows[0]!.n).toBe("1");

    // o 403 vem ANTES da forma do id: sem a capacidade, id malformado ou inexistente também é 403
    for (const id of [MALFORMADO, NAO_ACHADO]) {
      expect([id, (await req("GET", `/api/mapa/icones/${id}`, nenhuma)).statusCode]).toEqual([id, 403]);
      expect([id, (await req("PATCH", `/api/mapa/icones/${id}`, nenhuma, { cor_padrao: "#000006" })).statusCode]).toEqual([id, 403]);
      expect([id, (await req("DELETE", `/api/mapa/icones/${id}`, nenhuma)).statusCode]).toEqual([id, 403]);
    }
    expect((await req("POST", "/api/mapa/icones", nenhuma, { lixo: true })).statusCode).toBe(403);
    // e nas portas que cada um NÃO tem, o mesmo
    expect((await req("PATCH", `/api/mapa/icones/${MALFORMADO}`, soView, { cor_padrao: "#000007" })).statusCode).toBe(403);
    expect((await req("DELETE", `/api/mapa/icones/${MALFORMADO}`, soView)).statusCode).toBe(403);
    expect((await req("GET", `/api/mapa/icones/${MALFORMADO}`, soCreate)).statusCode).toBe(403);
    expect((await req("DELETE", `/api/mapa/icones/${MALFORMADO}`, soEdit)).statusCode).toBe(403);
    expect((await req("PATCH", `/api/mapa/icones/${MALFORMADO}`, soDelete, { cor_padrao: "#000008" })).statusCode).toBe(403);
    // contraprova: COM a capacidade, o id malformado é a 404 de sempre
    const comCapacidade = await req("GET", `/api/mapa/icones/${MALFORMADO}`, soView);
    expect(comCapacidade.statusCode).toBe(404);
    expect(JSON.parse(comCapacidade.body)).toEqual(CORPO_404);
  });

  it("MM2-12b outro tenant: a MESMA 404 do inexistente, corpo idêntico byte a byte, em GET/PATCH/DELETE — e nada muda", async () => {
    const inexistente = await req("GET", `/api/mapa/icones/${NAO_ACHADO}`);
    expect(inexistente.statusCode).toBe(404);
    expect(JSON.parse(inexistente.body)).toEqual(CORPO_404);
    const corpo404 = inexistente.body;
    const mesma404 = (r: Resposta) => { expect(r.statusCode, r.body).toBe(404); expect(r.body).toBe(corpo404); };

    // premissa: a configuração da outra organização existe e está viva (testemunha)
    const antes = await noBanco(outraOrg.config);
    expect(antes).toMatchObject({ organization_id: outraOrg.orgId, empresa_id: outraOrg.empresa, categoria: "OUTRAORG", excluida: false });
    const foto = await fotografia();
    mesma404(await req("GET", `/api/mapa/icones/${outraOrg.config}`));
    mesma404(await req("PATCH", `/api/mapa/icones/${outraOrg.config}`, h.headers(), { cor_padrao: "#000000" }));
    mesma404(await req("DELETE", `/api/mapa/icones/${outraOrg.config}`));
    expect(await noBanco(outraOrg.config)).toEqual(antes);
    expect(await fotografia()).toEqual(foto);
    // nem aparece na lista
    expect((await listar("pageSize=1000")).itens.some((c) => c.id === outraOrg.config)).toBe(false);

    // excluída e id malformado: a mesma 404
    const excl = await criar(corpo());
    expect((await req("DELETE", `/api/mapa/icones/${excl.id}`)).statusCode).toBe(200);
    for (const id of [excl.id, MALFORMADO, NAO_ACHADO]) {
      mesma404(await req("GET", `/api/mapa/icones/${id}`));
      mesma404(await req("PATCH", `/api/mapa/icones/${id}`, h.headers(), { cor_padrao: "#000000" }));
      mesma404(await req("DELETE", `/api/mapa/icones/${id}`));
    }
  });

  it("MM2-12b fora do escopo (membro só na empresa 1, configuração da empresa 2): a MESMA 404; criar na empresa 2 é recusado", async () => {
    const soE1 = await membro("MM2 escopo E1", ["icon_config.view", "icon_config.create", "icon_config.edit", "icon_config.delete"], escoposDeTodosOsModulos([E1]));
    const deE1 = await criar(corpo());
    const deE2 = await criar(corpo({ empresa_id: E2 }));
    expect(deE2.empresa_id).toBe(E2);
    const corpo404 = (await req("GET", `/api/mapa/icones/${NAO_ACHADO}`, soE1)).body;
    expect(corpo404).toBe((await req("GET", `/api/mapa/icones/${NAO_ACHADO}`)).body);
    const mesma404 = (r: Resposta) => { expect(r.statusCode, r.body).toBe(404); expect(r.body).toBe(corpo404); };

    expect((await req("GET", `/api/mapa/icones/${deE1.id}`, soE1)).statusCode, "premissa: o membro lê a empresa 1").toBe(200);
    const antes = await noBanco(deE2.id);
    const foto = await fotografia();
    mesma404(await req("GET", `/api/mapa/icones/${deE2.id}`, soE1));
    mesma404(await req("PATCH", `/api/mapa/icones/${deE2.id}`, soE1, { cor_padrao: "#000000" }));
    mesma404(await req("DELETE", `/api/mapa/icones/${deE2.id}`, soE1));
    expect(await noBanco(deE2.id)).toEqual(antes);
    expect(await fotografia()).toEqual(foto);

    // a lista do membro: só a empresa 1, com o total da testemunha
    const lista = await listar("pageSize=1000", soE1);
    expect(lista.itens.some((c) => c.id === deE1.id)).toBe(true);
    expect(lista.itens.some((c) => c.id === deE2.id)).toBe(false);
    expect(lista.itens.every((c) => c.empresa_id === E1)).toBe(true);
    expect(lista.total).toBe(await vivas(" and empresa_id=$2", [E1]));
    expect(await vivas(" and empresa_id=$2", [E2]), "premissa: há configuração viva na empresa 2").toBeGreaterThan(0);

    // criar na empresa 2: o pedido de empresa não é autorização (422), e nada é gravado
    const naE2 = await req("POST", "/api/mapa/icones", soE1, corpo({ empresa_id: E2 }));
    expect(naE2.statusCode, naE2.body).toBe(422);
    expect(erro(naE2.body).error.code).toBe("VALIDATION_ERROR");
    expect(await fotografia()).toEqual(foto);
  });

  it("MM2-12b categoria repetida → 409 no POST e no PATCH, e nada gravado; outro tipo ou outra empresa aceitam a mesma categoria", async () => {
    const categoria = cat("REP");
    const a = await criar(corpo({ categoria }));
    const conflito = (r: Resposta) => {
      expect(r.statusCode, r.body).toBe(409);
      const e = JSON.parse(r.body) as Conflito;
      expect(e.error.code).toBe("CONFLICT");
      expect(e.error.details?.constraint).toBe("uq_configuracoes_de_icone_categoria");
    };
    let foto = await fotografia();
    conflito(await req("POST", "/api/mapa/icones", h.headers(), corpo({ categoria, icone_url: URL_A })));
    expect(await fotografia()).toEqual(foto);
    // inativa continua ocupando a categoria
    expect((await req("PATCH", `/api/mapa/icones/${a.id}`, h.headers(), { ativo: false })).statusCode).toBe(200);
    foto = await fotografia();
    conflito(await req("POST", "/api/mapa/icones", h.headers(), corpo({ categoria })));
    expect(await fotografia()).toEqual(foto);
    // PATCH: outra configuração tenta tomar a categoria
    const b = await criar(corpo());
    const bAntes = await noBanco(b.id);
    foto = await fotografia();
    conflito(await req("PATCH", `/api/mapa/icones/${b.id}`, h.headers(), { categoria }));
    expect(await noBanco(b.id)).toEqual(bAntes);
    expect(await fotografia()).toEqual(foto);
    expect(await vivas(" and empresa_id=$2 and tipo_entidade='lote' and categoria=$3", [E1, categoria])).toBe(1);
    // a mesma categoria em outro tipo de entidade, ou em outra empresa: aceita
    await criar(corpo({ categoria, tipo_entidade: "area" }));
    await criar(corpo({ categoria, empresa_id: E2 }));
    expect(await vivas(" and categoria=$2", [categoria])).toBe(3);
  });

  it("MM2-12b 422 com o caminho do campo em cada recusa, e NADA gravado (fotografia antes = depois)", async () => {
    const semCor = { empresa_id: E1, tipo_entidade: "lote", categoria: cat() };
    const casosPost: [string, Record<string, unknown>, string][] = [
      ["categoria minúscula", corpo({ categoria: "boi" }), "categoria"],
      ["categoria com espaço na ponta", corpo({ categoria: " BOI" }), "categoria"],
      ["categoria capitalizada", corpo({ categoria: "Boi" }), "categoria"],
      ["MISTO com lista de uma", corpo({ categoria: "MISTO", categorias_misto: ["BOI"] }), "categorias_misto"],
      ["MISTO com lista repetida", corpo({ categoria: "MISTO", categorias_misto: ["BOI", "BOI"] }), "categorias_misto"],
      ["MISTO com lista minúscula", corpo({ categoria: "MISTO", categorias_misto: ["boi", "VACA"] }), "categorias_misto"],
      ["MISTO com lista que não é lista", corpo({ categoria: "MISTO", categorias_misto: "BOI,VACA" }), "categorias_misto"],
      ["MISTO com lista de não-texto", corpo({ categoria: "MISTO", categorias_misto: [1, 2] }), "categorias_misto"],
      ["lista fora do MISTO", corpo({ categorias_misto: ["BOI", "VACA"] }), "categorias_misto"],
      ["MISTO sem lista", corpo({ categoria: "MISTO" }), "categorias_misto"],
      ["MISTO com lista nula", corpo({ categoria: "MISTO", categorias_misto: null }), "categorias_misto"],
      ["URL http://", corpo({ icone_url: "http://imagens.exemplo.test/mm2/a.png" }), "icone_url"],
      ["URL com usuário e senha", corpo({ icone_url: "https://usuario:segredo@imagens.exemplo.test/mm2/a.png" }), "icone_url"],
      ["URL só com usuário", corpo({ icone_url: "https://usuario@imagens.exemplo.test/mm2/a.png" }), "icone_url"],
      ["cor azul", corpo({ cor_padrao: "azul" }), "cor_padrao"],
      ["sem imagem e sem cor", semCor, "icone_url"],
      ["sem imagem e sem cor, nulos explícitos", { ...semCor, icone_url: null, cor_padrao: null }, "icone_url"],
      ["tipo_entidade fora do enum", corpo({ tipo_entidade: "cerca" }), "tipo_entidade"],
    ];
    for (const [caso, c, path] of casosPost) {
      const antes = await fotografia();
      const r = await req("POST", "/api/mapa/icones", h.headers(), c);
      expect([caso, r.statusCode]).toEqual([caso, 422]);
      recusadoEm(r, path);
      expect([caso, await fotografia()]).toEqual([caso, antes]);
    }

    // chave desconhecida no POST: 422 no caminho raiz, "Campo não reconhecido"
    let antes = await fotografia();
    const desconhecida = await req("POST", "/api/mapa/icones", h.headers(), corpo({ nome: "x" }));
    expect(desconhecida.statusCode, desconhecida.body).toBe(422);
    expect(erro(desconhecida.body).error.details).toEqual([{ path: "", message: "Campo não reconhecido" }]);
    expect(await fotografia()).toEqual(antes);

    // PATCH: a linha não muda e nada é gravado
    const alvo = await criar(corpo({ cor_padrao: "#ABCDEF" }));
    const linha = await noBanco(alvo.id);
    const casosPatch: [string, Record<string, unknown>, string][] = [
      ["categoria minúscula", { categoria: "boi" }, "categoria"],
      ["categoria com espaço na ponta", { categoria: " BOI" }, "categoria"],
      ["categoria capitalizada", { categoria: "Boi" }, "categoria"],
      ["lista fora do MISTO", { categorias_misto: ["BOI", "VACA"] }, "categorias_misto"],
      ["vira MISTO sem lista", { categoria: "MISTO" }, "categorias_misto"],
      ["URL http://", { icone_url: "http://imagens.exemplo.test/mm2/a.png" }, "icone_url"],
      ["URL com usuário e senha", { icone_url: "https://usuario:segredo@imagens.exemplo.test/mm2/a.png" }, "icone_url"],
      ["cor azul", { cor_padrao: "azul" }, "cor_padrao"],
      ["tira a cor e fica sem imagem e sem cor", { cor_padrao: null }, "icone_url"],
    ];
    for (const [caso, c, path] of casosPatch) {
      antes = await fotografia();
      const r = await req("PATCH", `/api/mapa/icones/${alvo.id}`, h.headers(), c);
      expect([caso, r.statusCode]).toEqual([caso, 422]);
      recusadoEm(r, path);
      expect([caso, await fotografia()]).toEqual([caso, antes]);
      expect([caso, await noBanco(alvo.id)]).toEqual([caso, linha]);
    }
    // PATCH com chave desconhecida (empresa e tipo não mudam), e PATCH vazio
    for (const [caso, c] of [["empresa_id", { empresa_id: E2 }], ["tipo_entidade", { tipo_entidade: "area" }]] as const) {
      antes = await fotografia();
      const r = await req("PATCH", `/api/mapa/icones/${alvo.id}`, h.headers(), { cor_padrao: "#000000", ...c });
      expect([caso, r.statusCode]).toEqual([caso, 422]);
      expect([caso, erro(r.body).error.details]).toEqual([caso, [{ path: "", message: "Campo não reconhecido" }]]);
      expect([caso, await fotografia()]).toEqual([caso, antes]);
    }
    antes = await fotografia();
    const vazio = await req("PATCH", `/api/mapa/icones/${alvo.id}`, h.headers(), {});
    expect(vazio.statusCode, vazio.body).toBe(422);
    expect(erro(vazio.body).error.details).toEqual([{ path: "", message: "Informe ao menos um campo para alterar" }]);
    const soDesconhecida = await req("PATCH", `/api/mapa/icones/${alvo.id}`, h.headers(), { nome: "x" });
    expect(soDesconhecida.statusCode, soDesconhecida.body).toBe(422);
    expect(erro(soDesconhecida.body).error.details?.map((d) => d.message)).toContain("Campo não reconhecido");
    expect(await fotografia()).toEqual(antes);
    expect(await noBanco(alvo.id)).toEqual(linha);

    // contraprova: a fotografia enxerga uma gravação válida
    antes = await fotografia();
    await criar(corpo());
    const depois = await fotografia();
    expect([depois.linhas - antes.linhas, depois.auditoria - antes.auditoria]).toEqual([1, 1]);
  });
});

describe("MM2-12c — a consulta da lista fora da forma canônica", () => {
  it("MM2-12c paginação e filtros não canônicos (page=1e1, pageSize=0x2, ativo=1, tipo fora do catálogo, filtro desconhecido) → 422; o limite canônico → 200", async () => {
    for (const qs of ["page=1e1", "pageSize=0x2", "page=%203", "page=2.0", "page=01", "page=0", "page=-1", "page=", "pageSize=1001", "page=100001",
      "ativo=1", "ativo=TRUE", "ativo=sim", "tipo_entidade=cerca", "tipo_entidade=LOTE", "cor=azul"]) {
      const r = await req("GET", `/api/mapa/icones?${qs}`);
      expect([qs, r.statusCode]).toEqual([qs, 422]);
      expect([qs, erro(r.body).error.code]).toEqual([qs, "VALIDATION_ERROR"]);
    }
    // a forma canônica no limite continua aceita (página além do fim: itens vazios, total verdadeiro)
    const limite = await listar("pageSize=1000&page=100000");
    expect([limite.page, limite.pageSize, limite.itens.length]).toEqual([100000, 1000, 0]);
    expect(limite.total).toBe(await vivas());
    expect(limite.total).toBeGreaterThan(0);
  });
});
