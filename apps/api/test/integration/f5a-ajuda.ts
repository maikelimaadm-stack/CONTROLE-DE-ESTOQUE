import { expect } from "vitest";
import {
  ESPECIES_MOVIMENTACAO_INTERNA, SEGMENTO_DA_ESPECIE_ESTOQUE, configuracaoNeutraTopV5, familiaOperacionalDeDocumentoEstoque,
  type ConfiguracaoTipoOperacaoV5, type EspecieEstoque, type EspecieMovimentacaoInterna,
} from "@agro/domain";
import { c, iniciar as iniciarEstoque01, top, j, unico, DATA, type Hdr, type Item, type Resposta } from "./estoque-01-ajuda.js";

export {
  c, encerrar, top, produto, armazem, saldoInicial, membro, escopos, j, unico, DATA, recusadoNoCampo, caminhos, saldo, movimentos,
  contarDocumentos, type Hdr, type Item, type Resposta, type Erro, type Detalhe,
} from "./estoque-01-ajuda.js";

/**
 * OPERACOES-01 F5a (decisão 282) — O CENÁRIO DOS TESTES DA MOVIMENTAÇÃO INTERNA NO DOCUMENTO DE ESTOQUE.
 *
 * Em cima do cenário do ESTOQUE-01 (`estoque-01-ajuda.ts`: o harness, a instância `ligada`, os ids do seed, as TOPs
 * das quatro espécies de antes, os produtos e locais de estoque novos por caso, as pessoas e as testemunhas no banco),
 * este arquivo acrescenta o que as três espécies novas precisam:
 *   · uma TOP NEUTRA (formato 1, como as quatro do ESTOQUE-01) de cada espécie nova, cadastrada pela porta
 *     administrativa na família que o REGISTRY diz (`familiaOperacionalDeDocumentoEstoque`) — nunca `estoque.<espécie>`
 *     escrito aqui: a requisição de material NÃO é a família `estoque.requisicao` (a da tabela antiga);
 *   · a TOP do FORMATO 5 com as seções Destino e Fluxo (o neutro do domínio, ajustado pelo caso);
 *   · a porta do documento para as SETE espécies, o encerramento do saldo, o saldo do par com a reserva (pela API) e
 *     as testemunhas das colunas novas (cabeçalho, itens e razão, por conexão própria de superusuário, sem RLS);
 *   · os cadastros do destino (máquina/equipamento, ordem de serviço, lote de animais, área/talhão, safra, centro de
 *     resultado), criados por SQL em cada caso, na empresa pedida.
 * O estado é do módulo (o vitest isola os módulos por arquivo), preenchido por `iniciar()` no `beforeAll`.
 */

/** As TOPs neutras (formato 1) das três espécies da movimentação interna. */
export const topsMi = {} as Record<EspecieMovimentacaoInterna, string>;

/** A família da espécie, perguntada ao registry. Uma espécie sem família não tem como ser lançada: o caso para aqui. */
export function familia(especie: EspecieEstoque): string {
  const f = familiaOperacionalDeDocumentoEstoque(especie);
  expect(f, `premissa: o registry declara a família da espécie ${especie}`).toEqual(expect.any(String));
  return f!;
}

export async function iniciar(): Promise<void> {
  await iniciarEstoque01();
  for (const especie of ESPECIES_MOVIMENTACAO_INTERNA) topsMi[especie] = await top(familia(especie));
}

/** A TOP neutra da espécie (as quatro de antes vêm do ESTOQUE-01; as três novas, de `topsMi`). */
export function topDe(especie: EspecieEstoque): string {
  return especie === "requisicao" || especie === "consumo" || especie === "devolucao_consumo" ? topsMi[especie] : c.tops[especie];
}

