import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FAMILIAS_COM_LAYOUT, FAMILIAS_COM_LAYOUT_DE_COMPRAS, FAMILIAS_COM_LAYOUT_DE_VENDAS } from "@agro/domain";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0038 (COMPRAS-03, decisão 269), PROVADA CONTRA O BANCO — SOBRE ACERVO, COMO O RUNNER APLICA.
 *
 * O que ela promete:
 *   · `erp.layouts_documento.familia` aceita as duas famílias de compra ao lado das três de venda, e nada além;
 *   · o gatilho "família da TOP = família do layout" da 0032 NÃO muda — e já recusa TOP de compra em layout de venda
 *     (e o inverso), e pedido de compra em layout de compra (e o inverso);
 *   · toda função SECURITY DEFINER de compras (o catálogo inteiro) fixa `search_path = erp, pg_temp` (padrão da 0033/0035),
 *     com pg_temp por último — e continua fazendo o que fazia. (pg_catalog fora da lista é procurado PRIMEIRO.)
 *
 * Banco NOVO esconde a prova: sem layout gravado, "nenhuma linha muda" seria verdade sobre conjunto vazio. Este
 * arquivo sobe o banco até a 0037, grava layouts de VENDA ligados a TOPs pelo caminho de antes e só então aplica a
 * 0038 como o runner aplica (uma transação), provando antes as recusas dela: a trava (2026,72), o lock_timeout de
 * 2s, a função definer de compras que ninguém conhece e a reaplicação.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação — o caminho que a API percorre).
 *
 * No fim, o leitor de schema dos gates (`scripts/lib/schema.mjs`, item 0 g): o CHECK refeito por `alter table` é o
 * que o dicionário de dados publica como "Valores" — a situação e a família como o ÚLTIMO `alter table` as deixou
 * (hoje a 0044, OPERACOES-01 F6a: a situação com 'finalizado', 'escolhido' e 'nao_escolhido', e as seis famílias).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let empresa: string; let fornecedor: string; let produto: string;
interface Top { top: string; versao: string }
const tops: Record<string, Top> = {};
const layoutsDeVenda: Record<string, string> = {};
let fonteDoGatilhoAntes: string;

const ALVO = "0038_layout_do_documento_de_compra.sql";
const CINCO = ["compras.compra", "compras.pedido", "vendas.orcamento", "vendas.pedido", "vendas.venda"];
const SEARCH_PATH_NOVO = ["search_path=erp, pg_temp"];
const DEFINER_DE_COMPRAS = [
  "erp.documentos_compra_conferir_v2()", "erp.documentos_compra_item_origem_guarda()",
  "erp.documentos_compra_itens_documento_aberto()", "erp.documentos_compra_transicao_v2()"
];
/** O catálogo INTEIRO das SECURITY DEFINER de compras — pelo nome ou por lerem as tabelas de compra. */
const SQL_DEFINER_DE_COMPRAS = `
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' fn, p.proconfig cfg, has_function_privilege('erp_app', p.oid, 'execute') app
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'erp' and p.prosecdef
     and (p.proname like 'documentos\\_compra%' or p.prosrc like '%documentos\\_compra%')
   order by 1`;

const ctx = (modulo: string | null = null): TenantContext => ({ orgId: demo.orgId, userId: demo.adminUserId, modulo });
const naApp = <T>(fn: (tx: Tx) => Promise<T>, modulo: string | null = null) => withTx(app, ctx(modulo), fn);

async function aplicar(): Promise<void> {
  const m = listMigrations().find((x) => x.name === ALVO);
  expect(m, `${ALVO} precisa existir`).toBeTruthy();
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(m!.sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [m!.name]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
/** Roda a 0038 numa transação DESFEITA no fim (depois de `antes`), e devolve o erro — ou falha, se ela aplicou. */
async function recusaDa0038(antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const m = listMigrations().find((x) => x.name === ALVO)!;
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(m.sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a 0038 recusar, e ela aplicou");
}
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; constraint?: string; message: string }; }
  throw new Error("esperava recusa, e o banco aceitou");
}

const definicaoDoCheck = async () => (await db.query<{ def: string }>(
  "select pg_get_constraintdef(oid) def from pg_constraint where conrelid='erp.layouts_documento'::regclass and conname='chk_layouts_documento_familia' and contype='c'")).rows.map((r) => r.def);
