import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  COLECAO_SENTINEL2_L2A, CRITERIO_OBSERVACAO_UTIL, HISTORICO_ANALISE_SATELITAL_MAXIMO, HISTORICO_ANALISE_SATELITAL_PADRAO,
  INDICES_SATELITE, INDICE_NDVI, PROVEDOR_COPERNICUS, RESOLUCAO_PADRAO_M, RESUMO_ANALISE_SATELITAL_MAXIMO, RESUMO_ANALISE_SATELITAL_PADRAO,
  VERSAO_METODO_NDVI
} from "@agro/domain";
import { runService } from "../lib/service.js";
import { DomainError, denied, err, validation } from "../lib/errors.js";
import { empresaScopeSql, hasPermission, scopedById, type ServiceCtx } from "../lib/context.js";
import { LimitePorMinuto } from "../lib/consultas/http.js";
import { FalhaCopernicus, type RegistroChamada } from "../lib/satelite/copernicus.js";
import { gravarConsumo } from "../lib/satelite/consumo.js";
import { classificarLimite, lerContagemChamadas } from "../lib/satelite/limite-global.js";
import { TENTATIVAS_AVULSAS_POR_MINUTO_INSTANCIA, limitesDaConfig } from "../lib/satelite/limites.js";
import { LADO_MAXIMO_PX, lerPoligono, planejarGrade, type GradeDaAnalise, type PoligonoGeoJson } from "../lib/satelite/geometria.js";
import { escolherObservacao, interpretarEstatistica, janelaPadrao, montarCorpoEstatistica, type Janela, type ResultadoNdvi } from "../lib/satelite/ndvi.js";

/**
 * ANÁLISE POR SATÉLITE DA ÁREA (SAT-01, decisão 293) — Copernicus Sentinel-2 L2A, NDVI. Só API: sem tela nesta fatia.
 *
 *   POST /api/mapa/areas/:areaId/analises-satelitais/ndvi    pede a análise da janela padrão (corpo vazio)
 *   GET  /api/mapa/areas/:areaId/analises-satelitais/ultima  última execução + última observação útil
 *   GET  /api/mapa/areas/:areaId/analises-satelitais         histórico de observações úteis (paginado no servidor)
 *   GET  /api/mapa/analises-satelitais/resumo                 MAPA-GERAL (decisão 294): o resumo de TODAS as áreas do
 *                                                             escopo numa consulta só (o mapa nunca pergunta área por área)
 *
 * O CLIENTE MANDA SÓ O ID DA ÁREA. Empresa, polígono, provedor, coleção, fórmula e credencial nunca vêm do pedido:
 * o corpo do POST é `{}` estrito (qualquer chave → 422, nunca descartada em silêncio). A geometria é a de
 * `erp.areas`, lida pelo servidor DEPOIS da autorização — a rota não é proxy de satélite para polígono arbitrário.
 *
 * AUTORIZAÇÃO = CAPACIDADE (`analises_satelitais.view` / `.create`) ∧ ESCOPO (módulo pecuária, o da área: a
 * permissão define o módulo, e a RLS da área e da análise recortam por ele). Área inexistente, de outra organização,
 * fora do escopo, excluída ou id malformado: a MESMA 404 "Área não encontrada" (também a do gatilho da 0052).
 *
 * TRÊS FASES, e nenhuma transação aberta esperando o provedor:
 *   A. `runService`: permissão, escopo, área viva e o hash do polígono calculado pelo banco; reaproveitamento; e a
 *      contagem do LIMITE GLOBAL de chamadas (SAT-03, decisão 296: contado pelo banco, todas as réplicas juntas —
 *      `limite-global.ts`), decidido no começo da FASE B com as chamadas em voo desta instância somadas.
 *   B. fora de transação: a chamada ao Copernicus (o cliente COMPARTILHADO do processo, `app.clienteCopernicus`: um
 *      token só para esta rota e o executor da fila; tempo máximo e tentativas limitadas).
 *   C. `runService` de novo: a área RELIDA no escopo (404 se saiu dele), o polígono conferido pelo hash (409 se mudou),
 *      a gravação com conferência de ROW COUNT e, NA MESMA TRANSAÇÃO, a linha do ledger `erp.satelite_consumo` com o PU
 *      do cabeçalho da resposta (SAT-03): o provedor respondeu 2xx, a chamada gastou — inclusive quando a análise já
 *      existia ou o polígono mudou no meio (o 409 sai DEPOIS do commit do consumo).
 * Falha do provedor não grava ANÁLISE: a anterior continua sendo a última (o histórico nunca perde linha). Se a falha
 * veio DEPOIS de um 2xx (corpo ilegível, processamento parcial, corpo fora do contrato), a chamada foi cobrada: só a
 * linha do ledger é gravada, numa transação curta, e a resposta é o mesmo 503.
 *
 * DUPLICIDADE: uma análise por área, método, polígono (hash) e janela (dias UTC inteiros) — a restrição
 * `uq_analises_satelitais_janela`. Repetir o pedido no mesmo dia, com o mesmo polígono, devolve a análise já gravada
 * (200, `reutilizada`) SEM chamar o provedor; dois pedidos ao mesmo tempo compartilham a chamada nesta instância, e
 * a corrida entre instâncias cai no `on conflict do nothing` + releitura. No máximo uma chamada ao provedor por área e
 * polígono por dia; o polígono redesenhado conta como outro.
 */
