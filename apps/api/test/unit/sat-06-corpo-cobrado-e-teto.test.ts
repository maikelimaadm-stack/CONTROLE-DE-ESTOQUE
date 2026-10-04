import { afterEach, describe, it, expect, vi } from "vitest";
import type { BuscarFn, LeitorFluxo } from "../../src/lib/consultas/http.js";
import {
  ClienteCopernicus, ENDERECOS_COPERNICUS, FalhaCopernicus, TAMANHO_MAXIMO_PNG_PROCESSO_BYTES, TEMPO_MAXIMO_ESTATISTICA_MS, TEMPO_MAXIMO_PROCESSO_MS,
  type RegistroChamada
} from "../../src/lib/satelite/copernicus.js";
import { enviarPost, lerCorpoJson, leitorCorpoBinario } from "../../src/lib/satelite/http.js";
import { escreverPngCinza8 } from "../../src/lib/satelite/png.js";

/**
 * SAT-06 (decisão 297), achados da revisão independente:
 *
 * D-1 — resposta 2xx cujos cabeçalhos (com `x-processingunits-spent`) já chegaram e cujo CORPO estoura o tempo máximo
 * durante a leitura: a chamada FOI COBRADA. É falha `corpo` com o PU (→ `resposta_malformada` com `puCabecalho`), uma
 * chamada só — nunca `tempo`, que o cliente repetiria (segunda chamada paga, e o PU da primeira sumiria do ledger).
 * Vale para a Process API e para a Statistical API (o mesmo `enviarPost`). Só 3xx-5xx cortado pelo tempo é `tempo`.
 *
 * D-4(b) — o teto do corpo binário não depende de confiar no provedor: `content-length` acima do teto recusa antes de
 * ler; com fluxo, lê em pedaços e cancela assim que passa do teto; sem fluxo, `arrayBuffer` e conferência depois.
 */

const TOKEN_HOST = ENDERECOS_COPERNICUS.token.host;
const API_HOST = ENDERECOS_COPERNICUS.processo.host;
const PNG = escreverPngCinza8(4, 3, [0, 1, 2, 3, 250, 251, 252, 253, 7, 8, 9, 10]);

afterEach(() => { vi.useRealTimers(); });

/** Promessa que só termina (rejeitando) quando o sinal da chamada é abortado — o corpo "travado" no meio da leitura. */
const travadoAteAbortar = (sinal: AbortSignal) => new Promise<never>((_, rejeitar) => {
  if (sinal.aborted) rejeitar(new Error("abortado"));
  sinal.addEventListener("abort", () => rejeitar(new Error("abortado")));
});

/** Resposta cujos cabeçalhos chegaram e cujo corpo trava até o tempo máximo cortar (json, arrayBuffer e fluxo). */
function respostaComCorpoTravado(status: number, sinal: AbortSignal, pu: string | null) {
  return {
    status,
    headers: { get: (n: string) => (n === "x-processingunits-spent" ? pu : null) },
    json: () => travadoAteAbortar(sinal),
    arrayBuffer: () => travadoAteAbortar(sinal),
    body: { getReader: (): LeitorFluxo => ({ read: () => travadoAteAbortar(sinal), cancel: async () => {} }) }
  };
}

