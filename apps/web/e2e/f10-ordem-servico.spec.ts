import type { Locator, Page } from "@playwright/test";
import { api, empresaAtiva, login } from "./helpers";
import { test, expect, criarCadastro, referenciasDoSeed } from "./central-compras-fixtures";
import { saldoInicial, sqlE2e, tiposDoModulo } from "./f10-comum";

/**
 * OPERACOES-01 · F10 (decisão 287) — A CENTRAL DA ORDEM DE SERVIÇO (`/os/new`) E A EDIÇÃO (`/os/<id>/editar`), API e
 * banco REAIS.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────────────┐
 * │ F10-O1 — cria a OS com mão de obra (grade própria), um insumo e um EPI (as grades do motor, com o Local de        │
 * │   estoque do cabeçalho) → 201 com a Idempotency-Key; no detalhe, "Editar" → a Central da edição muda a descrição  │
 * │   e a quantidade do insumo → o PUT de sempre, SEM `tipo_operacao_id`, com as linhas de antes → o detalhe com os  │
 * │   valores novos → Iniciar → Finalizar → no razão, o insumo e o EPI SAINDO com a OS (`ordem_servico_id`).          │
 * │ F10-O2 — a OS que não está aberta nem em andamento: o detalhe tira o "Editar" (que a mesma OS, aberta, tinha) e   │
 * │   a rota de edição diz a situação e deixa o Salvar desabilitado.                                                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A capacidade é PREMISSA lida na API; o saldo, no servidor. Os cadastros (local e produtos) nascem pela API com a
 * exclusão lógica no fim do caso (`central-compras-fixtures`); a pessoa da mão de obra é a do seed, pelo NOME. As OS
 * ficam (o razão é imutável).
 */

const P = "central-os";
const PORTA = "/api/service-orders";
const CHAVES_DO_CABECALHO = ["activity_id", "cost_center_id", "description", "empresa_id", "harvest_id", "lines", "operation_id", "order_date", "planned_end", "planned_start", "responsible_person_id", "team_id"];
const CHAVES_DA_LINHA = ["equipment_id", "hours", "note", "person_id", "product_id", "quantity", "section", "unit_value", "warehouse_id"];
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const chaves = (o: unknown) => Object.keys(o as Record<string, unknown>).sort();

type Cadastro = { id: string; nome: string };
type Linha = Record<string, unknown> & { section: string };

async function cenario(page: Page) {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const tag = `f10o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const { id: local } = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `O${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: `${tag} almoxarifado`, type: "inputs" });
  const produto = async (sufixo: string, quantidade: string): Promise<Cadastro> => {
    const { id } = await criarCadastro(page, "products", { description: `${tag} ${sufixo}`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id, control_stock: true });
    await saldoInicial(page, { empresa, local, produto: id, quantidade, custo: "4" });
    expect((await api<{ quantity: string }>(page, "GET", `/api/stock/balances/${local}/${id}`)).quantity, `premissa: ${sufixo} tem saldo no local`).toBe(`${quantidade}.0000`);
    return { id, nome: `${tag} ${sufixo}` };
  };
  return { empresa, tag, local: { id: local, nome: `${tag} almoxarifado` } as Cadastro, insumo: await produto("adubo", "10"), epi: await produto("luva", "5") };
}

/** Escolhe num RefSelect (o invólucro do campo, ou a célula) pelo nome — o painel do Radix, o último aberto. */
async function escolherNoCampo(page: Page, campo: Locator, nome: string) {
  await campo.locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(campo, "o campo mostra a escolha").toContainText(nome);
}

/** Pesquisa o produto na célula da linha da grade do motor `prefixo` pelo nome e escolhe. */
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

/** Uma OS aberta, pela API (para o caso da situação). */
async function osAberta(page: Page, empresa: string, descricao: string) {
  return api<{ id: string; code: string }>(page, "POST", PORTA, { empresa_id: empresa, order_date: "2026-09-10", description: descricao });
}
const situacaoNoServidor = (page: Page, id: string) => api<{ status: string }>(page, "GET", `${PORTA}/${id}`).then((o) => o.status);

