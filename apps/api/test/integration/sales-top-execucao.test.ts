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
 * A CONFIRMAÇÃO E O CANCELAMENTO DA VENDA SOB A POLÍTICA CONGELADA DA TOP (TOP-CONFIG-04A).
 *
 * NOMES DOS CASOS. `04A-I1`…`04A-I20` e `04A-C1`…`04A-C7` são os da missão. O prefixo existe porque
 * `sales-confirm-cancel-concorrencia.test.ts` já usa C1–C6 para outra matriz, e um relatório que citasse
 * "C3" sem prefixo não diria de qual dos dois arquivos.
 *
 * DUAS INSTÂNCIAS DA API sobre o mesmo banco: `h.app` com o gate DESLIGADO (o padrão de produção) e
 * `ligada` com `TOP_EFFECTS_RUNTIME_V1_ENABLED=1`. As TOPs configuradas são ativadas pela `ligada`, como
 * exige a porta administrativa.
 *
 * O QUE CONTA COMO PROVA. Nenhuma asserção decisiva aqui é status HTTP: é CONTAGEM no banco, por origem
 * (`source_type='sales_documents'`, `source_id`), lida por conexão própria — movimentos, estornos, títulos,
 * status do documento e a trilha. E toda asserção de "zero efeito" vem com a PREMISSA ao lado: o mesmo
 * cenário, corrigido, produz o efeito — senão "zero" poderia ser só um cenário que nunca funcionaria.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let formaPagamento: string;
beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  formaPagamento = await comPool(async (c) => (await c.query<{ id: string }>("select id from erp.payment_methods where organization_id=$1 or organization_id is null order by name limit 1", [h.demo.orgId])).rows[0]!.id);
  const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: "500", unit_value: "10" } });
  expect(r.statusCode, r.body).toBe(201);
}, 180_000);
afterAll(async () => { await ligada?.close(); await h.app.close(); await h.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: { code: string; message: string; details?: Record<string, unknown> } };
const VENDA = MATRIZ_EXECUCAO_TOP[0]!.familia;

async function comPool<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return await fn(c); } finally { await c.end(); }
}

/** Tudo o que a confirmação materializa ou o cancelamento estorna, contado no banco. */
async function efeitos(id: string) {
  return comPool(async (c) => {
    const doc = (await c.query<{ status: string; tipo_operacao_versao_id: string | null }>("select status, tipo_operacao_versao_id from erp.sales_documents where id=$1", [id])).rows[0]!;
    const mov = (await c.query<{ movement_type: string; direction: number; quantity: string }>(
      "select movement_type, direction, quantity from erp.stock_movements where source_type='sales_documents' and source_id=$1 order by created_at", [id])).rows;
    const tit = (await c.query<{ status: string; amount: string; due_date: string }>(
      "select status, amount::text, to_char(due_date,'YYYY-MM-DD') as due_date from erp.financial_titles where source_type='sales_documents' and source_id=$1 order by created_at", [id])).rows;
    const aud = (await c.query<{ action: string; metadata: Record<string, unknown> | null }>(
      "select action, metadata from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action in ('confirm','cancel') order by created_at, id", [id])).rows;
    return {
      status: doc.status,
      versaoCongelada: doc.tipo_operacao_versao_id,
      saidas: mov.filter((m) => m.movement_type === "sale").length,
      estornos: mov.filter((m) => m.movement_type === "reversal").length,
      liquido: mov.reduce((a, m) => a + Number(m.quantity) * m.direction, 0),
      titulos: tit.length,
      titulosAtivos: tit.filter((t) => t.status !== "cancelled").length,
      titulo: tit[0],
      confirmacao: aud.find((a) => a.action === "confirm")?.metadata ?? null,
      cancelamento: aud.find((a) => a.action === "cancel")?.metadata ?? null,
      auditorias: aud.length,
    };
  });
}

