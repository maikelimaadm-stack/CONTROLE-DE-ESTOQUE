import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPool, type Db } from "../src/pool.js";
import { resetSchema, listMigrations, MIGRATIONS_DIR } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * A PURGA FÍSICA (0017) EM BANCO NOVO — PRE-BASE2-05C-1.
 *
 * Um banco recém-criado é o cenário mais fácil de aprovar e o mais fácil de aprovar SEM PROVAR NADA: toda
 * contagem de objeto legado dá zero num schema que nunca teve a ponte de compatibilidade de pé. Por isso
 * este arquivo não começa no fim. Ele sobe 0001..0016 primeiro, MEDE a ponte inteira montada (52 colunas,
 * 5 views, 52 gatilhos, 3 funções, 52 FKs de coluna única, 8 índices, 1 policy legada), e só então aplica a
 * 0017 pelo runner real. Cada zero do "depois" tem um número diferente de zero no "antes" ao lado — é isso
 * que separa "a purga removeu" de "nunca existiu".
 *
 * Toda contagem é comparada com um número ESPERADO EXPLÍCITO. Nenhum `>= 0`, nenhum `toBeGreaterThan`
 * frouxo: um piso aprova a remoção de dezenas de objetos que deveriam ter ficado.
 *
 * O ALVO das FKs compostas é comparado por OID (`erp.empresas`::regclass), nunca pelo texto de
 * `pg_get_constraintdef`: aquele texto qualifica o schema ou não conforme o `search_path` da sessão, então
 * um teste que casa string passa ou falha por causa de uma variável de ambiente, não por causa do schema.
 *
 * O QUE ESTE ARQUIVO NÃO PROVA: que a 0017 preserva ACERVO. Banco zero não tem linha nenhuma, e um
 * `drop column` apaga dado sem reclamar. Essa é a pergunta do `purga-0017-upgrade.test.ts`, que semeia
 * antes e confere linha a linha depois. Os dois arquivos juntos é que cobrem a fatia.
 */
let db: Db;

/** A migration sob teste. Nomeada uma vez: o resto do arquivo se refere a ela por esta constante. */
const ALVO = "0017_purge_farm_legacy.sql";

/** Inventário da ponte com a 0016 aplicada — medido de verdade, não copiado de documento. */
type Inventario = {
  colunasLegadas: number;
  viewsLegadas: number;
  gatilhosEspelho: number;
  funcoesSincronia: number;
  fksLegadas: number;
  indicesLegados: number;
  policiesComColunaLegada: number;
  checkLegado: number;
  checkCanonico: number;
  tabelas: number;
};

let antes: Inventario;
let depois: Inventario;
let aplicadasAte16: string[] = [];
let aplicadasNaPurga: string[] = [];

async function num(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: string }>(sql, params);
  return Number(r.rows[0]!.n);
}

/** As mesmas consultas de catálogo que a própria migration usa nas pré e pós-condições. */
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
    tabelas: await num(`select count(*)::text n from information_schema.tables
       where table_schema = 'erp' and table_type = 'BASE TABLE'`),
  };
}

/**
 * Sobe o banco só até a 0016. `MIGRATIONS_DIR` é lido na CARGA do módulo `migrate.js`, então a única forma
 * honesta de apontar o runner para outro diretório é recarregá-lo — mesmo mecanismo de
 * `runner-forward-only.test.ts`. O módulo importado estaticamente no topo deste arquivo continua apontado
 * para `supabase/migrations`, e é ele que aplica a 0017 no passo seguinte.
 */
async function subirAte16(): Promise<string[]> {
  return aplicarSubconjunto((nome) => nome < ALVO, 16, "sem a purga", (m) => expect(m, "e ele NÃO conhece a 0017").not.toContain(ALVO));
}

/**
 * Aplica a 0017 e PARA — mesmo mecanismo, com teto na própria purga.
 *
 * Antes da PRE-BASE2-05C-2 este passo era `migrate(db)` do módulo estático, e funcionava porque a 0017 era
 * a última do diretório. Com a 0018 versionada, aquela chamada passaria a aplicar as DUAS, e este arquivo
 * — que existe para medir a purga — começaria a medir a purga MAIS o que viesse depois. Não é afrouxamento
 * nenhum: o teto é explícito e nomeado, e a contagem continua exata (`toBe`, nunca `>=`). O que muda é que
 * o arquivo volta a medir só o seu assunto, em vez de absorver toda migration futura de carona.
 */