/** As famílias que o CHECK aceita, lidas do catálogo (os literais do `familia = any (array[...])`). */
const familiasDoCheck = async () => {
  const [def] = await definicaoDoCheck();
  return [...(def ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1]!).sort();
};
const configDasDefiner = async () => (await db.query<{ fn: string; cfg: string[] | null; app: boolean }>(SQL_DEFINER_DE_COMPRAS)).rows;
const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;

let seq = 0;
async function criarTop(codigoBase: string): Promise<Top> {
  seq += 1;
  // TOP e versão na MESMA transação: a FK da versão atual é adiada até o commit.
  return withTx(db, { orgId: demo.orgId, userId: null }, async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id",
      [demo.orgId, `LC${seq}`, codigoBase])).rows[0]!.id;
    const versao = (await tx.query<{ id: string }>("insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,1,$3) returning id",
      [demo.orgId, top, `TOP layout ${codigoBase} ${seq}`])).rows[0]!.id;
    return { top, versao };
  });
}
/** Layout gravado por `q` (superusuário no acervo; papel da aplicação depois da 0038). */
async function layout(q: Queryable, familia: string, o: { padrao?: boolean } = {}): Promise<string> {
  seq += 1;
  return (await q.query<{ id: string }>(
    "insert into erp.layouts_documento (organization_id, code, nome, familia, padrao, estrutura) values ($1,$2,$3,$4,$5,'{}') returning id",
    [demo.orgId, `L${seq}`, `Layout ${familia} ${seq}`, familia, o.padrao ?? false])).rows[0]!.id;
}
const ligar = (q: Queryable, layoutId: string, top: Top) => q.query(
  "insert into erp.layout_documento_tops (organization_id, layout_id, tipo_operacao_id) values ($1,$2,$3)", [demo.orgId, layoutId, top.top]);

