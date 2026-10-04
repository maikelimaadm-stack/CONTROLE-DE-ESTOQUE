import { describe, it, expect } from "vitest";
import { MARCADOR_TOKEN_OMITIDO, VALIDADE_URL_RASTER_S, criarAssinadorUrlRaster, redigirUrlAssinada } from "../../src/lib/satelite/url-assinada.js";

/**
 * SAT-06 (decisão 297) — a URL assinada do arquivo do raster, sem banco: o token (HMAC com chave derivada do segredo de
 * autenticação, validade, raster da rota) e a redação do token no log. A rota inteira (RLS, escopo, 404) está nos testes
 * de integração (`sat-06-rasters-satelitais.test.ts`).
 */

const RASTER = "7130f9e0-22d6-4078-ac11-5721202a9d4f";
const OUTRO_RASTER = "00000000-0000-4000-8000-000000000000";
const ORG = "803dbdcc-e7b9-4368-8f80-39f559685cfc";
const USUARIO = "11111111-2222-4333-8444-555555555555";
const CONFIG = { AUTH_MODE: "local" as const, LOCAL_AUTH_SECRET: "segredo-de-teste-unitario", SUPABASE_JWT_SECRET: undefined };
const TOKEN = "AXEw-eAi1kB4rBFXISAqnU-p8AgWrMRMDoEOz30JGL7CTiUc4KSvSZ-0cClMl2BsNgAAAABqwoer7j8UiA8bXKz-rj_p3vUidiudbTnE0NTutIJT_VBKaBg";

describe("SAT-06 redigirUrlAssinada — o token nunca vai para o log", () => {
  const omitida = (caminho: string) => `${caminho}?${MARCADOR_TOKEN_OMITIDO}`;

  it("a rota do arquivo: a query inteira vira o marcador", () => {
    expect(redigirUrlAssinada(`/api/mapa/rasters/${RASTER}/arquivo?t=${TOKEN}`)).toBe(omitida(`/api/mapa/rasters/${RASTER}/arquivo`));
    expect(redigirUrlAssinada(`/api/mapa/rasters/${RASTER}/arquivo/?x=1&t=${TOKEN}`)).toBe(omitida(`/api/mapa/rasters/${RASTER}/arquivo/`));
  });

  it("caminho CODIFICADO que o roteador decodifica (`%72asters`, `%2F`, maiúsculas, codificação dupla): também redigido", () => {
    for (const caminho of [
      `/api/mapa/%72asters/${RASTER}/arquivo`, `/api/mapa/%52ASTERS/${RASTER}/arquivo`, `/api/mapa%2Frasters%2F${RASTER}/arquivo`,
      `/api/mapa/%2572asters/${RASTER}/arquivo`, `/api/mapa/%25%37%32asters/${RASTER}/arquivo`
    ]) {
      const r = redigirUrlAssinada(`${caminho}?t=${TOKEN}`);
      expect(r, caminho).toBe(omitida(caminho));
      expect(r).not.toContain(TOKEN);
    }
  });

  it("codificação INVÁLIDA no caminho: na dúvida, redigida", () => {
    for (const caminho of [`/api/mapa/%E0%A4%A/${RASTER}/arquivo`, `/api/mapa/r%ZZasters/${RASTER}/arquivo`, "/api/%"]) {
      expect(redigirUrlAssinada(`${caminho}?t=${TOKEN}`), caminho).toBe(omitida(caminho));
    }
  });

  it("outras URLs passam como estão (a listagem não tem token; sem query não há o que redigir)", () => {
    for (const url of ["/api/mapa/rasters?area_ids=a,b&pagina=2", "/api/mapa/analises-satelitais/x/raster", "/api/x?t=1", `/api/mapa/rasters/${RASTER}/arquivo`, "/api/caf%C3%A9?q=1"]) {
      expect(redigirUrlAssinada(url), url).toBe(url);
    }
  });
});

