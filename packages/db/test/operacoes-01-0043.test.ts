import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CAMPOS_DESTINO_ESTOQUE,
  MOTIVOS_SAIDA_ESTOQUE,
  TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE,
  familiaOperacionalDeDocumentoEstoque
} from "@agro/domain";
import { createPool, withTx, type Db, type Queryable, type Tx, type TenantContext } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A 0043 (OPERACOES-01 F5a, decisão 282), PROVADA CONTRA O BANCO — COMO O RUNNER APLICA.
 *
 * O que ela promete:
 *   · o documento de estoque com as espécies requisicao, consumo e devolucao_consumo; a ORIGEM (consumo →
 *     requisição; devolução → consumo, obrigatória) no cabeçalho e no item, com FKs compostas; o DESTINO (seis
 *     dimensões) no cabeçalho e as quatro que faltavam no razão; o motivo e a justificativa da saída; o saldo
 *     encerrado da requisição; a entrada sem custo; os CHECKs que prendem tudo isso por espécie;
 *   · o gatilho do cabeçalho: família por espécie (a requisição é estoque.requisicao_material), origem da mesma
 *     empresa e local de estoque (uma recusa só), destino herdado, referências do destino da empresa, origem
 *     imutável, encerrar o saldo uma vez e só na requisição confirmada, mensagens "local de estoque";
 *   · o gatilho novo dos itens (soma ligada ≤ saldo, barreira de concorrência pelo item de origem);
 *   · a transição: requisição com consumo vivo e consumo com devolução viva não se cancelam;
 *   · a reserva (0035) com a parte C: núcleo A + B + C1 + C2, porta para quem vê requisição, a guarda exclui o C2
 *     do PRÓPRIO consumo, o atalho confere a organização com requisição pendente, o flag com a mensagem nova — e a
 *     mensagem da guarda inalterada;
 *   · as mensagens de banco que diziam "armazém"; o CHECK de família do layout com as sete de estoque; RLS e
 *     privilégios das duas tabelas inalterados.
 *
 * Antes de aplicar (DB-5): a trava (2026,77) ocupada, o lock_timeout de 2s e CADA pré-condição quebrada numa
 * transação desfeita, cada uma com a SUA mensagem "OPERACOES-01 F5: …" — "já aplicada" antes de todas. Depois: o
 * ledger (DB-6), a reaplicação recusada e as pós-condições (só de OBJETOS), cada uma quebrada numa transação
 * desfeita com a sua mensagem.
 *
 * Duas conexões: `db` (superusuário: monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let wA: string; let wA2: string; let wB: string;
let produto: string;
let fornecedor: string;
let outraOrg: string; let empresaOutraOrg: string; let wOutraOrg: string; let produtoOutraOrg: string;
let usuarioEscopoA: string;

const ALVO = "0043_movimentacao_interna_estoque.sql";
const M = "OPERACOES-01 F5: ";

type Especie = "entrada" | "saida" | "transferencia" | "ajuste" | "requisicao" | "consumo" | "devolucao_consumo";
const FAMILIA: Record<Especie, string> = {
  entrada: "estoque.entrada", saida: "estoque.saida", transferencia: "estoque.transferencia", ajuste: "estoque.ajuste",
  requisicao: "estoque.requisicao_material", consumo: "estoque.consumo", devolucao_consumo: "estoque.devolucao_consumo"
};
const ESPECIES = Object.keys(FAMILIA) as Especie[];
const COLUNA_DESTINO = { centro: "centro_custo_id", equipamento: "equipamento_id", os: "ordem_servico_id", lote: "lote_animais_id", area: "area_id", safra: "safra_id" } as const;
type Dim = keyof typeof COLUNA_DESTINO;
const DIMS = Object.keys(COLUNA_DESTINO) as Dim[];
type Destinos = Record<Dim, string>;

interface Top { top: string; versao: string }
/** TOPs por organização e família (código base). */
const tops = new Map<string, Top>();
const topDe = (familia: string, org: string = demo.orgId): Top => {
  const t = tops.get(`${org}|${familia}`);
  if (!t) throw new Error(`TOP ${familia} não criada para ${org}`);
  return t;
};

let dA: Destinos; let dB: Destinos; let dOutra: Destinos; let dExcluido: Destinos;

let seq = 0;
const id1 = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
const sqlDa0043 = () => listMigrations().find((x) => x.name === ALVO)!.sql;

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
/** Roda `sql` (a 0043, ou um trecho dela) numa transação DESFEITA no fim (depois de `antes`), e devolve o erro — ou falha, se aplicou. */
async function recusaDe(sql: string, antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(sql);
  } catch (e) { return (e as Error).message; } finally { await c.query("rollback").catch(() => {}); c.release(); }
  throw new Error("esperava a recusa, e o SQL aplicou");
}
const recusaDa0043 = (antes?: (c: Tx) => Promise<unknown>) => recusaDe(sqlDa0043(), antes);
interface ErroPg { code?: string; constraint?: string; message: string }
async function erroDe(p: Promise<unknown>): Promise<ErroPg> {
  try { await p; } catch (e) { return e as ErroPg; }
  throw new Error("esperava recusa, e o banco aceitou");
}
const noLedger = async () => (await db.query("select 1 from public.erp_migrations where name=$1", [ALVO])).rowCount === 1;
/** Os dois marcadores de "aplicada": a coluna da origem e a função nova. */
const marcas = async () => (await db.query<{ coluna: number; funcao: string | null }>(
  `select (select count(*)::int from pg_attribute where attrelid = 'erp.documentos_estoque'::regclass and attname = 'origem_documento_id' and not attisdropped) coluna,
          to_regprocedure('erp.documentos_estoque_item_origem_guarda()')::text funcao`)).rows[0]!;
const NADA_APLICADO = { coluna: 0, funcao: null };

/** RLS (políticas, comando a comando, com as expressões) e privilégios do papel da aplicação nas duas tabelas. */
async function retratoDeAcesso() {
  const politicas = (await db.query<{ tablename: string; policyname: string; cmd: string; roles: string; qual: string | null; with_check: string | null }>(
    `select tablename, policyname, cmd, roles::text roles, qual, with_check from pg_policies
      where schemaname = 'erp' and tablename in ('documentos_estoque', 'documentos_estoque_itens') order by tablename, policyname`)).rows;
  const privilegios = (await db.query<{ tabela: string; privilegio: string; tem: boolean }>(
    `select t.tabela, p.privilegio, has_table_privilege('erp_app', t.tabela, p.privilegio) tem
       from unnest(array['erp.documentos_estoque', 'erp.documentos_estoque_itens']) t(tabela)
      cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p(privilegio)
      order by 1, 2`)).rows;
  const rls = (await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    "select relname, relrowsecurity, relforcerowsecurity from pg_class where oid in ('erp.documentos_estoque'::regclass, 'erp.documentos_estoque_itens'::regclass) order by 1")).rows;
  return { politicas, privilegios, rls };
}
let acessoAntes: Awaited<ReturnType<typeof retratoDeAcesso>>;

/** TOP e versão 1 (na MESMA transação: a FK da versão atual é adiada até o commit). */
async function criarTop(org: string, codigoBase: string, reservaEstoque = false): Promise<Top> {
  seq += 1;
  const t = await withTx(db, { orgId: org, userId: null }, async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id",
      [org, `T43${seq}`, codigoBase])).rows[0]!.id;
    const versao = (await tx.query<{ id: string }>(
      "insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, reserva_estoque) values ($1,$2,1,$3,$4) returning id",
      [org, top, `TOP 0043 ${codigoBase} ${seq}`, reservaEstoque])).rows[0]!.id;
    return { top, versao };
  });
  if (!reservaEstoque) tops.set(`${org}|${codigoBase}`, t);
  return t;
}
async function armazem(org: string, empresa: string): Promise<string> {
  seq += 1;
  return id1("insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,$3,$4) returning id",
    [org, empresa, `L${seq}`, `[TEST] Local de estoque 0043 ${seq}`]);
}
async function produtoNovo(org: string, controla = true): Promise<string> {
  seq += 1;
  return id1(`insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, kind_id, financial_category_id, control_stock)
              select $1, $2, $3, measurement_id, group_id, category_id, kind_id, financial_category_id, $4 from erp.products where id=$5 returning id`,
    [org, `T43-P${seq}`, `[TEST] Produto 0043 ${seq}`, controla, produto]);
}
/** As seis referências de destino: centro e safra da organização; equipamento, OS, lote de animais e área da empresa. */
async function destinos(org: string, empresa: string, excluido = false): Promise<Destinos> {
  seq += 1;
  const s = `T43-${seq}`; const del = excluido ? new Date() : null;
  return {
    centro: await id1("insert into erp.cost_centers (organization_id, code, name, kind, deleted_at) values ($1,$2,$3,'analytic',$4) returning id", [org, s, `[TEST] Centro ${s}`, del]),
    safra: await id1("insert into erp.harvests (organization_id, description, start_date, end_date, deleted_at) values ($1,$2,'2026-07-01','2027-06-30',$3) returning id", [org, `[TEST] Safra ${s}`, del]),
    equipamento: await id1("insert into erp.equipments (organization_id, empresa_id, code, description, deleted_at) values ($1,$2,$3,$4,$5) returning id", [org, empresa, s, `[TEST] Equipamento ${s}`, del]),
    os: await id1("insert into erp.service_orders (organization_id, empresa_id, code, order_date, deleted_at) values ($1,$2,$3,'2026-10-01',$4) returning id", [org, empresa, s, del]),
    lote: await id1("insert into erp.batches (organization_id, empresa_id, code, batch_date, description, deleted_at) values ($1,$2,$3,'2026-10-01',$4,$5) returning id", [org, empresa, s, `[TEST] Lote ${s}`, del]),
    area: await id1("insert into erp.areas (organization_id, empresa_id, code, name, deleted_at) values ($1,$2,$3,$4,$5) returning id", [org, empresa, s, `[TEST] Área ${s}`, del])
  };
}

