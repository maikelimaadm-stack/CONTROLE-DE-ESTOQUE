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
import { ehCadastroCodigoHierarquico, larguraDosNiveis, mascaraDoCadastro, nivelDoCodigo, proximoCodigoHierarquico, validarCodigoHierarquico, MASCARA_CODIGO_PADRAO } from "@agro/domain";
import { ident } from "./sql.js";
import { err, notFound, validation } from "./errors.js";
import { audit } from "./service.js";
import { MENSAGEM_TIPO_DIVERGE_DO_SUPERIOR } from "./natureza-financeira.js";
import { MENSAGEM_NOME_ENTRE_IRMAOS } from "./grupo-de-produtos.js";
import type { ServiceCtx } from "./context.js";
import { conferirAnaliticoEmUso } from "./analitico-em-uso.js";
import { detalheDoErro } from "./ficha-em-abas.js";

type Linha = Record<string, unknown>;
const campo = (path: string, message: string) => validation(message, [{ path: [path], message }]);
const temCampo = (def: ResourceDef, nome: string) => def.fields.some((f) => f.name === nome);
/** Rótulo da tela (o registry é a fonte): "Analítica" nas árvores financeiras, "Analítico" no grupo. */
const rotuloDoCampo = (def: ResourceDef, nome: string) => def.fields.find((f) => f.name === nome)?.label ?? nome;

export const MENSAGEM_REGISTRO_COM_FILHOS = "Registro com filhos: mova ou renumere os filhos antes.";
/** Código travado (decisão 257 D-1/D-2): o código é gerado no servidor e nunca é digitado nem trocado. */
export const MENSAGEM_CODIGO_GERADO = "O código é gerado pelo sistema.";
/** Árvore com código: trocar o superior é a operação Mover (renumera o galho), nunca a edição comum. */
export const MENSAGEM_USE_MOVER = "Use Mover.";
/**
 * Superior do acervo sem código: o código não se digita (D-1) — ele o ganha ao ser SALVO (A-7) ou movido. Antes dizia
 * "Informe o código dele", o que a tela com o código travado não deixa fazer.
 */
export const MENSAGEM_SUPERIOR_SEM_CODIGO = "O superior não tem código. Salve o superior antes (ele recebe o código gerado) e depois inclua os filhos.";

/**
 * TRAVA DA NUMERAÇÃO de um cadastro numa organização (decisão 257 D): toda gravação que ESCOLHE um código
 * (Novo de árvore, Novo sequencial, Mover, Zerar numeração, troca de máscara) passa por aqui antes de ler os
 * códigos existentes. Dois "Novo filho" simultâneos no mesmo superior liam o mesmo maior código e o segundo
 * morria no `unique (organization_id, code)` com 409; com a trava, o segundo espera o commit do primeiro,
 * relê e recebe o código seguinte. Trava de transação (`xact`): solta sozinha no commit ou no rollback. A chave
 * é a TABELA (Parceiro e Funcionário são a mesma) e a organização — organizações diferentes não se esperam.
 */
export async function travarNumeracao(ctx: ServiceCtx, def: ResourceDef): Promise<void> {
  await ctx.tx.query("select pg_advisory_xact_lock(hashtext('codigo-cadastro:' || $1 || ':' || $2))", [def.table, ctx.orgId]);
}

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

/** UUID na forma canônica (minúsculas): o schema aceita maiúsculas, o Postgres guarda e devolve minúsculas. */
const canonico = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v.toLowerCase() : null);

/**
 * `atual` = linha antes da edição (null na criação). `data` = corpo já validado pelo schema.
 * `codigoGerado`: o código em `data` acabou de ser GERADO pelo servidor para um registro do acervo sem código
 * (`gerarCodigoNaEdicao`, AJUSTES 01 R1 A-7) — não é troca de código pedida pelo cliente.
 */
