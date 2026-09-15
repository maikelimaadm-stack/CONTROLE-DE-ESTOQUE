import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPool, type Db } from "../src/pool.js";
import { migrate, resetSchema, listMigrations, MIGRATIONS_DIR } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * CONCORRÊNCIA DO RUNNER E LOCKS — PRE-BASE2-05C-1.
 *
 * `purga-0017-fresh.test.ts` prova que a purga aplica; `purga-0017-upgrade.test.ts` prova que o acervo
 * sobrevive. Nenhum dos dois prova o que acontece quando a purga NÃO está sozinha no banco: dois
 * pre-deploys sobrepostos, uma consulta de aplicação ainda aberta sobre uma das 55 relações, um `comment
 * on function` de alguém investigando o schema no mesmo minuto. Numa migration que APAGA estrutura, o
 * estado DEPOIS da falha é mais importante que a falha: meio caminho é pior que nenhum.
 *
 * O que este arquivo mede é sempre a 0017 VERSIONADA — o arquivo é lido de `MIGRATIONS_DIR`, nunca
 * reescrito nem parafraseado aqui. Onde ele precisa parar no meio (para contar locks pré-adquiridos), o
 * corte é feito no texto real, no ponto exato do `nowait;`, e o resto do arquivo é executado em seguida
 * na MESMA transação — é a 0017 inteira, em duas idas ao banco, não um rascunho.
 *
 * A concorrência é REAL: conexões distintas, transações distintas, disputando de verdade. Nada de mock —
 * um mock de `pg_try_advisory_xact_lock` provaria apenas que o mock devolve falso.
 */
let db: Db;

const ALVO = "0017_purge_farm_legacy.sql";
const SQL_0017 = fs.readFileSync(path.join(MIGRATIONS_DIR, ALVO), "utf8");
/** Fim exato do `lock table ... in access exclusive mode nowait;` no arquivo versionado. */
const MARCA_LOCK = "in access exclusive mode nowait;";
const CORTE_LOCK = SQL_0017.indexOf(MARCA_LOCK) + MARCA_LOCK.length;

const ORG_A = "ecece000-0000-4000-8000-00000000000a";
const ORG_B = "ecece000-0000-4000-8000-00000000000b";
const EMP_A1 = "ecece000-0000-4000-8000-0000000000a1";
const EMP_A2 = "ecece000-0000-4000-8000-0000000000a2";
const EMP_A3 = "ecece000-0000-4000-8000-0000000000a3";
const EMP_B1 = "ecece000-0000-4000-8000-0000000000b1";
const EMP_B2 = "ecece000-0000-4000-8000-0000000000b2";
const USER = "ecece000-0000-4000-8000-000000000100";
/** Linhas por bloco de volume. Acervo pequeno demais mediria a latência do driver, não a janela de lock. */
const VOLUME = 1200;

/**
 * O inventário legado que a purga tem de remover por inteiro — ou não remover nada.
 *
 * O QUE ESTA COMPARAÇÃO É, E O QUE ELA NÃO É. É um inventário OBSERVÁVEL: contagens de catálogo das seis
 * classes que a 0017 toca, mais o CHECK legado e o canônico, as compostas canônicas, as policies legadas e
 * cinco contagens de DADO (ledger, animais, movimentos, saldo bancário, contador `farm`). Quando um caso diz
 * que a recusa "não mexeu em nada", o que está provado é que ESSE inventário permanece idêntico.
 * NÃO é comparação byte a byte, nem hash físico de arquivos de dados ou de relações — nada disso foi medido,
 * e afirmar isso seria vender prova que não existe. Um efeito colateral fora destas contagens passaria por
 * aqui; o que fecha esse flanco é a pós-condição da própria migration, não este teste.
 */
interface Inventario {
  colunas: number; fks_legadas: number; gatilhos: number; funcoes: number; views: number;
  indices: number; check_legado: number; check_canonico: number; fks_compostas: number;
  policies_legadas: number; ledger: number; animais: number; movimentos: number;
  saldo_bancario: number; contador_farm: number;
}

