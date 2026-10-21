import type { FastifyInstance } from "fastify";
import { D, DomainError, money } from "@agro/shared";
import { FORMA_UUID_PADRAO, MOTIVOS_DA_PROVISAO, MOTIVOS_DA_PROVISAO_COMPRA } from "@agro/domain";
import { runService, idempotent, audit, requirePermission } from "../lib/service.js";
import { notFound, err } from "../lib/errors.js";
import { scopedById, type ServiceCtx } from "../lib/context.js";
import { condicaoGravada, type TopDoLancamento } from "../lib/documento-comercial.js";
import { respostaDoLayoutEfetivo, type LayoutEfetivoDaCentral } from "../lib/layout-documento.js";
import { sincronizarProvisaoDoPedidoDeCompra, travarPedidoDeCompraDaProvisao } from "../lib/financeiro-provisao.js";
import { MSG_DOCUMENTO_MUDOU } from "./vendas-edicao-patch.js";
import {
  ESPECIES, CONTRATO_DA_EDICAO, lerDocumentoCompra, nucleoDoLancamento, exigirVersaoQueAceitaSemItens, respostaDasRegrasDaCompra,
  familiaDaEspecie, recusaDaNotaInvisivel,
  type EspecieCompra, type ParcelaDaNotaGravada, type ResultadoDoNucleo, type RegrasDaOperacaoDaCompra, type DocumentoCompraEntrada,
} from "./compras.js";
import {
  lerPedidoDaEdicaoDeCompra, edicaoDeCompraComoFicara, planoDaEdicaoDeCompra, recusaDosTotaisDaEdicaoDeCompra, eventoDaEdicaoDeCompra,
  CAMPOS_DO_CABECALHO_DA_EDICAO,
  type DocumentoGravadoDeCompra, type EdicaoDeCompraComoFicara, type CamposDaEdicaoDeCompra, type CampoDoItemDeCompra,
} from "./compras-edicao-patch.js";
import { recusaDaEdicaoDeCompra, limitesDaEdicaoDeCompra, MSG_EDICAO_QUANTIDADE_ACIMA_DO_SALDO, type LimitesDaEdicaoDeCompra } from "./compras-edicao-regras.js";

/**
 * ═══ EDITAR-02 (decisão 313) — EDITAR O PEDIDO DE COMPRA E A COMPRA JÁ SALVOS ═══
 *
 *   GET   /compras/{pedidos|compras}/:id/edicao   o que a tela precisa para abrir a edição (leitura pura)
 *   PATCH /compras/{pedidos|compras}/:id          `{ version, ...só os campos que mudam }`
 *
 * O MOLDE é a EDITAR-01 (decisão 272: `vendas-edicao.ts`, a PATCH de `sales.ts`), lido contra compras ponto a ponto pelo
 * relatório do A0. As decisões do dono (P1–P4) e do coordenador (D1–D14) estão na 313; aqui, como cada uma é executada.
 *
 * A REGRA (313): editável é a compra ABERTA e o pedido ABERTO sem compra viva, não aprovado (P2). Confirmado, cancelado,
 * finalizado, convertido, com compra viva e aprovado têm, cada um, a sua recusa (409 INVALID_STATUS_TRANSITION,
 * `compras-edicao-regras.ts`). A PATCH NÃO confirma (P4), não cria efeito de estoque nem financeiro, não apaga nada
 * (nenhum DELETE: item salvo não sai, P1) e nunca escreve `version` — quem soma é o gatilho da 0063.
 *
 * PERMISSÃO: `<recurso>.edit` E `<recurso>.view` (AND, por chave exata) — recurso = `pedidos_compra` | `compras`. A
 * resposta das duas portas é o documento lido; editar sem poder ver não abre leitura. Nenhuma permissão nova.
 *
 * RISCO DECLARADO (D9): confirmar e cancelar a compra travam com JUNÇÃO (`lerDocumentoCompra` com `lock`, que junta o
 * fornecedor). Com a PATCH trocando o fornecedor da compra aberta no mesmo instante, quem espera a trava reavalia a
 * junção sobre a linha nova e pode responder 404 transitório. Não se mexe em confirmar/cancelar nesta fatia.
 */

