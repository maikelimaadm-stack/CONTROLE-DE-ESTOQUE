import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db, type Tx, type TenantContext } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O QUE A 0037 PROMETEU, PROVADO CONTRA O BANCO (COMPRAS-02, decisão 268).
 *
 * Receber o pedido de compra = lançar uma compra COM ORIGEM. O banco guarda:
 *   · a origem do cabeçalho (só compra; pedido ABERTO da mesma empresa e do mesmo fornecedor; imutável);
 *   · o encerramento do saldo (só pedido convertido, os três campos juntos, só na passagem aberto → convertido);
 *   · as transições novas do pedido (aberto → convertido, reabertura sem saldo encerrado, convertido → cancelado
 *     recusado, pedido com compra ligada não cancelada não se cancela) e o congelamento fora do aberto;
 *   · o gatilho da origem nos itens (mesmo pedido, mesmo produto, soma ligada em compras NÃO canceladas ≤
 *     quantidade do item do pedido; compra com origem liga TODO item; compra sem origem não liga nenhum).
 *
 * Desde a 0044 (OPERACOES-01 F6a, decisão 283) as funções são outras — a conferência e a transição v3, a guarda da
 * origem v2 —, e as promessas da 0037 continuam valendo: este arquivo as prova sobre elas, num banco com TODAS as
 * migrations. O que a 0044 acrescenta (pedido finalizado, aprovação para orçamento, orçamento de compra) está em
 * compras-f6a-0044.test.ts.
 *
 * Duas conexões: `db` (superusuário, monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação — o caminho que a API percorre). As ligações são gravadas pelo `app`: é a rede
 * que pega o caminho que tenha pulado a conferência da API.
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let fornecedor: string; let outroFornecedor: string;
let produtoX: string; let produtoY: string;
let topCompra: Top; let topPedido: Top;
let outraOrg: string; let empresaOutraOrg: string; let fornecedorOutraOrg: string; let topCompraOutraOrg: Top; let produtoOutraOrg: string;

interface Top { top: string; versao: string }
interface Doc { id: string; itens: string[] }
type Linha = { produto?: string; qtd: string; origem?: string | null };
type Cab = Partial<{ org: string; empresa: string; fornecedor: string; top: Top; origem: string | null; situacao: string;
  saldoEm: string | null; saldoPor: string | null; saldoMotivo: string | null }>;

const ctxCompras = (): TenantContext => ({ orgId: demo.orgId, userId: demo.adminUserId, modulo: "compras" });
const naApp = <T>(fn: (tx: Tx) => Promise<T>) => withTx(app, ctxCompras(), fn);

let seq = 0;
const id1 = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;

async function pessoa(org: string, fornece = true): Promise<string> {
  seq += 1;
  return id1("insert into erp.people (organization_id, code, name, is_provider) values ($1,$2,$3,$4) returning id",
    [org, `CO02-${seq}`, `[TEST] Parceiro compras 02 ${seq}`, fornece]);
}
async function criarTop(org: string, codigoBase: string): Promise<Top> {
  seq += 1;
  // TOP e versão na MESMA transação: a FK da versão atual é adiada até o commit.
  return withTx(db, { orgId: org, userId: null }, async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id", [org, `CO2${seq}`, codigoBase])).rows[0]!.id;
    const versao = (await tx.query<{ id: string }>("insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,1,$3) returning id", [org, top, `TOP compras 02 ${seq}`])).rows[0]!.id;
    return { top, versao };
  });
}

/** INSERT do cabeçalho por `q` (tx da aplicação, ou o cliente de `semGatilhos`). */
async function cabecalho(q: Tx, especie: "pedido" | "compra", o: Cab = {}): Promise<string> {
  seq += 1;
  const top = o.top ?? (especie === "compra" ? topCompra : topPedido);
  return (await q.query<{ id: string }>(
    `insert into erp.documentos_compra (organization_id, empresa_id, especie, codigo, situacao, tipo_operacao_id, tipo_operacao_versao_id,
       fornecedor_id, data_documento, origem_documento_id, saldo_encerrado_em, saldo_encerrado_por, saldo_encerrado_motivo)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'2026-09-01',$9,$10,$11,$12) returning id`,
    [o.org ?? demo.orgId, o.empresa ?? A, especie, `CO2-${seq}`, o.situacao ?? "aberto", top.top, top.versao, o.fornecedor ?? fornecedor,
     o.origem ?? null, o.saldoEm ?? null, o.saldoPor ?? null, o.saldoMotivo ?? null])).rows[0]!.id;
}
async function linha(q: Tx, documento: string, l: Linha, posicao = 0, org?: string): Promise<string> {
  return (await q.query<{ id: string }>(
    `insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, quantidade, valor_unitario, valor_total, posicao, origem_item_id)
     values ($1,$2,$3,$4,10,0,$5,$6) returning id`,
    [org ?? demo.orgId, documento, l.produto ?? produtoX, l.qtd, posicao, l.origem ?? null])).rows[0]!.id;
}
/** Pedido de compra (papel da aplicação) com uma linha por quantidade. */
async function pedido(linhas: Linha[], o: Cab = {}): Promise<Doc> {
  return naApp(async (tx) => {
    const id = await cabecalho(tx, "pedido", o);
    const itens: string[] = [];
    for (const [i, l] of linhas.entries()) itens.push(await linha(tx, id, l, i));
    return { id, itens };
  });
}
/** Compra (papel da aplicação), com ou sem origem; cabeçalho e itens na MESMA transação, como a API grava. */
async function compra(origem: string | null, linhas: Linha[], o: Cab = {}): Promise<Doc> {
  return naApp(async (tx) => {
    const id = await cabecalho(tx, "compra", { ...o, origem });
    const itens: string[] = [];
    for (const [i, l] of linhas.entries()) itens.push(await linha(tx, id, l, i));
    return { id, itens };
  });
}
const maisUmItem = (documento: string, l: Linha) => naApp((tx) => linha(tx, documento, l, 9));
const situacao = (id: string, s: string) => db.query("update erp.documentos_compra set situacao=$2 where id=$1", [id, s]);
const encerrar = (id: string, motivo = "Fornecedor não entrega o resto") => db.query(
  "update erp.documentos_compra set situacao='convertido', saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo=$3 where id=$1",
  [id, demo.adminUserId, motivo]);
