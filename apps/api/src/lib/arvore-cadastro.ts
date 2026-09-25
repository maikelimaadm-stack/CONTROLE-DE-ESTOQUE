/**
 * Regras dos cadastros em ÁRVORE (`def.tree`): Plano de Contas, Naturezas, Centros de Resultado,
 * Grupos de Produtos e Endereçamentos (regras próprias do grupo em `grupo-de-produtos.ts`). O servidor é a autoridade — a tela só sugere.
 *
 * - o superior existe, é desta organização e não está excluído;
 * - o superior não é o próprio registro nem um descendente dele (sem ciclo);
 * - onde há `kind`, o superior é SINTÉTICO, e conta com filhos não vira analítica;
 * - onde há código hierárquico, o código obedece à máscara do cadastro e começa pelo código do superior;
 * - registro com filhos vivos não é excluído, não muda de superior e não muda de código (R1-5): os códigos dos
 *   filhos carregam o prefixo do pai, e reescrever uma subárvore é migração de dado, não edição;
 * - analítico EM USO não vira sintético (`analitico-em-uso.ts`).
 *
 * CONCORRÊNCIA: as regras acima leem o superior e os filhos; sem trava, duas gravações que se cruzam (renumerar
 * ou mover o superior × incluir um filho nele; excluir × incluir filho; marcar analítico × incluir filho)
 * passam cada uma pela sua conferência e as duas commitam — o filho fica com o prefixo antigo, pendurado num
 * excluído ou sob um analítico. Por isso as duas pontas travam a MESMA linha, a do superior:
 *   · quem muda o registro (superior, código, analítico) ou o exclui trava ELE `for update` ANTES de procurar
 *     filhos (`travarRegistro`);
 *   · quem inclui filho, ou move/renumera para baixo de um superior, lê o superior `for key share`
 *     (`registroVivo(..., true)`), que conflita com o `for update` acima e com nada mais: renomear o superior
 *     ou lançar nele não espera.
 * Quem chega depois espera o commit do outro e RELÊ (READ COMMITTED): vê o filho novo, ou o código/situação
 * novos do superior, e recusa. Dois movimentos cruzados (A para baixo de B e B para baixo de A ao mesmo tempo)
 * se travam em ordem inversa: o banco derruba um deles (40P01 → 409 CONCURRENCY_CONFLICT) e o ciclo não nasce.
 *
 * As regras valem para gravações NOVAS. Um registro antigo fora da máscara continua legível e editável em
 * outros campos; só código ou superior alterados passam de novo pela conferência.
 */
import type { FieldDef, ResourceDef } from "@agro/domain";
import { getResource } from "@agro/domain";
import { ehCadastroCodigoHierarquico, mascaraDoCadastro, proximoCodigoHierarquico, validarCodigoHierarquico } from "@agro/domain";
import { ident } from "./sql.js";
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";
import { conferirAnaliticoEmUso } from "./analitico-em-uso.js";
import { detalheDoErro } from "./ficha-em-abas.js";

type Linha = Record<string, unknown>;
const campo = (path: string, message: string) => validation(message, [{ path: [path], message }]);
const temCampo = (def: ResourceDef, nome: string) => def.fields.some((f) => f.name === nome);
/** Rótulo da tela (o registry é a fonte): "Analítica" nas árvores financeiras, "Analítico" no grupo. */
const rotuloDoCampo = (def: ResourceDef, nome: string) => def.fields.find((f) => f.name === nome)?.label ?? nome;

export const MENSAGEM_REGISTRO_COM_FILHOS = "Registro com filhos: mova ou renumere os filhos antes.";

async function mascara(ctx: ServiceCtx, def: ResourceDef): Promise<string> {
  const r = await ctx.tx.query<{ parameters: unknown }>("select parameters from erp.organizations where id=$1", [ctx.orgId]);
  return ehCadastroCodigoHierarquico(def.key) ? mascaraDoCadastro(r.rows[0]?.parameters, def.key) : "";
}

/** `travar`: o superior vai ser conferido para receber (ou manter sob novo código) um filho — `for key share`. */
async function registroVivo(ctx: ServiceCtx, def: ResourceDef, id: string, travar = false): Promise<Linha | null> {
  const cols = ["id", ...(temCampo(def, "code") ? ["code"] : []), ...(temCampo(def, "kind") ? ["kind"] : [])];
  const r = await ctx.tx.query(`select ${cols.map(ident).join(",")} from erp.${ident(def.table)} where id=$1 and organization_id=$2 ${def.softDelete ? "and deleted_at is null" : ""}${travar ? " for key share" : ""}`, [id, ctx.orgId]);
  return (r.rows[0] as Linha | undefined) ?? null;
}

/** O registro vai mudar de superior, de código, virar analítico ou ser excluído: trava antes de procurar filhos. */
async function travarRegistro(ctx: ServiceCtx, def: ResourceDef, id: string): Promise<void> {
  await ctx.tx.query(`select 1 from erp.${ident(def.table)} where id=$1 and organization_id=$2 for update`, [id, ctx.orgId]);
}

async function temFilhosVivos(ctx: ServiceCtx, def: ResourceDef, id: string): Promise<boolean> {
  const r = await ctx.tx.query(`select 1 from erp.${ident(def.table)} where parent_id=$1 and organization_id=$2 ${def.softDelete ? "and deleted_at is null" : ""} limit 1`, [id, ctx.orgId]);
  return Boolean(r.rowCount);
}

