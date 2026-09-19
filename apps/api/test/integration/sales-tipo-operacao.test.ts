import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * O PRIMEIRO LANÇAMENTO REAL COM TOP CADASTRADA (TOP-CONFIG-02).
 *
 * O que este arquivo precisa provar não é "o campo salva". É a CADEIA inteira, e cada elo dela é uma coisa
 * que, quebrada, ficaria invisível:
 *
 *   1. a TOP escolhida tem de ser da FAMÍLIA da variante — orçamento não aceita TOP de venda;
 *   2. a versão é CONGELADA na escrita, e renomear a TOP depois NÃO reescreve o documento;
 *   3. salvar outro campo não re-carimba o snapshot com a versão de hoje;
 *   4. a conversão escolhe a TOP do DESTINO e nunca herda a da fonte;
 *   5. TOP alvo inválida não deixa a fonte pela metade;
 *   6. documento legado (null) continua nascendo, listando, abrindo e confirmando;
 *   7. inexistente, de outro tenant, de outra família, inativa e excluída caem TODAS no mesmo 422.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
beforeAll(async () => { h = await harness(); I = await ids(h); }, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string } };

const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
type Variante = keyof typeof ROTA;

/** Códigos distintos por caso: a unicidade da TOP é por organização e a suíte compartilha uma. */
let seq = 0;
const codigo = () => `9${String(++seq).padStart(3, "0")}`;

