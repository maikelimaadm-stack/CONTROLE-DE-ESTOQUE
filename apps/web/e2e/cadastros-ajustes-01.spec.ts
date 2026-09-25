import { test, expect, type Page, type Route } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { login, logout, api, uniq } from "./helpers";

/**
 * CADASTROS — AJUSTES 01 · E2E da seção 8 (UI-1..UI-11) e da revisão R1 da #63 (UI-12..UI-21: W-1 a W-8 e as correções da verificação).
 *
 * API e banco REAIS (0026 carregada pelo seed). `/api/referencias/*` NUNCA é mockado — foi exatamente a busca
 * real, aberta sem texto, que quebrou em produção (500) sem nenhum E2E ter aberto um desses campos. A única
 * exceção é o UI-11, que simula a falha de propósito. Só `/api/consultas/*` (CEP e CNPJ, fontes externas) é
 * mockado, por `page.route`. O UI-3 ATRASA uma resposta de `/api/referencias/municipios/<código>` (`route.continue()`
 * depois de um tempo: quem responde é a API real, com o conteúdo real) para provar o descarte da resposta fora de ordem.
 */
const BANCO = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
const sql = (c: string) => execFileSync("psql", [BANCO, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();
const painel = (page: Page) => page.locator("[data-radix-popper-content-wrapper]").last();
const opcoes = (page: Page) => painel(page).getByRole("option");

/** Vigia das buscas de referência: toda resposta de /api/referencias/* registrada com status e query. */
function vigiarReferencias(page: Page) {
  const respostas: { url: string; status: number }[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/referencias/")) respostas.push({ url: r.url(), status: r.status() }); });
  return {
    respostas,
    semErro: () => expect(respostas.filter((r) => r.status >= 400), "nenhuma busca de referência pode falhar").toEqual([]),
    abriuSemTexto: (chave: string) => expect(respostas.some((r) => { const u = new URL(r.url); return u.pathname === `/api/referencias/${chave}` && !u.searchParams.get("search") && r.status === 200; }), `GET /api/referencias/${chave} SEM texto respondeu 200`).toBe(true)
  };
}

/** Abre o campo de referência pelo rótulo e espera a lista (sem digitar nada). */
async function abrirSemDigitar(page: Page, rotulo: string) {
  await page.getByLabel(rotulo, { exact: true }).click();
  await expect(opcoes(page).first(), `${rotulo}: a lista aparece sem digitar`).toBeVisible();
  expect(await opcoes(page).count()).toBeGreaterThan(3);
}

// ───────────────────────────── UI-8 ─────────────────────────────
test("UI-8 — Banco, NCM e CBO abertos SEM digitar mostram a lista (API real); \"nubank\" acha o 260", async ({ page }) => {
  const v = vigiarReferencias(page);
  await login(page);

  await page.goto("/cadastros/products/new");
  await page.getByRole("tab", { name: "Fiscal" }).click();
  await abrirSemDigitar(page, "NCM");
  v.abriuSemTexto("ncm");
  await page.keyboard.press("Escape");

  await page.goto("/cadastros/job_functions/new");
  await abrirSemDigitar(page, "CBO");
  v.abriuSemTexto("cbo");
  await page.keyboard.press("Escape");

  await page.goto("/cadastros/people/new");
  await page.getByTestId("ficha-em-abas").getByRole("tab", { name: "Financeiro" }).click();
  await abrirSemDigitar(page, "Banco");
  v.abriuSemTexto("bancos");
  await painel(page).getByLabel("Pesquisar opção").fill("nubank");
  await expect(opcoes(page).first()).toHaveText(/^260 · /);
  await opcoes(page).first().click();
  await expect(page.getByLabel("Banco", { exact: true })).toContainText("260");
  v.semErro();
});

// ───────────────────────────── UI-11 ─────────────────────────────
test("UI-11 — busca falhando (500 simulado SÓ aqui) → \"Tentar de novo\"; texto livre nunca vira valor", async ({ page }) => {
  await login(page);
  let falhas = 0; const pedidosPorCodigo: string[] = [];
  // a busca falha 2x (a tentativa + a tentativa automática do B-1); a partir daí, a API REAL responde
  await page.route(/\/api\/referencias\/bancos(\?|$)/, async (route: Route) => {
    if (falhas < 2) { falhas++; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } }) }); return; }
    await route.continue();
  });
  page.on("request", (r) => { if (/\/api\/referencias\/bancos\/[^?]/.test(r.url())) pedidosPorCodigo.push(r.url()); });
  await page.goto("/cadastros/people/new");
  await page.getByTestId("ficha-em-abas").getByRole("tab", { name: "Financeiro" }).click();
  const campo = page.getByLabel("Banco", { exact: true });
  await campo.click();
  await expect(painel(page)).toContainText("Não foi possível carregar a lista.");
  const tentar = page.getByTestId("referencia-tentar-de-novo");
  await expect(tentar).toHaveText(/Tentar de novo/);
  expect(falhas, "uma tentativa automática antes de mostrar o erro").toBe(2);
  await expect(page.getByTestId("referencia-codigo"), "a falha 500 não cai em \"digite o código\"").toHaveCount(0);
  // Tentar de novo → a API real responde
  await tentar.click();
  await expect(opcoes(page).first()).toBeVisible();
  expect(await opcoes(page).count()).toBeGreaterThan(3);
  expect(falhas).toBe(2);
  // texto livre digitado NÃO vira valor e não dispara GET por código
  await painel(page).getByLabel("Pesquisar opção").fill("meu banco");
  await page.keyboard.press("Escape");
  await expect(campo).not.toContainText("meu banco");
  await expect(campo).toContainText(/Buscar banco/i);
  expect(pedidosPorCodigo, "nenhum GET /api/referencias/bancos/<texto>").toEqual([]);
});

// ───────────────────────────── consultas externas (MOCK: só /api/consultas/*) ─────────────────────────────
function cpfValido(): string {
  const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (xs: number[]) => { const t = xs.reduce((a, x, i) => a + x * (xs.length + 1 - i), 0); const r = (t * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b); return [...b, d1, dv([...b, d1])].join("");
}
/** CNPJ válido (numérico ou alfanumérico) a partir das 12 primeiras posições (IN RFB 2.229/2024). */
function cnpjDe(base12: string): string {
  const v = (c: string) => c.charCodeAt(0) - 48;
  const dv = (t: string, p: number[]) => { const r = p.reduce((a, x, i) => a + v(t[i]!) * x, 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return `${base12}${d1}${dv(`${base12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}
const cnpjNovo = () => cnpjDe(`${Date.now().toString().slice(-8)}0001`);
const fmtCnpj = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

function respostaCnpj(cnpj: string) {
  return {
    cnpj, razaoSocial: "AGROPECUARIA PONTES LTDA", nomeFantasia: "FAZENDA PONTES",
    situacao: { descricao: "ATIVA", data: "2005-03-10", motivo: "SEM MOTIVO" }, abertura: "2005-03-10",
    naturezaJuridica: { codigo: "2062", descricao: "Sociedade Empresária Limitada" }, porte: "DEMAIS",
    cnaePrincipal: { codigo: "0151201", descricao: "Criação de bovinos para corte" }, cnaesSecundarios: [{ codigo: "0115600", descricao: "Cultivo de soja" }],
    endereco: { logradouro: "RODOVIA BR 174", numero: "KM 10", complemento: "SALA 2", bairro: "ZONA RURAL", cep: "78250000", municipio: { codigoIbge: 5106752, nome: "Pontes e Lacerda", uf: "MT" } },
    telefones: ["6532661234"], email: "contato@fazendapontes.com.br",
    simples: { optante: true, desde: "2010-01-01" }, mei: { optante: false, desde: null }, matriz: true,
    dataDaInformacao: "2026-09-20T00:00:00.000Z", fonte: "brasilapi", consultadoEm: "2026-09-25T10:00:00.000Z"
  };
}
async function mockCnpj(page: Page) {
  const chamadas: string[] = [];
  await page.route(/\/api\/consultas\/cnpj\//, async (route) => {
    const cnpj = new URL(route.request().url()).pathname.split("/").pop()!.replace(/\D/g, "");
    chamadas.push(cnpj);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(respostaCnpj(cnpj)) });
  });
  return chamadas;
}
const CEPS: Record<string, { logradouro: string; bairro: string; complemento: string | null; municipio: { codigoIbge: number; nome: string; uf: string } }> = {
  "78250000": { logradouro: "Avenida Marechal Rondon", bairro: "Centro", complemento: "até 999", municipio: { codigoIbge: 5106752, nome: "Pontes e Lacerda", uf: "MT" } },
  "78245000": { logradouro: "Rua Principal", bairro: "Centro", complemento: null, municipio: { codigoIbge: 5105507, nome: "Vila Bela da Santíssima Trindade", uf: "MT" } }
};
async function mockCep(page: Page) {
  await page.route(/\/api\/consultas\/cep\//, async (route) => {
    const cep = new URL(route.request().url()).pathname.split("/").pop()!.replace(/\D/g, "");
    const d = CEPS[cep];
    if (!d) { await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "CEP não encontrado" } }) }); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cep, ...d, fonte: "viacep", consultadoEm: "2026-09-25T10:00:00.000Z" }) });
  });
}
const ficha = (page: Page) => page.getByTestId("ficha-em-abas");
const aba = (page: Page, nome: string) => ficha(page).getByRole("tab", { name: nome, exact: true });
const cabecalho = (page: Page, campo: string) => page.getByTestId(`cabecalho-${campo}`);
/**
 * Rótulo de um campo da ficha. Campo de referência (`RefSelect`, ex.: Matriz) não liga a caixa ao rótulo — `getByLabel`
 * não o acha NUNCA, e um `toHaveCount(0)` com ele passaria vazio. O rótulo do campo existe só quando o campo aparece.
 */
const rotuloDoCampo = (page: Page, rotulo: string) => page.locator("label").filter({ hasText: new RegExp(`^${rotulo}( \\*)?$`) });
const janela = (page: Page) => page.getByTestId("janela-consulta-cnpj");

