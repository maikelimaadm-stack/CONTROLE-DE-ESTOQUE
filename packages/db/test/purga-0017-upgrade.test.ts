import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { QueryResultRow } from "pg";
import { createPool, type Db } from "../src/pool.js";
import { migrate, resetSchema, listMigrations, MIGRATIONS_DIR } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * 0016 → 0017 COM ACERVO — PRE-BASE2-05C-1.
 *
 * `purga-0017-fresh.test.ts` prova que a purga aplica e que o SCHEMA fica certo. Ele não pode provar o que
 * mais importa numa migration destrutiva: que o DADO sobreviveu. Banco zero não tem linha, e um
 * `drop column` executa sem reclamar sobre tabela vazia. Um upgrade que apagasse acervo passaria inteiro
 * naquele arquivo.
 *
 * Aqui o banco é montado só até a 0016 — a fase DUAL, com a ponte de compatibilidade de pé — e recebe
 * acervo representativo: duas organizations, três e duas empresas nelas, linhas em quinze tabelas de
 * escopo, os dois sentidos da transferência com origem diferente de destino, e casos com a coluna legada
 * NULA onde a coluna permite (o par `is distinct from` da migration tem de aceitar nulo dos dois lados).
 *
 * O acervo é escrito pelos DOIS vocabulários, e isso não é enfeite: escrever só a coluna canônica e ver a
 * legada espelhada (e vice-versa) é a prova de que o banco semeado está mesmo na fase dual da 0014, e não
 * num estado inventado pelo teste.
 *
 * `MIGRATIONS_DIR` é lido na carga do módulo `migrate.js`; recarregar o módulo apontado para um diretório
 * temporário é o que dá um runner que para na 0016 sem mexer no módulo que aplica a purga depois — mesmo
 * mecanismo de `runner-forward-only.test.ts`.
 */
let db: Db;

const ALVO = "0017_purge_farm_legacy.sql";

const ORG_A = "acaca000-0000-4000-8000-00000000000a";
const ORG_B = "acaca000-0000-4000-8000-00000000000b";
const EMP_A1 = "acaca000-0000-4000-8000-0000000000a1";
const EMP_A2 = "acaca000-0000-4000-8000-0000000000a2";
const EMP_A3 = "acaca000-0000-4000-8000-0000000000a3";
const EMP_B1 = "acaca000-0000-4000-8000-0000000000b1";
const EMP_B2 = "acaca000-0000-4000-8000-0000000000b2";
const USER = "acaca000-0000-4000-8000-000000000100";
/** O contador de transição: esta fatia não pode encostar nele. Valor arbitrário, e é o mesmo que tem de sair no fim. */
const CONTADOR_FARM = 4242;

/**
 * As tabelas de escopo semeadas, com a chave que identifica cada linha e as colunas CANÔNICAS que precisam
 * atravessar a purga com o mesmo valor. Quatro tabelas do escopo não têm coluna `id` — são ligações de PK
 * composta —, por isso a chave é uma expressão, não um nome de coluna.
 */
const ESCOPO: { tabela: string; chave: string; canonicas: string[]; linhas: number }[] = [
  { tabela: "areas", chave: "id::text", canonicas: ["empresa_id"], linhas: 2 },
  { tabela: "animals", chave: "id::text", canonicas: ["empresa_id"], linhas: 3 },
  { tabela: "batches", chave: "id::text", canonicas: ["empresa_id"], linhas: 2 },
  { tabela: "budget_plannings", chave: "id::text", canonicas: ["empresa_id"], linhas: 2 },
  { tabela: "documents", chave: "id::text", canonicas: ["empresa_id"], linhas: 2 },
  { tabela: "empresa_cost_centers", chave: "concat_ws('/', empresa_id::text, cost_center_id::text)", canonicas: ["empresa_id"], linhas: 3 },
  { tabela: "equipment_transfers", chave: "id::text", canonicas: ["empresa_origem_id", "empresa_destino_id"], linhas: 2 },
  { tabela: "equipments", chave: "id::text", canonicas: ["empresa_id"], linhas: 3 },
  { tabela: "financial_titles", chave: "id::text", canonicas: ["empresa_id"], linhas: 2 },
  { tabela: "input_entries", chave: "id::text", canonicas: ["empresa_id"], linhas: 1 },
  { tabela: "purchase_requests", chave: "id::text", canonicas: ["empresa_id"], linhas: 1 },
  { tabela: "sales_documents", chave: "id::text", canonicas: ["empresa_id"], linhas: 1 },
  { tabela: "service_orders", chave: "id::text", canonicas: ["empresa_id"], linhas: 2 },
  { tabela: "stock_movements", chave: "id::text", canonicas: ["empresa_id"], linhas: 6 },
  { tabela: "warehouse_transfers", chave: "id::text", canonicas: ["empresa_origem_id", "empresa_destino_id"], linhas: 1 },
  { tabela: "warehouses", chave: "id::text", canonicas: ["empresa_id"], linhas: 5 },
];

