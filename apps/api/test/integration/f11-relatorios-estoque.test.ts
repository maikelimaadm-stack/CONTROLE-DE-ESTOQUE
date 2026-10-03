import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { D } from "@agro/shared";
import {
  c, iniciar, encerrar, produto, saldoInicial, membro, escopos, j, topV5, lancadoDoc, confirmadoDoc, cancelarDoc, cabecalho, centroNovo,
  type Hdr, type Resposta,
} from "./f5a-ajuda.js";

/**
 * OPERACOES-01 F11 (decisão 288, I-3(c)) — OS RELATÓRIOS "REQUISIÇÕES/SAÍDAS" E "BAIXAS DE ESTOQUE" INCLUEM O DOCUMENTO NOVO.
 *
 * Até a F11 os dois relatórios (`apps/api/src/routes/reports.ts`, chaves `requisitions` e `stock_writeoffs`) liam só as
 * tabelas ANTIGAS (`erp.requisitions`, `erp.stock_writeoffs`): o consumo e a saída lançados na Central de Estoque
 * (`erp.documentos_estoque`) não apareciam. Agora cada relatório é UMA consulta (`union all`) com as duas fontes:
 *   · Requisições/Saídas: a requisição antiga confirmada + o CONSUMO confirmado do documento novo;
 *   · Baixas de Estoque: a baixa antiga confirmada + a SAÍDA confirmada do documento novo (motivo e justificativa do cabeçalho).
 * O ramo novo lê o RAZÃO (quantidade e custo reais, numeric), agrupado por documento e produto, e a coluna nova
 * `documento` (no FIM) diz de qual fonte é a linha.
 *
 * O QUE CONTA COMO PROVA: os documentos nascem pelas rotas reais (a antiga e a do documento novo); a quantidade e o custo
 * esperados são LIDOS NO RAZÃO por conexão própria de superusuário (`c.admin`, sem RLS) e comparados em texto decimal
 * exato; cada janela de data é ocupada SÓ pelos documentos deste arquivo (premissa conferida no banco). Toda ausência
 * ("o cancelado não entra", "o usuário restrito não vê a B") vem com a premissa ao lado (o registro existe; o admin vê).
 *
 * As TOPs são do FORMATO 5, criadas aqui, com o centro de resultado da seção Destino "opcional" EXPLÍCITO — o arquivo não
 * depende do neutro da seção.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

/** Janelas ocupadas só por este arquivo (mês aberto). */
const D_REQ = "2026-09-14";
const D_BAIXA = "2026-09-15";
const D_BAIXA_DEPOIS = "2026-09-16";

type Linha = Record<string, unknown>;
type Relatorio = { columns: { key: string; label: string }[]; filters: { name: string }[]; rows: Linha[]; totals: Record<string, string> };
const get = (url: string, headers: Hdr = c.h.headers()): Promise<Resposta> => c.h.app.inject({ method: "GET", url, headers });
async function relatorio(chave: string, filtros: Record<string, string>, headers?: Hdr): Promise<Relatorio> {
  const r = await get(`/api/reports/${chave}?${new URLSearchParams(filtros).toString()}`, headers);
  expect(r.statusCode, `${chave}: ${r.body}`).toBe(200);
  return j(r) as unknown as Relatorio;
}
const criado = (r: Resposta): string => { expect(r.statusCode, `premissa: o registro é criado — ${r.body}`).toBe(201); return (j(r) as { id: string }).id; };
const post = (url: string, payload: Record<string, unknown>): Promise<Resposta> => c.h.app.inject({ method: "POST", url, headers: c.h.headers(), payload });
const item = (produtoId: string, quantidade: string) => ({ produto_id: produtoId, quantidade });
/** A soma exata (Decimal) de uma coluna de dinheiro, com 2 casas — o que o total do relatório tem de dizer. */
const soma = (linhas: Linha[], chave: string) => linhas.reduce((a, x) => a.plus(D(String(x[chave]))), D(0)).toFixed(2);
/** Ordem estável para comparar linhas (o relatório ordena por data e código; o empate não é contrato). */
const ordenar = (linhas: Linha[]) => [...linhas].sort((a, b) => `${a["documento"]}|${a["code"]}|${a["product"]}`.localeCompare(`${b["documento"]}|${b["code"]}|${b["product"]}`));