// ───────────────────────────── UI-1 ─────────────────────────────
test("UI-1 — Consultar CNPJ na barra ao lado de Anexos, habilitado em LEITURA; todos os dados; Divergências; Importar → Jurídica", async ({ page }) => {
  await login(page);
  const chamadas = await mockCnpj(page);
  const cpf = cpfValido();
  const p = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-1 parceiro"), legal_name: "NOME ANTIGO", person_type: "natural", document: cpf, is_client: true });
  await page.goto(`/cadastros/people/${p.id}?view=1`);
  await expect(ficha(page)).toBeVisible();
  const botao = page.getByTestId("ficha-consultar-cnpj");
  await expect(botao).toBeEnabled();
  await expect(page.getByTestId("ficha-anexos")).toBeVisible();
  // ao lado de Anexos: mesma barra, logo depois
  const vizinhos = await botao.evaluate((b) => { const a = document.querySelector('[data-testid="ficha-anexos"]'); return !!a && a.parentElement === b.parentElement && a.nextElementSibling === b; });
  expect(vizinhos, "Consultar CNPJ fica ao lado de Anexos, na mesma barra").toBe(true);
  await expect(ficha(page).getByRole("tab", { name: "Anexos" }), "Anexos saiu das abas").toHaveCount(0);

  await botao.click();
  await expect(janela(page)).toBeVisible();
  await expect(page.getByTestId("consulta-cnpj-campo"), "documento é CPF: o campo vem vazio").toHaveValue("");
  // CPF: sem chamada
  await page.getByTestId("consulta-cnpj-campo").fill(cpf);
  await page.getByTestId("consulta-cnpj-consultar").click();
  await expect(page.getByTestId("consulta-cnpj-erro")).toHaveText("Não existe consulta gratuita de CPF; o sistema confere os dígitos.");
  expect(chamadas).toEqual([]);
  const cnpj = cnpjNovo();
  await page.getByTestId("consulta-cnpj-campo").fill(cnpj);
  await expect(page.getByTestId("consulta-cnpj-campo")).toHaveValue(fmtCnpj(cnpj));
  await page.getByTestId("consulta-cnpj-consultar").click();
  const dados = page.getByTestId("consulta-cnpj-dados");
  for (const t of ["AGROPECUARIA PONTES LTDA", "FAZENDA PONTES", "ATIVA", "10/03/2005", "SEM MOTIVO", "2062", "Sociedade Empresária Limitada", "DEMAIS", "0151201", "Criação de bovinos para corte", "0115600", "Cultivo de soja", "RODOVIA BR 174", "KM 10", "ZONA RURAL", "5106752 · Pontes e Lacerda - MT", "contato@fazendapontes.com.br", "Optante desde 01/01/2010", "Matriz", "brasilapi"]) await expect(dados, t).toContainText(t);
  // R1 (W-1/W-8): a janela mostra o CNPJ DO RESULTADO e o CEP e os telefones formatados
  await expect(page.getByTestId("consulta-cnpj-numero")).toContainText(fmtCnpj(cnpj));
  await expect(page.getByTestId("consulta-cnpj-cep")).toContainText("78250-000");
  await expect(page.getByTestId("consulta-cnpj-telefones")).toContainText("(65) 3266-1234");
  expect(chamadas).toEqual([cnpj]);
  await janela(page).getByRole("tab", { name: /Divergências/ }).click();
  const div = page.getByTestId("divergencia-legal_name");
  await expect(div).toContainText("NOME ANTIGO"); await expect(div).toContainText("AGROPECUARIA PONTES LTDA");
  await expect(div.getByRole("checkbox")).toBeChecked();
  await page.getByTestId("consulta-cnpj-importar").click();
  await expect(janela(page)).toHaveCount(0);
  await expect(cabecalho(page, "person_type")).toContainText("Jurídica");
  await expect(page.getByLabel("Razão social", { exact: true })).toHaveValue("AGROPECUARIA PONTES LTDA");
  await expect(page.getByLabel("CPF/CNPJ", { exact: true })).toHaveValue(fmtCnpj(cnpj));
  // nada gravado sem Salvar
  const gravado = await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${p.id}`);
  expect([gravado["person_type"], gravado["document"], gravado["legal_name"]]).toEqual(["natural", cpf, "NOME ANTIGO"]);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(async () => (await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${p.id}`))["document"]).toBe(cnpj);
  const depois = await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${p.id}`);
  expect([depois["person_type"], depois["legal_name"]]).toEqual(["legal", "AGROPECUARIA PONTES LTDA"]);
});

// ───────────────────────────── UI-2 ─────────────────────────────
test("UI-2 — lista de Parceiros → Novo pelo CNPJ → Importar → parceiro NOVO preenchido → Salvar", async ({ page }) => {
  await login(page);
  await mockCnpj(page);
  const cnpj = cnpjNovo();
  await page.goto("/configuracoes?tab=parceiros");
  await page.getByTestId("parceiros-novo-pelo-cnpj").click();
  await page.getByTestId("consulta-cnpj-campo").fill(cnpj);
  await page.getByTestId("consulta-cnpj-consultar").click();
  await expect(page.getByTestId("consulta-cnpj-dados")).toContainText("AGROPECUARIA PONTES LTDA");
  await expect(janela(page).getByRole("tab", { name: /Divergências/ }), "sem cadastro não há divergências").toHaveCount(0);
  await page.getByTestId("consulta-cnpj-importar").click();
  await expect(page).toHaveURL(/\/cadastros\/people\/new/);
  await expect(page.getByLabel("Nome Social/Fantasia")).toHaveValue("FAZENDA PONTES");
  await expect(page.getByLabel("CPF/CNPJ", { exact: true })).toHaveValue(fmtCnpj(cnpj));
  await expect(cabecalho(page, "person_type")).toContainText("Jurídica");
  const antes = sql(`select count(*) from erp.people where document = '${cnpj}'`);
  expect(antes, "nada gravado antes do Salvar").toBe("0");
  await page.getByTestId("grupo-tipo-do-parceiro").getByLabel("Cliente").check();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => sql(`select count(*) from erp.people where document = '${cnpj}' and deleted_at is null`)).toBe("1");
  expect(sql(`select concat_ws('|', person_type, name, legal_name, zip_code, city_id::text) from erp.people where document = '${cnpj}'`)).toBe("legal|FAZENDA PONTES|AGROPECUARIA PONTES LTDA|78250000|5106752");
});

// ───────────────────────────── UI-3 ─────────────────────────────
test("UI-3 — Cidade: nome, CEP (1ª opção) e Código IBGE; UF só leitura (lista de municípios REAL); resposta do Código IBGE fora de ordem descartada", async ({ page }) => {
  await login(page);
  await mockCep(page);
  await page.goto("/cadastros/people/new");
  await aba(page, "Endereço").click();
  const cidade = page.getByTestId("campo-cidade").first();
  await cidade.getByTestId("cidade-busca").click();
  await painel(page).getByLabel("Pesquisar opção").fill("pontes");
  await expect(opcoes(page).filter({ hasText: "5106752 · Pontes e Lacerda - MT" })).toHaveCount(1);
  await painel(page).getByLabel("Pesquisar opção").fill("78250-000");
  await expect(opcoes(page).first()).toHaveText("CEP 78250-000 → 5106752 · Pontes e Lacerda - MT");
  await opcoes(page).first().click();
  await expect(cidade.getByTestId("cidade-ibge")).toHaveValue("5106752");
  await expect(cidade.getByTestId("cidade-uf")).toHaveValue("MT");
  await expect(cidade.getByTestId("cidade-uf")).toHaveAttribute("readonly", "");
  await cidade.getByTestId("cidade-ibge").fill("5103403");
  await expect(cidade.getByTestId("cidade-busca")).toContainText("Cuiabá - MT");
  await expect(cidade.getByTestId("cidade-uf")).toHaveValue("MT");
  await cidade.getByTestId("cidade-ibge").fill("9999999");
  await expect(cidade).toContainText("Código IBGE não encontrado.");
  await expect(cidade.getByTestId("cidade-busca"), "código inexistente não muda o valor").toContainText("Cuiabá - MT");
  // R1 (W-8): ao SAIR com código inexistente ou parcial, a caixa volta à cidade atual (o texto nunca diz outra cidade)
  await cidade.getByTestId("cidade-ibge").press("Tab");
  await expect(cidade.getByTestId("cidade-ibge"), "inexistente: volta à cidade atual ao sair").toHaveValue("5103403");
  await expect(cidade).not.toContainText("Código IBGE não encontrado.");
  await cidade.getByTestId("cidade-ibge").fill("51067");
  await cidade.getByTestId("cidade-ibge").press("Tab");
  await expect(cidade.getByTestId("cidade-ibge"), "parcial: volta à cidade atual ao sair").toHaveValue("5103403");
  await expect(cidade.getByTestId("cidade-busca")).toContainText("Cuiabá - MT");
  // R1 (W-8): resposta FORA DE ORDEM é descartada. A consulta do código A é ATRASADA (a API real responde, só depois);
  // o código B, digitado logo em seguida, responde primeiro. A cidade final é a de B — a resposta velha de A não a troca.
  const [codigoA, codigoB] = ["5106752", "5105507"]; // Pontes e Lacerda (atrasada) × Vila Bela da Santíssima Trindade
  const caminhoA = `/api/referencias/municipios/${codigoA}`;
  await page.route((u) => u.pathname === caminhoA, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  const respostaA = page.waitForResponse((r) => new URL(r.url()).pathname === caminhoA);
  await cidade.getByTestId("cidade-ibge").fill(codigoA);
  await cidade.getByTestId("cidade-ibge").fill(codigoB);
  await expect(cidade.getByTestId("cidade-busca")).toContainText("Vila Bela da Santíssima Trindade - MT");
  expect((await respostaA).status(), "premissa: a resposta atrasada de A chegou (e é a API real: 200)").toBe(200);
  await page.waitForTimeout(500);
  await expect(cidade.getByTestId("cidade-busca"), "a resposta velha de A não sobrescreve a cidade de B").toContainText("Vila Bela da Santíssima Trindade - MT");
  await expect(cidade.getByTestId("cidade-ibge")).toHaveValue(codigoB);
});

// ───────────────────────────── UI-4 ─────────────────────────────
test("UI-4 — CEP + Tab preenche Endereço, Bairro, Cidade, IBGE e UF; foco no Número; CEP de outra cidade avisa; Outros endereços também", async ({ page }) => {
  await login(page);
  await mockCep(page);
  await page.goto("/cadastros/people/new");
  await aba(page, "Endereço").click();
  // R1 (W-7): o rótulo "CEP" nomeia a CAIXA (antes apontava para um <span> e o E2E precisava de input[name])
  const cep = page.getByLabel("CEP", { exact: true });
  await expect(cep).toHaveAttribute("name", "zip_code");
  await cep.fill("78250000");
  await expect(cep).toHaveValue("78250-000");
  await cep.press("Tab");
  await expect(page.locator('input[name="address"]')).toHaveValue("Avenida Marechal Rondon");
  await expect(page.locator('input[name="district"]')).toHaveValue("Centro");
  await expect(page.locator('input[name="complemento"]'), "complemento vazio recebe o do CEP").toHaveValue("até 999");
  const cidade = page.getByTestId("campo-cidade").first();
  await expect(cidade.getByTestId("cidade-ibge")).toHaveValue("5106752");
  await expect(cidade.getByTestId("cidade-uf")).toHaveValue("MT");
  await expect(cidade.getByTestId("cidade-busca")).toContainText("Pontes e Lacerda - MT");
  await expect(page.locator('[name="address_number"]')).toBeFocused();
  // CEP de outra cidade: troca e avisa; complemento já preenchido não é sobrescrito
  await cep.fill("78245-000");
  await cep.press("Tab");
  await expect(page.getByText("CEP 78245-000 é de Vila Bela da Santíssima Trindade - MT")).toBeVisible();
  await expect(cidade.getByTestId("cidade-ibge")).toHaveValue("5105507");
  await expect(page.locator('input[name="complemento"]')).toHaveValue("até 999");
  // Outros endereços (R1, W-8): a MESMA lógica do principal — lupa no CEP da linha e foco no Número da linha
  const grade = page.getByTestId("grade-enderecos");
  await grade.getByRole("button", { name: "Incluir linha" }).click();
  const linha = page.getByTestId("linha-enderecos-1");
  await expect(linha.getByTestId("cep-lupa-linha"), "a linha tem a lupa do CEP").toBeVisible();
  await linha.getByLabel("CEP", { exact: true }).fill("78250000");
  await expect(linha.getByLabel("CEP", { exact: true })).toHaveValue("78250-000");
  await linha.getByLabel("CEP", { exact: true }).press("Tab");
  await expect(linha.getByTestId("cidade-ibge")).toHaveValue("5106752");
  // T-4: antes, uma conferência vazia (`filter({ hasText: "" })` acha qualquer input); agora o que o usuário vê
  await expect(linha.getByLabel("Endereço", { exact: true }), "o logradouro do CEP na PRÓPRIA linha").toHaveValue("Avenida Marechal Rondon");
  await expect(linha.getByLabel("Bairro", { exact: true })).toHaveValue("Centro");
  await expect(linha.getByLabel("Número", { exact: true }), "o foco vai para o Número da linha").toBeFocused();
  // a lupa da linha força a consulta do mesmo CEP (o logradouro corrigido à mão volta ao do CEP)
  await linha.getByLabel("Endereço", { exact: true }).fill("Corrigido à mão");
  await linha.getByTestId("cep-lupa-linha").click();
  await expect(linha.getByLabel("Endereço", { exact: true })).toHaveValue("Avenida Marechal Rondon");
});

// ───────────────────────────── UI-5 ─────────────────────────────
test("UI-5 — máscaras CPF, CNPJ, CNPJ alfanumérico, CEP, telefone e celular; colar com pontuação e com rótulo (\"CNPJ: …\", \"CPF …\"); grava normalizado", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/people/new");
  const doc = page.getByLabel("CPF/CNPJ", { exact: true });
  const cpf = cpfValido();
  await doc.fill(cpf);
  // R1 (W-4): o tipo só vira Física ao SAIR do campo com 11 dígitos (enquanto digita, pode ser um CNPJ incompleto)
  await doc.blur();
  await expect(doc).toHaveValue(`${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`);
  await expect(doc).toHaveAttribute("data-mascara", "cpf");
  const cnpj = cnpjNovo();
  await doc.fill(fmtCnpj(cnpj)); // colar com pontuação
  await expect(doc).toHaveValue(fmtCnpj(cnpj));
  await expect(doc).toHaveAttribute("data-mascara", "cnpj");
  // R1 (W-8): colar com o RÓTULO ("CNPJ: …", "CPF …") tira o rótulo antes de normalizar
  await doc.fill(`CNPJ: ${fmtCnpj(cnpj)}`);
  await expect(doc).toHaveValue(fmtCnpj(cnpj));
  // …e "CPF 123…": sem tirar o rótulo, as letras "CPF" + 11 dígitos viravam um CNPJ ALFANUMÉRICO de 14 posições.
  // Um CPF DIFERENTE do primeiro: a troca automática só age quando o documento de saída difere do de entrada no campo.
  const cpfColado = cpfValido();
  await doc.fill(`CPF ${cpfColado}`);
  await doc.blur(); // 11 dígitos: Física (e a máscara de CPF) só ao SAIR
  await expect(doc, "colar \"CPF …\" deixa o CPF formatado").toHaveValue(fmtCpf(cpfColado));
  await expect(doc).toHaveAttribute("data-mascara", "cpf");
  await expect(cabecalho(page, "person_type"), "o CPF colado com o rótulo é um CPF: Física").toContainText("Física");
  const alfa = cnpjDe(`${Date.now().toString(36).toUpperCase().slice(-8).padStart(8, "A")}0001`); // 8 + "0001" = as 12 posições
  await doc.fill(alfa.toLowerCase());
  await expect(doc).toHaveValue(fmtCnpj(alfa));
  // DV conferido ao sair do campo
  await doc.fill("11.222.333/0001-80"); await doc.blur();
  await expect(page.getByTestId("documento-invalido")).toHaveText("CNPJ inválido");
  await doc.fill(alfa);
  await page.getByLabel("Nome Social/Fantasia").fill(uniq("UI-5 máscaras"));
  await page.getByTestId("grupo-tipo-do-parceiro").getByLabel("Cliente").check();
  await aba(page, "Endereço").click();
  await page.getByLabel("CEP", { exact: true }).fill("78250000");
  await expect(page.getByLabel("CEP", { exact: true })).toHaveValue("78250-000");
  await aba(page, "Contatos").click();
  await page.getByLabel("Telefone", { exact: true }).fill("(65) 3333-4444");
  await page.getByLabel("Telefone", { exact: true }).blur(); // telefone: a máscara aparece AO SAIR (revisão final do R1)
  await expect(page.getByLabel("Telefone", { exact: true })).toHaveValue("(65) 3333-4444");
  await page.getByLabel("Celular", { exact: true }).fill("65999998888");
  await page.getByLabel("Celular", { exact: true }).blur();
  await expect(page.getByLabel("Celular", { exact: true })).toHaveValue("(65) 99999-8888");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => sql(`select count(*) from erp.people where document = '${alfa}'`)).toBe("1");
  expect(sql(`select concat_ws('|', document, zip_code, phone, cellphone, person_type) from erp.people where document = '${alfa}'`)).toBe(`${alfa}|78250000|6533334444|65999998888|legal`);
});

// ───────────────────────────── UI-6 ─────────────────────────────
test("UI-6 — tipo de pessoa segue o documento; campos de Física/Jurídica; Jurídica com CPF → faixa e [Ajustar para Física]", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/people/new");
  const doc = page.getByLabel("CPF/CNPJ", { exact: true });
  await doc.fill(cpfValido());
  await doc.blur(); // R1 (W-4): Física só ao SAIR do campo com 11 dígitos
  await expect(cabecalho(page, "person_type")).toContainText("Física");
  for (const r of ["RG", "CAEPF", "Sexo", "Nome completo", "Nascimento"]) await expect(page.getByLabel(r, { exact: true }), r).toBeVisible();
  await expect(rotuloDoCampo(page, "Razão social"), "premissa: o localizador acha rótulo de campo").toHaveCount(0);
  await expect(rotuloDoCampo(page, "Nome completo"), "premissa: o localizador acha rótulo de campo visível").toHaveCount(1);
  await expect(rotuloDoCampo(page, "Matriz"), "Matriz não aparece em Física").toHaveCount(0);
  for (const r of ["Razão social", "Abertura"]) await expect(page.getByLabel(r, { exact: true }), `${r} não aparece em Física`).toHaveCount(0);
  await doc.fill(cnpjNovo());
  await expect(cabecalho(page, "person_type")).toContainText("Jurídica");
  await expect(rotuloDoCampo(page, "Matriz"), "Matriz aparece em Jurídica").toBeVisible();
  for (const r of ["Razão social", "Abertura"]) await expect(page.getByLabel(r, { exact: true }), r).toBeVisible();
  for (const r of ["RG", "CAEPF", "Sexo", "Nome completo"]) await expect(page.getByLabel(r, { exact: true }), `${r} não aparece em Jurídica`).toHaveCount(0);

  // o caso da produção: parceiro JURÍDICA com CPF (dado legado)
  const cpf = cpfValido();
  const p = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-6 legado"), person_type: "natural", document: cpf, is_client: true });
  sql(`update erp.people set person_type = 'legal' where id = '${p.id}'`);
  await page.goto(`/cadastros/people/${p.id}?view=1`);
  const faixa = page.getByTestId("faixa-tipo-documento");
  await expect(faixa).toBeVisible();
  // R1 (W-8): Jurídica com CPF aparece COMO CPF (formatado), sem o "CNPJ inválido" falso
  await expect(page.getByLabel("CPF/CNPJ", { exact: true })).toHaveValue(`${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`);
  await expect(page.getByTestId("documento-invalido"), "sem recusa falsa de CNPJ").toHaveCount(0);
  await faixa.getByRole("button", { name: "Ajustar para Física" }).click();
  await expect(cabecalho(page, "person_type")).toContainText("Física");
  expect(sql(`select person_type from erp.people where id = '${p.id}'`), "só na tela até o Salvar").toBe("legal");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => sql(`select person_type from erp.people where id = '${p.id}'`)).toBe("natural");
});

// ───────────────────────────── UI-7 ─────────────────────────────
test("UI-7 — Tipo do parceiro é UM campo de marcação múltipla; marcar Fornecedor mostra a aba Fornecedor", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/people/new");
  const grupo = page.getByTestId("grupo-tipo-do-parceiro");
  await expect(grupo).toBeVisible();
  expect((await grupo.getByRole("checkbox").all()).length).toBe(5);
  for (const t of ["Cliente", "Fornecedor", "Transportadora", "Funcionário", "Proprietário"]) await expect(grupo.getByLabel(t, { exact: true })).toBeVisible();
  await expect(ficha(page).getByRole("heading", { name: "Tipos", exact: true }), "a seção antiga \"Tipos\" com 5 campos saiu").toHaveCount(0);
  await expect(aba(page, "Fornecedor")).toHaveCount(0);
  await grupo.getByLabel("Fornecedor", { exact: true }).check();
  await expect(aba(page, "Fornecedor")).toBeVisible();
  await grupo.getByLabel("Fornecedor", { exact: true }).uncheck();
  await expect(aba(page, "Fornecedor")).toHaveCount(0);
});

// ───────────────────────────── UI-9 ─────────────────────────────
test("UI-9 — Naturezas: Código travado; Novo filho mostra a prévia; Mover galho → prévia → Confirmar → códigos novos", async ({ page }) => {
  await login(page);
  const receitas = await api<{ items: { id: string; code: string }[] }>(page, "GET", "/api/resources/financial_categories?code=1&pageSize=5");
  const raiz1 = receitas.items.find((x) => x.code === "1")!;
  expect(raiz1, "premissa: RECEITAS = 1").toBeTruthy();
  const nomeDestino = uniq("UI-9 destino"); // o nome desta execução: num banco reaproveitado há destinos de rodadas anteriores
  const destino = await api<{ id: string; code: string }>(page, "POST", "/api/resources/financial_categories", { name: nomeDestino, nature: "both", kind: "synthetic" });
  const galho = await api<{ id: string; code: string }>(page, "POST", "/api/resources/financial_categories", { name: uniq("UI-9 galho"), nature: "income", kind: "synthetic", parent_id: raiz1.id });
  const folha = await api<{ id: string; code: string }>(page, "POST", "/api/resources/financial_categories", { name: uniq("UI-9 folha"), nature: "income", kind: "analytic", parent_id: galho.id });
  expect(folha.code.startsWith(`${galho.code}.`), "premissa: a folha nasce debaixo do galho").toBe(true);

  await page.goto("/cadastros/financial_categories?visao=arvore");
  const arvore = page.getByTestId("arvore-tela");
  await arvore.getByTestId("arvore-no").filter({ hasText: galho.code }).first().getByRole("button", { name: new RegExp(galho.code.replace(/\./g, "\\.")) }).click();
  // Novo filho: prévia "será gerado ao salvar: <código>" e Código só leitura
  const sugerido = await api<{ codigo: string }>(page, "GET", `/api/resources/financial_categories/proximo-codigo?parent_id=${galho.id}`);
  await page.getByRole("button", { name: "Novo filho" }).click();
  await expect(page.getByTestId("arvore-codigo-previsto")).toHaveText(`Código: será gerado ao salvar: ${sugerido.codigo}`);
  const codigo = page.getByRole("region", { name: "Ficha" }).getByLabel(/^Código/);
  if (await codigo.count()) await expect(codigo.first(), "Código não é digitável").not.toBeEditable();
  await page.getByRole("region", { name: "Ficha" }).getByRole("button", { name: "Cancelar" }).click().catch(() => undefined);

  // Mover o GALHO (com filho) para o destino
  await page.goto("/cadastros/financial_categories?visao=arvore");
  await arvore.getByTestId("arvore-no").filter({ hasText: galho.code }).first().getByRole("button", { name: new RegExp(galho.code.replace(/\./g, "\\.")) }).click();
  await page.getByTestId("arvore-mover").click();
  const dialogo = page.getByTestId("mover-dialogo");
  await dialogo.locator("button").first().click();
  await page.getByPlaceholder("Pesquisar...").fill(nomeDestino);
  await page.locator("[data-radix-popper-content-wrapper]").last().getByRole("option", { name: new RegExp(nomeDestino) }).click();
  const previa = page.getByTestId("mover-previa");
  await expect(previa).toBeVisible();
  const linhas = previa.getByTestId("mover-previa-linha");
  await expect(linhas).toHaveCount(2);
  const novoGalho = `${destino.code}.01`;
  await expect(linhas.nth(0)).toContainText(galho.code);
  await expect(linhas.nth(0)).toContainText(novoGalho);
  await expect(linhas.nth(1)).toContainText(folha.code);
  await expect(linhas.nth(1)).toContainText(`${novoGalho}${folha.code.slice(galho.code.length)}`);
  await page.getByTestId("mover-confirmar").click();
  await expect(page.getByTestId("mover-dialogo")).toHaveCount(0);
  const g = await api<{ code: string; parent_id: string }>(page, "GET", `/api/resources/financial_categories/${galho.id}`);
  const f = await api<{ code: string; parent_id: string }>(page, "GET", `/api/resources/financial_categories/${folha.id}`);
  expect([g.code, g.parent_id]).toEqual([novoGalho, destino.id]);
  expect([f.code, f.parent_id]).toEqual([`${novoGalho}${folha.code.slice(galho.code.length)}`, galho.id]);
});

// ───────────────────────────── UI-10 ─────────────────────────────
test("UI-10 — Parametrizações › Numeração: zerar cadastro vazio → próximo 1; com registros → botão desabilitado com motivo", async ({ page }) => {
  await login(page);
  // Pátios esvaziado (exclusão lógica: a linha e o histórico ficam); nenhum outro spec depende de Pátio
  const org = sql("select o.id from erp.organizations o join erp.organization_members m on m.organization_id=o.id join erp.users u on u.id=m.user_id where u.email='admin@demo.local' limit 1");
  sql(`update erp.feedlot_yards set deleted_at = now() where organization_id = '${org}' and deleted_at is null`);
  const excluidos = Number(sql(`select count(*) from erp.feedlot_yards where organization_id = '${org}' and deleted_at is not null and code is not null and code not like 'EXC-%'`));
  // atalho na lista VAZIA
  await page.goto("/cadastros/feedlot_yards");
  if (excluidos > 0) await expect(page.getByTestId("numeracao-atalho")).toBeVisible();

  await page.goto("/admin/parametros");
  const secao = page.getByTestId("numeracao-cadastros");
  await expect(secao).toBeVisible();
  const patios = secao.getByTestId("numeracao-feedlot_yards");
  await expect(patios.getByTestId("numeracao-registros")).toHaveText("0");
  await patios.getByTestId("numeracao-zerar").click();
  await expect(page.getByTestId("numeracao-confirmacao")).toHaveText(`A numeração de Pátios volta para 1. ${excluidos} ${excluidos === 1 ? "registro excluído terá" : "registros excluídos terão"} o código liberado (ficam como EXC-…). Continuar?`);
  await page.getByTestId("numeracao-confirmar").click();
  await expect.poll(async () => Number((await patios.getByTestId("numeracao-proximo").innerText()).trim())).toBe(1);
  expect(sql(`select count(*) from erp.feedlot_yards where organization_id = '${org}' and deleted_at is not null and code not like 'EXC-%'`), "excluídos liberados").toBe("0");
  // com registros: desabilitado com o motivo
  const naturezas = secao.getByTestId("numeracao-financial_categories");
  await expect(naturezas.getByTestId("numeracao-zerar")).toBeDisabled();
  await expect(naturezas.getByTestId("numeracao-motivo")).toContainText(/Há \d+ registros em Naturezas/);
});

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * REVISÃO R1 DA #63 — os testes das correções da tela (W-1 a W-8). Mesmo harness: API e banco reais; só
 * `/api/consultas/*` mockado (aqui com ATRASO controlado, para provar o descarte de resposta velha).
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */
let sequenciaCnpj = 0;
/** CNPJ válido e DISTINTO a cada chamada (o `cnpjNovo` repete dentro do mesmo milissegundo). */
const cnpjSeq = () => cnpjDe(`${Date.now().toString().slice(-6)}${String(++sequenciaCnpj % 100).padStart(2, "0")}0001`);
const fmtCpf = (c: string) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
/** Mock do CNPJ com atraso por CNPJ e razão social que identifica a resposta ("RAZAO <cnpj>"). */
async function mockCnpjComAtraso(page: Page) {
  const atrasos = new Map<string, number>(); const chamadas: string[] = [];
  await page.route(/\/api\/consultas\/cnpj\//, async (route) => {
    const cnpj = new URL(route.request().url()).pathname.split("/").pop()!.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    chamadas.push(cnpj);
    const ms = atrasos.get(cnpj) ?? 0;
    if (ms) await new Promise((r) => setTimeout(r, ms));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...respostaCnpj(cnpj), razaoSocial: `RAZAO ${cnpj}` }) }).catch(() => undefined);
  });
  return { atrasos, chamadas };
}
/** Mock do CEP que CONTA as chamadas (W-2: "nenhuma chamada") e aceita atraso por CEP (W-8: grade pela chave). */
async function mockCepContando(page: Page) {
  const atrasos = new Map<string, number>(); const chamadas: string[] = [];
  await page.route(/\/api\/consultas\/cep\//, async (route) => {
    const cep = new URL(route.request().url()).pathname.split("/").pop()!.replace(/\D/g, "");
    chamadas.push(cep);
    const ms = atrasos.get(cep) ?? 0;
    if (ms) await new Promise((r) => setTimeout(r, ms));
    const d = CEPS[cep];
    if (!d) { await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "CEP não encontrado" } }) }).catch(() => undefined); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cep, ...d, fonte: "viacep", consultadoEm: "2026-09-25T10:00:00.000Z" }) }).catch(() => undefined);
  });
  return { atrasos, chamadas };
}
/** Escolhe uma opção num seletor da ficha (MgSelect: a caixa tem o id do rótulo). */
async function escolherOpcao(page: Page, rotulo: string, opcao: string) {
  await page.getByLabel(rotulo, { exact: true }).click();
  await page.locator("[data-radix-popper-content-wrapper]").last().getByRole("option", { name: opcao, exact: true }).click();
}
const editar = async (page: Page) => { const b = page.getByRole("button", { name: "Editar" }); if (await b.count()) await b.first().click(); };
/** O X de limpar de um seletor da ficha (MgSelect/RefSelect: irmão da caixa ligada ao rótulo). */
const limparDoSeletor = (page: Page, rotulo: string) => page.getByLabel(rotulo, { exact: true }).locator("..").getByRole("button", { name: "Limpar" });

