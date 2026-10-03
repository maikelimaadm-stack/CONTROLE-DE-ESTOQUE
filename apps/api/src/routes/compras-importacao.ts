/**
 * ═══ OPERACOES-01 F7 (decisão 284) — A ENTRADA DE NOTA POR XML NA CENTRAL DE COMPRAS ═══
 *
 * Importar o XML de uma NF-e é o começo de LANÇAR UMA COMPRA: as rotas pedem `compras.create` (módulo compras) e
 * nenhuma permissão nova. O "Lançar" da DF-e pede também `dfe.launch`, e gerar a compra COM PEDIDO pede também
 * `pedidos_compra.edit` (receber o pedido muda o pedido, como na porta do receber) — CAPACIDADE ∧ CAPACIDADE, nunca OR.
 *
 *   POST /compras/importacoes                  o arquivo (XML, ou ZIP com um único XML) em base64 → 201 conferência
 *   POST /compras/importacoes/da-dfe/:dfeId    o XML GUARDADO da DF-e → 201 conferência
 *   GET  /compras/importacoes/:id              a conferência (`?fornecedor_id=` escolhe o fornecedor entre os candidatos)
 *   POST /compras/importacoes/:id/gerar-compra a COMPRA ABERTA, com as decisões do corpo e os VALORES da nota guardada
 *   POST /compras/importacoes/:id/descartar    a importação descartada (nunca apagada)
 *
 * O ARQUIVO é lido FORA da transação (nenhuma conexão do pool fica presa descompactando): base64 → bytes (≤ 3 MB) →
 * ZIP (`lib/zip-leitor.ts`) ou XML → texto (`textoDoXml`) → a leitura do domínio (`lerNotaFiscalEletronica`), com TODAS
 * as recusas em 422 no `arquivo`. A empresa é a DESTINATÁRIA (`resolverDestinatario`, no escopo de escrita do módulo
 * compras; a do corpo é pedido). O ORIGINAL é guardado (`notas_fiscais_xml`, imutável) e a importação nasce PENDENTE.
 *
 * NOTA REPETIDA: ao importar, a chave é travada (a MESMA trava dos gatilhos da 0047) e procurada na compra viva e no
 * Documento fiscal de Estoque (409 DUPLICATE_DOCUMENT dizendo onde, quando a pessoa enxerga); a importação PENDENTE da
 * mesma chave → 409 com o id dela (`onde: "importacao"`; a tela abre a pendente), e a corrida é o índice
 * `ux_importacoes_nfe_compra_pendente`. Ao gerar, `lancar` confere de novo e o banco é a rede (índice e gatilhos).
 *
 * GERAR A COMPRA: o corpo traz só DECISÕES (TOP, fornecedor, produto e fator de cada item, local, pedido, financeiro);
 * os VALORES (quantidades, preços, descontos, impostos, frete, lotes do rastro, duplicatas) vêm SEMPRE do XML guardado.
 * A compra é lançada pela MESMA `lancar` do POST de compra (com os extras da nota) e, com pedido, entre as MESMAS duas
 * metades do receber (`prepararRecebimentoDoPedido`/`concluirRecebimentoDoPedido`). A compra nasce ABERTA e NUNCA se
 * confirma sozinha — nem pela regra "Confirmação automática" da TOP, nem pela do receber: a confirmação (estoque e
 * financeiro) é feita depois, na consulta da compra, com a prévia.
 *
 * A EMPRESA DE TRABALHO: a importação é da empresa DESTINATÁRIA (que a pessoa pode ter escolhido no envio, diferente
 * da selecionada na tela). As leituras dela não se estreitam pela empresa selecionada, e o "Gerar compra" trabalha na
 * empresa da importação (que está no escopo do módulo — a selecionada é contexto de trabalho, nunca autorização).
 *
 * TRAVAS, na ordem: importação (`for update`) → chave de acesso (`travarChaveDeAcesso`; a mesma do gatilho da 0047,
 * reentrante em `lancar`) → DF-e ligada (`for update`) → pedido (`prepararRecebimentoDoPedido`) → contador do código →
 * contador do ID Global → itens de origem (gatilho) → vínculos. Chave ANTES da DF-e: a ordem da nota antiga com `dfe_id`.
 *
 * A DF-e DA MESMA CHAVE, na importação de ARQUIVO, passa a "launched" no "Gerar compra" sem exigir `dfe.launch` — o
 * precedente da nota antiga com `dfe_id` (que também não exige): a nota foi lançada, e a fila só registra o fato. A
 * importação que NASCE da DF-e (`/da-dfe`) exige `dfe.launch`, porque ali a pessoa age sobre a fila.
 *
 * PADRÕES DE TODA ROTA: corpo `.strict()` (chave desconhecida = 422), uuid em minúsculas antes do hash, a 404 de
 * visibilidade ANTES do `idempotent` (o replay não atravessa o escopo), Idempotency-Key com o autor no hash, ROW COUNT
 * em todo UPDATE sob RLS, id malformado = a mesma 404, escopo de empresa no SQL.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash } from "node:crypto";
import { D, money, isISODate, DomainError } from "@agro/shared";
import {
  lerNotaFiscalEletronica, linhasDoItemDaNota, totaisDaCompra, conferirTotalDaNota, parcelasDaNota, valoresNaoSuportadosDaNota,
  normalizarUnidadeDaNota, moduloDaPermissao,
  type NotaFiscalLida, type LinhaDaCompraDaNota, type CompraGeradaDaNota, type ItemDoRecebimento, type ControleDeLoteDoProduto,
} from "@agro/domain";
import { runService, idempotent, audit, requirePermission } from "../lib/service.js";
import { err } from "../lib/errors.js";
import { consultaEscopada, empresaScopeSql, type ServiceCtx } from "../lib/context.js";
import { textoDoXml, resolverDestinatario, guardarXmlDaNota, conferirChaveDeAcessoLivre, travarChaveDeAcesso, documentoNormalizado } from "../lib/nota-fiscal-xml.js";
import { pareceZip, xmlDoZip, MENSAGEM_DA_RECUSA_DO_ZIP } from "../lib/zip-leitor.js";
import {
  lerImportacao, notaDaImportacao, montarConferencia, candidatosDoEmitente, resolverParceiro, dfeDaNota, cabecalhoDaNota, mensagemNaoSuportado,
  naoEncontrada, FORMA_UUID, type ImportacaoLida,
} from "../lib/importacao-nfe-conferencia.js";
import { lancar, type DocumentoCompraEntrada, type ExtrasDaNotaImportada, type OrigemDoLancamento } from "./compras.js";
import { prepararRecebimentoDoPedido, concluirRecebimentoDoPedido } from "./compras-recebimento.js";

// ─────────────── limites e mensagens ───────────────

/** O maior arquivo aceito (XML ou ZIP), em bytes depois do base64. */
export const ARQUIVO_MAXIMO_IMPORTACAO = 3 * 1024 * 1024;
/** O corpo do POST: o base64 do arquivo máximo (4/3, com folga) e o resto do JSON. */
const LIMITE_DO_CORPO = Math.ceil(ARQUIVO_MAXIMO_IMPORTACAO * 1.4) + 4096;
const PERMISSAO = "compras.create";
const PERMISSAO_DFE = "dfe.launch";
const PERMISSAO_RECEBER_PEDIDO = "pedidos_compra.edit";

