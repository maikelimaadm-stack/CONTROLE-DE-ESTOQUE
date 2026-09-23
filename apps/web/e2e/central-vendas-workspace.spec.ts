import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { login, api, uniq, pickRef, abrirLancamentoDeVendas, escolherTopEContinuar, abrirAbaDoLancamento, escolherPrimeiroProdutoDaLinha } from "./helpers";

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
  await escolherPrimeiroProdutoDaLinha(page);
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
  await escolherPrimeiroProdutoDaLinha(page);
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
  // a coluna 6 (índice 5) é Quantidade: o NÚMERO é o que foi digitado; a unidade do produto vem ao lado, à parte
  await expect(linhaDaGrade(page, 1).locator("td").nth(5).getByTestId("central-vendas-quantidade")).toHaveText("7,00");

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
  const atual = lista.locator('[data-testid="central-vendas-documento"][data-atual="true"]');
  await expect(atual).toHaveCount(1);
  await expect(atual.getByTestId("central-vendas-documento-titulo")).toHaveText("Nova Venda");
  await expect(atual.getByRole("button", { name: /^Trabalhar em Nova Venda/ })).toHaveAttribute("aria-current", "page");
  await expect(atual.getByRole("img", { name: "Alterações não salvas" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lista).toHaveCount(0);
});