// ───────────────────────────── UI-12 (W-1) ─────────────────────────────
test("UI-12 (W-1) — Consultar CNPJ: editar a caixa limpa resultado, divergências, erro e Importar; resposta atrasada ou chegada depois de fechar é descartada; Enter não reconsulta durante \"Consultando…\"", async ({ page }) => {
  await login(page);
  const { atrasos, chamadas } = await mockCnpjComAtraso(page);
  const p = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-12 parceiro"), legal_name: "RAZAO ANTIGA", person_type: "legal", is_client: true });
  await page.goto(`/cadastros/people/${p.id}?view=1`);
  await expect(ficha(page)).toBeVisible();
  await page.getByTestId("ficha-consultar-cnpj").click();
  const caixa = page.getByTestId("consulta-cnpj-campo"); const consultar = page.getByTestId("consulta-cnpj-consultar");
  const dados = page.getByTestId("consulta-cnpj-dados"); const importar = page.getByTestId("consulta-cnpj-importar");
  const [a, b, c, d] = [cnpjSeq(), cnpjSeq(), cnpjSeq(), cnpjSeq()];
  expect(new Set([a, b, c, d]).size, "premissa: quatro CNPJs distintos").toBe(4);

  // (1) consulta A: o resultado mostra o CNPJ de A e oferece Importar
  await caixa.fill(a); await consultar.click();
  await expect(dados).toContainText(`RAZAO ${a}`);
  await expect(page.getByTestId("consulta-cnpj-numero")).toContainText(fmtCnpj(a));
  await expect(importar).toBeVisible();
  await expect(janela(page).getByRole("tab", { name: /Divergências/ })).toBeVisible();
  // (2) editar a caixa para B: resultado, divergências e Importar de A somem (Importar nunca leva os dados de A)
  await caixa.fill(b);
  await expect(dados, "o resultado era de OUTRO CNPJ").toHaveCount(0);
  await expect(importar, "sem resultado do CNPJ da caixa, sem Importar").toHaveCount(0);
  await expect(janela(page).getByRole("tab", { name: /Divergências/ })).toHaveCount(0);
  // o erro também é do CNPJ anterior: some ao editar
  await caixa.fill("11.222.333/0001-80"); await consultar.click();
  await expect(page.getByTestId("consulta-cnpj-erro")).toHaveText("CNPJ inválido");
  await caixa.fill(b);
  await expect(page.getByTestId("consulta-cnpj-erro")).toHaveCount(0);

  // (3) B demora; Enter durante "Consultando…" não dispara outra consulta
  atrasos.set(b, 2500);
  await consultar.click();
  await expect(consultar).toHaveText("Consultando…");
  await caixa.press("Enter"); await caixa.press("Enter");
  expect(chamadas.filter((x) => x === b), "uma consulta só de B").toHaveLength(1);
  // (4) troca para C (rápido) e consulta: vale C; a resposta atrasada de B chega DEPOIS e é descartada
  await caixa.fill(c); await consultar.click();
  await expect(dados).toContainText(`RAZAO ${c}`);
  await page.waitForTimeout(3000);
  await expect(dados, "a resposta velha de B não substitui a de C").toContainText(`RAZAO ${c}`);
  await expect(dados).not.toContainText(`RAZAO ${b}`);
  await expect(page.getByTestId("consulta-cnpj-numero")).toContainText(fmtCnpj(c));
  expect(chamadas.filter((x) => x === b), "B foi de fato respondida (a premissa do descarte)").toHaveLength(1);

  // (5) resposta que chega DEPOIS de fechar a janela não aparece na janela reaberta
  atrasos.set(d, 2500);
  await caixa.fill(d); await consultar.click();
  await expect(consultar).toHaveText("Consultando…");
  await page.keyboard.press("Escape");
  await expect(janela(page)).toHaveCount(0);
  await page.getByTestId("ficha-consultar-cnpj").click();
  await expect(janela(page)).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(dados, "a resposta de D chegou com a janela fechada: descartada").toHaveCount(0);
  await expect(importar).toHaveCount(0);

  // (6) Importar leva o resultado do CNPJ DA CAIXA
  await caixa.fill(c); await consultar.click();
  await expect(dados).toContainText(`RAZAO ${c}`);
  await importar.click();
  await expect(janela(page)).toHaveCount(0);
  await expect(page.getByLabel("CPF/CNPJ", { exact: true })).toHaveValue(fmtCnpj(c));
  await expect(page.getByLabel("Razão social", { exact: true })).toHaveValue(`RAZAO ${c}`);
});

