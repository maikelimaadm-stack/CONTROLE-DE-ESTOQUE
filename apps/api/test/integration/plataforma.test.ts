import { AUTORIZACAO_PROPRIETARIO } from "@erp/plataforma";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";
import { atribuirIdGlobal, resolverRegistro } from "../../src/lib/id-global.js";
import type { ServiceCtx } from "../../src/lib/context.js";

/**
 * FUNDAÇÃO DE PLATAFORMA (PRE-BASE2-01): ID Global e preferência de idioma.
 *
 * O que precisa estar provado aqui:
 *  1. a sequência é única POR ORGANIZAÇÃO e compartilhada pelas empresas dela, atômica e idempotente;
 *  2. a resolução de `#N` respeita organização, empresa e — o ponto crítico — a PERMISSÃO DAQUELE REGISTRO,
 *     não a de uma tela vizinha que compartilha a mesma tabela;
 *  3. tudo o que é negado responde 404, nunca 403 (não revela existência).
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string } };

/** Contexto de serviço direto (as rotas de escrita só passam a alocar ID Global em PRE-BASE2-04). */
async function comoServico<T>(fn: (ctx: ServiceCtx) => Promise<T>, opts: { farmIds?: string[]; perms?: string[] } = {}): Promise<T> {
  return withTx(h.db, { orgId: h.demo.orgId, userId: h.demo.adminUserId }, (tx) =>
    fn({
      tx,
      user: { id: h.demo.adminUserId, email: h.demo.adminEmail, name: "Administrador" },
      orgId: h.demo.orgId,
      farmId: null,
      membership: { orgId: h.demo.orgId, orgName: "demo", roleId: null, isOwner: !opts.perms, memberId: "m", escopos: AUTORIZACAO_PROPRIETARIO },
      permissions: new Set(opts.perms ?? [])
    }));
}

const PERMS_BASE = ["animals.view", "input_entries.view", "products.view"];
async function membro(nome: string, email: string, farmIds: string[], perms: string[] = PERMS_BASE): Promise<Hdr> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Matriz@12345", role_id: j(papel).id, farm_ids: farmIds } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Matriz@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

const criar = async (url: string, payload: Record<string, unknown>): Promise<string> => {
  const r = await h.app.inject({ method: "POST", url, headers: h.headers(), payload });
  expect(r.statusCode, `${url}: ${r.body}`).toBe(201);
  return j(r).id as string;
};
/**
 * Movimentação criada direto no banco: usada para cobrir tipos que a rota de criação não aceita (internos) e
 * para mudar a empresa de um registro sem passar por regra de negócio.
 */
async function inserirMovimentacao(tipo: string, codigo: string, farmId?: string): Promise<string> {
  const admin = createPool(TEST_URL, { max: 1 });
  try {
    const r = await admin.query<{ id: string }>(
      "insert into erp.animal_movements(organization_id,farm_id,code,movement_type,movement_date,created_by) values ($1,$2,$3,$4,'2026-09-10',$5) returning id",
      [h.demo.orgId, farmId ?? I.farm, codigo, tipo, h.demo.adminUserId]);
    return r.rows[0]!.id;
  } finally { await admin.end(); }
}

const resolver = (idGlobal: number, headers: Hdr) => h.app.inject({ method: "GET", url: `/api/registros-globais/${idGlobal}`, headers });