interface Cab {
  org?: string; empresa?: string; especie?: Especie; top?: Top; armazem?: string; localDestino?: string | null; origem?: string | null;
  destino?: Partial<Record<Dim, string | null>>; motivo?: string | null; justificativa?: string | null;
  situacao?: string; confirmado?: boolean; cancelado?: boolean; encerrado?: { motivo: string } | null;
}
/** INSERT do cabeçalho (via `q`: superusuário ou tx da aplicação). Na transferência o destino padrão é o 2º local de A. */
async function inserirCab(q: Queryable, o: Cab = {}): Promise<string> {
  seq += 1;
  const especie = o.especie ?? "entrada";
  const org = o.org ?? demo.orgId;
  const top = o.top ?? topDe(FAMILIA[especie], org);
  const v: Record<string, unknown> = {
    organization_id: org, empresa_id: o.empresa ?? A, especie, codigo: `T43-${seq}`,
    situacao: o.situacao ?? (o.cancelado ? "cancelado" : o.confirmado ? "confirmado" : "aberto"),
    tipo_operacao_id: top.top, tipo_operacao_versao_id: top.versao, armazem_id: o.armazem ?? wA,
    armazem_destino_id: o.localDestino !== undefined ? o.localDestino : (especie === "transferencia" ? wA2 : null),
    data_documento: "2026-10-01", origem_documento_id: o.origem ?? null, motivo_saida: o.motivo ?? null, justificativa: o.justificativa ?? null,
    ...(o.confirmado ? { confirmado_em: new Date(), confirmado_por: demo.adminUserId } : {}),
    ...(o.cancelado ? { cancelado_em: new Date(), cancelado_por: demo.adminUserId, motivo_cancelamento: "teste" } : {}),
    ...(o.encerrado ? { saldo_encerrado_em: new Date(), saldo_encerrado_por: demo.adminUserId, saldo_encerrado_motivo: o.encerrado.motivo } : {})
  };
  for (const d of DIMS) v[COLUNA_DESTINO[d]] = o.destino?.[d] ?? null;
  const cols = Object.keys(v);
  return (await q.query<{ id: string }>(
    `insert into erp.documentos_estoque (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(v))).rows[0]!.id;
}
const doc = (o: Cab = {}) => inserirCab(db, o);

interface Item { org?: string; especie?: string; produto?: string; quantidade?: string | null; contada?: string | null; custo?: string | null;
  lote?: string | null; validade?: string | null; origem?: string | null }
/** INSERT do item. A espécie, quando não vem, é a do cabeçalho (lida pelo superusuário: só para cabeçalho já gravado). */
async function inserirItem(q: Queryable, documento: string, o: Item = {}): Promise<string> {
  seq += 1;
  const especie = o.especie ?? (await db.query<{ e: string }>("select especie e from erp.documentos_estoque where id=$1", [documento])).rows[0]!.e;
  const r = await q.query<{ id: string }>(
    `insert into erp.documentos_estoque_itens (organization_id, documento_id, especie, posicao, produto_id, quantidade, quantidade_contada, custo_unitario,
       lote, validade, origem_item_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [o.org ?? demo.orgId, documento, especie, seq, o.produto ?? produto,
     o.quantidade !== undefined ? o.quantidade : (especie === "ajuste" ? null : "2"),
     o.contada !== undefined ? o.contada : (especie === "ajuste" ? "5" : null),
     o.custo !== undefined ? o.custo : null, o.lote ?? null, o.validade ?? null, o.origem ?? null]);
  return r.rows[0]!.id;
}
const item = (documento: string, o: Item = {}) => inserirItem(db, documento, o);

/** Muda a situação como a API muda: com os carimbos que o CHECK exige junto. */
const confirmar = (id: string) => db.query("update erp.documentos_estoque set situacao='confirmado', confirmado_em=now(), confirmado_por=$2 where id=$1", [id, demo.adminUserId]);
const cancelar = (id: string) => db.query("update erp.documentos_estoque set situacao='cancelado', cancelado_em=now(), cancelado_por=$2, motivo_cancelamento='teste' where id=$1", [id, demo.adminUserId]);
const encerrar = (id: string, motivo = "Atendido o necessário") =>
  db.query("update erp.documentos_estoque set saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo=$3 where id=$1", [id, demo.adminUserId, motivo]);
const situacaoDe = async (id: string) => (await db.query<{ s: string }>("select situacao s from erp.documentos_estoque where id=$1", [id])).rows[0]!.s;

interface Linha { produto?: string; quantidade: string; origem?: string | null }
/** Requisição com os itens dados (confirmada, por padrão: a pendente, que reserva). */
async function requisicao(itens: Linha[], o: Cab & { confirmada?: boolean } = {}): Promise<{ id: string; itens: string[] }> {
  const id = await doc({ ...o, especie: "requisicao" });
  const ids: string[] = [];
  for (const l of itens) ids.push(await item(id, { especie: "requisicao", produto: l.produto, quantidade: l.quantidade, org: o.org }));
  if (o.confirmada !== false) await confirmar(id);
  return { id, itens: ids };
}
/** Consumo (aberto) ligado à requisição `origem` (ou direto, sem ela) com as linhas dadas. */
async function consumo(origem: string | null, itens: Linha[], o: Cab = {}): Promise<{ id: string; itens: string[] }> {
  const id = await doc({ ...o, especie: "consumo", origem });
  const ids: string[] = [];
  for (const l of itens) ids.push(await item(id, { especie: "consumo", produto: l.produto, quantidade: l.quantidade, origem: l.origem ?? null, org: o.org }));
  return { id, itens: ids };
}

/**
 * Cenário com os gatilhos DO USUÁRIO desligados, numa transação desfeita no fim: prova o CHECK e a FK sozinhos.
 * `disable trigger user` não desliga os gatilhos internos de integridade referencial (a FK continua valendo).
 */
async function semGatilhos<T>(fn: (q: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("alter table erp.documentos_estoque disable trigger user");
    await c.query("alter table erp.documentos_estoque_itens disable trigger user");
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}

/** Movimento no razão, pelo superusuário (os gatilhos do razão rodam do mesmo jeito: aplicação do saldo e guarda da reserva). */
interface Mov { tipo?: string; direcao?: 1 | -1; origemTipo?: string; origemId?: string; org?: string; empresa?: string; extra?: Record<string, unknown> }
async function movimento(w: string, p: string, qtd: string, m: Mov = {}): Promise<void> {
  const v: Record<string, unknown> = {
    organization_id: m.org ?? demo.orgId, empresa_id: m.empresa ?? A, warehouse_id: w, product_id: p, movement_type: m.tipo ?? "requisition",
    direction: m.direcao ?? -1, quantity: qtd, unit_cost: 1, source_type: m.origemTipo ?? "teste_0043", source_id: m.origemId ?? randomUUID(),
    movement_date: "2026-10-01", ...m.extra
  };
  const cols = Object.keys(v);
  await db.query(`insert into erp.stock_movements (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(v));
}
const entrada = (w: string, p: string, qtd: string, m: Mov = {}) => movimento(w, p, qtd, { tipo: "opening_balance", direcao: 1, ...m });
const fisico = async (w: string, p: string) => (await db.query<{ q: string }>(
  "select coalesce(sum(quantity),0)::text q from erp.stock_balances where warehouse_id=$1 and product_id=$2", [w, p])).rows[0]!.q;
/** O núcleo da reserva (o que a guarda lê), pelo superusuário. */
const nucleo = async (w: string, p: string, excluir: string | null = null, org: string = demo.orgId) => (await db.query<{ r: string }>(
  "select reservado::text r from erp.reserva_estoque_nucleo($1, array[$2]::uuid[], array[$3]::uuid[], $4)", [org, w, p, excluir])).rows[0]!.r;
const INSUFICIENTE = (d: string, q: string, r: string) => `INSUFFICIENT_STOCK: disponível ${d} < solicitado ${q} (${r} reservado para pedidos)`;

const ctxEstoque = (userId?: string): TenantContext => ({ orgId: demo.orgId, userId: userId ?? demo.adminUserId, modulo: "estoque" });

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0043")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });

  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  wA = await armazem(demo.orgId, A); wA2 = await armazem(demo.orgId, A); wB = await armazem(demo.orgId, B);
  produto = await id1("select id from erp.products where organization_id=$1 and controle_lote='nenhum' and control_stock and deleted_at is null order by code limit 1", [demo.orgId]);
  fornecedor = await id1("insert into erp.people (organization_id, code, name, is_provider) values ($1,'T43-F','[TEST] Fornecedor 0043',true) returning id", [demo.orgId]);
  for (const f of [...Object.values(FAMILIA), "estoque.requisicao", "compras.compra"]) await criarTop(demo.orgId, f);

  outraOrg = await id1("insert into erp.organizations (name, slug) values ('[TEST] Outra 0043','outra-0043') returning id");
  empresaOutraOrg = await id1("insert into erp.empresas (organization_id, code, name) values ($1, 94, '[TEST] Empresa outra org 0043') returning id", [outraOrg]);
  wOutraOrg = await armazem(outraOrg, empresaOutraOrg);
  produtoOutraOrg = await produtoNovo(outraOrg);
  for (const f of [FAMILIA.requisicao, FAMILIA.consumo]) await criarTop(outraOrg, f);

  dA = await destinos(demo.orgId, A);
  dB = await destinos(demo.orgId, B);
  dOutra = await destinos(outraOrg, empresaOutraOrg);
  dExcluido = await destinos(demo.orgId, A, true);

  // Membro com escopo SELECIONADAS = [A] no módulo estoque (e nada nos outros módulos: fail-closed).
  usuarioEscopoA = await id1("insert into erp.users (email, name, password_hash) values ('t43-a@demo.local','T43 A','x') returning id");
  const membro = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [demo.orgId, usuarioEscopoA]);
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'estoque','selecionadas')", [demo.orgId, membro]);
  await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'estoque','selecionadas',$3)", [demo.orgId, membro, A]);
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

/** As nove funções substituídas: assinatura e a migration que a criou (a da mensagem da pré-condição 2.3). */
const SUBSTITUIDAS: [string, string][] = [
  ["erp.apply_stock_movement()", "0003"],
  ["erp.products_controle_lote()", "0029"],
  ["erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)", "0035"],
  ["erp.reserva_estoque(uuid[],uuid[],uuid)", "0035"],
  ["erp.stock_movement_reserva_guarda()", "0035"],
  ["erp.products_controle_estoque_reserva()", "0035"],
  ["erp.documentos_compra_itens_documento_aberto()", "0036"],
  ["erp.documentos_estoque_conferir()", "0040"],
  ["erp.documentos_estoque_transicao()", "0040"]
];
const nomeDa = (assinatura: string) => assinatura.slice(0, assinatura.indexOf("("));
/** As quatro funções cuja mensagem dizia "armazém". */
const DE_MENSAGEM = ["erp.apply_stock_movement()", "erp.products_controle_lote()", "erp.documentos_compra_itens_documento_aberto()", "erp.documentos_estoque_conferir()"];

describe("DB-5/DB-6 — a 0043 sobre o banco até a 0042, como o runner aplica", () => {
  it("DB-5.1 PREMISSA: sob a 0042 nada da 0043 existe; o ledger tem 42 (a 0042 é da F8); os hashes LITERAIS do arquivo são os do banco; a entrada sem custo e o layout de estoque são recusados; as mensagens dizem 'armazém'", async () => {
    expect(await noLedger()).toBe(false);
    expect((await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0])
      .toEqual({ n: 42, ultima: "0042_central_financeira.sql" });
    expect(await marcas()).toEqual(NADA_APLICADO);
    expect((await db.query("select 1 from pg_attribute where attrelid='erp.stock_movements'::regclass and attname in ('equipamento_id','ordem_servico_id','lote_animais_id','area_id')")).rowCount).toBe(0);
    // Os nove hashes escritos na pré-condição 2.3 são, um a um, o md5 do corpo vigente neste banco (migrado até a
    // 0042, que não toca nenhuma das nove).
    const literais = [...sqlDa0043().matchAll(/'(erp\.\w+\([^)]*\))'::regprocedure\) is distinct from '([0-9a-f]{32})'/g)].map((m) => [m[1]!, m[2]!]);
    expect(literais.map(([f]) => f)).toEqual(SUBSTITUIDAS.map(([f]) => f));
    for (const [f, hash] of literais) {
      expect([f, (await db.query<{ h: string }>("select md5(prosrc) h from pg_proc where oid = $1::regprocedure", [f])).rows[0]!.h]).toEqual([f, hash]);
    }
    // A entrada sem custo é o CHECK da 0040 (que a 0043 tira); o layout de estoque, o da 0038 (que a 0043 alarga).
    // Numa transação desfeita, só com as colunas da 0040 (as da 0043 ainda não existem).
    const c = await db.connect();
    let e: ErroPg;
    try {
      await c.query("begin");
      const t = topDe(FAMILIA.entrada);
      const d = (await c.query<{ id: string }>(
        `insert into erp.documentos_estoque (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, armazem_id, data_documento)
         values ($1,$2,'entrada','T43-PREMISSA',$3,$4,$5,'2026-10-01') returning id`, [demo.orgId, A, t.top, t.versao, wA])).rows[0]!.id;
      e = await erroDe(c.query("insert into erp.documentos_estoque_itens (organization_id, documento_id, especie, posicao, produto_id, quantidade) values ($1,$2,'entrada',1,$3,'2')",
        [demo.orgId, d, produto]));
    } finally { await c.query("rollback"); c.release(); }
    expect([e.code, e.constraint]).toEqual(["23514", "chk_documentos_estoque_itens_custo_entrada"]);
    const l = await erroDe(db.query("insert into erp.layouts_documento (organization_id, code, nome, familia, estrutura) values ($1,'T43-L0','Layout 0043 premissa','estoque.consumo','{}')", [demo.orgId]));
    expect([l.code, l.constraint]).toEqual(["23514", "chk_layouts_documento_familia"]);
    for (const f of DE_MENSAGEM) {
      expect([f, (await db.query<{ a: boolean }>("select prosrc ~ 'armazé' a from pg_proc where oid = $1::regprocedure", [f])).rows[0]!.a]).toEqual([f, true]);
    }
    acessoAntes = await retratoDeAcesso();
    expect(acessoAntes.politicas.map((p) => p.policyname)).toEqual(["tenant_e_empresa", "api_child"]);
  });

  it("DB-5.2 trava (2026,77) em uso por outra sessão: a 0043 recusa antes de tudo, sem efeito", async () => {
    const outra = await db.connect();
    try {
      await outra.query("select pg_advisory_lock(2026, 77)");
      await expect(aplicar()).rejects.toThrow(`${M}outra transacao ja detem a trava desta migration (2026,77). Nada foi aplicado.`);
    } finally { await outra.query("select pg_advisory_unlock(2026, 77)"); outra.release(); }
    expect(await noLedger()).toBe(false);
    expect(await marcas()).toEqual(NADA_APLICADO);
  });

  it("DB-5.3 lock_timeout 2s: uma escrita aberta em erp.stock_movements faz a 0043 desistir em ~2s, sem efeito", async () => {
    const escritor = await db.connect();
    try {
      await escritor.query("begin");
      // RowExclusive no razão: o ADD COLUMN precisa de AccessExclusive, e as duas não convivem.
      await escritor.query("update erp.stock_movements set note = note where id is null");
      const t0 = Date.now();
      await expect(aplicar()).rejects.toThrow(/lock timeout/);
      const ms = Date.now() - t0;
      expect(ms, "desistiu pelo lock_timeout, não por outro motivo imediato").toBeGreaterThanOrEqual(1900);
      expect(ms, "e não ficou pendurada").toBeLessThan(10_000);
    } finally { await escritor.query("rollback"); escritor.release(); }
    expect(await noLedger()).toBe(false);
    expect(await marcas()).toEqual(NADA_APLICADO);
  });

  it("DB-5.4 reversas: cada pré-condição quebrada recusa a 0043 com a SUA mensagem, sem efeito", async () => {
    // 2.0 "Já aplicada": a coluna da origem ou a função nova.
    const JA = `${M}erp.documentos_estoque.origem_documento_id ou erp.documentos_estoque_item_origem_guarda() ja existe; a 0043 ja foi aplicada ou ha schema divergente.`;
    expect(await recusaDa0043((c) => c.query("alter table erp.documentos_estoque add column origem_documento_id uuid"))).toBe(JA);
    expect(await recusaDa0043((c) => c.query("create function erp.documentos_estoque_item_origem_guarda() returns trigger language plpgsql as 'begin return new; end'"))).toBe(JA);
    // "Já aplicada" vem ANTES de todas: com o papel sem bypass, uma função substituída e um módulo quebrados JUNTO,
    // o motivo dito é o verdadeiro.
    expect(await recusaDa0043(async (c) => {
      await c.query("alter function erp.apply_stock_movement() rename to t43_renomeada");
      await c.query("set local session_replication_role = replica");
      await c.query("delete from erp.modulos_escopo_empresa where chave='estoque'");
      await c.query("set local session_replication_role = origin");
      await c.query("alter table erp.documentos_estoque add column origem_documento_id uuid");
      await c.query("set local role erp_app");
    })).toBe(JA);
    // 2.1 Quem aplica não atravessa RLS (o papel da aplicação); sem o papel da aplicação, a porta não teria destinatário.
    expect(await recusaDa0043((c) => c.query("set local role erp_app")))
      .toBe(`${M}o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; os gatilhos nao veriam a origem, o destino nem a reserva da organizacao.`);
    expect(await recusaDa0043((c) => c.query("alter role erp_app rename to erp_app_t43")))
      .toBe(`${M}papel erp_app ausente (0007); a porta da reserva e os privilegios nao teriam destinatario.`);
    // 2.2 As tabelas e as funções, uma de cada vez.
    const TABELA = `${M}erp.documentos_estoque/erp.documentos_estoque_itens (0040) ou erp.aprovacoes_estoque (0041) ausente; a 0040 e a 0041 nao estao aplicadas.`;
    for (const t of ["documentos_estoque", "documentos_estoque_itens", "aprovacoes_estoque"]) {
      expect([t, await recusaDa0043((c) => c.query(`alter table erp.${t} rename to ${t}_t43`))]).toEqual([t, TABELA]);
    }
    const FUNCAO = `${M}funcao substituida ou chamada por esta migration ausente (documentos_estoque_conferir/transicao/itens_documento_aberto/aprovacao_guarda, reserva_estoque_nucleo, reserva_estoque, stock_movement_reserva_guarda, products_controle_estoque_reserva, apply_stock_movement, products_controle_lote, documentos_compra_itens_documento_aberto); a cadeia de migrations esta fora de ordem.`;
    const funcoes = [...SUBSTITUIDAS.map(([f]) => f), "erp.documentos_estoque_itens_documento_aberto()", "erp.documentos_estoque_aprovacao_guarda()"];
    expect(funcoes).toHaveLength(11);
    for (const f of funcoes) {
      expect([f, await recusaDa0043((c) => c.query(`alter function ${f} rename to t43_renomeada`))]).toEqual([f, FUNCAO]);
    }
    // 2.3 A definição vigente: cada uma das nove trocada por uma cópia com UM espaço a mais no corpo.
    for (const [f, origem] of SUBSTITUIDAS) {
      expect([f, await recusaDa0043(async (c) => {
        const def = (await c.query<{ d: string }>("select pg_get_functiondef($1::regprocedure) d", [f])).rows[0]!.d;
        const fim = def.lastIndexOf("$function$");
        expect(fim, "o corpo termina no delimitador").toBeGreaterThan(0);
        await c.query(`${def.slice(0, fim)} ${def.slice(fim)}`);
        expect((await c.query<{ n: number }>("select count(*)::int n from pg_proc where oid = $1::regprocedure", [f])).rows[0]!.n, "a cópia substituiu a função").toBe(1);
      })]).toEqual([f, `${M}a definicao vigente de ${nomeDa(f)} nao e a da ${origem}; schema divergente.`]);
    }
    // 2.4 Os CHECKs refeitos: com outra lista, ou ausentes.
    const ESPECIE = `${M}chk_documentos_estoque_especie diferente do da 0040 (especie in entrada, saida, transferencia, ajuste); schema divergente.`;
    expect(await recusaDa0043((c) => c.query("alter table erp.documentos_estoque drop constraint chk_documentos_estoque_especie"))).toBe(ESPECIE);
    expect(await recusaDa0043((c) => c.query(
      "alter table erp.documentos_estoque drop constraint chk_documentos_estoque_especie, add constraint chk_documentos_estoque_especie check (especie in ('entrada','saida','transferencia','ajuste','requisicao'))"))).toBe(ESPECIE);
    const ESPECIE_ITEM = `${M}chk_documentos_estoque_itens_especie diferente do da 0040 (especie in entrada, saida, transferencia, ajuste); schema divergente.`;
    expect(await recusaDa0043((c) => c.query(
      "alter table erp.documentos_estoque_itens drop constraint chk_documentos_estoque_itens_especie, add constraint chk_documentos_estoque_itens_especie check (especie in ('entrada','saida','transferencia'))"))).toBe(ESPECIE_ITEM);
    expect(await recusaDa0043((c) => c.query("alter table erp.documentos_estoque_itens drop constraint chk_documentos_estoque_itens_custo_entrada")))
      .toBe(`${M}chk_documentos_estoque_itens_custo_entrada (0040) ausente; schema divergente.`);
    const LAYOUT = `${M}chk_layouts_documento_familia diferente do da 0038 (familia in vendas.orcamento, vendas.pedido, vendas.venda, compras.pedido, compras.compra); schema divergente.`;
    expect(await recusaDa0043((c) => c.query("alter table erp.layouts_documento drop constraint chk_layouts_documento_familia"))).toBe(LAYOUT);
    expect(await recusaDa0043((c) => c.query(
      "alter table erp.layouts_documento drop constraint chk_layouts_documento_familia, add constraint chk_layouts_documento_familia check (familia in ('vendas.orcamento','vendas.pedido','vendas.venda','compras.pedido','compras.compra','compras.orcamento'))"))).toBe(LAYOUT);
    // 2.5 Os gatilhos EXATOS: um a menos, um a mais, o mesmo nome em outra função; e um a mais nos itens.
    const GAT = `${M}gatilhos de erp.documentos_estoque diferentes dos quatro esperados (aprovacao da 0041; audit, conferir e transicao da 0040): `;
    const APROV = "\"trg_documentos_estoque_aprovacao -> erp.documentos_estoque_aprovacao_guarda\"";
    const AUDIT = "\"trg_documentos_estoque_audit -> erp.audit_row\"";
    const CONF = "\"trg_documentos_estoque_conferir -> erp.documentos_estoque_conferir\"";
    const TRANS = "\"trg_documentos_estoque_transicao -> erp.documentos_estoque_transicao\"";
    expect(await recusaDa0043((c) => c.query("drop trigger trg_documentos_estoque_audit on erp.documentos_estoque"))).toBe(`${GAT}{${APROV},${CONF},${TRANS}}`);
    expect(await recusaDa0043((c) => c.query("create trigger trg_documentos_estoque_zz before insert on erp.documentos_estoque for each row execute function erp.documentos_estoque_conferir()")))
      .toBe(`${GAT}{${APROV},${AUDIT},${CONF},${TRANS},"trg_documentos_estoque_zz -> erp.documentos_estoque_conferir"}`);
    expect(await recusaDa0043(async (c) => {
      await c.query("drop trigger trg_documentos_estoque_conferir on erp.documentos_estoque");
      await c.query("create trigger trg_documentos_estoque_conferir before insert or update on erp.documentos_estoque for each row execute function erp.documentos_estoque_transicao()");
    })).toBe(`${GAT}{${APROV},${AUDIT},"trg_documentos_estoque_conferir -> erp.documentos_estoque_transicao",${TRANS}}`);
    expect(await recusaDa0043((c) => c.query("create trigger trg_documentos_estoque_itens_zz before insert on erp.documentos_estoque_itens for each row execute function erp.documentos_estoque_itens_documento_aberto()")))
      .toBe(`${M}gatilhos de erp.documentos_estoque_itens diferentes do esperado (documento_aberto da 0040): {"trg_documentos_estoque_itens_documento_aberto -> erp.documentos_estoque_itens_documento_aberto","trg_documentos_estoque_itens_zz -> erp.documentos_estoque_itens_documento_aberto"}`);
    // 2.6 As chaves alvo: as que existem (ausente, ou na ordem trocada) e as que esta migration cria (já existindo).
    const ALVO_FK = `${M}chave alvo das FKs compostas ausente (uq_cost_centers_tenant da 0024, uq_warehouses_tenant da 0036, uq_documentos_estoque_tenant da 0040, em (id, organization_id)).`;
    for (const [t, chave] of [["cost_centers", "uq_cost_centers_tenant"], ["warehouses", "uq_warehouses_tenant"], ["documentos_estoque", "uq_documentos_estoque_tenant"]] as [string, string][]) {
      expect([chave, await recusaDa0043((c) => c.query(`alter table erp.${t} rename constraint ${chave} to ${chave}_t43`))]).toEqual([chave, ALVO_FK]);
    }
    expect(await recusaDa0043(async (c) => {
      await c.query("alter table erp.cost_centers drop constraint uq_cost_centers_tenant cascade");
      await c.query("alter table erp.cost_centers add constraint uq_cost_centers_tenant unique (organization_id, id)");
    })).toBe(ALVO_FK);
    const JA_CHAVE = `${M}chave (id, organization_id) que esta migration cria ja existe (uq_harvests_tenant, uq_equipments_tenant, uq_service_orders_tenant, uq_batches_tenant, uq_areas_tenant, uq_documentos_estoque_itens_tenant); schema divergente.`;
    for (const t of ["harvests", "equipments", "service_orders", "batches", "areas", "documentos_estoque_itens"]) {
      expect([t, await recusaDa0043((c) => c.query(`alter table erp.${t} add constraint uq_${t}_tenant unique (id, organization_id)`))]).toEqual([t, JA_CHAVE]);
    }
    expect(await recusaDa0043((c) => c.query("create index uq_harvests_tenant on erp.harvests (id)"))).toBe(JA_CHAVE);
    // 2.7 Cada coluna lida (12), e cada uma das que esta migration cria já existindo (fora a da origem, que é o 2.0).
    const COLUNA = `${M}coluna lida pelos gatilhos ou pelo razao ausente (cost_centers.deleted_at, harvests.deleted_at, equipments/service_orders/batches/areas.empresa_id/deleted_at, stock_movements.cost_center_id/harvest_id); a cadeia de migrations esta fora de ordem.`;
    const lidas: [string, string][] = [["cost_centers", "deleted_at"], ["harvests", "deleted_at"],
      ...["equipments", "service_orders", "batches", "areas"].flatMap((t): [string, string][] => [[t, "empresa_id"], [t, "deleted_at"]]),
      ["stock_movements", "cost_center_id"], ["stock_movements", "harvest_id"]];
    expect(lidas).toHaveLength(12);
    for (const [t, col] of lidas) {
      expect([t, col, await recusaDa0043((c) => c.query(`alter table erp.${t} rename column ${col} to ${col}_t43`))]).toEqual([t, col, COLUNA]);
    }
    const NOVA = `${M}coluna que esta migration cria ja existe (stock_movements.equipamento_id/ordem_servico_id/lote_animais_id/area_id, documentos_estoque.<destino, motivo, justificativa, saldo encerrado>, documentos_estoque_itens.origem_item_id); schema divergente.`;
    const novas: [string, string][] = [
      ...["equipamento_id", "ordem_servico_id", "lote_animais_id", "area_id"].map((c): [string, string] => ["stock_movements", c]),
      ...["centro_custo_id", "equipamento_id", "ordem_servico_id", "lote_animais_id", "area_id", "safra_id", "motivo_saida", "justificativa",
        "saldo_encerrado_em", "saldo_encerrado_por", "saldo_encerrado_motivo"].map((c): [string, string] => ["documentos_estoque", c]),
      ["documentos_estoque_itens", "origem_item_id"]];
    expect(novas).toHaveLength(16);
    for (const [t, col] of novas) {
      expect([t, col, await recusaDa0043((c) => c.query(`alter table erp.${t} add column ${col} text`))]).toEqual([t, col, NOVA]);
    }
    // 2.8 O módulo de escopo estoque (as FKs de quem o cita são desligadas só nesta transação desfeita).
    expect(await recusaDa0043(async (c) => {
      await c.query("set local session_replication_role = replica");
      await c.query("delete from erp.modulos_escopo_empresa where chave='estoque'");
      await c.query("set local session_replication_role = origin");
    })).toBe(`${M}modulo de escopo empresarial estoque ausente (0011).`);
    // Nada ficou: o ledger, as marcas, as funções e as chaves são os de antes.
    expect(await noLedger()).toBe(false);
    expect(await marcas()).toEqual(NADA_APLICADO);
    expect((await db.query("select 1 from pg_roles where rolname='erp_app'")).rowCount).toBe(1);
    expect((await db.query("select 1 from pg_constraint where conname like 'uq\\_%\\_tenant' and conrelid in ('erp.harvests'::regclass, 'erp.equipments'::regclass, 'erp.service_orders'::regclass, 'erp.batches'::regclass, 'erp.areas'::regclass, 'erp.documentos_estoque_itens'::regclass)")).rowCount).toBe(0);
    for (const [f] of SUBSTITUIDAS) {
      const h = (await db.query<{ h: string }>("select md5(prosrc) h from pg_proc where oid = $1::regprocedure", [f])).rows[0]!.h;
      expect([f, sqlDa0043().includes(`'${f}'::regprocedure) is distinct from '${h}'`)]).toEqual([f, true]);
    }
  });

  it("DB-6 aplica: ledger com 43 (a 0043 por último, depois da 0042 da F8), objetos criados e trava liberada", async () => {
    await aplicar();
    const ledger = (await db.query<{ n: number; ultima: string }>("select count(*)::int n, max(name) ultima from public.erp_migrations")).rows[0]!;
    expect(ledger).toEqual({ n: 43, ultima: ALVO });
    const noDisco = listMigrations().map((m) => m.name);
    expect(noDisco.length, "48 migrations no repositório (0001..0047 e a 0049; a 0044 é da F6a, a 0045, da F9, a 0046, da F10, a 0047, da F7, e a 0049, da MAPA-01)").toBe(48);
    expect(noDisco[42]).toBe(ALVO);
    expect(await marcas()).toEqual({ coluna: 1, funcao: "erp.documentos_estoque_item_origem_guarda()" });
    // A trava é de transação: depois do commit, outra sessão a obtém.
    const outra = await db.connect();
    try { expect((await outra.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(2026, 77) ok")).rows[0]!.ok).toBe(true); } finally { outra.release(); }
  });

  it("DB-5.5 reaplicar é recusado pela pré-condição 'já aplicada', sem efeito", async () => {
    expect(await recusaDa0043()).toBe(`${M}erp.documentos_estoque.origem_documento_id ou erp.documentos_estoque_item_origem_guarda() ja existe; a 0043 ja foi aplicada ou ha schema divergente.`);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n).toBe(1);
  });

  /**
   * As PÓS-CONDIÇÕES só leem OBJETOS (catálogo), nunca contagem de tabela viva. E cada uma morde: o bloco delas (o
   * trecho "10)" do arquivo, como está) roda de novo sobre o banco aplicado, com UM objeto quebrado numa transação
   * desfeita, e recusa com a SUA mensagem.
   */
  it("DB-5.6 pós-condições: só de objetos (nenhum FROM/JOIN em tabela do erp), e cada uma, quebrada, recusa com a sua mensagem", async () => {
    const sql = sqlDa0043();
    const inicio = sql.indexOf("-- ---------- 10) pós-condições");
    expect(inicio, "o trecho 10) existe").toBeGreaterThan(0);
    const pos = sql.slice(inicio);
    expect(pos).toMatch(/^-- [^\n]*\ndo \$\$/);
    expect(pos.match(/\b(from|join)\s+erp\.\w+/gi), "nenhuma leitura de tabela do erp nas pós-condições").toBeNull();
    // Contraprova: sobre o banco aplicado, o bloco passa.
    const c = await db.connect();
    try { await c.query("begin"); await expect(c.query(pos)).resolves.toBeTruthy(); } finally { await c.query("rollback"); c.release(); }

    const COLUNAS = `${M}colunas novas ausentes, de outro tipo ou obrigatorias (esperadas 17: 12 no documento, 1 no item, 4 no razao, todas anulaveis).`;
    const FKS = `${M}FKs compostas novas (7 do documento, 1 do item, 4 do razao) ausentes, em cascata ou fora da forma (coluna, organization_id) -> (id, organization_id) (esperadas 12).`;
    const GAT_NOVO = `${M}trg_documentos_estoque_itens_origem_guarda ausente, desligado, de outro tipo (BEFORE INSERT OR UPDATE OF origem_item_id, quantidade, produto_id) ou na funcao errada.`;
    const DEFINER = `${M}funcoes do documento de estoque e da reserva sem SECURITY DEFINER ou sem search_path "erp, pg_temp" (esperadas 7).`;
    const ATRIB = `${M}atributos das funcoes de mensagem mudaram (apply_stock_movement sem SECURITY DEFINER nem search_path; products_controle_lote e documentos_compra_itens_documento_aberto SECURITY DEFINER com o search_path de antes).`;
    const EXEC = `${M}EXECUTE alem do dono nas funcoes de gatilho ou no nucleo da reserva, ou a porta da reserva sem o erp_app (ou com PUBLIC).`;
    const ARMAZEM = `${M}mensagem de funcao ainda diz armazem, ou funcao de mensagem sem "local de estoque".`;
    const casos: [string, string | ((t: Tx) => Promise<unknown>), string][] = [
      ["coluna nova removida", "alter table erp.stock_movements drop column area_id", COLUNAS],
      ["coluna nova de outro tipo", "alter table erp.documentos_estoque alter column justificativa type varchar(2000)", COLUNAS],
      ["coluna nova obrigatória", "alter table erp.documentos_estoque_itens alter column origem_item_id set not null", COLUNAS],
      ["CHECK do cabeçalho ausente", "alter table erp.documentos_estoque drop constraint chk_documentos_estoque_apropriacao", `${M}CHECKs de erp.documentos_estoque incompletos (esperados 12).`],
      ["CHECK do item ausente", "alter table erp.documentos_estoque_itens drop constraint chk_documentos_estoque_itens_requisicao",
        `${M}CHECKs de erp.documentos_estoque_itens incompletos ou com o custo obrigatorio da entrada (esperados 11, sem chk_documentos_estoque_itens_custo_entrada).`],
      ["custo obrigatório da entrada de volta", "alter table erp.documentos_estoque_itens add constraint chk_documentos_estoque_itens_custo_entrada check (especie <> 'entrada' or custo_unitario is not null) not valid",
        `${M}CHECKs de erp.documentos_estoque_itens incompletos ou com o custo obrigatorio da entrada (esperados 11, sem chk_documentos_estoque_itens_custo_entrada).`],
      ["espécies do cabeçalho sem a devolução", "alter table erp.documentos_estoque drop constraint chk_documentos_estoque_especie, add constraint chk_documentos_estoque_especie check (especie in ('entrada','saida','transferencia','ajuste','requisicao','consumo')) not valid",
        `${M}chk_documentos_estoque_especie sem as sete especies.`],
      ["espécies do item sem a requisição", "alter table erp.documentos_estoque_itens drop constraint chk_documentos_estoque_itens_especie, add constraint chk_documentos_estoque_itens_especie check (especie in ('entrada','saida','transferencia','ajuste','consumo','devolucao_consumo')) not valid",
        `${M}chk_documentos_estoque_itens_especie sem as sete especies.`],
      ["layout sem as famílias de estoque", "alter table erp.layouts_documento drop constraint chk_layouts_documento_familia, add constraint chk_layouts_documento_familia check (familia in ('vendas.orcamento','vendas.pedido','vendas.venda','compras.pedido','compras.compra')) not valid",
        `${M}chk_layouts_documento_familia sem as doze familias (cinco de venda e compra, sete de estoque).`],
      ["FK nova ausente", "alter table erp.documentos_estoque drop constraint fk_documentos_estoque_safra", FKS],
      ["FK nova em cascata", "alter table erp.stock_movements drop constraint fk_stock_movements_area, add constraint fk_stock_movements_area foreign key (area_id, organization_id) references erp.areas (id, organization_id) on delete cascade", FKS],
      ["FK da origem do item para outro alvo", "alter table erp.documentos_estoque_itens drop constraint fk_documentos_estoque_itens_origem, add constraint fk_documentos_estoque_itens_origem foreign key (origem_item_id, organization_id) references erp.documentos_estoque (id, organization_id) not valid", FKS],
      ["FK de quem encerrou ausente", "alter table erp.documentos_estoque drop constraint fk_documentos_estoque_saldo_encerrado_por", `${M}fk_documentos_estoque_saldo_encerrado_por (-> erp.users) ausente.`],
      ["chave (id, organization_id) com outro nome", "alter table erp.batches rename constraint uq_batches_tenant to uq_batches_t43", `${M}chaves (id, organization_id) novas ausentes ou fora da ordem (esperadas 6).`],
      ["índice da reserva ausente", "drop index erp.ix_documentos_estoque_reserva", `${M}indice da origem ou da reserva do documento de estoque ausente.`],
      ["gatilho novo desligado", "alter table erp.documentos_estoque_itens disable trigger trg_documentos_estoque_itens_origem_guarda", GAT_NOVO],
      ["gatilho novo só de quantidade", "drop trigger trg_documentos_estoque_itens_origem_guarda on erp.documentos_estoque_itens; create trigger trg_documentos_estoque_itens_origem_guarda before insert or update of quantidade on erp.documentos_estoque_itens for each row execute function erp.documentos_estoque_item_origem_guarda()", GAT_NOVO],
      ["um gatilho a mais no cabeçalho", "create trigger trg_documentos_estoque_zz before insert on erp.documentos_estoque for each row execute function erp.documentos_estoque_conferir()",
        `${M}gatilhos de erp.documentos_estoque diferentes de aprovacao, audit, conferir e transicao (ligados, nas funcoes certas).`],
      ["auditoria do cabeçalho desligada", "alter table erp.documentos_estoque disable trigger trg_documentos_estoque_audit",
        `${M}gatilhos de erp.documentos_estoque diferentes de aprovacao, audit, conferir e transicao (ligados, nas funcoes certas).`],
      ["um gatilho a mais nos itens", "create trigger trg_documentos_estoque_itens_zz before insert on erp.documentos_estoque_itens for each row execute function erp.documentos_estoque_itens_documento_aberto()",
        `${M}gatilhos de erp.documentos_estoque_itens diferentes de documento_aberto e origem_guarda (ligados, nas funcoes certas).`],
      ["transição sem definer", "alter function erp.documentos_estoque_transicao() security invoker", DEFINER],
      ["núcleo com outro search_path", "alter function erp.reserva_estoque_nucleo(uuid, uuid[], uuid[], uuid) set search_path = erp, pg_catalog", DEFINER],
      ["guarda da reserva estável", "alter function erp.stock_movement_reserva_guarda() stable", `${M}volatilidade das funcoes da reserva errada (nucleo e porta STABLE; guarda e flag VOLATILE).`],
      ["apply_stock_movement com search_path", "alter function erp.apply_stock_movement() set search_path = erp, pg_temp", ATRIB],
      ["controle de lote sem definer", "alter function erp.products_controle_lote() security invoker", ATRIB],
      ["guarda nova com EXECUTE do erp_app", "grant execute on function erp.documentos_estoque_item_origem_guarda() to erp_app", EXEC],
      ["porta sem o erp_app", "revoke execute on function erp.reserva_estoque(uuid[], uuid[], uuid) from erp_app", EXEC],
      ["porta com PUBLIC", "grant execute on function erp.reserva_estoque(uuid[], uuid[], uuid) to public", EXEC],
      ["mensagem com 'armazéns' de volta", async (t) => {
        const def = (await t.query<{ d: string }>("select pg_get_functiondef('erp.products_controle_lote()'::regprocedure) d")).rows[0]!.d;
        expect(def).toContain("locais de estoque");
        await t.query(def.replace("locais de estoque", "armazéns"));
      }, ARMAZEM],
      ["comentário com 'Armazém' no corpo da guarda nova", async (t) => {
        const def = (await t.query<{ d: string }>("select pg_get_functiondef('erp.documentos_estoque_item_origem_guarda()'::regprocedure) d")).rows[0]!.d;
        await t.query(def.replace("begin", "begin\n  -- Armazém"));
      }, ARMAZEM],
      ["política a mais nos itens", "create policy t43_extra on erp.documentos_estoque_itens for select using (true)",
        `${M}politicas do documento de estoque mudaram (esperadas tenant_e_empresa no cabecalho e api_child nos itens).`],
      ["DELETE para o erp_app", "grant delete on erp.documentos_estoque to erp_app",
        `${M}privilegios do erp_app no documento de estoque mudaram (esperado select/insert/update, sem delete nem truncate).`]
    ];
    for (const [nome, sabotagem, mensagem] of casos) {
      expect([nome, await recusaDe(pos, (t) => (typeof sabotagem === "string" ? t.query(sabotagem) : sabotagem(t)))]).toEqual([nome, mensagem]);
    }
    // Nada ficou: o gatilho novo, a porta e os privilégios são os da migration.
    expect(await marcas()).toEqual({ coluna: 1, funcao: "erp.documentos_estoque_item_origem_guarda()" });
    expect((await db.query<{ u: boolean }>("select has_table_privilege('erp_app', 'erp.documentos_estoque', 'delete') u")).rows[0]!.u).toBe(false);
  });
});

describe("schema: colunas, CHECKs, FKs, chaves, índices, gatilhos, RLS e privilégios", () => {
  const colunas = async (tabela: string) => (await db.query<{ c: string }>(
    `select column_name || ':' || data_type || ':' || is_nullable c from information_schema.columns
      where table_schema='erp' and table_name=$1 order by ordinal_position`, [tabela])).rows.map((x) => x.c);

  it("S1 colunas novas no FIM de cada tabela, anuláveis e comentadas; as seis do destino são as do domínio (CAMPOS_DESTINO_ESTOQUE)", async () => {
    const doc0040 = ["id:uuid:NO", "organization_id:uuid:NO", "empresa_id:uuid:NO", "especie:text:NO", "codigo:text:NO", "situacao:text:NO",
      "tipo_operacao_id:uuid:NO", "tipo_operacao_versao_id:uuid:NO", "armazem_id:uuid:NO", "armazem_destino_id:uuid:YES", "data_documento:date:NO",
      "observacao:text:YES", "criado_por:uuid:YES", "confirmado_em:timestamp with time zone:YES", "confirmado_por:uuid:YES",
      "cancelado_em:timestamp with time zone:YES", "cancelado_por:uuid:YES", "motivo_cancelamento:text:YES", "created_at:timestamp with time zone:NO",
      "atualizado_em:timestamp with time zone:NO"];
    const novasDoc = ["origem_documento_id:uuid:YES", "centro_custo_id:uuid:YES", "equipamento_id:uuid:YES", "ordem_servico_id:uuid:YES",
      "lote_animais_id:uuid:YES", "area_id:uuid:YES", "safra_id:uuid:YES", "motivo_saida:text:YES", "justificativa:text:YES",
      "saldo_encerrado_em:timestamp with time zone:YES", "saldo_encerrado_por:uuid:YES", "saldo_encerrado_motivo:text:YES"];
    expect(await colunas("documentos_estoque")).toEqual([...doc0040, ...novasDoc]);
    expect((await colunas("documentos_estoque_itens")).at(-1)).toBe("origem_item_id:uuid:YES");
    expect((await colunas("stock_movements")).slice(-4)).toEqual(["equipamento_id:uuid:YES", "ordem_servico_id:uuid:YES", "lote_animais_id:uuid:YES", "area_id:uuid:YES"]);
    // As seis colunas do destino do cabeçalho são exatamente as do dono da lista (o domínio), na ordem dele.
    expect(CAMPOS_DESTINO_ESTOQUE.map((c) => c.coluna)).toEqual(["centro_custo_id", "equipamento_id", "ordem_servico_id", "lote_animais_id", "area_id", "safra_id"]);
    expect(novasDoc.slice(1, 7).map((c) => c.split(":")[0])).toEqual(CAMPOS_DESTINO_ESTOQUE.map((c) => c.coluna));
    const sem = (await db.query<{ c: string }>(
      `select c.relname || '.' || a.attname c from pg_class c join pg_attribute a on a.attrelid = c.oid
        where (c.oid, a.attname) in (${[...novasDoc.map((x) => `('erp.documentos_estoque'::regclass, '${x.split(":")[0]}')`),
          "('erp.documentos_estoque_itens'::regclass, 'origem_item_id')",
          ...["equipamento_id", "ordem_servico_id", "lote_animais_id", "area_id"].map((x) => `('erp.stock_movements'::regclass, '${x}')`)].join(", ")})
          and col_description(c.oid, a.attnum) is null`)).rows;
    expect(sem).toEqual([]);
    // E nenhum comentário destas colunas diz "armazém".
    const comArmazem = (await db.query<{ c: string }>(
      `select a.attname c from pg_attribute a where a.attrelid in ('erp.documentos_estoque'::regclass, 'erp.documentos_estoque_itens'::regclass)
          and a.attnum > 0 and col_description(a.attrelid, a.attnum) ~* 'armazé'`)).rows;
    expect(comArmazem).toEqual([]);
  });

  it("S2 CHECKs: espécies (as sete do domínio, na ordem), motivos (os 13 do domínio, na ordem), origem, apropriação, saldo encerrado; o custo da entrada saiu", async () => {
    const def = async (tabela: string, nome: string) => (await db.query<{ d: string }>(
      "select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and conname = $2", [tabela, nome])).rows[0]?.d ?? null;
    const literais = (d: string | null) => [...(d ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1]!);
    expect(literais(await def("erp.documentos_estoque", "chk_documentos_estoque_especie"))).toEqual([...TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE]);
    expect(literais(await def("erp.documentos_estoque_itens", "chk_documentos_estoque_itens_especie"))).toEqual([...TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE]);
    expect(literais(await def("erp.documentos_estoque", "chk_documentos_estoque_motivo_saida")).slice(0, 13)).toEqual([...MOTIVOS_SAIDA_ESTOQUE]);
    // A lista do 0003 (a baixa antiga) é a MESMA, na mesma ordem.
    const baixa = (await db.query<{ d: string }>(
      `select pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'erp.stock_writeoffs'::regclass and c.contype = 'c'
          and pg_get_constraintdef(c.oid) like '%reason%'`)).rows.map((x) => literais(x.d));
    expect(baixa).toEqual([[...MOTIVOS_SAIDA_ESTOQUE]]);
    const apropriacao = await def("erp.documentos_estoque", "chk_documentos_estoque_apropriacao");
    for (const c of CAMPOS_DESTINO_ESTOQUE) expect([c.coluna, apropriacao?.includes(`${c.coluna} IS NULL`)]).toEqual([c.coluna, true]);
    expect(await def("erp.documentos_estoque_itens", "chk_documentos_estoque_itens_custo_entrada")).toBeNull();
    const nomes = async (tabela: string, prefixo: string) => (await db.query<{ n: string }>(
      "select conname n from pg_constraint where conrelid = $1::regclass and contype = 'c' and conname like $2 order by conname", [tabela, `${prefixo}%`])).rows.map((x) => x.n);
    expect(await nomes("erp.documentos_estoque", "chk_documentos_estoque_")).toEqual([
      "chk_documentos_estoque_apropriacao", "chk_documentos_estoque_cancelamento", "chk_documentos_estoque_cancelamento_campos",
      "chk_documentos_estoque_confirmacao", "chk_documentos_estoque_confirmacao_situacao", "chk_documentos_estoque_destino",
      "chk_documentos_estoque_destino_distinto", "chk_documentos_estoque_especie", "chk_documentos_estoque_motivo_saida", "chk_documentos_estoque_origem",
      "chk_documentos_estoque_saldo_encerrado", "chk_documentos_estoque_situacao"]);
    expect(await nomes("erp.documentos_estoque_itens", "chk_documentos_estoque_itens_")).toEqual([
      "chk_documentos_estoque_itens_ajuste", "chk_documentos_estoque_itens_custo_unitario", "chk_documentos_estoque_itens_diferenca",
      "chk_documentos_estoque_itens_especie", "chk_documentos_estoque_itens_lote", "chk_documentos_estoque_itens_origem",
      "chk_documentos_estoque_itens_posicao", "chk_documentos_estoque_itens_quantidade", "chk_documentos_estoque_itens_quantidade_contada",
      "chk_documentos_estoque_itens_quantidades", "chk_documentos_estoque_itens_requisicao"]);
  });

  it("S3 FKs novas: (coluna, organization_id) → (id, organization_id), sem cascata; as seis chaves novas; os três índices", async () => {
    const r = (await db.query<{ conname: string; cols: string; alvo: string; cascata: boolean }>(
      `select c.conname,
              (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) cols,
              c.confrelid::regclass::text || '(' ||
                (select string_agg(a.attname, ',' order by k.ord) from unnest(c.confkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) || ')' alvo,
              (c.confdeltype <> 'a' or c.confupdtype <> 'a') cascata
         from pg_constraint c
        where c.contype = 'f' and c.conname in ('fk_documentos_estoque_origem', 'fk_documentos_estoque_centro_custo', 'fk_documentos_estoque_equipamento',
              'fk_documentos_estoque_ordem_servico', 'fk_documentos_estoque_lote_animais', 'fk_documentos_estoque_area', 'fk_documentos_estoque_safra',
              'fk_documentos_estoque_saldo_encerrado_por', 'fk_documentos_estoque_itens_origem', 'fk_stock_movements_equipamento',
              'fk_stock_movements_ordem_servico', 'fk_stock_movements_lote_animais', 'fk_stock_movements_area')
        order by c.conname collate "C"`)).rows;
    expect(r).toEqual([
      { conname: "fk_documentos_estoque_area", cols: "area_id,organization_id", alvo: "erp.areas(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_centro_custo", cols: "centro_custo_id,organization_id", alvo: "erp.cost_centers(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_equipamento", cols: "equipamento_id,organization_id", alvo: "erp.equipments(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_itens_origem", cols: "origem_item_id,organization_id", alvo: "erp.documentos_estoque_itens(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_lote_animais", cols: "lote_animais_id,organization_id", alvo: "erp.batches(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_ordem_servico", cols: "ordem_servico_id,organization_id", alvo: "erp.service_orders(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_origem", cols: "origem_documento_id,organization_id", alvo: "erp.documentos_estoque(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_safra", cols: "safra_id,organization_id", alvo: "erp.harvests(id,organization_id)", cascata: false },
      { conname: "fk_documentos_estoque_saldo_encerrado_por", cols: "saldo_encerrado_por", alvo: "erp.users(id)", cascata: false },
      { conname: "fk_stock_movements_area", cols: "area_id,organization_id", alvo: "erp.areas(id,organization_id)", cascata: false },
      { conname: "fk_stock_movements_equipamento", cols: "equipamento_id,organization_id", alvo: "erp.equipments(id,organization_id)", cascata: false },
      { conname: "fk_stock_movements_lote_animais", cols: "lote_animais_id,organization_id", alvo: "erp.batches(id,organization_id)", cascata: false },
      { conname: "fk_stock_movements_ordem_servico", cols: "ordem_servico_id,organization_id", alvo: "erp.service_orders(id,organization_id)", cascata: false }
    ]);
    const chaves = (await db.query<{ t: string; def: string }>(
      `select conrelid::regclass::text t, pg_get_constraintdef(oid) def from pg_constraint
        where contype = 'u' and conname in ('uq_harvests_tenant', 'uq_equipments_tenant', 'uq_service_orders_tenant', 'uq_batches_tenant', 'uq_areas_tenant',
              'uq_documentos_estoque_itens_tenant') order by 1`)).rows;
    expect(chaves).toEqual(["erp.areas", "erp.batches", "erp.documentos_estoque_itens", "erp.equipments", "erp.harvests", "erp.service_orders"]
      .map((t) => ({ t, def: "UNIQUE (id, organization_id)" })));
    const idx = (await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'erp' and indexname in ('ix_documentos_estoque_origem', 'ix_documentos_estoque_reserva', 'ix_documentos_estoque_itens_origem')
        order by indexname`)).rows.map((x) => x.indexdef.replace(/ USING btree/, ""));
    expect(idx).toEqual([
      "CREATE INDEX ix_documentos_estoque_itens_origem ON erp.documentos_estoque_itens (origem_item_id) WHERE (origem_item_id IS NOT NULL)",
      "CREATE INDEX ix_documentos_estoque_origem ON erp.documentos_estoque (origem_documento_id) WHERE (origem_documento_id IS NOT NULL)",
      "CREATE INDEX ix_documentos_estoque_reserva ON erp.documentos_estoque (organization_id, armazem_id) WHERE (((especie = 'requisicao'::text) AND (situacao = 'confirmado'::text) AND (saldo_encerrado_em IS NULL)) OR ((especie = 'consumo'::text) AND (situacao = 'aberto'::text) AND (origem_documento_id IS NOT NULL)))"
    ]);
  });

  it("S4 gatilhos: os quatro do cabeçalho e os dois dos itens (o novo DEPOIS do documento aberto, por nome); funções com os atributos da migration", async () => {
    const g = (await db.query<{ tabela: string; nome: string; funcao: string; tipo: number }>(
      `select t.tgrelid::regclass::text tabela, t.tgname nome, p.proname funcao, t.tgtype::int tipo from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid in ('erp.documentos_estoque'::regclass, 'erp.documentos_estoque_itens'::regclass) and not t.tgisinternal and t.tgenabled = 'O'
        order by 1, t.tgname collate "C"`)).rows;
    expect(g).toEqual([
      { tabela: "erp.documentos_estoque", nome: "trg_documentos_estoque_aprovacao", funcao: "documentos_estoque_aprovacao_guarda", tipo: 1 | 2 | 16 },
      { tabela: "erp.documentos_estoque", nome: "trg_documentos_estoque_audit", funcao: "audit_row", tipo: 1 | 4 | 8 | 16 },
      { tabela: "erp.documentos_estoque", nome: "trg_documentos_estoque_conferir", funcao: "documentos_estoque_conferir", tipo: 1 | 2 | 4 | 16 },
      { tabela: "erp.documentos_estoque", nome: "trg_documentos_estoque_transicao", funcao: "documentos_estoque_transicao", tipo: 1 | 2 | 16 },
      { tabela: "erp.documentos_estoque_itens", nome: "trg_documentos_estoque_itens_documento_aberto", funcao: "documentos_estoque_itens_documento_aberto", tipo: 1 | 2 | 4 | 8 | 16 },
      { tabela: "erp.documentos_estoque_itens", nome: "trg_documentos_estoque_itens_origem_guarda", funcao: "documentos_estoque_item_origem_guarda", tipo: 1 | 2 | 4 | 16 }
    ]);
    const f = (await db.query<{ f: string; definer: boolean; config: string | null; vol: string }>(
      `select p.oid::regprocedure::text f, p.prosecdef definer, array_to_string(p.proconfig, ';') config, p.provolatile vol from pg_proc p
        where p.oid = any($1::regprocedure[]) order by 1`, [[...SUBSTITUIDAS.map(([x]) => x), "erp.documentos_estoque_item_origem_guarda()"]])).rows;
    const esperado: Record<string, [boolean, string | null, string]> = {
      "erp.apply_stock_movement()": [false, null, "v"],
      "erp.documentos_compra_itens_documento_aberto()": [true, "search_path=erp, pg_temp", "v"],
      "erp.documentos_estoque_conferir()": [true, "search_path=erp, pg_temp", "v"],
      "erp.documentos_estoque_item_origem_guarda()": [true, "search_path=erp, pg_temp", "v"],
      "erp.documentos_estoque_transicao()": [true, "search_path=erp, pg_temp", "v"],
      "erp.products_controle_estoque_reserva()": [true, "search_path=erp, pg_temp", "v"],
      "erp.products_controle_lote()": [true, "search_path=erp, pg_catalog", "v"],
      "erp.reserva_estoque(uuid[],uuid[],uuid)": [true, "search_path=erp, pg_temp", "s"],
      "erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)": [true, "search_path=erp, pg_temp", "s"],
      "erp.stock_movement_reserva_guarda()": [true, "search_path=erp, pg_temp", "v"]
    };
    expect(Object.fromEntries(f.map((x) => [x.f, [x.definer, x.config, x.vol]]))).toEqual(esperado);
  });

  it("S5 RLS e privilégios das duas tabelas iguais aos de antes da 0043; EXECUTE: a guarda nova só do dono, as substituídas com a ACL de antes", async () => {
    expect(await retratoDeAcesso()).toEqual(acessoAntes);
    const acl = (await db.query<{ f: string; quem: string[] }>(
      `select p.oid::regprocedure::text f, array_agg(case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end order by x.grantee) quem
         from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
        where p.oid = any($1::regprocedure[]) and x.privilege_type = 'EXECUTE' and x.grantee <> p.proowner
        group by 1 order by 1`, [[...SUBSTITUIDAS.map(([x]) => x), "erp.documentos_estoque_item_origem_guarda()"]])).rows;
    // As que a 0003, a 0029 e a 0035 deixaram executáveis continuam como estavam (o CREATE OR REPLACE preserva a ACL).
    expect(acl).toEqual([
      { f: "erp.apply_stock_movement()", quem: ["PUBLIC", "erp_app"] },
      { f: "erp.products_controle_lote()", quem: ["erp_app"] },
      { f: "erp.reserva_estoque(uuid[],uuid[],uuid)", quem: ["erp_app"] }
    ]);
    await expect(withTx(app, ctxEstoque(), (tx) => tx.query("select erp.documentos_estoque_item_origem_guarda()")))
      .rejects.toThrow(/permission denied for function documentos_estoque_item_origem_guarda/);
  });

  it("S6 RLS da espécie nova: requisição da empresa B fica fora do membro com escopo [A]; o administrador a vê (o item herda pela junção)", async () => {
    const reqB = await requisicao([{ quantidade: "1" }], { empresa: B, armazem: wB, confirmada: false });
    const ver = (u: string) => withTx(app, ctxEstoque(u), async (tx) => ({
      cab: (await tx.query("select 1 from erp.documentos_estoque where id=$1", [reqB.id])).rowCount,
      itens: (await tx.query("select 1 from erp.documentos_estoque_itens where documento_id=$1", [reqB.id])).rowCount
    }));
    expect(await ver(demo.adminUserId), "PREMISSA: o documento existe e é visível para quem tem escopo total").toEqual({ cab: 1, itens: 1 });
    expect(await ver(usuarioEscopoA)).toEqual({ cab: 0, itens: 0 });
  });
});

