import { D } from "@agro/shared";
import { documentTotals } from "@agro/domain";
import type { ItemRow, Plan, Row } from "@/features/docs/shared";
import type { RegrasGeraisDaCentral, TravasDaLinha } from "@/features/central/contrato";
import type { LimitesDaEdicaoDeVenda } from "./central-vendas-edicao-api";

/**
 * EDITAR-03 (decisão 315) — A EDIÇÃO DO DOCUMENTO DE VENDA NA CENTRAL: contas PURAS, sem React e sem rede (o formulário,
 * `central-vendas-formulario.tsx`, só as chama; o teste de unidade as prova uma a uma). A forma do servidor mora em
 * `central-vendas-edicao-api.ts`. O molde é o da edição de compras (decisão 313) — lido, não importado.
 *
 * O MODO EDIÇÃO É UM RAMO DO ESTADO DA CRIAÇÃO, não uma segunda tela: o MESMO formulário, aberto com o documento
 * GRAVADO (`aberturaDaVenda`), sem semear nada (`semeiaNaAbertura`), com o que a PATCH recusa em leitura
 * (`travasDoItemDeVenda`, `itensNaEdicaoDeVenda`), e o Salvar manda `PATCH { version, ...só o que mudou }`
 * (`corpoDaEdicaoDeVenda`) — §15.2 da `docs/TIPO-OPERACAO-CONTRACT.md`. Nada mudou ⇒ zero PATCH (`mudouAlgo`). Na venda
 * cuja versão congelada CONFIRMA AO SALVAR, o Salvar avisa antes (`avisaAntesDeSalvar`, item 2 da EDITAR-03).
 */

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const data = (v: unknown): string => texto(v).trim().slice(0, 10);

/** A recusa PRÓPRIA da PATCH para a empresa (o texto do servidor, `MSG_EDICAO_EMPRESA`, espelhado: a empresa nunca vai). */
export const MOTIVO_EMPRESA_NA_EDICAO = "A empresa não muda na edição do documento.";
/** Nada mudou: o Salvar não manda PATCH nenhuma e a edição volta à consulta (o texto da 313). */
export const MSG_EDICAO_SEM_MUDANCA = "Nada mudou: o documento continua como estava.";

/* ═════════════════════════════════════ O MODO E A SEMEADURA ═════════════════════════════════════ */

/** O formulário da Central de Vendas: a criação de sempre, ou o RAMO de edição do documento salvo. */
export type ModoDoFormularioDeVenda = "criacao" | "edicao";

/**
 * OS LUGARES EM QUE A CRIAÇÃO SEMEIA O FORMULÁRIO (o levantamento da EDITAR-03; nenhum é a decisão 311, que é só de
 * compras). A edição abre o GRAVADO e não semeia em NENHUM — cada lugar tem a sua guarda no formulário, que pergunta
 * aqui:
 *   padraoDoLayout    → o `valorPadrao` dos campos do layout, aplicado ao abrir;
 *   padraoDeCadastro  → o padrão de cadastro (`padroesDeCadastro` de `/layout-efetivo`), aplicado ao abrir;
 *   localDoCabecalho  → o "Local de estoque" do cabeçalho, que as linhas NOVAS herdam (decisão 280);
 *   copiaDoDuplicar   → a cópia entregue em memória pela consulta (espiar e descartar);
 *   limpezaDaCondicao → a limpeza automática da condição que a versão da TOP não permite;
 *   empresaPadrao     → a empresa padrão do usuário no `empresa_id` vazio (a 6ª, declarada a mais: a do documento fica).
 */
export const LUGARES_DA_SEMEADURA = ["padraoDoLayout", "padraoDeCadastro", "localDoCabecalho", "copiaDoDuplicar", "limpezaDaCondicao", "empresaPadrao"] as const;
export type LugarDaSemeadura = (typeof LUGARES_DA_SEMEADURA)[number];
const SEMEIA: Readonly<Record<LugarDaSemeadura, Readonly<Record<ModoDoFormularioDeVenda, boolean>>>> = {
  padraoDoLayout: { criacao: true, edicao: false },
  padraoDeCadastro: { criacao: true, edicao: false },
  localDoCabecalho: { criacao: true, edicao: false },
  copiaDoDuplicar: { criacao: true, edicao: false },
  limpezaDaCondicao: { criacao: true, edicao: false },
  empresaPadrao: { criacao: true, edicao: false }
};
/** O formulário semeia `lugar` neste modo? Criação: sim (o de sempre). Edição: nunca. */
export const semeiaNaAbertura = (modo: ModoDoFormularioDeVenda, lugar: LugarDaSemeadura): boolean => SEMEIA[lugar][modo];

