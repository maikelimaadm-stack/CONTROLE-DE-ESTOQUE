import { describe, it, expect, beforeAll } from "vitest";
import { createPool } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CONTADOR DE NÃO LIDAS: UMA autoridade, duas portas (PRE-BASE2-02 §12-§16).
 *
 * O badge é server-authoritative e NUNCA derivado da lista: a caixa devolve no máximo 50, e quem tem 55
 * não lidas precisa ver 55. Mas o contador do `/auth/context` não é atualizado na mesma frequência da
 * caixa (a caixa é pollada; o contexto, não), então o badge ficava congelado em 2 enquanto a caixa já
 * mostrava 3. GET /admin/notifications passa a carregar o número junto com os itens — e os dois números,
 * o do contexto e o da caixa, saem da MESMA função (`contarNaoLidas`), para não existir a segunda verdade
 * que diverge na primeira edição.
 *
 * Este arquivo tem harness próprio (cada arquivo de integração reinicia o schema), então o volume semeado
 * aqui não contamina as contagens dos outros.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; unread?: number; id?: string };

let SO_B: Hdr; let TODAS: Hdr;
let A = ""; let B = ""; let idB1 = "";
const MODULOS = ["compras", "pecuaria", "estoque", "financeiro", "documentos"];
const PERMS = ["purchase_requests.view", "processings.view", "stocks.view", "payables.view", "documents.view"];

const criarUsuario = async (nome: string, email: string, escopos: Record<string, unknown>[]) => {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: nome, permissions: PERMS } });
  expect(papel.statusCode, papel.body).toBe(201);
  const membro = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: {
    name: nome, email, password: "Notif@12345", role_id: j(papel).id, escopos_empresas: escopos } });
  expect(membro.statusCode, membro.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Notif@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId } as Hdr;
};

/** Semeia notificação de empresa já classificada (o alvo aqui é a LEITURA e a CONTAGEM). */
const semear = async (empresa: string, titulo: string) => {
  const raiz = createPool(TEST_URL, { max: 1 });
  try {
    const r = await raiz.query<{ id: string }>(
      `insert into erp.notifications (organization_id, kind, title, escopo_tipo, modulo, empresa_id, permission_key, dedupe_key)
       values ($1,'purchase_pending',$2,'empresa','compras',$3,'purchase_requests.view',$2) returning id`,
      [h.demo.orgId, titulo, empresa]);
    return r.rows[0]!.id;
  } finally { await raiz.end(); }
};

/** As DUAS autoridades do mesmo número. */
const daCaixa = async (hdr: Hdr) => {
  const r = await h.app.inject({ method: "GET", url: "/api/admin/notifications", headers: hdr });
  expect(r.statusCode, r.body).toBe(200);
  return { itens: j(r).items ?? [], unread: j(r).unread as number, texto: r.body };
};
const doContexto = async (hdr: Hdr) => {
  const r = await h.app.inject({ method: "GET", url: "/api/auth/context", headers: hdr });
  expect(r.statusCode, r.body).toBe(200);
  return Number((j(r) as { unreadNotifications: number }).unreadNotifications);
};

beforeAll(async () => {
  h = await harness(); I = await ids(h); A = I.farm; B = I.farm2;
  SO_B = await criarUsuario("Contador só B", "contador-b@demo.local", MODULOS.map((m) => ({ modulo: m, modo: "selecionadas", empresas: [B] })));
  TODAS = await criarUsuario("Contador todas", "contador-todas@demo.local", MODULOS.map((m) => ({ modulo: m, modo: "todas" })));
  idB1 = await semear(B, "CONTADOR-B-1");
  await semear(B, "CONTADOR-B-2");
  for (const n of [1, 2, 3]) await semear(A, `CONTADOR-A-${n}`);
}, 180_000);