let seq = 0;
const codigo = () => `26${String(++seq).padStart(2, "0")}`;
function v2(execucao: { estoque: ModoExecucaoTop; financeiro: ModoExecucaoTop }, ajuste: (c: ConfiguracaoTipoOperacaoV2) => void = () => {}) {
  const c = configuracaoNeutraTopV2();
  c.execucao = { ...execucao };
  ajuste(c);
  return c;
}
/** Estoque e financeiro, cada um: `legado`, `nenhum` (configurado sem efeito) ou o efeito real configurado. */
type Eixo = "legado" | "nenhum" | "efeito";
const configuracaoDe = (estoque: Eixo, financeiro: Eixo, ajuste: (c: ConfiguracaoTipoOperacaoV2) => void = () => {}) =>
  v2({ estoque: estoque === "legado" ? "legado" : "configurada", financeiro: financeiro === "legado" ? "legado" : "configurada" }, (c) => {
    if (estoque === "efeito") c.estoque.atualizacao = "saida";
    if (financeiro === "efeito") c.financeiro.atualizacao = "receber";
    ajuste(c);
  });

/** TOP de venda com a configuração pedida — pela instância com o gate LIGADO, como a porta exige. */
async function top(configuracao: unknown): Promise<string> {
  const r = await ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: codigo(), codigoBase: VENDA, nome: "TOP da venda", configuracao } });
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}
async function editarTop(id: string, corpo: Record<string, unknown>) {
  const d = j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers() }));
  const r = await ligada.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers(), payload: { ...corpo, revisao: d.revisao } });
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as { versao: number };
}
const versaoAtualDaTop = (id: string) => comPool(async (c) => (await c.query<{ id: string; versao: number }>(
  "select v.id, v.versao from erp.tipos_operacao t join erp.tipos_operacao_versoes v on v.tipo_operacao_id=t.id and v.versao=t.versao_atual where t.id=$1", [id])).rows[0]!);

const ITEM = { product_id: "", warehouse_id: "" as string | null, quantity: "1", unit_price: "50.00" };
async function venda(topId: string | null, extra: Record<string, unknown> = {}, itens?: typeof ITEM[]): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/sales/sales", headers: h.headers(),
    payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client,
      items: itens ?? [{ ...ITEM, product_id: I.product2, warehouse_id: I.warehouse }],
      ...(topId ? { tipo_operacao_id: topId } : {}), ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const confirmar = (app: FastifyInstance, id: string, chave?: string) =>
  app.inject({ method: "POST", url: `/api/sales/sales/${id}/confirm`, headers: h.headers(chave ? { "idempotency-key": chave } : {}) });
const cancelar = (app: FastifyInstance, id: string, chave?: string) =>
  app.inject({ method: "POST", url: `/api/sales/sales/${id}/cancel`, headers: h.headers(chave ? { "idempotency-key": chave } : {}), payload: {} });
