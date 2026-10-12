import { D } from "@agro/shared";
import type { ItemRow, Plan, Row } from "@/features/docs/shared";
import type { TravasDaLinha } from "@/features/central/contrato";
import type { CompraGerada } from "../proximos-passos-pedido";
import type { LimitesDaEdicaoDeCompra } from "./edicao-api";

/**
 * EDITAR-02 (decisão 313) — A EDIÇÃO DO PEDIDO DE COMPRA E DA COMPRA NA CENTRAL: contas PURAS, sem React e sem rede (o
 * estado, `estado.ts`, só as chama; o teste de unidade as prova uma a uma). A forma do servidor mora em `edicao-api.ts`.
 *
 * A REGRA (do dono): edita a compra ABERTA e o pedido de compra ABERTO sem compra viva. Confirmado, cancelado, pedido
 * com compra viva, pedido finalizado ou convertido — cada um com a SUA recusa. O servidor é quem decide (a PATCH e o
 * `GET /edicao` fazem a mesma pergunta); aqui só se OFERECE:
 *
 *   · A AÇÃO "Editar" (`acaoEditar`): sem `<recurso>.edit` E `<recurso>.view`, não aparece; com elas, desabilitada com
 *     o motivo no que a consulta JÁ SABE (a situação e as compras geradas do pedido). O documento aprovado (P2) a
 *     consulta não sabe sem perguntar de novo: a ação fica habilitada, e a recusa do servidor (o `motivo` do
 *     `GET /edicao`) aparece ao abrir.
 *   · A ABERTURA (`aberturaDoDocumento`): o cabeçalho, os itens (com o `id` de cada item salvo) e o plano GRAVADOS —
 *     nada semeado: nem o padrão do layout, nem os padrões financeiros da TOP (decisão 311 item 2: só na criação).
 *   · O CORPO (`corpoDaEdicao`): `{ version, ...só o que mudou }`, comparado com a abertura campo a campo (o mesmo
 *     número com outra grafia não é mudança). `itens`, quando algum item mudou ou entrou, vai COMPLETO: todo item
 *     salvo com o `id` (e só os campos que mudaram nele), os novos sem `id` (P1: item salvo não sai).
 *   · AS TRAVAS (`travasDoItem`, `campoTravadoNaEdicao`, `itensNaEdicao`): o que a PATCH recusa fica em leitura; o
 *     item salvo nunca sai; a defesa do handler desfaz o que a tela não deixaria fazer.
 */

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const aparado = (v: unknown): string => texto(v).trim();
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/* ═════════════════════════════════════ A AÇÃO "EDITAR" NA CONSULTA ═════════════════════════════════════ */

/*
 * Os motivos da ação desabilitada — ESPELHAM, texto a texto, as recusas do servidor (409 `INVALID_STATUS_TRANSITION`,
 * `compras-edicao-regras.ts`, decisão 313 D1). O texto da tela só explica; a recusa que vale é a do servidor.
 */
export const DICA_EDITAR_CONFIRMADA = "Esta compra está confirmada: a entrada no estoque e as contas a pagar já foram lançadas e não se editam. Para corrigir, cancele a compra (o cancelamento estorna o estoque e as contas) e lance de novo.";
export const DICA_EDITAR_CANCELADO = "Este documento está cancelado: não há o que editar.";
export const DICA_EDITAR_PEDIDO_FINALIZADO = "Este pedido já foi finalizado e não se edita.";
export const DICA_EDITAR_PEDIDO_CONVERTIDO = "Este pedido já foi convertido em compra e não se edita.";
export const DICA_EDITAR_SITUACAO_DESCONHECIDA = "Este documento não se edita nesta situação.";
/** O pedido aberto com compra viva: aponta a(s) compra(s) pelo código. */
export const dicaDoPedidoComCompraViva = (codigos: readonly string[]): string => codigos.length === 1
  ? `Este pedido já gerou a compra ${codigos[0]!}: editar o pedido desmentiria a compra. Cancele a compra para editar o pedido.`
  : `Este pedido já gerou as compras ${codigos.join(", ")}: editar o pedido desmentiria as compras. Cancele-as para editar o pedido.`;

