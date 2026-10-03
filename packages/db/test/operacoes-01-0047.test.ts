import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0047 (OPERACOES-01 F7, decisão 284), PROVADA CONTRA O BANCO — SOBRE ACERVO, COMO O RUNNER APLICA.
 *
 * O que ela promete:
 *   · o XML ORIGINAL guardado (erp.notas_fiscais_xml), imutável, da empresa destinatária, com RLS por empresa (B6, B9);
 *   · a importação (erp.importacoes_nfe_compra): nasce pendente, decide uma vez (gerada com a compra da MESMA chave e
 *     empresa, ou descartada), uma pendente por chave, nunca se apaga (B7);
 *   · a COMPRA ganha os dados fiscais (só ela), com o total refeito (+ IPI + ICMS-ST + seguro) e os dados imutáveis
 *     depois do lançamento (B1, B2, B5);
 *   · a NOTA REPETIDA barrada no banco: entre compras vivas (cancelar libera) e entre compra e nota antiga, nos DOIS
 *     sentidos, mesmo quando a outra é de empresa fora do escopo de quem grava (B3, B4);
 *   · o rateio por valor só da compra aberta com rateio por valor, imutável (B8); o vínculo lembrado (B11); o XML da
 *     DF-e gravado uma vez, da mesma chave (B10).
 *
 * Banco NOVO esconde a prova: sem documento gravado, "nenhuma linha muda" seria verdade sobre conjunto vazio. Este
 * arquivo sobe o banco até a migration anterior à 0047, grava ACERVO pelo caminho de antes (compra aberta e
 * confirmada, pedido, nota antiga viva e cancelada com chave, DF-e sem empresa, solicitação) e só então aplica a 0047
 * como o runner aplica (uma transação + ledger), provando antes as recusas dela — a trava (2026,81), o lock_timeout
 * de 2s e as pré-condições quebradas numa transação desfeita, cada uma com a SUA mensagem — e depois a reaplicação
 * recusada e as pós-condições (só de OBJETOS), cada uma quebrada com a sua mensagem (U1 a U3).
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação — organização, usuário e o módulo compras: o caminho que a API percorre). Todo
 * comportamento (B1 a B11) roda pelo `app`, salvo onde o teste diz que prova o GATILHO além do privilégio.
 *
 * Chaves de acesso e CNPJs SINTÉTICOS, com os dígitos verificadores calculados aqui (nada copiado de nota real).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let fornecedor: string; let produto: string; let usuarioEscopoA: string; let usuarioEscopoB: string;

const ALVO = "0047_entrada_de_nota_por_xml.sql";
const M = "OPERACOES-01 F7: ";
const POS = "-- ---------- 13) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------";

