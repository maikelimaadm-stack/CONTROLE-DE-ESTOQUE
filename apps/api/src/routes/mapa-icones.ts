/**
 * MAPA-MANEJO-02 (decisão 306) — CONFIGURAÇÃO DE ÍCONE DO MAPA: qual imagem e/ou cor vale para cada categoria de animal,
 * por empresa e por tipo de entidade (`erp.configuracoes_de_icone`, migration 0062). A regra de QUAL configuração vale
 * para um lote é do domínio (`packages/domain/src/configuracao-de-icone.ts`); esta rota só cadastra.
 *
 * A TABELA GUARDA SÓ O LUGAR DO ÍCONE: o endereço `https://` da imagem (`icone_url`) e/ou a cor (`cor_padrao`). Nenhum
 * ícone é escolhido, desenhado nem nomeado aqui — a imagem vem depois, cadastrada pelo Maike pelo produto.
 *
 * ┌─ AS ROTAS ─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ GET    /api/mapa/icones         lista (filtros tipo_entidade e ativo; page/pageSize; total) icon_config.view   │
 * │ POST   /api/mapa/icones         cria (201)                                                  icon_config.create │
 * │ GET    /api/mapa/icones/:id     detalhe                                                     icon_config.view   │
 * │ PATCH  /api/mapa/icones/:id     edita parcial (ao menos um campo; empresa e tipo não mudam) icon_config.edit   │
 * │ DELETE /api/mapa/icones/:id     exclusão LÓGICA (deleted_at = now()); nunca física          icon_config.delete │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 * O módulo de escopo é o da permissão (`icon_config` → pecuária, o mesmo da área e de `map_objects`), nunca o módulo
 * neutro `mapa`. Tudo por `runService`; toda leitura com `{{escopo:c.empresa_id}}` na tabela (a única de cada consulta).
 *
 * CONSULTAS POR ROTA (fora o begin/commit e o contexto do `runService`): lista 2 (contagem + página, nunca uma por
 * linha); detalhe 1; cria 2 (a empresa pedida + o INSERT); edita 2 (a linha com FOR UPDATE + o UPDATE); exclui 1.
 *
 * A FORMA CANÔNICA DA CATEGORIA (`categoriaCanonica` do domínio — maiúsculas, sem espaço nas pontas, 1 a 60 caracteres)
 * é conferida e, fora dela, RECUSADA (422 em `categoria`) — nunca traduzida: "boi" não vira "BOI". `MISTO` é o valor
 * especial: só ele carrega `categorias_misto` (2 ou mais categorias canônicas, sem repetição), e ele a exige.
 *
 * AS RECUSAS
 *   403  falta da capacidade (antes de qualquer leitura, inclusive da forma do id: não revela existência).
 *   404  inexistente, de outra organização, fora do escopo, excluída e id malformado: a MESMA resposta, o mesmo corpo.
 *   422  corpo ou consulta fora do contrato (zod `.strict()`: chave desconhecida — `empresa_id`/`tipo_entidade` no PATCH
 *        inclusive —, tipo fora do catálogo, paginação fora da forma canônica, PATCH vazio); `categoria` fora da forma
 *        canônica; `categorias_misto` malformada, fora do MISTO ou ausente no MISTO; `icone_url` que não é URL https://;
 *        `cor_padrao` que não é #RRGGBB; sem imagem e sem cor (em `icone_url`); empresa fora do escopo
 *        (`exigirEmpresaDeLancamento`). No PATCH, a COMBINAÇÃO resultante (o que vem + o que a linha tem) é a julgada.
 *        Violação de CHECK que escape da borda vira a mesma 422, com o caminho do campo pelo NOME da CHECK.
 *   409  categoria repetida entre as vivas de (empresa, tipo de entidade), menos o MISTO
 *        (`uq_configuracoes_de_icone_categoria`, via `fromPgError`).
 *
 * ROW COUNT conferido em todo UPDATE (PATCH e DELETE): zero linhas sob a RLS é 404, nunca sucesso sem efeito.
 * Auditoria: o gatilho `erp.audit_row` da tabela grava — a rota NÃO chama `audit()` (duplicaria).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@agro/shared";
import { CATEGORIA_MISTO, FORMA_UUID_PADRAO, TIPOS_DE_ENTIDADE_DE_ICONE, categoriaCanonica } from "@agro/domain";
import { runService } from "../lib/service.js";
import { consultaEscopada, exigirEmpresaDeLancamento, type ServiceCtx } from "../lib/context.js";
import { err, validation } from "../lib/errors.js";

// ─────────────── mensagens ───────────────

const MSG_CATEGORIA = "Informe a categoria na forma canônica: MAIÚSCULAS, sem espaço nas pontas, de 1 a 60 caracteres (ex.: \"BOI\")";
const MSG_LISTA_MISTO = "Informe as categorias do MISTO como uma lista de 2 ou mais categorias na forma canônica, sem repetição";
const MSG_LISTA_SO_NO_MISTO = `Só a categoria ${CATEGORIA_MISTO} tem categorias_misto`;
const MSG_MISTO_EXIGE_LISTA = `A categoria ${CATEGORIA_MISTO} exige categorias_misto (2 ou mais categorias)`;
const MSG_URL = "Informe o endereço da imagem como URL https://, sem espaço, sem usuário/senha, com até 2048 caracteres";
const MSG_COR = "Informe a cor no formato #RRGGBB (seis dígitos hexadecimais)";
const MSG_IMAGEM_OU_COR = "Informe a imagem (icone_url) ou a cor (cor_padrao): ao menos uma das duas";
const MSG_TIPO_ENTIDADE = "Tipo de entidade fora do catálogo";
const MSG_PELO_MENOS_UM_CAMPO = "Informe ao menos um campo para alterar";

/** 422 com o caminho do campo: `validation("campo: msg", [{ path, message }])`. */
const recusa = (path: string, message: string) => validation(`${path}: ${message}`, [{ path, message }]);
const naoEncontrado = () => err("NOT_FOUND", "Configuração de ícone não encontrada");

