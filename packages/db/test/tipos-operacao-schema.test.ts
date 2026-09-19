import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O QUE A 0020 PROMETEU, PROVADO CONTRA O BANCO.
 *
 * Migration que cria tabela é fácil de conferir mal: basta a tabela existir e tudo "parece" certo. As coisas
 * que realmente importam aqui são invisíveis numa inspeção superficial — RLS FORÇADA (e não só habilitada),
 * UMA política por tabela (duas PERMISSIVE combinam com OR e a mais frouxa vence), o índice parcial que
 * impede duas padrão, e o gatilho que recusa reescrever histórico.
 */
/**
 * DUAS CONEXÕES, E A DIFERENÇA É O TESTE.
 *
 * `db` conecta como o papel de migração — SUPERUSUÁRIO, que IGNORA RLS mesmo com `force`. Ele serve para
 * montar cenário e para exercitar gatilho e constraint, que valem para todo mundo.
 *
 * `app` conecta como `erp_app_test`, herdeiro de `erp_app`: é o papel que a API usa em produção, sem bypass.
 * Só ele pode provar isolamento. A primeira versão deste arquivo tentou provar RLS pela conexão de
 * superusuário e "descobriu" que a organização B lia a linha da A — o teste estava certo em falhar, mas pelo
 * motivo errado: ele não estava medindo RLS, estava medindo um papel que RLS não alcança.
 */
let db: Db; let app: Db; let demo: DemoOrg;
beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
});
afterAll(async () => { await app.end(); await db.end(); });

const TABELAS = ["tipos_operacao", "tipos_operacao_versoes"];

async function criarTop(orgId: string, userId: string, codigo: string, base = "vendas.venda", padrao = false) {
  return withTx(db, { orgId, userId, modulo: null }, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao (organization_id, codigo, codigo_base, padrao, criado_por)
       values ($1,$2,$3,$4,$5) returning id`, [orgId, codigo, base, padrao, userId]);
    const id = r.rows[0]!.id;
    await tx.query(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, criado_por)
       values ($1,$2,1,$3,$4)`, [orgId, id, `Nome de ${codigo}`, userId]);
    return id;
  });
}

describe("0020 — estrutura e isolamento", () => {
  it("as duas tabelas existem com RLS habilitada E FORÇADA", async () => {
    // Forçada importa: sem `force`, o DONO da tabela ignora a política. A API não é dona, mas uma migration
    // futura que rodasse como dono passaria a enxergar todos os tenants sem nenhum aviso.
    const r = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='erp' and c.relname = any($1)`, [TABELAS]);
    expect(r.rows.map((x) => x.relname).sort()).toEqual([...TABELAS].sort());
    for (const t of r.rows) expect([t.relname, t.relrowsecurity, t.relforcerowsecurity]).toEqual([t.relname, true, true]);
  });

  it("exatamente UMA política por tabela", async () => {
    const r = await db.query<{ tablename: string; n: string }>(
      `select tablename, count(*) n from pg_policies where schemaname='erp' and tablename = any($1) group by tablename`,
      [TABELAS]);
    expect(r.rows.length).toBe(2);
    for (const t of r.rows) expect([t.tablename, Number(t.n)]).toEqual([t.tablename, 1]);
  });

  it("o papel da aplicação NÃO pode alterar nem apagar versão", async () => {
    // A imutabilidade do histórico tem duas trancas: o gatilho e o grant. Esta é a do grant.
    const r = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema='erp' and table_name='tipos_operacao_versoes' and grantee='erp_app'`);
    const concedidos = r.rows.map((x) => x.privilege_type).sort();
    expect(concedidos).toEqual(["INSERT", "SELECT"]);
  });

  it("ISOLAMENTO: a organização B não enxerga a TOP da A sob RLS", async () => {
    const outra = await db.query<{ id: string }>(
      "insert into erp.organizations(name, slug) values ($1,$2) returning id",
      ["[TEST] Org TOP schema", "orgtopschema"]);
    const orgB = outra.rows[0]!.id;
    const id = await criarTop(demo.orgId, demo.adminUserId, "T-ISO-1");

    // Pelo papel da APLICAÇÃO — o único que a RLS alcança.
    const comoB = await withTx(app, { orgId: orgB, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query("select id from erp.tipos_operacao where id=$1", [id]));
    expect(comoB.rowCount, "a organização B não lê a linha da A").toBe(0);

    const tentativaDeEscrita = await withTx(app, { orgId: orgB, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query("update erp.tipos_operacao set ativo=false where id=$1", [id]));
    expect(tentativaDeEscrita.rowCount, "zero linhas afetadas — não é erro, é invisibilidade").toBe(0);

    // A PREMISSA JUNTO COM A CONCLUSÃO: sem isto, um `where` que não casasse nada daria os mesmos zeros
    // acima e o teste passaria provando nada.
    const comoA = await withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query<{ ativo: boolean }>("select ativo from erp.tipos_operacao where id=$1", [id]));
    expect(comoA.rowCount, "a organização A enxerga a PRÓPRIA linha").toBe(1);
    expect(comoA.rows[0]!.ativo, "e a linha de A continua intacta").toBe(true);
  });
});

