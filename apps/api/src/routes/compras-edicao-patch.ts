import type { z } from "zod";
import { D, DomainError } from "@agro/shared";
import { translateIssue } from "../plugins/errors.js";
import { installmentPlanSchema, type InstallmentPlan } from "../services/financial-core.js";
import { MSG_EDICAO_CORPO_INVALIDO, MSG_EDICAO_VERSAO_AUSENTE, MSG_EDICAO_VERSAO_INVALIDA, MSG_EDICAO_CAMPO_DESCONHECIDO,
  MSG_EDICAO_ITEM_DE_OUTRO_DOCUMENTO, MSG_EDICAO_ITEM_REPETIDO, MSG_EDICAO_CAMPO_OBRIGATORIO, MSG_EDICAO_TOTAL_FORA_DO_LIMITE } from "./vendas-edicao-patch.js";
import type { DocumentoCompraEntrada, LinhaDoRateioDaCompra, PlanoGravado } from "./compras.js";

/**
 * EDITAR-02 (decisão 313) — A PATCH DO PEDIDO DE COMPRA E DA COMPRA: a forma do pedido, o documento como ficará, a regra
 * do plano, os totais na coluna e o evento de histórico. Só funções PURAS (o molde de `vendas-edicao-patch.ts`, EDITAR-01,
 * decisão 272): a leitura com trava, as recusas de estado e os limites (`compras-edicao-regras.ts`), o núcleo de
 * conferências (`nucleoDoLancamento`, em `compras.ts`, o MESMO do POST) e a gravação (`compras-edicao.ts`) moram fora.
 * Nada aqui importa VALOR de `compras.ts` (só tipos): o contrato da PATCH chega por parâmetro, e este módulo carrega sem
 * depender da ordem de avaliação das rotas.
 *
 * DÍVIDA DECLARADA (D13): `versaoCanonica`, `caminho`, `resumoDaRecusa`, `iguais`, `mesmoDecimal` e `planoCanonico` são
 * CÓPIAS das funções privadas de `vendas-edicao-patch.ts` (vendas não se toca nesta fatia). Duas cópias da forma canônica
 * da versão: a fatia que tocar uma das duas deve unificar as duas num módulo neutro. As MENSAGENS são importadas (não
 * copiadas) — o texto é contrato, e é um só.
 */

// ---------------------------------------------------------------------------------------------------------------
// Mensagens próprias da PATCH de compras (o texto é contrato; os testes importam as constantes).
// ---------------------------------------------------------------------------------------------------------------
/** A espécie é identidade do documento (o banco a congela, 0044): pedido e compra são documentos diferentes. */
export const MSG_EDICAO_ESPECIE = "A espécie do documento não muda na edição: pedido e compra são documentos diferentes.";
/** D5 — os dados fiscais do cabeçalho da compra (o texto que o banco usa, 0047 `documentos_compra_nota_guarda`). */
export const MSG_EDICAO_DADOS_FISCAIS = "Os dados fiscais da compra não mudam depois do lançamento.";
/** P1 (decisão do dono) — a lista `itens` traz TODO item salvo: item salvo não sai (nada se apaga, decisão 247). */
export const MSG_EDICAO_ITEM_SALVO_NAO_SAI = "Item salvo não sai do documento: para tirar um item, cancele o documento (o cancelamento estorna) e lance de novo.";

type Detalhe = { path: string; message: string };
const recusa = (details: Detalhe[], message = details[0]!.message) => new DomainError("VALIDATION_ERROR", message, details);

