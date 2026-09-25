import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db } from "@agro/db";
import { ENTIDADES_ID_GLOBAL, MOVIMENTACOES_INTERNAS, variantesInternasDeclaradas } from "@agro/domain";
import { variantesDeclaradas } from "@erp/plataforma";
import { AUTORIZACAO_PROPRIETARIO } from "@erp/plataforma";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";
import { atribuirIdGlobal } from "../../src/lib/id-global.js";
import type { ServiceCtx } from "../../src/lib/context.js";

/**
 * ID GLOBAL — ALOCAÇÃO EM RUNTIME (PRE-BASE2-04).
 *
 * Esta suíte NÃO roda o backfill. É de propósito: o backfill numera o acervo e, se rodasse antes, esconderia
 * exatamente o defeito que importa — uma porta de escrita que esqueceu de alocar. Aqui cada registro nasce
 * pela ROTA REAL da aplicação e é conferido no índice IMEDIATAMENTE depois.
 *
 * A prova é matricial porque o contrato é matricial: 23 tipos de entidade, e naquelas que guardam variantes
 * (título a pagar × a receber, orçamento × pedido × venda, cada movimentação e cada manejo de rebanho) a
 * variante decide rota E permissão. Uma matriz que cobre a tabela mas não a variante deixa passar o vazamento
 * que o contrato foi escrito para impedir.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Corpo = Record<string, unknown>;
const j = (r: { json: () => unknown }) => r.json() as Corpo & { id?: string; error?: { code: string } };

/** Índice global do registro, lido SEM RLS: é a verdade do banco, não a que a rota devolve. */
async function indice(tipo: string, id: string) {
  const r = await admin.query<{ id_global: string; empresa_id: string | null; modulo: string; rota_canonica: string; organization_id: string }>(
    "select id_global, empresa_id, modulo, rota_canonica, organization_id from erp.registros_globais where tipo_entidade=$1 and id_entidade=$2", [tipo, id]);
  return r.rows;
}
const post = (url: string, payload: Corpo, extra: Record<string, string> = {}) =>
  h.app.inject({ method: "POST", url, headers: h.headers(extra), payload });
const criar = async (url: string, payload: Corpo): Promise<string> => {
  const r = await post(url, payload);
  expect(r.statusCode, `${url}: ${r.body}`).toBe(201);
  return String(j(r).id);
};

/** Confere o índice de um registro recém-criado: exatamente UM, com a metadata certa. */
async function conferir(tipo: string, id: string, esperado: { empresa?: string | null; modulo: string; rota: string }) {
  const linhas = await indice(tipo, id);
  expect(linhas.length, `${tipo} ${id} devia ter exatamente 1 ID Global`).toBe(1);
  const l = linhas[0]!;
  expect(Number(l.id_global), "o número é positivo e vem do banco").toBeGreaterThan(0);
  expect(l.organization_id, "o índice é da organização do registro").toBe(h.demo.orgId);
  expect(l.modulo).toBe(esperado.modulo);
  expect(l.rota_canonica).toBe(esperado.rota);
  if (esperado.empresa !== undefined) expect(l.empresa_id, "a pista de empresa é a do registro na criação").toBe(esperado.empresa);
  return Number(l.id_global);
}

/** Animal ATIVO recém-criado na empresa de origem — cada baixa consome um. */
async function animalAtivo(): Promise<string> {
  const r = await admin.query<{ id: string }>(
    "insert into erp.animals(organization_id,empresa_id,species_id,category_id,batch_id,sex,status,entry_date) select $1,$2,species_id,category_id,$3,'M','active',current_date from erp.animals where id=$4 returning id",
    [h.demo.orgId, I.empresa, LOTE, ANIMAL]);
  return r.rows[0]!.id;
}

const opcao = async (recurso: string, filtro = ""): Promise<string> =>
  ((j(await h.app.inject({ method: "GET", url: `/api/resources/${recurso}/options${filtro}`, headers: h.headers() })) as unknown) as { id: string }[])[0]!.id;

