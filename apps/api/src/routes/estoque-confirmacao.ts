/**
 * ═══ PORTAL DE ESTOQUE — PRÉVIA, CONFIRMAÇÃO e CANCELAMENTO do documento de estoque (ESTOQUE-01, decisão 274) ═══
 *
 * O documento nasce ABERTO e só mexe no saldo quando é CONFIRMADO. O movimento é o da ESPÉCIE (a execução
 * configurada da TOP fica fora desta fatia), com os tipos que o ledger já conhece (`MOVIMENTOS_DA_ESPECIE_ESTOQUE`):
 *   · entrada → `entry`, pelo custo informado, com o lote e a validade do item;
 *   · saída → `writeoff`, pelo custo médio; lote informado ou escolhido pela validade (decisão 254: vencido só sai
 *     informado — quem cumpre é o `postStock`);
 *   · transferência → `transfer_out` na origem e, PARTE POR PARTE, `transfer_in` no destino com o MESMO custo,
 *     lote e validade (o molde da transferência de `stock.ts`);
 *   · ajuste → `correction_in` / `correction_out` pela diferença entre o CONTADO e o saldo lido SOB TRAVA; zero
 *     não move nada.
 * O cancelamento do confirmado estorna TODOS os movimentos (`reverseStock`), depois de conferir que o que o
 * documento deu de entrada ainda está no saldo.
 *
 * MOVIMENTAÇÃO INTERNA (OPERACOES-01 F5a, decisão 282):
 *   · requisição → NENHUM movimento: confirmar a requisição RESERVA no local de estoque (a parte C da reserva, 0043).
 *     Sem período (não mexe no razão). Os produtos são travados (a trava do pedido com reserva, `SQL_TRAVA_PRODUTOS`)
 *     e o pedido de cada produto é conferido contra o DISPONÍVEL (físico − reservado pelos outros); faltou → 422;
 *   · consumo → `requisition` (baixa), como a saída: pelo custo médio, lote informado ou escolhido pela validade;
 *   · devolução de consumo → `devolution` (volta), pelo custo do item do consumo de origem, com o lote e a validade;
 *   · entrada sem custo → o custo médio do produto (`products.average_cost`, como a devolução antiga), gravado no item;
 *   · ajuste com custo informado → a correção por ele (como a correção antiga); sem ele, como antes;
 *   · todo movimento leva o DESTINO do cabeçalho (centro de resultado, safra, máquina/equipamento, OS, lote de
 *     animais, área/talhão).
 * O cancelamento recusa (409) a requisição com consumo vivo e o consumo com devolução viva — desfaz-se de baixo para
 * cima; a requisição confirmada sem dependentes cancela SEM estorno (não tinha movimento).
 *
 * O desenho é o da confirmação da Compra (`compras-confirmacao.ts`): UMA leitura de saldos serve a prévia e a
 * conferência da confirmação — uma cópia "equivalente" para a prévia divergiria na primeira fatia que mexesse
 * numa das duas. A prévia não trava nem grava; a confirmação trava o cabeçalho (`lerDocumentoEstoque` com
 * `lock`), confere, move, grava os ITENS enquanto o cabeçalho ainda está aberto (o gatilho do item só aceita
 * documento aberto) e só então vira o cabeçalho.
 *
 * ORDEM DAS TRAVAS: cabeçalho (`for update`) → baldes do ajuste (trava consultiva, em ordem fixa) → saldo e
 * produto (pelo gatilho do movimento). Nenhuma rota de estoque trava na ordem inversa. A requisição: cabeçalho →
 * produtos (`for no key update`, em ordem de id), e nenhum saldo.
 *
 * RESERVA (TOP-CONFIG-07, 0035): a guarda mora no banco e vale para `writeoff` e `transfer_out` — saída que fere a
 * reserva de um pedido é recusada com 409 INSUFFICIENT_STOCK, o código de sempre. O `correction_out` do ajuste
 * para baixo NÃO passa pela guarda, por desenho da 0035: o inventário registra o que existe, mesmo que o físico
 * fique abaixo do prometido (o disponível pode ficar negativo — a 0035 já prevê).
 *
 * REGRAS GERAIS DA TOP (TOP-CONFIG-08, decisão 277): só a versão congelada no FORMATO 4 executa (e no 5, que
 * executa tudo o que o 4 executa — OPERACOES-01 F4, decisão 281). A confirmação ganha
 * o passo da APROVAÇÃO logo depois da situação (`recusaDoDocumento`), e a prévia ganha a lista ADITIVA `recusas`.
 * A confirmação é UMA função (`confirmarDocumentoEstoqueNaTransacao`), que a rota `/confirmar` e a confirmação
 * automática chamam — a automática só acrescenta `automatica: true` à auditoria "confirm".
 *
 * As rotas são registradas por `registrarConfirmacaoEstoque(app)`, chamada no fim do registro de
 * `estoque-documentos.ts` (prefixo `/api` vem do registro).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, qty as fqty, DomainError } from "@agro/shared";
import { regrasGeraisDaVersaoTop, versaoSchemaDaConfiguracaoTop, versaoSchemaExecutaRegrasGeraisTop, type EspecieEstoque } from "@agro/domain";
import { runService, idempotent, audit, assertPeriodOpen } from "../lib/service.js";
import { notFound, validation, err, fromPgError } from "../lib/errors.js";
import type { ServiceCtx } from "../lib/context.js";
import { lerVersaoCongeladaTop } from "../lib/confirmacao-automatica.js";
import { recusaDaAprovacao } from "../lib/aprovacao-documento.js";
import { postStock, reverseStock, currentBalance, chaveDoLote, quantidadeLegivel, type StockPost } from "../services/stock-core.js";
import { saldoComReservaEmLote, chaveDoPar } from "../services/reserva-estoque.js";
import { SQL_TRAVA_PRODUTOS } from "./vendas-reserva-estoque.js";
import {
  ESPECIES_ESTOQUE, lerDocumentoEstoque, cancelarSchema, MOTIVO_PADRAO_CANCELAMENTO,
  type DocumentoEstoqueLido, type ItemDocumentoEstoqueLido,
} from "./estoque-comum.js";

/** Versão do contrato da prévia. A web confere forma E versão antes de usar o corpo. */
export const CONTRATO_PREVIA_CONFIRMACAO_ESTOQUE = 1;

/** A origem que o ledger grava nos movimentos do documento — a mesma que o cancelamento estorna. */
const ORIGEM = "documentos_estoque";