describe("CHECKs, sozinhos (gatilhos do usuário desligados numa transação desfeita)", () => {
  it("C1 espécie: as sete aceitas no cabeçalho e no item; outra recusada nos dois", async () => {
    await semGatilhos(async (q) => {
      for (const especie of ESPECIES) {
        const origem = especie === "devolucao_consumo" ? await inserirCab(q, { especie: "consumo" }) : null;
        const d = await inserirCab(q, { especie, origem });
        const it = await inserirItem(q, d, { especie, origem: especie === "devolucao_consumo" ? await inserirItem(q, origem!, { especie: "consumo" }) : null });
        expect([especie, typeof it]).toEqual([especie, "string"]);
      }
    });
    const cab = await semGatilhos((q) => erroDe(q.query(
      `insert into erp.documentos_estoque (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, armazem_id, data_documento)
       values ($1,$2,'baixa','T43-X',$3,$4,$5,'2026-10-01')`, [demo.orgId, A, topDe(FAMILIA.saida).top, topDe(FAMILIA.saida).versao, wA])));
    expect([cab.code, cab.constraint]).toEqual(["23514", "chk_documentos_estoque_especie"]);
    const it = await semGatilhos(async (q) => {
      const d = await inserirCab(q, { especie: "saida" });
      return erroDe(inserirItem(q, d, { especie: "baixa" }));
    });
    expect([it.code, it.constraint]).toEqual(["23514", "chk_documentos_estoque_itens_especie"]);
  });

  it("C2 origem: só no consumo e na devolução, e obrigatória na devolução (cabeçalho e item)", async () => {
    await semGatilhos(async (q) => {
      const k = await inserirCab(q, { especie: "consumo" });
      const ki = await inserirItem(q, k, { especie: "consumo" });
      // PREMISSA: consumo com e sem origem; devolução com origem.
      await inserirCab(q, { especie: "consumo", origem: k });
      const d = await inserirCab(q, { especie: "devolucao_consumo", origem: k });
      await inserirItem(q, d, { especie: "devolucao_consumo", origem: ki });
      for (const especie of ["entrada", "saida", "transferencia", "ajuste", "requisicao"] as Especie[]) {
        await q.query("savepoint s");
        const e = await erroDe(inserirCab(q, { especie, origem: k }));
        await q.query("rollback to savepoint s");
        expect([especie, e.code, e.constraint]).toEqual([especie, "23514", "chk_documentos_estoque_origem"]);
        const outro = await inserirCab(q, { especie });
        await q.query("savepoint s");
        const ei = await erroDe(inserirItem(q, outro, { especie, origem: ki }));
        await q.query("rollback to savepoint s");
        expect([especie, ei.code, ei.constraint]).toEqual([especie, "23514", "chk_documentos_estoque_itens_origem"]);
      }
      await q.query("savepoint s");
      const semOrigem = await erroDe(inserirCab(q, { especie: "devolucao_consumo" }));
      await q.query("rollback to savepoint s");
      expect([semOrigem.code, semOrigem.constraint]).toEqual(["23514", "chk_documentos_estoque_origem"]);
      const itemSemOrigem = await erroDe(inserirItem(q, d, { especie: "devolucao_consumo" }));
      expect([itemSemOrigem.code, itemSemOrigem.constraint]).toEqual(["23514", "chk_documentos_estoque_itens_origem"]);
    });
  });

  it("C3 apropriação: o destino só na requisição, no consumo, na saída e na devolução de consumo — cada dimensão", async () => {
    await semGatilhos(async (q) => {
      const k = await inserirCab(q, { especie: "consumo" });
      for (const especie of ["requisicao", "consumo", "saida", "devolucao_consumo"] as Especie[]) {
        const d = await inserirCab(q, { especie, origem: especie === "devolucao_consumo" ? k : null, destino: dA });
        expect([especie, typeof d]).toEqual([especie, "string"]);
      }
      for (const especie of ["entrada", "transferencia", "ajuste"] as Especie[]) {
        for (const dim of DIMS) {
          await q.query("savepoint s");
          const e = await erroDe(inserirCab(q, { especie, destino: { [dim]: dA[dim] } }));
          await q.query("rollback to savepoint s");
          expect([especie, dim, e.code, e.constraint]).toEqual([especie, dim, "23514", "chk_documentos_estoque_apropriacao"]);
        }
      }
    });
  });

  it("C4 motivo e justificativa: só na saída, dos 13, em par, justificativa não vazia", async () => {
    await semGatilhos(async (q) => {
      for (const motivo of MOTIVOS_SAIDA_ESTOQUE) await inserirCab(q, { especie: "saida", motivo, justificativa: `Justificativa ${motivo}` });
      await inserirCab(q, { especie: "saida" });   // o par é opcional: o web anterior lança a saída sem ele
      const casos: [string, Cab][] = [
        ["motivo fora dos 13", { especie: "saida", motivo: "roubo", justificativa: "x" }],
        ["motivo sem justificativa", { especie: "saida", motivo: "loss" }],
        ["justificativa sem motivo", { especie: "saida", justificativa: "Perda" }],
        ["justificativa só de espaços", { especie: "saida", motivo: "loss", justificativa: "   " }],
        ["motivo na entrada", { especie: "entrada", motivo: "loss", justificativa: "x" }],
        ["motivo no consumo", { especie: "consumo", motivo: "consumption", justificativa: "x" }]
      ];
      for (const [nome, cab] of casos) {
        await q.query("savepoint s");
        const e = await erroDe(inserirCab(q, cab));
        await q.query("rollback to savepoint s");
        expect([nome, e.code, e.constraint]).toEqual([nome, "23514", "chk_documentos_estoque_motivo_saida"]);
      }
    });
  });

  it("C5 saldo encerrado: os três juntos, motivo não vazio, só na requisição confirmada ou cancelada", async () => {
    await semGatilhos(async (q) => {
      await inserirCab(q, { especie: "requisicao", confirmado: true, encerrado: { motivo: "Encerrado" } });
      await inserirCab(q, { especie: "requisicao", confirmado: true, cancelado: true, encerrado: { motivo: "Encerrado" } });
      const casos: [string, Cab, string?][] = [
        ["requisição aberta", { especie: "requisicao", encerrado: { motivo: "Encerrado" } }],
        ["saída confirmada", { especie: "saida", confirmado: true, encerrado: { motivo: "Encerrado" } }],
        ["motivo vazio", { especie: "requisicao", confirmado: true, encerrado: { motivo: " " } }]
      ];
      for (const [nome, cab] of casos) {
        await q.query("savepoint s");
        const e = await erroDe(inserirCab(q, cab));
        await q.query("rollback to savepoint s");
        expect([nome, e.code, e.constraint]).toEqual([nome, "23514", "chk_documentos_estoque_saldo_encerrado"]);
      }
      const r = await inserirCab(q, { especie: "requisicao", confirmado: true });
      const parcial = await erroDe(q.query("update erp.documentos_estoque set saldo_encerrado_em=now() where id=$1", [r]));
      expect([parcial.code, parcial.constraint]).toEqual(["23514", "chk_documentos_estoque_saldo_encerrado"]);
    });
  });

  it("C6 item da requisição sem lote, validade e custo; a ENTRADA sem custo agora passa (na 0040 era 23514 — DB-5.1)", async () => {
    await semGatilhos(async (q) => {
      const r = await inserirCab(q, { especie: "requisicao" });
      await inserirItem(q, r, { especie: "requisicao" });
      for (const [nome, o] of [["lote", { lote: "L1" }], ["validade", { validade: "2027-01-01" }], ["custo", { custo: "1" }]] as [string, Item][]) {
        await q.query("savepoint s");
        const e = await erroDe(inserirItem(q, r, { especie: "requisicao", ...o }));
        await q.query("rollback to savepoint s");
        expect([nome, e.code, e.constraint]).toEqual([nome, "23514", "chk_documentos_estoque_itens_requisicao"]);
      }
      const ent = await inserirCab(q, { especie: "entrada" });
      const itemSemCusto = await inserirItem(q, ent, { especie: "entrada", custo: null });
      expect((await q.query("select custo_unitario from erp.documentos_estoque_itens where id=$1", [itemSemCusto])).rows).toEqual([{ custo_unitario: null }]);
    });
    // E com os gatilhos LIGADOS, pelo caminho normal, também.
    const e = await doc({ especie: "entrada" });
    await expect(item(e, { especie: "entrada", custo: null })).resolves.toBeTruthy();
  });
});