/** A resposta de `GET <base>/:id/edicao`. */
export interface EdicaoDoDocumentoDeCompra {
  /** `recusaDaEdicaoDeCompra`: a MESMA pergunta, na MESMA ordem, da PATCH. */
  podeEditar: boolean;
  motivo: string | null;
  /** `limitesDaEdicaoDeCompra`: o que uma edição permitida não troca, e por quê (a PATCH recusa exatamente isso). */
  limites: LimitesDaEdicaoDeCompra;
  /** A do documento, para a PATCH mandar de volta (concorrência otimista). Texto de dígitos (bigint). */
  version: string;
  /** O MESMO contrato de `/regras-da-operacao` de compras (`respostaDasRegrasDaCompra`), pela versão CONGELADA. */
  regras: RegrasDaOperacaoDaCompra;
  /** O MESMO valor de `regras.condicoesPermitidas` (null = todas). */
  condicoesPermitidas: string[] | null;
  /** O MESMO contrato de `/layout-efetivo`, pela TOP do documento (o layout ligado HOJE — o que a PATCH cobra). */
  layout: LayoutEfetivoDaCentral;
  /**
   * DIFERENÇA DECLARADA do §15.3: o documento — o MESMO objeto do `GET <base>/:id` (`lerDocumentoCompra`). A tela carrega
   * a Central em modo edição a partir do `/edicao` numa ida só, com a `version` e os limites lidos do MESMO documento.
   */
  documento: Record<string, unknown>;
}

// ─────────────── o recorte: a visibilidade e a trava ───────────────

/**
 * O RECORTE DA EDIÇÃO, SEM JUNÇÃO: só `erp.documentos_compra`, só `id` e `version`, com o MESMO recorte de
 * `lerDocumentoCompra` — a forma do id, a organização, a espécie e o escopo de empresa do módulo (`scopedById`). Fora da
 * forma ou zero linhas: a MESMA 404 do GET :id (`notFound("Documento")`: mesmo status, mesmo corpo) para malformado,
 * inexistente, de outra organização, fora do escopo e de outra espécie. Dois usos:
 *   · `conferirDocumentoDeCompraVisivel` (sem trava) — a PATCH, ANTES da idempotência;
 *   · `travarDocumentoDeCompraDaEdicao` (`for update`) — a PATCH, já dentro do `idempotent`.
 */
async function recorteDaEdicao(ctx: ServiceCtx, id: string, especie: EspecieCompra, trava: boolean): Promise<{ id: string; version: string }> {
  if (!FORMA_UUID_PADRAO.test(id)) throw notFound("Documento");
  const sc = scopedById(ctx, "d", id); sc.params.push(especie);
  const r = await ctx.tx.query<{ id: string; version: string }>(
    `select d.id, d.version from erp.documentos_compra d
      where d.id = $1 and d.organization_id = $2 and d.especie = $${sc.params.length}${sc.sql}${trava ? " for update of d" : ""}`, sc.params);
  if (!r.rows[0]) throw notFound("Documento");
  return r.rows[0];
}

/**
 * A CONFERÊNCIA DE VISIBILIDADE da PATCH, antes da idempotência (o replay devolveria a resposta gravada sem passar pelo
 * recorte de empresa) — ENXUTA de propósito, achado MÉDIO da revisão de desempenho: a leitura COMPLETA
 * (`lerDocumentoCompra`: as junções, os itens, as compras geradas e, no pedido de quem vê orçamento, a lista e os preços
 * de TODOS os orçamentos) só para dar a 404 era jogada fora inteira. O documento só é lido completo depois da trava (a
 * pergunta "pode editar?") e na resposta. Sem as junções aqui, nenhuma 404 nova escapa: a leitura completa sob a trava
 * dá a mesma 404, e o erro desfaz a transação — a reserva da chave inclusive.
 */
async function conferirDocumentoDeCompraVisivel(ctx: ServiceCtx, id: string, especie: EspecieCompra): Promise<void> {
  await recorteDaEdicao(ctx, id, especie, false);
}

/**
 * A TRAVA DA PATCH, SEM JUNÇÃO (A14 do A0; a regra da 272, EDITAR-01_R1 1.2 k): o recorte com `for update`. Com a junção
 * do fornecedor de `lerDocumentoCompra`, quem espera a trava relê a linha nova e REAVALIA a junção com o fornecedor da
 * foto antiga — a PATCH concorrente que trocou o fornecedor faria esta responder 404 sobre um documento que só MUDOU; o
 * certo é o 409 da versão.
 */