export const MSG_IMPORTACAO_PENDENTE = "Esta nota já tem uma importação pendente.";
export const MSG_ARQUIVO_GRANDE = "Arquivo maior que 3 MB.";
export const MSG_ARQUIVO_NAO_BASE64 = "O arquivo não veio em base64.";
export const MSG_DFE_SEM_XML = "Esta DF-e foi registrada sem o XML: importe o arquivo na Central de Compras.";
export const MSG_DFE_LANCADA = "Esta DF-e já foi lançada.";
export const MSG_DFE_IGNORADA = "Esta DF-e foi ignorada na fila de DF-e.";
export const MSG_DFE_EM_APROVACAO = "Esta DF-e tem um rascunho de aprovação pendente: aprove-o ou ignore-o na fila de DF-e.";
export const MSG_DFE_MUDOU = "A DF-e desta nota já foi lançada, ignorada ou está em aprovação na fila de DF-e: descarte esta importação.";
export const MSG_IMPORTACAO_DESCARTADA = "Esta importação foi descartada.";
export const msgImportacaoGerada = (codigo: string) => `Esta importação já gerou a Compra ${codigo}.`;

const recusa = (path: string, message: string, extra: Record<string, unknown> = {}) => err("VALIDATION_ERROR", message, [{ path, message, ...extra }]);
const naoEncontradaDfe = () => err("NOT_FOUND", "DF-e não encontrada");

// ─────────────── contratos de entrada (estritos) ───────────────

const uuid = z.string().uuid().transform((v) => v.toLowerCase());
const data = z.string().refine(isISODate, "Data inválida");
/** Decimal em TEXTO (nunca número JSON: nada de ponto flutuante no fio), com o máximo de casas dado. */
const decimalTexto = (casas: number, mensagem: string) => z.string().trim().regex(new RegExp(`^\\d{1,12}(\\.\\d{1,${casas}})?$`), mensagem);

const importarSchema = z.object({
  nome_arquivo: z.string().trim().min(1).max(255),
  arquivo_base64: z.string().min(1),
  empresa_id: uuid.nullish(),
}).strict();
const daDfeSchema = z.object({ empresa_id: uuid.nullish() }).strict();
const conferenciaQuerySchema = z.object({ fornecedor_id: uuid.optional() }).strict();
const descartarSchema = z.object({}).strict();

const linhaDoRateioSchema = z.object({
  categoria_financeira_id: uuid, centro_custo_id: uuid, conta_contabil_id: uuid.nullish(), safra_id: uuid.nullish(),
  percentual: decimalTexto(4, "Informe o percentual em texto decimal, com até 4 casas"),
}).strict();
const rateioDoGerarSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("documento"), categoria_financeira_id: uuid.nullish(), centro_custo_id: uuid.nullish() }).strict(),
  z.object({ tipo: z.literal("por_valor"), linhas: z.array(linhaDoRateioSchema).min(1).max(50) }).strict(),
  z.object({ tipo: z.literal("por_produto") }).strict(),
]);
const itemDoGerarSchema = z.object({
  n_item: z.number().int().min(1).max(990),
  produto_id: uuid,
  fator: decimalTexto(6, "Informe o fator em texto decimal, com até 6 casas").refine((v) => D(v).gt(0), "O fator precisa ser maior que zero"),
  tipo_fator: z.enum(["multiply", "divide"]),
  lembrar_vinculo: z.boolean().optional(),
  armazem_id: uuid.nullish(),
  gera_estoque: z.boolean().optional(),
  imobilizado: z.boolean().optional(),
  item_origem_id: uuid.nullish(),
  categoria_financeira_id: uuid.nullish(),
  centro_custo_id: uuid.nullish(),
  lote: z.string().trim().min(1).max(60).nullish(),
  validade: data.nullish(),
}).strict();
const gerarSchema = z.object({
  tipo_operacao_id: uuid,
  fornecedor_id: uuid,
  data_entrada: data.nullish(),
  observacao: z.string().trim().max(2000).nullish(),
  transportadora_id: uuid.nullish(),
  pedido_id: uuid.nullish(),
  solicitacao_compra_id: uuid.nullish(),
  financeiro: z.object({
    parcelas: z.enum(["nota", "condicao"]),
    condicao_pagamento_id: uuid.nullish(),
    data_vencimento: data.nullish(),
    forma_pagamento_id: uuid.nullish(),
    tipo_titulo_id: uuid.nullish(),
    classificacao_gasto: z.enum(["capex", "opex"]).nullish(),
    rateio: rateioDoGerarSchema,
  }).strict(),
  itens: z.array(itemDoGerarSchema).min(1).max(990),
}).strict();
type GerarEntrada = z.infer<typeof gerarSchema>;

// ─────────────── o arquivo ───────────────

/** Um arquivo LIDO: a nota, o texto que será guardado, o nome e o SHA-256 dos bytes enviados (para o hash da chave). */
interface ArquivoLido { nota: NotaFiscalLida; texto: string; nomeArquivo: string; sha256: string }

