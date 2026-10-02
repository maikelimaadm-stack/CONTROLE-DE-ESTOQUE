import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, isISODate, DomainError } from "@agro/shared";
import { documentTotals, itemTotal, nextSalesKind, assertConvertible, familiaOperacionalDeDocumentoVenda, chaveI18nDaFamiliaOperacional, varianteDeDocumentoVendaDaFamilia, moduloDaPermissao, resolverPoliticaEfetivaDaVenda, confirmacaoExigeMarcaDaGuarda, resumoDaPoliticaDaVenda, planoDaCondicao, CAPACIDADE_CONDICAO_PAGAMENTO, CAPACIDADE_LAYOUT_DOCUMENTO, ERRO_LAYOUT_CAMPO_OBRIGATORIO, camposObrigatoriosFaltando, mensagemCampoObrigatorio, type PoliticaEfetivaDaVenda, type SalesKind } from "@agro/domain";
import { criarTradutor, ptBR } from "@erp/plataforma";
import { runService, nextCode, idempotent, audit, assertPeriodOpen, requirePermission } from "../lib/service.js";
import { notFound, validation, err, denied, fromPgError } from "../lib/errors.js";
import { consultaEscopada, exigirEmpresaDeLancamento, empresaScope, scopedById, hasPermission, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { wrapListing } from "../lib/column-filters.js";
import { postStock, reverseStock, quantidadeLegivel } from "../services/stock-core.js";
import { saldoComReservaEmLote, chaveDoPar, type ParDeEstoque } from "../services/reserva-estoque.js";
import { createTitles, installmentPlanSchema, parcelasDoTitulo, type InstallmentPlan } from "../services/financial-core.js";
import { atribuirIdGlobal , paginaComIdGlobal, travarContadorIdGlobal } from "../lib/id-global.js";
import { layoutEfetivo, respostaDoLayoutEfetivo } from "../lib/layout-documento.js";
import { resolverTopParaLancamento, validarClassificacaoDoDocumento, recusaDeCampoDaClassificacao, validarCondicaoDoDocumento, condicaoGravada, type TopDoLancamento, type ClassificacaoFinanceira, type RegraDaClassificacao, type CondicaoDoDocumento } from "../lib/documento-comercial.js";
// TOP-CONFIG-05 (decisão 263): regras da operação no lançamento, na conversão (TOP DESTINO), `/regras-da-operacao`,
// `/situacao-cliente` e a capacidade nova.
import { CAPACIDADE_REGRAS_DA_OPERACAO } from "@agro/domain";
import { regrasDaVersaoTop, regrasDaTopAtual, cobrarRegrasDaOperacao, respostaDasRegrasDaOperacao, type RegrasDaOperacaoDaVenda } from "./vendas-regras-operacao.js";
import { registrarSituacaoCliente } from "./vendas-atraso-cliente.js";
import { registrarEdicaoDeVenda } from "./vendas-edicao.js";
// EDITAR-01 (decisão 272): as recusas de estado num lugar só, e a PATCH (forma, documento como ficará, plano, histórico).
import { recusaDaEdicao, limitesDaEdicao } from "./vendas-edicao-regras.js";
import { FORMA_UUID_PADRAO } from "@agro/domain";
import { lerPedidoDaEdicao, edicaoComoFicara, planoDaEdicao, eventoDaEdicao, recusaDoNumero, recusaDosTotaisDaEdicao, LIMITES_DA_EDICAO, REFERENCIAS_DA_EDICAO, MSG_DOCUMENTO_MUDOU, type LimiteDoNumero, type DocumentoGravado, type ItemGravado, type ItensDaEdicao, type CamposDaEdicao } from "./vendas-edicao-patch.js";
// TOP-CONFIG-06 (decisão 265): faturar em partes — as contas no domínio, as leituras em `vendas-faturar-em-partes`.
import { validarItensDaParte, itensDoSaldoInteiro, itensCanonicosDaParte, calcularParte, saldoDoItem, MSG_ITENS_DA_PARTE, type ItemPedidoDaParte } from "@agro/domain";
import { itensDeOrigemComSaldo, cabecalhoJaAlocado, partesDaOrigem, saldoTotal, MSG_NAO_PERMITE_EM_PARTES, MSG_SEM_SALDO_PARA_CONVERTER, MSG_SEM_PARTES, MSG_SEM_SALDO_A_ENCERRAR, MSG_ORIGEM_COM_PARTES_ATIVAS_CANCEL, msgItensDaParte } from "./vendas-faturar-em-partes.js";
// TOP-CONFIG-07 (decisão 266): o pedido com reserva confere o disponível ao salvar (POST/PUT) — `vendas-reserva-estoque`.
import { versaoReservaEstoque, origemReservaEstoque, conferirReservaDoDocumento, MSG_PARTE_RESERVA_ARMAZEM } from "./vendas-reserva-estoque.js";
// TOP-CONFIG-08 (decisão 277): as regras gerais da versão congelada no FORMATO 4 — documento sem itens, aprovação antes da
// confirmação e confirmação automática no fim de cada caminho que grava a venda.
import { regrasGeraisDaVersaoTop } from "@agro/domain";
import { confirmaAutomaticamente, tentarConfirmacaoAutomatica, lerVersaoCongeladaTop, type ResultadoConfirmacaoAutomatica } from "../lib/confirmacao-automatica.js";
import { recusaDaAprovacao } from "../lib/aprovacao-documento.js";
// OPERACOES-01 F9 (decisão 286): o padrão financeiro da TOP no formato 5 (a venda e o pedido) e a provisão do pedido.
import { MENSAGEM_EXIGE_CLASSIFICACAO, MOTIVOS_DA_PROVISAO, camposTrocadosDosPadroes, mensagemDosPadroesTrocados, perfilDosPadroesFinanceiros, planoDaClassificacao } from "@agro/domain";
import { padroesDaTopParaExecucao } from "../lib/financeiro-top.js";
import { contaPadraoUtilizavel, MENSAGEM_CONTA_PADRAO_INUTILIZAVEL, type PadroesFinanceirosResolvidos } from "../lib/financeiro-padroes-top.js";
import { classificacaoLegada, MENSAGEM_SEM_CLASSIFICACAO_LEGADA } from "../lib/financeiro-classificacao.js";
import { sincronizarProvisaoDoPedido, travarPedidoDaProvisao } from "../lib/financeiro-provisao.js";

const dec = z.union([z.number(), z.string()]).transform(String);
const date = z.string().refine(isISODate, "Data inválida");
const uuid = z.string().uuid();
/** Forma canônica de UUID, para conferir ENTRADA DE FILTRO antes de ela virar parâmetro de SQL. */
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const docSchema = z.object({ empresa_id: uuid, document_date: date, shipping_date: date.optional().nullable(), due_date: date.optional().nullable(), client_id: uuid, transporter_id: uuid.optional().nullable(), proprietary_id: uuid.optional().nullable(), driver_name: z.string().optional().nullable(), payment_method_id: uuid.optional().nullable(), freight: dec.default("0"), freight_icms: dec.default("0"), other_values: dec.default("0"), discount: dec.default("0"), note: z.string().optional().nullable(), installment_plan: installmentPlanSchema.optional().nullable(), is_deductible: z.boolean().default(false), items: z.array(z.object({ product_id: uuid, warehouse_id: uuid.optional().nullable(), quantity: dec, unit_price: dec, discount: dec.default("0"), discount_percent: dec.default("0"), note: z.string().optional().nullable() })).min(1), tipo_operacao_id: uuid.optional().nullable(), categoria_financeira_id: uuid.optional().nullable(), centro_custo_id: uuid.optional().nullable(), condicao_pagamento_id: uuid.optional().nullable() });
/**
 * EDITAR-01 — O CORPO DA PATCH: `{ version, ...só os campos que mudam }`, ESTRITO. Cada campo usa o MESMO validador do
 * `docSchema` (a regra de forma é uma só); só os padrões (`default`) saem, porque na PATCH o campo AUSENTE quer dizer
 * "fica o gravado", e um padrão o transformaria em "zera o frete" em silêncio. `null` só onde o `docSchema` aceita.
 * `empresa_id`, `tipo_operacao_id` e `version` não estão aqui: têm conferência própria, antes (`lerPedidoDaEdicao`).
 * Duas exceções, as duas mais ESTRITAS que o `docSchema`: os números conferem a forma (`decDaEdicao`), e o plano é
 * `.strict()` — no `docSchema` ele descarta chave desconhecida e grava o padrão do zod no lugar (um `instalments`
 * torto viraria 1 parcela com 200). A marca de dedutível vai no `is_deductible` do corpo, não dentro do plano.
 */
const campoDoc = docSchema.shape;
const campoItem = campoDoc.items.element.shape;
/**
 * Número da PATCH: o MESMO `dec` do `docSchema`, com a FORMA e o LIMITE DA COLUNA conferidos aqui (`recusaDoNumero`).
 * O `dec` aceita qualquer texto: o `decimal.js` o recusaria DEPOIS de ler o registro (500), e o que passasse dele com
 * dígitos demais estouraria a coluna no banco (500) ou seria arredondado em silêncio. A PATCH promete 422 no campo,
 * antes de ler qualquer coisa — no cabeçalho, no item e na entrada do plano (EDITAR-01_R1, 1.2 h).
 */
const decDaEdicao = (limite: LimiteDoNumero) => dec.superRefine((v, c) => {
  const recusa = recusaDoNumero(v, limite);
  if (recusa) c.addIssue({ code: "custom", message: recusa });
});
const dinheiroDaEdicao = decDaEdicao(LIMITES_DA_EDICAO.dinheiro);
const itemDaEdicaoSchema = z.object({ id: uuid.optional(), product_id: campoItem.product_id.optional(), warehouse_id: campoItem.warehouse_id, quantity: decDaEdicao(LIMITES_DA_EDICAO.quantidade).optional(), unit_price: decDaEdicao(LIMITES_DA_EDICAO.preco).optional(), discount: dinheiroDaEdicao.optional(), discount_percent: decDaEdicao(LIMITES_DA_EDICAO.percentual).optional(), note: campoItem.note }).strict();
/** O plano da PATCH é ESTRITO nas chaves E nos valores: a entrada é dinheiro canônico ("1,50" → 422, e não um 500 na confirmação). */
const planoDaEdicaoSchema = installmentPlanSchema.extend({ down_payment_value: dinheiroDaEdicao.optional() }).strict();
const edicaoSchema = z.object({ document_date: campoDoc.document_date.optional(), shipping_date: campoDoc.shipping_date, due_date: campoDoc.due_date, client_id: campoDoc.client_id.optional(), transporter_id: campoDoc.transporter_id, proprietary_id: campoDoc.proprietary_id, driver_name: campoDoc.driver_name, payment_method_id: campoDoc.payment_method_id, freight: dinheiroDaEdicao.optional(), freight_icms: dinheiroDaEdicao.optional(), other_values: dinheiroDaEdicao.optional(), discount: dinheiroDaEdicao.optional(), note: campoDoc.note, installment_plan: planoDaEdicaoSchema.optional().nullable(), is_deductible: campoDoc.is_deductible.unwrap().optional(), items: z.array(itemDaEdicaoSchema).min(1).optional(), categoria_financeira_id: campoDoc.categoria_financeira_id, centro_custo_id: campoDoc.centro_custo_id, condicao_pagamento_id: campoDoc.condicao_pagamento_id }).strict() satisfies z.ZodType<CamposDaEdicao>;
const CHAVES_DA_EDICAO: ReadonlySet<string> = new Set(Object.keys(edicaoSchema.shape));
/**
 * TOP-CONFIG-08 (decisão 277) — DOCUMENTO SEM ITENS: os IRMÃOS do `docSchema` e do `edicaoSchema` sem o mínimo de itens.
 *
 * Os estritos NÃO são relaxados: continuam sendo o contrato de quem não tem a regra (orçamento, pedido, a conversão —
 * `bodyInteiro`/`bodyDaParte` — e toda venda cuja versão congelada não está no formato 4 com "Documento sem itens:
 * Permitido"). O irmão só tira o `min(1)` dos itens; o resto é o MESMO validador, campo a campo (`extend`).
 *
 * Só a variante `sale` lê pelo irmão (a matriz só deixa venda e compra permitirem). Ele falhou → o erro é o do ESTRITO
 * (o mesmo `parse` de hoje: código, mensagem e details idênticos). Itens vazios que o irmão aceitou são decididos
 * depois, por `exigirItensSePreciso`, e a recusa também é o erro do estrito.
 */
const docSchemaSemMinimoDeItens = docSchema.extend({ items: campoDoc.items.element.array() });
const edicaoSchemaSemMinimoDeItens = edicaoSchema.extend({ items: z.array(itemDaEdicaoSchema).optional() }).strict() satisfies z.ZodType<CamposDaEdicao>;
const permOf = (k: SalesKind) => (k === "budget" ? "budgets" : k === "order" ? "orders" : "sales");
/**
 * O CORPO DO CANCELAMENTO — declarado, e não mais descartado.
 *
 * Até este hotfix a rota ignorava `req.body` por INTEIRO, e a web já mandava `{ reason }`. Campo que o
 * cliente envia e o servidor descarta em silêncio é ampliação de escopo pela porta de trás
 * (`.claude/rules/backend-api.md`): quem pede que o motivo fique registrado recebe 200 e o motivo não
 * existe em lugar nenhum. Agora ele é conferido, entra no hash de idempotência e vai para a auditoria.
 *
 * OPCIONAL, ao contrário do `reason` de `/settlements/:sid/cancel`, que é exigido. Torná-lo obrigatório
 * aqui recusaria o cliente que hoje cancela sem corpo nenhum — quebra de contrato numa fatia que promete
 * apenas SERIALIZAR o que já existe. Presente, tem de ser texto com conteúdo: `""` e `"   "` são pedido
 * malformado, não "sem motivo", e traduzir um pelo outro seria decidir pelo cliente.
 *
 * `.strict()` PORQUE O CONTRATO PASSOU A DECLARAR O CORPO. `z.object` sem `.strict()` DESCARTA chave
 * desconhecida em silêncio, e o efeito prático é o defeito que esta fatia acabou de fechar, voltando pela
 * porta ao lado: `{"reasn": "..."}` — um typo de uma letra — vira `{}`, o cancelamento acontece SEM motivo
 * e o cliente recebe 200. Quem pediu que o motivo ficasse registrado não tem como saber que ele se perdeu.
 * Enquanto a rota ignorava o corpo INTEIRO isso era ao menos coerente (nada era lido, nada era prometido);
 * a partir do momento em que `reason` é conferido, entra no hash e vai para a auditoria, aceitar a
 * vizinhança do campo sem conferir é prometer registro e entregar descarte. Contrato de entrada não
 * canônico é RECUSADO (422), nunca traduzido e nunca ignorado — `.claude/rules/backend-api.md`.
 *
 * Os dois clientes reais desta rota (`vendas/[kind]/[id]/page.tsx` e o `DocList` genérico de
 * `features/docs/shared.tsx`) mandam `{ reason }` e nada mais: `.strict()` não quebra nenhum deles.
 */
const cancelSchema = z.object({ reason: z.string().trim().min(1).max(500).optional().nullable() }).strict();
/**
 * O CORPO DA CONVERSÃO (TOP-CONFIG-06). `.strict()`: `itens` é contrato novo, e um typo (`iten`) não pode virar
 * "converter o documento inteiro" em silêncio. `itens` AUSENTE é o pedido de hoje, byte a byte.
 */
const convertSchema = z.object({
  tipo_operacao_id: uuid.optional().nullable(),
  itens: z.array(z.object({ item_id: uuid, quantidade: z.union([z.string(), z.number()]).transform(String) }).strict()).optional(),
}).strict();
/** O corpo do encerramento do saldo: motivo obrigatório, até 500 caracteres. */
const encerrarSaldoSchema = z.object({ motivo: z.string().trim().min(1).max(500) }).strict();

const t = criarTradutor(ptBR);

/**
 * A FAMÍLIA CANÔNICA DA VARIANTE — PERGUNTADA AO REGISTRY, NUNCA ESCRITA AQUI.
 *
 * O caminho curto seria `{ budget: "vendas.orcamento", order: "vendas.pedido", sale: "vendas.venda" }`
 * nestas três linhas. Funcionaria hoje e mentiria no dia em que o registry mudasse — sem quebrar tipo,
 * teste nem tela, que é o modo de falhar que `docs/TIPO-OPERACAO-CONTRACT.md` §10 nomeia. O helper do
 * domínio deriva de `TIPOS_OPERACAO`; esta rota só o consome.
 *
 * Fail-closed: se o registry deixasse de declarar a variante, a criação PARA aqui em vez de gravar um
 * documento com família errada.
 */
function familiaDaVariante(kind: SalesKind): string {
  const familia = familiaOperacionalDeDocumentoVenda(kind);
  if (!familia) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento", { kind });
  return familia;
}


/**
 * O snapshot como a tela o lê. `null` é resposta LEGÍTIMA — documento do acervo, ou criado por cliente
 * anterior a esta fatia —, e a tela o exibe como "não configurada", nunca como a família canônica
 * disfarçada de TOP.
 *
 * O `nome` sai de `top_nome`, que veio da VERSÃO CONGELADA. Reaproveitar aqui a consulta da rota
 * administrativa (que junta pela `versao_atual` do pai) faria o documento de 2024 exibir o nome de 2026 —
 * exatamente o histórico reescrito que os dois ponteiros existem para impedir.
 */
const topParaTela = (l: { tipo_operacao_id: string | null; top_codigo: string | null; top_codigo_base: string | null; top_nome: string | null; top_versao: number | null }) =>
  l.tipo_operacao_id && l.top_codigo && l.top_nome
    ? { id: l.tipo_operacao_id, codigo: l.top_codigo, nome: l.top_nome, versao: l.top_versao, codigoBase: l.top_codigo_base,
        familiaRotulo: l.top_codigo_base ? t(chaveI18nDaFamiliaOperacional(l.top_codigo_base) ?? l.top_codigo_base) : null }
    : null;

// `resolverTopParaLancamento` (e o tipo `TopDoLancamento`) moram em `lib/documento-comercial.ts` (COMPRAS-01),
// parametrizados pela família — sem mudança de comportamento para a venda.

/**
 * CLASSIFICAÇÃO FINANCEIRA DO DOCUMENTO (VENDAS-A1): o PAR categoria de receita × centro de custo que vai
 * para o rateio dos títulos a receber gerados na confirmação.
 */
export type { ClassificacaoFinanceira };
/** Versão da capacidade declarada em `operation-types` (a web só mostra e envia os campos com ela). */
export const CAPACIDADE_CLASSIFICACAO_FINANCEIRA = 1;
const MSG_CATEGORIA_INVALIDA = "Natureza inválida para venda: escolha uma natureza analítica de receita, ativa";
const MSG_CENTRO_INVALIDO = "Centro de resultado inválido para venda: escolha um centro de resultado analítico, ativo";
const MSG_PAR_INCOMPLETO = "Informe a natureza e o centro de resultado juntos";
const recusaDeCampo = recusaDeCampoDaClassificacao;

/**
 * A PORTA ÚNICA DE VALIDAÇÃO da classificação — usada na criação, na edição, na conversão e na confirmação.
 *
 * SUPERFÍCIE ÚNICA DE RECUSA POR CAMPO: inexistente, de outra organização, sintética, de despesa ou "ambas",
 * inativa e excluída caem no MESMO 422 com a MESMA mensagem. Distinguir seria um oráculo de existência
 * sobre o cadastro da organização vizinha (`.claude/rules/security.md`).
 *
 * `for share`: a linha lida fica travada contra alteração até o fim da transação. Sem isso, uma inativação
 * concorrente commitaria entre a validação e a gravação, e o documento (ou o título) nasceria apontando para
 * uma categoria que já não é aceita. O custo é baixo — cadastro de categoria/centro raramente é editado, e a
 * inativação só espera o lançamento terminar. É o mesmo desenho de `resolverTopParaLancamento`.
 *
 * `contexto` só troca o TEXTO da recusa (origem da conversão, confirmação); a regra é uma só.
 */
/** A regra da VENDA: natureza de RECEITA (`income`) — a mesma consulta e os mesmos textos de antes da extração. */
const REGRA_CLASSIFICACAO_VENDA: RegraDaClassificacao = {
  naturezas: ["income"], msgCategoria: MSG_CATEGORIA_INVALIDA, msgCentro: MSG_CENTRO_INVALIDO,
  textoConfirmacao: (base) => `A classificação financeira desta venda deixou de valer. ${base}. Reative-a no cadastro ou cancele a venda`,
};
async function validarClassificacaoFinanceira(ctx: ServiceCtx, par: ClassificacaoFinanceira, contexto: "lancamento" | "origem" | "confirmacao" = "lancamento", opcoes: { trava: boolean } = { trava: true }): Promise<ClassificacaoFinanceira> {
  // `trava: false` só na PRÉVIA da confirmação (VENDAS-A5-1). A regra mora em `lib/documento-comercial.ts`.
  return validarClassificacaoDoDocumento(ctx, REGRA_CLASSIFICACAO_VENDA, par, contexto, opcoes);
}

/** Par vindo do corpo da CRIAÇÃO: ausente/null nos dois → sem classificação; um só → 422; os dois → validado. */
async function classificacaoDaCriacao(ctx: ServiceCtx, d: { categoria_financeira_id?: string | null; centro_custo_id?: string | null }): Promise<ClassificacaoFinanceira | null> {
  const cat = d.categoria_financeira_id ?? null; const cc = d.centro_custo_id ?? null;
  if (cat === null && cc === null) return null;
  if (cat === null || cc === null) throw recusaDeCampo(cat === null ? "categoria_financeira_id" : "centro_custo_id", MSG_PAR_INCOMPLETO);
  return validarClassificacaoFinanceira(ctx, { categoriaFinanceiraId: cat, centroCustoId: cc });
}

/**
 * Par da EDIÇÃO, com a mesma semântica de `tipo_operacao_id`:
 *   campo AUSENTE → preserva o gravado · valor presente (mesmo igual) → validado e gravado ·
 *   null explícito em documento classificado → 422 · null em documento sem classificação → no-op.
 * O PAR vale sobre o documento RESULTANTE (depois da preservação). `undefined` = não toca nas colunas.
 */
async function classificacaoDaEdicao(ctx: ServiceCtx, corpo: unknown, atual: { categoria_financeira_id: string | null; centro_custo_id: string | null }): Promise<ClassificacaoFinanceira | undefined> {
  const cru = corpo !== null && typeof corpo === "object" ? corpo as Record<string, unknown> : {};
  const classificado = atual.categoria_financeira_id !== null;
  for (const campo of ["categoria_financeira_id", "centro_custo_id"] as const) {
    if (classificado && campo in cru && cru[campo] === null) throw recusaDeCampo(campo, "A classificação não pode ser removida; informe outra ou omita o campo");
  }
  const enviou = (campo: string) => campo in cru && cru[campo] !== null && cru[campo] !== undefined;
  if (!enviou("categoria_financeira_id") && !enviou("centro_custo_id")) return undefined;
  const cat = enviou("categoria_financeira_id") ? String(cru["categoria_financeira_id"]) : atual.categoria_financeira_id;
  const cc = enviou("centro_custo_id") ? String(cru["centro_custo_id"]) : atual.centro_custo_id;
  if (cat === null || cc === null) throw recusaDeCampo(cat === null ? "categoria_financeira_id" : "centro_custo_id", MSG_PAR_INCOMPLETO);
  return validarClassificacaoFinanceira(ctx, { categoriaFinanceiraId: cat, centroCustoId: cc });
}

// `CondicaoDoDocumento`, `validarCondicaoDoDocumento` e `condicaoGravada` moram em `lib/documento-comercial.ts` (COMPRAS-01).
/**
 * Condição da EDIÇÃO — o mesmo contrato de três estados de `tipo_operacao_id`/classificação:
 *   campo AUSENTE → preserva · null → remove · uuid → troca (validado só se for NOVO ou DIFERENTE do gravado).
 * `gravar: false` = não toca na coluna; `linha` é a condição que o documento TERÁ (para derivar o plano).
 */
async function condicaoDaEdicao(ctx: ServiceCtx, corpo: unknown, atual: { condicao_pagamento_id: string | null }): Promise<{ linha: CondicaoDoDocumento | null; gravar: boolean }> {
  const cru = corpo !== null && typeof corpo === "object" ? corpo as Record<string, unknown> : {};
  const v = cru["condicao_pagamento_id"];
  if (!("condicao_pagamento_id" in cru) || v === undefined) return { linha: atual.condicao_pagamento_id ? await condicaoGravada(ctx, atual.condicao_pagamento_id) : null, gravar: false };
  if (v === null) return { linha: null, gravar: true };
  if (atual.condicao_pagamento_id !== null && String(v) === atual.condicao_pagamento_id) return { linha: await condicaoGravada(ctx, atual.condicao_pagamento_id), gravar: false };
  return { linha: await validarCondicaoDoDocumento(ctx, String(v)), gravar: true };
}


/**
 * COBRANÇA DO LAYOUT AO SALVAR (POST/PUT de orçamento, pedido e venda) — SEMPRE depois de todas as recusas que já
 * existiam (TOP, classificação, condição): nenhuma ordem, código ou mensagem anterior muda.
 *
 * `documento` é o documento COMO FICARÁ depois de gravar (o PUT preserva os campos de três estados ausentes).
 *
 * O servidor NÃO aplica valor padrão e NÃO recusa campo "não editável": o layout governa a DIGITAÇÃO na tela; aqui
 * só se cobra o obrigatório vazio. Aplicar padrão no servidor faria a mesma chamada gravar coisas diferentes
 * conforme a configuração do dia (a mesma razão de não aplicar a TOP padrão na criação).
 *
 * LAYOUT DO SISTEMA = NO-OP (LD-A8). Os obrigatórios dele já são cobrados antes pelo zod (cliente, empresa, data,
 * produto, quantidade, valor unitário); a natureza/centro são "do sistema" só na TELA quando a API declara a
 * classificação — o servidor nunca os exigiu ao salvar, e cobrá-los aqui recusaria documento que hoje passa.
 * Por isso o sistema não é cobrado: documento sem layout configurado não ganha recusa nova nenhuma.
 *
 * Não cobrada na CONVERSÃO (o documento gerado herda o de origem) nem na CONFIRMAÇÃO — só na digitação.
 */
async function cobrarLayoutAoSalvar(ctx: ServiceCtx, kind: SalesKind, documento: Record<string, unknown> & { tipo_operacao_id?: string | null; items: Record<string, unknown>[] }) {
  const familia = familiaDaVariante(kind);
  const layout = await layoutEfetivo(ctx, familia, documento.tipo_operacao_id ?? null);
  if (layout.origem === "sistema") return;
  const faltando = camposObrigatoriosFaltando(familia, layout.estrutura, documento, { classificacao: CAPACIDADE_CLASSIFICACAO_FINANCEIRA > 0, condicao: true });
  if (!faltando.length) return;
  const details = faltando.map((f) => ({ path: f.caminho, message: mensagemCampoObrigatorio(f.rotulo) }));
  throw err(ERRO_LAYOUT_CAMPO_OBRIGATORIO, details[0]!.message, details);
}

/**
 * TOP-CONFIG-08 (decisão 277) — DOCUMENTO SEM ITENS, a leitura do corpo (POST e PUT).
 *
 * Orçamento e pedido: o `docSchema` estrito, como sempre (itens vazios recusados aqui). Venda: o irmão sem o mínimo de
 * itens; se ele recusa o corpo, quem responde é o ESTRITO — o corpo que o irmão recusa o estrito também recusa, e o
 * erro dele (com o `items: Valor mínimo: 1` junto, quando é o caso) é o de hoje, byte a byte.
 */
function lerCorpoDoDocumento(kind: SalesKind, corpo: unknown): z.infer<typeof docSchema> {
  if (kind !== "sale") return docSchema.parse(corpo);
  const r = docSchemaSemMinimoDeItens.safeParse(corpo);
  return r.success ? r.data : docSchema.parse(corpo);
}

/** A recusa de hoje dos itens vazios: VALIDATION_ERROR "items: Valor mínimo: 1", details [{ path: "items", message: "Valor mínimo: 1" }]. */
const recusaDosItensVazios = () => err("VALIDATION_ERROR", "items: Valor mínimo: 1", [{ path: "items", message: "Valor mínimo: 1" }]);
/**
 * Recusa os itens vazios com o erro do ESTRITO. `ler` é o parse estrito de quem chama (o `docSchema` no POST e no PUT, o
 * `lerPedidoDaEdicao` com o `edicaoSchema` na PATCH): ele LANÇA, e a resposta é a de hoje — o mesmo tratador de erros,
 * o mesmo corpo. Se o parse não lançar (a PATCH que não envia `items` sobre um documento já sem itens), a recusa é a
 * MESMA, montada à mão com o código, a mensagem e os details que o estrito daria.
 */
function recusarItensVazios(ler: () => unknown): never {
  ler();
  throw recusaDosItensVazios();
}

/**
 * A VERSÃO CONGELADA ACEITA VENDA SEM ITENS? Só a variante `sale`, só o formato 4, só "Documento sem itens: Permitido"
 * (`regrasGeraisDaVersaoTop` lê a versão como ela é gravada; a matriz é o portão da gravação da TOP, não daqui).
 * Sem versão, formato 1 a 3 ou configuração ilegível → não aceita (a recusa de hoje). UMA consulta, e só quando os itens
 * vieram vazios — o documento com itens não pergunta nada.
 */
async function aceitaSemItens(ctx: ServiceCtx, kind: SalesKind, versaoId: string | null): Promise<boolean> {
  if (kind !== "sale" || !versaoId) return false;
  const r = regrasGeraisDaVersaoTop(await lerVersaoCongeladaTop(ctx, versaoId));
  return r.ok && r.regras.aceitaSemItens;
}

/**
 * A PATCH da venda lê `items` pelo irmão do `edicaoSchema` (lista vazia passa na FORMA e é decidida pela versão, no
 * núcleo); se o irmão recusa, quem responde é o ESTRITO. Orçamento e pedido: o estrito, como sempre.
 */
function lerPedidoDaEdicaoDaVariante(kind: SalesKind, corpo: unknown): { versao: string; campos: CamposDaEdicao } {
  if (kind !== "sale") return lerPedidoDaEdicao(corpo, edicaoSchema, CHAVES_DA_EDICAO);
  try {
    return lerPedidoDaEdicao(corpo, edicaoSchemaSemMinimoDeItens, CHAVES_DA_EDICAO);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    return lerPedidoDaEdicao(corpo, edicaoSchema, CHAVES_DA_EDICAO);
  }
}

/**
 * TOP-CONFIG-08 (decisão 277) — A CONFIRMAÇÃO AUTOMÁTICA DA VENDA, o gancho no FIM de cada caminho que grava uma venda
 * aberta: POST (dentro do `idempotent`, depois da auditoria "create"), PUT, PATCH que muda alguma coisa e a venda GERADA
 * pela conversão (depois de a origem ser atualizada). O molde é o do COORD, igual em todos os módulos:
 *   · só a variante `sale` (os handlers servem às três; orçamento e pedido não se confirmam);
 *   · só a versão congelada DESTE documento no formato 4 com "Confirmação: Automática" (`confirmaAutomaticamente`; a
 *     gerada pela conversão segue a SUA versão, a da TOP de destino, e não a da origem);
 *   · quem confirma é quem salvou, com a capacidade da confirmação manual (`sales.edit`), num SAVEPOINT, pela MESMA
 *     função do POST /confirm (`confirmarVendaNaTransacao`, com `automatica: true` só no metadata da auditoria);
 *   · recusa de domínio (saldo, período, exigência, aprovação, a guarda do banco, 40P01) → savepoint desfeito, a venda
 *     fica SALVA e ABERTA, e o porquê vai na resposta (`tentarConfirmacaoAutomatica` nunca lança DomainError).
 * `undefined` = não é automática: a resposta é a de hoje, chave por chave (sem `confirmacaoAutomatica`).
 */
async function confirmacaoAutomaticaDaVenda(app: FastifyInstance, ctx: ServiceCtx, kind: SalesKind, id: string, versaoId: string | null): Promise<ResultadoConfirmacaoAutomatica | undefined> {
  if (kind !== "sale") return undefined;
  return (await confirmaAutomaticamente(ctx, versaoId))
    ? await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: () => confirmarVendaNaTransacao(app, ctx, id, { automatica: true }) })
    : undefined;
}