/* ═════════════════════════════════════ A ABERTURA ═════════════════════════════════════ */

/** O cabeçalho que a Central edita — as MESMAS chaves do estado da criação (`branco` do formulário). */
export interface CabecalhoDeVenda {
  empresa_id: string; document_date: string; shipping_date: string; due_date: string; client_id: string; transporter_id: string;
  proprietary_id: string; driver_name: string; payment_method_id: string; freight: string; freight_icms: string; other_values: string;
  discount: string; note: string; is_deductible: boolean; installments: boolean; categoria_financeira_id: string; centro_custo_id: string;
  condicao_pagamento_id: string;
}

/** O estado do formulário que a PATCH compara com a abertura. */
export interface EstadoDaVendaNoFormulario {
  cabecalho: CabecalhoDeVenda;
  /** Os itens na ordem da grade; o item salvo leva o `id` (a chave que a PATCH leva), o novo não. */
  itens: readonly ItemRow[];
  plano: Plan;
  /** O plano é do operador ("ajustado" sobre a condição): só então ele vai no corpo com a condição. */
  ajustado: boolean;
}

/** O id do item salvo de uma linha da grade (vazio = item novo, incluído na edição). */
export const idDoItemDeVenda = (l: ItemRow): string => (typeof l["id"] === "string" ? l["id"].toLowerCase() : "");

/** O plano gravado na forma do editor (`Plan`), ou `null` quando não é dela (à vista, ou plano legado torto). */
export function planoGravadoDaVenda(v: unknown): Plan | null {
  if (!ehObjeto(v)) return null;
  const { installments, first_due_date, mode, interval_days, has_down_payment } = v;
  if (typeof installments !== "number" || typeof first_due_date !== "string" || (mode !== "interval" && mode !== "fixed_day")
    || typeof interval_days !== "number" || typeof has_down_payment !== "boolean") return null;
  const plano: Plan = { installments, first_due_date: first_due_date.slice(0, 10), mode, interval_days, has_down_payment };
  if (typeof v.due_day === "number") plano.due_day = v.due_day;
  if (v.down_payment_value !== undefined && v.down_payment_value !== null) plano.down_payment_value = String(v.down_payment_value);
  if (typeof v.down_payment_date === "string") plano.down_payment_date = v.down_payment_date.slice(0, 10);
  return plano;
}

/** A linha da grade de um item salvo (as chaves do motor; o `id` do item, para a PATCH) — a forma da cópia do Duplicar. */
export function linhaDoItemDeVenda(it: Row): ItemRow {
  const item: ItemRow = {
    id: texto(it["id"]).toLowerCase(),
    product_id: texto(it["product_id"]),
    quantity: texto(it["quantity"]),
    unit_value: texto(it["unit_price"]),
    discount: texto(it["discount"]) || "0",
    discount_percent: texto(it["discount_percent"]) || "0",
    generate_stock: true
  };
  if (texto(it["warehouse_id"])) item.warehouse_id = texto(it["warehouse_id"]);
  if (texto(it["note"])) item["note"] = texto(it["note"]);
  return item;
}

/**
 * A ABERTURA da edição: o documento GRAVADO (`GET :id`, a MESMA versão do `/edicao`) nas chaves do formulário. Nenhum
 * padrão entra aqui — nem o do layout, nem o de cadastro, nem o local do cabeçalho, nem a cópia. O plano mostrado é o
 * GRAVADO quando ele tem a forma do editor; "ajustado" é o `parcelas_ajustadas` do documento com condição; sem condição,
 * "Parcelado" é ter plano gravado. O dedutível mora no plano gravado (a mesma leitura do Duplicar e do servidor).
 */
