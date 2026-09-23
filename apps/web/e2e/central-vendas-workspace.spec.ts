import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { login, api, uniq, pickRef, abrirLancamentoDeVendas, escolherTopEContinuar, abrirAbaDoLancamento } from "./helpers";

/**
 * CENTRAL DE VENDAS — WORKSPACE FOUNDATION (VISUAL-UX-01).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────┐
 * │ A fatia é VISUAL: a rota de criação passou a montar um workspace (barra de ações, Dados         │
 * │ principais, Itens, painel por abas, dois divisores). Os specs vizinhos continuam provando o     │
 * │ CONTRATO — TOP-first, fail-closed, rascunho, POST — e não foram afrouxados para acomodar o      │
 * │ redesenho: quem digita numa aba abre a aba primeiro, como o usuário faz.                        │
 * │                                                                                                  │
 * │ Aqui se mede o que a moldura nova promete e o que ela NÃO pode ter inventado: os campos          │
 * │ continuam ligados ao mesmo estado, o Salvar continua sujeito às mesmas condições, os divisores  │
 * │ funcionam por ponteiro e por teclado, NADA é persistido, e nenhuma ação do protótipo sem         │
 * │ contrato (Confirmar venda, Descartar, Editar, Anexos) apareceu — nem desabilitada.               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA ANTI-VACUIDADE ───────────────────────────────────────────────────────────────────────┐
 * │ Toda asserção de AUSÊNCIA vem depois de um sinal que só existe no estado final (o workspace      │
 * │ montado, o lançador renderizado). "Não tem Anexos" numa tela ainda em branco não prova nada.     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

const WORKSPACE = "central-vendas";
const DIVISOR_V = "central-vendas-divisor-vertical";
const DIVISOR_H = "central-vendas-divisor-horizontal";
/** Os limites do design aprovado — os mesmos exportados pelo componente; escritos aqui para o teste falhar se mudarem por acidente. */
const LARGURA = { min: 17, max: 52, padrao: 30 };
const ALTURA = { min: 92, max: 430, padrao: 206 };

/** Cadastra uma TOP de venda pela API administrativa; prefixo 5 para não colidir com os specs vizinhos. */
async function cadastrarTopDeVenda(page: Page) {
  const codigo = `5${Math.floor(Math.random() * 90000 + 10000)}`;
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: "vendas.venda", nome: uniq("Venda Central") });
  return { id: criado.id, codigo };
}

/** Abre `/vendas/sales/new` com uma TOP real e devolve só quando o workspace montou. */
async function abrirWorkspace(page: Page) {
  const top = await cadastrarTopDeVenda(page);
  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, top.id);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  return top;
}

const valorDo = async (page: Page, testId: string) => Number(await page.getByTestId(testId).getAttribute("aria-valuenow"));

/** Chaves do armazenamento do navegador — para provar que os divisores não deixaram rastro. */
const chavesDoNavegador = (page: Page) => page.evaluate(() => ({
  local: Object.keys(localStorage).sort(),
  sessao: Object.keys(sessionStorage).sort()
}));

test("W1 — sem TOP: o lançador aparece e o workspace NÃO existe na árvore", async ({ page }) => {
  await login(page);
  await abrirLancamentoDeVendas(page, "sales");
  // o lançador renderizado é o sinal de estado final; só depois dele a ausência prova alguma coisa
  await expect(page.getByTestId("top-lancador")).toBeVisible();
  await expect(page.getByTestId(WORKSPACE), "o workspace só nasce com a TOP validada").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salvar" }), "não existe Salvar fora do formulário").toHaveCount(0);
});