/** As compras vivas do pedido (não canceladas), na ordem em que o servidor as declarou. */
export const comprasVivas = (compras: readonly CompraGerada[] | null): CompraGerada[] => (compras ?? []).filter((c) => c.situacao !== "cancelado");

/**
 * O motivo da ação "Editar" DESABILITADA, pelo que a consulta já leu — `null` = habilitada. A situação vem antes (o
 * pedido finalizado pode ter compra viva, e a recusa dele é a da situação); no pedido aberto, a compra viva. Situação
 * que a tela não conhece: desabilitada (fail-closed) — o servidor responderia a dele.
 */
export function dicaDoEditar(p: { situacao: string; ehPedido: boolean; comprasGeradas: readonly CompraGerada[] | null }): string | null {
  switch (p.situacao) {
    case "aberto": {
      if (!p.ehPedido) return null;
      const vivas = comprasVivas(p.comprasGeradas);
      return vivas.length ? dicaDoPedidoComCompraViva(vivas.map((c) => c.codigo || c.id)) : null;
    }
    case "confirmado": return p.ehPedido ? DICA_EDITAR_SITUACAO_DESCONHECIDA : DICA_EDITAR_CONFIRMADA;
    case "cancelado": return DICA_EDITAR_CANCELADO;
    case "finalizado": return p.ehPedido ? DICA_EDITAR_PEDIDO_FINALIZADO : DICA_EDITAR_SITUACAO_DESCONHECIDA;
    case "convertido": return p.ehPedido ? DICA_EDITAR_PEDIDO_CONVERTIDO : DICA_EDITAR_SITUACAO_DESCONHECIDA;
    default: return DICA_EDITAR_SITUACAO_DESCONHECIDA;
  }
}

export interface AcaoEditar {
  /** A ação aparece: `<recurso>.edit` E `<recurso>.view` (as MESMAS da PATCH e do `GET /edicao`). */
  visivel: boolean;
  /** null = habilitada; texto = a dica da ação desabilitada (o motivo). */
  dicaDesabilitada: string | null;
}

/**
 * A AÇÃO "Editar" do pedido e da compra. `recusaDoServidor` é o `motivo` que o `GET /edicao` acabou de dar (P2, o
 * aprovado; ou qualquer outra recusa que a consulta não sabia): ela vale até o documento ser lido de novo.
 */
export function acaoEditar(p: {
  can: (permissao: string) => boolean; perm: string; carregado: boolean;
  situacao: string; ehPedido: boolean; comprasGeradas: readonly CompraGerada[] | null; recusaDoServidor: string | null;
}): AcaoEditar {
  const visivel = p.carregado && p.can(`${p.perm}.edit`) && p.can(`${p.perm}.view`);
  if (!visivel) return { visivel: false, dicaDesabilitada: null };
  return { visivel, dicaDesabilitada: dicaDoEditar(p) ?? p.recusaDoServidor };
}

/* ═════════════════════════════════════ A ABERTURA ═════════════════════════════════════ */

/** O cabeçalho que a Central edita — as MESMAS chaves de `Cabecalho` (estado.ts), todas texto. */
export interface CabecalhoDaEdicao {
  empresa_id: string; fornecedor_id: string; transportadora_id: string; data_documento: string; data_entrada: string;
  data_vencimento: string; numero_nota: string; serie_nota: string; categoria_financeira_id: string; centro_custo_id: string;
  condicao_pagamento_id: string; forma_pagamento_id: string; frete: string; outras_despesas: string; desconto: string; observacao: string;
}

export interface AberturaDaEdicao {
  cabecalho: CabecalhoDaEdicao;
  /** Os itens salvos na ordem do documento, cada um com o `id` (a chave que a PATCH leva). */
  itens: ItemRow[];
  /** O plano gravado é do operador (ajustado), não o da condição. */
  ajustarParcelas: boolean;
  plano: Plan;
}

/** O id do item salvo de uma linha da grade (vazio = item novo, incluído na edição). */
export const idDoItem = (l: ItemRow): string => (typeof l["id"] === "string" ? l["id"] : "");
const data = (v: unknown): string => aparado(v).slice(0, 10);

