import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { MODULOS_COM_TOP, type ModuloComTop } from "@agro/domain";
import { api, empresaAtiva, login, pickRef } from "./helpers";
import { test, expect, criarCadastro, doSeed, referenciasDoSeed } from "./central-compras-fixtures";
import { vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { saldoInicial, sqlE2e, tiposDoModulo } from "./f10-comum";

/**
 * OPERACOES-01 · F10 (decisão 287) · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do
 * web" da DEPLOYMENT, e a reversão só do web), na FROTA: o abastecimento, a manutenção e a OS.
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não
 * mediria o cliente anterior). Arquivo próprio: não colide com as fases que correm em paralelo.
 *
 * O QUE SE MEDE. A API desta fase só ACRESCENTA nas rotas da frota: `tipo_operacao_id` opcional nos POST, `note` na
 * manutenção, as chaves da TOP nos detalhes e as rotas de capacidade em `/api/modulos/*`, que o web da base nunca chama.
 * O que MUDA para ele: a peça de manutenção SEM local de estoque, que a base mandava e a RLS recusava, passa a gravar (a
 * política nova de `maintenance_items`); e o equipamento do abastecimento vai ao razão. O navegador roda o bundle EXATO
 * da base, e cada página grava (201) com as chaves de resposta de ANTES, sem nenhuma requisição morta nem resposta 404,
 * 422 ou 5xx da API nova (`semBloqueio`, `semErroDeContrato`).
 *
 * O MUNDO, NESTE SENTIDO, É O DO WEB DA BASE: a ÁRVORE da base em `.api-anterior` (no HEAD dela, por `git grep`)
 * conhece a Central do abastecimento (`central-abastecimento`)? Não → legado (a base de hoje): os formulários de antes
 * (`/frota/abastecimentos/new`, `/frota/manutencoes/new` com a peça sem local, `/os/new`). Sim → novo (a base já com a
 * F10): as Centrais, com o campo "Tipo de operação". A API deste HEAD entra como PREMISSA: ela declara `topNoModulo: 1`
 * nas três rotas da frota — é ela que está sendo julgada. Os cadastros (local e produto) e o saldo nascem pela API deste
 * HEAD (as portas de `central-compras-fixtures`, com a exclusão lógica no fim do caso, passou ou falhou); o
 * equipamento é o do seed, pelo NOME. Os lançamentos ficam (o razão é imutável).
 */

const MODULOS_DA_FROTA: readonly ModuloComTop[] = MODULOS_COM_TOP.filter((m) => m === "abastecimento" || m === "manutencao" || m === "ordem_servico");
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const chaves = (o: unknown) => Object.keys(o as Record<string, unknown>).sort();
const CHAVES_DO_ABASTECIMENTO = ["cost_center_id", "empresa_id", "equipment_id", "harvest_id", "hour_meter", "mileage", "note", "operator_person_id", "origin", "product_id", "quantity", "supply_date", "unit_value", "warehouse_id"];
const CHAVES_DA_OS = ["activity_id", "cost_center_id", "description", "empresa_id", "harvest_id", "lines", "operation_id", "order_date", "planned_end", "planned_start", "responsible_person_id", "team_id"];

/** O web da BASE (`.api-anterior`, no HEAD daquela árvore) conhece a Central do abastecimento? Erro de leitura reprova. */
function mundoDoWebDaBase(): Mundo {
  const arvore = path.resolve(__dirname, "../../..", ".api-anterior");
  let tem = false;
  try {
    execFileSync("git", ["grep", "-q", "-F", "central-abastecimento", "HEAD", "--", "apps/web/src"], { cwd: arvore, stdio: "pipe" });
    tem = true;
  } catch (e) {
    if ((e as { status?: number }).status !== 1) throw new Error(`não foi possível medir a árvore da base em ${arvore}: ${String(e)}`);
  }
  const mundo: Mundo = tem ? "novo" : "legado";
  console.log(`[skew] OPERACOES-01 F10 · K-2 · o web da base ${tem ? "CONHECE" : "NÃO conhece"} a Central do abastecimento → mundo ${mundo}`);
  return mundo;
}

/** A PREMISSA: a API no ar é a desta fase (declara a capacidade dos três módulos da frota). */
async function premissaDaApi(page: Page) {
  for (const m of MODULOS_DA_FROTA) {
    const r = await tiposDoModulo(page, m);
    expect([r.status, r.corpo.capacidades], `premissa: a API julgada declara topNoModulo em ${m}`).toEqual([200, { topNoModulo: 1 }]);
  }
}

async function cenario(page: Page) {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const tag = `f10k2${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const { id: local } = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `W${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: `${tag} local`, type: "inputs" });
  const { id: produto } = await criarCadastro(page, "products", { description: `${tag} produto`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id, control_stock: true });
  await saldoInicial(page, { empresa, local, produto, quantidade: "50", custo: "3" });
  expect((await api<{ quantity: string }>(page, "GET", `/api/stock/balances/${local}/${produto}`)).quantity, "premissa: o produto tem 50 no local").toBe("50.0000");
  const eq = await doSeed(page, "/api/resources/equipments/options?search=Trator", "Trator 4x4");
  return { empresa, tag, local: { id: local, nome: `${tag} local` }, produto: { id: produto, nome: `${tag} produto` }, equipamento: { id: eq.id, nome: "Trator 4x4" } };
}

