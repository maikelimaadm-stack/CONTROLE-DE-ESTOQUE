/**
 * GERAÇÃO / REUTILIZAÇÃO DO RASTER TÉCNICO POR ÍNDICE — SAT-BUNDLE-01A.
 *
 * Serviço interno compartilhado pela rota HTTP (`POST …/analises-satelitais/:id/raster`)
 * e sob demanda (`politica: raster_explicito`). O worker automático materializa rasters
 * via Process TAR multi-output (SAT-BUNDLE-01C); esta rota permanece para pedido individual legado.
 * Sem transação aberta durante HTTP externo.
 *
 * Cache: mesma área + geometria + data + índice + versão de encoding + resolução → REUTILIZA.
 */
import { createHash } from "node:crypto";
import { withTx, type Db } from "@agro/db";
import {
  COLECAO_SENTINEL2_L2A, PROVEDOR_COPERNICUS,
  encodingRasterDe, type EncodingRasterIndice
} from "@agro/domain";
import { empresaScopeSql, hasPermission, scopedById, type ServiceCtx } from "../context.js";
import { DomainError, err, validation } from "../errors.js";
import {
  MSG_ANALISE_DESLIGADA, MSG_LIMITE_ANALISES, MSG_LIMITE_PROVEDOR,
  MSG_POLIGONO_FORA_DO_FORMATO, PERMISSAO_PEDIR_ANALISE
} from "../../routes/analises-satelitais.js";

export const MSG_ANALISE_NAO_ENCONTRADA = "Análise não encontrada";
export const MSG_RASTER_NAO_ENCONTRADO = "Imagem não encontrada";
export const MSG_SEM_OBSERVACAO = "A análise não tem observação útil: não há imagem de satélite para gerar.";
export const MSG_GEOMETRIA_ALTERADA = "O polígono da área mudou depois da análise; peça uma análise nova antes de gerar a imagem.";
export const MSG_METODO_DESCONHECIDO = "A imagem por pixel só existe para os índices do bundle essencial do Sentinel-2 L2A.";
export const MSG_PROVEDOR_INDISPONIVEL_RASTER = "O provedor de imagens de satélite não respondeu como esperado; nenhuma imagem foi gravada. Tente de novo mais tarde.";
export const MSG_ARMAZENAMENTO_FALHOU = "A imagem de satélite foi gerada, mas não pôde ser guardada; nenhuma imagem foi registrada. Tente de novo mais tarde.";
export const MSG_RASTER_DISPUTADO = "A imagem desta análise foi disputada por outro pedido; peça a imagem de novo.";
import { FalhaCopernicus, camposLogErroProvedor, type ClienteCopernicus, type RegistroChamada } from "./copernicus.js";
import { gravarConsumo, lerPuDoCabecalho } from "./consumo.js";
import { MODULO_EXECUTOR, contextoDoCriador } from "./contexto-worker.js";
import { lerPoligono } from "./geometria.js";
import { lerContagemChamadas } from "./limite-global.js";
import type { LimiteAvulsoSatelite } from "./limite-avulso.js";
import { lerPngCinza8 } from "./png.js";
import {
  CRS_RASTER, FORMATO_RASTER, TIPO_RASTER,
  chaveCacheRaster, dataImagemUtc, montarCorpoProcesso, planejarGradeRaster, type GradeRaster
} from "./raster.js";
import { caminhoDoRaster, type ArmazenamentoRaster } from "./armazenamento-raster.js";

