import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";
import {
  executarBackfill, verificar, organizacoes, resolverUrlOperacional,
  inspecionarPapel, papelAtravessaRls, validarPapelOperacional
} from "../../src/cli/id-global-backfill.js";

/**
 * A CONEXÃO DO COMANDO OPERACIONAL (PRE-BASE2-04 — correção de certificação).
 *
 * O algoritmo do backfill estava certo; o ENTRYPOINT não. Ele lia `DATABASE_URL` — a conexão da API, que
 * conecta como `erp_app` SEM bypass de RLS — e percorria todas as organizações sem contexto de tenant.
 * `erp.organizations` tem RLS: por essa conexão, `select id from erp.organizations` sem `app.org_id`
 * devolve ZERO LINHAS.
 *
 * E o perigo não é o erro, é a ausência dele: zero organizações vira zero pendentes, zero atribuídos e
 * "invariantes OK" — com o acervo histórico inteiro sem número do outro lado da política. É um CERTIFICADO
 * FALSO, e ninguém volta para conferir um verde.
 *
 * Estes testes provam o risco com o banco na mão (não por leitura de código), provam as duas barreiras novas
 * (papel e zero organizações) e provam que o caminho legítimo continua funcionando igual.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db; let app: Db;
const APP_URL = process.env.TEST_DATABASE_URL_APP ?? "postgresql://erp_app_test:erp_app_test@127.0.0.1:5433/agro_erp_test";

/** Acervo HISTÓRICO: linhas inseridas direto na tabela, como se tivessem nascido antes desta rodada. */
async function historico(n: number): Promise<void> {
  const esp = (await admin.query<{ species_id: string }>("select species_id from erp.animals limit 1")).rows[0]!.species_id;
  const cat = (await admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]!.id;
  for (let i = 0; i < n; i++) {
    await admin.query(
      "insert into erp.animals(organization_id,empresa_id,species_id,category_id,sex,status,entry_date,created_at) values ($1,$2,$3,$4,'M','active',current_date, now() - ($5 || ' days')::interval)",
      [h.demo.orgId, I.farm, esp, cat, String(200 - i)]);
  }
}
const elegiveisSemNumero = async (): Promise<number> => Number((await admin.query<{ n: string }>(
  `select count(*)::text n from erp.animals t where t.organization_id=$1 and t.deleted_at is null
     and not exists (select 1 from erp.registros_globais g where g.organization_id=t.organization_id and g.tipo_entidade='animals' and g.id_entidade=t.id)`,
  [h.demo.orgId])).rows[0]!.n);

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  admin = createPool(TEST_URL, { max: 2 });
  app = createPool(APP_URL, { max: 2 });
  await historico(8);
}, 240_000);
afterAll(async () => { await app.end(); await admin.end(); await h.app.close(); await h.db.end(); });

describe("reprodução do falso verde (o estado que o HEAD anterior podia certificar)", () => {
  it("o acervo real NÃO está vazio: há organização e há elegível sem número", async () => {
    const orgs = Number((await admin.query<{ n: string }>("select count(*)::text n from erp.organizations")).rows[0]!.n);
    expect(orgs, "o banco do teste precisa ter acervo, senão o teste não prova nada").toBeGreaterThan(0);
    expect(await elegiveisSemNumero(), "e precisa haver trabalho pendente de verdade").toBeGreaterThan(0);
  });

  it("pela conexão da API o backfill conclui SEM FAZER NADA e sem reclamar", async () => {
    // MEDIDO, não suposto — e o mecanismo é pior do que "não enxerga a organização":
    // `erp.organizations` tem uma política `api_child ... using (true)` para erp_app, então a LISTA de
    // organizações aparece normalmente. O que some são as LINHAS das 23 tabelas: `tenant_isolation` usa
    // `erp.tenant_visible(organization_id)`, que sem `app.org_id` e sem usuário é falso para todas.
    // Resultado: organizações > 0 (parece saudável), pendentes 0, atribuídos 0.
    const pendentesReais = await elegiveisSemNumero();
    const r = await executarBackfill(app, { batchSize: 50, org: null, dryRun: false, verifyOnly: false });
    expect(r.organizacoes, "a organização é listada — o buraco não está aqui").toBeGreaterThan(0);
    expect(r.atribuidos, "nada foi numerado").toBe(0);
    expect(r.faltando, "e o comando ainda assim diz que não falta nada").toBe(0);
    expect(await elegiveisSemNumero(), "enquanto o acervo continua sem número").toBe(pendentesReais);
  });

  it("e o verify pela mesma conexão declararia INVARIANTES OK sobre um acervo não numerado", async () => {
    const pendentesReais = await elegiveisSemNumero();
    expect(pendentesReais).toBeGreaterThan(0);
    const v = await verificar(app);
    expect(v.problemas, "esse verde é o certificado falso que esta correção existe para impedir").toEqual([]);
    expect(v.faltando).toBe(0);
    expect(v.registrosGlobais, "nem os índices que existem são visíveis por essa conexão").toBe(0);
  });

  it("o papel da API não atravessa a RLS — é a causa raiz, e o preflight a nomeia", async () => {
    const papel = await inspecionarPapel(app);
    expect(papelAtravessaRls(papel)).toBe(false);
    expect(papel.superusuario).toBe(false);
    expect(papel.bypassRls).toBe(false);
  });
});