/** O corpo de hoje, com `confirmacaoAutomatica` acrescentada SÓ quando a versão é automática (aditivo). */
async function comConfirmacaoAutomatica<T extends object>(app: FastifyInstance, ctx: ServiceCtx, kind: SalesKind, id: string, versaoId: string | null, corpo: T): Promise<T | (T & { confirmacaoAutomatica: ResultadoConfirmacaoAutomatica })> {
  const confirmacaoAutomatica = await confirmacaoAutomaticaDaVenda(app, ctx, kind, id, versaoId);
  return confirmacaoAutomatica ? { ...corpo, confirmacaoAutomatica } : corpo;
}

/**
 * CARREGA O DOCUMENTO JÁ AMARRADO À VARIANTE DA PORTA (BASE2-03C).
 *
 * `erp.sales_documents` é UMA tabela com TRÊS variantes (`kind`), e cada variante tem a sua própria
 * família de capacidades: `budgets.*` × `orders.*` × `sales.*`. A porta é variante; o registro também
 * precisa ser. Antes desta fatia o carregamento olhava id + organização + exclusão + escopo de empresa e
 * NÃO olhava `kind`: quem tivesse `budgets.view` lia um PEDIDO ou uma VENDA pedindo o UUID pela rota de
 * orçamentos, e `budgets.delete` cancelava documento de outra variante. A conferência tardia que existia
 * no PUT chegava DEPOIS de o registro inteiro já ter sido lido — o que é conferência de apresentação,
 * não de autorização.
 *
 * `expectedKind` entra no WHERE da consulta principal. Variante errada é INEXISTENTE PARA AQUELA ROTA:
 * a mesma 404 de id inexistente, de outro tenant e de fora do escopo de empresa — sem revelar que o UUID
 * existe na variante vizinha, e sem redirecionar para a rota "certa".
 *
 * `opts.lock` acrescenta `for update of d` — e SÓ `of d`. `FOR UPDATE` sem lista de tabelas valeria também
 * para `t`, `pm`, `u`, `toper` e `topv`, que estão no lado NULLABLE dos LEFT JOIN, e o PostgreSQL RECUSA
 * isso já no planejamento (0A000): a rota quebraria em TODA chamada, não só na corrida.
 *
 * O lock existe para quem LÊ E MUTA a mesma linha, e hoje são TRÊS: a conversão (TOP-CONFIG-02) e, desde
 * o hotfix de concorrência, a CONFIRMAÇÃO e o CANCELAMENTO. Sem ele, duas requisições simultâneas leem o
 * MESMO snapshot e ambas executam os efeitos inteiros: a conversão cria DOIS destinos e as duas carimbam
 * a fonte como `converted` (e não há UNIQUE em `origin_document_id` para pegar a sobra); a confirmação
 * posta duas saídas de estoque e dois conjuntos de contas a receber; o cancelamento de venda confirmada
 * lança DOIS estornos da mesma saída. Com o lock, a segunda espera o commit da primeira, reavalia a linha
 * já atualizada e cai na recusa de ESTADO que sempre existiu — `assertConvertible`, ALREADY_CONFIRMED ou
 * ALREADY_CANCELLED, conforme a porta.
 *
 * Leitura pura (detalhe, listagem) continua SEM lock: travar linha para desenhar tela é serializar o que
 * não disputa nada.
 */
/** Uma próxima operação oferecida por um documento, já resolvida para a tela. */
interface ProximoPasso {
  tipoOperacaoId: string; codigo: string; nome: string;
  codigoBase: string; familiaRotulo: string; variante: SalesKind; ordem: number;
  /** TOP-CONFIG-06: a aresta permite converter em partes. */
  emPartes: boolean;
}

/**
 * A POLÍTICA DE PRÓXIMAS OPERAÇÕES DE UM DOCUMENTO: o ESTADO dela, e os passos que ela oferece HOJE.
 *
 * ┌─ POR QUE DUAS COISAS, E NÃO SÓ A LISTA ─────────────────────────────────────────────────────────────┐
 * │ `itens.length === 0` tem DUAS causas que pedem comportamentos OPOSTOS, e contar não as separa:      │
 * │                                                                                                      │
 * │   `configurada: false` → ninguém NUNCA declarou política para esta versão. É o acervo inteiro e é o │
 * │                          que o binário antigo grava. Só aqui a cadeia antiga continua valendo.       │
 * │   `configurada: true`  → a política foi declarada, e declarou ZERO destinos. É uma decisão, e o que │
 * │                          ela decide é que este documento NÃO gera próxima operação.                  │
 * │                                                                                                      │
 * │ O discriminador é a coluna `destinos_configurados` da VERSÃO (0022), nunca a cardinalidade. Antes    │
 * │ desta correção a conversão decidia por `passos.length > 0`, e a consequência era que a web obedecia  │
 * │ ao administrador e uma chamada direta à API convertia assim mesmo.                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AS DUAS PERGUNTAS, DE NOVO, PORQUE É AQUI QUE ELAS SE ENCONTRAM ───────────────────────────────────┐
 * │ A POLÍTICA vem de `tipo_operacao_versao_id` do documento: a versão que valia quando ele nasceu. Ela │
 * │ é história e não muda nunca — editar a TOP amanhã cria a versão N+1 e não mexe neste documento.     │
 * │                                                                                                      │
 * │ A DISPONIBILIDADE vem do estado atual da TOP de destino: `ativo and excluido_em is null`. Uma TOP    │
 * │ desativada some do leque SEM alterar a versão da origem — a política continua registrando que aquele │
 * │ caminho existiu, e é por isso que a conversão que já aconteceu continua explicável.                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * E O GRAFO NÃO AUTORIZA NINGUÉM: ele só RESTRINGE o caminho. Quem decide se o usuário pode percorrer o
 * caminho escolhido é a capacidade dele, cobrada na conversão. Habilitar uma aresta não concede permissão.
 *
 * UMA IDA AO BANCO. A versão de origem é o lado FIXO do `left join`: ela responde o estado mesmo quando
 * não há nenhuma aresta, e as arestas viajam na mesma resposta. Duas consultas dariam o mesmo resultado e
 * pagariam um `round trip` por documento aberto.
 */
interface PoliticaDeDestinos { configurada: boolean; itens: ProximoPasso[] }

async function politicaDeDestinos(ctx: ServiceCtx, versaoOrigemId: string | null | undefined): Promise<PoliticaDeDestinos> {
  // DOCUMENTO SEM TOP — acervo, ou criado por cliente anterior a esta fatia. Não há versão para ler, logo
  // não há política declarada: `false` é a descrição do que aconteceu, e é o que preserva a cadeia antiga
  // para esses documentos. Inventar a cadeia fixa como se fosse política seria o contrário do que a fatia
  // veio fazer.
  if (!versaoOrigemId) return { configurada: false, itens: [] };

  const r = await ctx.tx.query<{
    destinos_configurados: boolean; destino_id: string | null; codigo: string | null;
    nome: string | null; codigo_base: string | null; ordem: number | null; em_partes: boolean | null;
  }>(
    `select vo.destinos_configurados,
            t.id as destino_id, t.codigo, tv.nome, t.codigo_base, d.ordem, d.em_partes
       from erp.tipos_operacao_versoes vo
       left join erp.tipos_operacao_versao_destinos d
         on d.origem_versao_id = vo.id and d.organization_id = vo.organization_id
       left join erp.tipos_operacao t
         on t.id = d.destino_tipo_operacao_id and t.organization_id = d.organization_id
        and t.ativo and t.excluido_em is null
       left join erp.tipos_operacao_versoes tv
         on tv.tipo_operacao_id = t.id and tv.organization_id = t.organization_id and tv.versao = t.versao_atual
      where vo.organization_id = $1 and vo.id = $2
      order by d.ordem, t.codigo`,
    [ctx.orgId, versaoOrigemId]);

  const primeira = r.rows[0];
  if (!primeira) {
    // A VERSÃO QUE O DOCUMENTO CITA NÃO FOI LIDA — e aqui NÃO se escolhe uma das duas leituras no escuro.
    // Assumir "nunca declarou" liberaria a cadeia antiga sobre um documento cuja política ninguém
    // conseguiu ler, que é exatamente a conversão que esta correção existe para impedir. A FK composta da
    // 0021 (versão + TOP + organização) e a RLS do mesmo tenant tornam este caminho inalcançável enquanto
    // o documento for visível; se ele for alcançado, é corrupção, e recusar é a única resposta honesta.
    throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este documento");
  }

  const itens: ProximoPasso[] = [];
  for (const linha of r.rows) {
    // LINHA SEM DESTINO é o `left join` falando: ou a versão não tem aresta nenhuma (uma linha só, toda
    // nula), ou a aresta existe e o destino NÃO passa no filtro de hoje (desativado, excluído). Nos dois
    // casos não há passo a oferecer — e a aresta continua lá, congelada, explicando o que já aconteceu.
    if (!linha.destino_id || linha.codigo === null || linha.nome === null || linha.codigo_base === null || linha.ordem === null) continue;
    // FAIL-CLOSED na apresentação também: destino cuja família o produto não sabe criar não é oferecido.
    // Poderia existir se uma família saísse do registry depois de a aresta ter sido gravada — e oferecer
    // um botão sem serviço atrás é pior do que oferecer um botão a menos.
    const variante = varianteDeDocumentoVendaDaFamilia(linha.codigo_base);
    if (!variante) continue;
    itens.push({
      tipoOperacaoId: linha.destino_id, codigo: linha.codigo, nome: linha.nome,
      codigoBase: linha.codigo_base, familiaRotulo: t(chaveI18nDaFamiliaOperacional(linha.codigo_base) ?? linha.codigo_base),
      variante: variante as SalesKind, ordem: linha.ordem, emPartes: linha.em_partes === true
    });
  }
  return { configurada: primeira.destinos_configurados, itens };
}

export async function getDoc(ctx: ServiceCtx, id: string, expectedKind: SalesKind, opts: { lock?: boolean } = {}) {
  const sc = scopedById(ctx, "d", id); sc.params.push(expectedKind);
  // LEFT JOIN nos dois, e não INNER: documento legado tem os ponteiros nulos, e um INNER o faria SUMIR da
  // própria porta de detalhe — 404 num registro que está lá. O nome sai de `topv` (a versão CONGELADA),
  // nunca da versão corrente do pai: é isso que faz a renomeação administrativa de amanhã não reescrever
  // o que este documento diz que é.
  // TOP-CONFIG-07: `reserva_estoque` sai da versão CONGELADA (`topv`, já no join) — só pedido pode ser true.
  const r = await ctx.tx.query("select d.*, c.name as client_name, c.document as client_document, t.name as transporter_name, pm.name as payment_method_name, u.name as responsible_name, f.name as empresa_name, toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao, (d.kind = 'order' and coalesce(topv.reserva_estoque, false)) as reserva_estoque, fcat.code as categoria_financeira_codigo, fcat.name as categoria_financeira_nome, ccus.code as centro_custo_codigo, ccus.name as centro_custo_nome, cpag.code as condicao_pagamento_codigo, cpag.nome as condicao_pagamento_nome, ue.name as saldo_encerrado_por_nome from erp.sales_documents d join erp.people c on c.id=d.client_id left join erp.people t on t.id=d.transporter_id left join erp.payment_methods pm on pm.id=d.payment_method_id left join erp.users u on u.id=d.responsible_user_id join erp.empresas f on f.id=d.empresa_id left join erp.tipos_operacao toper on toper.id=d.tipo_operacao_id and toper.organization_id=d.organization_id left join erp.tipos_operacao_versoes topv on topv.id=d.tipo_operacao_versao_id and topv.organization_id=d.organization_id left join erp.financial_categories fcat on fcat.id=d.categoria_financeira_id and fcat.organization_id=d.organization_id left join erp.cost_centers ccus on ccus.id=d.centro_custo_id and ccus.organization_id=d.organization_id left join erp.condicoes_pagamento cpag on cpag.id=d.condicao_pagamento_id and cpag.organization_id=d.organization_id left join erp.users ue on ue.id=d.saldo_encerrado_por where d.id=$1 and d.organization_id=$2 and d.deleted_at is null and d.kind=$" + sc.params.length + sc.sql + (opts.lock ? " for update of d" : ""), sc.params); if (!r.rows[0]) throw notFound("Documento");
  // TOP-CONFIG-06: o faturado de cada item (partes NÃO canceladas) e quantas linhas o citam (inclusive canceladas)
  // vêm na MESMA consulta dos itens — nada de consulta por item. `faturado`/`saldo` só aparecem quando o documento
  // tem parte gerada; sem parte, os itens saem exatamente como antes.
  // TOP-CONFIG-07: `product_control_stock` (aditivo, do join que já existe) — a reserva, a guarda do armazém da parte e
  // a pré-conferência da saída deixam de fora o produto que não controla estoque.
  const itensLidos = await ctx.tx.query<Record<string, unknown> & { quantity: string; product_control_stock: boolean; fp_faturado: string; fp_ligadas: number }>("select i.*, p.description as product_name, p.code as product_code, p.control_stock as product_control_stock, mu.symbol as unit, w.description as warehouse_name, fp.faturado::text as fp_faturado, fp.ligadas::int as fp_ligadas from erp.sales_document_items i join erp.products p on p.id=i.product_id left join erp.measurement_units mu on mu.id=p.measurement_id left join erp.warehouses w on w.id=i.warehouse_id left join lateral (select coalesce(sum(pi.quantity) filter (where pd.status <> 'cancelled'), 0) as faturado, count(*) as ligadas from erp.sales_document_items pi join erp.sales_documents pd on pd.id=pi.document_id where pi.origem_item_id=i.id) fp on true where i.document_id=$1 order by i.position", [id]);
  const temParte = itensLidos.rows.some((x) => x.fp_ligadas > 0);
  const linha = r.rows[0] as Record<string, unknown> & { status: string; saldo_encerrado_em: unknown; reserva_estoque: boolean; tipo_operacao_id: string | null; top_codigo: string | null; top_codigo_base: string | null; top_nome: string | null; top_versao: number | null };
  /*
   * TOP-CONFIG-07: pedido com reserva — `reservado` por item, da MESMA consulta (o faturado da lateral acima). É a
   * parte A da conta do banco (`erp.reserva_estoque_nucleo`) item a item: o saldo a faturar enquanto o pedido está
   * aberto e sem saldo encerrado, e só em item com armazém (sem par não há reserva) de produto que controla estoque
   * (serviço e frete não têm saldo, e a conta do banco não os soma); fora disso, zero.
   */
  const reservaAtiva = linha.reserva_estoque && (linha.status === "open" || linha.status === "approved") && linha.saldo_encerrado_em === null;
  const items = { rows: itensLidos.rows.map(({ fp_faturado, fp_ligadas: _l, ...resto }) => ({
    ...(temParte ? { ...resto, faturado: D(fp_faturado).toFixed(4), saldo: saldoDoItem({ quantity: resto.quantity, faturado: fp_faturado }) } : resto),
    ...(linha.reserva_estoque ? { reservado: reservaAtiva && resto["warehouse_id"] && resto.product_control_stock !== false ? saldoDoItem({ quantity: resto.quantity, faturado: fp_faturado }) : "0.0000" } : {}),
  })) };
  const titles = await ctx.tx.query("select id, code, number, due_date, amount, balance, status from erp.financial_titles where organization_id=$1 and source_type='sales_documents' and source_id=$2 order by due_date", [ctx.orgId, id]);
  const derived = await ctx.tx.query("select id, kind, code, status from erp.sales_documents where origin_document_id=$1", [id]);
  return { ...linha, tipo_operacao: topParaTela(linha), items: items.rows, titles: titles.rows, derived: derived.rows } as Record<string, unknown>;
}

