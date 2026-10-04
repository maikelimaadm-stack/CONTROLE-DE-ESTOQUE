import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ErroPeriodoConsulta, FAIXA_ZERO, INDICES_CONSULTA_SATELITE, MAX_ITENS_POR_CONSULTA, PAGINA_CONSULTAS, PAGINA_ITENS_CONSULTA,
  SITUACOES_ITEM_VIVAS, VERSAO_METODO_NDVI_V2, estimarCreditosItem, origemChaveIdempotencia, slotsDoPeriodo, somarFaixas,
  type FaixaCreditos, type PeriodoConsulta, type SlotConsulta
} from "@agro/domain";
import { D } from "@agro/shared";
import { runService } from "../lib/service.js";
import { DomainError, err, validation } from "../lib/errors.js";
import { empresaScopeSql, scopedById, type ServiceCtx } from "../lib/context.js";
import { chaveIdempotencia } from "../lib/satelite/chave-consulta.js";
import { MSG_AREA_NAO_ENCONTRADA, PERMISSAO_PEDIR_ANALISE, PERMISSAO_VER_ANALISE, exigir, prepararPoligono, type AreaLida } from "./analises-satelitais.js";

/**
 * CONSULTA SATELITAL EM LOTE (SAT-02, decisão 295) — o PEDIDO de NDVI para várias áreas e períodos de uma vez, com
 * prévia de custo, orçamento do mês e fila idempotente. Só API: sem tela, sem worker e SEM CHAMADA AO PROVEDOR nesta
 * fatia (a fila é consumida por fatia própria). Nenhuma rota daqui fala com o Copernicus.
 *
 *   POST /api/satelite/consultas        prévia (confirmar=false, NADA é gravado) ou criação (confirmar=true, 201)
 *   GET  /api/satelite/consultas/:id    a consulta e os itens dela (paginados no servidor), com ETag fraco
 *   GET  /api/satelite/consultas        histórico do escopo (paginado no servidor)
 *
 * AUTORIZAÇÃO = CAPACIDADE (`analises_satelitais.create` no POST, `.view` nos GETs) ∧ ESCOPO (módulo pecuária, o da
 * permissão — o mesmo da área). O escopo de empresa entra em CADA ocorrência de tabela de CADA consulta SQL, antes de
 * qualquer `limit`. Consulta inexistente, de outra organização, fora do escopo ou id malformado: a MESMA 404.
 *
 * O CLIENTE NÃO MANDA GEOMETRIA NEM EMPRESA: o alvo é uma lista de ids de área, "todas" ou um retiro; o servidor lê as
 * áreas DEPOIS da autorização, e o hash do polígono é calculado PELO BANCO (a mesma expressão da 0052). Corpo e query
 * estritos: chave desconhecida → 422, nunca descartada em silêncio. A empresa da consulta é a das áreas — uma consulta,
 * UMA empresa; o `X-Empresa-Id` só diminui o alvo.
 *
 * IDEMPOTÊNCIA: cada item (área × janela × índice) tem a chave `sha256(origemChaveIdempotencia(...))` — organização,
 * área, hash do polígono, índice, data alvo + janela e versão do método. Se a chave já tem item VIVO (pendente,
 * executando, concluído), o item novo nasce `reaproveitado` e custa zero. O banco garante um vivo por chave na
 * organização (índice único parcial da 0053 em (organization_id, chave_idempotencia)); a corrida entre duas criações cai
 * no `on conflict do nothing` e o perdedor vira
 * `reaproveitado`. A criação ainda toma `pg_advisory_xact_lock` por (organização, empresa) ANTES de ler as chaves e o
 * orçamento: duas criações da mesma empresa são serializadas, e a segunda enxerga a reserva da primeira.
 *
 * ORÇAMENTO (mês UTC, por empresa): limite (`erp.satelite_orcamentos`) − consumido (`erp.satelite_consumo` no mês) −
 * reservado. Reservado = o que as consultas pendentes/executando (de QUALQUER mês) ainda podem gastar: para cada uma,
 * greatest(estimativa máxima − consumo já registrado DELA em qualquer mês, 0). Assim o gasto parcial de uma consulta em
 * execução conta uma vez só (no consumo), e a pendente do mês anterior continua reservando no dia 1. Sem linha de
 * orçamento = sem limite (saldo nulo). Estimativa NOVA acima do saldo: a prévia avisa; a criação recusa (422) e nada é
 * gravado.
 */

