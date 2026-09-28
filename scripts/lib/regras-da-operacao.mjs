/**
 * "A API DA BASE JÁ DECLARA AS REGRAS DA OPERAÇÃO DO DOCUMENTO DE VENDA?" — decisão única, TOP-CONFIG-05.
 *
 * Gêmeo de `lib/layout-documento.mjs` (VENDAS-A3-1), de propósito: mesma forma de medir, mesmo artefato,
 * mesma falha fechada.
 *
 * O QUE ESTÁ EM JOGO. A TOP-CONFIG-05 acrescenta à resposta de `GET /api/sales/<variante>/operation-types` a
 * declaração ADITIVA `capacidades.regrasDaOperacao` (sem mudar `contractVersion`), POR ÚLTIMO, depois de
 * `layoutDocumento`. O web deste HEAD só consulta `/regras-da-operacao` e `/situacao-cliente` quando a API
 * declara a capacidade com o valor exato; contra uma API que não declara, a Central é a de hoje, idêntica.
 *
 * O MUNDO SE MEDE NA ÁRVORE DA BASE:
 *
 *   base sem a declaração → mundo LEGADO → RO-K1 prova que o web NÃO pede `/regras-da-operacao` nem
 *                                          `/situacao-cliente` (no fio) e que o documento nasce como hoje (201);
 *   base com a declaração → mundo ATUAL  → RO-K1 prova que a base declara a capacidade e serve
 *                                          `/regras-da-operacao` (200, com a forma do contrato).
 *
 * FALHA FECHADO: zero é uma resposta, um é outra, e qualquer outro número é detector quebrado — REPROVA.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Onde a descoberta de capacidade das vendas é declarada, relativo à raiz do repositório. */
export const CAMINHO_CAPACIDADES = "apps/api/src/routes/sales.ts";

/**
 * A ASSINATURA — a DECLARAÇÃO `regrasDaOperacao:` DENTRO do bloco `capacidades: { ... }` (sem chave aninhada
 * entre a abertura do bloco e a chave). A declaração prevista é
 * `capacidades: { classificacaoFinanceira: ..., condicaoPagamento: ..., layoutDocumento: ..., regrasDaOperacao: ... }`.
 * A ORDEM é guardada pelo teste de árvore (`regras-da-operacao-decisao.test.ts`): `regrasDaOperacao` depois de
 * `layoutDocumento`, do mesmo jeito que a A3-1 guarda o layout depois da condição de pagamento.
 */
export const ASSINATURA = /capacidades:\s*\{[^{}]*?\bregrasDaOperacao\s*:/g;

/** Onde a decisão é gravada. `skew-regras-da-operacao.mjs` escreve; os specs de skew leem e RECALCULAM. */
export const ARQUIVO_DECISAO = ".skew-regras-da-operacao.json";

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
      motivo: `a árvore da base não declara \`capacidades.regrasDaOperacao\` em ${CAMINHO_CAPACIDADES}: mundo LEGADO, `
        + "e RO-K1 prova que o web não pede /regras-da-operacao nem /situacao-cliente e que o documento nasce como hoje.",
    };
  }
  if (ocorrencias === 1) {
    return {
      declara: true, ocorrencias,
      motivo: "a árvore da base declara a capacidade exatamente uma vez: mundo ATUAL, e RO-K1 prova que a base "
        + "a declara e serve /regras-da-operacao em vez de o web tratá-la como servidor antigo.",
    };
  }
  throw new Error(
    `a assinatura das regras da operação apareceu ${ocorrencias} vezes em ${CAMINHO_CAPACIDADES} — esperado 0 (base `
    + "anterior à TOP-CONFIG-05) ou 1 (base posterior). Número diferente significa detector quebrado: a declaração foi "
    + "duplicada, movida ou reescrita. Escolher um ramo aqui seria decidir às cegas, então o gate REPROVA.");
}

/**
 * A ORDEM — `regrasDaOperacao` DEPOIS de `layoutDocumento` no mesmo bloco `capacidades`. Consumida pelo teste de
 * árvore da TOP-CONFIG-05 (`regras-da-operacao-decisao.test.ts`): declarar as regras ANTES do layout deixa aquele
 * teste vermelho, do mesmo jeito que a A3-1 guarda o layout depois da condição de pagamento.
 */
export const ASSINATURA_ORDEM = /capacidades:\s*\{[^{}]*?\blayoutDocumento\s*:[^{}]*?\bregrasDaOperacao\s*:/g;

/** Quantas declarações das regras da operação aparecem na ordem prevista (depois do layout do documento). */
export function ocorrenciasNaOrdem(texto) {
  return (texto.match(ASSINATURA_ORDEM) ?? []).length;
}
