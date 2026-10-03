import { expect } from "vitest";
import {
  CHAVES_MODULO_EMPRESA, SEGMENTO_DO_MODULO_COM_TOP, familiaDoModuloComTop,
  type ConfiguracaoTipoOperacaoV5, type ModuloComTop,
} from "@agro/domain";
import { c, top, j, unico, type Hdr, type Resposta } from "./estoque-01-ajuda.js";
import { cfg5 } from "./f5a-ajuda.js";

export {
  c, iniciar, encerrar, produto, armazem, saldoInicial, saldo, membro, recusadoNoCampo, j, unico, DATA, type Hdr, type Resposta,
} from "./estoque-01-ajuda.js";
export { cfg5, centroNovo, safraNova, equipamentoNovo, erro, forma, detalhes } from "./f5a-ajuda.js";

/**
 * OPERACOES-01 F10 (decisão 287) — O CENÁRIO DOS TESTES DE INTEGRAÇÃO DA FROTA (abastecimento, manutenção e OS).
 *
 * Em cima do cenário do ESTOQUE-01 (`estoque-01-ajuda.ts`: o harness com o banco recriado, a instância `ligada` por
 * onde as TOPs nascem, os ids do seed conferidos, os produtos e locais de estoque novos por caso, o saldo inicial pela
 * API, as pessoas) e dos cadastros do destino da F5a (`f5a-ajuda.ts`: centro, safra e equipamento novos por caso, o
 * neutro do formato 5), este arquivo acrescenta:
 *   · a TOP do MÓDULO — a família PERGUNTADA ao registry (`familiaDoModuloComTop`), nunca escrita aqui;
 *   · as portas dos três módulos (capacidade, lançar, ler, editar, cancelar, mudar a situação da OS);
 *   · as testemunhas no banco (conexão própria de superusuário, sem RLS): o registro com as colunas da TOP, o razão
 *     com as colunas de destino, o contador do bem, a trilha de auditoria e o contador de código (a recusa não queima
 *     número).
 * O estado é do módulo (o vitest isola os módulos por arquivo), preenchido pelo `iniciar()` do ESTOQUE-01.
 */

// ─────────────── a TOP do módulo ───────────────

/** A família da TOP do módulo, perguntada ao registry. Módulo sem família não tem TOP: o caso para aqui. */
export function familiaDo(modulo: ModuloComTop): string {
  const f = familiaDoModuloComTop(modulo);
  expect(f, `premissa: o registry declara a família do módulo ${modulo}`).toEqual(expect.any(String));
  return f!;
}
/** Uma TOP da família do módulo pela porta administrativa. `extra` aceita `nome`, `ativo`, `padrao`, `configuracao`. */
export const topDoModulo = (modulo: ModuloComTop, extra: Record<string, unknown> = {}): Promise<string> => top(familiaDo(modulo), extra);
/** Uma TOP da família do módulo no FORMATO 5 (o neutro do domínio com o ajuste do caso). */
export const topV5DoModulo = (modulo: ModuloComTop, ajuste?: (x: ConfiguracaoTipoOperacaoV5) => void, extra: Record<string, unknown> = {}): Promise<string> =>
  top(familiaDo(modulo), { configuracao: cfg5(ajuste), ...extra });

