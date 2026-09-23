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
 * NOMES DOS CASOS. `04A-I1`…`04A-I20` e `04A-C1`…`04A-C7` são os da missão; `04A-I21` veio da revisão
 * adversarial, e `04A-C8`…`C8d` (título baixado) e `04A-P1`…`P3` (paridade campo a campo com o legado), da
 * revisão R1. O prefixo existe porque `sales-confirm-cancel-concorrencia.test.ts` já usa C1–C6 para outra
 * matriz, e um relatório que citasse "C3" sem prefixo não diria de qual dos dois arquivos.
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
      items: itens ?? [{ ...ITEM, product_id: I.product2!, warehouse_id: I.warehouse! }],
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
      { ...ITEM, product_id: I.product2!, warehouse_id: I.warehouse! },
      { ...ITEM, product_id: I.product2!, warehouse_id: null },
    ]);
    const r = await confirmar(ligada, id);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
    expect(j(r).error!.details).toEqual({ exigencias: [{ caminho: "estoque.exigeArmazem", mensagem: "Informe o armazém de todos os itens" }] });
    expect(await efeitos(id)).toMatchObject({ status: "open", saidas: 0, titulos: 0, auditorias: 0 });
    // A premissa: a mesma TOP, com todos os itens no armazém, confirma e baixa os dois.
    const certa = await venda(topId, {}, [
      { ...ITEM, product_id: I.product2!, warehouse_id: I.warehouse! }, { ...ITEM, product_id: I.product2!, warehouse_id: I.warehouse! },
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
      payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items: [{ ...ITEM, product_id: I.product2!, warehouse_id: I.warehouse! }], tipo_operacao_id: desativada } });
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
    const id = await venda(topId, {}, [{ ...ITEM, product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "999999" }]);
    const r = await confirmar(ligada, id);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("INSUFFICIENT_STOCK");
    expect(await efeitos(id)).toMatchObject({ status: "open", saidas: 0, titulos: 0 });
  });

  it("04A-I21 o id na URL em MAIÚSCULAS confirma a venda configurada: a marca da 0023 usa o id canônico da linha", async () => {
    // O Postgres aceita o UUID em maiúsculas e acha a linha; o gatilho compara a marca com `NEW.id::text`,
    // que é minúsculo. Gravar a marca com o texto cru da URL faria a própria guarda recusar uma confirmação
    // legítima, com um diagnóstico de "binário anterior".
    const id = await venda(await top(configuracaoDe("efeito", "efeito")));
    const r = await confirmar(ligada, id.toUpperCase());
    expect(r.statusCode, r.body).toBe(200);
    expect(await efeitos(id)).toMatchObject({ status: "confirmed", saidas: 1, titulos: 1 });
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

// ---------------------------------------------------------------------------------------------------
// CANCELAMENTO COM TÍTULO BAIXADO — a fronteira do legado vale igual para a venda configurada (revisão R1)
// ---------------------------------------------------------------------------------------------------
/** Baixa do título a receber pela MESMA porta que a tela usa (a mesma do P1 do arquivo de concorrência). */
async function baixar(tituloId: string, valor: string) {
  const r = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${tituloId}/settle`, headers: h.headers(),
    payload: { settlement_date: "2026-09-11", bank_account_id: I.bankAccount, amount: valor } });
  expect(r.statusCode, r.body).toBe(201);
  const b = j(r);
  return { settlementId: b.settlement_id as string, movimentoId: b.bank_movement_id as string, status: b.status as string };
}
async function desfazerBaixa(tituloId: string, baixaId: string) {
  const r = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${tituloId}/settlements/${baixaId}/cancel`,
    headers: h.headers(), payload: { reason: "Baixa indevida" } });
  expect(r.statusCode, r.body).toBe(200);
}
/** O lado financeiro que a recusa tem de deixar intacto: título, baixa e movimento bancário. */
const financeiroDe = (tituloId: string, baixaId: string, movimentoId: string) => comPool(async (c) => ({
  titulo: (await c.query<{ status: string; paid_amount: string }>("select status, paid_amount::text as paid_amount from erp.financial_titles where id=$1", [tituloId])).rows[0]!,
  baixa: (await c.query<{ status: string }>("select status from erp.title_settlements where id=$1", [baixaId])).rows[0]!.status,
  movimento: (await c.query<{ status: string }>("select status from erp.bank_movements where id=$1", [movimentoId])).rows[0]!.status,
}));
const RECUSA_BAIXA = { code: "CONFLICT", message: "Títulos com baixa: cancele as baixas antes" };

