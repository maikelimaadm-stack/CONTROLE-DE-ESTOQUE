/**
 * LEITURA DA OBSERVAÇÃO SATELITAL COMPLETA — SAT-BUNDLE-01A.
 *
 * Agrega as seis linhas do bundle + produtos espaciais existentes (sem gerar).
 * NDVI é âncora técnica de localização; o contrato não finge que o bundle “é NDVI”.
 */
import {
  INDICES_BUNDLE_ESSENCIAL, RESOLUCAO_AGREGACAO_PASTAGEM_M, VERSAO_METODO_PASTAGEM_ESSENCIAL,
  TEMAS_VISUALIZACAO_SATELITE, SUBPRODUTOS_COBERTURA_SOLO, LIMIARES_UMIDADE_PASTO_EXPERIMENTAL,
  AVISO_UMIDADE_NAO_E_SOLO, AVISO_CONDICAO_PASTO_EXPERIMENTAL,
  VERSAO_CLASSIFICADOR_CONDICAO_PASTO, VERSAO_EVALSCRIPT_CONDICAO_PASTO,
  CHAVE_MAPA_CONDICAO_PASTO,
  bundleIndicesCompleto, classificarUmidadePastoNdmi, identidadeDoBundle,
  produtoCondicaoIndisponivel, produtoRasterIndisponivel, statusBundleDe,
  type IdIndiceSatelite, type ObservacaoSatelitalCompleta, type ProdutoMapaCondicao,
  type ProdutoRasterIndice, type SinalIndiceObservacao
} from "@agro/domain";
import { empresaScopeSql, type ServiceCtx } from "../context.js";

interface LinhaAnaliseBundle {
  id: string;
  organization_id: string;
  empresa_id: string;
  area_id: string;
  indice: IdIndiceSatelite;
  geometria_sha256: string;
  versao_metodo: string;
  colecao: string;
  provedor: string;
  observacao_inicio: Date;
  observacao_fim: Date;
  valor_medio: string | null;
  valor_minimo: string | null;
  valor_maximo: string | null;
  desvio_padrao: string | null;
  cobertura_valida: string | null;
  pixels_validos: number | null;
  resolucao_nativa_m: number | null;
  percentis: unknown | null;
  histograma: unknown | null;
}

interface LinhaRasterRef {
  id: string; indice: IdIndiceSatelite; analise_id: string; data_imagem: string;
  resolucao_m: number; versao_evalscript: string;
}

interface LinhaMapaRef {
  id: string; data_imagem: string; resolucao_m: number; versao_classificador: string; resumo: unknown;
}