/** Cadastra uma TOP configurada pela API administrativa e devolve o id. */
async function cadastrarTop(codigoBase: string, nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(), payload: { codigo: codigo(), codigoBase, nome, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

async function criar(kind: Variante, payload: Record<string, unknown> = {}, headers: Hdr = h.headers()) {
  return h.app.inject({
    method: "POST", url: `/api/sales/${ROTA[kind]}`, headers,
    payload: { empresa_id: I.empresa, document_date: "2026-09-01", client_id: I.client,
      items: [{ product_id: I.product, warehouse_id: I.warehouse, quantity: "2", unit_price: "50.00" }], ...payload }
  });
}
const detalhe = (kind: Variante, id: string, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/${id}`, headers });
const topDoDocumento = async (kind: Variante, id: string) =>
  j(await detalhe(kind, id)).tipo_operacao as { id: string; codigo: string; nome: string; versao: number; codigoBase: string } | null;

/** Estado persistido, lido FORA da rota: uma recusa que gravasse metade responderia igual a uma limpa. */
async function colunas(id: string): Promise<{ tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null; status: string }> {
  const c = createPool(TEST_URL, { max: 1 });
  try {
    return (await c.query<{ tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null; status: string }>(
      "select tipo_operacao_id, tipo_operacao_versao_id, status from erp.sales_documents where id=$1", [id])).rows[0]!;
  } finally { await c.end(); }
}

describe("TOP no lançamento — família canônica", () => {
  it("cada variante aceita a TOP da SUA família e devolve o snapshot", async () => {
    const casos: [Variante, string][] = [["budget", "vendas.orcamento"], ["order", "vendas.pedido"], ["sale", "vendas.venda"]];
    for (const [kind, familia] of casos) {
      const top = await cadastrarTop(familia, `TOP de ${kind}`);
      const r = await criar(kind, { tipo_operacao_id: top });
      expect(r.statusCode, r.body).toBe(201);
      const snap = await topDoDocumento(kind, j(r).id as string);
      expect(snap, `${kind} precisa trazer o snapshot`).toMatchObject({ id: top, versao: 1, codigoBase: familia });
    }
  }, 120_000);

  it("TOP da família VIZINHA é recusada — e a recusa não grava nada", async () => {
    // O caso que a FK do banco NÃO pega: (tenant, parentesco) estão certos; o que está errado é a família.
    const topDeVenda = await cadastrarTop("vendas.venda", "Venda que não serve para orçamento");
    const r = await criar("budget", { tipo_operacao_id: topDeVenda });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_INDISPONIVEL");
    const lista = j(await h.app.inject({ method: "GET", url: `/api/sales/budgets?tipo_operacao_id=${topDeVenda}`, headers: h.headers() }));
    expect(lista.total, "recusa não deixa rastro").toBe(0);
  }, 120_000);

  it("MESMA superfície de recusa para os cinco motivos — nenhum deles é distinguível de fora", async () => {
    const inativa = await cadastrarTop("vendas.venda", "Inativa", { ativo: false });

    const excluida = await cadastrarTop("vendas.venda", "Para excluir");
    const rev = j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${excluida}`, headers: h.headers() })).revisao as number;
    expect((await h.app.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${excluida}?revisao=${rev}`, headers: h.headers() })).statusCode).toBe(200);

    const outraFamilia = await cadastrarTop("vendas.orcamento", "De orçamento");

    // Uma TOP REAL da organização B: o caso mais perigoso, porque o UUID existe de verdade.
    const adm = createPool(TEST_URL, { max: 1 });
    const o2 = await seedDemo(adm, { orgName: "[TEST] Org TOP vendas", adminEmail: "admin-topvendas@demo.local", adminPassword: "Demo@12345", slug: "orgtopvendas" }, () => {});
    await adm.end();
    const tokB = (j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-topvendas@demo.local", password: "Demo@12345" } })) as { token: string }).token;
    const B: Hdr = { authorization: `Bearer ${tokB}`, "x-org-id": o2.orgId };
    const rB = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: B, payload: { codigo: "8001", codigoBase: "vendas.venda", nome: "Só da organização B" } });
    expect(rB.statusCode, rB.body).toBe(201);
    const deOutroTenant = j(rB).id as string;

    const inexistente = "00000000-0000-0000-0000-000000000000";

    for (const [motivo, id] of [["inexistente", inexistente], ["outro tenant", deOutroTenant], ["outra família", outraFamilia], ["inativa", inativa], ["excluída", excluida]] as const) {
      const r = await criar("sale", { tipo_operacao_id: id });
      expect(r.statusCode, `${motivo}: ${r.body}`).toBe(422);
      expect(j(r).error!.code, motivo).toBe("TIPO_OPERACAO_INDISPONIVEL");
      // A MENSAGEM também é a mesma: um texto diferente por motivo seria o oráculo pela porta de trás.
      expect(j(r).error!.message, motivo).toBe("Tipo de operação indisponível para este lançamento");
    }
  }, 180_000);
});

describe("TOP no lançamento — o histórico não muda", () => {
  it("renomear a TOP cria a versão 2 e o documento ANTIGO continua na versão 1", async () => {
    const top = await cadastrarTop("vendas.venda", "Venda de Gado a Prazo");
    const venda = j(await criar("sale", { tipo_operacao_id: top })).id as string;
    expect(await topDoDocumento("sale", venda)).toMatchObject({ nome: "Venda de Gado a Prazo", versao: 1 });

    const rev = j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${top}`, headers: h.headers() })).revisao as number;
    expect((await h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${top}`, headers: h.headers(), payload: { nome: "Venda de Bovinos a Prazo", revisao: rev } })).statusCode).toBe(200);

    // A PREMISSA: a TOP realmente avançou para a versão 2.
    expect(j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${top}`, headers: h.headers() }))).toMatchObject({ nome: "Venda de Bovinos a Prazo", versao: 2 });
    // A CONCLUSÃO que importa: o documento não se mexeu.
    expect(await topDoDocumento("sale", venda), "o passado não é reescrito").toMatchObject({ nome: "Venda de Gado a Prazo", versao: 1 });

    // E uma venda NOVA nasce já na versão 2 — o congelamento é do instante do lançamento, não da TOP.
    const nova = j(await criar("sale", { tipo_operacao_id: top })).id as string;
    expect(await topDoDocumento("sale", nova)).toMatchObject({ nome: "Venda de Bovinos a Prazo", versao: 2 });
  }, 180_000);

  it("desativar e EXCLUIR a TOP não quebra o documento já lançado", async () => {
    const top = await cadastrarTop("vendas.venda", "Some depois");
    const venda = j(await criar("sale", { tipo_operacao_id: top })).id as string;

    const revisao = async () => j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${top}`, headers: h.headers() })).revisao as number;
    expect((await h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${top}`, headers: h.headers(), payload: { ativo: false, revisao: await revisao() } })).statusCode).toBe(200);
    expect(await topDoDocumento("sale", venda), "inativa não apaga o passado").toMatchObject({ nome: "Some depois", versao: 1 });

    expect((await h.app.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${top}?revisao=${await revisao()}`, headers: h.headers() })).statusCode).toBe(200);
    const r = await detalhe("sale", venda);
    expect(r.statusCode, "excluir a configuração não pode 404 o lançamento").toBe(200);
    expect(await topDoDocumento("sale", venda)).toMatchObject({ nome: "Some depois", versao: 1 });

    // Mas NOVO lançamento com ela já não passa: histórico legível ≠ TOP disponível.
    expect((await criar("sale", { tipo_operacao_id: top })).statusCode).toBe(422);
  }, 180_000);
});

describe("TOP no lançamento — edição preserva o snapshot", () => {
  const corpoEdicao = (extra: Record<string, unknown> = {}) => ({
    empresa_id: I.empresa, document_date: "2026-09-02", client_id: I.client,
    items: [{ product_id: I.product, warehouse_id: I.warehouse, quantity: "3", unit_price: "50.00" }], ...extra
  });

  it("PUT SEM o campo preserva a TOP — é o cliente antigo, e é o caso comum", async () => {
    const top = await cadastrarTop("vendas.venda", "Preservada");
    const venda = j(await criar("sale", { tipo_operacao_id: top })).id as string;
    const r = await h.app.inject({ method: "PUT", url: `/api/sales/sales/${venda}`, headers: h.headers(), payload: corpoEdicao() });
    expect(r.statusCode, r.body).toBe(200);
    expect(await topDoDocumento("sale", venda)).toMatchObject({ id: top, versao: 1 });
  }, 120_000);

  it("PUT com o MESMO id preserva a VERSÃO ANTIGA mesmo depois de a TOP ganhar versão nova", async () => {
    const top = await cadastrarTop("vendas.venda", "Nome v1");
    const venda = j(await criar("sale", { tipo_operacao_id: top })).id as string;
    const rev = j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${top}`, headers: h.headers() })).revisao as number;
    await h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${top}`, headers: h.headers(), payload: { nome: "Nome v2", revisao: rev } });

    // Reenviar a MESMA TOP não é trocar de TOP: não pode re-carimbar o documento com a versão de hoje.
    expect((await h.app.inject({ method: "PUT", url: `/api/sales/sales/${venda}`, headers: h.headers(), payload: corpoEdicao({ tipo_operacao_id: top }) })).statusCode).toBe(200);
    expect(await topDoDocumento("sale", venda), "salvar de novo não re-carimba").toMatchObject({ nome: "Nome v1", versao: 1 });
  }, 180_000);

  it("trocar para OUTRA TOP captura a versão corrente da nova, e o evento tem autor", async () => {
    const a = await cadastrarTop("vendas.venda", "Origem");
    const b = await cadastrarTop("vendas.venda", "Destino");
    const venda = j(await criar("sale", { tipo_operacao_id: a })).id as string;
    expect((await h.app.inject({ method: "PUT", url: `/api/sales/sales/${venda}`, headers: h.headers(), payload: corpoEdicao({ tipo_operacao_id: b }) })).statusCode).toBe(200);
    expect(await topDoDocumento("sale", venda)).toMatchObject({ id: b, nome: "Destino", versao: 1 });

    const c = createPool(TEST_URL, { max: 1 });
    try {
      const ev = await c.query<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
        "select before, after from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='operation_type_change'", [venda]);
      expect(ev.rowCount, "trocar a identidade do lançamento é evento próprio").toBe(1);
      expect(ev.rows[0]!.before).toMatchObject({ tipoOperacaoId: a });
      expect(ev.rows[0]!.after).toMatchObject({ tipoOperacaoId: b });
    } finally { await c.end(); }
  }, 180_000);

  it("documento LEGADO ganha snapshot quando o usuário escolhe uma TOP", async () => {
    const venda = j(await criar("sale")).id as string;
    expect(await colunas(venda)).toMatchObject({ tipo_operacao_id: null, tipo_operacao_versao_id: null });
    const top = await cadastrarTop("vendas.venda", "Anexada depois");
    expect((await h.app.inject({ method: "PUT", url: `/api/sales/sales/${venda}`, headers: h.headers(), payload: corpoEdicao({ tipo_operacao_id: top }) })).statusCode).toBe(200);
    expect(await topDoDocumento("sale", venda)).toMatchObject({ id: top, versao: 1 });
  }, 120_000);

  it("trocar para TOP de outra FAMÍLIA é recusado e o snapshot antigo permanece", async () => {
    const boa = await cadastrarTop("vendas.venda", "Correta");
    const errada = await cadastrarTop("vendas.orcamento", "De orçamento");
    const venda = j(await criar("sale", { tipo_operacao_id: boa })).id as string;
    const r = await h.app.inject({ method: "PUT", url: `/api/sales/sales/${venda}`, headers: h.headers(), payload: corpoEdicao({ tipo_operacao_id: errada }) });
    expect(r.statusCode).toBe(422);
    expect(await topDoDocumento("sale", venda), "recusa não tem efeito parcial").toMatchObject({ id: boa });
  }, 120_000);
});

describe("TOP no lançamento — compatibilidade de rolling deploy", () => {
  it("criação SEM o campo continua 201 e nasce legada — é a web antiga durante o deploy", async () => {
    const r = await criar("sale");
    expect(r.statusCode, r.body).toBe(201);
    expect(await colunas(j(r).id as string)).toMatchObject({ tipo_operacao_id: null, tipo_operacao_versao_id: null });
  }, 120_000);

  it("o servidor NÃO aplica o padrão da família quando o campo vem ausente", async () => {
    // Há uma TOP PADRÃO ativa da família, e ainda assim o documento nasce nulo: um cliente antigo não
    // declarou intenção, e atribuí-la em silêncio faria a mesma chamada significar coisas diferentes
    // conforme a configuração administrativa do dia.
    const padrao = await cadastrarTop("vendas.venda", "Padrão da família", { padrao: true });
    const r = await criar("sale");
    expect(r.statusCode).toBe(201);
    expect(await colunas(j(r).id as string), "default automático seria mudança silenciosa de semântica").toMatchObject({ tipo_operacao_id: null });
    // A PREMISSA: o padrão existe mesmo e o endpoint operacional o anuncia.
    const ops = j(await h.app.inject({ method: "GET", url: "/api/sales/sales/operation-types", headers: h.headers() }));
    expect(ops.defaultId).toBe(padrao);
  }, 120_000);

  // Os dois casos de confirmação usam item SEM armazém (`warehouse_id: null`, que o schema já aceita como
  // "sem estoque"): o que se mede aqui é que a TOP — presente ou ausente — NÃO alterou a confirmação, e o
  // caminho de estoque já é coberto pelas suítes de vendas existentes. Semear saldo só para reconfirmar o
  // que outro arquivo prova tornaria este teste mais lento sem provar nada novo.
  // FUNÇÃO, e não constante: `I` só existe depois do `beforeAll`, e uma constante no corpo do `describe`
  // é avaliada na CARGA do arquivo — antes disso.
  const semEstoque = () => ({ items: [{ product_id: I.product, warehouse_id: null, quantity: "2", unit_price: "50.00" }] });

  it("documento legado continua listando, abrindo e sendo confirmado", async () => {
    const venda = j(await criar("sale", semEstoque())).id as string;
    const d = j(await detalhe("sale", venda));
    expect(d.tipo_operacao, "legado responde null, não 404").toBeNull();
    const lista = j(await h.app.inject({ method: "GET", url: "/api/sales/sales?pageSize=100", headers: h.headers() }));
    expect((lista.items as { id: string }[]).some((x) => x.id === venda), "LEFT JOIN: legado não some da listagem").toBe(true);
    const conf = await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/confirm`, headers: h.headers() });
    expect(conf.statusCode, conf.body).toBe(200);
  }, 120_000);

  it("venda COM TOP confirma normalmente — a TOP não mudou nenhum efeito", async () => {
    const top = await cadastrarTop("vendas.venda", "Confirma igual");
    const venda = j(await criar("sale", { ...semEstoque(), tipo_operacao_id: top })).id as string;
    const conf = await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/confirm`, headers: h.headers() });
    expect(conf.statusCode, conf.body).toBe(200);
    expect((j(conf).title_ids as string[]).length, "os títulos continuam sendo gerados pelo serviço de vendas").toBeGreaterThan(0);
  }, 120_000);
});

describe("TOP no lançamento — endpoint operacional", () => {
  it("devolve só TOPs ATIVAS da família da variante, com o padrão primeiro", async () => {
    const familia = "vendas.pedido";
    const comum = await cadastrarTop(familia, "Pedido comum");
    const padrao = await cadastrarTop(familia, "Pedido padrão", { padrao: true });
    const inativa = await cadastrarTop(familia, "Pedido inativo", { ativo: false });
    const deOutra = await cadastrarTop("vendas.venda", "Venda não entra");

    const r = j(await h.app.inject({ method: "GET", url: "/api/sales/orders/operation-types", headers: h.headers() }));
    const ids = (r.items as { id: string }[]).map((x) => x.id);
    expect(ids).toContain(comum);
    expect(ids[0], "padrão primeiro").toBe(padrao);
    expect(ids).not.toContain(inativa);
    expect(ids).not.toContain(deOutra);
    expect(r.defaultId).toBe(padrao);
    expect(r.family).toMatchObject({ code: familia });
    expect(r.contractVersion, "o cliente distingue 'endpoint ausente' de 'formato outro'").toBe(1);
  }, 120_000);

  it("a capacidade exigida é a de LANÇAR, não a de administrar TOP", async () => {
    // Um vendedor sem `tipos_operacao.*` PRECISA conseguir escolher a TOP; se este endpoint pedisse a
    // capacidade administrativa, configurar tipos de operação passaria a ser pré-requisito para vender.
    const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: "Vendedor puro", permissions: ["sales.view", "sales.create", "sales.edit"] } });
    expect(papel.statusCode, papel.body).toBe(201);
    const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: "Vendedor", email: "vendedor.top@teste.com", password: "Vendedor@12345", role_id: j(papel).id } });
    expect(vinculo.statusCode, vinculo.body).toBe(201);
    const tok = (j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "vendedor.top@teste.com", password: "Vendedor@12345" } })) as { token: string }).token;
    const vendedor: Hdr = { authorization: `Bearer ${tok}`, "x-org-id": h.demo.orgId };

    expect((await h.app.inject({ method: "GET", url: "/api/sales/sales/operation-types", headers: vendedor })).statusCode, "o vendedor enxerga as TOPs de venda").toBe(200);
    // E continua SEM a porta administrativa: são perguntas diferentes.
    expect((await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao", headers: vendedor })).statusCode).toBe(403);
    // E sem capacidade de criar ORÇAMENTO, não enxerga as TOPs de orçamento.
    expect((await h.app.inject({ method: "GET", url: "/api/sales/budgets/operation-types", headers: vendedor })).statusCode).toBe(403);
  }, 120_000);

  it("CROSS-TENANT: a organização B não enxerga as TOPs de A", async () => {
    await cadastrarTop("vendas.venda", "Só de A");
    const tok = (j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-topvendas@demo.local", password: "Demo@12345" } })) as { token: string }).token;
    const orgB = (await (async () => { const c = createPool(TEST_URL, { max: 1 }); try { return (await c.query<{ id: string }>("select id from erp.organizations where slug='orgtopvendas'")).rows[0]!.id; } finally { await c.end(); } })());
    const B: Hdr = { authorization: `Bearer ${tok}`, "x-org-id": orgB };
    const r = j(await h.app.inject({ method: "GET", url: "/api/sales/sales/operation-types", headers: B }));
    const nomes = (r.items as { name: string }[]).map((x) => x.name);
    expect(nomes).not.toContain("Só de A");
    // PREMISSA: B enxerga as PRÓPRIAS (criadas no caso da superfície de recusa).
    expect(nomes, "B vê o que é dela").toContain("Só da organização B");
  }, 120_000);
});

describe("TOP no lançamento — conversão escolhe a TOP do DESTINO", () => {
  const converter = (kind: "budget" | "order", id: string, body?: Record<string, unknown>) =>
    h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}/${id}/convert`, headers: h.headers(), payload: body ?? {} });

  it("orçamento → pedido: a TOP da fonte NÃO é herdada, e o destino grava a sua", async () => {
    const topOrcamento = await cadastrarTop("vendas.orcamento", "Orçamento padrão");
    const topPedido = await cadastrarTop("vendas.pedido", "Pedido especial");
    const orcamento = j(await criar("budget", { tipo_operacao_id: topOrcamento })).id as string;

    const r = await converter("budget", orcamento, { tipo_operacao_id: topPedido });
    expect(r.statusCode, r.body).toBe(201);
    const pedido = j(r).id as string;

    expect(await topDoDocumento("order", pedido), "o destino usa a TOP DELE").toMatchObject({ id: topPedido, nome: "Pedido especial" });
    expect(await topDoDocumento("budget", orcamento), "a fonte mantém a dela").toMatchObject({ id: topOrcamento });
  }, 180_000);

  it("pedido → venda: idem, com a família de venda", async () => {
    const topPedido = await cadastrarTop("vendas.pedido", "Pedido origem");
    const topVenda = await cadastrarTop("vendas.venda", "Venda destino");
    const pedido = j(await criar("order", { tipo_operacao_id: topPedido })).id as string;
    const r = await converter("order", pedido, { tipo_operacao_id: topVenda });
    expect(r.statusCode, r.body).toBe(201);
    expect(await topDoDocumento("sale", j(r).id as string)).toMatchObject({ id: topVenda, codigoBase: "vendas.venda" });
  }, 180_000);

  it("ATOMICIDADE: TOP alvo inválida não converte NADA — a fonte continua aberta", async () => {
    const topOrcamento = await cadastrarTop("vendas.orcamento", "Fonte intacta");
    const topDeVenda = await cadastrarTop("vendas.venda", "Família errada para pedido");
    const inativa = await cadastrarTop("vendas.pedido", "Pedido inativo alvo", { ativo: false });

    for (const [motivo, alvo] of [["família errada", topDeVenda], ["inativa", inativa], ["inexistente", "00000000-0000-0000-0000-000000000000"]] as const) {
      const orcamento = j(await criar("budget", { tipo_operacao_id: topOrcamento })).id as string;
      const antes = await colunas(orcamento);
      const r = await converter("budget", orcamento, { tipo_operacao_id: alvo });
      expect(r.statusCode, `${motivo}: ${r.body}`).toBe(422);
      expect(j(r).error!.code, motivo).toBe("TIPO_OPERACAO_INDISPONIVEL");
      // A prova que importa: a fonte NÃO virou `converted`, e nenhum destino nasceu.
      const depois = await colunas(orcamento);
      expect(depois.status, `${motivo}: a fonte não pode ter sido mutada`).toBe(antes.status);
      expect(depois.status).toBe("open");
      const c = createPool(TEST_URL, { max: 1 });
      try {
        const n = await c.query<{ n: string }>("select count(*) n from erp.sales_documents where origin_document_id=$1", [orcamento]);
        expect(Number(n.rows[0]!.n), `${motivo}: nenhum destino meio criado`).toBe(0);
      } finally { await c.end(); }
    }
  }, 240_000);

  it("conversão SEM corpo continua funcionando — cliente antigo, destino legado", async () => {
    const orcamento = j(await criar("budget")).id as string;
    const r = await converter("budget", orcamento);
    expect(r.statusCode, r.body).toBe(201);
    expect(await colunas(j(r).id as string)).toMatchObject({ tipo_operacao_id: null, tipo_operacao_versao_id: null });
  }, 120_000);
});

