/**
 * "A API DA BASE JÁ DECLARA O LAYOUT DO DOCUMENTO DE VENDA?" — decisão única, VENDAS-A3-1.
 *
 * Gêmeo de `lib/condicao-pagamento.mjs` (VENDAS-A4) e de `lib/classificacao-financeira.mjs` (VENDAS-A1), de
 * propósito: mesma forma de medir, mesmo artefato, mesma falha fechada.
 *
 * O QUE ESTÁ EM JOGO. A VENDAS-A3-1 acrescenta à resposta de `GET /api/sales/<variante>/operation-types` a
 * declaração ADITIVA `capacidades.layoutDocumento` (sem mudar `contractVersion`). O web deste HEAD só consulta
 * `/layout-efetivo` e só aplica o layout quando a API declara que o serve; contra uma API que não declara, a
 * Central é a de hoje, idêntica.
 *
 * O MUNDO SE MEDE NA ÁRVORE DA BASE:
 *
 *   base sem a declaração → mundo LEGADO → LD-K1 prova que o web NÃO pede `/layout-efetivo` (no fio) e que o
 *                                          documento nasce como hoje (201);
 *   base com a declaração → mundo ATUAL  → LD-K1 prova que a base declara e serve a capacidade.
 *
 * FALHA FECHADO: zero é uma resposta, um é outra, e qualquer outro número é detector quebrado — REPROVA.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Onde a descoberta de capacidade das vendas é declarada, relativo à raiz do repositório. */
export const CAMINHO_CAPACIDADES = "apps/api/src/routes/sales.ts";

/**
 * A ASSINATURA — a DECLARAÇÃO `layoutDocumento:` DENTRO do bloco `capacidades: { ... }` (sem chave aninhada
 * entre a abertura do bloco e a chave). A declaração prevista é
 * `capacidades: { classificacaoFinanceira: ..., condicaoPagamento: ..., layoutDocumento: ... }`.
 * A ORDEM é guardada pelos testes de árvore anteriores: `classificacaoFinanceira` primeira (A1) e
 * `layoutDocumento` depois de `condicaoPagamento` (guarda em `condicao-pagamento-decisao.test.ts`).
 */
export const ASSINATURA = /capacidades:\s*\{[^{}]*?\blayoutDocumento\s*:/g;

/** Onde a decisão é gravada. `skew-layout-documento.mjs` escreve; os specs de skew leem e RECALCULAM. */
export const ARQUIVO_DECISAO = ".skew-layout-documento.json";

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
      motivo: `a árvore da base não declara \`capacidades.layoutDocumento\` em ${CAMINHO_CAPACIDADES}: mundo LEGADO, `
        + "e LD-K1 prova que o web não pede /layout-efetivo e que o documento nasce como hoje.",
    };
  }
  if (ocorrencias === 1) {
    return {
      declara: true, ocorrencias,
      motivo: "a árvore da base declara a capacidade exatamente uma vez: mundo ATUAL, e LD-K1 prova que a base "
        + "a serve em vez de o web tratá-la como servidor antigo.",
    };
  }
  throw new Error(
    `a assinatura do layout do documento apareceu ${ocorrencias} vezes em ${CAMINHO_CAPACIDADES} — esperado 0 (base `
    + "anterior à VENDAS-A3-1) ou 1 (base posterior). Número diferente significa detector quebrado: a declaração foi "
    + "duplicada, movida ou reescrita. Escolher um ramo aqui seria decidir às cegas, então o gate REPROVA.");
}

/**
 * A ORDEM — `layoutDocumento` DEPOIS de `condicaoPagamento` no mesmo bloco `capacidades`. Consumida pelo teste de
 * árvore da A4 (`condicao-pagamento-decisao.test.ts`): declarar o layout ANTES da condição deixa aquele teste
 * vermelho, do mesmo jeito que a A1 guarda a primeira chave.
 */
export const ASSINATURA_ORDEM = /capacidades:\s*\{[^{}]*?\bcondicaoPagamento\s*:[^{}]*?\blayoutDocumento\s*:/g;

/** Quantas declarações do layout aparecem na ordem prevista (depois da condição de pagamento). */
export function ocorrenciasNaOrdem(texto) {
  return (texto.match(ASSINATURA_ORDEM) ?? []).length;
}