type Foto = Record<string, { k: string; valores: (string | null)[] }[]>;
type Inventario = {
  colunasLegadas: number; viewsLegadas: number; gatilhosEspelho: number; funcoesSincronia: number;
  fksLegadas: number; indicesLegados: number; policiesComColunaLegada: number; checkLegado: number;
  checkCanonico: number; fksCompostasValidadas: number; tabelas: number;
};

let antes: Inventario;
let depois: Inventario;
let fotoAntes: Foto;
let fotoDepois: Foto;
let aplicadasNaPurga: string[] = [];
/** Resultado dos 52 pares legado × canônico conferidos ANTES da purga. */
let paresConferidos = 0;
let paresDivergentes: string[] = [];
let paresComAcervo = 0;
/** Espelho da 0014 observado durante o seed: canônica → legada, e legada → canônica. */
let espelhoCanonicaParaLegada: { empresa_id: string; farm_id: string } | null = null;
let espelhoLegadaParaCanonica: { empresa_id: string; farm_id: string } | null = null;
let contadorAntes: string | null = null;
/** Casos de coluna legada NULA, medidos ANTES da purga — depois dela a coluna nem existe para consultar. */
let nulosAntes: { docs: number; orcs: number } | null = null;

async function num(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: string }>(sql, params);
  return Number(r.rows[0]!.n);
}

async function inventariar(): Promise<Inventario> {
  return {
    colunasLegadas: await num(`select count(*)::text n from pg_attribute a
        join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
         and a.attname in ('farm_id','origin_farm_id','destination_farm_id')`),
    viewsLegadas: await num(`select count(*)::text n from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and c.relkind = 'v'
         and c.relname in ('farms','proprietary_farms','authorizer_farms','bank_account_farms','farm_cost_centers')`),
    gatilhosEspelho: await num(`select count(*)::text n from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where not t.tgisinternal and p.proname like 'sincronizar_empresa%'`),
    funcoesSincronia: await num(`select count(*)::text n from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'erp' and p.proname like 'sincronizar_empresa%'`),
    fksLegadas: await num(`select count(*)::text n from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 1
         and a.attname in ('farm_id','origin_farm_id','destination_farm_id')`),
    indicesLegados: await num(`select count(*)::text n from pg_index i
        join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and exists (select 1 from pg_attribute a
              where a.attrelid = i.indrelid and a.attnum = any(i.indkey::int2[])
                and a.attname in ('farm_id','origin_farm_id','destination_farm_id'))`),
    policiesComColunaLegada: await num(`select count(*)::text n from pg_policies
       where schemaname = 'erp'
         and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(farm_id|origin_farm_id|destination_farm_id)'`),
    checkLegado: await num(`select count(*)::text n from pg_constraint
       where conrelid = 'erp.equipment_transfers'::regclass and contype = 'c'
         and conname = 'equipment_transfers_check'`),
    checkCanonico: await num(`select count(*)::text n from pg_constraint
       where conrelid = 'erp.equipment_transfers'::regclass and contype = 'c'
         and conname = 'equipment_transfers_empresa_origem_destino_check' and convalidated`),
    // Alvo por OID: o texto de pg_get_constraintdef qualifica o schema conforme o search_path da sessão.
    fksCompostasValidadas: await num(`select count(*)::text n from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
         and k.confrelid = 'erp.empresas'::regclass and k.convalidated`),
    tabelas: await num(`select count(*)::text n from information_schema.tables
       where table_schema = 'erp' and table_type = 'BASE TABLE'`),
  };
}

/** Fotografia do dado canônico: chave da linha + valor de cada coluna canônica, ordenado pela chave. */
async function fotografar(): Promise<Foto> {
  const foto: Foto = {};
  for (const e of ESCOPO) {
    const cols = e.canonicas.map((c) => `${c}::text`).join(", ");
    const r = await db.query<Record<string, string | null>>(
      `select ${e.chave} as k, ${cols} from erp.${e.tabela} order by 1`);
    foto[e.tabela] = r.rows.map((linha) => ({
      k: linha.k as string, valores: e.canonicas.map((c) => linha[c] ?? null),
    }));
  }
  return foto;
}