type Recusa = { path: string; message: string };
const recusar = (message: string, details: Recusa[]) => validation(message, details);
const caminhoDoItem = (i: number, campo: string) => `itens.${i}.${campo}`;

/** `btrim` do SQL (só espaços), para comparar o lote do item com o lote GRAVADO no saldo como o banco compara. */
const aparar = (v: string) => v.replace(/^ +| +$/g, "");

// ─────────────── saldos: a leitura que a prévia e a confirmação compartilham ───────────────

type MovimentoPrevisto = "entry" | "writeoff" | "transfer" | "correction_in" | "correction_out" | null;

/** A linha da prévia — e, na confirmação, a conferência de saldo da saída e da transferência. */
export interface ItemDaPrevia {
  item_id: string;
  posicao: number;
  produto_id: string;
  produto_nome: string;
  lote: string | null;
  saldo_atual: string;
  saldo_depois: string;
  insuficiente: boolean;
  diferenca: string | null;
  movimento: MovimentoPrevisto;
}

type Decimal = ReturnType<typeof D>;

interface SaldoGravado { product_id: string; provider_lot: string; quantity: string; vencido: boolean }

/**
 * O saldo que cada item enxerga, numa consulta só (todos os produtos do documento no armazém de ORIGEM) —
 * número fixo de consultas, qualquer que seja o número de itens.
 *
 * O ESCOPO de cada item:
 *   · ajuste: o BALDE (armazém × produto × lote); sem lote, o balde sem lote (`provider_lot = ''`), que é onde
 *     a correção sem lote grava;
 *   · entrada, devolução de consumo, saída, consumo e transferência: o lote informado ou, sem lote, todos os lotes
 *     do produto no armazém;
 *   · requisição: o DISPONÍVEL do par (`planejarDisponivel`), não o físico.
 * O lote é comparado aparado (`btrim`), como `chaveDoLote` resolve a chave gravada.
 *
 * Na saída, no consumo e na transferência, dois itens do MESMO produto disputam o mesmo saldo: o segundo enxerga o
 * que o primeiro deixou (o mesmo lote, ou qualquer lote quando o item não informa lote). É uma conferência ANTES de
 * gravar, para recusar com 422 no item; a autoridade continua sendo o gatilho do movimento, que trava o saldo. O
 * consumo, como a saída, olha o FÍSICO: a reserva dos OUTROS é recusada pela guarda do banco (409), como na saída de
 * hoje — e a guarda tira da conta a parte do próprio consumo (C2).
 */
async function planejarSaldos(ctx: ServiceCtx, doc: DocumentoEstoqueLido): Promise<ItemDaPrevia[]> {
  if (doc.especie === "requisicao") return planejarDisponivel(ctx, doc);
  const produtos = [...new Set(doc.itens.map((it) => it.produto_id))];
  const r = produtos.length
    ? await ctx.tx.query<SaldoGravado>(
      `select product_id, provider_lot, quantity::text as quantity,
              (btrim(provider_lot) <> '' and expiration_date is not null and expiration_date < $4::date) as vencido
         from erp.stock_balances
        where organization_id = $1 and warehouse_id = $2 and product_id = any($3::uuid[])`,
      [ctx.orgId, doc.armazem_id, produtos, doc.data_documento])
    : { rows: [] as SaldoGravado[] };
  const saldos = r.rows;
  const soma = (filtro: (s: SaldoGravado) => boolean) => saldos.filter(filtro).reduce((a, s) => a.plus(s.quantity), D(0));
  const doProduto = (produto: string) => (s: SaldoGravado) => s.product_id === produto;
  // SAÍDA/TRANSFERÊNCIA SEM LOTE: o lote VENCIDO na data do documento não entra na escolha automática (decisão 254 —
  // vencido só sai informado). Contá-lo aqui diria "cabe" e o postStock recusaria depois com 409; sem ele, a falta é
  // o "saldo insuficiente" de sempre: 422 no item, na prévia e na confirmação.
  const doProdutoEscolhivel = (produto: string) => (s: SaldoGravado) => s.product_id === produto && !s.vencido;
  const doLote = (produto: string, lote: string) => (s: SaldoGravado) => s.product_id === produto && aparar(s.provider_lot) === lote;

  // O que os itens anteriores já tiraram: por produto (todos os lotes) e por produto × lote.
  const tiradoDoProduto = new Map<string, Decimal>();
  const tiradoDoLote = new Map<string, Decimal>();
  const chaveLote = (produto: string, lote: string) => `${produto}\u0000${lote}`;

  return doc.itens.map((it): ItemDaPrevia => {
    const base = { item_id: it.id, posicao: it.posicao, produto_id: it.produto_id, produto_nome: it.produto_nome, lote: it.lote };
    if (doc.especie === "ajuste") {
      const atual = it.lote ? soma(doLote(it.produto_id, it.lote)) : soma((s) => s.product_id === it.produto_id && s.provider_lot === "");
      const contada = D(it.quantidade_contada ?? "0");
      const diferenca = contada.minus(atual);
      return { ...base, saldo_atual: fqty(atual), saldo_depois: fqty(contada), insuficiente: false, diferenca: fqty(diferenca),
        movimento: diferenca.gt(0) ? "correction_in" : diferenca.lt(0) ? "correction_out" : null };
    }
    const q = D(it.quantidade ?? "0");
    if (doc.especie === "entrada" || doc.especie === "devolucao_consumo") {
      const atual = it.lote ? soma(doLote(it.produto_id, it.lote)) : soma(doProduto(it.produto_id));
      return { ...base, saldo_atual: fqty(atual), saldo_depois: fqty(atual.plus(q)), insuficiente: false, diferenca: null, movimento: "entry" };
    }
    // saída, consumo e transferência: o saldo da ORIGEM, menos o que os itens anteriores do documento já tiraram.
    const tiradoProduto = tiradoDoProduto.get(it.produto_id) ?? D(0);
    const atual = it.lote
      ? soma(doLote(it.produto_id, it.lote)).minus(tiradoDoLote.get(chaveLote(it.produto_id, it.lote)) ?? D(0))
      : soma(doProdutoEscolhivel(it.produto_id)).minus(tiradoProduto);
    const depois = atual.minus(q);
    tiradoDoProduto.set(it.produto_id, tiradoProduto.plus(q));
    if (it.lote) tiradoDoLote.set(chaveLote(it.produto_id, it.lote), (tiradoDoLote.get(chaveLote(it.produto_id, it.lote)) ?? D(0)).plus(q));
    // O consumo se mostra como a saída ("writeoff"): a prévia diz que o saldo SAI; o tipo gravado no razão é
    // `requisition` (MOVIMENTOS_DA_ESPECIE_ESTOQUE). A lista de `movimento` da prévia não muda (a tela anterior a lê fechada).
    return { ...base, saldo_atual: fqty(atual), saldo_depois: fqty(depois), insuficiente: depois.lt(0), diferenca: null,
      movimento: doc.especie === "transferencia" ? "transfer" : "writeoff" };
  });
}

