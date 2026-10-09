import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, sum, type DecimalString, type ISODate } from "@agro/shared";
import {
  SITUACOES_DE_LOTACAO, VALORES_TIPO_DE_USO_DA_AREA,
  capacidadeDaEstacao, diasDeDescanso, diasDeOcupacao, estacaoDoAno, rodizioRealizadoVersusPlanejado, situacaoDeLotacao, uaPorHectare,
  type EstacaoDoAno, type RodizioRealizadoVersusPlanejado, type SituacaoDeLotacao
} from "@agro/domain";
import { runService } from "../lib/service.js";
import { consultaEscopada, hasPermission } from "../lib/context.js";
import { err } from "../lib/errors.js";
import { rebanhoDosLotes, type RebanhoDoLote } from "../lib/rebanho-dos-lotes.js";

/**
 * MAPA-MANEJO-01 (decisão 305) — OCUPAÇÃO DA ÁREA e o MAPA OPERACIONAL (leituras; nenhuma escrita).
 *
 *   GET /api/mapa/areas/:areaId/ocupacao            quem está na área agora, as últimas saídas, descanso, lotação e rodízio
 *   GET /api/mapa/areas/:areaId/ocupacao/historico  o histórico inteiro da área, paginado no servidor
 *   GET /api/mapa/operacional                       UMA chamada com tudo o que o mapa operacional desenha
 *
 * Permissão das três: `batch_area.view` (módulo pecuária — o escopo de empresa da área). As contas moram no domínio
 * (`packages/domain/src/ocupacao-de-area.ts`); aqui só se agrega no SQL e se entrega a ele. "Hoje" é o `current_date`
 * do BANCO, lido na primeira consulta de cada rota — nunca o relógio do Node, que pode estar em outro dia.
 *
 * NÚMERO DE CONSULTAS FIXO em todas as rotas: nenhuma consulta por área, por lote nem por ocupação. É contado por
 * teste (mapa-manejo-01-ocupacao.test.ts MM-8b, mapa-manejo-01-operacional.test.ts MM-10b).
 */

/** Ler área e lote: a permissão das três rotas (módulo pecuária). */
const PERMISSAO = "batch_area.view";
/** Objetos do mapa (`erp.objetos_de_mapa`): capacidade própria, módulo pecuária. */
const PERMISSAO_OBJETOS = "map_objects.view";
/** Manejo: a MESMA capacidade que `GET /livestock/handlings` exige (livestock.ts), módulo pecuária. */
const PERMISSAO_MANEJO = "nutritions.view";
/** Pesagem: a mesma de `GET /livestock/weighings`, módulo pecuária. */
const PERMISSAO_PESAGEM = "weighings.view";

/** A MESMA 404 para inexistente, de outra organização, fora do escopo, excluída e id malformado. */
const MSG_AREA_NAO_ENCONTRADA = "Área não encontrada";
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quantas ocupações FECHADAS a leitura da ocupação devolve quando não se pede outro número. */
const FECHADAS_PADRAO = 5;
const FECHADAS_MAXIMO = 50;

/** Filtro de situação: as três do domínio e a ausência de referência (`situacao_de_lotacao` nula). */
const SEM_REFERENCIA = "sem_referencia";
const FILTROS_DE_SITUACAO = [...SITUACOES_DE_LOTACAO, SEM_REFERENCIA] as const;
type FiltroDeSituacao = (typeof FILTROS_DE_SITUACAO)[number];

/**
 * Inteiro positivo na forma CANÔNICA (só dígitos, sem zero à esquerda): `1e1`, `0x5`, ` 3` ou `2.0` são recusados
 * (422), nunca traduzidos.
 */
const inteiroPositivo = (maximo: number) =>
  z.string().regex(/^[1-9]\d{0,8}$/, "Número inteiro inválido").transform(Number).pipe(z.number().int().min(1).max(maximo));

