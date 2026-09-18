import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "@agro/db";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * FRONTEIRA DE VARIANTE DE `erp.financial_titles` — CAPACIDADE DA ROTA × DIRECTION DO REGISTRO.
 *
 * `financial_titles` é UMA tabela com DUAS variantes (`direction`), e cada variante tem a sua própria
 * família de capacidades: `payables.*` × `receivables.*`. As rotas são variantes
 * (`/financial/payables/...` e `/financial/receivables/...`) e autorizam pela capacidade DA ROTA.
 *
 * O defeito que esta matriz existe para travar: as portas carregavam o título só por id + organização +
 * escopo de empresa, SEM amarrar `direction` à rota. Quem tivesse `receivables.view` conseguia ler um
 * PAGÁVEL pedindo o UUID dele pela rota de recebíveis — capacidade de uma variante virando acesso à
 * outra. Era leitura e também MUTAÇÃO: duplicar (que ainda criava a cópia com a direction DA ROTA),
 * baixar, baixar em lote, cancelar baixa e emitir recibo (que inverteria "Pago a"/"Recebido de").
 *
 * O contrato provado aqui:
 *   capacidade da rota ∧ registro.direction == variante da rota ∧ tenant ∧ escopo de empresa
 * combinados com AND. Variante errada é INEXISTENTE PARA AQUELA ROTA: 404, nunca 200, nunca redirect,
 * e sem revelar que o UUID existe na variante vizinha.
 *
 * O caso C (admin com AS DUAS capacidades) é o que dá valor à matriz: sem ele, um 404 poderia estar
 * vindo da falta de permissão em vez da direction do registro, e o teste passaria sem provar nada.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; settled?: number; total?: string; error?: { code: string } };

const CRUZADAS = ["view", "settle", "cancel_settlement", "receipt", "duplicate", "edit", "delete"] as const;
const todasAsCapacidades = (recurso: "payables" | "receivables") => CRUZADAS.map((a) => `${recurso}.${a}`);

async function membro(nome: string, email: string, perms: string[]): Promise<Hdr> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Variante@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Variante@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

async function criar(dir: "payable" | "receivable", numero: string, valor = "500.00"): Promise<string> {
  const r = await h.app.inject({
    method: "POST", url: `/api/financial/${dir}s`, headers: h.headers(),
    payload: {
      empresa_id: I.empresa, number: numero, person_id: dir === "payable" ? I.provider : I.client,
      amount: valor, emission_date: "2026-09-01", due_date: "2026-09-30", note: `Fronteira ${numero}`,
      apportionment: [{ financial_category_id: dir === "payable" ? I.category : I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }]
    }
  });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

/** Leitura direta do estado persistido: o teste não pergunta à rota se a rota mudou alguma coisa. */
async function estado(id: string): Promise<{ balance: string; status: string; baixas: number; movimentos: number }> {
  const c = createPool(TEST_URL, { max: 1 });
  try {
    const t = (await c.query<{ balance: string; status: string }>("select balance, status from erp.financial_titles where id=$1", [id])).rows[0]!;
    const b = (await c.query<{ n: string }>("select count(*) n from erp.title_settlements where title_id=$1 and status='confirmed'", [id])).rows[0]!;
    const m = (await c.query<{ n: string }>("select count(*) n from erp.bank_movements where source_id=$1 and status='confirmed'", [id])).rows[0]!;
    return { balance: t.balance, status: t.status, baixas: Number(b.n), movimentos: Number(m.n) };
  } finally { await c.end(); }
}

async function totalDeTitulos(): Promise<number> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return Number((await c.query<{ n: string }>("select count(*) n from erp.financial_titles where organization_id=$1", [h.demo.orgId])).rows[0]!.n); }
  finally { await c.end(); }
}

