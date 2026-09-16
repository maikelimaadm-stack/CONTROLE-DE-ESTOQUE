import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
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

  it("o MÓDULO INTEIRO da decisão não tem interruptor de ambiente — não só a função `decidir`", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "scripts/lib/cutover-contador.mjs"), "utf8");

    // POR QUE O MÓDULO INTEIRO, E NÃO SÓ `decidir`. A versão anterior deste caso lia apenas o corpo de
    // `decidir`, e essa janela estreita é burlável de um jeito óbvio: basta plantar o atalho UMA CAMADA
    // ACIMA. Um `if (process.env.X === "1") return "empresa";` dentro de `constanteNoTexto` faz base e
    // head saírem iguais, `decidir` devolve `atravessa: false` sem nunca ler ambiente nenhum, e a
    // exceção de skew se desliga — com este teste passando, porque o atalho não está onde ele olhava.
    //
    // Então o que se cobra é a propriedade real: NENHUMA função deste módulo lê `process.env`. As duas
    // entradas legítimas são argumento (`decidir({base, head})`) e git (`constanteNoCommit`). Quem lê
    // ambiente são os CHAMADORES — `gate-cutover-05c2.mjs` e `skew-cutover-contador.mjs` leem
    // `SKEW_BASE_COMMIT` —, e é lá que isso é auditável como entrada da execução, não como gatilho
    // escondido da decisão.
    expect(fonte, "nenhuma função do módulo da decisão lê variável de ambiente").not.toMatch(/process\.env/);

    const corpoDecidir = fonte.slice(fonte.indexOf("export function decidir"));
    expect(corpoDecidir, "e `decidir` também não consulta o disco").not.toMatch(/readFileSync|existsSync/);
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

  it("o gate resolve a base DE VERDADE e ABORTA sem ela — nunca cai no SHA de proveniência", () => {
    // O fail-OPEN que este caso tranca: a versão anterior de `baseDaExecucao()` terminava em
    // `catch { return BASE_DE_ORIGEM }`. Como 602cda3 tem `SEQUENCIA_EMPRESA = 'farm'` para sempre, no CI
    // (clone raso, sem `origin/main`) TODA execução comparava a PR com o passado congelado. E, no dia em
    // que alguém revertesse a constante para `'farm'`, base e head ficariam iguais e o gate imprimiria
    // "APROVADO (inativo)" exatamente na PR que reintroduz o defeito. Um gate ancorado em literal mede o
    // passado, não a execução.
    const gate = fs.readFileSync(path.join(RAIZ, "scripts/gate-cutover-05c2.mjs"), "utf8");
    const importado = gate.slice(0, gate.indexOf("const RAIZ"));
    expect(importado, "o gate não importa mais a constante de proveniência — ela não é base de nada")
      .not.toMatch(/BASE_DE_ORIGEM/);

    // E o caminho que sobra é resolver ou ABORTAR — nunca devolver um literal.
    const corpo = gate.slice(gate.indexOf("function baseDaExecucao"), gate.indexOf("const migrations ="));
    expect(corpo, "o degrau final é `throw`, não um valor de reserva").toMatch(/throw new Error/);
    expect(corpo, "e a resolução real passa por shaDoRef").toMatch(/shaDoRef\(/);

    // Este caso é OFFLINE de propósito: o comportamento de `shaDoRef` contra o remoto depende de rede e de
    // quanto histórico o clone tem, e uma asserção dessas num teste unitário é verde na máquina e vermelha
    // no CI — o erro que esta própria fatia já cometeu duas vezes. Quem exercita a resolução DE VERDADE é
    // `pnpm gate:05c2`, no job de integração: ele resolve a base ou sai 1, então o job passar já é a prova.
  });

  it("o SHA de proveniência é um SHA completo — e quem o VALIDA contra o repositório é o gate, não este teste", () => {
    // Por que a forma, e não a ancestralidade: o checkout do CI é RASO (`fetch-depth: 1`), então
    // `merge-base --is-ancestor` não tem grafo para responder e reprova por falta de histórico, não por
    // proveniência errada. Uma asserção que só passa em clone completo é verde na máquina e vermelha no
    // CI pelo mesmo código — o modo de falhar que `api-anterior.mjs` já documentou neste repositório.
    //
    // O que sobra aqui é o defeito REAL de um literal digitado à mão: SHA truncado, com espaço ou fora do
    // alfabeto. E o que se perdeu não ficou sem dono: `pnpm gate:05c2` LÊ este commit
    // (`constanteNoCommit`, que busca o objeto quando o clone é raso) e REPROVA se não conseguir ler —
    // "sem a base não há matriz". É dessa leitura que sai a constante da BASE na matriz, então um SHA
    // inalcançável reprova o gate em vez de virar compatibilidade suposta.
    //
    // Isto não enfraquece nada porque `BASE_DE_ORIGEM` não decide coisa alguma: o caso acima prova que
    // `decidir` nem o menciona. Um SHA errado aqui engana um auditor humano; não liga nem desliga exceção.
    expect(BASE_DE_ORIGEM, "SHA completo de 40 hex, minúsculo").toMatch(/^[0-9a-f]{40}$/);
  });
});
