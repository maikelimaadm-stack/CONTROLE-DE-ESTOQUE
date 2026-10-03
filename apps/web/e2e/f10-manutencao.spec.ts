import type { Locator, Page } from "@playwright/test";
import { api, empresaAtiva, login } from "./helpers";
import { test, expect, criarCadastro, doSeed, referenciasDoSeed } from "./central-compras-fixtures";
import { saldoInicial, sqlE2e, tiposDoModulo } from "./f10-comum";

/**
 * OPERACOES-01 · F10 (decisão 287) — A CENTRAL DA MANUTENÇÃO (`/frota/manutencoes/new`), API e banco REAIS.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────────────┐
 * │ F10-M1 — os itens são POR MÁQUINA: duas máquinas, cada uma com a SUA grade do motor; o "Local de estoque" do     │
 * │   cabeçalho preenche as linhas NOVAS das duas grades (e não vai ao corpo); uma peça por máquina → 201; o POST tem │
 * │   `machines[i].items[0].warehouse_id` = o local do cabeçalho e as chaves de antes MAIS `note` e                  │
 * │   `tipo_operacao_id` (com a capacidade); o detalhe mostra as duas máquinas; no razão, um movimento por peça, com  │
 * │   o EQUIPAMENTO da máquina do item.                                                                             │
 * │ F10-M2 — a peça SEM local, com o valor informado: 201 (a política nova de `maintenance_items`), o item aparece   │
 * │   no detalhe com o total informado, NENHUM movimento no razão; e a Observação (com a capacidade) é gravada e      │
 * │   lida no detalhe.                                                                                              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A capacidade é PREMISSA lida na API; o saldo, no servidor. Os cadastros (local e produto) nascem pela API com a
 * exclusão lógica no fim do caso (`central-compras-fixtures`); os equipamentos são os do seed, pelo NOME. As
 * manutenções ficam (o razão é imutável).
 */

const P = "central-manutencao";
const PORTA = "/api/fleet/maintenances";
/** As chaves do POST de ANTES sem a observação (que a tela de antes mandava e a API descartava), conjunto EXATO. */
const CHAVES_DE_ANTES = ["empresa_id", "harvest_id", "machines", "maintenance_date"];
const CHAVES_DA_MAQUINA = ["equipment_id", "executor_person_id", "hour_meter", "hours", "items", "maintenance_type", "mileage", "service_description", "service_total"];
const CHAVES_DA_PECA = ["note", "product_id", "quantity", "unit_value", "warehouse_id"];
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const chaves = (o: unknown) => Object.keys(o as Record<string, unknown>).sort();

type Cadastro = { id: string; nome: string };

async function cenario(page: Page) {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const tag = `f10m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const { id: local } = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `M${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: `${tag} oficina`, type: "inputs" });
  const { id: peca } = await criarCadastro(page, "products", { description: `${tag} filtro`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id, control_stock: true });
  await saldoInicial(page, { empresa, local, produto: peca, quantidade: "20", custo: "12" });
  expect((await api<{ quantity: string }>(page, "GET", `/api/stock/balances/${local}/${peca}`)).quantity, "premissa: a peça tem 20 na oficina").toBe("20.0000");
  const trator = await doSeed(page, "/api/resources/equipments/options?search=Trator", "Trator 4x4");
  const caminhonete = await doSeed(page, "/api/resources/equipments/options?search=Caminhonete", "Caminhonete");
  return {
    empresa, tag, local: { id: local, nome: `${tag} oficina` } as Cadastro, peca: { id: peca, nome: `${tag} filtro` } as Cadastro,
    trator: { id: trator.id, nome: "Trator 4x4" } as Cadastro, caminhonete: { id: caminhonete.id, nome: "Caminhonete" } as Cadastro
  };
}

/** Escolhe num RefSelect (o invólucro do campo) pelo nome — o painel do Radix, o último aberto. */
async function escolherNoCampo(page: Page, campo: Locator, nome: string) {
  await campo.locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(campo, "o campo mostra a escolha").toContainText(nome);
}

/** Pesquisa o produto na célula da linha da grade `prefixo` pelo nome e escolhe. */
async function escolherProduto(page: Page, prefixo: string, linha: Locator, nome: string) {
  const celula = linha.getByTestId(`${prefixo}-produto`);
  await celula.click();
  const painel = page.getByTestId(`${prefixo}-pesquisa`);
  await expect(painel).toBeVisible();
  await painel.getByRole("combobox").fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(painel).toHaveCount(0);
  await expect(celula).toContainText(nome);
}

