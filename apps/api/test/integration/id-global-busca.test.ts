import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * BUSCA POR ID GLOBAL — SEGURANÇA (PRE-BASE2-04).
 *
 * `#55` é um atalho, e atalho é onde a autorização costuma vazar: o número é curto, adivinhável e existe em
 * toda organização. Por isso a resolução NÃO confia no índice — ela carrega o registro fonte vivo e decide
 * por ele: organização, empresa ATUAL, permissão DAQUELE registro e existência.
 *
 * ANTI-ENUMERAÇÃO é requisito: número inexistente, número de outro tenant, empresa fora do escopo, falta de
 * capacidade e registro excluído têm de responder EXATAMENTE a mesma coisa. Um 403 onde os outros dão 404 já
 * conta "este número existe, só não é seu" — e isso basta para mapear o acervo alheio contando respostas.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { id?: string; error?: { code: string; message: string } };
const resolver = (n: number | string, headers: Hdr) => h.app.inject({ method: "GET", url: `/api/registros-globais/${n}`, headers });
const reverso = (tipo: string, id: string, headers: Hdr) => h.app.inject({ method: "GET", url: `/api/registros-globais/entidade/${tipo}/${id}`, headers });
/** Superfície PÚBLICA da negativa: é ela que não pode distinguir os motivos. */
const superficie = (r: { statusCode: number; json: () => unknown }) => ({ status: r.statusCode, code: j(r).error?.code, message: j(r).error?.message });

async function membro(nome: string, email: string, empresas: string[], perms: string[]): Promise<Hdr> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Busca@12345", role_id: j(papel).id, empresa_ids: empresas } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Busca@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}
const idGlobalDe = async (tipo: string, id: string): Promise<number> =>
  Number((await admin.query<{ id_global: string }>("select id_global from erp.registros_globais where organization_id=$1 and tipo_entidade=$2 and id_entidade=$3", [h.demo.orgId, tipo, id])).rows[0]!.id_global);

let ANIMAL_A = ""; let GID_ANIMAL = 0; let PAGAR = ""; let GID_PAGAR = 0; let RECEBER = ""; let GID_RECEBER = 0;
let hdrA: Hdr; let hdrB: Hdr; let hdrSemCapacidade: Hdr;

