import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS — AJUSTES 01 · FRENTE D (testes da seção 8): ZN-1..ZN-5 — Zerar numeração (D-3).
 *
 * RV-Z1 (reversa, refeita no R1 — T-3): a versão anterior tirava a RECONTAGEM e esperava o ZN-5 reprovar, mas a
 * PRÉ-CONTAGEM, já sob a trava advisory, via o Novo da API antes (todo Novo passa por aquela trava) — a reversa não
 * provava nada. Agora quem prova é o ZN-7: uma inclusão por SQL DIRETO, que NÃO passa pela trava advisory, fica
 * invisível à pré-contagem (ainda não confirmada) e é confirmada enquanto o Zerar ESPERA a trava da tabela. Tirar a
 * recontagem sob a trava da tabela em `zerarNumeracao` → ZN-7 reprova (o Zerar volta 200 com um registro vivo).
 * ZN-5 passa a AFIRMAR o resultado de cada rodada (efeitos de quem ganhou) e força as duas ordens pela fila da trava.
 * O mesmo ZN-7 prova a ORDEM da A-2 ("liberar os excluídos ANTES do lock table"): parado na fila da trava da tabela, o
 * Zerar já segura a linha do excluído liberado — `for update nowait` de outra conexão → 55P03. Liberação de volta para
 * depois do lock table → a linha está livre e o ZN-7 reprova.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const zerar = (cadastro: string, headers = hdr()) => h.app.inject({ method: "POST", url: `/api/admin/numeracao/${cadastro}/zerar`, headers, payload: {} });
const linha = (cadastro: string) => h.app.inject({ method: "GET", url: `/api/admin/numeracao/${cadastro}`, headers: h.headers() });
const post = (key: string, payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: `/api/resources/${key}`, headers: hdr(), payload });
const mensagens = (r: Resp) => [j(r).error?.message, ...((j(r).error?.details ?? []) as { message: string }[]).map((d) => d.message)].join(" | ");
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows;
const esvaziar = (tabela: string) => admin.query(`update erp.${tabela} set deleted_at = now() where organization_id=$1 and deleted_at is null`, [h.demo.orgId]);
/**
 * "PASSA UM MINUTO" para o limite do Zerar (A-2: 1 por cadastro por organização por minuto, conferido na AUDITORIA):
 * as suítes que zeram o MESMO cadastro várias vezes envelhecem a auditoria do último Zerar em vez de esperar 60 s.
 * Não afrouxa nada — o limite em si é cobrado no ZN-8, com e sem o minuto passado.
 */