async function subirAte16(): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purga-upgrade-ate16-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const anteriores = listMigrations().map((m) => m.name).filter((nome) => nome < ALVO);
    expect(anteriores.length, "16 migrations antes da purga").toBe(16);
    for (const nome of anteriores) fs.copyFileSync(path.join(MIGRATIONS_DIR, nome), path.join(dir, nome));
    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const ate16 = await import("../src/migrate.js");
    expect(ate16.listMigrations().map((m) => m.name), "o runner da fase dual não conhece a purga").not.toContain(ALVO);
    return await ate16.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR;
    else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Semeia o acervo no schema da fase DUAL, alternando o vocabulário de escrita de propósito. */
async function semearAcervo() {
  const q = (sql: string, p: unknown[] = []) => db.query(sql, p);
  const uma = async <T extends QueryResultRow>(sql: string, p: unknown[] = []): Promise<T> =>
    (await db.query<T>(sql, p)).rows[0]!;

  await q("insert into erp.organizations(id,name,slug) values ($1,'[TEST] Purga A','purga-a'),($2,'[TEST] Purga B','purga-b')", [ORG_A, ORG_B]);
  await q("insert into erp.users(id,email,name,password_hash) values ($1,'purga@t.local','Purga','x')", [USER]);
  await q("insert into erp.organization_members(organization_id,user_id,is_owner) values ($1,$2,true),($3,$2,true)", [ORG_A, USER, ORG_B]);
  // Duas organizations, três e duas empresas: o recorte por tenant tem de continuar separando depois da purga.
  await q(`insert into erp.empresas(id,organization_id,code,name) values
             ($1,$6,1,'Empresa A1'),($2,$6,2,'Empresa A2'),($3,$6,3,'Empresa A3'),
             ($4,$7,1,'Empresa B1'),($5,$7,2,'Empresa B2')`,
    [EMP_A1, EMP_A2, EMP_A3, EMP_B1, EMP_B2, ORG_A, ORG_B]);

  // O contador de transição, com valor próprio: a fatia não pode encostar nele.
  await q("insert into erp.code_sequences(organization_id,entity,last_value) values ($1,'farm',$2)", [ORG_A, CONTADOR_FARM]);

  const um = await uma<{ id: string }>("insert into erp.measurement_units(symbol,name) values ('KG','Quilograma') returning id");
  const esp = await uma<{ id: string }>("insert into erp.animal_species(name) values ('Bovino') returning id");
  const catAnimal = await uma<{ id: string }>("insert into erp.animal_categories(species_id,name) values ($1,'Garrote') returning id", [esp.id]);

  const refs: Record<string, { grupo: string; cat: string; kind: string; fin: string; prod: string; pessoa: string; docTipo: string; cc1: string; cc2: string }> = {};
  for (const org of [ORG_A, ORG_B]) {
    const grupo = await uma<{ id: string }>("insert into erp.product_groups(organization_id,name) values ($1,'Insumos') returning id", [org]);
    const cat = await uma<{ id: string }>("insert into erp.product_categories(organization_id,group_id,name) values ($1,$2,'Nutrição') returning id", [org, grupo.id]);
    const kind = await uma<{ id: string }>("insert into erp.product_kinds(organization_id,category_id,name) values ($1,$2,'Sal') returning id", [org, cat.id]);
    const fin = await uma<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature) values ($1,'2.01','Insumos','expense') returning id", [org]);
    const prod = await uma<{ id: string }>(
      `insert into erp.products(organization_id,code,description,measurement_id,group_id,category_id,kind_id,control_stock,financial_category_id)
         values ($1,'00001','Sal Mineral',$2,$3,$4,$5,true,$6) returning id`, [org, um.id, grupo.id, cat.id, kind.id, fin.id]);
    const pessoa = await uma<{ id: string }>("insert into erp.people(organization_id,code,name,is_provider,is_client) values ($1,'00001','Parceiro',true,true) returning id", [org]);
    const docTipo = await uma<{ id: string }>("insert into erp.document_types(organization_id,name) values ($1,'Contrato') returning id", [org]);
    const cc1 = await uma<{ id: string }>("insert into erp.cost_centers(organization_id,code,name) values ($1,'1','Geral') returning id", [org]);
    const cc2 = await uma<{ id: string }>("insert into erp.cost_centers(organization_id,code,name) values ($1,'2','Segundo') returning id", [org]);
    refs[org] = { grupo: grupo.id, cat: cat.id, kind: kind.id, fin: fin.id, prod: prod.id, pessoa: pessoa.id, docTipo: docTipo.id, cc1: cc1.id, cc2: cc2.id };
  }

  // ------------------------------------------------------------------------------------------------
  // O ESPELHO DA 0014, OBSERVADO. Escrever só um lado e ver o outro aparecer é o que prova que este
  // acervo é mesmo da fase dual — e não um estado montado à mão que a 0017 nunca encontraria.
  // ------------------------------------------------------------------------------------------------
  espelhoCanonicaParaLegada = await uma<{ empresa_id: string; farm_id: string }>(
    `insert into erp.warehouses(organization_id,empresa_id,initials,description) values ($1,$2,'ALM','Almoxarifado A1')
       returning empresa_id::text, farm_id::text`, [ORG_A, EMP_A1]);
  espelhoLegadaParaCanonica = await uma<{ empresa_id: string; farm_id: string }>(
    `insert into erp.warehouses(organization_id,farm_id,initials,description) values ($1,$2,'SIL','Silo A2')
       returning empresa_id::text, farm_id::text`, [ORG_A, EMP_A2]);

  const almA1 = await uma<{ id: string }>("select id from erp.warehouses where organization_id=$1 and initials='ALM'", [ORG_A]);
  const silA2 = await uma<{ id: string }>("select id from erp.warehouses where organization_id=$1 and initials='SIL'", [ORG_A]);
  // Terceiro armazém de A com os DOIS lados escritos iguais — o caso que a 0014 também aceita.
  await q("insert into erp.warehouses(organization_id,empresa_id,farm_id,initials,description) values ($1,$2,$2,'DEP','Depósito A3')", [ORG_A, EMP_A3]);
  await q("insert into erp.warehouses(organization_id,empresa_id,initials,description) values ($1,$2,'ALB','Almoxarifado B1')", [ORG_B, EMP_B1]);
  await q("insert into erp.warehouses(organization_id,farm_id,initials,description) values ($1,$2,'SIB','Silo B2')", [ORG_B, EMP_B2]);

  await q("insert into erp.areas(organization_id,empresa_id,code,name) values ($1,$2,'A1','Talhão 1'),($1,$3,'A2','Talhão 2')", [ORG_A, EMP_A1, EMP_A2]);
  await q("insert into erp.batches(organization_id,farm_id,code,batch_date,description) values ($1,$2,'L1',current_date,'Lote 1'),($1,$3,'L2',current_date,'Lote 2')", [ORG_A, EMP_A1, EMP_A3]);
  await q(`insert into erp.animals(organization_id,empresa_id,species_id,category_id,entry_date,sex) values
             ($1,$2,$4,$5,current_date,'M'),($1,$3,$4,$5,current_date,'F')`, [ORG_A, EMP_A1, EMP_A2, esp.id, catAnimal.id]);
  await q("insert into erp.animals(organization_id,farm_id,species_id,category_id,entry_date,sex) values ($1,$2,$3,$4,current_date,'M')", [ORG_B, EMP_B1, esp.id, catAnimal.id]);

  await q("insert into erp.equipments(organization_id,empresa_id,code,description) values ($1,$2,'0001','Trator'),($1,$3,'0002','Colheitadeira')", [ORG_A, EMP_A1, EMP_A2]);
  await q("insert into erp.equipments(organization_id,farm_id,code,description) values ($1,$2,'0001','Pulverizador')", [ORG_B, EMP_B2]);

  await q(`insert into erp.financial_titles(organization_id,empresa_id,code,direction,number,amount,emission_date,due_date,person_id)
             values ($1,$2,'00001','payable','NF-1','100.00',current_date,current_date,$3)`, [ORG_A, EMP_A1, refs[ORG_A]!.pessoa]);
  await q(`insert into erp.financial_titles(organization_id,farm_id,code,direction,number,amount,emission_date,due_date,person_id)
             values ($1,$2,'00001','receivable','NF-2','250.00',current_date,current_date,$3)`, [ORG_B, EMP_B2, refs[ORG_B]!.pessoa]);
  await q("insert into erp.input_entries(organization_id,empresa_id,code,entry_date) values ($1,$2,'00001',current_date)", [ORG_A, EMP_A1]);
  await q(`insert into erp.purchase_requests(organization_id,farm_id,code,request_date,request_type,requester_user_id,description,justification)
             values ($1,$2,'00001',current_date,'product',$3,'Compra','Reposição')`, [ORG_A, EMP_A2, USER]);
  await q("insert into erp.sales_documents(organization_id,empresa_id,kind,code,document_date,client_id) values ($1,$2,'sale','00001',current_date,$3)", [ORG_A, EMP_A1, refs[ORG_A]!.pessoa]);
  await q("insert into erp.service_orders(organization_id,empresa_id,code,order_date) values ($1,$2,'00001',current_date)", [ORG_A, EMP_A3]);
  await q("insert into erp.service_orders(organization_id,farm_id,code,order_date) values ($1,$2,'00001',current_date)", [ORG_B, EMP_B1]);

  // Ligações de PK composta, sem coluna `id` — a policy api_child decide justamente sobre esta tabela.
  await q("insert into erp.empresa_cost_centers(empresa_id,cost_center_id) values ($1,$3),($2,$4)", [EMP_A1, EMP_A2, refs[ORG_A]!.cc1, refs[ORG_A]!.cc2]);
  await q("insert into erp.empresa_cost_centers(farm_id,cost_center_id) values ($1,$2)", [EMP_B1, refs[ORG_B]!.cc1]);

  // COLUNA LEGADA NULA onde a coluna permite: o par da migration compara com `is distinct from`, e nulo dos
  // dois lados não é divergência. Sem este caso, a pré-condição 4.6 nunca seria exercida com nulo.
  await q("insert into erp.documents(organization_id,document_type_id,title) values ($1,$2,'Sem empresa')", [ORG_A, refs[ORG_A]!.docTipo]);
  await q("insert into erp.documents(organization_id,empresa_id,document_type_id,title) values ($1,$2,$3,'Com empresa')", [ORG_A, EMP_A1, refs[ORG_A]!.docTipo]);
  await q("insert into erp.budget_plannings(organization_id,code,planning_date,year) values ($1,'ORC-1',current_date,2026)", [ORG_A]);
  await q("insert into erp.budget_plannings(organization_id,farm_id,code,planning_date,year) values ($1,$2,'ORC-2',current_date,2026)", [ORG_A, EMP_A2]);

  // LEDGER append-only (erp.stock_movements): só INSERT, nenhum gatilho é desligado para montar o cenário.
  for (let i = 0; i < 6; i++) {
    const org = i < 4 ? ORG_A : ORG_B;
    const emp = i < 4 ? (i % 2 === 0 ? EMP_A1 : EMP_A2) : (i === 4 ? EMP_B1 : EMP_B2);
    const arm = i < 4 ? (i % 2 === 0 ? almA1.id : silA2.id)
      : (await uma<{ id: string }>("select id from erp.warehouses where organization_id=$1 and initials=$2", [ORG_B, i === 4 ? "ALB" : "SIB"])).id;
    // Metade escrita pelo vocabulário canônico, metade pelo legado — os dois caminhos convivem na 0014.
    const coluna = i % 2 === 0 ? "empresa_id" : "farm_id";
    await q(
      `insert into erp.stock_movements(organization_id,${coluna},warehouse_id,product_id,movement_type,direction,quantity,unit_cost,source_type,source_id,movement_date,created_by)
         values ($1,$2,$3,$4,'entry',1,$5,$6,'input_entry',gen_random_uuid(),current_date,$7)`,
      [org, emp, arm, refs[org]!.prod, String(10 + i), String(2 + i), USER]);
  }

  // Transferências com ORIGEM DIFERENTE DE DESTINO: é a invariante que a 0017 transporta do CHECK legado
  // para o canônico. Uma escrita pelo lado canônico, outra pelo legado.
  await q(`insert into erp.equipment_transfers(organization_id,code,transfer_date,equipment_id,empresa_origem_id,empresa_destino_id)
             select $1,'TR-1',current_date,e.id,$2,$3 from erp.equipments e where e.organization_id=$1 and e.code='0001'`, [ORG_A, EMP_A1, EMP_A2]);
  await q(`insert into erp.equipment_transfers(organization_id,code,transfer_date,equipment_id,origin_farm_id,destination_farm_id)
             select $1,'TR-2',current_date,e.id,$2,$3 from erp.equipments e where e.organization_id=$1 and e.code='0002'`, [ORG_A, EMP_A2, EMP_A3]);
  await q(`insert into erp.warehouse_transfers(organization_id,code,transfer_date,kind,empresa_origem_id,origin_warehouse_id,empresa_destino_id,destination_warehouse_id)
             values ($1,'TA-1',current_date,'farm',$2,$3,$4,$5)`, [ORG_A, EMP_A1, almA1.id, EMP_A2, silA2.id]);

  contadorAntes = (await uma<{ last_value: string }>(
    "select last_value::text from erp.code_sequences where organization_id=$1 and entity='farm'", [ORG_A])).last_value;
}