async function confirmada(app: FastifyInstance, id: string) {
  const r = await confirmar(app, id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as { title_ids: string[] };
}

// ---------------------------------------------------------------------------------------------------
// LEGADO INTACTO
// ---------------------------------------------------------------------------------------------------
describe("legado — o comportamento anterior, intacto", () => {
  it("04A-I1 venda SEM TOP: baixa o estoque e gera o título, como sempre", async () => {
    const id = await venda(null);
    await confirmada(h.app, id);
    const e = await efeitos(id);
    expect([e.status, e.saidas, e.titulos]).toEqual(["confirmed", 1, 1]);
    expect(e.liquido).toBe(-1);
    expect(e.titulo).toMatchObject({ status: "open", due_date: "2026-09-10" });
    expect(Number(e.titulo!.amount)).toBe(50);
    expect(e.confirmacao).toMatchObject({ tipoOperacaoVersaoId: null, execucao: { origem: "sem_top", estoque: "legado", financeiro: "legado" } });
  });

  it("04A-I2 venda com TOP no FORMATO 1 — mesmo DECLARANDO 'não movimenta' e 'não gera financeiro' — executa o legado inteiro", async () => {
    // O formato 1 neutro declara `nenhuma` nos dois efeitos. Se o runtime lesse o formato 1 como decisão,
    // esta venda confirmaria SEM estoque e SEM título. É a regra histórica: o formato 1 é legado sempre.
    const neutroV1 = configuracaoNeutraTop();
    expect([neutroV1.estoque.atualizacao, neutroV1.financeiro.atualizacao]).toEqual(["nenhuma", "nenhuma"]);
    const id = await venda(await top(neutroV1));
    await confirmada(ligada, id);
    const e = await efeitos(id);
    expect([e.saidas, e.titulos]).toEqual([1, 1]);
    expect(e.confirmacao).toMatchObject({ execucao: { origem: 1, estoque: "legado", financeiro: "legado" } });
  });

  it("04A-I3 formato 2 com os dois efeitos em LEGADO executa o legado, ainda que as seções declarem 'nenhuma'", async () => {
    const id = await venda(await top(configuracaoDe("legado", "legado")));
    await confirmada(ligada, id);
    const e = await efeitos(id);
    expect([e.saidas, e.titulos]).toEqual([1, 1]);
    expect(e.confirmacao).toMatchObject({ execucao: { origem: 2, estoque: "legado", financeiro: "legado" } });
  });

  it("04A-I3b o legado não depende do gate: a instância DESLIGADA confirma v1 e v2-legado exatamente igual", async () => {
    for (const configuracao of [configuracaoNeutraTop(), configuracaoDe("legado", "legado")]) {
      const id = await venda(await top(configuracao));
      await confirmada(h.app, id);
      expect([(await efeitos(id)).saidas, (await efeitos(id)).titulos]).toEqual([1, 1]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// CONFIGURADO — cada combinação
// ---------------------------------------------------------------------------------------------------
describe("configurado — o que a versão diz é o que acontece, efeito a efeito", () => {
  const casos: { id: string; estoque: Eixo; financeiro: Eixo; saidas: number; titulos: number; resumo: { estoque: string; financeiro: string } }[] = [
    { id: "04A-I4", estoque: "nenhum", financeiro: "legado", saidas: 0, titulos: 1, resumo: { estoque: "configurada:nenhum", financeiro: "legado" } },
    { id: "04A-I5", estoque: "efeito", financeiro: "legado", saidas: 1, titulos: 1, resumo: { estoque: "configurada:saida", financeiro: "legado" } },
    { id: "04A-I6", estoque: "legado", financeiro: "nenhum", saidas: 1, titulos: 0, resumo: { estoque: "legado", financeiro: "configurada:nenhum" } },
    { id: "04A-I7", estoque: "legado", financeiro: "efeito", saidas: 1, titulos: 1, resumo: { estoque: "legado", financeiro: "configurada:receber" } },
    { id: "04A-I8", estoque: "nenhum", financeiro: "nenhum", saidas: 0, titulos: 0, resumo: { estoque: "configurada:nenhum", financeiro: "configurada:nenhum" } },
    { id: "04A-I9", estoque: "efeito", financeiro: "efeito", saidas: 1, titulos: 1, resumo: { estoque: "configurada:saida", financeiro: "configurada:receber" } },
  ];
  for (const c of casos) {
    it(`${c.id} estoque ${c.estoque} + financeiro ${c.financeiro} → ${c.saidas} saída(s), ${c.titulos} título(s)`, async () => {
      const id = await venda(await top(configuracaoDe(c.estoque, c.financeiro)));
      const r = await confirmada(ligada, id);
      const e = await efeitos(id);
      expect([e.status, e.saidas, e.titulos]).toEqual(["confirmed", c.saidas, c.titulos]);
      expect(r.title_ids.length, "a resposta diz o que foi materializado").toBe(c.titulos);
      // A EVIDÊNCIA DO DOCUMENTO: a versão usada e o que cada autoridade decidiu.
      expect(e.confirmacao).toMatchObject({ tipoOperacaoVersaoId: e.versaoCongelada, execucao: { origem: 2, ...c.resumo } });
      expect((e.confirmacao!.movimentos as string[]).length).toBe(c.saidas);
      expect((e.confirmacao!.titles as string[]).length).toBe(c.titulos);
      if (c.titulos) {
        // "a receber" configurado é o MESMO título do legado: valor, vencimento, parceiro e origem.
        expect(Number(e.titulo!.amount)).toBe(50);
        expect(e.titulo!.due_date).toBe("2026-09-10");
      }
    });
  }

  it("04A-I8b sem categoria de receita cadastrada, a venda 'sem efeito financeiro' confirma — o legado recusaria", async () => {
    await comPool((c) => c.query("update erp.financial_categories set deleted_at=now() where organization_id=$1 and nature='income' and kind='analytic'", [h.demo.orgId]));
    try {
      const semTitulo = await venda(await top(configuracaoDe("efeito", "nenhum")));
      await confirmada(ligada, semTitulo);
      expect((await efeitos(semTitulo)).titulos).toBe(0);
      // A premissa: o legado, no mesmo estado do cadastro, recusa — é o motivo de "nenhum" não consultá-lo.
      const legado = await venda(null);
      expect((await confirmar(ligada, legado)).statusCode).toBe(422);
    } finally {
      await comPool((c) => c.query("update erp.financial_categories set deleted_at=null where organization_id=$1 and nature='income' and kind='analytic'", [h.demo.orgId]));
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// EXIGÊNCIAS DA VERSÃO — recusadas antes de qualquer efeito
// ---------------------------------------------------------------------------------------------------
describe("exigências da versão congelada — conferidas TODAS antes do primeiro efeito", () => {
  it("04A-I10 armazém exigido e um item sem armazém: recusa com código próprio e ZERO efeito", async () => {
    const topId = await top(configuracaoDe("efeito", "efeito", (c) => { c.estoque.exigeArmazem = true; }));
    // Primeiro item COM armazém: sem a conferência antecipada, ele baixaria antes de a falta ser notada.
    const id = await venda(topId, {}, [
      { ...ITEM, product_id: I.product2, warehouse_id: I.warehouse },
      { ...ITEM, product_id: I.product2, warehouse_id: null },
    ]);
    const r = await confirmar(ligada, id);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
    expect(j(r).error!.details).toEqual({ exigencias: [{ caminho: "estoque.exigeArmazem", mensagem: "Informe o armazém de todos os itens" }] });
    expect(await efeitos(id)).toMatchObject({ status: "open", saidas: 0, titulos: 0, auditorias: 0 });
    // A premissa: a mesma TOP, com todos os itens no armazém, confirma e baixa os dois.
    const certa = await venda(topId, {}, [
      { ...ITEM, product_id: I.product2, warehouse_id: I.warehouse }, { ...ITEM, product_id: I.product2, warehouse_id: I.warehouse },
    ]);
    await confirmada(ligada, certa);
    expect((await efeitos(certa)).saidas).toBe(2);
  });

  it("04A-I11 forma de pagamento e vencimento exigidos e ausentes: as DUAS faltas vêm juntas, e ZERO efeito", async () => {
    const topId = await top(configuracaoDe("efeito", "efeito", (c) => { c.financeiro.exigeFormaPagamento = true; c.financeiro.exigeVencimento = true; }));
    const id = await venda(topId);
    const r = await confirmar(ligada, id);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
    expect((j(r).error!.details as { exigencias: { caminho: string }[] }).exigencias.map((x) => x.caminho))
      .toEqual(["financeiro.exigeFormaPagamento", "financeiro.exigeVencimento"]);
    expect(await efeitos(id)).toMatchObject({ status: "open", saidas: 0, titulos: 0 });
    // A premissa: com os dois dados no documento, confirma — e o vencimento é o do documento, sem recuo.
    const certa = await venda(topId, { payment_method_id: formaPagamento, due_date: "2026-10-15" });
    await confirmada(ligada, certa);
    const e = await efeitos(certa);
    expect([e.saidas, e.titulos, e.titulo!.due_date]).toEqual([1, 1, "2026-10-15"]);
  });

  it("04A-I11b exigência de um efeito que a versão NÃO executa não é cobrada (financeiro 'nenhum' com vencimento exigido)", async () => {
    const id = await venda(await top(configuracaoDe("efeito", "nenhum", (c) => { c.financeiro.exigeVencimento = true; })));
    await confirmada(ligada, id);
    expect((await efeitos(id)).titulos).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------
// GATE DESLIGADO — fail-closed, nunca legado
// ---------------------------------------------------------------------------------------------------
describe("04A-I14 — versão configurada com o gate DESLIGADO: a confirmação para, e nunca cai no legado", () => {
  it("04A-I14 409 com código próprio, ZERO estoque, ZERO título, status aberto, sem trilha — e a chave não é consumida", async () => {
    const id = await venda(await top(configuracaoDe("efeito", "efeito")));
    const r = await confirmar(h.app, id, "i14-chave");
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL");
    expect(j(r).error!.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(await efeitos(id)).toMatchObject({ status: "open", saidas: 0, titulos: 0, auditorias: 0 });
    // A mesma chave, na instância ligada, EXECUTA — a recusa não gravou a reserva da idempotência.
    const r2 = await confirmar(ligada, id, "i14-chave");
    expect(r2.statusCode, r2.body).toBe(200);
    expect(await efeitos(id)).toMatchObject({ status: "confirmed", saidas: 1, titulos: 1 });
  });

  it("04A-I14b vale para cada efeito sozinho, inclusive o que configura 'nenhum'", async () => {
    for (const [estoque, financeiro] of [["nenhum", "legado"], ["legado", "nenhum"]] as const) {
      const id = await venda(await top(configuracaoDe(estoque, financeiro)));
      const r = await confirmar(h.app, id);
      expect(r.statusCode, `${estoque}/${financeiro}: ${r.body}`).toBe(409);
      expect(await efeitos(id)).toMatchObject({ status: "open", saidas: 0, titulos: 0 });
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// A VERSÃO CONGELADA É A AUTORIDADE
// ---------------------------------------------------------------------------------------------------
describe("04A-I15 — cada documento executa a versão que capturou", () => {
  it("04A-I15 versão N saída+receber → venda A; versão N+1 nenhum+nenhum → venda B; A executa N, B executa N+1", async () => {
    const topId = await top(configuracaoDe("efeito", "efeito"));
    const vN = await versaoAtualDaTop(topId);
    const vendaA = await venda(topId);

    const editada = await editarTop(topId, { configuracao: configuracaoDe("nenhum", "nenhum") });
    const vN1 = await versaoAtualDaTop(topId);
    // A premissa: a TOP de fato avançou para N+1.
    expect([editada.versao, vN1.versao]).toEqual([vN.versao + 1, vN.versao + 1]);
    const vendaB = await venda(topId);

    await confirmada(ligada, vendaA);
    await confirmada(ligada, vendaB);
    const a = await efeitos(vendaA); const b = await efeitos(vendaB);
    expect([a.versaoCongelada, a.saidas, a.titulos]).toEqual([vN.id, 1, 1]);
    expect([b.versaoCongelada, b.saidas, b.titulos]).toEqual([vN1.id, 0, 0]);
    expect(a.confirmacao).toMatchObject({ tipoOperacaoVersaoId: vN.id });
    expect(b.confirmacao).toMatchObject({ tipoOperacaoVersaoId: vN1.id });
  });

  it("04A-I15b no sentido contrário: venda criada sob LEGADO continua legado depois de a TOP virar 'nenhum'", async () => {
    const topId = await top(configuracaoDe("legado", "legado"));
    const antiga = await venda(topId);
    await editarTop(topId, { configuracao: configuracaoDe("nenhum", "nenhum") });
    await confirmada(ligada, antiga);
    expect(await efeitos(antiga)).toMatchObject({ saidas: 1, titulos: 1 });
  });
});

describe("04A-I16 — TOP desativada ou excluída depois do lançamento", () => {
  it("04A-I16 o documento já criado confirma pela versão que capturou — sem trocar de versão em silêncio", async () => {
    // Contrato existente (TOP-CONFIG-02/03): o ponteiro congelado não muda quando a TOP muda de estado.
    const desativada = await top(configuracaoDe("nenhum", "efeito"));
    const excluida = await top(configuracaoDe("nenhum", "efeito"));
    const v1 = await venda(desativada); const v2d = await venda(excluida);
    await editarTop(desativada, { ativo: false });
    const d = j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${excluida}`, headers: h.headers() }));
    expect((await ligada.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${excluida}?revisao=${d.revisao}`, headers: h.headers() })).statusCode).toBe(200);
    for (const id of [v1, v2d]) {
      await confirmada(ligada, id);
      expect(await efeitos(id)).toMatchObject({ saidas: 0, titulos: 1 });
    }
    // A premissa: a TOP desativada NÃO aceita lançamento novo — só o documento antigo segue pela regra dele.
    const nova = await h.app.inject({ method: "POST", url: "/api/sales/sales", headers: h.headers(),
      payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items: [{ ...ITEM, product_id: I.product2, warehouse_id: I.warehouse }], tipo_operacao_id: desativada } });
    expect(nova.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------------------------------
// IDEMPOTÊNCIA, CONCORRÊNCIA E ATOMICIDADE
// ---------------------------------------------------------------------------------------------------
describe("idempotência, concorrência e atomicidade sob execução configurada", () => {
  it("04A-I17 a mesma chave duas vezes: um conjunto de efeitos, e o reenvio devolve a MESMA resposta", async () => {
    const id = await venda(await top(configuracaoDe("efeito", "efeito")));
    const r1 = await confirmar(ligada, id, "i17-chave");
    const r2 = await confirmar(ligada, id, "i17-chave");
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    expect(j(r2)).toEqual(j(r1));
    expect(await efeitos(id)).toMatchObject({ saidas: 1, titulos: 1, auditorias: 1 });
  });

  it("04A-I18 duas confirmações simultâneas: uma confirma, a outra é 409, e o efeito é único", async () => {
    const id = await venda(await top(configuracaoDe("efeito", "efeito")));
    const rs = await Promise.all([confirmar(ligada, id), confirmar(ligada, id)]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await efeitos(id)).toMatchObject({ status: "confirmed", saidas: 1, titulos: 1, auditorias: 1 });
  });

  it("04A-I19 falha do financeiro DEPOIS da saída de estoque desfaz tudo: nem estoque, nem título, nem status", async () => {
    const topId = await top(configuracaoDe("efeito", "efeito"));
    const id = await venda(topId);
    await comPool((c) => c.query("update erp.financial_categories set deleted_at=now() where organization_id=$1 and nature='income' and kind='analytic'", [h.demo.orgId]));
    let r: Resposta;
    try { r = await confirmar(ligada, id); }
    finally { await comPool((c) => c.query("update erp.financial_categories set deleted_at=null where organization_id=$1 and nature='income' and kind='analytic'", [h.demo.orgId])); }
    expect(r.statusCode, r.body).toBe(422);
    expect(await efeitos(id)).toMatchObject({ status: "open", saidas: 0, titulos: 0, auditorias: 0 });
    // A premissa: com o cadastro restaurado, a mesma venda confirma e materializa os dois.
    await confirmada(ligada, id);
    expect(await efeitos(id)).toMatchObject({ saidas: 1, titulos: 1 });
  });

  it("04A-I20 estoque insuficiente numa saída configurada desfaz tudo: nenhum título nasce", async () => {
    const topId = await top(configuracaoDe("efeito", "efeito"));
    const id = await venda(topId, {}, [{ ...ITEM, product_id: I.product2, warehouse_id: I.warehouse, quantity: "999999" }]);
    const r = await confirmar(ligada, id);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("INSUFFICIENT_STOCK");
    expect(await efeitos(id)).toMatchObject({ status: "open", saidas: 0, titulos: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------
// CANCELAMENTO — só o que foi materializado
// ---------------------------------------------------------------------------------------------------
describe("cancelamento — estorna SÓ o que foi materializado, uma vez", () => {
  it("04A-C1 legado: estorna o estoque e cancela o título (regressão)", async () => {
    const id = await venda(null);
    await confirmada(h.app, id);
    expect((await cancelar(h.app, id)).statusCode).toBe(200);
    const e = await efeitos(id);
    expect([e.status, e.saidas, e.estornos, e.liquido, e.titulos, e.titulosAtivos]).toEqual(["cancelled", 1, 1, 0, 1, 0]);
    expect(e.cancelamento).toEqual({ estornos: 1, titulosCancelados: 1 });
  });

  const casos: { id: string; estoque: Eixo; financeiro: Eixo; estornos: number; titulos: number }[] = [
    { id: "04A-C2", estoque: "efeito", financeiro: "efeito", estornos: 1, titulos: 1 },
    { id: "04A-C3", estoque: "efeito", financeiro: "nenhum", estornos: 1, titulos: 0 },
    { id: "04A-C4", estoque: "nenhum", financeiro: "efeito", estornos: 0, titulos: 1 },
    { id: "04A-C5", estoque: "nenhum", financeiro: "nenhum", estornos: 0, titulos: 0 },
  ];
  for (const c of casos) {
    it(`${c.id} configurado (estoque ${c.estoque}, financeiro ${c.financeiro}): ${c.estornos} estorno(s), ${c.titulos} título(s) cancelado(s) — com o gate DESLIGADO`, async () => {
      const id = await venda(await top(configuracaoDe(c.estoque, c.financeiro)));
      await confirmada(ligada, id);
      // Cancelar não pergunta ao gate nem à configuração: a instância desligada cancela pelo que EXISTE.
      const r = await cancelar(h.app, id);
      expect(r.statusCode, r.body).toBe(200);
      const e = await efeitos(id);
      expect([e.status, e.estornos, e.liquido, e.titulos, e.titulosAtivos]).toEqual(["cancelled", c.estornos, 0, c.titulos, 0]);
      expect(e.cancelamento).toEqual({ estornos: c.estornos, titulosCancelados: c.titulos });
    });
  }

  it("04A-C5b editar a TOP depois da confirmação não muda o que o cancelamento estorna", async () => {
    const topId = await top(configuracaoDe("nenhum", "nenhum"));
    const id = await venda(topId);
    await confirmada(ligada, id);
    await editarTop(topId, { configuracao: configuracaoDe("efeito", "efeito") });
    expect((await cancelar(ligada, id)).statusCode).toBe(200);
    expect(await efeitos(id)).toMatchObject({ estornos: 0, titulos: 0, cancelamento: { estornos: 0, titulosCancelados: 0 } });
  });

  it("04A-C6 dois cancelamentos simultâneos: um cancela, o outro é 409, e o estorno é único", async () => {
    const id = await venda(await top(configuracaoDe("efeito", "efeito")));
    await confirmada(ligada, id);
    const rs = await Promise.all([cancelar(ligada, id), cancelar(h.app, id)]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await efeitos(id)).toMatchObject({ status: "cancelled", estornos: 1, liquido: 0, titulosAtivos: 0 });
  });

  it("04A-C7 a mesma chave de cancelamento duas vezes: um estorno, e o reenvio devolve a mesma resposta", async () => {
    const id = await venda(await top(configuracaoDe("efeito", "nenhum")));
    await confirmada(ligada, id);
    const r1 = await cancelar(ligada, id, "c7-chave");
    const r2 = await cancelar(ligada, id, "c7-chave");
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    expect(j(r2)).toEqual(j(r1));
    expect(await efeitos(id)).toMatchObject({ estornos: 1, liquido: 0, titulos: 0 });
  });
});