const passarUmMinuto = (cadastro: string) => admin.query("update erp.audit_logs set created_at = created_at - interval '61 seconds' where organization_id=$1 and entity='numeracao' and entity_id=$2 and action='zerar' and created_at > now() - interval '61 seconds'", [h.demo.orgId, cadastro]);

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 4 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("ZN-1 Naturezas vazias com \"1\"/\"1.01\" excluídos", () => {
  it("zerar → excluídos viram EXC-<id> (linha e histórico ficam); criar → \"1\"; filho → \"1.01\"; audit", async () => {
    await esvaziar("financial_categories");
    const [um] = await q<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='1'", [h.demo.orgId]);
    const [umUm] = await q<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='1.01'", [h.demo.orgId]);
    expect(um && umUm, "premissa: \"1\" e \"1.01\" excluídos seguram o número").toBeTruthy();
    // sem zerar, a sugestão pula o número segurado (o fato da produção)
    const antes = await post("financial_categories", { name: "ZN1 antes", nature: "income", kind: "synthetic" });
    expect(antes.statusCode, antes.body).toBe(201);
    expect(await q("select code from erp.financial_categories where id=$1", [j(antes).id])).toEqual([{ code: "3" }]);
    await admin.query("update erp.financial_categories set deleted_at=now() where id=$1", [j(antes).id]);
    const l = j(await linha("financial_categories"));
    expect(l).toMatchObject({ registros: 0, podeZerar: true });
    expect(l.excluidos).toBeGreaterThanOrEqual(3);
    const totalAntes = (await q("select id from erp.financial_categories where organization_id=$1", [h.demo.orgId])).length;
    const r = await zerar("financial_categories");
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ proximoCodigo: "1" });
    expect(await q("select code from erp.financial_categories where id=$1", [um!.id])).toEqual([{ code: `EXC-${um!.id}` }]);
    expect(await q("select code from erp.financial_categories where id=$1", [umUm!.id])).toEqual([{ code: `EXC-${umUm!.id}` }]);
    expect((await q("select id from erp.financial_categories where organization_id=$1", [h.demo.orgId])).length, "nenhuma linha apagada").toBe(totalAntes);
    expect(await q("select count(*)::int n from erp.financial_categories where organization_id=$1 and deleted_at is not null and code not like 'EXC-%'", [h.demo.orgId])).toEqual([{ n: 0 }]);
    const [log] = await q<{ metadata: { excluidos_liberados: number; contador_anterior: unknown } }>("select metadata from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id='financial_categories' and action='zerar' order by id desc limit 1", [h.demo.orgId]);
    expect(log?.metadata.excluidos_liberados).toBe(l.excluidos);
    expect(log?.metadata).toHaveProperty("contador_anterior");
    const raiz = await post("financial_categories", { name: "ZN1 raiz", nature: "income", kind: "synthetic" });
    expect(raiz.statusCode, raiz.body).toBe(201);
    expect(await q("select code from erp.financial_categories where id=$1", [j(raiz).id])).toEqual([{ code: "1" }]);
    const filho = await post("financial_categories", { name: "ZN1 filho", nature: "income", kind: "analytic", parent_id: j(raiz).id });
    expect(filho.statusCode, filho.body).toBe(201);
    expect(await q("select code from erp.financial_categories where id=$1", [j(filho).id])).toEqual([{ code: "1.01" }]);
  });
});

describe("ZN-2 Parceiros sem vivos e contador 15", () => {
  it("zerar → próximo 1; o Novo recebe o código 1", async () => {
    await esvaziar("people");
    await admin.query("insert into erp.code_sequences (organization_id, entity, last_value) values ($1,'person',15) on conflict (organization_id, entity) do update set last_value=15", [h.demo.orgId]);
    const r = await zerar("people");
    expect(r.statusCode, r.body).toBe(200);
    expect(Number(j(r).proximoCodigo)).toBe(1);
    expect(await q("select last_value::int v from erp.code_sequences where organization_id=$1 and entity='person'", [h.demo.orgId])).toEqual([{ v: 0 }]);
    const [log] = await q<{ metadata: { contador_anterior: number } }>("select metadata from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id='people' order by id desc limit 1", [h.demo.orgId]);
    expect(log?.metadata.contador_anterior).toBe(15);
    const p = await post("people", { name: "ZN2 primeiro", person_type: "legal", is_client: true });
    expect(p.statusCode, p.body).toBe(201);
    const [g] = await q<{ code: string }>("select code from erp.people where id=$1", [j(p).id]);
    expect(Number(g!.code)).toBe(1);
  });
});

