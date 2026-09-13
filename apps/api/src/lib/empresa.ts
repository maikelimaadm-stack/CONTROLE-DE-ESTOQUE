/**
 * PONTE ENTRE O CONTRATO DE EMPRESA E A INFRAESTRUTURA ATUAL (docs/MULTI-COMPANY-CONTRACT.md).
 *
 * O contrato vive em `@erp/plataforma` (puro, sem banco, neutro de nicho). Aqui ele encosta no banco, onde a
 * Empresa ainda é materializada pela infraestrutura herdada do primeiro segmento atendido (`erp.farms`,
 * coluna `farm_id`, cabeçalho `X-Farm-Id`). Só a NOMENCLATURA é legada: a AUTORIDADE, desde PRE-BASE2-02, é
 * o escopo por módulo (`erp.membro_escopos_empresa` / `erp.membro_empresas`) — nunca mais `erp.member_farms`.
 *
 * A tradução da convenção antiga ("lista vazia = todas") sobrevive apenas na BORDA ADMINISTRATIVA, para
 * clientes que ainda enviam `farm_ids` (apps/api/src/routes/admin.ts). Nenhuma regra de runtime a usa.
 */
import { selecionarEmpresaDoLancamento, type IdEmpresa, type SelecaoEmpresa } from "@erp/plataforma";
import { empresaScopeSql, moduloAtivo, type ServiceCtx } from "./context.js";

/** Empresa selecionada no contexto de trabalho (X-Farm-Id). Seleção, nunca autorização. */
export const empresaSelecionada = (ctx: ServiceCtx): IdEmpresa | null => ctx.farmId;

/**
 * EMPRESAS DISPONÍVEIS PARA O MEMBRO NAQUELE MÓDULO — fonte server-side.
 *
 * Interseção resolvida no banco: empresas da organização atual × não excluídas (e ativas, quando a operação
 * exige) × escopo do membro NAQUELE MÓDULO. É a lista que a regra pura de seleção exige — limitada às
 * empresas da organização e usada em fluxos de escrita/seleção. O recorte de LEITURA não passa por aqui:
 * é SQL puro (`empresaScope`), sem materializar lista alguma.
 *
 * `somenteAtivas` (padrão) é a política de LANÇAMENTO: não se lança em empresa inativa. Consulta histórica
 * pode pedir `{ somenteAtivas: false }`; empresa excluída, nunca.
 */
export async function empresasDisponiveis(ctx: ServiceCtx, opts: { somenteAtivas?: boolean; modulo?: string | null } = {}): Promise<IdEmpresa[]> {
  const ativas = opts.somenteAtivas !== false;
  const params: unknown[] = [ctx.orgId];
  const escopo = empresaScopeSql(ctx, "f.id", params, {
    ignoreSelected: true,
    modulo: opts.modulo !== undefined ? opts.modulo : moduloAtivo(ctx)
  });
  const r = await ctx.tx.query<{ id: string }>(
    `select f.id from erp.farms f where f.organization_id=$1 and f.deleted_at is null${ativas ? " and f.is_active" : ""}${escopo} order by f.code`,
    params);
  return r.rows.map((f) => f.id);
}

/**
 * Seleção da empresa de um LANÇAMENTO, já cruzada com a lista server-side do módulo ativo.
 *
 * A empresa pedida pelo cliente é PEDIDO, nunca autorização: só passa se estiver entre as empresas
 * disponíveis do membro NAQUELE MÓDULO — tê-la autorizada em outro módulo não vale.
 */
export async function selecionarEmpresaParaLancamento(
  ctx: ServiceCtx,
  pedida?: IdEmpresa | null,
  opts: { somenteAtivas?: boolean; modulo?: string | null } = {}
): Promise<SelecaoEmpresa> {
  const disponiveis = await empresasDisponiveis(ctx, opts);
  // a autorização já foi aplicada ao montar `disponiveis`; a regra pura decide entre
  // escolhida / automática / obrigatória / indisponível / recusada
  return selecionarEmpresaDoLancamento({ modo: "selecionadas", empresaIds: disponiveis }, { disponiveis, pedida: pedida ?? null });
}

/**
 * Empresas que o membro enxerga em ALGUM módulo — o seletor de contexto de trabalho (X-Farm-Id).
 *
 * É a UNIÃO dos escopos, não a autorização de nenhuma tela: poder selecionar a empresa não dá acesso a
 * módulo algum nela. Cada porta continua exigindo o escopo do SEU módulo.
 */
export async function empresasVisiveisNaOrganizacao(ctx: ServiceCtx): Promise<{ id: string; code: number; name: string }[]> {
  const base = "select f.id, f.code, f.name from erp.farms f where f.organization_id=$1 and f.deleted_at is null and f.is_active";
  if (ctx.membership.isOwner) {
    return (await ctx.tx.query<{ id: string; code: number; name: string }>(`${base} order by f.code`, [ctx.orgId])).rows;
  }
  const r = await ctx.tx.query<{ id: string; code: number; name: string }>(
    `${base} and exists (
       select 1 from erp.membro_escopos_empresa e
       where e.organization_id=$1 and e.membro_id=$2
         and (e.modo='todas' or exists (
           select 1 from erp.membro_empresas me
           where me.organization_id=$1 and me.membro_id=$2 and me.modulo=e.modulo and me.empresa_id=f.id))
     ) order by f.code`, [ctx.orgId, ctx.membership.memberId]);
  return r.rows;
}
