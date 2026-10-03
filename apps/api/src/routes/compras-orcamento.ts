/**
 * OPERACOES-01 F6a (decisão 283) — O ORÇAMENTO DE COMPRA: APROVADO PARA ORÇAMENTO, OS ORÇAMENTOS E O VENCEDOR.
 *
 * O orçamento de compra é a terceira espécie de `erp.documentos_compra` (`especie = 'orcamento'`, família
 * `compras.orcamento`, recurso `orcamentos_compra`): UM por fornecedor, ligado ao pedido que cota pelo vínculo
 * PRÓPRIO (`pedido_orcado_id` / `item_pedido_orcado_id`, 0044) — nunca pela origem, que é da compra e consome saldo.
 * Puxa TODOS os itens do pedido (produto, Local de estoque, quantidade, posição); o que se digita é o preço de cada
 * item, a condição, o prazo de entrega (dias), a validade e a observação. Não confirma, não mexe em estoque nem em
 * financeiro: o fim dele é ser ESCOLHIDO (vencedor), NÃO ESCOLHIDO ou CANCELADO.
 *
 * ┌─ AS ROTAS ───────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ POST /compras/pedidos/:id/aprovar-para-orcamento        compras.edit ∧ pedidos_compra.view                 │
 * │ POST /compras/pedidos/:id/orcamentos                     orcamentos_compra.create ∧ pedidos_compra.view    │
 * │ POST /compras/pedidos/:id/orcamentos/:orcamentoId/escolher  pedidos_compra.edit ∧ orcamentos_compra.edit   │
 * │ GET  /compras/orcamentos (lista) e /:id (leitura)        orcamentos_compra.view                            │
 * │ GET  /compras/orcamentos/{operation-types,regras-da-operacao,layout-efetivo}   orcamentos_compra.create    │
 * │ PUT  /compras/orcamentos/:id                             orcamentos_compra.edit (substitui os editáveis)   │
 * │ POST /compras/orcamentos/:id/cancel                      orcamentos_compra.delete                          │
 * │ Não existe POST /compras/orcamentos: o orçamento nasce do pedido.                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ORDEM DE TODA ESCRITA: corpo estrito (422) → id da rota fora da forma (a MESMA 404 do GET) → a capacidade a mais
 * (AND, 403) → a VISIBILIDADE (`lerDocumentoCompra`: inexistente, de outro tenant, fora do escopo e espécie errada
 * caem na MESMA 404) → a idempotência (com o AUTOR no hash; uuid em minúsculas ANTES do hash) → as travas → as
 * recusas da regra → as gravações, cada UPDATE sob RLS com ROW COUNT conferido → a auditoria.
 *
 * ┌─ AS TRAVAS (sem ciclo) ──────────────────────────────────────────────────────────────────────────────────┐
 * │ Aprovar para orçamento, criar orçamento, escolher vencedor e editar orçamento travam o PEDIDO primeiro —  │
 * │ como o finalizar e o receber. Escolher: pedido → os orçamentos dele (FOR UPDATE, em ordem de id) → itens  │
 * │ do pedido (pelo UPDATE). Editar: pedido → o orçamento. Cancelar o orçamento trava só o orçamento, e        │
 * │ nenhum gatilho dele toca o pedido.                                                                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O banco é o fundo (0044): o orçamento só nasce de pedido ABERTO, APROVADO PARA ORÇAMENTO e da mesma empresa;
 * um vivo por fornecedor e um vencedor por pedido (índices únicos); todo item liga a um item do pedido com o mesmo
 * produto e a mesma quantidade; o item do pedido orçado não troca de produto nem de quantidade. A API explica com
 * as mensagens do domínio (`compras-finalizacao-orcamento.ts`); o banco barra se um dia as duas divergirem.
 *
 * Dinheiro em decimal (`D`, `money`, `itemTotal`, `documentTotals`), texto na API — nunca ponto flutuante.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { D, isISODate, DomainError } from "@agro/shared";
import {
  documentTotals, itemTotal, planoDaCondicao, familiaOperacionalDeDocumentoCompra, chaveI18nDaFamiliaOperacional,
  camposExigidosTop, exigenciasGeraisFaltando, EXIGENCIAS_GERAIS_ORCAMENTO_COMPRA_TOP,
  ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA, ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, MENSAGEM_CONDICAO_NAO_PERMITIDA,
  CAPACIDADE_CONDICAO_PAGAMENTO, CAPACIDADE_REGRAS_DA_OPERACAO, CAPACIDADE_LAYOUT_DOCUMENTO, CAPACIDADE_FINALIZACAO_E_ORCAMENTO_COMPRA,
  ERRO_LAYOUT_CAMPO_OBRIGATORIO, camposObrigatoriosFaltando, mensagemCampoObrigatorio, FORMA_UUID_PADRAO,
  MSG_APROVAR_ORCAMENTO_SO_PEDIDO_ABERTO, MSG_PEDIDO_JA_APROVADO_PARA_ORCAMENTO, MSG_ORCAMENTO_SO_PEDIDO_ABERTO,
  MSG_PEDIDO_NAO_APROVADO_PARA_ORCAMENTO, MSG_PEDIDO_SEM_TOP_DE_ORCAMENTO, MSG_ORCAMENTO_FORNECEDOR_REPETIDO,
  MSG_PEDIDO_JA_TEM_VENCEDOR, MSG_ORCAMENTO_NAO_ABERTO, MSG_ORCAMENTO_PEDIDO_NAO_ABERTO, MSG_VENCEDOR_SO_PEDIDO_ABERTO,
  MSG_VENCEDOR_PEDIDO_COM_COMPRA, MSG_ORCAMENTO_NAO_COBRE_O_PEDIDO, MSG_ORCAMENTO_PRECO_DOS_ITENS,
  MSG_ORCAMENTO_ITEM_DE_OUTRO_PEDIDO, MSG_ORCAMENTO_VALIDADE_ANTES_DA_DATA,
} from "@agro/domain";
import { criarTradutor, ptBR } from "@erp/plataforma";
import { runService, nextCode, idempotent, audit, requirePermission } from "../lib/service.js";
import { notFound, err } from "../lib/errors.js";
import { exigirEmpresaDeLancamento, type ServiceCtx } from "../lib/context.js";
import { atribuirIdGlobal } from "../lib/id-global.js";
import { resolverTopParaLancamento, validarCondicaoDoDocumento, condicaoGravada, type CondicaoDoDocumento } from "../lib/documento-comercial.js";
import { layoutEfetivo, respostaDoLayoutEfetivo } from "../lib/layout-documento.js";
import { regrasDaVersaoTop, regrasDaTopAtual } from "./vendas-regras-operacao.js";
import { MSG_NUMERO_INVALIDO, MSG_EDICAO_TOTAL_FORA_DO_LIMITE, msgNumeroForaDoLimite } from "./vendas-edicao-patch.js";
import { lerDocumentoCompra, listarDocumentos } from "./compras.js";
import { politicaDeDestinosDaCompra } from "./compras-recebimento.js";

const t = criarTradutor(ptBR);

// ─────────────── a espécie ───────────────

/** A espécie desta porta — o valor que o banco persiste em `especie`. */
const ESPECIE = "orcamento" as const;

/** A família do orçamento de compra, perguntada ao registry pela espécie. Fail-closed se o registry deixar de declará-la. */
function familiaDoOrcamento(): string {
  const familia = familiaOperacionalDeDocumentoCompra(ESPECIE);
  if (!familia) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento", { especie: ESPECIE });
  return familia;
}

