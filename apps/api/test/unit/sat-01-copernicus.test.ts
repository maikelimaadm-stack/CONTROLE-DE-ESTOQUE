import { describe, it, expect } from "vitest";
import { CLASSES_SCL_EXCLUIDAS, CRITERIO_OBSERVACAO_UTIL, JANELA_PADRAO_DIAS } from "@agro/domain";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { enviarPost, segundosDoRetryAfter } from "../../src/lib/satelite/http.js";
import {
  ClienteCopernicus, ENDERECOS_COPERNICUS, ESPERA_ENTRE_TENTATIVAS_MS, FalhaCopernicus, LIMITE_TEXTO_ERRO_PROVEDOR,
  MARGEM_RENOVACAO_TOKEN_S, camposLogErroProvedor, sanitizarErroProvedor, type RegistroChamada
} from "../../src/lib/satelite/copernicus.js";
import { areaEmGraus, lerPoligono, metrosPorGrau, planejarGrade, type PoligonoGeoJson } from "../../src/lib/satelite/geometria.js";
import {
  EVALSCRIPT_NDVI, escolherObservacao, interpretarEstatistica, janelaPadrao, montarCorpoEstatistica, type EstatisticaLida
} from "../../src/lib/satelite/ndvi.js";

/**
 * SAT-01 (decisão 293) — o cliente do Copernicus, o método NDVI e a geometria, sobre HTTP FALSO. Nenhum teste fala
 * com a rede nem usa conta real: o gate com a conta real é externo e fica PENDING até existir credencial.
 */

const SEGREDO = "segredo-de-teste-NAO-PODE-VAZAR";
const CLIENTE_ID = "cliente-de-teste";
const TOKEN = "token-de-teste-NAO-PODE-VAZAR";

type Resp = { status: number; body?: unknown; retryAfter?: string; location?: string; jsonQuebrado?: boolean } | "tempo" | "rede";
interface Chamada { url: string; method: string | undefined; body: string | undefined; headers: Record<string, string> }

/** HTTP falso: uma fila de respostas por host; registra cada chamada (url, método, corpo, cabeçalhos). */
function falso(rotas: Record<string, Resp[]>) {
  const chamadas: Chamada[] = [];
  const buscar: BuscarFn = async (url, init) => {
    chamadas.push({ url, method: init.method, body: init.body, headers: init.headers });
    const fila = rotas[new URL(url).host];
    const r = fila?.shift();
    if (!r) throw new Error(`rota sem resposta falsa: ${url}`);
    if (r === "rede") throw new TypeError("fetch failed");
    if (r === "tempo") return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("abort"))));
    return {
      status: r.status,
      headers: { get: (n: string) => (n === "retry-after" ? r.retryAfter ?? null : n === "location" ? r.location ?? null : null) },
      json: async () => { if (r.jsonQuebrado) throw new SyntaxError("json"); return r.body; }
    };
  };
  return { buscar, chamadas };
}

const TOKEN_HOST = ENDERECOS_COPERNICUS.token.host;
const API_HOST = ENDERECOS_COPERNICUS.estatistica.host;
const tokenOk = (expiraEm = 600, valor = TOKEN): Resp => ({ status: 200, body: { access_token: valor, expires_in: expiraEm, token_type: "Bearer" } });
const estatOk: Resp = { status: 200, body: { data: [], status: "OK" } };

function cliente(rotas: Record<string, Resp[]>, opcoes: { agora?: () => number } = {}) {
  const f = falso(rotas);
  const esperas: number[] = [];
  const registros: RegistroChamada[] = [];
  const c = new ClienteCopernicus({ buscar: f.buscar, credenciais: { clienteId: CLIENTE_ID, segredo: SEGREDO }, agora: opcoes.agora, esperar: async (ms) => { esperas.push(ms); } });
  const pedir = () => c.estatistica({ corpo: "qualquer" }, (r) => registros.push(r));
  return { c, f, esperas, registros, pedir };
}

async function falhaDe(p: Promise<unknown>): Promise<FalhaCopernicus> {
  try { await p; } catch (e) { if (e instanceof FalhaCopernicus) return e; throw e; }
  throw new Error("esperava FalhaCopernicus");
}

/** Nada que sai do cliente (erro, registro de chamada) carrega o segredo ou o token. */
function semSegredo(...coisas: unknown[]) {
  for (const c of coisas) {
    const t = c instanceof Error ? `${c.name} ${c.message} ${c.stack ?? ""} ${JSON.stringify(c)}` : JSON.stringify(c);
    expect(t).not.toContain(SEGREDO);
    expect(t).not.toContain(TOKEN);
    expect(t).not.toMatch(/Bearer/i);
  }
}