describe("SAT-06 criarAssinadorUrlRaster — token opaco, HMAC, validade e raster da rota", () => {
  const assinador = criarAssinadorUrlRaster(CONFIG);
  const agora = 1_800_000_000;

  it("ida e volta: o conteúdo do token válido, vencendo em VALIDADE_URL_RASTER_S", () => {
    const { token, expira } = assinador.assinar({ rasterId: RASTER, organizationId: ORG, userId: USUARIO }, agora);
    expect(expira).toBe(agora + VALIDADE_URL_RASTER_S);
    expect(token).toMatch(/^[A-Za-z0-9_-]{119}$/);
    expect(assinador.verificar(token, RASTER, agora + VALIDADE_URL_RASTER_S - 1)).toEqual({ rasterId: RASTER, organizationId: ORG, userId: USUARIO, expira });
    expect(assinador.verificar(token, RASTER.toUpperCase(), agora)).not.toBeNull();
  });

  it("vencido (no instante exato também), de outro raster, adulterado, outra grafia, outro segredo ou lixo → null", () => {
    const { token } = assinador.assinar({ rasterId: RASTER, organizationId: ORG, userId: USUARIO }, agora);
    expect(assinador.verificar(token, RASTER, agora + VALIDADE_URL_RASTER_S)).toBeNull();
    expect(assinador.verificar(token, OUTRO_RASTER, agora)).toBeNull();
    const meio = 60;
    expect(assinador.verificar(token.slice(0, meio) + (token[meio] === "A" ? "B" : "A") + token.slice(meio + 1), RASTER, agora)).toBeNull();
    // A última letra carrega bits sobrando: outra grafia que decodifica nos mesmos bytes não é aceita.
    const ultima = token[token.length - 1]!;
    const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const vizinha = alfabeto[(alfabeto.indexOf(ultima) ^ 1)]!;
    expect(assinador.verificar(token.slice(0, -1) + vizinha, RASTER, agora)).toBeNull();
    expect(criarAssinadorUrlRaster({ ...CONFIG, LOCAL_AUTH_SECRET: "outro-segredo-qualquer" }).verificar(token, RASTER, agora)).toBeNull();
    for (const lixo of [undefined, null, 1, "", "x".repeat(119), token + "A", token.slice(1), "a.b.c"]) expect(assinador.verificar(lixo, RASTER, agora)).toBeNull();
  });

  it("AUTH_MODE=supabase deriva do SUPABASE_JWT_SECRET (o token local não vale lá); sem segredo, lança na criação", () => {
    const { token } = assinador.assinar({ rasterId: RASTER, organizationId: ORG, userId: USUARIO }, agora);
    const supa = criarAssinadorUrlRaster({ AUTH_MODE: "supabase", SUPABASE_JWT_SECRET: "segredo-do-supabase", LOCAL_AUTH_SECRET: CONFIG.LOCAL_AUTH_SECRET });
    expect(supa.verificar(token, RASTER, agora)).toBeNull();
    expect(supa.verificar(supa.assinar({ rasterId: RASTER, organizationId: ORG, userId: USUARIO }, agora).token, RASTER, agora)).not.toBeNull();
    expect(() => criarAssinadorUrlRaster({ AUTH_MODE: "supabase", SUPABASE_JWT_SECRET: undefined, LOCAL_AUTH_SECRET: "x".repeat(10) })).toThrow(/segredo de autenticação ausente/);
  });

  it("o token não carrega o segredo e não é um JWT; id fora da forma de UUID não é assinado", () => {
    const { token } = assinador.assinar({ rasterId: RASTER, organizationId: ORG, userId: USUARIO }, agora);
    expect(token).not.toContain(".");
    expect(Buffer.from(token, "base64url").toString("latin1")).not.toContain(CONFIG.LOCAL_AUTH_SECRET);
    expect(() => assinador.assinar({ rasterId: "nao-e-uuid", organizationId: ORG, userId: USUARIO }, agora)).toThrow(/forma de UUID/);
  });
});
