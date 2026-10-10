import type { Feature, FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { AreaOperacional, ObjetoDeMapa, RespostaOperacional } from "./operacional-dados";
import {
  LADO_MAIOR_PX,
  LADO_MINIMO_PX,
  LADO_OBJETO_MINIMO_PX,
  LADO_OBJETO_PX,
  ZOOM_AFASTADO,
  ZOOM_DE_TRABALHO,
  imagemPronta,
  tamanhoDoIconePorZoom,
  type ImagemRegistrada
} from "./imagens-do-mapa";

/**
 * MAPA-MANEJO-04 (F2) — CAMADA 1: o MARCADOR AGREGADO por área e os OBJETOS DE MAPA, tudo em GPU (nenhum DOM por área).
 *
 * Fonte `lotes`: UM ponto por área com lote aberto, NO `centroide` QUE A API DEVOLVE (a tela não calcula centróide),
 * com o total de cabeças que a API somou (`cabecas_total`). Camadas, de baixo para cima, acima do contorno das áreas:
 *   lotes-fallback (circle)  área cujo ícone não está registrado: círculo na cor padrão da config, ou o verde de acento
 *   lotes-icone    (symbol)  o ícone da config (quando registrado) e o contador de cabeças — em TODA área
 *   lotes-badge    (symbol)  o identificador do lote (sigla cortada em 2 letras; "M+" no misto), só quando existe
 *   objetos-de-mapa-fallback (circle) / objetos-de-mapa (symbol)  cocho e depósito a pasto
 * Os rótulos das áreas são DOM por cima do canvas (camada-desenho.tsx) e ficam acima de tudo isto.
 *
 * Sincronização: a fonte recebe `setData` só quando o estado SERIALIZADO mudou — refetch com a mesma resposta não
 * toca o mapa (nada pisca) — e nenhuma camada é recriada: a instalação é idempotente.
 *
 * Alerta: `tem_alerta` está preparado (sobe na ordem de desenho por `symbol-sort-key`), mas é SEMPRE falso — não
 * existe alerta de lote no ERP hoje.
 *
 * Arquivo SEM import de `@/…` em tempo de execução: as funções puras são testadas no vitest (ambiente node).
 */

export const FONTE_LOTES = "lotes";
export const FONTE_OBJETOS = "objetos-de-mapa";

export const CAMADA_LOTES_FALLBACK = "lotes-fallback";
export const CAMADA_LOTES_ICONE = "lotes-icone";
export const CAMADA_LOTES_BADGE = "lotes-badge";
export const CAMADA_OBJETOS_FALLBACK = "objetos-de-mapa-fallback";
export const CAMADA_OBJETOS = "objetos-de-mapa";

/** Camadas do marcador de lotes, de baixo para cima. */
export const CAMADAS_DE_LOTES = [CAMADA_LOTES_FALLBACK, CAMADA_LOTES_ICONE, CAMADA_LOTES_BADGE] as const;
/** Camadas dos objetos de mapa, de baixo para cima (acima dos lotes). */
export const CAMADAS_DE_OBJETOS = [CAMADA_OBJETOS_FALLBACK, CAMADA_OBJETOS] as const;

/** Fundo do badge: círculo SDF gerado em tempo de execução (nenhum arquivo de imagem), pintado por `icon-color`. */
export const IMAGEM_FUNDO_DO_BADGE = "lotes-badge-fundo";

/** Verde de acento da casa (o token de acento de globals.css): fallback de área sem ícone e sem cor padrão na configuração. */
export const COR_ACENTO = "#40de63";
/** Neutro (slate-600) do badge de identificador MISTO. */
export const COR_DO_MISTO = "#475569";
/** Texto do badge quando os lotes da área têm identificadores diferentes. */
export const SIGLA_DO_MISTO = "M+";
/** Objeto de mapa sem ícone: círculo pequeno no azul da casa (o token azul de globals.css). */
const COR_DO_OBJETO = "#2899f5";
const COR_DO_TEXTO = "#ffffff";
const COR_DO_HALO = "#0f172a";
/**
 * Fontes do texto. O estilo não tem `glyphs`: o MapLibre 5 desenha o texto no próprio navegador (TinySDF) com
 * estas famílias CSS (a da casa, depois `sans-serif`); "Bold" dá o peso.
 */
const FONTE_DO_TEXTO = ["DM Sans Variable Bold", "DM Sans Variable"];

/** Propriedades de cada ponto da fonte `lotes`. */
export interface PropriedadesDoLote {
  area_id: string;
  /** cabeças somadas pela API (`cabecas_total`) */
  cabecas: number;
  /** id da configuração de ícone que a API resolveu ("" sem configuração ou sem a capacidade de ícone) */
  icone_id: string;
  icone_url: string;
  cor_padrao: string;
  /** a imagem daquela configuração está registrada no mapa (senão: fallback) */
  icone_pronto: boolean;
  /** 1 ÷ maior lado da imagem (0 sem imagem): `icon-size` = alvo × escala */
  escala: number;
  /**
   * Formato da imagem, só para POSICIONAR o contador e o badge (pixel): (altura − largura) ÷ maior lado, de −1 a 1.
   * 0 = quadrada (ou sem imagem); −0,5 = largura o dobro da altura; 0,5 = altura o dobro da largura.
   */
  aspecto: number;
  tem_identificador: boolean;
  /** sigla CORTADA em 2 letras ("M+" no misto) */
  identificador_sigla: string;
  identificador_cor: string;
  identificador_misto: boolean;
  /** sempre falso hoje: não existe alerta de lote no ERP */
  tem_alerta: boolean;
}

/** Propriedades de cada ponto da fonte `objetos-de-mapa`. */
export interface PropriedadesDoObjeto {
  objeto_id: string;
  area_id: string;
  tipo: string;
  nome: string;
  ativo: boolean;
  /** a API não manda ícone de objeto hoje: "" e `icone_pronto` falso — todo objeto cai no círculo */
  icone_id: string;
  icone_pronto: boolean;
  escala: number;
}

/** Corte da sigla para caber no badge (apresentação: a API manda a sigla inteira, de propósito). */
export function siglaCurta(sigla: string): string {
  return Array.from(sigla.trim()).slice(0, 2).join("");
}

/** Consulta de imagem registrada por id de configuração (no mapa: `imagemPronta`). */
export type ImagemDaConfig = (configId: string) => Pick<ImagemRegistrada, "escala" | "largura" | "altura"> | null;

/** (altura − largura) ÷ maior lado: o formato da imagem, de −1 (só largura) a 1 (só altura). */
export function aspectoDaImagem(largura: number, altura: number): number {
  const maior = Math.max(largura, altura);
  return Number.isFinite(maior) && maior > 0 ? (altura - largura) / maior : 0;
}

const VAZIA = <P>(): FeatureCollection<Point, P> => ({ type: "FeatureCollection", features: [] });

function pontoDoCentroide(a: AreaOperacional): Point | null {
  const c = a.centroide;
  if (!c || !Number.isFinite(c.lon) || !Number.isFinite(c.lat)) return null;
  return { type: "Point", coordinates: [c.lon, c.lat] };
}

function identificadorDaFeature(a: AreaOperacional): Pick<PropriedadesDoLote, "tem_identificador" | "identificador_sigla" | "identificador_cor" | "identificador_misto"> {
  const i = a.identificador;
  if (!i) return { tem_identificador: false, identificador_sigla: "", identificador_cor: "", identificador_misto: false };
  if (i.misto) return { tem_identificador: true, identificador_sigla: SIGLA_DO_MISTO, identificador_cor: COR_DO_MISTO, identificador_misto: true };
  return { tem_identificador: true, identificador_sigla: siglaCurta(i.sigla), identificador_cor: i.cor, identificador_misto: false };
}

/**
 * Os pontos da fonte `lotes`: um por área com lote aberto (`lotes.length > 0`) e centróide (o da API). Área com dois
 * lotes é UM ponto, com as cabeças que a API somou. Área sem centróide fica fora (sem ponto para desenhar).
 */
export function featuresDeLotes(resposta: RespostaOperacional | null, imagem: ImagemDaConfig): FeatureCollection<Point, PropriedadesDoLote> {
  if (!resposta) return VAZIA<PropriedadesDoLote>();
  const features: Feature<Point, PropriedadesDoLote>[] = [];
  for (const a of resposta.areas) {
    if (a.lotes.length === 0) continue;
    const ponto = pontoDoCentroide(a);
    if (!ponto) continue;
    const iconeId = a.icone?.config_id ?? "";
    const imagemDaConfig = iconeId ? imagem(iconeId) : null;
    const pronta = imagemDaConfig !== null && imagemDaConfig.escala > 0 ? imagemDaConfig : null;
    features.push({
      type: "Feature",
      geometry: ponto,
      properties: {
        area_id: a.id,
        cabecas: a.cabecas_total,
        icone_id: iconeId,
        icone_url: a.icone?.icone_url ?? "",
        cor_padrao: a.icone?.cor_padrao ?? "",
        icone_pronto: pronta !== null,
        escala: pronta?.escala ?? 0,
        aspecto: pronta ? aspectoDaImagem(pronta.largura, pronta.altura) : 0,
        ...identificadorDaFeature(a),
        tem_alerta: false
      }
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Os pontos da fonte `objetos-de-mapa`: só os objetos de forma `ponto` (GeoJSON Point). Objetos de forma `linha`
 * (nenhum tipo hoje) ficam FORA desta camada.
 */
export function featuresDeObjetos(resposta: RespostaOperacional | null): FeatureCollection<Point, PropriedadesDoObjeto> {
  if (!resposta) return VAZIA<PropriedadesDoObjeto>();
  const features: Feature<Point, PropriedadesDoObjeto>[] = [];
  for (const o of resposta.objetos) {
    const ponto = pontoDoObjeto(o);
    if (!ponto) continue;
    features.push({
      type: "Feature",
      geometry: ponto,
      properties: { objeto_id: o.id, area_id: o.area_id ?? "", tipo: o.tipo, nome: o.name, ativo: o.is_active, icone_id: "", icone_pronto: false, escala: 0 }
    });
  }
  return { type: "FeatureCollection", features };
}

function pontoDoObjeto(o: ObjetoDeMapa): Point | null {
  if (o.forma !== "ponto" || o.geometria?.type !== "Point") return null;
  const [lon, lat] = o.geometria.coordinates;
  if (lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { type: "Point", coordinates: [lon, lat] };
}

/**
 * Círculo SDF (distância com sinal no canal alfa: 0,75 na borda, como o TinySDF), sem arquivo de imagem. Registrado
 * com `sdf: true` e `pixelRatio: 2`: 48 px de imagem = 24 px de tela, círculo de 18 px de diâmetro.
 */
export function circuloSdf(lado = 48, raio = 18): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(lado * lado * 4);
  const centro = (lado - 1) / 2;
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const distancia = Math.hypot(x - centro, y - centro);
      const alfa = Math.min(1, Math.max(0, 0.75 - (distancia - raio) / 8));
      data[(y * lado + x) * 4 + 3] = Math.round(alfa * 255);
    }
  }
  return { width: lado, height: lado, data };
}

type CamadaSimbolo = Extract<LayerSpecification, { type: "symbol" }>;
type CamadaCirculo = Extract<LayerSpecification, { type: "circle" }>;
/** Deslocamento [x, y] de ícone ou texto (valor ou expressão). */
type Deslocamento = NonNullable<NonNullable<CamadaSimbolo["layout"]>["text-offset"]>;

/*
 * GEOMETRIA DO MARCADOR, em px de tela, no piso (zoom afastado) e no zoom de trabalho. Só posição em pixel: o ícone,
 * o círculo, o contador e o badge leem DAQUI, e nenhum número de negócio entra nesta conta.
 */
/** Lado maior do ícone exibido. */
const LADO = { afastado: LADO_MINIMO_PX, trabalho: LADO_MAIOR_PX };
/** Raio do círculo de fallback. */
const RAIO_DO_FALLBACK = { afastado: 10, trabalho: 18 };
/** Tamanho do texto do contador e do badge; tamanho (icon-size) do fundo do badge. */
const TEXTO_DO_CONTADOR = { afastado: 11, trabalho: 13 };
const TEXTO_DO_BADGE = { afastado: 7, trabalho: 10 };
const TAMANHO_DO_BADGE = { afastado: 0.7, trabalho: 1 };

const duasCasas = (n: number) => Math.round(n * 100) / 100;

/**
 * Contador (em em) no centro do terço INFERIOR do ícone: altura exibida ÷ 3 abaixo do ponto. A altura exibida é o
 * lado maior para imagem quadrada ou em pé (aspecto ≥ 0) e cai linearmente até 0 para a só-largura (aspecto −1).
 * Sem ícone (fallback): no centro do círculo.
 */
function deslocamentoDoContador(): Deslocamento {
  const y = (z: "afastado" | "trabalho") => duasCasas(LADO[z] / 3 / TEXTO_DO_CONTADOR[z]);
  return [
    "interpolate", ["linear"], ["zoom"],
    ZOOM_AFASTADO, ["case", ["get", "icone_pronto"],
      ["interpolate", ["linear"], ["get", "aspecto"], -1, ["literal", [0, 0]], 0, ["literal", [0, y("afastado")]]],
      ["literal", [0, 0]]],
    ZOOM_DE_TRABALHO, ["case", ["get", "icone_pronto"],
      ["interpolate", ["linear"], ["get", "aspecto"], -1, ["literal", [0, 0]], 0, ["literal", [0, y("trabalho")]]],
      ["literal", [0, 0]]]
  ];
}

/**
 * Centro do badge no CANTO SUPERIOR DIREITO do ícone exibido — (meia largura, −meia altura), que o aspecto leva de
 * (meio lado, 0) na só-largura a (0, −meio lado) na só-altura — ou do círculo de fallback, a 45°. Dividido por
 * `divisor` em cada zoom: o icon-size do badge (icon-offset é multiplicado por ele) ou o tamanho do texto (text-offset
 * é em em). Assim o fundo e a sigla caem no MESMO ponto em qualquer zoom.
 */
function cantoDoBadge(divisor: { afastado: number; trabalho: number }): Deslocamento {
  const meio = (z: "afastado" | "trabalho") => duasCasas(LADO[z] / 2 / divisor[z]);
  const circulo = (z: "afastado" | "trabalho") => duasCasas((RAIO_DO_FALLBACK[z] * Math.SQRT1_2) / divisor[z]);
  return [
    "interpolate", ["linear"], ["zoom"],
    ZOOM_AFASTADO, ["case", ["get", "icone_pronto"],
      ["interpolate", ["linear"], ["get", "aspecto"],
        -1, ["literal", [meio("afastado"), 0]], 0, ["literal", [meio("afastado"), -meio("afastado")]], 1, ["literal", [0, -meio("afastado")]]],
      ["literal", [circulo("afastado"), -circulo("afastado")]]],
    ZOOM_DE_TRABALHO, ["case", ["get", "icone_pronto"],
      ["interpolate", ["linear"], ["get", "aspecto"],
        -1, ["literal", [meio("trabalho"), 0]], 0, ["literal", [meio("trabalho"), -meio("trabalho")]], 1, ["literal", [0, -meio("trabalho")]]],
      ["literal", [circulo("trabalho"), -circulo("trabalho")]]]
  ];
}

/** As especificações das cinco camadas, na ordem de desenho (de baixo para cima). */
export function especificacoesDasCamadas(): LayerSpecification[] {
  const fallbackDosLotes: CamadaCirculo = {
    id: CAMADA_LOTES_FALLBACK,
    type: "circle",
    source: FONTE_LOTES,
    filter: ["==", ["get", "icone_pronto"], false],
    layout: { "circle-sort-key": ["case", ["get", "tem_alerta"], 1, 0] },
    paint: {
      "circle-color": ["to-color", ["get", "cor_padrao"], COR_ACENTO],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], ZOOM_AFASTADO, RAIO_DO_FALLBACK.afastado, ZOOM_DE_TRABALHO, RAIO_DO_FALLBACK.trabalho],
      "circle-opacity": 0.95,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2
    }
  };
  const iconeDosLotes: CamadaSimbolo = {
    id: CAMADA_LOTES_ICONE,
    type: "symbol",
    source: FONTE_LOTES,
    layout: {
      "icon-image": ["case", ["get", "icone_pronto"], ["get", "icone_id"], ""],
      "icon-size": tamanhoDoIconePorZoom(LADO_MAIOR_PX, LADO_MINIMO_PX),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": ["number-format", ["get", "cabecas"], { locale: "pt-BR" }],
      "text-font": FONTE_DO_TEXTO,
      "text-size": ["interpolate", ["linear"], ["zoom"], ZOOM_AFASTADO, TEXTO_DO_CONTADOR.afastado, ZOOM_DE_TRABALHO, TEXTO_DO_CONTADOR.trabalho],
      "text-anchor": "center",
      "text-offset": deslocamentoDoContador(),
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "symbol-sort-key": ["case", ["get", "tem_alerta"], 1, 0]
    },
    paint: { "text-color": COR_DO_TEXTO, "text-halo-color": COR_DO_HALO, "text-halo-width": 1.5 }
  };
  const badgeDosLotes: CamadaSimbolo = {
    id: CAMADA_LOTES_BADGE,
    type: "symbol",
    source: FONTE_LOTES,
    filter: ["==", ["get", "tem_identificador"], true],
    layout: {
      "icon-image": IMAGEM_FUNDO_DO_BADGE,
      "icon-size": ["interpolate", ["linear"], ["zoom"], ZOOM_AFASTADO, TAMANHO_DO_BADGE.afastado, ZOOM_DE_TRABALHO, TAMANHO_DO_BADGE.trabalho],
      "icon-offset": cantoDoBadge(TAMANHO_DO_BADGE),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": ["get", "identificador_sigla"],
      "text-font": FONTE_DO_TEXTO,
      "text-size": ["interpolate", ["linear"], ["zoom"], ZOOM_AFASTADO, TEXTO_DO_BADGE.afastado, ZOOM_DE_TRABALHO, TEXTO_DO_BADGE.trabalho],
      "text-anchor": "center",
      "text-offset": cantoDoBadge(TEXTO_DO_BADGE),
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "symbol-sort-key": ["case", ["get", "tem_alerta"], 1, 0]
    },
    paint: {
      "icon-color": ["to-color", ["get", "identificador_cor"], COR_DO_MISTO],
      "icon-halo-color": "#ffffff",
      "icon-halo-width": 1,
      "text-color": COR_DO_TEXTO,
      "text-halo-color": COR_DO_HALO,
      "text-halo-width": 0.6
    }
  };
  const fallbackDosObjetos: CamadaCirculo = {
    id: CAMADA_OBJETOS_FALLBACK,
    type: "circle",
    source: FONTE_OBJETOS,
    filter: ["==", ["get", "icone_pronto"], false],
    paint: {
      "circle-color": COR_DO_OBJETO,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], ZOOM_AFASTADO, 4, ZOOM_DE_TRABALHO, 6],
      "circle-opacity": ["case", ["get", "ativo"], 1, 0.5],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
      "circle-stroke-opacity": ["case", ["get", "ativo"], 1, 0.5]
    }
  };
  // Mesmo mecanismo do ícone de lote (addImage + escala uniforme), tamanho base 30 px. A API não manda ícone de
  // objeto hoje: nenhuma feature passa no filtro e todo objeto é o círculo acima.
  const iconeDosObjetos: CamadaSimbolo = {
    id: CAMADA_OBJETOS,
    type: "symbol",
    source: FONTE_OBJETOS,
    filter: ["==", ["get", "icone_pronto"], true],
    layout: {
      "icon-image": ["get", "icone_id"],
      "icon-size": tamanhoDoIconePorZoom(LADO_OBJETO_PX, LADO_OBJETO_MINIMO_PX),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true
    },
    paint: { "icon-opacity": ["case", ["get", "ativo"], 1, 0.5] }
  };
  return [fallbackDosLotes, iconeDosLotes, badgeDosLotes, fallbackDosObjetos, iconeDosObjetos];
}

