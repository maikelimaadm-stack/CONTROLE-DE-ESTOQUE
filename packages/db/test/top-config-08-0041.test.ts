import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0041 (TOP-CONFIG-08, decisão 277), PROVADA CONTRA O BANCO — COMO O RUNNER APLICA.
 *
 * O que ela promete:
 *   · erp.aprovacoes_venda, erp.aprovacoes_compra e erp.aprovacoes_estoque: uma linha por DECISÃO, só inserção
 *     (o papel da aplicação não tem UPDATE, DELETE nem TRUNCATE, e o gatilho de imutabilidade fecha o caminho do
 *     dono também: UPDATE e DELETE por linha, DB-1.6; TRUNCATE por comando, DB-1.9 — a MESMA CONFLICT, e as linhas
 *     ficam); FKs de documento, versão da TOP, TOP e empresa — a de empresa composta (organization_id,
 *     empresa_id), nessa ordem; RLS forçada com a política tenant_e_empresa da 0040; índice (organização,
 *     documento, id desc); erp.audit_row nas três; a reprovação sem motivo, ou com um motivo só de espaço, tab ou
 *     quebra de linha (a classe [[:space:]], não o btrim, que só tira o espaço comum), é o CHECK (23514, DB-1.10)
 *     (DB-1);
 *   · o gatilho de INSERÇÃO (SECURITY DEFINER; roda ANTES do with check da RLS): sem usuário recusa; organização da
 *     linha diferente da GUC do servidor (ou transação sem organização) recebe a NOT_FOUND ANTES de ler qualquer
 *     documento — a mesma resposta qualquer que seja o documento do outro tenant, então ele não vira oráculo; e a
 *     empresa da linha fora do escopo de escrita de quem decide, no módulo da transação (o predicado do with check),
 *     também — o membro com escopo [A] pedindo um documento da empresa B da MESMA organização (DB-2.12);
 *     documento de outra organização, de outra empresa, de outra espécie ou excluído recebe a MESMA NOT_FOUND — e o
 *     filtro está NA leitura FOR SHARE (organização, empresa da linha, espécie, não excluído), então o documento que
 *     não é o pedido não é lido nem travado: com ele travado FOR UPDATE por outra sessão, a NOT_FOUND vem na hora,
 *     nunca o 55P03 do lock_timeout (DB-2.12b); versão diferente
 *     da atual (venda) é concorrência; documento fora do aberto e documento que não exige aprovação são recusados;
 *     a reprovação sem motivo é o CHECK (23514); e ele ATRIBUI do documento a TOP, a versão congelada e o valor, e
 *     da transação decidido_por/decidido_em, ignorando o que veio (DB-2);
 *   · as três GUARDAS de transição, só na ENTRADA no confirmado: sem decisão → CONFLICT "precisa de aprovação";
 *     reprovada → CONFLICT "foi reprovado"; aprovada → passa; formato 1 a 3 e "nenhuma" nunca barrados; o limite
 *     "a partir de" inclui o igual; e, na venda, a decisão que vale é a da versão OLD.version — um UPDATE que grava
 *     version junto com o status não se aprova sozinho; e a aprovação só vale para o que ela viu: o valor dela
 *     cobre o MAIOR total (o de antes e o de depois do UPDATE) e a versão da TOP dela é a de DEPOIS — confirmar e,
 *     no MESMO UPDATE, subir o total (venda, DB-3.11b; compra, DB-3.11d) ou trocar a TOP (venda, DB-3.11c) é a
 *     MESMA "precisa de aprovação", e o documento continua aberto (DB-3);
 *   · os quatro BEFORE UPDATE da venda, por nome: a guarda da aprovação dispara PRIMEIRO e a 0039 por ÚLTIMO (DB-4);
 *   · erp.top_exige_aprovacao, numa TABELA DE CASOS (o lado do banco do AP-11; o T6 compara a mesma conta com o
 *     domínio).
 *
 * Antes de aplicar (DB-5): a trava (2026,75) ocupada, o lock_timeout de 2s e CADA pré-condição quebrada numa
 * transação desfeita, cada uma com a SUA mensagem "TOP-CONFIG-08: …" — "já aplicada" antes de todas. Depois: o
 * ledger com 41 (DB-6), a reaplicação recusada e as pós-condições (só de OBJETOS), cada uma quebrada numa
 * transação desfeita com a sua mensagem.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação — o caminho que a API percorre). A venda confirma como a API nova confirma: com a
 * marca da 0023 (`app.venda_execucao_configurada` = id), sem a qual o formato ≥ 3 nem chegaria à guarda desta.
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let cliente: string; let fornecedor: string; let armazemA: string; let armazemB: string;
let outraOrg: string; let empresaOutraOrg: string;
let usuarioEscopoA: string; let usuarioEscopoAB: string; let usuarioOutraOrg: string; let outroUsuario: string;

const ALVO = "0041_regras_gerais_e_aprovacao_da_top.sql";

interface Top { top: string; versao: string }
interface Aprovacao { politica: string; valorMinimo: string | number | null }
const NENHUMA: Aprovacao = { politica: "nenhuma", valorMinimo: null };
const SEMPRE: Aprovacao = { politica: "sempre", valorMinimo: null };
const LIMITE = "1500.00";
const POR_VALOR: Aprovacao = { politica: "por_valor", valorMinimo: LIMITE };

/** As seções de hoje no neutro (o CHECK de forma da 0022 exige as cinco); só a aprovação e o formato variam. */
const SECOES = {
  geral: { confirmacao: "manual", exigeParceiro: false, exigeCentroResultado: false, exigeObservacao: false, alteracaoAposConfirmacao: "bloqueada", documentoSemItens: "proibido" },
  estoque: { atualizacao: "nenhuma", momento: "confirmacao", exigeArmazem: false, saldoNegativo: "bloquear" },
  financeiro: { atualizacao: "nenhuma", modo: "incluir", momento: "confirmacao", exigeFormaPagamento: false, exigeVencimento: false, exigeCentroResultado: false },
  fiscal: { habilitado: false, exigeDocumentoFiscal: false, exigeNaturezaOperacao: false, exigeRegraTributaria: false, calculoTributario: "nao_aplicar" }
};
/** Configuração no formato pedido; do 2 em diante, a execução em legado/legado (o 2 assim confirma sem a marca da 0023). */
function configuracao(versaoSchema: number, aprovacao: Aprovacao | null): Record<string, unknown> {
  return {
    versaoSchema, ...SECOES,
    ...(aprovacao ? { aprovacao: { ...aprovacao, momento: "antes_da_confirmacao" } } : {}),
    ...(versaoSchema >= 2 ? { execucao: { estoque: "legado", financeiro: "legado" } } : {})
  };
}

type NomeTop =
  | "venda4Sempre" | "venda4Valor" | "venda4Nenhuma" | "venda3Sempre" | "venda2Sempre" | "venda1Sempre"
  | "compra4Sempre" | "compra4Valor" | "compra4Nenhuma" | "compra3Sempre" | "pedido4Sempre"
  | "estoque4Sempre" | "estoque4Valor" | "estoque4Nenhuma" | "estoque3Sempre";
const tops = {} as Record<NomeTop, Top>;

type Tabela = "venda" | "compra" | "estoque";
const TABELAS: Tabela[] = ["venda", "compra", "estoque"];
const TABELA_SQL: Record<Tabela, string> = { venda: "erp.aprovacoes_venda", compra: "erp.aprovacoes_compra", estoque: "erp.aprovacoes_estoque" };
const MODULO: Record<Tabela, string> = { venda: "vendas", compra: "compras", estoque: "estoque" };
const DOCUMENTO_SQL: Record<Tabela, { tabela: string; situacao: string; aberto: string; confirmado: string }> = {
  venda: { tabela: "erp.sales_documents", situacao: "status", aberto: "open", confirmado: "confirmed" },
  compra: { tabela: "erp.documentos_compra", situacao: "situacao", aberto: "aberto", confirmado: "confirmado" },
  estoque: { tabela: "erp.documentos_estoque", situacao: "situacao", aberto: "aberto", confirmado: "confirmado" }
};
const topDe = (t: Tabela, p: "4Sempre" | "4Valor" | "4Nenhuma" | "3Sempre"): Top => tops[`${t}${p}` as NomeTop];

/** As mensagens fixas (uma linha, prefixo de código: o fromPgError traduz). */
const PRECISA = "CONFLICT: Este documento precisa de aprovação antes de ser confirmado.";
const REPROVADO = "CONFLICT: Este documento foi reprovado e não pode ser confirmado.";
const NAO_ENCONTRADO = "NOT_FOUND: Documento não encontrado";
const SO_ABERTO = "CONFLICT: Só documento aberto passa por aprovação.";
const NAO_EXIGIDA = "APROVACAO_NAO_EXIGIDA: Este documento não precisa de aprovação.";
const MUDOU = "CONCURRENCY_CONFLICT: Este documento mudou desde que você o abriu. Recarregue antes de salvar.";
const SEM_USUARIO = "PERMISSION_DENIED: A decisão de aprovação precisa de um usuário identificado.";
/** O CHECK do motivo da reprovação, como o catálogo o devolve (o mesmo nas três tabelas). */
const CHECK_REPROVACAO = "CHECK (((decisao = 'aprovado'::text) OR ((observacao IS NOT NULL) AND (observacao ~ '[^[:space:]]'::text))))";

let seq = 0;
const id1 = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;

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
/** Roda `sql` (a 0041, ou um trecho dela) numa transação DESFEITA no fim (depois de `antes`), e devolve o erro — ou falha, se aplicou. */
async function recusaDe(sql: string, antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a recusa, e o SQL aplicou");
}
const recusaDa0041 = (antes?: (c: Tx) => Promise<unknown>) => recusaDe(listMigrations().find((x) => x.name === ALVO)!.sql, antes);
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; detail?: string; hint?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; constraint?: string; detail?: string; hint?: string; message: string }; }
  throw new Error("esperava recusa, e o banco aceitou");
}
const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
const tabelasExistem = async () => (await db.query<{ venda: string | null; compra: string | null; estoque: string | null }>(
  "select to_regclass('erp.aprovacoes_venda')::text venda, to_regclass('erp.aprovacoes_compra')::text compra, to_regclass('erp.aprovacoes_estoque')::text estoque")).rows[0]!;
const NENHUMA_TABELA = { venda: null, compra: null, estoque: null };

/** TOP e versão 1 com a configuração dada (na MESMA transação: a FK da versão atual é adiada até o commit). */
async function criarTop(org: string, codigoBase: string, cfg: Record<string, unknown>): Promise<Top> {
  seq += 1;
  return withTx(db, { orgId: org, userId: null }, async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id",
      [org, `T08${seq}`, codigoBase])).rows[0]!.id;
    const versao = (await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
       values ($1,$2,1,$3,$4::jsonb,$5) returning id`,
      [org, top, `TOP aprovação ${codigoBase} ${seq}`, JSON.stringify(cfg), cfg.versaoSchema])).rows[0]!.id;
    return { top, versao };
  });
}

type DocVenda = Partial<{ total: string; empresa: string; status: string; kind: string; excluida: boolean }>;
async function venda(top: Top | null, o: DocVenda = {}): Promise<string> {
  seq += 1;
  return id1(
    `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, total, status, deleted_at, tipo_operacao_id, tipo_operacao_versao_id)
     values ($1,$2,$3,$4,'2026-10-01',$5,$6,$7,$8,$9,$10) returning id`,
    [demo.orgId, o.empresa ?? A, o.kind ?? "sale", `T08-${seq}`, cliente, o.total ?? "100.00", o.status ?? "open",
     o.excluida ? new Date() : null, top?.top ?? null, top?.versao ?? null]);
}
async function compra(top: Top, o: Partial<{ valor: string; empresa: string; especie: "compra" | "pedido" }> = {}): Promise<string> {
  seq += 1;
  // valor_total = valor_itens (+ frete + outras − desconto, zerados): o CHECK do total conferido da 0036.
  return id1(
    `insert into erp.documentos_compra (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, fornecedor_id,
       data_documento, valor_itens, valor_total)
     values ($1,$2,$3,$4,$5,$6,$7,'2026-10-01',$8,$8) returning id`,
    [demo.orgId, o.empresa ?? A, o.especie ?? "compra", `T08C-${seq}`, top.top, top.versao, fornecedor, o.valor ?? "100.00"]);
}
async function estoque(top: Top, o: Partial<{ empresa: string }> = {}): Promise<string> {
  seq += 1;
  const empresa = o.empresa ?? A;
  return id1(
    `insert into erp.documentos_estoque (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, armazem_id, data_documento)
     values ($1,$2,'entrada',$3,$4,$5,$6,'2026-10-01') returning id`,
    [demo.orgId, empresa, `T08E-${seq}`, top.top, top.versao, empresa === B ? armazemB : armazemA]);
}
/** Um documento aberto da tabela, com a TOP dada (o valor vale para venda e compra; o estoque não tem valor). */
const novoDoc = (t: Tabela, top: Top, o: { valor?: string; empresa?: string } = {}) =>
  t === "venda" ? venda(top, { total: o.valor, empresa: o.empresa }) : t === "compra" ? compra(top, { valor: o.valor, empresa: o.empresa }) : estoque(top, { empresa: o.empresa });

const versaoDe = async (id: string) => (await db.query<{ v: string }>("select version::text v from erp.sales_documents where id=$1", [id])).rows[0]!.v;
const estado = async (t: Tabela, id: string) => (await db.query<{ s: string }>(
  `select ${DOCUMENTO_SQL[t].situacao} s from ${DOCUMENTO_SQL[t].tabela} where id=$1`, [id])).rows[0]!.s;
const decisoesDe = async (t: Tabela, documento: string) => (await db.query<{ n: number }>(
  `select count(*)::int n from ${TABELA_SQL[t]} where documento_id=$1`, [documento])).rows[0]!.n;

const ctxDe = (t: Tabela, userId: string | null = demo.adminUserId): TenantContext => ({ orgId: demo.orgId, userId, modulo: MODULO[t] });

/** O que o INSERT pode mandar a mais — e que o gatilho tem de IGNORAR (atribui do documento e da transação). */
type Atribuidos = Partial<Record<"tipo_operacao_id" | "tipo_operacao_versao_id" | "valor_documento" | "decidido_por" | "decidido_em", unknown>>;
interface Decisao { decisao?: string; observacao?: string | null; versao?: string | null; org?: string; empresa?: string; atribuidos?: Atribuidos }

/** INSERT da decisão (via `q`: superusuário ou tx da aplicação). Na venda, a versão padrão é a ATUAL do documento. */
async function inserirDecisao(q: Queryable, t: Tabela, documento: string, o: Decisao = {}): Promise<string> {
  const decisao = o.decisao ?? "aprovado";
  const valores: Record<string, unknown> = {
    organization_id: o.org ?? demo.orgId, empresa_id: o.empresa ?? A, documento_id: documento, decisao,
    observacao: o.observacao !== undefined ? o.observacao : (decisao === "reprovado" ? "Preço acima da tabela" : null),
    ...(t === "venda" ? { versao_documento: o.versao !== undefined ? o.versao : await versaoDe(documento) } : {}),
    ...o.atribuidos
  };
  const cols = Object.keys(valores);
  const r = await q.query<{ id: string }>(
    `insert into ${TABELA_SQL[t]} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(valores));
  return r.rows[0]!.id;
}
/** A decisão como a API grava: papel da aplicação, organização/usuário/módulo da transação. */
const decidir = (t: Tabela, documento: string, o: Decisao = {}, ctx: TenantContext = ctxDe(t)) =>
  withTx(app, ctx, (tx) => inserirDecisao(tx, t, documento, o));

