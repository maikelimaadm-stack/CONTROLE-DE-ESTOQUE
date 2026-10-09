/**
 * MAPA-MANEJO-01 (decisão 305) — OBJETOS DO MAPA: cocho e depósito a pasto desenhados sobre o mapa (`erp.objetos_de_mapa`,
 * migration 0061). Ponto dentro ou fora de uma área; o catálogo de tipos, formas e unidades é do domínio
 * (`packages/domain/src/objetos-de-mapa.ts`).
 *
 * ┌─ AS ROTAS ─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ GET    /api/mapa/objetos        lista (filtros area_id e tipo; page/pageSize; total)   map_objects.view    │
 * │ POST   /api/mapa/objetos        cria (201)                                              map_objects.create  │
 * │ GET    /api/mapa/objetos/:id    detalhe                                                 map_objects.view    │
 * │ PATCH  /api/mapa/objetos/:id    edita parcial (ao menos um campo; a empresa não muda)   map_objects.edit    │
 * │ DELETE /api/mapa/objetos/:id    exclusão LÓGICA (deleted_at = now()); nunca física      map_objects.delete  │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 * O módulo de escopo é o da permissão (`map_objects` → pecuária, o mesmo da área), nunca o módulo neutro `mapa`.
 * Tudo por `runService`; toda leitura com `{{escopo:alias.empresa_id}}` em CADA tabela que tem empresa.
 *
 * AS RECUSAS
 *   403  falta da capacidade (antes de qualquer leitura: não revela existência).
 *   404  inexistente, de outra organização, fora do escopo, excluído e id malformado: a MESMA resposta, o mesmo corpo.
 *   422  corpo ou consulta fora do contrato (zod `.strict()`: chave desconhecida, capacidade como número, tipo fora do
 *        catálogo, forma que não é a do tipo); `area_id` indisponível (inexistente, fora do escopo, de outra empresa);
 *        `trough_id` indisponível (CAMADA 5.2: cocho de outra organização, excluído, inexistente ou numa área de OUTRA
 *        empresa — a mesma recusa, sem dizer qual); geometria inválida (o gatilho do banco é a autoridade — nenhum
 *        validador em TS, sem segundo SSOT). Todas com o caminho do campo em `details`.
 *   409  `code` repetido para (empresa, tipo) entre os objetos vivos (`uq_objetos_de_mapa_codigo`, via `fromPgError`).
 *
 * DUAS BARREIRAS para o cocho (5.2): a API confere primeiro, pelo escopo da requisição; o gatilho
 * `trg_objetos_de_mapa_cocho_conferir` confere de novo no banco, e o erro dele vira a MESMA 422 com `path: trough_id`.
 *
 * ROW COUNT conferido em todo UPDATE (PATCH e DELETE): zero linhas sob a RLS é 404, nunca sucesso sem efeito.
 * Auditoria: o gatilho `erp.audit_row` da tabela grava — a rota NÃO chama `audit()` (duplicaria).
 * Ícones: não entram aqui (fornecidos depois pelo produto).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@agro/shared";
import { FORMAS_DE_OBJETO, FORMA_UUID_PADRAO, UNIDADES_DE_CAPACIDADE, VALORES_TIPO_DE_OBJETO_DE_MAPA, formaDoTipo, type TipoDeObjetoDeMapa } from "@agro/domain";
import { runService } from "../lib/service.js";
import { consultaEscopada, exigirEmpresaDeLancamento, type ServiceCtx } from "../lib/context.js";
import { notFound, validation } from "../lib/errors.js";

// ─────────────── mensagens ───────────────

const MSG_AREA_INDISPONIVEL = "Área indisponível para este objeto.";
/** O mesmo texto do gatilho do banco: as duas barreiras respondem igual. */
const MSG_COCHO_INDISPONIVEL = "Cocho indisponível para este objeto.";
const MSG_COCHO_SO_PARA_COCHO = "Só o tipo cocho se liga a um cocho cadastrado.";
const MSG_FORMA_DO_TIPO = "A forma tem de ser a do tipo";
const MSG_CAPACIDADE = "Informe a capacidade como texto decimal maior ou igual a zero, com até 3 casas (ex.: \"12.5\")";
const MSG_PELO_MENOS_UM_CAMPO = "Informe ao menos um campo para alterar";

/** 422 com o caminho do campo: `validation("campo: msg", [{ path, message }])`. */
const recusa = (path: string, message: string) => validation(`${path}: ${message}`, [{ path, message }]);
const naoEncontrado = () => notFound("Objeto do mapa");

// ─────────────── contrato de entrada (estrito) ───────────────

