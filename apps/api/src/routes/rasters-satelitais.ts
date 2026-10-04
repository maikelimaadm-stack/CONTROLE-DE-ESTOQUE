import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { withTx } from "@agro/db";
import { COLECAO_SENTINEL2_L2A, INDICE_NDVI, PROVEDOR_COPERNICUS, moduloDaPermissao } from "@agro/domain";
import { runService } from "../lib/service.js";
import { DomainError, err, validation } from "../lib/errors.js";
import { empresaScopeSql, hasPermission, scopedById, type ServiceCtx } from "../lib/context.js";
import { lerDadosDoMembro, vinculoDoMembro } from "../lib/contexto-membro.js";
import { FalhaCopernicus, type RegistroChamada } from "../lib/satelite/copernicus.js";
import { gravarConsumo, lerPuDoCabecalho } from "../lib/satelite/consumo.js";
import { lerContagemChamadas } from "../lib/satelite/limite-global.js";
import { lerPoligono } from "../lib/satelite/geometria.js";
import { lerPngCinza8 } from "../lib/satelite/png.js";
import {
  CRS_RASTER, ESCALA_NDVI_RASTER, FORMATO_RASTER, RESOLUCAO_ALVO_M, TIPO_RASTER, VERSAO_EVALSCRIPT_RASTER,
  chaveCacheRaster, dataImagemUtc, montarCorpoProcesso, planejarGradeRaster, type GradeRaster
} from "../lib/satelite/raster.js";
import { caminhoDoRaster } from "../lib/satelite/armazenamento-raster.js";
import { criarAssinadorUrlRaster } from "../lib/satelite/url-assinada.js";
import { resumoDoErro } from "../lib/satelite/executar-item.js";
import {
  MSG_ANALISE_DESLIGADA, MSG_LIMITE_ANALISES, MSG_LIMITE_PROVEDOR, MSG_POLIGONO_FORA_DO_FORMATO, PERMISSAO_PEDIR_ANALISE, PERMISSAO_VER_ANALISE, exigir
} from "./analises-satelitais.js";

/**
 * IMAGEM DO NDVI POR PIXEL DA ANÁLISE (SAT-06, decisão 297) — Process API do Copernicus. Só API: sem tela, sem
 * paleta, sem cor, sem lote automático. O arquivo é um PNG de VALORES (1 banda, 8 bits: 0 = sem dado; 1..254 = o NDVI
 * na escala `ESCALA_NDVI_RASTER`), recortado no polígono da área, de uma análise que JÁ existe.
 *
 *   POST /api/mapa/analises-satelitais/:analiseId/raster   gera (ou reaproveita) a imagem da análise (corpo `{}` ou ausente)
 *   GET  /api/mapa/analises-satelitais/:analiseId/raster   a imagem da análise, se já gerada (404 se não)
 *   GET  /api/mapa/rasters?area_ids=…&indice&pagina&tamanho  a imagem MAIS RECENTE de cada área pedida (lote, sem gerar)
 *   GET  /api/mapa/rasters/:rasterId/arquivo?t=<token>      o PNG, pela URL ASSINADA (sem cabeçalho de autenticação)
 *
 * O CLIENTE MANDA SÓ O ID. Polígono, data da imagem, janela, coleção, escala, resolução e empresa saem da ANÁLISE e da
 * ÁREA lidas pelo servidor depois da autorização; a rota não é proxy de satélite. Corpo e query estritos (chave
 * desconhecida → 422, nunca descartada em silêncio).
 *
 * AUTORIZAÇÃO = CAPACIDADE (`analises_satelitais.create` para gerar, `.view` para ler) ∧ ESCOPO (módulo pecuária, o da
 * permissão — o da área), com o predicado de empresa em CADA ocorrência de tabela, antes de qualquer `limit`. Análise
 * ou imagem inexistente, de outra organização, fora do escopo ou id malformado: a MESMA 404.
 *
 * GERAR — TRÊS FASES, e nenhuma transação aberta esperando o provedor (o molde da SAT-01):
 *   A. `runService`: a análise no escopo, CONCLUÍDA e com observação (senão 422: não há o que pintar); a área viva no
 *      escopo; o hash do polígono calculado PELO BANCO igual ao da análise (senão 422 — a imagem seria de outro
 *      polígono); a grade (`planejarGradeRaster`) e a CHAVE DE CACHE (`chaveCacheRaster`, com a data da imagem = o dia
 *      UTC de `observacao_inicio` DA ANÁLISE); imagem já gravada com a chave → 200 `reutilizada`, SEM chamar; senão a
 *      contagem do limite global.
 *   B. fora de transação: o limite (o MESMO objeto da SAT-01, `app.limiteAvulsoSatelite`: o mesmo limite global, o
 *      mesmo piso, as mesmas vagas em voo; bloqueado → o MESMO 429), a Process API (`processoComConsumo`, o cliente
 *      compartilhado do processo), a leitura do PNG (dimensões = as pedidas; senão `resposta_malformada`) e o ARQUIVO no
 *      armazenamento (`gravar`, transação própria e curta) — o "upload" vem ANTES da linha.
 *   C. `runService` de novo: análise e área RELIDAS no escopo (polígono mudou no meio → consumo + 422); a linha da
 *      imagem (`on conflict (organization_id, chave_cache) do nothing` + releitura → `reutilizada`), com o hash do
 *      ARQUIVO gravado (copiado da linha do arquivo, nunca recalculado aqui); e, NA MESMA TRANSAÇÃO, o consumo no ledger
 *      com operação `process`.
 * 2xx cobrado cuja leitura ou gravação falhou → só o consumo, numa transação curta, e o 503 (como a SAT-01). Falha do
 * provedor → o mesmo erro da SAT-01 (503, ou 429 do provedor). Dois pedidos simultâneos da mesma imagem nesta instância
 * compartilham a chamada; entre instâncias, a corrida cai no `on conflict` + releitura.
 *
 * LER — nenhuma rota de leitura chama o provedor. A URL do arquivo é assinada (`lib/satelite/url-assinada.ts`): vale
 * `VALIDADE_URL_RASTER_S` e delega o acesso do PRÓPRIO usuário — a rota do arquivo abre a transação com a GUC dele e lê
 * sob a RLS + o predicado de empresa; se ele perdeu o acesso, 404.
 */
