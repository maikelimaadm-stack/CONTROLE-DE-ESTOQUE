/**
 * MATERIALIZAÇÃO MULTI-OUTPUT DA OBSERVAÇÃO COMPLETA — SAT-BUNDLE-01C.
 *
 * Frio: 1 Process TAR → condição v3 + até 6 rasters (grade comum 20 m).
 * Cache: consulta faltantes; se 0 → zero Process; se N → UMA Process só com os N.
 * Persistência nas tabelas atuais. Consumo Process = 1 por request.
 * Sem transação DB durante HTTP. Escrita parcial após 2xx: consumo fica; faltantes
 * restantes impedem fechamento completo.
 */
import { createHash } from "node:crypto";
import { withTx, type Db } from "@agro/db";
import {
  aplicarMascaraPoligonoNosPixels, CHAVE_MAPA_CONDICAO_PASTO, COLECAO_SENTINEL2_L2A,
  contarPixelsCondicaoComMascara, encodingRasterDe, INDICES_BUNDLE_ESSENCIAL,
  resumirCondicaoPasto, TIPO_MAPA_CONDICAO_PASTO, VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
  VERSAO_EVALSCRIPT_CONDICAO_PASTO, VERSAO_METODO_PASTAGEM_ESSENCIAL,
  type IdIndiceSatelite, type StatusProdutoEspacial
} from "@agro/domain";
import { empresaScopeSql, hasPermission, scopedById, type ServiceCtx } from "../context.js";
import { DomainError, err, validation } from "../errors.js";
import {
  MSG_ANALISE_DESLIGADA, MSG_AREA_NAO_ENCONTRADA, MSG_LIMITE_ANALISES, MSG_LIMITE_PROVEDOR,
  MSG_POLIGONO_FORA_DO_FORMATO, PERMISSAO_PEDIR_ANALISE
} from "../../routes/analises-satelitais.js";
import { MSG_ARMAZENAMENTO_FALHOU, MSG_PROVEDOR_INDISPONIVEL_RASTER } from "../../routes/rasters-satelitais.js";
import { armazenamentoMapaCondicao } from "./armazenamento-mapa-condicao.js";
import type { ArmazenamentoRaster } from "./armazenamento-raster.js";
import { caminhoDoRaster } from "./armazenamento-raster.js";
import { FalhaCopernicus, camposLogErroProvedor, type ClienteCopernicus, type RegistroChamada } from "./copernicus.js";
import { gravarConsumo } from "./consumo.js";
import { MODULO_EXECUTOR, contextoDoCriador } from "./contexto-worker.js";
import {
  IDS_OUTPUT_BUNDLE_ESPACIAL, RESOLUCAO_BUNDLE_ESPACIAL_M,
  indiceDoOutput, montarCorpoProcessoBundleEspacial,
  type IdOutputBundleEspacial
} from "./evalscript-bundle-espacial.js";
import type { IdentidadeObservacaoMapa, LogMapaCondicao } from "./gerar-mapa-condicao.js";
import { lerPoligono, type PoligonoGeoJson } from "./geometria.js";
import type { LimiteAvulsoSatelite } from "./limite-avulso.js";
import { lerContagemChamadas } from "./limite-global.js";
import { mascaraPoligonoNaGrade } from "./mascara-poligono-raster.js";
import { escreverPngCinza8, lerPngCinza8 } from "./png.js";
import {
  CRS_RASTER, FORMATO_RASTER, TIPO_RASTER, chaveCacheRaster, dataImagemUtc,
  planejarGradeRaster, type GradeRaster
} from "./raster.js";
import {
  caminhoDoMapaCondicao, chaveCacheCondicaoPasto, planejarGradeCondicao
} from "./raster-condicao-pasto.js";
import { FalhaTarProcesso, extrairPngsDoTarProcesso } from "./tar-processo.js";

const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export type StatusProdutoMaterializado = StatusProdutoEspacial | "reparado";