test("W19 — evidência visual desktop: 1440×900 e 1280×800, pesquisa, visões, configuração, painel, documentos abertos e unidade", async ({ page }) => {
  await login(page);
  const salvo = await documentoSalvo(page);
  await page.goto(`/vendas/sales/${salvo.id}`);
  await expect(aba(page, `/vendas/sales/${salvo.id}`)).toHaveCount(1);
  const top = await cadastrarTopDeVenda(page);
  const pasta = process.env.EVIDENCIA_DIR ?? path.resolve("test-results", "evidencia-visual-ux-01");
  fs.mkdirSync(pasta, { recursive: true });
  // espera a animação de entrada (230ms) terminar: a foto é do estado assentado, não da transição
  const foto = async (nome: string) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(pasta, `${nome}.png`), fullPage: false }); };

  for (const [w, h] of [[1440, 900], [1280, 800]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/vendas/sales/new?tipo_operacao_id=${top.id}`);
    await expect(page.getByTestId(WORKSPACE)).toBeVisible();
    await expect(page.locator('nav[aria-label="Navegação"]'), "workspace imersivo: sem trilha acima da moldura").toHaveCount(0);
    await pickRef(page, "Cliente", "DEMO");
    await adicionarItemComProduto(page, 0);
    await adicionarItemComProduto(page, 1);
    await linhaDaGrade(page, 0).click();
    await expect(linhaDaGrade(page, 0).getByTestId("central-vendas-unidade"), "a unidade chegou antes da foto").toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `rolagem horizontal em ${w}×${h}`).toBeLessThanOrEqual(0);
    for (const id of ["central-vendas-acoes", "central-vendas-dados", "central-vendas-itens", "central-vendas-painel"]) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.y + b.height, `${id} cabe em ${w}×${h}`).toBeLessThanOrEqual(h + 1);
    }
    await page.mouse.move(5, h - 5);
    await foto(`implementation-r2-${w}x${h}`);
    if (w !== 1440) continue;
    await foto("items-grid");
    await foto("item-unit");
    await foto("bottom-panel-expanded");
    await page.getByRole("button", { name: "Configurar colunas" }).click();
    await expect(page.getByTestId("central-vendas-configuracao")).toBeVisible();
    await foto("column-config");
    await page.keyboard.press("Escape");
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
    await page.getByTestId("central-vendas-recolher").click();
    await page.mouse.move(5, h - 5);
    await foto("bottom-panel-collapsed");
    await page.getByTestId("central-vendas-recolher").click();
    await abrirAbaDoLancamento(page, "Frete e transporte");
    await page.getByTestId(DIVISOR_H).focus(); for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
    await page.getByTestId(DIVISOR_V).focus(); for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await page.mouse.move(5, h - 5);
    await foto("bottom-panel");
    await page.getByTestId("central-vendas-documentos").click();
    await expect(page.getByTestId("central-vendas-documento-titulo").first()).toHaveText(salvo.code);
    await foto("open-documents");
    await page.getByRole("textbox", { name: "Pesquisar documento aberto" }).fill(salvo.code);
    await foto("open-documents-search");
  }
});

/* ════════════════════════════════ R2 — fechamento de fidelidade ════════════════════════════════ */

const ROTULOS_DA_GRADE = ["Código", "Produto", "Armazém", "Estoque", "Quantidade", "Valor unitário", "Desconto", "Desconto %", "Total"];
/** Os títulos das colunas da grade, sem a coluna da lixeira (que não tem texto). */
const cabecalhos = async (page: Page) => (await page.getByTestId("central-vendas-grade").locator("thead th").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
const aba = (page: Page, chave: string) => page.locator(`[data-testid="workspace-tab"][data-tab-key="${chave}"]`);
const alturaDoPainel = async (page: Page) => Math.round((await page.getByTestId("central-vendas-painel").boundingBox())!.height);
const CHAVES_DO_ITEM = ["discount", "discount_percent", "note", "product_id", "quantity", "unit_price", "warehouse_id"];

/** Intercepta o POST de criação e devolve o corpo enviado (sem gravar nada no banco). */
async function capturarPost(page: Page) {
  const capturado: { corpo: Record<string, unknown> | null } = { corpo: null };
  await page.route("**/api/sales/sales", async (rota) => {
    if (rota.request().method() !== "POST") return rota.continue();
    capturado.corpo = rota.request().postDataJSON() as Record<string, unknown>;
    await rota.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000000" }) });
  });
  return capturado;
}

/** Uma venda SALVA de verdade: a primeira da listagem oficial, com o detalhe lido pela porta que a tela de detalhe usa. */
async function documentoSalvo(page: Page) {
  const lista = await api<{ items: { id: string }[] }>(page, "GET", "/api/sales/sales?pageSize=1");
  const id = lista.items?.[0]?.id;
  expect(id, "o seed tem venda salva para abrir como aba de registro").toBeTruthy();
  const d = await api<{ code: string; client_name: string | null; status: string }>(page, "GET", `/api/sales/sales/${id}`);
  expect(d.code && d.client_name && d.status, "a premissa: a venda salva tem código, cliente e situação").toBeTruthy();
  return { id: id!, code: d.code, cliente: d.client_name!, status: d.status };
}

/**
 * Abre, nesta ordem, uma venda SALVA (aba de registro), uma tela de OUTRO módulo (Estoque) e, opcionalmente,
 * o lançador de pedido (aba de criação limpa) — e só então a Central. Cada `goto` recarrega a página: as
 * abas sobrevivem pela própria infraestrutura (sessionStorage de metadados), como para o usuário.
 */
async function abrirComVizinhos(page: Page, opcoes: { lancadorDePedido?: boolean } = {}) {
  const salvo = await documentoSalvo(page);
  await page.goto(`/vendas/sales/${salvo.id}`);
  await expect(aba(page, `/vendas/sales/${salvo.id}`)).toHaveCount(1);
  await page.goto("/estoque");
  await expect(aba(page, "/estoque")).toHaveCount(1);
  if (opcoes.lancadorDePedido) { await abrirLancamentoDeVendas(page, "orders"); await expect(aba(page, "/vendas/orders/new")).toHaveCount(1); }
  const top = await abrirWorkspace(page);
  await expect(aba(page, "/vendas/sales/new")).toHaveCount(1);
  return { salvo, top };
}
const linhasVisiveis = (page: Page) => page.getByTestId("central-vendas-documentos-lista").locator('[data-testid="central-vendas-documento"]:not([hidden])');

test("W20 — Configurar colunas: esconde, reordena e restaura colunas e campos SEM tocar no item, no payload ou no armazenamento", async ({ page }) => {
  await login(page);
  const top = await abrirWorkspace(page);
  const chavesAntes = await chavesDoNavegador(page);
  await pickRef(page, "Cliente", "DEMO");
  await adicionarItemComProduto(page, 0);
  await linhaDaGrade(page, 0).getByLabel("Quantidade").fill("4");

  const configurar = page.getByRole("button", { name: "Configurar colunas" });
  await expect(configurar).toHaveAttribute("data-dica", "Configurar colunas");
  await expect(configurar).toHaveAttribute("aria-expanded", "false");
  expect(await cabecalhos(page), "padrão do design: nove colunas, nesta ordem").toEqual(ROTULOS_DA_GRADE);
  await configurar.click();
  await expect(configurar).toHaveAttribute("aria-expanded", "true");
  const cfg = page.getByTestId("central-vendas-configuracao");
  await expect(cfg).toBeVisible();
  await expect(cfg).toContainText("Colunas da grade");
  await expect(cfg.getByRole("checkbox")).toHaveCount(ROTULOS_DA_GRADE.length);

  // esconder Quantidade: a coluna some da grade (cabeçalho e células), a quantidade continua no item
  const quantidade = cfg.getByRole("checkbox", { name: "Mostrar Quantidade" });
  await quantidade.click();
  await expect(quantidade).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => cabecalhos(page)).toEqual(ROTULOS_DA_GRADE.filter((r) => r !== "Quantidade"));
  await expect(linhaDaGrade(page, 0).locator("td"), "lixeira + 8 colunas").toHaveCount(ROTULOS_DA_GRADE.length);
  await expect(linhaDaGrade(page, 0).getByLabel("Quantidade")).toHaveCount(0);
  // reordenar: Total sobe uma posição
  await cfg.getByRole("button", { name: "Subir Total" }).click();
  await expect.poll(async () => (await cabecalhos(page)).slice(-2)).toEqual(["Total", "Desconto %"]);
  await expect(cfg.getByRole("button", { name: "Subir Código" }), "a primeira não sobe").toBeDisabled();
  // restaurar padrão devolve as nove, na ordem do design — e a quantidade é a MESMA de antes
  await cfg.getByRole("button", { name: "Restaurar padrão" }).click();
  await expect.poll(() => cabecalhos(page)).toEqual(ROTULOS_DA_GRADE);
  await expect(linhaDaGrade(page, 0).getByLabel("Quantidade"), "esconder não apagou o valor").toHaveValue("4");
  await page.keyboard.press("Escape");
  await expect(cfg).toHaveCount(0);
  await expect(configurar, "Esc devolve o foco ao botão").toBeFocused();

  // no formulário, a configuração é a dos CAMPOS do item
  await page.getByRole("button", { name: "Formulário", exact: true }).click();
  await configurar.click();
  await expect(cfg).toContainText("Visualização do formulário");
  const form = page.getByTestId("central-vendas-item-form");
  const desconto = form.getByLabel("Desconto", { exact: true });
  await expect(desconto).toBeVisible();
  await cfg.getByRole("checkbox", { name: "Mostrar Desconto", exact: true }).click();
  await expect(desconto).toHaveCount(0);
  await cfg.getByRole("checkbox", { name: "Mostrar Desconto", exact: true }).click();
  await expect(desconto).toBeVisible();
  await page.keyboard.press("Escape");

  // grade de novo, com Quantidade escondida: o POST leva a quantidade digitada e as MESMAS chaves de item
  await page.getByRole("button", { name: "Grade", exact: true }).click();
  await configurar.click();
  await cfg.getByRole("checkbox", { name: "Mostrar Quantidade" }).click();
  await page.keyboard.press("Escape");
  expect(await chavesDoNavegador(page), "nenhuma chave nova no navegador: a configuração é estado da tela").toEqual(chavesAntes);
  const post = await capturarPost(page);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => post.corpo).not.toBeNull();
  const item = (post.corpo!["items"] as Record<string, unknown>[])[0]!;
  expect(item["quantity"], "coluna escondida não é coluna apagada").toBe("4");
  expect(Object.keys(item).sort()).toEqual(CHAVES_DO_ITEM);

  // remontar a Central devolve o padrão (COLUMN_CONFIG_PERSISTENCE = NONE)
  await page.unroute("**/api/sales/sales");
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top.id}`);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await page.getByRole("button", { name: "Adicionar item" }).click();
  expect(await cabecalhos(page)).toEqual(ROTULOS_DA_GRADE);
});

