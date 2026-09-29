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
 * O que NÃO existe aqui (fora da fatia): editar documento salvo, converter pedido em compra, receber em partes.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, isISODate, DomainError } from "@agro/shared";
import {
  documentTotals, itemTotal, familiaOperacionalDeDocumentoCompra, chaveI18nDaFamiliaOperacional, moduloDaPermissao,
  resolverPoliticaEfetivaDaCompra, planoDaCondicao, camposExigidosTop, exigenciasGeraisFaltando, EXIGENCIAS_GERAIS_COMPRA_TOP,
  ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA, ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, MENSAGEM_CONDICAO_NAO_PERMITIDA,
  CAPACIDADE_CONDICAO_PAGAMENTO, CAPACIDADE_REGRAS_DA_OPERACAO,
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
import { regrasDaVersaoTop, regrasDaTopAtual } from "./vendas-regras-operacao.js";
import { registrarConfirmacaoCompras, cancelarCompraConfirmada, conferirNotaDuplicada } from "./compras-confirmacao.js";

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
  parcelas_ajustadas: z.boolean().optional(),
  forma_pagamento_id: uuid.nullish(),
  frete: decNaoNegativo.default("0"),
  outras_despesas: decNaoNegativo.default("0"),
  desconto: decNaoNegativo.default("0"),
  observacao: textoOpcional(2000),
  itens: z.array(itemSchema).min(1),
}).strict();
type DocumentoCompraEntrada = z.infer<typeof documentoSchema>;

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
 * que serializa confirmação e cancelamento. Exportada para `compras-confirmacao.ts`.
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
            cpag.code as condicao_pagamento_codigo, cpag.nome as condicao_pagamento_nome, pm.name as forma_pagamento_nome
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
      where d.id = $1 and d.organization_id = $2 and d.especie = $${sc.params.length}${sc.sql}${opts.lock ? " for update of d" : ""}`,
    sc.params);
  const linha = r.rows[0];
  if (!linha) throw notFound("Documento");
  const itens = await ctx.tx.query(
    `select i.*, p.description as produto_nome, p.code as produto_codigo, p.control_stock as produto_controla_estoque,
            p.controle_lote as produto_controle_lote, mu.symbol as unidade, w.description as armazem_nome
       from erp.documentos_compra_itens i
       join erp.products p on p.id = i.produto_id and p.organization_id = i.organization_id
       left join erp.measurement_units mu on mu.id = p.measurement_id
       left join erp.warehouses w on w.id = i.armazem_id and w.organization_id = i.organization_id
      where i.documento_id = $1 and i.organization_id = $2
      order by i.posicao, i.id`, [id, ctx.orgId]);
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
    itens: itens.rows, titulos: titulos.rows, movimentos: movimentos.rows,
  };
}

// ─────────────── listagem ───────────────

/**
 * UMA consulta de listagem para as duas portas: a lista da espécie (`especies` = [a da rota]) e a lista única
 * (`especies` = as que o usuário pode ver). A espécie entra no WHERE ANTES do LIMIT (recorte de autorização,
 * nunca filtro sobre o resultado) e o escopo de empresa do módulo compras é aplicado no SQL.
 */
async function listarDocumentos(ctx: ServiceCtx, especies: readonly EspecieCompra[], query: unknown, opts: { filtroEspecie: boolean }) {
  // `limit` é apelido de `pageSize` (a sonda da tela pede `limit=1`); os dois juntos → vale `pageSize`.
  const bruta = (query ?? {}) as Record<string, unknown>;
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
  where.push(...empresaScope(ctx, "d", params, { ignoreSelected: Boolean(f.empresa_id), modulo: moduloDaPermissao("compras.view") }));

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

/** A entrada no estoque que a política da versão congelada PREVÊ (para cobrar lote/validade ao salvar). */
async function compraDaEntradaNoEstoque(ctx: ServiceCtx, top: TopDoLancamento, execucaoConfiguradaHabilitada: boolean): Promise<boolean> {
  const v = await ctx.tx.query<{ configuracao: unknown }>("select configuracao from erp.tipos_operacao_versoes where id = $1 and organization_id = $2", [top.tipoOperacaoVersaoId, ctx.orgId]);
  const r = resolverPoliticaEfetivaDaCompra({ versaoCongelada: { codigoBase: top.codigoBase, configuracao: v.rows[0]?.configuracao ?? null }, execucaoConfiguradaHabilitada });
  // Política não resolvida: a confirmação recusará; ao salvar, cobra-se o que a entrada exigiria (fail-closed).
  if (!r.ok) return true;
  return r.politica.estoque.autoridade === "padrao" || (r.politica.estoque.autoridade === "configurada" && r.politica.estoque.efeito === "entrada");
}

/** Itens: produto da organização; armazém da empresa do documento; lote/validade quando o item vai dar entrada. */
async function conferirItens(ctx: ServiceCtx, especie: EspecieCompra, d: DocumentoCompraEntrada, entradaPrevista: boolean): Promise<void> {
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
    // Produto sem controle de estoque não entra no estoque: armazém, lote e validade não são exigidos.
    if (especie !== "compra" || !p.control_stock || !entradaPrevista || !it.armazem_id) return;
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

const COLUNAS_INSERCAO = `organization_id, empresa_id, especie, codigo, situacao, tipo_operacao_id, tipo_operacao_versao_id,
  fornecedor_id, transportadora_id, data_documento, data_entrada, data_vencimento, numero_nota, serie_nota,
  categoria_financeira_id, centro_custo_id, condicao_pagamento_id, parcelas_ajustadas, plano_parcelas, forma_pagamento_id,
  valor_itens, frete, outras_despesas, desconto, valor_total, observacao, criado_por`;

async function lancar(ctx: ServiceCtx, especie: EspecieCompra, d: DocumentoCompraEntrada, execucaoConfiguradaHabilitada: boolean) {
  conferirCamposDaEspecie(especie, d);
  const top = await resolverTopParaLancamento(ctx, familiaDaEspecie(especie), d.tipo_operacao_id);
  await conferirParceiros(ctx, d);
  const classificacao = await classificacaoDaCompra(ctx, d);
  const condicao = d.condicao_pagamento_id ? await validarCondicaoDoDocumento(ctx, d.condicao_pagamento_id) : null;
  if (d.parcelas_ajustadas && !d.plano_parcelas) throw recusa("parcelas_ajustadas", "Parcelas ajustadas exigem o plano de parcelas");
  await cobrarRegrasDaCompra(ctx, top, d);
  const entradaPrevista = especie === "compra" ? await compraDaEntradaNoEstoque(ctx, top, execucaoConfiguradaHabilitada) : false;
  await conferirItens(ctx, especie, d, entradaPrevista);

  // Totais SEMPRE no servidor: itens − descontos + frete + outras − desconto.
  const itensCalculo = d.itens.map((i) => ({ quantity: i.quantidade, unitPrice: i.valor_unitario, discount: i.desconto, discountPercent: i.desconto_percentual }));
  const totais = documentTotals(itensCalculo, { freight: d.frete, otherValues: d.outras_despesas, discount: d.desconto });

  if (especie === "compra" && d.numero_nota) await conferirNotaDuplicada(ctx, { fornecedorId: d.fornecedor_id, numero: d.numero_nota, serie: d.serie_nota, excluirDocumentoId: null });

  const plano: Record<string, unknown> | null = d.plano_parcelas ? { ...d.plano_parcelas }
    : condicao ? { ...planoDaCondicao(condicao, { dataDocumento: d.data_documento, total: totais.total }) } : null;
  const parcelasAjustadas = d.parcelas_ajustadas ?? (Boolean(d.plano_parcelas) && condicao !== null);

  const codigo = await nextCode(ctx.tx, ctx.orgId, `compras_${especie}`);
  const valores = [ctx.orgId, d.empresa_id, especie, codigo, top.tipoOperacaoId, top.tipoOperacaoVersaoId,
    d.fornecedor_id, d.transportadora_id ?? null, d.data_documento, d.data_entrada ?? null, d.data_vencimento ?? null, d.numero_nota, d.serie_nota,
    classificacao?.categoriaFinanceiraId ?? null, classificacao?.centroCustoId ?? null, condicao?.id ?? null, parcelasAjustadas,
    plano ? JSON.stringify(plano) : null, d.forma_pagamento_id ?? null,
    totais.subtotal, money(d.frete), money(d.outras_despesas), money(d.desconto), totais.total, d.observacao, ctx.user.id];
  const id = (await ctx.tx.query<{ id: string }>(
    `insert into erp.documentos_compra (${COLUNAS_INSERCAO}) values ($1,$2,$3,$4,'aberto',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) returning id`,
    valores)).rows[0]!.id;
  await atribuirIdGlobal(ctx, "documentos_compra", id);
  for (const [i, it] of d.itens.entries()) {
    await ctx.tx.query(
      `insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, armazem_id, quantidade, valor_unitario, desconto,
          desconto_percentual, valor_total, lote, validade, observacao, posicao)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [ctx.orgId, id, it.produto_id, it.armazem_id ?? null, it.quantidade, it.valor_unitario, money(it.desconto), it.desconto_percentual,
        itemTotal(itensCalculo[i]!), it.lote, it.validade ?? null, it.observacao, i]);
  }
  await audit(ctx.tx, ctx, "documentos_compra", id, "create",
    { especie, codigo, tipoOperacaoId: top.tipoOperacaoId, tipoOperacaoVersaoId: top.tipoOperacaoVersaoId, tipoOperacaoCodigo: top.codigo, tipoOperacaoVersao: top.versao });
  return { id, codigo, especie, situacao: "aberto", valor_itens: totais.subtotal, valor_total: totais.total };
}

