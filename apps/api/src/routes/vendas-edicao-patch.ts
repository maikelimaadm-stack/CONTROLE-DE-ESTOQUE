import type { z } from "zod";
import { D, DomainError } from "@agro/shared";
import { documentTotals } from "@agro/domain";
import { translateIssue } from "../plugins/errors.js";
import type { InstallmentPlan } from "../services/financial-core.js";

/**
 * EDITAR-01 (decisão 272, item 1.2) — A PATCH DO DOCUMENTO DE VENDA: a forma do pedido, o documento como ficará, a
 * regra do plano e o evento de histórico. Só funções PURAS: a leitura com trava, as recusas e a gravação moram em
 * `sales.ts` (o núcleo `salvarEdicao`, o MESMO do PUT). Separar assim evita import circular entre as rotas e deixa
 * a PATCH sem nenhuma regra de negócio própria — ela só traduz "o que mudou" em "o documento como ficará".
 */

// ---------------------------------------------------------------------------------------------------------------
// Mensagens (o T1 importa estas constantes: o texto é contrato).
// ---------------------------------------------------------------------------------------------------------------
export const MSG_EDICAO_CORPO_INVALIDO = "O corpo da edição deve ser um objeto com a versão e os campos que mudam.";
export const MSG_EDICAO_EMPRESA = "A empresa não muda na edição do documento.";
export const MSG_EDICAO_TROCA_DE_OPERACAO = "Trocar a operação não é edição: cancele e lance de novo na operação certa.";
export const MSG_EDICAO_VERSAO_AUSENTE = "Informe a versão do documento que você abriu.";
export const MSG_EDICAO_VERSAO_INVALIDA = "Versão inválida: envie a versão que o documento devolveu.";
export const MSG_EDICAO_CAMPO_DESCONHECIDO = "Campo não reconhecido na edição do documento.";
export const MSG_EDICAO_ITEM_DE_OUTRO_DOCUMENTO = "Este item não é deste documento.";
export const MSG_EDICAO_ITEM_REPETIDO = "Este item aparece mais de uma vez na lista.";
export const MSG_EDICAO_CAMPO_OBRIGATORIO = "Campo obrigatório";
/** 409 CONCURRENCY_CONFLICT: a versão enviada não é a gravada. */
export const MSG_DOCUMENTO_MUDOU = "Este documento mudou desde que você o abriu. Recarregue antes de salvar.";

// ---------------------------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------------------------
/** Um item como o `getDoc` o devolve (só o que a edição lê). */
export interface ItemGravado {
  id: string; origem_item_id: string | null; product_id: string; product_control_stock: boolean; warehouse_id: string | null;
  quantity: string; unit_price: string; discount: string; discount_percent: string; note: string | null; position: number; total: string;
}
/** O documento como o `getDoc` o devolve (só o que a edição lê). `version` é bigint: o pool o devolve como TEXTO. */
export interface DocumentoGravado {
  id: string; status: string; kind: string; version: string; empresa_id: string; client_id: string; reserva_estoque: boolean;
  tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null; origin_document_id: string | null;
  categoria_financeira_id: string | null; centro_custo_id: string | null; condicao_pagamento_id: string | null;
  document_date: string; shipping_date: string | null; due_date: string | null; transporter_id: string | null; proprietary_id: string | null;
  driver_name: string | null; payment_method_id: string | null; freight: string; freight_icms: string; other_values: string; discount: string;
  subtotal: string; total: string; note: string | null; installment_plan: Record<string, unknown> | null; parcelas_ajustadas: boolean | null;
  items: ItemGravado[];
  [coluna: string]: unknown;
}
/** Um item do corpo da PATCH: com `id` é item DESTE documento (campo ausente = o gravado); sem `id` é novo. */
export interface ItemDaEdicao {
  id?: string | undefined; product_id?: string | undefined; warehouse_id?: string | null | undefined; quantity?: string | undefined;
  unit_price?: string | undefined; discount?: string | undefined; discount_percent?: string | undefined; note?: string | null | undefined;
}
/** Os campos da PATCH depois do zod — só os que vieram. */
export interface CamposDaEdicao {
  document_date?: string | undefined; shipping_date?: string | null | undefined; due_date?: string | null | undefined; client_id?: string | undefined;
  transporter_id?: string | null | undefined; proprietary_id?: string | null | undefined; driver_name?: string | null | undefined;
  payment_method_id?: string | null | undefined; freight?: string | undefined; freight_icms?: string | undefined; other_values?: string | undefined;
  discount?: string | undefined; note?: string | null | undefined; installment_plan?: InstallmentPlan | null | undefined;
  is_deductible?: boolean | undefined; items?: ItemDaEdicao[] | undefined; categoria_financeira_id?: string | null | undefined;
  centro_custo_id?: string | null | undefined; condicao_pagamento_id?: string | null | undefined;
}
/** Um item do documento como ficará — a forma do item do `docSchema` do PUT. */
export interface ItemComoFicara { product_id: string; warehouse_id: string | null; quantity: string; unit_price: string; discount: string; discount_percent: string; note: string | null }
/** O documento como ficará — a forma do `docSchema` do PUT, para o núcleo único gravar os dois. */
export interface DocumentoComoFicara {
  empresa_id: string; document_date: string; shipping_date: string | null; due_date: string | null; client_id: string;
  transporter_id: string | null; proprietary_id: string | null; driver_name: string | null; payment_method_id: string | null;
  freight: string; freight_icms: string; other_values: string; discount: string; note: string | null;
  installment_plan: InstallmentPlan | null | undefined; is_deductible: boolean; items: ItemComoFicara[];
  tipo_operacao_id: string | null; categoria_financeira_id: string | null; centro_custo_id: string | null; condicao_pagamento_id: string | null;
}
/**
 * Como os itens são gravados:
 *   manter → a PATCH sem `items` (ou com a lista igual à gravada): NENHUMA linha de item é tocada.
 *   porId  → a lista nova completa, gravada em lugar: UPDATE dos alterados (mesmo id e `origem_item_id`), INSERT dos
 *            novos, DELETE dos que saíram, `position` = índice.
 */
