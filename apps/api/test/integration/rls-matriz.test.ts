import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
// @ts-expect-error — classificação em JS puro, compartilhada com o gerador da matriz
import { EXCECOES_RLS_EMPRESA, classificarTabela, politicaEsperada } from "../../../../packages/domain/empresa-rls.mjs";
import { TEST_URL } from "./setup.js";
import { resetSchema, migrate } from "@agro/db";

/**
 * A MATRIZ CONTRA O BANCO (PRE-BASE2-03).
 *
 * `scripts/company-rls-matrix.mjs --check` prova que a matriz está em dia com o SCHEMA. Isso não é a mesma
 * coisa que estar em dia com o BANCO: o documento pode descrever uma política que a migration esqueceu de
 * criar, e o gate — que roda sem banco, no job de qualidade — não teria como saber.
 *
 * Aqui a pergunta é outra: para cada tabela classificada, a política existe MESMO, com o nome esperado, e o
 * predicado dela cita o escopo de empresa? E: nenhuma tabela com empresa ficou com a política tenant-only,
 * que é o caminho pelo qual o vazamento voltaria sem ninguém mudar uma linha de matriz.
 */
let db: Db;
beforeAll(async () => {
  db = createPool(TEST_URL, { max: 2 });
  await resetSchema(db); await migrate(db, () => {});
}, 240_000);
afterAll(async () => { await db?.end(); });

interface Tabela { tabela: string; colunas: string[]; anulavel: boolean }

async function tabelasComEmpresa(): Promise<Tabela[]> {
  const r = await db.query<{ tabela: string; colunas: string; anulavel: boolean }>(`
    select c.table_name as tabela,
           string_agg(c.column_name, ',' order by c.column_name) as colunas,
           bool_or(c.column_name='empresa_id' and c.is_nullable='YES') as anulavel
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
     where c.table_schema='erp' and c.column_name in ('empresa_id','empresa_origem_id','empresa_destino_id')
     group by c.table_name order by c.table_name`);
  const linhas = r.rows.map((x) => ({ tabela: x.tabela, colunas: x.colunas.split(","), anulavel: x.anulavel }));
  return [...linhas, { tabela: "empresas", colunas: ["id"], anulavel: false }];
}

describe("classificação × políticas reais", () => {
  it("toda tabela com coluna de empresa tem a política que a matriz promete", async () => {
    const problemas: string[] = [];
    for (const t of await tabelasComEmpresa()) {
      const categoria = classificarTabela(t.tabela, t.colunas, t.anulavel);
      const esperada = politicaEsperada(categoria);
      const p = await db.query<{ policyname: string; qual: string }>(
        "select policyname, coalesce(qual,'') qual from pg_policies where schemaname='erp' and tablename=$1", [t.tabela]);
      const nomes = p.rows.map((x) => x.policyname);
      if (esperada === "tenant_e_empresa") {
        if (!nomes.includes("tenant_e_empresa")) { problemas.push(`${t.tabela} (cat. ${categoria}): sem política tenant_e_empresa`); continue; }
        const qual = p.rows.find((x) => x.policyname === "tenant_e_empresa")!.qual;
        // O predicado de leitura é escrito INLINE na política (sublink escalar + sublink não correlacionado)
        // para o planejador resolvê-lo uma vez por consulta, e não por linha — ver a nota de plano na 0015.
        // Por isso a prova textual procura o CONJUNTO (`empresas_do_membro`) e o corte total, não um nome só.
        if (!/empresas_do_membro/.test(qual) || !/escopo_empresa_total/.test(qual)) {
          problemas.push(`${t.tabela}: a política existe mas não cita o escopo de empresa — ${qual}`);
        }
      } else if (!nomes.length && !EXCECOES_RLS_EMPRESA[t.tabela]) {
        problemas.push(`${t.tabela} (cat. ${categoria}): sem política nenhuma`);
      }
    }
    expect(problemas).toEqual([]);
  });

  it("NENHUMA tabela de empresa ficou com a política tenant-only ao lado — seria um OR que reabre tudo", async () => {
    const problemas: string[] = [];
    for (const t of await tabelasComEmpresa()) {
      const categoria = classificarTabela(t.tabela, t.colunas, t.anulavel);
      if (politicaEsperada(categoria) !== "tenant_e_empresa") continue;
      const p = await db.query<{ policyname: string }>(
        "select policyname from pg_policies where schemaname='erp' and tablename=$1 and permissive='PERMISSIVE' and policyname <> 'tenant_e_empresa'", [t.tabela]);
      if (p.rows.length) problemas.push(`${t.tabela}: política permissiva extra ${p.rows.map((x) => x.policyname).join(", ")}`);
    }
    expect(problemas).toEqual([]);
  });

  it("todo par canônico/legado tem gatilho de sincronização no banco", async () => {
    const r = await db.query<{ tabela: string; canonico: string }>(`
      select c.table_name as tabela, c.column_name as canonico
        from information_schema.columns c
        join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
       where c.table_schema='erp' and c.column_name in ('empresa_id','empresa_origem_id','empresa_destino_id')
         and exists (select 1 from information_schema.columns l
                      where l.table_schema='erp' and l.table_name=c.table_name
                        and l.column_name = case c.column_name when 'empresa_id' then 'farm_id'
                                                               when 'empresa_origem_id' then 'origin_farm_id'
                                                               else 'destination_farm_id' end)`);
    const faltando: string[] = [];
    for (const { tabela, canonico } of r.rows) {
      const g = await db.query<{ n: string }>(
        "select count(*) n from pg_trigger tr join pg_class c on c.oid=tr.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='erp' and c.relname=$1 and tr.tgname=$2 and not tr.tgisinternal",
        [tabela, `trg_sync_${canonico}`]);
      if (g.rows[0]!.n === "0") faltando.push(`erp.${tabela}.${canonico}`);
    }
    expect(r.rows.length, "os 52 pares da migração").toBeGreaterThan(45);
    expect(faltando).toEqual([]);
  });

  it("toda coluna canônica de tabela com organização tem referência COMPOSTA", async () => {
    // A referência de coluna única prova que o UUID é uma empresa; não prova que é uma empresa DESTA
    // organização — e foi exatamente esse buraco que a PRE-BASE2-02 fechou à mão para o responsável de
    // compra. Aqui ele está fechado por construção, para todas as colunas de empresa.
    const r = await db.query<{ tabela: string; coluna: string }>(`
      select c.table_name as tabela, c.column_name as coluna
        from information_schema.columns c
        join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
       where c.table_schema='erp' and c.column_name in ('empresa_id','empresa_origem_id','empresa_destino_id')
         and exists (select 1 from information_schema.columns o where o.table_schema='erp' and o.table_name=c.table_name and o.column_name='organization_id')`);
    const semComposta: string[] = [];
    for (const { tabela, coluna } of r.rows) {
      if (EXCECOES_RLS_EMPRESA[tabela]) continue;
      const fk = await db.query<{ n: string }>(`
        select count(*) n from pg_constraint
         where conrelid = ('erp.' || $1)::regclass and contype='f'
           and pg_get_constraintdef(oid) ~* ('foreign key \\(organization_id, ' || $2 || '\\)')`, [tabela, coluna]);
      if (fk.rows[0]!.n === "0") semComposta.push(`erp.${tabela}.${coluna}`);
    }
    expect(semComposta).toEqual([]);
  });
});