beforeAll(async () => {
  h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 2 });
  const esp = (await admin.query<{ species_id: string }>("select species_id from erp.animals limit 1")).rows[0]!.species_id;
  const cat = (await admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]!.id;
  const criarAnimal = await h.app.inject({ method: "POST", url: "/api/livestock/animals", headers: h.headers(),
    payload: { empresa_id: I.farm, species_id: esp, category_id: cat, entry_date: "2031-03-01", sex: "M", identifications: [{ identification_type_id: I.idType, value: "BUSCA-1", is_primary: true }] } });
  expect(criarAnimal.statusCode, criarAnimal.body).toBe(201);
  ANIMAL_A = String(j(criarAnimal).id); GID_ANIMAL = await idGlobalDe("animals", ANIMAL_A);

  const p = await h.app.inject({ method: "POST", url: "/api/financial/payables", headers: h.headers(),
    payload: { empresa_id: I.farm, number: "BUSCA-P", person_id: I.provider, amount: "10", emission_date: "2031-03-01", due_date: "2031-04-01", note: "busca", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] } });
  expect(p.statusCode, p.body).toBe(201); PAGAR = String(j(p).id); GID_PAGAR = await idGlobalDe("financial_titles", PAGAR);
  const rc = await h.app.inject({ method: "POST", url: "/api/financial/receivables", headers: h.headers(),
    payload: { empresa_id: I.farm, number: "BUSCA-R", person_id: I.client, amount: "10", emission_date: "2031-03-01", due_date: "2031-04-01", note: "busca", apportionment: [{ financial_category_id: I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }] } });
  expect(rc.statusCode, rc.body).toBe(201); RECEBER = String(j(rc).id); GID_RECEBER = await idGlobalDe("financial_titles", RECEBER);

  hdrA = await membro("Busca A", "busca-a@demo.local", [I.farm], ["animals.view", "payables.view", "receivables.view"]);
  hdrB = await membro("Busca B", "busca-b@demo.local", [I.farm2], ["animals.view", "payables.view", "receivables.view"]);
  hdrSemCapacidade = await membro("Busca sem capacidade", "busca-sc@demo.local", [I.farm], ["products.view"]);
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("resolução de #N — o caminho feliz", () => {
  it("devolve o registro com rota canônica, módulo e rótulo — e a rota contém o UUID, não o número", async () => {
    const r = await resolver(GID_ANIMAL, hdrA);
    expect(r.statusCode, r.body).toBe(200);
    const b = j(r);
    expect(b["idGlobal"]).toBe(GID_ANIMAL);
    expect(b["tipoEntidade"]).toBe("animals");
    expect(b["rotulo"]).toBe("Animal");
    expect(b["modulo"]).toBe("pecuaria");
    expect(b["idEntidade"]).toBe(ANIMAL_A);
    expect(b["rota"], "a URL final é a rota canônica com o UUID — #N é localizador, não endereço").toBe(`/pecuaria/animais/${ANIMAL_A}`);
    expect(String(b["rota"]), "o número NUNCA vira URL").not.toContain(`/${GID_ANIMAL}`);
  });

  it("aceita `#55`, `55` e `ID 55` na própria rota", async () => {
    for (const forma of [String(GID_ANIMAL), `%23${GID_ANIMAL}`, `ID%20${GID_ANIMAL}`, `id%20${GID_ANIMAL}`]) {
      const r = await resolver(forma, hdrA);
      expect(r.statusCode, `forma ${forma}: ${r.body}`).toBe(200);
      expect(j(r)["idEntidade"]).toBe(ANIMAL_A);
    }
  });

  it("formatos inválidos não viram busca — e respondem como qualquer outra negativa", async () => {
    for (const invalido of ["0", "-1", "abc", "%23abc", "55abc", "ID", "1.2", "%230"]) {
      const r = await resolver(invalido, hdrA);
      expect(r.statusCode, `"${invalido}" não é ID Global`).toBe(404);
      expect(j(r).error?.code).toBe("NOT_FOUND");
    }
  });

  it("VARIANTE: a pagar e a receber resolvem para telas e permissões DIFERENTES", async () => {
    const so = await membro("Só a pagar", "busca-pagar@demo.local", [I.farm], ["payables.view"]);
    const pagar = await resolver(GID_PAGAR, so);
    expect(pagar.statusCode, pagar.body).toBe(200);
    expect(j(pagar)["rota"]).toBe(`/financeiro/contas-a-pagar/${PAGAR}`);
    const receber = await resolver(GID_RECEBER, so);
    expect(receber.statusCode, "quem só tem payables.view NÃO abre um recebível").toBe(404);
    expect(superficie(receber), "e a negativa é idêntica à de um número inexistente").toEqual(superficie(await resolver(999_999, so)));
  });
});