/** Os 52 pares legado × canônico, montados a partir do CATÁLOGO — não de uma lista copiada da migration. */
async function conferirPares() {
  const pares = (await db.query<{ tabela: string; legada: string; canonica: string }>(
    `select c.relname tabela, a.attname legada,
            case a.attname when 'farm_id' then 'empresa_id'
                           when 'origin_farm_id' then 'empresa_origem_id'
                           else 'empresa_destino_id' end canonica
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'erp' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        and a.attname in ('farm_id','origin_farm_id','destination_farm_id')
      order by c.relname, a.attname`)).rows;
  paresConferidos = pares.length;
  paresDivergentes = [];
  paresComAcervo = 0;
  for (const p of pares) {
    const r = await db.query<{ divergentes: string; linhas: string }>(
      `select count(*) filter (where ${p.legada} is distinct from ${p.canonica})::text divergentes,
              count(*)::text linhas from erp.${p.tabela}`);
    if (Number(r.rows[0]!.divergentes) > 0) paresDivergentes.push(`${p.tabela}.${p.legada}`);
    if (Number(r.rows[0]!.linhas) > 0) paresComAcervo += 1;
  }
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  await subirAte16();
  await semearAcervo();

  antes = await inventariar();
  fotoAntes = await fotografar();
  const nulos = (await db.query<{ docs: string; orcs: string }>(
    `select (select count(*)::text from erp.documents where farm_id is null and empresa_id is null) docs,
            (select count(*)::text from erp.budget_plannings where farm_id is null and empresa_id is null) orcs`)).rows[0]!;
  nulosAntes = { docs: Number(nulos.docs), orcs: Number(nulos.orcs) };
  await conferirPares();

  // A purga pelo RUNNER REAL: o ledger já tem as 16, então só a 0017 fica pendente.
  aplicadasNaPurga = await migrate(db, () => {});

  depois = await inventariar();
  fotoDepois = await fotografar();
}, 300_000);

