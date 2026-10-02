import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0044 (OPERACOES-01 F6a, decisão 283), PROVADA CONTRA O BANCO — SOBRE ACERVO, COMO O RUNNER APLICA.
 *
 * O que ela promete:
 *   · o PEDIDO de compra ganha 'finalizado' (a confirmação do pedido), com quem e quando gravados SÓ na passagem
 *     aberto → finalizado; com a TOP exigindo aprovação, finalizar exige a decisão vigente aprovada que cubra o valor e
 *     a versão (guarda nova; a conferência da decisão passa a aceitar o pedido) (B1, B2);
 *   · o pedido FINALIZADO é recebido como o aberto (compra com origem nele), vira convertido, reabre na situação de
 *     antes de converter, encerra o saldo e se cancela sem compra viva (B3, B4);
 *   · "aprovado para orçamento": quem e quando, uma vez, com o pedido aberto, só no pedido (B5);
 *   · o ORÇAMENTO de compra: espécie de erp.documentos_compra com vínculo PRÓPRIO ao pedido (nunca a origem), só de
 *     pedido aberto, aprovado para orçamento e da mesma empresa; um vivo por fornecedor; itens com o produto e a
 *     quantidade do item do pedido; não consome saldo nem prende o fornecedor do pedido; aberto → escolhido (um por
 *     pedido) / não escolhido / cancelado (B6, B7);
 *   · a família compras.orcamento no CHECK de layouts (B8).
 *
 * Banco NOVO esconde a prova: sem documento gravado, "nenhuma linha muda" seria verdade sobre conjunto vazio. Este
 * arquivo sobe o banco até a migration anterior à 0044, grava ACERVO pelo caminho de antes (pedido aberto com compra
 * parcial, pedido convertido, compra confirmada, compra com decisão aprovada, layout de compras.pedido) e só então
 * aplica a 0044 como o runner aplica (uma transação + ledger), provando antes as recusas dela — a trava (2026,78), o
 * lock_timeout de 2s e CADA pré-condição quebrada numa transação desfeita, com a SUA mensagem — e depois a reaplicação
 * recusada e as pós-condições (só de OBJETOS), cada uma quebrada com a sua mensagem (U1 a U3).
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação — organização, usuário e o módulo compras: o caminho que a API percorre). Todo
 * comportamento (B1 a B8) roda pelo `app`.
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let fornecedor1: string; let fornecedor2: string; let fornecedor3: string;
let produtoX: string; let produtoY: string;
let usuarioEscopoA: string;

const ALVO = "0044_pedido_finalizado_e_orcamento_de_compra.sql";
const M = "OPERACOES-01 F6a: ";

interface Top { top: string; versao: string }
interface Doc { id: string; itens: string[] }
interface Aprovacao { politica: string; valorMinimo: string | null }
const SEMPRE: Aprovacao = { politica: "sempre", valorMinimo: null };
const POR_VALOR: Aprovacao = { politica: "por_valor", valorMinimo: "1500.00" };

/** As seções de hoje no neutro (o CHECK de forma da 0022 exige as cinco); só a aprovação e o formato variam. */
const SECOES = {
  geral: { confirmacao: "manual", exigeParceiro: false, exigeCentroResultado: false, exigeObservacao: false, alteracaoAposConfirmacao: "bloqueada", documentoSemItens: "proibido" },
  estoque: { atualizacao: "nenhuma", momento: "confirmacao", exigeArmazem: false, saldoNegativo: "bloquear" },
  financeiro: { atualizacao: "nenhuma", modo: "incluir", momento: "confirmacao", exigeFormaPagamento: false, exigeVencimento: false, exigeCentroResultado: false },
  fiscal: { habilitado: false, exigeDocumentoFiscal: false, exigeNaturezaOperacao: false, exigeRegraTributaria: false, calculoTributario: "nao_aplicar" }
};
function configuracao(versaoSchema: number, aprovacao: Aprovacao): Record<string, unknown> {
  return {
    versaoSchema, ...SECOES, aprovacao: { ...aprovacao, momento: "antes_da_confirmacao" },
    ...(versaoSchema >= 2 ? { execucao: { estoque: "legado", financeiro: "legado" } } : {})
  };
}

type NomeTop = "pedido1" | "pedido4Sempre" | "pedido4Valor" | "pedido3Sempre" | "compra1" | "compra4Sempre" | "orcamento1";
const tops = {} as Record<NomeTop, Top>;

let seq = 0;
const id1 = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;

/** TOP e versão 1 (na MESMA transação: a FK da versão atual é adiada até o commit). Sem `cfg`, a configuração padrão (formato 1). */
async function criarTop(codigoBase: string, cfg?: Record<string, unknown>): Promise<Top> {
  seq += 1;
  return withTx(db, { orgId: demo.orgId, userId: null }, async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id",
      [demo.orgId, `F6A${seq}`, codigoBase])).rows[0]!.id;
    const versao = cfg
      ? (await tx.query<{ id: string }>(
        `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
         values ($1,$2,1,$3,$4::jsonb,$5) returning id`, [demo.orgId, top, `TOP F6a ${codigoBase} ${seq}`, JSON.stringify(cfg), cfg.versaoSchema])).rows[0]!.id
      : (await tx.query<{ id: string }>("insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,1,$3) returning id",
        [demo.orgId, top, `TOP F6a ${codigoBase} ${seq}`])).rows[0]!.id;
    return { top, versao };
  });
}

type Especie = "pedido" | "compra" | "orcamento";
interface Cab { top?: Top; empresa?: string; fornecedor?: string; valor?: string; extra?: Record<string, unknown> }
const TOP_PADRAO: Record<Especie, NomeTop> = { pedido: "pedido1", compra: "compra1", orcamento: "orcamento1" };

/** INSERT do cabeçalho por `q` (só as colunas pedidas: antes da 0044 as colunas novas nem existem). */
async function inserirCabecalho(q: Queryable, especie: Especie, o: Cab = {}): Promise<string> {
  seq += 1;
  const top = o.top ?? tops[TOP_PADRAO[especie]];
  const valor = o.valor ?? "0.00";
  // valor_total = valor_itens (+ frete + outras − desconto, zerados): o CHECK do total conferido da 0036.
  const v: Record<string, unknown> = {
    organization_id: demo.orgId, empresa_id: o.empresa ?? A, especie, codigo: `F6A-${seq}`, tipo_operacao_id: top.top, tipo_operacao_versao_id: top.versao,
    fornecedor_id: o.fornecedor ?? fornecedor1, data_documento: "2026-10-01", valor_itens: valor, valor_total: valor, ...o.extra
  };
  const cols = Object.keys(v);
  return (await q.query<{ id: string }>(
    `insert into erp.documentos_compra (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(v))).rows[0]!.id;
}
interface Linha { produto?: string; qtd?: string; unitario?: string; origem?: string | null; orcado?: string | null; lote?: string | null; validade?: string | null }
async function inserirItem(q: Queryable, documento: string, l: Linha = {}, posicao = 0): Promise<string> {
  const v: Record<string, unknown> = {
    organization_id: demo.orgId, documento_id: documento, produto_id: l.produto ?? produtoX, quantidade: l.qtd ?? "1",
    valor_unitario: l.unitario ?? "10", valor_total: "0", posicao,
    ...(l.origem !== undefined ? { origem_item_id: l.origem } : {}),
    ...(l.orcado !== undefined ? { item_pedido_orcado_id: l.orcado } : {}),
    ...(l.lote !== undefined ? { lote: l.lote } : {}), ...(l.validade !== undefined ? { validade: l.validade } : {})
  };
  const cols = Object.keys(v);
  return (await q.query<{ id: string }>(
    `insert into erp.documentos_compra_itens (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(v))).rows[0]!.id;
}

const ctx = (userId: string = demo.adminUserId): TenantContext => ({ orgId: demo.orgId, userId, modulo: "compras" });
const naApp = <T>(fn: (tx: Tx) => Promise<T>, c: TenantContext = ctx()) => withTx(app, c, fn);

/** Documento de compra pelo papel da aplicação: cabeçalho e itens na MESMA transação, como a API grava. */
const documento = (especie: Especie, linhas: Linha[], o: Cab = {}): Promise<Doc> => naApp(async (tx) => {
  const id = await inserirCabecalho(tx, especie, o);
  const itens: string[] = [];
  for (const [i, l] of linhas.entries()) itens.push(await inserirItem(tx, id, l, i));
  return { id, itens };
});
const pedido = (linhas: Linha[], o: Cab = {}) => documento("pedido", linhas, o);
const compraDe = (origem: string | null, linhas: Linha[], o: Cab = {}) =>
  documento("compra", linhas, { ...o, extra: { ...o.extra, ...(origem ? { origem_documento_id: origem } : {}) } });
/** Orçamento do pedido `p` (fornecedor 2 por padrão), com uma linha por item do pedido (mesmo produto e quantidade) ou as linhas dadas. */
async function orcamento(p: Doc, o: Cab & { linhas?: Linha[] } = {}): Promise<Doc> {
  const doPedido = (await db.query<{ id: string; produto_id: string; quantidade: string }>(
    "select id, produto_id, quantidade from erp.documentos_compra_itens where documento_id=$1 order by posicao", [p.id])).rows;
  const linhas = o.linhas ?? doPedido.map((i) => ({ produto: i.produto_id, qtd: i.quantidade, orcado: i.id, unitario: "9.5" }));
  return documento("orcamento", linhas, { ...o, fornecedor: o.fornecedor ?? fornecedor2, extra: { pedido_orcado_id: p.id, ...o.extra } });
}

/** UPDATE do cabeçalho pelo papel da aplicação (a resposta traz o ROW COUNT). */
const upd = (id: string, set: string, p: unknown[] = [], c: TenantContext = ctx()) =>
  naApp((tx) => tx.query(`update erp.documentos_compra set ${set} where id=$1`, [id, ...p]), c);
const situacao = (id: string, s: string) => upd(id, "situacao=$2", [s]);
const finalizar = (id: string) => upd(id, "situacao='finalizado', finalizado_em=now(), finalizado_por=$2", [demo.adminUserId]);
const aprovarParaOrcamento = (id: string) => upd(id, "aprovado_orcamento_em=now(), aprovado_orcamento_por=$2", [demo.adminUserId]);
const encerrarSaldo = (id: string) => upd(id, "situacao='convertido', saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo='Fornecedor não entrega o resto'", [demo.adminUserId]);
const updItem = (id: string, set: string, p: unknown[] = []) =>
  naApp((tx) => tx.query(`update erp.documentos_compra_itens set ${set} where id=$1`, [id, ...p]));
/** A decisão como a API grava: papel da aplicação, organização/usuário/módulo da transação; o gatilho atribui o resto. */
const decidir = (documentoId: string, decisao: "aprovado" | "reprovado" = "aprovado") => naApp((tx) => tx.query<{ valor: string; versao: string; por: string }>(
  `insert into erp.aprovacoes_compra (organization_id, empresa_id, documento_id, decisao, observacao) values ($1,$2,$3,$4,$5)
   returning valor_documento valor, tipo_operacao_versao_id versao, decidido_por por`,
  [demo.orgId, A, documentoId, decisao, decisao === "reprovado" ? "Preço acima da tabela" : null]));

interface Estado { situacao: string; finalizado: boolean; finalizadoPor: string | null; aprovadoOrcamento: boolean; fornecedor: string }
const ler = async (id: string): Promise<Estado> => (await db.query<Estado>(
  `select situacao, finalizado_em is not null finalizado, finalizado_por "finalizadoPor", aprovado_orcamento_em is not null "aprovadoOrcamento", fornecedor_id fornecedor
     from erp.documentos_compra where id=$1`, [id])).rows[0]!;

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
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}

const sqlDaAlvo = () => listMigrations().find((x) => x.name === ALVO)!.sql;
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
/** Roda `sql` (a 0044, ou um trecho dela) numa transação DESFEITA no fim (depois de `antes`), e devolve o erro — ou falha, se aplicou. */
async function recusaDe(sql: string, antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a recusa, e o SQL aplicou");
}
const recusaDa0044 = (antes?: (c: Tx) => Promise<unknown>) => recusaDe(sqlDaAlvo(), antes);
const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
const COLUNAS_NOVAS = ["finalizado_em", "finalizado_por", "aprovado_orcamento_em", "aprovado_orcamento_por", "pedido_orcado_id", "prazo_entrega_dias", "validade_orcamento"];
const colunasNovasQueExistem = async () => (await db.query<{ c: string }>(
  `select table_name || '.' || column_name c from information_schema.columns
    where table_schema='erp' and ((table_name='documentos_compra' and column_name::text = any($1::text[])) or (table_name='documentos_compra_itens' and column_name='item_pedido_orcado_id'))
    order by 1`, [COLUNAS_NOVAS])).rows.map((r) => r.c);
