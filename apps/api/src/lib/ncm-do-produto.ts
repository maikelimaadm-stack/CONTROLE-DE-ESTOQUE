import type { Tx } from "@agro/db";
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";

export const MENSAGEM_NCM_DO_PRODUTO = "Escolha uma NCM de 8 dígitos vigente (use a busca).";

/** Por transação: a mesma NCM se repete na planilha — uma SELECT por código distinto. */
const ncmOkPorTx = new WeakMap<Tx, Set<string>>();
const ncmRuimPorTx = new WeakMap<Tx, Set<string>>();

/**
 * A NCM ESCOLHÍVEL, sobre as colunas de erp.ncm: 8 dígitos e vigente hoje. UM predicado para a conferência de um código
 * (`conferirNcmDoProduto`) e para a do lote (`ncmsVigentes`) — duas cópias do SQL divergiriam em silêncio.
 */
const NCM_VIGENTE = "nivel=8 and vigencia_inicio <= current_date and vigencia_fim >= current_date";

/**
 * NCM do produto (CADASTROS Fase 3): só a de 8 dígitos VIGENTE é escolhível. A FK da 0002 já prova que o
 * código existe em erp.ncm; esta regra fecha o que a FK não fecha (capítulo, posição, código vencido).
 * Só quando o valor MUDA: um produto do acervo com NCM antiga continua editável sem tocar no campo.
 */
export async function conferirNcmDoProduto(ctx: ServiceCtx, data: Record<string, unknown>, atual: Record<string, unknown> | null): Promise<void> {
  if (!("ncm_code" in data)) return;
  const ncm = data["ncm_code"];
  if (ncm === null || ncm === undefined || ncm === "") return;
  if (atual !== null && ncm === atual["ncm_code"]) return;
  const codigo = String(ncm);
  let ok = ncmOkPorTx.get(ctx.tx);
  if (!ok) { ok = new Set(); ncmOkPorTx.set(ctx.tx, ok); }
  if (ok.has(codigo)) return;
  let ruim = ncmRuimPorTx.get(ctx.tx);
  if (!ruim) { ruim = new Set(); ncmRuimPorTx.set(ctx.tx, ruim); }
  if (ruim.has(codigo)) throw validation(MENSAGEM_NCM_DO_PRODUTO, [{ path: ["ncm_code"], message: MENSAGEM_NCM_DO_PRODUTO }]);
  const r = await ctx.tx.query(`select 1 from erp.ncm where code=$1 and ${NCM_VIGENTE}`, [codigo]);
  if (!r.rowCount) {
    ruim.add(codigo);
    throw validation(MENSAGEM_NCM_DO_PRODUTO, [{ path: ["ncm_code"], message: MENSAGEM_NCM_DO_PRODUTO }]);
  }
  ok.add(codigo);
}

/**
 * Das NCMs dadas, as ESCOLHÍVEIS (a mesma regra de `conferirNcmDoProduto`), numa consulta só — o cadastro em lote
 * (XML-01) confere todas antes de gravar o primeiro produto. Lista vazia: nenhuma consulta, conjunto vazio.
 */
export async function ncmsVigentes(ctx: ServiceCtx, codigos: readonly string[]): Promise<Set<string>> {
  const distintos = [...new Set(codigos)];
  if (distintos.length === 0) return new Set();
  const r = await ctx.tx.query<{ code: string }>(`select code from erp.ncm where code = any($1::text[]) and ${NCM_VIGENTE}`, [distintos]);
  return new Set(r.rows.map((x) => x.code));
}
