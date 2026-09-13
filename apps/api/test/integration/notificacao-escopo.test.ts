import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * MATRIZ A/B DAS NOTIFICAÇÕES (PRE-BASE2-02 §31-§41).
 *
 * A caixa de notificações é uma porta dinâmica: a autorização de CADA LINHA vem da fonte funcional dela,
 * não da caixa. Antes, a listagem filtrava por organização e destinatário — e só. Um usuário autorizado
 * apenas na Empresa B recebia o código da solicitação de compra da Empresa A, o título do documento da A e
 * a contagem financeira somando as duas. O link dar 404 depois não desfaz nada: o TÍTULO já informou.
 *
 * Estes testes montam exatamente esse cenário e exigem que o conteúdo da empresa proibida NUNCA apareça —
 * nem na lista, nem no contador, nem como alvo de "marcar como lida".
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; error?: { code: string }; id?: string };

let SO_B: Hdr;        // enxerga apenas a Empresa B, em todos os módulos relevantes
let TODAS: Hdr;       // enxerga TODAS as empresas nos mesmos módulos
let SEM_CAP: Hdr;     // enxerga tudo, mas sem a capacidade de documentos
let A = ""; let B = "";
let idA = ""; let idB = ""; let idOrg = "";

const PERMS = ["purchase_requests.view", "processings.view", "batches.view", "stocks.view", "payables.view", "documents.view", "employees.view"];

const criarUsuario = async (nome: string, email: string, perms: string[], escopos: Record<string, unknown>[]) => {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: nome, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const membro = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: {
    name: nome, email, password: "Notif@12345", role_id: j(papel).id, escopos_empresas: escopos } });
  expect(membro.statusCode, membro.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Notif@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId } as Hdr;
};