const funcoesDe = async () => (await db.query<{ fn: string }>(
  `select fn from (select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' fn
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname='erp' and p.prosecdef and (p.proname like 'documentos\\_compra%' or p.proname like 'aprovacoes\\_compra%')) x
    order by fn collate "C"`)).rows.map((r) => r.fn);
const SEIS_DE_ANTES = ["erp.aprovacoes_compra_conferir()", "erp.documentos_compra_aprovacao_guarda()", "erp.documentos_compra_conferir_v2()",
  "erp.documentos_compra_item_origem_guarda()", "erp.documentos_compra_itens_documento_aberto()", "erp.documentos_compra_transicao_v2()"];
const OITO_DEPOIS = ["erp.aprovacoes_compra_conferir_v2()", "erp.documentos_compra_aprovacao_guarda()", "erp.documentos_compra_conferir_v3()",
  "erp.documentos_compra_finalizacao_guarda()", "erp.documentos_compra_item_orcamento_guarda()", "erp.documentos_compra_item_origem_guarda_v2()",
  "erp.documentos_compra_itens_documento_aberto()", "erp.documentos_compra_transicao_v3()"];
const SEIS_NOVAS = OITO_DEPOIS.filter((f) => !SEIS_DE_ANTES.includes(f));
const SEIS_FAMILIAS = ["compras.compra", "compras.orcamento", "compras.pedido", "vendas.orcamento", "vendas.pedido", "vendas.venda"];
const familiasDoCheck = async () => {
  const def = (await db.query<{ def: string }>(
    "select pg_get_constraintdef(oid) def from pg_constraint where conrelid='erp.layouts_documento'::regclass and conname='chk_layouts_documento_familia'")).rows[0]?.def ?? "";
  return [...def.matchAll(/'([^']*)'/g)].map((m) => m[1]!).sort();
};

/** O ACERVO, linha a linha, sem as colunas novas (antes da 0044 elas nem existem; depois, são nulas — conferido à parte). */
async function retrato() {
  const linhas = async (sql: string) => (await db.query<{ l: unknown }>(sql)).rows.map((r) => r.l);
  return {
    documentos: await linhas(`select to_jsonb(d) - '{${COLUNAS_NOVAS.join(",")}}'::text[] l from erp.documentos_compra d order by id`),
    itens: await linhas("select to_jsonb(i) - 'item_pedido_orcado_id' l from erp.documentos_compra_itens i order by id"),
    aprovacoes: await linhas("select to_jsonb(a) l from erp.aprovacoes_compra a order by id"),
    layouts: await linhas("select to_jsonb(l) l from erp.layouts_documento l order by id"),
    ligacoes: await linhas("select to_jsonb(x) l from erp.layout_documento_tops x order by tipo_operacao_id")
  };
}
let antes: Awaited<ReturnType<typeof retrato>>;
const acervo = {} as { pedidoAberto: Doc; compraParcial: Doc; pedidoConvertido: Doc; compraTotal: Doc; compraConfirmada: Doc; compraAprovada: Doc; layout: string };