/** Quantidade e custo do documento novo NO RAZÃO (saídas, por produto) — a fonte do ramo novo. */
async function razaoDoDocumento(id: string): Promise<{ product_id: string; quantity: string; total: string }[]> {
  return (await c.admin.query<{ product_id: string; quantity: string; total: string }>(
    `select product_id, sum(quantity)::text as quantity, sum(total_cost)::text as total from erp.stock_movements
      where source_type='documentos_estoque' and source_id=$1 and direction=-1 and movement_type <> 'reversal' group by product_id order by product_id`, [id])).rows;
}
const codigoDoc = async (id: string) => (await c.admin.query<{ codigo: string }>("select codigo from erp.documentos_estoque where id=$1", [id])).rows[0]!.codigo;
/** Saldo inicial na empresa B (a ajuda grava sempre na 1ª empresa). */
async function saldoInicialNaB(produtoId: string, quantidade: string, custo: string) {
  criado(await post("/api/stock/opening-balances", { empresa_id: c.I.empresa2, warehouse_id: c.I.warehouseEmpresa2, product_id: produtoId, quantity: quantidade, unit_value: custo }));
}

describe("RE-1 — Requisições/Saídas: a requisição antiga e o CONSUMO confirmado do documento novo", () => {
  let p1 = { id: "", nome: "" }; let p2 = { id: "", nome: "" };
  let centro1 = ""; let centro2 = ""; let nomeCentro1 = ""; let nomeCentro2 = ""; let requisitante = "";
  let antiga = ""; let codAntiga = "";
  let consumo1 = ""; let consumo2 = ""; let consumoB = ""; let cancelado = ""; let aberto = "";
  let restrito: Hdr = {};
  const JANELA = { start_date: D_REQ, end_date: D_REQ };

  beforeAll(async () => {
    p1 = await produto(); p2 = await produto();
    await saldoInicial(p1.id, "100", { custo: "10.5" });
    await saldoInicial(p2.id, "100", { custo: "4.2" });
    await saldoInicialNaB(p1.id, "50", "10.5");
    centro1 = await centroNovo(); centro2 = await centroNovo();
    const nomes = new Map((await c.admin.query<{ id: string; name: string }>("select id, name from erp.cost_centers where id = any($1::uuid[])", [[centro1, centro2]])).rows.map((x) => [x.id, x.name]));
    nomeCentro1 = nomes.get(centro1)!; nomeCentro2 = nomes.get(centro2)!;
    requisitante = (await c.admin.query<{ name: string }>("select name from erp.people where id=$1", [c.I.employee])).rows[0]!.name;

    // A requisição ANTIGA (empresa A): dois itens — p1 no centro 1, p2 sem centro (o filtro de centro da antiga é POR ITEM).
    antiga = criado(await post("/api/stock/requisitions", {
      empresa_id: c.I.empresa, requisition_date: D_REQ, requester_person_id: c.I.employee,
      items: [{ warehouse_id: c.I.warehouse, product_id: p1.id, quantity: "3", cost_center_id: centro1 }, { warehouse_id: c.I.warehouse, product_id: p2.id, quantity: "1" }] }));
    codAntiga = (await c.admin.query<{ code: string }>("select code from erp.requisitions where id=$1", [antiga])).rows[0]!.code;

    // O CONSUMO novo, numa TOP do formato 5 com o centro de resultado OPCIONAL explícito.
    const tCon = await topV5("consumo", (x) => { x.destino.centroCusto = "opcional"; });
    const consumo = (itens: { produto_id: string; quantidade: string }[], extra: Record<string, unknown> = {}) =>
      lancadoDoc("consumo", itens, { tipo_operacao_id: tCon, data_documento: D_REQ, ...extra });
    consumo1 = await consumo([item(p1.id, "2.5")], { centro_custo_id: centro1 });
    consumo2 = await consumo([item(p2.id, "1.25")], { centro_custo_id: centro2 });
    cancelado = await consumo([item(p1.id, "1")], { centro_custo_id: centro1 });
    aberto = await consumo([item(p1.id, "1")], { centro_custo_id: centro1 });
    consumoB = await consumo([item(p1.id, "2")], { empresa_id: c.I.empresa2, armazem_id: c.I.warehouseEmpresa2 });
    for (const id of [consumo1, consumo2, cancelado, consumoB]) await confirmadoDoc("consumo", id);
    const r = await cancelarDoc("consumo", cancelado);
    expect(r.statusCode, r.body).toBe(200);

    restrito = await membro("Relatorio Restrito F11", ["report.requisitions.view", "report.stock_writeoffs.view"], escopos([c.I.empresa]));
  }, 120_000);

  it("PREMISSA: a janela só tem os documentos deste caso; o razão tem a quantidade e o custo de cada consumo; o cancelado foi estornado e o aberto não moveu", async () => {
    const naJanela = (await c.admin.query<{ fonte: string; n: string }>(
      `select 'antiga' as fonte, count(*)::text as n from erp.requisitions where organization_id=$1 and requisition_date=$2
       union all select 'consumo:' || situacao, count(*)::text from erp.documentos_estoque where organization_id=$1 and especie='consumo' and data_documento=$2 group by situacao
       order by 1`, [c.h.demo.orgId, D_REQ])).rows.map((x) => [x.fonte, x.n]);
    expect(naJanela, "na janela: a requisição antiga, três consumos confirmados, um cancelado, um aberto").toEqual([
      ["antiga", "1"], ["consumo:aberto", "1"], ["consumo:cancelado", "1"], ["consumo:confirmado", "3"]]);
    expect(await razaoDoDocumento(consumo1)).toEqual([{ product_id: p1.id, quantity: "2.5000", total: "26.25" }]);
    expect(await razaoDoDocumento(consumo2)).toEqual([{ product_id: p2.id, quantity: "1.2500", total: "5.25" }]);
    expect(await razaoDoDocumento(consumoB)).toEqual([{ product_id: p1.id, quantity: "2.0000", total: "21.00" }]);
    const cabecalhos = await Promise.all([consumo1, consumo2, consumoB, cancelado, aberto].map(cabecalho));
    expect(cabecalhos.map((x) => [x.situacao, x.centro_custo_id]), "situação e centro gravados no cabeçalho").toEqual([
      ["confirmado", centro1], ["confirmado", centro2], ["confirmado", null], ["cancelado", centro1], ["aberto", centro1]]);
    const doCancelado = (await c.admin.query<{ movement_type: string; direction: number }>(
      "select movement_type, direction from erp.stock_movements where source_type='documentos_estoque' and source_id=$1 order by direction", [cancelado])).rows;
    expect(doCancelado.map((m) => [m.movement_type, m.direction]), "o cancelado saiu e voltou (o movimento de saída continua no razão)").toEqual([["requisition", -1], ["reversal", 1]]);
    expect(await razaoDoDocumento(aberto), "o aberto não moveu o razão").toEqual([]);
  });

  it("RE-1a admin: as linhas da antiga ('Requisição (tela antiga)') e dos três consumos confirmados ('Consumo'), em decimal exato; cancelado e aberto não; total = soma exata", async () => {
    const r = await relatorio("requisitions", JANELA);
    const [c1, c2, cB] = await Promise.all([consumo1, consumo2, consumoB].map(codigoDoc));
    const esperado: Linha[] = [
      { code: codAntiga, requisition_date: D_REQ, requester: requisitante, product: p1.nome, quantity: "3.0000", unit_value: "10.500000", total_value: "31.50", cost_center: nomeCentro1, documento: "Requisição (tela antiga)" },
      { code: codAntiga, requisition_date: D_REQ, requester: requisitante, product: p2.nome, quantity: "1.0000", unit_value: "4.200000", total_value: "4.20", cost_center: null, documento: "Requisição (tela antiga)" },
      { code: c1, requisition_date: D_REQ, requester: null, product: p1.nome, quantity: "2.5000", unit_value: "10.500000", total_value: "26.25", cost_center: nomeCentro1, documento: "Consumo" },
      { code: c2, requisition_date: D_REQ, requester: null, product: p2.nome, quantity: "1.2500", unit_value: "4.200000", total_value: "5.25", cost_center: nomeCentro2, documento: "Consumo" },
      { code: cB, requisition_date: D_REQ, requester: null, product: p1.nome, quantity: "2.0000", unit_value: "10.500000", total_value: "21.00", cost_center: null, documento: "Consumo" },
    ];
    expect(ordenar(r.rows)).toEqual(ordenar(esperado));
    const codigosNovos = r.rows.filter((x) => x["documento"] === "Consumo").map((x) => x["code"]);
    for (const id of [cancelado, aberto]) expect(codigosNovos, "o cancelado e o aberto não entram").not.toContain(await codigoDoc(id));
    expect(soma(r.rows, "total_value"), "premissa: a soma exata das linhas").toBe("88.20");
    expect(r.totals, "o total é a soma exata").toEqual({ total_value: "88.20" });
    expect(r.rows.map((x) => x["requisition_date"]), "ordenado por data (todas na mesma)").toEqual(Array(5).fill(D_REQ));
  });

  it("RE-1b usuário restrito à empresa A (estoque): só as linhas da A — premissa: o admin vê o consumo da B", async () => {
    const cB = await codigoDoc(consumoB);
    const doAdmin = await relatorio("requisitions", JANELA);
    expect(doAdmin.rows.filter((x) => x["code"] === cB && x["documento"] === "Consumo"), "premissa: o admin vê o consumo da empresa B").toHaveLength(1);
    const r = await relatorio("requisitions", JANELA, restrito);
    expect(r.rows, "premissa: o restrito vê as linhas da A (não é uma lista vazia)").toHaveLength(4);
    expect(r.rows.some((x) => x["code"] === cB && x["documento"] === "Consumo"), "a linha da B não aparece").toBe(false);
    expect(ordenar(r.rows)).toEqual(ordenar(doAdmin.rows.filter((x) => !(x["code"] === cB && x["documento"] === "Consumo"))));
    expect(r.totals).toEqual({ total_value: "67.20" });
    // E pedindo a empresa B explicitamente, o restrito não ganha nada (empresa do cliente é pedido, nunca autorização).
    const pedidoB = await get(`/api/reports/requisitions?${new URLSearchParams({ ...JANELA, empresa_id: c.I.empresa2 }).toString()}`, restrito);
    expect(pedidoB.statusCode, pedidoB.body).toBe(200);
    expect((j(pedidoB) as unknown as Relatorio).rows, "pedir a B não mostra a B").toEqual([]);
  });

  it("RE-1c filtro de centro de resultado vale nas DUAS fontes: o item da antiga (por item) e o consumo (pelo movimento)", async () => {
    const todas = await relatorio("requisitions", JANELA);
    expect(todas.rows.filter((x) => x["cost_center"] !== nomeCentro1), "premissa: há linhas FORA do centro 1 nas duas fontes").toEqual(expect.arrayContaining([
      expect.objectContaining({ documento: "Requisição (tela antiga)", product: p2.nome }), expect.objectContaining({ documento: "Consumo", cost_center: nomeCentro2 })]));
    const r = await relatorio("requisitions", { ...JANELA, cost_center_id: centro1 });
    expect(ordenar(r.rows).map((x) => [x["documento"], x["product"], x["quantity"], x["total_value"], x["cost_center"]])).toEqual([
      ["Consumo", p1.nome, "2.5000", "26.25", nomeCentro1], ["Requisição (tela antiga)", p1.nome, "3.0000", "31.50", nomeCentro1]]);
    expect(r.totals).toEqual({ total_value: "57.75" });
  });

  it("RE-1d filtro de data vale nas duas fontes: a janela que inclui o dia traz a antiga e os consumos; a véspera, nada deste caso", async () => {
    const meus = new Set([codAntiga, ...(await Promise.all([consumo1, consumo2, consumoB].map(codigoDoc)))]);
    const deste = (linhas: Linha[]) => linhas.filter((x) => (x["product"] === p1.nome || x["product"] === p2.nome) && meus.has(String(x["code"])))
      .map((x) => String(x["documento"])).sort();
    const larga = await relatorio("requisitions", { start_date: "2026-09-13", end_date: D_REQ });
    expect(deste(larga.rows), "premissa: a janela que inclui o dia traz as duas fontes").toEqual([
      "Consumo", "Consumo", "Consumo", "Requisição (tela antiga)", "Requisição (tela antiga)"]);
    const vespera = await relatorio("requisitions", { start_date: "2026-09-13", end_date: "2026-09-13" });
    expect(deste(vespera.rows), "a véspera não traz nada deste caso").toEqual([]);
    const depois = await relatorio("requisitions", { start_date: "2026-09-15", end_date: "2026-09-30" });
    expect(deste(depois.rows), "nem o período depois").toEqual([]);
  });
});