async function inventariar(alvo: Db = db): Promise<Inventario> {
  const r = await alvo.query<Inventario>(`select
    (select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='erp' and c.relkind='r' and a.attnum>0 and not a.attisdropped
        and a.attname in ('farm_id','origin_farm_id','destination_farm_id'))::int colunas,
    (select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1]
      where n.nspname='erp' and k.contype='f' and array_length(k.conkey,1)=1
        and a.attname in ('farm_id','origin_farm_id','destination_farm_id'))::int fks_legadas,
    (select count(*) from pg_trigger t
      join pg_class ct on ct.oid=t.tgrelid join pg_namespace nt on nt.oid=ct.relnamespace
      join pg_proc p on p.oid=t.tgfoid join pg_namespace np on np.oid=p.pronamespace
      where not t.tgisinternal and nt.nspname='erp' and np.nspname='erp'
        and p.proname like 'sincronizar_empresa%')::int gatilhos,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='erp' and p.proname like 'sincronizar_empresa%')::int funcoes,
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='erp' and c.relkind='v'
        and c.relname in ('farms','proprietary_farms','authorizer_farms','bank_account_farms','farm_cost_centers'))::int views,
    (select count(*) from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='erp' and exists (select 1 from pg_attribute a where a.attrelid=i.indrelid
        and a.attnum = any(i.indkey::int2[]) and a.attname in ('farm_id','origin_farm_id','destination_farm_id')))::int indices,
    (select count(*) from pg_constraint where conrelid='erp.equipment_transfers'::regclass
      and conname='equipment_transfers_check')::int check_legado,
    (select count(*) from pg_constraint where conrelid='erp.equipment_transfers'::regclass
      and conname='equipment_transfers_empresa_origem_destino_check' and convalidated)::int check_canonico,
    (select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='erp' and k.contype='f' and array_length(k.conkey,1)=2
        and k.confrelid='erp.empresas'::regclass and k.convalidated)::int fks_compostas,
    (select count(*) from pg_policies where schemaname='erp'
      and (coalesce(qual,'')||coalesce(with_check,'')) ~ '(farm_id|origin_farm_id|destination_farm_id)')::int policies_legadas,
    (select count(*) from public.erp_migrations where name=$1)::int ledger,
    (select count(*) from erp.animals)::int animais,
    (select count(*) from erp.stock_movements)::int movimentos,
    (select case when to_regclass('erp.v_bank_account_balances') is null then 0 else 1 end)::int saldo_bancario,
    (select coalesce(max(last_value),0) from erp.code_sequences where entity='farm')::int contador_farm`, [ALVO]);
  return r.rows[0]!;
}

/** O estado que a fase DUAL tem de apresentar antes da purga. Premissa conferida, nunca suposta. */
function esperarFaseDual(inv: Inventario, onde: string) {
  expect(inv.colunas, `${onde}: 52 colunas legadas`).toBe(52);
  expect(inv.fks_legadas, `${onde}: 52 FKs legadas de coluna única`).toBe(52);
  expect(inv.gatilhos, `${onde}: 52 gatilhos de espelho`).toBe(52);
  expect(inv.funcoes, `${onde}: 3 funções de sincronia`).toBe(3);
  expect(inv.views, `${onde}: 5 views de nome antigo`).toBe(5);
  expect(inv.indices, `${onde}: 8 índices legados`).toBe(8);
  expect(inv.check_legado, `${onde}: CHECK legado de transferência`).toBe(1);
  expect(inv.check_canonico, `${onde}: CHECK canônico ainda não existe`).toBe(0);
  expect(inv.fks_compostas, `${onde}: 50 FKs compostas canônicas`).toBe(50);
  expect(inv.policies_legadas, `${onde}: 1 policy decidindo por coluna legada`).toBe(1);
  expect(inv.ledger, `${onde}: a 0017 não está no ledger`).toBe(0);
  expect(inv.saldo_bancario, `${onde}: erp.v_bank_account_balances é canônica e fica`).toBe(1);
  expect(inv.contador_farm, `${onde}: o contador de transição não é desta fatia`).toBe(4242);
  // Sem acervo, todo `drop column` passa por vacuidade: a premissa do volume é conferida junto.
  expect(inv.animais, `${onde}: acervo de animais`).toBeGreaterThanOrEqual(2 * VOLUME);
  expect(inv.movimentos, `${onde}: acervo de movimentos de estoque`).toBeGreaterThanOrEqual(2 * VOLUME);
}