/** As recusas da leitura da NF-e, todas, em 422 no `campo` (uma por detalhe, com o motivo e o caminho no XML). */
function recusaDaLeitura(texto: string, campo: string): NotaFiscalLida {
  const leitura = lerNotaFiscalEletronica(texto);
  if (leitura.ok) return leitura.nota;
  throw err("VALIDATION_ERROR", leitura.recusas[0]!.mensagem,
    leitura.recusas.map((r) => ({ path: campo, message: r.mensagem, motivo: r.motivo, caminho: r.caminho })));
}

/**
 * O ARQUIVO do corpo (base64), lido FORA da transação: ≤ 3 MB; ZIP com um único XML, ou o XML; o texto (UTF-8 ou
 * ISO-8859-1 declarado); a NF-e processada. Toda recusa é 422 no `arquivo` (o base64 malformado, no `arquivo_base64`).
 */
function lerArquivo(nomeArquivo: string, base64: string): ArquivoLido {
  const limpo = base64.replace(/\s+/g, "");
  if (!limpo || limpo.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) throw recusa("arquivo_base64", MSG_ARQUIVO_NAO_BASE64);
  if ((limpo.length / 4) * 3 - (limpo.endsWith("==") ? 2 : limpo.endsWith("=") ? 1 : 0) > ARQUIVO_MAXIMO_IMPORTACAO) throw recusa("arquivo", MSG_ARQUIVO_GRANDE);
  const bytes = Buffer.from(limpo, "base64");
  if (bytes.length > ARQUIVO_MAXIMO_IMPORTACAO) throw recusa("arquivo", MSG_ARQUIVO_GRANDE);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let xml: Buffer = bytes; let nome = nomeArquivo;
  if (pareceZip(bytes)) {
    const z = xmlDoZip(bytes);
    if (!z.ok) throw recusa("arquivo", MENSAGEM_DA_RECUSA_DO_ZIP[z.motivo], { motivo: z.motivo });
    xml = z.conteudo; nome = z.nome;
  }
  const texto = textoDoXml(xml, "arquivo");
  return { nota: recusaDaLeitura(texto, "arquivo"), texto, nomeArquivo: nome, sha256 };
}

// ─────────────── criar a importação ───────────────

/**
 * A IMPORTAÇÃO PENDENTE, dentro da transação: a chave travada e livre (`conferirChaveDeAcessoLivre`), nenhuma importação
 * pendente VISÍVEL da mesma chave (409 com o id), o XML guardado (ou o da DF-e) e a linha nova; a corrida com a pendente
 * invisível é o índice único (409 sem o id). Devolve a conferência da importação nova.
 */
async function criarImportacao(ctx: ServiceCtx, x: { nota: NotaFiscalLida; empresaId: string; origem: "arquivo" | "dfe"; dfeId: string | null;
  xml: { id: string } | { texto: string; nomeArquivo: string } }) {
  const { nota } = x;
  await conferirChaveDeAcessoLivre(ctx, nota.chave);
  const params: unknown[] = [ctx.orgId, nota.chave];
  const pendente = await ctx.tx.query<{ id: string }>(
    `select i.id::text as id from erp.importacoes_nfe_compra i
      where i.organization_id = $1 and i.chave_acesso = $2 and i.situacao = 'pendente'${empresaScopeSql(ctx, "i", params, { ignoreSelected: true })}`, params);
  if (pendente.rows[0]) throw err("DUPLICATE_DOCUMENT", MSG_IMPORTACAO_PENDENTE, { onde: "importacao", id: pendente.rows[0].id });
  const xmlId = "id" in x.xml ? x.xml.id
    : (await guardarXmlDaNota(ctx, { empresaId: x.empresaId, chave: nota.chave, texto: x.xml.texto, nomeArquivo: x.xml.nomeArquivo })).id;
  const r = await ctx.tx.query<{ id: string }>(
    `insert into erp.importacoes_nfe_compra (organization_id, empresa_id, xml_id, chave_acesso, numero, serie, data_emissao, emitente_documento,
       emitente_nome, valor_total, origem, dfe_id, criado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id::text as id`,
    [ctx.orgId, x.empresaId, xmlId, nota.chave, nota.numero, nota.serie, nota.dataEmissao, documentoNormalizado(nota.emitente.documento),
      nota.emitente.nome, money(nota.totais.nota), x.origem, x.dfeId, ctx.user.id]).catch((e: unknown) => {
    // A pendente da mesma chave que a pessoa NÃO enxerga (outra empresa), ou a corrida: o índice recusa, sem o id.
    const pe = e as { code?: string; constraint?: string };
    if (pe.code === "23505" && pe.constraint === "ux_importacoes_nfe_compra_pendente") throw err("DUPLICATE_DOCUMENT", MSG_IMPORTACAO_PENDENTE);
    throw e;
  });
  const id = r.rows[0]!.id;
  await audit(ctx.tx, ctx, "importacoes_nfe_compra", id, "create", { chave: nota.chave, origem: x.origem, xmlId, ...(x.dfeId ? { dfeId: x.dfeId } : {}) });
  return montarConferencia(ctx, await lerImportacao(ctx, id), null);
}

// ─────────────── gerar a compra ───────────────

/**
 * O caminho de uma recusa de `lancar`/do receber, traduzido para o CORPO do gerar: `itens[k]` (a linha da compra) vira
 * `itens[i]` (o item do corpo de onde a linha veio — um item da nota com dois lotes são duas linhas); os campos do
 * financeiro voltam para dentro de `financeiro`. Nada mais muda na recusa.
 */
function caminhoDoCorpo(path: string, linhaParaCorpo: readonly number[]): string {
  const item = /^itens\[(\d+)\](.*)$/.exec(path);
  if (item) return `itens[${linhaParaCorpo[Number(item[1])] ?? item[1]}]${item[2]}`;
  if (path === "categoria_financeira_id" || path === "centro_custo_id") return `financeiro.rateio.${path}`;
  if (path === "rateio" || path.startsWith("rateio.")) return `financeiro.${path}`;
  if (["condicao_pagamento_id", "forma_pagamento_id", "data_vencimento", "tipo_titulo_id", "classificacao_gasto"].includes(path)) return `financeiro.${path}`;
  return path;
}
async function comCaminhosDoCorpo<T>(linhaParaCorpo: readonly number[], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DomainError && Array.isArray(e.details)) {
      const details = (e.details as unknown[]).map((d) => (d && typeof d === "object" && typeof (d as { path?: unknown }).path === "string"
        ? { ...(d as Record<string, unknown>), path: caminhoDoCorpo((d as { path: string }).path, linhaParaCorpo) } : d));
      throw new DomainError(e.code, e.message, details);
    }
    throw e;
  }
}

