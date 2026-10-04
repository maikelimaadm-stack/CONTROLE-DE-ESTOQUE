/**
 * EMULADOR DA PROCESS API DO COPERNICUS (CDSE / Sentinel Hub) PARA TESTE — SAT-06, decisão 297.
 *
 * Um `BuscarFn` (a porta de saída da API, `app.buscarExterno`) que responde o pedido de TOKEN (OAuth2 client
 * credentials, token FALSO) e a PROCESS API com a semântica do provedor suficiente para provar os critérios da fatia:
 *
 *  - lê `input.bounds.bbox` + `properties.crs` (só EPSG:3857), `input.bounds.geometry` (3857), `output.width/height`,
 *    `output.responses`, `input.data[0].dataFilter.timeRange` e o `evalscript`; pedido fora disso → 400 com corpo JSON
 *    de erro, como o provedor;
 *  - RECORTE: pixel cujo CENTRO está fora do polígono (par-ímpar, furos inclusive) recebe `dataMask = 0` — SÓ quando
 *    `geometry` veio. Só com a caixa, nada é recortado (o provedor pinta o retângulo inteiro);
 *  - CENA SINTÉTICA DETERMINÍSTICA por DIA (o dia da cena = dia UTC de `timeRange.to − 1 ms`, o mais recente da faixa,
 *    como `mosaickingOrder: mostRecent` escolheria se houvesse aquisição todo dia): B04/B08 dão um NDVI que muda com o
 *    dia (base = 0,25 + 0,01 × (dia mod 37): dois dias distintos a menos de 37 dias um do outro diferem em ≥ 0,01) e
 *    com a posição (± 0,12); uma FAIXA DE NUVEM (SCL 9, linhas em [20%, 32%) da altura), uma FAIXA DE ÁGUA (SCL 6,
 *    colunas em [68%, 78%) da largura), uma faixa de SOLO EXPOSTO (SCL 5 — classe MANTIDA, linhas em [60%, 68%)) e
 *    vegetação (SCL 4) no resto. Nuvem e água têm reflectâncias que, sem a máscara, dariam byte ≠ 0;
 *  - executa o EVALSCRIPT DE VERDADE em `node:vm` (`setup()` conferido, `evaluatePixel()` por pixel; saída UINT8
 *    arredondada e saturada em 0..255, como o provedor) e devolve PNG cinza 8 bits (`escreverPngCinza8`);
 *  - cabeçalho `x-processingunits-spent`: `pu` do emulador (texto bruto; `null` = ausente; omitido = a estimativa
 *    pela fórmula de PU do provedor, `estimarPu`), sobrescrito por passo do roteiro;
 *  - ROTEIRO: fila de respostas forçadas da Process API (status 429/500/400…, Retry-After, PU, corpo vazio ou que não é
 *    PNG, "rede"); fila vazia = a semântica normal acima. Não há passo de "tempo esgotado": o tempo máximo da Process
 *    API no cliente é de 60 s por tentativa e não é injetável — o mapeamento de tempo é provado na porta HTTP;
 *  - REGISTRO de cada chamada: host, caminho, corpo JSON da Process API (o do token NÃO é guardado: leva o client
 *    secret), o Authorization recebido (token falso deste emulador) e o status respondido.
 *
 * `ndviMedioEsperado(dia, grade)` é a VERDADE da cena (média do NDVI real, sem quantização, dos pixels DENTRO do
 * polígono e fora das classes SCL excluídas) — para o teste semear `valor_medio` da análise e comparar com a média
 * DECODIFICADA da imagem (`mediaDecodificadaPng`) dentro de `TOLERANCIA_MEDIA_NDVI`.
 */
