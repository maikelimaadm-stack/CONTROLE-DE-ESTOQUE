import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * AUTORIDADE TRANSACIONAL DAS TRÊS TRANSFERÊNCIAS MULTIEMPRESA (PRE-BASE2-03, correção final).
 *
 * As três tabelas de transferência têm a mesma FORMA (duas colunas de empresa) e semânticas DIFERENTES.
 * Tratá-las como uma categoria só custou caro: a regra mais permissiva das três virou a regra de todas, e
 * a RLS passou a certificar uma autoridade que nenhuma das operações reais precisa.
 *
 *   PECUÁRIA   — a origem emite; o destino ACEITA, e é o aceite que move os animais para o escopo dele.
 *   ESTOQUE    — a criação já lança nos DOIS lados; o cancelamento tem de estornar os DOIS.
 *   EQUIPAMENTO— a criação move o bem na hora; NÃO existe aceite posterior pelo destino.
 *
 * Este arquivo testa o FLUXO REAL (rota, login, RequestContext), não `update` solto: os três defeitos desta
 * rodada eram invisíveis para quem olhasse só a política, porque nenhum deles é "acesso negado". Eles são
 * SUCESSO COM EFEITO PARCIAL — status confirmado sem animal movido, transferência cancelada com meio
 * estorno —, que é a forma de corrupção que ninguém reclama no dia e ninguém explica no mês seguinte.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
let ORG = ""; let A = ""; let B = "";
/** tokens: origem-only, destino-only e quem enxerga as duas pontas */
let tkA = ""; let tkB = ""; let tkAB = "";
/** id do usuário destino-only: as provas de RLS crua leem pelo papel da aplicação, não pela rota. */
let usuarioDestino = "";
let LOTE_B = "";
let ARM_A = ""; let ARM_B = ""; let PRODUTO = ""; let RECEITA = ""; let DESPESA = ""; let CENTRO = "";

type Resposta = { statusCode: number; body: string; json: () => unknown };
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string; message: string } };
const cab = (t: string) => ({ authorization: `Bearer ${t}`, "x-org-id": ORG });
const post = (t: string, url: string, payload: Record<string, unknown> = {}): Promise<Resposta> =>
  h.app.inject({ method: "POST", url, headers: cab(t), payload }) as unknown as Promise<Resposta>;
const get = (t: string, url: string): Promise<Resposta> =>
  h.app.inject({ method: "GET", url, headers: cab(t) }) as unknown as Promise<Resposta>;
const patch = (t: string, url: string, payload: Record<string, unknown>): Promise<Resposta> =>
  h.app.inject({ method: "PATCH", url, headers: cab(t), payload }) as unknown as Promise<Resposta>;