/** O que a 0038 NÃO pode tocar, linha a linha. */
async function retrato() {
  return {
    layouts: (await db.query("select id, organization_id, code, nome, familia, padrao, estrutura, is_active, created_at, updated_at, deleted_at from erp.layouts_documento order by id")).rows,
    ligacoes: (await db.query("select tipo_operacao_id, organization_id, layout_id, created_at, created_by from erp.layout_documento_tops order by tipo_operacao_id")).rows
  };
}
let antes: Awaited<ReturnType<typeof retrato>>;

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 5 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0038")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });

  empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  fornecedor = (await db.query<{ id: string }>(
    "insert into erp.people (organization_id, code, name, is_provider) values ($1,'LC-F','[TEST] Fornecedor layout compras',true) returning id", [demo.orgId])).rows[0]!.id;
  produto = (await db.query<{ id: string }>("select id from erp.products where organization_id=$1 and controle_lote='nenhum' order by code limit 1", [demo.orgId])).rows[0]!.id;
  for (const f of [...CINCO].sort()) tops[f] = await criarTop(f);

  // O ACERVO: um layout por família de venda (o de venda.venda é o padrão), cada um ligado à TOP da família.
  for (const f of ["vendas.orcamento", "vendas.pedido", "vendas.venda"]) {
    layoutsDeVenda[f] = await layout(db, f, { padrao: f === "vendas.venda" });
    await ligar(db, layoutsDeVenda[f]!, tops[f]!);
  }
  fonteDoGatilhoAntes = (await db.query<{ src: string }>("select md5(prosrc) src from pg_proc where oid='erp.layout_documento_tops_confere_familia()'::regprocedure")).rows[0]!.src;
  antes = await retrato();
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("0038 — sobre o acervo de layouts de venda, como o runner aplica", () => {
  it("LB1 PREMISSA: sob a 0037 há três layouts de venda ligados; o CHECK da 0032 recusa compra; as definer de compras não têm pg_temp", async () => {
    expect(antes.layouts.length, "sem acervo, 'nenhuma linha muda' seria verdade sobre conjunto vazio").toBe(3);
    expect(antes.ligacoes.length).toBe(3);
    expect(await noLedger()).toBe(false);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations")).rows[0]!.n).toBe(37);
    expect(await familiasDoCheck()).toEqual(["vendas.orcamento", "vendas.pedido", "vendas.venda"]);
    const r = await erroDe(layout(db, "compras.compra"));
    expect([r.code, r.constraint]).toEqual(["23514", "chk_layouts_documento_familia"]);
    expect(await configDasDefiner()).toEqual(DEFINER_DE_COMPRAS.map((fn) => ({ fn, cfg: ["search_path=erp, pg_catalog"], app: false })));
  });

  it("LB2 trava (2026,72) em uso por outra sessão: a 0038 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 72)");
      await expect(aplicar()).rejects.toThrow("COMPRAS-03: outra transacao ja detem a trava desta migration (2026,72). Nada foi aplicado.");
    } finally { await outra.query("select pg_advisory_unlock(2026, 72)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await familiasDoCheck()).toEqual(["vendas.orcamento", "vendas.pedido", "vendas.venda"]);
  });

  it("LB3 lock_timeout 2s: uma leitura aberta em erp.layouts_documento faz a 0038 desistir em ~2s, sem efeito", async () => {
    const leitor = await db.connect();
    try {
      await leitor.query("begin");
      await leitor.query("select 1 from erp.layouts_documento limit 1");      // AccessShare: o ALTER TABLE precisa de AccessExclusive
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await leitor.query("rollback"); leitor.release(); }
    expect(await noLedger()).toBe(false);
    expect(await configDasDefiner()).toEqual(DEFINER_DE_COMPRAS.map((fn) => ({ fn, cfg: ["search_path=erp, pg_catalog"], app: false })));
  });

  it("LB4 schema divergente: uma SECURITY DEFINER de compras que ninguém conhece PARA a 0038 — pelo nome ou por ler as tabelas de compra", async () => {
    const pelo = await recusaDa0038((c) => c.query("create function erp.documentos_compra_desconhecida() returns int language sql security definer set search_path = erp as 'select 1'"));
    expect(pelo).toMatch(/^COMPRAS-03: funcoes SECURITY DEFINER de compras diferentes das quatro esperadas .*erp\.documentos_compra_desconhecida\(\)/);
    const lendo = await recusaDa0038((c) => c.query("create function erp.espia_de_compras() returns bigint language sql security definer set search_path = erp as 'select count(*) from erp.documentos_compra'"));
    expect(lendo).toMatch(/^COMPRAS-03: funcoes SECURITY DEFINER de compras diferentes das quatro esperadas .*erp\.espia_de_compras\(\)/);
    // Contraprova: a função de INVOKER que lê compras não é da conta desta migration (não atravessa a RLS).
    await expect(recusaDa0038((c) => c.query("create function erp.leitura_invoker_de_compras() returns bigint language sql as 'select count(*) from erp.documentos_compra'")))
      .rejects.toThrow("esperava a 0038 recusar, e ela aplicou");
    expect(await noLedger()).toBe(false);
    expect(await familiasDoCheck()).toEqual(["vendas.orcamento", "vendas.pedido", "vendas.venda"]);
  });

  it("LB4b reversas: cada pré-condição quebrada recusa a 0038 com a SUA mensagem, sem efeito", async () => {
    const QUATRO = DEFINER_DE_COMPRAS.join(", ");
    // CHECK diferente do da 0032 (duas famílias de venda, mesmo nome, mesma coluna).
    expect(await recusaDa0038((c) => c.query(`alter table erp.layouts_documento drop constraint chk_layouts_documento_familia,
      add constraint chk_layouts_documento_familia check (familia in ('vendas.pedido','vendas.venda')) not valid`)))
      .toMatch(/^COMPRAS-03: chk_layouts_documento_familia diferente do da 0032 /);
    // A 0037 ausente: falta UMA das funções dela.
    expect(await recusaDa0038((c) => c.query("drop function erp.documentos_compra_item_origem_guarda() cascade")))
      .toBe("COMPRAS-03: funcoes do documento de compra da 0036/0037 ausentes; a 0037 nao esta aplicada ou ha schema divergente.");
    // A 0036 ainda presente: uma das que a 0037 removeu existe de novo.
    expect(await recusaDa0038((c) => c.query("create function erp.documentos_compra_conferir() returns trigger language plpgsql as 'begin return new; end'")))
      .toBe("COMPRAS-03: funcoes da 0036 que a 0037 substituiu ainda existem; a 0037 nao terminou ou ha schema divergente.");
    // O gatilho da família: desligado, apontando para outra função, ou de outro tipo (depois, em vez de antes).
    const GATILHO = /^COMPRAS-03: gatilho trg_layout_documento_tops_familia ausente, desligado, de outro tipo/;
    expect(await recusaDa0038((c) => c.query("alter table erp.layout_documento_tops disable trigger trg_layout_documento_tops_familia"))).toMatch(GATILHO);
    expect(await recusaDa0038(async (c) => {
      await c.query("create function erp.confere_familia_imitacao() returns trigger language plpgsql as 'begin return new; end'");
      await c.query("drop trigger trg_layout_documento_tops_familia on erp.layout_documento_tops");
      await c.query("create trigger trg_layout_documento_tops_familia before insert or update on erp.layout_documento_tops for each row execute function erp.confere_familia_imitacao()");
    })).toMatch(GATILHO);
    expect(await recusaDa0038(async (c) => {
      await c.query("drop trigger trg_layout_documento_tops_familia on erp.layout_documento_tops");
      await c.query("create trigger trg_layout_documento_tops_familia after insert or update on erp.layout_documento_tops for each row execute function erp.layout_documento_tops_confere_familia()");
    })).toMatch(GATILHO);
    // Dono sem bypass de RLS.
    expect(await recusaDa0038(async (c) => {
      await c.query("create role c03r_dono_sem_bypass nologin");
      await c.query("alter function erp.documentos_compra_conferir_v2() owner to c03r_dono_sem_bypass");
    })).toBe("COMPRAS-03: o dono de alguma funcao SECURITY DEFINER de compras nao atravessa RLS; os gatilhos nao veriam o pedido de origem nem o cadastro da organizacao.");
    // Quem aplica não é dono das funções (o papel da aplicação).
    expect(await recusaDa0038((c) => c.query("set local role erp_app")))
      .toBe("COMPRAS-03: o papel que aplica a migration nao e dono das funcoes SECURITY DEFINER de compras; o ALTER FUNCTION seria recusado.");
    // Quem aplica é dono das funções (atravessa RLS), mas não da tabela do layout.
    expect(await recusaDa0038(async (c) => {
      await c.query("create role c03r_aplicador nologin bypassrls");
      await c.query("grant usage on schema erp to c03r_aplicador");    // enxerga o schema, como qualquer dono de objeto dele
      for (const fn of DEFINER_DE_COMPRAS) await c.query(`alter function ${fn} owner to c03r_aplicador`);
      await c.query("set local role c03r_aplicador");
    })).toBe("COMPRAS-03: o papel que aplica a migration nao e dono de erp.layouts_documento; o ALTER TABLE e o COMMENT seriam recusados.");
    // Nada ficou: o ledger, o CHECK, as quatro e os papéis de ensaio são os de antes.
    expect(await noLedger()).toBe(false);
    expect(await familiasDoCheck()).toEqual(["vendas.orcamento", "vendas.pedido", "vendas.venda"]);
    expect((await configDasDefiner()).map((d) => d.fn).join(", ")).toBe(QUATRO);
    expect((await db.query("select 1 from pg_roles where rolname like 'c03r\\_%'")).rowCount).toBe(0);
  });

  it("LB5 aplica: ledger com 38 (a 0038 por último NESTE banco), 44 no repositório (a 0039 logo depois dela), layouts e ligações idênticos, CHECK com as cinco famílias da 0038 (o domínio menos as sete de estoque da 0043 e compras.orcamento, da 0044), gatilho intacto", async () => {
    await aplicar();
    // Este arquivo sobe o banco só até a 0038: o ledger dele termina nela. O repositório já tem a 0039 (EDITAR-01),
    // provada em editar-01-versao.test.ts.
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: 38, ultima: ALVO });
    const noDisco = listMigrations().map((m) => m.name);
    // No disco há mais do que o ledger deste arquivo (ele sobe só até a 0038): a 0039 (EDITAR-01), a 0040
    // (ESTOQUE-01), a 0041 (TOP-CONFIG-08), a 0042 (OPERACOES-01 F8), a 0043 (OPERACOES-01 F5a) e a 0044 (OPERACOES-01 F6a)
    // vêm depois.
    expect(noDisco.length, "44 migrations no repositório").toBe(44);
    expect(noDisco[37]).toBe(ALVO);
    expect(noDisco[38], "a 0039 logo depois da 0038 no repositório").toBe("0039_versao_do_documento_de_venda.sql");
    expect(await retrato(), "nenhuma linha de layout ou de ligação muda").toEqual(antes);
    expect(await familiasDoCheck()).toEqual(CINCO);
    // Uma lista só: o CHECK da 0038 é o conjunto do domínio de HOJE menos compras.orcamento — a família que a 0044
    // (OPERACOES-01 F6a) acrescenta ao CHECK (provado em compras-f6a-0044.test.ts; este banco para na 0038). O
    // domínio tem as três de venda e as três de compra, na ordem do registry.
    expect([...FAMILIAS_COM_LAYOUT].filter((f) => f !== "compras.orcamento").sort()).toEqual(CINCO);
    expect([...FAMILIAS_COM_LAYOUT].sort(), "o domínio tem exatamente uma família a mais que a 0038").toEqual([...CINCO, "compras.orcamento"].sort());
    expect([...FAMILIAS_COM_LAYOUT_DE_VENDAS].sort()).toEqual(["vendas.orcamento", "vendas.pedido", "vendas.venda"]);
    expect([...FAMILIAS_COM_LAYOUT_DE_COMPRAS]).toEqual(["compras.pedido", "compras.compra", "compras.orcamento"]);
    const chk = (await db.query<{ convalidated: boolean; coluna: string }>(
      `select c.convalidated, a.attname coluna from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.conrelid='erp.layouts_documento'::regclass and c.conname='chk_layouts_documento_familia'`)).rows;
    expect(chk, "validado (toda linha passou), só na coluna familia").toEqual([{ convalidated: true, coluna: "familia" }]);
    const gatilho = (await db.query<{ def: string; src: string }>(
      `select pg_get_triggerdef(t.oid) def, md5(p.prosrc) src from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid='erp.layout_documento_tops'::regclass and t.tgname='trg_layout_documento_tops_familia' and t.tgenabled='O'`)).rows;
    expect(gatilho).toEqual([{
      def: "CREATE TRIGGER trg_layout_documento_tops_familia BEFORE INSERT OR UPDATE ON erp.layout_documento_tops FOR EACH ROW EXECUTE FUNCTION erp.layout_documento_tops_confere_familia()",
      src: fonteDoGatilhoAntes
    }]);
    const comentario = (await db.query<{ c: string }>("select col_description('erp.layouts_documento'::regclass, (select attnum from pg_attribute where attrelid='erp.layouts_documento'::regclass and attname='familia')::int) c")).rows[0]!.c;
    for (const f of CINCO) expect(comentario, `o comentário da coluna cita ${f}`).toContain(f);
  });

  it("LB6 reaplicar é recusado pela pré-condição, sem efeito", async () => {
    expect(await recusaDa0038()).toBe("COMPRAS-03: chk_layouts_documento_familia ja aceita familia de compra; a 0038 ja foi aplicada ou ha schema divergente.");
    expect(await retrato()).toEqual(antes);
    expect(await familiasDoCheck()).toEqual(CINCO);
  });
});

