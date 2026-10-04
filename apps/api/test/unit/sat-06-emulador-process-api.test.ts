import { describe, it, expect } from "vitest";
import { VALORES_CLASSE_SCL_EXCLUIDA } from "@agro/domain";
import { ClienteCopernicus, ENDERECOS_COPERNICUS, FalhaCopernicus } from "../../src/lib/satelite/copernicus.js";
import type { PoligonoGeoJson } from "../../src/lib/satelite/geometria.js";
import { lerPngCinza8 } from "../../src/lib/satelite/png.js";
import { montarCorpoProcesso, planejarGradeRaster } from "../../src/lib/satelite/raster.js";
import {
  CLASSE_AGUA, CLASSE_NUVEM, CLASSE_SOLO, cenaSintetica, criarEmuladorProcessApi, diaDaCena, estimarPu, mediaDecodificadaPng,
  ndviBaseDoDia, ndviMedioEsperado, renderizarProcesso, TOLERANCIA_MEDIA_NDVI
} from "../helpers/emulador-process-api.js";

/**
 * SAT-06 (decisão 297) — o EMULADOR da Process API (test/helpers/emulador-process-api.ts) com o cliente REAL e o corpo
 * REAL (`montarCorpoProcesso`). Prova a semântica de que os testes de integração dependem: recorte pela GEOMETRIA (só
 * quando ela vem), nuvem/água = 0 pela máscara do evalscript executado de verdade, média decodificada ≈ a verdade da
 * cena para o DIA pedido, dia diferente → média diferente, PU no cabeçalho, roteiro de falhas e registro sem segredo.
 */

const SEGREDO = "segredo-emulador-NAO-PODE-VAZAR";
const EXCLUIDAS = new Set(VALORES_CLASSE_SCL_EXCLUIDA);
const O = -56.1, S = -15.6, W = 0.01, H = 0.01;
/** Polígono em L: o quadrante NORDESTE (lng > O + W/2, lat > S + H/2) fica FORA — a reentrância. */
const L: PoligonoGeoJson = {
  type: "Polygon",
  coordinates: [[[O, S], [O + W, S], [O + W, S + H / 2], [O + W / 2, S + H / 2], [O + W / 2, S + H], [O, S + H], [O, S]]]
};
const DIA = "2026-09-20";
const janelaDoDia = (dia: string) => ({ inicio: new Date(`${dia}T00:00:00Z`), fim: new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000) });

function cliente(emu = criarEmuladorProcessApi()) {
  const esperas: number[] = [];
  const c = new ClienteCopernicus({ buscar: emu.buscar, credenciais: { clienteId: "cliente-emulador", segredo: SEGREDO }, esperar: async (ms) => { esperas.push(ms); } });
  return { emu, c, esperas };
}