export const MSG_CONSULTA_NAO_ENCONTRADA = "Consulta não encontrada";
export const MSG_RETIRO_NAO_ENCONTRADO = "Retiro não encontrado";
export const MSG_ALVO_SEM_AREAS = "Nenhuma área encontrada para o alvo da consulta.";
export const MSG_NENHUMA_AREA_ANALISAVEL = "Nenhuma área do alvo pode ser analisada por satélite; veja as áreas ignoradas.";
export const MSG_VARIAS_EMPRESAS = "As áreas do alvo são de mais de uma empresa: selecione a empresa (X-Empresa-Id) ou peça uma consulta por empresa.";
export const MSG_EXCEDE_ORCAMENTO = "A estimativa da consulta passa do saldo de créditos do mês da empresa; nada foi criado.";
export const msgItensDemais = (n: number) => `A consulta teria ${n} itens; o máximo é ${MAX_ITENS_POR_CONSULTA} por consulta.`;
/** Recusa ANTES do banco: só os slots × índices de UMA área já passam do teto (a contagem real seria maior ou igual). */
export const msgItensDemaisPeloMenos = (n: number) => `A consulta teria pelo menos ${n} itens; o máximo é ${MAX_ITENS_POR_CONSULTA} por consulta.`;

/** Situações de consulta que RESERVAM saldo do orçamento (ainda podem gastar). */
const SITUACOES_QUE_RESERVAM = ["pendente", "executando"] as const;
/**
 * O predicado do índice único parcial da 0053, como texto FIXO: o `on conflict` precisa de um predicado que o planejador
 * prove implicar o do índice (parâmetro não serve). Vem da lista do domínio — nunca de entrada do usuário.
 */
const VIVAS_SQL = SITUACOES_ITEM_VIVAS.map((s) => `'${s}'`).join(", ");
const listaSql = (valores: readonly string[]) => valores.map((s) => `'${s}'`).join(", ");

/** id de RECURSO (path): forma de UUID; malformado é a mesma 404 do inexistente. */
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** UUID no CORPO: só a forma canônica (minúsculas) — a unicidade da lista é conferida pelo texto, sem tradução. */
const uuidCanonico = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
/** Dia civil 'YYYY-MM-DD'. A validade do calendário, o futuro e a data mínima são do domínio (`slotsDoPeriodo`). */
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const semRepetir = <T>(lista: readonly T[]) => new Set(lista).size === lista.length;

const alvoSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("areas"),
    area_ids: z.array(uuidCanonico).min(1).max(MAX_ITENS_POR_CONSULTA).refine(semRepetir, "Área repetida no alvo")
  }).strict(),
  z.object({ tipo: z.literal("todas") }).strict(),
  z.object({ tipo: z.literal("retiro"), retiro_id: uuidCanonico }).strict()
]);
/** Forma do período; as FAIXAS (janela, tolerância) e o calendário são conferidos pelo domínio, com o campo na recusa. */
const periodoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("mais_recente"), janela_dias: z.number().int() }).strict(),
  z.object({ tipo: z.literal("data"), data: dia, tolerancia_dias: z.number().int() }).strict(),
  z.object({ tipo: z.literal("intervalo"), de: dia, ate: dia, cadencia: z.enum(["mensal", "decendial"]) }).strict()
]);
const corpoSchema = z.object({
  alvo: alvoSchema,
  periodo: periodoSchema,
  indices: z.array(z.enum(INDICES_CONSULTA_SATELITE)).min(1).refine(semRepetir, "Índice repetido"),
  confirmar: z.boolean()
}).strict();
type CorpoConsulta = z.infer<typeof corpoSchema>;
type IndiceConsulta = CorpoConsulta["indices"][number];

const semQuery = z.object({}).strict();
/**
 * Inteiro positivo na forma CANÔNICA (só dígitos, sem zero à esquerda): `1e2`, `0x2`, ` 3`, `2.0`, `01` ou `-1` são
 * recusados (422), nunca traduzidos.
 */
