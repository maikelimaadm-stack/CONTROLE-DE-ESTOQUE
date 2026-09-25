import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, seedDemo, type Db } from "@agro/db";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { harness, configDeTeste, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS Fase 4 — PARCEIROS: ficha em abas (decisão 253, migration 0027). PA-1..PA-10; DOC-1 (R1-6); PT-1, PT-2 (R1-4).
 * Toda recusa confere o BANCO (nada gravado); todo aceite confere a linha gravada.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
type Det = { path: string; message: string; aba?: string; detalhe?: string; linha?: number };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const get = (url: string, headers = h.headers()) => h.app.inject({ method: "GET", url, headers });
const post = (payload: Record<string, unknown>, headers = hdr()) => h.app.inject({ method: "POST", url: "/api/resources/people", headers, payload });
const put = (id: string, payload: Record<string, unknown>, headers = hdr()) => h.app.inject({ method: "PUT", url: `/api/resources/people/${id}`, headers, payload });
const criado = (r: Resp) => { expect(r.statusCode, r.body).toBe(201); return j(r).id as string; };
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const n = async (sql: string, p: unknown[] = []) => Number((await um<{ n: string }>(sql, p))!.n);
const porNome = (nome: string) => n("select count(*)::text n from erp.people where organization_id=$1 and name=$2", [h.demo.orgId, nome]);
const nome = (s: string) => `PA ${s} ${Math.random().toString(36).slice(2, 8)}`;
const detalhes = (r: Resp) => j(r).error.details as Det[];

const CPF = "52998224725"; const CPF2 = "11144477735";
const CNPJ_BB = "00000000000191"; const CNPJ_ALFA = "12ABC34501DE35";

/** CPF válido a partir de 9 dígitos (DOC-1: cada caso com o seu, para o 409 de duplicado não mascarar a regra). */
const cpfDe = (base9: string) => { const d = base9.split("").map(Number); const dv = (k: number) => { let s = 0; for (let i = 0; i < k; i++) s += d[i]! * (k + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; }; d.push(dv(9)); d.push(dv(10)); return d.join(""); };
/** CNPJ válido (numérico ou alfanumérico) a partir das 12 primeiras posições: valor = ASCII − 48, pesos da IN RFB 2.229/2024. */
const cnpjDe = (base12: string) => { const v = (c: string) => c.charCodeAt(0) - 48; const dv = (s: string, p: number[]) => { const r = p.reduce((a, x, i) => a + v(s[i]!) * x, 0) % 11; return r < 2 ? 0 : 11 - r; }; const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return `${base12}${d1}${dv(`${base12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`; };
const fmtCpf = (c: string) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
const fmtCnpj = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("PA-1 — pelo menos um tipo", () => {
  it("sem tipo → 422 com a mensagem declarada, nada gravado; com um tipo → 201", async () => {
    const x = nome("sem tipo");
    const r = await post({ name: x, person_type: "legal" });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.message).toMatch(/pelo menos um tipo/);
    expect(await porNome(x)).toBe(0);
    const id = criado(await post({ name: x, person_type: "legal", is_transporter: true }));
    // desmarcar o último tipo numa edição → 422, nada muda
    const u = await put(id, { is_transporter: false });
    expect(u.statusCode, u.body).toBe(422);
    expect(await um("select is_transporter from erp.people where id=$1", [id])).toEqual({ is_transporter: true });
  });
});

describe("PA-2 — documento", () => {
  it("CPF formatado grava normalizado; CNPJ alfanumérico aceito; DV errado 422; duplicado 409 com código e nome; excluído libera", async () => {
    const a = criado(await post({ name: nome("cpf"), document: "529.982.247-25", person_type: "natural", is_client: true }));
    expect(await um("select document from erp.people where id=$1", [a])).toEqual({ document: CPF });
    const alfa = criado(await post({ name: nome("alfa"), document: "12.abc.345/01de-35", person_type: "legal", is_client: true }));
    expect(await um("select document from erp.people where id=$1", [alfa])).toEqual({ document: CNPJ_ALFA });
    const x = nome("dv");
    const dv = await post({ name: x, document: "529.982.247-24", person_type: "natural", is_client: true });
    expect(dv.statusCode, dv.body).toBe(422); expect(detalhes(dv)[0]!.path).toBe("document"); expect(await porNome(x)).toBe(0);
    const rep = await post({ name: nome("repetido"), document: "11111111111", person_type: "natural", is_client: true });
    expect(rep.statusCode).toBe(422);
    const codigo = (await um<{ code: string; name: string }>("select code, name from erp.people where id=$1", [a]))!;
    const d = await post({ name: nome("dup"), document: CPF, person_type: "natural", is_provider: true });
    expect(d.statusCode, d.body).toBe(409);
    expect(j(d).error.message).toContain(`${codigo.code} - ${codigo.name}`);
    // estrangeiro: livre
    criado(await post({ name: nome("estrangeiro"), document: "AR-20-12345678-9", person_type: "foreign", is_client: true }));
    // excluído não conta
    expect((await h.app.inject({ method: "DELETE", url: `/api/resources/people/${a}`, headers: h.headers() })).statusCode).toBe(200);
    criado(await post({ name: nome("depois de excluir"), document: "529.982.247-25", person_type: "natural", is_client: true }));
  });

  it("o ÍNDICE é a autoridade: gravação direta com o mesmo documento normalizado é recusada pelo banco", async () => {
    const org = h.demo.orgId;
    await admin.query("insert into erp.people (organization_id, code, name, document, is_client) values ($1, 'PA2X1', 'PA idx 1', '44.444.444/0001-00', true)", [org]).catch(() => undefined);
    const e = await admin.query("insert into erp.people (organization_id, code, name, document, is_client) values ($1, 'PA2X2', 'PA idx 2', '44444444000100', true)", [org]).then(() => null, (x: { code?: string; constraint?: string }) => x);
    expect(e?.code).toBe("23505"); expect(e?.constraint).toBe("ux_people_documento_normalizado");
  });
});

describe("PA-3 — gravação atômica", () => {
  it("erro na 2ª linha de endereço → 422 apontando aba e linha; NEM o principal nem a 1ª linha gravados", async () => {
    const x = nome("atomico");
    const r = await post({ name: x, person_type: "legal", is_client: true, enderecos: [{ tipo: "entrega", logradouro: "Rua 1", inscricao_estadual: "123456" }, { tipo: "propriedade", logradouro: "Rua 2", inscricao_estadual: "12AB" }] });
    expect(r.statusCode, r.body).toBe(422);
    expect(detalhes(r)[0]).toMatchObject({ aba: "enderecos", detalhe: "enderecos", linha: 2 });
    expect(await porNome(x)).toBe(0);
    expect(await n("select count(*)::text n from erp.parceiro_enderecos where logradouro = any($1)", [["Rua 1", "Rua 2"]])).toBe(0);
  });
  it("erro de schema na linha também aponta a aba; na edição o principal não muda", async () => {
    const id = criado(await post({ name: nome("atomico put"), person_type: "legal", is_client: true, phone: "1" }));
    const r = await put(id, { phone: "2", contatos: [{ nome: "ok" }, { funcao: "sem nome" }] });
    expect(r.statusCode, r.body).toBe(422);
    expect(detalhes(r)[0]).toMatchObject({ aba: "contatos", linha: 2 });
    expect(await um("select phone from erp.people where id=$1", [id])).toEqual({ phone: "1" });
    expect(await n("select count(*)::text n from erp.parceiro_contatos where person_id=$1", [id])).toBe(0);
  });
});

describe("PA-4 — PUT: ausente não mexe, lista é completa; outra organização", () => {
  let id: string; let e1: string; let e2: string;
  it("cria com duas linhas; PUT sem detalhes mantém; lista sem uma linha a EXCLUI logicamente", async () => {
    id = criado(await post({ name: nome("put"), person_type: "legal", is_client: true, enderecos: [{ tipo: "entrega", logradouro: "A" }, { tipo: "cobranca", logradouro: "B" }], contas: [{ bank_code: "001", agencia: "1", conta: "2" }] }));
    const g = j(await get(`/api/resources/people/${id}`));
    expect(g.enderecos).toHaveLength(2); expect(g.contas).toHaveLength(1);
    [e1, e2] = (g.enderecos as { id: string }[]).map((x) => x.id) as [string, string];
    expect((await put(id, { phone: "3" })).statusCode).toBe(200);
    expect(await n("select count(*)::text n from erp.parceiro_enderecos where person_id=$1 and deleted_at is null", [id])).toBe(2);
    const r = await put(id, { enderecos: [{ id: e1, tipo: "entrega", logradouro: "A2" }] });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).enderecos).toEqual([expect.objectContaining({ id: e1, logradouro: "A2" })]);
    expect(await um("select deleted_at is not null as removida from erp.parceiro_enderecos where id=$1", [e2])).toEqual({ removida: true });
    expect(await n("select count(*)::text n from erp.parceiro_contas where person_id=$1 and deleted_at is null", [id])).toBe(1);
  });
  it("a grade volta NA ORDEM enviada: linhas do mesmo envio não empatam no instante da transação", async () => {
    const ordem = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
    const pid = criado(await post({ name: nome("ordem"), person_type: "legal", is_client: true, enderecos: ordem.map((x) => ({ tipo: "entrega", logradouro: x })) }));
    const g = j(await get(`/api/resources/people/${pid}`));
    expect((g.enderecos as { logradouro: string }[]).map((x) => x.logradouro)).toEqual(ordem);
  });

  it("outra organização não lê nem grava (404) e não sequestra linha pelo id", async () => {
    const adm = createPool(TEST_URL, { max: 1 });
    const b = await seedDemo(adm, { orgName: "[TEST] Org PA", adminEmail: "adminpa@demo.local", adminPassword: "Demo@12345", slug: "orgpa" }, () => {}); await adm.end();
    const tok = j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "adminpa@demo.local", password: "Demo@12345" } })).token as string;
    const hb = { authorization: `Bearer ${tok}`, "x-org-id": b.orgId, "content-type": "application/json" };
    expect((await get(`/api/resources/people/${id}`, hb)).statusCode).toBe(404);
    expect((await put(id, { phone: "9", enderecos: [] }, hb)).statusCode).toBe(404);
    expect(await n("select count(*)::text n from erp.parceiro_enderecos where person_id=$1 and deleted_at is null", [id])).toBe(1);
    const meu = criado(await post({ name: nome("org b"), person_type: "legal", is_client: true }, hb));
    const r = await put(meu, { enderecos: [{ id: e1, tipo: "entrega", logradouro: "roubado" }] }, hb);
    expect(r.statusCode, r.body).toBe(422);
    expect(await um("select logradouro, person_id from erp.parceiro_enderecos where id=$1", [e1])).toEqual({ logradouro: "A2", person_id: id });
  });
});

describe("PA-5 — perfis: marcar, desmarcar, remarcar; proprietário com %", () => {
  it("desmarcar Cliente inativa o perfil sem apagar; remarcar reativa com o limite de antes", async () => {
    const id = criado(await post({ name: nome("perfil"), person_type: "legal", is_client: true, perfil_cliente: { limite_credito: "1500.50" } }));
    expect(await um("select is_active, limite_credito::text l from erp.client_profiles where person_id=$1", [id])).toEqual({ is_active: true, l: "1500.50" });
    expect((await put(id, { is_client: false, is_provider: true })).statusCode).toBe(200);
    expect(await um("select is_active, limite_credito::text l from erp.client_profiles where person_id=$1", [id])).toEqual({ is_active: false, l: "1500.50" });
    expect(await um("select is_active from erp.provider_profiles where person_id=$1", [id])).toEqual({ is_active: true });
    expect((await put(id, { is_client: true })).statusCode).toBe(200);
    expect(await um("select is_active, limite_credito::text l from erp.client_profiles where person_id=$1", [id])).toEqual({ is_active: true, l: "1500.50" });
  });
  it("proprietário com participação por empresa; % fora da faixa → 422 na linha, nada gravado", async () => {
    const empresa = h.demo.empresaIds[0]!;
    const id = criado(await post({ name: nome("proprietario"), person_type: "natural", is_proprietary: true, participacoes: [{ empresa_id: empresa, percentage: "40" }] }));
    expect(await um("select percentage::text p from erp.proprietary_empresas where person_id=$1 and empresa_id=$2", [id, empresa])).toEqual({ p: "40.0000" });
    expect(await um("select is_active from erp.proprietary_profiles where person_id=$1", [id])).toEqual({ is_active: true });
    const r = await put(id, { participacoes: [{ empresa_id: empresa, percentage: "150" }] });
    expect(r.statusCode, r.body).toBe(422);
    expect(detalhes(r)[0]).toMatchObject({ aba: "proprietario", linha: 1 });
    expect(await um("select percentage::text p from erp.proprietary_empresas where person_id=$1", [id])).toEqual({ p: "40.0000" });
  });
});

describe("PA-6 — produtor rural", () => {
  it("UM parceiro por CPF com duas propriedades, cada uma com a sua IE; segundo parceiro com o mesmo CPF → 409", async () => {
    const id = criado(await post({ name: nome("produtor"), document: CPF2, person_type: "natural", is_provider: true, produtor_rural: true, enderecos: [{ tipo: "propriedade", descricao: "Faz. A", inscricao_estadual: "290000001" }, { tipo: "propriedade", descricao: "Faz. B", inscricao_estadual: "ISENTO" }] }));
    expect((await admin.query("select inscricao_estadual from erp.parceiro_enderecos where person_id=$1 order by descricao", [id])).rows).toEqual([{ inscricao_estadual: "290000001" }, { inscricao_estadual: "ISENTO" }]);
    expect((await post({ name: nome("produtor 2"), document: "111.444.777-35", person_type: "natural", is_provider: true, produtor_rural: true })).statusCode).toBe(409);
  });
});

describe("PA-7/PA-8 — consultas (mock) e situação na Receita", () => {
  async function apiComFontes(rotas: Record<string, { status: number; body?: unknown }>): Promise<{ app: FastifyInstance; chamadas: string[] }> {
    const chamadas: string[] = [];
    const buscarExterno: BuscarFn = async (url) => { chamadas.push(url); const r = rotas[new URL(url).host]; if (!r) throw new TypeError("fetch failed"); return { status: r.status, headers: { get: () => null }, json: async () => r.body }; };
    return { app: await buildApp({ config: configDeTeste(), db: h.db, logger: false, buscarExterno }), chamadas };
  }
  it("PA-7 consulta CNPJ (mock) → o parceiro gravado com esse CNPJ recebe a situação e a data da consulta; o cliente não a envia", async () => {
    await admin.query("delete from erp.consulta_cnpj_cache where cnpj=$1", [CNPJ_BB]);
    const f = await apiComFontes({ "brasilapi.com.br": { status: 200, body: { razao_social: "BANCO DO BRASIL SA", descricao_situacao_cadastral: "BAIXADA", codigo_municipio_ibge: 5300108, municipio: "BRASILIA", uf: "DF" } } });
    try {
      const c = await f.app.inject({ method: "GET", url: `/api/consultas/cnpj/${CNPJ_BB}`, headers: h.headers() });
      expect(c.statusCode, c.body).toBe(200);
      expect(f.chamadas).toHaveLength(1);
    } finally { await f.app.close(); }
    const recusa = await post({ name: nome("situacao cliente"), person_type: "legal", is_client: true, situacao_receita: "ATIVA" });
    expect(recusa.statusCode).toBe(422);
    const id = criado(await post({ name: nome("situacao"), document: "00.000.000/0001-91", person_type: "legal", is_client: true }));
    const g = await um<{ situacao_receita: string; tem_data: boolean }>("select situacao_receita, situacao_receita_consultada_em is not null as tem_data from erp.people where id=$1", [id]);
    expect(g).toEqual({ situacao_receita: "BAIXADA", tem_data: true });
  });
  it("PA-8 consulta CEP (mock) devolve o município IBGE que a ficha grava", async () => {
    await admin.query("delete from erp.consulta_cep_cache where cep='77405070'");
    const f = await apiComFontes({ "viacep.com.br": { status: 200, body: { cep: "77405-070", logradouro: "Rua X", complemento: "", bairro: "Centro", localidade: "Gurupi", uf: "TO", ibge: "1709500" } } });
    try {
      const c = await f.app.inject({ method: "GET", url: "/api/consultas/cep/77405070", headers: h.headers() });
      expect(c.statusCode, c.body).toBe(200);
      const cep = j(c) as { logradouro: string; bairro: string; municipio: { codigoIbge: number } };
      const id = criado(await post({ name: nome("cep"), person_type: "legal", is_client: true, zip_code: "77405070", address: cep.logradouro, district: cep.bairro, city_id: cep.municipio.codigoIbge, complemento: "Sala 2" }));
      expect(await um("select city_id, complemento from erp.people where id=$1", [id])).toEqual({ city_id: 1709500, complemento: "Sala 2" });
    } finally { await f.app.close(); }
  });
});

describe("PA-9 — cadastro rápido (dentro da venda)", () => {
  it("só os campos rápidos com o tipo pré-marcado grava pela MESMA API e aparece no seletor de clientes", async () => {
    const x = nome("rapido");
    criado(await post({ is_client: true, person_type: "natural", document: "390.533.447-05", name: x, city_id: 1709500, phone: "63 3333-0000", email: "rapido@exemplo.com" }));
    const op = j(await get(`/api/resources/people/options?is_client=true&search=${encodeURIComponent(x)}`)) as { label: string }[];
    expect(op.map((o) => o.label)).toEqual([x]);
  });
});

describe("PA-10 — contrato da definição (navegação e ficha)", () => {
  it("a definição publicada tem abas, detalhes, perfis, cabeçalho e campos rápidos; rótulo Parceiro", async () => {
    const d = j(await get("/api/resources/people/definition"));
    expect(d.label).toBe("Parceiro");
    expect((d.abas as { key: string }[]).map((a) => a.key)).toEqual(["identificacao", "enderecos", "contatos", "fiscal", "financeiro", "cliente", "fornecedor", "proprietario", "funcionario", "anexos"]);
    expect((d.detalhes as { key: string }[]).map((x) => x.key)).toEqual(["enderecos", "contatos", "contas", "filiais", "vendedores", "participacoes"]);
    expect(d.cabecalho).toContain("document");
  });
});

describe("DOC-1 — tipo de pessoa × documento (R1-6, decisão 253)", () => {
  const recusa = (r: Resp, campo: string, msg: string | RegExp, aba = "identificacao") => {
    expect(r.statusCode, r.body).toBe(422);
    const d = detalhes(r);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ path: campo, aba });
    if (typeof msg === "string") expect(d[0]!.message).toBe(msg); else expect(d[0]!.message).toMatch(msg);
  };
  const linha = (id: string) => um<{ person_type: string; document: string | null; phone: string | null }>("select person_type, document, phone from erp.people where id=$1", [id]);

  it("física com CNPJ (numérico e alfanumérico) → 422 'Pessoa física usa CPF' no campo do documento; nada gravado", async () => {
    for (const doc of [fmtCnpj(cnpjDe("701000000001")), fmtCnpj(cnpjDe("70ABC0000001"))]) {
      const x = nome("fisica cnpj");
      recusa(await post({ name: x, person_type: "natural", document: doc, is_client: true }), "document", "Pessoa física usa CPF");
      expect(await porNome(x), doc).toBe(0);
    }
  });

  it("jurídica com CPF (inclusive o formatado de 14 caracteres) → 422 'Pessoa jurídica usa CNPJ'; sem tipo vale Jurídica e diz isso", async () => {
    const cpf = cpfDe("701000001");
    for (const doc of [cpf, fmtCpf(cpf)]) {
      const x = nome("juridica cpf");
      recusa(await post({ name: x, person_type: "legal", document: doc, is_client: true }), "document", "Pessoa jurídica usa CNPJ");
      expect(await porNome(x), doc).toBe(0);
    }
    const x = nome("sem tipo cpf");
    recusa(await post({ name: x, document: fmtCpf(cpf), is_client: true }), "document", "Pessoa jurídica usa CNPJ (tipo de pessoa não informado vale Jurídica)");
    expect(await porNome(x)).toBe(0);
  });

  it("estrangeira é livre: CPF, CNPJ e texto livre gravam (só aparados)", async () => {
    const casos = [fmtCpf(cpfDe("701000002")), cnpjDe("701000000002"), "  PASSAPORTE X-1234  "];
    for (const doc of casos) {
      const id = criado(await post({ name: nome("estrangeira"), person_type: "foreign", document: doc, is_client: true }));
      expect(await linha(id)).toMatchObject({ person_type: "foreign", document: doc.trim() });
    }
  });

  it("casos válidos gravam normalizados: física com CPF, jurídica com CNPJ numérico e alfanumérico; sem tipo com CNPJ grava Jurídica (o padrão da coluna)", async () => {
    const cpf = cpfDe("701000003"); const cnpj = cnpjDe("701000000003"); const alfa = cnpjDe("70ABC0000003");
    const a = criado(await post({ name: nome("fisica ok"), person_type: "natural", document: fmtCpf(cpf), is_client: true }));
    expect(await linha(a)).toMatchObject({ person_type: "natural", document: cpf });
    const b = criado(await post({ name: nome("juridica ok"), person_type: "legal", document: fmtCnpj(cnpj), is_client: true }));
    expect(await linha(b)).toMatchObject({ person_type: "legal", document: cnpj });
    const c = criado(await post({ name: nome("juridica alfa"), person_type: "legal", document: fmtCnpj(alfa).toLowerCase(), is_client: true }));
    expect(await linha(c)).toMatchObject({ person_type: "legal", document: alfa });
    const d = criado(await post({ name: nome("sem tipo cnpj"), document: cnpjDe("701000000004"), is_client: true }));
    expect(await linha(d)).toMatchObject({ person_type: "legal", document: cnpjDe("701000000004") });
  });

  it("edição combina com o GRAVADO: só o tipo contra o documento gravado → 422 no tipo; só o documento contra o tipo gravado → 422 no documento; os dois coerentes gravam", async () => {
    const cnpj = cnpjDe("701000000005"); const cpf = cpfDe("701000005");
    const pj = criado(await post({ name: nome("pj"), person_type: "legal", document: cnpj, is_client: true }));
    recusa(await put(pj, { person_type: "natural" }), "person_type", "Pessoa física usa CPF");
    expect(await linha(pj)).toMatchObject({ person_type: "legal", document: cnpj });

    const pf = criado(await post({ name: nome("pf"), person_type: "natural", document: cpf, is_client: true }));
    recusa(await put(pf, { document: cnpjDe("701000000006") }), "document", "Pessoa física usa CPF");
    expect(await linha(pf)).toMatchObject({ person_type: "natural", document: cpf });

    const ok = await put(pf, { person_type: "legal", document: fmtCnpj(cnpjDe("701000000006")) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await linha(pf)).toMatchObject({ person_type: "legal", document: cnpjDe("701000000006") });
  });

  it("dado antigo (o caso de produção): Jurídica com CPF formatado gravado antes da regra — PUT sem documento e sem tipo passa; a gravação da ficha (que manda os dois) é recusada; trocar para Física corrige", async () => {
    const cpf = cpfDe("701000007"); const formatado = fmtCpf(cpf);
    expect(formatado).toHaveLength(14);
    const id = (await um<{ id: string }>(
      "insert into erp.people (organization_id, code, name, person_type, document, is_client) values ($1, 'DOC1-LEG', 'DOC1 legado', 'legal', $2, true) returning id::text id", [h.demo.orgId, formatado]))!.id;

    const tel = await put(id, { phone: "63 3333-1111" });
    expect(tel.statusCode, tel.body).toBe(200);
    expect(await linha(id), "nada do documento nem do tipo mudou").toEqual({ person_type: "legal", document: formatado, phone: "63 3333-1111" });

    // o que a ficha da web manda em TODA gravação: todos os campos do principal, inclusive documento e tipo
    recusa(await put(id, { phone: "63 3333-2222", document: formatado, person_type: "legal" }), "document", "Pessoa jurídica usa CNPJ");
    expect(await linha(id), "recusa: nada gravado").toEqual({ person_type: "legal", document: formatado, phone: "63 3333-1111" });

    const corrige = await put(id, { person_type: "natural" });
    expect(corrige.statusCode, corrige.body).toBe(200);
    expect(await linha(id)).toEqual({ person_type: "natural", document: cpf, phone: "63 3333-1111" });
  });

  // Na ficha de RH o documento fica na aba PESSOAL e a definição não tem o tipo de pessoa: a recusa aponta a aba que
  // EXISTE nela e diz onde o tipo se acerta (a aba Pessoal tem o link "Abrir no cadastro de parceiros").
  const MSG_RH_JURIDICA = "Pessoa jurídica usa CNPJ — o parceiro está como Jurídica; acerte o tipo de pessoa no cadastro de parceiros";
  const putRh = (id: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `/api/resources/funcionarios/${id}`, headers: hdr(), payload });

  it("ficha de RH (a definição não tem o tipo): o CPF é conferido contra o tipo GRAVADO, não contra o padrão", async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/hr/funcionarios/por-cpf", headers: hdr(), payload: { document: cpfDe("701000008"), name: nome("rh fisica") } });
    expect(r.statusCode, r.body).toBe(201);
    const pf = j(r).id as string;
    const troca = await putRh(pf, { document: fmtCpf(cpfDe("701000009")) });
    expect(troca.statusCode, troca.body).toBe(200);
    expect(await linha(pf)).toMatchObject({ person_type: "natural", document: cpfDe("701000009") });

    const pj = criado(await post({ name: nome("rh juridica"), person_type: "legal", document: cnpjDe("701000000010"), is_employee: true }));
    const recusada = await putRh(pj, { document: cpfDe("701000010") });
    recusa(recusada, "document", MSG_RH_JURIDICA, "pessoal");
    expect(await linha(pj)).toMatchObject({ person_type: "legal", document: cnpjDe("701000000010") });
  });

  it("ficha de RH de funcionário LEGADO (Jurídica com CPF): gravar uma aba de RH com os campos do principal → 422 na aba Pessoal dizendo onde se acerta; sem o documento as abas de RH gravam; acertado o tipo no parceiro, grava", async () => {
    const cpf = cpfDe("701000011"); const formatado = fmtCpf(cpf);
    const id = (await um<{ id: string }>(
      "insert into erp.people (organization_id, code, name, person_type, document, is_employee) values ($1, 'DOC1-RH', 'DOC1 RH legado', 'legal', $2, true) returning id::text id", [h.demo.orgId, formatado]))!.id;
    await admin.query("insert into erp.employee_profiles (person_id, organization_id) values ($1, $2)", [id, h.demo.orgId]);
    const abas = (j(await get("/api/resources/funcionarios/definition")).abas as { key: string }[]).map((a) => a.key);
    expect(abas).toContain("pessoal"); expect(abas).not.toContain("identificacao");
    const rg = () => um<{ rg_numero: string | null }>("select rg_numero from erp.employee_profiles where person_id=$1", [id]);

    // o que a tela manda para quem tem people.edit: os campos do principal (inclusive o documento) + a aba de RH editada
    recusa(await putRh(id, { name: "DOC1 RH legado", document: formatado, rh_documentos: { rg_numero: "RG-1" } }), "document", MSG_RH_JURIDICA, "pessoal");
    expect(await rg(), "recusa: nada gravado").toEqual({ rg_numero: null });
    expect(await linha(id)).toMatchObject({ person_type: "legal", document: formatado });

    // sem o documento no corpo (quem não edita parceiros não o manda): a aba de RH grava; o dado antigo não trava o RH
    const semDoc = await putRh(id, { rh_documentos: { rg_numero: "RG-2" } });
    expect(semDoc.statusCode, semDoc.body).toBe(200);
    expect(await rg()).toEqual({ rg_numero: "RG-2" });

    // o acerto que a mensagem pede: o tipo no cadastro de parceiros; depois a ficha de RH grava com o documento
    const acerto = await put(id, { person_type: "natural" });
    expect(acerto.statusCode, acerto.body).toBe(200);
    const ok = await putRh(id, { name: "DOC1 RH legado", document: formatado, rh_documentos: { rg_numero: "RG-3" } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await linha(id)).toMatchObject({ person_type: "natural", document: cpf });
    expect(await rg()).toEqual({ rg_numero: "RG-3" });
  });

  it("documento que fica vazio depois de normalizar não é duplicado (mesmo filtro do índice): dois estrangeiros só de pontuação gravam", async () => {
    const a = criado(await post({ name: nome("pontuacao 1"), person_type: "foreign", document: "-", is_client: true }));
    const b = criado(await post({ name: nome("pontuacao 2"), person_type: "foreign", document: "--", is_client: true }));
    expect([(await linha(a))!.document, (await linha(b))!.document]).toEqual(["-", "--"]);
  });
});

/**
 * R1-4 — PERMISSÕES POR TIPO DE PARCEIRO. Cada caso monta o membro com as permissões EXATAS (e o escopo de empresa
 * pedido) e confere o BANCO pelo papel administrativo, que não passa pela RLS.
 */
async function membro(email: string, perms: string[], escopos: { modulo: string; modo: "todas" | "selecionadas"; empresas?: string[] }[] = []) {
  const hash = (await um<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'"))!.password_hash;
  const papel = (await um<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [h.demo.orgId, `[TEST] ${email}`]))!.id;
  for (const p of perms) await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2)", [papel, p]);
  const u = (await um<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash]))!.id;
  const m = (await um<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true) returning id", [h.demo.orgId, u, papel]))!.id;
  for (const e of escopos) {
    await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,$3,$4)", [h.demo.orgId, m, e.modulo, e.modo]);
    for (const emp of e.empresas ?? []) await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,$3,'selecionadas',$4)", [h.demo.orgId, m, e.modulo, emp]);
  }
  const tok = j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo@12345" } })).token as string;
  return { authorization: `Bearer ${tok}`, "x-org-id": h.demo.orgId, "content-type": "application/json" };
}

/** Retrato, pelo papel administrativo, de TUDO o que as abas de tipo gravam para o parceiro. */
const retratoDosTipos = async (id: string) => ({
  cliente: await um("select is_active, limite_credito::text l from erp.client_profiles where person_id=$1", [id]),
  fornecedor: await um("select is_active, provider_type, hour_value::text hv from erp.provider_profiles where person_id=$1", [id]),
  filiais: (await admin.query("select name from erp.provider_branches where person_id=$1 order by name", [id])).rows,
  vendedores: (await admin.query("select name from erp.provider_sellers where person_id=$1 order by name", [id])).rows,
  proprietario: await um("select is_active from erp.proprietary_profiles where person_id=$1", [id]),
  participacoes: (await admin.query("select empresa_id::text e, percentage::text p, registration_number r from erp.proprietary_empresas where person_id=$1 order by percentage", [id])).rows
});

describe("PT-1 — aba de tipo: LER exige <tipo>.view, GRAVAR exige <tipo>.edit; marcar o tipo continua do parceiro (R1-4)", () => {
  let X = ""; let A = "";
  let semTipos: Record<string, string>; let leitores: Record<string, string>; let editores: Record<string, string>; let soEdicao: Record<string, string>;
  const PARCEIRO = ["people.view", "people.create", "people.edit"];
  const TIPOS = [
    { perm: "clients", chaves: ["perfil_cliente"], corpos: [{ perfil_cliente: { limite_credito: "1" } }] },
    { perm: "providers", chaves: ["perfil_fornecedor", "filiais", "vendedores"], corpos: [{ perfil_fornecedor: { hour_value: "1" } }, { filiais: [] }, { vendedores: [{ name: "PT1 intruso" }] }] },
    { perm: "proprietaries", chaves: ["perfil_proprietario", "participacoes"], corpos: [{ perfil_proprietario: {} }, { participacoes: [] }] }
  ] as const;

  beforeAll(async () => {
    A = h.demo.empresaIds[0]!;
    X = criado(await post({
      name: nome("PT1 todos os tipos"), person_type: "legal", is_client: true, is_provider: true, is_proprietary: true,
      perfil_cliente: { limite_credito: "1000" }, perfil_fornecedor: { provider_type: "provider", hour_value: "25" },
      filiais: [{ name: "PT1 filial" }], vendedores: [{ name: "PT1 vendedor" }], participacoes: [{ empresa_id: A, percentage: "40", registration_number: "PT1-A" }]
    }));
    // escopo `todas` em um módulo: a participação (grade com empresa) fica visível para quem pode ler a aba
    const todas = [{ modulo: "financeiro", modo: "todas" as const }];
    semTipos = await membro("pt1-sem-tipos@demo.local", PARCEIRO, todas);
    leitores = await membro("pt1-leitores@demo.local", [...PARCEIRO, "clients.view", "providers.view", "proprietaries.view"], todas);
    editores = await membro("pt1-editores@demo.local", [...PARCEIRO, "clients.view", "providers.view", "proprietaries.view", "clients.edit", "providers.edit", "proprietaries.edit"], todas);
    soEdicao = await membro("pt1-so-edicao@demo.local", [...PARCEIRO, "clients.edit", "providers.edit", "proprietaries.edit"], todas);
  });

  for (const t of TIPOS) {
    it(`${t.perm}: sem ${t.perm}.view a aba não vem na leitura (nem a chave, nem os dados); com ela vem`, async () => {
      const sem = await get(`/api/resources/people/${X}`, semTipos);
      expect(sem.statusCode, sem.body).toBe(200);
      const corpo = j(sem) as Record<string, unknown>;
      for (const k of t.chaves) expect(corpo, `${k} não pode sair sem ${t.perm}.view`).not.toHaveProperty(k);
      expect(corpo, "as abas do parceiro continuam").toHaveProperty("enderecos");
      expect(corpo, "o tipo marcado é do principal e continua visível").toMatchObject({ is_client: true, is_provider: true, is_proprietary: true });

      const com = j(await get(`/api/resources/people/${X}`, leitores)) as Record<string, unknown>;
      for (const k of t.chaves) expect(com, `${k} sai com ${t.perm}.view`).toHaveProperty(k);
    });

    it(`${t.perm}: sem ${t.perm}.edit gravar a aba = 403 (inclusive com só ${t.perm}.view e na criação); com .edit sem .view também; nada gravado`, async () => {
      for (const c of t.corpos) {
        const antes = await retratoDosTipos(X);
        for (const [quem, hs] of [["sem tipos", semTipos], ["só leitura", leitores]] as const) {
          const r = await put(X, { phone: "63 0000-0001", ...c }, hs);
          expect(r.statusCode, `${quem} ${JSON.stringify(c)}: ${r.body}`).toBe(403);
          expect(j(r).error.message).toBe(`Sem permissão: ${t.perm}.edit`);
        }
        // com <tipo>.edit e SEM <tipo>.view também não: a lista completa gravada às cegas apagaria o que ele não vê
        const cego = await put(X, { phone: "63 0000-0001", ...c }, soEdicao);
        expect(cego.statusCode, `só edição ${JSON.stringify(c)}: ${cego.body}`).toBe(403);
        expect(j(cego).error.message).toBe(`Sem permissão: ${t.perm}.view`);
        expect(await retratoDosTipos(X), `nada das abas mudou (${JSON.stringify(c)})`).toEqual(antes);
        expect((await um<{ phone: string | null }>("select phone from erp.people where id=$1", [X]))!.phone, "o corpo inteiro é recusado").not.toBe("63 0000-0001");

        const x = nome(`PT1 novo ${t.perm}`);
        const novo = await post({ name: x, person_type: "legal", is_client: true, is_provider: true, is_proprietary: true, ...c }, semTipos);
        expect(novo.statusCode, novo.body).toBe(403);
        expect(await porNome(x), "a criação também não grava").toBe(0);
      }
    });
  }

  it("com <tipo>.edit grava; marcar/desmarcar o tipo continua com people.edit (perfil inativado, não apagado)", async () => {
    const c = await put(X, { perfil_cliente: { limite_credito: "1500" } }, editores);
    expect(c.statusCode, c.body).toBe(200);
    const f = await put(X, { perfil_fornecedor: { hour_value: "30" }, vendedores: [{ name: "PT1 vendedor" }, { name: "PT1 segundo" }] }, editores);
    expect(f.statusCode, f.body).toBe(200);
    const p = await put(X, { participacoes: [{ empresa_id: A, percentage: "41", registration_number: "PT1-A" }] }, editores);
    expect(p.statusCode, p.body).toBe(200);
    expect(await retratoDosTipos(X)).toMatchObject({
      cliente: { is_active: true, l: "1500.00" }, fornecedor: { hv: "30.00" }, vendedores: [{ name: "PT1 segundo" }, { name: "PT1 vendedor" }],
      participacoes: [{ e: A, p: "41.0000", r: "PT1-A" }]
    });

    // desmarcar e remarcar o tipo é do parceiro: quem não tem clients.* consegue, e o perfil só é inativado
    const des = await put(X, { is_client: false }, semTipos);
    expect(des.statusCode, des.body).toBe(200);
    expect((await retratoDosTipos(X)).cliente).toEqual({ is_active: false, l: "1500.00" });
    const re = await put(X, { is_client: true }, semTipos);
    expect(re.statusCode, re.body).toBe(200);
    expect((await retratoDosTipos(X)).cliente).toEqual({ is_active: true, l: "1500.00" });
  });

  it("histórico: grade de aba sem a permissão de leitura não aparece", async () => {
    // `provider_sellers` não tem gatilho de auditoria hoje: a linha de auditoria é plantada (como um gatilho futuro a gravaria)
    const vendedor = (await um<{ id: string }>("select id::text id from erp.provider_sellers where person_id=$1 limit 1", [X]))!.id;
    await admin.query("insert into erp.audit_logs(organization_id,entity,entity_id,action,before,after) values ($1,'provider_sellers',$2,'update',$3,$4)", [h.demo.orgId, vendedor, { name: "PT1 antes" }, { name: "PT1 depois" }]);
    const campos = (r: Resp) => (j(r).items as { onde: string }[]).map((x) => x.onde);
    expect(campos(await get(`/api/resources/people/${X}/historico`, leitores))).toEqual(expect.arrayContaining(["Vendedores do fornecedor"]));
    expect(campos(await get(`/api/resources/people/${X}/historico`, semTipos))).not.toEqual(expect.arrayContaining(["Vendedores do fornecedor"]));
  });
});

describe("PT-2 — participação do proprietário: a empresa fora do escopo não aparece, não é alterada e não é apagada (R1-4)", () => {
  let P = ""; let A = ""; let B = "";
  let escopoA: Record<string, string>; let escopoASemEdit: Record<string, string>; let semEscopo: Record<string, string>;
  const linhas = async () => (await admin.query<{ e: string; p: string; r: string | null }>("select empresa_id::text e, percentage::text p, registration_number r from erp.proprietary_empresas where person_id=$1 order by empresa_id = $2 desc", [P, A])).rows;
  const PERMS = ["people.view", "people.edit", "proprietaries.view"];

  beforeAll(async () => {
    A = h.demo.empresaIds[0]!; B = h.demo.empresaIds[1]!;
    expect(A).not.toBe(B);
    P = criado(await post({ name: nome("PT2 proprietario"), person_type: "natural", is_proprietary: true, participacoes: [{ empresa_id: A, percentage: "40", registration_number: "A-1" }, { empresa_id: B, percentage: "60", registration_number: "B-1" }] }));
    const soA = [{ modulo: "financeiro", modo: "selecionadas" as const, empresas: [A] }];
    escopoA = await membro("pt2-escopo-a@demo.local", [...PERMS, "proprietaries.edit"], soA);
    escopoASemEdit = await membro("pt2-escopo-a-sem-edit@demo.local", PERMS, soA);
    semEscopo = await membro("pt2-sem-escopo@demo.local", [...PERMS, "proprietaries.edit"]);
  });

  it("escopo de 1 empresa: vê só a sua; alterar a sua não toca a outra; lista sem a sua apaga só a sua; mandar a outra → 422", async () => {
    expect(await linhas(), "o dono gravou as duas").toEqual([{ e: A, p: "40.0000", r: "A-1" }, { e: B, p: "60.0000", r: "B-1" }]);
    expect((j(await get(`/api/resources/people/${P}`)).participacoes as { empresa_id: string }[]).map((x) => x.empresa_id).sort(), "o dono vê as duas").toEqual([A, B].sort());

    // NÃO VÊ
    const lida = await get(`/api/resources/people/${P}`, escopoA);
    expect(lida.statusCode, lida.body).toBe(200);
    expect(j(lida).participacoes).toEqual([{ empresa_id: A, percentage: "40.0000", registration_number: "A-1" }]);

    // NÃO ALTERA e NÃO APAGA: a lista completa enviada é a do que ele vê
    const muda = await put(P, { participacoes: [{ empresa_id: A, percentage: "45", registration_number: "A-2" }] }, escopoA);
    expect(muda.statusCode, muda.body).toBe(200);
    expect(j(muda).participacoes, "a resposta também não mostra a outra").toEqual([{ empresa_id: A, percentage: "45.0000", registration_number: "A-2" }]);
    expect(await linhas()).toEqual([{ e: A, p: "45.0000", r: "A-2" }, { e: B, p: "60.0000", r: "B-1" }]);

    const vazia = await put(P, { participacoes: [] }, escopoA);
    expect(vazia.statusCode, vazia.body).toBe(200);
    expect(await linhas(), "só a da empresa do escopo saiu").toEqual([{ e: B, p: "60.0000", r: "B-1" }]);

    const outra = await put(P, { participacoes: [{ empresa_id: B, percentage: "10" }] }, escopoA);
    expect(outra.statusCode, outra.body).toBe(422);
    expect(detalhes(outra)[0]).toMatchObject({ aba: "proprietario", detalhe: "participacoes", linha: 1 });
    expect(await linhas(), "recusa: nada gravado").toEqual([{ e: B, p: "60.0000", r: "B-1" }]);

    // devolve a da empresa A para o próximo caso
    expect((await put(P, { participacoes: [{ empresa_id: A, percentage: "40", registration_number: "A-1" }] }, escopoA)).statusCode).toBe(200);
    expect(await linhas()).toEqual([{ e: A, p: "40.0000", r: "A-1" }, { e: B, p: "60.0000", r: "B-1" }]);
  });

  it("sem proprietaries.edit (mesmo escopo, com people.edit) → 403 e nada muda; o principal continua gravando", async () => {
    for (const c of [{ participacoes: [{ empresa_id: A, percentage: "50" }] }, { participacoes: [] }]) {
      const r = await put(P, c, escopoASemEdit);
      expect(r.statusCode, r.body).toBe(403);
      expect(j(r).error.message).toBe("Sem permissão: proprietaries.edit");
      expect(await linhas(), JSON.stringify(c)).toEqual([{ e: A, p: "40.0000", r: "A-1" }, { e: B, p: "60.0000", r: "B-1" }]);
    }
    const tel = await put(P, { phone: "63 0000-0002" }, escopoASemEdit);
    expect(tel.statusCode, tel.body).toBe(200);
    expect(await linhas()).toEqual([{ e: A, p: "40.0000", r: "A-1" }, { e: B, p: "60.0000", r: "B-1" }]);
  });

  it("sem escopo de empresa nenhum (fail-closed): não vê nenhuma e a lista vazia não apaga nada", async () => {
    const lida = await get(`/api/resources/people/${P}`, semEscopo);
    expect(lida.statusCode, lida.body).toBe(200);
    expect(j(lida).participacoes).toEqual([]);
    const r = await put(P, { participacoes: [] }, semEscopo);
    expect(r.statusCode, r.body).toBe(200);
    expect(await linhas()).toEqual([{ e: A, p: "40.0000", r: "A-1" }, { e: B, p: "60.0000", r: "B-1" }]);
    const a = await put(P, { participacoes: [{ empresa_id: A, percentage: "1" }] }, semEscopo);
    expect(a.statusCode, a.body).toBe(422);
    expect(await linhas()).toEqual([{ e: A, p: "40.0000", r: "A-1" }, { e: B, p: "60.0000", r: "B-1" }]);
  });
});