/** O estado depois de uma purga que COMPLETOU. */
function esperarPurgado(inv: Inventario, onde: string) {
  expect(inv.colunas, `${onde}: nenhuma coluna legada`).toBe(0);
  expect(inv.fks_legadas, `${onde}: nenhuma FK legada`).toBe(0);
  expect(inv.gatilhos, `${onde}: nenhum gatilho de espelho`).toBe(0);
  expect(inv.funcoes, `${onde}: nenhuma função de sincronia`).toBe(0);
  expect(inv.views, `${onde}: nenhuma view de nome antigo`).toBe(0);
  expect(inv.indices, `${onde}: nenhum índice legado`).toBe(0);
  expect(inv.check_legado, `${onde}: CHECK legado removido`).toBe(0);
  expect(inv.check_canonico, `${onde}: CHECK canônico validado`).toBe(1);
  expect(inv.fks_compostas, `${onde}: as 50 compostas sobreviveram`).toBe(50);
  expect(inv.policies_legadas, `${onde}: nenhuma policy cita coluna legada`).toBe(0);
  expect(inv.ledger, `${onde}: exatamente uma linha 0017 no ledger`).toBe(1);
  expect(inv.saldo_bancario, `${onde}: erp.v_bank_account_balances sobreviveu`).toBe(1);
  expect(inv.contador_farm, `${onde}: o contador de transição continua intacto`).toBe(4242);
  expect(inv.animais, `${onde}: o acervo de animais atravessou a purga`).toBeGreaterThanOrEqual(2 * VOLUME);
  expect(inv.movimentos, `${onde}: o acervo de movimentos atravessou a purga`).toBeGreaterThanOrEqual(2 * VOLUME);
}

/** Runner da fase dual: o mesmo mecanismo de `purga-0017-upgrade.test.ts`, com MIGRATIONS_DIR só até a 0016. */
async function subirAte16() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purga-conc-ate16-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const anteriores = listMigrations().map((m) => m.name).filter((nome) => nome < ALVO);
    expect(anteriores.length, "16 migrations antes da purga").toBe(16);
    for (const nome of anteriores) fs.copyFileSync(path.join(MIGRATIONS_DIR, nome), path.join(dir, nome));
    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const ate16 = await import("../src/migrate.js");
    expect(ate16.listMigrations().map((m) => m.name), "o runner da fase dual não conhece a purga").not.toContain(ALVO);
    await ate16.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR;
    else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Acervo da fase dual, escrito pelos DOIS vocabulários — o espelho da 0014 preenche o outro lado. */
