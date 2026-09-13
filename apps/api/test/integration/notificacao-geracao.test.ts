import { describe, it, expect, beforeAll } from "vitest";
import { createPool } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * O GERADOR (PRE-BASE2-02 §29): a notificação nasce classificada, e a chave do dia distingue o que é
 * realmente distinto.
 *
 * A matriz A/B ao lado prova a LEITURA; aqui se prova a ESCRITA. Duas famílias de erro cabem exatamente
 * neste ponto cego:
 *
 *  1. escopo errado no nascimento — um aviso de empresa nascendo como aviso da organização vaza o título
 *     para quem não enxerga a empresa, e nenhum teste de leitura pega isso, porque a linha *é* legítima
 *     do ponto de vista de quem lê;
 *  2. chave de deduplicação larga demais — se a chave for a TELA (a rota) em vez do EVENTO, o segundo
 *     acontecimento do dia na mesma empresa é engolido em silêncio: sem erro, sem linha, sem badge. Foi
 *     o que aconteceu com o processamento de animais e com a transferência de lote.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { items?: Record<string, unknown>[]; id?: string; error?: { code: string } };

interface Linha { kind: string; title: string; escopo_tipo: string; modulo: string | null; empresa_id: string | null; permission_key: string; user_id: string | null; dedupe_key: string }
const linhas = async (kind: string): Promise<Linha[]> => {
  const raiz = createPool(TEST_URL, { max: 1 });
  try {
    const r = await raiz.query<Linha>(
      `select kind, title, escopo_tipo, modulo, empresa_id, permission_key, user_id, dedupe_key
         from erp.notifications where organization_id=$1 and kind=$2 order by created_at`, [h.demo.orgId, kind]);
    return r.rows;
  } finally { await raiz.end(); }
};

/** Tipo de documento é obrigatório no cadastro; qualquer um serve para o que se prova aqui. */
const tipoDocumento = async (raiz: ReturnType<typeof createPool>): Promise<string> => {
  const existe = await raiz.query<{ id: string }>("select id from erp.document_types where organization_id=$1 limit 1", [h.demo.orgId]);
  if (existe.rowCount) return existe.rows[0]!.id;
  const novo = await raiz.query<{ id: string }>(
    "insert into erp.document_types(organization_id,name) values ($1,'[TEST] Tipo geração') returning id", [h.demo.orgId]);
  return novo.rows[0]!.id;
};

beforeAll(async () => { h = await harness(); I = await ids(h); }, 180_000);