describe("resolução de #N — toda negativa é a MESMA negativa", () => {
  it("número inexistente, outro tenant, empresa fora do escopo, sem capacidade e excluído: superfícies iguais", async () => {
    // OUTRO TENANT: um número que só existe na organização vizinha. Pedi-lo aqui tem de ser tão silencioso
    // quanto pedir um número que não existe em lugar nenhum — senão a diferença entre as duas respostas já
    // conta quantos registros a organização vizinha tem.
    const o = await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Busca outra','busca-outra') returning id");
    const org2 = o.rows[0]!.id;
    const emp2 = (await admin.query<{ id: string }>("insert into erp.empresas(organization_id,code,name) values ($1,88,'Empresa alheia') returning id", [org2])).rows[0]!.id;
    const soNoOutroTenant = 987_654;
    await admin.query(
      "insert into erp.registros_globais(organization_id,id_global,tipo_entidade,id_entidade,empresa_id,modulo,rota_canonica) values ($1,$2,'animals',$3,$4,'pecuaria','/pecuaria/animais/x')",
      [org2, soNoOutroTenant, ANIMAL_A, emp2]);

    // excluído
    const excluido = await h.app.inject({ method: "POST", url: "/api/livestock/animals", headers: h.headers(),
      payload: { empresa_id: I.farm, species_id: (await admin.query<{ species_id: string }>("select species_id from erp.animals limit 1")).rows[0]!.species_id,
        category_id: (await admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]!.id,
        entry_date: "2031-03-02", sex: "M", identifications: [{ identification_type_id: I.idType, value: "BUSCA-DEL", is_primary: true }] } });
    expect(excluido.statusCode, excluido.body).toBe(201);
    const idExcluido = String(j(excluido).id);
    const gidExcluido = await idGlobalDe("animals", idExcluido);
    await admin.query("update erp.animals set deleted_at=now() where id=$1", [idExcluido]);

    const inexistente = await resolver(999_998, hdrA);
    const casos = {
      "número que só existe em outro tenant": await resolver(soNoOutroTenant, hdrA),
      "empresa fora do escopo": await resolver(GID_ANIMAL, hdrB),
      "sem capacidade": await resolver(GID_ANIMAL, hdrSemCapacidade),
      "registro excluído": await resolver(gidExcluido, hdrA)
    };
    for (const [nome, r] of Object.entries(casos)) {
      expect(r.statusCode, `${nome} devia ser 404`).toBe(404);
      expect(superficie(r), `${nome}: superfície diferente da de um número inexistente`).toEqual(superficie(inexistente));
      expect(r.body, `${nome}: não pode vazar o identificador do registro`).not.toContain(ANIMAL_A);
    }
  });

  it("CANCELADO continua existindo, continua com #N e continua navegável", async () => {
    const os = await h.app.inject({ method: "POST", url: "/api/service-orders", headers: h.headers(), payload: { empresa_id: I.farm, order_date: "2031-03-03", description: "OS cancelada", lines: [] } });
    expect(os.statusCode, os.body).toBe(201);
    const id = String(j(os).id);
    const gid = await idGlobalDe("service_orders", id);
    await admin.query("update erp.service_orders set status='cancelled' where id=$1", [id]);
    const r = await resolver(gid, h.headers());
    expect(r.statusCode, "cancelado ≠ excluído: o documento existe e a tela abre").toBe(200);
    expect(j(r)["rota"]).toBe(`/os/${id}`);
  });

  it("EMPRESA ATUAL manda: o animal muda de empresa e a autoridade acompanha — o índice NÃO decide", async () => {
    const indiceAntes = await admin.query<{ empresa_id: string }>("select empresa_id from erp.registros_globais where organization_id=$1 and tipo_entidade='animals' and id_entidade=$2", [h.demo.orgId, ANIMAL_A]);
    expect(indiceAntes.rows[0]!.empresa_id, "o índice foi gravado com a empresa de origem").toBe(I.farm);
    expect((await resolver(GID_ANIMAL, hdrA)).statusCode, "antes: quem vê a empresa A abre").toBe(200);
    expect((await resolver(GID_ANIMAL, hdrB)).statusCode, "antes: quem vê só a B não abre").toBe(404);

    await admin.query("update erp.animals set empresa_id=$2 where id=$1", [ANIMAL_A, I.farm2]);

    const indiceDepois = await admin.query<{ empresa_id: string }>("select empresa_id from erp.registros_globais where organization_id=$1 and tipo_entidade='animals' and id_entidade=$2", [h.demo.orgId, ANIMAL_A]);
    expect(indiceDepois.rows[0]!.empresa_id, "a PISTA do índice continua a antiga — e é irrelevante").toBe(I.farm);
    expect((await resolver(GID_ANIMAL, hdrB)).statusCode, "depois: quem vê a empresa NOVA abre").toBe(200);
    expect((await resolver(GID_ANIMAL, hdrA)).statusCode, "depois: quem vê só a ANTIGA não abre mais").toBe(404);
    expect(GID_ANIMAL, "e o número do registro não mudou").toBe(await idGlobalDe("animals", ANIMAL_A));
    const n = await admin.query<{ n: string }>("select count(*)::text n from erp.registros_globais where organization_id=$1 and tipo_entidade='animals' and id_entidade=$2", [h.demo.orgId, ANIMAL_A]);
    expect(n.rows[0]!.n, "nem virou um segundo registro global").toBe("1");
    await admin.query("update erp.animals set empresa_id=$2 where id=$1", [ANIMAL_A, I.farm]);
  });
});