/** Usuário novo, membro ativo (não proprietário), com escopo SELECIONADAS = `empresas` no módulo compras e nada nos outros. */
async function membroSelecionadas(rotulo: string, empresas: string[]): Promise<string> {
  const usuario = await id1("insert into erp.users (email, name, password_hash) values ($1,$2,'x') returning id", [`${rotulo}@demo.local`, `F6a ${rotulo}`]);
  const membro = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [demo.orgId, usuario]);
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'compras','selecionadas')", [demo.orgId, membro]);
  for (const empresa of empresas) {
    await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'compras','selecionadas',$3)", [demo.orgId, membro, empresa]);
  }
  return usuario;
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < ALVO)) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });

  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  const fornecedor = (n: number) => id1("insert into erp.people (organization_id, code, name, is_provider) values ($1,$2,$3,true) returning id",
    [demo.orgId, `F6A-F${n}`, `[TEST] Fornecedor F6a ${n}`]);
  fornecedor1 = await fornecedor(1); fornecedor2 = await fornecedor(2); fornecedor3 = await fornecedor(3);
  const produtos = (await db.query<{ id: string }>("select id from erp.products where organization_id=$1 and controle_lote='nenhum' order by code limit 2", [demo.orgId])).rows;
  produtoX = produtos[0]!.id; produtoY = produtos[1]!.id;
  tops.pedido1 = await criarTop("compras.pedido");
  tops.pedido4Sempre = await criarTop("compras.pedido", configuracao(4, SEMPRE));
  tops.pedido4Valor = await criarTop("compras.pedido", configuracao(4, POR_VALOR));
  tops.pedido3Sempre = await criarTop("compras.pedido", configuracao(3, SEMPRE));
  tops.compra1 = await criarTop("compras.compra");
  tops.compra4Sempre = await criarTop("compras.compra", configuracao(4, SEMPRE));
  // A TOP do orçamento nasce antes da 0044 (codigo_base é livre); documento de orçamento, só depois dela.
  tops.orcamento1 = await criarTop("compras.orcamento");
  usuarioEscopoA = await membroSelecionadas("f6a-a", [A]);

  // O ACERVO, pelo caminho de antes (papel da aplicação, gatilhos da 0037/0041).
  acervo.pedidoAberto = await pedido([{ qtd: "10" }]);
  acervo.compraParcial = await compraDe(acervo.pedidoAberto.id, [{ qtd: "4", origem: acervo.pedidoAberto.itens[0]! }]);
  acervo.pedidoConvertido = await pedido([{ qtd: "2" }]);
  acervo.compraTotal = await compraDe(acervo.pedidoConvertido.id, [{ qtd: "2", origem: acervo.pedidoConvertido.itens[0]! }]);
  await situacao(acervo.compraTotal.id, "confirmado");
  await situacao(acervo.pedidoConvertido.id, "convertido");
  acervo.compraConfirmada = await compraDe(null, [{ qtd: "1" }]);
  await situacao(acervo.compraConfirmada.id, "confirmado");
  acervo.compraAprovada = await compraDe(null, [{ qtd: "1" }], { top: tops.compra4Sempre, valor: "100.00" });
  await decidir(acervo.compraAprovada.id);
  acervo.layout = await naApp(async (tx) => {
    const l = (await tx.query<{ id: string }>(
      "insert into erp.layouts_documento (organization_id, code, nome, familia, padrao, estrutura) values ($1,'F6A-L0','Layout do pedido de compra','compras.pedido',false,'{}') returning id",
      [demo.orgId])).rows[0]!.id;
    await tx.query("insert into erp.layout_documento_tops (organization_id, layout_id, tipo_operacao_id) values ($1,$2,$3)", [demo.orgId, l, tops.pedido1.top]);
    return l;
  });
  antes = await retrato();
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("U — a 0044 sobre o acervo, como o runner aplica", () => {
  it("U0 PREMISSA: o banco está na migration anterior à 0044 (ledger com todas as de antes, sem a 0044), sem os objetos dela, e o acervo está gravado", async () => {
    const noDisco = listMigrations().map((m) => m.name);
    const posicao = noDisco.indexOf(ALVO);
    expect(posicao, "a 0044 está no repositório, depois da 0041").toBeGreaterThan(noDisco.indexOf("0041_regras_gerais_e_aprovacao_da_top.sql"));
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger, "todas as anteriores à 0044, e só elas").toEqual({ n: posicao, ultima: noDisco[posicao - 1] });
    expect(await noLedger()).toBe(false);
    expect(await colunasNovasQueExistem()).toEqual([]);
    expect(await funcoesDe()).toEqual(SEIS_DE_ANTES);
    // Sem acervo, "nenhuma linha muda" seria verdade sobre conjunto vazio.
    expect([antes.documentos.length, antes.itens.length, antes.aprovacoes.length, antes.layouts.length, antes.ligacoes.length]).toEqual([6, 6, 1, 1, 1]);
    // Só a situação: antes da 0044, as colunas que `ler` lê nem existem.
    const situacoes = (await db.query<{ id: string; situacao: string }>("select id, situacao from erp.documentos_compra")).rows;
    const situacaoDe = (id: string) => situacoes.find((x) => x.id === id)?.situacao;
    expect([situacaoDe(acervo.pedidoAberto.id), situacaoDe(acervo.compraParcial.id), situacaoDe(acervo.pedidoConvertido.id),
      situacaoDe(acervo.compraConfirmada.id), situacaoDe(acervo.compraAprovada.id)]).toEqual(["aberto", "aberto", "convertido", "confirmado", "aberto"]);
    expect((await db.query<{ decisao: string }>("select decisao from erp.aprovacoes_compra where documento_id=$1", [acervo.compraAprovada.id])).rows)
      .toEqual([{ decisao: "aprovado" }]);
    expect(await familiasDoCheck()).toEqual(["compras.compra", "compras.pedido", "vendas.orcamento", "vendas.pedido", "vendas.venda"]);
  });

  it("U2.1 trava (2026,78) em uso por outra sessão: a 0044 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 78)");
      await expect(aplicar()).rejects.toThrow(`${M}outra transacao ja detem a trava desta migration (2026,78). Nada foi aplicado.`);
    } finally { await outra.query("select pg_advisory_unlock(2026, 78)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await colunasNovasQueExistem()).toEqual([]);
  });

  it("U2.2 lock_timeout 2s: o texto o fixa, e uma leitura aberta em erp.documentos_compra faz a 0044 desistir em ~2s, sem efeito", async () => {
    expect(sqlDaAlvo()).toContain("set local lock_timeout = '2s';");
    const leitor = await db.connect();
    try {
      await leitor.query("begin");
      await leitor.query("select 1 from erp.documentos_compra limit 1");   // AccessShare: o ALTER TABLE precisa de AccessExclusive
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await leitor.query("rollback"); leitor.release(); }
    expect(await noLedger()).toBe(false);
    expect(await colunasNovasQueExistem()).toEqual([]);
  });

  it("U2.3 reversas: cada pré-condição quebrada recusa a 0044 com a SUA mensagem, sem efeito", async () => {
    const JA = `${M}objetos da 0044 ja existem; a 0044 ja foi aplicada ou ha schema divergente.`;
    // "Já aplicada": qualquer uma das seis funções novas ou das oito colunas novas.
    for (const fn of ["documentos_compra_conferir_v3", "documentos_compra_transicao_v3", "documentos_compra_item_origem_guarda_v2",
      "documentos_compra_item_orcamento_guarda", "documentos_compra_finalizacao_guarda", "aprovacoes_compra_conferir_v2"]) {
      expect([fn, await recusaDa0044((c) => c.query(`create function erp.${fn}() returns trigger language plpgsql as 'begin return new; end'`))]).toEqual([fn, JA]);
    }
    for (const col of COLUNAS_NOVAS) {
      expect([col, await recusaDa0044((c) => c.query(`alter table erp.documentos_compra add column ${col} int`))]).toEqual([col, JA]);
    }
    expect(await recusaDa0044((c) => c.query("alter table erp.documentos_compra_itens add column item_pedido_orcado_id uuid"))).toBe(JA);
    // "Já aplicada" vem ANTES de todas: com a chave, o gatilho e o papel quebrados JUNTO, o motivo dito é o verdadeiro.
    expect(await recusaDa0044(async (c) => {
      await c.query("alter table erp.documentos_compra_itens rename constraint uq_documentos_compra_itens_tenant to uq_f6a_x");
      await c.query("alter table erp.documentos_compra disable trigger trg_documentos_compra_conferir");
      await c.query("create function erp.documentos_compra_finalizacao_guarda() returns trigger language plpgsql as 'begin return new; end'");
      await c.query("set local role erp_app");
    })).toBe(JA);

    const casos: [string, (c: Tx) => Promise<unknown>, string | RegExp][] = [
      ["papel da aplicação ausente", (c) => c.query("alter role erp_app rename to erp_app_f6a"), `${M}papel erp_app ausente (0007); os gatilhos de compras nao teriam a quem servir.`],
      ["quem aplica não atravessa RLS", (c) => c.query("set local role erp_app"),
        `${M}o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; os gatilhos nao veriam o pedido, o orcamento nem a decisao.`]
    ];
    const TABELA = `${M}tabela ausente (documentos_compra, documentos_compra_itens, aprovacoes_compra, layouts_documento ou tipos_operacao_versoes); a cadeia de migrations esta fora de ordem.`;
    for (const t of ["aprovacoes_compra", "layouts_documento", "tipos_operacao_versoes"]) {
      casos.push([`tabela ${t} ausente`, (c) => c.query(`alter table erp.${t} rename to ${t}_f6a`), TABELA]);
    }
    const CHAVE = `${M}chave (id, organization_id) ausente em erp.documentos_compra (uq_documentos_compra_tenant, 0036) ou em erp.documentos_compra_itens (uq_documentos_compra_itens_tenant, 0037); as FKs compostas do orcamento nao teriam alvo.`;
    casos.push(["chave do cabeçalho", (c) => c.query("alter table erp.documentos_compra rename constraint uq_documentos_compra_tenant to uq_f6a_x"), CHAVE]);
    casos.push(["chave dos itens", (c) => c.query("alter table erp.documentos_compra_itens rename constraint uq_documentos_compra_itens_tenant to uq_f6a_x"), CHAVE]);
    const FUNCAO = `${M}funcao ausente (conferir_v2, transicao_v2, item_origem_guarda e itens_documento_aberto de compras; aprovacoes_compra_conferir, documentos_compra_aprovacao_guarda e top_exige_aprovacao da 0041; audit_row, current_user_id, current_org_id, empresa_escrita_permitida); a cadeia de migrations esta fora de ordem.`;
    for (const fn of ["documentos_compra_conferir_v2()", "documentos_compra_transicao_v2()", "documentos_compra_item_origem_guarda()",
      "documentos_compra_itens_documento_aberto()", "aprovacoes_compra_conferir()", "documentos_compra_aprovacao_guarda()", "top_exige_aprovacao(jsonb, numeric)",
      "audit_row()", "current_user_id()", "current_org_id()", "empresa_escrita_permitida(uuid)"]) {
      casos.push([`função ${fn}`, (c) => c.query(`alter function erp.${fn} rename to f6a_renomeada`), FUNCAO]);
    }
    const GATILHOS = `${M}gatilhos de compras a trocar (conferir, transicao, itens_origem_guarda, aprovacoes_compra_conferir) ou a guarda da aprovacao ausentes, desligados ou fora das funcoes esperadas; schema divergente.`;
    casos.push(["conferência desligada", (c) => c.query("alter table erp.documentos_compra disable trigger trg_documentos_compra_conferir"), GATILHOS]);
    casos.push(["guarda da origem desligada", (c) => c.query("alter table erp.documentos_compra_itens disable trigger trg_documentos_compra_itens_origem_guarda"), GATILHOS]);
    casos.push(["guarda da aprovação da compra ausente", (c) => c.query("drop trigger trg_documentos_compra_aprovacao on erp.documentos_compra"), GATILHOS]);
    casos.push(["conferência da decisão em outra função", async (c) => {
      await c.query("drop trigger trg_aprovacoes_compra_conferir on erp.aprovacoes_compra");
      await c.query("create trigger trg_aprovacoes_compra_conferir before insert on erp.aprovacoes_compra for each row execute function erp.aprovacoes_imutavel()");
    }, GATILHOS]);
    casos.push(["transição em outra função", async (c) => {
      await c.query("drop trigger trg_documentos_compra_transicao on erp.documentos_compra");
      await c.query("create trigger trg_documentos_compra_transicao before update of situacao on erp.documentos_compra for each row execute function erp.documentos_compra_conferir_v2()");
    }, GATILHOS]);
    const GATILHO_JA = `${M}trg_documentos_compra_finalizacao ou trg_documentos_compra_itens_orcamento_guarda ja existe; a 0044 ja foi aplicada ou ha schema divergente.`;
    casos.push(["guarda da finalização já existe", (c) => c.query("create trigger trg_documentos_compra_finalizacao after update on erp.documentos_compra for each row execute function erp.set_atualizado_em()"), GATILHO_JA]);
    casos.push(["guarda do orçamento já existe", (c) => c.query("create trigger trg_documentos_compra_itens_orcamento_guarda after update on erp.documentos_compra_itens for each row execute function erp.audit_row()"), GATILHO_JA]);
    // A ENUMERAÇÃO pelo nome: uma SECURITY DEFINER de compras que ninguém conhece PARA a 0044.
    const DEFINER = `${M}funcoes SECURITY DEFINER de compras diferentes das seis esperadas (aprovacoes_compra_conferir, documentos_compra_aprovacao_guarda, conferir_v2, item_origem_guarda, itens_documento_aberto, transicao_v2): `;
    casos.push(["definer desconhecida (documento)", (c) => c.query("create function erp.documentos_compra_x() returns int language sql security definer set search_path = erp as 'select 1'"),
      `${DEFINER}{${["erp.aprovacoes_compra_conferir()", "erp.documentos_compra_aprovacao_guarda()", "erp.documentos_compra_conferir_v2()",
        "erp.documentos_compra_item_origem_guarda()", "erp.documentos_compra_itens_documento_aberto()", "erp.documentos_compra_transicao_v2()", "erp.documentos_compra_x()"].join(",")}}`]);
    casos.push(["definer desconhecida (decisão)", (c) => c.query("create function erp.aprovacoes_compra_y() returns int language sql security definer set search_path = erp as 'select 1'"),
      new RegExp(`^${DEFINER.replace(/[()]/g, "\\$&")}\\{.*erp\\.aprovacoes_compra_y\\(\\).*\\}$`)]);
    casos.push(["uma das seis deixou de ser definer", (c) => c.query("alter function erp.documentos_compra_itens_documento_aberto() security invoker"),
      `${DEFINER}{${SEIS_DE_ANTES.filter((f) => f !== "erp.documentos_compra_itens_documento_aberto()").join(",")}}`]);
    // Donos.
    casos.push(["dono de uma definer sem bypass de RLS", async (c) => {
      await c.query("create role f6a_dono_sem_bypass nologin");
      await c.query("alter function erp.documentos_compra_conferir_v2() owner to f6a_dono_sem_bypass");
    }, `${M}o dono de alguma funcao SECURITY DEFINER de compras nao atravessa RLS; os gatilhos nao veriam o pedido nem a decisao.`]);
    casos.push(["quem aplica é dono das funções, não das tabelas", async (c) => {
      await c.query("create role f6a_aplicador nologin bypassrls");
      await c.query("grant usage on schema erp to f6a_aplicador");    // enxerga o schema, como qualquer dono de objeto dele
      for (const fn of SEIS_DE_ANTES) await c.query(`alter function ${fn} owner to f6a_aplicador`);
      await c.query("set local role f6a_aplicador");
    }, `${M}o papel que aplica a migration nao e dono das funcoes SECURITY DEFINER de compras ou das tabelas documentos_compra, documentos_compra_itens, aprovacoes_compra e layouts_documento; o ALTER e o DROP seriam recusados.`]);
    // Os CHECKs de hoje: quinze, e os três refeitos exatamente como a 0036/0037 os deixou.
    casos.push(["um CHECK a mais", (c) => c.query("alter table erp.documentos_compra add constraint chk_documentos_compra_extra check (true)"),
      `${M}CHECKs de erp.documentos_compra diferentes dos quinze esperados (0036 e 0037); schema divergente.`]);
    casos.push(["espécie diferente", (c) => c.query("alter table erp.documentos_compra drop constraint chk_documentos_compra_especie, add constraint chk_documentos_compra_especie check (especie in ('pedido','compra','servico'))"),
      /^OPERACOES-01 F6a: chk_documentos_compra_especie ausente ou diferente do da 0036 \(especie in pedido, compra\): CHECK .*'servico'/]);
    casos.push(["situação diferente", (c) => c.query("alter table erp.documentos_compra drop constraint chk_documentos_compra_situacao, add constraint chk_documentos_compra_situacao check (situacao in ('aberto','confirmado','convertido','cancelado','recebido'))"),
      /^OPERACOES-01 F6a: chk_documentos_compra_situacao ausente ou diferente do da 0037 \(aberto, confirmado, convertido, cancelado\): CHECK .*'recebido'/]);
    casos.push(["situação por espécie diferente", (c) => c.query(`alter table erp.documentos_compra drop constraint chk_documentos_compra_situacao_especie,
        add constraint chk_documentos_compra_situacao_especie check ((especie = 'compra' and situacao in ('aberto','confirmado','cancelado')) or (especie = 'pedido' and situacao in ('aberto','confirmado','convertido','cancelado')))`),
      /^OPERACOES-01 F6a: chk_documentos_compra_situacao_especie ausente ou diferente do da 0037 /]);
    // A família do layout.
    const refazerLayout = (lista: string) => (c: Tx) => c.query(`alter table erp.layouts_documento drop constraint chk_layouts_documento_familia,
      add constraint chk_layouts_documento_familia check (familia in (${lista})) not valid`);
    casos.push(["CHECK de layout ausente", (c) => c.query("alter table erp.layouts_documento drop constraint chk_layouts_documento_familia"),
      `${M}chk_layouts_documento_familia ausente ou fora da coluna familia de erp.layouts_documento; schema divergente.`]);
    casos.push(["CHECK de layout sem uma das cinco", refazerLayout("'vendas.orcamento','vendas.pedido','compras.pedido','compras.compra'"),
      /^OPERACOES-01 F6a: chk_layouts_documento_familia nao aceita as cinco familias da 0038 /]);
    casos.push(["CHECK de layout já com compras.orcamento", refazerLayout("'vendas.orcamento','vendas.pedido','vendas.venda','compras.pedido','compras.compra','compras.orcamento'"),
      `${M}chk_layouts_documento_familia ja aceita compras.orcamento; a 0044 ja foi aplicada ou ha schema divergente.`]);
    casos.push(["CHECK de layout com família de outra fase", refazerLayout("'vendas.orcamento','vendas.pedido','vendas.venda','compras.pedido','compras.compra','estoque.requisicao'"),
      `${M}chk_layouts_documento_familia aceita familia que a lista desta migration nao carrega: {estoque.requisicao}`]);

    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDa0044(sabotagem)]).toEqual([nome, typeof mensagem === "string" ? mensagem : expect.stringMatching(mensagem)]);
    }
    // Contraprova da enumeração: uma função de INVOKER de compras não é da conta desta migration (não atravessa a RLS).
    await expect(recusaDa0044((c) => c.query("create function erp.documentos_compra_leitura() returns bigint language sql as 'select count(*) from erp.documentos_compra'")))
      .rejects.toThrow("esperava a recusa, e o SQL aplicou");
    // Nada ficou: o ledger, as colunas, as funções, o CHECK de layout e os papéis de ensaio são os de antes.
    expect(await noLedger()).toBe(false);
    expect(await colunasNovasQueExistem()).toEqual([]);
    expect(await funcoesDe()).toEqual(SEIS_DE_ANTES);
    expect(await familiasDoCheck()).toEqual(["compras.compra", "compras.pedido", "vendas.orcamento", "vendas.pedido", "vendas.venda"]);
    expect((await db.query("select 1 from pg_roles where rolname like 'f6a\\_%'")).rowCount).toBe(0);
    expect((await db.query("select 1 from pg_roles where rolname='erp_app'")).rowCount).toBe(1);
  });

  it("U1 aplica: ledger com a 0044 por último, acervo IDÊNTICO linha a linha, colunas novas nulas no acervo e trava liberada", async () => {
    const noDisco = listMigrations().map((m) => m.name);
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: noDisco.indexOf(ALVO) + 1, ultima: ALVO });
    expect(await retrato(), "nenhuma linha de documento, item, decisão, layout ou ligação muda").toEqual(antes);
    const novasNoAcervo = (await db.query<{ n: number; preenchidas: number }>(
      `select count(*)::int n,
              count(*) filter (where finalizado_em is not null or finalizado_por is not null or aprovado_orcamento_em is not null or aprovado_orcamento_por is not null
                                  or pedido_orcado_id is not null or prazo_entrega_dias is not null or validade_orcamento is not null)::int preenchidas
         from erp.documentos_compra`)).rows[0]!;
    expect(novasNoAcervo, "as seis linhas do acervo, nenhuma com coluna nova preenchida (sem backfill)").toEqual({ n: 6, preenchidas: 0 });
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.documentos_compra_itens where item_pedido_orcado_id is not null")).rows[0]!.n).toBe(0);
    // A trava é de transação: depois do commit, outra sessão a obtém.
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 78) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });

  it("U1b o acervo continua andando como hoje: o pedido aberto de antes recebe o resto SEM finalizar e vira convertido; a compra aprovada confirma", async () => {
    const p = acervo.pedidoAberto;
    expect((await ler(p.id)).situacao, "premissa: o pedido do acervo continua aberto, sem finalização").toBe("aberto");
    expect((await ler(p.id)).finalizado).toBe(false);
    await compraDe(p.id, [{ qtd: "6", origem: p.itens[0]! }]);
    await expect(situacao(p.id, "convertido")).resolves.toMatchObject({ rowCount: 1 });
    await expect(situacao(acervo.compraAprovada.id, "confirmado")).resolves.toMatchObject({ rowCount: 1 });
    expect([(await ler(p.id)).situacao, (await ler(acervo.compraAprovada.id)).situacao]).toEqual(["convertido", "confirmado"]);
  });

  it("U2.4 reaplicar é recusado pela pré-condição 'já aplicada', sem efeito", async () => {
    expect(await recusaDa0044()).toBe(`${M}objetos da 0044 ja existem; a 0044 ja foi aplicada ou ha schema divergente.`);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n).toBe(1);
  });

  it("U3.1 pós: colunas, FKs compostas, os vinte CHECKs e os índices, como o contrato", async () => {
    const colunas = (await db.query<{ c: string }>(
      `select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable c from information_schema.columns
        where table_schema='erp' and ((table_name='documentos_compra' and column_name::text = any($1::text[])) or (table_name='documentos_compra_itens' and column_name='item_pedido_orcado_id'))
        order by 1`, [COLUNAS_NOVAS])).rows.map((r) => r.c);
    expect(colunas).toEqual([
      "documentos_compra.aprovado_orcamento_em:timestamp with time zone:YES", "documentos_compra.aprovado_orcamento_por:uuid:YES",
      "documentos_compra.finalizado_em:timestamp with time zone:YES", "documentos_compra.finalizado_por:uuid:YES", "documentos_compra.pedido_orcado_id:uuid:YES",
      "documentos_compra.prazo_entrega_dias:integer:YES", "documentos_compra.validade_orcamento:date:YES", "documentos_compra_itens.item_pedido_orcado_id:uuid:YES"
    ]);
    // O dicionário de dados é gerado; os comentários são a documentação no banco: toda coluna nova comentada.
    const comentarios = (await db.query<{ c: string; comentado: boolean }>(
      `select a.attrelid::regclass::text || '.' || a.attname c, col_description(a.attrelid, a.attnum) is not null comentado from pg_attribute a
        where a.attrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass)
          and a.attname::text = any($1::text[] || array['item_pedido_orcado_id']) order by 1`, [COLUNAS_NOVAS])).rows;
    expect(comentarios.length, "a conta varreu as oito colunas novas").toBe(8);
    expect(comentarios.filter((x) => !x.comentado)).toEqual([]);
    const fks = (await db.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) def from pg_constraint
        where conname in ('fk_documentos_compra_pedido_orcado','fk_documentos_compra_itens_pedido_orcado','fk_documentos_compra_finalizado_por','fk_documentos_compra_aprovado_orcamento_por')
        order by conname`)).rows;
    expect(fks).toEqual([
      { conname: "fk_documentos_compra_aprovado_orcamento_por", def: "FOREIGN KEY (aprovado_orcamento_por) REFERENCES erp.users(id)" },
      { conname: "fk_documentos_compra_finalizado_por", def: "FOREIGN KEY (finalizado_por) REFERENCES erp.users(id)" },
      { conname: "fk_documentos_compra_itens_pedido_orcado", def: "FOREIGN KEY (item_pedido_orcado_id, organization_id) REFERENCES erp.documentos_compra_itens(id, organization_id)" },
      { conname: "fk_documentos_compra_pedido_orcado", def: "FOREIGN KEY (pedido_orcado_id, organization_id) REFERENCES erp.documentos_compra(id, organization_id)" }
    ]);
    const checks = (await db.query<{ conname: string; def: string; ok: boolean }>(
      `select conname, pg_get_constraintdef(oid) def, convalidated ok from pg_constraint
        where conrelid='erp.documentos_compra'::regclass and contype='c' and conname like 'chk\\_documentos\\_compra\\_%' order by conname collate "C"`)).rows;
    expect(checks.map((c) => c.conname)).toEqual([
      "chk_documentos_compra_aprovado_orcamento", "chk_documentos_compra_campos_da_compra", "chk_documentos_compra_campos_do_orcamento", "chk_documentos_compra_classificacao_par",
      "chk_documentos_compra_desconto", "chk_documentos_compra_especie", "chk_documentos_compra_finalizado", "chk_documentos_compra_frete", "chk_documentos_compra_nota",
      "chk_documentos_compra_orcamento_do_pedido", "chk_documentos_compra_origem_so_compra", "chk_documentos_compra_outras_despesas", "chk_documentos_compra_plano",
      "chk_documentos_compra_prazo_entrega", "chk_documentos_compra_saldo_encerrado", "chk_documentos_compra_situacao", "chk_documentos_compra_situacao_especie",
      "chk_documentos_compra_total_conferido", "chk_documentos_compra_valor_itens", "chk_documentos_compra_valor_total"
    ]);
    expect(checks.every((c) => c.ok), "todos validados: nenhuma linha do acervo ficou de fora").toBe(true);
    const def = Object.fromEntries(checks.map((c) => [c.conname, c.def]));
    expect(def).toMatchObject({
      chk_documentos_compra_especie: "CHECK ((especie = ANY (ARRAY['pedido'::text, 'compra'::text, 'orcamento'::text])))",
      chk_documentos_compra_situacao: "CHECK ((situacao = ANY (ARRAY['aberto'::text, 'confirmado'::text, 'convertido'::text, 'cancelado'::text, 'finalizado'::text, 'escolhido'::text, 'nao_escolhido'::text])))",
      chk_documentos_compra_situacao_especie: "CHECK ((((especie = 'compra'::text) AND (situacao = ANY (ARRAY['aberto'::text, 'confirmado'::text, 'cancelado'::text]))) OR ((especie = 'pedido'::text) AND (situacao = ANY (ARRAY['aberto'::text, 'finalizado'::text, 'convertido'::text, 'cancelado'::text]))) OR ((especie = 'orcamento'::text) AND (situacao = ANY (ARRAY['aberto'::text, 'escolhido'::text, 'nao_escolhido'::text, 'cancelado'::text])))))",
      chk_documentos_compra_finalizado: "CHECK ((((finalizado_em IS NULL) AND (finalizado_por IS NULL)) OR ((finalizado_em IS NOT NULL) AND (finalizado_por IS NOT NULL) AND (especie = 'pedido'::text) AND (situacao = ANY (ARRAY['finalizado'::text, 'convertido'::text, 'cancelado'::text])))))",
      chk_documentos_compra_aprovado_orcamento: "CHECK ((((aprovado_orcamento_em IS NULL) AND (aprovado_orcamento_por IS NULL)) OR ((aprovado_orcamento_em IS NOT NULL) AND (aprovado_orcamento_por IS NOT NULL) AND (especie = 'pedido'::text))))",
      chk_documentos_compra_orcamento_do_pedido: "CHECK (((especie = 'orcamento'::text) = (pedido_orcado_id IS NOT NULL)))",
      chk_documentos_compra_campos_do_orcamento: "CHECK (((especie = 'orcamento'::text) OR ((prazo_entrega_dias IS NULL) AND (validade_orcamento IS NULL))))",
      chk_documentos_compra_prazo_entrega: "CHECK (((prazo_entrega_dias IS NULL) OR ((prazo_entrega_dias >= 0) AND (prazo_entrega_dias <= 3650))))"
    });
    const indices = (await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname='erp'
          and indexname in ('ix_documentos_compra_pedido_orcado','ux_documentos_compra_orcamento_fornecedor','ux_documentos_compra_orcamento_escolhido',
                            'ux_documentos_compra_itens_pedido_orcado','ix_documentos_compra_itens_pedido_orcado')
        order by indexname collate "C"`)).rows.map((x) => x.indexdef);
    expect(indices).toEqual([
      "CREATE INDEX ix_documentos_compra_itens_pedido_orcado ON erp.documentos_compra_itens USING btree (item_pedido_orcado_id) WHERE (item_pedido_orcado_id IS NOT NULL)",
      "CREATE INDEX ix_documentos_compra_pedido_orcado ON erp.documentos_compra USING btree (pedido_orcado_id) WHERE (pedido_orcado_id IS NOT NULL)",
      "CREATE UNIQUE INDEX ux_documentos_compra_itens_pedido_orcado ON erp.documentos_compra_itens USING btree (documento_id, item_pedido_orcado_id) WHERE (item_pedido_orcado_id IS NOT NULL)",
      "CREATE UNIQUE INDEX ux_documentos_compra_orcamento_escolhido ON erp.documentos_compra USING btree (organization_id, pedido_orcado_id) WHERE ((especie = 'orcamento'::text) AND (situacao = 'escolhido'::text))",
      "CREATE UNIQUE INDEX ux_documentos_compra_orcamento_fornecedor ON erp.documentos_compra USING btree (organization_id, pedido_orcado_id, fornecedor_id) WHERE ((especie = 'orcamento'::text) AND (situacao <> 'cancelado'::text))"
    ]);
  });

  it("U3.2 pós: gatilhos EXATOS (definição inteira), funções antigas ausentes, as oito definer de compras e a família do layout com as seis", async () => {
    const trg = (await db.query<{ def: string }>(
      `select pg_get_triggerdef(oid) def from pg_trigger
        where tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass, 'erp.aprovacoes_compra'::regclass)
          and not tgisinternal and tgenabled='O' order by tgname collate "C"`)).rows.map((x) => x.def);
    expect(trg).toEqual([
      "CREATE TRIGGER trg_aprovacoes_compra_audit AFTER INSERT OR DELETE OR UPDATE ON erp.aprovacoes_compra FOR EACH ROW EXECUTE FUNCTION erp.audit_row()",
      "CREATE TRIGGER trg_aprovacoes_compra_conferir BEFORE INSERT ON erp.aprovacoes_compra FOR EACH ROW EXECUTE FUNCTION erp.aprovacoes_compra_conferir_v2()",
      "CREATE TRIGGER trg_aprovacoes_compra_imutavel BEFORE DELETE OR UPDATE ON erp.aprovacoes_compra FOR EACH ROW EXECUTE FUNCTION erp.aprovacoes_imutavel()",
      "CREATE TRIGGER trg_aprovacoes_compra_imutavel_truncate BEFORE TRUNCATE ON erp.aprovacoes_compra FOR EACH STATEMENT EXECUTE FUNCTION erp.aprovacoes_imutavel()",
      "CREATE TRIGGER trg_documentos_compra_aprovacao BEFORE UPDATE OF situacao ON erp.documentos_compra FOR EACH ROW WHEN (((old.situacao = 'aberto'::text) AND (new.situacao = 'confirmado'::text))) EXECUTE FUNCTION erp.documentos_compra_aprovacao_guarda()",
      "CREATE TRIGGER trg_documentos_compra_audit AFTER INSERT OR DELETE OR UPDATE ON erp.documentos_compra FOR EACH ROW EXECUTE FUNCTION erp.audit_row()",
      "CREATE TRIGGER trg_documentos_compra_conferir BEFORE INSERT OR UPDATE ON erp.documentos_compra FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_conferir_v3()",
      "CREATE TRIGGER trg_documentos_compra_finalizacao BEFORE UPDATE OF situacao ON erp.documentos_compra FOR EACH ROW WHEN (((old.situacao = 'aberto'::text) AND (new.situacao = 'finalizado'::text) AND (new.especie = 'pedido'::text))) EXECUTE FUNCTION erp.documentos_compra_finalizacao_guarda()",
      "CREATE TRIGGER trg_documentos_compra_itens_documento_aberto BEFORE INSERT OR DELETE OR UPDATE ON erp.documentos_compra_itens FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_itens_documento_aberto()",
      "CREATE TRIGGER trg_documentos_compra_itens_orcamento_guarda BEFORE INSERT OR UPDATE OF item_pedido_orcado_id, quantidade, produto_id, lote, validade ON erp.documentos_compra_itens FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_item_orcamento_guarda()",
      "CREATE TRIGGER trg_documentos_compra_itens_origem_guarda BEFORE INSERT OR UPDATE OF origem_item_id, quantidade, produto_id ON erp.documentos_compra_itens FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_item_origem_guarda_v2()",
      "CREATE TRIGGER trg_documentos_compra_transicao BEFORE UPDATE OF situacao ON erp.documentos_compra FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_transicao_v3()"
    ]);
    expect((await db.query("select 1 from pg_trigger where not tgisinternal and tgenabled <> 'O' and tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass, 'erp.aprovacoes_compra'::regclass)")).rowCount,
      "nenhum gatilho desligado nas três tabelas").toBe(0);
    const velhas = (await db.query(
      `select to_regprocedure('erp.documentos_compra_conferir_v2()') a, to_regprocedure('erp.documentos_compra_transicao_v2()') b,
              to_regprocedure('erp.documentos_compra_item_origem_guarda()') c, to_regprocedure('erp.aprovacoes_compra_conferir()') d`)).rows[0];
    expect(velhas).toEqual({ a: null, b: null, c: null, d: null });
    expect(await funcoesDe()).toEqual(OITO_DEPOIS);
    const fns = (await db.query<{ fn: string; vol: string; cfg: string[]; app: boolean; publico: boolean; atravessa: boolean }>(
      `select n.nspname || '.' || p.proname || '()' fn, p.provolatile vol, p.proconfig cfg, has_function_privilege('erp_app', p.oid, 'execute') app,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) publico,
              r.rolsuper or r.rolbypassrls atravessa
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
        where p.oid = any ($1::regprocedure[]) order by p.proname collate "C"`, [OITO_DEPOIS])).rows;
    // As oito (as seis novas e as duas que ficam: a guarda da aprovação da compra e a do documento aberto).
    expect(fns).toEqual(OITO_DEPOIS.map((fn) => ({ fn, vol: "v", cfg: ["search_path=erp, pg_temp"], app: false, publico: false, atravessa: true })));
    expect(SEIS_NOVAS, "as seis novas estão entre as oito").toHaveLength(6);
    expect(await familiasDoCheck()).toEqual(SEIS_FAMILIAS);
    const chk = (await db.query<{ convalidated: boolean; coluna: string }>(
      `select c.convalidated, a.attname coluna from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.conrelid='erp.layouts_documento'::regclass and c.conname='chk_layouts_documento_familia'`)).rows;
    expect(chk).toEqual([{ convalidated: true, coluna: "familia" }]);
    const comentario = (await db.query<{ c: string }>(
      "select col_description('erp.layouts_documento'::regclass, (select attnum from pg_attribute where attrelid='erp.layouts_documento'::regclass and attname='familia')::int) c")).rows[0]!.c;
    for (const f of SEIS_FAMILIAS) expect(comentario, `o comentário da coluna cita ${f}`).toContain(f);
  });

  /**
   * As PÓS-CONDIÇÕES só leem OBJETOS (catálogo), nunca tabela viva — no deploy a tabela viva tem o dado de produção. E
   * cada uma morde: o bloco delas (o trecho "12)" do arquivo, como está) roda de novo sobre o banco aplicado, com UM
   * objeto quebrado numa transação desfeita, e recusa com a SUA mensagem.
   */
  it("U3.3 pós-condições: só de objetos, passam no banco aplicado, e cada uma, quebrada, recusa com a sua mensagem", async () => {
    const sql = sqlDaAlvo();
    const inicio = sql.indexOf("-- ---------- 12) pós-condições");
    expect(inicio, "o trecho 12) existe").toBeGreaterThan(0);
    const pos = sql.slice(inicio);
    expect(pos).toMatch(/^-- [^\n]*\ndo \$\$/);
    expect(pos.match(/\b(from|join)\s+erp\.\w+/gi), "nenhuma leitura de tabela do erp nas pós-condições").toBeNull();
    const c = await db.connect();
    try { await c.query("begin"); await expect(c.query(pos)).resolves.toBeTruthy(); } finally { await c.query("rollback"); c.release(); }

    const FK = `${M}FK composta do orcamento (pedido_orcado_id, organization_id) -> erp.documentos_compra (id, organization_id) ou (item_pedido_orcado_id, organization_id) -> erp.documentos_compra_itens (id, organization_id), sem cascata, ausente ou diferente.`;
    const CHECKS = `${M}CHECKs de erp.documentos_compra incompletos ou nao validados (esperados 20, com finalizado, aprovado_orcamento, orcamento_do_pedido, campos_do_orcamento e prazo_entrega).`;
    const INDICES = `${M}indices do orcamento (ix_documentos_compra_pedido_orcado, ux_documentos_compra_orcamento_fornecedor, ux_documentos_compra_orcamento_escolhido, ux_documentos_compra_itens_pedido_orcado, ix_documentos_compra_itens_pedido_orcado) ausentes, nao parciais ou sem a unicidade esperada.`;
    const CONJUNTO = /^OPERACOES-01 F6a: gatilhos do documento de compra diferentes do esperado \(aprovacao, audit, conferir v3, finalizacao, itens_documento_aberto, itens_orcamento_guarda, itens_origem_guarda v2, transicao v3\) ou desligados: /;
    const FORMA = `${M}gatilhos trocados ou novos fora da forma (conferir BEFORE INSERT OR UPDATE; transicao e finalizacao BEFORE UPDATE OF situacao, a finalizacao com WHEN; itens_origem_guarda e itens_orcamento_guarda BEFORE INSERT OR UPDATE OF as suas colunas, sem WHEN; aprovacoes_compra_conferir BEFORE INSERT na v2).`;
    const OITO = /^OPERACOES-01 F6a: funcoes SECURITY DEFINER de compras diferentes das oito esperadas depois da 0044: /;
    const FORMA_FUNCOES = `${M}funcoes novas de compras sem SECURITY DEFINER, nao volateis ou sem search_path "erp, pg_temp".`;
    const CHECK_FINALIZADO = `check ((finalizado_em is null and finalizado_por is null) or (finalizado_em is not null and finalizado_por is not null and especie = 'pedido' and situacao in ('finalizado','convertido','cancelado')))`;
    const casos: [string, string, string | RegExp][] = [
      ["coluna nova com outro tipo", "alter table erp.documentos_compra alter column prazo_entrega_dias type bigint", /^OPERACOES-01 F6a: colunas novas ausentes ou com tipo\/nulidade errados: /],
      ["FK do vínculo em cascata", "alter table erp.documentos_compra drop constraint fk_documentos_compra_pedido_orcado, add constraint fk_documentos_compra_pedido_orcado foreign key (pedido_orcado_id, organization_id) references erp.documentos_compra (id, organization_id) on delete cascade", FK],
      ["FK do item do orçamento de coluna só", "alter table erp.documentos_compra_itens drop constraint fk_documentos_compra_itens_pedido_orcado, add constraint fk_documentos_compra_itens_pedido_orcado foreign key (item_pedido_orcado_id) references erp.documentos_compra_itens (id)", FK],
      ["FK de quem finalizou ausente", "alter table erp.documentos_compra drop constraint fk_documentos_compra_finalizado_por", `${M}FK de quem finalizou ou de quem aprovou para orcamento (-> erp.users, sem cascata) ausente.`],
      ["CHECK novo ausente", "alter table erp.documentos_compra drop constraint chk_documentos_compra_prazo_entrega", CHECKS],
      ["CHECK novo não validado", `alter table erp.documentos_compra drop constraint chk_documentos_compra_finalizado, add constraint chk_documentos_compra_finalizado ${CHECK_FINALIZADO} not valid`, CHECKS],
      ["espécie a mais", "alter table erp.documentos_compra drop constraint chk_documentos_compra_especie, add constraint chk_documentos_compra_especie check (especie in ('pedido','compra','orcamento','servico'))",
        /^OPERACOES-01 F6a: chk_documentos_compra_especie nao aceita exatamente pedido, compra e orcamento: /],
      ["situação sem nao_escolhido", "alter table erp.documentos_compra drop constraint chk_documentos_compra_situacao, add constraint chk_documentos_compra_situacao check (situacao in ('aberto','confirmado','convertido','cancelado','finalizado','escolhido'))",
        /^OPERACOES-01 F6a: chk_documentos_compra_situacao nao aceita exatamente /],
      ["situação por espécie sem finalizado no pedido", `alter table erp.documentos_compra drop constraint chk_documentos_compra_situacao_especie, add constraint chk_documentos_compra_situacao_especie check (
          (especie = 'compra' and situacao in ('aberto','confirmado','cancelado')) or (especie = 'pedido' and situacao in ('aberto','convertido','cancelado'))
          or (especie = 'orcamento' and situacao in ('aberto','escolhido','nao_escolhido','cancelado')))`, /^OPERACOES-01 F6a: chk_documentos_compra_situacao_especie diferente do esperado /],
      ["índice do vencedor ausente", "drop index erp.ux_documentos_compra_orcamento_escolhido", INDICES],
      ["índice único da linha do orçamento virou comum", "drop index erp.ux_documentos_compra_itens_pedido_orcado; create index ux_documentos_compra_itens_pedido_orcado on erp.documentos_compra_itens (documento_id, item_pedido_orcado_id) where item_pedido_orcado_id is not null", INDICES],
      ["guarda do orçamento desligada", "alter table erp.documentos_compra_itens disable trigger trg_documentos_compra_itens_orcamento_guarda", CONJUNTO],
      ["um gatilho a mais", "create trigger trg_documentos_compra_zz after update on erp.documentos_compra for each row execute function erp.audit_row()", CONJUNTO],
      ["finalização sem WHEN", "drop trigger trg_documentos_compra_finalizacao on erp.documentos_compra; create trigger trg_documentos_compra_finalizacao before update of situacao on erp.documentos_compra for each row execute function erp.documentos_compra_finalizacao_guarda()", FORMA],
      ["finalização com outro WHEN", "drop trigger trg_documentos_compra_finalizacao on erp.documentos_compra; create trigger trg_documentos_compra_finalizacao before update of situacao on erp.documentos_compra for each row when (OLD.situacao = 'aberto' and NEW.situacao = 'finalizado') execute function erp.documentos_compra_finalizacao_guarda()",
        `${M}o WHEN de trg_documentos_compra_finalizacao nao e a passagem aberto -> finalizado do pedido.`],
      ["conferência da decisão depois (AFTER)", "drop trigger trg_aprovacoes_compra_conferir on erp.aprovacoes_compra; create trigger trg_aprovacoes_compra_conferir after insert on erp.aprovacoes_compra for each row execute function erp.aprovacoes_compra_conferir_v2()", FORMA],
      ["função antiga de volta", "create function erp.documentos_compra_transicao_v2() returns trigger language plpgsql as 'begin return new; end'",
        `${M}funcoes substituidas ainda existem (conferir_v2, transicao_v2, item_origem_guarda, aprovacoes_compra_conferir); a troca nao terminou.`],
      ["definer desconhecida", "create function erp.aprovacoes_compra_x() returns int language sql security definer set search_path = erp as 'select 1'", OITO],
      ["uma nova sem SECURITY DEFINER", "alter function erp.documentos_compra_conferir_v3() security invoker", OITO],
      ["uma nova sem search_path", "alter function erp.documentos_compra_item_orcamento_guarda() reset search_path", FORMA_FUNCOES],
      ["uma nova estável", "alter function erp.documentos_compra_finalizacao_guarda() stable", FORMA_FUNCOES],
      ["EXECUTE do erp_app", "grant execute on function erp.aprovacoes_compra_conferir_v2() to erp_app", `${M}EXECUTE das funcoes de gatilho novas de compras ainda concedido alem do dono.`],
      ["layout com cinco famílias", "alter table erp.layouts_documento drop constraint chk_layouts_documento_familia, add constraint chk_layouts_documento_familia check (familia in ('vendas.orcamento','vendas.pedido','vendas.venda','compras.pedido','compras.compra'))",
        /^OPERACOES-01 F6a: chk_layouts_documento_familia ausente, fora da coluna familia, nao validado ou sem exatamente as seis familias: /]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDe(pos, (t) => t.query(sabotagem))]).toEqual([nome, typeof mensagem === "string" ? mensagem : expect.stringMatching(mensagem)]);
    }
    // Nada ficou: as funções, o CHECK e os privilégios são os da migration.
    expect(await funcoesDe()).toEqual(OITO_DEPOIS);
    expect(await familiasDoCheck()).toEqual(SEIS_FAMILIAS);
    expect((await db.query<{ x: boolean }>("select has_function_privilege('erp_app', 'erp.aprovacoes_compra_conferir_v2()', 'execute') x")).rows[0]!.x).toBe(false);
  });
});

