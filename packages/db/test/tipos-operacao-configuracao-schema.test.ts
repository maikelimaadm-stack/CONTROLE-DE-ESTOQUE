import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O QUE A 0022 PROMETEU, PROVADO CONTRA O BANCO.
 *
 * A promessa central é estranha para uma migration: ela acrescenta colunas a uma tabela que RECUSA
 * `UPDATE`. É por isso que o preenchimento das linhas antigas é feito por `DEFAULT` de DDL, e é por isso
 * que o `DEFAULT` PERMANECE — durante o rolling deploy quem insere versão é o binário ANTIGO, que não
 * conhece as colunas novas.
 *
 * Duas conexões, e a diferença é o teste: `db` é o papel de migração (superusuário, IGNORA RLS) e serve
 * para montar cenário e exercitar gatilho/constraint; `app` é `erp_app_test`, herdeiro de `erp_app`, sem
 * bypass — só ele prova isolamento e só ele prova privilégio.
 */
let db: Db; let app: Db; let demo: DemoOrg;
beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
});
afterAll(async () => { await app.end(); await db.end(); });

/** Cria uma TOP com a versão 1, pelo caminho que a API usa. Devolve o id da TOP. */
async function criarTop(orgId: string, userId: string, codigo: string, base = "vendas.venda") {
  return withTx(db, { orgId, userId, modulo: null }, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao (organization_id, codigo, codigo_base, criado_por)
       values ($1,$2,$3,$4) returning id`, [orgId, codigo, base, userId]);
    const id = r.rows[0]!.id;
    await tx.query(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, criado_por)
       values ($1,$2,1,$3,$4)`, [orgId, id, `Nome de ${codigo}`, userId]);
    return id;
  });
}

const CONFIG_RICA = {
  versaoSchema: 1,
  geral: { confirmacao: "manual", exigeParceiro: true, exigeCentroResultado: false, exigeObservacao: false, alteracaoAposConfirmacao: "bloqueada", documentoSemItens: "proibido" },
  estoque: { atualizacao: "saida", momento: "confirmacao", exigeArmazem: true, saldoNegativo: "bloquear" },
  financeiro: { atualizacao: "receber", modo: "incluir", momento: "confirmacao", exigeFormaPagamento: false, exigeVencimento: true, exigeCentroResultado: false },
  fiscal: { habilitado: true, exigeDocumentoFiscal: true, exigeNaturezaOperacao: false, exigeRegraTributaria: false, calculoTributario: "nao_aplicar" },
  aprovacao: { politica: "nenhuma", valorMinimo: null, momento: "antes_da_confirmacao" },
};

describe("0022 — a configuração versionada existe e tem forma", () => {
  it("as duas colunas existem, são NOT NULL e têm DEFAULT", async () => {
    const r = await db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
      `select column_name, is_nullable, column_default from information_schema.columns
        where table_schema='erp' and table_name='tipos_operacao_versoes'
          and column_name in ('configuracao','configuracao_schema_version')
        order by column_name`);
    expect(r.rows.map((x) => x.column_name)).toEqual(["configuracao", "configuracao_schema_version"]);
    for (const linha of r.rows) {
      expect(linha.is_nullable, `${linha.column_name} precisa ser NOT NULL`).toBe("NO");
      // O DEFAULT NÃO É DETALHE: é ele que preenche o acervo (a tabela recusa UPDATE) e é ele que sustenta
      // o rolling deploy, quando quem insere é a API antiga, que não cita estas colunas.
      expect(linha.column_default, `${linha.column_name} precisa manter o DEFAULT`).not.toBeNull();
    }
  });

  it("o DEFAULT é a configuração NEUTRA: nada de estoque, financeiro, fiscal ou aprovação", async () => {
    // `column_default` vem como o TEXTO `'{...}'::jsonb`; o literal precisa ser extraído antes do cast.
    const r = await db.query<{ c: Record<string, Record<string, unknown>> }>(
      `select (substring(column_default from $re$^'(.*)'::jsonb$$re$))::jsonb as c
         from information_schema.columns
        where table_schema='erp' and table_name='tipos_operacao_versoes' and column_name='configuracao'`);
    const c = r.rows[0]!.c;
    expect(c.versaoSchema).toBe(1);
    expect(c.estoque!.atualizacao).toBe("nenhuma");
    expect(c.financeiro!.atualizacao).toBe("nenhuma");
    expect(c.fiscal!.habilitado).toBe(false);
    expect(c.aprovacao!.politica).toBe("nenhuma");
  });

  it("o check de FORMA recusa payload que não tem as cinco seções", async () => {
    const id = await criarTop(demo.orgId, demo.ownerId, "C0001");
    await expect(db.query(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao)
       values ($1,$2,2,'x','{"versaoSchema":1,"geral":{}}'::jsonb)`, [demo.orgId, id]),
    ).rejects.toThrow(/configuracao_forma/);
  });

  it("o check recusa configuração que não é objeto", async () => {
    const id = await criarTop(demo.orgId, demo.ownerId, "C0002");
    await expect(db.query(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao)
       values ($1,$2,2,'x','[]'::jsonb)`, [demo.orgId, id]),
    ).rejects.toThrow(/configuracao_forma/);
  });

  it("a coluna de schema e o payload não podem discordar", async () => {
    const id = await criarTop(demo.orgId, demo.ownerId, "C0003");
    await expect(db.query(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
       values ($1,$2,2,'x',$3::jsonb,2)`, [demo.orgId, id, JSON.stringify(CONFIG_RICA)]),
    ).rejects.toThrow(/configuracao_schema/);
  });
});

describe("0022 — o acervo foi preservado e preenchido", () => {
  it("TODA versão existente tem configuração válida, sem nenhum UPDATE ter sido possível", async () => {
    const r = await db.query<{ total: string; sem_config: string }>(
      `select count(*)::text as total,
              count(*) filter (where configuracao is null or jsonb_typeof(configuracao) <> 'object')::text as sem_config
         from erp.tipos_operacao_versoes`);
    // A premissa CONTADA: se não houvesse versão nenhuma, "zero sem configuração" seria verdade de graça.
    expect(Number(r.rows[0]!.total), "o seed precisa ter deixado versões para esta prova valer").toBeGreaterThan(0);
    expect(Number(r.rows[0]!.sem_config)).toBe(0);
  });

  it("uma versão inserida SEM citar as colunas novas nasce neutra — é o rolling deploy", async () => {
    const id = await criarTop(demo.orgId, demo.ownerId, "C0004");
    // Exatamente o INSERT do binário ANTERIOR: ele não conhece `configuracao`.
    await db.query(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, criado_por)
       values ($1,$2,2,'Versao do binario antigo',$3)`, [demo.orgId, id, demo.ownerId]);
    const r = await db.query<{ atualizacao: string; schema: number }>(
      `select configuracao->'estoque'->>'atualizacao' as atualizacao, configuracao_schema_version as schema
         from erp.tipos_operacao_versoes where tipo_operacao_id=$1 and versao=2`, [id]);
    expect(r.rows[0]!.atualizacao).toBe("nenhuma");
    expect(r.rows[0]!.schema).toBe(1);
  });
});