export interface ResultadoProdutoMaterializado {
  id: IdOutputBundleEspacial;
  status: StatusProdutoMaterializado;
  recurso_id: string | null;
  erro?: string;
}

export interface ResultadoMaterializacaoObservacao {
  area_id: string;
  data_imagem: string | null;
  produtos: ResultadoProdutoMaterializado[];
  chamadas_process: number;
  outputs_solicitados: IdOutputBundleEspacial[];
  outputs_reutilizados: IdOutputBundleEspacial[];
  /** Todos os 7 obrigatórios presentes após a operação. */
  completo: boolean;
  pu_cabecalho: string | null;
}

export interface DependenciasMaterializar {
  db: Db;
  cliente: ClienteCopernicus;
  limiteAvulso: LimiteAvulsoSatelite;
  log: LogMapaCondicao;
  copernicusEnabled: boolean;
  armazenamento: ArmazenamentoRaster;
}

export interface PedidoMaterializar {
  orgId: string;
  userId: string;
  areaId: string;
  identidade?: IdentidadeObservacaoMapa;
  analiseIdReferencia?: string;
  dataImagem?: string;
  consultaId?: string | null;
  consultaItemId?: string | null;
}

interface AnaliseIrma {
  id: string;
  indice: IdIndiceSatelite;
  observacao_inicio: Date;
  observacao_fim: Date;
  geometria_sha256: string;
  empresa_id: string;
}

interface AreaLinha {
  id: string; empresa_id: string; geometria: unknown; geometria_sha256: string | null; area_ha: string | null;
}

function codigoErro(e: unknown): string {
  if (e instanceof DomainError) return e.code;
  if (e instanceof FalhaTarProcesso) return e.motivo;
  if (e instanceof FalhaCopernicus) return e.tipo;
  if (e instanceof Error) return e.name;
  return typeof e;
}

async function comCtx<T>(dep: DependenciasMaterializar, p: PedidoMaterializar, fn: (ctx: ServiceCtx) => Promise<T>): Promise<T> {
  return withTx(dep.db, { orgId: p.orgId, userId: p.userId, modulo: MODULO_EXECUTOR }, async (tx) => {
    const ctx = await contextoDoCriador(tx, p.orgId, p.userId);
    if (!ctx) throw err("PERMISSION_DENIED", "Sem permissão");
    if (!hasPermission(ctx, PERMISSAO_PEDIR_ANALISE)) {
      throw err("PERMISSION_DENIED", `Sem permissão: ${PERMISSAO_PEDIR_ANALISE}`);
    }
    return fn(ctx);
  });
}

async function lerArea(ctx: ServiceCtx, areaId: string): Promise<AreaLinha> {
  const sc = scopedById(ctx, "a", areaId);
  const r = await ctx.tx.query<AreaLinha>(
    `select a.id, a.empresa_id, a.geometria, a.area_ha::text,
            case when a.geometria is null then null else encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex') end as geometria_sha256
       from erp.areas a
      where a.id = $1 and a.organization_id = $2 and a.deleted_at is null${sc.sql}`, sc.params);
  if (!r.rows[0]) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
  return r.rows[0];
}

