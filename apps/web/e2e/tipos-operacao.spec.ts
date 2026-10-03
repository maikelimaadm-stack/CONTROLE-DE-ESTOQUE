import { test, expect, type Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { catalogoPublicadoE2E, escolherTipoNoAssistente } from "./top-config-08-comum";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — o caminho que o usuário faz de verdade.
 *
 * O teste de integração já prova a autorização e as invariantes contra o servidor. O que só este arquivo
 * pode provar é que a TELA existe, que a navegação chega até ela e que a sequência real —
 * cadastrar → editar → ver a versão 2 → definir padrão → desativar — funciona ponta a ponta, com o dado
 * indo ao banco e voltando.
 *
 * OPERACOES-01 F4 (decisão 281): com o servidor que declara o formato 5, cadastrar começa pelo TIPO DE MOVIMENTO
 * (o passo 1, o assistente) e o código e o nome vêm depois; os tipos oferecidos são os do catálogo que o servidor
 * publica, só os que já têm tela.
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
  // O tipo de movimento vem PRIMEIRO, do catálogo que o SERVIDOR publica (a tela não tem lista própria); o código e o
  // nome, depois. Decisão 261: o rótulo de tela da família da TOP passou a ser "Movimento" (só texto; código/API
  // seguem `familia`).
  await escolherTipoNoAssistente(forma, "vendas.venda");
  await forma.getByLabel("Código").fill(codigo);
  await forma.getByLabel("Nome").fill(nome);
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
  // Decisão 261: o rótulo de tela da família da TOP passou a ser "Movimento" (só texto; código/API seguem `familia`).
  await expect(edicao.getByTestId("top-campo-familia")).toBeDisabled();
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

test("exclui pela tela — e a tela ENVIA a revisão da linha", async ({ page }) => {
  // A exclusão é escrita otimista como qualquer outra: sem a revisão, um DELETE feito com a tela velha
  // venceria em silêncio uma edição que o usuário nunca viu. O servidor passou a EXIGIR a revisão, e uma
  // tela que não a mandasse quebraria com 422 — falha que nenhum teste de servidor pode ver.
  await login(page);
  await abrirTela(page);

  const codigo = `22${Date.now().toString().slice(-4)}`;
  await page.getByRole("button", { name: "Novo tipo de operação" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  // O passo 1 primeiro (o tipo de movimento); o código e o nome são do passo 2.
  await escolherTipoNoAssistente(forma, "vendas.orcamento");
  await forma.getByLabel("Código").fill(codigo);
  await forma.getByLabel("Nome").fill(uniq("Para excluir"));
  await forma.getByRole("button", { name: "Salvar" }).click();
  await expect(forma).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: codigo }).first()).toBeVisible();

  const exclusoes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE" && r.url().includes("/api/admin/tipos-operacao/")) exclusoes.push(r.url());
  });

  await abrirMenuDaLinha(page, codigo);
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  await page.getByTestId("confirm-dialog-confirm").click();

  await expect(page.getByRole("row").filter({ hasText: codigo })).toHaveCount(0);
  expect(exclusoes.length, "a tela chamou a exclusão exatamente uma vez").toBe(1);
  // A asserção que importa: o número vai no pedido. Sem ela, a exclusão poderia estar passando por o
  // servidor ter voltado a aceitar DELETE sem revisão — e o teste "verde" esconderia a regressão.
  expect(exclusoes[0]).toMatch(/[?&]revisao=\d+/);
});

test("os tipos de movimento oferecidos no passo 1 vêm do catálogo publicado pelo servidor (só os que têm tela), não de uma lista da tela", async ({ page }) => {
  await login(page);
  // AS PREMISSAS, LIDAS NO SERVIDOR: o catálogo publicado tem os 22 tipos COM tela (os 9 com documento, o orçamento de
  // compra — F6b —, a requisição de material, o consumo e a devolução de consumo — F5b —, os 6 de Módulos — F10 — e os 3
  // do Financeiro — F9), e o registry (`/familias`, que continua devolvendo TODAS as famílias) tem 30 — 8 delas sem tela
  // no passo 1 (as telas antigas de estoque e a solicitação de compra).
  // Sem as famílias sem tela, "nenhuma delas aparece" seria verdade de graça.
  const catalogo = await catalogoPublicadoE2E(page);
  const comTela = catalogo.tipos.filter((t) => t.temTela).map((t) => t.familia);
  expect(comTela, "premissa: o catálogo publicado tem 22 tipos com tela").toHaveLength(22);
  expect(comTela.every((f) => typeof f === "string"), "premissa: todo tipo com tela tem família").toBe(true);
  const modulos = catalogo.tipos.filter((t) => t.grupo === "modulos");
  expect(modulos.map((t) => [t.chave, t.temTela]), "premissa: os 6 de Módulos têm tela desde a F10, na ordem do catálogo")
    .toEqual([["abastecimento", true], ["manutencao", true], ["ordem_servico", true], ["manejo", true], ["batelada", true], ["producao_racao", true]]);
  const doServidor = await api<{ items: { codigo: string }[] }>(page, "GET", "/api/admin/tipos-operacao/familias");
  expect(doServidor.items, "premissa: o registry inteiro tem 30 famílias (28 + o manejo e a batelada da F10)").toHaveLength(30);
  for (const t of modulos) expect(doServidor.items.map((f) => f.codigo), `premissa: a família de ${t.chave} está no registry`).toContain(t.familia);
  const semTela = doServidor.items.map((f) => f.codigo).filter((f) => !comTela.includes(f));
  expect(semTela, "premissa: 8 famílias do registry não têm tela no passo 1").toHaveLength(8);
  for (const f of ["estoque.requisicao_material", "estoque.consumo", "estoque.devolucao_consumo"]) {
    expect(doServidor.items.map((x) => x.codigo), `premissa: a família ${f} (F5a) existe no registry`).toContain(f);
    expect(comTela, `a família ${f} tem tela desde a F5b`).toContain(f);
    expect(semTela, `e por isso não está entre as sem tela: ${f}`).not.toContain(f);
  }
  expect(comTela, "premissa: compras.orcamento (F6b) tem tela").toContain("compras.orcamento");

  await abrirTela(page);
  await page.getByRole("button", { name: "Novo tipo de operação" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma.getByTestId("top-assistente"), "a criação começa pelo passo 1").toBeVisible();
  // Decisão 261: o rótulo de tela da família da TOP passou a ser "Movimento" — e no passo 1 nem há o campo: o seletor
  // plano das 23 famílias deu lugar aos tipos agrupados.
  await expect(forma.getByTestId("top-campo-familia"), "o seletor de família não existe no passo 1").toHaveCount(0);
  const oferecidas = await forma.locator("[data-testid^='top-assistente-tipo-']").evaluateAll((bs) =>
    bs.map((b) => b.getAttribute("data-familia")));
  // Uma lista digitada na tela divergiria aqui no primeiro tipo que ganhasse tela — e é exatamente essa divergência
  // silenciosa que o gate estático e esta asserção existem para tornar barulhenta. A ORDEM é a do catálogo.
  expect(oferecidas, "os tipos oferecidos são os com tela do catálogo publicado, na ordem dele").toEqual(comTela);
  for (const f of semTela) expect(oferecidas, `a família sem tela ${f} não é oferecida`).not.toContain(f);
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
  await expect(page.getByTestId("central-vendas")).toBeVisible();
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