/** Último estado publicado em cada fonte, por mapa (a string das features). */
const publicados = new WeakMap<MapLibreMap, Map<string, string>>();

function publicadosDe(m: MapLibreMap): Map<string, string> {
  let p = publicados.get(m);
  if (!p) {
    p = new Map();
    publicados.set(m, p);
  }
  return p;
}

/**
 * Instala as fontes `lotes` e `objetos-de-mapa`, o fundo do badge e as cinco camadas — IDEMPOTENTE: o que já existe
 * fica como está (nada é recriado). Chamada no carregamento do mapa, depois das camadas das áreas: as camadas entram
 * acima de `areas-contorno-selecao`, na ordem de `especificacoesDasCamadas`.
 */
export function instalarCamadasDeLotes(m: MapLibreMap): void {
  for (const [fonte, promoteId] of [[FONTE_LOTES, "area_id"], [FONTE_OBJETOS, "objeto_id"]] as const) {
    if (m.getSource(fonte)) continue;
    m.addSource(fonte, { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId });
    publicadosDe(m).delete(fonte);
  }
  if (!m.hasImage(IMAGEM_FUNDO_DO_BADGE)) m.addImage(IMAGEM_FUNDO_DO_BADGE, circuloSdf(), { sdf: true, pixelRatio: 2 });
  const camadas = especificacoesDasCamadas();
  camadas.forEach((camada, i) => {
    if (m.getLayer(camada.id)) return;
    // camada que faltava entra logo abaixo da próxima do grupo que já existe (a ordem z nunca se inverte)
    const acima = camadas.slice(i + 1).find((c) => m.getLayer(c.id));
    m.addLayer(camada, acima?.id);
  });
}