/** uuid do corpo em minúsculas (as comparações com o banco são de texto). */
const uuid = z.string().uuid().transform((v) => v.toLowerCase());
const tipo = z.enum(VALORES_TIPO_DE_OBJETO_DE_MAPA);
const forma = z.enum(FORMAS_DE_OBJETO);
/** GeoJSON como OBJETO; o que ele diz (type, coordenadas, faixa de lon/lat) é o gatilho do banco que julga. */
const geometria = z.record(z.string(), z.unknown());
/**
 * Capacidade: TEXTO decimal canônico, não negativo, até 3 casas e até 9 dígitos inteiros (`numeric(12,3)`) — sem
 * sinal, sem zero à esquerda, sem expoente. Número no JSON é 422 (quantidade nunca viaja como ponto flutuante).
 */
const capacidade = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/, MSG_CAPACIDADE);
const unidade = z.enum(UNIDADES_DE_CAPACIDADE);
const code = z.string().trim().min(1).max(60);
const nome = z.string().trim().min(1).max(200);
const descricao = z.string().trim().max(2000);

const criarSchema = z.object({
  empresa_id: uuid,
  tipo,
  forma: forma.optional(),
  geometria,
  code: code.nullish(),
  name: nome,
  descricao: descricao.nullish(),
  capacidade: capacidade.nullish(),
  unidade_capacidade: unidade.nullish(),
  area_id: uuid.nullish(),
  trough_id: uuid.nullish(),
  is_active: z.boolean().optional(),
}).strict();

const editarSchema = z.object({
  tipo: tipo.optional(),
  forma: forma.optional(),
  geometria: geometria.optional(),
  code: code.nullable().optional(),
  name: nome.optional(),
  descricao: descricao.nullable().optional(),
  capacidade: capacidade.nullable().optional(),
  unidade_capacidade: unidade.nullable().optional(),
  area_id: uuid.nullable().optional(),
  trough_id: uuid.nullable().optional(),
  is_active: z.boolean().optional(),
}).strict().refine((c) => Object.keys(c).length > 0, { message: MSG_PELO_MENOS_UM_CAMPO });
type CorpoEditar = z.infer<typeof editarSchema>;

/** Página até 100 mil: sem teto, `?page=1e308` passaria pelo `int()` e o OFFSET estouraria no banco (500). */
const PAGINA_MAXIMA = 100_000;
/**
 * Inteiro positivo na forma CANÔNICA (só dígitos, sem zero à esquerda): `1e1`, `0x2`, ` 3` ou `2.0` são recusados (422),
 * nunca traduzidos — o mesmo critério das rotas de ocupação.
 */
const inteiroPositivo = (maximo: number) =>
  z.string().regex(/^[1-9]\d{0,8}$/, "Número inteiro inválido").transform(Number).pipe(z.number().int().min(1).max(maximo));
