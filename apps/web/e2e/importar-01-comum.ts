import { expect, type Locator, type Page } from "@playwright/test";
import type { Workbook } from "exceljs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { api } from "./helpers";
import { fonteDoWebContem, garantirCommit } from "./skew-fonte-da-base";

/**
 * IMPORTAR-01 (decisão 317) — AS PEÇAS COMUNS DOS E2E DA FATIA (módulo de apoio: o nome não termina em `.spec.ts`).
 *
 * Usado por `importar-01-atualizar.spec.ts` (a tela deste HEAD com a API deste HEAD) e pelos dois sentidos do skew
 * (`importar-01-skew-api-producao.spec.ts`, `importar-01-skew-web-anterior.spec.ts`). Os seletores são os testids do
 * diálogo de importação (`features/resources/import-dialog.tsx`), o papel e o texto — nunca classe de estilo.
 */

/** `exceljs` é dependência de `@agro/api`: o spec a resolve pelo pacote da API (a MESMA versão que lê o arquivo). */
export const ExcelJS = createRequire(path.resolve(__dirname, "../../api/package.json"))("exceljs") as typeof import("exceljs");

/** A base do LOTE 1 (origin/main com a XML-02): sem a IMPORTAR-01. */
export const COMMITS_DA_IMPORTAR01 = { sem: "332918798b039a0b2cf61c9334c30644a167e532" } as const;
/** As marcas da fatia no fonte: a função do ATUALIZAR na API e o seletor da ação na tela. */
export const MARCA_DA_IMPORTAR01 = { api: "export async function atualizarPlanilha", web: "data-testid=\"importar-acao\"" } as const;
/** Marcas que JÁ existiam na base (o `modo` parcial da CADASTROS FASE 2): a prova de que o leitor lê o commit. */
export const MARCA_ANTERIOR = { api: "modo: z.enum([\"tudo\", \"parcial\"])", web: "data-testid=\"importar-parcial\"" } as const;

const RAIZ = path.resolve(__dirname, "../../..");
/** `git grep` sai 1 sem ocorrência; qualquer outra saída é erro de leitura e REPROVA — nunca vira "não contém". */
function grep(args: string[]): boolean {
  try { execFileSync("git", ["grep", "-qF", ...args], { cwd: RAIZ, stdio: "pipe" }); return true; }
  catch (erro) { if ((erro as { status?: number | null }).status === 1) return false; throw erro; }
}
/** O fonte da API (`apps/api/src`) no commit `sha` contém `trecho`? */
export function fonteDaApiContem(sha: string, trecho: string): boolean { garantirCommit(sha); return grep(["-e", trecho, sha, "--", "apps/api/src"]); }
/** O fonte DESTE HEAD (a árvore de trabalho, inclusive o que ainda não foi commitado) contém `trecho` em `pasta`? */
export const fonteDoHeadContem = (trecho: string, pasta: string) => grep(["--untracked", "-e", trecho, "--", pasta]);

export const apiTemAtualizar = (sha: string) => fonteDaApiContem(sha, MARCA_DA_IMPORTAR01.api);
export const webTemAtualizar = (sha: string) => fonteDoWebContem(sha, MARCA_DA_IMPORTAR01.web);

/**
 * Caminho SEM acento: o Chromium automatizado não dispara `change` para arquivo local com caractere fora do ASCII
 * (o mesmo motivo de `cadastros-importacao.spec.ts`).
 */
export function caminhoAscii(nome: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "importar01-e2e-")), nome);
}

/** Menu do cadastro → "Importar planilha"; só retorna com o diálogo aberto. */
export async function abrirImportacao(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Mais opções", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Importar planilha" }).click();
  const dialogo = page.getByTestId("importar-dialogo");
  await expect(dialogo).toBeVisible();
  return dialogo;
}

/** Escolhe o arquivo pelo seletor do navegador, como a pessoa. */
export async function escolherArquivo(page: Page, caminho: string) {
  const [seletor] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("importar-arquivo").click()]);
  await seletor.setFiles(caminho);
}

export async function abrirProdutos(page: Page) {
  await page.goto("/cadastros/products");
  await expect(page.locator("tbody tr").first()).toBeVisible();
}

export const titulos = (wb: Workbook) => { const t: string[] = []; wb.getWorksheet("Dados")!.getRow(1).eachCell((c) => t.push(String(c.value))); return t; };

/** O primeiro valor que o modelo oferece na aba Listas para a coluna. */
export function primeiroDaLista(wb: Workbook, chave: string): string {
  const listas = wb.getWorksheet("Listas");
  expect(listas, "o modelo traz a aba Listas").toBeTruthy();
  let c = 0; listas!.getRow(1).eachCell((x, n) => { if (String(x.value) === chave) c = n; });
  const v = c ? listas!.getRow(2).getCell(c).value : null;
  expect(v, `a aba Listas tem ao menos um valor de "${chave}"`).toBeTruthy();
  return String(v);
}

/** Planilha só com as colunas dadas (a forma do ATUALIZAR: a pessoa apaga do modelo o que não muda). */
export async function gravarPlanilha(cabecalho: string[], linhas: (string | null)[][], nome: string): Promise<string> {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Dados");
  ws.addRow(cabecalho); for (const l of linhas) ws.addRow(l);
  ws.getColumn(1).numFmt = "@";
  const caminho = caminhoAscii(nome); await wb.xlsx.writeFile(caminho);
  return caminho;
}

export type Produto = Record<string, unknown> & { id: string; code: string; description: string };

/** Produto pela porta da TELA (POST da ficha), com o grupo e a unidade de um produto do seed, sem local padrão. */
export async function criarProduto(page: Page, descricao: string): Promise<Produto> {
  const base = await api<{ items: { group_id: string; measurement_id: string }[] }>(page, "GET", "/api/resources/products?pageSize=1");
  const { group_id, measurement_id } = base.items[0]!;
  const p = await api<Produto>(page, "POST", "/api/resources/products", { description: descricao, group_id, measurement_id, control_stock: false, marca: "Marca IMP01", fabricante: "Fab IMP01" });
  expect(p.code, "o produto nasce com código").toMatch(/^\d{5}$/);
  expect(p["default_warehouse_id"] ?? null, "premissa: nasce SEM local de estoque padrão").toBeNull();
  return p;
}
export const lerProduto = (page: Page, id: string) => api<Produto>(page, "GET", `/api/resources/products/${id}`);
/** Exclusão lógica no fim do caso (a base de E2E não acumula fixture viva; nada se apaga de verdade). */
export const excluirProduto = (page: Page, id: string) => api(page, "DELETE", `/api/resources/products/${id}`, {});

/** O registro sem o que MUDA numa atualização do local (o campo, o rótulo dele e o carimbo do gatilho). */
export const semOLocal = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith("default_warehouse_id") && k !== "updated_at"));