export async function conferirRegrasDaArvore(ctx: ServiceCtx, def: ResourceDef, id: string | null, data: Linha, atual: Linha | null, opcoes: { codigoGerado?: boolean } = {}): Promise<void> {
  if (!def.tree) return;
  // UUID é o mesmo em qualquer caixa (A-9): o superior do corpo passa à forma canônica ANTES de qualquer comparação
  // — senão o superior atual, reenviado em maiúsculas, parecia "outro" (e o próprio registro passava por outro nó)
  if (typeof data["parent_id"] === "string") data["parent_id"] = data["parent_id"].toLowerCase();
  const idCanonico = canonico(id);
  const mudouPai = "parent_id" in data && (data["parent_id"] ?? null) !== canonico(atual?.["parent_id"]);
  const mudouCodigo = "code" in data && data["code"] !== atual?.["code"];
  const codigoGerado = opcoes.codigoGerado === true;
  const viraAnalitico = temCampo(def, "kind") && data["kind"] === "analytic" && atual?.["kind"] !== "analytic";
  // CÓDIGO TRAVADO (decisão 257 D-1): na edição comum de uma árvore com código, nem o código nem o superior
  // mudam — o código nasce no servidor e trocar de superior é Mover, que renumera o galho inteiro junto. O
  // SUPERIOR fala primeiro (A-5): a web anterior manda `{ parent_id, code }` juntos e precisa ouvir "Use Mover.".
  if (id && def.codigoAutomatico === "hierarquico") {
    if (mudouPai) throw campo("parent_id", MENSAGEM_USE_MOVER);
    if (mudouCodigo && !codigoGerado) throw campo("code", MENSAGEM_CODIGO_GERADO);
  }
  // CONCORRÊNCIA (cabeçalho): primeiro o próprio registro, depois o superior
  if (id && (mudouPai || mudouCodigo || viraAnalitico)) await travarRegistro(ctx, def, id);
  const parentId = ("parent_id" in data ? canonico(data["parent_id"]) : canonico(atual?.["parent_id"]));
  let pai: Linha | null = null;
  if (parentId) {
    pai = await registroVivo(ctx, def, parentId, atual === null || mudouPai || mudouCodigo);
    if (!pai) throw campo("parent_id", "Superior não encontrado.");
    if (id && mudouPai) {
      if (parentId === idCanonico) throw campo("parent_id", "O superior não pode ser o próprio registro nem um descendente dele.");
      // o PRÓPRIO nó está na semente (A-9): ele E os descendentes — a comparação entre `uuid` é do banco, sem caixa
      const ciclo = await ctx.tx.query(
        `with recursive desc_ as (select id from erp.${ident(def.table)} where id=$1 and organization_id=$2
           union select t.id from erp.${ident(def.table)} t join desc_ d on t.parent_id=d.id where t.organization_id=$2)
         select 1 from desc_ where id=$3 limit 1`, [id, ctx.orgId, parentId]);
      if (ciclo.rowCount) throw campo("parent_id", "O superior não pode ser o próprio registro nem um descendente dele.");
    }
    if (temCampo(def, "kind") && (atual === null || mudouPai) && pai["kind"] !== "synthetic") throw campo("parent_id", `O superior precisa ser sintético. Marque ${rotuloDoCampo(def, "kind")}: Não nele antes de incluir filhos.`);
  }
  // SUBÁRVORE: com filho vivo, nem superior nem código mudam — vale para TODO cadastro em árvore (o ciclo acima
  // fala primeiro, com a mensagem própria). Mover um galho é mover (ou renumerar) as folhas antes. O código GERADO
  // para um registro do acervo sem código não reescreve nada: sem código, os filhos não carregam prefixo dele.
  const trocaCodigo = mudouCodigo && !codigoGerado;
  if (id && (mudouPai || trocaCodigo) && await temFilhosVivos(ctx, def, id)) throw campo(mudouPai ? "parent_id" : "code", MENSAGEM_REGISTRO_COM_FILHOS);
  if (id && viraAnalitico && await temFilhosVivos(ctx, def, id)) {
    throw campo("kind", `Registro com filhos não pode ser analítico (${rotuloDoCampo(def, "kind")}: Sim). Mova ou exclua os filhos antes.`);
  }
  if (id && atual && temCampo(def, "kind")) await conferirAnaliticoEmUso(ctx, def, id, data, atual);
  if (ehCadastroCodigoHierarquico(def.key) && typeof (data["code"] ?? atual?.["code"]) === "string") {
    const codigo = String(data["code"] ?? atual?.["code"]);
    if (atual === null || mudouCodigo || mudouPai) {
      // superior do acervo sem código (Grupos de Produtos anteriores à 0025): não há prefixo para conferir
      if (pai && typeof pai["code"] !== "string") throw campo("parent_id", MENSAGEM_SUPERIOR_SEM_CODIGO);
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
 * code)` do banco os inclui, e sugerir o código de um excluído seria sugerir um 409. (Zerar a numeração
 * libera o código de um excluído trocando-o por `EXC-<id>` — decisão 257 D-3.)
 */
export async function sugerirCodigo(ctx: ServiceCtx, def: ResourceDef, parentId: string | null): Promise<{ codigo: string; mascara: string }> {
  if (!ehCadastroCodigoHierarquico(def.key)) throw validation("Este cadastro não tem código hierárquico.");
  const m = await mascara(ctx, def);
  let codigoPai: string | null = null;
  if (parentId) {
    const pai = await registroVivo(ctx, def, parentId);
    if (!pai) throw campo("parent_id", "Superior não encontrado.");
    if (typeof pai["code"] !== "string") throw campo("parent_id", MENSAGEM_SUPERIOR_SEM_CODIGO);
    codigoPai = String(pai["code"]);
  }
  const p = await proximoAbaixo(ctx, def, codigoPai, m);
  if ("erro" in p) throw campo("code", p.erro);
  return { codigo: p.codigo, mascara: m };
}

async function proximoAbaixo(ctx: ServiceCtx, def: ResourceDef, codigoPai: string | null, m: string): Promise<{ codigo: string } | { erro: string }> {
  const prefixo = codigoPai === null ? "" : `${codigoPai}.`;
  const r = await ctx.tx.query<{ code: string }>(`select code from erp.${ident(def.table)} where organization_id=$1 and code like $2`, [ctx.orgId, `${prefixo.replace(/[\\%_]/g, "\\$&")}%`]);
  return proximoCodigoHierarquico(codigoPai, r.rows.map((x) => x.code), m);
}

/**
 * NOVO NUMA ÁRVORE COM CÓDIGO (decisão 257 D-1): o código é gerado AQUI, sob a trava da numeração, pela
 * mesma regra da sugestão (superior + máscara; sem superior, o próximo da raiz). Corpo sem código → gera;
 * código IGUAL ao gerado → aceito (é a web anterior mandando o que o servidor sugeriu); diferente → 422.
 * IMPORTAÇÃO (`importacao`): continua gravando o código da planilha com as regras de hoje (obrigatório,
 * máscara e prefixo do superior conferidos em `conferirRegrasDaArvore`), só que também sob a trava.
 */
export async function gerarCodigoNaCriacao(ctx: ServiceCtx, def: ResourceDef, data: Linha, importacao: boolean): Promise<void> {
  if (def.codigoAutomatico !== "hierarquico") return;
  await travarNumeracao(ctx, def);
  const pedido = typeof data["code"] === "string" && data["code"] !== "" ? data["code"] : null;
  if (importacao) { if (pedido === null) throw campo("code", "Obrigatório."); return; }
  const { codigo } = await sugerirCodigo(ctx, def, (data["parent_id"] as string | null | undefined) ?? null);
  if (pedido !== null && pedido !== codigo) throw campo("code", MENSAGEM_CODIGO_GERADO);
  data["code"] = codigo;
}

/**
 * REGISTRO DO ACERVO SEM CÓDIGO (AJUSTES 01 R1, A-7 — ex.: Grupos de Produtos anteriores à 0025): numa árvore com
 * código travado, o código não se digita; então a EDIÇÃO dá a ele o código gerado (a mesma regra do Novo: debaixo
 * do superior ATUAL, ou o próximo da raiz), sob a trava da numeração, em vez de recusar a gravação para sempre.
 * `code` no corpo igual ao gerado é aceito (web anterior); diferente → 422. Superior mudando: não gera — quem
 * fala é "Use Mover." (`conferirRegrasDaArvore`). Devolve se gerou.
 */
export async function gerarCodigoNaEdicao(ctx: ServiceCtx, def: ResourceDef, data: Linha, atual: Linha): Promise<boolean> {
  if (def.codigoAutomatico !== "hierarquico" || (typeof atual["code"] === "string" && atual["code"] !== "")) return false;
  const superior = canonico(atual["parent_id"]);
  if ("parent_id" in data && canonico(data["parent_id"]) !== superior) return false;
  await travarNumeracao(ctx, def);
  const pedido = typeof data["code"] === "string" && data["code"] !== "" ? data["code"] : null;
  const { codigo } = await sugerirCodigo(ctx, def, superior);
  if (pedido !== null && pedido !== codigo) throw campo("code", MENSAGEM_CODIGO_GERADO);
  data["code"] = codigo;
  return true;
}

/** Uma troca de código do Mover. */
export interface CodigoMovido { id: string; antes: string | null; depois: string }
export interface PlanoDoMover { id: string; de: string | null; para: string | null; codigos: CodigoMovido[] }

const campoSuperior = (message: string) => validation(message, [{ path: ["superior"], message }]);
/**
 * Tabelas em que o código é único só entre VIVOS (índice parcial `where deleted_at is null`): Grupos de Produtos
 * (`uq_product_groups_code_vivo`, 0025). Nas outras árvores o único `(organization_id, code)` inclui os excluídos.
 */
const CODIGO_UNICO_SO_ENTRE_VIVOS: ReadonlySet<string> = new Set(["product_groups"]);

/**
 * MOVER COM RENUMERAÇÃO (decisão 257 D-5) — o plano, sem gravar nada. A prévia e o POST usam ESTA função: o
 * que a prévia mostra é exatamente o que o POST grava (na mesma situação do banco).
 *
 * Destino: SINTÉTICO (onde há `kind`), ATIVO, vivo, da organização — ou a RAIZ (`superior` null). Nunca o
 * próprio registro nem um descendente. O movido recebe o próximo código livre DEBAIXO do destino (a regra do
 * Novo filho; na raiz, o próximo da raiz) e cada descendente — excluídos inclusive, eles seguram código —
 * troca SÓ o prefixo: 1.03 → 2.05, 1.03.001 → 2.05.001 (o excluído que não pode acompanhar libera o código
 * como `EXC-<id>`, igual ao Zerar, em vez de travar o Mover). Se o galho muda de NÍVEL, cada segmento abaixo do
 * movido mantém o número e ganha a largura do nível novo da máscara (1.03.001 → 3.01 ao subir para a raiz,
 * na máscara 9.99.999.9999); número que não cabe na largura, ou galho mais fundo que a máscara, é recusado.
 */
export async function planejarMover(ctx: ServiceCtx, def: ResourceDef, idBruto: string, superiorBruto: string | null, travar = false): Promise<PlanoDoMover> {
  if (def.codigoAutomatico !== "hierarquico") throw validation("Este cadastro não tem código hierárquico.");
  // UUID é o mesmo em qualquer caixa (o schema aceita maiúsculas): as comparações abaixo usam a forma canônica,
  // senão o PRÓPRIO registro, escrito em outra caixa, passaria por "outro" superior e viraria pai de si mesmo.
  const id = idBruto.toLowerCase(); const superior = superiorBruto === null ? null : superiorBruto.toLowerCase();
  const t = `erp.${ident(def.table)}`;
  const temKind = temCampo(def, "kind"); const temAtivo = temCampo(def, "is_active"); const temTipo = def.key === "financial_categories";
  const extras = [...(temKind ? ["kind"] : []), ...(temAtivo ? ["is_active"] : []), ...(temTipo ? ["nature"] : []), ...(temCampo(def, "name") ? ["name"] : [])];
  const sel = ["id", "code", "parent_id", ...extras].map(ident).join(",");
  const r = await ctx.tx.query(`select ${sel} from ${t} where id=$1 and organization_id=$2 and deleted_at is null${travar ? " for update" : ""}`, [id, ctx.orgId]);
  const reg = r.rows[0] as Linha | undefined;
  if (!reg) throw notFound(def.label);
  const antigo = typeof reg["code"] === "string" ? String(reg["code"]) : null;
  const deAtual = (reg["parent_id"] as string | null) ?? null;
  if (superior === deAtual && antigo !== null) throw campoSuperior("O registro já está neste superior.");
  let codigoDestino: string | null = null;
  if (superior !== null) {
    if (superior === id) throw campoSuperior("O superior não pode ser o próprio registro nem um descendente dele.");
    const d = await ctx.tx.query(`select ${sel} from ${t} where id=$1 and organization_id=$2 and deleted_at is null${travar ? " for key share" : ""}`, [superior, ctx.orgId]);
    const dest = d.rows[0] as Linha | undefined;
    if (!dest) throw campoSuperior("Superior não encontrado.");
    const ciclo = await ctx.tx.query(
      `with recursive desc_ as (select id from ${t} where id=$1 and organization_id=$2
         union select x.id from ${t} x join desc_ y on x.parent_id=y.id where x.organization_id=$2)
       select 1 from desc_ where id=$3 limit 1`, [id, ctx.orgId, superior]); // o próprio nó está na semente: ele E os descendentes
    if (ciclo.rowCount) throw campoSuperior("O superior não pode ser o próprio registro nem um descendente dele.");
    if (temKind && dest["kind"] !== "synthetic") throw campoSuperior("O superior precisa ser sintético.");
    if (temAtivo && dest["is_active"] === false) throw campoSuperior("O superior está inativo.");
    if (typeof dest["code"] !== "string") throw campoSuperior("O superior não tem código.");
    if (temTipo && dest["nature"] !== "both" && dest["nature"] !== reg["nature"]) throw campoSuperior(MENSAGEM_TIPO_DIVERGE_DO_SUPERIOR);
    codigoDestino = String(dest["code"]);
  }
  if (def.key === "product_groups" && typeof reg["name"] === "string") {
    const irmao = await ctx.tx.query(`select 1 from erp.product_groups where organization_id=$1 and deleted_at is null and parent_id is not distinct from $2::uuid and lower(name)=lower($3) and id<>$4 limit 1`, [ctx.orgId, superior, reg["name"], id]);
    if (irmao.rowCount) throw campoSuperior(MENSAGEM_NOME_ENTRE_IRMAOS);
  }
  const m = await mascara(ctx, def);
  const larguras = larguraDosNiveis(m) ?? larguraDosNiveis(MASCARA_CODIGO_PADRAO)!;
  const maximo = `Não cabe na máscara (${m}): máximo de ${larguras.length} níveis.`;
  const p = await proximoAbaixo(ctx, def, codigoDestino, m);
  if ("erro" in p) throw campoSuperior(nivelDoCodigo(codigoDestino ?? "") + 1 > larguras.length && codigoDestino !== null ? maximo : p.erro);
  const novo = p.codigo; const nivelNovo = nivelDoCodigo(novo);
  // descendentes, EXCLUÍDOS inclusive (seguram código), na ordem do código
  const desc = await ctx.tx.query<{ id: string; code: string | null; excluido: boolean }>(
    `with recursive desc_ as (select id, code, deleted_at, 1 as d from ${t} where parent_id=$1 and organization_id=$2
       union all select x.id, x.code, x.deleted_at, y.d + 1 from ${t} x join desc_ y on x.parent_id=y.id where x.organization_id=$2 and y.d < 16)
     select id::text as id, code, deleted_at is not null as excluido from desc_ order by code nulls last, id`, [id, ctx.orgId]);
  const codigos: CodigoMovido[] = [{ id, antes: antigo, depois: novo }];
  // EXCLUÍDO que não acompanha o galho (acervo do Mover-de-folha e da edição anteriores deixou prefixo antigo, ou o
  // número não cabe na máscara nova, ou colidiria) libera o código — `EXC-<id>`, a mesma liberação do Zerar — e
  // nunca trava o Mover: o usuário não vê a linha e não teria como corrigi-la. Descendente VIVO continua recusando.
  // O excluído que CABE e não colide com nada acompanha o galho com o prefixo novo, como os vivos.
  const excluidos = new Set<string>();
  const liberar = (c: CodigoMovido) => { c.depois = `EXC-${c.id}`; };
  const renumerar = (code: string | null): string | { erro: string } => {
    if (antigo === null || typeof code !== "string" || !code.startsWith(`${antigo}.`)) {
      return { erro: `O descendente ${code ?? "sem código"} não começa pelo código deste registro (${antigo ?? "sem código"}.): o galho não pode ser renumerado.` };
    }
    const partes: string[] = [];
    for (const [i, seg] of code.slice(antigo.length + 1).split(".").entries()) {
      const nivel = nivelNovo + 1 + i;
      if (nivel > larguras.length) return { erro: maximo };
      const largura = larguras[nivel - 1]!;
      if (!/^\d+$/.test(seg) || String(Number(seg)).length > largura) return { erro: `O código ${code} não cabe na máscara (${m}) abaixo deste superior.` };
      partes.push(String(Number(seg)).padStart(largura, "0"));
    }
    return [novo, ...partes].join(".");
  };
  for (const x of desc.rows) {
    if (x.excluido && (x.code === null || x.code.startsWith("EXC-"))) continue; // excluído sem código ou já liberado: nada a mover
    const r = renumerar(x.code);
    if (typeof r === "string") codigos.push({ id: x.id, antes: x.code, depois: r });
    else if (x.excluido) codigos.push({ id: x.id, antes: x.code, depois: `EXC-${x.id}` });
    else throw campoSuperior(r.erro);
    if (x.excluido) excluidos.add(x.id);
  }
  // Onde o código é único só entre VIVOS (Grupos de Produtos: `uq_product_groups_code_vivo`, 0025) o excluído não
  // segura código nenhum: nunca colide, nunca precisa ser liberado por colisão (A-4).
  const excluidoSeguraCodigo = !CODIGO_UNICO_SO_ENTRE_VIVOS.has(def.table);
  // código novo repetido DENTRO do galho (acervo com "1.03.1" e "1.03.001"): o excluído libera; dois vivos recusam
  const porCodigo = new Map<string, CodigoMovido[]>();
  for (const c of codigos) porCodigo.set(c.depois, [...(porCodigo.get(c.depois) ?? []), c]);
  for (const [codigo, lista] of porCodigo) {
    if (lista.length < 2) continue;
    const vivos = lista.filter((c) => !excluidos.has(c.id));
    if (vivos.length > 1) throw campoSuperior(`O código ${codigo} ficaria repetido neste galho.`);
    if (!excluidoSeguraCodigo) continue;
    const fica = vivos[0] ?? lista[0]; // o vivo, se houver; senão o primeiro — os demais (todos excluídos) liberam
    for (const c of lista) if (c !== fica) liberar(c);
  }
  // código novo já usado FORA do galho (A-4): por um VIVO → o vivo do galho recebe recusa legível (nunca o 409 do
  // banco) e o excluído do galho libera; por um EXCLUÍDO → o excluído do galho libera, e o VIVO do galho fica com o
  // código: quem libera é o excluído de fora (`EXC-<id>`, o par vai no plano, na prévia e na auditoria) em vez de
  // travar o Mover de um registro que o usuário vê por causa de uma linha que ele não vê. Onde o excluído não segura
  // código (Grupos de Produtos), só o VIVO de fora conta, e só contra o VIVO do galho.
  const ids = codigos.map((c) => c.id);
  const usado = await ctx.tx.query<{ id: string; code: string; excluido: boolean }>(
    `select id::text as id, code, deleted_at is not null as excluido from ${t}
      where organization_id=$1 and code = any($2::text[]) and not (id = any($3::uuid[]))${excluidoSeguraCodigo ? "" : " and deleted_at is null"}
      order by code, id`, [ctx.orgId, codigos.map((c) => c.depois), ids]);
  const liberadosDeFora: CodigoMovido[] = [];
  for (const u of usado.rows) {
    for (const c of codigos.filter((x) => x.depois === u.code)) {
      if (excluidos.has(c.id)) { if (excluidoSeguraCodigo) liberar(c); }
      else if (!u.excluido) throw campoSuperior(`O código ${u.code} já existe neste cadastro.`);
      else if (!liberadosDeFora.some((l) => l.id === u.id)) liberadosDeFora.push({ id: u.id, antes: u.code, depois: `EXC-${u.id}` });
    }
  }
  codigos.push(...liberadosDeFora);
  return { id, de: deAtual, para: superior, codigos };
}

/**
 * Executa o Mover numa transação, sob a trava da numeração (decisão 257 D-1): o registro `for update`, o
 * destino `for key share` (a exclusão dele espera). Os ids NÃO mudam — lançamento antigo continua apontando para o
 * mesmo registro, agora com o código novo. Conta as linhas: menos que o plano é recusa, nunca sucesso parcial.
 *
 * GRAVAÇÃO EM DUAS FASES (AJUSTES 01 R1, A-3). O único `(organization_id, code)` não é adiável: o Postgres o confere
 * LINHA A LINHA dentro do mesmo UPDATE. Num UPDATE só, a linha que recebe o código X antes de a linha que hoje SEGURA X
 * ser atualizada morria em 23505 → 409 — onde a prévia (o mesmo plano, que não grava) tinha dado 200. Ex.: o vivo L
 * vai para 2.05.001 e o excluído E do mesmo galho, que hoje é 2.05.001, vai para `EXC-<id>`. Então:
 *   1ª fase: quem hoje segura o código FINAL de outra linha do plano sai da frente — o liberado já para o seu
 *            `EXC-<id>` (final), o que continua no galho para um código PROVISÓRIO único (`MOVER-<id>`);
 *   2ª fase: os códigos finais (e o superior do movido).
 * Depois da 1ª fase nenhuma linha segura o código final de outra (fora do plano ninguém o segura — o plano confere),
 * e a ordem das linhas deixa de importar. A prévia é o MESMO plano: o que ela mostra é o que o POST grava.
 */
export async function moverNaArvore(ctx: ServiceCtx, def: ResourceDef, id: string, superior: string | null): Promise<PlanoDoMover> {
  if (def.codigoAutomatico !== "hierarquico") throw validation("Este cadastro não tem código hierárquico.");
  await travarNumeracao(ctx, def);
  const plano = await planejarMover(ctx, def, id, superior, true);
  const t = `erp.${ident(def.table)}`;
  const mudam = plano.codigos.filter((c) => c.antes !== c.depois || c.id === plano.id);
  const donoDoFinal = new Map(mudam.map((c) => [c.depois, c.id]));
  const liberado = (c: CodigoMovido) => c.depois.startsWith("EXC-");
  const bloqueia = (c: CodigoMovido) => c.antes !== null && donoDoFinal.has(c.antes) && donoDoFinal.get(c.antes) !== c.id;
  const fase1 = mudam.filter((c) => liberado(c) || bloqueia(c)).map((c) => ({ id: c.id, codigo: liberado(c) ? c.depois : `MOVER-${c.id}` }));
  const fase2 = mudam.filter((c) => !liberado(c));
  const gravar = async (linhas: { id: string; codigo: string }[], comSuperior: boolean) => {
    if (!linhas.length) return;
    const u = await ctx.tx.query(
      `update ${t} x set code = v.codigo${comSuperior ? ", parent_id = case when x.id = $4::uuid then $5::uuid else x.parent_id end" : ""}
         from (select unnest($1::uuid[]) as id, unnest($2::text[]) as codigo) v where x.id = v.id and x.organization_id = $3`,
      [linhas.map((l) => l.id), linhas.map((l) => l.codigo), ctx.orgId, ...(comSuperior ? [plano.id, plano.para] : [])]);
    if (u.rowCount !== linhas.length) throw err("CONCURRENCY_CONFLICT", "O galho mudou durante o Mover; tente de novo.");
  };
  await gravar(fase1, false);
  await gravar(fase2.map((c) => ({ id: c.id, codigo: c.depois })), true);
  // o id CANÔNICO do plano (A-6), não o da URL: o histórico do registro procura pelo id como o banco o devolve
  await audit(ctx.tx, ctx, def.key, plano.id, "mover", { de: plano.de, para: plano.para, codigos: plano.codigos });
  return plano;
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