/**
 * O DISPONÍVEL QUE A REQUISIÇÃO ENXERGA — a base da prévia e da confirmação dela (o físico de TODOS os lotes do par
 * menos o reservado pelos OUTROS documentos: pedidos com reserva, vendas geradas deles, outras requisições pendentes e
 * consumos abertos que as atendem). Duas consultas (físico e reservado, pela porta da 0035/0043), qualquer que seja o
 * número de itens. Dois itens do MESMO produto disputam o mesmo disponível: o segundo enxerga o que o primeiro pediu.
 * `movimento: null` — a requisição não move o razão; ela reserva.
 */
async function planejarDisponivel(ctx: ServiceCtx, doc: DocumentoEstoqueLido): Promise<ItemDaPrevia[]> {
  const pares = [...new Set(doc.itens.map((it) => it.produto_id))].map((productId) => ({ warehouseId: doc.armazem_id, productId }));
  const saldos = await saldoComReservaEmLote(ctx, pares, doc.id);
  const pedido = new Map<string, Decimal>();
  return doc.itens.map((it): ItemDaPrevia => {
    const chave = chaveDoPar(doc.armazem_id, it.produto_id);
    const antes = pedido.get(chave) ?? D(0);
    // Par sem saldo lido não existe (o físico devolve uma linha por par pedido); se existisse, valeria 0 — fail closed.
    const atual = D(saldos.get(chave)?.disponivel ?? "0").minus(antes);
    const q = D(it.quantidade ?? "0");
    pedido.set(chave, antes.plus(q));
    const depois = atual.minus(q);
    return { item_id: it.id, posicao: it.posicao, produto_id: it.produto_id, produto_nome: it.produto_nome, lote: it.lote,
      saldo_atual: fqty(atual), saldo_depois: fqty(depois), insuficiente: depois.lt(0), diferenca: null, movimento: null };
  });
}

// ─────────────── as recusas do DOCUMENTO: a versão congelada da TOP e a aprovação ───────────────

/**
 * ═══ A RECUSA DO DOCUMENTO (TOP-CONFIG-08, decisão 277) ═══ — o que a versão congelada da TOP decide sobre ESTE
 * documento antes de qualquer efeito. UMA função para a prévia (que ANOTA) e para a confirmação (que LANÇA): uma
 * cópia "equivalente" na prévia divergiria na primeira fatia que mexesse numa das duas.
 *
 *   · a configuração é lida AQUI, numa consulta própria (`lerVersaoCongeladaTop`): a leitura do documento
 *     (`lerDocumentoEstoque`) serve também o GET, a lista e o cancelamento, e não muda por causa da aprovação;
 *   · versão ilegível (formato desconhecido, ou formato 4 ou 5 malformado) → 409 TIPO_OPERACAO_EXECUCAO_INDISPONIVEL,
 *     como na compra: ninguém sabe o que ela decidiu, e "então é o neutro" seria adivinhar;
 *   · sem TOP, ou formato 1, 2 ou 3 → nenhuma recusa: o corte da 277, só o formato 4 ou 5 executa a aprovação;
 *   · formato 4 ou 5 com aprovação exigida e não vigente → 409 APROVACAO_PENDENTE ou APROVACAO_REPROVADA. O valor do
 *     documento de estoque só é conhecido na confirmação (`valorDocumento: null`), e por isso a matriz só lhe
 *     aceita "Sempre".
 * A guarda do banco (0041, `trg_documentos_estoque_aprovacao`) é o fundo, inclusive para o binário anterior; quem
 * EXPLICA a recusa é este passo. Número fixo de consultas, qualquer que seja o número de itens.
 */
async function recusaDoDocumento(ctx: ServiceCtx, doc: DocumentoEstoqueLido): Promise<{ recusa: DomainError | null; alemDoFormato3: boolean }> {
  const versaoTop = await lerVersaoCongeladaTop(ctx, doc.tipo_operacao_versao_id);
  const regras = regrasGeraisDaVersaoTop(versaoTop);
  if (!regras.ok) {
    // O molde da compra (`politicaDaCompra`): o mesmo código, a mesma forma de details.
    return {
      recusa: new DomainError("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL",
        "A configuração da operação deste documento está num formato que este servidor não executa. O documento não foi confirmado.",
        { motivo: regras.motivo, recusas: [] }),
      alemDoFormato3: true,
    };
  }
  // O PORTÃO do domínio (formato 4 ou 5), nunca a comparação com um número: o 5 executa tudo o que o 4 executa
  // (OPERACOES-01 F4, decisão 281), e a prévia de um documento com a versão no 5 continua trazendo `recusas`.
  const alemDoFormato3 = versaoTop !== null && versaoSchemaExecutaRegrasGeraisTop(versaoSchemaDaConfiguracaoTop(versaoTop.configuracao));
  return { recusa: await recusaDaAprovacao(ctx, { modulo: "estoque", documentoId: doc.id, versaoDocumento: null, valorDocumento: null, versaoTop }), alemDoFormato3 };
}

// ─────────────── prévia ───────────────

/**
 * A recusa da prévia — a forma do `toJSON` do erro, a MESMA das recusas da prévia da compra e da venda (o corpo
 * que a confirmação daria).
 */
interface RecusaDaPrevia { code: string; message: string; details?: unknown }

/**
 * `recusas` (TOP-CONFIG-08) é ADITIVO: as recusas do DOCUMENTO (a versão ilegível e a aprovação), lista vazia quando
 * não há. A chave só existe quando a versão congelada está no formato 4 ou 5 (ou é ilegível): sem TOP e nos formatos
 * 1, 2 e 3 a resposta é a de hoje, chave por chave — o corte da 277 vale também para o corpo. Com recusa, `podeConfirmar`
 * é falso — a confirmação recusaria do mesmo jeito. Nenhuma outra chave muda, e `contractVersion` continua 1: a web
 * anterior ignora a chave nova.
 *
 * `baseDoSaldo: "disponivel"` (OPERACOES-01 F5a) é ADITIVO e só da REQUISIÇÃO: o saldo da prévia dela é o disponível,
 * não o físico. As quatro espécies de antes respondem o corpo de hoje, chave por chave.
 */
