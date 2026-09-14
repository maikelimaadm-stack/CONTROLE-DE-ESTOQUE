import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guardrail estrutural (docs/AUTHORIZATION.md): todo handler que consulta uma tabela com `empresa_id` precisa passar por um
 * dos mecanismos de escopo de fazenda (helpers de `lib/context.ts` ou um carregador compartilhado já protegido).
 * `ctx.empresaId` sozinho NÃO é autorização. A verificação é por handler (trecho entre dois `app.<método>(`), determinística
 * e sem regex sobre SQL: só procura marcadores conhecidos. Handlers organization-scoped legítimos ficam na lista abaixo,
 * com o motivo — para adicionar um novo handler com escopo de empresa sem escopo é preciso justificar aqui, não silenciar o teste.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.join(here, "../../src/routes");
/** Tabelas de erp.* com coluna empresa_id (fonte: information_schema no banco de testes — manter em sincronia ao migrar). */
const FARM_TABLES = ["animal_handlings", "animal_movements", "animal_retroactive_costs", "animals", "areas", "bank_movements", "batches", "breeding_seasons", "budget_plannings", "contracts", "devolutions", "dfe_documents", "diet_batches", "documents", "earnings", "equipments", "feed_batches", "feed_deliveries", "feedlot_yards", "financial_freezes", "financial_titles", "fuel_supplies", "grazing_modules", "herd_lots", "input_entries", "invoices", "journal_entries", "livestock_plannings", "maintenances", "opening_balances", "processings", "purchase_requests", "rainfalls", "requisitions", "salary_advances", "sales_documents", "service_orders", "stock_corrections", "stock_movements", "stock_writeoffs", "trough_readings", "warehouses", "weighings"];
/** Marcadores que comprovam escopo de fazenda (helpers) ou uso de carregador compartilhado já protegido. */
// Marcadores de ESCOPO ainda vivos no código. Os nomes anteriores (`farmScope(`, `assertFarmVisible(`,
// `farmAllowed(`, `farms(ctx`) saíram em PRE-BASE2-05B junto com a nomenclatura de plataforma antiga — eles
// não casavam com nada havia tempo, e um marcador que nunca casa dá a impressão de cobrir sem cobrir.
const SCOPE_MARKERS = ["scopedById(", "empresaScope", "{{escopo", "consultaEscopada(", "exigirEmpresaVisivel(", "exigirEmpresaDeLancamento(", "empresaPermitida(", "empresasDisponiveis(", "selecionarEmpresaParaLancamento(", "clausulaEmpresa(", "loadForWrite(", "listDocs(", "getDoc(", "getTitle(", "loadRequest(", "listResource(", "getOne(", "listTitles(", "exigirEmpresa(", "settle(ctx", "createTitles(", "createBankMovement(", "transition(ctx", "authorizeAttachmentParent("];
/** Handlers organization-scoped por desenho (não filtram por fazenda) — cada um com a razão. */
const ALLOW: Record<string, string> = {
  "financial.ts:/financial/bank-accounts/balances": "contas bancárias são da organização (o vínculo por empresa é informativo)",
  "financial.ts:/financial/cash-flow": "fluxo por conta bancária (organização); movimentos sem fazenda",
  "financial.ts:/financial/ofx-imports": "importação OFX por conta bancária (organização)",
  "financial.ts:/financial/ofx-imports/:id": "idem",
  "financial.ts:/financial/ofx-imports/:id/transactions/:tid/match": "conciliação por conta bancária; movimento criado herda a fazenda selecionada (validada no contexto)",
  "financial.ts:/financial/ofx-report": "agregado por conta bancária",
  "financial.ts:/financial/opening-movements": "saldo inicial de conta bancária; fazenda = selecionada (validada no contexto)",
  "financial.ts:/financial/budget-plannings/:id/values": "planejamento com empresa_id opcional — escopo aplicado via scopedById (nullable)",
  "stock.ts:/stock/feed-formulas": "formulações são da organização (sem empresa_id)",
  "stock.ts:/stock/feed-formulas/:id": "idem",
  "livestock.ts:/livestock/matings": "escopo pela empresa da matriz (subconsulta em erp.animals com escopo de empresa)",
  "livestock.ts:/livestock/matings/:id/diagnosis": "escrita sobre acasalamento (organização); matriz validada na criação",
  "livestock.ts:/livestock/reproduction/overview": "estações de monta filtradas pelo escopo de empresa em SQL",
  "dashboards.ts:/dashboards/user-analysis": "auditoria de usuários (organização)",
  "admin.ts:/admin/notifications/refresh": "gera avisos genéricos da organização (contagens, sem id nem valores de registro); notificação de registro nasce no próprio serviço protegido",
  "admin.ts:/admin/members": "administração de membros (users.view) — o acesso por empresa é o próprio cadastro sendo editado",
  "admin.ts:/admin/members/:userId": "idem",
  "resources.ts:/resources/:key/distinct": "distinctValues aplica o escopo de empresa internamente",
  "resources.ts:/resources/:key/options": "options aplica o escopo do recurso apontado (comPermissaoResolvida)",
  // O aceite da transferência de rebanho não decide escopo no handler porque o handler NÃO é a
  // autoridade: quem confere capacidade, empresa de destino, itens vinculados e row counts é
  // `erp.processar_transferencia_pecuaria_destino`, dentro da transação. Marcar escopo aqui seria
  // decorar a rota com uma verificação que não é a que decide.
  "livestock.ts:/livestock/transfers/:id/process": "autoridade dentro de erp.processar_transferencia_pecuaria_destino (capacidade + escopo do destino + row counts)",
  "resources.ts:/resources/:key": "listResource / createOne aplicam escopo internamente",
  "resources.ts:/resources/:key/:id": "getOne / updateOne / deleteOne aplicam escopo internamente",
  "reports.ts:/reports/:key": "cada relatório usa clausulaEmpresa (membership + empresa)",
  "reports.ts:/exports/:resource": "usa listResource",
  "saved-reports.ts:/saved-reports/run": "usa listResource"
};