async function travarDocumentoDeCompraDaEdicao(ctx: ServiceCtx, id: string, especie: EspecieCompra): Promise<{ id: string; version: string }> {
  return recorteDaEdicao(ctx, id, especie, true);
}

// ─────────────── os limites ───────────────

type Detalhe = { path: string; message: string };

/**
 * D2/D3/D4/P3 — a TROCA de um campo travado (`limitesDaEdicaoDeCompra`, a MESMA do `/edicao`) é 422 NO CAMPO, com o motivo
 * dos limites; o campo enviado IGUAL ao gravado não é troca. Item novo onde não cabe, em `itens[k]`; quantidade acima do
 * saldo do item do pedido, em `itens[k].quantidade`. Todas juntas. O banco (0044/0047) continua sendo a rede.
 */
function recusaDasTravasDaEdicao(edicao: EdicaoDeCompraComoFicara, limites: LimitesDaEdicaoDeCompra): void {
  const det: Detalhe[] = [];
  for (const [campo, motivo] of Object.entries(limites.campos)) if (campo in edicao.mudancas) det.push({ path: campo, message: motivo });
  if (edicao.itens.modo === "porId") {
    const porId = new Map(limites.itens.map((i) => [i.id, i]));
    const { ids, mudados } = edicao.itens;
    ids.forEach((gid, k) => {
      if (gid === null) {
        if (limites.itemNovo) det.push({ path: `itens[${k}]`, message: limites.itemNovo });
        return;
      }
      const l = porId.get(gid);
      if (!l) return;
      const trocados = mudados[k] ?? [];
      for (const f of trocados) { const motivo = l.campos[f]; if (motivo) det.push({ path: `itens[${k}].${f}`, message: motivo }); }
      if (l.quantidadeMaxima !== null && trocados.includes("quantidade") && D(edicao.d.itens[k]!.quantidade).gt(D(l.quantidadeMaxima))) {
        det.push({ path: `itens[${k}].quantidade`, message: MSG_EDICAO_QUANTIDADE_ACIMA_DO_SALDO });
      }
    });
  }
  if (det.length) throw err("VALIDATION_ERROR", det[0]!.message, det);
}

// ─────────────── a gravação ───────────────

/** O tipo de cada coluna do item que a PATCH grava (lista ESTÁTICA: o SQL só monta identificador e tipo daqui). */
const TIPO_DA_COLUNA_DO_ITEM = {
  produto_id: "uuid", armazem_id: "uuid", quantidade: "numeric", valor_unitario: "numeric", desconto: "numeric", desconto_percentual: "numeric",
  lote: "text", validade: "date", observacao: "text", gera_estoque: "boolean", imobilizado: "boolean",
  categoria_financeira_id: "uuid", centro_custo_id: "uuid", valor_ipi: "numeric", valor_icms_st: "numeric",
  valor_total: "numeric", posicao: "int",
} as const satisfies Record<CampoDoItemDeCompra | "valor_total" | "posicao", string>;
type ColunaDoItem = keyof typeof TIPO_DA_COLUNA_DO_ITEM;
/** As colunas do INSERT do item novo, na ordem (a PATCH não cria item com origem, orçamento nem linha da nota). */
const COLUNAS_DO_ITEM_NOVO: readonly ColunaDoItem[] = ["produto_id", "armazem_id", "quantidade", "valor_unitario", "desconto", "desconto_percentual",
  "valor_total", "lote", "validade", "observacao", "posicao", "gera_estoque", "imobilizado", "categoria_financeira_id", "centro_custo_id", "valor_ipi", "valor_icms_st"];

/** O valor que a coluna grava, como o POST o grava (`money` no que o POST passa por `money`). */
function valorDaColuna(c: ColunaDoItem, item: EdicaoDeCompraComoFicara["d"]["itens"][number], k: number, total: string): unknown {
  switch (c) {
    case "desconto": return money(item.desconto);
    case "valor_ipi": return item.valor_ipi != null ? money(item.valor_ipi) : null;
    case "valor_icms_st": return item.valor_icms_st != null ? money(item.valor_icms_st) : null;
    case "valor_total": return total;
    case "posicao": return k;
    case "armazem_id": return item.armazem_id ?? null;
    case "validade": return item.validade ?? null;
    case "gera_estoque": return item.gera_estoque ?? null;
    case "imobilizado": return item.imobilizado ?? null;
    case "categoria_financeira_id": return item.categoria_financeira_id ?? null;
    case "centro_custo_id": return item.centro_custo_id ?? null;
    default: return item[c];
  }
}

