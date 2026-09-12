import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "@agro/db";
import { ENTIDADES_ID_GLOBAL } from "@agro/domain";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * EXISTÊNCIA FUNCIONAL DAS ENTIDADES COM ID GLOBAL (docs/GLOBAL-ID-CONTRACT.md §5.1).
 *
 * O resolvedor de `#N` esconde registro com exclusão lógica marcada. A rota OFICIAL de detalhe tem de
 * enxergar exatamente a mesma existência — senão o registro vira fantasma: some da lista e do ID Global,
 * mas continua abrindo por URL direta. Este teste é a catraca: cria o registro, confirma 200, marca
 * `deleted_at` e exige 404 na rota canônica.
 *
 * Cancelado NÃO é excluído e não é testado aqui (é coberto em rebanho-autorizacao.test.ts).
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string } };

const criar = async (url: string, payload: Record<string, unknown>): Promise<string> => {
  const r = await h.app.inject({ method: "POST", url, headers: h.headers(), payload });
  expect(r.statusCode, `${url}: ${r.body}`).toBe(201);
  return j(r).id as string;
};
const excluir = async (tabela: string, id: string) => {
  const admin = createPool(TEST_URL, { max: 1 });
  try { await admin.query(`update ${tabela} set deleted_at=now() where id=$1`, [id]); } finally { await admin.end(); }
};

beforeAll(async () => { h = await harness(); I = await ids(h); }, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("rota canônica e ID Global concordam sobre exclusão lógica", () => {
  /** Um caso por família de porta de detalhe da API (o helper compartilhado cobre os documentos de estoque). */
  const casos: { tipo: string; tabela: string; detalhe: (id: string) => string; criar: () => Promise<string> }[] = [
    {
      tipo: "input_entries", tabela: "erp.input_entries", detalhe: (id) => `/api/stock/input-entries/${id}`,
      criar: () => criar("/api/stock/input-entries", { farm_id: I.farm, entry_date: "2026-09-04", items: [{ product_id: I.product, quantity: "2", unit_value: "3", warehouse_id: I.warehouse }] })
    },
    {
      tipo: "warehouse_transfers", tabela: "erp.warehouse_transfers", detalhe: (id) => `/api/stock/transfers/${id}`,
      criar: () => criar("/api/stock/transfers", { kind: "warehouse", transfer_date: "2026-09-04", origin_farm_id: I.farm, origin_warehouse_id: I.warehouse, destination_warehouse_id: I.warehouse2, items: [{ product_id: I.product, quantity: "1" }] })
    },
    {
      tipo: "maintenances", tabela: "erp.maintenances", detalhe: (id) => `/api/fleet/maintenances/${id}`,
      criar: () => criar("/api/fleet/maintenances", { farm_id: I.farm, maintenance_date: "2026-09-04", machines: [{ equipment_id: I.equipment, services: [{ description: "Existência funcional", quantity: "1" }] }] })
    },
    {
      tipo: "service_orders", tabela: "erp.service_orders", detalhe: (id) => `/api/service-orders/${id}`,
      criar: () => criar("/api/service-orders", { farm_id: I.farm, order_date: "2026-09-04", description: "Existência funcional" })
    }
  ];

  it.each(casos)("$tipo: 200 antes da exclusão, 404 depois (mesma existência do ID Global)", async (c) => {
    const id = await c.criar();
    const antes = await h.app.inject({ method: "GET", url: c.detalhe(id), headers: h.headers() });
    expect(antes.statusCode, `${c.tipo} antes: ${antes.body}`).toBe(200);

    await excluir(c.tabela, id);

    const depois = await h.app.inject({ method: "GET", url: c.detalhe(id), headers: h.headers() });
    expect(depois.statusCode, `${c.tipo} depois da exclusão lógica: ${depois.body}`).toBe(404);
    expect(j(depois).error?.code, c.tipo).toBe("NOT_FOUND");
  });

  it("o catálogo declara exclusão lógica para todas as entidades testadas aqui", () => {
    for (const c of casos) {
      const e = ENTIDADES_ID_GLOBAL.find((x) => x.tipoEntidade === c.tipo);
      expect(e, c.tipo).toBeTruthy();
      expect(e!.exclusaoLogica, c.tipo).toBe(true);
    }
  });
});