// ---------------------------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------------------------
/** Um item como `lerDocumentoCompra` o devolve (só o que a edição lê). Decimais e datas em TEXTO (os parsers do pool). */
export interface ItemGravadoDeCompra {
  id: string; produto_id: string; armazem_id: string | null; quantidade: string; valor_unitario: string; desconto: string;
  desconto_percentual: string; valor_total: string; lote: string | null; validade: string | null; observacao: string | null; posicao: number;
  origem_item_id: string | null; item_pedido_orcado_id: string | null;
  gera_estoque: boolean | null; imobilizado: boolean | null; categoria_financeira_id: string | null; centro_custo_id: string | null;
  valor_ipi: string | null; valor_icms_st: string | null; n_item_nota: number | null;
  [coluna: string]: unknown;
}
/** O documento como `lerDocumentoCompra` o devolve (só o que a edição lê). `version` é bigint: o pool o devolve como TEXTO. */
export interface DocumentoGravadoDeCompra {
  id: string; codigo: string; especie: string; situacao: string; version: string; empresa_id: string;
  tipo_operacao_id: string; tipo_operacao_versao_id: string;
  tipo_operacao: { id: string; codigo: string; nome: string; versao: number | null; codigoBase: string | null } | null;
  fornecedor_id: string; transportadora_id: string | null; data_documento: string; data_entrada: string | null; data_vencimento: string | null;
  numero_nota: string | null; serie_nota: string | null; categoria_financeira_id: string | null; centro_custo_id: string | null;
  condicao_pagamento_id: string | null; plano_parcelas: Record<string, unknown> | null; parcelas_ajustadas: boolean;
  forma_pagamento_id: string | null; frete: string; outras_despesas: string; desconto: string; valor_itens: string; valor_total: string;
  observacao: string | null; origem_documento_id: string | null;
  chave_acesso: string | null; uf_nota: string | null; tipo_documento_fiscal: string | null; valor_ipi: string | null; valor_icms_st: string | null;
  seguro: string | null; tipo_titulo_id: string | null; classificacao_gasto: string | null; rateio_tipo: string | null; parcelas_nota: unknown;
  /** A DF-e ligada (só a importação do XML a grava, OPERACOES-01 F7). */
  dfe_id: string | null;
  /** A importação do XML que GEROU a compra (`erp.importacoes_nfe_compra.documento_compra_id`); a chave só vem quando há. */
  importacao_id?: string;
  itens: ItemGravadoDeCompra[];
  compras_geradas?: { id: string; codigo: string; situacao: string }[];
  rateio?: LinhaDoRateioDaCompra[];
  [coluna: string]: unknown;
}
/** Um item do corpo da PATCH depois do zod: com `id` é item DESTE documento (campo ausente = o gravado); sem `id` é novo. */
export interface ItemDaEdicaoDeCompra {
  id?: string | undefined; produto_id?: string | undefined; armazem_id?: string | null | undefined; quantidade?: string | undefined;
  valor_unitario?: string | undefined; desconto?: string | undefined; desconto_percentual?: string | undefined; lote?: string | null | undefined;
  validade?: string | null | undefined; observacao?: string | null | undefined; gera_estoque?: boolean | null | undefined;
  imobilizado?: boolean | null | undefined; categoria_financeira_id?: string | null | undefined; centro_custo_id?: string | null | undefined;
  valor_ipi?: string | null | undefined; valor_icms_st?: string | null | undefined;
}
/** Os campos da PATCH depois do zod — só os que vieram. */
export interface CamposDaEdicaoDeCompra {
  fornecedor_id?: string | undefined; transportadora_id?: string | null | undefined; data_documento?: string | undefined;
  data_entrada?: string | null | undefined; data_vencimento?: string | null | undefined; numero_nota?: string | null | undefined;
  serie_nota?: string | null | undefined; categoria_financeira_id?: string | null | undefined; centro_custo_id?: string | null | undefined;
  condicao_pagamento_id?: string | null | undefined; plano_parcelas?: InstallmentPlan | null | undefined; forma_pagamento_id?: string | null | undefined;
  frete?: string | undefined; outras_despesas?: string | undefined; desconto?: string | undefined; observacao?: string | null | undefined;
  itens?: ItemDaEdicaoDeCompra[] | undefined;
}
/** O contrato da PATCH de uma espécie (`CONTRATO_DA_EDICAO`, em `compras.ts`). */
export interface ContratoDaEdicaoDeCompra {
  schema: z.ZodType<CamposDaEdicaoDeCompra>;
  /** As chaves que o schema aceita (a lista do contrato). */
  chaves: ReadonlySet<string>;
  /** Chave do cabeçalho com recusa PRÓPRIA (422 no campo, com a chave presente, qualquer valor). */
  recusasDeChave: Readonly<Record<string, string>>;
  /** Chave do item com recusa própria (o pedido: lote, validade e dados fiscais do item). */
  recusasDeChaveDoItem: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. A FORMA DO PEDIDO — conferida ANTES de qualquer leitura de registro e de reservar a chave de idempotência.
// ---------------------------------------------------------------------------------------------------------------
/** Cópia de `vendas-edicao-patch.ts` (D13): a versão bigint na forma CANÔNICA (sem zero à esquerda), dentro do bigint. */
const FORMA_VERSAO = /^(0|[1-9]\d{0,18})$/;
const VERSAO_MAXIMA = 9223372036854775807n;
function versaoCanonica(v: unknown): string | null {
  if (typeof v === "string" && FORMA_VERSAO.test(v) && BigInt(v) <= VERSAO_MAXIMA) return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  return null;
}
/** Item NOVO (sem `id`) exige produto, quantidade e valor unitário — os obrigatórios do item do POST. */
const OBRIGATORIOS_DO_ITEM_NOVO = ["produto_id", "quantidade", "valor_unitario"] as const;
function faltandoNosItensNovos(itens: readonly ItemDaEdicaoDeCompra[] | undefined): Detalhe[] {
  return (itens ?? []).flatMap((e, k) => e.id !== undefined ? []
    : OBRIGATORIOS_DO_ITEM_NOVO.filter((f) => e[f] === undefined).map((f) => ({ path: `itens[${k}].${f}`, message: MSG_EDICAO_CAMPO_OBRIGATORIO })));
}
/** Cópia (D13): a mesma mensagem-resumo que o tratador global dá ao 422 do zod. */
function resumoDaRecusa(det: readonly Detalhe[]): string {
  const faltando = det.filter((x) => x.message === MSG_EDICAO_CAMPO_OBRIGATORIO).map((x) => x.path);
  return faltando.length ? `Campos obrigatórios pendentes: ${faltando.join(", ")}` : det.length === 1 && det[0]!.path ? `${det[0]!.path}: ${det[0]!.message}` : "Dados inválidos";
}
/** Cópia (D13): `itens.0.id` do zod vira `itens[0].id` — o caminho que as recusas de item do POST já usam. */
function caminho(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, s) => (typeof s === "number" ? `${acc}[${s}]` : acc ? `${acc}.${String(s)}` : String(s)), "");
}
const temChave = (o: Readonly<Record<string, string>>, chave: string) => Object.hasOwn(o, chave);