beforeAll(async () => { h = await harness(); I = await ids(h); }, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("ID Global — alocação", () => {
  it("é sequencial por organização e compartilhado pelas empresas da organização", async () => {
    const a = await comoServico((ctx) => atribuirIdGlobal(ctx, "animals", I.animal!));
    const b = await comoServico((ctx) => atribuirIdGlobal(ctx, "products", I.product!));
    expect(b).toBe(a + 1);
    const entrada = await criar("/api/stock/input-entries", { farm_id: I.farm2, entry_date: "2026-09-01", items: [{ product_id: I.product, quantity: "5", unit_value: "2", warehouse_id: I.warehouseFarm2 }] });
    const c = await comoServico((ctx) => atribuirIdGlobal(ctx, "input_entries", entrada));
    expect(c).toBe(b + 1);
  });

  it("é idempotente: o mesmo registro nunca recebe dois ID Globais", async () => {
    const primeiro = await comoServico((ctx) => atribuirIdGlobal(ctx, "products", I.product2!));
    const denovo = await comoServico((ctx) => atribuirIdGlobal(ctx, "products", I.product2!));
    expect(denovo).toBe(primeiro);
  });

  it("sob concorrência não duplica nem colide (alocações simultâneas)", async () => {
    const admin = createPool(TEST_URL, { max: 12 });
    try {
      const linhas = await admin.query<{ id: string }>("select id from erp.people where organization_id=$1 order by code limit 10", [h.demo.orgId]);
      const alvos = linhas.rows.map((r) => r.id);
      expect(alvos.length).toBeGreaterThanOrEqual(5);
      const alocados = await Promise.all(alvos.map((id) => comoServico((ctx) => atribuirIdGlobal(ctx, "people", id))));
      expect(new Set(alocados).size).toBe(alvos.length);
      const dup = await admin.query<{ n: string }>("select count(*) n from (select id_global from erp.registros_globais where organization_id=$1 group by id_global having count(*)>1) x", [h.demo.orgId]);
      expect(Number(dup.rows[0]!.n)).toBe(0);
    } finally { await admin.end(); }
  });

  /**
   * MATRIZ C — a ponte global nunca aponta para o vazio. Entidade não elegível, registro inexistente e
   * variante sem tela canônica são recusados ANTES de consumir um número.
   */
  it("recusa entidade não elegível, registro inexistente e variante sem tela canônica", async () => {
    await expect(comoServico((ctx) => atribuirIdGlobal(ctx, "input_entry_items", I.product!))).rejects.toThrow(/sem ID Global/i);
    // UUID que não existe em lugar algum: nunca vira ponte
    await expect(comoServico((ctx) => atribuirIdGlobal(ctx, "animals", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"))).rejects.toThrow(/inexistente/i);
    // id de um animal usado como se fosse manejo: o registro não existe NAQUELA tabela
    await expect(comoServico((ctx) => atribuirIdGlobal(ctx, "animal_handlings", I.animal!))).rejects.toThrow(/inexistente/i);
    // registro real cujo tipo é INTERNO (efeito de outra operação): existe, mas não tem tela própria
    const interna = await inserirMovimentacao("inventory", "GID-INT1");
    await expect(comoServico((ctx) => atribuirIdGlobal(ctx, "animal_movements", interna))).rejects.toThrow(/movement_type/i);
    const admin = createPool(TEST_URL, { max: 1 });
    try {
      const r = await admin.query("select 1 from erp.registros_globais where organization_id=$1 and tipo_entidade='animal_movements' and id_entidade=$2", [h.demo.orgId, interna]);
      expect(r.rowCount, "movimentação interna não pode ter ponte global").toBe(0);
    } finally { await admin.end(); }
  });

  it("registro excluído deixa de ser navegável pelo ID Global (mesma existência da rota canônica)", async () => {
    const entrada = await criar("/api/stock/input-entries", { farm_id: I.farm, entry_date: "2026-09-03", items: [{ product_id: I.product, quantity: "1", unit_value: "2", warehouse_id: I.warehouse }] });
    const idGlobal = await comoServico((ctx) => atribuirIdGlobal(ctx, "input_entries", entrada));
    expect((await resolver(idGlobal, h.headers())).statusCode).toBe(200);
    const admin = createPool(TEST_URL, { max: 1 });
    try { await admin.query("update erp.input_entries set deleted_at=now() where id=$1", [entrada]); } finally { await admin.end(); }
    const depois = await resolver(idGlobal, h.headers());
    expect(depois.statusCode, depois.body).toBe(404);
    expect(j(depois).error?.code).toBe("NOT_FOUND");
  });

  it("grava a rota canônica resolvida a partir do registro", async () => {
    const admin = createPool(TEST_URL, { max: 1 });
    try {
      const r = await admin.query<{ rota_canonica: string; empresa_id: string | null; modulo: string }>(
        "select rota_canonica, empresa_id, modulo from erp.registros_globais where organization_id=$1 and tipo_entidade='animals' and id_entidade=$2", [h.demo.orgId, I.animal]);
      expect(r.rows[0]!.rota_canonica).toBe(`/pecuaria/animais/${I.animal}`);
      expect(r.rows[0]!.empresa_id).toBe(I.farm);
      expect(r.rows[0]!.modulo).toBe("pecuaria");
    } finally { await admin.end(); }
  });
});

describe("ID Global — resolução e escopo", () => {
  it("resolve #N no registro real, aceitando as duas grafias", async () => {
    const idGlobal = await comoServico((ctx) => atribuirIdGlobal(ctx, "animals", I.animal!));
    for (const caminho of [String(idGlobal), `%23${idGlobal}`]) {
      const r = await h.app.inject({ method: "GET", url: `/api/registros-globais/${caminho}`, headers: h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toMatchObject({ idGlobal, tipoEntidade: "animals", idEntidade: I.animal, rota: `/pecuaria/animais/${I.animal}`, modulo: "pecuaria" });
    }
  });

  it("ID Global inexistente ou inválido responde 404 (nunca 500)", async () => {
    for (const v of ["999999", "abc", "0", "-1"]) {
      const r = await h.app.inject({ method: "GET", url: `/api/registros-globais/${v}`, headers: h.headers() });
      expect(r.statusCode, `${v}: ${r.body}`).toBe(404);
      expect(j(r).error?.code).toBe("NOT_FOUND");
    }
  });

  it("não atravessa organizações: o mesmo número em outro tenant não vaza", async () => {
    const admin = createPool(TEST_URL, { max: 2 });
    try {
      const orgB = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Org Global','orgglobal') returning id")).rows[0]!.id;
      const alvo = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await admin.query("insert into erp.registros_globais(organization_id, id_global, tipo_entidade, id_entidade, modulo, rota_canonica) values ($1, 1, 'animals', $2, 'pecuaria', '/pecuaria/animais/x')", [orgB, alvo]);
      const r = await h.app.inject({ method: "GET", url: "/api/registros-globais/1", headers: h.headers() });
      expect(r.statusCode).toBe(200);
      expect(j(r).idEntidade).not.toBe(alvo);
    } finally { await admin.end(); }
  });

  it("respeita o escopo de empresa: registro de outra empresa responde 404", async () => {
    const entrada = await criar("/api/stock/input-entries", { farm_id: I.farm2, entry_date: "2026-09-02", items: [{ product_id: I.product, quantity: "3", unit_value: "2", warehouse_id: I.warehouseFarm2 }] });
    const idGlobal = await comoServico((ctx) => atribuirIdGlobal(ctx, "input_entries", entrada));
    const soEmpresaA = await membro("Empresa A", "empresa.a@demo.local", [I.farm!]);
    const negado = await resolver(idGlobal, soEmpresaA);
    expect(negado.statusCode, negado.body).toBe(404);
    expect(j(negado).error?.code).toBe("NOT_FOUND");
    expect((await resolver(idGlobal, h.headers())).statusCode).toBe(200);
  });

  it("resolução direta no serviço concorda com a rota HTTP", async () => {
    const idGlobal = await comoServico((ctx) => atribuirIdGlobal(ctx, "products", I.product!));
    const direto = await comoServico((ctx) => resolverRegistro(ctx, idGlobal));
    expect(direto).toMatchObject({ idGlobal, tipoEntidade: "products", idEntidade: I.product, empresaId: null });
  });

  it("rota canônica de cadastro abre em consulta (?view=1), não em edição", async () => {
    const idGlobal = await comoServico((ctx) => atribuirIdGlobal(ctx, "products", I.product!));
    const r = await resolver(idGlobal, h.headers());
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).rota).toBe(`/cadastros/products/${I.product}?view=1`);
  });
});

/**
 * MATRIZ DE PERMISSÃO POR VARIANTE — o defeito que esta correção fecha.
 * Uma tabela, telas diferentes, permissões diferentes: quem tem a permissão de UMA tela não pode resolver o
 * ID Global de OUTRA. Vale nos dois sentidos (não bloqueia quem tem a permissão certa, não libera quem não tem).
 */
describe("ID Global — permissão é do registro, não da tabela", () => {
  it("financeiro: conta a pagar e conta a receber exigem permissões distintas", async () => {
    const pagar = await criar("/api/financial/payables", { farm_id: I.farm, number: "GID-P1", person_id: I.provider, amount: "10.00", emission_date: "2026-09-10", due_date: "2026-10-10", note: "gid", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] });
    const receber = await criar("/api/financial/receivables", { farm_id: I.farm, number: "GID-R1", person_id: I.client, amount: "10.00", emission_date: "2026-09-10", due_date: "2026-10-10", note: "gid", apportionment: [{ financial_category_id: I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }] });
    const gidPagar = await comoServico((ctx) => atribuirIdGlobal(ctx, "financial_titles", pagar));
    const gidReceber = await comoServico((ctx) => atribuirIdGlobal(ctx, "financial_titles", receber));

    const soPagar = await membro("Só Pagar", "so.pagar@demo.local", [], ["payables.view"]);
    const soReceber = await membro("Só Receber", "so.receber@demo.local", [], ["receivables.view"]);

    expect((await resolver(gidPagar, soPagar)).statusCode).toBe(200);
    expect((await resolver(gidReceber, soPagar)).statusCode).toBe(404);
    expect((await resolver(gidReceber, soReceber)).statusCode).toBe(200);
    expect((await resolver(gidPagar, soReceber)).statusCode).toBe(404);

    // a rota resolvida é a da tela daquele registro
    expect(j(await resolver(gidPagar, soPagar)).rota).toBe(`/financeiro/contas-a-pagar/${pagar}`);
    expect(j(await resolver(gidReceber, soReceber)).rota).toBe(`/financeiro/contas-a-receber/${receber}`);
  });

  it("vendas: orçamento, pedido e venda exigem permissões distintas", async () => {
    const item = [{ product_id: I.product, warehouse_id: I.warehouse, quantity: "1", unit_price: "5" }];
    const docs: Record<string, string> = {
      budget: await criar("/api/sales/budgets", { farm_id: I.farm, document_date: "2026-09-10", client_id: I.client, items: item }),
      order: await criar("/api/sales/orders", { farm_id: I.farm, document_date: "2026-09-10", client_id: I.client, items: item }),
      sale: await criar("/api/sales/sales", { farm_id: I.farm, document_date: "2026-09-10", client_id: I.client, items: item })
    };
    const gid: Record<string, number> = {};
    for (const [tipo, id] of Object.entries(docs)) gid[tipo] = await comoServico((ctx) => atribuirIdGlobal(ctx, "sales_documents", id));

    const usuarios: Record<string, Hdr> = {
      budget: await membro("Só Orçamento", "so.orcamento@demo.local", [], ["budgets.view"]),
      order: await membro("Só Pedido", "so.pedido@demo.local", [], ["orders.view"]),
      sale: await membro("Só Venda", "so.venda@demo.local", [], ["sales.view"])
    };
    const rotas: Record<string, string> = { budget: "/vendas/budgets", order: "/vendas/orders", sale: "/vendas/sales" };
    for (const permitido of Object.keys(docs)) {
      for (const alvo of Object.keys(docs)) {
        const r = await resolver(gid[alvo]!, usuarios[permitido]!);
        expect(r.statusCode, `${permitido} → ${alvo}: ${r.body}`).toBe(permitido === alvo ? 200 : 404);
        if (permitido === alvo) expect(j(r).rota).toBe(`${rotas[alvo]}/${docs[alvo]}`);
      }
    }
  });

  it("pecuária: cada tipo de manejo exige a permissão do próprio tipo", async () => {
    const sanitario = await criar("/api/livestock/handlings", { farm_id: I.farm, handling_type: "sanitary", handling_date: "2026-09-10", batch_id: I.batch, dose: "1", items: [{ animal_id: I.animal, quantity: "1" }] });
    const nutricao = await criar("/api/livestock/handlings", { farm_id: I.farm, handling_type: "nutrition", handling_date: "2026-09-10", batch_id: I.batch, items: [{ animal_id: I.animal, quantity: "1" }] });
    const gidSanitario = await comoServico((ctx) => atribuirIdGlobal(ctx, "animal_handlings", sanitario));
    const gidNutricao = await comoServico((ctx) => atribuirIdGlobal(ctx, "animal_handlings", nutricao));

    const soSanitario = await membro("Só Sanitário", "so.sanitario@demo.local", [], ["sanitaries.view"]);
    const soNutricao = await membro("Só Nutrição", "so.nutricao@demo.local", [], ["nutritions.view"]);

    expect((await resolver(gidSanitario, soSanitario)).statusCode).toBe(200);
    expect((await resolver(gidNutricao, soSanitario)).statusCode).toBe(404);
    expect((await resolver(gidNutricao, soNutricao)).statusCode).toBe(200);
    expect((await resolver(gidSanitario, soNutricao)).statusCode).toBe(404);
    expect(j(await resolver(gidSanitario, soSanitario)).rota).toBe(`/pecuaria/manejo/sanitary/${sanitario}`);
  });

  it("pecuária: cada tipo de movimentação exige a permissão do próprio tipo", async () => {
    // Movimentações de tipos diferentes criadas direto no banco: o objeto do teste é a resolução do ID
    // Global por tipo, não o fluxo de criação (coberto pelos testes de pecuária).
    const admin = createPool(TEST_URL, { max: 2 });
    let venda: string; let nascimento: string;
    try {
      const insere = async (tipo: string, codigo: string) => (await admin.query<{ id: string }>(
        "insert into erp.animal_movements(organization_id,farm_id,code,movement_type,movement_date,created_by) values ($1,$2,$3,$4,'2026-09-10',$5) returning id",
        [h.demo.orgId, I.farm, codigo, tipo, h.demo.adminUserId])).rows[0]!.id;
      venda = await insere("sale", "GID-MV1");
      nascimento = await insere("birth", "GID-MV2");
    } finally { await admin.end(); }
    const gidVenda = await comoServico((ctx) => atribuirIdGlobal(ctx, "animal_movements", venda));
    const gidNascimento = await comoServico((ctx) => atribuirIdGlobal(ctx, "animal_movements", nascimento));

    const soVenda = await membro("Só Venda de Animais", "so.venda.animais@demo.local", [], ["animal_sales.view"]);
    const soNascimento = await membro("Só Nascimentos", "so.nascimentos@demo.local", [], ["animal_births.view"]);

    expect((await resolver(gidVenda, soVenda)).statusCode).toBe(200);
    expect((await resolver(gidNascimento, soVenda)).statusCode).toBe(404);
    expect((await resolver(gidNascimento, soNascimento)).statusCode).toBe(200);
    expect((await resolver(gidVenda, soNascimento)).statusCode).toBe(404);
    expect(j(await resolver(gidNascimento, soNascimento)).rota).toBe(`/pecuaria/movimentacoes/birth/${nascimento}`);
  });

  it("permissão de outra entidade não abre nada (sem OR genérico entre telas)", async () => {
    const idGlobal = await comoServico((ctx) => atribuirIdGlobal(ctx, "animals", I.animal!));
    const semAnimais = await membro("Sem Animais", "sem.animais@demo.local", [], ["products.view"]);
    expect((await resolver(idGlobal, semAnimais)).statusCode).toBe(404);
  });
});

/**
 * MATRIZ B — O ÍNDICE NÃO É A AUTORIDADE.
 * `erp.registros_globais.empresa_id` é índice denormalizado: quando o animal muda de empresa, ele envelhece.
 * A autorização precisa usar a empresa ATUAL do registro fonte — senão quem só tem acesso à empresa antiga
 * continuaria abrindo o registro, e quem tem acesso à empresa nova levaria 404.
 */
describe("ID Global — empresa vem do registro fonte, não do índice", () => {
  it("animal transferido de empresa passa a responder pela empresa NOVA", async () => {
    const animal = await criar("/api/livestock/animals", {
      farm_id: I.farm, species_id: (await comoServico(async (ctx) => (await ctx.tx.query<{ id: string }>("select id from erp.animal_species order by name limit 1")).rows[0]!.id)),
      category_id: I.speciesCategory, entry_date: "2026-09-01", sex: "M",
      identifications: [{ identification_type_id: I.idType, value: `GID-EMP-${Date.now()}`, is_primary: true }]
    });
    const idGlobal = await comoServico((ctx) => atribuirIdGlobal(ctx, "animals", animal));

    const soEmpresaA = await membro("Rebanho Empresa A", "rebanho.a@demo.local", [I.farm!], ["animals.view"]);
    const soEmpresaB = await membro("Rebanho Empresa B", "rebanho.b@demo.local", [I.farm2!], ["animals.view"]);
    expect((await resolver(idGlobal, soEmpresaA)).statusCode).toBe(200);
    expect((await resolver(idGlobal, soEmpresaB)).statusCode).toBe(404);

    // transferência: o índice global continua apontando para a empresa antiga de propósito
    const admin = createPool(TEST_URL, { max: 1 });
    try {
      await admin.query("update erp.animals set farm_id=$2 where id=$1", [animal, I.farm2]);
      const indice = await admin.query<{ empresa_id: string }>("select empresa_id from erp.registros_globais where organization_id=$1 and tipo_entidade='animals' and id_entidade=$2", [h.demo.orgId, animal]);
      expect(indice.rows[0]!.empresa_id, "o índice denormalizado deve mesmo estar desatualizado neste teste").toBe(I.farm);
    } finally { await admin.end(); }

    const depoisA = await resolver(idGlobal, soEmpresaA);
    expect(depoisA.statusCode, depoisA.body).toBe(404);
    const depoisB = await resolver(idGlobal, soEmpresaB);
    expect(depoisB.statusCode, depoisB.body).toBe(200);
    expect(j(depoisB).empresaId, "a resposta mostra a empresa ATUAL").toBe(I.farm2);
  });
});

describe("preferência de idioma", () => {
  it("organização nasce em pt-BR e o usuário herda quando não escolhe", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/plataforma/idioma", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ organizacao: "pt-BR", usuario: null, efetivo: "pt-BR" });
    expect(j(r).publicados).toEqual(["pt-BR"]);
  });

  it("usuário define e limpa o próprio idioma; limpar volta a seguir a organização", async () => {
    const define = await h.app.inject({ method: "PUT", url: "/api/plataforma/idioma", headers: h.headers(), payload: { idioma: "pt" } });
    expect(define.statusCode, define.body).toBe(200);
    expect(j(define)).toMatchObject({ usuario: "pt-BR", efetivo: "pt-BR" });
    const limpa = await h.app.inject({ method: "PUT", url: "/api/plataforma/idioma", headers: h.headers(), payload: { idioma: null } });
    expect(limpa.statusCode, limpa.body).toBe(200);
    expect(j(limpa).usuario).toBeNull();
  });

  it("idioma sem catálogo publicado é recusado (nunca grava preferência inválida)", async () => {
    const r = await h.app.inject({ method: "PUT", url: "/api/plataforma/idioma", headers: h.headers(), payload: { idioma: "ja-JP" } });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error?.code).toBe("VALIDATION_ERROR");
  });

  it("o contexto da organização informa o idioma efetivo para a interface", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/auth/context", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).idioma).toMatchObject({ organizacao: "pt-BR", efetivo: "pt-BR" });
  });
});