test("F10-O1 — cria a OS (mão de obra, um insumo e um EPI), edita pela Central (PUT sem tipo_operacao_id), finaliza, e o insumo e o EPI saem do estoque com a OS no razão", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const cap = await tiposDoModulo(page, "ordem_servico");
  expect([cap.status, cap.corpo.capacidades], "premissa: a API declara a capacidade topNoModulo da OS").toEqual([200, { topNoModulo: 1 }]);

  const capacidade = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/modulos/ordem-servico/operation-types");
  await page.goto("/os/new");
  await expect(page.getByTestId(P)).toBeVisible();
  expect((await capacidade).status(), "premissa: a tela perguntou a capacidade").toBe(200);
  await expect(page.getByTestId(`${P}-top`), "com a capacidade, o campo Tipo de operação").toBeVisible();

  const descricao = `F10-O1 ${c.tag}`;
  await page.getByTestId(`${P}-descricao`).locator("textarea").fill(descricao);
  await escolherNoCampo(page, page.getByTestId(`${P}-local-padrao`), c.local.nome);

  // MÃO DE OBRA (grade própria): João Vaqueiro (seed), 2 × 50
  await page.getByTestId(`${P}-mao-de-obra-adicionar`).click();
  const mao = page.getByTestId(`${P}-mao-de-obra-linha`);
  await expect(mao).toHaveCount(1);
  await escolherNoCampo(page, mao.locator("td").first(), "João Vaqueiro");
  await mao.getByLabel("Quantidade da linha 1").fill("2");
  await mao.getByLabel("Valor unitário da linha 1").fill("50");

  // INSUMOS e EPIs (as grades do motor): as linhas novas nascem com o local do cabeçalho
  await page.getByTestId(`${P}-insumos-adicionar-vazio`).click();
  const insumo = page.getByTestId(`${P}-insumos-linha`);
  await expect(insumo.getByTestId(`${P}-insumos-armazem`), "a linha nova de Insumos nasce com o local do cabeçalho").toContainText(c.local.nome);
  await escolherProduto(page, `${P}-insumos`, insumo, c.insumo.nome);
  await page.getByTestId(`${P}-insumos-itens-corpo`).getByLabel("Quantidade do item 1").fill("3");
  await page.getByTestId(`${P}-epis-adicionar-vazio`).click();
  const epi = page.getByTestId(`${P}-epis-linha`);
  await expect(epi.getByTestId(`${P}-epis-armazem`), "a linha nova de EPIs nasce com o local do cabeçalho").toContainText(c.local.nome);
  await escolherProduto(page, `${P}-epis`, epi, c.epi.nome);
  await page.getByTestId(`${P}-epis-itens-corpo`).getByLabel("Quantidade do item 1").fill("1");

  const criou = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === PORTA);
  await page.getByTestId(`${P}-salvar`).click();
  const r = await criou;
  const corpo = r.request().postDataJSON() as Record<string, unknown> & { lines: Linha[] };
  expect(r.status(), "a API gravou").toBe(201);
  expect(r.request().headers()["idempotency-key"], "o POST da OS leva a Idempotency-Key").toBeTruthy();
  expect(chaves(corpo), "o corpo de antes MAIS tipo_operacao_id (com a capacidade); o local do cabeçalho não vai").toEqual([...CHAVES_DO_CABECALHO, "tipo_operacao_id"].sort());
  expect(corpo.lines.map((l) => chaves(l)), "cada linha com as nove chaves de antes").toEqual([CHAVES_DA_LINHA, CHAVES_DA_LINHA, CHAVES_DA_LINHA]);
  expect(corpo.lines.map((l) => [l.section, l["product_id"] ?? null, l["warehouse_id"] ?? null, l["quantity"]]), "mão de obra, o insumo e o EPI com o local")
    .toEqual([["labor", null, null, "2"], ["input", c.insumo.id, c.local.id, "3"], ["ppe", c.epi.id, c.local.id, "1"]]);
  const { id } = await r.json() as { id: string; code: string };
  await expect(page).toHaveURL(new RegExp(`/os/${id}$`));

  // EDITAR: a Central preenchida com a OS
  await page.getByTestId("os-editar").click();
  await expect(page).toHaveURL(new RegExp(`/os/${id}/editar$`));
  await expect(page.getByTestId(P)).toBeVisible();
  await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText(/^Ordem de serviço /);
  await expect(page.getByTestId(`${P}-top`), "na edição, a TOP não se escolhe").toHaveCount(0);
  await expect(page.getByTestId(`${P}-top-gravada`), "a TOP gravada é só leitura").toContainText("Sem tipo de operação");
  await expect(page.getByTestId(`${P}-descricao`).locator("textarea"), "a descrição veio da OS").toHaveValue(descricao);
  await expect(page.getByTestId(`${P}-insumos-linha`).getByTestId(`${P}-insumos-produto`), "o insumo veio da OS").toContainText(c.insumo.nome);
  const editada = `F10-O1 editada ${c.tag}`;
  await page.getByTestId(`${P}-descricao`).locator("textarea").fill(editada);
  await page.getByTestId(`${P}-insumos-linha`).getByTestId(`${P}-insumos-selecionar-item`).click();
  await page.getByTestId(`${P}-insumos-itens-corpo`).getByLabel("Quantidade do item 1").fill("4");

  const salvou = page.waitForResponse((x) => x.request().method() === "PUT" && new URL(x.url()).pathname === `${PORTA}/${id}`);
  await page.getByTestId(`${P}-salvar`).click();
  const put = await salvou;
  const corpoDoPut = put.request().postDataJSON() as Record<string, unknown> & { lines: Linha[] };
  expect(put.status(), "a API aceitou a edição").toBe(200);
  expect(chaves(corpoDoPut), "o PUT leva o corpo de antes, SEM tipo_operacao_id").toEqual(CHAVES_DO_CABECALHO);
  expect(corpoDoPut.lines.map((l) => [l.section, l["quantity"]]), "as linhas de volta, com a quantidade nova do insumo")
    .toEqual([["labor", "2.0000"], ["input", "4"], ["ppe", "1.0000"]]);
  expect([corpoDoPut["description"]], "a descrição nova").toEqual([editada]);
  await expect(page).toHaveURL(new RegExp(`/os/${id}$`));
  await expect(page.getByText(editada), "o detalhe mostra a descrição nova").toBeVisible();

  // INICIAR → FINALIZAR: o insumo e o EPI saem do estoque, com a OS no razão
  await page.getByRole("button", { name: "Iniciar execução" }).click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect.poll(() => situacaoNoServidor(page, id)).toBe("in_progress");
  await page.getByRole("button", { name: "Finalizar (baixa insumos)" }).click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect.poll(() => situacaoNoServidor(page, id)).toBe("finished");
  expect(sqlE2e(`select string_agg(product_id::text || ':' || direction::text || ':' || quantity::text || ':' || coalesce(ordem_servico_id::text, 'sem'), ',' order by quantity desc) from erp.stock_movements where source_type = 'service_orders' and source_id = '${id}'`),
    "o insumo (4, a quantidade editada) e o EPI saem com a OS").toBe(`${c.insumo.id}:-1:4.0000:${id},${c.epi.id}:-1:1.0000:${id}`);
});