describe("gatilho do cabeçalho: família, origem, destino, encerramento e mensagens", () => {
  it("H1 família por espécie (= a do domínio): a requisição é estoque.requisicao_material, e a TOP estoque.requisicao antiga é recusada; as quatro de hoje com a mensagem da 0040", async () => {
    // Paridade com o domínio: o banco aceita exatamente a família que o domínio dá para cada espécie.
    for (const e of ESPECIES) expect([e, familiaOperacionalDeDocumentoEstoque(e)]).toEqual([e, FAMILIA[e]]);
    expect(ESPECIES).toEqual([...TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE]);
    // A devolução precisa de um consumo confirmado como origem.
    const k = await doc({ especie: "consumo" });
    await confirmar(k);
    for (const especie of ESPECIES) {
      // Contraprova: com a TOP da própria família, a espécie nasce.
      const certo = await doc({ especie, origem: especie === "devolucao_consumo" ? k : null });
      expect([especie, await situacaoDe(certo)]).toEqual([especie, "aberto"]);
      for (const outra of [...ESPECIES.filter((x) => x !== especie).map((x) => FAMILIA[x]), "estoque.requisicao", "compras.compra"]) {
        const e = await erroDe(doc({ especie, top: topDe(outra), origem: especie === "devolucao_consumo" ? k : null }));
        expect([especie, outra, e.message]).toEqual([especie, outra, `VALIDATION_ERROR: O tipo de operação não é da família do documento (${FAMILIA[especie]}).`]);
      }
    }
    // Para as quatro de hoje, o texto é o MESMO da 0040 ('estoque.' || espécie).
    for (const especie of ["entrada", "saida", "transferencia", "ajuste"] as Especie[]) expect(FAMILIA[especie]).toBe(`estoque.${especie}`);
    const req = await doc({ especie: "requisicao" });
    expect((await db.query("select t.codigo_base from erp.documentos_estoque d join erp.tipos_operacao t on t.id = d.tipo_operacao_id where d.id=$1", [req])).rows)
      .toEqual([{ codigo_base: "estoque.requisicao_material" }]);
  });

  it("H2 origem do consumo: outra espécie, outra empresa, outro local de estoque e inexistente → a MESMA recusa; requisição aberta/cancelada → CONFLICT com a situação; encerrada → CONFLICT", async () => {
    const MESMA = "VALIDATION_ERROR: A origem do consumo precisa ser uma requisição da mesma empresa e do mesmo local de estoque.";
    const saida = await doc({ especie: "saida" });
    const reqB = (await requisicao([{ quantidade: "1" }], { empresa: B, armazem: wB })).id;
    const reqA2 = (await requisicao([{ quantidade: "1" }], { armazem: wA2 })).id;
    const ok = (await requisicao([{ quantidade: "1" }])).id;
    // PREMISSA: a requisição certa (mesma empresa, mesmo local, confirmada) é aceita.
    await expect(doc({ especie: "consumo", origem: ok })).resolves.toBeTruthy();
    for (const [nome, origem] of [["outra espécie", saida], ["outra empresa", reqB], ["outro local de estoque", reqA2]] as [string, string][]) {
      expect([nome, (await erroDe(doc({ especie: "consumo", origem }))).message]).toEqual([nome, MESMA]);
    }
    // Inexistente: o gatilho responde antes da FK (a mesma recusa, não um 23503 que diria outra coisa).
    expect((await erroDe(doc({ especie: "consumo", origem: randomUUID() }))).message).toBe(MESMA);
    const aberta = (await requisicao([{ quantidade: "1" }], { confirmada: false })).id;
    expect((await erroDe(doc({ especie: "consumo", origem: aberta }))).message).toBe("CONFLICT: A requisição de origem não está pendente (situação: aberto).");
    const cancelada = (await requisicao([{ quantidade: "1" }])).id;
    await cancelar(cancelada);
    expect((await erroDe(doc({ especie: "consumo", origem: cancelada }))).message).toBe("CONFLICT: A requisição de origem não está pendente (situação: cancelado).");
    const encerrada = (await requisicao([{ quantidade: "1" }])).id;
    await encerrar(encerrada);
    expect((await erroDe(doc({ especie: "consumo", origem: encerrada }))).message).toBe("CONFLICT: O saldo da requisição de origem foi encerrado.");
  });

  it("H3 origem da devolução: consumo confirmado da mesma empresa e local; outra espécie → a recusa da devolução; consumo aberto → CONFLICT com a situação", async () => {
    const req = await requisicao([{ quantidade: "5" }]);
    const k = await consumo(req.id, [{ quantidade: "2", origem: req.itens[0] }]);
    expect((await erroDe(doc({ especie: "devolucao_consumo", origem: k.id }))).message).toBe("CONFLICT: O consumo de origem não está confirmado (situação: aberto).");
    expect((await erroDe(doc({ especie: "devolucao_consumo", origem: req.id }))).message)
      .toBe("VALIDATION_ERROR: A origem da devolução precisa ser um consumo da mesma empresa e do mesmo local de estoque.");
    expect((await erroDe(doc({ especie: "devolucao_consumo", origem: k.id, armazem: wA2 }))).message)
      .toBe("VALIDATION_ERROR: A origem da devolução precisa ser um consumo da mesma empresa e do mesmo local de estoque.");
    await confirmar(k.id);
    await expect(doc({ especie: "devolucao_consumo", origem: k.id })).resolves.toBeTruthy();
  });

  it("H4 destino herdado: o consumo leva cada dimensão que a requisição tem (outra → recusa; a que ela não tem é livre); a devolução leva as seis do consumo", async () => {
    const req = await requisicao([{ quantidade: "5" }], { destino: { centro: dA.centro, safra: dA.safra } });
    const HERDADO = "VALIDATION_ERROR: O destino do consumo é o da requisição de origem.";
    const outro = await destinos(demo.orgId, A);
    expect((await erroDe(doc({ especie: "consumo", origem: req.id, destino: { centro: outro.centro, safra: dA.safra } }))).message).toBe(HERDADO);
    expect((await erroDe(doc({ especie: "consumo", origem: req.id, destino: { safra: dA.safra } }))).message, "sem o centro que a requisição tem").toBe(HERDADO);
    const k = await doc({ especie: "consumo", origem: req.id, destino: { centro: dA.centro, safra: dA.safra, equipamento: dA.equipamento } });
    // No aberto, trocar a dimensão herdada também é recusado; a livre muda.
    expect((await erroDe(db.query("update erp.documentos_estoque set safra_id=$2 where id=$1", [k, outro.safra]))).message).toBe(HERDADO);
    await expect(db.query("update erp.documentos_estoque set equipamento_id=$2 where id=$1", [k, outro.equipamento])).resolves.toMatchObject({ rowCount: 1 });
    await item(k, { quantidade: "1", origem: req.itens[0] });
    await confirmar(k);
    const DEVOLUCAO = "VALIDATION_ERROR: O destino da devolução de consumo é o do consumo de origem.";
    expect((await erroDe(doc({ especie: "devolucao_consumo", origem: k, destino: { centro: dA.centro, safra: dA.safra } }))).message).toBe(DEVOLUCAO);
    expect((await erroDe(doc({ especie: "devolucao_consumo", origem: k, destino: { centro: dA.centro, safra: dA.safra, equipamento: outro.equipamento, area: dA.area } }))).message).toBe(DEVOLUCAO);
    await expect(doc({ especie: "devolucao_consumo", origem: k, destino: { centro: dA.centro, safra: dA.safra, equipamento: outro.equipamento } })).resolves.toBeTruthy();
  });

  it("H5 referências do destino: de outra organização, de outra empresa (as de empresa) e excluída → recusa com a mensagem da dimensão; as da empresa e da organização passam", async () => {
    const MSG: Record<Dim, string> = {
      centro: "VALIDATION_ERROR: O centro de resultado do destino precisa existir na organização.",
      safra: "VALIDATION_ERROR: A safra do destino precisa existir na organização.",
      equipamento: "VALIDATION_ERROR: A máquina/equipamento do destino precisa existir e ser da empresa do documento.",
      os: "VALIDATION_ERROR: A ordem de serviço do destino precisa existir e ser da empresa do documento.",
      lote: "VALIDATION_ERROR: O lote de animais do destino precisa existir e ser da empresa do documento.",
      area: "VALIDATION_ERROR: A área/talhão do destino precisa existir e ser da empresa do documento."
    };
    // PREMISSA: as seis da empresa A (e da organização) passam juntas.
    await expect(doc({ especie: "requisicao", destino: dA })).resolves.toBeTruthy();
    for (const dim of DIMS) {
      const casos: [string, string][] = [["outra organização", dOutra[dim]], ["excluída", dExcluido[dim]]];
      if (!["centro", "safra"].includes(dim)) casos.push(["outra empresa", dB[dim]]);
      for (const [nome, valor] of casos) {
        expect([dim, nome, (await erroDe(doc({ especie: "requisicao", destino: { [dim]: valor } }))).message]).toEqual([dim, nome, MSG[dim]]);
      }
    }
    // Centro e safra são da organização: os "de B" (a mesma organização) passam num documento de A.
    await expect(doc({ especie: "requisicao", destino: { centro: dB.centro, safra: dB.safra } })).resolves.toBeTruthy();
    // E a troca no aberto confere também.
    const d = await doc({ especie: "saida" });
    expect((await erroDe(db.query("update erp.documentos_estoque set lote_animais_id=$2 where id=$1", [d, dB.lote]))).message).toBe(MSG.lote);
    await expect(db.query("update erp.documentos_estoque set lote_animais_id=$2 where id=$1", [d, dA.lote])).resolves.toMatchObject({ rowCount: 1 });
  });

  it("H6 origem imutável (nem aberto); nasce aberto também sem saldo encerrado", async () => {
    const r1 = (await requisicao([{ quantidade: "3" }])).id;
    const r2 = (await requisicao([{ quantidade: "3" }])).id;
    const k = await doc({ especie: "consumo", origem: r1 });
    expect((await erroDe(db.query("update erp.documentos_estoque set origem_documento_id=$2 where id=$1", [k, r2]))).message)
      .toBe("VALIDATION_ERROR: A origem do documento de estoque não muda depois do lançamento.");
    expect((await erroDe(db.query("update erp.documentos_estoque set origem_documento_id=null where id=$1", [k]))).message)
      .toBe("VALIDATION_ERROR: A origem do documento de estoque não muda depois do lançamento.");
    const direto = await doc({ especie: "consumo" });
    expect((await erroDe(db.query("update erp.documentos_estoque set origem_documento_id=$2 where id=$1", [direto, r1]))).message)
      .toBe("VALIDATION_ERROR: A origem do documento de estoque não muda depois do lançamento.");
    expect((await erroDe(doc({ especie: "requisicao", encerrado: { motivo: "x" } }))).message)
      .toBe("VALIDATION_ERROR: O documento de estoque nasce aberto; a confirmação e o cancelamento são transições.");
  });

  it("H7 encerrar o saldo: só na requisição confirmada, uma vez, e sozinho; no aberto → CONFLICT; os três juntos (CHECK)", async () => {
    const aberta = (await requisicao([{ quantidade: "3" }], { confirmada: false })).id;
    expect((await erroDe(encerrar(aberta))).message).toBe("CONFLICT: Só a requisição confirmada tem o saldo encerrado.");
    const r = (await requisicao([{ quantidade: "3" }])).id;
    const antes = (await db.query<{ a: Date }>("select atualizado_em a from erp.documentos_estoque where id=$1", [r])).rows[0]!.a;
    // Encerrar E mudar outra coisa no mesmo UPDATE: só o cancelamento muda.
    expect((await erroDe(db.query("update erp.documentos_estoque set saldo_encerrado_em=now(), saldo_encerrado_por=$2, saldo_encerrado_motivo='x', observacao='outra' where id=$1",
      [r, demo.adminUserId]))).message).toBe("CONFLICT: O documento de estoque está confirmado; só o cancelamento muda.");
    expect((await erroDe(db.query("update erp.documentos_estoque set saldo_encerrado_em=now() where id=$1", [r]))).constraint).toBe("chk_documentos_estoque_saldo_encerrado");
    await expect(encerrar(r, "Não precisa mais")).resolves.toMatchObject({ rowCount: 1 });
    const depois = (await db.query<{ s: string; m: string; a: Date }>("select situacao s, saldo_encerrado_motivo m, atualizado_em a from erp.documentos_estoque where id=$1", [r])).rows[0]!;
    expect([depois.s, depois.m, depois.a > antes]).toEqual(["confirmado", "Não precisa mais", true]);
    expect((await erroDe(encerrar(r, "De novo"))).message).toBe("CONFLICT: O saldo da requisição já foi encerrado.");
    expect((await erroDe(db.query("update erp.documentos_estoque set saldo_encerrado_em=null, saldo_encerrado_por=null, saldo_encerrado_motivo=null where id=$1", [r]))).message)
      .toBe("CONFLICT: O saldo da requisição já foi encerrado.");
    // Fora da requisição, o confirmado só se cancela.
    const s = await doc({ especie: "saida" });
    await item(s, { quantidade: "1" });
    await db.query("update erp.documentos_estoque set situacao='confirmado', confirmado_em=now(), confirmado_por=$2 where id=$1", [s, demo.adminUserId]);
    expect((await erroDe(encerrar(s))).message).toBe("CONFLICT: O documento de estoque está confirmado; só o cancelamento muda.");
    // A requisição com saldo encerrado ainda se cancela (sem consumo vivo), e o cancelamento não toca nos três.
    await expect(cancelar(r)).resolves.toMatchObject({ rowCount: 1 });
    expect(await situacaoDe(r)).toBe("cancelado");
  });

  it("H8 as duas mensagens do local de estoque (o da origem e o de destino da transferência)", async () => {
    expect((await erroDe(doc({ armazem: wB }))).message).toBe("VALIDATION_ERROR: O local de estoque precisa existir e ser da empresa do documento.");
    expect((await erroDe(doc({ especie: "transferencia", localDestino: wB }))).message).toBe("VALIDATION_ERROR: O local de estoque de destino precisa existir e ser da empresa do documento.");
    await expect(doc({ empresa: B, armazem: wB })).resolves.toBeTruthy();
  });
});

