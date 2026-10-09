import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * Mapa de Manejo — cabeças por área: animais identificados + rebanho por contagem nos lotes da área.
 */
describe("Mapa de Manejo — cabeças por área", () => {
  let h: Harness;
  let admin: pg.Client;

  beforeAll(async () => {
    h = await harness();
    admin = new pg.Client({ connectionString: TEST_URL });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
    await h?.app.close();
    await h?.db.end();
  });

  it("soma identificados e por contagem por area_id, respeitando escopo de empresa", async () => {
    const org = h.demo.orgId;
    const empA = h.demo.empresaIds[0]!;
    const empB = h.demo.empresaIds[1]!;
    const species = (await admin.query<{ id: string }>("select id from erp.animal_species where organization_id is null limit 1")).rows[0]!.id;
    const cat = (await admin.query<{ id: string }>("select id from erp.animal_categories where species_id=$1 limit 1", [species])).rows[0]!.id;
    const breed = (await admin.query<{ id: string }>("select id from erp.breeds where organization_id is null limit 1")).rows[0]!.id;

    const areaA = (await admin.query<{ id: string }>(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
       values ($1,$2,'T-MA','Área teste A',10,10,'pastagem','ativa','propria','{"type":"Polygon","coordinates":[[[-55,-15],[-55,-15.01],[-54.99,-15.01],[-54.99,-15],[-55,-15]]]}'::jsonb) returning id`,
      [org, empA]
    )).rows[0]!.id;
    const areaB = (await admin.query<{ id: string }>(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
       values ($1,$2,'T-MB','Área teste B',8,8,'pastagem','ativa','propria','{"type":"Polygon","coordinates":[[[-54,-14],[-54,-14.01],[-53.99,-14.01],[-53.99,-14],[-54,-14]]]}'::jsonb) returning id`,
      [org, empB]
    )).rows[0]!.id;

    const batchA = (await admin.query<{ id: string }>(
      `insert into erp.batches (organization_id, empresa_id, code, batch_date, description, species_id, batch_type, area_id, entry_date, status)
       values ($1,$2,'TB-A',current_date,'Lote A',$3,'pasture',$4,current_date,'active') returning id`,
      [org, empA, species, areaA]
    )).rows[0]!.id;
    await admin.query(
      `insert into erp.batches (organization_id, empresa_id, code, batch_date, description, species_id, batch_type, area_id, entry_date, status)
       values ($1,$2,'TB-B',current_date,'Lote B',$3,'pasture',$4,current_date,'active')`,
      [org, empB, species, areaB]
    );

    await admin.query(
      `insert into erp.animals (organization_id, empresa_id, species_id, category_id, breed_id, batch_id, sex, entry_date, current_weight, entry_weight, status)
       values ($1,$2,$3,$4,$5,$6,'M',current_date,200,200,'active'), ($1,$2,$3,$4,$5,$6,'M',current_date,210,210,'active')`,
      [org, empA, species, cat, breed, batchA]
    );
    await admin.query(
      `insert into erp.herd_lots (organization_id, empresa_id, batch_id, species_id, category_id, breed_id, quantity, entry_date)
       values ($1,$2,$3,$4,$5,$6,12,current_date)`,
      [org, empA, batchA, species, cat, breed]
    );

    const rA = await h.app.inject({
      method: "GET",
      url: "/api/mapa/areas/cabecas-por-area",
      headers: h.headers({ "x-empresa-id": empA })
    });
    expect(rA.statusCode, rA.body).toBe(200);
    const itemsA = (rA.json() as { items: { area_id: string; cabecas: number }[] }).items;
    const linhaA = itemsA.find((i) => i.area_id === areaA);
    expect(linhaA?.cabecas).toBe(14);

    const rB = await h.app.inject({
      method: "GET",
      url: "/api/mapa/areas/cabecas-por-area",
      headers: h.headers({ "x-empresa-id": empB })
    });
    const itemsB = (rB.json() as { items: { area_id: string; cabecas: number }[] }).items;
    expect(itemsB.some((i) => i.area_id === areaA)).toBe(false);
    expect(itemsB.find((i) => i.area_id === areaB)?.cabecas ?? 0).toBe(0);
  });
});