/** O neutro do FORMATO 5 do domínio, com o ajuste do caso. Cada chamada devolve um objeto novo. */
export function cfg5(ajuste: (x: ConfiguracaoTipoOperacaoV5) => void = () => {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  ajuste(x);
  return x;
}
/** Uma TOP da família da espécie no FORMATO 5 (pela `ligada`, como a porta exige para os formatos 3 a 5). */
export const topV5 = (especie: EspecieEstoque, ajuste?: (x: ConfiguracaoTipoOperacaoV5) => void): Promise<string> =>
  top(familia(especie), { configuracao: cfg5(ajuste) });

// ─────────────── a porta do documento (as sete espécies) ───────────────

export const segmento = (e: EspecieEstoque) => SEGMENTO_DA_ESPECIE_ESTOQUE[e];

/** O corpo padrão: 1ª empresa, ALM (e SILO como destino na transferência), a TOP neutra da espécie e a data aberta. */
export function corpoDoc(especie: EspecieEstoque, itens: Item[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { empresa_id: c.I.empresa, tipo_operacao_id: topDe(especie), armazem_id: c.I.warehouse,
    ...(especie === "transferencia" ? { armazem_destino_id: c.I.warehouse2 } : {}), data_documento: DATA, itens, ...extra };
}
export function lancarDoc(especie: EspecieEstoque, itens: Item[], extra: Record<string, unknown> = {}, headers: Hdr = c.h.headers()): Promise<Resposta> {
  return c.h.app.inject({ method: "POST", url: `/api/estoque/${segmento(especie)}`, headers, payload: corpoDoc(especie, itens, extra) });
}
export async function lancadoDoc(especie: EspecieEstoque, itens: Item[], extra: Record<string, unknown> = {}, headers?: Hdr): Promise<string> {
  const r = await lancarDoc(especie, itens, extra, headers);
  expect(r.statusCode, `premissa: o documento (${especie}) é lançado — ${r.body}`).toBe(201);
  return (j(r) as { id: string }).id;
}
export const lerDoc = (especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "GET", url: `/api/estoque/${segmento(especie)}/${id}`, headers });
export const previaDoc = (especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "GET", url: `/api/estoque/${segmento(especie)}/${id}/previa-confirmacao`, headers });
export const confirmarDoc = (especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "POST", url: `/api/estoque/${segmento(especie)}/${id}/confirmar`, headers, payload: {} });
export async function confirmadoDoc(especie: EspecieEstoque, id: string): Promise<{ id: string; situacao: string; movimentos: number }> {
  const r = await confirmarDoc(especie, id);
  expect(r.statusCode, `premissa: o documento (${especie}) é confirmado — ${r.body}`).toBe(200);
  return j(r) as { id: string; situacao: string; movimentos: number };
}
export const cancelarDoc = (especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "POST", url: `/api/estoque/${segmento(especie)}/${id}/cancelar`, headers, payload: {} });
export const encerrarSaldo = (id: string, motivo: unknown = "Sobra não será mais usada", headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "POST", url: `/api/estoque/requisicoes/${id}/encerrar-saldo`, headers, payload: { motivo } });
export const listar = (query: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "GET", url: `/api/estoque/documentos?${query}`, headers });

/** O documento como a API o lê (as chaves que os casos conferem). */
export interface DocLido {
  id: string; codigo: string; especie: string; situacao: string; empresa_id: string; armazem_id: string;
  origem_documento_id: string | null; centro_custo_id: string | null; equipamento_id: string | null; ordem_servico_id: string | null;
  lote_animais_id: string | null; area_id: string | null; safra_id: string | null; motivo_saida: string | null; justificativa: string | null;
  saldo_encerrado_em: string | null; saldo_encerrado_por: string | null; saldo_encerrado_motivo: string | null; saldo_encerrado_por_nome: string | null;
  centro_custo_nome: string | null; equipamento_nome: string | null; ordem_servico_codigo: string | null; lote_animais_nome: string | null;
  area_nome: string | null; safra_nome: string | null;
  origem: { id: string; codigo: string; especie: string; situacao: string } | null;
  vinculados: { id: string; codigo: string; especie: string; situacao: string; data_documento: string }[];
  atendimento: string | null;
  itens: { id: string; produto_id: string; quantidade: string | null; custo_unitario: string | null; origem_item_id: string | null;
    quantidade_atendida: string | null; saldo_pendente: string | null; quantidade_devolvida: string | null }[];
  movimentos: { movement_type: string; direction: number; quantity: string; unit_cost: string }[];
}
export async function lido(especie: EspecieEstoque, id: string, headers?: Hdr): Promise<DocLido> {
  const r = await lerDoc(especie, id, headers);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as DocLido;
}

