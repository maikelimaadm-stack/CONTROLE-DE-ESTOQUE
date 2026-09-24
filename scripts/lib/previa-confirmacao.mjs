/**
 * "A API DA BASE JÁ SERVE A PRÉVIA DA CONFIRMAÇÃO DA VENDA?" — decisão única, VENDAS-A5-1.
 *
 * Gêmeo de `lib/classificacao-financeira.mjs` (e de `lib/execucao-top.mjs`), de propósito: mesma forma de
 * medir, mesmo artefato, mesma falha fechada. Quem entende um entende os outros.
 *
 * O QUE ESTÁ EM JOGO. A VENDAS-A5-1 acrescentou a rota de LEITURA `GET /api/sales/sales/:id/previa-confirmacao`,
 * e o diálogo "Confirmar venda" deste HEAD passou a pedir a ela o texto de efeito. Contra uma API que não a
 * declara, a pergunta volta 404 — e o diálogo TEM de cair no texto neutro com o botão habilitado, porque
 * quem recusa é o servidor. Se o web tratasse a ausência como "carregando para sempre" ou como "recusa", a
 * janela em que o Vercel sobe antes do Railway travaria a confirmação de toda venda.
 *
 * O MUNDO SE MEDE NA ÁRVORE DA BASE, não num SHA digitado nem numa variável que alguém liga:
 *
 *   base sem a rota → mundo LEGADO → o sentido 1 prova, no fio, que a pergunta volta sem contrato e que o
 *                                    diálogo mostra o texto neutro, com o botão habilitado, e confirma;
 *   base com a rota → mundo ATUAL  → o sentido 1 prova que a base responde o contrato 1 e que o diálogo
 *                                    mostra a prévia em vez de tratá-la como servidor antigo.
 *
 * FALHA FECHADO: zero é uma resposta, um é outra, e qualquer outro número é detector quebrado — REPROVA.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Onde as rotas de venda são declaradas, relativo à raiz do repositório. */
export const CAMINHO_ROTAS = "apps/api/src/routes/sales.ts";

/**
 * A ASSINATURA — a DECLARAÇÃO da rota (`app.get(\`${base}/:id/previa-confirmacao\``), e não uma menção
 * qualquer. Comentários, o contrato e o próprio web citam o caminho `/previa-confirmacao` o tempo todo; o
 * que decide se o BINÁRIO responde é o registro da rota no Fastify, que é esta linha.
 */
export const ASSINATURA = /app\.get\(\s*`\$\{base\}\/:id\/previa-confirmacao`/g;

/** Onde a decisão é gravada. `skew-previa-confirmacao.mjs` escreve; `skew-api-producao.spec.ts` lê e RECALCULA. */
export const ARQUIVO_DECISAO = ".skew-previa-confirmacao.json";

/** Quantas vezes a rota é declarada no texto do módulo. */
export function ocorrenciasNoTexto(texto) {
  return (texto.match(ASSINATURA) ?? []).length;
}

/** As ocorrências como estão numa árvore de arquivos (o checkout atual, ou a worktree da base). */
export function ocorrenciasNaArvore(raiz) {
  const caminho = join(raiz, CAMINHO_ROTAS);
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
  const texto = execFileSync("git", ["show", `${sha}:${CAMINHO_ROTAS}`], { cwd, encoding: "utf8" });
  return ocorrenciasNoTexto(texto);
}

/** A decisão, pura: recebe a contagem já lida. `motivo` é para o log do CI dizer em voz alta o que decidiu. */
export function decidir({ ocorrencias }) {
  if (ocorrencias === 0) {
    return {
      serve: false, ocorrencias,
      motivo: `a árvore da base não declara a rota \`previa-confirmacao\` em ${CAMINHO_ROTAS}: mundo LEGADO, e o sentido 1 `
        + "prova que o diálogo mostra o texto neutro, com o botão habilitado, e que a confirmação funciona.",
    };
  }
  if (ocorrencias === 1) {
    return {
      serve: true, ocorrencias,
      motivo: "a árvore da base declara a rota exatamente uma vez: mundo ATUAL, e o sentido 1 prova que a base responde o "
        + "contrato 1 e que o diálogo mostra a prévia em vez de tratá-la como servidor antigo.",
    };
  }
  throw new Error(
    `a assinatura da rota da prévia apareceu ${ocorrencias} vezes em ${CAMINHO_ROTAS} — esperado 0 (base anterior à `
    + "VENDAS-A5-1) ou 1 (base posterior). Número diferente significa detector quebrado: a declaração foi duplicada, "
    + "movida ou reescrita. Escolher um ramo aqui seria decidir às cegas, então o gate REPROVA.");
}
