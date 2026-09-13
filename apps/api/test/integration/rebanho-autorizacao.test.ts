import { AUTORIZACAO_PROPRIETARIO } from "@erp/plataforma";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx } from "@agro/db";
import { MOVIMENTACOES_INTERNAS, MOVIMENTACOES_REBANHO } from "@agro/domain";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";
import { atribuirIdGlobal } from "../../src/lib/id-global.js";
import type { ServiceCtx } from "../../src/lib/context.js";

/**
 * MATRIZES D, E, F e G — UMA PERMISSÃO POR TIPO DE MOVIMENTAÇÃO.
 *
 * `erp.animal_movements` guarda compra, venda, nascimento, morte e perda — cada uma com a sua tela e a sua
 * permissão — mais os tipos INTERNOS, que são efeito de outra operação e não têm porta própria. Antes desta
 * correção as três portas (detalhe, listagem, criação) usavam `animal_sales.*` fixo: quem tinha venda via
 * morte e perda de todo o rebanho, e quem tinha só nascimento não via nada.
 *
 * O que precisa estar provado: detalhe por tipo (D); listagem devolvendo só o que o usuário pode ver, com
 * total/contagem coerentes (E); criação por tipo, com `animal_sales.create` NÃO criando compra, nascimento,
 * morte nem perda (F); e anexos fail-closed para tipo interno/desconhecido (G).
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string } };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString("base64");

async function membro(nome: string, email: string, perms: string[], farmIds: string[] = []): Promise<Hdr> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Rebanho@12345", role_id: j(papel).id, farm_ids: farmIds } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Rebanho@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

/** Movimentação gravada direto no banco: cobre tipos que a rota de criação (corretamente) não aceita. */
async function inserir(tipo: string, codigo: string): Promise<string> {
  const admin = createPool(TEST_URL, { max: 1 });
  try {
    const r = await admin.query<{ id: string }>(
      "insert into erp.animal_movements(organization_id,farm_id,code,movement_type,movement_date,created_by) values ($1,$2,$3,$4,'2026-09-11',$5) returning id",
      [h.demo.orgId, I.farm, codigo, tipo, h.demo.adminUserId]);
    return r.rows[0]!.id;
  } finally { await admin.end(); }
}

/** Contexto de serviço direto (alocar ID Global fora de rota: as escritas só passam a alocar em PRE-BASE2-04). */
async function comoServico<T>(fn: (ctx: ServiceCtx) => Promise<T>): Promise<T> {
  return withTx(h.db, { orgId: h.demo.orgId, userId: h.demo.adminUserId }, (tx) =>
    fn({
      tx,
      user: { id: h.demo.adminUserId, email: h.demo.adminEmail, name: "Administrador" },
      orgId: h.demo.orgId, farmId: null,
      membership: { orgId: h.demo.orgId, orgName: "demo", roleId: null, isOwner: true, memberId: "m", escopos: AUTORIZACAO_PROPRIETARIO },
      permissions: new Set<string>()
    }));
}

const TIPOS = MOVIMENTACOES_REBANHO.map((o) => o.tipo);
const registro: Record<string, string> = {};
const usuario: Record<string, Hdr> = {};
let internas: Record<string, string> = {};

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  for (const o of MOVIMENTACOES_REBANHO) {
    registro[o.tipo] = await inserir(o.tipo, `MTX-${o.tipo.toUpperCase()}`);
    usuario[o.tipo] = await membro(`Só ${o.tipo}`, `mtx.${o.tipo}@demo.local`, [`${o.recurso}.view`, `${o.recurso}.create`, "attachments.view", "attachments.create"]);
  }
  internas = Object.fromEntries(await Promise.all(MOVIMENTACOES_INTERNAS.map(async (t) => [t, await inserir(t, `MTX-INT-${t}`)] as const)));
}, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

const detalhe = (id: string, hd: Hdr) => h.app.inject({ method: "GET", url: `/api/livestock/movements/${id}`, headers: hd });
const listar = (hd: Hdr, qs = "") => h.app.inject({ method: "GET", url: `/api/livestock/movements${qs}`, headers: hd });