/** `atual` = linha antes da edição (null na criação). `data` = corpo já validado pelo schema. */
export async function conferirRegrasDaArvore(ctx: ServiceCtx, def: ResourceDef, id: string | null, data: Linha, atual: Linha | null): Promise<void> {
  if (!def.tree) return;
  const mudouPai = "parent_id" in data && (data["parent_id"] ?? null) !== (atual?.["parent_id"] ?? null);
  const mudouCodigo = "code" in data && data["code"] !== atual?.["code"];
  const viraAnalitico = temCampo(def, "kind") && data["kind"] === "analytic" && atual?.["kind"] !== "analytic";
  // CONCORRÊNCIA (cabeçalho): primeiro o próprio registro, depois o superior
  if (id && (mudouPai || mudouCodigo || viraAnalitico)) await travarRegistro(ctx, def, id);
  const parentId = ("parent_id" in data ? data["parent_id"] : atual?.["parent_id"]) as string | null | undefined ?? null;
  let pai: Linha | null = null;
  if (parentId) {
    pai = await registroVivo(ctx, def, parentId, atual === null || mudouPai || mudouCodigo);
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
  // SUBÁRVORE: com filho vivo, nem superior nem código mudam — vale para TODO cadastro em árvore (o ciclo acima
  // fala primeiro, com a mensagem própria). Mover um galho é mover (ou renumerar) as folhas antes.
  if (id && (mudouPai || mudouCodigo) && await temFilhosVivos(ctx, def, id)) throw campo(mudouPai ? "parent_id" : "code", MENSAGEM_REGISTRO_COM_FILHOS);
  if (id && viraAnalitico && await temFilhosVivos(ctx, def, id)) {
    throw campo("kind", `Registro com filhos não pode ser analítico (${rotuloDoCampo(def, "kind")}: Sim). Mova ou exclua os filhos antes.`);
  }
  if (id && atual && temCampo(def, "kind")) await conferirAnaliticoEmUso(ctx, def, id, data, atual);
  if (ehCadastroCodigoHierarquico(def.key) && typeof (data["code"] ?? atual?.["code"]) === "string") {
    const codigo = String(data["code"] ?? atual?.["code"]);
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
  if (!def.tree) return;
  await travarRegistro(ctx, def, id);
  if (await temFilhosVivos(ctx, def, id)) throw validation("Este registro tem filhos. Exclua ou mova os filhos antes.");
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

/**
 * Referência marcada `exigeAnalitico` no registry (produto → grupo, natureza de custo, centro padrão; perfil de
 * RH → centro de resultado): o valor GRAVADO ou TROCADO precisa ser analítico. Vale para os campos do principal
 * e dos PERFIS da ficha em abas (detalhe em grade não declara `exigeAnalitico` — o teste da whitelist confere).
 * Valor que não mudou não é reconferido (dado antigo continua editável). Inexistente/outra organização/excluído:
 * a mesma recusa — não se revela a diferença.
 *
 * A leitura é `for share`, como a do rateio: a troca analítico → sintético trava a linha `for update` ANTES de
 * procurar uso (`analitico-em-uso.ts` para natureza/centro/conta; `grupo-de-produtos.ts` para o grupo), e as
 * duas gravações se esperam. Quem chega depois relê — a referência nova vê o cadastro já sintético e é
 * recusada; a troca vê a referência já gravada e é recusada. Sem esta trava, a FK só segura `for key share`,
 * que não conflita com a atualização de `kind`, e a referência a um sintético commitava.
 */
export async function conferirReferenciasAnaliticas(ctx: ServiceCtx, def: ResourceDef, data: Linha, atual: Linha | null): Promise<void> {
  const recusa = (f: FieldDef) => `${f.label}: escolha um registro analítico. Sintético agrupa e não recebe lançamento.`;
  for (const f of def.fields) {
    if (!(f.name in data) || !(await precisaRecusar(ctx, f, data[f.name], atual?.[f.name], atual !== null))) continue;
    throw campo(f.name, recusa(f));
  }
  for (const p of def.perfis ?? []) {
    const corpo = data[p.key] as Linha | undefined; if (!corpo) continue;
    const doPerfil = (atual?.[p.key] as Linha | null | undefined) ?? null;
    for (const f of p.fields) {
      if (!(f.name in corpo) || !(await precisaRecusar(ctx, f, corpo[f.name], doPerfil?.[f.name], doPerfil !== null))) continue;
      throw validation(recusa(f), [detalheDoErro(def, [p.key, f.name], recusa(f))]);
    }
  }
}

async function precisaRecusar(ctx: ServiceCtx, f: FieldDef, v: unknown, anterior: unknown, temAnterior: boolean): Promise<boolean> {
  if (f.type !== "ref" || !f.ref?.exigeAnalitico) return false;
  if (v === null || v === undefined || v === "" || (temAnterior && v === anterior)) return false;
  const alvo = getResource(f.ref.resource);
  if (!alvo?.tree) return false;
  const r = await ctx.tx.query(`select 1 from erp.${ident(alvo.table)} where id=$1 and organization_id=$2 and kind='analytic'${alvo.softDelete ? " and deleted_at is null" : ""} for share`, [String(v), ctx.orgId]);
  return !r.rowCount;
}
