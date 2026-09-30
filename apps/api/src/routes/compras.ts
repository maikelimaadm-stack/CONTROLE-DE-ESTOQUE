/**
 * ═══ PORTAL DE COMPRAS — O DOCUMENTO COMERCIAL DE COMPRA (COMPRAS-01, decisão 267) ═══
 *
 * `erp.documentos_compra` é UMA tabela com DUAS espécies (`especie`): o PEDIDO ao fornecedor e a COMPRA que dá
 * entrada no estoque e gera a conta a pagar. Cada espécie tem a sua família de TOP (`compras.pedido`,
 * `compras.compra`) e o seu recurso de permissão (`pedidos_compra.*`, `compras.*`) — o mesmo desenho das
 * variantes de venda: a porta é da espécie e o registro também (espécie errada = a mesma 404 de inexistente).
 *
 * Este arquivo LANÇA, LISTA, CONSULTA e CANCELA o documento ABERTO. A prévia, a confirmação, o estorno da compra
 * confirmada e a conferência da nota duplicada moram em `compras-confirmacao.ts`.
 *
 * COMPRAS-02 (decisão 268): RECEBER o pedido (inteiro ou em partes) é LANÇAR UMA COMPRA COM ORIGEM — a rota do
 * recebimento (`compras-recebimento.ts`) chama a MESMA `lancar` deste arquivo, com a origem como parâmetro; nenhuma
 * regra de lançamento é copiada. Aqui ficam também o que o recebimento muda na leitura (recebido e saldo por item,
 * compras geradas, origem da compra) e no cancelamento (pedido com compra não cancela; compra cancelada reabre o
 * pedido).
 *
 * COMPRAS-03 (decisão 269): o LAYOUT DO DOCUMENTO de vendas vale para as duas espécies, com o catálogo da família —
 * `operation-types` declara `layoutDocumento`, `/layout-efetivo` responde o contrato de vendas, e `lancar` cobra os
 * obrigatórios do layout da TOP (inclusive no recebimento). Confirmar e cancelar não cobram layout.
 *
 * O que NÃO existe aqui (fora da fatia): editar documento salvo.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, isISODate, DomainError } from "@agro/shared";
import {
  documentTotals, itemTotal, familiaOperacionalDeDocumentoCompra, chaveI18nDaFamiliaOperacional, moduloDaPermissao,
  resolverPoliticaEfetivaDaCompra, planoDaCondicao, camposExigidosTop, exigenciasGeraisFaltando, EXIGENCIAS_GERAIS_COMPRA_TOP,
  ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA, ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, MENSAGEM_CONDICAO_NAO_PERMITIDA,
  CAPACIDADE_CONDICAO_PAGAMENTO, CAPACIDADE_REGRAS_DA_OPERACAO, saldoDoItemDoPedido,
  CAPACIDADE_LAYOUT_DOCUMENTO, ERRO_LAYOUT_CAMPO_OBRIGATORIO, camposObrigatoriosFaltando, mensagemCampoObrigatorio,
} from "@agro/domain";
import { criarTradutor, ptBR } from "@erp/plataforma";
import { runService, nextCode, idempotent, audit } from "../lib/service.js";
import { notFound, err, denied } from "../lib/errors.js";
import { exigirEmpresaDeLancamento, empresaScope, scopedById, hasPermission, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { installmentPlanSchema } from "../services/financial-core.js";
import { atribuirIdGlobal, paginaComIdGlobal } from "../lib/id-global.js";
import {
  resolverTopParaLancamento, validarClassificacaoDoDocumento, recusaDeCampoDaClassificacao, validarCondicaoDoDocumento,
  type ClassificacaoFinanceira, type RegraDaClassificacao, type TopDoLancamento,
} from "../lib/documento-comercial.js";
import { layoutEfetivo, respostaDoLayoutEfetivo } from "../lib/layout-documento.js";
import { regrasDaVersaoTop, regrasDaTopAtual } from "./vendas-regras-operacao.js";
import { registrarConfirmacaoCompras, cancelarCompraConfirmada, conferirNotaDuplicada } from "./compras-confirmacao.js";
import {
  registrarRecebimentoCompras, conferirCancelamentoDoPedido, travarPedidoDeOrigemDaCompra, reabrirPedidoDeOrigem,
} from "./compras-recebimento.js";

const t = criarTradutor(ptBR);

// ─────────────── espécies ───────────────

export type EspecieCompra = "pedido" | "compra";
/** A espécie, o segmento da rota e o recurso de permissão. Uma lista só; nada de mapa espalhado. */
const ESPECIES: readonly { especie: EspecieCompra; segmento: "pedidos" | "compras"; recurso: "pedidos_compra" | "compras" }[] = [
  { especie: "pedido", segmento: "pedidos", recurso: "pedidos_compra" },
  { especie: "compra", segmento: "compras", recurso: "compras" },
];
const recursoDa = (e: EspecieCompra) => ESPECIES.find((x) => x.especie === e)!.recurso;

/** A família da espécie — perguntada ao registry. Fail-closed se o registry deixar de declará-la. */
function familiaDaEspecie(especie: EspecieCompra): string {
  const familia = familiaOperacionalDeDocumentoCompra(especie);
  if (!familia) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento", { especie });
  return familia;
}

// ─────────────── contrato de entrada (estrito) ───────────────

const dec = z.union([z.number(), z.string()]).transform(String);
const decNaoNegativo = dec.refine((v) => { try { return D(v).gte(0); } catch { return false; } }, "Informe um valor maior ou igual a zero");
const decPositivo = dec.refine((v) => { try { return D(v).gt(0); } catch { return false; } }, "Informe uma quantidade maior que zero");
const date = z.string().refine(isISODate, "Data inválida");
const uuid = z.string().uuid();
const textoOpcional = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const itemSchema = z.object({
  produto_id: uuid,
  armazem_id: uuid.nullish(),
  quantidade: decPositivo,
  valor_unitario: decNaoNegativo,
  desconto: decNaoNegativo.default("0"),
  desconto_percentual: decNaoNegativo.default("0"),
  lote: textoOpcional(60),
  validade: date.nullish(),
  observacao: textoOpcional(500),
}).strict();

/** O corpo do POST. `.strict()`: chave desconhecida é 422 — nunca traduzida, nunca descartada. */
const documentoSchema = z.object({
  empresa_id: uuid,
  tipo_operacao_id: uuid,
  fornecedor_id: uuid,
  transportadora_id: uuid.nullish(),
  data_documento: date,
  data_entrada: date.nullish(),
  data_vencimento: date.nullish(),
  numero_nota: textoOpcional(60),
  serie_nota: textoOpcional(10),
  categoria_financeira_id: uuid.nullish(),
  centro_custo_id: uuid.nullish(),
  condicao_pagamento_id: uuid.nullish(),
  plano_parcelas: installmentPlanSchema.nullish(),
  forma_pagamento_id: uuid.nullish(),
  frete: decNaoNegativo.default("0"),
  outras_despesas: decNaoNegativo.default("0"),
  desconto: decNaoNegativo.default("0"),
  observacao: textoOpcional(2000),
  itens: z.array(itemSchema).min(1),
}).strict();
export type DocumentoCompraEntrada = z.infer<typeof documentoSchema>;