const MSG_DA_LINHA: Record<string, { campo: string; mensagem: string }> = {
  rastro_diferente_da_quantidade: { campo: "n_item", mensagem: "A soma dos lotes do rastro deste item não é a quantidade do item na nota." },
  lote_obrigatorio: { campo: "lote", mensagem: "Este produto controla lote e a nota não traz o rastro: informe o lote." },
  lote_com_rastro: { campo: "lote", mensagem: "A nota traz o rastro (lotes) deste item: o lote e a validade vêm da nota." },
  quantidade_invalida: { campo: "fator", mensagem: "A conversão pelo fator deixa a quantidade zerada: confira o fator." },
};

/** Uma linha da compra montada da nota, com o item do corpo de onde veio. */
interface LinhaMontada { corpo: number; nItem: number; produtoId: string; linha: LinhaDaCompraDaNota; itemOrigemId: string | null }

/**
 * As LINHAS DA COMPRA pela nota e pelas decisões do corpo: cada `n_item` da nota exatamente uma vez; produto vivo da
 * organização; uma linha por lote do rastro (produto que controla lote e dá entrada); sem rastro, o lote/validade do
 * corpo. Item que não gera estoque (ou produto sem controle de estoque) não exige lote. A validade só segue para produto
 * que controla validade (a nota pode trazer dVal de um produto que só controla lote).
 */
async function linhasDaCompra(ctx: ServiceCtx, nota: NotaFiscalLida, corpo: GerarEntrada): Promise<LinhaMontada[]> {
  const naNota = new Set(nota.itens.map((i) => i.nItem));
  const visto = new Map<number, number>();
  corpo.itens.forEach((b, i) => {
    if (!naNota.has(b.n_item)) throw recusa(`itens[${i}].n_item`, "Este item não existe na nota.");
    if (visto.has(b.n_item)) throw recusa(`itens[${i}].n_item`, "Informe cada item da nota uma vez só.");
    visto.set(b.n_item, i);
  });
  const faltando = nota.itens.find((i) => !visto.has(i.nItem));
  if (faltando) throw recusa("itens", `Informe a decisão de todos os itens da nota (falta o item ${faltando.nItem}).`);
  const produtos = new Map((await ctx.tx.query<{ id: string; controle_lote: ControleDeLoteDoProduto; control_stock: boolean }>(
    "select id::text as id, controle_lote, control_stock from erp.products where organization_id = $1 and id = any($2::uuid[]) and deleted_at is null",
    [ctx.orgId, [...new Set(corpo.itens.map((b) => b.produto_id))]])).rows.map((p) => [p.id, p]));
  const out: LinhaMontada[] = [];
  for (const item of nota.itens) {
    const i = visto.get(item.nItem)!;
    const b = corpo.itens[i]!;
    const p = produtos.get(b.produto_id);
    if (!p) throw recusa(`itens[${i}].produto_id`, "Produto inválido");
    const semEntrada = b.gera_estoque === false || !p.control_stock;
    const controle: ControleDeLoteDoProduto = semEntrada && item.rastro.length === 0 ? "nenhum" : p.controle_lote;
    const r = linhasDoItemDaNota(item, { produtoId: p.id, fator: b.fator, tipoFator: b.tipo_fator, controlaLote: controle,
      lote: controle === "nenhum" ? null : b.lote ?? null, validade: controle === "nenhum" ? null : b.validade ?? null });
    if (!r.ok) { const m = MSG_DA_LINHA[r.motivo]!; throw recusa(`itens[${i}].${m.campo}`, m.mensagem); }
    if (controle === "lote_validade" && item.rastro.length === 0 && !b.validade) {
      throw recusa(`itens[${i}].validade`, "Este produto controla lote e validade: informe a validade.");
    }
    for (const l of r.linhas) {
      // Sem controle (item que não dá entrada, sem rastro): o lote e a validade do corpo seguem como vieram (`lancar` confere).
      const linha = controle === "nenhum" ? { ...l, lote: b.lote ?? null, validade: b.validade ?? null }
        : { ...l, validade: p.controle_lote === "lote_validade" ? l.validade : null };
      out.push({ corpo: i, nItem: item.nItem, produtoId: p.id, linha, itemOrigemId: b.item_origem_id ?? null });
    }
  }
  return out;
}

/** A solicitação de compra antiga é da empresa da compra e está no escopo (o gatilho da 0047 é a rede). */
async function conferirSolicitacao(ctx: ServiceCtx, solicitacaoId: string, empresaId: string): Promise<void> {
  const params: unknown[] = [solicitacaoId, ctx.orgId, empresaId];
  const r = await ctx.tx.query(
    `select 1 from erp.purchase_requests r
      where r.id = $1 and r.organization_id = $2 and r.empresa_id = $3 and r.deleted_at is null${empresaScopeSql(ctx, "r", params, { ignoreSelected: true })}`, params);
  if (!r.rowCount) throw recusa("solicitacao_compra_id", "Solicitação de compra inválida: escolha uma solicitação da empresa da compra.");
}

/** O pedido escolhido: da empresa da importação, do fornecedor, aberto ou finalizado e no escopo. A condição dele. */
async function pedidoDaImportacao(ctx: ServiceCtx, pedidoId: string, empresaId: string, fornecedorId: string): Promise<{ condicaoPagamentoId: string | null }> {
  const params: unknown[] = [pedidoId, ctx.orgId, empresaId, fornecedorId];
  const r = await ctx.tx.query<{ condicao_pagamento_id: string | null }>(
    `select d.condicao_pagamento_id::text as condicao_pagamento_id from erp.documentos_compra d
      where d.id = $1 and d.organization_id = $2 and d.especie = 'pedido' and d.empresa_id = $3 and d.fornecedor_id = $4
        and d.situacao in ('aberto', 'finalizado')${empresaScopeSql(ctx, "d", params, { ignoreSelected: true })}`, params);
  if (!r.rows[0]) throw recusa("pedido_id", "Pedido inválido: escolha um pedido aberto ou finalizado deste fornecedor, na empresa da compra.");
  return { condicaoPagamentoId: r.rows[0].condicao_pagamento_id };
}

