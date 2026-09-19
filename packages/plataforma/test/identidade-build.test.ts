import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { identidadeDeBuild } from "../src/identidade-build.js";

/**
 * A IDENTIDADE DO BUILD PRECISA SER HONESTA — inclusive quando não sabe.
 *
 * O valor deste teste não está em provar que `VERCEL_GIT_COMMIT_SHA` vira `sha`: isso é trivial. Está
 * em provar as três formas de MENTIR que a função não pode ter:
 *   1. inventar um provedor quando o ambiente não diz qual é;
 *   2. escolher um SHA quando dois discordam;
 *   3. publicar lixo como se fosse identidade.
 * E, junto com isso, que `unknown` por AUSÊNCIA é distinguível de `unknown` por ERRO — é o campo
 * `origem` que separa "este deploy não veio de gatilho git" de "a leitura falhou".
 *
 * Tudo aqui é puro: o ambiente entra como argumento. Nenhuma rede, nenhum segredo, nenhum
 * `process.env` real — um teste que dependesse do ambiente da máquina passaria no CI e mentiria na
 * Vercel.
 */
const SHA = "120c117ad760dd953a3dcac1a065967bd6ef2f78";
const OUTRO = "6ec4cd2ce6eb75ac431619d8af2615dd9e5e0fd1";

describe("identidade do build", () => {
  it("na Vercel: lê o SHA do provedor, nomeia a origem e o ambiente", () => {
    const r = identidadeDeBuild({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA });
    expect(r).toEqual({ sha: SHA, shaCurto: "120c117", provedor: "vercel", ambiente: "production", origem: "VERCEL_GIT_COMMIT_SHA" });
  });

  it("na Railway: idem, pela variável DELA", () => {
    const r = identidadeDeBuild({ RAILWAY_ENVIRONMENT_ID: "393f41fa", RAILWAY_ENVIRONMENT_NAME: "production", RAILWAY_GIT_COMMIT_SHA: SHA });
    expect(r).toEqual({ sha: SHA, shaCurto: "120c117", provedor: "railway", ambiente: "production", origem: "RAILWAY_GIT_COMMIT_SHA" });
  });

  it("preview da Vercel NÃO se passa por produção", () => {
    // Sem este caso, um deploy de preview responderia com a mesma cara de produção e a verificação
    // de "qual commit está em produção" aceitaria o artefato errado.
    const r = identidadeDeBuild({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: OUTRO });
    expect(r.ambiente).toBe("preview");
    expect(r.provedor).toBe("vercel");
  });

  it("ambiente local: provedor `local`, sha `unknown` e origem `nenhuma` — sem inventar nada", () => {
    const r = identidadeDeBuild({});
    expect(r).toEqual({ sha: "unknown", shaCurto: "unknown", provedor: "local", ambiente: "unknown", origem: "nenhuma" });
  });

  it("provedor presente e SHA ausente: `unknown` por AUSÊNCIA, e a origem diz isso", () => {
    // É o caso do deploy por imagem pronta ou CLI: legítimo, e `unknown` aqui NÃO é sinal de deploy
    // velho. Quem investiga precisa conseguir distinguir isso de uma leitura quebrada.
    const r = identidadeDeBuild({ RAILWAY_SERVICE_ID: "484f8e8d", RAILWAY_ENVIRONMENT_NAME: "production" });
    expect([r.sha, r.origem, r.provedor]).toEqual(["unknown", "nenhuma", "railway"]);
  });

  it("SHA malformado é tratado como AUSENTE, e a origem denuncia o valor inválido", () => {
    const r = identidadeDeBuild({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: "não-é-um-sha" });
    expect(r.sha).toBe("unknown");
    expect(r.origem, "`unknown` silencioso esconderia a variável mal configurada").toContain("inválido");
  });

  it("string vazia é ausência, não valor", () => {
    const r = identidadeDeBuild({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: "   " });
    expect([r.sha, r.origem]).toEqual(["unknown", "nenhuma"]);
  });

  it("FAIL-CLOSED: dois provedores com SHAs DIFERENTES → `ambiguo`, nunca escolher um", () => {
    // Escolher o primeiro seria afirmar pela ordem do código o que o ambiente não disse — o mesmo
    // erro que `.claude/rules/security.md` proíbe em discriminador desconhecido.
    const r = identidadeDeBuild({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: SHA, RAILWAY_GIT_COMMIT_SHA: OUTRO });
    expect(r).toEqual({ sha: "unknown", shaCurto: "unknown", provedor: "ambiguo", ambiente: "unknown", origem: "conflito" });
  });

  it("FAIL-CLOSED: marcadores dos dois provedores ao mesmo tempo → `ambiguo`", () => {
    const r = identidadeDeBuild({ VERCEL: "1", RAILWAY_ENVIRONMENT_ID: "393f41fa", VERCEL_GIT_COMMIT_SHA: SHA, RAILWAY_GIT_COMMIT_SHA: SHA });
    expect(r.provedor).toBe("ambiguo");
    expect(r.sha, "com provedor ambíguo, nem o SHA concordante é publicado").toBe("unknown");
  });

  it("o mesmo SHA nas duas variáveis não é conflito — é redundância", () => {
    // Discriminar conflito de redundância importa: tratar redundância como conflito transformaria um
    // deploy perfeitamente identificado em `unknown`, e a prova de versão morreria por excesso de zelo.
    const r = identidadeDeBuild({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: SHA, RAILWAY_GIT_COMMIT_SHA: SHA });
    expect([r.sha, r.provedor]).toEqual([SHA, "vercel"]);
  });

  it("o SHA nunca é LITERAL no código-fonte — identidade que não vem do ambiente é mentira", () => {
    // Esta é a única asserção não-pura do arquivo, e ela existe porque a falha que ela pega não é
    // observável pela função: alguém "consertando" um `unknown` incômodo pode escrever um SHA fixo,
    // e todos os testes de comportamento continuariam verdes enquanto a identidade passaria a mentir
    // em qualquer deploy. Por isso a regra mora colada ao arquivo que ela protege.
    const fonte = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/identidade-build.ts"), "utf8");
    const literais = fonte.match(/["'`][0-9a-f]{7,64}["'`]/gi) ?? [];
    expect(literais, `SHA literal no fonte da identidade: ${literais.join(", ")}`).toHaveLength(0);
  });

  it("a saída é uma lista FECHADA de campos — nada do ambiente vaza junto", () => {
    // Devolver `process.env` inteiro seria vazar segredo pela porta que existe para provar versão.
    const r = identidadeDeBuild({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: SHA, LOCAL_AUTH_SECRET: "nao-pode-sair", DATABASE_URL: "nao-pode-sair" });
    expect(Object.keys(r).sort()).toEqual(["ambiente", "origem", "provedor", "sha", "shaCurto"]);
    expect(JSON.stringify(r)).not.toContain("nao-pode-sair");
  });
});