describe("MATRIZ D — detalhe de movimentação por tipo", () => {
  it("cada usuário abre SÓ o seu tipo; os demais respondem 404 (nunca 403)", async () => {
    for (const permitido of TIPOS) {
      for (const alvo of TIPOS) {
        const r = await detalhe(registro[alvo]!, usuario[permitido]!);
        expect(r.statusCode, `${permitido} → ${alvo}: ${r.body}`).toBe(permitido === alvo ? 200 : 404);
        if (permitido !== alvo) expect(j(r).error?.code).toBe("NOT_FOUND");
      }
    }
  });
  it("venda de animais NÃO abre morte, perda, compra nem nascimento", async () => {
    for (const alvo of TIPOS.filter((t) => t !== "sale")) {
      expect((await detalhe(registro[alvo]!, usuario["sale"]!)).statusCode, alvo).toBe(404);
    }
  });
  it("movimentação interna não é acessível por esta porta, nem para quem tem tudo", async () => {
    for (const [tipo, id] of Object.entries(internas)) {
      const r = await detalhe(id, h.headers());
      expect(r.statusCode, `${tipo}: ${r.body}`).toBe(404);
      expect(j(r).error?.code).toBe("NOT_FOUND");
    }
  });
});

describe("MATRIZ E — listagem devolve só o que o usuário pode ver", () => {
  it("cada usuário vê apenas linhas do seu tipo, e o total conta só essas linhas", async () => {
    for (const tipo of TIPOS) {
      const r = await listar(usuario[tipo]!, "?pageSize=200");
      expect(r.statusCode, r.body).toBe(200);
      const body = j(r);
      const tipos = new Set((body.items ?? []).map((x) => String(x["movement_type"])));
      expect([...tipos], tipo).toEqual([tipo]);
      expect(body.total, `${tipo}: total deve contar só as linhas autorizadas`).toBe((body.items ?? []).length);
      expect((body.items ?? []).some((x) => x["id"] === registro[tipo]), tipo).toBe(true);
    }
  });
  it("nenhuma listagem expõe movimentação interna", async () => {
    const r = await listar(h.headers(), "?pageSize=500");
    const ids = new Set((j(r).items ?? []).map((x) => String(x["id"])));
    for (const [tipo, id] of Object.entries(internas)) expect(ids.has(id), tipo).toBe(false);
  });
  it("filtro por tipo não autorizado devolve página vazia (não 403, não vazamento)", async () => {
    const r = await listar(usuario["sale"]!, "?movement_type=death");
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).items).toEqual([]);
    expect(j(r).total).toBe(0);
  });
  it("sem nenhuma permissão de movimentação a lista é vazia, com paginação coerente", async () => {
    const nenhum = await membro("Sem Rebanho", "mtx.sem@demo.local", ["animals.view"]);
    const r = await listar(nenhum, "?page=1&pageSize=25");
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ items: [], total: 0, page: 1, pageSize: 25 });
  });
  it("quem vê dois tipos vê os dois — e a soma bate com as listas individuais", async () => {
    const dois = await membro("Venda e Morte", "mtx.dois@demo.local", ["animal_sales.view", "animal_deaths.view"]);
    const r = j(await listar(dois, "?pageSize=200"));
    const tipos = new Set((r.items ?? []).map((x) => String(x["movement_type"])));
    expect([...tipos].sort()).toEqual(["death", "sale"]);
    const venda = j(await listar(usuario["sale"]!, "?pageSize=200")).total as number;
    const morte = j(await listar(usuario["death"]!, "?pageSize=200")).total as number;
    expect(r.total).toBe(venda + morte);
  });
});