async function resolverIdentidadeEAnalises(
  dep: DependenciasMaterializar, p: PedidoMaterializar
): Promise<{ identidade: IdentidadeObservacaoMapa; analises: AnaliseIrma[]; dataImagem: string } | null> {
  return comCtx(dep, p, async (ctx) => {
    let identidade = p.identidade;
    if (!identidade && p.analiseIdReferencia) {
      const params: unknown[] = [ctx.orgId, p.analiseIdReferencia, p.areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL];
      const escopo = empresaScopeSql(ctx, "s", params);
      const r = await ctx.tx.query<{ observacao_inicio: Date; observacao_fim: Date; geometria_sha256: string }>(
        `select s.observacao_inicio, s.observacao_fim, s.geometria_sha256
           from erp.analises_satelitais s
          where s.organization_id = $1 and s.id = $2 and s.area_id = $3
            and s.versao_metodo = $4 and s.situacao = 'concluida'
            and s.observacao_inicio is not null and s.observacao_fim is not null${escopo}
          limit 1`, params);
      const row = r.rows[0];
      if (row) {
        identidade = {
          observacaoInicio: row.observacao_inicio,
          observacaoFim: row.observacao_fim,
          geometriaSha256: row.geometria_sha256
        };
      }
    }
    const params: unknown[] = [ctx.orgId, p.areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL];
    const escopoArea = empresaScopeSql(ctx, "a", params);
    let filtro = "";
    if (identidade) {
      params.push(identidade.observacaoInicio, identidade.observacaoFim, identidade.geometriaSha256);
      filtro = ` and s.observacao_inicio = $${params.length - 2}
        and s.observacao_fim = $${params.length - 1}
        and s.geometria_sha256 = $${params.length}`;
    } else if (p.dataImagem) {
      params.push(p.dataImagem);
      filtro = ` and (s.observacao_inicio at time zone 'UTC')::date = $${params.length}::date`;
    }
    const ancora = await ctx.tx.query<{ observacao_inicio: Date; observacao_fim: Date; geometria_sha256: string }>(
      `select s.observacao_inicio, s.observacao_fim, s.geometria_sha256
         from erp.analises_satelitais s
         join erp.areas a on a.organization_id = s.organization_id and a.id = s.area_id and a.deleted_at is null
        where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3
          and s.indice = 'ndvi' and s.situacao = 'concluida'
          and s.observacao_inicio is not null and s.observacao_fim is not null
          and s.geometria_sha256 = encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex')
          ${filtro}${escopoArea}
        order by s.observacao_inicio desc, s.created_at desc, s.id desc
        limit 1`, params);
    const ref = ancora.rows[0];
    if (!ref) return null;
    const idEfetiva: IdentidadeObservacaoMapa = identidade ?? {
      observacaoInicio: ref.observacao_inicio,
      observacaoFim: ref.observacao_fim,
      geometriaSha256: ref.geometria_sha256
    };
    const paramsI: unknown[] = [
      ctx.orgId, p.areaId, VERSAO_METODO_PASTAGEM_ESSENCIAL,
      idEfetiva.observacaoInicio, idEfetiva.observacaoFim, idEfetiva.geometriaSha256,
      INDICES_BUNDLE_ESSENCIAL as unknown as string[]
    ];
    const escopo = empresaScopeSql(ctx, "s", paramsI);
    const r = await ctx.tx.query<AnaliseIrma>(
      `select s.id, s.indice, s.observacao_inicio, s.observacao_fim, s.geometria_sha256, s.empresa_id
         from erp.analises_satelitais s
        where s.organization_id = $1 and s.area_id = $2 and s.versao_metodo = $3
          and s.situacao = 'concluida'
          and s.observacao_inicio = $4 and s.observacao_fim = $5
          and s.geometria_sha256 = $6
          and s.indice = any($7::text[])${escopo}`, paramsI);
    return {
      identidade: idEfetiva,
      analises: r.rows,
      dataImagem: dataImagemUtc(idEfetiva.observacaoInicio)
    };
  });
}