// ───────────────────────────── UI-13 (W-2) ─────────────────────────────
test("UI-13 (W-2) — CEP só é consultado quando MUDA: Tab por CEP gravado não chama nem sobrescreve; em LEITURA nunca chama; a lupa força (só em edição)", async ({ page }) => {
  await login(page);
  const { chamadas } = await mockCepContando(page);
  const p = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-13 parceiro"), person_type: "legal", is_client: true,
    zip_code: "78250000", address: "Rua corrigida à mão", district: "Bairro corrigido", city_id: 5106752,
    enderecos: [{ tipo: "entrega", cep: "78245000", logradouro: "Rua da grade à mão", bairro: "Bairro da grade" }] });
  const cepPrincipal = page.getByLabel("CEP", { exact: true }).and(page.locator("[name=zip_code]"));
  const linha = page.getByTestId("linha-enderecos-1");
  const esperarSemChamada = async (porque: string) => { await page.waitForTimeout(700); expect(chamadas, porque).toEqual([]); };

  // LEITURA: sair de uma célula de CEP (principal ou da grade) nunca chama a API, e não há lupa
  await page.goto(`/cadastros/people/${p.id}?view=1`);
  await aba(page, "Endereço").click();
  await expect(cepPrincipal).toHaveValue("78250-000");
  await cepPrincipal.focus(); await cepPrincipal.press("Tab");
  await linha.getByLabel("CEP", { exact: true }).focus(); await linha.getByLabel("CEP", { exact: true }).press("Tab");
  await esperarSemChamada("em leitura, nenhuma consulta de CEP");
  await expect(page.getByTestId("cep-lupa"), "sem lupa em leitura").toHaveCount(0);
  await expect(page.getByTestId("cep-lupa-linha")).toHaveCount(0);

  // EDIÇÃO: Tab pelo CEP gravado (sem mudar) não chama e não sobrescreve o endereço corrigido à mão
  await editar(page);
  await aba(page, "Endereço").click();
  await cepPrincipal.focus(); await cepPrincipal.press("Tab");
  await linha.getByLabel("CEP", { exact: true }).focus(); await linha.getByLabel("CEP", { exact: true }).press("Tab");
  await esperarSemChamada("CEP que não mudou não é consultado");
  await expect(page.locator('input[name="address"]')).toHaveValue("Rua corrigida à mão");
  await expect(linha.getByLabel("Endereço", { exact: true })).toHaveValue("Rua da grade à mão");
  // a lupa FORÇA a consulta do mesmo CEP (só em edição)
  await page.getByTestId("cep-lupa").click();
  await expect(page.locator('input[name="address"]')).toHaveValue("Avenida Marechal Rondon");
  expect(chamadas).toEqual(["78250000"]);
  // CEP que MUDOU: Tab consulta
  await cepPrincipal.fill("78245-000"); await cepPrincipal.press("Tab");
  await expect(page.locator('input[name="address"]')).toHaveValue("Rua Principal");
  expect(chamadas).toEqual(["78250000", "78245000"]);
  // nada foi gravado pela consulta (só o Salvar grava)
  expect(sql(`select concat_ws('|', zip_code, address) from erp.people where id = '${p.id}'`)).toBe("78250000|Rua corrigida à mão");
});