function publicar(m: MapLibreMap, fonte: string, dados: FeatureCollection): boolean {
  const src = m.getSource(fonte) as GeoJSONSource | undefined;
  if (!src) return false;
  const serial = JSON.stringify(dados);
  const p = publicadosDe(m);
  if (p.get(fonte) === serial) return false;
  src.setData(dados);
  p.set(fonte, serial);
  return true;
}

/**
 * Põe a resposta da API nas fontes `lotes` e `objetos-de-mapa` (com as imagens registradas AGORA). Só chama
 * `setData` na fonte cujo estado serializado mudou; devolve se alguma mudou. `null` esvazia as duas.
 */
export function sincronizarLotes(m: MapLibreMap, resposta: RespostaOperacional | null): boolean {
  instalarCamadasDeLotes(m);
  const lotes = publicar(m, FONTE_LOTES, featuresDeLotes(resposta, (id) => imagemPronta(m, id)));
  const objetos = publicar(m, FONTE_OBJETOS, featuresDeObjetos(resposta));
  return lotes || objetos;
}

export type GrupoDeCamadas = "lotes" | "objetos";

/** Liga ou desliga um grupo de camadas (visibilidade de layout; a fonte e os dados ficam). */
export function mostrarGrupo(m: MapLibreMap, grupo: GrupoDeCamadas, visivel: boolean): void {
  const ids = grupo === "lotes" ? CAMADAS_DE_LOTES : CAMADAS_DE_OBJETOS;
  for (const id of ids) {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", visivel ? "visible" : "none");
  }
}
