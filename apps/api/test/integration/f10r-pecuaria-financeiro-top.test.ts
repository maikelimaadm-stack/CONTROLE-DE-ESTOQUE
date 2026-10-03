import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configuracaoNeutraTopV4, resolverTipoOperacao } from "@agro/domain";
import { f9, iniciarF9a, encerrarF9a, j, erro, DATA, linha, linhas, criarTopNo5, postarTop, titulosDaOrigem, usuario, type Hdr, type Resposta, type TopCriada } from "./f9a-ajuda.js";

/**
 * OPERACOES-01 F10r (decisão 287) — A PECUÁRIA SAI DO LEGADO: o título da compra e da venda de animais
 * (`POST /api/livestock/movements` com "Gerar financeiro") pela TOP PADRÃO da família.
 *
 * O movimento não grava TOP (a tabela não tem a coluna): vale a TOP padrão da família na organização, na versão
 * corrente — o molde da solicitação de compra. A ordem, só quando haverá título: o documento com natureza e centro →
 * os padrões da TOP (formato 5), CAMPO A CAMPO (o campo informado no documento nunca é descartado) → "exigir" sem o par
 * → 422 antes de qualquer gravação → sem TOP padrão, fora do 5 ou sem padrões: o código de hoje INTACTO (a natureza
 * "de animais" do tipo, senão a 1ª por código; o 1º centro por código; sem TOP no título — o contrato do skew,
 * sentido 2).
 *   · PF-1 sem TOP padrão = o legado intacto (e com a TOP padrão no 4, ou no 5 sem padrões, também — com o documento
 *          vazio E com natureza e centro informados: a TOP que não age não entra no título nem na trilha);
 *   · PF-2 TOP padrão com padrões → natureza, centro, tipo de título, conta, TOP e versão no título (compra e venda;
 *          a família da compra não vaza para a venda); o membro só de pecuária lança com a conta da TOP;
 *   · PF-3 "exigir" sem o par → 422 com os campos que faltam, nada gravado;
 *   · PF-4 o documento ganha da TOP, campo a campo;
 *   · PF-5 `documentoTroca` desligado: a troca → 422, nada gravado; o mesmo valor do padrão → 201;
 *   · PF-6 a conta padrão inativada depois de gravada a TOP → 422, nada gravado; reativada → 201 com a conta;
 *   · PF-7 sem título, a TOP nem é lida (sem "Gerar financeiro", valor zero, nascimento).
 *
 * TESTEMUNHA: o superusuário (`f9.admin`) lê títulos, rateios, trilha e contagens. "Nada gravado" é a contagem antes e
 * depois de seis tabelas que o POST grava. FIXTURE declarada: os padrões da TOP são inseridos na tabela da versão
 * (`criarTopNo5(…, { padroes })`; a gravação pela API é do P3 da F9a). As naturezas e os centros do caso têm códigos
 * `9.F10R.*` (depois de todo o seed) e nomes SEM "animais", "boi" ou "bezerro": o par legado continua o do seed,
 * calculado aqui pelas consultas de hoje ESCRITAS À MÃO (o contrato que não pode mudar).
 */
const COMPRA = resolverTipoOperacao("erp.animal_movements", "purchase")!.codigo;
const VENDA = resolverTipoOperacao("erp.animal_movements", "sale")!.codigo;
const MSG_EXIGE = "A operação exige natureza e centro de resultado: informe no documento ou configure os padrões da TOP.";
const MSG_CONTA_INUTILIZAVEL = "A conta padrão da operação está inativa ou foi excluída: ajuste os padrões da TOP.";
/** A origem de cada campo do par na trilha. */
const DA_TOP = { natureza: "padrão da TOP", centro: "padrão da TOP" };
const DO_DOCUMENTO = { natureza: "documento", centro: "documento" };

let ND = ""; let ND2 = ""; let NR = ""; let C1 = ""; let C2 = ""; let T1 = "";
let legadoCompra: { natureza: string; centro: string }; let legadoVenda: { natureza: string; centro: string };

