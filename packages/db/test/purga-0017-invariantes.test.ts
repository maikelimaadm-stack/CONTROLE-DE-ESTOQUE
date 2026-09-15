import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPool, type Db, type Tx } from "../src/pool.js";
import { migrate, resetSchema, listMigrations, MIGRATIONS_DIR } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";
// @ts-expect-error — SSOT das dispensas de FK composta em JS puro, compartilhado com o gerador da matriz
import { SEM_FK_COMPOSTA_DECLARADA } from "../../domain/empresa-rls.mjs";

/**
 * AS INVARIANTES ESTRUTURAIS DEPOIS DA PURGA (0017) — PRE-BASE2-05C-1.
 *
 * `purga-0017-fresh.test.ts` pergunta "o que a purga REMOVEU?" e `purga-0017-upgrade.test.ts` pergunta "o
 * acervo sobreviveu?". Falta a terceira pergunta, que é a única que interessa ao runtime no dia seguinte:
 * **o que sobrou ainda PROVA o que promete?** Uma FK composta que continua no catálogo mas aponta para o
 * alvo errado, ou que voltou `NOT VALID`, ou um CHECK que existe mas foi neutralizado por um `or true`,
 * passam em qualquer contagem de objeto e não seguram nada.
 *
 * Por isso cada afirmação aqui é feita de duas formas que se cobrem:
 *
 *  - ESTRUTURAL, por OID e `attnum`, nunca pelo texto de `pg_get_constraintdef`. Aquele texto qualifica o
 *    schema conforme o `search_path` da sessão ("REFERENCES empresas" ou "REFERENCES erp.empresas"), então
 *    um guarda que casa string aprova ou reprova por causa de variável de ambiente. `confrelid` é a tabela
 *    alvo, `conkey`/`confkey` são as colunas de origem e destino NA ORDEM, e `convalidated` diz se a
 *    restrição responde pelo acervo. Isso é imune a `search_path` e a renomeação de constraint.
 *  - COMPORTAMENTAL, executando a escrita que a invariante tem de recusar e a escrita que ela tem de
 *    aceitar. Só o par distingue "a regra existe" de "a regra funciona": um CHECK invertido reprova a
 *    escrita boa, um CHECK neutralizado aceita a escrita ruim, e nenhum dos dois é visível numa contagem.
 *
 * NADA PASSA POR VACUIDADE. Toda contagem final tem, ao lado, a contagem da premissa: o universo medido
 * antes (52 colunas canônicas, 50 compostas, 181 tabelas, 227 políticas, duas organizações semeadas com
 * linhas de verdade). Uma consulta que voltasse vazia por rename de schema derrubaria a premissa primeiro.
 *
 * O ESTADO PRÉ-0017 é MEDIDO, não suposto: o `beforeAll` sobe 0001..0016, fotografa RLS e políticas, e só
 * então aplica a purga pelo runner real. "Nada afrouxado" é uma comparação entre duas fotos, não uma
 * leitura otimista da foto final.
 */
let db: Db;

const ALVO = "0017_purge_farm_legacy.sql";

/**
 * MODO BANCO PRONTO — o que torna este arquivo utilizável como GATE de verificação reversa.
 *
 * Para provar que um gate reprova, é preciso quebrar a invariante NO BANCO e rodar o gate por cima do
 * banco quebrado. Se o `beforeAll` sempre recriasse o schema, a sabotagem seria apagada antes da primeira
 * asserção e o gate nunca teria chance de reprovar — um gate que só sabe olhar um banco que ele mesmo
 * acabou de montar não prova nada sobre o banco que está de pé.
 *
 * Com `PURGA_INV_BANCO_PRONTO=1` o arquivo NÃO toca no schema e mede o que já existe. Isso não afrouxa
 * nada: TODAS as asserções continuam rodando, inclusive a comparação com o estado pré-0017, que é lida da
 * foto gravada pela execução completa. Falta de foto é ERRO, nunca dispensa.
 */
const BANCO_PRONTO = process.env.PURGA_INV_BANCO_PRONTO === "1";

/** Onde a foto do pré-0017 fica entre uma execução completa e uma execução em modo banco pronto. */
const TABELA_FOTO = "public.purga_0017_estado_pre";
const CHAVE_FOTO = "rls_pre_0017";

/** As duas colunas de `erp.empresas` que a referência canônica tem de citar, nessa ordem. */
const ALVO_CANONICO = ["organization_id", "id"];