/**
 * UM UPDATE DO CABEÇALHO, sempre que algo grava (a 272 item 2 — também a PATCH que só muda item): os campos que mudam, a
 * classificação e a condição que o núcleo decidiu, os totais e o plano. A `version` NUNCA é escrita: o gatilho da 0063
 * soma 1. ROW COUNT conferido: zero linha sob RLS seria "salvo" sem efeito. A nota repetida numa compra que o usuário não
 * vê (o índice da 0036) sai como a do POST, sem dizer onde (`recusaDaNotaInvisivel`).
 */
async function gravarCabecalho(ctx: ServiceCtx, especie: EspecieCompra, id: string, m: Record<string, unknown>, n: ResultadoDoNucleo): Promise<void> {
  const params: unknown[] = [id, ctx.orgId, especie];
  const sets: string[] = [];
  const set = (coluna: string, valor: unknown) => { params.push(valor); sets.push(`${coluna} = $${params.length}`); };
  for (const c of CAMPOS_DO_CABECALHO_DA_EDICAO) {
    if (!(c in m) || c === "categoria_financeira_id" || c === "centro_custo_id" || c === "condicao_pagamento_id" || c === "data_vencimento"
      || c === "tipo_titulo_id" || c === "classificacao_gasto") continue;
    set(c, c === "frete" || c === "outras_despesas" || c === "desconto" ? money(String(m[c])) : m[c]);
  }
  // A classificação e a condição: as que o núcleo validou (o POST grava as mesmas), só quando a PATCH as troca.
  // Com rateio novo, o cabeçalho perde natureza/centro (CHECK da 0047) — grava pelo núcleo mesmo sem cat/cc no corpo.
  if ("categoria_financeira_id" in m || "centro_custo_id" in m || "rateio" in m) {
    set("categoria_financeira_id", n.classificacao?.categoriaFinanceiraId ?? null);
    set("centro_custo_id", n.classificacao?.centroCustoId ?? null);
  }
  if ("condicao_pagamento_id" in m) set("condicao_pagamento_id", n.condicao?.id ?? null);
  if ("data_vencimento" in m) set("data_vencimento", n.dataVencimento);
  if ("tipo_titulo_id" in m) set("tipo_titulo_id", m["tipo_titulo_id"] ?? null);
  if ("classificacao_gasto" in m) set("classificacao_gasto", m["classificacao_gasto"] ?? null);
  if ("rateio" in m) set("rateio_tipo", m["rateio_tipo"] ?? null);
  set("valor_itens", n.totais.valorItens);
  set("valor_total", n.totais.total);
  set("plano_parcelas", n.plano ? JSON.stringify(n.plano) : null);
  set("parcelas_ajustadas", n.parcelasAjustadas);
  sets.push("atualizado_em = now()");
  const u = await ctx.tx.query(
    `update erp.documentos_compra set ${sets.join(", ")} where id = $1 and organization_id = $2 and especie = $3 and situacao = 'aberto'`, params)
    .catch(recusaDaNotaInvisivel);
  if (u.rowCount !== 1) throw notFound("Documento");
}

/**
 * EDITAR-02B — substitui as linhas do rateio por valor na compra ABERTA (DELETE + INSERT; a 0065 libera o DELETE).
 * Ordem: se sai de por_valor, apaga linhas ANTES do UPDATE do cabeçalho (a guarda exige rateio_tipo atual);
 * se entra/permanece em por_valor, o cabeçalho já tem rateio_tipo = por_valor e então INSERT.
 */