// ─────────────── mensagens próprias (o resto é do domínio) ───────────────

/** O texto de hoje do lançamento de compra (`compras.ts`), para a mesma recusa dizer a mesma coisa. */
const MSG_FORNECEDOR_INVALIDO = "Fornecedor inválido: escolha uma pessoa cadastrada como fornecedor";
const MSG_CASAS_DO_VALOR_UNITARIO = "O valor unitário aceita no máximo 6 casas decimais";
const MSG_VALOR_NEGATIVO = "Informe um valor maior ou igual a zero";

// ─────────────── contrato de entrada (estrito) ───────────────

/** uuid do corpo em MINÚSCULAS no parse — antes do hash da idempotência e das comparações como texto. */
const uuid = z.string().uuid().transform((v) => v.toLowerCase());
const data = z.string().refine(isISODate, "Data inválida");
const PRAZO_MAXIMO_DIAS = 3650;
const prazoEntrega = z.number().int().min(0).max(PRAZO_MAXIMO_DIAS);
/**
 * O preço unitário é TEXTO decimal (dinheiro nunca viaja como ponto flutuante): a forma canônica — sinal "-"
 * opcional, dígitos sem zero à esquerda, ponto e casas — e não negativo. As casas (até 6) e os dígitos inteiros (até
 * 12, a coluna `numeric(18,6)`) são conferidos depois, no lugar que a ordem da rota manda.
 */
const FORMA_NUMERO = /^-?(0|[1-9]\d*)(?:\.(\d+))?$/;
const valorUnitario = z.string().superRefine((v, c) => {
  if (!FORMA_NUMERO.test(v)) c.addIssue({ code: "custom", message: MSG_NUMERO_INVALIDO });
  else if (D(v).lt(0)) c.addIssue({ code: "custom", message: MSG_VALOR_NEGATIVO });
});
const observacao = z.string().trim().max(2000);

/** CRIAR (§1.3.4): `itens` ausente, ou item do pedido fora da lista, = preço "0". `.strict()` nos dois níveis. */
const criarSchema = z.object({
  tipo_operacao_id: uuid,
  fornecedor_id: uuid,
  data_documento: data,
  condicao_pagamento_id: uuid.nullish().transform((v) => v ?? null),
  prazo_entrega_dias: prazoEntrega.nullish().transform((v) => v ?? null),
  validade_orcamento: data.nullish().transform((v) => v ?? null),
  observacao: observacao.nullish().transform((v) => (v ? v : null)),
  itens: z.array(z.object({ item_pedido_id: uuid, valor_unitario: valorUnitario }).strict()).optional(),
}).strict();
type CorpoCriar = z.infer<typeof criarSchema>;

/** EDITAR (§1.3.5): o PUT SUBSTITUI os editáveis — toda chave obrigatória, anulável onde diz. */
const editarSchema = z.object({
  condicao_pagamento_id: uuid.nullable(),
  prazo_entrega_dias: prazoEntrega.nullable(),
  validade_orcamento: data.nullable(),
  observacao: observacao.nullable().transform((v) => (v ? v : null)),
  itens: z.array(z.object({ id: uuid, valor_unitario: valorUnitario }).strict()).min(1),
}).strict();
type CorpoEditar = z.infer<typeof editarSchema>;

/** Aprovar para orçamento e escolher o vencedor: corpo vazio. */
const corpoVazio = z.object({}).strict();
/** Cancelar: o motivo opcional de hoje; presente, tem conteúdo. */
const cancelarSchema = z.object({ motivo: z.string().trim().min(1).max(500).nullish() }).strict();

const recusa = (path: string, message: string) => err("VALIDATION_ERROR", message, [{ path, message }]);

/** O id da rota: fora da forma é inexistente (a MESMA 404, sem 22P02 → 500); dentro, em minúsculas ANTES do hash. */
function idDaRota(bruto: string): string {
  if (!FORMA_UUID_PADRAO.test(bruto)) throw notFound("Documento");
  return bruto.toLowerCase();
}
const chaveDe = (req: FastifyRequest) => req.headers["idempotency-key"] as string | undefined;

/** O pg entrega timestamptz como Date; a API responde ISO (o mesmo texto do replay gravado em JSON). */
const emIso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

// ─────────────── dinheiro ───────────────

/** numeric(18,2): até 16 dígitos inteiros. */
const LIMITE_DINHEIRO = D("1e16");
const cabeNoDinheiro = (v: string) => D(v).abs().lt(LIMITE_DINHEIRO);

/** O preço que a FORMA aceitou: casas (até 6) e dígitos inteiros (até 12, `numeric(18,6)`), 422 no item. */
function conferirPreco(path: string, v: string): void {
  if (D(v).decimalPlaces() > 6) throw recusa(path, MSG_CASAS_DO_VALOR_UNITARIO);
  if ((FORMA_NUMERO.exec(v)?.[1]?.length ?? 0) > 12) throw recusa(path, msgNumeroForaDoLimite(12, 6));
}

/** Uma linha do orçamento (ou do pedido, no vencedor) com o preço novo, sem desconto: total = quantidade × preço. */
interface LinhaComPreco { quantidade: string; valorUnitario: string; valorTotal: string }
function comPreco(quantidade: string, valorUnitario: string, caminhoDoPreco: string): LinhaComPreco {
  const valorTotal = itemTotal({ quantity: quantidade, unitPrice: valorUnitario, discount: "0", discountPercent: "0" });
  if (!cabeNoDinheiro(valorTotal)) throw recusa(caminhoDoPreco, MSG_EDICAO_TOTAL_FORA_DO_LIMITE);
  return { quantidade, valorUnitario, valorTotal };
}

/** Os totais do documento, conferidos contra a coluna (o CHECK do total no banco confere a soma exata). */
function totaisQueCabem(linhas: readonly LinhaComPreco[], cabecalho: { frete: string; outras: string; desconto: string }) {
  const totais = documentTotals(linhas.map((l) => ({ quantity: l.quantidade, unitPrice: l.valorUnitario, discount: "0", discountPercent: "0" })),
    { freight: cabecalho.frete, otherValues: cabecalho.outras, discount: cabecalho.desconto });
  if (!cabeNoDinheiro(totais.subtotal) || !cabeNoDinheiro(totais.total)) throw recusa("itens", MSG_EDICAO_TOTAL_FORA_DO_LIMITE);
  return totais;
}

// ─────────────── os documentos como `lerDocumentoCompra` os devolve ───────────────

/*
 * A leitura volta como `Record<string, unknown>`; aqui ela vira o tipo campo a campo, com conversão em tempo de execução
 * (e não um `as unknown as`, que só promete ao compilador): texto vira texto, número vira número, data com hora vira
 * Date ou texto, e uma lista que não é lista é erro de programação (500) — nunca "zero itens" em silêncio. Números do
 * banco (numeric) e datas (date) chegam como texto (`packages/db/src/pool.ts`).
 */
const texto = (v: unknown): string => String(v);
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numeroOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const instanteOuNulo = (v: unknown): Date | string | null => (v instanceof Date || typeof v === "string" ? v : null);
const campos = (v: unknown): Readonly<Record<string, unknown>> => (typeof v === "object" && v !== null ? v as Record<string, unknown> : {});
function lista<T>(v: unknown, nome: string, linha: (c: Readonly<Record<string, unknown>>) => T): T[] {
  if (!Array.isArray(v)) throw new Error(`A leitura do documento de compra veio sem a lista ${nome}`);
  return v.map((x: unknown) => linha(campos(x)));
}