/**
 * OS VÍNCULOS LEMBRADOS (`lembrar_vinculo`, padrão sim): os existentes lidos `for update` numa consulta; os novos num
 * INSERT só; os que mudaram (produto, fator ou tipo) um UPDATE cada, com ROW COUNT 1. A mesma chave (código + unidade)
 * em dois itens da nota: vale a decisão do PRIMEIRO item.
 */
async function lembrarVinculos(ctx: ServiceCtx, nota: NotaFiscalLida, corpo: GerarEntrada): Promise<void> {
  const porNItem = new Map(corpo.itens.map((b) => [b.n_item, b]));
  const decisoes = new Map<string, { codigo: string; unidade: string; produtoId: string; fator: string; tipo: "multiply" | "divide" }>();
  for (const item of nota.itens) {
    const b = porNItem.get(item.nItem)!;
    if (b.lembrar_vinculo === false) continue;
    const codigo = item.codigo.trim(); const unidade = normalizarUnidadeDaNota(item.unidade);
    if (!codigo || codigo.length > 60 || !unidade) continue;
    const chave = `${codigo}\u0000${unidade}`;
    if (!decisoes.has(chave)) decisoes.set(chave, { codigo, unidade, produtoId: b.produto_id, fator: D(b.fator).toFixed(6), tipo: b.tipo_fator });
  }
  if (decisoes.size === 0) return;
  const lista = [...decisoes.values()];
  const existentes = new Map((await ctx.tx.query<{ id: string; codigo_fornecedor: string; unidade_fornecedor: string; produto_id: string; fator: string; tipo_fator: string }>(
    `select id::text as id, codigo_fornecedor, unidade_fornecedor, produto_id::text as produto_id, fator::text as fator, tipo_fator
       from erp.produto_fornecedor_vinculos
      where organization_id = $1 and fornecedor_id = $2 and (codigo_fornecedor, unidade_fornecedor) in (select * from unnest($3::text[], $4::text[]))
      for update`, [ctx.orgId, corpo.fornecedor_id, lista.map((x) => x.codigo), lista.map((x) => x.unidade)])).rows
    .map((x) => [`${x.codigo_fornecedor}\u0000${x.unidade_fornecedor}`, x]));
  const novos = lista.filter((x) => !existentes.has(`${x.codigo}\u0000${x.unidade}`));
  if (novos.length) {
    // A corrida com outra geração do mesmo fornecedor/código/unidade: vale quem gravou primeiro (sem erro).
    await ctx.tx.query(
      `insert into erp.produto_fornecedor_vinculos (organization_id, fornecedor_id, codigo_fornecedor, unidade_fornecedor, produto_id, tipo_fator, fator, criado_por)
       select $1, $2, c, u, p, t, f::numeric, $3 from unnest($4::text[], $5::text[], $6::uuid[], $7::text[], $8::text[]) as x(c, u, p, t, f)
       on conflict (organization_id, fornecedor_id, codigo_fornecedor, unidade_fornecedor) do nothing`,
      [ctx.orgId, corpo.fornecedor_id, ctx.user.id, novos.map((x) => x.codigo), novos.map((x) => x.unidade), novos.map((x) => x.produtoId),
        novos.map((x) => x.tipo), novos.map((x) => x.fator)]);
  }
  for (const x of lista) {
    const ja = existentes.get(`${x.codigo}\u0000${x.unidade}`);
    if (!ja || (ja.produto_id === x.produtoId && D(ja.fator).eq(D(x.fator)) && ja.tipo_fator === x.tipo)) continue;
    const u = await ctx.tx.query(
      `update erp.produto_fornecedor_vinculos set produto_id = $3, fator = $4::numeric, tipo_fator = $5, atualizado_por = $6, atualizado_em = now()
        where id = $1 and organization_id = $2`, [ja.id, ctx.orgId, x.produtoId, x.fator, x.tipo, ctx.user.id]);
    // ROW COUNT SOB RLS: zero linha seria o vínculo "lembrado" sem efeito.
    if (u.rowCount !== 1) throw err("CONCURRENCY_CONFLICT", "O vínculo do produto do fornecedor mudou durante a geração: tente de novo.");
  }
}

/**
 * GERAR A COMPRA — dentro da transação da rota, sob a chave de idempotência. Nada é gravado antes de todas as
 * conferências; um throw desfaz tudo (importação pendente, zero compra, zero vínculo). NUNCA confirma a compra.
 */
