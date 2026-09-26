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

/* ─────────────── VENDAS-A3-1b: conferência do padrão de CADASTRO (implementação: agente A1) ─────────────── */
/** Registro padrão que vale AGORA nesta organização: id, o mesmo rótulo que o RefSelect mostra e, no armazém, a empresa. */
export interface RegistroPadraoConferido { id: string; rotulo: string; empresaId?: string | null }
/**
 * Confere TODOS os padrões `registro` da estrutura nesta organização (padroesRegistroDaEstrutura do domínio): mapa
 * ESTÁTICO recurso → SQL (whitelist), o mesmo recorte de organização do cadastro (payment_methods: organização OU
 * compartilhado), ativo e vivo, e o filtro do catálogo. UMA consulta por recurso presente (`= any($ids)`), sem N+1.
 * `validos`: chavePadraoDeCadastro → registro; `invalidos`: os que não valem (inexistente, outra organização, inativo,
 * excluído, fora do filtro, campo sem `referencia`), com o caminho do valorPadrao e o rótulo do campo.
 */
export async function conferirPadroesRegistro(_ctx: ServiceCtx, _familia: string, _estrutura: EstruturaLayout): Promise<{
  validos: Map<string, RegistroPadraoConferido>;
  invalidos: { chave: string; caminho: string; rotulo: string }[];
}> {
  throw new Error("conferirPadroesRegistro: ainda não implementado (agente A1)");
}