test("W21 — painel inferior recolhível: só a faixa fica, nada focável atrás, expandir devolve a última altura, nada persiste", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  const chavesAntes = await chavesDoNavegador(page);
  const painel = page.getByTestId("central-vendas-painel");
  const recolher = page.getByTestId("central-vendas-recolher");
  await expect(recolher, "começa expandido").toHaveAttribute("aria-expanded", "true");
  await expect(recolher).toHaveAccessibleName("Recolher painel");
  await expect(recolher).toHaveAttribute("data-dica", "Recolher painel");
  expect(await alturaDoPainel(page)).toBe(ALTURA.padrao);

  // uma altura diferente da padrão: é ELA que tem de voltar
  await page.getByTestId(DIVISOR_H).focus();
  await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp");
  const escolhida = ALTURA.padrao + 16;
  await expect.poll(() => alturaDoPainel(page)).toBe(escolhida);

  await recolher.click();
  await expect(recolher).toHaveAttribute("aria-expanded", "false");
  await expect(recolher).toHaveAccessibleName("Expandir painel");
  await expect(recolher, "o foco fica no botão").toBeFocused();
  await expect.poll(() => alturaDoPainel(page), "só a faixa das abas: 39px").toBe(39);
  await expect(painel.getByRole("tab")).toHaveText(["Totais", "Financeiro", "Frete e transporte", "Fiscal", "Observações"]);
  await expect(page.getByTestId(DIVISOR_H), "recolhido não se redimensiona").toHaveCount(0);
  // o conteúdo da aba não fica atrás da faixa: invisível E fora do foco
  await expect(painel.locator('[role="tabpanel"][data-state="active"]'), "nem a aba ativa aparece").toBeHidden();
  const desconto = page.getByLabel("Desconto", { exact: true });
  await expect(desconto).toBeHidden();
  expect(await desconto.evaluate((el) => { (el as HTMLElement).focus(); return document.activeElement === el; }), "campo de aba recolhida não recebe foco").toBe(false);

  // expandir pelo botão: a ÚLTIMA altura, o divisor e o conteúdo voltam
  await recolher.click();
  await expect.poll(() => alturaDoPainel(page)).toBe(escolhida);
  await expect(page.getByTestId(DIVISOR_H)).toBeVisible();
  await expect(painel.getByRole("tabpanel")).toBeVisible();

  // recolhido, escolher uma aba expande já nela
  await recolher.click();
  await expect.poll(() => alturaDoPainel(page)).toBe(39);
  await painel.getByRole("tab", { name: "Financeiro" }).click();
  await expect(recolher).toHaveAttribute("aria-expanded", "true");
  await expect(painel.getByRole("tab", { name: "Financeiro" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => alturaDoPainel(page)).toBe(escolhida);
  // e o divisor volta a redimensionar
  await page.getByTestId(DIVISOR_H).focus(); await page.keyboard.press("ArrowUp");
  await expect.poll(() => alturaDoPainel(page)).toBe(escolhida + 8);

  expect(await chavesDoNavegador(page), "recolher não deixa rastro no navegador").toEqual(chavesAntes);
  await recolher.click();
  await page.goto(page.url());
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(page.getByTestId("central-vendas-recolher"), "remontar devolve expandido").toHaveAttribute("aria-expanded", "true");
  expect(await alturaDoPainel(page), "e a altura padrão").toBe(ALTURA.padrao);
});

test("W22 — Documentos abertos: só documentos de vendas, contador coerente, pesquisa que filtra e estado vazio", async ({ page }) => {
  await login(page);
  const { salvo } = await abrirComVizinhos(page);
  await expect(page.getByTestId("central-vendas-documentos-contador"), "venda salva + esta criação; Estoque e Início não contam").toHaveText("2");
  await page.getByTestId("central-vendas-documentos").click();
  const lista = page.getByTestId("central-vendas-documentos-lista");
  await expect(lista).toBeVisible();
  const chaves = await lista.getByTestId("central-vendas-documento").evaluateAll((els) => els.map((e) => e.getAttribute("data-chave")));
  expect(chaves, "exatamente as abas de vendas, na ordem da barra de abas").toEqual([`/vendas/sales/${salvo.id}`, "/vendas/sales/new"]);
  const busca = lista.getByRole("textbox", { name: "Pesquisar documento aberto" });
  await expect(busca, "abre com o foco na pesquisa").toBeFocused();
  await expect(lista.locator(`[data-chave="/vendas/sales/${salvo.id}"]`).getByTestId("central-vendas-documento-titulo")).toHaveText(salvo.code);

  await busca.fill(salvo.code);
  await expect(linhasVisiveis(page)).toHaveCount(1);
  await expect(linhasVisiveis(page)).toHaveAttribute("data-chave", `/vendas/sales/${salvo.id}`);
  // sem acento e sem caixa, pelo cliente
  await busca.fill(salvo.cliente.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase());
  await expect(linhasVisiveis(page)).toHaveCount(1);
  await busca.fill("nova venda");
  await expect(linhasVisiveis(page)).toHaveCount(1);
  await expect(linhasVisiveis(page)).toHaveAttribute("data-chave", "/vendas/sales/new");
  await busca.fill("zzzz documento que nao existe");
  await expect(linhasVisiveis(page)).toHaveCount(0);
  await expect(page.getByTestId("central-vendas-documentos-vazio")).toHaveText("Nenhum documento encontrado.");
  await expect(page.getByTestId("central-vendas-documentos-contador"), "pesquisar não fecha nada").toHaveText("2");
  await busca.fill("");
  await expect(linhasVisiveis(page)).toHaveCount(2);
});

test("W23 — fechar um documento salvo pela lista é o closeTab REAL: a aba global some, as outras ficam", async ({ page }) => {
  await login(page);
  const { salvo } = await abrirComVizinhos(page);
  await page.getByTestId("central-vendas-documentos").click();
  const linha = page.locator(`[data-testid="central-vendas-documento"][data-chave="/vendas/sales/${salvo.id}"]`);
  await expect(linha.getByTestId("central-vendas-documento-titulo")).toHaveText(salvo.code);
  await linha.hover();
  await linha.getByRole("button", { name: `Fechar ${salvo.code}` }).click();
  await expect(linha).toHaveCount(0);
  await expect(aba(page, `/vendas/sales/${salvo.id}`), "a aba global fechou").toHaveCount(0);
  await expect(page.getByTestId("confirm-dialog"), "documento limpo fecha sem perguntar").toHaveCount(0);
  await expect(aba(page, "/estoque"), "outro módulo não é afetado").toHaveCount(1);
  await expect(aba(page, "/")).toHaveCount(1);
  await expect(aba(page, "/vendas/sales/new")).toHaveCount(1);
  await expect(page.getByTestId(WORKSPACE), "a Central continua na tela").toBeVisible();
  await expect(page.getByTestId("central-vendas-documentos-contador")).toHaveText("1");
});

test("W24 — fechar pela lista uma aba COM alteração pergunta como a barra de abas: cancelar mantém, confirmar fecha só ela", async ({ page }) => {
  await login(page);
  const { salvo } = await abrirComVizinhos(page);
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("rascunho que não pode sumir");
  await expect(aba(page, "/vendas/sales/new")).toHaveAttribute("data-dirty", "true");

  const fecharPelaLista = async () => {
    await page.getByTestId("central-vendas-documentos").click();
    const linha = page.locator('[data-testid="central-vendas-documento"][data-chave="/vendas/sales/new"]');
    await linha.hover();
    await linha.getByRole("button", { name: "Fechar Nova Venda" }).click();
  };
  await fecharPelaLista();
  const dlg = page.getByTestId("confirm-dialog");
  await expect(dlg, "closeTab recusou a aba suja: a lista pergunta, não descarta").toBeVisible();
  await expect(dlg.getByRole("heading", { name: "Fechar aba com alterações não salvas?" })).toBeVisible();
  await expect(dlg).toContainText('"Nova Venda"');
  await dlg.locator(".mg-dialog__footer").getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(aba(page, "/vendas/sales/new"), "cancelar mantém a aba").toHaveCount(1);
  await expect(aba(page, "/vendas/sales/new")).toHaveAttribute("data-dirty", "true");
  await expect(page.getByLabel("Observação"), "e o rascunho").toHaveValue("rascunho que não pode sumir");

  await fecharPelaLista();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(aba(page, "/vendas/sales/new"), "confirmar fecha a aba suja").toHaveCount(0);
  await expect(aba(page, `/vendas/sales/${salvo.id}`), "e SÓ ela").toHaveCount(1);
  await expect(aba(page, "/estoque")).toHaveCount(1);
  await expect(aba(page, "/")).toHaveCount(1);
  await expect(page, "fechar a aba ativa foca a vizinha, como na barra de abas").toHaveURL(/\/estoque/);
});

test("W25 — Fechar os já salvos: fecha os documentos de vendas limpos e mantém o sujo, Início e outros módulos", async ({ page }) => {
  await login(page);
  const { salvo } = await abrirComVizinhos(page, { lancadorDePedido: true });
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("rascunho da central");
  await expect(aba(page, "/vendas/sales/new")).toHaveAttribute("data-dirty", "true");
  await expect(page.getByTestId("central-vendas-documentos-contador")).toHaveText("3");

  await page.getByTestId("central-vendas-documentos").click();
  await page.getByTestId("central-vendas-documentos-fechar-salvos").click();
  await expect(page.getByTestId("central-vendas-documentos-lista"), "a lista fecha depois da ação").toHaveCount(0);
  await expect(aba(page, `/vendas/sales/${salvo.id}`), "venda salva e limpa: fecha").toHaveCount(0);
  await expect(aba(page, "/vendas/orders/new"), "criação limpa, sem nada a salvar: fecha").toHaveCount(0);
  await expect(aba(page, "/vendas/sales/new"), "a aba suja (e ativa) fica").toHaveCount(1);
  await expect(aba(page, "/vendas/sales/new")).toHaveAttribute("data-dirty", "true");
  await expect(aba(page, "/estoque"), "outro módulo fica").toHaveCount(1);
  await expect(aba(page, "/"), "Início fica").toHaveCount(1);
  await expect(page.getByLabel("Observação")).toHaveValue("rascunho da central");
  await expect(page.getByTestId("confirm-dialog"), "nada sujo foi tocado, então nada foi perguntado").toHaveCount(0);
  await expect(page.getByTestId("central-vendas-documentos-contador")).toHaveText("1");
});

test("W26 — metadados do documento salvo vêm da leitura REAL e só com a lista aberta: código, cliente, situação, nenhum UUID", async ({ page }) => {
  await login(page);
  const { salvo } = await abrirComVizinhos(page);
  const leituras: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (r.method() === "GET" && u.pathname.startsWith("/api/")) leituras.push(u.pathname); });
  await page.waitForTimeout(300);
  expect(leituras.filter((p) => p === `/api/sales/sales/${salvo.id}`), "com a lista fechada, nada é perguntado").toEqual([]);

  await page.getByTestId("central-vendas-documentos").click();
  const lista = page.getByTestId("central-vendas-documentos-lista");
  const linha = lista.locator(`[data-chave="/vendas/sales/${salvo.id}"]`);
  await expect(linha.getByTestId("central-vendas-documento-titulo")).toHaveText(salvo.code);
  await expect(linha.getByTestId("central-vendas-documento-cliente")).toHaveText(salvo.cliente);
  const badge = linha.getByTestId("central-vendas-documento-situacao").locator("[data-status]");
  await expect(badge).toHaveAttribute("data-status", salvo.status);
  const rotulo = (await badge.innerText()).trim();
  expect(rotulo.length, "a situação aparece").toBeGreaterThan(0);
  expect(rotulo, "rótulo PT-BR, nunca o valor técnico").not.toBe(salvo.status);
  expect(leituras.filter((p) => p === `/api/sales/sales/${salvo.id}`), "a leitura é a porta de detalhe que já existe").toHaveLength(1);
  expect(leituras.filter((p) => /^\/api\/(stock|estoque)/.test(p)), "nenhuma pergunta para a aba de outro módulo").toEqual([]);

  const nova = lista.locator('[data-chave="/vendas/sales/new"]');
  await expect(nova.getByTestId("central-vendas-documento-titulo")).toHaveText("Nova Venda");
  await expect(nova.getByTestId("central-vendas-documento-cliente"), "criação: nada inventado").toHaveText("—");
  await expect(nova.getByTestId("central-vendas-documento-situacao")).toHaveText("");
  expect(await lista.innerText(), "nenhum UUID como texto").not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test("W27 — workspace imersivo: a trilha some SÓ com a Central montada; lançador, módulos e detalhe mantêm a trilha", async ({ page }) => {
  await login(page);
  const trilha = page.locator('nav[aria-label="Navegação"]');
  await page.goto("/estoque");
  await expect(trilha, "módulo normal: trilha").toBeVisible();
  const top = await cadastrarTopDeVenda(page);
  await abrirLancamentoDeVendas(page, "sales");
  await expect(trilha, "lançador sem TOP é tela normal: trilha").toBeVisible();
  await expect(trilha).toContainText("Vendas");

  await escolherTopEContinuar(page, top.id);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(trilha, "Central com TOP: a trilha cede o lugar à moldura").toHaveCount(0);
  const area = (await page.getByTestId("active-workspace").boundingBox())!;
  const barra = (await page.getByTestId("central-vendas-acoes").boundingBox())!;
  expect(barra.y - area.y, "a barra da Central abre a área de trabalho (só o respiro de 12px)").toBeLessThanOrEqual(13);

  // desmontar a Central (Alterar operação, sem rascunho) devolve a trilha na MESMA rota
  await page.getByTestId("top-alterar").click();
  await expect(page.getByTestId("top-lancador")).toBeVisible();
  await expect(trilha, "a declaração sai com a Central").toBeVisible();

  const salvo = await documentoSalvo(page);
  await page.goto(`/vendas/sales/${salvo.id}`);
  await expect(trilha, "detalhe salvo: trilha como antes").toBeVisible();
  await expect(trilha).toContainText("Documento de venda");
});

test("W28 — unidade do produto: sufixo da quantidade e campo travado, pela leitura do produto que já existe; nada vai ao payload", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  await pickRef(page, "Cliente", "DEMO");
  const rotulo = await adicionarItemComProduto(page, 0);
  const opcoes = await api<{ id: string; label: string }[]>(page, "GET", `/api/resources/products/options?search=${encodeURIComponent(rotulo)}`);
  const produto = opcoes.find((o) => o.label === rotulo);
  expect(produto, "o produto escolhido, pela mesma rota de opções").toBeTruthy();
  const detalhe = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${produto!.id}`);
  const unidade = String(detalhe["measurement_id_label"] ?? "");
  expect(unidade, "a premissa: o produto do seed tem 1ª unidade de medida").not.toBe("");

  await expect(linhaDaGrade(page, 0).getByTestId("central-vendas-unidade"), "linha selecionada: ao lado do campo").toHaveText(unidade);
  await adicionarItemComProduto(page, 1);
  await expect(linhaDaGrade(page, 0).getByTestId("central-vendas-quantidade"), "linha não selecionada: número").toHaveText("1,00");
  await expect(linhaDaGrade(page, 0).getByTestId("central-vendas-unidade"), "e unidade").toHaveText(unidade);
  await linhaDaGrade(page, 0).click();
  await page.getByRole("button", { name: "Formulário", exact: true }).click();
  await expect(page.getByTestId("central-vendas-item-unidade"), "campo travado Unidade no formulário do item").toContainText(unidade);

  const post = await capturarPost(page);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => post.corpo).not.toBeNull();
  for (const item of post.corpo!["items"] as Record<string, unknown>[]) expect(Object.keys(item).sort(), "a unidade é só exibição").toEqual(CHAVES_DO_ITEM);
});
