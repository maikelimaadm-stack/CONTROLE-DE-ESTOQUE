import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * Anexos × autorização do registro-pai. Matriz: OWNER, USER_A (=[A]), USER_AB (=[A,B]) com as MESMAS permissões
 * (attachments.* + view dos pais); NOVIEW com attachments.* mas sem a permissão de ver o pai; organização estranha O2.
 * Regra: nenhuma operação de anexo atravessa tenant, fazenda ou permissão funcional do pai — mesmo conhecendo os UUIDs.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
let A: Hdr; let AB: Hdr; let OWNER: Hdr; let NOVIEW: Hdr; let noviewRole = ""; let farmA = ""; let farmB = "";
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string } };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString("base64");
const PERMS = ["attachments.view", "attachments.create", "attachments.delete", "weighings.view", "people.view", "feedlot_sectors.view", "warehouses.view"];

async function member(name: string, email: string, farmIds: string[], perms = PERMS): Promise<{ hdr: Hdr; roleId: string }> {
  const role = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${name}`, permissions: perms } }); expect(role.statusCode, role.body).toBe(201);
  const mem = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name, email, password: "Anexo@12345", role_id: j(role).id, farm_ids: farmIds } }); expect(mem.statusCode, mem.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Anexo@12345" } }); expect(login.statusCode, login.body).toBe(200);
  return { hdr: { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId }, roleId: j(role).id as string };
}
const list = (entity: string, id: string, hd: Hdr) => h.app.inject({ method: "GET", url: `/api/attachments?entity=${entity}&entity_id=${id}`, headers: hd });
const upload = (entity: string, id: string, hd: Hdr, name = "doc.pdf") => h.app.inject({ method: "POST", url: "/api/attachments", headers: hd, payload: { entity, entity_id: id, file_name: name, mime_type: "application/pdf", data_base64: PDF } });
const content = (attId: string, hd: Hdr) => h.app.inject({ method: "GET", url: `/api/attachments/${attId}/content`, headers: hd });
const del = (attId: string, hd: Hdr) => h.app.inject({ method: "DELETE", url: `/api/attachments/${attId}`, headers: hd });
const mk = async (url: string, payload: Record<string, unknown>) => { const r = await h.app.inject({ method: "POST", url, headers: h.headers(), payload }); expect(r.statusCode, `${url}: ${r.body}`).toBe(201); return j(r).id as string; };

let wa = ""; let wb = ""; let attA = ""; let attB = "";
beforeAll(async () => {
  h = await harness(); I = await ids(h); farmA = I.farm; farmB = I.farm2; OWNER = h.headers();
  A = (await member("Anexo A", "anexo-a@demo.local", [farmA])).hdr; AB = (await member("Anexo AB", "anexo-ab@demo.local", [farmA, farmB])).hdr;
  const nv = await member("Anexo sem view", "anexo-noview@demo.local", [farmA], ["attachments.view", "attachments.create", "attachments.delete"]); NOVIEW = nv.hdr; noviewRole = nv.roleId;
  wa = await mk("/api/livestock/weighings", { farm_id: farmA, weighing_date: "2026-09-20", batch_id: I.batch, items: [{ animal_id: I.animal, weight: "300" }] });
  wb = await mk("/api/livestock/weighings", { farm_id: farmB, weighing_date: "2026-09-21", batch_id: I.batch, items: [{ animal_id: I.animal, weight: "301" }] });
  attA = j(await upload("weighings", wa, OWNER, "a.pdf")).id as string; attB = j(await upload("weighings", wb, OWNER, "b.pdf")).id as string;
  expect(attA && attB).toBeTruthy();
});
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("anexos: autorização pelo registro-pai", () => {
  it("FARM-SCOPED — USER_A conhece os UUIDs de B e não consegue nenhuma operação; A continua permitido; AB e OWNER veem tudo", async () => {
    // pai A
    const la = await list("weighings", wa, A); expect(la.statusCode).toBe(200); expect((j(la).items as { id: string }[]).some((x) => x.id === attA)).toBe(true);
    expect((await content(attA, A)).statusCode).toBe(200);
    const mine = await upload("weighings", wa, A); expect(mine.statusCode, mine.body).toBe(201);
    expect((await del(j(mine).id as string, A)).statusCode).toBe(200);
    // pai B (UUIDs conhecidos): list, download, create, delete → 404, sem expor existência
    for (const [op, res] of [["list", await list("weighings", wb, A)], ["download", await content(attB, A)], ["create", await upload("weighings", wb, A)], ["delete", await del(attB, A)]] as const) {
      expect(res.statusCode, `USER_A ${op} em B`).toBe(404); expect(j(res).error?.code).toBe("NOT_FOUND");
    }
    // X-Farm-Id=B recusado na entrada
    expect((await list("weighings", wb, { ...A, "x-farm-id": farmB })).statusCode).toBe(403);
    // anexo de B continua existindo (o DELETE negado não removeu nada)
    expect((await content(attB, OWNER)).statusCode).toBe(200);
    for (const [who, hd] of [["USER_AB", AB], ["OWNER", OWNER]] as const) {
      expect((await list("weighings", wb, hd)).statusCode, `${who} list B`).toBe(200); expect((await content(attB, hd)).statusCode, `${who} download B`).toBe(200);
      const up = await upload("weighings", wb, hd); expect(up.statusCode, `${who} create B`).toBe(201); expect((await del(j(up).id as string, hd)).statusCode, `${who} delete B`).toBe(200);
    }
  });
  it("ATTACHMENTS.VIEW SEM PARENT VIEW — não lista nem baixa; ao conceder a permissão do pai (cache invalidado), passa a acessar dentro do escopo", async () => {
    expect((await list("weighings", wa, NOVIEW)).statusCode).toBe(403); expect((await content(attA, NOVIEW)).statusCode).toBe(403);
    expect((await upload("weighings", wa, NOVIEW)).statusCode).toBe(403); expect((await del(attA, NOVIEW)).statusCode).toBe(403);
    const upd = await h.app.inject({ method: "PUT", url: `/api/admin/roles/${noviewRole}`, headers: h.headers(), payload: { name: "Perfil Anexo sem view", permissions: ["attachments.view", "attachments.create", "attachments.delete", "weighings.view"] } }); expect(upd.statusCode, upd.body).toBe(200);
    expect((await list("weighings", wa, NOVIEW)).statusCode).toBe(200); expect((await content(attA, NOVIEW)).statusCode).toBe(200);
    expect((await list("weighings", wb, NOVIEW)).statusCode).toBe(404); // escopo de fazenda continua valendo
  });
  it("ORGANIZATION-SCOPED — pessoa (organização inteira): USER_A e USER_AB acessam; farmScope não é aplicado cegamente", async () => {
    const provider = I.provider!; const up = await upload("people", provider, A); expect(up.statusCode, up.body).toBe(201); const id = j(up).id as string;
    expect((await list("people", provider, AB)).statusCode).toBe(200); expect((await content(id, AB)).statusCode).toBe(200); expect((await content(id, A)).statusCode).toBe(200);
    expect((await del(id, AB)).statusCode).toBe(200);
  });
  it("CHILD RESOURCE — setor do confinamento herda a fazenda do pátio", async () => {
    const admin = createPool(TEST_URL, { max: 1 });
    const s = (await admin.query<{ id: string; farm_id: string }>("select s.id, y.farm_id from erp.feedlot_sectors s join erp.feedlot_yards y on y.id=s.yard_id where s.organization_id=$1 and s.deleted_at is null limit 1", [h.demo.orgId])).rows[0]; await admin.end();
    expect(s).toBeTruthy();
    const up = await upload("feedlot_sectors", s!.id, OWNER); expect(up.statusCode, up.body).toBe(201);
    const expectA = s!.farm_id === farmA ? 200 : 404;
    expect((await list("feedlot_sectors", s!.id, A)).statusCode).toBe(expectA); expect((await content(j(up).id as string, A)).statusCode).toBe(expectA);
    expect((await list("feedlot_sectors", s!.id, AB)).statusCode).toBe(200);
  });
  it("UNKNOWN / NÃO ANEXÁVEL / ID INEXISTENTE — recusa controlada (422 entidade, 404 registro), nunca 500", async () => {
    for (const e of ["foo", "attachment_blobs", "organization_members", "erp.weighings", "weighings;drop"]) {
      const l = await list(e, wa, OWNER); expect([400, 422], `${e} list`).toContain(l.statusCode); expect(["VALIDATION_ERROR"]).toContain(j(l).error?.code ?? "VALIDATION_ERROR");
      const u = await upload(e, wa, OWNER); expect([400, 422], `${e} create`).toContain(u.statusCode);
    }
    const ghost = "00000000-0000-4000-8000-000000000000";
    expect((await list("weighings", ghost, OWNER)).statusCode).toBe(404); expect((await upload("weighings", ghost, OWNER)).statusCode).toBe(404);
    expect((await content(ghost, OWNER)).statusCode).toBe(404); expect((await del(ghost, OWNER)).statusCode).toBe(404);
  });
  it("CROSS-TENANT — usuário de O2 conhecendo entity/entity_id/attachment_id de O1: nada", async () => {
    const adm = createPool(TEST_URL, { max: 1 });
    const o2 = await seedDemo(adm, { orgName: "[TEST] Org Anexos", adminEmail: "admin-anexos@demo.local", adminPassword: "Demo@12345", slug: "orgax" }, () => {}); await adm.end();
    const tok = (j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-anexos@demo.local", password: "Demo@12345" } })) as { token: string }).token;
    const O2 = { authorization: `Bearer ${tok}`, "x-org-id": o2.orgId };
    expect((await list("weighings", wa, O2)).statusCode).toBe(404); expect((await upload("weighings", wa, O2)).statusCode).toBe(404);
    expect((await content(attA, O2)).statusCode).toBe(404); expect((await del(attA, O2)).statusCode).toBe(404);
    expect((await content(attA, OWNER)).statusCode).toBe(200); // intacto
    // header X-Org-Id de O1 com token de O2 → 403 (contexto)
    expect((await list("weighings", wa, { authorization: `Bearer ${tok}`, "x-org-id": h.demo.orgId })).statusCode).toBe(403);
  });
});
