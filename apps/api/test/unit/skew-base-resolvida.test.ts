import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
// @ts-expect-error — harness de skew em JS puro, fora do grafo de tipos da API
import { commitAnterior, escolherFonteDaBase, baseDoEventoDePR, garantirWorktree, refRemoto } from "../../../../scripts/api-anterior.mjs";

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

  it("o ref de RASTREIO vira o nome que o remoto conhece na hora do fetch", () => {
    // `git fetch origin origin/main` responde `couldn't find remote ref`. Num clone raso — o do CI — o ref
    // de rastreio não existe localmente, então o fetch é a ÚNICA tentativa: com o prefixo, a resolução
    // falhava e o script abortava no evento de `push`, onde não há PR para declarar a base.
    expect(refRemoto("origin/main")).toBe("main");
    expect(refRemoto("origin/release/2026")).toBe("release/2026");
    expect(refRemoto("main"), "um nome já remoto passa intacto").toBe("main");
    expect(refRemoto("a".repeat(40)), "um SHA passa intacto").toBe("a".repeat(40));
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
/**
 * OS RÓTULOS DO LOG DIZEM O QUE O VALOR É.
 *
 * `[skew] HEAD da PR ......... <git rev-parse HEAD>` era uma afirmação FALSA: num evento `pull_request` o
 * `actions/checkout` posiciona a árvore num MERGE REF sintético — o merge do head da PR com a base —, que
 * não é o head de branch nenhuma. O log mostrava um valor e o chamava de outra coisa.
 *
 * Isto é o mesmo defeito que a PRE-BASE2-05C-0 corrige nos gates, só que em prosa: quem lê o CI toma
 * decisão pelo rótulo. O guarda olha o que o script IMPRIME — não os comentários, que precisam citar o
 * rótulo antigo para explicar por que ele saiu.
 */
describe("rótulos do log do skew", () => {
  const impressoes = () => {
    const corpo = fs.readFileSync(ARQUIVO, "utf8");
    return [...corpo.matchAll(/console\.log\(`([^`]*)`/g)].map((m) => m[1]!);
  };

  it("nenhum rótulo impresso chama o checkout de \"HEAD da PR\"", () => {
    const suspeitos = impressoes().filter((l) => /HEAD da PR/.test(l));
    expect(suspeitos, "o checkout do runner não é o head da PR num evento pull_request").toEqual([]);
  });

  it("o bloco de identidade nomeia checkout, base, fonte, árvore e igualdade", () => {
    const tudo = impressoes().join(" | ");
    for (const rotulo of ["checkout sob teste", "base esperada", "fonte da base", ".api-anterior HEAD", "igualdade"]) {
      expect(tudo, `o log precisa dizer "${rotulo}"`).toContain(rotulo);
    }
    // O head declarado da PR é DIAGNÓSTICO e sai de um dado da PR, nunca de `git rev-parse`.
    expect(tudo).toContain("PR head declarado");
    expect(impressoes().some((l) => /PR head declarado/.test(l) && /headDaPR/.test(l)), "vem da variável de diagnóstico").toBe(true);
  });
});

describe("R16 · a árvore de trabalho", () => {
  /**
   * Repositório TEMPORÁRIO com dois commits, não o repositório real.
   *
   * No CI o checkout é raso (`fetch-depth: 1`): `HEAD~1` não existe, e um teste que dependesse de dois
   * commits daqui passaria na máquina e reprovaria no runner — pelo mesmo código. O cenário que importa
   * (árvore em cache noutro commit) não precisa deste repositório: precisa de DOIS commits quaisquer.
   */
  let repo: string; let A = ""; let B = "";
  const g = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "skew-r16-"));
    g(["init", "-q", "-b", "principal"], repo);
    g(["config", "user.email", "r16@teste"], repo);
    g(["config", "user.name", "R16"], repo);
    // A marca é o arquivo que o harness usa para decidir "a árvore já existe".
    const marca = path.join(repo, "apps/api/src");
    fs.mkdirSync(marca, { recursive: true });
    for (const conteudo of ["primeiro", "segundo"]) {
      fs.writeFileSync(path.join(marca, "main.ts"), `// ${conteudo}\n`, "utf8");
      g(["add", "-A"], repo);
      g(["commit", "-qm", conteudo], repo);
    }
    B = g(["rev-parse", "HEAD"], repo);
    A = g(["rev-parse", "HEAD~1"], repo);
  });
  afterAll(() => { fs.rmSync(repo, { recursive: true, force: true }); });

  it("monta na base pedida, reaproveita quando confere e REFAZ quando está em outro commit", () => {
    const dir = path.join(repo, ".api-anterior");
    expect(A, "a premissa: dois commits distintos").not.toBe(B);

    expect(garantirWorktree(A, dir, repo), "montou do zero").toBe(true);
    expect(g(["rev-parse", "HEAD"], dir)).toBe(A);

    expect(garantirWorktree(A, dir, repo), "no mesmo commit, reaproveita").toBe(false);

    expect(garantirWorktree(B, dir, repo), "em outro commit, REFAZ — não reaproveita por existir arquivo").toBe(true);
    expect(g(["rev-parse", "HEAD"], dir), "e termina exatamente na base pedida").toBe(B);
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
    const { sha, origem, checkout } = commitAnterior() as { sha: string; origem: string; checkout: string };
    expect(sha, "40 hexadecimais").toMatch(/^[0-9a-f]{40}$/);
    expect(origem, "a origem da base é declarada, para o log do CI responder 'comparado com o quê?'").toBeTruthy();
    // `checkout`, e não "HEAD da PR": num evento `pull_request` o runner posiciona a árvore num MERGE REF
    // sintético, que não é o head de branch nenhuma. O nome diz o que o valor é.
    expect(checkout).toBe(git("rev-parse", "HEAD"));
    // Comparar o HEAD com ele mesmo passaria sempre: é o verde que não prova nada.
    expect(sha, "a base não pode ser o próprio commit do checkout").not.toBe(checkout);
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
