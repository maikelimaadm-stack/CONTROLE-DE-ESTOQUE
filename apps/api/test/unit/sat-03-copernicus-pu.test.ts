import { describe, it, expect } from "vitest";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { enviarPost } from "../../src/lib/satelite/http.js";
import { ClienteCopernicus, ENDERECOS_COPERNICUS, FalhaCopernicus, type RegistroChamada } from "../../src/lib/satelite/copernicus.js";

/**
 * SAT-03 (decisão 296) — o cabeçalho `x-processingunits-spent` exposto pelo cliente do Copernicus, sobre HTTP FALSO.
 * Prova: o PU da resposta 2xx que VALEU sai bruto (presente, ausente, depois de um 5xx repetido, depois de um 401 com
 * token renovado); `estatistica` continua devolvendo só o corpo; nada além do cabeçalho sai — nem segredo, nem token.
 */

const SEGREDO = "segredo-sat03-NAO-PODE-VAZAR";
const TOKEN = "token-sat03-NAO-PODE-VAZAR";
const TOKEN_HOST = ENDERECOS_COPERNICUS.token.host;
const API_HOST = ENDERECOS_COPERNICUS.estatistica.host;

type Resp = { status: number; body?: unknown; pu?: string; retryAfter?: string } | "rede";

/** HTTP falso: fila de respostas por host; o cabeçalho de PU só existe quando a resposta o declara. */
function falso(rotas: Record<string, Resp[]>) {
  const pedidos: string[] = [];
  const buscar: BuscarFn = async (url) => {
    pedidos.push(new URL(url).host);
    const r = rotas[new URL(url).host]?.shift();
    if (!r) throw new Error(`rota sem resposta falsa: ${url}`);
    if (r === "rede") throw new TypeError("fetch failed");
    return {
      status: r.status,
      headers: { get: (n: string) => (n === "x-processingunits-spent" ? r.pu ?? null : n === "retry-after" ? r.retryAfter ?? null : null) },
      json: async () => r.body ?? null
    };
  };
  return { buscar, pedidos };
}

const tokenOk = (valor = TOKEN): Resp => ({ status: 200, body: { access_token: valor, expires_in: 600 }, pu: "99" });
const estat = (pu?: string): Resp => ({ status: 200, body: { data: [], status: "OK" }, ...(pu === undefined ? {} : { pu }) });

function cliente(rotas: Record<string, Resp[]>) {
  const f = falso(rotas);
  const registros: RegistroChamada[] = [];
  const c = new ClienteCopernicus({ buscar: f.buscar, credenciais: { clienteId: "cliente-sat03", segredo: SEGREDO }, esperar: async () => {} });
  return { c, f, registros, registrar: (r: RegistroChamada) => registros.push(r) };
}

function semSegredo(...coisas: unknown[]) {
  for (const c of coisas) {
    const t = c instanceof Error ? `${c.name} ${c.message} ${c.stack ?? ""} ${JSON.stringify(c)}` : JSON.stringify(c);
    expect(t).not.toContain(SEGREDO);
    expect(t).not.toContain(TOKEN);
    expect(t).not.toMatch(/Bearer/i);
  }
}

describe("SAT-03 enviarPost — o cabeçalho de PU, bruto, só quando veio", () => {
  it("presente → `processingUnits` com o valor bruto; ausente → a chave nem existe (o contrato antigo fica igual)", async () => {
    const com = await enviarPost(falso({ "e.test": [{ status: 200, body: { ok: 1 }, pu: "0.0123" }] }).buscar, "e.test", "/", "", {}, 1000);
    expect(com).toEqual({ tipo: "ok", status: 200, corpo: { ok: 1 }, tentarAposSegundos: null, processingUnits: "0.0123" });
    const sem = await enviarPost(falso({ "e.test": [{ status: 200, body: { ok: 1 } }] }).buscar, "e.test", "/", "", {}, 1000);
    expect(sem).toStrictEqual({ tipo: "ok", status: 200, corpo: { ok: 1 }, tentarAposSegundos: null });
    expect(Object.keys(sem)).not.toContain("processingUnits");
  });
  it("o valor sai como veio, sem tradução: quem valida é consumo.ts", async () => {
    const r = await enviarPost(falso({ "e.test": [{ status: 200, body: {}, pu: "1e2" }] }).buscar, "e.test", "/", "", {}, 1000);
    expect(r).toMatchObject({ tipo: "ok", processingUnits: "1e2" });
  });
});

describe("SAT-03 ClienteCopernicus.estatisticaComConsumo — o PU da resposta 2xx que valeu", () => {
  it("cabeçalho presente → corpo e puCabecalho; o PU do pedido de TOKEN nunca é confundido com o da estatística", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [estat("0.5051")] });
    const r = await t.c.estatisticaComConsumo({ x: 1 }, t.registrar);
    expect(r).toStrictEqual({ corpo: { data: [], status: "OK" }, puCabecalho: "0.5051" });
    semSegredo(r, t.registros);
  });
  it("cabeçalho ausente → puCabecalho null (e não o do token, que trazia um)", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [estat()] });
    expect(await t.c.estatisticaComConsumo({})).toStrictEqual({ corpo: { data: [], status: "OK" }, puCabecalho: null });
  });
  it("5xx com PU e depois 2xx: vale o cabeçalho da tentativa que deu certo", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 503, pu: "7" }, estat("0.25")] });
    const r = await t.c.estatisticaComConsumo({}, t.registrar);
    expect(r.puCabecalho).toBe("0.25");
    expect(t.f.pedidos.filter((h) => h === API_HOST)).toHaveLength(2);
    expect(t.registros.filter((x) => x.endpoint === "estatistica").map((x) => [x.status, x.tentativa])).toEqual([[503, 1], [200, 2]]);
  });
  it("5xx com PU e depois 2xx SEM cabeçalho: null — o PU da tentativa que falhou não é herdado", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 502, pu: "7" }, estat()] });
    expect((await t.c.estatisticaComConsumo({})).puCabecalho).toBeNull();
  });
  it("401 e token renovado: o PU é o da segunda resposta (a que valeu)", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk("velho"), tokenOk("novo")], [API_HOST]: [{ status: 401, pu: "3" }, estat("0.1")] });
    expect((await t.c.estatisticaComConsumo({})).puCabecalho).toBe("0.1");
  });
  it("falha persistente: lança FalhaCopernicus como antes, sem PU e sem segredo", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [{ status: 500, pu: "1" }, { status: 500, pu: "1" }] });
    let falha: unknown;
    try { await t.c.estatisticaComConsumo({}, t.registrar); } catch (e) { falha = e; }
    expect(falha).toBeInstanceOf(FalhaCopernicus);
    expect((falha as FalhaCopernicus).tipo).toBe("indisponivel");
    expect(JSON.stringify(falha)).not.toMatch(/processingunits|puCabecalho/i);
    semSegredo(falha, t.registros);
  });
  it("`estatistica` continua devolvendo SÓ o corpo (mesma assinatura, mesmo comportamento)", async () => {
    const t = cliente({ [TOKEN_HOST]: [tokenOk()], [API_HOST]: [estat("0.9")] });
    expect(await t.c.estatistica({})).toStrictEqual({ data: [], status: "OK" });
  });
});
