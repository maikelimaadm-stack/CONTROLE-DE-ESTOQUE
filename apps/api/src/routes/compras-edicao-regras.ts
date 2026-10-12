import { D } from "@agro/shared";
import { MSG_ITENS_DO_RECEBIMENTO } from "@agro/domain";
import type { ServiceCtx } from "../lib/context.js";
import type { DocumentoGravadoDeCompra, CampoDoCabecalhoDeCompra, CampoDoItemDeCompra } from "./compras-edicao-patch.js";

/**
 * EDITAR-02 (decisão 313) — AS RECUSAS DE ESTADO E OS LIMITES DA EDIÇÃO DO PEDIDO DE COMPRA E DA COMPRA, num lugar só.
 *
 * A PATCH e o `GET <base>/:id/edicao` fazem a MESMA pergunta ("este documento pode ser editado? o que fica travado?"), e a
 * resposta tem de ser a mesma nas duas portas: a tela que abre a edição pelo `/edicao` não pode oferecer edição que a
 * PATCH recusa, nem esconder edição que ela aceita (o molde de `vendas-edicao-regras.ts`, decisão 272).
 *
 * A REGRA (decisão 313, do dono): editável é a compra ABERTA e o pedido de compra ABERTO SEM compra viva — e não aprovado
 * (P2). Cada outro caso tem a SUA recusa, estável, exportada aqui (D1): 409 `INVALID_STATUS_TRANSITION` (o código da 272),
 * com `details.situacao` (e `details.compras` no pedido com compra viva).
 *
 * Este módulo não importa VALOR de `compras.ts` (só tipos): o documento chega já lido por quem chama (`lerDocumentoCompra`
 * — na PATCH, DEPOIS da trava da linha; no `/edicao`, sem trava).
 */

// ---------------------------------------------------------------------------------------------------------------
// As recusas de ESTADO (409 INVALID_STATUS_TRANSITION) — uma constante por caso.
// ---------------------------------------------------------------------------------------------------------------
/** Compra confirmada: a confirmação moveu estoque e criou título; o ledger é imutável (decisão 247). O caminho é o estorno. */
export const MSG_EDICAO_COMPRA_CONFIRMADA = "Esta compra está confirmada: a entrada no estoque e as contas a pagar já foram lançadas e não se editam. Para corrigir, cancele a compra (o cancelamento estorna o estoque e as contas) e lance de novo.";
/** Pedido ou compra cancelados: nada a editar. */
export const MSG_EDICAO_DOCUMENTO_CANCELADO = "Este documento está cancelado: não há o que editar.";
/** Pedido finalizado (a confirmação do pedido, decisão 283): pode ter provisionado; `finalizado → aberto` não existe. */
export const MSG_EDICAO_PEDIDO_FINALIZADO = "Este pedido já foi finalizado e não se edita.";
/** Pedido convertido (recebido por inteiro ou com o saldo encerrado): as compras que nasceram dele são a história. */
export const MSG_EDICAO_PEDIDO_CONVERTIDO = "Este pedido já foi convertido em compra e não se edita.";
/** Pedido aberto com compra viva: editar o pedido desmentiria a compra que nasceu dele. A recusa aponta a(s) compra(s). */
export const msgEdicaoPedidoComCompraViva = (codigos: readonly string[]): string => codigos.length === 1
  ? `Este pedido já gerou a compra ${codigos[0]!}: editar o pedido desmentiria a compra. Cancele a compra para editar o pedido.`
  : `Este pedido já gerou as compras ${codigos.join(", ")}: editar o pedido desmentiria as compras. Cancele-as para editar o pedido.`;
/** P2 (decisão do dono): a ÚLTIMA decisão de aprovação é "aprovado" — editar mudaria o que foi aprovado. */
export const MSG_EDICAO_DOCUMENTO_APROVADO = "Este documento já foi aprovado e não se edita: a edição mudaria o que foi aprovado. Para corrigir, cancele e lance de novo.";
/** Situação que esta regra não conhece (fail-closed: nunca "editável por omissão"). */
export const MSG_EDICAO_SITUACAO_NAO_EDITAVEL = "Este documento não se edita nesta situação.";

