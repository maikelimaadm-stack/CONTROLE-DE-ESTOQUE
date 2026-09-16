/**
 * "ESTA EXECUÇÃO ATRAVESSA O CUTOVER DO CONTADOR?" — decisão única, PRE-BASE2-05C-2.
 *
 * A 05C-2 troca a chave persistida do contador de código da Empresa (`erp.code_sequences.entity`) de
 * `'farm'` para `'empresa'`, e troca `SEQUENCIA_EMPRESA` junto. As duas coisas TÊM de andar juntas, e
 * disso decorre uma consequência que nenhum outro corte deste repositório teve: durante a janela existem
 * DOIS estados proibidos, não degradados —
 *
 *   BASE runtime + banco PÓS-0018  → a API antiga chama `next_code(org,'farm')`, a linha não existe,
 *                                    e `next_code` RECRIA em 1 por cima do acervo já numerado;
 *   HEAD runtime + banco PRÉ-0018  → a API nova chama `next_code(org,'empresa')`, a linha não existe,
 *                                    e acontece exatamente o mesmo.
 *
 * O job de version skew do CI existe para provar que BASE e HEAD PODEM servir ao mesmo tempo. Nesta PR
 * essa afirmação é FALSA por construção — e deixar o job verde seria certificar uma compatibilidade que
 * não existe, que é pior do que não ter o job. Por isso a exceção não DESLIGA nada: ela INVERTE o que o
 * sentido 1 cobra, passando a exigir a prova de que a combinação proibida realmente falha.
 *
 * COMO A EXCEÇÃO EXPIRA SOZINHA
 * -----------------------------
 * A decisão não é um SHA digitado nem uma variável de ambiente que alguém liga. É uma COMPARAÇÃO entre a
 * constante de runtime da BASE e a deste HEAD:
 *
 *   base === head  → esta execução não atravessa o cutover → skew normal, obrigatório;
 *   base !== head  → atravessa → o sentido 1 prova a incompatibilidade.
 *
 * Depois que a 05C-2 estiver em `main`, qualquer PR nova tem base com `'empresa'` e HEAD com `'empresa'`:
 * iguais, exceção inativa, skew normal de volta. Não há nada para lembrar de remover, e não existe
 * interruptor genérico que alguém possa reaproveitar para silenciar outro skew — a única coisa que liga
 * a exceção é a constante do contador ter mudado entre os dois commits.
 *
 * Ancorar num SHA fixo seria pior, e vale dizer por quê: um rebase legítimo (outra PR entra na main
 * antes desta) mudaria a base e a exceção ou morreria sem motivo ou continuaria ligada sem motivo. A
 * base em que esta fatia nasceu está registrada em `BASE_DE_ORIGEM` para auditoria humana, e é isso que
 * ela é — proveniência, não gatilho.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A base em que a 05C-2 foi escrita. Registro de proveniência; NÃO é o gatilho da exceção. */
export const BASE_DE_ORIGEM = "602cda3acdaf3f92227341181bf2bf83ab37e96f";

/** Caminho da constante de runtime, relativo à raiz do repositório. */
export const CAMINHO_CONSTANTE = "apps/api/src/lib/sequencia-empresa.ts";

/** A migration que executa o cutover. */
export const MIGRATION_CUTOVER = "0018_empresa_code_sequence.sql";

/**
 * Extrai o valor de `SEQUENCIA_EMPRESA` do TEXTO do módulo.
 *
 * Ler o literal em vez de importar o módulo é deliberado: a constante da BASE vem de um commit que não
 * está montado como pacote, e importar exigiria build. O que se lê é a mesma linha que o binário compila.
 */
export function constanteNoTexto(texto) {
  const m = /export\s+const\s+SEQUENCIA_EMPRESA\s*=\s*["']([^"']+)["']/.exec(texto);
  if (!m) throw new Error(`SEQUENCIA_EMPRESA não encontrada no texto de ${CAMINHO_CONSTANTE}`);
  return m[1];
}

/** A constante como ela está numa árvore de arquivos (o checkout atual, ou a worktree da base). */
export function constanteNaArvore(raiz) {
  const caminho = join(raiz, CAMINHO_CONSTANTE);
  if (!existsSync(caminho)) throw new Error(`não achei ${caminho}`);
  return constanteNoTexto(readFileSync(caminho, "utf8"));
}

/** A constante como ela está num COMMIT, sem precisar de worktree montada. */
export function constanteNoCommit(sha, cwd = process.cwd()) {
  const texto = execFileSync("git", ["show", `${sha}:${CAMINHO_CONSTANTE}`], { cwd, encoding: "utf8" });
  return constanteNoTexto(texto);
}

/** A migration do cutover existe nesta árvore? */
export function temMigrationDoCutover(raiz) {
  return existsSync(join(raiz, "supabase/migrations", MIGRATION_CUTOVER));
}

/**
 * A decisão. Recebe as duas constantes já lidas — assim a função é pura e testável sem git nem disco.
 *
 * `motivo` é para o log do CI: um job que decide sozinho tem de dizer em voz alta o que decidiu, senão
 * vira exatamente o tipo de mágica silenciosa que esta fatia existe para não criar.
 */
export function decidir({ base, head }) {
  if (base === head) {
    return {
      atravessa: false,
      base, head,
      motivo: `a constante do contador é '${head}' nos dois lados: esta execução não atravessa o cutover, `
        + "e o version skew normal vale integralmente.",
    };
  }
  return {
    atravessa: true,
    base, head,
    motivo: `a constante do contador muda de '${base}' (base) para '${head}' (head): BASE e HEAD NÃO podem `
      + "servir ao mesmo tempo, e o sentido 1 do skew passa a provar essa incompatibilidade em vez de negá-la.",
  };
}