/** A revisão atual da TOP (a otimista do PUT e do DELETE administrativos). */
async function revisaoDaTop(topId: string): Promise<number> {
  const d = await c.ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${topId}`, headers: c.h.headers() });
  expect(d.statusCode, d.body).toBe(200);
  return j(d).revisao as number;
}
/** Grava uma configuração NOVA na TOP (nasce a versão seguinte, que vira a corrente). Devolve o número da versão. */
export async function novaVersaoDaTop(topId: string, configuracao: unknown): Promise<number> {
  const r = await c.ligada.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${topId}`, headers: c.h.headers(),
    payload: { revisao: await revisaoDaTop(topId), configuracao } });
  expect(r.statusCode, `premissa: a versão nova da TOP é gravada — ${r.body}`).toBe(200);
  return j(r).versao as number;
}
/** Exclui a TOP pela porta administrativa (exclusão lógica). */
export async function excluirTop(topId: string): Promise<void> {
  const r = await c.ligada.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${topId}?revisao=${await revisaoDaTop(topId)}`, headers: c.h.headers() });
  expect(r.statusCode, `premissa: a TOP é excluída — ${r.body}`).toBe(200);
}
/** A versão CORRENTE da TOP como o banco a guarda. */
export async function versaoCorrente(topId: string): Promise<{ id: string; versao: number; nome: string }> {
  const r = await c.admin.query<{ id: string; versao: number; nome: string }>(
    `select v.id, v.versao, v.nome from erp.tipos_operacao_versoes v
       join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao where t.id = $1`, [topId]);
  expect(r.rows, "premissa: a TOP tem versão corrente").toHaveLength(1);
  return r.rows[0]!;
}

// ─────────────── as portas dos três módulos ───────────────

/** A capacidade `topNoModulo` do módulo: GET `/api/modulos/<segmento>/operation-types` (o segmento é do domínio). */
export const tiposDoModulo = (modulo: ModuloComTop, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "GET", url: `/api/modulos/${SEGMENTO_DO_MODULO_COM_TOP[modulo]}/operation-types`, headers });

const comChave = (headers: Hdr, chave?: string): Hdr => (chave ? { ...headers, "idempotency-key": chave } : headers);
const enviar = (method: "POST" | "PUT", url: string, payload: unknown, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.h.app.inject({ method, url, headers: comChave(headers, chave), payload: payload as Record<string, unknown> });
const ler = (url: string, headers: Hdr = c.h.headers()): Promise<Resposta> => c.h.app.inject({ method: "GET", url, headers });

export const abastecer = (corpo: Record<string, unknown>, headers?: Hdr, chave?: string) => enviar("POST", "/api/fleet/fuel-supplies", corpo, headers, chave);
export const lerAbastecimento = (id: string, headers?: Hdr) => ler(`/api/fleet/fuel-supplies/${id}`, headers);
export const cancelarAbastecimento = (id: string) => enviar("POST", `/api/fleet/fuel-supplies/${id}/cancel`, {});
export const manter = (corpo: Record<string, unknown>, headers?: Hdr, chave?: string) => enviar("POST", "/api/fleet/maintenances", corpo, headers, chave);
export const lerManutencao = (id: string, headers?: Hdr) => ler(`/api/fleet/maintenances/${id}`, headers);
export const cancelarManutencao = (id: string) => enviar("POST", `/api/fleet/maintenances/${id}/cancel`, {});
export const abrirOs = (corpo: Record<string, unknown>, headers?: Hdr, chave?: string) => enviar("POST", "/api/service-orders", corpo, headers, chave);
export const editarOs = (id: string, corpo: unknown, headers?: Hdr) => enviar("PUT", `/api/service-orders/${id}`, corpo, headers);
export const lerOs = (id: string, headers?: Hdr) => ler(`/api/service-orders/${id}`, headers);
export async function situacaoDaOs(id: string, status: "in_progress" | "finished" | "cancelled"): Promise<void> {
  const r = await enviar("POST", `/api/service-orders/${id}/status`, { status });
  expect(r.statusCode, `premissa: a OS passa a ${status} — ${r.body}`).toBe(200);
}

/** O POST que tem de gravar: 201 e o corpo. */
export async function criado(r: Resposta | Promise<Resposta>): Promise<Record<string, unknown> & { id: string }> {
  const x = await r;
  expect(x.statusCode, `premissa: o lançamento grava — ${x.body}`).toBe(201);
  return j(x) as Record<string, unknown> & { id: string };
}

/** As exigências de um 422 `TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA` (`details.exigencias`). */
export function exigencias(r: Resposta): unknown {
  const d = j(r).error?.details as { exigencias?: unknown } | undefined;
  return d?.exigencias;
}

// ─────────────── pessoas ───────────────

export type Escopo = { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] };
/** Todos os módulos com todas as empresas — e os módulos dados só com as empresas dadas. */
export function escoposCom(selecionados: Partial<Record<string, string[]>>): Escopo[] {
  return CHAVES_MODULO_EMPRESA.map((modulo) => {
    const empresas = selecionados[modulo];
    return empresas ? { modulo, modo: "selecionadas" as const, empresas: [...empresas] } : { modulo, modo: "todas" as const, empresas: [] };
  });
}

// ─────────────── cadastros por SQL (superusuário) ───────────────

/** Um equipamento de OUTRA organização (a organização e a empresa nascem aqui). */
export async function equipamentoDeOutraOrganizacao(): Promise<string> {
  const s = unico();
  const org = (await c.admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ($1, $2) returning id", [`[TEST] F10 outra ${s}`, `f10-outra-${s}`])).rows[0]!.id;
  const empresa = (await c.admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 1, $2) returning id", [org, `Empresa F10 ${s}`])).rows[0]!.id;
  return (await c.admin.query<{ id: string }>("insert into erp.equipments (organization_id, empresa_id, code, description) values ($1,$2,$3,$4) returning id",
    [org, empresa, `F10X${s}`, `Trator de outra organização ${s}`])).rows[0]!.id;
}
/** Exclui (logicamente) o equipamento. */
export async function excluirEquipamento(id: string): Promise<void> {
  const u = await c.admin.query("update erp.equipments set deleted_at = now() where id = $1", [id]);
  expect(u.rowCount, "premissa: o equipamento foi excluído").toBe(1);
}
/** Um plano de manutenção preventiva ATIVO do equipamento. */
export async function preventiva(equipamentoId: string, gatilho: "hours" | "km" | "days", intervalo = "500"): Promise<string> {
  return (await c.admin.query<{ id: string }>(
    "insert into erp.preventive_maintenances (organization_id, equipment_id, description, trigger_type, interval_value) values ($1,$2,$3,$4,$5) returning id",
    [c.h.demo.orgId, equipamentoId, `Revisão F10 ${unico()}`, gatilho, intervalo])).rows[0]!.id;
}

// ─────────────── testemunhas no banco (superusuário, sem RLS) ───────────────

export interface RegistroComTop { tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null; status: string; code: string }
export async function abastecimentoNoBanco(id: string): Promise<RegistroComTop & { total: string; unit_value: string; equipment_id: string; note: string | null }> {
  return (await c.admin.query<RegistroComTop & { total: string; unit_value: string; equipment_id: string; note: string | null }>(
    "select tipo_operacao_id, tipo_operacao_versao_id, status, code, total::text, unit_value::text, equipment_id, note from erp.fuel_supplies where id = $1", [id])).rows[0]!;
}
export async function manutencaoNoBanco(id: string): Promise<RegistroComTop & { note: string | null; total_parts: string; total_services: string }> {
  return (await c.admin.query<RegistroComTop & { note: string | null; total_parts: string; total_services: string }>(
    "select tipo_operacao_id, tipo_operacao_versao_id, status, code, note, total_parts::text, total_services::text from erp.maintenances where id = $1", [id])).rows[0]!;
}
export interface OsNoBanco extends RegistroComTop { description: string | null; cost_center_id: string | null; harvest_id: string | null; order_date: string; total: string }
export async function osNoBanco(id: string): Promise<OsNoBanco> {
  return (await c.admin.query<OsNoBanco>(
    "select tipo_operacao_id, tipo_operacao_versao_id, status, code, description, cost_center_id, harvest_id, to_char(order_date,'YYYY-MM-DD') as order_date, total::text from erp.service_orders where id = $1", [id])).rows[0]!;
}
/** Os itens da manutenção no banco, por máquina (equipamento) e produto. */
export async function itensDaManutencao(id: string): Promise<{ equipment_id: string; product_id: string; warehouse_id: string | null; quantity: string; unit_value: string; total: string }[]> {
  return (await c.admin.query<{ equipment_id: string; product_id: string; warehouse_id: string | null; quantity: string; unit_value: string; total: string }>(
    `select mm.equipment_id, i.product_id, i.warehouse_id, i.quantity::text, i.unit_value::text, i.total::text
       from erp.maintenance_items i join erp.maintenance_machines mm on mm.id = i.machine_id
      where mm.maintenance_id = $1 order by mm.equipment_id, i.product_id, i.quantity`, [id])).rows;
}

export interface MovimentoDaOrigem {
  movement_type: string; direction: number; quantity: string; unit_cost: string; valor: string; product_id: string; warehouse_id: string;
  provider_lot: string | null; cost_center_id: string | null; harvest_id: string | null; equipamento_id: string | null;
  ordem_servico_id: string | null; lote_animais_id: string | null; area_id: string | null;
}
/**
 * Os movimentos da origem no razão (estornos por último), com as colunas de destino. `valor` é a parte
 * (`round(quantidade × custo, 2)`). Dentro da mesma transação a ordem é FIXADA aqui (produto, lote, quantidade).
 */
export async function razaoDaOrigem(sourceType: "fuel_supplies" | "maintenances" | "service_orders", id: string): Promise<MovimentoDaOrigem[]> {
  return (await c.admin.query<MovimentoDaOrigem>(
    `select movement_type, direction, quantity::text, unit_cost::text, round(quantity * unit_cost, 2)::text as valor, product_id, warehouse_id,
            provider_lot, cost_center_id, harvest_id, equipamento_id, ordem_servico_id, lote_animais_id, area_id
       from erp.stock_movements where source_type = $1 and source_id = $2
      order by (movement_type = 'reversal'), product_id, provider_lot nulls first, quantity, id`, [sourceType, id])).rows;
}
/** Todos os movimentos do produto (qualquer origem): prova de que uma recusa não gravou nada. */
export async function movimentosDoProduto(produtoId: string): Promise<number> {
  return Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.stock_movements where product_id = $1", [produtoId])).rows[0]!.n);
}
/** Quantos abastecimentos citam o produto (prova de que a recusa não gravou linha). */
export async function abastecimentosDoProduto(produtoId: string): Promise<number> {
  return Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.fuel_supplies where product_id = $1", [produtoId])).rows[0]!.n);
}
/** Quantos registros da tabela a organização tem (manutenções e OS). */
export async function contar(tabela: "maintenances" | "service_orders"): Promise<number> {
  const sql = tabela === "maintenances"
    ? "select count(*)::text n from erp.maintenances where organization_id = $1"
    : "select count(*)::text n from erp.service_orders where organization_id = $1";
  return Number((await c.admin.query<{ n: string }>(sql, [c.h.demo.orgId])).rows[0]!.n);
}
/** O último código dado pelo contador da entidade (sem consumir nenhum): a recusa não queima número. */
export async function ultimoCodigo(entidade: "fuel_supply" | "maintenance" | "service_order"): Promise<number> {
  const r = await c.admin.query<{ n: string }>("select last_value::text n from erp.code_sequences where organization_id = $1 and entity = $2", [c.h.demo.orgId, entidade]);
  return Number(r.rows[0]?.n ?? "0");
}
/** O contador "Horímetro/Km" do bem e quando ele mudou. */
export async function contadorDoBem(equipamentoId: string): Promise<{ hour_meter: string | null; updated_at: string }> {
  return (await c.admin.query<{ hour_meter: string | null; updated_at: string }>(
    "select hour_meter::text, updated_at::text from erp.equipments where id = $1", [equipamentoId])).rows[0]!;
}
/** A preventiva como o banco a guarda. */
export async function preventivaNoBanco(id: string): Promise<{ last_done_date: string | null; last_done_value: string | null }> {
  return (await c.admin.query<{ last_done_date: string | null; last_done_value: string | null }>(
    "select to_char(last_done_date,'YYYY-MM-DD') as last_done_date, last_done_value::text from erp.preventive_maintenances where id = $1", [id])).rows[0]!;
}
/** As ações da trilha de auditoria do registro, na ordem em que aconteceram. */
export async function acoesAuditadas(entidade: "fuel_supplies" | "maintenances" | "service_orders", id: string): Promise<string[]> {
  return (await c.admin.query<{ action: string }>(
    "select action from erp.audit_logs where entity = $1 and entity_id = $2 order by id", [entidade, id])).rows.map((x) => x.action);
}
