import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, seedDemo, type Db } from "@agro/db";
import {
  MATRIZ_EXECUCAO_TOP,
  configuracaoNeutraTopV2,
  type ConfiguracaoTipoOperacaoV2,
  type ModoExecucaoTop,
} from "@agro/domain";
import { appCom, escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * A PRÉVIA DA CONFIRMAÇÃO DA VENDA (VENDAS-A5-1) — o que a confirmação faria AGORA, sem fazer nada.
 *
 * O QUE ESTÁ SOB TESTE. `GET /api/sales/sales/:id/previa-confirmacao` roda o MESMO `planejarConfirmacao` da
 * confirmação, num modo que anota as recusas em vez de lançá-las, sem trava e sem escrita. A tela passa a
 * dizer o efeito da venda a partir dela; se a prévia divergir da confirmação, a tela promete o que o servidor
 * não faz — exatamente o defeito que a fatia fecha. Por isso quase toda asserção decisiva aqui é uma
 * IGUALDADE entre a prévia e a execução real, e não um valor esperado escrito à mão.
 *
 * NOMES DOS CASOS. `A5-C1`…`A5-C10` e `A5-P1` são os da missão; `A5-C11` (a prévia não trava a venda, a
 * categoria nem o centro) é o teste que a reversa RV5 deixa vermelho; `A5-C12` (a recusa da conta de parcelas)
 * o da RV6. O prefixo existe porque outros arquivos de venda usam C1…C8.
 *
 * DUAS INSTÂNCIAS DA API sobre o mesmo banco, como em `sales-top-execucao.test.ts`: `h.app` com o gate da
 * execução configurada DESLIGADO (o padrão de produção) e `ligada` com `TOP_EFFECTS_RUNTIME_V1_ENABLED=1`. A
 * prévia lê o gate da PRÓPRIA instância — a mesma venda pode ser confirmável numa e recusada na outra.
 *
 * O QUE CONTA COMO PROVA. O que a confirmação fez é CONTADO no banco por conexão própria (movimentos,
 * títulos, rateios, trilha), nunca lido da resposta. Toda "igualdade" vem com a PREMISSA de que os dois
 * lados não são igualmente vazios, e todo "zero efeito" vem com o mesmo cenário, corrigido, produzindo o
 * efeito — senão "zero" poderia ser só um cenário que nunca funcionaria.
 *
 * UMA TABELA DE CENÁRIOS. Os cenários C1…C8 e C12 são montados por funções únicas (`CENARIOS`), usadas pelos
 * casos C (asserções concretas de cada um) e pela paridade P1 (a mesma régua sobre todos). Uma segunda cópia
 * do cenário para a P1 poderia envelhecer diferente da do caso C e a tabela mediria outra coisa.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let formaPagamento: string;
/** A classificação dos documentos deste arquivo: ativa, analítica, de receita — e FORA do topo da ordem. */
let CAT: string; let CC: string;
beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  formaPagamento = await comPool(async (c) => (await c.query<{ id: string }>("select id from erp.payment_methods where organization_id=$1 or organization_id is null order by name limit 1", [h.demo.orgId])).rows[0]!.id);
  // Estoque para a suíte inteira nos DOIS armazéns da empresa 1: a venda "cheia" baixa em ambos. Cada
  // confirmação consome no máximo três unidades — o que se semeia aqui é folga, não número mágico.
  for (const warehouse_id of [I.warehouse, I.warehouse2]) {
    const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
      payload: { empresa_id: I.empresa, warehouse_id, product_id: I.product2, quantity: "500", unit_value: "10" } });
    expect(r.statusCode, r.body).toBe(201);
  }
  CAT = await categoria("9.A5.001", "Receita classificada A5");
  CC = await centro("9.A5.001", "Centro classificado A5");
}, 180_000);
afterAll(async () => { await ligada?.close(); await h.app.close(); await h.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Hdr = Record<string, string>;
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
const VENDA = MATRIZ_EXECUCAO_TOP[0]!.familia;
const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** O corpo da prévia, na forma do contrato 1 (a mesma que `apps/web/src/features/sales/previa-confirmacao.ts` lê). */
interface Ref { id: string; codigo: string; nome: string }
interface Previa {
  contractVersion: number;
  podeConfirmar: boolean;
  recusas: Erro[];
  estoque: { efeito: "baixa" | "nenhum" | null; itensQueBaixam: number; itensSemArmazem: number };
  financeiro: {
    efeito: "receber" | "nenhum" | null; valor: string | null; primeiroVencimento: string | null;
    classificacao: { origem: "documento" | "padrão legado"; categoria: Ref; centro: Ref } | null;
  };
  politica: Record<string, unknown> | null;
}

async function comPool<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return await fn(c); } finally { await c.end(); }
}

/** Cadastro montado como o superusuário de teste monta cenário (o mesmo molde da A1). */
const categoria = (code: string, nome = `Categoria ${code}`) => comPool(async (c) => (await c.query<{ id: string }>(
  "insert into erp.financial_categories(organization_id,code,name,nature,kind,is_active) values ($1,$2,$3,'income','analytic',true) returning id",
  [h.demo.orgId, code, nome])).rows[0]!.id);
const centro = (code: string, nome = `Centro ${code}`) => comPool(async (c) => (await c.query<{ id: string }>(
  "insert into erp.cost_centers(organization_id,code,name,kind,is_active) values ($1,$2,$3,'analytic',true) returning id",
  [h.demo.orgId, code, nome])).rows[0]!.id);
const alterarCadastro = (tabela: "financial_categories" | "cost_centers", id: string, set: "is_active=false" | "is_active=true" | "deleted_at=now()" | "deleted_at=null") =>
  comPool((c) => c.query(`update erp.${tabela} set ${set} where id=$1`, [id]));
/** O que o recuo "padrão legado" escolheria HOJE — a mesma consulta de `planejarConfirmacao`, com código e nome. */
const primeiraPorCodigo = () => comPool(async (c) => ({
  categoria: (await c.query<Ref>("select id, code as codigo, name as nome from erp.financial_categories where organization_id=$1 and nature='income' and kind='analytic' and deleted_at is null order by code limit 1", [h.demo.orgId])).rows[0]!,
  centro: (await c.query<Ref>("select id, code as codigo, name as nome from erp.cost_centers where organization_id=$1 and kind='analytic' and deleted_at is null order by code limit 1", [h.demo.orgId])).rows[0]!,
}));

let seq = 0;
const codigoTop = () => `28${String(++seq).padStart(2, "0")}`;
type Eixo = "legado" | "nenhum" | "efeito";
/** Estoque e financeiro, cada um: `legado`, `nenhum` (configurado sem efeito) ou o efeito real configurado. */
const configuracaoDe = (estoque: Eixo, financeiro: Eixo, ajuste: (c: ConfiguracaoTipoOperacaoV2) => void = () => {}) => {
  const c = configuracaoNeutraTopV2();
  c.execucao = { estoque: (estoque === "legado" ? "legado" : "configurada") as ModoExecucaoTop, financeiro: (financeiro === "legado" ? "legado" : "configurada") as ModoExecucaoTop };
  if (estoque === "efeito") c.estoque.atualizacao = "saida";
  if (financeiro === "efeito") c.financeiro.atualizacao = "receber";
  ajuste(c);
  return c;
};
/** TOP de venda com a configuração pedida — pela instância com o gate LIGADO, como a porta exige. */
async function top(configuracao: unknown): Promise<string> {
  const r = await ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: codigoTop(), codigoBase: VENDA, nome: "TOP da venda A5", configuracao } });
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}