describe("SAT-01 HTTP — POST para host fixo (enviarPost) e Retry-After", () => {
  it("envia POST com corpo e cabeçalhos ao host fixo e devolve status + JSON", async () => {
    const f = falso({ "exemplo.test": [{ status: 200, body: { ok: 1 }, retryAfter: "5" }] });
    const r = await enviarPost(f.buscar, "exemplo.test", "/x", "a=1", { "content-type": "text/plain" }, 1000);
    expect(r).toEqual({ tipo: "ok", status: 200, corpo: { ok: 1 }, tentarAposSegundos: 5 });
    expect(f.chamadas).toEqual([{ url: "https://exemplo.test/x", method: "POST", body: "a=1", headers: { accept: "application/json", "content-type": "text/plain" } }]);
  });
  it("NÃO segue redirecionamento (nem para o mesmo host): o corpo pode levar credencial", async () => {
    const f = falso({ "exemplo.test": [{ status: 307, location: "https://exemplo.test/y" }] });
    expect(await enviarPost(f.buscar, "exemplo.test", "/x", "", {}, 1000)).toEqual({ tipo: "falha", motivo: "redirecionamento", status: 307 });
    expect(f.chamadas).toHaveLength(1);
  });
  it("tempo esgotado, rede e JSON quebrado viram falha tipada; 4xx sem JSON devolve corpo nulo", async () => {
    expect(await enviarPost(falso({ "e.test": ["tempo"] }).buscar, "e.test", "/", "", {}, 20)).toEqual({ tipo: "falha", motivo: "tempo" });
    expect(await enviarPost(falso({ "e.test": ["rede"] }).buscar, "e.test", "/", "", {}, 1000)).toEqual({ tipo: "falha", motivo: "rede" });
    expect(await enviarPost(falso({ "e.test": [{ status: 200, jsonQuebrado: true }] }).buscar, "e.test", "/", "", {}, 1000)).toEqual({ tipo: "falha", motivo: "corpo", status: 200 });
    expect(await enviarPost(falso({ "e.test": [{ status: 502, jsonQuebrado: true }] }).buscar, "e.test", "/", "", {}, 1000)).toEqual({ tipo: "ok", status: 502, corpo: null, tentarAposSegundos: null });
  });
  it("caminho que tenta trocar o host é recusado antes de qualquer chamada", async () => {
    const f = falso({});
    await expect(enviarPost(f.buscar, "e.test", "@outro.test/x", "", {}, 1000)).rejects.toThrow(/host fixo/);
    expect(f.chamadas).toHaveLength(0);
  });
  it("Retry-After: segundos, data HTTP, ilegível e passado", () => {
    const agora = Date.parse("2026-10-03T12:00:00Z");
    expect(segundosDoRetryAfter("7", agora)).toBe(7);
    expect(segundosDoRetryAfter("Sat, 03 Oct 2026 12:00:30 GMT", agora)).toBe(30);
    expect(segundosDoRetryAfter("Sat, 03 Oct 2026 11:00:00 GMT", agora)).toBeNull();
    expect(segundosDoRetryAfter("amanhã", agora)).toBeNull();
    expect(segundosDoRetryAfter(null, agora)).toBeNull();
  });
});

describe("SAT-01 OAuth — token do client credentials, reutilizado e renovado", () => {
  it("obtém o token por client credentials (form-urlencoded) e chama a Statistical API com Bearer", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [estatOk] });
    expect(await t.pedir()).toEqual({ data: [], status: "OK" });
    const [tok, api] = t.f.chamadas;
    expect(tok!.url).toBe(`https://${TOKEN_HOST}${ENDERECOS_COPERNICUS.token.caminho}`);
    expect(tok!.method).toBe("POST");
    expect(tok!.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(tok!.body))).toEqual({ grant_type: "client_credentials", client_id: CLIENTE_ID, client_secret: SEGREDO });
    expect(api!.url).toBe(`https://${API_HOST}/statistics/v1`);
    expect(api!.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(api!.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(api!.body!)).toEqual({ corpo: "qualquer" });
    expect(t.registros.map((r) => [r.endpoint, r.status, r.tipoFalha])).toEqual([["token", 200, null], ["estatistica", 200, null]]);
    semSegredo(t.registros);
  });
  it("REUTILIZA o token enquanto vale: três análises, uma emissão", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [estatOk, estatOk, estatOk] });
    await t.pedir(); await t.pedir(); await t.pedir();
    expect(t.f.chamadas.filter((c) => c.url.includes(TOKEN_HOST))).toHaveLength(1);
    expect(t.f.chamadas.filter((c) => c.url.includes(API_HOST))).toHaveLength(3);
  });
  it("RENOVA com margem antes do fim: dentro da margem já pede outro", async () => {
    let agora = 1_000_000;
    const t = cliente({ [TOKEN_HOST]: [tokenOk(600, "t1"), tokenOk(600, "t2")], [API_HOST]: [estatOk, estatOk, estatOk] }, { agora: () => agora });
    await t.pedir();
    agora += (600 - MARGEM_RENOVACAO_TOKEN_S - 1) * 1000; // ainda fora da margem
    await t.pedir();
    agora += 2000; // entrou na margem de renovação
    await t.pedir();
    const auth = t.f.chamadas.filter((c) => c.url.includes(API_HOST)).map((c) => c.headers["authorization"]);
    expect(auth).toEqual(["Bearer t1", "Bearer t1", "Bearer t2"]);
  });
  it("pedidos SIMULTÂNEOS esperam a MESMA emissão de token", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [estatOk, estatOk, estatOk] });
    await Promise.all([t.pedir(), t.pedir(), t.pedir()]);
    expect(t.f.chamadas.filter((c) => c.url.includes(TOKEN_HOST))).toHaveLength(1);
  });
  it("sem credencial: falha de configuração, nenhuma chamada HTTP", async () => {
    const f = falso({});
    const c = new ClienteCopernicus({ buscar: f.buscar, credenciais: null });
    expect(c.configurado).toBe(false);
    expect((await falhaDe(c.estatistica({}))).tipo).toBe("configuracao");
    expect(f.chamadas).toHaveLength(0);
  });
  it("credencial recusada no token (401/400) → autenticacao; token sem access_token/expires_in → resposta_malformada", async () => {
    for (const status of [400, 401]) {
      const t = cliente({ [TOKEN_HOST]: [{ status, body: { error: "invalid_client", error_description: `client ${SEGREDO}` } }] });
      const f = await falhaDe(t.pedir());
      expect([f.tipo, f.status]).toEqual(["autenticacao", status]);
      expect(t.f.chamadas.filter((c) => c.url.includes(API_HOST))).toHaveLength(0);
      semSegredo(f, t.registros);
    }
    for (const body of [{ expires_in: 600 }, { access_token: TOKEN }, { access_token: "", expires_in: 600 }, { access_token: TOKEN, expires_in: -1 }, [1]]) {
      const t = cliente({ [TOKEN_HOST]: [{ status: 200, body }] });
      const f = await falhaDe(t.pedir());
      expect(f.tipo).toBe("resposta_malformada");
      semSegredo(f, t.registros);
    }
  });
});