export const MSG_ANALISE_NAO_ENCONTRADA = "Análise não encontrada";
export const MSG_RASTER_NAO_ENCONTRADO = "Imagem não encontrada";
export const MSG_SEM_OBSERVACAO = "A análise não tem observação útil: não há imagem de satélite para gerar.";
export const MSG_GEOMETRIA_ALTERADA = "O polígono da área mudou depois da análise; peça uma análise nova antes de gerar a imagem.";
export const MSG_METODO_DESCONHECIDO = "A imagem por pixel só existe para o NDVI do Sentinel-2 L2A.";
export const MSG_PROVEDOR_INDISPONIVEL_RASTER = "O provedor de imagens de satélite não respondeu como esperado; nenhuma imagem foi gravada. Tente de novo mais tarde.";
export const MSG_ARMAZENAMENTO_FALHOU = "A imagem de satélite foi gerada, mas não pôde ser guardada; nenhuma imagem foi registrada. Tente de novo mais tarde.";
export const MSG_RASTER_DISPUTADO = "A imagem desta análise foi disputada por outro pedido; peça a imagem de novo.";

/** Áreas por pedido da listagem em lote (contrato: até 200). */
export const AREAS_POR_LISTAGEM_MAXIMO = 200;
const TAMANHO_PAGINA_PADRAO = 50;

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const corpoVazio = z.object({}).strict();
const semQuery = z.object({}).strict();
const inteiroPositivo = (maximo: number) => z.string().regex(/^[1-9]\d{0,8}$/).transform(Number).pipe(z.number().int().min(1).max(maximo));
const listaQuery = z.object({
  /** `uuid,uuid,…` — só a forma canônica (minúsculas), sem repetir, 1..200. */
  area_ids: z.string().transform((v) => v.split(",")).pipe(
    z.array(z.string().regex(UUID_CANONICO)).min(1).max(AREAS_POR_LISTAGEM_MAXIMO).refine((l) => new Set(l).size === l.length, "Área repetida")),
  indice: z.enum([INDICE_NDVI]).default(INDICE_NDVI),
  pagina: inteiroPositivo(1_000_000).default(1),
  tamanho: inteiroPositivo(AREAS_POR_LISTAGEM_MAXIMO).default(TAMANHO_PAGINA_PADRAO)
}).strict();
/** O token é conferido pelo assinador; aqui só a forma do pedido (chave desconhecida → 422; token ausente → a 404). */
const arquivoQuery = z.object({ t: z.string().max(512).optional() }).strict();

