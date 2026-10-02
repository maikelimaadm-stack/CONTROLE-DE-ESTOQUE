import { expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * O QUE O WEB DA BASE FAZ, LIDO DO FONTE DO COMMIT — para o sentido 2 do skew escolher o ramo de cada caso.
 *
 * Mora fora de `skew-web-anterior.spec.ts` para que a PROVA REVERSA dos detectores (commits fixos, sem navegador) corra
 * num spec próprio, fora do modo serial daquele arquivo: lá, uma prova que reprovasse ao buscar um commit pularia todos
 * os casos com navegador declarados depois dela. A prova é `visual-ux-04b-skew-web-anterior.spec.ts`.
 *
 * Toda leitura REPROVA quando não consegue ler: `git grep` sai 1 sem ocorrência, e qualquer outra saída (commit
 * ausente, árvore quebrada) é erro — supor o ramo fácil seria certificar o que não se mediu.
 */
const RAIZ = path.resolve(__dirname, "../../..");

/** A base desta execução — gravada por `scripts/api-anterior.mjs` ao montar a árvore, provada pelo caso IDENTIDADE. */
export function shaDaBase(): string {
  const sha = fs.readFileSync(path.join(RAIZ, ".api-anterior.base"), "utf8").trim();
  expect(sha, "`.api-anterior.base` é gravado por scripts/api-anterior.mjs ao montar a árvore").toMatch(/^[0-9a-f]{40}$/);
  return sha;
}

/**
 * O commit tem de estar no clone ANTES de o detector ler o fonte dele. O checkout do job `skew` do CI é RASO
 * (`actions/checkout` sem `fetch-depth`: só o commit do checkout; a base entra por `scripts/api-anterior.mjs`, com
 * `--depth=1`), e um `git grep` contra um SHA ausente sai com erro — que um detector descuidado leria como "não tem a
 * grafia", escolhendo um mundo em silêncio. Ausente: busca SÓ aquele commit, como o `api-anterior.mjs` faz com a base
 * (`--depth=1` apenas em clone raso, para não encurtar um clone completo). Ainda ausente: REPROVA com o motivo.
 */
export function garantirCommit(sha: string): void {
  const presente = () => {
    try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: RAIZ, stdio: "pipe" }); return true; } catch { return false; }
  };
  if (presente()) return;
  const raso = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: RAIZ, encoding: "utf8" }).trim() === "true";
  try { execFileSync("git", ["fetch", "--quiet", ...(raso ? ["--depth=1"] : []), "origin", sha], { cwd: RAIZ, stdio: "pipe" }); } catch { /* o motivo vai na falha abaixo */ }
  if (!presente()) {
    throw new Error(`o commit ${sha} não está neste clone${raso ? " (raso)" : ""} e \`git fetch origin ${sha}\` não o trouxe: `
      + "o detector não decide mundo sobre um fonte que não consegue ler.");
  }
}

/** O fonte do web (`apps/web/src`) no commit `sha` contém `trecho`? Erro de leitura REPROVA — nunca vira "não contém". */
function fonteDoWebContem(sha: string, trecho: string): boolean {
  garantirCommit(sha);
  try {
    execFileSync("git", ["grep", "-qF", trecho, sha, "--", "apps/web/src"], { cwd: RAIZ, stdio: "pipe" });
    return true;
  } catch (erro) {
    if ((erro as { status?: number | null }).status === 1) return false;   // 1 = nenhuma ocorrência; o resto é erro
    throw erro;
  }
}

/**
 * A pílula de pendências tem duas grafias no fonte do web: a literal da VISUAL-UX-02 (na Central de Vendas) e a do
 * motor da Central desde a VISUAL-UX-04 (`PendenciasDoDocumento` em `features/central/barra.tsx`), que monta o testid
 * com o prefixo da Central (`central-vendas` na de Vendas). Qualquer uma das duas é o mundo em que o Salvar não se
 * desabilita por pendência.
 */
export const PILULA_LITERAL = "data-testid=\"central-vendas-pendencias\"";
export const PILULA_DO_MOTOR = "data-testid={`${prefixoTestid}-pendencias`}";
const GRAFIAS_DA_PENDENCIA: readonly string[] = [PILULA_LITERAL, PILULA_DO_MOTOR];

/** Quais grafias da pílula o fonte do web contém no commit `sha`. */
export function grafiasDaPendencia(sha: string): string[] {
  return GRAFIAS_DA_PENDENCIA.filter((grafia) => fonteDoWebContem(sha, grafia));
}