// ─────────────── contrato de entrada (estrito) ───────────────

/** uuid do corpo em minúsculas (as comparações com o banco são de texto). */
const uuid = z.string().uuid().transform((v) => v.toLowerCase());
const tipoEntidade = z.enum(TIPOS_DE_ENTIDADE_DE_ICONE);
/**
 * Categoria: a régua é a do domínio (`categoriaCanonica`), conferida e nunca aplicada — sem `.trim()` nem maiúsculas
 * aqui, que gravariam outra coisa que não a recebida. O caractere nulo é recusado junto: o Postgres não o guarda em
 * `text`, e sem esta recusa ele viraria 500.
 */
const categoriaValida = (v: string): boolean => categoriaCanonica(v) && !v.includes("\u0000");
const categoria = z.string().refine(categoriaValida, { message: MSG_CATEGORIA });
/**
 * A lista do MISTO: 2 ou mais categorias canônicas, sem repetição (a mesma regra de
 * `erp.icone_categorias_misto_validas`, que a CHECK do banco aplica). Toda recusa sai no caminho `categorias_misto`,
 * inclusive a de um elemento que não é texto.
 */
const categoriasMisto = z.custom<string[]>(
  (v) => Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === "string" && categoriaValida(x)) && new Set(v).size === v.length,
  { message: MSG_LISTA_MISTO },
);
/**
 * Endereço da imagem: começa por `https://` (a CHECK `chk_icone_url_https`), é URL que o `URL` lê e não tem espaço nem controle.
 * Usuário/senha embutidos (`https://u:s@host/...`) são recusados: o endereço é exibido a todos que veem o mapa, e
 * credencial não se guarda nem se mostra.
 */