describe("ZN-3 com 1 vivo (mesmo inativo) → 422", () => {
  it("Parceiros com 1 inativo: 422 com o motivo; nada muda (contador, códigos, audit)", async () => {
    const [p] = await q<{ id: string }>("select id from erp.people where organization_id=$1 and deleted_at is null", [h.demo.orgId]);
    await admin.query("update erp.people set is_active=false where id=$1", [p!.id]);
    const cont = await q("select last_value from erp.code_sequences where organization_id=$1 and entity='person'", [h.demo.orgId]);
    const logs = await q("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao'", [h.demo.orgId]);
    const l = j(await linha("people"));
    expect(l).toMatchObject({ registros: 1, podeZerar: false });
    expect(l.motivo).toMatch(/Há 1 registro/);
    const r = await zerar("people");
    expect(r.statusCode, r.body).toBe(422);
    expect(mensagens(r)).toMatch(/Há 1 registro/);
    expect(await q("select last_value from erp.code_sequences where organization_id=$1 and entity='person'", [h.demo.orgId])).toEqual(cont);
    expect(await q("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao'", [h.demo.orgId])).toEqual(logs);
    expect(await q("select count(*)::int n from erp.people where organization_id=$1 and code like 'EXC-%' and deleted_at is null", [h.demo.orgId])).toEqual([{ n: 0 }]);
    // árvore com vivos também
    expect((await zerar("chart_accounts")).statusCode).toBe(422);
  });
  it("documento NUNCA: cadastro fora da lista (títulos, vendas, lançamentos) → 404", async () => {
    for (const c of ["payables", "sales_documents", "invoices", "input_entries", "stock_movements", "apuracoes"]) expect((await zerar(c)).statusCode, c).toBe(404);
  });
});

describe("ZN-4 sem tenant_parameters.edit → 403", () => {
  it("operador: 403 no zerar e na leitura; nada muda", async () => {
    const logs = await q("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao'", [h.demo.orgId]);
    expect((await zerar("financial_categories", { ...h.opHeaders(), "content-type": "application/json" })).statusCode).toBe(403);
    expect((await h.app.inject({ method: "GET", url: "/api/admin/numeracao", headers: h.opHeaders() })).statusCode).toBe(403);
    expect(await q("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao'", [h.demo.orgId])).toEqual(logs);
  });
});

