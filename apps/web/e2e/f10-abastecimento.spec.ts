import type { Locator, Page } from "@playwright/test";
import { configuracaoNeutraTopV5, familiaDoModuloComTop, type ConfiguracaoTipoOperacaoV5 } from "@agro/domain";
import { api, empresaAtiva, login, uniq } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, doSeed, referenciasDoSeed } from "./central-compras-fixtures";
import { contarEscritas, exigir, saldoInicial, sqlE2e, tiposDoModulo } from "./f10-comum";

/**
 * OPERACOES-01 · F10 (decisão 287) — A CENTRAL DO ABASTECIMENTO (`/frota/abastecimentos/new`), API e banco REAIS.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────────────┐
 * │ F10-A1 — com a capacidade e uma TOP PADRÃO da família (formato 5, neutra): o campo "Tipo de operação" já vem com │
 * │   ela; a grade tem UMA linha e nenhum Adicionar/Duplicar/Remover; o Local de estoque vem antes do Produto; a      │
 * │   pesquisa do produto, pelo local da linha, só mostra o que tem saldo nele ("Só com saldo neste local"); o POST  │
 * │   tem as chaves de antes MAIS `tipo_operacao_id`, um único `product_id`; "Salvo com sucesso" → a lista; no banco, │
 * │   a TOP e a versão congeladas no registro e o EQUIPAMENTO no movimento do razão.                                  │
 * │ F10-A2 — a TOP que exige o centro de resultado: a pendência com o texto da recusa do servidor e NENHUM POST;      │
 * │   informado o centro, 201.                                                                                       │
 * │ F10-A3 — sem local de estoque: o valor unitário informado vale, 201, e NENHUM movimento no razão (como antes);   │
 * │   sem TOP escolhida, o corpo leva `tipo_operacao_id: null` (a capacidade está lá; a TOP não).                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A REGRA ANTI-VACUIDADE: a capacidade é PREMISSA lida na API (`GET /api/modulos/abastecimento/operation-types`), o
 * saldo é lido no servidor, as ausências (botões da grade) são lidas depois de a grade estar montada com a linha, e o
 * "nenhum POST" é contado no fio. Os cadastros (local, produtos, TOP) nascem pela API com a exclusão lógica no fim do
 * caso (`central-compras-fixtures`); o equipamento e o centro de resultado são os do seed, pelo NOME. Os abastecimentos
 * ficam (o razão é imutável).
 */

const P = "central-abastecimento";
const PORTA = "/api/fleet/fuel-supplies";
/** As chaves do POST de ANTES (o formulário que esta Central substitui), conjunto EXATO. */
const CHAVES_DE_ANTES = ["cost_center_id", "empresa_id", "equipment_id", "harvest_id", "hour_meter", "mileage", "note", "operator_person_id", "origin", "product_id", "quantity", "supply_date", "unit_value", "warehouse_id"];
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const chaves = (o: Record<string, unknown>) => Object.keys(o).sort();

type Cadastro = { id: string; nome: string };
type Cenario = { empresa: string; tag: string; local: Cadastro; comSaldo: Cadastro; semSaldo: Cadastro; equipamento: Cadastro };

/** O cenário: um local da empresa ativa, um combustível com saldo nele (premissa lida no servidor) e outro sem saldo. */
async function cenario(page: Page): Promise<Cenario> {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const tag = `f10a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const { id: local } = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `A${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: `${tag} tanque`, type: "inputs" });
  const produto = async (sufixo: string): Promise<Cadastro> => {
    const { id } = await criarCadastro(page, "products", { description: `${tag} ${sufixo}`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id, control_stock: true });
    return { id, nome: `${tag} ${sufixo}` };
  };
  const comSaldo = await produto("diesel");
  const semSaldo = await produto("gasolina");
  await saldoInicial(page, { empresa, local, produto: comSaldo.id, quantidade: "100", custo: "6.5" });
  const saldo = (p: Cadastro) => api<{ quantity: string }>(page, "GET", `/api/stock/balances/${local}/${p.id}`).then((s) => s.quantity);
  expect(await saldo(comSaldo), "premissa: o diesel tem 100 no tanque").toBe("100.0000");
  expect(await saldo(semSaldo), "premissa: a gasolina não tem saldo no tanque").toBe("0.0000");
  const eq = await doSeed(page, "/api/resources/equipments/options?search=Trator", "Trator 4x4");
  return { empresa, tag, local: { id: local, nome: `${tag} tanque` }, comSaldo, semSaldo, equipamento: { id: eq.id, nome: "Trator 4x4" } };
}

