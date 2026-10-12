import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";

export const MENSAGEM_NCM_DO_PRODUTO = "Escolha uma NCM de 8 dígitos vigente (use a busca).";

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
  const r = await ctx.tx.query(`select 1 from erp.ncm where code=$1 and ${NCM_VIGENTE}`, [ncm]);
  if (!r.rowCount) throw validation(MENSAGEM_NCM_DO_PRODUTO, [{ path: ["ncm_code"], message: MENSAGEM_NCM_DO_PRODUTO }]);
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