function numOrNull(s: string | null): number | null {
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function lerLinhasBundle(
  ctx: ServiceCtx, areaId: string, dataImagem?: string
): Promise<LinhaAnaliseBundle[]> {
  const params: unknown[] = [ctx.orgId, areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL];
  const escopoA = empresaScopeSql(ctx, "a", params);
  let filtroData = "";
  if (dataImagem) {
    params.push(dataImagem);
    filtroData = ` and (s.observacao_inicio at time zone 'UTC')::date = $${params.length}::date`;
  }
  // Localiza observação pelo conjunto (preferência: âncora NDVI no contorno atual).
  const ancora = await ctx.tx.query<{ observacao_inicio: Date; observacao_fim: Date; geometria_sha256: string }>(
    `select s.observacao_inicio, s.observacao_fim, s.geometria_sha256
       from erp.analises_satelitais s
       join erp.areas a on a.organization_id = s.organization_id and a.id = s.area_id and a.deleted_at is null
      where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3
        and s.indice = 'ndvi' and s.situacao = 'concluida'
        and s.observacao_inicio is not null and s.observacao_fim is not null
        and s.geometria_sha256 = encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex')
        ${filtroData}${escopoA}
      order by s.observacao_inicio desc, s.created_at desc, s.id desc
      limit 1`, params);
  const ref = ancora.rows[0];
  if (!ref) return [];

  const paramsI: unknown[] = [
    ctx.orgId, areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL,
    ref.observacao_inicio, ref.observacao_fim, ref.geometria_sha256,
    INDICES_BUNDLE_ESSENCIAL as unknown as string[]
  ];
  const escopo = empresaScopeSql(ctx, "s", paramsI);
  const r = await ctx.tx.query<LinhaAnaliseBundle>(
    `select s.id, s.organization_id, s.empresa_id, s.area_id, s.indice, s.geometria_sha256, s.versao_metodo,
            s.colecao, s.provedor, s.observacao_inicio, s.observacao_fim,
            s.valor_medio::text, s.valor_minimo::text, s.valor_maximo::text, s.desvio_padrao::text,
            s.cobertura_valida::text, s.pixels_validos, s.resolucao_nativa_m,
            e.percentis, e.histograma
       from erp.analises_satelitais s
       left join erp.analises_satelitais_ext e
         on e.analise_id = s.id and e.organization_id = s.organization_id
      where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3
        and s.situacao = 'concluida'
        and s.observacao_inicio = $4 and s.observacao_fim = $5
        and s.geometria_sha256 = $6
        and s.indice = any($7::text[])${escopo}`, paramsI);
  return r.rows;
}

async function lerRastersDos(
  ctx: ServiceCtx, analiseIds: string[]
): Promise<LinhaRasterRef[]> {
  if (analiseIds.length === 0) return [];
  const params: unknown[] = [ctx.orgId, analiseIds];
  const escopo = empresaScopeSql(ctx, "r", params);
  const r = await ctx.tx.query<LinhaRasterRef>(
    `select r.id, r.indice, r.analise_id, r.data_imagem::text, r.resolucao_m, r.versao_evalscript
       from erp.satelite_rasters r
      where r.organization_id = $1 and r.analise_id = any($2::uuid[])${escopo}`, params);
  return r.rows;
}

async function lerMapaCondicao(
  ctx: ServiceCtx, areaId: string, geometriaSha256: string, dataImagem: string
): Promise<LinhaMapaRef | null> {
  const params: unknown[] = [
    ctx.orgId, areaId, geometriaSha256, dataImagem,
    CHAVE_MAPA_CONDICAO_PASTO, VERSAO_CLASSIFICADOR_CONDICAO_PASTO, VERSAO_EVALSCRIPT_CONDICAO_PASTO
  ];
  const escopo = empresaScopeSql(ctx, "m", params);
  const r = await ctx.tx.query<LinhaMapaRef>(
    `select m.id, m.data_imagem::text, m.resolucao_m, m.versao_classificador, m.resumo
       from erp.satelite_mapas_condicao m
      where m.organization_id = $1 and m.area_id = $2 and m.geometria_sha256 = $3
        and m.data_imagem = $4::date and m.mapa = $5
        and m.versao_classificador = $6 and m.versao_evalscript = $7${escopo}
      order by m.created_at desc
      limit 1`, params);
  return r.rows[0] ?? null;
}

function montarIndices(
  linhas: LinhaAnaliseBundle[]
): Record<IdIndiceSatelite, SinalIndiceObservacao | null> {
  const out = Object.fromEntries(INDICES_BUNDLE_ESSENCIAL.map((i) => [i, null])) as Record<
    IdIndiceSatelite, SinalIndiceObservacao | null
  >;
  for (const l of linhas) {
    out[l.indice] = {
      indice: l.indice,
      analise_id: l.id,
      media: l.valor_medio,
      minimo: l.valor_minimo,
      maximo: l.valor_maximo,
      desvio_padrao: l.desvio_padrao,
      cobertura_valida: l.cobertura_valida,
      pixels_validos: l.pixels_validos,
      resolucao_nativa_m: l.resolucao_nativa_m,
      percentis: l.percentis,
      histograma: l.histograma
    };
  }
  return out;
}

function indiceLimitante(
  indices: Record<IdIndiceSatelite, SinalIndiceObservacao | null>
): { cobertura: string | null; indice: IdIndiceSatelite | null } {
  let pior: IdIndiceSatelite | null = null;
  let piorVal = Infinity;
  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    const s = indices[id];
    if (!s?.cobertura_valida) continue;
    const v = Number(s.cobertura_valida);
    if (Number.isFinite(v) && v < piorVal) {
      piorVal = v;
      pior = id;
    }
  }
  return {
    cobertura: pior !== null && Number.isFinite(piorVal) ? piorVal.toFixed(4) : null,
    indice: pior
  };
}

/**
 * Monta `ObservacaoSatelitalCompleta` ou null se não há observação no contorno atual
 * (com data específica: null sem fallback).
 */