import { createContext, Script } from "node:vm";
import { VALORES_CLASSE_SCL_EXCLUIDA } from "@agro/domain";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { ENDERECOS_COPERNICUS } from "../../src/lib/satelite/copernicus.js";
import { decodificarValor, ESCALA_NDVI_RASTER } from "../../src/lib/satelite/evalscript-raster.js";
import { escreverPngCinza8, lerPngCinza8 } from "../../src/lib/satelite/png.js";
import { CRS_RASTER_URL, dataImagemUtc, LADO_MAXIMO_RASTER_PX } from "../../src/lib/satelite/raster.js";

export const HOST_TOKEN = ENDERECOS_COPERNICUS.token.host;
export const HOST_PROCESSO = ENDERECOS_COPERNICUS.processo.host;
/**
 * Tolerância da média decodificada contra a esperada: meio degrau da codificação ((1,0 − (−0,2)) / 254 / 2 ≈ 0,0024)
 * mais folga de arredondamento. A média de muitos pixels erra bem menos (os erros de ±meio degrau se compensam).
 */
export const TOLERANCIA_MEDIA_NDVI = 0.005;
export const CLASSE_NUVEM = 9;
export const CLASSE_AGUA = 6;
export const CLASSE_SOLO = 5;
export const CLASSE_VEGETACAO = 4;
const DIA_MS = 86_400_000;
const EXCLUIDAS = new Set(VALORES_CLASSE_SCL_EXCLUIDA);

/**
 * Estimativa de PU de UM pedido pela regra publicada do provedor (CDSE, "Processing Units"): fator de tamanho =
 * largura × altura / 512², com mínimo 0,01; × bandas de entrada / 3 (`dataMask` não conta); × 1 (PNG 8 bits); × 1
 * amostra (um dia); mínimo de 0,005 PU por pedido da Process API. É ESTIMATIVA, não medição: o valor cobrado é o do
 * cabeçalho `x-processingunits-spent`.
 */
export function estimarPu(largura: number, altura: number, bandasEntrada = 3): number {
  return Math.max(0.005, Math.max(0.01, (largura * altura) / (512 * 512)) * (bandasEntrada / 3));
}

/** O que a cena precisa saber da grade. `GradeRaster` serve direto. Sem `poligono3857` = sem recorte (só a caixa). */
export interface AlvoCena {
  bbox3857: readonly [number, number, number, number] | readonly number[];
  largura: number;
  altura: number;
  poligono3857?: { coordinates: readonly (readonly (readonly number[])[])[] } | null;
}

export interface CenaSintetica {
  dia: string;
  largura: number;
  altura: number;
  /** por pixel, linha a linha de cima (norte) para baixo, da esquerda (oeste) para a direita */
  b04: Float64Array;
  b08: Float64Array;
  scl: Uint8Array;
  /** 1 = centro do pixel dentro do polígono (ou não houve polígono) — o `dataMask` da cena */
  dentro: Uint8Array;
  /** NDVI REAL do pixel ((B08 − B04) / (B08 + B04)), sem quantização */
  ndvi: Float64Array;
}

const normalizarDia = (dia: string | Date): string => {
  const texto = typeof dia === "string" ? dia : dataImagemUtc(dia);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || Number.isNaN(Date.parse(`${texto}T00:00:00Z`))) throw new RangeError(`dia inválido: ${texto}`);
  return texto;
};

/** O dia da cena para um `timeRange`: o dia UTC do último instante da faixa (o mais recente). */
export function diaDaCena(timeRange: { from: string; to: string }): string {
  const ate = Date.parse(timeRange.to);
  return new Date(ate - 1).toISOString().slice(0, 10);
}

/** NDVI de base do dia: 0,25 + 0,01 × (dia mod 37). */
export function ndviBaseDoDia(dia: string | Date): number {
  const n = Math.floor(Date.parse(`${normalizarDia(dia)}T00:00:00Z`) / DIA_MS);
  return 0.25 + 0.01 * (((n % 37) + 37) % 37);
}

