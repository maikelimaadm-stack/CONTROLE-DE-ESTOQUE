import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@agro/db";
import {
  MATRIZ_EXECUCAO_TOP,
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  type ConfiguracaoTipoOperacaoV2,
  type ModoExecucaoTop,
} from "@agro/domain";
import { appCom, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * A CLASSIFICAÇÃO FINANCEIRA DO DOCUMENTO DE VENDA (VENDAS-A1).
 *
 * O DEFEITO FECHADO. Até aqui toda venda confirmada classificava o título a receber pela PRIMEIRA categoria de
 * receita analítica e pelo PRIMEIRO centro de custo analítico da organização, pela ordem do código. Agora o
 * documento guarda um PAR (`categoria_financeira_id`, `centro_custo_id`), e a confirmação usa o par DELE.
 *
 * NOMES DOS CASOS. `A1-C1`…`A1-C12`, `A1-P1` e `A1-D4` são os da missão. O prefixo existe porque outros
 * arquivos de venda já usam C1…C8 para outras matrizes.
 *
 * DUAS INSTÂNCIAS DA API sobre o mesmo banco, como em `sales-top-execucao.test.ts`: `h.app` com o gate da
 * execução configurada DESLIGADO (o padrão de produção) e `ligada` com `TOP_EFFECTS_RUNTIME_V1_ENABLED=1` —
 * o único jeito de exercitar o "a receber" CONFIGURADO, que é o quarto caminho do título.
 *
 * O QUE CONTA COMO PROVA. As asserções decisivas são CONTAGENS e LINHAS no banco, lidas por conexão própria:
 * documentos, títulos, RATEIOS (`erp.title_apportionments` — é lá que a categoria e o centro do título moram),
 * movimentos e trilha. Toda asserção de "zero efeito" vem com a PREMISSA ao lado: o mesmo cenário, corrigido,
 * produz o efeito — senão "zero" poderia ser só um cenário que nunca funcionaria.
 *
 * "PRIMEIRA POR CÓDIGO" DIFERENTE DA DO DOCUMENTO. Se a classificação do documento coincidisse com a que o
 * recuo legado escolheria, um binário que IGNORASSE o documento passaria em todos os casos. Por isso a
 * classificação dos documentos daqui mora em códigos `9.*` (depois de todo o seed) e o C7 ainda cria um par
 * `0.*` que passa a ser o primeiro da organização — a diferença é conferida como premissa, não suposta.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let formaPagamento: string;
let outraOrg: string;
/** A classificação "padrão" dos documentos deste arquivo: ativa, analítica, de receita, fora do topo da ordem. */
let CAT: string; let CC: string;
beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  formaPagamento = await comPool(async (c) => (await c.query<{ id: string }>("select id from erp.payment_methods where organization_id=$1 or organization_id is null order by name limit 1", [h.demo.orgId])).rows[0]!.id);
  const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "500", unit_value: "10" } });
  expect(r.statusCode, r.body).toBe(201);
  // A organização VIZINHA: cadastro dela nunca pode classificar documento desta (nem revelar que existe).
  outraOrg = await comPool(async (c) => (await c.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Org vizinha A1','orgvizinhaa1') returning id")).rows[0]!.id);
  CAT = await categoria("9.A1.001", { nome: "Receita classificada A1" });
  CC = await centro("9.A1.001", { nome: "Centro classificado A1" });
}, 180_000);
afterAll(async () => { await ligada?.close(); await h.app.close(); await h.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
const VENDA = MATRIZ_EXECUCAO_TOP[0]!.familia;
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
type Variante = keyof typeof ROTA;

const MSG_CATEGORIA = "Natureza inválida para venda: escolha uma natureza analítica de receita, ativa";
const MSG_CENTRO = "Centro de resultado inválido para venda: escolha um centro de resultado analítico, ativo";
const MSG_PAR = "Informe a natureza e o centro de resultado juntos";
const recusa = (campo: string, message: string): Erro => ({ code: "VALIDATION_ERROR", message, details: [{ path: campo, message }] });

async function comPool<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return await fn(c); } finally { await c.end(); }
}

