/**
 * EXECUÇÃO DE UM ITEM DA FILA SATELITAL (SAT-03, decisão 296) — do item reservado à análise gravada (ou à falha
 * registrada), em nome de QUEM CRIOU a consulta (`contexto-worker.ts`).
 *
 * TRÊS FASES, e NENHUMA transação aberta esperando o provedor:
 *   1. transação curta, sob a RLS do criador: a consulta travada, o item (ainda 'executando', no escopo) e a área NO
 *      ESCOPO; a capacidade `analises_satelitais.create` do criador (sem ela → 'falho' `sem_permissao`); item recuperado
 *      de réplica caída além do teto da rodada → 'falho' `execucao_interrompida`; o polígono pelo hash do BANCO
 *      (mudou → 'falho' `geometria_alterada`, e o provedor NÃO é chamado); os critérios da SAT-01 (`prepararPoligono`);
 *      consulta 'pendente' → 'executando'.
 *   2. SEM transação: a Statistical API pelo cliente compartilhado (`estatisticaComConsumo`: o corpo e o cabeçalho de PU),
 *      a leitura estrita e a escolha da v2 (`ndvi-v2.ts`), com a janela do item CONVERTIDA (fim exclusivo).
 *   3. transação curta: a consulta travada, o item RELIDO (a reserva ainda é desta execução: 'executando' com as mesmas
 *      tentativas), a área relida (polígono mudou no meio → consumo gravado + 'falho' `geometria_alterada`), a análise
 *      (`on conflict` na unicidade da janela + releitura), o consumo no ledger, o item 'concluido' e o recálculo.
 * Falha do provedor (ou da fase 3): a decisão de `retry.ts` — repetir → 'pendente' com `proxima_tentativa_em`; falhar
 * → 'falho' com o erro estável —, o consumo quando o provedor respondeu 2xx (a chamada gastou), e o recálculo. Erro que
 * NÃO é do provedor DEPOIS de um 2xx (banco, defeito na gravação) não repete: repetir cobraria a chamada de novo — o item
 * fica 'falho' `erro_gravacao` com o consumo gravado, e "reprocessar falhas" abre outra rodada quando o defeito sair.
 * A falha do provedor da fase 2 volta para quem chama (`falhaDoProvedor`): é dela que o executor tira a pausa.
 *
 * Um item NUNCA derruba o lote nem o processo: toda exceção vira desfecho ("adiado", no pior caso: o item fica
 * 'executando' até o prazo, e a reserva seguinte o devolve para a fila). O LOG leva só ids, tipo de falha, status e
 * desfecho — nunca corpo, token, credencial ou mensagem crua de erro.
 */
import { withTx, type Db, type TenantContext } from "@agro/db";
import {
  BUNDLE_PASTAGEM_ESSENCIAL, COLECAO_SENTINEL2_L2A, INDICE_NDVI, PROVEDOR_COPERNICUS, RESOLUCAO_PADRAO_M,
  VERSAO_METODO_NDVI_V2, VERSAO_METODO_PASTAGEM_ESSENCIAL
} from "@agro/domain";
import { DomainError } from "@agro/shared";
import { empresaScopeSql, hasPermission, scopedById, type ServiceCtx } from "../context.js";
import {
  MSG_AREA_SEM_POLIGONO, MSG_POLIGONO_FORA_DO_FORMATO, msgAreaGrande, msgAreaPequena, prepararPoligono, type AreaLida
} from "../../routes/analises-satelitais.js";
import { gravarBundlePastagem } from "../../routes/satelite-condicao.js";
import { FalhaCopernicus, type ClienteCopernicus, type RegistroChamada } from "./copernicus.js";
import { gravarConsumo } from "./consumo.js";
import { MODULO_EXECUTOR, PERMISSAO_EXECUTAR_ITEM, contextoDoCriador } from "./contexto-worker.js";
import { recalcularConsulta, travarConsulta } from "./fechamento.js";
import type { GradeDaAnalise, PoligonoGeoJson } from "./geometria.js";
import { TENTATIVAS_POR_RODADA } from "./limites.js";
import { interpretarEstatistica, montarCorpoEstatistica, type Janela, type ResultadoNdvi } from "./ndvi.js";
import { EVALSCRIPT_NDVI_SHA256, RESOLUCAO_NATIVA_NDVI_M, escolherObservacaoV2, janelaDoItem } from "./ndvi-v2.js";
import {
  RESOLUCAO_AGREGACAO_M, escolherObservacaoPastagem, interpretarEstatisticaMulti, montarCorpoPastagem,
  type ResultadoPastagem
} from "./pastagem-essencial.js";
import { decidirAposFalha, type DecisaoFalha } from "./retry.js";

