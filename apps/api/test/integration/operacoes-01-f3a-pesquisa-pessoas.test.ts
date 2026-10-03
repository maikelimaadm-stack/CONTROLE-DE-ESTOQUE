import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * OPERACOES-01 F3a (decisão 280) — PESQUISA DE PESSOAS NO SELETOR e PÁGINA DO SELETOR NO SERVIDOR.
 * `GET /api/resources/:key/options`: o seletor de Parceiros (`pesquisaDoSeletor` em `people`) acha por nome, razão
 * social/nome completo e CPF/CNPJ NORMALIZADO (o CNPJ alfanumérico mantém as letras), por prefixo; `page`/`pageSize`
 * canônicos (padrão 1 × 200, a página de hoje), 422 para o resto; a resposta continua o array `{ code, id, label }`.
 * A razão social e o PREFIXO do documento exigem `people.view` (a leitura da listagem); sem ela, só o nome e o documento
 * completo (PP-11). Casos PP-1..PP-11. Cada caso afirma a PREMISSA (lida do banco ou da listagem) junto com a conclusão.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
type Opcao = { id: string; label: string; code: string | null };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = (extra: Record<string, string> = {}) => h.headers({ "content-type": "application/json", ...extra });
const get = (url: string, headers: Record<string, string> = h.headers()) => h.app.inject({ method: "GET", url, headers });
const criar = async (recurso: string, payload: Record<string, unknown>, headers: Record<string, string> = hdr()) => {
  const r = await h.app.inject({ method: "POST", url: `/api/resources/${recurso}`, headers, payload });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
};
/** Opções do seletor (só 200 passa daqui). */
const opcoes = async (recurso: string, query: string, headers: Record<string, string> = h.headers()) => {
  const r = await get(`/api/resources/${recurso}/options?${query}`, headers);
  expect(r.statusCode, r.body).toBe(200);
  const corpo = j(r) as Opcao[];
  expect(Array.isArray(corpo), "a resposta continua um ARRAY").toBe(true);
  return corpo;
};
const busca = (texto: string) => `search=${encodeURIComponent(texto)}`;
const idsDe = (xs: Opcao[]) => xs.map((x) => x.id);
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
/** Membro da organização demo com as permissões EXATAS dadas (molde de cadastros-rh-sigilo). */
const membro = async (email: string, perms: string[]): Promise<Record<string, string>> => {
  const hash = (await um<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'"))!.password_hash;
  const papel = (await um<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [h.demo.orgId, `[TEST] ${email}`]))!.id;
  for (const p of perms) await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2)", [papel, p]);
  const u = (await um<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash]))!.id;
  await admin.query("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true)", [h.demo.orgId, u, papel]);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j(login).token as string}`, "x-org-id": h.demo.orgId };
};

const sorteio = (alfabeto: string, n: number) => Array.from({ length: n }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]!).join("");
const LETRAS = "abcdefghijklmnopqrstuvwxyz"; const DIGITOS = "0123456789";
/** Sufixo SÓ de letras: nome nenhum desta suíte vira pesquisa de documento por acaso. */
const S = sorteio(LETRAS, 7);

/** CPF válido a partir de 9 dígitos (molde de cadastros-parceiros). */
const cpfDe = (base9: string) => { const d = base9.split("").map(Number); const dv = (k: number) => { let s = 0; for (let i = 0; i < k; i++) s += d[i]! * (k + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; }; d.push(dv(9)); d.push(dv(10)); return d.join(""); };
/** CNPJ válido (numérico ou alfanumérico) a partir das 12 primeiras posições: valor = ASCII − 48, pesos da IN RFB 2.229/2024. */
const cnpjDe = (base12: string) => { const v = (c: string) => c.charCodeAt(0) - 48; const dv = (s: string, p: number[]) => { const r = p.reduce((a, x, i) => a + v(s[i]!) * x, 0) % 11; return r < 2 ? 0 : 11 - r; }; const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return `${base12}${d1}${dv(`${base12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`; };
const fmtCpf = (c: string) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
const fmtCnpj = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

// documentos novos a cada execução: um 409 de duplicado nunca mascara o que se mede
/** Matriz ("0001") com raiz que começa por 7: o fim do CNPJ nunca é o começo dele (PP-3). */
const CNPJ1 = cnpjDe(`7${sorteio(DIGITOS, 7)}0001`);
const CNPJ_ALFA = cnpjDe(`12AB${sorteio(DIGITOS + LETRAS.toUpperCase(), 8)}`);
const CPF1 = cpfDe(`7${sorteio(DIGITOS, 8)}`);
const PJ1 = { person_type: "legal", name: `PP Fantasia ${S}`, legal_name: `Razão Alfa PP ${S} Ltda`, document: fmtCnpj(CNPJ1), is_client: true };
const PJ2 = { person_type: "legal", name: `PP Outra ${S}`, legal_name: `Outra Empresa ${S}`, document: fmtCnpj(CNPJ_ALFA), is_client: true };
const PF1 = { person_type: "natural", name: `PP Pessoa ${S}`, legal_name: `Nome Completo PP ${S}`, document: fmtCpf(CPF1), is_client: true };
let pj1: string; let pj2: string; let pf1: string;

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 });
  pj1 = await criar("people", PJ1); pj2 = await criar("people", PJ2); pf1 = await criar("people", PF1);
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("PP-1 — nome (o rótulo, como sempre)", () => {
  it("o nome fantasia acha só o parceiro", async () => {
    expect(await um("select name from erp.people where id=$1", [pj1])).toEqual({ name: PJ1.name });
    expect(idsDe(await opcoes("people", busca(PJ1.name)))).toEqual([pj1]);
  });
});

