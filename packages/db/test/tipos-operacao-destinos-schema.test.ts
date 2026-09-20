import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O GRAFO DE PRÓXIMAS OPERAÇÕES, PROVADO CONTRA O BANCO (0022).
 *
 * A promessa central desta tabela não é "guardar pares de ids": é tornar IMPOSSÍVEL o estado que uma lista
 * de UUIDs dentro do JSON deixaria passar — aresta para TOP de outro tenant, aresta para versão que não é
 * da TOP de origem, aresta órfã, política de versão já emitida reescrita depois.
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

/** Cria uma TOP com a versão 1 e devolve os dois ids que o grafo precisa: o da TOP e o da VERSÃO. */
async function criarTop(codigo: string, base: string, orgId = demo.orgId): Promise<{ id: string; versaoId: string }> {
  return withTx(db, { orgId, userId: demo.adminUserId, modulo: null }, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao (organization_id, codigo, codigo_base, criado_por)
       values ($1,$2,$3,$4) returning id`, [orgId, codigo, base, demo.adminUserId]);
    const id = r.rows[0]!.id;
    const v = await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, criado_por)
       values ($1,$2,1,$3,$4) returning id`, [orgId, id, `Nome de ${codigo}`, demo.adminUserId]);
    return { id, versaoId: v.rows[0]!.id };
  });
}

async function aresta(origemVersaoId: string, origemId: string, destinoId: string, ordem = 0, orgId = demo.orgId) {
  return db.query(
    `insert into erp.tipos_operacao_versao_destinos
       (organization_id, origem_versao_id, origem_tipo_operacao_id, destino_tipo_operacao_id, ordem, criado_por)
     values ($1,$2,$3,$4,$5,$6)`,
    [orgId, origemVersaoId, origemId, destinoId, ordem, demo.adminUserId]);
}

let seq = 0;
const codigo = () => `D${String(++seq).padStart(3, "0")}`;