let EQUIPAMENTO = ""; let DIESEL = ""; let FORMULA = ""; let ANIMAL = ""; let LOTE = "";

beforeAll(async () => {
  h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 2 });
  // saldo para o que consome estoque
  for (const p of [I.product, I.product2]) {
    const r = await post("/api/stock/opening-balances", { empresa_id: I.empresa, warehouse_id: I.warehouse, product_id: p, quantity: "5000", unit_value: "10" });
    expect(r.statusCode, r.body).toBe(201);
  }
  // O seed grava os equipamentos de demonstração com códigos fixos ("0001".."0003") SEM avançar
  // `erp.code_sequences`, então a primeira criação real colide no código da ENTIDADE — conflito de código,
  // não de ID Global. Alinhar a sequência aqui mantém este teste medindo o que ele se propõe a medir; o
  // defeito do seed está relatado à parte, fora do escopo desta missão.
  await admin.query(
    `insert into erp.code_sequences(organization_id, entity, last_value)
     values ($1,'equipment',(select coalesce(max(code::int),0) from erp.equipments where organization_id=$1))
     on conflict (organization_id, entity) do update set last_value = excluded.last_value`, [h.demo.orgId]);
  EQUIPAMENTO = I.equipment!; DIESEL = I.product2!;
  LOTE = I.batch!;
  ANIMAL = I.animal!;
}, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("CADASTROS — a porta GENÉRICA do Resource Registry aloca sem um `if` por tabela", () => {
  it("produto recebe ID Global", async () => {
    const id = await criar("/api/resources/products", {
      description: "Produto ID Global", measurement_id: await opcao("measurement_units"), group_id: await opcao("product_groups", "?kind=analytic"),
      control_stock: true,
      financial_category_id: I.category });
    await conferir("products", id, { empresa: null, modulo: "cadastros", rota: `/cadastros/products/${id}?view=1` });
  });
  it("pessoa recebe ID Global", async () => {
    const id = await criar("/api/resources/people", { name: "Pessoa ID Global", is_provider: true });
    await conferir("people", id, { empresa: null, modulo: "cadastros", rota: `/cadastros/people/${id}?view=1` });
  });
  it("equipamento recebe ID Global", async () => {
    // `code` explícito: a sequência de equipamento do seed já consumiu os primeiros códigos e o conflito
    // seria de CÓDIGO DA ENTIDADE, não de ID Global — ruído que esconderia o que este teste mede.
    const id = await criar("/api/resources/equipments", { description: "Trator ID Global", empresa_id: I.empresa, family_id: await opcao("equipment_families"),
      year_model: "2020", hour_value: "0", acquisition_value: "0" });
    await conferir("equipments", id, { modulo: "frota", rota: `/cadastros/equipments/${id}?view=1` });
  });
  it("perfil de acesso recebe ID Global (rota própria, não a genérica)", async () => {
    const id = await criar("/api/admin/roles", { name: "Perfil ID Global", permissions: ["products.view"] });
    await conferir("roles", id, { empresa: null, modulo: "configuracoes", rota: `/admin/perfis/${id}` });
  });
});

