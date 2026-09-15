import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { TABELAS_DE_EXCECAO, SEM_FK_COMPOSTA_DECLARADA, protecaoDaExcecao, validarProtecaoDaExcecao, classificarTabela, politicasEsperadas } from "../../../../packages/domain/empresa-rls.mjs";
// @ts-expect-error — contrato de fase em JS puro, compartilhado com o gate de linha de comando
import { conferirInvarianteDeTransferencia } from "../../../../scripts/lib/espelho-empresa.mjs";
// @ts-expect-error — a lista canônica de colunas de empresa é SSOT do leitor de schema
import { CANONICAL_COMPANY_COLUMNS } from "../../../../scripts/lib/schema.mjs";
// @ts-expect-error — idem
import { FASE_ESPELHO } from "../../../../scripts/lib/empresa-compat-surface.mjs";
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
      const esperadas = politicasEsperadas(categoria, t.tabela);
      const p = await db.query<{ policyname: string; cmd: string; qual: string; with_check: string }>(
        "select policyname, cmd, coalesce(qual,'') qual, coalesce(with_check,'') with_check from pg_policies where schemaname='erp' and tablename=$1", [t.tabela]);
      if (!esperadas) {
        // "É exceção" NUNCA silencia "não tem política nenhuma" (PRE-BASE2-05C-0). Antes, a exceção era
        // tratada como dispensa: o guarda consultava as políticas da tabela e DESCARTAVA a resposta, de modo
        // que `erp.empresa_cost_centers` com RLS forçada e zero políticas passava verde. A exceção diz que a
        // proteção é OUTRA — e essa outra é verificada logo abaixo, contra o `pg_policies` real.
        if (!p.rows.length) problemas.push(`${t.tabela} (cat. ${categoria}): sem política nenhuma`);
        continue;
      }
      for (const [nome, forma] of Object.entries(esperadas)) {
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

  /**
   * A EXCEÇÃO TEM DE PROVAR A PROTEÇÃO QUE ALEGA — contra o `pg_policies` VIVO.
   *
   * `politicasEsperadas` devolve `null` para E/F porque a RLS empresarial genérica não se aplica a essas
   * tabelas. Isso descreve o que NÃO as protege; não descreve o que protege. Enquanto o único registro disso
   * foi `protegidaPor` — prosa —, a diferença entre "protegida por outra regra" e "sem proteção alguma" era
   * invisível para qualquer gate.
   *
   * A REGRA é `validarProtecaoDaExcecao`, pura e adversarialmente testada sem banco em
   * `apps/api/test/unit/rls-excecao-protecao.test.ts` (USING e WITH CHECK separados, papéis como conjunto
   * exato, política PERMISSIVE extra, e a correlação pai→filho do `api_child`). Aqui ela é alimentada com as
   * linhas REAIS do banco. Os dois lados são necessários: a suíte pura prova que o validador RECUSA o
   * errado — montar aquelas políticas de verdade exigiria DDL, e esta fatia é NO-DDL —, e este caso prova
   * que ele ACEITA o que o banco realmente tem. Um sem o outro não distingue "recusa o errado" de "recusa
   * tudo".
   */
  it("toda tabela declarada como EXCEÇÃO tem, no banco, a proteção que a exceção declara", async () => {
    const problemas: string[] = [];
    let conferidas = 0;
    for (const tabela of TABELAS_DE_EXCECAO as string[]) {
      const existe = await db.query<{ n: string }>(
        "select count(*)::text n from information_schema.tables where table_schema='erp' and table_name=$1 and table_type='BASE TABLE'", [tabela]);
      if (existe.rows[0]!.n === "0") { problemas.push(`${tabela}: declarada como exceção, mas não existe no schema — exceção órfã`); continue; }

      // `pg_policies.roles` é `name[]`, e o driver o entrega como TEXTO (`{authenticated,erp_app}`) por não
      // ter decodificador para esse tipo de array. Tratá-lo como array em JS produziria um conjunto de
      // CARACTERES — e um teste que nunca casaria com papel nenhum. O banco converte para `text[]`.
      // NOTA DE AMBIENTE (05C-G1): a prova do predicado exige `erp.tenant_visible` ANCORADO — decisão 116,
      // porque sem âncora uma função homônima de outro schema no `search_path` casaria. O preço é que este
      // caso pressupõe uma sessão sem `erp` no `search_path` (o default do papel, e o que `createPool`
      // entrega). Rodar com `search_path = erp, public` faz `pg_policies` omitir o schema e este caso
      // reprova em massa. A leitura certa dessa falha é "o ambiente mudou", NUNCA "tire a âncora".
      const p = await db.query<{ policyname: string; cmd: string; permissive: string; papeis: string[]; qual: string; with_check: string }>(
        `select policyname, cmd, permissive, roles::text[] as papeis, coalesce(qual,'') qual, coalesce(with_check,'') with_check
           from pg_policies where schemaname='erp' and tablename=$1`, [tabela]);

      problemas.push(...(validarProtecaoDaExcecao(tabela, protecaoDaExcecao(tabela), p.rows) as string[]));
      conferidas++;
    }
    // A premissa junto com a conclusão: uma lista de exceções vazia faria o laço acima não executar asserção
    // nenhuma e o teste passar sem provar coisa alguma.
    expect(TABELAS_DE_EXCECAO.length, "há exceções declaradas para conferir").toBeGreaterThan(0);
    expect(problemas).toEqual([]);
    expect(conferidas, "toda exceção declarada foi conferida contra o banco").toBe(TABELAS_DE_EXCECAO.length);
  });

  it("NENHUMA tabela de empresa ficou com uma política permissiva EXTRA no mesmo comando — seria um OR que reabre tudo", async () => {
    const problemas: string[] = [];
    for (const t of await tabelasComEmpresa()) {
      const categoria = classificarTabela(t.tabela, t.colunas, t.anulavel);
      const esperadas = politicasEsperadas(categoria, t.tabela) as Record<string, { cmd: string }> | null;
      // E/F não têm gabarito genérico. Isso NÃO é dispensa: a política permissiva extra dessas tabelas é
      // cobrada pelo caso acima, via `validarProtecaoDaExcecao`, que reprova qualquer PERMISSIVE não
      // declarada. Era esta a delegação que faltava — antes o `continue` não entregava a pergunta a ninguém.
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
   * espelho do banco. Os nomes antigos abaixo são de COLUNA — trocá-los pelos canônicos transformaria o
   * `exists` num auto-join que casa com tudo, e o teste passaria a não provar nada.
   *
   * A PERGUNTA VIRA COM A FASE, e é por isso que ela não foi apagada na 05C-1. Na fase `dual` o que se
   * exige é que TODO par tenha gatilho de sincronização; na `canonica`, que não exista par NENHUM nem
   * gatilho nenhum. Apagar o caso quando a purga rodasse deixaria a pergunta sem dono justo no momento em
   * que ela muda de lado; mantê-lo como estava o deixaria verde medindo zero linhas — o falso positivo
   * clássico. `FASE_ESPELHO` é o interruptor consciente que decide qual das duas perguntas vale.
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
    if (FASE_ESPELHO === "canonica") {
      // Depois da purga não existe par para emparelhar, e é isso que se exige — com a contraprova de que o
      // lado canônico continua de pé, senão "zero pares" seria verdade também num banco sem schema.
      expect(r.rows, "na fase canônica não pode sobrar par legado/canônico").toEqual([]);
      const g = await db.query<{ n: string }>(
        "select count(*) n from pg_trigger tr join pg_proc p on p.oid=tr.tgfoid where not tr.tgisinternal and p.proname like 'sincronizar_empresa%'");
      expect(g.rows[0]!.n, "nem gatilho de espelho").toBe("0");
      const canonicas = await db.query<{ n: string }>(
        `select count(*) n from information_schema.columns
          where table_schema='erp' and column_name in ('empresa_id','empresa_origem_id','empresa_destino_id')`);
      expect(Number(canonicas.rows[0]!.n), "o lado canônico existe — o vazio acima não é banco vazio").toBeGreaterThan(45);
      return;
    }
    expect(r.rows.length, "os 52 pares da migração").toBeGreaterThan(45);
    expect(faltando).toEqual([]);
  });

  it("toda coluna canônica de tabela com organização tem referência COMPOSTA", async () => {
    // A referência de coluna única prova que o UUID é uma empresa; não prova que é uma empresa DESTA
    // organização — e foi exatamente esse buraco que a PRE-BASE2-02 fechou à mão para o responsável de
    // compra. Aqui ele está fechado por construção, para as colunas de empresa que não estejam
    // NOMINALMENTE dispensadas no SSOT.
    //
    // A DISPENSA EM BLOCO SAIU (PRE-BASE2-05C-G1). Antes, `if (EXCECOES_RLS_EMPRESA[tabela]) continue`
    // usava uma resposta sobre POLÍTICA como dispensa de INTEGRIDADE REFERENCIAL, que é outra pergunta —
    // o mesmo erro que o primeiro caso deste arquivo já tinha consertado. Efeito medido: 4 das 52 colunas
    // não chegavam ao count; DUAS de fato não têm a composta (e ninguém tinha declarado por quê), e as
    // outras duas TÊM — remover `notifications_empresa_fk` ou `membro_empresas_empresa_fk` passava verde.
    //
    // A PROVA É ESTRUTURAL, NÃO TEXTUAL. `pg_get_constraintdef` omite o schema quando a tabela está no
    // `search_path` da sessão: o mesmo banco intacto responderia "REFERENCES erp.empresas(...)" ou
    // "REFERENCES empresas(...)" conforme o ambiente, e um guarda que casasse o texto ficaria refém
    // disso. Aqui se comparam OIDs e números de coluna — `confrelid` é a tabela alvo, `conkey` e
    // `confkey` são as colunas de origem e destino, na ordem. Também se exige `convalidated` (constraint
    // NOT VALID não responde pelo acervo) e `organization_id NOT NULL` (com MATCH SIMPLE, que é o
    // default, linha com tenant nulo não é conferida — e a composta deixaria de provar o que promete).
    const r = await db.query<{ tabela: string; coluna: string; org_not_null: boolean; composta: number }>(`
      with canonicas as (
        select c.oid as tabela_oid, c.relname as tabela, a.attname as coluna, a.attnum,
               (select o.attnotnull from pg_attribute o where o.attrelid=c.oid and o.attname='organization_id' and o.attnum>0 and not o.attisdropped) as org_not_null,
               (select o.attnum   from pg_attribute o where o.attrelid=c.oid and o.attname='organization_id' and o.attnum>0 and not o.attisdropped) as org_attnum
          from pg_class c
          join pg_namespace n on n.oid=c.relnamespace
          join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
         where n.nspname='erp' and c.relkind='r' and a.attname = any($1::text[])
           and exists (select 1 from pg_attribute o where o.attrelid=c.oid and o.attname='organization_id' and o.attnum>0 and not o.attisdropped))
      select k.tabela, k.coluna, k.org_not_null,
             (select count(*) from pg_constraint fk
               where fk.conrelid=k.tabela_oid and fk.contype='f' and fk.convalidated
                 and fk.confrelid = 'erp.empresas'::regclass
                 and fk.conkey  = array[k.org_attnum, k.attnum]::int2[]
                 and fk.confkey = array[
                       (select attnum from pg_attribute where attrelid='erp.empresas'::regclass and attname='organization_id'),
                       (select attnum from pg_attribute where attrelid='erp.empresas'::regclass and attname='id')]::int2[])::int as composta
        from canonicas k order by k.tabela, k.coluna`, [CANONICAL_COMPANY_COLUMNS]);
    const problemas: string[] = [];
    const dispensadas = new Set(Object.keys(SEM_FK_COMPOSTA_DECLARADA as Record<string, string>));
    const vistas = new Set<string>();
    let comComposta = 0;
    for (const { tabela, coluna, org_not_null, composta } of r.rows) {
      const chave = `${tabela}.${coluna}`;
      vistas.add(chave);
      const tem = composta > 0;
      if (tem) comComposta++;
      if (tem && !org_not_null) problemas.push(`erp.${chave}: tem a composta, mas organization_id é ANULÁVEL — com MATCH SIMPLE a linha de tenant nulo escapa da conferência`);
      if (tem && dispensadas.has(chave)) problemas.push(`erp.${chave}: está declarada em SEM_FK_COMPOSTA_DECLARADA mas GANHOU a composta — a dispensa envelheceu, remova-a do SSOT`);
      if (!tem && !dispensadas.has(chave)) problemas.push(`erp.${chave}: sem FOREIGN KEY (organization_id, ${coluna}) REFERENCES erp.empresas(organization_id, id) validada`);
    }
    // Dispensa órfã: declarar que uma coluna não tem composta e a coluna nem existir mais esconde o
    // buraco seguinte. Mesmo desenho do caso "exceção órfã" acima.
    for (const chave of dispensadas) if (!vistas.has(chave)) problemas.push(`${chave}: declarada em SEM_FK_COMPOSTA_DECLARADA e não existe no schema — dispensa órfã`);
    // A PREMISSA JUNTO COM A CONCLUSÃO, em três níveis:
    //  (1) o universo não encolheu — uma consulta que voltasse vazia (rename de schema, coluna
    //      renomeada) deixaria o laço sem executar asserção nenhuma;
    //  (2) a contagem FECHA — toda coluna ou tem a composta ou está dispensada, sem sobra;
    //  (3) a lista de dispensas não cresce sozinha. Um piso do tipo `>= 50` não travaria isso: ele
    //      só limita a lista como `total - 50`, então bastaria o universo crescer para abrir vaga em
    //      silêncio. O que se quer travar é o TAMANHO DA DISPENSA, e é ele que está escrito aqui.
    expect(r.rows.length, "as colunas canônicas de tabela com organização").toBeGreaterThanOrEqual(52);
    expect(dispensadas.size, "dispensas declaradas em SEM_FK_COMPOSTA_DECLARADA — crescer exige decisão, não parágrafo").toBe(2);
    expect(comComposta, "toda coluna não dispensada tem a composta validada").toBe(r.rows.length - [...dispensadas].filter((c) => vistas.has(c)).length);
    expect(problemas).toEqual([]);
  });

  /**
   * A INVARIANTE DE NEGÓCIO QUE A PURGA DERRUBA EM SILÊNCIO (PRE-BASE2-05C-G1).
   *
   * `erp.equipment_transfers` tem, desde a 0005 (linha 142), um CHECK anônimo e inline negando a igualdade
   * entre as duas pontas — batizado `equipment_transfers_check` pelo PostgreSQL. Medido em banco
   * descartável: o `drop column` da 05C-1 leva esse CHECK junto, sem erro e sem `cascade`. A migration
   * termina com sucesso e a regra "origem ≠ destino" simplesmente deixa de existir.
   * As grafias de cada fase vivem no SSOT (`scripts/lib/espelho-empresa.mjs`), não aqui: é lá que a 05C-1
   * vira a chave, e repeti-las neste arquivo criaria a segunda lista que envelhece em silêncio.
   *
   * Por isso a invariante é cobrada POR FASE, igual ao espelho: em `dual` sobre as colunas legadas, em
   * `canonica` sobre as canônicas. O que este caso prova é que, AO FIM de todas as migrations, existe um
   * CHECK validado na forma que a fase exige — não em que arquivo ele nasceu, que o catálogo não guarda.
   * Basta para o que importa: nenhuma 05C-1 consegue derrubar a invariante e ficar verde. Que o
   * substituto nasça no mesmo arquivo do drop é decisão de execução (decisão 118), não algo que este
   * guarda meça.
   */
  it("a invariante origem ≠ destino da transferência de equipamento existe na forma que a FASE exige", async () => {
    const c = await db.query<{ nome: string; definicao: string; validado: boolean }>(`
      select conname as nome, pg_get_constraintdef(oid) as definicao, convalidated as validado
        from pg_constraint where conrelid = 'erp.equipment_transfers'::regclass and contype = 'c'`);
    expect(c.rows.length, "erp.equipment_transfers tem CHECK para conferir").toBeGreaterThan(0);
    expect(conferirInvarianteDeTransferencia(FASE_ESPELHO, c.rows)).toEqual([]);
  });
});
