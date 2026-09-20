import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { createPool, type Db } from "@agro/db";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CONFIRMAÇÃO E CANCELAMENTO DE VENDA SOB CONCORRÊNCIA.
 *
 * Confirmar e cancelar são operações COMPOSTAS: postam estoque, geram ou cancelam títulos e movem o
 * status. Até este hotfix as duas liam o documento SEM trava, então duas transações podiam decidir sobre
 * o MESMO status antigo e executar os efeitos inteiros duas vezes — sem que nenhuma resposta fosse erro.
 *
 * O que cada bloco mede, e por que a contagem é lida FORA da rota:
 *
 *   · uma resposta 200 não prova nada sobre o EFEITO. Duas confirmações podem responder 200 e deixar dois
 *     conjuntos de movimentos e de títulos; a tela mostraria sucesso nas duas. Por isso toda asserção
 *     decisiva aqui é uma CONTAGEM no banco, por `source_id`, lida por conexão própria;
 *   · `reverseStock` seleciona movimentos por `reversed_by is null and movement_type<>'reversal'`, e o
 *     ledger imutável nunca preenche `reversed_by`. O estorno é repetível por construção: o que impede o
 *     segundo é exclusivamente o `status='cancelled'` já gravado — ou seja, a trava;
 *   · o SALDO de estoque é a prova final. Ele é aritmética do banco, não do teste: se um estorno correu
 *     duas vezes, o saldo fica ACIMA do inicial, e nenhuma contagem de linha precisaria ser interpretada.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
beforeAll(async () => { h = await harness(); I = await ids(h); await abrirEstoque("500"); }, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string; message: string } };

/** Conexão administrativa de LEITURA: mede o estado persistido sem passar pela rota que está sob teste. */
async function comPool<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return await fn(c); } finally { await c.end(); }
}

