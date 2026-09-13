import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * INTEGRIDADE DA EMISSÃO DA TRANSFERÊNCIA PECUÁRIA (PRE-BASE2-03, correção final).
 *
 * A emissão de `farm_transfer` recebe do cliente uma LISTA DE UUIDs (`animal_ids`), um lote de origem e um
 * lote de destino. As FKs de `erp.animal_movement_items` são GLOBAIS por UUID — `animal_id references
 * erp.animals(id)`, sem organização —, de modo que a FK prova "este animal existe" e NÃO prova "este animal
 * é desta organização". O mesmo vale para `animal_movements.batch_id` e `destination_batch_id`.
 *
 * Sem prova prévia, um UUID conhecido de OUTRO tenant entrava numa transferência desta organização, e um
 * animal morto, vendido ou excluído entrava como cabeça viva. Este arquivo prova as DUAS linhas de defesa:
 * a rota (validação em lote, fail-closed, sem enumeração) e o BANCO (guard estreito da `farm_transfer`).
 *
 * ANTI-ENUMERAÇÃO é requisito, não estilo: UUID inexistente, UUID de outro tenant, UUID da empresa errada e
 * UUID em estado inelegível têm de ter a MESMA superfície pública. Diferenciá-los transformaria a emissão
 * num oráculo de existência do acervo alheio.
 */
let h: Harness; let admin: Db;
let ORG = ""; let A = ""; let B = "";
let tkA = ""; let tkB = "";
let ESP = ""; let CAT = "";
/** outra organização: empresa, lote e animal ativos, todos perfeitamente válidos LÁ. */
let ORG2 = ""; let X = ""; let LOTE_X = ""; let ANIMAL_X = "";
/** acervo da empresa B (mesmo tenant, empresa ERRADA para uma transferência que sai de A). */
let LOTE_B = ""; let ANIMAL_B = "";

type Resposta = { statusCode: number; body: string; json: () => unknown };
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string; message: string } };
const cab = (t: string) => ({ authorization: `Bearer ${t}`, "x-org-id": ORG });
const post = (t: string, url: string, payload: Record<string, unknown> = {}): Promise<Resposta> =>
  h.app.inject({ method: "POST", url, headers: cab(t), payload }) as unknown as Promise<Resposta>;

const UUID_INEXISTENTE = "00000000-0000-4000-8000-0000000000ff";

async function animal(org: string, empresa: string, lote: string | null, extra: Record<string, string> = {}): Promise<string> {
  const cols = ["organization_id", "empresa_id", "category_id", "species_id", "batch_id", "sex", "entry_date", ...Object.keys(extra)];
  const vals: unknown[] = [org, empresa, CAT, ESP, lote, "M", "2031-01-01", ...Object.values(extra)];
  const ph = vals.map((_, i) => `$${i + 1}`).join(",");
  return (await admin.query<{ id: string }>(`insert into erp.animals(${cols.join(",")}) values (${ph}) returning id`, vals)).rows[0]!.id;
}
async function lote(org: string, empresa: string, code: string, status = "active"): Promise<string> {
  return (await admin.query<{ id: string }>("insert into erp.batches(organization_id,empresa_id,code,batch_date,description,status) values ($1,$2,$3,current_date,'Lote',$4) returning id", [org, empresa, code, status])).rows[0]!.id;
}
/** Quantas transferências de rebanho existem hoje — a prova de que uma emissão recusada não deixou rastro. */
const transferencias = async () =>
  Number((await admin.query<{ n: string }>("select count(*)::text n from erp.animal_movements where movement_type='farm_transfer'")).rows[0]!.n);
const itens = async () =>
  Number((await admin.query<{ n: string }>("select count(*)::text n from erp.animal_movement_items i join erp.animal_movements m on m.id=i.movement_id where m.movement_type='farm_transfer'")).rows[0]!.n);
/** A superfície PÚBLICA da recusa: é ela que não pode distinguir os casos. */
const superficie = (r: Resposta) => ({ status: r.statusCode, code: j(r).error?.code, message: j(r).error?.message });

