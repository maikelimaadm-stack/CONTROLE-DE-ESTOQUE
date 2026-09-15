import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error — harness de skew em JS puro, fora do grafo de tipos da API
import { commitAnterior, escolherFonteDaBase, baseDoEventoDePR, garantirWorktree } from "../../../../scripts/api-anterior.mjs";

/**
 * A BASE DO VERSION SKEW TEM DE SE MOVER COM A PR (PRE-BASE2-05C-0).
 *
 * `scripts/api-anterior.mjs` carregava o SHA da base escrito à mão. Enquanto alguém lembrasse de trocá-lo a
 * cada fatia, media o cenário certo; quando ninguém trocou, o job continuou VERDE comparando o HEAD com um
 * commit de várias fatias atrás. Nada falhou — a prova só mudou de assunto, que é o modo de falha mais caro
 * dos três, porque parece certificação.
 *
 * Este guarda fecha as duas metades do problema:
 *   (1) ESTÁTICA — não existe SHA embutido no arquivo, nem como reserva. Um valor de reserva reintroduziria
 *       o defeito com outro nome: em vez de abortar, o script voltaria a certificar o commit errado.
 *   (2) DE COMPORTAMENTO — a base resolvida é um commit REAL deste repositório, diferente do HEAD; e uma
 *       base impossível ABORTA em vez de cair em qualquer outra coisa.
 */
const RAIZ = path.resolve(__dirname, "../../../..");
const ARQUIVO = path.join(RAIZ, "scripts/api-anterior.mjs");
const git = (...a: string[]) => execFileSync("git", a, { cwd: RAIZ }).toString().trim();

const A = "a".repeat(40);
const B = "b".repeat(40);

/**
 * R15 — A BASE DA PR VENCE A PONTA DA BRANCH.
 *
 * O primeiro defeito deste harness foi um SHA digitado. A correção óbvia — resolver `origin/main` — troca
 * um erro por outro mais difícil de ver: `origin/main` é a PONTA DE HOJE, e se outra PR entrar entre a
 * abertura desta e a execução do job, o skew compara com um binário que não é a base desta PR. Continua
 * verde, continua medindo o commit errado.
 *
 * A escolha da fonte é PURA justamente para poder ser provada aqui: uma regra que só pudesse ser exercitada
 * mexendo na `main` de verdade não seria provável em teste nenhum.
 */