test("W2 — com TOP válida: barra, Dados principais, Itens, painel e as cinco abas", async ({ page }) => {
  await login(page);
  const top = await abrirWorkspace(page);

  const ws = page.getByTestId(WORKSPACE);
  await expect(ws.getByTestId("central-vendas-acoes")).toBeVisible();
  await expect(ws.getByTestId("central-vendas-dados")).toBeVisible();
  await expect(ws.getByTestId("central-vendas-itens")).toBeVisible();
  await expect(ws.getByTestId("central-vendas-painel")).toBeVisible();

  // a região de Dados principais é nomeada, e o contexto operacional mora no cabeçalho dela
  await expect(ws.getByRole("region", { name: "Dados principais" })).toBeVisible();
  await expect(ws.getByRole("region", { name: "Itens" })).toBeVisible();
  await expect(page.getByTestId("top-contexto")).toContainText(top.codigo);
  // a TOP é CONTEXTO (campo travado), nunca a identidade do documento — em criação ainda não há número
  await expect(page.getByTestId("central-vendas-identidade"), "o cabeçalho identifica o documento, não a operação").not.toContainText(top.codigo);

  const abas = ws.getByTestId("central-vendas-painel").getByRole("tab");
  await expect(abas).toHaveText(["Totais", "Financeiro", "Frete e transporte", "Fiscal", "Observações"]);
  await expect(abas.first(), "Totais abre selecionada").toHaveAttribute("aria-selected", "true");

  // a barra tem 44px FIXOS: trocar de estado não pode empurrar o corpo
  const barra = await ws.getByTestId("central-vendas-acoes").boundingBox();
  expect(barra?.height, "altura da barra de ações").toBe(44);
  const cabecalho = await ws.getByTestId("central-vendas-dados").locator("div").first().boundingBox();
  expect(cabecalho?.height, "altura do cabeçalho de Dados principais").toBe(42);
});

test("W3 — os campos das abas continuam ligados ao MESMO estado: o que se digita sobrevive à troca de aba", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);

  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("nota que atravessa as abas");
  await abrirAbaDoLancamento(page, "Frete e transporte");
  await page.getByLabel("Motorista").fill("Motorista da prova");
  await abrirAbaDoLancamento(page, "Totais");
  await page.getByLabel("Desconto").fill("12.5");
  await abrirAbaDoLancamento(page, "Fiscal");
  await page.getByLabel("Dedutível").selectOption("1");
  await abrirAbaDoLancamento(page, "Financeiro");
  await page.getByLabel("Parcelamento").selectOption("1");
  await expect(page.getByLabel("Nº de parcelas"), "o plano de parcelas existente aparece ao escolher Parcelado").toBeVisible();

  // voltando a cada aba, o valor é o que foi digitado — o estado é da página, não da aba
  await abrirAbaDoLancamento(page, "Observações");
  await expect(page.getByLabel("Observação")).toHaveValue("nota que atravessa as abas");
  await abrirAbaDoLancamento(page, "Frete e transporte");
  await expect(page.getByLabel("Motorista")).toHaveValue("Motorista da prova");
  await abrirAbaDoLancamento(page, "Totais");
  await expect(page.getByLabel("Desconto")).toHaveValue("12.5");
  await abrirAbaDoLancamento(page, "Fiscal");
  await expect(page.getByLabel("Dedutível")).toHaveValue("1");
});

test("W4 — Salvar continua sujeito às condições funcionais: cliente, item com produto, e o payload é o de antes", async ({ page }) => {
  await login(page);
  const top = await abrirWorkspace(page);
  const salvar = page.getByRole("button", { name: "Salvar" });

  await expect(salvar, "sem cliente e sem item, não salva").toBeDisabled();
  await pickRef(page, "Cliente", "DEMO");
  await expect(salvar, "cliente sem item, não salva").toBeDisabled();
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await expect(salvar, "item sem produto, não salva").toBeDisabled();
  const linha = page.locator("tbody tr").first();
  await linha.locator("button").nth(1).click();                       // 0 = Armazém, 1 = Produto
  await page.locator("[data-radix-popper-content-wrapper], div[role='dialog']").last().getByRole("option").first().click();
  await expect(salvar).toBeEnabled();

  // o que vai no corpo: os campos das abas, com o nome de antes, e o UUID da TOP validada
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("observação do payload");
  await abrirAbaDoLancamento(page, "Frete e transporte");
  await page.getByLabel("Motorista").fill("motorista do payload");

  let corpo: Record<string, unknown> | null = null;
  await page.route("**/api/sales/sales", async (rota) => {
    corpo = rota.request().postDataJSON() as Record<string, unknown>;
    await rota.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000000" }) });
  });
  await salvar.click();
  await expect.poll(() => corpo, { message: "o POST precisa ter saído" }).not.toBeNull();
  expect(corpo!["tipo_operacao_id"], "a TOP validada vai no corpo").toBe(top.id);
  expect(corpo!["note"]).toBe("observação do payload");
  expect(corpo!["driver_name"]).toBe("motorista do payload");
  expect(Object.keys(corpo!).sort(), "o contrato do payload é o MESMO de antes da fatia").toEqual([
    "client_id", "discount", "document_date", "driver_name", "due_date", "empresa_id", "freight", "freight_icms",
    "installment_plan", "is_deductible", "items", "note", "other_values", "payment_method_id", "proprietary_id",
    "shipping_date", "tipo_operacao_id", "transporter_id"
  ]);
  const item = (corpo!["items"] as Record<string, unknown>[])[0]!;
  expect(Object.keys(item).sort()).toEqual(["discount", "discount_percent", "note", "product_id", "quantity", "unit_price", "warehouse_id"]);
});