describe("RE-2 — Baixas de Estoque: a baixa antiga e a SAÍDA confirmada do documento novo", () => {
  let p3 = { id: "", nome: "" };
  let baixa1 = ""; let baixa2 = ""; let codBaixa1 = ""; let codBaixa2 = "";
  let saida1 = ""; let saida2 = ""; let canceladaS = "";

  beforeAll(async () => {
    p3 = await produto();
    await saldoInicial(p3.id, "100", { custo: "3.15" });
    const baixa = (data: string, quantidade: string, justificativa: string) => post("/api/stock/writeoffs", {
      empresa_id: c.I.empresa, writeoff_date: data, reason: "damage", warehouse_id: c.I.warehouse, justification: justificativa, items: [{ product_id: p3.id, quantity: quantidade }] });
    baixa1 = criado(await baixa(D_BAIXA, "2", "Avaria no galpão F11"));
    baixa2 = criado(await baixa(D_BAIXA_DEPOIS, "1", "Avaria no dia seguinte F11"));
    const codigos = new Map((await c.admin.query<{ id: string; code: string }>("select id, code from erp.stock_writeoffs where id = any($1::uuid[])", [[baixa1, baixa2]])).rows.map((x) => [x.id, x.code]));
    codBaixa1 = codigos.get(baixa1)!; codBaixa2 = codigos.get(baixa2)!;

    const tSai = await topV5("saida", (x) => { x.destino.centroCusto = "opcional"; });
    const saida = (data: string, quantidade: string, motivo: string, justificativa: string) =>
      lancadoDoc("saida", [item(p3.id, quantidade)], { tipo_operacao_id: tSai, data_documento: data, motivo_saida: motivo, justificativa });
    saida1 = await saida(D_BAIXA, "1.5", "loss", "Perda no transporte F11");
    canceladaS = await saida(D_BAIXA, "1", "theft", "Furto F11 (cancelado)");
    saida2 = await saida(D_BAIXA_DEPOIS, "0.5", "expiration", "Vencido F11");
    for (const id of [saida1, canceladaS, saida2]) await confirmadoDoc("saida", id);
    const r = await cancelarDoc("saida", canceladaS);
    expect(r.statusCode, r.body).toBe(200);
  }, 120_000);

  it("PREMISSA: as duas janelas só têm os documentos deste caso; o razão tem a quantidade e o custo de cada saída", async () => {
    const naJanela = (await c.admin.query<{ fonte: string; n: string }>(
      `select 'antiga:' || writeoff_date::text as fonte, count(*)::text as n from erp.stock_writeoffs where organization_id=$1 and writeoff_date between $2 and $3 group by writeoff_date
       union all select 'saida:' || data_documento::text || ':' || situacao, count(*)::text from erp.documentos_estoque where organization_id=$1 and especie='saida' and data_documento between $2 and $3 group by data_documento, situacao
       order by 1`, [c.h.demo.orgId, D_BAIXA, D_BAIXA_DEPOIS])).rows.map((x) => [x.fonte, x.n]);
    expect(naJanela).toEqual([
      [`antiga:${D_BAIXA}`, "1"], [`antiga:${D_BAIXA_DEPOIS}`, "1"],
      [`saida:${D_BAIXA}:cancelado`, "1"], [`saida:${D_BAIXA}:confirmado`, "1"], [`saida:${D_BAIXA_DEPOIS}:confirmado`, "1"]]);
    expect(await razaoDoDocumento(saida1), "1,5 a 3,15 = 4,725 → 4,73 no razão").toEqual([{ product_id: p3.id, quantity: "1.5000", total: "4.73" }]);
    expect(await razaoDoDocumento(saida2)).toEqual([{ product_id: p3.id, quantity: "0.5000", total: "1.58" }]);
    expect((await cabecalho(canceladaS)).situacao).toBe("cancelado");
    expect(await razaoDoDocumento(canceladaS), "premissa: o cancelado saiu do razão antes de ser estornado").toEqual([{ product_id: p3.id, quantity: "1.0000", total: "3.15" }]);
  });

  it("RE-2a antiga + nova na janela (motivo e justificativa do cabeçalho; 'Saída'); a cancelada fora; total exato", async () => {
    const canceladaCodigo = await codigoDoc(canceladaS);
    const r = await relatorio("stock_writeoffs", { start_date: D_BAIXA, end_date: D_BAIXA });
    const valorAntiga = (await c.admin.query<{ q: string; v: string }>("select quantity::text q, total_value::text v from erp.stock_writeoff_items where writeoff_id=$1", [baixa1])).rows[0]!;
    expect(valorAntiga, "premissa: a baixa antiga gravou 2 a 3,15").toEqual({ q: "2.0000", v: "6.30" });
    expect(ordenar(r.rows)).toEqual(ordenar([
      { code: codBaixa1, writeoff_date: D_BAIXA, reason: "damage", product: p3.nome, quantity: "2.0000", total_value: "6.30", justification: "Avaria no galpão F11", documento: "Baixa (tela antiga)" },
      { code: await codigoDoc(saida1), writeoff_date: D_BAIXA, reason: "loss", product: p3.nome, quantity: "1.5000", total_value: "4.73", justification: "Perda no transporte F11", documento: "Saída" },
    ]));
    expect(r.rows.some((x) => (x["documento"] === "Saída" && x["code"] === canceladaCodigo) || x["reason"] === "theft"), "a saída cancelada não entra").toBe(false);
    expect(soma(r.rows, "total_value")).toBe("11.03");
    expect(r.totals).toEqual({ total_value: "11.03" });
  });

  it("RE-2b o filtro de data recorta as DUAS fontes: o dia seguinte só entra com a janela que o inclui", async () => {
    const larga = await relatorio("stock_writeoffs", { start_date: D_BAIXA, end_date: D_BAIXA_DEPOIS });
    const [s1, s2] = await Promise.all([saida1, saida2].map(codigoDoc));
    const chave = (x: Linha) => `${x["documento"]}|${x["code"]}`;
    expect(larga.rows.map((x) => [x["documento"], x["code"], x["writeoff_date"]]).sort((a, b) => String(a).localeCompare(String(b))),
      "premissa: na janela larga, as quatro (duas de cada fonte, uma em cada dia)").toEqual([
      ["Baixa (tela antiga)", codBaixa1, D_BAIXA], ["Baixa (tela antiga)", codBaixa2, D_BAIXA_DEPOIS], ["Saída", s1, D_BAIXA], ["Saída", s2, D_BAIXA_DEPOIS],
    ].sort((a, b) => String(a).localeCompare(String(b))));
    expect(larga.rows.map(chave), "ordenado por data").toEqual([...larga.rows].sort((a, b) => String(a["writeoff_date"]).localeCompare(String(b["writeoff_date"]))).map(chave));
    const doDiaSeguinte = larga.rows.filter((x) => x["writeoff_date"] === D_BAIXA_DEPOIS).map((x) => [x["documento"], x["reason"], x["quantity"], x["total_value"], x["justification"]]);
    expect(doDiaSeguinte.sort()).toEqual([
      ["Baixa (tela antiga)", "damage", "1.0000", "3.15", "Avaria no dia seguinte F11"], ["Saída", "expiration", "0.5000", "1.58", "Vencido F11"]]);
    const soDepois = await relatorio("stock_writeoffs", { start_date: D_BAIXA_DEPOIS, end_date: D_BAIXA_DEPOIS });
    expect(soDepois.rows.map((x) => x["documento"]).sort(), "só o dia seguinte: as duas fontes, sem as do dia anterior").toEqual(["Baixa (tela antiga)", "Saída"]);
    expect(soDepois.totals).toEqual({ total_value: "4.73" });
    const soAntes = await relatorio("stock_writeoffs", { start_date: D_BAIXA, end_date: D_BAIXA });
    expect(soAntes.rows.some((x) => x["writeoff_date"] === D_BAIXA_DEPOIS), "o dia anterior não traz o seguinte").toBe(false);
  });
});