async function semearAcervo() {
  const q = (sql: string, p: unknown[] = []) => db.query(sql, p);
  const uma = async (sql: string, p: unknown[] = []): Promise<{ id: string }> =>
    (await db.query<{ id: string }>(sql, p)).rows[0]!;

  await q("insert into erp.organizations(id,name,slug) values ($1,'[TEST] Conc A','conc-a'),($2,'[TEST] Conc B','conc-b')", [ORG_A, ORG_B]);
  await q("insert into erp.users(id,email,name,password_hash) values ($1,'conc@t.local','Conc','x')", [USER]);
  await q("insert into erp.organization_members(organization_id,user_id,is_owner) values ($1,$2,true),($3,$2,true)", [ORG_A, USER, ORG_B]);
  await q(`insert into erp.empresas(id,organization_id,code,name) values
             ($1,$6,1,'Empresa A1'),($2,$6,2,'Empresa A2'),($3,$6,3,'Empresa A3'),
             ($4,$7,1,'Empresa B1'),($5,$7,2,'Empresa B2')`,
    [EMP_A1, EMP_A2, EMP_A3, EMP_B1, EMP_B2, ORG_A, ORG_B]);
  // O contador de transição com valor próprio: nenhuma falha e nenhum sucesso desta fatia pode movê-lo.
  await q("insert into erp.code_sequences(organization_id,entity,last_value) values ($1,'farm',4242)", [ORG_A]);

  const um = await uma("insert into erp.measurement_units(symbol,name) values ('KG','Quilograma') returning id");
  const esp = await uma("insert into erp.animal_species(name) values ('Bovino') returning id");
  const cat = await uma("insert into erp.animal_categories(species_id,name) values ($1,'Garrote') returning id", [esp.id]);
  const refs: Record<string, { prod: string; pessoa: string; docTipo: string; cc1: string; cc2: string }> = {};
  for (const org of [ORG_A, ORG_B]) {
    const g = await uma("insert into erp.product_groups(organization_id,name) values ($1,'Insumos') returning id", [org]);
    const c = await uma("insert into erp.product_categories(organization_id,group_id,name) values ($1,$2,'Nutrição') returning id", [org, g.id]);
    const k = await uma("insert into erp.product_kinds(organization_id,category_id,name) values ($1,$2,'Sal') returning id", [org, c.id]);
    const f = await uma("insert into erp.financial_categories(organization_id,code,name,nature) values ($1,'2.01','Insumos','expense') returning id", [org]);
    const p = await uma(`insert into erp.products(organization_id,code,description,measurement_id,group_id,category_id,kind_id,control_stock,financial_category_id)
        values ($1,'00001','Sal Mineral',$2,$3,$4,$5,true,$6) returning id`, [org, um.id, g.id, c.id, k.id, f.id]);
    const pe = await uma("insert into erp.people(organization_id,code,name,is_provider,is_client) values ($1,'00001','Parceiro',true,true) returning id", [org]);
    const dt = await uma("insert into erp.document_types(organization_id,name) values ($1,'Contrato') returning id", [org]);
    const cc1 = await uma("insert into erp.cost_centers(organization_id,code,name) values ($1,'1','Geral') returning id", [org]);
    const cc2 = await uma("insert into erp.cost_centers(organization_id,code,name) values ($1,'2','Segundo') returning id", [org]);
    refs[org] = { prod: p.id, pessoa: pe.id, docTipo: dt.id, cc1: cc1.id, cc2: cc2.id };
  }

  await q("insert into erp.warehouses(organization_id,empresa_id,initials,description) values ($1,$2,'ALM','Almoxarifado A1')", [ORG_A, EMP_A1]);
  await q("insert into erp.warehouses(organization_id,farm_id,initials,description) values ($1,$2,'SIL','Silo A2')", [ORG_A, EMP_A2]);
  await q("insert into erp.warehouses(organization_id,empresa_id,initials,description) values ($1,$2,'ALB','Almoxarifado B1')", [ORG_B, EMP_B1]);
  const alm = await uma("select id from erp.warehouses where organization_id=$1 and initials='ALM'", [ORG_A]);
  const sil = await uma("select id from erp.warehouses where organization_id=$1 and initials='SIL'", [ORG_A]);

  await q("insert into erp.areas(organization_id,empresa_id,code,name) values ($1,$2,'A1','Talhão 1'),($1,$3,'A2','Talhão 2')", [ORG_A, EMP_A1, EMP_A2]);
  await q("insert into erp.batches(organization_id,farm_id,code,batch_date,description) values ($1,$2,'L1',current_date,'Lote 1')", [ORG_A, EMP_A1]);
  await q("insert into erp.equipments(organization_id,empresa_id,code,description) values ($1,$2,'0001','Trator'),($1,$3,'0002','Colheitadeira')", [ORG_A, EMP_A1, EMP_A2]);
  // Ligação de PK composta: é sobre esta tabela que a policy legada `api_child` decide.
  await q("insert into erp.empresa_cost_centers(empresa_id,cost_center_id) values ($1,$3),($2,$4)", [EMP_A1, EMP_A2, refs[ORG_A]!.cc1, refs[ORG_A]!.cc2]);
  // Legada NULA dos dois lados: `is distinct from` da pré-condição 4.6 tem de aceitar nulo.
  await q("insert into erp.documents(organization_id,document_type_id,title) values ($1,$2,'Sem empresa')", [ORG_A, refs[ORG_A]!.docTipo]);
  await q(`insert into erp.equipment_transfers(organization_id,code,transfer_date,equipment_id,empresa_origem_id,empresa_destino_id)
      select $1,'TR-1',current_date,e.id,$2,$3 from erp.equipments e where e.organization_id=$1 and e.code='0001'`, [ORG_A, EMP_A1, EMP_A2]);
  await q(`insert into erp.equipment_transfers(organization_id,code,transfer_date,equipment_id,origin_farm_id,destination_farm_id)
      select $1,'TR-2',current_date,e.id,$2,$3 from erp.equipments e where e.organization_id=$1 and e.code='0002'`, [ORG_A, EMP_A2, EMP_A3]);
  await q(`insert into erp.warehouse_transfers(organization_id,code,transfer_date,kind,empresa_origem_id,origin_warehouse_id,empresa_destino_id,destination_warehouse_id)
      values ($1,'TA-1',current_date,'farm',$2,$3,$4,$5)`, [ORG_A, EMP_A1, alm.id, EMP_A2, sil.id]);

  // VOLUME. Metade escrita pelo lado canônico, metade pelo legado: o gatilho da 0014 preenche o outro, e
  // é isso que faz a pré-condição 4.6 varrer acervo de verdade em vez de tabela vazia.
  await q(`insert into erp.animals(organization_id,empresa_id,species_id,category_id,entry_date,sex)
      select $1,$2,$3,$4,current_date,'M' from generate_series(1,$5)`, [ORG_A, EMP_A1, esp.id, cat.id, VOLUME]);
  await q(`insert into erp.animals(organization_id,farm_id,species_id,category_id,entry_date,sex)
      select $1,$2,$3,$4,current_date,'F' from generate_series(1,$5)`, [ORG_A, EMP_A2, esp.id, cat.id, VOLUME]);
  await q(`insert into erp.stock_movements(organization_id,empresa_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,source_type,source_id,movement_date,created_by)
      select $1,$2,$3,$4,'entry',1,'10','2','input_entry',gen_random_uuid(),current_date,$5 from generate_series(1,$6)`,
    [ORG_A, EMP_A1, alm.id, refs[ORG_A]!.prod, USER, VOLUME]);
  await q(`insert into erp.stock_movements(organization_id,farm_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,source_type,source_id,movement_date,created_by)
      select $1,$2,$3,$4,'entry',1,'10','2','input_entry',gen_random_uuid(),current_date,$5 from generate_series(1,$6)`,
    [ORG_A, EMP_A2, sil.id, refs[ORG_A]!.prod, USER, VOLUME]);
  await q(`insert into erp.financial_titles(organization_id,empresa_id,code,direction,number,amount,emission_date,due_date,person_id)
      select $1,$2,lpad(g::text,8,'0'),'payable','NF-'||g,'100.00',current_date,current_date,$3 from generate_series(1,$4) g`,
    [ORG_A, EMP_A1, refs[ORG_A]!.pessoa, VOLUME]);
}