const inteiroPositivo = (maximo: number) => z.string().regex(/^[1-9]\d{0,8}$/).transform(Number).pipe(z.number().int().min(1).max(maximo));
const paginaQuery = (p: { readonly padrao: number; readonly maximo: number }) => z.object({
  pagina: inteiroPositivo(1_000_000).default(1),
  tamanho: inteiroPositivo(p.maximo).default(p.padrao)
}).strict();
const historicoQuery = paginaQuery(PAGINA_CONSULTAS);
const itensQuery = paginaQuery(PAGINA_ITENS_CONSULTA);

interface AreaDoAlvo extends AreaLida { nome: string }
interface AreaIgnorada { area_id: string; nome: string; motivo: string }
interface ItemPlanejado {
  area_id: string; geometria_sha256: string; indice: IndiceConsulta; slot: SlotConsulta; origem: string; chave: string; faixa: FaixaCreditos;
}

interface LinhaConsulta {
  id: string; empresa_id: string; situacao: string; parametros: unknown; estimativa_creditos: string; estimativa_creditos_minima: string;
  total_itens: number; total_concluidos: number; total_falhos: number; total_reaproveitados: number; criado_por: string;
  created_at: Date; concluida_em: Date | null;
}
const COLUNAS_CONSULTA = ["id", "empresa_id", "situacao", "parametros", "estimativa_creditos", "estimativa_creditos_minima", "total_itens",
  "total_concluidos", "total_falhos", "total_reaproveitados", "criado_por", "created_at", "concluida_em"];
const colunasConsulta = (alias: string) => COLUNAS_CONSULTA.map((c) => `${alias}.${c}`).join(", ");

interface LinhaItem {
  id: string; area_id: string; indice_bundle: string; versao_metodo: string; data_alvo: string | null; janela_inicio: string; janela_fim: string;
  situacao: string; tentativas: number; proxima_tentativa_em: Date | null; erro: string | null; analise_id: string | null; pu_gasto: string | null;
  created_at: Date;
}
const COLUNAS_ITEM = ["id", "area_id", "indice_bundle", "versao_metodo", "data_alvo", "janela_inicio", "janela_fim", "situacao", "tentativas",
  "proxima_tentativa_em", "erro", "analise_id", "pu_gasto", "created_at"];

/** DTO da consulta. Créditos como STRING decimal (o `numeric` do banco, nunca float); a faixa inteira da estimativa. */
function consultaDto(l: LinhaConsulta) {
  return {
    id: l.id, empresa_id: l.empresa_id, situacao: l.situacao, parametros: l.parametros,
    estimativa_creditos: { minimo: l.estimativa_creditos_minima, maximo: l.estimativa_creditos },
    total_itens: l.total_itens, total_concluidos: l.total_concluidos, total_falhos: l.total_falhos, total_reaproveitados: l.total_reaproveitados,
    criado_por: l.criado_por, criado_em: l.created_at.toISOString(), concluida_em: l.concluida_em?.toISOString() ?? null
  };
}

/** DTO do item. Datas da janela como dia civil 'YYYY-MM-DD' (o `date` do banco); `pu_gasto` como string decimal. */
function itemDto(l: LinhaItem) {
  return {
    id: l.id, area_id: l.area_id, indice_bundle: l.indice_bundle, versao_metodo: l.versao_metodo,
    data_alvo: l.data_alvo, janela_inicio: l.janela_inicio, janela_fim: l.janela_fim, situacao: l.situacao, tentativas: l.tentativas,
    proxima_tentativa_em: l.proxima_tentativa_em?.toISOString() ?? null, erro: l.erro, analise_id: l.analise_id, pu_gasto: l.pu_gasto,
    criado_em: l.created_at.toISOString()
  };
}

/** ETag FRACO do corpo exato da resposta: muda quando qualquer campo visível muda (situação, contadores, itens, página). */
function etagFraco(corpo: unknown): string {
  return `W/"${createHash("sha256").update(JSON.stringify(corpo)).digest("hex")}"`;
}