async function gerarCompra(app: FastifyInstance, ctxDaRota: ServiceCtx, id: string, corpo: GerarEntrada): Promise<CompraGeradaDaNota> {
  // 1) a importação travada; decidida → 409.
  const imp: ImportacaoLida = await lerImportacao(ctxDaRota, id, { lock: true });
  if (imp.situacao === "gerada") throw err("CONFLICT", msgImportacaoGerada(imp.documento_compra_codigo ?? ""));
  if (imp.situacao === "descartada") throw err("CONFLICT", MSG_IMPORTACAO_DESCARTADA);
  // A empresa de trabalho da geração é a da importação (no escopo do módulo — conferido de novo por `lancar`).
  const ctx: ServiceCtx = { ...ctxDaRota, empresaId: imp.empresa_id };
  // 2) a nota do XML GUARDADO: os valores vêm sempre daqui.
  const nota = notaDaImportacao(imp);
  // 3) o fornecedor é um dos candidatos do emitente e é do tipo Fornecedor.
  resolverParceiro(await candidatosDoEmitente(ctx, nota), corpo.fornecedor_id);
  // 4) as linhas (cada item da nota uma vez; produto; rastro/lote; fator).
  const linhas = await linhasDaCompra(ctx, nota, corpo);
  const linhaParaCorpo = linhas.map((l) => l.corpo);
  // 5) os totais da nota: o que a compra não representa, e o total calculado contra o vNF.
  const naoSuportados = valoresNaoSuportadosDaNota(nota);
  if (naoSuportados.length) throw recusa("total", mensagemNaoSuportado(naoSuportados[0]!));
  const cabecalho = cabecalhoDaNota(nota);
  const totais = totaisDaCompra(linhas.map((l) => ({ quantidade: l.linha.quantidade, valorUnitario: l.linha.valorUnitario, desconto: l.linha.desconto })), cabecalho);
  if (!conferirTotalDaNota(totais.total, nota.totais.nota).confere) {
    throw recusa("total", `O total calculado (${totais.total}) não bate com o total da nota (${money(nota.totais.nota)}).`);
  }
  // 6) o pedido (com a capacidade de receber), a solicitação e a DF-e ligada.
  const f = corpo.financeiro;
  const comPedido = Boolean(corpo.pedido_id);
  if (comPedido) requirePermission(ctx, PERMISSAO_RECEBER_PEDIDO);
  corpo.itens.forEach((b, i) => {
    if (comPedido && !b.item_origem_id) throw recusa(`itens[${i}].item_origem_id`, "Com pedido, ligue cada item da nota a um item do pedido.");
    if (!comPedido && b.item_origem_id) throw recusa(`itens[${i}].item_origem_id`, "Sem pedido, o item não tem item do pedido.");
  });
  const pedidoEscolhido = corpo.pedido_id ? await pedidoDaImportacao(ctx, corpo.pedido_id, imp.empresa_id, corpo.fornecedor_id) : null;
  if (corpo.solicitacao_compra_id) await conferirSolicitacao(ctx, corpo.solicitacao_compra_id, imp.empresa_id);
  // A TRAVA DA CHAVE antes da DF-e: a mesma ordem da nota antiga com `dfe_id` (o gatilho da 0047 trava a chave no
  // INSERT, depois o UPDATE da DF-e) — duas ordens opostas sobre as mesmas travas seriam um deadlock possível.
  await travarChaveDeAcesso(ctx, nota.chave);
  const dfe = await dfeDaNota(ctx, imp, { lock: true });
  if (imp.origem === "dfe" && !dfe) throw naoEncontrada();
  if (dfe && dfe.launch_status !== "pending") throw err("CONFLICT", MSG_DFE_MUDOU);
  // 7) o financeiro: as parcelas da nota (só quando conferem) ou a condição (padrão: a do pedido escolhido).
  let parcelasNota: ExtrasDaNotaImportada["parcelasNota"] = null;
  if (f.parcelas === "nota") {
    if (f.condicao_pagamento_id) throw recusa("financeiro.condicao_pagamento_id", "Com as parcelas da nota, não informe a condição de pagamento.");
    if (f.data_vencimento) throw recusa("financeiro.data_vencimento", "Com as parcelas da nota, o vencimento é o das duplicatas.");
    const p = parcelasDaNota(nota, totais.total);
    if (p.situacao !== "conferem") {
      throw recusa("financeiro.parcelas", p.situacao === "sem_duplicatas"
        ? "A nota não traz duplicatas: use a condição de pagamento."
        : "As duplicatas da nota não conferem com o total: use a condição de pagamento.");
    }
    parcelasNota = p.parcelas.map((x) => ({ numero: x.numero, vencimento: x.vencimento, valor: x.valor }));
  }
  const condicao = f.parcelas === "condicao" ? (f.condicao_pagamento_id ?? pedidoEscolhido?.condicaoPagamentoId ?? null) : null;
  const rateio = f.rateio;
  // 8) o documento de compra COMO SERÁ GRAVADO, e os extras da nota (um por linha, na ordem).
  const porNItem = new Map(nota.itens.map((i) => [i.nItem, i]));
  const d: DocumentoCompraEntrada = {
    empresa_id: imp.empresa_id, tipo_operacao_id: corpo.tipo_operacao_id, fornecedor_id: corpo.fornecedor_id, transportadora_id: corpo.transportadora_id ?? null,
    data_documento: nota.dataEmissao, data_entrada: corpo.data_entrada ?? null, data_vencimento: f.data_vencimento ?? null,
    numero_nota: nota.numero, serie_nota: nota.serie,
    categoria_financeira_id: rateio.tipo === "documento" ? rateio.categoria_financeira_id ?? null : null,
    centro_custo_id: rateio.tipo === "documento" ? rateio.centro_custo_id ?? null : null,
    condicao_pagamento_id: condicao, plano_parcelas: null, forma_pagamento_id: f.forma_pagamento_id ?? null,
    frete: cabecalho.frete, outras_despesas: cabecalho.outras, desconto: cabecalho.desconto, observacao: corpo.observacao ? corpo.observacao : null,
    itens: linhas.map(({ corpo: i, produtoId, linha }) => {
      const b = corpo.itens[i]!;
      return {
        produto_id: produtoId, armazem_id: b.armazem_id ?? null, quantidade: linha.quantidade, valor_unitario: linha.valorUnitario,
        desconto: linha.desconto, desconto_percentual: "0", lote: linha.lote, validade: linha.validade, observacao: null,
        gera_estoque: b.gera_estoque ?? true, imobilizado: b.imobilizado ?? false,
        categoria_financeira_id: b.categoria_financeira_id ?? null, centro_custo_id: b.centro_custo_id ?? null,
        valor_ipi: linha.ipi, valor_icms_st: linha.icmsSt,
      };
    }),
    chave_acesso: nota.chave, uf_nota: /^[A-Z]{2}$/.test(nota.ufEmitente) ? nota.ufEmitente : null, tipo_documento_fiscal: "nfe",
    valor_ipi: cabecalho.ipi, valor_icms_st: cabecalho.icmsSt, seguro: cabecalho.seguro,
    tipo_titulo_id: f.tipo_titulo_id ?? null, classificacao_gasto: f.classificacao_gasto ?? null,
    rateio: rateio.tipo === "documento" ? null
      : rateio.tipo === "por_valor" ? { tipo: "por_valor", linhas: rateio.linhas.map((l) => ({ ...l, conta_contabil_id: l.conta_contabil_id ?? null, safra_id: l.safra_id ?? null })) }
        : { tipo: "por_produto" },
  };
  const extras: ExtrasDaNotaImportada = {
    dfeId: dfe?.id ?? null, solicitacaoCompraId: corpo.solicitacao_compra_id ?? null, parcelasNota,
    itens: linhas.map(({ corpo: i, nItem, linha }) => {
      const item = porNItem.get(nItem)!; const b = corpo.itens[i]!;
      return { nItemNota: nItem, codigoProdutoNota: item.codigo, descricaoProdutoNota: item.descricao, unidadeNota: normalizarUnidadeDaNota(item.unidade),
        quantidadeNota: linha.quantidadeNota, fatorConversao: D(b.fator).toFixed(6), tipoFatorConversao: b.tipo_fator };
    }),
  };
  const execucao = app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED;

  // 9) lançar: sem pedido, a compra de sempre; com pedido, entre as duas metades do receber (itens AGREGADOS por item
  //    do pedido — duas linhas de lote do mesmo item somam). NUNCA a confirmação automática.
  let compra: { id: string; codigo: string; valor_itens: string; valor_total: string };
  if (corpo.pedido_id) {
    const agregados: ItemDoRecebimento[] = []; const corpoDoAgregado: number[] = []; const posicao = new Map<string, number>();
    for (const l of linhas) {
      const k = posicao.get(l.itemOrigemId!);
      if (k === undefined) { posicao.set(l.itemOrigemId!, agregados.length); agregados.push({ itemOrigemId: l.itemOrigemId!, quantidade: l.linha.quantidade }); corpoDoAgregado.push(l.corpo); }
      else agregados[k] = { itemOrigemId: l.itemOrigemId!, quantidade: D(agregados[k]!.quantidade).plus(D(l.linha.quantidade)).toFixed(4) };
    }
    const preparado = await comCaminhosDoCorpo(corpoDoAgregado, () => prepararRecebimentoDoPedido(ctx, corpo.pedido_id!, corpo.tipo_operacao_id, agregados));
    const produtoDoItem = new Map(preparado.pedido.itens.map((i) => [i.id, i.produto_id]));
    for (const l of linhas) {
      if (produtoDoItem.get(l.itemOrigemId!) !== l.produtoId) throw recusa(`itens[${l.corpo}].item_origem_id`, "O produto deste item não é o do item do pedido.");
    }
    const origem: OrigemDoLancamento = { documentoId: corpo.pedido_id, itemOrigemIds: linhas.map((l) => l.itemOrigemId!) };
    compra = await comCaminhosDoCorpo(linhaParaCorpo, () => lancar(ctx, "compra", d, execucao, origem, extras));
    await concluirRecebimentoDoPedido(ctx, corpo.pedido_id, preparado.pedido, preparado.passo, preparado.validados, compra);
  } else {
    compra = await comCaminhosDoCorpo(linhaParaCorpo, () => lancar(ctx, "compra", d, execucao, undefined, extras));
  }

  // 10) os vínculos lembrados.
  await lembrarVinculos(ctx, nota, corpo);
  // 11) a importação gerada (ROW COUNT sob RLS).
  const u = await ctx.tx.query(
    `update erp.importacoes_nfe_compra set situacao = 'gerada', documento_compra_id = $3, decidido_por = $4, decidido_em = now()
      where id = $1 and organization_id = $2 and situacao = 'pendente'`, [imp.id, ctx.orgId, compra.id, ctx.user.id]);
  if (u.rowCount !== 1) throw naoEncontrada();
  // 12) a DF-e ligada passa a lançada (e ganha a empresa da compra, se não tinha); ROW COUNT sob RLS.
  if (dfe) {
    const ud = await ctx.tx.query(
      `update erp.dfe_documents set launch_status = 'launched', empresa_id = coalesce(empresa_id, $3), updated_at = now()
        where id = $1 and organization_id = $2 and launch_status = 'pending'`, [dfe.id, ctx.orgId, imp.empresa_id]);
    if (ud.rowCount !== 1) throw err("CONFLICT", MSG_DFE_MUDOU);
    await audit(ctx.tx, ctx, "dfe_documents", dfe.id, "launch", { compra: compra.id, codigo: compra.codigo, importacaoId: imp.id },
      { before: { launch_status: "pending" }, after: { launch_status: "launched" } });
  }
  // 13) a auditoria da decisão.
  await audit(ctx.tx, ctx, "importacoes_nfe_compra", imp.id, "gerar_compra", { compra: compra.id, codigo: compra.codigo },
    { before: { situacao: "pendente" }, after: { situacao: "gerada", documento_compra_id: compra.id } });
  return { id: compra.id, codigo: compra.codigo, especie: "compra", situacao: "aberto", valor_itens: compra.valor_itens, valor_total: compra.valor_total, importacao_id: imp.id };
}