function urlHttps(v: string): boolean {
  if (!v.startsWith("https://") || v.length > 2048) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return false;
  }
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname !== "" && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}
const iconeUrl = z.string().refine(urlHttps, { message: MSG_URL });
/** Cor: a mesma forma da CHECK `chk_icone_cor_padrao` (maiúsculas e minúsculas aceitas como vieram). */
const cor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, MSG_COR);

const criarSchema = z.object({
  empresa_id: uuid,
  tipo_entidade: tipoEntidade,
  categoria,
  categorias_misto: categoriasMisto.nullish(),
  icone_url: iconeUrl.nullish(),
  cor_padrao: cor.nullish(),
  ativo: z.boolean().optional(),
}).strict();

/** Empresa e tipo de entidade não mudam: no PATCH são chave desconhecida (422). */
const editarSchema = z.object({
  categoria: categoria.optional(),
  categorias_misto: categoriasMisto.nullable().optional(),
  icone_url: iconeUrl.nullable().optional(),
  cor_padrao: cor.nullable().optional(),
  ativo: z.boolean().optional(),
}).strict().refine((c) => Object.keys(c).length > 0, { message: MSG_PELO_MENOS_UM_CAMPO });
type CorpoEditar = z.infer<typeof editarSchema>;

/** Página até 100 mil: sem teto, `?page=1e308` passaria pelo `int()` e o OFFSET estouraria no banco (500). */
const PAGINA_MAXIMA = 100_000;
/**
 * Inteiro positivo na forma CANÔNICA (só dígitos, sem zero à esquerda): `1e1`, `0x2`, ` 3` ou `2.0` são recusados (422),
 * nunca traduzidos — o mesmo critério das rotas de objetos e de ocupação.
 */
const inteiroPositivo = (maximo: number) =>
  z.string().regex(/^[1-9]\d{0,8}$/, "Número inteiro inválido").transform(Number).pipe(z.number().int().min(1).max(maximo));
