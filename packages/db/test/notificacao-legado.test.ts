import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * LEGADO DA NOTIFICAÇÃO (PRE-BASE2-02): migrar não pode transformar vazamento em vazamento AUTORIZADO.
 *
 * As notificações que já existem no banco não têm empresa nem módulo — e a empresa delas não é recuperável:
 * ela só aparece insinuada no texto do título, e reconstruir autorização parseando texto humano é
 * exatamente o tipo de heurística que erra em silêncio. Classificar tudo como "da organização" seria o
 * caminho confortável e PRESERVARIA o vazamento: o título com o código da solicitação de compra da Empresa A
 * continuaria chegando a quem só enxerga a Empresa B.
 *
 * A regra provada aqui é a inversa: FAIL-CLOSED. Quem não tem empresa recuperável vira `modulo_todas` —
 * visível só a proprietário ou a quem tem modo `todas` naquele módulo, que é sempre um SUBCONJUNTO de quem
 * veria a linha por empresa. Perde-se alcance; não se ganha exposição.
 */
const ORG = "cccccccc-0000-4000-8000-000000000001";
const EMPRESA = "cccccccc-0000-4000-8000-00000000000a";
const USUARIO = "cccccccc-0000-4000-8000-000000000011";
const OUTRO = "cccccccc-0000-4000-8000-000000000012";

const migrations = listMigrations();
const ate0011 = migrations.filter((m) => m.name < "0012");
const zero12 = migrations.find((m) => m.name.startsWith("0012"));

/** Reconstrói um banco no estado ANTERIOR à 0012, com notificações legadas plantadas. */
async function bancoLegado(db: Db, extras: { kind: string; title: string }[] = []): Promise<void> {
  await resetSchema(db);
  for (const m of ate0011) await db.query(m.sql);
  await db.query("insert into erp.organizations(id,name,slug) values ($1,'[TEST] Notificação','notif-legado')", [ORG]);
  await db.query("insert into erp.farms(id,organization_id,code,name) values ($1,$2,1,'Empresa A')", [EMPRESA, ORG]);
  for (const [id, email] of [[USUARIO, "legado@t.local"], [OUTRO, "outro@t.local"]]) {
    await db.query("insert into erp.users(id,email,name,password_hash) values ($1,$2,$3,'x')", [id, email, email]);
    await db.query("insert into erp.organization_members(id,organization_id,user_id,is_owner,is_active) values ($1,$2,$1,false,true)", [id, ORG]);
  }
  // o acervo real: avisos de todos os tipos, sem empresa, sem módulo, sem capacidade
  const legadas: [string, string, string | null, string | null][] = [
    ["purchase_pending", "Solicitação SC-000471 pendente há 5 dias", "/compras/solicitacoes", null],
    ["processing_pending", "Processamento de animais pendente", "/pecuaria/processamentos", null],
    ["batch_transfer", "Transferência de lote a processar", "/pecuaria/lotes", null],
    ["document_expiring", "Licença ambiental vence em 7 dias", "/documentos", null],
    ["stock_min", "3 produtos no estoque mínimo", "/estoque", null],
    ["title_due", "4 títulos vencendo em 3 dias", "/financeiro/contas-a-pagar", null],
    ["birthday", "Aniversário de colaborador hoje", "/pessoas", null],
    // aviso dirigido E já lido: a leitura tem dono conhecido e precisa sobreviver como recibo
    ["birthday", "Aniversário dirigido", "/pessoas", USUARIO],
    // aviso COMPARTILHADO já lido: read_at não diz de quem era a leitura — inventar um dono seria marcar
    // como lido para quem nunca viu
    ["stock_min", "Compartilhado já lido", "/estoque", null]
  ];
  for (const [kind, title, route, userId] of legadas) {
    const lido = title.includes("lido") || title.includes("dirigido");
    await db.query(
      "insert into erp.notifications(organization_id,user_id,kind,title,route,read_at) values ($1,$2,$3,$4,$5,$6)",
      [ORG, userId, kind, title, route, lido ? new Date().toISOString() : null]);
  }
  for (const e of extras) {
    await db.query("insert into erp.notifications(organization_id,kind,title) values ($1,$2,$3)", [ORG, e.kind, e.title]);
  }
}