/**
 * As quatro tabelas de ligação do escopo que NÃO têm `organization_id` (PK composta, sem coluna `id`).
 * Sem coluna de tenant a referência composta `(organization_id, empresa_id)` é impossível de escrever —
 * elas ficam fora do universo da invariante 1 por CONSTRUÇÃO. A lista está nomeada aqui para que o
 * universo não possa encolher em silêncio: quem apagar `organization_id` de uma quinta tabela para
 * escapar da composta cai nesta asserção, não numa dispensa automática.
 */
const LIGACOES_SEM_TENANT = [
  "authorizer_empresas", "bank_account_empresas", "empresa_cost_centers", "proprietary_empresas",
];

type Tabela = { tabela: string; rls: boolean; forcada: boolean };
type Politica = { tabela: string; politica: string; cmd: string; permissiva: string; papeis: string; usando: string; checando: string };
type EstadoRls = { tabelas: Tabela[]; politicas: Politica[] };

let antes: EstadoRls;
let depois: EstadoRls;

async function num(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: string }>(sql, params);
  return Number(r.rows[0]!.n);
}

async function lerEstadoRls(): Promise<EstadoRls> {
  const t = await db.query<Tabela>(
    `select c.relname as tabela, c.relrowsecurity as rls, c.relforcerowsecurity as forcada
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'erp' and c.relkind = 'r' order by c.relname`);
  // `pg_policies.roles` é `name[]` e o driver o entrega como TEXTO por não ter decodificador para esse
  // tipo; o banco converte para `text[]` e depois para uma string estável, que é o que se compara.
  const p = await db.query<Politica>(
    `select tablename as tabela, policyname as politica, cmd, permissive as permissiva,
            array_to_string(roles::text[], ',') as papeis,
            coalesce(qual, '') as usando, coalesce(with_check, '') as checando
       from pg_policies where schemaname = 'erp' order by tablename, policyname, cmd`);
  return { tabelas: t.rows, politicas: p.rows };
}

/**
 * Sobe o banco só até a 0016. `MIGRATIONS_DIR` é lido na CARGA do módulo `migrate.js`, então apontar o
 * runner para outro diretório exige recarregá-lo — mesmo mecanismo de `purga-0017-fresh.test.ts`. O módulo
 * importado no topo deste arquivo continua apontado para `supabase/migrations`, e é ele que aplica a 0017.
 */
async function subirAte16(): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purga-inv-ate16-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const anteriores = listMigrations().map((m) => m.name).filter((nome) => nome < ALVO);
    expect(anteriores.length, "o diretório real tem as 16 migrations anteriores à purga").toBe(16);
    for (const nome of anteriores) fs.copyFileSync(path.join(MIGRATIONS_DIR, nome), path.join(dir, nome));
    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const ate16 = await import("../src/migrate.js");
    expect(ate16.MIGRATIONS_DIR, "o módulo recarregado enxerga o diretório sem a purga").toBe(dir);
    return await ate16.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR;
    else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function gravarFoto(estado: EstadoRls): Promise<void> {
  await db.query(`create table if not exists ${TABELA_FOTO} (
    chave text primary key, conteudo jsonb not null, gravado_em timestamptz not null default now())`);
  await db.query(`insert into ${TABELA_FOTO} (chave, conteudo) values ($1, $2::jsonb)
    on conflict (chave) do update set conteudo = excluded.conteudo, gravado_em = now()`,
    [CHAVE_FOTO, JSON.stringify(estado)]);
}

async function lerFoto(): Promise<EstadoRls> {
  const existe = await db.query<{ t: string | null }>(`select to_regclass($1)::text as t`, [TABELA_FOTO]);
  if (!existe.rows[0]!.t) {
    throw new Error(`${TABELA_FOTO} não existe: rode este arquivo UMA vez sem PURGA_INV_BANCO_PRONTO para gravar a foto do pré-0017. Sem ela a comparação "nada afrouxado" não tem com o que comparar, e ausência de prova nunca vira dispensa.`);
  }
  const r = await db.query<{ conteudo: EstadoRls }>(`select conteudo from ${TABELA_FOTO} where chave = $1`, [CHAVE_FOTO]);
  if (!r.rows.length) throw new Error(`${TABELA_FOTO} não tem a linha '${CHAVE_FOTO}'.`);
  return r.rows[0]!.conteudo;
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  if (BANCO_PRONTO) {
    // Fail closed: modo banco pronto pressupõe a purga JÁ aplicada. Ledger incompleto é erro, não "pule".
    const ledger = await num("select count(*)::text n from public.erp_migrations where name = $1", [ALVO]);
    if (ledger !== 1) throw new Error(`PURGA_INV_BANCO_PRONTO=1 exige ${ALVO} no ledger deste banco; encontrou ${ledger}.`);
    antes = await lerFoto();
  } else {
    await resetSchema(db);
    const ate16 = await subirAte16();
    expect(ate16.length, "0001..0016 aplicadas em banco zero").toBe(16);
    antes = await lerEstadoRls();
    const naPurga = await migrate(db, () => {});
    expect(naPurga, "só a purga estava pendente, e ela aplicou").toEqual([ALVO]);
    await gravarFoto(antes);
  }
  depois = await lerEstadoRls();
}, 300_000);

