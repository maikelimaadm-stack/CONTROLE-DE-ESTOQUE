import type { ItemRow, Plan, Row } from "@/features/docs/shared";
import { copiaValePara as copiaValeParaDoMotor, montarCopia, type CopiaEmMemoria } from "@/features/central/duplicar-memoria";
import { chaveDaCopiaDeVenda } from "./central-vendas-adaptador";

/**
 * DUPLICAR DOCUMENTO DE VENDA (VISUAL-UX-02, decisão 270, item 4.1; entrega genérica no motor desde VISUAL-UX-04) —
 * funções PURAS: nada de React, de rede ou de navegador.
 *
 * ┌─ O QUE A CÓPIA LEVA E O QUE ELA NÃO LEVA ──────────────────────────────────────────────────────┐
 * │ Leva, a partir do GET do detalhe (o que o servidor devolveu, nunca o que a tela mostrou): a MESMA │
 * │ TOP, cliente, empresa, forma de pagamento, frete e transporte, condição, natureza e centro,       │
 * │ dedutível, proprietário, observação e os itens (produto, armazém, quantidade, unitário, descontos │
 * │ e observação do item).                                                                           │
 * │ NÃO leva: número, situação, responsável, origem, versão, títulos, nem DATAS. A Data é a de hoje,  │
 * │ como em todo lançamento novo; Vencimento e Data de saída ficam vazios; o 1º vencimento do plano   │
 * │ volta ao de um lançamento novo, e com condição de pagamento o plano é recalculado por ela.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A viagem (entrega em memória, com dono; nada na URL nem no armazenamento do navegador) e a conferência de que a
 * cópia vale para a criação aberta são do motor (`@/features/central/duplicar-memoria`). Aqui ficam os campos da venda.
 */

/** A chave (do Map em memória, nunca de storage) da cópia que espera a criação da espécie: `central-vendas:copia:<seg>`. */
export const chaveDaCopia = chaveDaCopiaDeVenda;

/** Os campos do cabeçalho do lançamento que a cópia preenche — os mesmos nomes do estado da criação. */
export interface CabecalhoDaCopia {
  empresa_id: string; client_id: string; transporter_id: string; proprietary_id: string; driver_name: string; payment_method_id: string;
  freight: string; freight_icms: string; other_values: string; discount: string; note: string; is_deductible: boolean; installments: boolean;
  categoria_financeira_id: string; centro_custo_id: string; condicao_pagamento_id: string;
}

/**
 * A cópia de um documento de venda: segmento, a TOP do original (a criação só a consome quando abre com ELA), o
 * cabeçalho, os itens e o plano de parcelas sem datas (só quando o original era parcelado SEM condição).
 */
export type CopiaDoDocumento = CopiaEmMemoria<CabecalhoDaCopia>;

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Por que este documento NÃO pode ser duplicado — `null` quando pode. A dica do botão desabilitado é esta frase.
 *   - gerado de outro (tem origem, ou algum item aponta para o item da origem): a cópia viraria um documento solto do
 *     saldo da origem, sem baixar nada nela;
 *   - sem Tipo de Operação (registro legado): a criação só abre com uma TOP.
 */
export function motivoParaNaoDuplicar(d: Row): string | null {
  const itens = Array.isArray(d["items"]) ? (d["items"] as Row[]) : [];
  const temOrigem = texto(d["origin_document_id"]) !== "" || itens.some((it) => typeof it["origem_item_id"] === "string" && it["origem_item_id"] !== "");
  if (temOrigem) return "Documento gerado de outro: a cópia ficaria solta do saldo da origem";
  if (texto(d["tipo_operacao_id"]) === "") return "Documento sem Tipo de Operação: não há com o que abrir a cópia";
  return null;
}

/** O plano do registro, sem as datas — só quando havia plano (parcelado) e nenhuma condição. */
function planoSemDatas(d: Row, hoje: string): Plan | null {
  const p = d["installment_plan"];
  if (!ehObjeto(p) || typeof p["installments"] !== "number" || texto(d["condicao_pagamento_id"]) !== "") return null;
  const plano: Plan = {
    installments: p["installments"],
    first_due_date: hoje,
    mode: p["mode"] === "fixed_day" ? "fixed_day" : "interval",
    interval_days: typeof p["interval_days"] === "number" ? p["interval_days"] : 30,
    has_down_payment: p["has_down_payment"] === true
  };
  if (typeof p["due_day"] === "number") plano.due_day = p["due_day"];
  if (plano.has_down_payment && p["down_payment_value"] !== undefined && p["down_payment_value"] !== null) plano.down_payment_value = String(p["down_payment_value"]);
  return plano;
}

/**
 * Monta a cópia a partir do GET do detalhe. `null` quando o documento não pode ser duplicado (`motivoParaNaoDuplicar`).
 * `hoje` entra como parâmetro para a função continuar pura (a data de hoje vem de quem chama).
 */
export function copiaDoDocumento(d: Row, segmento: string, hoje: string): CopiaDoDocumento | null {
  if (motivoParaNaoDuplicar(d) !== null) return null;
  const plano = ehObjeto(d["installment_plan"]) ? d["installment_plan"] : {};
  const parcelado = planoSemDatas(d, hoje);
  const itens = (Array.isArray(d["items"]) ? (d["items"] as Row[]) : []).map((it): ItemRow => {
    const item: ItemRow = {
      product_id: texto(it["product_id"]),
      quantity: texto(it["quantity"]) || "1",
      unit_value: texto(it["unit_price"]) || "0",
      discount: texto(it["discount"]) || "0",
      discount_percent: texto(it["discount_percent"]) || "0",
      generate_stock: true
    };
    if (texto(it["warehouse_id"])) item.warehouse_id = texto(it["warehouse_id"]);
    if (texto(it["note"])) item["note"] = texto(it["note"]);
    return item;
  });
  const cabecalho: CabecalhoDaCopia = {
    empresa_id: texto(d["empresa_id"]),
    client_id: texto(d["client_id"]),
    transporter_id: texto(d["transporter_id"]),
    proprietary_id: texto(d["proprietary_id"]),
    driver_name: texto(d["driver_name"]),
    payment_method_id: texto(d["payment_method_id"]),
    freight: texto(d["freight"]) || "0",
    freight_icms: texto(d["freight_icms"]) || "0",
    other_values: texto(d["other_values"]) || "0",
    discount: texto(d["discount"]) || "0",
    note: texto(d["note"]),
    // o dedutível mora no plano gravado (a mesma leitura da conversão no servidor)
    is_deductible: plano["is_deductible"] === true,
    installments: parcelado !== null,
    categoria_financeira_id: texto(d["categoria_financeira_id"]),
    centro_custo_id: texto(d["centro_custo_id"]),
    condicao_pagamento_id: texto(d["condicao_pagamento_id"])
  };
  return montarCopia(segmento, texto(d["tipo_operacao_id"]), cabecalho, itens, parcelado);
}

/** A cópia recebida só vale para a criação da MESMA espécie aberta com a MESMA TOP do original. */
export function copiaValePara(copia: CopiaDoDocumento | null, segmento: string, tipoOperacaoId: string): copia is CopiaDoDocumento {
  return copiaValeParaDoMotor(copia, segmento, tipoOperacaoId);
}