interface ItemDoPedidoLido { id: string; produto_id: string; armazem_id: string | null; quantidade: string; posicao: number }
interface PedidoLido {
  id: string; situacao: string; empresa_id: string; fornecedor_id: string; tipo_operacao_versao_id: string; data_documento: string;
  condicao_pagamento_id: string | null; frete: string; outras_despesas: string; desconto: string; valor_itens: string; valor_total: string;
  aprovado_orcamento_em: Date | string | null;
  itens: ItemDoPedidoLido[]; compras_geradas: { id: string; situacao: string }[];
}
const comoPedido = (d: Record<string, unknown>): PedidoLido => ({
  id: texto(d.id), situacao: texto(d.situacao), empresa_id: texto(d.empresa_id), fornecedor_id: texto(d.fornecedor_id),
  tipo_operacao_versao_id: texto(d.tipo_operacao_versao_id), data_documento: texto(d.data_documento),
  condicao_pagamento_id: textoOuNulo(d.condicao_pagamento_id), frete: texto(d.frete), outras_despesas: texto(d.outras_despesas),
  desconto: texto(d.desconto), valor_itens: texto(d.valor_itens), valor_total: texto(d.valor_total),
  aprovado_orcamento_em: instanteOuNulo(d.aprovado_orcamento_em),
  itens: lista(d.itens, "itens", (i) => ({ id: texto(i.id), produto_id: texto(i.produto_id), armazem_id: textoOuNulo(i.armazem_id),
    quantidade: texto(i.quantidade), posicao: Number(i.posicao) })),
  compras_geradas: lista(d.compras_geradas, "compras_geradas", (g) => ({ id: texto(g.id), situacao: texto(g.situacao) })),
});

interface ItemDoOrcamentoLido { id: string; produto_id: string; quantidade: string; valor_unitario: string; posicao: number }
interface OrcamentoLido {
  id: string; situacao: string; pedido_orcado_id: string; empresa_id: string; fornecedor_id: string; tipo_operacao_id: string;
  tipo_operacao_versao_id: string; data_documento: string; condicao_pagamento_id: string | null; prazo_entrega_dias: number | null;
  validade_orcamento: string | null; observacao: string | null; valor_itens: string; valor_total: string; itens: ItemDoOrcamentoLido[];
}
const comoOrcamento = (d: Record<string, unknown>): OrcamentoLido => ({
  id: texto(d.id), situacao: texto(d.situacao), pedido_orcado_id: texto(d.pedido_orcado_id), empresa_id: texto(d.empresa_id),
  fornecedor_id: texto(d.fornecedor_id), tipo_operacao_id: texto(d.tipo_operacao_id), tipo_operacao_versao_id: texto(d.tipo_operacao_versao_id),
  data_documento: texto(d.data_documento), condicao_pagamento_id: textoOuNulo(d.condicao_pagamento_id),
  prazo_entrega_dias: numeroOuNulo(d.prazo_entrega_dias), validade_orcamento: textoOuNulo(d.validade_orcamento),
  observacao: textoOuNulo(d.observacao), valor_itens: texto(d.valor_itens), valor_total: texto(d.valor_total),
  itens: lista(d.itens, "itens", (i) => ({ id: texto(i.id), produto_id: texto(i.produto_id), quantidade: texto(i.quantidade),
    valor_unitario: texto(i.valor_unitario), posicao: Number(i.posicao) })),
});

/**
 * Os orçamentos do pedido (inclusive cancelados), lidos pelo serviço — e não pela leitura do pedido, que só os traz a
 * quem tem `orcamentos_compra.view` (criar exige `orcamentos_compra.create`, que não implica ver). Sem trava própria:
 * quem chama já travou o PEDIDO, e todo orçamento novo ou escolhido passa por essa trava antes.
 */
async function orcamentosDoPedido(ctx: ServiceCtx, pedidoId: string): Promise<{ situacao: string; fornecedor_id: string }[]> {
  return (await ctx.tx.query<{ situacao: string; fornecedor_id: string }>(
    `select situacao, fornecedor_id from erp.documentos_compra
      where organization_id = $1 and pedido_orcado_id = $2 and especie = 'orcamento'`, [ctx.orgId, pedidoId])).rows;
}

// ─────────────── as regras da TOP e o layout (criar e editar) ───────────────

/** O orçamento COMO SERÁ GRAVADO: as chaves do catálogo do orçamento, que as regras da TOP e o layout cobram. */
type OrcamentoComoSeraGravado = {
  empresa_id: string; fornecedor_id: string; data_documento: string; condicao_pagamento_id: string | null;
  prazo_entrega_dias: number | null; validade_orcamento: string | null; observacao: string | null;
  itens: { produto_id: string; quantidade: string; valor_unitario: string }[];
};

/**
 * AS RECUSAS DO DOCUMENTO, na ordem do plano (§1.3.4, passos 8 a 10), iguais para criar e editar:
 *  8. a validade não é anterior à data do documento;
 *  9. a condição existe e está ativa (`validarCondicaoDoDocumento`); com a versão da TOP do orçamento no formato 3 ou
 *     maior (`regrasDaVersaoTop`), as exigências da Geral com o mapa do ORÇAMENTO (fornecedor e observação) e a
 *     condição entre as permitidas — no molde de `cobrarRegrasDaCompra` (exigências antes da condição permitida);
 * 10. o layout da TOP: layout do sistema = nada a cobrar; senão, os obrigatórios vazios (`LAYOUT_CAMPO_OBRIGATORIO`).
 * Devolve a condição lida (ou nula).
 */
async function cobrarRegrasDoOrcamento(ctx: ServiceCtx, top: { tipoOperacaoId: string; tipoOperacaoVersaoId: string }, doc: OrcamentoComoSeraGravado): Promise<CondicaoDoDocumento | null> {
  if (doc.validade_orcamento !== null && doc.validade_orcamento < doc.data_documento) throw recusa("validade_orcamento", MSG_ORCAMENTO_VALIDADE_ANTES_DA_DATA);
  const condicao = doc.condicao_pagamento_id ? await validarCondicaoDoDocumento(ctx, doc.condicao_pagamento_id) : null;
  const regras = await regrasDaVersaoTop(ctx, top.tipoOperacaoVersaoId);
  if (regras) {
    const faltando = exigenciasGeraisFaltando(regras.config, doc, EXIGENCIAS_GERAIS_ORCAMENTO_COMPRA_TOP);
    if (faltando.length) {
      throw new DomainError(ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA,
        { exigencias: faltando.map((x) => ({ caminho: x.caminho, mensagem: `${x.rotulo} é obrigatório nesta operação.` })) });
    }
    if (doc.condicao_pagamento_id && regras.condicoesPermitidas && !regras.condicoesPermitidas.includes(doc.condicao_pagamento_id)) {
      throw new DomainError(ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, MENSAGEM_CONDICAO_NAO_PERMITIDA, { campo: "condicao_pagamento_id" });
    }
  }
  const familia = familiaDoOrcamento();
  const layout = await layoutEfetivo(ctx, familia, top.tipoOperacaoId);
  if (layout.origem !== "sistema") {
    const faltando = camposObrigatoriosFaltando(familia, layout.estrutura, doc, { classificacao: true, condicao: true });
    if (faltando.length) {
      const details = faltando.map((f) => ({ path: f.caminho, message: mensagemCampoObrigatorio(f.rotulo) }));
      throw err(ERRO_LAYOUT_CAMPO_OBRIGATORIO, details[0]!.message, details);
    }
  }
  return condicao;
}

