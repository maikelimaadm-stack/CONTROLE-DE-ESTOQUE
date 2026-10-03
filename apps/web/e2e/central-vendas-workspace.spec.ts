import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { login, api, uniq, pickRef, empresaAtiva, primeiroId, abrirLancamentoDeVendas, escolherTopEContinuar, abrirAbaDoLancamento, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira, acaoDaCentral, CLASSIFICACAO_DO_SEED, ROTULOS_CLASSIFICACAO } from "./helpers";
// o `test` com a limpeza do caso (W29 cria o próprio par produto × local e o exclui no fim); os demais casos não criam
// cadastro por ela e não mudam
import { test, expect, criarCadastro, referenciasDoSeed } from "./central-compras-fixtures";

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
 * │ contrato (Editar, Anexos) apareceu — nem desabilitada.                                           │
 * │                                                                                                  │
 * │ VISUAL-UX-02 (docs/DECISIONS.md 270): a barra passou a ser a do desenho por modo — Descartar,    │
 * │ Salvar e Confirmar venda na criação; Novo documento, Duplicar e a pílula na consulta; Posição do │
 * │ rótulo e o leque de Ações rápidas (Imprimir, Histórico, Documentos abertos, Cancelar, Alterar    │
 * │ operação) nos dois. Só as asserções de APRESENTAÇÃO mudaram (W2, W4, W6, W11, W18–W27, W30); as │
 * │ de contrato continuam as mesmas. O registro linha a linha está no relatório da fatia.            │
 * │ Fase B: mudou a APRESENTAÇÃO dos itens da criação (Adicionar produto, marca pelo círculo,        │
 * │ Remover item na barra, "Mostrar grade e formulário" em Configurar colunas) e, no W4, Natureza e  │
 * │ Centro de resultado viraram pendência de clique. W4/W5/W10/W17/W29 provam o MESMO contrato.      │
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
/**
 * VISUAL-UX-02 (decisão 270): o cabeçalho de Dados principais do desenho — `height: 36px` inline + 1 px de borda: a
 * caixa medida no desenho é 37 (o `--dz-reg: 32px` do CSS não vale para ele). A MESMA medida de `MEDIDAS` em
 * central-vendas-desenho.spec.ts (VD-1).
 */
const ALTURA_DO_CABECALHO_DE_DADOS = 37;
/**
 * OS CONJUNTOS DA BARRA E DO LEQUE, POR MODO (decisão 270) — nomes acessíveis na ORDEM do DOM. O leque vai de baixo
 * para cima, como no desenho; "N documentos abertos" leva o número, por isso é casado por padrão.
 */
const DOCUMENTOS_ABERTOS = expect.stringMatching(/^\d+ documentos? abertos?$/);
const BARRA_DA_CRIACAO_DE_VENDA = ["Descartar alterações", "Salvar", "Confirmar venda", "Rótulo antes do campo", "Rótulo dentro do campo", "Ações rápidas"];
const BARRA_DA_CONSULTA_DE_VENDA = ["Novo documento", "Duplicar documento", "Confirmar venda", "Rótulo antes do campo", "Rótulo dentro do campo", "Ações rápidas"];
const LEQUE_DA_CRIACAO = ["Alterar operação", "Imprimir", "Histórico de alterações", DOCUMENTOS_ABERTOS];
const LEQUE_DA_CONSULTA_DE_VENDA_ABERTA = ["Imprimir", "Histórico de alterações", DOCUMENTOS_ABERTOS, "Cancelar venda…"];

/**
 * Cadastra uma TOP de venda pela API administrativa; prefixo 5 para não colidir com os specs vizinhos.
 * O resto do código é tempo + acaso em base 36 (cabe nos 20 caracteres da forma): cinco dígitos
 * aleatórios colidiam num banco de E2E que acumula TOPs de rodadas anteriores (409 no cadastro).
 */
