import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db, type Tx, type TenantContext } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O QUE A 0036 PROMETEU, PROVADO CONTRA O BANCO (COMPRAS-01, decisão 267).
 *
 * erp.documentos_compra (pedido de compra e compra) e erp.documentos_compra_itens: CHECKs por espécie, FKs
 * compostas (outra organização recusada), gatilhos (parceiros, TOP da família, transição de situação, item só com
 * documento aberto), unicidade da nota, RLS (cabeçalho pela empresa no módulo compras; item herda), sem DELETE
 * para o papel da API e auditoria por erp.audit_row.
 *
 * Duas conexões: `db` (superusuário, monta o cenário e lê o catálogo) e `app` (papel da aplicação, SEM bypass de
 * RLS, com as GUCs da transação — o caminho que a API percorre).
 */
let db: Db; let app: Db; let demo: DemoOrg;
let A: string; let B: string;
let fornecedor: string; let naoFornecedor: string; let fornecedorExcluido: string; let transportadora: string;
let produto: string; let armazemA: string; let armazemB: string;
let categoria: string; let centro: string;
let topCompra: Top; let topPedido: Top; let topVenda: Top;
let outraOrg: string; let empresaOutraOrg: string; let fornecedorOutraOrg: string; let topOutraOrg: Top; let produtoOutraOrg: string;
let usuarioEscopoA: string;

interface Top { top: string; versao: string }

const ctxCompras = (userId?: string): TenantContext => ({ orgId: demo.orgId, userId: userId ?? demo.adminUserId, modulo: "compras" });

let seq = 0;
const id1 = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;

async function pessoa(org: string, papeis: { provider?: boolean; transporter?: boolean; client?: boolean }, excluida = false): Promise<string> {
  seq += 1;
  return id1(`insert into erp.people (organization_id, code, name, is_provider, is_transporter, is_client, deleted_at)
              values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [org, `CO01-${seq}`, `[TEST] Parceiro compras ${seq}`, Boolean(papeis.provider), Boolean(papeis.transporter), Boolean(papeis.client), excluida ? new Date() : null]);
}
async function criarTop(org: string, codigoBase: string): Promise<Top> {
  seq += 1;
  // TOP e versão na MESMA transação: a FK da versão atual é adiada até o commit.
  return withTx(db, { orgId: org, userId: null }, async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id", [org, `CO${seq}`, codigoBase])).rows[0]!.id;
    const versao = (await tx.query<{ id: string }>("insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,1,$3) returning id", [org, top, `TOP compras ${seq}`])).rows[0]!.id;
    return { top, versao };
  });
}

type Doc = Partial<{ org: string; empresa: string; especie: "pedido" | "compra"; situacao: string; top: Top; fornecedor: string; transportadora: string | null;
  numero: string | null; serie: string | null; dataEntrada: string | null; categoria: string | null; centro: string | null; frete: string; forma: string | null }>;

/** INSERT do cabeçalho (via `q`: superusuário ou tx da aplicação). */
async function inserirDoc(q: { query: Db["query"] } | Tx, o: Doc = {}): Promise<string> {
  seq += 1;
  const especie = o.especie ?? "compra";
  const top = o.top ?? (especie === "compra" ? topCompra : topPedido);
  const r = await (q as Tx).query<{ id: string }>(
    `insert into erp.documentos_compra (organization_id, empresa_id, especie, codigo, situacao, tipo_operacao_id, tipo_operacao_versao_id,
       fornecedor_id, transportadora_id, data_documento, data_entrada, numero_nota, serie_nota, categoria_financeira_id, centro_custo_id, frete, forma_pagamento_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-09-01',$10,$11,$12,$13,$14,$15,$16) returning id`,
    [o.org ?? demo.orgId, o.empresa ?? A, especie, `C${seq}`, o.situacao ?? "aberto", top.top, top.versao, o.fornecedor ?? fornecedor,
     o.transportadora ?? null, o.dataEntrada ?? null, o.numero ?? null, o.serie ?? null, o.categoria ?? null, o.centro ?? null, o.frete ?? "0", o.forma ?? null]);
  return r.rows[0]!.id;
}
const doc = (o: Doc = {}) => inserirDoc(db, o);
async function item(documento: string, o: Partial<{ produto: string; armazem: string | null; lote: string | null; validade: string | null; org: string }> = {}) {
  return id1(`insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, armazem_id, quantidade, valor_unitario, valor_total, lote, validade, posicao)
              values ($1,$2,$3,$4,2,10,20,$5,$6,0) returning id`,
    [o.org ?? demo.orgId, documento, o.produto ?? produto, o.armazem === undefined ? armazemA : o.armazem, o.lote ?? null, o.validade ?? null]);
}
const situacao = (id: string, s: string) => db.query("update erp.documentos_compra set situacao=$2 where id=$1", [id, s]);

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
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; constraint?: string; message: string }; }
  throw new Error("esperava recusa, e o banco aceitou");
}

beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 4 });
  const empresas = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code", [demo.orgId])).rows;
  A = empresas[0]!.id; B = empresas[1]!.id;
  fornecedor = await pessoa(demo.orgId, { provider: true });
  naoFornecedor = await pessoa(demo.orgId, { client: true });
  fornecedorExcluido = await pessoa(demo.orgId, { provider: true }, true);
  transportadora = await pessoa(demo.orgId, { transporter: true });
  produto = await id1("select id from erp.products where organization_id=$1 and controle_lote='nenhum' order by code limit 1", [demo.orgId]);
  armazemA = await id1("insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,'COA','Armazem compras A') returning id", [demo.orgId, A]);
  armazemB = await id1("insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,'COB','Armazem compras B') returning id", [demo.orgId, B]);
  categoria = await id1("select id from erp.financial_categories where organization_id=$1 order by code limit 1", [demo.orgId]);
  centro = await id1("select id from erp.cost_centers where organization_id=$1 order by code limit 1", [demo.orgId]);
  topCompra = await criarTop(demo.orgId, "compras.compra");
  topPedido = await criarTop(demo.orgId, "compras.pedido");
  topVenda = await criarTop(demo.orgId, "vendas.venda");

  outraOrg = await id1("insert into erp.organizations (name, slug) values ('[TEST] Outra compras','outra-compras') returning id");
  fornecedorOutraOrg = await pessoa(outraOrg, { provider: true });
  topOutraOrg = await criarTop(outraOrg, "compras.compra");
  produtoOutraOrg = await id1(
    `insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, control_stock)
     select $1, 'CO01-P', '[TEST] Produto outra org', measurement_id, group_id, category_id, false from erp.products where id=$2 returning id`, [outraOrg, produto]);
  empresaOutraOrg = await id1("insert into erp.empresas (organization_id, code, name) values ($1, 91, '[TEST] Empresa outra org compras') returning id", [outraOrg]);

  // Membro com escopo SELECIONADAS = [A] no módulo compras (e nada nos outros módulos: fail-closed).
  usuarioEscopoA = await id1("insert into erp.users (email, name, password_hash) values ('compras-a@demo.local','Compras A','x') returning id");
  const membro = await id1("insert into erp.organization_members (organization_id, user_id, is_owner, is_active) values ($1,$2,false,true) returning id", [demo.orgId, usuarioEscopoA]);
  await db.query("insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) values ($1,$2,'compras','selecionadas')", [demo.orgId, membro]);
  await db.query("insert into erp.membro_empresas (organization_id, membro_id, modulo, modo, empresa_id) values ($1,$2,'compras','selecionadas',$3)", [demo.orgId, membro, A]);
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