/** `If-None-Match` com comparação FRACA (RFC 9110 §13.1.2): lista separada por vírgula, `W/` ignorado, `*` casa tudo. */
function etagConfere(cabecalho: string | string[] | undefined, etag: string): boolean {
  if (!cabecalho) return false;
  const opaco = (t: string) => t.trim().replace(/^W\//, "");
  const alvo = opaco(etag);
  return (Array.isArray(cabecalho) ? cabecalho.join(",") : cabecalho).split(",").some((t) => t.trim() === "*" || opaco(t) === alvo);
}

/** Os dias da consulta. Período inválido (calendário, futuro, antes do Sentinel-2 L2A, faixa) → 422 com o CAMPO. */
function slotsOuRecusa(periodo: PeriodoConsulta, hoje: string): SlotConsulta[] {
  try {
    return slotsDoPeriodo(periodo, hoje);
  } catch (e) {
    if (e instanceof ErroPeriodoConsulta) throw validation(e.message, [{ path: e.campo, message: e.message }]);
    throw e;
  }
}

/** Retiro vivo, no escopo — senão a mesma 404 para inexistente, de outra organização, fora do escopo ou excluído. */
async function exigirRetiroNoEscopo(ctx: ServiceCtx, retiroId: string): Promise<void> {
  const sc = scopedById(ctx, "r", retiroId);
  const r = await ctx.tx.query(`select r.id from erp.retiros r where r.id = $1 and r.organization_id = $2 and r.deleted_at is null${sc.sql}`, sc.params);
  if (r.rowCount !== 1) throw err("NOT_FOUND", MSG_RETIRO_NAO_ENCONTRADO);
}

/**
 * As áreas VIVAS do alvo, no escopo, com o hash do polígono calculado PELO BANCO. Lista de ids: TODAS precisam existir
 * no escopo, senão a mesma 404 da SAT-01 (sem dizer qual falhou — não revela existência). Uma consulta só.
 */
async function lerAreasDoAlvo(ctx: ServiceCtx, alvo: CorpoConsulta["alvo"]): Promise<AreaDoAlvo[]> {
  const params: unknown[] = [ctx.orgId];
  let filtro = "";
  if (alvo.tipo === "areas") { params.push(alvo.area_ids); filtro = ` and a.id = any($${params.length}::uuid[])`; }
  if (alvo.tipo === "retiro") {
    await exigirRetiroNoEscopo(ctx, alvo.retiro_id);
    params.push(alvo.retiro_id); filtro = ` and a.retiro_id = $${params.length}`;
  }
  const escopo = empresaScopeSql(ctx, "a", params);
  const r = await ctx.tx.query<AreaDoAlvo>(
    `select a.id, a.empresa_id, a.name as nome, a.geometria,
            case when a.geometria is null then null else encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex') end as geometria_sha256
       from erp.areas a
      where a.organization_id = $1 and a.deleted_at is null${filtro}${escopo}
      order by a.code, a.id`, params);
  if (alvo.tipo === "areas" && r.rows.length !== alvo.area_ids.length) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
  return r.rows;
}

/** Separa as analisáveis das ignoradas com os MESMOS critérios da SAT-01 (`prepararPoligono`): o motivo é a mensagem dela. */
function separarAreas(areas: readonly AreaDoAlvo[]) {
  const analisaveis: { area: AreaDoAlvo; hash: string; pixelsBbox: number }[] = [];
  const ignoradas: AreaIgnorada[] = [];
  for (const area of areas) {
    try {
      const { grade } = prepararPoligono(area);
      analisaveis.push({ area, hash: area.geometria_sha256!, pixelsBbox: grade.larguraPx * grade.alturaPx });
    } catch (e) {
      if (!(e instanceof DomainError) || e.code !== "VALIDATION_ERROR") throw e;
      ignoradas.push({ area_id: area.id, nome: area.nome, motivo: e.message });
    }
  }
  return { analisaveis, ignoradas };
}

/** As chaves que já têm item VIVO no escopo — uma consulta para o lote inteiro (`= any`), nunca uma por item. */
async function chavesVivas(ctx: ServiceCtx, chaves: readonly string[]): Promise<Set<string>> {
  const params: unknown[] = [ctx.orgId, chaves];
  const escopo = empresaScopeSql(ctx, "i", params);
  const r = await ctx.tx.query<{ chave_idempotencia: string }>(
    `select i.chave_idempotencia from erp.satelite_consulta_itens i
      where i.organization_id = $1 and i.chave_idempotencia = any($2::text[]) and i.situacao in (${VIVAS_SQL})${escopo}`, params);
  return new Set(r.rows.map((l) => l.chave_idempotencia));
}

/**
 * Saldo de créditos do mês UTC da empresa: limite − consumido no mês − reservado; `null` = sem orçamento (sem limite).
 * Reservado = Σ greatest(estimativa − consumo já registrado da consulta, 0) das consultas pendentes/executando de qualquer
 * mês. Uma consulta SQL, com o escopo de empresa em CADA ocorrência de tabela (orçamento, consumo do mês, consultas e
 * consumo de cada consulta).
 */
async function saldoDoMes(ctx: ServiceCtx, empresaId: string, agora: Date): Promise<string | null> {
  const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
  const fim = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1));
  const params: unknown[] = [ctx.orgId, empresaId, inicio.toISOString().slice(0, 10), inicio, fim];
  const escopoOrcamento = empresaScopeSql(ctx, "o", params);
  const escopoConsumo = empresaScopeSql(ctx, "c", params);
  const escopoReserva = empresaScopeSql(ctx, "s", params);
  const escopoGastoDaConsulta = empresaScopeSql(ctx, "cc", params);
  const r = await ctx.tx.query<{ saldo: string }>(
    `select o.limite_creditos
            - (select coalesce(sum(c.creditos), 0) from erp.satelite_consumo c
                where c.organization_id = $1 and c.empresa_id = $2 and c.created_at >= $4 and c.created_at < $5${escopoConsumo})
            - (select coalesce(sum(greatest(s.estimativa_creditos - g.gasto, 0)), 0)
                 from erp.satelite_consultas s
                 cross join lateral (
                   select coalesce(sum(cc.creditos), 0) as gasto from erp.satelite_consumo cc
                    where cc.organization_id = $1 and cc.empresa_id = $2 and cc.consulta_id = s.id${escopoGastoDaConsulta}
                 ) g
                where s.organization_id = $1 and s.empresa_id = $2 and s.situacao in (${listaSql(SITUACOES_QUE_RESERVAM)})${escopoReserva}) as saldo
       from erp.satelite_orcamentos o
      where o.organization_id = $1 and o.empresa_id = $2 and o.mes_referencia = $3${escopoOrcamento}`, params);
  if (r.rows.length > 1) throw new Error("orçamento satelital: mais de uma linha para o mês");
  return r.rows[0]?.saldo ?? null;
}

