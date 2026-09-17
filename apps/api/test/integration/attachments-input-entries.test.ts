import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo } from "@agro/db";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * ANEXOS NA ENTRADA DE INSUMOS — a primeira entidade de LANÇAMENTO anexável (BASE2-01 R3).
 *
 * A whitelist de anexos é superfície de autorização: abrir uma entidade nela dá acesso real a um acervo de
 * arquivos. Por isso `input_entries` entra sozinha, junto do consumidor que a usa, e com a matriz inteira
 * provada aqui — não basta "o servidor parou de devolver 422".
 *
 * A regra declarada em `attachment-parent.ts` é a mesma de `animals`: tenant + empresa do próprio registro +
 * exclusão lógica. Este teste existe para provar que ela se comporta como as outras, caso a caso, e para que
 * qualquer afrouxamento futuro em `authorizeAttachmentParent` reprove aqui em vez de passar despercebido.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
let OWNER: Hdr; let USER_A: Hdr; let SEM_VIEW: Hdr;
let empresaA = ""; let empresaB = "";
let entradaA = ""; let entradaB = ""; let entradaExcluida = "";

const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string } };
const TXT = Buffer.from("nota de conferencia da entrada").toString("base64");
const PERMS = ["attachments.view", "attachments.create", "attachments.delete", "input_entries.view"];

async function membro(nome: string, email: string, empresas: string[], perms = PERMS): Promise<Hdr> {
  const role = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: perms } });
  expect(role.statusCode, role.body).toBe(201);
  const mem = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Anexo@12345", role_id: j(role).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(mem.statusCode, mem.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Anexo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId };
}

const listar = (entity: string, id: string, hd: Hdr) => h.app.inject({ method: "GET", url: `/api/attachments?entity=${entity}&entity_id=${id}`, headers: hd });
const enviar = (entity: string, id: string, hd: Hdr, nome = "conferencia.txt") =>
  h.app.inject({ method: "POST", url: "/api/attachments", headers: hd, payload: { entity, entity_id: id, file_name: nome, mime_type: "text/plain", data_base64: TXT } });
const excluir = (attId: string, hd: Hdr) => h.app.inject({ method: "DELETE", url: `/api/attachments/${attId}`, headers: hd });

async function criarEntrada(empresaId: string, warehouseId: string): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/stock/input-entries", headers: h.headers(), payload: {
    empresa_id: empresaId, entry_date: "2026-09-22",
    items: [{ product_id: I.product, warehouse_id: warehouseId, quantity: "5", unit_value: "10.00", generate_stock: true }]
  } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

beforeAll(async () => {
  h = await harness(); I = await ids(h); OWNER = h.headers();
  empresaA = I.empresa; empresaB = I.empresa2;
  USER_A = await membro("Entrada A", "entrada-a@demo.local", [empresaA]);
  SEM_VIEW = await membro("Entrada sem view", "entrada-noview@demo.local", [empresaA], ["attachments.view", "attachments.create", "attachments.delete"]);
  entradaA = await criarEntrada(empresaA, I.warehouse!);
  entradaB = await criarEntrada(empresaB, I.warehouseEmpresa2!);
  entradaExcluida = await criarEntrada(empresaA, I.warehouse!);
  // exclusão lógica pela porta oficial de cancelamento não apaga a linha; marcamos deleted_at direto para
  // exercitar o ramo `deleted_at is null` do `load` sem inventar uma rota que não existe
  const adm = createPool(TEST_URL, { max: 1 });
  await adm.query("update erp.input_entries set deleted_at=now() where id=$1", [entradaExcluida]);
  await adm.end();
});
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("anexos: entrada de insumos como registro-pai", () => {
  it("A — `input_entries` é reconhecida como anexável (deixou de ser 422)", async () => {
    const r = await listar("input_entries", entradaA, OWNER);
    expect(r.statusCode, r.body).toBe(200);
    expect(Array.isArray(j(r).items)).toBe(true);
  });

  it("B — com attachments.view + input_entries.view + empresa no escopo: lista, envia e exclui", async () => {
    const env = await enviar("input_entries", entradaA, USER_A);
    expect(env.statusCode, env.body).toBe(201);
    const attId = j(env).id as string;

    const lst = await listar("input_entries", entradaA, USER_A);
    expect(lst.statusCode).toBe(200);
    expect((j(lst).items as { id: string }[]).some((x) => x.id === attId)).toBe(true);

    expect((await excluir(attId, USER_A)).statusCode).toBe(200);
  });

  it("C — outro tenant conhecendo o UUID: 404 em todas as operações", async () => {
    const o2 = await seedDemo(h.db, { orgName: "Org Anexo Entrada 2", slug: `org-anexo-entrada-${Date.now().toString(36)}` });
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: o2.adminEmail, password: "Demo@12345" } });
    expect(login.statusCode, login.body).toBe(200);
    const O2 = { authorization: `Bearer ${j(login).token}`, "x-org-id": o2.orgId };
    expect((await listar("input_entries", entradaA, O2)).statusCode).toBe(404);
    expect((await enviar("input_entries", entradaA, O2)).statusCode).toBe(404);
  });

  it("D — empresa fora do escopo de ESTOQUE do usuário: 404, e não 403 (não revela existência)", async () => {
    const r = await listar("input_entries", entradaB, USER_A);
    expect(r.statusCode, r.body).toBe(404);
    expect((await enviar("input_entries", entradaB, USER_A)).statusCode).toBe(404);
  });

  it("E — com attachments.* mas sem input_entries.view: 403 (falta capacidade, o registro existe e é visível)", async () => {
    const r = await listar("input_entries", entradaA, SEM_VIEW);
    expect(r.statusCode, r.body).toBe(403);
  });

  it("F — entidade não suportada continua 422, não 404", async () => {
    for (const entidade of ["stock_writeoffs", "warehouse_transfers", "feed_batches", "nao_existe"]) {
      const r = await listar(entidade, entradaA, OWNER);
      expect([400, 422], `${entidade}: ${r.body}`).toContain(r.statusCode);
    }
  });

  it("G — pai com exclusão lógica: 404 (o anexo não sobrevive ao pai apagado)", async () => {
    expect((await listar("input_entries", entradaExcluida, OWNER)).statusCode).toBe(404);
    expect((await enviar("input_entries", entradaExcluida, OWNER)).statusCode).toBe(404);
  });

  it("H — as regras de attachments.create/delete não foram afrouxadas: sem a permissão, 403", async () => {
    const semCreate = await membro("Entrada só leitura", "entrada-readonly@demo.local", [empresaA], ["attachments.view", "input_entries.view"]);
    expect((await listar("input_entries", entradaA, semCreate)).statusCode).toBe(200);
    expect((await enviar("input_entries", entradaA, semCreate)).statusCode).toBe(403);
  });
});