/** A TOP da família do abastecimento, no formato 5, pela porta das fixtures (excluída no fim do caso). */
async function topDoAbastecimento(page: Page, o: { padrao: boolean; ajuste?: (c: ConfiguracaoTipoOperacaoV5) => ConfiguracaoTipoOperacaoV5 }) {
  const codigoBase = familiaDoModuloComTop("abastecimento");
  expect(codigoBase, "premissa: o registry declara a família do abastecimento").toBeTruthy();
  const configuracao = o.ajuste ? o.ajuste(configuracaoNeutraTopV5()) : configuracaoNeutraTopV5();
  const { id } = await criarTop(page, { codigo: codigoTop("f10a"), codigoBase, nome: uniq("F10 abastecimento"), configuracao, padrao: o.padrao });
  return id;
}

/** Escolhe num RefSelect (o invólucro do campo) pelo nome — o painel do Radix, o último aberto. */
async function escolherNoCampo(page: Page, campo: Locator, nome: string) {
  await campo.locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(campo, "o campo mostra a escolha").toContainText(nome);
}

/** Pesquisa na célula da linha (local ou produto) pelo nome e escolhe; devolve o painel de antes da escolha fechado. */
async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const painel = page.getByTestId(`${P}-pesquisa`);
  await expect(painel).toBeVisible();
  await painel.getByRole("combobox").fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(painel).toHaveCount(0);
  await expect(celula).toContainText(nome);
}

/** Abre a Central e só devolve depois que a pergunta da capacidade que a PRÓPRIA tela faz chegou (200). */
async function abrirCentral(page: Page) {
  const capacidade = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/modulos/abastecimento/operation-types");
  await page.goto("/frota/abastecimentos/new");
  await expect(page.getByTestId(P)).toBeVisible();
  expect((await capacidade).status(), "premissa: a tela perguntou a capacidade e a API a declarou").toBe(200);
  await expect(page.getByTestId(`${P}-linha`), "a linha única nasce com a página").toHaveCount(1);
}

/** Os títulos das colunas da grade, sem a do círculo de seleção. */
const cabecalhos = async (page: Page) => (await page.getByTestId(`${P}-grade`).locator("thead th").allInnerTexts()).map((t) => t.trim()).filter(Boolean);