/** Cadastro montado como o superusuário de teste monta cenário — cada variante recusável é uma linha real. */
async function categoria(code: string, o: { nome?: string; nature?: string; kind?: string; ativo?: boolean; excluida?: boolean; org?: string } = {}): Promise<string> {
  return comPool(async (c) => (await c.query<{ id: string }>(
    "insert into erp.financial_categories(organization_id,code,name,nature,kind,is_active,deleted_at) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [o.org ?? h.demo.orgId, code, o.nome ?? `Categoria ${code}`, o.nature ?? "income", o.kind ?? "analytic", o.ativo ?? true, o.excluida ? new Date() : null])).rows[0]!.id);
}
async function centro(code: string, o: { nome?: string; kind?: string; ativo?: boolean; excluido?: boolean; org?: string } = {}): Promise<string> {
  return comPool(async (c) => (await c.query<{ id: string }>(
    "insert into erp.cost_centers(organization_id,code,name,kind,is_active,deleted_at) values ($1,$2,$3,$4,$5,$6) returning id",
    [o.org ?? h.demo.orgId, code, o.nome ?? `Centro ${code}`, o.kind ?? "analytic", o.ativo ?? true, o.excluido ? new Date() : null])).rows[0]!.id);
}
const alterarCadastro = (tabela: "financial_categories" | "cost_centers", id: string, set: "is_active=false" | "is_active=true" | "deleted_at=now()" | "deleted_at=null") =>
  comPool((c) => c.query(`update erp.${tabela} set ${set} where id=$1`, [id]));
/** O que o recuo legado escolheria HOJE — a mesma consulta de `confirmSale`. */
const primeiraPorCodigo = () => comPool(async (c) => ({
  cat: (await c.query<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and nature='income' and kind='analytic' and deleted_at is null order by code limit 1", [h.demo.orgId])).rows[0]!.id,
  cc: (await c.query<{ id: string }>("select id from erp.cost_centers where organization_id=$1 and kind='analytic' and deleted_at is null order by code limit 1", [h.demo.orgId])).rows[0]!.id,
}));

const classificacaoGravada = (id: string) => comPool(async (c) => (await c.query<{ categoria_financeira_id: string | null; centro_custo_id: string | null; status: string; note: string | null }>(
  "select categoria_financeira_id, centro_custo_id, status, note from erp.sales_documents where id=$1", [id])).rows[0]!);
const documentosDaOrg = () => comPool(async (c) => Number((await c.query<{ n: string }>("select count(*)::text n from erp.sales_documents where organization_id=$1", [h.demo.orgId])).rows[0]!.n));
const rateiosDe = (id: string) => comPool(async (c) => (await c.query<{ financial_category_id: string; cost_center_id: string; percentage: string }>(
  "select a.financial_category_id, a.cost_center_id, a.percentage::text from erp.title_apportionments a join erp.financial_titles t on t.id=a.title_id where t.source_type='sales_documents' and t.source_id=$1 order by t.installment_number", [id])).rows);

/** Tudo o que a confirmação materializa ou o cancelamento estorna, contado no banco. */
async function efeitos(id: string) {
  return comPool(async (c) => {
    const doc = (await c.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!;
    const mov = (await c.query<{ movement_type: string; direction: number; quantity: string }>(
      "select movement_type, direction, quantity from erp.stock_movements where source_type='sales_documents' and source_id=$1 order by created_at", [id])).rows;
    const tit = (await c.query<{ status: string }>("select status from erp.financial_titles where source_type='sales_documents' and source_id=$1 order by created_at", [id])).rows;
    const aud = (await c.query<{ action: string; metadata: Record<string, unknown> | null }>(
      "select action, metadata from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action in ('confirm','cancel') order by created_at, id", [id])).rows;
    return {
      status: doc.status,
      saidas: mov.filter((m) => m.movement_type === "sale").length,
      estornos: mov.filter((m) => m.movement_type === "reversal").length,
      liquido: mov.reduce((a, m) => a + Number(m.quantity) * m.direction, 0),
      titulos: tit.length,
      titulosAtivos: tit.filter((t) => t.status !== "cancelled").length,
      confirmacao: aud.find((a) => a.action === "confirm")?.metadata ?? null,
      auditorias: aud.length,
    };
  });
}

let seq = 0;
const codigoTop = () => `27${String(++seq).padStart(2, "0")}`;
type Eixo = "legado" | "nenhum" | "efeito";
const configuracaoDe = (estoque: Eixo, financeiro: Eixo) => {
  const c: ConfiguracaoTipoOperacaoV2 = configuracaoNeutraTopV2();
  c.execucao = { estoque: (estoque === "legado" ? "legado" : "configurada") as ModoExecucaoTop, financeiro: (financeiro === "legado" ? "legado" : "configurada") as ModoExecucaoTop };
  if (estoque === "efeito") c.estoque.atualizacao = "saida";
  if (financeiro === "efeito") c.financeiro.atualizacao = "receber";
  return c;
};
/** TOP de venda com a configuração pedida — pela instância com o gate LIGADO, como a porta exige. */
async function top(configuracao: unknown): Promise<string> {
  const r = await ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: codigoTop(), codigoBase: VENDA, nome: "TOP da venda A1", configuracao } });
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}

const ITEM = () => ({ product_id: I.product2!, warehouse_id: I.warehouse! as string | null, quantity: "1", unit_price: "50.00" });
const corpoBase = (extra: Record<string, unknown> = {}) => ({ empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items: [ITEM()], ...extra });
const par = (cat: string, cc: string) => ({ categoria_financeira_id: cat, centro_custo_id: cc });
const criar = (kind: Variante, extra: Record<string, unknown> = {}) =>
  h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers: h.headers(), payload: corpoBase(extra) });