interface LinhaAnaliseRaster {
  id: string; empresa_id: string; area_id: string; colecao: string; indice: string; geometria_sha256: string; situacao: string;
  observacao_inicio: Date | null; observacao_fim: Date | null;
}
interface AreaRaster { id: string; empresa_id: string; geometria: unknown; geometria_sha256: string | null }

interface LinhaRaster {
  id: string; empresa_id: string; analise_id: string; area_id: string; indice: string; tipo: string; data_imagem: string; largura: number; altura: number;
  cantos_lnglat: unknown; escala_min: string; escala_max: string; resolucao_m: number;
}
const COLUNAS_RASTER = ["id", "empresa_id", "analise_id", "area_id", "indice", "tipo", "data_imagem", "largura", "altura", "cantos_lnglat",
  "escala_min", "escala_max", "resolucao_m"];
const colunasRaster = (alias: string) => COLUNAS_RASTER.map((c) => `${alias}.${c}`).join(", ");

/** Tudo o que a FASE A decide sobre a imagem da análise, antes de qualquer chamada. */
interface PlanoRaster {
  analise: LinhaAnaliseRaster; area: AreaRaster; grade: GradeRaster; janela: { inicio: Date; fim: Date };
  dataImagem: string; chave: string; storagePath: string;
}

/** O que a geração (provedor + PNG + arquivo) entrega à FASE C. */
interface GeracaoFeita { puCabecalho: string | null }

/** 2xx cobrado cujo arquivo não foi guardado: a chamada gastou, e quem a abriu grava o consumo. */
class FalhaArmazenamentoRaster extends Error {
  constructor(readonly puCabecalho: string | null, readonly causa: unknown) {
    super("armazenamento do raster falhou");
    this.name = "FalhaArmazenamentoRaster";
  }
}

type DesfechoGravacao = { linha: LinhaRaster; reutilizada: boolean } | { conflito: DomainError };

function idDoCaminho(req: FastifyRequest, nome: "analiseId" | "rasterId", mensagem: string): string {
  const id = String((req.params as Record<string, string | undefined>)[nome] ?? "");
  if (!FORMA_UUID.test(id)) throw err("NOT_FOUND", mensagem);
  return id.toLowerCase();
}

/** A análise no escopo do módulo da permissão (RLS + predicado de empresa) — ou a 404. */
async function lerAnalise(ctx: ServiceCtx, analiseId: string): Promise<LinhaAnaliseRaster> {
  const sc = scopedById(ctx, "s", analiseId);
  const r = await ctx.tx.query<LinhaAnaliseRaster>(
    `select s.id, s.empresa_id, s.area_id, s.colecao, s.indice, s.geometria_sha256, s.situacao, s.observacao_inicio, s.observacao_fim
       from erp.analises_satelitais s
      where s.id = $1 and s.organization_id = $2${sc.sql}`, sc.params);
  if (!r.rows[0]) throw err("NOT_FOUND", MSG_ANALISE_NAO_ENCONTRADA);
  return r.rows[0];
}

/** A área viva, no escopo, com o hash do polígono calculado PELO BANCO (a expressão da 0052 e do gatilho) — ou null. */
async function lerArea(ctx: ServiceCtx, areaId: string): Promise<AreaRaster | null> {
  const sc = scopedById(ctx, "a", areaId);
  const r = await ctx.tx.query<AreaRaster>(
    `select a.id, a.empresa_id, a.geometria,
            case when a.geometria is null then null else encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex') end as geometria_sha256
       from erp.areas a
      where a.id = $1 and a.organization_id = $2 and a.deleted_at is null${sc.sql}`, sc.params);
  return r.rows[0] ?? null;
}

/**
 * A FASE A sem efeito: análise → área → grade → chave. Lança a recusa (404/422) que nenhuma imagem mudaria. A data da
 * imagem é a DA ANÁLISE (o dia UTC da observação), nunca "a mais recente": a imagem é desta análise.
 */