function handlers(file: string): { url: string; body: string }[] {
  const src = fs.readFileSync(path.join(routesDir, file), "utf8");
  const starts = [...src.matchAll(/\n\s*app\.(get|post|put|patch|delete)\(/g)].map((m) => m.index!);
  starts.push(src.length);
  const out: { url: string; body: string }[] = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const body = src.slice(starts[i], starts[i + 1]);
    const m = /app\.(?:get|post|put|patch|delete)\((?:"([^"]+)"|`([^`]+)`|(\w+))/.exec(body);
    if (m) out.push({ url: m[1] ?? m[2] ?? m[3]!, body });
  }
  return out;
}

describe("guardrail: handlers que tocam tabelas com empresa_id passam por escopo de fazenda", () => {
  it("nenhum handler com escopo de empresa depende apenas de organization_id/ctx.empresaId", () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith(".ts"))) {
      for (const h of handlers(file)) {
        const touches = FARM_TABLES.filter((t) => h.body.includes(`erp.${t} `) || h.body.includes(`erp.${t}(`) || h.body.includes(`erp.${t}\n`));
        if (!touches.length) continue;
        if (SCOPE_MARKERS.some((k) => h.body.includes(k))) continue;
        const key = `${file}:${h.url}`; if (ALLOW[key]) continue;
        // `ctx.empresaId` isolado é o padrão inseguro que este teste existe para barrar
        offenders.push(`${key} → tabelas ${touches.join(", ")}${h.body.includes("ctx.empresaId") ? " (usa só ctx.empresaId)" : ""}`);
      }
    }
    expect(offenders, "handlers sem escopo de fazenda:\n" + offenders.join("\n")).toEqual([]);
  });
  it("a lista de exceções só contém handlers que existem (evita exceções órfãs)", () => {
    const existing = new Set<string>();
    for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith(".ts"))) for (const h of handlers(file)) existing.add(`${file}:${h.url}`);
    const orphan = Object.keys(ALLOW).filter((k) => !existing.has(k));
    expect(orphan).toEqual([]);
  });
});