test("F10-O2 — a OS fora de aberta/em andamento: sem 'Editar' no detalhe e, na rota de edição, a situação e o Salvar desabilitado", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  const os = await osAberta(page, empresa, `F10-O2 ${Date.now().toString(36)}`);

  // PREMISSA: a MESMA OS, aberta, tem o "Editar"
  await page.goto(`/os/${os.id}`);
  await expect(page.getByTestId("os-editar"), "premissa: aberta, a OS se edita").toBeVisible();

  await api(page, "POST", `${PORTA}/${os.id}/status`, { status: "in_progress" });
  await api(page, "POST", `${PORTA}/${os.id}/status`, { status: "finished" });
  expect(await situacaoNoServidor(page, os.id), "premissa: a OS foi finalizada").toBe("finished");

  await page.goto(`/os/${os.id}`);
  await expect(page.getByRole("button", { name: "Avaliar" }), "premissa: o detalhe já mostra a OS finalizada").toBeVisible();
  await expect(page.getByTestId("os-editar"), "finalizada, sem Editar").toHaveCount(0);

  await page.goto(`/os/${os.id}/editar`);
  await expect(page.getByTestId(P)).toBeVisible();
  await expect(page.getByTestId(`${P}-nao-editavel`)).toHaveText("Esta OS não pode ser editada: ela está finalizada.");
  await expect(page.getByTestId(`${P}-salvar`), "o Salvar fica desabilitado").toBeDisabled();
});