describe("04A-C8 — título com baixa: a venda configurada recusa o cancelamento EXATAMENTE como o legado", () => {
  const casos: { id: string; estoque: Eixo; valor: string; statusTitulo: string; saidas: number }[] = [
    { id: "04A-C8", estoque: "efeito", valor: "10.00", statusTitulo: "partially_paid", saidas: 1 },
    { id: "04A-C8b", estoque: "efeito", valor: "50.00", statusTitulo: "paid", saidas: 1 },
    { id: "04A-C8c", estoque: "nenhum", valor: "10.00", statusTitulo: "partially_paid", saidas: 0 },
  ];
  for (const c of casos) {
    it(`${c.id} estoque ${c.estoque} + financeiro receber, título ${c.statusTitulo}: 409 do legado, ZERO efeito, nas duas instâncias; desfeita a baixa, cancela`, async () => {
      const id = await venda(await top(configuracaoDe(c.estoque, "efeito")));
      const tituloId = (await confirmada(ligada, id)).title_ids[0]!;
      const baixa = await baixar(tituloId, c.valor);
      expect(baixa.status, "premissa: a baixa mudou o título").toBe(c.statusTitulo);
      const antes = await efeitos(id);
      const finAntes = await financeiroDe(tituloId, baixa.settlementId, baixa.movimentoId);
      expect(finAntes).toMatchObject({ titulo: { status: c.statusTitulo }, baixa: "confirmed", movimento: "confirmed" });

      // Cancelar não depende do gate: a instância DESLIGADA e a LIGADA recusam igual — com chave, para provar
      // que a recusa não consome a reserva da idempotência.
      const chave = `${c.id}-chave`;
      for (const app of [h.app, ligada]) {
        const r = await cancelar(app, id, chave);
        expect(r.statusCode, r.body).toBe(409);
        expect(j(r).error).toEqual(RECUSA_BAIXA);
      }
      // ZERO efeito, contado no banco: documento, estoque, títulos, trilha — e o lado financeiro da baixa.
      const depois = await efeitos(id);
      expect(depois).toEqual(antes);
      expect(depois).toMatchObject({ status: "confirmed", saidas: c.saidas, estornos: 0, liquido: 0 - c.saidas, titulos: 1, titulosAtivos: 1, cancelamento: null, auditorias: 1 });
      expect(await financeiroDe(tituloId, baixa.settlementId, baixa.movimentoId)).toEqual(finAntes);

      // LEGADO: a mesma baixa numa venda sem TOP produz a MESMA resposta — status, código e mensagem.
      const legado = await venda(null);
      const tituloLegado = (await confirmada(h.app, legado)).title_ids[0]!;
      await baixar(tituloLegado, c.valor);
      const rl = await cancelar(h.app, legado);
      const rc = await cancelar(h.app, id);
      expect([rc.statusCode, j(rc).error]).toEqual([rl.statusCode, j(rl).error]);
      expect(await efeitos(legado)).toMatchObject({ status: "confirmed", estornos: 0, titulosAtivos: 1, cancelamento: null });

      // A PREMISSA: desfeita a baixa, a MESMA venda — e a MESMA chave — cancela, estornando só o materializado.
      await desfazerBaixa(tituloId, baixa.settlementId);
      const ok = await cancelar(h.app, id, chave);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(await efeitos(id)).toMatchObject({ status: "cancelled", estornos: c.saidas, liquido: 0, titulosAtivos: 0,
        cancelamento: { estornos: c.saidas, titulosCancelados: 1 } });
    }, 120_000);
  }

  it("04A-C8d duas parcelas, SÓ a segunda baixada: a recusa é do documento inteiro — nenhuma parcela é cancelada", async () => {
    const id = await venda(await top(configuracaoDe("efeito", "efeito")),
      { installment_plan: { installments: 2, first_due_date: "2026-10-10", mode: "interval", interval_days: 30 } });
    const { title_ids } = await confirmada(ligada, id);
    expect(title_ids.length, "premissa: duas parcelas").toBe(2);
    await baixar(title_ids[1]!, "10.00");
    const r = await cancelar(h.app, id);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error).toEqual(RECUSA_BAIXA);
    expect(await efeitos(id)).toMatchObject({ status: "confirmed", saidas: 1, estornos: 0, titulos: 2, titulosAtivos: 2, cancelamento: null });
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------
// PARIDADE CAMPO A CAMPO — "saída + a receber" configurados gravam EXATAMENTE o que o legado grava (R1)
// ---------------------------------------------------------------------------------------------------

/**
 * A LINHA INTEIRA, com número em TEXTO. `to_jsonb(<alias>)` traz TODA coluna — inclusive a que uma migration
 * futura acrescentar: ela entra na comparação sozinha e só sai com motivo escrito em `normalizar`. O `numeric`
 * vira texto NO BANCO (`#>> '{}'` preserva a escala), sem ponto flutuante; `date` chega `YYYY-MM-DD`, sem o
 * fuso do driver. `alias` é literal deste arquivo, nunca entrada.
 */
const LINHA = (alias: string) =>
  `(select jsonb_object_agg(e.key, case jsonb_typeof(e.value) when 'number' then to_jsonb(e.value #>> '{}') else e.value end) from jsonb_each(to_jsonb(${alias})) e)`;
type Linha = Record<string, unknown>;
const linhas = async (c: Db, sql: string, p: unknown[]) => (await c.query<{ linha: Linha }>(sql, p)).rows.map((r) => r.linha);
const sem = (l: Linha, fora: readonly string[]) => Object.fromEntries(Object.entries(l).filter(([k]) => !fora.includes(k)));
const alteradas = (antes: unknown, depois: unknown) => {
  const a = (antes ?? {}) as Linha; const d = (depois ?? {}) as Linha;
  return Object.keys(d).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k])).sort();
};
const marcaDaAuditoria = () => comPool(async (c) => (await c.query<{ m: string }>("select coalesce(max(id), 0)::text as m from erp.audit_logs")).rows[0]!.m);