describe("cada aviso nasce com a empresa da sua FONTE", () => {
  it("dois processamentos na mesma empresa no mesmo dia geram DOIS avisos", async () => {
    // A rota do aviso é constante ("/pecuaria/processamentos"): se ela fosse a chave do dia, o segundo
    // lote de animais a processar sumiria — e, se o primeiro aviso já estivesse lido, nem o badge subiria.
    const antes = (await linhas("processing_pending")).length;
    const compra = (n: number) => h.app.inject({ method: "POST", url: "/api/livestock/movements", headers: h.headers(), payload: {
      farm_id: I.farm, movement_type: "purchase", movement_date: "2026-09-17", person_id: I.provider, batch_id: I.batch,
      items: [{ category_id: I.speciesCategory, quantity: n, weight: "200", unit_value: "1500" }] } });
    expect((await compra(3)).statusCode).toBe(201);
    expect((await compra(4)).statusCode).toBe(201);
    const depois = await linhas("processing_pending");
    expect(depois.length - antes, "cada processamento é um evento próprio").toBe(2);
    const novos = depois.slice(antes);
    expect(new Set(novos.map((x) => x.dedupe_key)).size, "a chave do dia é o EVENTO, não a tela").toBe(2);
    for (const n of novos) {
      expect(n.escopo_tipo).toBe("empresa");
      expect(n.empresa_id, "a empresa é a do processamento").toBe(I.farm);
      expect(n.modulo).toBe("pecuaria");
      expect(n.permission_key).toBe("processings.view");
    }
  });

  it("duas transferências para a mesma empresa de destino no mesmo dia geram DOIS avisos", async () => {
    const antes = (await linhas("batch_transfer")).length;
    const transferir = () => h.app.inject({ method: "POST", url: "/api/livestock/transfers/to-farm", headers: h.headers(), payload: {
      farm_id: I.farm, destination_farm_id: I.farm2, movement_date: "2026-09-18", batch_id: I.batch } });
    expect((await transferir()).statusCode).toBe(201);
    expect((await transferir()).statusCode).toBe(201);
    const depois = await linhas("batch_transfer");
    expect(depois.length - antes).toBe(2);
    for (const n of depois.slice(antes)) {
      expect(n.escopo_tipo).toBe("empresa");
      expect(n.empresa_id, "quem processa a transferência é o DESTINO").toBe(I.farm2);
    }
  });

  it("a empresa de destino tem de ser desta organização — o corpo da requisição não é autoridade", async () => {
    const raiz = createPool(TEST_URL, { max: 1 });
    const outra = await raiz.query<{ id: string }>(
      "insert into erp.organizations(name,slug) values ('[TEST] Destino alheio','destino-alheio-' || substr(md5(random()::text),1,8)) returning id");
    const alheia = await raiz.query<{ id: string }>(
      "insert into erp.farms(organization_id,code,name) values ($1,99,'Empresa de outra org') returning id", [outra.rows[0]!.id]);
    await raiz.end();
    const r = await h.app.inject({ method: "POST", url: "/api/livestock/transfers/to-farm", headers: h.headers(), payload: {
      farm_id: I.farm, destination_farm_id: alheia.rows[0]!.id, movement_date: "2026-09-18", batch_id: I.batch } });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("o refresh classifica cada agregado pelo que ele realmente é", () => {
  beforeAll(async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
  }, 120_000);

  it("é idempotente no dia: rodar de novo não duplica nada", async () => {
    const antes = await linhas("birthday");
    const antesTitulos = await linhas("title_due");
    const r = await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: h.headers() });
    expect(r.statusCode).toBe(200);
    expect((await linhas("birthday")).length).toBe(antes.length);
    expect((await linhas("title_due")).length).toBe(antesTitulos.length);
  });

  it("títulos a pagar são contados POR EMPRESA — não é agregado que só quem vê tudo consolida", async () => {
    // `financial_titles.farm_id` é obrigatório: a contagem se decompõe sem mudar de significado. Agregar
    // assim mesmo tiraria o aviso de quem tem `selecionadas` sobre títulos da própria empresa dele.
    for (const t of await linhas("title_due")) {
      expect(t.escopo_tipo).toBe("empresa");
      expect(t.empresa_id).toBeTruthy();
      expect(t.modulo).toBe("financeiro");
      expect(t.permission_key, "contagem de PAGAR sob permissão de pagar").toBe("payables.view");
      expect(t.dedupe_key, "uma chave por empresa").toBe(`title_due:${t.empresa_id}`);
    }
    const empresas = (await linhas("title_due")).map((t) => t.empresa_id);
    expect(new Set(empresas).size, "sem colisão entre empresas").toBe(empresas.length);
  });

  it("estoque mínimo continua sendo agregado da organização dentro do módulo", async () => {
    // `products.min_stock` é cadastro da organização e o saldo soma todos os armazéns: recortar por
    // empresa exigiria inventar um mínimo por empresa que o cadastro não tem.
    for (const s of await linhas("stock_min")) {
      expect(s.escopo_tipo).toBe("modulo_todas");
      expect(s.empresa_id).toBeNull();
      expect(s.modulo).toBe("estoque");
    }
  });

  it("aniversário é da organização e cada aniversariante tem o seu aviso", async () => {
    const b = await linhas("birthday");
    for (const x of b) {
      expect(x.escopo_tipo).toBe("organizacao");
      expect(x.modulo).toBeNull();
      expect(x.empresa_id).toBeNull();
      expect(x.permission_key).toBe("employees.view");
    }
    // todos compartilham a mesma rota: se a rota fosse a chave, só o primeiro aniversariante existiria
    expect(new Set(b.map((x) => x.dedupe_key)).size).toBe(b.length);
  });

  it("documento sem empresa vira aviso da organização; com empresa, da empresa", async () => {
    const raiz = createPool(TEST_URL, { max: 1 });
    const tipo = await tipoDocumento(raiz);
    await raiz.query(
      `insert into erp.documents(organization_id,farm_id,document_type_id,title,status,expiration_date)
       values ($1,null,$3,'SEM-EMPRESA-GERACAO','active',current_date + 5), ($1,$2,$3,'COM-EMPRESA-GERACAO','active',current_date + 5)`,
      [h.demo.orgId, I.farm, tipo]);
    await raiz.end();
    expect((await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: h.headers() })).statusCode).toBe(200);
    const docs = await linhas("document_expiring");
    const sem = docs.find((d) => d.title.includes("SEM-EMPRESA-GERACAO"));
    const com = docs.find((d) => d.title.includes("COM-EMPRESA-GERACAO"));
    expect(sem, "documento institucional precisa gerar aviso").toBeTruthy();
    expect(sem!.escopo_tipo).toBe("organizacao");
    expect(sem!.modulo).toBeNull();
    expect(com!.escopo_tipo).toBe("empresa");
    expect(com!.empresa_id).toBe(I.farm);
  });

  it("documento de empresa DESATIVADA não gera aviso que ninguém consegue ver", async () => {
    // `erp.tem_acesso_empresa` exige a empresa ativa: o aviso nasceria invisível para todos, inclusive o
    // proprietário, e voltaria a nascer a cada dia.
    const raiz = createPool(TEST_URL, { max: 1 });
    const morta = await raiz.query<{ id: string }>(
      "insert into erp.farms(organization_id,code,name,deleted_at) values ($1,98,'Empresa desativada',now()) returning id", [h.demo.orgId]);
    await raiz.query(
      "insert into erp.documents(organization_id,farm_id,document_type_id,title,status,expiration_date) values ($1,$2,$3,'DOC-EMPRESA-MORTA','active',current_date + 5)",
      [h.demo.orgId, morta.rows[0]!.id, await tipoDocumento(raiz)]);
    await raiz.end();
    expect((await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: h.headers() })).statusCode).toBe(200);
    expect((await linhas("document_expiring")).find((d) => d.title.includes("DOC-EMPRESA-MORTA"))).toBeUndefined();
  });
});