test("F10-A1 — com a TOP padrão da família: o campo já vem com ela, UMA linha sem Adicionar/Duplicar/Remover, o Local antes do Produto, a pesquisa só com saldo no local, o POST de antes + tipo_operacao_id, e o equipamento no razão", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const top = await topDoAbastecimento(page, { padrao: true });

  // PREMISSA: a capacidade lida na API lista a TOP como a padrão da família
  const cap = await tiposDoModulo(page, "abastecimento");
  expect([cap.status, cap.corpo.capacidades], "premissa: a API declara a capacidade topNoModulo").toEqual([200, { topNoModulo: 1 }]);
  expect([cap.corpo.defaultId, cap.corpo.items.find((t) => t.id === top)?.isDefault], "premissa: a TOP do caso é a padrão da família").toEqual([top, true]);

  await abrirCentral(page);
  await expect(page.getByTestId(`${P}-top`), "o campo Tipo de operação já vem com a TOP padrão").toHaveValue(top);

  // A GRADE: uma linha, o Local de estoque antes do Produto, e nenhum botão que acrescente, duplique ou remova
  expect(await cabecalhos(page), "Local de estoque → Código → Produto → Estoque → Quantidade → Valor unitário → Total (Produto e Quantidade com o '*')")
    .toEqual(["Local de estoque", "Código", "Produto *", "Estoque", "Quantidade *", "Valor unitário", "Total"]);
  await page.getByTestId(`${P}-selecionar-item`).click();
  await expect(page.getByLabel("Quantidade do item 1"), "premissa: a linha está marcada (os campos dela abriram)").toBeVisible();
  for (const b of ["adicionar-item", "adicionar-vazio", "duplicar-item", "remover-item"]) {
    await expect(page.getByTestId(`${P}-${b}`), `linha única: sem ${b}`).toHaveCount(0);
  }

  await escolherNoCampo(page, page.getByTestId(`${P}-equipamento`), c.equipamento.nome);
  const linha = page.getByTestId(`${P}-linha`);
  await escolherNaCelula(page, linha.getByTestId(`${P}-armazem`), c.local.nome);

  // A PESQUISA DO PRODUTO pelo local da linha: só o que tem saldo nele (a gasolina, sem saldo, não aparece)
  await linha.getByTestId(`${P}-produto`).click();
  const painel = page.getByTestId(`${P}-pesquisa`);
  await expect(painel, "a pesquisa nova (com a capacidade da pesquisa)").toHaveAttribute("data-fonte", "pesquisa");
  await expect(page.getByTestId(`${P}-pesquisa-so-com-saldo`).locator("input"), "na saída, 'Só com saldo neste local' vem marcado").toBeChecked();
  await painel.getByRole("combobox").fill(c.tag);
  await expect(painel.getByRole("option", { name: literal(c.comSaldo.nome) }), "o diesel (com saldo) aparece").toBeVisible();
  await expect(painel.getByRole("option", { name: literal(c.semSaldo.nome) }), "a gasolina (sem saldo) não aparece").toHaveCount(0);
  await painel.getByRole("option", { name: literal(c.comSaldo.nome) }).click();
  await expect(linha.getByTestId(`${P}-produto`)).toContainText(c.comSaldo.nome);
  await page.getByLabel("Quantidade do item 1").fill("10");

  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === PORTA);
  await page.getByTestId(`${P}-salvar`).click();
  const r = await resposta;
  const corpo = r.request().postDataJSON() as Record<string, unknown>;
  expect(r.status(), "a API gravou").toBe(201);
  expect(chaves(corpo), "o corpo de antes, MAIS tipo_operacao_id (com a capacidade)").toEqual([...CHAVES_DE_ANTES, "tipo_operacao_id"].sort());
  expect([corpo["tipo_operacao_id"], corpo["product_id"], corpo["warehouse_id"], corpo["equipment_id"], corpo["quantity"]], "a TOP, UM produto, o local e o equipamento")
    .toEqual([top, c.comSaldo.id, c.local.id, c.equipamento.id, "10"]);
  const salvo = await r.json() as Record<string, unknown>;
  expect(chaves(salvo), "a resposta tem as chaves de antes").toEqual(["code", "id", "total"]);
  await expect(page.getByText("Salvo com sucesso")).toBeVisible();
  await expect(page, "depois de salvar, a lista (como antes)").toHaveURL(/\/frota\?tab=abastecimentos/);

  // NO BANCO: a TOP e a versão congeladas no registro; o movimento do razão com o EQUIPAMENTO
  const id = String(salvo["id"]);
  expect(sqlE2e(`select tipo_operacao_id::text || '|' || (tipo_operacao_versao_id is not null)::text from erp.fuel_supplies where id = '${id}'`), "a TOP e a versão gravadas").toBe(`${top}|true`);
  expect(sqlE2e(`select count(*)::text || '|' || string_agg(equipamento_id::text, ',') from erp.stock_movements where source_type = 'fuel_supplies' and source_id = '${id}'`),
    "um movimento, com o equipamento do abastecimento").toBe(`1|${c.equipamento.id}`);
});