describe("0022 — a imutabilidade da 0020 continua de pé", () => {
  it("UPDATE da configuração é recusado pelo gatilho: editar cria versão nova, não reescreve a velha", async () => {
    const id = await criarTop(demo.orgId, demo.ownerId, "C0005");
    await expect(db.query(
      `update erp.tipos_operacao_versoes set configuracao = $2::jsonb where tipo_operacao_id = $1 and versao = 1`,
      [id, JSON.stringify(CONFIG_RICA)]),
    ).rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
  });

  it("DELETE de versão continua recusado", async () => {
    const id = await criarTop(demo.orgId, demo.ownerId, "C0006");
    await expect(db.query(`delete from erp.tipos_operacao_versoes where tipo_operacao_id = $1`, [id]))
      .rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
  });

  it("a aplicação NÃO recuperou UPDATE/DELETE na tabela de versões", async () => {
    const r = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema='erp' and table_name='tipos_operacao_versoes' and grantee='erp_app'
          and privilege_type in ('UPDATE','DELETE')`);
    expect(r.rows).toEqual([]);
  });

  it("a versão nova carrega a configuração dela, e a anterior continua com a dela", async () => {
    const id = await criarTop(demo.orgId, demo.ownerId, "C0007");
    await db.query(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, criado_por)
       values ($1,$2,2,'Com configuracao',$3::jsonb,$4)`,
      [demo.orgId, id, JSON.stringify(CONFIG_RICA), demo.ownerId]);
    const r = await db.query<{ versao: number; atualizacao: string }>(
      `select versao, configuracao->'estoque'->>'atualizacao' as atualizacao
         from erp.tipos_operacao_versoes where tipo_operacao_id=$1 order by versao`, [id]);
    expect(r.rows.map((x) => [x.versao, x.atualizacao])).toEqual([[1, "nenhuma"], [2, "saida"]]);
  });
});

describe("0022 — isolamento por tenant continua valendo para a configuração", () => {
  it("ISOLAMENTO sob RLS: a organização B não lê a configuração da A pelo papel da aplicação", async () => {
    const id = await criarTop(demo.orgId, demo.ownerId, "C0008");
    await db.query(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, criado_por)
       values ($1,$2,2,'Config da A',$3::jsonb,$4)`,
      [demo.orgId, id, JSON.stringify(CONFIG_RICA), demo.ownerId]);

    const outraOrg = "00000000-0000-4000-8000-0000000000b0";
    const r = await withTx(app, { orgId: outraOrg, userId: demo.ownerId, modulo: null }, (tx) =>
      tx.query(`select 1 from erp.tipos_operacao_versoes where tipo_operacao_id = $1`, [id]));
    expect(r.rowCount, "a organização B não lê a linha da A").toBe(0);
  });

  it("RLS continua HABILITADA e FORÇADA na tabela de versões", async () => {
    const r = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='erp' and c.relname='tipos_operacao_versoes'`);
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