/**
 * O CORPO É ESTRITO: `{ version, ...só os campos que mudam }`.
 *
 * As recusas de CHAVE saem JUNTAS (a 272): as próprias do contrato (empresa, TOP e versão congelada, espécie, dados
 * fiscais do cabeçalho da compra; no pedido, a nota, a entrada, os dados fiscais, o lote e a validade — o texto do POST),
 * a versão ausente ou torta e a chave desconhecida ("Campo não reconhecido…", nunca descartada: um typo não pode virar
 * "salvei sem mudar nada" com 200). Depois, o zod (os validadores do POST, sem `default`; os números na forma e no
 * limite da coluna) e o item novo incompleto. Tudo aqui é forma — nada lê o banco, e a chave de idempotência ainda não
 * foi reservada.
 */
export function lerPedidoDaEdicaoDeCompra(corpo: unknown, contrato: ContratoDaEdicaoDeCompra): { versao: string; campos: CamposDaEdicaoDeCompra } {
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) throw recusa([{ path: "", message: MSG_EDICAO_CORPO_INVALIDO }]);
  const cru = corpo as Record<string, unknown>;
  const detalhes: Detalhe[] = [];
  for (const chave of Object.keys(cru)) {
    if (chave !== "version" && temChave(contrato.recusasDeChave, chave)) detalhes.push({ path: chave, message: contrato.recusasDeChave[chave]! });
  }
  const itensCrus = cru["itens"];
  if (Array.isArray(itensCrus)) {
    itensCrus.forEach((item: unknown, k) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return;
      for (const chave of Object.keys(item)) {
        if (temChave(contrato.recusasDeChaveDoItem, chave)) detalhes.push({ path: `itens[${k}].${chave}`, message: contrato.recusasDeChaveDoItem[chave]! });
      }
    });
  }
  const versao = cru["version"] === undefined ? null : versaoCanonica(cru["version"]);
  if (cru["version"] === undefined) detalhes.push({ path: "version", message: MSG_EDICAO_VERSAO_AUSENTE });
  else if (versao === null) detalhes.push({ path: "version", message: MSG_EDICAO_VERSAO_INVALIDA });
  for (const chave of Object.keys(cru)) {
    if (chave === "version" || temChave(contrato.recusasDeChave, chave) || contrato.chaves.has(chave)) continue;
    detalhes.push({ path: chave, message: MSG_EDICAO_CAMPO_DESCONHECIDO });
  }
  if (detalhes.length || versao === null) throw recusa(detalhes);
  const { version: _versao, ...resto } = cru;
  const r = contrato.schema.safeParse(resto);
  if (!r.success) {
    const det: Detalhe[] = r.error.issues.flatMap((i) => i.code === "unrecognized_keys"
      ? i.keys.map((k) => ({ path: caminho([...i.path, k]), message: MSG_EDICAO_CAMPO_DESCONHECIDO }))
      : [{ path: caminho(i.path), message: translateIssue(i) }]);
    throw recusa(det, resumoDaRecusa(det));
  }
  // Item novo incompleto também é FORMA: 422 antes de ler — num documento confirmado não vira 409.
  const faltando = faltandoNosItensNovos(r.data.itens);
  if (faltando.length) throw recusa(faltando, resumoDaRecusa(faltando));
  return { versao, campos: r.data };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. O DOCUMENTO COMO FICARÁ — o gravado + o que muda.