/** O invólucro de um campo do formulário de antes (`Field`), pelo rótulo. */
const campoDeAntes = (page: Page, rotulo: string) => page.locator("label", { hasText: rotulo }).first().locator("..");

/** Escolhe num RefSelect dentro de `alvo` (o invólucro do campo, ou a célula) pelo nome — o painel do Radix, o último aberto. */
async function escolherEm(page: Page, alvo: Locator, nome: string) {
  await alvo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(alvo, "a escolha aparece").toContainText(nome);
}

/** Pesquisa na célula da linha da grade do motor `prefixo` (o mundo novo) pelo nome e escolhe. */
async function escolherNaCelula(page: Page, prefixo: string, celula: Locator, nome: string) {
  await celula.click();
  const painel = page.getByTestId(`${prefixo}-pesquisa`);
  await expect(painel).toBeVisible();
  await painel.getByRole("combobox").fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(painel).toHaveCount(0);
}

test("OP01-F10 · K-2a (sentido 2) — o abastecimento do web da base contra a API deste HEAD: 201 com a resposta de antes, e o equipamento no razão", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  const v = vigiar(page);
  await login(page);
  await premissaDaApi(page);
  const c = await cenario(page);

  if (mundo === "legado") {
    await page.goto("/frota/abastecimentos/new");
    await expect(page.getByRole("heading", { name: "Novo abastecimento" }), "o formulário de antes").toBeVisible();
    await pickRef(page, "Equipamento", c.equipamento.nome);
    await escolherEm(page, campoDeAntes(page, "Armazém / tanque"), c.local.nome);
    await escolherEm(page, campoDeAntes(page, "Combustível"), c.produto.nome);
    await campoDeAntes(page, "Litros").locator("input").fill("5");
  } else {
    await page.goto("/frota/abastecimentos/new");
    const P = "central-abastecimento";
    await expect(page.getByTestId(`${P}-campo-top`), "a Central da base, com a capacidade da API").toBeVisible();
    await escolherEm(page, page.getByTestId(`${P}-equipamento`), c.equipamento.nome);
    const linha = page.getByTestId(`${P}-linha`);
    await escolherNaCelula(page, P, linha.getByTestId(`${P}-armazem`), c.local.nome);
    await escolherNaCelula(page, P, linha.getByTestId(`${P}-produto`), c.produto.nome);
    await page.getByLabel("Quantidade do item 1").fill("5");
  }

  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/fleet/fuel-supplies");
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await post;
  const corpo = r.request().postDataJSON() as Record<string, unknown>;
  expect(chaves(corpo), `mundo ${mundo}: o corpo do web da base`).toEqual(mundo === "novo" ? [...CHAVES_DO_ABASTECIMENTO, "tipo_operacao_id"].sort() : CHAVES_DO_ABASTECIMENTO);
  expect(r.status(), "a API nova gravou o abastecimento do web da base").toBe(201);
  const salvo = await r.json() as Record<string, unknown>;
  expect(chaves(salvo), "a resposta tem EXATAMENTE as chaves de antes").toEqual(["code", "id", "total"]);
  const id = String(salvo["id"]);
  await expect(page, "o web da base seguiu para a lista").toHaveURL(/\/frota\?tab=abastecimentos/);
  expect(sqlE2e(`select coalesce(tipo_operacao_id::text, 'nulo') from erp.fuel_supplies where id = '${id}'`), "sem TOP, como antes").toBe("nulo");
  expect(sqlE2e(`select string_agg(equipamento_id::text, ',') from erp.stock_movements where source_type = 'fuel_supplies' and source_id = '${id}'`),
    "a API nova grava o equipamento no razão também para o web da base").toBe(c.equipamento.id);
  v.semBloqueio();
  v.semErroDeContrato();
});