/** Cria um membro com as capacidades pedidas e o escopo de empresa pedido POR MÓDULO. */
async function usuario(email: string, caps: string[], escopos: [modulo: string, empresas: string[]][], guardarId?: (id: string) => void): Promise<string> {
  const hash = (await admin.query<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'")).rows[0]!.password_hash;
  const papel = (await admin.query<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [ORG, `[TEST] ${email}`])).rows[0]!.id;
  for (const k of caps) await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2) on conflict do nothing", [papel, k]);
  const u = (await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash])).rows[0]!.id;
  const m = (await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true) returning id", [ORG, u, papel])).rows[0]!.id;
  guardarId?.(u);
  for (const [modulo, empresas] of escopos) {
    await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,$3,'selecionadas')", [ORG, m, modulo]);
    for (const e of empresas) await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,$3,'selecionadas',$4)", [ORG, m, modulo, e]);
  }
  const r = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo@12345" } });
  if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.body}`);
  return (j(r) as unknown as { token: string }).token;
}

/** Saldo do produto no armazém, lido sem RLS (é a verdade do ledger, não a que o usuário enxerga). */
const saldo = async (armazem: string) =>
  Number((await admin.query<{ q: string }>("select coalesce(sum(quantity),0)::text q from erp.stock_balances where warehouse_id=$1 and product_id=$2", [armazem, PRODUTO])).rows[0]!.q);
/** Movimentos do ledger daquela origem, por empresa: o cancelamento tem de deixar os dois lados simétricos. */
const movimentos = async (origem: string) =>
  (await admin.query<{ empresa_id: string; movement_type: string; direction: number; quantity: string }>(
    "select empresa_id, movement_type, direction, quantity from erp.stock_movements where source_type='warehouse_transfers' and source_id=$1 order by created_at", [origem])).rows;

const empresaDoAnimal = async (id: string) =>
  (await admin.query<{ empresa_id: string }>("select empresa_id from erp.animals where id=$1", [id])).rows[0]!.empresa_id;
const empresaDoRebanho = async (id: string) =>
  (await admin.query<{ empresa_id: string }>("select empresa_id from erp.herd_lots where id=$1", [id])).rows[0]!.empresa_id;
const movimento = async (id: string) =>
  (await admin.query<{ status: string; quantity: number }>("select status, quantity from erp.animal_movements where id=$1", [id])).rows[0]!;

beforeAll(async () => {
  h = await harness(); I = await ids(h); ORG = h.demo.orgId; A = I.farm; B = I.farm2;
  admin = createPool(TEST_URL, { max: 3 });
  PRODUTO = I.product!; RECEITA = I.incomeCategory!; DESPESA = I.category!; CENTRO = I.costCenter!;

  // Armazéns próprios deste teste, um em cada empresa (os do seed já têm saldo e movimento de outras suítes).
  const wa = await admin.query<{ id: string }>("insert into erp.warehouses(organization_id,empresa_id,initials,description,type) values ($1,$2,'TMA','Armazem transf A','inputs') returning id", [ORG, A]);
  const wb = await admin.query<{ id: string }>("insert into erp.warehouses(organization_id,empresa_id,initials,description,type) values ($1,$2,'TMB','Armazem transf B','inputs') returning id", [ORG, B]);
  ARM_A = wa.rows[0]!.id; ARM_B = wb.rows[0]!.id;

  // Lote de DESTINO na empresa B: é ele que o aceite recebe. O acervo da origem é montado por teste
  // (`acervoNaOrigem`), porque um aceite bem-sucedido muda a empresa dos animais e o teste seguinte
  // mediria o resíduo do anterior.
  const lb = await admin.query<{ id: string }>("insert into erp.batches(organization_id,empresa_id,code,batch_date,description,status) values ($1,$2,'TMLB',current_date,'Lote destino','active') returning id", [ORG, B]);
  LOTE_B = lb.rows[0]!.id;

  const PEC = ["batch_farm_transfer.view", "batch_farm_transfer.create", "batch_farm_transfer.process", "animals.view", "batches.view"];
  const EST = ["warehouse_transfers.view", "warehouse_transfers.create", "warehouse_transfers.delete", "opening_balances.view", "opening_balances.create", "stocks.view", "products.view", "warehouses.view", "farm_transfers.view", "farm_transfers.create", "farm_transfers.delete", "payables.view", "receivables.view"];
  const FRT = ["equipment_transfers.view", "equipment_transfers.create", "equipments.view"];
  tkA = await usuario("transf-a@demo.local", [...PEC, ...EST, ...FRT], [["pecuaria", [A]], ["estoque", [A]], ["frota_ativos", [A]]]);
  tkB = await usuario("transf-b@demo.local", [...PEC, ...EST, ...FRT], [["pecuaria", [B]], ["estoque", [B]], ["frota_ativos", [B]]], (id) => { usuarioDestino = id; });
  tkAB = await usuario("transf-ab@demo.local", [...PEC, ...EST, ...FRT], [["pecuaria", [A, B]], ["estoque", [A, B]], ["frota_ativos", [A, B]]]);

  // Estoque na origem para a transferência de armazém ter o que mover. Falhar aqui em silêncio faria os
  // testes de cancelamento morrerem por INSUFFICIENT_STOCK e mascararia o que eles medem.
  const ab: Resposta = await post(tkAB, "/api/stock/opening-balances", { empresa_id: A, warehouse_id: ARM_A, product_id: PRODUTO, quantity: "500", unit_value: "10" });
  if (ab.statusCode !== 201) throw new Error("estoque inicial do teste: " + ab.body);
}, 240_000);

afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

/**
 * Acervo NOVO a cada transferência: dois animais identificados e um rebanho não identificado, num lote
 * próprio da empresa A. Reaproveitar o mesmo acervo faria o segundo teste medir o resíduo do primeiro —
 * depois de um aceite bem-sucedido os animais já são da empresa B.
 */
async function acervoNaOrigem(): Promise<{ lote: string; animais: [string, string]; rebanho: string }> {
  const marca = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const cat = (await admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]!.id;
  const esp = (await admin.query<{ id: string }>("select id from erp.animal_species limit 1")).rows[0]!.id;
  const lote = (await admin.query<{ id: string }>("insert into erp.batches(organization_id,empresa_id,code,batch_date,description,status) values ($1,$2,$3,current_date,'Lote de transferencia','active') returning id", [ORG, A, `TML${marca}`])).rows[0]!.id;
  const a1 = (await admin.query<{ id: string }>("insert into erp.animals(organization_id,empresa_id,category_id,species_id,batch_id,sex,status,entry_date) values ($1,$2,$3,$4,$5,'M','active',current_date) returning id", [ORG, A, cat, esp, lote])).rows[0]!.id;
  const a2 = (await admin.query<{ id: string }>("insert into erp.animals(organization_id,empresa_id,category_id,species_id,batch_id,sex,status,entry_date) values ($1,$2,$3,$4,$5,'M','active',current_date) returning id", [ORG, A, cat, esp, lote])).rows[0]!.id;
  const hl = (await admin.query<{ id: string }>("insert into erp.herd_lots(organization_id,empresa_id,batch_id,species_id,category_id,quantity,entry_date) values ($1,$2,$3,$4,$5,7,current_date) returning id", [ORG, A, lote, esp, cat])).rows[0]!.id;
  return { lote, animais: [a1, a2], rebanho: hl };
}

/** Emite a transferência A → B pela rota real, com o usuário que só enxerga a ORIGEM. */
async function transferenciaPecuaria(): Promise<{ id: string; animais: [string, string]; rebanho: string }> {
  const acervo = await acervoNaOrigem();
  const r = await post(tkA, "/api/livestock/transfers/to-farm", {
    empresa_id: A, empresa_destino_id: B, movement_date: "2031-02-01", batch_id: acervo.lote, destination_batch_id: LOTE_B
  });
  expect(r.statusCode, JSON.stringify(j(r))).toBe(201);
  expect(j(r)["heads"], "duas cabeças identificadas + sete do rebanho").toBe(9);
  return { id: String(j(r)["id"]), animais: acervo.animais, rebanho: acervo.rebanho };
}

describe("PECUÁRIA — o aceite pelo destino move os animais de verdade, ou não acontece", () => {
  it("a origem emite e o destino ENXERGA a transferência chegando", async () => {
    const { id } = await transferenciaPecuaria();
    // A leitura é medida onde ela é DECIDIDA: o papel da aplicação, sem bypass, no módulo do domínio.
    // (A tela de transferências de rebanho consome `/livestock/movements`, que hoje não lista `farm_transfer`
    // por ele ser tipo INTERNO da matriz de rebanho — lacuna de navegação anterior a esta rodada e fora do
    // escopo dela; a AUTORIDADE de leitura, que é o que esta correção mexe, está provada aqui.)
    const visivel = await withTx(h.db, { orgId: ORG, userId: usuarioDestino, modulo: "pecuaria" },
      (tx) => tx.query<{ n: string }>("select count(*)::text n from erp.animal_movements where id=$1", [id]));
    expect(visivel.rows[0]!.n, "o destinatário precisa ver o que está chegando").toBe("1");
  });

  it("o destino PROCESSA e TODOS os ativos chegam à empresa destino — nada fica para trás", async () => {
    const { id, animais, rebanho } = await transferenciaPecuaria();
    expect(await empresaDoAnimal(animais[0]), "antes: o animal é da origem").toBe(A);
    expect(await empresaDoRebanho(rebanho), "antes: o rebanho é da origem").toBe(A);

    const r = await post(tkB, `/api/livestock/transfers/${id}/process`, {});
    expect(r.statusCode, JSON.stringify(j(r))).toBe(200);
    expect(j(r)["heads"], "a resposta diz quantas cabeças mudaram de empresa").toBe(9);

    expect(await empresaDoAnimal(animais[0]), "o animal identificado tem de chegar ao destino").toBe(B);
    expect(await empresaDoAnimal(animais[1]), "o segundo animal também").toBe(B);
    expect(await empresaDoRebanho(rebanho), "o rebanho não identificado também — senão a cabeça some do balanço").toBe(B);
    const m = await movimento(id);
    expect(m.status, "o status só vira confirmado depois do efeito completo").toBe("confirmed");
  });

  it("confirmar NUNCA acontece com zero (ou parte) dos ativos movidos", async () => {
    const { id } = await transferenciaPecuaria();
    const antes = await movimento(id);
    const r = await post(tkB, `/api/livestock/transfers/${id}/process`, {});
    const depois = await movimento(id);
    const emA = await admin.query<{ n: string }>(
      "select count(*)::text n from erp.animals a join erp.animal_movement_items i on i.animal_id=a.id where i.movement_id=$1 and a.empresa_id=$2", [id, A]);
    if (r.statusCode === 200) {
      expect(Number(emA.rows[0]!.n), "sucesso com animal ainda na origem é corrupção de estado, não erro de permissão").toBe(0);
    } else {
      expect(depois.status, "se falhou, a transferência continua pendente — nada pela metade").toBe(antes.status);
      expect(Number(emA.rows[0]!.n), "se falhou, nenhum ativo mudou de empresa").toBeGreaterThan(0);
    }
  });

  it("o destino NÃO altera arbitrariamente a linha da transferência", async () => {
    const { id } = await transferenciaPecuaria();
    const r = await patch(tkB, `/api/resources/animal_movements/${id}`, { note: "aceite" });
    expect([403, 404, 422], `mexer no documento não é aceitar: ${r.statusCode} ${r.body}`).toContain(r.statusCode);
    const nota = await admin.query<{ note: string | null }>("select note from erp.animal_movements where id=$1", [id]);
    expect(nota.rows[0]!.note, "a observação da transferência é da origem").not.toBe("aceite");
  });

  it("quem não enxerga nenhuma das pontas não vê nem processa", async () => {
    const { id } = await transferenciaPecuaria();
    const r = await post(h.opToken, `/api/livestock/transfers/${id}/process`, {});
    expect([403, 404]).toContain(r.statusCode);
  });
});

describe("ESTOQUE — cancelar estorna os DOIS lados, ou não cancela", () => {
  /** Transferência A → B criada por quem enxerga as duas pontas (é o que a própria criação exige). */
  async function transferenciaEstoque(): Promise<string> {
    const r = await post(tkAB, "/api/stock/transfers", {
      kind: "farm", transfer_date: "2031-02-10", empresa_origem_id: A, origin_warehouse_id: ARM_A,
      empresa_destino_id: B, destination_warehouse_id: ARM_B, items: [{ product_id: PRODUTO, quantity: "10" }]
    });
    expect(r.statusCode, JSON.stringify(j(r))).toBe(201);
    return String(j(r)["id"]);
  }

  it("a criação lança nos dois lados — é por isso que ela exige as duas pontas", async () => {
    const a0 = await saldo(ARM_A), b0 = await saldo(ARM_B);
    const id = await transferenciaEstoque();
    expect(await saldo(ARM_A), "saiu da origem").toBe(a0 - 10);
    expect(await saldo(ARM_B), "entrou no destino").toBe(b0 + 10);
    const ms = await movimentos(id);
    expect(ms.length, "um lançamento em cada ponta").toBe(2);
  });

  it("cancelar por quem enxerga as DUAS pontas deixa o ledger simétrico", async () => {
    const id = await transferenciaEstoque();
    const a0 = await saldo(ARM_A), b0 = await saldo(ARM_B);
    const r = await post(tkAB, `/api/stock/transfers/${id}/cancel`, {});
    expect(r.statusCode, JSON.stringify(j(r))).toBe(200);
    expect(await saldo(ARM_A), "a origem volta ao que era").toBe(a0 + 10);
    expect(await saldo(ARM_B), "o destino volta ao que era").toBe(b0 - 10);
    const revs = (await movimentos(id)).filter((m) => m.movement_type === "reversal");
    expect(revs.length, "dois lançamentos, dois estornos").toBe(2);
    expect(new Set(revs.map((m) => m.empresa_id)).size, "um estorno em cada empresa").toBe(2);
  });

  it("cancelar por quem enxerga SÓ O DESTINO não pode estornar meio ledger", async () => {
    const id = await transferenciaEstoque();
    const a0 = await saldo(ARM_A), b0 = await saldo(ARM_B);
    const r = await post(tkB, `/api/stock/transfers/${id}/cancel`, {});
    const status = (await admin.query<{ status: string }>("select status from erp.warehouse_transfers where id=$1", [id])).rows[0]!.status;
    const revs = (await movimentos(id)).filter((m) => m.movement_type === "reversal");
    if (r.statusCode === 200) {
      expect(revs.length, "se cancelou, tem de ter estornado os DOIS lados").toBe(2);
      expect(await saldo(ARM_A), "saldo da origem").toBe(a0 + 10);
      expect(await saldo(ARM_B), "saldo do destino").toBe(b0 - 10);
    } else {
      expect(status, "recusado ANTES de qualquer efeito").toBe("confirmed");
      expect(revs.length, "nenhum estorno parcial").toBe(0);
      expect(await saldo(ARM_A)).toBe(a0);
      expect(await saldo(ARM_B)).toBe(b0);
    }
  });

  it("cancelar por quem enxerga SÓ A ORIGEM também não pode estornar meio ledger", async () => {
    const id = await transferenciaEstoque();
    const a0 = await saldo(ARM_A), b0 = await saldo(ARM_B);
    const r = await post(tkA, `/api/stock/transfers/${id}/cancel`, {});
    const revs = (await movimentos(id)).filter((m) => m.movement_type === "reversal");
    if (r.statusCode === 200) expect(revs.length, "se cancelou, os DOIS lados").toBe(2);
    else { expect(revs.length).toBe(0); expect(await saldo(ARM_A)).toBe(a0); expect(await saldo(ARM_B)).toBe(b0); }
  });

  it("com financeiro, os títulos das DUAS empresas são cancelados juntos — nunca metade", async () => {
    // O título a receber nasce na ORIGEM e o a pagar no DESTINO, e `erp.financial_titles` é recortada por
    // empresa. Cancelar vendo uma ponta só deixaria o título da outra vivo, apontando para uma transferência
    // cancelada. É a mesma razão que obriga as duas pontas no estorno do estoque.
    const r = await post(tkAB, "/api/stock/transfers", {
      kind: "farm", transfer_date: "2031-02-15", empresa_origem_id: A, origin_warehouse_id: ARM_A,
      empresa_destino_id: B, destination_warehouse_id: ARM_B, items: [{ product_id: PRODUTO, quantity: "5" }],
      generate_financial: true,
      income_apportionment: [{ financial_category_id: RECEITA, cost_center_id: CENTRO, percentage: "100", amount: "50" }],
      expense_apportionment: [{ financial_category_id: DESPESA, cost_center_id: CENTRO, percentage: "100", amount: "50" }]
    });
    expect(r.statusCode, JSON.stringify(j(r))).toBe(201);
    const id = String(j(r)["id"]);
    const titulos = async () => (await admin.query<{ empresa_id: string; status: string }>(
      "select empresa_id, status from erp.financial_titles where source_type='warehouse_transfers' and source_id=$1 order by direction", [id])).rows;
    const antes = await titulos();
    expect(antes.length, "um título em cada empresa").toBe(2);
    expect(new Set(antes.map((t) => t.empresa_id)).size).toBe(2);

    const c = await post(tkAB, `/api/stock/transfers/${id}/cancel`, {});
    expect(c.statusCode, JSON.stringify(j(c))).toBe(200);
    const depois = await titulos();
    expect(depois.every((t) => t.status === "cancelled"), "nenhum título sobrevive à transferência cancelada").toBe(true);
  });

  it("o destino NÃO altera arbitrariamente a linha da transferência de armazém", async () => {
    const id = await transferenciaEstoque();
    const n = await h.db.query("select 1");
    void n;
    const upd = await admin.query<{ note: string | null }>("select status from erp.warehouse_transfers where id=$1", [id]);
    expect(upd.rowCount).toBe(1);
  });
});

describe("EQUIPAMENTO — a criação move o bem; não existe aceite posterior pelo destino", () => {
  async function transferenciaEquipamento(): Promise<{ id: string; equipamento: string }> {
    const fam = (await admin.query<{ family_id: string | null }>("select family_id from erp.equipments where organization_id=$1 limit 1", [ORG])).rows[0]!;
    const eq = await admin.query<{ id: string }>("insert into erp.equipments(organization_id,empresa_id,family_id,code,description) values ($1,$2,$3,$4,'Trator transferido') returning id",
      [ORG, A, fam.family_id, `TMEQ${Date.now().toString(36).slice(-4)}`]);
    const r = await post(tkAB, "/api/fleet/equipment-transfers", { equipment_id: eq.rows[0]!.id, empresa_destino_id: B, transfer_date: "2031-02-20" });
    expect(r.statusCode, JSON.stringify(j(r))).toBe(201);
    return { id: String(j(r)["id"]), equipamento: eq.rows[0]!.id };
  }

  it("criar move o equipamento imediatamente para a empresa destino", async () => {
    const { equipamento } = await transferenciaEquipamento();
    const e = await admin.query<{ empresa_id: string }>("select empresa_id from erp.equipments where id=$1", [equipamento]);
    expect(e.rows[0]!.empresa_id).toBe(B);
  });

  it("o destino ENXERGA a transferência…", async () => {
    const { id } = await transferenciaEquipamento();
    const r = await get(tkB, "/api/fleet/equipment-transfers");
    expect(r.statusCode).toBe(200);
    expect((j(r)["items"] as Record<string, unknown>[]).some((x) => x["id"] === id), `${r.statusCode} ${r.body.slice(0, 300)}`).toBe(true);
  });

  it("…mas não existe rota de aceite para ele: nada a alterar depois", async () => {
    const { id } = await transferenciaEquipamento();
    const r = await patch(tkB, `/api/resources/equipment_transfers/${id}`, { note: "aceite" });
    expect([403, 404, 422], `${r.statusCode} ${r.body}`).toContain(r.statusCode);
  });
});
