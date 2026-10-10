/**
 * CENTRÓIDE DO POLÍGONO — MAPA-MANEJO-02.
 *
 * Função PURA (sem I/O) sobre `erp.areas.geometria` (GeoJSON Polygon em jsonb, validado no banco — migration 0049):
 * o ponto onde o mapa ancora o marcador da área (identificador do lote, ícone, número da faixa).
 *
 * POR QUE O CENTRÓIDE DE ÁREA (fórmula do laço — "shoelace") E NÃO A MÉDIA DOS VÉRTICES NEM O CENTRO DA CAIXA: a
 * média dos vértices puxa o ponto para o lado mais detalhado do desenho (o trecho com mais vértices), e o centro da
 * caixa de um pasto em L ou em forma de banana cai FORA dele — no canto vazio da caixa, o marcador apareceria no
 * vizinho. O centróide de área pesa cada parte pela área que ela tem: no L e na banana de braço largo ele cai
 * dentro, onde o centro da caixa já cai fora. Não é garantia: num L de braço fino ou numa meia-lua fechada até o
 * centróide sai do polígono (fica junto dele, não no vizinho distante); um ponto SEMPRE interno seria outra regra.
 *
 * POR QUE NO SERVIDOR: a API devolve o centróide pronto em `/mapa/operacional`, calculado UMA vez por esta função.
 * Cada tela que recalculasse teria a sua versão da conta — e duas versões dão dois pontos para a mesma área.
 *
 * Graus de longitude e latitude entram como plano (sem projeção): para o tamanho de um pasto a distorção é
 * desprezível, e o ponto serve para ancorar um marcador, não para medir.
 */

/** Ponto [lon, lat] em graus. */
export interface CentroideDoPoligono {
  lon: number;
  lat: number;
}

/** Posição [lon, lat] com os dois números finitos; `null` em qualquer outra forma. */
function posicao(valor: unknown): [number, number] | null {
  if (!Array.isArray(valor) || valor.length < 2) return null;
  const [lon, lat] = valor as unknown[];
  if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

/**
 * CENTRÓIDE de um GeoJSON Polygon, só do anel EXTERNO (`coordinates[0]`; os furos não deslocam o marcador).
 *
 * Fórmula do laço, sobre os pontos válidos do anel, incluindo a aresta de fecho (do último ao primeiro):
 * para cada aresta (x0, y0) → (x1, y1): `a = x0*y1 − x1*y0`; `sA += a`; `cx += (x0+x1)*a`; `cy += (y0+y1)*a`.
 * Depois `sA *= 0.5`; `cx /= 6*sA`; `cy /= 6*sA`. O anel fechado (último ponto = primeiro, como o GeoJSON exige) e
 * o aberto dão o MESMO resultado: o ponto de fecho repetido é retirado antes da conta.
 *
 * DEGENERADO → CENTRO DA CAIXA (bounding box) dos pontos válidos: menos de 3 pontos distintos, área zero,
 * resultado não finito, ou resultado FORA da caixa (o centróide de um polígono simples nunca sai dela; sair é sinal
 * de anel que se cruza ou de área tão próxima de zero que a divisão só amplificou o arredondamento).
 *
 * Nunca lança. `null` SÓ quando não há nenhum ponto [lon, lat] finito: geometria nula, que não é Polygon (forma
 * desconhecida), ou anel sem posição válida. Posição inválida no meio do anel é ignorada.
 */
export function centroideDePoligono(geometria: unknown): CentroideDoPoligono | null {
  if (typeof geometria !== "object" || geometria === null) return null;
  const { type, coordinates } = geometria as { type?: unknown; coordinates?: unknown };
  if (type !== "Polygon" || !Array.isArray(coordinates) || !Array.isArray(coordinates[0])) return null;

  const pontos: [number, number][] = [];
  for (const valor of coordinates[0] as unknown[]) {
    const p = posicao(valor);
    if (p) pontos.push(p);
  }
  if (pontos.length === 0) return null;

  // Anel fechado: o último ponto repete o primeiro e sai — a aresta de fecho entra pelo índice circular abaixo.
  const primeiro = pontos[0]!;
  const ultimo = pontos[pontos.length - 1]!;
  if (pontos.length > 1 && ultimo[0] === primeiro[0] && ultimo[1] === primeiro[1]) pontos.pop();

  let minLon = Infinity; let maxLon = -Infinity; let minLat = Infinity; let maxLat = -Infinity;
  for (const [lon, lat] of pontos) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const centroDaCaixa: CentroideDoPoligono = { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 };

  const distintos = new Set(pontos.map(([lon, lat]) => `${lon},${lat}`));
  if (distintos.size < 3) return centroDaCaixa;

  let sA = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < pontos.length; i++) {
    const [x0, y0] = pontos[i]!;
    const [x1, y1] = pontos[(i + 1) % pontos.length]!;
    const a = x0 * y1 - x1 * y0;
    sA += a;
    cx += (x0 + x1) * a;
    cy += (y0 + y1) * a;
  }
  sA *= 0.5;
  if (sA === 0) return centroDaCaixa;
  cx /= 6 * sA;
  cy /= 6 * sA;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return centroDaCaixa;
  if (cx < minLon || cx > maxLon || cy < minLat || cy > maxLat) return centroDaCaixa;
  return { lon: cx, lat: cy };
}