beforeAll(async () => {
  await iniciarF9a();
  expect([COMPRA, VENDA], "premissa: o registry declara as duas famílias do movimento de animais").toEqual(["pecuaria.compra_de_animais", "pecuaria.venda_de_animais"]);
  ND = await cadastro("financial_categories", "9.F10R.D01", "Despesa padrão da TOP", "expense");
  ND2 = await cadastro("financial_categories", "9.F10R.D02", "Despesa do documento", "expense");
  NR = await cadastro("financial_categories", "9.F10R.R01", "Receita padrão da TOP", "income");
  C1 = await cadastro("cost_centers", "9.F10R.001", "Centro padrão da TOP");
  C2 = await cadastro("cost_centers", "9.F10R.002", "Centro do documento");
  T1 = (await linha<{ id: string }>("select id::text as id from erp.title_types where organization_id=$1 or organization_id is null order by name, id limit 1", [f9.h.demo.orgId])).id;
  legadoCompra = await legado("expense");
  legadoVenda = await legado("income");
  // PREMISSA: na COMPRA, a natureza legada é a "de animais" (o seed tem "Compra de Animais"), e não a 1ª de despesa por
  // código — o caso distingue a consulta específica do movimento da genérica (na venda, "Venda de Boi Gordo" já é a 1ª).
  const primeiraDespesa = await linha<{ id: string }>("select id::text as id from erp.financial_categories where organization_id=$1 and nature='expense' and kind='analytic' and is_active and deleted_at is null order by code limit 1", [f9.h.demo.orgId]);
  expect(legadoCompra.natureza, "premissa: a natureza legada da compra é a \"de animais\", não a 1ª por código").not.toBe(primeiraDespesa.id);
  expect([ND, ND2, NR], "premissa: as naturezas do caso NÃO são as legadas").not.toContain(legadoCompra.natureza);
  expect([ND, ND2, NR]).not.toContain(legadoVenda.natureza);
  expect([C1, C2], "premissa: os centros do caso NÃO são o 1º por código").not.toContain(legadoCompra.centro);
  expect(await padroesDa(COMPRA), "premissa: o seed não tem TOP padrão da compra de animais").toEqual([]);
  expect(await padroesDa(VENDA), "premissa: o seed não tem TOP padrão da venda de animais").toEqual([]);
}, 240_000);
afterAll(encerrarF9a);

async function cadastro(tabela: "financial_categories" | "cost_centers", code: string, nome: string, nature?: string): Promise<string> {
  const r = tabela === "financial_categories"
    ? await f9.admin.query<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind,is_active) values ($1,$2,$3,$4,'analytic',true) returning id::text as id", [f9.h.demo.orgId, code, nome, nature])
    : await f9.admin.query<{ id: string }>("insert into erp.cost_centers(organization_id,code,name,kind,is_active) values ($1,$2,$3,'analytic',true) returning id::text as id", [f9.h.demo.orgId, code, nome]);
  return r.rows[0]!.id;
}
/** O par do padrão legado DO MOVIMENTO, pelas consultas de hoje (escritas aqui à mão: é o contrato que não pode mudar). */
async function legado(nature: "income" | "expense"): Promise<{ natureza: string; centro: string }> {
  const animais = await linhas<{ id: string }>("select id::text as id from erp.financial_categories where organization_id=$1 and nature=$2 and kind='analytic' and is_active and deleted_at is null and (name ilike '%animais%' or name ilike '%boi%' or name ilike '%bezerro%') order by code limit 1", [f9.h.demo.orgId, nature]);
  expect(animais.length, `premissa: o seed tem uma natureza de ${nature} "de animais"`).toBe(1);
  const c = await linha<{ id: string }>("select id::text as id from erp.cost_centers where organization_id=$1 and kind='analytic' and is_active and deleted_at is null order by code limit 1", [f9.h.demo.orgId]);
  return { natureza: animais[0]!.id, centro: c.id };
}
/** As TOPs padrão ativas e vivas da família. */
const padroesDa = async (familia: string) => (await linhas<{ id: string }>(
  "select id::text as id from erp.tipos_operacao where organization_id=$1 and codigo_base=$2 and padrao and ativo and excluido_em is null", [f9.h.demo.orgId, familia])).map((x) => x.id);