describe("B1 — finalizar o pedido (papel da aplicação, módulo compras)", () => {
  it("pedido aberto → finalizado grava quem e quando JUNTO; sem o carimbo, pela metade ou fora da passagem, recusado", async () => {
    const SO_NA_PASSAGEM = "CONFLICT: O pedido de compra só registra a finalização na passagem de aberto para finalizado.";
    const p = await pedido([{ qtd: "3" }]);
    expect((await ler(p.id)).situacao, "premissa: o pedido nasce aberto").toBe("aberto");
    expect((await erroDe(situacao(p.id, "finalizado"))).message, "sem o carimbo").toBe(SO_NA_PASSAGEM);
    expect((await erroDe(upd(p.id, "situacao='finalizado', finalizado_em=now()"))).message, "pela metade").toBe(SO_NA_PASSAGEM);
    expect((await erroDe(upd(p.id, "finalizado_em=now(), finalizado_por=$2", [demo.adminUserId]))).message, "carimbo sem a transição").toBe(SO_NA_PASSAGEM);
    expect(await ler(p.id)).toMatchObject({ situacao: "aberto", finalizado: false, finalizadoPor: null });
    await expect(finalizar(p.id)).resolves.toMatchObject({ rowCount: 1 });
    expect(await ler(p.id)).toMatchObject({ situacao: "finalizado", finalizado: true, finalizadoPor: demo.adminUserId });
    expect((await erroDe(upd(p.id, "finalizado_em=now() - interval '1 day'"))).message, "mexer no carimbo depois").toBe(SO_NA_PASSAGEM);
    expect((await erroDe(upd(p.id, "finalizado_em=null, finalizado_por=null"))).message, "apagar o carimbo").toBe(SO_NA_PASSAGEM);
  });

  it("compra e orçamento não são finalizados; finalizado não volta a aberto", async () => {
    const SO_PEDIDO = "CONFLICT: Só o pedido de compra é finalizado.";
    const c = await compraDe(null, [{ qtd: "1" }]);
    expect((await erroDe(finalizar(c.id))).message).toBe(SO_PEDIDO);
    const p = await pedido([{ qtd: "1" }]);
    await aprovarParaOrcamento(p.id);
    const o = await orcamento(p);
    expect((await erroDe(finalizar(o.id))).message).toBe(SO_PEDIDO);
    expect([(await ler(c.id)).situacao, (await ler(o.id)).situacao]).toEqual(["aberto", "aberto"]);
    await finalizar(p.id);
    expect((await erroDe(situacao(p.id, "aberto"))).message).toBe("CONFLICT: Transição de situação inválida no documento de compra (finalizado para aberto).");
    expect((await ler(p.id)).situacao).toBe("finalizado");
  });

  it("o pedido finalizado tem cabeçalho e itens congelados; o documento nasce sem finalização", async () => {
    const p = await pedido([{ qtd: "2" }]);
    await finalizar(p.id);
    expect((await erroDe(upd(p.id, "observacao='x'"))).message).toBe("CONFLICT: O documento de compra está finalizado; só a situação muda.");
    expect((await erroDe(upd(p.id, "fornecedor_id=$2", [fornecedor3]))).message).toBe("CONFLICT: O documento de compra está finalizado; só a situação muda.");
    expect((await erroDe(naApp((tx) => inserirItem(tx, p.id, { qtd: "1" }, 5)))).message).toBe("CONFLICT: Os itens só mudam com o documento de compra aberto (situação: finalizado).");
    expect((await erroDe(updItem(p.itens[0]!, "quantidade=5"))).message).toBe("CONFLICT: Os itens só mudam com o documento de compra aberto (situação: finalizado).");
    const NASCE = "VALIDATION_ERROR: O documento de compra nasce sem finalização e sem aprovação para orçamento.";
    expect((await erroDe(pedido([], { extra: { finalizado_em: new Date(), finalizado_por: demo.adminUserId } }))).message).toBe(NASCE);
    expect((await erroDe(pedido([], { extra: { situacao: "finalizado", finalizado_em: new Date(), finalizado_por: demo.adminUserId } }))).message)
      .toBe("VALIDATION_ERROR: O documento de compra nasce aberto; a confirmação e o cancelamento são transições.");
  });

  it("CHECK chk_documentos_compra_finalizado (gatilhos desligados): os dois juntos, só no pedido finalizado, convertido ou cancelado", async () => {
    const com = (especie: Especie, sit: string, campos: Record<string, unknown>) => semGatilhos((q) => inserirCabecalho(q, especie, { extra: { situacao: sit, ...campos } }));
    const ambos = { finalizado_em: new Date(), finalizado_por: demo.adminUserId };
    for (const sit of ["finalizado", "convertido", "cancelado"]) await expect(com("pedido", sit, ambos), `contraprova: pedido ${sit}`).resolves.toBeTruthy();
    const recusas: [string, () => Promise<unknown>][] = [
      ["pedido aberto com o carimbo", () => com("pedido", "aberto", ambos)],
      ["compra com o carimbo", () => com("compra", "aberto", ambos)],
      ["só o quando", () => com("pedido", "finalizado", { finalizado_em: new Date() })],
      ["só o quem", () => com("pedido", "finalizado", { finalizado_por: demo.adminUserId })]
    ];
    for (const [caso, p] of recusas) expect([caso, (await erroDe(p())).constraint]).toEqual([caso, "chk_documentos_compra_finalizado"]);
  });
});

