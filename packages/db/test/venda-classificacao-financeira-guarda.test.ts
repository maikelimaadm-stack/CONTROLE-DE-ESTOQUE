import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db, type Tx } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";
import type { SalesKind } from "@agro/domain";

/**
 * O QUE A 0024 PROMETEU, PROVADO CONTRA O BANCO (VENDAS-A1).
 *
 * A1-D1 — a classificação do documento só aponta para cadastro da PRÓPRIA organização, e anda em PAR. As duas
 * coisas são do banco, não só da API: uma FK de coluna única provaria que a categoria existe, não que é do
 * tenant do documento; e meio par obrigaria a confirmação a completar a outra metade pela ordem do código.
 *
 * A1-D2 — a GUARDA: venda classificada NUNCA entra em confirmed/invoiced por um binário que ignora a
 * classificação. "Um binário que ignora" é modelado como ele é na vida real: uma transação do papel da
 * aplicação (`erp_app_test`, sem bypass de RLS) que move o status SEM gravar a marca
 * `app.venda_classificacao_financeira` — é o que o binário anterior à VENDAS-A1 faz, porque não sabe que ela
 * existe. E a contraprova, sem a qual o gatilho poderia estar recusando TUDO: venda sem classificação,
 * faturamento de venda já confirmada e cancelamento passam sem marca.
 *
 * A1-D5 — a GUARDA DA CONVERSÃO (seção 7b): documento derivado de origem classificada só nasce classificado.
 * O binário anterior converte montando o derivado campo a campo, SEM o par; o derivado nasceria sem
 * classificação e a guarda da A1-D2 nem dispararia na confirmação dele. A conversão desse binário é modelada
 * como ela é: uma transação do MESMO papel da aplicação que lê e trava a origem, insere o derivado e marca a
 * origem `converted` — de modo que a guarda roda como INVOKER, sob a RLS da própria conversão, que é o que a
 * migration declara. A recusa é conferida pela mensagem EXATA (qualquer outra recusa — RLS, FK, CHECK — seria
 * um verde que não prova a guarda) e o "nada gravado" é CONTADO; ao lado de cada recusa, a mesma conversão
 * corrigida grava, para que a guarda não esteja passando por recusar tudo.
 */
let db: Db; let app: Db; let demo: DemoOrg; let outraOrg: string;
let catOk: string; let ccOk: string; let catVizinha: string; let ccVizinho: string;
beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  // A URL do papel é MONTADA, não trocada por texto: `TEST_URL` traz `postgres:postgres@`, e um replace de
  // "postgres@" viraria `postgres:erp_app_test:erp_app_test@` — o superusuário, que ignora a RLS.
  const urlApp = new URL(TEST_URL); urlApp.username = "erp_app_test"; urlApp.password = "erp_app_test";
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? urlApp.toString(), { max: 3 });
  // A premissa de toda a suíte: quem move o status é o papel da aplicação, não o superusuário.
  expect((await app.query<{ u: string }>("select current_user as u")).rows[0]!.u).toBe("erp_app_test");
  outraOrg = (await db.query<{ id: string }>("insert into erp.organizations(name) values ('[TEST] vizinha A1-D') returning id")).rows[0]!.id;
  const cat = async (org: string, code: string) => (await db.query<{ id: string }>(
    "insert into erp.financial_categories(organization_id,code,name,nature,kind) values ($1,$2,$3,'income','analytic') returning id", [org, code, `Cat ${code}`])).rows[0]!.id;
  const cc = async (org: string, code: string) => (await db.query<{ id: string }>(
    "insert into erp.cost_centers(organization_id,code,name,kind) values ($1,$2,$3,'analytic') returning id", [org, code, `CC ${code}`])).rows[0]!.id;
  catOk = await cat(demo.orgId, "9.D.1"); ccOk = await cc(demo.orgId, "9.D.1");
  catVizinha = await cat(outraOrg, "9.D.1"); ccVizinho = await cc(outraOrg, "9.D.1");
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

let seq = 0;
type Par = { cat: string | null; cc: string | null };
/**
 * Documento aberto inserido direto (como o superusuário de migração monta cenário). Venda por padrão; a A1-D5
 * pede orçamento e pedido, que são as origens que a conversão aceita.
 */
async function venda(par: Par = { cat: null, cc: null }, kind: SalesKind = "sale"): Promise<string> {
  seq += 1;
  const empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  const cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client limit 1", [demo.orgId])).rows[0]!.id;
  return (await db.query<{ id: string }>(
    `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, categoria_financeira_id, centro_custo_id)
     values ($1,$2,$3,$4,'2026-09-01',$5,$6,$7) returning id`,
    [demo.orgId, empresa, kind, `A1D-${seq}`, cliente, par.cat, par.cc])).rows[0]!.id;
}
const classificada = () => venda({ cat: catOk, cc: ccOk });