/** Insere a notificação já classificada direto no banco: o teste é de LEITURA, não do gerador. */
const semear = async (raiz: ReturnType<typeof createPool>, n: Record<string, unknown>) => {
  const r = await raiz.query<{ id: string }>(
    `insert into erp.notifications (organization_id, user_id, kind, title, route, escopo_tipo, modulo, empresa_id, permission_key, dedupe_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [h.demo.orgId, n.user_id ?? null, n.kind, n.title, n.route ?? null, n.escopo_tipo, n.modulo ?? null, n.empresa_id ?? null, n.permission_key ?? null, n.title]);
  return r.rows[0]!.id;
};

beforeAll(async () => {
  h = await harness(); I = await ids(h); A = I.farm; B = I.farm2;
  const escoposB = ["compras", "pecuaria", "estoque", "financeiro", "documentos"].map((m) => ({ modulo: m, modo: "selecionadas", empresas: [B] }));
  const escoposTodas = ["compras", "pecuaria", "estoque", "financeiro", "documentos"].map((m) => ({ modulo: m, modo: "todas" }));
  SO_B = await criarUsuario("Notif só B", "notif-b@demo.local", PERMS, escoposB);
  TODAS = await criarUsuario("Notif todas", "notif-todas@demo.local", PERMS, escoposTodas);
  SEM_CAP = await criarUsuario("Notif sem documentos", "notif-semdoc@demo.local", PERMS.filter((p) => p !== "documents.view"), escoposTodas);

  const raiz = createPool(TEST_URL, { max: 1 });
  idA = await semear(raiz, { kind: "purchase_pending", title: "SENTINELA-COMPRA-A", route: "/suprimentos/view/a", escopo_tipo: "empresa", modulo: "compras", empresa_id: A, permission_key: "purchase_requests.view" });
  idB = await semear(raiz, { kind: "purchase_pending", title: "SENTINELA-COMPRA-B", route: "/suprimentos/view/b", escopo_tipo: "empresa", modulo: "compras", empresa_id: B, permission_key: "purchase_requests.view" });
  await semear(raiz, { kind: "processing_pending", title: "SENTINELA-PROC-A", escopo_tipo: "empresa", modulo: "pecuaria", empresa_id: A, permission_key: "processings.view" });
  await semear(raiz, { kind: "processing_pending", title: "SENTINELA-PROC-B", escopo_tipo: "empresa", modulo: "pecuaria", empresa_id: B, permission_key: "processings.view" });
  await semear(raiz, { kind: "document_expiring", title: "SENTINELA-DOC-A", escopo_tipo: "empresa", modulo: "documentos", empresa_id: A, permission_key: "documents.view" });
  await semear(raiz, { kind: "document_expiring", title: "SENTINELA-DOC-B", escopo_tipo: "empresa", modulo: "documentos", empresa_id: B, permission_key: "documents.view" });
  idOrg = await semear(raiz, { kind: "document_expiring", title: "SENTINELA-DOC-ORGANIZACAO", escopo_tipo: "organizacao", permission_key: "documents.view" });
  await semear(raiz, { kind: "title_due", title: "SENTINELA-AGREGADO-FINANCEIRO", escopo_tipo: "modulo_todas", modulo: "financeiro", permission_key: "payables.view" });
  await semear(raiz, { kind: "birthday", title: "SENTINELA-ANIVERSARIO", escopo_tipo: "organizacao", permission_key: "employees.view" });
  await raiz.end();
}, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

const caixa = async (hdr: Hdr) => {
  const r = await h.app.inject({ method: "GET", url: "/api/admin/notifications", headers: hdr });
  expect(r.statusCode, r.body).toBe(200);
  return { texto: r.body, itens: j(r).items ?? [] };
};
const naoLidas = async (hdr: Hdr) => {
  const r = await h.app.inject({ method: "GET", url: "/api/auth/context", headers: hdr });
  expect(r.statusCode, r.body).toBe(200);
  return Number((j(r) as { unreadNotifications: number }).unreadNotifications);
};

describe("notificação de empresa: o título é informação, e não chega a quem não enxerga a empresa", () => {
  it("usuário autorizado só na Empresa B não recebe NENHUMA notificação da Empresa A", async () => {
    const { texto } = await caixa(SO_B);
    for (const sentinela of ["SENTINELA-COMPRA-A", "SENTINELA-PROC-A", "SENTINELA-DOC-A"]) {
      expect(texto.includes(sentinela), `a caixa vazou ${sentinela}`).toBe(false);
    }
  });
  it("e continua recebendo as da Empresa B", async () => {
    const { texto } = await caixa(SO_B);
    for (const sentinela of ["SENTINELA-COMPRA-B", "SENTINELA-PROC-B", "SENTINELA-DOC-B"]) {
      expect(texto.includes(sentinela), `a caixa perdeu ${sentinela}`).toBe(true);
    }
  });
  it("o proprietário, que enxerga tudo, vê as duas empresas", async () => {
    const { texto } = await caixa(h.headers());
    expect(texto).toContain("SENTINELA-COMPRA-A");
    expect(texto).toContain("SENTINELA-COMPRA-B");
  });
});

describe("agregado do módulo: selecionadas NÃO equivale a todas", () => {
  it("quem tem Financeiro em selecionadas [B] não consolida o agregado da organização", async () => {
    const { texto } = await caixa(SO_B);
    expect(texto.includes("SENTINELA-AGREGADO-FINANCEIRO"), "agregado global entregue a quem enxerga uma empresa").toBe(false);
  });
  it("quem tem Financeiro em todas consolida", async () => {
    const { texto } = await caixa(TODAS);
    expect(texto).toContain("SENTINELA-AGREGADO-FINANCEIRO");
  });
  it("o proprietário também consolida", async () => {
    expect((await caixa(h.headers())).texto).toContain("SENTINELA-AGREGADO-FINANCEIRO");
  });
});

describe("notificação da organização: capacidade decide, empresa não interfere", () => {
  it("documento SEM empresa chega a quem tem a capacidade, mesmo enxergando só uma empresa", async () => {
    expect((await caixa(SO_B)).texto).toContain("SENTINELA-DOC-ORGANIZACAO");
  });
  it("quem NÃO tem a capacidade de documentos não recebe, mesmo enxergando todas as empresas", async () => {
    const { texto } = await caixa(SEM_CAP);
    expect(texto.includes("SENTINELA-DOC-ORGANIZACAO"), "capacidade ignorada").toBe(false);
    expect(texto.includes("SENTINELA-DOC-B"), "capacidade ignorada na notificação de empresa").toBe(false);
    expect(texto, "as outras capacidades continuam valendo").toContain("SENTINELA-COMPRA-B");
  });
});

describe("contador de não lidas usa a MESMA autoridade da caixa", () => {
  it("as duas portas do servidor devolvem o mesmo número", async () => {
    // A invariante é entre as DUAS AUTORIDADES DE SERVIDOR. Comparar com `itens.filter(...)` — como este
    // teste fazia — canonizava no CI justamente a derivação da lista truncada que o contrato proíbe no
    // cliente: passava só porque o cenário tem menos de 50 avisos, e quebraria por VOLUME, não por defeito.
    const r = await h.app.inject({ method: "GET", url: "/api/admin/notifications", headers: SO_B });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).unread as number).toBe(await naoLidas(SO_B));
  });

  it("o contador não conta nada da empresa proibida", async () => {
    // a prova de "não conta o que não pode ver" é feita pelo CONTEÚDO (sentinelas), não por aritmética
    // sobre a janela: as da Empresa A não aparecem na caixa e não entram no número.
    const { texto } = await caixa(SO_B);
    for (const sentinela of ["SENTINELA-COMPRA-A", "SENTINELA-PROC-A", "SENTINELA-DOC-A"]) {
      expect(texto.includes(sentinela), sentinela).toBe(false);
    }
    // e quem enxerga as duas empresas conta ESTRITAMENTE mais do que quem enxerga só a B
    expect(await naoLidas(TODAS)).toBeGreaterThan(await naoLidas(SO_B));
  });
});

describe("leitura é do usuário: marcar como lida não apaga o não lido de ninguém", () => {
  it("usuário só B não consegue marcar como lida uma notificação da empresa A (404, anti-enumeração)", async () => {
    const r = await h.app.inject({ method: "POST", url: `/api/admin/notifications/${idA}/read`, headers: SO_B });
    expect(r.statusCode).toBe(404);
  });
  it("marcar uma notificação compartilhada como lida afeta só quem marcou", async () => {
    const antesB = await naoLidas(SO_B);
    const antesTodas = await naoLidas(TODAS);
    const r = await h.app.inject({ method: "POST", url: `/api/admin/notifications/${idOrg}/read`, headers: SO_B });
    expect(r.statusCode, r.body).toBe(200);
    expect(await naoLidas(SO_B), "quem marcou deveria ter uma a menos").toBe(antesB - 1);
    expect(await naoLidas(TODAS), "a leitura de um usuário não pode zerar a do outro").toBe(antesTodas);
  });
  it("read-all marca só as visíveis e não cria recibo nas proibidas", async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/admin/notifications/read-all", headers: SO_B });
    expect(r.statusCode, r.body).toBe(200);
    expect(await naoLidas(SO_B)).toBe(0);
    const raiz = createPool(TEST_URL, { max: 1 });
    const recibo = await raiz.query("select 1 from erp.notificacao_leituras where notificacao_id=$1", [idA]);
    await raiz.end();
    expect(recibo.rowCount, "read-all criou recibo numa notificação invisível").toBe(0);
    expect(await naoLidas(TODAS), "read-all de um usuário não pode marcar para o outro").toBeGreaterThan(0);
  });
});

describe("as portas em volta da caixa", () => {
  it("gerar notificações exige capacidade — não é porta aberta a qualquer membro", async () => {
    // A geração varre a organização INTEIRA e materializa linhas de todas as empresas. Aberta, ela também
    // era um oráculo de volume: o tempo de resposta cresce com as pendências de empresas que o autor não vê.
    const r = await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: SO_B });
    expect(r.statusCode, r.body).toBe(403);
    expect(j(r).error?.code).toBe("PERMISSION_DENIED");
  });

  it("X-Farm-Id de empresa que o usuário não enxerga responde igual a identificador inexistente", async () => {
    // O cabeçalho é SELEÇÃO de trabalho. Validado apenas contra "existe na organização", ele distinguia
    // empresa viva (200) de identificador qualquer (403) — e virava um jeito de confirmar a existência de
    // empresas alheias sem ler nada delas. As duas respostas precisam ser a mesma.
    const url = "/api/admin/notifications";
    const naoExiste = await h.app.inject({ method: "GET", url, headers: { ...SO_B, "x-farm-id": "99999999-9999-4999-8999-999999999999" } });
    const existeAlheia = await h.app.inject({ method: "GET", url, headers: { ...SO_B, "x-farm-id": A } });
    expect(existeAlheia.statusCode, "empresa viva que ele não enxerga").toBe(naoExiste.statusCode);
    expect(j(existeAlheia).error?.code).toBe(j(naoExiste).error?.code);
    // e a empresa que ele ENXERGA continua selecionável
    const propria = await h.app.inject({ method: "GET", url, headers: { ...SO_B, "x-farm-id": B } });
    expect(propria.statusCode, propria.body).toBe(200);
  });

  it("o recibo de leitura é do usuário da sessão — o banco não aceita gravá-lo em nome de outro", async () => {
    // Isolar só por organização deixaria "de quem é esta leitura" por conta da aplicação: um recibo em nome
    // de outro apaga o "não lida" dele para sempre, sem erro e sem rastro.
    const raiz = createPool(TEST_URL, { max: 1 });
    // uma VÍTIMA real: usuário existente da organização. Com um identificador inventado o insert morreria
    // na chave estrangeira de usuários e o teste passaria sem nunca encostar na política.
    const vitima = (await raiz.query<{ id: string }>("select id from erp.users where email=$1", ["notif-todas@demo.local"])).rows[0]!.id;
    const cliente = await raiz.connect();
    let erro = ""; let proprio = "";
    try {
      // mesma montagem de uma transação da API: contexto de tenant + papel da aplicação
      await cliente.query("begin");
      await cliente.query("select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true)", [h.demo.orgId, h.demo.adminUserId]);
      await cliente.query("set local role erp_app");
      try {
        await cliente.query("insert into erp.notificacao_leituras (organization_id, notificacao_id, usuario_id) values ($1,$2,$3)", [h.demo.orgId, idB, vitima]);
      } catch (e) { erro = (e as Error).message; }
      await cliente.query("rollback");
      // e o recibo do PRÓPRIO usuário continua possível — a política recorta, não fecha a porta
      await cliente.query("begin");
      await cliente.query("select set_config('app.org_id',$1,true), set_config('app.user_id',$2,true)", [h.demo.orgId, h.demo.adminUserId]);
      await cliente.query("set local role erp_app");
      try {
        await cliente.query("insert into erp.notificacao_leituras (organization_id, notificacao_id, usuario_id) values ($1,$2,$3) on conflict do nothing", [h.demo.orgId, idB, h.demo.adminUserId]);
      } catch (e) { proprio = (e as Error).message; }
      await cliente.query("rollback");
    } finally { cliente.release(); await raiz.end(); }
    expect(erro, "gravar recibo em nome de outro usuário precisa ser recusado").toMatch(/policy|row-level/i);
    expect(proprio, "o próprio recibo continua permitido").toBe("");
  });
});

describe("o banco recusa estado de escopo inválido", () => {
  it("notificação de empresa de OUTRA organização é rejeitada pela FK composta", async () => {
    const raiz = createPool(TEST_URL, { max: 1 });
    const outra = await raiz.query<{ id: string }>("insert into erp.organizations(name) values ('Outra org notif') returning id");
    let erro = "";
    try {
      await raiz.query(
        `insert into erp.notifications (organization_id, kind, title, escopo_tipo, modulo, empresa_id, permission_key)
         values ($1,'purchase_pending','cross-tenant','empresa','compras',$2,'purchase_requests.view')`,
        [outra.rows[0]!.id, B]);
    } catch (e) { erro = (e as Error).message; }
    await raiz.end();
    expect(erro, "empresa de outra organização deveria violar a FK composta").toMatch(/foreign key|notifications_empresa_fk/i);
  });
  it("combinações incoerentes de escopo são impossíveis", async () => {
    const raiz = createPool(TEST_URL, { max: 1 });
    const tentar = async (sql: string, params: unknown[]) => {
      try { await raiz.query(sql, params); return ""; } catch (e) { return (e as Error).message; }
    };
    const base = "insert into erp.notifications (organization_id, kind, title, permission_key, escopo_tipo, modulo, empresa_id) values ($1,'purchase_pending','x','purchase_requests.view',";
    expect(await tentar(`${base}'organizacao','compras',null)`, [h.demo.orgId]), "organização com módulo").toMatch(/check|coerente/i);
    expect(await tentar(`${base}'empresa','compras',null)`, [h.demo.orgId]), "empresa sem empresa").toMatch(/check|coerente/i);
    expect(await tentar(`${base}'modulo_todas','compras',$2)`, [h.demo.orgId, B]), "agregado com empresa").toMatch(/check|coerente/i);
    expect(await tentar(`${base}'empresa','nao_existe',$2)`, [h.demo.orgId, B]), "módulo fora do catálogo").toMatch(/foreign key|modulo/i);
    await raiz.end();
  });

  /**
   * A coerência da tripla (escopo, módulo, empresa) é satisfeita por `organizacao/null/null` para QUALQUER
   * tipo — inclusive um aviso de compra, cujo título carrega o código da solicitação de uma empresa. Sem o
   * catálogo, o estado que esta rodada existe para fechar continuaria representável, e a única barreira
   * seria a aplicação nunca errar.
   */
  it("o tipo do aviso decide quais escopos ele pode assumir — não quem insere", async () => {
    const raiz = createPool(TEST_URL, { max: 1 });
    const tentar = async (sql: string, params: unknown[]) => {
      try { await raiz.query(sql, params); return ""; } catch (e) { return (e as Error).message; }
    };
    const cols = "insert into erp.notifications (organization_id, kind, title, escopo_tipo, modulo, permission_key) values ($1,";

    // rebaixar aviso empresarial para organização = publicá-lo para a organização inteira
    expect(await tentar(`${cols}'purchase_pending','x','organizacao',null,'purchase_requests.view')`, [h.demo.orgId]),
      "compra não pode virar aviso de organização").toMatch(/foreign key|notifications_tipo_fk/i);
    expect(await tentar(`${cols}'processing_pending','x','organizacao',null,'processings.view')`, [h.demo.orgId]),
      "processamento não pode virar aviso de organização").toMatch(/foreign key|notifications_tipo_fk/i);
    expect(await tentar(`${cols}'batch_transfer','x','organizacao',null,'batches.view')`, [h.demo.orgId]),
      "transferência não pode virar aviso de organização").toMatch(/foreign key|notifications_tipo_fk/i);

    // capacidade ausente não é "todo mundo vê": a coluna é obrigatória
    expect(await tentar(`${cols}'stock_min','x','modulo_todas','estoque',null)`, [h.demo.orgId]),
      "capacidade ausente").toMatch(/permission_key/i);

    // capacidade que não é a do tipo: um agregado financeiro escondido atrás de permissão de estoque
    expect(await tentar(`${cols}'title_due','x','modulo_todas','financeiro','stocks.view')`, [h.demo.orgId]),
      "capacidade trocada").toMatch(/foreign key|notifications_tipo_fk/i);

    // módulo trocado dentro do tipo certo: aviso de compra autorizando por acesso ao módulo pecuária
    expect(await tentar(`${cols}'purchase_pending','x','modulo_todas','pecuaria','purchase_requests.view')`, [h.demo.orgId]),
      "módulo trocado").toMatch(/foreign key|notifications_tipo_fk/i);

    // tipo que ninguém declarou não entra de contrabando
    expect(await tentar(`${cols}'kind_inventado','x','organizacao',null,'stocks.view')`, [h.demo.orgId]),
      "tipo desconhecido").toMatch(/foreign key|notifications_tipo_fk/i);

    // e o rebaixamento DECLARADO (documento sem empresa) continua possível — a trava não é um "não" geral
    expect(await tentar(`${cols}'document_expiring','x','organizacao',null,'documents.view')`, [h.demo.orgId]),
      "documento sem empresa é legítimo").toBe("");

    await raiz.end();
  });
});