export function aberturaDaVenda(d: Row, planoPadrao: () => Plan): EstadoDaVendaNoFormulario {
  const gravado = ehObjeto(d["installment_plan"]) ? d["installment_plan"] : {};
  const condicao = texto(d["condicao_pagamento_id"]);
  const lido = planoGravadoDaVenda(d["installment_plan"]);
  const cabecalho: CabecalhoDeVenda = {
    empresa_id: texto(d["empresa_id"]), document_date: data(d["document_date"]), shipping_date: data(d["shipping_date"]), due_date: data(d["due_date"]),
    client_id: texto(d["client_id"]), transporter_id: texto(d["transporter_id"]), proprietary_id: texto(d["proprietary_id"]),
    driver_name: texto(d["driver_name"]), payment_method_id: texto(d["payment_method_id"]),
    freight: texto(d["freight"]) || "0", freight_icms: texto(d["freight_icms"]) || "0", other_values: texto(d["other_values"]) || "0",
    discount: texto(d["discount"]) || "0", note: texto(d["note"]),
    is_deductible: gravado["is_deductible"] === true, installments: condicao === "" && lido !== null,
    categoria_financeira_id: texto(d["categoria_financeira_id"]), centro_custo_id: texto(d["centro_custo_id"]), condicao_pagamento_id: condicao
  };
  const itens = (Array.isArray(d["items"]) ? (d["items"] as unknown[]) : []).filter(ehObjeto).map(linhaDoItemDeVenda);
  return { cabecalho, itens, plano: lido ?? planoPadrao(), ajustado: condicao !== "" && d["parcelas_ajustadas"] === true };
}

/** O total do documento pelo estado do formulário — a MESMA conta da criação e da API (`documentTotals`). */
function totalDoEstado(e: EstadoDaVendaNoFormulario): string | null {
  const h = e.cabecalho;
  try {
    return documentTotals(e.itens.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_value ?? "0", discount: i.discount || "0", discountPercent: i.discount_percent || "0" })),
      { freight: h.freight || "0", freightIcms: h.freight_icms || "0", otherValues: h.other_values || "0", discount: h.discount || "0" }).total;
  } catch { return null; }
}

/**
 * O PLANO DA CONDIÇÃO É RECALCULADO NA TELA? Na criação, sempre (o de sempre: a data ou o total mudou, o plano mostrado
 * acompanha). Na edição, só quando a PATCH também o refaria — a condição, a data do documento ou o total mudaram
 * (`planoDaEdicao`, regras b e c, `apps/api/src/routes/vendas-edicao-patch.ts:393-400`); senão o plano GRAVADO fica na
 * tela, como fica no servidor (regra d): recalcular ao abrir mostraria a conta de hoje no lugar da gravada.
 */
export function recalculaPlanoDaCondicao(modo: ModoDoFormularioDeVenda, abertura: EstadoDaVendaNoFormulario | null, atual: EstadoDaVendaNoFormulario): boolean {
  if (modo === "criacao" || !abertura) return true;
  const a = abertura.cabecalho; const b = atual.cabecalho;
  if (a.condicao_pagamento_id.toLowerCase() !== b.condicao_pagamento_id.toLowerCase() || a.document_date !== b.document_date) return true;
  const ta = totalDoEstado(abertura); const tb = totalDoEstado(atual);
  return ta === null || tb === null || !D(ta).eq(D(tb));
}

/**
 * A TOP GRAVADA do documento — o snapshot que o `GET :id` devolve (`tipo_operacao`: código e nome da versão CONGELADA),
 * na forma que o formulário mostra no contexto travado. A edição não troca a TOP (a PATCH recusa com 422). Sem o
 * snapshot, ou com ele de outra TOP que não a do documento ⇒ `null` (a abertura não entra em edição).
 */
export function topGravadaDaVenda(d: Row): { id: string; code: string; name: string; version: number; isDefault: boolean } | null {
  const t = d["tipo_operacao"];
  const id = texto(d["tipo_operacao_id"]);
  if (!ehObjeto(t) || !id || texto(t["id"]).toLowerCase() !== id.toLowerCase() || !texto(t["codigo"]) || !texto(t["nome"])) return null;
  return { id, code: texto(t["codigo"]), name: texto(t["nome"]), version: typeof t["versao"] === "number" ? t["versao"] : 0, isDefault: false };
}

/* ═════════════════════════════════════ O CORPO DA PATCH ═════════════════════════════════════ */

type Tipo = "uuid" | "data" | "texto" | "decimal" | "booleano" | "plano";

/** Dois valores iguais para o servidor (o mesmo número com outra grafia, o mesmo UUID em outra caixa, o mesmo plano). */
function iguais(tipo: Tipo, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (tipo === "uuid") return String(a).toLowerCase() === String(b).toLowerCase();
  if (tipo === "decimal") { try { return D(String(a)).eq(D(String(b))); } catch { return String(a) === String(b); } }
  if (tipo === "plano") return planosIguais(a as Plan, b as Plan);
  return a === b;
}