async function previaDaConfirmacao(ctx: ServiceCtx, id: string, especie: EspecieEstoque) {
  const doc = await lerDocumentoEstoque(ctx, id, especie);
  if (doc.situacao !== "aberto") throw err("CONFLICT", "O documento não está aberto");
  const { recusa, alemDoFormato3 } = await recusaDoDocumento(ctx, doc);
  const recusas: RecusaDaPrevia[] = recusa ? [recusa.toJSON()] : [];
  const itens = await planejarSaldos(ctx, doc);
  return {
    contractVersion: CONTRATO_PREVIA_CONFIRMACAO_ESTOQUE,
    documento: { id: doc.id, especie: doc.especie, situacao: doc.situacao, codigo: doc.codigo },
    podeConfirmar: !itens.some((i) => i.insuficiente) && recusas.length === 0,
    itens,
    ...(doc.especie === "requisicao" ? { baseDoSaldo: "disponivel" as const } : {}),
    ...(alemDoFormato3 ? { recusas } : {}),
  };
}

// ─────────────── confirmação ───────────────

/**
 * O PERÍODO pela data do documento — a mesma conferência da entrada avulsa (`stock.ts`). O período congelado
 * sai do banco como 409 PERIOD_FROZEN; aqui ele é um defeito DO DOCUMENTO (a data), e por isso vira 422 no campo
 * `data_documento`, com a mensagem do período. A transação inteira é desfeita pela recusa: nada foi gravado.
 */
async function conferirPeriodo(ctx: ServiceCtx, doc: DocumentoEstoqueLido): Promise<void> {
  try {
    await assertPeriodOpen(ctx.tx, ctx.orgId, doc.empresa_id, doc.data_documento);
  } catch (e) {
    const recusa = e instanceof DomainError ? e : fromPgError(e);
    if (!recusa) throw e;
    if (recusa.httpStatus === 422) throw recusa;
    throw recusar(recusa.message, [{ path: "data_documento", message: recusa.message }]);
  }
}

interface ProdutoAtual { id: string; is_active: boolean; control_stock: boolean; controle: string; nome: string; custo_medio: string }

/**
 * O CADASTRO DE HOJE — entre o lançamento e a confirmação o produto pode ter sido inativado, excluído, deixado de
 * controlar estoque ou passado a controlar lote, e o armazém pode ter sido inativado. Tudo conferido junto, em duas
 * consultas, e recusado com 422 no campo — nunca o 500 que o `postStock` daria no meio da confirmação. A mesma
 * leitura traz o custo médio consolidado do produto (`products.average_cost`): o custo da entrada sem custo e o da
 * devolução de consumo cujo consumo não tem custo gravado (OPERACOES-01 F5a, "como a devolução antiga").
 */
async function conferirCadastros(ctx: ServiceCtx, doc: DocumentoEstoqueLido): Promise<Map<string, ProdutoAtual>> {
  const recusas: Recusa[] = [];
  const armazens = [doc.armazem_id, ...(doc.armazem_destino_id ? [doc.armazem_destino_id] : [])];
  const w = await ctx.tx.query<{ id: string }>(
    "select id from erp.warehouses where id = any($1::uuid[]) and organization_id = $2 and empresa_id = $3 and deleted_at is null and is_active",
    [armazens, ctx.orgId, doc.empresa_id]);
  const ativos = new Set(w.rows.map((x) => x.id));
  const msgArmazem = "Local de estoque inativo ou excluído desde o lançamento: reative-o no cadastro ou cancele o documento";
  if (!ativos.has(doc.armazem_id)) recusas.push({ path: "armazem_id", message: msgArmazem });
  if (doc.armazem_destino_id && !ativos.has(doc.armazem_destino_id)) recusas.push({ path: "armazem_destino_id", message: msgArmazem });

  const p = await ctx.tx.query<ProdutoAtual>(
    `select id, is_active, control_stock, p.code || ' - ' || p.description as nome, p.average_cost::text as custo_medio,
            coalesce(to_jsonb(p)->>'controle_lote', case when p.has_lot then 'lote' else 'nenhum' end) as controle
       from erp.products p where id = any($1::uuid[]) and organization_id = $2 and deleted_at is null`,
    [[...new Set(doc.itens.map((it) => it.produto_id))], ctx.orgId]);
  const produtos = new Map(p.rows.map((x) => [x.id, x]));
  doc.itens.forEach((it, i) => {
    const prod = produtos.get(it.produto_id);
    const no = (campo: string, message: string) => recusas.push({ path: caminhoDoItem(i, campo), message });
    if (!prod) return no("produto_id", "Produto excluído desde o lançamento: cancele o documento");
    if (!prod.is_active) return no("produto_id", "Produto inativo desde o lançamento: reative-o no cadastro ou cancele o documento");
    if (!prod.control_stock) return no("produto_id", "O produto deixou de controlar estoque desde o lançamento: cancele o documento");
    // Entrada, devolução de consumo e ajuste gravam UM lote: produto que passou a controlar lote depois do lançamento
    // não tem para onde ir.
    const entra = doc.especie === "entrada" || doc.especie === "devolucao_consumo";
    if ((entra || doc.especie === "ajuste") && prod.controle !== "nenhum" && !it.lote) {
      no("lote", "O produto passou a controlar lote desde o lançamento e o item não tem lote: cancele o documento e lance de novo com o lote");
    }
    if (entra && prod.controle === "lote_validade" && !it.validade) {
      no("validade", "O produto passou a controlar validade desde o lançamento e o item não tem validade: cancele o documento e lance de novo com a validade");
    }
  });
  if (recusas.length) throw recusar(recusas[0]!.message, recusas);
  return produtos;
}

/** Grava no item o que só a confirmação conhece. Com o cabeçalho ainda ABERTO (o gatilho do item exige). */
async function gravarItem(ctx: ServiceCtx, item: ItemDocumentoEstoqueLido, campos: { custo: string | null; saldo?: string | null; diferenca?: string | null }) {
  const u = await ctx.tx.query(
    "update erp.documentos_estoque_itens set custo_unitario = $3, saldo_na_confirmacao = $4, diferenca = $5 where id = $1 and organization_id = $2",
    [item.id, ctx.orgId, campos.custo, campos.saldo ?? null, campos.diferenca ?? null]);
  // ROW COUNT sob RLS: zero linhas seria "sucesso sem efeito".
  if (u.rowCount !== 1) throw notFound("Documento");
}