/** Estado completo dos EFEITOS de um documento — tudo o que uma execução dupla duplicaria. */
async function efeitos(id: string) {
  return comPool(async (c) => {
    const doc = (await c.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!;
    const mov = (await c.query<{ movement_type: string; direction: number; quantity: string }>(
      "select movement_type, direction, quantity from erp.stock_movements where source_type='sales_documents' and source_id=$1 order by created_at", [id])).rows;
    const tit = (await c.query<{ id: string; status: string }>(
      "select id, status from erp.financial_titles where source_type='sales_documents' and source_id=$1 order by created_at", [id])).rows;
    const aud = (await c.query<{ action: string; n: string }>(
      "select action, count(*)::text as n from erp.audit_logs where entity='sales_documents' and entity_id=$1 group by action", [id])).rows;
    return {
      status: doc.status,
      movimentos: mov.length,
      estornos: mov.filter((m) => m.movement_type === "reversal").length,
      /** Soma assinada dos movimentos desta origem: 0 = tudo que saiu voltou; nunca deve ficar positiva. */
      liquido: mov.reduce((a, m) => a + Number(m.quantity) * m.direction, 0),
      titulos: tit.length,
      titulosAtivos: tit.filter((t) => t.status !== "cancelled").length,
      auditoria: Object.fromEntries(aud.map((a) => [a.action, Number(a.n)])) as Record<string, number>
    };
  });
}

/** Saldo do par armazém×produto da fixture — a aritmética do banco, e não a do teste. */
const saldo = () => comPool(async (c) =>
  Number((await c.query<{ q: string }>("select coalesce(sum(quantity),0)::text q from erp.stock_balances where warehouse_id=$1 and product_id=$2", [I.warehouse, I.product2])).rows[0]!.q));

/**
 * Estoque para a suíte inteira, UMA vez: o gatilho de saldo do 0003 recusa movimento que deixaria o
 * saldo negativo, e `opening-balances` é único por produto×armazém×lote. Cada venda desta suíte consome
 * uma unidade, então o que se semeia aqui é folga, não número mágico.
 */
async function abrirEstoque(quantidade: string) {
  const r = await h.app.inject({ method: "POST", url: "/api/stock/opening-balances", headers: h.headers(),
    payload: { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: I.product2, quantity: quantidade, unit_value: "10" } });
  expect(r.statusCode, r.body).toBe(201);
}

const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
type Variante = keyof typeof ROTA;

async function criar(kind: Variante, extra: Record<string, unknown> = {}, headers: Hdr = h.headers()): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers,
    payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client,
      items: [{ product_id: I.product2, warehouse_id: I.warehouse, quantity: "1", unit_price: "50.00" }], ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

const confirmar = (id: string, chave?: string) =>
  h.app.inject({ method: "POST", url: `/api/sales/sales/${id}/confirm`, headers: chave ? h.headers({ "idempotency-key": chave }) : h.headers() });

const cancelar = (kind: Variante, id: string, opts: { chave?: string; corpo?: Record<string, unknown>; headers?: Hdr } = {}) =>
  h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}/${id}/cancel`,
    headers: { ...(opts.headers ?? h.headers()), ...(opts.chave ? { "idempotency-key": opts.chave } : {}) },
    payload: opts.corpo });

/** Edita o documento trocando a quantidade do item — a mesma porta que a tela usa. */
const editar = (kind: Variante, id: string, quantidade: string) =>
  h.app.inject({ method: "PUT", url: `/api/sales/${ROTA[kind]}/${id}`, headers: h.headers(),
    payload: { empresa_id: I.empresa, document_date: "2026-09-10", client_id: I.client,
      items: [{ product_id: I.product2, warehouse_id: I.warehouse, quantity: quantidade, unit_price: "50.00" }] } });

/** O que o documento DIZ (item) contra o que o ledger REGISTROU (movimento de saída). */
const quantidades = (id: string) => comPool(async (c) => ({
  item: Number((await c.query<{ q: string }>("select coalesce(sum(quantity),0)::text q from erp.sales_document_items where document_id=$1", [id])).rows[0]!.q),
  movimento: Number((await c.query<{ q: string }>("select coalesce(sum(quantity),0)::text q from erp.stock_movements where source_type='sales_documents' and source_id=$1 and movement_type<>'reversal'", [id])).rows[0]!.q)
}));

/** Um usuário real da MESMA organização, com as capacidades e o escopo de empresa pedidos. */
async function membro(rotulo: string, permissoes: string[], empresas: string[]): Promise<Hdr> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(),
    payload: { name: `${rotulo} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, permissions: permissoes } });
  expect(papel.statusCode, papel.body).toBe(201);
  const email = `hotfix-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@demo.local`;
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(),
    payload: { name: rotulo, email, password: "Hotfix@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos(empresas) } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Hotfix@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

/** Uma venda já confirmada, com estoque semeado e título gerado — o estado caro do cancelamento. */
async function vendaConfirmada(): Promise<string> {
  const venda = await criar("sale");
  const c = await confirmar(venda);
  expect(c.statusCode, c.body).toBe(200);
  return venda;
}

// ---------------------------------------------------------------------------------------------------
// CONFIRMAÇÃO × CONFIRMAÇÃO
// ---------------------------------------------------------------------------------------------------
describe("confirmação concorrente", () => {
  it("C1: duas confirmações SIMULTÂNEAS sem chave — uma confirma, a outra recusa pelo ESTADO", async () => {
    // Sem a trava as duas transações leem `open` do mesmo snapshot, passam as duas pela conferência de
    // status e executam os efeitos INTEIROS: dois movimentos de saída e dois conjuntos de títulos, ambos
    // com resposta de sucesso. A prova é aritmética — um movimento, um título, uma auditoria.
    const venda = await criar("sale");
    const antes = await saldo();

    const [a, b] = await Promise.all([confirmar(venda), confirmar(venda)]);

    const oks = [a, b].filter((r) => r.statusCode === 200);
    expect(oks.length, `a: ${a.statusCode} ${a.body} / b: ${b.statusCode} ${b.body}`).toBe(1);
    const perdedora = [a, b].find((r) => r.statusCode !== 200)!;
    expect(perdedora.statusCode, perdedora.body).toBe(409);
    expect(j(perdedora).error!.code).toBe("ALREADY_CONFIRMED");

    const e = await efeitos(venda);
    expect(e.status).toBe("confirmed");
    expect(e.movimentos, "uma confirmação = um movimento de saída").toBe(1);
    expect(e.titulos, "uma confirmação = um conjunto de títulos").toBe(1);
    expect(e.auditoria.confirm, "uma confirmação efetiva = uma auditoria").toBe(1);
    expect(await saldo(), "o estoque saiu UMA vez").toBe(antes - 1);
  }, 240_000);

  it("C2: duas confirmações SIMULTÂNEAS com a MESMA chave — nenhum efeito duplicado", async () => {
    // Aqui quem serializa primeiro é o INSERT da chave de idempotência; a trava do documento fica logo
    // atrás. As duas respostas legítimas são 200 (execução ou replay) e 409 (operação em andamento para
    // esta chave, que é o contrato do helper oficial).
    const venda = await criar("sale");
    const chave = `conf-c2-${venda}`;

    const [a, b] = await Promise.all([confirmar(venda, chave), confirmar(venda, chave)]);
    for (const r of [a, b]) expect([200, 409], r.body).toContain(r.statusCode);
    expect([a, b].filter((r) => r.statusCode === 200).length).toBeGreaterThanOrEqual(1);

    const e = await efeitos(venda);
    expect(e.status).toBe("confirmed");
    expect(e.movimentos).toBe(1);
    expect(e.titulos).toBe(1);
    expect(e.auditoria.confirm).toBe(1);
    const dois = [a, b].filter((r) => r.statusCode === 200);
    if (dois.length === 2) expect(j(dois[0]!), "replay é a resposta GRAVADA, não uma segunda confirmação").toEqual(j(dois[1]!));
  }, 240_000);

  it("C3: mesma chave em sequência — replay devolve a resposta gravada, com os MESMOS títulos", async () => {
    const venda = await criar("sale");
    const chave = `conf-c3-${venda}`;

    const r1 = await confirmar(venda, chave);
    expect(r1.statusCode, r1.body).toBe(200);
    const r2 = await confirmar(venda, chave);

    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(r2), "o reenvio é o MESMO pedido: mesma resposta, mesmos ids de título").toEqual(j(r1));
    const e = await efeitos(venda);
    expect(e.movimentos).toBe(1);
    expect(e.titulos).toBe(1);
    expect(e.auditoria.confirm).toBe(1);
  }, 180_000);

  it("C4: chave reaproveitada em OUTRA venda é conflito — a segunda venda fica intacta", async () => {
    // A chave é única por (organização, chave) e NADA MAIS. Sem a identidade da operação dentro do hash,
    // reusar a chave noutra venda devolveria 200 com os títulos da PRIMEIRA: o usuário leria sucesso e a
    // segunda venda continuaria aberta para sempre.
    const uma = await criar("sale"); const outra = await criar("sale");
    const chave = `conf-c4-${uma}`;

    expect((await confirmar(uma, chave)).statusCode).toBe(200);
    const r = await confirmar(outra, chave);

    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("CONFLICT");
    const e = await efeitos(outra);
    expect(e.status, "a segunda venda continua aberta, como o usuário a deixou").toBe("open");
    expect(e.movimentos).toBe(0);
    expect(e.titulos).toBe(0);
  }, 180_000);

  it("C6: cancelada primeiro, a venda NÃO confirma — e a recusa é pelo motivo certo", async () => {
    // X1 mede a corrida, mas quem vence a corrida não se escolhe: o ramo "cancelou antes" pode não rodar
    // nenhuma vez e o teste passar assim mesmo. Este caso é o mesmo par de decisões em ordem FIXA, para
    // que o ramo exista sempre — e a asserção é o CÓDIGO do erro, porque 409 sozinho é ambíguo (é o status
    // de ALREADY_CONFIRMED, ALREADY_CANCELLED, CONFLICT, INVALID_STATUS_TRANSITION e mais quatro).
    const venda = await criar("sale");
    const antes = await saldo();
    expect((await cancelar("sale", venda)).statusCode).toBe(200);

    const r = await confirmar(venda);

    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code, "recusa pelo estado que existe, não pelo que não existe").toBe("ALREADY_CANCELLED");
    const e = await efeitos(venda);
    expect(e.movimentos).toBe(0);
    expect(e.titulos).toBe(0);
    expect(e.auditoria.confirm).toBeUndefined();
    expect(await saldo(), "nada saiu do estoque").toBe(antes);
  }, 180_000);

  it("C5: chave gravada com o hash ANTERIOR não vira replay nem duplicação — recusa, e a venda fica aberta", async () => {
    // JANELA DE IMPLANTAÇÃO. O hash da confirmação passou a declarar a ação (`confirm_sales_document`).
    // Uma chave reservada pelo binário ANTERIOR, reenviada ao novo durante o rolling deploy, computa um
    // hash diferente. O que se exige aqui é a DIREÇÃO da falha: recusa explícita, nenhuma execução, nada
    // duplicado — e não um replay de resposta alheia.
    const venda = await criar("sale");
    const chave = `conf-c5-${venda}`;
    const hashAnterior = createHash("sha256").update(JSON.stringify({ confirm: venda })).digest("hex");
    await comPool((c) => c.query(
      "insert into erp.idempotency_keys(organization_id,key,request_hash,response_status,response_body) values ($1,$2,$3,200,$4)",
      [h.demo.orgId, chave, hashAnterior, JSON.stringify({ id: venda, status: "confirmed", title_ids: [] })]));

    const r = await confirmar(venda, chave);

    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("CONFLICT");
    const e = await efeitos(venda);
    expect(e.status, "a recusa não confirma e não deixa efeito").toBe("open");
    expect(e.movimentos).toBe(0);
    expect(e.titulos).toBe(0);
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------------
// CANCELAMENTO × CANCELAMENTO
// ---------------------------------------------------------------------------------------------------
describe("cancelamento concorrente", () => {
  it("K1: dois cancelamentos SIMULTÂNEOS de documento aberto — um cancela, o outro observa cancelado", async () => {
    const orcamento = await criar("budget");

    const [a, b] = await Promise.all([cancelar("budget", orcamento), cancelar("budget", orcamento)]);

    expect([a, b].filter((r) => r.statusCode === 200).length, `a: ${a.statusCode} ${a.body} / b: ${b.statusCode} ${b.body}`).toBe(1);
    const perdedora = [a, b].find((r) => r.statusCode !== 200)!;
    expect(perdedora.statusCode, perdedora.body).toBe(409);
    expect(j(perdedora).error!.code).toBe("ALREADY_CANCELLED");

    const e = await efeitos(orcamento);
    expect(e.status).toBe("cancelled");
    expect(e.auditoria.cancel, "um cancelamento efetivo = uma auditoria").toBe(1);
    expect(e.movimentos, "documento aberto não tem efeito de estoque para estornar").toBe(0);
  }, 240_000);

  it("K1b: dois cancelamentos SIMULTÂNEOS de VENDA aberta — nenhum entra no caminho do estorno", async () => {
    // K1 usa orçamento, que nunca posta estoque: lá `movimentos === 0` é verdade mesmo com o código
    // quebrado. Aqui o documento TEM armazém, então a contagem passa a medir alguma coisa — um
    // cancelamento que entrasse no ramo da venda confirmada estornaria o que nunca saiu.
    const venda = await criar("sale");
    const antes = await saldo();

    const [a, b] = await Promise.all([cancelar("sale", venda), cancelar("sale", venda)]);

    expect([a, b].filter((r) => r.statusCode === 200).length, `a: ${a.statusCode} ${a.body} / b: ${b.statusCode} ${b.body}`).toBe(1);
    const perdedora = [a, b].find((r) => r.statusCode !== 200)!;
    expect(perdedora.statusCode, perdedora.body).toBe(409);
    expect(j(perdedora).error!.code).toBe("ALREADY_CANCELLED");

    const e = await efeitos(venda);
    expect(e.status).toBe("cancelled");
    expect(e.movimentos, "venda aberta não tem saída para estornar").toBe(0);
    expect(e.titulos).toBe(0);
    expect(e.auditoria.cancel).toBe(1);
    expect(await saldo(), "o saldo não se mexe").toBe(antes);
  }, 240_000);

  it("K2: dois cancelamentos SIMULTÂNEOS de venda CONFIRMADA — UM estorno, nunca dois", async () => {
    // O caso caro. `reverseStock` não marca o movimento original como estornado (o ledger é imutável), de
    // modo que uma segunda passagem estornaria de novo a MESMA saída e o produto reapareceria no estoque
    // em dobro. Quem impede é a trava: a perdedora relê a linha já cancelada.
    const venda = await vendaConfirmada();
    const aposConfirmar = await saldo();

    const [a, b] = await Promise.all([cancelar("sale", venda), cancelar("sale", venda)]);

    expect([a, b].filter((r) => r.statusCode === 200).length, `a: ${a.statusCode} ${a.body} / b: ${b.statusCode} ${b.body}`).toBe(1);
    expect([a, b].find((r) => r.statusCode !== 200)!.statusCode).toBe(409);

    const e = await efeitos(venda);
    expect(e.status).toBe("cancelled");
    expect(e.estornos, "uma saída estornada UMA vez").toBe(1);
    expect(e.movimentos).toBe(2);
    expect(e.liquido, "o que saiu voltou, e só isso").toBe(0);
    expect(e.titulosAtivos, "nenhum título ativo sobra numa venda cancelada").toBe(0);
    expect(e.auditoria.cancel).toBe(1);
    expect(await saldo(), "o estoque volta ao que era — nem mais, nem menos").toBe(aposConfirmar + 1);
  }, 240_000);

  it("K3: cancelamento com a mesma chave em sequência — replay, sem segundo estorno", async () => {
    const venda = await vendaConfirmada();
    const aposConfirmar = await saldo();
    const chave = `canc-k3-${venda}`;

    const r1 = await cancelar("sale", venda, { chave, corpo: { reason: "Cancelado pelo usuário" } });
    expect(r1.statusCode, r1.body).toBe(200);
    const r2 = await cancelar("sale", venda, { chave, corpo: { reason: "Cancelado pelo usuário" } });

    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(r2)).toEqual(j(r1));
    const e = await efeitos(venda);
    expect(e.estornos).toBe(1);
    expect(e.liquido).toBe(0);
    expect(e.auditoria.cancel).toBe(1);
    expect(await saldo()).toBe(aposConfirmar + 1);
  }, 240_000);

  it("K4: chave de cancelamento reaproveitada em OUTRO documento é conflito — o outro fica aberto", async () => {
    const um = await criar("budget"); const dois = await criar("budget");
    const chave = `canc-k4-${um}`;

    expect((await cancelar("budget", um, { chave })).statusCode).toBe(200);
    const r = await cancelar("budget", dois, { chave });

    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("CONFLICT");
    expect((await efeitos(dois)).status, "o segundo documento não foi cancelado às escondidas").toBe("open");
  }, 180_000);

  it("K5: o MOTIVO participa da identidade do pedido e fica registrado na auditoria", async () => {
    // O motivo era recebido e descartado. Agora ele é conferido, entra no hash — reusar a chave com outro
    // motivo é outro pedido — e vai para a auditoria, que é onde alguém o procuraria seis meses depois.
    const orcamento = await criar("budget");
    const chave = `canc-k5-${orcamento}`;

    const r1 = await cancelar("budget", orcamento, { chave, corpo: { reason: "Cliente desistiu" } });
    expect(r1.statusCode, r1.body).toBe(200);
    const r2 = await cancelar("budget", orcamento, { chave, corpo: { reason: "Outro motivo" } });
    expect(r2.statusCode, r2.body).toBe(409);
    expect(j(r2).error!.code).toBe("CONFLICT");

    const meta = await comPool(async (c) => (await c.query<{ metadata: { reason?: string } | null }>(
      "select metadata from erp.audit_logs where entity='sales_documents' and entity_id=$1 and action='cancel'", [orcamento])).rows);
    expect(meta).toHaveLength(1);
    expect(meta[0]!.metadata?.reason).toBe("Cliente desistiu");
  }, 180_000);

  it("K6: motivo em branco é pedido malformado, e o documento não é tocado", async () => {
    const orcamento = await criar("budget");
    const r = await cancelar("budget", orcamento, { corpo: { reason: "   " } });
    expect(r.statusCode, r.body).toBe(422);
    expect((await efeitos(orcamento)).status, "recusa de forma não cancela nada").toBe("open");
    // O contrato que já existia continua: sem corpo nenhum, cancela.
    expect((await cancelar("budget", orcamento)).statusCode).toBe(200);
  }, 180_000);

  it("K7: chave DESCONHECIDA no corpo é 422 — um typo não cancela o documento em silêncio", async () => {
    // `z.object` sem `.strict()` DESCARTA o que não reconhece. Com o corpo agora declarado no contrato,
    // isso significaria que `{"reasn": ...}` — um typo de uma letra — vira `{}`: o documento é cancelado,
    // o cliente recebe 200 e o motivo que ele pediu para registrar não existe em lugar nenhum. Recusar é
    // o único desfecho honesto: contrato de entrada não canônico é RECUSADO, nunca traduzido nem ignorado.
    const venda = await criar("sale");
    const antes = await saldo();

    const r = await cancelar("sale", venda, { corpo: { reasn: "Cancelamento" } });

    expect(r.statusCode, r.body).toBe(422);
    const e = await efeitos(venda);
    expect(e.status, "recusa de forma não cancela nada").toBe("open");
    expect(e.auditoria.cancel, "nem audita").toBeUndefined();
    expect(e.movimentos, "nem toca o estoque").toBe(0);
    expect(e.titulos).toBe(0);
    expect(await saldo()).toBe(antes);

    // E o que o contrato ACEITA continua aceito — `.strict()` fecha a vizinhança do campo, não o campo.
    expect((await cancelar("sale", venda, { corpo: { reason: "Cancelado pelo usuário" } })).statusCode).toBe(200);
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------------
// CONFIRMAÇÃO × CANCELAMENTO — a prova crítica
// ---------------------------------------------------------------------------------------------------
describe("confirmação × cancelamento simultâneos", () => {
  it("X1: qualquer que seja o vencedor, o estado final é consistente e o estoque volta ao lugar", async () => {
    // Não se controla quem ganha a trava, e é esse o ponto: os DOIS finais possíveis são aceitáveis, e
    // nenhum estado intermediário é.
    //
    //   CANCELA primeiro → a confirmação espera, relê `cancelled` e recusa: zero título, zero baixa.
    //   CONFIRMA primeiro → o cancelamento espera, relê `confirmed` e segue o caminho legítimo da venda
    //                       confirmada: estorna o estoque e cancela os títulos.
    //
    // Em ambos o documento termina CANCELADO e o saldo volta ao inicial. O que nunca pode existir é
    // `confirmed` com efeito pela metade, `cancelled` com título ativo ou `cancelled` com estoque baixado.
    for (let volta = 1; volta <= 3; volta++) {
        const venda = await criar("sale");
      const antes = await saldo();

      const [conf, canc] = await Promise.all([confirmar(venda), cancelar("sale", venda)]);

      const e = await efeitos(venda);
      const contexto = `volta ${volta} — confirm: ${conf.statusCode} ${conf.body} / cancel: ${canc.statusCode} ${canc.body}`;
      expect(e.status, contexto).toBe("cancelled");
      expect(e.titulosAtivos, `nenhum título ativo pode sobrar (${contexto})`).toBe(0);
      expect(e.liquido, `o que saiu tem de ter voltado (${contexto})`).toBe(0);
      expect(e.movimentos % 2, `movimento sem par é efeito órfão (${contexto})`).toBe(0);
      expect(await saldo(), `o saldo volta ao inicial (${contexto})`).toBe(antes);
      expect(e.auditoria.cancel, `um cancelamento efetivo (${contexto})`).toBe(1);
      if (conf.statusCode === 200) {
        expect(e.movimentos, `confirmou antes: saída + estorno (${contexto})`).toBe(2);
        expect(e.titulos, `confirmou antes: os títulos existem, cancelados (${contexto})`).toBe(1);
      } else {
        expect(conf.statusCode, contexto).toBe(409);
        expect(e.movimentos, `cancelou antes: nada foi postado (${contexto})`).toBe(0);
        expect(e.titulos, `cancelou antes: nenhum título nasceu (${contexto})`).toBe(0);
      }
    }
  }, 300_000);

  it("X2: edição e confirmação SIMULTÂNEAS — o ledger corresponde ao item que ficou no documento", async () => {
    // A confirmação trava a LINHA do documento, mas lê os itens numa consulta separada, que a trava `of d`
    // não alcança. Quem protege os itens é a mesma trava, do outro lado: a edição também precisa decidir
    // "este status permite editar?" DEPOIS de adquirir a linha. Sem isso, a edição lê `open` do snapshot
    // anterior, aprova a transição, e o seu UPDATE entra depois do commit da confirmação — trocando itens
    // e total de um documento cujo estoque já saiu pelo conjunto antigo.
    //
    // A invariante não depende de quem vence: se o documento terminou confirmado, a quantidade baixada é
    // a quantidade que está no documento.
    for (let volta = 1; volta <= 3; volta++) {
      const venda = await criar("sale");

      const [conf, put] = await Promise.all([confirmar(venda), editar("sale", venda, "3")]);

      const e = await efeitos(venda);
      const q = await quantidades(venda);
      const contexto = `volta ${volta} — confirm: ${conf.statusCode} ${conf.body} / put: ${put.statusCode} ${put.body}`;
      expect([200, 409], contexto).toContain(put.statusCode);
      if (put.statusCode === 409) expect(j(put).error!.code, contexto).toBe("INVALID_STATUS_TRANSITION");
      expect(conf.statusCode, contexto).toBe(200);
      expect(e.status, contexto).toBe("confirmed");
      expect(e.movimentos, contexto).toBe(1);
      expect(q.movimento, `o que saiu do estoque tem de ser o que o documento diz (${contexto})`).toBe(q.item);
    }
  }, 300_000);
});

// ---------------------------------------------------------------------------------------------------
// TÍTULO COM BAIXA · ATOMICIDADE · ESCOPO
// ---------------------------------------------------------------------------------------------------
describe("fronteiras preservadas", () => {
  it("P1: venda com título BAIXADO não cancela, e a recusa não deixa efeito pela metade", async () => {
    const venda = await vendaConfirmada();
    const titulo = await comPool(async (c) => (await c.query<{ id: string; amount: string }>(
      "select id, amount from erp.financial_titles where source_type='sales_documents' and source_id=$1", [venda])).rows[0]!);
    const baixa = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${titulo.id}/settle`, headers: h.headers(),
      payload: { settlement_date: "2026-09-11", bank_account_id: I.bankAccount, amount: "10.00" } });
    expect(baixa.statusCode, baixa.body).toBe(201);
    const antes = await efeitos(venda);
    const saldoAntes = await saldo();

    const [a, b] = await Promise.all([cancelar("sale", venda), cancelar("sale", venda)]);

    for (const r of [a, b]) {
      expect(r.statusCode, r.body).toBe(409);
      expect(j(r).error!.code).toBe("CONFLICT");
    }
    const depois = await efeitos(venda);
    expect(depois.status, "a venda continua confirmada").toBe("confirmed");
    expect(depois.estornos, "recusa não estorna estoque").toBe(0);
    expect(depois.movimentos).toBe(antes.movimentos);
    expect(depois.titulosAtivos, "recusa não cancela título").toBe(antes.titulosAtivos);
    expect(depois.auditoria.cancel, "recusa não audita cancelamento").toBeUndefined();
    expect(await saldo()).toBe(saldoAntes);
  }, 300_000);

  it("P1b: cancelada a BAIXA, a venda volta a ser cancelável — a recusa de P1 não é beco sem saída", async () => {
    // Sem este caso, o 409 de P1 seria indistinguível de "esta venda nunca mais se cancela". O guarda diz
    // "cancele as baixas antes"; aqui se cancela a baixa e se comprova que a frase é verdadeira.
    const venda = await vendaConfirmada();
    const aposConfirmar = await saldo();
    const titulo = await comPool(async (c) => (await c.query<{ id: string }>(
      "select id from erp.financial_titles where source_type='sales_documents' and source_id=$1", [venda])).rows[0]!);
    const baixa = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${titulo.id}/settle`, headers: h.headers(),
      payload: { settlement_date: "2026-09-11", bank_account_id: I.bankAccount, amount: "10.00" } });
    expect(baixa.statusCode, baixa.body).toBe(201);
    expect((await cancelar("sale", venda)).statusCode, "premissa: com baixa, recusa").toBe(409);

    const desfaz = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${titulo.id}/settlements/${j(baixa).settlement_id}/cancel`,
      headers: h.headers(), payload: { reason: "Baixa indevida" } });
    expect(desfaz.statusCode, desfaz.body).toBe(200);

    const r = await cancelar("sale", venda);
    expect(r.statusCode, r.body).toBe(200);
    const e = await efeitos(venda);
    expect(e.status).toBe("cancelled");
    expect(e.estornos).toBe(1);
    expect(e.liquido).toBe(0);
    expect(e.titulosAtivos).toBe(0);
    expect(await saldo()).toBe(aposConfirmar + 1);
  }, 300_000);

  it("P2: baixa de título e cancelamento SIMULTÂNEOS — nunca um título com baixa E cancelado", async () => {
    // A trava do DOCUMENTO não alcança a baixa: quem baixa é `/api/financial/receivables/:id/settle`, que
    // tranca a linha do TÍTULO e nunca toca `erp.sales_documents`. Por isso a conferência de
    // `paid_amount > 0` é feita sobre as linhas de título TRAVADAS. Sem isso, o cancelamento lê
    // `paid_amount = 0`, a baixa commita, e o cancelamento segue estornando estoque e carimbando
    // `cancelled` sobre um título que acabou de receber dinheiro — com o movimento bancário vivo e
    // `erp.refresh_title_status` já desistindo de reconciliar, porque ela retorna cedo para cancelado.
    for (let volta = 1; volta <= 3; volta++) {
      const venda = await vendaConfirmada();
      const titulo = await comPool(async (c) => (await c.query<{ id: string }>(
        "select id from erp.financial_titles where source_type='sales_documents' and source_id=$1", [venda])).rows[0]!);

      const [baixa, canc] = await Promise.all([
        h.app.inject({ method: "POST", url: `/api/financial/receivables/${titulo.id}/settle`, headers: h.headers(),
          payload: { settlement_date: "2026-09-11", bank_account_id: I.bankAccount, amount: "10.00" } }),
        cancelar("sale", venda)
      ]);

      const t = await comPool(async (c) => (await c.query<{ status: string; paid_amount: string }>(
        "select status, paid_amount from erp.financial_titles where id=$1", [titulo.id])).rows[0]!);
      const e = await efeitos(venda);
      const contexto = `volta ${volta} — baixa: ${baixa.statusCode} ${baixa.body} / cancel: ${canc.statusCode} ${canc.body}`;

      // A INVARIANTE, independente de quem venceu.
      expect(Number(t.paid_amount) > 0 && t.status === "cancelled",
        `título com baixa E cancelado é o estado que o guarda existe para impedir (${contexto})`).toBe(false);

      expect([baixa.statusCode === 201, canc.statusCode === 200].filter(Boolean).length,
        `uma das duas vence, nunca as duas (${contexto})`).toBe(1);

      if (baixa.statusCode === 201) {
        expect(canc.statusCode, contexto).toBe(409);
        expect(j(canc).error!.code, contexto).toBe("CONFLICT");
        expect(e.status, contexto).toBe("confirmed");
        expect(e.estornos, `recusa não estorna (${contexto})`).toBe(0);
        expect(Number(t.paid_amount), contexto).toBeGreaterThan(0);
      } else {
        expect(canc.statusCode, contexto).toBe(200);
        expect(baixa.statusCode, contexto).toBe(409);
        expect(e.status, contexto).toBe("cancelled");
        expect(e.estornos, contexto).toBe(1);
        expect(Number(t.paid_amount), `cancelado sem baixa alguma (${contexto})`).toBe(0);
      }
    }
  }, 300_000);

  it("A1: falha DEPOIS do efeito de estoque desfaz a transação inteira", async () => {
    // A confirmação posta o estoque ANTES de procurar a categoria de receita e o centro de custo. Sem
    // categoria, ela falha exatamente nesse ponto — depois de um efeito intermediário já executado. O que
    // se mede é a atomicidade: o movimento não pode ter sobrado, e o status não pode ter avançado.
    const venda = await criar("sale");
    const saldoAntes = await saldo();
    await comPool((c) => c.query("update erp.financial_categories set deleted_at=now() where organization_id=$1 and nature='income' and kind='analytic'", [h.demo.orgId]));
    try {
      const r = await confirmar(venda);
      expect(r.statusCode, r.body).toBe(422);
      const e = await efeitos(venda);
      expect(e.status, "a venda continua aberta").toBe("open");
      expect(e.movimentos, "o estoque postado antes da falha foi desfeito com a transação").toBe(0);
      expect(e.titulos).toBe(0);
      expect(e.auditoria.confirm).toBeUndefined();
      expect(await saldo(), "o saldo não se mexeu").toBe(saldoAntes);
    } finally {
      await comPool((c) => c.query("update erp.financial_categories set deleted_at=null where organization_id=$1 and nature='income' and kind='analytic'", [h.demo.orgId]));
    }
    // E, restaurada a condição, a MESMA venda confirma: a falha não deixou a linha inutilizável.
    expect((await confirmar(venda)).statusCode).toBe(200);
  }, 240_000);

  it("T1: a trava não afrouxou capacidade, variante nem escopo de empresa", async () => {
    const venda = await criar("sale");

    // (a) VARIANTE: cancelar uma venda pela rota de orçamentos é 404 — a mesma recusa de um id que não
    //     existe —, e nada é tocado.
    expect((await cancelar("budget", venda)).statusCode).toBe(404);
    expect((await efeitos(venda)).status).toBe("open");

    // (b) CAPACIDADE: a recusa do `runService` continua acontecendo ANTES de qualquer leitura de registro.
    const leitor = await membro("Leitor de vendas", ["sales.view"], []);
    expect((await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/confirm`, headers: leitor })).statusCode).toBe(403);
    expect((await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/cancel`, headers: leitor })).statusCode).toBe(403);

    // (c) ESCOPO DE EMPRESA: capacidade completa, escopo em OUTRA empresa. A recusa é 404 — não se revela
    //     que o documento existe —, inclusive com chave de idempotência no cabeçalho.
    const foraDeEscopo = await membro("Vendedor de outra empresa", ["sales.view", "sales.edit", "sales.delete"], [I.empresa2]);
    const r = await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/cancel`, headers: { ...foraDeEscopo, "idempotency-key": `escopo-${venda}` } });
    expect(r.statusCode, r.body).toBe(404);
    expect((await efeitos(venda)).status, "a recusa por escopo não deixa efeito").toBe("open");

    // E a venda continua confirmável por quem de direito: as recusas acima não travaram a linha.
    expect((await confirmar(venda)).statusCode).toBe(200);
  }, 300_000);

  it("T2: chave de OUTRO usuário, que ENXERGA o documento — 409, e o corpo gravado não vira resposta dele", async () => {
    // ESTE é o caso que `actorId` no hash fecha, e é por isso que ele continua ganhando o lugar depois do
    // preflight. Os dois usuários têm escopo na MESMA empresa, então a conferência de visibilidade passa
    // para ambos: o que separa um do outro é só o autor dentro do hash. Sem ele, o segundo usuário reusando
    // a chave do primeiro receberia 200 com `title_ids` de uma operação que ele nunca executou — e o pedido
    // que ele de fato mandou jamais rodaria.
    const venda = await criar("sale");
    const chave = `conf-t2-${venda}`;
    const original = await confirmar(venda, chave);
    expect(original.statusCode, original.body).toBe(200);
    const titulos = j(original).title_ids as string[];
    expect(titulos.length, "premissa: a resposta gravada carrega dados do documento").toBeGreaterThan(0);

    const outro = await membro("Outro vendedor da MESMA empresa", ["sales.view", "sales.edit", "sales.delete"], [I.empresa]);
    const r = await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/confirm`,
      headers: { ...outro, "idempotency-key": chave } });

    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("CONFLICT");
    expect(r.body, "a resposta gravada não pode sair na recusa").not.toContain(titulos[0]!);
  }, 300_000);

  it("T2b: chave de outro usuário FORA do escopo — 404, e não 409: a recusa não confirma que a chave existe", async () => {
    // Antes do preflight esta era a mesma asserção do T2 e respondia 409 CONFLICT. O 409 era correto quanto
    // ao efeito (nada executava, nada vazava) e ERRADO quanto à superfície: dizia "esta chave já está
    // tomada" a quem nem sequer pode ver o documento — um oráculo pequeno, mas oráculo. Com a conferência
    // de visibilidade ANTES do helper, a recusa passa a ser a MESMA 404 de id inexistente, de outro tenant
    // e de outra variante, que é o que `.claude/rules/security.md` exige. A mudança é um APERTO do contrato
    // de recusa, não um afrouxamento — e está declarada no encerramento da fatia.
    const venda = await criar("sale");
    const chave = `conf-t2b-${venda}`;
    const original = await confirmar(venda, chave);
    expect(original.statusCode, original.body).toBe(200);
    const titulos = j(original).title_ids as string[];

    const foraDeEscopo = await membro("Vendedor de outra empresa", ["sales.view", "sales.edit", "sales.delete"], [I.empresa2]);
    const r = await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/confirm`,
      headers: { ...foraDeEscopo, "idempotency-key": chave } });

    expect(r.statusCode, r.body).toBe(404);
    expect(j(r).error!.code).toBe("NOT_FOUND");
    expect(r.body, "nenhum dado do documento pode sair na recusa").not.toContain(titulos[0]!);
  }, 300_000);

  it("T3: MESMO usuário, MESMA chave, OUTRA empresa selecionada — 404 antes do replay (cancelamento)", async () => {
    // O QUE `actorId` NÃO ALCANÇA. Ele fecha o replay entre atores DIFERENTES (T2). Aqui o ator é o MESMO,
    // e tem acesso legítimo às duas empresas: o que muda entre as duas chamadas é só a empresa SELECIONADA
    // — que não entra no hash, e por isso não pode ser o que decide. Sem a conferência de visibilidade
    // ANTES do helper, o replay devolve 200 com o corpo gravado num contexto em que a chamada normal
    // responde 404, e o recorte de empresa vaza pela porta da idempotência.
    const venda = await criar("sale");
    const u = await membro("Vendedor das duas empresas", ["sales.view", "sales.edit", "sales.delete"], [I.empresa, I.empresa2]);
    const chave = `canc-t3-${venda}`;
    const corpo = { reason: "Cancelado pelo usuário" };

    const original = await cancelar("sale", venda, { chave, corpo, headers: { ...u, "x-empresa-id": I.empresa } });
    expect(original.statusCode, original.body).toBe(200);

    // Mesma chave, mesmo ator, mesmo documento, mesmo corpo: o hash é IDÊNTICO ao da chamada acima.
    const r = await cancelar("sale", venda, { chave, corpo, headers: { ...u, "x-empresa-id": I.empresa2 } });

    expect(r.statusCode, r.body).toBe(404);
    expect(j(r).error!.code).toBe("NOT_FOUND");
    expect(r.body, "a recusa não pode carregar nada do documento").not.toContain(venda);
    // E a empresa B é uma seleção LEGÍTIMA deste usuário: o 404 é do documento, não da empresa.
    expect((await h.app.inject({ method: "GET", url: "/api/sales/sales?pageSize=1", headers: { ...u, "x-empresa-id": I.empresa2 } })).statusCode,
      "premissa: o usuário pode mesmo trabalhar na empresa B").toBe(200);
  }, 300_000);

  it("T3b: o mesmo, na CONFIRMAÇÃO — e `title_ids` não escapa pelo corpo gravado", async () => {
    const venda = await criar("sale");
    const u = await membro("Vendedor das duas empresas", ["sales.view", "sales.edit", "sales.delete"], [I.empresa, I.empresa2]);
    const chave = `conf-t3b-${venda}`;

    const original = await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/confirm`,
      headers: { ...u, "x-empresa-id": I.empresa, "idempotency-key": chave } });
    expect(original.statusCode, original.body).toBe(200);
    const titulos = j(original).title_ids as string[];
    expect(titulos.length, "premissa: a resposta gravada carrega dados do documento").toBeGreaterThan(0);

    const r = await h.app.inject({ method: "POST", url: `/api/sales/sales/${venda}/confirm`,
      headers: { ...u, "x-empresa-id": I.empresa2, "idempotency-key": chave } });

    expect(r.statusCode, r.body).toBe(404);
    expect(j(r).error!.code).toBe("NOT_FOUND");
    expect(r.body, "nenhum `title_id` pode sair por aqui").not.toContain(titulos[0]!);
  }, 300_000);
});
