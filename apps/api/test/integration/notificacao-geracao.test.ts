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