describe("guarda dos itens (origem)", () => {
  it("I1 consumo: soma ligada ≤ saldo do item da requisição; produto diferente; item de outro documento; sem origem no cabeçalho; item extra sem origem passa", async () => {
    const req = await requisicao([{ quantidade: "10" }, { quantidade: "3", produto: await produtoNovo(demo.orgId) }]);
    const k = await consumo(req.id, [{ quantidade: "6", origem: req.itens[0] }]);
    expect((await erroDe(item(k.id, { quantidade: "5", origem: req.itens[0] }))).message)
      .toBe("VALIDATION_ERROR: A quantidade passa do saldo pendente do item da requisição.");
    await expect(item(k.id, { quantidade: "4", origem: req.itens[0] }), "6 + 4 = 10: cabe").resolves.toBeTruthy();
    // Aumentar uma linha já ligada também confere (UPDATE OF quantidade).
    expect((await erroDe(db.query("update erp.documentos_estoque_itens set quantidade='7' where id=$1", [k.itens[0]]))).message)
      .toBe("VALIDATION_ERROR: A quantidade passa do saldo pendente do item da requisição.");
    expect((await erroDe(item(k.id, { quantidade: "1", origem: req.itens[1] }))).message, "o item 2 é de outro produto")
      .toBe("VALIDATION_ERROR: O produto do item difere do produto do item de origem.");
    const outraReq = await requisicao([{ quantidade: "5" }]);
    expect((await erroDe(item(k.id, { quantidade: "1", origem: outraReq.itens[0] }))).message).toBe("VALIDATION_ERROR: O item de origem não pertence ao documento de origem.");
    await expect(item(k.id, { quantidade: "2" }), "item a mais, sem origem").resolves.toBeTruthy();
    const direto = await consumo(null, []);
    expect((await erroDe(item(direto.id, { quantidade: "1", origem: req.itens[0] }))).message).toBe("VALIDATION_ERROR: O item com origem exige o documento de origem no cabeçalho.");
    // Um consumo CANCELADO devolve o saldo: outro consumo leva os 10 de novo.
    await cancelar(k.id);
    await expect(consumo(req.id, [{ quantidade: "10", origem: req.itens[0] }])).resolves.toBeTruthy();
  });

  it("I2 pelo papel da aplicação (RLS, GUC do módulo estoque): o consumo ligado nasce, e a soma que passa é recusada pela guarda", async () => {
    const req = await requisicao([{ quantidade: "4" }]);
    const k = await withTx(app, ctxEstoque(), async (tx) => {
      const id = await inserirCab(tx, { especie: "consumo", origem: req.id });
      await inserirItem(tx, id, { especie: "consumo", quantidade: "3", origem: req.itens[0] });
      return id;
    });
    expect(await situacaoDe(k)).toBe("aberto");
    const e = await erroDe(withTx(app, ctxEstoque(), (tx) => inserirItem(tx, k, { especie: "consumo", quantidade: "2", origem: req.itens[0] })));
    expect(e.message).toBe("VALIDATION_ERROR: A quantidade passa do saldo pendente do item da requisição.");
  });

  it("I3 requisição que deixou de estar pendente (saldo encerrado) não aceita linha nova ligada no consumo aberto", async () => {
    const req = await requisicao([{ quantidade: "10" }]);
    const k = await consumo(req.id, [{ quantidade: "2", origem: req.itens[0] }]);
    await encerrar(req.id);
    expect((await erroDe(item(k.id, { quantidade: "1", origem: req.itens[0] }))).message).toBe("CONFLICT: A requisição de origem não está pendente.");
    // PREMISSA: a linha sem origem (item a mais) continua aceita — a recusa é da ligação.
    await expect(item(k.id, { quantidade: "1" })).resolves.toBeTruthy();
  });

  /** Espera `pid` ficar bloqueado por `bloqueador` (pg_blocking_pids), até 10s. */
  async function esperarBloqueio(pid: number, bloqueador: number): Promise<void> {
    for (let i = 0; i < 500; i++) {
      const b = (await db.query<{ b: number[] }>("select pg_blocking_pids($1) b", [pid])).rows[0]!.b;
      if (b.includes(bloqueador)) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`o backend ${pid} não ficou bloqueado por ${bloqueador}`);
  }
  async function duasPartes(primeira: "commit" | "rollback"): Promise<string | null> {
    const req = await requisicao([{ quantidade: "10" }]);
    const c1 = await db.connect(); const c2 = await db.connect();
    try {
      await c1.query("begin"); await c2.query("begin");
      const pid1 = (await c1.query<{ p: number }>("select pg_backend_pid() p")).rows[0]!.p;
      const pid2 = (await c2.query<{ p: number }>("select pg_backend_pid() p")).rows[0]!.p;
      const k1 = await inserirCab(c1, { especie: "consumo", origem: req.id });
      await inserirItem(c1, k1, { especie: "consumo", quantidade: "6", origem: req.itens[0] });
      const k2 = await inserirCab(c2, { especie: "consumo", origem: req.id });
      const segunda = inserirItem(c2, k2, { especie: "consumo", quantidade: "6", origem: req.itens[0] }).then(() => null, (e: Error) => e.message);
      // A segunda ESPERA a primeira: a trava do item de origem (FOR UPDATE) é a fila.
      await esperarBloqueio(pid2, pid1);
      await c1.query(primeira);
      const r = await segunda;
      await c2.query("rollback");
      return r;
    } finally { await c1.query("rollback").catch(() => {}); await c2.query("rollback").catch(() => {}); c1.release(); c2.release(); }
  }
  it("I4 barreira: duas partes simultâneas de 6 sobre o MESMO item de 10 se enfileiram, e a segunda soma a primeira (desfeita a primeira, a segunda cabe)", async () => {
    expect(await duasPartes("commit")).toBe("VALIDATION_ERROR: A quantidade passa do saldo pendente do item da requisição.");
    expect(await duasPartes("rollback"), "PREMISSA: sem a primeira, os 6 da segunda cabem nos 10").toBeNull();
  });

  it("I5 devolução: todo item com origem; soma devolvida ≤ o que o item do consumo baixou; a devolução cancelada devolve o saldo; consumo de origem fora do confirmado → CONFLICT", async () => {
    const req = await requisicao([{ quantidade: "10" }]);
    const k = await consumo(req.id, [{ quantidade: "4", origem: req.itens[0] }]);
    await confirmar(k.id);
    const d1 = await doc({ especie: "devolucao_consumo", origem: k.id });
    expect((await erroDe(item(d1, { quantidade: "1" }))).message).toBe("VALIDATION_ERROR: Todo item da devolução de consumo vem de um item do consumo.");
    expect((await erroDe(item(d1, { quantidade: "1", origem: req.itens[0] }))).message, "o item da requisição não é item do consumo")
      .toBe("VALIDATION_ERROR: O item de origem não pertence ao documento de origem.");
    await item(d1, { quantidade: "3", origem: k.itens[0] });
    const d2 = await doc({ especie: "devolucao_consumo", origem: k.id });
    expect((await erroDe(item(d2, { quantidade: "2", origem: k.itens[0] }))).message).toBe("VALIDATION_ERROR: A quantidade passa do que o item do consumo baixou e ainda não voltou.");
    await expect(item(d2, { quantidade: "1", origem: k.itens[0] }), "3 + 1 = 4: cabe").resolves.toBeTruthy();
    await cancelar(d1);
    await expect(item(d2, { quantidade: "3", origem: k.itens[0] }), "a devolução de 3 cancelada: 1 + 3 = 4 cabe de novo").resolves.toBeTruthy();
    // A rede do item: um cabeçalho de devolução apontando um consumo ABERTO (só possível com a conferência do
    // cabeçalho desligada, numa transação desfeita) não aceita item.
    const kAberto = await consumo(req.id, [{ quantidade: "1", origem: req.itens[0] }]);
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query("alter table erp.documentos_estoque disable trigger trg_documentos_estoque_conferir");
      const d3 = await inserirCab(c, { especie: "devolucao_consumo", origem: kAberto.id });
      await c.query("alter table erp.documentos_estoque enable trigger trg_documentos_estoque_conferir");
      expect((await erroDe(inserirItem(c, d3, { especie: "devolucao_consumo", quantidade: "1", origem: kAberto.itens[0] }))).message)
        .toBe("CONFLICT: O consumo de origem não está confirmado.");
    } finally { await c.query("rollback"); c.release(); }
  });
});

