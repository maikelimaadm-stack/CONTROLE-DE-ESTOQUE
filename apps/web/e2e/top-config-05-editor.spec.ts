import { test, expect, type Page, type Locator, type Request } from "@playwright/test";
import { login, api, uniq } from "./helpers";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — AS RESTRIÇÕES E O FISCAL DO FORMATO 3 (TOP-CONFIG-05).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────┐
 * │ A integração prova que a API grava o formato 3 e as condições permitidas. O que ela não alcança │
 * │ é a promessa da TELA: que marcar "Exige transportadora", "Bloqueia" em cliente em atraso, duas  │
 * │ condições e o fiscal pelo EDITOR produz, no servidor, a versão nova no formato 3 com EXATAMENTE │
 * │ isso — e que um CFOP de entrada numa operação de venda é barrado no campo, sem nada sair no fio.│
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * FIXTURE PRÓPRIA: a TOP de venda e as duas condições nascem aqui, pela API. Nenhuma TOP do seed é
 * tocada — uma TOP do seed com "Bloqueia" ligado mudaria o resultado dos specs de venda que a usam.
 * No `finally` a TOP criada é excluída (exclusão lógica da própria API), para não sobrar uma operação
 * restritiva no lançador de quem vier depois.
 *
 * A VERSÃO E O CONTEÚDO SÃO CONFERIDOS PELO SERVIDOR (`GET /api/admin/tipos-operacao/:id`), nunca por
 * um texto da tela.
 */
const ROTA = "/configuracoes?tab=operacoes&sub=tipos-operacao";

/** Texto do contrato (§1, `AVISO_FISCAL_SO_CONFIGURACAO`), escrito por extenso: a tela tem de dizer ISTO. */
const AVISO_FISCAL = "Usado na emissão da nota fiscal. A emissão ainda não existe no sistema.";

/** Prefixo 3 (T-CONFIG-05): não colide com os códigos 4/5/6/7/9 dos specs vizinhos. Único na organização. */
const codigoNovo = () => `3${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface CondicaoFixture { id: string; code: string; nome: string }
interface TopFixture { id: string; codigo: string; nome: string }

interface DetalheTopFormato3 {
  versao: number;
  configuracaoSchema: number;
  configuracao: {
    suportada: boolean;
    versaoSchema: number;
    valor: {
      versaoSchema: number;
      geral: { exigeTransportadora: boolean };
      financeiro: { clienteEmAtraso: string; toleranciaAtrasoDias: number };
      fiscal: { habilitado: boolean; modeloDocumento: string; cfopDentroEstado: string; cfopForaEstado: string };
    };
  };
  condicoesPermitidas: { id: string; codigo: string; nome: string }[];
}

async function abrirTela(page: Page) {
  await page.goto(ROTA);
  await expect(page.getByRole("heading", { name: "Tipos de Operação" })).toBeVisible();
}

/** A linha da TOP pela BUSCA server-side (o banco de e2e acumula TOPs; rolar a lista seria dependência de ordem). */
async function linhaDaTop(page: Page, codigo: string): Promise<Locator> {
  await page.getByLabel("Buscar tipo de operação").fill(codigo);
  const linha = page.getByRole("row").filter({ hasText: codigo });
  await expect(linha, "a busca precisa recortar para exatamente a TOP procurada").toHaveCount(1);
  return linha.first();
}

async function abrirMenuDaLinha(page: Page, codigo: string) {
  const linha = await linhaDaTop(page, codigo);
  await linha.getByRole("button", { name: "Mais opções" }).click();
}

async function abrirEdicao(page: Page, codigo: string): Promise<Locator> {
  await abrirMenuDaLinha(page, codigo);
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  return forma;
}

/**
 * Abre a aba que mostra `testId`. O contrato fixa o testid do campo, não a aba em que ele mora; tentar as
 * abas candidatas NA ORDEM declarada mantém o teste preso ao contrato, e não ao arranjo visual. Se nenhuma
 * mostrar o campo, o `expect` final reprova com o nome do campo que sumiu.
 */
async function abrirAbaCom(forma: Locator, testId: string, abas: readonly string[]): Promise<Locator> {
  const alvo = forma.getByTestId(testId);
  for (const aba of abas) {
    await forma.getByTestId(`top-aba-${aba}`).click();
    if (await alvo.isVisible()) break;
  }
  await expect(alvo, `o campo ${testId} precisa existir no editor com o servidor que confirma as restrições`).toBeVisible();
  return alvo;
}

/** Condição de pagamento própria do teste, com o código que o servidor gerou (molde: vendas-a4-condicao). */
async function criarCondicao(page: Page, rotulo: string): Promise<CondicaoFixture> {
  const nome = uniq(rotulo);
  const criada = await api<{ id: string }>(page, "POST", "/api/resources/condicoes_pagamento", {
    nome, parcelas: 2, dias_primeira_parcela: 30, modo: "intervalo", intervalo_dias: 30, entrada: false, is_active: true
  });
  const lida = await api<{ id: string; code: string | null; nome: string }>(page, "GET", `/api/resources/condicoes_pagamento/${criada.id}`);
  expect(lida.code, "premissa: o servidor gerou o código da condição").toBeTruthy();
  return { id: lida.id, code: String(lida.code), nome: lida.nome };
}

/** TOP de VENDA nova, sem configuração declarada: o ponto de partida é o neutro. */
async function criarTopDeVenda(page: Page, rotulo: string): Promise<TopFixture> {
  const codigo = codigoNovo();
  const nome = uniq(rotulo);
  const criada = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: "vendas.venda", nome });
  return { id: criada.id, codigo, nome };
}

/** Limpeza: a exclusão lógica da própria API. Falha aqui é registrada, mas não esconde o erro do teste. */
async function excluirTop(page: Page, id: string) {
  // A exclusão exige a `revisao` corrente (concorrência otimista): lida na hora, como na limpeza do spec da Central.
  await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${id}`)
    .then((d) => api(page, "DELETE", `/api/admin/tipos-operacao/${id}`, { revisao: d.revisao }))
    .catch((e: unknown) => {
      console.warn(`[top-config-05-editor] limpeza da TOP ${id} falhou: ${String(e)}`);
    });
}

