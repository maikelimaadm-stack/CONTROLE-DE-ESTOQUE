import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O QUE A 0021 PROMETEU, PROVADO CONTRA O BANCO.
 *
 * O snapshot da TOP no documento de venda tem TRÊS invariantes que nenhuma tela mostraria quebradas:
 *
 *   PARIDADE   pai sem versão (ou versão sem pai) é meia identidade — a leitura cairia de volta no nome
 *              ATUAL da TOP, que é exatamente o histórico reescrito que os dois ponteiros impedem.
 *   PARENTESCO a versão apontada tem de ser DAQUELA TOP. Uma FK só pelo `id` da versão deixaria o
 *              documento citar a versão 3 da 2101 enquanto diz ser a 2103 — e exibiria o nome do vizinho.
 *   TENANT     as três coisas na mesma organização. Coluna única não prova tenant.
 *
 * E uma quarta, de compatibilidade: as colunas continuam NULLABLE, porque acervo e rolling deploy dependem
 * disso. Um `not null` aqui derrubaria a criação de vendas no meio de um deploy.
 */
let db: Db; let app: Db; let demo: DemoOrg;
beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

/** Cadastra uma TOP com a versão 1, como a API faz: pai e versão na MESMA transação. */
async function criarTop(orgId: string, codigo: string, base = "vendas.venda"): Promise<{ id: string; versaoId: string }> {
  return withTx(db, { orgId, userId: demo.adminUserId, modulo: null }, async (tx) => {
    const p = await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao (organization_id, codigo, codigo_base, criado_por)
       values ($1,$2,$3,$4) returning id`, [orgId, codigo, base, demo.adminUserId]);
    const id = p.rows[0]!.id;
    const v = await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, criado_por)
       values ($1,$2,1,$3,$4) returning id`, [orgId, id, `Nome de ${codigo}`, demo.adminUserId]);
    return { id, versaoId: v.rows[0]!.id };
  });
}

/** Cria um documento de venda cru, com os dois ponteiros como vierem. */
async function criarVenda(orgId: string, codigo: string, topId: string | null, versaoId: string | null) {
  const empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [orgId])).rows[0]!.id;
  const cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client limit 1", [orgId])).rows[0]!.id;
  return db.query<{ id: string }>(
    `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, tipo_operacao_id, tipo_operacao_versao_id)
     values ($1,$2,'sale',$3,'2026-09-01',$4,$5,$6) returning id`,
    [orgId, empresa, codigo, cliente, topId, versaoId]);
}