/** O plano gravado na forma do editor (`Plan`), ou `null` quando não é dela (aí a tela mostra "pela condição"). */
export function planoGravado(v: unknown): Plan | null {
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

/** A linha da grade de um item salvo (as chaves do motor; o `id` do item, para a PATCH). */
export function linhaDoItemSalvo(it: Row): ItemRow {
  return {
    id: texto(it["id"]).toLowerCase(),
    product_id: texto(it["produto_id"]),
    warehouse_id: texto(it["armazem_id"]),
    quantity: texto(it["quantidade"]),
    unit_value: texto(it["valor_unitario"]),
    discount: texto(it["desconto"]),
    discount_percent: texto(it["desconto_percentual"]),
    provider_lot: texto(it["lote"]),
    expiration_date: data(it["validade"])
  };
}

/**
 * A ABERTURA da edição: o documento GRAVADO (o `documento` do `GET /edicao`, o mesmo do `GET :id`) nas chaves da
 * Central. Nenhum padrão entra aqui — nem o do layout, nem os financeiros da TOP (decisão 311: só na criação). O plano é
 * do operador quando a compra o gravou ajustado sobre a condição, ou sem condição nenhuma (o plano veio do corpo).
 */
export function aberturaDoDocumento(d: Row, plano: () => Plan): AberturaDaEdicao {
  const cabecalho: CabecalhoDaEdicao = {
    empresa_id: texto(d["empresa_id"]), fornecedor_id: texto(d["fornecedor_id"]), transportadora_id: texto(d["transportadora_id"]),
    data_documento: data(d["data_documento"]), data_entrada: data(d["data_entrada"]), data_vencimento: data(d["data_vencimento"]),
    numero_nota: texto(d["numero_nota"]), serie_nota: texto(d["serie_nota"]),
    categoria_financeira_id: texto(d["categoria_financeira_id"]), centro_custo_id: texto(d["centro_custo_id"]),
    condicao_pagamento_id: texto(d["condicao_pagamento_id"]), forma_pagamento_id: texto(d["forma_pagamento_id"]),
    frete: texto(d["frete"]) || "0", outras_despesas: texto(d["outras_despesas"]) || "0", desconto: texto(d["desconto"]) || "0",
    observacao: texto(d["observacao"])
  };
  const itens = (Array.isArray(d["itens"]) ? (d["itens"] as unknown[]) : []).filter(ehObjeto).map(linhaDoItemSalvo);
  const lido = planoGravado(d["plano_parcelas"]);
  const ajustarParcelas = lido !== null && (d["parcelas_ajustadas"] === true || !aparado(d["condicao_pagamento_id"]));
  return { cabecalho, itens, ajustarParcelas, plano: ajustarParcelas && lido ? lido : plano() };
}

/* ═════════════════════════════════════ O CORPO DA PATCH ═════════════════════════════════════ */

type Tipo = "uuid" | "data" | "texto" | "decimal";

/** Os campos do cabeçalho que a PATCH aceita e como cada um se compara. Lista ESTÁTICA; `empresa_id` nunca vai. */
const CABECALHO: Readonly<Record<Exclude<keyof CabecalhoDaEdicao, "empresa_id">, Tipo>> = {
  fornecedor_id: "uuid", transportadora_id: "uuid", data_documento: "data", data_entrada: "data", data_vencimento: "data",
  numero_nota: "texto", serie_nota: "texto", categoria_financeira_id: "uuid", centro_custo_id: "uuid", condicao_pagamento_id: "uuid",
  forma_pagamento_id: "uuid", frete: "decimal", outras_despesas: "decimal", desconto: "decimal", observacao: "texto"
};
/** Só da compra (o pedido recusa: `conferirCamposDaEspecie`). */
const SO_DA_COMPRA: ReadonlySet<string> = new Set(["data_entrada", "numero_nota", "serie_nota"]);

/** O valor como vai no corpo: decimal vazio é "0"; o resto vazio é `null` (a coluna sem valor). */
function valorDoCorpo(tipo: Tipo, v: string): string | null {
  const t = v.trim();
  if (tipo === "decimal") return t === "" ? "0" : t;
  if (t === "") return null;
  return tipo === "uuid" ? t.toLowerCase() : t;
}

/** Dois valores iguais para o servidor (o mesmo número com outra grafia, o mesmo UUID em outra caixa). */
function iguais(tipo: Tipo, a: string, b: string): boolean {
  const x = valorDoCorpo(tipo, a); const y = valorDoCorpo(tipo, b);
  if (tipo !== "decimal" || x === null || y === null) return x === y;
  try { return D(x).eq(D(y)); } catch { return x === y; }
}

/** Os campos de UM item que a PATCH aceita (as chaves do corpo) ← as chaves da linha da grade. */
const ITEM: readonly { corpo: string; linha: keyof ItemRow & string; tipo: Tipo; soDaCompra?: boolean }[] = [
  { corpo: "produto_id", linha: "product_id", tipo: "uuid" },
  { corpo: "armazem_id", linha: "warehouse_id", tipo: "uuid" },
  { corpo: "quantidade", linha: "quantity", tipo: "decimal" },
  { corpo: "valor_unitario", linha: "unit_value", tipo: "decimal" },
  { corpo: "desconto", linha: "discount", tipo: "decimal" },
  { corpo: "desconto_percentual", linha: "discount_percent", tipo: "decimal" },
  { corpo: "lote", linha: "provider_lot", tipo: "texto", soDaCompra: true },
  { corpo: "validade", linha: "expiration_date", tipo: "data", soDaCompra: true }
];
const camposDoItem = (ehCompra: boolean) => ITEM.filter((c) => ehCompra || !c.soDaCompra);

/** O item NOVO no corpo: as chaves do lançamento (produto, quantidade e valor unitário sempre; o resto só preenchido). */
function itemNovoNoCorpo(l: ItemRow, ehCompra: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of camposDoItem(ehCompra)) {
    const v = texto(l[c.linha]);
    if (c.corpo === "produto_id" || c.corpo === "quantidade") { out[c.corpo] = c.tipo === "uuid" ? v.trim().toLowerCase() : v.trim(); continue; }
    if (c.corpo === "valor_unitario") { out[c.corpo] = v.trim() || "0"; continue; }
    if (v.trim()) out[c.corpo] = valorDoCorpo(c.tipo, v);
  }
  return out;
}