// ---------- dados sintéticos ----------
/** DV do CNPJ (módulo 11, pesos 2..9 da direita para a esquerda). */
function dvMod11(digitos: string): number {
  let soma = 0; let peso = 2;
  for (let i = digitos.length - 1; i >= 0; i--) { soma += Number(digitos[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}
function cnpjSintetico(base12: string): string {
  const d1 = dvMod11(base12);
  return base12 + d1 + dvMod11(base12 + d1);
}
/** DV da chave de acesso: módulo 11 sobre as 43 posições, pesos 2..9 da direita; resto 0 ou 1 dá 0. */
function dvChave(chave43: string): number {
  let soma = 0; let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) { soma += Number(chave43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return r === 0 || r === 1 ? 0 : 11 - r;
}
const CNPJ_EMITENTE = cnpjSintetico("471103580001");
let numeroNota = 0;
/** cUF 51, AAMM 2610, CNPJ sintético, modelo 55, série 001, nNF sequencial, tpEmis 1, cNF fixo, DV calculado. */
function chave(): string {
  numeroNota += 1;
  const c43 = `51${"2610"}${CNPJ_EMITENTE}55001${String(numeroNota).padStart(9, "0")}1${"20261003"}`;
  return c43 + dvChave(c43);
}
const xmlDe = (ch: string) => `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00"><NFe><infNFe Id="NFe${ch}" versao="4.00"><ide><mod>55</mod><tpAmb>1</tpAmb></ide><emit><CNPJ>${CNPJ_EMITENTE}</CNPJ><xNome>Fornecedor Sintetico Ltda</xNome></emit></infNFe></NFe><protNFe><infProt><chNFe>${ch}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;

let seq = 0;
const id1 = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;

interface Top { top: string; versao: string }
const tops = {} as { compra: Top; pedido: Top };
async function criarTop(codigoBase: string): Promise<Top> {
  seq += 1;
  return withTx(db, { orgId: demo.orgId, userId: null }, async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id",
      [demo.orgId, `F7B${seq}`, codigoBase])).rows[0]!.id;
    const versao = (await tx.query<{ id: string }>("insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,1,$3) returning id",
      [demo.orgId, top, `TOP F7 ${codigoBase} ${seq}`])).rows[0]!.id;
    return { top, versao };
  });
}

const ctx = (userId: string = demo.adminUserId): TenantContext => ({ orgId: demo.orgId, userId, modulo: "compras" });
const naApp = <T>(fn: (tx: Tx) => Promise<T>, c: TenantContext = ctx()) => withTx(app, c, fn);

/** INSERT genérico por `q` (só as colunas pedidas: antes da 0047 as colunas novas nem existem). */
async function inserir(q: Queryable, tabela: string, v: Record<string, unknown>, ret = "id"): Promise<string> {
  const cols = Object.keys(v);
  return (await q.query<{ r: string }>(
    `insert into erp.${tabela} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning ${ret} r`, Object.values(v))).rows[0]!.r;
}

type Especie = "pedido" | "compra";
interface Cab { especie?: Especie; empresa?: string; valorItens?: string; valorTotal?: string; extra?: Record<string, unknown>; itemExtra?: Record<string, unknown> }
/** Documento de compra pelo papel da aplicação: cabeçalho e um item na MESMA transação, como a API grava. */
const documento = (o: Cab = {}, c: TenantContext = ctx()): Promise<string> => naApp(async (tx) => {
  seq += 1;
  const especie = o.especie ?? "compra";
  const top = especie === "compra" ? tops.compra : tops.pedido;
  const vi = o.valorItens ?? "10.00";
  const id = await inserir(tx, "documentos_compra", {
    organization_id: demo.orgId, empresa_id: o.empresa ?? A, especie, codigo: `F7-${seq}`, tipo_operacao_id: top.top, tipo_operacao_versao_id: top.versao,
    fornecedor_id: fornecedor, data_documento: "2026-10-01", valor_itens: vi, valor_total: o.valorTotal ?? vi, ...o.extra
  });
  await inserir(tx, "documentos_compra_itens", {
    organization_id: demo.orgId, documento_id: id, produto_id: produto, quantidade: "1", valor_unitario: vi, valor_total: vi, posicao: 0, ...o.itemExtra
  });
  return id;
}, c);
const compra = (o: Cab = {}, c?: TenantContext) => documento({ ...o, especie: "compra" }, c);
const situacao = (id: string, s: string) => naApp((tx) => tx.query("update erp.documentos_compra set situacao=$2 where id=$1", [id, s]));

/** Nota antiga (erp.invoices) pelo papel da aplicação, módulo estoque (a porta de hoje). */
let codNota = 0;
const notaAntiga = (ch: string | null, o: { status?: string; empresa?: string } = {}) => withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "estoque" }, (tx) => {
  codNota += 1;
  return inserir(tx, "invoices", {
    organization_id: demo.orgId, empresa_id: o.empresa ?? A, code: `F7-N${codNota}`, number: String(1000 + codNota), series: "1", access_key: ch,
    provider_id: fornecedor, emission_date: "2026-10-01", status: o.status ?? "confirmed"
  });
});
const statusNota = (id: string, status: string) => withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "estoque" },
  (tx) => tx.query("update erp.invoices set status=$2 where id=$1", [id, status]));

/** O XML guardado, como a API grava (sha256 e tamanho do próprio texto). */
const guardarXml = (ch: string, empresa: string = A, c: TenantContext = ctx()) => naApp((tx) => {
  const texto = xmlDe(ch);
  return inserir(tx, "notas_fiscais_xml", {
    organization_id: demo.orgId, empresa_id: empresa, chave_acesso: ch, xml_original: texto, xml_sha256: createHash("sha256").update(texto).digest("hex"),
    tamanho_bytes: Buffer.byteLength(texto, "utf8"), nome_arquivo: `${ch}.xml`, recebido_por: demo.adminUserId
  });
}, c);
interface Imp { xml: string; ch: string; empresa?: string; extra?: Record<string, unknown> }
const importacao = (i: Imp, c: TenantContext = ctx()) => naApp((tx) => inserir(tx, "importacoes_nfe_compra", {
  organization_id: demo.orgId, empresa_id: i.empresa ?? A, xml_id: i.xml, chave_acesso: i.ch, numero: "1", serie: "1", data_emissao: "2026-10-01",
  emitente_documento: CNPJ_EMITENTE, emitente_nome: "Fornecedor Sintetico Ltda", valor_total: "10.00", origem: "arquivo", criado_por: demo.adminUserId, ...i.extra
}), c);
const updImportacao = (id: string, set: string, p: unknown[] = []) => naApp((tx) => tx.query(`update erp.importacoes_nfe_compra set ${set} where id=$1`, [id, ...p]));

async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; constraint?: string; message: string }; }
  throw new Error("esperava recusa, e o banco aceitou");
}
const DUPLICADA_COMPRA = "DUPLICATE_DOCUMENT: Esta nota (chave de acesso) já foi lançada nesta organização.";
const DUPLICADA_NOTA = "DUPLICATE_DOCUMENT: Esta nota (chave de acesso) já está numa compra desta organização.";

// ---------- a migration como o runner aplica ----------
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
/** Roda `sql` numa transação DESFEITA no fim (depois de `antes`) e devolve o erro — ou falha, se aplicou. */
async function recusaDe(sql: string, antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a recusa, e o SQL aplicou");
}
const recusaDa0047 = (antes?: (c: Tx) => Promise<unknown>) => recusaDe(sqlDaAlvo(), antes);
const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
const COLUNAS_CABECALHO = ["chave_acesso", "uf_nota", "tipo_documento_fiscal", "valor_ipi", "valor_icms_st", "seguro", "tipo_titulo_id", "classificacao_gasto",
  "rateio_tipo", "parcelas_nota", "dfe_id", "solicitacao_compra_id"];
const COLUNAS_ITEM = ["gera_estoque", "imobilizado", "bem_id", "categoria_financeira_id", "centro_custo_id", "valor_ipi", "valor_icms_st", "n_item_nota",
  "codigo_produto_nota", "descricao_produto_nota", "unidade_nota", "quantidade_nota", "fator_conversao", "tipo_fator_conversao"];
const TABELAS_NOVAS = ["notas_fiscais_xml", "importacoes_nfe_compra", "produto_fornecedor_vinculos", "documentos_compra_rateio"];
/** O que a 0047 cria, visto do catálogo: tabelas novas, colunas novas e as duas guardas da chave. */
const objetosDa0047 = async () => (await db.query<{ o: string }>(
  `select relname o from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='erp' and relname = any($1::text[])
   union all select table_name || '.' || column_name from information_schema.columns
    where table_schema='erp' and ((table_name='documentos_compra' and column_name::text = any($2::text[]))
       or (table_name='documentos_compra_itens' and column_name::text = any($3::text[])) or (table_name='dfe_documents' and column_name='xml_id'))
   union all select proname from pg_proc where proname in ('documentos_compra_nota_guarda','invoices_chave_nota_guarda')
   order by 1`, [TABELAS_NOVAS, COLUNAS_CABECALHO, COLUNAS_ITEM])).rows.map((r) => r.o);
const definerDeCompras = async () => (await db.query<{ fn: string }>(
  `select fn from (select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' fn
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname='erp' and p.prosecdef and (p.proname like 'documentos\\_compra%' or p.proname like 'aprovacoes\\_compra%')) x
    order by fn collate "C"`)).rows.map((r) => r.fn);
const OITO_DE_ANTES = ["erp.aprovacoes_compra_conferir_v2()", "erp.documentos_compra_aprovacao_guarda()", "erp.documentos_compra_conferir_v3()",
  "erp.documentos_compra_finalizacao_guarda()", "erp.documentos_compra_item_orcamento_guarda()", "erp.documentos_compra_item_origem_guarda_v2()",
  "erp.documentos_compra_itens_documento_aberto()", "erp.documentos_compra_transicao_v3()"];
const NOVE_DEPOIS = [...OITO_DE_ANTES, "erp.documentos_compra_nota_guarda()"].sort();

/** O ACERVO, linha a linha, sem as colunas novas (antes da 0047 elas nem existem; depois são nulas — conferido à parte). */
async function retrato() {
  const linhas = async (sql: string) => (await db.query<{ l: unknown }>(sql)).rows.map((r) => r.l);
  return {
    documentos: await linhas(`select to_jsonb(d) - '{${COLUNAS_CABECALHO.join(",")}}'::text[] l from erp.documentos_compra d order by id`),
    itens: await linhas(`select to_jsonb(i) - '{${COLUNAS_ITEM.join(",")}}'::text[] l from erp.documentos_compra_itens i order by id`),
    notas: await linhas("select to_jsonb(n) l from erp.invoices n order by id"),
    dfe: await linhas("select to_jsonb(d) - 'xml_id' l from erp.dfe_documents d order by id"),
    solicitacoes: await linhas("select to_jsonb(s) l from erp.purchase_requests s order by id")
  };
}
let antes: Awaited<ReturnType<typeof retrato>>;
const acervo = {} as { compraAberta: string; compraConfirmada: string; pedido: string; notaViva: string; chaveNotaViva: string;
  notaCancelada: string; chaveNotaCancelada: string; dfe: string; chaveDfe: string; solicitacaoA: string; solicitacaoB: string };

/** Usuário novo, membro ativo (não proprietário), com escopo SELECIONADAS = `empresas` no módulo compras e nada nos outros. */
async function membroSelecionadas(rotulo: string, empresas: string[]): Promise<string> {
  const usuario = await id1("insert into erp.users (email, name, password_hash) values ($1,$2,'x') returning id", [`${rotulo}@demo.local`, `F7 ${rotulo}`]);
  const membro = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [demo.orgId, usuario]);
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'compras','selecionadas')", [demo.orgId, membro]);
  for (const empresa of empresas) {
    await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'compras','selecionadas',$3)", [demo.orgId, membro, empresa]);
  }
  return usuario;
}
const solicitacao = (empresa: string) => {
  seq += 1;
  return withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "compras" }, (tx) => inserir(tx, "purchase_requests", {
    organization_id: demo.orgId, empresa_id: empresa, code: `F7-S${seq}`, request_date: "2026-10-01", request_type: "product", requester_user_id: demo.adminUserId,
    description: "Solicitação F7", justification: "Teste da 0047"
  }));
};

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
  fornecedor = await id1("insert into erp.people (organization_id, code, name, document, is_provider) values ($1,'F7-F1','[TEST] Fornecedor Sintético F7',$2,true) returning id",
    [demo.orgId, CNPJ_EMITENTE]);
  produto = (await db.query<{ id: string }>("select id from erp.products where organization_id=$1 and controle_lote='nenhum' order by code limit 1", [demo.orgId])).rows[0]!.id;
  tops.compra = await criarTop("compras.compra");
  tops.pedido = await criarTop("compras.pedido");
  usuarioEscopoA = await membroSelecionadas("f7-a", [A]);
  usuarioEscopoB = await membroSelecionadas("f7-b", [B]);

  // O ACERVO, pelo caminho de antes (papel da aplicação, gatilhos da 0044, colunas de hoje).
  acervo.compraAberta = await compra();
  acervo.compraConfirmada = await compra({ valorItens: "25.00" });
  await situacao(acervo.compraConfirmada, "confirmado");
  acervo.pedido = await documento({ especie: "pedido" });
  acervo.chaveNotaViva = chave();
  acervo.notaViva = await notaAntiga(acervo.chaveNotaViva);
  acervo.chaveNotaCancelada = chave();
  acervo.notaCancelada = await notaAntiga(acervo.chaveNotaCancelada);
  await statusNota(acervo.notaCancelada, "cancelled");
  acervo.chaveDfe = chave();
  acervo.dfe = await naApp((tx) => inserir(tx, "dfe_documents", { organization_id: demo.orgId, access_key: acervo.chaveDfe, issuer_document: CNPJ_EMITENTE, total: "10.00" }));
  acervo.solicitacaoA = await solicitacao(A);
  acervo.solicitacaoB = await solicitacao(B);
  antes = await retrato();
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("U — a 0047 sobre o acervo, como o runner aplica", () => {
  it("U0 PREMISSA: o banco está na migration anterior à 0047, sem os objetos dela, e o acervo está gravado", async () => {
    const noDisco = listMigrations().map((m) => m.name);
    const posicao = noDisco.indexOf(ALVO);
    expect(posicao, "a 0047 está no repositório, depois da 0046").toBeGreaterThan(noDisco.indexOf("0046_modulos_com_top.sql"));
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger, "todas as anteriores à 0047, e só elas").toEqual({ n: posicao, ultima: noDisco[posicao - 1] });
    expect(await noLedger()).toBe(false);
    expect(await objetosDa0047()).toEqual([]);
    expect(await definerDeCompras()).toEqual(OITO_DE_ANTES);
    // Sem acervo, "nenhuma linha muda" seria verdade sobre conjunto vazio.
    expect([antes.documentos.length, antes.itens.length, antes.notas.length, antes.dfe.length, antes.solicitacoes.length]).toEqual([3, 3, 2, 1, 2]);
    const notas = (await db.query<{ id: string; status: string; access_key: string }>("select id, status, access_key from erp.invoices order by code")).rows;
    expect(notas).toEqual([{ id: acervo.notaViva, status: "confirmed", access_key: acervo.chaveNotaViva },
      { id: acervo.notaCancelada, status: "cancelled", access_key: acervo.chaveNotaCancelada }]);
    expect((await db.query("select 1 from erp.dfe_documents where id=$1 and empresa_id is null", [acervo.dfe])).rowCount, "a DF-e do acervo não tem empresa").toBe(1);
    expect(acervo.chaveNotaViva).toMatch(/^[0-9]{44}$/);
    // A conta do DV feita à mão: 43 dígitos 1 → soma dos pesos 2..9 (5 ciclos de 44 + 2 + 3 + 4) = 229; 229 mod 11 = 9 → 11 − 9 = 2.
    expect(dvChave("1".repeat(43)), "o DV da chave confere com a conta feita à mão").toBe(2);
    expect(CNPJ_EMITENTE, "CNPJ sintético com os dois DVs calculados").toMatch(/^471103580001[0-9]{2}$/);
  });

  it("U2.1 trava (2026,81) em uso por outra sessão: a 0047 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 81)");
      await expect(aplicar()).rejects.toThrow(`${M}outra transacao ja detem a trava desta migration (2026,81). Nada foi aplicado.`);
    } finally { await outra.query("select pg_advisory_unlock(2026, 81)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await objetosDa0047()).toEqual([]);
  });

  it("U2.2 lock_timeout 2s: o texto o fixa, e uma leitura aberta em erp.documentos_compra faz a 0047 desistir em ~2s, sem efeito", async () => {
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
    expect(await objetosDa0047()).toEqual([]);
  });

  it("U2.3 reversas: cada pré-condição quebrada recusa a 0047 com a SUA mensagem, sem efeito", async () => {
    const JA = `${M}objetos da 0047 ja existem; a 0047 ja foi aplicada ou ha schema divergente.`;
    const jaAplicada: [string, (c: Tx) => Promise<unknown>][] = [
      ["tabela do XML", (c) => c.query("create table erp.notas_fiscais_xml (id uuid)")],
      ["tabela do rateio", (c) => c.query("create table erp.documentos_compra_rateio (id int)")],
      ["guarda da nota antiga", (c) => c.query("create function erp.invoices_chave_nota_guarda() returns trigger language plpgsql as 'begin return new; end'")],
      ["coluna do cabeçalho", (c) => c.query("alter table erp.documentos_compra add column seguro numeric")],
      ["coluna do item", (c) => c.query("alter table erp.documentos_compra_itens add column gera_estoque boolean")],
      ["coluna da DF-e", (c) => c.query("alter table erp.dfe_documents add column xml_id uuid")],
      ["gatilho da nota antiga", (c) => c.query("create trigger trg_invoices_chave_nota after update on erp.invoices for each row execute function erp.audit_row()")],
      ["índice da chave", (c) => c.query("create index ux_documentos_compra_chave on erp.documentos_compra (codigo)")],
      // "Já aplicada" vem ANTES de todas: com o papel, o CHECK e um gatilho quebrados JUNTO, o motivo dito é o verdadeiro.
      ["já aplicada antes das demais", async (c) => {
        await c.query("alter table erp.documentos_compra add column chave_acesso text");
        await c.query("alter table erp.documentos_compra disable trigger trg_documentos_compra_conferir");
        await c.query("alter table erp.documentos_compra drop constraint chk_documentos_compra_total_conferido");
        await c.query("set local role erp_app");
      }]
    ];
    for (const [nome, sabotagem] of jaAplicada) expect([nome, await recusaDa0047(sabotagem)]).toEqual([nome, JA]);

    const TOTAL_0036 = "CHECK ((valor_total = (((valor_itens + frete) + outras_despesas) - desconto)))";
    const casos: [string, (c: Tx) => Promise<unknown>, string | RegExp][] = [
      ["papel da aplicação ausente", (c) => c.query("alter role erp_app rename to erp_app_f7"), `${M}papel erp_app ausente (0007); as tabelas novas nao teriam a quem servir.`],
      ["quem aplica não atravessa RLS", (c) => c.query("set local role erp_app"),
        `${M}o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; as guardas da chave de acesso nao veriam a nota antiga nem a compra de outra empresa.`],
      ["tabela de tipo de título ausente", (c) => c.query("alter table erp.title_types rename to title_types_f7"),
        `${M}tabela ausente (documentos_compra, documentos_compra_itens, invoices, dfe_documents, purchase_requests, people, products, empresas, financial_categories, cost_centers, chart_accounts, harvests, title_types, equipments, users ou organizations); a cadeia de migrations esta fora de ordem.`],
      ["chave do bem com outro nome", (c) => c.query("alter table erp.equipments rename constraint uq_equipments_tenant to uq_f7_x"),
        `${M}chave (id, organization_id) ausente ou em outras colunas; as FKs compostas novas nao teriam alvo: {equipments.uq_equipments_tenant}`],
      ["chave (id, organization_id) já existente em chart_accounts, com outro nome", (c) => c.query("alter table erp.chart_accounts add constraint uq_f7_contas unique (organization_id, id)"),
        `${M}chave (id, organization_id) ja existe em chart_accounts, dfe_documents ou purchase_requests; a 0047 a cria (ja aplicada ou schema divergente): {chart_accounts.uq_f7_contas}`],
      ["um CHECK a mais no cabeçalho", (c) => c.query("alter table erp.documentos_compra add constraint chk_documentos_compra_extra check (true)"),
        `${M}CHECKs de erp.documentos_compra diferentes dos vinte esperados (0036, 0037 e 0044); schema divergente.`],
      ["CHECK do total diferente do da 0036", (c) => c.query(`alter table erp.documentos_compra drop constraint chk_documentos_compra_total_conferido,
          add constraint chk_documentos_compra_total_conferido check (valor_total = valor_itens + frete - desconto) not valid`),
        `${M}chk_documentos_compra_total_conferido ausente ou diferente do da 0036 (valor_total = valor_itens + frete + outras_despesas - desconto): CHECK ((valor_total = ((valor_itens + frete) - desconto))) NOT VALID`],
      ["um gatilho a mais no cabeçalho", (c) => c.query("create trigger trg_documentos_compra_zz after update on erp.documentos_compra for each row execute function erp.audit_row()"),
        /^OPERACOES-01 F7: gatilhos do documento de compra diferentes dos oito da 0044 ou desligados; schema divergente: \{.*trg_documentos_compra_zz -> audit_row.*\}$/],
      ["um gatilho desligado nos itens", (c) => c.query("alter table erp.documentos_compra_itens disable trigger trg_documentos_compra_itens_origem_guarda"),
        /^OPERACOES-01 F7: gatilhos do documento de compra diferentes dos oito da 0044 ou desligados; schema divergente: /],
      ["definer de compras desconhecida", (c) => c.query("create function erp.documentos_compra_x() returns int language sql security definer set search_path = erp as 'select 1'"),
        `${M}funcoes SECURITY DEFINER de compras diferentes das oito da 0044: {${[...OITO_DE_ANTES, "erp.documentos_compra_x()"].sort().join(",")}}`],
      ["uma das oito deixou de ser definer", (c) => c.query("alter function erp.documentos_compra_conferir_v3() security invoker"),
        `${M}funcoes SECURITY DEFINER de compras diferentes das oito da 0044: {${OITO_DE_ANTES.filter((f) => f !== "erp.documentos_compra_conferir_v3()").join(",")}}`],
      ["função das políticas ausente", (c) => c.query("alter function erp.modulo_empresa_atual() rename to f7_renomeada"),
        `${M}funcao ausente (audit_row, current_user_id, current_org_id, tenant_visible, escopo_empresa_total, empresas_do_membro ou modulo_empresa_atual); a cadeia de migrations esta fora de ordem.`],
      ["quem aplica atravessa a RLS mas não é dono das tabelas", async (c) => {
        await c.query("create role f7_aplicador nologin bypassrls");
        await c.query("grant usage on schema erp to f7_aplicador");
        await c.query("set local role f7_aplicador");
      }, `${M}o papel que aplica a migration nao e dono de documentos_compra, documentos_compra_itens, invoices, dfe_documents, purchase_requests ou chart_accounts; o ALTER TABLE e o CREATE TRIGGER seriam recusados.`],
      ["coluna lida ausente", (c) => c.query("alter table erp.invoices rename column deleted_at to deleted_at_f7"),
        /^OPERACOES-01 F7: colunas lidas pelas guardas novas ausentes ou com outro tipo: \{.*invoices\.access_key:text,invoices\.organization_id:uuid,invoices\.status:text,.*\}$/]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDa0047(sabotagem)]).toEqual([nome, typeof mensagem === "string" ? mensagem : expect.stringMatching(mensagem)]);
    }
    // Contraprova: o CHECK do total de hoje é o texto que a pré-condição fixa (lido do banco, não suposto).
    expect((await db.query<{ d: string }>("select pg_get_constraintdef(oid) d from pg_constraint where conname='chk_documentos_compra_total_conferido'")).rows[0]!.d).toBe(TOTAL_0036);
    // Nada ficou: ledger, objetos, as definer, os papéis de ensaio.
    expect(await noLedger()).toBe(false);
    expect(await objetosDa0047()).toEqual([]);
    expect(await definerDeCompras()).toEqual(OITO_DE_ANTES);
    expect((await db.query("select 1 from pg_roles where rolname like 'f7\\_%' or rolname = 'erp_app_f7'")).rowCount).toBe(0);
    expect((await db.query("select 1 from pg_roles where rolname='erp_app'")).rowCount).toBe(1);
  });

  it("U1 aplica: ledger com a 0047 por último, acervo IDÊNTICO linha a linha, colunas novas nulas no acervo, CHECKs validados e trava liberada", async () => {
    const noDisco = listMigrations().map((m) => m.name);
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: noDisco.indexOf(ALVO) + 1, ultima: ALVO });
    expect(await retrato(), "nenhuma linha de documento, item, nota antiga, DF-e ou solicitação muda").toEqual(antes);
    const preenchidas = (await db.query<{ cab: number; itens: number; dfe: number }>(
      `select (select count(*) from erp.documentos_compra where num_nonnulls(${COLUNAS_CABECALHO.join(", ")}) > 0)::int cab,
              (select count(*) from erp.documentos_compra_itens where num_nonnulls(${COLUNAS_ITEM.join(", ")}) > 0)::int itens,
              (select count(*) from erp.dfe_documents where xml_id is not null)::int dfe`)).rows[0]!;
    expect(preenchidas, "sem backfill: nenhuma coluna nova preenchida no acervo").toEqual({ cab: 0, itens: 0, dfe: 0 });
    const naoValidados = (await db.query("select conname from pg_constraint where contype='c' and not convalidated and conrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass)")).rows;
    expect(naoValidados, "o acervo cabe no CHECK do total refeito e nos novos").toEqual([]);
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 81) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });

  it("U1b o acervo continua andando como hoje: a compra aberta de antes confirma; a nota antiga viva é atualizada sem mexer na chave", async () => {
    expect((await db.query<{ s: string }>("select situacao s from erp.documentos_compra where id=$1", [acervo.compraAberta])).rows[0]!.s, "premissa").toBe("aberto");
    await expect(situacao(acervo.compraAberta, "confirmado")).resolves.toMatchObject({ rowCount: 1 });
    await expect(withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "estoque" },
      (tx) => tx.query("update erp.invoices set note='conferida' where id=$1", [acervo.notaViva]))).resolves.toMatchObject({ rowCount: 1 });
  });

  it("U2.4 reaplicar é recusado pela pré-condição 'já aplicada', sem efeito", async () => {
    expect(await recusaDa0047()).toBe(`${M}objetos da 0047 ja existem; a 0047 ja foi aplicada ou ha schema divergente.`);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n).toBe(1);
  });

  it("U3.1 pós: o total refeito, as guardas novas EXATAS, as funções e os privilégios, como o contrato", async () => {
    const total = (await db.query<{ d: string; ok: boolean }>(
      "select pg_get_constraintdef(oid) d, convalidated ok from pg_constraint where conrelid='erp.documentos_compra'::regclass and conname='chk_documentos_compra_total_conferido'")).rows;
    expect(total).toEqual([{ ok: true,
      d: "CHECK ((valor_total = ((((((valor_itens + frete) + outras_despesas) - desconto) + COALESCE(valor_ipi, (0)::numeric)) + COALESCE(valor_icms_st, (0)::numeric)) + COALESCE(seguro, (0)::numeric))))" }]);
    expect((await db.query<{ n: number }>("select count(*)::int n from pg_constraint where contype='c' and conrelid='erp.documentos_compra'::regclass and conname like 'chk\\_documentos\\_compra\\_%'")).rows[0]!.n,
      "vinte de antes + dez novos (o do total é refeito, não somado)").toBe(30);
    const trg = (await db.query<{ def: string }>(
      `select pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and tgenabled='O'
        and tgname in ('trg_documentos_compra_nota','trg_invoices_chave_nota','trg_dfe_documents_xml') order by tgname`)).rows.map((x) => x.def);
    expect(trg).toEqual([
      "CREATE TRIGGER trg_dfe_documents_xml BEFORE INSERT OR UPDATE OF xml_id, access_key, empresa_id ON erp.dfe_documents FOR EACH ROW EXECUTE FUNCTION erp.dfe_documents_xml_guarda()",
      "CREATE TRIGGER trg_documentos_compra_nota BEFORE INSERT OR UPDATE OF chave_acesso, uf_nota, tipo_documento_fiscal, valor_ipi, valor_icms_st, seguro, tipo_titulo_id, classificacao_gasto, rateio_tipo, parcelas_nota, dfe_id, solicitacao_compra_id ON erp.documentos_compra FOR EACH ROW EXECUTE FUNCTION erp.documentos_compra_nota_guarda()",
      "CREATE TRIGGER trg_invoices_chave_nota BEFORE INSERT OR UPDATE OF access_key, status, deleted_at ON erp.invoices FOR EACH ROW EXECUTE FUNCTION erp.invoices_chave_nota_guarda()"
    ]);
    expect(await definerDeCompras()).toEqual(NOVE_DEPOIS);
    const fns = (await db.query<{ fn: string; definer: boolean; cfg: string[]; app: boolean; atravessa: boolean }>(
      `select p.proname fn, p.prosecdef definer, p.proconfig cfg, has_function_privilege('erp_app', p.oid, 'execute') app, r.rolsuper or r.rolbypassrls atravessa
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
        where n.nspname='erp' and p.proname in ('notas_fiscais_xml_imutavel','importacoes_nfe_compra_guarda','importacoes_nfe_compra_imutavel',
              'documentos_compra_rateio_guarda','dfe_documents_xml_guarda','documentos_compra_nota_guarda','invoices_chave_nota_guarda')
        order by p.proname collate "C"`)).rows;
    const so = (definer: boolean) => ({ definer, cfg: ["search_path=erp, pg_temp"], app: false, atravessa: true });
    expect(fns).toEqual([
      { fn: "dfe_documents_xml_guarda", ...so(false) }, { fn: "documentos_compra_nota_guarda", ...so(true) }, { fn: "documentos_compra_rateio_guarda", ...so(false) },
      { fn: "importacoes_nfe_compra_guarda", ...so(false) }, { fn: "importacoes_nfe_compra_imutavel", ...so(false) }, { fn: "invoices_chave_nota_guarda", ...so(true) },
      { fn: "notas_fiscais_xml_imutavel", ...so(false) }
    ]);
    const priv = (await db.query<{ t: string; s: boolean; i: boolean; u: boolean; d: boolean }>(
      `select t, has_table_privilege('erp_app', 'erp.' || t, 'select') s, has_table_privilege('erp_app', 'erp.' || t, 'insert') i,
              has_table_privilege('erp_app', 'erp.' || t, 'update') u, has_table_privilege('erp_app', 'erp.' || t, 'delete') d
         from unnest($1::text[]) t order by t`, [TABELAS_NOVAS])).rows;
    expect(priv).toEqual([
      { t: "documentos_compra_rateio", s: true, i: true, u: false, d: false }, { t: "importacoes_nfe_compra", s: true, i: true, u: true, d: false },
      { t: "notas_fiscais_xml", s: true, i: true, u: false, d: false }, { t: "produto_fornecedor_vinculos", s: true, i: true, u: true, d: false }
    ]);
    const pol = (await db.query<{ tablename: string; policyname: string; cmd: string }>(
      "select tablename, policyname, cmd from pg_policies where schemaname='erp' and tablename = any($1::text[]) order by tablename", [TABELAS_NOVAS])).rows;
    expect(pol).toEqual([
      { tablename: "documentos_compra_rateio", policyname: "api_child", cmd: "ALL" }, { tablename: "importacoes_nfe_compra", policyname: "tenant_e_empresa", cmd: "ALL" },
      { tablename: "notas_fiscais_xml", policyname: "tenant_e_empresa", cmd: "ALL" }, { tablename: "produto_fornecedor_vinculos", policyname: "tenant_isolation", cmd: "ALL" }
    ]);
  });

  /**
   * As PÓS-CONDIÇÕES só leem OBJETOS (catálogo), nunca tabela viva — no deploy a tabela viva tem o dado de produção. E
   * cada uma morde: o bloco delas (o trecho "13)" do arquivo, como está) roda de novo sobre o banco aplicado, com UM
   * objeto quebrado numa transação desfeita, e recusa com a SUA mensagem.
   */
  it("U3.2 pós-condições: só de objetos, passam no banco aplicado, e cada uma, quebrada, recusa com a sua mensagem", async () => {
    const sql = sqlDaAlvo();
    const inicio = sql.indexOf(POS);
    expect(inicio, "o marcador literal da seção 13) existe").toBeGreaterThan(0);
    const pos = sql.slice(inicio);
    expect(pos).toMatch(/^-- [^\n]*\ndo \$\$/);
    expect(pos.match(/\b(from|join)\s+erp\.\w+/gi), "nenhuma leitura de tabela do erp nas pós-condições").toBeNull();
    const c = await db.connect();
    try { await c.query("begin"); await expect(c.query(pos)).resolves.toBeTruthy(); } finally { await c.query("rollback"); c.release(); }

    const casos: [string, string, string | RegExp][] = [
      ["coluna nova com outro tipo", "alter table erp.documentos_compra_itens alter column codigo_produto_nota type varchar(60)",
        /^OPERACOES-01 F7: colunas novas ausentes ou com tipo\/nulidade errados: .*documentos_compra_itens\.codigo_produto_nota:character varying:YES/],
      ["RLS do vínculo não forçada", "alter table erp.produto_fornecedor_vinculos no force row level security", /^OPERACOES-01 F7: tabelas novas ausentes, sem RLS forcada .*produto_fornecedor_vinculos:true:false:tenant_isolation/],
      ["política a mais no XML", "create policy aberta on erp.notas_fiscais_xml for select to erp_app using (true)", /^OPERACOES-01 F7: tabelas novas .*notas_fiscais_xml:true:true:aberta\/r,tenant_e_empresa\/\*/],
      ["FK do rateio em cascata", "alter table erp.documentos_compra_rateio drop constraint fk_documentos_compra_rateio_documento, add constraint fk_documentos_compra_rateio_documento foreign key (documento_id, organization_id) references erp.documentos_compra (id, organization_id) on delete cascade",
        /^OPERACOES-01 F7: FKs novas ausentes, .*fk_documentos_compra_rateio_documento documentos_compra_rateio\(documento_id,organization_id\) -> documentos_compra\(id,organization_id\) ca/],
      ["FK da DF-e de coluna só", "alter table erp.documentos_compra drop constraint fk_documentos_compra_dfe, add constraint fk_documentos_compra_dfe foreign key (dfe_id) references erp.dfe_documents (id)",
        /^OPERACOES-01 F7: FKs novas ausentes, .*fk_documentos_compra_dfe documentos_compra\(dfe_id\) -> dfe_documents\(id\) aa/],
      ["chave nova renomeada", "alter table erp.dfe_documents rename constraint uq_dfe_documents_tenant to uq_f7_x",
        `${M}chaves (id, organization_id) novas (uq_chart_accounts_tenant, uq_dfe_documents_tenant, uq_purchase_requests_tenant) ausentes ou em outras colunas.`],
      ["CHECK novo não validado", "alter table erp.documentos_compra drop constraint chk_documentos_compra_seguro, add constraint chk_documentos_compra_seguro check (seguro is null or seguro >= 0) not valid",
        `${M}CHECKs de erp.documentos_compra incompletos ou nao validados (esperados 30, com os dez novos e o total refeito), ou CHECK nao validado nos itens e nas tabelas novas.`],
      ["o total antigo de volta", "alter table erp.documentos_compra drop constraint chk_documentos_compra_total_conferido, add constraint chk_documentos_compra_total_conferido check (valor_total = valor_itens + frete + outras_despesas - desconto)",
        /^OPERACOES-01 F7: chk_documentos_compra_total_conferido ausente ou sem a equacao nova /],
      ["CHECK do item ausente", "alter table erp.documentos_compra_itens drop constraint chk_documentos_compra_itens_conversao", /^OPERACOES-01 F7: CHECKs dos itens ou das tabelas novas ausentes: /],
      ["índice da chave virou comum", "drop index erp.ux_documentos_compra_chave; create index ux_documentos_compra_chave on erp.documentos_compra (organization_id, chave_acesso) where especie = 'compra' and situacao <> 'cancelado' and chave_acesso is not null",
        /^OPERACOES-01 F7: indices novos ausentes, .*"ux_documentos_compra_chave documentos_compra\(organization_id,chave_acesso\) where /],
      ["pendente sem predicado", "drop index erp.ux_importacoes_nfe_compra_pendente; create unique index ux_importacoes_nfe_compra_pendente on erp.importacoes_nfe_compra (organization_id, chave_acesso, situacao)",
        /^OPERACOES-01 F7: indices novos ausentes, /],
      ["guarda da nota antiga desligada", "alter table erp.invoices disable trigger trg_invoices_chave_nota",
        /^OPERACOES-01 F7: gatilhos do documento de compra, da nota antiga, da DF-e ou das tabelas novas diferentes do esperado ou desligados: /],
      ["guarda da compra sem uma coluna fiscal", "drop trigger trg_documentos_compra_nota on erp.documentos_compra; create trigger trg_documentos_compra_nota before insert or update of chave_acesso on erp.documentos_compra for each row execute function erp.documentos_compra_nota_guarda()",
        /^OPERACOES-01 F7: gatilhos .*documentos_compra\.trg_documentos_compra_nota -> documentos_compra_nota_guarda:23:chave_acesso",/],
      ["gatilho a mais no XML", "create trigger trg_notas_fiscais_xml_zz after insert on erp.notas_fiscais_xml for each row execute function erp.audit_row()",
        /^OPERACOES-01 F7: gatilhos .*notas_fiscais_xml\.trg_notas_fiscais_xml_zz -> audit_row:5:/],
      ["guarda da compra virou invoker", "alter function erp.documentos_compra_nota_guarda() security invoker",
        /^OPERACOES-01 F7: funcoes SECURITY DEFINER de compras diferentes das nove esperadas depois da 0047: /],
      ["guarda da importação virou definer", "alter function erp.importacoes_nfe_compra_guarda() security definer",
        /^OPERACOES-01 F7: funcoes novas fora da forma .*importacoes_nfe_compra_guarda:definer:v:/],
      ["guarda do rateio sem search_path", "alter function erp.documentos_compra_rateio_guarda() reset search_path",
        /^OPERACOES-01 F7: funcoes novas fora da forma .*documentos_compra_rateio_guarda:invoker:v:,/],
      ["EXECUTE do erp_app", "grant execute on function erp.invoices_chave_nota_guarda() to erp_app", `${M}EXECUTE das funcoes de gatilho novas ainda concedido alem do dono.`],
      ["DELETE da importação ao erp_app", "grant delete on erp.importacoes_nfe_compra to erp_app",
        /^OPERACOES-01 F7: privilegios do erp_app nas tabelas novas diferentes do esperado .*importacoes_nfe_compra:DELETE/],
      ["UPDATE do XML ao erp_app", "grant update on erp.notas_fiscais_xml to erp_app", /^OPERACOES-01 F7: privilegios do erp_app .*notas_fiscais_xml:UPDATE/],
      ["coluna nova sem comentário", "comment on column erp.documentos_compra.seguro is null", `${M}tabela ou coluna nova sem comentario: {documentos_compra.seguro}`],
      ["tabela nova sem comentário", "comment on table erp.documentos_compra_rateio is null", `${M}tabela ou coluna nova sem comentario: {documentos_compra_rateio}`]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDe(pos, (t) => t.query(sabotagem))]).toEqual([nome, typeof mensagem === "string" ? mensagem : expect.stringMatching(mensagem)]);
    }
    // Nada ficou.
    expect(await definerDeCompras()).toEqual(NOVE_DEPOIS);
    expect((await db.query<{ x: boolean }>("select has_function_privilege('erp_app', 'erp.invoices_chave_nota_guarda()', 'execute') x")).rows[0]!.x).toBe(false);
  });
});

describe("B1/B2 — o total novo e os campos fiscais só na compra (papel da aplicação)", () => {
  it("total = itens + frete + outras − desconto + IPI + ICMS-ST + seguro; a equação sem os impostos é recusada pelo CHECK do total", async () => {
    const extra = { chave_acesso: chave(), uf_nota: "MT", tipo_documento_fiscal: "nfe", valor_ipi: "10.00", valor_icms_st: "5.00", seguro: "2.00", frete: "3.00", desconto: "1.00" };
    const id = await compra({ valorItens: "100.00", valorTotal: "119.00", extra });
    const lido = (await db.query("select valor_total, valor_ipi, valor_icms_st, seguro, uf_nota, tipo_documento_fiscal from erp.documentos_compra where id=$1", [id])).rows[0];
    expect(lido).toEqual({ valor_total: "119.00", valor_ipi: "10.00", valor_icms_st: "5.00", seguro: "2.00", uf_nota: "MT", tipo_documento_fiscal: "nfe" });
    const sem = await erroDe(compra({ valorItens: "100.00", valorTotal: "102.00", extra: { ...extra, chave_acesso: chave() } }));
    expect([sem.code, sem.constraint], "102 = 100 + 3 − 1 ignora IPI, ICMS-ST e seguro").toEqual(["23514", "chk_documentos_compra_total_conferido"]);
    // A compra de hoje (sem as colunas novas) continua com a equação de antes.
    await expect(compra({ valorItens: "40.00", valorTotal: "40.00" })).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("os CHECKs novos: só a compra tem dados fiscais; chave com 44 dígitos; UF; rateio sem natureza no cabeçalho; parcelas da nota sem plano; item com bem só se imobilizado; conversão completa", async () => {
    expect((await db.query("select 1 from erp.documentos_compra where id=$1 and especie='pedido'", [acervo.pedido])).rowCount, "premissa: há pedido").toBe(1);
    const ch = chave();
    const casos: [string, () => Promise<unknown>, string][] = [
      ["pedido com chave", () => documento({ especie: "pedido", extra: { chave_acesso: ch } }), "chk_documentos_compra_campos_fiscais"],
      ["pedido com seguro", () => documento({ especie: "pedido", valorTotal: "11.00", extra: { seguro: "1.00" } }), "chk_documentos_compra_campos_fiscais"],
      ["chave com 43 dígitos", () => compra({ extra: { chave_acesso: ch.slice(1) } }), "chk_documentos_compra_chave_acesso"],
      ["UF minúscula", () => compra({ extra: { uf_nota: "mt" } }), "chk_documentos_compra_uf_nota"],
      ["IPI negativo", () => compra({ valorTotal: "9.00", extra: { valor_ipi: "-1.00" } }), "chk_documentos_compra_valor_ipi"],
      ["rateio com natureza no cabeçalho", async () => {
        const cat = await id1("select id from erp.financial_categories where organization_id=$1 and kind='analytic' order by code limit 1", [demo.orgId]);
        const cc = await id1("select id from erp.cost_centers where organization_id=$1 and kind='analytic' order by code limit 1", [demo.orgId]);
        return compra({ extra: { rateio_tipo: "por_valor", categoria_financeira_id: cat, centro_custo_id: cc } });
      }, "chk_documentos_compra_rateio_tipo"],
      ["parcelas da nota com plano", () => compra({ extra: { parcelas_nota: JSON.stringify([{ vencimento: "2026-11-01", valor: "10.00" }]), plano_parcelas: JSON.stringify([]) } }), "chk_documentos_compra_parcelas_nota"],
      ["parcelas da nota vazias", () => compra({ extra: { parcelas_nota: JSON.stringify([]) } }), "chk_documentos_compra_parcelas_nota"],
      ["parcelas da nota como objeto (recusa do CHECK, não erro de função)", () => compra({ extra: { parcelas_nota: JSON.stringify({ vencimento: "2026-11-01" }) } }), "chk_documentos_compra_parcelas_nota"],
      ["classificação fora do domínio", () => compra({ extra: { classificacao_gasto: "outro" } }), "chk_documentos_compra_classificacao_gasto"],
      ["item com bem sem ser imobilizado", async () => {
        const bem = await id1("select id from erp.equipments where organization_id=$1 order by code limit 1", [demo.orgId]);
        return compra({ itemExtra: { bem_id: bem } });
      }, "chk_documentos_compra_itens_bem"],
      ["conversão pela metade (o NULL do fator não pode passar no CHECK)", () => compra({ itemExtra: { unidade_nota: "CX", quantidade_nota: "2" } }), "chk_documentos_compra_itens_conversao"],
      ["conversão com tipo de fator desconhecido", () => compra({ itemExtra: { unidade_nota: "CX", quantidade_nota: "2", fator_conversao: "12", tipo_fator_conversao: "soma" } }), "chk_documentos_compra_itens_conversao"],
      ["natureza do item sem centro", async () => {
        const cat = await id1("select id from erp.financial_categories where organization_id=$1 and kind='analytic' order by code limit 1", [demo.orgId]);
        return compra({ itemExtra: { categoria_financeira_id: cat } });
      }, "chk_documentos_compra_itens_classificacao_par"]
    ];
    for (const [nome, p, constraint] of casos) {
      // Aceito por engano aparece com o NOME do caso na diferença, e não como um erro anônimo.
      const e = await erroDe(p()).catch(() => ({ code: "aceito", constraint: undefined }));
      expect([nome, e.code, e.constraint]).toEqual([nome, "23514", constraint]);
    }
    // Contraprova: a compra completa (rateio por valor, parcelas, conversão, item imobilizado sem bem ainda) passa.
    await expect(compra({
      extra: { chave_acesso: chave(), rateio_tipo: "por_valor", parcelas_nota: JSON.stringify([{ vencimento: "2026-11-01", valor: "10.00" }]), classificacao_gasto: "capex" },
      itemExtra: { imobilizado: true, gera_estoque: false, unidade_nota: "CX", quantidade_nota: "1", fator_conversao: "12", tipo_fator_conversao: "multiply", n_item_nota: 1 }
    })).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("B3/B4 — a nota repetida barrada NO BANCO", () => {
  it("entre compras: duas compras vivas com a mesma chave = 23505 ux_documentos_compra_chave; cancelar a primeira libera", async () => {
    const ch = chave();
    const primeira = await compra({ extra: { chave_acesso: ch } });
    const e = await erroDe(compra({ extra: { chave_acesso: ch } }));
    expect([e.code, e.constraint]).toEqual(["23505", "ux_documentos_compra_chave"]);
    // Também em outra empresa da mesma organização.
    expect((await erroDe(compra({ empresa: B, extra: { chave_acesso: ch } }))).constraint).toBe("ux_documentos_compra_chave");
    await expect(situacao(primeira, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
    await expect(compra({ extra: { chave_acesso: ch } })).resolves.toMatch(/^[0-9a-f-]{36}$/);
    expect((await db.query<{ n: number }>("select count(*)::int n from erp.documentos_compra where chave_acesso=$1 and situacao <> 'cancelado'", [ch])).rows[0]!.n).toBe(1);
  });

  it("compra com a chave de uma nota antiga VIVA → DUPLICATE_DOCUMENT; a nota CANCELADA não barra", async () => {
    expect((await db.query<{ status: string }>("select status from erp.invoices where id=$1", [acervo.notaViva])).rows[0]!.status, "premissa").toBe("confirmed");
    expect((await erroDe(compra({ extra: { chave_acesso: acervo.chaveNotaViva } }))).message).toBe(DUPLICADA_COMPRA);
    expect((await db.query("select 1 from erp.documentos_compra where chave_acesso=$1", [acervo.chaveNotaViva])).rowCount).toBe(0);
    expect((await db.query<{ status: string }>("select status from erp.invoices where id=$1", [acervo.notaCancelada])).rows[0]!.status, "premissa").toBe("cancelled");
    await expect(compra({ extra: { chave_acesso: acervo.chaveNotaCancelada } })).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a guarda atravessa a RLS: quem só enxerga a empresa B não lança compra com a chave de nota antiga da empresa A", async () => {
    const ch = chave();
    await notaAntiga(ch, { empresa: A });
    const daB = { ...ctx(usuarioEscopoB) };
    const visivel = await withTx(app, daB, (tx) => tx.query("select 1 from erp.invoices where access_key=$1", [ch]));
    expect(visivel.rowCount, "premissa: a nota da empresa A é invisível para quem só tem a B").toBe(0);
    expect((await erroDe(compra({ empresa: B, extra: { chave_acesso: ch } }, daB))).message).toBe(DUPLICADA_COMPRA);
  });

  it("nota antiga com a chave de uma compra VIVA → DUPLICATE_DOCUMENT (inserir e reativar); compra cancelada não barra", async () => {
    const ch = chave();
    const viva = await compra({ extra: { chave_acesso: ch } });
    expect((await erroDe(notaAntiga(ch))).message).toBe(DUPLICADA_NOTA);
    // A nota nasce cancelada (a guarda não olha) e depois tenta voltar a viver: a mesma recusa.
    const cancelada = await notaAntiga(ch, { status: "cancelled" });
    expect((await erroDe(statusNota(cancelada, "confirmed"))).message).toBe(DUPLICADA_NOTA);
    expect((await db.query<{ status: string }>("select status from erp.invoices where id=$1", [cancelada])).rows[0]!.status).toBe("cancelled");
    // Até de outra empresa: a compra da empresa A barra a nota antiga da empresa B.
    expect((await erroDe(notaAntiga(ch, { empresa: B }))).message).toBe(DUPLICADA_NOTA);
    // Cancelada a compra, a nota antiga volta a viver (o ux_invoices_key de hoje continua barrando uma SEGUNDA nota antiga da mesma chave).
    await situacao(viva, "cancelado");
    await expect(statusNota(cancelada, "confirmed")).resolves.toMatchObject({ rowCount: 1 });
    expect((await db.query<{ status: string }>("select status from erp.invoices where id=$1", [cancelada])).rows[0]!.status).toBe("confirmed");
  });
});

describe("B5 — os dados fiscais da compra e as referências conferidas no lançamento", () => {
  it("as doze colunas fiscais não mudam depois do lançamento (nem com a compra aberta); a situação continua mudando", async () => {
    const id = await compra({ valorTotal: "12.00", extra: { chave_acesso: chave(), seguro: "2.00", uf_nota: "MT" } });
    const IMUTAVEL = "VALIDATION_ERROR: Os dados fiscais da compra não mudam depois do lançamento.";
    for (const set of ["chave_acesso = null", "uf_nota = 'GO'", "seguro = 1, valor_total = 11", "classificacao_gasto = 'opex'", "rateio_tipo = 'por_produto'"]) {
      expect([set, (await erroDe(naApp((tx) => tx.query(`update erp.documentos_compra set ${set} where id=$1`, [id])))).message]).toEqual([set, IMUTAVEL]);
    }
    // O mesmo valor no SET não é mudança.
    await expect(naApp((tx) => tx.query("update erp.documentos_compra set uf_nota = 'MT', observacao = 'ok' where id=$1", [id]))).resolves.toMatchObject({ rowCount: 1 });
    await expect(situacao(id, "confirmado")).resolves.toMatchObject({ rowCount: 1 });
    expect((await db.query("select situacao, uf_nota, seguro from erp.documentos_compra where id=$1", [id])).rows[0]).toEqual({ situacao: "confirmado", uf_nota: "MT", seguro: "2.00" });
  });

  it("tipo de título, DF-e e solicitação: da mesma organização (e empresa) — senão a recusa da guarda, antes da FK", async () => {
    const tipoGlobal = await id1("select id from erp.title_types where organization_id is null order by name limit 1");
    await expect(compra({ extra: { tipo_titulo_id: tipoGlobal } }), "contraprova: o tipo de título global vale").resolves.toMatch(/^[0-9a-f-]{36}$/);
    expect((await erroDe(compra({ extra: { tipo_titulo_id: randomUUID() } }))).message).toBe("VALIDATION_ERROR: Tipo de título inválido.");

    const DFE = "VALIDATION_ERROR: A DF-e vinculada precisa ser da mesma empresa e ter a mesma chave de acesso.";
    const dfeB = await naApp((tx) => inserir(tx, "dfe_documents", { organization_id: demo.orgId, access_key: chave(), empresa_id: B }));
    const chaveDfeB = (await db.query<{ k: string }>("select access_key k from erp.dfe_documents where id=$1", [dfeB])).rows[0]!.k;
    expect((await erroDe(compra({ extra: { dfe_id: acervo.dfe } }))).message, "sem a chave junto").toBe(DFE);
    expect((await erroDe(compra({ extra: { dfe_id: acervo.dfe, chave_acesso: chave() } }))).message, "outra chave").toBe(DFE);
    expect((await erroDe(compra({ empresa: A, extra: { dfe_id: dfeB, chave_acesso: chaveDfeB } }))).message, "DF-e da empresa B").toBe(DFE);
    await expect(compra({ extra: { dfe_id: acervo.dfe, chave_acesso: acervo.chaveDfe } }), "DF-e sem empresa, mesma chave").resolves.toMatch(/^[0-9a-f-]{36}$/);
    await expect(compra({ empresa: B, extra: { dfe_id: dfeB, chave_acesso: chaveDfeB } }), "DF-e da mesma empresa").resolves.toMatch(/^[0-9a-f-]{36}$/);

    const SOLIC = "VALIDATION_ERROR: A solicitação de compra precisa ser da mesma empresa.";
    expect((await erroDe(compra({ empresa: A, extra: { solicitacao_compra_id: acervo.solicitacaoB } }))).message).toBe(SOLIC);
    expect((await erroDe(compra({ extra: { solicitacao_compra_id: randomUUID() } }))).message).toBe(SOLIC);
    await expect(compra({ empresa: A, extra: { solicitacao_compra_id: acervo.solicitacaoA } })).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("B6 — o XML original: imutável, sem DELETE (privilégio E gatilho)", () => {
  it("o erp_app grava e lê; UPDATE e DELETE são negados pelo privilégio; o dono, que passaria pelo privilégio, é parado pelo gatilho", async () => {
    const ch = chave();
    const xml = await guardarXml(ch);
    const lido = (await db.query("select chave_acesso, tamanho_bytes, octet_length(xml_original) n, empresa_id from erp.notas_fiscais_xml where id=$1", [xml])).rows[0];
    expect(lido).toEqual({ chave_acesso: ch, tamanho_bytes: Buffer.byteLength(xmlDe(ch)), n: Buffer.byteLength(xmlDe(ch)), empresa_id: A });
    for (const sql of ["update erp.notas_fiscais_xml set nome_arquivo='x.xml' where id=$1", "delete from erp.notas_fiscais_xml where id=$1"]) {
      const e = await erroDe(naApp((tx) => tx.query(sql, [xml])));
      expect([sql, e.code, e.message]).toEqual([sql, "42501", "permission denied for table notas_fiscais_xml"]);
    }
    const IMUTAVEL = "CONFLICT: O XML original da nota não muda nem é apagado.";
    expect((await erroDe(db.query("update erp.notas_fiscais_xml set nome_arquivo='x.xml' where id=$1", [xml]))).message).toBe(IMUTAVEL);
    expect((await erroDe(db.query("delete from erp.notas_fiscais_xml where id=$1", [xml]))).message).toBe(IMUTAVEL);
    expect((await db.query("select nome_arquivo from erp.notas_fiscais_xml where id=$1", [xml])).rows[0]).toEqual({ nome_arquivo: `${ch}.xml` });
  });

  it("os CHECKs do XML: chave, sha256, tamanho igual ao do texto; o mesmo conteúdo duas vezes = 23505", async () => {
    const ch = chave();
    const texto = xmlDe(ch);
    const base = { organization_id: demo.orgId, empresa_id: A, chave_acesso: ch, xml_original: texto, xml_sha256: createHash("sha256").update(texto).digest("hex"),
      tamanho_bytes: Buffer.byteLength(texto), recebido_por: demo.adminUserId };
    const casos: [string, Record<string, unknown>, string][] = [
      ["chave curta", { chave_acesso: ch.slice(2) }, "chk_notas_fiscais_xml_chave"],
      ["sha maiúsculo", { xml_sha256: base.xml_sha256.toUpperCase() }, "chk_notas_fiscais_xml_sha"],
      ["tamanho diferente do texto", { tamanho_bytes: base.tamanho_bytes + 1 }, "chk_notas_fiscais_xml_tamanho"]
    ];
    for (const [nome, v, constraint] of casos) {
      const e = await erroDe(naApp((tx) => inserir(tx, "notas_fiscais_xml", { ...base, ...v })));
      expect([nome, e.code, e.constraint]).toEqual([nome, "23514", constraint]);
    }
    await naApp((tx) => inserir(tx, "notas_fiscais_xml", base));
    expect((await erroDe(naApp((tx) => inserir(tx, "notas_fiscais_xml", base)))).constraint).toBe("uq_notas_fiscais_xml_conteudo");
  });
});

describe("B7 — a importação: nasce pendente, decide uma vez, nunca se apaga", () => {
  it("nasce pendente e com o XML da MESMA empresa e chave; uma pendente por chave", async () => {
    const ch = chave();
    const xml = await guardarXml(ch);
    expect((await erroDe(importacao({ xml, ch, extra: { situacao: "gerada", documento_compra_id: acervo.compraConfirmada } }))).message).toBe("VALIDATION_ERROR: A importação nasce pendente.");
    const NAO_E = "VALIDATION_ERROR: O XML guardado não é desta importação.";
    expect((await erroDe(importacao({ xml, ch: chave() }))).message, "outra chave").toBe(NAO_E);
    expect((await erroDe(importacao({ xml, ch, empresa: B }))).message, "outra empresa").toBe(NAO_E);
    const imp = await importacao({ xml, ch });
    expect((await db.query("select situacao, decidido_em from erp.importacoes_nfe_compra where id=$1", [imp])).rows[0]).toEqual({ situacao: "pendente", decidido_em: null });
    const e = await erroDe(importacao({ xml, ch }));
    expect([e.code, e.constraint]).toEqual(["23505", "ux_importacoes_nfe_compra_pendente"]);
  });

  it("pendente → gerada só com a compra viva da mesma chave e empresa; decidida não volta; descartada libera nova pendente", async () => {
    const ch = chave();
    const xml = await guardarXml(ch);
    const imp = await importacao({ xml, ch });
    const outraCompra = await compra({ extra: { chave_acesso: chave() } });
    const DECIDIR = "situacao='gerada', documento_compra_id=$2, decidido_por=$3, decidido_em=now()";
    expect((await erroDe(updImportacao(imp, DECIDIR, [outraCompra, demo.adminUserId]))).message).toBe("VALIDATION_ERROR: A compra gerada não é desta nota.");
    expect((await erroDe(updImportacao(imp, "numero='2'"))).message).toBe("VALIDATION_ERROR: A importação não muda; só a decisão é registrada.");
    const daNota = await compra({ extra: { chave_acesso: ch } });
    await expect(updImportacao(imp, DECIDIR, [daNota, demo.adminUserId])).resolves.toMatchObject({ rowCount: 1 });
    expect((await db.query("select situacao, documento_compra_id from erp.importacoes_nfe_compra where id=$1", [imp])).rows[0]).toEqual({ situacao: "gerada", documento_compra_id: daNota });
    expect((await erroDe(updImportacao(imp, "situacao='descartada', documento_compra_id=null"))).message).toBe("CONFLICT: A importação já foi decidida (situação: gerada).");
    // Descartada: a mesma chave pode ser importada de novo.
    const ch2 = chave();
    const xml2 = await guardarXml(ch2);
    const imp2 = await importacao({ xml: xml2, ch: ch2 });
    await expect(updImportacao(imp2, "situacao='descartada', decidido_por=$2, decidido_em=now()", [demo.adminUserId])).resolves.toMatchObject({ rowCount: 1 });
    const imp3 = await importacao({ xml: xml2, ch: ch2 });
    // O carimbo da decisão sem a decisão: a pendente só passa a gerada ou descartada.
    expect((await erroDe(updImportacao(imp3, "decidido_por=$2, decidido_em=now()", [demo.adminUserId]))).message)
      .toBe("VALIDATION_ERROR: A importação pendente só passa a gerada ou descartada.");
    // E o CHECK sozinho (o dono, sem os gatilhos): descartada sem quem decidiu.
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query("alter table erp.importacoes_nfe_compra disable trigger user");
      const e = await erroDe(c.query("update erp.importacoes_nfe_compra set situacao='descartada' where id=$1", [imp3]));
      expect([e.code, e.constraint]).toEqual(["23514", "chk_importacoes_nfe_compra_decisao"]);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
  });

  it("nunca se apaga: DELETE negado ao erp_app pelo privilégio, e ao dono pelo gatilho (linha e TRUNCATE)", async () => {
    const ch = chave();
    const imp = await importacao({ xml: await guardarXml(ch), ch });
    const e = await erroDe(naApp((tx) => tx.query("delete from erp.importacoes_nfe_compra where id=$1", [imp])));
    expect([e.code, e.message]).toEqual(["42501", "permission denied for table importacoes_nfe_compra"]);
    const APAGAR = "CONFLICT: A importação não é apagada (decisão 247).";
    expect((await erroDe(db.query("delete from erp.importacoes_nfe_compra where id=$1", [imp]))).message).toBe(APAGAR);
    expect((await erroDe(db.query("truncate erp.importacoes_nfe_compra"))).message).toBe(APAGAR);
    expect((await db.query("select 1 from erp.importacoes_nfe_compra where id=$1", [imp])).rowCount).toBe(1);
  });

  it("vinda da DF-e: a DF-e precisa ter a mesma chave e o MESMO XML", async () => {
    const ch = chave();
    const xml = await guardarXml(ch);
    const dfe = await naApp((tx) => inserir(tx, "dfe_documents", { organization_id: demo.orgId, access_key: ch }));
    const daDfe = { origem: "dfe", dfe_id: dfe };
    expect((await erroDe(importacao({ xml, ch, extra: daDfe }))).message, "a DF-e ainda sem o XML").toBe("VALIDATION_ERROR: A DF-e não é desta nota.");
    await naApp((tx) => tx.query("update erp.dfe_documents set xml_id=$2 where id=$1", [dfe, xml]));
    await expect(importacao({ xml, ch, extra: daDfe })).resolves.toMatch(/^[0-9a-f-]{36}$/);
    const e = await erroDe(importacao({ xml, ch, extra: { origem: "arquivo", dfe_id: dfe } }));
    expect([e.code, e.constraint], "origem arquivo não leva DF-e").toEqual(["23514", "chk_importacoes_nfe_compra_origem"]);
  });
});

describe("B8 — o rateio por valor: só da compra aberta com rateio por valor, imutável", () => {
  let cat: string; let cc: string; let conta: string; let safra: string;
  const linha = (doc: string, posicao: number, percentual: string) => naApp((tx) => inserir(tx, "documentos_compra_rateio", {
    organization_id: demo.orgId, documento_id: doc, posicao, categoria_financeira_id: cat, centro_custo_id: cc, conta_contabil_id: conta, safra_id: safra, percentual
  }));
  beforeAll(async () => {
    cat = await id1("select id from erp.financial_categories where organization_id=$1 and kind='analytic' order by code limit 1", [demo.orgId]);
    cc = await id1("select id from erp.cost_centers where organization_id=$1 and kind='analytic' order by code limit 1", [demo.orgId]);
    conta = await id1("select id from erp.chart_accounts where organization_id=$1 and kind='analytic' order by code limit 1", [demo.orgId]);
    safra = await id1("select id from erp.harvests where organization_id=$1 order by start_date limit 1", [demo.orgId]);
  });

  it("entra na compra aberta com rateio_tipo='por_valor'; na compra sem rateio, por produto ou confirmada, a recusa da guarda", async () => {
    const porValor = await compra({ extra: { rateio_tipo: "por_valor" } });
    await linha(porValor, 0, "60");
    await linha(porValor, 1, "40");
    expect((await db.query("select posicao, percentual, conta_contabil_id, safra_id from erp.documentos_compra_rateio where documento_id=$1 order by posicao", [porValor])).rows)
      .toEqual([{ posicao: 0, percentual: "60.0000", conta_contabil_id: conta, safra_id: safra }, { posicao: 1, percentual: "40.0000", conta_contabil_id: conta, safra_id: safra }]);
    const SO = "VALIDATION_ERROR: O rateio por valor é da compra aberta com rateio por valor.";
    expect((await erroDe(linha(await compra(), 0, "100"))).message, "sem rateio").toBe(SO);
    expect((await erroDe(linha(await compra({ extra: { rateio_tipo: "por_produto" } }), 0, "100"))).message, "por produto").toBe(SO);
    expect((await erroDe(linha(acervo.pedido, 0, "100"))).message, "pedido").toBe(SO);
    const confirmada = await compra({ extra: { rateio_tipo: "por_valor" } });
    await situacao(confirmada, "confirmado");
    expect((await erroDe(linha(confirmada, 0, "100"))).message, "confirmada").toBe(SO);
    expect((await erroDe(linha(porValor, 2, "0"))).constraint, "percentual zero").toBe("chk_documentos_compra_rateio_percentual");
  });

  it("imutável: UPDATE e DELETE negados ao erp_app pelo privilégio, e ao dono pelo gatilho", async () => {
    const doc = await compra({ extra: { rateio_tipo: "por_valor" } });
    const id = await linha(doc, 0, "100");
    for (const sql of ["update erp.documentos_compra_rateio set percentual=50 where id=$1", "delete from erp.documentos_compra_rateio where id=$1"]) {
      const e = await erroDe(naApp((tx) => tx.query(sql, [id])));
      expect([sql, e.code, e.message]).toEqual([sql, "42501", "permission denied for table documentos_compra_rateio"]);
    }
    const MUDA = "CONFLICT: O rateio da compra não muda; cancele a compra e lance outra.";
    expect((await erroDe(db.query("update erp.documentos_compra_rateio set percentual=50 where id=$1", [id]))).message).toBe(MUDA);
    expect((await erroDe(db.query("delete from erp.documentos_compra_rateio where id=$1", [id]))).message).toBe(MUDA);
    expect((await erroDe(db.query("truncate erp.documentos_compra_rateio"))).message).toBe(MUDA);
    expect((await db.query<{ p: string }>("select percentual p from erp.documentos_compra_rateio where id=$1", [id])).rows[0]!.p).toBe("100.0000");
  });
});

describe("B9 — RLS por empresa pelo papel da aplicação sem bypass (módulo compras)", () => {
  it("quem só tem a empresa A não vê o XML, a importação nem o rateio da empresa B, e não grava XML na B; o vínculo (da organização) ele vê", async () => {
    const ch = chave();
    const xmlB = await guardarXml(ch, B);
    const impB = await importacao({ xml: xmlB, ch, empresa: B });
    const docB = await compra({ empresa: B, extra: { rateio_tipo: "por_valor" } });
    const cat = await id1("select id from erp.financial_categories where organization_id=$1 and kind='analytic' order by code limit 1", [demo.orgId]);
    const cc = await id1("select id from erp.cost_centers where organization_id=$1 and kind='analytic' order by code limit 1", [demo.orgId]);
    await naApp((tx) => inserir(tx, "documentos_compra_rateio", { organization_id: demo.orgId, documento_id: docB, posicao: 0, categoria_financeira_id: cat, centro_custo_id: cc, percentual: "100" }));
    const vinculo = await naApp((tx) => inserir(tx, "produto_fornecedor_vinculos", {
      organization_id: demo.orgId, fornecedor_id: fornecedor, codigo_fornecedor: `F7-${seq}`, unidade_fornecedor: "CX", produto_id: produto, fator: "12", criado_por: demo.adminUserId }));
    const contar = (u: string) => naApp(async (tx) => ({
      xml: (await tx.query("select 1 from erp.notas_fiscais_xml where id=$1", [xmlB])).rowCount,
      imp: (await tx.query("select 1 from erp.importacoes_nfe_compra where id=$1", [impB])).rowCount,
      rateio: (await tx.query("select 1 from erp.documentos_compra_rateio where documento_id=$1", [docB])).rowCount,
      vinculo: (await tx.query("select 1 from erp.produto_fornecedor_vinculos where id=$1", [vinculo])).rowCount
    }), ctx(u));
    expect(await contar(usuarioEscopoB), "premissa: quem tem a B vê tudo").toEqual({ xml: 1, imp: 1, rateio: 1, vinculo: 1 });
    expect(await contar(usuarioEscopoA)).toEqual({ xml: 0, imp: 0, rateio: 0, vinculo: 1 });
    const e = await erroDe(guardarXml(chave(), B, ctx(usuarioEscopoA)));
    expect([e.code, e.message]).toEqual(["42501", 'new row violates row-level security policy for table "notas_fiscais_xml"']);
    const decidir = await naApp((tx) => tx.query("update erp.importacoes_nfe_compra set situacao='descartada', decidido_por=$2, decidido_em=now() where id=$1", [impB, usuarioEscopoA]), ctx(usuarioEscopoA));
    expect(decidir.rowCount, "fora do escopo a RLS devolve zero linhas (a API confere o ROW COUNT)").toBe(0);
    expect((await db.query<{ s: string }>("select situacao s from erp.importacoes_nfe_compra where id=$1", [impB])).rows[0]!.s).toBe("pendente");
  });
});

describe("B10/B11 — o XML da DF-e e o vínculo lembrado", () => {
  it("dfe_documents.xml_id: gravado uma vez, do XML da mesma chave (e da mesma empresa, quando a DF-e tem empresa); a chave não troca com o XML ligado", async () => {
    expect((await db.query("select xml_id, empresa_id from erp.dfe_documents where id=$1", [acervo.dfe])).rows[0], "premissa: a DF-e do acervo, sem XML e sem empresa")
      .toEqual({ xml_id: null, empresa_id: null });
    const NAO_E = "VALIDATION_ERROR: O XML guardado não é desta DF-e.";
    const outraChave = await guardarXml(chave());
    const upd = (set: string, p: unknown[]) => naApp((tx) => tx.query(`update erp.dfe_documents set ${set} where id=$1`, [acervo.dfe, ...p]));
    expect((await erroDe(upd("xml_id=$2", [outraChave]))).message).toBe(NAO_E);
    const certo = await guardarXml(acervo.chaveDfe, B);
    await expect(upd("xml_id=$2", [certo]), "DF-e sem empresa aceita o XML da empresa destinatária").resolves.toMatchObject({ rowCount: 1 });
    expect((await erroDe(upd("xml_id=$2", [outraChave]))).message).toBe("CONFLICT: O XML guardado da DF-e não muda.");
    expect((await erroDe(upd("xml_id=null", []))).message).toBe("CONFLICT: O XML guardado da DF-e não muda.");
    expect((await erroDe(upd("access_key=$2", [chave()]))).message, "trocar a chave com o XML ligado").toBe(NAO_E);
    expect((await erroDe(upd("empresa_id=$2", [A]))).message, "pôr a DF-e em outra empresa que não a do XML").toBe(NAO_E);
    await expect(upd("empresa_id=$2", [B]), "a empresa do XML").resolves.toMatchObject({ rowCount: 1 });
    expect((await db.query("select xml_id, empresa_id from erp.dfe_documents where id=$1", [acervo.dfe])).rows[0]).toEqual({ xml_id: certo, empresa_id: B });
  });

  it("o vínculo: um por fornecedor + código + unidade; unidade em maiúsculas; fator positivo; sem DELETE", async () => {
    const v = (o: Record<string, unknown> = {}) => naApp((tx) => inserir(tx, "produto_fornecedor_vinculos", {
      organization_id: demo.orgId, fornecedor_id: fornecedor, codigo_fornecedor: "SINT-001", unidade_fornecedor: "UN", produto_id: produto, fator: "1", criado_por: demo.adminUserId, ...o }));
    const id = await v();
    expect((await erroDe(v())).constraint).toBe("uq_produto_fornecedor_vinculos");
    await expect(v({ unidade_fornecedor: "CX", fator: "12" }), "outra unidade do mesmo código é outro vínculo").resolves.toMatch(/^[0-9a-f-]{36}$/);
    expect((await erroDe(v({ unidade_fornecedor: "kg" }))).constraint).toBe("chk_produto_fornecedor_vinculos_unidade");
    expect((await erroDe(v({ codigo_fornecedor: " X " }))).constraint).toBe("chk_produto_fornecedor_vinculos_codigo");
    expect((await erroDe(v({ codigo_fornecedor: "SINT-002", fator: "0" }))).constraint).toBe("chk_produto_fornecedor_vinculos_fator");
    await expect(naApp((tx) => tx.query("update erp.produto_fornecedor_vinculos set fator=2, atualizado_por=$2, atualizado_em=now() where id=$1", [id, demo.adminUserId])))
      .resolves.toMatchObject({ rowCount: 1 });
    const e = await erroDe(naApp((tx) => tx.query("delete from erp.produto_fornecedor_vinculos where id=$1", [id])));
    expect([e.code, e.message]).toEqual(["42501", "permission denied for table produto_fornecedor_vinculos"]);
  });
});