describe("TOP no lançamento — listagem", () => {
  it("traz o snapshot e filtra por TOP server-side, sem sumir com o legado", async () => {
    const top = await cadastrarTop("vendas.venda", "Filtrável");
    const comTop = j(await criar("sale", { tipo_operacao_id: top })).id as string;
    const legado = j(await criar("sale")).id as string;

    const filtrada = j(await h.app.inject({ method: "GET", url: `/api/sales/sales?tipo_operacao_id=${top}&pageSize=100`, headers: h.headers() }));
    const ids = (filtrada.items as { id: string; tipo_operacao: unknown }[]).map((x) => x.id);
    expect(ids).toContain(comTop);
    expect(ids, "o filtro é server-side e exclui quem não tem a TOP").not.toContain(legado);
    expect((filtrada.items as { tipo_operacao: { codigo: string } }[])[0]!.tipo_operacao).toMatchObject({ versao: 1 });

    // Sem filtro, os dois aparecem — e o legado com a TOP nula.
    const todas = j(await h.app.inject({ method: "GET", url: "/api/sales/sales?pageSize=100", headers: h.headers() }));
    const linhaLegada = (todas.items as { id: string; tipo_operacao: unknown }[]).find((x) => x.id === legado);
    expect(linhaLegada, "legado continua listado").toBeTruthy();
    expect(linhaLegada!.tipo_operacao).toBeNull();
  }, 180_000);

  it("TOP desativada depois NÃO faz o documento sumir do filtro", async () => {
    const top = await cadastrarTop("vendas.venda", "Desativa depois");
    const venda = j(await criar("sale", { tipo_operacao_id: top })).id as string;
    const rev = j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${top}`, headers: h.headers() })).revisao as number;
    await h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${top}`, headers: h.headers(), payload: { ativo: false, revisao: rev } });

    const r = j(await h.app.inject({ method: "GET", url: `/api/sales/sales?tipo_operacao_id=${top}&pageSize=100`, headers: h.headers() }));
    expect((r.items as { id: string }[]).map((x) => x.id), "o filtro é pelo ponteiro gravado, não pelo estado atual").toContain(venda);
  }, 180_000);
});