export interface RecusaDaEdicaoDeCompra {
  mensagem: string;
  details: { situacao: string; compras?: { id: string; codigo: string; situacao: string }[]; aprovacao?: "aprovado" };
}

/**
 * "ESTE DOCUMENTO PODE SER EDITADO?" — a MESMA função da PATCH (409) e do `/edicao` (`podeEditar`/`motivo`). Ordem: a
 * situação (cancelado, confirmado, finalizado, convertido, qualquer outra que não seja `aberto`), a compra viva do
 * pedido (`compras_geradas` não canceladas, lida pela leitura do documento — na PATCH, SOB a trava do pedido, D8: a
 * compra que nasce do receber em partes não atualiza o pedido, então a versão não pega esse caso, e é esta pergunta que
 * pega) e a aprovação (a última decisão em `erp.aprovacoes_compra`, uma consulta, só quando todo o resto passou).
 */
export async function recusaDaEdicaoDeCompra(ctx: ServiceCtx, doc: Pick<DocumentoGravadoDeCompra, "id" | "especie" | "situacao" | "compras_geradas">): Promise<RecusaDaEdicaoDeCompra | null> {
  const situacao = doc.situacao;
  if (situacao === "cancelado") return { mensagem: MSG_EDICAO_DOCUMENTO_CANCELADO, details: { situacao } };
  if (doc.especie === "compra" && situacao === "confirmado") return { mensagem: MSG_EDICAO_COMPRA_CONFIRMADA, details: { situacao } };
  if (doc.especie === "pedido" && situacao === "finalizado") return { mensagem: MSG_EDICAO_PEDIDO_FINALIZADO, details: { situacao } };
  if (doc.especie === "pedido" && situacao === "convertido") return { mensagem: MSG_EDICAO_PEDIDO_CONVERTIDO, details: { situacao } };
  if (situacao !== "aberto") return { mensagem: MSG_EDICAO_SITUACAO_NAO_EDITAVEL, details: { situacao } };
  if (doc.especie === "pedido") {
    const vivas = (doc.compras_geradas ?? []).filter((c) => c.situacao !== "cancelado");
    if (vivas.length) return { mensagem: msgEdicaoPedidoComCompraViva(vivas.map((c) => c.codigo)), details: { situacao, compras: vivas } };
  }
  const ultima = await ctx.tx.query<{ decisao: string }>(
    "select decisao from erp.aprovacoes_compra where organization_id = $1 and documento_id = $2 order by id desc limit 1", [ctx.orgId, doc.id]);
  if (ultima.rows[0]?.decisao === "aprovado") return { mensagem: MSG_EDICAO_DOCUMENTO_APROVADO, details: { situacao, aprovacao: "aprovado" } };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Os LIMITES de uma edição permitida (422 no campo, pré-conferidos; o banco da 0044/0047 continua sendo a rede).
// ---------------------------------------------------------------------------------------------------------------
/** D2 — a compra gerada de um pedido: o fornecedor é o do pedido (o texto do banco, 0044). */
export const MSG_EDICAO_FORNECEDOR_DA_COMPRA_DO_PEDIDO = "O fornecedor da compra gerada de um pedido é o do pedido; ele não muda.";
/** D2 — o produto do item vem do item do pedido de origem. */
export const MSG_EDICAO_PRODUTO_DA_COMPRA_DO_PEDIDO = "O produto do item vem do pedido de origem e não muda.";
/** D2 — a compra gerada de um pedido só tem os itens do pedido (todo item liga a um item de origem, 0044). */
export const MSG_EDICAO_ITEM_NOVO_NA_COMPRA_DO_PEDIDO = "A compra gerada de um pedido só tem os itens do pedido: para comprar outro produto, lance outra compra.";
/** D2 — o pedido de origem convertido: a quantidade do item não muda (a guarda da origem recusa, 0044). */
export const MSG_EDICAO_QUANTIDADE_DO_PEDIDO_CONVERTIDO = "O pedido de origem já foi convertido: a quantidade do item não muda.";
/** D2 — a quantidade passa do saldo do item do pedido (o texto do recebimento, do domínio). */
export const MSG_EDICAO_QUANTIDADE_ACIMA_DO_SALDO = MSG_ITENS_DO_RECEBIMENTO.acima_do_saldo;
/** D4 — o pedido que gerou compra (mesmo cancelada): o fornecedor não muda (o texto do banco, 0044). */
export const MSG_EDICAO_FORNECEDOR_DO_PEDIDO_COM_COMPRA = "O fornecedor do pedido de compra não muda depois que o pedido gerou compra.";
/** D3 — o item do pedido já orçado (orçamento não cancelado): nem produto nem quantidade (o texto do banco, 0044). */
export const MSG_EDICAO_ITEM_ORCADO = "O item do pedido de compra já orçado não troca de produto nem de quantidade.";
/** P3 — a compra com as duplicatas da nota: o que forma o total e as parcelas é o da nota. */
export const MSG_EDICAO_COMPRA_DA_NOTA = "Esta compra veio da nota com as duplicatas: o que forma o total e as parcelas é o da nota e não muda. Para corrigir, cancele a compra e lance de novo.";
/** P3 — o item que carrega a linha da nota (`n_item_nota`): produto, quantidade, valores, descontos e impostos da nota. */
export const MSG_EDICAO_ITEM_DA_NOTA = "Este item veio da nota fiscal: produto, quantidade, valores, descontos e impostos são os da nota e não mudam.";
/**
 * P6 (decisão do dono) — a compra com CHAVE DE ACESSO (digitada ou do XML): a chave (imutável, 0047) codifica o emitente,
 * o número e a série da nota. Trocar fornecedor, número ou série desmentiria a chave — e o título nasceria para outro
 * fornecedor com outro número.
 */
export const MSG_EDICAO_IDENTIDADE_DA_NOTA = "A nota desta compra tem chave de acesso: fornecedor, número e série vêm da chave e não mudam.";
/** P6 — a compra VINDA DA NOTA (importada do XML), mesmo sem as duplicatas: frete, outras despesas e desconto vieram da nota. */
export const MSG_EDICAO_CABECALHO_DA_NOTA = "Esta compra veio da nota fiscal: frete, outras despesas e desconto do cabeçalho são os da nota e não mudam. Para corrigir, cancele a compra e lance de novo.";

/** O que forma o total da compra no cabeçalho, e as parcelas (P3; `data_vencimento` = a 1ª duplicata — decisão do A2). */
const CABECALHO_DA_NOTA: readonly CampoDoCabecalhoDeCompra[] = ["frete", "outras_despesas", "desconto", "condicao_pagamento_id", "data_vencimento"];
/** O que forma o total de cada item (P3). */
const ITEM_DO_TOTAL: readonly CampoDoItemDeCompra[] = ["produto_id", "quantidade", "valor_unitario", "desconto", "desconto_percentual"];
/** A linha da nota no item (P3): o que forma o total e os impostos que vieram da linha. */
const ITEM_DA_LINHA_DA_NOTA: readonly CampoDoItemDeCompra[] = [...ITEM_DO_TOTAL, "valor_ipi", "valor_icms_st"];
/** P6 — o que a chave de acesso codifica (o emitente, o número e a série). */
const IDENTIDADE_DA_NOTA: readonly CampoDoCabecalhoDeCompra[] = ["fornecedor_id", "numero_nota", "serie_nota"];
/** P6 — o que o cabeçalho da compra vinda da nota trouxe da nota (os totais `vFrete`, `vOutro`, `vDesc`). */
const DESPESAS_DA_NOTA: readonly CampoDoCabecalhoDeCompra[] = ["frete", "outras_despesas", "desconto"];

/**
 * P6 — "VINDA DA NOTA" (importada do XML), pelo que o BANCO já guarda e que SÓ a importação grava (os `extras` de
 * `lancar`, parâmetro interno que nunca vem do cliente; o vínculo da importação): a DF-e ligada (`dfe_id`), a importação
 * que gerou a compra (`importacao_id`, lido na MESMA consulta do documento) OU algum item com a linha da nota
 * (`n_item_nota`). Qualquer um dos três basta (fail-closed). A compra manual — mesmo com a chave digitada — não tem
 * nenhum dos três.
 */
export function compraVindaDaNota(doc: Pick<DocumentoGravadoDeCompra, "especie" | "dfe_id" | "importacao_id" | "itens">): boolean {
  return doc.especie === "compra" && (doc.dfe_id != null || doc.importacao_id != null || doc.itens.some((i) => i.n_item_nota != null));
}

/**
 * OS LIMITES DE UMA EDIÇÃO PERMITIDA — a ÚNICA função que os calcula, para a PATCH (que recusa a TROCA de um campo
 * travado com 422 no campo, com o motivo daqui) e para o `/edicao` (que a tela lê para travar o mesmo campo). Forma
 * declarativa e enxuta:
 *   campos            → campo do cabeçalho travado → por quê (o campo ausente é livre);
 *   itemNovo          → `null` = pode incluir item; texto = por que não;
 *   itens[]           → um por item gravado, na ordem do documento: `campos` (travado → por quê) e `quantidadeMaxima`
 *                       (a compra gerada de pedido aberto ou finalizado: o saldo do item do pedido + o que esta compra já
 *                       tem; `null` = sem teto além da coluna).
 * Os motivos, na ordem em que valem (o primeiro de cada campo fica): D2 (compra gerada de pedido), D4 (pedido que gerou
 * compra), D3 (item orçado), P3 (compra com as duplicatas da nota; item com a linha da nota), P6 (compra com chave de
 * acesso: fornecedor, número e série; compra vinda da nota: frete, outras despesas e desconto do cabeçalho).
 * RESÍDUO DECLARADO (P6, decisão do dono): `data_documento` é a emissão da nota (o AAMM está na chave) e continua
 * editável, pela letra da P3.
 * Consultas (nunca uma por item): a compra gerada de pedido, UMA (o item de origem, o pedido e o que as outras compras
 * vivas já ligaram); o pedido com itens, UMA (os itens orçados por orçamento não cancelado); o resto, nenhuma.
 */
export interface LimitesDaEdicaoDeCompra {
  campos: Record<string, string>;
  itemNovo: string | null;
  itens: { id: string; campos: Record<string, string>; quantidadeMaxima: string | null }[];
}

type DocumentoParaLimites = Pick<DocumentoGravadoDeCompra, "id" | "especie" | "origem_documento_id" | "parcelas_nota" | "itens" | "compras_geradas"
  | "chave_acesso" | "dfe_id" | "importacao_id">;

export async function limitesDaEdicaoDeCompra(ctx: ServiceCtx, doc: DocumentoParaLimites): Promise<LimitesDaEdicaoDeCompra> {
  const campos: Record<string, string> = {};
  let itemNovo: string | null = null;
  const itens = doc.itens.map((i) => ({ id: i.id, campos: {} as Record<string, string>, quantidadeMaxima: null as string | null }));
  const travar = (alvo: Record<string, string>, lista: readonly string[], motivo: string) => { for (const c of lista) alvo[c] ??= motivo; };

  // D2 — a compra gerada de um pedido.
  if (doc.especie === "compra" && doc.origem_documento_id) {
    travar(campos, ["fornecedor_id"], MSG_EDICAO_FORNECEDOR_DA_COMPRA_DO_PEDIDO);
    itemNovo ??= MSG_EDICAO_ITEM_NOVO_NA_COMPRA_DO_PEDIDO;
    // O item de origem, a situação do pedido e o que as OUTRAS linhas vivas já ligaram ao item (a conta da guarda da
    // origem, 0044: soma das compras não canceladas, menos a própria linha) — numa consulta.
    const r = await ctx.tx.query<{ id: string; quantidade_pedido: string; ligado_fora: string; pedido_situacao: string }>(
      `select i.id::text as id, oi.quantidade::text as quantidade_pedido, p.situacao as pedido_situacao,
              coalesce((select sum(ci.quantidade)
                          from erp.documentos_compra_itens ci
                          join erp.documentos_compra cd on cd.id = ci.documento_id and cd.organization_id = ci.organization_id
                         where ci.origem_item_id = i.origem_item_id and ci.organization_id = i.organization_id
                           and cd.situacao <> 'cancelado' and ci.id <> i.id), 0)::text as ligado_fora
         from erp.documentos_compra_itens i
         join erp.documentos_compra_itens oi on oi.id = i.origem_item_id and oi.organization_id = i.organization_id
         join erp.documentos_compra p on p.id = oi.documento_id and p.organization_id = oi.organization_id
        where i.documento_id = $1 and i.organization_id = $2`, [doc.id, ctx.orgId]);
    const porItem = new Map(r.rows.map((x) => [x.id, x]));
    for (const it of itens) {
      travar(it.campos, ["produto_id"], MSG_EDICAO_PRODUTO_DA_COMPRA_DO_PEDIDO);
      const o = porItem.get(it.id);
      if (!o) continue;
      if (o.pedido_situacao !== "aberto" && o.pedido_situacao !== "finalizado") travar(it.campos, ["quantidade"], MSG_EDICAO_QUANTIDADE_DO_PEDIDO_CONVERTIDO);
      else it.quantidadeMaxima = D(o.quantidade_pedido).minus(D(o.ligado_fora)).toFixed(4);
    }
  }

  // D4 — o pedido que gerou compra (a viva já recusou a edição antes; aqui, só as canceladas).
  if (doc.especie === "pedido" && (doc.compras_geradas ?? []).length > 0) travar(campos, ["fornecedor_id"], MSG_EDICAO_FORNECEDOR_DO_PEDIDO_COM_COMPRA);

  // D3 — os itens do pedido já orçados por orçamento não cancelado.
  if (doc.especie === "pedido" && doc.itens.length > 0) {
    const r = await ctx.tx.query<{ id: string }>(
      `select distinct i.item_pedido_orcado_id::text as id
         from erp.documentos_compra_itens i
         join erp.documentos_compra o on o.id = i.documento_id and o.organization_id = i.organization_id
        where i.organization_id = $1 and i.item_pedido_orcado_id = any($2::uuid[]) and o.especie = 'orcamento' and o.situacao <> 'cancelado'`,
      [ctx.orgId, doc.itens.map((i) => i.id)]);
    const orcados = new Set(r.rows.map((x) => x.id));
    for (const it of itens) if (orcados.has(it.id)) travar(it.campos, ["produto_id", "quantidade"], MSG_EDICAO_ITEM_ORCADO);
  }

  // P3 — a compra com as duplicatas da nota: o que forma o total, as parcelas e o item novo.
  if (doc.especie === "compra" && doc.parcelas_nota != null) {
    travar(campos, [...CABECALHO_DA_NOTA, "plano_parcelas"], MSG_EDICAO_COMPRA_DA_NOTA);
    itemNovo ??= MSG_EDICAO_COMPRA_DA_NOTA;
    for (const it of itens) travar(it.campos, ITEM_DO_TOTAL, MSG_EDICAO_COMPRA_DA_NOTA);
  }
  // P3 — o item que carrega a linha da nota.
  doc.itens.forEach((g, k) => { if (g.n_item_nota != null) travar(itens[k]!.campos, ITEM_DA_LINHA_DA_NOTA, MSG_EDICAO_ITEM_DA_NOTA); });

  // P6 — a compra com chave de acesso (digitada ou do XML): o que a chave codifica.
  if (doc.especie === "compra" && doc.chave_acesso != null) travar(campos, IDENTIDADE_DA_NOTA, MSG_EDICAO_IDENTIDADE_DA_NOTA);
  // P6 — a compra vinda da nota, mesmo sem as duplicatas (com elas, a P3 acima já travou, com o motivo dela).
  if (compraVindaDaNota(doc)) travar(campos, DESPESAS_DA_NOTA, MSG_EDICAO_CABECALHO_DA_NOTA);

  return { campos, itemNovo, itens };
}