afterAll(async () => { await db?.end(); });

// ---------------------------------------------------------------------------------------------------
// Cenário semeado: duas organizações com linhas de verdade. Tudo dentro de UMA transação desfeita no fim,
// para que o banco continue exatamente como estava — inclusive quando este arquivo roda como gate por
// cima de um banco já montado.
// ---------------------------------------------------------------------------------------------------
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const USUARIO_A = "1111aaaa-1111-4111-8111-111111111111";
const USUARIO_B = "2222aaaa-2222-4222-8222-222222222222";
const EMPRESA_A1 = "1111bbbb-1111-4111-8111-111111111111";
const EMPRESA_A2 = "1111bbbc-1111-4111-8111-111111111111";
const EMPRESA_B1 = "2222bbbb-2222-4222-8222-222222222222";
const EQUIP_A = "1111cccc-1111-4111-8111-111111111111";
const EQUIP_B = "2222cccc-2222-4222-8222-222222222222";

async function comCenario<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(`insert into erp.organizations(id, name) values ($1, 'Organização A'), ($2, 'Organização B')`, [ORG_A, ORG_B]);
    await c.query(`insert into erp.users(id, email, name) values ($1, 'a@invariantes.test', 'A'), ($2, 'b@invariantes.test', 'B')`, [USUARIO_A, USUARIO_B]);
    // Proprietário: `erp.escopo_empresa_total()` é verdadeiro para ele, então o que sobrar invisível será
    // recorte de TENANT, não falta de escopo de empresa — sem isso a leitura de dentro daria zero e o
    // isolamento passaria por vacuidade.
    await c.query(`insert into erp.organization_members(organization_id, user_id, is_owner, is_active)
                   values ($1, $2, true, true), ($3, $4, true, true)`, [ORG_A, USUARIO_A, ORG_B, USUARIO_B]);
    await c.query(`insert into erp.empresas(id, organization_id, code, name) values
                     ($1, $3, 1, 'Empresa A1'), ($2, $3, 2, 'Empresa A2'), ($4, $5, 1, 'Empresa B1')`,
      [EMPRESA_A1, EMPRESA_A2, ORG_A, EMPRESA_B1, ORG_B]);
    await c.query(`insert into erp.equipments(id, organization_id, code, description, empresa_id) values
                     ($1, $2, 'EQ-A', 'Equipamento A', $3), ($4, $5, 'EQ-B', 'Equipamento B', $6)`,
      [EQUIP_A, ORG_A, EMPRESA_A1, EQUIP_B, ORG_B, EMPRESA_B1]);
    await c.query(`insert into erp.registros_globais(organization_id, id_global, tipo_entidade, id_entidade, empresa_id, modulo, rota_canonica)
                   values ($1, 1, 'equipamento', $2, $3, 'frota', '/frota/equipamentos/1'),
                          ($4, 1, 'equipamento', $5, $6, 'frota', '/frota/equipamentos/1')`,
      [ORG_A, EQUIP_A, EMPRESA_A1, ORG_B, EQUIP_B, EMPRESA_B1]);
    return await fn(c);
  } finally {
    try { await c.query("rollback"); } catch { /* a transação já caiu; nada a desfazer */ }
    c.release();
  }
}

/** Conta com o papel da API (sem bypass de RLS) e o contexto de tenant da transação. */
async function contarComoApi(tx: Tx, org: string, usuario: string, sql: string, params: unknown[] = []): Promise<number> {
  await tx.query(`select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)`, [org, usuario]);
  await tx.query("set role erp_app");
  try {
    const r = await tx.query<{ n: string }>(sql, params);
    return Number(r.rows[0]!.n);
  } finally { await tx.query("reset role"); }
}