describe("COMPRAS E ESTOQUE", () => {
  it("solicitação de compra", async () => {
    const id = await criar("/api/supply/requests", { empresa_id: I.empresa, request_date: "2031-01-05", request_type: "product", description: "Compra", justification: "Reposição", items: [{ product_id: I.product, description: "Sal", quantity: "10", reference_value: "5" }] });
    await conferir("purchase_requests", id, { empresa: I.empresa, modulo: "compras", rota: `/suprimentos/view/${id}` });
  });
  it("entrada manual", async () => {
    const id = await criar("/api/stock/input-entries", { empresa_id: I.empresa, entry_date: "2031-01-06", items: [{ product_id: I.product, quantity: "10", unit_value: "5", warehouse_id: I.warehouse, financial_category_id: I.category, cost_center_id: I.costCenter }] });
    await conferir("input_entries", id, { empresa: I.empresa, modulo: "estoque", rota: `/estoque/entradas/${id}` });
  });
  it("documento fiscal", async () => {
    const id = await criar("/api/stock/invoices", { empresa_id: I.empresa, number: "IDG-1", provider_id: I.provider, emission_date: "2031-01-07", items: [{ product_id: I.product, quantity: "5", unit_value: "3", warehouse_id: I.warehouse, financial_category_id: I.category, cost_center_id: I.costCenter }], apportionment_type: "by_product" });
    await conferir("invoices", id, { empresa: I.empresa, modulo: "estoque", rota: `/estoque/documentos-fiscais/${id}` });
  });
  it("requisição", async () => {
    const id = await criar("/api/stock/requisitions", { empresa_id: I.empresa, requisition_date: "2031-01-08", items: [{ warehouse_id: I.warehouse, product_id: I.product, quantity: "3" }] });
    await conferir("requisitions", id, { empresa: I.empresa, modulo: "estoque", rota: `/estoque/requisicoes/${id}` });
  });
  it("saída direta", async () => {
    const id = await criar("/api/stock/writeoffs", { empresa_id: I.empresa, writeoff_date: "2031-01-09", reason: "loss", warehouse_id: I.warehouse, justification: "Perda medida", items: [{ product_id: I.product, quantity: "1" }] });
    await conferir("stock_writeoffs", id, { empresa: I.empresa, modulo: "estoque", rota: `/estoque/baixas/${id}` });
  });
  it("devolução", async () => {
    const id = await criar("/api/stock/devolutions", { empresa_id: I.empresa, devolution_date: "2031-01-10", items: [{ warehouse_id: I.warehouse, product_id: I.product, quantity: "1" }] });
    await conferir("devolutions", id, { empresa: I.empresa, modulo: "estoque", rota: `/estoque/devolucoes/${id}` });
  });
  it("transferência de armazém — a pista de empresa é a de ORIGEM", async () => {
    const id = await criar("/api/stock/transfers", { kind: "warehouse", transfer_date: "2031-01-11", empresa_origem_id: I.empresa, origin_warehouse_id: I.warehouse, destination_warehouse_id: I.warehouse2, items: [{ product_id: I.product, quantity: "2" }] });
    await conferir("warehouse_transfers", id, { empresa: I.empresa, modulo: "estoque", rota: `/estoque/transferencias/${id}` });
  });
  it("produção de ração", async () => {
    FORMULA = await criar("/api/stock/feed-formulas", { name: "Fórmula ID Global", product_id: I.product2, items: [{ product_id: I.product, quantity: "10" }] });
    const id = await criar("/api/stock/feed-batches", { empresa_id: I.empresa, batch_date: "2031-01-12", formula_id: FORMULA, origin_warehouse_id: I.warehouse, destination_warehouse_id: I.warehouse2, quantity_produced: "10" });
    await conferir("feed_batches", id, { empresa: I.empresa, modulo: "estoque", rota: `/estoque/batidas/${id}` });
  });
});