async function gravarRateioDaEdicao(ctx: ServiceCtx, id: string, cur: DocumentoGravadoDeCompra, m: Record<string, unknown>,
  fase: "antesDoCabecalho" | "depoisDoCabecalho"): Promise<void> {
  if (!("rateio" in m)) return;
  const novo = m["rateio"] as DocumentoCompraEntrada["rateio"] | null;
  const tinhaPorValor = cur.rateio_tipo === "por_valor";
  const teraPorValor = novo?.tipo === "por_valor";
  if (fase === "antesDoCabecalho") {
    if (tinhaPorValor) {
      const del = await ctx.tx.query(
        `delete from erp.documentos_compra_rateio where organization_id = $1 and documento_id = $2`, [ctx.orgId, id]);
      if (del.rowCount === null) throw notFound("Documento");
    }
    return;
  }
  if (!teraPorValor || novo?.tipo !== "por_valor") return;
  for (const [posicao, l] of novo.linhas.entries()) {
    const ins = await ctx.tx.query(
      `insert into erp.documentos_compra_rateio (organization_id, documento_id, posicao, categoria_financeira_id, centro_custo_id, conta_contabil_id, safra_id, percentual)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.orgId, id, posicao, l.categoria_financeira_id, l.centro_custo_id, l.conta_contabil_id ?? null, l.safra_id ?? null, D(l.percentual).toFixed(4)]);
    if (ins.rowCount !== 1) throw notFound("Documento");
  }
}

/**
 * OS ITENS, EM LUGAR E EM LOTE (D2): o item alterado recebe um UPDATE SÓ das colunas que mudaram — os gatilhos dos itens
 * (`_origem_guarda`, `_orcamento_guarda`, 0044) disparam pela COLUNA citada no SET, não pelo valor: citar a quantidade
 * de um item que não a mudou recusaria a compra gerada de um pedido convertido mesmo para corrigir uma observação. Os
 * alterados com o MESMO conjunto de colunas vão num UPDATE só (`unnest`); os novos, num INSERT só, com `posicao` = a
 * posição na lista. Nunca um comando por item, nunca um DELETE. ROW COUNT conferido em cada escrita.
 */
async function gravarItens(ctx: ServiceCtx, id: string, edicao: EdicaoDeCompraComoFicara, n: ResultadoDoNucleo): Promise<void> {
  if (edicao.itens.modo !== "porId") return;
  const { ids, mudados } = edicao.itens;
  const grupos = new Map<string, { colunas: ColunaDoItem[]; ids: string[]; valores: unknown[][] }>();
  ids.forEach((gid, k) => {
    if (gid === null) return;
    const g = edicao.pares[k]!;
    const item = edicao.d.itens[k]!;
    const colunas: ColunaDoItem[] = [...(mudados[k] ?? [])];
    if (!D(n.itensTotais[k]!).eq(D(g.valor_total))) colunas.push("valor_total");
    if (!colunas.length) return;
    const chave = colunas.join(",");
    const grupo = grupos.get(chave) ?? { colunas, ids: [], valores: colunas.map(() => []) };
    grupos.set(chave, grupo);
    grupo.ids.push(gid);
    colunas.forEach((c, j) => grupo.valores[j]!.push(valorDaColuna(c, item, k, n.itensTotais[k]!)));
  });
  for (const grupo of grupos.values()) {
    const arrays = grupo.colunas.map((c, j) => `$${j + 4}::${TIPO_DA_COLUNA_DO_ITEM[c]}[]`).join(", ");
    const u = await ctx.tx.query(
      `update erp.documentos_compra_itens i set ${grupo.colunas.map((c) => `${c} = x.${c}`).join(", ")}
         from unnest($3::uuid[], ${arrays}) as x(id, ${grupo.colunas.join(", ")})
        where i.id = x.id and i.documento_id = $1 and i.organization_id = $2`,
      [id, ctx.orgId, grupo.ids, ...grupo.valores]);
    if (u.rowCount !== grupo.ids.length) throw notFound("Documento");
  }
  const novos = ids.flatMap((gid, k) => (gid === null ? [k] : []));
  if (!novos.length) return;
  const arrays = COLUNAS_DO_ITEM_NOVO.map((c, j) => `$${j + 3}::${TIPO_DA_COLUNA_DO_ITEM[c]}[]`).join(", ");
  const ins = await ctx.tx.query(
    `insert into erp.documentos_compra_itens (organization_id, documento_id, ${COLUNAS_DO_ITEM_NOVO.join(", ")})
     select $1, $2, ${COLUNAS_DO_ITEM_NOVO.map((c) => `x.${c}`).join(", ")}
       from unnest(${arrays}) as x(${COLUNAS_DO_ITEM_NOVO.join(", ")})`,
    [ctx.orgId, id, ...COLUNAS_DO_ITEM_NOVO.map((c) => novos.map((k) => valorDaColuna(c, edicao.d.itens[k]!, k, n.itensTotais[k]!)))]);
  if (ins.rowCount !== novos.length) throw notFound("Documento");
}

// ─────────────── a PATCH ───────────────

/** A TOP e a versão GRAVADAS (imutáveis, 0044), na forma do lançamento — a PATCH nunca resolve a TOP atual. */
function topGravada(cur: DocumentoGravadoDeCompra): TopDoLancamento {
  const t = cur.tipo_operacao;
  // TOP é `not null` com FK composta (0036): sem ela lida, é corrupção — recusar, nunca seguir "sem TOP".
  if (!t || t.versao === null || !t.codigoBase) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este documento");
  return { tipoOperacaoId: cur.tipo_operacao_id, tipoOperacaoVersaoId: cur.tipo_operacao_versao_id, codigo: t.codigo, nome: t.nome, versao: t.versao, codigoBase: t.codigoBase };
}

/** As duplicatas da nota gravadas (`parcelas_nota`, a forma que o lançamento grava), ou `null`. */
function parcelasGravadas(bruto: unknown): ParcelaDaNotaGravada[] | null {
  if (!Array.isArray(bruto) || bruto.length === 0) return null;
  return bruto.map((p: { numero?: unknown; vencimento?: unknown; valor?: unknown }) => ({ numero: String(p.numero), vencimento: String(p.vencimento), valor: String(p.valor) }));
}

/**
 * A PATCH, DEPOIS da forma (422), da 404 e da chave de idempotência — dentro do `idempotent`. A ORDEM é o contrato (D1):
 *   1. a TRAVA da linha, sem junção (zero linhas → a mesma 404) e, LOGO DEPOIS, a VERSÃO: diferente da gravada → 409
 *      CONCURRENCY_CONFLICT, sem gravar nada. Só então o documento é lido (`lerDocumentoCompra`, sem trava: a linha já é
 *      desta transação) — no pedido, as compras geradas lidas SOB a trava (D8);
 *   2. as recusas de ESTADO (`recusaDaEdicaoDeCompra`: situação, compra viva, aprovação P2) → 409
 *      INVALID_STATUS_TRANSITION, com `details`;
 *   3. o documento COMO FICARÁ (`edicaoDeCompraComoFicara`: item salvo ausente P1, item de outro documento, repetido →
 *      422); na compra gerada de pedido, o pedido de origem é TRAVADO aqui (D12: compra → pedido, antes de ler o saldo do
 *      item e de qualquer efeito — a ordem do cancelar e do confirmar da compra); os LIMITES (D2/D3/D4/P3) → 422 no campo;
 *   4. nada muda de fato (valores canônicos iguais ao gravado, plano inclusive) → 200 com o documento, sem escrita e sem
 *      subir a versão;
 *   5. o NÚCLEO do lançamento (`nucleoDoLancamento`, o MESMO do POST): parceiros só do que muda (as referências
 *      trocadas), classificação e condição só se trocam, regras da versão CONGELADA, efeitos, itens novos/alterados,
 *      dados fiscais sobre o rateio gravado, totais (o que não cabe na coluna → 422), duplicatas da nota, plano (A22),
 *      padrões financeiros da TOP (decisão 311/286 — sempre), exigências do título, nota duplicada (se fornecedor, número
 *      ou série mudam) e layout de hoje;
 *   6. a gravação: UM update do cabeçalho, os itens em lote, a provisão (D12), e o evento `update` do histórico.
 * Resposta: o documento como o GET o devolve, com a versão nova.
 */
async function editarDocumentoDeCompra(app: FastifyInstance, ctx: ServiceCtx, especie: EspecieCompra, id: string, pedido: { versao: string; campos: CamposDaEdicaoDeCompra }) {
  const travada = await travarDocumentoDeCompraDaEdicao(ctx, id, especie);
  if (BigInt(travada.version) !== BigInt(pedido.versao)) throw err("CONCURRENCY_CONFLICT", MSG_DOCUMENTO_MUDOU);
  const lido = await lerDocumentoCompra(ctx, id, especie);
  const cur = lido as unknown as DocumentoGravadoDeCompra;
  const recusa = await recusaDaEdicaoDeCompra(ctx, cur);
  if (recusa) throw err("INVALID_STATUS_TRANSITION", recusa.mensagem, recusa.details);
  const edicao = edicaoDeCompraComoFicara(cur, pedido.campos);
  const pedidoDeOrigem = especie === "compra" ? cur.origem_documento_id : null;
  if (pedidoDeOrigem) await travarPedidoDeCompraDaProvisao(ctx, pedidoDeOrigem);
  recusaDasTravasDaEdicao(edicao, await limitesDaEdicaoDeCompra(ctx, cur));
  // Nada muda: a resposta é o documento lido sob a trava — nenhuma escrita desde então.
  if (!edicao.mudou) return lido;

  const m = edicao.mudancas;
  // TOP-CONFIG-08: a compra que já nasceu sem itens (formato 4 "Permitido") continua decidida pela versão CONGELADA.
  if (edicao.d.itens.length === 0) await exigirVersaoQueAceitaSemItens(ctx, especie, cur.tipo_operacao_versao_id);
  const top = topGravada(cur);
  const n = await nucleoDoLancamento(ctx, especie, edicao.d, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED, {
    top: async () => top,
    parcelasNota: parcelasGravadas(cur.parcelas_nota),
    edicao: {
      documentoId: id,
      parceiros: { fornecedor: "fornecedor_id" in m, transportadora: "transportadora_id" in m, formaPagamento: "forma_pagamento_id" in m },
      // D7: `null` na natureza/centro segue a régua do POST (o par como ficará; o núcleo decide título, par da TOP, provisão).
      // Com rateio trocado, o cabeçalho cat/cc também muda (CHECK) — reconferir.
      classificacao: "categoria_financeira_id" in m || "centro_custo_id" in m || edicao.rateioTrocou ? { trocou: true }
        : { trocou: false, gravada: cur.categoria_financeira_id && cur.centro_custo_id ? { categoriaFinanceiraId: cur.categoria_financeira_id, centroCustoId: cur.centro_custo_id } : null },
      condicao: "condicao_pagamento_id" in m ? { trocou: true }
        : { trocou: false, gravada: cur.condicao_pagamento_id ? await condicaoGravada(ctx, cur.condicao_pagamento_id) : null },
      itensAConferir: edicao.itensAConferir,
      classificacaoDosItens: edicao.classificacaoDosItens,
      rateioTrocou: edicao.rateioTrocou,
      tipoTituloTrocou: "tipo_titulo_id" in m,
      notaDuplicada: "fornecedor_id" in m || "numero_nota" in m || "serie_nota" in m,
      conferirTotais: (totais, itensTotais) => recusaDosTotaisDaEdicaoDeCompra(itensTotais, totais),
      planoMantido: (total) => planoDaEdicaoDeCompra(cur, m, total),
    },
  });

  // Rateio por valor: apagar linhas antigas ANTES de mudar rateio_tipo no cabeçalho (guarda da 0065).
  await gravarRateioDaEdicao(ctx, id, cur, m, "antesDoCabecalho");
  await gravarCabecalho(ctx, especie, id, m, n);
  await gravarRateioDaEdicao(ctx, id, cur, m, "depoisDoCabecalho");
  await gravarItens(ctx, id, edicao, n);
  // D12 (decisão 286): o pedido gravado recalcula o que promete (o pedido aberto nunca foi finalizado: uma leitura,
  // nenhum efeito); a compra gerada de pedido muda o alvo do pedido convertido/encerrado (a soma das partes vivas).
  if (especie === "pedido") await sincronizarProvisaoDoPedidoDeCompra(ctx, id, MOTIVOS_DA_PROVISAO.pedidoGravado);
  else if (pedidoDeOrigem) await sincronizarProvisaoDoPedidoDeCompra(ctx, pedidoDeOrigem, MOTIVOS_DA_PROVISAO_COMPRA.compraAlterada(cur.codigo));
  const depois = await lerDocumentoCompra(ctx, id, especie);
  const enviados = [...Object.keys(m), ...(pedido.campos.itens !== undefined ? ["itens"] : [])];
  const evento = eventoDaEdicaoDeCompra(cur, depois as unknown as DocumentoGravadoDeCompra, enviados);
  await audit(ctx.tx, ctx, "documentos_compra", id, "update", evento.metadados, { before: evento.before, after: evento.after });
  return depois;
}

// ─────────────── rotas ───────────────

/** Registra o `/edicao` e a PATCH das duas espécies. Chamada no fim do registro de `compras.ts`. */
export function registrarEdicaoCompras(app: FastifyInstance): void {
  for (const { especie, segmento, recurso } of ESPECIES) {
    const base = `/compras/${segmento}`;

    /**
     * `GET <base>/:id/edicao` — LEITURA PURA, SEM LOCK (o molde de `vendas-edicao.ts`, 272 item 4; D10).
     *  1. PERMISSÃO: as portas de apoio do lançamento pedem `<recurso>.create` — quem só EDITA levaria 403 nelas. Esta
     *     pede `<recurso>.edit` E `<recurso>.view`, as MESMAS da PATCH (sem `.view` → 403 antes de abrir a transação).
     *  2. VERSÃO: as portas do lançamento respondem pela versão ATUAL da TOP; a PATCH cobra pela CONGELADA. `regras` sai
     *     da congelada; o LAYOUT é o de HOJE da TOP do documento (é o que a PATCH cobra).
     *  3. O MESMO "PODE EDITAR?" e os MESMOS limites da PATCH (`compras-edicao-regras.ts`).
     * EXISTÊNCIA: quem carrega é `lerDocumentoCompra`, o do `GET <base>/:id` — id malformado, inexistente, de outra
     * organização, fora do escopo de empresa e de outra espécie caem na MESMA 404 (mesmo código, mesma mensagem).
     */
    app.get(`${base}/:id/edicao`, async (req) => {
      requirePermission(app.requireCtx(req), `${recurso}.view`);
      return runService(app, req, `${recurso}.edit`, async (ctx): Promise<EdicaoDoDocumentoDeCompra> => {
        const familia = familiaDaEspecie(especie);
        const documento = await lerDocumentoCompra(ctx, (req.params as { id: string }).id, especie);
        const doc = documento as unknown as DocumentoGravadoDeCompra;
        const recusa = await recusaDaEdicaoDeCompra(ctx, doc);
        const limites = await limitesDaEdicaoDeCompra(ctx, doc);
        const regras = await respostaDasRegrasDaCompra(ctx, especie, familia, doc.tipo_operacao_versao_id, {
          execucaoConfiguradaHabilitada: app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED, localDoProdutoNaLinha: app.config.COMPRAS_LOCAL_DO_PRODUTO_ENABLED });
        const layout = await respostaDoLayoutEfetivo(ctx, familia, doc.tipo_operacao_id);
        return { podeEditar: recusa === null, motivo: recusa?.mensagem ?? null, limites, version: doc.version, regras,
          condicoesPermitidas: regras.condicoesPermitidas, layout, documento };
      });
    });

    /**
     * `PATCH <base>/:id` — a ordem ANTES da transação de negócio:
     *   0. a CAPACIDADE: `<recurso>.edit` (a porta) e `<recurso>.view` (a resposta é o documento inteiro) → 403, antes de
     *      ler qualquer coisa, inclusive o corpo;
     *   1. a FORMA do pedido (`lerPedidoDaEdicaoDeCompra`) → 422, antes de ler qualquer registro e de reservar a chave;
     *   2. o documento VISÍVEL (`conferirDocumentoDeCompraVisivel`: o recorte de `lerDocumentoCompra` sem ler o documento;
     *      id malformado e invisível são a MESMA 404 do GET) — antes do helper, que devolveria a resposta gravada sem
     *      passar pelo recorte de empresa;
     *   3. a IDEMPOTÊNCIA: mesma chave + mesmo corpo (canônico, pós-zod, uuid em minúsculas) + mesmo autor → a MESMA
     *      resposta, sem gravar de novo; outro corpo ou outro autor com a mesma chave → 409 CONFLICT do helper;
     *   4. `editarDocumentoDeCompra` (a trava, a versão e o resto).
     */
    app.patch(`${base}/:id`, async (req) => runService(app, req, `${recurso}.edit`, async (ctx) => {
      requirePermission(ctx, `${recurso}.view`);
      const pedido = lerPedidoDaEdicaoDeCompra(req.body, CONTRATO_DA_EDICAO[especie]);
      // COMPRAS-03_R1 (c): o :id em minúsculas ANTES do hash — a mesma URL com outra caixa é o mesmo documento.
      const id = (req.params as { id: string }).id.toLowerCase();
      await conferirDocumentoDeCompraVisivel(ctx, id, especie);
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        { action: "editar_documento_compra", sourceId: id, especie, body: { version: pedido.versao, ...pedido.campos }, actorId: ctx.user.id },
        () => editarDocumentoDeCompra(app, ctx, especie, id, pedido))).result;
    }));
  }
}