afterAll(async () => { await db?.end(); });

describe("premissa: o banco semeado está mesmo na fase DUAL da 0014", () => {
  it("escrever só a coluna canônica espelha na legada", () => {
    expect(espelhoCanonicaParaLegada, "o insert canônico retornou linha").toBeTruthy();
    expect(espelhoCanonicaParaLegada!.empresa_id).toBe(EMP_A1);
    expect(espelhoCanonicaParaLegada!.farm_id, "o gatilho da 0014 copiou para o lado legado").toBe(EMP_A1);
  });

  it("escrever só a coluna legada espelha na canônica", () => {
    expect(espelhoLegadaParaCanonica!.farm_id).toBe(EMP_A2);
    expect(espelhoLegadaParaCanonica!.empresa_id, "o gatilho da 0014 copiou para o lado canônico").toBe(EMP_A2);
  });

  it("o acervo cobre duas organizations, cinco empresas e as quinze tabelas de escopo", async () => {
    const r = (await db.query<{ orgs: string; emps: string; empa: string; empb: string }>(
      `select (select count(*)::text from erp.organizations) orgs,
              (select count(*)::text from erp.empresas) emps,
              (select count(*)::text from erp.empresas where organization_id = $1) empa,
              (select count(*)::text from erp.empresas where organization_id = $2) empb`, [ORG_A, ORG_B])).rows[0]!;
    expect(Number(r.orgs)).toBe(2);
    expect(Number(r.emps)).toBe(5);
    expect(Number(r.empa), "três empresas na organization A").toBe(3);
    expect(Number(r.empb), "duas empresas na organization B").toBe(2);
    for (const e of ESCOPO) {
      expect(fotoAntes[e.tabela]!.length, `linhas semeadas em erp.${e.tabela}`).toBe(e.linhas);
    }
  });

  it("há caso com a coluna legada NULA onde a coluna permite", () => {
    // Medido no beforeAll, com a 0016 aplicada: depois da purga a coluna legada não existe nem para consultar.
    expect(nulosAntes!.docs, "erp.documents com os dois lados nulos").toBe(1);
    expect(nulosAntes!.orcs, "erp.budget_plannings com os dois lados nulos").toBe(1);
  });

  it("há transferência de equipamento e de armazém com origem diferente de destino", async () => {
    const r = (await db.query<{ eq: string; wh: string }>(
      `select (select count(*)::text from erp.equipment_transfers where empresa_origem_id <> empresa_destino_id) eq,
              (select count(*)::text from erp.warehouse_transfers where empresa_origem_id <> empresa_destino_id) wh`)).rows[0]!;
    expect(Number(r.eq)).toBe(2);
    expect(Number(r.wh)).toBe(1);
  });
});