describe("SAT-01 resiliência — 401, 403, 429, 5xx, tempo, rede, 4xx", () => {
  it("401 na API: descarta o token, emite outro e tenta UMA vez", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk(600, "velho"), tokenOk(600, "novo")], [API_HOST]: [{ status: 401 }, estatOk] });
    expect(await t.pedir()).toEqual({ data: [], status: "OK" });
    expect(t.f.chamadas.filter((c) => c.url.includes(API_HOST)).map((c) => c.headers["authorization"])).toEqual(["Bearer velho", "Bearer novo"]);
  });
  it("401 persistente → autenticacao, sem laço (2 chamadas à API, 2 tokens)", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk(), tokenOk()], [API_HOST]: [{ status: 401 }, { status: 401 }] });
    const f = await falhaDe(t.pedir());
    expect([f.tipo, f.status]).toEqual(["autenticacao", 401]);
    expect(t.f.chamadas).toHaveLength(4);
    semSegredo(f, t.registros);
  });
  it("403 → acesso_negado, NUNCA repete", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 403, body: { error: { message: "no access" } } }] });
    expect((await falhaDe(t.pedir())).tipo).toBe("acesso_negado");
    expect(t.f.chamadas.filter((c) => c.url.includes(API_HOST))).toHaveLength(1);
  });
  it("429 com Retry-After curto: espera o que o provedor pediu e tenta de novo", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 429, retryAfter: "2" }, estatOk] });
    expect(await t.pedir()).toEqual({ data: [], status: "OK" });
    expect(t.esperas).toEqual([2000]);
  });
  it("429 com Retry-After longo ou ausente: devolve o limite (com a espera) sem repetir", async () => {
    const longo = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 429, retryAfter: "60" }] });
    const f = await falhaDe(longo.pedir());
    expect([f.tipo, f.status, f.tentarAposSegundos]).toEqual(["limite", 429, 60]);
    expect(longo.esperas).toEqual([]);
    expect(longo.f.chamadas.filter((c) => c.url.includes(API_HOST))).toHaveLength(1);
    const sem = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 429 }] });
    expect((await falhaDe(sem.pedir())).tentarAposSegundos).toBeNull();
    expect(sem.f.chamadas.filter((c) => c.url.includes(API_HOST))).toHaveLength(1);
  });
  it("5xx: repete UMA vez após a espera; persistente → indisponivel", async () => {
    const volta = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 503 }, estatOk] });
    expect(await volta.pedir()).toEqual({ data: [], status: "OK" });
    expect(volta.esperas).toEqual([ESPERA_ENTRE_TENTATIVAS_MS]);
    const fora = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 500 }, { status: 500 }] });
    const f = await falhaDe(fora.pedir());
    expect([f.tipo, f.status]).toEqual(["indisponivel", 500]);
    expect(fora.f.chamadas.filter((c) => c.url.includes(API_HOST))).toHaveLength(2);
    expect(fora.registros.filter((r) => r.endpoint === "estatistica").map((r) => r.tentativa)).toEqual([1, 2]);
  });
  it("tempo esgotado e falha de rede: repete uma vez; persistente → tempo / rede", async () => {
    const tempo = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: ["rede", "rede"] });
    expect((await falhaDe(tempo.pedir())).tipo).toBe("rede");
    expect(tempo.f.chamadas.filter((c) => c.url.includes(API_HOST))).toHaveLength(2);
    const volta = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: ["rede", estatOk] });
    expect(await volta.pedir()).toEqual({ data: [], status: "OK" });
  });
  it("tempo esgotado de verdade (AbortSignal) vira `tempo`", async () => {
    // O tempo máximo real é 30 s; aqui provamos o mapeamento com o enviarPost e um tempo curto.
    const r = await enviarPost(falso({ [API_HOST]: ["tempo"] }).buscar, API_HOST, "/statistics/v1", "{}", {}, 10);
    expect(r).toEqual({ tipo: "falha", motivo: "tempo" });
  });
  it("400/404/422 → requisicao_recusada, NUNCA repete; corpo bruto não vai para o erro; recorte sanitizado sim", async () => {
    for (const status of [400, 404, 422]) {
      const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{
        status,
        body: { error: { code: "COMMON_BAD_PAYLOAD", message: `detalhe ${SEGREDO}`, errors: [{ parameter: "aggregation.timeRange" }] } }
      }] });
      const f = await falhaDe(t.pedir());
      expect([f.tipo, f.status]).toEqual(["requisicao_recusada", status]);
      expect(t.f.chamadas.filter((c) => c.url.includes(API_HOST))).toHaveLength(1);
      expect(f.erroProvedor).toEqual({
        status, code: "COMMON_BAD_PAYLOAD", message: "detalhe [redacted]", parameter: "aggregation.timeRange",
        detailMessage: null, detailReason: null
      });
      const reg = t.registros.find((r) => r.endpoint === "estatistica");
      expect(reg?.erroProvedor).toEqual(f.erroProvedor);
      expect(camposLogErroProvedor(reg?.erroProvedor)).toEqual({
        provider_status: status,
        provider_error_code: "COMMON_BAD_PAYLOAD",
        provider_error_message_sanitized: "detalhe [redacted]",
        provider_parameter: "aggregation.timeRange",
        provider_detail_message_sanitized: null,
        provider_detail_reason_sanitized: null
      });
      expect(f.message).not.toContain("COMMON_BAD_PAYLOAD");
      expect(f.message).not.toContain("aggregation");
      semSegredo(f, t.registros, camposLogErroProvedor(f.erroProvedor));
    }
  });
  it("2xx com corpo que não é JSON → resposta_malformada", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 200, jsonQuebrado: true }] });
    expect((await falhaDe(t.pedir())).tipo).toBe("resposta_malformada");
  });
  it("o segredo e o token nunca aparecem em erro nem em registro, em nenhum desfecho", async () => {
    const desfechos: Resp[][] = [[{ status: 401 }, { status: 401 }], [{ status: 403 }], [{ status: 429, retryAfter: "99" }], [{ status: 500 }, { status: 500 }], ["rede", "rede"], [{ status: 400 }]];
    for (const api of desfechos) {
      const t = cliente({ [TOKEN_HOST]: [tokenOk(), tokenOk()], [API_HOST]: api });
      const f = await falhaDe(t.pedir());
      semSegredo(f, t.registros);
      for (const r of t.registros) {
        const keys = Object.keys(r).sort();
        if (r.tipoFalha === "requisicao_recusada") {
          expect(keys).toEqual(["duracaoMs", "endpoint", "erroProvedor", "status", "tentativa", "tipoFalha"]);
        } else {
          expect(keys).toEqual(["duracaoMs", "endpoint", "status", "tentativa", "tipoFalha"]);
        }
      }
    }
  });
});