async function documento(kind: Variante, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await criar(kind, extra);
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const editar = (kind: Variante, id: string, extra: Record<string, unknown>) =>
  h.app.inject({ method: "PUT", url: `/api/sales/${ROTA[kind]}/${id}`, headers: h.headers(), payload: corpoBase(extra) });
const converter = (kind: "budget" | "order", id: string) =>
  h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}/${id}/convert`, headers: h.headers(), payload: {} });
const confirmar = (app: FastifyInstance, id: string) => app.inject({ method: "POST", url: `/api/sales/sales/${id}/confirm`, headers: h.headers() });
const cancelar = (app: FastifyInstance, id: string) => app.inject({ method: "POST", url: `/api/sales/sales/${id}/cancel`, headers: h.headers(), payload: {} });
async function confirmada(app: FastifyInstance, id: string) {
  const r = await confirmar(app, id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as { title_ids: string[] };
}

// ---------------------------------------------------------------------------------------------------
// CRIAÇÃO E LEITURA
// ---------------------------------------------------------------------------------------------------
describe("criação — o par nasce validado, ou o documento nasce sem classificação", () => {
  it("A1-C1 criação classificada → 201; o GET devolve ids, códigos e nomes; o banco guarda o par", async () => {
    const id = await documento("sale", par(CAT, CC));
    expect(await classificacaoGravada(id)).toMatchObject({ categoria_financeira_id: CAT, centro_custo_id: CC });
    const g = j(await h.app.inject({ method: "GET", url: `/api/sales/sales/${id}`, headers: h.headers() }));
    expect(g).toMatchObject({
      categoria_financeira_id: CAT, categoria_financeira_codigo: "9.A1.001", categoria_financeira_nome: "Receita classificada A1",
      centro_custo_id: CC, centro_custo_codigo: "9.A1.001", centro_custo_nome: "Centro classificado A1",
    });
  });

  it("A1-C2 categoria recusada com o MESMO 422 e a MESMA mensagem em toda variante — e nada gravado", async () => {
    // Cada variante é uma linha REAL (salvo a inexistente): a recusa não pode depender de a linha faltar.
    const variantes: [string, string][] = [
      ["inexistente", "00000000-0000-4000-8000-00000000a1c2"],
      ["de outra organização", await categoria("9.A1.C2.1", { org: outraOrg })],
      ["sintética", await categoria("9.A1.C2.2", { kind: "synthetic" })],
      ["de despesa", await categoria("9.A1.C2.3", { nature: "expense" })],
      ["ambas", await categoria("9.A1.C2.4", { nature: "both" })],
      ["inativa", await categoria("9.A1.C2.5", { ativo: false })],
      ["excluída", await categoria("9.A1.C2.6", { excluida: true })],
    ];
    const antes = await documentosDaOrg();
    const corpos = new Set<string>();
    for (const [motivo, cat] of variantes) {
      const r = await criar("sale", par(cat, CC));
      expect(r.statusCode, `${motivo}: ${r.body}`).toBe(422);
      expect(j(r).error, motivo).toEqual(recusa("categoria_financeira_id", MSG_CATEGORIA));
      corpos.add(JSON.stringify(j(r)));
    }
    // SEM ORÁCULO: o corpo inteiro é UM só — nada distingue "não existe" de "é da vizinha" de "está inativa".
    expect(corpos.size).toBe(1);
    expect(await documentosDaOrg(), "nenhuma recusa gravou documento").toBe(antes);
    // A premissa: o mesmo corpo com a categoria válida grava — a recusa era a categoria.
    await documento("sale", par(CAT, CC));
    expect(await documentosDaOrg()).toBe(antes + 1);
  });

  it("A1-C3 centro recusado do mesmo jeito: inexistente · de outra organização · sintético · inativo · excluído", async () => {
    const variantes: [string, string][] = [
      ["inexistente", "00000000-0000-4000-8000-00000000a1c3"],
      ["de outra organização", await centro("9.A1.C3.1", { org: outraOrg })],
      ["sintético", await centro("9.A1.C3.2", { kind: "synthetic" })],
      ["inativo", await centro("9.A1.C3.3", { ativo: false })],
      ["excluído", await centro("9.A1.C3.4", { excluido: true })],
    ];
    const antes = await documentosDaOrg();
    const corpos = new Set<string>();
    for (const [motivo, cc] of variantes) {
      const r = await criar("sale", par(CAT, cc));
      expect(r.statusCode, `${motivo}: ${r.body}`).toBe(422);
      expect(j(r).error, motivo).toEqual(recusa("centro_custo_id", MSG_CENTRO));
      corpos.add(JSON.stringify(j(r)));
    }
    expect(corpos.size).toBe(1);
    expect(await documentosDaOrg(), "nenhuma recusa gravou documento").toBe(antes);
    await documento("sale", par(CAT, CC));
    expect(await documentosDaOrg()).toBe(antes + 1);
  });

  it("A1-C4 criação sem os campos (cliente anterior) → 201, os dois nulos; null explícito também", async () => {
    const semCampos = await documento("sale");
    expect(await classificacaoGravada(semCampos)).toMatchObject({ categoria_financeira_id: null, centro_custo_id: null });
    const nulos = await documento("sale", { categoria_financeira_id: null, centro_custo_id: null });
    expect(await classificacaoGravada(nulos)).toMatchObject({ categoria_financeira_id: null, centro_custo_id: null });
  });

  it("A1-C12 par incompleto no RESULTADO → 422; no documento classificado, um campo só troca só aquele", async () => {
    const antes = await documentosDaOrg();
    // Criação com um só: o que falta é o campo apontado.
    const soCat = await criar("sale", { categoria_financeira_id: CAT });
    expect(soCat.statusCode, soCat.body).toBe(422);
    expect(j(soCat).error).toEqual(recusa("centro_custo_id", MSG_PAR));
    const soCc = await criar("sale", { centro_custo_id: CC });
    expect(soCc.statusCode, soCc.body).toBe(422);
    expect(j(soCc).error).toEqual(recusa("categoria_financeira_id", MSG_PAR));
    expect(await documentosDaOrg()).toBe(antes);

    // Edição de documento SEM classificação enviando só um: o resultado seria meio par.
    const sem = await documento("sale");
    const r = await editar("sale", sem, { categoria_financeira_id: CAT, note: "não pode gravar" });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual(recusa("centro_custo_id", MSG_PAR));
    expect(await classificacaoGravada(sem)).toMatchObject({ categoria_financeira_id: null, centro_custo_id: null, note: null });

    // Edição de documento CLASSIFICADO enviando só o centro: o resultado é par completo (a categoria é preservada).
    const cc2 = await centro("9.A1.C12.1");
    const com = await documento("sale", par(CAT, CC));
    const t = await editar("sale", com, { centro_custo_id: cc2 });
    expect(t.statusCode, t.body).toBe(200);
    expect(await classificacaoGravada(com)).toMatchObject({ categoria_financeira_id: CAT, centro_custo_id: cc2 });
  });
});

// ---------------------------------------------------------------------------------------------------
// EDIÇÃO — a mesma semântica de `tipo_operacao_id`
// ---------------------------------------------------------------------------------------------------
describe("A1-C5 edição — ausente preserva, presente valida, null não remove", () => {
  it("A1-C5 ausente preserva · outro par válido troca · par igual mas inativado → 422 · null em classificado → 422 · null em sem classificação → no-op", async () => {
    const id = await documento("sale", par(CAT, CC));

    // AUSENTE → preserva (cliente anterior e read-modify-write de quem não conhece o campo).
    let r = await editar("sale", id, { note: "ausente preserva" });
    expect(r.statusCode, r.body).toBe(200);
    expect(await classificacaoGravada(id)).toMatchObject({ categoria_financeira_id: CAT, centro_custo_id: CC, note: "ausente preserva" });

    // OUTRO par válido → troca.
    const cat2 = await categoria("9.A1.C5.1"); const cc2 = await centro("9.A1.C5.1");
    r = await editar("sale", id, { ...par(cat2, cc2), note: "trocou" });
    expect(r.statusCode, r.body).toBe(200);
    expect(await classificacaoGravada(id)).toMatchObject({ categoria_financeira_id: cat2, centro_custo_id: cc2, note: "trocou" });

    // O MESMO par gravado, mas a categoria foi inativada: valor presente é validado, mesmo igual ao gravado.
    await alterarCadastro("financial_categories", cat2, "is_active=false");
    r = await editar("sale", id, { ...par(cat2, cc2), note: "não pode gravar" });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual(recusa("categoria_financeira_id", MSG_CATEGORIA));
    expect(await classificacaoGravada(id)).toMatchObject({ categoria_financeira_id: cat2, centro_custo_id: cc2, note: "trocou" });

    // null EXPLÍCITO em documento classificado → 422 e NADA muda (nem a observação que viajou junto).
    for (const campo of ["categoria_financeira_id", "centro_custo_id"] as const) {
      r = await editar("sale", id, { [campo]: null, note: "não pode gravar" });
      expect(r.statusCode, `${campo}: ${r.body}`).toBe(422);
      expect(j(r).error!.code).toBe("VALIDATION_ERROR");
      expect(j(r).error!.details).toEqual([{ path: campo, message: "A classificação não pode ser removida; informe outra ou omita o campo" }]);
      expect(await classificacaoGravada(id)).toMatchObject({ categoria_financeira_id: cat2, centro_custo_id: cc2, note: "trocou" });
    }

    // null em documento SEM classificação → é o estado atual (o GET o devolveu assim): 200, sem mudança.
    const sem = await documento("sale");
    r = await editar("sale", sem, { categoria_financeira_id: null, centro_custo_id: null, note: "no-op" });
    expect(r.statusCode, r.body).toBe(200);
    expect(await classificacaoGravada(sem)).toMatchObject({ categoria_financeira_id: null, centro_custo_id: null, note: "no-op" });
  });
});

// ---------------------------------------------------------------------------------------------------
// CONVERSÃO
// ---------------------------------------------------------------------------------------------------
describe("A1-C6 conversão — copia o par, pela mesma porta", () => {
  it("A1-C6 orçamento → pedido → venda carrega o par; com a categoria da ORIGEM inativada → 422 e nada converte", async () => {
    const orcamento = await documento("budget", par(CAT, CC));
    const rp = await converter("budget", orcamento);
    expect(rp.statusCode, rp.body).toBe(201);
    const pedido = j(rp).id as string;
    expect(await classificacaoGravada(pedido)).toMatchObject({ categoria_financeira_id: CAT, centro_custo_id: CC });
    const rv = await converter("order", pedido);
    expect(rv.statusCode, rv.body).toBe(201);
    expect(await classificacaoGravada(j(rv).id as string)).toMatchObject({ categoria_financeira_id: CAT, centro_custo_id: CC });

    // A ORIGEM deixou de valer depois de salva.
    const cat3 = await categoria("9.A1.C6.1");
    const origem = await documento("budget", par(cat3, CC));
    await alterarCadastro("financial_categories", cat3, "is_active=false");
    const r = await converter("budget", origem);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe("VALIDATION_ERROR");
    expect(j(r).error!.message).toMatch(/documento de origem/);
    expect(j(r).error!.details).toEqual([{ path: "categoria_financeira_id", message: j(r).error!.message }]);
    const estado = await comPool(async (c) => ({
      status: (await c.query<{ status: string }>("select status from erp.sales_documents where id=$1", [origem])).rows[0]!.status,
      derivados: Number((await c.query<{ n: string }>("select count(*)::text n from erp.sales_documents where origin_document_id=$1", [origem])).rows[0]!.n),
      conversoes: Number((await c.query<{ n: string }>("select count(*)::text n from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='convert'", [origem])).rows[0]!.n),
    }));
    expect(estado).toEqual({ status: "open", derivados: 0, conversoes: 0 });
    // A premissa: reativada a categoria, a MESMA origem converte e o derivado nasce com o par.
    await alterarCadastro("financial_categories", cat3, "is_active=true");
    const ok = await converter("budget", origem);
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await classificacaoGravada(j(ok).id as string)).toMatchObject({ categoria_financeira_id: cat3, centro_custo_id: CC });
  });
});

// ---------------------------------------------------------------------------------------------------
// CONFIRMAÇÃO
// ---------------------------------------------------------------------------------------------------
describe("confirmação — o título leva a classificação DO DOCUMENTO", () => {
  it("A1-C7 com a 'primeira por código' DIFERENTE da do documento, o rateio usa a do documento — nos quatro caminhos", async () => {
    // Duas categorias de receita analíticas e dois centros analíticos: um par no TOPO da ordem (o que o recuo
    // escolheria) e o par do documento no fim.
    const catPrimeira = await categoria("0.A1.C7.1"); const ccPrimeiro = await centro("0.A1.C7.1");
    const catDoc = await categoria("9.A1.C7.1"); const ccDoc = await centro("9.A1.C7.1");
    expect(await primeiraPorCodigo(), "premissa: o recuo escolheria OUTRO par").toEqual({ cat: catPrimeira, cc: ccPrimeiro });

    const caminhos: { nome: string; topId: string | null; app: FastifyInstance; financeiro: string }[] = [
      { nome: "sem TOP", topId: null, app: h.app, financeiro: "legado" },
      { nome: "TOP formato 1", topId: await top(configuracaoNeutraTop()), app: h.app, financeiro: "legado" },
      { nome: "TOP formato 2 legado", topId: await top(configuracaoDe("legado", "legado")), app: h.app, financeiro: "legado" },
      { nome: "TOP formato 2 a receber (gate ligado)", topId: await top(configuracaoDe("efeito", "efeito")), app: ligada, financeiro: "configurada:receber" },
    ];
    for (const c of caminhos) {
      const id = await documento("sale", { ...par(catDoc, ccDoc), ...(c.topId ? { tipo_operacao_id: c.topId } : {}) });
      const r = await confirmada(c.app, id);
      expect(r.title_ids.length, c.nome).toBe(1);
      expect(await rateiosDe(id), c.nome).toEqual([{ financial_category_id: catDoc, cost_center_id: ccDoc, percentage: "100.0000" }]);
      const e = await efeitos(id);
      expect(e.confirmacao, c.nome).toMatchObject({
        execucao: { financeiro: c.financeiro },
        classificacaoFinanceira: { categoriaFinanceiraId: catDoc, centroCustoId: ccDoc, origem: "documento" },
      });
    }
  });

  it("A1-C8 venda SEM classificação: recuo idêntico ao de hoje, e a auditoria diz 'padrão legado' com os ids usados", async () => {
    const recuo = await primeiraPorCodigo();
    const id = await documento("sale");
    await confirmada(h.app, id);
    expect(await rateiosDe(id)).toEqual([{ financial_category_id: recuo.cat, cost_center_id: recuo.cc, percentage: "100.0000" }]);
    expect((await efeitos(id)).confirmacao).toMatchObject({ classificacaoFinanceira: { categoriaFinanceiraId: recuo.cat, centroCustoId: recuo.cc, origem: "padrão legado" } });
  });

  describe("A1-C9 classificação que deixou de valer depois de salva → 422 acionável e ZERO efeito", () => {
    const casos: { nome: string; tabela: "financial_categories" | "cost_centers"; quebra: "is_active=false" | "deleted_at=now()"; conserta: "is_active=true" | "deleted_at=null"; campo: string }[] = [
      { nome: "categoria inativada", tabela: "financial_categories", quebra: "is_active=false", conserta: "is_active=true", campo: "categoria_financeira_id" },
      { nome: "categoria excluída", tabela: "financial_categories", quebra: "deleted_at=now()", conserta: "deleted_at=null", campo: "categoria_financeira_id" },
      { nome: "centro inativado", tabela: "cost_centers", quebra: "is_active=false", conserta: "is_active=true", campo: "centro_custo_id" },
      { nome: "centro excluído", tabela: "cost_centers", quebra: "deleted_at=now()", conserta: "deleted_at=null", campo: "centro_custo_id" },
    ];
    for (const [n, c] of casos.entries()) {
      it(`A1-C9 ${c.nome}`, async () => {
        const cat = await categoria(`9.A1.C9.${n}`); const cc = await centro(`9.A1.C9.${n}`);
        const id = await documento("sale", par(cat, cc));
        await alterarCadastro(c.tabela, c.tabela === "financial_categories" ? cat : cc, c.quebra);
        const r = await confirmar(h.app, id);
        expect(r.statusCode, r.body).toBe(422);
        expect(j(r).error!.code).toBe("VALIDATION_ERROR");
        expect(j(r).error!.message).toMatch(/Reative-a no cadastro ou cancele a venda/);
        expect((j(r).error!.details as { path: string }[])[0]!.path).toBe(c.campo);
        // NUNCA recua para a "primeira por código": nenhum movimento, nenhum título, status intacto, sem trilha.
        expect(await efeitos(id)).toMatchObject({ status: "open", saidas: 0, titulos: 0, auditorias: 0 });
        // A premissa: consertado o cadastro, a MESMA venda confirma — com o par dela.
        await alterarCadastro(c.tabela, c.tabela === "financial_categories" ? cat : cc, c.conserta);
        await confirmada(h.app, id);
        expect(await efeitos(id)).toMatchObject({ status: "confirmed", saidas: 1, titulos: 1 });
        expect(await rateiosDe(id)).toEqual([{ financial_category_id: cat, cost_center_id: cc, percentage: "100.0000" }]);
      });
    }
  });

  it("A1-C10 formato 2 com financeiro 'nenhum' e a categoria do documento inativada → confirma sem título, sem exigir a classificação", async () => {
    const cat = await categoria("9.A1.C10.1");
    const semFinanceiro = await top(configuracaoDe("efeito", "nenhum"));
    const id = await documento("sale", { ...par(cat, CC), tipo_operacao_id: semFinanceiro });
    const comFinanceiro = await documento("sale", { ...par(cat, CC), tipo_operacao_id: await top(configuracaoDe("efeito", "efeito")) });
    await alterarCadastro("financial_categories", cat, "is_active=false");
    const r = await confirmada(ligada, id);
    expect(r.title_ids).toEqual([]);
    const e = await efeitos(id);
    expect([e.status, e.saidas, e.titulos]).toEqual(["confirmed", 1, 0]);
    // Sem título, a auditoria não afirma classificação nenhuma.
    expect(e.confirmacao).not.toHaveProperty("classificacaoFinanceira");
    // A premissa: no mesmo estado do cadastro, uma venda que GERA título é recusada — é a categoria inativa.
    expect((await confirmar(ligada, comFinanceiro)).statusCode).toBe(422);
    expect(await efeitos(comFinanceiro)).toMatchObject({ status: "open", saidas: 0, titulos: 0 });
  });

  it("A1-C11 cancelamento de venda classificada confirmada → estorno e títulos cancelados, como hoje", async () => {
    const id = await documento("sale", par(CAT, CC));
    await confirmada(h.app, id);
    expect(await efeitos(id), "premissa: havia o que estornar").toMatchObject({ saidas: 1, titulos: 1, titulosAtivos: 1 });
    const r = await cancelar(h.app, id);
    expect(r.statusCode, r.body).toBe(200);
    const e = await efeitos(id);
    expect([e.status, e.saidas, e.estornos, e.liquido, e.titulos, e.titulosAtivos]).toEqual(["cancelled", 1, 1, 0, 1, 0]);
  });
});

// ---------------------------------------------------------------------------------------------------
// DESCOBERTA DE CAPACIDADE
// ---------------------------------------------------------------------------------------------------
describe("A1-D4 descoberta — a capacidade é ADITIVA, e o contrato continua na versão 1", () => {
  for (const kind of ["budget", "order", "sale"] as const) {
    it(`A1-D4 operation-types de ${ROTA[kind]}: contractVersion 1 e capacidades.classificacaoFinanceira === 1`, async () => {
      const r = await h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/operation-types`, headers: h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      const b = j(r);
      // A web da base compara `contractVersion` EXATO: mudar para 2 bloquearia a escrita dela.
      expect(b.contractVersion).toBe(1);
      // VENDAS-A4 (decisão 258): a capacidade da condição de pagamento entra DEPOIS; a comparação continua EXATA
      // VENDAS-A3-1 (decisão 259): a capacidade do layout do documento entra por ÚLTIMO, também aditiva; a comparação
      // continua EXATA para que qualquer chave nova (ou sumida) continue reprovando aqui.
      expect(b.capacidades).toEqual({ classificacaoFinanceira: 1, condicaoPagamento: 1, layoutDocumento: 1 });
    });
  }
});