test("OP01-F10 · K-2b (sentido 2) — a manutenção do web da base com a peça SEM local contra a API deste HEAD: 201 (a política nova), a resposta de antes e o item no detalhe", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  const v = vigiar(page);
  await login(page);
  await premissaDaApi(page);
  const c = await cenario(page);

  if (mundo === "legado") {
    await page.goto("/frota/manutencoes/new");
    await expect(page.getByRole("heading", { name: "Nova manutenção" }), "o formulário de antes").toBeVisible();
    await pickRef(page, "Equipamento", c.equipamento.nome);
    await page.getByRole("button", { name: "Adicionar item" }).click();
    const linha = page.locator("tbody tr").first();
    // a peça SEM local: Local de estoque (1ª coluna) vazio; Produto, Quantidade e Valor unitário nas colunas de antes
    await escolherEm(page, linha.locator("td").nth(1), c.produto.nome);
    await linha.locator("td").nth(3).locator("input").fill("2");
    await linha.locator("td").nth(4).locator("input").fill("10");
  } else {
    await page.goto("/frota/manutencoes/new");
    const P = "central-manutencao";
    await expect(page.getByTestId(`${P}-campo-top`), "a Central da base, com a capacidade da API").toBeVisible();
    const m0 = page.getByTestId(`${P}-maquina-0`);
    await escolherEm(page, m0.getByTestId(`${P}-m0-equipamento`), c.equipamento.nome);
    await m0.getByTestId(`${P}-m0-adicionar-item`).click();
    const linha = m0.getByTestId(`${P}-m0-linha`);
    await escolherNaCelula(page, `${P}-m0`, linha.getByTestId(`${P}-m0-produto`), c.produto.nome);
    await m0.getByLabel("Quantidade do item 1").fill("2");
    await m0.getByLabel("Valor unitário do item 1").fill("10");
  }

  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/fleet/maintenances");
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await post;
  const corpo = r.request().postDataJSON() as { machines: { items: Record<string, unknown>[] }[] };
  expect(corpo.machines[0]?.items.map((i) => [i["product_id"], i["warehouse_id"] ?? null]), "premissa: a peça vai SEM local").toEqual([[c.produto.id, null]]);
  expect(r.status(), "a API nova gravou a peça sem local (antes, a RLS a recusava)").toBe(201);
  const salvo = await r.json() as Record<string, unknown>;
  expect(chaves(salvo), "a resposta tem EXATAMENTE as chaves de antes").toEqual(["code", "id", "total_parts", "total_services"]);
  expect(salvo["total_parts"], "a peça vale quantidade × valor informado").toBe("20.00");
  const id = String(salvo["id"]);
  await expect(page, "o web da base seguiu para o detalhe").toHaveURL(new RegExp(`/frota/manutencoes/${id}$`));
  await expect(page.getByText(c.produto.nome), "o item sem local aparece no detalhe do web da base").toBeVisible();
  expect(sqlE2e(`select count(*)::text || '|' || bool_and(i.warehouse_id is null)::text from erp.maintenance_items i join erp.maintenance_machines mm on mm.id = i.machine_id where mm.maintenance_id = '${id}'`),
    "o item gravado, sem local").toBe("1|true");
  v.semBloqueio();
  v.semErroDeContrato();
});

