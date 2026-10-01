/**
 * ═══ PORTAL DE ESTOQUE — O QUE AS ROTAS DO DOCUMENTO DE ESTOQUE COMPARTILHAM (ESTOQUE-01, decisão 274) ═══
 *
 * `estoque-documentos.ts` (lista, operações, lançar, consultar) e `estoque-confirmacao.ts` (prévia, confirmar,
 * cancelar) leem o MESMO documento pela MESMA porta. Ficam aqui, e só aqui:
 *   · a tabela espécie × segmento × recurso — DERIVADA do domínio, nunca reescrita ao lado;
 *   · a leitura do documento (`lerDocumentoEstoque`), que é a superfície de recusa do portal: id malformado,
 *     inexistente, de outro tenant, fora do escopo de empresa e de OUTRA ESPÉCIE caem na MESMA 404;
 *   · o corpo do cancelamento e o motivo padrão.
 * Um módulo à parte (e não `estoque-documentos.ts` exportando para a confirmação) porque os dois arquivos se
 * importam: a lista registra a confirmação no fim, e a confirmação lê o documento — o ciclo de import entre
 * duas rotas é o tipo de dependência que só aparece quando alguém reordena o registro.
 */
import { z } from "zod";
import {
  ESPECIES_DOCUMENTO_ESTOQUE, SEGMENTO_DA_ESPECIE_ESTOQUE, RECURSO_DA_ESPECIE_ESTOQUE,
  type EspecieEstoque, type SegmentoEstoque, type SituacaoDocumentoEstoque,
} from "@agro/domain";
import { notFound } from "../lib/errors.js";
import { scopedById, type ServiceCtx } from "../lib/context.js";

// ─────────────── espécies ───────────────

export type RecursoEstoque = (typeof RECURSO_DA_ESPECIE_ESTOQUE)[EspecieEstoque];

/** A espécie, o segmento da rota e o recurso de permissão. Uma lista só, montada a partir do domínio. */
export const ESPECIES_ESTOQUE: readonly { especie: EspecieEstoque; segmento: SegmentoEstoque; recurso: RecursoEstoque }[] =
  Object.freeze(ESPECIES_DOCUMENTO_ESTOQUE.map((especie) => Object.freeze({
    especie, segmento: SEGMENTO_DA_ESPECIE_ESTOQUE[especie], recurso: RECURSO_DA_ESPECIE_ESTOQUE[especie],
  })));

/**
 * A forma de um UUID. Conferida ANTES de qualquer consulta que receba o id da URL: sem ela, `'abc'::uuid`
 * estoura 22P02 no banco e a resposta vira 500 — e um 500 para "malformado" ao lado de 404 para "inexistente"
 * é um oráculo de formato.
 */
export const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────── cancelamento ───────────────

/** O motivo gravado quando o usuário cancela sem dizer por quê: a coluna nunca fica vazia num cancelado. */
export const MOTIVO_PADRAO_CANCELAMENTO = "Cancelado sem motivo informado";

/**
 * O corpo do cancelamento: motivo opcional, aparado, até 500. Vazio ou só espaços vira `null` (e quem cancela
 * grava o motivo padrão). `.strict()`: chave desconhecida é 422 — nunca descartada em silêncio.
 */
export const cancelarSchema = z.object({
  motivo: z.string().trim().max(500).nullish().transform((v) => (v ? v : null)),
}).strict();

// ─────────────── leitura ───────────────

/** A TOP do documento como a tela a mostra: a identidade e a versão CONGELADA no lançamento. */
export interface TopParaTela { id: string; codigo: string; codigo_base: string | null; nome: string; versao: number | null }

/** As colunas da TOP que a leitura e a lista trazem pela junção (versão congelada, não a atual). */
export interface ColunasDaTop {
  tipo_operacao_id: string | null; top_codigo: string | null; top_codigo_base: string | null; top_nome: string | null; top_versao: number | null;
}

export const topParaTela = (l: ColunasDaTop): TopParaTela | null =>
  l.tipo_operacao_id && l.top_codigo && l.top_nome
    ? { id: l.tipo_operacao_id, codigo: l.top_codigo, codigo_base: l.top_codigo_base, nome: l.top_nome, versao: l.top_versao }
    : null;

/** Um item como a Central o mostra. Números como TEXTO (o `pg` devolve `numeric` como string; nada vira float). */
export interface ItemDocumentoEstoqueLido {
  id: string;
  posicao: number;
  produto_id: string;
  produto_codigo: string | null;
  produto_nome: string;
  unidade: string | null;
  /** `nenhum` | `lote` | `lote_validade` — o controle de HOJE do produto (a confirmação confere de novo). */
  produto_controle_lote: string;
  lote: string | null;
  validade: string | null;
  quantidade: string | null;
  quantidade_contada: string | null;
  custo_unitario: string | null;
  saldo_na_confirmacao: string | null;
  diferenca: string | null;
  observacao: string | null;
}

/** Um movimento do ledger produzido pelo documento (inclusive os estornos do cancelamento). */
export interface MovimentoDocumentoEstoqueLido {
  id: string;
  movement_type: string;
  direction: number;
  quantity: string;
  unit_cost: string;
  total_cost: string;
  provider_lot: string | null;
  expiration_date: string | null;
  movement_date: string;
  product_id: string;
  product_name: string;
  warehouse_id: string;
  warehouse_name: string;
}