export async function lerObservacaoSatelitalCompleta(
  ctx: ServiceCtx, areaId: string, dataImagem?: string
): Promise<ObservacaoSatelitalCompleta | null> {
  const linhas = await lerLinhasBundle(ctx, areaId, dataImagem);
  if (linhas.length === 0) return null;

  const identidade = identidadeDoBundle(linhas.map((l) => ({
    indice: l.indice,
    organization_id: l.organization_id,
    empresa_id: l.empresa_id,
    area_id: l.area_id,
    geometria_sha256: l.geometria_sha256,
    versao_metodo: l.versao_metodo,
    observacao_inicio: l.observacao_inicio,
    observacao_fim: l.observacao_fim,
    colecao: l.colecao,
    provedor: l.provedor
  })));

  const indices = montarIndices(linhas);
  const indicesOk = bundleIndicesCompleto(indices);
  const analiseIds = linhas.map((l) => l.id);
  const rastersDb = await lerRastersDos(ctx, analiseIds);
  const porAnalise = new Map(rastersDb.map((r) => [r.analise_id, r]));

  const rasters = {} as Record<IdIndiceSatelite, ProdutoRasterIndice>;
  let rastersOk = 0;
  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    const sinal = indices[id];
    const r = sinal ? porAnalise.get(sinal.analise_id) : undefined;
    if (r) {
      rastersOk += 1;
      rasters[id] = {
        indice: id, status: "pronto", disponivel: true,
        raster_id: r.id, data_imagem: r.data_imagem,
        resolucao_m: r.resolucao_m, versao_encoding: r.versao_evalscript
      };
    } else {
      rasters[id] = produtoRasterIndisponivel(id);
    }
  }

  let condicao: ProdutoMapaCondicao = produtoCondicaoIndisponivel();
  if (identidade) {
    const mapa = await lerMapaCondicao(ctx, areaId, identidade.geometria_sha256, identidade.data_imagem);
    if (mapa) {
      condicao = {
        status: "pronto", disponivel: true, mapa_id: mapa.id,
        data_imagem: mapa.data_imagem, resolucao_m: mapa.resolucao_m,
        versao_classificador: mapa.versao_classificador, resumo: mapa.resumo
      };
    }
  }

  const limitante = indiceLimitante(indices);
  const status = statusBundleDe({
    identidade,
    indicesCompletos: indicesOk,
    condicaoDisponivel: condicao.disponivel,
    rastersDisponiveis: rastersOk
  });
  const visualPronto = status === "completo";

  const ndmi = indices.ndmi?.media ?? null;
  const avisos = [
    AVISO_CONDICAO_PASTO_EXPERIMENTAL,
    AVISO_UMIDADE_NAO_E_SOLO,
    "Trocar tema de visualização não cria nova consulta Statistical."
  ];
  if (!visualPronto) {
    avisos.push("Produtos espaciais incompletos — a observação Statistical permanece válida; reparo gera só os faltantes (1 Process).");
  }

  // Identidade sintética fail-closed quando as linhas existem mas não fecham o bundle.
  const idFinal = identidade ?? {
    organization_id: linhas[0]!.organization_id,
    empresa_id: linhas[0]!.empresa_id,
    area_id: areaId,
    geometria_sha256: linhas[0]!.geometria_sha256,
    versao_metodo: linhas[0]!.versao_metodo,
    observacao_inicio: linhas[0]!.observacao_inicio.toISOString(),
    observacao_fim: linhas[0]!.observacao_fim.toISOString(),
    data_imagem: linhas[0]!.observacao_inicio.toISOString().slice(0, 10),
    colecao: linhas[0]!.colecao,
    provedor: linhas[0]!.provedor
  };

  return {
    identidade: idFinal,
    resolucao_analitica_m: RESOLUCAO_AGREGACAO_PASTAGEM_M,
    cobertura_valida_bundle: limitante.cobertura,
    indice_limitante_qualidade: limitante.indice,
    indices,
    temas: TEMAS_VISUALIZACAO_SATELITE,
    produtos: { condicao, rasters },
    status_bundle: status,
    visual_pronto: visualPronto,
    avisos,
    umidade_pasto: {
      classe: classificarUmidadePastoNdmi(numOrNull(ndmi)),
      ndmi_medio: ndmi,
      experimental: true,
      versao: LIMIARES_UMIDADE_PASTO_EXPERIMENTAL.versao
    },
    vigor: {
      sinal_espacial_primario: "ndre",
      ndre_medio: indices.ndre?.media ?? null,
      evi2_medio: indices.evi2?.media ?? null,
      ndvi_medio: indices.ndvi?.media ?? null
    },
    cobertura_solo: {
      ...SUBPRODUTOS_COBERTURA_SOLO,
      msavi2_medio: indices.msavi2?.media ?? null,
      bsi_medio: indices.bsi?.media ?? null
    }
  };
}