const listaSchema = z.object({
  page: inteiroPositivo(PAGINA_MAXIMA).default(1),
  pageSize: inteiroPositivo(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  area_id: uuid.optional(),
  tipo: tipo.optional(),
}).strict();

/** Id da rota: fora da forma é inexistente — a MESMA 404, sem 22P02 → 500. */
function idDaRota(bruto: unknown): string {
  if (typeof bruto !== "string" || !FORMA_UUID_PADRAO.test(bruto)) throw naoEncontrado();
  return bruto.toLowerCase();
}

// ─────────────── a linha ───────────────

/** As colunas da tabela que a API devolve (decimal como texto; `deleted_at` é sempre nulo no que é visível). */
const COLUNAS = `o.id, o.organization_id, o.empresa_id, o.area_id, o.tipo, o.forma, o.geometria, o.code, o.name, o.descricao,
  o.capacidade, o.unidade_capacidade, o.trough_id, o.is_active, o.created_at, o.updated_at`;

interface ObjetoDeMapa {
  [k: string]: unknown;
  id: string; organization_id: string; empresa_id: string; area_id: string | null; tipo: string; forma: string;
  geometria: unknown; code: string | null; name: string; descricao: string | null; capacidade: string | null;
  unidade_capacidade: string | null; trough_id: string | null; is_active: boolean; created_at: Date; updated_at: Date;
}

/** Lê UM objeto visível: organização, vivo e no escopo do módulo. `paraAtualizar` trava a linha. */
async function lerObjeto(ctx: ServiceCtx, id: string, paraAtualizar = false): Promise<ObjetoDeMapa> {
  const r = await consultaEscopada<ObjetoDeMapa>(ctx,
    `select ${COLUNAS} from erp.objetos_de_mapa o
      where o.id=$1 and o.organization_id=$2 and o.deleted_at is null and {{escopo:o.empresa_id}}${paraAtualizar ? " for update" : ""}`,
    [id, ctx.orgId]);
  const linha = r.rows[0];
  if (!linha) throw naoEncontrado();
  return linha;
}

// ─────────────── as conferências ───────────────

/** A área existe, está viva, é DESTA empresa e está no escopo do módulo — senão 422 em `area_id`. */
async function conferirArea(ctx: ServiceCtx, areaId: string, empresaId: string): Promise<void> {
  const r = await consultaEscopada(ctx,
    `select 1 from erp.areas a
      where a.id=$1 and a.organization_id=$2 and a.empresa_id=$3 and a.deleted_at is null and {{escopo:a.empresa_id}}`,
    [areaId, ctx.orgId, empresaId]);
  if (!r.rowCount) throw recusa("area_id", MSG_AREA_INDISPONIVEL);
}

/**
 * CAMADA 5.2 — `erp.troughs` é recurso de ORGANIZAÇÃO (sem empresa). O cocho tem de ser desta organização, vivo e, se
 * estiver numa área, a área tem de ser da MESMA empresa do objeto (e visível no escopo). Inexistente, de outra
 * organização, excluído e de área de outra empresa: a MESMA 422, sem dizer qual.
 */
async function conferirCocho(ctx: ServiceCtx, troughId: string, empresaId: string): Promise<void> {
  const r = await consultaEscopada<{ area_id: string | null; empresa_id: string | null }>(ctx,
    `select t.area_id, a.empresa_id
       from erp.troughs t
       left join erp.areas a on a.id = t.area_id and {{escopo:a.empresa_id}}
      where t.id=$1 and t.organization_id=$2 and t.deleted_at is null`,
    [troughId, ctx.orgId]);
  const linha = r.rows[0];
  if (!linha || (linha.area_id !== null && (linha.empresa_id === null || linha.empresa_id !== empresaId))) {
    throw recusa("trough_id", MSG_COCHO_INDISPONIVEL);
  }
}

/** A forma é a do tipo: ausente, é ela; presente e diferente, 422 em `forma`. */
function formaResolvida(t: TipoDeObjetoDeMapa, pedida: string | undefined): string {
  const esperada = formaDoTipo(t);
  if (!esperada) throw recusa("tipo", "Tipo de objeto desconhecido"); // discriminador desconhecido NEGA
  if (pedida !== undefined && pedida !== esperada) throw recusa("forma", `${MSG_FORMA_DO_TIPO} (${esperada})`);
  return esperada;
}

/**
 * Erros do banco com o caminho do campo. Geometria inválida (P0001 do `trg_objetos_de_mapa_geometria_conferir`) →
 * 422 em `geometria`; cocho recusado pelo `trg_objetos_de_mapa_cocho_conferir` → a mesma 422 da API em `trough_id`;
 * a FK composta da área → 422 em `area_id`. O resto (o 23505 do código repetido → 409) segue para o `fromPgError`.
 */
function comCaminho(e: unknown): unknown {
  const pe = e as { code?: string; message?: string; constraint?: string } | null;
  if (!pe || typeof pe !== "object") return e;
  if (pe.code === "P0001" && typeof pe.message === "string") {
    const m = /^VALIDATION_ERROR:\s*(Geometria do objeto inválida.*)$/s.exec(pe.message);
    if (m) return recusa("geometria", m[1]!);
    if (/^VALIDATION_ERROR:\s*Cocho indisponível/.test(pe.message)) return recusa("trough_id", MSG_COCHO_INDISPONIVEL);
  }
  if (pe.code === "23503" && pe.constraint === "fk_objetos_area") return recusa("area_id", MSG_AREA_INDISPONIVEL);
  return e;
}
async function gravar<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { throw comCaminho(e); }
}

// ─────────────── o PATCH: as colunas editáveis (lista estática, nunca vinda do corpo) ───────────────

const EDITAVEIS = ["tipo", "forma", "geometria", "code", "name", "descricao", "capacidade", "unidade_capacidade", "area_id", "trough_id", "is_active"] as const;
type Editavel = (typeof EDITAVEIS)[number];
const valorDaColuna = (campo: Editavel, v: unknown): unknown => (campo === "geometria" ? JSON.stringify(v) : v);