let pagavel: string; let recebivel: string;
let soPagavel: Hdr; let soRecebivel: Hdr;

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  pagavel = await criar("payable", "FRONT-PAG");
  recebivel = await criar("receivable", "FRONT-REC");
  soPagavel = await membro("Só pagáveis", "fronteira.pagavel@demo.local", todasAsCapacidades("payables"));
  soRecebivel = await membro("Só recebíveis", "fronteira.recebivel@demo.local", todasAsCapacidades("receivables"));
}, 120_000);

afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("fronteira de variante: leitura", () => {
  it("A — papel PAYABLE-ONLY lê o pagável, NÃO lê o recebível pela rota que ele tem, e é barrado na rota que não tem", async () => {
    const certo = await h.app.inject({ method: "GET", url: `/api/financial/payables/${pagavel}`, headers: soPagavel });
    expect(certo.statusCode, certo.body).toBe(200);
    expect(j(certo).direction).toBe("payable");

    // O ponto da matriz: o usuário TEM `payables.view`; quem nega é a DIRECTION DO REGISTRO.
    const cruzado = await h.app.inject({ method: "GET", url: `/api/financial/payables/${recebivel}`, headers: soPagavel });
    expect(cruzado.statusCode, cruzado.body).toBe(404);

    // E a rota da outra variante continua barrada por capacidade — 403, não 404: são recusas diferentes.
    const semCapacidade = await h.app.inject({ method: "GET", url: `/api/financial/receivables/${recebivel}`, headers: soPagavel });
    expect(semCapacidade.statusCode, semCapacidade.body).toBe(403);
  });

  it("B — papel RECEIVABLE-ONLY é o espelho exato do caso A", async () => {
    const certo = await h.app.inject({ method: "GET", url: `/api/financial/receivables/${recebivel}`, headers: soRecebivel });
    expect(certo.statusCode, certo.body).toBe(200);
    expect(j(certo).direction).toBe("receivable");

    const cruzado = await h.app.inject({ method: "GET", url: `/api/financial/receivables/${pagavel}`, headers: soRecebivel });
    expect(cruzado.statusCode, cruzado.body).toBe(404);

    const semCapacidade = await h.app.inject({ method: "GET", url: `/api/financial/payables/${pagavel}`, headers: soRecebivel });
    expect(semCapacidade.statusCode, semCapacidade.body).toBe(403);
  });

  it("C — admin tem AS DUAS capacidades e mesmo assim leva 404 na rota da variante errada", async () => {
    // Sem este caso a matriz não provaria nada: um 404 poderia ser falta de permissão disfarçada.
    for (const [rota, id] of [["payables", recebivel], ["receivables", pagavel]] as const) {
      const r = await h.app.inject({ method: "GET", url: `/api/financial/${rota}/${id}`, headers: h.headers() });
      expect(r.statusCode, `${rota} deveria recusar o id da outra variante: ${r.body}`).toBe(404);
    }
    // E as rotas certas continuam funcionando para o mesmo admin, no mesmo teste.
    for (const [rota, id] of [["payables", pagavel], ["receivables", recebivel]] as const) {
      const r = await h.app.inject({ method: "GET", url: `/api/financial/${rota}/${id}`, headers: h.headers() });
      expect(r.statusCode, r.body).toBe(200);
    }
  });
});

