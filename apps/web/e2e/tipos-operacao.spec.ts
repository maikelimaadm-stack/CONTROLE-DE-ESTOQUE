import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva } from "./helpers";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — o caminho que o usuário faz de verdade.
 *
 * O teste de integração já prova a autorização e as invariantes contra o servidor. O que só este arquivo
 * pode provar é que a TELA existe, que a navegação chega até ela e que a sequência real —
 * cadastrar → editar → ver a versão 2 → definir padrão → desativar — funciona ponta a ponta, com o dado
 * indo ao banco e voltando.
 */
const ROTA = "/configuracoes?tab=operacoes&sub=tipos-operacao";

/** Abre a tela e espera o painel, não um spinner. */
async function abrirTela(page: Page) {
  await page.goto(ROTA);
  await expect(page.getByRole("heading", { name: "Tipos de Operação" })).toBeVisible();
}

async function abrirMenuDaLinha(page: Page, codigo: string) {
  const linha = page.getByRole("row").filter({ hasText: codigo }).first();
  await expect(linha).toBeVisible();
  await linha.getByRole("button", { name: "Mais opções" }).click();
}

test("cadastra, edita (versão 2), define padrão e desativa um tipo de operação", async ({ page }) => {
  await login(page);
  await abrirTela(page);

  // ---- cadastrar ----
  const codigo = `21${Date.now().toString().slice(-4)}`;
  const nome = uniq("Venda de Gado a Prazo");
  await page.getByRole("button", { name: "Novo tipo de operação" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  await forma.getByLabel("Código").fill(codigo);
  await forma.getByLabel("Nome").fill(nome);
  // A família vem do SERVIDOR (derivada do registry); a tela não tem catálogo próprio.
  await forma.getByLabel("Família operacional").selectOption("vendas.venda");
  await forma.getByRole("button", { name: "Salvar" }).click();
  await expect(forma).toBeHidden();

  const linha = page.getByRole("row").filter({ hasText: codigo }).first();
  await expect(linha).toBeVisible();
  // O rótulo humano da família aparece, não só a chave técnica.
  await expect(linha).toContainText("Venda");
  await expect(linha).toContainText("vendas.venda");

  // ---- editar o nome: nasce a versão 2, e a 1 continua legível ----
  await abrirMenuDaLinha(page, codigo);
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const edicao = page.getByTestId("form-tipo-operacao");
  await expect(edicao).toBeVisible();
  // Identidade é imutável: a tela nem oferece o caminho.
  await expect(edicao.getByLabel("Código")).toBeDisabled();
  await expect(edicao.getByLabel("Família operacional")).toBeDisabled();
  const nomeCorrigido = `${nome} (corrigido)`;
  await edicao.getByLabel("Nome").fill(nomeCorrigido);
  await edicao.getByRole("button", { name: "Salvar" }).click();
  await expect(edicao).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: codigo }).first()).toContainText(nomeCorrigido);

  await abrirMenuDaLinha(page, codigo);
  await page.getByRole("menuitem", { name: "Ver versões" }).click();
  const versoes = page.getByTestId("versoes-tipo-operacao");
  await expect(versoes).toBeVisible();
  await expect(versoes).toContainText(nomeCorrigido);
  // A PROVA QUE IMPORTA: o nome ANTIGO continua no histórico. Se a edição tivesse sobrescrito a versão,
  // tudo acima passaria igual e só esta asserção notaria.
  await expect(versoes).toContainText(nome);
  await page.keyboard.press("Escape");
  await expect(versoes).toBeHidden();

  // ---- definir como padrão ----
  await abrirMenuDaLinha(page, codigo);
  await page.getByRole("menuitem", { name: "Definir como padrão" }).click();
  await expect(page.getByRole("row").filter({ hasText: codigo }).first()).toContainText("Padrão");

  // ---- desativar: perde o posto de padrão na mesma operação ----
  await abrirMenuDaLinha(page, codigo);
  await page.getByRole("menuitem", { name: "Desativar" }).click();
  const depois = page.getByRole("row").filter({ hasText: codigo }).first();
  await expect(depois).toContainText("Inativo");
  await expect(depois, "padrão inativo seria oferecido a ninguém e bloquearia o posto").not.toContainText("Padrão");
});

test("a família operacional oferecida vem do servidor, não de uma lista da tela", async ({ page }) => {
  await login(page);
  const doServidor = await api<{ items: { codigo: string }[] }>(page, "GET", "/api/admin/tipos-operacao/familias");
  await abrirTela(page);
  await page.getByRole("button", { name: "Novo tipo de operação" }).click();
  const seletor = page.getByTestId("form-tipo-operacao").getByLabel("Família operacional");
  const opcoes = await seletor.locator("option").evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  // Uma lista digitada na tela divergiria aqui na primeira família nova — e é exatamente essa divergência
  // silenciosa que o gate estático e esta asserção existem para tornar barulhenta.
  expect(opcoes.sort()).toEqual(doServidor.items.map((f) => f.codigo).sort());
});

test("REGRESSÃO: o detalhe do Modelo Base 2 não passou a depender da API administrativa", async ({ page }) => {
  await login(page);
  // A classificação nas telas de lançamento continua saindo do registry em memória. Se alguma delas passar
  // a consultar `/api/admin/tipos-operacao`, a tela ganha uma dependência de rede que hoje não tem — e o
  // usuário sem a capacidade `tipos_operacao.view` veria a tela de lançamento quebrar.
  const chamadas: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/admin/tipos-operacao")) chamadas.push(r.url()); });

  // Fixture pela API real, como os demais E2E de vendas — não depender do acervo do seed evita um teste
  // que passa por acidente quando a organização já tem venda e some quando não tem.
  const empresa = await empresaAtiva(page);
  const clientes = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/people?is_client=true&pageSize=1");
  const produtos = await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/products?pageSize=1");
  const armazens = await api<{ items: { id: string }[] }>(page, "GET", `/api/resources/warehouses?empresa_id=${empresa}&pageSize=1`);
  const criado = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: clientes.items[0]!.id,
    items: [{ product_id: produtos.items[0]!.id, warehouse_id: armazens.items[0]!.id, quantity: "1", unit_price: "10.00" }]
  });

  await page.goto(`/vendas/sales/${criado.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  expect(chamadas, "nenhuma chamada à API administrativa a partir do detalhe de venda").toEqual([]);
});

test("PERMISSÃO: quem não tem a capacidade não recebe as ações nem a sub-área", async ({ page }) => {
  // O operador do seed não tem nenhuma permissão `tipos_operacao.*`. O servidor já nega (provado em
  // integração, 403 nas quatro ações); aqui prova-se a outra metade do contrato: a tela não OFERECE o que
  // o servidor vai recusar. Controle que aparece e não funciona é pior do que controle ausente.
  await login(page, { email: "operador@demo.local", password: "Demo@12345" });

  // A sub-área nem entra na navegação, porque `nav.registry.mjs` amarra a entrada à permissão.
  await page.goto("/configuracoes");
  await expect(page.getByRole("tab", { name: "Operações" })).toHaveCount(0);

  // E, mesmo entrando pela rota direta, nenhuma ação de escrita é oferecida.
  await page.goto(ROTA);
  await expect(page.getByRole("button", { name: "Novo tipo de operação" })).toHaveCount(0);
});