/** Abre a Central e só devolve depois que a pergunta da capacidade que a PRÓPRIA tela faz chegou (200). */
async function abrirCentral(page: Page) {
  const capacidade = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/modulos/manutencao/operation-types");
  await page.goto("/frota/manutencoes/new");
  await expect(page.getByTestId(P)).toBeVisible();
  expect((await capacidade).status(), "premissa: a tela perguntou a capacidade e a API a declarou").toBe(200);
  await expect(page.getByTestId(`${P}-maquina-0`), "a Central nasce com UMA máquina").toBeVisible();
  await expect(page.getByTestId(`${P}-maquina-1`)).toHaveCount(0);
}

test("F10-M1 — duas máquinas, cada uma com a sua grade; o Local de estoque do cabeçalho preenche as linhas novas das duas; o POST por máquina; o detalhe com as duas; o razão com o equipamento de cada peça", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const cap = await tiposDoModulo(page, "manutencao");
  expect([cap.status, cap.corpo.capacidades], "premissa: a API declara a capacidade topNoModulo da manutenção").toEqual([200, { topNoModulo: 1 }]);

  await abrirCentral(page);
  await expect(page.getByTestId(`${P}-observacao`), "com a capacidade, a Observação aparece").toBeVisible();
  await expect(page.getByTestId(`${P}-m0-remover`), "com uma máquina só, não se remove").toHaveCount(0);

  // o Local de estoque do CABEÇALHO
  await escolherNoCampo(page, page.getByTestId(`${P}-local-padrao`), c.local.nome);

  // MÁQUINA 1: o trator e uma peça, a linha nova nasce com o local do cabeçalho
  const m0 = page.getByTestId(`${P}-maquina-0`);
  await expect(m0.getByRole("heading", { name: "Máquina 1" })).toBeVisible();
  await escolherNoCampo(page, m0.getByTestId(`${P}-m0-equipamento`), c.trator.nome);
  await m0.getByTestId(`${P}-m0-adicionar-item`).click();
  const l0 = m0.getByTestId(`${P}-m0-linha`);
  await expect(l0, "uma linha na grade da máquina 1").toHaveCount(1);
  await expect(l0.getByTestId(`${P}-m0-armazem`), "a linha nova nasce com o local do cabeçalho").toContainText(c.local.nome);
  await escolherProduto(page, `${P}-m0`, l0, c.peca.nome);
  await m0.getByLabel("Quantidade do item 1").fill("2");

  // MÁQUINA 2: a caminhonete e uma peça, também com o local do cabeçalho
  await page.getByTestId(`${P}-adicionar-maquina`).click();
  const m1 = page.getByTestId(`${P}-maquina-1`);
  await expect(m1.getByRole("heading", { name: "Máquina 2" })).toBeVisible();
  await expect(page.getByTestId(`${P}-m0-remover`), "com duas máquinas, cada uma se remove").toBeVisible();
  await escolherNoCampo(page, m1.getByTestId(`${P}-m1-equipamento`), c.caminhonete.nome);
  await m1.getByTestId(`${P}-m1-adicionar-vazio`).click();
  const l1 = m1.getByTestId(`${P}-m1-linha`);
  await expect(l1.getByTestId(`${P}-m1-armazem`), "a linha nova da máquina 2 nasce com o local do cabeçalho").toContainText(c.local.nome);
  await escolherProduto(page, `${P}-m1`, l1, c.peca.nome);
  await m1.getByLabel("Quantidade do item 1").fill("3");
  await expect(m0.getByTestId(`${P}-m0-linha`), "a grade da máquina 1 continua com a sua linha").toHaveCount(1);

  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === PORTA);
  await page.getByTestId(`${P}-salvar`).click();
  const r = await resposta;
  const corpo = r.request().postDataJSON() as { machines: { equipment_id: string; items: Record<string, unknown>[] }[] } & Record<string, unknown>;
  expect(r.status(), "a API gravou").toBe(201);
  expect(chaves(corpo), "o corpo de antes MAIS note e tipo_operacao_id (com a capacidade); o local do cabeçalho não vai").toEqual([...CHAVES_DE_ANTES, "note", "tipo_operacao_id"].sort());
  expect(corpo.machines.map((m) => chaves(m)), "cada máquina com as chaves de antes").toEqual([CHAVES_DA_MAQUINA, CHAVES_DA_MAQUINA]);
  expect(corpo.machines.map((m) => [m.equipment_id, m.items.length, chaves(m.items[0]), m.items[0]?.["warehouse_id"], m.items[0]?.["product_id"]]),
    "uma peça por máquina, com o local do cabeçalho").toEqual([
    [c.trator.id, 1, CHAVES_DA_PECA, c.local.id, c.peca.id], [c.caminhonete.id, 1, CHAVES_DA_PECA, c.local.id, c.peca.id]
  ]);
  const salvo = await r.json() as Record<string, unknown>;
  expect(chaves(salvo), "a resposta tem as chaves de antes").toEqual(["code", "id", "total_parts", "total_services"]);
  await expect(page.getByText("Salvo com sucesso")).toBeVisible();

  // depois de salvar, o detalhe (como antes), com as duas máquinas
  const id = String(salvo["id"]);
  await expect(page).toHaveURL(new RegExp(`/frota/manutencoes/${id}$`));
  await expect(page.getByTestId("manutencao-maquina"), "o detalhe mostra as duas máquinas").toHaveCount(2);
  for (const m of [c.trator, c.caminhonete]) {
    await expect(page.getByTestId("manutencao-maquina").filter({ hasText: m.nome }), `o bloco de ${m.nome}, com a peça`).toContainText(c.peca.nome);
  }

  // NO RAZÃO: um movimento por peça, cada um com o equipamento da máquina do item
  expect(sqlE2e(`select string_agg(equipamento_id::text || ':' || direction::text || ':' || quantity::text, ',' order by quantity) from erp.stock_movements where source_type = 'maintenances' and source_id = '${id}'`),
    "a peça do trator e a da caminhonete, cada uma SAINDO com a sua máquina").toBe(`${c.trator.id}:-1:2.0000,${c.caminhonete.id}:-1:3.0000`);
});