describe("ANTES da 0017: a ponte inteira de pé e zero divergência no acervo", () => {
  it("52 colunas, 5 views, 52 gatilhos, 3 funções, 52 FKs, 8 índices, 1 policy, 1 CHECK legado", () => {
    expect(antes.colunasLegadas).toBe(52);
    expect(antes.viewsLegadas).toBe(5);
    expect(antes.gatilhosEspelho).toBe(52);
    expect(antes.funcoesSincronia).toBe(3);
    expect(antes.fksLegadas).toBe(52);
    expect(antes.indicesLegados).toBe(8);
    expect(antes.policiesComColunaLegada, "erp.empresa_cost_centers.api_child ainda decidia por farm_id").toBe(1);
    expect(antes.checkLegado).toBe(1);
    expect(antes.checkCanonico, "o CHECK canônico é criado PELA purga").toBe(0);
    expect(antes.fksCompostasValidadas, "as 50 compostas já existem desde a 0014").toBe(50);
  });

  it("os 52 pares legado × canônico foram conferidos, com acervo, e nenhum diverge", () => {
    expect(paresConferidos, "52 pares montados a partir do catálogo").toBe(52);
    expect(paresDivergentes, "divergência abortaria a purga — e com razão").toEqual([]);
    // Sem esta linha, "nenhum par diverge" seria verdade por vacuidade num banco sem uma única linha.
    // 18, não 16: erp.equipment_transfers e erp.warehouse_transfers contribuem DOIS pares cada (origem e
    // destino), e as duas foram semeadas.
    expect(paresComAcervo, "18 dos 52 pares têm linha de verdade para comparar").toBe(18);
  });
});