/** Máscara por par-ímpar do CENTRO de cada pixel, por varredura de linha (todas as arestas de todos os anéis). */
function mascaraDoPoligono(alvo: AlvoCena): Uint8Array {
  const { largura, altura } = alvo;
  const dentro = new Uint8Array(largura * altura);
  if (!alvo.poligono3857) return dentro.fill(1);
  const [minx, miny, maxx, maxy] = alvo.bbox3857 as [number, number, number, number];
  const px = (maxx - minx) / largura, py = (maxy - miny) / altura;
  const arestas: [number, number, number, number][] = [];
  for (const anel of alvo.poligono3857.coordinates) {
    for (let i = 0; i + 1 < anel.length; i++) arestas.push([anel[i]![0]!, anel[i]![1]!, anel[i + 1]![0]!, anel[i + 1]![1]!]);
  }
  for (let linha = 0; linha < altura; linha++) {
    const y = maxy - (linha + 0.5) * py;
    const cortes: number[] = [];
    for (const [x1, y1, x2, y2] of arestas) if ((y1 > y) !== (y2 > y)) cortes.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    cortes.sort((a, b) => a - b);
    let k = 0;
    for (let coluna = 0; coluna < largura; coluna++) {
      const x = minx + (coluna + 0.5) * px;
      while (k < cortes.length && cortes[k]! < x) k++;
      if (k % 2 === 1) dentro[linha * largura + coluna] = 1;
    }
  }
  return dentro;
}

export function cenaSintetica(dia: string | Date, alvo: AlvoCena): CenaSintetica {
  const d = normalizarDia(dia);
  const { largura, altura } = alvo;
  const [minx, miny, maxx, maxy] = alvo.bbox3857 as [number, number, number, number];
  const px = (maxx - minx) / largura, py = (maxy - miny) / altura;
  const base = ndviBaseDoDia(d);
  const total = largura * altura;
  const cena: CenaSintetica = {
    dia: d, largura, altura,
    b04: new Float64Array(total), b08: new Float64Array(total), scl: new Uint8Array(total), dentro: mascaraDoPoligono(alvo), ndvi: new Float64Array(total)
  };
  for (let linha = 0; linha < altura; linha++) {
    const v = (linha + 0.5) / altura;
    const y = maxy - (linha + 0.5) * py;
    for (let coluna = 0; coluna < largura; coluna++) {
      const u = (coluna + 0.5) / largura;
      const x = minx + (coluna + 0.5) * px;
      const i = linha * largura + coluna;
      let scl = CLASSE_VEGETACAO;
      if (v >= 0.6 && v < 0.68) scl = CLASSE_SOLO;
      if (u >= 0.68 && u < 0.78) scl = CLASSE_AGUA;
      if (v >= 0.2 && v < 0.32) scl = CLASSE_NUVEM;
      let b04: number, b08: number;
      if (scl === CLASSE_NUVEM) { b04 = 0.62; b08 = 0.66; }        // nuvem: clara nas duas bandas (NDVI ≈ 0,03)
      else if (scl === CLASSE_AGUA) { b04 = 0.06; b08 = 0.03; }    // água: NDVI negativo (≈ −0,33)
      else {
        const n = base + 0.12 * Math.sin(x / 173) * Math.cos(y / 211);
        b04 = 0.04 + 0.02 * (0.5 + 0.5 * Math.sin(x / 97 + y / 89));
        b08 = (b04 * (1 + n)) / (1 - n);
      }
      cena.scl[i] = scl; cena.b04[i] = b04; cena.b08[i] = b08; cena.ndvi[i] = (b08 - b04) / (b08 + b04);
    }
  }
  return cena;
}

/** Média do NDVI REAL dos pixels dentro do polígono e fora das classes SCL excluídas (a verdade da cena). */
export function ndviMedioEsperado(dia: string | Date, alvo: AlvoCena): number {
  const c = cenaSintetica(dia, alvo);
  let soma = 0, n = 0;
  for (let i = 0; i < c.ndvi.length; i++) {
    if (c.dentro[i] === 1 && !EXCLUIDAS.has(c.scl[i]!)) { soma += c.ndvi[i]!; n++; }
  }
  if (n === 0) throw new Error("cena sem pixel válido dentro do polígono");
  return soma / n;
}