describe("0020 — invariantes", () => {
  it("código é único por organização e NÃO volta a ficar livre depois de excluído", async () => {
    await criarTop(demo.orgId, demo.adminUserId, "T-UNI-1");
    await expect(criarTop(demo.orgId, demo.adminUserId, "T-UNI-1")).rejects.toThrow(/ux_tipos_operacao_codigo|duplicate key/);

    await db.query("update erp.tipos_operacao set excluido_em=now() where organization_id=$1 and codigo=$2", [demo.orgId, "T-UNI-1"]);
    // Reaproveitar o código faria um relatório antigo apontar para outra identidade.
    await expect(criarTop(demo.orgId, demo.adminUserId, "T-UNI-1")).rejects.toThrow(/ux_tipos_operacao_codigo|duplicate key/);
  });

  it("no máximo UMA padrão por família — e a restrição é do banco", async () => {
    await criarTop(demo.orgId, demo.adminUserId, "T-PAD-1", "estoque.baixa", true);
    await expect(criarTop(demo.orgId, demo.adminUserId, "T-PAD-2", "estoque.baixa", true))
      .rejects.toThrow(/ux_tipos_operacao_padrao|duplicate key/);
    // Outra FAMÍLIA pode ter a sua própria padrão — a restrição é por família, não global.
    await expect(criarTop(demo.orgId, demo.adminUserId, "T-PAD-3", "estoque.devolucao", true)).resolves.toBeTruthy();
  });

  it("padrão INATIVA ou EXCLUÍDA libera o posto — o índice é parcial de propósito", async () => {
    await criarTop(demo.orgId, demo.adminUserId, "T-LIB-1", "compras.solicitacao", true);
    await db.query("update erp.tipos_operacao set ativo=false where organization_id=$1 and codigo=$2", [demo.orgId, "T-LIB-1"]);
    await expect(criarTop(demo.orgId, demo.adminUserId, "T-LIB-2", "compras.solicitacao", true)).resolves.toBeTruthy();
  });

  it("identidade é imutável: código, família e organização", async () => {
    const id = await criarTop(demo.orgId, demo.adminUserId, "T-IMU-1");
    await expect(db.query("update erp.tipos_operacao set codigo='OUTRO' where id=$1", [id]))
      .rejects.toThrow(/TIPO_OPERACAO_IDENTIDADE_IMUTAVEL/);
    await expect(db.query("update erp.tipos_operacao set codigo_base='estoque.baixa' where id=$1", [id]))
      .rejects.toThrow(/TIPO_OPERACAO_IDENTIDADE_IMUTAVEL/);
    // Mudar de tenant é o pior dos três: moveria um registro entre organizações sem deixar rastro.
    const outra = await db.query<{ id: string }>(
      "insert into erp.organizations(name, slug) values ($1,$2) returning id", ["[TEST] Org TOP mover", "orgtopmover"]);
    await expect(db.query("update erp.tipos_operacao set organization_id=$2 where id=$1", [id, outra.rows[0]!.id]))
      .rejects.toThrow(/TIPO_OPERACAO_IDENTIDADE_IMUTAVEL/);
  });

  it("versão é imutável: nem update, nem delete", async () => {
    const id = await criarTop(demo.orgId, demo.adminUserId, "T-VER-1");
    await expect(db.query("update erp.tipos_operacao_versoes set nome='reescrito' where tipo_operacao_id=$1", [id]))
      .rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
    await expect(db.query("delete from erp.tipos_operacao_versoes where tipo_operacao_id=$1", [id]))
      .rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
  });

  it("a chave estrangeira de versão é COMPOSTA: coluna única não prova tenant", async () => {
    const id = await criarTop(demo.orgId, demo.adminUserId, "T-FK-1");
    const outra = await db.query<{ id: string }>(
      "insert into erp.organizations(name, slug) values ($1,$2) returning id", ["[TEST] Org TOP fk", "orgtopfk"]);
    // Uma versão da organização B apontando para uma TOP de A seria invisível na leitura normal de cada uma.
    await expect(db.query(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome)
       values ($1,$2,99,'versão de outro tenant')`, [outra.rows[0]!.id, id]))
      .rejects.toThrow(/fk_tipos_operacao_versoes_tenant|violates foreign key/);
  });

  it("a forma do código e da família é conferida pelo banco", async () => {
    await expect(criarTop(demo.orgId, demo.adminUserId, "com espaço")).rejects.toThrow(/tipos_operacao_codigo_check|violates check/);
    await expect(criarTop(demo.orgId, demo.adminUserId, "T-FORMA-1", "NaoEhCodigo")).rejects.toThrow(/codigo_base_check|violates check/);
  });

  it("`atualizado_em` é carimbado pelo gatilho em português", async () => {
    // O gatilho genérico do acervo escreve `NEW.updated_at`; apontá-lo para estas tabelas faria TODO update
    // falhar. Esta asserção existe porque foi exatamente esse o defeito encontrado ao rodar a suíte da API.
    const id = await criarTop(demo.orgId, demo.adminUserId, "T-UPD-1");
    const antes = await db.query<{ atualizado_em: Date }>("select atualizado_em from erp.tipos_operacao where id=$1", [id]);
    await db.query("update erp.tipos_operacao set ativo=false where id=$1", [id]);
    const depois = await db.query<{ atualizado_em: Date }>("select atualizado_em from erp.tipos_operacao where id=$1", [id]);
    expect(depois.rows[0]!.atualizado_em.getTime()).toBeGreaterThanOrEqual(antes.rows[0]!.atualizado_em.getTime());
  });
});