describe("PP-2 — razão social / nome completo", () => {
  it("acha pela razão social em minúsculas; o `%` digitado é literal no ramo novo", async () => {
    // premissa: o nome NÃO contém a razão — quem acha é a coluna nova
    const linha = (await um<{ name: string; legal_name: string; curinga: boolean }>("select name, legal_name, legal_name ilike '%Razão%Alfa%' as curinga from erp.people where id=$1", [pj1]))!;
    expect(linha.name.toLowerCase()).not.toContain("razão alfa");
    expect(linha.legal_name).toBe(PJ1.legal_name);
    const r = await opcoes("people", busca(`razão alfa pp ${S}`));
    expect(idsDe(r)).toEqual([pj1]);
    // premissa do `%`: como CURINGA ele casaria a razão de PJ1; como texto literal, não casa nada
    expect(linha.curinga).toBe(true);
    expect(idsDe(await opcoes("people", busca("Razão%Alfa")))).not.toContain(pj1);
    // e a razão social de quem NÃO é o PJ1 continua achando o dono dela (o OR não troca uma linha por outra)
    expect(idsDe(await opcoes("people", busca(PF1.legal_name)))).toEqual([pf1]);
  });
});

describe("PP-3 — CNPJ numérico, com máscara e pela raiz", () => {
  it("o CNPJ formatado acha o parceiro; a raiz formatada também", async () => {
    const linha = (await um<{ document: string; name: string; legal_name: string }>("select document, name, legal_name from erp.people where id=$1", [pj1]))!;
    // premissa: gravado normalizado (14 dígitos, sem máscara) e nenhum texto do parceiro tem os dígitos
    expect(linha.document).toBe(CNPJ1); expect(linha.document).toMatch(/^\d{14}$/);
    expect(linha.name).not.toContain(CNPJ1.slice(0, 8)); expect(linha.legal_name).not.toContain(CNPJ1.slice(0, 8));
    expect(idsDe(await opcoes("people", busca(fmtCnpj(CNPJ1))))).toEqual([pj1]);
    const raiz = `${CNPJ1.slice(0, 2)}.${CNPJ1.slice(2, 5)}.${CNPJ1.slice(5, 8)}`;
    expect(idsDe(await opcoes("people", busca(raiz)))).toContain(pj1);
    // o documento é por PREFIXO: o fim do CNPJ (filial + dígitos) está DENTRO do documento, mas não é o começo dele
    const fim = CNPJ1.slice(8);
    expect(CNPJ1).toContain(fim); expect(CNPJ1.startsWith(fim)).toBe(false);
    expect(idsDe(await opcoes("people", busca(fim)))).not.toContain(pj1);
  });
});