/**
 * O DOCUMENTO É VISÍVEL NESTE CONTEXTO? — conferido ANTES de entrar no helper de idempotência.
 *
 * `idempotent()` devolve o `response_body` gravado e NÃO executa o handler. Como é o handler que chama
 * `getDoc`, e é `getDoc` que aplica o recorte de EMPRESA, o replay atravessava a autorização DO REGISTRO:
 * `runService` confere autenticação, capacidade da rota e a empresa selecionada em termos gerais, e nada
 * disso olha para ESTE documento.
 *
 * `actorId` no hash fecha o replay entre atores DIFERENTES. Não fecha este, porque o ator é o MESMO: um
 * usuário com acesso às empresas A e B confirma o documento da empresa A com a chave K, troca o contexto
 * explícito para a empresa B e reenvia K. Sem esta conferência o helper devolve 200 com o corpo gravado
 * (`title_ids` inclusive) num contexto em que a chamada normal responde 404 — e a superfície de recusa que
 * `.claude/rules/security.md` exige (fora de escopo indistinguível de inexistente) vaza pela idempotência.
 *
 * REUSA `getDoc`, e é por isso que não carrega consulta própria. Uma variante enxuta (`select 1` com
 * `scopedById`) pouparia três consultas e criaria uma SEGUNDA regra de autorização, livre para divergir da
 * primeira no dia em que uma das duas mudasse — e divergir para o lado permissivo aqui é exatamente o
 * vazamento que esta função existe para fechar. A regra tem de ser a MESMA, não "equivalente".
 *
 * SEM `lock`: é leitura. A ordem de aquisição da parte MUTANTE não muda — `erp.idempotency_keys` continua
 * sendo o primeiro lock, e só depois vem o `for update of d` do handler. Inverter isso criaria aresta de
 * deadlock com toda rota que já reserva a chave antes de tocar o registro.
 */
export async function exigirDocumentoVisivel(ctx: ServiceCtx, id: string, expectedKind: SalesKind): Promise<void> {
  await getDoc(ctx, id, expectedKind);
}

/**
 * EDITAR-01_R1 (1.2 k) — A TRAVA DA PATCH, SEM JUNÇÃO: só `erp.sales_documents`, só `id` e `version`.
 *
 * O `getDoc` com `lock` junta `erp.people` (cliente) e trava `of d`. Sob READ COMMITTED, quem espera a trava relê a
 * linha nova e REAVALIA a junção com o cliente da foto antiga: se a gravação concorrente trocou o cliente, a linha
 * some da consulta e a edição respondia 404 — "não existe" — sobre um documento que só MUDOU. O certo é o 409 da
 * versão, e é o que esta trava entrega: sem junção, a reavaliação só olha a própria linha.
 *
 * O RECORTE é o MESMO do `getDoc` (organização, variante, excluído e escopo de empresa, pelo `scopedById`): zero
 * linhas é a MESMA 404. Depois de conferir a versão, a edição lê o documento pelo `getDoc` SEM trava — a linha já está
 * travada por esta transação, e o que ele lê é o que vale até o commit.
 */
export async function travarDocumentoDaEdicao(ctx: ServiceCtx, id: string, expectedKind: SalesKind): Promise<{ id: string; version: string }> {
  const sc = scopedById(ctx, "d", id); sc.params.push(expectedKind);
  const r = await ctx.tx.query<{ id: string; version: string }>("select d.id, d.version from erp.sales_documents d where d.id=$1 and d.organization_id=$2 and d.deleted_at is null and d.kind=$" + sc.params.length + sc.sql + " for update of d", sc.params);
  if (!r.rows[0]) throw notFound("Documento");
  return r.rows[0];
}

/**
 * EDITAR-01_R1 (1.2 y) — A REFERÊNCIA QUE A PATCH TROCA EXISTE NESTA ORGANIZAÇÃO?
 *
 * A FK de coluna única (`client_id`, `transporter_id`, `proprietary_id` → `erp.people`; `payment_method_id` →
 * `erp.payment_methods`) prova que a linha existe, não que é do tenant: a checagem da FK não passa pela RLS, e uma
 * transportadora de OUTRA organização era gravada. Aqui: pessoa desta organização e não excluída; forma de pagamento
 * desta organização ou a padrão do sistema (`organization_id` nulo — o mesmo recorte do cadastro, `sharedDefaults`).
 * Inexistente, de outra organização e excluída caem na MESMA recusa (422 no campo): distinguir seria oráculo.
 * Só o campo que a PATCH TROCA (`mudancas`): o gravado não é reconferido. Duas consultas no máximo, nunca uma por campo.
 * `for share` nas pessoas: a exclusão concorrente espera o commit desta edição (o mesmo cuidado do documento de compra).
 * POST e PUT ficam como estão (débito declarado).
 */
async function conferirReferenciasDaEdicao(ctx: ServiceCtx, mudancas: Record<string, unknown>): Promise<void> {
  const trocadas = (Object.keys(REFERENCIAS_DA_EDICAO) as (keyof typeof REFERENCIAS_DA_EDICAO)[])
    .filter((campo) => typeof mudancas[campo] === "string")
    .map((campo) => ({ campo, valor: String(mudancas[campo]).toLowerCase(), ...REFERENCIAS_DA_EDICAO[campo] }));
  if (!trocadas.length) return;
  const pessoas = trocadas.filter((t) => t.tabela === "people").map((t) => t.valor);
  const formas = trocadas.filter((t) => t.tabela === "payment_methods").map((t) => t.valor);
  const achadas = new Set<string>();
  if (pessoas.length) {
    const r = await ctx.tx.query<{ id: string }>("select id::text as id from erp.people where organization_id=$1 and deleted_at is null and id = any($2::uuid[]) for share", [ctx.orgId, pessoas]);
    for (const x of r.rows) achadas.add(`people:${x.id}`);
  }
  if (formas.length) {
    const r = await ctx.tx.query<{ id: string }>("select id::text as id from erp.payment_methods where (organization_id is null or organization_id=$1) and id = any($2::uuid[])", [ctx.orgId, formas]);
    for (const x of r.rows) achadas.add(`payment_methods:${x.id}`);
  }
  const details = trocadas.filter((t) => !achadas.has(`${t.tabela}:${t.valor}`)).map((t) => ({ path: t.campo, message: t.mensagem }));
  if (details.length) throw err("VALIDATION_ERROR", details[0]!.message, details);
}
/**
 * Grava o documento. `top` tem TRÊS estados, e a diferença entre eles é o contrato de preservação:
 *
 *   `undefined` → NÃO TOCA nas colunas de TOP. É o que um PUT sem o campo faz, e é o que preserva o
 *                 snapshot de um documento antigo quando o usuário salva outro campo qualquer. Sem este
 *                 estado, editar o frete de uma venda de 2024 a re-carimbaria com a versão de hoje.
 *   `null`      → grava NULL/NULL. É a criação por cliente legado, que não declarou TOP nenhuma.
 *   objeto      → grava o snapshot resolvido pelo servidor.
 */
/**
 * EDITAR-01 — como `writeDoc` grava os itens e o plano numa EDIÇÃO. Omitido = o de hoje (criação, conversão, PUT).
 *
 *   itens `substituir` (padrão) → apaga todos e insere de novo, ligados por `origemItemIds[i]` — o PUT, inalterado.
 *   itens `manter`              → nenhuma linha de `erp.sales_document_items` é tocada; os totais saem dos gravados.
 *   itens `porId`               → em lugar: DELETE dos que saíram, UPDATE dos alterados (mesmo id, mesmo
 *                                 `origem_item_id`), INSERT dos novos; `position` = índice. Cada escrita confere
 *                                 ROW COUNT (item fora do documento vira zero linhas, e zero linhas não é sucesso).
 *   `planoMantido`              → o plano e `parcelas_ajustadas` gravados, sem refazer a conta (`planoDaEdicao`).
 */
interface OpcoesDaGravacao { itens?: { modo: "substituir" } | ItensDaEdicao; planoMantido?: { valor: Record<string, unknown>; ajustadas: boolean } | null }

async function writeDoc(ctx: ServiceCtx, kind: SalesKind, d: z.infer<typeof docSchema>, existingId?: string, origin?: string | null, top?: TopDoLancamento | null, classificacao?: ClassificacaoFinanceira | null, condicao: { linha: CondicaoDoDocumento | null; gravar: boolean } = { linha: null, gravar: true }, origemItemIds: readonly (string | null)[] = [], opcoes: OpcoesDaGravacao = {}) {
  const totals = documentTotals(d.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, discount: i.discount, discountPercent: i.discount_percent })), { freight: d.freight, freightIcms: d.freight_icms, otherValues: d.other_values, discount: d.discount });
  let id = existingId;
  /*
   * O PLANO GRAVADO (VENDAS-A4). Corpo com plano → o do corpo; ajustado se o documento tem condição.
   * Corpo sem plano e documento COM condição → derivado pela conta única do domínio, na data e no total
   * que estão sendo gravados (o mesmo `total` que a confirmação usa nos títulos); não ajustado.
   * Sem condição e sem plano → como antes, mas a marca de dedutível (D-1) sobrevive sem plano.
   * EDITAR-01: a PATCH que não mexe em nada de que o plano derive o MANTÉM (`planoMantido`) — a conta é esta mesma.
   */
  const plan: Record<string, unknown> = opcoes.planoMantido ? opcoes.planoMantido.valor
    : d.installment_plan ? { ...d.installment_plan, is_deductible: d.is_deductible }
    : condicao.linha ? { ...planoDaCondicao(condicao.linha, { dataDocumento: d.document_date, total: totals.total }), is_deductible: d.is_deductible }
    : d.is_deductible ? { is_deductible: true } : {};
  const parcelasAjustadas = opcoes.planoMantido ? opcoes.planoMantido.ajustadas : Boolean(d.installment_plan) && condicao.linha !== null;
  const modoItens = opcoes.itens ?? { modo: "substituir" as const };
  if (!id) { const code = await nextCode(ctx.tx, ctx.orgId, `sales_${kind}`); id = (await ctx.tx.query<{ id: string }>("insert into erp.sales_documents(organization_id,empresa_id,kind,code,document_date,shipping_date,due_date,responsible_user_id,client_id,transporter_id,proprietary_id,driver_name,payment_method_id,subtotal,freight,freight_icms,other_values,discount,total,note,installment_plan,origin_document_id,tipo_operacao_id,tipo_operacao_versao_id,categoria_financeira_id,centro_custo_id,condicao_pagamento_id,parcelas_ajustadas,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$8) returning id", [ctx.orgId, d.empresa_id, kind, code, d.document_date, d.shipping_date ?? null, d.due_date ?? null, ctx.user.id, d.client_id, d.transporter_id ?? null, d.proprietary_id ?? null, d.driver_name ?? null, d.payment_method_id ?? null, totals.subtotal, money(d.freight), money(d.freight_icms), money(d.other_values), money(d.discount), totals.total, d.note ?? null, JSON.stringify(plan), origin ?? null, top?.tipoOperacaoId ?? null, top?.tipoOperacaoVersaoId ?? null, classificacao?.categoriaFinanceiraId ?? null, classificacao?.centroCustoId ?? null, condicao.linha?.id ?? null, parcelasAjustadas])).rows[0]!.id; await atribuirIdGlobal(ctx, "sales_documents", id); }
  else {
    // As colunas de TOP só entram no SET quando houve decisão explícita. `undefined` preserva o snapshot.
    const topSet = top === undefined ? "" : ", tipo_operacao_id=$19, tipo_operacao_versao_id=$20";
    const topParams = top === undefined ? [] : [top?.tipoOperacaoId ?? null, top?.tipoOperacaoVersaoId ?? null];
    // Mesma regra para a classificação: `undefined` preserva; só a decisão explícita entra no SET.
    const n0 = 19 + topParams.length;
    const classSet = classificacao === undefined ? "" : `, categoria_financeira_id=$${n0}, centro_custo_id=$${n0 + 1}`;
    const classParams = classificacao === undefined ? [] : [classificacao?.categoriaFinanceiraId ?? null, classificacao?.centroCustoId ?? null];
    // Condição: `gravar: false` preserva a coluna; `parcelas_ajustadas` acompanha sempre o plano gravado.
    const n1 = n0 + classParams.length;
    const condSet = `, parcelas_ajustadas=$${n1}` + (condicao.gravar ? `, condicao_pagamento_id=$${n1 + 1}` : "");
    const condParams: unknown[] = condicao.gravar ? [parcelasAjustadas, condicao.linha?.id ?? null] : [parcelasAjustadas];
    const u = await ctx.tx.query(`update erp.sales_documents set document_date=$3, shipping_date=$4, due_date=$5, client_id=$6, transporter_id=$7, proprietary_id=$8, driver_name=$9, payment_method_id=$10, subtotal=$11, freight=$12, freight_icms=$13, other_values=$14, discount=$15, total=$16, note=$17, installment_plan=$18${topSet}${classSet}${condSet}, updated_at=now() where id=$1 and organization_id=$2`, [id, ctx.orgId, d.document_date, d.shipping_date ?? null, d.due_date ?? null, d.client_id, d.transporter_id ?? null, d.proprietary_id ?? null, d.driver_name ?? null, d.payment_method_id ?? null, totals.subtotal, money(d.freight), money(d.freight_icms), money(d.other_values), money(d.discount), totals.total, d.note ?? null, JSON.stringify(plan), ...topParams, ...classParams, ...condParams]);
    // ROW COUNT SOB RLS: a edição travou a linha antes (PUT: `getDoc` com `lock`; PATCH: `travarDocumentoDaEdicao`), então zero aqui é o impossível — e o
    // impossível não vira "salvo" sem efeito.
    if (u.rowCount !== 1) throw notFound("Documento");
    if (modoItens.modo === "substituir") await ctx.tx.query("delete from erp.sales_document_items where document_id=$1", [id]);
  }
  const valoresDoItem = (it: z.infer<typeof docSchema>["items"][number]) => [it.product_id, it.warehouse_id ?? null, it.quantity, it.unit_price, money(it.discount), it.discount_percent, itemTotal({ quantity: it.quantity, unitPrice: it.unit_price, discount: it.discount, discountPercent: it.discount_percent }), it.note ?? null];
  if (modoItens.modo === "substituir") {
    // TOP-CONFIG-06: `origemItemIds[i]` liga a linha i ao item de origem (parte gerada). Vazio = sem ligação, como antes.
    for (const [i, it] of d.items.entries()) await ctx.tx.query("insert into erp.sales_document_items(document_id,product_id,warehouse_id,quantity,unit_price,discount,discount_percent,total,note,position,origem_item_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [id, it.product_id, it.warehouse_id ?? null, it.quantity, it.unit_price, money(it.discount), it.discount_percent, itemTotal({ quantity: it.quantity, unitPrice: it.unit_price, discount: it.discount, discountPercent: it.discount_percent }), it.note ?? null, i, origemItemIds[i] ?? null]);
  } else if (modoItens.modo === "porId") {
    // EDITAR-01 — EM LUGAR. `document_id` em toda cláusula: o id do item só vale DENTRO deste documento.
    if (modoItens.removidos.length) {
      const del = await ctx.tx.query("delete from erp.sales_document_items where document_id=$1 and id = any($2::uuid[])", [id, modoItens.removidos]);
      if (del.rowCount !== modoItens.removidos.length) throw notFound("Documento");
    }
    for (const [i, it] of d.items.entries()) {
      const itemId = modoItens.ids[i] ?? null;
      if (itemId === null) {
        await ctx.tx.query("insert into erp.sales_document_items(document_id,product_id,warehouse_id,quantity,unit_price,discount,discount_percent,total,note,position,origem_item_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null)", [id, ...valoresDoItem(it), i]);
      } else if (modoItens.alterados[i]) {
        // `origem_item_id` fora do SET: a ligação da parte gerada é a do item, e o item é o mesmo.
        const up = await ctx.tx.query("update erp.sales_document_items set product_id=$3, warehouse_id=$4, quantity=$5, unit_price=$6, discount=$7, discount_percent=$8, total=$9, note=$10, position=$11 where id=$1 and document_id=$2", [itemId, id, ...valoresDoItem(it), i]);
        if (up.rowCount !== 1) throw notFound("Documento");
      }
    }
  }
  // OPERACOES-01 F9 (decisão 286): o pedido de venda refaz a PROVISÃO a cada gravação (criar, PUT, PATCH, conversão do
  // orçamento) — idempotente; TOP que não provisiona e nenhum previsto gravado = nenhum efeito.
  if (kind === "order") await sincronizarProvisaoDoPedido(ctx, id, MOTIVOS_DA_PROVISAO.pedidoGravado);
  return { id, ...totals };
}

/** O que o núcleo da edição recebe — o PUT e a PATCH o montam de jeitos diferentes, e é SÓ isso que difere. */
interface EdicaoParaSalvar {
  /** O documento COMO FICARÁ. PUT: o corpo; PATCH: o gravado + o que muda. */
  d: z.infer<typeof docSchema>;
  /** O corpo de "três estados" (ausente = preserva o gravado). PUT: o corpo inteiro; PATCH: só os campos que MUDAM. */
  corpo: Record<string, unknown>;
  /** Para cada `d.items[k]`, o item gravado que ele é. PUT: o da MESMA posição; PATCH: o de mesmo `id` (novo = nenhum). */
  pares: readonly (ItemGravado | undefined)[];
  itens: { modo: "substituir"; origemItemIds: readonly (string | null)[] } | ItensDaEdicao;
  /**
   * PATCH (EDITAR-01_R1, 1.2 h e m): logo antes de gravar — no MESMO ponto em que o PUT calcula os totais dentro do
   * `writeDoc`, depois de todas as recusas —, o núcleo calcula os totais, confere que cabem nas colunas e decide o
   * plano (`planoDaEdicao`). Ausente = o PUT, exatamente como antes.
   */
  parcial?: boolean;
  /**
   * TOP-CONFIG-08 — a recusa dos itens vazios com o erro do ESTRITO de cada porta (PUT: o `docSchema`; PATCH: o
   * `edicaoSchema` pelo `lerPedidoDaEdicao`). Chamada pelo núcleo quando a versão não aceita venda sem itens.
   */
  recusarSemItens: () => never;
}

/**
 * EDITAR-01 (decisão 272) — O NÚCLEO ÚNICO DA EDIÇÃO: as MESMAS conferências e a MESMA gravação para o PUT e a PATCH.
 *
 * Extraído do PUT sem mudar nada dele (ordem, códigos, mensagens, efeitos): o PUT chama com o corpo dele; a PATCH
 * com o documento gravado + o que muda. Não há regra da edição fora daqui — se houvesse, as duas portas divergiriam
 * no primeiro ajuste de uma delas, e a tela que usa a PATCH aceitaria o que o PUT recusa (ou o contrário).
 *
 * Quem chama já travou a linha (PUT: `getDoc` com `lock`; PATCH: `travarDocumentoDaEdicao`, sem junção) e já passou
 * pelas recusas de estado (`recusaDaEdicao`).
 */