describe("SAT-06 D-1 — 2xx com o corpo cortado pelo tempo máximo: cobrada, falha `corpo` com o PU, não repetida", () => {
  it("enviarPost: 2xx + corpo abortado (binário e JSON) → { falha, corpo, 200, processingUnits } — e sem PU, sem a chave", async () => {
    for (const ler of [leitorCorpoBinario(1024), lerCorpoJson]) {
      const buscar: BuscarFn = async (_url, init) => respostaComCorpoTravado(200, init.signal, "5.5");
      expect(await enviarPost(buscar, "e.test", "/", "", {}, 20, Date.now, ler)).toStrictEqual({ tipo: "falha", motivo: "corpo", status: 200, processingUnits: "5.5" });
      const semPu: BuscarFn = async (_url, init) => respostaComCorpoTravado(200, init.signal, null);
      expect(await enviarPost(semPu, "e.test", "/", "", {}, 20, Date.now, ler)).toStrictEqual({ tipo: "falha", motivo: "corpo", status: 200 });
    }
  });
  it("enviarPost: 5xx/4xx + corpo abortado continua `tempo` (não foi cobrada: o cliente pode repetir o 5xx)", async () => {
    for (const status of [503, 429, 400]) {
      const buscar: BuscarFn = async (_url, init) => respostaComCorpoTravado(status, init.signal, "1");
      expect(await enviarPost(buscar, "e.test", "/", "", {}, 20, Date.now, leitorCorpoBinario(1024))).toStrictEqual({ tipo: "falha", motivo: "tempo", status });
    }
  });

  /** Cliente cujo pedido de token responde na hora e cuja API responde 2xx com PU e corpo travado. */
  function clienteComCorpoTravado(pu: string | null) {
    const naApi: string[] = [];
    const registros: RegistroChamada[] = [];
    const buscar: BuscarFn = async (url, init) => {
      const u = new URL(url);
      if (u.host === TOKEN_HOST) return { status: 200, headers: { get: () => null }, json: async () => ({ access_token: "t", expires_in: 600 }) };
      naApi.push(u.pathname);
      return respostaComCorpoTravado(200, init.signal, pu);
    };
    const c = new ClienteCopernicus({ buscar, credenciais: { clienteId: "c", segredo: "s" }, esperar: async () => {} });
    return { c, naApi, registros, registrar: (r: RegistroChamada) => registros.push(r) };
  }

  it("processoComConsumo: UMA chamada, resposta_malformada COM puCabecalho \"5.5\" (o consumo é gravado por quem chamou)", async () => {
    vi.useFakeTimers();
    const t = clienteComCorpoTravado("5.5");
    const pedido = t.c.processoComConsumo({}, t.registrar).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(TEMPO_MAXIMO_PROCESSO_MS + 1);
    const f = await pedido;
    expect(f).toBeInstanceOf(FalhaCopernicus);
    expect([(f as FalhaCopernicus).tipo, (f as FalhaCopernicus).status, (f as FalhaCopernicus).puCabecalho]).toEqual(["resposta_malformada", 200, "5.5"]);
    expect(t.naApi).toEqual(["/api/v1/process"]);
    expect(t.registros.filter((r) => r.endpoint === "processo").map((r) => [r.status, r.tentativa, r.tipoFalha])).toEqual([[200, 1, "resposta_malformada"]]);
  });
  it("processoComConsumo sem o cabeçalho: puCabecalho null DEFINIDO (cobrada, PU desconhecido), uma chamada", async () => {
    vi.useFakeTimers();
    const t = clienteComCorpoTravado(null);
    const pedido = t.c.processoComConsumo({}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(TEMPO_MAXIMO_PROCESSO_MS + 1);
    const f = (await pedido) as FalhaCopernicus;
    expect([f.tipo, f.puCabecalho]).toEqual(["resposta_malformada", null]);
    expect(t.naApi).toHaveLength(1);
  });
  it("Statistical API (SAT-01/SAT-03): o mesmo — resposta_malformada com o PU, uma chamada, sem repetir", async () => {
    vi.useFakeTimers();
    const t = clienteComCorpoTravado("0.25");
    const pedido = t.c.estatisticaComConsumo({}, t.registrar).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(TEMPO_MAXIMO_ESTATISTICA_MS + 1);
    const f = (await pedido) as FalhaCopernicus;
    expect([f.tipo, f.status, f.puCabecalho]).toEqual(["resposta_malformada", 200, "0.25"]);
    expect(t.naApi).toEqual(["/statistics/v1"]);
  });
});

/** Fluxo falso em pedaços de `tamanho` bytes, `quantos` pedaços (Infinity = sem fim), contando leituras e cancelamento. */
function fluxoEmPedacos(tamanho: number, quantos: number) {
  const estado = { lidos: 0, cancelado: false };
  const leitor: LeitorFluxo = {
    read: async () => {
      if (estado.cancelado) throw new Error("lido depois de cancelado");
      if (estado.lidos >= quantos) return { done: true };
      estado.lidos++;
      return { done: false, value: new Uint8Array(tamanho).fill(estado.lidos & 0xff) };
    },
    cancel: async () => { estado.cancelado = true; }
  };
  return { estado, corpo: { getReader: () => leitor } };
}
const respostaFluxo = (status: number, corpo: { getReader(): LeitorFluxo }, cabecalhos: Record<string, string> = {}, arrayBuffer?: () => Promise<ArrayBuffer>) => ({
  status,
  headers: { get: (n: string) => cabecalhos[n] ?? null },
  json: async () => { throw new SyntaxError("binário"); },
  ...(arrayBuffer ? { arrayBuffer } : {}),
  body: corpo
});

describe("SAT-06 D-4(b) — teto do corpo binário sem carregar o corpo inteiro", () => {
  const ler = leitorCorpoBinario(1024);

  it("content-length acima do teto: recusa ANTES de ler (nenhuma leitura, fluxo cancelado, arrayBuffer não chamado) → `corpo` com PU", async () => {
    const f = fluxoEmPedacos(100, 3);
    let arrayBufferChamado = false;
    const buscar: BuscarFn = async () => respostaFluxo(200, f.corpo, { "content-length": "2048", "x-processingunits-spent": "0.4" }, async () => { arrayBufferChamado = true; return new ArrayBuffer(0); });
    expect(await enviarPost(buscar, "e.test", "/", "", {}, 1000, Date.now, ler)).toStrictEqual({ tipo: "falha", motivo: "corpo", status: 200, processingUnits: "0.4" });
    expect([f.estado.lidos, f.estado.cancelado, arrayBufferChamado]).toEqual([0, true, false]);
  });
  it("fluxo sem content-length (ou mentindo) que passa do teto: para e cancela no pedaço que estourou — não lê o resto", async () => {
    for (const cabecalhos of [{}, { "content-length": "10" }] as Record<string, string>[]) {
      const f = fluxoEmPedacos(300, Number.POSITIVE_INFINITY); // corpo sem fim (ex.: gzip que descomprime sem parar)
      const buscar: BuscarFn = async () => respostaFluxo(200, f.corpo, { ...cabecalhos, "x-processingunits-spent": "0.9" });
      expect(await enviarPost(buscar, "e.test", "/", "", {}, 1000, Date.now, ler)).toStrictEqual({ tipo: "falha", motivo: "corpo", status: 200, processingUnits: "0.9" });
      expect([f.estado.lidos, f.estado.cancelado]).toEqual([4, true]); // 300+300+300 = 900 ≤ 1024; o 4º passa (1200)
    }
  });
  it("fluxo dentro do teto: devolve os bytes concatenados, na ordem, sem chamar arrayBuffer", async () => {
    const f = fluxoEmPedacos(256, 4); // 1024 = exatamente o teto
    let arrayBufferChamado = false;
    const buscar: BuscarFn = async () => respostaFluxo(200, f.corpo, {}, async () => { arrayBufferChamado = true; return new ArrayBuffer(0); });
    const r = await enviarPost(buscar, "e.test", "/", "", {}, 1000, Date.now, ler);
    expect(r.tipo).toBe("ok");
    const corpo = r.tipo === "ok" ? (r.corpo as Buffer) : Buffer.alloc(0);
    expect(corpo.length).toBe(1024);
    expect([corpo[0], corpo[256], corpo[512], corpo[1023]]).toEqual([1, 2, 3, 4]);
    expect([f.estado.cancelado, arrayBufferChamado]).toEqual([false, false]);
  });
  it("sem fluxo: arrayBuffer e conferência depois de ler (acima do teto → `corpo` com PU; vazio → `corpo`)", async () => {
    const grande: BuscarFn = async () => ({ status: 200, headers: { get: (n: string) => (n === "x-processingunits-spent" ? "2" : null) }, json: async () => null, arrayBuffer: async () => new ArrayBuffer(1025) });
    expect(await enviarPost(grande, "e.test", "/", "", {}, 1000, Date.now, ler)).toStrictEqual({ tipo: "falha", motivo: "corpo", status: 200, processingUnits: "2" });
    const vazio: BuscarFn = async () => ({ status: 200, headers: { get: () => null }, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) });
    expect(await enviarPost(vazio, "e.test", "/", "", {}, 1000, Date.now, ler)).toStrictEqual({ tipo: "falha", motivo: "corpo", status: 200 });
  });
  it("com a classe Response REAL do Node (a do fetch): o PNG sai pelo fluxo; um fluxo maior que o teto é cancelado no teto", async () => {
    const ok = await enviarPost(async () => new Response(PNG, { status: 200, headers: { "x-processingunits-spent": "0.7" } }), "e.test", "/", "", {}, 1000, Date.now, ler);
    expect(ok.tipo === "ok" && Buffer.isBuffer(ok.corpo) && ok.corpo.equals(PNG) && ok.processingUnits === "0.7").toBe(true);
    // 64 pedaços de 256 bytes (16 KiB) contra um teto de 1 KiB. Finito de propósito: com um fluxo SEM fim, um leitor que
    // carregasse o corpo inteiro (o defeito) derrubaria o processo de teste por falta de memória em vez de reprovar.
    let puxados = 0, cancelado = false;
    const grande = new ReadableStream<Uint8Array>({
      pull: (c) => { puxados++; c.enqueue(new Uint8Array(256)); if (puxados === 64) c.close(); },
      cancel: () => { cancelado = true; }
    }, { highWaterMark: 0 });
    const r = await enviarPost(async () => new Response(grande, { status: 200, headers: { "x-processingunits-spent": "0.8" } }), "e.test", "/", "", {}, 1000, Date.now, ler);
    expect(r).toStrictEqual({ tipo: "falha", motivo: "corpo", status: 200, processingUnits: "0.8" });
    expect(cancelado).toBe(true);
    expect(puxados).toBeLessThanOrEqual(6); // 5 pedaços de 256 passam de 1024; nunca os 64
  });
  it("processoComConsumo: content-length declarado acima de 16 MiB → resposta_malformada com o PU, UMA chamada, nada lido", async () => {
    const f = fluxoEmPedacos(1, 1);
    const naApi: string[] = [];
    const buscar: BuscarFn = async (url) => {
      if (new URL(url).host === TOKEN_HOST) return { status: 200, headers: { get: () => null }, json: async () => ({ access_token: "t", expires_in: 600 }) };
      naApi.push(url);
      return respostaFluxo(200, f.corpo, { "content-length": String(TAMANHO_MAXIMO_PNG_PROCESSO_BYTES + 1), "x-processingunits-spent": "3" });
    };
    const c = new ClienteCopernicus({ buscar, credenciais: { clienteId: "c", segredo: "s" }, esperar: async () => {} });
    const falha = (await c.processoComConsumo({}).catch((e: unknown) => e)) as FalhaCopernicus;
    expect([falha.tipo, falha.puCabecalho]).toEqual(["resposta_malformada", "3"]);
    expect(naApi).toEqual([`https://${API_HOST}/api/v1/process`]);
    expect([f.estado.lidos, f.estado.cancelado]).toEqual([0, true]);
  });
});