describe("HOTFIX-SAT-RUNTIME-01 — sanitizarErroProvedor", () => {
  it("extrai code/message/parameter e redige geometry, Authorization e textos proibidos", () => {
    const geo = { type: "Polygon", coordinates: [[[1, 2], [3, 4], [1, 2]]] };
    const r = sanitizarErroProvedor(400, {
      error: {
        code: "COMMON_BAD_PAYLOAD",
        message: `Invalid field; Authorization: Bearer ${TOKEN}; secret=${SEGREDO}`,
        errors: [{ parameter: "input.bounds.geometry", path: "/input/bounds/geometry" }]
      },
      geometry: geo,
      request: { input: { bounds: { geometry: geo } } }
    }, [SEGREDO, TOKEN, CLIENTE_ID]);
    expect(r).toEqual({
      status: 400,
      code: "COMMON_BAD_PAYLOAD",
      message: "[redacted]",
      parameter: "input.bounds.geometry",
      detailMessage: null,
      detailReason: null
    });
    semSegredo(r);
  });
  it("corta mensagem longa e ignora corpo que não é objeto", () => {
    const longa = "x".repeat(LIMITE_TEXTO_ERRO_PROVEDOR + 40);
    expect(sanitizarErroProvedor(400, { message: longa }).message?.length).toBe(LIMITE_TEXTO_ERRO_PROVEDOR + 1); // + reticências
    expect(sanitizarErroProvedor(400, null)).toEqual({ status: 400, code: null, message: null, parameter: null, detailMessage: null, detailReason: null });
    expect(sanitizarErroProvedor(400, "texto")).toEqual({ status: 400, code: null, message: null, parameter: null, detailMessage: null, detailReason: null });
  });
  it("aceita Buffer JSON (Process API 4xx lida como binário)", async () => {
    const buf = Buffer.from(JSON.stringify({ error: { code: "BAD", message: "nope", errors: [{ path: "outputs.ndvi" }] } }));
    expect(sanitizarErroProvedor(400, buf)).toEqual({ status: 400, code: "BAD", message: "nope", parameter: "outputs.ndvi", detailMessage: null, detailReason: null });
  });
  it("HIST-EVI2-1: fixture do 400 real — code/parameter + errors[0] message/reason sanitizados", () => {
    const r = sanitizarErroProvedor(400, {
      error: {
        status: 400,
        reason: "Bad Request",
        message: "Invalid request",
        code: "COMMON_BAD_PAYLOAD",
        errors: [{
          parameter: "calculationsMap[evi2]->histograms[default]-><map value>",
          message: "histogram math does not match sampleType",
          reason: "COMMON_BAD_PAYLOAD"
        }]
      }
    });
    expect(r).toEqual({
      status: 400,
      code: "COMMON_BAD_PAYLOAD",
      message: "Invalid request",
      parameter: "calculationsMap[evi2]->histograms[default]-><map value>",
      detailMessage: "histogram math does not match sampleType",
      detailReason: "COMMON_BAD_PAYLOAD"
    });
    expect(camposLogErroProvedor(r)).toEqual({
      provider_status: 400,
      provider_error_code: "COMMON_BAD_PAYLOAD",
      provider_error_message_sanitized: "Invalid request",
      provider_parameter: "calculationsMap[evi2]->histograms[default]-><map value>",
      provider_detail_message_sanitized: "histogram math does not match sampleType",
      provider_detail_reason_sanitized: "COMMON_BAD_PAYLOAD"
    });
    semSegredo(r, camposLogErroProvedor(r));
  });
});