/** UPDATE da venda como a API nova faz (papel da aplicação, com a marca da 0023 DESTA venda). */
async function moverVenda(id: string, set: string, p: unknown[] = [], marca = true): Promise<void> {
  await withTx(app, ctxDe("venda"), async (tx) => {
    if (marca) await tx.query("select set_config('app.venda_execucao_configurada', $1, true)", [id]);
    const u = await tx.query(`update erp.sales_documents set ${set} where id=$1`, [id, ...p]);
    // A premissa: a linha é visível e atualizável para o papel. Sem isto, "passou" poderia ser zero linha.
    expect(u.rowCount, "a venda precisa ser visível para o papel da aplicação").toBe(1);
  });
}
/** Confirma como a API confirma, pelo papel da aplicação (no estoque, com os carimbos que o CHECK exige junto). */
async function confirmar(t: Tabela, id: string): Promise<void> {
  if (t === "venda") return moverVenda(id, "status='confirmed'");
  await withTx(app, ctxDe(t), async (tx) => {
    const u = t === "compra"
      ? await tx.query("update erp.documentos_compra set situacao='confirmado' where id=$1", [id])
      : await tx.query("update erp.documentos_estoque set situacao='confirmado', confirmado_em=now(), confirmado_por=$2 where id=$1", [id, demo.adminUserId]);
    expect(u.rowCount, "o documento precisa ser visível para o papel da aplicação").toBe(1);
  });
}
/** Cancela (superusuário): a saída do aberto que nenhuma guarda desta migration olha. */
function cancelar(t: Tabela, id: string) {
  if (t === "venda") return db.query("update erp.sales_documents set status='cancelled' where id=$1", [id]);
  if (t === "compra") return db.query("update erp.documentos_compra set situacao='cancelado' where id=$1", [id]);
  return db.query("update erp.documentos_estoque set situacao='cancelado', cancelado_em=now(), cancelado_por=$2, motivo_cancelamento='teste' where id=$1", [id, demo.adminUserId]);
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0041")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });

  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  cliente = await id1("select id from erp.people where organization_id=$1 and is_client and deleted_at is null order by code limit 1", [demo.orgId]);
  fornecedor = await id1("insert into erp.people (organization_id, code, name, is_provider) values ($1,'T08-F','[TEST] Fornecedor aprovação',true) returning id", [demo.orgId]);
  armazemA = await id1("insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,'T8A','[TEST] Armazem aprovação A') returning id", [demo.orgId, A]);
  armazemB = await id1("insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,'T8B','[TEST] Armazem aprovação B') returning id", [demo.orgId, B]);

  const criar = (base: string, formato: number, a: Aprovacao) => criarTop(demo.orgId, base, configuracao(formato, a));
  tops.venda4Sempre = await criar("vendas.venda", 4, SEMPRE);
  tops.venda4Valor = await criar("vendas.venda", 4, POR_VALOR);
  tops.venda4Nenhuma = await criar("vendas.venda", 4, NENHUMA);
  tops.venda3Sempre = await criar("vendas.venda", 3, SEMPRE);
  tops.venda2Sempre = await criar("vendas.venda", 2, SEMPRE);
  tops.venda1Sempre = await criar("vendas.venda", 1, SEMPRE);
  tops.compra4Sempre = await criar("compras.compra", 4, SEMPRE);
  tops.compra4Valor = await criar("compras.compra", 4, POR_VALOR);
  tops.compra4Nenhuma = await criar("compras.compra", 4, NENHUMA);
  tops.compra3Sempre = await criar("compras.compra", 3, SEMPRE);
  tops.pedido4Sempre = await criar("compras.pedido", 4, SEMPRE);
  tops.estoque4Sempre = await criar("estoque.entrada", 4, SEMPRE);
  // A matriz não deixa gravar "a partir de um valor" no estoque; o banco, se a encontrar, exige (sem valor = fail-closed).
  tops.estoque4Valor = await criar("estoque.entrada", 4, POR_VALOR);
  tops.estoque4Nenhuma = await criar("estoque.entrada", 4, NENHUMA);
  tops.estoque3Sempre = await criar("estoque.entrada", 3, SEMPRE);

  outraOrg = await id1("insert into erp.organizations (name, slug) values ('[TEST] Outra aprovação','outra-aprovacao') returning id");
  empresaOutraOrg = await id1("insert into erp.empresas (organization_id, code, name) values ($1, 93, '[TEST] Empresa outra org aprovação') returning id", [outraOrg]);

  outroUsuario = await id1("insert into erp.users (email, name, password_hash) values ('t08-outro@demo.local','T08 Outro','x') returning id");
  // Membro com escopo SELECIONADAS = [A] nos três módulos (vendas, compras, estoque), e nada nos outros (fail-closed).
  usuarioEscopoA = await membroSelecionadas(demo.orgId, "t08-a", [A]);
  // A contraprova do DB-2.12: o MESMO molde, com [A, B].
  usuarioEscopoAB = await membroSelecionadas(demo.orgId, "t08-ab", [A, B]);
  // Quem decide NA OUTRA organização (DB-2.2 e a contraprova do DB-2.11): membro dela com escopo [a empresa dela]. O
  // gatilho confere a empresa pelo escopo de quem decide; o administrador da demo não é membro da outra organização.
  usuarioOutraOrg = await membroSelecionadas(outraOrg, "t08-oo", [empresaOutraOrg]);
}, 300_000);
/** Usuário novo, membro ativo (não proprietário) de `org`, com escopo SELECIONADAS = `empresas` nos três módulos e nada nos outros. */
async function membroSelecionadas(org: string, rotulo: string, empresas: string[]): Promise<string> {
  const usuario = await id1("insert into erp.users (email, name, password_hash) values ($1,$2,'x') returning id", [`${rotulo}@demo.local`, `T08 ${rotulo}`]);
  const membro = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [org, usuario]);
  for (const modulo of ["vendas", "compras", "estoque"]) {
    await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,$3,'selecionadas')", [org, membro, modulo]);
    for (const empresa of empresas) {
      await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,$3,'selecionadas',$4)", [org, membro, modulo, empresa]);
    }
  }
  return usuario;
}
afterAll(async () => { await app?.end(); await db?.end(); });