export const PERMISSAO_VER_ANALISE = "analises_satelitais.view";
export const PERMISSAO_PEDIR_ANALISE = "analises_satelitais.create";

export const MSG_AREA_NAO_ENCONTRADA = "Área não encontrada";
export const MSG_AREA_SEM_POLIGONO = "A área não tem polígono desenhado; sem geometria não há análise por satélite.";
export const MSG_POLIGONO_FORA_DO_FORMATO = "O polígono da área está fora do formato aceito (GeoJSON Polygon); redesenhe a área.";
export const MSG_AREA_PEQUENA = `A área é pequena demais para a resolução de ${RESOLUCAO_PADRAO_M} m: não cabem ${CRITERIO_OBSERVACAO_UTIL.pixelsValidosMinimos} pixels dentro do polígono.`;
export const MSG_AREA_GRANDE = `A área é grande demais para uma análise só: o retângulo que a envolve passa de ${LADO_MAXIMO_PX} pixels de ${RESOLUCAO_PADRAO_M} m num dos lados.`;
export const MSG_ANALISE_DESLIGADA = "A análise por satélite está desligada neste ambiente.";
export const MSG_PROVEDOR_INDISPONIVEL = "O provedor de imagens de satélite não respondeu como esperado; nenhuma análise foi gravada e as anteriores continuam valendo. Tente de novo mais tarde.";
export const MSG_LIMITE_ANALISES = "Limite de análises por satélite por minuto atingido; tente em instantes.";
export const MSG_LIMITE_PROVEDOR = "O provedor de imagens de satélite limitou as requisições; tente de novo em instantes.";
export const MSG_POLIGONO_MUDOU = "O polígono da área mudou durante a análise; peça a análise de novo.";
export const MSG_JANELA_DISPUTADA = "A análise desta janela foi disputada por outro pedido; peça a análise de novo.";

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const corpoVazio = z.object({}).strict();
const semQuery = z.object({}).strict();
const indiceSchema = z.enum(INDICES_SATELITE as [string, ...string[]]).default(INDICE_NDVI);
const ultimaQuery = z.object({ indice: indiceSchema }).strict();
const historicoQuery = z.object({
  indice: indiceSchema,
  limite: z.coerce.number().int().min(1).max(HISTORICO_ANALISE_SATELITAL_MAXIMO).default(HISTORICO_ANALISE_SATELITAL_PADRAO),
  /** cursor: devolve as observações com início ANTES deste instante (o `proximo_cursor` da página anterior) */
  antes: z.iso.datetime({ offset: true }).optional()
}).strict();

/**
 * Inteiro positivo na forma CANÔNICA (só dígitos, sem zero à esquerda): `1e2`, `0x2`, ` 3` ou `2.0` são recusados
 * (422), nunca traduzidos — contrato de entrada não canônico é recusado.
 */
const inteiroPositivo = (maximo: number) => z.string().regex(/^[1-9]\d{0,8}$/).transform(Number).pipe(z.number().int().min(1).max(maximo));
const resumoQuery = z.object({
  indice: indiceSchema,
  pagina: inteiroPositivo(1_000_000).default(1),
  tamanho: inteiroPositivo(RESUMO_ANALISE_SATELITAL_MAXIMO).default(RESUMO_ANALISE_SATELITAL_PADRAO)
}).strict();

interface LinhaResumo {
  area_id: string; hash_atual: string | null;
  ultima_situacao: string; ultima_motivo: string | null; ultima_criado: Date;
  u_observacao_inicio: Date | null; u_observacao_fim: Date | null; u_valor_medio: string | null; u_valor_minimo: string | null;
  u_valor_maximo: string | null; u_desvio_padrao: string | null; u_cobertura_valida: string | null; u_pixels_validos: number | null;
  u_geometria_sha256: string | null; u_criado: Date | null;
  a_observacao_inicio: Date | null; a_valor_medio: string | null;
  variacao: string | null;
}