describe("B2 — a aprovação da TOP ao finalizar o pedido (guarda nova; conferência da decisão v2)", () => {
  const PRECISA = "CONFLICT: Este pedido de compra precisa de aprovação antes de ser finalizado.";
  const REPROVADO = "CONFLICT: Este pedido de compra foi reprovado e não pode ser finalizado.";

  it("TOP do pedido no formato 4 'sempre': sem decisão, recusa; a decisão do PEDIDO é aceita (o gatilho atribui valor e versão) e então finaliza", async () => {
    const p = await pedido([{ qtd: "10" }], { top: tops.pedido4Sempre, valor: "100.00" });
    expect((await erroDe(finalizar(p.id))).message).toBe(PRECISA);
    expect((await ler(p.id)).situacao).toBe("aberto");
    const d = await decidir(p.id);
    expect(d.rows).toEqual([{ valor: "100.00", versao: tops.pedido4Sempre.versao, por: demo.adminUserId }]);
    await expect(finalizar(p.id)).resolves.toMatchObject({ rowCount: 1 });
    expect((await ler(p.id)).situacao).toBe("finalizado");
  });

  it("reprovada: recusa com a mensagem de reprovação; aprovada depois (decisão nova), finaliza", async () => {
    const p = await pedido([{ qtd: "1" }], { top: tops.pedido4Sempre, valor: "50.00" });
    await decidir(p.id, "reprovado");
    expect((await erroDe(finalizar(p.id))).message).toBe(REPROVADO);
    await decidir(p.id);
    await expect(finalizar(p.id)).resolves.toMatchObject({ rowCount: 1 });
  });

  it("aprovada e depois o valor sobe (itens e cabeçalho, com o pedido aberto): a aprovação não cobre e a finalização é recusada; aprovar o novo valor libera", async () => {
    const p = await pedido([{ qtd: "10", unitario: "10" }], { top: tops.pedido4Sempre, valor: "100.00" });
    await decidir(p.id);
    await expect(updItem(p.itens[0]!, "quantidade=20, valor_total=200")).resolves.toMatchObject({ rowCount: 1 });
    await expect(upd(p.id, "valor_itens=200, valor_total=200")).resolves.toMatchObject({ rowCount: 1 });
    expect((await erroDe(finalizar(p.id))).message).toBe(PRECISA);
    // E no MESMO UPDATE da finalização: subir o valor junto também não escapa.
    const q = await pedido([{ qtd: "1" }], { top: tops.pedido4Sempre, valor: "100.00" });
    await decidir(q.id);
    expect((await erroDe(upd(q.id, "situacao='finalizado', finalizado_em=now(), finalizado_por=$2, valor_itens=150, valor_total=150", [demo.adminUserId]))).message).toBe(PRECISA);
    expect((await decidir(p.id)).rows[0]!.valor).toBe("200.00");
    await expect(finalizar(p.id)).resolves.toMatchObject({ rowCount: 1 });
  });

  it("'a partir de um valor': abaixo do limite finaliza sem decisão; no limite (inclui o igual) exige; formato 3 nunca é barrado", async () => {
    const abaixo = await pedido([{ qtd: "1" }], { top: tops.pedido4Valor, valor: "1499.99" });
    await expect(finalizar(abaixo.id)).resolves.toMatchObject({ rowCount: 1 });
    const limite = await pedido([{ qtd: "1" }], { top: tops.pedido4Valor, valor: "1500.00" });
    expect((await erroDe(finalizar(limite.id))).message).toBe(PRECISA);
    const f3 = await pedido([{ qtd: "1" }], { top: tops.pedido3Sempre, valor: "9999.00" });
    await expect(finalizar(f3.id)).resolves.toMatchObject({ rowCount: 1 });
  });

  it("a conferência da decisão: orçamento é a NOT_FOUND de inexistente; pedido finalizado não passa por aprovação; pedido que não exige, APROVACAO_NAO_EXIGIDA; a compra continua como na 0041", async () => {
    const p = await pedido([{ qtd: "1" }]);
    await aprovarParaOrcamento(p.id);
    const o = await orcamento(p);
    const NAO_ENCONTRADO = "NOT_FOUND: Documento não encontrado";
    expect((await erroDe(decidir(o.id))).message).toBe(NAO_ENCONTRADO);
    expect((await erroDe(decidir(randomUUID()))).message).toBe(NAO_ENCONTRADO);
    expect((await erroDe(decidir(p.id))).message, "pedido de TOP no formato 1").toBe("APROVACAO_NAO_EXIGIDA: Este documento não precisa de aprovação.");
    const fin = await pedido([{ qtd: "1" }], { top: tops.pedido3Sempre });
    await finalizar(fin.id);
    expect((await erroDe(decidir(fin.id))).message).toBe("CONFLICT: Só documento aberto passa por aprovação.");
    // A compra: a decisão continua aceita e a guarda da confirmação (0041) continua guardando.
    const c = await compraDe(null, [{ qtd: "1" }], { top: tops.compra4Sempre, valor: "10.00" });
    expect((await erroDe(situacao(c.id, "confirmado"))).message).toBe("CONFLICT: Este documento precisa de aprovação antes de ser confirmado.");
    await decidir(c.id);
    await expect(situacao(c.id, "confirmado")).resolves.toMatchObject({ rowCount: 1 });
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.aprovacoes_compra where documento_id = any($1)", [[o.id, fin.id]])).rows[0]!.n,
      "nenhuma decisão gravada para o orçamento nem para o finalizado").toBe(0);
  });
});