describe("1. as 50 FKs compostas canônicas: alvo, colunas e validação conferidos por OID e attnum", () => {
  it("são exatamente 50, todas (organization_id, empresa_*) → erp.empresas(organization_id, id) e VALIDADAS", async () => {
    const r = (await db.query<{
      tabela: string; restricao: string; col_org: string | null; col_empresa: string | null;
      alvo_org: string | null; alvo_id: string | null; validada: boolean; n_origem: number; n_alvo: number;
    }>(`
      select c.relname as tabela, k.conname as restricao,
             ao.attname as col_org, ae.attname as col_empresa,
             fo.attname as alvo_org, fi.attname as alvo_id,
             k.convalidated as validada,
             array_length(k.conkey, 1) as n_origem, array_length(k.confkey, 1) as n_alvo
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attribute ao on ao.attrelid = k.conrelid  and ao.attnum = k.conkey[1]
        left join pg_attribute ae on ae.attrelid = k.conrelid  and ae.attnum = k.conkey[2]
        left join pg_attribute fo on fo.attrelid = k.confrelid and fo.attnum = k.confkey[1]
        left join pg_attribute fi on fi.attrelid = k.confrelid and fi.attnum = k.confkey[2]
       where n.nspname = 'erp' and k.contype = 'f'
         and k.confrelid = 'erp.empresas'::regclass and array_length(k.conkey, 1) = 2
       order by c.relname, k.conname`)).rows;

    expect(r.length, "45 empresa_id + 2 empresa_origem_id + 3 empresa_destino_id").toBe(50);

    const problemas: string[] = [];
    for (const k of r) {
      if (k.n_origem !== 2 || k.n_alvo !== 2) problemas.push(`erp.${k.tabela}.${k.restricao}: ${k.n_origem} coluna(s) de origem e ${k.n_alvo} de destino — a composta tem duas de cada`);
      if (k.col_org !== "organization_id") problemas.push(`erp.${k.tabela}.${k.restricao}: a PRIMEIRA coluna é ${k.col_org}, não organization_id — coluna única não prova tenant`);
      if (![ "empresa_id", "empresa_origem_id", "empresa_destino_id" ].includes(k.col_empresa ?? "")) problemas.push(`erp.${k.tabela}.${k.restricao}: a segunda coluna é ${k.col_empresa}, que não é coluna canônica de empresa`);
      if ([k.alvo_org, k.alvo_id].join(",") !== ALVO_CANONICO.join(",")) problemas.push(`erp.${k.tabela}.${k.restricao}: aponta erp.empresas(${k.alvo_org}, ${k.alvo_id}), e não (${ALVO_CANONICO.join(", ")})`);
      if (!k.validada) problemas.push(`erp.${k.tabela}.${k.restricao}: NOT VALID — não responde pelo acervo já gravado`);
    }
    expect(problemas).toEqual([]);
  });

  it("a decomposição fecha: 45 empresa_id, 2 empresa_origem_id, 3 empresa_destino_id", async () => {
    const r = (await db.query<{ coluna: string; n: string }>(`
      select a.attname as coluna, count(*)::text as n
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[2]
       where n.nspname = 'erp' and k.contype = 'f'
         and k.confrelid = 'erp.empresas'::regclass and array_length(k.conkey, 1) = 2
       group by a.attname order by a.attname`)).rows;
    // Igualdade da LISTA inteira, não três `toBeGreaterThan`: um total de 50 pode ser alcançado por
    // decomposições erradas (46/2/2), e a soma sozinha não distinguiria.
    expect(r.map((x) => [x.coluna, Number(x.n)])).toEqual([
      ["empresa_destino_id", 3], ["empresa_id", 45], ["empresa_origem_id", 2],
    ]);
  });
});