async function lerFaltantes(
  ctx: ServiceCtx,
  area: AreaLinha,
  identidade: IdentidadeObservacaoMapa,
  dataImagem: string,
  analises: AnaliseIrma[],
  grade: GradeRaster
): Promise<{ faltantes: IdOutputBundleEspacial[]; presentes: Map<IdOutputBundleEspacial, string> }> {
  const presentes = new Map<IdOutputBundleEspacial, string>();
  const faltantes: IdOutputBundleEspacial[] = [];

  // Condição v3 — identidade temporal + versão (v2 não conta).
  const chaveCond = chaveCacheCondicaoPasto({
    areaId: area.id, geometriaSha256: identidade.geometriaSha256, dataImagem,
    colecao: COLECAO_SENTINEL2_L2A,
    versaoClassificador: VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
    versaoEvalscript: VERSAO_EVALSCRIPT_CONDICAO_PASTO,
    resolucaoM: grade.resolucaoM, crs: CRS_RASTER, formato: FORMATO_RASTER
  });
  const paramsC: unknown[] = [
    ctx.orgId, chaveCond, VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
    identidade.observacaoInicio, identidade.observacaoFim
  ];
  const escopoC = empresaScopeSql(ctx, "m", paramsC);
  const mapa = await ctx.tx.query<{ id: string }>(
    `select m.id from erp.satelite_mapas_condicao m
      where m.organization_id = $1 and m.chave_cache = $2
        and m.versao_classificador = $3
        and m.observacao_inicio = $4 and m.observacao_fim = $5${escopoC}
      limit 1`, paramsC);
  if (mapa.rows[0]) presentes.set("condicao", mapa.rows[0].id);
  else faltantes.push("condicao");

  const porIndice = new Map(analises.map((a) => [a.indice, a]));
  for (const indice of INDICES_BUNDLE_ESSENCIAL) {
    const analise = porIndice.get(indice);
    const encoding = encodingRasterDe(indice);
    if (!analise || !encoding) {
      faltantes.push(indice);
      continue;
    }
    const chave = chaveCacheRaster({
      areaId: area.id, geometriaSha256: identidade.geometriaSha256, dataImagem,
      colecao: COLECAO_SENTINEL2_L2A, versaoEvalscript: encoding.encodingVersion,
      resolucaoM: grade.resolucaoM, crs: CRS_RASTER, formato: FORMATO_RASTER,
      escalaMin: encoding.scaleMin, escalaMax: encoding.scaleMax
    });
    const paramsR: unknown[] = [ctx.orgId, chave, analise.id];
    const escopoR = empresaScopeSql(ctx, "r", paramsR);
    const r = await ctx.tx.query<{ id: string }>(
      `select r.id from erp.satelite_rasters r
        where r.organization_id = $1 and r.chave_cache = $2 and r.analise_id = $3${escopoR}
        limit 1`, paramsR);
    if (r.rows[0]) presentes.set(indice, r.rows[0].id);
    else faltantes.push(indice);
  }

  return { faltantes, presentes };
}

