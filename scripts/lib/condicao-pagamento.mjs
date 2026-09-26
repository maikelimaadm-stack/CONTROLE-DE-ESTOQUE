/**
 * "A API DA BASE JÁ DECLARA A CONDIÇÃO DE PAGAMENTO DO DOCUMENTO DE VENDA?" — decisão única, VENDAS-A4.
 *
 * Gêmeo de `lib/classificacao-financeira.mjs` (VENDAS-A1), de propósito: mesma forma de medir, mesmo
 * artefato, mesma falha fechada. Quem entende um entende o outro.
 *
 * O QUE ESTÁ EM JOGO. A VENDAS-A4 acrescenta à resposta de `GET /api/sales/<variante>/operation-types` a
 * declaração ADITIVA `capacidades.condicaoPagamento` (sem mudar `contractVersion`). O web deste HEAD só MOSTRA
 * e só ENVIA `condicao_pagamento_id` quando a API declara que o entende — o `docSchema` da API anterior é
 * `z.object` sem `.strict()` e DESCARTARIA o campo em silêncio.
 *
 * O MUNDO SE MEDE NA ÁRVORE DA BASE, não num SHA digitado nem numa variável que alguém liga:
 *
 *   base sem a declaração → mundo LEGADO → CP-K1 prova que o campo não aparece e NÃO viaja no POST;
 *   base com a declaração → mundo ATUAL  → CP-K1 prova que a base declara e o web mostra o campo.
 *
 * FALHA FECHADO: zero é uma resposta, um é outra, e qualquer outro número é detector quebrado — REPROVA.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Onde a descoberta de capacidade das vendas é declarada, relativo à raiz do repositório. */
export const CAMINHO_CAPACIDADES = "apps/api/src/routes/sales.ts";

/**
 * A ASSINATURA — a DECLARAÇÃO `condicaoPagamento:` DENTRO do bloco `capacidades: { ... }` (sem chave aninhada
 * entre a abertura do bloco e a chave), e não uma menção qualquer. Diferente da assinatura da A1, esta NÃO
 * exige ser a primeira chave: a declaração prevista é
 * `capacidades: { classificacaoFinanceira: ..., condicaoPagamento: ... }`. A ORDEM é guardada pela A1: se
 * `condicaoPagamento` vier ANTES, a assinatura da A1 (`capacidades: { classificacaoFinanceira:`) conta zero e o
 * teste de árvore dela (`classificacao-financeira-decisao.test.ts`) fica vermelho.
 */
export const ASSINATURA = /capacidades:\s*\{[^{}]*?\bcondicaoPagamento\s*:/g;

/** Onde a decisão é gravada. `skew-condicao-pagamento.mjs` escreve; os specs de skew leem e RECALCULAM. */
export const ARQUIVO_DECISAO = ".skew-condicao-pagamento.json";

/** Quantas vezes a capacidade é declarada no texto do módulo. */
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
      motivo: `a árvore da base não declara \`capacidades.condicaoPagamento\` em ${CAMINHO_CAPACIDADES}: mundo LEGADO, `
        + "e CP-K1 prova que o web não mostra o campo e não o envia no corpo do POST.",
    };
  }
  if (ocorrencias === 1) {
    return {
      declara: true, ocorrencias,
      motivo: "a árvore da base declara a capacidade exatamente uma vez: mundo ATUAL, e CP-K1 prova que a base "
        + "a serve e que o web mostra o campo em vez de tratá-la como servidor antigo.",
    };
  }
  throw new Error(
    `a assinatura da condição de pagamento apareceu ${ocorrencias} vezes em ${CAMINHO_CAPACIDADES} — esperado 0 (base `
    + "anterior à VENDAS-A4) ou 1 (base posterior). Número diferente significa detector quebrado: a declaração foi "
    + "duplicada, movida ou reescrita. Escolher um ramo aqui seria decidir às cegas, então o gate REPROVA.");
}