/** Banco na véspera da purga: schema 0016 + acervo. Toda cena começa daqui, nunca de sobra da anterior. */
async function montarVespera() {
  await resetSchema(db);
  await subirAte16();
  await semearAcervo();
  esperarFaseDual(await inventariar(), "véspera");
}

const PAUSA = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Erro do driver `pg` com SQLSTATE. `unknown` no catch é a regra; aqui ele é estreitado uma vez só. */
function sqlstate(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}
function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Executa a 0017 VERSIONADA em transação própria, como o runner faz, e devolve o erro cru (com SQLSTATE). */
async function aplicarCru(alvo: Db, sql = SQL_0017): Promise<{ erro?: unknown; ms: number }> {
  const c = await alvo.connect();
  const t0 = performance.now();
  try {
    await c.query("begin");
    await c.query(sql);
    await c.query("commit");
    return { ms: performance.now() - t0 };
  } catch (e) {
    await c.query("rollback");
    return { erro: e, ms: performance.now() - t0 };
  } finally { c.release(); }
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 8 });
});

afterAll(async () => { await db.end(); });

describe("PARTE 1 — dois runners ao mesmo tempo", () => {
  it("trava tomada por outra transação: o runner morre com 55P03, não deixa nada pela metade, e converge depois", async () => {
    await montarVespera();
    const antes = await inventariar();

    // Uma transação QUALQUER segurando a mesma chave — é o pre-deploy concorrente, visto de fora.
    const dono = await db.connect();
    await dono.query("begin");
    await dono.query("select pg_advisory_xact_lock(2026,51)");
    const pidDono = (await dono.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0]!.pid;
    // A premissa: a trava está mesmo tomada, e é a chave (2026,51) no espaço de dois inteiros.
    const trava = await db.query<{ classid: number; objid: number; objsubid: number }>(
      "select classid, objid, objsubid from pg_locks where locktype='advisory' and pid=$1 and granted", [pidDono]);
    expect(trava.rows, "a trava (2026,51) está tomada por outra transação").toHaveLength(1);
    expect(trava.rows[0]!.classid, "classid = 2026").toBe(2026);
    expect(trava.rows[0]!.objid, "objid = 51").toBe(51);
    expect(trava.rows[0]!.objsubid, "espaço de dois inteiros").toBe(2);

    // (i) SQLSTATE cru: a exceção da trava é 55P03 — o runner embrulha a mensagem e perde o código.
    const cru = await aplicarCru(db);
    expect(sqlstate(cru.erro), "SQLSTATE da trava").toBe("55P03");
    expect(mensagem(cru.erro)).toMatch(/outra transacao ja detem a trava da purga \(2026,51\)/);
    expect(cru.ms, "a trava recusa em milissegundos, sem ficar pendurada").toBeLessThan(1000);

    // (ii) o runner de verdade, na mesma situação
    await expect(migrate(db, () => {})).rejects.toThrow(/outra transacao ja detem a trava da purga/);

    // Estado depois da recusa: IDÊNTICO ao de antes. Nenhum objeto legado a menos, ledger sem a 0017.
    const depoisDaRecusa = await inventariar();
    expect(depoisDaRecusa, "a recusa não removeu um único objeto").toEqual(antes);
    esperarFaseDual(depoisDaRecusa, "depois da recusa");

    // Solto o concorrente: o runner converge no mesmo banco, sem intervenção.
    await dono.query("rollback");
    dono.release();
    await expect(migrate(db, () => {})).resolves.toEqual([ALVO]);
    esperarPurgado(await inventariar(), "depois da convergência");

    // Reexecução posterior: nada pendente, nada quebrado.
    await expect(migrate(db, () => {})).resolves.toEqual([]);
    esperarPurgado(await inventariar(), "depois da reexecução");
  });

  it("dois migrate() disparados juntos: no máximo um aplica, o ledger fica com UMA linha e o schema íntegro", async () => {
    await montarVespera();
    // Pools distintos: duas conexões independentes, como dois processos de pre-deploy.
    const dbA = createPool(TEST_URL, { max: 2 });
    const dbB = createPool(TEST_URL, { max: 2 });
    try {
      const corrida = await Promise.allSettled([migrate(dbA, () => {}), migrate(dbB, () => {})]);
      const aplicaram = corrida.filter((r) => r.status === "fulfilled" && r.value.includes(ALVO));
      const recusados = corrida.filter((r) => r.status === "rejected");
      const vazios = corrida.filter((r) => r.status === "fulfilled" && r.value.length === 0);

      expect(aplicaram, "exatamente UM runner aplicou a purga").toHaveLength(1);
      // O perdedor ou bateu na trava, ou chegou depois do commit e viu a 0017 já no ledger. As duas saídas
      // são controladas; o que não pode existir é um segundo runner aplicando ou parando no meio.
      expect(recusados.length + vazios.length, "o outro runner não aplicou nada").toBe(1);
      for (const r of recusados) {
        expect(mensagem((r as PromiseRejectedResult).reason),
          "quando perde a corrida, perde na trava").toMatch(/outra transacao ja detem a trava da purga/);
      }
      esperarPurgado(await inventariar(), "depois da corrida");
      // O ledger é PK por nome: a contagem 1 é conferida em `esperarPurgado`, e a reexecução confirma.
      await expect(migrate(dbA, () => {})).resolves.toEqual([]);
      await expect(migrate(dbB, () => {})).resolves.toEqual([]);
      esperarPurgado(await inventariar(), "depois da reexecução dos dois");
    } finally {
      await dbA.end(); await dbB.end();
    }
  });

  it("runner atrasado que só chega depois da purga não reaplica nada: as pré-condições recusam o banco já purgado", async () => {
    await montarVespera();
    await expect(migrate(db, () => {})).resolves.toEqual([ALVO]);
    const depois = await inventariar();
    esperarPurgado(depois, "purga aplicada");

    // É o runner cujo ledger foi lido ANTES do commit do vencedor: ele acha que a 0017 está pendente e
    // tenta o arquivo de novo. Sem a trava no caminho (o vencedor já soltou), quem barra é a CONFERÊNCIA
    // DO ACERVO — a seção 2, que roda ANTES do `lock table` justamente para não escalar a janela: ela lê
    // as colunas legadas par a par, e a primeira delas já não existe. A recusa é, portanto, mais cedo do
    // que o `lock table` (que barraria pelas views removidas), e igualmente fail-closed: nada é tocado.
    const reexecucao = await aplicarCru(db);
    expect(sqlstate(reexecucao.erro), "SQLSTATE de coluna inexistente").toBe("42703");
    expect(mensagem(reexecucao.erro), "barrado já na conferência do acervo, que lê as colunas legadas")
      .toMatch(/column "(farm_id|origin_farm_id|destination_farm_id)" does not exist/);
    expect(await inventariar(), "o inventário observável coberto por este gate permanece idêntico").toEqual(depois);

    // E o runner de verdade, na mesma situação, nem chega a abrir o arquivo: a 0017 está no ledger.
    await expect(migrate(db, () => {})).resolves.toEqual([]);
    expect(await inventariar(), "a reexecução do runner é inerte").toEqual(depois);
  });
});