async function persistirCondicao(
  ctx: ServiceCtx,
  area: AreaLinha,
  identidade: IdentidadeObservacaoMapa,
  dataImagem: string,
  grade: GradeRaster,
  poligono: PoligonoGeoJson,
  pngBruto: Buffer,
  areaTotalHa: number
): Promise<string> {
  const img = lerPngCinza8(pngBruto, { largura: grade.largura, altura: grade.altura });
  const mascara = mascaraPoligonoNaGrade(poligono, grade);
  const pixels = aplicarMascaraPoligonoNosPixels(img.pixels, mascara);
  const png = escreverPngCinza8(grade.largura, grade.altura, pixels);
  const chave = chaveCacheCondicaoPasto({
    areaId: area.id, geometriaSha256: identidade.geometriaSha256, dataImagem,
    colecao: COLECAO_SENTINEL2_L2A,
    versaoClassificador: VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
    versaoEvalscript: VERSAO_EVALSCRIPT_CONDICAO_PASTO,
    resolucaoM: grade.resolucaoM, crs: CRS_RASTER, formato: FORMATO_RASTER
  });
  const storagePath = caminhoDoMapaCondicao({
    orgId: ctx.orgId, areaId: area.id, dataImagem, chaveCache: chave
  });
  await armazenamentoMapaCondicao.gravar(ctx.tx, {
    orgId: ctx.orgId, empresaId: area.empresa_id, storagePath, png, sha256: sha256Hex(png)
  });
  const { contagem, pixelsForaPoligono } = contarPixelsCondicaoComMascara(pixels, mascara);
  const resumo = resumirCondicaoPasto({
    contagem, areaTotalHa, resolucaoM: grade.resolucaoM, pixelsForaPoligono
  });
  const valores: unknown[] = [
    ctx.orgId, area.empresa_id, ctx.user.id, area.id, identidade.geometriaSha256,
    CHAVE_MAPA_CONDICAO_PASTO, TIPO_MAPA_CONDICAO_PASTO, VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
    VERSAO_EVALSCRIPT_CONDICAO_PASTO, dataImagem, identidade.observacaoInicio, identidade.observacaoFim,
    storagePath, grade.largura, grade.altura, grade.bbox3857[0], grade.bbox3857[1], grade.bbox3857[2], grade.bbox3857[3],
    JSON.stringify(grade.cantosLngLat), grade.resolucaoM, chave, areaTotalHa, JSON.stringify(resumo), null
  ];
  const escopo = empresaScopeSql(ctx, "f", valores);
  const r = await ctx.tx.query<{ id: string }>(
    `insert into erp.satelite_mapas_condicao (
        organization_id, empresa_id, criado_por, area_id, geometria_sha256, mapa, tipo, versao_classificador, versao_evalscript,
        data_imagem, observacao_inicio, observacao_fim, storage_path, sha256_arquivo, largura, altura,
        bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y, cantos_lnglat, resolucao_m, chave_cache, area_total_ha, resumo, pu_gasto)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12, f.storage_path, f.sha256_arquivo, $14, $15, $16, $17, $18, $19, $20::jsonb,
            $21, $22, $23, $24::jsonb, $25::numeric(14,4)
       from erp.satelite_mapas_condicao_arquivos f
      where f.organization_id = $1 and f.empresa_id = $2 and f.storage_path = $13${escopo}
     on conflict (organization_id, chave_cache) do nothing
     returning id`, valores);
  if (r.rowCount === 1) return r.rows[0]!.id;
  const params: unknown[] = [ctx.orgId, chave];
  const escopoL = empresaScopeSql(ctx, "m", params);
  const e = await ctx.tx.query<{ id: string }>(
    `select m.id from erp.satelite_mapas_condicao m where m.organization_id = $1 and m.chave_cache = $2${escopoL}`, params);
  if (e.rowCount !== 1) throw new Error("mapa condição: conflito sem releitura");
  return e.rows[0]!.id;
}

/**
 * Materializa os 7 produtos da observação (ou só faltantes) com no máximo 1 Process TAR.
 */