describe("2. as DUAS exceções documentadas, e o fato de serem exatamente duas", () => {
  it("toda coluna canônica de empresa ou tem a composta canônica, ou é uma das duas dispensas do SSOT", async () => {
    const r = (await db.query<{ tabela: string; coluna: string; tem_org: boolean; org_nao_nula: boolean; compostas: number }>(`
      with canonicas as (
        select c.oid as t_oid, c.relname as tabela, a.attname as coluna, a.attnum,
               (select o.attnum    from pg_attribute o where o.attrelid = c.oid and o.attname = 'organization_id' and o.attnum > 0 and not o.attisdropped) as org_attnum,
               (select o.attnotnull from pg_attribute o where o.attrelid = c.oid and o.attname = 'organization_id' and o.attnum > 0 and not o.attisdropped) as org_nao_nula
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         where n.nspname = 'erp' and c.relkind = 'r'
           and a.attname in ('empresa_id', 'empresa_origem_id', 'empresa_destino_id'))
      select k.tabela, k.coluna, (k.org_attnum is not null) as tem_org, coalesce(k.org_nao_nula, false) as org_nao_nula,
             (select count(*) from pg_constraint fk
               where fk.conrelid = k.t_oid and fk.contype = 'f' and fk.convalidated
                 and fk.confrelid = 'erp.empresas'::regclass
                 and fk.conkey  = array[k.org_attnum, k.attnum]::int2[]
                 and fk.confkey = array[
                       (select attnum from pg_attribute where attrelid = 'erp.empresas'::regclass and attname = 'organization_id'),
                       (select attnum from pg_attribute where attrelid = 'erp.empresas'::regclass and attname = 'id')]::int2[])::int as compostas
        from canonicas k order by k.tabela, k.coluna`)).rows;

    // A PREMISSA: o universo não encolheu. 52 colunas canônicas em tabela com tenant + 4 ligações sem tenant.
    const semTenant = r.filter((x) => !x.tem_org);
    const comTenant = r.filter((x) => x.tem_org);
    expect(semTenant.map((x) => x.tabela).sort(), "as ligações sem organization_id são exatamente as quatro conhecidas").toEqual(LIGACOES_SEM_TENANT);
    expect(comTenant.length, "as 52 colunas canônicas de tabela com organização").toBe(52);

    const dispensadas = new Set(Object.keys(SEM_FK_COMPOSTA_DECLARADA as Record<string, string>));
    const semComposta = comTenant.filter((x) => x.compostas === 0).map((x) => `${x.tabela}.${x.coluna}`).sort();

    // "NEM UMA A MAIS": o conjunto medido é comparado por IGUALDADE com o do SSOT, não por inclusão.
    // Uma comparação por `includes` aprovaria uma terceira tabela que perdeu a composta em silêncio.
    expect(semComposta, "o conjunto SEM composta é exatamente o par documentado").toEqual([...dispensadas].sort());
    expect(semComposta).toEqual(["legado_escopo_empresa_v0.empresa_id", "registros_globais.empresa_id"]);
    expect(semComposta.length, "são exatamente DUAS").toBe(2);
    expect(comTenant.filter((x) => x.compostas === 1).length, "as outras 50 têm a composta canônica validada").toBe(50);
    // Dispensa órfã: declarar que uma coluna não tem composta e a coluna não existir mais esconde o buraco
    // seguinte. E dispensa que GANHOU a composta envelheceu e tem de sair do SSOT.
    const vistas = new Set(comTenant.map((x) => `${x.tabela}.${x.coluna}`));
    expect([...dispensadas].filter((c) => !vistas.has(c)), "nenhuma dispensa órfã").toEqual([]);
  });

  it("as duas exceções não escapam do tenant: a RLS delas recorta por organização", async () => {
    // A dispensa é de CHAVE, não de isolamento. Sem esta asserção, "não tem FK composta" e "não tem
    // proteção nenhuma" seriam indistinguíveis — e é justamente a diferença que o SSOT alega.
    const r = (await db.query<{ tabela: string; politica: string; cmd: string; usando: string }>(`
      select tablename as tabela, policyname as politica, cmd, coalesce(qual, '') as usando
        from pg_policies where schemaname = 'erp'
         and tablename in ('registros_globais', 'legado_escopo_empresa_v0') order by tablename`)).rows;
    expect(r.length, "uma política em cada uma das duas").toBe(2);
    for (const p of r) {
      expect(p.usando, `erp.${p.tabela}.${p.politica} recorta por tenant`).toContain("tenant_visible(organization_id)");
    }
    const forcadas = depois.tabelas.filter((t) => ["registros_globais", "legado_escopo_empresa_v0"].includes(t.tabela));
    expect(forcadas.length).toBe(2);
    expect(forcadas.every((t) => t.rls && t.forcada), "RLS habilitada E forçada nas duas").toBe(true);
  });
});