// ---------------------------------------------------------------------------------------------------
// PARIDADE CAMPO A CAMPO — o documento classificado nas quatro referências da 04A-P
// ---------------------------------------------------------------------------------------------------

/** A LINHA INTEIRA, com número em TEXTO (mesmo molde de `sales-top-execucao.test.ts`). `alias` é literal. */
const LINHA = (alias: string) =>
  `(select jsonb_object_agg(e.key, case jsonb_typeof(e.value) when 'number' then to_jsonb(e.value #>> '{}') else e.value end) from jsonb_each(to_jsonb(${alias})) e)`;
type Linha = Record<string, unknown>;
const linhas = async (c: Db, sql: string, p: unknown[]) => (await c.query<{ linha: Linha }>(sql, p)).rows.map((r) => r.linha);
const sem = (l: Linha, fora: readonly string[]) => Object.fromEntries(Object.entries(l).filter(([k]) => !fora.includes(k)));

async function capturarConfirmacao(docId: string) {
  return comPool(async (c) => {
    const p = [h.demo.orgId, docId];
    const [documento] = await linhas(c, `select ${LINHA("d")} as linha from erp.sales_documents d where d.organization_id=$1 and d.id=$2`, p);
    return {
      documento: documento!,
      movimentos: await linhas(c, `select ${LINHA("m")} as linha from erp.stock_movements m where m.organization_id=$1 and m.source_type='sales_documents' and m.source_id=$2 and m.movement_type='sale' order by m.warehouse_id, m.product_id`, p),
      titulos: await linhas(c, `select ${LINHA("t")} as linha from erp.financial_titles t where t.organization_id=$1 and t.source_type='sales_documents' and t.source_id=$2 order by t.installment_number`, p),
      rateios: await linhas(c, `select ${LINHA("a")} as linha from erp.title_apportionments a join erp.financial_titles t on t.id=a.title_id where t.organization_id=$1 and t.source_type='sales_documents' and t.source_id=$2 order by t.installment_number`, p),
      confirmacao: (await c.query<{ metadata: Record<string, unknown> }>("select metadata from erp.audit_logs where organization_id=$1 and entity='sales_documents' and entity_id=$2 and action='confirm'", p)).rows[0]!.metadata,
    };
  });
}

