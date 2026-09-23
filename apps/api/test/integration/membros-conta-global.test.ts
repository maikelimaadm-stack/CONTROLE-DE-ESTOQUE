import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { createPool, seedDemo, type Db } from "@agro/db";
import { harness, TEST_URL, escoposDeTodosOsModulos, type Harness } from "./setup.js";

/**
 * GO-LIVE-01 R1 — o cadastro de usuários de uma organização não pode tomar a conta de outra.
 * `erp.users` é global: nome, telefone e senha valem em TODAS as organizações do usuário. Org A é a demo do
 * harness; org B é uma segunda organização com o próprio dono.
 */
let h: Harness;
let admin: Db;
let donoB: { id: string; email: string };
const SENHA_B = "Senha-B-Original-2026";
const j = (r: { body: string }) => JSON.parse(r.body);
const linhaUsuario = async (email: string) => (await admin.query("select id, name, phone, password_hash, updated_at from erp.users where email=$1", [email])).rows[0];
const vinculosA = async (userId: string) => Number((await admin.query<{ n: string }>("select count(*) n from erp.organization_members where organization_id=$1 and user_id=$2", [h.demo.orgId, userId])).rows[0]!.n);
const loginB = async (senha: string) => (await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: donoB.email, password: senha } })).statusCode;
const post = (payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers({ "content-type": "application/json" }), payload });
const put = (userId: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `/api/admin/members/${userId}`, headers: h.headers({ "content-type": "application/json" }), payload });

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 2 });
  const b = await seedDemo(admin, { slug: "org-b-conta", adminEmail: "dono-b@conta.example", adminPassword: SENHA_B }, () => {});
  donoB = { id: b.adminUserId, email: b.adminEmail };
  expect(await loginB(SENHA_B)).toBe(200);
}, 120_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("cadastro de membro × usuário global", () => {
  it("U1: admin de A 'cria' membro com o e-mail do dono de B e uma senha → recusa; usuário de B intacto; nenhum vínculo em A", async () => {
    const antes = await linhaUsuario(donoB.email);
    const r = await post({ name: "Invasor", email: donoB.email.toUpperCase(), phone: "000", password: "Senha-Do-Invasor-1", escopos_empresas: escoposDeTodosOsModulos([]) });
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error.code).toBe("CONFLICT");
    expect(j(r).error.message).toBe("Já existe um usuário com este e-mail. Vincular um usuário existente não é suportado; use outro e-mail.");
    expect(r.body).not.toContain("org-b-conta");
    expect(await linhaUsuario(donoB.email)).toEqual(antes);
    expect(await vinculosA(donoB.id)).toBe(0);
  });

  it("U2: e-mail que já é membro de A → recusa orientando a edição; nada alterado", async () => {
    const antes = await linhaUsuario("operador@demo.local");
    const r = await post({ name: "Outro Nome", email: "operador@demo.local", password: "Senha-Nova-12345", escopos_empresas: escoposDeTodosOsModulos([]) });
    expect(r.statusCode).toBe(409);
    expect(j(r).error.message).toBe("Este usuário já é membro desta organização. Use a edição do usuário.");
    expect(await linhaUsuario("operador@demo.local")).toEqual(antes);
  });

  it("U3: usuário com vínculo em A e em B → admin de A não troca senha nem nome; o vínculo de A continua editável", async () => {
    // O seed de B também vincula o operador da demo; o vínculo em B fica INATIVO: inativo também conta.
    const op = await linhaUsuario("operador@demo.local") as { id: string };
    const orgB = (await admin.query<{ id: string }>("select id from erp.organizations where slug='org-b-conta'")).rows[0]!.id;
    await admin.query("insert into erp.organization_members(organization_id,user_id,is_active) values ($1,$2,false) on conflict (organization_id,user_id) do update set is_active=false", [orgB, op.id]);
    expect(Number((await admin.query<{ n: string }>("select count(*) n from erp.organization_members where organization_id=$1 and user_id=$2 and not is_active", [orgB, op.id])).rows[0]!.n)).toBe(1);
    const antes = await linhaUsuario("operador@demo.local");
    for (const corpo of [{ password: "Senha-Trocada-123" }, { name: "Nome Trocado" }, { phone: "999" }]) {
      const r = await put(op.id, corpo);
      expect(r.statusCode, JSON.stringify(corpo)).toBe(409);
      expect(j(r).error.message).toContain("também pertence a outra");
    }
    expect(await linhaUsuario("operador@demo.local")).toEqual(antes);
    // Perfil/ativo do vínculo de A seguem editáveis.
    const r = await put(op.id, { is_active: true });
    expect(r.statusCode, r.body).toBe(200);
  });

  it("U4: usuário só de A → admin de A troca nome e senha (regressão)", async () => {
    const c = await post({ name: "Só A", email: "so-a@conta.example", password: "Senha-Inicial-123", escopos_empresas: escoposDeTodosOsModulos([]) });
    expect(c.statusCode, c.body).toBe(201);
    const id = j(c).id as string;
    const r = await put(id, { name: "Só A Renomeado", password: "Senha-Trocada-456" });
    expect(r.statusCode, r.body).toBe(200);
    const u = await linhaUsuario("so-a@conta.example") as { name: string; password_hash: string };
    expect(u.name).toBe("Só A Renomeado");
    expect(await bcrypt.compare("Senha-Trocada-456", u.password_hash)).toBe(true);
  });

  it("U5: depois de U1 e U3, o dono de B continua entrando com a senha original", async () => {
    expect(await loginB(SENHA_B)).toBe(200);
    expect(await loginB("Senha-Do-Invasor-1")).toBe(401);
    const u = await linhaUsuario(donoB.email) as { name: string; password_hash: string };
    expect(await bcrypt.compare(SENHA_B, u.password_hash)).toBe(true);
    expect(u.name).not.toBe("Invasor");
  });

  it("U6: criação com e-mail novo continua funcionando (regressão)", async () => {
    const r = await post({ name: "Novo Membro", email: "novo@conta.example", password: "Senha-Novo-12345", escopos_empresas: escoposDeTodosOsModulos([]) });
    expect(r.statusCode, r.body).toBe(201);
    expect(await vinculosA(j(r).id)).toBe(1);
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "novo@conta.example", password: "Senha-Novo-12345" } });
    expect(login.statusCode).toBe(200);
  });

  it("U7: e-mail diferente do atual no PUT → recusa explícita; igual ao atual → aceito", async () => {
    const c = await post({ name: "Email Fixo", email: "fixo@conta.example", password: "Senha-Fixo-12345", escopos_empresas: escoposDeTodosOsModulos([]) });
    const id = j(c).id as string;
    const muda = await put(id, { email: "outro@conta.example", name: "Email Fixo" });
    expect(muda.statusCode).toBe(422);
    expect(j(muda).error.message).toBe("O e-mail do usuário não pode ser alterado.");
    expect((await linhaUsuario("fixo@conta.example") as { name: string }).name).toBe("Email Fixo");
    expect(await linhaUsuario("outro@conta.example")).toBeUndefined();
    const igual = await put(id, { email: "FIXO@conta.example", name: "Email Fixo 2" });
    expect(igual.statusCode, igual.body).toBe(200);
  });
});