describe("transição", () => {
  it("T1 requisição com consumo vivo não cancela; consumo com devolução viva não cancela; desfeito de baixo para cima, cancelam", async () => {
    const req = await requisicao([{ quantidade: "10" }]);
    const k = await consumo(req.id, [{ quantidade: "4", origem: req.itens[0] }]);
    expect((await erroDe(cancelar(req.id))).message).toBe("CONFLICT: Esta requisição tem consumos: cancele-os ou encerre o saldo.");
    await confirmar(k.id);
    expect((await erroDe(cancelar(req.id))).message, "o consumo confirmado também é vivo").toBe("CONFLICT: Esta requisição tem consumos: cancele-os ou encerre o saldo.");
    const d = await doc({ especie: "devolucao_consumo", origem: k.id });
    await item(d, { quantidade: "1", origem: k.itens[0] });
    expect((await erroDe(cancelar(k.id))).message).toBe("CONFLICT: Este consumo tem devoluções: cancele-as primeiro.");
    expect([await situacaoDe(req.id), await situacaoDe(k.id), await situacaoDe(d)]).toEqual(["confirmado", "confirmado", "aberto"]);
    await cancelar(d);
    await cancelar(k.id);
    await cancelar(req.id);
    expect([await situacaoDe(req.id), await situacaoDe(k.id), await situacaoDe(d)]).toEqual(["cancelado", "cancelado", "cancelado"]);
    // Sem dependentes, a requisição aberta e a confirmada cancelam direto.
    for (const confirmada of [false, true]) {
      const r = (await requisicao([{ quantidade: "1" }], { confirmada })).id;
      await expect(cancelar(r)).resolves.toMatchObject({ rowCount: 1 });
    }
  });
});