describe("classificação fail-closed do legado (0012)", () => {
  let db: Db;
  beforeAll(async () => {
    expect(zero12, "migration 0012 precisa existir").toBeTruthy();
    db = createPool(TEST_URL, { max: 2 });
    await bancoLegado(db);
    await db.query(zero12!.sql);
  }, 240_000);
  afterAll(async () => { await db.end(); });

  it("nenhum aviso de conteúdo empresarial virou aviso de ORGANIZAÇÃO", async () => {
    const r = await db.query<{ kind: string }>(
      "select distinct kind from erp.notifications where organization_id=$1 and escopo_tipo='organizacao'", [ORG]);
    // só o aniversário é genuinamente da organização: ele não tem dimensão de empresa nenhuma
    expect(r.rows.map((x) => x.kind).sort()).toEqual(["birthday"]);
  });

  it("o que tinha empresa e a perdeu virou modulo_todas do módulo certo, com capacidade", async () => {
    const r = await db.query<{ kind: string; escopo_tipo: string; modulo: string; permission_key: string; empresa_id: string | null }>(
      "select kind, escopo_tipo, modulo, permission_key, empresa_id from erp.notifications where organization_id=$1 and kind <> 'birthday' order by kind", [ORG]);
    const esperado: Record<string, [string, string]> = {
      purchase_pending: ["compras", "purchase_requests.view"],
      processing_pending: ["pecuaria", "processings.view"],
      batch_transfer: ["pecuaria", "batches.view"],
      document_expiring: ["documentos", "documents.view"],
      stock_min: ["estoque", "stocks.view"],
      title_due: ["financeiro", "payables.view"]
    };
    for (const linha of r.rows) {
      const [modulo, permissao] = esperado[linha.kind]!;
      expect(linha.escopo_tipo, linha.kind).toBe("modulo_todas");
      expect(linha.modulo, linha.kind).toBe(modulo);
      expect(linha.permission_key, linha.kind).toBe(permissao);
      expect(linha.empresa_id, "empresa não é inventada a partir do título").toBeNull();
    }
    expect(r.rowCount).toBe(7); // 6 tipos + o segundo stock_min
  });

  it("nenhuma linha ficou sem escopo ou sem capacidade", async () => {
    const r = await db.query<{ n: string }>(
      "select count(*) n from erp.notifications where organization_id=$1 and (escopo_tipo is null or permission_key is null)", [ORG]);
    expect(Number(r.rows[0]!.n)).toBe(0);
  });

  it("o título humano NÃO foi usado para reconstruir empresa", async () => {
    // "SC-000471" existe no título e a Empresa A existe no banco: se a migration tentasse casar texto com
    // registro, esta linha teria ganhado empresa. Autorização por heurística de texto erra calada.
    const r = await db.query<{ empresa_id: string | null }>(
      "select empresa_id from erp.notifications where organization_id=$1 and kind='purchase_pending'", [ORG]);
    expect(r.rows[0]!.empresa_id).toBeNull();
  });

  it("read_at legado vira recibo só quando se sabe DE QUEM era a leitura", async () => {
    const r = await db.query<{ usuario_id: string; title: string }>(
      `select l.usuario_id, n.title from erp.notificacao_leituras l
         join erp.notifications n on n.id = l.notificacao_id where l.organization_id=$1`, [ORG]);
    expect(r.rowCount, "só o aviso dirigido tem dono de leitura conhecido").toBe(1);
    expect(r.rows[0]!.usuario_id).toBe(USUARIO);
    expect(r.rows[0]!.title).toBe("Aniversário dirigido");
  });

  it("read_at continua existindo como legado — a migration não apaga histórico", async () => {
    const r = await db.query<{ n: string }>("select count(*) n from erp.notifications where organization_id=$1 and read_at is not null", [ORG]);
    expect(Number(r.rows[0]!.n)).toBe(2);
  });

  it("o banco recusa rebaixar um aviso empresarial para organização", async () => {
    await expect(db.query(
      `insert into erp.notifications(organization_id,kind,title,escopo_tipo,permission_key)
       values ($1,'purchase_pending','Vazamento','organizacao','purchase_requests.view')`, [ORG]
    )).rejects.toThrow(/notifications_tipo_fk|foreign key/i);
  });

  it("o banco recusa capacidade ausente", async () => {
    await expect(db.query(
      `insert into erp.notifications(organization_id,kind,title,escopo_tipo,modulo)
       values ($1,'stock_min','Sem capacidade','modulo_todas','estoque')`, [ORG]
    )).rejects.toThrow(/permission_key/i);
  });

  it("o banco recusa capacidade que não é a do tipo", async () => {
    await expect(db.query(
      `insert into erp.notifications(organization_id,kind,title,escopo_tipo,modulo,permission_key)
       values ($1,'title_due','Agregado sob outra chave','modulo_todas','financeiro','stocks.view')`, [ORG]
    )).rejects.toThrow(/notifications_tipo_fk|foreign key/i);
  });
});

describe("tipo desconhecido interrompe a migração em vez de chutar escopo", () => {
  let db: Db;
  beforeAll(async () => { db = createPool(TEST_URL, { max: 2 }); }, 60_000);
  afterAll(async () => { await db.end(); });

  it("um kind fora do registry faz a 0012 falhar, nomeando o tipo", async () => {
    // Classificar no chute erra para os dois lados: para cima vaza, para baixo some. Parar é a única
    // resposta que não decide sozinha o que ninguém revisou.
    await bancoLegado(db, [{ kind: "kind_inventado", title: "Aviso de um tipo que ninguém declarou" }]);
    await expect(db.query(zero12!.sql)).rejects.toThrow(/kind_inventado/);
  }, 240_000);
});