export interface LogRasterIndice {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

function resumoErroRaster(e: unknown): Record<string, unknown> {
  if (e instanceof FalhaCopernicus) {
    return { tipo_falha: e.tipo, status: e.status, ...camposLogErroProvedor(e.erroProvedor) };
  }
  if (e instanceof DomainError) return { tipo_falha: "erro_interno", codigo: e.code };
  const pg = (e && typeof e === "object" ? e : {}) as { code?: unknown; constraint?: unknown };
  return {
    tipo_falha: "erro_interno",
    nome: e instanceof Error ? e.name : typeof e,
    sqlstate: typeof pg.code === "string" ? pg.code : null,
    restricao: typeof pg.constraint === "string" ? pg.constraint : null
  };
}

const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** Fallback só para chamadores que não passam mapa próprio (testes unitários). */
const emAndamentoPadrao = new Map<string, Promise<GeracaoFeita>>();

export interface LinhaAnaliseRaster {
  id: string; empresa_id: string; area_id: string; colecao: string; indice: string; geometria_sha256: string; situacao: string;
  observacao_inicio: Date | null; observacao_fim: Date | null;
}
export interface AreaRaster { id: string; empresa_id: string; geometria: unknown; geometria_sha256: string | null }
export interface LinhaRaster {
  id: string; empresa_id: string; analise_id: string; area_id: string; indice: string; tipo: string; data_imagem: string;
  largura: number; altura: number; cantos_lnglat: unknown; escala_min: string; escala_max: string; resolucao_m: number;
  versao_evalscript: string; geometria_sha256: string;
}
export interface PlanoRaster {
  analise: LinhaAnaliseRaster; area: AreaRaster; grade: GradeRaster; janela: { inicio: Date; fim: Date };
  dataImagem: string; chave: string; storagePath: string; encoding: EncodingRasterIndice;
}

export interface GeracaoFeitaRaster { puCabecalho: string | null }
type GeracaoFeita = GeracaoFeitaRaster

export class FalhaArmazenamentoRaster extends Error {
  constructor(readonly puCabecalho: string | null, readonly causa: unknown) {
    super("armazenamento do raster falhou");
    this.name = "FalhaArmazenamentoRaster";
  }
}

const COLUNAS_RASTER = ["id", "empresa_id", "analise_id", "area_id", "indice", "tipo", "data_imagem", "largura", "altura", "cantos_lnglat",
  "escala_min", "escala_max", "resolucao_m", "versao_evalscript", "geometria_sha256"] as const;
const colunasRaster = (alias: string) => COLUNAS_RASTER.map((c) => `${alias}.${c}`).join(", ");

export interface DependenciasGerarRaster {
  db: Db;
  cliente: ClienteCopernicus;
  limiteAvulso: LimiteAvulsoSatelite;
  log: LogRasterIndice;
  copernicusEnabled: boolean;
  armazenamento: ArmazenamentoRaster;
  /**
   * Dedup de geração em voo NESTA instância.
   * Cada processo/app deve passar o próprio Map — senão duas réplicas no mesmo Node
   * compartilhariam o registro e a corrida entre réplicas deixaria de existir.
   */
  emAndamento?: Map<string, Promise<GeracaoFeita>>;
}

export interface PedidoGerarRaster {
  orgId: string;
  userId: string;
  analiseId: string;
}

function tenantDo(p: PedidoGerarRaster) {
  return { orgId: p.orgId, userId: p.userId, modulo: MODULO_EXECUTOR };
}

async function comCtx<T>(dep: DependenciasGerarRaster, p: PedidoGerarRaster, fn: (ctx: ServiceCtx) => Promise<T>): Promise<T> {
  return withTx(dep.db, tenantDo(p), async (tx) => {
    const ctx = await contextoDoCriador(tx, p.orgId, p.userId);
    if (!ctx) throw err("PERMISSION_DENIED", "Sem permissão");
    if (!hasPermission(ctx, PERMISSAO_PEDIR_ANALISE)) throw err("PERMISSION_DENIED", `Sem permissão: ${PERMISSAO_PEDIR_ANALISE}`);
    return fn(ctx);
  });
}

export async function lerAnaliseRaster(ctx: ServiceCtx, analiseId: string): Promise<LinhaAnaliseRaster> {
  const sc = scopedById(ctx, "s", analiseId);
  const r = await ctx.tx.query<LinhaAnaliseRaster>(
    `select s.id, s.empresa_id, s.area_id, s.colecao, s.indice, s.geometria_sha256, s.situacao, s.observacao_inicio, s.observacao_fim
       from erp.analises_satelitais s
      where s.id = $1 and s.organization_id = $2${sc.sql}`, sc.params);
  if (!r.rows[0]) throw err("NOT_FOUND", MSG_ANALISE_NAO_ENCONTRADA);
  return r.rows[0];
}

async function lerArea(ctx: ServiceCtx, areaId: string): Promise<AreaRaster | null> {
  const sc = scopedById(ctx, "a", areaId);
  const r = await ctx.tx.query<AreaRaster>(
    `select a.id, a.empresa_id, a.geometria,
            case when a.geometria is null then null else encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex') end as geometria_sha256
       from erp.areas a
      where a.id = $1 and a.organization_id = $2 and a.deleted_at is null${sc.sql}`, sc.params);
  return r.rows[0] ?? null;
}

export async function planejarRasterIndice(ctx: ServiceCtx, analiseId: string): Promise<PlanoRaster> {
  const analise = await lerAnaliseRaster(ctx, analiseId);
  if (analise.situacao !== "concluida" || !analise.observacao_inicio || !analise.observacao_fim) {
    throw validation(MSG_SEM_OBSERVACAO, { motivo: "sem_observacao" });
  }
  const encoding = encodingRasterDe(analise.indice);
  if (!encoding || analise.colecao !== COLECAO_SENTINEL2_L2A) {
    throw validation(MSG_METODO_DESCONHECIDO, { motivo: "metodo_desconhecido" });
  }
  const area = await lerArea(ctx, analise.area_id);
  if (!area) throw err("NOT_FOUND", MSG_ANALISE_NAO_ENCONTRADA);
  if (area.geometria_sha256 === null || area.geometria_sha256 !== analise.geometria_sha256) {
    throw validation(MSG_GEOMETRIA_ALTERADA, { motivo: "geometria_alterada" });
  }
  const poligono = lerPoligono(area.geometria);
  if (!poligono) throw validation(MSG_POLIGONO_FORA_DO_FORMATO, { motivo: "poligono_fora_do_formato" });
  let grade: GradeRaster;
  try {
    grade = planejarGradeRaster(poligono, encoding.processingResolutionM);
  } catch (e) {
    if (e instanceof RangeError) throw validation(MSG_POLIGONO_FORA_DO_FORMATO, { motivo: "poligono_fora_do_formato" });
    throw e;
  }
  const dataImagem = dataImagemUtc(analise.observacao_inicio);
  const chave = chaveCacheRaster({
    areaId: area.id, geometriaSha256: analise.geometria_sha256, dataImagem, colecao: analise.colecao,
    versaoEvalscript: encoding.encodingVersion,
    resolucaoM: grade.resolucaoM, crs: CRS_RASTER, formato: FORMATO_RASTER,
    escalaMin: encoding.scaleMin, escalaMax: encoding.scaleMax
  });
  const storagePath = caminhoDoRaster({ orgId: ctx.orgId, areaId: area.id, indice: analise.indice, dataImagem, chaveCache: chave });
  return {
    analise, area, grade, janela: { inicio: analise.observacao_inicio, fim: analise.observacao_fim },
    dataImagem, chave, storagePath, encoding
  };
}

export async function lerRasterDaChave(ctx: ServiceCtx, chave: string): Promise<LinhaRaster | null> {
  const params: unknown[] = [ctx.orgId, chave];
  const escopo = empresaScopeSql(ctx, "r", params);
  const r = await ctx.tx.query<LinhaRaster>(
    `select ${colunasRaster("r")} from erp.satelite_rasters r where r.organization_id = $1 and r.chave_cache = $2${escopo}`, params);
  return r.rows[0] ?? null;
}

function erroDoProvedor(f: FalhaCopernicus): DomainError {
  if (f.tipo === "limite") return err("RATE_LIMITED", MSG_LIMITE_PROVEDOR, { motivo: "limite_provedor", tentar_apos_segundos: f.tentarAposSegundos });
  return err("CONSULTA_INDISPONIVEL", MSG_PROVEDOR_INDISPONIVEL_RASTER, { motivo: f.tipo });
}

async function gravarArquivo(
  dep: DependenciasGerarRaster, p: PedidoGerarRaster, plano: PlanoRaster, png: Buffer, puCabecalho: string | null
): Promise<void> {
  try {
    await comCtx(dep, p, (ctx) =>
      dep.armazenamento.gravar(ctx.tx, {
        orgId: ctx.orgId, empresaId: plano.analise.empresa_id, storagePath: plano.storagePath, png, sha256: sha256Hex(png)
      }));
  } catch (e) {
    throw new FalhaArmazenamentoRaster(puCabecalho, e);
  }
}

async function gravarRaster(ctx: ServiceCtx, p: PlanoRaster, feita: GeracaoFeita): Promise<LinhaRaster | null> {
  const params: unknown[] = [ctx.orgId, p.analise.empresa_id, p.storagePath];
  const escopoArquivo = empresaScopeSql(ctx, "f", params);
  const arquivo = await ctx.tx.query(
    "select 1 from erp.satelite_raster_arquivos f where f.organization_id = $1 and f.empresa_id = $2 and f.storage_path = $3" + escopoArquivo,
    params);
  if (arquivo.rowCount !== 1) throw new Error("raster: o arquivo gravado não está visível na fase de registro");
  const g = p.grade;
  const valores: unknown[] = [
    ctx.orgId, p.analise.empresa_id, ctx.user.id, p.analise.id, p.area.id, p.analise.geometria_sha256, p.analise.indice, TIPO_RASTER,
    p.encoding.encodingVersion, p.dataImagem, p.storagePath, g.largura, g.altura, g.bbox3857[0], g.bbox3857[1], g.bbox3857[2], g.bbox3857[3],
    JSON.stringify(g.cantosLngLat), p.encoding.scaleMin, p.encoding.scaleMax, g.resolucaoM, p.chave, lerPuDoCabecalho(feita.puCabecalho).pu
  ];
  const escopoOrigem = empresaScopeSql(ctx, "f", valores);
  const r = await ctx.tx.query<LinhaRaster>(
    `insert into erp.satelite_rasters (organization_id, empresa_id, criado_por, analise_id, area_id, geometria_sha256, indice, tipo, versao_evalscript,
        data_imagem, storage_path, sha256_arquivo, largura, altura, bbox_min_x, bbox_min_y, bbox_max_x, bbox_max_y, cantos_lnglat,
        escala_min, escala_max, resolucao_m, chave_cache, pu_gasto)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, f.storage_path, f.sha256_arquivo, $12, $13, $14, $15, $16, $17, $18::jsonb,
            $19, $20, $21, $22, $23::numeric(14,4)
       from erp.satelite_raster_arquivos f
      where f.organization_id = $1 and f.empresa_id = $2 and f.storage_path = $11${escopoOrigem}
     on conflict (organization_id, chave_cache) do nothing
     returning ${COLUNAS_RASTER.join(", ")}`, valores);
  if (r.rowCount === 1) return r.rows[0]!;
  if (r.rowCount !== 0) throw new Error("raster: a gravação devolveu mais de uma linha");
  return null;
}

async function gravarConsumoCurto(
  dep: DependenciasGerarRaster, p: PedidoGerarRaster, analiseId: string, puCabecalho: string | null
): Promise<void> {
  await comCtx(dep, p, async (ctx) => {
    let analise: LinhaAnaliseRaster;
    try {
      analise = await lerAnaliseRaster(ctx, analiseId);
    } catch (e) {
      if (!(e instanceof DomainError) || e.code !== "NOT_FOUND") throw e;
      dep.log.warn({ satelite: { provedor: PROVEDOR_COPERNICUS, analise_id: analiseId } }, "consumo do provedor não gravado: a análise saiu do escopo durante a chamada");
      return;
    }
    await gravarConsumo(ctx.tx, {
      organizationId: ctx.orgId, empresaId: analise.empresa_id, consultaId: null, consultaItemId: null, puCabecalho, operacao: "process"
    });
  });
}

/**
 * Gera ou reutiliza o raster técnico da análise. Lança DomainError (nunca FalhaCopernicus).
 */
export async function gerarOuReutilizarRasterIndice(
  dep: DependenciasGerarRaster,
  pedido: PedidoGerarRaster
): Promise<{ raster: LinhaRaster; reutilizada: boolean }> {
  if (!dep.copernicusEnabled) {
    throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "desligada" });
  }
  if (!dep.cliente.configurado) {
    throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "configuracao" });
  }

  const a = await comCtx(dep, pedido, async (ctx) => {
    const plano = await planejarRasterIndice(ctx, pedido.analiseId);
    const existente = await lerRasterDaChave(ctx, plano.chave);
    return { plano, existente, contagem: existente ? null : await lerContagemChamadas(ctx.tx) };
  });
  if (a.existente) return { raster: a.existente, reutilizada: true };
  const { plano } = a;

  const emAndamento = dep.emAndamento ?? emAndamentoPadrao;
  const chaveVoo = [pedido.orgId, plano.area.id, plano.chave].join("|");
  let geracao = emAndamento.get(chaveVoo);
  const abriuChamada = !geracao;
  if (!geracao) {
    if (!dep.limiteAvulso.admitir(pedido.orgId, a.contagem)) {
      throw err("RATE_LIMITED", MSG_LIMITE_ANALISES, { motivo: "limite_erp" });
    }
    geracao = (async (): Promise<GeracaoFeita> => {
      const registrar = (c: RegistroChamada) => dep.log.info({
        satelite: {
          provedor: PROVEDOR_COPERNICUS, endpoint: c.endpoint, status: c.status, duracao_ms: c.duracaoMs,
          tentativa: c.tentativa, tipo_falha: c.tipoFalha, analise_id: plano.analise.id, area_id: plano.area.id,
          ...camposLogErroProvedor(c.erroProvedor)
        }
      }, "chamada ao provedor de satélite");
      const r = await dep.cliente.processoComConsumo(
        montarCorpoProcesso(plano.grade, plano.janela, plano.encoding.indice), registrar);
      let img: { largura: number; altura: number };
      try {
        img = lerPngCinza8(r.png, { largura: plano.grade.largura, altura: plano.grade.altura });
      } catch {
        throw new FalhaCopernicus("resposta_malformada", null, null, r.puCabecalho);
      }
      if (img.largura !== plano.grade.largura || img.altura !== plano.grade.altura) {
        throw new FalhaCopernicus("resposta_malformada", null, null, r.puCabecalho);
      }
      await gravarArquivo(dep, pedido, plano, r.png, r.puCabecalho);
      return { puCabecalho: r.puCabecalho };
    })();
    emAndamento.set(chaveVoo, geracao);
    dep.limiteAvulso.ocupar(pedido.orgId);
  }

  try {
    let feita: GeracaoFeita;
    try {
      feita = await geracao;
    } catch (e) {
      if (e instanceof FalhaCopernicus) {
        dep.log.warn({
          satelite: {
            provedor: PROVEDOR_COPERNICUS, analise_id: plano.analise.id, area_id: plano.area.id,
            tipo_falha: e.tipo, status: e.status, ...camposLogErroProvedor(e.erroProvedor)
          }
        }, "imagem por satélite não gerada");
        if (abriuChamada && e.puCabecalho !== undefined) {
          await gravarConsumoCurto(dep, pedido, pedido.analiseId, e.puCabecalho);
        }
        throw erroDoProvedor(e);
      }
      if (e instanceof FalhaArmazenamentoRaster) {
        dep.log.error({
          satelite: { analise_id: plano.analise.id, area_id: plano.area.id, etapa: "armazenamento", ...resumoErroRaster(e.causa) }
        }, "imagem por satélite gerada e não guardada");
        if (abriuChamada) await gravarConsumoCurto(dep, pedido, pedido.analiseId, e.puCabecalho);
        throw err("CONSULTA_INDISPONIVEL", MSG_ARMAZENAMENTO_FALHOU, { motivo: "armazenamento" });
      }
      throw e;
    }

    // Conflitos (área sumiu / geometria mudou / corrida) saem DEPOIS do commit:
    // a chamada gastou → o consumo fica na mesma transação; a recusa é devolvida ao chamador.
    type Desfecho =
      | { raster: LinhaRaster; reutilizada: boolean }
      | { conflito: DomainError };
    let desfecho: Desfecho;
    try {
      desfecho = await comCtx(dep, pedido, async (ctx): Promise<Desfecho> => {
        const analise = await lerAnaliseRaster(ctx, pedido.analiseId);
        const area = await lerArea(ctx, analise.area_id);
        const consumo = () => (abriuChamada
          ? gravarConsumo(ctx.tx, {
            organizationId: ctx.orgId, empresaId: analise.empresa_id, consultaId: null, consultaItemId: null,
            puCabecalho: feita.puCabecalho, operacao: "process"
          })
          : Promise.resolve(null));
        if (!area) {
          await consumo();
          return { conflito: err("NOT_FOUND", MSG_ANALISE_NAO_ENCONTRADA) };
        }
        if (area.geometria_sha256 !== plano.analise.geometria_sha256) {
          await consumo();
          return { conflito: validation(MSG_GEOMETRIA_ALTERADA, { motivo: "geometria_alterada" }) };
        }
        const nova = await gravarRaster(ctx, plano, feita);
        const existente = nova ? null : await lerRasterDaChave(ctx, plano.chave);
        await consumo();
        if (nova) return { raster: nova, reutilizada: false };
        if (!existente) return { conflito: err("CONCURRENCY_CONFLICT", MSG_RASTER_DISPUTADO) };
        return { raster: existente, reutilizada: true };
      });
    } catch (e) {
      if (abriuChamada && !(e instanceof DomainError)) {
        dep.log.error({
          satelite: { analise_id: plano.analise.id, area_id: plano.area.id, etapa: "gravacao", ...resumoErroRaster(e) }
        }, "imagem por satélite: gravação falhou");
        await gravarConsumoCurto(dep, pedido, pedido.analiseId, feita.puCabecalho);
      }
      throw e;
    }
    if ("conflito" in desfecho) throw desfecho.conflito;
    return desfecho;
  } finally {
    if (abriuChamada) {
      emAndamento.delete(chaveVoo);
      dep.limiteAvulso.liberar(pedido.orgId);
    }
  }
}