/** Decodifica o PNG (leitor estrito) e devolve a média dos pixels com valor (byte ≠ 0) e quantos são. */
export function mediaDecodificadaPng(png: Buffer, escala: { min: number; max: number } = ESCALA_NDVI_RASTER): { media: number | null; validos: number; largura: number; altura: number } {
  const img = lerPngCinza8(png);
  let soma = 0, n = 0;
  for (const byte of img.pixels) {
    const v = decodificarValor(byte, escala.min, escala.max);
    if (v !== null) { soma += v; n++; }
  }
  return { media: n ? soma / n : null, validos: n, largura: img.largura, altura: img.altura };
}

export class ErroPedidoProcesso extends Error {
  constructor(motivo: string) { super(motivo); this.name = "ErroPedidoProcesso"; }
}

const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const recusar = (motivo: string): never => { throw new ErroPedidoProcesso(motivo); };

interface PedidoLido {
  bbox: [number, number, number, number];
  poligono: { coordinates: number[][][] } | null;
  largura: number;
  altura: number;
  timeRange: { from: string; to: string };
  evalscript: string;
}

function lerPedido(corpo: unknown): PedidoLido {
  const raiz = objeto(corpo) ?? recusar("corpo não é objeto");
  const input = objeto(raiz["input"]) ?? recusar("input ausente");
  const bounds = objeto(input["bounds"]) ?? recusar("bounds ausente");
  const bbox = bounds["bbox"];
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((n) => typeof n === "number" && Number.isFinite(n))) recusar("bbox inválida");
  const [x0, y0, x1, y1] = bbox as number[];
  if (!(x0! < x1!) || !(y0! < y1!)) recusar("bbox invertida");
  if (objeto(bounds["properties"])?.["crs"] !== CRS_RASTER_URL) recusar("crs não suportado pelo emulador (só EPSG:3857)");
  let poligono: PedidoLido["poligono"] = null;
  if (bounds["geometry"] !== undefined) {
    const g = objeto(bounds["geometry"]) ?? recusar("geometry inválida");
    const aneis = g["coordinates"];
    if (g["type"] !== "Polygon" || !Array.isArray(aneis) || aneis.length < 1) recusar("geometry não é Polygon");
    for (const anel of aneis as unknown[]) {
      if (!Array.isArray(anel) || anel.length < 4) recusar("anel inválido");
      for (const p of anel as unknown[]) if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === "number" && Number.isFinite(n))) recusar("posição inválida");
    }
    poligono = { coordinates: aneis as number[][][] };
  }
  const dados = input["data"];
  if (!Array.isArray(dados) || dados.length !== 1) recusar("input.data deve ter uma coleção");
  const d0 = objeto((dados as unknown[])[0]) ?? recusar("coleção inválida");
  if (d0["type"] !== "sentinel-2-l2a") recusar("coleção não suportada");
  const tr = objeto(objeto(d0["dataFilter"])?.["timeRange"]) ?? recusar("timeRange ausente");
  const de = typeof tr["from"] === "string" ? Date.parse(tr["from"]) : NaN;
  const ate = typeof tr["to"] === "string" ? Date.parse(tr["to"]) : NaN;
  if (Number.isNaN(de) || Number.isNaN(ate) || de >= ate) recusar("timeRange inválido");
  const saida = objeto(raiz["output"]) ?? recusar("output ausente");
  const largura = saida["width"], altura = saida["height"];
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || (largura as number) < 1 || (altura as number) < 1
    || (largura as number) > LADO_MAXIMO_RASTER_PX || (altura as number) > LADO_MAXIMO_RASTER_PX) recusar("width/height fora de 1..2500");
  const respostas = saida["responses"];
  const r0 = Array.isArray(respostas) && respostas.length === 1 ? objeto(respostas[0]) : null;
  if (!r0 || r0["identifier"] !== "default" || objeto(r0["format"])?.["type"] !== "image/png") recusar("responses deve ser uma, default, image/png");
  if (typeof raiz["evalscript"] !== "string" || !raiz["evalscript"]) recusar("evalscript ausente");
  return {
    bbox: bbox as [number, number, number, number], poligono, largura: largura as number, altura: altura as number,
    timeRange: { from: tr["from"] as string, to: tr["to"] as string }, evalscript: raiz["evalscript"] as string
  };
}

