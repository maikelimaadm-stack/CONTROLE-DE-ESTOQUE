import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error — harness de rollout em JS puro, fora do grafo de tipos da API
import { BASE_DE_ORIGEM, CAMINHO_CONSTANTE, MIGRATION_CUTOVER, constanteNoTexto, constanteNaArvore, decidir } from "../../../../scripts/lib/cutover-contador.mjs";

/**
 * A EXCEÇÃO DE VERSION SKEW DA 05C-2 TEM DE EXPIRAR SOZINHA (PRE-BASE2-05C-2).
 *
 * A 05C-2 é um corte single-version: BASE e HEAD NÃO podem servir ao mesmo tempo, e o sentido 1 do job de
 * skew — que existe para provar o contrário — passa a provar a incompatibilidade. Uma exceção assim é útil
 * exatamente uma vez, e perigosa para sempre depois disso: se ficar ligada, a PR seguinte deixa de ser
 * medida no cenário que o job existe para cobrir, e ninguém percebe, porque o CI continua verde.
 *
 * Por isso o gatilho não é um SHA digitado nem uma variável de ambiente: é a COMPARAÇÃO entre a constante
 * do contador na base e no HEAD. Este arquivo cobra as duas metades disso:
 *
 *   (1) a exceção ATIVA quando, e somente quando, a constante muda entre os dois commits;
 *   (2) ela NÃO ativa para uma base que já contenha o cutover — que é toda PR futura.
 *
 * O caso (2) é o que importa, e é o que um teste preguiçoso esqueceria: provar que a exceção funciona é
 * fácil; provar que ela se desliga é o que impede a próxima fatia de herdar um bypass silencioso.
 */
const RAIZ = path.resolve(__dirname, "../../../..");

describe("decisão da exceção de skew do cutover do contador", () => {
  it("NÃO ativa quando os dois lados já têm a mesma chave — o caso de toda PR futura", () => {
    const d = decidir({ base: "empresa", head: "empresa" });
    expect(d.atravessa, "base pós-05C-2 + head pós-05C-2 = skew normal, obrigatório").toBe(false);
    expect(d.motivo).toMatch(/não atravessa|version skew normal/i);
  });

  it("ATIVA somente na troca farm → empresa, que é esta fatia", () => {
    const d = decidir({ base: "farm", head: "empresa" });
    expect(d.atravessa).toBe(true);
    expect(d.motivo, "e diz em voz alta o que decidiu, para o log do CI").toMatch(/NÃO podem servir ao mesmo tempo/);
  });

  it("NÃO ativa para a base histórica anterior ao cutover comparada com ela mesma", () => {
    // Uma PR aberta ANTES desta fatia (base 'farm', head 'farm') não tem nada a ver com o cutover: o skew
    // normal continua sendo a autoridade. A exceção não pode vazar para trás.
    expect(decidir({ base: "farm", head: "farm" }).atravessa).toBe(false);
  });

  it("ativa também no sentido inverso — um revert é igualmente single-version", () => {
    // Desfazer o cutover é tão incompatível quanto fazê-lo: a exceção não é "a favor" de uma direção.
    const d = decidir({ base: "empresa", head: "farm" });
    expect(d.atravessa).toBe(true);
  });

  it("a decisão não tem nenhum interruptor de ambiente — não existe bypass genérico para reaproveitar", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "scripts/lib/cutover-contador.mjs"), "utf8");
    // `decidir` recebe as duas constantes e só. Se alguém acrescentar um `process.env.X` que force o
    // resultado, a exceção deixa de ser auto-expirável e vira o bypass que esta fatia não quer criar.
    const corpoDecidir = fonte.slice(fonte.indexOf("export function decidir"));
    expect(corpoDecidir, "a decisão não lê variável de ambiente").not.toMatch(/process\.env/);
    expect(corpoDecidir, "nem consulta o disco").not.toMatch(/readFileSync|existsSync/);
  });

  it("a proveniência é registro, não gatilho: o SHA de origem não participa da decisão", () => {
    expect(BASE_DE_ORIGEM, "a base em que a fatia nasceu está registrada para auditoria")
      .toBe("602cda3acdaf3f92227341181bf2bf83ab37e96f");
    const fonte = fs.readFileSync(path.join(RAIZ, "scripts/lib/cutover-contador.mjs"), "utf8");
    const corpoDecidir = fonte.slice(fonte.indexOf("export function decidir"));
    expect(corpoDecidir, "e NÃO é comparada dentro de decidir — um rebase legítimo não pode ligar nem desligar a exceção")
      .not.toMatch(/BASE_DE_ORIGEM/);
  });

  it("lê a constante REAL do repositório — o HEAD desta fatia já é o canônico", () => {
    expect(constanteNaArvore(RAIZ)).toBe("empresa");
    // E o parser é estrito: ele lê a declaração, não qualquer menção da palavra no arquivo.
    expect(constanteNoTexto(`export const SEQUENCIA_EMPRESA = "farm";`)).toBe("farm");
    expect(() => constanteNoTexto("// SEQUENCIA_EMPRESA fala sobre 'empresa' mas não declara nada"))
      .toThrow(/não encontrada/);
  });

  it("o cutover que a exceção descreve existe de fato: migration e constante estão no lugar declarado", () => {
    expect(fs.existsSync(path.join(RAIZ, "supabase/migrations", MIGRATION_CUTOVER)),
      "a migration do cutover está versionada").toBe(true);
    expect(fs.existsSync(path.join(RAIZ, CAMINHO_CONSTANTE)),
      "e o caminho da constante aponta para um arquivo real").toBe(true);
  });

  it("a base declarada é um commit REAL deste repositório, e é ancestral do HEAD", () => {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: RAIZ }).toString().trim();
    expect(git("cat-file", "-t", BASE_DE_ORIGEM), "o SHA de origem existe").toBe("commit");
    // `merge-base --is-ancestor` sai 0 quando é ancestral. Se um dia não for, a proveniência ficou errada.
    expect(() => git("merge-base", "--is-ancestor", BASE_DE_ORIGEM, "HEAD")).not.toThrow();
  });
});