async function subirAte17(): Promise<string[]> {
  return aplicarSubconjunto((nome) => nome <= ALVO, 17, "até a purga, inclusive", (m) => expect(m, "e ele conhece a 0017").toContain(ALVO));
}

async function aplicarSubconjunto(
  incluir: (nome: string) => boolean, quantas: number, rotulo: string,
  conferir: (nomes: string[]) => void,
): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purga-fresh-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const selecionadas = listMigrations().map((m) => m.name).filter(incluir);
    expect(selecionadas.length, `o diretório real precisa ter ${quantas} migrations ${rotulo}`).toBe(quantas);
    for (const nome of selecionadas) fs.copyFileSync(path.join(MIGRATIONS_DIR, nome), path.join(dir, nome));

    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const runner = await import("../src/migrate.js");
    expect(runner.MIGRATIONS_DIR, `o módulo recarregado enxerga o diretório ${rotulo}`).toBe(dir);
    conferir(runner.listMigrations().map((m) => m.name));
    return await runner.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR;
    else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);

  aplicadasAte16 = await subirAte16();
  antes = await inventariar();

  // Teto na própria purga: o ledger já tem 16 linhas, então só a 0017 fica pendente NESTE recorte.
  aplicadasNaPurga = await subirAte17();
  depois = await inventariar();
}, 300_000);

afterAll(async () => { await db?.end(); });

describe("0017 em banco zero: a sequência inteira aplica e o ledger fecha na purga", () => {
  it("o diretório tem 22 migrations e a purga é a 17ª", () => {
    const noDisco = listMigrations().map((m) => m.name);
    // Números explícitos de propósito: este é o gate da fatia destrutiva, e uma migration nova precisa
    // passar por aqui conscientemente — não entrar de carona num `>= 16`. A 05C-2 passou: acrescentou a
    // 0018, e a afirmação "a purga é a ÚLTIMA" — que era verdadeira e deixou de ser — virou a afirmação
    // que continua verdadeira e é a que este arquivo precisa: a purga ocupa a POSIÇÃO 17. O hotfix da
    // numeração de transferências é a terceira a passar por aqui, e acrescenta a própria linha: o que o
    // arquivo trava é a POSIÇÃO da purga, e ela continua sendo a 17ª. A TOP-CONFIG-01 é a quarta: a 0020
    // cria tabelas novas e não toca em nada que a purga leia, então a posição 17 segue intacta. A
    // TOP-CONFIG-02 é a quinta: a 0021 só ACRESCENTA duas colunas nulas a `erp.sales_documents` e uma chave
    // candidata às versões de TOP — nada que a purga leia, e a posição 17 segue intacta. A TOP-CONFIG-03 é a
    // sexta: a 0022 acrescenta duas colunas à VERSÃO da TOP e cria a tabela do grafo de próximas operações.
    // Nenhuma das duas coisas existe no recorte que a purga lê (o acervo legado de fazenda), e nenhuma
    // altera tabela que a purga toque — a posição 17 segue intacta.
    expect(noDisco.length, "22 migrations no repositório").toBe(22);
    expect(noDisco[16], "a purga é a 17ª da ordem").toBe(ALVO);
    expect(noDisco[17], "e a 18ª é o cutover do contador (PRE-BASE2-05C-2)").toBe("0018_empresa_code_sequence.sql");
    expect(noDisco[18], "e a 19ª é o hotfix da numeração de transferências").toBe("0019_warehouse_transfer_code_sequence.sql");
    expect(noDisco[19], "e a 20ª é o cadastro de TOP configurada (TOP-CONFIG-01)").toBe("0020_tipos_operacao.sql");
    expect(noDisco[20], "e a 21ª é o snapshot da TOP no documento de venda (TOP-CONFIG-02)").toBe("0021_sales_document_tipo_operacao.sql");
    expect(noDisco[21], "e a 22ª é a configuração versionada da TOP (TOP-CONFIG-03)").toBe("0022_tipo_operacao_configuracao_versionada.sql");
  });

  it("as 16 anteriores aplicam, e a 0017 aplica sozinha em seguida", () => {
    expect(aplicadasAte16.length, "0001..0016 aplicadas em banco zero").toBe(16);
    expect(aplicadasAte16[15]).toBe("0016_global_id_activation.sql");
    expect(aplicadasNaPurga, "só a purga estava pendente, e ela aplicou").toEqual([ALVO]);
  });

  it("o ledger tem 17 entradas e cobre exatamente o diretório", async () => {
    const ledger = (await db.query<{ name: string }>(
      "select name from public.erp_migrations order by name")).rows.map((r) => r.name);
    expect(ledger.length, "17 linhas no ledger").toBe(17);
    expect(ledger[16], "a última entrada é a purga").toBe(ALVO);
    // O recorte é explícito: este arquivo mede a purga, e o ledger dele fecha NELA. As migrations
    // posteriores existem no diretório e são medidas pelas suítes das próprias fatias.
    expect(ledger, "ledger idêntico ao diretório ATÉ a purga")
      .toEqual(listMigrations().map((m) => m.name).filter((nome) => nome <= ALVO));
  });
});