describe("ZN-5 zerar ao mesmo tempo que um Novo", () => {
  const auditsZerar = async (key: string) => (await q<{ n: number }>("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id=$2 and action='zerar'", [h.demo.orgId, key]))[0]!.n;
  /** Excluídos que AINDA seguram código (não liberados): o Zerar que vence os libera; o que perde não toca neles. */
  const seguram = async (tabela: string) => (await q<{ id: string; code: string }>(`select id, code from erp.${tabela} where organization_id=$1 and deleted_at is not null and code is not null and code not like 'EXC-%' order by id`, [h.demo.orgId]));
  /**
   * O RESULTADO de uma corrida, AFIRMADO pelos efeitos (não só registrado): quem venceu deixou exatamente os
   * rastros do seu caminho, e quem perdeu não deixou nenhum.
   */
  const conferirRodada = async (i: number, key: string, tabela: string, z: Resp, n: Resp, primeiro: (c: string) => boolean, antes: { audits: number; seguram: { id: string; code: string }[] }) => {
    expect(n.statusCode, `rodada ${i}: o Novo sempre grava (${n.body})`).toBe(201);
    expect([200, 422], `rodada ${i}: ${z.body}`).toContain(z.statusCode);
    const [g] = await q<{ code: string }>(`select code from erp.${tabela} where id=$1`, [j(n).id]);
    if (z.statusCode === 200) {
      // ZEROU PRIMEIRO: não havia vivo; o Novo esperou e recebeu o PRIMEIRO código; os excluídos foram liberados; audit +1
      expect(primeiro(g!.code), `rodada ${i}: zerou com o Novo ${g!.code} vivo — o Zerar não esperou/recontou`).toBe(true);
      expect(await auditsZerar(key), `rodada ${i}: o Zerar que venceu audita`).toBe(antes.audits + 1);
      expect(await seguram(tabela), `rodada ${i}: o Zerar que venceu liberou todos os excluídos`).toEqual([]);
      return "zerou-antes" as const;
    }
    // O NOVO GRAVOU PRIMEIRO: o Zerar recusa pelo vivo e NÃO deixa rastro — nenhum excluído liberado, nenhum audit
    expect(mensagens(z), `rodada ${i}`).toMatch(/Há 1 registro/);
    expect(await auditsZerar(key), `rodada ${i}: o Zerar recusado não audita`).toBe(antes.audits);
    expect(await seguram(tabela), `rodada ${i}: o Zerar recusado não liberou nenhum excluído`).toEqual(antes.seguram);
    return "novo-antes" as const;
  };
  const rodadas = async (key: string, corpo: (i: number) => Record<string, unknown>, primeiro: (c: string) => boolean, tabela: string) => {
    const resultados: string[] = [];
    for (let i = 0; i < 12; i++) {
      await esvaziar(tabela);
      await passarUmMinuto(key);
      const antes = { audits: await auditsZerar(key), seguram: await seguram(tabela) };
      const [z, n] = await Promise.all([zerar(key), post(key, corpo(i))]);
      resultados.push(await conferirRodada(i, key, tabela, z, n, primeiro, antes));
      // nunca código repetido entre vivos e excluídos não liberados
      const rep = await q(`select code, count(*)::int n from erp.${tabela} where organization_id=$1 and code not like 'EXC-%' group by code having count(*) > 1`, [h.demo.orgId]);
      expect(rep, `rodada ${i}: código repetido`).toEqual([]);
    }
    console.log(`[ZN-5] ${key}: ${resultados.join(",")}`);
    expect(resultados, "toda rodada terminou num dos dois resultados, afirmado pelos efeitos").toHaveLength(12);
    return resultados;
  };
  it("Naturezas (árvore): um espera o outro; se zerou, o Novo é \"1\"; nunca código repetido", async () => {
    await rodadas("financial_categories", (i) => ({ name: `ZN5 nat ${i}`, nature: "income", kind: "synthetic" }), (c) => c === "1", "financial_categories");
  });
  it("Contas bancárias (sequencial): idem; se zerou, o Novo é o número 1", async () => {
    await rodadas("bank_accounts", (i) => ({ description: `ZN5 conta ${i}`, type: "checking" }), (c) => Number(c) === 1, "bank_accounts");
  });
  it("ordem forçada: o Novo grava ANTES → o Zerar seguinte recusa (a recontagem vê o vivo)", async () => {
    await esvaziar("financial_categories");
    const n = await post("financial_categories", { name: "ZN5 antes", nature: "income", kind: "synthetic" });
    expect(n.statusCode).toBe(201);
    const z = await zerar("financial_categories");
    expect(z.statusCode, z.body).toBe(422);
  });

  /**
   * A CORRIDA COM A ORDEM FORÇADA pela fila da trava da numeração: uma sessão externa segura a MESMA trava advisory
   * (tabela + organização), os dois pedidos entram na fila numa ordem conhecida (cada um só é disparado depois de o
   * anterior estar ESPERANDO), e a sessão solta. O Postgres atende a fila na ordem — o resultado da corrida é
   * AFIRMADO nos dois sentidos, em vez de depender da sorte de 12 rodadas.
   */
  const esperandoTrava = async () => (await q<{ n: number }>("select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'"))[0]!.n;
  const naFila = async (quantos: number, porque: string) => {
    for (let t = 0; t < 200 && (await esperandoTrava()) < quantos; t++) await new Promise((r) => setTimeout(r, 25));
    expect(await esperandoTrava(), porque).toBe(quantos);
  };
  const corridaForcada = async (key: string, tabela: string, ordem: "zerar-primeiro" | "novo-primeiro", corpo: Record<string, unknown>) => {
    await esvaziar(tabela);
    await passarUmMinuto(key);
    const antes = { audits: await auditsZerar(key), seguram: await seguram(tabela) };
    const outra = await admin.connect();
    try {
      await outra.query("begin");
      await outra.query("select pg_advisory_xact_lock(hashtext('codigo-cadastro:' || $1 || ':' || $2))", [tabela, h.demo.orgId]);
      const primeiro = ordem === "zerar-primeiro" ? zerar(key) : post(key, corpo);
      await naFila(1, `premissa: o ${ordem === "zerar-primeiro" ? "Zerar" : "Novo"} espera a trava da numeração (tabela + organização) — se não espera, a chave da trava mudou`);
      const segundo = ordem === "zerar-primeiro" ? post(key, corpo) : zerar(key);
      await naFila(2, "premissa: o segundo pedido entrou na fila atrás do primeiro");
      await outra.query("commit");
      const [z, n] = ordem === "zerar-primeiro" ? [await primeiro, await segundo] : [await segundo, await primeiro];
      return { z, n, antes };
    } finally { await outra.query("rollback").catch(() => undefined); outra.release(); }
  };
  it("ordem forçada pela fila: Zerar ANTES do Novo → 200, o Novo recebe o PRIMEIRO código; Novo ANTES do Zerar → 422, nada liberado (Naturezas e Contas bancárias)", async () => {
    for (const [key, corpo, primeiro] of [
      ["financial_categories", { name: "ZN5 fila nat", nature: "income", kind: "synthetic" }, (c: string) => c === "1"],
      ["bank_accounts", { description: "ZN5 fila conta", type: "checking" }, (c: string) => Number(c) === 1]
    ] as const) {
      const a = await corridaForcada(key, key, "zerar-primeiro", corpo);
      expect(a.z.statusCode, `${key}, Zerar na frente: ${a.z.body}`).toBe(200);
      expect(await conferirRodada(0, key, key, a.z, a.n, primeiro, a.antes), `${key}: Zerar na frente`).toBe("zerou-antes");
      const b = await corridaForcada(key, key, "novo-primeiro", corpo);
      expect(b.z.statusCode, `${key}, Novo na frente: ${b.z.body}`).toBe(422);
      expect(await conferirRodada(1, key, key, b.z, b.n, primeiro, b.antes), `${key}: Novo na frente`).toBe("novo-antes");
    }
  }, 60_000);
});

