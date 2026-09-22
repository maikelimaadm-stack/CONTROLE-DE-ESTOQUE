import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/server.js";
import { loadConfig, type Config } from "../../src/config.js";
import { TEST_URL } from "./setup.js";

/**
 * A POLÍTICA DE CORS, NA APP DE VERDADE (CORS-PREVIEW-01 R1).
 *
 * A suíte unitária prova a REGRA. Esta prova que a regra está LIGADA: app montada por `buildApp`,
 * `@fastify/cors` real, preflight real. É a diferença entre uma função correta e uma função que o
 * servidor efetivamente consulta — e essa distância já existiu aqui, o que é a razão do guardrail
 * estrutural no fim deste arquivo.
 *
 * Não toca o banco: preflight é respondido e encerrado pelo próprio plugin de CORS, e a requisição
 * sem credencial para uma rota autenticada morre em 401 antes de qualquer consulta. O pool nasce e
 * morre sem abrir conexão — por isso esta suíte não semeia nada e não depende de estado.
 */

const SUFIXO = "-contadoprojeto.vercel.app";
const PRODUCAO = "https://producao.example.com";
const PREVIEW_DO_PROJETO = `https://controle-de-esto-git-abc123${SUFIXO}`;
const PREVIEW_DE_OUTRA_CONTA = "https://controle-de-esto-git-abc123-contadoatacante.vercel.app";

/** Ambiente mínimo e EXPLÍCITO: nada herdado do processo, para o veredito não depender da máquina. */
function configuracao(WEB_ORIGIN_PREVIEW_SUFFIX?: string): Config {
  return loadConfig({
    DATABASE_URL: TEST_URL,
    NODE_ENV: "test",
    AUTH_MODE: "local",
    LOCAL_AUTH_SECRET: "test-secret-please",
    WEB_ORIGIN: PRODUCAO,
    ...(WEB_ORIGIN_PREVIEW_SUFFIX === undefined ? {} : { WEB_ORIGIN_PREVIEW_SUFFIX })
  });
}

const abertas: FastifyInstance[] = [];
async function app(config: Config): Promise<FastifyInstance> {
  const a = await buildApp({ config, logger: false });
  abertas.push(a);
  return a;
}
afterAll(async () => { for (const a of abertas) await a.close(); });

/** Preflight como o navegador manda: OPTIONS + `Access-Control-Request-Method`. */
async function preflight(a: FastifyInstance, origin: string) {
  const r = await a.inject({
    method: "OPTIONS",
    url: "/api/auth/login",
    headers: { origin, "access-control-request-method": "POST" }
  });
  return { status: r.statusCode, permitida: r.headers["access-control-allow-origin"], credenciais: r.headers["access-control-allow-credentials"] };
}

describe("CORS na app real · A · a origem da conta do projeto é permitida", () => {
  it("preflight de um preview DESTE projeto recebe o cabeçalho, com credenciais", async () => {
    const a = await app(configuracao(SUFIXO));
    const r = await preflight(a, PREVIEW_DO_PROJETO);
    // Sem este cabeçalho o navegador descarta a resposta antes do código ver — era o "Failed to fetch".
    expect(r.permitida, "o preview do projeto tem de ser ecoado de volta").toBe(PREVIEW_DO_PROJETO);
    expect(r.credenciais, "é a credencial que torna a âncora obrigatória").toBe("true");
  });

  it("a origem exata de produção continua permitida na mesma app", async () => {
    const a = await app(configuracao(SUFIXO));
    expect((await preflight(a, PRODUCAO)).permitida).toBe(PRODUCAO);
  });
});