describe("premissas do cenário", () => {
  it("duas empresas, parceiros com os papéis certos, TOPs das famílias certas, membro com escopo só em A", async () => {
    expect(A).not.toBe(B);
    const p = (await db.query<{ id: string; is_provider: boolean; is_transporter: boolean; excl: boolean }>(
      "select id, is_provider, is_transporter, deleted_at is not null as excl from erp.people where id = any($1)", [[fornecedor, naoFornecedor, fornecedorExcluido, transportadora]])).rows;
    const por = new Map(p.map((x) => [x.id, x]));
    expect(por.get(fornecedor)).toMatchObject({ is_provider: true, excl: false });
    expect(por.get(naoFornecedor)).toMatchObject({ is_provider: false, is_transporter: false });
    expect(por.get(fornecedorExcluido)).toMatchObject({ is_provider: true, excl: true });
    expect(por.get(transportadora)).toMatchObject({ is_transporter: true, is_provider: false });
    const w = (await db.query<{ empresa_id: string }>("select empresa_id from erp.warehouses where id = any($1) order by initials", [[armazemA, armazemB]])).rows;
    expect(w.map((x) => x.empresa_id)).toEqual([A, B]);
    expect(produtoOutraOrg, "produto da outra organização criado").not.toBe("");
    const escopo = (await db.query<{ empresa_id: string }>("select me.empresa_id from erp.membro_empresas me join erp.organization_members m on m.id = me.membro_id where m.user_id=$1 and me.modulo='compras'", [usuarioEscopoA])).rows;
    expect(escopo.map((x) => x.empresa_id)).toEqual([A]);
  });

  it("a migration registrou as tabelas com RLS forçada, as políticas e os gatilhos prometidos", async () => {
    const rls = (await db.query<{ relname: string; r: boolean; f: boolean }>(
      "select relname, relrowsecurity r, relforcerowsecurity f from pg_class where oid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass) order by relname")).rows;
    expect(rls).toEqual([{ relname: "documentos_compra", r: true, f: true }, { relname: "documentos_compra_itens", r: true, f: true }]);
    const pol = (await db.query<{ tablename: string; policyname: string; cmd: string }>(
      "select tablename, policyname, cmd from pg_policies where schemaname='erp' and tablename like 'documentos_compra%' order by tablename")).rows;
    expect(pol).toEqual([{ tablename: "documentos_compra", policyname: "tenant_e_empresa", cmd: "ALL" }, { tablename: "documentos_compra_itens", policyname: "api_child", cmd: "ALL" }]);
    const trg = (await db.query<{ tgname: string }>(
      "select tgname from pg_trigger where tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass) and not tgisinternal and tgenabled='O' order by tgname")).rows.map((x) => x.tgname);
    expect(trg).toEqual(["trg_documentos_compra_audit", "trg_documentos_compra_conferir", "trg_documentos_compra_itens_documento_aberto", "trg_documentos_compra_transicao"]);
    expect((await db.query("select 1 from pg_constraint where conname='uq_warehouses_tenant' and contype='u'")).rowCount).toBe(1);
  });
});

describe("CHECKs por espécie (gatilhos desligados: o CHECK sozinho)", () => {
  const check = async (o: Doc) => (await erroDe(semGatilhos((q) => inserirDoc(q, o)))).constraint;
  it("o cenário válido passa com os gatilhos desligados (contraprova)", async () => {
    await expect(semGatilhos((q) => inserirDoc(q, { especie: "compra", situacao: "confirmado", numero: "1" }))).resolves.toBeTruthy();
  });
  it("pedido nunca é confirmado", async () => {
    expect(await check({ especie: "pedido", situacao: "confirmado" })).toBe("chk_documentos_compra_situacao_especie");
  });
  it("espécie e situação fora do domínio", async () => {
    expect(await check({ especie: "venda" as "compra" })).toBe("chk_documentos_compra_especie");
    expect(await check({ situacao: "aprovado" })).toBe("chk_documentos_compra_situacao");
  });
  it("pedido não tem nota, série nem data de entrada", async () => {
    expect(await check({ especie: "pedido", numero: "10" })).toBe("chk_documentos_compra_campos_da_compra");
    expect(await check({ especie: "pedido", dataEntrada: "2026-09-02" })).toBe("chk_documentos_compra_campos_da_compra");
  });
  it("série sem número e número em branco são recusados", async () => {
    expect(await check({ serie: "2" })).toBe("chk_documentos_compra_nota");
    expect(await check({ numero: "  " })).toBe("chk_documentos_compra_nota");
  });
  it("natureza e centro andam em par; valores não são negativos", async () => {
    expect(await check({ categoria })).toBe("chk_documentos_compra_classificacao_par");
    expect(await check({ centro })).toBe("chk_documentos_compra_classificacao_par");
    expect(await check({ frete: "-1" })).toBe("chk_documentos_compra_frete");
    await expect(doc({ categoria, centro })).resolves.toBeTruthy();
  });
  it("item: quantidade > 0", async () => {
    const d = await doc();
    const e = await erroDe(db.query("insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, quantidade, posicao) values ($1,$2,$3,0,0)", [demo.orgId, d, produto]));
    expect(e.constraint).toBe("chk_documentos_compra_itens_quantidade");
  });
});