const listaSchema = z.object({
  page: inteiroPositivo(PAGINA_MAXIMA).default(1),
  pageSize: inteiroPositivo(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  tipo_entidade: tipoEntidade.optional(),
  /** Só a forma canônica `true`/`false`: `1`, `sim` ou `TRUE` são recusados, nunca traduzidos. */
  ativo: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
}).strict();

/** Id da rota: fora da forma é inexistente — a MESMA 404, sem 22P02 → 500. */
function idDaRota(bruto: unknown): string {
  if (typeof bruto !== "string" || !FORMA_UUID_PADRAO.test(bruto)) throw naoEncontrado();
  return bruto.toLowerCase();
}

// ─────────────── a linha ───────────────

/** As colunas da tabela que a API devolve (`deleted_at` é sempre nulo no que é visível). */
const COLUNAS = `c.id, c.organization_id, c.empresa_id, c.tipo_entidade, c.categoria, c.categorias_misto, c.icone_url, c.cor_padrao,
  c.ativo, c.created_at, c.updated_at`;

interface ConfiguracaoDeIconeLinha {
  [k: string]: unknown;
  id: string; organization_id: string; empresa_id: string; tipo_entidade: string; categoria: string;
  categorias_misto: string[] | null; icone_url: string | null; cor_padrao: string | null; ativo: boolean;
  created_at: Date; updated_at: Date;
}

/** Lê UMA configuração visível: organização, viva e no escopo do módulo. `paraAtualizar` trava a linha. */
async function lerConfiguracao(ctx: ServiceCtx, id: string, paraAtualizar = false): Promise<ConfiguracaoDeIconeLinha> {
  const r = await consultaEscopada<ConfiguracaoDeIconeLinha>(ctx,
    `select ${COLUNAS} from erp.configuracoes_de_icone c
      where c.id=$1 and c.organization_id=$2 and c.deleted_at is null and {{escopo:c.empresa_id}}${paraAtualizar ? " for update" : ""}`,
    [id, ctx.orgId]);
  const linha = r.rows[0];
  if (!linha) throw naoEncontrado();
  return linha;
}

// ─────────────── as conferências ───────────────

interface Combinacao { categoria: string; categorias_misto: readonly string[] | null; icone_url: string | null; cor_padrao: string | null }

/**
 * A COMBINAÇÃO que vai para o banco: a lista só no MISTO, e o MISTO com a lista (sem ela a configuração nunca casaria —
 * o domínio a ignora —, e cadastrar o que nunca vale é sucesso sem efeito); e ao menos a imagem ou a cor.
 */
function conferirCombinacao(c: Combinacao): void {
  const misto = c.categoria === CATEGORIA_MISTO;
  if (!misto && c.categorias_misto !== null) throw recusa("categorias_misto", MSG_LISTA_SO_NO_MISTO);
  if (misto && c.categorias_misto === null) throw recusa("categorias_misto", MSG_MISTO_EXIGE_LISTA);
  if (c.icone_url === null && c.cor_padrao === null) throw recusa("icone_url", MSG_IMAGEM_OU_COR);
}

/**
 * CHECK do banco → o campo e a mensagem da borda. A borda já recusa tudo isto antes; o mapa existe para que uma
 * diferença entre as duas réguas (o `upper` do Postgres e o `toUpperCase`, por exemplo) seja 422 com o caminho do
 * campo, nunca uma 422 genérica. Lista estática, pelo NOME da CHECK.
 */
const CAMPO_DA_CHECK: Readonly<Record<string, { path: string; message: string }>> = {
  chk_icone_tipo_entidade: { path: "tipo_entidade", message: MSG_TIPO_ENTIDADE },
  chk_icone_categoria_canonica: { path: "categoria", message: MSG_CATEGORIA },
  chk_icone_misto_so_no_misto: { path: "categorias_misto", message: MSG_LISTA_MISTO },
  chk_icone_cor_padrao: { path: "cor_padrao", message: MSG_COR },
  chk_icone_tem_imagem_ou_cor: { path: "icone_url", message: MSG_IMAGEM_OU_COR },
  chk_icone_url_https: { path: "icone_url", message: MSG_URL },
};

/** Erros do banco com o caminho do campo (23514 pelo nome da CHECK). O resto (o 23505 → 409) segue para o `fromPgError`. */
function comCaminho(e: unknown): unknown {
  const pe = e as { code?: string; constraint?: string } | null;
  if (!pe || typeof pe !== "object") return e;
  if (pe.code === "23514" && typeof pe.constraint === "string" && Object.hasOwn(CAMPO_DA_CHECK, pe.constraint)) {
    const campo = CAMPO_DA_CHECK[pe.constraint]!;
    return recusa(campo.path, campo.message);
  }
  return e;
}
async function gravar<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { throw comCaminho(e); }
}

// ─────────────── o PATCH: as colunas editáveis (lista estática, nunca vinda do corpo) ───────────────

const EDITAVEIS = ["categoria", "categorias_misto", "icone_url", "cor_padrao", "ativo"] as const;
type Editavel = (typeof EDITAVEIS)[number];