describe("3. organization_id NOT NULL em toda tabela que participa das compostas", () => {
  it("nenhuma das 47 tabelas com composta tem organization_id anulável", async () => {
    // Com MATCH SIMPLE (o default), uma linha cujo tenant é NULO não é conferida pela composta: a chave
    // deixaria de provar exatamente o que existe para provar. É a mesma armadilha do `NOT VALID`, só que
    // por dado em vez de por catálogo.
    const r = (await db.query<{ tabela: string; org_nao_nula: boolean }>(`
      select distinct c.relname as tabela,
             (select o.attnotnull from pg_attribute o
               where o.attrelid = c.oid and o.attname = 'organization_id' and o.attnum > 0 and not o.attisdropped) as org_nao_nula
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and k.contype = 'f'
         and k.confrelid = 'erp.empresas'::regclass and array_length(k.conkey, 1) = 2
       order by c.relname`)).rows;
    expect(r.length, "as 47 tabelas distintas que carregam as 50 compostas").toBe(47);
    expect(r.filter((x) => !x.org_nao_nula).map((x) => `erp.${x.tabela}`), "organization_id anulável").toEqual([]);
  });
});

describe("4. o CHECK de erp.equipment_transfers: existe, é o canônico, está validado e RECUSA de verdade", () => {
  it("o catálogo tem UM check canônico, validado, sobre exatamente as duas colunas canônicas", async () => {
    const r = (await db.query<{ nome: string; validada: boolean; colunas: string; definicao: string }>(`
      select k.conname as nome, k.convalidated as validada,
             (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
               where a.attrelid = k.conrelid and a.attnum = any(k.conkey)) as colunas,
             pg_get_constraintdef(k.oid) as definicao
        from pg_constraint k
       where k.conrelid = 'erp.equipment_transfers'::regclass and k.contype = 'c'
       order by k.conname`)).rows;

    // UM só: o legado (equipment_transfers_check, sobre as colunas legadas) tinha de sair, e um segundo
    // CHECK sobre as mesmas colunas seria um lugar a mais onde a regra pode divergir de si mesma.
    expect(r.map((x) => x.nome), "o legado saiu e sobrou só o canônico").toEqual(["equipment_transfers_empresa_origem_destino_check"]);
    const c = r[0]!;
    expect(c.validada, "NOT VALID deixaria o acervo já gravado fora da regra").toBe(true);
    expect(c.colunas, "a regra é sobre as duas pontas canônicas, e só elas").toBe("empresa_destino_id,empresa_origem_id");
    // A forma exata, além da estrutura: `<>` entre as duas pontas, sem termo extra. Um `or true` ou um
    // `=` invertido têm as MESMAS duas colunas em `conkey` e passariam pela asserção acima — o texto
    // normalizado do catálogo os separa, e o teste de comportamento abaixo os mata de vez.
    expect(c.definicao).toBe("CHECK ((empresa_origem_id <> empresa_destino_id))");
  });

  it("o banco RECUSA origem = destino e ACEITA origem ≠ destino — o par é que prova a regra", async () => {
    const resultado = await comCenario(async (tx) => {
      // A ESCRITA BOA PRIMEIRO: ela é a premissa. Sem ela, uma recusa poderia vir de um CHECK invertido,
      // de uma FK faltando ou de um NOT NULL — e "deu erro" viraria falso positivo de segurança.
      await tx.query(`insert into erp.equipment_transfers(organization_id, code, transfer_date, equipment_id, empresa_origem_id, empresa_destino_id)
                      values ($1, 'TR-BOA', current_date, $2, $3, $4)`, [ORG_A, EQUIP_A, EMPRESA_A1, EMPRESA_A2]);
      const aceitas = Number((await tx.query<{ n: string }>(
        `select count(*)::text n from erp.equipment_transfers where code = 'TR-BOA'`)).rows[0]!.n);

      // A ESCRITA RUIM, em savepoint: a violação aborta a transação, e sem o savepoint o rollback levaria
      // junto a prova da escrita boa.
      await tx.query("savepoint tentativa");
      let codigo: string | undefined;
      let restricao: string | undefined;
      try {
        await tx.query(`insert into erp.equipment_transfers(organization_id, code, transfer_date, equipment_id, empresa_origem_id, empresa_destino_id)
                        values ($1, 'TR-RUIM', current_date, $2, $3, $3)`, [ORG_A, EQUIP_A, EMPRESA_A1]);
      } catch (e) {
        codigo = (e as { code?: string }).code;
        restricao = (e as { constraint?: string }).constraint;
      } finally {
        await tx.query("rollback to savepoint tentativa");
      }
      return { aceitas, codigo, restricao };
    });

    expect(resultado.aceitas, "transferência entre empresas DIFERENTES continua possível").toBe(1);
    // Não basta "deu erro": tem de ser ESTE erro, vindo DESTA restrição. Qualquer outro código significa
    // que a recusa veio de outro lugar e a invariante não foi exercida.
    expect(resultado.codigo, "23514 = check_violation").toBe("23514");
    expect(resultado.restricao).toBe("equipment_transfers_empresa_origem_destino_check");
  });
});