/**
 * HISTÓRICO — VERIFICAÇÃO, não refatoração (BASE2-01 R3).
 *
 * A moldura passou a exibir um botão de Histórico em sete telas de lançamento, e ele consome
 * `/api/admin/audit`. Essa porta filtra por ORGANIZAÇÃO e não por empresa — o que é coerente, e não um
 * descuido: `audit_logs` está declarado como recurso ORGANIZACIONAL em
 * `packages/domain/src/escopo-permissao.ts`. A fatia não cria autoridade nova; o mesmo dado já era
 * alcançável por Configurações › Auditoria com a mesma capacidade.
 *
 * O que estes testes fixam é o que NÃO pode mudar sem alguém perceber: o tenant é intransponível e a
 * capacidade é exigida.
 */
describe("histórico do registro: a porta de auditoria continua fechada onde deve", () => {
  it("cross-tenant é impossível mesmo conhecendo entity e entity_id de outra organização", async () => {
    const o2 = await seedDemo(h.db, { orgName: "Org Auditoria 2", slug: `org-audit-${Date.now().toString(36)}` });
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: o2.adminEmail, password: "Demo@12345" } });
    expect(login.statusCode, login.body).toBe(200);
    const O2 = { authorization: `Bearer ${j(login).token}`, "x-org-id": o2.orgId };

    const r = await h.app.inject({ method: "GET", url: `/api/admin/audit?entity=input_entries&entity_id=${entradaA}`, headers: O2 });
    expect(r.statusCode, r.body).toBe(200);
    // 200 com ZERO eventos: a organização de O2 não enxerga o registro de O1 nem por id conhecido
    expect((j(r).items as unknown[]).length, "auditoria de outro tenant não pode vazar um único evento").toBe(0);

    // e o mesmo id lido pelo dono devolve evento — prova que o zero acima é recorte, não ausência de dado
    const dono = await h.app.inject({ method: "GET", url: `/api/admin/audit?entity=input_entries&entity_id=${entradaA}`, headers: OWNER });
    expect(dono.statusCode).toBe(200);
    expect((j(dono).items as unknown[]).length).toBeGreaterThan(0);
  });

  it("sem audit_logs.view a consulta é negada, mesmo com acesso ao próprio registro", async () => {
    const semAuditoria = await membro("Entrada sem auditoria", "entrada-sem-audit@demo.local", [empresaA], ["attachments.view", "input_entries.view"]);
    const r = await h.app.inject({ method: "GET", url: `/api/admin/audit?entity=input_entries&entity_id=${entradaA}`, headers: semAuditoria });
    expect(r.statusCode, r.body).toBe(403);
  });
});