describe("FKs compostas: referência de OUTRA organização é recusada", () => {
  it("fornecedor, TOP e empresa de outra organização", async () => {
    expect((await erroDe(doc({ fornecedor: fornecedorOutraOrg }))).message).toMatch(/Fornecedor/);
    // gatilhos desligados: é a FK que recusa, não a conferência do gatilho
    expect((await erroDe(semGatilhos((q) => inserirDoc(q, { fornecedor: fornecedorOutraOrg })))).constraint).toBe("fk_documentos_compra_fornecedor");
    expect((await erroDe(semGatilhos((q) => inserirDoc(q, { top: topOutraOrg })))).constraint).toBe("fk_documentos_compra_tipo_operacao");
    expect((await erroDe(semGatilhos((q) => inserirDoc(q, { empresa: empresaOutraOrg })))).constraint).toBe("fk_documentos_compra_empresa");
  });
  it("versão de OUTRA TOP é recusada pela FK de três colunas", async () => {
    const e = await erroDe(semGatilhos((q) => inserirDoc(q, { top: { top: topCompra.top, versao: topPedido.versao } })));
    expect(e.constraint).toBe("fk_documentos_compra_tipo_operacao_versao");
  });
  it("item com produto ou armazém de outra organização, e item com organização diferente da do documento", async () => {
    const d = await doc();
    expect((await erroDe(semGatilhos((q) => q.query(
      "insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, quantidade, posicao) values ($1,$2,$3,1,0)", [demo.orgId, d, produtoOutraOrg])))).constraint)
      .toBe("fk_documentos_compra_itens_produto");
    const wOutra = await id1("insert into erp.warehouses (organization_id, empresa_id, initials, description) select $1, id, 'COX', 'Armazem outra' from erp.empresas where organization_id=$1 limit 1 returning id", [outraOrg]);
    expect((await erroDe(semGatilhos((q) => q.query(
      "insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, armazem_id, quantidade, posicao) values ($1,$2,$3,$4,1,0)", [demo.orgId, d, produto, wOutra])))).constraint)
      .toBe("fk_documentos_compra_itens_armazem");
    expect((await erroDe(semGatilhos((q) => q.query(
      "insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, quantidade, posicao) values ($1,$2,$3,1,0)", [outraOrg, d, produtoOutraOrg])))).constraint)
      .toBe("fk_documentos_compra_itens_documento");
  });
});

describe("gatilho do cabeçalho: parceiros, família da TOP, forma de pagamento, nascimento aberto", () => {
  it("fornecedor precisa ser parceiro Fornecedor vivo", async () => {
    await expect(doc({ fornecedor })).resolves.toBeTruthy();
    expect((await erroDe(doc({ fornecedor: naoFornecedor }))).message).toMatch(/VALIDATION_ERROR: O fornecedor precisa ser um parceiro do tipo Fornecedor/);
    expect((await erroDe(doc({ fornecedor: fornecedorExcluido }))).message).toMatch(/tipo Fornecedor/);
  });
  it("trocar para um não fornecedor também é recusado; o documento com fornecedor depois excluído continua mudando de situação", async () => {
    const d = await doc();
    expect((await erroDe(db.query("update erp.documentos_compra set fornecedor_id=$2 where id=$1", [d, naoFornecedor]))).message).toMatch(/tipo Fornecedor/);
    const f = await pessoa(demo.orgId, { provider: true });
    const d2 = await doc({ fornecedor: f });
    await db.query("update erp.people set deleted_at=now() where id=$1", [f]);
    await expect(situacao(d2, "confirmado")).resolves.toBeTruthy();
  });
  it("transportadora precisa ser parceiro Transportadora", async () => {
    await expect(doc({ transportadora })).resolves.toBeTruthy();
    expect((await erroDe(doc({ transportadora: fornecedor }))).message).toMatch(/tipo Transportadora/);
  });
  it("a TOP precisa ser da família da espécie", async () => {
    expect((await erroDe(doc({ especie: "compra", top: topVenda }))).message).toMatch(/família do documento \(compras\.compra\)/);
    expect((await erroDe(doc({ especie: "compra", top: topPedido }))).message).toMatch(/compras\.compra/);
    expect((await erroDe(doc({ especie: "pedido", top: topCompra }))).message).toMatch(/compras\.pedido/);
    await expect(doc({ especie: "pedido", top: topPedido })).resolves.toBeTruthy();
  });
  it("forma de pagamento global é aceita; a de outra organização, recusada", async () => {
    const global = await id1("select id from erp.payment_methods where organization_id is null order by name limit 1");
    await expect(doc({ forma: global })).resolves.toBeTruthy();
    const outra = await id1("insert into erp.payment_methods (organization_id, name) values ($1, '[TEST] Forma outra org') returning id", [outraOrg]);
    expect((await erroDe(doc({ forma: outra }))).message).toMatch(/Forma de pagamento inválida/);
  });
  it("nasce aberto; espécie, empresa e código não mudam", async () => {
    expect((await erroDe(doc({ situacao: "confirmado" }))).message).toMatch(/nasce aberto/);
    const d = await doc();
    expect((await erroDe(db.query("update erp.documentos_compra set empresa_id=$2 where id=$1", [d, B]))).message).toMatch(/não mudam/);
    expect((await erroDe(db.query("update erp.documentos_compra set codigo='X' where id=$1", [d]))).message).toMatch(/não mudam/);
  });
});