describe("5. RLS: nada cita coluna legada, a api_child é única e canônica, e nada afrouxou", () => {
  it("nenhuma política do schema erp decide por coluna legada — e ANTES havia exatamente uma", () => {
    const legada = (p: Politica) => /(farm_id|origin_farm_id|destination_farm_id)/.test(p.usando + p.checando);
    const pre = antes.politicas.filter(legada).map((p) => `${p.tabela}.${p.politica}`);
    // A premissa: se o "antes" já fosse zero, o "depois" zerado não provaria remoção nenhuma.
    expect(pre, "erp.empresa_cost_centers.api_child era a última").toEqual(["empresa_cost_centers.api_child"]);
    expect(depois.politicas.filter(legada).map((p) => `${p.tabela}.${p.politica}`)).toEqual([]);
  });

  it("erp.empresa_cost_centers tem UMA api_child, sobre empresa_id, com USING e WITH CHECK", () => {
    const p = depois.politicas.filter((x) => x.tabela === "empresa_cost_centers");
    // Duas PERMISSIVE no mesmo comando se somam com OR e a mais frouxa acaba valendo: por isso "única".
    expect(p.map((x) => `${x.politica}/${x.cmd}/${x.permissiva}`)).toEqual(["api_child/ALL/PERMISSIVE"]);
    const a = p[0]!;
    expect(a.usando).toContain("empresa_cost_centers.empresa_id");
    expect(a.usando).not.toContain("farm_id");
    // Sem WITH CHECK o INSERT passaria livre: leitura e escrita aqui são a MESMA pergunta.
    expect(a.checando).toContain("empresa_cost_centers.empresa_id");
    expect(a.checando).not.toContain("farm_id");
    expect(a.papeis, "o papel da API continua sendo o alvo").toContain("erp_app");
  });

  it("RLS continua habilitada E forçada em toda tabela onde já era — comparação entre os dois estados", () => {
    expect(antes.tabelas.length, "181 tabelas no schema antes da purga").toBe(181);
    expect(depois.tabelas.length, "e as mesmas 181 depois — a purga não derruba tabela").toBe(antes.tabelas.length);
    const pre = new Map(antes.tabelas.map((t) => [t.tabela, t]));
    const afrouxadas: string[] = [];
    for (const t of depois.tabelas) {
      const p = pre.get(t.tabela);
      if (!p) { afrouxadas.push(`erp.${t.tabela}: tabela nova, sem estado anterior para comparar`); continue; }
      if (p.rls && !t.rls) afrouxadas.push(`erp.${t.tabela}: RLS estava habilitada e deixou de estar`);
      if (p.forcada && !t.forcada) afrouxadas.push(`erp.${t.tabela}: RLS estava FORÇADA e deixou de estar`);
    }
    expect(afrouxadas).toEqual([]);
    // A premissa junto com a conclusão: "nada deixou de ser forçada" é vazio num schema onde nada era.
    expect(antes.tabelas.filter((t) => t.rls && t.forcada).length, "todas as 181 já eram habilitadas e forçadas").toBe(181);
  });

  it("a ÚNICA política que mudou foi a api_child de empresa_cost_centers — nenhuma sumiu, nenhuma nasceu", () => {
    const chave = (p: Politica) => `${p.tabela}|${p.politica}|${p.cmd}`;
    const forma = (p: Politica) => `${p.permissiva}|${p.papeis}|${p.usando}|${p.checando}`;
    const pre = new Map(antes.politicas.map((p) => [chave(p), forma(p)]));
    const pos = new Map(depois.politicas.map((p) => [chave(p), forma(p)]));
    expect(pre.size, "227 políticas antes da purga").toBe(227);
    expect(pos.size, "e 227 depois").toBe(pre.size);
    const sumiram = [...pre.keys()].filter((k) => !pos.has(k));
    const nasceram = [...pos.keys()].filter((k) => !pre.has(k));
    const mudaram = [...pos.keys()].filter((k) => pre.has(k) && pre.get(k) !== pos.get(k));
    expect(sumiram, "política removida é escopo perdido").toEqual([]);
    expect(nasceram, "política nova é superfície que ninguém revisou").toEqual([]);
    expect(mudaram, "a substituição prevista, e só ela").toEqual(["empresa_cost_centers|api_child|ALL"]);

    // E A MUDANÇA TEM DE SER SÓ NO PREDICADO. Substituir uma política é estreitar o que ela deixa passar,
    // nunca alargar para quem ela vale: numa tabela com RLS forçada, papel SEM política aplicável não vê
    // linha nenhuma. Trocar `to erp_app` por PUBLIC dá a papéis que antes eram negados por ausência o
    // predicado inteiro — ampliação de superfície disfarçada de reescrita de coluna.
    const alvo = (e: EstadoRls) => e.politicas.find((p) => p.tabela === "empresa_cost_centers" && p.politica === "api_child")!;
    expect(alvo(depois).permissiva, "permissividade preservada").toBe(alvo(antes).permissiva);
    expect(alvo(depois).papeis, "conjunto de papéis preservado — 'public' inclui quem antes não tinha política").toBe(alvo(antes).papeis);
  });
});