// ---------------- método NDVI ----------------

type Pixel = { B04: number; B08: number; SCL: number; dataMask: number };
const script = new Function(`${EVALSCRIPT_NDVI}\nreturn { setup: setup, evaluatePixel: evaluatePixel };`)() as {
  setup: () => { input: { bands: string[] }[]; output: { id: string; bands: number; sampleType?: string }[] };
  evaluatePixel: (s: Pixel) => { ndvi: number[]; dataMask: number[] };
};

describe("SAT-01 evalscript — NDVI B04/B08 e a máscara SCL/dataMask (executado de verdade)", () => {
  it("V3, entrada B04/B08/SCL/dataMask, saída ndvi FLOAT32 + dataMask", () => {
    expect(EVALSCRIPT_NDVI.startsWith("//VERSION=3")).toBe(true);
    expect(script.setup()).toEqual({
      input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
      output: [{ id: "ndvi", bands: 1, sampleType: "FLOAT32" }, { id: "dataMask", bands: 1 }]
    });
  });
  it("NDVI = (B08 − B04) / (B08 + B04) no pixel válido", () => {
    const r = script.evaluatePixel({ B04: 0.05, B08: 0.45, SCL: 4, dataMask: 1 });
    expect(r.dataMask).toEqual([1]);
    expect(r.ndvi[0]).toBeCloseTo(0.8, 10);
  });
  it("as classes EXCLUÍDAS do domínio saem por dataMask = 0 (não viram NDVI zero na média)", () => {
    for (const [classe] of CLASSES_SCL_EXCLUIDAS) {
      expect(script.evaluatePixel({ B04: 0.05, B08: 0.45, SCL: classe, dataMask: 1 }).dataMask, `SCL ${classe}`).toEqual([0]);
    }
  });
  it("as classes MANTIDAS (2 sombra topográfica, 4 vegetação, 5 solo exposto, 7 não classificado) entram", () => {
    for (const classe of [2, 4, 5, 7]) {
      expect(script.evaluatePixel({ B04: 0.2, B08: 0.25, SCL: classe, dataMask: 1 }).dataMask, `SCL ${classe}`).toEqual([1]);
    }
  });
  it("sem dado do satélite, reflectância negativa ou soma zero: fora da estatística", () => {
    expect(script.evaluatePixel({ B04: 0.05, B08: 0.45, SCL: 4, dataMask: 0 }).dataMask).toEqual([0]);
    expect(script.evaluatePixel({ B04: -0.01, B08: 0.45, SCL: 4, dataMask: 1 }).dataMask).toEqual([0]);
    expect(script.evaluatePixel({ B04: 0, B08: 0, SCL: 4, dataMask: 1 }).dataMask).toEqual([0]);
  });
  it("a lista de classes do script É a do domínio (interpolada, não redigitada)", () => {
    const m = /var SCL_EXCLUIDAS = \[([^\]]*)\]/.exec(EVALSCRIPT_NDVI);
    expect(m![1]!.split(",").map((s) => Number(s.trim()))).toEqual(CLASSES_SCL_EXCLUIDAS.map(([c]) => c));
  });
});