type Par = readonly [warehouseId: string, productId: string];
/** O estoque que a venda toca: saldo (cache) de cada par e o custo médio consolidado de cada produto. */
const estadoDoEstoque = (pares: readonly Par[]) => comPool(async (c) => ({
  // `version` conta todo movimento já aplicado (inclusive os estornos entre referências) e `updated_at` é
  // relógio: nenhum dos dois é ESTADO do estoque.
  saldos: (await linhas(c, `select ${LINHA("b")} as linha from erp.stock_balances b
      join unnest($2::uuid[], $3::uuid[]) as p(warehouse_id, product_id) on p.warehouse_id=b.warehouse_id and p.product_id=b.product_id
     where b.organization_id=$1 order by b.warehouse_id, b.product_id, b.provider_lot`,
    [h.demo.orgId, pares.map(([w]) => w), pares.map(([, p]) => p)])).map((b) => sem(b, ["version", "updated_at"])),
  custoMedio: (await c.query<{ id: string; average_cost: string }>("select id, average_cost::text as average_cost from erp.products where id = any($1::uuid[]) order by id",
    [[...new Set(pares.map(([, p]) => p))]])).rows,
}));

/**
 * O que a CONFIRMAÇÃO gravou, por origem, e a trilha INTEIRA que ela deixou (janela de `audit_logs.id`).
 * Ordem sempre pela CHAVE NATURAL: as linhas de UMA confirmação têm o mesmo `created_at` (`now()` é o
 * instante da transação) — ordenar por ele não ordena nada.
 */