export type ItensDaEdicao =
  | { modo: "manter" }
  | { modo: "porId"; ids: readonly (string | null)[]; alterados: readonly boolean[]; removidos: readonly string[] };

type Detalhe = { path: string; message: string };
const recusa = (details: Detalhe[], message = details[0]!.message) => new DomainError("VALIDATION_ERROR", message, details);

// ---------------------------------------------------------------------------------------------------------------
// 1. A FORMA DO PEDIDO — conferida ANTES de qualquer leitura de registro e de reservar a chave de idempotência.
// ---------------------------------------------------------------------------------------------------------------
const FORMA_VERSAO = /^\d{1,19}$/;
/** `version` aceita o TEXTO de dígitos que o GET devolve (bigint) ou um inteiro ≥ 0. Canônica = texto decimal. */
function versaoCanonica(v: unknown): string | null {
  if (typeof v === "string" && FORMA_VERSAO.test(v)) return BigInt(v).toString();
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  return null;
}

/** `items.0.id` do zod vira `items[0].id` — o mesmo caminho que as recusas de item do PUT já usam. */
function caminho(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, s) => (typeof s === "number" ? `${acc}[${s}]` : acc ? `${acc}.${String(s)}` : String(s)), "");
}

/**
 * O CORPO É ESTRITO: `{ version, ...só os campos que mudam }`.
 *
 * `empresa_id` e `tipo_operacao_id` têm recusa PRÓPRIA, e não "campo desconhecido": são campos do documento que a
 * edição não troca, e quem os manda precisa saber o que fazer (a empresa não muda; trocar a operação é cancelar e
 * lançar de novo). Chave desconhecida é RECUSADA (422), nunca descartada: um typo (`nota`) não pode virar "salvei
 * sem mudar nada" com 200. Tudo aqui é forma — nada lê o banco, e a chave de idempotência ainda não foi reservada.
 */