// ───────────────────────────── UI-14 (W-3) ─────────────────────────────
test("UI-14 (W-3) — trocar o tipo de pessoa pergunta antes de apagar campos preenchidos (lista-os); Cancelar mantém tipo e valores; na janela do CNPJ, junto das Divergências; na troca AUTOMÁTICA pelo documento, só ao SAIR do campo", async ({ page }) => {
  await login(page);
  const dialogo = page.getByTestId("confirmar-troca-de-tipo");
  // (a) pelo SELETOR, num parceiro novo
  await page.goto("/cadastros/people/new");
  const doc = page.getByLabel("CPF/CNPJ", { exact: true });
  await doc.fill(cpfValido()); await doc.blur();
  await expect(cabecalho(page, "person_type")).toContainText("Física");
  await page.getByLabel("RG", { exact: true }).fill("1234567");
  await escolherOpcao(page, "Sexo", "Feminino");
  // o tipo nunca fica vazio (coluna NOT NULL): o seletor do Tipo de pessoa não tem o X de limpar (o vizinho opcional tem)
  await expect(limparDoSeletor(page, "Sexo"), "premissa: um seletor opcional preenchido mostra o X").toHaveCount(1);
  await expect(limparDoSeletor(page, "Tipo de pessoa"), "o Tipo de pessoa não se limpa (Novo)").toHaveCount(0);
  await escolherOpcao(page, "Tipo de pessoa", "Jurídica");
  await expect(dialogo).toHaveText("Ao mudar para Jurídica, serão apagados: RG, Sexo.");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(cabecalho(page, "person_type"), "Cancelar mantém o tipo").toContainText("Física");
  await expect(page.getByLabel("RG", { exact: true }), "e os valores").toHaveValue("1234567");
  await escolherOpcao(page, "Tipo de pessoa", "Jurídica");
  await page.getByRole("button", { name: "Mudar para Jurídica" }).click();
  await expect(cabecalho(page, "person_type")).toContainText("Jurídica");
  await expect(page.getByLabel("RG", { exact: true })).toHaveCount(0);

  // (b) pela JANELA do CNPJ (Importar torna o parceiro Jurídica): a lista aparece junto das Divergências
  await mockCnpj(page);
  const cpf = cpfValido();
  const f = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-14 física"), person_type: "natural", document: cpf, is_client: true, rg: "7654321", caepf: "12345678901234", sexo: "M" });
  await page.goto(`/cadastros/people/${f.id}?view=1`);
  await expect(ficha(page)).toBeVisible();
  const cnpj = cnpjSeq();
  const consultarNaJanela = async () => {
    await page.getByTestId("ficha-consultar-cnpj").click();
    await page.getByTestId("consulta-cnpj-campo").fill(cnpj); await page.getByTestId("consulta-cnpj-consultar").click();
    await expect(page.getByTestId("consulta-cnpj-dados")).toContainText("AGROPECUARIA PONTES LTDA");
  };
  await consultarNaJanela();
  await janela(page).getByRole("tab", { name: /Divergências/ }).click();
  await expect(page.getByTestId("consulta-cnpj-campos-apagados")).toHaveText("Ao mudar para Jurídica, serão apagados: RG, CAEPF, Sexo.");
  await page.getByTestId("consulta-cnpj-importar").click();
  await expect(dialogo).toHaveText("Ao mudar para Jurídica, serão apagados: RG, CAEPF, Sexo.");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(janela(page), "Cancelar não importa").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cabecalho(page, "person_type"), "nada mudou na ficha").toContainText("Física");
  await expect(page.getByLabel("RG", { exact: true })).toHaveValue("7654321");
  // confirmando: importa, vira Jurídica, e o Salvar grava os três vazios
  await consultarNaJanela();
  await page.getByTestId("consulta-cnpj-importar").click();
  // a confirmação é outra janela (portal), com o mesmo rótulo do Importar
  await page.locator('[role="dialog"], [role="alertdialog"]').filter({ has: dialogo }).getByRole("button", { name: "Importar para o cadastro" }).click();
  await expect(janela(page)).toHaveCount(0);
  await expect(cabecalho(page, "person_type")).toContainText("Jurídica");
  expect(sql(`select concat_ws('|', person_type, rg, caepf, sexo) from erp.people where id = '${f.id}'`), "nada gravado sem Salvar").toBe("natural|7654321|12345678901234|M");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => sql(`select person_type from erp.people where id = '${f.id}'`)).toBe("legal");
  expect(sql(`select concat_ws('|', coalesce(rg, 'nulo'), coalesce(caepf, 'nulo'), coalesce(sexo, 'nulo'), document) from erp.people where id = '${f.id}'`)).toBe(`nulo|nulo|nulo|${cnpj}`);

  // (c) pela troca AUTOMÁTICA (o tipo segue o documento — R1, W-3/W-4): enquanto DIGITA um CNPJ, nada pergunta e nada
  // muda (nem o tipo, nem os valores); ao SAIR do campo, pergunta listando os campos preenchidos. Cancelar mantém Física
  // e os valores; sair de novo com o MESMO documento não pergunta outra vez; outro documento pergunta de novo, e
  // Confirmar troca o tipo — o Salvar grava os campos vazios.
  const auto = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-14 automática"), person_type: "natural", document: cpfValido(), is_client: true, rg: "1112223", sexo: "F" });
  await page.goto(`/cadastros/people/${auto.id}`);
  await editar(page);
  await expect(page.getByRole("button", { name: "Salvar" }), "premissa: em edição").toBeVisible();
  await expect(cabecalho(page, "person_type")).toContainText("Física");
  const rg = page.getByLabel("RG", { exact: true });
  await expect(rg, "premissa: o RG gravado aparece").toHaveValue("1112223");
  // vigia do DOM durante a digitação: qualquer instante com a pergunta aberta ou o tipo já trocado fica registrado
  await page.evaluate(() => {
    const w = window as unknown as { __troca: string[] };
    w.__troca = [];
    const olhar = () => {
      if (document.querySelector('[data-testid="confirmar-troca-de-tipo"]')) w.__troca.push("pergunta aberta");
      const c = document.querySelector('[data-testid="cabecalho-person_type"]')?.textContent ?? "";
      if (!/Física/.test(c)) w.__troca.push(`cabeçalho: ${c}`);
      const r = document.querySelector<HTMLInputElement>('input[name="rg"]');
      if (!r || r.value !== "1112223") w.__troca.push(`RG: ${r ? r.value : "sumiu"}`);
    };
    new MutationObserver(olhar).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const vistosNaDigitacao = () => page.evaluate(() => (window as unknown as { __troca: string[] }).__troca);
  await expect(page.locator('input[name="rg"]'), "premissa: o vigia acha a caixa do RG").toHaveCount(1);
  const documento = page.getByLabel("CPF/CNPJ", { exact: true });
  const cnpjDigitado = cnpjSeq();
  await documento.click();
  await documento.fill("");
  await documento.pressSequentially(cnpjDigitado, { delay: 30 });
  await expect(documento, "a máscara deixa digitar o CNPJ inteiro").toHaveValue(fmtCnpj(cnpjDigitado));
  expect(await vistosNaDigitacao(), "enquanto digita: nenhuma pergunta, o tipo e os valores ficam como estão").toEqual([]);
  await expect(dialogo).toHaveCount(0);
  await expect(cabecalho(page, "person_type")).toContainText("Física");
  await expect(rg).toHaveValue("1112223");
  // ao SAIR do campo: a pergunta, listando só os campos PREENCHIDOS que sumiriam (o CAEPF vazio não entra)
  await documento.blur();
  await expect(dialogo).toHaveText("Ao mudar para Jurídica, serão apagados: RG, Sexo.");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(cabecalho(page, "person_type"), "Cancelar mantém Física").toContainText("Física");
  await expect(rg, "e os valores").toHaveValue("1112223");
  // sair de novo com o MESMO documento não pergunta outra vez
  await documento.focus(); await documento.blur();
  await page.waitForTimeout(500);
  await expect(dialogo, "o mesmo documento, já recusado, não pergunta de novo").toHaveCount(0);
  await expect(cabecalho(page, "person_type")).toContainText("Física");
  // OUTRO documento pergunta de novo; Confirmar troca o tipo e apaga os campos — nada gravado até o Salvar
  const cnpjConfirmado = cnpjSeq();
  await documento.fill(fmtCnpj(cnpjConfirmado));
  await documento.blur();
  await expect(dialogo).toHaveText("Ao mudar para Jurídica, serão apagados: RG, Sexo.");
  await page.getByRole("button", { name: "Mudar para Jurídica" }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(cabecalho(page, "person_type")).toContainText("Jurídica");
  await expect(rg).toHaveCount(0);
  expect(sql(`select concat_ws('|', person_type, rg, sexo) from erp.people where id = '${auto.id}'`), "nada gravado sem Salvar").toBe("natural|1112223|F");
  const salvo = await salvarFicha(page, auto.id);
  const corpo = salvo.request().postDataJSON() as Record<string, unknown>;
  expect({ person_type: corpo["person_type"], rg: corpo["rg"], sexo: corpo["sexo"] }, "o PUT leva o tipo novo e os campos apagados como null").toEqual({ person_type: "legal", rg: null, sexo: null });
  expect(sql(`select concat_ws('|', person_type, coalesce(rg, 'nulo'), coalesce(sexo, 'nulo'), document) from erp.people where id = '${auto.id}'`)).toBe(`legal|nulo|nulo|${cnpjConfirmado}`);
});

// ───────────────────────────── UI-15 (W-4) ─────────────────────────────
test("UI-15 (W-4) — digitar um CNPJ tecla a tecla nunca passa por Física (nem máscara de CPF, nem RG); Física só ao SAIR com 11 dígitos", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/people/new");
  await expect(cabecalho(page, "person_type")).toContainText("Jurídica");
  // vigia do DOM: qualquer instante em que a tela mostre Física (cabeçalho, rótulo RG ou máscara de CPF) fica registrado
  await page.evaluate(() => {
    const w = window as unknown as { __fisica: string[] };
    w.__fisica = [];
    const olhar = () => {
      const c = document.querySelector('[data-testid="cabecalho-person_type"]')?.textContent ?? "";
      if (/Física/.test(c)) w.__fisica.push(`cabeçalho: ${c}`);
      if ([...document.querySelectorAll("label")].some((l) => /^RG( \*)?$/.test((l.textContent ?? "").trim()))) w.__fisica.push("rótulo RG");
      const doc = document.querySelector<HTMLInputElement>('input[data-mascara]');
      if (doc?.getAttribute("data-mascara") === "cpf") w.__fisica.push(`máscara de CPF em ${doc.value}`);
    };
    new MutationObserver(olhar).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const vistos = () => page.evaluate(() => (window as unknown as { __fisica: string[] }).__fisica);
  const doc = page.getByLabel("CPF/CNPJ", { exact: true });
  const cnpj = cnpjSeq();
  await doc.click();
  await doc.pressSequentially(cnpj, { delay: 40 });
  await expect(doc, "a máscara nunca atrapalha continuar digitando até 14").toHaveValue(fmtCnpj(cnpj));
  expect(await vistos(), "nenhum instante de Física durante a digitação").toEqual([]);
  await expect(cabecalho(page, "person_type")).toContainText("Jurídica");
  // 11 dígitos: enquanto o campo tem o foco, continua Jurídica; ao SAIR, Física
  const cpf = cpfValido();
  await doc.fill("");
  await doc.pressSequentially(cpf, { delay: 30 });
  expect(await vistos(), "11 dígitos ainda digitando: não é Física").toEqual([]);
  await expect(cabecalho(page, "person_type")).toContainText("Jurídica");
  await doc.blur();
  await expect(cabecalho(page, "person_type")).toContainText("Física");
  await expect(doc).toHaveAttribute("data-mascara", "cpf");
  await expect(doc).toHaveValue(fmtCpf(cpf));
});

test("UI-15b (W-4) — a digitação vira Jurídica e o documento VOLTA ao CPF de entrada: ao sair é Física de novo; só passar pelo campo não troca o tipo", async ({ page }) => {
  await login(page);
  const cpf = cpfValido();
  const p = await criarParceiro(page, { name: uniq("UI-15b volta"), person_type: "natural", document: cpf });
  await page.goto(`/cadastros/people/${p.id}`);
  await editar(page);
  await expect(page.getByRole("button", { name: "Salvar" }), "premissa: em edição").toBeVisible();
  await expect(cabecalho(page, "person_type"), "premissa: gravado como Física").toContainText("Física");
  const doc = page.getByLabel("CPF/CNPJ", { exact: true });
  // só passar pelo campo (entrar e sair sem mudar nada) não mexe no cadastro
  await doc.focus();
  await doc.blur();
  await expect(cabecalho(page, "person_type")).toContainText("Física");
  // entrar, digitar até CNPJ (vira Jurídica AINDA digitando — nada a apagar) e apagar de volta ao CPF de entrada
  await doc.focus();
  await doc.press("End");
  await doc.pressSequentially("123", { delay: 40 });
  await expect(cabecalho(page, "person_type"), "premissa: 14 posições em digitação → Jurídica").toContainText("Jurídica");
  for (let i = 0; i < 3; i++) await doc.press("Backspace");
  expect((await doc.inputValue()).replace(/\D/g, ""), "premissa: o documento voltou ao CPF de entrada").toBe(cpf);
  await doc.blur();
  await expect(cabecalho(page, "person_type"), "saiu com 11 dígitos: Física, mesmo com o documento igual ao de entrada").toContainText("Física");
  await expect(doc).toHaveAttribute("data-mascara", "cpf");
  await expect(doc).toHaveValue(fmtCpf(cpf));
  await expect(page.getByTestId("faixa-tipo-documento"), "sem a faixa de tipo divergente (Jurídica com CPF)").toHaveCount(0);
});

// ───────────────────────────── UI-16 (W-5) ─────────────────────────────
test("UI-16 (W-5) — Novo pelo CNPJ leva os dados EM MEMÓRIA: nada da Receita no sessionStorage/localStorage; consumido uma vez", async ({ page }) => {
  await login(page);
  await mockCnpj(page);
  const cnpj = cnpjSeq();
  await page.goto("/configuracoes?tab=parceiros");
  await page.getByTestId("parceiros-novo-pelo-cnpj").click();
  await page.getByTestId("consulta-cnpj-campo").fill(cnpj);
  await page.getByTestId("consulta-cnpj-consultar").click();
  await expect(page.getByTestId("consulta-cnpj-dados")).toContainText("AGROPECUARIA PONTES LTDA");
  await page.getByTestId("consulta-cnpj-importar").click();
  await expect(page).toHaveURL(/\/cadastros\/people\/new/);
  await expect(page.getByLabel("Nome Social/Fantasia")).toHaveValue("FAZENDA PONTES");
  const armazenado = await page.evaluate(() => {
    const tudo: string[] = [];
    for (const s of [window.localStorage, window.sessionStorage]) for (let i = 0; i < s.length; i++) { const k = s.key(i)!; tudo.push(`${k}=${s.getItem(k) ?? ""}`); }
    return tudo.join("\n");
  });
  // a asserção compara PRESENÇA, nunca imprime o armazenamento: ele guarda a sessão (token), que não vai para log algum
  expect(armazenado.includes("agro.session"), "premissa: a leitura do armazenamento funciona (a sessão mora lá)").toBe(true);
  const achados = [cnpj, fmtCnpj(cnpj), "AGROPECUARIA", "FAZENDA PONTES", "RODOVIA BR 174", "contato@fazendapontes", "importacaoCnpj"].filter((t) => armazenado.includes(t));
  expect(achados, "nada da Receita no navegador (sessionStorage/localStorage)").toEqual([]);
  // consumido UMA vez: recarregar o parceiro novo não traz os dados de novo
  await page.reload();
  await expect(page.getByLabel("CPF/CNPJ", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Nome Social/Fantasia")).toHaveValue("");
});

// ───────────────────────────── UI-17 (W-6) ─────────────────────────────
test("UI-17 (W-6) — telefone nunca corta dígito: \"+55 (65) 99999-8888\" grava 65999998888; o legado com ramal fica como digitado", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/people/new");
  const nome = uniq("UI-17 telefones");
  await page.getByLabel("Nome Social/Fantasia").fill(nome);
  await page.getByTestId("grupo-tipo-do-parceiro").getByLabel("Cliente").check();
  await aba(page, "Contatos").click();
  const tel = page.getByLabel("Telefone", { exact: true }); const cel = page.getByLabel("Celular", { exact: true });
  await tel.fill("+55 (65) 99999-8888");
  await tel.blur(); // telefone: a máscara aparece AO SAIR (revisão final do R1)
  await expect(tel).toHaveValue("(65) 99999-8888");
  await cel.fill("(65) 3266-1234 r.22");
  await cel.blur();
  await expect(cel, "passou de 11 dígitos sem o 55: como digitado, sem máscara e sem cortar").toHaveValue("(65) 3266-1234 r.22");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => sql(`select count(*) from erp.people where name = '${nome}' and deleted_at is null`)).toBe("1");
  expect(sql(`select concat_ws('|', phone, cellphone) from erp.people where name = '${nome}'`)).toBe("65999998888|(65) 3266-1234 r.22");
});

test("UI-17b (W-6, revisão final) — telefone digitado TECLA A TECLA: enquanto se digita, a caixa mostra o texto digitado; ao sair, a máscara (até 11 dígitos) ou o texto como digitado — nenhum separador comido; DDD 55 entre parênteses não perde o DDD", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/people/new");
  const nome = uniq("UI-17b telefones");
  await page.getByLabel("Nome Social/Fantasia").fill(nome);
  await page.getByTestId("grupo-tipo-do-parceiro").getByLabel("Cliente").check();
  await aba(page, "Contatos").click();
  const tel = page.getByLabel("Telefone", { exact: true }); const cel = page.getByLabel("Celular", { exact: true });
  const doisNumeros = "(65) 3266-1234 / (65) 3266-5678";
  await cel.click();
  await cel.pressSequentially(doisNumeros, { delay: 25 });
  await expect(cel, "enquanto se digita: o texto digitado, sem remascarar").toHaveValue(doisNumeros);
  await cel.blur();
  await expect(cel, "ao sair, mais de 11 dígitos: como digitado").toHaveValue(doisNumeros);
  const rs = "(55) 3222-1234 r.22";
  await tel.click();
  await tel.pressSequentially(rs, { delay: 25 });
  await tel.blur();
  await expect(tel, "DDD 55 escrito com ramal: nada some").toHaveValue(rs);
  const contato = page.getByLabel("Telefone do contato", { exact: true });
  await contato.click();
  await contato.pressSequentially("65999998888", { delay: 25 });
  await expect(contato, "enquanto se digita: só os dígitos digitados").toHaveValue("65999998888");
  await contato.blur();
  await expect(contato, "11 dígitos: ao sair, a máscara de celular").toHaveValue("(65) 99999-8888");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => sql(`select count(*) from erp.people where name = '${nome}' and deleted_at is null`)).toBe("1");
  expect(sql(`select concat_ws('|', phone, cellphone, contact_phone) from erp.people where name = '${nome}'`), "gravado como digitado (e os 11 dígitos normalizados)").toBe(`${rs}|${doisNumeros}|65999998888`);
});