/**
 * O QUE PODE DIFERIR entre as referências (lista fechada, a mesma da 04A-P): relógio, ids aleatórios, o
 * código do documento (e o `number`/`note` do título que o carregam), o contador do título, o `group_id` das
 * parcelas, e — POR DESENHO — a TOP citada e a execução decidida, conferidas à parte. A CLASSIFICAÇÃO NÃO está
 * na lista: ela é igual nas quatro, no documento, no rateio e na trilha.
 */
function normalizar(cf: Awaited<ReturnType<typeof capturarConfirmacao>>) {
  const codigo = String(cf.documento.code);
  const grupo = cf.titulos[0]?.group_id ?? null;
  const { tipoOperacaoVersaoId: _v, execucao: _e, titles: _t, movimentos: _m, ...resto } = cf.confirmacao;
  return {
    documento: sem(cf.documento, ["id", "code", "created_at", "updated_at", "tipo_operacao_id", "tipo_operacao_versao_id"]),
    movimentos: cf.movimentos.map((m) => sem(m, ["id", "created_at", "source_id", "note"])),
    titulos: cf.titulos.map((t) => ({ ...sem(t, ["id", "created_at", "updated_at", "source_id"]),
      code: Number(t.code) - Number(cf.titulos[0]!.code),
      number: String(t.number).replace(`VND-${codigo}`, "VND-<COD>"), note: String(t.note).replace(`Venda ${codigo}`, "Venda <COD>"),
      group_id: t.group_id === null ? null : t.group_id === grupo ? "<GRUPO>" : t.group_id })),
    rateios: cf.rateios.map((a) => sem(a, ["id", "title_id"])),
    confirmacao: resto,
  };
}