const detalheNoServidor = (page: Page, id: string) => api<DetalheTopFormato3>(page, "GET", `/api/admin/tipos-operacao/${id}`);

/**
 * Adiciona uma condição pelo seletor do bloco. O contrato diz "seletor", não o componente: `<select>`
 * nativo escolhe pelo id; o seletor com busca (RefSelect) procura pelo nome — o mesmo gesto do usuário.
 */
async function adicionarCondicao(page: Page, forma: Locator, condicao: CondicaoFixture) {
  const seletor = forma.getByTestId("top-condicoes-permitidas-adicionar");
  const tag = await seletor.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "select") {
    await seletor.selectOption(condicao.id);
  } else {
    const gatilho = tag === "button" ? seletor : seletor.locator("button").first();
    await gatilho.click();
    await page.getByPlaceholder("Pesquisar...").fill(condicao.nome);
    await page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last()
      .getByRole("option", { name: new RegExp(condicao.nome.slice(0, 20), "i") }).first().click();
  }
  await expect(forma.getByTestId(`top-condicao-permitida-${condicao.id}`), `a condição ${condicao.nome} entra na lista`).toBeVisible();
}

/** Escritas na TOP: é o que NÃO pode sair quando o campo está errado. */
const ehEscritaDeTop = (r: Request) =>
  ["POST", "PUT", "PATCH"].includes(r.method()) && new URL(r.url()).pathname.includes("/api/admin/tipos-operacao");

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * R1 — RESTRIÇÕES + FISCAL PELA TELA → VERSÃO NOVA NO FORMATO 3, COM EXATAMENTE O QUE FOI MARCADO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("R1 — venda: transportadora exigida, atraso bloqueia, duas condições e fiscal gravam a versão 2 no formato 3, e o histórico mostra as condições", async ({ page }) => {
  await login(page);
  const condA = await criarCondicao(page, "Condição R1 A");
  const condB = await criarCondicao(page, "Condição R1 B");
  const top = await criarTopDeVenda(page, "Venda restrita R1");
  try {
    const antes = await detalheNoServidor(page, top.id);
    expect(antes.versao, "a TOP nasce na versão 1").toBe(1);
    expect(antes.condicoesPermitidas, "e sem lista de condições: todas são aceitas").toEqual([]);

    await abrirTela(page);
    const forma = await abrirEdicao(page, top.codigo);

    // GERAL — exige transportadora.
    const transportadora = await abrirAbaCom(forma, "top-geral-exige-transportadora", ["geral"]);
    await expect(transportadora, "premissa: nasce desmarcada (neutro)").not.toBeChecked();
    await transportadora.check();
    await expect(transportadora).toBeChecked();

    // FINANCEIRO — cliente em atraso BLOQUEIA, tolerância 0.
    const atraso = await abrirAbaCom(forma, "top-financeiro-cliente-em-atraso", ["financeiro", "geral"]);
    await expect(atraso, "premissa: nasce em Não valida (neutro)").toHaveValue("nao_valida");
    await atraso.selectOption("bloqueia");
    await expect(atraso).toHaveValue("bloqueia");
    const tolerancia = forma.getByTestId("top-financeiro-tolerancia-atraso");
    await expect(tolerancia, "com política ativa, a tolerância é editável").toBeEnabled();
    await tolerancia.fill("0");

    // CONDIÇÕES PERMITIDAS — duas, a partir de "Todas as condições".
    await abrirAbaCom(forma, "top-condicoes-permitidas", ["financeiro", "geral"]);
    await expect(forma.getByTestId("top-condicoes-permitidas-vazio"), "sem lista, a tela diz que todas valem").toContainText("Todas as condições");
    await adicionarCondicao(page, forma, condA);
    await adicionarCondicao(page, forma, condB);
    await expect(forma.getByTestId("top-condicoes-permitidas-vazio"), "com lista, o 'todas' some").toHaveCount(0);

    // FISCAL — liga, modelo NF-e, CFOPs de SAÍDA (venda).
    await forma.getByTestId("top-aba-fiscal").click();
    await forma.getByTestId("top-campo-fiscal-habilitado").selectOption("true");
    await forma.getByTestId("top-fiscal-modelo").selectOption("nfe");
    await forma.getByTestId("top-fiscal-cfop-dentro").fill("5102");
    await forma.getByTestId("top-fiscal-cfop-fora").fill("6102");
    await expect(forma.getByTestId("top-fiscal-aviso-emissao"), "configurar o fiscal não é emitir nota: a tela diz isso").toHaveText(AVISO_FISCAL);

    // SALVAR — e conferir o que saiu no fio: formato 3 e a lista presente.
    const put = page.waitForRequest((r) => r.method() === "PUT" && new URL(r.url()).pathname.endsWith(`/api/admin/tipos-operacao/${top.id}`));
    await forma.getByTestId("top-salvar").click();
    const corpo = (await put).postDataJSON() as { configuracao?: { versaoSchema?: number }; condicoesPermitidas?: string[] };
    expect(corpo.configuracao?.versaoSchema, "o corpo enviado é o formato 3").toBe(3);
    expect([...(corpo.condicoesPermitidas ?? [])].sort(), "e declara as duas condições").toEqual([condA.id, condB.id].sort());
    await expect(forma).toBeHidden();

    /**
     * O SERVIDOR É O ÁRBITRO. Cada chave é conferida uma a uma — "a configuração existe" passaria com tudo
     * no neutro, e é exatamente o neutro que uma tela que perdeu o rascunho gravaria.
     */
    const depois = await detalheNoServidor(page, top.id);
    expect(depois.versao, "restrições são conteúdo: versão nova").toBe(2);
    expect(depois.configuracaoSchema, "a versão nova é do formato 3").toBe(3);
    expect(depois.configuracao.suportada, "e a tela do servidor a lê").toBe(true);
    const valor = depois.configuracao.valor;
    expect(valor.versaoSchema).toBe(3);
    expect(valor.geral.exigeTransportadora, "exige transportadora").toBe(true);
    expect(valor.financeiro.clienteEmAtraso, "cliente em atraso bloqueia").toBe("bloqueia");
    expect(valor.financeiro.toleranciaAtrasoDias, "tolerância 0").toBe(0);
    expect(valor.fiscal.habilitado, "fiscal ligado").toBe(true);
    expect(valor.fiscal.modeloDocumento, "modelo NF-e").toBe("nfe");
    expect(valor.fiscal.cfopDentroEstado, "CFOP dentro do estado").toBe("5102");
    expect(valor.fiscal.cfopForaEstado, "CFOP fora do estado").toBe("6102");
    expect(depois.condicoesPermitidas.map((c) => c.id).sort(), "as DUAS condições, e só elas").toEqual([condA.id, condB.id].sort());
    expect(depois.condicoesPermitidas.find((c) => c.id === condA.id)?.nome, "com o nome de cada uma").toBe(condA.nome);

    /**
     * HISTÓRICO — a versão 2 mostra AS condições dela; a versão 1 não herda a lista da seguinte (se o
     * histórico pintasse a lista vigente em toda versão, só esta metade notaria).
     */
    await abrirMenuDaLinha(page, top.codigo);
    await page.getByRole("menuitem", { name: "Ver versões" }).click();
    const versoes = page.getByTestId("versoes-tipo-operacao");
    await expect(versoes).toBeVisible();
    const linhas = versoes.getByTestId("top-versao-linha");
    await expect(linhas, "duas gravações, duas versões").toHaveCount(2);
    const v2 = linhas.nth(0); const v1 = linhas.nth(1);
    await expect(v2).toContainText("Versão 2");
    await v2.getByTestId("top-versao-detalhe").click();
    const condicoesV2 = versoes.getByTestId("top-historico-condicoes-2");
    await expect(condicoesV2).toBeVisible();
    await expect(condicoesV2).toContainText(condA.nome);
    await expect(condicoesV2).toContainText(condB.nome);
    await expect(v1).toContainText("Versão 1");
    await v1.getByTestId("top-versao-detalhe").click();
    await expect(v1, "a versão 1 não tinha lista").not.toContainText(condA.nome);
    await expect(v1).not.toContainText(condB.nome);
    await expect(versoes.locator("input, select, textarea"), "nada no histórico é editável").toHaveCount(0);
  } finally {
    await excluirTop(page, top.id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * R2 — CFOP DE ENTRADA NUMA VENDA: ERRO NO CAMPO, E NADA SAI NO FIO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("R2 — venda com CFOP 1102 dentro do estado: erro no campo, e nenhuma escrita sai para o servidor", async ({ page }) => {
  await login(page);
  const top = await criarTopDeVenda(page, "Venda CFOP R2");
  try {
    await abrirTela(page);
    const forma = await abrirEdicao(page, top.codigo);
    await forma.getByTestId("top-aba-fiscal").click();
    await forma.getByTestId("top-campo-fiscal-habilitado").selectOption("true");
    await forma.getByTestId("top-fiscal-cfop-dentro").fill("1102");

    // A escuta começa DEPOIS do preenchimento e ANTES do gesto de salvar: é o gesto que não pode escrever.
    const escritas: string[] = [];
    page.on("request", (r) => { if (ehEscritaDeTop(r)) escritas.push(`${r.method()} ${new URL(r.url()).pathname}`); });

    /**
     * `force`: com o formulário inválido o Salvar pode estar desabilitado — e clicar num botão desabilitado
     * não dispara nada, que é justamente o comportamento sob prova. Sem `force`, o clique esperaria o
     * botão habilitar e o teste mediria o timeout, não a tela.
     */
    await forma.getByTestId("top-salvar").click({ force: true });
    const erro = forma.getByTestId("top-erro-fiscal.cfopDentroEstado");
    await expect(erro, "o CFOP de entrada numa venda é recusado NO CAMPO").toBeVisible();
    await expect(erro).not.toBeEmpty();
    await expect(forma, "o editor continua aberto: nada foi gravado").toBeVisible();

    // O servidor confirma (o GET dá tempo a uma escrita que tivesse saído de chegar à escuta).
    const detalhe = await detalheNoServidor(page, top.id);
    expect(detalhe.versao, "nenhuma versão nova").toBe(1);
    expect(escritas, "nenhuma requisição PUT/POST saiu para a TOP").toEqual([]);
  } finally {
    await excluirTop(page, top.id);
  }
});