describe("o contador conta o que a caixa mostraria, e nada além", () => {
  it("só as visíveis entram: 2 da Empresa B, nenhuma das 3 da Empresa A", async () => {
    const { itens, unread, texto } = await daCaixa(SO_B);
    expect(itens.length).toBe(2);
    expect(unread).toBe(2);
    for (const n of [1, 2, 3]) expect(texto.includes(`CONTADOR-A-${n}`), `A-${n} não pode aparecer`).toBe(false);
  });

  it("caixa e contexto devolvem EXATAMENTE o mesmo número", async () => {
    // A invariante que importa é entre as duas autoridades de SERVIDOR — comparar com
    // `itens.filter(...)` canonizaria no CI a derivação da lista truncada, que é o anti-padrão proibido.
    expect((await daCaixa(SO_B)).unread).toBe(await doContexto(SO_B));
    expect((await daCaixa(TODAS)).unread).toBe(await doContexto(TODAS));
  });

  it("quem enxerga as duas empresas conta as cinco", async () => {
    expect((await daCaixa(TODAS)).unread).toBe(5);
  });
});

describe("marcar como lida move os dois contadores juntos", () => {
  it("marcar UMA baixa de 2 para 1, nas duas portas, e não mexe em outro usuário", async () => {
    const antesTodas = await doContexto(TODAS);
    const r = await h.app.inject({ method: "POST", url: `/api/admin/notifications/${idB1}/read`, headers: SO_B });
    expect(r.statusCode, r.body).toBe(200);
    expect((await daCaixa(SO_B)).unread).toBe(1);
    expect(await doContexto(SO_B)).toBe(1);
    expect(await doContexto(TODAS), "leitura é por usuário").toBe(antesTodas);
  });

  it("marcar TODAS zera o usuário e não cria recibo do que ele não vê", async () => {
    const antesTodas = await doContexto(TODAS);
    expect((await h.app.inject({ method: "POST", url: "/api/admin/notifications/read-all", headers: SO_B })).statusCode).toBe(200);
    expect((await daCaixa(SO_B)).unread).toBe(0);
    expect(await doContexto(SO_B)).toBe(0);
    expect(await doContexto(TODAS), "o outro usuário continua com os dele").toBe(antesTodas);

    const raiz = createPool(TEST_URL, { max: 1 });
    try {
      const recibosEmA = await raiz.query<{ n: string }>(
        `select count(*) n from erp.notificacao_leituras l
           join erp.notifications n on n.id = l.notificacao_id
          where n.organization_id=$1 and n.empresa_id=$2`, [h.demo.orgId, A]);
      expect(Number(recibosEmA.rows[0]!.n), "nenhum recibo nas notificações da empresa proibida").toBe(0);
    } finally { await raiz.end(); }
  });
});

describe("o contador não é limitado pela janela da caixa", () => {
  it("com 55 não lidas visíveis, a caixa devolve 50 e o contador devolve 55", async () => {
    // É esta a prova de que o badge não pode ser derivado de `items.length`: ele subcontaria em 5.
    for (let n = 1; n <= 55; n += 1) await semear(B, `VOLUME-B-${String(n).padStart(2, "0")}`);
    const { itens, unread } = await daCaixa(SO_B);
    expect(itens.length, "a caixa continua com a janela de 50").toBe(50);
    expect(unread, "o contador conta sem a janela").toBe(55);
    expect(await doContexto(SO_B), "as duas autoridades seguem iguais em volume").toBe(55);
  }, 120_000);

  it("acima do teto de custo o contador avisa que truncou, em vez de mentir", async () => {
    // O teto NÃO é a janela da caixa: é limite de CUSTO (a contagem exata avalia erp.tem_acesso_empresa
    // linha a linha — ~7,6 s em 200 mil avisos contra ~130 ms com teto, e isto roda a cada 60 s por aba).
    // Acima dele o badge diz "500+", que é honesto; o proibido é dizer 50 porque a caixa mostra 50.
    const raiz = createPool(TEST_URL, { max: 1 });
    try {
      await raiz.query(
        `insert into erp.notifications (organization_id, kind, title, escopo_tipo, modulo, empresa_id, permission_key, dedupe_key)
         select $1,'purchase_pending','TETO-'||g,'empresa','compras',$2,'purchase_requests.view','TETO-'||g
           from generate_series(1, 600) g`, [h.demo.orgId, B]);
    } finally { await raiz.end(); }
    const r = await h.app.inject({ method: "GET", url: "/api/admin/notifications", headers: SO_B });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).unread, "para no teto").toBe(500);
    expect((j(r) as { unreadTruncado: boolean }).unreadTruncado, "e diz que parou").toBe(true);
    expect((j(r).items ?? []).length, "a caixa continua com a janela de 50").toBe(50);
  }, 120_000);
});