describe("CORS na app real · B · a origem de outra conta do mesmo provedor é recusada", () => {
  it("preflight de outra conta NÃO recebe o cabeçalho", async () => {
    const a = await app(configuracao(SUFIXO));
    const r = await preflight(a, PREVIEW_DE_OUTRA_CONTA);
    expect(r.permitida, "ausente é o que faz o navegador descartar a resposta").toBeUndefined();
  });

  it("a raiz do provedor e o vizinho de rótulo único também não passam", async () => {
    const a = await app(configuracao(SUFIXO));
    for (const origem of ["https://atacante.vercel.app", "https://qualquercoisa.vercel.app", `https://atacante.com${SUFIXO}`]) {
      expect((await preflight(a, origem)).permitida, origem).toBeUndefined();
    }
  });

  it("numa resposta REAL (não preflight) a origem forjada também sai sem o cabeçalho", async () => {
    // O preflight é metade da história: se a resposta de verdade trouxesse o cabeçalho, o navegador
    // entregaria o corpo assim mesmo em requisição simples.
    const a = await app(configuracao(SUFIXO));
    const boa = await a.inject({ method: "GET", url: "/api/auth/context", headers: { origin: PREVIEW_DO_PROJETO } });
    const ma = await a.inject({ method: "GET", url: "/api/auth/context", headers: { origin: PREVIEW_DE_OUTRA_CONTA } });
    expect(boa.statusCode, "sem token, 401 — e sem tocar o banco").toBe(401);
    expect(boa.headers["access-control-allow-origin"]).toBe(PREVIEW_DO_PROJETO);
    expect(ma.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sem sufixo configurado, NENHUM preview passa — e produção continua passando", async () => {
    const a = await app(configuracao());
    expect((await preflight(a, PREVIEW_DO_PROJETO)).permitida, "fail-closed").toBeUndefined();
    expect((await preflight(a, PRODUCAO)).permitida).toBe(PRODUCAO);
  });
});

describe("CORS na app real · C · configuração genérica derruba o startup", () => {
  it("`loadConfig` recusa a raiz do provedor — o processo não chega a existir", () => {
    expect(() => configuracao(".vercel.app")).toThrow(/WEB_ORIGIN_PREVIEW_SUFFIX inválido/);
    for (const mau of ["vercel.app", "-vercel.app", "*.vercel.app", "https://-conta.vercel.app", "-conta.vercel.app:443", "-minha.conta.vercel.app"]) {
      expect(() => configuracao(mau), mau).toThrow(/WEB_ORIGIN_PREVIEW_SUFFIX inválido/);
    }
  });

  it("`buildApp` recusa a mesma configuração — inclusive montada à mão, sem passar por `loadConfig`", async () => {
    // Este é o caminho que a validação só no `loadConfig` deixaria aberto: um `Config` construído
    // diretamente (como fazem os testes, e como faria qualquer embrulho novo) subia a app inteira.
    const maquiado: Config = { ...configuracao(SUFIXO), WEB_ORIGIN_PREVIEW_SUFFIX: ".vercel.app" };
    await expect(buildApp({ config: maquiado, logger: false })).rejects.toThrow(/WEB_ORIGIN_PREVIEW_SUFFIX inválido/);
    // Não devolveu app: não existe objeto para injetar requisição nenhuma. É esse o "antes de servir".
    await expect(buildApp({ config: maquiado, logger: false })).rejects.toThrow(/-minhaconta\.vercel\.app/);
  });

  it("a recusa acontece ANTES de existir servidor e ANTES de existir pool — verificável na ordem do código", () => {
    // "Falha cedo" é uma afirmação sobre ORDEM, e ordem se confere lendo o arquivo. Sem isto, a
    // recusa poderia migrar para depois do `listen` numa refatoração e nenhum teste notaria.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "../../src/server.ts"), "utf8");
    const corpo = src.slice(src.indexOf("export async function buildApp"));
    const politica = corpo.indexOf("politicaDeOrigem(");
    const fastify = corpo.indexOf("Fastify({");
    const pool = corpo.indexOf("createPool(");
    expect(politica, "a política tem de ser montada dentro de buildApp").toBeGreaterThan(-1);
    expect(politica, "a validação vem antes de instanciar o servidor").toBeLessThan(fastify);
    expect(politica, "a validação vem antes de abrir o pool").toBeLessThan(pool);
  });
});