/** Os campos do plano que a PATCH aceita (`installmentPlanSchema`, ESTRITO na PATCH). Lista ESTÁTICA. */
const CHAVES_DO_PLANO = ["installments", "first_due_date", "mode", "interval_days", "due_day", "has_down_payment", "down_payment_value", "down_payment_date"] as const;
/** O plano como vai no corpo: só as chaves do contrato (chave a mais seria 422), sem as ausentes. */
function planoDoCorpo(p: Plan): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CHAVES_DO_PLANO) if (p[k] !== undefined) out[k] = p[k];
  return out;
}
/** O mesmo plano para o servidor (`planoIgualAoGravado`, vendas-edicao-patch.ts:255-265): campo a campo, a entrada como decimal. */
function planosIguais(a: Plan, b: Plan): boolean {
  return CHAVES_DO_PLANO.every((k) => (k === "down_payment_value" ? iguais("decimal", a[k], b[k]) : (a[k] ?? null) === (b[k] ?? null)));
}

/**
 * Os campos do cabeçalho que a PATCH aceita e como cada um se compara — a lista ESTÁTICA da PATCH
 * (`CABECALHO` + `is_deductible` + `installment_plan`, vendas-edicao-patch.ts:215-219, 303-304). `empresa_id` e
 * `tipo_operacao_id` nunca vão (a PATCH os recusa com 422 próprio).
 */
const CABECALHO: readonly { campo: string; tipo: Tipo }[] = [
  { campo: "document_date", tipo: "data" }, { campo: "shipping_date", tipo: "data" }, { campo: "due_date", tipo: "data" },
  { campo: "client_id", tipo: "uuid" }, { campo: "transporter_id", tipo: "uuid" }, { campo: "proprietary_id", tipo: "uuid" },
  { campo: "driver_name", tipo: "texto" }, { campo: "payment_method_id", tipo: "uuid" }, { campo: "freight", tipo: "decimal" },
  { campo: "freight_icms", tipo: "decimal" }, { campo: "other_values", tipo: "decimal" }, { campo: "discount", tipo: "decimal" },
  { campo: "note", tipo: "texto" }, { campo: "is_deductible", tipo: "booleano" }, { campo: "installment_plan", tipo: "plano" },
  { campo: "categoria_financeira_id", tipo: "uuid" }, { campo: "centro_custo_id", tipo: "uuid" }, { campo: "condicao_pagamento_id", tipo: "uuid" }
];

/** As capacidades que a tela declara (a classificação financeira e a condição): sem elas o campo nem existe no corpo. */
export interface CamposDaVendaNaTela { classificacao: boolean; condicao: boolean }

/**
 * O CABEÇALHO NA FORMA DO CORPO — os MESMOS valores do corpo do POST da criação (vazio = `null` onde o POST manda `null`;
 * frete, ICMS, outros e desconto vazios = "0"; o plano pela condição e pelo "Parcelado"), com DUAS diferenças, as duas
 * do contrato da PATCH: natureza, centro e condição vazios vão `null` (o POST os manda vazios ou os omite; na PATCH
 * `null` limpa onde o POST aceita vazio, §15.2), e o plano leva só as chaves do contrato.
 */
function cabecalhoNoCorpo(e: EstadoDaVendaNoFormulario, o: CamposDaVendaNaTela): Record<string, unknown> {
  const h = e.cabecalho;
  const condicaoId = o.condicao ? h.condicao_pagamento_id : "";
  const plano = condicaoId ? (e.ajustado ? e.plano : null) : (h.installments ? e.plano : null);
  return {
    document_date: h.document_date, shipping_date: h.shipping_date || null, due_date: h.due_date || null, client_id: h.client_id,
    transporter_id: h.transporter_id || null, proprietary_id: h.proprietary_id || null, driver_name: h.driver_name || null,
    payment_method_id: h.payment_method_id || null, freight: h.freight || "0", freight_icms: h.freight_icms || "0",
    other_values: h.other_values || "0", discount: h.discount || "0", note: h.note || null, is_deductible: h.is_deductible,
    installment_plan: plano ? planoDoCorpo(plano) : null,
    ...(o.classificacao ? { categoria_financeira_id: h.categoria_financeira_id || null, centro_custo_id: h.centro_custo_id || null } : {}),
    ...(o.condicao ? { condicao_pagamento_id: h.condicao_pagamento_id || null } : {})
  };
}