/** Uma TOP da família no 5 que ASSUME o posto de padrão (a única padrão da família, conferida). */
async function topPadraoNo5(familia: string, o: Parameters<typeof criarTopNo5>[1] = {}): Promise<TopCriada> {
  const top = await criarTopNo5(familia, { ...o, padrao: true });
  expect(await padroesDa(familia), "premissa: a TOP criada é a ÚNICA padrão da família").toEqual([top.id]);
  return top;
}

const mover = (payload: Record<string, unknown>, headers: Hdr = f9.h.headers()): Promise<Resposta> =>
  f9.ligada.inject({ method: "POST", url: "/api/livestock/movements", headers, payload });
/** O corpo da compra: 2 cabeças × 1500 = 3000, com fornecedor e "Gerar financeiro", sem natureza nem centro. */
const corpoDaCompra = (extra: Record<string, unknown> = {}) => ({
  empresa_id: f9.I.empresa, movement_type: "purchase", movement_date: DATA, person_id: f9.I.provider, batch_id: f9.I.batch, generate_financial: true,
  items: [{ category_id: f9.I.speciesCategory, quantity: 2, unit_value: "1500" }], ...extra });
/** A compra que DEVE nascer (201): devolve o id e o código. */
async function compra(extra: Record<string, unknown> = {}, headers?: Hdr): Promise<{ id: string; code: string }> {
  const r = await mover(corpoDaCompra(extra), headers);
  expect(r.statusCode, `a compra de animais nasce — ${r.body}`).toBe(201);
  return { id: j(r).id as string, code: j(r).code as string };
}
/** A venda de 1 cabeça × 1800 do lote sem identificação de uma compra, com cliente e "Gerar financeiro". */
async function venda(compraId: string): Promise<string> {
  const lote = await linha<{ id: string }>("select herd_lot_id::text as id from erp.animal_movement_items where movement_id=$1 and herd_lot_id is not null", [compraId]);
  const r = await mover({ empresa_id: f9.I.empresa, movement_type: "sale", movement_date: DATA, person_id: f9.I.client, generate_financial: true,
    items: [{ herd_lot_id: lote.id, quantity: 1, unit_value: "1800" }] });
  expect(r.statusCode, `a venda de animais nasce — ${r.body}`).toBe(201);
  return j(r).id as string;
}
const rateios = (id: string) => linhas<{ natureza: string; centro: string }>(
  `select a.financial_category_id::text as natureza, a.cost_center_id::text as centro
     from erp.title_apportionments a join erp.financial_titles t on t.id = a.title_id where t.source_type='animal_movements' and t.source_id=$1`, [id]);
/** O título do movimento: direção, situação, valor, TOP, versão, tipo de título e conta prevista. */
const titulos = async (id: string) => (await titulosDaOrigem("animal_movements", id)).map((t) => [t.status, t.amount, t.tipo_operacao_id, t.tipo_operacao_versao_id, t.title_type_id, t.conta_prevista_id]);
const direcao = async (id: string) => (await linhas<{ direction: string }>("select direction from erp.financial_titles where source_type='animal_movements' and source_id=$1", [id])).map((x) => x.direction);
const trilha = async (id: string) => (await linhas<{ metadata: Record<string, unknown> }>(
  "select metadata from erp.audit_logs where entity='animal_movements' and entity_id=$1 and action='create' order by created_at, id", [id])).map((x) => x.metadata);