describe("DB-5/DB-6 — a 0041 sobre o banco até a 0040, como o runner aplica", () => {
  it("DB-5.1 PREMISSA: sob a 0040 as tabelas não existem; o ledger tem 40 e a 0041 não está nele; o cenário tem duas empresas e as TOPs", async () => {
    expect(await noLedger()).toBe(false);
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: 40, ultima: "0040_documento_de_estoque.sql" });
    expect(await tabelasExistem()).toEqual(NENHUMA_TABELA);
    expect(A).not.toBe(B);
    const formatos = (await db.query<{ base: string; f: number; politica: string | null }>(
      `select t.codigo_base base, v.configuracao_schema_version f, v.configuracao -> 'aprovacao' ->> 'politica' politica
         from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id where v.id = $1`, [tops.venda4Valor.versao])).rows;
    expect(formatos).toEqual([{ base: "vendas.venda", f: 4, politica: "por_valor" }]);
    expect(Object.keys(tops)).toHaveLength(15);
  });

  it("DB-5.2 trava (2026,75) em uso por outra sessão: a 0041 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 75)");
      await expect(aplicar()).rejects.toThrow("TOP-CONFIG-08: outra transacao ja detem a trava desta migration (2026,75). Nada foi aplicado.");
    } finally { await outra.query("select pg_advisory_unlock(2026, 75)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await tabelasExistem()).toEqual(NENHUMA_TABELA);
  });

  it("DB-5.3 lock_timeout 2s: uma escrita aberta em erp.sales_documents (alvo de FK) faz a 0041 desistir em ~2s, sem efeito", async () => {
    const escritor = await db.connect();
    try {
      await escritor.query("begin");
      // RowExclusive na venda: a FK nova precisa de ShareRowExclusive no alvo, e as duas não convivem.
      await escritor.query("update erp.sales_documents set note = note where id is null");
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await escritor.query("rollback"); escritor.release(); }
    expect(await noLedger()).toBe(false);
    expect(await tabelasExistem()).toEqual(NENHUMA_TABELA);
  });

  it("DB-5.4 reversas: cada pré-condição quebrada recusa a 0041 com a SUA mensagem, sem efeito", async () => {
    // "Já aplicada": qualquer uma das três tabelas, das oito funções ou das três guardas.
    const TABELA_JA = "TOP-CONFIG-08: erp.aprovacoes_venda/erp.aprovacoes_compra/erp.aprovacoes_estoque ja existe; a 0041 ja foi aplicada ou ha schema divergente.";
    for (const t of ["aprovacoes_venda", "aprovacoes_compra", "aprovacoes_estoque"]) {
      expect([t, await recusaDa0041((c) => c.query(`create table erp.${t} (id int)`))]).toEqual([t, TABELA_JA]);
    }
    const FUNCAO_JA = "TOP-CONFIG-08: funcoes da aprovacao ja existem; a 0041 ja foi aplicada ou ha schema divergente.";
    expect(await recusaDa0041((c) => c.query("create function erp.top_exige_aprovacao(jsonb, numeric) returns boolean language sql as 'select true'"))).toBe(FUNCAO_JA);
    for (const fn of ["aprovacoes_venda_conferir", "aprovacoes_compra_conferir", "aprovacoes_estoque_conferir", "aprovacoes_imutavel",
      "venda_aprovacao_guarda", "documentos_compra_aprovacao_guarda", "documentos_estoque_aprovacao_guarda"]) {
      expect([fn, await recusaDa0041((c) => c.query(`create function erp.${fn}() returns trigger language plpgsql as 'begin return new; end'`))]).toEqual([fn, FUNCAO_JA]);
    }
    const GUARDA_JA = "TOP-CONFIG-08: guarda de transicao da aprovacao ja existe; a 0041 ja foi aplicada ou ha schema divergente.";
    for (const [tabela, gatilho] of [["sales_documents", "trg_sales_documents_aprovacao"], ["documentos_compra", "trg_documentos_compra_aprovacao"], ["documentos_estoque", "trg_documentos_estoque_aprovacao"]] as [string, string][]) {
      expect([gatilho, await recusaDa0041((c) => c.query(`create trigger ${gatilho} after update on erp.${tabela} for each row execute function erp.set_atualizado_em()`))])
        .toEqual([gatilho, GUARDA_JA]);
    }
    // "Já aplicada" vem ANTES de todas: com o papel sem bypass, uma coluna, um gatilho da venda e um módulo quebrados
    // JUNTO, o motivo dito é o verdadeiro.
    expect(await recusaDa0041(async (c) => {
      await c.query("alter table erp.sales_documents rename column version to version_t08");
      await c.query("drop trigger trg_sales_documents_versao on erp.sales_documents");
      await c.query("set local session_replication_role = replica");
      await c.query("delete from erp.modulos_escopo_empresa where chave='compras'");
      await c.query("set local session_replication_role = origin");
      await c.query("create table erp.aprovacoes_compra (id int)");
      await c.query("set local role erp_app");
    })).toBe(TABELA_JA);
    // Sem o papel da aplicação, os grants não teriam destinatário.
    expect(await recusaDa0041((c) => c.query("alter role erp_app rename to erp_app_t08")))
      .toBe("TOP-CONFIG-08: papel erp_app ausente (0007); os privilegios das tabelas novas nao teriam destinatario.");
    // Quem aplica não atravessa RLS (o papel da aplicação).
    expect(await recusaDa0041((c) => c.query("set local role erp_app")))
      .toBe("TOP-CONFIG-08: o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; os gatilhos nao veriam o documento nem a decisao.");
    // Cada coluna que os gatilhos leem (19).
    const COLUNA = "TOP-CONFIG-08: coluna lida pelos gatilhos ausente (sales_documents.version/total/status/kind/empresa_id/deleted_at/tipo_operacao_id/tipo_operacao_versao_id, documentos_compra.valor_total/situacao/especie/empresa_id/tipo_operacao_id/tipo_operacao_versao_id, documentos_estoque.situacao/empresa_id/tipo_operacao_id/tipo_operacao_versao_id, tipos_operacao_versoes.configuracao); a cadeia de migrations esta fora de ordem.";
    const colunas: [string, string][] = [
      ...["version", "total", "status", "kind", "empresa_id", "deleted_at", "tipo_operacao_id", "tipo_operacao_versao_id"].map((c): [string, string] => ["sales_documents", c]),
      ...["valor_total", "situacao", "especie", "empresa_id", "tipo_operacao_id", "tipo_operacao_versao_id"].map((c): [string, string] => ["documentos_compra", c]),
      ...["situacao", "empresa_id", "tipo_operacao_id", "tipo_operacao_versao_id"].map((c): [string, string] => ["documentos_estoque", c]),
      ["tipos_operacao_versoes", "configuracao"]
    ];
    expect(colunas).toHaveLength(19);
    for (const [tabela, coluna] of colunas) {
      expect([tabela, coluna, await recusaDa0041((c) => c.query(`alter table erp.${tabela} rename column ${coluna} to ${coluna}_t08`))]).toEqual([tabela, coluna, COLUNA]);
    }
    // As chaves que as FKs compostas referenciam, uma de cada vez.
    const CHAVE = "TOP-CONFIG-08: chave alvo das FKs compostas ausente (uq_tipos_operacao_versoes_tenant da 0021, uq_tipos_operacao_tenant da 0020, uq_documentos_compra_tenant da 0036, uq_documentos_estoque_tenant da 0040).";
    for (const [tabela, chave] of [["tipos_operacao_versoes", "uq_tipos_operacao_versoes_tenant"], ["tipos_operacao", "uq_tipos_operacao_tenant"],
      ["documentos_compra", "uq_documentos_compra_tenant"], ["documentos_estoque", "uq_documentos_estoque_tenant"]] as [string, string][]) {
      expect([chave, await recusaDa0041((c) => c.query(`alter table erp.${tabela} rename constraint ${chave} to ${chave}_t08`))]).toEqual([chave, CHAVE]);
    }
    // A chave (organization_id, id) de empresas: toda chave com essas duas colunas some.
    expect(await recusaDa0041(async (c) => {
      const nomes = (await c.query<{ conname: string }>(
        `select c.conname from pg_constraint c where c.conrelid='erp.empresas'::regclass and c.contype in ('u','p')
            and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid=c.conrelid and a.attnum = any (c.conkey)) = array['id','organization_id']`)).rows;
      expect(nomes.length, "a chave existe antes da sabotagem").toBeGreaterThan(0);
      for (const n of nomes) await c.query(`alter table erp.empresas drop constraint "${n.conname}" cascade`);
    })).toBe("TOP-CONFIG-08: chave (organization_id, id) de erp.empresas ausente; a FK composta da empresa nao teria alvo.");
    // Cada função de auditoria/RLS/usuário.
    for (const fn of ["audit_row()", "tenant_visible(uuid)", "escopo_empresa_total(text)", "empresas_do_membro(text)", "modulo_empresa_atual()", "current_user_id()",
      "current_org_id()", "empresa_escrita_permitida(uuid)"]) {
      expect([fn, await recusaDa0041((c) => c.query(`alter function erp.${fn} rename to t08_renomeada`))])
        .toEqual([fn, "TOP-CONFIG-08: funcoes de auditoria/RLS/usuario (0001/0007/0015) ausentes."]);
    }
    // Cada módulo de escopo (as FKs de quem o cita são desligadas só nesta transação desfeita).
    for (const modulo of ["vendas", "compras", "estoque"]) {
      expect([modulo, await recusaDa0041(async (c) => {
        await c.query("set local session_replication_role = replica");
        await c.query("delete from erp.modulos_escopo_empresa where chave=$1", [modulo]);
        await c.query("set local session_replication_role = origin");
      })]).toEqual([modulo, "TOP-CONFIG-08: modulos de escopo empresarial vendas/compras/estoque ausentes (0011)."]);
    }
    // O conjunto EXATO dos BEFORE UPDATE por linha da venda, por nome E por função: um a menos, um a mais, ou o
    // mesmo nome apontando para outra função.
    const GATILHOS = "TOP-CONFIG-08: gatilhos BEFORE UPDATE por linha de erp.sales_documents diferentes dos tres esperados (classificacao_financeira da 0024, execucao_configurada da 0023, versao da 0039): ";
    const CLASSIFICACAO = "\"trg_sales_documents_classificacao_financeira -> erp.venda_classificacao_financeira_guarda\"";
    const EXECUCAO = "\"trg_sales_documents_execucao_configurada -> erp.venda_execucao_configurada_guarda\"";
    expect(await recusaDa0041((c) => c.query("drop trigger trg_sales_documents_versao on erp.sales_documents")))
      .toBe(`${GATILHOS}{${CLASSIFICACAO},${EXECUCAO}}`);
    expect(await recusaDa0041((c) => c.query("create trigger trg_sales_documents_extra before update on erp.sales_documents for each row execute function erp.sales_documents_versao()")))
      .toBe(`${GATILHOS}{${CLASSIFICACAO},${EXECUCAO},"trg_sales_documents_extra -> erp.sales_documents_versao","trg_sales_documents_versao -> erp.sales_documents_versao"}`);
    expect(await recusaDa0041(async (c) => {
      await c.query("drop trigger trg_sales_documents_versao on erp.sales_documents");
      await c.query("create trigger trg_sales_documents_versao before update on erp.sales_documents for each row execute function erp.venda_execucao_configurada_guarda()");
    })).toBe(`${GATILHOS}{${CLASSIFICACAO},${EXECUCAO},"trg_sales_documents_versao -> erp.venda_execucao_configurada_guarda"}`);
    // Nada ficou: o ledger, as tabelas, as chaves e o papel são os de antes.
    expect(await noLedger()).toBe(false);
    expect(await tabelasExistem()).toEqual(NENHUMA_TABELA);
    expect((await db.query("select 1 from pg_roles where rolname='erp_app'")).rowCount).toBe(1);
    expect((await db.query("select 1 from pg_constraint where conname in ('uq_tipos_operacao_versoes_tenant','uq_tipos_operacao_tenant','uq_documentos_compra_tenant','uq_documentos_estoque_tenant')")).rowCount).toBe(4);
  });

  it("DB-6 aplica: ledger com 41 (a 0041 por último), tabelas criadas e trava liberada", async () => {
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: 41, ultima: ALVO });
    const noDisco = listMigrations().map((m) => m.name);
    expect(noDisco.length, "42 migrations no repositório (0001..0042)").toBe(42);
    expect(noDisco[40]).toBe(ALVO);
    expect(await tabelasExistem()).toEqual({ venda: "erp.aprovacoes_venda", compra: "erp.aprovacoes_compra", estoque: "erp.aprovacoes_estoque" });
    // A trava é de transação: depois do commit, outra sessão a obtém.
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 75) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });

  it("DB-5.5 reaplicar é recusado pela pré-condição 'já aplicada', sem efeito", async () => {
    expect(await recusaDa0041()).toBe("TOP-CONFIG-08: erp.aprovacoes_venda/erp.aprovacoes_compra/erp.aprovacoes_estoque ja existe; a 0041 ja foi aplicada ou ha schema divergente.");
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n).toBe(1);
  });

  /**
   * As PÓS-CONDIÇÕES só leem OBJETOS (catálogo), nunca contagem de tabela viva — no deploy a tabela viva tem o
   * dado de produção, e uma contagem dela aprovaria ou reprovaria pelo acervo, não pela migration. E cada uma
   * morde: o bloco delas (o trecho "8)" do arquivo, como está) roda de novo sobre o banco aplicado, com UM objeto
   * quebrado numa transação desfeita, e recusa com a SUA mensagem.
   */
  it("DB-5.6 pós-condições: só de objetos (nenhum FROM/JOIN em tabela do erp), e cada uma, quebrada, recusa com a sua mensagem", async () => {
    const sql = listMigrations().find((x) => x.name === ALVO)!.sql;
    const inicio = sql.indexOf("-- ---------- 8) pós-condições");
    expect(inicio, "o trecho 8) existe").toBeGreaterThan(0);
    const pos = sql.slice(inicio);
    expect(pos).toMatch(/^-- [^\n]*\ndo \$\$/);
    expect(pos.match(/\b(from|join)\s+erp\.\w+/gi), "nenhuma leitura de tabela do erp nas pós-condições").toBeNull();
    // Contraprova: sobre o banco aplicado, o bloco passa.
    const c = await db.connect();
    try { await c.query("begin"); await expect(c.query(pos)).resolves.toBeTruthy(); } finally { await c.query("rollback"); c.release(); }

    const M = "TOP-CONFIG-08: ";
    const GATILHOS_APROVACAO = `${M}gatilhos das tabelas de aprovacao (conferencia, imutabilidade por linha e por comando, auditoria) ausentes, a mais, desligados, de outro tipo ou na funcao errada (esperados exatamente 12).`;
    const casos: [string, string, string][] = [
      ["tabela ausente", "drop table erp.aprovacoes_estoque", `${M}as tabelas de aprovacao nao foram criadas.`],
      ["RLS sem force", "alter table erp.aprovacoes_compra no force row level security", `${M}tabela de aprovacao sem RLS habilitada e forcada.`],
      ["política a mais", "create policy t08_extra on erp.aprovacoes_estoque for select using (true)", `${M}politica das tabelas de aprovacao diferente de tenant_e_empresa (uma so).`],
      ["política ausente", "drop policy tenant_e_empresa on erp.aprovacoes_venda", `${M}politica das tabelas de aprovacao diferente de tenant_e_empresa (uma so).`],
      ["FK da TOP ausente", "alter table erp.aprovacoes_venda drop constraint fk_aprovacoes_venda_tipo_operacao", `${M}FKs das tabelas de aprovacao (documento, empresa, TOP, versao; sem cascata) incompletas (esperadas 12).`],
      ["FK do documento em cascata", "alter table erp.aprovacoes_compra drop constraint fk_aprovacoes_compra_documento, add constraint fk_aprovacoes_compra_documento foreign key (documento_id, organization_id) references erp.documentos_compra (id, organization_id) on delete cascade",
        `${M}FKs das tabelas de aprovacao (documento, empresa, TOP, versao; sem cascata) incompletas (esperadas 12).`],
      ["FK de empresa na ordem trocada", "alter table erp.aprovacoes_compra drop constraint fk_aprovacoes_compra_empresa, add constraint fk_aprovacoes_compra_empresa foreign key (empresa_id, organization_id) references erp.empresas (id, organization_id)",
        `${M}FK de empresa das tabelas de aprovacao fora da forma (organization_id, empresa_id) -> erp.empresas (organization_id, id).`],
      ["CHECK do motivo ausente", "alter table erp.aprovacoes_estoque drop constraint chk_aprovacoes_estoque_reprovacao", `${M}CHECKs das tabelas de aprovacao (decisao, observacao ate 500, motivo da reprovacao) incompletos (esperados 9).`],
      ["índice ausente", "drop index erp.ix_aprovacoes_estoque_documento", `${M}indice (organization_id, documento_id, id desc) das tabelas de aprovacao ausente.`],
      ["conta executável por PUBLIC", "grant execute on function erp.top_exige_aprovacao(jsonb, numeric) to public", `${M}erp.top_exige_aprovacao fora da forma (imutavel, sem SECURITY DEFINER, search_path "erp, pg_temp", EXECUTE do erp_app e nao de PUBLIC).`],
      ["conta volátil", "alter function erp.top_exige_aprovacao(jsonb, numeric) volatile", `${M}erp.top_exige_aprovacao fora da forma (imutavel, sem SECURITY DEFINER, search_path "erp, pg_temp", EXECUTE do erp_app e nao de PUBLIC).`],
      ["conferência sem definer", "alter function erp.aprovacoes_compra_conferir() security invoker", `${M}funcoes de gatilho da aprovacao sem SECURITY DEFINER (conferencias e guardas), ou sem search_path "erp, pg_temp".`],
      ["guarda com EXECUTE do erp_app", "grant execute on function erp.venda_aprovacao_guarda() to erp_app", `${M}EXECUTE das funcoes de gatilho da aprovacao ainda concedido alem do dono.`],
      ["imutabilidade desligada", "alter table erp.aprovacoes_compra disable trigger trg_aprovacoes_compra_imutavel", GATILHOS_APROVACAO],
      // O de TRUNCATE (por comando): desligado, ausente, ou AFTER em vez de BEFORE.
      ["imutabilidade do TRUNCATE desligada", "alter table erp.aprovacoes_venda disable trigger trg_aprovacoes_venda_imutavel_truncate", GATILHOS_APROVACAO],
      ["imutabilidade do TRUNCATE ausente", "drop trigger trg_aprovacoes_estoque_imutavel_truncate on erp.aprovacoes_estoque", GATILHOS_APROVACAO],
      ["imutabilidade do TRUNCATE depois (AFTER)", "drop trigger trg_aprovacoes_compra_imutavel_truncate on erp.aprovacoes_compra; create trigger trg_aprovacoes_compra_imutavel_truncate after truncate on erp.aprovacoes_compra for each statement execute function erp.aprovacoes_imutavel()",
        GATILHOS_APROVACAO],
      // Os doze esperados no lugar, e um a MAIS: o conjunto é EXATO.
      ["um décimo terceiro gatilho", "create trigger trg_aprovacoes_compra_zz before insert on erp.aprovacoes_compra for each row execute function erp.aprovacoes_imutavel()", GATILHOS_APROVACAO],
      ["guarda do estoque desligada", "alter table erp.documentos_estoque disable trigger trg_documentos_estoque_aprovacao", `${M}guardas de transicao da aprovacao ausentes, desligadas, de outro tipo (BEFORE UPDATE OF situacao/status com WHEN) ou na funcao errada (esperadas 3).`],
      ["WHEN da venda diferente do da 0023", "drop trigger trg_sales_documents_aprovacao on erp.sales_documents; create trigger trg_sales_documents_aprovacao before update of status on erp.sales_documents for each row when (NEW.status = 'confirmed' and NEW.tipo_operacao_versao_id is not null) execute function erp.venda_aprovacao_guarda()",
        `${M}o WHEN de trg_sales_documents_aprovacao nao e o mesmo de trg_sales_documents_execucao_configurada (0023).`],
      ["um quinto BEFORE UPDATE na venda", "create trigger trg_sales_documents_zz before update on erp.sales_documents for each row execute function erp.sales_documents_versao()",
        `${M}BEFORE UPDATE por linha de erp.sales_documents diferentes de aprovacao, classificacao_financeira, execucao_configurada e versao (nessa ordem): {trg_sales_documents_aprovacao,trg_sales_documents_classificacao_financeira,trg_sales_documents_execucao_configurada,trg_sales_documents_versao,trg_sales_documents_zz}`],
      ["UPDATE para o erp_app", "grant update on erp.aprovacoes_venda to erp_app", `${M}privilegios do erp_app nas tabelas de aprovacao errados (esperado so select e insert).`]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDe(pos, (t) => t.query(sabotagem))]).toEqual([nome, mensagem]);
    }
    // Nada ficou: as tabelas, a guarda e os privilégios são os da migration.
    expect(await tabelasExistem()).toEqual({ venda: "erp.aprovacoes_venda", compra: "erp.aprovacoes_compra", estoque: "erp.aprovacoes_estoque" });
    expect((await db.query<{ u: boolean }>("select has_table_privilege('erp_app', 'erp.aprovacoes_venda', 'update') u")).rows[0]!.u).toBe(false);
  });
});