/** Os campos de UM item que a PATCH aceita (`itemDaEdicaoSchema`, sales.ts:71) e como cada um se compara. */
const ITEM: readonly { campo: string; tipo: Tipo }[] = [
  { campo: "product_id", tipo: "uuid" }, { campo: "warehouse_id", tipo: "uuid" }, { campo: "quantity", tipo: "decimal" },
  { campo: "unit_price", tipo: "decimal" }, { campo: "discount", tipo: "decimal" }, { campo: "discount_percent", tipo: "decimal" },
  { campo: "note", tipo: "texto" }
];
/** O item na forma do corpo — a MESMA conta do item do POST da criação. */
function itemNoCorpo(i: ItemRow): Record<string, unknown> {
  return { product_id: i.product_id, warehouse_id: i.warehouse_id || null, quantity: i.quantity, unit_price: i.unit_value ?? "0",
    discount: i.discount || "0", discount_percent: i.discount_percent || "0", note: typeof i["note"] === "string" && i["note"] ? i["note"] : null };
}

/**
 * O CORPO DA PATCH: `{ version, ...só o que mudou }` (§15.2), comparado com a ABERTURA campo a campo pela forma do corpo
 * (o mesmo número com outra grafia não é mudança; o plano igual ao gravado não é mudança).
 *   · cabeçalho: cada campo de `CABECALHO` que difere da abertura; ausente = fica o gravado; `null` limpa;
 *   · itens: quando algum item mudou, entrou, SAIU ou trocou de posição — a lista COMPLETA, na ordem da grade: o item
 *     salvo com o `id` e só os campos que mudaram nele; o novo sem `id` (produto, quantidade e valor unitário sempre).
 *     O item salvo AUSENTE da lista SAI do documento: é assim que a venda REMOVE item (vendas-edicao-patch.ts:292-296,
 *     340); a parte gerada não remove nem acrescenta (sales.ts:729-739 — a defesa é `itensNaEdicaoDeVenda`).
 * Nada mudou ⇒ só `{ version }` (`mudouAlgo` falso: a tela não envia).
 */
export function corpoDaEdicaoDeVenda(p: { version: string; abertura: EstadoDaVendaNoFormulario; atual: EstadoDaVendaNoFormulario; campos: CamposDaVendaNaTela }): Record<string, unknown> {
  const corpo: Record<string, unknown> = { version: p.version };
  const a = cabecalhoNoCorpo(p.abertura, p.campos); const b = cabecalhoNoCorpo(p.atual, p.campos);
  for (const { campo, tipo } of CABECALHO) {
    if (!Object.hasOwn(b, campo)) continue;
    if (!iguais(tipo, a[campo], b[campo])) corpo[campo] = b[campo];
  }
  const gravados = new Map(p.abertura.itens.map((l) => [idDoItemDeVenda(l), itemNoCorpo(l)]));
  const ordemGravada = p.abertura.itens.map(idDoItemDeVenda);
  const presentes = new Set<string>();
  let itensMudaram = p.atual.itens.length !== p.abertura.itens.length;
  const itens = p.atual.itens.map((l, k) => {
    const id = idDoItemDeVenda(l);
    const g = id && !presentes.has(id) ? gravados.get(id) : undefined;
    const novo = itemNoCorpo(l);
    if (!g) { itensMudaram = true; return novo; }
    presentes.add(id);
    if (ordemGravada[k] !== id) itensMudaram = true;
    const mudancas: Record<string, unknown> = {};
    for (const { campo, tipo } of ITEM) if (!iguais(tipo, g[campo], novo[campo])) mudancas[campo] = novo[campo];
    if (Object.keys(mudancas).length) itensMudaram = true;
    return { id, ...mudancas };
  });
  if (ordemGravada.some((id) => !presentes.has(id))) itensMudaram = true;
  if (itensMudaram) corpo.items = itens;
  return corpo;
}

/** A PATCH muda alguma coisa (algo além da `version`)? */
export const mudouAlgo = (corpo: Record<string, unknown>): boolean => Object.keys(corpo).some((k) => k !== "version");

/* ═════════════════════════════════════ AS TRAVAS E A REMOÇÃO ═════════════════════════════════════ */