/**
 * ═══ A TRAVA DO AJUSTE ═══ — o ÚNICO lugar em que o balde (armazém × produto × lote) do ajuste é travado.
 *
 * Trava CONSULTIVA de transação, e não `for update` na linha de saldo, porque o balde pode ainda NÃO EXISTIR (a
 * contagem de um lote novo): não há linha para travar, e dois ajustes do mesmo lote novo passariam juntos. A chave
 * é o texto do balde (o lote APARADO do item, como o banco o guarda no documento), na organização.
 *
 * O caso que ela fecha: dois ajustes simultâneos do mesmo balde. Sem a trava, os dois leem o MESMO saldo, cada um
 * grava a SUA diferença sobre ele, e o saldo final é a soma das duas correções — nem uma contagem nem a outra.
 * Com ela, o segundo espera o primeiro terminar e lê o saldo NOVO (READ COMMITTED: a leitura vem depois da
 * espera), e o resultado é a contagem do último. Tirar esta trava deixa vermelho o teste dos ajustes simultâneos
 * (ES-5; é a reversa R10).
 *
 * Quem chama trava TODOS os baldes do documento, em ordem fixa (armazém, produto, lote), ANTES de ler qualquer
 * saldo: dois ajustes que contam os mesmos baldes pegam as travas na mesma ordem e fazem fila, sem deadlock.
 */