test("F10-A2 — a TOP que exige o centro de resultado: a pendência com o texto da recusa do servidor e NENHUM POST; com o centro, 201", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const ref = await referenciasDoSeed(page);
  const top = await topDoAbastecimento(page, { padrao: true, ajuste: exigir("exigeCentroResultado") });
  const cap = await tiposDoModulo(page, "abastecimento");
  expect(cap.corpo.items.find((t) => t.id === top)?.camposExigidos, "premissa: a TOP do caso exige o centro de resultado").toEqual(["cost_center_id"]);

  await abrirCentral(page);
  await expect(page.getByTestId(`${P}-top`)).toHaveValue(top);
  await expect(page.getByTestId(`${P}-centro`), "o centro de resultado passa a ser exigido pela TOP").toHaveAttribute("data-exigido-top", "true");
  await escolherNoCampo(page, page.getByTestId(`${P}-equipamento`), c.equipamento.nome);
  const linha = page.getByTestId(`${P}-linha`);
  await escolherNaCelula(page, linha.getByTestId(`${P}-armazem`), c.local.nome);
  await escolherNaCelula(page, linha.getByTestId(`${P}-produto`), c.comSaldo.nome);
  await page.getByLabel("Quantidade do item 1").fill("2");

  const escritas = contarEscritas(page, PORTA);
  await page.getByTestId(`${P}-salvar`).click();
  const lista = page.getByTestId(`${P}-pendencias-lista`);
  await expect(lista, "o Salvar com pendência abre a lista").toBeVisible();
  await expect(lista.getByTestId(`${P}-pendencia`), "uma pendência só: a da TOP").toHaveCount(1);
  await expect(lista.locator('[data-caminho="cost_center_id"]')).toContainText("Centro de resultado é obrigatório nesta operação.");
  await expect(page.getByTestId(`${P}-pendencias`)).toHaveText(/1 pendência/);
  expect(escritas.total(), "NENHUM POST com a pendência").toBe(0);
  await page.keyboard.press("Escape");

  await escolherNoCampo(page, page.getByTestId(`${P}-centro`), ref.centro.label);
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === PORTA);
  await page.getByTestId(`${P}-salvar`).click();
  const r = await resposta;
  const corpo = r.request().postDataJSON() as Record<string, unknown>;
  expect([r.status(), corpo["cost_center_id"], corpo["tipo_operacao_id"]], "com o centro, a API grava pela TOP").toEqual([201, ref.centro.id, top]);
  expect(escritas.total(), "um POST só (o do segundo Salvar)").toBe(1);
});

test("F10-A3 — sem local de estoque: o valor unitário informado vale, 201, e NENHUM movimento no razão; sem TOP escolhida, tipo_operacao_id vai nulo", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const cap = await tiposDoModulo(page, "abastecimento");
  expect([cap.status, cap.corpo.defaultId], "premissa: a capacidade está declarada e a família não tem TOP padrão").toEqual([200, null]);

  await abrirCentral(page);
  await expect(page.getByTestId(`${P}-top`), "sem TOP padrão, o campo começa em 'Sem tipo de operação'").toHaveValue("");
  await escolherNoCampo(page, page.getByTestId(`${P}-equipamento`), c.equipamento.nome);
  const linha = page.getByTestId(`${P}-linha`);
  await escolherNaCelula(page, linha.getByTestId(`${P}-produto`), c.comSaldo.nome);
  await expect(linha.getByTestId(`${P}-armazem`), "premissa: a linha está sem local de estoque").toHaveText("—");
  await page.getByLabel("Quantidade do item 1").fill("4");
  await page.getByLabel("Valor unitário do item 1").fill("5.5");
  await page.getByTestId(`${P}-painel`).getByRole("tab", { name: "Resumo" }).click();
  await expect(page.getByTestId(`${P}-total`), "a prévia do total: 4 × 5,50").toContainText("22,00");

  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === PORTA);
  await page.getByTestId(`${P}-salvar`).click();
  const r = await resposta;
  const corpo = r.request().postDataJSON() as Record<string, unknown>;
  expect([r.status(), corpo["warehouse_id"], corpo["unit_value"], corpo["tipo_operacao_id"]], "sem local, o unitário informado; sem TOP, nulo").toEqual([201, null, "5.5", null]);
  const salvo = await r.json() as { id: string; total: string };
  expect(salvo.total, "o total é quantidade × valor informado").toBe("22.00");
  expect(sqlE2e(`select count(*)::text from erp.stock_movements where source_type = 'fuel_supplies' and source_id = '${salvo.id}'`), "sem local, nada sai do estoque").toBe("0");
  expect(sqlE2e(`select coalesce(tipo_operacao_id::text, 'nulo') || '|' || coalesce(warehouse_id::text, 'nulo') from erp.fuel_supplies where id = '${salvo.id}'`)).toBe("nulo|nulo");
});