async function capturarConfirmacao(docId: string, marca: string, resposta: { status: string; title_ids: string[] }) {
  return comPool(async (c) => {
    const p = [h.demo.orgId, docId];
    const [documento] = await linhas(c, `select ${LINHA("d")} as linha from erp.sales_documents d where d.organization_id=$1 and d.id=$2`, p);
    return {
      docId, resposta, documento: documento!, codigo: String(documento!.code),
      itens: await linhas(c, `select ${LINHA("i")} as linha from erp.sales_document_items i join erp.sales_documents d on d.id=i.document_id where d.organization_id=$1 and d.id=$2 order by i.position`, p),
      movimentos: await linhas(c, `select ${LINHA("m")} as linha from erp.stock_movements m where m.organization_id=$1 and m.source_type='sales_documents' and m.source_id=$2 and m.movement_type='sale' order by m.warehouse_id, m.product_id`, p),
      titulos: await linhas(c, `select ${LINHA("t")} as linha from erp.financial_titles t where t.organization_id=$1 and t.source_type='sales_documents' and t.source_id=$2 order by t.installment_number`, p),
      rateios: await linhas(c, `select ${LINHA("a")} as linha from erp.title_apportionments a join erp.financial_titles t on t.id=a.title_id where t.organization_id=$1 and t.source_type='sales_documents' and t.source_id=$2 order by t.installment_number, a.financial_category_id, a.cost_center_id`, p),
      globais: await linhas(c, `select ${LINHA("g")} as linha from erp.registros_globais g join erp.financial_titles t on t.id=g.id_entidade and t.organization_id=g.organization_id where g.organization_id=$1 and g.tipo_entidade='financial_titles' and t.source_type='sales_documents' and t.source_id=$2 order by t.installment_number`, p),
      auditoria: await linhas(c, `select ${LINHA("a")} as linha from erp.audit_logs a where a.organization_id=$1 and a.id > $2::bigint order by a.id`, [h.demo.orgId, marca]),
    };
  });
}
type Confirmacao = Awaited<ReturnType<typeof capturarConfirmacao>>;

async function capturarCancelamento(docId: string, marca: string) {
  return comPool(async (c) => {
    const p = [h.demo.orgId, docId];
    return {
      estornos: await linhas(c, `select ${LINHA("m")} as linha from erp.stock_movements m where m.organization_id=$1 and m.source_type='sales_documents' and m.source_id=$2 and m.movement_type='reversal' order by m.warehouse_id, m.product_id`, p),
      titulos: await linhas(c, `select ${LINHA("t")} as linha from erp.financial_titles t where t.organization_id=$1 and t.source_type='sales_documents' and t.source_id=$2 order by t.installment_number`, p),
      auditoria: await linhas(c, `select ${LINHA("a")} as linha from erp.audit_logs a where a.organization_id=$1 and a.id > $2::bigint order by a.id`, [h.demo.orgId, marca]),
    };
  });
}
type Cancelamento = Awaited<ReturnType<typeof capturarCancelamento>>;

/**
 * O QUE PODE DIFERIR entre duas confirmações do MESMO conteúdo — e só isto (lista fechada):
 *   relógio             created_at, updated_at, criado_em; a data do ESTORNO (`new Date()` no cancelamento)
 *   identidade técnica  id aleatório → apelido estável onde é REFERÊNCIA (<DOC>, <M0>, <T0>)
 *   identidade do doc   source_id; number `VND-<código>`; note `Venda <código>` / `estorno de <movimento>`
 *   contador da org.    financial_titles.code, registros_globais.id_global → DESLOCAMENTO dentro do documento
 *   aleatório do doc    group_id → "<GRUPO>", o MESMO em todas as parcelas
 * TRILHA (`audit_logs`): comparada por PROJEÇÃO, não linha inteira — organização, entidade, ação, id (apelido),
 * usuário, ip; em `update`, os nomes das colunas alteradas; em `confirm`, a metadata inteira salvo as duas chaves
 * que diferem por desenho. Produto: só `average_cost` (o estado do estoque que a venda toca).
 * Toda outra coluna das tabelas de efeito — saldo após, custo unitário, custo total e custo médio após inclusive — é comparada CRUA:
 * o cancelamento entre referências devolve o estoque ao MESMO ponto de partida (premissa conferida no teste).
 */