describe("R15 · a fonte da base", () => {
  it("o SHA do evento de PR vence GITHUB_BASE_REF (a ponta da branch)", () => {
    const f = escolherFonteDaBase({ env: { GITHUB_BASE_REF: "main" }, baseDoEvento: A }) as { ref: string; origem: string; exigido: boolean };
    expect(f.ref, "A, e não origin/main").toBe(A);
    expect(f.origem).toBe("pull_request.base.sha");
    expect(f.exigido, "e é exigido: não pode cair para a ponta").toBe(true);
  });

  it("SKEW_BASE_COMMIT (o que o workflow injeta) vence o evento e a ponta", () => {
    const f = escolherFonteDaBase({ env: { SKEW_BASE_COMMIT: A, GITHUB_BASE_REF: "main" }, baseDoEvento: B }) as { ref: string };
    expect(f.ref).toBe(A);
  });

  it("`--base=` vence tudo — é o controle explícito da investigação", () => {
    const f = escolherFonteDaBase({ env: { SKEW_BASE_COMMIT: A }, argv: ["--base=" + B], baseDoEvento: A }) as { ref: string };
    expect(f.ref).toBe(B);
  });

  it("variável VAZIA é ausente, não inválida — num push o workflow injeta string vazia", () => {
    const f = escolherFonteDaBase({ env: { SKEW_BASE_COMMIT: "  ", GITHUB_BASE_REF: "main" } }) as { origem: string; exigido: boolean };
    expect(f.origem, "cai para o degrau seguinte em vez de abortar").toBe("GITHUB_BASE_REF=main");
    expect(f.exigido).toBe(true);
  });

  it("fora de PR, a ponta do ramo padrão — e esse degrau NÃO é exigido", () => {
    const f = escolherFonteDaBase({ env: {} }) as { ref: string; exigido: boolean };
    expect(f.ref).toBe("origin/main");
    expect(f.exigido, "só aqui pode haver queda para o primeiro pai do HEAD").toBe(false);
  });

  it("o payload do evento só é lido em pull_request, e payload ilegível não derruba o script", () => {
    expect(baseDoEventoDePR({ GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: "/nao/existe" })).toBeNull();
    expect(baseDoEventoDePR({ GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/nao/existe" })).toBeNull();
    expect(baseDoEventoDePR({ GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/x" }, () => JSON.stringify({ pull_request: { base: { sha: A } } }))).toBe(A);
    expect(baseDoEventoDePR({ GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/x" }, () => "{isto não é json")).toBeNull();
  });
});

/**
 * R16 — ÁRVORE EM CACHE NO COMMIT ERRADO É REFEITA, NÃO REAPROVEITADA.
 *
 * Reaproveitar por EXISTÊNCIA DE ARQUIVO foi o que permitiu, numa versão anterior, que a árvore
 * sobrevivesse a uma troca de base servindo o binário antigo — com todas as asserções verdes. O teste usa um
 * diretório próprio: não toca a `.api-anterior` real e não dispara `pnpm install`.
 */
describe("R16 · a árvore de trabalho", () => {
  const dir = path.join(RAIZ, ".api-anterior-teste-r16");
  const limpar = () => { try { execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: RAIZ, stdio: "ignore" }); } catch { /* já não existe */ } fs.rmSync(dir, { recursive: true, force: true }); };
  beforeAll(limpar);
  afterAll(limpar);

  it("monta na base pedida, reaproveita quando confere e REFAZ quando está em outro commit", () => {
    const base = git("rev-parse", "HEAD");
    const outro = git("rev-parse", "HEAD~1");
    expect(base, "a premissa: os dois commits são diferentes").not.toBe(outro);

    expect(garantirWorktree(outro, dir), "montou do zero").toBe(true);
    expect(git("-C", dir, "rev-parse", "HEAD")).toBe(outro);

    expect(garantirWorktree(outro, dir), "no mesmo commit, reaproveita").toBe(false);

    expect(garantirWorktree(base, dir), "em outro commit, REFAZ").toBe(true);
    expect(git("-C", dir, "rev-parse", "HEAD"), "e termina exatamente na base pedida").toBe(base);
  }, 120_000);
});

describe("base do version skew", () => {
  it("o script não carrega nenhum SHA de commit embutido — nem como reserva", () => {
    // Só o CORPO conta: um SHA citado em comentário é história, não comportamento. O que não pode existir é
    // um literal de 40 hexadecimais que o código possa USAR.
    const corpo = fs.readFileSync(ARQUIVO, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const embutidos = corpo.match(/\b[0-9a-f]{40}\b/g) ?? [];
    expect(embutidos, "SHA embutido é exatamente o defeito que esta fatia remove").toEqual([]);
  });

  it("resolve um commit REAL deste repositório, e nunca o próprio HEAD", () => {
    const { sha, origem, cabeca } = commitAnterior() as { sha: string; origem: string; cabeca: string };
    expect(sha, "40 hexadecimais").toMatch(/^[0-9a-f]{40}$/);
    expect(origem, "a origem da base é declarada, para o log do CI responder 'comparado com o quê?'").toBeTruthy();
    expect(cabeca).toBe(git("rev-parse", "HEAD"));
    // Comparar o HEAD com ele mesmo passaria sempre: é o verde que não prova nada.
    expect(sha, "a base não pode ser o próprio HEAD").not.toBe(cabeca);
    // E o commit existe DE VERDADE — não é uma string com forma de SHA.
    expect(() => git("cat-file", "-e", `${sha}^{commit}`)).not.toThrow();
  });

  it("base impossível ABORTA — não há queda para um padrão", () => {
    const inexistente = "0".repeat(40);
    let saiu = 0;
    let saida = "";
    try {
      execFileSync(process.execPath, ["scripts/api-anterior.mjs", "--dir", `--base=${inexistente}`], { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      saiu = err.status ?? -1;
      saida = err.stderr?.toString() ?? "";
    }
    expect(saiu, "o script falha em vez de comparar com outra coisa").not.toBe(0);
    expect(saida).toMatch(/BASE NÃO RESOLVIDA/);
  }, 120_000);
});
