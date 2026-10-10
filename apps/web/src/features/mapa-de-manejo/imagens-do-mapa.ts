import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { RespostaOperacional } from "./operacional-dados";

/**
 * MAPA-MANEJO-04 (F2) — REGISTRO DAS IMAGENS dos ícones no MapLibre.
 *
 * O MapLibre só desenha `icon-image` que esteja registrado por `addImage`. Para cada (config_id, icone_url) distinto
 * da resposta da API, a imagem é carregada (em paralelo, `Promise.allSettled`), medida e registrada com o id da
 * CONFIGURAÇÃO. A camada só aponta para a imagem depois que ela está registrada (`icone_pronto` na feature): área cuja
 * imagem não carregou cai no círculo de fallback, as outras seguem, e o mapa nunca cai.
 *
 * - cache por config_id: mesma url já registrada (e `hasImage`) não recarrega; url que já falhou não é pedida de novo
 *   a cada refetch (só uma url NOVA para aquela config tenta de novo) — nenhum N+1 de imagem;
 * - url nova para o mesmo id: a antiga sai (`removeImage`) antes da nova entrar (`addImage`), no mesmo passo;
 * - PROPORÇÃO: a imagem entra no tamanho natural e `icon-size` aplica UMA escala uniforme (alvo ÷ maior lado) — o
 *   ícone do usuário nunca distorce. Nenhum ícone é criado, desenhado ou escolhido aqui: a tela consome `icone_url`.
 *
 * Arquivo SEM import de `@/…` em tempo de execução: as funções puras são testadas no vitest (ambiente node).
 */

/** Lado MAIOR do ícone de lote no zoom de trabalho, em px de tela. */
export const LADO_MAIOR_PX = 46;
/** Piso do lado maior do ícone de lote quando o mapa afasta. */
export const LADO_MINIMO_PX = 20;
/** Lado maior do ícone de objeto de mapa no zoom de trabalho (tamanho base). */
export const LADO_OBJETO_PX = 30;
/** Piso do ícone de objeto ao afastar (a mesma proporção 20/46 do ícone de lote, arredondada). */
export const LADO_OBJETO_MINIMO_PX = 13;
/** Zoom em que o ícone está no piso (e abaixo dele continua no piso). */
export const ZOOM_AFASTADO = 12;
/** Zoom de trabalho: o ícone atinge o lado maior (e acima dele não cresce mais). */
export const ZOOM_DE_TRABALHO = 15;

/** A imagem registrada de uma configuração: a url de origem, o tamanho natural e a escala unitária. */
export interface ImagemRegistrada {
  url: string;
  largura: number;
  altura: number;
  /** 1 ÷ maior lado (px naturais). `icon-size = alvo × escala` põe o maior lado no alvo, sem distorcer. */
  escala: number;
}

/** Escala unitária de uma imagem: 1 ÷ maior lado; 0 para tamanho inválido (a imagem não é usada). */
export function escalaUnitaria(largura: number, altura: number): number {
  const maior = Math.max(largura, altura);
  return Number.isFinite(maior) && maior > 0 ? 1 / maior : 0;
}

/** Tamanho exibido de uma imagem com o maior lado em `ladoMaior` px — a MESMA escala nos dois eixos. */
export function tamanhoExibido(largura: number, altura: number, ladoMaior: number): { largura: number; altura: number } {
  const escala = escalaUnitaria(largura, altura) * ladoMaior;
  return { largura: largura * escala, altura: altura * escala };
}

type CamadaSimbolo = Extract<LayerSpecification, { type: "symbol" }>;
/** O tipo de `icon-size` de uma camada symbol (valor ou expressão). */
export type TamanhoDoIcone = NonNullable<NonNullable<CamadaSimbolo["layout"]>["icon-size"]>;

/**
 * `icon-size` por zoom: o maior lado vai de `ladoAfastado` px (em `ZOOM_AFASTADO` e abaixo) a `ladoNoTrabalho` px
 * (em `ZOOM_DE_TRABALHO` e acima), multiplicado pela escala unitária da feature (`escala` = 1 ÷ maior lado).
 */
export function tamanhoDoIconePorZoom(ladoNoTrabalho: number, ladoAfastado: number): TamanhoDoIcone {
  return [
    "interpolate", ["linear"], ["zoom"],
    ZOOM_AFASTADO, ["*", ladoAfastado, ["get", "escala"]],
    ZOOM_DE_TRABALHO, ["*", ladoNoTrabalho, ["get", "escala"]]
  ];
}

/** Um ícone a registrar: o id da configuração e a url da imagem. */
export interface ParDeIcone {
  id: string;
  url: string;
}

/**
 * Os pares (config_id, icone_url) DISTINTOS da resposta, só das áreas que viram marcador (com lote e centróide) —
 * imagem que nenhum marcador usa não é baixada. Área sem configuração (`config_id` nulo), sem url ou sem a capacidade
 * de ícone (`icone` nulo) não entra: o marcador dela é o fallback.
 */
export function paresDeIcones(resposta: RespostaOperacional | null): ParDeIcone[] {
  const porId = new Map<string, string>();
  for (const a of resposta?.areas ?? []) {
    if (a.lotes.length === 0 || !a.centroide) continue;
    const id = a.icone?.config_id ?? null;
    const url = a.icone?.icone_url?.trim() ?? "";
    if (!id || !url || porId.has(id)) continue;
    porId.set(id, url);
  }
  return [...porId].map(([id, url]) => ({ id, url }));
}