describe("layout de compra pelo papel da aplicação (RLS, GUC da transação)", () => {
  it("LC1 layout de compras.pedido e de compras.compra grava; família fora das cinco é recusada pelo CHECK", async () => {
    const pedido = await naApp((tx) => layout(tx, "compras.pedido"));
    const compra = await naApp((tx) => layout(tx, "compras.compra"));
    const lidos = (await naApp((tx) => tx.query<{ familia: string }>("select familia from erp.layouts_documento where id = any($1) order by familia", [[pedido, compra]]))).rows;
    expect(lidos.map((x) => x.familia)).toEqual(["compras.compra", "compras.pedido"]);
    for (const fora of ["compras.solicitacao", "estoque.baixa", "COMPRAS.COMPRA", "compras", "compras.compra "]) {
      const r = await erroDe(naApp((tx) => layout(tx, fora)));
      expect([fora, r.code, r.constraint]).toEqual([fora, "23514", "chk_layouts_documento_familia"]);
    }
  });

  it("LC2 o padrão é por família: o de compras.compra convive com o de vendas.venda (acervo) e com o de compras.pedido; um segundo de compras.compra é recusado", async () => {
    await naApp((tx) => layout(tx, "compras.compra", { padrao: true }));
    await naApp((tx) => layout(tx, "compras.pedido", { padrao: true }));
    const padroes = (await db.query<{ familia: string }>(
      "select familia from erp.layouts_documento where organization_id=$1 and padrao and is_active and deleted_at is null order by familia", [demo.orgId])).rows.map((x) => x.familia);
    expect(padroes).toEqual(["compras.compra", "compras.pedido", "vendas.venda"]);
    const r = await erroDe(naApp((tx) => layout(tx, "compras.compra", { padrao: true })));
    expect([r.code, r.constraint]).toEqual(["23505", "ux_layouts_documento_padrao"]);
  });

  it("LC3 o gatilho da família (inalterado) liga TOP de compra ao layout da MESMA família e recusa todo cruzamento — venda×compra e pedido×compra", async () => {
    const lCompra = await naApp((tx) => layout(tx, "compras.compra"));
    const lPedido = await naApp((tx) => layout(tx, "compras.pedido"));
    await naApp((tx) => ligar(tx, lCompra, tops["compras.compra"]!));
    await naApp((tx) => ligar(tx, lPedido, tops["compras.pedido"]!));
    const ligadas = (await db.query<{ layout_id: string }>("select layout_id from erp.layout_documento_tops where tipo_operacao_id = any($1) order by layout_id",
      [[tops["compras.compra"]!.top, tops["compras.pedido"]!.top]])).rows.map((x) => x.layout_id);
    expect(ligadas.sort()).toEqual([lCompra, lPedido].sort());

    const outraCompra = await criarTop("compras.compra");
    const outroPedido = await criarTop("compras.pedido");
    const outraVenda = await criarTop("vendas.venda");
    const cruzamentos: [string, string, Top][] = [
      ["TOP de compra em layout de venda", layoutsDeVenda["vendas.venda"]!, outraCompra],
      ["TOP de pedido de compra em layout de pedido de venda", layoutsDeVenda["vendas.pedido"]!, outroPedido],
      ["TOP de venda em layout de compra", lCompra, outraVenda],
      ["TOP de pedido de compra em layout de compra", lCompra, outroPedido],
      ["TOP de compra em layout de pedido de compra", lPedido, outraCompra]
    ];
    for (const [caso, l, t] of cruzamentos) {
      const r = await erroDe(naApp((tx) => ligar(tx, l, t)));
      expect([caso, r.code, r.message]).toEqual([caso, "23514", expect.stringMatching(/^VENDAS-A3-1: a familia da TOP \(.*\) difere da familia do layout \(.*\)\.$/)]);
    }
    // E o UPDATE passa pelo mesmo gatilho: mover a ligação da TOP de compra para um layout de venda é recusado.
    const mover = await erroDe(naApp((tx) => tx.query("update erp.layout_documento_tops set layout_id=$2 where tipo_operacao_id=$1",
      [tops["compras.compra"]!.top, layoutsDeVenda["vendas.venda"]!])));
    expect(mover.code).toBe("23514");
    expect((await db.query<{ layout_id: string }>("select layout_id from erp.layout_documento_tops where tipo_operacao_id=$1", [tops["compras.compra"]!.top])).rows)
      .toEqual([{ layout_id: lCompra }]);
  });
});