/** As contagens da organização nas tabelas que o POST do movimento grava ("nada gravado" = iguais antes e depois). */
async function contagens(): Promise<Record<string, number>> {
  const r = await linha<Record<string, string>>(
    `select (select count(*) from erp.animal_movements where organization_id=$1)::text as movimentos,
            (select count(*) from erp.animal_movement_items i join erp.animal_movements m on m.id = i.movement_id where m.organization_id=$1)::text as itens,
            (select count(*) from erp.herd_lots where organization_id=$1)::text as lotes,
            (select count(*) from erp.animals where organization_id=$1)::text as animais,
            (select count(*) from erp.processings where organization_id=$1)::text as processamentos,
            (select count(*) from erp.financial_titles where organization_id=$1)::text as titulos`, [f9.h.demo.orgId]);
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}
/** A recusa: 422, nada gravado (contagens iguais) — devolve o erro. */
async function recusada(payload: Record<string, unknown>) {
  const antes = await contagens();
  expect(antes.movimentos, "premissa: a contagem lê movimentos da organização").toBeGreaterThan(0);
  const r = await mover(payload);
  expect(r.statusCode, r.body).toBe(422);
  expect(await contagens(), "nada gravado").toEqual(antes);
  return erro(r);
}

// ---------------------------------------------------------------------------------------------------------------
describe("PF-1 — sem TOP padrão (ou com ela no 4, ou no 5 sem padrões): o legado de hoje, intacto", () => {
  it("o par das consultas de hoje, sem TOP, tipo de título nem conta no título; a trilha sem `financeiro`; o campo informado sozinho continua valendo; o documento completo também fica sem TOP", async () => {
    expect(await padroesDa(COMPRA), "premissa: nenhuma TOP padrão da compra de animais").toEqual([]);
    const semTop = await compra();
    expect(await rateios(semTop.id)).toEqual([legadoCompra]);
    expect(await titulos(semTop.id)).toEqual([["open", "3000.00", null, null, null, null]]);
    expect(await direcao(semTop.id)).toEqual(["payable"]);
    expect(await trilha(semTop.id)).toEqual([{ code: semTop.code, type: "purchase", qty: 2 }]);
    // O campo informado SOZINHO (hoje): o centro do documento e a natureza legada.
    const soCentro = await compra({ cost_center_id: C2 });
    expect(await rateios(soCentro.id)).toEqual([{ natureza: legadoCompra.natureza, centro: C2 }]);
    const soNatureza = await compra({ financial_category_id: ND2 });
    expect(await rateios(soNatureza.id)).toEqual([{ natureza: ND2, centro: legadoCompra.centro }]);

    // TOP padrão no FORMATO 4 (sem a seção do 5): o mesmo legado, sem TOP no título.
    const no4 = await postarTop(COMPRA, { configuracao: configuracaoNeutraTopV4(), padrao: true });
    expect(no4.statusCode, `premissa: a TOP no 4 nasce padrão — ${no4.body}`).toBe(201);
    expect(await padroesDa(COMPRA), "premissa: ela é a ÚNICA padrão da família").toEqual([j(no4).id as string]);
    const com4 = await compra();
    expect(await rateios(com4.id)).toEqual([legadoCompra]);
    expect(await titulos(com4.id)).toEqual([["open", "3000.00", null, null, null, null]]);
    expect(await trilha(com4.id)).toEqual([{ code: com4.code, type: "purchase", qty: 2 }]);
    // O documento com natureza E centro, com a TOP padrão no 4: o par do documento, SEM a TOP no título nem na trilha.
    const com4Doc = await compra({ financial_category_id: ND2, cost_center_id: C2 });
    expect(await rateios(com4Doc.id)).toEqual([{ natureza: ND2, centro: C2 }]);
    expect(await titulos(com4Doc.id)).toEqual([["open", "3000.00", null, null, null, null]]);
    expect(await trilha(com4Doc.id)).toEqual([{ code: com4Doc.code, type: "purchase", qty: 2 }]);

    // TOP padrão no 5 NEUTRO (sem padrões, "padrão legado"): o mesmo legado, sem TOP no título.
    await topPadraoNo5(COMPRA);
    const com5 = await compra();
    expect(await rateios(com5.id)).toEqual([legadoCompra]);
    expect(await titulos(com5.id)).toEqual([["open", "3000.00", null, null, null, null]]);
    expect(await trilha(com5.id)).toEqual([{ code: com5.code, type: "purchase", qty: 2 }]);
    // O documento com natureza E centro, com a TOP padrão no 5 neutro: o par do documento, SEM a TOP no título nem na trilha.
    const com5Doc = await compra({ financial_category_id: ND2, cost_center_id: C2 });
    expect(await rateios(com5Doc.id)).toEqual([{ natureza: ND2, centro: C2 }]);
    expect(await titulos(com5Doc.id)).toEqual([["open", "3000.00", null, null, null, null]]);
    expect(await trilha(com5Doc.id)).toEqual([{ code: com5Doc.code, type: "purchase", qty: 2 }]);
  });
});