// RV-Z1 (T-3): a recontagem SOB A TRAVA DA TABELA é a que decide. A pré-contagem roda sob a trava advisory, e todo Novo
// da API passa por ela — então só uma inclusão que NÃO passa pela trava advisory (SQL direto: importação antiga, outra
// porta, manutenção) mostra se a recontagem existe. A linha é incluída numa transação aberta ANTES do Zerar (a
// pré-contagem não a vê: não está confirmada) e confirmada enquanto o Zerar ESPERA a trava da tabela (a inclusão
// segura `row exclusive`, que a `share row exclusive` do Zerar não atravessa). Sem a recontagem → 200 com um vivo.
describe("ZN-7 (RV-Z1) inclusão que não passa pela trava advisory: a recontagem sob a trava da tabela recusa", () => {
  it("inclusão por SQL direto, invisível à pré-contagem e confirmada durante a espera da trava da tabela → 422; nada muda (códigos, contador, audit); a liberação dos excluídos já rodou ANTES da trava da tabela (A-2)", async () => {
    await esvaziar("bank_accounts");
    await passarUmMinuto("bank_accounts");
    // um excluído que segura código (a liberação teria o que fazer) e o contador acima de 0 (zerar teria o que zerar)
    const ex = await post("bank_accounts", { description: "ZN7 excluída", type: "checking" });
    expect(ex.statusCode, ex.body).toBe(201);
    await admin.query("update erp.bank_accounts set deleted_at=now() where id=$1", [j(ex).id]);
    const foto = async () => ({
      linhas: await q("select id, code, deleted_at is null as vivo from erp.bank_accounts where organization_id=$1 order by id", [h.demo.orgId]),
      contador: await q("select last_value::text v from erp.code_sequences where organization_id=$1 and entity='bank_account'", [h.demo.orgId]),
      audits: await q("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id='bank_accounts'", [h.demo.orgId])
    });
    const antes = await foto();
    expect(antes.linhas.some((l) => l["vivo"] === false && !String(l["code"]).startsWith("EXC-")), "premissa: um excluído segura código").toBe(true);
    expect(Number(antes.contador[0]?.["v"] ?? 0), "premissa: o contador está acima de 0").toBeGreaterThan(0);
    const aguardandoTabela = async () => (await q<{ n: number }>("select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%lock table%bank_accounts%'"))[0]!.n;
    const outra = await admin.connect();
    let direta = "";
    try {
      await outra.query("begin");
      const codigo = `ZN7-${Date.now().toString(36)}`;
      direta = (await outra.query<{ id: string }>("insert into erp.bank_accounts (organization_id, code, description, type) values ($1, $2, 'ZN7 inclusão direta', 'checking') returning id", [h.demo.orgId, codigo])).rows[0]!.id;
      const z = zerar("bank_accounts");
      // o Zerar passou pela trava advisory, pela pré-contagem (a linha direta ainda não está confirmada: zero vivos) e
      // agora ESPERA a trava da tabela — que a inclusão aberta segura
      for (let t = 0; t < 60 && (await aguardandoTabela()) < 1; t++) await new Promise((r) => setTimeout(r, 20));
      expect(await aguardandoTabela(), "premissa: o Zerar passou da pré-contagem e espera a trava da TABELA").toBe(1);
      // A-2 (a "trava longa"): a LIBERAÇÃO dos excluídos (UPDATE … 'EXC-' || id) roda ANTES da trava da tabela. O Zerar
      // parado na fila da trava da tabela JÁ segura a linha do excluído — o `for update nowait` de uma terceira conexão
      // é recusado (55P03). A `row share` do `for update` não conflita com a `share row exclusive` que espera na fila,
      // então quem recusa é a TRAVA DA LINHA. Com a liberação depois do lock table, a linha estaria livre aqui.
      const terceira = await admin.connect();
      try {
        await terceira.query("begin");
        const recusa = await terceira.query("select 1 from erp.bank_accounts where id=$1 for update nowait", [j(ex).id])
          .then(() => "linha livre: a liberação ainda não rodou", (e: { code?: string }) => e.code ?? "erro sem código");
        expect(recusa, "a liberação do excluído veio ANTES da trava da tabela (a linha já está presa pelo Zerar)").toBe("55P03");
      } finally { await terceira.query("rollback").catch(() => undefined); terceira.release(); }
      await outra.query("commit");
      const r = await z;
      expect(r.statusCode, `a recontagem sob a trava da tabela vê o vivo que chegou por fora: ${r.body}`).toBe(422);
      expect(mensagens(r)).toMatch(/Há 1 registro/);
    } finally { await outra.query("rollback").catch(() => undefined); outra.release(); }
    // nada mudou: os códigos (o excluído continua segurando o dele), o contador e o audit; a linha direta ficou viva
    const depois = await foto();
    expect(depois.linhas.filter((l) => l["id"] !== direta), "nenhum código liberado").toEqual(antes.linhas);
    expect(depois.linhas.find((l) => l["id"] === direta)?.["vivo"], "a linha incluída por fora continua viva").toBe(true);
    expect(depois.contador, "o contador não foi zerado").toEqual(antes.contador);
    expect(depois.audits, "nenhum audit de zerar").toEqual(antes.audits);
    await admin.query("update erp.bank_accounts set deleted_at=now() where id=$1", [direta]);
  }, 30_000);
});