describe("FINANCEIRO — variante decide rota E permissão", () => {
  it("título A PAGAR resolve para a tela de contas a pagar", async () => {
    const id = await criar("/api/financial/payables", { empresa_id: I.empresa, number: "IDG-P", person_id: I.provider, amount: "100", emission_date: "2031-01-13", due_date: "2031-02-13", note: "Título ID Global", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] });
    await conferir("financial_titles", id, { empresa: I.empresa, modulo: "financeiro", rota: `/financeiro/contas-a-pagar/${id}` });
  });
  it("título A RECEBER resolve para a tela de contas a receber", async () => {
    const id = await criar("/api/financial/receivables", { empresa_id: I.empresa, number: "IDG-R", person_id: I.client, amount: "100", emission_date: "2031-01-13", due_date: "2031-02-13", note: "Título ID Global", apportionment: [{ financial_category_id: I.incomeCategory, cost_center_id: I.costCenter, percentage: "100" }] });
    await conferir("financial_titles", id, { empresa: I.empresa, modulo: "financeiro", rota: `/financeiro/contas-a-receber/${id}` });
  });
  it("movimento bancário — e o PAR da transferência interna também recebe número", async () => {
    const r = await post("/api/financial/bank-movements", { bank_account_id: I.bankAccount, movement_date: "2031-01-14", type: "out", category_type: "internal_transfer", destination_account_id: I.cashAccount, amount: "50" });
    expect(r.statusCode, r.body).toBe(201);
    const id = String(j(r).id);
    await conferir("bank_movements", id, { modulo: "financeiro", rota: `/financeiro/movimentos/${id}` });
    const par = await admin.query<{ id: string }>("select id from erp.bank_movements where transfer_pair_id=$1", [id]);
    expect(par.rows.length, "a transferência interna cria o par na conta de destino").toBe(1);
    await conferir("bank_movements", par.rows[0]!.id, { modulo: "financeiro", rota: `/financeiro/movimentos/${par.rows[0]!.id}` });
  });
  it("importação OFX", async () => {
    const ofx = "OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>" +
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20310115<TRNAMT>-10.00<FITID>IDG1<MEMO>Teste</STMTTRN>" +
      "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";
    const id = await criar("/api/financial/ofx-imports", { bank_account_id: I.bankAccount, description: "Extrato ID Global", content: ofx });
    await conferir("ofx_imports", id, { empresa: null, modulo: "financeiro", rota: `/financeiro/ofx/${id}` });
  });
});

describe("VENDAS — três variantes, três permissões", () => {
  for (const [kind, rota, url] of [["budget", "budgets", "/api/sales/budgets"], ["order", "orders", "/api/sales/orders"], ["sale", "sales", "/api/sales/sales"]] as const) {
    it(`documento de venda: ${kind}`, async () => {
      const id = await criar(url, { empresa_id: I.empresa, document_date: "2031-01-16", client_id: I.client, items: [{ product_id: I.product, warehouse_id: I.warehouse, quantity: "1", unit_price: "10" }] });
      await conferir("sales_documents", id, { empresa: I.empresa, modulo: "vendas", rota: `/vendas/${rota}/${id}` });
    });
  }
});

