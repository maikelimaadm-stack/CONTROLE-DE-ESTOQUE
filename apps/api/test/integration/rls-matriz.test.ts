import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
// @ts-expect-error — classificação em JS puro, compartilhada com o gerador da matriz
import { EXCECOES_RLS_EMPRESA, classificarTabela, politicasEsperadas } from "../../../../packages/domain/empresa-rls.mjs";
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
  it("toda tabela com coluna de empresa tem as políticas que a matriz promete, COMANDO A COMANDO", async () => {
    const problemas: string[] = [];
    for (const t of await tabelasComEmpresa()) {
      const categoria = classificarTabela(t.tabela, t.colunas, t.anulavel);
      const esperadas = politicasEsperadas(categoria, t.tabela) as Record<string, { cmd: string; using: string | null; check: string | null; gatilho?: string }> | null;
      const p = await db.query<{ policyname: string; cmd: string; qual: string; with_check: string }>(
        "select policyname, cmd, coalesce(qual,'') qual, coalesce(with_check,'') with_check from pg_policies where schemaname='erp' and tablename=$1", [t.tabela]);
      if (!esperadas) {
        if (!p.rows.length && !EXCECOES_RLS_EMPRESA[t.tabela]) problemas.push(`${t.tabela} (cat. ${categoria}): sem política nenhuma`);
        continue;
      }
      for (const [nome, forma] of Object.entries(esperadas) as [string, { cmd: string; using: string | null; check: string | null; gatilho?: string }][]) {
        if (forma.gatilho) {
          // Onde a regra depende de OLD vs NEW, a política não basta: quem a sustenta é o gatilho.
          const g = await db.query<{ n: string }>(
            "select count(*)::text n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='erp' and c.relname=$1 and t.tgname=$2 and not t.tgisinternal", [t.tabela, forma.gatilho]);
          if (g.rows[0]!.n === "0") problemas.push(`${t.tabela}: falta o gatilho ${forma.gatilho}, que é quem impede redirecionar as pontas`);
        }
        const achada = p.rows.find((x) => x.policyname === nome);
        if (!achada) { problemas.push(`${t.tabela} (cat. ${categoria}): falta a política ${nome} (${forma.cmd})`); continue; }
        if (achada.cmd !== forma.cmd) problemas.push(`${t.tabela}.${nome}: comando ${achada.cmd}, esperado ${forma.cmd}`);
        // O predicado é escrito INLINE na política (sublink escalar + sublink não correlacionado) para o
        // planejador resolvê-lo uma vez por consulta — ver a nota de plano na 0015. Por isso a prova textual
        // procura o CONJUNTO (`empresas_do_membro`) e o corte total, não um nome de função só.
        const cita = (e: string) => /empresas_do_membro/.test(e) && /escopo_empresa_total/.test(e);
        const soTenant = (e: string) => /tenant_visible/.test(e) && !/empresas_do_membro/.test(e);
        /** Quantas COLUNAS de empresa o predicado cobra. Origem sozinha = 1; as duas pontas = 2. */
        const pontas = (e: string) => new Set(e.match(/empresa(?:_origem|_destino)?_id/gi) ?? []).size;
        // Os dois gabaritos da 0015 são distinguíveis pelo tratamento do NULO, que é o que os torna
        // diferentes: LEITURA aceita `col is null` (registro da organização / ponta livre); ESCRITA exige
        // `col is not null` (nulo alcança todas as empresas, então só passa com escopo total).
        // O gabarito de ESCRITA é reconhecível por exigir `col is not null` (nulo alcança todas as empresas,
        // então só passa com escopo total). O de LEITURA não tem essa exigência — em `erp.empresas` nem
        // existe coluna anulável, e é justamente por isso que a marca é a ESCRITA, não o ramo do nulo.
        const formaEscrita = (e: string) => /IS NOT NULL/i.test(e);
        const confere = (rotulo: string, e: string) => {
          if (rotulo === "tenant") return soTenant(e);
          if (!cita(e)) return false;
          if (rotulo === "envelope") return pontas(e) >= 2 && !formaEscrita(e);
          if (rotulo === "escrita+escrita") return pontas(e) >= 2 && formaEscrita(e);
          if (rotulo === "escrita") return formaEscrita(e);
          return !formaEscrita(e);   // "leitura"
        };
        if (forma.using && !confere(forma.using, achada.qual)) problemas.push(`${t.tabela}.${nome}: USING não é "${forma.using}" — ${achada.qual}`);
        if (forma.check && !confere(forma.check, achada.with_check)) problemas.push(`${t.tabela}.${nome}: WITH CHECK não é "${forma.check}" — ${achada.with_check}`);
        // A DIFERENÇA que este round existe para garantir: onde a escrita é mais restrita que a leitura,
        // o predicado de escrita NÃO pode aceitar o nulo como aceitação livre.
        if (forma.using?.startsWith("escrita") && /empresa_id is null or/.test(achada.qual)) {
          problemas.push(`${t.tabela}.${nome}: o USING de ${forma.cmd} usa o predicado PERMISSIVO (aceita nulo) — poder ler viraria poder escrever`);
        }
        // TRANSFERÊNCIA: escrever pela ORIGEM não pode citar a coluna de DESTINO (seria o envelope de volta).
        if (forma.using === "escrita" && t.colunas.includes("empresa_destino_id") && /empresa_destino_id/.test(achada.qual)) {
          problemas.push(`${t.tabela}.${nome}: o USING de ${forma.cmd} aceita a ponta de DESTINO — visibilidade bilateral não é autoridade bilateral`);
        }
      }
    }
    expect(problemas).toEqual([]);
  });

  it("NENHUMA tabela de empresa ficou com uma política permissiva EXTRA no mesmo comando — seria um OR que reabre tudo", async () => {
    const problemas: string[] = [];
    for (const t of await tabelasComEmpresa()) {
      const categoria = classificarTabela(t.tabela, t.colunas, t.anulavel);
      const esperadas = politicasEsperadas(categoria, t.tabela) as Record<string, { cmd: string }> | null;
      if (!esperadas) continue;
      const declaradas = new Set(Object.keys(esperadas));
      const p = await db.query<{ policyname: string; cmd: string }>(
        "select policyname, cmd from pg_policies where schemaname='erp' and tablename=$1 and permissive='PERMISSIVE'", [t.tabela]);
      const extras = p.rows.filter((x) => !declaradas.has(x.policyname));
      if (extras.length) problemas.push(`${t.tabela}: política permissiva extra ${extras.map((x) => `${x.policyname}/${x.cmd}`).join(", ")}`);
      // Duas políticas PERMISSIVE do MESMO comando se somam com OR: a mais frouxa vence.
      const porComando = new Map<string, string[]>();
      for (const x of p.rows) porComando.set(x.cmd, [...(porComando.get(x.cmd) ?? []), x.policyname]);
      for (const [cmd, nomes] of porComando) if (nomes.length > 1) problemas.push(`${t.tabela}: ${nomes.length} políticas permissivas em ${cmd} (${nomes.join(", ")}) — combinam com OR`);
    }
    expect(problemas).toEqual([]);
  });

  /**
   * Esta asserção é sobre o SCHEMA FÍSICO, não sobre o fio: ela emparelha a coluna canônica com a coluna
   * espelho que ainda existe no banco. Os nomes antigos abaixo são de COLUNA e continuam corretos até a
   * PRE-BASE2-05C — trocá-los pelos canônicos transformaria o `exists` num auto-join que casa com tudo, e
   * o teste passaria a não provar nada.
   */
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