// AJUSTES 01 R1 (A-2): o UPDATE para EXC-<id> auditava só a contagem, e 8 das 11 tabelas não têm gatilho de auditoria —
// o código antigo se perdia. A auditoria do Zerar leva os pares { id, codigo_antigo } de CADA linha liberada.
describe("ZN-9 (A-2) a auditoria do Zerar leva os pares { id, codigo_antigo } de cada excluído liberado", () => {
  it("Setores (sequencial, sem gatilho de auditoria): cada liberado com o código de antes; excluídos_liberados = quantidade de pares", async () => {
    await esvaziar("feedlot_sectors");
    await passarUmMinuto("feedlot_sectors");
    const antes = await q<{ id: string; code: string }>("select id::text, code from erp.feedlot_sectors where organization_id=$1 and deleted_at is not null and code is not null and code not like 'EXC-%' order by code, id", [h.demo.orgId]);
    expect(antes.length, "premissa: há excluídos segurando código").toBeGreaterThan(0);
    const r = await zerar("feedlot_sectors");
    expect(r.statusCode, r.body).toBe(200);
    const [log] = await q<{ metadata: { excluidos_liberados: number; liberados: { id: string; codigo_antigo: string }[] } }>("select metadata from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id='feedlot_sectors' and action='zerar' order by id desc limit 1", [h.demo.orgId]);
    const pares = [...(log?.metadata.liberados ?? [])].sort((a, b) => a.codigo_antigo.localeCompare(b.codigo_antigo) || a.id.localeCompare(b.id));
    expect(pares, "um par por linha liberada, com o código de ANTES").toEqual(antes.map((x) => ({ id: x.id, codigo_antigo: x.code })));
    expect(log?.metadata.excluidos_liberados).toBe(antes.length);
    for (const x of antes) expect(await q("select code from erp.feedlot_sectors where id=$1", [x.id]), "e a linha ficou como EXC-<id>").toEqual([{ code: `EXC-${x.id}` }]);
  });
});