export function lerPedidoDaEdicao<T extends CamposDaEdicao>(corpo: unknown, schema: z.ZodType<T>, chaves: ReadonlySet<string>): { versao: string; campos: T } {
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) throw recusa([{ path: "", message: MSG_EDICAO_CORPO_INVALIDO }]);
  const cru = corpo as Record<string, unknown>;
  const detalhes: Detalhe[] = [];
  if ("empresa_id" in cru) detalhes.push({ path: "empresa_id", message: MSG_EDICAO_EMPRESA });
  if ("tipo_operacao_id" in cru) detalhes.push({ path: "tipo_operacao_id", message: MSG_EDICAO_TROCA_DE_OPERACAO });
  const versao = cru["version"] === undefined ? null : versaoCanonica(cru["version"]);
  if (cru["version"] === undefined) detalhes.push({ path: "version", message: MSG_EDICAO_VERSAO_AUSENTE });
  else if (versao === null) detalhes.push({ path: "version", message: MSG_EDICAO_VERSAO_INVALIDA });
  for (const chave of Object.keys(cru)) {
    if (chave === "version" || chave === "empresa_id" || chave === "tipo_operacao_id" || chaves.has(chave)) continue;
    detalhes.push({ path: chave, message: MSG_EDICAO_CAMPO_DESCONHECIDO });
  }
  if (detalhes.length || versao === null) throw recusa(detalhes);
  const { version: _versao, ...resto } = cru;
  const r = schema.safeParse(resto);
  if (!r.success) {
    const det: Detalhe[] = r.error.issues.flatMap((i) => i.code === "unrecognized_keys"
      ? i.keys.map((k) => ({ path: caminho([...i.path, k]), message: MSG_EDICAO_CAMPO_DESCONHECIDO }))
      : [{ path: caminho(i.path), message: translateIssue(i) }]);
    // A mesma mensagem-resumo que o tratador global dá ao 422 do zod no PUT.
    const faltando = det.filter((x) => x.message === MSG_EDICAO_CAMPO_OBRIGATORIO).map((x) => x.path);
    throw recusa(det, faltando.length ? `Campos obrigatórios pendentes: ${faltando.join(", ")}` : det.length === 1 && det[0]!.path ? `${det[0]!.path}: ${det[0]!.message}` : "Dados inválidos");
  }
  return { versao, campos: r.data };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. O DOCUMENTO COMO FICARÁ — o gravado + o que muda.
// ---------------------------------------------------------------------------------------------------------------
type Tipo = "uuid" | "data" | "texto" | "decimal";
/** Os campos de cabeçalho que a PATCH pode trocar, e como se compara cada um com o gravado. Lista ESTÁTICA. */
const CABECALHO = {
  document_date: "data", shipping_date: "data", due_date: "data", client_id: "uuid", transporter_id: "uuid", proprietary_id: "uuid",
  driver_name: "texto", payment_method_id: "uuid", freight: "decimal", freight_icms: "decimal", other_values: "decimal", discount: "decimal",
  note: "texto", categoria_financeira_id: "uuid", centro_custo_id: "uuid", condicao_pagamento_id: "uuid",
} as const satisfies Record<string, Tipo>;
type CampoDoCabecalho = keyof typeof CABECALHO;

function iguais(tipo: Tipo, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (tipo === "uuid") return String(a).toLowerCase() === String(b).toLowerCase();
  if (tipo === "decimal") return D(String(a)).eq(D(String(b)));
  return String(a) === String(b);
}

/** A marca de dedutível mora DENTRO do plano gravado (D-1). */
const dedutivelGravado = (cur: DocumentoGravado) => cur.installment_plan?.["is_deductible"] === true;

const ITEM: Record<Exclude<keyof ItemComoFicara, never>, Tipo> = {
  product_id: "uuid", warehouse_id: "uuid", quantity: "decimal", unit_price: "decimal", discount: "decimal", discount_percent: "decimal", note: "texto",
};
const itemDoGravado = (g: ItemGravado): ItemComoFicara => ({
  product_id: g.product_id, warehouse_id: g.warehouse_id, quantity: g.quantity, unit_price: g.unit_price, discount: g.discount, discount_percent: g.discount_percent, note: g.note,
});

export interface EdicaoComoFicara {
  /** O corpo de "três estados" do núcleo: SÓ os campos de cabeçalho cujo valor MUDA (o igual ao gravado sai). */
  mudancas: Record<string, unknown>;
  d: DocumentoComoFicara;
  /** Para cada `d.items[k]`, o item gravado que ele É (por id) — `undefined` para o item novo. */
  pares: (ItemGravado | undefined)[];
  itens: ItensDaEdicao;
  /** Algum campo (ou item) muda de fato. */
  mudou: boolean;
}