const ler = async (id: string) => (await db.query<{ situacao: string; saldo_encerrado_motivo: string | null; origem_documento_id: string | null }>(
  "select situacao, saldo_encerrado_motivo, origem_documento_id from erp.documentos_compra where id=$1", [id])).rows[0]!;

async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; constraint?: string; message: string }; }
  throw new Error("esperava recusa, e o banco aceitou");
}
/**
 * Cenário com os gatilhos DO USUÁRIO desligados, numa transação desfeita no fim: prova o CHECK e a FK sozinhos.
 * `disable trigger user` não desliga os gatilhos internos de integridade referencial (a FK continua valendo).
 */
async function semGatilhos<T>(fn: (q: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("alter table erp.documentos_compra disable trigger user");
    await c.query("alter table erp.documentos_compra_itens disable trigger user");
    return await fn(c as unknown as Tx);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}

/** Transação aberta pelo papel da aplicação, com as GUCs, e o pid dela (para ver quem espera quem). */
async function abrir(): Promise<{ c: Tx; pid: number }> {
  const c = await app.connect();
  await c.query("begin");
  const ctx = ctxCompras();
  await c.query("select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.modulo_empresa',$3,true)", [ctx.orgId, ctx.userId, ctx.modulo]);
  const pid = (await c.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0]!.pid;
  return { c, pid };
}
async function esperaPor(bloqueado: number, quem: number): Promise<void> {
  for (let i = 0; i < 250; i++) {
    const r = await db.query<{ b: number[] }>("select pg_blocking_pids($1) b", [bloqueado]);
    if (r.rows[0]!.b.includes(quem)) return;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  throw new Error(`o processo ${bloqueado} não chegou a esperar ${quem}`);
}

const RECUSA_ORIGEM = "VALIDATION_ERROR: A origem da compra precisa ser um pedido de compra da mesma empresa.";

beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 4 });
  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  fornecedor = await pessoa(demo.orgId);
  outroFornecedor = await pessoa(demo.orgId);
  const produtos = (await db.query<{ id: string }>("select id from erp.products where organization_id=$1 and controle_lote='nenhum' order by code limit 2", [demo.orgId])).rows;
  produtoX = produtos[0]!.id; produtoY = produtos[1]!.id;
  topCompra = await criarTop(demo.orgId, "compras.compra");
  topPedido = await criarTop(demo.orgId, "compras.pedido");

  outraOrg = await id1("insert into erp.organizations (name, slug) values ('[TEST] Outra compras 02','outra-compras-02') returning id");
  fornecedorOutraOrg = await pessoa(outraOrg);
  topCompraOutraOrg = await criarTop(outraOrg, "compras.compra");
  produtoOutraOrg = await id1(
    `insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, control_stock)
     select $1, 'CO02-P', '[TEST] Produto outra org 02', measurement_id, group_id, category_id, false from erp.products where id=$2 returning id`, [outraOrg, produtoX]);
  empresaOutraOrg = await id1("insert into erp.empresas (organization_id, code, name) values ($1, 92, '[TEST] Empresa outra org compras 02') returning id", [outraOrg]);
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("premissas e catálogo", () => {
  it("o cenário: duas empresas, dois fornecedores, dois produtos, TOPs das duas famílias", async () => {
    expect(A).not.toBe(B);
    expect(fornecedor).not.toBe(outroFornecedor);
    expect(produtoX).not.toBe(produtoY);
    const f = (await db.query<{ n: number }>("select count(*)::int n from erp.people where id = any($1) and is_provider and deleted_at is null", [[fornecedor, outroFornecedor]])).rows[0]!.n;
    expect(f).toBe(2);
    const t = (await db.query<{ codigo_base: string }>("select codigo_base from erp.tipos_operacao where id = any($1) order by codigo_base", [[topCompra.top, topPedido.top]])).rows;
    expect(t.map((x) => x.codigo_base)).toEqual(["compras.compra", "compras.pedido"]);
  });

  it("a 0037 é a 37ª migration do ledger; depois dela, a 0038 (COMPRAS-03), a 0039 (EDITAR-01), a 0040 (ESTOQUE-01), a 0041 (TOP-CONFIG-08), a OPERACOES-01 (0042–0048), a 0049 (MAPA-01), a 0050 (CADASTRO-AREAS-01) e a 0051 (CADASTRO-AREAS-02)", async () => {
    // A posição da 0037 continua sendo a 37ª; a contagem total acompanha a ordem do repositório (a 0038 alarga
    // o CHECK de família dos layouts e fixa o search_path destas funções — layouts-documento-compras.test.ts; a 0039
    // dá versão ao documento de venda — editar-01-versao.test.ts; a 0040 cria o documento de estoque —
    // estoque-01-0040.test.ts; a 0041 cria as aprovações e a guarda de aprovação da compra — top-config-08-0041.test.ts;
    // a 0042 cria a Central Financeira — operacoes-01-0042.test.ts; a 0043 dá a movimentação interna ao documento de
    // estoque e troca uma mensagem do item de compra — operacoes-01-0043.test.ts; a 0044 troca as funções da 0037 pelas
    // v3/v2 — pedido finalizado e orçamento de compra — compras-f6a-0044.test.ts; a 0045 liga o financeiro à TOP e cria o
    // imóvel rural do LCDPR — operacoes-01-0045.test.ts; a 0046 dá a TOP aos módulos com produto —
    // operacoes-01-f10-modulos-top.test.ts; a 0047 dá à compra a entrada
    // de nota por XML e a guarda dos dados fiscais — operacoes-01-0047.test.ts; a 0049 cria o Mapa de
    // Manejo — MAPA-01, #91; a 0050 o cadastro de áreas; a 0051 unifica mapa × áreas; a 0052 cria o histórico de
    // análises satelitais por área — SAT-01, sat-01-0052.test.ts; a 0053 cria a consulta satelital em lote — SAT-02,
    // sat-02-0053.test.ts; a 0054 dá ao executor da fila a reserva e a contagem do limite — SAT-03, sat-03-0054.test.ts; a 0055
    // guarda o raster de valores por pixel da análise — SAT-06, sat-06-0055.test.ts; a 0056 amplia multi-índice — SAT-08,
    // sat-08-0056.test.ts; a 0057 corrige o contrato Statistical API — SAT-08 R1, sat-08-0057.test.ts).
    const r = (await db.query<{ ate: number; n: number; ultima: string }>(
      "select count(*) filter (where name <= '0037_receber_pedido_de_compra.sql')::int ate, count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(r).toEqual({ ate: 37, n: 61, ultima: "0061_ocupacao_de_area_e_objetos_de_mapa.sql" });
  });

  it("colunas novas: tipo e nulidade", async () => {
    const r = (await db.query<{ c: string }>(
      `select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable c from information_schema.columns
        where table_schema='erp' and ((table_name='documentos_compra' and column_name in ('origem_documento_id','saldo_encerrado_em','saldo_encerrado_por','saldo_encerrado_motivo'))
           or (table_name='documentos_compra_itens' and column_name='origem_item_id')) order by 1`)).rows.map((x) => x.c);
    expect(r).toEqual([
      "documentos_compra.origem_documento_id:uuid:YES", "documentos_compra.saldo_encerrado_em:timestamp with time zone:YES",
      "documentos_compra.saldo_encerrado_motivo:text:YES", "documentos_compra.saldo_encerrado_por:uuid:YES", "documentos_compra_itens.origem_item_id:uuid:YES"
    ]);
  });

  it("FKs compostas da ligação (para a própria tabela), chave (id, organization_id) dos itens e índices parciais", async () => {
    const fk = (await db.query<{ conname: string; def: string }>(
      "select conname, pg_get_constraintdef(oid) def from pg_constraint where conname in ('fk_documentos_compra_origem','fk_documentos_compra_itens_origem','fk_documentos_compra_saldo_encerrado_por','uq_documentos_compra_itens_tenant') order by conname")).rows;
    expect(fk).toEqual([
      { conname: "fk_documentos_compra_itens_origem", def: "FOREIGN KEY (origem_item_id, organization_id) REFERENCES erp.documentos_compra_itens(id, organization_id)" },
      { conname: "fk_documentos_compra_origem", def: "FOREIGN KEY (origem_documento_id, organization_id) REFERENCES erp.documentos_compra(id, organization_id)" },
      { conname: "fk_documentos_compra_saldo_encerrado_por", def: "FOREIGN KEY (saldo_encerrado_por) REFERENCES erp.users(id)" },
      { conname: "uq_documentos_compra_itens_tenant", def: "UNIQUE (id, organization_id)" }
    ]);
    const ix = (await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname='erp' and indexname in ('ix_documentos_compra_origem','ix_documentos_compra_itens_origem') order by indexname")).rows.map((x) => x.indexdef);
    expect(ix).toEqual([
      "CREATE INDEX ix_documentos_compra_itens_origem ON erp.documentos_compra_itens USING btree (origem_item_id) WHERE (origem_item_id IS NOT NULL)",
      "CREATE INDEX ix_documentos_compra_origem ON erp.documentos_compra USING btree (origem_documento_id) WHERE (origem_documento_id IS NOT NULL)"
    ]);
  });

  it("gatilhos: os da 0036 com os MESMOS nomes, nas funções da 0044 (v3); o da origem sem WHEN (v2); as funções da 0036 e da 0037 foram removidas", async () => {
    const t = (await db.query<{ tgname: string; def: string }>(
      `select tgname, pg_get_triggerdef(oid) def from pg_trigger
        where tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass) and not tgisinternal and tgenabled='O' order by tgname`)).rows;
    // A 0041 (TOP-CONFIG-08) acrescenta a guarda da aprovação, só na entrada em confirmado. A 0044 (OPERACOES-01 F6a)
    // troca a conferência, a transição e a guarda da origem pelas funções novas (MESMOS nomes de gatilho, mesma ordem de
    // disparo) e acrescenta a guarda da finalização do pedido e a dos itens do orçamento. A 0047 (OPERACOES-01 F7)
    // acrescenta a guarda dos dados fiscais (chave de acesso cruzada com a nota antiga).
    expect(t).toEqual([
      { tgname: "trg_documentos_compra_aprovacao", def: "CREATE TRIGGER trg_documentos_compra_aprovacao BEFORE UPDATE OF situacao ON erp.documentos_compra FOR EACH ROW WHEN (((old.situacao = 'aberto'::text) AND (new.situacao = 'confirmado'::text))) EXECUTE FUNCTION erp.documentos_compra_aprovacao_guarda()" },
      { tgname: "trg_documentos_compra_audit", def: "CREATE TRIGGER trg_documentos_compra_audit AFTER INSERT OR DELETE OR UPDATE ON erp.documentos_compra FOR EACH ROW EXECUTE FUNCTION erp.audit_row()" },
      { tgname: "trg_documentos_compra_conferir", def: "CREATE TRIGGER trg_documentos_compra_conferir BEFORE INSERT OR UPDATE ON erp.documentos_compra FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_conferir_v3()" },
      { tgname: "trg_documentos_compra_finalizacao", def: "CREATE TRIGGER trg_documentos_compra_finalizacao BEFORE UPDATE OF situacao ON erp.documentos_compra FOR EACH ROW WHEN (((old.situacao = 'aberto'::text) AND (new.situacao = 'finalizado'::text) AND (new.especie = 'pedido'::text))) EXECUTE FUNCTION erp.documentos_compra_finalizacao_guarda()" },
      { tgname: "trg_documentos_compra_itens_documento_aberto", def: "CREATE TRIGGER trg_documentos_compra_itens_documento_aberto BEFORE INSERT OR DELETE OR UPDATE ON erp.documentos_compra_itens FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_itens_documento_aberto()" },
      { tgname: "trg_documentos_compra_itens_orcamento_guarda", def: "CREATE TRIGGER trg_documentos_compra_itens_orcamento_guarda BEFORE INSERT OR UPDATE OF item_pedido_orcado_id, quantidade, produto_id, lote, validade ON erp.documentos_compra_itens FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_item_orcamento_guarda()" },
      { tgname: "trg_documentos_compra_itens_origem_guarda", def: "CREATE TRIGGER trg_documentos_compra_itens_origem_guarda BEFORE INSERT OR UPDATE OF origem_item_id, quantidade, produto_id ON erp.documentos_compra_itens FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_item_origem_guarda_v2()" },
      { tgname: "trg_documentos_compra_nota", def: "CREATE TRIGGER trg_documentos_compra_nota BEFORE INSERT OR UPDATE OF chave_acesso, uf_nota, tipo_documento_fiscal, valor_ipi, valor_icms_st, seguro, tipo_titulo_id, classificacao_gasto, rateio_tipo, parcelas_nota, dfe_id, solicitacao_compra_id ON erp.documentos_compra FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_nota_guarda()" },
      { tgname: "trg_documentos_compra_transicao", def: "CREATE TRIGGER trg_documentos_compra_transicao BEFORE UPDATE OF situacao ON erp.documentos_compra FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_transicao_v3()" }
    ]);
    const velhas = (await db.query(
      `select to_regprocedure('erp.documentos_compra_conferir()') a, to_regprocedure('erp.documentos_compra_transicao()') b,
              to_regprocedure('erp.documentos_compra_conferir_v2()') c, to_regprocedure('erp.documentos_compra_transicao_v2()') d,
              to_regprocedure('erp.documentos_compra_item_origem_guarda()') e`)).rows[0];
    expect(velhas).toEqual({ a: null, b: null, c: null, d: null, e: null });
  });

  it("funções do recebimento (as da 0044, que substituíram as da 0037): SECURITY DEFINER com search_path fixo, voláteis, e EXECUTE só do dono (o erp_app não chama)", async () => {
    const f = (await db.query<{ proname: string; prosecdef: boolean; provolatile: string; sp: boolean; app: boolean }>(
      `select proname, prosecdef, provolatile, exists (select 1 from unnest(coalesce(proconfig,'{}'::text[])) c where c like 'search_path=%') sp,
              has_function_privilege('erp_app', oid, 'execute') app
         from pg_proc where oid in ('erp.documentos_compra_conferir_v3()'::regprocedure, 'erp.documentos_compra_transicao_v3()'::regprocedure,
                                    'erp.documentos_compra_item_origem_guarda_v2()'::regprocedure) order by proname`)).rows;
    expect(f).toEqual([
      { proname: "documentos_compra_conferir_v3", prosecdef: true, provolatile: "v", sp: true, app: false },
      { proname: "documentos_compra_item_origem_guarda_v2", prosecdef: true, provolatile: "v", sp: true, app: false },
      { proname: "documentos_compra_transicao_v3", prosecdef: true, provolatile: "v", sp: true, app: false }
    ]);
  });
});

describe("CHECKs: origem só da compra, saldo encerrado só do pedido convertido, situação por espécie (gatilhos desligados)", () => {
  const check = async (fn: (q: Tx) => Promise<unknown>) => (await erroDe(semGatilhos(fn))).constraint;
  const encerrado = { saldoEm: "2026-09-02T10:00:00Z", saldoMotivo: "Resto cancelado pelo fornecedor" };

  it("contraprova: pedido convertido com os três campos do encerramento e compra com origem num pedido passam", async () => {
    await expect(semGatilhos(async (q) => {
      await cabecalho(q, "pedido", { situacao: "convertido", ...encerrado, saldoPor: demo.adminUserId });
      const p = await cabecalho(q, "pedido");
      return cabecalho(q, "compra", { origem: p });
    })).resolves.toBeTruthy();
  });
  it("pedido com origem é recusado (a origem é só da compra)", async () => {
    expect(await check(async (q) => cabecalho(q, "pedido", { origem: await cabecalho(q, "pedido") }))).toBe("chk_documentos_compra_origem_so_compra");
  });
  it("encerramento do saldo: na compra, no pedido aberto, pela metade e com motivo em branco — tudo recusado", async () => {
    const admin = () => demo.adminUserId;
    expect(await check((q) => cabecalho(q, "compra", { ...encerrado, saldoPor: admin() }))).toBe("chk_documentos_compra_saldo_encerrado");
    expect(await check((q) => cabecalho(q, "pedido", { ...encerrado, saldoPor: admin() }))).toBe("chk_documentos_compra_saldo_encerrado");
    expect(await check((q) => cabecalho(q, "pedido", { situacao: "convertido", ...encerrado, saldoPor: null }))).toBe("chk_documentos_compra_saldo_encerrado");
    expect(await check((q) => cabecalho(q, "pedido", { situacao: "convertido", saldoEm: encerrado.saldoEm, saldoPor: admin(), saldoMotivo: null }))).toBe("chk_documentos_compra_saldo_encerrado");
    expect(await check((q) => cabecalho(q, "pedido", { situacao: "convertido", ...encerrado, saldoPor: admin(), saldoMotivo: "   " }))).toBe("chk_documentos_compra_saldo_encerrado");
  });
  it("'convertido' é só do pedido; 'confirmado' só da compra; situação fora do domínio", async () => {
    expect(await check((q) => cabecalho(q, "compra", { situacao: "convertido" }))).toBe("chk_documentos_compra_situacao_especie");
    expect(await check((q) => cabecalho(q, "pedido", { situacao: "confirmado" }))).toBe("chk_documentos_compra_situacao_especie");
    expect(await check((q) => cabecalho(q, "pedido", { situacao: "recebido" }))).toBe("chk_documentos_compra_situacao");
    await expect(semGatilhos((q) => cabecalho(q, "pedido", { situacao: "convertido" }))).resolves.toBeTruthy();
  });
});

describe("FKs compostas: a ligação não atravessa organização (gatilhos desligados)", () => {
  it("compra de outra organização apontando pedido desta, e item de outra organização apontando item desta", async () => {
    const p = await pedido([{ qtd: "5" }]);
    const outra = { org: outraOrg, empresa: empresaOutraOrg, fornecedor: fornecedorOutraOrg, top: topCompraOutraOrg };
    expect((await erroDe(semGatilhos((q) => cabecalho(q, "compra", { ...outra, origem: p.id })))).constraint).toBe("fk_documentos_compra_origem");
    expect((await erroDe(semGatilhos(async (q) => {
      const c = await cabecalho(q, "compra", outra);
      return linha(q, c, { produto: produtoOutraOrg, qtd: "1", origem: p.itens[0]! }, 0, outraOrg);
    }))).constraint).toBe("fk_documentos_compra_itens_origem");
  });
});

describe("gatilho do cabeçalho: a origem (papel da aplicação)", () => {
  it("compra de um pedido aberto da mesma empresa e do mesmo fornecedor nasce com a origem", async () => {
    const p = await pedido([{ qtd: "5" }]);
    const c = await compra(p.id, [{ qtd: "5", origem: p.itens[0]! }]);
    expect((await ler(c.id)).origem_documento_id).toBe(p.id);
  });
  it("inexistente, compra no lugar de pedido e pedido de OUTRA empresa: a MESMA recusa (não revela o que existe fora do escopo)", async () => {
    const outraCompra = await compra(null, [{ qtd: "1" }]);
    const pedidoB = await pedido([{ qtd: "1" }], { empresa: B });
    const msgs = [];
    for (const origem of [randomUUID(), outraCompra.id, pedidoB.id]) msgs.push((await erroDe(compra(origem, []))).message);
    expect(msgs).toEqual([RECUSA_ORIGEM, RECUSA_ORIGEM, RECUSA_ORIGEM]);
  });
  it("outro fornecedor é recusado", async () => {
    const p = await pedido([{ qtd: "1" }]);
    expect((await erroDe(compra(p.id, [], { fornecedor: outroFornecedor }))).message).toBe("VALIDATION_ERROR: A compra gerada de um pedido é do mesmo fornecedor do pedido.");
  });
  it("pedido cancelado ou convertido não gera compra", async () => {
    const cancelado = await pedido([{ qtd: "1" }]);
    await situacao(cancelado.id, "cancelado");
    expect((await erroDe(compra(cancelado.id, []))).message).toBe("CONFLICT: O pedido de compra de origem não está aberto (situação: cancelado).");
    const convertido = await pedido([{ qtd: "1" }]);
    await situacao(convertido.id, "convertido");
    expect((await erroDe(compra(convertido.id, []))).message).toBe("CONFLICT: O pedido de compra de origem não está aberto (situação: convertido).");
  });
  it("a origem não muda depois do INSERT — nem com a compra aberta, nem para nulo, nem nascendo depois", async () => {
    const p1 = await pedido([{ qtd: "3" }]); const p2 = await pedido([{ qtd: "3" }]);
    const c = await compra(p1.id, [{ qtd: "1", origem: p1.itens[0]! }]);
    const semOrigem = await compra(null, [{ qtd: "1" }]);
    const muda = (id: string, origem: string | null) => naApp((tx) => tx.query("update erp.documentos_compra set origem_documento_id=$2 where id=$1", [id, origem]));
    for (const [id, origem] of [[c.id, p2.id], [c.id, null], [semOrigem.id, p1.id]] as [string, string | null][]) {
      expect((await erroDe(muda(id, origem))).message).toBe("VALIDATION_ERROR: O pedido de origem da compra não muda depois do lançamento.");
    }
    expect((await ler(c.id)).origem_documento_id).toBe(p1.id);
  });
  it("o fornecedor fica preso à ligação, dos dois lados; pedido sem compra ainda troca de fornecedor (contraprova)", async () => {
    const p = await pedido([{ qtd: "3" }]);
    const c = await compra(p.id, [{ qtd: "1", origem: p.itens[0]! }]);
    const troca = (id: string) => naApp((tx) => tx.query("update erp.documentos_compra set fornecedor_id=$2 where id=$1", [id, outroFornecedor]));
    expect((await erroDe(troca(c.id))).message).toBe("VALIDATION_ERROR: O fornecedor da compra gerada de um pedido é o do pedido; ele não muda.");
    expect((await erroDe(troca(p.id))).message).toBe("VALIDATION_ERROR: O fornecedor do pedido de compra não muda depois que o pedido gerou compra.");
    const livre = await pedido([{ qtd: "3" }]);
    await expect(troca(livre.id)).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("gatilho da origem nos itens (papel da aplicação)", () => {
  it("compra COM origem liga todo item; compra SEM origem não liga nenhum", async () => {
    const p = await pedido([{ qtd: "5" }]);
    expect((await erroDe(compra(p.id, [{ qtd: "1", origem: null }]))).message).toBe("VALIDATION_ERROR: A compra gerada de um pedido liga todo item a um item do pedido.");
    expect((await erroDe(compra(null, [{ qtd: "1", origem: p.itens[0]! }]))).message).toBe("VALIDATION_ERROR: Só a compra gerada de um pedido liga item a item de pedido.");
    // Uma linha boa e uma sem origem na MESMA compra: a transação inteira cai.
    expect((await erroDe(compra(p.id, [{ qtd: "1", origem: p.itens[0]! }, { produto: produtoY, qtd: "1", origem: null }]))).message).toMatch(/liga todo item/);
    await expect(compra(null, [{ qtd: "1" }])).resolves.toBeTruthy();
  });
  it("o item de origem é do pedido que o cabeçalho cita, e do mesmo produto", async () => {
    const p = await pedido([{ qtd: "5" }, { produto: produtoY, qtd: "5" }]);
    const outro = await pedido([{ qtd: "5" }]);
    expect((await erroDe(compra(p.id, [{ qtd: "1", origem: outro.itens[0]! }]))).message).toBe("VALIDATION_ERROR: O item de origem não pertence ao pedido de origem desta compra.");
    expect((await erroDe(compra(p.id, [{ qtd: "1", origem: randomUUID() }]))).message).toBe("VALIDATION_ERROR: O item de origem não pertence ao pedido de origem desta compra.");
    // item de uma COMPRA (não do pedido) também não serve de origem
    const c = await compra(p.id, [{ qtd: "1", origem: p.itens[0]! }]);
    expect((await erroDe(compra(p.id, [{ qtd: "1", origem: c.itens[0]! }]))).message).toMatch(/não pertence ao pedido de origem/);
    expect((await erroDe(compra(p.id, [{ produto: produtoY, qtd: "1", origem: p.itens[0]! }]))).message).toBe("VALIDATION_ERROR: O produto do item da compra difere do produto do item do pedido.");
    await expect(compra(p.id, [{ produto: produtoY, qtd: "1", origem: p.itens[1]! }])).resolves.toBeTruthy();
  });
  it("soma ≤ quantidade: dentro passa, acima é recusada, no limite passa, com saldo zero nada passa", async () => {
    const p = await pedido([{ qtd: "10" }]);
    const o = p.itens[0]!;
    await compra(p.id, [{ qtd: "4", origem: o }]);
    expect((await erroDe(compra(p.id, [{ qtd: "7", origem: o }]))).message).toBe("VALIDATION_ERROR: A quantidade passa do saldo do item do pedido de compra.");
    await compra(p.id, [{ qtd: "6", origem: o }]);                                   // 4 + 6 = 10: no limite
    expect((await erroDe(compra(p.id, [{ qtd: "0.0001", origem: o }]))).message).toMatch(/passa do saldo/);
  });
  it("duas linhas da MESMA compra sobre o mesmo item somam entre si", async () => {
    const p = await pedido([{ qtd: "5" }]);
    expect((await erroDe(compra(p.id, [{ qtd: "3", origem: p.itens[0]! }, { qtd: "3", origem: p.itens[0]! }]))).message).toMatch(/passa do saldo/);
    await expect(compra(p.id, [{ qtd: "3", origem: p.itens[0]! }, { qtd: "2", origem: p.itens[0]! }])).resolves.toBeTruthy();
  });
  it("compra cancelada devolve o saldo — aberta ou confirmada", async () => {
    const p = await pedido([{ qtd: "10" }]);
    const o = p.itens[0]!;
    const aberta = await compra(p.id, [{ qtd: "6", origem: o }]);
    const confirmada = await compra(p.id, [{ qtd: "4", origem: o }]);
    await situacao(confirmada.id, "confirmado");
    expect((await erroDe(compra(p.id, [{ qtd: "1", origem: o }]))).message).toMatch(/passa do saldo/);
    await situacao(aberta.id, "cancelado");
    await compra(p.id, [{ qtd: "6", origem: o }]);                                   // a aberta cancelada devolveu 6
    await situacao(confirmada.id, "cancelado");
    await compra(p.id, [{ qtd: "4", origem: o }]);                                   // a confirmada cancelada devolveu 4
    expect((await erroDe(compra(p.id, [{ qtd: "0.0001", origem: o }]))).message).toMatch(/passa do saldo/);
  });
  it("UPDATE de quantidade também passa pelo gatilho", async () => {
    const p = await pedido([{ qtd: "3" }]);
    const c = await compra(p.id, [{ qtd: "2", origem: p.itens[0]! }]);
    const qtd = (q: string) => naApp((tx) => tx.query("update erp.documentos_compra_itens set quantidade=$2 where id=$1", [c.itens[0]!, q]));
    expect((await erroDe(qtd("4"))).message).toMatch(/passa do saldo/);
    await expect(qtd("3")).resolves.toMatchObject({ rowCount: 1 });
    // e tirar a origem da linha de uma compra com origem é recusado
    expect((await erroDe(naApp((tx) => tx.query("update erp.documentos_compra_itens set origem_item_id=null where id=$1", [c.itens[0]!])))).message).toMatch(/liga todo item/);
  });
  it("pedido que deixou de estar aberto não recebe mais linha, nem na compra aberta que já tinha", async () => {
    const p = await pedido([{ qtd: "10" }]);
    const c = await compra(p.id, [{ qtd: "4", origem: p.itens[0]! }]);
    await encerrar(p.id);
    expect((await erroDe(maisUmItem(c.id, { qtd: "1", origem: p.itens[0]! }))).message).toBe("CONFLICT: O pedido de compra de origem não está aberto (situação: convertido).");
  });
  it("do lado do pedido: o item não fica abaixo do recebido, nem troca de produto recebido", async () => {
    const p = await pedido([{ qtd: "10" }, { qtd: "5" }]);
    await compra(p.id, [{ qtd: "6", origem: p.itens[0]! }]);
    const upd = (id: string, set: string, v: string) => naApp((tx) => tx.query(`update erp.documentos_compra_itens set ${set}=$2 where id=$1`, [id, v]));
    expect((await erroDe(upd(p.itens[0]!, "quantidade", "5"))).message).toBe("VALIDATION_ERROR: A quantidade do item do pedido de compra não fica abaixo do que já foi recebido.");
    await expect(upd(p.itens[0]!, "quantidade", "6")).resolves.toMatchObject({ rowCount: 1 });
    expect((await erroDe(upd(p.itens[0]!, "produto_id", produtoY))).message).toBe("VALIDATION_ERROR: O item do pedido de compra já recebido não troca de produto.");
    await expect(upd(p.itens[1]!, "produto_id", produtoY)).resolves.toMatchObject({ rowCount: 1 });   // sem recebimento, troca
  });
  it("concorrência: duas compras simultâneas, cada uma dentro do saldo e juntas acima — a segunda espera a trava do item e cai", async () => {
    for (const commitDaPrimeira of [true, false]) {
      const p = await pedido([{ qtd: "10" }]);
      const o = p.itens[0]!;
      const T1 = await abrir(); const T2 = await abrir();
      try {
        const c1 = await cabecalho(T1.c, "compra", { origem: p.id });
        await linha(T1.c, c1, { qtd: "6", origem: o });
        const c2 = await cabecalho(T2.c, "compra", { origem: p.id });              // FOR SHARE no pedido: não conflita
        const segunda = linha(T2.c, c2, { qtd: "6", origem: o }).then(() => null, (e: Error) => e);
        await esperaPor(T2.pid, T1.pid);                                           // parada no FOR UPDATE do item de origem
        await T1.c.query(commitDaPrimeira ? "commit" : "rollback");
        const erro = await segunda;
        if (commitDaPrimeira) {
          expect(erro?.message, "a soma tirou foto DEPOIS da espera").toBe("VALIDATION_ERROR: A quantidade passa do saldo do item do pedido de compra.");
          await T2.c.query("rollback");
        } else {
          expect(erro, "PREMISSA: sem a primeira comitada, a mesma segunda passa").toBeNull();
          await T2.c.query("commit");
        }
      } finally {
        await T1.c.query("rollback").catch(() => {}); await T2.c.query("rollback").catch(() => {});
        T1.c.release(); T2.c.release();
      }
      const ligado = (await db.query<{ s: string }>(
        "select coalesce(sum(i.quantidade),0)::text s from erp.documentos_compra_itens i join erp.documentos_compra d on d.id=i.documento_id where i.origem_item_id=$1 and d.situacao<>'cancelado'", [o])).rows[0]!.s;
      expect(ligado).toBe("6.0000");
    }
  });
});

describe("gatilho de transição — as transições novas do pedido", () => {
  it("pedido aberto → convertido passa; convertido → aberto (a reabertura) passa sem saldo encerrado", async () => {
    const p = await pedido([{ qtd: "1" }]);
    await situacao(p.id, "convertido");
    expect((await ler(p.id)).situacao).toBe("convertido");
    await situacao(p.id, "aberto");
    expect((await ler(p.id)).situacao).toBe("aberto");
  });
  it("com saldo encerrado o pedido convertido NÃO reabre", async () => {
    const p = await pedido([{ qtd: "1" }]);
    await encerrar(p.id);
    expect((await erroDe(situacao(p.id, "aberto"))).message).toBe("CONFLICT: O saldo deste pedido de compra foi encerrado; ele não reabre.");
  });
  it("convertido → cancelado e convertido → confirmado são recusados", async () => {
    const p = await pedido([{ qtd: "1" }]);
    await situacao(p.id, "convertido");
    expect((await erroDe(situacao(p.id, "cancelado"))).message).toBe("CONFLICT: Pedido de compra convertido não é cancelado; cancele as compras geradas dele.");
    expect((await erroDe(situacao(p.id, "confirmado"))).message).toMatch(/^CONFLICT: /);
    expect((await ler(p.id)).situacao).toBe("convertido");
  });
  it("compra nunca vira convertido (nem aberta, nem confirmada); pedido nunca é confirmado", async () => {
    const c = await compra(null, [{ qtd: "1" }]);
    expect((await erroDe(situacao(c.id, "convertido"))).message).toBe("CONFLICT: Só o pedido de compra vira convertido; a compra se confirma.");
    await situacao(c.id, "confirmado");
    expect((await erroDe(situacao(c.id, "convertido"))).message).toBe("CONFLICT: Transição de situação inválida no documento de compra (confirmado para convertido).");
    const p = await pedido([{ qtd: "1" }]);
    expect((await erroDe(situacao(p.id, "confirmado"))).message).toBe("CONFLICT: Pedido de compra não é confirmado.");
  });
  it("pedido com compra ligada NÃO cancelada (aberta ou confirmada) não se cancela; com todas canceladas, cancela", async () => {
    const p = await pedido([{ qtd: "10" }]);
    const c1 = await compra(p.id, [{ qtd: "2", origem: p.itens[0]! }]);
    const c2 = await compra(p.id, [{ qtd: "2", origem: p.itens[0]! }]);
    await situacao(c2.id, "confirmado");
    const RECUSA = "CONFLICT: Este pedido tem compras: cancele-as ou encerre o saldo.";
    expect((await erroDe(situacao(p.id, "cancelado"))).message).toBe(RECUSA);
    await situacao(c1.id, "cancelado");
    expect((await erroDe(situacao(p.id, "cancelado"))).message, "a confirmada ainda segura").toBe(RECUSA);
    await situacao(c2.id, "cancelado");
    await expect(situacao(p.id, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("encerramento do saldo: só na passagem aberto → convertido", () => {
  it("gravado na mesma mudança aberto → convertido (papel da aplicação), com quem e por quê", async () => {
    const p = await pedido([{ qtd: "10" }]);
    await compra(p.id, [{ qtd: "4", origem: p.itens[0]! }]);
    const r = await naApp((tx) => tx.query(
      "update erp.documentos_compra set situacao='convertido', saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo='Saldo cancelado' where id=$1 and situacao='aberto'",
      [p.id, demo.adminUserId]));
    expect(r.rowCount).toBe(1);
    const l = (await db.query<{ situacao: string; por: string; motivo: string; em: boolean }>(
      "select situacao, saldo_encerrado_por por, saldo_encerrado_motivo motivo, saldo_encerrado_em is not null em from erp.documentos_compra where id=$1", [p.id])).rows[0];
    expect(l).toEqual({ situacao: "convertido", por: demo.adminUserId, motivo: "Saldo cancelado", em: true });
  });
  it("gravar o encerramento sem a transição, ou mexer nele depois, é recusado", async () => {
    const SO_NA_PASSAGEM = "CONFLICT: O saldo do pedido de compra só se encerra na passagem de aberto ou finalizado para convertido.";
    const set = (id: string, sql: string, p: unknown[] = []) => db.query(`update erp.documentos_compra set ${sql} where id=$1`, [id, ...p]);
    const TODOS = "saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo='x'";
    const aberto = await pedido([{ qtd: "1" }]);
    expect((await erroDe(set(aberto.id, TODOS, [demo.adminUserId]))).message, "aberto, sem a transição").toBe(SO_NA_PASSAGEM);
    const convertido = await pedido([{ qtd: "1" }]);
    await situacao(convertido.id, "convertido");
    expect((await erroDe(set(convertido.id, TODOS, [demo.adminUserId]))).message, "convertido antes, sem encerramento").toBe(SO_NA_PASSAGEM);
    const encerrado = await pedido([{ qtd: "1" }]);
    await encerrar(encerrado.id);
    expect((await erroDe(set(encerrado.id, "saldo_encerrado_motivo='outro'"))).message, "trocar o motivo").toBe(SO_NA_PASSAGEM);
    expect((await erroDe(set(encerrado.id, "saldo_encerrado_em=null, saldo_encerrado_por=null, saldo_encerrado_motivo=null, situacao='aberto'"))).message, "apagar para reabrir")
      .toBe(SO_NA_PASSAGEM);
    expect((await ler(encerrado.id)).saldo_encerrado_motivo).toBe("Fornecedor não entrega o resto");
    // na compra, junto com a confirmação: recusado pelo gatilho antes do CHECK
    const c = await compra(null, [{ qtd: "1" }]);
    expect((await erroDe(set(c.id, "situacao='confirmado', saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo='x'", [demo.adminUserId]))).message).toBe(SO_NA_PASSAGEM);
  });
});

describe("congelamento da COMPRAS-01 vale para o convertido", () => {
  it("pedido convertido: o cabeçalho não muda e item não entra; a reabertura muda só a situação", async () => {
    const p = await pedido([{ qtd: "2" }]);
    await situacao(p.id, "convertido");
    expect((await erroDe(db.query("update erp.documentos_compra set observacao='x' where id=$1", [p.id]))).message)
      .toBe("CONFLICT: O documento de compra está convertido; só a situação muda.");
    expect((await erroDe(maisUmItem(p.id, { qtd: "1" }))).message).toMatch(/^CONFLICT: Os itens só mudam com o documento de compra aberto \(situação: convertido\)/);
    expect((await erroDe(db.query("update erp.documentos_compra set situacao='aberto', observacao='x' where id=$1", [p.id]))).message)
      .toBe("CONFLICT: O documento de compra está convertido; só a situação muda.");
    await expect(situacao(p.id, "aberto")).resolves.toMatchObject({ rowCount: 1 });
  });
});