test("W5 — nenhuma escrita sem TOP confirmada AGORA: a lista muda, o rascunho fica, o POST não sai", async ({ page }) => {
  await login(page);
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/sales/")) posts.push(r.url()); });

  const ctrl: { corpo: unknown | null } = { corpo: null };
  await page.route("**/api/sales/sales/operation-types", async (rota) => {
    if (!ctrl.corpo) return rota.fallback();
    await rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ctrl.corpo) });
  });

  await abrirWorkspace(page);
  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  const linha = page.locator("tbody tr").first();
  await linha.locator("button").nth(1).click();
  await page.locator("[data-radix-popper-content-wrapper], div[role='dialog']").last().getByRole("option").first().click();
  await expect(page.getByRole("button", { name: "Salvar" }), "a PREMISSA: sem o bloqueio, salvaria").toBeEnabled();

  // o servidor continua compatível, mas a operação desta sessão saiu da lista
  ctrl.corpo = { contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: null, items: [{ id: "22222222-2222-4222-8222-222222222222", code: "70999", name: "Outra Venda Qualquer", version: 1, isDefault: false }] };
  await page.waitForTimeout(16_000);                                 // staleTime de lib/query.tsx
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });

  await expect(page.getByTestId("top-indisponivel")).toBeVisible();
  await expect(page.getByTestId(WORKSPACE), "o workspace continua montado, com o rascunho").toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar" })).toBeDisabled();
  /**
   * O GUARD ESTÁ NO HANDLER, não só no `disabled`. Um `dispatchEvent("click")` num botão desabilitado
   * NÃO chega ao handler (o React ignora clique em controle desabilitado), e tirar o atributo pelo DOM
   * também não prova nada — a primeira versão deste caso fazia as duas coisas e ficou VERDE com o guard
   * removido. O que o guard cobre é "qualquer caminho que chame submit sem passar pelo botão": então o
   * teste invoca o handler React do botão DIRETAMENTE, como faria um clique programático de verdade.
   */
  const salvar = page.getByRole("button", { name: "Salvar" });
  await salvar.evaluate((b) => {
    const chave = Object.keys(b).find((k) => k.startsWith("__reactProps"));
    const props = chave ? (b as unknown as Record<string, { onClick?: () => void }>)[chave] : undefined;
    if (!props?.onClick) throw new Error("o botão Salvar não expõe onClick — o teste não conseguiu chamar o handler");
    props.onClick();
  });
  await page.waitForTimeout(500);
  expect(posts, "ZERO POST — o handler foi chamado e o guard segurou").toEqual([]);
});

test("W6 — Alterar operação com rascunho pergunta antes; Fechar mantém o workspace inteiro", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("rascunho protegido");

  await page.getByTestId("top-alterar").click();
  const confirmacao = page.getByTestId("confirm-dialog");
  await expect(confirmacao).toBeVisible();
  await confirmacao.locator("button", { hasText: "Fechar" }).click();       // o botão de TEXTO; o × do cabeçalho também se chama Fechar
  await expect(confirmacao).toHaveCount(0);
  await expect(page.getByTestId(WORKSPACE), "enquanto não confirma, tudo continua").toBeVisible();
  await expect(page.getByLabel("Observação")).toHaveValue("rascunho protegido");

  // confirmando, volta ao lançador — e o workspace deixa de existir
  await page.getByTestId("top-alterar").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("top-lancador")).toBeVisible();
  await expect(page.getByTestId(WORKSPACE)).toHaveCount(0);
});