const JANELA = janelaPadrao(Date.parse("2026-10-03T15:30:00Z"));
const dia = (d: string) => ({ from: `2026-${d}T00:00:00Z`, to: new Date(Date.parse(`2026-${d}T00:00:00Z`) + 86_400_000).toISOString().replace(".000Z", "Z") });
const intervalo = (d: string, stats: Record<string, unknown>) => ({ interval: dia(d), outputs: { ndvi: { bands: { B0: { stats } } } } });
const stats = (amostra: number, semDado: number, media = 0.72, minimo = 0.31, maximo = 0.88, desvio = 0.09) =>
  ({ min: minimo, max: maximo, mean: media, stDev: desvio, sampleCount: amostra, noDataCount: semDado });
const nuvem = (amostra: number) => ({ min: "NaN", max: "NaN", mean: "NaN", stDev: "NaN", sampleCount: amostra, noDataCount: amostra });

describe("SAT-01 janela e corpo da Statistical API", () => {
  it(`janela = últimos ${JANELA_PADRAO_DIAS} dias UTC inteiros, hoje incluído`, () => {
    expect(JANELA.fim.toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(JANELA.inicio.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    // A mesma janela o dia inteiro (é a chave de reaproveitamento).
    expect(janelaPadrao(Date.parse("2026-10-03T00:00:00Z"))).toEqual(janelaPadrao(Date.parse("2026-10-03T23:59:59.999Z")));
  });
  it("usa a GEOMETRIA (não o retângulo) em CRS84, Sentinel-2 L2A, intervalos de 1 dia e a grade em graus", () => {
    const poligono = lerPoligono({ type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]], extra: "x" })!;
    const corpo = montarCorpoEstatistica(poligono, JANELA, { resx: 0.0001, resy: 0.00009 });
    expect(corpo).toEqual({
      input: {
        bounds: { geometry: { type: "Polygon", coordinates: poligono.coordinates }, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
        data: [{ type: "sentinel-2-l2a" }]
      },
      aggregation: {
        timeRange: { from: "2026-09-04T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" },
        aggregationInterval: { of: "P1D" },
        evalscript: EVALSCRIPT_NDVI,
        resx: 0.0001,
        resy: 0.00009
      }
    });
    expect(JSON.stringify(corpo)).not.toContain("extra");
  });
});

describe("SAT-01 leitura da resposta — estrita, nunca número inventado", () => {
  it("lê sampleCount/noDataCount/min/max/mean/stDev; NaN do dia todo mascarado vira nulo", () => {
    const lida = interpretarEstatistica({ status: "OK", data: [intervalo("09-20", stats(1500, 300)), intervalo("09-25", nuvem(1500))] }, JANELA);
    expect(lida.statusProvedor).toBe("OK");
    expect(lida.errosEm).toEqual([]);
    expect(lida.intervalos.map((i) => [i.inicio.toISOString(), i.amostra, i.semDado, i.validos, i.media, i.minimo, i.maximo, i.desvio])).toEqual([
      ["2026-09-20T00:00:00.000Z", 1500, 300, 1200, 0.72, 0.31, 0.88, 0.09],
      ["2026-09-25T00:00:00.000Z", 1500, 1500, 0, null, null, null, null]
    ]);
  });
  it("dia com erro do provedor é contado à parte", () => {
    const lida = interpretarEstatistica({ data: [{ interval: dia("09-21"), error: { type: "EXECUTION_ERROR" } }, intervalo("09-20", stats(10, 0))] }, JANELA);
    expect(lida.errosEm.map((d) => d?.toISOString())).toEqual(["2026-09-21T00:00:00.000Z"]);
    expect(lida.intervalos).toHaveLength(1);
  });
  it("forma fora do contrato → resposta_malformada", () => {
    const casos: unknown[] = [
      null, [], { data: "x" }, { data: [1] },
      { data: [{ interval: { from: "x", to: "y" }, outputs: {} }] },
      { data: [{ interval: dia("09-20"), outputs: { outra: {} } }] },
      { data: [intervalo("09-20", { ...stats(10, 0), sampleCount: -1 })] },
      { data: [intervalo("09-20", { ...stats(10, 11) })] },
      { data: [intervalo("09-20", { ...stats(10, 0), mean: "0.7" })] },
      { data: [intervalo("09-20", { ...stats(10, 0), mean: "NaN" })] }, // há pixel válido e não há média
      { data: [intervalo("08-01", stats(10, 0))] }, // dia FORA da janela pedida
      { status: "token=abc", data: [{ interval: dia("09-20"), outputs: { ndvi: { bands: {} } } }] }
    ];
    for (const corpo of casos) {
      let tipo = "";
      try { interpretarEstatistica(corpo, JANELA); } catch (e) { tipo = (e as FalhaCopernicus).tipo; }
      expect(tipo, JSON.stringify(corpo)).toBe("resposta_malformada");
    }
  });
  it("status do provedor fora do formato não é gravado", () => {
    expect(interpretarEstatistica({ status: "ok; token=abc", data: [] }, JANELA).statusProvedor).toBeNull();
  });
});

const lida = (intervalos: Record<string, unknown>[], erros: (string | null)[] = []): EstatisticaLida =>
  interpretarEstatistica({ status: "OK", data: [...intervalos, ...erros.map((d) => (d ? { interval: dia(d), error: { type: "EXECUTION_ERROR" } } : { error: {} }))] }, JANELA);

describe(`SAT-01 escolha da observação — a útil MAIS RECENTE (cobertura ≥ ${CRITERIO_OBSERVACAO_UTIL.coberturaMinima}, ≥ ${CRITERIO_OBSERVACAO_UTIL.pixelsValidosMinimos} pixels válidos)`, () => {
  const PIXELS_POLIGONO = 1000;
  it("a última imagem coberta de nuvem NÃO é usada: vale a útil anterior a ela", () => {
    const r = escolherObservacao(lida([intervalo("09-10", stats(1400, 500, 0.5)), intervalo("09-20", stats(1400, 450)), intervalo("09-30", stats(1400, 1300))]), PIXELS_POLIGONO);
    expect(r.situacao).toBe("concluida");
    if (r.situacao !== "concluida") return;
    expect(r.observacao.inicio.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(r.observacao.fim.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(r.valores).toEqual({ medio: "0.7200", minimo: "0.3100", maximo: "0.8800", desvio: "0.0900" });
    expect(r.pixels).toEqual({ amostra: 1400, semDado: 450, validos: 950, geometria: PIXELS_POLIGONO });
    expect(r.cobertura).toBe("0.9500");
    expect(r.metadados).toEqual({ intervalos_recebidos: 3, intervalos_com_erro: 0, intervalos_com_dado: 3, intervalos_uteis: 2, maior_cobertura: "0.9500", fonte_pixels_geometria: "grade_crs84", status_provedor: "OK" });
  });
  it("arredonda para 4 casas; cobertura arredonda PARA BAIXO e satura em 1", () => {
    const r = escolherObservacao(lida([intervalo("09-20", stats(2000, 0, 0.123456, -0.2, 0.999999, 0.0123449))]), PIXELS_POLIGONO);
    expect(r.situacao === "concluida" && [r.valores, r.cobertura]).toEqual([{ medio: "0.1235", minimo: "-0.2000", maximo: "1.0000", desvio: "0.0123" }, "1.0000"]);
    const limite = escolherObservacao(lida([intervalo("09-20", stats(1000, 400))]), PIXELS_POLIGONO); // 600/1000 = 0,6 exato
    expect(limite.situacao === "concluida" && limite.cobertura).toBe("0.6000");
    const abaixo = escolherObservacao(lida([intervalo("09-20", stats(1000, 401))]), PIXELS_POLIGONO); // 0,599 < 0,6
    expect(abaixo.situacao).toBe("sem_observacao_util");
  });
  it("sem nenhuma imagem na janela → sem_observacao_util / sem_aquisicao, sem número", () => {
    const r = escolherObservacao(lida([]), PIXELS_POLIGONO);
    expect(r).toEqual({ situacao: "sem_observacao_util", motivo: "sem_aquisicao", pixelsGeometria: PIXELS_POLIGONO, metadados: expect.objectContaining({ intervalos_recebidos: 0, maior_cobertura: null }) });
  });
  it("imagens existem mas nuvem/pixel inválido em todas → cobertura_insuficiente (zero pixel válido incluído)", () => {
    const r = escolherObservacao(lida([intervalo("09-20", nuvem(1500)), intervalo("09-25", stats(1500, 1100))]), PIXELS_POLIGONO);
    expect(r).toMatchObject({ situacao: "sem_observacao_util", motivo: "cobertura_insuficiente", metadados: { intervalos_com_dado: 1, intervalos_uteis: 0, maior_cobertura: "0.4000" } });
    expect(JSON.stringify(r)).not.toMatch(/"medio"|"valores"/);
  });
  it("menos pixels válidos que o piso absoluto não é observação útil, mesmo com 100% de cobertura", () => {
    const r = escolherObservacao(lida([intervalo("09-20", stats(9, 0))]), 9);
    expect(r).toMatchObject({ situacao: "sem_observacao_util", motivo: "cobertura_insuficiente" });
  });
  it("dia com ERRO mais recente que a escolha (ou qualquer erro sem escolha) → processamento_parcial, nada gravado", () => {
    expect(() => escolherObservacao(lida([intervalo("09-20", stats(1400, 100))], ["09-25"]), PIXELS_POLIGONO)).toThrow(expect.objectContaining({ tipo: "processamento_parcial" }));
    expect(() => escolherObservacao(lida([], ["09-25"]), PIXELS_POLIGONO)).toThrow(expect.objectContaining({ tipo: "processamento_parcial" }));
    expect(() => escolherObservacao(lida([intervalo("09-20", stats(1400, 100))], [null]), PIXELS_POLIGONO)).toThrow(expect.objectContaining({ tipo: "processamento_parcial" }));
    // Erro ANTERIOR à observação útil escolhida não muda a escolha.
    const r = escolherObservacao(lida([intervalo("09-20", stats(1400, 100))], ["09-15"]), PIXELS_POLIGONO);
    expect(r).toMatchObject({ situacao: "concluida", metadados: { intervalos_com_erro: 1, intervalos_recebidos: 2 } });
  });
  it("valor fora de [-1, 1] ou estatística incoerente → resposta_malformada", () => {
    for (const s of [stats(1400, 100, 0.5, 0.1, 1.2), stats(1400, 100, 0.5, -1.5, 0.9), stats(1400, 100, 0.95, 0.1, 0.9), stats(1400, 100, 0.5, 0.1, 0.9, -0.1)]) {
      expect(() => escolherObservacao(lida([intervalo("09-20", s)]), PIXELS_POLIGONO), JSON.stringify(s)).toThrow(expect.objectContaining({ tipo: "resposta_malformada" }));
    }
  });
});

// ---------------- geometria ----------------

const QUADRADO_1KM_EQUADOR: PoligonoGeoJson = (() => {
  const d = 1000 / metrosPorGrau(0).lon; const e = 1000 / metrosPorGrau(0).lat;
  return { type: "Polygon", coordinates: [[[0, 0], [d, 0], [d, e], [0, e], [0, 0]]] };
})();

describe("SAT-01 geometria — polígono do banco e grade de 10 m em CRS84", () => {
  it("lerPoligono aceita o Polygon canônico e devolve SÓ type/coordinates", () => {
    expect(lerPoligono({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]], crs: "x", properties: { a: 1 } })).toEqual({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
  });
  it("lerPoligono recusa o que não é Polygon canônico", () => {
    const ruins: unknown[] = [
      null, "x", [], { type: "MultiPolygon", coordinates: [] }, { type: "Polygon" }, { type: "Polygon", coordinates: [] },
      { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] },              // menos de 4 posições
      { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },      // anel aberto
      { type: "Polygon", coordinates: [[[0, 0], [181, 0], [1, 1], [0, 0]]] },    // longitude fora
      { type: "Polygon", coordinates: [[[0, 0], [1, 91], [1, 1], [0, 0]]] },     // latitude fora
      { type: "Polygon", coordinates: [[[0, 0], [1, 0, 5], [1, 1], [0, 0]]] },   // 3 coordenadas
      { type: "Polygon", coordinates: [[[0, 0], ["1", 0], [1, 1], [0, 0]]] }     // texto
    ];
    for (const r of ruins) expect(lerPoligono(r), JSON.stringify(r)).toBeNull();
  });
  it("área na grade CRS84 (graus²) não depende do sentido de giro nem da posição absoluta", () => {
    const quadrado: PoligonoGeoJson = { type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] };
    expect(areaEmGraus(quadrado)).toBeCloseTo(0.0001, 12);
    const invertido: PoligonoGeoJson = { type: "Polygon", coordinates: [[...quadrado.coordinates[0]!].reverse()] };
    expect(areaEmGraus(invertido)).toBeCloseTo(0.0001, 12);
  });
  it("furo é descontado", () => {
    const [ext] = QUADRADO_1KM_EQUADOR.coordinates;
    const [d, e] = [ext![2]![0], ext![2]![1]];
    const furo: [number, number][] = [[d / 4, e / 4], [d / 4, (3 * e) / 4], [(3 * d) / 4, (3 * e) / 4], [(3 * d) / 4, e / 4], [d / 4, e / 4]];
    const comFuro = areaEmGraus({ type: "Polygon", coordinates: [ext!, furo] });
    expect(comFuro / areaEmGraus(QUADRADO_1KM_EQUADOR)).toBeCloseTo(0.75, 9);
    expect(planejarGrade({ type: "Polygon", coordinates: [ext!, furo] }, 10).pixelsGeometria).toBe(7_500);
  });
  it("planejarGrade: 10 m viram graus na latitude da área; 1 km² = ~10.000 pixels de 10 m; caixa de ~100×100 px", () => {
    const g = planejarGrade(QUADRADO_1KM_EQUADOR, 10);
    expect(g.resx * metrosPorGrau(0).lon).toBeCloseTo(10, 6);
    expect(g.resy * metrosPorGrau(0).lat).toBeCloseTo(10, 6);
    expect(g.pixelsGeometria).toBe(10_000);
    expect([g.larguraPx, g.alturaPx]).toEqual([100, 100]);
    // Em -15,6° o grau de longitude encolhe; a grade em graus acompanha (o pixel continua de 10 m). O quadrado de
    // 0,01° tem ≈ 1.072 m (leste-oeste) × 1.106 m (norte-sul) no elipsoide: ≈ 11.860 pixels de 10 m.
    const sul = planejarGrade({ type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] }, 10);
    expect(sul.resx).toBeGreaterThan(g.resx);
    const m = metrosPorGrau(-15.595);
    expect(sul.pixelsGeometria).toBe(Math.round((0.01 * m.lon * 0.01 * m.lat) / 100));
    expect(sul.pixelsGeometria).toBeGreaterThan(11_800);
    expect(sul.pixelsGeometria).toBeLessThan(11_900);
    expect([sul.larguraPx, sul.alturaPx]).toEqual([Math.ceil(0.01 * m.lon / 10), Math.ceil(0.01 * m.lat / 10)]);
  });
});