describe("gatilho de transição de situação — a matriz inteira", () => {
  const casos: [("pedido" | "compra"), string[], string, boolean][] = [
    ["compra", [], "confirmado", true],
    ["compra", [], "cancelado", true],
    ["compra", ["confirmado"], "cancelado", true],
    ["compra", ["confirmado"], "aberto", false],
    ["compra", ["cancelado"], "aberto", false],
    ["compra", ["cancelado"], "confirmado", false],
    ["compra", ["confirmado", "cancelado"], "confirmado", false],
    ["compra", ["confirmado", "cancelado"], "aberto", false],
    ["pedido", [], "cancelado", true],
    ["pedido", [], "confirmado", false],
    ["pedido", ["cancelado"], "aberto", false]
  ];
  for (const [especie, caminho, destino, ok] of casos) {
    it(`${especie}: ${["aberto", ...caminho].join("→")} → ${destino} ${ok ? "PERMITIDA" : "RECUSADA"}`, async () => {
      const d = await doc({ especie });
      for (const s of caminho) await situacao(d, s);
      if (ok) {
        await situacao(d, destino);
        expect((await db.query<{ situacao: string }>("select situacao from erp.documentos_compra where id=$1", [d])).rows[0]!.situacao).toBe(destino);
      } else {
        const e = await erroDe(situacao(d, destino));
        expect(e.message).toMatch(/^CONFLICT: /);
      }
    });
  }
  it("mesma situação (update sem transição) passa e carimba atualizado_em", async () => {
    const d = await doc();
    const antes = (await db.query<{ t: Date }>("select atualizado_em t from erp.documentos_compra where id=$1", [d])).rows[0]!.t;
    await db.query("update erp.documentos_compra set situacao='aberto', observacao='x' where id=$1", [d]);
    const depois = (await db.query<{ t: Date }>("select atualizado_em t from erp.documentos_compra where id=$1", [d])).rows[0]!.t;
    expect(depois.getTime()).toBeGreaterThan(antes.getTime());
  });
});

