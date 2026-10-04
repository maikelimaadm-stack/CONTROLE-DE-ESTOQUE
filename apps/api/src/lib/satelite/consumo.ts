/**
 * CONSUMO DO PROVEDOR SATELITAL NO LEDGER (SAT-03, decisão 296) — `erp.satelite_consumo`.
 *
 * O PU (processing units) gasto por uma chamada vem do cabeçalho `x-processingunits-spent` da resposta 2xx
 * (`ClienteCopernicus.estatisticaComConsumo`). Ele é LIDO aqui, na forma estrita, e nunca traduzido: `1e2`, `-1`,
 * `1,5`, `NaN`, espaço ou texto longo não viram número — a linha entra com o PAR NULO (pu e créditos) e a origem
 * dizendo por quê (`cabecalho_invalido`, ou `cabecalho_ausente` quando não veio). A chamada aconteceu e conta para o
 * limite global do mesmo jeito (a linha existe); só o custo fica desconhecido. Ele nunca é GRAVADO como zero (a linha
 * diz "não sei", não "foi de graça"), mas o saldo do orçamento soma só os créditos conhecidos: a linha nula fica fora da
 * soma (`sum` ignora nulo), o que na prática a conta como custo zero no saldo — decisão do Maike.
 *
 * O CRÉDITO é calculado PELO BANCO, da mesma expressão do CHECK da 0053 (`creditos = round(pu_gasto × 100, 2)`), sobre
 * o PU já convertido para o tipo da coluna: os dois nunca divergem, e nenhum ponto flutuante passa pelo Node.
 */
import type { Tx } from "@agro/db";

/** O PU lido do cabeçalho: o valor e a origem (o bruto), ou o par nulo com o motivo. */
export type PuLido = { pu: string; origem: string } | { pu: null; origem: "cabecalho_ausente" | "cabecalho_invalido" };

/** Forma estrita: até 10 dígitos inteiros (o `numeric(14,4)` da coluna) e, opcional, ponto e até 12 decimais. */
const FORMA_PU = /^\d{1,10}(\.\d{1,12})?$/;
/** Teto do texto guardado em `origem_cabecalho` (a forma estrita já cabe com folga). */
const ORIGEM_MAXIMA = 64;

/**
 * O PU cabe no `numeric(14,4)` DEPOIS de arredondado para 4 casas? Só não cabe 9999999999,99995 em diante (o
 * arredondamento leva a 11 dígitos inteiros): o banco recusaria a linha e derrubaria a transação inteira (a análise
 * junto). Fora da coluna é inválido, como qualquer outra forma fora do contrato.
 */
function cabeNaColuna(pu: string): boolean {
  const [inteiro = "", decimais = ""] = pu.split(".");
  return !(inteiro === "9999999999" && /^9{4}[5-9]/.test(decimais));
}

export function lerPuDoCabecalho(bruto: string | null): PuLido {
  if (bruto === null) return { pu: null, origem: "cabecalho_ausente" };
  if (bruto.length > ORIGEM_MAXIMA || !FORMA_PU.test(bruto) || !cabeNaColuna(bruto)) return { pu: null, origem: "cabecalho_invalido" };
  return { pu: bruto, origem: bruto };
}

export interface DadosConsumo {
  organizationId: string;
  empresaId: string;
  /** Consulta e item da fila que gastaram (o executor); nulos no pedido avulso da SAT-01. */
  consultaId: string | null;
  consultaItemId: string | null;
  /** O cabeçalho BRUTO da resposta 2xx (ou null se não veio): a leitura é feita aqui. */
  puCabecalho: string | null;
}

/**
 * Uma linha no ledger (operação `statistical`), na transação de quem chama — sob a RLS dele: fora do escopo a política
 * recusa a gravação. ROW COUNT conferido. Devolve o que o banco gravou (PU e créditos como string decimal, ou nulos).
 */
export async function gravarConsumo(tx: Tx, d: DadosConsumo): Promise<{ id: string; pu_gasto: string | null; creditos: string | null }> {
  const lido = lerPuDoCabecalho(d.puCabecalho);
  const g = await tx.query<{ id: string; pu_gasto: string | null; creditos: string | null }>(
    `insert into erp.satelite_consumo (organization_id, empresa_id, consulta_id, consulta_item_id, operacao, pu_gasto, creditos, origem_cabecalho)
     values ($1, $2, $3, $4, 'statistical', $5::numeric(14,4), round($5::numeric(14,4) * 100, 2), $6)
     returning id, pu_gasto, creditos`,
    [d.organizationId, d.empresaId, d.consultaId, d.consultaItemId, lido.pu, lido.origem]);
  if (g.rowCount !== 1) throw new Error("consumo satelital: a gravação no ledger não devolveu exatamente uma linha");
  return g.rows[0]!;
}