/**
 * COMPRAS-02 (decisão 268) — O CORPO DO RECEBIMENTO (`POST /compras/pedidos/:id/convert`). É o corpo de lançar
 * compra, DERIVADO dele (e não reescrito ao lado, que envelheceria em silêncio), com três diferenças:
 *   · sem `empresa_id` e sem `fornecedor_id` — vêm do PEDIDO; aceitá-los no corpo seria pedir ao cliente o que o
 *     servidor já sabe, e abrir a porta para uma compra "do pedido" com outro fornecedor;
 *   · cada item traz `item_origem_id` no lugar de `produto_id` — o produto vem do item do pedido;
 *   · `tipo_operacao_id` é a TOP de DESTINO, conferida contra o leque da versão congelada do pedido.
 * Preço unitário, descontos, lote, validade e armazém continuam no item: valem os da NOTA. `.strict()` nos dois
 * níveis: `produto_id` ou `fornecedor_id` enviados aqui são 422, nunca descartados em silêncio.
 */
const itemDoRecebimentoSchema = itemSchema.omit({ produto_id: true }).extend({ item_origem_id: uuid }).strict();
export const recebimentoSchema = documentoSchema.omit({ empresa_id: true, fornecedor_id: true })
  .extend({ itens: z.array(itemDoRecebimentoSchema).min(1) }).strict();
export type RecebimentoEntrada = z.infer<typeof recebimentoSchema>;

/** O corpo do cancelamento: motivo opcional; presente, tem conteúdo. `.strict()` pelo mesmo motivo. */
const cancelarSchema = z.object({ motivo: z.string().trim().min(1).max(500).nullish() }).strict();

const recusa = (path: string, message: string) => err("VALIDATION_ERROR", message, [{ path, message }]);

// ─────────────── classificação: a regra da venda com o tipo trocado ───────────────

const REGRA_CLASSIFICACAO_COMPRA: RegraDaClassificacao = {
  naturezas: ["expense", "both"],
  msgCategoria: "Natureza inválida para compra: escolha uma natureza analítica de despesa, ativa",
  msgCentro: "Centro de resultado inválido para compra: escolha um centro de resultado analítico, ativo",
  textoConfirmacao: (base) => `A classificação financeira desta compra deixou de valer. ${base}. Reative-a no cadastro ou cancele a compra`,
};
export { REGRA_CLASSIFICACAO_COMPRA };

async function classificacaoDaCompra(ctx: ServiceCtx, d: { categoria_financeira_id?: string | null; centro_custo_id?: string | null }): Promise<ClassificacaoFinanceira | null> {
  const cat = d.categoria_financeira_id ?? null; const cc = d.centro_custo_id ?? null;
  if (cat === null && cc === null) return null;
  if (cat === null || cc === null) throw recusaDeCampoDaClassificacao(cat === null ? "categoria_financeira_id" : "centro_custo_id", "Informe a natureza e o centro de resultado juntos");
  return validarClassificacaoDoDocumento(ctx, REGRA_CLASSIFICACAO_COMPRA, { categoriaFinanceiraId: cat, centroCustoId: cc });
}

// ─────────────── leitura ───────────────

const topParaTela = (l: { tipo_operacao_id: string | null; top_codigo: string | null; top_codigo_base: string | null; top_nome: string | null; top_versao: number | null }) =>
  l.tipo_operacao_id && l.top_codigo && l.top_nome
    ? { id: l.tipo_operacao_id, codigo: l.top_codigo, nome: l.top_nome, versao: l.top_versao, codigoBase: l.top_codigo_base,
        familiaRotulo: l.top_codigo_base ? t(chaveI18nDaFamiliaOperacional(l.top_codigo_base) ?? l.top_codigo_base) : null }
    : null;

/**
 * CARREGA O DOCUMENTO JÁ AMARRADO À ESPÉCIE DA PORTA. Espécie errada, inexistente, de outro tenant e fora do
 * escopo de empresa (módulo compras) caem na MESMA 404. `lock` trava SÓ o cabeçalho (`for update of d`) — é o
 * que serializa confirmação, cancelamento, recebimento e encerramento do saldo. Exportada para
 * `compras-confirmacao.ts` e `compras-recebimento.ts`.
 *
 * COMPRAS-02: no PEDIDO, cada item sai com `recebido` (soma ligada em compras NÃO canceladas) e `saldo`, e o
 * documento com `compras_geradas`; na COMPRA, `origem_codigo` (o pedido de onde veio). Os itens são lidos DEPOIS
 * da trava do cabeçalho: com `lock`, o saldo que o recebimento e o encerramento conferem já enxerga a compra que
 * a transação anterior sobre o mesmo pedido acabou de gravar. Uma consulta por pergunta, nunca por item.
 */