export default async function mapaObjetosRoutes(app: FastifyInstance) {
  app.get("/mapa/objetos", async (req) => runService(app, req, "map_objects.view", async (ctx) => {
    const q = listaSchema.parse(req.query);
    const where = ["o.organization_id=$1", "o.deleted_at is null", "{{escopo:o.empresa_id}}"];
    const base: unknown[] = [ctx.orgId];
    if (q.area_id) { base.push(q.area_id); where.push(`o.area_id=$${base.length}`); }
    if (q.tipo) { base.push(q.tipo); where.push(`o.tipo=$${base.length}`); }
    const w = where.join(" and ");
    const contagem = await consultaEscopada<{ total: number }>(ctx, `select count(*)::int as total from erp.objetos_de_mapa o where ${w}`, [...base]);
    const pagina = [...base, q.pageSize, (q.page - 1) * q.pageSize];
    const itens = await consultaEscopada<ObjetoDeMapa>(ctx,
      `select ${COLUNAS} from erp.objetos_de_mapa o where ${w} order by o.name, o.id limit $${base.length + 1} offset $${base.length + 2}`, pagina);
    return { itens: itens.rows, total: contagem.rows[0]?.total ?? 0, page: q.page, pageSize: q.pageSize };
  }));

  app.get("/mapa/objetos/:id", async (req) => runService(app, req, "map_objects.view", async (ctx) =>
    lerObjeto(ctx, idDaRota((req.params as { id?: unknown }).id))));

  app.post("/mapa/objetos", async (req, reply) => reply.status(201).send(await runService(app, req, "map_objects.create", async (ctx) => {
    const c = criarSchema.parse(req.body);
    await exigirEmpresaDeLancamento(ctx, c.empresa_id);
    const f = formaResolvida(c.tipo, c.forma);
    if (c.trough_id && c.tipo !== "cocho") throw recusa("trough_id", MSG_COCHO_SO_PARA_COCHO);
    if (c.area_id) await conferirArea(ctx, c.area_id, c.empresa_id);
    if (c.trough_id) await conferirCocho(ctx, c.trough_id, c.empresa_id);
    const r = await gravar(() => ctx.tx.query<ObjetoDeMapa>(
      `insert into erp.objetos_de_mapa as o (organization_id, empresa_id, area_id, tipo, forma, geometria, code, name, descricao,
                                            capacidade, unidade_capacidade, trough_id, is_active)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::numeric, $11, $12, $13)
       returning ${COLUNAS}`,
      [ctx.orgId, c.empresa_id, c.area_id ?? null, c.tipo, f, JSON.stringify(c.geometria), c.code ?? null, c.name,
        c.descricao ? c.descricao : null, c.capacidade ?? null, c.unidade_capacidade ?? null, c.trough_id ?? null, c.is_active ?? true]));
    const linha = r.rows[0];
    if (!linha) throw new Error("INSERT de erp.objetos_de_mapa sem linha devolvida");
    return linha;
  })));

  app.patch("/mapa/objetos/:id", async (req) => runService(app, req, "map_objects.edit", async (ctx) => {
    const id = idDaRota((req.params as { id?: unknown }).id);
    const c: CorpoEditar = editarSchema.parse(req.body);
    const atual = await lerObjeto(ctx, id, true);
    const tipoFinal = (c.tipo ?? atual.tipo) as TipoDeObjetoDeMapa;
    const mudancas: Partial<Record<Editavel, unknown>> = { ...c };
    if (c.tipo !== undefined || c.forma !== undefined) mudancas.forma = formaResolvida(tipoFinal, c.forma);
    if (c.descricao !== undefined) mudancas.descricao = c.descricao ? c.descricao : null;
    const cochoFinal = c.trough_id !== undefined ? c.trough_id : atual.trough_id;
    if (cochoFinal && tipoFinal !== "cocho") throw recusa("trough_id", MSG_COCHO_SO_PARA_COCHO);
    if (c.area_id) await conferirArea(ctx, c.area_id, atual.empresa_id);
    if (c.trough_id) await conferirCocho(ctx, c.trough_id, atual.empresa_id);

    const params: unknown[] = [id, ctx.orgId];
    const sets: string[] = [];
    for (const campo of EDITAVEIS) {
      if (!(campo in mudancas)) continue;
      params.push(valorDaColuna(campo, mudancas[campo]));
      sets.push(`${campo}=$${params.length}${campo === "geometria" ? "::jsonb" : campo === "capacidade" ? "::numeric" : ""}`);
    }
    const r = await gravar(() => consultaEscopada<ObjetoDeMapa>(ctx,
      `update erp.objetos_de_mapa o set ${sets.join(", ")}
        where o.id=$1 and o.organization_id=$2 and o.deleted_at is null and {{escopo:o.empresa_id}}
        returning ${COLUNAS}`, params));
    if (r.rowCount !== 1 || !r.rows[0]) throw naoEncontrado();
    return r.rows[0];
  }));

  app.delete("/mapa/objetos/:id", async (req) => runService(app, req, "map_objects.delete", async (ctx) => {
    const id = idDaRota((req.params as { id?: unknown }).id);
    const r = await consultaEscopada<{ id: string }>(ctx,
      `update erp.objetos_de_mapa o set deleted_at=now()
        where o.id=$1 and o.organization_id=$2 and o.deleted_at is null and {{escopo:o.empresa_id}}
        returning o.id`, [id, ctx.orgId]);
    if (r.rowCount !== 1) throw naoEncontrado();
    return { id, deleted: true };
  }));
}
