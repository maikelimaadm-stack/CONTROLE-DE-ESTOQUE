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
 * iguais, exceção inativa, skew normal de volta. Não há nada para lembrar de remover.
 *
 * O QUE ESTE BLOCO AFIRMAVA A MAIS, E FOI CORRIGIDO. Ele dizia que "não existe interruptor genérico que
 * alguém possa reaproveitar". A DECISÃO é pura, sim — mas quem a CONSUMIA era o e2e, através da variável
 * `SKEW_CUTOVER_CONTADOR`, e variável de ambiente é mutável: um `env:` de workflow prevalece sobre o que
 * este passo escreve em `$GITHUB_ENV`. O interruptor existia, e estava um degrau depois da decisão.
 * Fechado por `ARQUIVO_DECISAO`: o e2e RECALCULA a partir dos dois insumos gravados e trata a variável
 * como conferência, de modo que fixá-la por fora REPROVA em vez de escolher o ramo barato.
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
 * ONDE A DECISÃO É GRAVADA — o nome mora aqui para que produtor e consumidor não tenham duas listas.
 *
 * `scripts/skew-cutover-contador.mjs` escreve; `apps/web/e2e/skew-api-producao.spec.ts` lê e RECALCULA.
 * A variável `SKEW_CUTOVER_CONTADOR` continua existindo para o workflow, mas deixou de ser autoridade:
 * ela é conferida contra este arquivo, e divergência REPROVA.
 */
export const ARQUIVO_DECISAO = ".skew-cutover-contador.json";

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

/**
 * GARANTE QUE O OBJETO DO COMMIT ESTÁ AQUI — o checkout do CI é RASO.
 *
 * `actions/checkout` traz um commit só (`fetch-depth: 1`), então `git show <sha>:<arquivo>` de qualquer
 * outro commit falha no CI enquanto passa na máquina de quem tem o histórico. É o modo de falhar que este
 * repositório já documentou em `api-anterior.mjs`: verde local e vermelho remoto pelo mesmo código.
 *
 * A correção segue a convenção que aquele script estabeleceu — buscar o SHA EXATO com profundidade 1, em
 * vez de pedir `fetch-depth: 0` no workflow. O custo não depende do tamanho do histórico, e a decisão de
 * quanto histórico o CI clona continua sendo do workflow, não desta biblioteca.
 *
 * Silencioso quando o objeto já está presente: no uso normal (clone completo) não há rede nenhuma.
 */
function garantirCommit(sha, cwd) {
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, stdio: "ignore" }); return; }
  catch { /* clone raso: o objeto falta e é isso que o fetch abaixo resolve */ }
  execFileSync("git", ["fetch", "--depth=1", "origin", sha], { cwd, stdio: "ignore" });
}

/**
 * A constante como ela está num COMMIT, sem precisar de worktree montada.
 *
 * Falha fechado por construção: se o commit não existe e não pode ser buscado, isto LANÇA — e quem chama
 * (o gate e o decisor de skew) aborta. Um erro alto aqui é o comportamento correto; o perigoso seria
 * devolver um valor de mentira e deixar a decisão do cutover ser tomada sobre ele.
 */
export function constanteNoCommit(sha, cwd = process.cwd()) {
  garantirCommit(sha, cwd);
  const texto = execFileSync("git", ["show", `${sha}:${CAMINHO_CONSTANTE}`], { cwd, encoding: "utf8" });
  return constanteNoTexto(texto);
}

/**
 * `<ref>` -> SHA, buscando do remoto quando o clone é raso. `null` quando o ref não existe.
 *
 * `origin/main` é o nome do ref de RASTREIO local; no remoto ele se chama `main`, e num clone raso o ref
 * de rastreio pode simplesmente não existir. É a mesma lição de `api-anterior.mjs`, e a razão de existir
 * aqui é fechar um fail-open concreto: sem isto, quem chama não conseguia resolver a base no CI e caía
 * num SHA literal congelado, que compara a PR com o passado em vez de com a base dela.
 *
 * Recebe o ref por argumento — nada aqui lê ambiente, e o teste da decisão cobra isso do módulo inteiro.
 */
export function shaDoRef(ref, cwd) {
  const git = (...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
  // O REF DE RASTREIO VELHO É UM LITERAL CONGELADO COM OUTRO NOME. Resolver `origin/main` direto do ref
  // local aceita, sem avisar, uma ponta de meses atrás — o caso normal de quem roda o gate na própria
  // máquina sem `fetch`. Depois do merge da 05C-2 isso faria o gate anunciar "ATRAVESSA o cutover" numa
  // PR que não atravessa nada, e como o resultado é VERDE ninguém investiga: a expiração automática que
  // esta fatia vende simplesmente não aconteceria ali. Por isso o remoto é consultado PRIMEIRO, e o ref
  // local só serve de reserva quando não há rede.
  try {
    execFileSync("git", ["fetch", "--depth=1", "origin", String(ref).replace(/^origin\//, "")],
      { cwd, stdio: "ignore" });
    return git("rev-parse", "--verify", "FETCH_HEAD^{commit}");
  } catch { /* sem rede, ou ref inexistente no remoto: cai no ref local abaixo */ }
  try { return git("rev-parse", "--verify", `${ref}^{commit}`); } catch { return null; }
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