export interface AreaLida { id: string; empresa_id: string; geometria: unknown; geometria_sha256: string | null }

interface LinhaAnalise {
  id: string; area_id: string; provedor: string; colecao: string; indice: string; versao_metodo: string; geometria_sha256: string;
  janela_inicio: Date; janela_fim: Date; resolucao_m: string; situacao: string; motivo_qualidade: string | null;
  observacao_inicio: Date | null; observacao_fim: Date | null;
  valor_medio: string | null; valor_minimo: string | null; valor_maximo: string | null; desvio_padrao: string | null;
  pixels_amostra: number | null; pixels_sem_dado: number | null; pixels_validos: number | null; pixels_geometria: number | null;
  cobertura_valida: string | null; created_at: Date;
}

const COLUNAS = ["id", "area_id", "provedor", "colecao", "indice", "versao_metodo", "geometria_sha256", "janela_inicio", "janela_fim",
  "resolucao_m", "situacao", "motivo_qualidade", "observacao_inicio", "observacao_fim", "valor_medio", "valor_minimo", "valor_maximo",
  "desvio_padrao", "pixels_amostra", "pixels_sem_dado", "pixels_validos", "pixels_geometria", "cobertura_valida", "created_at"];
const colunas = (alias: string) => COLUNAS.map((c) => `${alias}.${c}`).join(", ");

/**
 * DTO do ERP — nunca o corpo do provedor. Números decimais como STRING (o `numeric` do banco, sem ponto flutuante);
 * datas em ISO 8601. `observacao_*` é o intervalo da IMAGEM devolvido pelo provedor; `criado_em` é o registro.
 * `do_poligono_atual`: a análise foi feita sobre o polígono que a área tem HOJE (o hash confere).
 */
function paraDto(l: LinhaAnalise, hashAtual: string | null) {
  return {
    id: l.id, area_id: l.area_id, provedor: l.provedor, colecao: l.colecao, indice: l.indice, versao_metodo: l.versao_metodo,
    janela_inicio: l.janela_inicio.toISOString(), janela_fim: l.janela_fim.toISOString(), resolucao_m: l.resolucao_m,
    situacao: l.situacao, motivo_qualidade: l.motivo_qualidade,
    observacao_inicio: l.observacao_inicio?.toISOString() ?? null, observacao_fim: l.observacao_fim?.toISOString() ?? null,
    valor_medio: l.valor_medio, valor_minimo: l.valor_minimo, valor_maximo: l.valor_maximo, desvio_padrao: l.desvio_padrao,
    pixels_amostra: l.pixels_amostra, pixels_sem_dado: l.pixels_sem_dado, pixels_validos: l.pixels_validos, pixels_geometria: l.pixels_geometria,
    cobertura_valida: l.cobertura_valida,
    do_poligono_atual: hashAtual !== null && l.geometria_sha256 === hashAtual,
    criado_em: l.created_at.toISOString()
  };
}

export function exigir(app: FastifyInstance, req: FastifyRequest, permissao: string) {
  const ctx = app.requireCtx(req);
  if (!hasPermission(ctx, permissao)) throw denied(permissao);
  return ctx;
}

function idDaArea(req: FastifyRequest): string {
  const id = String((req.params as { areaId?: string }).areaId ?? "");
  if (!FORMA_UUID.test(id)) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
  return id;
}

/** A área viva, no escopo do módulo da permissão, com o hash do polígono calculado PELO BANCO (o mesmo do gatilho). */
async function lerAreaNoEscopo(ctx: ServiceCtx, areaId: string): Promise<AreaLida> {
  const sc = scopedById(ctx, "a", areaId);
  const r = await ctx.tx.query<AreaLida>(
    `select a.id, a.empresa_id, a.geometria,
            case when a.geometria is null then null else encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex') end as geometria_sha256
       from erp.areas a
      where a.id = $1 and a.organization_id = $2 and a.deleted_at is null${sc.sql}`, sc.params);
  if (!r.rows[0]) throw err("NOT_FOUND", MSG_AREA_NAO_ENCONTRADA);
  return r.rows[0];
}