// ───────────────────────────── UI-18 (W-8) ─────────────────────────────
const criarParceiro = (page: Page, extra: Record<string, unknown>) => api<{ id: string }>(page, "POST", "/api/resources/people", { is_client: true, person_type: "legal", ...extra });
/** Salva a ficha e devolve a resposta do PUT (o status sai na mensagem se falhar). */
async function salvarFicha(page: Page, id: string) {
  const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/resources/people/${id}`);
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await resposta;
  expect(r.status(), await r.text()).toBe(200);
  return r;
}

test("UI-18a (W-8) — Matriz: a busca só oferece Jurídica ATIVA que não é filial, nunca o próprio registro", async ({ page }) => {
  await login(page);
  const prefixo = uniq("UI18M");
  const matriz = await criarParceiro(page, { name: `${prefixo} jurídica` });
  await criarParceiro(page, { name: `${prefixo} física`, person_type: "natural" });
  await criarParceiro(page, { name: `${prefixo} filial`, matriz_id: matriz.id });
  const inativa = await criarParceiro(page, { name: `${prefixo} inativa` });
  sql(`update erp.people set is_active = false where id = '${inativa.id}'`);
  const proprio = await criarParceiro(page, { name: `${prefixo} próprio` });
  await page.goto(`/cadastros/people/${proprio.id}`);
  await editar(page);
  await page.getByLabel("Matriz", { exact: true }).click();
  const lista = page.locator("[data-radix-popper-content-wrapper]").last();
  await lista.getByPlaceholder(/Pesquisar/).fill(prefixo);
  await expect(lista.getByRole("option"), "só a Jurídica ativa sem matriz; nem Física, nem filial, nem inativa, nem ele mesmo").toHaveText([new RegExp(`${prefixo} jurídica`)]);
  await lista.getByRole("option").first().click();
  await salvarFicha(page, proprio.id);
  expect(sql(`select matriz_id from erp.people where id = '${proprio.id}'`)).toBe(matriz.id);
});

test("UI-18b (W-8) — latitude e longitude esvaziadas na ficha gravam null (antes, o vazio numérico ficava fora do corpo e o valor antigo ficava)", async ({ page }) => {
  await login(page);
  const p = await criarParceiro(page, { name: uniq("UI-18b coordenadas"), latitude: "-15.2", longitude: "-59.3" });
  await page.goto(`/cadastros/people/${p.id}`);
  await editar(page);
  await aba(page, "Endereço").click();
  await expect(page.getByLabel("Latitude", { exact: true }), "premissa: o valor gravado aparece").toHaveValue(/^-15[.,]2/);
  await page.getByLabel("Latitude", { exact: true }).fill("");
  await page.getByLabel("Longitude", { exact: true }).fill("");
  const r = await salvarFicha(page, p.id);
  const enviado = r.request().postDataJSON() as Record<string, unknown>;
  expect([enviado["latitude"], enviado["longitude"]], "o par vai null no corpo").toEqual([null, null]);
  expect(sql(`select concat_ws('|', coalesce(latitude::text, 'nulo'), coalesce(longitude::text, 'nulo')) from erp.people where id = '${p.id}'`)).toBe("nulo|nulo");
});

test("UI-18c (W-8) — grade de endereços: o preenchimento pelo CEP grava pela CHAVE da linha — excluir a linha durante a consulta não escreve na vizinha", async ({ page }) => {
  await login(page);
  const { atrasos, chamadas } = await mockCepContando(page);
  atrasos.set("78250000", 1500);
  const p = await criarParceiro(page, { name: uniq("UI-18c grade") });
  await page.goto(`/cadastros/people/${p.id}`);
  await editar(page);
  await aba(page, "Endereço").click();
  const grade = page.getByTestId("grade-enderecos");
  await grade.getByRole("button", { name: "Incluir linha" }).click();
  await grade.getByRole("button", { name: "Incluir linha" }).click();
  await page.getByTestId("linha-enderecos-2").getByLabel("Endereço", { exact: true }).fill("Linha que fica");
  const primeira = page.getByTestId("linha-enderecos-1");
  await primeira.getByLabel("CEP", { exact: true }).fill("78250000");
  await primeira.getByLabel("CEP", { exact: true }).press("Tab");
  await expect.poll(() => chamadas.length, { message: "premissa: a consulta da 1ª linha saiu" }).toBe(1);
  await grade.getByRole("button", { name: "Remover linha 1" }).click();
  await expect(page.getByTestId("linha-enderecos-2")).toHaveCount(0);
  await page.waitForTimeout(2200); // a resposta atrasada chega aqui
  await expect(page.getByTestId("linha-enderecos-1").getByLabel("Endereço", { exact: true }), "a resposta da linha excluída não caiu na vizinha").toHaveValue("Linha que fica");
  await expect(page.getByTestId("linha-enderecos-1").getByLabel("Bairro", { exact: true })).toHaveValue("");
});

test("UI-18d (W-8) — Filiais do fornecedor com máscara de CPF/CNPJ e de CEP; grava normalizado", async ({ page }) => {
  await login(page);
  const p = await criarParceiro(page, { name: uniq("UI-18d fornecedor"), is_provider: true });
  await page.goto(`/cadastros/people/${p.id}`);
  await editar(page);
  await aba(page, "Fornecedor").click();
  const filiais = page.getByTestId("grade-filiais");
  await filiais.getByRole("button", { name: "Incluir linha" }).click();
  const filial = page.getByTestId("linha-filiais-1");
  const cnpj = cnpjSeq();
  await filial.getByLabel("Nome", { exact: true }).fill("Filial UI-18d");
  await filial.getByLabel("CPF/CNPJ", { exact: true }).fill(cnpj);
  await expect(filial.getByLabel("CPF/CNPJ", { exact: true })).toHaveValue(fmtCnpj(cnpj));
  const cpf = cpfValido();
  await filial.getByLabel("CPF/CNPJ", { exact: true }).fill(cpf);
  await expect(filial.getByLabel("CPF/CNPJ", { exact: true }), "até 11 posições, CPF").toHaveValue(fmtCpf(cpf));
  await filial.getByLabel("CPF/CNPJ", { exact: true }).fill(cnpj);
  await filial.getByLabel("CEP", { exact: true }).fill("78250000");
  await expect(filial.getByLabel("CEP", { exact: true })).toHaveValue("78250-000");
  await salvarFicha(page, p.id);
  expect(sql(`select concat_ws('|', document, zip_code) from erp.provider_branches where person_id = '${p.id}'`), "a filial grava normalizado").toBe(`${cnpj}|78250000`);
});

test("UI-18e (W-8) — \"Tipo do parceiro\" respeita a trava de layout: a opção travada não muda na ficha e não vai no PUT; as vizinhas continuam editáveis", async ({ page }) => {
  await login(page);
  // a trava do PRÓPRIO usuário, gravada pela API real de preferências (a mesma que a Configuração de layout grava) e
  // desfeita no fim — o `finally` não deixa a trava vazar para os outros testes do mesmo usuário
  const preferencia = "/api/preferences/people/form";
  await api(page, "PUT", `${preferencia}?scope=user`, { preferences: { lockedFieldIds: ["is_provider"] } });
  try {
    const salva = await api<{ user: { preferences: { lockedFieldIds?: string[] } } | null }>(page, "GET", preferencia);
    expect(salva.user?.preferences.lockedFieldIds, "premissa: a API gravou a trava do Fornecedor").toEqual(["is_provider"]);
    const p = await criarParceiro(page, { name: uniq("UI-18e trava"), is_provider: true });
    await page.goto(`/cadastros/people/${p.id}`);
    await editar(page);
    await expect(page.getByRole("button", { name: "Salvar" }), "premissa: em edição").toBeVisible();
    const grupo = page.getByTestId("grupo-tipo-do-parceiro");
    const fornecedor = grupo.getByLabel("Fornecedor", { exact: true });
    const transportadora = grupo.getByLabel("Transportadora", { exact: true });
    await expect(fornecedor, "premissa: o valor gravado aparece").toBeChecked();
    await expect(fornecedor, "a opção travada pelo layout não muda na ficha").toBeDisabled();
    await expect(transportadora, "a vizinha sem trava continua editável").toBeEnabled();
    await fornecedor.click({ force: true }); // clicar na caixa travada não a muda
    await expect(fornecedor).toBeChecked();
    await transportadora.check();
    const r = await salvarFicha(page, p.id);
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    expect("is_provider" in corpo, "a opção travada fica FORA do PUT").toBe(false);
    expect(corpo["is_transporter"], "a vizinha editável vai no PUT").toBe(true);
    expect(sql(`select concat_ws('|', is_provider, is_transporter) from erp.people where id = '${p.id}'`), "o Fornecedor gravado continua; a Transportadora marcada grava").toBe("t|t");
  } finally {
    await api(page, "DELETE", `${preferencia}?scope=user`, {});
  }
});

// ───────────────────────────── UI-19 (W-8) ─────────────────────────────
test("UI-19 (W-8) — árvore com código gerado: o Superior de um registro gravado fica travado no formulário, com a ajuda do Mover; no Novo continua escolhível", async ({ page }) => {
  await login(page);
  const receitas = await api<{ items: { id: string; code: string }[] }>(page, "GET", "/api/resources/financial_categories?code=1.01&pageSize=5");
  const reg = receitas.items.find((x) => x.code === "1.01")!;
  expect(reg, "premissa: 1.01 do seed").toBeTruthy();
  const rotulo = page.locator("label", { hasText: /^Natureza superior/ });
  const caixa = rotulo.locator("..").getByRole("combobox");
  await page.goto(`/cadastros/financial_categories/${reg.id}`);
  await editar(page);
  await expect(page.getByRole("button", { name: "Salvar" }), "premissa: em edição").toBeVisible();
  await expect(rotulo, "a ajuda diz o caminho").toHaveAttribute("title", "Para mudar o superior, use Mover (tela de árvore).");
  await expect(caixa, "o Superior não se muda pela edição comum").toBeDisabled();
  await expect(page.getByLabel("Descrição *", { exact: true }), "premissa: os outros campos continuam editáveis").toBeEditable();
  // no Novo o Superior continua escolhível (é dele que sai o código)
  await page.goto("/cadastros/financial_categories/new");
  await expect(caixa).toBeEnabled();
  await expect(rotulo).not.toHaveAttribute("title", "Para mudar o superior, use Mover (tela de árvore).");
});

// ───────────────────────────── UI-20 (W-8) ─────────────────────────────
test("UI-20 (W-8) — \"Ajustar para…\" só com people.edit: quem só vê o parceiro vê a faixa, mas não o botão", async ({ page }) => {
  // um perfil SÓ de leitura de Parceiros, montado no banco do e2e (o seed não tem): mesma senha do operador do seed
  const org = sql("select o.id from erp.organizations o join erp.organization_members m on m.organization_id=o.id join erp.users u on u.id=m.user_id where u.email='admin@demo.local' limit 1");
  const email = "leitor-parceiros-r1@demo.local";
  const papel = sql(`with x as (insert into erp.roles(organization_id,name,description) values ('${org}','R1 Leitor de Parceiros','só people.view') on conflict (organization_id,name) do update set description=excluded.description returning id) select id from x`);
  sql(`insert into erp.role_permissions(role_id,permission_key) select '${papel}', key from erp.permissions where key = 'people.view' on conflict do nothing`);
  const usuario = sql(`with x as (insert into erp.users(email,name,password_hash) select '${email}','Leitor R1', password_hash from erp.users where email='operador@demo.local' on conflict (email) do update set name=excluded.name returning id) select id from x`);
  sql(`insert into erp.organization_members(organization_id,user_id,role_id,is_owner) values ('${org}','${usuario}','${papel}',false) on conflict do nothing`);
  expect(sql(`select string_agg(permission_key, ',') from erp.role_permissions where role_id='${papel}'`), "premissa: o perfil só vê Parceiros").toBe("people.view");
  // o caso da produção: Jurídica com CPF (dado legado) — a faixa aparece para quem vê
  await login(page);
  const cpf = cpfValido();
  const p = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-20 legado"), person_type: "natural", document: cpf, is_client: true });
  sql(`update erp.people set person_type = 'legal' where id = '${p.id}'`);
  await page.goto(`/cadastros/people/${p.id}?view=1`);
  await expect(page.getByTestId("faixa-tipo-documento").getByRole("button", { name: "Ajustar para Física" }), "premissa: com a edição, o botão existe").toBeVisible();
  await logout(page);
  await login(page, { email, password: "Demo@12345" });
  await page.goto(`/cadastros/people/${p.id}?view=1`);
  await expect(page.getByTestId("faixa-tipo-documento"), "quem vê o parceiro vê a faixa").toBeVisible();
  await expect(page.getByTestId("faixa-tipo-documento").getByRole("button", { name: /Ajustar para/ }), "mas não ajusta sem people.edit").toHaveCount(0);
});

test("UI-21f (W-8, revisão final) — em LEITURA, focar o CPF/CNPJ de uma Jurídica com CPF (para copiar) não troca a máscara nem esconde a faixa", async ({ page }) => {
  await login(page);
  const cpf = cpfValido();
  const p = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-21f leitura"), person_type: "natural", document: cpf, is_client: true });
  sql(`update erp.people set person_type = 'legal' where id = '${p.id}'`);
  await page.goto(`/cadastros/people/${p.id}?view=1`);
  await expect(page.getByRole("button", { name: "Salvar" }), "premissa: em LEITURA").toHaveCount(0);
  const doc = page.getByLabel("CPF/CNPJ", { exact: true });
  await expect(page.getByTestId("faixa-tipo-documento"), "premissa: a faixa da Jurídica com CPF").toBeVisible();
  await expect(doc, "premissa: CPF mostrado como CPF").toHaveAttribute("data-mascara", "cpf");
  await doc.focus(); // em leitura o foco chega pelo teclado (Tab): o clique cai no invólucro do campo
  await expect(doc, "premissa: a caixa tem o foco").toBeFocused();
  await expect(doc, "com o foco em leitura: continua CPF").toHaveAttribute("data-mascara", "cpf");
  await expect(doc).toHaveValue(fmtCpf(cpf));
  await expect(page.getByTestId("faixa-tipo-documento"), "e a faixa continua").toBeVisible();
  await expect(cabecalho(page, "document"), "o cabeçalho também").toContainText(fmtCpf(cpf));
});

// ───────────────────────────── UI-21 (W-4/W-8 — correções da verificação do W) ─────────────────────────────
test("UI-21a (W-8) — Produto: apagar o Valor de referência (NOT NULL DEFAULT 0) NÃO manda null: o campo fica fora do PUT, salva e o valor gravado continua", async ({ page }) => {
  await login(page);
  const unidades = await api<{ id: string; label: string }[]>(page, "GET", "/api/resources/measurement_units/options");
  const un = unidades.find((u) => u.label.toUpperCase() === "UN")!;
  const grupos = await api<{ id: string }[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const naturezas = await api<{ id: string }[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  const p = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: uniq("UI-21a produto"), group_id: grupos[0]!.id, measurement_id: un.id, financial_category_id: naturezas[0]!.id, reference_price: "10.00" });
  expect(sql(`select reference_price::text from erp.products where id = '${p.id}'`), "premissa: o valor gravado").toBe("10.00");
  await page.goto(`/cadastros/products/${p.id}`);
  await editar(page);
  await aba(page, "Custos e venda").click();
  const campo = page.getByLabel("Valor de referência", { exact: true });
  await expect(campo, "premissa: o valor gravado aparece").not.toHaveValue("");
  await campo.fill("");
  const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/resources/products/${p.id}`);
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await resposta;
  expect(r.status(), await r.text()).toBe(200);
  expect(Object.keys(r.request().postDataJSON() as Record<string, unknown>), "numérico esvaziado SEM a marca fica fora do corpo").not.toContain("reference_price");
  await expect(page.getByText("Salvo com sucesso")).toBeVisible();
  expect(sql(`select reference_price::text from erp.products where id = '${p.id}'`), "o valor gravado continua").toBe("10.00");
});