describe("a 0017 aplica sobre o acervo", () => {
  it("o runner real aplica só a purga", () => {
    expect(aplicadasNaPurga).toEqual([ALVO]);
  });

  it("e o ledger fecha com 17 entradas", async () => {
    const ledger = (await db.query<{ name: string }>("select name from public.erp_migrations order by name")).rows.map((r) => r.name);
    expect(ledger.length).toBe(17);
    expect(ledger[16]).toBe(ALVO);
  });
});

describe("DEPOIS da 0017: a ponte legada sumiu", () => {
  it("colunas, views, gatilhos, funções, FKs, índices e policy legada zerados", () => {
    expect(depois.colunasLegadas).toBe(0);
    expect(depois.viewsLegadas).toBe(0);
    expect(depois.gatilhosEspelho).toBe(0);
    expect(depois.funcoesSincronia).toBe(0);
    expect(depois.fksLegadas).toBe(0);
    expect(depois.indicesLegados).toBe(0);
    expect(depois.policiesComColunaLegada).toBe(0);
    expect(depois.checkLegado).toBe(0);
  });

  it("o canônico ficou: 50 FKs compostas validadas, CHECK canônico validado, nenhuma tabela a menos", () => {
    expect(depois.fksCompostasValidadas).toBe(50);
    expect(depois.checkCanonico).toBe(1);
    expect(depois.tabelas).toBe(antes.tabelas);
    expect(antes.tabelas, "premissa: o schema estava inteiro").toBe(181);
  });

  it("a policy api_child de erp.empresa_cost_centers é UMA, e canônica", async () => {
    const policies = (await db.query<{ policyname: string; cmd: string; qual: string; with_check: string | null }>(
      `select policyname, cmd, qual, with_check from pg_policies
        where schemaname = 'erp' and tablename = 'empresa_cost_centers' order by policyname`)).rows;
    expect(policies.length).toBe(1);
    expect(policies[0]!.policyname).toBe("api_child");
    expect(policies[0]!.cmd).toBe("ALL");
    expect(policies[0]!.qual).toContain("empresa_cost_centers.empresa_id");
    expect(policies[0]!.with_check).toBeTruthy();
    expect(policies[0]!.with_check!).toContain("empresa_cost_centers.empresa_id");
  });

  it("a coluna legada não existe mais nem para o SQL — escrever nela é erro de coluna inexistente", async () => {
    // Catálogo limpo e tabela ainda aceitando `farm_id` seriam contraditórios, mas só um dos dois é testado
    // por contagem. Este caso fecha o outro lado.
    await expect(
      db.query("insert into erp.warehouses(organization_id,farm_id,initials,description) values ($1,$2,'XXX','X')", [ORG_A, EMP_A1]),
    ).rejects.toThrow(/farm_id/);
  });
});