// AJUSTES 01 R1 (A-2): 1 Zerar por cadastro por organização por minuto (429), conferido na AUDITORIA sob a trava — vale
// entre instâncias e só conta o Zerar que GRAVOU. Com registro vivo a resposta continua o 422 com o motivo.
describe("ZN-8 (A-2) limite de 1 Zerar por cadastro por organização por minuto", () => {
  it("dois Zerar seguidos: o 2º → 429 legível e sem efeito; outro cadastro não é afetado; com vivo continua 422; passado o minuto → 200", async () => {
    await esvaziar("feedlot_yards");
    await passarUmMinuto("feedlot_yards");
    const primeiro = await zerar("feedlot_yards");
    expect(primeiro.statusCode, primeiro.body).toBe(200);
    const audits = async () => (await q<{ n: number }>("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id='feedlot_yards' and action='zerar'", [h.demo.orgId]))[0]!.n;
    const n = await audits();
    // um excluído novo segurando código: o 2º Zerar teria o que liberar — e não libera
    const p = await post("feedlot_yards", { empresa_id: h.demo.empresaIds[0]!, name: "ZN8 pátio" });
    expect(p.statusCode, p.body).toBe(201);
    await admin.query("update erp.feedlot_yards set deleted_at=now() where id=$1", [j(p).id]);
    const [{ code: codigo }] = await q<{ code: string }>("select code from erp.feedlot_yards where id=$1", [j(p).id]) as [{ code: string }];
    const segundo = await zerar("feedlot_yards");
    expect(segundo.statusCode, segundo.body).toBe(429);
    expect(j(segundo).error).toEqual({ code: "RATE_LIMITED", message: "A numeração de Pátios foi zerada há menos de 1 minuto; aguarde para zerar de novo." });
    expect(await audits(), "o 429 não audita").toBe(n);
    expect(await q("select code from erp.feedlot_yards where id=$1", [j(p).id]), "o 429 não liberou nada").toEqual([{ code: codigo }]);
    // o limite é POR CADASTRO: Currais, no mesmo minuto, zera
    await esvaziar("feedlot_corrals");
    await passarUmMinuto("feedlot_corrals");
    expect((await zerar("feedlot_corrals")).statusCode, "outro cadastro não é afetado").toBe(200);
    // com registro vivo a resposta é o 422 com o motivo, mesmo dentro do minuto
    const vivo = await post("feedlot_yards", { empresa_id: h.demo.empresaIds[0]!, name: "ZN8 vivo" });
    expect(vivo.statusCode, vivo.body).toBe(201);
    const comVivo = await zerar("feedlot_yards");
    expect(comVivo.statusCode, comVivo.body).toBe(422);
    expect(mensagens(comVivo)).toMatch(/Há 1 registro/);
    await admin.query("update erp.feedlot_yards set deleted_at=now() where id=$1", [j(vivo).id]);
    // passado o minuto, zera
    await passarUmMinuto("feedlot_yards");
    const depois = await zerar("feedlot_yards");
    expect(depois.statusCode, depois.body).toBe(200);
    expect(await q("select code from erp.feedlot_yards where id=$1", [j(p).id])).toEqual([{ code: `EXC-${j(p).id}` }]);
  });
  it("o Zerar DESFEITO (422 na recontagem) não conta para o limite: o seguinte, no mesmo minuto, zera", async () => {
    // ZN-7 acabou de ter o Zerar de Contas bancárias desfeito pela recontagem: nenhum audit, nenhum limite
    await esvaziar("bank_accounts");
    const recentes = (await q<{ n: number }>("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id='bank_accounts' and action='zerar' and created_at > now() - interval '1 minute'", [h.demo.orgId]))[0]!.n;
    expect(recentes, "o Zerar do ZN-7, desfeito pela recontagem, não deixou auditoria (e não conta para o limite)").toBe(0);
    const r = await zerar("bank_accounts");
    expect(r.statusCode, r.body).toBe(200);
  });
});