/** O que mudou num item salvo (as chaves do corpo, só as alteradas). */
function mudancasDoItem(gravado: ItemRow, atual: ItemRow, ehCompra: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of camposDoItem(ehCompra)) {
    const a = texto(gravado[c.linha]); const b = texto(atual[c.linha]);
    if (!iguais(c.tipo, a, b)) out[c.corpo] = valorDoCorpo(c.tipo, b);
  }
  return out;
}

const planoCanonico = (p: Plan): string => JSON.stringify(Object.keys(p).sort().map((k) => [k, (p as unknown as Record<string, unknown>)[k]]));

/** O estado da tela que a PATCH compara com a abertura. */
export interface EstadoDaEdicao { cabecalho: CabecalhoDaEdicao; itens: readonly ItemRow[]; ajustarParcelas: boolean; plano: Plan }

/**
 * O CORPO DA PATCH: `{ version, ...só o que mudou }`.
 *   · cabeçalho: cada campo de `CABECALHO` que difere da abertura (o vazio vai `null`; frete, outras e desconto vazios
 *     vão "0"); os da compra só na compra; a empresa nunca;
 *   · plano: `plano_parcelas` quando o "Ajustar parcelas" mudou (desligado = `null`, "pela condição") ou o plano
 *     ajustado mudou;
 *   · itens: quando algum item salvo mudou, algum entrou, ou a ordem mudou — a lista COMPLETA, cada item salvo com o
 *     `id` e só os campos que mudaram nele, os novos sem `id` (com produto, quantidade e valor unitário).
 * Nada mudou ⇒ só `{ version }` (`mudouAlgo` falso: a tela não envia).
 */