describe("SAT-06 emulador — recorte pelo polígono em L, nuvem e água", () => {
  const grade = planejarGradeRaster(L);
  const cena = cenaSintetica(DIA, grade);

  it("pixel FORA do L vale 0; dentro, nuvem/água valem 0 e o resto ≥ 1 (contado pixel a pixel)", async () => {
    const t = cliente();
    const { png } = await t.c.processoComConsumo(montarCorpoProcesso(grade, janelaDoDia(DIA)));
    const img = lerPngCinza8(png);
    expect([img.largura, img.altura]).toEqual([grade.largura, grade.altura]);
    const conta = { fora: 0, foraNaReentrancia: 0, nuvemOuAguaDentro: 0, validosDentro: 0 };
    for (let i = 0; i < img.pixels.length; i++) {
      const byte = img.pixels[i]!;
      if (cena.dentro[i] === 0) {
        expect(byte, `pixel ${i} fora do polígono`).toBe(0);
        conta.fora++;
        const u = ((i % img.largura) + 0.5) / img.largura, v = (Math.floor(i / img.largura) + 0.5) / img.altura;
        if (u > 0.55 && u < 0.95 && v > 0.05 && v < 0.45) conta.foraNaReentrancia++;
      } else if (EXCLUIDAS.has(cena.scl[i]!)) {
        expect(byte, `pixel ${i} de nuvem/água`).toBe(0);
        conta.nuvemOuAguaDentro++;
      } else {
        expect(byte, `pixel ${i} válido`).toBeGreaterThanOrEqual(1);
        conta.validosDentro++;
      }
    }
    // premissas: a reentrância existe na grade, e há nuvem/água e pixel válido DENTRO do polígono
    expect(conta.foraNaReentrancia).toBeGreaterThan(500);
    expect(conta.nuvemOuAguaDentro).toBeGreaterThan(200);
    expect(conta.validosDentro).toBeGreaterThan(2000);
    // um pixel no meio da reentrância (fora das faixas de nuvem e água) é 0 — e na cena ele tem reflectância de vegetação
    const meio = Math.floor(0.42 * img.altura) * img.largura + Math.floor(0.6 * img.largura);
    expect([cena.dentro[meio], cena.scl[meio], img.pixels[meio]]).toEqual([0, 4, 0]);
  });

  it("nuvem (SCL 9) e água (SCL 6) dentro do polígono valem 0; solo exposto (SCL 5, classe mantida) NÃO", async () => {
    const t = cliente();
    const img = lerPngCinza8((await t.c.processoComConsumo(montarCorpoProcesso(grade, janelaDoDia(DIA)))).png);
    const por = { [CLASSE_NUVEM]: [] as number[], [CLASSE_AGUA]: [] as number[], [CLASSE_SOLO]: [] as number[] };
    for (let i = 0; i < img.pixels.length; i++) {
      const scl = cena.scl[i]!;
      if (cena.dentro[i] === 1 && scl in por) por[scl as 9 | 6 | 5].push(img.pixels[i]!);
    }
    expect(por[CLASSE_NUVEM].length).toBeGreaterThan(100);
    expect(por[CLASSE_AGUA].length).toBeGreaterThan(100);
    expect(por[CLASSE_SOLO].length).toBeGreaterThan(100);
    expect(por[CLASSE_NUVEM].every((b) => b === 0)).toBe(true);
    expect(por[CLASSE_AGUA].every((b) => b === 0)).toBe(true);
    expect(por[CLASSE_SOLO].every((b) => b >= 1)).toBe(true);
  });

  it("só a caixa (sem geometry) → SEM recorte: a reentrância é pintada", () => {
    const corpo = montarCorpoProcesso(grade, janelaDoDia(DIA)) as { input: { bounds: Record<string, unknown> } };
    delete corpo.input.bounds["geometry"];
    const r = renderizarProcesso(corpo);
    const semRecorte = cenaSintetica(DIA, { ...grade, poligono3857: null });
    expect(semRecorte.dentro.every((d) => d === 1)).toBe(true);
    let pintadosFora = 0;
    for (let i = 0; i < r.pixels.length; i++) if (cena.dentro[i] === 0 && r.pixels[i]! > 0) pintadosFora++;
    expect(pintadosFora).toBeGreaterThan(500);
  });
});