/**
 * DESTINATÁRIO DIRIGIDO (PRE-BASE2-02 §3): capacidade E escopo, nunca só um dos dois.
 *
 * Dirigir um aviso a quem não o vê é pior do que não dirigir. O predicado de leitura é conjunção: o
 * destinatário elimina todos os outros, e então a capacidade (ou o escopo) elimina o próprio destinatário.
 * A linha nasce MORTA — sem erro, sem badge, sem ninguém avisado. O contrato é a INTERSEÇÃO, e verificar
 * só o escopo (como se fazia) deixava exatamente essa metade de fora.
 *
 * Quando o responsável não passa nas duas dimensões, o aviso NÃO é descartado: vira difusão, que já é
 * recortada pela própria autorização da linha (capacidade da fonte + empresa de origem).
 */
describe("responsável da solicitação: capacidade E escopo decidem o direcionamento", () => {
  let COMPRADOR: Hdr; let idResponsavelSemCap = ""; let idResponsavelSemEscopo = ""; let idResponsavelValido = "";

  const criarUsuario = async (nome: string, email: string, perms: string[], escopos: Record<string, unknown>[]) => {
    const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: nome, permissions: perms } });
    expect(papel.statusCode, papel.body).toBe(201);
    const membro = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: {
      name: nome, email, password: "Notif@12345", role_id: j(papel).id, escopos_empresas: escopos } });
    expect(membro.statusCode, membro.body).toBe(201);
    const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Notif@12345" } });
    expect(login.statusCode, login.body).toBe(200);
    return { id: j(membro).id as string, hdr: { authorization: `Bearer ${j(login).token}`, "x-org-id": h.demo.orgId } as Hdr };
  };

  /** Solicitação parada há mais de 3 dias na Empresa A, com o responsável pedido. */
  const solicitacao = async (sufixo: string, responsavel: string | null, excluida = false) => {
    const raiz = createPool(TEST_URL, { max: 1 });
    try {
      const r = await raiz.query<{ id: string }>(
        `insert into erp.purchase_requests
           (organization_id, farm_id, code, request_date, request_type, requester_user_id, status,
            status_changed_at, description, justification, current_responsible_user_id, deleted_at)
         values ($1,$2,$3,current_date - 10,'product',$4,'request', now() - interval '9 days',
                 $5, 'teste de destinatario', $6, $7) returning id`,
        [h.demo.orgId, I.farm, `SC-DEST-${sufixo}`, h.demo.adminUserId, `SENTINELA-DEST-${sufixo}`,
          responsavel, excluida ? new Date().toISOString() : null]);
      return r.rows[0]!.id;
    } finally { await raiz.end(); }
  };

  const avisoDe = async (sufixo: string): Promise<Linha | undefined> =>
    (await linhas("purchase_pending")).find((n) => n.title.includes(`SC-DEST-${sufixo}`));

  const veNaCaixa = async (hdr: Hdr, sufixo: string) => {
    const r = await h.app.inject({ method: "GET", url: "/api/admin/notifications", headers: hdr });
    expect(r.statusCode, r.body).toBe(200);
    return r.body.includes(`SC-DEST-${sufixo}`);
  };

  beforeAll(async () => {
    // COMPRADOR: as duas dimensões — é quem deve receber a difusão.
    COMPRADOR = (await criarUsuario("Comprador A", "comprador-a@demo.local", ["purchase_requests.view"],
      [{ modulo: "compras", modo: "selecionadas", empresas: [I.farm] }])).hdr;
    // RESPONSÁVEL SEM CAPACIDADE: enxerga a Empresa A em Compras, mas não tem purchase_requests.view.
    idResponsavelSemCap = (await criarUsuario("Resp sem capacidade", "resp-sem-cap@demo.local", ["stocks.view"],
      [{ modulo: "compras", modo: "selecionadas", empresas: [I.farm] }])).id;
    // RESPONSÁVEL SEM ESCOPO: tem a capacidade, mas só enxerga a Empresa B em Compras.
    idResponsavelSemEscopo = (await criarUsuario("Resp sem escopo", "resp-sem-escopo@demo.local", ["purchase_requests.view"],
      [{ modulo: "compras", modo: "selecionadas", empresas: [I.farm2] }])).id;
    // RESPONSÁVEL VÁLIDO: as duas dimensões na Empresa A.
    idResponsavelValido = (await criarUsuario("Resp valido", "resp-valido@demo.local", ["purchase_requests.view"],
      [{ modulo: "compras", modo: "selecionadas", empresas: [I.farm] }])).id;
  }, 120_000);

  it("responsável COM escopo e SEM capacidade não é direcionado — e o aviso não some", async () => {
    await solicitacao("SEMCAP", idResponsavelSemCap);
    expect((await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: h.headers() })).statusCode).toBe(200);
    const aviso = await avisoDe("SEMCAP");
    expect(aviso, "a notificação precisa existir").toBeTruthy();
    expect(aviso!.user_id, "sem a capacidade, o direcionamento mataria o aviso").toBeNull();
    expect(aviso!.escopo_tipo).toBe("empresa");
    expect(aviso!.empresa_id).toBe(I.farm);
    // difusão: chega a quem tem capacidade E empresa, e ao proprietário
    expect(await veNaCaixa(COMPRADOR, "SEMCAP"), "o comprador autorizado continua recebendo").toBe(true);
    expect(await veNaCaixa(h.headers() as Hdr, "SEMCAP"), "o proprietário vê").toBe(true);
  });

  it("responsável COM capacidade e SEM escopo da empresa também não é direcionado", async () => {
    await solicitacao("SEMESCOPO", idResponsavelSemEscopo);
    expect((await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: h.headers() })).statusCode).toBe(200);
    const aviso = await avisoDe("SEMESCOPO");
    expect(aviso, "a notificação precisa existir").toBeTruthy();
    expect(aviso!.user_id, "capacidade sem escopo não basta").toBeNull();
    expect(await veNaCaixa(COMPRADOR, "SEMESCOPO"), "os autorizados da Empresa A continuam recebendo").toBe(true);
  });

  it("responsável com AS DUAS dimensões continua recebendo o aviso dirigido", async () => {
    await solicitacao("VALIDO", idResponsavelValido);
    expect((await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: h.headers() })).statusCode).toBe(200);
    const aviso = await avisoDe("VALIDO");
    expect(aviso, "a notificação precisa existir").toBeTruthy();
    expect(aviso!.user_id, "direcionar continua valendo quando é legítimo").toBe(idResponsavelValido);
    // dirigido é dirigido: outro comprador da mesma empresa NÃO recebe este
    expect(await veNaCaixa(COMPRADOR, "VALIDO"), "aviso dirigido não vira difusão").toBe(false);
  });

  it("solicitação de empresa DESATIVADA não gera aviso que ninguém consegue ver", async () => {
    // `erp.tem_acesso_empresa` exige empresa ativa e o ramo `empresa` da leitura a chama SEM atalho de
    // proprietário: o aviso nasceria invisível para todos, inclusive o dono, e voltaria a nascer todo dia.
    const raiz = createPool(TEST_URL, { max: 1 });
    let morta = "";
    try {
      morta = (await raiz.query<{ id: string }>(
        "insert into erp.farms(organization_id,code,name,deleted_at) values ($1,97,'Empresa desativada compras',now()) returning id",
        [h.demo.orgId])).rows[0]!.id;
      await raiz.query(
        `insert into erp.purchase_requests
           (organization_id, farm_id, code, request_date, request_type, requester_user_id, status,
            status_changed_at, description, justification)
         values ($1,$2,'SC-DEST-MORTA',current_date - 10,'product',$3,'request', now() - interval '9 days',
                 'SENTINELA-DEST-MORTA','teste')`, [h.demo.orgId, morta, h.demo.adminUserId]);
    } finally { await raiz.end(); }
    expect((await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: h.headers() })).statusCode).toBe(200);
    expect(await avisoDe("MORTA")).toBeUndefined();
  });

  it("solicitação logicamente excluída não gera aviso novo", async () => {
    // `deleted_at is not null` é inexistente para as rotas oficiais (supply.ts); gerar alerta diário para
    // ela seria avisar sobre um registro que ninguém consegue abrir.
    await solicitacao("EXCLUIDA", idResponsavelValido, true);
    expect((await h.app.inject({ method: "POST", url: "/api/admin/notifications/refresh", headers: h.headers() })).statusCode).toBe(200);
    expect(await avisoDe("EXCLUIDA")).toBeUndefined();
  });
});