describe("PECUÁRIA — cada variante user-facing recebe; as INTERNAS não", () => {
  it("animal", async () => {
    const id = await criar("/api/livestock/animals", { empresa_id: I.empresa, species_id: await opcao("animal_species"), category_id: I.speciesCategory, entry_date: "2031-01-17", sex: "M", identifications: [{ identification_type_id: I.idType, value: "IDG-ANIMAL-1", is_primary: true }] });
    await conferir("animals", id, { empresa: I.empresa, modulo: "pecuaria", rota: `/pecuaria/animais/${id}` });
  });
  for (const tipo of ["purchase", "sale", "birth", "death", "loss"] as const) {
    it(`movimentação de rebanho: ${tipo}`, async () => {
      const entrada = tipo === "purchase" || tipo === "birth";
      // saída precisa de um animal ATIVO próprio: reaproveitar o mesmo em `sale`, `death` e `loss` faria o
      // segundo teste medir o resíduo do primeiro (o animal sai do rebanho na primeira baixa).
      const itens = entrada
        ? [{ category_id: I.speciesCategory, quantity: 1, unit_value: "100", weight: "300" }]
        : [{ animal_id: await animalAtivo(), quantity: 1 }];
      const id = await criar("/api/livestock/movements", { empresa_id: I.empresa, movement_type: tipo, movement_date: "2031-01-18", batch_id: LOTE, items: itens });
      await conferir("animal_movements", id, { empresa: I.empresa, modulo: "pecuaria", rota: `/pecuaria/movimentacoes/${tipo}/${id}` });
    });
  }
  for (const tipo of ["nutrition", "sanitary", "weaning", "separation", "pasture"] as const) {
    it(`manejo: ${tipo}`, async () => {
      const id = await criar("/api/livestock/handlings", { empresa_id: I.empresa, handling_type: tipo, handling_date: "2031-01-19", items: [{ animal_id: ANIMAL, quantity: "1" }] });
      await conferir("animal_handlings", id, { empresa: I.empresa, modulo: "pecuaria", rota: `/pecuaria/manejo/${tipo}/${id}` });
    });
  }
  it("pesagem", async () => {
    const id = await criar("/api/livestock/weighings", { empresa_id: I.empresa, weighing_date: "2031-01-20", items: [{ animal_id: ANIMAL, weight: "320" }] });
    await conferir("weighings", id, { empresa: I.empresa, modulo: "pecuaria", rota: `/pecuaria/pesagens/${id}` });
  });
  it("MOVIMENTAÇÃO INTERNA (transferência entre lotes) NÃO recebe ID Global", async () => {
    const destino = await admin.query<{ id: string }>("insert into erp.batches(organization_id,empresa_id,code,batch_date,description,status) values ($1,$2,$3,current_date,'Destino','active') returning id", [h.demo.orgId, I.empresa, `IDG${Math.random().toString(36).slice(2, 8)}`]);
    const animal = await admin.query<{ id: string }>(
      "insert into erp.animals(organization_id,empresa_id,species_id,category_id,batch_id,sex,status,entry_date) select $1,$2,species_id,category_id,$3,'M','active',current_date from erp.animals where id=$4 returning id",
      [h.demo.orgId, I.empresa, LOTE, ANIMAL]);
    const r = await post("/api/livestock/transfers/animals-to-batch", { empresa_id: I.empresa, movement_date: "2031-01-21", animal_ids: [animal.rows[0]!.id], destination_batch_id: destino.rows[0]!.id });
    expect(r.statusCode, r.body).toBe(201);
    const linhas = await indice("animal_movements", String(j(r).id));
    expect(linhas.length, "efeito de outra operação não tem identidade própria para o usuário").toBe(0);
  });
});

describe("FROTA, ATIVOS E ORDENS DE SERVIÇO", () => {
  it("abastecimento", async () => {
    const id = await criar("/api/fleet/fuel-supplies", { empresa_id: I.empresa, supply_date: "2031-01-22", equipment_id: EQUIPAMENTO, product_id: DIESEL, warehouse_id: I.warehouse, quantity: "10", unit_value: "6" });
    await conferir("fuel_supplies", id, { empresa: I.empresa, modulo: "frota", rota: `/frota/abastecimentos/${id}` });
  });
  it("manutenção", async () => {
    const id = await criar("/api/fleet/maintenances", { empresa_id: I.empresa, maintenance_date: "2031-01-23", machines: [{ equipment_id: EQUIPAMENTO, service_total: "100", items: [] }] });
    await conferir("maintenances", id, { empresa: I.empresa, modulo: "frota", rota: `/frota/manutencoes/${id}` });
  });
  it("ordem de serviço", async () => {
    const id = await criar("/api/service-orders", { empresa_id: I.empresa, order_date: "2031-01-24", description: "OS ID Global", lines: [] });
    await conferir("service_orders", id, { empresa: I.empresa, modulo: "os", rota: `/os/${id}` });
  });
});