// ─────────────── rotas ───────────────

export default async function comprasImportacaoRoutes(app: FastifyInstance) {
  /**
   * IMPORTAR O ARQUIVO. A capacidade vem ANTES de abrir o arquivo (quem não pode lançar compra não faz o servidor
   * descompactar nada); a leitura é FORA da transação; a empresa destinatária é resolvida antes do `idempotent`.
   */
  app.post("/compras/importacoes", { bodyLimit: LIMITE_DO_CORPO }, async (req, reply) => {
    requirePermission(app.requireCtx(req), PERMISSAO);
    const d = importarSchema.parse(req.body);
    const arquivo = lerArquivo(d.nome_arquivo, d.arquivo_base64);
    const conferencia = await runService(app, req, PERMISSAO, async (ctx) => {
      const empresa = await resolverDestinatario(ctx, arquivo.nota, d.empresa_id ?? null);
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        { action: "importar_nfe_compra", nomeArquivo: d.nome_arquivo, arquivoSha256: arquivo.sha256, empresaId: d.empresa_id ?? null, actorId: ctx.user.id },
        () => criarImportacao(ctx, { nota: arquivo.nota, empresaId: empresa.id, origem: "arquivo", dfeId: null,
          xml: { texto: arquivo.texto, nomeArquivo: arquivo.nomeArquivo } }))).result;
    });
    return reply.status(201).send(conferencia);
  });

  /**
   * O "LANÇAR" DA DF-e: a importação do XML que a fila GUARDOU. `compras.create` (a porta) ∧ `dfe.launch`. A DF-e
   * inexistente, de outro tenant, fora do escopo (no módulo da DF-e E no de compras, pela RLS) ou com id malformado:
   * a MESMA 404. Sem XML → 422; lançada, ignorada ou em aprovação → 409. A empresa é a do XML guardado (a destinatária
   * resolvida ao registrar); a do corpo é pedido e tem de ser ela.
   */
  app.post("/compras/importacoes/da-dfe/:dfeId", async (req, reply) => reply.status(201).send(await runService(app, req, PERMISSAO, async (ctx) => {
    requirePermission(ctx, PERMISSAO_DFE);
    const dfeId = (req.params as { dfeId: string }).dfeId.toLowerCase();
    const d = daDfeSchema.parse(req.body ?? {});
    if (!FORMA_UUID.test(dfeId)) throw naoEncontradaDfe();
    const lida = await consultaEscopada<{ id: string; launch_status: string; xml_id: string | null; xml_original: string | null; xml_empresa_id: string | null }>(ctx,
      `select d.id::text as id, d.launch_status, d.xml_id::text as xml_id, x.xml_original, x.empresa_id::text as xml_empresa_id
         from erp.dfe_documents d
         left join erp.notas_fiscais_xml x on x.id = d.xml_id and x.organization_id = d.organization_id
        where d.id = $1 and d.organization_id = $2 and {{escopo_nulo:d.empresa_id}}`, [dfeId, ctx.orgId], { modulo: moduloDaPermissao(PERMISSAO_DFE) });
    const dfe = lida.rows[0];
    if (!dfe) throw naoEncontradaDfe();
    if (!dfe.xml_id || !dfe.xml_original || !dfe.xml_empresa_id) throw recusa("dfe", MSG_DFE_SEM_XML);
    if (dfe.launch_status === "launched") throw err("CONFLICT", MSG_DFE_LANCADA);
    if (dfe.launch_status === "ignored") throw err("CONFLICT", MSG_DFE_IGNORADA);
    if (dfe.launch_status === "draft") throw err("CONFLICT", MSG_DFE_EM_APROVACAO);
    const nota = recusaDaLeitura(dfe.xml_original, "dfe");
    if (d.empresa_id && d.empresa_id !== dfe.xml_empresa_id) throw recusa("empresa_id", "O destinatário desta nota não é uma empresa em que você pode lançar compras.");
    const empresa = await resolverDestinatario(ctx, nota, dfe.xml_empresa_id);
    return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
      { action: "importar_nfe_compra_da_dfe", sourceId: dfeId, corpo: d, actorId: ctx.user.id },
      () => criarImportacao(ctx, { nota, empresaId: empresa.id, origem: "dfe", dfeId, xml: { id: dfe.xml_id! } }))).result;
  })));

  /** A CONFERÊNCIA. Query estrita: só `fornecedor_id` (uuid); outro parâmetro ou repetido = 422. */
  app.get("/compras/importacoes/:id", async (req) => runService(app, req, PERMISSAO, async (ctx) => {
    const bruta = (req.query ?? {}) as Record<string, unknown>;
    for (const [chave, valor] of Object.entries(bruta)) if (Array.isArray(valor)) throw recusa(chave, "Parâmetro repetido: informe um valor só");
    const q = conferenciaQuerySchema.parse(bruta);
    const imp = await lerImportacao(ctx, (req.params as { id: string }).id);
    return montarConferencia(ctx, imp, q.fornecedor_id ?? null);
  }));

  /** GERAR A COMPRA (aberta). Corpo conferido antes de tudo; a importação visível ANTES do `idempotent`. */
  app.post("/compras/importacoes/:id/gerar-compra", async (req, reply) => reply.status(201).send(await runService(app, req, PERMISSAO, async (ctx) => {
    const id = (req.params as { id: string }).id.toLowerCase();
    const corpo = gerarSchema.parse(req.body);
    await lerImportacao(ctx, id);
    return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
      { action: "gerar_compra_da_nfe", sourceId: id, corpo, actorId: ctx.user.id },
      () => gerarCompra(app, ctx, id, corpo))).result;
  })));

  /** DESCARTAR a importação pendente (nunca apagada: a linha fica, descartada). */
  app.post("/compras/importacoes/:id/descartar", async (req) => runService(app, req, PERMISSAO, async (ctx) => {
    const id = (req.params as { id: string }).id.toLowerCase();
    descartarSchema.parse(req.body ?? {});
    await lerImportacao(ctx, id);
    return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
      { action: "descartar_importacao_nfe", sourceId: id, actorId: ctx.user.id },
      async () => {
        const imp = await lerImportacao(ctx, id, { lock: true });
        if (imp.situacao === "gerada") throw err("CONFLICT", msgImportacaoGerada(imp.documento_compra_codigo ?? ""));
        if (imp.situacao === "descartada") throw err("CONFLICT", MSG_IMPORTACAO_DESCARTADA);
        // O escopo de empresa também no SQL (a selecionada não estreita: a importação é da empresa destinatária). A
        // tabela com ALIAS: sem ele, `empresa_id` dentro do `exists` do escopo seria a coluna de erp.membro_empresas
        // (a subconsulta resolve o nome mais perto) e o predicado não amarraria esta linha.
        const params: unknown[] = [id, ctx.orgId, ctx.user.id];
        const u = await ctx.tx.query(
          `update erp.importacoes_nfe_compra i set situacao = 'descartada', decidido_por = $3, decidido_em = now()
            where i.id = $1 and i.organization_id = $2 and i.situacao = 'pendente'${empresaScopeSql(ctx, "i", params, { ignoreSelected: true })}`, params);
        // ROW COUNT SOB RLS: zero linha seria "descartada" sem efeito.
        if (u.rowCount !== 1) throw naoEncontrada();
        await audit(ctx.tx, ctx, "importacoes_nfe_compra", id, "descartar", undefined, { before: { situacao: "pendente" }, after: { situacao: "descartada" } });
        return { id, situacao: "descartada" as const };
      })).result;
  }));
}