export async function lerDocumentoCompra(ctx: ServiceCtx, id: string, especie: EspecieCompra, opts: { lock?: boolean } = {}): Promise<Record<string, unknown>> {
  // id malformado é a MESMA 404 (sem 22P02 → 500).
  if (!FORMA_UUID.test(id)) throw notFound("Documento");
  const sc = scopedById(ctx, "d", id); sc.params.push(especie);
  const r = await ctx.tx.query<Record<string, unknown> & { tipo_operacao_id: string | null; top_codigo: string | null; top_codigo_base: string | null; top_nome: string | null; top_versao: number | null }>(
    `select d.*, fo.name as fornecedor_nome, tr.name as transportadora_nome, e.name as empresa_nome,
            toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao,
            fcat.code as categoria_financeira_codigo, fcat.name as categoria_financeira_nome,
            ccus.code as centro_custo_codigo, ccus.name as centro_custo_nome,
            cpag.code as condicao_pagamento_codigo, cpag.nome as condicao_pagamento_nome, pm.name as forma_pagamento_nome,
            ue.name as saldo_encerrado_por_nome, dorig.codigo as origem_codigo
       from erp.documentos_compra d
       join erp.people fo on fo.id = d.fornecedor_id and fo.organization_id = d.organization_id
       left join erp.people tr on tr.id = d.transportadora_id and tr.organization_id = d.organization_id
       join erp.empresas e on e.id = d.empresa_id
       left join erp.tipos_operacao toper on toper.id = d.tipo_operacao_id and toper.organization_id = d.organization_id
       left join erp.tipos_operacao_versoes topv on topv.id = d.tipo_operacao_versao_id and topv.organization_id = d.organization_id
       left join erp.financial_categories fcat on fcat.id = d.categoria_financeira_id and fcat.organization_id = d.organization_id
       left join erp.cost_centers ccus on ccus.id = d.centro_custo_id and ccus.organization_id = d.organization_id
       left join erp.condicoes_pagamento cpag on cpag.id = d.condicao_pagamento_id and cpag.organization_id = d.organization_id
       left join erp.payment_methods pm on pm.id = d.forma_pagamento_id
       left join erp.users ue on ue.id = d.saldo_encerrado_por
       left join erp.documentos_compra dorig on dorig.id = d.origem_documento_id and dorig.organization_id = d.organization_id
      where d.id = $1 and d.organization_id = $2 and d.especie = $${sc.params.length}${sc.sql}${opts.lock ? " for update of d" : ""}`,
    sc.params);
  const linha = r.rows[0];
  if (!linha) throw notFound("Documento");
  const ehPedido = especie === "pedido";
  // O recebido de cada item do pedido na MESMA consulta dos itens (lateral agregada): compras canceladas não
  // contam — cancelar a compra devolve o saldo sem ninguém atualizar coluna nenhuma. Na compra a lateral não roda.
  const itensLidos = await ctx.tx.query<Record<string, unknown> & { quantidade: string; recebido_total: string | null }>(
    `select i.*, p.description as produto_nome, p.code as produto_codigo, p.control_stock as produto_controla_estoque,
            p.controle_lote as produto_controle_lote, mu.symbol as unidade, w.description as armazem_nome,
            ${ehPedido ? "coalesce(rec.recebido, 0)::text" : "null::text"} as recebido_total
       from erp.documentos_compra_itens i
       join erp.products p on p.id = i.produto_id and p.organization_id = i.organization_id
       left join erp.measurement_units mu on mu.id = p.measurement_id
       left join erp.warehouses w on w.id = i.armazem_id and w.organization_id = i.organization_id
       ${ehPedido ? `left join lateral (
         select sum(ci.quantidade) as recebido
           from erp.documentos_compra_itens ci
           join erp.documentos_compra cd on cd.id = ci.documento_id and cd.organization_id = ci.organization_id
          where ci.origem_item_id = i.id and ci.organization_id = i.organization_id and cd.situacao <> 'cancelado') rec on true` : ""}
      where i.documento_id = $1 and i.organization_id = $2
      order by i.posicao, i.id`, [id, ctx.orgId]);
  const itens = itensLidos.rows.map(({ recebido_total, ...item }) => (ehPedido
    ? { ...item, recebido: D(recebido_total ?? "0").toFixed(4), saldo: saldoDoItemDoPedido({ quantidade: item.quantidade, recebido: recebido_total ?? "0" }) }
    : item));
  // As compras geradas deste pedido (inclusive canceladas: é a história do pedido), na ordem em que nasceram.
  const comprasGeradas = ehPedido
    ? (await ctx.tx.query<{ id: string; codigo: string; situacao: string }>(
      `select id, codigo, situacao from erp.documentos_compra
        where organization_id = $1 and origem_documento_id = $2 and especie = 'compra'
        order by created_at, id`, [ctx.orgId, id])).rows
    : null;
  const titulos = await ctx.tx.query(
    `select id, code, number, installment_number, due_date, amount, balance, status
       from erp.financial_titles where organization_id = $1 and source_type = 'documentos_compra' and source_id = $2
      order by due_date, installment_number, id`, [ctx.orgId, id]);
  const movimentos = await ctx.tx.query(
    `select m.id, m.movement_type, m.direction, m.quantity, m.unit_cost, m.total_cost,
            m.provider_lot, m.expiration_date, m.movement_date, m.product_id, p.description as product_name,
            m.warehouse_id, w.description as warehouse_name
       from erp.stock_movements m
       join erp.products p on p.id = m.product_id
       join erp.warehouses w on w.id = m.warehouse_id
      where m.organization_id = $1 and m.source_type = 'documentos_compra' and m.source_id = $2
      order by m.created_at, m.id`, [ctx.orgId, id]);
  const { top_codigo, top_codigo_base, top_nome, top_versao, ...cabecalho } = linha;
  return {
    ...cabecalho,
    tipo_operacao: topParaTela({ tipo_operacao_id: linha.tipo_operacao_id, top_codigo, top_codigo_base, top_nome, top_versao }),
    itens, titulos: titulos.rows, movimentos: movimentos.rows,
    ...(comprasGeradas ? { compras_geradas: comprasGeradas } : {}),
  };
}

// ─────────────── listagem ───────────────

/**
 * UMA consulta de listagem para as duas portas: a lista da espécie (`especies` = [a da rota]) e a lista única
 * (`especies` = as que o usuário pode ver). A espécie entra no WHERE ANTES do LIMIT (recorte de autorização,
 * nunca filtro sobre o resultado) e o escopo de empresa do módulo compras é aplicado no SQL.
 */