type Avaliador = (s: { B04: number; B08: number; SCL: number; dataMask: number }) => unknown;

/** Carrega o evalscript num contexto `node:vm` isolado e confere o `setup()` (entradas e saída UINT8 de 1 banda). */
function carregarEvalscript(fonte: string): Avaliador {
  if (!fonte.startsWith("//VERSION=3")) recusar("evalscript sem //VERSION=3");
  const contexto = createContext({});
  try { new Script(fonte, { filename: "evalscript.js" }).runInContext(contexto, { timeout: 1000 }); } catch { recusar("evalscript não compila"); }
  const setup = contexto["setup"] as unknown, avaliar = contexto["evaluatePixel"] as unknown;
  if (typeof setup !== "function" || typeof avaliar !== "function") recusar("evalscript sem setup/evaluatePixel");
  let cfg: Record<string, unknown> | null;
  try { cfg = objeto((setup as () => unknown)()); } catch { cfg = null; }
  if (!cfg) return recusar("setup() inválido");
  const entradas = Array.isArray(cfg["input"]) ? (cfg["input"] as unknown[]).flatMap((e) => (Array.isArray(objeto(e)?.["bands"]) ? (objeto(e)!["bands"] as unknown[]) : [])) : [];
  for (const banda of ["B04", "B08", "SCL", "dataMask"]) if (!entradas.includes(banda)) recusar(`setup() sem a banda ${banda}`);
  const saida = Array.isArray(cfg["output"]) && (cfg["output"] as unknown[]).length === 1 ? objeto((cfg["output"] as unknown[])[0]) : objeto(cfg["output"]);
  if (!saida || saida["bands"] !== 1 || saida["sampleType"] !== "UINT8") recusar("saída do evalscript não é 1 banda UINT8");
  return avaliar as Avaliador;
}

/** A semântica do provedor para um corpo da Process API: o PNG que ele devolveria. Pedido inválido → `ErroPedidoProcesso`. */
export function renderizarProcesso(corpo: unknown): { png: Buffer; pixels: Uint8Array; largura: number; altura: number; dia: string; cena: CenaSintetica } {
  const p = lerPedido(corpo);
  const avaliar = carregarEvalscript(p.evalscript);
  const dia = diaDaCena(p.timeRange);
  const cena = cenaSintetica(dia, { bbox3857: p.bbox, largura: p.largura, altura: p.altura, poligono3857: p.poligono });
  const pixels = new Uint8Array(p.largura * p.altura);
  for (let i = 0; i < pixels.length; i++) {
    let r: unknown;
    try { r = avaliar({ B04: cena.b04[i]!, B08: cena.b08[i]!, SCL: cena.scl[i]!, dataMask: cena.dentro[i]! }); } catch { recusar("evaluatePixel lançou"); }
    const arr = Array.isArray(r) ? r : objeto(r)?.["default"];
    if (!Array.isArray(arr) || arr.length !== 1) recusar("evaluatePixel não devolveu 1 banda");
    const v = Number((arr as unknown[])[0]);
    pixels[i] = Number.isFinite(v) ? Math.min(255, Math.max(0, Math.round(v))) : 0;
  }
  return { png: escreverPngCinza8(p.largura, p.altura, pixels), pixels, largura: p.largura, altura: p.altura, dia, cena };
}

export type PassoProcesso =
  | { status: number; retryAfter?: string; pu?: string | null; corpo?: Buffer | "vazio" | "nao-png" }
  | "rede";