describe("RE-3 — a forma: as colunas antigas não mudaram, `documento` entra no fim; filtros e totais iguais", () => {
  it("RE-3 Requisições/Saídas e Baixas de Estoque: chaves e rótulos de antes, na mesma ordem, e `documento` por último", async () => {
    // PREMISSA: as colunas, os filtros e os totais da base (891bce6), copiados da definição de antes.
    const antes = {
      requisitions: [["code", "Código"], ["requisition_date", "Data"], ["requester", "Requisitante"], ["product", "Produto"], ["quantity", "Qtd."], ["unit_value", "Vl. Unit."], ["total_value", "Total"], ["cost_center", "Centro de Resultado"]],
      stock_writeoffs: [["code", "Código"], ["writeoff_date", "Data"], ["reason", "Motivo"], ["product", "Produto"], ["quantity", "Qtd."], ["total_value", "Valor"], ["justification", "Justificativa"]],
    } as const;
    const filtros = { requisitions: ["empresa_id", "start_date", "end_date", "cost_center_id"], stock_writeoffs: ["empresa_id", "start_date", "end_date"] } as const;
    for (const chave of ["requisitions", "stock_writeoffs"] as const) {
      const r = await relatorio(chave, { start_date: "2031-01-01", end_date: "2031-01-01" });
      expect(r.columns.map((x) => [x.key, x.label]), chave).toEqual([...antes[chave], ["documento", "Documento"]]);
      expect(r.filters.map((x) => x.name), chave).toEqual([...filtros[chave]]);
      expect(r.rows, `${chave}: a janela vazia não tem linha`).toEqual([]);
      expect(r.totals, `${chave}: o total continua só do valor`).toEqual({ total_value: "0.00" });
    }
    // E cada linha devolvida tem exatamente as chaves das colunas (a nova inclusive).
    const comLinhas = await relatorio("requisitions", { start_date: D_REQ, end_date: D_REQ });
    expect(comLinhas.rows.length, "premissa: há linhas na janela do RE-1").toBeGreaterThan(0);
    for (const x of comLinhas.rows) expect(Object.keys(x)).toEqual(comLinhas.columns.map((k) => k.key));
  });
});