describe("a premissa: com a 0016 aplicada a ponte legada estava INTEIRA", () => {
  // Sem este bloco, todo o bloco seguinte passaria num banco que nunca teve ponte nenhuma.
  it("52 colunas legadas, 5 views, 52 gatilhos, 3 funções, 52 FKs, 8 índices, 1 policy, 1 CHECK", () => {
    expect(antes.colunasLegadas, "farm_id 47 + destination_farm_id 3 + origin_farm_id 2").toBe(52);
    expect(antes.viewsLegadas).toBe(5);
    expect(antes.gatilhosEspelho).toBe(52);
    expect(antes.funcoesSincronia).toBe(3);
    expect(antes.fksLegadas).toBe(52);
    expect(antes.indicesLegados).toBe(8);
    expect(antes.policiesComColunaLegada, "erp.empresa_cost_centers.api_child").toBe(1);
    expect(antes.checkLegado, "equipment_transfers_check sobre as colunas legadas").toBe(1);
    expect(antes.checkCanonico, "o CHECK canônico ainda NÃO existia antes da purga").toBe(0);
  });
});

describe("depois da 0017: zero ponte legada", () => {
  it("nenhuma coluna legada em nenhuma tabela do schema erp", () => {
    expect(depois.colunasLegadas).toBe(0);
  });

  it("nenhuma das 5 views de nome antigo", async () => {
    expect(depois.viewsLegadas).toBe(0);
    const sobreviventes = (await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'erp' and c.relname in
              ('farms','proprietary_farms','authorizer_farms','bank_account_farms','farm_cost_centers')`)).rows;
    expect(sobreviventes.map((r) => r.relname), "nem como tabela, nem com outro relkind").toEqual([]);
  });

  it("nenhum gatilho de espelho e nenhuma função de sincronia", () => {
    expect(depois.gatilhosEspelho).toBe(0);
    expect(depois.funcoesSincronia).toBe(0);
  });

  it("nenhuma FK legada de coluna única e nenhum índice legado", () => {
    expect(depois.fksLegadas).toBe(0);
    expect(depois.indicesLegados).toBe(0);
  });

  it("nenhuma policy do schema decide mais por coluna legada", () => {
    expect(depois.policiesComColunaLegada).toBe(0);
  });
});

describe("o que a purga tinha de PRESERVAR", () => {
  it("as 50 FKs compostas canônicas continuam de pé e VALIDADAS", async () => {
    // O alvo é comparado por OID: `confrelid = 'erp.empresas'::regclass`. Casar o texto de
    // pg_get_constraintdef ('REFERENCES empresas' vs 'REFERENCES erp.empresas') dependeria do search_path.
    const total = await num(`select count(*)::text n from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
         and k.confrelid = 'erp.empresas'::regclass and k.convalidated`);
    expect(total, "45 empresa_id + 2 empresa_origem_id + 3 empresa_destino_id").toBe(50);

    const naoValidadas = await num(`select count(*)::text n from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
         and k.confrelid = 'erp.empresas'::regclass and not k.convalidated`);
    expect(naoValidadas, "NOT VALID aceitaria linha nova fora de escopo").toBe(0);
  });

  it("e cada uma delas prova TENANT: a primeira coluna é organization_id", async () => {
    const porColuna = (await db.query<{ attname: string; n: string }>(
      `select a.attname, count(*)::text n from pg_constraint k
         join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[2]
        where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
          and k.confrelid = 'erp.empresas'::regclass
        group by a.attname order by a.attname`)).rows;
    expect(porColuna.map((r) => [r.attname, Number(r.n)])).toEqual([
      ["empresa_destino_id", 3], ["empresa_id", 45], ["empresa_origem_id", 2],
    ]);

    const semTenant = await num(`select count(*)::text n from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
         and k.confrelid = 'erp.empresas'::regclass and a.attname <> 'organization_id'`);
    expect(semTenant, "coluna única não prova tenant — a composta começa em organization_id").toBe(0);
  });

  it("o CHECK canônico de erp.equipment_transfers existe, está validado, e o legado saiu", async () => {
    expect(depois.checkCanonico).toBe(1);
    expect(depois.checkLegado).toBe(0);
    const def = (await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) def from pg_constraint
        where conrelid = 'erp.equipment_transfers'::regclass
          and conname = 'equipment_transfers_empresa_origem_destino_check'`)).rows[0]!.def;
    expect(def, "a invariante é sobre as colunas canônicas").toContain("empresa_origem_id");
    expect(def).toContain("empresa_destino_id");
    expect(def, "e não sobre as legadas").not.toContain("farm_id");
  });

  it("erp.empresa_cost_centers tem UMA policy api_child, canônica", async () => {
    const policies = (await db.query<{ policyname: string; cmd: string; permissive: string; qual: string; with_check: string | null }>(
      `select policyname, cmd, permissive, qual, with_check from pg_policies
        where schemaname = 'erp' and tablename = 'empresa_cost_centers' order by policyname`)).rows;
    // UMA só: duas PERMISSIVE no mesmo comando combinariam com OR e a mais frouxa acabaria valendo.
    expect(policies.length, "uma única policy na tabela").toBe(1);
    const p = policies[0]!;
    expect(p.policyname).toBe("api_child");
    expect(p.cmd).toBe("ALL");
    expect(p.qual, "leitura decide por empresa_id").toContain("empresa_cost_centers.empresa_id");
    expect(p.qual).not.toContain("farm_id");
    expect(p.with_check, "escrita faz a MESMA pergunta — sem with_check, INSERT passaria livre").toBeTruthy();
    expect(p.with_check!).toContain("empresa_cost_centers.empresa_id");
    expect(p.with_check!).not.toContain("farm_id");
  });

  it("erp.v_bank_account_balances sobreviveu — a purga não levou view inocente junto", async () => {
    const r = (await db.query<{ relkind: string }>(
      `select c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'erp' and c.relname = 'v_bank_account_balances'`)).rows;
    expect(r.length, "a view existe").toBe(1);
    expect(r[0]!.relkind).toBe("v");
    // Existir no catálogo não é o bastante: uma view pode ficar de pé e quebrada. Consultar prova que a
    // definição dela continua resolvendo contra o schema pós-purga.
    expect(await num("select count(*)::text n from erp.v_bank_account_balances"), "banco zero: 0 linhas, mas a consulta RESOLVE").toBe(0);
  });

  it("o contador de transição não foi tocado: erp.code_sequences e erp.next_code continuam", async () => {
    const r = (await db.query<{ tabela: string | null; funcao: string | null; col: string }>(
      `select to_regclass('erp.code_sequences')::text tabela,
              to_regprocedure('erp.next_code(uuid,text)')::text funcao,
              (select count(*)::text from pg_attribute a
                 where a.attrelid = 'erp.code_sequences'::regclass and a.attname = 'entity'
                   and a.attnum > 0 and not a.attisdropped) col`)).rows[0]!;
    expect(r.tabela).toBe("erp.code_sequences");
    expect(r.funcao, "a função do contador continua com a mesma assinatura").toBe("erp.next_code(uuid,text)");
    expect(Number(r.col), "a coluna que guarda entity='farm' continua lá").toBe(1);
  });

  it("nenhuma tabela do schema erp caiu", () => {
    expect(antes.tabelas, "premissa: o schema subiu inteiro antes da purga").toBe(181);
    expect(depois.tabelas, "igualdade exata — um piso toleraria a queda de dezenas").toBe(antes.tabelas);
  });
});