describe("PP-4 — CNPJ alfanumérico mantém as letras", () => {
  it("formatado em minúsculas acha; só os dígitos dele não acham", async () => {
    expect(await um("select document from erp.people where id=$1", [pj2])).toEqual({ document: CNPJ_ALFA });
    expect(idsDe(await opcoes("people", busca(fmtCnpj(CNPJ_ALFA).toLowerCase())))).toEqual([pj2]);
    const digitos = CNPJ_ALFA.replace(/\D/g, "");
    // premissa: os dígitos sozinhos são pesquisa de documento (≥ 3, com dígito) e NÃO são prefixo do documento com letras
    expect(digitos.length).toBeGreaterThanOrEqual(3);
    expect(CNPJ_ALFA.startsWith(digitos)).toBe(false);
    expect(idsDe(await opcoes("people", busca(digitos)))).not.toContain(pj2);
  });
});

describe("PP-5 — CPF", () => {
  it("o CPF formatado acha a pessoa física", async () => {
    expect(await um("select document, person_type from erp.people where id=$1", [pf1])).toEqual({ document: CPF1, person_type: "natural" });
    expect(idsDe(await opcoes("people", busca(fmtCpf(CPF1))))).toEqual([pf1]);
  });
});

describe("PP-6 — outra organização com o MESMO documento não aparece", () => {
  it("pelo CNPJ, pela razão e pelo nome, cada organização vê só o seu", async () => {
    const adm = createPool(TEST_URL, { max: 1 });
    const b = await seedDemo(adm, { orgName: "[TEST] Org PP", adminEmail: "adminpp@demo.local", adminPassword: "Demo@12345", slug: "orgpp" }, () => {}); await adm.end();
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "adminpp@demo.local", password: "Demo@12345" } });
    expect(login.statusCode, login.body).toBe(200);
    const hb = { authorization: `Bearer ${j(login).token as string}`, "x-org-id": b.orgId };
    const deB = await criar("people", PJ1, { ...hb, "content-type": "application/json" });
    // premissa (sem RLS): DUAS linhas vivas com esse documento normalizado, uma em cada organização
    const linhas = (await admin.query<{ id: string; organization_id: string }>(
      "select id, organization_id from erp.people where deleted_at is null and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) = $1 order by organization_id = $2 desc",
      [CNPJ1, h.demo.orgId])).rows;
    expect(linhas).toEqual([{ id: pj1, organization_id: h.demo.orgId }, { id: deB, organization_id: b.orgId }]);
    for (const termo of [fmtCnpj(CNPJ1), PJ1.legal_name, PJ1.name]) {
      expect(idsDe(await opcoes("people", busca(termo))), `A: ${termo}`).toEqual([pj1]);
      expect(idsDe(await opcoes("people", busca(termo), hb)), `B: ${termo}`).toEqual([deB]);
    }
  });
});