/**
 * CABEÇALHO: ausente = fica o gravado; `null` = limpa (o zod só aceita `null` onde o `docSchema` aceita); valor =
 * troca. Valor IGUAL ao gravado não é mudança e sai do corpo de três estados — é isso que faz "a PATCH troca a
 * condição" (e só então ela é conferida) e "a PATCH troca o cliente" (e só então o atraso é conferido) significarem
 * o que dizem, com o MESMO núcleo do PUT. `installment_plan` enviado é sempre decisão explícita (ver `planoDaEdicao`).
 *
 * ITENS: ausentes = intactos. Presentes = a lista nova completa: com `id` é item DESTE documento (o que não vem fica o
 * gravado, inclusive `origem_item_id`); sem `id` é novo e exige produto, quantidade e preço; o gravado que não vem
 * sai. `id` de outro documento (ou inexistente — indistinguíveis: a conferência é contra os itens DESTE documento, sem
 * consulta) e `id` repetido → 422 em `items[i].id`.
 */
export function edicaoComoFicara(cur: DocumentoGravado, campos: CamposDaEdicao): EdicaoComoFicara {
  const mudancas: Record<string, unknown> = {};
  for (const [campo, tipo] of Object.entries(CABECALHO) as [CampoDoCabecalho, Tipo][]) {
    const v = campos[campo];
    if (v !== undefined && !iguais(tipo, v, cur[campo])) mudancas[campo] = v;
  }
  if (campos.is_deductible !== undefined && campos.is_deductible !== dedutivelGravado(cur)) mudancas["is_deductible"] = campos.is_deductible;
  if (campos.installment_plan !== undefined) mudancas["installment_plan"] = campos.installment_plan;

  let pares: (ItemGravado | undefined)[] = cur.items;
  let itens: ItemComoFicara[] = cur.items.map(itemDoGravado);
  let modo: ItensDaEdicao = { modo: "manter" };
  if (campos.items !== undefined) {
    const porId = new Map(cur.items.map((i) => [i.id.toLowerCase(), i]));
    const vistos = new Set<string>();
    const detalhes: Detalhe[] = [];
    const novos: { item: ItemComoFicara; par: ItemGravado | undefined; alterado: boolean }[] = [];
    campos.items.forEach((e, k) => {
      if (e.id !== undefined) {
        const chave = e.id.toLowerCase();
        const g = porId.get(chave);
        if (!g) { detalhes.push({ path: `items[${k}].id`, message: MSG_EDICAO_ITEM_DE_OUTRO_DOCUMENTO }); return; }
        if (vistos.has(chave)) { detalhes.push({ path: `items[${k}].id`, message: MSG_EDICAO_ITEM_REPETIDO }); return; }
        vistos.add(chave);
        const item: ItemComoFicara = {
          product_id: e.product_id ?? g.product_id, warehouse_id: e.warehouse_id !== undefined ? e.warehouse_id : g.warehouse_id,
          quantity: e.quantity ?? g.quantity, unit_price: e.unit_price ?? g.unit_price, discount: e.discount ?? g.discount,
          discount_percent: e.discount_percent ?? g.discount_percent, note: e.note !== undefined ? e.note : g.note,
        };
        const alterado = g.position !== k || (Object.entries(ITEM) as [keyof ItemComoFicara, Tipo][]).some(([f, t]) => !iguais(t, item[f], g[f]));
        novos.push({ item, par: g, alterado });
        return;
      }
      const faltando = (["product_id", "quantity", "unit_price"] as const).filter((f) => e[f] === undefined);
      for (const f of faltando) detalhes.push({ path: `items[${k}].${f}`, message: MSG_EDICAO_CAMPO_OBRIGATORIO });
      if (faltando.length) return;
      novos.push({ item: { product_id: e.product_id!, warehouse_id: e.warehouse_id ?? null, quantity: e.quantity!, unit_price: e.unit_price!, discount: e.discount ?? "0", discount_percent: e.discount_percent ?? "0", note: e.note ?? null }, par: undefined, alterado: true });
    });
    if (detalhes.length) throw recusa(detalhes);
    const removidos = cur.items.filter((i) => !vistos.has(i.id.toLowerCase())).map((i) => i.id);
    // A lista enviada IGUAL à gravada (mesmos ids, mesma ordem, mesmos valores) não é mudança: nenhuma linha é tocada.
    if (removidos.length || novos.some((n) => n.alterado)) {
      pares = novos.map((n) => n.par);
      itens = novos.map((n) => n.item);
      modo = { modo: "porId", ids: novos.map((n) => n.par?.id ?? null), alterados: novos.map((n) => n.alterado), removidos };
    }
  }

  const valor = <C extends CampoDoCabecalho>(c: C) => (c in mudancas ? mudancas[c] : cur[c]) as DocumentoGravado[C];
  const d: DocumentoComoFicara = {
    empresa_id: cur.empresa_id, tipo_operacao_id: cur.tipo_operacao_id,
    document_date: valor("document_date"), shipping_date: valor("shipping_date"), due_date: valor("due_date"), client_id: valor("client_id"),
    transporter_id: valor("transporter_id"), proprietary_id: valor("proprietary_id"), driver_name: valor("driver_name"),
    payment_method_id: valor("payment_method_id"), freight: valor("freight"), freight_icms: valor("freight_icms"),
    other_values: valor("other_values"), discount: valor("discount"), note: valor("note"),
    categoria_financeira_id: valor("categoria_financeira_id"), centro_custo_id: valor("centro_custo_id"), condicao_pagamento_id: valor("condicao_pagamento_id"),
    installment_plan: campos.installment_plan, is_deductible: campos.is_deductible ?? dedutivelGravado(cur), items: itens,
  };
  return { mudancas, d, pares, itens: modo, mudou: Object.keys(mudancas).length > 0 || modo.modo === "porId" };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. A REGRA DO PLANO
// ---------------------------------------------------------------------------------------------------------------
/**
 * O PLANO NA PATCH — campo não enviado só muda se for DERIVADO de um campo que mudou.
 *
 * `installment_plan`, a marca `is_deductible` (que mora dentro dele) e `parcelas_ajustadas` são o que o ED-1 compara:
 * numa PATCH que não mexe em nada financeiro (só `note`, por exemplo) eles ficam IDÊNTICOS ao gravado. Refazer o plano
 * "porque sim" pela conta do PUT trocaria o plano de quem só corrigiu uma observação sempre que a condição de
 * pagamento tivesse sido editada no cadastro depois do lançamento (a conta lê a condição de HOJE), e desmarcaria
 * `parcelas_ajustadas`. Por isso a regra é:
 *
 *   a) a PATCH envia `installment_plan` (objeto ou null) → é decisão explícita: a MESMA conta do PUT (`calcular`);
 *   b) a PATCH troca a condição (ou a remove)           → o plano pertence à condição: a MESMA conta do PUT;
 *   c) o plano gravado é DERIVADO da condição (há condição e `parcelas_ajustadas` = false) e mudou a data do
 *      documento ou o total (itens, frete, outros, desconto) → a MESMA conta do PUT (a entrada e o 1º vencimento saem
 *      da data e do total);
 *   d) qualquer outro caso → o plano GRAVADO fica, byte a byte, e `parcelas_ajustadas` também. Plano ajustado à mão ou
 *      sem condição não deriva de nada: é o que o usuário escolheu, e vale para qualquer total (o plano é forma —
 *      parcelas, vencimentos —, não valor). Só a marca `is_deductible` muda, e só se a PATCH a enviar diferente.
 *
 * Devolve `null` para "calcular pela conta do PUT" (`writeDoc`), ou o plano a MANTER.
 */
export function planoDaEdicao(cur: DocumentoGravado, e: Pick<EdicaoComoFicara, "mudancas" | "d">): { valor: Record<string, unknown>; ajustadas: boolean } | null {
  const m = e.mudancas;
  if ("installment_plan" in m || "condicao_pagamento_id" in m) return null;
  const derivado = cur.condicao_pagamento_id !== null && cur.parcelas_ajustadas !== true;
  if (derivado) {
    const total = documentTotals(e.d.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, discount: i.discount, discountPercent: i.discount_percent })),
      { freight: e.d.freight, freightIcms: e.d.freight_icms, otherValues: e.d.other_values, discount: e.d.discount }).total;
    if ("document_date" in m || !D(total).eq(D(cur.total))) return null;
  }
  const gravado = cur.installment_plan ?? {};
  return { valor: "is_deductible" in m ? { ...gravado, is_deductible: m["is_deductible"] } : gravado, ajustadas: cur.parcelas_ajustadas === true };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. O HISTÓRICO
