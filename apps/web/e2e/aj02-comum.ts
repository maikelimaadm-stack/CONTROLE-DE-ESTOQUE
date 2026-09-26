import { expect, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { api } from "./helpers";

/**
 * CADASTROS AJUSTES 02 — apoio comum dos E2E aj02-*. API e banco REAIS; SÓ `/api/consultas/*` é mockado.
 */
const BANCO = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
export const sql = (c: string) => execFileSync("psql", [BANCO, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();

export const painel = (page: Page) => page.locator("[data-radix-popper-content-wrapper]").last();
export const opcoes = (page: Page) => painel(page).getByRole("option");
export const ficha = (page: Page) => page.getByTestId("ficha-em-abas");
export const aba = (page: Page, nome: string) => ficha(page).getByRole("tab", { name: nome, exact: true });
export const editar = async (page: Page) => { const b = page.getByRole("button", { name: "Editar" }); if (await b.count()) await b.first().click(); };

/** Mock do CEP (única fonte mockada): 78250-000 → Pontes e Lacerda - MT; qualquer outro → 404. Conta as chamadas. */
export async function mockCep(page: Page) {
  const chamadas: string[] = [];
  await page.route(/\/api\/consultas\/cep\//, async (route) => {
    const cep = new URL(route.request().url()).pathname.split("/").pop()!.replace(/\D/g, "");
    chamadas.push(cep);
    if (cep !== "78250000") { await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "CEP não encontrado" } }) }); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cep, logradouro: "Avenida Marechal Rondon", bairro: "Centro", complemento: "até 999", municipio: { codigoIbge: 5106752, nome: "Pontes e Lacerda", uf: "MT" }, fonte: "viacep", consultadoEm: "2026-09-25T10:00:00.000Z" }) });
  });
  return chamadas;
}

/** O que o usuário VÊ numa parte: `value` se for caixa de entrada, senão o texto (a busca pode ser um botão). */
export const textoVisto = (l: Locator) => l.evaluate((e) => (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement ? e.value : (e.textContent ?? "")).trim());
/** Parte travada: disabled, readonly ou aria-disabled/aria-readonly no próprio elemento. */
export const estaTravada = (l: Locator) => l.evaluate((e) =>
  e.hasAttribute("disabled") || e.hasAttribute("readonly") || e.getAttribute("aria-disabled") === "true" || e.getAttribute("aria-readonly") === "true");

/** Referência dividida: a busca mostra SÓ o nome (nunca o código); o código em caixa própria, só leitura. */
export async function conferirPartes(busca: Locator, codigo: Locator, nome: string, cod: string) {
  await expect.poll(() => textoVisto(busca), { message: `busca mostra "${nome}"` }).toContain(nome);
  await expect.poll(() => textoVisto(codigo), { message: `código "${cod}" em caixa própria` }).toBe(cod);
  const vista = await textoVisto(busca);
  expect(vista, "a busca NUNCA mostra o código").not.toContain(cod);
  expect(vista.replace(/\D/g, ""), "nem os dígitos do código").not.toContain(cod.replace(/\D/g, ""));
  expect(await estaTravada(codigo), "a caixa do código é só leitura").toBe(true);
}

/**
 * Sequência ORDENADA dos rótulos (<label>) visíveis de um contêiner, ignorando os que estão dentro de um `excluir`
 * que fica DENTRO do contêiner (ex.: a grade de cartões na mesma aba do bloco principal). " *" de obrigatório sai.
 */
export async function rotulosEmOrdem(c: Locator, excluir = "[data-testid^='grade-']"): Promise<string[]> {
  return c.evaluate((raiz, sel) => Array.from(raiz.querySelectorAll("label"))
    .filter((l) => { const g = l.closest(sel); return !(g && g !== raiz && raiz.contains(g)); })
    .filter((l) => { const r = l.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((l) => (l.textContent ?? "").replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim())
    .filter((t) => t !== ""), excluir);
}

/** Bloco principal: o menor ancestral do título h3 que contém rótulos (o Card da seção). */
export const blocoPrincipal = (page: Page, titulo = "Endereço") =>
  page.getByRole("heading", { name: titulo, exact: true, level: 3 }).first().locator("xpath=ancestor::*[.//label][1]");

export const CORPO_ENDERECO = ["CEP", "Endereço", "Número", "Complemento", "Bairro", "Cidade", "Código IBGE", "UF", "Caixa postal", "Latitude", "Longitude"];

export const criarParceiro = (page: Page, extra: Record<string, unknown>) => api<{ id: string }>(page, "POST", "/api/resources/people", { is_client: true, person_type: "legal", ...extra });

/** Salva a ficha e devolve a resposta do PUT (o corpo sai na mensagem se falhar). */
export async function salvarFicha(page: Page, recurso: string, id: string) {
  const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/resources/${recurso}/${id}`);
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await resposta;
  expect(r.status(), await r.text()).toBe(200);
  return r;
}
