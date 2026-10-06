import { describe, it, expect } from "vitest";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import {
  ClienteCopernicus, ENDERECOS_COPERNICUS, ESPERA_ENTRE_TENTATIVAS_MS, FalhaCopernicus, TAMANHO_MAXIMO_PNG_PROCESSO_BYTES, type RegistroChamada
} from "../../src/lib/satelite/copernicus.js";
import { enviarPost, leitorCorpoBinario } from "../../src/lib/satelite/http.js";
import { escreverPngCinza8 } from "../../src/lib/satelite/png.js";

/**
 * SAT-06 (decisão 297) — `processoComConsumo` (Process API) sobre HTTP FALSO: a imagem e o PU da resposta 2xx que
 * valeu; o MESMO token e a MESMA política de `estatistica` (429 com Retry-After, 5xx repetido uma vez, 401 renova o
 * token uma vez, 4xx nunca repete); 2xx vazio/ilegível/não-PNG → `resposta_malformada` COM `puCabecalho` definido; nada
 * de segredo em resultado, erro ou registro. Os testes da SAT-01/SAT-03 do cliente continuam como estão.
 */

const SEGREDO = "segredo-sat06-NAO-PODE-VAZAR";
const TOKEN = "token-sat06-NAO-PODE-VAZAR";
const TOKEN_HOST = ENDERECOS_COPERNICUS.token.host;
const API_HOST = ENDERECOS_COPERNICUS.processo.host;
const PNG = escreverPngCinza8(4, 3, [0, 1, 2, 3, 250, 251, 252, 253, 7, 8, 9, 10]);

type Resp = { status: number; json?: unknown; binario?: Buffer; semArrayBuffer?: boolean; pu?: string; retryAfter?: string } | "rede";
interface Chamada { url: string; method: string | undefined; body: string | undefined; headers: Record<string, string> }

/** HTTP falso: fila de respostas por host; corpo binário por `arrayBuffer()` (ou ausente, quando a resposta o diz). */
function falso(rotas: Record<string, Resp[]>) {
  const chamadas: Chamada[] = [];
  const buscar: BuscarFn = async (url, init) => {
    chamadas.push({ url, method: init.method, body: init.body, headers: init.headers });
    const r = rotas[new URL(url).host]?.shift();
    if (!r) throw new Error(`rota sem resposta falsa: ${url}`);
    if (r === "rede") throw new TypeError("fetch failed");
    const bin = r.binario ?? Buffer.from(JSON.stringify(r.json ?? null));
    return {
      status: r.status,
      headers: { get: (n: string) => (n === "x-processingunits-spent" ? r.pu ?? null : n === "retry-after" ? r.retryAfter ?? null : null) },
      json: async () => { if (r.binario) throw new SyntaxError("não é JSON"); return r.json ?? null; },
      ...(r.semArrayBuffer ? {} : { arrayBuffer: async () => { const ab = new ArrayBuffer(bin.length); new Uint8Array(ab).set(bin); return ab; } })
    };
  };
  return { buscar, chamadas };
}

const tokenOk = (valor = TOKEN): Resp => ({ status: 200, json: { access_token: valor, expires_in: 600 }, pu: "99" });
const imagem = (pu?: string): Resp => ({ status: 200, binario: PNG, ...(pu === undefined ? {} : { pu }) });
const estat: Resp = { status: 200, json: { data: [], status: "OK" } };

function cliente(rotas: Record<string, Resp[]>) {
  const f = falso(rotas);
  const esperas: number[] = [];
  const registros: RegistroChamada[] = [];
  const c = new ClienteCopernicus({ buscar: f.buscar, credenciais: { clienteId: "cliente-sat06", segredo: SEGREDO }, esperar: async (ms) => { esperas.push(ms); } });
  const pedir = () => c.processoComConsumo({ pedido: "imagem" }, (r) => registros.push(r));
  return { c, f, esperas, registros, pedir, naApi: () => f.chamadas.filter((x) => x.url.includes(API_HOST)) };
}
async function falhaDe(p: Promise<unknown>): Promise<FalhaCopernicus> {
  try { await p; } catch (e) { if (e instanceof FalhaCopernicus) return e; throw e; }
  throw new Error("esperava FalhaCopernicus");
}
function semSegredo(...coisas: unknown[]) {
  for (const c of coisas) {
    const t = c instanceof Error ? `${c.name} ${c.message} ${c.stack ?? ""} ${JSON.stringify(c)}` : JSON.stringify(c);
    expect(t).not.toContain(SEGREDO);
    expect(t).not.toContain(TOKEN);
    expect(t).not.toMatch(/Bearer/i);
  }
}