describe("A1-P1 — paridade: o documento classificado grava o MESMO nas quatro referências da 04A-P", () => {
  it("A1-P1 sem TOP ≡ formato 1 ≡ formato 2 legado ≡ formato 2 configurado, e o rateio é a classificação do documento", async () => {
    const catDoc = await categoria("9.A1.P1.1"); const ccDoc = await centro("9.A1.P1.1");
    const recuo = await primeiraPorCodigo();
    expect([recuo.cat, recuo.cc], "premissa: o recuo escolheria OUTRO par").not.toEqual([catDoc, ccDoc]);
    expect(recuo.cat).not.toBe(catDoc); expect(recuo.cc).not.toBe(ccDoc);

    const referencias = [
      { nome: "sem TOP", topId: null as string | null, app: h.app },
      { nome: "TOP formato 1", topId: await top(configuracaoNeutraTop()), app: h.app },
      { nome: "TOP formato 2 legado/legado", topId: await top(configuracaoDe("legado", "legado")), app: h.app },
      { nome: "TOP formato 2 saída + a receber", topId: await top(configuracaoDe("efeito", "efeito")), app: ligada },
    ];
    // O cenário 04A-P1 (parcelado com entrada): 4 títulos, cada um com o seu rateio.
    const corpo = () => ({ ...par(catDoc, ccDoc), shipping_date: "2026-09-12", due_date: "2026-10-05", payment_method_id: formaPagamento, freight: "10.00", discount: "3.33", is_deductible: true,
      installment_plan: { installments: 3, first_due_date: "2026-10-10", mode: "interval", interval_days: 30, has_down_payment: true, down_payment_value: "20.00", down_payment_date: "2026-09-12" } });
    const capturas: { nome: string; topId: string | null; cf: Awaited<ReturnType<typeof capturarConfirmacao>> }[] = [];
    for (const ref of referencias) {
      const id = await documento("sale", { ...corpo(), ...(ref.topId ? { tipo_operacao_id: ref.topId } : {}) });
      await confirmada(ref.app, id);
      capturas.push({ nome: ref.nome, topId: ref.topId, cf: await capturarConfirmacao(id) });
      // Devolve o estoque ao ponto de partida: saldo após e custo entram CRUS na comparação.
      const rc = await cancelar(h.app, id);
      expect(rc.statusCode, `${ref.nome}: ${rc.body}`).toBe(200);
    }
    const base = capturas[0]!;
    // PREMISSAS — "igual" não pode ser "igualmente vazio".
    expect(base.cf.movimentos).toHaveLength(1);
    expect(base.cf.titulos).toHaveLength(4);
    expect(base.cf.rateios).toHaveLength(4);
    const esperado = normalizar(base.cf);
    for (const { nome, topId, cf } of capturas) {
      // O rateio é a classificação DO DOCUMENTO, em cada parcela, em cada referência.
      for (const a of cf.rateios) expect([a.financial_category_id, a.cost_center_id], nome).toEqual([catDoc, ccDoc]);
      expect(cf.documento.categoria_financeira_id, nome).toBe(catDoc);
      expect(cf.documento.centro_custo_id, nome).toBe(ccDoc);
      expect(cf.confirmacao.classificacaoFinanceira, nome).toEqual({ categoriaFinanceiraId: catDoc, centroCustoId: ccDoc, origem: "documento" });
      expect(cf.documento.tipo_operacao_id ?? null, nome).toBe(topId);
      expect(normalizar(cf), nome).toEqual(esperado);
    }
  }, 180_000);
});