describe("PP-7 — página no servidor", () => {
  it("padrão = a página de hoje; page/pageSize recortam na ordem do rótulo com desempate pelo id", async () => {
    const base = `PP Pag ${S}`;
    const p1 = await criar("people", { person_type: "legal", name: `${base} 1`, is_client: true });
    // dois com o MESMO rótulo: a ordem entre eles é a do id (página estável)
    const empate = [await criar("people", { person_type: "legal", name: `${base} 2`, is_client: true }), await criar("people", { person_type: "legal", name: `${base} 2`, is_client: true })].sort();
    const esperado = [p1, ...empate];
    // premissa do padrão: sem página vêm os 3, na ordem (rótulo, id)
    expect(idsDe(await opcoes("people", busca(base)))).toEqual(esperado);
    // sem busca, ausente responde o mesmo que page=1&pageSize=200 (o padrão 200 EM SI é provado com 201 linhas, abaixo)
    const semPagina = await opcoes("people", "");
    expect(semPagina.length).toBeGreaterThan(3);
    expect(semPagina.length).toBeLessThanOrEqual(200);
    expect(await opcoes("people", "page=1&pageSize=200")).toEqual(semPagina);
    const pg1 = idsDe(await opcoes("people", `${busca(base)}&pageSize=2`));
    const pg2 = idsDe(await opcoes("people", `${busca(base)}&page=2&pageSize=2`));
    expect(pg1).toEqual(esperado.slice(0, 2));
    expect(pg2).toEqual(esperado.slice(2));
    expect(new Set([...pg1, ...pg2]).size).toBe(3);
    expect(await opcoes("people", `${busca(base)}&page=3&pageSize=2`)).toEqual([]);
    // o limite de cima é aceito (o 201 é recusado no PP-8)
    expect(idsDe(await opcoes("people", `${busca(base)}&page=1&pageSize=200`))).toEqual(esperado);
    expect(await opcoes("people", `${busca(base)}&page=10000&pageSize=200`)).toEqual([]);
  });

  it("o padrão é 1 × 200, provado com 201 linhas: sem página vêm 200; a página 2 (pageSize ausente) traz a que falta", async () => {
    const base = `PP Muitos ${S}`;
    // 201 parceiros pelo papel administrativo (a API criaria um por vez): o código tem letras, nunca entra na sequência
    await admin.query(
      "insert into erp.people(organization_id, code, person_type, name, is_client) select $1, $2 || lpad(g::text, 3, '0'), 'legal', $3 || ' ' || lpad(g::text, 3, '0'), true from generate_series(1, 201) g",
      [h.demo.orgId, `PPM${S}-`, base]);
    // premissa: 201 vivos e ativos casam a busca — um padrão menor que 200, ou maior, mudaria o tamanho da 1ª página
    expect(await um("select count(*)::int as n from erp.people where organization_id=$1 and deleted_at is null and is_active and name ilike $2", [h.demo.orgId, `${base} %`])).toEqual({ n: 201 });
    const p1 = await opcoes("people", busca(base));
    const p2 = await opcoes("people", `${busca(base)}&page=2`);
    expect(p1).toHaveLength(200);
    expect(p2).toHaveLength(1);
    expect(new Set([...idsDe(p1), ...idsDe(p2)]).size).toBe(201);
    expect([p1[0]!.label, p1.at(-1)!.label, p2[0]!.label]).toEqual([`${base} 001`, `${base} 200`, `${base} 201`]);
  });
});

describe("PP-8 — entrada não canônica → 422", () => {
  it("página malformada, fora da faixa ou repetida e busca repetida: 422 VALIDATION_ERROR, depois da autenticação", async () => {
    const casos = ["pageSize=0", "pageSize=201", "page=0", "page=10001", "page=abc", "page=", "pageSize=1.5", "page=1&page=2", "page=1e1", "page=%2B1", "page=%201", "pageSize=0x10", "search=a&search=b"];
    for (const q of casos) {
      const r = await get(`/api/resources/people/options?${q}`);
      expect(r.statusCode, `${q}: ${r.body}`).toBe(422);
      expect(j(r).error.code, q).toBe("VALIDATION_ERROR");
    }
    // a mensagem é a do plugin de erros, em português, com o parâmetro
    expect(j(await get("/api/resources/people/options?pageSize=201")).error.message).toBe("pageSize: Valor máximo: 200");
    expect(j(await get("/api/resources/people/options?page=abc")).error.message).toBe("page: Formato inválido");
    expect(j(await get("/api/resources/people/options?search=a&search=b")).error.message).toBe("search: Informe o parâmetro uma vez só.");
    expect(j(await get("/api/resources/people/options?page=1&page=2")).error.message).toBe("page: Informe o parâmetro uma vez só.");
    // vale para todo seletor, não só Parceiros
    const w = await get("/api/resources/warehouses/options?page=abc");
    expect(w.statusCode, w.body).toBe(422);
    // premissa: o mesmo pedido BEM formado passa (o 422 é da forma, não da rota)
    expect((await get("/api/resources/people/options?page=2&pageSize=5")).statusCode).toBe(200);
    // sem sessão: 401 antes de qualquer conferência do corpo da consulta
    const anonimo = await h.app.inject({ method: "GET", url: "/api/resources/people/options?page=abc" });
    expect(anonimo.statusCode, anonimo.body).toBe(401);
  });
});