export interface ChamadaEmulada {
  host: string;
  caminho: string;
  metodo: string | undefined;
  /** corpo JSON da Process API; `null` no pedido de token (que leva o client secret e não é guardado) */
  corpo: unknown;
  /** Authorization recebido (o token é FALSO, emitido por este emulador) */
  autorizacao: string | null;
  /** status respondido; `null` para "rede" */
  status: number | null;
}

export interface OpcoesEmulador {
  /** cabeçalho de PU das respostas 2xx: texto bruto; `null` = ausente; omitido = `estimarPu` com 4 casas */
  pu?: string | null;
  /** validade do token emitido, em segundos (padrão 3600) */
  tokenExpiraEmS?: number;
  /** resposta da Statistical API, se a suíte também a chamar (sem isto, chamá-la é erro do teste) */
  estatistica?: (corpo: unknown) => { status: number; body: unknown };
}

export interface EmuladorProcessApi {
  buscar: BuscarFn;
  readonly chamadas: ChamadaEmulada[];
  /** só as chamadas à Process API */
  chamadasProcesso(): ChamadaEmulada[];
  /** fila de respostas forçadas da Process API (consumida uma por chamada); vazia = semântica normal */
  roteiro: PassoProcesso[];
  /** fila de respostas forçadas do pedido de token; vazia = token válido */
  roteiroToken: { status: number; body?: unknown }[];
  /** PU das respostas 2xx normais (mutável no meio do teste) */
  pu: string | null | undefined;
  /** quantos tokens foram emitidos */
  readonly tokensEmitidos: number;
  /** derruba os tokens emitidos (o próximo uso na Process API recebe 401) */
  invalidarTokens(): void;
  /** o último PNG devolvido com 2xx pela semântica normal */
  readonly ultimoPng: Buffer | null;
  /** limpa registro, roteiros e o último PNG (o PU volta ao das opções) */
  limpar(): void;
}

function resposta(status: number, corpo: Buffer, cabecalhos: Record<string, string>) {
  const minusculos = Object.fromEntries(Object.entries(cabecalhos).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    headers: { get: (n: string) => minusculos[n.toLowerCase()] ?? null },
    json: async () => JSON.parse(corpo.toString("utf8")) as unknown,
    arrayBuffer: async () => { const ab = new ArrayBuffer(corpo.length); new Uint8Array(ab).set(corpo); return ab; }
  };
}
const respostaJson = (status: number, corpo: unknown, cabecalhos: Record<string, string> = {}) =>
  resposta(status, Buffer.from(JSON.stringify(corpo), "utf8"), { "content-type": "application/json", ...cabecalhos });
const erroProvedor = (status: number, mensagem: string) => ({ error: { status, reason: status === 400 ? "Bad Request" : "Error", message: mensagem, code: "COMMON_EXCEPTION" } });

