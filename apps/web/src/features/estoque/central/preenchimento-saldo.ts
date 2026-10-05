/**
 * PREENCHIMENTO DO AJUSTE A PARTIR DO SALDO — funções PURAS (HOTFIX CI LT-K1).
 *
 * A linha do Saldo (empresa, armazém, produto, lote) vira URL e depois item inicial da Central.
 * O lote da linha NÃO pode sumir no caminho: estas funções são o contrato testável sem React.
 *
 * Sem `"use client"`: vitest importa daqui sem puxar hooks/alias do portal.
 */

/** Chaves do preenchimento pela URL (mesma lista de `movimentacoes-variantes`). */
export const CHAVES_PREENCHIMENTO_SALDO = Object.freeze(
  ["origem", "empresa_id", "armazem_id", "produto_id", "lote"] as const
);
export type ChavePreenchimentoSaldo = (typeof CHAVES_PREENCHIMENTO_SALDO)[number];
export type PreenchimentoSaldo = Partial<Record<ChavePreenchimentoSaldo, string | null | undefined>>;

export type ItemInicialSaldo = {
  product_id: string;
  quantity: string;
  unit_value: string;
  generate_stock: boolean;
  warehouse_id?: string;
  provider_lot?: string;
};

/** Só os valores não vazios, na ordem das chaves. */
export function parametrosDoPreenchimentoSaldo(p: PreenchimentoSaldo | undefined): URLSearchParams {
  const q = new URLSearchParams();
  if (!p) return q;
  for (const chave of CHAVES_PREENCHIMENTO_SALDO) {
    const valor = Object.hasOwn(p, chave) ? p[chave] : undefined;
    if (typeof valor === "string" && valor !== "") q.set(chave, valor);
  }
  return q;
}

/** Lê o preenchimento da URL (só chaves conhecidas e não vazias). */
export function preenchimentoDaUrlDeEstoque(params: { get(nome: string): string | null }): PreenchimentoSaldo {
  const out: PreenchimentoSaldo = {};
  for (const chave of CHAVES_PREENCHIMENTO_SALDO) {
    const valor = params.get(chave);
    if (valor) out[chave] = valor;
  }
  return out;
}

/**
 * "Ajustar estoque" a partir do Saldo → rota da Central de ajuste com a linha na query.
 * Aceita o formato da linha do Saldo (`warehouse_id` / `product_id` / `provider_lot`).
 */
export function rotaDoAjusteAPartirDoSaldo(linha: Record<string, unknown>): string {
  const texto = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
  const busca = parametrosDoPreenchimentoSaldo({
    empresa_id: texto(linha["empresa_id"]),
    armazem_id: texto(linha["warehouse_id"]),
    produto_id: texto(linha["product_id"]),
    lote: texto(linha["provider_lot"])
  }).toString();
  return `/estoque/movimentacoes/ajustes/new${busca ? `?${busca}` : ""}`;
}

/** Item(ns) iniciais a partir do preenchimento da URL (produto obrigatório; lote só se veio na URL). */
export function itensIniciaisDoPreenchimento(
  preenchimento: PreenchimentoSaldo,
  armazemId: string
): ItemInicialSaldo[] {
  if (!preenchimento.produto_id) return [];
  return [{
    product_id: preenchimento.produto_id,
    quantity: "",
    unit_value: "",
    generate_stock: true,
    ...(armazemId ? { warehouse_id: armazemId } : {}),
    ...(preenchimento.lote ? { provider_lot: preenchimento.lote } : {})
  }];
}

/**
 * Depois que o controle de lote do produto é CONHECIDO: se não controla, zera; se controla, preserva.
 * Enquanto desconhecido (leitura pendente), NÃO mexe — o lote da linha do Saldo sobrevive ao carregamento.
 */
export function loteAposControleDoProduto(
  providerLot: string | undefined,
  controle: { conhecido: boolean; lote: boolean }
): string {
  if (!controle.conhecido) return providerLot ?? "";
  return controle.lote ? (providerLot ?? "") : "";
}

/**
 * A coluna Lote (ou Validade) precisa aparecer já na abertura quando a linha do Saldo a trouxe —
 * sem esperar a leitura assíncrona do cadastro do produto (`lote.pede` fica falso enquanto pendente).
 */
export function forcarColunaDeLoteNaAbertura(
  campo: "lote" | "validade",
  itens: readonly { product_id?: string; provider_lot?: string; expiration_date?: string }[],
  pede: (produtoId: string, campo: "lote" | "validade") => boolean
): boolean {
  return itens.some((it) => {
    if (!it.product_id) return false;
    if (pede(it.product_id, campo)) return true;
    if (campo === "lote" && Boolean(it.provider_lot?.trim())) return true;
    if (campo === "validade" && Boolean(it.expiration_date?.trim())) return true;
    return false;
  });
}