async function cadastrarTopDeVenda(page: Page) {
  const codigo = `5${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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

/** Abre o workspace medindo o armazenamento ANTES de ele montar — o que a Central escrevesse ao montar entraria no "antes" e sumiria da comparação. */
async function abrirWorkspaceMedindo(page: Page) {
  const antes = await chavesDoNavegador(page);
  const top = await abrirWorkspace(page);
  return { top, antes };
}

const valorDo = async (page: Page, testId: string) => Number(await page.getByTestId(testId).getAttribute("aria-valuenow"));

/** Chaves do armazenamento do navegador — para provar que os divisores não deixaram rastro. */
const chavesDoNavegador = (page: Page) => page.evaluate(() => ({
  local: Object.keys(localStorage).sort(),
  sessao: Object.keys(sessionStorage).sort()
}));

/** Nomes acessíveis dos botões da barra, na ordem do DOM (botão só de ícone: o nome é o aria-label). */
const nomesDaBarra = (page: Page) => page.getByTestId(WORKSPACE).getByTestId("central-vendas-acoes").getByRole("button")
  .evaluateAll((els) => els.map((b) => b.getAttribute("aria-label") ?? (b.textContent ?? "").trim()));

/** Abre o leque de Ações rápidas (decisão 270) e devolve os nomes dos itens, na ordem do DOM. */
async function nomesDoLeque(page: Page) {
  const botao = page.getByTestId("central-vendas-acoes-rapidas");
  if ((await botao.getAttribute("aria-expanded")) !== "true") await botao.click();
  const leque = page.getByTestId("central-vendas-acoes-rapidas-leque");
  // o conteúdo do leque é um PONTO no centro do ⚡ (os círculos saem dele por transformação): o sinal de "abriu" é o ⚡
  // expandido e os itens visíveis, não a caixa do contêiner
  await expect(botao, "o leque abriu").toHaveAttribute("aria-expanded", "true");
  await expect(leque.getByRole("menuitem").first(), "os itens do leque estão na tela").toBeVisible();
  return leque.evaluate((raiz) => {
    const todos = [...raiz.querySelectorAll<HTMLElement>('button, [role="menuitem"]')];
    // um item de menu que embrulha um botão conta UMA vez
    return todos.filter((el) => !todos.some((outro) => outro !== el && outro.contains(el)))
      .map((el) => el.getAttribute("aria-label") ?? (el.textContent ?? "").trim());
  });
}

/** Fecha o leque por Esc e prova que fechou: o ⚡ recolhido e o leque fora da árvore (depois da animação de saída). */
async function fecharLeque(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("central-vendas-acoes-rapidas"), "Esc fecha o leque").toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("central-vendas-acoes-rapidas-leque"), "e ele sai da árvore").toHaveCount(0);
}

/**
 * O CONTADOR DE DOCUMENTOS ABERTOS (decisão 270): mora no item "N documentos abertos" do leque. Lê com o leque aberto
 * e o fecha de novo — só se foi esta função que o abriu.
 */
async function contadorDeDocumentos(page: Page) {
  const contador = page.getByTestId("central-vendas-documentos-contador");
  const abriu = (await page.getByTestId("central-vendas-acoes-rapidas").getAttribute("aria-expanded")) !== "true";
  if (abriu) await acaoDaCentral(page, "central-vendas-documentos");
  const texto = (await contador.innerText()).trim();
  if (abriu) await fecharLeque(page);
  return texto;
}

/**
 * SALVAR COM PENDÊNCIA (decisão 270): o clique NÃO envia nada — marca os campos e mostra a pílula vermelha
 * "N pendências", cuja lista tem as N. Devolve os textos da lista. `posts` é o registro de POST da página.
 */
async function clicarSalvarComPendencia(page: Page, posts: string[], motivo: string) {
  const antes = posts.length;
  await page.getByRole("button", { name: "Salvar" }).click();
  const pilula = page.getByTestId("central-vendas-pendencias");
  await expect(pilula, `${motivo}: a pílula de pendências aparece`).toBeVisible();
  await expect(pilula).toHaveText(/\d+ pendências?/);
  const n = Number(/(\d+)\s+pend/.exec(await pilula.innerText())?.[1] ?? "0");
  expect(n, `${motivo}: ao menos uma pendência`).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(posts.length, `${motivo}: ZERO POST`).toBe(antes);
  // o clique com pendência já abre a lista; se ela estiver fechada, a pílula a abre
  if ((await pilula.getAttribute("aria-expanded")) !== "true") await pilula.click();
  const lista = page.getByTestId("central-vendas-pendencias-lista");
  await expect(lista).toBeVisible();
  await expect(lista.getByTestId("central-vendas-pendencia"), `${motivo}: a lista tem as ${n} pendências`).toHaveCount(n);
  const textos = await lista.getByTestId("central-vendas-pendencia").allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(lista).toBeHidden();
  return textos;
}

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
  expect(cabecalho?.height, "altura do cabeçalho de Dados principais (desenho, decisão 270)").toBe(ALTURA_DO_CABECALHO_DE_DADOS);
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
  // decisão 270: Dedutível é a chave do desenho (role=switch), não mais um <select>
  await page.getByRole("switch", { name: "Dedutível" }).click();
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
  await expect(page.getByRole("switch", { name: "Dedutível" })).toHaveAttribute("aria-checked", "true");
});

test("W4 — Salvar continua sujeito às condições funcionais: cliente, item com produto, e o payload é o de antes", async ({ page }) => {
  await login(page);
  const top = await abrirWorkspace(page);
  const salvar = page.getByRole("button", { name: "Salvar" });
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/api/sales/")) posts.push(r.url()); });

  // VENDAS-A1: com a capacidade declarada pela API, a classificação financeira é condição. Fase B da VISUAL-UX-02
  // (decisão 270): Natureza e Centro de resultado viraram PENDÊNCIA de clique, como o Cliente — com alteração e sem o
  // par, o Salvar habilita, o clique não envia NADA e a lista diz o que falta.
  await expect(salvar, "sem alteração, nada a salvar").toBeDisabled();
  await pickRef(page, ROTULOS_CLASSIFICACAO.natureza, CLASSIFICACAO_DO_SEED.categoria.nome);
  await expect(salvar, "com alteração e sem trava de estado, o Salvar habilita: as pendências se conferem no clique").toBeEnabled();
  const semCentro = await clicarSalvarComPendencia(page, posts, "sem centro de resultado, não salva");
  expect(semCentro.some((t) => /Centro de resultado/.test(t)), "a lista diz que falta o centro de resultado").toBe(true);
  expect(semCentro.some((t) => /Natureza/.test(t)), "a natureza escolhida não está na lista").toBe(false);
  await pickRef(page, ROTULOS_CLASSIFICACAO.centro, CLASSIFICACAO_DO_SEED.centro.nome);
  // decisão 270: "desabilitado por pendência" virou "clique = ZERO POST + N pendências" — as MESMAS condições de antes
  const semCliente = await clicarSalvarComPendencia(page, posts, "sem cliente e sem item, não salva");
  expect(semCliente.some((t) => /Cliente/.test(t)), "a lista diz que falta o cliente").toBe(true);
  expect(semCliente.some((t) => /Natureza|Centro de resultado/.test(t)), "com o par escolhido, a classificação saiu da lista").toBe(false);
  await pickRef(page, "Cliente", "DEMO");
  const semItem = await clicarSalvarComPendencia(page, posts, "cliente sem item, não salva");
  expect(semItem.some((t) => /Cliente/.test(t)), "o cliente escolhido saiu da lista").toBe(false);
  await page.getByTestId("central-vendas-adicionar-item").click();      // Fase B: "Adicionar produto" (barra); "Adicionar item" saiu
  await clicarSalvarComPendencia(page, posts, "item sem produto, não salva");
  await escolherPrimeiroProdutoDaLinha(page);
  await expect(salvar).toBeEnabled();
  expect(posts, "nenhum dos cliques com pendência chegou ao servidor").toEqual([]);

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
  /**
   * O contrato do payload é o de antes da fatia MAIS as duas chaves da VENDAS-A1 — e SÓ elas. Continua
   * igualdade exata: um "contém" deixaria passar qualquer chave nova que ninguém revisou. As duas só viajam
   * porque a API declarou a capacidade; contra uma API que não a declara, o skew (A1-K1) prova que não saem.
   */
  expect(Object.keys(corpo!).sort(), "o contrato do payload é o de antes da fatia mais o par da VENDAS-A1").toEqual([
    "categoria_financeira_id", "centro_custo_id",
    "client_id", "discount", "document_date", "driver_name", "due_date", "empresa_id", "freight", "freight_icms",
    "installment_plan", "is_deductible", "items", "note", "other_values", "payment_method_id", "proprietary_id",
    "shipping_date", "tipo_operacao_id", "transporter_id"
  ]);
  expect(corpo!["categoria_financeira_id"], "a categoria escolhida viaja como UUID").toMatch(/^[0-9a-f-]{36}$/);
  expect(corpo!["centro_custo_id"], "o centro escolhido viaja como UUID").toMatch(/^[0-9a-f-]{36}$/);
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
  await preencherClassificacaoFinanceira(page);                     // VENDAS-A1: condição do Salvar desde a A1
  await page.getByTestId("central-vendas-adicionar-item").click();      // Fase B: "Adicionar produto" (barra); "Adicionar item" saiu
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

  await (await acaoDaCentral(page, "top-alterar")).click();          // decisão 270: Alterar operação mora no leque
  const confirmacao = page.getByTestId("confirm-dialog");
  await expect(confirmacao).toBeVisible();
  await confirmacao.locator("button", { hasText: "Fechar" }).click();       // o botão de TEXTO; o × do cabeçalho também se chama Fechar
  await expect(confirmacao).toHaveCount(0);
  await expect(page.getByTestId(WORKSPACE), "enquanto não confirma, tudo continua").toBeVisible();
  await expect(page.getByLabel("Observação")).toHaveValue("rascunho protegido");

  // confirmando, volta ao lançador — e o workspace deixa de existir
  await (await acaoDaCentral(page, "top-alterar")).click();
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
  const { top, antes } = await abrirWorkspaceMedindo(page);

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

test("W11 — a barra da criação é a do desenho (Descartar, Salvar, Confirmar venda · Posição do rótulo · Ações rápidas) e o leque só tem ações que existem: nada de Anexos ou Editar", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  const ws = page.getByTestId(WORKSPACE);

  const botoes = ws.getByTestId("central-vendas-acoes").getByRole("button");
  // os botões são só de ícone (linguagem da barra do design): o que se confere é o NOME acessível
  // decisão 270: o conjunto da CRIAÇÃO (venda) — Descartar e Confirmar venda passaram a existir, com contrato
  expect(await nomesDaBarra(page)).toEqual(BARRA_DA_CRIACAO_DE_VENDA);
  // sem "Voltar" (R3): como no design, a barra só tem ações do documento — navegar é a barra de abas
  await expect(ws.getByRole("button", { name: "Voltar", exact: true })).toHaveCount(0);
  // e todo botão só de ícone da barra tem dica textual
  const semDica = await botoes.evaluateAll((els) => els.filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("data-dica")).length);
  expect(semDica, "ação só de ícone sem dica").toBe(0);
  // nenhum botão só de ícone sem nome: todo botão do workspace tem nome acessível
  const semNome = await ws.getByRole("button").evaluateAll((els) => els.filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title")).length);
  expect(semNome, "botões sem nome acessível no workspace").toBe(0);

  // o LEQUE da criação: Alterar operação, Imprimir e Histórico (desabilitados, como no desenho) e Documentos abertos
  expect(await nomesDoLeque(page)).toEqual(LEQUE_DA_CRIACAO);
  await expect(page.getByTestId("central-vendas-imprimir"), "criação: nada a imprimir ainda").toBeDisabled();
  await expect(page.getByTestId("central-vendas-historico"), "criação: sem histórico ainda").toBeDisabled();
  await expect(page.getByTestId("top-alterar")).toBeEnabled();
  await expect(page.getByTestId("central-vendas-documentos")).toBeEnabled();
  const leque = page.getByTestId("central-vendas-acoes-rapidas-leque");
  for (const proibida of [/anexo/i, /^editar/i]) {
    await expect(ws.getByRole("button", { name: proibida }), `ação sem contrato não aparece: ${proibida}`).toHaveCount(0);
    await expect(ws.getByRole("tab", { name: proibida })).toHaveCount(0);
    await expect(leque.getByRole("button", { name: proibida }), `nem no leque: ${proibida}`).toHaveCount(0);
    await expect(leque.getByRole("menuitem", { name: proibida })).toHaveCount(0);
  }
  await expect(leque.getByText(/anexos/i), "nem como texto no leque").toHaveCount(0);
  await fecharLeque(page);
  await expect(page.getByTestId("central-vendas-acoes-rapidas"), "e o foco volta ao ⚡").toBeFocused();
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
/** Fase B (decisão 270): o botão da barra de itens é "Adicionar produto"; com zero itens o vazio tem outro de mesmo nome. */
const adicionarProduto = (page: Page) => page.getByTestId("central-vendas-adicionar-item");

/**
 * Fase B: a linha se MARCA pelo círculo (clicar na linha não marca, e o círculo alterna). Marca a linha i só se ela
 * ainda não estiver marcada — um segundo clique a desmarcaria — e confere a marca.
 */
async function marcarLinha(page: Page, i: number) {
  const linha = linhaDaGrade(page, i);
  if ((await linha.getAttribute("aria-selected")) !== "true") await linha.getByTestId("central-vendas-selecionar-item").click();
  await expect(linha, `a linha ${i + 1} está marcada`).toHaveAttribute("aria-selected", "true");
}

/** Fase B: "Grade e formulário" deixou de ser botão da barra e virou a opção "Mostrar grade e formulário" de Configurar colunas. */
async function mostrarGradeEFormulario(page: Page) {
  await page.getByTestId("central-vendas-configurar").click();
  const opcao = page.getByTestId("central-vendas-configuracao").getByRole("checkbox", { name: "Mostrar grade e formulário" });
  if ((await opcao.getAttribute("aria-checked")) !== "true") await opcao.click();
  await expect(opcao).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("central-vendas-configuracao")).toHaveCount(0);
}

/** Adiciona um item e escolhe o N-ésimo produto REAL pela pesquisa ancorada na célula. */
async function adicionarItemComProduto(page: Page, n = 0) {
  const antes = await page.getByTestId("central-vendas-linha").count();
  await adicionarProduto(page).click();
  await expect(page.getByTestId("central-vendas-linha")).toHaveCount(antes + 1);
  await linhaDaGrade(page, antes).getByTestId("central-vendas-produto").click();
  const opcoes = painelDePesquisa(page).getByRole("option");
  await expect(opcoes.first(), "a pesquisa traz produtos reais do seed").toBeVisible();
  // OPERACOES-01 F3b: a descrição pela coluna (`data-coluna`), não pelo último `span` — com o saldo à vista a última
  // célula da opção é a do Estoque
  const rotulo = (await opcoes.nth(n).locator('[data-coluna="descricao"]').innerText()).trim();
  await opcoes.nth(n).click();
  await expect(painelDePesquisa(page)).toHaveCount(0);
  await expect(linhaDaGrade(page, antes).getByTestId("central-vendas-produto")).toContainText(rotulo);
  return rotulo;
}

test("W13 — três visões do MESMO items: Grade, Formulário e Mostrar grade e formulário; trocar não perde nada", async ({ page }) => {
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

  // Grade e formulário (Fase B: a opção de Configurar colunas): as duas ao mesmo tempo, sobre o mesmo item marcado
  await marcarLinha(page, 1);
  await mostrarGradeEFormulario(page);
  await marcarLinha(page, 1);
  await expect(page.getByTestId("central-vendas-grade")).toBeVisible();
  await expect(page.getByTestId("central-vendas-item-form")).toBeVisible();
  await linhaDaGrade(page, 1).getByLabel("Quantidade").fill("9");
  await expect(page.getByTestId("central-vendas-item-form").getByLabel("Quantidade"), "a grade e o formulário são o MESMO estado").toHaveValue("9");
});

test("W14 — seleção de linha: círculo, teclado (↑ ↓) e nenhuma seleção órfã ao remover", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  await adicionarItemComProduto(page, 0);
  await adicionarItemComProduto(page, 1);
  await adicionarItemComProduto(page, 2);

  // Fase B: marca-se pelo círculo da linha (clicar na linha não marca)
  await linhaDaGrade(page, 0).getByTestId("central-vendas-selecionar-item").click();
  await expect(linhaDaGrade(page, 0)).toHaveAttribute("aria-selected", "true");
  await expect(linhaDaGrade(page, 0).getByLabel("Quantidade"), "os campos editáveis aparecem na linha selecionada").toBeVisible();
  await expect(linhaDaGrade(page, 1).getByLabel("Quantidade"), "e só nela").toHaveCount(0);

  await linhaDaGrade(page, 0).getByTestId("central-vendas-selecionar-item").focus();
  await page.keyboard.press("ArrowDown");
  await expect(linhaDaGrade(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => linhaDaGrade(page, 1).evaluate((el) => el === document.activeElement || el.contains(document.activeElement)), { message: "o foco foi junto com a marca" }).toBe(true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(linhaDaGrade(page, 1)).toHaveAttribute("aria-selected", "true");

  // remover a última linha marcada (Fase B: "Remover item" da barra; a lixeira por linha saiu): a seleção passa para
  // uma linha que EXISTE
  await expect(page.getByRole("button", { name: /^Excluir item/ }), "a lixeira por linha saiu").toHaveCount(0);
  await marcarLinha(page, 2);
  await page.getByTestId("central-vendas-remover-item").click();
  await expect(page.getByTestId("central-vendas-linha")).toHaveCount(2);
  await expect(page.locator('[data-testid="central-vendas-linha"][aria-selected="true"]'), "exatamente uma linha selecionada, e ela existe").toHaveCount(1);
  await expect(linhaDaGrade(page, 1)).toHaveAttribute("aria-selected", "true");
});

test("W15 — pesquisa de produto: ancorada à célula, fonte real, teclado ↑ ↓ Enter Esc", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  /* OPERACOES-01 F3b (decisão 280): com a capacidade declarada pela API desta fase, a fonte REAL da pesquisa de produto é
     `GET /api/produtos/pesquisa` (o parâmetro `busca`), e a de antes (`/api/resources/products/options`) não sai mais —
     as duas são contadas no fio, pelo caminho exato. A fonte de antes, contra a API anterior, é o skew (K-1a). */
  const buscas: string[] = [];
  const dasOpcoesDeAntes: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/produtos/pesquisa") buscas.push(u.searchParams.get("busca") ?? "");
    if (u.pathname === "/api/resources/products/options") dasOpcoesDeAntes.push(u.search);
  });

  await adicionarProduto(page).click();
  const celula = linhaDaGrade(page, 0).getByTestId("central-vendas-produto");
  await celula.click();
  const painel = painelDePesquisa(page);
  await expect(painel).toBeVisible();
  await expect(painel).toHaveAttribute("data-modo", "flutuante");
  await expect(painel, "a fonte é a pesquisa nova (a API declarou a capacidade)").toHaveAttribute("data-fonte", "pesquisa");

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
  // a descrição pela coluna (`data-coluna`), não pelo último `span`: com o saldo à vista a última célula é a do Estoque
  const alvo = (await opcoes.nth(1).locator('[data-coluna="descricao"]').innerText()).trim();
  const termo = alvo.slice(0, 4);
  await page.keyboard.type(termo);
  // a busca vai aparada (o contrato da rota: texto aparado, até 100)
  await expect.poll(() => buscas.includes(termo.trim()), { message: "a digitação virou busca no endpoint REAL da pesquisa de produtos" }).toBe(true);
  await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace");
  await expect(opcoes).toHaveCount(total);

  // Esc fecha sem escolher
  await page.keyboard.press("Escape");
  await expect(painel).toHaveCount(0);
  await expect(celula).toContainText("Selecione o produto");          // Fase B: o vazio do desenho (antes "Pesquisar produto")

  // reabrir: a busca começa limpa; ↓ Enter escolhe a SEGUNDA opção
  await celula.click();
  await expect(painel.getByRole("combobox")).toHaveValue("");
  await expect(painel.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(painel.getByRole("option").nth(1)).toHaveAttribute("data-ativa", "true");
  await page.keyboard.press("Enter");
  await expect(painel).toHaveCount(0);
  await expect(celula).toContainText(alvo);
  expect(buscas.length, "premissa: a pesquisa nova foi de fato chamada").toBeGreaterThan(0);
  expect(dasOpcoesDeAntes, "nenhum pedido à fonte de antes durante o caso").toEqual([]);
});

test("W16 — no formulário do item a pesquisa abre EM FLUXO e empurra os campos seguintes", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  await adicionarItemComProduto(page, 0);
  await page.getByRole("button", { name: "Formulário", exact: true }).click();
  const form = page.getByTestId("central-vendas-item-form");
  /* OPERACOES-01 F3b (decisão 280): o Local de estoque vem ANTES do Produto — o campo que o painel empurra é um que vem
     DEPOIS dele (a Quantidade); o Local, acima, fica onde está. */
  const local = form.getByLabel("Local de estoque");
  const produto = form.getByLabel("Produto");
  const quantidade = form.getByLabel("Quantidade");
  const y = async (l: typeof local) => (await l.boundingBox())!.y;
  const [localAntes, produtoAntes, quantidadeAntes] = [await y(local), await y(produto), await y(quantidade)];
  expect(localAntes, "premissa: o Local de estoque está acima do Produto").toBeLessThan(produtoAntes);
  expect(quantidadeAntes, "premissa: a Quantidade está abaixo do Produto").toBeGreaterThan(produtoAntes);
  await produto.click();
  await expect(painelDePesquisa(page)).toHaveAttribute("data-modo", "fluxo");
  expect(await y(quantidade) - quantidadeAntes, "o campo seguinte desceu: o painel está no fluxo, não por cima").toBeGreaterThan(100);
  expect(Math.abs(await y(local) - localAntes), "o Local, acima do painel, não se moveu").toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(painelDePesquisa(page)).toHaveCount(0);
});

test("W17 — as visões não mudam o payload: quantidade do formulário e produto da pesquisa chegam no POST", async ({ page }) => {
  await login(page);
  const top = await abrirWorkspace(page);
  await pickRef(page, "Cliente", "DEMO");
  await preencherClassificacaoFinanceira(page);                     // VENDAS-A1: condição do Salvar desde a A1
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
  await (await acaoDaCentral(page, "central-vendas-documentos")).click();   // decisão 270: item do leque
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
    await marcarLinha(page, 0);
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
    await adicionarProduto(page).click();
    await linhaDaGrade(page, 2).getByTestId("central-vendas-produto").click();
    await expect(painelDePesquisa(page).getByRole("option").first()).toBeVisible();
    await foto("product-lookup");
    await page.keyboard.press("Escape");
    await marcarLinha(page, 2);
    await page.getByTestId("central-vendas-remover-item").click();
    await expect(page.getByTestId("central-vendas-linha")).toHaveCount(2);
    await marcarLinha(page, 0);
    await page.getByRole("button", { name: "Formulário", exact: true }).click();
    await foto("items-form");
    await mostrarGradeEFormulario(page);
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
    await (await acaoDaCentral(page, "central-vendas-documentos")).click();
    await expect(page.getByTestId("central-vendas-documento-titulo").first()).toHaveText(salvo.code);
    await foto("open-documents");
    await page.getByRole("textbox", { name: "Pesquisar documento aberto" }).fill(salvo.code);
    await foto("open-documents-search");
  }
});

/* ════════════════════════════════ R2 — fechamento de fidelidade ════════════════════════════════ */

/** OPERACOES-01 F3b (decisão 280): o Local de estoque antes do produto (o layout do sistema de vendas começa por ele). */
const ROTULOS_DA_GRADE = ["Local de estoque", "Código", "Produto", "Estoque", "Quantidade", "Valor unitário", "Desconto", "Desconto %", "Total"];
/** Os títulos das colunas da grade, sem a coluna do círculo de seleção (Fase B; antes a da lixeira), que não tem texto. */
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

/**
 * Uma venda SALVA de verdade, criada pela API oficial (o seed de demonstração não traz venda: depender de
 * outro spec tê-la criado antes faria este arquivo passar ou falhar pela ordem de execução). O detalhe é
 * lido pela porta que a tela de detalhe usa. Criada ANTES de qualquer `page.route`, o POST é o real.
 */
async function documentoSalvo(page: Page) {
  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const armazem = await primeiroId(page, `/api/resources/warehouses?empresa_id=${empresa}&pageSize=1`);
  const { id } = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente,
    items: [{ product_id: produto, warehouse_id: armazem, quantity: "1", unit_price: "10.00" }]
  });
  const d = await api<{ code: string; client_name: string | null; status: string }>(page, "GET", `/api/sales/sales/${id}`);
  expect(d.code && d.client_name && d.status, "a premissa: a venda salva tem código, cliente e situação").toBeTruthy();
  return { id, code: d.code, cliente: d.client_name!, status: d.status };
}

/**
 * Abre, nesta ordem, uma venda SALVA (aba de registro), um REGISTRO de outro módulo (o produto, aba de
 * detalhe fora de vendas — o controle negativo do filtro), uma tela de OUTRO módulo (Estoque) e,
 * opcionalmente, o lançador de pedido (aba de criação limpa) — e só então a Central. Cada `goto` recarrega
 * a página: as abas sobrevivem pela própria infraestrutura (sessionStorage de metadados), como para o
 * usuário. `antesDaCentral` roda depois da última leitura legítima das outras telas e antes de a Central montar.
 */
async function abrirComVizinhos(page: Page, opcoes: { lancadorDePedido?: boolean; antesDaCentral?: () => void } = {}) {
  const salvo = await documentoSalvo(page);
  await page.goto(`/vendas/sales/${salvo.id}`);
  await expect(aba(page, `/vendas/sales/${salvo.id}`)).toHaveCount(1);
  const produtoId = await primeiroId(page, "/api/resources/products?pageSize=1");
  await page.goto(`/cadastros/products/${produtoId}?view=1`);
  const outroRegistro = page.locator('[data-testid="workspace-tab"][data-kind="detail"]:not([data-tab-key^="/vendas/"])');
  await expect(outroRegistro, "um registro de outro módulo aberto como aba de detalhe").toHaveCount(1);
  const chaveOutroRegistro = (await outroRegistro.getAttribute("data-tab-key"))!;
  await page.goto("/estoque");
  await expect(aba(page, "/estoque")).toHaveCount(1);
  if (opcoes.lancadorDePedido) { await abrirLancamentoDeVendas(page, "orders"); await expect(aba(page, "/vendas/orders/new")).toHaveCount(1); }
  opcoes.antesDaCentral?.();
  const top = await abrirWorkspace(page);
  await expect(aba(page, "/vendas/sales/new")).toHaveCount(1);
  return { salvo, top, produtoId, chaveOutroRegistro };
}
const linhasVisiveis = (page: Page) => page.getByTestId("central-vendas-documentos-lista").locator('[data-testid="central-vendas-documento"]:not([hidden])');

test("W20 — Configurar colunas: esconde, reordena e restaura colunas e campos SEM tocar no item, no payload ou no armazenamento", async ({ page }) => {
  await login(page);
  const { top, antes: chavesAntes } = await abrirWorkspaceMedindo(page);
  await pickRef(page, "Cliente", "DEMO");
  await preencherClassificacaoFinanceira(page);                     // VENDAS-A1: condição do Salvar desde a A1
  await adicionarItemComProduto(page, 0);
  await linhaDaGrade(page, 0).getByLabel("Quantidade").fill("4");

  const configurar = page.getByRole("button", { name: "Configurar colunas" });
  await expect(configurar).toHaveAttribute("data-dica", "Configurar colunas");
  await expect(configurar).toHaveAttribute("aria-expanded", "false");
  expect(await cabecalhos(page), "padrão do design: nove colunas, nesta ordem").toEqual(ROTULOS_DA_GRADE);
  // "Local de estoque" (OPERACOES-01 F3a, decisão 280) é mais comprido que o rótulo de antes: o cabeçalho cabe INTEIRO
  // na largura da coluna — a reticência do `th` esconderia o corte da asserção acima, que lê o texto do DOM. A medida é
  // a do TEXTO (um Range dá a largura inteira mesmo sob a reticência) contra a CAIXA de conteúdo (sem o padding), em
  // frações de pixel: `scrollWidth`/`clientWidth` são arredondados e deixam passar um corte de até meio pixel. E vale
  // também com o " *" que a grade acrescenta quando a coluna é obrigatória (layout, regra da TOP, reserva de estoque):
  // o MESMO elemento de `itens.tsx`, posto no MESMO `th` só para a medida e tirado em seguida.
  const cabecalhoDoLocal = page.getByTestId("central-vendas-grade").getByRole("columnheader", { name: "Local de estoque", exact: true });
  await expect(cabecalhoDoLocal, "premissa: o cabeçalho do local de estoque está na grade").toHaveCount(1);
  const medida = await cabecalhoDoLocal.evaluate((th) => {
    const larguraDoTexto = () => { const r = document.createRange(); r.selectNodeContents(th); return r.getBoundingClientRect().width; };
    const estilo = getComputedStyle(th);
    const caixa = th.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
    const rotulo = larguraDoTexto();
    const filhos = th.childNodes.length;
    const req = document.createElement("span");
    req.className = "req text-red-500";
    req.textContent = " *";
    th.append(req);
    const comAsterisco = larguraDoTexto();
    req.remove();
    return { caixa, rotulo, comAsterisco, filhos, rolagem: th.scrollWidth, cliente: th.clientWidth };
  });
  expect(medida.filhos, "premissa: o cabeçalho é só o rótulo (coluna não obrigatória nesta TOP)").toBe(1);
  expect(medida.caixa, "premissa: a caixa do cabeçalho tem largura medida").toBeGreaterThan(0);
  expect(medida.comAsterisco, "premissa: o \" *\" acrescenta largura à medida").toBeGreaterThan(medida.rotulo);
  expect(medida.rotulo, `o cabeçalho "Local de estoque" não está cortado (${medida.rotulo}px de texto em ${medida.caixa}px)`).toBeLessThanOrEqual(medida.caixa);
  expect(medida.rolagem, "nem pela medida arredondada do navegador").toBeLessThanOrEqual(medida.cliente);
  expect(medida.comAsterisco, `"Local de estoque *" (coluna obrigatória) também cabe (${medida.comAsterisco}px de texto em ${medida.caixa}px)`).toBeLessThanOrEqual(medida.caixa);
  await configurar.click();
  await expect(configurar).toHaveAttribute("aria-expanded", "true");
  const cfg = page.getByTestId("central-vendas-configuracao");
  await expect(cfg).toBeVisible();
  await expect(cfg).toContainText("Colunas da grade");
  // uma caixa por coluna + a opção "Mostrar grade e formulário" (Fase B: o antigo 3º botão da barra mora aqui)
  await expect(cfg.getByRole("checkbox")).toHaveCount(ROTULOS_DA_GRADE.length + 1);
  await expect(cfg.getByRole("checkbox", { name: "Mostrar grade e formulário" })).toHaveCount(1);

  // esconder Quantidade: a coluna some da grade (cabeçalho e células), a quantidade continua no item
  const quantidade = cfg.getByRole("checkbox", { name: "Mostrar Quantidade" });
  await quantidade.click();
  await expect(quantidade).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => cabecalhos(page)).toEqual(ROTULOS_DA_GRADE.filter((r) => r !== "Quantidade"));
  await expect(linhaDaGrade(page, 0).locator("td"), "círculo de seleção + 8 colunas").toHaveCount(ROTULOS_DA_GRADE.length);
  await expect(linhaDaGrade(page, 0).getByLabel("Quantidade")).toHaveCount(0);
  // reordenar: Total sobe uma posição
  await cfg.getByRole("button", { name: "Subir Total" }).click();
  await expect.poll(async () => (await cabecalhos(page)).slice(-2)).toEqual(["Total", "Desconto %"]);
  // a primeira coluna (o Local de estoque, decisão 280) não sobe; a segunda sobe
  await expect(cfg.getByRole("button", { name: `Subir ${ROTULOS_DA_GRADE[0]}`, exact: true }), "a primeira não sobe").toBeDisabled();
  await expect(cfg.getByRole("button", { name: `Subir ${ROTULOS_DA_GRADE[1]}`, exact: true }), "premissa: a segunda sobe").toBeEnabled();
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
  await adicionarProduto(page).click();
  expect(await cabecalhos(page)).toEqual(ROTULOS_DA_GRADE);
});

test("W21 — painel inferior recolhível: só a faixa fica, nada focável atrás, expandir devolve a última altura, nada persiste", async ({ page }) => {
  await login(page);
  const { antes: chavesAntes } = await abrirWorkspaceMedindo(page);
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
  const { salvo, chaveOutroRegistro } = await abrirComVizinhos(page);
  await expect.poll(() => contadorDeDocumentos(page), { message: "venda salva + esta criação; o produto, Estoque e Início não contam" }).toBe("2");
  await (await acaoDaCentral(page, "central-vendas-documentos")).click();
  const lista = page.getByTestId("central-vendas-documentos-lista");
  await expect(lista).toBeVisible();
  const chaves = await lista.getByTestId("central-vendas-documento").evaluateAll((els) => els.map((e) => e.getAttribute("data-chave")));
  expect(chaves, "exatamente as abas de vendas, na ordem da barra de abas").toEqual([`/vendas/sales/${salvo.id}`, "/vendas/sales/new"]);
  expect(chaves, "registro de outro módulo (aba de detalhe) não é documento de vendas").not.toContain(chaveOutroRegistro);
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
  await busca.fill("");
  await expect(linhasVisiveis(page)).toHaveCount(2);
  // decisão 270: o contador mora no leque; lê-se depois de fechar a lista
  await page.keyboard.press("Escape");
  await expect.poll(() => contadorDeDocumentos(page), { message: "pesquisar não fecha nada" }).toBe("2");
});

test("W23 — fechar um documento salvo pela lista é o closeTab REAL: a aba global some, as outras ficam", async ({ page }) => {
  await login(page);
  const { salvo } = await abrirComVizinhos(page);
  await (await acaoDaCentral(page, "central-vendas-documentos")).click();
  const linha = page.locator(`[data-testid="central-vendas-documento"][data-chave="/vendas/sales/${salvo.id}"]`);
  await expect(linha.getByTestId("central-vendas-documento-titulo")).toHaveText(salvo.code);
  await linha.hover();
  await linha.getByRole("button", { name: `Fechar ${salvo.code}` }).click();
  await expect(linha).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Pesquisar documento aberto" }), "o × sumiu com a linha: o foco vai para a pesquisa, não para o <body>").toBeFocused();
  await expect(aba(page, `/vendas/sales/${salvo.id}`), "a aba global fechou").toHaveCount(0);
  await expect(page.getByTestId("confirm-dialog"), "documento limpo fecha sem perguntar").toHaveCount(0);
  await expect(aba(page, "/estoque"), "outro módulo não é afetado").toHaveCount(1);
  await expect(aba(page, "/")).toHaveCount(1);
  await expect(aba(page, "/vendas/sales/new")).toHaveCount(1);
  await expect(page.getByTestId(WORKSPACE), "a Central continua na tela").toBeVisible();
  await page.keyboard.press("Escape");                                     // decisão 270: o contador mora no leque
  await expect.poll(() => contadorDeDocumentos(page)).toBe("1");
});

test("W24 — fechar pela lista uma aba COM alteração pergunta como a barra de abas: cancelar mantém lista, aba e foco; confirmar fecha só ela", async ({ page }) => {
  await login(page);
  const { salvo, chaveOutroRegistro } = await abrirComVizinhos(page);
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("rascunho que não pode sumir");
  await expect(aba(page, "/vendas/sales/new")).toHaveAttribute("data-dirty", "true");

  await (await acaoDaCentral(page, "central-vendas-documentos")).click();
  const lista = page.getByTestId("central-vendas-documentos-lista");
  const linha = lista.locator('[data-testid="central-vendas-documento"][data-chave="/vendas/sales/new"]');
  const xis = linha.getByRole("button", { name: "Fechar Nova Venda" });
  const dlg = page.getByTestId("confirm-dialog");

  await linha.hover(); await xis.click();
  await expect(dlg, "closeTab recusou a aba suja: a lista pergunta, não descarta").toBeVisible();
  // decisão 270: o texto do desenho no diálogo compartilhado (ConfirmarFechamentoDeAba)
  await expect(dlg.getByRole("heading", { name: "Fechar Nova Venda?" })).toBeVisible();
  await expect(dlg).toContainText("Existem alterações não salvas. Ao fechar, elas serão descartadas.");
  // cancelar pelo botão de TEXTO do rodapé ("Continuar editando"); o × do cabeçalho se chama Fechar
  await dlg.getByRole("button", { name: "Continuar editando", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(lista, "o diálogo é dono do clique: a lista continua aberta por baixo").toBeVisible();
  await expect(xis, "e o foco volta ao × da linha").toBeFocused();
  await expect(aba(page, "/vendas/sales/new"), "cancelar mantém a aba").toHaveCount(1);
  await expect(aba(page, "/vendas/sales/new")).toHaveAttribute("data-dirty", "true");

  // cancelar por Esc também é do diálogo: a lista não fecha junto
  await xis.click();
  await expect(dlg).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(lista, "Esc fecha o diálogo, não a lista").toBeVisible();
  await expect(xis).toBeFocused();
  await expect(page.getByLabel("Observação"), "e o rascunho continua").toHaveValue("rascunho que não pode sumir");

  await xis.click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(aba(page, "/vendas/sales/new"), "confirmar fecha a aba suja").toHaveCount(0);
  await expect(aba(page, `/vendas/sales/${salvo.id}`), "e SÓ ela").toHaveCount(1);
  await expect(aba(page, chaveOutroRegistro)).toHaveCount(1);
  await expect(aba(page, "/estoque")).toHaveCount(1);
  await expect(aba(page, "/")).toHaveCount(1);
  await expect(page, "fechar a aba ativa foca a vizinha, como na barra de abas").toHaveURL(/\/estoque/);
});

test("W25 — Fechar os já salvos: fecha os documentos de vendas limpos e mantém o sujo, Início e outros módulos", async ({ page }) => {
  await login(page);
  const { salvo, chaveOutroRegistro } = await abrirComVizinhos(page, { lancadorDePedido: true });
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("rascunho da central");
  await expect(aba(page, "/vendas/sales/new")).toHaveAttribute("data-dirty", "true");
  await expect.poll(() => contadorDeDocumentos(page)).toBe("3");

  await (await acaoDaCentral(page, "central-vendas-documentos")).click();
  await page.getByTestId("central-vendas-documentos-fechar-salvos").click();
  await expect(page.getByTestId("central-vendas-documentos-lista"), "a lista fecha depois da ação").toHaveCount(0);
  await expect(aba(page, `/vendas/sales/${salvo.id}`), "venda salva e limpa: fecha").toHaveCount(0);
  await expect(aba(page, "/vendas/orders/new"), "criação limpa, sem nada a salvar: fecha").toHaveCount(0);
  await expect(aba(page, "/vendas/sales/new"), "a aba suja (e ativa) fica").toHaveCount(1);
  await expect(aba(page, "/vendas/sales/new")).toHaveAttribute("data-dirty", "true");
  await expect(aba(page, "/estoque"), "outro módulo fica").toHaveCount(1);
  await expect(aba(page, chaveOutroRegistro), "registro de outro módulo, mesmo limpo, fica").toHaveCount(1);
  await expect(aba(page, "/"), "Início fica").toHaveCount(1);
  // decisão 270: a lista abre pelo leque; fechada, o foco volta a quem a abriu (o item do leque, ou Ações rápidas quando o
  // leque já se recolheu) — nunca ao <body>
  await expect(page.locator('[data-testid="central-vendas-documentos"]:focus, [data-testid="central-vendas-acoes-rapidas"]:focus'), "a lista fechou: o foco volta a quem a abriu").toHaveCount(1);
  await expect(page.getByLabel("Observação")).toHaveValue("rascunho da central");
  await expect(page.getByTestId("confirm-dialog"), "nada sujo foi tocado, então nada foi perguntado").toHaveCount(0);
  await expect.poll(() => contadorDeDocumentos(page)).toBe("1");
});

test("W26 — metadados do documento salvo vêm da leitura REAL e só com a lista aberta: código, cliente, situação, nenhum UUID", async ({ page }) => {
  await login(page);
  const leituras: string[] = [];
  // o ouvinte nasce ANTES de a Central montar: o que ela pedisse na montagem apareceria aqui
  const registrar = () => page.on("request", (r) => { const u = new URL(r.url()); if (r.method() === "GET" && u.pathname.startsWith("/api/")) leituras.push(u.pathname); });
  const { salvo, produtoId } = await abrirComVizinhos(page, { antesDaCentral: registrar });
  await page.waitForTimeout(300);
  expect(leituras.filter((p) => p === `/api/sales/sales/${salvo.id}`), "da montagem da Central até aqui, com a lista fechada, nada é perguntado").toEqual([]);

  await (await acaoDaCentral(page, "central-vendas-documentos")).click();
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
  expect(leituras.filter((p) => p === `/api/resources/products/${produtoId}`), "a aba de registro de outro módulo não é consultada pela lista").toEqual([]);

  const nova = lista.locator('[data-chave="/vendas/sales/new"]');
  await expect(nova.getByTestId("central-vendas-documento-titulo")).toHaveText("Nova Venda");
  await expect(nova.getByTestId("central-vendas-documento-cliente"), "criação: nada inventado").toHaveText("—");
  await expect(nova.getByTestId("central-vendas-documento-situacao")).toHaveText("");
  expect(await lista.innerText(), "nenhum UUID como texto").not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test("W27 — workspace imersivo: a trilha some SÓ com a Central montada (criação e documento salvo); lançador, módulos e outros registros mantêm a trilha", async ({ page }) => {
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
  await (await acaoDaCentral(page, "top-alterar")).click();
  await expect(page.getByTestId("top-lancador")).toBeVisible();
  await expect(trilha, "a declaração sai com a Central").toBeVisible();

  // R3: o documento SALVO também abre na Central (consulta) — e a trilha cede o lugar a ela
  const salvo = await documentoSalvo(page);
  await page.goto(`/vendas/sales/${salvo.id}`);
  await expect(page.getByTestId(WORKSPACE), "o documento salvo abre na Central").toBeVisible();
  await expect(trilha, "documento salvo na Central: sem trilha").toHaveCount(0);
  // a ROTA sozinha não basta: registro inexistente não monta a Central, e a trilha fica
  await page.goto("/vendas/sales/00000000-0000-4000-8000-000000000000");
  await expect(page.getByTestId(WORKSPACE)).toHaveCount(0);
  await expect(trilha, "sem Central montada, a trilha é a de sempre").toBeVisible();
  // registro de OUTRO módulo (rota de três segmentos também) mantém a trilha
  const produtoId = await primeiroId(page, "/api/resources/products?pageSize=1");
  await page.goto(`/cadastros/products/${produtoId}?view=1`);
  await expect(trilha, "registro de outro módulo: trilha").toBeVisible();
});

test("W28 — unidade do produto: sufixo da quantidade e campo travado, pela leitura do produto que já existe; nada vai ao payload", async ({ page }) => {
  await login(page);
  await abrirWorkspace(page);
  await pickRef(page, "Cliente", "DEMO");
  await preencherClassificacaoFinanceira(page);                     // VENDAS-A1: condição do Salvar desde a A1
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
  await marcarLinha(page, 0);
  await page.getByRole("button", { name: "Formulário", exact: true }).click();
  await expect(page.getByTestId("central-vendas-item-unidade"), "campo travado Unidade no formulário do item").toContainText(unidade);

  const post = await capturarPost(page);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => post.corpo).not.toBeNull();
  for (const item of post.corpo!["items"] as Record<string, unknown>[]) expect(Object.keys(item).sort(), "a unidade é só exibição").toEqual(CHAVES_DO_ITEM);
});

test("W29 — esconder a coluna Estoque ou trocar de visão NÃO reaplica o custo médio: o unitário zerado de propósito chega zerado no POST", async ({ page }) => {
  await login(page);
  const empresa = await empresaAtiva(page);
  /*
   * O PAR É DO CASO: produto e local de estoque NOVOS, com nome único, por `criarCadastro` (a exclusão lógica fica
   * registrada e roda no fim do caso). O local é escolhido na pesquisa da linha PELO NOME, e ela lista os locais de
   * todas as empresas visíveis. "O primeiro local da empresa" do seed não serve: as três do seed nascem na mesma
   * transação (mesmo `created_at`, o desempate é o id sorteado) e duas têm nome repetido na outra empresa ("Silo de
   * Grãos", "Fábrica de Ração") — a pesquisa podia entregar o gêmeo da outra empresa, sem saldo, e o unitário ficava
   * "0" pelo sorteio do seed, não pelo editor.
   */
  const seed = await referenciasDoSeed(page);
  const produtoId = (await criarCadastro(page, "products", {
    description: uniq("W29 produto"), group_id: seed.grupo.id, measurement_id: seed.unidade.id, financial_category_id: seed.natureza.id
  })).id;
  const armazemId = (await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `W29${Date.now().toString(36).slice(-5).toUpperCase()}`, description: uniq("W29 local"), type: "inputs"
  })).id;
  // a premissa: o par produto × armazém tem saldo com custo médio — é ele que preenche o unitário vazio
  await api(page, "POST", "/api/stock/input-entries", { empresa_id: empresa, entry_date: "2026-09-10", note: "W29", items: [{ product_id: produtoId, quantity: "100", unit_value: "2", generate_stock: true, warehouse_id: armazemId }] });
  const saldo = await api<{ quantity: string; averageCost: string }>(page, "GET", `/api/stock/balances/${armazemId}/${produtoId}`);
  expect(Number(saldo.averageCost), "premissa: o par tem custo médio positivo").toBeGreaterThan(0);
  expect([saldo.quantity, Number(saldo.averageCost)], "premissa: o par novo tem só a entrada deste caso (100 × 2,00)").toEqual(["100.0000", 2]);
  const nomeDoProduto = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${produtoId}`))["description"]);
  const nomeDoArmazem = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${armazemId}`))["description"]);

  await abrirWorkspace(page);
  await pickRef(page, "Cliente", "DEMO");
  await preencherClassificacaoFinanceira(page);                     // VENDAS-A1: condição do Salvar desde a A1
  await adicionarProduto(page).click();
  const linha = linhaDaGrade(page, 0);
  const escolher = async (celula: string, nome: string) => {
    await linha.getByTestId(celula).click();
    await painelDePesquisa(page).getByRole("combobox").fill(nome);
    await painelDePesquisa(page).getByRole("option").filter({ hasText: nome }).first().click();
    await expect(painelDePesquisa(page)).toHaveCount(0);
  };
  await escolher("central-vendas-produto", nomeDoProduto);
  await escolher("central-vendas-armazem", nomeDoArmazem);
  const unitario = linha.getByLabel("Valor unitário");
  await expect(unitario, "o saldo chegou e preencheu o unitário vazio com o custo médio (comportamento do editor)").not.toHaveValue("0");

  // o usuário zera o unitário DE PROPÓSITO (item sem custo)
  await unitario.fill("0");
  // ações só de apresentação: esconder e mostrar Estoque, trocar de visão
  const configurar = page.getByRole("button", { name: "Configurar colunas" });
  const estoque = page.getByTestId("central-vendas-configuracao").getByRole("checkbox", { name: "Mostrar Estoque" });
  await configurar.click(); await estoque.click(); await estoque.click(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Formulário", exact: true }).click();
  await mostrarGradeEFormulario(page);                              // Fase B: a opção de Configurar colunas
  await page.getByRole("button", { name: "Grade", exact: true }).click();
  await page.waitForTimeout(500);
  await marcarLinha(page, 0);                                       // os campos moram na linha MARCADA (Fase B)
  await expect(linhaDaGrade(page, 0).getByLabel("Valor unitário"), "apresentação não reescreve o unitário").toHaveValue("0");

  const post = await capturarPost(page);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => post.corpo).not.toBeNull();
  const item = (post.corpo!["items"] as Record<string, unknown>[])[0]!;
  expect(item["unit_price"], "o POST leva o zero que o usuário digitou").toBe("0");
  expect(item["warehouse_id"]).toBe(armazemId);
});

test("W30 — documento SALVO abre na Central em consulta: barra do desenho, leque com Histórico e Cancelar, sem Voltar, dados e itens do servidor", async ({ page }) => {
  await login(page);
  const salvo = await documentoSalvo(page);
  const lido = await api<{ total: string; subtotal: string; items: unknown[] }>(page, "GET", `/api/sales/sales/${salvo.id}`);
  await page.goto(`/vendas/sales/${salvo.id}`);
  const ws = page.getByTestId(WORKSPACE);
  await expect(ws).toBeVisible();
  await expect(page.getByTestId("base2-shell"), "a tela resumida não é mais desenhada").toHaveCount(0);

  // identidade: código do servidor e situação por StatusBadge (rótulo PT-BR, valor técnico no data-status)
  await expect(page.getByTestId("central-vendas-identidade-nome")).toHaveText(salvo.code);
  await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]")).toHaveAttribute("data-status", salvo.status);
  await expect(page.getByTestId("central-vendas-alterado"), "consulta não tem alteração").toHaveCount(0);

  // a barra do desenho na CONSULTA (decisão 270): Novo documento, Duplicar e a pílula; Posição do rótulo e Ações rápidas.
  // Nada de Voltar, Anexos, Editar ou Descartar.
  const barra = ws.getByTestId("central-vendas-acoes");
  expect(await nomesDaBarra(page)).toEqual(BARRA_DA_CONSULTA_DE_VENDA);
  const semDica = await barra.getByRole("button").evaluateAll((els) => els.filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("data-dica")).length);
  expect(semDica, "ação só de ícone sem dica").toBe(0);
  for (const proibida of [/^voltar$/i, /anexo/i, /^editar/i, /descartar/i]) await expect(ws.getByRole("button", { name: proibida }), `${proibida}`).toHaveCount(0);

  // o leque: Imprimir, Histórico, Documentos abertos e Cancelar — as ações reais que "Mais ações" tinha, e as da barra
  expect(await nomesDoLeque(page)).toEqual(LEQUE_DA_CONSULTA_DE_VENDA_ABERTA);
  await expect(page.getByTestId("central-vendas-acoes-rapidas-leque").getByRole("button", { name: /anexo/i }), "sem Anexos no leque").toHaveCount(0);
  await page.getByTestId("central-vendas-cancelar").click();
  const dlg = page.getByTestId("confirm-dialog");
  // o diálogo do desenho: título com espécie e código; "Voltar" cancela (o × do cabeçalho se chama Fechar)
  await expect(dlg.getByRole("heading", { name: `Cancelar venda ${salvo.code}?` })).toBeVisible();
  await dlg.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(dlg).toBeHidden();
  await (await acaoDaCentral(page, "central-vendas-historico")).click();
  await expect(page.getByRole("dialog").filter({ hasText: "Histórico" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Confirmar venda abre a MESMA confirmação de antes, na casca do desenho (a execução é coberta pelos specs de venda)
  await barra.getByRole("button", { name: "Confirmar venda" }).click();
  await expect(dlg.getByRole("heading", { name: `Confirmar venda ${salvo.code}?` })).toBeVisible();
  await dlg.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(dlg).toBeHidden();

  // dados e itens do SERVIDOR; em consulta não há lixeira nem campo editável na grade
  await expect(ws.locator('[data-campo="Cliente"]')).toContainText(salvo.cliente);
  await expect(ws.locator('[data-campo="Número"]')).toContainText(salvo.code);
  await expect(page.getByTestId("central-vendas-linha")).toHaveCount(lido.items.length);
  await expect(ws.getByRole("button", { name: /^Excluir item/ })).toHaveCount(0);
  await expect(page.getByTestId("central-vendas-grade").locator("input")).toHaveCount(0);
  const reais = (v: string) => Number(v).toFixed(2).replace(".", ",");
  await expect(page.getByTestId("central-vendas-subtotal")).toContainText(reais(lido.subtotal));
  // decisão 270: o Total do servidor saiu da faixa das abas e mora em Totais, como campo travado
  await abrirAbaDoLancamento(page, "Totais");
  await expect(page.getByTestId("central-vendas-total"), "o total do documento é o do servidor").toContainText(reais(lido.total));

  const pasta = process.env.EVIDENCIA_DIR ?? path.resolve("test-results", "evidencia-visual-ux-01");
  fs.mkdirSync(pasta, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.mouse.move(5, 895); await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(pasta, "consulta-1440x900.png") });
  // Novo documento abre o menu de operações da MESMA espécie (TOP-first); escolher e lançar é o VD-4
  await barra.getByRole("button", { name: "Novo documento" }).click();
  await expect(page.getByRole("menu").filter({ hasText: "Nova operação · Venda" }), "o menu de operações da espécie").toBeVisible();
  await page.keyboard.press("Escape");
});
