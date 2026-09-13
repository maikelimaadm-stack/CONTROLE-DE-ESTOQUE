import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";
import { executarBackfill, verificarInvariantes, ENTIDADES_ORDENADAS } from "../../src/cli/id-global-backfill.js";

/**
 * BACKFILL DO ID GLOBAL (PRE-BASE2-04) — o acervo que já existia.
 *
 * O que precisa estar provado:
 *  1. DETERMINISMO: rodar de novo produz o MESMO mapa (tipo + UUID → #N). Renumerar é trocar uma identidade
 *     que o usuário já pode ter anotado;
 *  2. RETOMADA: interromper no meio e continuar não muda o que já foi atribuído;
 *  3. SELEÇÃO: elegível recebe, variante INTERNA e registro EXCLUÍDO não — a mesma regra do runtime;
 *  4. CONVIVÊNCIA: criar registros pela API ENQUANTO o backfill roda não duplica número nem deixa órfão;
 *  5. INVARIANTES: zero elegível sem número, zero duplicidade, zero índice apontando para o nada.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { id?: string };

/** Mapa completo (tipo + registro → número) da organização: é ele que não pode mudar entre execuções. */
async function mapa(): Promise<Record<string, number>> {
  const r = await admin.query<{ tipo_entidade: string; id_entidade: string; id_global: string }>(
    "select tipo_entidade, id_entidade, id_global from erp.registros_globais where organization_id=$1", [h.demo.orgId]);
  return Object.fromEntries(r.rows.map((x) => [`${x.tipo_entidade}:${x.id_entidade}`, Number(x.id_global)]));
}
const contarIndice = async () =>
  Number((await admin.query<{ n: string }>("select count(*)::text n from erp.registros_globais where organization_id=$1", [h.demo.orgId])).rows[0]!.n);

/** Acervo HISTÓRICO: registros criados direto na tabela, como se tivessem nascido antes desta rodada. */
async function historico() {
  const esp = (await admin.query<{ id: string }>("select species_id from erp.animals limit 1")).rows[0]!;
  const cat = (await admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]!.id;
  const marca = Math.random().toString(36).slice(2, 8);
  const criados = { animais: [] as string[], interna: "", excluido: "", venda: "" };
  for (let i = 0; i < 12; i++) {
    const r = await admin.query<{ id: string }>(
      "insert into erp.animals(organization_id,empresa_id,species_id,category_id,sex,status,entry_date,created_at) values ($1,$2,$3,$4,'M','active',current_date, now() - ($5 || ' days')::interval) returning id",
      [h.demo.orgId, I.farm, (esp as unknown as { species_id: string }).species_id, cat, String(100 - i)]);
    criados.animais.push(r.rows[0]!.id);
  }
  // EXCLUÍDO: o resolvedor não o enxerga, então ele não pode ganhar número
  const ex = await admin.query<{ id: string }>(
    "insert into erp.animals(organization_id,empresa_id,species_id,category_id,sex,status,entry_date,deleted_at) values ($1,$2,$3,$4,'M','active',current_date, now()) returning id",
    [h.demo.orgId, I.farm, (esp as unknown as { species_id: string }).species_id, cat]);
  criados.excluido = ex.rows[0]!.id;
  // INTERNA: efeito de outra operação, sem tela própria
  const it = await admin.query<{ id: string }>(
    "insert into erp.animal_movements(organization_id,empresa_id,code,movement_type,movement_date,created_by) values ($1,$2,$3,'farm_transfer',current_date,$4) returning id",
    [h.demo.orgId, I.farm, `BFI${marca}`, h.demo.adminUserId]);
  criados.interna = it.rows[0]!.id;
  // USER-FACING na mesma tabela: recebe
  const vd = await admin.query<{ id: string }>(
    "insert into erp.animal_movements(organization_id,empresa_id,code,movement_type,movement_date,created_by) values ($1,$2,$3,'sale',current_date,$4) returning id",
    [h.demo.orgId, I.farm, `BFV${marca}`, h.demo.adminUserId]);
  criados.venda = vd.rows[0]!.id;
  return criados;
}