test("W7 — divisor vertical: arrastar com o ponteiro muda a largura de Dados principais dentro dos limites", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  const divisor = page.getByTestId(DIVISOR_V);
  const dados = page.getByTestId("central-vendas-dados");

  expect(await valorDo(page, DIVISOR_V)).toBe(LARGURA.padrao);
  const antes = (await dados.boundingBox())!.width;
  const caixa = (await divisor.boundingBox())!;
  const x = caixa.x + caixa.width / 2, y = caixa.y + caixa.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 120, y, { steps: 6 }); await page.mouse.up();

  const depois = (await dados.boundingBox())!.width;
  expect(depois, "a coluna cresceu com o arrasto").toBeGreaterThan(antes + 80);
  const valor = await valorDo(page, DIVISOR_V);
  expect(valor).toBeGreaterThan(LARGURA.padrao);
  expect(valor).toBeLessThanOrEqual(LARGURA.max);

  // arrastar muito além do limite trava no máximo — e o mínimo, no mínimo
  const c2 = (await divisor.boundingBox())!;
  await page.mouse.move(c2.x + 3, c2.y + 40); await page.mouse.down(); await page.mouse.move(c2.x + 2000, c2.y + 40, { steps: 4 }); await page.mouse.up();
  expect(await valorDo(page, DIVISOR_V)).toBe(LARGURA.max);
  const c3 = (await divisor.boundingBox())!;
  await page.mouse.move(c3.x + 3, c3.y + 40); await page.mouse.down(); await page.mouse.move(c3.x - 2000, c3.y + 40, { steps: 4 }); await page.mouse.up();
  expect(await valorDo(page, DIVISOR_V)).toBe(LARGURA.min);
});

test("W8 — divisor horizontal: arrastar para cima aumenta o painel inferior dentro dos limites", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  const divisor = page.getByTestId(DIVISOR_H);
  const painel = page.getByTestId("central-vendas-painel");

  expect(await valorDo(page, DIVISOR_H)).toBe(ALTURA.padrao);
  expect(Math.round((await painel.boundingBox())!.height), "a altura renderizada é a declarada").toBe(ALTURA.padrao);

  const caixa = (await divisor.boundingBox())!;
  const x = caixa.x + caixa.width / 2, y = caixa.y + caixa.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 100, { steps: 5 }); await page.mouse.up();
  expect(await valorDo(page, DIVISOR_H)).toBe(ALTURA.padrao + 100);
  expect(Math.round((await painel.boundingBox())!.height)).toBe(ALTURA.padrao + 100);

  const c2 = (await divisor.boundingBox())!;
  await page.mouse.move(c2.x + 40, c2.y + 3); await page.mouse.down(); await page.mouse.move(c2.x + 40, c2.y - 2000, { steps: 4 }); await page.mouse.up();
  expect(await valorDo(page, DIVISOR_H)).toBe(ALTURA.max);
  const c3 = (await divisor.boundingBox())!;
  await page.mouse.move(c3.x + 40, c3.y + 3); await page.mouse.down(); await page.mouse.move(c3.x + 40, c3.y + 2000, { steps: 4 }); await page.mouse.up();
  expect(await valorDo(page, DIVISOR_H)).toBe(ALTURA.min);
});

test("W9 — divisores por teclado: setas no eixo, Home e End; semântica de separator", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);

  for (const [id, eixo] of [[DIVISOR_V, "vertical"], [DIVISOR_H, "horizontal"]] as const) {
    const d = page.getByTestId(id);
    await expect(d).toHaveAttribute("role", "separator");
    await expect(d).toHaveAttribute("tabindex", "0");
    await expect(d).toHaveAttribute("aria-orientation", eixo);
    await expect(d).toHaveAttribute("aria-valuemin", String(eixo === "vertical" ? LARGURA.min : ALTURA.min));
    await expect(d).toHaveAttribute("aria-valuemax", String(eixo === "vertical" ? LARGURA.max : ALTURA.max));
    expect((await d.getAttribute("aria-label")) ?? "", "o separador tem nome acessível").not.toBe("");
  }

  const v = page.getByTestId(DIVISOR_V);
  await v.focus();
  await expect(v).toBeFocused();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  expect(await valorDo(page, DIVISOR_V)).toBe(LARGURA.padrao + 5);
  await page.keyboard.press("ArrowLeft");
  expect(await valorDo(page, DIVISOR_V)).toBe(LARGURA.padrao + 4);
  await page.keyboard.press("Home");
  expect(await valorDo(page, DIVISOR_V)).toBe(LARGURA.min);
  await page.keyboard.press("End");
  expect(await valorDo(page, DIVISOR_V)).toBe(LARGURA.max);
  await page.keyboard.press("ArrowRight");
  expect(await valorDo(page, DIVISOR_V), "não passa do máximo").toBe(LARGURA.max);

  const h = page.getByTestId(DIVISOR_H);
  await h.focus();
  await page.keyboard.press("ArrowUp");
  expect(await valorDo(page, DIVISOR_H), "seta para cima aumenta o painel").toBe(ALTURA.padrao + 8);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  expect(await valorDo(page, DIVISOR_H)).toBe(ALTURA.padrao - 8);
  await page.keyboard.press("End");
  expect(await valorDo(page, DIVISOR_H)).toBe(ALTURA.max);
  await page.keyboard.press("Home");
  expect(await valorDo(page, DIVISOR_H)).toBe(ALTURA.min);
  await page.keyboard.press("ArrowDown");
  expect(await valorDo(page, DIVISOR_H), "não passa do mínimo").toBe(ALTURA.min);
});