async function travarBaldeDoAjuste(ctx: ServiceCtx, armazemId: string, produtoId: string, lote: string | null): Promise<void> {
  await ctx.tx.query(
    "select pg_advisory_xact_lock(hashtextextended('estoque-ajuste:' || $1::text || ':' || $2::text || ':' || $3::text || ':' || coalesce($4::text, ''), 0))",
    [ctx.orgId, armazemId, produtoId, lote]);
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** O texto da data de hoje (data do estorno), como as outras rotas de cancelamento. */
const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * ═══ A CONFIRMAÇÃO DO DOCUMENTO — a ÚNICA (TOP-CONFIG-08, decisão 277) ═══
 *
 * Serve a rota `/confirmar` (`automatica: false`) e a CONFIRMAÇÃO AUTOMÁTICA (`automatica: true`), que o POST do
 * documento e a aprovação chamam no fim do caminho, dentro do savepoint de `tentarConfirmacaoAutomatica`. Não
 * existe segundo caminho de confirmação: o mesmo planejamento, as mesmas recusas, os mesmos efeitos e a mesma
 * auditoria "confirm". A única diferença é a chave `automatica: true` no metadata da auditoria, que só a automática
 * grava — a auditoria da confirmação manual continua idêntica, chave por chave.
 *
 * Roda na transação de quem chama (sem `runService` próprio): a capacidade (`<recurso>.edit`) e a visibilidade são
 * conferidas por quem chama, antes.
 */
export async function confirmarDocumentoEstoqueNaTransacao(ctx: ServiceCtx, especie: EspecieEstoque, id: string, o: { automatica: boolean }) {
  // 1ª TRAVA: o cabeçalho. A segunda confirmação espera aqui e relê a situação nova (409, sem efeito).
  const doc = await lerDocumentoEstoque(ctx, id, especie, { lock: true });
  if (doc.situacao === "cancelado") throw err("ALREADY_CANCELLED", "O documento está cancelado");
  if (doc.situacao !== "aberto") throw err("CONFLICT", "O documento já está confirmado");
  // APROVAÇÃO (TOP-CONFIG-08): logo depois da situação, antes do período, dos cadastros e de qualquer efeito. Na
  // automática, a APROVACAO_PENDENTE vira "aguardando_aprovacao" (`tentarConfirmacaoAutomatica`).
  const { recusa } = await recusaDoDocumento(ctx, doc);
  if (recusa) throw recusa;
  // A requisição não move o razão: o período (que fecha o razão) não é dela (OPERACOES-01 F5a).
  if (doc.especie !== "requisicao") await conferirPeriodo(ctx, doc);
  const produtos = await conferirCadastros(ctx, doc);

  const nota = `Documento de estoque ${doc.codigo}`;
  const comum: ComumDoMovimento = {
    empresaId: doc.empresa_id, sourceType: ORIGEM, sourceId: doc.id, date: doc.data_documento, note: nota,
    // O DESTINO do cabeçalho vai em TODO movimento do documento (nulo nas espécies sem destino — o CHECK da 0043).
    costCenterId: doc.centro_custo_id, harvestId: doc.safra_id, equipamentoId: doc.equipamento_id,
    ordemServicoId: doc.ordem_servico_id, loteAnimaisId: doc.lote_animais_id, areaId: doc.area_id,
  };
  let movimentos = 0;

  if (doc.especie === "requisicao") {
    await reservarRequisicao(ctx, doc);
  } else if (doc.especie === "entrada" || doc.especie === "devolucao_consumo") {
    // O custo da ENTRADA é o informado; vazio, o custo médio consolidado do produto (gravado no item). O da DEVOLUÇÃO
    // DE CONSUMO é o do item do consumo de origem (vazio por defeito: o médio do produto), sempre gravado no item.
    const doConsumo = doc.especie === "devolucao_consumo" ? await custosDosItensDeOrigem(ctx, doc) : new Map<string, string | null>();
    for (const it of doc.itens) {
      const informado = doc.especie === "entrada" ? it.custo_unitario : (it.origem_item_id ? doConsumo.get(it.origem_item_id) ?? null : null);
      const custo = informado ?? produtos.get(it.produto_id)!.custo_medio;
      const r = await postStock(ctx, { ...comum, warehouseId: doc.armazem_id, productId: it.produto_id,
        movementType: doc.especie === "entrada" ? "entry" : "devolution", direction: 1,
        quantity: it.quantidade!, unitCost: custo, providerLot: it.lote, expirationDate: it.validade });
      movimentos += r.ids.length;
      if (doc.especie === "devolucao_consumo" || it.custo_unitario === null) await gravarItem(ctx, it, { custo: r.unitCost });
    }
  } else if (doc.especie === "saida" || doc.especie === "transferencia" || doc.especie === "consumo") {
    // Saldo conferido ANTES de gravar: insuficiente → 422 no item, nada gravado (a transação cai inteira).
    const plano = await planejarSaldos(ctx, doc);
    const faltas = plano.map((p, i) => ({ p, i })).filter(({ p }) => p.insuficiente);
    if (faltas.length) {
      const detalhes = faltas.map(({ p, i }) => ({ path: caminhoDoItem(i, "quantidade"),
        message: `Saldo insuficiente de ${p.produto_nome}${p.lote ? ` (lote ${p.lote})` : ""} no local de estoque de origem: há ${quantidadeLegivel(p.saldo_atual)}, o item pede ${quantidadeLegivel(doc.itens[i]!.quantidade!)}.` }));
      throw recusar(detalhes[0]!.message, detalhes);
    }
    const tipoDaSaida = doc.especie === "saida" ? "writeoff" : doc.especie === "consumo" ? "requisition" : "transfer_out";
    for (const it of doc.itens) {
      const out = await postStock(ctx, { ...comum, warehouseId: doc.armazem_id, productId: it.produto_id,
        movementType: tipoDaSaida, direction: -1, quantity: it.quantidade!, providerLot: it.lote });
      movimentos += out.ids.length;
      if (doc.especie === "transferencia") {
        // A perna de ENTRADA espelha a de SAÍDA parte por parte — mesmo lote, mesma validade, mesma quantidade e custo.
        // Uma saída que a escolha automática dividiu em dois lotes chega ao destino como os mesmos dois lotes.
        for (const parte of out.partes) {
          const entrada = await postStock(ctx, { ...comum, warehouseId: doc.armazem_destino_id!, productId: it.produto_id, movementType: "transfer_in",
            direction: 1, quantity: parte.quantidade, unitCost: parte.unitCost, providerLot: parte.lote, expirationDate: parte.validade });
          movimentos += entrada.ids.length;
        }
      }
      await gravarItem(ctx, it, { custo: out.unitCost });
    }
  } else {
    // AJUSTE: trava todos os baldes em ordem fixa, depois lê cada saldo SOB a trava e corrige pela diferença.
    // A chave de ordem é (armazém, produto, lote); no ajuste o armazém é o do cabeçalho, comum a todos os itens.
    const balde = (it: ItemDocumentoEstoqueLido) => [doc.armazem_id, it.produto_id, it.lote ?? ""] as const;
    const ordem = doc.itens.map((it, i) => ({ it, i })).sort((a, b) => {
      const [x, y] = [balde(a.it), balde(b.it)];
      return comparar(x[0], y[0]) || comparar(x[1], y[1]) || comparar(x[2], y[2]);
    });
    for (const { it } of ordem) await travarBaldeDoAjuste(ctx, doc.armazem_id, it.produto_id, it.lote);
    for (const { it, i } of ordem) movimentos += await ajustarItem(ctx, doc, it, i, produtos.get(it.produto_id)!, comum);
  }

  // Os itens já foram gravados com o cabeçalho aberto; agora a transição, com ROW COUNT conferido.
  const u = await ctx.tx.query(
    "update erp.documentos_estoque set situacao = 'confirmado', confirmado_em = now(), confirmado_por = $3 where id = $1 and organization_id = $2 and situacao = 'aberto'",
    [doc.id, ctx.orgId, ctx.user.id]);
  if (u.rowCount !== 1) throw notFound("Documento");
  await audit(ctx.tx, ctx, ORIGEM, doc.id, "confirm", {
    especie: doc.especie, movimentos, tipoOperacaoVersaoId: doc.tipo_operacao_versao_id, ...(o.automatica ? { automatica: true } : {}),
  });
  return { id: doc.id, situacao: "confirmado" as const, movimentos };
}

/** O que todo movimento do documento leva: a empresa, a origem no razão, a data, a nota e o DESTINO do cabeçalho. */
type ComumDoMovimento = Pick<StockPost, "empresaId" | "sourceType" | "sourceId" | "date" | "note"
  | "costCenterId" | "harvestId" | "equipamentoId" | "ordemServicoId" | "loteAnimaisId" | "areaId">;

/**
 * A RESERVA DA REQUISIÇÃO (OPERACOES-01 F5a) — confirmar a requisição não move o razão: ela passa a ser a PENDENTE, e
 * o saldo pendente dela entra no reservado do local de estoque (a parte C1 da reserva, no banco).
 *   1) TRAVA os produtos do documento em ordem de id — a MESMA trava do pedido com reserva (`SQL_TRAVA_PRODUTOS`,
 *      importada, nunca copiada): conflita com o gatilho de saldo de toda entrada e saída do produto e com outro
 *      pedido ou requisição, que fazem fila e relêem o estado que esta deixou;
 *   2) DEPOIS da trava (outra instrução, foto nova do READ COMMITTED), o disponível de cada par sem este documento
 *      (`planejarDisponivel`); faltou → 422 por item. Sem reserva parcial: ou a requisição inteira cabe, ou nada muda.
 */
async function reservarRequisicao(ctx: ServiceCtx, doc: DocumentoEstoqueLido): Promise<void> {
  await ctx.tx.query(SQL_TRAVA_PRODUTOS, [ctx.orgId, [...new Set(doc.itens.map((it) => it.produto_id))]]);
  const plano = await planejarDisponivel(ctx, doc);
  const faltas = plano.map((p, i) => ({ p, i })).filter(({ p }) => p.insuficiente);
  if (!faltas.length) return;
  const detalhes = faltas.map(({ p, i }) => ({ path: caminhoDoItem(i, "quantidade"),
    message: `Disponível insuficiente de ${p.produto_nome} no local de estoque: há ${quantidadeLegivel(p.saldo_atual)}, a requisição pede ${quantidadeLegivel(doc.itens[i]!.quantidade!)}.` }));
  throw recusar(detalhes[0]!.message, detalhes);
}

/**
 * O custo de cada item do CONSUMO de origem da devolução — o custo pelo qual a quantidade SAIU volta ao local de
 * estoque. Uma consulta para todos os itens. Item sem custo gravado (defeito: todo consumo confirmado grava o dele) →
 * `null`, e quem chama usa o custo médio do produto.
 */
async function custosDosItensDeOrigem(ctx: ServiceCtx, doc: DocumentoEstoqueLido): Promise<Map<string, string | null>> {
  const origens = [...new Set(doc.itens.flatMap((it) => (it.origem_item_id ? [it.origem_item_id] : [])))];
  const r = await ctx.tx.query<{ id: string; custo_unitario: string | null }>(
    "select id, custo_unitario::text as custo_unitario from erp.documentos_estoque_itens where id = any($1::uuid[]) and organization_id = $2",
    [origens, ctx.orgId]);
  return new Map(r.rows.map((x) => [x.id, x.custo_unitario]));
}

/**
 * UM item do ajuste, com o balde JÁ TRAVADO (`travarBaldeDoAjuste`). Devolve quantos movimentos gravou.
 *   · o saldo é lido AGORA, sob a trava, pela chave GRAVADA do lote (`chaveDoLote`); sem lote, o balde sem lote;
 *   · diferença = contada − saldo; > 0 → `correction_in` pelo custo INFORMADO no item (OPERACOES-01 F5a) ou, sem
 *     ele, pelo custo médio do balde (sem saldo no balde: o médio do produto no armazém; sem nenhum: 0) e com a
 *     validade do item ou, sem ela, a do balde; < 0 → `correction_out` pelo custo informado ou, sem ele, pelo do
 *     balde (o gatilho do saldo aplica o médio); 0 → nenhum movimento — o comportamento da correção antiga;
 *   · grava no item o saldo lido, a diferença e o custo usado (sem movimento: o informado, ou nulo).
 */
async function ajustarItem(ctx: ServiceCtx, doc: DocumentoEstoqueLido, it: ItemDocumentoEstoqueLido, i: number, produto: ProdutoAtual,
  comum: ComumDoMovimento): Promise<number> {
  const chave = it.lote ? await chaveDoLote(ctx, doc.armazem_id, it.produto_id, it.lote) : "";
  const balde = await currentBalance(ctx, doc.armazem_id, it.produto_id, chave);
  const contada = D(it.quantidade_contada!);
  const diferenca = contada.minus(balde.quantity);
  const saldo = fqty(balde.quantity);
  if (diferenca.isZero()) {
    await gravarItem(ctx, it, { custo: it.custo_unitario, saldo, diferenca: fqty(diferenca) });
    return 0;
  }
  if (diferenca.gt(0)) {
    const custo = it.custo_unitario
      ?? (D(balde.quantity).gt(0) ? balde.averageCost : (await currentBalance(ctx, doc.armazem_id, it.produto_id, null)).averageCost);
    let validade = it.validade;
    if (!validade && it.lote) {
      const v = await ctx.tx.query<{ expiration_date: string | null }>(
        "select expiration_date from erp.stock_balances where organization_id = $1 and warehouse_id = $2 and product_id = $3 and provider_lot = $4",
        [ctx.orgId, doc.armazem_id, it.produto_id, chave]);
      validade = v.rows[0]?.expiration_date ?? null;
    }
    if (produto.controle === "lote_validade" && !validade) {
      throw recusar("O ajuste aumenta o saldo de um lote sem validade, e o produto controla validade: cancele o documento e lance de novo com a validade.",
        [{ path: caminhoDoItem(i, "validade"), message: "Informe a validade do lote: o ajuste aumenta o saldo" }]);
    }
    const r = await postStock(ctx, { ...comum, warehouseId: doc.armazem_id, productId: it.produto_id, movementType: "correction_in", direction: 1,
      quantity: fqty(diferenca), unitCost: custo, providerLot: it.lote, expirationDate: validade });
    await gravarItem(ctx, it, { custo: r.unitCost, saldo, diferenca: fqty(diferenca) });
    return r.ids.length;
  }
  // Para BAIXO: o lote sai com a validade que já tem (o `postStock` lê a do saldo). Custo nulo (não informado) → o
  // médio do balde.
  // NÃO passa pela guarda da reserva (0035, por desenho): o inventário registra o que existe.
  const r = await postStock(ctx, { ...comum, warehouseId: doc.armazem_id, productId: it.produto_id, movementType: "correction_out", direction: -1,
    quantity: fqty(diferenca.abs()), unitCost: it.custo_unitario, providerLot: it.lote });
  await gravarItem(ctx, it, { custo: r.unitCost, saldo, diferenca: fqty(diferenca) });
  return r.ids.length;
}

// ─────────────── cancelamento ───────────────

/**
 * ENTRADA JÁ CONSUMIDA — antes do estorno. O saldo de cada balde (armazém, produto, lote) em que o documento deu
 * entrada (`entry`, `transfer_in`, `correction_in`: a soma líquida dos movimentos do documento no balde) tem de
 * cobrir o que entrou; senão o estorno deixaria o saldo negativo e o gatilho recusaria com uma mensagem que não
 * diz qual item. Os saldos são travados em ordem fixa antes da conferência (molde da Compra). Faltou → 422 no
 * item, nada gravado.
 */
async function conferirEntradasNaoConsumidas(ctx: ServiceCtx, doc: DocumentoEstoqueLido): Promise<void> {
  const faltas = await ctx.tx.query<{ produto_id: string; produto: string; armazem: string; lote: string | null; entrou: string; saldo: string }>(
    `with entrada as (
       select m.warehouse_id, m.product_id, coalesce(m.provider_lot, '') as lote, sum(m.quantity * m.direction) as q
         from erp.stock_movements m
        where m.organization_id = $1 and m.source_type = $3 and m.source_id = $2
        group by 1, 2, 3 having sum(m.quantity * m.direction) > 0),
     saldo as (
       select b.warehouse_id, b.product_id, coalesce(b.provider_lot, '') as lote, b.quantity
         from erp.stock_balances b join entrada e on e.warehouse_id = b.warehouse_id and e.product_id = b.product_id and e.lote = coalesce(b.provider_lot, '')
        where b.organization_id = $1
        order by b.warehouse_id, b.product_id, b.provider_lot
        for update of b)
     select e.product_id as produto_id, p.code || ' - ' || p.description as produto, w.description as armazem, nullif(e.lote, '') as lote,
            e.q::text as entrou, coalesce(s.quantity, 0)::text as saldo
       from entrada e
       join erp.products p on p.id = e.product_id and p.organization_id = $1
       join erp.warehouses w on w.id = e.warehouse_id and w.organization_id = $1
       left join saldo s on s.warehouse_id = e.warehouse_id and s.product_id = e.product_id and s.lote = e.lote
      where coalesce(s.quantity, 0) < e.q
      order by 2, 3`, [ctx.orgId, doc.id, ORIGEM]);
  if (!faltas.rows.length) return;
  // O item de cada balde: o do produto com o MESMO lote; sem ele (lote escolhido pela validade), o primeiro do produto.
  const itemDoBalde = (produto: string, lote: string | null) => {
    const porLote = doc.itens.findIndex((it) => it.produto_id === produto && lote !== null && it.lote === aparar(lote));
    if (porLote >= 0) return porLote;
    const porProduto = doc.itens.findIndex((it) => it.produto_id === produto);
    return porProduto >= 0 ? porProduto : 0;
  };
  const detalhes = faltas.rows.map((f) => ({
    path: caminhoDoItem(itemDoBalde(f.produto_id, f.lote), "quantidade"),
    message: `O estoque de ${f.produto} no local de estoque ${f.armazem}${f.lote ? ` (lote ${f.lote})` : ""} já foi consumido: entrou ${quantidadeLegivel(f.entrou)}, o saldo é ${quantidadeLegivel(f.saldo)}. O estorno deixaria o saldo negativo.`,
  }));
  throw recusar(`O estoque que este documento deu de entrada já foi consumido; o cancelamento deixaria o saldo negativo. ${detalhes.map((d) => d.message).join(" ")}`, detalhes);
}

/**
 * OS DEPENDENTES VIVOS (OPERACOES-01 F5a): a requisição confirmada com consumo não cancelado e o consumo confirmado
 * com devolução não cancelada não se cancelam — desfaz-se de baixo para cima (ou, na requisição, encerra-se o saldo).
 * Uma consulta, DEPOIS da trava do cabeçalho (foto nova: o consumo que terminou enquanto esta esperava entra na conta).
 * O gatilho de transição (0043) é a rede.
 */
async function conferirDependentesVivos(ctx: ServiceCtx, doc: DocumentoEstoqueLido): Promise<void> {
  const dependente = doc.especie === "requisicao" ? "consumo" : doc.especie === "consumo" ? "devolucao_consumo" : null;
  if (!dependente || doc.situacao !== "confirmado") return;
  const r = await ctx.tx.query(
    "select 1 from erp.documentos_estoque where origem_documento_id = $1 and organization_id = $2 and especie = $3 and situacao <> 'cancelado' limit 1",
    [doc.id, ctx.orgId, dependente]);
  if (!r.rowCount) return;
  throw err("CONFLICT", doc.especie === "requisicao"
    ? "Esta requisição tem consumos: cancele-os ou encerre o saldo."
    : "Este consumo tem devoluções: cancele-as primeiro.");
}

async function cancelarDocumento(ctx: ServiceCtx, id: string, especie: EspecieEstoque, motivo: string | null) {
  // A trava do cabeçalho serializa cancelar × confirmar × cancelar do mesmo documento.
  const doc = await lerDocumentoEstoque(ctx, id, especie, { lock: true });
  if (doc.situacao === "cancelado") throw err("ALREADY_CANCELLED", "O documento já está cancelado");
  await conferirDependentesVivos(ctx, doc);
  let estornos = 0;
  // A requisição confirmada não tem movimento: cancela SEM estorno (a reserva dela some com a situação).
  if (doc.situacao === "confirmado" && doc.especie !== "requisicao") {
    await conferirEntradasNaoConsumidas(ctx, doc);
    estornos = await reverseStock(ctx, ORIGEM, doc.id, hoje());
  }
  const u = await ctx.tx.query(
    `update erp.documentos_estoque set situacao = 'cancelado', cancelado_em = now(), cancelado_por = $3, motivo_cancelamento = $4
      where id = $1 and organization_id = $2 and situacao = $5`,
    [doc.id, ctx.orgId, ctx.user.id, motivo ?? MOTIVO_PADRAO_CANCELAMENTO, doc.situacao]);
  if (u.rowCount !== 1) throw notFound("Documento");
  await audit(ctx.tx, ctx, ORIGEM, doc.id, "cancel", { especie: doc.especie, de: doc.situacao, motivo: motivo ?? MOTIVO_PADRAO_CANCELAMENTO, estornos });
  return { id: doc.id, situacao: "cancelado" as const, estornos };
}

// ─────────────── rotas ───────────────

const corpoVazio = z.object({}).strict();
const chaveDeIdempotencia = (h: unknown) => (typeof h === "string" ? h : undefined);

/** Registra a prévia, a confirmação e o cancelamento das sete espécies. Chamada no fim de `estoque-documentos.ts`. */
export function registrarConfirmacaoEstoque(app: FastifyInstance): void {
  for (const { especie, segmento, recurso } of ESPECIES_ESTOQUE) {
    const base = `/estoque/${segmento}/:id`;

    app.get(`${base}/previa-confirmacao`, async (req) => runService(app, req, `${recurso}.view`,
      (ctx) => previaDaConfirmacao(ctx, (req.params as { id: string }).id, especie)));

    app.post(`${base}/confirmar`, async (req) => runService(app, req, `${recurso}.edit`, async (ctx) => {
      const { id } = req.params as { id: string };
      // Contrato estrito: o corpo, quando vem, é vazio — chave desconhecida é 422, nunca descartada.
      if (req.body !== undefined && req.body !== null) corpoVazio.parse(req.body);
      // Visibilidade ANTES de reservar a chave: fora de escopo/inexistente/malformado é a MESMA 404 do GET.
      await lerDocumentoEstoque(ctx, id, especie);
      return (await idempotent(ctx.tx, ctx.orgId, chaveDeIdempotencia(req.headers["idempotency-key"]),
        { action: "confirmar_documento_estoque", especie, sourceId: id.toLowerCase(), actorId: ctx.user.id },
        () => confirmarDocumentoEstoqueNaTransacao(ctx, especie, id, { automatica: false }))).result;
    }));

    app.post(`${base}/cancelar`, async (req) => runService(app, req, `${recurso}.edit`, async (ctx) => {
      const { id } = req.params as { id: string };
      const corpo = cancelarSchema.parse(req.body ?? {});
      await lerDocumentoEstoque(ctx, id, especie);
      return (await idempotent(ctx.tx, ctx.orgId, chaveDeIdempotencia(req.headers["idempotency-key"]),
        { action: "cancelar_documento_estoque", especie, sourceId: id.toLowerCase(), actorId: ctx.user.id, motivo: corpo.motivo },
        () => cancelarDocumento(ctx, id, especie, corpo.motivo))).result;
    }));
  }
}