async function planejar(ctx: ServiceCtx, analiseId: string): Promise<PlanoRaster> {
  const analise = await lerAnalise(ctx, analiseId);
  if (analise.situacao !== "concluida" || !analise.observacao_inicio || !analise.observacao_fim) {
    throw validation(MSG_SEM_OBSERVACAO, { motivo: "sem_observacao" });
  }
  // Discriminador desconhecido NEGA: só o NDVI do Sentinel-2 L2A tem evalscript de imagem.
  if (analise.indice !== INDICE_NDVI || analise.colecao !== COLECAO_SENTINEL2_L2A) throw validation(MSG_METODO_DESCONHECIDO, { motivo: "metodo_desconhecido" });
  // A área divide a empresa com a análise (FK composta da 0052): fora do escopo ou excluída é a mesma 404 da análise.
  const area = await lerArea(ctx, analise.area_id);
  if (!area) throw err("NOT_FOUND", MSG_ANALISE_NAO_ENCONTRADA);
  if (area.geometria_sha256 === null || area.geometria_sha256 !== analise.geometria_sha256) {
    throw validation(MSG_GEOMETRIA_ALTERADA, { motivo: "geometria_alterada" });
  }
  const poligono = lerPoligono(area.geometria);
  if (!poligono) throw validation(MSG_POLIGONO_FORA_DO_FORMATO, { motivo: "poligono_fora_do_formato" });
  let grade: GradeRaster;
  try {
    grade = planejarGradeRaster(poligono);
  } catch (e) {
    // Fora da faixa do EPSG:3857 (perto do polo) ou anel degenerado: forma que nenhuma imagem mudaria.
    if (e instanceof RangeError) throw validation(MSG_POLIGONO_FORA_DO_FORMATO, { motivo: "poligono_fora_do_formato" });
    throw e;
  }
  const dataImagem = dataImagemUtc(analise.observacao_inicio);
  // A chave é DA ÁREA (o id da área é o primeiro componente): duas áreas gêmeas — o mesmo polígono e a mesma data, até em
  // empresas diferentes — têm imagens próprias, e a unicidade (organization_id, chave_cache) da 0055 não as mistura.
  const chave = chaveCacheRaster({
    areaId: area.id, geometriaSha256: analise.geometria_sha256, dataImagem, colecao: analise.colecao, versaoEvalscript: VERSAO_EVALSCRIPT_RASTER,
    resolucaoM: grade.resolucaoM, crs: CRS_RASTER, formato: FORMATO_RASTER, escalaMin: ESCALA_NDVI_RASTER.min, escalaMax: ESCALA_NDVI_RASTER.max
  });
  const storagePath = caminhoDoRaster({ orgId: ctx.orgId, areaId: area.id, indice: analise.indice, dataImagem, chaveCache: chave });
  return { analise, area, grade, janela: { inicio: analise.observacao_inicio, fim: analise.observacao_fim }, dataImagem, chave, storagePath };
}

/** A imagem da chave, no escopo — ou nenhuma. */
async function lerRasterDaChave(ctx: ServiceCtx, chave: string): Promise<LinhaRaster | null> {
  const params: unknown[] = [ctx.orgId, chave];
  const escopo = empresaScopeSql(ctx, "r", params);
  const r = await ctx.tx.query<LinhaRaster>(
    `select ${colunasRaster("r")} from erp.satelite_rasters r where r.organization_id = $1 and r.chave_cache = $2${escopo}`, params);
  return r.rows[0] ?? null;
}

/** Falha do provedor → o erro estável da SAT-01 (mesmo código, mesmos detalhes). Nada do corpo, do token ou da credencial vai junto. */
function erroDoProvedor(f: FalhaCopernicus): DomainError {
  if (f.tipo === "limite") return err("RATE_LIMITED", MSG_LIMITE_PROVEDOR, { motivo: "limite_provedor", tentar_apos_segundos: f.tentarAposSegundos });
  return err("CONSULTA_INDISPONIVEL", MSG_PROVEDOR_INDISPONIVEL_RASTER, { motivo: f.tipo });
}