/** Resumo leve para bulk — sem geometria, sem PNG. */
export interface ResumoObservacaoCompleta {
  area_id: string;
  data_imagem: string | null;
  status_bundle: ObservacaoSatelitalCompleta["status_bundle"] | "sem_observacao";
  cobertura_valida_bundle: string | null;
  visual_pronto: boolean;
  condicao_disponivel: boolean;
  rasters_disponiveis: number;
  medias: Partial<Record<IdIndiceSatelite, string | null>>;
  condicao_resumo: unknown | null;
}

/**
 * Bulk server-side: âncoras + irmãos + rasters + mapas em consultas em lote (sem N×6 HTTP).
 */
export async function lerResumosObservacoesCompletas(
  ctx: ServiceCtx,
  areaIds: string[],
  opts: { dataImagem?: string; pagina: number; tamanho: number }
): Promise<{ itens: ResumoObservacaoCompleta[]; tem_mais: boolean }> {
  const offset = (opts.pagina - 1) * opts.tamanho;
  const paginaIds = areaIds.slice(offset, offset + opts.tamanho + 1);
  const ids = paginaIds.slice(0, opts.tamanho);
  if (ids.length === 0) return { itens: [], tem_mais: false };

  const paramsA: unknown[] = [ctx.orgId, ids, VERSAO_METODO_PASTAGEM_ESSENCIAL];
  const escopoA = empresaScopeSql(ctx, "a", paramsA);
  let filtroData = "";
  if (opts.dataImagem) {
    paramsA.push(opts.dataImagem);
    filtroData = ` and (s.observacao_inicio at time zone 'UTC')::date = $${paramsA.length}::date`;
  }
  // Uma âncora NDVI por área (contorno atual).
  const ancoras = await ctx.tx.query<{
    area_id: string; observacao_inicio: Date; observacao_fim: Date; geometria_sha256: string;
  }>(
    `select distinct on (a.id) a.id as area_id, s.observacao_inicio, s.observacao_fim, s.geometria_sha256
       from erp.areas a
       join erp.analises_satelitais s
         on s.organization_id = a.organization_id and s.area_id = a.id
        and s.versao_metodo = $3 and s.indice = 'ndvi' and s.situacao = 'concluida'
        and s.observacao_inicio is not null and s.observacao_fim is not null
        and s.geometria_sha256 = encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex')
        ${filtroData}
      where a.organization_id = $1 and a.id = any($2::uuid[]) and a.deleted_at is null${escopoA}
      order by a.id, s.observacao_inicio desc, s.created_at desc, s.id desc`, paramsA);
  const porArea = new Map(ancoras.rows.map((r) => [r.area_id, r]));

  const paramsI: unknown[] = [ctx.orgId, ids, VERSAO_METODO_PASTAGEM_ESSENCIAL, INDICES_BUNDLE_ESSENCIAL as unknown as string[]];
  const escopoS = empresaScopeSql(ctx, "s", paramsI);
  const irmaos = await ctx.tx.query<{
    area_id: string; id: string; indice: IdIndiceSatelite; valor_medio: string | null; cobertura_valida: string | null;
    observacao_inicio: Date; observacao_fim: Date; geometria_sha256: string;
    organization_id: string; empresa_id: string; versao_metodo: string; colecao: string; provedor: string;
  }>(
    `select s.area_id, s.id, s.indice, s.valor_medio::text, s.cobertura_valida::text,
            s.observacao_inicio, s.observacao_fim, s.geometria_sha256,
            s.organization_id, s.empresa_id, s.versao_metodo, s.colecao, s.provedor
       from erp.analises_satelitais s
      where s.organization_id = $1 and s.area_id = any($2::uuid[])
        and s.versao_metodo = $3 and s.situacao = 'concluida'
        and s.indice = any($4::text[])${escopoS}`, paramsI);

  const irmaosPorArea = new Map<string, typeof irmaos.rows>();
  for (const l of irmaos.rows) {
    const ancora = porArea.get(l.area_id);
    if (!ancora) continue;
    if (
      l.observacao_inicio.getTime() !== ancora.observacao_inicio.getTime()
      || l.observacao_fim.getTime() !== ancora.observacao_fim.getTime()
      || l.geometria_sha256 !== ancora.geometria_sha256
    ) continue;
    const arr = irmaosPorArea.get(l.area_id) ?? [];
    arr.push(l);
    irmaosPorArea.set(l.area_id, arr);
  }

  const analiseIds = [...irmaosPorArea.values()].flat().map((l) => l.id);
  const paramsR: unknown[] = [ctx.orgId, analiseIds.length ? analiseIds : ["00000000-0000-4000-8000-000000000000"]];
  const escopoR = empresaScopeSql(ctx, "r", paramsR);
  const rasters = analiseIds.length === 0 ? { rows: [] as { analise_id: string }[] }
    : await ctx.tx.query<{ analise_id: string }>(
      `select r.analise_id from erp.satelite_rasters r
        where r.organization_id = $1 and r.analise_id = any($2::uuid[])${escopoR}`, paramsR);
  const rastersSet = new Set(rasters.rows.map((r) => r.analise_id));

  const paramsM: unknown[] = [
    ctx.orgId, ids, CHAVE_MAPA_CONDICAO_PASTO,
    VERSAO_CLASSIFICADOR_CONDICAO_PASTO, VERSAO_EVALSCRIPT_CONDICAO_PASTO
  ];
  const escopoM = empresaScopeSql(ctx, "m", paramsM);
  const mapas = await ctx.tx.query<{ area_id: string; data_imagem: string; resumo: unknown; geometria_sha256: string }>(
    `select m.area_id, m.data_imagem::text, m.resumo, m.geometria_sha256
       from erp.satelite_mapas_condicao m
      where m.organization_id = $1 and m.area_id = any($2::uuid[])
        and m.mapa = $3 and m.versao_classificador = $4 and m.versao_evalscript = $5${escopoM}`, paramsM);

  const itens: ResumoObservacaoCompleta[] = [];
  for (const areaId of ids) {
    const ancora = porArea.get(areaId);
    const linhas = irmaosPorArea.get(areaId) ?? [];
    if (!ancora || linhas.length === 0) {
      itens.push({
        area_id: areaId, data_imagem: opts.dataImagem ?? null, status_bundle: "sem_observacao",
        cobertura_valida_bundle: null, visual_pronto: false, condicao_disponivel: false,
        rasters_disponiveis: 0, medias: {}, condicao_resumo: null
      });
      continue;
    }
    const identidade = identidadeDoBundle(linhas);
    const medias: Partial<Record<IdIndiceSatelite, string | null>> = {};
    let pior: string | null = null;
    let piorVal = Infinity;
    let rastersOk = 0;
    const porIndice = new Set<IdIndiceSatelite>();
    for (const l of linhas) {
      porIndice.add(l.indice);
      medias[l.indice] = l.valor_medio;
      if (l.cobertura_valida !== null) {
        const v = Number(l.cobertura_valida);
        if (Number.isFinite(v) && v < piorVal) { piorVal = v; pior = l.cobertura_valida; }
      }
      if (rastersSet.has(l.id)) rastersOk += 1;
    }
    const data = ancora.observacao_inicio.toISOString().slice(0, 10);
    const mapa = mapas.rows.find((m) => m.area_id === areaId && m.data_imagem === data && m.geometria_sha256 === ancora.geometria_sha256);
    const status = statusBundleDe({
      identidade,
      indicesCompletos: INDICES_BUNDLE_ESSENCIAL.every((i) => porIndice.has(i)),
      condicaoDisponivel: !!mapa,
      rastersDisponiveis: rastersOk
    });
    itens.push({
      area_id: areaId,
      data_imagem: data,
      status_bundle: status,
      cobertura_valida_bundle: pior !== null && Number.isFinite(piorVal) ? piorVal.toFixed(4) : null,
      visual_pronto: status === "completo",
      condicao_disponivel: !!mapa,
      rasters_disponiveis: rastersOk,
      medias,
      condicao_resumo: mapa?.resumo ?? null
    });
  }
  return { itens, tem_mais: paginaIds.length > opts.tamanho };
}
