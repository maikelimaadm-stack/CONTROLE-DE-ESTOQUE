import { resolverLayout, type EstruturaLayout, type OrigemDoLayout } from "@agro/domain";
import type { ServiceCtx } from "./context.js";

/**
 * LAYOUT DO DOCUMENTO (VENDAS-A3-1). A escolha é a do domínio (`resolverLayout`): ligado à TOP (ativo, vivo) →
 * padrão ativo da família → LAYOUT DO SISTEMA. UM dono (R1): a Central (rota de vendas) e a linha da TOP (rota de
 * Configurações) leem daqui. Documento SEM TOP usa o do sistema (não o padrão da família: sem
 * TOP não há família escolhida, como na criação sem `tipo_operacao_id`). Recorte de organização em toda consulta.
 */
export async function layoutEfetivo(ctx: ServiceCtx, familia: string, tipoOperacaoId: string | null): Promise<{ estrutura: EstruturaLayout; origem: OrigemDoLayout; nome: string | null; id: string | null }> {
  type Linha = { id: string; nome: string; estrutura: EstruturaLayout };
  let ligado: Linha | undefined; let padrao: Linha | undefined;
  if (tipoOperacaoId) {
    ligado = (await ctx.tx.query<Linha>(
      `select l.id, l.nome, l.estrutura from erp.layout_documento_tops lt
         join erp.layouts_documento l on l.id = lt.layout_id and l.organization_id = lt.organization_id
        where lt.tipo_operacao_id = $1 and lt.organization_id = $2 and l.familia = $3 and l.is_active and l.deleted_at is null`,
      [tipoOperacaoId, ctx.orgId, familia])).rows[0];
    if (!ligado) padrao = (await ctx.tx.query<Linha>(
      `select id, nome, estrutura from erp.layouts_documento
        where organization_id = $1 and familia = $2 and padrao and is_active and deleted_at is null order by created_at limit 1`,
      [ctx.orgId, familia])).rows[0];
  }
  const r = resolverLayout(familia, { ligado: ligado?.estrutura ?? null, padraoDaFamilia: padrao?.estrutura ?? null });
  const linha = r.origem === "ligado" ? ligado : r.origem === "padrao_da_familia" ? padrao : undefined;
  return { ...r, nome: linha?.nome ?? null, id: linha?.id ?? null };
}