describe("gatilho do item: só com documento aberto", () => {
  it("inclui, altera no aberto; recusa incluir/alterar/apagar no confirmado e no cancelado", async () => {
    const d = await doc();
    const i = await item(d);
    await db.query("update erp.documentos_compra_itens set quantidade=3 where id=$1", [i]);
    await situacao(d, "confirmado");
    expect((await erroDe(item(d))).message).toMatch(/^CONFLICT: Os itens só mudam com o documento de compra aberto \(situação: confirmado\)/);
    expect((await erroDe(db.query("update erp.documentos_compra_itens set quantidade=4 where id=$1", [i]))).message).toMatch(/^CONFLICT:/);
    expect((await erroDe(db.query("delete from erp.documentos_compra_itens where id=$1", [i]))).message).toMatch(/^CONFLICT:/);
    const p = await doc({ especie: "pedido" });
    await situacao(p, "cancelado");
    expect((await erroDe(item(p))).message).toMatch(/situação: cancelado/);
  });
  it("pedido não aceita lote nem validade; compra aceita", async () => {
    const p = await doc({ especie: "pedido" });
    expect((await erroDe(item(p, { lote: "L1" }))).message).toMatch(/Pedido de compra não tem lote/);
    expect((await erroDe(item(p, { validade: "2027-01-01" }))).message).toMatch(/Pedido de compra não tem lote/);
    await expect(item(await doc(), { lote: "L1", validade: "2027-01-01" })).resolves.toBeTruthy();
  });
  it("armazém precisa ser da empresa do documento; sem armazém passa", async () => {
    const d = await doc({ empresa: A });
    expect((await erroDe(item(d, { armazem: armazemB }))).message).toMatch(/empresa do documento/);
    await expect(item(d, { armazem: null })).resolves.toBeTruthy();
  });
  it("o item não muda de documento", async () => {
    const d = await doc(); const i = await item(d); const outro = await doc();
    expect((await erroDe(db.query("update erp.documentos_compra_itens set documento_id=$2 where id=$1", [i, outro]))).message).toMatch(/não muda de documento/);
  });
});