/**
 * As travas de UMA linha, pelos limites do servidor (`/edicao`):
 *   · a PARTE GERADA (`somenteArmazemEObservacao`): o item salvo é FIXO (não sai) e produto, quantidade, valor unitário e
 *     descontos ficam em leitura — só o local de estoque (e a observação, que a grade não mostra) mudam;
 *   · `armazemTravado` do item: o local de estoque também fica em leitura (`TravasDaLinha.armazem`, a célula travada).
 *     SEM motivo: o `/edicao` só manda o booleano, e o texto da recusa é do servidor (o 422 em `items[k].warehouse_id`
 *     cai no campo) — escrever a frase na tela seria regra copiada da API (A0);
 *   · fora da parte, o item salvo NÃO é fixo: a venda REMOVE item (a ausência na lista completa da PATCH).
 * O item novo, nenhuma. Item salvo que os limites não citam, na parte: tudo travado, o local inclusive (fail-closed).
 */
export function travasDoItemDeVenda(limites: LimitesDaEdicaoDeVenda, linha: ItemRow): TravasDaLinha {
  const id = idDoItemDeVenda(linha);
  if (!id) return {};
  const limite = limites.itens.find((x) => x.id === id);
  const armazem = limite ? limite.armazemTravado : limites.somenteArmazemEObservacao;
  const travas: TravasDaLinha = limites.somenteArmazemEObservacao ? { fixa: true, produto: true, quantidade: true, unitario: true, desconto: true } : {};
  if (armazem) travas.armazem = true;
  return travas;
}

/** As travas que a GRADE recebe na edição (`travasDaLinha` do motor). */
export const travasDaLinhaDaVenda = (limites: LimitesDaEdicaoDeVenda): ((linha: ItemRow) => TravasDaLinha) =>
  (l: ItemRow) => travasDoItemDeVenda(limites, l);

/** A edição aceita item novo (Adicionar e Duplicar)? Não na parte gerada (sales.ts:729-739: a mesma contagem de linhas). */
export const aceitaLinhaNovaNaEdicao = (limites: LimitesDaEdicaoDeVenda): boolean => !limites.somenteArmazemEObservacao;

/** Os campos da linha que cada trava protege (as chaves do motor). */
const PROTEGIDOS: readonly { trava: keyof Omit<TravasDaLinha, "fixa" | "quantidadeMaxima" | "motivos">; chaves: readonly string[] }[] = [
  { trava: "produto", chaves: ["product_id"] },
  { trava: "quantidade", chaves: ["quantity"] },
  { trava: "unitario", chaves: ["unit_value"] },
  { trava: "desconto", chaves: ["discount", "discount_percent"] },
  { trava: "armazem", chaves: ["warehouse_id"] }
];

/**
 * A DEFESA DO HANDLER (o botão escondido e a célula travada são apresentação): a lista nova que a grade entrega,
 * conferida contra a anterior, com a REGRA DE REMOÇÃO que a PATCH aceita:
 *   · fora da parte gerada, o item salvo que sumiu SAI (a venda remove item: a PATCH o apaga por ausência);
 *   · na parte gerada, um item salvo que sumiu ⇒ a lista anterior, inteira (a parte não remove);
 *   · o MESMO `id` duas vezes (o Duplicar de um item salvo) ⇒ a cópia é item NOVO (sem `id`) — e na parte, fora;
 *   · item novo na parte gerada ⇒ fora (a parte não acrescenta);
 *   · campo travado de item salvo ⇒ o valor anterior.
 */
export function itensNaEdicaoDeVenda(antes: readonly ItemRow[], novos: readonly ItemRow[], limites: LimitesDaEdicaoDeVenda): ItemRow[] {
  const parte = limites.somenteArmazemEObservacao;
  const ids = new Set(novos.map(idDoItemDeVenda).filter(Boolean));
  if (parte && antes.some((l) => { const id = idDoItemDeVenda(l); return id !== "" && !ids.has(id); })) return [...antes];
  const anterior = new Map(antes.map((l) => [idDoItemDeVenda(l), l]));
  const vistos = new Set<string>();
  const out: ItemRow[] = [];
  for (const l of novos) {
    const id = idDoItemDeVenda(l);
    const g = id && !vistos.has(id) ? anterior.get(id) : undefined;
    if (g) {
      vistos.add(id);
      const t = travasDoItemDeVenda(limites, l);
      let linha = l;
      for (const p of PROTEGIDOS) if (t[p.trava]) for (const k of p.chaves) if (texto(linha[k]) !== texto(g[k])) linha = { ...linha, [k]: g[k] };
      out.push(linha);
      continue;
    }
    if (parte) continue;
    if (id) { const { id: _copia, ...semId } = l; out.push(semId as ItemRow); continue; }
    out.push(l);
  }
  return out;
}