export default async function mapaIconesRoutes(app: FastifyInstance) {
  app.get("/mapa/icones", async (req) => runService(app, req, "icon_config.view", async (ctx) => {
    const q = listaSchema.parse(req.query);
    const where = ["c.organization_id=$1", "c.deleted_at is null", "{{escopo:c.empresa_id}}"];
    const base: unknown[] = [ctx.orgId];
    if (q.tipo_entidade) { base.push(q.tipo_entidade); where.push(`c.tipo_entidade=$${base.length}`); }
    if (q.ativo !== undefined) { base.push(q.ativo); where.push(`c.ativo=$${base.length}`); }
    const w = where.join(" and ");
    const contagem = await consultaEscopada<{ total: number }>(ctx, `select count(*)::int as total from erp.configuracoes_de_icone c where ${w}`, [...base]);
    const pagina = [...base, q.pageSize, (q.page - 1) * q.pageSize];
    const itens = await consultaEscopada<ConfiguracaoDeIconeLinha>(ctx,
      `select ${COLUNAS} from erp.configuracoes_de_icone c where ${w}
        order by c.tipo_entidade, c.categoria, c.id limit $${base.length + 1} offset $${base.length + 2}`, pagina);
    return { itens: itens.rows, total: contagem.rows[0]?.total ?? 0, page: q.page, pageSize: q.pageSize };
  }));

  app.get("/mapa/icones/:id", async (req) => runService(app, req, "icon_config.view", async (ctx) =>
    lerConfiguracao(ctx, idDaRota((req.params as { id?: unknown }).id))));

  app.post("/mapa/icones", async (req, reply) => reply.status(201).send(await runService(app, req, "icon_config.create", async (ctx) => {
    const c = criarSchema.parse(req.body);
    await exigirEmpresaDeLancamento(ctx, c.empresa_id);
    const nova: Combinacao = { categoria: c.categoria, categorias_misto: c.categorias_misto ?? null, icone_url: c.icone_url ?? null, cor_padrao: c.cor_padrao ?? null };
    conferirCombinacao(nova);
    const r = await gravar(() => ctx.tx.query<ConfiguracaoDeIconeLinha>(
      `insert into erp.configuracoes_de_icone as c (organization_id, empresa_id, tipo_entidade, categoria, categorias_misto,
                                                   icone_url, cor_padrao, ativo)
       values ($1, $2, $3, $4, $5::text[], $6, $7, $8)
       returning ${COLUNAS}`,
      [ctx.orgId, c.empresa_id, c.tipo_entidade, nova.categoria, nova.categorias_misto, nova.icone_url, nova.cor_padrao, c.ativo ?? true]));
    const linha = r.rows[0];
    if (!linha) throw new Error("INSERT de erp.configuracoes_de_icone sem linha devolvida");
    return linha;
  })));

  app.patch("/mapa/icones/:id", async (req) => runService(app, req, "icon_config.edit", async (ctx) => {
    const id = idDaRota((req.params as { id?: unknown }).id);
    const c: CorpoEditar = editarSchema.parse(req.body);
    const atual = await lerConfiguracao(ctx, id, true);
    conferirCombinacao({
      categoria: c.categoria ?? atual.categoria,
      categorias_misto: c.categorias_misto !== undefined ? c.categorias_misto : atual.categorias_misto,
      icone_url: c.icone_url !== undefined ? c.icone_url : atual.icone_url,
      cor_padrao: c.cor_padrao !== undefined ? c.cor_padrao : atual.cor_padrao,
    });

    const params: unknown[] = [id, ctx.orgId];
    const sets: string[] = [];
    for (const campo of EDITAVEIS) {
      if (!(campo in c)) continue;
      params.push(c[campo as Editavel]);
      sets.push(`${campo}=$${params.length}${campo === "categorias_misto" ? "::text[]" : ""}`);
    }
    const r = await gravar(() => consultaEscopada<ConfiguracaoDeIconeLinha>(ctx,
      `update erp.configuracoes_de_icone c set ${sets.join(", ")}
        where c.id=$1 and c.organization_id=$2 and c.deleted_at is null and {{escopo:c.empresa_id}}
        returning ${COLUNAS}`, params));
    if (r.rowCount !== 1 || !r.rows[0]) throw naoEncontrado();
    return r.rows[0];
  }));

  app.delete("/mapa/icones/:id", async (req) => runService(app, req, "icon_config.delete", async (ctx) => {
    const id = idDaRota((req.params as { id?: unknown }).id);
    const r = await consultaEscopada<{ id: string }>(ctx,
      `update erp.configuracoes_de_icone c set deleted_at=now()
        where c.id=$1 and c.organization_id=$2 and c.deleted_at is null and {{escopo:c.empresa_id}}
        returning c.id`, [id, ctx.orgId]);
    if (r.rowCount !== 1) throw naoEncontrado();
    return { id, deleted: true };
  }));
}