const faixaDe = (itens: readonly ItemPlanejado[]): FaixaCreditos => (itens.length ? somarFaixas(itens.map((i) => i.faixa)) : FAIXA_ZERO);

async function inserirConsulta(ctx: ServiceCtx, empresaId: string, parametros: unknown, estimativa: FaixaCreditos, totalItens: number, reaproveitados: number, situacao: "pendente" | "concluida"): Promise<LinhaConsulta> {
  const g = await ctx.tx.query<LinhaConsulta>(
    `insert into erp.satelite_consultas (organization_id, empresa_id, criado_por, parametros, estimativa_creditos, estimativa_creditos_minima,
        situacao, total_itens, total_reaproveitados, concluida_em)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7::text, $8, $9, case when $7::text = 'concluida' then now() end)
     returning ${COLUNAS_CONSULTA.join(", ")}`,
    [ctx.orgId, empresaId, ctx.user.id, JSON.stringify(parametros), estimativa.maximo, estimativa.minimo, situacao, totalItens, reaproveitados]);
  if (g.rowCount !== 1) throw new Error("consulta satelital: a gravação da consulta não devolveu exatamente uma linha");
  return g.rows[0]!;
}

/**
 * Os itens num INSERT em LOTE (`unnest`, parâmetros fixos qualquer que seja o tamanho). O item vivo repetido não entra
 * (`on conflict` no índice parcial): quem chama confere o ROW COUNT e trata o que perdeu a corrida.
 */