/* ═════════════════════════════════════ O AVISO: O SALVAR QUE CONFIRMA ═════════════════════════════════════ */

/**
 * ITEM 2 DA EDITAR-03 — A PATCH DA VENDA CONFIRMA SOZINHA. Decisão do A0: AVISAR ANTES. A PATCH chama, no fim da
 * gravação que mudou alguma coisa, a MESMA `confirmSale` do `POST /confirm` (sales.ts:1624-1632), e só na VARIANTE venda
 * (`confirmacaoAutomaticaDaVenda`, sales.ts:339-344) cuja versão CONGELADA da TOP está no formato 4 com "Confirmação:
 * Automática" — o que o `/edicao` declara em `regras.regrasGerais.confirmacaoAutomatica` (vendas-edicao.ts:109-115, a
 * MESMA régua e a MESMA versão da PATCH). Documento confirmado é recusado antes (409, vendas-edicao-regras.ts:19-26):
 * toda confirmação pela PATCH é a PRIMEIRA — saída de estoque e título a receber NOVOS (medido: 0→1 movimento, 0→1
 * título). O caminho de volta existe (o cancelamento com estorno, `sales.delete`).
 * O aviso vale quando as QUATRO coisas vêm juntas, todas do servidor ou do corpo: modo edição ∧ variante venda ∧
 * `confirmacaoAutomatica === true` ∧ a PATCH muda alguma coisa (sem mudança não há PATCH, e a PATCH sem mudança não
 * confirma, sales.ts:1615). Com ele, o Salvar abre o diálogo e NÃO manda a PATCH; só a confirmação explícita manda.
 */
export function avisaAntesDeSalvar(p: { modo: ModoDoFormularioDeVenda; variante: string; regrasGerais: RegrasGeraisDaCentral; corpo: Record<string, unknown> }): boolean {
  return p.modo === "edicao" && p.variante === "sale" && p.regrasGerais.confirmacaoAutomatica === true && mudouAlgo(p.corpo);
}

/**
 * O que a PRÉVIA da confirmação (`/previa-confirmacao`, VENDAS-A5-1) lê para os NÚMEROS dela. A prévia planeja a venda
 * GRAVADA, não a editada (A0: prévia 20.00 × título gravado 30.00): se a PATCH toca um destes campos, os números da
 * prévia não são o que vai acontecer, e a tela não pode apresentá-los como o efeito.
 */
export const CAMPOS_QUE_A_PREVIA_LE = [
  "items", "freight", "freight_icms", "other_values", "discount", "installment_plan", "condicao_pagamento_id", "due_date", "document_date",
  "categoria_financeira_id", "centro_custo_id", "payment_method_id"
] as const;
/** Os números da prévia valem para ESTA PATCH? Só quando ela não toca em nada do que a prévia lê. */
export const numerosDaPreviaValem = (corpo: Record<string, unknown>): boolean => !CAMPOS_QUE_A_PREVIA_LE.some((c) => Object.hasOwn(corpo, c));

/* ═════════════════════════════════════ O CLIENTE EM ATRASO NA EDIÇÃO ═════════════════════════════════════ */

/**
 * A FAIXA DO ATRASO NA EDIÇÃO. A PATCH só confere o atraso quando o CLIENTE MUDA (`conferirAtraso: d.client_id !==
 * cur.client_id`, sales.ts); a situação do `/edicao` é a do cliente GRAVADO, pela versão congelada. Então:
 *   · com o cliente gravado, NADA trava o Salvar; a faixa aparece só no "avisa" (o texto do servidor é verdadeiro aqui);
 *     o "bloqueia" diria "esta operação não aceita cliente em atraso", e a PATCH aceita — não aparece;
 *   · com o cliente TROCADO, nenhuma pergunta sai (`/situacao-cliente` pede `.create`): o 422 `CLIENTE_EM_ATRASO` do
 *     servidor cai no campo Cliente.
 */
export function situacaoDoAtrasoNaEdicao<T extends { politica: string }>(lida: T | null, clienteGravado: string, clienteAtual: string): T | null {
  return lida && lida.politica === "avisa" && clienteAtual.toLowerCase() === clienteGravado.toLowerCase() ? lida : null;
}