describe("fronteira de variante: portas mutáveis", () => {
  it("1 — DUPLICATE na variante errada devolve 404 e NÃO cria título nenhum", async () => {
    const antes = await totalDeTitulos();
    const r = await h.app.inject({ method: "POST", url: `/api/financial/payables/${recebivel}/duplicate`, headers: h.headers(), payload: {} });
    expect(r.statusCode, r.body).toBe(404);
    expect(await totalDeTitulos(), "duplicar pela rota errada não pode criar registro").toBe(antes);

    // A porta certa continua criando — e criando na variante do REGISTRO.
    const ok = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${recebivel}/duplicate`, headers: h.headers(), payload: {} });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await totalDeTitulos()).toBe(antes + 1);
    const copia = await h.app.inject({ method: "GET", url: `/api/financial/receivables/${j(ok).id}`, headers: h.headers() });
    expect(j(copia).direction).toBe("receivable");
  });

  it("2 — SETTLE na variante errada devolve 404 e não move saldo, baixa nem movimento bancário", async () => {
    const antes = await estado(recebivel);
    const r = await h.app.inject({ method: "POST", url: `/api/financial/payables/${recebivel}/settle`, headers: h.headers(), payload: { settlement_date: "2026-09-15", bank_account_id: I.bankAccount, amount: "100.00" } });
    expect(r.statusCode, r.body).toBe(404);
    expect(await estado(recebivel)).toEqual(antes);
  });

  it("3 — SETTLE-BATCH ignora a variante oposta: nada é liquidado e o valor dela não entra no total", async () => {
    const soOposto = await criar("receivable", "FRONT-LOTE-REC", "700.00");
    const antesOposto = await estado(soOposto);

    // Lote SÓ com a variante oposta: settled=0 e nenhuma mutação.
    const vazio = await h.app.inject({ method: "POST", url: "/api/financial/payables/settle-batch", headers: h.headers(), payload: { ids: [soOposto], settlement_date: "2026-09-16", bank_account_id: I.cashAccount, movement_mode: "single" } });
    expect(vazio.statusCode, vazio.body).toBe(201);
    expect(j(vazio).settled).toBe(0);
    expect(await estado(soOposto)).toEqual(antesOposto);

    // Lote MISTO em movimento ÚNICO: o total do movimento é o de UM título só, não a soma dos dois.
    // Este é o caso perigoso — o tipo do movimento bancário sai de `dir`, então somar a variante oposta
    // criaria uma saída de caixa com dinheiro que é de entrada.
    const correto = await criar("payable", "FRONT-LOTE-PAG", "300.00");
    const misto = await h.app.inject({ method: "POST", url: "/api/financial/payables/settle-batch", headers: h.headers(), payload: { ids: [correto, soOposto], settlement_date: "2026-09-16", bank_account_id: I.cashAccount, movement_mode: "single" } });
    expect(misto.statusCode, misto.body).toBe(201);
    expect(j(misto).settled).toBe(1);
    expect(j(misto).total, "o saldo da variante oposta não pode entrar no total do movimento").toBe("300.00");
    expect(await estado(soOposto), "o título da variante oposta continua intacto").toEqual(antesOposto);
    expect((await estado(correto)).status).toBe("paid");
  });

  it("4 — CANCEL SETTLEMENT na variante errada devolve 404 e a baixa continua confirmada", async () => {
    const alvo = await criar("receivable", "FRONT-CANCEL", "400.00");
    const baixa = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${alvo}/settle`, headers: h.headers(), payload: { settlement_date: "2026-09-17", bank_account_id: I.bankAccount, amount: "400.00" } });
    expect(baixa.statusCode, baixa.body).toBe(201);
    const sid = j(baixa).settlement_id as string;
    const antes = await estado(alvo);
    expect(antes.baixas).toBe(1);

    const r = await h.app.inject({ method: "POST", url: `/api/financial/payables/${alvo}/settlements/${sid}/cancel`, headers: h.headers(), payload: { reason: "tentativa pela rota errada" } });
    expect(r.statusCode, r.body).toBe(404);
    expect(await estado(alvo), "a baixa e o movimento bancário não podem ser tocados pela rota errada").toEqual(antes);

    // A porta certa continua cancelando.
    const ok = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${alvo}/settlements/${sid}/cancel`, headers: h.headers(), payload: { reason: "cancelamento legítimo" } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await estado(alvo)).baixas).toBe(0);
  });

  it("4b — a recusa do cancelamento cruzado é 404 mesmo quando o caminho antigo produziria CONFLICT", async () => {
    // POR QUE ESTE CASO EXISTE. A verificação reversa S5 (remover a guarda de direction do cancelamento)
    // passou no caso 4: a mutação indevida acontecia, mas o `getTitle` do RETORNO barrava por direction e
    // derrubava a transação inteira — 404 na resposta, estado intacto, sabotagem invisível.
    //
    // O que a transação NÃO desfaz é o CÓDIGO DE ERRO. Com movimento bancário COMPARTILHADO, o caminho
    // antigo cancelava a baixa, batia no `CONFLICT` do movimento e devolvia 409 — ANTES de chegar ao
    // `getTitle`. Um 409 aqui diz "esta baixa existe e está presa a um movimento compartilhado" para
    // quem pediu pela rota da OUTRA variante: é a superfície de recusa vazando existência
    // (`.claude/rules/security.md`). Com a guarda, a rota errada não distingue nada: 404, igual a
    // inexistente.
    const a = await criar("receivable", "FRONT-SHARED-A", "250.00");
    const b = await criar("receivable", "FRONT-SHARED-B", "350.00");
    const lote = await h.app.inject({ method: "POST", url: "/api/financial/receivables/settle-batch", headers: h.headers(), payload: { ids: [a, b], settlement_date: "2026-09-18", bank_account_id: I.cashAccount, movement_mode: "single" } });
    expect(lote.statusCode, lote.body).toBe(201);
    expect(j(lote).settled, "as duas baixas precisam existir para o movimento ser compartilhado").toBe(2);
    const sid = (j(lote).items as { settlement_id: string }[])[0]!.settlement_id;

    const antes = await estado(a);
    const cruzado = await h.app.inject({ method: "POST", url: `/api/financial/payables/${a}/settlements/${sid}/cancel`, headers: h.headers(), payload: { reason: "rota errada, movimento compartilhado" } });
    expect(cruzado.statusCode, `esperado 404; 409 aqui revelaria a baixa a quem pediu pela variante errada: ${cruzado.body}`).toBe(404);
    expect(j(cruzado).error?.code, "o código de erro não pode diferenciar 'não existe' de 'existe e está presa'").not.toBe("CONFLICT");
    expect(await estado(a)).toEqual(antes);

    // E pela rota CERTA o 409 legítimo continua existindo — a guarda não engoliu o contrato real.
    const legitimo = await h.app.inject({ method: "POST", url: `/api/financial/receivables/${a}/settlements/${sid}/cancel`, headers: h.headers(), payload: { reason: "movimento compartilhado de verdade" } });
    expect(legitimo.statusCode, legitimo.body).toBe(409);
    expect(j(legitimo).error?.code).toBe("CONFLICT");
  });

  it("5 — RECEIPT na variante errada devolve 404, e o recibo certo não inverte o texto", async () => {
    const errado = await h.app.inject({ method: "GET", url: `/api/financial/payables/${recebivel}/receipt`, headers: h.headers() });
    expect(errado.statusCode, errado.body).toBe(404);

    const certo = await h.app.inject({ method: "GET", url: `/api/financial/receivables/${recebivel}/receipt`, headers: h.headers() });
    expect(certo.statusCode, certo.body).toBe(200);
    expect(String(j(certo).receipt_text)).toContain("Recebido de");
    expect(String(j(certo).receipt_text)).not.toContain("Pago a");
  });

  it("6 — EDIT e CANCEL (que já filtravam direction) continuam recusando a variante errada", async () => {
    // Não é caso novo: é a catraca de que a correção não afrouxou o que já estava certo.
    const edit = await h.app.inject({ method: "PUT", url: `/api/financial/payables/${recebivel}`, headers: h.headers(), payload: { note: "não deveria gravar" } });
    expect(edit.statusCode, edit.body).toBe(404);
    const cancel = await h.app.inject({ method: "POST", url: `/api/financial/payables/${recebivel}/cancel`, headers: h.headers(), payload: {} });
    expect(cancel.statusCode, cancel.body).toBe(404);
  });
});
