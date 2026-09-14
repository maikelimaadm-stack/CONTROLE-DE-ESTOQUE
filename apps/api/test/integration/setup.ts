import { createPool, migrate, resetSchema, seedReference, seedDemo, type Db, type DemoOrg } from "@agro/db";
import { CHAVES_MODULO_EMPRESA } from "@agro/domain";
import { buildApp } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";
import type { FastifyInstance } from "fastify";

export const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_test";
export interface Harness { app: FastifyInstance; db: Db; demo: DemoOrg; token: string; opToken: string; headers: (extra?: Record<string, string>) => Record<string, string>; opHeaders: () => Record<string, string> }

export async function harness(): Promise<Harness> {
  const admin = createPool(TEST_URL, { max: 3 });
  await resetSchema(admin); await migrate(admin, () => {}); await seedReference(admin, () => {});
  const demo = await seedDemo(admin, {}, () => {});
  await admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  await admin.end();
  // A API conecta como erp_app (sem bypass de RLS), como em produção. Os limites de requisição/login são
  // afrouxados só no harness (a suíte cria vários usuários e faz login com cada um), como no harness e2e.
  const db = createPool(process.env.TEST_DATABASE_URL_APP ?? "postgresql://erp_app_test:erp_app_test@127.0.0.1:5433/agro_erp_test", { max: 8 });
  const config = loadConfig({ ...process.env, DATABASE_URL: TEST_URL, AUTH_MODE: "local", LOCAL_AUTH_SECRET: "test-secret-please", NODE_ENV: "test", RATE_LIMIT_MAX: "10000", LOGIN_RATE_LIMIT_MAX: "1000" });
  const app = await buildApp({ config, db, logger: process.env.TEST_LOG ? true : false });
  const login = async (email: string, password: string) => { const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } }); if (r.statusCode !== 200) throw new Error("login failed: " + r.body); return (r.json() as { token: string }).token; };
  const token = await login(demo.adminEmail, demo.adminPassword);
  const opToken = await login("operador@demo.local", "Demo@12345");
  const headers = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, "x-org-id": demo.orgId, ...extra });
  const opHeaders = () => ({ authorization: `Bearer ${opToken}`, "x-org-id": demo.orgId });
  return { app, db, demo, token, opToken, headers, opHeaders };
}
/**
 * Acesso por empresa em forma CANÔNICA para as suítes de segurança (PRE-BASE2-05B).
 *
 * Antes elas enviavam a lista achatada do contrato administrativo anterior, em que "lista vazia" queria
 * dizer "todas as empresas, em todos os módulos". Esse formato saiu da API; o que ele exprimia continua
 * sendo exprimível — por MÓDULO, que é como a autorização realmente funciona desde PRE-BASE2-02. O helper
 * escreve essa mesma intenção sem inventar semântica nova, e deixa visível o que antes ficava implícito.
 */
export const escoposDeTodosOsModulos = (empresas: readonly string[]) =>
  CHAVES_MODULO_EMPRESA.map((modulo) => empresas.length
    ? { modulo, modo: "selecionadas" as const, empresas: [...empresas] }
    : { modulo, modo: "todas" as const, empresas: [] });

export async function ids(h: Harness) {
  const c = createPool(TEST_URL, { max: 1 });
  const one = async (sql: string) => (await c.query(sql, [h.demo.orgId])).rows[0] as Record<string, string>;
  const out = {
    empresa: h.demo.empresaIds[0]!,
    empresa2: h.demo.empresaIds[1]!,
    warehouse: (await one("select id from erp.warehouses where organization_id=$1 and empresa_id=(select id from erp.empresas where organization_id=$1 order by code limit 1) and initials='ALM'")).id,
    warehouse2: (await one("select id from erp.warehouses where organization_id=$1 and empresa_id=(select id from erp.empresas where organization_id=$1 order by code limit 1) and initials='SILO'")).id,
    warehouseEmpresa2: (await one("select id from erp.warehouses where organization_id=$1 and empresa_id=(select id from erp.empresas where organization_id=$1 order by code desc limit 1) and initials='ALM'")).id,
    product: (await one("select id from erp.products where organization_id=$1 and description like 'Sal Mineral%'")).id,
    product2: (await one("select id from erp.products where organization_id=$1 and description like 'Ração%'")).id,
    productLot: (await one("select id from erp.products where organization_id=$1 and description like 'Vacina%'")).id,
    provider: (await one("select id from erp.people where organization_id=$1 and is_provider order by code limit 1")).id,
    client: (await one("select id from erp.people where organization_id=$1 and is_client limit 1")).id,
    employee: (await one("select id from erp.people where organization_id=$1 and is_employee limit 1")).id,
    category: (await one("select id from erp.financial_categories where organization_id=$1 and nature='expense' and kind='analytic' order by code limit 1")).id,
    incomeCategory: (await one("select id from erp.financial_categories where organization_id=$1 and nature='income' and kind='analytic' order by code limit 1")).id,
    costCenter: (await one("select id from erp.cost_centers where organization_id=$1 and kind='analytic' order by code limit 1")).id,
    bankAccount: (await one("select id from erp.bank_accounts where organization_id=$1 and code='BB'")).id,
    cashAccount: (await one("select id from erp.bank_accounts where organization_id=$1 and code='CXF'")).id,
    equipment: (await one("select id from erp.equipments where organization_id=$1 order by code limit 1")).id,
    batch: (await one("select id from erp.batches where organization_id=$1 order by code limit 1")).id,
    animal: (await one("select a.id from erp.animals a where a.organization_id=$1 and a.sex='M' order by a.created_at limit 1")).id,
    speciesCategory: (await one("select id from erp.animal_categories where name='Garrote' and $1::uuid is not null")).id,
    idType: (await one("select id from erp.identification_types where name='Brinco de Manejo' and $1::uuid is not null")).id
  };
  await c.end();
  return out;
}