describe("SAT-06 emulador — média decodificada ≈ a verdade da cena do DIA pedido", () => {
  const grade = planejarGradeRaster(L);

  it(`média dos pixels decodificados ≈ ndviMedioEsperado(dia) com tolerância ${TOLERANCIA_MEDIA_NDVI} (meio degrau ≈ 0,0024 + folga)`, async () => {
    const t = cliente();
    const { png } = await t.c.processoComConsumo(montarCorpoProcesso(grade, janelaDoDia(DIA)));
    const m = mediaDecodificadaPng(png);
    const esperada = ndviMedioEsperado(DIA, grade);
    expect(m.validos).toBeGreaterThan(2000);
    expect(Math.abs(m.media! - esperada)).toBeLessThanOrEqual(TOLERANCIA_MEDIA_NDVI);
    // a cena do dia está dentro da escala (sem saturação que enviesasse a média)
    expect(esperada).toBeGreaterThan(-0.2);
    expect(esperada).toBeLessThan(1);
  });

  it("dia DIFERENTE → média diferente (≥ 0,01, o dobro da tolerância), e cada uma bate com a esperada do seu dia", async () => {
    const t = cliente();
    const medias: number[] = [];
    for (const dia of ["2026-09-20", "2026-09-21", "2026-09-05", "2026-10-03"]) {
      const m = mediaDecodificadaPng((await t.c.processoComConsumo(montarCorpoProcesso(grade, janelaDoDia(dia)))).png);
      expect(Math.abs(m.media! - ndviMedioEsperado(dia, grade))).toBeLessThanOrEqual(TOLERANCIA_MEDIA_NDVI);
      medias.push(m.media!);
    }
    for (let a = 0; a < medias.length; a++) for (let b = a + 1; b < medias.length; b++) expect(Math.abs(medias[a]! - medias[b]!)).toBeGreaterThanOrEqual(0.0099);
    // o dia da cena é o do fim da faixa (o mais recente): uma faixa de 30 dias que termina em 03/10 pinta 03/10, não 20/09
    expect(diaDaCena({ from: "2026-09-04T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" })).toBe("2026-10-03");
    expect(Math.abs(ndviBaseDoDia("2026-10-03") - ndviBaseDoDia("2026-09-20"))).toBeGreaterThanOrEqual(0.0099);
  });
});

