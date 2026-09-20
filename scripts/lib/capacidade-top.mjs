/**
 * "A API DA BASE JÁ TEM A DESCOBERTA DE CAPACIDADE DA TOP?" — decisão única, TOP-CONFIG-02.
 *
 * A TOP-CONFIG-02 fez o Portal de Vendas PERGUNTAR ao servidor quais Tipos de Operação ele aceita antes
 * de oferecer o formulário (`GET /api/sales/<variante>/operation-types`). O cliente precisa disso porque
 * `docSchema` é `z.object` sem `.strict()`: a API que não conhece o campo DESCARTA `tipo_operacao_id` sem
 * erro, e o documento nasceria sem TOP com o usuário lendo "salvo".
 *
 * O job de version skew mede o web deste HEAD contra a API da BASE. Enquanto a base era anterior à #47, a
 * prova correta era "a base NÃO tem o endpoint, e a tela BLOQUEIA". Depois que a #47 entrou na `main`, a
 * base de toda PR nova JÁ TEM o endpoint — e aquela afirmação passou a ser falsa por decurso de prazo, sem
 * que nenhuma linha de código a quebrasse. O teste ficou vermelho para qualquer PR, inclusive uma de diff
 * vazio, porque media um passado que não volta.
 *
 * COMO A DECISÃO EXPIRA SOZINHA
 * -----------------------------
 * A escolha do ramo não é um SHA digitado nem um interruptor que alguém liga. É uma MEDIÇÃO da árvore da
 * BASE desta execução:
 *
 *   base sem a rota  → mundo LEGADO  → o sentido 1 prova o bloqueio (a prova original da #47);
 *   base com a rota  → mundo ATUAL   → o sentido 1 prova que o web reconhece a capacidade e NÃO trata um
 *                                      servidor compatível como servidor antigo.
 *
 * Nos dois mundos o gate COBRA alguma coisa do binário real. Não existe ramo que apenas passe.
 *
 * FALHA FECHADO, E O ESTADO AMBÍGUO REPROVA. Zero ocorrência é uma resposta ("base pré-capacidade"); uma
 * ocorrência é outra ("base pós-capacidade"); QUALQUER outro número é sinal de que a assinatura deixou de
 * identificar o que promete identificar — a rota foi duplicada, movida ou reescrita — e aí não há decisão
 * a tomar, há um detector quebrado. Escolher um ramo nesse estado é exatamente como um gate se autoaprova.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A base em que a TOP-CONFIG-02 foi escrita. Registro de proveniência; NÃO é o gatilho da decisão. */
export const BASE_DE_ORIGEM = "98dfddc2";

/** Onde a rota de descoberta é registrada, relativo à raiz do repositório. */
export const CAMINHO_ROTA = "apps/api/src/routes/sales.ts";

/**
 * A ASSINATURA — o REGISTRO da rota, não uma menção qualquer ao nome dela.
 *
 * Procurar só por "operation-types" casaria com comentário, teste, string de log e com a chamada do lado do
 * cliente. O que decide se o BINÁRIO serve o endpoint é a linha que o registra no Fastify, e é ela que esta
 * expressão exige: `app.get(`${base}/operation-types`, ...)`. Um comentário que cite a rota não move a
 * decisão; apagar o `app.get` move.
 */
export const ASSINATURA = /app\.get\(\s*`\$\{base\}\/operation-types`/g;

/**
 * ONDE A DECISÃO É GRAVADA — o nome mora aqui para que produtor e consumidor não tenham duas listas.
 *
 * `scripts/skew-capacidade-top.mjs` escreve; `apps/web/e2e/skew-api-producao.spec.ts` lê e RECALCULA.
 * A variável `SKEW_BASE_TEM_TOP` existe para o workflow, mas NÃO é autoridade: ela é conferida contra este
 * arquivo, e divergência REPROVA. É a mesma lição que o cutover do contador aprendeu por red team — um
 * `env:` de workflow prevalece sobre o que o passo escreveu em `$GITHUB_ENV`, e um interruptor preso por
 * fora faria o gate escolher o ramo conveniente com o log afirmando o contrário.
 */
export const ARQUIVO_DECISAO = ".skew-capacidade-top.json";

/** Quantas vezes a rota é REGISTRADA no texto do módulo. */
export function ocorrenciasNoTexto(texto) {
  return (texto.match(ASSINATURA) ?? []).length;
}

/** As ocorrências como estão numa árvore de arquivos (o checkout atual, ou a worktree da base). */
export function ocorrenciasNaArvore(raiz) {
  const caminho = join(raiz, CAMINHO_ROTA);
  if (!existsSync(caminho)) throw new Error(`não achei ${caminho}`);
  return ocorrenciasNoTexto(readFileSync(caminho, "utf8"));
}

/**
 * GARANTE QUE O OBJETO DO COMMIT ESTÁ AQUI — o checkout do CI é RASO.
 *
 * Mesma convenção de `lib/cutover-contador.mjs` e de `api-anterior.mjs`: buscar o SHA exato com
 * profundidade 1 em vez de exigir `fetch-depth: 0` do workflow. Silencioso quando o objeto já está presente.
 */
function garantirCommit(sha, cwd) {
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, stdio: "ignore" }); return; }
  catch { /* clone raso: o objeto falta e é isso que o fetch abaixo resolve */ }
  execFileSync("git", ["fetch", "--depth=1", "origin", sha], { cwd, stdio: "ignore" });
}

/**
 * As ocorrências como estão num COMMIT, sem depender da worktree montada.
 *
 * Ler do COMMIT, e não de `.api-anterior`, é deliberado e já foi medido neste repositório: a worktree é um
 * diretório de trabalho que pode ter sobrado de uma execução anterior. Falha fechado — se o commit não
 * existe e não pode ser buscado, isto LANÇA e quem chama aborta.
 */
export function ocorrenciasNoCommit(sha, cwd = process.cwd()) {
  garantirCommit(sha, cwd);
  const texto = execFileSync("git", ["show", `${sha}:${CAMINHO_ROTA}`], { cwd, encoding: "utf8" });
  return ocorrenciasNoTexto(texto);
}

/**
 * A decisão. Recebe a contagem já lida — assim a função é pura e testável sem git nem disco.
 *
 * `motivo` é para o log do CI: um job que decide sozinho tem de dizer em voz alta o que decidiu.
 */
export function decidir({ ocorrencias }) {
  if (ocorrencias === 0) {
    return {
      capaz: false, ocorrencias,
      motivo: `a árvore da base não registra ${CAMINHO_ROTA} com a rota de descoberta: mundo LEGADO, e o `
        + "sentido 1 prova que a tela BLOQUEIA e não emite POST contra um servidor que descartaria a TOP.",
    };
  }
  if (ocorrencias === 1) {
    return {
      capaz: true, ocorrencias,
      motivo: "a árvore da base registra a rota de descoberta exatamente uma vez: mundo ATUAL, e o sentido 1 "
        + "prova que a base responde 200 com `contractVersion` 1 e que o web NÃO a trata como servidor antigo.",
    };
  }
  throw new Error(
    `a assinatura da rota de descoberta apareceu ${ocorrencias} vezes em ${CAMINHO_ROTA} — esperado 0 (base `
    + "pré-capacidade) ou 1 (base pós-capacidade). Número diferente disso significa que a assinatura deixou de "
    + "identificar o que promete: a rota foi duplicada, movida ou reescrita. Escolher um ramo aqui seria "
    + "decidir com um detector quebrado, então o gate REPROVA e alguém revisa a assinatura.");
}