describe("B3 — receber o pedido FINALIZADO; converter, reabrir e encerrar o saldo a partir dele", () => {
  it("a compra com origem no pedido finalizado entra e liga os itens; o pedido vira convertido e reabre como FINALIZADO (nunca aberto)", async () => {
    const p = await pedido([{ qtd: "10" }]);
    await finalizar(p.id);
    const c1 = await compraDe(p.id, [{ qtd: "4", origem: p.itens[0]! }]);
    const c2 = await compraDe(p.id, [{ qtd: "6", origem: p.itens[0]! }]);
    const ligadas = (await db.query<{ origem: string; itemOrigem: string }>(
      `select d.origem_documento_id origem, i.origem_item_id "itemOrigem" from erp.documentos_compra d join erp.documentos_compra_itens i on i.documento_id = d.id
        where d.id = any($1) order by d.created_at, d.id`, [[c1.id, c2.id]])).rows;
    expect(ligadas).toEqual([{ origem: p.id, itemOrigem: p.itens[0]! }, { origem: p.id, itemOrigem: p.itens[0]! }]);
    expect((await erroDe(compraDe(p.id, [{ qtd: "0.0001", origem: p.itens[0]! }]))).message, "o saldo continua valendo").toBe("VALIDATION_ERROR: A quantidade passa do saldo do item do pedido de compra.");
    await expect(situacao(p.id, "convertido")).resolves.toMatchObject({ rowCount: 1 });
    await situacao(c2.id, "cancelado");
    expect((await erroDe(situacao(p.id, "aberto"))).message).toBe("CONFLICT: O pedido de compra reabre na situação de antes de ser convertido (finalizado).");
    await expect(situacao(p.id, "finalizado")).resolves.toMatchObject({ rowCount: 1 });
    expect(await ler(p.id)).toMatchObject({ situacao: "finalizado", finalizado: true, finalizadoPor: demo.adminUserId });
    // Contraprova: o pedido que nunca foi finalizado reabre ABERTO, e não finalizado.
    const q = await pedido([{ qtd: "1" }]);
    const cq = await compraDe(q.id, [{ qtd: "1", origem: q.itens[0]! }]);
    await situacao(q.id, "convertido");
    await situacao(cq.id, "cancelado");
    expect((await erroDe(situacao(q.id, "finalizado"))).message).toBe("CONFLICT: O pedido de compra reabre na situação de antes de ser convertido (aberto).");
    await expect(situacao(q.id, "aberto")).resolves.toMatchObject({ rowCount: 1 });
  });

  it("pedido cancelado ou convertido (vindo do finalizado) não gera compra nem recebe linha — as mensagens de hoje", async () => {
    const cancelado = await pedido([{ qtd: "1" }]);
    await finalizar(cancelado.id);
    await situacao(cancelado.id, "cancelado");
    expect((await erroDe(compraDe(cancelado.id, []))).message).toBe("CONFLICT: O pedido de compra de origem não está aberto (situação: cancelado).");
    const p = await pedido([{ qtd: "5" }]);
    await finalizar(p.id);
    const c = await compraDe(p.id, [{ qtd: "1", origem: p.itens[0]! }]);
    await situacao(p.id, "convertido");
    expect((await erroDe(compraDe(p.id, []))).message).toBe("CONFLICT: O pedido de compra de origem não está aberto (situação: convertido).");
    expect((await erroDe(naApp((tx) => inserirItem(tx, c.id, { qtd: "1", origem: p.itens[0]! }, 3)))).message)
      .toBe("CONFLICT: O pedido de compra de origem não está aberto (situação: convertido).");
  });

  it("encerrar o saldo a partir do FINALIZADO: na passagem finalizado → convertido (e só ela); depois não reabre", async () => {
    const p = await pedido([{ qtd: "10" }]);
    await finalizar(p.id);
    await compraDe(p.id, [{ qtd: "3", origem: p.itens[0]! }]);
    const SO_NA_PASSAGEM = "CONFLICT: O saldo do pedido de compra só se encerra na passagem de aberto ou finalizado para convertido.";
    expect((await erroDe(upd(p.id, "saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo='x'", [demo.adminUserId]))).message).toBe(SO_NA_PASSAGEM);
    // A exceção do congelamento é SÓ o encerramento: mudar outra coluna na mesma passagem continua recusado.
    expect((await erroDe(upd(p.id, "situacao='convertido', saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo='x', observacao='y'", [demo.adminUserId]))).message)
      .toBe("CONFLICT: O documento de compra está finalizado; só a situação muda.");
    await expect(encerrarSaldo(p.id)).resolves.toMatchObject({ rowCount: 1 });
    const r = (await db.query<{ situacao: string; motivo: string; fin: boolean }>(
      "select situacao, saldo_encerrado_motivo motivo, finalizado_em is not null fin from erp.documentos_compra where id=$1", [p.id])).rows[0];
    expect(r).toEqual({ situacao: "convertido", motivo: "Fornecedor não entrega o resto", fin: true });
    expect((await erroDe(situacao(p.id, "finalizado"))).message).toBe("CONFLICT: O saldo deste pedido de compra foi encerrado; ele não reabre.");
  });
});