export default async function rastersSatelitaisRoutes(app: FastifyInstance) {
  const { COPERNICUS_ENABLED } = app.config;
  // O cliente e o limite COMPARTILHADOS do processo (server.ts): o mesmo token e as mesmas vagas da SAT-01.
  const cliente = app.clienteCopernicus;
  const limiteAvulso = app.limiteAvulsoSatelite;
  const armazenamento = app.armazenamentoRaster;
  const assinador = criarAssinadorUrlRaster(app.config);
  /** Módulo da GUC da rota do arquivo: o da permissão de VER (pecuária). */
  const moduloLeitura = moduloDaPermissao(PERMISSAO_VER_ANALISE);
  // Mesmo pedido em andamento NESTA instância (mesma organização, área e chave): a mesma chamada ao provedor.
  const emAndamento = new Map<string, Promise<GeracaoFeita>>();

  /** DTO do ERP — nunca o corpo do provedor. A URL assinada é do usuário que pede, e vale `VALIDADE_URL_RASTER_S`. */
  function paraDto(l: LinhaRaster, orgId: string, userId: string) {
    const { token, expira } = assinador.assinar({ rasterId: l.id, organizationId: orgId, userId });
    return {
      id: l.id, analise_id: l.analise_id, area_id: l.area_id, indice: l.indice, tipo: l.tipo, data_imagem: l.data_imagem,
      largura: l.largura, altura: l.altura, cantos_lnglat: l.cantos_lnglat,
      escala_min: Number(l.escala_min), escala_max: Number(l.escala_max), resolucao_m: l.resolucao_m,
      resolucao_reduzida: l.resolucao_m > RESOLUCAO_ALVO_M,
      url_assinada: `/api/mapa/rasters/${l.id}/arquivo?t=${token}`,
      expira_em: new Date(expira * 1000).toISOString()
    };
  }

  app.post("/mapa/analises-satelitais/:analiseId/raster", async (req, reply) => {
    const ctxPedido = exigir(app, req, PERMISSAO_PEDIR_ANALISE);
    semQuery.parse(req.query);
    if (req.body !== undefined && req.body !== null) corpoVazio.parse(req.body);
    const analiseId = idDoCaminho(req, "analiseId", MSG_ANALISE_NAO_ENCONTRADA);
    if (!COPERNICUS_ENABLED) throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "desligada" });
    if (!cliente.configurado) throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "configuracao" });

    // FASE A — autorizar, planejar, reaproveitar (transação curta). A contagem do limite só para quem PODE chamar.
    const a = await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx) => {
      const plano = await planejar(ctx, analiseId);
      const existente = await lerRasterDaChave(ctx, plano.chave);
      return { plano, existente, contagem: existente ? null : await lerContagemChamadas(ctx.tx) };
    });
    if (a.existente) return reply.status(200).send({ raster: paraDto(a.existente, ctxPedido.orgId, ctxPedido.user.id), reutilizada: true });
    const { plano } = a;

    // FASE B — o provedor e o arquivo, FORA de transação. O veredito do limite sai da contagem do banco (FASE A) + as
    // chamadas em voo AGORA, e a vaga é ocupada no mesmo passo síncrono (o objeto é o da SAT-01: o mesmo limite).
    const chaveVoo = [ctxPedido.orgId, plano.area.id, plano.chave].join("|");
    let geracao = emAndamento.get(chaveVoo);
    const abriuChamada = !geracao;
    if (!geracao) {
      if (!limiteAvulso.admitir(ctxPedido.orgId, a.contagem)) throw err("RATE_LIMITED", MSG_LIMITE_ANALISES, { motivo: "limite_erp" });
      geracao = gerar(plano, ctxPedido.orgId, ctxPedido.user.id);
      emAndamento.set(chaveVoo, geracao);
      geracao.finally(() => emAndamento.delete(chaveVoo)).catch(() => undefined);
      limiteAvulso.ocupar(ctxPedido.orgId);
    }
    try {
      let feita: GeracaoFeita;
      try {
        feita = await geracao;
      } catch (e) {
        if (e instanceof FalhaCopernicus) {
          req.log.warn({ satelite: { provedor: PROVEDOR_COPERNICUS, analise_id: plano.analise.id, area_id: plano.area.id, tipo_falha: e.tipo, status: e.status } }, "imagem por satélite não gerada");
          // Falha DEPOIS de um 2xx (PNG ilegível, dimensões trocadas): a chamada foi cobrada. Só o consumo, curto.
          if (abriuChamada && e.puCabecalho !== undefined) await gravarConsumoSemRaster(e.puCabecalho);
          if (e.tentarAposSegundos !== null) reply.header("retry-after", String(e.tentarAposSegundos));
          throw erroDoProvedor(e);
        }
        if (e instanceof FalhaArmazenamentoRaster) {
          req.log.error({ satelite: { analise_id: plano.analise.id, area_id: plano.area.id, etapa: "armazenamento", ...resumoDoErro(e.causa) } }, "imagem por satélite gerada e não guardada");
          if (abriuChamada) await gravarConsumoSemRaster(e.puCabecalho);
          throw err("CONSULTA_INDISPONIVEL", MSG_ARMAZENAMENTO_FALHOU, { motivo: "armazenamento" });
        }
        throw e;
      }

      // FASE C — a linha da imagem e o consumo (operação process) NA MESMA TRANSAÇÃO. Os conflitos saem DEPOIS do commit:
      // a imagem não foi registrada, mas a chamada gastou e o consumo fica. Fora do escopo (404) não grava nada.
      let desfecho: DesfechoGravacao;
      try {
        desfecho = await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx): Promise<DesfechoGravacao> => {
          const analise = await lerAnalise(ctx, analiseId);
          const area = await lerArea(ctx, analise.area_id);
          if (!area) throw err("NOT_FOUND", MSG_ANALISE_NAO_ENCONTRADA);
          const consumo = () => (abriuChamada
            ? gravarConsumo(ctx.tx, { organizationId: ctx.orgId, empresaId: analise.empresa_id, consultaId: null, consultaItemId: null, puCabecalho: feita.puCabecalho, operacao: "process" })
            : Promise.resolve(null));
          if (area.geometria_sha256 !== plano.analise.geometria_sha256) {
            await consumo();
            return { conflito: validation(MSG_GEOMETRIA_ALTERADA, { motivo: "geometria_alterada" }) };
          }
          const nova = await gravarRaster(ctx, plano, feita);
          const existente = nova ? null : await lerRasterDaChave(ctx, plano.chave);
          await consumo();
          if (nova) return { linha: nova, reutilizada: false };
          if (!existente) return { conflito: err("CONCURRENCY_CONFLICT", MSG_RASTER_DISPUTADO) };
          return { linha: existente, reutilizada: true };
        });
      } catch (e) {
        // Erro que não é recusa do ERP DEPOIS de um 2xx (banco, defeito na gravação): a transação desfez o consumo junto,
        // e a chamada foi cobrada — o consumo vai sozinho, numa transação curta. A recusa (404) não grava nada.
        if (abriuChamada && !(e instanceof DomainError)) {
          req.log.error({ satelite: { analise_id: plano.analise.id, area_id: plano.area.id, etapa: "gravacao", ...resumoDoErro(e) } }, "imagem por satélite: gravação falhou");
          await gravarConsumoSemRaster(feita.puCabecalho);
        }
        throw e;
      }
      if ("conflito" in desfecho) throw desfecho.conflito;
      return reply.status(desfecho.reutilizada ? 200 : 201)
        .send({ raster: paraDto(desfecho.linha, ctxPedido.orgId, ctxPedido.user.id), reutilizada: desfecho.reutilizada });
    } finally {
      // A vaga em voo só sai depois da FASE C: aí o consumo já está no ledger (ou a chamada terminou sem 2xx).
      if (abriuChamada) limiteAvulso.liberar(ctxPedido.orgId);
    }

    /** O consumo de uma chamada cobrada sem imagem registrada — transação curta, empresa da análise relida no escopo. */
    async function gravarConsumoSemRaster(puCabecalho: string | null): Promise<void> {
      await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx) => {
        let analise: LinhaAnaliseRaster;
        try {
          analise = await lerAnalise(ctx, analiseId);
        } catch (e) {
          if (!(e instanceof DomainError) || e.code !== "NOT_FOUND") throw e;
          req.log.warn({ satelite: { provedor: PROVEDOR_COPERNICUS, analise_id: analiseId } }, "consumo do provedor não gravado: a análise saiu do escopo durante a chamada");
          return;
        }
        await gravarConsumo(ctx.tx, { organizationId: ctx.orgId, empresaId: analise.empresa_id, consultaId: null, consultaItemId: null, puCabecalho, operacao: "process" });
      });
    }
  });

  /**
   * A chamada, o PNG e o arquivo — SEM transação aberta (o `gravar` abre a sua, curta, DEPOIS da resposta do provedor).
   * 2xx com PNG ilegível ou de outro tamanho → `resposta_malformada` com o PU (cobrada); arquivo não guardado →
   * `FalhaArmazenamentoRaster` com o PU. Nada do corpo da resposta vai para log ou erro.
   */
  async function gerar(plano: PlanoRaster, orgId: string, userId: string): Promise<GeracaoFeita> {
    const registrar = (c: RegistroChamada) => app.log.info({
      satelite: { provedor: PROVEDOR_COPERNICUS, endpoint: c.endpoint, status: c.status, duracao_ms: c.duracaoMs, tentativa: c.tentativa, tipo_falha: c.tipoFalha, analise_id: plano.analise.id, area_id: plano.area.id }
    }, "chamada ao provedor de satélite");
    const r = await cliente.processoComConsumo(montarCorpoProcesso(plano.grade, plano.janela), registrar);
    let img: { largura: number; altura: number };
    try {
      img = lerPngCinza8(r.png);
    } catch {
      throw new FalhaCopernicus("resposta_malformada", null, null, r.puCabecalho);
    }
    if (img.largura !== plano.grade.largura || img.altura !== plano.grade.altura) throw new FalhaCopernicus("resposta_malformada", null, null, r.puCabecalho);
    try {
      await armazenamento.gravar(app.db, { orgId, userId, empresaId: plano.analise.empresa_id }, { storagePath: plano.storagePath, png: r.png, sha256: sha256Hex(r.png) });
    } catch (e) {
      throw new FalhaArmazenamentoRaster(r.puCabecalho, e);
    }
    return { puCabecalho: r.puCabecalho };
  }

  /**
   * A linha da imagem, com o hash e o caminho LIDOS da linha do arquivo (o arquivo guardado é a verdade: numa nova
   * tentativa o caminho já existia, e o conteúdo é o primeiro). A FK da 0055 garante o arquivo; a conferência abaixo
   * só troca o 23503 por um erro legível. `on conflict` na chave → null (quem chama relê).
   */
  async function gravarRaster(ctx: ServiceCtx, p: PlanoRaster, feita: GeracaoFeita): Promise<LinhaRaster | null> {
    const params: unknown[] = [ctx.orgId, p.analise.empresa_id, p.storagePath];
    const escopoArquivo = empresaScopeSql(ctx, "f", params);
    const arquivo = await ctx.tx.query("select 1 from erp.satelite_raster_arquivos f where f.organization_id = $1 and f.empresa_id = $2 and f.storage_path = $3" + escopoArquivo, params);
    if (arquivo.rowCount !== 1) throw new Error("raster: o arquivo gravado não está visível na fase de registro");
    const g = p.grade;
    const valores: unknown[] = [
      ctx.orgId, p.analise.empresa_id, ctx.user.id, p.analise.id, p.area.id, p.analise.geometria_sha256, p.analise.indice, TIPO_RASTER,
      VERSAO_EVALSCRIPT_RASTER, p.dataImagem, p.storagePath, g.largura, g.altura, g.bbox3857[0], g.bbox3857[1], g.bbox3857[2], g.bbox3857[3],
      JSON.stringify(g.cantosLngLat), ESCALA_NDVI_RASTER.min, ESCALA_NDVI_RASTER.max, g.resolucaoM, p.chave, lerPuDoCabecalho(feita.puCabecalho).pu
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

  app.get("/mapa/analises-satelitais/:analiseId/raster", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    semQuery.parse(req.query);
    const analiseId = idDoCaminho(req, "analiseId", MSG_ANALISE_NAO_ENCONTRADA);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      // A chave é a que o POST calcularia AGORA. Sem observação, outro método ou polígono mudado não há chave desta
      // análise: a imagem não existe (404), e nada é gerado aqui.
      let plano: PlanoRaster;
      try {
        plano = await planejar(ctx, analiseId);
      } catch (e) {
        if (e instanceof DomainError && e.code === "VALIDATION_ERROR") throw err("NOT_FOUND", MSG_RASTER_NAO_ENCONTRADO);
        throw e;
      }
      const raster = await lerRasterDaChave(ctx, plano.chave);
      if (!raster) throw err("NOT_FOUND", MSG_RASTER_NAO_ENCONTRADO);
      return paraDto(raster, ctx.orgId, ctx.user.id);
    });
  });

  /**
   * A imagem MAIS RECENTE (data da imagem, depois o registro) de cada área pedida, numa consulta só. As áreas pedidas
   * (até 200) são filtradas na própria `erp.areas` (viva, da organização, no escopo de empresa) e cada uma busca a SUA
   * imagem mais recente por `lateral … limit 1` com o prefixo inteiro do índice da 0055 (organização, empresa DA ÁREA,
   * área, índice); o `cross join` deixa de fora a área sem imagem ANTES do `limit` (a página nunca sai curta por
   * recorte posterior). O escopo de empresa entra em CADA ocorrência de tabela (área e imagem). Não gera nada.
   */
  app.get("/mapa/rasters", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = listaQuery.parse(req.query);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const params: unknown[] = [ctx.orgId, q.area_ids, q.indice];
      const escopoArea = empresaScopeSql(ctx, "a", params);
      const escopoRaster = empresaScopeSql(ctx, "r", params);
      params.push(q.tamanho + 1, (q.pagina - 1) * q.tamanho);
      const limite = `$${params.length - 1}`, deslocamento = `$${params.length}`;
      const r = await ctx.tx.query<LinhaRaster>(
        `select ${colunasRaster("x")}
           from erp.areas a
           cross join lateral (
             select ${colunasRaster("r")}
               from erp.satelite_rasters r
              where r.organization_id = $1 and r.empresa_id = a.empresa_id and r.area_id = a.id and r.indice = $3${escopoRaster}
              order by r.data_imagem desc, r.created_at desc, r.id desc
              limit 1
           ) x
          where a.organization_id = $1 and a.id = any($2::uuid[]) and a.deleted_at is null${escopoArea}
          order by a.code, a.id
          limit ${limite} offset ${deslocamento}`, params);
      const itens = r.rows.slice(0, q.tamanho).map((l) => paraDto(l, ctx.orgId, ctx.user.id));
      return { itens, pagina: q.pagina, tamanho: q.tamanho, tem_mais: r.rows.length > q.tamanho };
    });
  });

  /**
   * O PNG pela URL ASSINADA — sem cabeçalho de autenticação (o MapLibre busca a imagem direto). O token prova quem pediu
   * e até quando; a leitura é SOB A RLS desse usuário (GUC de organização, usuário e módulo da permissão de ver), com o
   * vínculo, a capacidade e o escopo de empresa conferidos AGORA (`lib/contexto-membro.ts`, a leitura do plugin de
   * autenticação). Token ausente, malformado, adulterado, vencido, de outro raster ou de quem perdeu o acesso: a MESMA 404.
   */
  app.get("/mapa/rasters/:rasterId/arquivo", async (req, reply) => {
    const q = arquivoQuery.parse(req.query);
    const rasterId = idDoCaminho(req, "rasterId", MSG_RASTER_NAO_ENCONTRADO);
    const conteudo = assinador.verificar(q.t, rasterId);
    if (!conteudo) throw err("NOT_FOUND", MSG_RASTER_NAO_ENCONTRADO);
    const png = await withTx(app.db, { orgId: conteudo.organizationId, userId: conteudo.userId, modulo: moduloLeitura }, async (tx) => {
      const usuario = await tx.query<{ id: string; email: string; name: string }>("select id, email, name from erp.users where id = $1 and is_active", [conteudo.userId]);
      const user = usuario.rows[0];
      if (!user) return null;
      const dados = await lerDadosDoMembro(tx, conteudo.organizationId, conteudo.userId);
      if (!dados) return null;
      const ctx: ServiceCtx = {
        user, orgId: conteudo.organizationId, empresaId: null, membership: vinculoDoMembro(dados), permissions: new Set(dados.perms),
        moduloEmpresa: moduloLeitura, tx
      };
      if (!hasPermission(ctx, PERMISSAO_VER_ANALISE)) return null;
      const sc = scopedById(ctx, "r", rasterId);
      const r = await tx.query<{ empresa_id: string; storage_path: string }>(
        `select r.empresa_id, r.storage_path from erp.satelite_rasters r where r.id = $1 and r.organization_id = $2${sc.sql}`, sc.params);
      const linha = r.rows[0];
      if (!linha) return null;
      return armazenamento.ler(tx, { orgId: ctx.orgId, storagePath: linha.storage_path, empresaId: linha.empresa_id });
    });
    if (!png) throw err("NOT_FOUND", MSG_RASTER_NAO_ENCONTRADO);
    const restante = Math.max(1, conteudo.expira - Math.floor(Date.now() / 1000));
    return reply
      .header("content-type", FORMATO_RASTER)
      .header("cache-control", `private, max-age=${restante}`)
      .header("x-content-type-options", "nosniff")
      .send(png);
  });
}