describe("PP-9 — os outros seletores não mudam", () => {
  it("o seletor de Locais de estoque continua só pelo rótulo (a sigla acha na listagem, não no seletor)", async () => {
    const sigla = `Q${S.toUpperCase()}`;
    const descricao = `PP Local ${sorteio(LETRAS, 7)}`;
    expect(descricao.toLowerCase()).not.toContain(sigla.toLowerCase());
    const id = await criar("warehouses", { empresa_id: h.demo.empresaIds[0]!, initials: sigla, description: descricao, type: "inputs" });
    // premissa: a LISTAGEM acha pela sigla (`search: true` em initials)
    const lista = await get(`/api/resources/warehouses?${busca(sigla)}`);
    expect(lista.statusCode, lista.body).toBe(200);
    expect((j(lista).items as { id: string }[]).map((x) => x.id)).toEqual([id]);
    expect(await opcoes("warehouses", busca(sigla))).toEqual([]);
    expect(idsDe(await opcoes("warehouses", busca(descricao)))).toEqual([id]);
  });
});

describe("PP-10 — forma da resposta", () => {
  it("cada opção de Parceiros tem exatamente code, id e label", async () => {
    const achados = await opcoes("people", busca(fmtCnpj(CNPJ1)));
    const pagina = await opcoes("people", "pageSize=20");
    // premissa: há o que conferir
    expect(achados).toHaveLength(1); expect(pagina.length).toBeGreaterThan(0);
    for (const o of [...achados, ...pagina]) expect(Object.keys(o).sort()).toEqual(["code", "id", "label"]);
    expect(achados[0]).toMatchObject({ id: pj1, label: PJ1.name });
  });
});

describe("PP-11 — sem people.view: nem razão social, nem PREFIXO de documento (CAPACIDADE ∧ ESCOPO)", () => {
  it("o membro sem a leitura de Parceiros acha pelo nome e pelo documento COMPLETO; o prefixo e a razão não acham", async () => {
    const hm = await membro("pp-sem-view@demo.local", []);
    // premissa: o membro NÃO lê a listagem de Parceiros (que mostra o CPF/CNPJ) e o seletor responde a ele
    const lista = await get("/api/resources/people", hm);
    expect(lista.statusCode, lista.body).toBe(403);
    const prefixoCpf = fmtCpf(CPF1).slice(0, 7);
    const raizCnpj = `${CNPJ1.slice(0, 2)}.${CNPJ1.slice(2, 5)}.${CNPJ1.slice(5, 8)}`;
    // premissa: os MESMOS termos acham para o administrador — a diferença é só a capacidade
    expect(idsDe(await opcoes("people", busca(prefixoCpf)))).toContain(pf1);
    expect(idsDe(await opcoes("people", busca(raizCnpj)))).toContain(pj1);
    expect(idsDe(await opcoes("people", busca(PF1.legal_name)))).toEqual([pf1]);
    // conclusão: sem people.view, nem o prefixo do CPF/CNPJ (que, dígito a dígito, daria o documento inteiro) nem a razão
    expect(idsDe(await opcoes("people", busca(prefixoCpf), hm))).not.toContain(pf1);
    expect(idsDe(await opcoes("people", busca(raizCnpj), hm))).not.toContain(pj1);
    expect(await opcoes("people", busca(PF1.legal_name), hm)).toEqual([]);
    // o que já respondia continua: o nome (o rótulo) e o documento COMPLETO, por igualdade (o que `?document=` dá)
    expect(idsDe(await opcoes("people", `document=${CPF1}`, hm))).toEqual([pf1]);
    expect(idsDe(await opcoes("people", busca(PF1.name), hm))).toEqual([pf1]);
    expect(idsDe(await opcoes("people", busca(fmtCpf(CPF1)), hm))).toEqual([pf1]);
    expect(idsDe(await opcoes("people", busca(fmtCnpj(CNPJ_ALFA).toLowerCase()), hm))).toEqual([pj2]);
  });
});
