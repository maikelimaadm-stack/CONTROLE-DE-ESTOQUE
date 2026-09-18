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

async function criar(dir: "payable" | "receivable", numero: string, valor = "500.00", empresaId?: string): Promise<string> {
  const r = await h.app.inject({
    method: "POST", url: `/api/financial/${dir}s`, headers: h.headers(),
    payload: {
      empresa_id: empresaId ?? I.empresa, number: numero, person_id: dir === "payable" ? I.provider : I.client,
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
let soPagavel: Hdr; let soRecebivel: Hdr; let ambos: Hdr;

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  pagavel = await criar("payable", "FRONT-PAG");
  recebivel = await criar("receivable", "FRONT-REC");
  soPagavel = await membro("Só pagáveis", "fronteira.pagavel@demo.local", todasAsCapacidades("payables"));
  soRecebivel = await membro("Só recebíveis", "fronteira.recebivel@demo.local", todasAsCapacidades("receivables"));
  // Papel com AS DUAS famílias: é ele que prova que a recusa dos casos A/B/E vem da capacidade que
  // FALTA, e não de outra coisa no caminho. Sem este par, um 403 não distinguiria as duas hipóteses.
  ambos = await membro("Pagáveis e recebíveis", "fronteira.ambos@demo.local", [...todasAsCapacidades("payables"), ...todasAsCapacidades("receivables")]);
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

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * HOTFIX PÓS-BASE2-03B — BAIXA CRUZADA: A OPERAÇÃO COMPOSTA EXIGE AS DUAS CAPACIDADES
 *
 * A PR #42 fechou a fronteira da ROTA. A baixa cruzada escapava por dentro: ela grava, de propósito,
 * uma linha de baixa no título da variante CONTRÁRIA — e exigia só a capacidade da rota. Quem tinha
 * `payables.settle` gravava num recebível sem ter `receivables.settle`. O cancelamento tinha o mesmo
 * furo, e ainda mutava antes de descobrir.
 *
 * O que estes casos travam: autorização composta ANTES da primeira mutação, período das DUAS empresas,
 * trilha de auditoria dos DOIS lados, e identidade exata do espelho quando o mesmo par tem mais de uma
 * baixa cruzada confirmada.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** Baixas de um título, com status — o teste conta linhas, não confia na resposta da rota. */
async function baixasDe(titleId: string): Promise<{ id: string; status: string; cross_title_id: string | null; nascido: string }[]> {
  // `created_at` sai como TEXTO com microssegundos de propósito: o `Date` do driver só tem
  // milissegundos, e comparar em JS esconderia justamente a diferença que amarra o espelho ao par.
  const c = createPool(TEST_URL, { max: 1 });
  try { return (await c.query<{ id: string; status: string; cross_title_id: string | null; nascido: string }>("select id, status, cross_title_id, created_at::text as nascido from erp.title_settlements where title_id=$1 order by created_at, id", [titleId])).rows; }
  finally { await c.end(); }
}

async function congelar(empresaId: string, ano: number, mes: number): Promise<string> {
  const c = createPool(TEST_URL, { max: 1 });
  try {
    return (await c.query<{ id: string }>("insert into erp.financial_freezes(organization_id,empresa_id,year,month,is_frozen) values ($1,$2,$3,$4,true) returning id", [h.demo.orgId, empresaId, ano, mes])).rows[0]!.id;
  } finally { await c.end(); }
}
async function descongelar(freezeId: string): Promise<void> {
  const c = createPool(TEST_URL, { max: 1 });
  try { await c.query("delete from erp.financial_freezes where id=$1", [freezeId]); } finally { await c.end(); }
}

async function auditoriaDe(entityId: string, action: string): Promise<number> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return Number((await c.query<{ n: string }>("select count(*) n from erp.audit_logs where entity='title_settlements' and entity_id=$1 and action=$2", [entityId, action])).rows[0]!.n); }
  finally { await c.end(); }
}

/** Baixa cruzada pela porta real. `headers` decide QUEM está pedindo — é disso que o caso trata. */
const cruzar = (rota: "payables" | "receivables", principal: string, contrario: string, headers: Hdr, valor: string, kind = "cross_settlement", data = "2026-09-20") =>
  h.app.inject({ method: "POST", url: `/api/financial/${rota}/${principal}/settle`, headers, payload: { settlement_date: data, settlement_kind: kind, cross_title_id: contrario, amount: valor } });

describe("baixa cruzada: autorização composta das duas variantes", () => {
  it("A — PAYABLE-ONLY não grava no recebível contrário: recusa, e NENHUM dos dois títulos muda", async () => {
    const p = await criar("payable", "CROSS-A-PAG", "400.00");
    const r = await criar("receivable", "CROSS-A-REC", "400.00");
    const antesP = await estado(p); const antesR = await estado(r);

    // O usuário TEM payables.settle (a rota o aceita). Quem nega é a capacidade da variante CONTRÁRIA.
    const res = await cruzar("payables", p, r, soPagavel, "100.00");
    expect(res.statusCode, res.body).toBe(403);
    expect(j(res).error?.code).toBe("PERMISSION_DENIED");

    expect(await estado(p), "título principal não pode ter sido tocado").toEqual(antesP);
    expect(await estado(r), "título contrário não pode ter sido tocado").toEqual(antesR);
    expect((await baixasDe(p)).length, "zero baixa no principal").toBe(0);
    expect((await baixasDe(r)).length, "zero baixa no contrário").toBe(0);
  });

  it("B — RECEIVABLE-ONLY é o espelho exato de A", async () => {
    const p = await criar("payable", "CROSS-B-PAG", "400.00");
    const r = await criar("receivable", "CROSS-B-REC", "400.00");
    const antesP = await estado(p); const antesR = await estado(r);

    const res = await cruzar("receivables", r, p, soRecebivel, "100.00");
    expect(res.statusCode, res.body).toBe(403);
    expect(await estado(p)).toEqual(antesP);
    expect(await estado(r)).toEqual(antesR);
    expect((await baixasDe(p)).length + (await baixasDe(r)).length).toBe(0);
  });

  it("C — com AS DUAS capacidades a baixa cruzada funciona e os DOIS lados refletem a operação", async () => {
    const p = await criar("payable", "CROSS-C-PAG", "400.00");
    const r = await criar("receivable", "CROSS-C-REC", "400.00");

    const res = await cruzar("payables", p, r, ambos, "150.00");
    expect(res.statusCode, res.body).toBe(201);

    const depoisP = await estado(p); const depoisR = await estado(r);
    expect(depoisP.balance, "saldo do principal cai").toBe("250.00");
    expect(depoisR.balance, "saldo do contrário TAMBÉM cai — é isso que a capacidade contrária autoriza").toBe("250.00");

    const bp = await baixasDe(p); const br = await baixasDe(r);
    expect(bp.length).toBe(1); expect(br.length).toBe(1);
    expect(bp[0]!.cross_title_id, "a baixa do principal aponta para o contrário").toBe(r);
    expect(br[0]!.cross_title_id, "a baixa espelho aponta de volta para o principal").toBe(p);
  });

  it("D — ADVANCE_COMPENSATION cai na MESMA fronteira: recusa sem a capacidade contrária, passa com ela", async () => {
    const p = await criar("payable", "CROSS-D-PAG", "400.00");
    const r = await criar("receivable", "CROSS-D-REC", "400.00");
    const antesR = await estado(r);

    const negado = await cruzar("payables", p, r, soPagavel, "100.00", "advance_compensation");
    expect(negado.statusCode, negado.body).toBe(403);
    expect(await estado(r)).toEqual(antesR);

    const ok = await cruzar("payables", p, r, ambos, "100.00", "advance_compensation");
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await estado(r)).balance).toBe("300.00");
  });

  it("E — CANCELAMENTO cruzado sem a capacidade contrária: recusa, e as DUAS baixas seguem confirmadas", async () => {
    const p = await criar("payable", "CROSS-E-PAG", "400.00");
    const r = await criar("receivable", "CROSS-E-REC", "400.00");
    const feito = await cruzar("payables", p, r, ambos, "100.00");
    expect(feito.statusCode, feito.body).toBe(201);
    const sid = j(feito).settlement_id as string;
    const antesP = await estado(p); const antesR = await estado(r);

    // soPagavel TEM payables.cancel_settlement — falta receivables.cancel_settlement, que é a do espelho.
    const res = await h.app.inject({ method: "POST", url: `/api/financial/payables/${p}/settlements/${sid}/cancel`, headers: soPagavel, payload: { reason: "sem a capacidade contrária" } });
    expect(res.statusCode, res.body).toBe(403);

    expect(await estado(p)).toEqual(antesP);
    expect(await estado(r)).toEqual(antesR);
    expect((await baixasDe(p)).every((b) => b.status === "confirmed"), "baixa principal intacta").toBe(true);
    expect((await baixasDe(r)).every((b) => b.status === "confirmed"), "baixa espelho intacta").toBe(true);
  });

  it("F — CANCELAMENTO com as duas capacidades cancela os DOIS lados e devolve os dois saldos", async () => {
    const p = await criar("payable", "CROSS-F-PAG", "400.00");
    const r = await criar("receivable", "CROSS-F-REC", "400.00");
    const feito = await cruzar("payables", p, r, ambos, "100.00");
    const sid = j(feito).settlement_id as string;

    const res = await h.app.inject({ method: "POST", url: `/api/financial/payables/${p}/settlements/${sid}/cancel`, headers: ambos, payload: { reason: "cancelamento legítimo dos dois lados" } });
    expect(res.statusCode, res.body).toBe(200);

    expect((await baixasDe(p)).every((b) => b.status === "cancelled"), "principal cancelada").toBe(true);
    expect((await baixasDe(r)).every((b) => b.status === "cancelled"), "espelho cancelado").toBe(true);
    expect((await estado(p)).balance).toBe("400.00");
    expect((await estado(r)).balance, "o saldo do contrário volta — senão o cancelamento seria pela metade").toBe("400.00");
  });

  it("G — PERÍODO da empresa CONTRÁRIA congelado barra a operação antes de qualquer mutação", async () => {
    // O contrário vive em OUTRA empresa: é o único jeito de provar que o período verificado é o DELE.
    const p = await criar("payable", "CROSS-G-PAG", "400.00", I.empresa);
    const r = await criar("receivable", "CROSS-G-REC", "400.00", I.empresa2);
    const antesP = await estado(p); const antesR = await estado(r);

    const freeze = await congelar(I.empresa2, 2026, 9);
    try {
      const res = await cruzar("payables", p, r, ambos, "100.00", "cross_settlement", "2026-09-20");
      expect(res.statusCode, `esperado bloqueio por período da contraparte: ${res.body}`).toBe(409);
      expect(j(res).error?.code).toBe("PERIOD_FROZEN");
      expect(await estado(p), "nenhuma mutação no principal").toEqual(antesP);
      expect(await estado(r), "nenhuma mutação no contrário").toEqual(antesR);
      expect((await baixasDe(p)).length + (await baixasDe(r)).length).toBe(0);
    } finally { await descongelar(freeze); }

    // Descongelado, a MESMA operação passa — prova que o que barrou foi o período, não outra coisa.
    const ok = await cruzar("payables", p, r, ambos, "100.00", "cross_settlement", "2026-09-20");
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it("H — duas baixas cruzadas no MESMO par: cancelar uma cancela só o espelho dela", async () => {
    const p = await criar("payable", "CROSS-H-PAG", "400.00");
    const r = await criar("receivable", "CROSS-H-REC", "400.00");
    const um = await cruzar("payables", p, r, ambos, "100.00", "cross_settlement", "2026-09-20");
    const dois = await cruzar("payables", p, r, ambos, "100.00", "cross_settlement", "2026-09-21");
    expect(um.statusCode, um.body).toBe(201); expect(dois.statusCode, dois.body).toBe(201);
    // CANCELA A SEGUNDA, NÃO A PRIMEIRA — e isso é o teste, não um detalhe. A consulta ambígua (sem amarrar
    // ao par) devolve a PRIMEIRA linha que casa: cancelando a primeira baixa, ela acerta por sorte de
    // ordenação e o teste passaria com o defeito. A verificação reversa R7 provou exatamente isso na
    // primeira tentativa. Cancelando a SEGUNDA, acertar exige a amarração real.
    const sid2 = j(dois).settlement_id as string;

    const principais = await baixasDe(p); const espelhos = await baixasDe(r);
    expect(principais.length, "duas baixas no principal").toBe(2);
    expect(espelhos.length, "dois espelhos no contrário").toBe(2);

    // A PREMISSA DO PAREAMENTO, PROVADA e não suposta: as duas linhas de UMA operação nascem na mesma
    // transação, então compartilham `created_at` (= now() = início da transação). É essa igualdade que
    // amarra o espelho ao par exato, na ausência de constraint que o faça.
    const principal2 = principais.find((b) => b.id === sid2)!;
    const espelhoDoSegundo = espelhos.filter((e) => e.nascido === principal2.nascido);
    expect(espelhoDoSegundo.length, "exatamente um espelho compartilha o created_at EXATO do principal").toBe(1);
    expect(principais[0]!.nascido, "as duas operações nasceram em transações distintas").not.toBe(principais[1]!.nascido);

    const res = await h.app.inject({ method: "POST", url: `/api/financial/payables/${p}/settlements/${sid2}/cancel`, headers: ambos, payload: { reason: "cancelar apenas a SEGUNDA" } });
    expect(res.statusCode, res.body).toBe(200);

    const depoisEspelhos = await baixasDe(r);
    expect(depoisEspelhos.filter((e) => e.status === "cancelled").length, "SÓ um espelho pode mudar").toBe(1);
    // O QUE discrimina: não basta UM cancelado — tem de ser o espelho DAQUELA baixa.
    expect(depoisEspelhos.find((e) => e.status === "cancelled")!.id, "o espelho cancelado tem de ser o do par da baixa cancelada").toBe(espelhoDoSegundo[0]!.id);
    expect(depoisEspelhos.filter((e) => e.status === "confirmed").length, "o outro espelho continua confirmado").toBe(1);
    expect((await baixasDe(p)).filter((b) => b.status === "confirmed").length, "a outra baixa do principal também segue").toBe(1);
  });

  it("I — AUDITORIA: as duas linhas de baixa têm trilha própria, na criação e no cancelamento", async () => {
    const p = await criar("payable", "CROSS-I-PAG", "400.00");
    const r = await criar("receivable", "CROSS-I-REC", "400.00");
    const feito = await cruzar("payables", p, r, ambos, "100.00");
    const sid = j(feito).settlement_id as string;
    const espelhoId = (await baixasDe(r))[0]!.id;

    expect(await auditoriaDe(sid, "create"), "trilha de criação do lado principal").toBe(1);
    expect(await auditoriaDe(espelhoId, "create"), "trilha de criação do ESPELHO — sem ela o auditor não reconstrói os dois lados").toBe(1);

    const res = await h.app.inject({ method: "POST", url: `/api/financial/payables/${p}/settlements/${sid}/cancel`, headers: ambos, payload: { reason: "auditar os dois lados" } });
    expect(res.statusCode, res.body).toBe(200);
    expect(await auditoriaDe(sid, "cancel")).toBe(1);
    expect(await auditoriaDe(espelhoId, "cancel"), "trilha de cancelamento do ESPELHO").toBe(1);
  });
});