describe("MATRIZ F — criação de movimentação por tipo", () => {
  const corpo = (tipo: string): Record<string, unknown> => tipo === "purchase" || tipo === "birth"
    ? { farm_id: I.farm, movement_type: tipo, movement_date: "2026-09-12", person_id: tipo === "purchase" ? I.provider : null, items: [{ category_id: I.speciesCategory, quantity: 1, weight: "200", unit_value: "100" }] }
    : { farm_id: I.farm, movement_type: tipo, movement_date: "2026-09-12", items: [{ category_id: I.speciesCategory, quantity: 1, weight: "200", unit_value: "100", herd_lot_id: null }] };

  it("animal_sales.create NÃO cria compra, nascimento, morte nem perda", async () => {
    const soVenda = await membro("Cria Só Venda", "mtx.cria.venda@demo.local", ["animal_sales.create"]);
    for (const tipo of TIPOS.filter((t) => t !== "sale")) {
      const r = await h.app.inject({ method: "POST", url: "/api/livestock/movements", headers: soVenda, payload: corpo(tipo) });
      expect(r.statusCode, `${tipo}: ${r.body}`).toBe(403);
      expect(j(r).error?.code).toBe("PERMISSION_DENIED");
    }
  });
  it("quem tem a permissão do tipo passa da porta (a falha, se houver, é de regra de negócio, não de autorização)", async () => {
    for (const tipo of TIPOS) {
      const r = await h.app.inject({ method: "POST", url: "/api/livestock/movements", headers: usuario[tipo]!, payload: corpo(tipo) });
      expect(r.statusCode, `${tipo}: ${r.body}`).not.toBe(403);
    }
  });
  it("tipo interno é recusado pelo schema da rota (não existe porta de criação para efeito de outra operação)", async () => {
    for (const tipo of MOVIMENTACOES_INTERNAS) {
      const r = await h.app.inject({ method: "POST", url: "/api/livestock/movements", headers: h.headers(), payload: corpo(tipo) });
      expect([400, 404, 422], `${tipo}: ${r.statusCode}`).toContain(r.statusCode);
    }
  });
  it("cancelamento exige a permissão de exclusão DO TIPO", async () => {
    const cancelar = (id: string, hd: Hdr) => h.app.inject({ method: "POST", url: `/api/livestock/movements/${id}/cancel`, headers: hd });
    const soVendaDelete = await membro("Cancela Venda", "mtx.cancela.venda@demo.local", ["animal_sales.delete"]);
    expect((await cancelar(registro["death"]!, soVendaDelete)).statusCode, "venda não cancela morte").toBe(403);
    for (const [tipo, id] of Object.entries(internas)) expect((await cancelar(id, h.headers())).statusCode, tipo).toBe(404);
    expect((await cancelar(registro["sale"]!, soVendaDelete)).statusCode).toBe(200);
  });
});

describe("MATRIZ G — anexos fail-closed por tipo", () => {
  const anexar = (entity: string, id: string, hd: Hdr) => h.app.inject({ method: "POST", url: "/api/attachments", headers: hd, payload: { entity, entity_id: id, file_name: "x.pdf", mime_type: "application/pdf", data_base64: PDF } });
  const listarAnexos = (entity: string, id: string, hd: Hdr) => h.app.inject({ method: "GET", url: `/api/attachments?entity=${entity}&entity_id=${id}`, headers: hd });

  it("anexo de movimentação exige a permissão do tipo do registro", async () => {
    for (const permitido of TIPOS) {
      for (const alvo of TIPOS) {
        const r = await listarAnexos("animal_movements", registro[alvo]!, usuario[permitido]!);
        expect(r.statusCode, `${permitido} → ${alvo}: ${r.body}`).toBe(permitido === alvo ? 200 : 403);
      }
    }
  });
  it("movimentação de tipo interno não aceita anexo nem lista anexo, nem para quem tem tudo", async () => {
    for (const [tipo, id] of Object.entries(internas)) {
      expect((await listarAnexos("animal_movements", id, h.headers())).statusCode, `list ${tipo}`).toBe(404);
      expect((await anexar("animal_movements", id, h.headers())).statusCode, `create ${tipo}`).toBe(404);
    }
  });
  it("manejo de tipo desconhecido (gravado fora da rota) também é fail-closed", async () => {
    const admin = createPool(TEST_URL, { max: 1 });
    let manejo = "";
    try {
      // o CHECK do banco protege a coluna; aqui o alvo é um id que não existe na tabela de manejos
      manejo = (await admin.query<{ id: string }>("select gen_random_uuid() id")).rows[0]!.id;
    } finally { await admin.end(); }
    expect((await listarAnexos("animal_handlings", manejo, h.headers())).statusCode).toBe(404);
  });
});