describe("6. isolamento REAL entre organizações, contado em linhas", () => {
  it("a sessão de uma organização vê as linhas dela e ZERO linhas da outra", async () => {
    const r = await comCenario(async (tx) => {
      // Premissa medida com o papel dono (sem RLS): as duas organizações TÊM linha. Sem isso, "zero linhas
      // vistas de fora" seria verdade num banco vazio e não provaria isolamento nenhum.
      const semeadas = (await tx.query<{ tabela: string; a: string; b: string }>(`
        select 'empresas' as tabela,
               count(*) filter (where organization_id = $1)::text as a,
               count(*) filter (where organization_id = $2)::text as b from erp.empresas
        union all select 'equipments',
               count(*) filter (where organization_id = $1)::text,
               count(*) filter (where organization_id = $2)::text from erp.equipments
        union all select 'registros_globais',
               count(*) filter (where organization_id = $1)::text,
               count(*) filter (where organization_id = $2)::text from erp.registros_globais
        order by 1`, [ORG_A, ORG_B])).rows;

      const medir = async (org: string, usuario: string) => ({
        empresasTotal: await contarComoApi(tx, org, usuario, "select count(*)::text n from erp.empresas"),
        equipamentosTotal: await contarComoApi(tx, org, usuario, "select count(*)::text n from erp.equipments"),
        registrosTotal: await contarComoApi(tx, org, usuario, "select count(*)::text n from erp.registros_globais"),
        empresasDaOutra: await contarComoApi(tx, org, usuario, "select count(*)::text n from erp.empresas where organization_id = $1", [org === ORG_A ? ORG_B : ORG_A]),
        equipamentosDaOutra: await contarComoApi(tx, org, usuario, "select count(*)::text n from erp.equipments where organization_id = $1", [org === ORG_A ? ORG_B : ORG_A]),
        registrosDaOutra: await contarComoApi(tx, org, usuario, "select count(*)::text n from erp.registros_globais where organization_id = $1", [org === ORG_A ? ORG_B : ORG_A]),
      });
      return { semeadas, a: await medir(ORG_A, USUARIO_A), b: await medir(ORG_B, USUARIO_B) };
    });

    expect(r.semeadas.map((x) => [x.tabela, Number(x.a), Number(x.b)]), "as duas organizações têm linha em cada tabela medida").toEqual([
      ["empresas", 2, 1], ["equipments", 1, 1], ["registros_globais", 1, 1],
    ]);

    // DE DENTRO: vê o próprio acervo. Zero aqui seria o teste passando por vacuidade.
    expect(r.a.empresasTotal, "organização A enxerga as duas empresas dela").toBe(2);
    expect(r.a.equipamentosTotal).toBe(1);
    expect(r.a.registrosTotal).toBe(1);
    expect(r.b.empresasTotal, "organização B enxerga a empresa dela").toBe(1);
    expect(r.b.equipamentosTotal).toBe(1);
    expect(r.b.registrosTotal).toBe(1);

    // DE FORA: nada. Inclusive nas duas tabelas dispensadas da FK composta, onde a RLS é a proteção alegada.
    expect([r.a.empresasDaOutra, r.a.equipamentosDaOutra, r.a.registrosDaOutra], "A não vê nada de B").toEqual([0, 0, 0]);
    expect([r.b.empresasDaOutra, r.b.equipamentosDaOutra, r.b.registrosDaOutra], "B não vê nada de A").toEqual([0, 0, 0]);
  });
});