async function listarDocumentos(ctx: ServiceCtx, especies: readonly EspecieCompra[], query: unknown, opts: { filtroEspecie: boolean; unica: boolean }) {
  // `limit` é apelido de `pageSize` (a sonda da tela pede `limit=1`); os dois juntos → vale `pageSize`.
  const bruta = (query ?? {}) as Record<string, unknown>;
  // Parâmetro repetido chega como lista: 422 no parâmetro, nunca 500 (e nunca "o primeiro vale").
  for (const [chave, valor] of Object.entries(bruta)) if (Array.isArray(valor)) throw recusa(chave, "Parâmetro repetido: informe um valor só");
  const q = pageQuerySchema.parse(bruta.pageSize === undefined && bruta.limit !== undefined ? { ...bruta, pageSize: bruta.limit } : bruta);
  const f = (query ?? {}) as Record<string, string | undefined>;
  const params: unknown[] = [ctx.orgId];
  const where = ["d.organization_id = $1"];
  params.push([...especies]); where.push(`d.especie = any($${params.length}::text[])`);
  // O filtro de espécie é PEDIDO: só intersecta o que já foi autorizado acima.
  if (opts.filtroEspecie && f.especie) {
    const pedidas = f.especie.split(",").map((x) => x.trim()).filter((x) => (especies as readonly string[]).includes(x));
    params.push(pedidas); where.push(`d.especie = any($${params.length}::text[])`);
  }
  const porUuid = (valor: string | undefined, coluna: string) => {
    if (!valor) return;
    if (FORMA_UUID.test(valor)) { params.push(valor); where.push(`${coluna} = $${params.length}`); } else where.push("false");
  };
  porUuid(f.fornecedor_id, "d.fornecedor_id");
  porUuid(f.empresa_id, "d.empresa_id");
  porUuid(f.tipo_operacao_id, "d.tipo_operacao_id");
  if (f.situacao) { params.push(f.situacao.split(",").map((x) => x.trim())); where.push(`d.situacao = any($${params.length}::text[])`); }
  for (const [chave, op] of [["start_date", ">="], ["end_date", "<="]] as const) {
    const v = f[chave];
    if (v) { if (isISODate(v)) { params.push(v); where.push(`d.data_documento ${op} $${params.length}::date`); } else where.push("false"); }
  }
  if (q.search) { params.push(`%${q.search}%`); where.push(`(d.codigo ilike $${params.length} or fo.name ilike $${params.length} or d.numero_nota ilike $${params.length})`); }
  // A lista única ignora a empresa selecionada (como a de Vendas); a da espécie a respeita, salvo filtro explícito.
  where.push(...empresaScope(ctx, "d", params, { ignoreSelected: opts.unica || Boolean(f.empresa_id), modulo: moduloDaPermissao("compras.view") }));

  const de = `from erp.documentos_compra d
              join erp.people fo on fo.id = d.fornecedor_id and fo.organization_id = d.organization_id
              join erp.empresas e on e.id = d.empresa_id
              left join erp.tipos_operacao toper on toper.id = d.tipo_operacao_id and toper.organization_id = d.organization_id
              left join erp.tipos_operacao_versoes topv on topv.id = d.tipo_operacao_versao_id and topv.organization_id = d.organization_id
             where ${where.join(" and ")}`;
  const total = await ctx.tx.query<{ n: string; soma: string }>(`select count(*)::text n, coalesce(sum(d.valor_total), 0)::text soma ${de}`, params);
  const r = await ctx.tx.query<Record<string, unknown> & { especie: string; tipo_operacao_id: string | null; top_codigo: string | null; top_codigo_base: string | null; top_nome: string | null; top_versao: number | null }>(
    `select d.id, d.codigo, d.especie, d.situacao, d.data_documento, d.data_entrada, d.numero_nota, d.serie_nota,
            d.valor_itens, d.frete, d.outras_despesas, d.desconto, d.valor_total, d.empresa_id, d.fornecedor_id, d.created_at as criado_em,
            d.tipo_operacao_id, fo.name as fornecedor_nome, e.name as empresa_nome,
            toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao,
            (select count(*) from erp.documentos_compra_itens i where i.documento_id = d.id and i.organization_id = d.organization_id)::int as quantidade_itens
       ${de}
      order by d.data_documento desc, d.created_at desc, d.id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
  const items = r.rows.map(({ top_codigo, top_codigo_base, top_nome, top_versao, ...x }) => ({
    ...x,
    especie_rotulo: t(chaveI18nDaFamiliaOperacional(familiaOperacionalDeDocumentoCompra(x.especie) ?? "") ?? x.especie),
    tipo_operacao: topParaTela({ tipo_operacao_id: x.tipo_operacao_id, top_codigo, top_codigo_base, top_nome, top_versao }),
  }));
  return paginaComIdGlobal(ctx, "documentos_compra",
    { items, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { valor_total: total.rows[0]!.soma } });
}

// ─────────────── lançamento ───────────────

/** Uma recusa por item, no campo do item (`itens[<i>].<campo>`). */
const recusaDoItem = (i: number, campo: string, message: string) => recusa(`itens[${i}].${campo}`, message);

/** A espécie `pedido` não aceita o que é da nota/entrada: 422 no primeiro campo presente. */
function conferirCamposDaEspecie(especie: EspecieCompra, d: DocumentoCompraEntrada): void {
  if (especie !== "pedido") return;
  const msg = "O pedido de compra não tem nota nem entrada: este campo é da compra";
  for (const campo of ["numero_nota", "serie_nota", "data_entrada"] as const) if (d[campo]) throw recusa(campo, msg);
  d.itens.forEach((it, i) => {
    if (it.lote) throw recusaDoItem(i, "lote", "O pedido de compra não aceita lote: o lote é informado na compra");
    if (it.validade) throw recusaDoItem(i, "validade", "O pedido de compra não aceita validade: a validade é informada na compra");
  });
}

/** Fornecedor (`is_provider`) e transportadora (`is_transporter`) da organização, vivos. Mesma recusa para tudo. */
async function conferirParceiros(ctx: ServiceCtx, d: DocumentoCompraEntrada): Promise<void> {
  const f = await ctx.tx.query("select 1 from erp.people where id = $1 and organization_id = $2 and deleted_at is null and is_provider for share", [d.fornecedor_id, ctx.orgId]);
  if (!f.rowCount) throw recusa("fornecedor_id", "Fornecedor inválido: escolha uma pessoa cadastrada como fornecedor");
  if (d.transportadora_id) {
    const tr = await ctx.tx.query("select 1 from erp.people where id = $1 and organization_id = $2 and deleted_at is null and is_transporter for share", [d.transportadora_id, ctx.orgId]);
    if (!tr.rowCount) throw recusa("transportadora_id", "Transportadora inválida: escolha uma pessoa cadastrada como transportadora");
  }
  if (d.forma_pagamento_id) {
    const pm = await ctx.tx.query("select 1 from erp.payment_methods where id = $1 and (organization_id = $2 or organization_id is null) and is_active", [d.forma_pagamento_id, ctx.orgId]);
    if (!pm.rowCount) throw recusa("forma_pagamento_id", "Forma de pagamento inválida");
  }
}

/** O que a política da versão congelada PREVÊ para a confirmação — cobrado já ao SALVAR (a confirmação confere de novo). */
interface EfeitosPrevistos { entrada: boolean; titulo: boolean; exigeArmazem: boolean; exigeFormaPagamento: boolean; exigeVencimento: boolean }

async function efeitosPrevistosDaCompra(ctx: ServiceCtx, top: Pick<TopDoLancamento, "tipoOperacaoVersaoId" | "codigoBase">, execucaoConfiguradaHabilitada: boolean): Promise<EfeitosPrevistos> {
  const v = await ctx.tx.query<{ configuracao: unknown }>("select configuracao from erp.tipos_operacao_versoes where id = $1 and organization_id = $2", [top.tipoOperacaoVersaoId, ctx.orgId]);
  const r = resolverPoliticaEfetivaDaCompra({ versaoCongelada: { codigoBase: top.codigoBase, configuracao: v.rows[0]?.configuracao ?? null }, execucaoConfiguradaHabilitada });
  // Política não resolvida (ex.: execução configurada desligada): a confirmação recusará. Ao salvar, cobra-se o
  // lote/validade que a entrada exigiria (fail-closed); o título não é presumido — não se sabe se haverá.
  if (!r.ok) return { entrada: true, titulo: false, exigeArmazem: false, exigeFormaPagamento: false, exigeVencimento: false };
  const { estoque, financeiro } = r.politica;
  const entradaConfigurada = estoque.autoridade === "configurada" && estoque.efeito === "entrada";
  const pagarConfigurado = financeiro.autoridade === "configurada" && financeiro.efeito === "pagar";
  return {
    entrada: estoque.autoridade === "padrao" || entradaConfigurada,
    titulo: financeiro.autoridade === "padrao" || pagarConfigurado,
    exigeArmazem: entradaConfigurada && Boolean(estoque.exigeArmazem),
    exigeFormaPagamento: pagarConfigurado && Boolean(financeiro.exigeFormaPagamento),
    exigeVencimento: pagarConfigurado && Boolean(financeiro.exigeVencimento),
  };
}

/** O plano de parcelas que o documento GRAVA — do corpo, ou derivado da condição. É o que a confirmação lê. */
type PlanoGravado = Record<string, unknown> & { first_due_date?: string };

/**
 * COMPRA QUE VAI GERAR TÍTULO (política congelada prevê conta a pagar E valor_total > 0): natureza e centro
 * obrigatórios e as exigências financeiras da política conferidos AO SALVAR, 422 no campo. Valor zero não gera
 * título (a confirmação também não) — nada é exigido.
 *
 * COMPRAS-02 (item 0): o vencimento exigido é o PRIMEIRO do plano que será GRAVADO (o do corpo ou o derivado da
 * condição), ou `data_vencimento` — a mesma conta da confirmação (`plano?.first_due_date ?? data_vencimento`).
 * Olhar só `plano_parcelas` do corpo recusava ao salvar a compra com condição e sem o campo Vencimento, que a
 * confirmação aceitaria: a condição já define os vencimentos, e o plano derivado dela é o que vai para o banco.
 */
function conferirExigenciasDoTitulo(d: DocumentoCompraEntrada, efeitos: EfeitosPrevistos, total: string, plano: PlanoGravado | null): void {
  if (!efeitos.titulo || !D(total).gt(0)) return;
  const msg = "Informe a natureza financeira e o centro de resultado: esta compra gera contas a pagar";
  if (!d.categoria_financeira_id) throw recusa("categoria_financeira_id", msg);
  if (!d.centro_custo_id) throw recusa("centro_custo_id", msg);
  if (efeitos.exigeFormaPagamento && !d.forma_pagamento_id) throw recusa("forma_pagamento_id", "A operação desta compra exige a forma de pagamento");
  if (efeitos.exigeVencimento && !(plano?.first_due_date ?? d.data_vencimento)) throw recusa("data_vencimento", "A operação desta compra exige o vencimento");
}

/** Casas decimais: quantidade até 4 (precisão do estoque), valor unitário até 6 (precisão do custo). */
const casas = (v: string) => { try { return D(v).decimalPlaces(); } catch { return Infinity; } };
function conferirFormaDoDocumento(d: DocumentoCompraEntrada): void {
  if (d.serie_nota && !d.numero_nota) throw recusa("serie_nota", "Série sem número de nota: informe o número da nota");
  // Valores em dinheiro do cabeçalho: 2 casas (o CHECK do total no banco confere a soma exata).
  for (const campo of ["frete", "outras_despesas", "desconto"] as const) if (casas(d[campo]) > 2) throw recusa(campo, "Informe o valor com no máximo 2 casas decimais");
  d.itens.forEach((it, i) => {
    if (casas(it.desconto) > 2) throw recusaDoItem(i, "desconto", "Informe o desconto com no máximo 2 casas decimais");
    if (D(it.desconto_percentual).gt(100)) throw recusaDoItem(i, "desconto_percentual", "O desconto percentual não pode passar de 100");
    if (casas(it.quantidade) > 4) throw recusaDoItem(i, "quantidade", "A quantidade aceita no máximo 4 casas decimais");
    if (casas(it.valor_unitario) > 6) throw recusaDoItem(i, "valor_unitario", "O valor unitário aceita no máximo 6 casas decimais");
  });
}

/**
 * Itens: produto da organização; armazém da empresa do documento; lote só em produto que controla lote e
 * validade só em "lote e validade" (senão 422 no item); lote/validade obrigatórios quando o item vai dar entrada;
 * armazém obrigatório quando a política exige armazém.
 */
async function conferirItens(ctx: ServiceCtx, especie: EspecieCompra, d: DocumentoCompraEntrada, efeitos: EfeitosPrevistos | null): Promise<void> {
  const produtos = await ctx.tx.query<{ id: string; control_stock: boolean; controle_lote: string }>(
    "select id, control_stock, controle_lote from erp.products where id = any($1::uuid[]) and organization_id = $2 and deleted_at is null",
    [[...new Set(d.itens.map((i) => i.produto_id))], ctx.orgId]);
  const porProduto = new Map(produtos.rows.map((p) => [p.id, p]));
  const armazensPedidos = [...new Set(d.itens.map((i) => i.armazem_id).filter((x): x is string => Boolean(x)))];
  const armazens = armazensPedidos.length
    ? await ctx.tx.query<{ id: string }>("select id from erp.warehouses where id = any($1::uuid[]) and organization_id = $2 and empresa_id = $3 and deleted_at is null and is_active", [armazensPedidos, ctx.orgId, d.empresa_id])
    : { rows: [] as { id: string }[] };
  const armazemValido = new Set(armazens.rows.map((w) => w.id));
  d.itens.forEach((it, i) => {
    const p = porProduto.get(it.produto_id);
    if (!p) throw recusaDoItem(i, "produto_id", "Produto inválido");
    if (it.armazem_id && !armazemValido.has(it.armazem_id)) throw recusaDoItem(i, "armazem_id", "Armazém inválido: escolha um armazém ativo da empresa do documento");
    if (it.lote && p.controle_lote === "nenhum") throw recusaDoItem(i, "lote", "Este produto não controla lote: não informe o lote");
    if (it.validade && p.controle_lote !== "lote_validade") throw recusaDoItem(i, "validade", "Este produto não controla validade: não informe a validade");
    // Produto sem controle de estoque não entra no estoque: armazém, lote e validade não são exigidos.
    if (especie !== "compra" || !efeitos || !p.control_stock || !efeitos.entrada) return;
    if (!it.armazem_id) {
      if (efeitos.exigeArmazem) throw recusaDoItem(i, "armazem_id", "A operação desta compra exige o armazém de todos os itens");
      return;
    }
    if (p.controle_lote !== "nenhum" && !it.lote) throw recusaDoItem(i, "lote", "Este produto controla lote: informe o lote");
    if (p.controle_lote === "lote_validade" && !it.validade) throw recusaDoItem(i, "validade", "Este produto controla lote e validade: informe a validade");
  });
}

/** Regras da operação (formato 3): exigências gerais com o mapa da compra e condição permitida. Sem "cliente em atraso". */
async function cobrarRegrasDaCompra(ctx: ServiceCtx, top: TopDoLancamento, d: DocumentoCompraEntrada): Promise<void> {
  const regras = await regrasDaVersaoTop(ctx, top.tipoOperacaoVersaoId);
  if (!regras) return;
  const faltando = exigenciasGeraisFaltando(regras.config, d, EXIGENCIAS_GERAIS_COMPRA_TOP);
  if (faltando.length) {
    throw new DomainError(ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA,
      { exigencias: faltando.map((x) => ({ caminho: x.caminho, mensagem: `${x.rotulo} é obrigatório nesta operação.` })) });
  }
  if (d.condicao_pagamento_id && regras.condicoesPermitidas && !regras.condicoesPermitidas.includes(d.condicao_pagamento_id)) {
    throw new DomainError(ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, MENSAGEM_CONDICAO_NAO_PERMITIDA, { campo: "condicao_pagamento_id" });
  }
}

/**
 * COMPRAS-03 (decisão 269) — COBRANÇA DO LAYOUT AO LANÇAR: o mecanismo de vendas (`cobrarLayoutAoSalvar`, sales.ts)
 * com o catálogo da família da espécie. Chamada por `lancar` DEPOIS de todas as recusas que já existiam (nota
 * duplicada inclusive) e ANTES do número: nenhuma ordem, código ou mensagem anterior muda, e a recusa não queima código.
 *
 * `d` é o documento COMO SERÁ GRAVADO — no RECEBIMENTO, com empresa, fornecedor e produto do PEDIDO (a compra de
 * destino usa o layout da TOP DELA; receber é lançar, decisão 268). Os itens vêm em `d.itens`, e o caminho do erro é
 * `itens[i].<campo>`, na ordem do corpo.
 *
 * O servidor NÃO aplica valor padrão e NÃO recusa campo "não editável": o layout governa a DIGITAÇÃO na tela; aqui só
 * se cobra o obrigatório vazio. LAYOUT DO SISTEMA = NO-OP: documento sem layout configurado não ganha recusa nova. A
 * API de compras sempre declara classificação e condição, por isso as duas capacidades vão ligadas (e nenhum campo do
 * catálogo de compras tem `exige`). Confirmar e cancelar NÃO passam por aqui: só a digitação é cobrada.
 */
async function cobrarLayoutDaCompra(ctx: ServiceCtx, familia: string, top: TopDoLancamento, d: DocumentoCompraEntrada): Promise<void> {
  const layout = await layoutEfetivo(ctx, familia, top.tipoOperacaoId);
  if (layout.origem === "sistema") return;
  const faltando = camposObrigatoriosFaltando(familia, layout.estrutura, d, { classificacao: true, condicao: true });
  if (!faltando.length) return;
  const details = faltando.map((f) => ({ path: f.caminho, message: mensagemCampoObrigatorio(f.rotulo) }));
  throw err(ERRO_LAYOUT_CAMPO_OBRIGATORIO, details[0]!.message, details);
}

const COLUNAS_INSERCAO = `organization_id, empresa_id, especie, codigo, situacao, tipo_operacao_id, tipo_operacao_versao_id,
  fornecedor_id, transportadora_id, data_documento, data_entrada, data_vencimento, numero_nota, serie_nota,
  categoria_financeira_id, centro_custo_id, condicao_pagamento_id, parcelas_ajustadas, plano_parcelas, forma_pagamento_id,
  valor_itens, frete, outras_despesas, desconto, valor_total, observacao, criado_por, origem_documento_id`;

/**
 * COMPRAS-02 — A ORIGEM DE UM LANÇAMENTO: o pedido de compra recebido e, UM POR ITEM E NA ORDEM DO CORPO, o item
 * do pedido de onde cada linha veio. Só o recebimento (`compras-recebimento.ts`) passa origem; o POST de sempre
 * não passa, e grava como antes (origem nula, nenhuma linha ligada) — que é o que o gatilho da 0037 exige.
 */
export interface OrigemDoLancamento { documentoId: string; itemOrigemIds: readonly string[] }

/**
 * A nota já está numa Compra que o usuário NÃO vê (outra empresa): a conferência sob RLS não a achou e o índice
 * único recusa. 409 DUPLICATE_DOCUMENT SEM dizer onde — dizer seria revelar o documento fora do escopo.
 */
function recusaDaNotaInvisivel(e: unknown): never {
  const pe = e as { code?: string; constraint?: string };
  if (pe.code === "23505" && pe.constraint === "ux_documentos_compra_nota") throw err("DUPLICATE_DOCUMENT", "Esta nota já foi lançada nesta organização.");
  throw e;
}

/**
 * LANÇAR — a porta ÚNICA das regras de lançamento, para o POST da espécie e para o RECEBIMENTO do pedido (COMPRAS-02,
 * com `origem`). Receber não tem regra própria de TOP, natureza, condição, itens, lote, efeitos previstos, nota
 * duplicada ou totais: uma segunda cópia "equivalente" divergiria na primeira fatia que mexesse numa das duas.
 */
export async function lancar(ctx: ServiceCtx, especie: EspecieCompra, d: DocumentoCompraEntrada, execucaoConfiguradaHabilitada: boolean, origem?: OrigemDoLancamento) {
  // Contrato interno, não entrada do cliente: origem só na compra, e uma ligação por linha. Quebrar isto é defeito
  // de quem chama — o gatilho da 0037 recusaria depois, mas com uma mensagem que não aponta o chamador.
  if (origem && (especie !== "compra" || origem.itemOrigemIds.length !== d.itens.length)) {
    throw new Error("lancar: origem só na compra, com um item de origem por linha do corpo");
  }
  conferirCamposDaEspecie(especie, d);
  conferirFormaDoDocumento(d);
  const familia = familiaDaEspecie(especie);
  const top = await resolverTopParaLancamento(ctx, familia, d.tipo_operacao_id);
  await conferirParceiros(ctx, d);
  const classificacao = await classificacaoDaCompra(ctx, d);
  const condicao = d.condicao_pagamento_id ? await validarCondicaoDoDocumento(ctx, d.condicao_pagamento_id) : null;
  await cobrarRegrasDaCompra(ctx, top, d);
  const efeitos = especie === "compra" ? await efeitosPrevistosDaCompra(ctx, top, execucaoConfiguradaHabilitada) : null;
  await conferirItens(ctx, especie, d, efeitos);

  // Totais SEMPRE no servidor: itens − descontos + frete + outras − desconto.
  const itensCalculo = d.itens.map((i) => ({ quantity: i.quantidade, unitPrice: i.valor_unitario, discount: i.desconto, discountPercent: i.desconto_percentual }));
  const totais = documentTotals(itensCalculo, { freight: d.frete, otherValues: d.outras_despesas, discount: d.desconto });
  // O plano GRAVADO sai ANTES da conferência das exigências do título (item 0 da COMPRAS-02): a exigência de
  // vencimento confere o primeiro vencimento deste plano — o que a confirmação vai ler do banco.
  const plano: PlanoGravado | null = d.plano_parcelas ? { ...d.plano_parcelas }
    : condicao ? { ...planoDaCondicao(condicao, { dataDocumento: d.data_documento, total: totais.total }) } : null;
  if (efeitos) conferirExigenciasDoTitulo(d, efeitos, totais.total, plano);

  if (especie === "compra" && d.numero_nota) await conferirNotaDuplicada(ctx, { fornecedorId: d.fornecedor_id, numero: d.numero_nota, serie: d.serie_nota, excluirDocumentoId: null });

  // COMPRAS-03: o layout da TOP, por último entre as recusas e antes do número — vale para o POST das duas espécies
  // e para o RECEBIMENTO (que chega aqui com a TOP de destino).
  await cobrarLayoutDaCompra(ctx, familia, top, d);

  // Derivado no servidor, como na venda: plano próprio sobre uma condição = parcelas ajustadas.
  const parcelasAjustadas = Boolean(d.plano_parcelas) && condicao !== null;

  const codigo = await nextCode(ctx.tx, ctx.orgId, `compras_${especie}`);
  const valores = [ctx.orgId, d.empresa_id, especie, codigo, top.tipoOperacaoId, top.tipoOperacaoVersaoId,
    d.fornecedor_id, d.transportadora_id ?? null, d.data_documento, d.data_entrada ?? null, d.data_vencimento ?? null, d.numero_nota, d.serie_nota,
    classificacao?.categoriaFinanceiraId ?? null, classificacao?.centroCustoId ?? null, condicao?.id ?? null, parcelasAjustadas,
    plano ? JSON.stringify(plano) : null, d.forma_pagamento_id ?? null,
    totais.subtotal, money(d.frete), money(d.outras_despesas), money(d.desconto), totais.total, d.observacao, ctx.user.id,
    origem?.documentoId ?? null];
  // Com origem, o gatilho de conferência da 0037 confere que ela é um PEDIDO ABERTO da mesma empresa e fornecedor.
  const id = (await ctx.tx.query<{ id: string }>(
    `insert into erp.documentos_compra (${COLUNAS_INSERCAO}) values ($1,$2,$3,$4,'aberto',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) returning id`,
    valores).catch(recusaDaNotaInvisivel)).rows[0]!.id;
  await atribuirIdGlobal(ctx, "documentos_compra", id);
  // Com origem, cada linha liga ao item do pedido (`origem_item_id`); o gatilho da origem (0037) trava o item de
  // origem e confere pedido, produto e soma ≤ quantidade — a rede atrás da conferência amigável do recebimento.
  for (const [i, it] of d.itens.entries()) {
    await ctx.tx.query(
      `insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, armazem_id, quantidade, valor_unitario, desconto,
          desconto_percentual, valor_total, lote, validade, observacao, posicao, origem_item_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [ctx.orgId, id, it.produto_id, it.armazem_id ?? null, it.quantidade, it.valor_unitario, money(it.desconto), it.desconto_percentual,
        itemTotal(itensCalculo[i]!), it.lote, it.validade ?? null, it.observacao, i, origem?.itemOrigemIds[i] ?? null]);
  }
  await audit(ctx.tx, ctx, "documentos_compra", id, "create",
    { especie, codigo, tipoOperacaoId: top.tipoOperacaoId, tipoOperacaoVersaoId: top.tipoOperacaoVersaoId, tipoOperacaoCodigo: top.codigo, tipoOperacaoVersao: top.versao,
      ...(origem ? { from: origem.documentoId } : {}) });
  return { id, codigo, especie, situacao: "aberto", valor_itens: totais.subtotal, valor_total: totais.total };
}