function normalizar(cf: Confirmacao, cc: Cancelamento) {
  const apelido = new Map<string, string>([[cf.docId, "<DOC>"]]);
  cf.movimentos.forEach((m, i) => apelido.set(String(m.id), `<M${i}>`));
  cf.titulos.forEach((t, i) => apelido.set(String(t.id), `<T${i}>`));
  const ap = (v: unknown) => (typeof v === "string" && apelido.has(v) ? apelido.get(v)! : v);
  // Só a FORMA exata é trocada: texto fora do molde fica cru, e a comparação acusa.
  const prefixo = `VND-${cf.codigo}`;
  const numero = (v: unknown) => (typeof v === "string" && v.startsWith(prefixo) ? `VND-<COD>${v.slice(prefixo.length)}` : v);
  const nota = (v: unknown) => v === `Venda ${cf.codigo}` ? "Venda <COD>"
    : typeof v === "string" && v.startsWith("estorno de ") ? `estorno de ${String(ap(v.slice("estorno de ".length)))}` : v;
  const desloc = (ls: Linha[], col: string, l: Linha) => Number(l[col]) - Number(ls[0]![col]);
  const grupo = cf.titulos[0]?.group_id ?? null;
  const movimento = (m: Linha) => ({ ...sem(m, ["id", "created_at"]), source_id: ap(m.source_id), reversed_by: ap(m.reversed_by), note: nota(m.note),
    movement_date: m.movement_type === "reversal" ? "<DATA DO CANCELAMENTO>" : m.movement_date });
  const titulo = (t: Linha) => ({ ...sem(t, ["id", "created_at", "updated_at"]), code: desloc(cf.titulos, "code", t),
    number: numero(t.number), note: nota(t.note), source_id: ap(t.source_id),
    group_id: t.group_id === null ? null : t.group_id === grupo ? "<GRUPO>" : t.group_id });
  const trilha = (a: Linha) => {
    // PROJEÇÃO declarada (não a linha inteira): `before`/`after` carregam relógio e ids de cada documento, então
    // `update` compara só os NOMES das colunas alteradas e `create` compara a linha na própria tabela.
    const base = { organization_id: a.organization_id, entity: a.entity, action: a.action, entity_id: ap(a.entity_id), user_id: a.user_id, ip: a.ip };
    if (a.action === "update") return { ...base, alteradas: alteradas(a.before, a.after) };
    if (a.action === "confirm") {
      // A metadata INTEIRA, menos `tipoOperacaoVersaoId` e `execucao` — que diferem POR DESENHO e são conferidos
      // à parte, referência a referência. Uma chave nova só num dos caminhos reprova aqui.
      const { tipoOperacaoVersaoId: _v, execucao: _e, titles, movimentos, ...resto } = a.metadata as { titles: string[]; movimentos: string[] } & Record<string, unknown>;
      return { ...base, metadata: { ...resto, titles: titles.map(ap), movimentos: movimentos.map(ap) } };
    }
    if (a.action === "cancel") return { ...base, metadata: a.metadata };
    return base; // `create` de título: a linha inteira já é comparada na própria tabela
  };
  return {
    documento: sem(cf.documento, ["id", "code", "created_at", "updated_at", "tipo_operacao_id", "tipo_operacao_versao_id"]),
    itens: cf.itens.map((i) => sem(i, ["id", "document_id"])),
    resposta: { status: cf.resposta.status, title_ids: cf.resposta.title_ids.map(ap) },
    movimentos: cf.movimentos.map(movimento),
    titulos: cf.titulos.map(titulo),
    rateios: cf.rateios.map((a) => ({ ...sem(a, ["id"]), title_id: ap(a.title_id) })),
    globais: cf.globais.map((g) => ({ ...sem(g, ["criado_em"]), id_global: desloc(cf.globais, "id_global", g), id_entidade: ap(g.id_entidade),
      rota_canonica: String(g.rota_canonica).replace(String(g.id_entidade), String(ap(g.id_entidade))) })),
    auditoria: cf.auditoria.map(trilha),
    cancelamento: {
      estornos: cc.estornos.map(movimento),
      titulos: cc.titulos.map(titulo),
      // O estorno percorre os movimentos em ordem de `created_at`, que EMPATA dentro da confirmação: a ordem de
      // inserção dos estornos não é contrato, e a trilha do cancelamento compara como multiconjunto.
      auditoria: cc.auditoria.map((a) => JSON.stringify(trilha(a))).sort(),
    },
  };
}