async function salvarEdicao(ctx: ServiceCtx, kind: SalesKind, id: string, cur: DocumentoGravado, e: EdicaoParaSalvar) {
  // `id` é o da URL (EDITAR-01_R1, 1.2 n): o PUT devolve `r.id`, e ele volta a ser o da requisição, como antes.
  const { d, corpo } = e;
  /*
   * TOP-CONFIG-08 (decisão 277) — DOCUMENTO SEM ITENS, a PRIMEIRA conferência do núcleo: a versão que vale para a
   * edição é a que o PUT de hoje decide — a congelada do documento ou, se o PUT troca a TOP, a atual da TOP nova (o
   * MESMO `resolverTopParaLancamento` de baixo: a recusa da TOP pode vir antes; com os itens vazios ela é resolvida duas
   * vezes, e só então). A versão no formato 4 com "Permitido" aceita itens []; qualquer outra recusa com o erro de hoje
   * do estrito. Antes das recusas da parte gerada e da reserva de propósito: itens vazios como único defeito respondem
   * o que respondiam. Na PATCH, a 404, o 409 da versão e o 409 da situação já vieram antes (ordem declarada).
   */
  if (d.items.length === 0) {
    const versao = d.tipo_operacao_id != null && d.tipo_operacao_id !== cur.tipo_operacao_id
      ? (await resolverTopParaLancamento(ctx, familiaDaVariante(kind), d.tipo_operacao_id)).tipoOperacaoVersaoId
      : cur.tipo_operacao_versao_id;
    if (!(await aceitaSemItens(ctx, kind, versao))) e.recusarSemItens();
  }
  // A venda gerada de pedido com reserva: a mesma pergunta serve à guarda do armazém da parte (abaixo) e à
  // conferência da reserva (antes de gravar). UMA consulta, e só quando a venda tem origem.
  const origemReserva = kind === "sale" && cur.origin_document_id ? await origemReservaEstoque(ctx, cur.origin_document_id) : false;
  // TOP-CONFIG-06 — A PARTE GERADA: itens com mesmo produto, quantidade, preço e descontos (e na mesma quantidade de
  // linhas). Só armazém e observação do item mudam. O PUT compara pela POSIÇÃO (a ligação é preservada pela posição);
  // a PATCH, pelo ID do item (`pares`) — a ligação é a do próprio item, que é gravado em lugar.
  // EDITAR-01_R1 (p): os limites saem da função ÚNICA que o `/edicao` também mostra — a tela trava o que a gravação
  // recusa. A reserva da origem já lida vai junto: nenhuma consulta a mais.
  const limites = await limitesDaEdicao(ctx, kind, cur, { origemReserva });
  if (limites.somenteArmazemEObservacao) {
    const iguais = d.items.length === cur.items.length && d.items.every((n, k) => {
      const o = e.pares[k];
      return o !== undefined && n.product_id === o.product_id && D(n.quantity).eq(o.quantity) && D(n.unit_price).eq(o.unit_price) && D(n.discount).eq(o.discount) && D(n.discount_percent).eq(o.discount_percent);
    });
    if (!iguais) {
      const origem = cur.origin_document_id ? (await ctx.tx.query<{ code: string; kind: string }>("select code, kind from erp.sales_documents where id=$1 and organization_id=$2", [cur.origin_document_id, ctx.orgId])).rows[0] : undefined;
      const mensagem = msgItensDaParte(kind, origem?.kind, origem?.code);
      throw err("VALIDATION_ERROR", mensagem, [{ path: "items", message: mensagem }]);
    }
    /*
     * TOP-CONFIG-07 — A PARTE DE PEDIDO COM RESERVA NÃO TROCA DE ARMAZÉM (revisão adversarial). A parte A da conta
     * desconta do item do pedido toda parte não cancelada, em qualquer armazém; a parte B conta a parte no armazém
     * dela. Com o armazém trocado, o armazém do pedido fica livre para outra saída — e cancelar a parte devolve a
     * reserva ao armazém do pedido sem conferir: disponível negativo por um fluxo comum. Mantendo o armazém, a
     * reserva que a parte carrega é sempre a mesma que o pedido deixou de carregar.
     * Item de produto SEM controle de estoque fica fora da guarda: não reserva (a conta não o soma), então o armazém
     * dele não carrega reserva nenhuma. O produto é o mesmo da origem (`iguais`), e o flag vem do `getDoc`.
     * A comparação é em MINÚSCULAS: o zod aceita UUID em maiúsculas e o gravado vem do banco em minúsculas — o
     * mesmo armazém repetido em maiúsculas não é troca.
     */
    // `armazemTravado` é por item GRAVADO (`limites.itens`, na ordem do documento); `pares[k]` é o gravado que o item
    // k é — no PUT, o da mesma posição; na PATCH, o de mesmo id.
    const travado = new Map(limites.itens.map((i) => [i.id, i.armazemTravado]));
    const trocados = d.items.flatMap((n, k) => travado.get(e.pares[k]!.id) === true && (n.warehouse_id?.toLowerCase() ?? null) !== (e.pares[k]!.warehouse_id?.toLowerCase() ?? null)
      ? [{ path: `items[${k}].warehouse_id`, message: MSG_PARTE_RESERVA_ARMAZEM }] : []);
    if (trocados.length) throw err("VALIDATION_ERROR", MSG_PARTE_RESERVA_ARMAZEM, trocados);
  }
  /**
   * `null` EXPLÍCITO É RECUSADO — e a diferença para o campo AUSENTE é o contrato inteiro.
   *
   * `z.object` entrega `undefined` nos dois casos depois do parse, então a distinção tem de ser feita
   * ANTES, no corpo cru. Sem ela, `{"tipo_operacao_id": null}` caía no mesmo caminho de "não trocou" e
   * era ignorado em silêncio: o cliente pedia para REMOVER a TOP, recebia 200, e o documento continuava
   * com a que tinha. Descarte silencioso de campo é ampliação de escopo pela porta de trás
   * (`.claude/rules/backend-api.md`), e aqui ainda por cima sobre a identidade do lançamento.
   *
   * Recusar, e não obedecer, é a escolha certa: "sem TOP" é estado de NASCIMENTO (acervo, cliente
   * anterior à fatia), não destino alcançável por edição. Apagar a identidade de um lançamento já
   * classificado reescreveria história pela porta da edição — exatamente o que o snapshot existe para
   * impedir. O campo AUSENTE continua sendo compatibilidade legítima e não muda nada.
   *
   * A recusa é SÓ no PUT, e SÓ quando há o que remover. Num documento que JÁ é legado, `null` não é
   * pedido de remoção — é o estado atual, e o servidor acabou de devolvê-lo assim no `GET`. Recusar
   * aí tornaria o ACERVO inteiro ineditável por qualquer cliente read-modify-write (ler, mudar a
   * observação, devolver o objeto): ele levaria 422 por repetir um campo que o próprio servidor lhe
   * entregou. Seria quebrar exatamente a população que esta fatia promete não quebrar.
   * (A PATCH nunca chega aqui com o campo: `tipo_operacao_id` na PATCH é recusado já na forma do pedido.)
   *
   * Na CRIAÇÃO, `null` é legítimo e continua nascendo legado: é o que sustenta o rolling deploy.
   */
  if (cur.tipo_operacao_id !== null && corpo["tipo_operacao_id"] === null) {
    throw err("VALIDATION_ERROR", "tipo_operacao_id não pode ser removido de um documento; omita o campo para preservá-lo");
  }
  const trocouTop = d.tipo_operacao_id != null && d.tipo_operacao_id !== cur.tipo_operacao_id;
  const top = trocouTop ? await resolverTopParaLancamento(ctx, familiaDaVariante(kind), d.tipo_operacao_id!) : undefined;
  const classificacao = await classificacaoDaEdicao(ctx, corpo, cur);
  const condicao = await condicaoDaEdicao(ctx, corpo, cur);
  // O documento COMO FICARÁ: campos de três estados ausentes preservam o gravado (e contam como preenchidos).
  const comoFicara = { ...d,
    tipo_operacao_id: top ? top.tipoOperacaoId : cur.tipo_operacao_id,
    categoria_financeira_id: classificacao === undefined ? cur.categoria_financeira_id : classificacao?.categoriaFinanceiraId ?? null,
    centro_custo_id: classificacao === undefined ? cur.centro_custo_id : classificacao?.centroCustoId ?? null,
    condicao_pagamento_id: condicao.gravar ? condicao.linha?.id ?? null : cur.condicao_pagamento_id };
  // TOP-CONFIG-05: as regras da versão em que o documento NASCEU (ou a atual da TOP nova, se o PUT a troca).
  // Condição só é conferida quando o corpo a ENVIA (na PATCH, o corpo só tem o que MUDA: "a PATCH troca a condição");
  // atraso só quando o cliente muda.
  const versaoDasRegras = top ? top.tipoOperacaoVersaoId : cur.tipo_operacao_versao_id;
  await cobrarRegrasDaOperacao(ctx, versaoDasRegras ? await regrasDaVersaoTop(ctx, versaoDasRegras) : null, comoFicara, {
    conferirCondicao: corpo["condicao_pagamento_id"] !== undefined && corpo["condicao_pagamento_id"] !== null,
    conferirAtraso: d.client_id !== cur.client_id });
  await cobrarLayoutAoSalvar(ctx, kind, comoFicara);
  /*
   * TOP-CONFIG-07 — RESERVA DE ESTOQUE. DEPOIS das guardas de status e da 06 (origem com partes já foi recusada lá
   * em cima, antes de travar produto) e de todas as recusas de antes; imediatamente ANTES de gravar. A empresa é a
   * GRAVADA (`cur.empresa_id`): a edição não muda empresa. O próprio documento sai da conta — salvar de novo o que já
   * estava reservado não conta contra si.
   *   pedido → a versão congelada (`cur.reserva_estoque`, lida no `getDoc` — zero consulta) ou, se o PUT troca a
   *            TOP, a versão nova (uma consulta).
   *   venda  → só a gerada de pedido com reserva (parte B da conta): não pode crescer, nem mudar de armazém, sem
   *            caber. Uma consulta, e só quando a venda tem origem.
   *   orçamento → nunca.
   * EDITAR-01: a PATCH que não mexe nos itens (`manter`) não pergunta — a reserva só depende dos itens e da empresa, e
   * nenhum dos dois muda; perguntar recusaria a correção de uma observação porque o estoque de outro pedido andou.
   */
  const reservaNoPut = e.itens.modo !== "manter" && (kind === "order" ? (top ? await versaoReservaEstoque(ctx, top.tipoOperacaoVersaoId) : cur.reserva_estoque === true)
    : origemReserva);
  if (reservaNoPut) await conferirReservaDoDocumento(ctx, { itens: d.items, empresaId: cur.empresa_id, excluirDocumentoId: id });
  /*
   * EDITAR-01_R1 (1.2 h e m) — SÓ A PATCH, e no ponto exato em que o PUT calcula os totais (a 1ª linha do `writeDoc`):
   * a MESMA conta do domínio ("Desconto maior…"/"Total negativo" saem daqui, na mesma ordem das duas portas), depois
   * o total que não cabe na coluna (422 no campo, e não o 500 do banco), e só então o plano, que depende do total.
   */
  let planoMantido: { valor: Record<string, unknown>; ajustadas: boolean } | null = null;
  if (e.parcial) {
    const totais = documentTotals(d.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, discount: i.discount, discountPercent: i.discount_percent })),
      { freight: d.freight, freightIcms: d.freight_icms, otherValues: d.other_values, discount: d.discount });
    recusaDosTotaisDaEdicao(d.items.map((i) => ({ ...i, warehouse_id: i.warehouse_id ?? null, note: i.note ?? null })), totais);
    planoMantido = planoDaEdicao(cur, corpo, totais.total);
  }
  const r = await writeDoc(ctx, kind, d, id, undefined, top, classificacao, condicao, e.itens.modo === "substituir" ? e.itens.origemItemIds : [], { itens: e.itens, planoMantido });
  return { r, top };
}
/**
 * A POLÍTICA DE ESTOQUE E FINANCEIRO DESTA VENDA — lida da VERSÃO CONGELADA, e só dela (TOP-CONFIG-04A).
 *
 * A autoridade é `sales_documents.tipo_operacao_versao_id` → a linha EXATA de `erp.tipos_operacao_versoes`.
 * Nunca `tipos_operacao.versao_atual`: a TOP pode ter sido editada depois do lançamento, e a venda antiga
 * executaria a regra de hoje sobre um documento emitido sob a de ontem. Por isso a consulta não toca o
 * ponteiro corrente do pai — ela lê do pai só a FAMÍLIA, que é imutável.
 *
 * SEM FILTRO DE ESTADO NO PAI (ativo, excluído): desativar ou excluir a TOP depois do lançamento não troca
 * a versão que o documento cita, e o documento continua sendo confirmado pela regra que ele capturou —
 * o mesmo contrato que `politicaDeDestinos` segue para a conversão. SEM LOCK na versão: ela é imutável
 * (a 0020 revogou `update`/`delete` dela do papel da aplicação), e `for share` exigiria justamente o
 * privilégio revogado.
 *
 * UMA consulta por confirmação, nunca por item: a política é resolvida uma vez e vale para o documento.
 *
 * O GATE (`execucaoConfiguradaHabilitada`) CHEGA COMO PARÂMETRO OBRIGATÓRIO de quem monta a rota, lido de
 * `app.config`. Um valor padrão aqui deixaria um chamador esquecido executar em silêncio o caminho errado.
 *
 * TOP-CONFIG-08 (decisão 277): devolve também a VERSÃO CONGELADA já lida (família + configuração; `null` = sem TOP) —
 * é dela que o passo da aprovação pergunta, sem uma segunda leitura da mesma linha.
 */
async function politicaDaVenda(ctx: ServiceCtx, versaoId: string | null, execucaoConfiguradaHabilitada: boolean): Promise<{ politica: PoliticaEfetivaDaVenda; versaoCongelada: { codigoBase: string; configuracao: unknown } | null }> {
  let versaoCongelada: { codigoBase: string; configuracao: unknown } | null = null;
  if (versaoId) {
    const r = await ctx.tx.query<{ configuracao: unknown; codigo_base: string }>(
      `select v.configuracao, t.codigo_base
         from erp.tipos_operacao_versoes v
         join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.organization_id = v.organization_id
        where v.id = $1 and v.organization_id = $2`,
      [versaoId, ctx.orgId]);
    const linha = r.rows[0];
    // A FK composta da 0021 e a RLS do mesmo tenant tornam este caminho inalcançável enquanto o documento
    // for visível. Alcançado, é corrupção — e decidir "então é legado" seria exatamente o fallback proibido.
    if (!linha) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este documento");
    versaoCongelada = { codigoBase: linha.codigo_base, configuracao: linha.configuracao };
  }
  const r = resolverPoliticaEfetivaDaVenda({ versaoCongelada, execucaoConfiguradaHabilitada });
  if (r.ok) return { politica: r.politica, versaoCongelada };
  // FAIL-CLOSED, SEM EFEITO: esta recusa acontece antes do período, do estoque e do financeiro. A mensagem
  // não carrega identificador de TOP nem de versão — só o que o usuário pode fazer a respeito.
  const mensagem = r.motivo === "execucao_desligada"
    ? "A operação desta venda usa execução configurada, que ainda não está habilitada neste ambiente. A venda não foi confirmada."
    : r.motivo === "configuracao_ilegivel"
      ? "A configuração da operação desta venda está num formato que este servidor não executa. A venda não foi confirmada."
      : "A configuração da operação desta venda pede um efeito que esta versão do produto não executa. A venda não foi confirmada.";
  throw new DomainError("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", mensagem,
    { motivo: r.motivo, recusas: r.recusas.map(({ motivo, caminho, mensagem: m }) => ({ motivo, caminho, mensagem: m })) });
}

/**
 * CONFIRMAÇÃO DE VENDA — a linha da venda é o COORDENADOR da operação, e por isso é travada primeiro.
 *
 * Confirmar não é gravar um campo: é postar saída de estoque de cada item, gerar as contas a receber e
 * só então mover o status. Duas requisições simultâneas liam `open` do MESMO snapshot, passavam as duas
 * pela conferência de status e executavam os efeitos INTEIROS duas vezes — dois conjuntos de movimentos
 * de estoque e dois conjuntos de títulos, ambos com resposta de sucesso. Nada na tela denunciaria; a
 * conferência do mês encontraria o dobro do estoque baixado e a receita duplicada.
 *
 * "Está dentro de uma transação" não resolve: em READ COMMITTED duas transações leem o mesmo estado
 * inicial e ambas são internamente consistentes. O que faltava era SERIALIZAÇÃO, e ela tem de acontecer
 * ANTES da primeira decisão — a de status. Com `lock: true`, a segunda espera o commit da primeira,
 * relê a linha JÁ atualizada e cai em ALREADY_CONFIRMED (409), sem efeito nenhum.
 *
 * A trava vale para a corrida com o CANCELAMENTO pelo mesmo motivo e na mesma linha: quem chegar
 * segundo decide sobre o estado que o primeiro deixou, nunca sobre o que leu antes dele.
 *
 * ┌─ QUEM DECIDE O EFEITO (TOP-CONFIG-04A) ────────────────────────────────────────────────────────────┐
 * │ A política é resolvida UMA vez, da versão congelada, ANTES de qualquer efeito. Cada efeito tem dois │
 * │ caminhos e só dois: LEGADO executa exatamente o código de antes (mesmas consultas, mesma ordem,    │
 * │ mesmo fallback de vencimento); CONFIGURADA executa a MESMA primitiva (`postStock`, `createTitles`) │
 * │ com os mesmos identificadores de origem — é isso que mantém cancelamento, relatórios e conciliação │
 * │ funcionando sem saber de onde veio a decisão — ou não executa nada, quando a versão diz "nenhum".  │
 * │ As exigências da versão (armazém, forma de pagamento, vencimento) são conferidas TODAS antes do    │
 * │ primeiro movimento: recusar no meio deixaria a decisão de rollback nas mãos da transação, e a regra │
 * │ desta fatia é que configuração não cumprida não produz efeito nenhum.                              │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
/** A venda como a confirmação a lê (`getDoc` da variante `sale`). */
type VendaParaConfirmar = Record<string, unknown> & { id: string; kind: SalesKind; status: string; version: string; empresa_id: string; document_date: string; shipping_date: string | null; due_date: string | null; client_id: string; payment_method_id: string | null; total: string; code: string; installment_plan: Record<string, unknown>; tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null; origin_document_id: string | null; categoria_financeira_id: string | null; centro_custo_id: string | null; items: { product_id: string; warehouse_id: string | null; quantity: string; total: string; product_name: string; product_control_stock: boolean; warehouse_name: string | null }[] };
/**
 * A classificação que vai para o rateio dos títulos: a do documento, o padrão da TOP (formato 5, F9) ou o recuo
 * "padrão legado". No fio da prévia o "padrão da TOP" sai como "documento" + `padraoDaTop` (a web conhece dois valores).
 */
type ClassificacaoResolvida = ClassificacaoFinanceira & { origem: "documento" | "padrão da TOP" | "padrão legado" };

/** O que a confirmação vai fazer com esta venda — decidido ANTES do primeiro efeito. */
interface PlanoDaConfirmacao {
  /** `null` só na prévia, quando a recusa veio antes dela (situação, política). */
  politica: PoliticaEfetivaDaVenda | null;
  baixaEstoque: boolean;
  geraTitulos: boolean;
  /** `null` quando não haverá título ou quando a classificação foi recusada (só na prévia). */
  classificacao: ClassificacaoResolvida | null;
  /** O parcelamento gravado no documento, lido na hora em que alguém precisa dele — como sempre foi. */
  lerPlano: () => InstallmentPlan | null;
  /** F9: os padrões financeiros da versão congelada (tipo de título e conta vão para os títulos); `null` fora do 5 ou sem título. */
  padroes: PadroesFinanceirosResolvidos | null;
}

/**
 * COMO O PLANEJAMENTO TRATA CADA ETAPA — a única diferença entre confirmar e prever (VENDAS-A5-1).
 *
 *   `trava`            a confirmação lê a classificação `for share`; a prévia não trava nada.
 *   `recusar`          a confirmação LANÇA a recusa (a primeira encerra, como sempre); a prévia a anota e
 *                      segue para as etapas que ainda fazem sentido, para mostrar o quadro inteiro.
 *   `conferirPeriodo`  a confirmação chama direto; a prévia chama sob SAVEPOINT. A conferência é uma função
 *                      do banco que LEVANTA exceção: sem o savepoint, a transação da prévia ficaria abortada
 *                      e a etapa seguinte (a classificação) falharia com "current transaction is aborted".
 */
interface ModoDoPlanejamento {
  trava: boolean;
  recusar(e: DomainError): void;
  conferirPeriodo(conferir: () => Promise<void>): Promise<void>;
}
const MODO_CONFIRMACAO: ModoDoPlanejamento = {
  trava: true,
  recusar: (e) => { throw e; },
  conferirPeriodo: (conferir) => conferir(),
};

/** Valor, vencimento e parcelamento dos títulos da venda — o que `createTitles` recebe e o que a prévia mostra. */
function tituloDaVenda(d: VendaParaConfirmar, plan: InstallmentPlan | null) {
  // O vencimento do legado cai na data do documento quando não há outro; sob `exigeVencimento` configurado
  // esse recuo não existe — a falta já foi recusada no planejamento, antes do primeiro efeito.
  return { amount: d.total, dueDate: plan?.first_due_date ?? d.due_date ?? d.document_date, plan };
}

/**
 * O PLANEJAMENTO DA CONFIRMAÇÃO — UMA função, usada pela confirmação E pela prévia (VENDAS-A5-1).
 *
 * Decide, NESTA ORDEM, o que a confirmação conferia antes de qualquer efeito: situação → política da versão
 * congelada e gate → aprovação (TOP-CONFIG-08) → exigências da versão → período → classificação financeira → reserva
 * de estoque (TOP-CONFIG-07, `conferirReservaNaSaida`). Quem só MOSTRA o efeito
 * (a prévia) não pode ter uma cópia desta regra: uma cópia "equivalente" divergiria na primeira fatia que
 * mexesse em uma das duas, e a tela prometeria o que o servidor não faz. O que muda entre as duas está
 * inteiro em `modo`.
 */
async function planejarConfirmacao(ctx: ServiceCtx, d: VendaParaConfirmar, execucaoConfiguradaHabilitada: boolean, modo: ModoDoPlanejamento): Promise<PlanoDaConfirmacao> {
  const lerPlano = () => d.installment_plan && (d.installment_plan as { installments?: number }).installments ? installmentPlanSchema.parse(d.installment_plan) : null;
  const plano: PlanoDaConfirmacao = { politica: null, baixaEstoque: false, geraTitulos: false, classificacao: null, lerPlano, padroes: null };

  // A variante já foi amarrada no carregamento (`getDoc(..., "sale")`): orçamento e pedido passados aqui
  // respondem 404, como qualquer UUID que a rota de vendas não serve. A conferência antiga
  // (`d.kind !== "sale"` → 422) distinguia "existe na variante vizinha" de "não existe" — diferença que a
  // superfície de recusa não pode expor.
  if (d.status === "confirmed" || d.status === "invoiced") { modo.recusar(err("ALREADY_CONFIRMED", "Venda já confirmada")); return plano; }
  if (d.status === "cancelled") { modo.recusar(err("ALREADY_CANCELLED", "Venda cancelada")); return plano; }

  let politica: PoliticaEfetivaDaVenda;
  let versaoCongelada: { codigoBase: string; configuracao: unknown } | null;
  try {
    ({ politica, versaoCongelada } = await politicaDaVenda(ctx, d.tipo_operacao_versao_id, execucaoConfiguradaHabilitada));
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    // Sem política não há o que planejar: a prévia para aqui, como a confirmação.
    modo.recusar(e); return plano;
  }
  plano.politica = politica;
  // ESTOQUE: legado e "saída" configurada baixam; "nenhum" não. FINANCEIRO: legado e "a receber" geram título.
  plano.baixaEstoque = politica.estoque.autoridade === "legado" || politica.estoque.efeito === "saida";
  plano.geraTitulos = politica.financeiro.autoridade === "legado" || politica.financeiro.efeito === "receber";

  /*
   * A APROVAÇÃO (TOP-CONFIG-08, decisão 277) — logo depois da situação e da política, ANTES das exigências e de qualquer
   * efeito. Só a versão congelada no formato 4 com "Sempre", ou "A partir de um valor" com o total ATUAL ≥ o mínimo,
   * exige; a decisão vigente é a última DA VERSÃO ATUAL do documento (`version`, da 0039): alterar a venda depois de
   * aprovada pede aprovação nova. Pendente → 409 APROVACAO_PENDENTE; reprovada → 409 APROVACAO_REPROVADA. Na
   * confirmação (manual e automática) a recusa LANÇA — e a automática a lê como "aguardando_aprovacao"; na prévia ela
   * entra na lista, no MESMO formato das outras, e `podeConfirmar` fica false. Versão 1 a 3 ou sem TOP: nada muda. A
   * guarda do banco (`trg_sales_documents_aprovacao`, 0041) é o fundo; quem explica é este passo.
   * Versão no formato 4 ilegível para a aprovação → TIPO_OPERACAO_EXECUCAO_INDISPONIVEL (fail-closed), e o
   * planejamento para aqui, como na política.
   */
  let recusaAprovacao: DomainError | null;
  try {
    recusaAprovacao = await recusaDaAprovacao(ctx, { modulo: "vendas", documentoId: d.id, versaoDocumento: d.version, valorDocumento: d.total, versaoTop: versaoCongelada });
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    modo.recusar(e); return plano;
  }
  if (recusaAprovacao) modo.recusar(recusaAprovacao);

  // AS EXIGÊNCIAS DA VERSÃO CONGELADA — todas conferidas, todas juntas, antes de qualquer efeito.
  const exigencias: { caminho: string; mensagem: string }[] = [];
  if (politica.estoque.autoridade === "configurada" && politica.estoque.efeito === "saida" && politica.estoque.exigeArmazem && d.items.some((it) => !it.warehouse_id)) {
    exigencias.push({ caminho: "estoque.exigeArmazem", mensagem: "Informe o local de estoque de todos os itens" });
  }
  if (politica.financeiro.autoridade === "configurada" && politica.financeiro.efeito === "receber") {
    if (politica.financeiro.exigeFormaPagamento && !d.payment_method_id) exigencias.push({ caminho: "financeiro.exigeFormaPagamento", mensagem: "Informe a forma de pagamento" });
    if (politica.financeiro.exigeVencimento && !(lerPlano()?.first_due_date ?? d.due_date)) exigencias.push({ caminho: "financeiro.exigeVencimento", mensagem: "Informe o vencimento" });
  }
  if (exigencias.length) {
    modo.recusar(new DomainError("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA",
      `A operação desta venda exige dados que o documento não tem: ${exigencias.map((e) => e.mensagem.toLowerCase()).join("; ")}.`,
      { exigencias }));
  }

  await modo.conferirPeriodo(() => assertPeriodOpen(ctx.tx, ctx.orgId, d.empresa_id, d.document_date));

  // CLASSIFICAÇÃO FINANCEIRA (VENDAS-A1) — resolvida ANTES do primeiro efeito, e só quando HAVERÁ título:
  // com o financeiro configurado "nenhum" nada é exigido nem validado (efeito que não acontece não exige
  // cadastro). Documento classificado → revalidado pela MESMA porta, e NUNCA recua para a "primeira por
  // código" (seria trocar em silêncio a escolha do usuário). Documento sem classificação → o recuo de sempre.
  //
  // OPERACOES-01 F9 (decisão 286) — O PADRÃO FINANCEIRO DA TOP, da versão CONGELADA (só o formato 5 o tem; 1 a 4 e sem
  // TOP = o neutro, e o caminho é exatamente o de antes). Sem classificação no documento, a ordem é: o par da TOP
  // ("padrão da TOP", pela MESMA porta — padrão inativado recusa) → "exigir" recusa → o padrão legado de antes, só no
  // campo que a TOP não deu. E a TOP que não deixa o documento trocar os padrões recusa a venda que informou outro.
  if (plano.geraTitulos) {
    const fp = await padroesDaTopParaExecucao(ctx, d.tipo_operacao_versao_id);
    plano.padroes = fp.padroes;
    // A conta padrão vai para os títulos: inativada ou excluída depois de gravada a TOP → recusa (como a natureza e o centro).
    if (fp.padroes?.contaBancariaId && !(await contaPadraoUtilizavel(ctx, fp.padroes.contaBancariaId, { trava: modo.trava }))) {
      modo.recusar(new DomainError("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", MENSAGEM_CONTA_PADRAO_INUTILIZAVEL,
        { exigencias: [{ caminho: "padroesFinanceiros.contaBancariaId", mensagem: MENSAGEM_CONTA_PADRAO_INUTILIZAVEL }] }));
    }
    // O padrão da TOP passa pela porta da venda com as naturezas que a TOP aceitou ao ser gravada (o perfil da família).
    const regraDoPadrao: RegraDaClassificacao = { ...REGRA_CLASSIFICACAO_VENDA, naturezas: (fp.familia ? perfilDosPadroesFinanceiros(fp.familia)?.naturezas : undefined) ?? REGRA_CLASSIFICACAO_VENDA.naturezas };
    const comOPadrao = async (par: ClassificacaoFinanceira, origem: ClassificacaoResolvida["origem"]) => {
      try {
        plano.classificacao = { ...await validarClassificacaoDoDocumento(ctx, regraDoPadrao, par, "confirmacao", { trava: modo.trava }), origem };
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        modo.recusar(e);
      }
    };
    if (d.categoria_financeira_id && d.centro_custo_id) {
      try {
        plano.classificacao = { ...await validarClassificacaoFinanceira(ctx, { categoriaFinanceiraId: d.categoria_financeira_id, centroCustoId: d.centro_custo_id }, "confirmacao", { trava: modo.trava }), origem: "documento" };
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        modo.recusar(e);
      }
    } else {
      const pc = planoDaClassificacao({ documento: { naturezaId: null, centroCustoId: null }, padrao: fp.padroes, semClassificacao: fp.secao.semClassificacao });
      if (pc.tipo === "pronta") await comOPadrao({ categoriaFinanceiraId: pc.naturezaId, centroCustoId: pc.centroCustoId }, "padrão da TOP");
      else if (pc.tipo === "exigir") {
        modo.recusar(new DomainError("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", MENSAGEM_EXIGE_CLASSIFICACAO,
          { exigencias: [{ caminho: "financeiroPadrao.semClassificacao", mensagem: MENSAGEM_EXIGE_CLASSIFICACAO }] }));
      } else {
        // Receita: o PADRÃO LEGADO (1ª natureza analítica de receita e 1º centro analítico por código), as consultas de
        // antes — só no campo que a TOP não deu. Sem nada da TOP, exatamente o caminho de antes (sem revalidar).
        const legado = await classificacaoLegada(ctx, "income", { natureza: pc.naturezaId === null, centro: pc.centroCustoId === null });
        const cat = pc.naturezaId ?? legado.naturezaId;
        const cc = pc.centroCustoId ?? legado.centroCustoId;
        if (!cat || !cc) modo.recusar(validation(MENSAGEM_SEM_CLASSIFICACAO_LEGADA));
        else if (pc.naturezaId === null && pc.centroCustoId === null) plano.classificacao = { categoriaFinanceiraId: cat, centroCustoId: cc, origem: "padrão legado" };
        else await comOPadrao({ categoriaFinanceiraId: cat, centroCustoId: cc }, "padrão legado");
      }
    }
    if (fp.padroes && !fp.secao.documentoTroca) {
      const campos = camposTrocadosDosPadroes(fp.padroes, { naturezaIds: [d.categoria_financeira_id], centroCustoIds: [d.centro_custo_id], formaPagamentoId: d.payment_method_id });
      if (campos.length) {
        const mensagem = mensagemDosPadroesTrocados(campos);
        modo.recusar(new DomainError("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", mensagem, { exigencias: [{ caminho: "financeiroPadrao.documentoTroca", mensagem }] }));
      }
    }
  }

  // RESERVA DE ESTOQUE (TOP-CONFIG-07) — a última conferência antes do primeiro efeito, e só quando HAVERÁ saída.
  if (plano.baixaEstoque) await conferirReservaNaSaida(ctx, d, modo);
  return plano;
}