describe("0022 — o grafo existe e tem integridade", () => {
  it("a tabela existe com RLS habilitada E forçada, e com UMA única política", async () => {
    const rls = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='erp' and c.relname='tipos_operacao_versao_destinos'`);
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    // Política ÚNICA: PERMISSIVE combinam com OR, e duas conviventes valeriam sempre pela mais frouxa.
    const pol = await db.query(`select 1 from pg_policies where schemaname='erp' and tablename='tipos_operacao_versao_destinos'`);
    expect(pol.rowCount, "exatamente uma política de RLS").toBe(1);
  });

  it("uma aresta legítima é aceita — a PREMISSA de todas as recusas abaixo", async () => {
    // Sem esta prova, "o banco recusa tudo" passaria igual e os testes de recusa não provariam nada.
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await expect(aresta(o.versaoId, o.id, d.id)).resolves.toBeTruthy();
    const r = await db.query(`select 1 from erp.tipos_operacao_versao_destinos where origem_versao_id=$1`, [o.versaoId]);
    expect(r.rowCount).toBe(1);
  });

  it("a FK da ORIGEM prova PARENTESCO: a versão precisa ser DAQUELA TOP", async () => {
    const a = await criarTop(codigo(), "vendas.orcamento");
    const b = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    // A versão é da TOP `a`, mas a aresta afirma que a origem é a TOP `b`. Sem a FK COMPOSTA isso passaria,
    // e o leque de `b` passaria a ser lido a partir da política de `a`.
    await expect(aresta(a.versaoId, b.id, d.id)).rejects.toThrow(/fk_tipos_operacao_versao_destinos_origem/);
  });

  it("a FK do DESTINO prova TENANT: não existe aresta para TOP de outra organização", async () => {
    const outra = "00000000-0000-4000-8000-0000000000c0";
    await db.query(`insert into erp.organizations(id,name,legal_name,document,slug) values ($1,'[TEST] Org grafo','[TEST] Org grafo Ltda','00000000000272','orggrafo') on conflict (id) do nothing`, [outra]);
    const o = await criarTop(codigo(), "vendas.orcamento");
    const estrangeira = await criarTop(codigo(), "vendas.pedido", outra);
    // Coluna única não prova tenant: é a chave COMPOSTA (destino, organização) que recusa.
    await expect(aresta(o.versaoId, o.id, estrangeira.id))
      .rejects.toThrow(/fk_tipos_operacao_versao_destinos_destino/);
  });

  it("o mesmo destino não entra duas vezes na mesma versão", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id, 0);
    // Duplicar não acrescenta política nenhuma e faria a tela oferecer a mesma opção duas vezes.
    await expect(aresta(o.versaoId, o.id, d.id, 1)).rejects.toThrow(/uq_tipos_operacao_versao_destinos/);
  });

  it("laço sobre a PRÓPRIA TOP é recusado pelo banco", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    // "Deste pedido gere outro pedido desta mesma TOP" não descreve operação de negócio nenhuma.
    await expect(aresta(o.versaoId, o.id, o.id)).rejects.toThrow(/ck_tipos_operacao_versao_destinos_sem_laco/);
  });

  it("ciclo entre TOPs DIFERENTES não é barrado — e isso é deliberado", async () => {
    const a = await criarTop(codigo(), "vendas.pedido");
    const b = await criarTop(codigo(), "vendas.venda");
    await aresta(a.versaoId, a.id, b.id);
    // A → B e B → A. Uma devolução que gera reentrada é um ciclo legítimo; barrar a FORMA do grafo
    // proibiria casos reais. Quem limita é a compatibilidade de família, na borda.
    await expect(aresta(b.versaoId, b.id, a.id)).resolves.toBeTruthy();
  });
});

describe("0022 — a aresta é tão imutável quanto a versão que a ancora", () => {
  it("UPDATE é recusado pelo gatilho", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id);
    // Editar a política de uma versão JÁ EMITIDA reescreveria a explicação de conversões que já aconteceram.
    await expect(db.query(`update erp.tipos_operacao_versao_destinos set ordem=9 where origem_versao_id=$1`, [o.versaoId]))
      .rejects.toThrow(/TIPO_OPERACAO_DESTINO_IMUTAVEL/);
  });

  it("DELETE é recusado pelo gatilho", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id);
    await expect(db.query(`delete from erp.tipos_operacao_versao_destinos where origem_versao_id=$1`, [o.versaoId]))
      .rejects.toThrow(/TIPO_OPERACAO_DESTINO_IMUTAVEL/);
  });

  it("a aplicação NÃO tem UPDATE nem DELETE nesta tabela", async () => {
    // O `grant` sozinho não bastaria: os default privileges da 0007 já concedem os quatro privilégios a
    // toda tabela nova do schema. O que prova a revogação explícita é esta consulta.
    const r = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema='erp' and table_name='tipos_operacao_versao_destinos' and grantee='erp_app'
          and privilege_type in ('UPDATE','DELETE')`);
    expect(r.rows).toEqual([]);
  });

  it("excluir a TOP de destino é LÓGICO e a aresta histórica permanece legível", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id);
    await db.query(`update erp.tipos_operacao set excluido_em=now() where id=$1`, [d.id]);
    // A política continua registrando que aquele caminho existiu — é isso que faz uma conversão já
    // realizada continuar explicável. Quem some é a OFERTA, e isso é filtro de leitura, não exclusão.
    const r = await db.query(`select 1 from erp.tipos_operacao_versao_destinos where origem_versao_id=$1`, [o.versaoId]);
    expect(r.rowCount, "a aresta não é apagada pela exclusão lógica do destino").toBe(1);
  });

  it("DELETE FÍSICO da TOP de destino é TRAVADO pela FK — sem cascata", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id);
    // `on delete cascade` apagaria em silêncio a política que explica por que um documento pôde virar outro.
    await expect(db.query(`delete from erp.tipos_operacao where id=$1`, [d.id])).rejects.toThrow();
  });
});

describe("0022 — isolamento por tenant do grafo", () => {
  it("ISOLAMENTO sob RLS: a organização B não lê a aresta da A pelo papel da aplicação", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id);

    const outraOrg = "00000000-0000-4000-8000-0000000000b0";
    const r = await withTx(app, { orgId: outraOrg, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query(`select 1 from erp.tipos_operacao_versao_destinos where origem_versao_id = $1`, [o.versaoId]));
    expect(r.rowCount, "a organização B não lê a aresta da A").toBe(0);

    // A PREMISSA CONTADA: a organização A LÊ a própria aresta. Sem isto, "B não lê" seria verdade de graça
    // se a consulta estivesse simplesmente errada.
    const a = await withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query(`select 1 from erp.tipos_operacao_versao_destinos where origem_versao_id = $1`, [o.versaoId]));
    expect(a.rowCount, "a organização A lê a própria aresta").toBe(1);
  });
});