describe("reserva: a parte C (requisições pendentes e consumos abertos ligados)", () => {
  it("R1 núcleo: requisição confirmada C1 = 10; consumo aberto de 4 → C1 6 + C2 4 = 10; consumo confirmado → 6; saldo encerrado → 0; aberta e cancelada não reservam; o próprio documento sai da conta", async () => {
    const w = await armazem(demo.orgId, A);
    const aberta = await requisicao([{ quantidade: "7" }], { armazem: w, confirmada: false });
    expect(await nucleo(w, produto), "requisição aberta (salva) não reserva").toBe("0.0000");
    const req = await requisicao([{ quantidade: "10" }], { armazem: w });
    expect(await nucleo(w, produto)).toBe("10.0000");
    expect(await nucleo(w, produto, req.id), "a requisição que se confirma não conta a própria parte C1").toBe("0.0000");
    const k = await consumo(req.id, [{ quantidade: "4", origem: req.itens[0] }], { armazem: w });
    expect(await nucleo(w, produto), "atender move de C1 para C2 sem mudar o total").toBe("10.0000");
    expect(await nucleo(w, produto, k.id), "sem a C2 do próprio consumo: só C1 (10 − 4)").toBe("6.0000");
    // Item SEM origem do consumo não é reserva de ninguém.
    await item(k.id, { quantidade: "5" });
    expect(await nucleo(w, produto)).toBe("10.0000");
    await confirmar(k.id);
    expect(await nucleo(w, produto), "consumo confirmado: a parte dele saiu de C2 e não volta a C1").toBe("6.0000");
    await encerrar(req.id);
    expect(await nucleo(w, produto), "saldo encerrado tira C1").toBe("0.0000");
    await cancelar(aberta.id);
    const outra = await requisicao([{ quantidade: "2" }], { armazem: w });
    await cancelar(outra.id);
    expect(await nucleo(w, produto), "requisição cancelada não reserva").toBe("0.0000");
    // Produto SEM controle de estoque não entra em C1 nem em C2. O item nasce controlado, e o flag não muda sob
    // requisição pendente (R5): a troca é feita com o gatilho do flag desligado, numa transação desfeita.
    const p = await produtoNovo(demo.orgId);
    const r2 = await requisicao([{ quantidade: "3", produto: p }], { armazem: w });
    await consumo(r2.id, [{ quantidade: "1", produto: p, origem: r2.itens[0] }], { armazem: w });
    expect(await nucleo(w, p), "PREMISSA: controlado, C1 2 + C2 1").toBe("3.0000");
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query("alter table erp.products disable trigger trg_products_controle_estoque_reserva");
      await c.query("update erp.products set control_stock=false where id=$1", [p]);
      expect((await c.query<{ r: string }>("select reservado::text r from erp.reserva_estoque_nucleo($1, array[$2]::uuid[], array[$3]::uuid[], null)",
        [demo.orgId, w, p])).rows[0]!.r, "produto sem controle: zero").toBe("0.0000");
    } finally { await c.query("rollback"); c.release(); }
  });

  it("R2 a porta responde a quem só vê (ou só edita) requisição de material, e zero linhas a quem não tem capacidade", async () => {
    const w = await armazem(demo.orgId, A);
    await requisicao([{ quantidade: "5" }], { armazem: w });
    const chaves = (await db.query<{ key: string }>("select key from erp.permissions where key in ('requisicoes_estoque.view','requisicoes_estoque.edit') order by key")).rows.map((x) => x.key);
    expect(chaves, "PREMISSA: as capacidades da requisição estão no catálogo (seedReference, do domínio)").toEqual(["requisicoes_estoque.edit", "requisicoes_estoque.view"]);
    async function usuarioComPapel(nome: string, chavesDoPapel: string[]): Promise<string> {
      const papel = await id1("insert into erp.roles (organization_id, name) values ($1,$2) returning id", [demo.orgId, nome]);
      for (const k of chavesDoPapel) await db.query("insert into erp.role_permissions (role_id, permission_key) values ($1,$2)", [papel, k]);
      const u = await id1("insert into erp.users (email, name, password_hash) values ($1,$2,'x') returning id", [`${randomUUID()}@t43.local`, nome]);
      await db.query("insert into erp.organization_members (organization_id, user_id, role_id, is_owner) values ($1,$2,$3,false)", [demo.orgId, u, papel]);
      return u;
    }
    const porta = (u: string) => withTx(app, ctxEstoque(u), async (tx) => (await tx.query<{ reservado: string }>(
      "select reservado from erp.reserva_estoque(array[$1]::uuid[], array[$2]::uuid[])", [w, produto])).rows);
    expect(await porta(await usuarioComPapel("T43 so ve requisicao", ["requisicoes_estoque.view"]))).toEqual([{ reservado: "5.0000" }]);
    expect(await porta(await usuarioComPapel("T43 so edita requisicao", ["requisicoes_estoque.edit"]))).toEqual([{ reservado: "5.0000" }]);
    expect(await porta(await usuarioComPapel("T43 sem capacidade", ["products.view", "requisicoes_estoque.create"]))).toEqual([]);
  });

  it("R3 a guarda: saída que invade a reserva da requisição → a MESMA mensagem de hoje; o consumo exclui a PRÓPRIA C2 (4 confirma com físico 10 e reserva 10); confirmado e encerrado, sai", async () => {
    const w = await armazem(demo.orgId, A);
    await entrada(w, produto, "10");
    const req = await requisicao([{ quantidade: "10" }], { armazem: w });
    expect([await fisico(w, produto), await nucleo(w, produto)]).toEqual(["10.0000", "10.0000"]);
    await expect(movimento(w, produto, "1", { tipo: "writeoff" })).rejects.toThrow(INSUFICIENTE("0", "1", "10"));
    expect(await fisico(w, produto), "a recusa desfez a baixa").toBe("10.0000");
    const k = await consumo(req.id, [{ quantidade: "4", origem: req.itens[0] }], { armazem: w });
    // Contraprova: a mesma saída de 4 por OUTRA origem invade (C1 6 + C2 4 = 10 > 6 que sobram).
    await expect(movimento(w, produto, "4", { origemTipo: "documentos_estoque", origemId: randomUUID() })).rejects.toThrow(INSUFICIENTE("0", "4", "10"));
    // O movimento DO consumo (origem documentos_estoque = o consumo, ainda aberto) não conta a própria C2: 6 ≥ 6.
    await movimento(w, produto, "4", { origemTipo: "documentos_estoque", origemId: k.id });
    await confirmar(k.id);
    expect([await fisico(w, produto), await nucleo(w, produto)]).toEqual(["6.0000", "6.0000"]);
    await expect(movimento(w, produto, "1", { tipo: "transfer_out" })).rejects.toThrow(INSUFICIENTE("0", "1", "6"));
    // correction_out e reversal não passam pela guarda (por desenho, como na 0035).
    await movimento(w, produto, "1", { tipo: "correction_out" });
    await entrada(w, produto, "1", { tipo: "correction_in" });
    await encerrar(req.id);
    expect(await nucleo(w, produto)).toBe("0.0000");
    await movimento(w, produto, "6", { tipo: "writeoff" });
    expect(await fisico(w, produto)).toBe("0.0000");
  });

  it("R4 o atalho: organização SEM versão com reserva e COM requisição pendente (ou só consumo aberto ligado) passa a conferir; sem os dois, sai", async () => {
    const versoes = (await db.query<{ n: number }>("select count(*)::int n from erp.tipos_operacao_versoes where organization_id=$1 and reserva_estoque", [outraOrg])).rows[0]!.n;
    expect(versoes, "PREMISSA: a outra organização não tem versão com reserva — o atalho da 0035 sairia sem conferir").toBe(0);
    const mov = { org: outraOrg, empresa: empresaOutraOrg };
    const cab = { org: outraOrg, empresa: empresaOutraOrg, armazem: wOutraOrg };
    await entrada(wOutraOrg, produtoOutraOrg, "10", mov);
    const req = await requisicao([{ quantidade: "10", produto: produtoOutraOrg }], cab);
    await expect(movimento(wOutraOrg, produtoOutraOrg, "1", { ...mov, tipo: "writeoff" })).rejects.toThrow(INSUFICIENTE("0", "1", "10"));
    // Só o consumo aberto ligado (a requisição encerrada): ainda confere.
    const k = await consumo(req.id, [{ quantidade: "4", produto: produtoOutraOrg, origem: req.itens[0] }], cab);
    await encerrar(req.id);
    expect(await nucleo(wOutraOrg, produtoOutraOrg, null, outraOrg)).toBe("4.0000");
    await expect(movimento(wOutraOrg, produtoOutraOrg, "7", { ...mov, tipo: "writeoff" })).rejects.toThrow(INSUFICIENTE("6", "7", "4"));
    // Sem nenhum dos dois (consumo cancelado), o atalho sai: a mesma saída passa.
    await cancelar(k.id);
    await movimento(wOutraOrg, produtoOutraOrg, "7", { ...mov, tipo: "writeoff" });
    expect(await fisico(wOutraOrg, produtoOutraOrg)).toBe("3.0000");
  });

  it("R5 o flag control_stock: requisição com saldo pendente ou consumo aberto ligado → mensagem NOVA; pedido com reserva → a de HOJE (primeiro); requisição atendida por inteiro não trava", async () => {
    const NOVA = "VALIDATION_ERROR: O produto está em requisição de material pendente (ou em consumo aberto que a atende): não pode mudar \"Controla estoque\" agora. Atenda, encerre o saldo ou cancele a requisição antes.";
    const HOJE = "VALIDATION_ERROR: O produto está em pedido com reserva de estoque em aberto (ou em venda aberta gerada dele): não pode mudar \"Controla estoque\" agora. Fature, cancele ou encerre o saldo do pedido antes.";
    const flag = (p: string) => db.query("update erp.products set control_stock = not control_stock where id=$1", [p]);
    const emTransacaoDesfeita = async (p: string) => {
      const c = await db.connect();
      try { await c.query("begin"); return (await c.query("update erp.products set control_stock = not control_stock where id=$1", [p])).rowCount; }
      finally { await c.query("rollback"); c.release(); }
    };
    const pPendente = await produtoNovo(demo.orgId);
    const reqPendente = await requisicao([{ quantidade: "3", produto: pPendente }]);
    expect((await erroDe(flag(pPendente))).message).toBe(NOVA);
    // Consumo aberto ligado (a requisição encerrada não é mais C1): continua travado.
    const pConsumo = await produtoNovo(demo.orgId);
    const reqConsumo = await requisicao([{ quantidade: "3", produto: pConsumo }]);
    const kConsumo = await consumo(reqConsumo.id, [{ quantidade: "1", produto: pConsumo, origem: reqConsumo.itens[0] }]);
    await encerrar(reqConsumo.id);
    expect((await erroDe(flag(pConsumo))).message).toBe(NOVA);
    await cancelar(kConsumo.id);
    expect(await emTransacaoDesfeita(pConsumo), "sem o consumo aberto, o flag muda").toBe(1);
    // Atendida por inteiro (consumo confirmado de todo o saldo), a requisição continua confirmada e sem saldo
    // encerrado — e não trava o flag: não há nada reservado.
    const pAtendido = await produtoNovo(demo.orgId);
    const reqAtendida = await requisicao([{ quantidade: "2", produto: pAtendido }]);
    const kAtendido = await consumo(reqAtendida.id, [{ quantidade: "2", produto: pAtendido, origem: reqAtendida.itens[0] }]);
    await confirmar(kAtendido.id);
    expect([await situacaoDe(reqAtendida.id), (await db.query("select saldo_encerrado_em from erp.documentos_estoque where id=$1", [reqAtendida.id])).rows[0]])
      .toEqual(["confirmado", { saldo_encerrado_em: null }]);
    expect(await emTransacaoDesfeita(pAtendido)).toBe(1);
    // Pedido de venda com reserva (A): a mensagem de HOJE, e ela vem ANTES da de C no produto que está nos dois.
    const pedidoReserva = await criarTop(demo.orgId, "vendas.pedido", true);
    const cliente = await id1("select id from erp.people where organization_id=$1 and is_client and deleted_at is null order by code limit 1", [demo.orgId]);
    seq += 1;
    const pedido = await id1(
      `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, status, tipo_operacao_id, tipo_operacao_versao_id)
       values ($1,$2,'order',$3,'2026-10-01',$4,'open',$5,$6) returning id`, [demo.orgId, A, `T43-V${seq}`, cliente, pedidoReserva.top, pedidoReserva.versao]);
    await db.query("insert into erp.sales_document_items (document_id, product_id, warehouse_id, quantity, unit_price, total, position) values ($1,$2,$3,1,10,10,0)", [pedido, pPendente, wA]);
    expect((await erroDe(flag(pPendente))).message).toBe(HOJE);
    // PREMISSA: o produto continua na requisição pendente (a C também o travaria) — a de HOJE vem primeiro.
    expect(await nucleo(wA, pPendente, pedido)).toBe("3.0000");
    expect(reqPendente.itens).toHaveLength(1);
  });
});

