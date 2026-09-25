/**
 * Regras do Grupo de Produtos em árvore (CADASTROS-ESTRUTURA). As regras COMUNS de árvore (superior
 * sintético, prefixo do código, ciclo, filhos, exclusão) estão em `arvore-cadastro.ts`; aqui fica só o que é
 * próprio do grupo e do produto. A API é a autoridade — a tela só sugere.
 *
 * - código OBRIGATÓRIO para criar e para editar: NULL só existe no acervo anterior à 0025, e editar um grupo
 *   do acervo exige dar o código a ele;
 * - nome único entre IRMÃOS vivos (o índice `uq_product_groups_nome_irmaos` da 0025 é a rede; aqui a recusa
 *   sai no campo, em 422, antes do 409 do banco);
 * - grupo analítico com produto vivo não vira sintético;
 * - produto só em grupo ANALÍTICO, ativo, não excluído, da organização. Inexistente, de outra organização
 *   e excluído recebem a MESMA recusa (não revela existência).
 */
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";

type Linha = Record<string, unknown>;
const campo = (path: string, message: string) => validation(message, [{ path: [path], message }]);

export const MENSAGEM_GRUPO_DO_PRODUTO = "Escolha um grupo de produtos analítico e ativo (Analítico: Sim).";
export const MENSAGEM_GRUPO_SEM_CODIGO = "Informe o código do grupo.";
export const MENSAGEM_GRUPO_COM_PRODUTOS = "Este grupo tem produtos: mova os produtos para um grupo analítico antes de marcar Analítico: Não.";
export const MENSAGEM_NOME_ENTRE_IRMAOS = "Já existe um grupo com este nome sob o mesmo grupo superior.";

/** `atual` = linha antes da edição (null na criação). `data` = corpo já validado pelo schema. */
export async function conferirGrupoDeProdutos(ctx: ServiceCtx, id: string | null, data: Linha, atual: Linha | null): Promise<void> {
  const codigo = "code" in data ? data["code"] : atual?.["code"];
  if (typeof codigo !== "string" || codigo.trim() === "") throw campo("code", MENSAGEM_GRUPO_SEM_CODIGO);

  const nome = ("name" in data ? data["name"] : atual?.["name"]) as string | null | undefined;
  const parentId = (("parent_id" in data ? data["parent_id"] : atual?.["parent_id"]) as string | null | undefined) ?? null;
  const mudouNomeOuPai = atual === null || ("name" in data && data["name"] !== atual["name"]) || ("parent_id" in data && (data["parent_id"] ?? null) !== (atual["parent_id"] ?? null));
  if (typeof nome === "string" && mudouNomeOuPai) {
    const r = await ctx.tx.query(
      `select 1 from erp.product_groups where organization_id=$1 and deleted_at is null and parent_id is not distinct from $2::uuid
          and lower(name) = lower($3) and ($4::uuid is null or id <> $4::uuid) limit 1`, [ctx.orgId, parentId, nome, id]);
    if (r.rowCount) throw campo("name", MENSAGEM_NOME_ENTRE_IRMAOS);
  }

  if (id && data["kind"] === "synthetic" && atual?.["kind"] !== "synthetic") {
    // trava o grupo ANTES de procurar produto (R1-5): conflita com o `for key share` da FK de um produto gravado
    // ao mesmo tempo e com o `for share` de `precisaRecusar` (`arvore-cadastro.ts`) — quem chega depois espera e
    // relê: a troca vê o produto novo, ou o produto vê o grupo já sintético
    await ctx.tx.query("select 1 from erp.product_groups where id=$1 and organization_id=$2 for update", [id, ctx.orgId]);
    const r = await ctx.tx.query("select 1 from erp.products where organization_id=$1 and group_id=$2 and deleted_at is null limit 1", [ctx.orgId, id]);
    if (r.rowCount) throw campo("kind", MENSAGEM_GRUPO_COM_PRODUTOS);
  }
}

/** Produto só em grupo analítico, ativo, vivo e da organização. Só confere quando o grupo é gravado. */
export async function conferirGrupoDoProduto(ctx: ServiceCtx, data: Linha, atual: Linha | null): Promise<void> {
  if (atual !== null && !("group_id" in data)) return;
  const grupo = data["group_id"];
  if (atual !== null && grupo === atual["group_id"]) return;
  if (typeof grupo !== "string") throw campo("group_id", MENSAGEM_GRUPO_DO_PRODUTO);
  const r = await ctx.tx.query(
    "select 1 from erp.product_groups where id=$1 and organization_id=$2 and deleted_at is null and is_active and kind='analytic'", [grupo, ctx.orgId]);
  if (!r.rowCount) throw campo("group_id", MENSAGEM_GRUPO_DO_PRODUTO);
}