// ---------------------------------------------------------------------------------------------------------------
type Tipo = "uuid" | "data" | "texto" | "decimal" | "booleano";
/** Os campos de cabeçalho que a PATCH pode trocar, e como se compara cada um com o gravado. Lista ESTÁTICA. */
const CABECALHO = {
  fornecedor_id: "uuid", transportadora_id: "uuid", data_documento: "data", data_entrada: "data", data_vencimento: "data",
  numero_nota: "texto", serie_nota: "texto", categoria_financeira_id: "uuid", centro_custo_id: "uuid", condicao_pagamento_id: "uuid",
  forma_pagamento_id: "uuid", frete: "decimal", outras_despesas: "decimal", desconto: "decimal", observacao: "texto",
} as const satisfies Record<string, Tipo>;
export type CampoDoCabecalhoDeCompra = keyof typeof CABECALHO;
/** As colunas do cabeçalho que a PATCH grava quando mudam (lista estática: o SQL só monta identificador daqui). */
export const CAMPOS_DO_CABECALHO_DA_EDICAO = Object.keys(CABECALHO) as CampoDoCabecalhoDeCompra[];

/** Os campos do item que a PATCH pode trocar (os do item do POST), e como se compara cada um. Lista ESTÁTICA. */
const ITEM = {
  produto_id: "uuid", armazem_id: "uuid", quantidade: "decimal", valor_unitario: "decimal", desconto: "decimal", desconto_percentual: "decimal",
  lote: "texto", validade: "data", observacao: "texto", gera_estoque: "booleano", imobilizado: "booleano",
  categoria_financeira_id: "uuid", centro_custo_id: "uuid", valor_ipi: "decimal", valor_icms_st: "decimal",
} as const satisfies Record<string, Tipo>;
export type CampoDoItemDeCompra = keyof typeof ITEM;
/** Os campos do item que mudam o "pode entrar?" do item (`conferirItens`): produto, local, lote, validade, gera estoque. */
const CAMPOS_DA_CONFERENCIA_DO_ITEM: readonly CampoDoItemDeCompra[] = ["produto_id", "armazem_id", "lote", "validade", "gera_estoque"];
/** Os campos do item que formam o total dele (o valor total da linha é refeito quando um deles muda). */
export const CAMPOS_DO_TOTAL_DO_ITEM: readonly CampoDoItemDeCompra[] = ["quantidade", "valor_unitario", "desconto", "desconto_percentual"];

/** Cópia (D13) de `iguais`: ausente/nulo, UUID sem caixa, decimal pelo valor, o resto pelo texto. */
function iguais(tipo: Tipo, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (tipo === "uuid") return String(a).toLowerCase() === String(b).toLowerCase();
  if (tipo === "decimal") return D(String(a)).eq(D(String(b)));
  return String(a) === String(b);
}
/** Cópia (D13): decimal igual, sem explodir — texto que não é número nunca é "igual". */
function mesmoDecimal(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  try { return D(String(a)).eq(D(String(b))); } catch { return false; }
}
/** Cópia (D13), sem a marca de dedutível (a compra não a tem): o plano na forma CANÔNICA do schema estrito, ou nada. */
function planoCanonico(p: unknown): InstallmentPlan | null {
  if (p === null || typeof p !== "object" || Array.isArray(p)) return null;
  const r = installmentPlanSchema.strict().safeParse(p);
  return r.success ? r.data : null;
}
/**
 * "Igual ao gravado" compara VALORES canônicos (a régua da 272, EDITAR-01_R1 1.2 j): reenviar o plano que já está lá
 * não é decisão nova — não grava, não sobe a versão e não congela como "ajustado à mão" um plano derivado da condição.
 *   objeto → igual se, com os padrões, cada campo tem o mesmo valor (a entrada comparada como decimal);
 *   null   → igual só quando não há plano gravado nem condição (nada a remover, nada a derivar).
 */
function planoIgualAoGravado(cur: DocumentoGravadoDeCompra, enviado: InstallmentPlan | null): boolean {
  if (enviado === null) return cur.plano_parcelas === null && cur.condicao_pagamento_id === null;
  const g = planoCanonico(cur.plano_parcelas);
  if (!g) return false;
  return g.installments === enviado.installments && g.first_due_date === enviado.first_due_date && g.mode === enviado.mode
    && g.interval_days === enviado.interval_days && g.due_day === enviado.due_day && g.has_down_payment === enviado.has_down_payment
    && g.down_payment_date === enviado.down_payment_date && mesmoDecimal(g.down_payment_value, enviado.down_payment_value);
}