describe("0021 — estrutura do snapshot", () => {
  it("as duas colunas existem e são NULLABLE — acervo e rolling deploy dependem disso", async () => {
    const r = await db.query<{ column_name: string; is_nullable: string; data_type: string }>(
      `select column_name, is_nullable, data_type from information_schema.columns
        where table_schema='erp' and table_name='sales_documents'
          and column_name in ('tipo_operacao_id','tipo_operacao_versao_id') order by column_name`);
    expect(r.rows.map((x) => x.column_name)).toEqual(["tipo_operacao_id", "tipo_operacao_versao_id"]);
    for (const c of r.rows) expect([c.column_name, c.is_nullable, c.data_type]).toEqual([c.column_name, "YES", "uuid"]);
  });

  it("as duas FKs são compostas, apontam para o alvo certo e NÃO cascateiam", async () => {
    const r = await db.query<{ conname: string; confdeltype: string; confupdtype: string; def: string }>(
      `select conname, confdeltype, confupdtype, pg_get_constraintdef(oid) as def
         from pg_constraint
        where conname in ('fk_sales_documents_tipo_operacao','fk_sales_documents_tipo_operacao_versao')
        order by conname`);
    expect(r.rowCount, "as duas FKs precisam existir").toBe(2);
    for (const c of r.rows) {
      // `a` = NO ACTION. CASCADE apagaria documentos de venda ao apagar uma CONFIGURAÇÃO; SET NULL apagaria
      // a identidade do lançamento em silêncio, que é pior.
      expect([c.conname, c.confdeltype, c.confupdtype], c.conname).toEqual([c.conname, "a", "a"]);
      expect(c.def, `${c.conname} precisa levar organization_id`).toContain("organization_id");
    }
    expect(r.rows.find((x) => x.conname === "fk_sales_documents_tipo_operacao_versao")!.def)
      .toContain("(tipo_operacao_versao_id, tipo_operacao_id, organization_id)");
  });

  it("o índice do filtro por TOP existe e é parcial", async () => {
    const r = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname='erp' and indexname='ix_sales_documents_tipo_operacao'");
    expect(r.rowCount).toBe(1);
    expect(r.rows[0]!.indexdef).toContain("deleted_at IS NULL");
  });

  it("`erp.sales_documents` continua com RLS habilitada E FORÇADA depois do ALTER", async () => {
    const r = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='erp' and c.relname='sales_documents'`);
    expect([r.rows[0]!.relrowsecurity, r.rows[0]!.relforcerowsecurity]).toEqual([true, true]);
  });
});

describe("0021 — paridade dos dois ponteiros", () => {
  it("AMBOS NULOS é válido — é o documento legado", async () => {
    await expect(criarVenda(demo.orgId, "V-LEG-1", null, null)).resolves.toBeTruthy();
  });

  it("AMBOS PREENCHIDOS é válido — é o lançamento novo", async () => {
    const t = await criarTop(demo.orgId, "T-SNAP-1");
    await expect(criarVenda(demo.orgId, "V-SNAP-1", t.id, t.versaoId)).resolves.toBeTruthy();
  });

  it("SÓ O PAI é recusado — meia identidade cairia de volta no nome atual da TOP", async () => {
    const t = await criarTop(demo.orgId, "T-SNAP-2");
    await expect(criarVenda(demo.orgId, "V-META-1", t.id, null))
      .rejects.toThrow(/sales_documents_tipo_operacao_par|violates check/);
  });

  it("SÓ A VERSÃO é recusada — ponteiro sem dono", async () => {
    const t = await criarTop(demo.orgId, "T-SNAP-3");
    await expect(criarVenda(demo.orgId, "V-META-2", null, t.versaoId))
      .rejects.toThrow(/sales_documents_tipo_operacao_par|violates check/);
  });
});

describe("0021 — parentesco e tenant", () => {
  it("a versão tem de ser DAQUELA TOP — versão de outra TOP é recusada", async () => {
    // O caso que uma FK só pelo `id` da versão deixaria passar: o documento citaria a versão de uma TOP e
    // diria ser outra, exibindo o nome do vizinho sem erro nenhum.
    const a = await criarTop(demo.orgId, "T-PAR-1");
    const b = await criarTop(demo.orgId, "T-PAR-2");
    await expect(criarVenda(demo.orgId, "V-PAR-1", a.id, b.versaoId))
      .rejects.toThrow(/fk_sales_documents_tipo_operacao_versao|violates foreign key/);
    // A PREMISSA: com a versão CERTA, a mesma inserção passa.
    await expect(criarVenda(demo.orgId, "V-PAR-2", a.id, a.versaoId)).resolves.toBeTruthy();
  });

  it("TOP de OUTRA ORGANIZAÇÃO é recusada — coluna única não prova tenant", async () => {
    const outra = await db.query<{ id: string }>(
      "insert into erp.organizations(name, slug) values ($1,$2) returning id", ["[TEST] Org venda TOP", "orgvendatop"]);
    const orgB = outra.rows[0]!.id;
    const tB = await criarTop(orgB, "T-TEN-1");
    // O documento é da organização A; os ponteiros são da B. Sem a FK composta, isto entraria — e a venda
    // de A passaria a exibir o nome de uma configuração de B.
    await expect(criarVenda(demo.orgId, "V-TEN-1", tB.id, tB.versaoId))
      .rejects.toThrow(/fk_sales_documents_tipo_operacao|violates foreign key/);
  });

  it("TOP inexistente é recusada", async () => {
    const fantasma = "00000000-0000-0000-0000-000000000000";
    await expect(criarVenda(demo.orgId, "V-FAN-1", fantasma, fantasma))
      .rejects.toThrow(/fk_sales_documents_tipo_operacao|violates foreign key/);
  });
});

describe("0021 — o histórico sobrevive à configuração", () => {
  it("SOFT DELETE da TOP não quebra a FK: o documento continua lendo o snapshot", async () => {
    const t = await criarTop(demo.orgId, "T-SOFT-1");
    const v = await criarVenda(demo.orgId, "V-SOFT-1", t.id, t.versaoId);
    await db.query("update erp.tipos_operacao set excluido_em=now(), padrao=false where id=$1", [t.id]);

    // A linha continua existindo (exclusão é LÓGICA), então a FK continua satisfeita e o join ainda casa.
    const r = await db.query<{ nome: string; versao: number }>(
      `select v.nome, v.versao from erp.sales_documents d
         join erp.tipos_operacao_versoes v on v.id = d.tipo_operacao_versao_id
        where d.id = $1`, [v.rows[0]!.id]);
    expect(r.rowCount, "excluir a configuração não pode apagar o passado").toBe(1);
    expect(r.rows[0]).toMatchObject({ nome: "Nome de T-SOFT-1", versao: 1 });
  });

  it("DELETE FÍSICO da TOP é TRAVADO pela FK — sem cascata, sem apagar venda", async () => {
    const t = await criarTop(demo.orgId, "T-HARD-1");
    await criarVenda(demo.orgId, "V-HARD-1", t.id, t.versaoId);
    await expect(db.query("delete from erp.tipos_operacao where id=$1", [t.id]))
      .rejects.toThrow(/violates foreign key|still referenced/);
  });

  it("a versão apontada continua IMUTÁVEL — o gatilho da 0020 segue valendo", async () => {
    const t = await criarTop(demo.orgId, "T-IMU-2");
    await criarVenda(demo.orgId, "V-IMU-1", t.id, t.versaoId);
    await expect(db.query("update erp.tipos_operacao_versoes set nome='reescrito' where id=$1", [t.versaoId]))
      .rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
    await expect(db.query("delete from erp.tipos_operacao_versoes where id=$1", [t.versaoId]))
      .rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
  });
});

describe("0021 — compatibilidade com binário anterior", () => {
  it("INSERT no estilo ANTIGO (sem as colunas novas) continua funcionando", async () => {
    // Este é o teste de ROLLBACK DE BINÁRIO: uma API anterior à fatia não conhece as colunas e não as
    // menciona. Se a 0021 as tivesse criado NOT NULL, este insert falharia — e o rollback derrubaria a
    // criação de vendas com o schema novo já aplicado.
    const empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
    const cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client limit 1", [demo.orgId])).rows[0]!.id;
    const r = await db.query<{ id: string }>(
      `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id)
       values ($1,$2,'sale','V-OLD-1','2026-09-01',$3) returning id`, [demo.orgId, empresa, cliente]);
    expect(r.rowCount).toBe(1);
    const cols = await db.query<{ tipo_operacao_id: string | null }>("select tipo_operacao_id from erp.sales_documents where id=$1", [r.rows[0]!.id]);
    expect(cols.rows[0]!.tipo_operacao_id, "nasce legado, sem inventar TOP").toBeNull();
  });

  it("SELECT no estilo ANTIGO (`d.*`) continua funcionando com as colunas extras", async () => {
    // Colunas a mais não quebram um `select d.*` — mas a asserção existe porque o contrário (coluna a
    // MENOS) quebraria, e é bom ter a direção medida em vez de suposta.
    const r = await db.query("select d.* from erp.sales_documents d where d.organization_id=$1 limit 1", [demo.orgId]);
    expect(r.rowCount).toBe(1);
    expect(Object.keys(r.rows[0] as object)).toContain("tipo_operacao_versao_id");
  });

  it("ISOLAMENTO sob RLS: a organização B não lê a venda de A pelo papel da aplicação", async () => {
    const t = await criarTop(demo.orgId, "T-RLS-1");
    const v = await criarVenda(demo.orgId, "V-RLS-1", t.id, t.versaoId);
    const id = v.rows[0]!.id;
    const orgB = (await db.query<{ id: string }>("select id from erp.organizations where slug='orgvendatop'")).rows[0]!.id;

    const comoB = await withTx(app, { orgId: orgB, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query("select id from erp.sales_documents where id=$1", [id]));
    expect(comoB.rowCount, "B não enxerga a venda de A").toBe(0);

    // PREMISSA JUNTO DA CONCLUSÃO: sem isto, um `where` que não casasse nada daria o mesmo zero.
    const comoA = await withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query<{ tipo_operacao_id: string }>("select tipo_operacao_id from erp.sales_documents where id=$1", [id]));
    expect(comoA.rowCount, "A enxerga a própria venda").toBe(1);
    expect(comoA.rows[0]!.tipo_operacao_id).toBe(t.id);
  });
});