test("OP01-F10 · K-2c (sentido 2) — a OS do web da base contra a API deste HEAD: 201 com a resposta de antes", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  const v = vigiar(page);
  await login(page);
  await premissaDaApi(page);
  const c = await cenario(page);
  const descricao = `K-2c ${c.tag}`;

  if (mundo === "legado") {
    await page.goto("/os/new");
    await expect(page.getByRole("heading", { name: "Nova ordem de serviço" }), "o formulário de antes").toBeVisible();
    await campoDeAntes(page, "Descrição").locator("textarea").fill(descricao);
    await page.getByRole("button", { name: "Insumos", exact: true }).click();
    const linha = page.locator("tbody tr").first();
    await escolherEm(page, linha.locator("td").nth(1), c.produto.nome);
    await escolherEm(page, linha.locator("td").nth(2), c.local.nome);
    await linha.locator("td").nth(3).locator("input").fill("2");
  } else {
    await page.goto("/os/new");
    const P = "central-os";
    await expect(page.getByTestId(`${P}-campo-top`), "a Central da base, com a capacidade da API").toBeVisible();
    await page.getByTestId(`${P}-descricao`).locator("textarea").fill(descricao);
    await escolherEm(page, page.getByTestId(`${P}-local-padrao`), c.local.nome);
    await page.getByTestId(`${P}-insumos-adicionar-vazio`).click();
    const linha = page.getByTestId(`${P}-insumos-linha`);
    await escolherNaCelula(page, `${P}-insumos`, linha.getByTestId(`${P}-insumos-produto`), c.produto.nome);
    await page.getByTestId(`${P}-insumos-itens-corpo`).getByLabel("Quantidade do item 1").fill("2");
  }

  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/service-orders");
  await page.getByRole("button", { name: "Salvar" }).click();
  const r = await post;
  const corpo = r.request().postDataJSON() as Record<string, unknown> & { lines: Record<string, unknown>[] };
  expect(chaves(corpo), `mundo ${mundo}: o corpo do web da base`).toEqual(mundo === "novo" ? [...CHAVES_DA_OS, "tipo_operacao_id"].sort() : CHAVES_DA_OS);
  expect(corpo.lines.map((l) => [l["section"], l["product_id"], l["warehouse_id"]]), "o insumo com o local").toEqual([["input", c.produto.id, c.local.id]]);
  expect(r.status(), "a API nova gravou a OS do web da base").toBe(201);
  const salvo = await r.json() as Record<string, unknown>;
  expect(chaves(salvo), "a resposta tem EXATAMENTE as chaves de antes").toEqual(["code", "id"]);
  const id = String(salvo["id"]);
  await expect(page, "o web da base seguiu para o detalhe").toHaveURL(new RegExp(`/os/${id}$`));
  await expect(page.getByText(descricao), "o detalhe do web da base mostra a OS").toBeVisible();
  expect(sqlE2e(`select coalesce(tipo_operacao_id::text, 'nulo') || '|' || (select count(*) from erp.service_order_lines where order_id = '${id}')::text from erp.service_orders where id = '${id}'`),
    "a OS gravada sem TOP, com a linha").toBe("nulo|1");
  v.semBloqueio();
  v.semErroDeContrato();
});