/** A linha que a reserva (`erp.satelite_reservar_itens`, migration 0054) devolve: só ids. */
export interface ItemReservado { organization_id: string; empresa_id: string; consulta_id: string; item_id: string; criado_por: string }

export type DesfechoItem = "concluido" | "falho" | "adiado";

/** O desfecho do item e, quando a chamada ao provedor falhou (fase 2), a falha dele — de onde o executor tira a pausa. */
export interface ResultadoItem { desfecho: DesfechoItem; falhaDoProvedor: FalhaCopernicus | null }

/** O que o executor escreve no log: um objeto de ids, tipos e números, e uma frase fixa (o logger da API serve). */
export interface LogSatelite {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface DependenciasItem {
  db: Db;
  cliente: ClienteCopernicus;
  log: LogSatelite;
  agora: () => number;
  aleatorio: () => number;
}

/** Erros ESTÁVEIS gravados no item quando a recusa é do ERP (não do provedor). */
export const ERROS_ITEM = {
  semPermissao: "sem_permissao",
  geometriaAlterada: "geometria_alterada",
  execucaoInterrompida: "execucao_interrompida",
  areaNaoEncontrada: "area_nao_encontrada",
  metodoDesconhecido: "metodo_desconhecido",
  /** Erro que não é do provedor DEPOIS de um 2xx (a chamada já foi cobrada): não repete. */
  erroGravacao: "erro_gravacao"
} as const;

/** A recusa de `prepararPoligono` → código estável do item. Cobre 10 m (NDVI) e 20 m (bundle pastagem). */
const RECUSA_DO_POLIGONO: ReadonlyMap<string, string> = new Map([
  [MSG_AREA_SEM_POLIGONO, "area_sem_poligono"],
  [MSG_POLIGONO_FORA_DO_FORMATO, "poligono_fora_do_formato"],
  [msgAreaPequena(RESOLUCAO_PADRAO_M), "area_pequena"],
  [msgAreaPequena(RESOLUCAO_AGREGACAO_M), "area_pequena"],
  [msgAreaGrande(RESOLUCAO_PADRAO_M), "area_grande"],
  [msgAreaGrande(RESOLUCAO_AGREGACAO_M), "area_grande"]
]);

interface LinhaItem {
  id: string; consulta_id: string; empresa_id: string; area_id: string; geometria_sha256: string; indice_bundle: string; versao_metodo: string;
  data_alvo: string | null; janela_inicio: string; janela_fim: string; situacao: string; tentativas: number; tentativas_rodada: number;
}

interface Pronto { item: LinhaItem; poligono: PoligonoGeoJson; grade: GradeDaAnalise; janela: Janela }
type Fase1 = { tipo: "executar"; pronto: Pronto } | { tipo: "falho"; erro: string } | { tipo: "adiado"; motivo: string };
type ResultadoItemFila = ResultadoNdvi | ResultadoPastagem;
/** O que a chamada deixou: `respondeu` (2xx, com o cabeçalho de PU) mesmo quando a leitura falhou — a chamada gastou. */
interface Chamada { respondeu: { puCabecalho: string | null } | null; resultado: ResultadoItemFila | null; falha: unknown }

function ehPastagem(item: LinhaItem): boolean {
  return item.indice_bundle === BUNDLE_PASTAGEM_ESSENCIAL && item.versao_metodo === VERSAO_METODO_PASTAGEM_ESSENCIAL;
}
function ehNdviV2(item: LinhaItem): boolean {
  return item.indice_bundle === INDICE_NDVI && item.versao_metodo === VERSAO_METODO_NDVI_V2;
}
function ehResultadoPastagem(r: ResultadoItemFila): r is ResultadoPastagem {
  return "indices" in r && Array.isArray(r.indices);
}

const tenantDo = (r: ItemReservado): TenantContext => ({ orgId: r.organization_id, userId: r.criado_por, modulo: MODULO_EXECUTOR });

/** O item no escopo do criador (RLS + predicado de empresa); `travar` = `for update` (só depois de travar a consulta). */
async function lerItem(ctx: ServiceCtx, itemId: string, travar: boolean): Promise<LinhaItem | null> {
  const sc = scopedById(ctx, "i", itemId);
  const r = await ctx.tx.query<LinhaItem>(
    `select i.id, i.consulta_id, i.empresa_id, i.area_id, i.geometria_sha256, i.indice_bundle, i.versao_metodo, i.data_alvo, i.janela_inicio,
            i.janela_fim, i.situacao, i.tentativas, i.tentativas_rodada
       from erp.satelite_consulta_itens i
      where i.id = $1 and i.organization_id = $2${sc.sql}${travar ? " for update of i" : ""}`, sc.params);
  return r.rows[0] ?? null;
}

/** A área viva, no escopo, com o hash do polígono calculado PELO BANCO (a expressão da 0052 e do gatilho). */
async function lerArea(ctx: ServiceCtx, areaId: string): Promise<AreaLida | null> {
  const sc = scopedById(ctx, "a", areaId);
  const r = await ctx.tx.query<AreaLida>(
    `select a.id, a.empresa_id, a.geometria,
            case when a.geometria is null then null else encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex') end as geometria_sha256
       from erp.areas a
      where a.id = $1 and a.organization_id = $2 and a.deleted_at is null${sc.sql}`, sc.params);
  return r.rows[0] ?? null;
}

/**
 * A mudança de situação do item, só se a reserva ainda é DESTA execução ('executando' e, quando conhecidas, as mesmas
 * tentativas — outra reserva somaria uma). ROW COUNT conferido: o item já travado e não alcançado é defeito.
 */
async function mudarItem(ctx: ServiceCtx, item: LinhaItem, m: { situacao: "pendente" | "falho" | "concluido"; erro: string | null; proxima: Date | null; analiseId?: string; puGasto?: string | null }) {
  const params: unknown[] = [item.id, ctx.orgId, item.tentativas, m.situacao, m.erro, m.proxima, m.analiseId ?? null, m.puGasto ?? null];
  const escopo = empresaScopeSql(ctx, "i", params);
  const r = await ctx.tx.query(
    `update erp.satelite_consulta_itens i
        set situacao = $4::text, erro = $5, proxima_tentativa_em = $6,
            analise_id = case when $4::text = 'concluido' then $7::uuid else i.analise_id end,
            pu_gasto = case when $4::text = 'concluido' then $8::numeric else i.pu_gasto end
      where i.id = $1 and i.organization_id = $2 and i.situacao = 'executando' and i.tentativas = $3${escopo}`, params);
  if (r.rowCount !== 1) throw new Error("item satelital: a mudança de situação não alcançou exatamente o item");
}

/** Consulta travada e item travado, ainda desta reserva (com a situação da consulta) — ou o motivo de não poder tocar nele. */
async function abrirItem(ctx: ServiceCtx, r: ItemReservado, tentativas: number | null): Promise<{ item: LinhaItem; consulta: string } | string> {
  const consulta = await travarConsulta(ctx, r.consulta_id);
  if (!consulta) return "consulta_fora_do_escopo";
  const item = await lerItem(ctx, r.item_id, true);
  if (!item || item.consulta_id !== r.consulta_id) return "item_fora_do_escopo";
  if (item.situacao !== "executando" || (tentativas !== null && item.tentativas !== tentativas)) return "reserva_perdida";
  return { item, consulta: consulta.situacao };
}

/** As recusas do ERP antes de chamar o provedor (`{ erro }`), ou o polígono pronto para ele. */
async function conferir(ctx: ServiceCtx, item: LinhaItem): Promise<{ erro: string } | { area: AreaLida; poligono: PoligonoGeoJson; grade: GradeDaAnalise }> {
  if (!hasPermission(ctx, PERMISSAO_EXECUTAR_ITEM)) return { erro: ERROS_ITEM.semPermissao };
  // Discriminador desconhecido NEGA: só NDVI v2 e o bundle pastagem essencial.
  if (!ehNdviV2(item) && !ehPastagem(item)) return { erro: ERROS_ITEM.metodoDesconhecido };
  // Acima do teto só chega o item que réplicas caídas largaram 'executando' (a reserva soma 1 a cada recuperação): ele
  // não é tentado de novo, para um item que derruba o processo não derrubar todos.
  if (item.tentativas_rodada > TENTATIVAS_POR_RODADA) return { erro: ERROS_ITEM.execucaoInterrompida };
  const area = await lerArea(ctx, item.area_id);
  if (!area) return { erro: ERROS_ITEM.areaNaoEncontrada };
  if (area.geometria_sha256 !== item.geometria_sha256) return { erro: ERROS_ITEM.geometriaAlterada };
  try {
    const resolucao = ehPastagem(item) ? RESOLUCAO_AGREGACAO_M : undefined;
    return { area, ...prepararPoligono(area, resolucao) };
  } catch (e) {
    if (!(e instanceof DomainError) || e.code !== "VALIDATION_ERROR") throw e;
    return { erro: RECUSA_DO_POLIGONO.get(e.message) ?? "poligono_recusado" };
  }
}

async function fase1(dep: DependenciasItem, r: ItemReservado): Promise<Fase1> {
  return withTx(dep.db, tenantDo(r), async (tx) => {
    const ctx = await contextoDoCriador(tx, r.organization_id, r.criado_por);
    if (!ctx) return { tipo: "adiado", motivo: "criador_sem_acesso" };
    const aberto = await abrirItem(ctx, r, null);
    if (typeof aberto === "string") return { tipo: "adiado", motivo: aberto };
    const { item } = aberto;
    const janela = janelaDoItem(item);
    const c = await conferir(ctx, item);
    if ("erro" in c) {
      await mudarItem(ctx, item, { situacao: "falho", erro: c.erro, proxima: null });
      await recalcularConsulta(ctx, item.consulta_id);
      return { tipo: "falho", erro: c.erro };
    }
    // A consulta já está travada (`abrirItem`): 'pendente' → 'executando' pela mesma regra do fechamento.
    if (aberto.consulta === "pendente") await recalcularConsulta(ctx, item.consulta_id);
    return { tipo: "executar", pronto: { item, poligono: c.poligono, grade: c.grade, janela } };
  });
}

/** FASE 2 — o provedor, sem transação. Nunca lança: o desfecho vai em `falha`. */
async function chamarProvedor(dep: DependenciasItem, r: ItemReservado, p: Pronto): Promise<Chamada> {
  const registrar = (c: RegistroChamada) => dep.log.info({
    satelite: { provedor: PROVEDOR_COPERNICUS, endpoint: c.endpoint, status: c.status, duracao_ms: c.duracaoMs, tentativa: c.tentativa, tipo_falha: c.tipoFalha, item_id: r.item_id, consulta_id: r.consulta_id }
  }, "chamada ao provedor de satélite");
  let respondeu: Chamada["respondeu"] = null;
  try {
    if (ehPastagem(p.item)) {
      const resposta = await dep.cliente.estatisticaComConsumo(montarCorpoPastagem(p.poligono, p.janela, p.grade), registrar);
      respondeu = { puCabecalho: resposta.puCabecalho };
      const resultado = escolherObservacaoPastagem(
        interpretarEstatisticaMulti(resposta.corpo, p.janela), p.grade.pixelsGeometria, p.item.data_alvo);
      return { respondeu, resultado, falha: null };
    }
    const resposta = await dep.cliente.estatisticaComConsumo(montarCorpoEstatistica(p.poligono, p.janela, p.grade), registrar);
    respondeu = { puCabecalho: resposta.puCabecalho };
    const resultado = escolherObservacaoV2(interpretarEstatistica(resposta.corpo, p.janela), p.grade.pixelsGeometria, p.item.data_alvo);
    return { respondeu, resultado, falha: null };
  } catch (e) {
    // 2xx com corpo ilegível: o cliente lança, mas a chamada foi cobrada — o PU (ou null) vem na própria falha.
    if (respondeu === null && e instanceof FalhaCopernicus && e.puCabecalho !== undefined) respondeu = { puCabecalho: e.puCabecalho };
    return { respondeu, resultado: null, falha: e };
  }
}

/** A análise do item (método v2, janela convertida); a chave da janela já existente → a releitura dela, no escopo. */
async function gravarAnalise(ctx: ServiceCtx, item: LinhaItem, area: AreaLida, janela: Janela, r: ResultadoNdvi): Promise<string> {
  const c = r.situacao === "concluida" ? r : null;
  const chave: unknown[] = [ctx.orgId, area.id, PROVEDOR_COPERNICUS, COLECAO_SENTINEL2_L2A, INDICE_NDVI, VERSAO_METODO_NDVI_V2, item.geometria_sha256, janela.inicio, janela.fim];
  const g = await ctx.tx.query<{ id: string }>(
    `insert into erp.analises_satelitais (organization_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256, janela_inicio, janela_fim,
        empresa_id, resolucao_m, situacao, motivo_qualidade, observacao_inicio, observacao_fim, valor_medio, valor_minimo, valor_maximo, desvio_padrao,
        pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria, cobertura_valida, metadados_provedor, criado_por,
        consulta_item_id, resolucao_nativa_m, data_alvo, evalscript_sha256)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25::jsonb, $26, $27, $28, $29, $30)
     on conflict on constraint uq_analises_satelitais_janela do nothing
     returning id`,
    [...chave, area.empresa_id, String(RESOLUCAO_PADRAO_M), r.situacao, r.situacao === "sem_observacao_util" ? r.motivo : null,
      c?.observacao.inicio ?? null, c?.observacao.fim ?? null, c?.valores.medio ?? null, c?.valores.minimo ?? null, c?.valores.maximo ?? null, c?.valores.desvio ?? null,
      c?.pixels.amostra ?? null, c?.pixels.semDado ?? null, c?.pixels.validos ?? null,
      c ? c.pixels.geometria : r.situacao === "sem_observacao_util" ? r.pixelsGeometria : null,
      c?.cobertura ?? null, JSON.stringify(r.metadados), ctx.user.id, item.id, RESOLUCAO_NATIVA_NDVI_M, item.data_alvo, EVALSCRIPT_NDVI_SHA256]);
  if (g.rowCount === 1) return g.rows[0]!.id;
  if (g.rowCount !== 0) throw new Error("análise satelital: gravação devolveu mais de uma linha");
  const params: unknown[] = [...chave, item.data_alvo];
  const escopo = empresaScopeSql(ctx, "s", params);
  const e = await ctx.tx.query<{ id: string }>(
    `select s.id from erp.analises_satelitais s
      where s.organization_id = $1 and s.area_id = $2 and s.provedor = $3 and s.colecao = $4 and s.indice = $5 and s.versao_metodo = $6
        and s.geometria_sha256 = $7 and s.janela_inicio = $8 and s.janela_fim = $9 and s.data_alvo is not distinct from $10::date${escopo}`, params);
  if (e.rowCount !== 1) throw new Error("análise satelital: a chave da janela existe e a análise não foi relida");
  return e.rows[0]!.id;
}

const consumoDo = (ctx: ServiceCtx, r: ItemReservado, puCabecalho: string | null) =>
  gravarConsumo(ctx.tx, { organizationId: ctx.orgId, empresaId: r.empresa_id, consultaId: r.consulta_id, consultaItemId: r.item_id, puCabecalho });

/** FASE 3 — a gravação do resultado (a chamada respondeu 2xx e a escolha foi feita). */
async function fase3(dep: DependenciasItem, r: ItemReservado, p: Pronto, chamada: Chamada & { resultado: ResultadoItemFila }): Promise<{ desfecho: DesfechoItem; motivo: string | null }> {
  return withTx(dep.db, tenantDo(r), async (tx) => {
    const ctx = await contextoDoCriador(tx, r.organization_id, r.criado_por);
    if (!ctx) return { desfecho: "adiado", motivo: "criador_sem_acesso" };
    const aberto = await abrirItem(ctx, r, p.item.tentativas);
    if (typeof aberto === "string") {
      // A reserva não é mais desta execução (o prazo venceu e outra réplica a pegou): o item não é desta escrita, mas a
      // chamada gastou do mesmo jeito. Sem o item visível, nem o consumo tem onde entrar.
      if (aberto === "reserva_perdida") await consumoDo(ctx, r, chamada.respondeu!.puCabecalho);
      return { desfecho: "adiado", motivo: aberto };
    }
    const { item } = aberto;
    const area = await lerArea(ctx, item.area_id);
    if (!area || area.geometria_sha256 !== item.geometria_sha256) {
      await consumoDo(ctx, r, chamada.respondeu!.puCabecalho);
      const erro = area ? ERROS_ITEM.geometriaAlterada : ERROS_ITEM.areaNaoEncontrada;
      await mudarItem(ctx, item, { situacao: "falho", erro, proxima: null });
      await recalcularConsulta(ctx, item.consulta_id);
      return { desfecho: "falho", motivo: erro };
    }
    const analiseId = ehResultadoPastagem(chamada.resultado)
      ? (await gravarBundlePastagem(ctx, area, p.janela, chamada.resultado, item.id, item.data_alvo)).referenciaId
      : await gravarAnalise(ctx, item, area, p.janela, chamada.resultado);
    const consumo = await consumoDo(ctx, r, chamada.respondeu!.puCabecalho);
    await mudarItem(ctx, item, { situacao: "concluido", erro: null, proxima: null, analiseId, puGasto: consumo.pu_gasto });
    await recalcularConsulta(ctx, item.consulta_id);
    return { desfecho: "concluido", motivo: null };
  });
}

/** A falha (do provedor, da leitura ou de uma fase): a decisão de `retry.ts`, o consumo se houve 2xx, o recálculo. */
async function fecharFalha(dep: DependenciasItem, r: ItemReservado, tentativas: number | null, respondeu: Chamada["respondeu"], erro: unknown): Promise<{ desfecho: DesfechoItem; motivo: string | null }> {
  return withTx(dep.db, tenantDo(r), async (tx) => {
    const ctx = await contextoDoCriador(tx, r.organization_id, r.criado_por);
    if (!ctx) return { desfecho: "adiado", motivo: "criador_sem_acesso" };
    const aberto = await abrirItem(ctx, r, tentativas);
    if (typeof aberto === "string") {
      if (respondeu && aberto === "reserva_perdida") await consumoDo(ctx, r, respondeu.puCabecalho);
      return { desfecho: "adiado", motivo: aberto };
    }
    const { item } = aberto;
    if (respondeu) await consumoDo(ctx, r, respondeu.puCabecalho);
    const d: DecisaoFalha = respondeu && !(erro instanceof FalhaCopernicus)
      ? { tipo: "falhar", erro: ERROS_ITEM.erroGravacao }
      : decidirAposFalha(erro, item.tentativas_rodada, dep.agora(), dep.aleatorio);
    if (d.tipo === "repetir") await mudarItem(ctx, item, { situacao: "pendente", erro: d.erro, proxima: d.proximaTentativaEm });
    else await mudarItem(ctx, item, { situacao: "falho", erro: d.erro, proxima: null });
    await recalcularConsulta(ctx, item.consulta_id);
    return { desfecho: d.tipo === "repetir" ? "adiado" : "falho", motivo: d.erro };
  });
}

/** O que um erro pode deixar no log: o tipo e o status (provedor), o código (ERP) ou o SQLSTATE — nunca a mensagem. */
export function resumoDoErro(e: unknown): Record<string, unknown> {
  if (e instanceof FalhaCopernicus) return { tipo_falha: e.tipo, status: e.status };
  if (e instanceof DomainError) return { tipo_falha: "erro_interno", codigo: e.code };
  const pg = (e && typeof e === "object" ? e : {}) as { code?: unknown; constraint?: unknown };
  return {
    tipo_falha: "erro_interno", nome: e instanceof Error ? e.name : typeof e,
    sqlstate: typeof pg.code === "string" ? pg.code : null, restricao: typeof pg.constraint === "string" ? pg.constraint : null
  };
}

/** Executa um item reservado. NUNCA lança: o desfecho é o que entra na contagem da rodada. */
export async function executarItem(dep: DependenciasItem, r: ItemReservado): Promise<ResultadoItem> {
  let falhaDoProvedor: FalhaCopernicus | null = null;
  const desfecho = await executarFases(dep, r, (f) => { falhaDoProvedor = f; });
  return { desfecho, falhaDoProvedor };
}

async function executarFases(dep: DependenciasItem, r: ItemReservado, anotarFalha: (f: FalhaCopernicus) => void): Promise<DesfechoItem> {
  const ids = { item_id: r.item_id, consulta_id: r.consulta_id, organization_id: r.organization_id };
  const anotar = (desfecho: DesfechoItem, motivo: string | null, extra: Record<string, unknown> = {}) => {
    (desfecho === "concluido" ? dep.log.info : dep.log.warn).call(dep.log, { satelite_item: { ...ids, desfecho, motivo, ...extra } }, "item da fila satelital");
    return desfecho;
  };
  // Último recurso: a falha registrada pela decisão de `retry.ts`. Se nem isso grava, o item fica 'executando' até o
  // prazo e a reserva seguinte o devolve para a fila (o teto da rodada impede o laço).
  const falhar = async (tentativas: number | null, respondeu: Chamada["respondeu"], erro: unknown) => {
    try {
      const f = await fecharFalha(dep, r, tentativas, respondeu, erro);
      return anotar(f.desfecho, f.motivo, resumoDoErro(erro));
    } catch (e) {
      dep.log.error({ satelite_item: { ...ids, etapa: "registro_da_falha", ...resumoDoErro(e) } }, "item da fila satelital sem desfecho gravado");
      return "adiado" as const;
    }
  };

  let f1: Fase1;
  try {
    f1 = await fase1(dep, r);
  } catch (e) {
    dep.log.error({ satelite_item: { ...ids, etapa: "preparo", ...resumoDoErro(e) } }, "item da fila satelital: preparo falhou");
    return falhar(null, null, e);
  }
  if (f1.tipo === "falho") return anotar("falho", f1.erro);
  if (f1.tipo === "adiado") return anotar("adiado", f1.motivo);

  const chamada = await chamarProvedor(dep, r, f1.pronto);
  if (chamada.falha instanceof FalhaCopernicus) anotarFalha(chamada.falha);
  if (chamada.resultado === null) return falhar(f1.pronto.item.tentativas, chamada.respondeu, chamada.falha);
  try {
    const f3 = await fase3(dep, r, f1.pronto, { ...chamada, resultado: chamada.resultado });
    return anotar(f3.desfecho, f3.motivo);
  } catch (e) {
    dep.log.error({ satelite_item: { ...ids, etapa: "gravacao", ...resumoDoErro(e) } }, "item da fila satelital: gravação falhou");
    return falhar(f1.pronto.item.tentativas, chamada.respondeu, e);
  }
}
