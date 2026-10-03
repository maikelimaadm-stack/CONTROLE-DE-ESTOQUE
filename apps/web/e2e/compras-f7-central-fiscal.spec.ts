import type { Locator, Page, Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";

/**
 * OPERACOES-01 F7 (decisão 284) — OS DADOS FISCAIS NA CENTRAL DE COMPRAS MANUAL · FC-1 e FC-2.
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────────────────────────┐
 * │ FC-1 com a capacidade `importacaoXml` declarada pela API, a criação da COMPRA ganha o bloco      │
 * │      "Dados fiscais" nos Dados adicionais: chave de acesso VÁLIDA, UF, tipo de documento, IPI e  │
 * │      seguro → o total exibido soma IPI + seguro; o POST leva SÓ as chaves preenchidas (decimais  │
 * │      em texto); o servidor grava e soma; a consulta mostra a seção "Dados fiscais" (aba Fiscal)  │
 * │      e o total com os impostos.                                                                  │
 * │ FC-2 chave de acesso com o dígito verificador errado → o servidor recusa (422 no campo           │
 * │      `chave_acesso`), a mensagem aparece NO CAMPO, e nada é gravado (a criação continua aberta). │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A chave e o CNPJ do emitente são SINTÉTICOS: inventados aqui, com os dígitos verificadores calculados NESTE arquivo (à
 * mão, sem a função do domínio que o servidor usa — senão o teste conferiria a conta com ela mesma). Cada caso cria os
 * PRÓPRIOS cadastros (fornecedor, local de estoque, produto, TOP) pela API, limpos no fim pela fixture; a compra fica
 * (ledger). O que vai no fio é lido no fio, e o servidor confere o que gravou.
 */

const P = "central-compras";
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const caminho = (r: Response) => new URL(r.url()).pathname;

/* ═════════════════════════════════ a chave sintética ═════════════════════════════════ */

/** DV do CNPJ (módulo 11, pesos 2..9 da direita para a esquerda, reiniciando). */
function dvCnpj(base: string): number {
  let soma = 0; let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
const cnpjSintetico = (base12: string) => { const d1 = dvCnpj(base12); return `${base12}${d1}${dvCnpj(`${base12}${d1}`)}`; };

/** DV da chave de acesso: módulo 11 sobre os 43 dígitos, pesos 2..9 da direita; resto 0 ou 1 → 0. */
function dvDaChave(chave43: string): number {
  let soma = 0; let peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(chave43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Uma chave de NF-e modelo 55 inventada (UF 35, 09/2026, série 1, número e código aleatórios), com o DV certo. */
function chaveSintetica(): { valida: string; comDvErrado: string } {
  const aleatorio = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
  const cnpj = cnpjSintetico(`98${aleatorio(6)}0001`);
  const c43 = `35` + `2609` + cnpj + `55` + `001` + aleatorio(9) + `1` + aleatorio(8);
  expect(c43, "premissa: a chave sem o DV tem 43 dígitos").toMatch(/^\d{43}$/);
  const dv = dvDaChave(c43);
  return { valida: `${c43}${dv}`, comDvErrado: `${c43}${(dv + 1) % 10}` };
}

/* ═════════════════════════════════ fixtures ═════════════════════════════════ */

async function cenario(page: Page) {
  const empresa = await empresaAtiva(page);
  const { unidade: un, grupo, natureza, centro } = await referenciasDoSeed(page);
  const forn = await criarCadastro(page, "people", { name: uniq("FC forn"), person_type: "legal", is_provider: true });
  const fornecedor = { id: forn.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${forn.id}`))["name"]) };
  const arm = await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `F${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("FC local"), type: "inputs"
  });
  const armazem = { id: arm.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]) };
  const prod = await criarCadastro(page, "products", { description: uniq("FC prod"), group_id: grupo.id, measurement_id: un.id, financial_category_id: natureza.id });
  const produto = { id: prod.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${prod.id}`))["description"]) };
  const topCompra = (await criarTop(page, { codigo: codigoTop("7"), codigoBase: "compras.compra", nome: uniq("Compra FC") })).id;

  // PREMISSA: a API desta execução DECLARA a capacidade — sem ela o bloco não existe e o teste não provaria nada.
  const portas = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/compras/compras/operation-types");
  expect(portas.capacidades?.["importacaoXml"], "premissa: a API declara capacidades.importacaoXml = 1").toBe(1);
  return { empresa, natureza, centro, fornecedor, armazem, produto, topCompra };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/** RefSelect da Central pelo rótulo do campo. */
async function escolher(page: Page, rotulo: string, nome: string) {
  const campo = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/** Pesquisa do motor ancorada à célula (produto ou local de estoque) da linha. */
async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const pesquisa = page.getByTestId(`${P}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await pesquisa.getByRole("combobox").fill(nome);
  await pesquisa.getByRole("option").filter({ hasText: nome }).first().click();
  await expect(pesquisa).toHaveCount(0);
}

/** A criação da compra com o cabeçalho e um item de 2 × 50,00 = 100,00, e os Dados adicionais abertos. */
async function compraNaCentral(page: Page, c: Cenario) {
  await page.goto(`/compras/compras/new?tipo_operacao_id=${c.topCompra}`);
  const central = page.getByTestId("compras-central");
  await expect(central).toHaveAttribute("data-especie", "compra");
  await escolher(page, "Fornecedor", c.fornecedor.nome);
  await escolher(page, "Natureza de despesa", c.natureza.label);
  await escolher(page, "Centro de resultado", c.centro.label);
  await page.getByTestId(`${P}-adicionar-item`).click();
  const linha = page.getByTestId(`${P}-linha`).first();
  await escolherNaCelula(page, linha.getByTestId(`${P}-produto`), c.produto.nome);
  await escolherNaCelula(page, linha.getByTestId(`${P}-armazem`), c.armazem.nome);
  await linha.getByLabel("Quantidade do item 1").fill("2");
  await linha.getByLabel("Valor unitário do item 1").fill("50");
  await expect(page.getByTestId("compras-total"), "premissa: sem os dados fiscais, o total é o dos itens").toContainText("100,00");
  // UM só "Dados adicionais" na criação: o bloco fiscal mora nos Dados, nunca repetido em cada campo do painel
  await expect(central.getByRole("button", { name: /^Dados adicionais/ })).toHaveCount(1);
  const grupo = page.getByTestId(`${P}-dados`).getByRole("button", { name: /^Dados adicionais/ });
  if ((await grupo.getAttribute("aria-expanded")) !== "true") await grupo.click();
  await expect(grupo).toHaveAttribute("aria-expanded", "true");
  const fiscais = page.getByTestId("compras-dados-fiscais");
  await expect(fiscais, "com a capacidade, o bloco Dados fiscais aparece na criação da compra").toBeVisible();
  return fiscais;
}

const postDaCompra = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/compras/compras");

/* ═════════════════════════════════ FC-1 ═════════════════════════════════ */

test("FC-1 — compra manual com chave válida, UF, tipo, IPI, seguro e item imobilizado: o total soma os impostos, o POST leva só o preenchido e a consulta mostra os dados fiscais", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const chave = chaveSintetica();
  const fiscais = await compraNaCentral(page, c);

  await fiscais.getByTestId("compras-chave-acesso").fill(chave.valida.replace(/(\d{4})(?=\d)/g, "$1 ")); // como no DANFE, com espaços
  await fiscais.getByTestId("compras-uf-nota").fill("sp");
  await expect(fiscais.getByTestId("compras-uf-nota"), "a UF vai em maiúsculas").toHaveValue("SP");
  await fiscais.getByTestId("compras-tipo-documento-fiscal").selectOption("nfe");
  await fiscais.getByTestId("compras-valor-ipi").fill("10.00");
  await fiscais.getByTestId("compras-seguro").fill("5.50");
  await expect(page.getByTestId("compras-total"), "100,00 + IPI 10,00 + seguro 5,50").toContainText("115,50");
  // A classificação do item na tela manual (o que a nota antiga tinha): o item 1 é imobilizado; o rateio fica o do documento.
  const classificacao = fiscais.getByTestId("compras-item-classificacao-0");
  await expect(classificacao.getByTestId("compras-item-0-gera-estoque"), "premissa: o item nasce gerando estoque").toBeChecked();
  await classificacao.getByTestId("compras-item-0-imobilizado").check();
  await expect(fiscais.getByTestId("compras-rateio-tipo")).toHaveValue("documento");

  // NO FIO: só as chaves preenchidas, os valores em TEXTO, a chave sem os espaços
  const post = postDaCompra(page);
  await page.getByTestId("compras-salvar").click();
  const resposta = await post;
  expect(resposta.status(), "o lançamento foi aceito").toBe(201);
  const corpo = resposta.request().postDataJSON() as Record<string, unknown>;
  expect(corpo).toMatchObject({ chave_acesso: chave.valida, uf_nota: "SP", tipo_documento_fiscal: "nfe", valor_ipi: "10.00", seguro: "5.50" });
  for (const ausente of ["valor_icms_st", "tipo_titulo_id", "classificacao_gasto", "rateio"]) expect(Object.hasOwn(corpo, ausente), `${ausente} não preenchido não vai no corpo`).toBe(false);
  const item = (corpo["itens"] as Record<string, unknown>[])[0]!;
  expect(item["imobilizado"], "o item marcado vai imobilizado").toBe(true);
  for (const ausente of ["gera_estoque", "categoria_financeira_id", "centro_custo_id"]) expect(Object.hasOwn(item, ausente), `${ausente} no padrão não vai no item`).toBe(false);

  // NO SERVIDOR: gravou os dados e somou o total
  await expect(page).toHaveURL(/\/compras\/compras\/[0-9a-f-]{36}$/);
  const id = /\/compras\/compras\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const gravada = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/${id}`);
  expect(gravada).toMatchObject({
    situacao: "aberto", chave_acesso: chave.valida, uf_nota: "SP", tipo_documento_fiscal: "nfe", valor_ipi: "10.00", seguro: "5.50",
    valor_icms_st: null, valor_itens: "100.00", valor_total: "115.50"
  });
  expect((gravada["itens"] as Record<string, unknown>[]).map((i) => [i["imobilizado"], i["gera_estoque"]]), "o servidor gravou o item imobilizado").toEqual([[true, null]]);

  // NA CONSULTA: o total do servidor, IPI e seguro nos Totais, e a seção Dados fiscais na aba Fiscal
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId("compras-consulta-total")).toContainText("115,50");
  await expect(page.getByTestId("compras-consulta-total-ipi")).toContainText("10,00");
  await expect(page.getByTestId("compras-consulta-total-seguro")).toContainText("5,50");
  await expect(page.getByTestId("compras-consulta-total-icms-st"), "ICMS-ST não informado não aparece").toHaveCount(0);
  const aba = page.getByTestId(`${P}-painel`).getByRole("tab", { name: "Fiscal" });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
  const secao = page.getByTestId("compras-consulta-dados-fiscais");
  await expect(secao).toBeVisible();
  await expect(secao.getByTestId("compras-consulta-chave"), "a chave do servidor, em grupos de 4").toContainText(chave.valida.slice(0, 4) + " " + chave.valida.slice(4, 8));
  await expect(secao.getByTestId("compras-consulta-chave")).toContainText(chave.valida.slice(40));
  await expect(secao.getByTestId("compras-consulta-uf")).toContainText("SP");
  await expect(secao.getByTestId("compras-consulta-tipo-documento")).toContainText("NF-e");
  await expect(secao.getByTestId("compras-consulta-ipi")).toContainText("10,00");
  await expect(secao.getByTestId("compras-consulta-classificacao")).toContainText("Não classificado");
});

/* ═════════════════════════════════ FC-2 ═════════════════════════════════ */

test("FC-2 — chave de acesso com o DV errado: o servidor recusa no campo e nada é gravado", async ({ page }) => {
  await login(page);
  const c = await cenario(page);
  const chave = chaveSintetica();
  expect(chave.comDvErrado.slice(0, 43), "premissa: a chave recusada só difere da válida no DV").toBe(chave.valida.slice(0, 43));
  expect(chave.comDvErrado, "premissa: e tem 44 dígitos (a forma passa; só o DV falha)").toMatch(/^\d{44}$/);
  const fiscais = await compraNaCentral(page, c);

  await fiscais.getByTestId("compras-chave-acesso").fill(chave.comDvErrado);
  const post = postDaCompra(page);
  await page.getByTestId("compras-salvar").click();
  const resposta = await post;
  expect(resposta.status(), "o servidor recusa").toBe(422);
  const { error: erro } = (await resposta.json()) as { error: { code: string; details?: { path: string; message: string }[] } };
  expect(erro.code).toBe("VALIDATION_ERROR");
  expect(erro.details?.map((d) => d.path), "a recusa é no campo chave_acesso").toContain("chave_acesso");
  expect(resposta.request().postDataJSON(), "premissa: a chave foi no corpo").toMatchObject({ chave_acesso: chave.comDvErrado });

  // NA TELA: a mensagem no campo (os Dados adicionais continuam abertos), e a criação continua — nada gravado
  const campo = page.locator('[data-campo-fiscal="chave_acesso"]');
  await expect(campo.locator('[data-parte="erro"]')).toContainText("Chave de acesso inválida");
  await expect(page).toHaveURL(/\/compras\/compras\/new\?/);
  const lista = await api<{ items: unknown[] }>(page, "GET", `/api/compras/compras?fornecedor_id=${c.fornecedor.id}`);
  expect(lista.items, "nenhuma compra do fornecedor desta execução foi gravada").toHaveLength(0);
});