/** O saldo do par (local de estoque × produto) que o SERVIDOR diz, com a reserva: físico, reservado e disponível. */
export async function saldoDoPar(produtoId: string, armazemId: string = c.I.warehouse): Promise<{ quantity: string; reservado: string; disponivel: string }> {
  const r = await c.h.app.inject({ method: "GET", url: `/api/stock/balances/${armazemId}/${produtoId}`, headers: c.h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  const b = j(r) as { quantity: string; reservado: string; disponivel: string };
  return { quantity: b.quantity, reservado: b.reservado, disponivel: b.disponivel };
}

/** O erro da resposta: status, código e mensagem (para comparar inteiro). */
export function erro(r: Resposta): { status: number; code: string | undefined; message: string | undefined } {
  return { status: r.statusCode, code: j(r).error?.code, message: j(r).error?.message };
}
/** A FORMA da recusa — status, código, mensagem e detalhes —, para provar que duas recusas são indistinguíveis. */
export function forma(r: Resposta): unknown[] {
  return [r.statusCode, j(r).error?.code, j(r).error?.message, JSON.stringify(j(r).error?.details ?? null)];
}
/** Os detalhes de um 422: `[path, message]` de cada recusa, na ordem. */
export function detalhes(r: Resposta): [string, string][] {
  const d = j(r).error?.details;
  return Array.isArray(d) ? (d as { path: string; message: string }[]).map((x) => [x.path, x.message]) : [];
}

// ─────────────── testemunhas no banco (superusuário, sem RLS) ───────────────

export interface CabecalhoNoBanco {
  situacao: string; especie: string; origem_documento_id: string | null; centro_custo_id: string | null; equipamento_id: string | null;
  ordem_servico_id: string | null; lote_animais_id: string | null; area_id: string | null; safra_id: string | null;
  motivo_saida: string | null; justificativa: string | null; saldo_encerrado_motivo: string | null; encerrado: boolean;
}
export async function cabecalho(id: string): Promise<CabecalhoNoBanco> {
  return (await c.admin.query<CabecalhoNoBanco>(
    `select situacao, especie, origem_documento_id, centro_custo_id, equipamento_id, ordem_servico_id, lote_animais_id, area_id, safra_id,
            motivo_saida, justificativa, saldo_encerrado_motivo, saldo_encerrado_em is not null as encerrado
       from erp.documentos_estoque where id = $1`, [id])).rows[0]!;
}
export interface ItemNoBanco { id: string; produto_id: string; quantidade: string | null; custo_unitario: string | null; origem_item_id: string | null }
export async function itensNoBanco(id: string): Promise<ItemNoBanco[]> {
  return (await c.admin.query<ItemNoBanco>(
    "select id, produto_id, quantidade::text, custo_unitario::text, origem_item_id from erp.documentos_estoque_itens where documento_id = $1 order by posicao", [id])).rows;
}
export interface MovimentoComDestino {
  movement_type: string; direction: number; quantity: string; unit_cost: string;
  cost_center_id: string | null; harvest_id: string | null; equipamento_id: string | null; ordem_servico_id: string | null;
  lote_animais_id: string | null; area_id: string | null;
}
/** Os movimentos do documento no razão com as colunas de destino (estornos por último). */
export async function razao(id: string): Promise<MovimentoComDestino[]> {
  return (await c.admin.query<MovimentoComDestino>(
    `select movement_type, direction, quantity::text, unit_cost::text, cost_center_id, harvest_id, equipamento_id, ordem_servico_id, lote_animais_id, area_id
       from erp.stock_movements where source_type = 'documentos_estoque' and source_id = $1
      order by (movement_type = 'reversal'), created_at, id`, [id])).rows;
}

// ─────────────── cadastros do destino (por SQL, na empresa pedida) ───────────────

const inserir = async (sql: string, params: unknown[]): Promise<string> => (await c.admin.query<{ id: string }>(sql, params)).rows[0]!.id;

/** Centro de resultado NOVO (analítico, ativo, por padrão). */
export const centroNovo = (o: { kind?: "analytic" | "synthetic"; ativo?: boolean } = {}) => inserir(
  "insert into erp.cost_centers (organization_id, code, name, kind, is_active) values ($1,$2,$3,$4,$5) returning id",
  [c.h.demo.orgId, `F5C${unico()}`, `Centro F5a ${unico()}`, o.kind ?? "analytic", o.ativo ?? true]);
/** Safra NOVA (ativa, por padrão). */
export const safraNova = (o: { ativa?: boolean } = {}) => inserir(
  "insert into erp.harvests (organization_id, description, start_date, end_date, is_active) values ($1,$2,'2026-01-01','2026-12-31',$3) returning id",
  [c.h.demo.orgId, `Safra F5a ${unico()}`, o.ativa ?? true]);
/** Máquina/equipamento NOVO na empresa (1ª, por padrão), ativo por padrão. */
export const equipamentoNovo = (o: { empresa?: string; status?: string } = {}) => inserir(
  "insert into erp.equipments (organization_id, empresa_id, code, description, status) values ($1,$2,$3,$4,$5) returning id",
  [c.h.demo.orgId, o.empresa ?? c.I.empresa, `F5E${unico()}`, `Trator F5a ${unico()}`, o.status ?? "active"]);
/** Ordem de serviço NOVA na empresa, aberta por padrão. */
export const osNova = (o: { empresa?: string; status?: string } = {}) => inserir(
  "insert into erp.service_orders (organization_id, empresa_id, code, order_date, status) values ($1,$2,$3,$4,$5) returning id",
  [c.h.demo.orgId, o.empresa ?? c.I.empresa, `F5OS${unico()}`, DATA, o.status ?? "open"]);
/** Lote de animais NOVO na empresa, ativo por padrão. */
export const loteAnimaisNovo = (o: { empresa?: string; status?: string } = {}) => inserir(
  "insert into erp.batches (organization_id, empresa_id, code, batch_date, description, status) values ($1,$2,$3,$4,$5,$6) returning id",
  [c.h.demo.orgId, o.empresa ?? c.I.empresa, `F5L${unico()}`, DATA, `Lote F5a ${unico()}`, o.status ?? "active"]);
/** Área/talhão NOVA na empresa, ativa por padrão. */
export const areaNova = (o: { empresa?: string; ativa?: boolean } = {}) => inserir(
  "insert into erp.areas (organization_id, empresa_id, code, name, is_active) values ($1,$2,$3,$4,$5) returning id",
  [c.h.demo.orgId, o.empresa ?? c.I.empresa, `F5A${unico()}`, `Talhão F5a ${unico()}`, o.ativa ?? true]);