// ─────────────── aprovar o pedido para orçamento (§1.3.7) ───────────────

/** Grava quem e quando, UMA vez, com o pedido aberto — o gatilho de conferência da 0044 é a rede. */
async function aprovarParaOrcamento(ctx: ServiceCtx, pedidoId: string) {
  const pedido = comoPedido(await lerDocumentoCompra(ctx, pedidoId, "pedido", { lock: true }));
  if (pedido.situacao !== "aberto") throw err("CONFLICT", MSG_APROVAR_ORCAMENTO_SO_PEDIDO_ABERTO);
  if (pedido.aprovado_orcamento_em != null) throw err("CONFLICT", MSG_PEDIDO_JA_APROVADO_PARA_ORCAMENTO);
  const u = await ctx.tx.query<{ aprovado_orcamento_em: Date | string; aprovado_orcamento_por: string }>(
    `update erp.documentos_compra set aprovado_orcamento_em = now(), aprovado_orcamento_por = $3
      where id = $1 and organization_id = $2 and especie = 'pedido' and situacao = 'aberto' and aprovado_orcamento_em is null
      returning aprovado_orcamento_em, aprovado_orcamento_por`, [pedidoId, ctx.orgId, ctx.user.id]);
  const linha = u.rows[0];
  // ROW COUNT SOB RLS: zero linha sem conferência seria "aprovado" sem efeito.
  if (u.rowCount !== 1 || !linha) throw notFound("Documento");
  const depois = { aprovado_orcamento_em: emIso(linha.aprovado_orcamento_em), aprovado_orcamento_por: linha.aprovado_orcamento_por };
  await audit(ctx.tx, ctx, "documentos_compra", pedidoId, "aprovar_para_orcamento", undefined,
    { before: { aprovado_orcamento_em: null, aprovado_orcamento_por: null }, after: depois });
  return { id: pedidoId, ...depois };
}

// ─────────────── criar o orçamento (§1.3.4) ───────────────

const COLUNAS_DO_ORCAMENTO = `organization_id, empresa_id, especie, codigo, situacao, tipo_operacao_id, tipo_operacao_versao_id, fornecedor_id,
  data_documento, condicao_pagamento_id, prazo_entrega_dias, validade_orcamento, observacao, valor_itens, valor_total, criado_por, pedido_orcado_id`;

/** O índice único é a rede do "um orçamento vivo por fornecedor": 23505 nele é o MESMO 409 da conferência. */
function recusaDoFornecedorRepetido(e: unknown): never {
  const pe = e as { code?: string; constraint?: string };
  if (pe.code === "23505" && pe.constraint === "ux_documentos_compra_orcamento_fornecedor") throw err("CONFLICT", MSG_ORCAMENTO_FORNECEDOR_REPETIDO);
  throw e;
}

/**
 * CRIAR — dentro da transação da rota, sob a chave de idempotência. Nada é gravado antes de TODAS as recusas.
 * Passos (§1.3.4): 1 trava e situação do pedido → 2 vencedor já escolhido → 3 a TOP do leque do pedido → 4 empresa →
 * 5 fornecedor → 6 fornecedor repetido → 7 itens do corpo → 8–10 validade, regras da TOP e layout → 11 linhas →
 * 12 código → 13 cabeçalho, ID Global e itens → 14 auditoria.
 */