describe("SAT-06 processoComConsumo — a imagem e o PU", () => {
  it("POST na Process API com Bearer, JSON e Accept image/png; devolve o PNG (bytes iguais) e o PU bruto", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [imagem("0.0417")] });
    const r = await t.pedir();
    expect(Buffer.isBuffer(r.png)).toBe(true);
    expect(r.png.equals(PNG)).toBe(true);
    expect(r.puCabecalho).toBe("0.0417");
    expect(Object.keys(r).sort()).toEqual(["png", "puCabecalho"]);
    const api = t.naApi()[0]!;
    expect(api.url).toBe("https://sh.dataspace.copernicus.eu/api/v1/process");
    expect(api.method).toBe("POST");
    expect(api.headers).toEqual({ accept: "image/png", authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });
    expect(JSON.parse(api.body!)).toEqual({ pedido: "imagem" });
    expect(t.registros.map((x) => [x.endpoint, x.status, x.tipoFalha])).toEqual([["token", 200, null], ["processo", 200, null]]);
    semSegredo({ ...r, png: r.png.toString("base64") }, t.registros);
  });
  it("cabeçalho ausente → puCabecalho null (e não o do pedido de token)", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [imagem()] });
    expect((await t.pedir()).puCabecalho).toBeNull();
  });
  it("o MESMO token serve a estatística e a imagem (uma emissão só)", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [ENDERECOS_COPERNICUS.estatistica.host]: [estat, imagem("1")] });
    expect(ENDERECOS_COPERNICUS.estatistica.host).toBe(API_HOST);
    await t.c.estatistica({});
    await t.pedir();
    expect(t.f.chamadas.filter((x) => x.url.includes(TOKEN_HOST))).toHaveLength(1);
    expect(t.naApi().map((x) => new URL(x.url).pathname)).toEqual(["/statistics/v1", "/api/v1/process"]);
    expect(t.naApi().map((x) => x.headers["authorization"])).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
  });
});

describe("SAT-06 processoComConsumo — a mesma política de tentativas da estatística", () => {
  it("429 com Retry-After curto: espera o pedido e tenta de novo; vale o PU da tentativa que deu certo", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 429, retryAfter: "2", pu: "9" }, imagem("0.2")] });
    const r = await t.pedir();
    expect([r.png.equals(PNG), r.puCabecalho]).toEqual([true, "0.2"]);
    expect(t.esperas).toEqual([2000]);
  });
  it("429 com Retry-After longo ou ausente: devolve o limite com a espera, sem repetir", async () => {
    const longo = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 429, retryAfter: "60" }] });
    const f = await falhaDe(longo.pedir());
    expect([f.tipo, f.status, f.tentarAposSegundos, f.puCabecalho]).toEqual(["limite", 429, 60, undefined]);
    expect(longo.naApi()).toHaveLength(1);
    const sem = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 429 }] });
    expect((await falhaDe(sem.pedir())).tentarAposSegundos).toBeNull();
  });
  it("5xx repete UMA vez; persistente → indisponivel (2 chamadas)", async () => {
    const volta = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 503 }, imagem()] });
    expect((await volta.pedir()).png.equals(PNG)).toBe(true);
    expect(volta.esperas).toEqual([ESPERA_ENTRE_TENTATIVAS_MS]);
    const fora = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 500 }, { status: 502 }] });
    const f = await falhaDe(fora.pedir());
    expect([f.tipo, f.status]).toEqual(["indisponivel", 502]);
    expect(fora.registros.filter((x) => x.endpoint === "processo").map((x) => [x.status, x.tentativa])).toEqual([[500, 1], [502, 2]]);
  });
  it("401: descarta o token, emite outro e tenta UMA vez; 401 persistente → autenticacao", async () => {
    const volta = cliente({ [TOKEN_HOST]: [tokenOk("velho"), tokenOk("novo")], [API_HOST]: [{ status: 401 }, imagem()] });
    await volta.pedir();
    expect(volta.naApi().map((x) => x.headers["authorization"])).toEqual(["Bearer velho", "Bearer novo"]);
    const fora = cliente({ [TOKEN_HOST]: [tokenOk(), tokenOk()], [API_HOST]: [{ status: 401 }, { status: 401 }] });
    expect((await falhaDe(fora.pedir())).tipo).toBe("autenticacao");
    expect(fora.f.chamadas).toHaveLength(4);
  });
  it("400/404/422 → requisicao_recusada e 403 → acesso_negado, NUNCA repetem; rede repete uma vez", async () => {
    for (const status of [400, 404, 422]) {
      const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status, json: { error: { code: "BAD", message: `detalhe ${SEGREDO}`, errors: [{ parameter: "evalscript" }] } } }] });
      const f = await falhaDe(t.pedir());
      expect([f.tipo, f.status]).toEqual(["requisicao_recusada", status]);
      expect(t.naApi()).toHaveLength(1);
      expect(f.erroProvedor).toEqual({ status, code: "BAD", message: "detalhe [redacted]", parameter: "evalscript" });
      semSegredo(f, t.registros);
    }
    const negado = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 403 }] });
    expect((await falhaDe(negado.pedir())).tipo).toBe("acesso_negado");
    expect(negado.naApi()).toHaveLength(1);
    const rede = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: ["rede", imagem()] });
    expect((await rede.pedir()).png.equals(PNG)).toBe(true);
    const redeFora = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: ["rede", "rede"] });
    const f = await falhaDe(redeFora.pedir());
    expect([f.tipo, f.puCabecalho]).toEqual(["rede", undefined]);
  });
});