// ---------------------------------------------------------------------------------------------------------------
/** Colunas do cabeçalho comparadas no evento (lista estática): as editáveis e as derivadas (totais, plano). */
const COLUNAS_DO_EVENTO = [...(Object.keys(CABECALHO) as CampoDoCabecalho[]), "subtotal", "total", "installment_plan", "parcelas_ajustadas"] as const;
// `position` entra: reordenar é uma gravação (a versão sobe), e o evento tem de dizer o que foi gravado.
const CAMPOS_DO_ITEM = ["product_id", "warehouse_id", "quantity", "unit_price", "discount", "discount_percent", "total", "note", "position"] as const;
const mesmo = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const linhaDoItem = (i: ItemGravado) => Object.fromEntries([["id", i.id], ...CAMPOS_DO_ITEM.map((c) => [c, i[c]])]) as Record<string, unknown>;

/**
 * O EVENTO DA PATCH — `update` com `{ via: "patch", campos, derivados }` e `before`/`after` SÓ do que mudou.
 *
 * O gatilho `erp.audit_row` já grava a linha INTEIRA do cabeçalho; os itens não têm gatilho. Este evento diz o que a
 * PATCH mudou — inclusive nos itens — sem que ninguém precise comparar duas fotos inteiras:
 *   before/after.<campo>          → o valor antes → depois de cada campo do cabeçalho que mudou (pedido ou derivado);
 *   before.items.alterados[]      → `{ id, <campo>: antes }` só dos campos do item que mudaram;
 *   after.items.alterados[]       → `{ id, <campo>: depois }`;
 *   after.items.incluidos[]       → a linha nova inteira (com o id que ela ganhou);
 *   before.items.removidos[]      → a linha que saiu, inteira.
 * `campos` = tudo que mudou (inclui `items`); `derivados` = o que mudou sem ter sido enviado (totais, plano).
 * Antes e depois são LIDOS do banco (o `getDoc` com a trava e o `getDoc` da resposta): o evento descreve o gravado.
 */