/**
 * O backfill roda pela conexão de OPERAÇÃO (a mesma das migrations), não pela da aplicação: ele precisa
 * enxergar o acervo inteiro e carrega `organization_id` explícito em cada predicado. Usar o pool com RLS
 * aqui devolveria zero linhas e o teste passaria "sem nada a fazer" — a pior forma de falso verde.
 */
const rodar = (opts: { batchSize?: number; maxLotes?: number; dryRun?: boolean } = {}) =>
  executarBackfill(admin, { batchSize: opts.batchSize ?? 500, org: h.demo.orgId, dryRun: opts.dryRun ?? false, verifyOnly: false, maxLotes: opts.maxLotes });

beforeAll(async () => { h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 3 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("BACKFILL — o acervo histórico ganha número sem inventar história", () => {
  it("a ordem das entidades é determinística e declarada (tipo_entidade ASC)", () => {
    const tipos = ENTIDADES_ORDENADAS.map((e) => e.tipoEntidade);
    expect(tipos, "a ordem não pode ser a que o Postgres devolveu").toEqual([...tipos].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("--dry-run conta o que falta e não grava nada", async () => {
    await historico();
    const antes = await contarIndice();
    const r = await rodar({ dryRun: true });
    expect(r.faltando, "há acervo histórico pendente").toBeGreaterThan(0);
    expect(await contarIndice(), "dry-run não escreve").toBe(antes);
  });

  it("numera TODO o elegível; excluído e variante interna ficam de fora", async () => {
    const criados = await historico();
    const r = await rodar({ batchSize: 5 });
    expect(r.atribuidos).toBeGreaterThan(0);
    expect(r.faltando, "zero elegível sem número ao fim").toBe(0);

    const m = await mapa();
    for (const a of criados.animais) expect(m[`animals:${a}`], `animal histórico ${a} sem número`).toBeGreaterThan(0);
    expect(m[`animals:${criados.excluido}`], "registro excluído não é navegável, logo não recebe número").toBeUndefined();
    expect(m[`animal_movements:${criados.interna}`], "variante interna não tem identidade própria").toBeUndefined();
    expect(m[`animal_movements:${criados.venda}`], "a venda, na MESMA tabela, recebe").toBeGreaterThan(0);
  });

  it("a pista de empresa e a rota gravadas vêm do registro, não de um palpite", async () => {
    const r = await admin.query<{ empresa_id: string | null; rota_canonica: string; id_entidade: string; criado_por: string | null; criado_em: string }>(
      "select empresa_id, rota_canonica, id_entidade, criado_por, criado_em from erp.registros_globais where organization_id=$1 and tipo_entidade='animals' limit 5", [h.demo.orgId]);
    expect(r.rows.length).toBeGreaterThan(0);
    for (const l of r.rows) {
      expect(l.empresa_id, "a empresa é a do registro no momento do backfill").toBeTruthy();
      expect(l.rota_canonica).toBe(`/pecuaria/animais/${l.id_entidade}`);
    }
    const semAutor = r.rows.filter((l) => l.criado_por === null).length;
    expect(semAutor, "no histórico não há usuário real: `criado_por` fica NULL em vez de inventar um autor").toBeGreaterThan(0);
  });

  it("REEXECUÇÃO não renumera nada e não cria linha nova", async () => {
    const antes = await mapa();
    const r = await rodar({ batchSize: 3 });
    expect(r.atribuidos, "não há nada a atribuir na segunda passada").toBe(0);
    expect(await mapa(), "o mapa precisa ser IDÊNTICO").toEqual(antes);
  });

  it("RETOMADA: interromper depois de alguns lotes e continuar preserva os números já dados", async () => {
    await historico();
    const parcial = await rodar({ batchSize: 2, maxLotes: 2 });
    expect(parcial.atribuidos).toBeGreaterThan(0);
    expect(parcial.faltando, "ainda falta acervo — a interrupção foi real").toBeGreaterThan(0);
    const mapaParcial = await mapa();

    const completo = await rodar({ batchSize: 500 });
    expect(completo.faltando).toBe(0);
    const mapaFinal = await mapa();
    for (const [chave, numero] of Object.entries(mapaParcial)) {
      expect(mapaFinal[chave], `${chave} foi renumerado depois da retomada`).toBe(numero);
    }
    expect(Object.keys(mapaFinal).length).toBeGreaterThan(Object.keys(mapaParcial).length);
  });

  it("CONVIVÊNCIA: criar pela API ENQUANTO o backfill roda não duplica nem deixa registro sem número", async () => {
    await historico();
    const criarPelaApi = () => h.app.inject({ method: "POST", url: "/api/service-orders", headers: h.headers(),
      payload: { empresa_id: I.farm, order_date: "2031-02-01", description: "OS durante backfill", lines: [] } });
    const [backfill, ...respostas] = await Promise.all([
      rodar({ batchSize: 2 }),
      criarPelaApi(), criarPelaApi(), criarPelaApi(), criarPelaApi()
    ]);
    for (const r of respostas) expect(r.statusCode, r.body).toBe(201);
    expect(backfill.atribuidos).toBeGreaterThan(0);
    // o que a corrida criou pode não ter entrado no lote do backfill; uma passada final fecha
    const fim = await rodar({ batchSize: 500 });
    expect(fim.faltando).toBe(0);
    for (const r of respostas) {
      const n = await admin.query<{ n: string }>("select count(*)::text n from erp.registros_globais where organization_id=$1 and tipo_entidade='service_orders' and id_entidade=$2", [h.demo.orgId, j(r).id]);
      expect(Number(n.rows[0]!.n), "cada OS criada na corrida tem exatamente um número").toBe(1);
    }
    expect(await verificarInvariantes(admin, h.demo.orgId)).toEqual([]);
  });

  it("INVARIANTES FINAIS: zero faltando, zero duplicado, zero órfão, contador coerente", async () => {
    await rodar({ batchSize: 500 });
    expect(await verificarInvariantes(admin, h.demo.orgId)).toEqual([]);
    const r = await admin.query<{ total: string; distintos: string; maior: string; contador: string }>(
      `select count(*)::text total, count(distinct id_global)::text distintos, max(id_global)::text maior,
              (select ultimo_valor::text from erp.sequencias_id_global where organization_id=$1) contador
         from erp.registros_globais where organization_id=$1`, [h.demo.orgId]);
    const x = r.rows[0]!;
    expect(x.distintos).toBe(x.total);
    expect(Number(x.contador), "o contador nunca fica atrás do maior número entregue").toBeGreaterThanOrEqual(Number(x.maior));
  });

  it("o PRÓXIMO registro criado depois do backfill continua a sequência, sem colidir", async () => {
    const maiorAntes = Number((await admin.query<{ m: string }>("select coalesce(max(id_global),0)::text m from erp.registros_globais where organization_id=$1", [h.demo.orgId])).rows[0]!.m);
    const r = await h.app.inject({ method: "POST", url: "/api/service-orders", headers: h.headers(),
      payload: { empresa_id: I.farm, order_date: "2031-02-02", description: "OS pós-backfill", lines: [] } });
    expect(r.statusCode, r.body).toBe(201);
    const n = await admin.query<{ id_global: string }>("select id_global from erp.registros_globais where organization_id=$1 and id_entidade=$2", [h.demo.orgId, j(r).id]);
    expect(Number(n.rows[0]!.id_global)).toBeGreaterThan(maiorAntes);
  });

  it("ORGANIZAÇÕES independentes: o backfill de uma não toca a sequência da outra", async () => {
    const o = await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Backfill outra','bf-outra') returning id");
    const org2 = o.rows[0]!.id;
    const contadorDemo = (await admin.query<{ v: string }>("select ultimo_valor::text v from erp.sequencias_id_global where organization_id=$1", [h.demo.orgId])).rows[0]!.v;
    await executarBackfill(admin, { batchSize: 100, org: org2, dryRun: false, verifyOnly: false });
    const depois = (await admin.query<{ v: string }>("select ultimo_valor::text v from erp.sequencias_id_global where organization_id=$1", [h.demo.orgId])).rows[0]!.v;
    expect(depois, "o contador da organização de demonstração não se mexe").toBe(contadorDemo);
  });
});