/**
 * O web da base mostra pendência no CLIQUE do Salvar (VISUAL-UX-02, decisão 270) em vez de desabilitá-lo? Lido do
 * fonte do commit — por padrão a base desta execução; a prova reversa passa commits fixos.
 */
export function pendenciaNoClique(sha: string = shaDaBase()): boolean {
  return grafiasDaPendencia(sha).length > 0;
}

/**
 * Commits FIXOS da main, por mundo da pílula: um sem ela e dois em cada grafia — o merge que a trouxe e um merge
 * posterior no mesmo mundo, para a prova não depender de UM commit por grafia. Nenhum é a base desta execução: ela
 * muda a cada PR e só exercitaria o ramo dela.
 */
export const COMMITS_DA_PILULA = {
  /** #77 — o pai do commit que introduziu o literal (`git log -S'data-testid="central-vendas-pendencias"' -- apps/web/src`, o mais antigo, `~1`). */
  semPilula: "93497b1f5e0b6fc4c9a036ecbe436d8d45395269",
  /** #79 — a VISUAL-UX-02 na main: só o literal. */
  literal: "4fbcdf4fd2c8cc63087bc493f4f6f218372a21de",
  /** #84 — a VISUAL-UX-03 na main: ainda só o literal (`features/sales/central-vendas-barra.tsx:119` nesse commit). */
  literalNa84: "8f95ed5ab4a062fc767ccc4883cf2e92c4ef26c7",
  /** #87 — a VISUAL-UX-04 na main: só o motor. */
  motor: "1303de3384c726859a5560d04d5d6ae5241cd38e",
  /**
   * #88 — a TOP-CONFIG-08 na main: ainda só o motor (`features/central/barra.tsx:99` nesse commit). Foi a base do skew
   * da #89 (VISUAL-UX-04b); o mesmo SHA de `COMMITS_DO_EDITOR_DA_TOP.formato4`.
   */
  motorNa88: "57b30e2833ee058d7099656cf0d17e811843717f"
} as const;

/**
 * O editor de TOP do web da base grava o FORMATO 4 (TOP-CONFIG-08, decisão 277) quando o servidor declara o bloco
 * `regrasGerais`? Lido do fonte do commit pela mesma marca que o K-2 da TOP-CONFIG-08 mede (o diálogo das regras
 * gerais, `top-regras-passam-a-valer`), e não pelo comportamento: a API deste HEAD declara o bloco nos dois mundos.
 */
export function editorDaBaseGravaFormato4(sha: string = shaDaBase()): boolean {
  return fonteDoWebContem(sha, "top-regras-passam-a-valer");
}

/** Dois commits FIXOS da main, um por mundo do editor de TOP. */
export const COMMITS_DO_EDITOR_DA_TOP = {
  /** #87 — a main antes da TOP-CONFIG-08: o editor grava o formato 3. */
  semFormato4: "1303de3384c726859a5560d04d5d6ae5241cd38e",
  /** #88 — a TOP-CONFIG-08 na main: o editor grava o formato 4. */
  formato4: "57b30e2833ee058d7099656cf0d17e811843717f",
  /** OPERACOES-01 F4 (PR #90, o commit da fase na branch, mesclado por merge): o editor grava o formato 5. */
  formato5: "0d1c882dbb71338c242a987b4fb8a9f1ff68bc55"
} as const;

/**
 * O editor de TOP do web da base grava o FORMATO 5 (OPERACOES-01 F4, decisão 281) quando o servidor declara o bloco
 * `formato5`? Lido do fonte do commit pela marca do ASSISTENTE (`top-assistente`, o testId fixo do passo 1 da criação,
 * que só existe no editor do 5), e não pelo comportamento: a API deste HEAD declara o bloco nos dois mundos.
 *
 * PROVA REVERSA: o lado FALSO é provado com `COMMITS_DO_EDITOR_DA_TOP.formato4` (a TOP-CONFIG-08 na main, o editor do 4)
 * no K-2 do 5 (`top-formato5-skew-web-anterior.spec.ts`), ao lado da marca do 4 no MESMO commit — a prova de que o
 * detector lê o fonte. O lado VERDADEIRO é provado com `COMMITS_DO_EDITOR_DA_TOP.formato5` (o commit da F4 na branch da
 * PR #90, que entra na main por merge e continua alcançável por SHA), com a marca do 4 presente no mesmo commit.
 */
export function editorDaBaseGravaFormato5(sha: string = shaDaBase()): boolean {
  return fonteDoWebContem(sha, "top-assistente");
}