describe("PF-2 — a TOP padrão com padrões classifica o título", () => {
  it("compra: natureza, centro, tipo de título, conta, TOP e versão; a trilha diz \"padrão da TOP\" nos dois campos; venda: legado de receita até a TOP da venda existir, depois a dela", async () => {
    const top = await topPadraoNo5(COMPRA, { padroes: { naturezaId: ND, centroCustoId: C1, tipoTituloId: T1, contaBancariaId: f9.I.bankAccount } });
    const c = await compra();
    expect(await rateios(c.id)).toEqual([{ natureza: ND, centro: C1 }]);
    expect(await titulos(c.id)).toEqual([["open", "3000.00", top.id, top.versaoId, T1, f9.I.bankAccount]]);
    expect(await direcao(c.id)).toEqual(["payable"]);
    expect(await trilha(c.id)).toEqual([{ code: c.code, type: "purchase", qty: 2, financeiro: { origem: DA_TOP, tipoOperacaoId: top.id, tipoOperacaoVersaoId: top.versaoId } }]);

    // A VENDA, sem TOP padrão DELA: o legado de receita (a família da compra não vaza para a venda).
    expect(await padroesDa(VENDA), "premissa: nenhuma TOP padrão da venda de animais").toEqual([]);
    const v1 = await venda(c.id);
    expect(await rateios(v1)).toEqual([legadoVenda]);
    expect(await titulos(v1)).toEqual([["open", "1800.00", null, null, null, null]]);
    expect(await direcao(v1)).toEqual(["receivable"]);
    // Com a TOP padrão da VENDA (natureza de receita): a dela.
    const topVenda = await topPadraoNo5(VENDA, { padroes: { naturezaId: NR, centroCustoId: C1 } });
    const v2 = await venda(c.id);
    expect(await rateios(v2)).toEqual([{ natureza: NR, centro: C1 }]);
    expect(await titulos(v2)).toEqual([["open", "1800.00", topVenda.id, topVenda.versaoId, null, null]]);
    expect(await direcao(v2)).toEqual(["receivable"]);
  });

  it("o membro SÓ de pecuária (sem nenhuma capacidade financeira) lança a compra com a conta e o tipo de título da TOP", async () => {
    const top = await topPadraoNo5(COMPRA, { padroes: { naturezaId: ND, centroCustoId: C1, tipoTituloId: T1, contaBancariaId: f9.I.bankAccount } });
    const pecuarista = await usuario("Pecuarista F10r", ["animal_purchases.view", "animal_purchases.create"]);
    // PREMISSA: o membro não tem a capacidade financeira (a conta não é lida por ela).
    const contas = await f9.ligada.inject({ method: "GET", url: "/api/financeiro/contas", headers: pecuarista });
    expect(contas.statusCode, `premissa: o membro não lê as contas bancárias — ${contas.body}`).toBe(403);
    const c = await compra({}, pecuarista);
    expect(await rateios(c.id)).toEqual([{ natureza: ND, centro: C1 }]);
    expect(await titulos(c.id)).toEqual([["open", "3000.00", top.id, top.versaoId, T1, f9.I.bankAccount]]);
  });
});