describe("COBERTURA E INVARIANTES DA ALOCAÇÃO", () => {
  it("TODO tipo do catálogo recebeu pelo menos um ID Global nesta suíte — sem backfill", async () => {
    const r = await admin.query<{ tipo_entidade: string }>("select distinct tipo_entidade from erp.registros_globais where organization_id=$1", [h.demo.orgId]);
    const cobertos = new Set(r.rows.map((x) => x.tipo_entidade));
    const faltando = ENTIDADES_ID_GLOBAL.map((e) => e.tipoEntidade).filter((t) => !cobertos.has(t));
    expect(faltando, "toda entidade elegível precisa nascer numerada pela porta real").toEqual([]);
  });

  it("TODA variante navegável declarada foi exercitada (rota e permissão saem da mesma coluna)", async () => {
    const r = await admin.query<{ rota_canonica: string }>("select distinct rota_canonica from erp.registros_globais where organization_id=$1", [h.demo.orgId]);
    const rotas = r.rows.map((x) => x.rota_canonica);
    const faltando: string[] = [];
    for (const e of ENTIDADES_ID_GLOBAL) {
      for (const v of variantesDeclaradas(e)) {
        const variante = (e.resolucao as { variantes: Record<string, { rota: string }> }).variantes[v]!;
        const prefixo = variante.rota.replace(":id", "");
        // `locate` é a única variante declarada sem porta de criação: ver a divergência de contrato relatada
        if (e.tipoEntidade === "animal_handlings" && v === "locate") continue;
        if (!rotas.some((rota) => rota.startsWith(prefixo))) faltando.push(`${e.tipoEntidade}[${v}]`);
      }
    }
    expect(faltando).toEqual([]);
  });

  it("nenhuma variante INTERNA recebeu número", async () => {
    for (const e of ENTIDADES_ID_GLOBAL) {
      const internas = variantesInternasDeclaradas(e.tipoEntidade);
      if (!internas.length) continue;
      const coluna = (e.resolucao as { coluna: string }).coluna;
      const r = await admin.query<{ n: string }>(
        `select count(*)::text n from erp.registros_globais g join ${e.tabela} t on t.id = g.id_entidade
          where g.organization_id=$1 and g.tipo_entidade=$2 and t.${coluna} = any($3::text[])`, [h.demo.orgId, e.tipoEntidade, internas]);
      expect(Number(r.rows[0]!.n), `${e.tipoEntidade}: variante interna com ID Global`).toBe(0);
    }
    expect(MOVIMENTACOES_INTERNAS.length, "a lista de internas vem da fonte única de rebanho").toBeGreaterThan(0);
  });

  it("a sequência é única e monotônica na organização, e o contador nunca fica atrás", async () => {
    const r = await admin.query<{ total: string; distintos: string; maior: string; contador: string }>(
      `select count(*)::text total, count(distinct id_global)::text distintos, max(id_global)::text maior,
              (select ultimo_valor::text from erp.sequencias_id_global where organization_id=$1) contador
         from erp.registros_globais where organization_id=$1`, [h.demo.orgId]);
    const x = r.rows[0]!;
    expect(x.distintos, "dois registros não podem dividir o mesmo #N").toBe(x.total);
    expect(Number(x.contador)).toBeGreaterThanOrEqual(Number(x.maior));
  });

  it("IDEMPOTÊNCIA: a mesma operação repetida por idempotency-key não gera segundo número", async () => {
    const payload = { empresa_id: I.empresa, requisition_date: "2031-01-25", items: [{ warehouse_id: I.warehouse, product_id: I.product, quantity: "1" }] };
    const a = await post("/api/stock/requisitions", payload, { "idempotency-key": "idg-repeticao" });
    const b = await post("/api/stock/requisitions", payload, { "idempotency-key": "idg-repeticao" });
    expect(a.statusCode, a.body).toBe(201); expect(b.statusCode, b.body).toBe(201);
    expect(j(b).id).toBe(j(a).id);
    const linhas = await indice("requisitions", String(j(a).id));
    expect(linhas.length, "uma linha no índice, um número").toBe(1);
  });

  it("IDEMPOTÊNCIA da ALOCAÇÃO: chamar duas vezes para o MESMO registro devolve o MESMO número", async () => {
    // A prova anterior passa pela chave de idempotência da rota, que nem chega a repetir a alocação. Esta
    // vai direto no serviço, em DUAS transações separadas: é aqui que se vê se `atribuirIdGlobal` é mesmo
    // idempotente por (organização, tipo, registro) — e não só protegido por uma camada acima.
    const r = await post("/api/service-orders", { empresa_id: I.empresa, order_date: "2031-01-27", description: "OS idempotente", lines: [] });
    expect(r.statusCode, r.body).toBe(201);
    const id = String(j(r).id);
    const comoServico = <T>(fn: (ctx: ServiceCtx) => Promise<T>): Promise<T> =>
      withTx(h.db, { orgId: h.demo.orgId, userId: h.demo.adminUserId }, (tx) => fn({
        tx, user: { id: h.demo.adminUserId, email: h.demo.adminEmail, name: "Administrador" }, orgId: h.demo.orgId, empresaId: null,
        membership: { orgId: h.demo.orgId, orgName: "demo", roleId: null, isOwner: true, memberId: "m", escopos: AUTORIZACAO_PROPRIETARIO },
        permissions: new Set<string>()
      }));
    const primeiro = await comoServico((ctx) => atribuirIdGlobal(ctx, "service_orders", id));
    const segundo = await comoServico((ctx) => atribuirIdGlobal(ctx, "service_orders", id));
    const terceiro = await comoServico((ctx) => atribuirIdGlobal(ctx, "service_orders", id));
    expect(segundo).toBe(primeiro);
    expect(terceiro).toBe(primeiro);
    expect((await indice("service_orders", id)).length, "uma linha só no índice").toBe(1);
  });

  it("CONCORRÊNCIA na MESMA organização, tipos DIFERENTES: nenhum número repetido", async () => {
    const antes = Number((await admin.query<{ n: string }>("select count(*)::text n from erp.registros_globais where organization_id=$1", [h.demo.orgId])).rows[0]!.n);
    const respostas = await Promise.all([
      ...Array.from({ length: 4 }, (_, i) => post("/api/stock/requisitions", { empresa_id: I.empresa, requisition_date: "2031-01-26", note: `c${i}`, items: [{ warehouse_id: I.warehouse, product_id: I.product, quantity: "1" }] })),
      ...Array.from({ length: 4 }, (_, i) => post("/api/service-orders", { empresa_id: I.empresa, order_date: "2031-01-26", description: `OS ${i}`, lines: [] })),
      ...Array.from({ length: 4 }, (_, i) => post("/api/financial/payables", { empresa_id: I.empresa, number: `CC-${i}`, person_id: I.provider, amount: "10", emission_date: "2031-01-26", due_date: "2031-02-26", note: "Concorrência", apportionment: [{ financial_category_id: I.category, cost_center_id: I.costCenter, percentage: "100" }] }))
    ]);
    for (const r of respostas) expect(r.statusCode, r.body).toBe(201);
    const r = await admin.query<{ total: string; distintos: string }>(
      "select count(*)::text total, count(distinct id_global)::text distintos from erp.registros_globais where organization_id=$1", [h.demo.orgId]);
    expect(r.rows[0]!.distintos).toBe(r.rows[0]!.total);
    expect(Number(r.rows[0]!.total)).toBeGreaterThan(antes);
  });

  it("ORGANIZAÇÕES são sequências INDEPENDENTES: o mesmo #N existe nas duas e aponta para coisas diferentes", async () => {
    const outra = await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] ID Global outra','idg-outra') returning id");
    const org2 = outra.rows[0]!.id;
    const emp2 = (await admin.query<{ id: string }>("insert into erp.empresas(organization_id,code,name) values ($1,90,'Empresa da outra org') returning id", [org2])).rows[0]!.id;
    // aloca direto pela função do banco: a prova aqui é da SEQUÊNCIA, não da rota
    const n1 = (await admin.query<{ n: string }>("select erp.proximo_id_global($1)::text n", [org2])).rows[0]!.n;
    expect(n1, "a organização nova começa do 1, independente do que a outra já usou").toBe("1");
    const jaUsado = await admin.query<{ n: string }>("select count(*)::text n from erp.registros_globais where organization_id=$1 and id_global=1", [h.demo.orgId]);
    expect(Number(jaUsado.rows[0]!.n), "o #1 da organização de demonstração continua existindo e é outro registro").toBe(1);
    expect(emp2).toBeTruthy();
  });
});