const ocupacaoQuery = z.object({ fechadas: inteiroPositivo(FECHADAS_MAXIMO).default(FECHADAS_PADRAO) }).strict();
const historicoQuery = z.object({
  page: inteiroPositivo(1_000_000).default(1),
  pageSize: inteiroPositivo(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
}).strict();
/** Filtros do mapa operacional. Estrito: parâmetro desconhecido é 422, nunca ignorado (descarte calado amplia o recorte). */
const operacionalQuery = z.object({
  retiro_id: z.uuid().optional(),
  grazing_module_id: z.uuid().optional(),
  land_use: z.enum(VALORES_TIPO_DE_USO_DA_AREA).optional(),
  situacao: z.enum(FILTROS_DE_SITUACAO).optional()
}).strict();

function idDaArea(req: FastifyRequest): string {
  const id = String((req.params as { areaId?: string }).areaId ?? "");
  if (!FORMA_UUID.test(id)) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
  return id;
}

// --------------------------------------------------------------------------------------------------
// A conta comum às duas leituras: lotação e descanso de UMA área, sempre pelo domínio
// --------------------------------------------------------------------------------------------------

/** As colunas de `erp.areas` que a lotação lê (numeric chega como string). */
type ReferenciasDaArea = {
  usable_area_ha: DecimalString | null;
  support_capacity_rainy_ua_ha: DecimalString | null;
  support_capacity_dry_ua_ha: DecimalString | null;
  max_stocking_ua: DecimalString | null;
};

/**
 * Lotação de uma área com `uaTotal` presente: UA/ha pela área ÚTIL (`usable_area_ha`, nunca `area_ha`), capacidade
 * da estação de hoje e a situação frente às duas referências. A MESMA função serve a ocupação de uma área (4.3) e o
 * mapa operacional (4.4): a regra não é escrita duas vezes.
 */
function lotacaoDaArea(area: ReferenciasDaArea, uaTotal: DecimalString, estacao: EstacaoDoAno) {
  const ua_por_hectare = uaPorHectare(uaTotal, area.usable_area_ha);
  const capacidade_da_estacao = capacidadeDaEstacao(estacao, area.support_capacity_rainy_ua_ha, area.support_capacity_dry_ua_ha);
  const situacao_de_lotacao: SituacaoDeLotacao | null = situacaoDeLotacao({
    uaPorHectare: ua_por_hectare, capacidadeDaEstacaoUaHa: capacidade_da_estacao, uaTotal, maxStockingUa: area.max_stocking_ua
  });
  return { ua_por_hectare, capacidade_da_estacao, situacao_de_lotacao };
}

/** Descanso: nulo se a área está ocupada ou nunca teve saída; senão, dias desde a última saída. */
const descansoDaArea = (ocupada: boolean, ultimaSaida: ISODate | null, hoje: ISODate): number | null =>
  ocupada ? null : diasDeDescanso(ultimaSaida, hoje);

/** Uma ocupação ABERTA lida do banco, com o lote (código e descrição só quando o lote está no escopo). */
type LinhaAberta = {
  id: string; area_id: string; batch_id: string; data_inicio: ISODate; origem_da_data: string;
  cabecas_na_entrada: number | null; ua_na_entrada: DecimalString | null;
  lote_code: string | null; lote_description: string | null;
};

/** O lote presente na área, com cabeças e UA de AGORA (`rebanhoDosLotes`) e os números congelados na entrada. */
function loteAberto(o: LinhaAberta, rebanho: Map<string, RebanhoDoLote>, hoje: ISODate) {
  const atual = rebanho.get(o.batch_id) ?? { cabecas: 0, ua: "0.00" };
  return {
    id: o.id,
    lote: { id: o.batch_id, code: o.lote_code, description: o.lote_description },
    cabecas: atual.cabecas,
    ua: atual.ua,
    cabecas_na_entrada: o.cabecas_na_entrada,
    ua_na_entrada: o.ua_na_entrada,
    data_inicio: o.data_inicio,
    origem_da_data: o.origem_da_data,
    dias_de_ocupacao: diasDeOcupacao(o.data_inicio, null, hoje)
  };
}

const somaUa = (lotes: readonly { ua: DecimalString }[]): DecimalString => sum(lotes.map((l) => l.ua)).toFixed(2);

/** Colunas da ocupação aberta + lote (o lote responde pelo PRÓPRIO escopo; fora dele, código e descrição nulos). */
const COLUNAS_ABERTA = `o.id, o.area_id, o.batch_id, o.data_inicio, o.origem_da_data, o.cabecas_na_entrada, o.ua_na_entrada,
       b.code as lote_code, b.description as lote_description`;
const JOIN_LOTE = `left join erp.batches b on b.id = o.batch_id and b.organization_id = o.organization_id and {{escopo:b.empresa_id}}`;

export default async function mapaOcupacaoRoutes(app: FastifyInstance) {
  /**
   * GET /api/mapa/areas/:areaId/ocupacao[?fechadas=1..50] — a ocupação de UMA área.
   *
   * Devolve: as ocupações ABERTAS (vários lotes podem ocupar a mesma área) com cabeças e UA ATUAIS, os números
   * congelados na entrada, a data de início, a origem dela e os dias de ocupação; as últimas `fechadas` (padrão 5)
   * ocupações fechadas; os dias de descanso desde a última saída (nulo se ocupada ou nunca teve saída); a UA total,
   * a UA/ha pela área útil, as referências, a estação de hoje, a capacidade dela e a situação de lotação (nula = sem
   * referência); e o rodízio realizado × planejado pelo módulo de pastejo da área (nulo sem módulo).
   * Ordem: abertas pela entrada mais recente (`data_inicio desc, id desc`); fechadas pela saída mais recente
   * (`data_fim desc, data_inicio desc, id desc`). A última saída é o máximo de TODO o histórico, não só das devolvidas.
   *
   * Consultas: (1) área + módulo + hoje; (2) abertas e últimas fechadas, com a última saída; (3) rebanho dos lotes
   * abertos, uma só (`rebanhoDosLotes`; nenhuma quando não há lote aberto); (4) o histórico da área, só as datas,
   * para o rodízio (nenhuma sem módulo). Nada depende de quantos lotes ou ocupações a área tem.
   *
   * Recusa: 404 igual para inexistente, outra organização, fora do escopo, excluída e id malformado; 403 sem a
   * capacidade; 422 para parâmetro desconhecido ou fora da forma.
   */
  app.get("/mapa/areas/:areaId/ocupacao", async (req) => runService(app, req, PERMISSAO, async (ctx) => {
    const areaId = idDaArea(req);
    const q = ocupacaoQuery.parse(req.query);

    const ra = await consultaEscopada<ReferenciasDaArea & {
      id: string; empresa_id: string; code: string; name: string; area_ha: DecimalString; land_use: string; status: string;
      retiro_id: string | null; grazing_module_id: string | null;
      modulo_visivel: boolean; rest_days: number | null; occupation_days: number | null; hoje: ISODate;
    }>(ctx,
      `select a.id, a.empresa_id, a.code, a.name, a.area_ha, a.usable_area_ha, a.land_use, a.status, a.retiro_id, a.grazing_module_id,
              a.support_capacity_rainy_ua_ha, a.support_capacity_dry_ua_ha, a.max_stocking_ua,
              (g.id is not null) as modulo_visivel, g.rest_days, g.occupation_days,
              current_date::text as hoje
         from erp.areas a
         left join erp.grazing_modules g on g.id = a.grazing_module_id and g.organization_id = a.organization_id
              and g.deleted_at is null and {{escopo:g.empresa_id}}
        where a.id = $2 and a.organization_id = $1 and a.deleted_at is null and {{escopo:a.empresa_id}}`,
      [ctx.orgId, areaId]);
    const area = ra.rows[0];
    if (!area) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
    const hoje = area.hoje;

    // Abertas e as últimas N fechadas numa consulta; a última saída é o máximo de TODO o histórico (janela sobre todas).
    const ro = await consultaEscopada<LinhaAberta & {
      data_fim: ISODate | null; motivo_saida: string | null; ultima_saida: ISODate | null;
    }>(ctx,
      `with ocupacoes as (
         select o.*,
                row_number() over (partition by o.data_fim is null order by o.data_fim desc nulls first, o.data_inicio desc, o.id desc) as ordem,
                max(o.data_fim) over () as ultima_saida
           from erp.ocupacoes_de_area o
          where o.organization_id = $1 and o.area_id = $2 and o.deleted_at is null and {{escopo:o.empresa_id}}
       )
       select ${COLUNAS_ABERTA}, o.data_fim, o.motivo_saida, o.ultima_saida
         from ocupacoes o
         ${JOIN_LOTE}
        where o.data_fim is null or o.ordem <= $3
        order by o.data_fim is not null, o.data_fim desc, o.data_inicio desc, o.id desc`,
      [ctx.orgId, areaId, q.fechadas]);
    const linhasAbertas = ro.rows.filter((o) => o.data_fim === null);
    const linhasFechadas = ro.rows.filter((o) => o.data_fim !== null);
    const ultimaSaida = ro.rows[0]?.ultima_saida ?? null;

    const rebanho = await rebanhoDosLotes(ctx, linhasAbertas.map((o) => o.batch_id));
    const abertas = linhasAbertas.map((o) => loteAberto(o, rebanho, hoje));
    const ua_total = somaUa(abertas);
    const estacao = estacaoDoAno(hoje);

    // O rodízio lê o histórico INTEIRO da área, só as datas (o que a conta precisa), numa consulta; sem módulo, nenhuma.
    let rodizio: RodizioRealizadoVersusPlanejado | null = null;
    if (area.modulo_visivel) {
      const rh = await consultaEscopada<{ data_inicio: ISODate; data_fim: ISODate | null }>(ctx,
        `select o.data_inicio, o.data_fim
           from erp.ocupacoes_de_area o
          where o.organization_id = $1 and o.area_id = $2 and o.deleted_at is null and {{escopo:o.empresa_id}}
          order by o.data_inicio, o.data_fim nulls last`,
        [ctx.orgId, areaId]);
      rodizio = rodizioRealizadoVersusPlanejado(rh.rows.map((p) => ({ dataInicio: p.data_inicio, dataFim: p.data_fim })),
        area.rest_days, area.occupation_days, hoje);
    }

    return {
      hoje,
      area: {
        id: area.id, empresa_id: area.empresa_id, code: area.code, name: area.name, area_ha: area.area_ha, usable_area_ha: area.usable_area_ha,
        land_use: area.land_use, status: area.status, retiro_id: area.retiro_id, grazing_module_id: area.grazing_module_id,
        support_capacity_rainy_ua_ha: area.support_capacity_rainy_ua_ha, support_capacity_dry_ua_ha: area.support_capacity_dry_ua_ha,
        max_stocking_ua: area.max_stocking_ua
      },
      abertas,
      fechadas: linhasFechadas.map((o) => ({
        id: o.id,
        lote: { id: o.batch_id, code: o.lote_code, description: o.lote_description },
        data_inicio: o.data_inicio,
        data_fim: o.data_fim,
        origem_da_data: o.origem_da_data,
        motivo_saida: o.motivo_saida,
        dias_de_ocupacao: diasDeOcupacao(o.data_inicio, o.data_fim, hoje)
      })),
      ultima_saida: ultimaSaida,
      dias_de_descanso: descansoDaArea(abertas.length > 0, ultimaSaida, hoje),
      cabecas_total: abertas.reduce((s, l) => s + l.cabecas, 0),
      ua_total,
      estacao,
      ...lotacaoDaArea(area, ua_total, estacao),
      rodizio
    };
  }));

  /**
   * GET /api/mapa/areas/:areaId/ocupacao/historico[?page&pageSize] — todas as ocupações da área (abertas e fechadas),
   * paginadas NO SERVIDOR, em ordem `data_inicio desc, id desc`. `total` é o total da área no escopo.
   *
   * Consultas: (1) área + total + hoje; (2) a página. Mesma recusa da leitura da ocupação.
   */
  app.get("/mapa/areas/:areaId/ocupacao/historico", async (req) => runService(app, req, PERMISSAO, async (ctx) => {
    const areaId = idDaArea(req);
    const q = historicoQuery.parse(req.query);
    const ra = await consultaEscopada<{ id: string; total: number; hoje: ISODate }>(ctx,
      `select a.id, current_date::text as hoje,
              (select count(*) from erp.ocupacoes_de_area o
                where o.organization_id = a.organization_id and o.area_id = a.id and o.deleted_at is null
                  and {{escopo:o.empresa_id}})::int as total
         from erp.areas a
        where a.id = $2 and a.organization_id = $1 and a.deleted_at is null and {{escopo:a.empresa_id}}`,
      [ctx.orgId, areaId]);
    const area = ra.rows[0];
    if (!area) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);

    const rp = await consultaEscopada<{
      id: string; batch_id: string; lote_code: string | null; lote_description: string | null;
      data_inicio: ISODate; data_fim: ISODate | null; origem_da_data: string; motivo_saida: string | null;
      cabecas_na_entrada: number | null; ua_na_entrada: DecimalString | null;
      movimento_entrada_id: string | null; movimento_saida_id: string | null; note: string | null;
    }>(ctx,
      `select o.id, o.batch_id, b.code as lote_code, b.description as lote_description, o.data_inicio, o.data_fim, o.origem_da_data,
              o.motivo_saida, o.cabecas_na_entrada, o.ua_na_entrada, o.movimento_entrada_id, o.movimento_saida_id, o.note
         from erp.ocupacoes_de_area o
         ${JOIN_LOTE}
        where o.organization_id = $1 and o.area_id = $2 and o.deleted_at is null and {{escopo:o.empresa_id}}
        order by o.data_inicio desc, o.id desc
        limit $3 offset $4`,
      [ctx.orgId, areaId, q.pageSize, (q.page - 1) * q.pageSize]);

    return {
      items: rp.rows.map((o) => ({
        id: o.id,
        lote: { id: o.batch_id, code: o.lote_code, description: o.lote_description },
        data_inicio: o.data_inicio,
        data_fim: o.data_fim,
        origem_da_data: o.origem_da_data,
        motivo_saida: o.motivo_saida,
        cabecas_na_entrada: o.cabecas_na_entrada,
        ua_na_entrada: o.ua_na_entrada,
        movimento_entrada_id: o.movimento_entrada_id,
        movimento_saida_id: o.movimento_saida_id,
        note: o.note,
        dias_de_ocupacao: diasDeOcupacao(o.data_inicio, o.data_fim, area.hoje)
      })),
      total: area.total,
      page: q.page,
      pageSize: q.pageSize,
      hoje: area.hoje
    };
  }));

  /**
   * GET /api/mapa/operacional[?retiro_id&grazing_module_id&land_use&situacao] — UMA chamada com tudo o que o mapa
   * operacional desenha.
   *
   * ÁREAS no escopo (vivas), cada uma com: as ocupações abertas (lotes com cabeças, UA e dias no piquete), os dias de
   * descanso de quem está vazia, a UA/ha e a situação de lotação (a MESMA regra da leitura da ocupação —
   * `lotacaoDaArea`), e a data do último manejo e da última pesagem registrados NA área (`area_id` do documento).
   *
   * CAPACIDADE × ESCOPO, com AND, em cada bloco:
   * - `objetos`: os objetos de mapa vivos do escopo SÓ para quem tem `map_objects.view`; sem ela, `objetos: []` (a
   *   consulta nem roda). Com filtro, só os objetos das áreas que passaram no filtro; sem filtro, todos os do escopo
   *   (inclusive os fora de área).
   * - `ultimo_manejo`: SÓ com `nutritions.view` (a capacidade de `GET /livestock/handlings`); sem ela, `null`.
   * - `ultima_pesagem`: SÓ com `weighings.view`; sem ela, `null`.
   * `capacidades` diz à tela qual bloco veio — `null` sem capacidade é diferente de `null` sem registro.
   * As quatro permissões são do módulo pecuária, o mesmo da rota: o escopo de empresa de cada tabela é o da área.
   *
   * Filtros: `retiro_id`, `grazing_module_id` e `land_use` no SQL das áreas; `situacao` (dentro | proximo | acima |
   * sem_referencia) depois das agregações, também no servidor. Parâmetro desconhecido ou fora da forma → 422.
   *
   * Consultas, FIXAS (nenhuma por área): (1) áreas + hoje; (2) ocupações abertas; (3) última saída por área;
   * (4) rebanho de todos os lotes abertos (`rebanhoDosLotes`); (5) objetos (só com a capacidade); (6) último manejo e
   * última pesagem por área, agregados juntos (só com alguma das duas capacidades). Sem área, (2)-(4) e (6) não rodam;
   * sem lote aberto, (4) não roda.
   */
  app.get("/mapa/operacional", async (req) => runService(app, req, PERMISSAO, async (ctx) => {
    const f = operacionalQuery.parse(req.query);
    const capacidades = {
      objetos: hasPermission(ctx, PERMISSAO_OBJETOS),
      manejo: hasPermission(ctx, PERMISSAO_MANEJO),
      pesagem: hasPermission(ctx, PERMISSAO_PESAGEM)
    };

    const params: unknown[] = [ctx.orgId];
    const filtros: string[] = [];
    if (f.retiro_id) { params.push(f.retiro_id); filtros.push(`and a.retiro_id = $${params.length}`); }
    if (f.grazing_module_id) { params.push(f.grazing_module_id); filtros.push(`and a.grazing_module_id = $${params.length}`); }
    if (f.land_use) { params.push(f.land_use); filtros.push(`and a.land_use = $${params.length}`); }
    // Uma linha sempre (o dia vem mesmo sem área): a lista de áreas entra pelo left join.
    const ra = await consultaEscopada<ReferenciasDaArea & {
      hoje: ISODate; id: string | null; empresa_id: string; name: string; code: string; color: string | null;
      area_ha: DecimalString; land_use: string; status: string; geometria: unknown;
      retiro_id: string | null; grazing_module_id: string | null;
    }>(ctx,
      `with dia as (select current_date::text as hoje)
       select dia.hoje, a.*
         from dia
         left join (
           select a.id, a.empresa_id, a.name, a.code, a.color, a.area_ha, a.usable_area_ha, a.land_use, a.status, a.geometria,
                  a.retiro_id, a.grazing_module_id, a.support_capacity_rainy_ua_ha, a.support_capacity_dry_ua_ha, a.max_stocking_ua
             from erp.areas a
            where a.organization_id = $1 and a.deleted_at is null and {{escopo:a.empresa_id}}
              ${filtros.join(" ")}
         ) a on true
        order by a.name, a.code, a.id`,
      params);
    const hoje = ra.rows[0]!.hoje;
    const estacao = estacaoDoAno(hoje);
    const linhasArea = ra.rows.filter((a): a is typeof a & { id: string } => a.id !== null);
    const idsDasAreas = linhasArea.map((a) => a.id);

    const abertasPorArea = new Map<string, LinhaAberta[]>();
    const ultimaSaidaPorArea = new Map<string, ISODate>();
    let rebanho = new Map<string, RebanhoDoLote>();
    if (idsDasAreas.length) {
      const ro = await consultaEscopada<LinhaAberta>(ctx,
        `select ${COLUNAS_ABERTA}
           from erp.ocupacoes_de_area o
           ${JOIN_LOTE}
          where o.organization_id = $1 and o.area_id = any($2::uuid[]) and o.data_fim is null and o.deleted_at is null
            and {{escopo:o.empresa_id}}
          order by o.data_inicio desc, o.id desc`,
        [ctx.orgId, idsDasAreas]);
      for (const o of ro.rows) abertasPorArea.set(o.area_id, [...(abertasPorArea.get(o.area_id) ?? []), o]);

      const rs = await consultaEscopada<{ area_id: string; ultima_saida: ISODate }>(ctx,
        `select o.area_id, max(o.data_fim) as ultima_saida
           from erp.ocupacoes_de_area o
          where o.organization_id = $1 and o.area_id = any($2::uuid[]) and o.data_fim is not null and o.deleted_at is null
            and {{escopo:o.empresa_id}}
          group by o.area_id`,
        [ctx.orgId, idsDasAreas]);
      for (const s of rs.rows) ultimaSaidaPorArea.set(s.area_id, s.ultima_saida);

      rebanho = await rebanhoDosLotes(ctx, ro.rows.map((o) => o.batch_id));
    }

    const areas = linhasArea.map((a) => {
      const lotes = (abertasPorArea.get(a.id) ?? []).map((o) => loteAberto(o, rebanho, hoje));
      const ua_total = somaUa(lotes);
      const ultima_saida = ultimaSaidaPorArea.get(a.id) ?? null;
      return {
        id: a.id, empresa_id: a.empresa_id, name: a.name, code: a.code, color: a.color, area_ha: a.area_ha, usable_area_ha: a.usable_area_ha,
        land_use: a.land_use, status: a.status, geometria: a.geometria, retiro_id: a.retiro_id, grazing_module_id: a.grazing_module_id,
        support_capacity_rainy_ua_ha: a.support_capacity_rainy_ua_ha, support_capacity_dry_ua_ha: a.support_capacity_dry_ua_ha,
        max_stocking_ua: a.max_stocking_ua,
        ocupada: lotes.length > 0,
        lotes,
        cabecas_total: lotes.reduce((s, l) => s + l.cabecas, 0),
        ua_total,
        ultima_saida,
        dias_de_descanso: descansoDaArea(lotes.length > 0, ultima_saida, hoje),
        ...lotacaoDaArea(a, ua_total, estacao),
        ultimo_manejo: null as ISODate | null,
        ultima_pesagem: null as ISODate | null
      };
    });

    // A situação é calculada depois das agregações; o recorte continua no servidor, antes de objetos e documentos.
    const naSituacao = (s: SituacaoDeLotacao | null, alvo: FiltroDeSituacao) => (alvo === SEM_REFERENCIA ? s === null : s === alvo);
    const alvo = f.situacao;
    const filtradas = alvo ? areas.filter((a) => naSituacao(a.situacao_de_lotacao, alvo)) : areas;
    const idsFiltrados = filtradas.map((a) => a.id);
    const temFiltro = Boolean(f.retiro_id || f.grazing_module_id || f.land_use || f.situacao);

    let objetos: Record<string, unknown>[] = [];
    if (capacidades.objetos && (!temFiltro || idsFiltrados.length)) {
      const po: unknown[] = [ctx.orgId];
      let recorte = "";
      if (temFiltro) { po.push(idsFiltrados); recorte = `and m.area_id = any($${po.length}::uuid[])`; }
      const rm = await consultaEscopada(ctx,
        `select m.id, m.empresa_id, m.area_id, m.tipo, m.forma, m.geometria, m.code, m.name, m.descricao, m.capacidade,
                m.unidade_capacidade, m.trough_id, m.is_active
           from erp.objetos_de_mapa m
          where m.organization_id = $1 and m.deleted_at is null and {{escopo:m.empresa_id}} ${recorte}
          order by m.name, m.id`,
        po);
      objetos = rm.rows;
    }

    if ((capacidades.manejo || capacidades.pesagem) && idsFiltrados.length) {
      const blocos: string[] = [];
      if (capacidades.manejo) {
        blocos.push(`select 'manejo'::text as tipo, h.area_id, max(h.handling_date) as ultima
                       from erp.animal_handlings h
                      where h.organization_id = $1 and h.area_id = any($2::uuid[]) and h.deleted_at is null and {{escopo:h.empresa_id}}
                      group by h.area_id`);
      }
      if (capacidades.pesagem) {
        blocos.push(`select 'pesagem'::text as tipo, w.area_id, max(w.weighing_date) as ultima
                       from erp.weighings w
                      where w.organization_id = $1 and w.area_id = any($2::uuid[]) and w.deleted_at is null and {{escopo:w.empresa_id}}
                      group by w.area_id`);
      }
      const rd = await consultaEscopada<{ tipo: "manejo" | "pesagem"; area_id: string; ultima: ISODate }>(ctx,
        blocos.join(" union all "), [ctx.orgId, idsFiltrados]);
      const porArea = new Map(filtradas.map((a) => [a.id, a]));
      for (const d of rd.rows) {
        const a = porArea.get(d.area_id);
        if (!a) continue;
        if (d.tipo === "manejo") a.ultimo_manejo = d.ultima;
        else a.ultima_pesagem = d.ultima;
      }
    }

    return { hoje, estacao, capacidades, areas: filtradas, objetos };
  }));
}