// revisão adversarial: a trava da TABELA vale para todas as organizações, e o pedido na fila já faz as gravações
// novas esperarem. Com registro vivo o Zerar recusa ANTES de pedir a trava; vazio, espera no máximo 2 s e desiste.
describe("ZN-6 a trava da tabela não congela as outras organizações", () => {
  it("cadastro em uso por outra transação (ex.: importação longa de outra organização): com vivos → 422 sem esperar; vazio → 409 em ~2 s, nada muda; livre → 200", async () => {
    const outra = await admin.connect();
    const exc = async () => (await q<{ n: number }>("select count(*)::int n from erp.cost_centers where organization_id=$1 and code like 'EXC-%'", [h.demo.orgId]))[0]!.n;
    const zerados = async () => (await q<{ n: number }>("select count(*)::int n from erp.audit_logs where organization_id=$1 and entity='numeracao' and entity_id='cost_centers' and action='zerar'", [h.demo.orgId]))[0]!.n;
    try {
      await outra.query("begin");
      await outra.query("lock table erp.cost_centers in row exclusive mode"); // o que uma gravação em curso segura
      const t0 = Date.now();
      const comVivos = await zerar("cost_centers");
      expect(comVivos.statusCode, comVivos.body).toBe(422);
      expect(Date.now() - t0, "recusa sem entrar na fila da trava").toBeLessThan(1500);
      await esvaziar("cost_centers");
      const [excAntes, zeradosAntes] = [await exc(), await zerados()];
      const t1 = Date.now();
      const emUso = await zerar("cost_centers");
      const espera = Date.now() - t1;
      expect(emUso.statusCode, emUso.body).toBe(409);
      expect(mensagens(emUso)).toMatch(/em uso agora/);
      expect(espera, "esperou a trava").toBeGreaterThanOrEqual(1800);
      expect(espera, "e desistiu, em vez de ficar na fila").toBeLessThan(6000);
      expect([await exc(), await zerados()], "nada mudou").toEqual([excAntes, zeradosAntes]);
    } finally { await outra.query("rollback"); outra.release(); }
    const livre = await zerar("cost_centers");
    expect(livre.statusCode, livre.body).toBe(200);
  }, 30_000);
});