describe("04A-P — paridade campo a campo: 'saída + a receber' configurados gravam EXATAMENTE o que o legado grava", () => {
  // Pares (armazém, produto) que NENHUM outro caso deste arquivo toca: o ponto de partida é só o saldo inicial
  // abaixo, não o que a ordem dos casos anteriores deixou.
  const pares = (): Par[] => [[I.warehouse!, I.product!], [I.warehouse2!, I.product2!]];
  const itens = () => [
    { product_id: I.product!, warehouse_id: I.warehouse! as string | null, quantity: "3", unit_price: "40.00" },
    { product_id: I.product2!, warehouse_id: I.warehouse2! as string | null, quantity: "2", unit_price: "12.35" },
    // Sem armazém: o legado não baixa, e a saída configurada sem `exigeArmazem` também não.
    { product_id: I.product!, warehouse_id: null as string | null, quantity: "1", unit_price: "5.00" },
  ];
  // Todo campo que a confirmação LÊ tem valor distinto dos seus recuos: saída ≠ documento ≠ vencimento,
  // parcelas com centavo residual, dedutível ligado. Um caminho que lesse o campo errado divergiria.
  const cenarios = [
    { id: "04A-P1", nome: "parcelado com entrada", movimentos: 2, titulos: 4, corpo: () => ({ shipping_date: "2026-09-12", due_date: "2026-10-05", payment_method_id: formaPagamento, freight: "10.00", discount: "3.33", is_deductible: true,
        installment_plan: { installments: 3, first_due_date: "2026-10-10", mode: "interval", interval_days: 30, has_down_payment: true, down_payment_value: "20.00", down_payment_date: "2026-09-12" } }) },
    { id: "04A-P2", nome: "à vista com vencimento", movimentos: 2, titulos: 1, corpo: () => ({ shipping_date: "2026-09-12", due_date: "2026-10-05", payment_method_id: formaPagamento, freight: "10.00", discount: "3.33" }) },
    { id: "04A-P3", nome: "sem vencimento nem parcelas (o título recua para a data do documento)", movimentos: 2, titulos: 1, corpo: () => ({}) },
  ];
  type Referencia = { nome: string; topId: string | null; app: FastifyInstance; execucao: Record<string, unknown> };
  let referencias: Referencia[];

  beforeAll(async () => {
    for (const [warehouse_id, product_id, quantity, unit_value] of [[I.warehouse!, I.product!, "100", "7.50"], [I.warehouse2!, I.product2!, "60", "12.00"]] as const) {
      const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(), payload: { empresa_id: I.empresa, warehouse_id, product_id, quantity, unit_value } });
      expect(r.statusCode, r.body).toBe(201);
    }
    // A referência é a venda SEM TOP; as outras três têm de ser indistinguíveis dela, salvo o que é POR DESENHO.
    referencias = [
      { nome: "sem TOP", topId: null, app: h.app, execucao: { origem: "sem_top", estoque: "legado", financeiro: "legado" } },
      { nome: "TOP formato 1", topId: await top(configuracaoNeutraTop()), app: h.app, execucao: { origem: 1, estoque: "legado", financeiro: "legado" } },
      { nome: "TOP formato 2 legado/legado", topId: await top(configuracaoDe("legado", "legado")), app: h.app, execucao: { origem: 2, estoque: "legado", financeiro: "legado" } },
      { nome: "TOP formato 2 saída + a receber", topId: await top(configuracaoDe("efeito", "efeito")), app: ligada, execucao: { origem: 2, estoque: "configurada:saida", financeiro: "configurada:receber" } },
    ];
  }, 120_000);

  async function executar(ref: Referencia, corpo: Record<string, unknown>) {
    const docId = await venda(ref.topId, corpo, itens());
    const antes = await estadoDoEstoque(pares());
    const marca = await marcaDaAuditoria();
    const r = await confirmar(ref.app, docId);
    expect(r.statusCode, `${ref.nome}: ${r.body}`).toBe(200);
    const confirmacao = await capturarConfirmacao(docId, marca, j(r) as unknown as { status: string; title_ids: string[] });
    const depoisDaConfirmacao = await estadoDoEstoque(pares());
    // O cancelamento devolve o estoque ao MESMO ponto de partida para a próxima referência — é o que deixa
    // saldo após e custo na comparação CRUA.
    const marcaCancel = await marcaDaAuditoria();
    const dias = [new Date().toISOString().slice(0, 10)];
    const rc = await cancelar(h.app, docId);
    dias.push(new Date().toISOString().slice(0, 10));
    expect(rc.statusCode, `${ref.nome}: ${rc.body}`).toBe(200);
    const cancelamento = await capturarCancelamento(docId, marcaCancel);
    return { antes, confirmacao, depoisDaConfirmacao, cancelamento, depois: await estadoDoEstoque(pares()), dias };
  }

  for (const cen of cenarios) {
    it(`${cen.id} ${cen.nome}: sem TOP ≡ formato 1 ≡ formato 2 legado ≡ formato 2 configurado, linha a linha`, async () => {
      const execs: { ref: Referencia; x: Awaited<ReturnType<typeof executar>> }[] = [];
      for (const ref of referencias) execs.push({ ref, x: await executar(ref, cen.corpo()) });
      const base = execs[0]!;
      const esperado = normalizar(base.x.confirmacao, base.x.cancelamento);

      // PREMISSAS — o que impede "igual" de ser "igualmente vazio" ou "igual por acaso".
      expect(base.x.confirmacao.movimentos).toHaveLength(cen.movimentos);
      expect(base.x.confirmacao.titulos).toHaveLength(cen.titulos);
      expect(base.x.confirmacao.rateios).toHaveLength(cen.titulos);
      expect(base.x.confirmacao.globais).toHaveLength(cen.titulos);
      expect(base.x.cancelamento.estornos).toHaveLength(cen.movimentos);
      expect(esperado.auditoria.map((a) => `${String(a.entity)}/${String(a.action)}`), "a janela da trilha é exatamente a confirmação").toEqual([
        ...Array<string>(cen.movimentos).fill("products/update"), ...Array<string>(cen.titulos).fill("financial_titles/create"),
        "sales_documents/update", "sales_documents/confirm"]);
      expect(base.x.depoisDaConfirmacao, "a confirmação mexeu no estoque").not.toEqual(base.x.antes);
      expect(base.x.depois, "o cancelamento devolveu o estoque ao ponto de partida").toEqual(base.x.antes);

      for (const { ref, x } of execs) {
        // POR DESENHO — e só isto difere: a TOP citada e quem decidiu cada efeito. É também a prova de que o
        // caminho configurado EXECUTOU (sem isto, uma venda configurada que caísse no legado passaria).
        const doc = x.confirmacao.documento;
        const meta = x.confirmacao.auditoria.find((a) => a.action === "confirm")!.metadata as Record<string, unknown>;
        expect(doc.tipo_operacao_id ?? null, ref.nome).toBe(ref.topId);
        if (ref.topId) expect(doc.tipo_operacao_versao_id, ref.nome).toEqual(expect.any(String));
        expect(meta.tipoOperacaoVersaoId, ref.nome).toBe(doc.tipo_operacao_versao_id ?? null);
        expect(meta.execucao, ref.nome).toEqual(ref.execucao);
        for (const e of x.cancelamento.estornos) expect(x.dias, ref.nome).toContain(e.movement_date);
      }
      for (const { ref, x } of execs.slice(1)) {
        expect(x.antes, `${ref.nome}: o MESMO ponto de partida`).toEqual(base.x.antes);
        expect(x.depoisDaConfirmacao, `${ref.nome}: o MESMO estoque depois de confirmar`).toEqual(base.x.depoisDaConfirmacao);
        expect(x.depois, `${ref.nome}: o MESMO estoque depois de cancelar`).toEqual(base.x.antes);
        expect(normalizar(x.confirmacao, x.cancelamento), ref.nome).toEqual(esperado);
      }
    }, 120_000);
  }
});