test("UI-21b (W-8) — Parceiro: apagar SÓ a Latitude → a API recusa o par pela metade NO CAMPO (\"Informe latitude e longitude juntas (ou nenhuma).\"); nada muda", async ({ page }) => {
  await login(page);
  const p = await criarParceiro(page, { name: uniq("UI-21b coordenadas"), latitude: "-15.2", longitude: "-59.3" });
  await page.goto(`/cadastros/people/${p.id}`);
  await editar(page);
  await aba(page, "Endereço").click();
  await expect(page.getByLabel("Latitude", { exact: true }), "premissa: o valor gravado aparece").toHaveValue(/^-15[.,]2/);
  await page.getByLabel("Latitude", { exact: true }).fill("");
  const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/resources/people/${p.id}`);
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await resposta;
  expect(r.status(), await r.text()).toBe(422);
  const enviado = r.request().postDataJSON() as Record<string, unknown>;
  expect(enviado["latitude"], "a latitude esvaziada vai null").toBeNull();
  expect(enviado["longitude"], "a longitude, intacta, vai com o valor").not.toBeNull();
  expect((await r.json() as { error: { details: { path: string; message: string }[] } }).error.details, "a recusa é da regra do Parceiro, com o campo (não o CHECK genérico do banco)").toContainEqual(expect.objectContaining({ path: "latitude", message: "Informe latitude e longitude juntas (ou nenhuma)." }));
  await expect(page.getByText("Informe latitude e longitude juntas (ou nenhuma).", { exact: true }), "a recusa aparece no campo").toBeVisible();
  expect(sql(`select (latitude = -15.2 and longitude = -59.3)::text from erp.people where id = '${p.id}'`), "nada mudou").toBe("true");
});

test("UI-21e (W-8) — erro do banco com `details` OBJETO (409 de duplicidade) aparece na tela; antes o onError quebrava no `.filter` e o Salvar parecia não fazer nada", async ({ page }) => {
  await login(page);
  const existente = uniq("UI-21e tipo");
  await api(page, "POST", "/api/resources/title_types", { name: existente });
  const outro = await api<{ id: string }>(page, "POST", "/api/resources/title_types", { name: uniq("UI-21e outro") });
  await page.goto(`/cadastros/title_types/${outro.id}`);
  await editar(page);
  await page.getByLabel(/^Nome/).fill(existente);
  const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/resources/title_types/${outro.id}`);
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await resposta;
  expect(r.status(), await r.text()).toBe(409);
  const erro = (await r.json() as { error: { message: string; details: unknown } }).error;
  expect([erro.message, Array.isArray(erro.details)], "premissa: details é objeto (constraint), não lista de campos").toEqual(["Registro duplicado", false]);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Registro duplicado" }), "a recusa aparece").toBeVisible();
  expect(sql(`select count(*)::text from erp.title_types where name = '${existente}'`), "nada gravado").toBe("1");
});