/**
 * PRÉ-CONFERÊNCIA DA RESERVA NA SAÍDA DA VENDA (TOP-CONFIG-07, decisão 266) — a mensagem AMIGÁVEL da recusa que o
 * gatilho `trg_stock_movement_reserva` (0035) daria no INSERT do movimento.
 *
 * Por (armazém, produto) dos itens com armazém de produto que controla estoque: a soma da quantidade da venda cabe
 * no DISPONÍVEL = físico do armazém (todos os lotes) − reservado pelos OUTROS (`excluir` = a própria venda: a parte
 * B dela é exatamente o que esta confirmação consome; a parte A do pedido de origem já desconta as partes não
 * canceladas). Não coube → 409 INSUFFICIENT_STOCK, uma linha por produto, unidas por "\n", e `details` por par.
 * Produto sem controle de estoque (serviço, frete) não tem saldo nem entra na conta do banco: fica fora.
 *
 * SÓ RECUSA QUANDO HÁ RESERVA NO PAR (reservado > 0). Sem reserva, disponível = físico, e a falta de físico já
 * tem dono e mensagem (a escolha de lote em `postStock` e o gatilho de saldo da 0003) — a confirmação de quem
 * não usa reserva continua exatamente como era (código, texto e detalhes), inclusive a ordem das recusas.
 *
 * LEITURA SEM TRAVA, e de propósito: `stock-core` trava as linhas de saldo antes e o PRODUTO por último (o gatilho
 * de saldo o atualiza) — travar o produto aqui, antes da linha de saldo, reabriria o ciclo do LT-9c. A corrida
 * entre esta leitura e o INSERT continua coberta pelo gatilho da 0035, que confere sob a trava do produto e
 * recusa com o mesmo código. Custo fixo: as DUAS consultas do lote (`saldoComReservaEmLote`), nunca uma por item.
 */
async function conferirReservaNaSaida(ctx: ServiceCtx, d: VendaParaConfirmar, modo: ModoDoPlanejamento): Promise<void> {
  const porPar = new Map<string, ParDeEstoque & { quantidade: string; produto: string; armazem: string }>();
  for (const it of d.items) {
    // Produto sem controle de estoque (flag do `getDoc`) fica fora da conta: não tem saldo nem reserva. Com armazém,
    // quem o recusa é o `postStock` (PRODUCT_NOT_STOCK_CONTROLLED), como sempre recusou.
    if (!it.warehouse_id || it.product_control_stock === false) continue;
    const chave = chaveDoPar(it.warehouse_id, it.product_id);
    const atual = porPar.get(chave);
    porPar.set(chave, { warehouseId: it.warehouse_id, productId: it.product_id, produto: it.product_name, armazem: it.warehouse_name ?? "",
      quantidade: D(atual?.quantidade ?? 0).plus(it.quantity).toFixed(4) });
  }
  if (porPar.size === 0) return;
  /*
   * NENHUM NÚMERO DE ARMAZÉM ALHEIO (revisão de segurança da TOP-CONFIG-07). O item de venda aceita qualquer armazém
   * da organização (FK de coluna única), e quem recusava o armazém de OUTRA empresa era o `postStock`
   * (WAREHOUSE_FARM_MISMATCH) — antes de qualquer número sair. Esta pré-conferência roda antes dele, e também na
   * prévia (só `sales.view`): sem este recorte, físico e reservado de um armazém de outra empresa sairiam na
   * mensagem. Par de armazém que não é da empresa da venda fica FORA da conta; o `postStock` o recusa depois, como
   * sempre recusou.
   */
  const daEmpresa = new Set((await ctx.tx.query<{ id: string }>(
    "select id from erp.warehouses where organization_id=$1 and empresa_id=$2 and id = any($3::uuid[])",
    [ctx.orgId, d.empresa_id, [...new Set([...porPar.values()].map((p) => p.warehouseId))]])).rows.map((r) => r.id));
  for (const [chave, p] of porPar) if (!daEmpresa.has(p.warehouseId)) porPar.delete(chave);
  if (porPar.size === 0) return;
  const saldo = await saldoComReservaEmLote(ctx, [...porPar.values()], d.id);
  const faltas: { linha: string; detalhe: Record<string, string> }[] = [];
  for (const [chave, p] of porPar) {
    const s = saldo.get(chave);
    if (!s) throw new Error(`conferirReservaNaSaida: par ${chave} sem saldo lido`);
    if (!D(s.reservado).gt(0) || !D(p.quantidade).gt(s.disponivel)) continue;
    faltas.push({
      linha: `${p.produto} no local de estoque ${p.armazem}: disponível ${quantidadeLegivel(s.disponivel)}, solicitado ${quantidadeLegivel(p.quantidade)} (${quantidadeLegivel(s.reservado)} reservado para pedidos).`,
      detalhe: { produto_id: p.productId, armazem_id: p.warehouseId, fisico: s.fisico, reservado: s.reservado, disponivel: s.disponivel, solicitado: p.quantidade },
    });
  }
  if (faltas.length) modo.recusar(err("INSUFFICIENT_STOCK", faltas.map((f) => f.linha).join("\n"), faltas.map((f) => ({ ...f.detalhe, message: f.linha }))));
}

/**
 * TOP-CONFIG-08 (decisão 277) — A CONFIRMAÇÃO DA VENDA, A ÚNICA. É o `confirmSale` de sempre, com o gate de
 * `app.config` resolvido aqui (o mesmo `TOP_EFFECTS_RUNTIME_V1_ENABLED` que a rota `/confirm` lia), exportada para a
 * confirmação automática (o gancho no fim do POST/PUT/PATCH/conversão) e para a aprovação que confirma em seguida.
 * Não existe segundo caminho de confirmação: mesmo planejamento, mesmas recusas, mesmos efeitos, mesma auditoria.
 * `automatica: true` acrescenta SÓ `automatica: true` ao metadata da auditoria "confirm"; a manual (`false`) grava o
 * metadata de antes, chave por chave.
 */
export async function confirmarVendaNaTransacao(app: FastifyInstance, ctx: ServiceCtx, id: string, o: { automatica: boolean }): Promise<{ id: string; status: string; title_ids: string[] }> {
  return confirmSale(ctx, id, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED, o);
}

async function confirmSale(ctx: ServiceCtx, id: string, execucaoConfiguradaHabilitada: boolean, o: { automatica: boolean }) {
  const d = await getDoc(ctx, id, "sale", { lock: true }) as VendaParaConfirmar;
  // F9 (decisão 286): o pedido de origem travado ANTES dos efeitos (a provisão dele é refeita no fim) — venda → pedido.
  if (d.origin_document_id) await travarPedidoDaProvisao(ctx, d.origin_document_id);
  // O PLANEJAMENTO é o mesmo da prévia (`planejarConfirmacao`); aqui, no modo que LANÇA a primeira recusa.
  const plano = await planejarConfirmacao(ctx, d, execucaoConfiguradaHabilitada, MODO_CONFIRMACAO);
  // No modo da confirmação toda recusa lança: chegar aqui sem política é impossível — e seguir sem ela seria
  // executar efeito sem decisão.
  const politica = plano.politica;
  if (!politica) throw new Error("planejarConfirmacao voltou sem política no modo da confirmação");
  const { classificacao, lerPlano } = plano;

  // ESTOQUE. Legado e "saída" configurada chamam a MESMA primitiva com os MESMOS identificadores; "nenhum"
  // não chama nada. O item sem armazém continua fora da baixa nos dois caminhos que baixam — com
  // `exigeArmazem` ele já foi recusado acima. A reserva de estoque também (`conferirReservaNaSaida`, no
  // planejamento); a corrida entre aquela leitura e estes INSERTs é do gatilho `trg_stock_movement_reserva`.
  const movimentos: string[] = [];
  if (plano.baixaEstoque) {
    for (const it of d.items) if (it.warehouse_id) movimentos.push(...(await postStock(ctx, { empresaId: d.empresa_id, warehouseId: it.warehouse_id, productId: it.product_id, movementType: "sale", direction: -1, quantity: it.quantity, sourceType: "sales_documents", sourceId: id, date: d.shipping_date ?? d.document_date, note: `Venda ${d.code}` })).ids);
  }

  // FINANCEIRO. O mesmo desenho: legado e "a receber" configurado geram os títulos pela MESMA porta
  // (`createTitles`), com a mesma categoria, centro, parcelamento, parceiro e origem; "nenhum" não gera
  // título e também não exige categoria nem centro — exigir cadastro para um efeito que não acontece seria
  // recusar a venda por um motivo que não existe.
  let titleIds: string[] = [];
  if (plano.geraTitulos && classificacao) {
    // F9: o tipo de título e a conta prevista dos padrões da TOP (formato 5; ausentes = nulos, como antes), e a TOP e a
    // versão da venda gravadas no título (qualquer formato; venda sem TOP = nulos, como antes).
    const t = await createTitles(ctx, { empresaId: d.empresa_id, direction: "receivable", number: `VND-${d.code}`, personId: d.client_id, ...tituloDaVenda(d, lerPlano()), emissionDate: d.document_date, note: `Venda ${d.code}`, isDeductible: Boolean((d.installment_plan as { is_deductible?: boolean }).is_deductible), apportionment: [{ financialCategoryId: classificacao.categoriaFinanceiraId, costCenterId: classificacao.centroCustoId, percentage: "100" }], sourceType: "sales_documents", sourceId: id,
      titleTypeId: plano.padroes?.tipoTituloId ?? null, contaPrevistaId: plano.padroes?.contaBancariaId ?? null, tipoOperacaoId: d.tipo_operacao_id ?? null, tipoOperacaoVersaoId: d.tipo_operacao_versao_id ?? null });
    titleIds = t.ids;
  }

  // A MARCA DE QUE ESTA TRANSAÇÃO EXECUTOU A POLÍTICA CONFIGURADA. O gatilho da migration 0023 recusa a
  // confirmação de uma venda cuja versão congelada declara execução configurada sem esta marca — que é
  // como um binário anterior a esta fatia (rollback, instância antiga no pool) deixa de confirmá-la pelo
  // legado. `true` no terceiro argumento: vale só até o fim desta transação. O valor é o id CANÔNICO da
  // linha travada (`d.id`), nunca o texto da URL: o Postgres aceita o UUID em maiúsculas e acha a venda, mas
  // o gatilho compara a marca com `NEW.id::text`, e a guarda recusaria a própria confirmação legítima.
  // TOP-CONFIG-05_R2: a marca significa "o binário que conhece o formato desta versão resolveu a política" —
  // o formato 3 a exige mesmo em legado/legado (espelho da guarda em `confirmacaoExigeMarcaDaGuarda`).
  if (confirmacaoExigeMarcaDaGuarda(politica)) {
    await ctx.tx.query("select set_config('app.venda_execucao_configurada', $1, true)", [d.id]);
  }
  // A MARCA DA CLASSIFICAÇÃO (0024): venda classificada só entra em confirmed/invoiced com ela — com ou sem
  // título. Um binário anterior não a grava e, por isso, não confirma pela "primeira por código".
  if (d.categoria_financeira_id) await ctx.tx.query("select set_config('app.venda_classificacao_financeira', $1, true)", [d.id]);
  // ROW COUNT SOB RLS, e a transição conferida no próprio `where`: sob a trava acima só `open`/`approved`
  // chegam aqui, e zero linha sem conferência seria sucesso sem efeito.
  const u = await ctx.tx.query("update erp.sales_documents set status='confirmed', updated_at=now() where id=$1 and organization_id=$2 and status not in ('confirmed','invoiced','cancelled')", [id, ctx.orgId]);
  if (u.rowCount !== 1) throw notFound("Documento");
  // F9 (decisão 286): a venda faturada dá lugar, no pedido de origem, ao que ele ainda previa (total ou parcial).
  // Origem que não é pedido de venda (orçamento) → nada.
  if (d.origin_document_id) await sincronizarProvisaoDoPedido(ctx, d.origin_document_id, MOTIVOS_DA_PROVISAO.faturado(d.code));
  // A EVIDÊNCIA DO DOCUMENTO: qual versão valeu, qual autoridade decidiu cada efeito, e o que foi de fato
  // materializado. `titles` continua com o nome de sempre — é o que leitores anteriores da trilha conhecem.
  await audit(ctx.tx, ctx, "sales_documents", id, "confirm", {
    titles: titleIds, movimentos, tipoOperacaoVersaoId: d.tipo_operacao_versao_id,
    execucao: { origem: politica.origem, ...resumoDaPoliticaDaVenda(politica) },
    ...(titleIds.length && classificacao ? { classificacaoFinanceira: { categoriaFinanceiraId: classificacao.categoriaFinanceiraId, centroCustoId: classificacao.centroCustoId, origem: classificacao.origem } } : {}),
    // TOP-CONFIG-08: a chave só existe na confirmação automática; a manual fica idêntica à de antes.
    ...(o.automatica ? { automatica: true } : {})
  });
  return { id, status: "confirmed", title_ids: titleIds };
}

/** Versão do contrato da prévia da confirmação. A web confere forma E versão antes de usar o corpo. */
export const CONTRATO_PREVIA_CONFIRMACAO = 1;

/**
 * PRÉVIA DA CONFIRMAÇÃO (VENDAS-A5-1) — o que a confirmação desta venda faria AGORA, sem fazer nada.
 *
 * É o `planejarConfirmacao` da confirmação, no modo que ANOTA as recusas em vez de lançá-las: a primeira
 * recusa da lista é exatamente a que a confirmação daria (mesmo código, mensagem e detalhes), e as seguintes
 * mostram o resto do quadro. Não trava linha (nem a venda, nem categoria e centro), não grava nada (nem
 * auditoria, nem chave de idempotência) e não aborta a transação: o período roda sob savepoint.
 *
 * A PRÉVIA É APRESENTAÇÃO; A CONFIRMAÇÃO É A AUTORIDADE. Entre abrir o diálogo e confirmar o cadastro pode
 * mudar, e é a confirmação que decide com a trava. Recusa que nasce DENTRO das primitivas de efeito — saldo
 * de estoque insuficiente e as demais conferências de `postStock`, valor do título não positivo em
 * `createTitles` — não está no planejamento e, por isso, não aparece aqui. A exceção é o parcelamento: a
 * prévia faz a MESMA conta de parcelas (`parcelasDoTitulo`) e, se ela recusar, a recusa entra na lista. E a
 * reserva de estoque (TOP-CONFIG-07): a pré-conferência mora no planejamento (`conferirReservaNaSaida`), então a
 * recusa por estoque reservado para pedidos aparece aqui com o mesmo código, texto e detalhes da confirmação.
 *
 * Autorização pela MESMA `getDoc` do GET do documento: a prévia responde o que o GET responde para o mesmo
 * id — outro tenant, fora do escopo, inexistente, excluído e id de outra variante dão a MESMA 404 (o id
 * malformado, hoje, é 500 nos dois: dívida de `getDoc`, não desta rota).
 */
async function previaDaConfirmacao(ctx: ServiceCtx, id: string, execucaoConfiguradaHabilitada: boolean) {
  const d = await getDoc(ctx, id, "sale") as VendaParaConfirmar;
  const recusas: DomainError[] = [];
  const modo: ModoDoPlanejamento = {
    trava: false,
    recusar: (e) => { recusas.push(e); },
    conferirPeriodo: async (conferir) => {
      await ctx.tx.query("savepoint previa_confirmacao_periodo");
      try {
        await conferir();
        await ctx.tx.query("release savepoint previa_confirmacao_periodo");
      } catch (e) {
        await ctx.tx.query("rollback to savepoint previa_confirmacao_periodo");
        // A MESMA tradução que a confirmação recebe no plugin de erros (`fromPgError`): mesmo código e texto.
        const recusa = e instanceof DomainError ? e : fromPgError(e);
        if (!recusa) throw e;
        recusas.push(recusa);
      }
    },
  };
  const plano = await planejarConfirmacao(ctx, d, execucaoConfiguradaHabilitada, modo);

  // Código e nome de categoria e centro que IRÃO para o rateio — a do documento ou a do recuo.
  // F9: no FIO a origem continua nos dois valores que as webs conhecem — o "padrão da TOP" sai como "documento" com
  // `padraoDaTop: true` (aditivo); a auditoria da confirmação guarda "padrão da TOP".
  let classificacao: { origem: "documento" | "padrão legado"; padraoDaTop?: true; categoria: { id: string; codigo: string; nome: string }; centro: { id: string; codigo: string; nome: string } } | null = null;
  if (plano.classificacao) {
    const r = (await ctx.tx.query<{ cat_codigo: string; cat_nome: string; cc_codigo: string; cc_nome: string }>(
      `select c.code as cat_codigo, c.name as cat_nome, cc.code as cc_codigo, cc.name as cc_nome
         from erp.financial_categories c, erp.cost_centers cc
        where c.id = $1 and c.organization_id = $3 and cc.id = $2 and cc.organization_id = $3`,
      [plano.classificacao.categoriaFinanceiraId, plano.classificacao.centroCustoId, ctx.orgId])).rows[0];
    if (r) classificacao = { ...(plano.classificacao.origem === "padrão da TOP" ? { origem: "documento" as const, padraoDaTop: true as const } : { origem: plano.classificacao.origem }),
      categoria: { id: plano.classificacao.categoriaFinanceiraId, codigo: r.cat_codigo, nome: r.cat_nome },
      centro: { id: plano.classificacao.centroCustoId, codigo: r.cc_codigo, nome: r.cc_nome } };
  }

  // O primeiro vencimento sai da MESMA conta de parcelas que `createTitles` grava (entrada, intervalo, dia fixo).
  // Se a conta recusa (entrada maior que o total, número de parcelas inválido), a confirmação recusaria com a
  // MESMA mensagem ao gerar os títulos — então é recusa prevista, não data omitida em silêncio. Valor não
  // positivo fica de fora: `createTitles` o recusa ANTES da conta, com outra mensagem, e a prévia não copia
  // essa conferência (risco declarado acima). Erro que não é de domínio não é recusa: sobe.
  let primeiroVencimento: string | null = null;
  if (plano.politica && plano.geraTitulos && D(d.total).gt(0)) {
    try {
      const parcelas = parcelasDoTitulo(tituloDaVenda(d, plano.lerPlano()));
      primeiroVencimento = parcelas.map((p) => p.dueDate).sort()[0] ?? null;
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      recusas.push(e);
    }
  }

  const comArmazem = d.items.filter((it) => it.warehouse_id).length;
  return {
    contractVersion: CONTRATO_PREVIA_CONFIRMACAO,
    podeConfirmar: recusas.length === 0,
    recusas: recusas.map((e) => e.toJSON()),
    // `efeito: null` = a recusa veio antes da política; não há o que prever.
    estoque: {
      efeito: plano.politica ? (plano.baixaEstoque ? "baixa" : "nenhum") : null,
      itensQueBaixam: plano.baixaEstoque ? comArmazem : 0,
      itensSemArmazem: plano.baixaEstoque ? d.items.length - comArmazem : 0,
    },
    financeiro: {
      efeito: plano.politica ? (plano.geraTitulos ? "receber" : "nenhum") : null,
      valor: plano.geraTitulos ? d.total : null,
      primeiroVencimento,
      classificacao,
    },
    politica: plano.politica ? { origem: plano.politica.origem, ...resumoDaPoliticaDaVenda(plano.politica) } : null,
  };
}