test("F10-M2 — a peça SEM local, com o valor informado: 201, o item no detalhe e nada no razão; a Observação gravada e lida", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  await abrirCentral(page);
  await expect(page.getByTestId(`${P}-local-padrao`).locator('[data-preenchido="true"]'), "premissa: o cabeçalho sem local").toHaveCount(0);

  const m0 = page.getByTestId(`${P}-maquina-0`);
  await escolherNoCampo(page, m0.getByTestId(`${P}-m0-equipamento`), c.trator.nome);
  await m0.getByTestId(`${P}-m0-adicionar-item`).click();
  const l0 = m0.getByTestId(`${P}-m0-linha`);
  await expect(l0.getByTestId(`${P}-m0-armazem`), "premissa: a peça está sem local").toHaveText("—");
  await escolherProduto(page, `${P}-m0`, l0, c.peca.nome);
  await m0.getByLabel("Quantidade do item 1").fill("2");
  await m0.getByLabel("Valor unitário do item 1").fill("10");
  const nota = `F10-M2 ${c.tag}`;
  await page.getByTestId(`${P}-observacao`).locator("textarea").fill(nota);

  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === PORTA);
  await page.getByTestId(`${P}-salvar`).click();
  const r = await resposta;
  const corpo = r.request().postDataJSON() as { note: unknown; machines: { items: Record<string, unknown>[] }[] };
  expect([r.status(), corpo.note, corpo.machines[0]?.items[0]?.["warehouse_id"], corpo.machines[0]?.items[0]?.["unit_value"]],
    "a peça sem local, com o valor informado, e a observação no corpo").toEqual([201, nota, null, "10"]);
  const salvo = await r.json() as { id: string; total_parts: string };
  expect(salvo.total_parts, "a peça vale quantidade × valor informado").toBe("20.00");

  await expect(page).toHaveURL(new RegExp(`/frota/manutencoes/${salvo.id}$`));
  const maquina = page.getByTestId("manutencao-maquina");
  await expect(maquina, "o item sem local aparece no detalhe (a política nova)").toContainText(c.peca.nome);
  await expect(maquina).toContainText("20,00");
  await expect(page.getByText(nota), "a observação gravada é lida no detalhe").toBeVisible();
  expect(sqlE2e(`select count(*)::text from erp.stock_movements where source_type = 'maintenances' and source_id = '${salvo.id}'`), "sem local, nada sai do estoque").toBe("0");
  expect(sqlE2e(`select count(*)::text || '|' || bool_and(i.warehouse_id is null)::text from erp.maintenance_items i join erp.maintenance_machines mm on mm.id = i.machine_id where mm.maintenance_id = '${salvo.id}'`),
    "o item gravado, sem local").toBe("1|true");
});