export interface DocumentoEstoqueLido {
  id: string;
  organization_id: string;
  empresa_id: string;
  especie: EspecieEstoque;
  codigo: string;
  situacao: SituacaoDocumentoEstoque;
  tipo_operacao_id: string;
  tipo_operacao_versao_id: string;
  armazem_id: string;
  armazem_destino_id: string | null;
  data_documento: string;
  observacao: string | null;
  criado_por: string | null;
  confirmado_em: Date | null;
  confirmado_por: string | null;
  cancelado_em: Date | null;
  cancelado_por: string | null;
  motivo_cancelamento: string | null;
  created_at: Date;
  atualizado_em: Date;
  empresa_nome: string | null;
  armazem_nome: string | null;
  armazem_destino_nome: string | null;
  criado_por_nome: string | null;
  confirmado_por_nome: string | null;
  cancelado_por_nome: string | null;
  tipo_operacao: TopParaTela | null;
  itens: ItemDocumentoEstoqueLido[];
  movimentos: MovimentoDocumentoEstoqueLido[];
}

type CabecalhoLido = Omit<DocumentoEstoqueLido, "tipo_operacao" | "itens" | "movimentos"> & Omit<ColunasDaTop, "tipo_operacao_id">;

/**
 * CARREGA O DOCUMENTO JÁ AMARRADO À ESPÉCIE DA PORTA — a MESMA leitura do GET, da prévia, da confirmação e do
 * cancelamento. Espécie errada, inexistente, de outro tenant, fora do escopo de empresa (módulo estoque, o da
 * permissão da rota) e id malformado caem na MESMA 404, com a mesma mensagem.
 *
 * `lock` trava SÓ o cabeçalho (`for update of d`): é o que serializa confirmar e cancelar o mesmo documento. Os
 * itens e os movimentos são lidos DEPOIS da trava, então quem travou enxerga o que a transação anterior gravou.
 *
 * TRÊS consultas fixas — cabeçalho, itens, movimentos —, qualquer que seja o número de itens: nada por item.
 */
export async function lerDocumentoEstoque(ctx: ServiceCtx, id: string, especie: EspecieEstoque, opts: { lock?: boolean } = {}): Promise<DocumentoEstoqueLido> {
  if (typeof id !== "string" || !FORMA_UUID.test(id)) throw notFound("Documento");
  const sc = scopedById(ctx, "d", id); sc.params.push(especie);
  const r = await ctx.tx.query<CabecalhoLido>(
    `select d.*, e.name as empresa_nome, wo.description as armazem_nome, wd.description as armazem_destino_nome,
            uc.name as criado_por_nome, uf.name as confirmado_por_nome, ux.name as cancelado_por_nome,
            toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao
       from erp.documentos_estoque d
       left join erp.empresas e on e.id = d.empresa_id
       left join erp.warehouses wo on wo.id = d.armazem_id and wo.organization_id = d.organization_id
       left join erp.warehouses wd on wd.id = d.armazem_destino_id and wd.organization_id = d.organization_id
       left join erp.users uc on uc.id = d.criado_por
       left join erp.users uf on uf.id = d.confirmado_por
       left join erp.users ux on ux.id = d.cancelado_por
       left join erp.tipos_operacao toper on toper.id = d.tipo_operacao_id and toper.organization_id = d.organization_id
       left join erp.tipos_operacao_versoes topv on topv.id = d.tipo_operacao_versao_id and topv.organization_id = d.organization_id
      where d.id = $1 and d.organization_id = $2 and d.especie = $${sc.params.length}${sc.sql}${opts.lock ? " for update of d" : ""}`,
    sc.params);
  const linha = r.rows[0];
  if (!linha) throw notFound("Documento");
  const itens = await ctx.tx.query<ItemDocumentoEstoqueLido>(
    `select i.id, i.posicao, i.produto_id, p.code as produto_codigo, p.description as produto_nome, mu.symbol as unidade,
            coalesce(to_jsonb(p)->>'controle_lote', case when p.has_lot then 'lote' else 'nenhum' end) as produto_controle_lote,
            i.lote, i.validade, i.quantidade, i.quantidade_contada, i.custo_unitario, i.saldo_na_confirmacao, i.diferenca, i.observacao
       from erp.documentos_estoque_itens i
       join erp.products p on p.id = i.produto_id and p.organization_id = i.organization_id
       left join erp.measurement_units mu on mu.id = p.measurement_id
      where i.documento_id = $1 and i.organization_id = $2
      order by i.posicao, i.id`, [id, ctx.orgId]);
  // Os movimentos do documento, estornos inclusive: a história do saldo que ele mexeu, na ordem em que nasceu.
  const movimentos = await ctx.tx.query<MovimentoDocumentoEstoqueLido>(
    `select m.id, m.movement_type, m.direction, m.quantity, m.unit_cost, m.total_cost,
            m.provider_lot, m.expiration_date, m.movement_date, m.product_id, p.description as product_name,
            m.warehouse_id, w.description as warehouse_name
       from erp.stock_movements m
       join erp.products p on p.id = m.product_id and p.organization_id = m.organization_id
       join erp.warehouses w on w.id = m.warehouse_id and w.organization_id = m.organization_id
      where m.organization_id = $1 and m.source_type = 'documentos_estoque' and m.source_id = $2
      order by m.created_at, m.direction, m.product_id, m.id`, [ctx.orgId, id]);
  const { top_codigo, top_codigo_base, top_nome, top_versao, ...cabecalho } = linha;
  return {
    ...cabecalho,
    tipo_operacao: topParaTela({ tipo_operacao_id: linha.tipo_operacao_id, top_codigo, top_codigo_base, top_nome, top_versao }),
    itens: itens.rows,
    movimentos: movimentos.rows,
  };
}