/**
 * EXISTÊNCIA FUNCIONAL — uma regra só para `erp.animal_movements`.
 *
 * Lista, detalhe, cancelamento, anexos e ID Global precisam concordar: registro com `deleted_at` preenchido
 * é INEXISTENTE por todas essas portas. Cancelado é outra coisa — `status='cancelled'` com `deleted_at` nulo
 * continua existindo e continua consultável conforme a permissão do tipo.
 */
describe("exclusão lógica da movimentação: todas as portas concordam", () => {
  const marcarExcluida = async (id: string) => {
    const admin = createPool(TEST_URL, { max: 1 });
    try { await admin.query("update erp.animal_movements set deleted_at=now() where id=$1", [id]); } finally { await admin.end(); }
  };
  const anexos = (id: string, hd: Hdr) => h.app.inject({ method: "GET", url: `/api/attachments?entity=animal_movements&entity_id=${id}`, headers: hd });
  const naLista = async (id: string, hd: Hdr) => {
    const r = await h.app.inject({ method: "GET", url: "/api/livestock/movements?pageSize=500", headers: hd });
    return (j(r).items ?? []).some((x) => x["id"] === id);
  };

  it("antes da exclusão o registro existe em todas as portas; depois, nenhuma o enxerga", async () => {
    const id = await inserir("sale", `MTX-DEL-${Date.now()}`);
    const idGlobal = await comoServico((ctx) => atribuirIdGlobal(ctx, "animal_movements", id));
    const hd = h.headers();

    expect(await naLista(id, hd), "lista antes").toBe(true);
    expect((await detalhe(id, hd)).statusCode, "detalhe antes").toBe(200);
    expect((await anexos(id, hd)).statusCode, "anexos antes").toBe(200);
    expect((await h.app.inject({ method: "GET", url: `/api/registros-globais/${idGlobal}`, headers: hd })).statusCode, "ID Global antes").toBe(200);

    await marcarExcluida(id);

    expect(await naLista(id, hd), "lista depois").toBe(false);
    for (const [porta, r] of [
      ["detalhe", await detalhe(id, hd)],
      ["cancelamento", await h.app.inject({ method: "POST", url: `/api/livestock/movements/${id}/cancel`, headers: hd })],
      ["anexos", await anexos(id, hd)],
      ["ID Global", await h.app.inject({ method: "GET", url: `/api/registros-globais/${idGlobal}`, headers: hd })]
    ] as const) {
      expect(r.statusCode, `${porta} depois da exclusão: ${r.body}`).toBe(404);
      expect(j(r).error?.code, porta).toBe("NOT_FOUND");
    }
  });

  it("CANCELADO NÃO É EXCLUÍDO: continua na lista, no detalhe, nos anexos e no ID Global", async () => {
    const id = await inserir("sale", `MTX-CANC-${Date.now()}`);
    const idGlobal = await comoServico((ctx) => atribuirIdGlobal(ctx, "animal_movements", id));
    const hd = h.headers();
    const cancelado = await h.app.inject({ method: "POST", url: `/api/livestock/movements/${id}/cancel`, headers: hd });
    expect(cancelado.statusCode, cancelado.body).toBe(200);

    expect(await naLista(id, hd), "lista").toBe(true);
    const det = await detalhe(id, hd);
    expect(det.statusCode, det.body).toBe(200);
    expect(j(det)["status"]).toBe("cancelled");
    expect((await anexos(id, hd)).statusCode, "anexos").toBe(200);
    expect((await h.app.inject({ method: "GET", url: `/api/registros-globais/${idGlobal}`, headers: hd })).statusCode, "ID Global").toBe(200);
  });
});