type ItemComoFicara = DocumentoCompraEntrada["itens"][number];
const itemDoGravado = (g: ItemGravadoDeCompra): ItemComoFicara => ({
  produto_id: g.produto_id, armazem_id: g.armazem_id, quantidade: g.quantidade, valor_unitario: g.valor_unitario, desconto: g.desconto,
  desconto_percentual: g.desconto_percentual, lote: g.lote, validade: g.validade, observacao: g.observacao, gera_estoque: g.gera_estoque,
  imobilizado: g.imobilizado, categoria_financeira_id: g.categoria_financeira_id, centro_custo_id: g.centro_custo_id,
  valor_ipi: g.valor_ipi, valor_icms_st: g.valor_icms_st,
});

/**
 * Como os itens são gravados:
 *   manter → a PATCH sem `itens` (ou com a lista igual à gravada): NENHUMA linha de item é tocada.
 *   porId  → a lista nova completa, gravada em lugar: UPDATE dos alterados SÓ com as colunas que mudaram (`mudados[k]`,
 *            `posicao` inclusive — D2: os gatilhos dos itens disparam por COLUNA citada, não por valor), INSERT dos
 *            novos (`ids[k]` nulo). Nenhum DELETE: item salvo não sai (P1).
 */
export type ItensDaEdicaoDeCompra =
  | { modo: "manter" }
  | { modo: "porId"; ids: readonly (string | null)[]; mudados: readonly (readonly (CampoDoItemDeCompra | "posicao")[])[] };

export interface EdicaoDeCompraComoFicara {
  /** Só os campos de cabeçalho (e o plano) cujo valor MUDA — o igual ao gravado sai. */
  mudancas: Record<string, unknown>;
  /** O documento como ficará, na forma do corpo do POST, para o núcleo único conferir. */
  d: DocumentoCompraEntrada;
  /** Para cada `d.itens[k]`, o item gravado que ele É (por id) — `undefined` para o item novo. */
  pares: (ItemGravadoDeCompra | undefined)[];
  itens: ItensDaEdicaoDeCompra;
  /** As posições que o núcleo confere (`conferirItens`): novas, ou com produto/local/lote/validade/gera estoque trocados. */
  itensAConferir: Set<number>;
  /** As posições novas, ou com natureza/centro trocados (o rateio por produto). */
  classificacaoDosItens: Set<number>;
  /** Algum campo (ou item) muda de fato. */
  mudou: boolean;
}

/** O rateio GRAVADO na forma do corpo do POST (o tipo é imutável desde a 0047; as linhas por valor, também). */
function rateioGravado(cur: DocumentoGravadoDeCompra): DocumentoCompraEntrada["rateio"] {
  if (cur.rateio_tipo === "por_produto") return { tipo: "por_produto" };
  if (cur.rateio_tipo !== "por_valor") return null;
  return { tipo: "por_valor", linhas: (cur.rateio ?? []).map((l) => ({ categoria_financeira_id: l.categoria_financeira_id, centro_custo_id: l.centro_custo_id,
    conta_contabil_id: l.conta_contabil_id, safra_id: l.safra_id, percentual: l.percentual })) };
}

/**
 * CABEÇALHO: ausente = fica o gravado; `null` = limpa (o zod só aceita `null` onde o POST aceita); valor = troca. Valor
 * IGUAL ao gravado não é mudança e sai de `mudancas` — é isso que faz "a PATCH troca a condição" (e só então ela é
 * conferida) significar o que diz, com o MESMO núcleo do POST.
 *
 * ITENS: ausentes = intactos. Presentes = a lista nova completa, que traz TODO item salvo (P1): com `id` é item DESTE
 * documento (o que não vem fica o gravado — origem, item orçado e a linha da nota inclusive); sem `id` é novo. `id` de
 * outro documento (ou inexistente — indistinguíveis: a conferência é contra os itens DESTE documento, sem consulta) e
 * `id` repetido → 422 em `itens[k].id`; item salvo ausente → 422 em `itens` (`MSG_EDICAO_ITEM_SALVO_NAO_SAI`). As
 * recusas saem juntas.
 */