describe("caminho inverso — registro → #N, com a MESMA autorização", () => {
  it("devolve o número do registro aberto", async () => {
    const r = await reverso("animals", ANIMAL_A, hdrA);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)["idGlobal"]).toBe(GID_ANIMAL);
    expect(j(r)["rotulo"]).toBe("Animal");
  });
  it("nega igual: tipo fora do catálogo, registro de outra empresa, sem capacidade — tudo 404 idêntico", async () => {
    const base = superficie(await reverso("animals", "00000000-0000-4000-8000-000000000001", hdrA));
    for (const [nome, r] of Object.entries({
      "tipo fora do catálogo": await reverso("stock_movements", ANIMAL_A, hdrA),
      "tipo inventado": await reverso("qualquer_coisa", ANIMAL_A, hdrA),
      "empresa fora do escopo": await reverso("animals", ANIMAL_A, hdrB),
      "sem capacidade": await reverso("animals", ANIMAL_A, hdrSemCapacidade)
    })) {
      expect(r.statusCode, `${nome}`).toBe(404);
      expect(superficie(r), `${nome}: superfície diferente`).toEqual(base);
    }
  });
  it("registro elegível ainda SEM número (acervo em backfill) responde 404 sem quebrar nada", async () => {
    const esp = (await admin.query<{ species_id: string }>("select species_id from erp.animals limit 1")).rows[0]!.species_id;
    const cat = (await admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]!.id;
    const semNumero = await admin.query<{ id: string }>(
      "insert into erp.animals(organization_id,empresa_id,species_id,category_id,sex,status,entry_date) values ($1,$2,$3,$4,'M','active',current_date) returning id",
      [h.demo.orgId, I.farm, esp, cat]);
    const r = await reverso("animals", semNumero.rows[0]!.id, hdrA);
    expect(r.statusCode).toBe(404);
    expect(j(r).error?.code).toBe("NOT_FOUND");
  });
});

describe("auditoria — o #N do registro, sem confundir com o id do log", () => {
  it("evento de root elegível traz o ID Global; evento técnico não inventa número", async () => {
    // Animal é auditado na criação E é entidade elegível: é o caso que amarra os dois identificadores.
    const esp = (await admin.query<{ species_id: string }>("select species_id from erp.animals limit 1")).rows[0]!.species_id;
    const cat = (await admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]!.id;
    const criado = await h.app.inject({ method: "POST", url: "/api/livestock/animals", headers: h.headers(),
      payload: { empresa_id: I.farm, species_id: esp, category_id: cat, entry_date: "2031-03-10", sex: "M", identifications: [{ identification_type_id: I.idType, value: "AUDIT-1", is_primary: true }] } });
    expect(criado.statusCode, criado.body).toBe(201);
    const id = String(j(criado).id);
    const gid = await idGlobalDe("animals", id);

    const r = await h.app.inject({ method: "GET", url: `/api/admin/audit?entity=animals&entity_id=${id}`, headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const itens = (j(r) as unknown as { items: { id: string | number; entity: string; id_global: string | null }[] }).items;
    expect(itens.length, "a criação foi auditada").toBeGreaterThan(0);
    for (const ev of itens) {
      expect(Number(ev.id_global), "o evento carrega o #N do REGISTRO auditado").toBe(gid);
      // `audit_logs.id` é bigint e chega como texto; o ponto é que ele é OUTRO identificador, com outra
      // sequência, e nunca deve ser exibido como "#N".
      expect(Number.isFinite(Number(ev.id)), "`audit_logs.id` continua sendo o bigint próprio da auditoria").toBe(true);
      expect(Number(ev.id), "e ele NÃO é o ID Global — são identificadores diferentes").not.toBe(gid);
    }

    // evento de entidade FORA do catálogo: sem ID Global, sem invenção
    await admin.query("insert into erp.audit_logs(organization_id,user_id,entity,entity_id,action) values ($1,$2,'stock_movements',$3,'create')", [h.demo.orgId, h.demo.adminUserId, id]);
    const tecnico = await h.app.inject({ method: "GET", url: "/api/admin/audit?entity=stock_movements", headers: h.headers() });
    const tec = (j(tecnico) as unknown as { items: { id_global: string | null }[] }).items;
    expect(tec.length).toBeGreaterThan(0);
    for (const ev of tec) expect(ev.id_global, "entidade fora do catálogo não tem ID Global").toBeNull();
  });
});