// ─────────────── rotas ───────────────

export default async function comprasRoutes(app: FastifyInstance) {
  for (const { especie, segmento, recurso } of ESPECIES) {
    const base = `/compras/${segmento}`;

    app.get(base, async (req) => runService(app, req, `${recurso}.view`, (ctx) => listarDocumentos(ctx, [especie], req.query, { filtroEspecie: false })));

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
        capacidades: { classificacaoFinanceira: 1, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, regrasDaOperacao: CAPACIDADE_REGRAS_DA_OPERACAO },
        family: { code: familia, label: t(chaveI18nDaFamiliaOperacional(familia) ?? familia) },
        defaultId: r.rows.find((x) => x.padrao)?.id ?? null,
        items: r.rows.map((x) => ({ id: x.id, code: x.codigo, name: x.nome, version: x.versao, isDefault: x.padrao })),
      };
    }));

    /**
     * REGRAS DA OPERAÇÃO da TOP escolhida (versão ATUAL): exigências com os campos da COMPRA e condições permitidas.
     * TOP inexistente, de outro tenant, de outra família, inativa, excluída, id malformado ou ausente → MESMA 404.
     */
    app.get(`${base}/regras-da-operacao`, async (req) => runService(app, req, `${recurso}.create`, async (ctx) => {
      const familia = familiaDaEspecie(especie);
      const bruto = ((req.query ?? {}) as Record<string, unknown>)["tipo_operacao_id"];
      if (typeof bruto !== "string" || !FORMA_UUID.test(bruto)) throw notFound("Tipo de operação");
      const v = await ctx.tx.query("select 1 from erp.tipos_operacao where id = $1 and organization_id = $2 and codigo_base = $3 and ativo and excluido_em is null", [bruto, ctx.orgId, familia]);
      if (!v.rowCount) throw notFound("Tipo de operação");
      const { formato, regras } = await regrasDaTopAtual(ctx, bruto);
      return {
        contractVersion: 1,
        formato,
        exigencias: regras ? camposExigidosTop(regras.config, EXIGENCIAS_GERAIS_COMPRA_TOP) : [],
        condicoesPermitidas: regras?.condicoesPermitidas ?? null,
      };
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
          if (doc.situacao === "confirmado") return cancelarCompraConfirmada(ctx, doc, { motivo });
          const u = await ctx.tx.query("update erp.documentos_compra set situacao = 'cancelado', atualizado_em = now() where id = $1 and organization_id = $2 and situacao = 'aberto'", [id, ctx.orgId]);
          // ROW COUNT SOB RLS: zero linha sem conferência seria "cancelado" sem efeito.
          if (u.rowCount !== 1) throw notFound("Documento");
          await audit(ctx.tx, ctx, "documentos_compra", id, "cancel", motivo ? { motivo } : undefined, { before: { situacao: "aberto" }, after: { situacao: "cancelado" } });
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
    return listarDocumentos(ctx, permitidas, req.query, { filtroEspecie: true });
  }));

  registrarConfirmacaoCompras(app);
}