export default async function salesRoutes(app: FastifyInstance) {
  for (const kind of ["budget", "order", "sale"] as const) {
    const base = `/sales/${kind}s`; const perm = permOf(kind);
    app.get(base, async (req) => runService(app, req, `${perm}.view`, async (ctx) => {
      const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
      const where = ["d.organization_id=$1", "d.kind=$2", "d.deleted_at is null"]; const params: unknown[] = [ctx.orgId, kind];
      if (f.client_id) { params.push(f.client_id); where.push(`d.client_id=$${params.length}`); }
      if (f.status) { params.push(f.status); where.push(`d.status=$${params.length}`); }
      if (f.empresa_id) { params.push(f.empresa_id); where.push(`d.empresa_id=$${params.length}`); } where.push(...empresaScope(ctx, "d", params, { ignoreSelected: Boolean(f.empresa_id) }));
      if (f.start_date) { params.push(f.start_date); where.push(`d.document_date>=$${params.length}`); } if (f.end_date) { params.push(f.end_date); where.push(`d.document_date<=$${params.length}`); }
      if (f.search) { params.push(`%${f.search}%`); where.push(`(d.code ilike $${params.length} or c.name ilike $${params.length})`); }
      if (f.product_id) { params.push(f.product_id); where.push(`exists (select 1 from erp.sales_document_items i where i.document_id=d.id and i.product_id=$${params.length})`); }
      // FILTRO POR TOP, server-side. Documento histórico de uma TOP hoje DESATIVADA continua casando: o
      // filtro é pelo ponteiro gravado, não pelo estado atual da configuração. Desativar uma TOP não pode
      // fazer lançamento sumir de relatório.
      //
      // A FORMA é conferida ANTES de o valor chegar ao SQL. Sem isso, `?tipo_operacao_id=abc` entra numa
      // comparação com coluna `uuid`, o Postgres devolve 22P02 — que `fromPgError` não mapeia — e o
      // cliente recebe 500: um id malformado passaria a ser DISTINGUÍVEL de um id inexistente, que é
      // exatamente a diferença que `.claude/rules/security.md` proíbe na superfície de recusa. Filtrar
      // por um id que não existe devolve zero linhas; filtrar por um id que não é id faz o mesmo.
      if (f.tipo_operacao_id) {
        if (FORMA_UUID.test(f.tipo_operacao_id)) { params.push(f.tipo_operacao_id); where.push(`d.tipo_operacao_id=$${params.length}`); }
        else where.push("false");
      }
      const w = where.join(" and ");
      // Os dois JOINs são LEFT: documento legado (ponteiros nulos) permanece na listagem, com a TOP vazia.
      const wl = wrapListing(`select d.id, d.code, d.document_date, d.created_at, d.shipping_date, d.due_date, d.status, d.total, d.subtotal, d.nfe_id, c.name as client_name, u.name as responsible_name, f.name as empresa_name, d.tipo_operacao_id, toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao, (select count(*) from erp.sales_document_items i where i.document_id=d.id)::int as item_count from erp.sales_documents d join erp.people c on c.id=d.client_id left join erp.users u on u.id=d.responsible_user_id join erp.empresas f on f.id=d.empresa_id left join erp.tipos_operacao toper on toper.id=d.tipo_operacao_id and toper.organization_id=d.organization_id left join erp.tipos_operacao_versoes topv on topv.id=d.tipo_operacao_versao_id and topv.organization_id=d.organization_id where ${w} order by d.document_date desc, d.created_at desc`, params, req.query as Record<string, unknown>, q, ", coalesce(sum(t.total),0)::text total");
      const tot = await ctx.tx.query<{ n: string; total: string }>(wl.countSql, wl.params);
      const r = await ctx.tx.query(wl.pageSql, wl.params);
      // Em LOTE, sobre as linhas já carregadas: nenhuma consulta por linha. O snapshot veio no mesmo
      // `select` da página, então montar o objeto é trabalho de memória, não de rede.
      const items = (r.rows as (Record<string, unknown> & Parameters<typeof topParaTela>[0])[]).map((l) => ({ ...l, tipo_operacao: topParaTela(l) }));
      return paginaComIdGlobal(ctx, "sales_documents", { items, total: Number(tot.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { total: tot.rows[0]!.total } });
    }));
    /**
     * AS TOPs QUE ESTA VARIANTE PODE LANÇAR — porta OPERACIONAL, não administrativa.
     *
     * A capacidade exigida é a de LANÇAR (`${perm}.create`), nunca `tipos_operacao.view`. São perguntas
     * diferentes: "quem pode vender?" e "quem pode configurar tipos de operação?". Se o seletor do
     * vendedor chamasse `/api/admin/tipos-operacao`, todo vendedor sem capacidade administrativa deixaria
     * de conseguir vender — uma tela de configuração derrubando o operacional.
     *
     * Devolve SÓ o que serve a esta variante: mesma organização, ativa, não excluída, da família canônica
     * da rota, com a versão corrente. Nada de campo administrativo.
     *
     * `contractVersion` existe para o cliente distinguir "endpoint ausente porque a API é antiga" de
     * "endpoint presente com outro formato" — é o que sustenta a descoberta de capacidade descrita no §0.2 deste contrato.
     */
    /**
     * OS PRÓXIMOS PASSOS DESTE DOCUMENTO.
     *
     * Capacidade exigida: `${perm}.view` — PERGUNTAR o que se pode gerar é leitura do documento, não
     * criação do destino. A capacidade do DESTINO é cobrada na conversão, que é onde o efeito acontece;
     * cobrá-la aqui esconderia o próximo passo de quem pode ver o documento mas não criar o derivado, e
     * a tela não conseguiria nem explicar por que o botão não aparece.
     *
     * `contractVersion` pelo mesmo motivo da capability da TOP: um 200 de formato desconhecido é o modo de
     * falha mais perigoso, porque parece sucesso.
     *
     * `politicaConfigurada` É O DISCRIMINADOR, e é o que a lista sozinha não consegue dizer: `items: []`
     * tem duas histórias — "ninguém nunca declarou o que vem depois" (e a conversão pela cadeia antiga
     * continua existindo para este documento) e "foi declarado que não vem nada depois" (e a conversão é
     * recusada). A tela precisa das duas separadas para não oferecer um botão que o servidor recusará, nem
     * esconder um que ele aceitaria.
     *
     * PARA POLÍTICA NÃO CONFIGURADA, `items` CONTINUA VAZIO. Seria fácil devolver aqui o destino da cadeia
     * antiga para a tela ter o que mostrar — e seria inventar uma política que ninguém declarou, exibida
     * com a mesma aparência das que foram declaradas de verdade.
     */
    app.get(`${base}/:id/proximos-passos`, async (req) => runService(app, req, `${perm}.view`, async (ctx) => {
      const { id } = req.params as { id: string };
      // AUTORIZAÇÃO ANTES DOS DADOS: `getDoc` já aplica tenant, escopo de empresa e variante, e responde a
      // mesma 404 de inexistente. Sem esta leitura, um id de outro tenant devolveria lista vazia com 200 —
      // resposta diferente de 404 e, portanto, um oráculo de existência.
      const doc = await getDoc(ctx, id, kind) as Record<string, unknown> & { tipo_operacao_versao_id?: string | null };
      const politica = await politicaDeDestinos(ctx, doc.tipo_operacao_versao_id);
      return { contractVersion: 1, politicaConfigurada: politica.configurada, items: politica.itens };
    }));

    app.get(`${base}/operation-types`, async (req) => runService(app, req, `${perm}.create`, async (ctx) => {
      const familia = familiaDaVariante(kind);
      const r = await ctx.tx.query<{ id: string; codigo: string; nome: string; versao: number; padrao: boolean }>(
        `select t.id, t.codigo, v.nome, v.versao, t.padrao
           from erp.tipos_operacao t
           join erp.tipos_operacao_versoes v
             on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
          where t.organization_id = $1 and t.codigo_base = $2 and t.ativo and t.excluido_em is null
          order by t.padrao desc, t.codigo, v.nome`,
        [ctx.orgId, familia]);
      return {
        contractVersion: 1,
        // ADITIVO, sem mexer em `contractVersion` (a web anterior compara a versão EXATA e bloquearia a
        // escrita): declara que esta API entende a classificação financeira do documento (VENDAS-A1). A web
        // nova só mostra e envia os campos com esta declaração — a API anterior os descartaria em silêncio.
        capacidades: { classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, layoutDocumento: CAPACIDADE_LAYOUT_DOCUMENTO, regrasDaOperacao: CAPACIDADE_REGRAS_DA_OPERACAO },
        family: { code: familia, label: t(chaveI18nDaFamiliaOperacional(familia) ?? familia) },
        defaultId: r.rows.find((x) => x.padrao)?.id ?? null,
        items: r.rows.map((x) => ({ id: x.id, code: x.codigo, name: x.nome, version: x.versao, isDefault: x.padrao }))
      };
    }));
    /**
     * REGRAS DA OPERAÇÃO da TOP escolhida (TOP-CONFIG-05, decisão 263) — MESMA permissão, porta e 404 de
     * `/layout-efetivo` (a resolução da TOP é a mesma consulta): inexistente, de outro tenant, de outra família,
     * inativa, excluída, id malformado e parâmetro AUSENTE caem na MESMA 404. Sem TOP não há regra a perguntar.
     * Só o formato 3 executa restrições; formato 1/2 responde o NEUTRO (nada exigido, toda condição, não valida).
     */
    app.get(`${base}/regras-da-operacao`, async (req) => runService(app, req, `${perm}.create`, async (ctx): Promise<RegrasDaOperacaoDaVenda> => {
      const familia = familiaDaVariante(kind);
      const q = (req.query ?? {}) as Record<string, unknown>;
      const bruto = q["tipo_operacao_id"];
      if (typeof bruto !== "string" || !FORMA_UUID.test(bruto)) throw notFound("Tipo de operação");
      // TOP-CONFIG-07: `reservaEstoque` (aditivo) da versão ATUAL, na MESMA consulta da existência — nenhuma ida a mais.
      // A Central usa para marcar o armazém do item como obrigatório. Só pedido pode ser true.
      const v = await ctx.tx.query<{ reserva_estoque: boolean }>(
        `select coalesce(tv.reserva_estoque, false) as reserva_estoque
           from erp.tipos_operacao t
           left join erp.tipos_operacao_versoes tv on tv.tipo_operacao_id = t.id and tv.organization_id = t.organization_id and tv.versao = t.versao_atual
          where t.id=$1 and t.organization_id=$2 and t.codigo_base=$3 and t.ativo and t.excluido_em is null`, [bruto, ctx.orgId, familia]);
      if (!v.rows[0]) throw notFound("Tipo de operação");
      const reservaEstoque = kind === "order" && v.rows[0].reserva_estoque === true;
      // EDITAR-01: a MONTAGEM é a mesma do `GET <base>/:id/edicao` (lá, pela versão CONGELADA do documento) — um dono só.
      // F2 (decisão 279): `regrasGerais` da versão ATUAL, só na venda — a régua de `aceitaSemItens`/`confirmacaoAutomaticaDaVenda`.
      return respostaDasRegrasDaOperacao(await regrasDaTopAtual(ctx, bruto), reservaEstoque, kind === "sale");
    }));
    /**
     * LAYOUT EFETIVO da TOP escolhida (VENDAS-A3-1) — mesma permissão e porta de `operation-types`. TOP que a
     * variante não enxerga (inexistente, de outro tenant, de outra família, inativa, excluída, id malformado) cai na
     * MESMA 404: distinguir seria oráculo de existência. Sem o parâmetro = layout de documento sem TOP (sistema).
     */
    app.get(`${base}/layout-efetivo`, async (req) => runService(app, req, `${perm}.create`, async (ctx) => {
      const familia = familiaDaVariante(kind);
      const q = (req.query ?? {}) as Record<string, unknown>;
      const bruto = q["tipo_operacao_id"];
      let topId: string | null = null;
      if (bruto !== undefined) {
        if (typeof bruto !== "string" || !FORMA_UUID.test(bruto)) throw notFound("Tipo de operação");
        const v = await ctx.tx.query("select 1 from erp.tipos_operacao where id=$1 and organization_id=$2 and codigo_base=$3 and ativo and excluido_em is null", [bruto, ctx.orgId, familia]);
        if (!v.rowCount) throw notFound("Tipo de operação");
        topId = bruto;
      }
      /*
       * PADRÃO DE CADASTRO (VENDAS-A3-1b) e a forma da resposta: UM dono desde a ANEXOS-PESQUISA-01 (item 0) —
       * `respostaDoLayoutEfetivo`, o mesmo contrato das rotas de compras. A resposta de vendas é a MESMA byte a byte
       * (teste L-0): sem padrão `registro` (inclusive o do sistema) só `{ estrutura, origem, nome, id }`, sem consulta a
       * mais; com padrão registro, a `estrutura` sai sem eles e eles vêm à parte, conferidos agora nesta organização.
       * O servidor NÃO aplica padrão ao salvar o documento (2.6). A 404 uniforme continua sendo desta rota (acima).
       */
      return respostaDoLayoutEfetivo(ctx, familia, topId);
    }));
    registrarSituacaoCliente(app, kind, base, perm); // TOP-CONFIG-05: antes de `/:id`
    registrarEdicaoDeVenda(app, kind, base, perm, { getDoc }); // EDITAR-01: `GET <base>/:id/edicao`
    app.get(`${base}/:id`, async (req) => runService(app, req, `${perm}.view`, (ctx) => getDoc(ctx, (req.params as { id: string }).id, kind)));
    /**
     * CRIAÇÃO. `tipo_operacao_id` é OPCIONAL na API — e isso é compatibilidade de rolling deploy, não
     * frouxidão: durante a janela de implantação a web ANTIGA continua postando sem o campo, e recusá-la
     * derrubaria a criação de vendas no meio do deploy. Ausente ⇒ documento nasce legado (null/null).
     *
     * NÃO SE APLICA O PADRÃO DA FAMÍLIA quando o campo vem ausente. Seria conveniente e estaria errado:
     * um cliente antigo não declarou intenção nenhuma, e o padrão é administrável — atribuí-lo em silêncio
     * faria a mesma chamada significar coisas diferentes conforme a configuração do dia. A web NOVA escolhe
     * explicitamente (podendo PRÉ-SELECIONAR o padrão, com o valor visível).
     *
     * TOP-CONFIG-07: pedido cuja versão resolvida reserva estoque confere o disponível DEPOIS de todas as recusas de
     * antes (nenhuma ordem, código ou mensagem muda) e imediatamente ANTES de gravar — a trava dos produtos vale até o
     * commit. Orçamento e venda nunca perguntam; pedido sem TOP também não.
     *
     * TOP-CONFIG-08 (decisão 277):
     *   · DOCUMENTO SEM ITENS (só venda): o corpo é lido pelo irmão sem o mínimo de itens (`lerCorpoDoDocumento`). Sem
     *     TOP, itens vazios são recusados logo depois da leitura do corpo, como hoje; com TOP, depois de resolvê-la: só
     *     a versão no formato 4 com "Permitido" aceita, e a recusa é a de hoje. ORDEM NOVA, declarada: com TOP, a recusa
     *     da empresa (`exigirEmpresaDeLancamento`) e a da TOP (`resolverTopParaLancamento`) podem vir antes da dos itens;
     *   · CONFIRMAÇÃO AUTOMÁTICA: no FIM, dentro do `idempotent` e depois da auditoria "create" — a resposta gravada
     *     pela chave já leva o resultado, e o replay nunca confirma duas vezes.
     */
    app.post(base, async (req, reply) => reply.status(201).send(await runService(app, req, `${perm}.create`, async (ctx) => { const d = lerCorpoDoDocumento(kind, req.body); if (d.items.length === 0 && !d.tipo_operacao_id) recusarItensVazios(() => docSchema.parse(req.body)); await exigirEmpresaDeLancamento(ctx, d.empresa_id); return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined, d, async () => { const top = d.tipo_operacao_id ? await resolverTopParaLancamento(ctx, familiaDaVariante(kind), d.tipo_operacao_id) : null;
      if (d.items.length === 0 && !(await aceitaSemItens(ctx, kind, top?.tipoOperacaoVersaoId ?? null))) recusarItensVazios(() => docSchema.parse(req.body));
      const classificacao = await classificacaoDaCriacao(ctx, d); const condicao = { linha: d.condicao_pagamento_id ? await validarCondicaoDoDocumento(ctx, d.condicao_pagamento_id) : null, gravar: true }; await cobrarRegrasDaOperacao(ctx, top ? await regrasDaVersaoTop(ctx, top.tipoOperacaoVersaoId) : null, d, { conferirCondicao: true, conferirAtraso: true }); await cobrarLayoutAoSalvar(ctx, kind, d);
      if (kind === "order" && top && await versaoReservaEstoque(ctx, top.tipoOperacaoVersaoId)) { await travarContadorIdGlobal(ctx); await conferirReservaDoDocumento(ctx, { itens: d.items, empresaId: d.empresa_id, excluirDocumentoId: null }); }
      const r = await writeDoc(ctx, kind, d, undefined, null, top, classificacao, condicao); await audit(ctx.tx, ctx, "sales_documents", r.id!, "create", top ? { tipoOperacaoId: top.tipoOperacaoId, tipoOperacaoVersaoId: top.tipoOperacaoVersaoId, tipoOperacaoCodigo: top.codigo, tipoOperacaoVersao: top.versao } : undefined);
      return comConfirmacaoAutomatica(app, ctx, kind, r.id!, top?.tipoOperacaoVersaoId ?? null, r); })).result; })));
    /**
     * EDIÇÃO. A regra do snapshot está toda nas três linhas de `top` abaixo:
     *
     *   campo AUSENTE            → `undefined` → preserva o que está gravado (cliente antigo, e também o
     *                              caso comum de mexer noutro campo qualquer).
     *   MESMO id já gravado      → `undefined` → preserva a VERSÃO ANTIGA. Salvar de novo não re-carimba o
     *                              documento com a versão de hoje só porque a TOP ganhou uma.
     *   id DIFERENTE (ou anexar
     *   TOP a documento legado)  → resolve e congela a versão corrente da TOP nova, e AUDITA a troca.
     */
    app.put(`${base}/:id`, async (req) => runService(app, req, `${perm}.edit`, async (ctx) => {
      const { id } = req.params as { id: string };
      // `lock: true` — a EDIÇÃO também lê-e-muta a mesma linha, e a decisão que ela toma ("este status
      // permite editar?") é exatamente a que a confirmação concorrente invalida. Sem a trava: a edição lê
      // `open` do snapshot anterior, aprova a transição, e só o seu UPDATE espera o commit da confirmação
      // — que não reavalia status nenhum. O resultado é um documento `confirmed` cujos itens e total foram
      // TROCADOS depois de o estoque ter sido baixado e os títulos gerados pelo conjunto antigo: a venda
      // diz uma coisa e o ledger diz outra, sem que nenhuma das duas respostas seja erro.
      const cur = await getDoc(ctx, id, kind, { lock: true }) as DocumentoGravado;
      // EDITAR-01: as recusas de ESTADO (situação; TOP-CONFIG-06 — origem com partes ativas, depois só canceladas:
      // trocar itens reescreveria o saldo das partes, e a FK `origem_item_id` é `on delete restrict`) moram no lugar
      // único que a PATCH e o `/edicao` também consultam. Mesmos código, mensagens e ordem de antes; o PUT continua
      // aceitando documento sem TOP (legado), como sempre aceitou.
      const recusa = await recusaDaEdicao(ctx, cur, { exigirTop: false });
      if (recusa) throw err("INVALID_STATUS_TRANSITION", recusa);
      // TOP-CONFIG-08: a venda lê pelo irmão sem o mínimo de itens. Documento que CONTINUA sem TOP (nem o gravado, nem
      // o corpo traz uma): itens vazios recusados aqui, logo depois da leitura do corpo, como hoje. Com TOP, quem
      // decide é a versão, no núcleo (`salvarEdicao`), com a mesma recusa.
      const d = lerCorpoDoDocumento(kind, req.body);
      const recusarSemItens = () => recusarItensVazios(() => docSchema.parse(req.body));
      if (d.items.length === 0 && cur.tipo_operacao_id === null && d.tipo_operacao_id == null) recusarSemItens();
      const corpo = req.body !== null && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
      // O PUT é a lista inteira, casada com a gravada PELA POSIÇÃO (é como a parte gerada preserva a ligação), e os
      // itens são regravados como sempre foram (`substituir`). As regras são as do núcleo, as mesmas da PATCH.
      const { r, top } = await salvarEdicao(ctx, kind, id, cur, { d, corpo, pares: d.items.map((_, k) => cur.items[k]),
        itens: { modo: "substituir", origemItemIds: cur.items.map((i) => i.origem_item_id) }, recusarSemItens });
      await audit(ctx.tx, ctx, "sales_documents", id, "update");
      // Mudança de identidade do lançamento é evento PRÓPRIO: quem trocou a TOP de um documento não pode
      // ficar escondido dentro de um `update` genérico sem diff.
      if (top) {
        await audit(ctx.tx, ctx, "sales_documents", id, "operation_type_change",
          { tipoOperacaoCodigo: top.codigo, tipoOperacaoVersao: top.versao },
          { before: { tipoOperacaoId: cur.tipo_operacao_id, tipoOperacaoVersaoId: cur.tipo_operacao_versao_id },
            after: { tipoOperacaoId: top.tipoOperacaoId, tipoOperacaoVersaoId: top.tipoOperacaoVersaoId } });
      }
      // TOP-CONFIG-08: a confirmação automática, no FIM, pela versão que vale depois do PUT (a congelada, ou a da TOP
      // nova). O PUT não tem chave de idempotência: o reenvio depois de confirmar recebe o 409 INVALID_STATUS_TRANSITION.
      return comConfirmacaoAutomatica(app, ctx, kind, id, top ? top.tipoOperacaoVersaoId : cur.tipo_operacao_versao_id, r);
    }));
    /**
     * EDIÇÃO PARCIAL — `PATCH <base>/:id` (EDITAR-01, decisão 272). Corpo `{ version, ...só os campos que mudam }`.
     *
     * A ORDEM é o contrato:
     *   0. a CAPACIDADE: `<perm>.edit` (a porta) e `<perm>.view` (a resposta é o documento inteiro) → 403, antes de ler
     *      qualquer coisa, inclusive o corpo;
     *   1. a FORMA do pedido (chave desconhecida, `empresa_id`, `tipo_operacao_id`, `version` canônica, números na
     *      forma e no limite da coluna — cabeçalho, item e entrada do plano —, item novo sem produto/quantidade/preço)
     *      → 422, antes de ler qualquer registro e antes de reservar a chave de idempotência;
     *   2. o documento VISÍVEL (a mesma 404 de sempre) — antes do helper, que devolveria a resposta gravada sem passar
     *      pelo recorte de empresa (`exigirDocumentoVisivel`);
     *   3. a IDEMPOTÊNCIA: mesma chave + mesmo corpo (canônico, pós-zod) → a MESMA resposta, sem gravar de novo; outra
     *      chave/corpo → 409 CONFLICT do helper. `actorId` e `sourceId` no hash, como no cancelamento;
     *   4. a TRAVA da linha (só `erp.sales_documents`, sem junção; zero linhas → a mesma 404) e, LOGO DEPOIS, a VERSÃO:
     *      diferente da gravada → 409 CONCURRENCY_CONFLICT, sem gravar nada. Antes da situação de propósito: quem
     *      editou uma versão velha precisa recarregar, qualquer que seja o estado novo — e a versão lida sob a trava é
     *      a que vale até o commit. Só então o documento é lido (`getDoc`, sem trava);
     *   5. as recusas de ESTADO (`recusaDaEdicao`, exigindo TOP) → 409 INVALID_STATUS_TRANSITION;
     *   6. o documento COMO FICARÁ (`edicaoComoFicara`: `items[i].id` estranho ou repetido → 422);
     *   7. nada muda de fato (valores canônicos iguais ao gravado, plano inclusive) → 200 com o documento, sem escrita;
     *   8. a referência TROCADA (cliente, transportadora, proprietário, forma de pagamento) fora da organização → 422;
     *   9. o NÚCLEO do PUT (`salvarEdicao`), na ordem do PUT; os totais (e o que não cabe na coluna → 422) e o plano
     *      são decididos lá dentro, logo antes de gravar. TOP-CONFIG-08: na venda, os itens vazios passam na forma (1) e
     *      são decididos AQUI, pela versão congelada (formato 4 "Permitido" aceita; senão o 422 de hoje do estrito);
     *  10. TOP-CONFIG-08: a confirmação automática (versão formato 4 "Automática"), no fim, e a resposta relida.
     * Nada muda de fato (tudo igual ao gravado) → nenhuma escrita, a versão fica, e a resposta é o documento.
     * Uma PATCH que grava faz UM update no cabeçalho (a versão sobe exatamente 1) e UM evento de histórico.
     * Resposta: o documento como o GET o devolve, com a versão nova.
     */
    app.patch(`${base}/:id`, async (req) => runService(app, req, `${perm}.edit`, async (ctx) => {
      // EDITAR-01_R1 (1.2 g): a PATCH devolve o documento INTEIRO (também a que não muda nada), então ela é `.edit` E
      // `.view` — por chave exata, sem implicação. Sem `.view` → 403 antes de ler qualquer coisa, inclusive o corpo.
      requirePermission(ctx, `${perm}.view`);
      const { id } = req.params as { id: string };
      // TOP-CONFIG-08: a venda lê `items` pelo irmão do `edicaoSchema` (lista vazia passa na FORMA; quem decide é a versão,
      // no núcleo, depois da 404, do 409 da versão e do 409 da situação — a ordem nova, declarada). Orçamento e pedido: o
      // estrito, como sempre.
      const pedido = lerPedidoDaEdicaoDaVariante(kind, req.body);
      // Id MALFORMADO é inexistente: a MESMA 404 do GET, e não o 500 do 22P02 que o `getDoc` daria ao passá-lo a uma
      // coluna uuid (o mesmo cuidado do `/edicao`). O GET/PUT não mudam nesta fatia.
      if (!FORMA_UUID_PADRAO.test(id)) throw notFound("Documento");
      await exigirDocumentoVisivel(ctx, id, kind);
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        { action: "edit_sales_document", sourceId: id, sourceKind: kind, body: { version: pedido.versao, ...pedido.campos }, actorId: ctx.user.id },
        async () => {
          // 1.2 k: trava SEM junção e confere a versão; SÓ DEPOIS lê o documento (sem trava — a linha já é desta transação).
          const travada = await travarDocumentoDaEdicao(ctx, id, kind);
          if (BigInt(travada.version) !== BigInt(pedido.versao)) throw err("CONCURRENCY_CONFLICT", MSG_DOCUMENTO_MUDOU);
          const cur = await getDoc(ctx, id, kind) as DocumentoGravado;
          const recusa = await recusaDaEdicao(ctx, cur, { exigirTop: true });
          if (recusa) throw err("INVALID_STATUS_TRANSITION", recusa);
          const edicao = edicaoComoFicara(cur, pedido.campos);
          // Nada muda: a resposta é o documento lido sob a trava — nenhuma escrita desde então.
          if (!edicao.mudou) return cur;
          // 1.2 y: a referência TROCADA existe nesta organização (a FK de coluna única não passa pela RLS).
          await conferirReferenciasDaEdicao(ctx, edicao.mudancas);
          await salvarEdicao(ctx, kind, id, cur, { d: edicao.d, corpo: edicao.mudancas, pares: edicao.pares, itens: edicao.itens, parcial: true,
            recusarSemItens: () => recusarItensVazios(() => lerPedidoDaEdicao(req.body, edicaoSchema, CHAVES_DA_EDICAO)) });
          const depois = await getDoc(ctx, id, kind) as DocumentoGravado;
          const enviados = [...Object.keys(edicao.mudancas), ...(pedido.campos.items !== undefined ? ["items"] : [])];
          const evento = eventoDaEdicao(cur, depois, enviados);
          await audit(ctx.tx, ctx, "sales_documents", id, "update", evento.metadados, { before: evento.before, after: evento.after });
          /*
           * TOP-CONFIG-08 — a confirmação automática, no FIM e só na PATCH que GRAVOU (a sem mudança voltou lá em cima: não
           * confirma e não ganha a chave). A resposta é o documento RELIDO depois da confirmação: confirmar muda a situação
           * e a 0039 soma 1 na `version`. Sem confirmar (recusada, aguardando aprovação, sem permissão), o savepoint
           * desfez tudo e o documento é o `depois`, lido antes dele. Com Idempotency-Key, o corpo gravado já leva o resultado.
           */
          const confirmacaoAutomatica = await confirmacaoAutomaticaDaVenda(app, ctx, kind, id, cur.tipo_operacao_versao_id);
          if (!confirmacaoAutomatica) return depois;
          return { ...(confirmacaoAutomatica.confirmado ? await getDoc(ctx, id, kind) : depois), confirmacaoAutomatica };
        })).result;
    }));
    /**
     * CANCELAMENTO — LÊ E MUTA A MESMA LINHA, logo TRAVA A LINHA.
     *
     * O caso caro não é o documento aberto: é a VENDA CONFIRMADA. Cancelá-la estorna estoque e cancela os
     * títulos, e `reverseStock` seleciona os movimentos por `reversed_by is null and movement_type<>'reversal'`
     * — coluna que o ledger imutável NUNCA preenche. O estorno é, portanto, REPETÍVEL por construção: o que
     * impede o segundo é exclusivamente o `status='cancelled'` já gravado. Sem trava, duas requisições leem
     * `confirmed` do mesmo snapshot, passam as duas pela conferência e lançam DOIS estornos da mesma saída —
     * o produto reaparece no estoque em dobro, e nenhuma das respostas é erro.
     *
     * A conferência de título com baixa (`paid_amount > 0`) precisa de uma trava PRÓPRIA, e não da do
     * documento: quem baixa um título é `POST /api/financial/<dir>/:id/settle`, que tranca a linha do
     * TÍTULO e nunca toca `erp.sales_documents`. Travar o documento não a serializa. Lida sem trava, a
     * conferência é clássica TOCTOU: o cancelamento lê `paid_amount = 0`, a baixa commita, e o
     * cancelamento segue estornando estoque e carimbando `cancelled` sobre um título que acabou de
     * receber baixa — com o movimento bancário vivo e `erp.refresh_title_status` já desistindo de
     * reconciliar, porque ela retorna cedo para título cancelado. Por isso a leitura abaixo é
     * `for update` SOBRE AS LINHAS DE TÍTULO em que a decisão se apoia. Isso fecha os dois sentidos: se a
     * baixa chega primeiro, o cancelamento lê o `paid_amount` novo e recusa; se chega depois, `settle`
     * espera o commit, relê `status='cancelled'` e recusa com ALREADY_CANCELLED.
     *
     * `order by id` não é enfeite: ordem de travamento arbitrária é o outro jeito de produzir 40P01 contra
     * quem trava as MESMAS linhas — e `settle-batch` as trava na ordem que o CLIENTE mandou. Ordenar deste
     * lado não elimina o ciclo sozinho (o outro lado continua livre), mas tira daqui a metade não
     * determinística; a outra metade está declarada no encerramento da fatia.
     *
     * IDEMPOTÊNCIA pelo helper oficial, o mesmo da conversão e da baixa financeira — não um mecanismo novo.
     * Ela resolve outro problema: o REENVIO (retry de rede, proxy, aba duplicada). A trava serializa; a
     * chave torna o reenvio inócuo. Uma não substitui a outra: chaves DIFERENTES na mesma venda continuam
     * dependendo só da trava, e a mesma chave em voo duplo continua dependendo só da chave.
     *
     * O hash carrega a IDENTIDADE DA OPERAÇÃO — ação, documento, variante, motivo e QUEM PEDIU. A chave é
     * única por (organização, chave) e NADA MAIS: sem `sourceId` no hash, a mesma chave reaproveitada em
     * outro documento devolveria 200 com a resposta do primeiro, e o segundo ficaria aberto para sempre
     * enquanto o usuário lê "cancelado". Com ele, isso é 409 — que é a resposta honesta.
     *
     * `actorId` fecha uma porta diferente, e é o motivo de ele não ser ruído. O REPLAY devolve o corpo
     * gravado ANTES de `getDoc` rodar — e é `getDoc` que aplica o recorte de EMPRESA. Sem o autor no hash,
     * quem tivesse a capacidade mas NÃO o escopo do documento receberia, ao reusar a chave alheia, um 200
     * com dados que a mesma rota lhe responderia 404. Com o autor dentro, chave de outro usuário diverge
     * SEMPRE, para id existente ou não: deixa de ser oráculo e vira apenas "esta chave já está tomada".
     * (A mesma propriedade falta à conversão e às demais rotas idempotentes — é preexistente, está
     * declarada no encerramento da fatia e pede correção própria, fora desta fronteira.)
     *
     * O corpo é conferido ANTES de reservar chave e antes de qualquer leitura de registro: forma do pedido e
     * autorização não dependem de a transação salvar ninguém.
     */
    app.post(`${base}/:id/cancel`, async (req) => runService(app, req, `${perm}.delete`, async (ctx) => {
      const { id } = req.params as { id: string };
      const motivo = cancelSchema.parse(req.body ?? {}).reason ?? null;
      await exigirDocumentoVisivel(ctx, id, kind);
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        { action: "cancel_sales_document", sourceId: id, sourceKind: kind, reason: motivo, actorId: ctx.user.id },
        async () => {
      const cur = await getDoc(ctx, id, kind, { lock: true }) as { status: string; kind: string; code: string; origin_document_id: string | null; items: { origem_item_id: string | null }[] };
      if (cur.status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelado");
      // F9 (decisão 286): a venda com origem trava o pedido ANTES dos estornos (a provisão dele é refeita no fim).
      if (cur.kind === "sale" && cur.origin_document_id) await travarPedidoDaProvisao(ctx, cur.origin_document_id);
      // TOP-CONFIG-06: a ORIGEM com parte não cancelada não se cancela — as partes continuariam citando um
      // documento cancelado, com saldo que ninguém mais controla.
      if ((await partesDaOrigem(ctx, id)).ativas > 0) throw err("INVALID_STATUS_TRANSITION", MSG_ORIGEM_COM_PARTES_ATIVAS_CANCEL);
      /**
       * ESTORNA SÓ O QUE FOI MATERIALIZADO (TOP-CONFIG-04A). Uma venda confirmada pode ter estoque e títulos,
       * só um dos dois, ou nenhum — conforme a política da versão congelada. O cancelamento NÃO pergunta à
       * configuração (nem à atual, nem à congelada) o que deveria ter acontecido: ele lê o que EXISTE ligado
       * a esta venda. `reverseStock` estorna exatamente os movimentos de origem deste documento (zero → nada),
       * e os títulos são os da mesma origem. Nenhuma compensação de algo que nunca existiu; nenhuma
       * dependência do gate — cancelar uma venda configurada continua possível com ele desligado.
       */
      let evidencia: { estornos: number; titulosCancelados: number } | null = null;
      if (cur.kind === "sale" && cur.status === "confirmed") {
        const titulos = await ctx.tx.query<{ paid_amount: string }>("select paid_amount from erp.financial_titles where organization_id=$1 and source_type='sales_documents' and source_id=$2 order by id for update", [ctx.orgId, id]);
        if (titulos.rows.some((t) => D(t.paid_amount).gt(0))) throw err("CONFLICT", "Títulos com baixa: cancele as baixas antes");
        const estornos = await reverseStock(ctx, "sales_documents", id, new Date().toISOString().slice(0, 10));
        const tc = await ctx.tx.query("update erp.financial_titles set status='cancelled' where organization_id=$1 and source_type='sales_documents' and source_id=$2 and status <> 'cancelled'", [ctx.orgId, id]);
        evidencia = { estornos, titulosCancelados: tc.rowCount ?? 0 };
      }
      const u = await ctx.tx.query("update erp.sales_documents set status='cancelled', updated_at=now() where id=$1 and organization_id=$2 and status <> 'cancelled'", [id, ctx.orgId]);
      // ROW COUNT SOB RLS: zero linha sem conferência seria "cancelado" sem efeito.
      if (u.rowCount !== 1) throw notFound("Documento");
      // O motivo vai para a auditoria — é o que faz dele um campo do contrato, e não um enfeite do hash.
      // Ausente, `undefined` mantém `metadata` nulo, exatamente como antes deste hotfix. Na venda confirmada
      // vai também o que foi estornado: é a evidência de que o cancelamento reverteu o que existia, e só.
      const metadados = { ...(motivo ? { reason: motivo } : {}), ...(evidencia ?? {}) };
      await audit(ctx.tx, ctx, "sales_documents", id, "cancel", Object.keys(metadados).length ? metadados : undefined);
      /*
       * TOP-CONFIG-06 — CANCELAR UMA PARTE devolve o saldo sozinho (o saldo é conta, não coluna). Se a origem estava
       * `converted` porque o saldo ZEROU (e não porque foi encerrado), ela volta a `open`, sob a trava da origem.
       * Derivado de conversão sem "Em partes" (nenhum item ligado) não mexe na origem, como antes.
       */
      if (cur.origin_document_id && cur.items.some((i) => i.origem_item_id !== null)) {
        const o = (await ctx.tx.query<{ status: string; saldo_encerrado_em: string | null }>("select status, saldo_encerrado_em from erp.sales_documents where id=$1 and organization_id=$2 for update", [cur.origin_document_id, ctx.orgId])).rows[0];
        if (o && o.status === "converted" && o.saldo_encerrado_em === null) {
          const v = await ctx.tx.query("update erp.sales_documents set status='open', updated_at=now() where id=$1 and organization_id=$2 and status='converted' and saldo_encerrado_em is null", [cur.origin_document_id, ctx.orgId]);
          if (v.rowCount !== 1) throw notFound("Documento");
          await audit(ctx.tx, ctx, "sales_documents", cur.origin_document_id, "parte_cancelada", { parte: id }, { before: { status: "converted" }, after: { status: "open" } });
        }
      }
      // F9 (decisão 286): o pedido cancelado cancela os previstos dele; a venda cancelada devolve ao pedido de origem o
      // que ela faturava (o previsto volta). Orçamento e venda sem origem → nada.
      if (cur.kind === "order") await sincronizarProvisaoDoPedido(ctx, id, MOTIVOS_DA_PROVISAO.pedidoCancelado(motivo));
      else if (cur.kind === "sale" && cur.origin_document_id) await sincronizarProvisaoDoPedido(ctx, cur.origin_document_id, MOTIVOS_DA_PROVISAO.vendaCancelada(cur.code));
      return { id, status: "cancelled" };
        })).result;
    }));
    /**
     * CONVERSÃO É OPERAÇÃO COMPOSTA — e por isso exige AS DUAS capacidades (BASE2-03C).
     *
     * Ela MUTA a variante fonte (status → `converted`) e CRIA um documento da variante destino. Autorizar
     * só pela criação do destino dava a quem tem `orders.create` o poder de encerrar um ORÇAMENTO que ele
     * não pode editar — capacidade de uma família virando mutação na outra.
     *
     * Contrato: `source.edit` ∧ `target.create`, combinados com AND. O `runService` cobra a capacidade da
     * FONTE (é a variante da rota, e é o registro que vai ser mutado). A do DESTINO é cobrada LÁ DENTRO,
     * depois de o destino REAL ser conhecido — e ainda antes de qualquer efeito. Sem permissão nova: as
     * duas já existem no catálogo.
     *
     * ┌─ POR QUE A CAPACIDADE DO DESTINO NÃO PODE MAIS SER COBRADA AQUI EM CIMA ────────────────────────┐
     * │ Até esta correção, a primeira linha do handler cobrava `permOf(nextSalesKind(kind)).create` — a  │
     * │ cadeia ANTIGA. Ela NÃO SUBSTITUÍA a cobrança do destino real: o ramo do grafo já cobrava        │
     * │ `permOf(destino).create` lá dentro, depois de resolver qual era o destino. As duas SOMAVAM.      │
     * │                                                                                                  │
     * │ Por isso o estrago tinha UMA direção só. Em orçamento → venda direta o requisito efetivo era     │
     * │ `budgets.edit` ∧ `orders.create` ∧ `sales.create`, e passou a ser `budgets.edit` ∧ `sales.create`.│
     * │ `orders.create` era exigência A MAIS, irrelevante para o que seria criado: ela RECUSAVA QUEM     │
     * │ PODIA — o vendedor com `sales.create` e sem `orders.create` levava 403 numa venda que tinha      │
     * │ direito de criar. E só podia recusar a mais, porque somar exigência estreita o conjunto          │
     * │ autorizado e nunca o alarga.                                                                     │
     * │                                                                                                  │
     * │ NÃO HOUVE ESCALAÇÃO, e é importante não inventá-la: em nenhum ramo do binário anterior um        │
     * │ derivado nascia sem a capacidade do destino real — no ramo da ponte o destino ERA               │
     * │ `nextSalesKind(kind)`, então a própria linha de cima era a cobrança correta daquele destino. É   │
     * │ por isso que a correção REMOVEU a cobrança extra e MANTEVE a do destino nos dois ramos, em vez   │
     * │ de acrescentar uma que faltasse. Qual é o destino só se sabe depois de ler o documento e o       │
     * │ grafo da versão que ele cita.                                                                    │
     * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
     */
    if (kind !== "sale") app.post(`${base}/:id/convert`, async (req, reply) => reply.status(201).send(await runService(app, req, `${perm}.edit`, async (ctx) => {
      const { id } = req.params as { id: string };
      const next = nextSalesKind(kind);
      // A TOP DO DESTINO NÃO SE HERDA DA FONTE — nem podia. `1101 — Orçamento padrão` é da família
      // `vendas.orcamento`; carregá-la para um pedido gravaria um documento cuja TOP é de outra família, e
      // a FK da 0021 nem sequer impediria (ela prova tenant e parentesco, não família). Por isso o corpo é
      // montado campo a campo e `tipo_operacao_id` NÃO entra: ele vem do PEDIDO de conversão.
      //
      // A resolução acontece ANTES de qualquer escrita. Como tudo roda numa transação só do `runService`,
      // uma TOP alvo inválida derruba a operação inteira e a fonte NÃO vira `converted` — nem por um
      // instante, nem em caso de erro no meio.
      const alvo = convertSchema.parse(req.body ?? {});
      const itensPedidos: ItemPedidoDaParte[] | undefined = alvo.itens?.map((i) => ({ itemId: i.item_id, quantidade: i.quantidade }));
      /**
       * IDEMPOTÊNCIA — a web JÁ manda `Idempotency-Key` (`idem: true` no diálogo de conversão) e o
       * servidor IGNORAVA o cabeçalho: duplo clique, retry de rede ou duas abas convertiam DUAS vezes.
       *
       * O hash carrega a IDENTIDADE DA OPERAÇÃO, não só o corpo. A chave é única por (organização, chave)
       * e nada mais, então a MESMA chave reaproveitada em OUTRO documento devolveria, com 201, a resposta
       * do primeiro — uma conversão que nunca aconteceu, reportada como sucesso, e a segunda fonte ficando
       * aberta para sempre. Com fonte e destino dentro do hash isso vira 409, que é a resposta honesta.
       * `?? null` porque `undefined` SOME do JSON: sem ele, `{}` e `{"tipo_operacao_id":null}` — que são o
       * mesmo pedido — gerariam hashes diferentes.
       *
       * FICA DE FORA do bloco o PARSE DO CORPO: forma do pedido não depende de ler registro nenhum, e
       * conferi-la antes de reservar a chave é a mesma ordem que o resto do servidor usa.
       *
       * A CAPACIDADE DO DESTINO, PORÉM, FICA DENTRO — e isto é uma correção do texto que estava aqui, não
       * um afrouxamento. Ela costumava ser cobrada lá em cima porque o destino era uma constante do
       * produto; agora ele depende do documento e da política da versão, que só se leem aqui dentro.
       *
       * ISSO NÃO DEIXA CHAVE ÓRFÃ, e é o mesmo motivo que já derrubava a justificativa antiga ("a chave
       * ficaria gravada sem resposta"): a transação do `runService` desfaz TUDO em qualquer throw, e o
       * INSERT da chave de idempotência vai junto. Um 403 por falta da capacidade do destino não reserva
       * chave nenhuma — a mesma chave pode ser reenviada depois, e será a primeira execução de verdade.
       *
       * O que continua inegociável é a ORDEM DENTRO DO BLOCO: ler e travar a fonte não é efeito; a
       * permissão do destino REAL é cobrada depois de saber qual é o destino e ANTES de `writeDoc`, antes
       * de a fonte virar `converted` e antes de qualquer auditoria.
       */
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        // O HASH NÃO MUDA DE FORMA NESTA FATIA, de propósito. `targetKind` continua sendo o destino da
        // cadeia anterior — é um componente de hash, não uma afirmação sobre o que será criado. Mudar a
        // forma faria o binário antigo e o novo calcularem chaves DIFERENTES para o mesmo pedido durante o
        // rolling deploy, e um retry que atravessasse a janela converteria duas vezes. O destino real já
        // entra no hash por `tipo_operacao_id`, que é o que distingue duas escolhas diferentes.
        // TOP-CONFIG-06: `itens` entra no hash SÓ quando presente (normalizado). Ausente, o hash é o de antes — um
        // retry em voo durante o deploy continua casando com a chave reservada pelo binário anterior.
        { action: "convert_sales_document", sourceId: id, sourceKind: kind, targetKind: next, tipo_operacao_id: alvo.tipo_operacao_id ?? null,
          ...(itensPedidos ? { itens: itensCanonicosDaParte(itensPedidos) } : {}) },
        async () => {
      // `lock: true` — a fonte é LIDA E MUTADA na mesma transação, e é a única leitura desta rota que
      // disputa linha com outra requisição. Ver a justificativa inteira no cabeçalho de `getDoc`.
      const cur = await getDoc(ctx, id, kind, { lock: true }) as Record<string, unknown> & { status: string; kind: SalesKind; items: Record<string, unknown>[]; tipo_operacao_versao_id?: string | null };
      assertConvertible({ kind: cur.kind, status: cur.status as "open" });

      /**
       * ┌─ QUEM DECIDE O DESTINO: O GRAFO DA VERSÃO DE ORIGEM (TOP-CONFIG-03) ─────────────────────────┐
       * │ Até aqui a variante de destino saía de `nextSalesKind`, uma constante do produto. Agora ela  │
       * │ sai da TOP ESCOLHIDA, e o que valida a escolha é a política congelada na versão que ESTE     │
       * │ documento cita. Orçamento pode ir direto para venda se a organização configurou assim.       │
       * └──────────────────────────────────────────────────────────────────────────────────────────────┘
       *
       * ┌─ A DECISÃO É PELO ESTADO DA POLÍTICA, NUNCA PELA CARDINALIDADE ──────────────────────────────┐
       * │ `passos.length > 0` colapsava as duas leituras que a versão sabe distinguir, e o efeito era  │
       * │ um servidor que desobedecia ao administrador: quem declarasse "esta operação não tem próximo │
       * │ passo" via a web obedecer e uma chamada direta a esta rota converter assim mesmo. A política │
       * │ vazia deixava de existir na prática.                                                          │
       * │                                                                                               │
       * │   politica.configurada = true   → O GRAFO É AUTORIDADE, INCLUSIVE VAZIO.                      │
       * │                                   zero itens → RECUSA; destino fora da lista → RECUSA.        │
       * │   politica.configurada = false  → PONTE LEGADA: segue a cadeia anterior, e SÓ aqui.           │
       * └───────────────────────────────────────────────────────────────────────────────────────────────┘
       *
       * ┌─ A PONTE, E POR QUE ELA EXISTE (medido, não suposto) ────────────────────────────────────────┐
       * │ Toda versão anterior a esta fatia nasceu com `destinos_configurados = false`: não havia onde  │
       * │ declarar política. Exigir a aresta de imediato quebraria TODA conversão de TODA organização   │
       * │ no instante do deploy, incluindo a do cliente que nunca vai abrir a tela nova.                │
       * │                                                                                               │
       * │ Isto NÃO é "inferir a cadeia por conta própria": é preservar, para quem NUNCA declarou nada,  │
       * │ exatamente o contrato que ele tem hoje. Quem declara — mesmo que declare o vazio — sai da     │
       * │ ponte na mesma hora. A tela NOVA não usa esta ponte: lá, política declarada sem transição     │
       * │ mostra `Próximos passos` vazio e não oferece conversão. A ponte é transitória e tem saída     │
       * │ declarada em docs/DECISIONS.md.                                                               │
       * └───────────────────────────────────────────────────────────────────────────────────────────────┘
       */
      const politica = await politicaDeDestinos(ctx, cur.tipo_operacao_versao_id);
      let destino: SalesKind;
      let topDestino: TopDoLancamento | null = null;
      // TOP-CONFIG-06: só a aresta da versão CONGELADA da origem liga "Em partes"; a ponte legada, nunca.
      let emPartes = false;

      if (politica.configurada) {
        // POLÍTICA DECLARADA SEM NENHUM DESTINO É UMA DECISÃO, e a decisão é "não converte". Cair na ponte
        // aqui seria desfazer, no servidor, o que o administrador configurou. A recusa não vaza nada: fala
        // sobre a operação do documento que o usuário já está vendo.
        if (politica.itens.length === 0) {
          throw new DomainError("TIPO_OPERACAO_INDISPONIVEL",
            "A operação deste documento não gera nenhuma próxima operação");
        }
        if (!alvo.tipo_operacao_id) {
          throw new DomainError("TIPO_OPERACAO_INDISPONIVEL",
            "Escolha qual próxima operação deve ser gerada a partir deste documento");
        }
        const escolhido = politica.itens.find((x) => x.tipoOperacaoId === alvo.tipo_operacao_id);
        // MESMA recusa para "não está no grafo", "foi desativada", "foi excluída" e "não existe": o diálogo
        // de conversão não pode virar um oráculo de quais TOPs existem na organização.
        if (!escolhido) {
          throw new DomainError("TIPO_OPERACAO_INDISPONIVEL",
            "Esta próxima operação não está disponível para este documento");
        }
        destino = escolhido.variante;
        emPartes = escolhido.emPartes;
        // A CAPACIDADE DO DESTINO É COBRADA DEPOIS DE SABER QUAL É O DESTINO REAL — e ainda ANTES de
        // qualquer efeito. Ler e travar a fonte não é efeito; a fonte só vira `converted` bem mais abaixo,
        // e um throw aqui desfaz a transação inteira: 403, fonte segue `open`, zero derivado, zero
        // auditoria. O grafo restringe o caminho; quem autoriza percorrê-lo continua sendo a capacidade.
        requirePermission(ctx, `${permOf(destino)}.create`);
        topDestino = await resolverTopParaLancamento(ctx, familiaDaVariante(destino), escolhido.tipoOperacaoId);
      } else {
        // PONTE LEGADA — a versão nunca declarou política, então o destino é o da cadeia anterior. A
        // capacidade cobrada é a DESSE destino, pelo mesmo motivo e no mesmo ponto do ramo de cima.
        destino = next;
        requirePermission(ctx, `${permOf(destino)}.create`);
        topDestino = alvo.tipo_operacao_id ? await resolverTopParaLancamento(ctx, familiaDaVariante(destino), alvo.tipo_operacao_id) : null;
      }
      if (itensPedidos && !emPartes) throw err("VALIDATION_ERROR", MSG_NAO_PERMITE_EM_PARTES, [{ path: "itens", message: MSG_NAO_PERMITE_EM_PARTES }]);
      /*
       * TOP-CONFIG-06 — A PARTE. Lida DEPOIS da trava da origem (`getDoc(..., { lock: true })` acima): duas conversões
       * simultâneas se enfileiram ali, e a segunda lê o saldo que a primeira deixou. O gatilho da 0034 é a rede.
       */
      let parte: { calculo: ReturnType<typeof calcularParte>; porId: Map<string, { warehouseId: string | null; note: string | null }> } | null = null;
      if (emPartes) {
        const origemItens = await itensDeOrigemComSaldo(ctx, id);
        let pedidos: ItemPedidoDaParte[];
        if (itensPedidos) {
          const v = validarItensDaParte(origemItens, itensPedidos);
          if (!v.ok) {
            const details = v.recusas.map((x) => ({ path: "itens", message: MSG_ITENS_DA_PARTE[x.motivo], ...x }));
            throw err("VALIDATION_ERROR", details[0]!.message, details);
          }
          pedidos = v.itens;
        } else {
          pedidos = itensDoSaldoInteiro(origemItens);
          if (!pedidos.length) throw err("VALIDATION_ERROR", MSG_SEM_SALDO_PARA_CONVERTER, [{ path: "itens", message: MSG_SEM_SALDO_PARA_CONVERTER }]);
        }
        const planoOrigem = (cur.installment_plan ?? {}) as { installments?: number; has_down_payment?: boolean; down_payment_value?: string | number };
        const cabecalhoOrigem = { freight: String(cur.freight), freightIcms: String(cur.freight_icms), otherValues: String(cur.other_values), discount: String(cur.discount),
          entrada: planoOrigem.has_down_payment && planoOrigem.down_payment_value !== undefined ? String(planoOrigem.down_payment_value) : "0" };
        parte = { calculo: calcularParte(origemItens, cabecalhoOrigem, await cabecalhoJaAlocado(ctx, id), pedidos), porId: new Map(origemItens.map((i) => [i.id, i])) };
      }
      // CONDIÇÃO DA ORIGEM (VENDAS-A4): ajustada → plano copiado como está; não ajustada → o destino deriva o
      // plano na SUA data e no SEU total. A marca de dedutível (D-1) é copiada da origem, com ou sem plano.
      const origemCond = cur as unknown as { condicao_pagamento_id: string | null; parcelas_ajustadas: boolean };
      const bodyInteiro = () => docSchema.parse({ empresa_id: cur.empresa_id, document_date: new Date().toISOString().slice(0, 10), shipping_date: cur.shipping_date, due_date: cur.due_date, client_id: cur.client_id, transporter_id: cur.transporter_id, proprietary_id: cur.proprietary_id, driver_name: cur.driver_name, payment_method_id: cur.payment_method_id, freight: cur.freight, freight_icms: cur.freight_icms, other_values: cur.other_values, discount: cur.discount, note: cur.note, installment_plan: (cur.installment_plan as { installments?: number })?.installments && (!origemCond.condicao_pagamento_id || origemCond.parcelas_ajustadas) ? cur.installment_plan : null, is_deductible: Boolean((cur.installment_plan as { is_deductible?: boolean } | null)?.is_deductible), items: cur.items.map((i) => ({ product_id: i.product_id, warehouse_id: i.warehouse_id, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, discount_percent: i.discount_percent, note: i.note })) });
      /*
       * A PARTE: mesmo corpo, com os itens e os valores de cabeçalho de `calcularParte`. Parcelamento: com condição a
       * parte RECALCULA pela condição no total dela (parcela ajustada à mão não passa); sem condição vai o plano da
       * origem com a entrada fixa proporcional.
       */
      const bodyDaParte = (p: NonNullable<typeof parte>) => {
        const planoOrigem = cur.installment_plan as { installments?: number; has_down_payment?: boolean } | null;
        const plano = !origemCond.condicao_pagamento_id && planoOrigem?.installments
          ? { ...planoOrigem, ...(planoOrigem.has_down_payment ? { down_payment_value: p.calculo.cabecalho.entrada } : {}) } : null;
        return docSchema.parse({ ...bodyInteiro(), freight: p.calculo.cabecalho.freight, freight_icms: p.calculo.cabecalho.freightIcms,
          other_values: p.calculo.cabecalho.otherValues, discount: p.calculo.cabecalho.discount, installment_plan: plano,
          items: p.calculo.itens.map((i) => ({ product_id: i.productId, warehouse_id: p.porId.get(i.origemItemId)?.warehouseId ?? null, quantity: i.quantity,
            unit_price: i.unitPrice, discount: i.discount, discount_percent: i.discountPercent, note: p.porId.get(i.origemItemId)?.note ?? null })) });
      };
      const body = parte ? bodyDaParte(parte) : bodyInteiro();
      // A classificação da ORIGEM é copiada e passa pela MESMA porta: se deixou de valer, a conversão inteira
      // é recusada antes de qualquer efeito (a fonte continua aberta; a transação garante).
      const origemClass = cur as unknown as { categoria_financeira_id: string | null; centro_custo_id: string | null };
      const classificacao = origemClass.categoria_financeira_id && origemClass.centro_custo_id
        ? await validarClassificacaoFinanceira(ctx, { categoriaFinanceiraId: origemClass.categoria_financeira_id, centroCustoId: origemClass.centro_custo_id }, "origem") : null;
      // A condição da ORIGEM passa pela MESMA porta: se deixou de valer, a conversão inteira é recusada antes
      // de qualquer efeito (fonte aberta, zero derivado, zero auditoria).
      const condicao = { linha: origemCond.condicao_pagamento_id ? await validarCondicaoDoDocumento(ctx, origemCond.condicao_pagamento_id) : null, gravar: true };
      /*
       * REGRAS DA OPERAÇÃO DA TOP DESTINO (TOP-CONFIG-05, decisão 263). O documento GERADO é conferido contra a
       * versão ATUAL da TOP destino — a mesma que `writeDoc` congela nele — com a), b), c) na ordem fixa e os
       * MESMOS códigos da criação. ANTES de `writeDoc`: um throw aqui desfaz a transação inteira (fonte `open`,
       * zero derivado, zero auditoria). Destino sem TOP ou TOP formato 1/2 → `regras` null → nada muda.
       * Pedido cuja condição a TOP de venda não permite NÃO converte (declarado na decisão 263).
       */
      if (topDestino) {
        const { regras } = await regrasDaTopAtual(ctx, topDestino.tipoOperacaoId);
        await cobrarRegrasDaOperacao(ctx, regras, {
          client_id: body.client_id ?? null, transporter_id: body.transporter_id ?? null, note: body.note ?? null,
          centro_custo_id: classificacao?.centroCustoId ?? null,
          condicao_pagamento_id: origemCond.condicao_pagamento_id,
        }, { conferirCondicao: true, conferirAtraso: true });
      }
      /*
       * TOP-CONFIG-07 — O PEDIDO GERADO por conversão (orçamento → pedido) sob TOP destino que reserva É um pedido com
       * reserva sendo salvo: a MESMA conferência do POST (armazém obrigatório e da empresa, cabe no disponível sob a
       * trava do produto), ANTES de writeDoc — sem ela, converter seria a porta lateral para reservar além do físico.
       */
      if (destino === "order" && topDestino && await versaoReservaEstoque(ctx, topDestino.tipoOperacaoVersaoId)) {
        // Contador do ID Global ANTES da trava do produto: writeDoc vai alocar, e a ordem é contador → produto em todo caminho.
        await travarContadorIdGlobal(ctx);
        await conferirReservaDoDocumento(ctx, { itens: body.items, empresaId: body.empresa_id, excluirDocumentoId: null });
      }
      const r = await writeDoc(ctx, destino, body, undefined, id, topDestino, classificacao, condicao, parte ? parte.calculo.itens.map((i) => i.origemItemId) : []);
      if (!parte) {
        await ctx.tx.query("update erp.sales_documents set status='converted', updated_at=now() where id=$1", [id]);
        await audit(ctx.tx, ctx, "sales_documents", id, "convert", topDestino ? { to: r.id, tipoOperacaoDestinoId: topDestino.tipoOperacaoId, tipoOperacaoDestinoVersaoId: topDestino.tipoOperacaoVersaoId } : { to: r.id });
      } else {
        // A origem só vira `converted` quando esta parte zera o saldo de TODOS os itens; senão o status não muda.
        if (parte.calculo.zeraOSaldo) {
          const u = await ctx.tx.query("update erp.sales_documents set status='converted', updated_at=now() where id=$1 and organization_id=$2 and status in ('open','approved')", [id, ctx.orgId]);
          if (u.rowCount !== 1) throw notFound("Documento");
        }
        await audit(ctx.tx, ctx, "sales_documents", id, "convert", { to: r.id, ...(topDestino ? { tipoOperacaoDestinoId: topDestino.tipoOperacaoId, tipoOperacaoDestinoVersaoId: topDestino.tipoOperacaoVersaoId } : {}),
          emPartes: true, zeraOSaldo: parte.calculo.zeraOSaldo, itens: parte.calculo.itens.map((i) => ({ origemItemId: i.origemItemId, quantidade: i.quantity })) });
      }
      if (topDestino) await audit(ctx.tx, ctx, "sales_documents", r.id!, "create", { tipoOperacaoId: topDestino.tipoOperacaoId, tipoOperacaoVersaoId: topDestino.tipoOperacaoVersaoId, tipoOperacaoCodigo: topDestino.codigo, tipoOperacaoVersao: topDestino.versao, from: id });
      /*
       * TOP-CONFIG-08 (decisão 277) — a VENDA GERADA, inteira ou em partes, confirma sozinha quando a versão congelada
       * DELA (a da TOP de destino, que o `writeDoc` acabou de gravar; nunca a da origem) é formato 4 "Automática". No FIM:
       * depois de a origem ficar convertida (ou de a parte ser registrada) e das auditorias "convert" e "create". A
       * confirmação recusada desfaz só o savepoint: a gerada fica aberta e a origem convertida, como hoje. A resposta de
       * hoje ganha só `confirmacaoAutomatica`, e só nesse caso; o replay da chave devolve o corpo gravado, com o resultado.
       * Pedido gerado (orçamento → pedido) nunca: `confirmacaoAutomaticaDaVenda` só serve à variante `sale`.
       */
      return comConfirmacaoAutomatica(app, ctx, destino, r.id!, topDestino?.tipoOperacaoVersaoId ?? null, { id: r.id, kind: destino, from: id });
        })).result;
    })));
    /**
     * ENCERRAR SALDO (TOP-CONFIG-06, decisão 265). O documento convertido em partes deixa de ter saldo a converter:
     * vira `converted` com quem, quando e por quê. Só com pelo menos uma parte não cancelada e saldo > 0. Capacidade
     * `${perm}.edit` — muta a origem, como a conversão. Visibilidade conferida ANTES do helper de idempotência
     * (`exigirDocumentoVisivel`), e o autor entra no hash pelo mesmo motivo do cancelamento.
     */
    if (kind !== "sale") app.post(`${base}/:id/encerrar-saldo`, async (req) => runService(app, req, `${perm}.edit`, async (ctx) => {
      const { id } = req.params as { id: string };
      const { motivo } = encerrarSaldoSchema.parse(req.body ?? {});
      await exigirDocumentoVisivel(ctx, id, kind);
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        { action: "encerrar_saldo", sourceId: id, sourceKind: kind, motivo, actorId: ctx.user.id },
        async () => {
          const cur = await getDoc(ctx, id, kind, { lock: true }) as { status: string };
          if (cur.status !== "open" && cur.status !== "approved") throw err("INVALID_STATUS_TRANSITION", "Documento não editável neste status");
          if ((await partesDaOrigem(ctx, id)).ativas === 0) throw err("VALIDATION_ERROR", MSG_SEM_PARTES);
          const saldo = saldoTotal(await itensDeOrigemComSaldo(ctx, id));
          if (!saldo.gt(0)) throw err("VALIDATION_ERROR", MSG_SEM_SALDO_A_ENCERRAR);
          const u = await ctx.tx.query("update erp.sales_documents set status='converted', saldo_encerrado_em=now(), saldo_encerrado_por=$3, saldo_encerrado_motivo=$4, updated_at=now() where id=$1 and organization_id=$2 and status in ('open','approved')", [id, ctx.orgId, ctx.user.id, motivo]);
          // ROW COUNT SOB RLS: zero linha sem conferência seria "encerrado" sem efeito.
          if (u.rowCount !== 1) throw notFound("Documento");
          await audit(ctx.tx, ctx, "sales_documents", id, "encerrar_saldo", { motivo, saldo: saldo.toFixed(4) }, { before: { status: cur.status }, after: { status: "converted" } });
          // F9 (decisão 286): com o saldo encerrado, o pedido só prevê o que as partes geradas ainda não faturaram.
          if (kind === "order") await sincronizarProvisaoDoPedido(ctx, id, MOTIVOS_DA_PROVISAO.saldoEncerrado(motivo));
          return { id, status: "converted" };
        })).result;
    }));
    /**
     * CONFIRMAÇÃO. A trava mora em `confirmSale`, junto da primeira decisão que ela protege; aqui fica só
     * a idempotência, que resolve o outro problema — o REENVIO do mesmo pedido.
     *
     * O hash passou a declarar a AÇÃO, e não apenas `{ confirm: id }`. Não é cosmética: a chave é
     * escolhida pelo CLIENTE e vale para o servidor inteiro, então o que distingue "confirmar a venda X"
     * de "cancelar a venda X" ou "converter o orçamento X" é exclusivamente o hash. Com as três ações
     * declarando a própria identidade no mesmo formato, a quarta não tem como copiar a errada.
     *
     * O preço está declarado: uma chave reservada pelo binário ANTERIOR e reenviada ao novo durante o
     * rolling deploy computa outro hash e recebe 409 em vez do replay. A direção da falha é a segura —
     * recusa explícita, nenhuma execução, nada duplicado — e a web gera chave nova a cada envio, de modo
     * que quem atravessaria a janela é um cliente programático que guarde a própria chave.
     */
    // PRÉVIA DA CONFIRMAÇÃO (VENDAS-A5-1): leitura, com a capacidade de LER a venda — quem pode abrir o
    // documento pode ver o que a confirmação faria; confirmar continua exigindo `sales.edit`.
    if (kind === "sale") app.get(`${base}/:id/previa-confirmacao`, async (req) => runService(app, req, "sales.view", (ctx) => previaDaConfirmacao(ctx, (req.params as { id: string }).id, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED)));
    if (kind === "sale") app.post(`${base}/:id/confirm`, async (req) => runService(app, req, "sales.edit", async (ctx) => { const { id } = req.params as { id: string }; await exigirDocumentoVisivel(ctx, id, "sale"); return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined, { action: "confirm_sales_document", sourceId: id, actorId: ctx.user.id }, () => confirmarVendaNaTransacao(app, ctx, id, { automatica: false }))).result; }));
  }
  // Curva ABC e relatórios de vendas simples
  /**
   * ═══ A LISTA ÚNICA DE DOCUMENTOS COMERCIAIS DE VENDA (TOP-CONFIG-03) ═══
   *
   * Orçamento, pedido e venda deixam de ser TRÊS PORTAS e passam a ser três valores de uma coluna. O
   * operador pergunta "onde está o documento do cliente X", não "em qual das três telas ele está" — e
   * procurar em três lugares era o sintoma de a arquitetura estar modelada pela tabela, não pelo processo.
   *
   * ┌─ O RECORTE POR CAPACIDADE É A PARTE PERIGOSA, E É FAIL-CLOSED ──────────────────────────────────────┐
   * │ Na tela por etapa, a capacidade fechava a PORTA inteira: sem `orders.view`, a aba não existia. Numa  │
   * │ lista única ela precisa recortar LINHAS, e é aqui que se cometem os dois erros clássicos:            │
   * │                                                                                                      │
   * │   1. recortar DEPOIS de paginar — devolve páginas curtas e vaza a contagem real do que não se pode   │
   * │      ver. Por isso a variante entra no WHERE, antes do `limit`, e não num filtro sobre o resultado.  │
   * │   2. tratar "nenhuma variante autorizada" como "todas" — a lista vazia nunca vira lista completa.    │
   * │      Sem nenhuma capacidade de leitura a resposta é 403, não uma lista sem filtro.                   │
   * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * PORTA DINÂMICA (`permission: null`): a capacidade exigida DEPENDE do que o usuário pode ver, então ela
   * é resolvida aqui dentro, antes de qualquer dado sair — o padrão que `.claude/rules/backend-api.md`
   * descreve para permissão que depende da linha. Com módulo indefinido a RLS de empresa passa a valer
   * pela união das empresas visíveis, que é MAIS LARGA; por isso o recorte de empresa é reaplicado no SQL
   * com o módulo EXPLÍCITO da permissão de vendas. RLS ∧ SQL = o escopo exato, e nenhum dos dois sozinho
   * decide.
   */
  app.get("/sales/documentos", async (req) => runService(app, req, null, async (ctx) => {
    const variantes: SalesKind[] = ["budget", "order", "sale"];
    const permitidas = variantes.filter((k) => hasPermission(ctx, `${permOf(k)}.view`));
    // "Lista vazia" NUNCA é "todas". Sem nenhuma capacidade de leitura, a recusa é explícita.
    if (permitidas.length === 0) throw denied(`${permOf("sale")}.view`);

    const q = pageQuerySchema.parse(req.query);
    const f = req.query as Record<string, string | undefined>;
    const params: unknown[] = [ctx.orgId];
    const where = [`d.organization_id=$1`, `d.deleted_at is null`];

    // A VARIANTE ENTRA NO WHERE — sempre, e antes do limite. Este é o recorte de autorização.
    params.push(permitidas); where.push(`d.kind = any($${params.length}::text[])`);

    // O filtro `kind` do usuário é PEDIDO, nunca autorização: ele só pode DIMINUIR o conjunto já
    // autorizado acima. Variante desconhecida ou não autorizada não alarga nada — a interseção esvazia.
    if (f.kind) {
      const pedidas = f.kind.split(",").map((x) => x.trim()).filter((x) => (permitidas as string[]).includes(x));
      params.push(pedidas); where.push(`d.kind = any($${params.length}::text[])`);
    }

    if (f.client_id) { params.push(f.client_id); where.push(`d.client_id=$${params.length}`); }
    if (f.status) { params.push(f.status); where.push(`d.status=$${params.length}`); }
    if (f.empresa_id) { params.push(f.empresa_id); where.push(`d.empresa_id=$${params.length}`); }
    if (f.start_date) { params.push(f.start_date); where.push(`d.document_date>=$${params.length}`); }
    if (f.end_date) { params.push(f.end_date); where.push(`d.document_date<=$${params.length}`); }
    if (q.search) { params.push(`%${q.search}%`); where.push(`(d.code ilike $${params.length} or c.name ilike $${params.length})`); }
    // Forma conferida ANTES de virar parâmetro, como na listagem por variante: id malformado recorta para
    // zero linhas em vez de virar erro de banco — e não revela nada.
    if (f.tipo_operacao_id) {
      if (FORMA_UUID.test(f.tipo_operacao_id)) { params.push(f.tipo_operacao_id); where.push(`d.tipo_operacao_id=$${params.length}`); }
      else where.push("false");
    }
    where.push(...empresaScope(ctx, "d", params, { ignoreSelected: true, modulo: moduloDaPermissao(`${permOf("sale")}.view`) }));

    const filtro = where.join(" and ");
    const de = `from erp.sales_documents d
                left join erp.people c on c.id = d.client_id
                left join erp.empresas e on e.id = d.empresa_id
                left join erp.tipos_operacao toper on toper.id = d.tipo_operacao_id and toper.organization_id = d.organization_id
                left join erp.tipos_operacao_versoes topv on topv.id = d.tipo_operacao_versao_id and topv.organization_id = d.organization_id
               where ${filtro}`;

    const total = await ctx.tx.query<{ n: string; soma: string }>(
      `select count(*)::text n, coalesce(sum(d.total),0)::text soma ${de}`, params);
    const r = await ctx.tx.query<Record<string, unknown> & {
      kind: string; tipo_operacao_id: string | null; top_codigo: string | null;
      top_codigo_base: string | null; top_nome: string | null; top_versao: number | null;
    }>(
      `select d.id, d.code, d.kind, d.document_date, d.status, d.subtotal, d.discount, d.freight, d.total,
              d.tipo_operacao_id, c.name as client_name, e.name as empresa_name,
              toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao
         ${de}
         order by d.document_date desc, d.created_at desc
         limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);

    const items = r.rows.map((x) => ({
      ...x,
      // O RÓTULO DO TIPO SAI DO REGISTRY, nunca de um mapa literal no servidor ou no cliente: é a mesma
      // fonte que decide qual família cada variante é.
      kind_rotulo: t(chaveI18nDaFamiliaOperacional(familiaOperacionalDeDocumentoVenda(x.kind) ?? "") ?? x.kind),
      tipo_operacao: topParaTela(x)
    }));
    return paginaComIdGlobal(ctx, "sales_documents",
      { items, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { total: total.rows[0]!.soma } });
  }));

  app.get("/sales/abc", async (req) => runService(app, req, "report.sales_abc.view", async (ctx) => { const f = req.query as Record<string, string>; const r = await consultaEscopada<{ product_id: string; product_name: string; value: string; quantity: string }>(ctx, "select i.product_id, p.description as product_name, sum(i.total) as value, sum(i.quantity) as quantity from erp.sales_document_items i join erp.sales_documents d on d.id=i.document_id join erp.products p on p.id=i.product_id where d.organization_id=$1 and d.kind='sale' and d.status in ('confirmed','invoiced') and ($2::date is null or d.document_date>=$2) and ($3::date is null or d.document_date<=$3) and {{escopo:d.empresa_id}} group by 1,2 order by 3 desc", [ctx.orgId, f.start_date ?? null, f.end_date ?? null]); const { abcClassify } = await import("@agro/domain"); return { items: abcClassify(r.rows), total: money(r.rows.reduce((a, x) => a.plus(x.value), D(0))) }; }));
}