/** A análise da chave de duplicidade (área, método, polígono, janela), no escopo — ou nenhuma. */
async function lerAnaliseDaJanela(ctx: ServiceCtx, area: AreaLida, janela: Janela): Promise<LinhaAnalise | null> {
  const params: unknown[] = [ctx.orgId, area.id, PROVEDOR_COPERNICUS, COLECAO_SENTINEL2_L2A, INDICE_NDVI, VERSAO_METODO_NDVI, area.geometria_sha256, janela.inicio, janela.fim];
  const escopo = empresaScopeSql(ctx, "s", params);
  const r = await ctx.tx.query<LinhaAnalise>(
    `select ${colunas("s")} from erp.analises_satelitais s
      where s.organization_id = $1 and s.area_id = $2 and s.provedor = $3 and s.colecao = $4 and s.indice = $5 and s.versao_metodo = $6
        and s.geometria_sha256 = $7 and s.janela_inicio = $8 and s.janela_fim = $9${escopo}`, params);
  return r.rows[0] ?? null;
}

/**
 * Polígono pronto para o provedor, ou a recusa (422) que nenhuma imagem mudaria. Exportada para a consulta em lote
 * (SAT-02, decisão 295) aplicar os MESMOS critérios ao separar as áreas ignoradas.
 */
export function prepararPoligono(area: AreaLida): { poligono: PoligonoGeoJson; grade: GradeDaAnalise } {
  if (area.geometria === null || area.geometria_sha256 === null) throw validation(MSG_AREA_SEM_POLIGONO, [{ path: "geometria", message: MSG_AREA_SEM_POLIGONO }]);
  const poligono = lerPoligono(area.geometria);
  if (!poligono) throw validation(MSG_POLIGONO_FORA_DO_FORMATO, [{ path: "geometria", message: MSG_POLIGONO_FORA_DO_FORMATO }]);
  const grade = planejarGrade(poligono, RESOLUCAO_PADRAO_M);
  if (!(grade.pixelsGeometria >= CRITERIO_OBSERVACAO_UTIL.pixelsValidosMinimos)) throw validation(MSG_AREA_PEQUENA, [{ path: "geometria", message: MSG_AREA_PEQUENA }]);
  // `!(… <= …)` também recusa NaN/Infinity (polígono degenerado ou perto do polo): fora da grade é fora.
  if (!(grade.larguraPx >= 1 && grade.larguraPx <= LADO_MAXIMO_PX && grade.alturaPx >= 1 && grade.alturaPx <= LADO_MAXIMO_PX)) {
    throw validation(MSG_AREA_GRANDE, [{ path: "geometria", message: MSG_AREA_GRANDE }]);
  }
  return { poligono, grade };
}

/** Falha do provedor → erro estável do ERP. Nada do corpo do provedor, do token ou da credencial vai junto. */
function erroDoProvedor(f: FalhaCopernicus): DomainError {
  if (f.tipo === "limite") return err("RATE_LIMITED", MSG_LIMITE_PROVEDOR, { motivo: "limite_provedor", tentar_apos_segundos: f.tentarAposSegundos });
  return err("CONSULTA_INDISPONIVEL", MSG_PROVEDOR_INDISPONIVEL, { motivo: f.tipo });
}

async function gravarAnalise(ctx: ServiceCtx, area: AreaLida, janela: Janela, r: ResultadoNdvi): Promise<LinhaAnalise | null> {
  const c = r.situacao === "concluida" ? r : null;
  const valores: unknown[] = [
    ctx.orgId, area.empresa_id, area.id, PROVEDOR_COPERNICUS, COLECAO_SENTINEL2_L2A, INDICE_NDVI, VERSAO_METODO_NDVI, area.geometria_sha256,
    janela.inicio, janela.fim, String(RESOLUCAO_PADRAO_M), r.situacao, r.situacao === "sem_observacao_util" ? r.motivo : null,
    c?.observacao.inicio ?? null, c?.observacao.fim ?? null,
    c?.valores.medio ?? null, c?.valores.minimo ?? null, c?.valores.maximo ?? null, c?.valores.desvio ?? null,
    c?.pixels.amostra ?? null, c?.pixels.semDado ?? null, c?.pixels.validos ?? null,
    c ? c.pixels.geometria : r.situacao === "sem_observacao_util" ? r.pixelsGeometria : null,
    c?.cobertura ?? null, JSON.stringify(r.metadados), ctx.user.id
  ];
  const g = await ctx.tx.query<LinhaAnalise>(
    `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
        janela_inicio, janela_fim, resolucao_m, situacao, motivo_qualidade, observacao_inicio, observacao_fim,
        valor_medio, valor_minimo, valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria,
        cobertura_valida, metadados_provedor, criado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25::jsonb, $26)
     on conflict on constraint uq_analises_satelitais_janela do nothing
     returning ${COLUNAS.join(", ")}`, valores);
  if (g.rowCount === 1) return g.rows[0]!;
  if (g.rowCount !== 0) throw new Error("análise satelital: gravação devolveu mais de uma linha");
  return null; // a chave já existia: quem chama relê
}