describe("PARTE 2 — locks e timeouts da 0017 versionada", () => {
  it("(a) mediana da janela de ACCESS EXCLUSIVE em banco com acervo, n = 5", async () => {
    const n = 5;
    const janelas: number[] = [];
    const totais: number[] = [];
    for (let i = 0; i < n; i++) {
      await montarVespera();
      const c = await db.connect();
      const vigia = await db.connect();
      try {
        const pid = (await c.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0]!.pid;
        // A janela é medida DE FORA, em pg_locks: abre quando o primeiro AccessExclusiveLock de relação
        // aparece (é o `lock table`) e fecha quando o último some (é o commit). Medir o tempo do arquivo
        // pelo cliente incluiria o que roda ANTES do lock table e não faz parte da janela.
        let abriu = 0, fechou = 0, viu = false, parar = false;
        const observando = (async () => {
          while (!parar) {
            const r = await vigia.query<{ n: number }>(
              "select count(*)::int n from pg_locks where pid=$1 and locktype='relation' and mode='AccessExclusiveLock' and granted", [pid]);
            const agora = performance.now();
            if (r.rows[0]!.n > 0 && !viu) { viu = true; abriu = agora; }
            else if (r.rows[0]!.n === 0 && viu) { fechou = agora; return; }
          }
        })();
        const t0 = performance.now();
        await c.query("begin");
        await c.query(SQL_0017);
        await c.query(`insert into public.erp_migrations(name) values ($1)`, [ALVO]);
        await c.query("commit");
        const total = performance.now() - t0;
        parar = true;
        await observando;
        expect(viu, "o vigia viu mesmo a janela abrir").toBe(true);
        expect(fechou, "o vigia viu a janela fechar").toBeGreaterThan(0);
        janelas.push(fechou - abriu);
        totais.push(total);
      } finally { c.release(); vigia.release(); }
      esperarPurgado(await inventariar(), `medição ${i + 1}`);
    }
    const ordenadas = [...janelas].sort((x, y) => x - y);
    const mediana = ordenadas[Math.floor(n / 2)]!;
    console.log(`[0017] janela ACCESS EXCLUSIVE n=${n} mediana=${mediana.toFixed(1)}ms ` +
      `amostras=[${ordenadas.map((v) => v.toFixed(1)).join(", ")}] begin→commit=[${totais.map((v) => v.toFixed(1)).join(", ")}]`);
    expect(janelas, "n = 5 medições").toHaveLength(n);
    expect(mediana, "janela observada de verdade, não zero").toBeGreaterThan(0);
    // Teto generoso: o valor que importa é o publicado no log; o gate só recusa ordem de grandeza errada.
    expect(mediana, "a janela inteira cabe em poucos segundos").toBeLessThan(5000);
    expect(mediana, "a janela não é maior que o begin→commit que a contém").toBeLessThanOrEqual(Math.max(...totais));
  });

  describe("contenção", () => {
    beforeAll(async () => { await montarVespera(); });

    it("(b) o LOCK TABLE pré-adquire exatamente as 55 relações nomeadas — nem uma a mais por dependência de view", async () => {
      // Os nomes NOMEADOS no arquivo versionado, lidos do próprio texto: a contagem não é copiada daqui.
      const trecho = SQL_0017.slice(SQL_0017.lastIndexOf("lock table", CORTE_LOCK), CORTE_LOCK);
      const nomeados = trecho.replace(/^lock table/, "").replace(new RegExp(`${MARCA_LOCK}$`), "")
        .split(",").map((s) => s.trim()).filter(Boolean).sort();
      expect(nomeados, "o arquivo nomeia 55 relações").toHaveLength(55);

      const c = await db.connect();
      try {
        await c.query("begin");
        await c.query(SQL_0017.slice(0, CORTE_LOCK));
        // Contado DENTRO da própria transação que segura os locks.
        const locks = await c.query<{ relkind: string; nome: string }>(
          `select c.relkind, n.nspname||'.'||c.relname nome from pg_locks l
             join pg_class c on c.oid = l.relation join pg_namespace n on n.oid = c.relnamespace
            where l.pid = pg_backend_pid() and l.locktype='relation'
              and l.mode='AccessExclusiveLock' and l.granted order by 2`);
        const adquiridas = locks.rows.map((r) => r.nome).sort();
        expect(adquiridas, "pg_locks devolve 55 relações em ACCESS EXCLUSIVE").toHaveLength(55);
        expect(locks.rows.filter((r) => r.relkind === "r"), "50 tabelas").toHaveLength(50);
        expect(locks.rows.filter((r) => r.relkind === "v"), "5 views").toHaveLength(5);
        // `lock table` sobre view trava também as tabelas da definição: aqui elas JÁ estão nomeadas, então
        // a lista do arquivo é fechada — nenhuma relação entra na janela por tabela.
        expect(adquiridas, "o conjunto travado é exatamente o conjunto nomeado").toEqual(nomeados);
        await c.query("rollback");
      } finally { c.release(); }
      esperarFaseDual(await inventariar(), "depois de (b)");
    });

    it("(c) relação ocupada por outra sessão: NOWAIT mata em milissegundos com 55P03 e nada é removido", async () => {
      const antes = await inventariar();
      esperarFaseDual(antes, "antes de (c)");
      const ocupante = await db.connect();
      try {
        // Uma consulta de aplicação ainda aberta: ACCESS SHARE em erp.weighings, que conflita com o
        // ACCESS EXCLUSIVE que a 0017 pede. É o cenário realista, não um `lock table` artificial.
        await ocupante.query("begin");
        await ocupante.query("select count(*) from erp.weighings");

        const cru = await aplicarCru(db);
        expect(sqlstate(cru.erro), "SQLSTATE do NOWAIT").toBe("55P03");
        expect(mensagem(cru.erro), "e diz qual relação").toMatch(/could not obtain lock on relation "erp\.weighings"/);
        // Milissegundos: o ponto do NOWAIT é não acumular ACCESS EXCLUSIVE nas outras 54 enquanto espera.
        expect(cru.ms, "falha em milissegundos, muito antes do lock_timeout de 2s").toBeLessThan(1000);

        // O runner, na mesma situação, também recusa — e o ledger continua sem a 0017.
        await expect(migrate(db, () => {})).rejects.toThrow(/could not obtain lock on relation "erp\.weighings"/);
      } finally { await ocupante.query("rollback"); ocupante.release(); }

      const depois = await inventariar();
      expect(depois, "reverteu TUDO: nem um objeto legado a menos").toEqual(antes);
      esperarFaseDual(depois, "depois de (c)");
    });

    it("(d)(e) objeto de catálogo ocupado: passa do LOCK TABLE, morre no lock_timeout de 2s e reverte por inteiro", async () => {
      const antes = await inventariar();
      esperarFaseDual(antes, "antes de (d)");
      const ocupante = await db.connect();
      const vigia = await db.connect();
      const c = await db.connect();
      let esperas: { locktype: string; classe: string; proname: string | null }[] = [];
      let msLockTable = 0, msMorte = 0, erro: unknown;
      try {
        // `comment on function` tranca o OBJETO na pg_proc, não a relação. O LOCK TABLE não enxerga isso.
        await ocupante.query("begin");
        await ocupante.query("comment on function erp.sincronizar_empresa_legado() is 'sessao de diagnostico'");

        const pid = (await c.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0]!.pid;
        await c.query("begin");
        const t0 = performance.now();
        await c.query(SQL_0017.slice(0, CORTE_LOCK));   // prefixo real: trava, lock_timeout e LOCK TABLE
        msLockTable = performance.now() - t0;
        // O resto do MESMO arquivo, na MESMA transação: é a 0017 inteira, só observável no meio.
        const resto = c.query(SQL_0017.slice(CORTE_LOCK)).then(() => undefined, (e: unknown) => e);
        const t1 = performance.now();
        for (let i = 0; i < 600 && esperas.length === 0; i++) {
          const r = await vigia.query<{ locktype: string; classe: string; proname: string | null }>(
            `select l.locktype, l.classid::regclass::text classe,
                    (select p.proname from pg_proc p where p.oid = l.objid) proname
               from pg_locks l where l.pid = $1 and not l.granted`, [pid]);
          if (r.rows.length) esperas = r.rows;
          else await PAUSA(5);
        }
        erro = await resto;
        msMorte = performance.now() - t1;
        await c.query("rollback");
      } finally { await ocupante.query("rollback"); ocupante.release(); vigia.release(); c.release(); }

      // Passou do LOCK TABLE: o NOWAIT não teve o que recusar, porque o lock disputado não é de relação.
      expect(msLockTable, "o LOCK TABLE das 55 relações passou em milissegundos").toBeLessThan(1000);
      expect(esperas, "a espera observada em pg_locks").toHaveLength(1);
      expect(esperas[0]!.locktype, "não é lock de relação, é de objeto de catálogo").toBe("object");
      expect(esperas[0]!.classe, "o objeto está na pg_proc").toBe("pg_proc");
      expect(esperas[0]!.proname, "é a função de sincronia que a seção 10 vai remover").toBe("sincronizar_empresa_legado");

      // (e) o tempo da morte: o teto por comando é 2 s, e é nele que ela morre.
      console.log(`[0017] contenção de catálogo: lock table ${msLockTable.toFixed(1)}ms, morte ${msMorte.toFixed(1)}ms, ` +
        `sqlstate ${String(sqlstate(erro))} — ${mensagem(erro)}`);
      expect(mensagem(erro), "morreu no lock_timeout, não no NOWAIT").toMatch(/canceling statement due to lock timeout/);
      // O SQLSTATE do lock_timeout no PostgreSQL 16 é 55P03 (lock_not_available) — o mesmo do NOWAIT.
      // Quem separa os dois casos é a mensagem, não o código.
      expect(sqlstate(erro), "SQLSTATE do lock_timeout").toBe("55P03");
      expect(msMorte, "morreu depois dos 2s do lock_timeout").toBeGreaterThan(1900);
      expect(msMorte, "e não muito depois: o teto é por comando, e só houve uma espera").toBeLessThan(4000);

      const depois = await inventariar();
      expect(depois, "reverteu por inteiro: nada pela metade").toEqual(antes);
      esperarFaseDual(depois, "depois de (d)");
    });
  });
});