describe("mensagens que diziam 'armazém'", () => {
  it("M1 o corpo das quatro funções de mensagem não diz 'armazém' e diz 'local de estoque' (na 0041 dizia — DB-5.1)", async () => {
    for (const f of DE_MENSAGEM) {
      const r = (await db.query<{ armazem: boolean; local: boolean }>(
        "select prosrc ~ '[Aa]rmaz[éê]' armazem, prosrc ~ 'loca(l|is) de estoque' local from pg_proc where oid = $1::regprocedure", [f])).rows[0]!;
      expect([f, r]).toEqual([f, { armazem: false, local: true }]);
    }
  });

  it("M2 INSUFFICIENT_STOCK do razão: 'local de estoque' (o código é o mesmo)", async () => {
    const w = await armazem(demo.orgId, A);
    expect((await erroDe(movimento(w, produto, "5", { tipo: "writeoff" }))).message)
      .toBe(`INSUFFICIENT_STOCK: saldo 0.0000 < solicitado 5.0000 (produto ${produto}, local de estoque ${w})`);
  });

  it("M3 controle de lote com saldo: a mensagem do banco é a MSG_CONTROLE_COM_SALDO da API (apps/api/src/lib/produto.ts)", async () => {
    const w = await armazem(demo.orgId, A);
    const p = await produtoNovo(demo.orgId);
    await entrada(w, p, "2");
    expect((await erroDe(db.query("update erp.products set controle_lote='lote' where id=$1", [p]))).message)
      .toBe("VALIDATION_ERROR: O produto tem saldo em estoque: zere o saldo em todos os locais de estoque antes de mudar o controle de lote.");
  });

  it("M4 item de compra com local de estoque de outra empresa: a mensagem nova (e sem local, passa)", async () => {
    const t = topDe("compras.compra");
    seq += 1;
    const compra = await id1(
      `insert into erp.documentos_compra (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, fornecedor_id, data_documento, valor_itens, valor_total)
       values ($1,$2,'compra',$3,$4,$5,$6,'2026-10-01',10,10) returning id`, [demo.orgId, A, `T43-C${seq}`, t.top, t.versao, fornecedor]);
    const itemCompra = (armazemId: string | null) => db.query(
      "insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, quantidade, posicao, armazem_id) values ($1,$2,$3,1,$4,$5)",
      [demo.orgId, compra, produto, (seq += 1), armazemId]);
    expect((await erroDe(itemCompra(wB))).message).toBe("VALIDATION_ERROR: O local de estoque do item precisa ser da empresa do documento.");
    await expect(itemCompra(null)).resolves.toMatchObject({ rowCount: 1 });
    await expect(itemCompra(wA)).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("razão e FKs compostas", () => {
  it("Z1 o razão grava as quatro dimensões novas; alvo de OUTRA organização é recusado pela FK composta (23503)", async () => {
    const w = await armazem(demo.orgId, A);
    const origem = randomUUID();
    await entrada(w, produto, "1", { origemId: origem, extra: { equipamento_id: dA.equipamento, ordem_servico_id: dA.os, lote_animais_id: dA.lote, area_id: dA.area } });
    expect((await db.query("select equipamento_id, ordem_servico_id, lote_animais_id, area_id from erp.stock_movements where source_id=$1", [origem])).rows)
      .toEqual([{ equipamento_id: dA.equipamento, ordem_servico_id: dA.os, lote_animais_id: dA.lote, area_id: dA.area }]);
    const casos: [string, string, string][] = [["equipamento_id", dOutra.equipamento, "fk_stock_movements_equipamento"], ["ordem_servico_id", dOutra.os, "fk_stock_movements_ordem_servico"],
      ["lote_animais_id", dOutra.lote, "fk_stock_movements_lote_animais"], ["area_id", dOutra.area, "fk_stock_movements_area"]];
    for (const [coluna, valor, fk] of casos) {
      const e = await erroDe(entrada(w, produto, "1", { extra: { [coluna]: valor } }));
      expect([coluna, e.code, e.constraint]).toEqual([coluna, "23503", fk]);
    }
  });

  it("Z2 no documento (gatilhos desligados: a FK sozinha), cada referência de outra organização é recusada pela FK composta; e a origem do item também", async () => {
    const casos: [Dim, string][] = [["centro", "fk_documentos_estoque_centro_custo"], ["equipamento", "fk_documentos_estoque_equipamento"],
      ["os", "fk_documentos_estoque_ordem_servico"], ["lote", "fk_documentos_estoque_lote_animais"], ["area", "fk_documentos_estoque_area"], ["safra", "fk_documentos_estoque_safra"]];
    for (const [dim, fk] of casos) {
      const e = await semGatilhos((q) => erroDe(inserirCab(q, { especie: "requisicao", destino: { [dim]: dOutra[dim] } })));
      expect([dim, e.code, e.constraint]).toEqual([dim, "23503", fk]);
    }
    // PREMISSA: as da organização passam do mesmo jeito.
    await semGatilhos((q) => inserirCab(q, { especie: "requisicao", destino: dA }));
    const outraReq = await withTx(db, { orgId: outraOrg, userId: null }, async (tx) => {
      const r = await inserirCab(tx, { org: outraOrg, empresa: empresaOutraOrg, armazem: wOutraOrg, especie: "requisicao" });
      return { r, i: await inserirItem(tx, r, { org: outraOrg, especie: "requisicao", produto: produtoOutraOrg }) };
    });
    const origem = await semGatilhos((q) => erroDe(inserirCab(q, { especie: "consumo", origem: outraReq.r })));
    expect([origem.code, origem.constraint]).toEqual(["23503", "fk_documentos_estoque_origem"]);
    const itemOrigem = await semGatilhos(async (q) => {
      const k = await inserirCab(q, { especie: "consumo" });
      return erroDe(inserirItem(q, k, { especie: "consumo", origem: outraReq.i }));
    });
    expect([itemOrigem.code, itemOrigem.constraint]).toEqual(["23503", "fk_documentos_estoque_itens_origem"]);
  });
});

describe("layout", () => {
  it("L1 o CHECK de família do layout aceita as sete de estoque (na 0041 recusava — DB-5.1) e recusa a família inexistente", async () => {
    for (const familia of Object.values(FAMILIA)) {
      seq += 1;
      await expect(db.query("insert into erp.layouts_documento (organization_id, code, nome, familia, estrutura) values ($1,$2,$3,$4,'{}')",
        [demo.orgId, `T43-L${seq}`, `Layout 0043 ${seq}`, familia])).resolves.toMatchObject({ rowCount: 1 });
    }
    const e = await erroDe(db.query("insert into erp.layouts_documento (organization_id, code, nome, familia, estrutura) values ($1,'T43-LX','Layout 0043 X','estoque.inexistente','{}')", [demo.orgId]));
    expect([e.code, e.constraint]).toEqual(["23514", "chk_layouts_documento_familia"]);
  });
});