export async function materializarProdutosDaObservacao(
  dep: DependenciasMaterializar,
  pedido: PedidoMaterializar
): Promise<ResultadoMaterializacaoObservacao> {
  if (!dep.copernicusEnabled || !dep.cliente.configurado) {
    throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: !dep.copernicusEnabled ? "desligada" : "configuracao" });
  }

  const base = await resolverIdentidadeEAnalises(dep, pedido);
  if (!base || base.analises.length === 0) {
    throw validation("Não há observação útil do bundle de pastagem no contorno atual.", { motivo: "sem_observacao" });
  }
  const { identidade, analises, dataImagem } = base;
  const porIndice = new Map(analises.map((a) => [a.indice, a]));

  const plano = await comCtx(dep, pedido, async (ctx) => {
    const area = await lerArea(ctx, pedido.areaId);
    if (area.geometria_sha256 !== identidade.geometriaSha256) {
      throw validation("O polígono da área mudou depois da observação.", { motivo: "geometria_alterada" });
    }
    const poligono = lerPoligono(area.geometria);
    if (!poligono) throw validation(MSG_POLIGONO_FORA_DO_FORMATO, { motivo: "poligono_fora_do_formato" });
    let grade: GradeRaster;
    try { grade = planejarGradeCondicao(poligono); }
    catch (e) {
      if (e instanceof RangeError) throw validation(MSG_POLIGONO_FORA_DO_FORMATO, { motivo: "poligono_fora_do_formato" });
      throw e;
    }
    // Grade integrada = 20 m (não a nativa 10 m dos índices ópticos).
    if (grade.resolucaoAlvoM !== RESOLUCAO_BUNDLE_ESPACIAL_M) {
      grade = planejarGradeRaster(poligono, RESOLUCAO_BUNDLE_ESPACIAL_M);
    }
    const { faltantes, presentes } = await lerFaltantes(ctx, area, identidade, dataImagem, analises, grade);
    const contagem = faltantes.length ? await lerContagemChamadas(ctx.tx) : null;
    const areaTotalHa = area.area_ha !== null && Number.isFinite(Number(area.area_ha)) ? Number(area.area_ha) : 0;
    return { area, poligono, grade, faltantes, presentes, contagem, areaTotalHa };
  });

  const produtos: ResultadoProdutoMaterializado[] = [];
  for (const id of IDS_OUTPUT_BUNDLE_ESPACIAL) {
    const rid = plano.presentes.get(id);
    if (rid) produtos.push({ id, status: "reutilizado", recurso_id: rid });
  }
  const outputsReutilizados = produtos.map((p) => p.id);

  if (plano.faltantes.length === 0) {
    return {
      area_id: pedido.areaId, data_imagem: dataImagem, produtos,
      chamadas_process: 0, outputs_solicitados: [], outputs_reutilizados: outputsReutilizados,
      completo: true, pu_cabecalho: null
    };
  }

  if (!dep.limiteAvulso.admitir(pedido.orgId, plano.contagem)) {
    throw err("RATE_LIMITED", MSG_LIMITE_ANALISES, { motivo: "limite_erp" });
  }
  dep.limiteAvulso.ocupar(pedido.orgId);

  let puCabecalho: string | null = null;
  const inicioMs = Date.now();
  try {
    const corpo = montarCorpoProcessoBundleEspacial(
      plano.grade, { inicio: identidade.observacaoInicio, fim: identidade.observacaoFim },
      plano.faltantes, COLECAO_SENTINEL2_L2A
    );
    const registrar = (c: RegistroChamada) => dep.log.info({
      satelite: {
        provedor: "copernicus_cdse", endpoint: c.endpoint, status: c.status, duracao_ms: c.duracaoMs,
        tentativa: c.tentativa, tipo_falha: c.tipoFalha, area_id: pedido.areaId,
        outputs_solicitados: plano.faltantes, ...camposLogErroProvedor(c.erroProvedor)
      }
    }, "chamada ao provedor de satélite");

    let tar: Buffer;
    try {
      const r = await dep.cliente.processoTarComConsumo(corpo, registrar);
      tar = r.tar;
      puCabecalho = r.puCabecalho;
    } catch (e) {
      if (e instanceof FalhaCopernicus) {
        if (e.puCabecalho !== undefined) {
          await comCtx(dep, pedido, async (ctx) => {
            await gravarConsumo(ctx.tx, {
              organizationId: ctx.orgId, empresaId: plano.area.empresa_id,
              consultaId: pedido.consultaId ?? null, consultaItemId: pedido.consultaItemId ?? null,
              puCabecalho: e.puCabecalho ?? null, operacao: "process"
            });
          });
        }
        if (e.tipo === "limite") {
          throw err("RATE_LIMITED", MSG_LIMITE_PROVEDOR, { motivo: "limite_provedor", tentar_apos_segundos: e.tentarAposSegundos });
        }
        throw err("CONSULTA_INDISPONIVEL", MSG_PROVEDOR_INDISPONIVEL_RASTER, { motivo: e.tipo });
      }
      throw e;
    }

    let membros: Map<IdOutputBundleEspacial, { id: IdOutputBundleEspacial; png: Buffer }>;
    try {
      membros = await extrairPngsDoTarProcesso(tar, plano.faltantes);
    } catch (e) {
      await comCtx(dep, pedido, async (ctx) => {
        await gravarConsumo(ctx.tx, {
          organizationId: ctx.orgId, empresaId: plano.area.empresa_id,
          consultaId: pedido.consultaId ?? null, consultaItemId: pedido.consultaItemId ?? null,
          puCabecalho, operacao: "process"
        });
      });
      if (e instanceof FalhaTarProcesso) {
        throw err("CONSULTA_INDISPONIVEL", MSG_PROVEDOR_INDISPONIVEL_RASTER, { motivo: "resposta_malformada", detalhe: e.motivo });
      }
      throw e;
    }

    // Persistência parcial: cada produto em TX curta; consumo UMA vez no fim.
    const gravados = new Map<IdOutputBundleEspacial, string>();
    const falhas = new Map<IdOutputBundleEspacial, string>();

    for (const id of plano.faltantes) {
      const membro = membros.get(id);
      if (!membro) { falhas.set(id, "membro_ausente"); continue; }
      try {
        const recursoId = await comCtx(dep, pedido, async (ctx) => {
          if (id === "condicao") {
            return persistirCondicao(
              ctx, plano.area, identidade, dataImagem, plano.grade, plano.poligono,
              membro.png, plano.areaTotalHa
            );
          }
          const indice = indiceDoOutput(id)!;
          const analise = porIndice.get(indice);
          if (!analise) throw new Error(`análise irmã ausente: ${indice}`);
          const encoding = encodingRasterDe(indice)!;
          lerPngCinza8(membro.png, { largura: plano.grade.largura, altura: plano.grade.altura });
          const chave = chaveCacheRaster({
            areaId: plano.area.id, geometriaSha256: identidade.geometriaSha256, dataImagem,
            colecao: COLECAO_SENTINEL2_L2A, versaoEvalscript: encoding.encodingVersion,
            resolucaoM: plano.grade.resolucaoM, crs: CRS_RASTER, formato: FORMATO_RASTER,
            escalaMin: encoding.scaleMin, escalaMax: encoding.scaleMax
          });
          const storagePath = caminhoDoRaster({
            orgId: ctx.orgId, areaId: plano.area.id, indice, dataImagem, chaveCache: chave
          });
          await dep.armazenamento.gravar(ctx.tx, {
            orgId: ctx.orgId, empresaId: plano.area.empresa_id, storagePath,
            png: membro.png, sha256: sha256Hex(membro.png)
          });
          const g = plano.grade;
          const valores: unknown[] = [
            ctx.orgId, plano.area.empresa_id, ctx.user.id, analise.id, plano.area.id,
            identidade.geometriaSha256, indice, TIPO_RASTER, encoding.encodingVersion, dataImagem,
            storagePath, g.largura, g.altura, g.bbox3857[0], g.bbox3857[1], g.bbox3857[2], g.bbox3857[3],
            JSON.stringify(g.cantosLngLat), encoding.scaleMin, encoding.scaleMax, g.resolucaoM, chave, null
          ];
          const escopo = empresaScopeSql(ctx, "f", valores);
          const ins = await ctx.tx.query<{ id: string }>(
            `insert into erp.satelite_rasters (organization_id, empresa_id, criado_por, analise_id, area_id, geometria_sha256, indice, tipo, versao_evalscript,
                data_imagem, storage_path, sha256_arquivo, largura, altura, bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y, cantos_lnglat,
                escala_min, escala_max, resolucao_m, chave_cache, pu_gasto)
             select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, f.storage_path, f.sha256_arquivo, $12, $13, $14, $15, $16, $17, $18::jsonb,
                    $19, $20, $21, $22, $23::numeric(14,4)
               from erp.satelite_raster_arquivos f
              where f.organization_id = $1 and f.empresa_id = $2 and f.storage_path = $11${escopo}
             on conflict (organization_id, chave_cache) do nothing
             returning id`, valores);
          if (ins.rowCount === 1) return ins.rows[0]!.id;
          const params: unknown[] = [ctx.orgId, chave];
          const escopoL = empresaScopeSql(ctx, "r", params);
          const e = await ctx.tx.query<{ id: string }>(
            `select r.id from erp.satelite_rasters r where r.organization_id = $1 and r.chave_cache = $2${escopoL}`, params);
          if (e.rowCount !== 1) throw new Error("raster: conflito sem releitura");
          return e.rows[0]!.id;
        });
        gravados.set(id, recursoId);
      } catch (e) {
        dep.log.warn({
          satelite: { area_id: pedido.areaId, output: id, etapa: "persistencia_bundle", codigo: codigoErro(e) }
        }, "produto do bundle não persistido");
        falhas.set(id, codigoErro(e));
      }
    }

    // Consumo UMA vez (mesmo com persistência parcial).
    await comCtx(dep, pedido, async (ctx) => {
      await gravarConsumo(ctx.tx, {
        organizationId: ctx.orgId, empresaId: plano.area.empresa_id,
        consultaId: pedido.consultaId ?? null, consultaItemId: pedido.consultaItemId ?? null,
        puCabecalho, operacao: "process"
      });
    });

    for (const id of plano.faltantes) {
      const rid = gravados.get(id);
      if (rid) produtos.push({ id, status: "pronto", recurso_id: rid });
      else produtos.push({ id, status: "falhou", recurso_id: null, erro: falhas.get(id) ?? "falhou" });
    }

    dep.log.info({
      satelite: {
        area_id: pedido.areaId, data_imagem: dataImagem,
        consulta_id: pedido.consultaId ?? null, consulta_item_id: pedido.consultaItemId ?? null,
        outputs_solicitados: plano.faltantes, outputs_reutilizados: outputsReutilizados,
        outputs_gravados: [...gravados.keys()],
        tamanho_resposta_bytes: tar.length, duracao_ms: Date.now() - inicioMs,
        provider_status: 200
      }
    }, "bundle espacial materializado");

    const completo = IDS_OUTPUT_BUNDLE_ESPACIAL.every((id) =>
      produtos.some((p) => p.id === id && (p.status === "pronto" || p.status === "reutilizado" || p.status === "reparado"))
    );

    return {
      area_id: pedido.areaId, data_imagem: dataImagem, produtos,
      chamadas_process: 1, outputs_solicitados: [...plano.faltantes],
      outputs_reutilizados: outputsReutilizados, completo, pu_cabecalho: puCabecalho
    };
  } finally {
    dep.limiteAvulso.liberar(pedido.orgId);
  }
}

/** Atalho operacional: pronto|reutilizado|falhou no conjunto dos 7. */
export async function materializarProdutosOperacional(
  dep: DependenciasMaterializar,
  pedido: PedidoMaterializar
): Promise<{ status: "pronto" | "reutilizado" | "falhou"; resultado: ResultadoMaterializacaoObservacao }> {
  try {
    const r = await materializarProdutosDaObservacao(dep, pedido);
    if (r.completo && r.chamadas_process === 0) return { status: "reutilizado", resultado: r };
    if (r.completo) return { status: "pronto", resultado: r };
    return { status: "falhou", resultado: r };
  } catch (e) {
    dep.log.warn({
      satelite: { area_id: pedido.areaId, etapa: "materializar_bundle", codigo: codigoErro(e) }
    }, "materialização do bundle espacial falhou");
    return {
      status: "falhou",
      resultado: {
        area_id: pedido.areaId, data_imagem: null, produtos: [],
        chamadas_process: 0, outputs_solicitados: [], outputs_reutilizados: [],
        completo: false, pu_cabecalho: null
      }
    };
  }
}

void MSG_ARMAZENAMENTO_FALHOU;