describe("SAT-06 emulador — evalscript de verdade, PU, roteiro e registro", () => {
  const grade = planejarGradeRaster(L);
  const corpo = () => montarCorpoProcesso(grade, janelaDoDia(DIA));

  it("executa o evalscript RECEBIDO (um script que devolve 7 pinta tudo de 7)", () => {
    const c = corpo() as { evalscript: string };
    c.evalscript = `//VERSION=3
function setup() { return { input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }], output: { bands: 1, sampleType: "UINT8" } }; }
function evaluatePixel(s) { return [7]; }`;
    const r = renderizarProcesso(c);
    expect(r.pixels.every((b) => b === 7)).toBe(true);
  });

  it("PU: por padrão a estimativa da fórmula; configurável; ausente → puCabecalho null", async () => {
    const padrao = cliente();
    expect((await padrao.c.processoComConsumo(corpo())).puCabecalho).toBe(estimarPu(grade.largura, grade.altura).toFixed(4));
    const fixo = cliente(criarEmuladorProcessApi({ pu: "0.1234" }));
    expect((await fixo.c.processoComConsumo(corpo())).puCabecalho).toBe("0.1234");
    const sem = cliente(criarEmuladorProcessApi({ pu: null }));
    expect((await sem.c.processoComConsumo(corpo())).puCabecalho).toBeNull();
    sem.emu.pu = "2";
    expect((await sem.c.processoComConsumo(corpo())).puCabecalho).toBe("2");
  });

  it("roteiro: 429 com Retry-After curto e depois a imagem; 500 e depois a imagem; 400 → requisicao_recusada; 2xx vazio → resposta_malformada com PU", async () => {
    const t = cliente();
    t.emu.roteiro.push({ status: 429, retryAfter: "1" });
    expect((await t.c.processoComConsumo(corpo())).png.length).toBeGreaterThan(0);
    expect(t.esperas).toEqual([1000]);
    t.emu.roteiro.push({ status: 503 });
    await t.c.processoComConsumo(corpo());
    expect(t.emu.chamadasProcesso().map((c) => c.status)).toEqual([429, 200, 503, 200]);
    t.emu.roteiro.push({ status: 400 });
    const recusa = await t.c.processoComConsumo(corpo()).catch((e: unknown) => e);
    expect(recusa).toBeInstanceOf(FalhaCopernicus);
    expect((recusa as FalhaCopernicus).tipo).toBe("requisicao_recusada");
    t.emu.roteiro.push({ status: 200, corpo: "vazio", pu: "0.5" });
    const vazio = await t.c.processoComConsumo(corpo()).catch((e: unknown) => e);
    expect([(vazio as FalhaCopernicus).tipo, (vazio as FalhaCopernicus).puCabecalho]).toEqual(["resposta_malformada", "0.5"]);
  });

  it("token: um só para várias imagens; token derrubado → 401, o cliente renova uma vez", async () => {
    const t = cliente();
    await t.c.processoComConsumo(corpo());
    await t.c.processoComConsumo(corpo());
    expect(t.emu.tokensEmitidos).toBe(1);
    t.emu.invalidarTokens();
    await t.c.processoComConsumo(corpo());
    expect(t.emu.tokensEmitidos).toBe(2);
    expect(t.emu.chamadasProcesso().map((c) => c.status)).toEqual([200, 200, 401, 200]);
  });

  it("registro: host e caminho oficiais, corpo da Process API guardado, pedido de token NÃO guardado (leva o segredo)", async () => {
    const t = cliente();
    await t.c.processoComConsumo(corpo());
    expect(t.emu.chamadas.map((c) => [c.host, c.caminho, c.metodo, c.status])).toEqual([
      [ENDERECOS_COPERNICUS.token.host, ENDERECOS_COPERNICUS.token.caminho, "POST", 200],
      ["sh.dataspace.copernicus.eu", "/api/v1/process", "POST", 200]
    ]);
    expect(t.emu.chamadas[0]!.corpo).toBeNull();
    expect(t.emu.chamadasProcesso()[0]!.corpo).toEqual(JSON.parse(JSON.stringify(corpo())));
    expect(t.emu.chamadasProcesso()[0]!.autorizacao).toMatch(/^Bearer token-falso-emulador-\d+$/);
    expect(JSON.stringify(t.emu.chamadas)).not.toContain(SEGREDO);
    expect(t.emu.ultimoPng).not.toBeNull();
    t.emu.limpar();
    expect([t.emu.chamadas.length, t.emu.ultimoPng]).toEqual([0, null]);
  });

  it("pedido fora do contrato do provedor → 400 (sem crs 3857, sem evalscript, tamanho acima de 2500, responses errado)", async () => {
    interface Corpo {
      input: { bounds: { properties: { crs: string } }; data: { dataFilter: { timeRange: unknown } }[] };
      output: { width: number; responses: unknown[] };
      evalscript?: string;
    }
    const quebras: ((c: Corpo) => void)[] = [
      (c) => { c.input.bounds.properties.crs = "http://www.opengis.net/def/crs/OGC/1.3/CRS84"; },
      (c) => { delete c.evalscript; },
      (c) => { c.output.width = 2501; },
      (c) => { c.output.responses = [{ identifier: "default", format: { type: "image/jpeg" } }]; },
      (c) => { c.input.data[0]!.dataFilter.timeRange = { from: "2026-09-21T00:00:00Z", to: "2026-09-20T00:00:00Z" }; }
    ];
    for (const quebrar of quebras) {
      const t = cliente();
      const c = JSON.parse(JSON.stringify(corpo())) as Corpo;
      quebrar(c);
      const f = await t.c.processoComConsumo(c).catch((e: unknown) => e);
      expect((f as FalhaCopernicus).tipo).toBe("requisicao_recusada");
      expect(t.emu.chamadasProcesso().map((x) => x.status)).toEqual([400]);
    }
  });

  it("estimarPu: largura × altura / 512² (mínimo 0,01) × bandas/3, mínimo 0,005 por pedido", () => {
    expect(estimarPu(512, 512)).toBe(1);
    expect(estimarPu(2500, 2500)).toBeCloseTo(23.8419, 4);
    expect(estimarPu(104, 105)).toBeCloseTo(0.04166, 5);
    expect(estimarPu(32, 32)).toBe(0.01);
    expect(estimarPu(512, 512, 4)).toBeCloseTo(4 / 3, 10);
  });
});