export function edicaoDeCompraComoFicara(cur: DocumentoGravadoDeCompra, campos: CamposDaEdicaoDeCompra): EdicaoDeCompraComoFicara {
  const mudancas: Record<string, unknown> = {};
  for (const [campo, tipo] of Object.entries(CABECALHO) as [CampoDoCabecalhoDeCompra, Tipo][]) {
    const v = campos[campo];
    if (v !== undefined && !iguais(tipo, v, cur[campo])) mudancas[campo] = v;
  }
  if (campos.plano_parcelas !== undefined && !planoIgualAoGravado(cur, campos.plano_parcelas)) mudancas["plano_parcelas"] = campos.plano_parcelas;

  let pares: (ItemGravadoDeCompra | undefined)[] = cur.itens;
  let itens: ItemComoFicara[] = cur.itens.map(itemDoGravado);
  let modo: ItensDaEdicaoDeCompra = { modo: "manter" };
  const itensAConferir = new Set<number>();
  const classificacaoDosItens = new Set<number>();
  if (campos.itens !== undefined) {
    const porId = new Map(cur.itens.map((i) => [i.id.toLowerCase(), i]));
    const vistos = new Set<string>();
    const detalhes: Detalhe[] = [];
    const novos: { item: ItemComoFicara; par: ItemGravadoDeCompra | undefined; mudados: (CampoDoItemDeCompra | "posicao")[] }[] = [];
    campos.itens.forEach((e, k) => {
      if (e.id !== undefined) {
        const chave = e.id.toLowerCase();
        const g = porId.get(chave);
        if (!g) { detalhes.push({ path: `itens[${k}].id`, message: MSG_EDICAO_ITEM_DE_OUTRO_DOCUMENTO }); return; }
        if (vistos.has(chave)) { detalhes.push({ path: `itens[${k}].id`, message: MSG_EDICAO_ITEM_REPETIDO }); return; }
        vistos.add(chave);
        // Valor canonicamente IGUAL ao gravado fica com a grafia gravada (UUID em maiúsculas é o mesmo registro).
        const item = itemDoGravado(g) as Record<CampoDoItemDeCompra, unknown>;
        const mudados: (CampoDoItemDeCompra | "posicao")[] = [];
        for (const [f, t] of Object.entries(ITEM) as [CampoDoItemDeCompra, Tipo][]) {
          const v = e[f];
          if (v !== undefined && !iguais(t, v, g[f])) { item[f] = v; mudados.push(f); }
        }
        if (g.posicao !== k) mudados.push("posicao");
        novos.push({ item: item as ItemComoFicara, par: g, mudados });
        return;
      }
      // Já conferido na forma (`lerPedidoDaEdicaoDeCompra`); repetido aqui só como defesa de quem chamar sem ela.
      const faltando = OBRIGATORIOS_DO_ITEM_NOVO.filter((f) => e[f] === undefined);
      for (const f of faltando) detalhes.push({ path: `itens[${k}].${f}`, message: MSG_EDICAO_CAMPO_OBRIGATORIO });
      if (faltando.length) return;
      novos.push({
        item: { produto_id: e.produto_id!, armazem_id: e.armazem_id ?? null, quantidade: e.quantidade!, valor_unitario: e.valor_unitario!,
          desconto: e.desconto ?? "0", desconto_percentual: e.desconto_percentual ?? "0", lote: e.lote ?? null, validade: e.validade ?? null,
          observacao: e.observacao ?? null, gera_estoque: e.gera_estoque ?? null, imobilizado: e.imobilizado ?? null,
          categoria_financeira_id: e.categoria_financeira_id ?? null, centro_custo_id: e.centro_custo_id ?? null,
          valor_ipi: e.valor_ipi ?? null, valor_icms_st: e.valor_icms_st ?? null },
        par: undefined, mudados: [],
      });
    });
    // P1: TODO item salvo vem na lista (nenhum DELETE, nenhuma exclusão lógica, nenhuma quantidade zero).
    if (cur.itens.some((i) => !vistos.has(i.id.toLowerCase()))) detalhes.push({ path: "itens", message: MSG_EDICAO_ITEM_SALVO_NAO_SAI });
    if (detalhes.length) throw recusa(detalhes);
    // A lista enviada IGUAL à gravada (mesmos ids, mesma ordem, mesmos valores) não é mudança: nenhuma linha é tocada.
    if (novos.some((n) => n.par === undefined || n.mudados.length > 0)) {
      pares = novos.map((n) => n.par);
      itens = novos.map((n) => n.item);
      modo = { modo: "porId", ids: novos.map((n) => n.par?.id ?? null), mudados: novos.map((n) => n.mudados) };
      novos.forEach((n, k) => {
        if (n.par === undefined || n.mudados.some((f) => (CAMPOS_DA_CONFERENCIA_DO_ITEM as readonly string[]).includes(f))) itensAConferir.add(k);
        if (n.par === undefined || n.mudados.some((f) => f === "categoria_financeira_id" || f === "centro_custo_id")) classificacaoDosItens.add(k);
      });
    }
  }

  const valor = <C extends CampoDoCabecalhoDeCompra>(c: C) => (c in mudancas ? mudancas[c] : cur[c]) as DocumentoGravadoDeCompra[C];
  const d: DocumentoCompraEntrada = {
    empresa_id: cur.empresa_id, tipo_operacao_id: cur.tipo_operacao_id,
    fornecedor_id: valor("fornecedor_id"), transportadora_id: valor("transportadora_id"), data_documento: valor("data_documento"),
    data_entrada: valor("data_entrada"), data_vencimento: valor("data_vencimento"), numero_nota: valor("numero_nota"), serie_nota: valor("serie_nota"),
    categoria_financeira_id: valor("categoria_financeira_id"), centro_custo_id: valor("centro_custo_id"), condicao_pagamento_id: valor("condicao_pagamento_id"),
    // O plano IGUAL ao gravado não é mudança — e não entra como "plano enviado": se a condição ou o total mudarem, o
    // plano derivado é refeito pela conta do POST, como se o plano não tivesse vindo.
    plano_parcelas: "plano_parcelas" in mudancas ? campos.plano_parcelas : undefined,
    forma_pagamento_id: valor("forma_pagamento_id"), frete: valor("frete"), outras_despesas: valor("outras_despesas"), desconto: valor("desconto"),
    observacao: valor("observacao"), itens,
    // Os dados fiscais do cabeçalho: os GRAVADOS (imutáveis, 0047) — entram no total e nas conferências como no POST.
    chave_acesso: cur.chave_acesso, uf_nota: cur.uf_nota,
    tipo_documento_fiscal: cur.tipo_documento_fiscal as DocumentoCompraEntrada["tipo_documento_fiscal"],
    valor_ipi: cur.valor_ipi, valor_icms_st: cur.valor_icms_st, seguro: cur.seguro, tipo_titulo_id: cur.tipo_titulo_id,
    classificacao_gasto: cur.classificacao_gasto as DocumentoCompraEntrada["classificacao_gasto"],
    rateio: rateioGravado(cur),
  };
  return { mudancas, d, pares, itens: modo, itensAConferir, classificacaoDosItens, mudou: Object.keys(mudancas).length > 0 || modo.modo === "porId" };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. A REGRA DO PLANO (A22 da 272, com o "vazio" de compras: `null`)
// ---------------------------------------------------------------------------------------------------------------
/**
 * O PLANO NA PATCH — campo não enviado só muda se for DERIVADO de um campo que mudou:
 *   a) a PATCH envia `plano_parcelas` (objeto ou null) DIFERENTE do gravado → a conta do POST com o enviado;
 *   b) a PATCH troca a condição (ou a remove)                               → a conta do POST;
 *   c) o plano gravado é DERIVADO da condição (há condição e `parcelas_ajustadas` = false) e mudou a data do documento
 *      ou o total → a conta do POST (o 1º vencimento e as parcelas saem da data e do total);
 *   d) qualquer outro caso → o plano GRAVADO fica, byte a byte, e `parcelas_ajustadas` também.
 * Devolve `null` para "a conta do POST" (`nucleoDoLancamento`), ou o plano a MANTER. Com as duplicatas da nota
 * (`parcelas_nota`) o POST grava plano nulo (o CHECK da 0047), e a PATCH não deixa trocar condição nem plano (P3).
 */
export function planoDaEdicaoDeCompra(cur: DocumentoGravadoDeCompra, mudancas: Record<string, unknown>, total: string): { plano: PlanoGravado | null; ajustadas: boolean } | null {
  if ("plano_parcelas" in mudancas || "condicao_pagamento_id" in mudancas) return null;
  const derivado = cur.condicao_pagamento_id !== null && cur.parcelas_ajustadas !== true;
  if (derivado && ("data_documento" in mudancas || !D(total).eq(D(cur.valor_total)))) return null;
  return { plano: cur.plano_parcelas, ajustadas: cur.parcelas_ajustadas === true };
}

/**
 * O TOTAL CALCULADO CABE NA COLUNA? O total de cada item, `valor_itens` e `valor_total` são numeric(18,2): até 16 dígitos
 * inteiros. Os valores conferidos são EXATAMENTE os que serão gravados (a conta do domínio do núcleo), sem arredondar:
 * o que não cabe é 422 no campo, e não o 500 do estouro numérico do banco.
 */
const TETO_DA_COLUNA_DE_DINHEIRO = D("1e16");
export function recusaDosTotaisDaEdicaoDeCompra(itensTotais: readonly string[], totais: { valorItens: string; total: string }): void {
  const estoura = (v: string) => D(v).abs().gte(TETO_DA_COLUNA_DE_DINHEIRO);
  const detalhes: Detalhe[] = [];
  itensTotais.forEach((t, k) => { if (estoura(t)) detalhes.push({ path: `itens[${k}].valor_total`, message: MSG_EDICAO_TOTAL_FORA_DO_LIMITE }); });
  if (estoura(totais.valorItens)) detalhes.push({ path: "valor_itens", message: MSG_EDICAO_TOTAL_FORA_DO_LIMITE });
  if (estoura(totais.total)) detalhes.push({ path: "valor_total", message: MSG_EDICAO_TOTAL_FORA_DO_LIMITE });
  if (detalhes.length) throw recusa(detalhes);
}

// ---------------------------------------------------------------------------------------------------------------
// 4. O HISTÓRICO
// ---------------------------------------------------------------------------------------------------------------
/** Colunas do cabeçalho comparadas no evento (lista estática): as editáveis e as derivadas (totais, plano). */
const COLUNAS_DO_EVENTO = [...CAMPOS_DO_CABECALHO_DA_EDICAO, "plano_parcelas", "parcelas_ajustadas", "valor_itens", "valor_total"] as const;
// `posicao` entra: reordenar é uma gravação (a versão sobe), e o evento tem de dizer o que foi gravado.
const CAMPOS_DO_ITEM_NO_EVENTO = [...(Object.keys(ITEM) as CampoDoItemDeCompra[]), "valor_total", "posicao"] as const;
const mesmo = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const linhaDoItem = (i: ItemGravadoDeCompra) => Object.fromEntries([["id", i.id], ...CAMPOS_DO_ITEM_NO_EVENTO.map((c) => [c, i[c]])]) as Record<string, unknown>;

/**
 * O EVENTO DA PATCH — `update` com `{ via: "patch", campos, derivados }` e `before`/`after` SÓ do que mudou (o molde de
 * `eventoDaEdicao` da 272). O gatilho `erp.audit_row` já grava a linha INTEIRA do cabeçalho; os itens não têm gatilho:
 *   before/after.<campo>        → o valor antes → depois de cada campo do cabeçalho que mudou (pedido ou derivado);
 *   before.itens.alterados[]    → `{ id, <campo>: antes }` só dos campos do item que mudaram;
 *   after.itens.alterados[]     → `{ id, <campo>: depois }`;
 *   after.itens.incluidos[]     → a linha nova inteira (com o id que ela ganhou).
 * Não há `removidos`: item salvo não sai (P1). `campos` = tudo que mudou (inclui `itens`); `derivados` = o que mudou sem
 * ter sido enviado (totais, plano). Antes e depois são LIDOS do banco: o evento descreve o gravado.
 */
export function eventoDaEdicaoDeCompra(antes: DocumentoGravadoDeCompra, depois: DocumentoGravadoDeCompra, enviados: readonly string[]) {
  const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {};
  const campos: string[] = [];
  for (const c of COLUNAS_DO_EVENTO) {
    if (mesmo(antes[c], depois[c])) continue;
    campos.push(c); before[c] = antes[c] ?? null; after[c] = depois[c] ?? null;
  }
  const porIdAntes = new Map(antes.itens.map((i) => [i.id, i]));
  const alteradosAntes: Record<string, unknown>[] = []; const alteradosDepois: Record<string, unknown>[] = [];
  for (const d of depois.itens) {
    const a = porIdAntes.get(d.id);
    if (!a) continue;
    const mudaram = CAMPOS_DO_ITEM_NO_EVENTO.filter((c) => !mesmo(a[c], d[c]));
    if (!mudaram.length) continue;
    alteradosAntes.push(Object.fromEntries([["id", d.id], ...mudaram.map((c) => [c, a[c]])]));
    alteradosDepois.push(Object.fromEntries([["id", d.id], ...mudaram.map((c) => [c, d[c]])]));
  }
  const incluidos = depois.itens.filter((i) => !porIdAntes.has(i.id)).map(linhaDoItem);
  if (alteradosAntes.length || incluidos.length) {
    campos.push("itens");
    before["itens"] = { alterados: alteradosAntes };
    after["itens"] = { alterados: alteradosDepois, incluidos };
  }
  const derivados = campos.filter((c) => !enviados.includes(c));
  return { metadados: { via: "patch" as const, campos, derivados }, before, after };
}
