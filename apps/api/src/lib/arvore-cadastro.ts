/**
 * Regras dos cadastros em ÁRVORE (`def.tree`): Plano de Contas, Naturezas, Centros de Resultado,
 * Grupos de Produtos e Endereçamentos (regras próprias do grupo em `grupo-de-produtos.ts`). O servidor é a autoridade — a tela só sugere.
 *
 * - o superior existe, é desta organização e não está excluído;
 * - o superior não é o próprio registro nem um descendente dele (sem ciclo);
 * - onde há `kind`, o superior é SINTÉTICO, e conta com filhos não vira analítica;
 * - onde há código hierárquico, o código obedece à máscara do cadastro e começa pelo código do superior;
 * - registro com filhos vivos não é excluído.
 *
 * As regras valem para gravações NOVAS. Um registro antigo fora da máscara continua legível e editável em
 * outros campos; só código ou superior alterados passam de novo pela conferência.
 */
import type { ResourceDef } from "@agro/domain";
import { ehCadastroCodigoHierarquico, mascaraDoCadastro, proximoCodigoHierarquico, validarCodigoHierarquico } from "@agro/domain";
import { ident } from "./sql.js";
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";

type Linha = Record<string, unknown>;
const campo = (path: string, message: string) => validation(message, [{ path: [path], message }]);
const temCampo = (def: ResourceDef, nome: string) => def.fields.some((f) => f.name === nome);
/** Rótulo da tela (o registry é a fonte): "Analítica" nas árvores financeiras, "Analítico" no grupo. */
const rotuloDoCampo = (def: ResourceDef, nome: string) => def.fields.find((f) => f.name === nome)?.label ?? nome;

async function mascara(ctx: ServiceCtx, def: ResourceDef): Promise<string> {
  const r = await ctx.tx.query<{ parameters: unknown }>("select parameters from erp.organizations where id=$1", [ctx.orgId]);
  return ehCadastroCodigoHierarquico(def.key) ? mascaraDoCadastro(r.rows[0]?.parameters, def.key) : "";
}

async function registroVivo(ctx: ServiceCtx, def: ResourceDef, id: string): Promise<Linha | null> {
  const cols = ["id", ...(temCampo(def, "code") ? ["code"] : []), ...(temCampo(def, "kind") ? ["kind"] : [])];
  const r = await ctx.tx.query(`select ${cols.map(ident).join(",")} from erp.${ident(def.table)} where id=$1 and organization_id=$2 ${def.softDelete ? "and deleted_at is null" : ""}`, [id, ctx.orgId]);
  return (r.rows[0] as Linha | undefined) ?? null;
}

async function temFilhosVivos(ctx: ServiceCtx, def: ResourceDef, id: string): Promise<boolean> {
  const r = await ctx.tx.query(`select 1 from erp.${ident(def.table)} where parent_id=$1 and organization_id=$2 ${def.softDelete ? "and deleted_at is null" : ""} limit 1`, [id, ctx.orgId]);
  return Boolean(r.rowCount);
}

/** `atual` = linha antes da edição (null na criação). `data` = corpo já validado pelo schema. */
export async function conferirRegrasDaArvore(ctx: ServiceCtx, def: ResourceDef, id: string | null, data: Linha, atual: Linha | null): Promise<void> {
  if (!def.tree) return;
  const mudouPai = "parent_id" in data && (data["parent_id"] ?? null) !== (atual?.["parent_id"] ?? null);
  const parentId = ("parent_id" in data ? data["parent_id"] : atual?.["parent_id"]) as string | null | undefined ?? null;
  let pai: Linha | null = null;
  if (parentId) {
    pai = await registroVivo(ctx, def, parentId);
    if (!pai) throw campo("parent_id", "Superior não encontrado.");
    if (id && mudouPai) {
      if (parentId === id) throw campo("parent_id", "O superior não pode ser o próprio registro nem um descendente dele.");
      const ciclo = await ctx.tx.query(
        `with recursive desc_ as (select id from erp.${ident(def.table)} where parent_id=$1 and organization_id=$2
           union select t.id from erp.${ident(def.table)} t join desc_ d on t.parent_id=d.id where t.organization_id=$2)
         select 1 from desc_ where id=$3 limit 1`, [id, ctx.orgId, parentId]);
      if (ciclo.rowCount) throw campo("parent_id", "O superior não pode ser o próprio registro nem um descendente dele.");
    }
    if (temCampo(def, "kind") && (atual === null || mudouPai) && pai["kind"] !== "synthetic") throw campo("parent_id", `O superior precisa ser sintético. Marque ${rotuloDoCampo(def, "kind")}: Não nele antes de incluir filhos.`);
  }
  if (id && temCampo(def, "kind") && data["kind"] === "analytic" && atual?.["kind"] !== "analytic" && await temFilhosVivos(ctx, def, id)) {
    throw campo("kind", `Registro com filhos não pode ser analítico (${rotuloDoCampo(def, "kind")}: Sim). Mova ou exclua os filhos antes.`);
  }
  if (ehCadastroCodigoHierarquico(def.key) && typeof (data["code"] ?? atual?.["code"]) === "string") {
    const codigo = String(data["code"] ?? atual?.["code"]);
    const mudouCodigo = "code" in data && data["code"] !== atual?.["code"];
    if (atual === null || mudouCodigo || mudouPai) {
      // superior do acervo sem código (Grupos de Produtos anteriores à 0025): não há prefixo para conferir
      if (pai && typeof pai["code"] !== "string") throw campo("parent_id", "O superior não tem código. Informe o código dele antes de incluir filhos.");
      const erro = validarCodigoHierarquico(codigo, await mascara(ctx, def), pai ? String(pai["code"]) : null);
      if (erro) throw campo("code", erro);
    }
  }
}

/** Exclusão lógica deixaria filhos pendurados num superior invisível. */
export async function conferirExclusaoNaArvore(ctx: ServiceCtx, def: ResourceDef, id: string): Promise<void> {
  if (def.tree && await temFilhosVivos(ctx, def, id)) throw validation("Este registro tem filhos. Exclua ou mova os filhos antes.");
}

/**
 * Próximo código sugerido abaixo do superior. Conta também os EXCLUÍDOS: a unicidade `(organization_id,
 * code)` do banco os inclui, e sugerir o código de um excluído seria sugerir um 409.
 */
export async function sugerirCodigo(ctx: ServiceCtx, def: ResourceDef, parentId: string | null): Promise<{ codigo: string; mascara: string }> {
  if (!ehCadastroCodigoHierarquico(def.key)) throw validation("Este cadastro não tem código hierárquico.");
  const m = await mascara(ctx, def);
  let codigoPai: string | null = null;
  if (parentId) {
    const pai = await registroVivo(ctx, def, parentId);
    if (!pai) throw campo("parent_id", "Superior não encontrado.");
    if (typeof pai["code"] !== "string") throw campo("parent_id", "O superior não tem código. Informe o código dele antes de incluir filhos.");
    codigoPai = String(pai["code"]);
  }
  const prefixo = codigoPai === null ? "" : `${codigoPai}.`;
  const r = await ctx.tx.query<{ code: string }>(`select code from erp.${ident(def.table)} where organization_id=$1 and code like $2`, [ctx.orgId, `${prefixo.replace(/[\\%_]/g, "\\$&")}%`]);
  const p = proximoCodigoHierarquico(codigoPai, r.rows.map((x) => x.code), m);
  if ("erro" in p) throw campo("code", p.erro);
  return { codigo: p.codigo, mascara: m };
}