async function usuario(email: string, empresas: string[]): Promise<string> {
  const hash = (await admin.query<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'")).rows[0]!.password_hash;
  const papel = (await admin.query<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [ORG, `[TEST] ${email}`])).rows[0]!.id;
  for (const k of ["batch_farm_transfer.view", "batch_farm_transfer.create", "batch_farm_transfer.process", "animals.view", "batches.view"])
    await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2) on conflict do nothing", [papel, k]);
  const u = (await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash])).rows[0]!.id;
  const m = (await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true) returning id", [ORG, u, papel])).rows[0]!.id;
  await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,'pecuaria','selecionadas')", [ORG, m]);
  for (const e of empresas) await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,'pecuaria','selecionadas',$3)", [ORG, m, e]);
  const r = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo@12345" } });
  if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.body}`);
  return (j(r) as unknown as { token: string }).token;
}

beforeAll(async () => {
  h = await harness(); const I = await ids(h); ORG = h.demo.orgId; A = I.farm; B = I.farm2;
  admin = createPool(TEST_URL, { max: 3 });
  CAT = (await admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]!.id;
  ESP = (await admin.query<{ id: string }>("select id from erp.animal_species limit 1")).rows[0]!.id;

  ORG2 = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Outro tenant pecuaria','outro-pec') returning id")).rows[0]!.id;
  X = (await admin.query<{ id: string }>("insert into erp.empresas(organization_id,code,name) values ($1,97,'Empresa X de O2') returning id", [ORG2])).rows[0]!.id;
  LOTE_X = await lote(ORG2, X, "TPX");
  ANIMAL_X = await animal(ORG2, X, LOTE_X);

  LOTE_B = await lote(ORG, B, "TPB");
  ANIMAL_B = await animal(ORG, B, LOTE_B);

  tkA = await usuario("integr-a@demo.local", [A]);
  tkB = await usuario("integr-b@demo.local", [B]);
}, 240_000);

afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

/** Acervo novo na ORIGEM a cada teste: dois animais identificados e um rebanho de sete cabeças. */
async function acervo(): Promise<{ lote: string; a1: string; a2: string; rebanho: string }> {
  const marca = Math.random().toString(36).slice(2, 10);
  const l = await lote(ORG, A, `TPA${marca}`);
  const a1 = await animal(ORG, A, l); const a2 = await animal(ORG, A, l);
  const rebanho = (await admin.query<{ id: string }>("insert into erp.herd_lots(organization_id,empresa_id,batch_id,species_id,category_id,quantity,entry_date) values ($1,$2,$3,$4,$5,7,current_date) returning id", [ORG, A, l, ESP, CAT])).rows[0]!.id;
  return { lote: l, a1, a2, rebanho };
}
const emitir = (payload: Record<string, unknown>) =>
  post(tkA, "/api/livestock/transfers/to-farm", { empresa_id: A, empresa_destino_id: B, movement_date: "2031-03-01", ...payload });

/** Emite e garante que NADA foi persistido — a recusa tem de acontecer ANTES do documento existir. */
async function recusaSemRastro(payload: Record<string, unknown>): Promise<Resposta> {
  const t0 = await transferencias(); const i0 = await itens();
  const r = await emitir(payload);
  expect(r.statusCode, `emissão inválida devia falhar: ${r.body}`).toBe(422);
  expect(j(r).error?.code).toBe("VALIDATION_ERROR");
  expect(await transferencias(), "nenhum documento pendente pode sobrar de uma emissão recusada").toBe(t0);
  expect(await itens(), "nenhum item pode sobrar de uma emissão recusada").toBe(i0);
  return r;
}

describe("EMISSÃO — animal de OUTRO TENANT não entra numa transferência desta organização", () => {
  it("animal_ids com UUID de outra organização é recusado e não deixa rastro", async () => {
    const r = await recusaSemRastro({ animal_ids: [ANIMAL_X] });
    const ax = await admin.query<{ empresa_id: string; organization_id: string }>("select empresa_id, organization_id from erp.animals where id=$1", [ANIMAL_X]);
    expect(ax.rows[0]!.organization_id, "o animal do outro tenant não pode ter sido tocado").toBe(ORG2);
    expect(ax.rows[0]!.empresa_id).toBe(X);
    expect(r.body, "nada do outro tenant pode vazar na resposta").not.toContain(ANIMAL_X);
    expect(r.body).not.toContain("Empresa X de O2");
  });

  it("UUID de outro tenant e UUID inexistente têm a MESMA superfície pública (nada de oráculo)", async () => {
    const estrangeiro = await recusaSemRastro({ animal_ids: [ANIMAL_X] });
    const inexistente = await recusaSemRastro({ animal_ids: [UUID_INEXISTENTE] });
    expect(superficie(inexistente), "distinguir os dois casos entrega existência de UUID alheio").toEqual(superficie(estrangeiro));
  });

  it("batch_id de outro tenant é recusado", async () => {
    await recusaSemRastro({ batch_id: LOTE_X });
  });

  it("destination_batch_id de outro tenant é recusado", async () => {
    const ac = await acervo();
    await recusaSemRastro({ batch_id: ac.lote, destination_batch_id: LOTE_X });
  });
});

describe("EMISSÃO — mesmo tenant, empresa ERRADA", () => {
  it("animal da empresa B não sai numa transferência que parte de A", async () => {
    const r = await recusaSemRastro({ animal_ids: [ANIMAL_B] });
    expect(superficie(r).message, "a empresa do animal é informação interna").not.toContain("empresa");
  });
  it("lote de origem da empresa B é recusado", async () => { await recusaSemRastro({ batch_id: LOTE_B }); });
  it("lote de destino da empresa A (destino é B) é recusado", async () => {
    const ac = await acervo();
    await recusaSemRastro({ batch_id: ac.lote, destination_batch_id: ac.lote });
  });
});

describe("EMISSÃO — estado do animal", () => {
  for (const estado of ["sold", "dead", "lost", "inventoried"] as const) {
    it(`animal '${estado}' não é cabeça transferível`, async () => {
      const id = await animal(ORG, A, null, { status: estado });
      await recusaSemRastro({ animal_ids: [id] });
    });
  }
  it("animal excluído (soft delete) não é cabeça transferível", async () => {
    const id = await animal(ORG, A, null);
    await admin.query("update erp.animals set deleted_at=now() where id=$1", [id]);
    await recusaSemRastro({ animal_ids: [id] });
  });
  it("todos os estados inelegíveis têm a MESMA superfície pública", async () => {
    const morto = await animal(ORG, A, null, { status: "dead" });
    const excluido = await animal(ORG, A, null);
    await admin.query("update erp.animals set deleted_at=now() where id=$1", [excluido]);
    const a = await recusaSemRastro({ animal_ids: [morto] });
    const b = await recusaSemRastro({ animal_ids: [excluido] });
    const c = await recusaSemRastro({ animal_ids: [UUID_INEXISTENTE] });
    expect(superficie(a)).toEqual(superficie(c));
    expect(superficie(b)).toEqual(superficie(c));
  });
  it("o mesmo animal duas vezes no payload é recusado — cabeça não se conta em dobro", async () => {
    const ac = await acervo();
    await recusaSemRastro({ animal_ids: [ac.a1, ac.a1] });
  });
});

describe("EMISSÃO — o caminho válido continua funcionando", () => {
  it("dois animais identificados e um rebanho de sete: 201, nove cabeças, pendente", async () => {
    const ac = await acervo();
    const destino = await lote(ORG, B, `TPD${Math.random().toString(36).slice(2, 8)}`);
    const r = await emitir({ batch_id: ac.lote, destination_batch_id: destino });
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r)["heads"]).toBe(9);
    expect(j(r)["animals"]).toBe(2);
    expect(j(r)["herd_lots"]).toBe(1);
    expect(j(r)["status"]).toBe("pending");
  });

  it("animais explícitos do próprio lote são aceitos", async () => {
    const ac = await acervo();
    const r = await emitir({ batch_id: ac.lote, animal_ids: [ac.a1, ac.a2] });
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r)["animals"]).toBe(2);
  });
});

describe("ACEITE — mudança de estado entre a emissão e o aceite derruba tudo", () => {
  async function pendente() {
    const ac = await acervo();
    const destino = await lote(ORG, B, `TPD${Math.random().toString(36).slice(2, 8)}`);
    const r = await emitir({ batch_id: ac.lote, destination_batch_id: destino });
    expect(r.statusCode, r.body).toBe(201);
    return { id: String(j(r)["id"]), ...ac };
  }
  const empresaDo = async (id: string) => (await admin.query<{ empresa_id: string }>("select empresa_id from erp.animals where id=$1", [id])).rows[0]!.empresa_id;

  it("animal vendido depois da emissão: aceite falha por inteiro, nada se move", async () => {
    const t = await pendente();
    await admin.query("update erp.animals set status='sold' where id=$1", [t.a2]);
    const r = await post(tkB, `/api/livestock/transfers/${t.id}/process`, {});
    expect(r.statusCode, `aceite com animal inelegível não pode ter sucesso: ${r.body}`).toBeGreaterThanOrEqual(400);
    const m = await admin.query<{ status: string }>("select status from erp.animal_movements where id=$1", [t.id]);
    expect(m.rows[0]!.status, "a transferência continua pendente").toBe("pending");
    expect(await empresaDo(t.a1), "o animal íntegro NÃO pode ter sido movido sozinho").toBe(A);
    expect(await empresaDo(t.a2)).toBe(A);
    const hl = await admin.query<{ empresa_id: string }>("select empresa_id from erp.herd_lots where id=$1", [t.rebanho]);
    expect(hl.rows[0]!.empresa_id, "o rebanho também fica onde estava").toBe(A);
  });

  it("animal excluído depois da emissão: mesma atomicidade", async () => {
    const t = await pendente();
    await admin.query("update erp.animals set deleted_at=now() where id=$1", [t.a2]);
    const r = await post(tkB, `/api/livestock/transfers/${t.id}/process`, {});
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    const m = await admin.query<{ status: string }>("select status from erp.animal_movements where id=$1", [t.id]);
    expect(m.rows[0]!.status).toBe("pending");
    expect(await empresaDo(t.a1)).toBe(A);
  });

  it("nada mudando entre emissão e aceite, o aceite move as nove cabeças", async () => {
    const t = await pendente();
    const r = await post(tkB, `/api/livestock/transfers/${t.id}/process`, {});
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)["heads"]).toBe(9);
    expect(await empresaDo(t.a1)).toBe(B);
    expect(await empresaDo(t.a2)).toBe(B);
  });
});

describe("BANCO — a segunda linha de defesa, escrita direto na tabela", () => {
  /** Cria o documento pai da transferência pelo pool administrativo (sem RLS): o guard é de INTEGRIDADE. */
  async function pai(campos: Record<string, unknown> = {}): Promise<string> {
    const base = { organization_id: ORG, empresa_id: A, empresa_destino_id: B, movement_type: "farm_transfer", movement_date: "2031-04-01", code: `TPG${Math.random().toString(36).slice(2, 8)}`, status: "pending", ...campos };
    const cols = Object.keys(base); const vals = Object.values(base);
    return (await admin.query<{ id: string }>(`insert into erp.animal_movements(${cols.join(",")}) values (${vals.map((_, i) => `$${i + 1}`).join(",")}) returning id`, vals)).rows[0]!.id;
  }
  const item = (movimento: string, campos: Record<string, unknown>) => {
    const base = { movement_id: movimento, quantity: 1, ...campos };
    const cols = Object.keys(base); const vals = Object.values(base);
    return admin.query(`insert into erp.animal_movement_items(${cols.join(",")}) values (${vals.map((_, i) => `$${i + 1}`).join(",")})`, vals);
  };

  it("A. documento de O1 com batch_id de O2 é recusado pelo banco", async () => {
    await expect(pai({ batch_id: LOTE_X })).rejects.toThrow();
  });
  it("A2. documento de O1 com destination_batch_id de O2 é recusado", async () => {
    await expect(pai({ destination_batch_id: LOTE_X })).rejects.toThrow();
  });
  it("A3. lote de destino que é da ORIGEM (e não do destino) é recusado", async () => {
    const ac = await acervo();
    await expect(pai({ destination_batch_id: ac.lote })).rejects.toThrow();
  });
  it("B. item com animal de O2 é recusado", async () => {
    const m = await pai();
    await expect(item(m, { animal_id: ANIMAL_X })).rejects.toThrow();
  });
  it("C. item com animal do MESMO tenant mas da empresa B é recusado", async () => {
    const m = await pai();
    await expect(item(m, { animal_id: ANIMAL_B })).rejects.toThrow();
  });
  it("D. item com animal inativo ou excluído da própria origem é recusado", async () => {
    const m = await pai();
    const morto = await animal(ORG, A, null, { status: "dead" });
    const excluido = await animal(ORG, A, null);
    await admin.query("update erp.animals set deleted_at=now() where id=$1", [excluido]);
    await expect(item(m, { animal_id: morto })).rejects.toThrow();
    await expect(item(m, { animal_id: excluido })).rejects.toThrow();
  });
  it("E. item com animal válido da origem é ACEITO — o guard não fecha o caminho legítimo", async () => {
    const m = await pai(); const ac = await acervo();
    await item(m, { animal_id: ac.a1 });
    const n = await admin.query<{ n: string }>("select count(*)::text n from erp.animal_movement_items where movement_id=$1", [m]);
    expect(n.rows[0]!.n).toBe("1");
  });
  it("E2. o MESMO animal duas vezes na mesma transferência é recusado", async () => {
    const m = await pai(); const ac = await acervo();
    await item(m, { animal_id: ac.a1 });
    await expect(item(m, { animal_id: ac.a1 })).rejects.toThrow();
  });
  it("F. rebanho de O2 é recusado", async () => {
    const m = await pai();
    const hlx = (await admin.query<{ id: string }>("insert into erp.herd_lots(organization_id,empresa_id,batch_id,species_id,category_id,quantity,entry_date) values ($1,$2,$3,$4,$5,5,current_date) returning id", [ORG2, X, LOTE_X, ESP, CAT])).rows[0]!.id;
    await expect(item(m, { herd_lot_id: hlx, quantity: 5 })).rejects.toThrow();
  });
  it("G. rebanho da empresa B é recusado numa transferência que parte de A", async () => {
    const m = await pai();
    const hlb = (await admin.query<{ id: string }>("insert into erp.herd_lots(organization_id,empresa_id,batch_id,species_id,category_id,quantity,entry_date) values ($1,$2,$3,$4,$5,5,current_date) returning id", [ORG, B, LOTE_B, ESP, CAT])).rows[0]!.id;
    await expect(item(m, { herd_lot_id: hlb, quantity: 5 })).rejects.toThrow();
  });
  it("H. rebanho válido da origem com quantidade coerente é ACEITO; quantidade divergente é recusada", async () => {
    const m = await pai(); const ac = await acervo();
    await expect(item(m, { herd_lot_id: ac.rebanho, quantity: 3 })).rejects.toThrow();
    await item(m, { herd_lot_id: ac.rebanho, quantity: 7 });
    const n = await admin.query<{ n: string }>("select count(*)::text n from erp.animal_movement_items where movement_id=$1", [m]);
    expect(n.rows[0]!.n).toBe("1");
  });
  it("o guard é ESTREITO: outras movimentações pecuárias não sofrem o mesmo crivo", async () => {
    // `death` de um animal já morto é legítimo (é o documento que o registra) e não pode bater no guard.
    const m = await pai({ movement_type: "death", empresa_destino_id: null, status: "confirmed", code: `TPD${Math.random().toString(36).slice(2, 8)}` });
    const morto = await animal(ORG, A, null, { status: "dead" });
    await item(m, { animal_id: morto });
    // e um `purchase` referenciando animal de outra empresa do MESMO tenant também segue como antes
    const c = await pai({ movement_type: "purchase", empresa_destino_id: null, status: "confirmed", code: `TPP${Math.random().toString(36).slice(2, 8)}` });
    await item(c, { animal_id: ANIMAL_B });
    const n = await admin.query<{ n: string }>("select count(*)::text n from erp.animal_movement_items where movement_id in ($1,$2)", [m, c]);
    expect(n.rows[0]!.n, "movimentações fora da farm_transfer continuam com o comportamento legado").toBe("2");
  });
});