test("UI-21c (W-4/W-8) — cabeçalho da ficha de Funcionários: documento fora de 11/14 posições aparece como gravado (a máscara pelo tipo de pessoa é só da caixa do Parceiro)", async ({ page }) => {
  await login(page);
  const doc = `AB${Date.now().toString().slice(-6)}`;
  const f = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-21c estrangeiro"), person_type: "foreign", document: doc, is_employee: true });
  expect(sql(`select document from erp.people where id = '${f.id}'`), "premissa: gravado como digitado").toBe(doc);
  await page.goto(`/cadastros/funcionarios/${f.id}`);
  await expect(ficha(page)).toBeVisible();
  await expect(cabecalho(page, "document").locator("b"), "sem pontuação de CNPJ").toHaveText(doc);
});

test("UI-21d (W-3) — Tipo de pessoa em EDIÇÃO também sem o X de limpar (o tipo nunca fica vazio); o seletor opcional vizinho mantém o X", async ({ page }) => {
  await login(page);
  const f = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-21d física"), person_type: "natural", document: cpfValido(), is_client: true, sexo: "M" });
  await page.goto(`/cadastros/people/${f.id}`);
  await editar(page);
  await expect(page.getByRole("button", { name: "Salvar" }), "premissa: em edição").toBeVisible();
  await expect(limparDoSeletor(page, "Sexo"), "premissa: o seletor opcional preenchido mostra o X").toHaveCount(1);
  await expect(limparDoSeletor(page, "Tipo de pessoa"), "o Tipo de pessoa não se limpa (Editar)").toHaveCount(0);
});