async function criarOrcamento(ctx: ServiceCtx, pedidoId: string, corpo: CorpoCriar) {
  // 1. A 1ª TRAVA: o pedido (os itens e os orçamentos dele são lidos DEPOIS dela).
  const pedido = comoPedido(await lerDocumentoCompra(ctx, pedidoId, "pedido", { lock: true }));
  if (pedido.situacao !== "aberto") throw err("CONFLICT", MSG_ORCAMENTO_SO_PEDIDO_ABERTO);
  if (pedido.aprovado_orcamento_em == null) throw err("CONFLICT", MSG_PEDIDO_NAO_APROVADO_PARA_ORCAMENTO);
  // 2. Escolhido o vencedor, a cotação está encerrada.
  const orcamentos = await orcamentosDoPedido(ctx, pedido.id);
  if (orcamentos.some((o) => o.situacao === "escolhido")) throw err("CONFLICT", MSG_PEDIDO_JA_TEM_VENCEDOR);
  // 3. O GRAFO RESTRINGE: a TOP do orçamento é um destino do leque da versão CONGELADA do pedido (sem a aresta
  //    configurada, o pedido não recebe orçamento — fail-closed). Depois, a versão ATUAL dela, travada `for share`.
  const politica = await politicaDeDestinosDaCompra(ctx, pedido.tipo_operacao_versao_id, ESPECIE);
  if (!politica.configurada || !politica.itens.some((x) => x.tipoOperacaoId === corpo.tipo_operacao_id)) {
    throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", MSG_PEDIDO_SEM_TOP_DE_ORCAMENTO);
  }
  const top = await resolverTopParaLancamento(ctx, familiaDoOrcamento(), corpo.tipo_operacao_id);
  // 4. A empresa do orçamento é a do pedido — a mesma conferência do lançamento (escopo de escrita do módulo).
  await exigirEmpresaDeLancamento(ctx, pedido.empresa_id);
  // 5. Fornecedor da organização, vivo.
  const f = await ctx.tx.query("select 1 from erp.people where id = $1 and organization_id = $2 and deleted_at is null and is_provider for share", [corpo.fornecedor_id, ctx.orgId]);
  if (!f.rowCount) throw recusa("fornecedor_id", MSG_FORNECEDOR_INVALIDO);
  // 6. Um orçamento VIVO por fornecedor em cada pedido (cancelar libera).
  if (orcamentos.some((o) => o.situacao !== "cancelado" && o.fornecedor_id === corpo.fornecedor_id)) throw err("CONFLICT", MSG_ORCAMENTO_FORNECEDOR_REPETIDO);
  // 7. Os preços do corpo: cada item do pedido uma vez; casas e limite do preço.
  const doPedido = new Set(pedido.itens.map((i) => i.id));
  const precoDoCorpo = new Map<string, { valor: string; posicaoNoCorpo: number }>();
  (corpo.itens ?? []).forEach((it, k) => {
    if (!doPedido.has(it.item_pedido_id) || precoDoCorpo.has(it.item_pedido_id)) throw recusa(`itens[${k}].item_pedido_id`, MSG_ORCAMENTO_ITEM_DE_OUTRO_PEDIDO);
    conferirPreco(`itens[${k}].valor_unitario`, it.valor_unitario);
    precoDoCorpo.set(it.item_pedido_id, { valor: it.valor_unitario, posicaoNoCorpo: k });
  });
  // As linhas: TODOS os itens do pedido, na ordem dele (posição), com o preço do corpo ou "0", sem desconto.
  const linhas = pedido.itens.map((i) => {
    const preco = precoDoCorpo.get(i.id);
    return { item: i, ...comPreco(String(i.quantidade), preco?.valor ?? "0", preco ? `itens[${preco.posicaoNoCorpo}].valor_unitario` : "itens") };
  });
  const totais = totaisQueCabem(linhas, { frete: "0", outras: "0", desconto: "0" });
  // 8 a 10. Validade, regras da TOP (a versão que este orçamento congela) e layout, sobre o documento como será gravado.
  await cobrarRegrasDoOrcamento(ctx, top, {
    empresa_id: pedido.empresa_id, fornecedor_id: corpo.fornecedor_id, data_documento: corpo.data_documento,
    condicao_pagamento_id: corpo.condicao_pagamento_id, prazo_entrega_dias: corpo.prazo_entrega_dias,
    validade_orcamento: corpo.validade_orcamento, observacao: corpo.observacao,
    itens: linhas.map((l) => ({ produto_id: l.item.produto_id, quantidade: l.quantidade, valor_unitario: l.valorUnitario })),
  });

  // 12. O código: o contador da espécie (a UNIQUE da tabela tem `especie`; `sequencia-namespace-audit`).
  const especie = ESPECIE;
  const codigo = await nextCode(ctx.tx, ctx.orgId, `compras_${especie}`);
  // 13. O cabeçalho (o gatilho confere o pedido FOR SHARE: aberto, aprovado para orçamento, mesma empresa) e o ID Global.
  const id = (await ctx.tx.query<{ id: string }>(
    `insert into erp.documentos_compra (${COLUNAS_DO_ORCAMENTO}) values ($1,$2,'orcamento',$3,'aberto',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [ctx.orgId, pedido.empresa_id, codigo, top.tipoOperacaoId, top.tipoOperacaoVersaoId, corpo.fornecedor_id, corpo.data_documento,
      corpo.condicao_pagamento_id, corpo.prazo_entrega_dias, corpo.validade_orcamento, corpo.observacao, totais.subtotal, totais.total,
      ctx.user.id, pedido.id]).catch(recusaDoFornecedorRepetido)).rows[0]!.id;
  await atribuirIdGlobal(ctx, "documentos_compra", id);
  // Os itens num INSERT só; o gatilho do orçamento (0044) liga cada linha ao item do pedido (mesmo produto e quantidade).
  const ins = await ctx.tx.query(
    `insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, armazem_id, quantidade, valor_unitario, valor_total, posicao, item_pedido_orcado_id)
     select $1, $2, x.produto_id, x.armazem_id, x.quantidade, x.valor_unitario, x.valor_total, x.posicao, x.item_pedido_orcado_id
       from unnest($3::uuid[], $4::uuid[], $5::numeric[], $6::numeric[], $7::numeric[], $8::int[], $9::uuid[])
         as x(produto_id, armazem_id, quantidade, valor_unitario, valor_total, posicao, item_pedido_orcado_id)`,
    [ctx.orgId, id, linhas.map((l) => l.item.produto_id), linhas.map((l) => l.item.armazem_id ?? null), linhas.map((l) => l.quantidade),
      linhas.map((l) => l.valorUnitario), linhas.map((l) => l.valorTotal), linhas.map((l) => l.item.posicao), linhas.map((l) => l.item.id)]);
  if (ins.rowCount !== linhas.length) throw notFound("Documento");
  // 14. A trilha do serviço.
  await audit(ctx.tx, ctx, "documentos_compra", id, "create",
    { especie, codigo, pedido: pedido.id, tipoOperacaoId: top.tipoOperacaoId, tipoOperacaoVersaoId: top.tipoOperacaoVersaoId, fornecedorId: corpo.fornecedor_id });
  return { id, codigo, especie, situacao: "aberto", pedido_orcado_id: pedido.id, fornecedor_id: corpo.fornecedor_id, valor_itens: totais.subtotal, valor_total: totais.total };
}

// ─────────────── editar o orçamento (§1.3.5) ───────────────

/** Os campos do cabeçalho que o PUT substitui (e a auditoria compara). */
const EDITAVEIS = ["condicao_pagamento_id", "prazo_entrega_dias", "validade_orcamento", "observacao"] as const;

/**
 * EDITAR — trava o PEDIDO e DEPOIS o orçamento (a ordem do vencedor). Os itens do corpo são EXATAMENTE as linhas do
 * orçamento, uma vez cada; validade, regras da TOP (a versão CONGELADA do orçamento) e layout como na criação; os
 * totais são recalculados; dois UPDATEs com ROW COUNT; a auditoria "update" com o que mudou.
 */
async function editarOrcamento(ctx: ServiceCtx, orcamentoId: string, pedidoId: string, corpo: CorpoEditar) {
  const pedido = comoPedido(await lerDocumentoCompra(ctx, pedidoId, "pedido", { lock: true }));
  const orc = comoOrcamento(await lerDocumentoCompra(ctx, orcamentoId, ESPECIE, { lock: true }));
  if (pedido.situacao !== "aberto") throw err("CONFLICT", MSG_ORCAMENTO_PEDIDO_NAO_ABERTO);
  if (orc.situacao !== "aberto") throw err("CONFLICT", MSG_ORCAMENTO_NAO_ABERTO);
  const linhaPorId = new Map(orc.itens.map((i) => [i.id, i]));
  const vistos = new Set<string>();
  for (const it of corpo.itens) {
    if (!linhaPorId.has(it.id) || vistos.has(it.id)) throw recusa("itens", MSG_ORCAMENTO_PRECO_DOS_ITENS);
    vistos.add(it.id);
  }
  if (vistos.size !== linhaPorId.size) throw recusa("itens", MSG_ORCAMENTO_PRECO_DOS_ITENS);
  corpo.itens.forEach((it, k) => conferirPreco(`itens[${k}].valor_unitario`, it.valor_unitario));
  const linhas = corpo.itens.map((it, k) => ({ linha: linhaPorId.get(it.id)!, ...comPreco(String(linhaPorId.get(it.id)!.quantidade), it.valor_unitario, `itens[${k}].valor_unitario`) }));
  const totais = totaisQueCabem(linhas, { frete: "0", outras: "0", desconto: "0" });
  await cobrarRegrasDoOrcamento(ctx, { tipoOperacaoId: orc.tipo_operacao_id, tipoOperacaoVersaoId: orc.tipo_operacao_versao_id }, {
    empresa_id: orc.empresa_id, fornecedor_id: orc.fornecedor_id, data_documento: orc.data_documento,
    condicao_pagamento_id: corpo.condicao_pagamento_id, prazo_entrega_dias: corpo.prazo_entrega_dias,
    validade_orcamento: corpo.validade_orcamento, observacao: corpo.observacao,
    itens: linhas.map((l) => ({ produto_id: l.linha.produto_id, quantidade: l.quantidade, valor_unitario: l.valorUnitario })),
  });

  // Os itens num comando; só o preço e o total da linha mudam (produto e quantidade são os do pedido).
  const ui = await ctx.tx.query(
    `update erp.documentos_compra_itens i set valor_unitario = x.valor_unitario, valor_total = x.valor_total
       from unnest($3::uuid[], $4::numeric[], $5::numeric[]) as x(id, valor_unitario, valor_total)
      where i.id = x.id and i.documento_id = $1 and i.organization_id = $2`,
    [orcamentoId, ctx.orgId, linhas.map((l) => l.linha.id), linhas.map((l) => l.valorUnitario), linhas.map((l) => l.valorTotal)]);
  // ROW COUNT SOB RLS: cada linha do orçamento, uma vez.
  if (ui.rowCount !== linhas.length) throw notFound("Documento");
  const uc = await ctx.tx.query(
    `update erp.documentos_compra set condicao_pagamento_id = $3, prazo_entrega_dias = $4, validade_orcamento = $5, observacao = $6, valor_itens = $7, valor_total = $8
      where id = $1 and organization_id = $2 and especie = 'orcamento' and situacao = 'aberto'`,
    [orcamentoId, ctx.orgId, corpo.condicao_pagamento_id, corpo.prazo_entrega_dias, corpo.validade_orcamento, corpo.observacao, totais.subtotal, totais.total]);
  if (uc.rowCount !== 1) throw notFound("Documento");

  // A trilha: só o que mudou — os campos do cabeçalho, os totais e o preço de cada linha.
  const antes: Record<string, unknown> = {}; const depois: Record<string, unknown> = {};
  for (const campo of EDITAVEIS) {
    if ((orc[campo] ?? null) !== corpo[campo]) { antes[campo] = orc[campo] ?? null; depois[campo] = corpo[campo]; }
  }
  if (!D(orc.valor_total).eq(totais.total)) {
    antes.valor_itens = orc.valor_itens; depois.valor_itens = totais.subtotal;
    antes.valor_total = orc.valor_total; depois.valor_total = totais.total;
  }
  const precos = linhas.filter((l) => !D(l.linha.valor_unitario).eq(l.valorUnitario));
  if (precos.length) {
    antes.itens = precos.map((l) => ({ id: l.linha.id, valor_unitario: l.linha.valor_unitario }));
    depois.itens = precos.map((l) => ({ id: l.linha.id, valor_unitario: l.valorUnitario }));
  }
  await audit(ctx.tx, ctx, "documentos_compra", orcamentoId, "update", { campos: Object.keys(depois) }, { before: antes, after: depois });
  return lerDocumentoCompra(ctx, orcamentoId, ESPECIE);
}

// ─────────────── cancelar o orçamento (§1.3.8) ───────────────

async function cancelarOrcamento(ctx: ServiceCtx, orcamentoId: string, motivo: string | null) {
  const orc = comoOrcamento(await lerDocumentoCompra(ctx, orcamentoId, ESPECIE, { lock: true }));
  if (orc.situacao === "cancelado") throw err("ALREADY_CANCELLED", "Documento já cancelado");
  if (orc.situacao !== "aberto") throw err("CONFLICT", MSG_ORCAMENTO_NAO_ABERTO);
  const u = await ctx.tx.query(
    "update erp.documentos_compra set situacao = 'cancelado' where id = $1 and organization_id = $2 and especie = 'orcamento' and situacao = 'aberto'",
    [orcamentoId, ctx.orgId]);
  // ROW COUNT SOB RLS: zero linha sem conferência seria "cancelado" sem efeito.
  if (u.rowCount !== 1) throw notFound("Documento");
  await audit(ctx.tx, ctx, "documentos_compra", orcamentoId, "cancel", motivo ? { motivo } : undefined, { before: { situacao: "aberto" }, after: { situacao: "cancelado" } });
  return { id: orcamentoId, situacao: "cancelado" };
}

// ─────────────── escolher o vencedor (§1.3.6) ───────────────

/** Um vencedor por pedido: o índice único é a rede, e 23505 nele é o MESMO 409 da conferência. */
function recusaDoSegundoVencedor(e: unknown): never {
  const pe = e as { code?: string; constraint?: string };
  if (pe.code === "23505" && pe.constraint === "ux_documentos_compra_orcamento_escolhido") throw err("CONFLICT", MSG_PEDIDO_JA_TEM_VENCEDOR);
  throw e;
}

/**
 * ESCOLHER O VENCEDOR — numa transação (a da rota), sob a chave de idempotência. Leva ao PEDIDO ABERTO o fornecedor,
 * os preços (o desconto do item zerado) e a condição do orçamento (sem condição no orçamento, a do pedido fica);
 * recalcula os totais com o frete, as outras despesas e o desconto DO PEDIDO (que ficam); o plano sai da condição que
 * fica no pedido, com o total novo (ou nulo, sem condição). O vencedor vira `escolhido`; os outros
 * abertos, `nao_escolhido`; os cancelados ficam. O prazo não vai ao pedido (o pedido não tem a coluna).
 * Travas: pedido → orçamentos (por id) → itens do pedido. O valor do pedido muda: uma aprovação anterior deixa de
 * cobrir, e o finalizar a cobra de novo (`compras-finalizacao.ts`).
 */
async function escolherVencedor(ctx: ServiceCtx, pedidoId: string, orcamentoId: string) {
  // 1. A 1ª TRAVA: o pedido.
  const pedido = comoPedido(await lerDocumentoCompra(ctx, pedidoId, "pedido", { lock: true }));
  if (pedido.situacao !== "aberto") throw err("CONFLICT", MSG_VENCEDOR_SO_PEDIDO_ABERTO);
  // 2. Qualquer compra gerada (inclusive cancelada) prende o fornecedor do pedido (gatilho da 0037): recusar antes.
  if (pedido.compras_geradas.length > 0) throw err("CONFLICT", MSG_VENCEDOR_PEDIDO_COM_COMPRA);
  // 3. Os orçamentos do pedido, travados em ordem de id.
  const orcamentos = (await ctx.tx.query<{ id: string; situacao: string; fornecedor_id: string; condicao_pagamento_id: string | null }>(
    `select id, situacao, fornecedor_id, condicao_pagamento_id from erp.documentos_compra
      where organization_id = $1 and pedido_orcado_id = $2 and especie = 'orcamento'
      order by id for update`, [ctx.orgId, pedidoId])).rows;
  const vencedor = orcamentos.find((o) => o.id === orcamentoId);
  if (!vencedor) throw notFound("Documento");
  if (vencedor.situacao !== "aberto") throw err("CONFLICT", MSG_ORCAMENTO_NAO_ABERTO);
  if (orcamentos.some((o) => o.situacao === "escolhido")) throw err("CONFLICT", MSG_PEDIDO_JA_TEM_VENCEDOR);
  const naoEscolhidos = orcamentos.filter((o) => o.id !== vencedor.id && o.situacao === "aberto").map((o) => o.id);
  // 4. As linhas do vencedor contra os itens do pedido, numa consulta: cada item do pedido com UMA linha, e nada além.
  const cobertura = (await ctx.tx.query<{ item_pedido_id: string | null; quantidade: string | null; coberto: string | null; valor_unitario: string | null }>(
    `select p.id as item_pedido_id, p.quantidade::text as quantidade, o.item_pedido_orcado_id as coberto, o.valor_unitario::text as valor_unitario
       from (select id, quantidade, posicao from erp.documentos_compra_itens where organization_id = $1 and documento_id = $2) p
       full join (select item_pedido_orcado_id, valor_unitario from erp.documentos_compra_itens where organization_id = $1 and documento_id = $3) o
         on o.item_pedido_orcado_id = p.id
      order by p.posicao, p.id`, [ctx.orgId, pedidoId, vencedor.id])).rows;
  if (cobertura.length !== pedido.itens.length || cobertura.some((l) => l.item_pedido_id === null || l.coberto === null)) {
    throw err("CONFLICT", MSG_ORCAMENTO_NAO_COBRE_O_PEDIDO);
  }
  // 5. A condição do vencedor (se houver): ativa, e permitida pela versão congelada da TOP DO PEDIDO. O vencedor SEM
  //    condição não apaga a do pedido: ela fica, lida como gravada (`condicaoGravada`, sem revalidar), só para refazer
  //    o plano com o total novo — o pedido continua cumprindo o layout e as regras com que foi gravado.
  const condicaoDoVencedor = vencedor.condicao_pagamento_id ? await validarCondicaoDoDocumento(ctx, vencedor.condicao_pagamento_id) : null;
  if (condicaoDoVencedor) {
    const regras = await regrasDaVersaoTop(ctx, pedido.tipo_operacao_versao_id);
    if (regras?.condicoesPermitidas && !regras.condicoesPermitidas.includes(condicaoDoVencedor.id)) {
      throw new DomainError(ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, MENSAGEM_CONDICAO_NAO_PERMITIDA, { campo: "condicao_pagamento_id" });
    }
  }
  const condicaoId = condicaoDoVencedor?.id ?? pedido.condicao_pagamento_id;
  const condicao = condicaoDoVencedor ?? (pedido.condicao_pagamento_id ? await condicaoGravada(ctx, pedido.condicao_pagamento_id) : null);
  // 6. Os itens novos do pedido e os totais com o frete, as outras despesas e o desconto DO PEDIDO.
  const linhas = cobertura.map((l) => ({ itemPedidoId: l.item_pedido_id!, ...comPreco(l.quantidade!, l.valor_unitario!, "itens") }));
  const totais = totaisQueCabem(linhas, { frete: pedido.frete, outras: pedido.outras_despesas, desconto: pedido.desconto });
  const plano = condicao ? planoDaCondicao(condicao, { dataDocumento: pedido.data_documento, total: totais.total }) : null;

  // 7. As gravações, cada uma com ROW COUNT. Itens do pedido (só preço, descontos e total: produto e quantidade
  //    ficam, e o gatilho do item orçado não dispara).
  const ui = await ctx.tx.query(
    `update erp.documentos_compra_itens i set valor_unitario = x.valor_unitario, desconto = 0, desconto_percentual = 0, valor_total = x.valor_total
       from unnest($3::uuid[], $4::numeric[], $5::numeric[]) as x(id, valor_unitario, valor_total)
      where i.id = x.id and i.documento_id = $1 and i.organization_id = $2`,
    [pedidoId, ctx.orgId, linhas.map((l) => l.itemPedidoId), linhas.map((l) => l.valorUnitario), linhas.map((l) => l.valorTotal)]);
  if (ui.rowCount !== linhas.length) throw notFound("Documento");
  const up = await ctx.tx.query(
    `update erp.documentos_compra set fornecedor_id = $3, condicao_pagamento_id = $4, plano_parcelas = $5::jsonb, parcelas_ajustadas = false,
            valor_itens = $6, valor_total = $7
      where id = $1 and organization_id = $2 and especie = 'pedido' and situacao = 'aberto'`,
    [pedidoId, ctx.orgId, vencedor.fornecedor_id, condicaoId, plano ? JSON.stringify(plano) : null, totais.subtotal, totais.total]);
  if (up.rowCount !== 1) throw notFound("Documento");
  const uv = await ctx.tx.query(
    "update erp.documentos_compra set situacao = 'escolhido' where id = $1 and organization_id = $2 and especie = 'orcamento' and situacao = 'aberto'",
    [vencedor.id, ctx.orgId]).catch(recusaDoSegundoVencedor);
  if (uv.rowCount !== 1) throw notFound("Documento");
  if (naoEscolhidos.length) {
    const un = await ctx.tx.query(
      "update erp.documentos_compra set situacao = 'nao_escolhido' where id = any($1::uuid[]) and organization_id = $2 and especie = 'orcamento' and situacao = 'aberto'",
      [naoEscolhidos, ctx.orgId]);
    if (un.rowCount !== naoEscolhidos.length) throw notFound("Documento");
  }

  // 8. As trilhas: o pedido (o que mudou nele), o vencedor e cada não escolhido.
  const depois = { fornecedor_id: vencedor.fornecedor_id, condicao_pagamento_id: condicaoId, valor_itens: totais.subtotal, valor_total: totais.total };
  await audit(ctx.tx, ctx, "documentos_compra", pedidoId, "escolher_vencedor", { orcamento: vencedor.id, naoEscolhidos },
    { before: { fornecedor_id: pedido.fornecedor_id, condicao_pagamento_id: pedido.condicao_pagamento_id ?? null, valor_itens: pedido.valor_itens, valor_total: pedido.valor_total }, after: depois });
  await audit(ctx.tx, ctx, "documentos_compra", vencedor.id, "escolhido", { pedido: pedidoId }, { before: { situacao: "aberto" }, after: { situacao: "escolhido" } });
  for (const outro of naoEscolhidos) {
    await audit(ctx.tx, ctx, "documentos_compra", outro, "nao_escolhido", { pedido: pedidoId, vencedor: vencedor.id }, { before: { situacao: "aberto" }, after: { situacao: "nao_escolhido" } });
  }
  // 9. A resposta (o replay da Idempotency-Key devolve esta, gravada, e não escolhe de novo).
  return {
    pedido: { id: pedidoId, situacao: "aberto", ...depois },
    vencedor: { id: vencedor.id, situacao: "escolhido" },
    naoEscolhidos,
  };
}

// ─────────────── a TOP do orçamento nas portas de leitura do lançamento ───────────────

/**
 * A TOP pedida por `?tipo_operacao_id=`: da família do orçamento, ativa, não excluída, com versão atual, desta
 * organização — senão a MESMA 404 (ausente, malformada, de outra família, inativa, excluída ou de outra organização:
 * distinguir seria oráculo de existência). Devolve o id dela.
 */
async function topDaConsulta(ctx: ServiceCtx, query: unknown): Promise<string> {
  const bruto = ((query ?? {}) as Record<string, unknown>)["tipo_operacao_id"];
  if (typeof bruto !== "string" || !FORMA_UUID_PADRAO.test(bruto)) throw notFound("Tipo de operação");
  const v = await ctx.tx.query<{ id: string }>(
    `select t.id from erp.tipos_operacao t
       join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
      where t.id = $1 and t.organization_id = $2 and t.codigo_base = $3 and t.ativo and t.excluido_em is null`,
    [bruto, ctx.orgId, familiaDoOrcamento()]);
  const linha = v.rows[0];
  if (!linha) throw notFound("Tipo de operação");
  return linha.id;
}

// ─────────────── rotas ───────────────

export default async function comprasOrcamentoRoutes(app: FastifyInstance) {
  /** APROVADO PARA ORÇAMENTO — `compras.edit` (o texto do Maike) ∧ a leitura do pedido. Corpo vazio. */
  app.post("/compras/pedidos/:id/aprovar-para-orcamento", async (req) => runService(app, req, "compras.edit", async (ctx) => {
    corpoVazio.parse(req.body ?? {});
    const pedidoId = idDaRota((req.params as { id: string }).id);
    requirePermission(ctx, "pedidos_compra.view");
    // Visibilidade ANTES da chave: o replay não atravessa o escopo.
    await lerDocumentoCompra(ctx, pedidoId, "pedido");
    return (await idempotent(ctx.tx, ctx.orgId, chaveDe(req),
      { action: "aprovar_pedido_para_orcamento", pedidoId, actorId: ctx.user.id },
      () => aprovarParaOrcamento(ctx, pedidoId))).result;
  }));

  /** CRIAR O ORÇAMENTO a partir do pedido — `orcamentos_compra.create` ∧ a leitura do pedido. 201. */
  app.post("/compras/pedidos/:id/orcamentos", async (req, reply) => reply.status(201).send(await runService(app, req, "orcamentos_compra.create", async (ctx) => {
    const corpo = criarSchema.parse(req.body ?? {});
    const pedidoId = idDaRota((req.params as { id: string }).id);
    requirePermission(ctx, "pedidos_compra.view");
    await lerDocumentoCompra(ctx, pedidoId, "pedido");
    return (await idempotent(ctx.tx, ctx.orgId, chaveDe(req),
      { action: "criar_orcamento_compra", pedidoId, corpo, actorId: ctx.user.id },
      () => criarOrcamento(ctx, pedidoId, corpo))).result;
  })));

  /** ESCOLHER O VENCEDOR — muda os dois documentos: `pedidos_compra.edit` ∧ `orcamentos_compra.edit`. Corpo vazio. */
  app.post("/compras/pedidos/:id/orcamentos/:orcamentoId/escolher", async (req) => runService(app, req, "pedidos_compra.edit", async (ctx) => {
    corpoVazio.parse(req.body ?? {});
    const params = req.params as { id: string; orcamentoId: string };
    const pedidoId = idDaRota(params.id);
    const orcamentoId = idDaRota(params.orcamentoId);
    requirePermission(ctx, "orcamentos_compra.edit");
    await lerDocumentoCompra(ctx, pedidoId, "pedido");
    await lerDocumentoCompra(ctx, orcamentoId, ESPECIE);
    return (await idempotent(ctx.tx, ctx.orgId, chaveDe(req),
      { action: "escolher_orcamento_vencedor", pedidoId, orcamentoId, actorId: ctx.user.id },
      () => escolherVencedor(ctx, pedidoId, orcamentoId))).result;
  }));

  /** A LISTA dos orçamentos: a MESMA de compras (`listarDocumentos`), com a espécie da porta e o filtro `pedido_orcado_id`. */
  app.get("/compras/orcamentos", async (req) => runService(app, req, "orcamentos_compra.view",
    (ctx) => listarDocumentos(ctx, [ESPECIE], req.query, { filtroEspecie: false, unica: false })));

  /**
   * As TOPs de orçamento — o contrato de hoje das outras espécies (`contractVersion`, `capacidades`, `family`,
   * `defaultId`, `items`), com as MESMAS capacidades e `finalizacaoEOrcamento` no FIM. O que o orçamento aceita no
   * corpo é o catálogo do layout dele (sem natureza, centro, frete, parcelas ou Local de estoque).
   */
  app.get("/compras/orcamentos/operation-types", async (req) => runService(app, req, "orcamentos_compra.create", async (ctx) => {
    const familia = familiaDoOrcamento();
    const r = await ctx.tx.query<{ id: string; codigo: string; nome: string; versao: number; padrao: boolean }>(
      `select t.id, t.codigo, v.nome, v.versao, t.padrao
         from erp.tipos_operacao t
         join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
        where t.organization_id = $1 and t.codigo_base = $2 and t.ativo and t.excluido_em is null
        order by t.padrao desc, t.codigo, v.nome`, [ctx.orgId, familia]);
    return {
      contractVersion: 1,
      capacidades: { classificacaoFinanceira: 1, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, layoutDocumento: CAPACIDADE_LAYOUT_DOCUMENTO, regrasDaOperacao: CAPACIDADE_REGRAS_DA_OPERACAO,
        finalizacaoEOrcamento: CAPACIDADE_FINALIZACAO_E_ORCAMENTO_COMPRA },
      family: { code: familia, label: t(chaveI18nDaFamiliaOperacional(familia) ?? familia) },
      defaultId: r.rows.find((x) => x.padrao)?.id ?? null,
      items: r.rows.map((x) => ({ id: x.id, code: x.codigo, name: x.nome, version: x.versao, isDefault: x.padrao })),
    };
  }));

  /**
   * REGRAS DA OPERAÇÃO da TOP de orçamento (versão ATUAL) — o contrato do pedido: exigências com o mapa do ORÇAMENTO
   * (fornecedor e observação) e condições permitidas; o orçamento nunca gera efeito, então os quatro são false.
   */
  app.get("/compras/orcamentos/regras-da-operacao", async (req) => runService(app, req, "orcamentos_compra.create", async (ctx) => {
    const topId = await topDaConsulta(ctx, req.query);
    const { formato, regras } = await regrasDaTopAtual(ctx, topId);
    return {
      contractVersion: 1,
      formato,
      exigencias: regras ? camposExigidosTop(regras.config, EXIGENCIAS_GERAIS_ORCAMENTO_COMPRA_TOP) : [],
      condicoesPermitidas: regras?.condicoesPermitidas ?? null,
      geraTitulos: false,
      exigeFormaPagamento: false,
      exigeVencimento: false,
      exigeArmazem: false,
    };
  }));

  /** LAYOUT EFETIVO da TOP de orçamento: o contrato de vendas e de compras, a MESMA 404 das regras. Antes de `/:id`. */
  app.get("/compras/orcamentos/layout-efetivo", async (req) => runService(app, req, "orcamentos_compra.create", async (ctx) => {
    return respostaDoLayoutEfetivo(ctx, familiaDoOrcamento(), await topDaConsulta(ctx, req.query));
  }));

  /** A LEITURA do orçamento: a de compras, com a espécie da porta (o pedido e a compra caem na MESMA 404). */
  app.get("/compras/orcamentos/:id", async (req) => runService(app, req, "orcamentos_compra.view",
    (ctx) => lerDocumentoCompra(ctx, (req.params as { id: string }).id, ESPECIE)));

  /** EDITAR (PUT substitui) — `orcamentos_compra.edit`. Responde a leitura do orçamento depois de gravar. */
  app.put("/compras/orcamentos/:id", async (req) => runService(app, req, "orcamentos_compra.edit", async (ctx) => {
    const corpo = editarSchema.parse(req.body ?? {});
    const orcamentoId = idDaRota((req.params as { id: string }).id);
    const visto = comoOrcamento(await lerDocumentoCompra(ctx, orcamentoId, ESPECIE));
    return (await idempotent(ctx.tx, ctx.orgId, chaveDe(req),
      { action: "editar_orcamento_compra", orcamentoId, corpo, actorId: ctx.user.id },
      () => editarOrcamento(ctx, orcamentoId, visto.pedido_orcado_id, corpo))).result;
  }));

  /** CANCELAR — `orcamentos_compra.delete`; o motivo opcional de hoje; o hash da chave é o do cancelar de compras. */
  app.post("/compras/orcamentos/:id/cancel", async (req) => runService(app, req, "orcamentos_compra.delete", async (ctx) => {
    const motivo = cancelarSchema.parse(req.body ?? {}).motivo ?? null;
    const orcamentoId = idDaRota((req.params as { id: string }).id);
    await lerDocumentoCompra(ctx, orcamentoId, ESPECIE);
    return (await idempotent(ctx.tx, ctx.orgId, chaveDe(req),
      { action: "cancelar_documento_compra", sourceId: orcamentoId, especie: ESPECIE, motivo, actorId: ctx.user.id },
      () => cancelarOrcamento(ctx, orcamentoId, motivo))).result;
  }));
}