export function eventoDaEdicao(antes: DocumentoGravado, depois: DocumentoGravado, enviados: readonly string[]) {
  const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {};
  const campos: string[] = [];
  for (const c of COLUNAS_DO_EVENTO) {
    if (mesmo(antes[c], depois[c])) continue;
    campos.push(c); before[c] = antes[c] ?? null; after[c] = depois[c] ?? null;
  }
  // A marca de dedutível mora dentro do plano, mas é um campo do corpo: aparece com o próprio nome.
  if (dedutivelGravado(antes) !== dedutivelGravado(depois)) {
    campos.push("is_deductible"); before["is_deductible"] = dedutivelGravado(antes); after["is_deductible"] = dedutivelGravado(depois);
  }
  const porIdAntes = new Map(antes.items.map((i) => [i.id, i]));
  const porIdDepois = new Map(depois.items.map((i) => [i.id, i]));
  const alteradosAntes: Record<string, unknown>[] = []; const alteradosDepois: Record<string, unknown>[] = [];
  for (const d of depois.items) {
    const a = porIdAntes.get(d.id);
    if (!a) continue;
    const mudaram = CAMPOS_DO_ITEM.filter((c) => !mesmo(a[c], d[c]));
    if (!mudaram.length) continue;
    alteradosAntes.push(Object.fromEntries([["id", d.id], ...mudaram.map((c) => [c, a[c]])]));
    alteradosDepois.push(Object.fromEntries([["id", d.id], ...mudaram.map((c) => [c, d[c]])]));
  }
  const incluidos = depois.items.filter((i) => !porIdAntes.has(i.id)).map(linhaDoItem);
  const removidos = antes.items.filter((i) => !porIdDepois.has(i.id)).map(linhaDoItem);
  if (alteradosAntes.length || incluidos.length || removidos.length) {
    campos.push("items");
    before["items"] = { alterados: alteradosAntes, removidos };
    after["items"] = { alterados: alteradosDepois, incluidos };
  }
  const derivados = campos.filter((c) => !enviados.includes(c));
  return { metadados: { via: "patch" as const, campos, derivados }, before, after };
}