describe("PF-3 — \"exigir\" sem o par: 422 antes de qualquer gravação", () => {
  it("nem documento nem TOP → 422 nos dois campos, nada gravado; só a natureza → 422 só no centro; os dois no documento → 201 com a TOP no título", async () => {
    const top = await topPadraoNo5(COMPRA, { secao: { semClassificacao: "exigir" } });
    expect(await recusada(corpoDaCompra())).toEqual({ code: "VALIDATION_ERROR", message: MSG_EXIGE,
      details: [{ path: ["financial_category_id"], message: MSG_EXIGE }, { path: ["cost_center_id"], message: MSG_EXIGE }] });
    expect(await recusada(corpoDaCompra({ financial_category_id: ND2 }))).toEqual({ code: "VALIDATION_ERROR", message: MSG_EXIGE,
      details: [{ path: ["cost_center_id"], message: MSG_EXIGE }] });
    // PREMISSA: a recusa é da falta do par — o MESMO corpo com natureza e centro nasce, e o título leva a TOP.
    const c = await compra({ financial_category_id: ND2, cost_center_id: C2 });
    expect(await rateios(c.id)).toEqual([{ natureza: ND2, centro: C2 }]);
    expect(await titulos(c.id)).toEqual([["open", "3000.00", top.id, top.versaoId, null, null]]);
    expect(await trilha(c.id)).toEqual([{ code: c.code, type: "purchase", qty: 2, financeiro: { origem: DO_DOCUMENTO, tipoOperacaoId: top.id, tipoOperacaoVersaoId: top.versaoId } }]);
  });
});

describe("PF-4 — o documento ganha da TOP, campo a campo", () => {
  it("os dois no documento → os do documento (tipo de título e TOP da TOP); só a natureza → a do documento e o centro da TOP; só o centro → a natureza da TOP", async () => {
    const top = await topPadraoNo5(COMPRA, { padroes: { naturezaId: ND, centroCustoId: C1, tipoTituloId: T1 } });
    // PREMISSA: sem os campos, o mesmo corpo leva o par da TOP.
    const semCampos = await compra();
    expect(await rateios(semCampos.id)).toEqual([{ natureza: ND, centro: C1 }]);
    const doDocumento = await compra({ financial_category_id: ND2, cost_center_id: C2 });
    expect(await rateios(doDocumento.id)).toEqual([{ natureza: ND2, centro: C2 }]);
    expect(await titulos(doDocumento.id)).toEqual([["open", "3000.00", top.id, top.versaoId, T1, null]]);
    const soNatureza = await compra({ financial_category_id: ND2 });
    expect(await rateios(soNatureza.id), "o campo informado no documento não é descartado").toEqual([{ natureza: ND2, centro: C1 }]);
    const soCentro = await compra({ cost_center_id: C2 });
    expect(await rateios(soCentro.id)).toEqual([{ natureza: ND, centro: C2 }]);
    // A trilha diz a origem de CADA campo do par misto.
    expect(await trilha(soCentro.id)).toEqual([{ code: soCentro.code, type: "purchase", qty: 2,
      financeiro: { origem: { natureza: "padrão da TOP", centro: "documento" }, tipoOperacaoId: top.id, tipoOperacaoVersaoId: top.versaoId } }]);
    expect(await trilha(soNatureza.id)).toEqual([{ code: soNatureza.code, type: "purchase", qty: 2,
      financeiro: { origem: { natureza: "documento", centro: "padrão da TOP" }, tipoOperacaoId: top.id, tipoOperacaoVersaoId: top.versaoId } }]);
  });
});

