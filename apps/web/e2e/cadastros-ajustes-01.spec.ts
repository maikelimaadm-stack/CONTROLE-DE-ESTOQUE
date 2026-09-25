import { test, expect, type Page, type Route } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { login, api, uniq } from "./helpers";

/**
 * CADASTROS — AJUSTES 01 · E2E da seção 8 (UI-1..UI-11).
 *
 * API e banco REAIS (0026 carregada pelo seed). `/api/referencias/*` NUNCA é mockado — foi exatamente a busca
 * real, aberta sem texto, que quebrou em produção (500) sem nenhum E2E ter aberto um desses campos. A única
 * exceção é o UI-11, que simula a falha de propósito. Só `/api/consultas/*` (CEP e CNPJ, fontes externas) é
 * mockado, por `page.route`.
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
  for (const t of ["AGROPECUARIA PONTES LTDA", "FAZENDA PONTES", "ATIVA", "10/03/2005", "SEM MOTIVO", "2062", "Sociedade Empresária Limitada", "DEMAIS", "0151201", "Criação de bovinos para corte", "0115600", "Cultivo de soja", "RODOVIA BR 174", "KM 10", "ZONA RURAL", "5106752 · Pontes e Lacerda - MT", "6532661234", "contato@fazendapontes.com.br", "Optante desde 01/01/2010", "Matriz", "brasilapi"]) await expect(dados, t).toContainText(t);
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
test("UI-3 — Cidade: nome, CEP (1ª opção) e Código IBGE; UF só leitura (lista de municípios REAL)", async ({ page }) => {
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
});

// ───────────────────────────── UI-4 ─────────────────────────────
test("UI-4 — CEP + Tab preenche Endereço, Bairro, Cidade, IBGE e UF; foco no Número; CEP de outra cidade avisa; Outros endereços também", async ({ page }) => {
  await login(page);
  await mockCep(page);
  await page.goto("/cadastros/people/new");
  await aba(page, "Endereço").click();
  const cep = page.locator('input[name="zip_code"]');
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
  // Outros endereços
  const grade = page.getByTestId("grade-enderecos");
  await grade.getByRole("button", { name: "Incluir linha" }).click();
  const linha = page.getByTestId("linha-enderecos-1");
  await linha.getByLabel("CEP").fill("78250000");
  await linha.getByLabel("CEP").press("Tab");
  await expect(linha.getByTestId("cidade-ibge")).toHaveValue("5106752");
  await expect(linha.locator("input").filter({ hasText: "" }).first()).toBeVisible();
  await expect.poll(async () => (await linha.locator("input").evaluateAll((xs) => (xs as HTMLInputElement[]).map((x) => x.value))).join("|")).toContain("Avenida Marechal Rondon");
});

// ───────────────────────────── UI-5 ─────────────────────────────
test("UI-5 — máscaras CPF, CNPJ, CNPJ alfanumérico, CEP, telefone e celular; colar com pontuação; grava normalizado", async ({ page }) => {
  await login(page);
  await page.goto("/cadastros/people/new");
  const doc = page.getByLabel("CPF/CNPJ", { exact: true });
  const cpf = cpfValido();
  await doc.fill(cpf);
  await expect(doc).toHaveValue(`${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`);
  await expect(doc).toHaveAttribute("data-mascara", "cpf");
  const cnpj = cnpjNovo();
  await doc.fill(fmtCnpj(cnpj)); // colar com pontuação
  await expect(doc).toHaveValue(fmtCnpj(cnpj));
  await expect(doc).toHaveAttribute("data-mascara", "cnpj");
  const alfa = cnpjDe(`${Date.now().toString(36).toUpperCase().slice(-6).padStart(6, "A")}0001`);
  await doc.fill(alfa.toLowerCase());
  await expect(doc).toHaveValue(fmtCnpj(alfa));
  // DV conferido ao sair do campo
  await doc.fill("11.222.333/0001-80"); await doc.blur();
  await expect(page.getByTestId("documento-invalido")).toHaveText("CNPJ inválido");
  await doc.fill(alfa);
  await page.getByLabel("Nome Social/Fantasia").fill(uniq("UI-5 máscaras"));
  await page.getByTestId("grupo-tipo-do-parceiro").getByLabel("Cliente").check();
  await aba(page, "Endereço").click();
  await page.locator('input[name="zip_code"]').fill("78250000");
  await expect(page.locator('input[name="zip_code"]')).toHaveValue("78250-000");
  await aba(page, "Contatos").click();
  await page.getByLabel("Telefone", { exact: true }).fill("(65) 3333-4444");
  await expect(page.getByLabel("Telefone", { exact: true })).toHaveValue("(65) 3333-4444");
  await page.getByLabel("Celular", { exact: true }).fill("65999998888");
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
  await expect(cabecalho(page, "person_type")).toContainText("Física");
  for (const r of ["RG", "CAEPF", "Sexo", "Nome completo", "Nascimento"]) await expect(page.getByLabel(r, { exact: true }), r).toBeVisible();
  for (const r of ["Matriz", "Razão social", "Abertura"]) await expect(page.getByLabel(r, { exact: true }), `${r} não aparece em Física`).toHaveCount(0);
  await doc.fill(cnpjNovo());
  await expect(cabecalho(page, "person_type")).toContainText("Jurídica");
  for (const r of ["Matriz", "Razão social", "Abertura"]) await expect(page.getByLabel(r, { exact: true }), r).toBeVisible();
  for (const r of ["RG", "CAEPF", "Sexo", "Nome completo"]) await expect(page.getByLabel(r, { exact: true }), `${r} não aparece em Jurídica`).toHaveCount(0);

  // o caso da produção: parceiro JURÍDICA com CPF (dado legado)
  const cpf = cpfValido();
  const p = await api<{ id: string }>(page, "POST", "/api/resources/people", { name: uniq("UI-6 legado"), person_type: "natural", document: cpf, is_client: true });
  sql(`update erp.people set person_type = 'legal' where id = '${p.id}'`);
  await page.goto(`/cadastros/people/${p.id}?view=1`);
  const faixa = page.getByTestId("faixa-tipo-documento");
  await expect(faixa).toBeVisible();
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