describe("search_path das funções SECURITY DEFINER de compras (item 0 e)", () => {
  it("SP1 o catálogo inteiro: exatamente as quatro, cada uma com search_path 'erp, pg_temp' (pg_temp por último) e EXECUTE só do dono", async () => {
    const definer = await configDasDefiner();
    expect(definer).toEqual(DEFINER_DE_COMPRAS.map((fn) => ({ fn, cfg: SEARCH_PATH_NOVO, app: false })));
    for (const d of definer) {
      const caminho = d.cfg![0]!.replace(/^search_path=/, "").split(",").map((s) => s.trim());
      expect(caminho.at(-1), `${d.fn}: pg_temp por último`).toBe("pg_temp");
      expect(caminho[0], `${d.fn}: erp primeiro`).toBe("erp");
    }
    const outros = (await db.query<{ fn: string }>(
      `select p.oid::regprocedure::text fn from pg_proc p
        where p.oid = any ($1::regprocedure[]) and not (p.prosecdef and provolatile = 'v')`, [DEFINER_DE_COMPRAS])).rows;
    expect(outros, "continuam SECURITY DEFINER e voláteis (o ALTER só mexeu no search_path)").toEqual([]);
  });

  it("SP2 os quatro gatilhos continuam funcionando com o search_path novo (papel da aplicação, módulo compras)", async () => {
    const naCompras = <T>(fn: (tx: Tx) => Promise<T>) => naApp(fn, "compras");
    seq += 1;
    const cab = (tx: Tx, especie: "pedido" | "compra", origem: string | null) => tx.query<{ id: string }>(
      `insert into erp.documentos_compra (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, fornecedor_id, data_documento, origem_documento_id)
       values ($1,$2,$3,$4,$5,$6,$7,'2026-09-30',$8) returning id`,
      [demo.orgId, empresa, especie, `LC-${especie}-${++seq}`, tops[`compras.${especie}`]!.top, tops[`compras.${especie}`]!.versao, fornecedor, origem]).then((r) => r.rows[0]!.id);
    const item = (tx: Tx, documento: string, qtd: string, origem: string | null) => tx.query<{ id: string }>(
      `insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, quantidade, valor_unitario, valor_total, posicao, origem_item_id)
       values ($1,$2,$3,$4,10,0,0,$5) returning id`, [demo.orgId, documento, produto, qtd, origem]).then((r) => r.rows[0]!.id);

    // conferir_v2 (cabeçalho) + itens_documento_aberto (item) + item_origem_guarda (item com e sem origem)
    const pedido = await naCompras(async (tx) => { const id = await cab(tx, "pedido", null); return { id, item: await item(tx, id, "5", null) }; });
    const compra = await naCompras(async (tx) => { const id = await cab(tx, "compra", pedido.id); await item(tx, id, "3", pedido.item); return id; });
    // a guarda da origem continua somando o saldo
    expect((await erroDe(naCompras(async (tx) => { const id = await cab(tx, "compra", pedido.id); await item(tx, id, "3", pedido.item); }))).message)
      .toBe("VALIDATION_ERROR: A quantidade passa do saldo do item do pedido de compra.");
    // transicao_v2: pedido com compra viva não se cancela; cancelada a compra, ele se cancela
    const situacao = (id: string, s: string) => naCompras((tx) => tx.query("update erp.documentos_compra set situacao=$2 where id=$1", [id, s]));
    expect((await erroDe(situacao(pedido.id, "cancelado"))).message).toBe("CONFLICT: Este pedido tem compras: cancele-as ou encerre o saldo.");
    await expect(situacao(compra, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
    await expect(situacao(pedido.id, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
    // itens_documento_aberto: documento cancelado não recebe item
    expect((await erroDe(naCompras((tx) => item(tx, pedido.id, "1", null)))).message).toBe("CONFLICT: Os itens só mudam com o documento de compra aberto (situação: cancelado).");
  });
});

/**
 * O LEITOR DE SCHEMA DOS GATES ENXERGA O CHECK REFEITO POR ALTER TABLE (item 0 g da revisão da COMPRAS-02).
 *
 * `scripts/lib/schema.mjs` é JS puro, compartilhado com os gates de documentação; é carregado por import dinâmico
 * com o tipo declarado aqui (só o que estes casos leem). As migrations de MENTIRA vivem num diretório temporário:
 * o que se prova é a gramática, e amarrá-la ao conteúdo de `supabase/migrations` a faria mudar a cada fatia.
 */
interface ColunaLida { check: string | null; checkNome: string | null }
interface TabelaLida { columns: Map<string, ColunaLida>; constraints: string[] }
const LEITOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/lib/schema.mjs")).href;
const lerSchema = async (dir?: string): Promise<Map<string, TabelaLida>> =>
  ((await import(LEITOR)) as { readSchema: (dir?: string) => Map<string, TabelaLida> }).readSchema(dir);

describe("leitor de schema dos gates: CHECK refeito por ALTER TABLE (item 0 g)", () => {
  let dir: string;
  const escrever = (nome: string, sql: string) => fs.writeFileSync(path.join(dir, nome), sql, "utf8");
  const limpar = () => { for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f)); };
  const tabela = async () => (await lerSchema(dir)).get("erp.exemplo")!;
  const BASE = `create table erp.exemplo (
    id uuid primary key,
    situacao text not null constraint chk_exemplo_situacao check (situacao in ('a','b')),
    tipo text constraint chk_exemplo_tipo check (tipo in ('x','y')),
    constraint chk_exemplo_par check ((situacao = 'a') = (tipo is null))
  );`;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "leitor-checks-")); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("G1 as migrations reais: a situação e a espécie do documento de compra e a família do layout como a 0044 as deixou (refeitas por alter table): as cinco da 0038, as sete de estoque da 0043 e o orçamento de compra", async () => {
    const real = await lerSchema();
    // A 0037 acrescentou 'convertido'; a 0044 (OPERACOES-01 F6a), 'finalizado', 'escolhido' e 'nao_escolhido' — e a
    // espécie 'orcamento', e a família compras.orcamento ao layout. É o ÚLTIMO alter que vale.
    expect(real.get("erp.documentos_compra")!.columns.get("situacao")).toMatchObject({
      check: "situacao in ('aberto','confirmado','convertido','cancelado','finalizado','escolhido','nao_escolhido')", checkNome: "chk_documentos_compra_situacao" });
    expect(real.get("erp.documentos_compra")!.columns.get("especie")).toMatchObject({
      check: "especie in ('pedido','compra','orcamento')", checkNome: "chk_documentos_compra_especie" });
    expect(real.get("erp.layouts_documento")!.columns.get("familia")).toMatchObject({
      check: "familia in ('vendas.orcamento', 'vendas.pedido', 'vendas.venda', 'compras.pedido', 'compras.compra', 'estoque.entrada', 'estoque.saida', "
        + "'estoque.transferencia', 'estoque.ajuste', 'estoque.requisicao_material', 'estoque.consumo', 'estoque.devolucao_consumo', 'compras.orcamento')",
      checkNome: "chk_layouts_documento_familia" });
    // E o documento gerado publica isso na coluna "Valores" (o gate `data-dictionary --check` confere o resto).
    const documento = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/DATA-DICTIONARY.md"), "utf8");
    expect(documento).toContain("| `situacao` | Situação | text | sim |  |  | `aberto` · `confirmado` · `convertido` · `cancelado` · `finalizado` · `escolhido` · `nao_escolhido` |");
    expect(documento).toContain("| `familia` | Movimento | text | sim |  |  | `vendas.orcamento` · `vendas.pedido` · `vendas.venda` · `compras.pedido` · `compras.compra` · "
      + "`estoque.entrada` · `estoque.saida` · `estoque.transferencia` · `estoque.ajuste` · `estoque.requisicao_material` · `estoque.consumo` · `estoque.devolucao_consumo` · "
      + "`compras.orcamento` |");
  });

  it("G2 drop e add na MESMA instrução, com o mesmo nome: vale o CHECK novo", async () => {
    limpar();
    escrever("0001_base.sql", BASE);
    escrever("0002_refaz.sql", `alter table erp.exemplo
      drop constraint chk_exemplo_situacao,
      add constraint chk_exemplo_situacao check (situacao in ('a','b','c'));`);
    expect((await tabela()).columns.get("situacao")).toMatchObject({ check: "situacao in ('a','b','c')", checkNome: "chk_exemplo_situacao" });
    expect((await tabela()).columns.get("tipo")!.check, "o CHECK de outra coluna não muda").toBe("tipo in ('x','y')");
  });

  it("G3 a ordem vale entre arquivos: só o drop apaga os valores; o add num arquivo seguinte os devolve", async () => {
    limpar();
    escrever("0001_base.sql", BASE);
    escrever("0002_drop.sql", "alter table erp.exemplo drop constraint if exists chk_exemplo_tipo;");
    expect((await tabela()).columns.get("tipo")).toMatchObject({ check: null, checkNome: null });
    escrever("0003_add.sql", "alter table erp.exemplo add constraint chk_exemplo_tipo_novo check ((tipo in ('x','y','z')));");
    expect((await tabela()).columns.get("tipo")).toMatchObject({ check: "(tipo in ('x','y','z'))", checkNome: "chk_exemplo_tipo_novo" });
  });

  it("G4 predicado que não é a lista de UMA coluna é constraint de tabela; drop de constraint de tabela a tira da lista", async () => {
    limpar();
    escrever("0001_base.sql", BASE);
    escrever("0002_tabela.sql", `alter table erp.exemplo
      drop constraint chk_exemplo_par,
      add constraint chk_exemplo_tipo_ou_nulo check (tipo is null or tipo in ('x'));`);
    const t = await tabela();
    expect(t.columns.get("tipo")!.check, "o CHECK da coluna continua o dela").toBe("tipo in ('x','y')");
    expect(t.constraints).toEqual(["constraint chk_exemplo_tipo_ou_nulo check (tipo is null or tipo in ('x'))"]);
  });

  it("G5 o que não é CHECK nem nome conhecido fica como estava (UNIQUE/FK acrescentadas, drop de nome automático)", async () => {
    limpar();
    escrever("0001_base.sql", BASE);
    const antesDoAlter = await tabela();
    escrever("0002_outros.sql", `alter table erp.exemplo add constraint uq_exemplo_tenant unique (id, situacao);
      alter table erp.exemplo add constraint fk_exemplo_x foreign key (id) references erp.outra (id);
      alter table erp.exemplo drop constraint exemplo_situacao_check;`);
    const t = await tabela();
    expect(t.constraints).toEqual(antesDoAlter.constraints);
    expect([...t.columns.values()].map((c) => c.check)).toEqual([...antesDoAlter.columns.values()].map((c) => c.check));
  });
});