export function criarEmuladorProcessApi(opcoes: OpcoesEmulador = {}): EmuladorProcessApi {
  const chamadas: ChamadaEmulada[] = [];
  const validos = new Set<string>();
  let emitidos = 0;
  let ultimoPng: Buffer | null = null;
  const estado = {
    roteiro: [] as PassoProcesso[],
    roteiroToken: [] as { status: number; body?: unknown }[],
    pu: opcoes.pu as string | null | undefined
  };

  const buscar: BuscarFn = async (url, init) => {
    const u = new URL(url);
    const autorizacao = init.headers["authorization"] ?? init.headers["Authorization"] ?? null;
    const registro: ChamadaEmulada = { host: u.host, caminho: u.pathname, metodo: init.method, corpo: null, autorizacao, status: null };
    chamadas.push(registro);

    if (u.host === HOST_TOKEN && u.pathname === ENDERECOS_COPERNICUS.token.caminho) {
      const forcado = estado.roteiroToken.shift();
      if (forcado) { registro.status = forcado.status; return respostaJson(forcado.status, forcado.body ?? { error: "invalid_client" }); }
      const token = `token-falso-emulador-${++emitidos}`;
      validos.add(token);
      registro.status = 200;
      return respostaJson(200, { access_token: token, expires_in: opcoes.tokenExpiraEmS ?? 3600, token_type: "Bearer" });
    }
    if (u.host === HOST_PROCESSO && u.pathname === ENDERECOS_COPERNICUS.estatistica.caminho) {
      if (!opcoes.estatistica) throw new Error("Statistical API chamada sem resposta configurada no emulador");
      registro.corpo = JSON.parse(init.body ?? "null") as unknown;
      const r = opcoes.estatistica(registro.corpo);
      registro.status = r.status;
      return respostaJson(r.status, r.body);
    }
    if (u.host !== HOST_PROCESSO || u.pathname !== ENDERECOS_COPERNICUS.processo.caminho) throw new Error(`destino inesperado no emulador: ${u.host}${u.pathname}`);

    let corpo: unknown = null;
    try { corpo = JSON.parse(init.body ?? ""); } catch { corpo = null; }
    registro.corpo = corpo;
    const bearer = typeof autorizacao === "string" && autorizacao.startsWith("Bearer ") ? autorizacao.slice(7) : null;
    if (!bearer || !validos.has(bearer)) { registro.status = 401; return respostaJson(401, erroProvedor(401, "unauthorized")); }

    const passo = estado.roteiro.shift();
    if (passo === "rede") throw new TypeError("fetch failed");
    const puCabecalho = (pu: string | null | undefined, largura: number, altura: number): Record<string, string> => {
      const valor = pu === undefined ? estimarPu(largura, altura).toFixed(4) : pu;
      return valor === null ? {} : { "x-processingunits-spent": valor };
    };
    if (passo && (passo.status < 200 || passo.status >= 300)) {
      registro.status = passo.status;
      return respostaJson(passo.status, erroProvedor(passo.status, "erro forçado pelo roteiro"), {
        ...(passo.retryAfter !== undefined ? { "retry-after": passo.retryAfter } : {}),
        ...(passo.pu !== undefined && passo.pu !== null ? { "x-processingunits-spent": passo.pu } : {})
      });
    }
    if (passo?.corpo !== undefined) {
      const bruto = passo.corpo === "vazio" ? Buffer.alloc(0) : passo.corpo === "nao-png" ? Buffer.from('{"nao":"png"}', "utf8") : passo.corpo;
      registro.status = passo.status;
      return resposta(passo.status, bruto, { "content-type": "image/png", ...puCabecalho("pu" in passo ? passo.pu : estado.pu, 1, 1) });
    }
    let render: ReturnType<typeof renderizarProcesso>;
    try { render = renderizarProcesso(corpo); } catch (e) {
      if (!(e instanceof ErroPedidoProcesso)) throw e;
      registro.status = 400;
      return respostaJson(400, erroProvedor(400, e.message));
    }
    ultimoPng = render.png;
    const status = passo?.status ?? 200;
    registro.status = status;
    return resposta(status, render.png, { "content-type": "image/png", ...puCabecalho(passo && "pu" in passo ? passo.pu : estado.pu, render.largura, render.altura) });
  };

  return {
    buscar,
    chamadas,
    chamadasProcesso: () => chamadas.filter((c) => c.host === HOST_PROCESSO && c.caminho === ENDERECOS_COPERNICUS.processo.caminho),
    get roteiro() { return estado.roteiro; },
    set roteiro(v) { estado.roteiro = v; },
    get roteiroToken() { return estado.roteiroToken; },
    set roteiroToken(v) { estado.roteiroToken = v; },
    get pu() { return estado.pu; },
    set pu(v) { estado.pu = v; },
    get tokensEmitidos() { return emitidos; },
    invalidarTokens: () => validos.clear(),
    get ultimoPng() { return ultimoPng; },
    limpar: () => { chamadas.length = 0; estado.roteiro = []; estado.roteiroToken = []; estado.pu = opcoes.pu; ultimoPng = null; }
  };
}