type Item = { product_id: string; warehouse_id: string | null; quantity: string; unit_price: string };
const comArmazem = (): Item => ({ product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "1", unit_price: "50.00" });
const semArmazem = (): Item => ({ product_id: I.product!, warehouse_id: null, quantity: "1", unit_price: "5.00" });
const par = (cat: string, cc: string) => ({ categoria_financeira_id: cat, centro_custo_id: cc });
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;

async function documento(kind: keyof typeof ROTA, extra: Record<string, unknown> = {}, itens: Item[] = [comArmazem()]): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers: h.headers(),
    payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client, items: itens, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const venda = (topId: string | null, extra: Record<string, unknown> = {}, itens?: Item[]) =>
  documento("sale", { ...(topId ? { tipo_operacao_id: topId } : {}), ...extra }, itens);

const previa = (app: FastifyInstance, id: string, headers: Hdr = h.headers()) =>
  app.inject({ method: "GET", url: `/api/sales/sales/${id}/previa-confirmacao`, headers });
/** A prévia de uma venda VISÍVEL: 200 e contrato 1 — sempre, inclusive quando ela prevê recusa. */
async function lerPrevia(app: FastifyInstance, id: string, headers: Hdr = h.headers()): Promise<Previa> {
  const r = await previa(app, id, headers);
  expect(r.statusCode, r.body).toBe(200);
  const p = j(r) as unknown as Previa;
  expect(p.contractVersion).toBe(1);
  return p;
}
const confirmar = (app: FastifyInstance, id: string, chave?: string) =>
  app.inject({ method: "POST", url: `/api/sales/sales/${id}/confirm`, headers: h.headers(chave ? { "idempotency-key": chave } : {}) });
const cancelar = (app: FastifyInstance, id: string) =>
  app.inject({ method: "POST", url: `/api/sales/sales/${id}/cancel`, headers: h.headers(), payload: {} });