/** O que a chamada ao provedor devolve à FASE C: o resultado interpretado e o cabeçalho de PU da resposta 2xx. */
interface ChamadaNdvi { resultado: ResultadoNdvi; puCabecalho: string | null }
/** O desfecho da FASE C: a análise (nova ou já gravada) ou o conflito, que só vira 409 depois do commit do consumo. */
type DesfechoGravacao = { linha: LinhaAnalise; reutilizada: boolean } | { conflito: string };

export default async function analisesSatelitaisRoutes(app: FastifyInstance) {
  const { COPERNICUS_ENABLED } = app.config;
  // O cliente COMPARTILHADO do processo (server.ts): o mesmo token desta rota e do executor da fila (SAT-03).
  const cliente = app.clienteCopernicus;
  const limites = limitesDaConfig(app.config);
  // Estado por INSTÂNCIA: as chamadas em andamento (o mesmo pedido simultâneo compartilha a chamada) e as chamadas EM VOO
  // (abertas, consumo ainda não gravado: o banco não as vê, então entram na conta do limite global como 'executando').
  // O limite é o GLOBAL, contado pelo banco (SAT-03), E um PISO por instância em TENTATIVAS por organização por minuto:
  // o ledger só conta resposta 2xx, e recusa, 429, 5xx, tempo e rede também precisam de taxa (como na SAT-01).
  const emAndamento = new Map<string, Promise<ChamadaNdvi>>();
  const tentativasPorOrganizacao = new LimitePorMinuto(TENTATIVAS_AVULSAS_POR_MINUTO_INSTANCIA);
  const emVoo = { conta: 0, porOrganizacao: new Map<string, number>() };
  const ocuparVoo = (org: string) => { emVoo.conta++; emVoo.porOrganizacao.set(org, (emVoo.porOrganizacao.get(org) ?? 0) + 1); };
  const liberarVoo = (org: string) => {
    emVoo.conta--;
    const n = (emVoo.porOrganizacao.get(org) ?? 1) - 1;
    if (n > 0) emVoo.porOrganizacao.set(org, n); else emVoo.porOrganizacao.delete(org);
  };

  app.post("/mapa/areas/:areaId/analises-satelitais/ndvi", async (req, reply) => {
    const ctxPedido = exigir(app, req, PERMISSAO_PEDIR_ANALISE);
    semQuery.parse(req.query);
    if (req.body !== undefined && req.body !== null) corpoVazio.parse(req.body);
    const areaId = idDaArea(req);
    if (!COPERNICUS_ENABLED) throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "desligada" });
    if (!cliente.configurado) throw err("CONSULTA_INDISPONIVEL", MSG_ANALISE_DESLIGADA, { motivo: "configuracao" });
    const janela = janelaPadrao(Date.now());

    // FASE A — autorizar e ler (transação curta). O escopo vem de scopedById/empresaScope dentro dos leitores. A contagem
    // do limite global só é lida para quem PODE chamar o provedor (sem análise da janela): reaproveitar não gasta nada.
    const a = await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx) => {
      const area = await lerAreaNoEscopo(ctx, areaId);
      const preparo = prepararPoligono(area);
      const existente = await lerAnaliseDaJanela(ctx, area, janela);
      return { area, preparo, existente, contagem: existente ? null : await lerContagemChamadas(ctx.tx) };
    });
    if (a.existente) return reply.status(200).send({ analise: paraDto(a.existente, a.area.geometria_sha256), reutilizada: true });

    // FASE B — o provedor, FORA de transação. Mesmo pedido em andamento nesta instância: a mesma chamada (não é mais
    // uma chamada, e o limite só barra quem ABRE uma). Quem abre a chamada é quem grava o consumo dela. O veredito sai
    // da contagem do banco (FASE A) + as chamadas em voo AGORA, e a vaga é ocupada no mesmo passo síncrono: dois pedidos
    // simultâneos desta instância nunca passam pela mesma vaga. O piso por instância só conta tentativa se o global deixou.
    const chave = [ctxPedido.orgId, a.area.id, a.area.geometria_sha256, janela.inicio.toISOString()].join("|");
    let chamada = emAndamento.get(chave);
    const abriuChamada = !chamada;
    if (!chamada) {
      const vooDaOrg = emVoo.porOrganizacao.get(ctxPedido.orgId) ?? 0;
      if (!a.contagem || classificarLimite(a.contagem, limites, { conta: emVoo.conta, organizacao: vooDaOrg }) !== "livre"
        || !tentativasPorOrganizacao.permitir(ctxPedido.orgId)) {
        throw err("RATE_LIMITED", MSG_LIMITE_ANALISES, { motivo: "limite_erp" });
      }
      const registrar = (c: RegistroChamada) => req.log.info({
        satelite: { provedor: PROVEDOR_COPERNICUS, endpoint: c.endpoint, status: c.status, duracao_ms: c.duracaoMs, tentativa: c.tentativa, tipo_falha: c.tipoFalha, area_id: a.area.id }
      }, "chamada ao provedor de satélite");
      // A chamada (corpo + PU) e a LEITURA do método são passos separados: a leitura que recusa um 2xx devolve a falha
      // com o PU da resposta (`puCabecalho` presente = cobrada), para quem abriu a chamada gravar o consumo dela.
      chamada = cliente.estatisticaComConsumo(montarCorpoEstatistica(a.preparo.poligono, janela, a.preparo.grade), registrar)
        .then((r) => {
          try {
            return { resultado: escolherObservacao(interpretarEstatistica(r.corpo, janela), a.preparo.grade.pixelsGeometria), puCabecalho: r.puCabecalho };
          } catch (e) {
            if (e instanceof FalhaCopernicus) throw new FalhaCopernicus(e.tipo, e.status, e.tentarAposSegundos, r.puCabecalho);
            throw e;
          }
        });
      emAndamento.set(chave, chamada);
      chamada.finally(() => emAndamento.delete(chave)).catch(() => undefined);
      ocuparVoo(ctxPedido.orgId);
    }
    try {
      let feita: ChamadaNdvi;
      try {
        feita = await chamada;
      } catch (e) {
        if (!(e instanceof FalhaCopernicus)) throw e;
        req.log.warn({ satelite: { provedor: PROVEDOR_COPERNICUS, area_id: a.area.id, tipo_falha: e.tipo, status: e.status } }, "análise por satélite não concluída");
        // Falha DEPOIS de um 2xx: a chamada foi cobrada. Só o consumo, numa transação curta (empresa da área relida no
        // escopo; área fora dele não grava). A resposta continua o mesmo 503.
        if (abriuChamada && e.puCabecalho !== undefined) await gravarConsumoSemAnalise(e.puCabecalho);
        if (e.tentarAposSegundos !== null) reply.header("retry-after", String(e.tentarAposSegundos));
        throw erroDoProvedor(e);
      }

      // FASE C — persistir: a área RELIDA no escopo, o MESMO polígono, ROW COUNT conferido; o consumo da chamada no
      // ledger NA MESMA TRANSAÇÃO (ou entram os dois, ou nenhum). Os dois 409 saem DEPOIS do commit: a análise não foi
      // gravada, mas a chamada gastou e o consumo fica. Área fora do escopo (404) não grava nada.
      const desfecho = await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx): Promise<DesfechoGravacao> => {
        const area = await lerAreaNoEscopo(ctx, areaId);
        const consumo = () => (abriuChamada
          ? gravarConsumo(ctx.tx, { organizationId: ctx.orgId, empresaId: area.empresa_id, consultaId: null, consultaItemId: null, puCabecalho: feita.puCabecalho })
          : Promise.resolve(null));
        if (area.geometria_sha256 !== a.area.geometria_sha256) { await consumo(); return { conflito: MSG_POLIGONO_MUDOU }; }
        const nova = await gravarAnalise(ctx, area, janela, feita.resultado);
        const existente = nova ? null : await lerAnaliseDaJanela(ctx, area, janela);
        await consumo();
        if (nova) return { linha: nova, reutilizada: false };
        if (!existente) return { conflito: MSG_JANELA_DISPUTADA };
        return { linha: existente, reutilizada: true };
      });
      if ("conflito" in desfecho) throw err("CONCURRENCY_CONFLICT", desfecho.conflito);
      return reply.status(desfecho.reutilizada ? 200 : 201).send({ analise: paraDto(desfecho.linha, a.area.geometria_sha256), reutilizada: desfecho.reutilizada });
    } finally {
      // A vaga em voo só sai depois da FASE C: aí o consumo já está no ledger (ou a chamada terminou sem 2xx).
      if (abriuChamada) liberarVoo(ctxPedido.orgId);
    }

    async function gravarConsumoSemAnalise(puCabecalho: string | null): Promise<void> {
      await runService(app, req, PERMISSAO_PEDIR_ANALISE, async (ctx) => {
        let area: AreaLida;
        try {
          area = await lerAreaNoEscopo(ctx, areaId);
        } catch (e) {
          if (!(e instanceof DomainError) || e.code !== "NOT_FOUND") throw e;
          req.log.warn({ satelite: { provedor: PROVEDOR_COPERNICUS, area_id: areaId } }, "consumo do provedor não gravado: a área saiu do escopo durante a chamada");
          return;
        }
        await gravarConsumo(ctx.tx, { organizationId: ctx.orgId, empresaId: area.empresa_id, consultaId: null, consultaItemId: null, puCabecalho });
      });
    }
  });

  app.get("/mapa/areas/:areaId/analises-satelitais/ultima", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = ultimaQuery.parse(req.query);
    const areaId = idDaArea(req);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const area = await lerAreaNoEscopo(ctx, areaId);
      const params: unknown[] = [ctx.orgId, area.id, q.indice];
      const escopo = empresaScopeSql(ctx, "s", params);
      // Duas perguntas, uma consulta: a execução mais recente (qualquer situação) e a observação útil mais recente.
      const r = await ctx.tx.query<LinhaAnalise & { papel: "analise" | "util" }>(
        `(select 'analise' as papel, ${colunas("s")} from erp.analises_satelitais s
           where s.organization_id = $1 and s.area_id = $2 and s.indice = $3${escopo}
           order by s.created_at desc, s.id desc limit 1)
         union all
         (select 'util' as papel, ${colunas("s")} from erp.analises_satelitais s
           where s.organization_id = $1 and s.area_id = $2 and s.indice = $3 and s.situacao = 'concluida'${escopo}
           order by s.observacao_inicio desc, s.created_at desc, s.id desc limit 1)`, params);
      const analise = r.rows.find((l) => l.papel === "analise");
      const util = r.rows.find((l) => l.papel === "util");
      return {
        analise: analise ? paraDto(analise, area.geometria_sha256) : null,
        ultima_observacao_util: util ? paraDto(util, area.geometria_sha256) : null
      };
    });
  });

  app.get("/mapa/areas/:areaId/analises-satelitais", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = historicoQuery.parse(req.query);
    const areaId = idDaArea(req);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const area = await lerAreaNoEscopo(ctx, areaId);
      const params: unknown[] = [ctx.orgId, area.id, q.indice];
      const escopo = empresaScopeSql(ctx, "s", params);
      let cursor = "";
      if (q.antes) { params.push(new Date(q.antes)); cursor = ` and s.observacao_inicio < $${params.length}`; }
      params.push(q.limite + 1);
      // Uma linha por OBSERVAÇÃO (a mesma imagem pedida em dias diferentes aparece uma vez: a análise mais recente
      // dela). Só observações úteis: lacuna é lacuna, nunca número interpolado. Página e cursor no servidor.
      const r = await ctx.tx.query<LinhaAnalise>(
        `select * from (
           select distinct on (s.observacao_inicio) ${colunas("s")}
             from erp.analises_satelitais s
            where s.organization_id = $1 and s.area_id = $2 and s.indice = $3 and s.situacao = 'concluida'${escopo}${cursor}
            order by s.observacao_inicio desc, s.created_at desc, s.id desc
         ) t order by t.observacao_inicio desc limit $${params.length}`, params);
      const itens = r.rows.slice(0, q.limite);
      const ultima = itens[itens.length - 1];
      return {
        itens: itens.map((l) => paraDto(l, area.geometria_sha256)),
        proximo_cursor: r.rows.length > q.limite && ultima?.observacao_inicio ? ultima.observacao_inicio.toISOString() : null
      };
    });
  });

  /**
   * MAPA-GERAL (decisão 294) — o resumo de todas as áreas do escopo que têm pelo menos uma execução: a última
   * observação ÚTIL, a útil anterior a ela (outra imagem), a variação do NDVI médio entre as duas e a última execução
   * (qualquer situação, para o mapa dizer "sem observação útil" quando for o caso). UMA consulta para a página inteira:
   * a página de ÁREAS é cortada primeiro (escopo de empresa e `limit` na própria `erp.areas`), e só então cada área da
   * página busca as suas linhas pelos índices da 0052 (`lateral … limit`) — o custo acompanha a página, não o histórico
   * inteiro da organização, e o hash do polígono só é calculado para as áreas da página. O escopo de empresa entra em
   * CADA ocorrência de tabela (área e análise). Área excluída fica de fora. Mesma regra do histórico: uma linha por
   * imagem (a análise mais recente dela). A variação é `numeric` (string), nunca float.
   */
  app.get("/mapa/analises-satelitais/resumo", async (req) => {
    exigir(app, req, PERMISSAO_VER_ANALISE);
    const q = resumoQuery.parse(req.query);
    return runService(app, req, PERMISSAO_VER_ANALISE, async (ctx) => {
      const params: unknown[] = [ctx.orgId, q.indice];
      const escopoArea = empresaScopeSql(ctx, "a", params);
      const escopoExecucao = empresaScopeSql(ctx, "e", params);
      const escopoUteis = empresaScopeSql(ctx, "s", params);
      params.push(q.tamanho + 1, (q.pagina - 1) * q.tamanho);
      const limite = `$${params.length - 1}`, deslocamento = `$${params.length}`;
      // A imagem útil de ordem `n` da área (0 = a mais recente): distinct on por imagem, a análise mais recente dela.
      const util = (n: number) => `
           select distinct on (s.observacao_inicio) s.observacao_inicio, s.observacao_fim, s.valor_medio, s.valor_minimo,
                  s.valor_maximo, s.desvio_padrao, s.cobertura_valida, s.pixels_validos, s.geometria_sha256, s.created_at
             from erp.analises_satelitais s
            where s.organization_id = $1 and s.area_id = ar.id and s.indice = $2 and s.situacao = 'concluida'${escopoUteis}
            order by s.observacao_inicio desc, s.created_at desc, s.id desc
            offset ${n} limit 1`;
      const r = await ctx.tx.query<LinhaResumo>(
        `select ar.id as area_id,
                case when ar.geometria is null then null else encode(sha256(convert_to(ar.geometria::text, 'UTF8')), 'hex') end as hash_atual,
                x.situacao as ultima_situacao, x.motivo_qualidade as ultima_motivo, x.created_at as ultima_criado,
                u.observacao_inicio as u_observacao_inicio, u.observacao_fim as u_observacao_fim, u.valor_medio as u_valor_medio,
                u.valor_minimo as u_valor_minimo, u.valor_maximo as u_valor_maximo, u.desvio_padrao as u_desvio_padrao,
                u.cobertura_valida as u_cobertura_valida, u.pixels_validos as u_pixels_validos, u.geometria_sha256 as u_geometria_sha256,
                u.created_at as u_criado,
                p.observacao_inicio as a_observacao_inicio, p.valor_medio as a_valor_medio,
                (u.valor_medio - p.valor_medio) as variacao
           from (
             select a.id, a.code, a.geometria
               from erp.areas a
              where a.organization_id = $1 and a.deleted_at is null${escopoArea}
                and exists (select 1 from erp.analises_satelitais e
                             where e.organization_id = $1 and e.area_id = a.id and e.indice = $2${escopoExecucao})
              order by a.code, a.id
              limit ${limite} offset ${deslocamento}
           ) ar
           cross join lateral (
             select e.situacao, e.motivo_qualidade, e.created_at
               from erp.analises_satelitais e
              where e.organization_id = $1 and e.area_id = ar.id and e.indice = $2${escopoExecucao}
              order by e.created_at desc, e.id desc
              limit 1
           ) x
           left join lateral (${util(0)}
           ) u on true
           left join lateral (${util(1)}
           ) p on true
          order by ar.code, ar.id`, params);
      const itens = r.rows.slice(0, q.tamanho).map((l) => ({
        area_id: l.area_id,
        ultima_execucao: { situacao: l.ultima_situacao, motivo_qualidade: l.ultima_motivo, criado_em: l.ultima_criado.toISOString() },
        ultima_observacao: l.u_observacao_inicio ? {
          observacao_inicio: l.u_observacao_inicio.toISOString(), observacao_fim: l.u_observacao_fim?.toISOString() ?? null,
          valor_medio: l.u_valor_medio, valor_minimo: l.u_valor_minimo, valor_maximo: l.u_valor_maximo, desvio_padrao: l.u_desvio_padrao,
          cobertura_valida: l.u_cobertura_valida, pixels_validos: l.u_pixels_validos,
          do_poligono_atual: l.hash_atual !== null && l.u_geometria_sha256 === l.hash_atual,
          criado_em: l.u_criado?.toISOString() ?? null
        } : null,
        observacao_anterior: l.a_observacao_inicio ? { observacao_inicio: l.a_observacao_inicio.toISOString(), valor_medio: l.a_valor_medio } : null,
        variacao: l.variacao
      }));
      return { itens, pagina: q.pagina, tamanho: q.tamanho, tem_mais: r.rows.length > q.tamanho };
    });
  });
}