interface ImagemCarregada {
  dados: HTMLImageElement | ImageBitmap;
  largura: number;
  altura: number;
}

interface EstadoDasImagens {
  /** config_id → imagem registrada no mapa */
  registradas: Map<string, ImagemRegistrada>;
  /** config_id → url que falhou (não é pedida de novo enquanto a config apontar para ela) */
  falhas: Map<string, string>;
  /** `${id}\n${url}` → carga em curso (duas sincronizações seguidas não baixam a mesma imagem duas vezes) */
  emCurso: Map<string, Promise<ImagemCarregada>>;
  /** config_id → url da resposta MAIS RECENTE (carga que termina depois de a url mudar é descartada) */
  desejadas: Map<string, string>;
}

/** Cache por instância de mapa (um mapa removido leva o próprio cache junto). */
const estados = new WeakMap<MapLibreMap, EstadoDasImagens>();

function estadoDe(m: MapLibreMap): EstadoDasImagens {
  let e = estados.get(m);
  if (!e) {
    e = { registradas: new Map(), falhas: new Map(), emCurso: new Map(), desejadas: new Map() };
    estados.set(m, e);
  }
  return e;
}

function temImagem(m: MapLibreMap, id: string): boolean {
  try {
    return m.hasImage(id);
  } catch {
    return false;
  }
}

/** A imagem registrada daquela configuração, ou `null` (não carregou, falhou ou ainda não foi pedida). */
export function imagemPronta(m: MapLibreMap, configId: string): ImagemRegistrada | null {
  if (!configId) return null;
  const r = estados.get(m)?.registradas.get(configId);
  return r && temImagem(m, configId) ? r : null;
}

function carregar(m: MapLibreMap, estado: EstadoDasImagens, p: ParDeIcone): Promise<ImagemCarregada> {
  const chave = `${p.id}\n${p.url}`;
  const emCurso = estado.emCurso.get(chave);
  if (emCurso) return emCurso;
  const promessa = Promise.resolve()
    .then(() => m.loadImage(p.url))
    .then((r) => {
      const dados = r.data;
      if (!(dados.width > 0 && dados.height > 0)) throw new Error("Imagem sem tamanho");
      return { dados, largura: dados.width, altura: dados.height };
    })
    .finally(() => { estado.emCurso.delete(chave); });
  estado.emCurso.set(chave, promessa);
  return promessa;
}

/** Tira a imagem daquela configuração do mapa (a área cai no fallback). */
function descartar(m: MapLibreMap, estado: EstadoDasImagens, id: string) {
  estado.registradas.delete(id);
  try {
    if (m.hasImage(id)) m.removeImage(id);
  } catch {
    // mapa já removido: nada a desenhar
  }
}

/** Registra a imagem carregada com o id da configuração (idempotente: a mesma url já registrada fica como está). */
function registrar(m: MapLibreMap, estado: EstadoDasImagens, p: ParDeIcone, img: ImagemCarregada) {
  if (estado.registradas.get(p.id)?.url === p.url && temImagem(m, p.id)) return;
  try {
    // url nova para o mesmo id: a antiga sai ANTES de a nova entrar com o mesmo id
    if (m.hasImage(p.id)) m.removeImage(p.id);
    m.addImage(p.id, img.dados);
  } catch {
    estado.falhas.set(p.id, p.url);
    descartar(m, estado, p.id);
    return;
  }
  estado.registradas.set(p.id, { url: p.url, largura: img.largura, altura: img.altura, escala: escalaUnitaria(img.largura, img.altura) });
  estado.falhas.delete(p.id);
}

/** Retrato do que está pronto para cada configuração (a url registrada, ou nulo). */
const retrato = (m: MapLibreMap, pares: readonly ParDeIcone[]) => pares.map((p) => imagemPronta(m, p.id)?.url ?? null);

/**
 * Carrega e registra as imagens dos ícones da resposta. Nunca rejeita: imagem que falha deixa só a configuração
 * dela sem imagem. Devolve `true` quando o que está pronto para as configurações desta resposta mudou desde o início
 * da chamada (inclusive por outra chamada que dividiu a mesma carga) — quem chama sincroniza a fonte de lotes de
 * novo para os marcadores trocarem do fallback para o ícone (ou o contrário).
 */
export async function registrarImagensDosIcones(m: MapLibreMap, resposta: RespostaOperacional | null): Promise<boolean> {
  const estado = estadoDe(m);
  const pares = paresDeIcones(resposta);
  for (const p of pares) estado.desejadas.set(p.id, p.url);
  const pendentes = pares.filter((p) => {
    if (estado.falhas.get(p.id) === p.url) return false;
    const r = estado.registradas.get(p.id);
    return !(r && r.url === p.url && temImagem(m, p.id));
  });
  if (pendentes.length === 0) return false;
  const antes = retrato(m, pendentes);
  const resultados = await Promise.allSettled(pendentes.map((p) => carregar(m, estado, p)));
  resultados.forEach((r, i) => {
    const p = pendentes[i]!;
    // a url desta configuração mudou enquanto carregava: quem vale é a carga da url nova
    if (estado.desejadas.get(p.id) !== p.url) return;
    if (r.status === "fulfilled") {
      registrar(m, estado, p, r.value);
      return;
    }
    estado.falhas.set(p.id, p.url);
    descartar(m, estado, p.id);
  });
  const depois = retrato(m, pendentes);
  return depois.some((url, i) => url !== antes[i]);
}
