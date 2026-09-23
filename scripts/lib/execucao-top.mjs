/**
 * "A API DA BASE JÁ DECLARA A EXECUÇÃO CONFIGURADA DA TOP?" — decisão única, TOP-CONFIG-04A.
 *
 * Gêmeo de `lib/capacidade-top.mjs`, e de propósito: mesma forma de medir, mesmo artefato, mesma falha
 * fechada. Quem entende um entende o outro.
 *
 * O QUE ESTÁ EM JOGO. A TOP-CONFIG-04A acrescentou às capacidades da administração de TOP um bloco OPCIONAL
 * `execucao` (formato 2 da configuração, estado do gate, matriz de suporte). O web deste HEAD, contra uma
 * API que NÃO tem o bloco, precisa se comportar como cliente do formato 1: esconder a área de execução e
 * gravar no formato 1 — nunca enviar um formato que aquele servidor recusaria, nem perder uma decisão em
 * silêncio. Contra uma API que TEM o bloco, precisa reconhecê-lo e NÃO tratá-la como servidor antigo.
 *
 * O MUNDO SE MEDE NA ÁRVORE DA BASE, não num SHA digitado nem numa variável que alguém liga:
 *
 *   base sem o bloco → mundo LEGADO → o sentido 1 prova que o web esconde a execução, grava no formato 1,
 *                                     e que a API da base RECUSA o formato 2 (explícito, nunca silencioso);
 *   base com o bloco → mundo ATUAL  → o sentido 1 prova que a base declara o bloco e o web mostra a área.
 *
 * FALHA FECHADO: zero é uma resposta, um é outra, e qualquer outro número é detector quebrado — REPROVA.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A base em que a TOP-CONFIG-04A foi escrita. Registro de proveniência; NÃO é o gatilho da decisão. */
export const BASE_DE_ORIGEM = "d2606e38";

/** Onde as capacidades da administração de TOP são declaradas, relativo à raiz do repositório. */
export const CAMINHO_CAPACIDADES = "apps/api/src/routes/tipos-operacao.ts";

/**
 * A ASSINATURA — a DECLARAÇÃO do estado do gate dentro do bloco `execucao` das capacidades, e não uma
 * menção qualquer ao gate. Comentário, teste e documentação citam `TOP_EFFECTS_RUNTIME_V1_ENABLED` o tempo
 * todo; o que decide se o BINÁRIO serve o bloco é a linha `runtimeHabilitado: app.config.<gate>`.
 */
export const ASSINATURA = /runtimeHabilitado:\s*app\.config\.TOP_EFFECTS_RUNTIME_V1_ENABLED\b/g;

/** Onde a decisão é gravada. `skew-execucao-top.mjs` escreve; `skew-api-producao.spec.ts` lê e RECALCULA. */
export const ARQUIVO_DECISAO = ".skew-execucao-top.json";

/** Quantas vezes o bloco é declarado no texto do módulo. */
export function ocorrenciasNoTexto(texto) {
  return (texto.match(ASSINATURA) ?? []).length;
}

/** As ocorrências como estão numa árvore de arquivos (o checkout atual, ou a worktree da base). */
export function ocorrenciasNaArvore(raiz) {
  const caminho = join(raiz, CAMINHO_CAPACIDADES);
  if (!existsSync(caminho)) throw new Error(`não achei ${caminho}`);
  return ocorrenciasNoTexto(readFileSync(caminho, "utf8"));
}

/** O checkout do CI é raso: busca o SHA exato com profundidade 1. Silencioso quando o objeto já existe. */
function garantirCommit(sha, cwd) {
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, stdio: "ignore" }); return; }
  catch { /* clone raso: o objeto falta e é isso que o fetch abaixo resolve */ }
  execFileSync("git", ["fetch", "--depth=1", "origin", sha], { cwd, stdio: "ignore" });
}

/** As ocorrências como estão num COMMIT — nunca na worktree montada, que pode ter sobrado de outra execução. */
export function ocorrenciasNoCommit(sha, cwd = process.cwd()) {
  garantirCommit(sha, cwd);
  const texto = execFileSync("git", ["show", `${sha}:${CAMINHO_CAPACIDADES}`], { cwd, encoding: "utf8" });
  return ocorrenciasNoTexto(texto);
}

/** A decisão, pura: recebe a contagem já lida. `motivo` é para o log do CI dizer em voz alta o que decidiu. */
export function decidir({ ocorrencias }) {
  if (ocorrencias === 0) {
    return {
      declara: false, ocorrencias,
      motivo: `a árvore da base não declara o bloco \`execucao\` em ${CAMINHO_CAPACIDADES}: mundo LEGADO, e o sentido 1 `
        + "prova que o web esconde a execução, grava no formato 1 e que a base RECUSA o formato 2.",
    };
  }
  if (ocorrencias === 1) {
    return {
      declara: true, ocorrencias,
      motivo: "a árvore da base declara o bloco `execucao` exatamente uma vez: mundo ATUAL, e o sentido 1 prova que "
        + "a base o serve e que o web mostra a área de execução em vez de tratá-la como servidor antigo.",
    };
  }
  throw new Error(
    `a assinatura do bloco \`execucao\` apareceu ${ocorrencias} vezes em ${CAMINHO_CAPACIDADES} — esperado 0 (base `
    + "anterior à TOP-CONFIG-04A) ou 1 (base posterior). Número diferente significa detector quebrado: o bloco foi "
    + "duplicado, movido ou reescrito. Escolher um ramo aqui seria decidir às cegas, então o gate REPROVA.");
}
