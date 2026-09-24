/**
 * "A API DA BASE JÁ DECLARA A CLASSIFICAÇÃO FINANCEIRA DO DOCUMENTO DE VENDA?" — decisão única, VENDAS-A1.
 *
 * Gêmeo de `lib/execucao-top.mjs` e de `lib/capacidade-top.mjs`, de propósito: mesma forma de medir, mesmo
 * artefato, mesma falha fechada. Quem entende um entende os outros.
 *
 * O QUE ESTÁ EM JOGO. A VENDAS-A1 acrescentou à resposta de `GET /api/sales/<variante>/operation-types` a
 * declaração ADITIVA `capacidades.classificacaoFinanceira` (sem mudar `contractVersion`). O web deste HEAD
 * só MOSTRA e só ENVIA `categoria_financeira_id`/`centro_custo_id` quando a API declara que os entende —
 * porque o `docSchema` da API anterior é `z.object` sem `.strict()` e DESCARTA os dois em silêncio: o
 * usuário leria "salvo" num documento sem classificação.
 *
 * O MUNDO SE MEDE NA ÁRVORE DA BASE, não num SHA digitado nem numa variável que alguém liga:
 *
 *   base sem a declaração → mundo LEGADO → o sentido 1 prova que os campos não aparecem e NÃO viajam no
 *                                          corpo do POST (conferido no fio);
 *   base com a declaração → mundo ATUAL  → o sentido 1 prova que a base declara e o web mostra os campos.
 *
 * FALHA FECHADO: zero é uma resposta, um é outra, e qualquer outro número é detector quebrado — REPROVA.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Onde a descoberta de capacidade das vendas é declarada, relativo à raiz do repositório. */
export const CAMINHO_CAPACIDADES = "apps/api/src/routes/sales.ts";

/**
 * A ASSINATURA — a DECLARAÇÃO dentro do bloco `capacidades` da resposta de `operation-types`, e não uma
 * menção qualquer. A auditoria da confirmação também grava uma chave `classificacaoFinanceira`, e
 * comentários citam o nome o tempo todo; o que decide se o BINÁRIO serve a capacidade é esta linha.
 */
export const ASSINATURA = /capacidades:\s*\{\s*classificacaoFinanceira:/g;

/** Onde a decisão é gravada. `skew-classificacao-financeira.mjs` escreve; `skew-api-producao.spec.ts` lê e RECALCULA. */
export const ARQUIVO_DECISAO = ".skew-classificacao-financeira.json";

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
      motivo: `a árvore da base não declara \`capacidades.classificacaoFinanceira\` em ${CAMINHO_CAPACIDADES}: mundo LEGADO, `
        + "e o sentido 1 prova que o web não mostra os campos e não os envia no corpo do POST.",
    };
  }
  if (ocorrencias === 1) {
    return {
      declara: true, ocorrencias,
      motivo: "a árvore da base declara a capacidade exatamente uma vez: mundo ATUAL, e o sentido 1 prova que a base "
        + "a serve e que o web mostra os campos em vez de tratá-la como servidor antigo.",
    };
  }
  throw new Error(
    `a assinatura da capacidade apareceu ${ocorrencias} vezes em ${CAMINHO_CAPACIDADES} — esperado 0 (base anterior à `
    + "VENDAS-A1) ou 1 (base posterior). Número diferente significa detector quebrado: a declaração foi duplicada, "
    + "movida ou reescrita. Escolher um ramo aqui seria decidir às cegas, então o gate REPROVA.");
}