describe("barreira 1 — o papel da conexão, recusado ANTES de contar qualquer coisa", () => {
  it("erp_app é recusado", async () => {
    await expect(validarPapelOperacional(app)).rejects.toThrow(/não tem rolsuper nem rolbypassrls/);
  });

  it("a recusa cita o papel (identificador) e nenhuma credencial", async () => {
    const erro = String(await validarPapelOperacional(app).catch((e: Error) => e.message));
    expect(erro).toContain("erp_app_test");
    for (const segredo of ["postgresql://", "5433", ":erp_app_test@", "password", "senha"]) {
      expect(erro.toLowerCase()).not.toContain(segredo.toLowerCase());
    }
  });

  it("o papel operacional (superusuário ou bypassrls) passa", async () => {
    const papel = await validarPapelOperacional(admin);
    expect(papelAtravessaRls(papel)).toBe(true);
  });
});

describe("barreira 2 — zero organizações não certifica nada (defesa em profundidade)", () => {
  /** Conexão que devolve lista vazia: é o outro caminho pelo qual um verde vazio poderia nascer. */
  const bancoVazio = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Db;

  it("a descoberta FALHA em vez de devolver lista vazia", async () => {
    await expect(organizacoes(bancoVazio)).rejects.toThrow(/nenhuma organização visível/);
  });

  it("e por isso o verify não chega a dizer 'invariantes OK'", async () => {
    await expect(verificar(bancoVazio)).rejects.toThrow(/nenhuma organização visível/);
  });

  it("o backfill para pelo mesmo motivo", async () => {
    await expect(executarBackfill(bancoVazio, { batchSize: 10, org: null, dryRun: true, verifyOnly: false }))
      .rejects.toThrow(/nenhuma organização visível/);
  });
});

describe("barreira 3 — --org é PROVADO, não aceito de palavra", () => {
  it("UUID válido que não existe falha", async () => {
    await expect(organizacoes(admin, "00000000-0000-4000-8000-000000000001")).rejects.toThrow(/organização não encontrada/);
  });

  it("UUID inválido falha de forma controlada, sem mensagem do PostgreSQL", async () => {
    const erro = await organizacoes(admin, "nao-e-uuid").catch((e: Error) => e.message);
    expect(String(erro)).toMatch(/--org inválido/);
    expect(String(erro).toLowerCase()).not.toContain("invalid input syntax");
    expect(String(erro).toLowerCase()).not.toContain("uuid_in");
  });

  it("organização existente continua sendo aceita", async () => {
    expect(await organizacoes(admin, h.demo.orgId)).toEqual([h.demo.orgId]);
  });
});

describe("caminho legítimo — conexão operacional", () => {
  it("dry-run vê pendentes, backfill atribui e verify certifica com NÚMEROS", async () => {
    const pendentesAntes = await elegiveisSemNumero();
    expect(pendentesAntes).toBeGreaterThan(0);

    const seco = await executarBackfill(admin, { batchSize: 50, org: h.demo.orgId, dryRun: true, verifyOnly: false });
    expect(seco.organizacoes).toBe(1);
    expect(seco.faltando).toBeGreaterThan(0);
    expect(await elegiveisSemNumero(), "--dry-run não grava").toBe(pendentesAntes);

    const real = await executarBackfill(admin, { batchSize: 50, org: h.demo.orgId, dryRun: false, verifyOnly: false });
    expect(real.atribuidos).toBeGreaterThan(0);
    expect(real.faltando).toBe(0);
    expect(await elegiveisSemNumero()).toBe(0);

    const v = await verificar(admin, h.demo.orgId);
    expect(v.problemas).toEqual([]);
    expect(v.organizacoes, "o resumo precisa dizer quantas organizações foram percorridas").toBe(1);
    expect(v.entidades).toBe(23);
    expect(v.registrosGlobais).toBeGreaterThan(0);
    expect(v.faltando).toBe(0);
  }, 120_000);

  it("sem --org, a varredura completa encontra as organizações do banco", async () => {
    const v = await verificar(admin);
    expect(v.organizacoes).toBeGreaterThan(0);
  }, 120_000);
});

describe("variável de ambiente do comando", () => {
  it("usa ID_GLOBAL_DATABASE_URL ou MIGRATE_DATABASE_URL", () => {
    expect(resolverUrlOperacional({ MIGRATE_DATABASE_URL: "postgres://operacao" })).toBe("postgres://operacao");
    expect(resolverUrlOperacional({ ID_GLOBAL_DATABASE_URL: "postgres://dedicada", MIGRATE_DATABASE_URL: "postgres://operacao" })).toBe("postgres://dedicada");
  });

  it("NÃO cai para DATABASE_URL: é esse fallback que reconstrói o falso verde", () => {
    expect(() => resolverUrlOperacional({ DATABASE_URL: "postgres://api" })).toThrow(/MIGRATE_DATABASE_URL não definida/);
  });

  it("a mensagem de erro não contém o valor de variável nenhuma", () => {
    const erro = (() => { try { resolverUrlOperacional({ DATABASE_URL: "postgresql://u:senha@h/db" }); return ""; } catch (e) { return (e as Error).message; } })();
    expect(erro).not.toContain("senha");
    expect(erro).not.toContain("postgresql://");
  });
});