/** Move o status como o PAPEL DA APLICAÇÃO move, com ou sem a marca da classificação. */
async function moverComoApp(id: string, status: string, marca: string | null): Promise<void> {
  await withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "vendas" }, async (tx) => {
    if (marca !== null) await tx.query("select set_config('app.venda_classificacao_financeira', $1, true)", [marca]);
    const u = await tx.query("update erp.sales_documents set status=$3 where id=$1 and organization_id=$2", [id, demo.orgId, status]);
    // A premissa: a linha é visível e atualizável para o papel. Sem isto, "passou" poderia ser zero linha.
    expect(u.rowCount, "a venda precisa ser visível para o papel da aplicação").toBe(1);
  });
}
const statusDe = async (id: string) => (await db.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!.status;

describe("A1-D1 — FK composta com o tenant e CHECK do par", () => {
  it("A1-D1 premissa: o par da PRÓPRIA organização grava, no insert e no update", async () => {
    const id = await classificada();
    const sem = await venda();
    expect((await db.query("update erp.sales_documents set categoria_financeira_id=$2, centro_custo_id=$3 where id=$1", [sem, catOk, ccOk])).rowCount).toBe(1);
    expect(id).toEqual(expect.any(String));
  });

  it("A1-D1 categoria de OUTRA organização → violação da FK composta (insert e update)", async () => {
    await expect(venda({ cat: catVizinha, cc: ccOk })).rejects.toThrow(/fk_sales_documents_categoria_financeira/);
    const id = await classificada();
    await expect(db.query("update erp.sales_documents set categoria_financeira_id=$2 where id=$1", [id, catVizinha])).rejects.toThrow(/fk_sales_documents_categoria_financeira/);
  });

  it("A1-D1 centro de OUTRA organização → violação da FK composta (insert e update)", async () => {
    await expect(venda({ cat: catOk, cc: ccVizinho })).rejects.toThrow(/fk_sales_documents_centro_custo/);
    const id = await classificada();
    await expect(db.query("update erp.sales_documents set centro_custo_id=$2 where id=$1", [id, ccVizinho])).rejects.toThrow(/fk_sales_documents_centro_custo/);
  });

  it("A1-D1 par incompleto direto → violação do CHECK (insert com um só; update que zera um só)", async () => {
    await expect(venda({ cat: catOk, cc: null })).rejects.toThrow(/sales_documents_classificacao_par/);
    await expect(venda({ cat: null, cc: ccOk })).rejects.toThrow(/sales_documents_classificacao_par/);
    const id = await classificada();
    await expect(db.query("update erp.sales_documents set centro_custo_id=null where id=$1", [id])).rejects.toThrow(/sales_documents_classificacao_par/);
  });
});

describe("A1-D2 — a guarda: venda classificada só entra em confirmed/invoiced com a marca DELA", () => {
  it("A1-D2 o gatilho existe, está ligado, só no UPDATE de status; a função tem search_path fixo", async () => {
    const t = await db.query<{ tgenabled: string; def: string }>(
      `select t.tgenabled, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid=t.tgrelid
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='erp' and c.relname='sales_documents' and t.tgname='trg_sales_documents_classificacao_financeira'`);
    expect(t.rowCount).toBe(1);
    expect(t.rows[0]!.tgenabled).toBe("O");
    expect(t.rows[0]!.def).toContain("BEFORE UPDATE OF status");
    const f = await db.query<{ proconfig: string[] | null; prosecdef: boolean }>("select proconfig, prosecdef from pg_proc where proname='venda_classificacao_financeira_guarda'");
    expect(f.rows[0]!.prosecdef).toBe(false);
    expect(f.rows[0]!.proconfig?.join(",")).toContain("search_path");
  });

  it("A1-D2 classificada entrando em confirmed SEM a marca → recusa com código que o binário anterior mapeia; status intacto", async () => {
    const id = await classificada();
    await expect(moverComoApp(id, "confirmed", null)).rejects.toThrow(/^VALIDATION_ERROR: /);
    expect(await statusDe(id)).toBe("open");
  });

  it("A1-D2 aberta → faturada DIRETO sem a marca também é recusada", async () => {
    const id = await classificada();
    await expect(moverComoApp(id, "invoiced", null)).rejects.toThrow(/^VALIDATION_ERROR: /);
    expect(await statusDe(id)).toBe("open");
  });

  it("A1-D2 a marca de OUTRA venda não serve: ela é amarrada ao id", async () => {
    const outra = await classificada();
    const id = await classificada();
    await expect(moverComoApp(id, "confirmed", outra)).rejects.toThrow(/^VALIDATION_ERROR: /);
    expect(await statusDe(id)).toBe("open");
  });

  it("A1-D2 com a marca DESTA venda, passa — é o caminho do binário da VENDAS-A1", async () => {
    const id = await classificada();
    await moverComoApp(id, "confirmed", id);
    expect(await statusDe(id)).toBe("confirmed");
  });

  it("A1-D2 contraprova: venda SEM classificação confirma sem marca nenhuma", async () => {
    const id = await venda();
    await moverComoApp(id, "confirmed", null);
    expect(await statusDe(id)).toBe("confirmed");
  });

  it("A1-D2 confirmed → invoiced e o cancelamento passam sem a marca (só a ENTRADA é guardada)", async () => {
    const id = await classificada();
    await moverComoApp(id, "confirmed", id);
    await moverComoApp(id, "invoiced", null);
    expect(await statusDe(id)).toBe("invoiced");
    await moverComoApp(id, "cancelled", null);
    expect(await statusDe(id)).toBe("cancelled");
    // Cancelar uma venda classificada ainda ABERTA também passa.
    const aberta = await classificada();
    await moverComoApp(aberta, "cancelled", null);
    expect(await statusDe(aberta)).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------------------------------------
// A1-D5 — a guarda da conversão (seção 7b da 0024)
// ---------------------------------------------------------------------------------------------------------

/** A mensagem EXATA da guarda. Comparada inteira: um trecho casaria também com a guarda da A1-D2. */
const RECUSA_CONVERSAO = "VALIDATION_ERROR: o documento de origem tem classificacao financeira, que este servidor nao copia; a conversao nao foi feita";
const SEM_PAR: Par = { cat: null, cc: null };
const contexto = () => ({ orgId: demo.orgId, userId: demo.adminUserId, modulo: "vendas" });

/** INSERT de documento como o PAPEL DA APLICAÇÃO grava — com ou sem origem, com ou sem o par. */
async function inserirComoApp(tx: Tx, doc: { kind: SalesKind; empresa: string; cliente: string; origem: string | null; par: Par }): Promise<string> {
  seq += 1;
  return (await tx.query<{ id: string }>(
    `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, origin_document_id, categoria_financeira_id, centro_custo_id)
     values ($1,$2,$3,$4,'2026-09-02',$5,$6,$7,$8) returning id`,
    [demo.orgId, doc.empresa, doc.kind, `A1D-${seq}`, doc.cliente, doc.origem, doc.par.cat, doc.par.cc])).rows[0]!.id;
}

/**
 * Converte como o binário da API converte, NA MESMA ORDEM de `POST /:kind/:id/convert`: lê e trava a origem,
 * insere o derivado (`writeDoc` com `origin`) e só DEPOIS marca a origem `converted`. `par` é o que o binário
 * põe no derivado: o anterior não conhece o par e grava sempre `SEM_PAR`; o da VENDAS-A1 copia o da origem.
 */
async function converterComoApp(origem: string, destino: SalesKind, par: Par): Promise<string> {
  return withTx(app, contexto(), async (tx) => {
    const src = await tx.query<{ empresa_id: string; client_id: string }>(
      "select empresa_id, client_id from erp.sales_documents where id=$1 and organization_id=$2 for update", [origem, demo.orgId]);
    // A premissa: a origem é visível para o papel. É a MESMA visibilidade que a guarda, invoker, vai ter.
    expect(src.rowCount, "a origem precisa ser visível para o papel da aplicação").toBe(1);
    const id = await inserirComoApp(tx, { kind: destino, empresa: src.rows[0]!.empresa_id, cliente: src.rows[0]!.client_id, origem, par });
    const u = await tx.query("update erp.sales_documents set status='converted', updated_at=now() where id=$1 and organization_id=$2", [origem, demo.orgId]);
    expect(u.rowCount, "a origem precisa ser atualizável pelo papel da aplicação").toBe(1);
    return id;
  });
}

/** O erro que a promessa rejeitou. Resolver é falha do teste: a recusa era o esperado. */
async function recusaDe(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; message: string }; }
  throw new Error("esperava a recusa da guarda da conversão, e a gravação passou");
}

/** O que a conversão pode ter gravado: derivados da origem, documentos e auditoria da organização, status da origem. */
async function efeitos(origem: string) {
  return (await db.query<{ derivados: number; docs: number; auditoria: number; status: string }>(
    `select (select count(*) from erp.sales_documents where origin_document_id=$1)::int as derivados,
            (select count(*) from erp.sales_documents where organization_id=$2)::int as docs,
            (select count(*) from erp.audit_logs where organization_id=$2 and entity='sales_documents')::int as auditoria,
            (select status from erp.sales_documents where id=$1) as status`, [origem, demo.orgId])).rows[0]!;
}
const parDe = async (id: string) => (await db.query<{ cat: string | null; cc: string | null; origem: string | null }>(
  "select categoria_financeira_id as cat, centro_custo_id as cc, origin_document_id as origem from erp.sales_documents where id=$1", [id])).rows[0]!;

describe("A1-D5 — a guarda da conversão: derivado de origem classificada só nasce classificado", () => {
  it("A1-D5 (e) o gatilho existe, está ligado, é BEFORE INSERT e só; a função é invoker, com search_path fixo", async () => {
    const t = await db.query<{ tgenabled: string; def: string }>(
      `select t.tgenabled, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid=t.tgrelid
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='erp' and c.relname='sales_documents' and t.tgname='trg_sales_documents_classificacao_conversao' and not t.tgisinternal`);
    expect(t.rowCount).toBe(1);
    expect(t.rows[0]!.tgenabled).toBe("O");
    const def = t.rows[0]!.def;
    expect(def).toContain("BEFORE INSERT ON erp.sales_documents FOR EACH ROW");
    // SÓ o INSERT: um `or update` faria toda edição de derivado antigo passar pela guarda (ver o caso f).
    expect(def).not.toMatch(/UPDATE|DELETE|TRUNCATE/);
    // A cláusula `when` é o filtro barato: só derivado SEM classificação chega a executar a função.
    expect(def).toContain("WHEN (((new.origin_document_id IS NOT NULL) AND (new.categoria_financeira_id IS NULL)))");
    expect(def).toContain("EXECUTE FUNCTION erp.venda_classificacao_financeira_conversao_guarda()");

    const f = await db.query<{ proconfig: string[] | null; prosecdef: boolean; lang: string; src: string; publico: boolean }>(
      `select p.proconfig, p.prosecdef, l.lanname as lang, p.prosrc as src,
              (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as publico
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
        where n.nspname='erp' and p.proname='venda_classificacao_financeira_conversao_guarda'`);
    expect(f.rowCount).toBe(1);
    // INVOKER: a leitura da origem roda sob a RLS da própria conversão. Um DEFINER leria o que a RLS esconde.
    expect(f.rows[0]!.prosecdef).toBe(false);
    expect(f.rows[0]!.proconfig).toEqual(["search_path=pg_catalog, erp"]);
    expect(f.rows[0]!.lang).toBe("plpgsql");
    // Sem SQL dinâmico: nenhum `execute` no corpo.
    expect(f.rows[0]!.src).not.toMatch(/\bexecute\b/i);
    // `revoke all ... from public`: acl nula seria o padrão, que dá EXECUTE a todos.
    expect(f.rows[0]!.publico).toBe(false);
  });

  for (const [origemKind, destino] of [["budget", "order"], ["order", "sale"]] as const) {
    it(`A1-D5 (a) ${origemKind} classificado → ${destino} SEM o par (binário anterior) → recusa exata, NADA gravado; premissa: o mesmo com o par grava`, async () => {
      const origem = await venda({ cat: catOk, cc: ccOk }, origemKind);
      const antes = await efeitos(origem);
      expect(antes).toMatchObject({ derivados: 0, status: "open" });

      const e = await recusaDe(converterComoApp(origem, destino, SEM_PAR));
      expect(e.message).toBe(RECUSA_CONVERSAO);
      // P0001 → VALIDATION_ERROR → 422: o mapeamento que QUALQUER binário anterior já faz em `fromPgError`.
      expect(e.code).toBe("P0001");
      // Nada gravado, contado: nenhum derivado, nenhum documento, nenhuma auditoria, origem ainda aberta.
      expect(await efeitos(origem)).toEqual(antes);

      // PREMISSA ao lado: a MESMA origem, pela MESMA conversão, agora com o par da origem (o que o binário da
      // VENDAS-A1 faz) grava. Sem isto, o "nada gravado" acima poderia ser RLS, FK ou CHECK recusando tudo —
      // e também prova que a recusa deixou a origem inteira para ser convertida depois.
      const derivado = await converterComoApp(origem, destino, { cat: catOk, cc: ccOk });
      const depois = await efeitos(origem);
      expect(depois.derivados).toBe(1);
      expect(depois.docs).toBe(antes.docs + 1);
      expect(depois.auditoria).toBeGreaterThan(antes.auditoria);
      expect(depois.status).toBe("converted");
      expect(await parDe(derivado)).toEqual({ cat: catOk, cc: ccOk, origem });
    });
  }

  it("A1-D5 (b) derivado CLASSIFICADO de origem classificada grava (o caminho do binário da VENDAS-A1)", async () => {
    const origem = await venda({ cat: catOk, cc: ccOk }, "order");
    const antes = await efeitos(origem);
    const derivado = await converterComoApp(origem, "sale", { cat: catOk, cc: ccOk });
    const depois = await efeitos(origem);
    expect(depois.derivados).toBe(1);
    expect(depois.docs).toBe(antes.docs + 1);
    expect(depois.status).toBe("converted");
    expect(await parDe(derivado)).toEqual({ cat: catOk, cc: ccOk, origem });
  });

  it("A1-D5 (c) derivado sem classificação de origem SEM classificação grava (o binário anterior segue convertendo o acervo)", async () => {
    for (const [origemKind, destino] of [["budget", "order"], ["order", "sale"]] as const) {
      const origem = await venda(SEM_PAR, origemKind);
      const antes = await efeitos(origem);
      const derivado = await converterComoApp(origem, destino, SEM_PAR);
      const depois = await efeitos(origem);
      expect(depois.derivados, `${origemKind} → ${destino}`).toBe(1);
      expect(depois.docs).toBe(antes.docs + 1);
      expect(depois.status).toBe("converted");
      expect(await parDe(derivado)).toEqual({ cat: null, cc: null, origem });
    }
  });

  it("A1-D5 (d) documento SEM origem e sem classificação grava (a criação comum não passa pela guarda)", async () => {
    const empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
    const cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client limit 1", [demo.orgId])).rows[0]!.id;
    for (const kind of ["budget", "order", "sale"] as const) {
      const id = await withTx(app, contexto(), (tx) => inserirComoApp(tx, { kind, empresa, cliente, origem: null, par: SEM_PAR }));
      expect(await parDe(id), kind).toEqual({ cat: null, cc: null, origem: null });
    }
  });

  it("A1-D5 (f) UPDATE de derivado existente NÃO dispara a guarda (é só INSERT); premissa: o INSERT no mesmo estado é recusado", async () => {
    // O estado que só o UPDATE pode encontrar: derivado sem classificação cuja origem, DEPOIS, ficou
    // classificada. É o acervo de antes da 0024 — derivados que já existiam quando a guarda nasceu.
    const origem = await venda(SEM_PAR, "budget");
    const derivado = await converterComoApp(origem, "order", SEM_PAR);
    expect((await db.query("update erp.sales_documents set categoria_financeira_id=$2, centro_custo_id=$3 where id=$1", [origem, catOk, ccOk])).rowCount).toBe(1);
    const src = (await db.query<{ empresa_id: string; client_id: string }>("select empresa_id, client_id from erp.sales_documents where id=$1", [origem])).rows[0]!;

    // PREMISSA: nesse mesmo estado, um INSERT de derivado sem o par É recusado — então o estado é o que a
    // guarda recusaria, e o UPDATE abaixo passar prova a fronteira do gatilho, não um estado inofensivo.
    const antes = await efeitos(origem);
    const e = await recusaDe(withTx(app, contexto(), (tx) =>
      inserirComoApp(tx, { kind: "order", empresa: src.empresa_id, cliente: src.client_id, origem, par: SEM_PAR })));
    expect(e.message).toBe(RECUSA_CONVERSAO);
    expect(await efeitos(origem)).toEqual(antes);

    // O UPDATE regrava inclusive a coluna da cláusula `when` (`origin_document_id`), como o papel da aplicação.
    await withTx(app, contexto(), async (tx) => {
      const u = await tx.query(
        "update erp.sales_documents set note='editado A1-D5', origin_document_id=origin_document_id, updated_at=now() where id=$1 and organization_id=$2",
        [derivado, demo.orgId]);
      expect(u.rowCount, "o derivado precisa ser visível e atualizável para o papel da aplicação").toBe(1);
    });
    const r = (await db.query<{ note: string | null }>("select note from erp.sales_documents where id=$1", [derivado])).rows[0]!;
    expect(r.note).toBe("editado A1-D5");
    expect(await parDe(derivado)).toEqual({ cat: null, cc: null, origem });
  });
});