describe("R1: cabeçalho congelado fora do aberto; TOP, espécie e organização imutáveis", () => {
  const upd = (id: string, set: string, p: unknown[] = []) => db.query(`update erp.documentos_compra set ${set} where id=$1`, [id, ...p]);
  it("espécie e organização não mudam (nem aberto)", async () => {
    const d = await doc();
    expect((await erroDe(upd(d, "especie='pedido'"))).message).toMatch(/não mudam/);
    expect((await erroDe(upd(d, "organization_id=$2", [outraOrg]))).message).toMatch(/não mudam/);
  });
  it("TOP e versão não mudam nem com o documento aberto", async () => {
    const outra = await criarTop(demo.orgId, "compras.compra");
    const d = await doc();
    expect((await erroDe(upd(d, "tipo_operacao_id=$2, tipo_operacao_versao_id=$3", [outra.top, outra.versao]))).message).toMatch(/tipo de operação e a versão congelada/);
    const v2 = await withTx(db, { orgId: demo.orgId, userId: null }, async (tx) => (await tx.query<{ id: string }>(
      "insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome) values ($1,$2,2,'TOP compras v2') returning id", [demo.orgId, topCompra.top])).rows[0]!.id);
    expect((await erroDe(upd(d, "tipo_operacao_versao_id=$2", [v2]))).message).toMatch(/versão congelada/);
    // contraprova: aberto, o resto do cabeçalho muda
    const f = await pessoa(demo.orgId, { provider: true });
    await expect(upd(d, "fornecedor_id=$2, frete=5, valor_total=5, numero_nota='A1'", [f])).resolves.toMatchObject({ rowCount: 1 });
  });
  for (const destino of [["confirmado"], ["cancelado"], ["confirmado", "cancelado"]] as const) {
    it(`${destino.join("→")}: recusa mudar valor, fornecedor, nota e TOP; só a situação muda`, async () => {
      const d = await doc({ numero: `NF-FZ-${++seq}` });
      for (const s of destino) await situacao(d, s);
      const f = await pessoa(demo.orgId, { provider: true });
      const outra = await criarTop(demo.orgId, "compras.compra");
      for (const [set, p] of [
        ["frete=5, valor_total=5", []], ["observacao='x'", []], ["fornecedor_id=$2", [f]], ["numero_nota='OUTRA'", []],
        ["serie_nota='9'", []], ["data_documento='2026-09-02'", []]
      ] as [string, unknown[]][]) {
        expect((await erroDe(upd(d, set, p))).message, set).toMatch(/^CONFLICT: O documento de compra está (confirmado|cancelado); só a situação muda/);
      }
      expect((await erroDe(upd(d, "tipo_operacao_id=$2, tipo_operacao_versao_id=$3", [outra.top, outra.versao]))).message).toMatch(/versão congelada/);
      const r = (await db.query<{ fornecedor_id: string; frete: string }>("select fornecedor_id, frete from erp.documentos_compra where id=$1", [d])).rows[0]!;
      expect(r).toEqual({ fornecedor_id: fornecedor, frete: "0.00" });
    });
  }
  it("confirmado → cancelado continua passando (só a situação muda)", async () => {
    const d = await doc(); await situacao(d, "confirmado");
    await expect(situacao(d, "cancelado")).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("R1: CHECKs novos (gatilhos desligados: o CHECK sozinho)", () => {
  const chk = async (set: string) => (await erroDe(semGatilhos(async (q) => {
    const id = await inserirDoc(q);
    await q.query(`update erp.documentos_compra set ${set} where id=$1`, [id]);
  }))).constraint;
  it("valor_total = itens + frete + outras despesas − desconto", async () => {
    await expect(semGatilhos(async (q) => { const id = await inserirDoc(q);
      return q.query("update erp.documentos_compra set valor_itens=100, frete=15, outras_despesas=5, desconto=10, valor_total=110 where id=$1", [id]); }))
      .resolves.toMatchObject({ rowCount: 1 });
    expect(await chk("valor_itens=100, frete=15, outras_despesas=5, desconto=10, valor_total=120")).toBe("chk_documentos_compra_total_conferido");
    expect(await chk("valor_itens=100")).toBe("chk_documentos_compra_total_conferido");
  });
  it("número e série da nota sem espaço nas pontas", async () => {
    expect(await chk("numero_nota=' 12'")).toBe("chk_documentos_compra_nota");
    expect(await chk("numero_nota='12 '")).toBe("chk_documentos_compra_nota");
    expect(await chk("numero_nota='12', serie_nota=' 1'")).toBe("chk_documentos_compra_nota");
    await expect(semGatilhos(async (q) => { const id = await inserirDoc(q);
      return q.query("update erp.documentos_compra set numero_nota='12', serie_nota='' where id=$1", [id]); })).resolves.toMatchObject({ rowCount: 1 });
  });
  it("item: desconto percentual até 100; valor unitário com 6 casas", async () => {
    const d = await doc();
    const ins = (pct: string, vu = "10") => db.query(
      "insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, armazem_id, quantidade, valor_unitario, desconto_percentual, posicao) values ($1,$2,$3,$4,1,$5,$6,0) returning valor_unitario",
      [demo.orgId, d, produto, armazemA, vu, pct]);
    expect((await erroDe(ins("100.0001"))).constraint).toBe("chk_documentos_compra_itens_desconto_percentual");
    await expect(ins("100")).resolves.toMatchObject({ rowCount: 1 });
    expect((await ins("0", "0.333333")).rows[0]).toEqual({ valor_unitario: "0.333333" });
  });
});

describe("unicidade da nota do fornecedor", () => {
  it("mesma nota do mesmo fornecedor: série vazia, nula e '1' são a MESMA; outra série ou outro fornecedor passam", async () => {
    const n = `NF-${++seq}`;
    await doc({ numero: n, serie: null });
    expect((await erroDe(doc({ numero: n, serie: "" }))).constraint).toBe("ux_documentos_compra_nota");
    expect((await erroDe(doc({ numero: n, serie: "1" }))).constraint).toBe("ux_documentos_compra_nota");
    await expect(doc({ numero: n, serie: "2" })).resolves.toBeTruthy();
    const outroFornecedor = await pessoa(demo.orgId, { provider: true });
    await expect(doc({ numero: n, fornecedor: outroFornecedor })).resolves.toBeTruthy();
  });
  it("cancelar a compra libera a nota; confirmada continua ocupando", async () => {
    const n = `NF-${++seq}`;
    const d = await doc({ numero: n, serie: "3" });
    await situacao(d, "confirmado");
    expect((await erroDe(doc({ numero: n, serie: "3" }))).constraint).toBe("ux_documentos_compra_nota");
    await situacao(d, "cancelado");
    await expect(doc({ numero: n, serie: "3" })).resolves.toBeTruthy();
  });
});

describe("RLS sob o papel da aplicação", () => {
  let docA: string; let docB: string; let itemA: string; let itemB: string; let docOutraOrg: string;
  beforeAll(async () => {
    docA = await doc({ empresa: A }); itemA = await item(docA, { armazem: armazemA });
    docB = await doc({ empresa: B }); itemB = await item(docB, { armazem: armazemB });
    docOutraOrg = await doc({ org: outraOrg, empresa: empresaOutraOrg, fornecedor: fornecedorOutraOrg, top: topOutraOrg });
  });
  const ler = (ctx: TenantContext) => withTx(app, ctx, async (tx) => ({
    docs: (await tx.query<{ id: string }>("select id from erp.documentos_compra where id = any($1)", [[docA, docB, docOutraOrg]])).rows.map((r) => r.id).sort(),
    itens: (await tx.query<{ id: string }>("select id from erp.documentos_compra_itens where id = any($1)", [[itemA, itemB]])).rows.map((r) => r.id).sort()
  }));
  it("o proprietário, no módulo compras, vê as duas empresas da organização — e nunca a outra organização", async () => {
    const r = await ler(ctxCompras());
    expect(r.docs).toEqual([docA, docB].sort());
    expect(r.itens).toEqual([itemA, itemB].sort());
  });
  it("o membro com escopo [A] em compras vê só o documento de A, e o item HERDA o recorte", async () => {
    const r = await ler(ctxCompras(usuarioEscopoA));
    expect(r.docs).toEqual([docA]);
    expect(r.itens).toEqual([itemA]);
  });
  it("o mesmo membro em outro módulo (estoque, sem configuração) não vê nada — fail-closed", async () => {
    const r = await ler({ orgId: demo.orgId, userId: usuarioEscopoA, modulo: "estoque" });
    expect(r).toEqual({ docs: [], itens: [] });
  });
  it("o membro [A] não grava documento em B nem item em documento de B", async () => {
    expect((await erroDe(withTx(app, ctxCompras(usuarioEscopoA), (tx) => inserirDoc(tx, { empresa: B })))).code).toBe("42501");
    await expect(withTx(app, ctxCompras(usuarioEscopoA), (tx) => inserirDoc(tx, { empresa: A }))).resolves.toBeTruthy();
    expect((await erroDe(withTx(app, ctxCompras(usuarioEscopoA), (tx) => tx.query(
      "insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, quantidade, posicao) values ($1,$2,$3,1,0)", [demo.orgId, docB, produto])))).code).toBe("42501");
    const n = await withTx(app, ctxCompras(usuarioEscopoA), (tx) => tx.query("update erp.documentos_compra set observacao='x' where id=$1", [docB]));
    expect(n.rowCount, "UPDATE fora do escopo afeta zero linhas").toBe(0);
  });
  it("sem DELETE para o papel da aplicação, nas duas tabelas", async () => {
    expect((await erroDe(withTx(app, ctxCompras(), (tx) => tx.query("delete from erp.documentos_compra where id=$1", [docA])))).code).toBe("42501");
    expect((await erroDe(withTx(app, ctxCompras(), (tx) => tx.query("delete from erp.documentos_compra_itens where id=$1", [itemA])))).code).toBe("42501");
    const priv = (await db.query<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
      `select bool_and(has_table_privilege('erp_app', t, 'select')) s, bool_and(has_table_privilege('erp_app', t, 'insert')) i,
              bool_and(has_table_privilege('erp_app', t, 'update')) u, bool_or(has_table_privilege('erp_app', t, 'delete')) d
         from unnest(array['erp.documentos_compra','erp.documentos_compra_itens']) t`)).rows[0];
    expect(priv).toEqual({ s: true, i: true, u: true, d: false });
  });
});

describe("auditoria por erp.audit_row no cabeçalho", () => {
  it("criar e mudar de situação gravam create e update em erp.audit_logs, com o usuário da GUC", async () => {
    const d = await withTx(app, ctxCompras(), (tx) => inserirDoc(tx));
    await withTx(app, ctxCompras(), (tx) => tx.query("update erp.documentos_compra set situacao='cancelado' where id=$1", [d]));
    const r = (await db.query<{ action: string; user_id: string; depois: string | null }>(
      "select action, user_id, after->>'situacao' depois from erp.audit_logs where entity='documentos_compra' and entity_id=$1 order by id", [d])).rows;
    expect(r).toEqual([
      { action: "create", user_id: demo.adminUserId, depois: "aberto" },
      { action: "update", user_id: demo.adminUserId, depois: "cancelado" }
    ]);
  });
});