async function inserirItens(ctx: ServiceCtx, consultaId: string, empresaId: string, linhas: readonly { item: ItemPlanejado; situacao: string }[]) {
  const coluna = <T>(f: (l: { item: ItemPlanejado; situacao: string }) => T) => linhas.map(f);
  const g = await ctx.tx.query<{ chave_idempotencia: string }>(
    `insert into erp.satelite_consulta_itens (consulta_id, organization_id, empresa_id, area_id, geometria_sha256, indice_bundle, versao_metodo,
        data_alvo, janela_inicio, janela_fim, situacao, chave_idempotencia, chave_idempotencia_origem)
     select $1, $2, $3, u.area_id, u.geometria_sha256, u.indice_bundle, $4, u.data_alvo, u.janela_inicio, u.janela_fim, u.situacao, u.chave, u.origem
       from unnest($5::uuid[], $6::text[], $7::text[], $8::date[], $9::date[], $10::date[], $11::text[], $12::text[], $13::text[])
            as u (area_id, geometria_sha256, indice_bundle, data_alvo, janela_inicio, janela_fim, situacao, chave, origem)
     on conflict (organization_id, chave_idempotencia) where situacao in (${VIVAS_SQL}) do nothing
     returning chave_idempotencia`,
    [consultaId, ctx.orgId, empresaId, VERSAO_METODO_NDVI_V2,
      coluna((l) => l.item.area_id), coluna((l) => l.item.geometria_sha256), coluna((l) => l.item.indice),
      coluna((l) => l.item.slot.data_alvo), coluna((l) => l.item.slot.janela_inicio), coluna((l) => l.item.slot.janela_fim),
      coluna((l) => l.situacao), coluna((l) => l.item.chave), coluna((l) => l.item.origem)]);
  return { rowCount: g.rowCount ?? 0, chaves: new Set(g.rows.map((l) => l.chave_idempotencia)) };
}

/** Ajuste da consulta quando itens perderam a corrida: viram reaproveitados, a estimativa cai. ROW COUNT conferido. */
async function ajustarConsulta(ctx: ServiceCtx, consultaId: string, estimativa: FaixaCreditos, reaproveitados: number, situacao: "pendente" | "concluida"): Promise<LinhaConsulta> {
  const params: unknown[] = [consultaId, ctx.orgId, estimativa.maximo, estimativa.minimo, reaproveitados, situacao];
  const escopo = empresaScopeSql(ctx, "s", params);
  const g = await ctx.tx.query<LinhaConsulta>(
    `update erp.satelite_consultas s
        set estimativa_creditos = $3, estimativa_creditos_minima = $4, total_reaproveitados = $5, situacao = $6::text,
            concluida_em = case when $6::text = 'concluida' then now() else s.concluida_em end
      where s.id = $1 and s.organization_id = $2${escopo}
      returning ${colunasConsulta("s")}`, params);
  if (g.rowCount !== 1) throw new Error("consulta satelital: o ajuste da consulta não alcançou exatamente uma linha");
  return g.rows[0]!;
}

/**
 * O POST inteiro numa transação (`runService`): áreas, chaves, orçamento e — só com `confirmar` — a gravação. A prévia
 * passa pelas MESMAS leituras e devolve antes de qualquer escrita.
 */