// ─────────────── rotas ───────────────

export default async function comprasRoutes(app: FastifyInstance) {
  for (const { especie, segmento, recurso } of ESPECIES) {
    const base = `/compras/${segmento}`;

    app.get(base, async (req) => runService(app, req, `${recurso}.view`, (ctx) => listarDocumentos(ctx, [especie], req.query, { filtroEspecie: false, unica: false })));

    /** As TOPs que esta espécie pode lançar — porta OPERACIONAL (`<recurso>.create`), não administrativa. */
    app.get(`${base}/operation-types`, async (req) => runService(app, req, `${recurso}.create`, async (ctx) => {
      const familia = familiaDaEspecie(especie);
      const r = await ctx.tx.query<{ id: string; codigo: string; nome: string; versao: number; padrao: boolean }>(
        `select t.id, t.codigo, v.nome, v.versao, t.padrao
           from erp.tipos_operacao t
           join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
          where t.organization_id = $1 and t.codigo_base = $2 and t.ativo and t.excluido_em is null
          order by t.padrao desc, t.codigo, v.nome`, [ctx.orgId, familia]);
      return {
        contractVersion: 1,
        // COMPRAS-03: `layoutDocumento` ADITIVO (depois de condicaoPagamento, como em vendas). A web nova só pede
        // `/layout-efetivo` com esta declaração — contra a API anterior a Central de Compras continua a de hoje.
        capacidades: { classificacaoFinanceira: 1, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, layoutDocumento: CAPACIDADE_LAYOUT_DOCUMENTO, regrasDaOperacao: CAPACIDADE_REGRAS_DA_OPERACAO },
        family: { code: familia, label: t(chaveI18nDaFamiliaOperacional(familia) ?? familia) },
        defaultId: r.rows.find((x) => x.padrao)?.id ?? null,
        items: r.rows.map((x) => ({ id: x.id, code: x.codigo, name: x.nome, version: x.versao, isDefault: x.padrao })),
      };
    }));

    /**
     * REGRAS DA OPERAÇÃO da TOP escolhida (versão ATUAL): exigências com os campos da COMPRA e condições permitidas.
     * TOP inexistente, de outro tenant, de outra família, inativa, excluída, id malformado ou ausente → MESMA 404.
     *
     * COMPRAS-03 (decisão 269): + `exigeFormaPagamento`, `exigeVencimento` e `exigeArmazem` — os MESMOS que o
     * lançamento cobra (`efeitosPrevistosDaCompra`, da versão ATUAL): a Central desenha esses campos mesmo que o
     * layout os esconda, porque esconder um campo que a regra vai exigir faria o Salvar recusar algo invisível.
     * Pedido nunca gera efeito: os três são false.
     */
    app.get(`${base}/regras-da-operacao`, async (req) => runService(app, req, `${recurso}.create`, async (ctx) => {
      const familia = familiaDaEspecie(especie);
      const bruto = ((req.query ?? {}) as Record<string, unknown>)["tipo_operacao_id"];
      if (typeof bruto !== "string" || !FORMA_UUID.test(bruto)) throw notFound("Tipo de operação");
      const v = await ctx.tx.query<{ versao_id: string }>(
        `select v.id as versao_id from erp.tipos_operacao t
           join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
          where t.id = $1 and t.organization_id = $2 and t.codigo_base = $3 and t.ativo and t.excluido_em is null`, [bruto, ctx.orgId, familia]);
      if (!v.rows[0]) throw notFound("Tipo de operação");
      const { formato, regras } = await regrasDaTopAtual(ctx, bruto);
      // A versão ATUAL gera contas a pagar? (a tela marca natureza/centro como obrigatórios). Pedido nunca gera.
      const efeitos = especie === "compra"
        ? await efeitosPrevistosDaCompra(ctx, { tipoOperacaoVersaoId: v.rows[0].versao_id, codigoBase: familia }, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED)
        : null;
      return {
        contractVersion: 1,
        formato,
        exigencias: regras ? camposExigidosTop(regras.config, EXIGENCIAS_GERAIS_COMPRA_TOP) : [],
        condicoesPermitidas: regras?.condicoesPermitidas ?? null,
        geraTitulos: efeitos?.titulo ?? false,
        exigeFormaPagamento: efeitos?.exigeFormaPagamento ?? false,
        exigeVencimento: efeitos?.exigeVencimento ?? false,
        exigeArmazem: efeitos?.exigeArmazem ?? false,
      };
    }));

    /**
     * COMPRAS-03 (decisão 269) — LAYOUT EFETIVO da TOP escolhida: o MESMO contrato do `/layout-efetivo` de vendas
     * (`{ estrutura, origem, nome, id }` e, só com padrão de cadastro, `padroesDeCadastro` e `padroesInvalidos`), a
     * MESMA porta operacional (`<recurso>.create`) e a MESMA 404 de `regras-da-operacao`. Diferença de vendas: a TOP é
     * OBRIGATÓRIA — todo documento de compra tem TOP, então "sem TOP" não é um pedido que a Central faça, e responder o
     * layout do sistema a um parâmetro ausente seria inventar um caso. Ausente, malformada, de outra família, inativa,
     * excluída ou de outra organização → a MESMA 404 (distinguir seria oráculo de existência). Antes de `/:id`.
     */
    app.get(`${base}/layout-efetivo`, async (req) => runService(app, req, `${recurso}.create`, async (ctx) => {
      const familia = familiaDaEspecie(especie);
      const bruto = ((req.query ?? {}) as Record<string, unknown>)["tipo_operacao_id"];
      if (typeof bruto !== "string" || !FORMA_UUID.test(bruto)) throw notFound("Tipo de operação");
      const v = await ctx.tx.query<{ id: string }>(
        "select id from erp.tipos_operacao where id = $1 and organization_id = $2 and codigo_base = $3 and ativo and excluido_em is null",
        [bruto, ctx.orgId, familia]);
      if (!v.rows[0]) throw notFound("Tipo de operação");
      return respostaDoLayoutEfetivo(ctx, familia, v.rows[0].id);
    }));

    app.get(`${base}/:id`, async (req) => runService(app, req, `${recurso}.view`, (ctx) => lerDocumentoCompra(ctx, (req.params as { id: string }).id, especie)));

    /** LANÇAR. TOP obrigatória (congelada pelo servidor). Idempotency-Key com o USUÁRIO no hash. */
    app.post(base, async (req, reply) => reply.status(201).send(await runService(app, req, `${recurso}.create`, async (ctx) => {
      const d = documentoSchema.parse(req.body);
      await exigirEmpresaDeLancamento(ctx, d.empresa_id);
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        { action: "lancar_documento_compra", especie, corpo: d, actorId: ctx.user.id },
        () => lancar(ctx, especie, d, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED))).result;
    })));

    /**
     * CANCELAR. Aberto → cancelado aqui; compra CONFIRMADA → estorno em `cancelarCompraConfirmada`. Visibilidade
     * conferida ANTES da idempotência (o replay não atravessa o escopo); o documento é travado antes da decisão.
     *
     * COMPRAS-02 (decisão 268): o PEDIDO convertido, ou com compra gerada não cancelada, NÃO cancela (409) — as
     * compras continuariam citando um pedido cancelado, com saldo que ninguém mais controla. A COMPRA gerada de um
     * pedido, cancelada, devolve o saldo (é conta, não coluna) e REABRE o pedido que estava convertido sem saldo
     * encerrado. Trava na ordem compra → pedido; aqui não há movimento, e na confirmada o pedido é travado antes do
     * estorno (`cancelarCompraConfirmada`).
     */
    app.post(`${base}/:id/cancel`, async (req) => runService(app, req, `${recurso}.delete`, async (ctx) => {
      const { id } = req.params as { id: string };
      const motivo = cancelarSchema.parse(req.body ?? {}).motivo ?? null;
      await lerDocumentoCompra(ctx, id, especie);
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        { action: "cancelar_documento_compra", sourceId: id, especie, motivo, actorId: ctx.user.id },
        async () => {
          const doc = await lerDocumentoCompra(ctx, id, especie, { lock: true });
          if (doc.situacao === "cancelado") throw err("ALREADY_CANCELLED", "Documento já cancelado");
          if (especie === "pedido") conferirCancelamentoDoPedido(doc);
          if (doc.situacao === "confirmado") return cancelarCompraConfirmada(ctx, doc, { motivo });
          const pedidoDeOrigem = await travarPedidoDeOrigemDaCompra(ctx, doc);
          const u = await ctx.tx.query("update erp.documentos_compra set situacao = 'cancelado', atualizado_em = now() where id = $1 and organization_id = $2 and situacao = 'aberto'", [id, ctx.orgId]);
          // ROW COUNT SOB RLS: zero linha sem conferência seria "cancelado" sem efeito.
          if (u.rowCount !== 1) throw notFound("Documento");
          await audit(ctx.tx, ctx, "documentos_compra", id, "cancel", motivo ? { motivo } : undefined, { before: { situacao: "aberto" }, after: { situacao: "cancelado" } });
          await reabrirPedidoDeOrigem(ctx, pedidoDeOrigem, id);
          return { id, situacao: "cancelado" };
        })).result;
    }));
  }

  /**
   * ═══ A LISTA ÚNICA DE DOCUMENTOS DE COMPRA ═══ — no desenho da lista única de vendas.
   * Porta dinâmica (`permission: null`): recorte por capacidade no WHERE antes do LIMIT; nenhuma capacidade → 403
   * ("lista vazia" nunca é "todas"); escopo de empresa reaplicado no SQL com o módulo EXPLÍCITO de compras.
   */
  app.get("/compras/documentos", async (req) => runService(app, req, null, async (ctx) => {
    const permitidas = ESPECIES.filter((e) => hasPermission(ctx, `${e.recurso}.view`)).map((e) => e.especie);
    if (permitidas.length === 0) throw denied(`${recursoDa("compra")}.view`);
    return listarDocumentos(ctx, permitidas, req.query, { filtroEspecie: true, unica: true });
  }));

  registrarConfirmacaoCompras(app);
  registrarRecebimentoCompras(app);
}