describe("B4 — cancelar o pedido finalizado", () => {
  it("sem compra viva, cancela (o carimbo da finalização fica); com compra viva, a recusa de hoje; cancelada a compra, cancela", async () => {
    const livre = await pedido([{ qtd: "1" }]);
    await finalizar(livre.id);
    await expect(situacao(livre.id, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
    expect(await ler(livre.id)).toMatchObject({ situacao: "cancelado", finalizado: true });
    const p = await pedido([{ qtd: "5" }]);
    await finalizar(p.id);
    const c = await compraDe(p.id, [{ qtd: "2", origem: p.itens[0]! }]);
    expect((await erroDe(situacao(p.id, "cancelado"))).message).toBe("CONFLICT: Este pedido tem compras: cancele-as ou encerre o saldo.");
    await situacao(c.id, "cancelado");
    await expect(situacao(p.id, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("B5 — aprovado para orçamento", () => {
  const UMA_VEZ = "CONFLICT: A aprovação para orçamento é registrada uma vez, com o pedido aberto.";
  it("grava quem e quando uma vez, com o pedido aberto; de novo, limpar, pela metade ou fora do aberto, recusado", async () => {
    const p = await pedido([{ qtd: "1" }]);
    expect((await ler(p.id)).aprovadoOrcamento, "premissa").toBe(false);
    await expect(aprovarParaOrcamento(p.id)).resolves.toMatchObject({ rowCount: 1 });
    const gravado = (await db.query<{ por: string; em: boolean }>("select aprovado_orcamento_por por, aprovado_orcamento_em is not null em from erp.documentos_compra where id=$1", [p.id])).rows[0];
    expect(gravado).toEqual({ por: demo.adminUserId, em: true });
    expect((await erroDe(aprovarParaOrcamento(p.id))).message, "de novo").toBe(UMA_VEZ);
    expect((await erroDe(upd(p.id, "aprovado_orcamento_em=null, aprovado_orcamento_por=null"))).message, "limpar").toBe(UMA_VEZ);
    const metade = await pedido([{ qtd: "1" }]);
    expect((await erroDe(upd(metade.id, "aprovado_orcamento_em=now()"))).message, "pela metade").toBe(UMA_VEZ);
    const fin = await pedido([{ qtd: "1" }]);
    await finalizar(fin.id);
    expect((await erroDe(aprovarParaOrcamento(fin.id))).message, "pedido finalizado").toBe(UMA_VEZ);
    // A finalização não apaga a aprovação para orçamento (o congelamento a guarda).
    await finalizar(p.id);
    expect(await ler(p.id)).toMatchObject({ situacao: "finalizado", aprovadoOrcamento: true });
  });

  it("só no pedido: na compra, o CHECK chk_documentos_compra_aprovado_orcamento; o documento nasce sem ela", async () => {
    const c = await compraDe(null, [{ qtd: "1" }]);
    const e = await erroDe(aprovarParaOrcamento(c.id));
    expect([e.code, e.constraint]).toEqual(["23514", "chk_documentos_compra_aprovado_orcamento"]);
    expect((await erroDe(pedido([], { extra: { aprovado_orcamento_em: new Date(), aprovado_orcamento_por: demo.adminUserId } }))).message)
      .toBe("VALIDATION_ERROR: O documento de compra nasce sem finalização e sem aprovação para orçamento.");
  });
});

describe("B6 — o orçamento de compra", () => {
  const RECUSA_PEDIDO = "VALIDATION_ERROR: O orçamento de compra precisa ser de um pedido de compra da mesma empresa.";

  it("de pedido aberto, aprovado para orçamento e da mesma empresa; inexistente, outra empresa e compra no lugar do pedido dão a MESMA recusa", async () => {
    const p = await pedido([{ qtd: "5" }, { produto: produtoY, qtd: "3" }]);
    await aprovarParaOrcamento(p.id);
    const o = await orcamento(p, { extra: { prazo_entrega_dias: 10, validade_orcamento: "2026-10-31" } });
    const lido = (await db.query<{ especie: string; situacao: string; pedido: string; prazo: number; validade: string; fornecedor: string }>(
      `select especie, situacao, pedido_orcado_id pedido, prazo_entrega_dias prazo, validade_orcamento validade, fornecedor_id fornecedor
         from erp.documentos_compra where id=$1`, [o.id])).rows[0];
    expect(lido).toEqual({ especie: "orcamento", situacao: "aberto", pedido: p.id, prazo: 10, validade: "2026-10-31", fornecedor: fornecedor2 });
    expect(o.itens).toHaveLength(2);
    const naoAprovado = await pedido([{ qtd: "1" }]);
    expect((await erroDe(orcamento(naoAprovado))).message).toBe("CONFLICT: O pedido de compra não está aprovado para orçamento.");
    const fin = await pedido([{ qtd: "1" }]);
    await aprovarParaOrcamento(fin.id);
    await finalizar(fin.id);
    expect((await erroDe(orcamento(fin))).message).toBe("CONFLICT: O pedido de compra do orçamento não está aberto (situação: finalizado).");
    const deB = await pedido([{ qtd: "1" }], { empresa: B });
    await aprovarParaOrcamento(deB.id);
    const compra = await compraDe(null, [{ qtd: "1" }]);
    const msgs = [];
    for (const alvo of [{ id: randomUUID(), itens: [] }, deB, compra]) msgs.push((await erroDe(orcamento(alvo, { linhas: [] }))).message);
    expect(msgs).toEqual([RECUSA_PEDIDO, RECUSA_PEDIDO, RECUSA_PEDIDO]);
    expect((await erroDe(orcamento(p, { top: tops.pedido1, fornecedor: fornecedor3, linhas: [] }))).message, "a TOP do orçamento é da família compras.orcamento")
      .toBe("VALIDATION_ERROR: O tipo de operação não é da família do documento (compras.orcamento).");
  });

  it("CHECKs do vínculo e dos campos do orçamento (gatilhos desligados: o CHECK sozinho)", async () => {
    const p = await pedido([{ qtd: "1" }]);
    const chk = async (especie: Especie, extra: Record<string, unknown>) => (await erroDe(semGatilhos((q) => inserirCabecalho(q, especie, { extra })))).constraint;
    for (const prazo of [0, 3650]) {
      await expect(semGatilhos((q) => inserirCabecalho(q, "orcamento", { extra: { pedido_orcado_id: p.id, prazo_entrega_dias: prazo } })), `contraprova: prazo ${prazo}`).resolves.toBeTruthy();
    }
    expect(await chk("orcamento", {}), "orçamento sem o pedido").toBe("chk_documentos_compra_orcamento_do_pedido");
    expect(await chk("pedido", { pedido_orcado_id: p.id }), "pedido com pedido orçado").toBe("chk_documentos_compra_orcamento_do_pedido");
    expect(await chk("compra", { prazo_entrega_dias: 5 }), "prazo na compra").toBe("chk_documentos_compra_campos_do_orcamento");
    expect(await chk("pedido", { validade_orcamento: "2026-12-31" }), "validade no pedido").toBe("chk_documentos_compra_campos_do_orcamento");
    expect(await chk("orcamento", { pedido_orcado_id: p.id, prazo_entrega_dias: 3651 })).toBe("chk_documentos_compra_prazo_entrega");
    expect(await chk("orcamento", { pedido_orcado_id: p.id, prazo_entrega_dias: -1 })).toBe("chk_documentos_compra_prazo_entrega");
    expect(await chk("orcamento", { pedido_orcado_id: randomUUID() }), "FK composta: pedido inexistente").toBe("fk_documentos_compra_pedido_orcado");
  });

  it("um orçamento VIVO por fornecedor em cada pedido: o segundo é 23505; cancelar libera; outro fornecedor passa", async () => {
    const p = await pedido([{ qtd: "2" }]);
    await aprovarParaOrcamento(p.id);
    const o1 = await orcamento(p, { fornecedor: fornecedor2 });
    const e = await erroDe(orcamento(p, { fornecedor: fornecedor2 }));
    expect([e.code, e.constraint]).toEqual(["23505", "ux_documentos_compra_orcamento_fornecedor"]);
    await expect(orcamento(p, { fornecedor: fornecedor3 })).resolves.toBeTruthy();
    await situacao(o1.id, "cancelado");
    await expect(orcamento(p, { fornecedor: fornecedor2 })).resolves.toBeTruthy();
  });

  it("itens: ligam a item do pedido orçado com o MESMO produto e quantidade, sem lote nem validade; só o orçamento liga; uma linha por item do pedido", async () => {
    const p = await pedido([{ qtd: "5" }, { produto: produtoY, qtd: "3" }]);
    await aprovarParaOrcamento(p.id);
    const outro = await pedido([{ qtd: "5" }]);
    const um = (l: Linha, fornecedor: string) => orcamento(p, { fornecedor, linhas: [l] });
    const casos: [string, Linha, string][] = [
      ["sem o item do pedido", { qtd: "5", orcado: null }, "VALIDATION_ERROR: O orçamento de compra liga todo item a um item do pedido."],
      ["com lote", { qtd: "5", orcado: p.itens[0]!, lote: "L1" }, "VALIDATION_ERROR: Orçamento de compra não tem lote nem validade."],
      ["com validade", { qtd: "5", orcado: p.itens[0]!, validade: "2027-01-01" }, "VALIDATION_ERROR: Orçamento de compra não tem lote nem validade."],
      ["item de outro pedido", { qtd: "5", orcado: outro.itens[0]! }, "VALIDATION_ERROR: O item orçado não pertence ao pedido do orçamento."],
      ["item inexistente", { qtd: "5", orcado: randomUUID() }, "VALIDATION_ERROR: O item orçado não pertence ao pedido do orçamento."],
      ["outra quantidade", { qtd: "4", orcado: p.itens[0]! }, "VALIDATION_ERROR: O item do orçamento tem o produto e a quantidade do item do pedido."],
      ["outro produto", { produto: produtoY, qtd: "5", orcado: p.itens[0]! }, "VALIDATION_ERROR: O item do orçamento tem o produto e a quantidade do item do pedido."]
    ];
    for (const [caso, l, msg] of casos) expect([caso, (await erroDe(um(l, fornecedor3))).message]).toEqual([caso, msg]);
    const dup = await erroDe(orcamento(p, { fornecedor: fornecedor3, linhas: [{ qtd: "5", orcado: p.itens[0]! }, { qtd: "5", orcado: p.itens[0]! }] }));
    expect([dup.code, dup.constraint]).toEqual(["23505", "ux_documentos_compra_itens_pedido_orcado"]);
    const SO_ORCAMENTO = "VALIDATION_ERROR: Só o orçamento de compra liga item a item do pedido orçado.";
    expect((await erroDe(compraDe(null, [{ qtd: "5", orcado: p.itens[0]! }]))).message).toBe(SO_ORCAMENTO);
    expect((await erroDe(pedido([{ qtd: "5", orcado: p.itens[0]! }]))).message).toBe(SO_ORCAMENTO);
    // Contraprova: a linha certa passa — e trocar a ligação para um item de outro pedido também é recusado.
    const ok = await um({ qtd: "5", orcado: p.itens[0]!, unitario: "12.345678" }, fornecedor3);
    expect((await db.query<{ v: string }>("select valor_unitario v from erp.documentos_compra_itens where id=$1", [ok.itens[0]!])).rows[0]!.v).toBe("12.345678");
    expect((await erroDe(updItem(ok.itens[0]!, "item_pedido_orcado_id=$2", [outro.itens[0]!]))).message).toBe("VALIDATION_ERROR: O item orçado não pertence ao pedido do orçamento.");
  });

  it("do lado do pedido: o item já orçado não troca de produto nem de quantidade (o preço muda); cancelado o orçamento, troca", async () => {
    const p = await pedido([{ qtd: "5" }]);
    await aprovarParaOrcamento(p.id);
    const o = await orcamento(p);
    const JA_ORCADO = "VALIDATION_ERROR: O item do pedido de compra já orçado não troca de produto nem de quantidade.";
    expect((await erroDe(updItem(p.itens[0]!, "quantidade=6"))).message).toBe(JA_ORCADO);
    expect((await erroDe(updItem(p.itens[0]!, "produto_id=$2", [produtoY]))).message).toBe(JA_ORCADO);
    await expect(updItem(p.itens[0]!, "valor_unitario=7.5, valor_total=37.5"), "o preço do pedido muda (o vencedor leva o dele)").resolves.toMatchObject({ rowCount: 1 });
    await situacao(o.id, "cancelado");
    await expect(updItem(p.itens[0]!, "quantidade=6")).resolves.toMatchObject({ rowCount: 1 });
  });

  it("o orçamento NÃO consome saldo: com o orçamento vivo, uma compra recebe a quantidade INTEIRA do pedido", async () => {
    const p = await pedido([{ qtd: "5" }]);
    await aprovarParaOrcamento(p.id);
    const o = await orcamento(p);
    const vivo = (await db.query<{ qtd: string; situacao: string }>(
      "select i.quantidade qtd, d.situacao from erp.documentos_compra_itens i join erp.documentos_compra d on d.id = i.documento_id where i.id=$1", [o.itens[0]!])).rows[0];
    expect(vivo, "premissa: a linha do orçamento cobre o item inteiro e está viva").toEqual({ qtd: "5.0000", situacao: "aberto" });
    await expect(compraDe(p.id, [{ qtd: "5", origem: p.itens[0]! }])).resolves.toBeTruthy();
    expect((await erroDe(compraDe(p.id, [{ qtd: "0.0001", origem: p.itens[0]! }]))).message, "e o saldo é só o da compra")
      .toBe("VALIDATION_ERROR: A quantidade passa do saldo do item do pedido de compra.");
  });

  it("o fornecedor do pedido com orçamento (sem compra) MUDA; o do orçamento e o pedido orçado não mudam", async () => {
    const p = await pedido([{ qtd: "1" }]);
    await aprovarParaOrcamento(p.id);
    const o = await orcamento(p, { fornecedor: fornecedor2 });
    await expect(upd(p.id, "fornecedor_id=$2", [fornecedor3])).resolves.toMatchObject({ rowCount: 1 });
    expect((await erroDe(upd(o.id, "fornecedor_id=$2", [fornecedor3]))).message).toBe("VALIDATION_ERROR: O fornecedor do orçamento de compra não muda; cancele o orçamento e lance outro.");
    const outro = await pedido([{ qtd: "1" }]);
    expect((await erroDe(upd(o.id, "pedido_orcado_id=$2", [outro.id]))).message).toBe("VALIDATION_ERROR: O pedido do orçamento de compra não muda depois do lançamento.");
    expect([(await ler(p.id)).fornecedor, (await ler(o.id)).fornecedor]).toEqual([fornecedor3, fornecedor2]);
  });

  it("RLS: o orçamento herda o escopo de empresa do documento (o membro com escopo [A] não vê o orçamento de B nem os itens dele)", async () => {
    const p = await pedido([{ qtd: "1" }], { empresa: B });
    await aprovarParaOrcamento(p.id);
    const o = await orcamento(p, { empresa: B });
    const ver = (c: TenantContext) => naApp(async (tx) => ({
      docs: (await tx.query("select 1 from erp.documentos_compra where id=$1", [o.id])).rowCount,
      itens: (await tx.query("select 1 from erp.documentos_compra_itens where documento_id=$1", [o.id])).rowCount
    }), c);
    expect(await ver(ctx()), "contraprova: o proprietário vê").toEqual({ docs: 1, itens: 1 });
    expect(await ver(ctx(usuarioEscopoA))).toEqual({ docs: 0, itens: 0 });
    const n = await upd(o.id, "observacao='x'", [], ctx(usuarioEscopoA));
    expect(n.rowCount, "UPDATE fora do escopo afeta zero linhas").toBe(0);
  });
});

describe("B7 — transições do orçamento e o vencedor", () => {
  it("aberto → escolhido / não escolhido / cancelado; um escolhido por pedido (23505); escolhido e não escolhido são finais", async () => {
    const p = await pedido([{ qtd: "2" }]);
    await aprovarParaOrcamento(p.id);
    const o1 = await orcamento(p, { fornecedor: fornecedor2 });
    const o2 = await orcamento(p, { fornecedor: fornecedor3 });
    const o3 = await orcamento(p, { fornecedor: fornecedor1 });
    await expect(situacao(o1.id, "escolhido")).resolves.toMatchObject({ rowCount: 1 });
    const e = await erroDe(situacao(o2.id, "escolhido"));
    expect([e.code, e.constraint]).toEqual(["23505", "ux_documentos_compra_orcamento_escolhido"]);
    await expect(situacao(o2.id, "nao_escolhido")).resolves.toMatchObject({ rowCount: 1 });
    await expect(situacao(o3.id, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
    expect([(await ler(o1.id)).situacao, (await ler(o2.id)).situacao, (await ler(o3.id)).situacao]).toEqual(["escolhido", "nao_escolhido", "cancelado"]);
    expect((await erroDe(situacao(o1.id, "cancelado"))).message).toBe("CONFLICT: Transição de situação inválida no documento de compra (escolhido para cancelado).");
    expect((await erroDe(situacao(o2.id, "aberto"))).message).toBe("CONFLICT: Transição de situação inválida no documento de compra (nao_escolhido para aberto).");
    expect((await erroDe(upd(o1.id, "observacao='x'"))).message).toBe("CONFLICT: O documento de compra está escolhido; só a situação muda.");
    expect((await erroDe(updItem(o1.itens[0]!, "valor_unitario=1"))).message).toBe("CONFLICT: Os itens só mudam com o documento de compra aberto (situação: escolhido).");
  });

  it("orçamento não é confirmado nem convertido; pedido e compra não são escolhidos", async () => {
    const p = await pedido([{ qtd: "1" }]);
    await aprovarParaOrcamento(p.id);
    const o = await orcamento(p);
    expect((await erroDe(situacao(o.id, "confirmado"))).message).toBe("CONFLICT: Orçamento de compra não é confirmado; ele é escolhido ou não escolhido.");
    expect((await erroDe(situacao(o.id, "convertido"))).message).toBe("CONFLICT: Só o pedido de compra vira convertido; a compra se confirma.");
    const SO_ORCAMENTO = "CONFLICT: Só o orçamento de compra é escolhido ou não escolhido.";
    expect((await erroDe(situacao(p.id, "escolhido"))).message).toBe(SO_ORCAMENTO);
    const c = await compraDe(null, [{ qtd: "1" }]);
    expect((await erroDe(situacao(c.id, "nao_escolhido"))).message).toBe(SO_ORCAMENTO);
    expect([(await ler(o.id)).situacao, (await ler(p.id)).situacao, (await ler(c.id)).situacao]).toEqual(["aberto", "aberto", "aberto"]);
  });

  it("escolher o vencedor numa transação (como a API): o pedido aberto leva fornecedor, condição e preços; os outros ficam não escolhidos; depois finaliza", async () => {
    const p = await pedido([{ qtd: "4", unitario: "10" }], { valor: "40.00" });
    await aprovarParaOrcamento(p.id);
    const vencedor = await orcamento(p, { fornecedor: fornecedor2, linhas: [{ qtd: "4", orcado: p.itens[0]!, unitario: "8.25" }] });
    const perdedor = await orcamento(p, { fornecedor: fornecedor3, linhas: [{ qtd: "4", orcado: p.itens[0]!, unitario: "9" }] });
    const condicao = (await db.query<{ id: string | null }>("select id from erp.condicoes_pagamento where organization_id=$1 order by id limit 1", [demo.orgId])).rows[0]?.id ?? null;
    const contagens = await naApp(async (tx) => {
      const n: number[] = [];
      n.push((await tx.query("update erp.documentos_compra set fornecedor_id=$2, condicao_pagamento_id=$3, valor_itens=33, valor_total=33 where id=$1 and situacao='aberto'",
        [p.id, fornecedor2, condicao])).rowCount ?? 0);
      n.push((await tx.query("update erp.documentos_compra_itens set valor_unitario=8.25, desconto=0, valor_total=33 where id=$1", [p.itens[0]!])).rowCount ?? 0);
      n.push((await tx.query("update erp.documentos_compra set situacao='escolhido' where id=$1 and situacao='aberto'", [vencedor.id])).rowCount ?? 0);
      n.push((await tx.query("update erp.documentos_compra set situacao='nao_escolhido' where pedido_orcado_id=$1 and id<>$2 and situacao='aberto'", [p.id, vencedor.id])).rowCount ?? 0);
      return n;
    });
    expect(contagens, "ROW COUNT de cada gravação").toEqual([1, 1, 1, 1]);
    const pedidoDepois = (await db.query<{ fornecedor: string; condicao: string | null; total: string; unitario: string }>(
      `select d.fornecedor_id fornecedor, d.condicao_pagamento_id condicao, d.valor_total total, i.valor_unitario unitario
         from erp.documentos_compra d join erp.documentos_compra_itens i on i.documento_id = d.id where d.id=$1`, [p.id])).rows[0];
    expect(pedidoDepois).toEqual({ fornecedor: fornecedor2, condicao, total: "33.00", unitario: "8.250000" });
    expect([(await ler(vencedor.id)).situacao, (await ler(perdedor.id)).situacao]).toEqual(["escolhido", "nao_escolhido"]);
    await expect(finalizar(p.id)).resolves.toMatchObject({ rowCount: 1 });
    const trilha = (await db.query<{ action: string }>("select action from erp.audit_logs where entity='documentos_compra' and entity_id=$1 order by id", [vencedor.id])).rows.map((r) => r.action);
    expect(trilha, "a auditoria registra o orçamento (create) e a escolha (update)").toEqual(["create", "update"]);
  });
});

describe("B8 — layout de compras.orcamento", () => {
  it("grava e liga a TOP de orçamento; a TOP de outra família é recusada pelo gatilho da 0032; família fora das seis, pelo CHECK", async () => {
    const layout = (familia: string) => naApp(async (tx) => {
      seq += 1;
      return (await tx.query<{ id: string }>(
        "insert into erp.layouts_documento (organization_id, code, nome, familia, padrao, estrutura) values ($1,$2,$3,$4,false,'{}') returning id",
        [demo.orgId, `F6A-L${seq}`, `Layout ${familia} ${seq}`, familia])).rows[0]!.id;
    });
    const ligar = (l: string, top: Top) => naApp((tx) => tx.query("insert into erp.layout_documento_tops (organization_id, layout_id, tipo_operacao_id) values ($1,$2,$3)", [demo.orgId, l, top.top]));
    const l = await layout("compras.orcamento");
    await expect(ligar(l, tops.orcamento1)).resolves.toMatchObject({ rowCount: 1 });
    const outroPedido = await criarTop("compras.pedido");
    const e = await erroDe(ligar(l, outroPedido));
    expect([e.code, e.message]).toEqual(["23514", "VENDAS-A3-1: a familia da TOP (compras.pedido) difere da familia do layout (compras.orcamento)."]);
    for (const fora of ["compras.solicitacao", "compras.orcamentos", "COMPRAS.ORCAMENTO"]) {
      const r = await erroDe(layout(fora));
      expect([fora, r.code, r.constraint]).toEqual([fora, "23514", "chk_layouts_documento_familia"]);
    }
    expect((await db.query<{ layout_id: string }>("select layout_id from erp.layout_documento_tops where tipo_operacao_id=$1", [tops.orcamento1.top])).rows).toEqual([{ layout_id: l }]);
  });
});