describe("PF-5 — `documentoTroca` desligado", () => {
  it("a natureza diferente do padrão → 422 nela, nada gravado; as duas diferentes → 422 nas duas; a natureza IGUAL ao padrão → 201", async () => {
    await topPadraoNo5(COMPRA, { secao: { documentoTroca: false }, padroes: { naturezaId: ND, centroCustoId: C1 } });
    const m1 = "Esta operação não deixa trocar a natureza: use o padrão da TOP.";
    expect(await recusada(corpoDaCompra({ financial_category_id: ND2 }))).toEqual({ code: "VALIDATION_ERROR", message: m1, details: [{ path: ["financial_category_id"], message: m1 }] });
    const m2 = "Esta operação não deixa trocar a natureza e o centro de resultado: use o padrão da TOP.";
    expect(await recusada(corpoDaCompra({ financial_category_id: ND2, cost_center_id: C2 }))).toEqual({ code: "VALIDATION_ERROR", message: m2,
      details: [{ path: ["financial_category_id"], message: m2 }, { path: ["cost_center_id"], message: m2 }] });
    // PREMISSA: a recusa é da troca — o mesmo valor do padrão (em maiúsculas: comparado sem caixa) nasce.
    const igual = await compra({ financial_category_id: ND.toUpperCase() });
    expect(await rateios(igual.id)).toEqual([{ natureza: ND, centro: C1 }]);
  });
});

describe("PF-6 — a conta padrão inativada depois de gravada a TOP", () => {
  it("422 sem nada gravado; reativada, a compra nasce e o título leva a conta", async () => {
    const conta = (await linha<{ id: string }>("insert into erp.bank_accounts(organization_id,code,description,type) values ($1,$2,$3,'checking') returning id::text as id",
      [f9.h.demo.orgId, `F10R${Date.now().toString(36).slice(-5)}`.toUpperCase(), "Conta padrão da TOP (F10r)"])).id;
    const top = await topPadraoNo5(COMPRA, { padroes: { naturezaId: ND, centroCustoId: C1, contaBancariaId: conta } });
    const ativar = async (ativa: boolean) => expect((await f9.admin.query("update erp.bank_accounts set is_active=$2 where id=$1", [conta, ativa])).rowCount, "premissa: a conta mudou").toBe(1);
    await ativar(false);
    expect(await recusada(corpoDaCompra())).toEqual({ code: "VALIDATION_ERROR", message: MSG_CONTA_INUTILIZAVEL });
    // PREMISSA: a recusa é da conta — reativada, o MESMO corpo nasce com ela.
    await ativar(true);
    const c = await compra();
    expect(await titulos(c.id)).toEqual([["open", "3000.00", top.id, top.versaoId, null, conta]]);
  });
});

describe("PF-7 — sem título, a TOP padrão nem é lida", () => {
  it("com a TOP padrão \"exigir\" em vigor: sem \"Gerar financeiro\", com valor zero e o nascimento nascem sem título", async () => {
    await topPadraoNo5(COMPRA, { secao: { semClassificacao: "exigir" } });
    // PREMISSA: a mesma compra COM título é recusada pela TOP.
    expect((await recusada(corpoDaCompra())).message).toBe(MSG_EXIGE);
    const semFinanceiro = await compra({ generate_financial: false });
    expect(await titulos(semFinanceiro.id)).toEqual([]);
    const valorZero = await compra({ items: [{ category_id: f9.I.speciesCategory, quantity: 2, unit_value: "0" }] });
    expect(await titulos(valorZero.id)).toEqual([]);
    const nascimento = await mover({ empresa_id: f9.I.empresa, movement_type: "birth", movement_date: DATA, batch_id: f9.I.batch, generate_financial: true,
      items: [{ category_id: f9.I.speciesCategory, quantity: 1 }] });
    expect(nascimento.statusCode, nascimento.body).toBe(201);
    expect(await titulos(j(nascimento).id as string)).toEqual([]);
    expect(await trilha(semFinanceiro.id)).toEqual([{ code: semFinanceiro.code, type: "purchase", qty: 2 }]);
  });
});