export function corpoDaEdicao(p: { version: string; ehCompra: boolean; abertura: EstadoDaEdicao; atual: EstadoDaEdicao }): Record<string, unknown> {
  const { abertura: a, atual: b, ehCompra } = p;
  const corpo: Record<string, unknown> = { version: p.version };
  for (const [campo, tipo] of Object.entries(CABECALHO) as [keyof typeof CABECALHO, Tipo][]) {
    if (!ehCompra && SO_DA_COMPRA.has(campo)) continue;
    if (!iguais(tipo, a.cabecalho[campo], b.cabecalho[campo])) corpo[campo] = valorDoCorpo(tipo, b.cabecalho[campo]);
  }
  if (a.ajustarParcelas !== b.ajustarParcelas) corpo.plano_parcelas = b.ajustarParcelas ? b.plano : null;
  else if (b.ajustarParcelas && planoCanonico(a.plano) !== planoCanonico(b.plano)) corpo.plano_parcelas = b.plano;

  const gravados = new Map(a.itens.map((l) => [idDoItem(l), l]));
  const ordemGravada = a.itens.map(idDoItem);
  let itensMudaram = b.itens.length !== a.itens.length;
  const itens = b.itens.map((l, k) => {
    const id = idDoItem(l);
    const g = id ? gravados.get(id) : undefined;
    if (!id || !g) { itensMudaram = true; return itemNovoNoCorpo(l, ehCompra); }
    if (ordemGravada[k] !== id) itensMudaram = true;
    const m = mudancasDoItem(g, l, ehCompra);
    if (Object.keys(m).length) itensMudaram = true;
    return { id, ...m };
  });
  if (itensMudaram) corpo.itens = itens;
  return corpo;
}

/** A PATCH muda alguma coisa (algo além da `version`)? */
export const mudouAlgo = (corpo: Record<string, unknown>): boolean => Object.keys(corpo).some((k) => k !== "version");

/* ═════════════════════════════════════ AS TRAVAS ═════════════════════════════════════ */

/** A recusa PRÓPRIA da PATCH para a empresa (o texto do servidor, espelhado: a empresa nunca vai no corpo). */
export const MOTIVO_EMPRESA_NA_EDICAO = "A empresa não muda na edição do documento.";

/**
 * Por que a edição TRAVA o campo do cabeçalho (`null` = livre; o controle de sempre em leitura): a empresa sempre (a
 * PATCH a recusa); o resto pelos limites do servidor (`limites.campos`: o fornecedor da compra gerada de pedido e do
 * pedido que já gerou compra; frete, outras despesas, desconto, condição, vencimento e parcelas da compra com as
 * duplicatas da nota). A TOP e a versão dela nem são campo: ficam no contexto travado, como na criação; os dados fiscais
 * do cabeçalho aparecem só em leitura.
 */
export function motivoDaTravaNaEdicao(limites: LimitesDaEdicaoDeCompra, campo: string): string | null {
  if (campo === "empresa_id") return MOTIVO_EMPRESA_NA_EDICAO;
  return Object.hasOwn(limites.campos, campo) ? limites.campos[campo]! : null;
}
export const campoTravadoNaEdicao = (limites: LimitesDaEdicaoDeCompra, campo: string): boolean => motivoDaTravaNaEdicao(limites, campo) !== null;

/**
 * As travas de UMA linha: o item salvo é FIXO (P1: não sai) e leva os limites dele (`limites.itens[]`): os campos
 * travados (produto, quantidade, valor unitário, descontos) com o MOTIVO do servidor de cada um, e o teto da quantidade
 * (`quantidadeMaxima`, D2: o saldo do item do pedido de origem — o `max` da quantidade, como no receber). O item novo,
 * nenhuma.
 */