async function processarConsulta(ctx: ServiceCtx, corpo: CorpoConsulta, corpoBruto: unknown, slots: readonly SlotConsulta[], agora: Date) {
  const areas = await lerAreasDoAlvo(ctx, corpo.alvo);
  if (areas.length === 0) throw validation(MSG_ALVO_SEM_AREAS, { areas_ignoradas: [] });
  // Uma consulta = UMA empresa. O alvo inteiro (inclusive o que seria ignorado) precisa ser de uma empresa só.
  if (new Set(areas.map((a) => a.empresa_id)).size > 1) throw validation(MSG_VARIAS_EMPRESAS, [{ path: "alvo", message: MSG_VARIAS_EMPRESAS }]);
  const empresaId = areas[0]!.empresa_id;
  const { analisaveis, ignoradas } = separarAreas(areas);
  if (analisaveis.length === 0) throw validation(MSG_NENHUMA_AREA_ANALISAVEL, { areas_ignoradas: ignoradas });
  const totalItens = analisaveis.length * slots.length * corpo.indices.length;
  if (totalItens > MAX_ITENS_POR_CONSULTA) throw validation(msgItensDemais(totalItens), { total_itens: totalItens, maximo: MAX_ITENS_POR_CONSULTA });

  const itens: ItemPlanejado[] = [];
  for (const { area, hash, pixelsBbox } of analisaveis) {
    for (const slot of slots) {
      for (const indice of corpo.indices) {
        const origem = origemChaveIdempotencia({ organizationId: ctx.orgId, areaId: area.id, geometriaSha256: hash, indiceBundle: indice, slot, versaoMetodo: VERSAO_METODO_NDVI_V2 });
        itens.push({ area_id: area.id, geometria_sha256: hash, indice, slot, origem, chave: chaveIdempotencia(origem), faixa: estimarCreditosItem({ pixelsBbox, indice, slot }) });
      }
    }
  }

  // A trava vem ANTES de ler as chaves e o orçamento: a segunda criação da mesma empresa espera a primeira terminar e
  // enxerga os itens e a reserva dela. A prévia não trava (não grava nada).
  if (corpo.confirmar) {
    await ctx.tx.query("select pg_advisory_xact_lock(hashtextextended('satelite-consulta:' || $1::uuid::text || ':' || $2::uuid::text, 0))", [ctx.orgId, empresaId]);
  }
  const vivas = await chavesVivas(ctx, itens.map((i) => i.chave));
  const novos = itens.filter((i) => !vivas.has(i.chave));
  const reaproveitados = itens.filter((i) => vivas.has(i.chave));
  const estimativa = faixaDe(novos);
  const saldo = await saldoDoMes(ctx, empresaId, agora);
  // O orçamento só barra CUSTO NOVO: uma consulta só de reaproveitados (estimativa 0) nunca excede, mesmo com o saldo do
  // mês já negativo — ela não pede nada ao provedor.
  const excede = saldo !== null && D(estimativa.maximo).gt(0) && D(estimativa.maximo).gt(D(saldo));

  if (!corpo.confirmar) {
    return {
      criada: false as const,
      corpo: {
        total_itens: totalItens, reaproveitados: reaproveitados.length, novos: novos.length, estimativa_creditos: estimativa,
        saldo_creditos_mes: saldo, excede_orcamento: excede, empresa_id: empresaId, areas_ignoradas: ignoradas
      }
    };
  }
  if (excede) throw validation(MSG_EXCEDE_ORCAMENTO, { estimativa_creditos: estimativa, saldo_creditos_mes: saldo });

  let consulta = await inserirConsulta(ctx, empresaId, corpoBruto, estimativa, totalItens, reaproveitados.length, novos.length ? "pendente" : "concluida");
  const gravacao = await inserirItens(ctx, consulta.id, empresaId, [
    ...novos.map((item) => ({ item, situacao: "pendente" })),
    ...reaproveitados.map((item) => ({ item, situacao: "reaproveitado" }))
  ]);
  // Reaproveitado nunca colide (o índice é só dos vivos); só um NOVO pode ter perdido a corrida para outra criação.
  const perdidos = novos.filter((i) => !gravacao.chaves.has(i.chave));
  if (gravacao.rowCount !== totalItens - perdidos.length || reaproveitados.some((i) => !gravacao.chaves.has(i.chave))) {
    throw new Error("consulta satelital: a gravação dos itens não alcançou as linhas esperadas");
  }
  let novosFinais = novos;
  let estimativaFinal = estimativa;
  if (perdidos.length) {
    const extra = await inserirItens(ctx, consulta.id, empresaId, perdidos.map((item) => ({ item, situacao: "reaproveitado" })));
    if (extra.rowCount !== perdidos.length) throw new Error("consulta satelital: a gravação dos itens reaproveitados não alcançou as linhas esperadas");
    novosFinais = novos.filter((i) => gravacao.chaves.has(i.chave));
    estimativaFinal = faixaDe(novosFinais);
    consulta = await ajustarConsulta(ctx, consulta.id, estimativaFinal, totalItens - novosFinais.length, novosFinais.length ? "pendente" : "concluida");
  }
  return {
    criada: true as const,
    corpo: {
      consulta: consultaDto(consulta), total_itens: totalItens, reaproveitados: totalItens - novosFinais.length, novos: novosFinais.length,
      // O saldo lido sob a trava, ANTES desta consulta — o mesmo número que a prévia mostraria naquele instante.
      estimativa_creditos: estimativaFinal, saldo_creditos_mes: saldo, areas_ignoradas: ignoradas
    }
  };
}