describe("SAT-06 processoComConsumo — 2xx que não é a imagem: cobrada, resposta_malformada COM puCabecalho", () => {
  const casos: [string, Resp][] = [
    ["corpo vazio", { status: 200, binario: Buffer.alloc(0) }],
    ["JSON no lugar do PNG", { status: 200, binario: Buffer.from('{"ok":true}') }],
    ["resposta sem arrayBuffer", { status: 200, binario: PNG, semArrayBuffer: true }],
    ["corpo acima do teto de 16 MiB", { status: 200, binario: Buffer.concat([PNG, Buffer.alloc(TAMANHO_MAXIMO_PNG_PROCESSO_BYTES)]) }]
  ];
  for (const [nome, resp] of casos) {
    it(`${nome}: com o cabeçalho → o PU bruto; sem ele → null (definido); só uma chamada`, async () => {
      const com = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ ...(resp as object), pu: "0.3" } as Resp] });
      const f = await falhaDe(com.pedir());
      expect([f.tipo, f.status, f.puCabecalho]).toEqual(["resposta_malformada", 200, "0.3"]);
      expect(com.naApi()).toHaveLength(1);
      semSegredo(f, com.registros);
      const sem = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [resp] });
      const g = await falhaDe(sem.pedir());
      expect(g.puCabecalho).toBeNull();
      expect(g.puCabecalho !== undefined).toBe(true);
    });
  }
  it("falha sem 2xx nunca carrega puCabecalho (o provedor não cobrou)", async () => {
    for (const api of [[{ status: 500, pu: "1" }, { status: 500, pu: "1" }], [{ status: 400, pu: "1" }], [{ status: 403, pu: "1" }]] as Resp[][]) {
      const f = await falhaDe(cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: api }).pedir());
      expect(f.puCabecalho, f.tipo).toBeUndefined();
    }
  });
  it("leitorCorpoBinario na porta HTTP: 2xx ilegível → falha `corpo` com o PU; 4xx ilegível → ok com corpo nulo", async () => {
    const ler = leitorCorpoBinario(1024);
    const vazio = await enviarPost(falso({ "e.test": [{ status: 200, binario: Buffer.alloc(0), pu: "0.1" }] }).buscar, "e.test", "/", "", {}, 1000, Date.now, ler);
    expect(vazio).toStrictEqual({ tipo: "falha", motivo: "corpo", status: 200, processingUnits: "0.1" });
    const quatro = await enviarPost(falso({ "e.test": [{ status: 400, semArrayBuffer: true }] }).buscar, "e.test", "/", "", {}, 1000, Date.now, ler);
    expect(quatro).toMatchObject({ tipo: "ok", status: 400, corpo: null });
    const ok = await enviarPost(falso({ "e.test": [{ status: 200, binario: PNG }] }).buscar, "e.test", "/", "", {}, 1000, Date.now, ler);
    expect(ok.tipo === "ok" && Buffer.isBuffer(ok.corpo) && ok.corpo.equals(PNG)).toBe(true);
  });
});

describe("SAT-06 nada de segredo em nenhum desfecho da Process API", () => {
  it("erro e registro nunca carregam o segredo, o token nem 'Bearer'; 4xx traz erroProvedor sanitizado", async () => {
    const desfechos: Resp[][] = [[{ status: 401 }, { status: 401 }], [{ status: 403 }], [{ status: 429, retryAfter: "99" }], [{ status: 500 }, { status: 500 }], ["rede", "rede"], [{ status: 400 }], [{ status: 200, binario: Buffer.from("x") }]];
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
  it("sem credencial: configuracao, nenhuma chamada", async () => {
    const f = falso({});
    const c = new ClienteCopernicus({ buscar: f.buscar, credenciais: null });
    expect((await falhaDe(c.processoComConsumo({}))).tipo).toBe("configuracao");
    expect(f.chamadas).toHaveLength(0);
  });
});