describe("DB-1 — as três tabelas: objetos, FKs, RLS, índice, privilégios e imutabilidade", () => {
  const colunas = async (tabela: string) => (await db.query<{ c: string }>(
    `select column_name || ':' || case when data_type = 'numeric' then 'numeric(' || numeric_precision || ',' || numeric_scale || ')' else data_type end
            || ':' || is_nullable c
       from information_schema.columns where table_schema='erp' and table_name=$1 order by ordinal_position`, [tabela])).rows.map((x) => x.c);
  const OIDS = "('erp.aprovacoes_venda'::regclass, 'erp.aprovacoes_compra'::regclass, 'erp.aprovacoes_estoque'::regclass)";

  it("DB-1.1 colunas e tipos do contrato, na ordem; id identity ALWAYS; decidido_em com now(); toda tabela e coluna comentada", async () => {
    const comuns = ["id:bigint:NO", "organization_id:uuid:NO", "empresa_id:uuid:NO", "documento_id:uuid:NO", "tipo_operacao_id:uuid:NO", "tipo_operacao_versao_id:uuid:NO"];
    const decisao = ["decisao:text:NO", "observacao:text:YES", "decidido_por:uuid:NO", "decidido_em:timestamp with time zone:NO"];
    expect(await colunas("aprovacoes_venda")).toEqual([...comuns, "versao_documento:bigint:NO", "valor_documento:numeric(18,2):NO", ...decisao]);
    expect(await colunas("aprovacoes_compra")).toEqual([...comuns, "valor_documento:numeric(18,2):NO", ...decisao]);
    expect(await colunas("aprovacoes_estoque")).toEqual([...comuns, ...decisao]);
    const id = (await db.query<{ t: string; g: string }>(
      `select table_name t, identity_generation g from information_schema.columns
        where table_schema='erp' and table_name like 'aprovacoes\\_%' and is_identity='YES' and column_name='id' order by 1`)).rows;
    expect(id).toEqual([{ t: "aprovacoes_compra", g: "ALWAYS" }, { t: "aprovacoes_estoque", g: "ALWAYS" }, { t: "aprovacoes_venda", g: "ALWAYS" }]);
    const def = (await db.query<{ t: string; c: string; d: string }>(
      `select table_name t, column_name c, column_default d from information_schema.columns
        where table_schema='erp' and table_name like 'aprovacoes\\_%' and column_default is not null order by 1, 2`)).rows;
    expect(def).toEqual(["aprovacoes_compra", "aprovacoes_estoque", "aprovacoes_venda"].map((t) => ({ t, c: "decidido_em", d: "now()" })));
    // O dicionário de dados é gerado dos comentários.
    const sem = (await db.query<{ c: string }>(
      `select c.relname || '.' || coalesce(a.attname, '(tabela)') c
         from pg_class c left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where c.oid in ${OIDS}
          and (case when a.attname is null then obj_description(c.oid, 'pg_class') else col_description(c.oid, a.attnum) end) is null`)).rows;
    expect(sem).toEqual([]);
    expect((await db.query<{ n: number }>(`select count(*)::int n from pg_attribute where attrelid in ${OIDS} and attnum > 0 and not attisdropped`)).rows[0]!.n,
      "a conta acima varreu as 33 colunas").toBe(33);
  });

  it("DB-1.2 FKs: documento, versão da TOP (três colunas), TOP e empresa (organization_id, empresa_id → organization_id, id), sem cascata; e o índice", async () => {
    const r = (await db.query<{ conname: string; cols: string; alvo: string; cascata: boolean }>(
      `select c.conname,
              (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) cols,
              c.confrelid::regclass::text || '(' ||
                (select string_agg(a.attname, ',' order by k.ord) from unnest(c.confkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) || ')' alvo,
              (c.confdeltype <> 'a' or c.confupdtype <> 'a') cascata
         from pg_constraint c where c.conrelid in ${OIDS} and c.contype = 'f' order by c.conname collate "C"`)).rows;
    const esperadas = (t: Tabela) => {
      const p = `aprovacoes_${t}`;
      return [
        { conname: `${p}_decidido_por_fkey`, cols: "decidido_por", alvo: "erp.users(id)", cascata: false },
        { conname: `${p}_organization_id_fkey`, cols: "organization_id", alvo: "erp.organizations(id)", cascata: false },
        t === "venda"
          ? { conname: `fk_${p}_documento`, cols: "documento_id", alvo: "erp.sales_documents(id)", cascata: false }
          : { conname: `fk_${p}_documento`, cols: "documento_id,organization_id", alvo: `erp.documentos_${t}(id,organization_id)`, cascata: false },
        { conname: `fk_${p}_empresa`, cols: "organization_id,empresa_id", alvo: "erp.empresas(organization_id,id)", cascata: false },
        { conname: `fk_${p}_tipo_operacao`, cols: "tipo_operacao_id,organization_id", alvo: "erp.tipos_operacao(id,organization_id)", cascata: false },
        { conname: `fk_${p}_tipo_operacao_versao`, cols: "tipo_operacao_versao_id,tipo_operacao_id,organization_id", alvo: "erp.tipos_operacao_versoes(id,tipo_operacao_id,organization_id)", cascata: false }
      ];
    };
    expect(r).toEqual([...esperadas("compra"), ...esperadas("estoque"), ...esperadas("venda")].sort((x, y) => (x.conname < y.conname ? -1 : 1)));
    const idx = (await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname='erp' and tablename like 'aprovacoes\\_%' order by indexname collate \"C\"")).rows.map((x) => x.indexdef.replace(/ USING btree/, ""));
    expect(idx).toEqual([
      "CREATE UNIQUE INDEX aprovacoes_compra_pkey ON erp.aprovacoes_compra (id)",
      "CREATE UNIQUE INDEX aprovacoes_estoque_pkey ON erp.aprovacoes_estoque (id)",
      "CREATE UNIQUE INDEX aprovacoes_venda_pkey ON erp.aprovacoes_venda (id)",
      "CREATE INDEX ix_aprovacoes_compra_documento ON erp.aprovacoes_compra (organization_id, documento_id, id DESC)",
      "CREATE INDEX ix_aprovacoes_estoque_documento ON erp.aprovacoes_estoque (organization_id, documento_id, id DESC)",
      "CREATE INDEX ix_aprovacoes_venda_documento ON erp.aprovacoes_venda (organization_id, documento_id, id DESC)"
    ]);
  });

  /** Cenário com os gatilhos DO USUÁRIO da tabela de decisão desligados, numa transação desfeita: a FK sozinha recusa. */
  async function semGatilhos<T>(t: Tabela, fn: (q: Tx) => Promise<T>): Promise<T> {
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query(`alter table ${TABELA_SQL[t]} disable trigger user`);
      return await fn(c);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
  }
  it("DB-1.3 as FKs recusam sozinhas (gatilho desligado): empresa de outra organização, versão de outra TOP, documento e decidido_por inexistentes", async () => {
    for (const t of TABELAS) {
      const top = topDe(t, "4Sempre"); const outra = topDe(t, "4Valor");
      const d = await novoDoc(t, top);
      const linha = (o: Partial<Record<string, unknown>>) => ({
        organization_id: demo.orgId, empresa_id: A, documento_id: d, tipo_operacao_id: top.top, tipo_operacao_versao_id: top.versao,
        decisao: "aprovado", decidido_por: demo.adminUserId, decidido_em: new Date(),
        ...(t === "venda" ? { versao_documento: 0 } : {}), ...(t === "estoque" ? {} : { valor_documento: "1.00" }), ...o
      });
      const inserir = (o: Partial<Record<string, unknown>>) => semGatilhos(t, (q) => {
        const v = linha(o); const cols = Object.keys(v);
        return q.query(`insert into ${TABELA_SQL[t]} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(v));
      });
      // Contraprova: a linha inteira, coerente, passa.
      await expect(inserir({})).resolves.toMatchObject({ rowCount: 1 });
      const p = `aprovacoes_${t}`;
      expect([t, (await erroDe(inserir({ empresa_id: empresaOutraOrg }))).constraint]).toEqual([t, `fk_${p}_empresa`]);
      expect([t, (await erroDe(inserir({ tipo_operacao_versao_id: outra.versao }))).constraint]).toEqual([t, `fk_${p}_tipo_operacao_versao`]);
      expect([t, (await erroDe(inserir({ documento_id: "00000000-0000-4000-8000-000000000001" }))).constraint]).toEqual([t, `fk_${p}_documento`]);
      expect([t, (await erroDe(inserir({ decidido_por: "00000000-0000-4000-8000-000000000002" }))).constraint]).toEqual([t, `${p}_decidido_por_fkey`]);
    }
  });

  it("DB-1.4 RLS habilitada e FORÇADA; uma política, tenant_e_empresa, com o MESMO gabarito da 0040 (documentos_estoque); gatilhos e funções no lugar", async () => {
    const rls = (await db.query<{ relname: string; r: boolean; f: boolean }>(
      `select relname, relrowsecurity r, relforcerowsecurity f from pg_class where oid in ${OIDS} order by relname`)).rows;
    expect(rls).toEqual(["aprovacoes_compra", "aprovacoes_estoque", "aprovacoes_venda"].map((relname) => ({ relname, r: true, f: true })));
    const pol = (await db.query<{ tablename: string; policyname: string; cmd: string; roles: string[]; qual: string; with_check: string }>(
      `select tablename, policyname, cmd, roles::text[] roles, qual, with_check from pg_policies
        where schemaname='erp' and (tablename like 'aprovacoes\\_%' or tablename = 'documentos_estoque') order by tablename`)).rows;
    expect(pol.map((p) => p.tablename)).toEqual(["aprovacoes_compra", "aprovacoes_estoque", "aprovacoes_venda", "documentos_estoque"]);
    const molde = pol[3]!;
    expect(molde.qual, "o molde recorta pela empresa do módulo").toMatch(/empresas_do_membro\(erp\.modulo_empresa_atual\(\)\)/);
    for (const p of pol.slice(0, 3)) {
      expect([p.tablename, p.policyname, p.cmd, [...p.roles].sort(), p.qual, p.with_check])
        .toEqual([p.tablename, "tenant_e_empresa", "ALL", ["authenticated", "erp_app"], molde.qual, molde.with_check]);
    }
    const trg = (await db.query<{ def: string }>(
      `select pg_get_triggerdef(oid) def from pg_trigger where tgrelid in ${OIDS} and not tgisinternal and tgenabled='O' order by tgname collate "C"`)).rows.map((x) => x.def);
    expect(trg).toEqual(["compra", "estoque", "venda"].flatMap((t) => [
      `CREATE TRIGGER trg_aprovacoes_${t}_audit AFTER INSERT OR DELETE OR UPDATE ON erp.aprovacoes_${t} FOR EACH ROW EXECUTE FUNCTION erp.audit_row()`,
      `CREATE TRIGGER trg_aprovacoes_${t}_conferir BEFORE INSERT ON erp.aprovacoes_${t} FOR EACH ROW EXECUTE FUNCTION erp.aprovacoes_${t}_conferir()`,
      `CREATE TRIGGER trg_aprovacoes_${t}_imutavel BEFORE DELETE OR UPDATE ON erp.aprovacoes_${t} FOR EACH ROW EXECUTE FUNCTION erp.aprovacoes_imutavel()`,
      // O TRUNCATE não passa pelos gatilhos por linha: um por comando, na MESMA função (DB-1.9).
      `CREATE TRIGGER trg_aprovacoes_${t}_imutavel_truncate BEFORE TRUNCATE ON erp.aprovacoes_${t} FOR EACH STATEMENT EXECUTE FUNCTION erp.aprovacoes_imutavel()`
    ]));
    const fns = (await db.query<{ fn: string; definer: boolean; vol: string; cfg: string[]; app: boolean; publico: boolean }>(
      `select p.proname fn, p.prosecdef definer, p.provolatile vol, p.proconfig cfg, has_function_privilege('erp_app', p.oid, 'execute') app,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) publico
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='erp' and p.proname in ('aprovacoes_venda_conferir','aprovacoes_compra_conferir','aprovacoes_estoque_conferir','aprovacoes_imutavel',
                                                 'venda_aprovacao_guarda','documentos_compra_aprovacao_guarda','documentos_estoque_aprovacao_guarda','top_exige_aprovacao')
        order by 1`)).rows;
    const CFG = ["search_path=erp, pg_temp"];
    expect(fns).toEqual([
      { fn: "aprovacoes_compra_conferir", definer: true, vol: "v", cfg: CFG, app: false, publico: false },
      { fn: "aprovacoes_estoque_conferir", definer: true, vol: "v", cfg: CFG, app: false, publico: false },
      { fn: "aprovacoes_imutavel", definer: false, vol: "v", cfg: CFG, app: false, publico: false },
      { fn: "aprovacoes_venda_conferir", definer: true, vol: "v", cfg: CFG, app: false, publico: false },
      { fn: "documentos_compra_aprovacao_guarda", definer: true, vol: "v", cfg: CFG, app: false, publico: false },
      { fn: "documentos_estoque_aprovacao_guarda", definer: true, vol: "v", cfg: CFG, app: false, publico: false },
      // A conta: imutável, invoker, executável pelo erp_app (a fila de aprovações a usa em SQL) e não por PUBLIC.
      { fn: "top_exige_aprovacao", definer: false, vol: "i", cfg: CFG, app: true, publico: false },
      { fn: "venda_aprovacao_guarda", definer: true, vol: "v", cfg: CFG, app: false, publico: false }
    ]);
    const dono = (await db.query<{ ok: boolean }>(
      `select bool_and(r.rolsuper or r.rolbypassrls) ok from pg_proc p join pg_roles r on r.oid = p.proowner
        where p.oid in ('erp.aprovacoes_venda_conferir()'::regprocedure, 'erp.aprovacoes_compra_conferir()'::regprocedure, 'erp.aprovacoes_estoque_conferir()'::regprocedure,
                        'erp.venda_aprovacao_guarda()'::regprocedure, 'erp.documentos_compra_aprovacao_guarda()'::regprocedure, 'erp.documentos_estoque_aprovacao_guarda()'::regprocedure)`)).rows[0]!.ok;
    expect(dono, "o dono das definer atravessa a RLS (enxerga o documento e a decisão)").toBe(true);
    const fonte = (await db.query<{ src: string }>("select prosrc src from pg_proc where oid = 'erp.top_exige_aprovacao(jsonb,numeric)'::regprocedure")).rows[0]!.src;
    expect(fonte.match(/\b(from|join)\s+erp\.\w+/gi), "a conta não lê tabela").toBeNull();
  });

  it("DB-1.5 privilégios do papel da aplicação: só select e insert — UPDATE, DELETE e TRUNCATE recusados (42501)", async () => {
    const priv = (await db.query<{ s: boolean; i: boolean; u: boolean; d: boolean; t: boolean }>(
      `select bool_and(has_table_privilege('erp_app', t, 'select')) s, bool_and(has_table_privilege('erp_app', t, 'insert')) i,
              bool_or(has_table_privilege('erp_app', t, 'update')) u, bool_or(has_table_privilege('erp_app', t, 'delete')) d,
              bool_or(has_table_privilege('erp_app', t, 'truncate')) t
         from unnest(array['erp.aprovacoes_venda','erp.aprovacoes_compra','erp.aprovacoes_estoque']) t`)).rows[0];
    expect(priv).toEqual({ s: true, i: true, u: false, d: false, t: false });
    for (const t of TABELAS) {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      const id = await decidir(t, d);
      for (const sql of [`update ${TABELA_SQL[t]} set observacao='x' where id=$1`, `delete from ${TABELA_SQL[t]} where id=$1`, `truncate ${TABELA_SQL[t]}`]) {
        const p = sql.startsWith("truncate") ? [] : [id];
        expect([t, sql, (await erroDe(withTx(app, ctxDe(t), (tx) => tx.query(sql, p)))).code]).toEqual([t, sql, "42501"]);
      }
      expect(await decisoesDe(t, d)).toBe(1);
    }
  });

  it("DB-1.6 imutabilidade: nem o dono (superusuário) edita ou apaga uma decisão — o gatilho recusa UPDATE e DELETE", async () => {
    for (const t of TABELAS) {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      const id = await decidir(t, d, { decisao: "reprovado", observacao: "Fora do orçamento" });
      expect([t, (await erroDe(db.query(`update ${TABELA_SQL[t]} set decisao='aprovado' where id=$1`, [id]))).message])
        .toEqual([t, "CONFLICT: A decisão de aprovação não aceita UPDATE (uma decisão nova registra a mudança)."]);
      expect([t, (await erroDe(db.query(`delete from ${TABELA_SQL[t]} where id=$1`, [id]))).message])
        .toEqual([t, "CONFLICT: A decisão de aprovação não aceita DELETE (uma decisão nova registra a mudança)."]);
      expect((await db.query<{ decisao: string; observacao: string }>(`select decisao, observacao from ${TABELA_SQL[t]} where id=$1`, [id])).rows)
        .toEqual([{ decisao: "reprovado", observacao: "Fora do orçamento" }]);
    }
  });

  /**
   * O with check SOZINHO: o gatilho de conferência desligado numa transação DESFEITA (superusuário), e o papel da
   * aplicação com as GUCs de `ctx`. A linha vai inteira e coerente (o que o gatilho atribuiria vem do documento).
   */
  async function soWithCheck(t: Tabela, ctx: TenantContext, documento: string, empresa: string, top: Top) {
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query(`alter table ${TABELA_SQL[t]} disable trigger trg_aprovacoes_${t}_conferir`);
      const linha: Record<string, unknown> = {
        organization_id: demo.orgId, empresa_id: empresa, documento_id: documento, tipo_operacao_id: top.top, tipo_operacao_versao_id: top.versao,
        decisao: "aprovado", decidido_por: ctx.userId, decidido_em: new Date(),
        ...(t === "venda" ? { versao_documento: await versaoDe(documento) } : {}), ...(t === "estoque" ? {} : { valor_documento: "100.00" })
      };
      await c.query("select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.modulo_empresa', $3, true)",
        [ctx.orgId ?? "", ctx.userId ?? "", ctx.modulo ?? ""]);
      await c.query("set local role erp_app");
      const cols = Object.keys(linha);
      return await c.query(`insert into ${TABELA_SQL[t]} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(linha));
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
  }
  it("DB-1.7 RLS sob o papel da aplicação: o membro [A] vê e grava só a empresa A; módulo sem configuração e sem organização não veem nada", async () => {
    for (const t of TABELAS) {
      const top = topDe(t, "4Sempre");
      const dA = await novoDoc(t, top, { empresa: A }); const dB = await novoDoc(t, top, { empresa: B });
      const idA = await decidir(t, dA, { empresa: A }); const idB = await decidir(t, dB, { empresa: B });
      const ler = (ctx: TenantContext) => withTx(app, ctx, async (tx) =>
        (await tx.query<{ id: string }>(`select id::text id from ${TABELA_SQL[t]} where id = any($1::bigint[])`, [[idA, idB]])).rows.map((r) => r.id).sort());
      expect([t, await ler(ctxDe(t))]).toEqual([t, [idA, idB].sort()]);
      expect([t, await ler(ctxDe(t, usuarioEscopoA))]).toEqual([t, [idA]]);
      // Módulo sem configuração para o membro (financeiro): NENHUMA empresa — fail-closed, nunca "todas".
      expect([t, await ler({ ...ctxDe(t, usuarioEscopoA), modulo: "financeiro" })]).toEqual([t, []]);
      expect([t, await ler({ orgId: null, userId: demo.adminUserId, modulo: MODULO[t] })]).toEqual([t, []]);
      // Gravar em B: o gatilho (definer) confere a empresa da linha pelo MESMO predicado do with check, ANTES de ler o
      // documento, e recusa com a NOT_FOUND de inexistente. Antes desta conferência, o gatilho LIA o documento de B e
      // deixava passar, e a recusa era a 42501 do with check — que vinha depois da leitura, e só quando o documento de
      // B estava aberto e exigindo (nas outras situações a recusa do gatilho dizia a situação: DB-2.12). A NOT_FOUND
      // é a mais forte: a mesma de inexistente, e sem ler nada.
      const e = await erroDe(decidir(t, dB, { empresa: B }, ctxDe(t, usuarioEscopoA)));
      expect([t, e.message, e.code]).toEqual([t, NAO_ENCONTRADO, "P0001"]);
      // O with check continua de pé ATRÁS do gatilho (segunda linha): sem a conferência, a MESMA linha do membro [A]
      // em B, pelo papel da aplicação, é a 42501 da RLS; contraprova: a linha dele em A passa no with check.
      expect([t, (await erroDe(soWithCheck(t, ctxDe(t, usuarioEscopoA), dB, B, top))).code]).toEqual([t, "42501"]);
      expect([t, (await soWithCheck(t, ctxDe(t, usuarioEscopoA), dA, A, top)).rowCount]).toEqual([t, 1]);
      const idMembro = await decidir(t, dA, { empresa: A }, ctxDe(t, usuarioEscopoA));
      expect((await db.query<{ por: string }>(`select decidido_por por from ${TABELA_SQL[t]} where id=$1`, [idMembro])).rows[0]!.por).toBe(usuarioEscopoA);
      expect(await decisoesDe(t, dB)).toBe(1);
    }
  });

  it("DB-1.8 auditoria por erp.audit_row: a decisão grava 'create' em erp.audit_logs com o id (bigint) como texto e o usuário da GUC", async () => {
    for (const t of TABELAS) {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      const id = await decidir(t, d, { decisao: "reprovado", observacao: "Sem verba" });
      const r = (await db.query<{ action: string; user_id: string; org: string; decisao: string }>(
        "select action, user_id, organization_id org, after->>'decisao' decisao from erp.audit_logs where entity=$1 and entity_id=$2 order by id", [`aprovacoes_${t}`, id])).rows;
      expect([t, r]).toEqual([t, [{ action: "create", user_id: demo.adminUserId, org: demo.orgId, decisao: "reprovado" }]]);
    }
  });

  /**
   * O TRUNCATE não passa pelos gatilhos POR LINHA (DB-1.6): sem o gatilho POR COMANDO, o dono apagaria a história
   * inteira de uma vez. O DB-1.5 prova que o papel da aplicação nem tem o privilégio (42501); aqui é o DONO da
   * tabela (a conexão de superusuário que aplicou a migration), que tem — e recebe a MESMA CONFLICT da imutabilidade.
   */
  it("DB-1.9 TRUNCATE pelo DONO, em cada uma das três tabelas com linhas: a CONFLICT da imutabilidade, e as linhas continuam lá", async () => {
    const dono = (await db.query<{ ok: boolean }>(
      `select bool_and(pg_get_userbyid(c.relowner) = current_user) ok from pg_class c where c.oid in ${OIDS}`)).rows[0]!.ok;
    expect(dono, "PREMISSA: quem trunca é o dono das três tabelas (o privilégio não é o que recusa)").toBe(true);
    const contar = async (t: Tabela) => (await db.query<{ n: number }>(`select count(*)::int n from ${TABELA_SQL[t]}`)).rows[0]!.n;
    for (const t of TABELAS) {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      await decidir(t, d);
      const antes = await contar(t);
      expect([t, antes > 0], "PREMISSA: há linha para o TRUNCATE apagar").toEqual([t, true]);
      // Fora de transação: se o TRUNCATE passasse, as linhas sumiriam de fato (nenhum rollback as devolveria).
      const e = await erroDe(db.query(`truncate ${TABELA_SQL[t]}`));
      expect([t, e.message, e.code]).toEqual([t, "CONFLICT: A decisão de aprovação não aceita TRUNCATE (uma decisão nova registra a mudança).", "P0001"]);
      expect([t, await contar(t), await decisoesDe(t, d)]).toEqual([t, antes, 1]);
    }
  });

  it("DB-1.10 reprovação com motivo só de tab e quebra de linha → 23514 (o CHECK do motivo), nas três; com texto entre eles, grava", async () => {
    // O btrim sem segundo argumento só tira o espaço comum: com ele, estes motivos "em branco" passavam.
    const EM_BRANCO = ["\t\n", "\n", "\t", "\r\n", " \t \n "];
    for (const t of TABELAS) {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      const p = `aprovacoes_${t}`;
      for (const observacao of EM_BRANCO) {
        const e = await erroDe(decidir(t, d, { decisao: "reprovado", observacao }));
        expect([t, JSON.stringify(observacao), e.code, e.constraint]).toEqual([t, JSON.stringify(observacao), "23514", `chk_${p}_reprovacao`]);
      }
      expect(await decisoesDe(t, d)).toBe(0);
      // Contraprova: o mesmo documento, reprovado com texto entre o tab e a quebra de linha, grava (o motivo é guardado como veio).
      const id = await decidir(t, d, { decisao: "reprovado", observacao: "\tFaltou cotação\n" });
      expect((await db.query<{ o: string }>(`select observacao o from ${TABELA_SQL[t]} where id=$1`, [id])).rows).toEqual([{ o: "\tFaltou cotação\n" }]);
    }
    // E o catálogo: o MESMO CHECK nas três, pela classe de espaço — o btrim não está mais nele.
    const defs = (await db.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid in ${OIDS} and conname like 'chk\\_%\\_reprovacao' order by conname`)).rows;
    expect(defs).toEqual(["compra", "estoque", "venda"].map((t) => ({ conname: `chk_aprovacoes_${t}_reprovacao`, def: CHECK_REPROVACAO })));
  });
});

describe("DB-2 — o gatilho de inserção: recusas, ordem e o que ele ATRIBUI", () => {
  it("DB-2.1 sem usuário na transação: PERMISSION_DENIED antes de ler o documento (mesmo inexistente)", async () => {
    for (const t of TABELAS) {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      expect([t, (await erroDe(decidir(t, d, {}, ctxDe(t, null)))).message]).toEqual([t, SEM_USUARIO]);
      // Superusuário com a organização e o módulo da transação, sem usuário: a mesma recusa (a definer não depende da RLS).
      expect([t, (await erroDe(withTx(db, { orgId: demo.orgId, userId: null, modulo: MODULO[t] }, (tx) => inserirDecisao(tx, t, d)))).message]).toEqual([t, SEM_USUARIO]);
      expect([t, (await erroDe(decidir(t, "00000000-0000-4000-8000-000000000003", { versao: "0" }, ctxDe(t, null)))).message]).toEqual([t, SEM_USUARIO]);
      expect(await decisoesDe(t, d)).toBe(0);
    }
  });

  it("DB-2.2 a MESMA NOT_FOUND: inexistente, de outra organização (superusuário e papel da aplicação), de outra empresa", async () => {
    for (const t of TABELAS) {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      expect([t, "inexistente", (await erroDe(decidir(t, "00000000-0000-4000-8000-000000000004", { versao: "0" }))).message]).toEqual([t, "inexistente", NAO_ENCONTRADO]);
      const outraOrgDecisao = { org: outraOrg, empresa: empresaOutraOrg };
      // Superusuário com o contexto de quem decide NA OUTRA organização (membro dela, com a empresa dela no escopo do
      // módulo): a organização e a empresa da linha passam nas conferências, e a NOT_FOUND é a da LEITURA — o
      // documento é da demo, e o gatilho só lê pela organização da GUC.
      const ctxOutraOrg: TenantContext = { orgId: outraOrg, userId: usuarioOutraOrg, modulo: MODULO[t] };
      expect([t, "premissa: a empresa da linha está no escopo", await withTx(db, ctxOutraOrg, async (tx) =>
        (await tx.query<{ ok: boolean }>("select erp.empresa_escrita_permitida($1) ok", [empresaOutraOrg])).rows[0]!.ok)])
        .toEqual([t, "premissa: a empresa da linha está no escopo", true]);
      expect([t, "outra org (dono)", (await erroDe(withTx(db, ctxOutraOrg, (tx) => inserirDecisao(tx, t, d, outraOrgDecisao)))).message])
        .toEqual([t, "outra org (dono)", NAO_ENCONTRADO]);
      // O BEFORE INSERT (definer) roda ANTES do with check da RLS: o papel da aplicação recebe a NOT_FOUND, não a 42501.
      expect([t, "outra org (app)", (await erroDe(decidir(t, d, outraOrgDecisao))).message]).toEqual([t, "outra org (app)", NAO_ENCONTRADO]);
      expect([t, "outra empresa", (await erroDe(decidir(t, d, { empresa: B }))).message]).toEqual([t, "outra empresa", NAO_ENCONTRADO]);
      expect(await decisoesDe(t, d)).toBe(0);
    }
  });

  it("DB-2.3 a MESMA NOT_FOUND para outra espécie e excluído: venda que não é 'sale' (orçamento, pedido), venda excluída, pedido de compra", async () => {
    for (const kind of ["budget", "order"]) {
      const d = await venda(tops.venda4Sempre, { kind });
      expect([kind, (await erroDe(decidir("venda", d))).message]).toEqual([kind, NAO_ENCONTRADO]);
    }
    expect((await erroDe(decidir("venda", await venda(tops.venda4Sempre, { excluida: true })))).message).toBe(NAO_ENCONTRADO);
    expect((await erroDe(decidir("compra", await compra(tops.pedido4Sempre, { especie: "pedido" })))).message).toBe(NAO_ENCONTRADO);
  });

  it("DB-2.4 documento fora do aberto: CONFLICT 'Só documento aberto passa por aprovação.'; a venda 'approved' (0005) conta como aberta", async () => {
    for (const status of ["confirmed", "invoiced", "cancelled", "converted"]) {
      const d = await venda(tops.venda4Sempre, { status });
      expect([status, (await erroDe(decidir("venda", d))).message]).toEqual([status, SO_ABERTO]);
    }
    await expect(decidir("venda", await venda(tops.venda4Sempre, { status: "approved" }))).resolves.toMatch(/^\d+$/);
    for (const t of ["compra", "estoque"] as Tabela[]) {
      const cancelado = await novoDoc(t, topDe(t, "4Sempre"));
      await cancelar(t, cancelado);
      expect([t, "cancelado", (await erroDe(decidir(t, cancelado))).message]).toEqual([t, "cancelado", SO_ABERTO]);
      const confirmado = await novoDoc(t, topDe(t, "4Sempre"));
      await decidir(t, confirmado);
      await confirmar(t, confirmado);
      expect([t, "confirmado", (await erroDe(decidir(t, confirmado))).message]).toEqual([t, "confirmado", SO_ABERTO]);
    }
  });

  it("DB-2.5 documento que não exige: formato 3 com 'sempre', formato 4 'nenhuma', venda sem TOP e 'a partir de 1500.00' com 1499.99", async () => {
    for (const t of TABELAS) {
      for (const top of [topDe(t, "3Sempre"), topDe(t, "4Nenhuma")]) {
        const d = await novoDoc(t, top);
        expect([t, top.versao, (await erroDe(decidir(t, d))).message]).toEqual([t, top.versao, NAO_EXIGIDA]);
      }
    }
    expect((await erroDe(decidir("venda", await venda(null))))).toMatchObject({ message: NAO_EXIGIDA });
    for (const t of ["venda", "compra"] as Tabela[]) {
      const d = await novoDoc(t, topDe(t, "4Valor"), { valor: "1499.99" });
      expect([t, (await erroDe(decidir(t, d))).message]).toEqual([t, NAO_EXIGIDA]);
      // A conta usa o total ATUAL: o mesmo documento, com 1500.00, passa a exigir (e o valor gravado é o novo).
      if (t === "venda") await db.query("update erp.sales_documents set total='1500.00' where id=$1", [d]);
      else await db.query("update erp.documentos_compra set valor_itens='1500.00', valor_total='1500.00' where id=$1", [d]);
      const id = await decidir(t, d);
      expect((await db.query<{ v: string }>(`select valor_documento::text v from ${TABELA_SQL[t]} where id=$1`, [id])).rows[0]!.v).toBe("1500.00");
    }
  });

  it("DB-2.6 venda: versão diferente da atual (anterior, seguinte ou nula) → CONCURRENCY_CONFLICT", async () => {
    const d = await venda(tops.venda4Sempre);
    await db.query("update erp.sales_documents set note='v1' where id=$1", [d]);
    const atual = await versaoDe(d);
    expect(atual).toBe("1");
    for (const versao of ["0", "2", null]) {
      expect([versao, (await erroDe(decidir("venda", d, { versao }))).message]).toEqual([versao, MUDOU]);
    }
    expect(await decisoesDe("venda", d)).toBe(0);
    await expect(decidir("venda", d, { versao: atual })).resolves.toMatch(/^\d+$/);
  });

  it("DB-2.7 a ordem das recusas: usuário → organização → empresa no escopo → 404 → versão (409) → situação (409) → exigência (409)", async () => {
    // Confirmada, de outra empresa e com a versão errada: a 404 vence.
    const confirmada = await venda(tops.venda4Nenhuma, { status: "confirmed" });
    expect((await erroDe(decidir("venda", confirmada, { empresa: B, versao: "9" }))).message).toBe(NAO_ENCONTRADO);
    // O membro [A] pedindo com a empresa B (fora do escopo dele): a NOT_FOUND da empresa vence a versão e a situação;
    // a mesma linha sem usuário: o usuário vem antes de tudo. Com a empresa A (no escopo), a versão volta a falar.
    expect((await erroDe(decidir("venda", confirmada, { empresa: B, versao: "9" }, ctxDe("venda", usuarioEscopoA)))).message).toBe(NAO_ENCONTRADO);
    expect((await erroDe(decidir("venda", confirmada, { empresa: B, versao: "9" }, ctxDe("venda", null)))).message).toBe(SEM_USUARIO);
    expect((await erroDe(decidir("venda", confirmada, { versao: "9" }, ctxDe("venda", usuarioEscopoA)))).message).toBe(MUDOU);
    // Confirmada e com a versão errada: a concorrência vence a situação.
    expect((await erroDe(decidir("venda", confirmada, { versao: "9" }))).message).toBe(MUDOU);
    // Confirmada e sem exigência: a situação vence a exigência.
    expect((await erroDe(decidir("venda", confirmada))).message).toBe(SO_ABERTO);
    for (const t of ["compra", "estoque"] as Tabela[]) {
      const d = await novoDoc(t, topDe(t, "4Nenhuma"));
      await cancelar(t, d);
      expect([t, (await erroDe(decidir(t, d, { empresa: B }))).message]).toEqual([t, NAO_ENCONTRADO]);
      expect([t, (await erroDe(decidir(t, d))).message]).toEqual([t, SO_ABERTO]);
    }
  });

  it("DB-2.8 reprovação sem motivo, ou só com espaços → 23514 (CHECK do motivo); observação acima de 500 → 23514; decisão fora do domínio → 23514", async () => {
    for (const t of TABELAS) {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      const p = `aprovacoes_${t}`;
      for (const observacao of [null, "", "   "]) {
        const e = await erroDe(decidir(t, d, { decisao: "reprovado", observacao }));
        expect([t, observacao, e.code, e.constraint]).toEqual([t, observacao, "23514", `chk_${p}_reprovacao`]);
      }
      const longa = await erroDe(decidir(t, d, { observacao: "x".repeat(501) }));
      expect([t, longa.code, longa.constraint]).toEqual([t, "23514", `chk_${p}_observacao`]);
      const fora = await erroDe(decidir(t, d, { decisao: "talvez" }));
      expect([t, fora.code, fora.constraint]).toEqual([t, "23514", `chk_${p}_decisao`]);
      expect(await decisoesDe(t, d)).toBe(0);
      // Contraprova: aprovação sem observação, aprovação com 500 e reprovação com motivo passam.
      await decidir(t, d);
      await decidir(t, d, { observacao: "x".repeat(500) });
      await decidir(t, d, { decisao: "reprovado", observacao: " Faltou cotação " });
      expect(await decisoesDe(t, d)).toBe(3);
    }
  });

  it("DB-2.9 ATRIBUI do documento a TOP, a versão congelada e o valor, e da transação decidido_por e decidido_em — ignorando o que veio", async () => {
    for (const t of TABELAS) {
      const top = topDe(t, "4Sempre"); const outra = topDe(t, "4Valor");
      const d = await novoDoc(t, top, { valor: "1234.56" });
      const antes = Date.now();
      const id = await decidir(t, d, { atribuidos: {
        tipo_operacao_id: outra.top, tipo_operacao_versao_id: outra.versao, decidido_por: outroUsuario, decidido_em: "2000-01-01T00:00:00Z",
        ...(t === "estoque" ? {} : { valor_documento: "1.00" })
      } });
      const r = (await db.query<{ top: string; versao: string; valor: string | null; por: string; em: Date; versao_documento: string | null }>(
        `select tipo_operacao_id top, tipo_operacao_versao_id versao, ${t === "estoque" ? "null" : "valor_documento::text"} valor, decidido_por por, decidido_em em,
                ${t === "venda" ? "versao_documento::text" : "null"} versao_documento
           from ${TABELA_SQL[t]} where id=$1`, [id])).rows[0]!;
      expect([t, r.top, r.versao, r.valor, r.por, r.versao_documento])
        .toEqual([t, top.top, top.versao, t === "estoque" ? null : "1234.56", demo.adminUserId, t === "venda" ? "0" : null]);
      expect(r.em.getTime(), "decidido_em é o now() da transação, não o que veio").toBeGreaterThan(antes - 60_000);
    }
  });
  /**
   * FOR SHARE no documento: um caminho que NÃO travou o documento (a rota trava FOR UPDATE antes; este não) espera a
   * confirmação concorrente terminar e lê a linha NOVA — nunca grava a decisão sobre o "aberto" de antes. Na venda,
   * a linha nova já tem a versão somada pela 0039, e a recusa é a de concorrência (versão vem antes da situação);
   * na compra e no estoque, a de situação.
   */
  it("DB-2.10 FOR SHARE: a decisão espera a confirmação concorrente terminar e lê a linha NOVA", async () => {
    const esperado: Record<Tabela, string> = { venda: MUDOU, compra: SO_ABERTO, estoque: SO_ABERTO };
    for (const t of TABELAS) {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      await decidir(t, d);
      const confirmador = await db.connect();
      try {
        await confirmador.query("begin");
        await confirmador.query(`select 1 from ${DOCUMENTO_SQL[t].tabela} where id=$1 for update`, [d]);
        if (t === "venda") {
          await confirmador.query("select set_config('app.venda_execucao_configurada', $1, true)", [d]);
          await confirmador.query("update erp.sales_documents set status='confirmed' where id=$1", [d]);
        } else if (t === "compra") await confirmador.query("update erp.documentos_compra set situacao='confirmado' where id=$1", [d]);
        else await confirmador.query("update erp.documentos_estoque set situacao='confirmado', confirmado_em=now(), confirmado_por=$2 where id=$1", [d, demo.adminUserId]);
        const pendente = erroDe(decidir(t, d));
        // A decisão fica esperando a trava do documento (prova de que ela não leu o "aberto" de antes).
        let esperando = 0;
        for (let i = 0; i < 100 && esperando === 0; i++) {
          esperando = (await db.query<{ n: number }>(
            "select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like $1", [`insert into ${TABELA_SQL[t]}%`])).rows[0]!.n;
          if (esperando === 0) await new Promise((r) => setTimeout(r, 50));
        }
        expect([t, esperando], "a decisão ficou esperando a confirmação").toEqual([t, 1]);
        await confirmador.query("commit");
        expect([t, (await pendente).message]).toEqual([t, esperado[t]]);
      } finally { await confirmador.query("rollback").catch(() => {}); confirmador.release(); }
      expect([t, await estado(t, d), await decisoesDe(t, d)]).toEqual([t, DOCUMENTO_SQL[t].confirmado, 1]);
    }
  });

  /**
   * O ORÁCULO ENTRE TENANTS, FECHADO. O gatilho de inserção (definer) roda ANTES do with check da RLS. Se ele lesse o
   * documento pela organização que VEIO no INSERT, quem roda SQL como erp_app com a GUC da organização A mandaria
   * organization_id = B com um documento de B e saberia, pela resposta, a situação de um documento que a RLS esconde
   * dele: NOT_FOUND (não existe) × CONCURRENCY_CONFLICT (existe, noutra versão) × CONFLICT (confirmado) ×
   * APROVACAO_NAO_EXIGIDA (TOP sem aprovação) × 42501 do with check (aberto e exigindo). A organização é a da GUC do
   * servidor: a linha de outra organização recebe a MESMA NOT_FOUND, qualquer que seja o documento de B, e SEM LER
   * NADA de B — a prova: com cada documento de B travado FOR UPDATE por outra sessão, a recusa vem na hora (o FOR
   * SHARE do gatilho, se lesse, esperaria a trava, e o lock_timeout curto viraria 55P03). A linha que diz B com um
   * documento da própria A também: a conferência é da organização da LINHA contra a da GUC — só ler pela GUC daria a
   * 42501 do with check (ou a espera da trava) aqui. O superusuário sem organização na GUC (migração, script) também
   * recebe a NOT_FOUND, até para documento da própria organização.
   * Contraprova: os mesmos documentos de B, pedidos com a GUC de B, dão as respostas DIFERENTES de cada situação —
   * o cenário é real, e a NOT_FOUND única é a conferência da organização, não um cenário quebrado.
   */
  it("DB-2.11 organização da linha diferente da GUC (papel da aplicação na A pedindo a B), ou GUC sem organização: a MESMA NOT_FOUND, qualquer que seja o documento de B, sem ler nada de B", async () => {
    // O cenário de B, montado pelo superusuário: parceiros, armazém e TOPs no formato 4 ("sempre" e "nenhuma").
    const clienteB = await id1("insert into erp.people (organization_id, code, name, is_client) values ($1,'T08-OC','[TEST] Cliente outra org aprovação',true) returning id", [outraOrg]);
    const fornecedorB = await id1("insert into erp.people (organization_id, code, name, is_provider) values ($1,'T08-OF','[TEST] Fornecedor outra org aprovação',true) returning id", [outraOrg]);
    const armazemOutraOrg = await id1("insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,'T8O','[TEST] Armazem outra org aprovação') returning id", [outraOrg, empresaOutraOrg]);
    const BASE: Record<Tabela, string> = { venda: "vendas.venda", compra: "compras.compra", estoque: "estoque.entrada" };
    /** Documento aberto de B, com a TOP de B dada (valor 100.00 na venda e na compra). */
    async function docDeB(t: Tabela, top: Top): Promise<string> {
      seq += 1;
      if (t === "venda") {
        return id1(
          `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, total, status, tipo_operacao_id, tipo_operacao_versao_id)
           values ($1,$2,'sale',$3,'2026-10-01',$4,'100.00','open',$5,$6) returning id`,
          [outraOrg, empresaOutraOrg, `T08B-${seq}`, clienteB, top.top, top.versao]);
      }
      if (t === "compra") {
        return id1(
          `insert into erp.documentos_compra (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, fornecedor_id,
             data_documento, valor_itens, valor_total)
           values ($1,$2,'compra',$3,$4,$5,$6,'2026-10-01','100.00','100.00') returning id`,
          [outraOrg, empresaOutraOrg, `T08BC-${seq}`, top.top, top.versao, fornecedorB]);
      }
      return id1(
        `insert into erp.documentos_estoque (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, armazem_id, data_documento)
         values ($1,$2,'entrada',$3,$4,$5,$6,'2026-10-01') returning id`,
        [outraOrg, empresaOutraOrg, `T08BE-${seq}`, top.top, top.versao, armazemOutraOrg]);
    }
    /** Confirma o documento de B pelo superusuário (TOP "nenhuma": a guarda deixa passar sem decisão; a venda, com a marca da 0023). */
    async function confirmarDeB(t: Tabela, id: string): Promise<void> {
      const u = await withTx(db, { orgId: null, userId: null }, async (tx) => {
        if (t === "venda") {
          await tx.query("select set_config('app.venda_execucao_configurada', $1, true)", [id]);
          return tx.query("update erp.sales_documents set status='confirmed' where id=$1", [id]);
        }
        return t === "compra" ? tx.query("update erp.documentos_compra set situacao='confirmado' where id=$1", [id])
          : tx.query("update erp.documentos_estoque set situacao='confirmado', confirmado_em=now(), confirmado_por=$2 where id=$1", [id, demo.adminUserId]);
      });
      expect(u.rowCount).toBe(1);
    }
    const pedidoDeB = { org: outraOrg, empresa: empresaOutraOrg };

    for (const t of TABELAS) {
      const sempreB = await criarTop(outraOrg, BASE[t], configuracao(4, SEMPRE));
      const nenhumaB = await criarTop(outraOrg, BASE[t], configuracao(4, NENHUMA));
      const exigindo = await docDeB(t, sempreB);
      const confirmado = await docDeB(t, nenhumaB);
      await confirmarDeB(t, confirmado);
      const naoExige = await docDeB(t, nenhumaB);
      // Cada caso: [situação, documento, versão pedida (venda: a ATUAL, salvo no caso da outra versão), a resposta que o
      // gatilho dá com a GUC de B (null = grava)].
      const atual = async (doc: string) => (t === "venda" ? versaoDe(doc) : null);
      const casos: [string, string, string | null, string | null][] = [
        ["aberto e exigindo", exigindo, await atual(exigindo), null],
        ["confirmado", confirmado, await atual(confirmado), SO_ABERTO],
        ["sem exigência", naoExige, await atual(naoExige), NAO_EXIGIDA],
        ...(t === "venda" ? [["outra versão", exigindo, "9", MUDOU] as [string, string, string, string]] : [])
      ];
      // PREMISSA: os documentos são de B, nas situações ditas, e o papel da aplicação na A não enxerga nenhum (RLS).
      expect([t, await estado(t, exigindo), await estado(t, confirmado), await estado(t, naoExige)])
        .toEqual([t, DOCUMENTO_SQL[t].aberto, DOCUMENTO_SQL[t].confirmado, DOCUMENTO_SQL[t].aberto]);
      expect((await db.query<{ org: string }>(`select distinct organization_id::text org from ${DOCUMENTO_SQL[t].tabela} where id = any($1::uuid[])`,
        [[exigindo, confirmado, naoExige]])).rows).toEqual([{ org: outraOrg }]);
      expect([t, await withTx(app, ctxDe(t), async (tx) => (await tx.query(`select 1 from ${DOCUMENTO_SQL[t].tabela} where id = any($1::uuid[])`,
        [[exigindo, confirmado, naoExige]])).rowCount)]).toEqual([t, 0]);

      // Um documento da PRÓPRIA organização (A), aberto e exigindo: a linha que diz "organização B" com ele também é
      // recusada pela organização da linha, não pelo que o documento é (a organização da linha nunca é "corrigida").
      const meu = await novoDoc(t, topDe(t, "4Sempre"));
      const pedidos: [string, string, { org: string; empresa: string; versao: string | null | undefined }][] = [
        ...casos.map(([situacao, doc, versao]): [string, string, { org: string; empresa: string; versao: string | null | undefined }] =>
          [situacao, doc, { ...pedidoDeB, versao: t === "venda" ? versao : undefined }]),
        ["documento da A pedido como B", meu, { org: outraOrg, empresa: A, versao: t === "venda" ? await atual(meu) : undefined }]
      ];

      // O papel da aplicação com a GUC da A, pedindo como B: a MESMA NOT_FOUND em todo caso — e na hora, com o
      // documento travado FOR UPDATE por outra sessão (o gatilho não chegou a lê-lo).
      const respostas: string[] = [];
      for (const [situacao, doc, pedido] of pedidos) {
        const trava = await db.connect();
        try {
          await trava.query("begin");
          await trava.query(`select 1 from ${DOCUMENTO_SQL[t].tabela} where id=$1 for update`, [doc]);
          const e = await erroDe(withTx(app, ctxDe(t), async (tx) => {
            await tx.query("set local lock_timeout = '1s'");
            return inserirDecisao(tx, t, doc, pedido);
          }));
          expect([t, situacao, e.message, e.code]).toEqual([t, situacao, NAO_ENCONTRADO, "P0001"]);
          respostas.push(e.message);
        } finally { await trava.query("rollback").catch(() => {}); trava.release(); }
      }
      // E o inexistente, de B ou de lugar nenhum: a mesma.
      const inexistente = await erroDe(decidir(t, "00000000-0000-4000-8000-000000000005", { ...pedidoDeB, versao: t === "venda" ? "0" : undefined }));
      respostas.push(inexistente.message);
      expect([t, new Set(respostas).size, respostas.length]).toEqual([t, 1, pedidos.length + 1]);

      // O superusuário com usuário e SEM organização na GUC: NOT_FOUND — para o documento de B e para um da própria
      // organização (aberto e exigindo) —, e nada gravado. Sem usuário, a PERMISSION_DENIED vem antes (DB-2.1).
      const semOrg: TenantContext = { orgId: null, userId: demo.adminUserId, modulo: MODULO[t] };
      expect([t, "B sem GUC", (await erroDe(withTx(db, semOrg, (tx) => inserirDecisao(tx, t, exigindo, pedidoDeB)))).message])
        .toEqual([t, "B sem GUC", NAO_ENCONTRADO]);
      expect([t, "própria sem GUC", (await erroDe(withTx(db, semOrg, (tx) => inserirDecisao(tx, t, meu)))).message])
        .toEqual([t, "própria sem GUC", NAO_ENCONTRADO]);
      expect([t, "sem GUC nenhuma", (await erroDe(inserirDecisao(db, t, meu))).message]).toEqual([t, "sem GUC nenhuma", SEM_USUARIO]);
      expect([t, await decisoesDe(t, meu), await decisoesDe(t, exigindo), await decisoesDe(t, confirmado), await decisoesDe(t, naoExige)])
        .toEqual([t, 0, 0, 0, 0]);

      // CONTRAPROVA: com a GUC de B — um membro de B com a empresa dele no escopo do módulo, pelo superusuário, que não
      // tem RLS a recortar —, o gatilho LÊ os documentos de B e as respostas variam com a situação — era exatamente
      // esse o oráculo. O "aberto e exigindo" grava.
      for (const [situacao, doc, versao, esperado] of casos) {
        const tentativa = withTx(db, { orgId: outraOrg, userId: usuarioOutraOrg, modulo: MODULO[t] }, (tx) =>
          inserirDecisao(tx, t, doc, { ...pedidoDeB, versao: t === "venda" ? versao : undefined }));
        if (esperado === null) await expect(tentativa, `${t} ${situacao}`).resolves.toMatch(/^\d+$/);
        else expect([t, situacao, (await erroDe(tentativa)).message]).toEqual([t, situacao, esperado]);
      }
      expect([t, await decisoesDe(t, exigindo), await decisoesDe(t, confirmado), await decisoesDe(t, naoExige)]).toEqual([t, 1, 0, 0]);
      // E a do próprio documento, pela GUC da organização dele: grava.
      await expect(decidir(t, meu)).resolves.toMatch(/^\d+$/);
    }
  });

  /**
   * O ORÁCULO ENTRE EMPRESAS, FECHADO. O gatilho de inserção conferia a ORGANIZAÇÃO pela GUC, mas lia o documento sem
   * o recorte de EMPRESA da RLS: o membro com escopo [A] que, como erp_app, insere uma decisão para um documento da
   * empresa B (fora do escopo dele, MESMA organização) recebia respostas que variavam com a situação desse documento —
   * aberto e exigindo → 42501 do with check; sem exigência → APROVACAO_NAO_EXIGIDA; confirmado → CONFLICT; outra
   * versão (venda) → CONCURRENCY_CONFLICT; inexistente → NOT_FOUND. A API não expõe o caso (as rotas conferem a
   * visibilidade antes), mas a porta definer tem de ser estreita: a empresa da linha passa pelo MESMO predicado do with
   * check (erp.empresa_escrita_permitida), com o usuário e o módulo da GUC, ANTES de ler o documento. A prova de que
   * nada de B foi lido: cada documento travado FOR UPDATE por outra sessão, e a recusa vem na hora (o FOR SHARE do
   * gatilho, se lesse, esperaria a trava, e o lock_timeout curto viraria 55P03).
   * O usuário e o módulo são os da GUC de quem chama, também DENTRO da definer: o mesmo membro [A], no módulo sem
   * configuração (financeiro), recebe a NOT_FOUND até para um documento da própria A; no módulo do documento, grava.
   * Contraprova: um membro com escopo [A, B], pelo MESMO papel e nos MESMOS documentos, recebe as respostas DIFERENTES
   * de cada situação — o cenário é real, e a NOT_FOUND única é a conferência da empresa, não um cenário quebrado.
   */
  it("DB-2.12 membro com escopo [A] pedindo documento da empresa B da MESMA organização: a MESMA NOT_FOUND em toda situação, sem ler nada de B; com escopo [A, B], as respostas de cada situação", async () => {
    const INEXISTENTE = "00000000-0000-4000-8000-000000000006";
    for (const t of TABELAS) {
      const exigindo = await novoDoc(t, topDe(t, "4Sempre"), { empresa: B });
      // Confirmado com a TOP "nenhuma": a guarda deixa passar sem decisão (a situação é o que interessa aqui).
      const confirmado = await novoDoc(t, topDe(t, "4Nenhuma"), { empresa: B });
      await confirmar(t, confirmado);
      const naoExige = await novoDoc(t, topDe(t, "4Nenhuma"), { empresa: B });
      const atual = async (doc: string) => (t === "venda" ? versaoDe(doc) : undefined);
      // Cada caso: [situação, documento, versão pedida (venda: a ATUAL, salvo na outra versão e no inexistente), a
      // resposta que o gatilho dá ao membro [A, B] (null = grava)].
      const casos: [string, string, string | undefined, string | null][] = [
        ["aberto e exigindo", exigindo, await atual(exigindo), null],
        ["confirmado", confirmado, await atual(confirmado), SO_ABERTO],
        ["sem exigência", naoExige, await atual(naoExige), NAO_EXIGIDA],
        ["inexistente", INEXISTENTE, t === "venda" ? "0" : undefined, NAO_ENCONTRADO],
        ...(t === "venda" ? [["outra versão", exigindo, "9", MUDOU] as [string, string, string, string]] : [])
      ];
      // PREMISSA: os documentos são da MESMA organização e da empresa B, nas situações ditas; pela RLS, o membro [A]
      // não enxerga nenhum, e o [A, B] enxerga os três.
      expect([t, await estado(t, exigindo), await estado(t, confirmado), await estado(t, naoExige)])
        .toEqual([t, DOCUMENTO_SQL[t].aberto, DOCUMENTO_SQL[t].confirmado, DOCUMENTO_SQL[t].aberto]);
      expect((await db.query<{ org: string; empresa: string }>(
        `select distinct organization_id::text org, empresa_id::text empresa from ${DOCUMENTO_SQL[t].tabela} where id = any($1::uuid[])`,
        [[exigindo, confirmado, naoExige]])).rows).toEqual([{ org: demo.orgId, empresa: B }]);
      const visiveis = (ctx: TenantContext) => withTx(app, ctx, async (tx) =>
        (await tx.query(`select 1 from ${DOCUMENTO_SQL[t].tabela} where id = any($1::uuid[])`, [[exigindo, confirmado, naoExige]])).rowCount);
      expect([t, await visiveis(ctxDe(t, usuarioEscopoA)), await visiveis(ctxDe(t, usuarioEscopoAB))]).toEqual([t, 0, 3]);

      // O membro [A], pelo papel da aplicação, no módulo do documento: a MESMA NOT_FOUND em todo caso — e na hora, com
      // o documento travado FOR UPDATE por outra sessão (o gatilho não chegou a lê-lo).
      const respostas: string[] = [];
      for (const [situacao, doc, versao] of casos) {
        const trava = await db.connect();
        try {
          await trava.query("begin");
          const travados = (await trava.query(`select 1 from ${DOCUMENTO_SQL[t].tabela} where id=$1 for update`, [doc])).rowCount;
          expect([t, situacao, travados]).toEqual([t, situacao, doc === INEXISTENTE ? 0 : 1]);
          const e = await erroDe(withTx(app, ctxDe(t, usuarioEscopoA), async (tx) => {
            await tx.query("set local lock_timeout = '1s'");
            return inserirDecisao(tx, t, doc, { empresa: B, versao });
          }));
          expect([t, situacao, e.message, e.code]).toEqual([t, situacao, NAO_ENCONTRADO, "P0001"]);
          respostas.push(e.message);
        } finally { await trava.query("rollback").catch(() => {}); trava.release(); }
      }
      expect([t, new Set(respostas).size, respostas.length]).toEqual([t, 1, casos.length]);
      expect([t, await decisoesDe(t, exigindo), await decisoesDe(t, confirmado), await decisoesDe(t, naoExige)]).toEqual([t, 0, 0, 0]);

      // O módulo é o da GUC de quem chama, também dentro da definer: o MESMO membro [A], no módulo sem configuração
      // (financeiro), recebe a NOT_FOUND até para um documento da própria A, aberto e exigindo; no módulo dele, grava.
      const meu = await novoDoc(t, topDe(t, "4Sempre"));
      expect([t, "módulo sem configuração", (await erroDe(decidir(t, meu, {}, { ...ctxDe(t, usuarioEscopoA), modulo: "financeiro" }))).message])
        .toEqual([t, "módulo sem configuração", NAO_ENCONTRADO]);
      expect(await decisoesDe(t, meu)).toBe(0);
      await expect(decidir(t, meu, {}, ctxDe(t, usuarioEscopoA))).resolves.toMatch(/^\d+$/);

      // CONTRAPROVA: o membro [A, B], pelo MESMO papel e nos MESMOS documentos, passa na conferência da empresa, e o
      // gatilho LÊ os documentos de B: as respostas variam com a situação (era o oráculo). O "aberto e exigindo" grava.
      const respostasAB: string[] = [];
      for (const [situacao, doc, versao, esperado] of casos) {
        const tentativa = decidir(t, doc, { empresa: B, versao }, ctxDe(t, usuarioEscopoAB));
        if (esperado === null) {
          await expect(tentativa, `${t} ${situacao}`).resolves.toMatch(/^\d+$/);
          respostasAB.push("grava");
        } else {
          const m = (await erroDe(tentativa)).message;
          expect([t, situacao, m]).toEqual([t, situacao, esperado]);
          respostasAB.push(m);
        }
      }
      expect([t, new Set(respostasAB).size]).toEqual([t, casos.length]);
      expect([t, await decisoesDe(t, exigindo), await decisoesDe(t, confirmado), await decisoesDe(t, naoExige)]).toEqual([t, 1, 0, 0]);
      expect((await db.query<{ por: string }>(`select decidido_por por from ${TABELA_SQL[t]} where documento_id=$1`, [exigindo])).rows)
        .toEqual([{ por: usuarioEscopoAB }]);
    }
  });

  /**
   * O FILTRO NA LEITURA, NÃO DEPOIS DELA. O DB-2.12 fecha a empresa da LINHA fora do escopo; aqui a linha diz a
   * empresa A (no escopo do membro [A], então a conferência da empresa passa) e o documento é um que NÃO é o pedido:
   * da empresa B, venda excluída, venda de outra espécie, pedido de compra. Se o gatilho lesse o documento só por id e
   * organização com FOR SHARE e descartasse DEPOIS, ele travaria (ou esperaria a trava de) uma linha que não é dele —
   * da empresa B, fora do escopo de quem decide. Com o filtro dentro do SELECT (organização, empresa = a da linha,
   * espécie, não excluído), a linha nem chega ao FOR SHARE. A prova: cada documento travado FOR UPDATE por outra
   * sessão, lock_timeout de 1s na sessão do membro, e a resposta é a NOT_FOUND, nunca o 55P03 da espera.
   * Contraprova: o documento que o filtro deixa passar (da empresa A, vivo, da espécie), travado do MESMO jeito, faz o
   * gatilho esperar — e o lock_timeout vira 55P03. A trava é real, e a NOT_FOUND de cima é o filtro.
   */
  it("DB-2.12b documento que não é o pedido (empresa B com a linha em A, venda excluída, venda de outra espécie, pedido de compra), travado FOR UPDATE por outra sessão: NOT_FOUND na hora, nunca 55P03", async () => {
    const casos: [Tabela, string, string][] = [];
    for (const t of TABELAS) casos.push([t, "documento da empresa B", await novoDoc(t, topDe(t, "4Sempre"), { empresa: B })]);
    casos.push(["venda", "venda excluída", await venda(tops.venda4Sempre, { excluida: true })]);
    for (const kind of ["budget", "order"]) casos.push(["venda", `venda de outra espécie (${kind})`, await venda(tops.venda4Sempre, { kind })]);
    casos.push(["compra", "pedido de compra", await compra(tops.pedido4Sempre, { especie: "pedido" })]);
    // PREMISSA: cada documento é da organização, na situação dita; a empresa só é B no primeiro de cada tabela.
    for (const [t, caso, doc] of casos) {
      const r = (await db.query<{ org: string; empresa: string; s: string }>(
        `select organization_id::text org, empresa_id::text empresa, ${DOCUMENTO_SQL[t].situacao} s from ${DOCUMENTO_SQL[t].tabela} where id=$1`, [doc])).rows;
      expect([t, caso, r]).toEqual([t, caso, [{ org: demo.orgId, empresa: caso === "documento da empresa B" ? B : A, s: DOCUMENTO_SQL[t].aberto }]]);
    }
    expect((await db.query<{ kind: string; excluida: boolean }>(
      "select kind, deleted_at is not null excluida from erp.sales_documents where id = any($1::uuid[]) order by kind, deleted_at is not null", [casos.filter((c) => c[0] === "venda").map((c) => c[2])])).rows)
      .toEqual([{ kind: "budget", excluida: false }, { kind: "order", excluida: false }, { kind: "sale", excluida: false }, { kind: "sale", excluida: true }]);

    /** A decisão do membro [A], com a empresa A na linha e lock_timeout de 1s, com `doc` travado FOR UPDATE por outra sessão. */
    async function comTrava(t: Tabela, doc: string) {
      const versao = t === "venda" ? await versaoDe(doc) : undefined;
      const trava = await db.connect();
      try {
        await trava.query("begin");
        expect([t, doc, (await trava.query(`select 1 from ${DOCUMENTO_SQL[t].tabela} where id=$1 for update`, [doc])).rowCount]).toEqual([t, doc, 1]);
        return await erroDe(withTx(app, ctxDe(t, usuarioEscopoA), async (tx) => {
          await tx.query("set local lock_timeout = '1s'");
          return inserirDecisao(tx, t, doc, { empresa: A, versao });
        }));
      } finally { await trava.query("rollback").catch(() => {}); trava.release(); }
    }

    for (const [t, caso, doc] of casos) {
      const e = await comTrava(t, doc);
      expect([t, caso, e.message, e.code]).toEqual([t, caso, NAO_ENCONTRADO, "P0001"]);
      expect([t, caso, await decisoesDe(t, doc)]).toEqual([t, caso, 0]);
    }

    // CONTRAPROVA: o documento certo (empresa A, aberto, exigindo), travado do mesmo jeito, faz o gatilho esperar.
    for (const t of TABELAS) {
      const meu = await novoDoc(t, topDe(t, "4Sempre"));
      const e = await comTrava(t, meu);
      expect([t, e.code], "a espera virou o 55P03 do lock_timeout").toEqual([t, "55P03"]);
      expect(e.message).toMatch(/lock timeout/);
      // Solta a trava: a MESMA decisão grava.
      await expect(decidir(t, meu, { empresa: A }, ctxDe(t, usuarioEscopoA)), t).resolves.toMatch(/^\d+$/);
    }
  });
});

describe("DB-3 — as três guardas de transição (entrada no confirmado)", () => {
  for (const t of TABELAS) {
    it(`DB-3.1 ${t}: sem decisão → CONFLICT 'precisa de aprovação'; reprovada → CONFLICT 'foi reprovado'; aprovada → confirma`, async () => {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      const pendente = await erroDe(confirmar(t, d));
      // CONFLICT (P0001), uma linha, sem DETAIL nem HINT: o binário anterior responde 409, e sem details nesse caminho.
      expect([pendente.message, pendente.code, pendente.detail, pendente.hint]).toEqual([PRECISA, "P0001", undefined, undefined]);
      expect(await estado(t, d)).toBe(DOCUMENTO_SQL[t].aberto);
      await decidir(t, d, { decisao: "reprovado", observacao: "Fornecedor não homologado" });
      const reprovado = await erroDe(confirmar(t, d));
      // Mensagem fixa, de uma linha: nada do motivo livre nela (o fromPgError só reconhece mensagem de uma linha).
      expect([reprovado.message, reprovado.code, reprovado.detail, reprovado.hint]).toEqual([REPROVADO, "P0001", undefined, undefined]);
      expect(await estado(t, d)).toBe(DOCUMENTO_SQL[t].aberto);
      // Aprovar depois de reprovar é uma decisão NOVA, e a história fica.
      await decidir(t, d);
      await confirmar(t, d);
      expect(await estado(t, d)).toBe(DOCUMENTO_SQL[t].confirmado);
      expect(await decisoesDe(t, d)).toBe(2);
    });

    it(`DB-3.2 ${t}: vale a ÚLTIMA decisão — aprovada e depois reprovada não confirma`, async () => {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      await decidir(t, d);
      await decidir(t, d, { decisao: "reprovado", observacao: "Revisto" });
      expect((await erroDe(confirmar(t, d))).message).toBe(REPROVADO);
      expect(await estado(t, d)).toBe(DOCUMENTO_SQL[t].aberto);
    });

    it(`DB-3.3 ${t}: formato 3 declarando 'sempre' e formato 4 'nenhuma' confirmam sem decisão (o formato 1 a 3 nunca é barrado)`, async () => {
      for (const top of [topDe(t, "3Sempre"), topDe(t, "4Nenhuma")]) {
        const d = await novoDoc(t, top);
        await confirmar(t, d);
        expect([top.versao, await estado(t, d)]).toEqual([top.versao, DOCUMENTO_SQL[t].confirmado]);
      }
    });

    it(`DB-3.4 ${t}: cancelar o documento aberto que exige aprovação não é guardado`, async () => {
      const d = await novoDoc(t, topDe(t, "4Sempre"));
      await expect(cancelar(t, d)).resolves.toMatchObject({ rowCount: 1 });
    });
  }

  it("DB-3.5 venda: formato 1, formato 2 e sem TOP confirmam sem decisão, mesmo declarando 'sempre'", async () => {
    for (const top of [tops.venda1Sempre, tops.venda2Sempre, null]) {
      const d = await venda(top);
      await confirmar("venda", d);
      expect([top?.versao ?? "sem TOP", await estado("venda", d)]).toEqual([top?.versao ?? "sem TOP", "confirmed"]);
    }
  });

  it("DB-3.6 'a partir de 1500.00': total 1500.00 exige (o igual conta) e 1499.99 não — na venda e na compra", async () => {
    for (const t of ["venda", "compra"] as Tabela[]) {
      const igual = await novoDoc(t, topDe(t, "4Valor"), { valor: "1500.00" });
      expect([t, (await erroDe(confirmar(t, igual))).message]).toEqual([t, PRECISA]);
      await decidir(t, igual);
      await confirmar(t, igual);
      expect(await estado(t, igual)).toBe(DOCUMENTO_SQL[t].confirmado);
      const abaixo = await novoDoc(t, topDe(t, "4Valor"), { valor: "1499.99" });
      await confirmar(t, abaixo);
      expect([t, await estado(t, abaixo)]).toEqual([t, DOCUMENTO_SQL[t].confirmado]);
    }
  });

  it("DB-3.7 estoque com 'a partir de um valor' (a matriz não deixa gravar): sem valor, a conta exige (fail-closed)", async () => {
    const d = await estoque(tops.estoque4Valor);
    expect((await erroDe(confirmar("estoque", d))).message).toBe(PRECISA);
    await decidir("estoque", d);
    await confirmar("estoque", d);
    expect(await estado("estoque", d)).toBe("confirmado");
  });

  it("DB-3.8 venda: aprovada na versão V e alterada (PATCH → V+1), o UPDATE que confirma GRAVANDO version=V continua recusado — a guarda olha o OLD", async () => {
    const d = await venda(tops.venda4Sempre);
    const v = await versaoDe(d);
    await decidir("venda", d, { versao: v });
    // O PATCH (EDITAR-01): qualquer UPDATE soma 1 na versão (0039).
    await moverVenda(d, "note='alterada depois da aprovação'");
    expect(await versaoDe(d)).toBe(String(Number(v) + 1));
    // O NEW pode mentir: o UPDATE manda version=V junto com o status. A decisão de V não vale para V+1.
    const e = await erroDe(moverVenda(d, "status='confirmed', version=$2", [v]));
    expect(e.message).toBe(PRECISA);
    expect(await estado("venda", d)).toBe("open");
    expect(await versaoDe(d), "a recusa não mexeu na versão").toBe(String(Number(v) + 1));
    // Contraprova: aprovada na versão ATUAL (V+1), o MESMO UPDATE (que ainda manda version=V) passa.
    await decidir("venda", d, { versao: String(Number(v) + 1) });
    await moverVenda(d, "status='confirmed', version=$2", [v]);
    expect(await estado("venda", d)).toBe("confirmed");
    expect(await versaoDe(d), "a 0039 continua dona da versão: V+2, não o V mandado").toBe(String(Number(v) + 2));
  });

  it("DB-3.9 venda: reprovada na versão V e alterada para V+1 → pendente ('precisa de aprovação', não 'foi reprovado')", async () => {
    const d = await venda(tops.venda4Sempre);
    await decidir("venda", d, { decisao: "reprovado", observacao: "Desconto alto" });
    expect((await erroDe(confirmar("venda", d))).message).toBe(REPROVADO);
    await moverVenda(d, "discount='0.00'");
    expect((await erroDe(confirmar("venda", d))).message).toBe(PRECISA);
  });

  it("DB-3.10 venda: o MESMO WHEN da 0023 — aberta → faturada e 'approved' → confirmada são guardadas; confirmada → faturada não", async () => {
    const aberta = await venda(tops.venda4Sempre);
    expect((await erroDe(moverVenda(aberta, "status='invoiced'"))).message).toBe(PRECISA);
    const aprovadaNaVenda = await venda(tops.venda4Sempre, { status: "approved" });
    expect((await erroDe(confirmar("venda", aprovadaNaVenda))).message).toBe(PRECISA);
    await decidir("venda", aprovadaNaVenda);
    await confirmar("venda", aprovadaNaVenda);
    expect(await estado("venda", aprovadaNaVenda)).toBe("confirmed");
    const confirmada = await venda(tops.venda4Sempre, { status: "confirmed" });
    await moverVenda(confirmada, "status='invoiced'");
    expect(await estado("venda", confirmada)).toBe("invoiced");
  });

  it("DB-3.11 fail-closed na conta: baixar o total ou trocar a TOP no MESMO UPDATE que confirma não escapa da exigência", async () => {
    // Total 1500.00 ('a partir de 1500.00') confirmando com total 1.00 no mesmo comando: vale o MAIOR.
    const venda1500 = await venda(tops.venda4Valor, { total: "1500.00" });
    expect((await erroDe(moverVenda(venda1500, "status='confirmed', total='1.00'"))).message).toBe(PRECISA);
    // E o contrário: subir o total no mesmo comando também exige.
    const venda1 = await venda(tops.venda4Valor, { total: "1.00" });
    expect((await erroDe(moverVenda(venda1, "status='confirmed', total='1500.00'"))).message).toBe(PRECISA);
    // Trocar a TOP (o PUT da venda pode) para uma de formato 1 no mesmo comando: vale a de ANTES.
    const deFormato4 = await venda(tops.venda4Sempre);
    expect((await erroDe(moverVenda(deFormato4, "status='confirmed', tipo_operacao_id=$2, tipo_operacao_versao_id=$3", [tops.venda1Sempre.top, tops.venda1Sempre.versao]))).message).toBe(PRECISA);
    // E de uma de formato 1 para a de formato 4: vale a de DEPOIS.
    const deFormato1 = await venda(tops.venda1Sempre);
    expect((await erroDe(moverVenda(deFormato1, "status='confirmed', tipo_operacao_id=$2, tipo_operacao_versao_id=$3", [tops.venda4Sempre.top, tops.venda4Sempre.versao]))).message).toBe(PRECISA);
    for (const d of [venda1500, venda1, deFormato4, deFormato1]) expect(await estado("venda", d)).toBe("open");
    // Compra: o mesmo com o valor total.
    const compra1500 = await compra(tops.compra4Valor, { valor: "1500.00" });
    const e = await erroDe(withTx(app, ctxDe("compra"), (tx) => tx.query("update erp.documentos_compra set situacao='confirmado', valor_itens='1.00', valor_total='1.00' where id=$1", [compra1500])));
    expect(e.message).toBe(PRECISA);
    expect(await estado("compra", compra1500)).toBe("aberto");
  });

  /**
   * A APROVAÇÃO SÓ VALE PARA O QUE ELA VIU. O DB-3.11 prova a conta sem decisão; aqui a decisão 'aprovado' JÁ está
   * gravada — e o UPDATE que confirma muda, no MESMO comando, o que ela aprovou. Ela vale só se o valor dela cobre o
   * MAIOR total (o de antes e o de depois) e se a versão da TOP dela é a de DEPOIS; senão, a MESMA recusa de quem não
   * tem decisão. Cada recusa tem a PREMISSA ao lado: o MESMO UPDATE, sem subir o total (ou com a MESMA TOP), confirma
   * — a recusa é pelo que mudou, não por outro motivo.
   */
  it("DB-3.11b venda com decisão 'aprovado': confirmar e subir o total no MESMO UPDATE → 'precisa de aprovação', e continua aberta", async () => {
    // Na 'sempre' (aprovada a 100.00) e na 'a partir de 1500.00' (aprovada a 1500.00): um centavo a mais já não é o aprovado.
    for (const [top, aprovado, acima] of [[tops.venda4Sempre, "100.00", "100.01"], [tops.venda4Valor, LIMITE, "1500.01"]] as [Top, string, string][]) {
      const d = await venda(top, { total: aprovado });
      const id = await decidir("venda", d);
      expect((await db.query<{ v: string; decisao: string }>("select valor_documento::text v, decisao from erp.aprovacoes_venda where id=$1", [id])).rows)
        .toEqual([{ v: aprovado, decisao: "aprovado" }]);
      const e = await erroDe(moverVenda(d, "status='confirmed', total=$2", [acima]));
      expect([top.versao, e.message, e.code]).toEqual([top.versao, PRECISA, "P0001"]);
      expect((await db.query<{ s: string; total: string }>("select status s, total::text total from erp.sales_documents where id=$1", [d])).rows)
        .toEqual([{ s: "open", total: aprovado }]);
      // PREMISSA: o MESMO UPDATE com o total aprovado confirma.
      await moverVenda(d, "status='confirmed', total=$2", [aprovado]);
      expect([top.versao, await estado("venda", d)]).toEqual([top.versao, "confirmed"]);
    }
  });

  it("DB-3.11c venda com decisão 'aprovado': confirmar e trocar para outra TOP do formato 4 no MESMO UPDATE → 'precisa de aprovação', e continua aberta", async () => {
    // Outra TOP do formato 4, que também exige ('sempre'): a troca não dispensa nada — a decisão é que é de outra versão.
    const outra = await criarTop(demo.orgId, "vendas.venda", configuracao(4, SEMPRE));
    expect(outra.versao).not.toBe(tops.venda4Sempre.versao);
    const d = await venda(tops.venda4Sempre);
    const id = await decidir("venda", d);
    expect((await db.query<{ versao: string }>("select tipo_operacao_versao_id::text versao from erp.aprovacoes_venda where id=$1", [id])).rows)
      .toEqual([{ versao: tops.venda4Sempre.versao }]);
    const trocar = "status='confirmed', tipo_operacao_id=$2, tipo_operacao_versao_id=$3";
    const e = await erroDe(moverVenda(d, trocar, [outra.top, outra.versao]));
    expect([e.message, e.code]).toEqual([PRECISA, "P0001"]);
    expect((await db.query<{ s: string; versao: string }>("select status s, tipo_operacao_versao_id::text versao from erp.sales_documents where id=$1", [d])).rows)
      .toEqual([{ s: "open", versao: tops.venda4Sempre.versao }]);
    // PREMISSA: o MESMO UPDATE com a MESMA TOP (as duas colunas no SET, com o valor de hoje) confirma.
    await moverVenda(d, trocar, [tops.venda4Sempre.top, tops.venda4Sempre.versao]);
    expect(await estado("venda", d)).toBe("confirmed");
  });

  it("DB-3.11d compra com decisão 'aprovado': confirmar e subir valor_itens e valor_total no MESMO UPDATE → 'precisa de aprovação', e continua aberta", async () => {
    const confirmarCom = (d: string, valor: string) => withTx(app, ctxDe("compra"), async (tx) => {
      const u = await tx.query("update erp.documentos_compra set situacao='confirmado', valor_itens=$2, valor_total=$2 where id=$1", [d, valor]);
      expect(u.rowCount, "a compra precisa ser visível para o papel da aplicação").toBe(1);
    });
    for (const [top, aprovado, acima] of [[tops.compra4Sempre, "100.00", "100.01"], [tops.compra4Valor, LIMITE, "1500.01"]] as [Top, string, string][]) {
      const d = await compra(top, { valor: aprovado });
      const id = await decidir("compra", d);
      expect((await db.query<{ v: string; decisao: string }>("select valor_documento::text v, decisao from erp.aprovacoes_compra where id=$1", [id])).rows)
        .toEqual([{ v: aprovado, decisao: "aprovado" }]);
      const e = await erroDe(confirmarCom(d, acima));
      expect([top.versao, e.message, e.code]).toEqual([top.versao, PRECISA, "P0001"]);
      expect((await db.query<{ s: string; itens: string; total: string }>(
        "select situacao s, valor_itens::text itens, valor_total::text total from erp.documentos_compra where id=$1", [d])).rows)
        .toEqual([{ s: "aberto", itens: aprovado, total: aprovado }]);
      // PREMISSA: o MESMO UPDATE com o valor aprovado confirma.
      await confirmarCom(d, aprovado);
      expect([top.versao, await estado("compra", d)]).toEqual([top.versao, "confirmado"]);
    }
  });
});

describe("DB-4 — os quatro BEFORE UPDATE da venda: a guarda da aprovação primeiro, a 0039 por último", () => {
  it("DB-4.1 por nome (collation C, a ordem de disparo), com as funções: aprovacao, classificacao_financeira, execucao_configurada, versao", async () => {
    const r = (await db.query<{ g: string }>(
      `select t.tgname || ' -> ' || p.proname g from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid='erp.sales_documents'::regclass and not t.tgisinternal and t.tgenabled = 'O'
          and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16
        order by t.tgname collate "C"`)).rows.map((x) => x.g);
    expect(r).toEqual([
      "trg_sales_documents_aprovacao -> venda_aprovacao_guarda",
      "trg_sales_documents_classificacao_financeira -> venda_classificacao_financeira_guarda",
      "trg_sales_documents_execucao_configurada -> venda_execucao_configurada_guarda",
      "trg_sales_documents_versao -> sales_documents_versao"
    ]);
    const def = (await db.query<{ tgname: string; def: string }>(
      `select tgname, pg_get_triggerdef(oid) def from pg_trigger where tgrelid='erp.sales_documents'::regclass
          and tgname in ('trg_sales_documents_aprovacao','trg_sales_documents_execucao_configurada') order by tgname`)).rows;
    const quando = (s: string) => s.match(/ WHEN \((.*)\) EXECUTE /)?.[1] ?? null;
    expect(def[0]!.def).toMatch(/^CREATE TRIGGER trg_sales_documents_aprovacao BEFORE UPDATE OF status ON erp\.sales_documents FOR EACH ROW WHEN .* EXECUTE FUNCTION erp\.venda_aprovacao_guarda\(\)$/);
    expect(quando(def[0]!.def), "um WHEN de fato").not.toBeNull();
    expect(quando(def[0]!.def), "o MESMO WHEN da 0023").toBe(quando(def[1]!.def));
  });

  it("DB-4.2 a guarda da aprovação dispara PRIMEIRO: sem decisão e sem a marca da 0023, a recusa é a da aprovação; aprovada e sem a marca, a da 0023", async () => {
    const d = await venda(tops.venda4Sempre);
    expect((await erroDe(moverVenda(d, "status='confirmed'", [], false))).message).toBe(PRECISA);
    await decidir("venda", d);
    expect((await erroDe(moverVenda(d, "status='confirmed'", [], false))).message).toMatch(/^TIPO_OPERACAO_INDISPONIVEL: /);
    expect(await estado("venda", d)).toBe("open");
    const v = await versaoDe(d);
    await moverVenda(d, "status='confirmed'");
    expect(await estado("venda", d)).toBe("confirmed");
    expect(await versaoDe(d), "a 0039, a última, somou 1 uma vez só: a guarda não muda o NEW").toBe(String(Number(v) + 1));
  });
});

/**
 * A CONTA (erp.top_exige_aprovacao) — o lado do banco do AP-11. Cada linha: [caso, configuração, valor do
 * documento, esperado]. A mesma tabela é a que o T6 compara com `exigeAprovacao` do domínio. A conta roda pelo
 * papel da aplicação, que a executa (a fila de aprovações da API a usa em SQL).
 */
const CASOS_EXIGE: [string, unknown, string | null, boolean][] = [
  ["configuração nula (SQL null)", null, "100.00", false],
  ["configuração JSON null", "null", "100.00", false],
  ["não objeto (lista)", [], "100.00", false],
  ["objeto sem versaoSchema", {}, "100.00", false],
  ["versaoSchema em texto ('4')", { ...configuracao(4, SEMPRE), versaoSchema: "4" }, "100.00", false],
  ["formato 1, sempre", configuracao(1, SEMPRE), "100.00", false],
  ["formato 2, sempre", configuracao(2, SEMPRE), "100.00", false],
  ["formato 3, sempre", configuracao(3, SEMPRE), "100.00", false],
  ["formato 3, a partir de 1500.00, acima", configuracao(3, POR_VALOR), "2000.00", false],
  ["formato 4, nenhuma", configuracao(4, NENHUMA), "100.00", false],
  ["formato 4, nenhuma, valor nulo", configuracao(4, NENHUMA), null, false],
  ["formato 4, sem a seção aprovacao", configuracao(4, null), "100.00", false],
  ["formato 4, política desconhecida", configuracao(4, { politica: "talvez", valorMinimo: null }), "100.00", false],
  ["formato 4, sempre", configuracao(4, SEMPRE), "100.00", true],
  ["formato 4, sempre, valor zero", configuracao(4, SEMPRE), "0.00", true],
  ["formato 4, sempre, valor nulo", configuracao(4, SEMPRE), null, true],
  ["formato 4, a partir de 1500.00, igual", configuracao(4, POR_VALOR), "1500.00", true],
  ["formato 4, a partir de 1500.00, igual sem casas (1500)", configuracao(4, POR_VALOR), "1500", true],
  ["formato 4, a partir de 1500.00, acima (1500.01)", configuracao(4, POR_VALOR), "1500.01", true],
  ["formato 4, a partir de 1500.00, abaixo (1499.99)", configuracao(4, POR_VALOR), "1499.99", false],
  ["formato 4, a partir de 1500.00, zero", configuracao(4, POR_VALOR), "0.00", false],
  ["formato 4, a partir de 1500.00, valor nulo", configuracao(4, POR_VALOR), null, true],
  ["formato 4, a partir de 1500 (número), abaixo", configuracao(4, { politica: "por_valor", valorMinimo: 1500 }), "1499.99", false],
  ["formato 4, a partir de 1500 (número), igual", configuracao(4, { politica: "por_valor", valorMinimo: 1500 }), "1500.00", true],
  ["formato 4, a partir de um limite nulo (ilegível: exige)", configuracao(4, { politica: "por_valor", valorMinimo: null }), "1.00", true],
  ["formato 4, a partir de um limite ilegível ('abc': exige)", configuracao(4, { politica: "por_valor", valorMinimo: "abc" }), "1.00", true],
  ["formato 5, sempre (≥ 4)", configuracao(5, SEMPRE), "100.00", true]
];

describe("AP-11 (lado do banco) — erp.top_exige_aprovacao numa tabela de casos", () => {
  it("cada política, o limite igual, acima e abaixo, valor nulo, formatos 1 a 4 e configuração nula", async () => {
    expect(CASOS_EXIGE.filter((c) => c[3]).length, "a tabela tem casos verdadeiros").toBeGreaterThanOrEqual(10);
    expect(CASOS_EXIGE.filter((c) => !c[3]).length, "e falsos").toBeGreaterThanOrEqual(10);
    const obtidos = await withTx(app, ctxDe("venda"), async (tx) => {
      const r: [string, boolean][] = [];
      for (const [caso, cfg, valor] of CASOS_EXIGE) {
        const json = cfg === null ? null : typeof cfg === "string" ? cfg : JSON.stringify(cfg);
        r.push([caso, (await tx.query<{ r: boolean }>("select erp.top_exige_aprovacao($1::jsonb, $2::numeric) r", [json, valor])).rows[0]!.r]);
      }
      return r;
    });
    expect(obtidos).toEqual(CASOS_EXIGE.map(([caso, , , esperado]) => [caso, esperado]));
  });
});
