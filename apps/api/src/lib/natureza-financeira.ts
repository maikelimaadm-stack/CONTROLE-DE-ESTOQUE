/**
 * Regra do Tipo (coluna `nature`) na árvore de naturezas financeiras (`financial_categories`) —
 * CADASTROS-ESTRUTURA, B.4. A API é a autoridade; a tela só pré-preenche.
 *
 * - a filha tem o MESMO Tipo do superior, salvo quando o superior é "Receita e despesa" (`both`);
 * - o outro lado: um superior com filhas vivas não muda para um Tipo que as filhas não respeitem.
 */
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";

type Linha = Record<string, unknown>;
const campo = (path: string, message: string) => validation(message, [{ path: [path], message }]);

export const MENSAGEM_TIPO_DIVERGE_DO_SUPERIOR = "O Tipo precisa ser o mesmo da natureza superior (só um superior \"Receita e despesa\" aceita filhas de outro Tipo).";
export const MENSAGEM_TIPO_FILHAS_DIVERGEM = "Esta natureza tem filhas de outro Tipo. Ajuste ou mova as filhas antes de mudar o Tipo.";

export async function conferirTipoDaNatureza(ctx: ServiceCtx, id: string | null, data: Linha, atual: Linha | null): Promise<void> {
  const tipo = ("nature" in data ? data["nature"] : atual?.["nature"]) as string | null | undefined;
  const parentId = (("parent_id" in data ? data["parent_id"] : atual?.["parent_id"]) as string | null | undefined) ?? null;
  const mudouTipo = atual === null || ("nature" in data && data["nature"] !== atual["nature"]);
  const mudouPai = atual === null || ("parent_id" in data && (data["parent_id"] ?? null) !== (atual["parent_id"] ?? null));
  if (!tipo) return;
  if (parentId && (mudouTipo || mudouPai)) {
    // superior inexistente/excluído já foi recusado pela regra comum da árvore
    const r = await ctx.tx.query<{ nature: string }>("select nature from erp.financial_categories where id=$1 and organization_id=$2 and deleted_at is null", [parentId, ctx.orgId]);
    const doPai = r.rows[0]?.nature;
    if (doPai && doPai !== "both" && doPai !== tipo) throw campo("nature", MENSAGEM_TIPO_DIVERGE_DO_SUPERIOR);
  }
  if (id && atual !== null && mudouTipo && tipo !== "both") {
    const f = await ctx.tx.query("select 1 from erp.financial_categories where parent_id=$1 and organization_id=$2 and deleted_at is null and nature <> $3 limit 1", [id, ctx.orgId, tipo]);
    if (f.rowCount) throw campo("nature", MENSAGEM_TIPO_FILHAS_DIVERGEM);
  }
}
