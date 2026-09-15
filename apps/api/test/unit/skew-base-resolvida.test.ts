import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error — harness de skew em JS puro, fora do grafo de tipos da API
import { commitAnterior } from "../../../../scripts/api-anterior.mjs";

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