export function travasDoItem(limites: LimitesDaEdicaoDeCompra, linha: ItemRow): TravasDaLinha {
  const id = idDoItem(linha);
  if (!id) return {};
  const limite = limites.itens.find((x) => x.id === id.toLowerCase());
  const campos = limite?.campos ?? {};
  const motivo = (...c: string[]) => c.map((x) => (Object.hasOwn(campos, x) ? campos[x] : undefined)).find((m) => m !== undefined);
  const motivos = { produto: motivo("produto_id"), quantidade: motivo("quantidade"), unitario: motivo("valor_unitario"), desconto: motivo("desconto", "desconto_percentual") };
  const travas: TravasDaLinha = {
    fixa: true, produto: motivos.produto !== undefined, quantidade: motivos.quantidade !== undefined,
    unitario: motivos.unitario !== undefined, desconto: motivos.desconto !== undefined
  };
  const comMotivo = Object.fromEntries(Object.entries(motivos).filter(([, m]) => m !== undefined)) as NonNullable<TravasDaLinha["motivos"]>;
  if (Object.keys(comMotivo).length) travas.motivos = comMotivo;
  if (limite?.quantidadeMaxima != null && !travas.quantidade) travas.quantidadeMaxima = limite.quantidadeMaxima;
  return travas;
}

/**
 * As travas que a GRADE recebe: na edição, as de cada linha (`travasDoItem`); fora dela (a criação, o receber), `null` —
 * a grade de hoje, sem teto de quantidade nem motivo (o receber continua com o `max` do modo "da origem").
 */
export const travasDaLinhaNaTela = (limites: LimitesDaEdicaoDeCompra | null): ((linha: ItemRow) => TravasDaLinha) | null =>
  (limites ? (l: ItemRow) => travasDoItem(limites, l) : null);

/**
 * A dica do nome do documento em EDIÇÃO (a da criação fala da confirmação, que a PATCH não faz — P4 da 313): editar só
 * grava; confirmar a compra, e finalizar ou receber o pedido, seguem pela consulta.
 */
export const dicaDaIdentidadeNaEdicao = (ehCompra: boolean): string => (ehCompra
  ? "Editar não confirma: salve as alterações e confirme pela consulta."
  : "Editar não finaliza nem recebe o pedido: salve as alterações e siga pela consulta.");

/** Os campos da linha que cada trava protege (as chaves do motor). */
const PROTEGIDOS: readonly { trava: keyof Omit<TravasDaLinha, "fixa">; chaves: readonly string[] }[] = [
  { trava: "produto", chaves: ["product_id"] },
  { trava: "quantidade", chaves: ["quantity"] },
  { trava: "unitario", chaves: ["unit_value"] },
  { trava: "desconto", chaves: ["discount", "discount_percent"] }
];

/**
 * A DEFESA DO HANDLER (o `disabled` e o botão escondido são apresentação): a lista nova que a grade entrega, conferida
 * contra a anterior.
 *   · um item salvo que sumiu (P1) ⇒ a lista anterior, inteira;
 *   · o MESMO `id` duas vezes (o Duplicar de um item salvo) ⇒ a cópia é item NOVO (sem `id`);
 *   · item novo onde a edição não os aceita ⇒ fora;
 *   · campo travado de item salvo ⇒ o valor anterior.
 * Devolve a MESMA lista anterior quando nada pode mudar.
 */
export function itensNaEdicao(antes: readonly ItemRow[], novos: readonly ItemRow[], limites: LimitesDaEdicaoDeCompra): ItemRow[] {
  const ids = new Set(novos.map(idDoItem).filter(Boolean));
  if (antes.some((l) => { const id = idDoItem(l); return id !== "" && !ids.has(id); })) return [...antes];
  const anterior = new Map(antes.map((l) => [idDoItem(l), l]));
  const vistos = new Set<string>();
  const out: ItemRow[] = [];
  for (const l of novos) {
    const id = idDoItem(l);
    if (id && !vistos.has(id)) {
      vistos.add(id);
      const t = travasDoItem(limites, l);
      const g = anterior.get(id);
      let linha = l;
      if (g) for (const p of PROTEGIDOS) if (t[p.trava]) for (const k of p.chaves) if (texto(linha[k]) !== texto(g[k])) linha = { ...linha, [k]: g[k] };
      out.push(linha);
      continue;
    }
    if (limites.itemNovo !== null) continue;
    if (id) { const { id: _copia, ...semId } = l; out.push(semId as ItemRow); continue; }
    out.push(l);
  }
  return out;
}