describe("e o DADO CANÔNICO sobreviveu — que é o ponto deste arquivo", () => {
  it("nenhuma tabela de escopo perdeu linha", () => {
    for (const e of ESCOPO) {
      expect(fotoDepois[e.tabela]!.length, `erp.${e.tabela} mantém as ${e.linhas} linhas`).toBe(e.linhas);
    }
  });

  it("e o valor de empresa_id (e de origem/destino) é o MESMO, linha a linha, em todas elas", () => {
    // Igualdade de contagem não basta: uma purga que zerasse empresa_id manteria o número de linhas.
    for (const e of ESCOPO) {
      expect(fotoDepois[e.tabela], `erp.${e.tabela} valor a valor`).toEqual(fotoAntes[e.tabela]);
    }
  });

  it("e nenhum valor canônico virou nulo nas colunas que não admitem nulo", async () => {
    const nulos = await num(
      `select (
         (select count(*) from erp.warehouses where empresa_id is null) +
         (select count(*) from erp.animals where empresa_id is null) +
         (select count(*) from erp.equipments where empresa_id is null) +
         (select count(*) from erp.stock_movements where empresa_id is null) +
         (select count(*) from erp.empresa_cost_centers where empresa_id is null) +
         (select count(*) from erp.equipment_transfers where empresa_origem_id is null or empresa_destino_id is null) +
         (select count(*) from erp.warehouse_transfers where empresa_origem_id is null or empresa_destino_id is null)
       )::text n`);
    expect(nulos).toBe(0);
  });

  it("o recorte por organization continua separando as duas", async () => {
    const r = (await db.query<{ a: string; b: string; cruzado: string }>(
      `select (select count(*)::text from erp.warehouses where organization_id = $1) a,
              (select count(*)::text from erp.warehouses where organization_id = $2) b,
              (select count(*)::text from erp.warehouses w join erp.empresas e on e.id = w.empresa_id
                where e.organization_id <> w.organization_id) cruzado`, [ORG_A, ORG_B])).rows[0]!;
    expect(Number(r.a), "três armazéns na organization A").toBe(3);
    expect(Number(r.b), "dois na organization B").toBe(2);
    expect(Number(r.cruzado), "nenhuma linha apontando empresa de outro tenant").toBe(0);
  });

  it("o contador entity='farm' continua exatamente como estava", async () => {
    const r = (await db.query<{ last_value: string; n: string }>(
      `select coalesce(max(last_value)::text,'-') last_value, count(*)::text n
         from erp.code_sequences where organization_id = $1 and entity = 'farm'`, [ORG_A])).rows[0]!;
    expect(contadorAntes, "premissa: o contador foi semeado com valor próprio").toBe(String(CONTADOR_FARM));
    expect(Number(r.n), "a linha continua lá — a purga não é a 05C-2").toBe(1);
    expect(r.last_value, "e com o mesmo valor").toBe(String(CONTADOR_FARM));
  });
});

describe("as invariantes canônicas continuam valendo para escrita nova", () => {
  it("transferência de equipamento com origem = destino é recusada pelo CHECK canônico", async () => {
    await expect(db.query(
      `insert into erp.equipment_transfers(organization_id,code,transfer_date,equipment_id,empresa_origem_id,empresa_destino_id)
         select $1,'TR-9',current_date,e.id,$2,$2 from erp.equipments e where e.organization_id=$1 and e.code='0001'`,
      [ORG_A, EMP_A1])).rejects.toThrow(/equipment_transfers_empresa_origem_destino_check/);
  });

  it("e a FK composta continua recusando empresa de outro tenant", async () => {
    // EMP_B1 é da organization B: gravá-la sob ORG_A tem de falhar na composta (organization_id, empresa_id).
    await expect(db.query(
      "insert into erp.warehouses(organization_id,empresa_id,initials,description) values ($1,$2,'ZZZ','Cruzado')",
      [ORG_A, EMP_B1])).rejects.toThrow(/foreign key|violates/i);
  });

  it("escrita canônica nova continua funcionando depois da purga", async () => {
    const r = (await db.query<{ empresa_id: string }>(
      `insert into erp.warehouses(organization_id,empresa_id,initials,description) values ($1,$2,'NOV','Novo')
         returning empresa_id::text`, [ORG_A, EMP_A3])).rows[0]!;
    expect(r.empresa_id).toBe(EMP_A3);
  });
});