async function confirmada(app: FastifyInstance, id: string) {
  const r = await confirmar(app, id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as { title_ids: string[] };
}

/** Tudo o que a confirmação materializa para ESTE documento, contado no banco. */
async function efeitos(id: string) {
  return comPool(async (c) => {
    const doc = (await c.query<{ status: string; updated_at: string }>("select status, updated_at::text as updated_at from erp.sales_documents where id=$1", [id])).rows[0]!;
    const saidas = Number((await c.query<{ n: string }>(
      "select count(*)::text n from erp.stock_movements where source_type='sales_documents' and source_id=$1 and movement_type='sale'", [id])).rows[0]!.n);
    // Soma e menor vencimento calculados NO BANCO (numeric → texto com a escala da coluna): nada de ponto flutuante.
    const tit = (await c.query<{ n: string; soma: string | null; menor: string | null }>(
      "select count(*)::text n, sum(amount)::text soma, to_char(min(due_date),'YYYY-MM-DD') menor from erp.financial_titles where source_type='sales_documents' and source_id=$1", [id])).rows[0]!;
    const rateios = (await c.query<{ categoria: string; centro: string }>(
      "select distinct a.financial_category_id as categoria, a.cost_center_id as centro from erp.title_apportionments a join erp.financial_titles t on t.id=a.title_id where t.source_type='sales_documents' and t.source_id=$1", [id])).rows;
    const aud = (await c.query<{ metadata: Record<string, unknown> | null }>(
      "select metadata from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='confirm' order by id", [id])).rows;
    return {
      status: doc.status, updatedAt: doc.updated_at, saidas, titulos: Number(tit.n), valorGerado: tit.soma, menorVencimento: tit.menor,
      rateios, confirmacao: aud[0]?.metadata ?? null, auditorias: aud.length,
    };
  });
}
/** "Zero efeito" de uma confirmação recusada: documento aberto, nada no estoque, nada no financeiro, sem trilha. */
const ZERO = { status: "open", saidas: 0, titulos: 0, auditorias: 0 } as const;

/**
 * FOTOGRAFIA para "a prévia não escreve": a LINHA INTEIRA do documento e dos itens (texto do `to_jsonb`, sem
 * conversão para número em JavaScript) e a contagem das tabelas que uma confirmação ou uma chave de
 * idempotência tocariam. A lista de tabelas é literal deste arquivo — nunca entrada.
 */
const TABELAS_CONTADAS = ["audit_logs", "idempotency_keys", "stock_movements", "financial_titles", "title_apportionments", "registros_globais"] as const;
async function fotografia(id: string) {
  return comPool(async (c) => {
    const documento = (await c.query<{ linha: string; status: string; updated_at: string }>(
      "select to_jsonb(d)::text as linha, d.status, d.updated_at::text as updated_at from erp.sales_documents d where d.id=$1", [id])).rows[0]!;
    const itens = (await c.query<{ linha: string }>("select to_jsonb(i)::text as linha from erp.sales_document_items i where i.document_id=$1 order by i.position", [id])).rows.map((r) => r.linha);
    const contagens = {} as Record<(typeof TABELAS_CONTADAS)[number], number>;
    for (const t of TABELAS_CONTADAS) contagens[t] = Number((await c.query<{ n: string }>(`select count(*)::text n from erp.${t}`)).rows[0]!.n);
    return { documento: documento.linha, status: documento.status, updatedAt: documento.updated_at, itens, contagens };
  });
}

// ---------------------------------------------------------------------------------------------------
// OS CENÁRIOS — montados UMA vez aqui, usados pelos casos C e pela tabela P1
// ---------------------------------------------------------------------------------------------------
/**
 * Um cenário montado: o documento, a instância que o confirma (gate desligado ou ligado) e, quando o cenário
 * mexe em estado da organização (período congelado, cadastro apagado), como desfazer isso DEPOIS da
 * confirmação — a prévia e a confirmação precisam ver o MESMO estado.
 */
interface Montado { docId: string; app: FastifyInstance; topId?: string; par?: { cat: string; cc: string }; desfazer?: () => Promise<void> }

/** A venda "cheia": dois itens com armazém (em armazéns diferentes) e um sem; total 97,35; parcelada com entrada. */
const itensMistos = (): Item[] => [
  { product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "2", unit_price: "40.00" },
  { product_id: I.product2!, warehouse_id: I.warehouse2!, quantity: "1", unit_price: "12.35" },
  semArmazem(),
];
const PARCELADO_COM_ENTRADA = { installment_plan: { installments: 3, first_due_date: "2026-10-10", mode: "interval", interval_days: 30, has_down_payment: true, down_payment_value: "20.00", down_payment_date: "2026-09-12" } };

const montarC1 = async (): Promise<Montado> => ({ app: h.app, docId: await venda(null, { ...par(CAT, CC), ...PARCELADO_COM_ENTRADA }, itensMistos()) });
const montarC2 = async (): Promise<Montado> => ({ app: h.app, docId: await venda(null) });
const montarC3 = async (estoque: Eixo, financeiro: Eixo): Promise<Montado> => {
  const topId = await top(configuracaoDe(estoque, financeiro));
  return { app: ligada, topId, docId: await venda(topId, par(CAT, CC)) };
};
/** As TRÊS exigências da versão, todas descumpridas: item sem armazém, sem forma de pagamento, sem vencimento. */
const montarC4 = async (): Promise<Montado> => {
  const topId = await top(configuracaoDe("efeito", "efeito", (c) => { c.estoque.exigeArmazem = true; c.financeiro.exigeFormaPagamento = true; c.financeiro.exigeVencimento = true; }));
  return { app: ligada, topId, docId: await venda(topId, par(CAT, CC), [comArmazem(), semArmazem()]) };
};
/** Versão configurada confirmada pela instância com o gate DESLIGADO. */
const montarC5 = async (): Promise<Montado> => {
  const topId = await top(configuracaoDe("efeito", "efeito"));
  return { app: h.app, topId, docId: await venda(topId, par(CAT, CC)) };
};
/**
 * Período congelado pela PORTA DA API (`/api/resources/financial_freezes`, a mesma do teste de congelamento em
 * `api.test.ts`), para a organização inteira. O documento nasce ANTES do congelamento e num mês que nenhum
 * outro caso usa: o resto do arquivo lança em setembro e não pode esbarrar num período fechado.
 */
const DATA_CONGELADA = "2026-03-16";
async function congelarMarco(): Promise<() => Promise<void>> {
  const r = await h.app.inject({ method: "POST", url: "/api/resources/financial_freezes", headers: h.headers(), payload: { month: 3, year: 2026, is_frozen: true } });
  expect(r.statusCode, r.body).toBe(201);
  const id = j(r).id as string;
  return async () => {
    const d = await h.app.inject({ method: "DELETE", url: `/api/resources/financial_freezes/${id}`, headers: h.headers() });
    expect(d.statusCode, d.body).toBe(200);
  };
}
const montarC6 = async (extra: Record<string, unknown> = par(CAT, CC)): Promise<Montado> => {
  const docId = await venda(null, { ...extra, document_date: DATA_CONGELADA });
  return { app: h.app, docId, desfazer: await congelarMarco() };
};
/** Classificação que deixou de valer DEPOIS de salva: a categoria inativada, ou o centro excluído. */
let seqCadastro = 0;
const montarC7 = async (quebra: "categoria inativada" | "centro excluído"): Promise<Montado> => {
  const n = ++seqCadastro;
  const cat = await categoria(`9.A5.C7.${n}`); const cc = await centro(`9.A5.C7.${n}`);
  const docId = await venda(null, par(cat, cc));
  const [tabela, alvo, quebrar, consertar] = quebra === "categoria inativada"
    ? ["financial_categories", cat, "is_active=false", "is_active=true"] as const
    : ["cost_centers", cc, "deleted_at=now()", "deleted_at=null"] as const;
  await alterarCadastro(tabela, alvo, quebrar);
  return { app: h.app, docId, par: { cat, cc }, desfazer: async () => { await alterarCadastro(tabela, alvo, consertar); } };
};
/**
 * Sem cadastro para o recuo: TODA categoria de receita analítica da organização sai (exclusão lógica). A
 * restauração devolve EXATAMENTE as que este cenário tirou — nunca "todas as excluídas", que ressuscitaria o
 * que outro caso excluiu de propósito.
 */
const montarC8 = async (): Promise<Montado> => {
  const docId = await venda(null);
  const tiradas = await comPool(async (c) => (await c.query<{ id: string }>(
    "update erp.financial_categories set deleted_at=now() where organization_id=$1 and nature='income' and kind='analytic' and deleted_at is null returning id", [h.demo.orgId])).rows.map((r) => r.id));
  expect(tiradas.length, "premissa: havia categoria de receita para tirar").toBeGreaterThan(0);
  return { app: h.app, docId, desfazer: async () => { await comPool((c) => c.query("update erp.financial_categories set deleted_at=null where id = any($1::uuid[])", [tiradas])); } };
};

/**
 * Parcelamento que a CONTA DE PARCELAS recusa: entrada maior que o total. O cadastro da venda aceita (o schema
 * do parcelamento não compara a entrada com o total); quem recusa é `buildInstallments`, ao gerar os títulos —
 * depois de todo o planejamento. A prévia faz a MESMA conta (`parcelasDoTitulo`) e tem de prever a recusa.
 */
const PLANO_C12 = { installments: 2, first_due_date: "2026-10-10", mode: "interval", interval_days: 30, has_down_payment: true, down_payment_value: "80.00", down_payment_date: "2026-09-12" };
const montarC12 = async (): Promise<Montado> => ({ app: h.app, docId: await venda(null, { ...par(CAT, CC), installment_plan: PLANO_C12 }) });

/** A TABELA ÚNICA: cada linha é um cenário dos casos C, com o desfecho que a confirmação tem de ter. */
const CENARIOS: { id: string; nome: string; esperado: "confirma" | string; montar: () => Promise<Montado> }[] = [
  { id: "A5-C1", nome: "legado classificado, parcelado com entrada, um item sem armazém", esperado: "confirma", montar: montarC1 },
  { id: "A5-C2", nome: "legado sem classificação (padrão legado)", esperado: "confirma", montar: montarC2 },
  { id: "A5-C3a", nome: "formato 2: estoque nenhum + a receber", esperado: "confirma", montar: () => montarC3("nenhum", "efeito") },
  { id: "A5-C3b", nome: "formato 2: saída + financeiro nenhum", esperado: "confirma", montar: () => montarC3("efeito", "nenhum") },
  { id: "A5-C4", nome: "exigências da versão não atendidas", esperado: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", montar: montarC4 },
  { id: "A5-C5", nome: "versão configurada com o gate desligado", esperado: "TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", montar: montarC5 },
  { id: "A5-C6", nome: "período congelado", esperado: "PERIOD_FROZEN", montar: () => montarC6() },
  { id: "A5-C7a", nome: "categoria do documento inativada", esperado: "VALIDATION_ERROR", montar: () => montarC7("categoria inativada") },
  { id: "A5-C7b", nome: "centro do documento excluído", esperado: "VALIDATION_ERROR", montar: () => montarC7("centro excluído") },
  { id: "A5-C8", nome: "sem cadastro para o recuo", esperado: "VALIDATION_ERROR", montar: montarC8 },
  { id: "A5-C12", nome: "parcelamento com entrada maior que o total", esperado: "VALIDATION_ERROR", montar: montarC12 },
];

// ---------------------------------------------------------------------------------------------------
// A PRÉVIA DIZ O QUE A CONFIRMAÇÃO FAZ — cenários que confirmam
// ---------------------------------------------------------------------------------------------------
describe("a prévia descreve o efeito — e a confirmação faz exatamente isso", () => {
  it("A5-C1 venda legada classificada: baixa de 2 itens (1 fica de fora), contas a receber com a classificação DO DOCUMENTO", async () => {
    // PREMISSA: o recuo escolheria OUTRO par — uma prévia que ignorasse o documento não passaria.
    const recuo = await primeiraPorCodigo();
    expect([recuo.categoria.id, recuo.centro.id]).not.toContain(CAT);
    expect([recuo.categoria.id, recuo.centro.id]).not.toContain(CC);

    const m = await montarC1();
    const p = await lerPrevia(m.app, m.docId);
    expect(p).toEqual({
      contractVersion: 1, podeConfirmar: true, recusas: [],
      estoque: { efeito: "baixa", itensQueBaixam: 2, itensSemArmazem: 1 },
      // 2×40,00 + 1×12,35 + 1×5,00; o PRIMEIRO vencimento é a ENTRADA (12/09), não a primeira parcela (10/10)
      // nem a data do documento (10/09) — a mesma conta de parcelas que `createTitles` grava.
      financeiro: { efeito: "receber", valor: "97.35", primeiroVencimento: "2026-09-12",
        classificacao: { origem: "documento", categoria: { id: CAT, codigo: "9.A5.001", nome: "Receita classificada A5" }, centro: { id: CC, codigo: "9.A5.001", nome: "Centro classificado A5" } } },
      politica: { origem: "sem_top", estoque: "legado", financeiro: "legado" },
    });

    await confirmada(m.app, m.docId);
    const e = await efeitos(m.docId);
    expect(e.saidas, "movimentos = itens com armazém previstos").toBe(p.estoque.itensQueBaixam);
    expect(e.titulos, "premissa: entrada + 3 parcelas").toBe(4);
    expect(e.rateios, "rateio = classificação prevista").toEqual([{ categoria: CAT, centro: CC }]);
    expect(e.menorVencimento).toBe(p.financeiro.primeiroVencimento);
    expect(e.valorGerado).toBe(p.financeiro.valor);
    expect(e.confirmacao).toMatchObject({ execucao: p.politica, classificacaoFinanceira: { categoriaFinanceiraId: CAT, centroCustoId: CC, origem: "documento" } });
  });

  it("A5-C2 venda sem classificação: a prévia diz 'padrão legado' com o par da primeira por código, e a confirmação usa o MESMO par", async () => {
    const recuo = await primeiraPorCodigo();
    // PREMISSA: o par do arquivo (válido, ativo) NÃO é o do recuo — "qualquer par válido" não passaria.
    expect(recuo.categoria.id).not.toBe(CAT);
    expect(recuo.centro.id).not.toBe(CC);

    const m = await montarC2();
    const p = await lerPrevia(m.app, m.docId);
    expect(p).toMatchObject({
      podeConfirmar: true, recusas: [],
      estoque: { efeito: "baixa", itensQueBaixam: 1, itensSemArmazem: 0 },
      financeiro: { efeito: "receber", valor: "50.00", primeiroVencimento: "2026-09-10", classificacao: { origem: "padrão legado", categoria: recuo.categoria, centro: recuo.centro } },
    });

    await confirmada(m.app, m.docId);
    const e = await efeitos(m.docId);
    expect(e.rateios).toEqual([{ categoria: recuo.categoria.id, centro: recuo.centro.id }]);
    expect(e.confirmacao).toMatchObject({ classificacaoFinanceira: { categoriaFinanceiraId: recuo.categoria.id, centroCustoId: recuo.centro.id, origem: "padrão legado" } });
    expect([e.saidas, e.titulos, e.menorVencimento, e.valorGerado]).toEqual([1, 1, "2026-09-10", "50.00"]);
  });

  it("A5-C3 formato 2 configurado (gate ligado): 'nenhum' + a receber e saída + 'nenhum' — a prévia é a execução", async () => {
    const casos = [
      { estoque: "nenhum" as const, financeiro: "efeito" as const,
        previsto: { estoque: { efeito: "nenhum", itensQueBaixam: 0, itensSemArmazem: 0 }, financeiro: { efeito: "receber", valor: "50.00", primeiroVencimento: "2026-09-10" } },
        politica: { origem: 2, estoque: "configurada:nenhum", financeiro: "configurada:receber" }, saidas: 0, titulos: 1 },
      { estoque: "efeito" as const, financeiro: "nenhum" as const,
        previsto: { estoque: { efeito: "baixa", itensQueBaixam: 1, itensSemArmazem: 0 }, financeiro: { efeito: "nenhum", valor: null, primeiroVencimento: null, classificacao: null } },
        politica: { origem: 2, estoque: "configurada:saida", financeiro: "configurada:nenhum" }, saidas: 1, titulos: 0 },
    ];
    for (const c of casos) {
      const rotulo = `${c.estoque}/${c.financeiro}`;
      const m = await montarC3(c.estoque, c.financeiro);
      const p = await lerPrevia(m.app, m.docId);
      expect(p, rotulo).toMatchObject({ podeConfirmar: true, recusas: [], ...c.previsto, politica: c.politica });
      if (c.titulos) expect(p.financeiro.classificacao, rotulo).toMatchObject({ origem: "documento", categoria: { id: CAT }, centro: { id: CC } });

      await confirmada(m.app, m.docId);
      const e = await efeitos(m.docId);
      // Cada "zero" daqui tem a premissa no OUTRO caso da lista: o mesmo item, com o eixo ligado, produz o efeito.
      expect([e.saidas, e.titulos], rotulo).toEqual([c.saidas, c.titulos]);
      expect(e.confirmacao!.execucao, `${rotulo}: a política prevista é a que a confirmação registrou`).toEqual(p.politica);
      expect(e.rateios, rotulo).toEqual(c.titulos ? [{ categoria: CAT, centro: CC }] : []);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// A PRÉVIA RECUSA COMO A CONFIRMAÇÃO RECUSA
// ---------------------------------------------------------------------------------------------------
describe("a primeira recusa da prévia é a recusa da confirmação — código, mensagem e detalhes", () => {
  it("A5-C4 exigências (armazém, forma de pagamento, vencimento) não atendidas: MESMO 422, e a confirmação recusa sem efeito", async () => {
    const m = await montarC4();
    const p = await lerPrevia(m.app, m.docId);
    expect(p.recusas, "exigência não PARA a prévia: o resto (período, classificação) passou").toHaveLength(1);
    expect(p.recusas[0]).toEqual({
      code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA",
      message: "A operação desta venda exige dados que o documento não tem: informe o armazém de todos os itens; informe a forma de pagamento; informe o vencimento.",
      details: { exigencias: [
        { caminho: "estoque.exigeArmazem", mensagem: "Informe o armazém de todos os itens" },
        { caminho: "financeiro.exigeFormaPagamento", mensagem: "Informe a forma de pagamento" },
        { caminho: "financeiro.exigeVencimento", mensagem: "Informe o vencimento" },
      ] },
    });
    // A prévia continua descrevendo a venda: é o quadro inteiro que a tela mostra junto da recusa.
    expect(p).toMatchObject({ podeConfirmar: false, estoque: { efeito: "baixa", itensQueBaixam: 1, itensSemArmazem: 1 },
      financeiro: { efeito: "receber", classificacao: { origem: "documento" } }, politica: { origem: 2, estoque: "configurada:saida", financeiro: "configurada:receber" } });

    const r = await confirmar(m.app, m.docId);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual(p.recusas[0]);
    expect(await efeitos(m.docId)).toMatchObject(ZERO);

    // A PREMISSA: a MESMA TOP, com os três dados no documento, é prevista confirmável e confirma.
    const certa = await venda(m.topId!, { ...par(CAT, CC), payment_method_id: formaPagamento, due_date: "2026-10-15" }, [comArmazem(), comArmazem()]);
    const pc = await lerPrevia(ligada, certa);
    expect(pc).toMatchObject({ podeConfirmar: true, recusas: [], estoque: { itensQueBaixam: 2, itensSemArmazem: 0 }, financeiro: { primeiroVencimento: "2026-10-15" } });
    await confirmada(ligada, certa);
    expect(await efeitos(certa)).toMatchObject({ status: "confirmed", saidas: 2, titulos: 1, menorVencimento: "2026-10-15" });
  });

  it("A5-C5 versão configurada com o gate DESLIGADO: a prévia recusa com a mesma mensagem da confirmação, e nada é previsto", async () => {
    const m = await montarC5();
    const p = await lerPrevia(m.app, m.docId);
    // Política recusada PARA a prévia (como para a confirmação): sem política não há efeito a prever.
    expect(p).toEqual({
      contractVersion: 1, podeConfirmar: false, recusas: [p.recusas[0]],
      estoque: { efeito: null, itensQueBaixam: 0, itensSemArmazem: 0 },
      financeiro: { efeito: null, valor: null, primeiroVencimento: null, classificacao: null },
      politica: null,
    });
    expect(p.recusas[0]).toMatchObject({ code: "TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", details: { motivo: "execucao_desligada" } });

    const r = await confirmar(m.app, m.docId);
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error).toEqual(p.recusas[0]);
    expect(await efeitos(m.docId)).toMatchObject(ZERO);

    // A PREMISSA: o que recusa é o GATE — a instância ligada prevê e confirma a MESMA venda.
    expect(await lerPrevia(ligada, m.docId)).toMatchObject({ podeConfirmar: true, estoque: { efeito: "baixa" }, financeiro: { efeito: "receber" } });
    await confirmada(ligada, m.docId);
    expect(await efeitos(m.docId)).toMatchObject({ status: "confirmed", saidas: 1, titulos: 1 });
  });

  it("A5-C6 período congelado: a MESMA recusa da confirmação, a requisição segue até a classificação, e nada é gravado", async () => {
    const m = await montarC6();
    try {
      const antes = await fotografia(m.docId);
      const p = await lerPrevia(m.app, m.docId);
      expect(p.recusas.map((x) => x.code)).toEqual(["PERIOD_FROZEN"]);
      // A TRANSAÇÃO NÃO ABORTOU: a etapa DEPOIS do período (a classificação, que consulta categoria e centro)
      // rodou na MESMA requisição e voltou preenchida. Com a exceção do banco sem savepoint, qualquer consulta
      // seguinte falharia com "current transaction is aborted" e a resposta seria 500 (reversa RV2).
      expect(p.financeiro).toMatchObject({ efeito: "receber", classificacao: { origem: "documento", categoria: { id: CAT, codigo: "9.A5.001" }, centro: { id: CC, codigo: "9.A5.001" } } });
      expect(await fotografia(m.docId), "a prévia não gravou nada").toEqual(antes);

      const r = await confirmar(m.app, m.docId);
      expect(r.statusCode, r.body).toBe(409);
      expect(j(r).error).toEqual(p.recusas[0]);
      expect(await efeitos(m.docId)).toMatchObject(ZERO);
    } finally { await m.desfazer!(); }
    // A PREMISSA: descongelado o período, a MESMA venda é prevista confirmável e confirma.
    expect(await lerPrevia(m.app, m.docId)).toMatchObject({ podeConfirmar: true, recusas: [] });
    await confirmada(m.app, m.docId);
    expect(await efeitos(m.docId)).toMatchObject({ status: "confirmed", saidas: 1, titulos: 1 });
  });

  it("A5-C6b período congelado E classificação que deixou de valer: as duas recusas, NA ORDEM da confirmação", async () => {
    // A prova mais forte de que a etapa seguinte foi AVALIADA (não só consultada): ela também recusa, e a
    // recusa dela é exatamente a que a confirmação dá quando o período deixa de ser o primeiro obstáculo.
    const cat = await categoria("9.A5.C6b.1");
    const m = await montarC6(par(cat, CC));
    let p: Previa;
    try {
      await alterarCadastro("financial_categories", cat, "is_active=false");
      p = await lerPrevia(m.app, m.docId);
      expect(p.recusas.map((x) => x.code)).toEqual(["PERIOD_FROZEN", "VALIDATION_ERROR"]);
      const r = await confirmar(m.app, m.docId);
      expect(r.statusCode, r.body).toBe(409);
      expect(j(r).error, "a PRIMEIRA é a da confirmação").toEqual(p.recusas[0]);
    } finally { await m.desfazer!(); }
    // Descongelado, a classificação passa a ser a primeira recusa — e é a SEGUNDA que a prévia já mostrava.
    const r2 = await confirmar(m.app, m.docId);
    expect(r2.statusCode, r2.body).toBe(422);
    expect(j(r2).error).toEqual(p!.recusas[1]);
    expect(await efeitos(m.docId)).toMatchObject(ZERO);
  });

  it("A5-C7 classificação que deixou de valer (categoria inativada · centro excluído): a prévia recusa igual à confirmação", async () => {
    for (const quebra of ["categoria inativada", "centro excluído"] as const) {
      const m = await montarC7(quebra);
      const p = await lerPrevia(m.app, m.docId);
      const campo = quebra === "categoria inativada" ? "categoria_financeira_id" : "centro_custo_id";
      expect(p, quebra).toMatchObject({ podeConfirmar: false, financeiro: { efeito: "receber", classificacao: null } });
      expect(p.recusas, quebra).toHaveLength(1);
      expect(p.recusas[0], quebra).toMatchObject({ code: "VALIDATION_ERROR", details: [{ path: campo }] });
      expect(p.recusas[0]!.message, quebra).toMatch(/deixou de valer.*Reative-a no cadastro ou cancele a venda/);

      const r = await confirmar(m.app, m.docId);
      expect(r.statusCode, `${quebra}: ${r.body}`).toBe(422);
      expect(j(r).error, quebra).toEqual(p.recusas[0]);
      expect(await efeitos(m.docId), quebra).toMatchObject(ZERO);

      // A PREMISSA: consertado o cadastro, a prévia mostra o par DO DOCUMENTO e a confirmação o usa.
      await m.desfazer!();
      expect(await lerPrevia(m.app, m.docId), quebra).toMatchObject({ podeConfirmar: true, financeiro: { classificacao: { origem: "documento", categoria: { id: m.par!.cat }, centro: { id: m.par!.cc } } } });
      await confirmada(m.app, m.docId);
      expect((await efeitos(m.docId)).rateios, quebra).toEqual([{ categoria: m.par!.cat, centro: m.par!.cc }]);
    }
  });

  it("A5-C8 sem cadastro para o recuo: a prévia recusa com 'Cadastre uma categoria…', igual à confirmação", async () => {
    const m = await montarC8();
    try {
      const p = await lerPrevia(m.app, m.docId);
      expect(p.recusas).toEqual([{ code: "VALIDATION_ERROR", message: "Cadastre uma categoria financeira de receita e um centro de custo analítico" }]);
      expect(p).toMatchObject({ podeConfirmar: false, financeiro: { efeito: "receber", classificacao: null } });
      const r = await confirmar(m.app, m.docId);
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error).toEqual(p.recusas[0]);
      expect(await efeitos(m.docId)).toMatchObject(ZERO);
    } finally { await m.desfazer!(); }
    // A PREMISSA: com o cadastro devolvido, a MESMA venda é prevista pelo recuo e confirma.
    expect(await lerPrevia(m.app, m.docId)).toMatchObject({ podeConfirmar: true, financeiro: { classificacao: { origem: "padrão legado" } } });
    await confirmada(m.app, m.docId);
    expect(await efeitos(m.docId)).toMatchObject({ status: "confirmed", titulos: 1 });
  });
  it("A5-C12 entrada maior que o total: a prévia prevê a recusa da CONTA DE PARCELAS, a mesma que a confirmação dá ao gerar os títulos", async () => {
    const m = await montarC12();
    const p = await lerPrevia(m.app, m.docId);
    // O planejamento passou inteiro — a recusa é a da conta de parcelas, a última conferência antes dos títulos,
    // e o resto do quadro continua descrito. Sem esta recusa na lista, a tela diria "pode confirmar" e a
    // confirmação responderia 422 (reversa RV6: a prévia volta a engolir o erro da conta).
    expect(p).toMatchObject({ podeConfirmar: false, estoque: { efeito: "baixa", itensQueBaixam: 1, itensSemArmazem: 0 },
      financeiro: { efeito: "receber", valor: "50.00", primeiroVencimento: null, classificacao: { origem: "documento", categoria: { id: CAT }, centro: { id: CC } } } });
    expect(p.recusas).toEqual([{ code: "VALIDATION_ERROR", message: "Entrada deve ser maior que zero e menor que o total" }]);

    const r = await confirmar(m.app, m.docId);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual(p.recusas[0]);
    expect(await efeitos(m.docId)).toMatchObject(ZERO);

    // A PREMISSA: o MESMO parcelamento com entrada menor que o total é previsto confirmável — o primeiro
    // vencimento é o da entrada — e confirma com entrada + 2 parcelas.
    const certa = await venda(null, { ...par(CAT, CC), installment_plan: { ...PLANO_C12, down_payment_value: "20.00" } });
    expect(await lerPrevia(h.app, certa)).toMatchObject({ podeConfirmar: true, recusas: [], financeiro: { primeiroVencimento: "2026-09-12" } });
    await confirmada(h.app, certa);
    expect(await efeitos(certa)).toMatchObject({ status: "confirmed", saidas: 1, titulos: 3, menorVencimento: "2026-09-12", valorGerado: "50.00" });
  });
});

// ---------------------------------------------------------------------------------------------------
// SUPERFÍCIE DE RECUSA — a mesma do GET do documento
// ---------------------------------------------------------------------------------------------------
let seqMembro = 0;
/** Um usuário real da MESMA organização, com as capacidades e o escopo de empresa pedidos. */
async function membro(rotulo: string, permissoes: string[], empresas: string[]): Promise<Hdr> {
  const n = ++seqMembro;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil A5 ${n} ${rotulo}`, permissions: permissoes } });
  expect(papel.statusCode, papel.body).toBe(201);
  const email = `previa.a5.${n}@teste.com`;
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(),
    payload: { name: rotulo, email, password: "PreviaA5@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "PreviaA5@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

describe("A5-C9 — superfície de recusa: a prévia responde o MESMO que o GET do documento", () => {
  it("A5-C9 outro tenant · fora do escopo · inexistente · excluído · orçamento e pedido na rota de venda · malformado · sem capacidade", async () => {
    // OUTRO TENANT com uma venda REAL: o caso perigoso, porque o UUID existe de verdade.
    const adm = createPool(TEST_URL, { max: 1 });
    let orgB: Awaited<ReturnType<typeof seedDemo>>;
    try { orgB = await seedDemo(adm, { orgName: "[TEST] Org prévia A5", adminEmail: "admin-previa-a5@demo.local", adminPassword: "Demo@12345", slug: "orgpreviaa5" }, () => {}); }
    finally { await adm.end(); }
    const loginB = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-previa-a5@demo.local", password: "Demo@12345" } });
    expect(loginB.statusCode, loginB.body).toBe(200);
    const hdrB: Hdr = { authorization: `Bearer ${(loginB.json() as { token: string }).token}`, "x-org-id": orgB.orgId };
    const doB = await comPool(async (c) => ({
      cliente: (await c.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client order by code limit 1", [orgB.orgId])).rows[0]!.id,
      produto: (await c.query<{ id: string }>("select id from erp.products where organization_id=$1 order by code limit 1", [orgB.orgId])).rows[0]!.id,
    }));
    const rB = await h.app.inject({ method: "POST", url: "/api/sales/sales", headers: hdrB,
      payload: { empresa_id: orgB.empresaIds[0], document_date: "2026-09-10", client_id: doB.cliente, items: [{ product_id: doB.produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }] } });
    expect(rB.statusCode, rB.body).toBe(201);
    const vendaB = j(rB).id as string;
    // PREMISSA: a venda de B existe e a prévia funciona para quem a pode ver.
    expect((await h.app.inject({ method: "GET", url: `/api/sales/sales/${vendaB}`, headers: hdrB })).statusCode).toBe(200);
    expect((await previa(h.app, vendaB, hdrB)).statusCode).toBe(200);

    // FORA DO ESCOPO DE EMPRESA: só `sales.view`, só na empresa 2.
    const soEmpresa2 = await membro("Vendas só empresa 2", ["sales.view"], [I.empresa2]);
    const daEmpresa1 = await venda(null);
    const daEmpresa2 = await venda(null, { empresa_id: I.empresa2 }, [{ ...semArmazem(), product_id: I.product2! }]);
    // PREMISSA: o MESMO usuário lê a venda da empresa dele — e a prévia exige só `sales.view` (confirmar exige edit).
    expect((await h.app.inject({ method: "GET", url: `/api/sales/sales/${daEmpresa2}`, headers: soEmpresa2 })).statusCode).toBe(200);
    expect((await previa(h.app, daEmpresa2, soEmpresa2)).statusCode).toBe(200);

    // EXCLUÍDO (exclusão lógica): antes, a prévia respondia — o 404 de depois vem da exclusão.
    const excluida = await venda(null);
    expect((await previa(h.app, excluida)).statusCode).toBe(200);
    await comPool((c) => c.query("update erp.sales_documents set deleted_at=now() where id=$1", [excluida]));

    // ORÇAMENTO E PEDIDO: existem, e cada um é lido pela PRÓPRIA rota.
    const orcamento = await documento("budget"); const pedido = await documento("order");
    expect((await h.app.inject({ method: "GET", url: `/api/sales/budgets/${orcamento}`, headers: h.headers() })).statusCode).toBe(200);
    expect((await h.app.inject({ method: "GET", url: `/api/sales/orders/${pedido}`, headers: h.headers() })).statusCode).toBe(200);

    // SEM A CAPACIDADE DE LER VENDAS: 403 é o único lugar em que a recusa fala do chamador.
    const soOrcamentos = await membro("Só orçamentos", ["budgets.view"], []);

    const casos: [motivo: string, id: string, headers: Hdr, status: number][] = [
      ["outro tenant", vendaB, h.headers(), 404],
      ["fora do escopo de empresa", daEmpresa1, soEmpresa2, 404],
      ["inexistente", "00000000-0000-4000-8000-0000000000a5", h.headers(), 404],
      ["excluído", excluida, h.headers(), 404],
      ["orçamento na rota de venda", orcamento, h.headers(), 404],
      ["pedido na rota de venda", pedido, h.headers(), 404],
      // MALFORMADO — 500 HOJE, NAS DUAS PORTAS, e fixado aqui de propósito. A `getDoc` compara o texto com a
      // coluna `uuid`, o Postgres devolve 22P02 e `fromPgError` não o mapeia: é DÍVIDA da `getDoc` (anterior a
      // esta fatia), não regra da prévia — que responde o que o GET responde, com a MESMA função. Fixar o 500
      // faz a correção futura da `getDoc` (malformado = a mesma 404) passar OBRIGATORIAMENTE por esta linha,
      // em vez de mudar o comportamento da prévia sem ninguém ver. Declarado como risco residual na PR.
      ["id malformado", "nao-e-uuid", h.headers(), 500],
      ["sem a capacidade de ler vendas", daEmpresa1, soOrcamentos, 403],
    ];
    const corpos404 = new Set<string>();
    for (const [motivo, id, headers, status] of casos) {
      const g = await h.app.inject({ method: "GET", url: `/api/sales/sales/${id}`, headers });
      const p = await previa(h.app, id, headers);
      expect([p.statusCode, p.json()], motivo).toEqual([g.statusCode, g.json()]);
      expect(p.statusCode, `${motivo}: ${p.body}`).toBe(status);
      if (p.statusCode === 404) corpos404.add(p.body);
    }
    // SEM ORÁCULO: toda 404 é UM corpo só — nada distingue "de outro tenant" de "excluído" de "orçamento".
    expect(corpos404.size).toBe(1);
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------
// A PRÉVIA NÃO ESCREVE E NÃO TRAVA
// ---------------------------------------------------------------------------------------------------
describe("A5-C10 — a prévia não escreve: auditoria, idempotência e documento idênticos", () => {
  it("A5-C10 três prévias (com Idempotency-Key) não gravam nada; a confirmação com a MESMA chave grava", async () => {
    const id = await venda(null, par(CAT, CC));
    const antes = await fotografia(id);
    expect(antes.contagens.audit_logs, "premissa: há trilha para contar").toBeGreaterThan(0);
    for (const app of [h.app, ligada, h.app]) {
      const p = await lerPrevia(app, id, h.headers({ "idempotency-key": "a5-c10-chave" }));
      expect(p.podeConfirmar).toBe(true);
    }
    expect(await fotografia(id), "linha do documento, itens e contagens intactos").toEqual(antes);

    // A PREMISSA — a fotografia VÊ escrita: a confirmação com a MESMA chave executa (a prévia não a reservou;
    // reservada, ela devolveria outra resposta ou conflito) e cada contagem anda.
    const r = await confirmar(h.app, id, "a5-c10-chave");
    expect(r.statusCode, r.body).toBe(200);
    const depois = await fotografia(id);
    expect(depois.contagens.idempotency_keys).toBe(antes.contagens.idempotency_keys + 1);
    expect(depois.contagens.audit_logs).toBeGreaterThan(antes.contagens.audit_logs);
    expect(depois.contagens.stock_movements).toBe(antes.contagens.stock_movements + 1);
    expect(depois.contagens.financial_titles).toBe(antes.contagens.financial_titles + 1);
    expect(depois.status).toBe("confirmed");
    expect(depois.updatedAt).not.toBe(antes.updatedAt);
    expect(depois.documento).not.toBe(antes.documento);
  });

  it("A5-C10b venda confirmada, faturada e cancelada: recusa com o código da confirmação, sem erro de rota e sem escrita", async () => {
    const confirmadaId = await venda(null, par(CAT, CC));
    await confirmada(h.app, confirmadaId);
    // Faturada: `confirmed → invoiced` montado como cenário (não há porta de faturamento de venda nesta fatia).
    // Venda sem TOP e sem classificação: nenhuma guarda das migrations 0023/0024 tem o que conferir aqui.
    const faturadaId = await venda(null);
    await confirmada(h.app, faturadaId);
    await comPool((c) => c.query("update erp.sales_documents set status='invoiced' where id=$1 and status='confirmed'", [faturadaId]));
    const canceladaId = await venda(null, par(CAT, CC));
    await confirmada(h.app, canceladaId);
    expect((await cancelar(h.app, canceladaId)).statusCode).toBe(200);

    const casos = [
      { nome: "confirmada", id: confirmadaId, status: "confirmed", code: "ALREADY_CONFIRMED" },
      { nome: "faturada", id: faturadaId, status: "invoiced", code: "ALREADY_CONFIRMED" },
      { nome: "cancelada", id: canceladaId, status: "cancelled", code: "ALREADY_CANCELLED" },
    ];
    for (const c of casos) {
      const antes = await fotografia(c.id);
      expect(antes.status, `premissa: ${c.nome}`).toBe(c.status);
      const p = await lerPrevia(h.app, c.id);
      // Situação recusada PARA a prévia: nada a prever depois dela.
      expect(p, c.nome).toEqual({ contractVersion: 1, podeConfirmar: false, recusas: [p.recusas[0]],
        estoque: { efeito: null, itensQueBaixam: 0, itensSemArmazem: 0 }, financeiro: { efeito: null, valor: null, primeiroVencimento: null, classificacao: null }, politica: null });
      expect(await fotografia(c.id), `${c.nome}: a prévia não escreveu`).toEqual(antes);
      const r = await confirmar(h.app, c.id);
      expect(r.statusCode, `${c.nome}: ${r.body}`).toBe(409);
      expect(j(r).error!.code, c.nome).toBe(c.code);
      expect(j(r).error, c.nome).toEqual(p.recusas[0]);
    }
  });
});

describe("A5-C11 — a prévia NÃO trava linha: trava concorrente na venda, na categoria ou no centro não a faz esperar", () => {
  /**
   * AS TRÊS LINHAS que a confirmação trava e a prévia só lê: a VENDA (`for update of d` em `getDoc`), a
   * CATEGORIA e o CENTRO do documento (`for share` em `validarClassificacaoFinanceira`). A tabela é literal
   * deste arquivo — nunca entrada — e entra no SQL de B só por isso.
   */
  const ALVOS = [
    { nome: "venda", tabela: "sales_documents" },
    { nome: "categoria", tabela: "financial_categories" },
    { nome: "centro", tabela: "cost_centers" },
  ] as const;

  it("A5-C11 com a venda, a categoria ou o centro travados por outra transação, a prévia responde em < 2 s; a confirmação ESPERA", async () => {
    // O CENÁRIO: uma conexão B trava a linha (`for update`, o modo de quem vai alterá-la — uma edição da venda,
    // uma inativação do cadastro). A confirmação trava as três e, por isso, ESPERA B terminar; a prévia lê sem
    // trava e responde na hora. Se a prévia travasse (reversas RV5: `for share` na classificação; `lock` na
    // `getDoc` dela), quem abriu o diálogo ficaria pendurado na edição de outra pessoa — e, no sentido
    // inverso, faria essa edição esperar por ele.
    for (const [n, alvo] of ALVOS.entries()) {
      const cat = await categoria(`9.A5.C11.${n + 1}`); const cc = await centro(`9.A5.C11.${n + 1}`);
      const id = await venda(null, par(cat, cc));
      const linha = { sales_documents: id, financial_categories: cat, cost_centers: cc }[alvo.tabela];
      const admin = createPool(TEST_URL, { max: 2 });
      const b = await admin.connect();
      let bAberta = false;
      const soltarB = async () => { if (bAberta) { bAberta = false; await b.query("rollback"); } };
      let previaEmCurso: Promise<Resposta> | null = null;
      let confirmacaoEmCurso: Promise<Resposta> | null = null;
      /** Backends da API esperando TRAVA numa consulta à tabela do alvo — lido do próprio PostgreSQL, sem sleep. */
      const esperandoTrava = async () => Number((await admin.query<{ n: string }>(
        `select count(*)::text n from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query ilike $1`, [`%erp.${alvo.tabela}%`])).rows[0]!.n);
      try {
        await b.query("begin"); bAberta = true;
        const travada = await b.query(`select id from erp.${alvo.tabela} where id=$1 for update`, [linha]);
        expect(travada.rowCount, `premissa: B travou a linha (${alvo.nome})`).toBe(1);

        // A PRÉVIA, com B segurando a trava: tem de responder — e ter LIDO a linha travada.
        previaEmCurso = previa(h.app, id);
        const corrida = await Promise.race([previaEmCurso.then(() => "respondeu" as const), espera(2_000).then(() => "esperando" as const)]);
        expect(corrida, `a prévia esperou a trava de B (${alvo.nome})`).toBe("respondeu");
        const rp = await previaEmCurso;
        expect(rp.statusCode, `${alvo.nome}: ${rp.body}`).toBe(200);
        expect(j(rp), alvo.nome).toMatchObject({ podeConfirmar: true, financeiro: { classificacao: { origem: "documento", categoria: { id: cat }, centro: { id: cc } } } });

        // A PREMISSA: na MESMA situação a confirmação ESPERA — vista em espera de trava no banco, e sem resposta.
        let respondeu = false;
        confirmacaoEmCurso = confirmar(h.app, id).then((r) => { respondeu = true; return r; });
        const t0 = performance.now(); let vistos = 0;
        while (vistos === 0 && !respondeu && performance.now() - t0 < 20_000) { vistos = await esperandoTrava(); if (!vistos) await espera(20); }
        expect(vistos, `a confirmação não foi vista esperando a trava de B (${alvo.nome})`).toBeGreaterThan(0);
        await espera(300);
        expect(respondeu, `a confirmação terminou com a trava de B de pé (${alvo.nome})`).toBe(false);

        // Solta B (rollback: nada mudou) e a confirmação segue até o fim.
        await soltarB();
        const rc = await confirmacaoEmCurso;
        expect(rc.statusCode, `${alvo.nome}: ${rc.body}`).toBe(200);
        expect(await efeitos(id), alvo.nome).toMatchObject({ status: "confirmed", saidas: 1, titulos: 1, rateios: [{ categoria: cat, centro: cc }] });
      } finally {
        await soltarB().catch(() => undefined);
        await previaEmCurso?.catch(() => undefined);
        await confirmacaoEmCurso?.catch(() => undefined);
        b.release();
        await admin.end();
      }
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------
// PARIDADE — uma tabela sobre C1…C8 e C12
// ---------------------------------------------------------------------------------------------------
describe("A5-P1 — paridade prévia × execução, uma tabela sobre os cenários C1 a C8 e C12", () => {
  it("A5-P1 cada cenário: prévia, depois confirmação — podeConfirmar ⇔ 200, mesma primeira recusa, movimentos, título, rateio e vencimento previstos", async () => {
    const linhas: { id: string; nome: string; esperado: string; p: Previa; rc: Resposta; e: Awaited<ReturnType<typeof efeitos>> }[] = [];
    for (const cen of CENARIOS) {
      const m = await cen.montar();
      let p: Previa; let rc: Resposta;
      // A prévia e a confirmação veem o MESMO estado: o que o cenário mudou na organização só é desfeito depois.
      try {
        p = await lerPrevia(m.app, m.docId);
        rc = await confirmar(m.app, m.docId);
      } finally { await m.desfazer?.(); }
      linhas.push({ id: cen.id, nome: cen.nome, esperado: cen.esperado, p, rc, e: await efeitos(m.docId) });
    }

    // PREMISSAS DA TABELA — "igual" não pode ser "igualmente vazio": ela tem os dois desfechos, e entre os que
    // confirmam há estoque sem título, título sem estoque e várias parcelas com vencimento ≠ data do documento.
    const confirmam = linhas.filter((l) => l.esperado === "confirma");
    expect([confirmam.length, linhas.length - confirmam.length]).toEqual([4, 7]);
    expect(confirmam.some((l) => l.e.saidas === 0 && l.e.titulos > 0), "título sem estoque").toBe(true);
    expect(confirmam.some((l) => l.e.saidas > 0 && l.e.titulos === 0), "estoque sem título").toBe(true);
    expect(confirmam.some((l) => l.e.titulos > 1 && l.e.menorVencimento !== "2026-09-10"), "parcelas com entrada").toBe(true);

    for (const { id, nome, esperado, p, rc, e } of linhas) {
      const rotulo = `${id} ${nome}`;
      expect(p.podeConfirmar, `${rotulo}: podeConfirmar ⇔ 200 (${rc.body})`).toBe(rc.statusCode === 200);
      expect(p.podeConfirmar, rotulo).toBe(p.recusas.length === 0);
      if (esperado === "confirma") {
        expect(rc.statusCode, `${rotulo}: ${rc.body}`).toBe(200);
        expect(e.status, rotulo).toBe("confirmed");
        // Estoque: saídas = itens com armazém previstos; "nenhum" prevê zero e baixa zero.
        expect(e.saidas, rotulo).toBe(p.estoque.efeito === "baixa" ? p.estoque.itensQueBaixam : 0);
        // Financeiro: título gerado ⇔ "a receber"; valor, primeiro vencimento e rateio = o previsto.
        expect(e.titulos > 0, rotulo).toBe(p.financeiro.efeito === "receber");
        expect(e.valorGerado, rotulo).toBe(p.financeiro.valor);
        expect(e.menorVencimento, rotulo).toBe(p.financeiro.primeiroVencimento);
        const c = p.financeiro.classificacao;
        expect(e.rateios, rotulo).toEqual(c ? [{ categoria: c.categoria.id, centro: c.centro.id }] : []);
        // A política prevista é a que a confirmação REGISTROU como decisão; a origem da classificação, também.
        expect(e.confirmacao!.execucao, rotulo).toEqual(p.politica);
        expect(e.confirmacao!.classificacaoFinanceira ?? null, rotulo).toEqual(c ? { categoriaFinanceiraId: c.categoria.id, centroCustoId: c.centro.id, origem: c.origem } : null);
      } else {
        expect(rc.statusCode, `${rotulo}: ${rc.body}`).not.toBe(200);
        expect(p.recusas[0]?.code, rotulo).toBe(esperado);
        // A PRIMEIRA recusa da prévia é o corpo de erro da confirmação — código, mensagem e detalhes.
        expect(j(rc).error, rotulo).toEqual(p.recusas[0]);
        expect(e, rotulo).toMatchObject(ZERO);
      }
    }
  }, 180_000);
});