test("W10 — os divisores NÃO persistem: nada no armazenamento do navegador, e remontar devolve o padrão", async ({ page }) => {
  await login(page);
  const top = await abrirWorkspace(page);
  const antes = await chavesDoNavegador(page);

  await page.getByTestId(DIVISOR_V).focus(); await page.keyboard.press("End");
  await page.getByTestId(DIVISOR_H).focus(); await page.keyboard.press("End");
  expect(await valorDo(page, DIVISOR_V)).toBe(LARGURA.max);
  expect(await valorDo(page, DIVISOR_H)).toBe(ALTURA.max);

  const depois = await chavesDoNavegador(page);
  expect(depois, "redimensionar não escreveu NENHUMA chave nova").toEqual(antes);

  // a mesma URL, remontada: os divisores voltam ao padrão — não há onde ter guardado
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top.id}`);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  expect(await valorDo(page, DIVISOR_V)).toBe(LARGURA.padrao);
  expect(await valorDo(page, DIVISOR_H)).toBe(ALTURA.padrao);
});

test("W11 — a barra só tem ações que existem (e Documentos abertos, visão da barra de abas): nada de Anexos, Confirmar venda, Descartar ou Editar", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  const ws = page.getByTestId(WORKSPACE);

  const botoes = ws.getByTestId("central-vendas-acoes").getByRole("button");
  // os botões são só de ícone (linguagem da barra do design): o que se confere é o NOME acessível
  const nomes = await botoes.evaluateAll((els) => els.map((b) => b.getAttribute("aria-label") ?? (b.textContent ?? "").trim()));
  expect(nomes).toEqual(["Voltar", "Salvar", "Alterar operação", "Documentos abertos"]);
  // e todo botão só de ícone da barra tem dica textual
  const semDica = await botoes.evaluateAll((els) => els.filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("data-dica")).length);
  expect(semDica, "ação só de ícone sem dica").toBe(0);
  // nenhum botão só de ícone sem nome: todo botão do workspace tem nome acessível
  const semNome = await ws.getByRole("button").evaluateAll((els) => els.filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title")).length);
  expect(semNome, "botões sem nome acessível no workspace").toBe(0);

  for (const proibida of [/anexo/i, /confirmar venda/i, /descartar/i, /^editar$/i]) {
    await expect(ws.getByRole("button", { name: proibida }), `ação sem contrato não aparece: ${proibida}`).toHaveCount(0);
    await expect(ws.getByRole("tab", { name: proibida })).toHaveCount(0);
  }
  await expect(ws.getByText(/anexos/i), "nem como texto, nem como 'em breve'").toHaveCount(0);
});

test("W12 — prefers-reduced-motion zera as transições do workspace", async ({ page }) => {
  await login(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await abrirWorkspace(page);
  const aba = page.getByTestId("central-vendas-painel").getByRole("tab").first();
  const duracoes = await aba.evaluate((el) => { const cs = getComputedStyle(el); return { transicao: cs.transitionDuration, animacao: cs.animationDuration }; });
  expect(duracoes.transicao.split(",").every((d) => parseFloat(d) === 0), `transição: ${duracoes.transicao}`).toBe(true);
  const painel = page.getByTestId("central-vendas-painel").getByRole("tabpanel").locator("> *").first();
  expect(await painel.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  const comMovimento = await aba.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(comMovimento.split(",").some((d) => parseFloat(d) > 0), "sem a preferência, há transição — senão o teste acima seria vazio").toBe(true);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * R1 — FIDELIDADE: itens em três visões sobre o MESMO estado, seleção, pesquisa real ancorada
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

const linhaDaGrade = (page: Page, i: number) => page.getByTestId("central-vendas-linha").nth(i);
const painelDePesquisa = (page: Page) => page.getByTestId("central-vendas-pesquisa");

/** Adiciona um item e escolhe o N-ésimo produto REAL pela pesquisa ancorada na célula. */
async function adicionarItemComProduto(page: Page, n = 0) {
  const antes = await page.getByTestId("central-vendas-linha").count();
  await page.getByRole("button", { name: "Adicionar item" }).click();
  await expect(page.getByTestId("central-vendas-linha")).toHaveCount(antes + 1);
  await linhaDaGrade(page, antes).getByTestId("central-vendas-produto").click();
  const opcoes = painelDePesquisa(page).getByRole("option");
  await expect(opcoes.first(), "a pesquisa traz produtos reais do seed").toBeVisible();
  const rotulo = (await opcoes.nth(n).locator("span").last().innerText()).trim();
  await opcoes.nth(n).click();
  await expect(painelDePesquisa(page)).toHaveCount(0);
  await expect(linhaDaGrade(page, antes).getByTestId("central-vendas-produto")).toContainText(rotulo);
  return rotulo;
}

test("W13 — três visões do MESMO items: Grade, Formulário e Grade e formulário; trocar não perde nada", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  const p1 = await adicionarItemComProduto(page, 0);
  const p2 = await adicionarItemComProduto(page, 1);
  await expect(page.getByTestId("central-vendas-itens-contagem")).toHaveText("(2)");

  // o último adicionado fica selecionado; o formulário mostra ESSE item
  await page.getByRole("button", { name: "Formulário", exact: true }).click();
  await expect(page.getByRole("button", { name: "Formulário", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("central-vendas-grade"), "Formulário esconde a grade").toHaveCount(0);
  await expect(page.getByTestId("central-vendas-item-posicao")).toHaveText("Item 2 de 2");
  const form = page.getByTestId("central-vendas-item-form");
  await expect(form).toContainText(p2);

  // editar no formulário grava no MESMO item
  await form.getByLabel("Quantidade").fill("7");
  await form.getByRole("button", { name: "Item anterior" }).click();
  await expect(page.getByTestId("central-vendas-item-posicao")).toHaveText("Item 1 de 2");
  await expect(form).toContainText(p1);

  // de volta à grade: a quantidade digitada no formulário está na linha 2; nada foi perdido
  await page.getByRole("button", { name: "Grade", exact: true }).click();
  await expect(page.getByTestId("central-vendas-linha")).toHaveCount(2);
  await expect(linhaDaGrade(page, 1).locator("td").nth(5)).toHaveText("7");

  // Grade e formulário: as duas ao mesmo tempo, sobre o mesmo item selecionado
  await linhaDaGrade(page, 1).click();
  await page.getByRole("button", { name: "Grade e formulário" }).click();
  await expect(page.getByTestId("central-vendas-grade")).toBeVisible();
  await expect(page.getByTestId("central-vendas-item-form")).toBeVisible();
  await linhaDaGrade(page, 1).getByLabel("Quantidade").fill("9");
  await expect(page.getByTestId("central-vendas-item-form").getByLabel("Quantidade"), "a grade e o formulário são o MESMO estado").toHaveValue("9");
});

test("W14 — seleção de linha: clique, teclado (↑ ↓ Enter) e nenhuma seleção órfã ao excluir", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  await adicionarItemComProduto(page, 0);
  await adicionarItemComProduto(page, 1);
  await adicionarItemComProduto(page, 2);

  await linhaDaGrade(page, 0).click();
  await expect(linhaDaGrade(page, 0)).toHaveAttribute("aria-selected", "true");
  await expect(linhaDaGrade(page, 0).getByLabel("Quantidade"), "os campos editáveis aparecem na linha selecionada").toBeVisible();
  await expect(linhaDaGrade(page, 1).getByLabel("Quantidade"), "e só nela").toHaveCount(0);

  await linhaDaGrade(page, 0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(linhaDaGrade(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(linhaDaGrade(page, 1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(linhaDaGrade(page, 1)).toHaveAttribute("aria-selected", "true");

  // excluir a última linha selecionada: a seleção passa para uma linha que EXISTE
  await linhaDaGrade(page, 2).click();
  await linhaDaGrade(page, 2).getByRole("button", { name: "Excluir item 3" }).click();
  await expect(page.getByTestId("central-vendas-linha")).toHaveCount(2);
  await expect(page.locator('[data-testid="central-vendas-linha"][aria-selected="true"]'), "exatamente uma linha selecionada, e ela existe").toHaveCount(1);
  await expect(linhaDaGrade(page, 1)).toHaveAttribute("aria-selected", "true");
});

test("W15 — pesquisa de produto: ancorada à célula, fonte real, teclado ↑ ↓ Enter Esc", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  const buscas: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname === "/api/resources/products/options") buscas.push(u.searchParams.get("search") ?? ""); });

  await page.getByRole("button", { name: "Adicionar item" }).click();
  const celula = linhaDaGrade(page, 0).getByTestId("central-vendas-produto");
  await celula.click();
  const painel = painelDePesquisa(page);
  await expect(painel).toBeVisible();
  await expect(painel).toHaveAttribute("data-modo", "flutuante");

  // o painel entra subindo 7px e crescendo de 98,5% (movimento do design): mede-se DEPOIS da entrada,
  // porque a geometria que o contrato fixa é a do painel assentado, não a de um quadro da animação
  await painel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  // ancorado: começa logo abaixo da célula, alinhado a ela, sem cobrir o cabeçalho da grade
  const c = (await celula.locator("xpath=ancestor::td").boundingBox())!;
  const b = (await painel.boundingBox())!;
  const cab = (await page.getByTestId("central-vendas-grade").locator("thead").boundingBox())!;
  expect(Math.abs(b.y - (c.y + c.height)), "o topo do painel encosta na base da célula").toBeLessThanOrEqual(4);
  expect(Math.abs(b.x - c.x), "alinhado à célula").toBeLessThanOrEqual(2);
  expect(b.y, "o cabeçalho da grade não é coberto").toBeGreaterThanOrEqual(cab.y + cab.height);
  expect(Math.round(b.width), "a largura do design").toBe(640);

  // a busca é a do servidor
  const opcoes = painel.getByRole("option");
  await expect(opcoes.first()).toBeVisible();
  const total = await opcoes.count();
  expect(total, "a premissa: há mais de uma opção para o teclado andar").toBeGreaterThan(1);
  const alvo = (await opcoes.nth(1).locator("span").last().innerText()).trim();
  const termo = alvo.slice(0, 4);
  await page.keyboard.type(termo);
  await expect.poll(() => buscas.includes(termo), { message: "a digitação virou busca no endpoint REAL de opções" }).toBe(true);
  await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace");
  await expect(opcoes).toHaveCount(total);

  // Esc fecha sem escolher
  await page.keyboard.press("Escape");
  await expect(painel).toHaveCount(0);
  await expect(celula).toContainText("Pesquisar produto");

  // reabrir: a busca começa limpa; ↓ Enter escolhe a SEGUNDA opção
  await celula.click();
  await expect(painel.getByRole("combobox")).toHaveValue("");
  await expect(painel.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(painel.getByRole("option").nth(1)).toHaveAttribute("data-ativa", "true");
  await page.keyboard.press("Enter");
  await expect(painel).toHaveCount(0);
  await expect(celula).toContainText(alvo);
});

test("W16 — no formulário do item a pesquisa abre EM FLUXO e empurra os campos seguintes", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  await adicionarItemComProduto(page, 0);
  await page.getByRole("button", { name: "Formulário", exact: true }).click();
  const form = page.getByTestId("central-vendas-item-form");
  const armazem = form.getByLabel("Armazém");
  const antes = (await armazem.boundingBox())!.y;
  await form.getByLabel("Produto").click();
  await expect(painelDePesquisa(page)).toHaveAttribute("data-modo", "fluxo");
  const depois = (await armazem.boundingBox())!.y;
  expect(depois - antes, "o campo seguinte desceu: o painel está no fluxo, não por cima").toBeGreaterThan(100);
  await page.keyboard.press("Escape");
  await expect(painelDePesquisa(page)).toHaveCount(0);
});

test("W17 — as visões não mudam o payload: quantidade do formulário e produto da pesquisa chegam no POST", async ({ page }) => {
  await login(page);
  const top = await abrirWorkspace(page);
  await pickRef(page, "Cliente", "DEMO");
  await adicionarItemComProduto(page, 0);
  await page.getByRole("button", { name: "Formulário", exact: true }).click();
  await page.getByTestId("central-vendas-item-form").getByLabel("Quantidade").fill("3");

  let corpo: Record<string, unknown> | null = null;
  const chamadas: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/") && r.method() !== "GET") chamadas.push(`${r.method()} ${u.pathname}`); });
  await page.route("**/api/sales/sales", async (rota) => {
    corpo = rota.request().postDataJSON() as Record<string, unknown>;
    await rota.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000000" }) });
  });
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => corpo).not.toBeNull();
  expect(corpo!["tipo_operacao_id"]).toBe(top.id);
  const item = (corpo!["items"] as Record<string, unknown>[])[0]!;
  expect(item["quantity"]).toBe("3");
  expect(typeof item["product_id"] === "string" && (item["product_id"] as string).length === 36, "o produto escolhido na pesquisa é um UUID real").toBe(true);
  expect(Object.keys(item).sort()).toEqual(["discount", "discount_percent", "note", "product_id", "quantity", "unit_price", "warehouse_id"]);
  expect(chamadas, "nenhuma escrita além do POST de criação — a apresentação não chama API nova").toEqual(["POST /api/sales/sales"]);
});

test("W18 — Documentos abertos é VISÃO da barra de abas: lista a aba desta criação, com o ponto de alteração", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("rascunho visível");
  await expect(page.getByTestId("central-vendas-alterado"), "o cabeçalho marca alteração não salva").toBeVisible();
  await page.getByTestId("central-vendas-documentos").click();
  const lista = page.getByTestId("central-vendas-documentos-lista");
  await expect(lista).toBeVisible();
  const atual = lista.locator('[aria-current="page"]');
  await expect(atual).toHaveCount(1);
  await expect(atual).toContainText("Nova Venda");
  await expect(atual.getByRole("img", { name: "Alterações não salvas" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lista).toHaveCount(0);
});

test("W19 — evidência visual desktop: 1440×900 e 1280×800, pesquisa, visões de itens e painel inferior", async ({ page }) => {
  await login(page);
  const top = await abrirWorkspace(page);
  const pasta = process.env.EVIDENCIA_DIR ?? path.resolve("test-results", "evidencia-visual-ux-01");
  fs.mkdirSync(pasta, { recursive: true });
  // espera a animação de entrada (230ms) terminar: a foto é do estado assentado, não da transição
  const foto = async (nome: string) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(pasta, `${nome}.png`), fullPage: false }); };

  for (const [w, h] of [[1440, 900], [1280, 800]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/vendas/sales/new?tipo_operacao_id=${top.id}`);
    await expect(page.getByTestId(WORKSPACE)).toBeVisible();
    await pickRef(page, "Cliente", "DEMO");
    await adicionarItemComProduto(page, 0);
    await adicionarItemComProduto(page, 1);
    await linhaDaGrade(page, 0).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `rolagem horizontal em ${w}×${h}`).toBeLessThanOrEqual(0);
    for (const id of ["central-vendas-acoes", "central-vendas-dados", "central-vendas-itens", "central-vendas-painel"]) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.y + b.height, `${id} cabe em ${w}×${h}`).toBeLessThanOrEqual(h + 1);
    }
    await foto(`implementation-${w}x${h}`);
    if (w !== 1440) continue;
    await foto("items-grid");
    await page.getByRole("button", { name: "Adicionar item" }).click();
    await linhaDaGrade(page, 2).getByTestId("central-vendas-produto").click();
    await expect(painelDePesquisa(page).getByRole("option").first()).toBeVisible();
    await foto("product-lookup");
    await page.keyboard.press("Escape");
    await linhaDaGrade(page, 2).getByRole("button", { name: "Excluir item 3" }).click();
    await linhaDaGrade(page, 0).click();
    await page.getByRole("button", { name: "Formulário", exact: true }).click();
    await foto("items-form");
    await page.getByRole("button", { name: "Grade e formulário" }).click();
    await foto("items-split");
    await page.getByRole("button", { name: "Grade", exact: true }).click();
    await abrirAbaDoLancamento(page, "Frete e transporte");
    await page.getByTestId(DIVISOR_H).focus(); for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
    await page.getByTestId(DIVISOR_V).focus(); for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await page.mouse.move(5, 5);
    await foto("bottom-panel");
  }
});