export default async function sateliteConsultasRoutes(app: FastifyInstance) {
  app.post("/satelite/consultas", async (req, reply) => {
    exigir(app, req, PERMISSAO_PEDIR_ANALISE);
    semQuery.parse(req.query);
    const corpo = corpoSchema.parse(req.body);
    const agora = new Date();
    const slots = slotsOuRecusa(corpo.periodo, agora.toISOString().slice(0, 10));
    // Recusa barata, sem ler área nenhuma: se UMA área já passa do teto, o alvo inteiro passa.
    const porArea = slots.length * corpo.indices.length;
    if (porArea > MAX_ITENS_POR_CONSULTA) throw validation(msgItensDemaisPeloMenos(porArea), { total_itens_minimo: porArea, maximo: MAX_ITENS_POR_CONSULTA });
    const r = await runService(app, req, PERMISSAO_PEDIR_ANALISE, (ctx) => processarConsulta(ctx, corpo, req.body, slots, agora));
    return reply.status(r.criada ? 201 : 200).send(r.corpo);
  });

  app.get("/satelite/consultas/:id", async (req, reply) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = itensQuery.parse(req.query);
    const id = String((req.params as { id?: string }).id ?? "");
    if (!FORMA_UUID.test(id)) throw err("NOT_FOUND", MSG_CONSULTA_NAO_ENCONTRADA);
    const corpo = await runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const sc = scopedById(ctx, "s", id);
      const c = await ctx.tx.query<LinhaConsulta>(
        `select ${colunasConsulta("s")} from erp.satelite_consultas s where s.id = $1 and s.organization_id = $2${sc.sql}`, sc.params);
      const consulta = c.rows[0];
      if (!consulta) throw err("NOT_FOUND", MSG_CONSULTA_NAO_ENCONTRADA);
      // A empresa da consulta (lida e autorizada acima) entra explícita: o índice (org, empresa, consulta, created_at, id)
      // serve também ao dono sem X-Empresa-Id. O escopo continua, em cima.
      const params: unknown[] = [ctx.orgId, consulta.id, consulta.empresa_id];
      const escopo = empresaScopeSql(ctx, "i", params);
      params.push(q.tamanho + 1, (q.pagina - 1) * q.tamanho);
      const r = await ctx.tx.query<LinhaItem>(
        `select ${COLUNAS_ITEM.map((col) => `i.${col}`).join(", ")}
           from erp.satelite_consulta_itens i
          where i.organization_id = $1 and i.consulta_id = $2 and i.empresa_id = $3${escopo}
          order by i.created_at, i.id
          limit $${params.length - 1} offset $${params.length}`, params);
      return {
        consulta: consultaDto(consulta), itens: r.rows.slice(0, q.tamanho).map(itemDto),
        pagina: q.pagina, tamanho: q.tamanho, tem_mais: r.rows.length > q.tamanho
      };
    });
    // A ETag só existe DEPOIS da autorização completa: um 304 nunca confirma consulta que o pedido não pode ver.
    const etag = etagFraco(corpo);
    reply.header("etag", etag).header("cache-control", "private, no-cache");
    if (etagConfere(req.headers["if-none-match"], etag)) return reply.status(304).send();
    return corpo;
  });

  app.get("/satelite/consultas", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = historicoQuery.parse(req.query);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const params: unknown[] = [ctx.orgId];
      const escopo = empresaScopeSql(ctx, "s", params);
      params.push(q.tamanho + 1, (q.pagina - 1) * q.tamanho);
      const r = await ctx.tx.query<LinhaConsulta>(
        `select ${colunasConsulta("s")}
           from erp.satelite_consultas s
          where s.organization_id = $1${escopo}
          order by s.created_at desc, s.id desc
          limit $${params.length - 1} offset $${params.length}`, params);
      return { itens: r.rows.slice(0, q.tamanho).map(consultaDto), pagina: q.pagina, tamanho: q.tamanho, tem_mais: r.rows.length > q.tamanho };
    });
  });
}
