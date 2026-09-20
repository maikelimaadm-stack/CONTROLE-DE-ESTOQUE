import { test, expect, type Page, type Locator } from "@playwright/test";
import { login, logout, api, uniq } from "./helpers";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — O EDITOR DE SETE SEÇÕES (TOP-CONFIG-03), E1 a E10.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────┐
 * │ A integração já prova, no servidor, o que versiona e o que não versiona. O que nenhum teste de  │
 * │ API alcança é a promessa que a TELA faz ao administrador: que o que ele leu na tela é o que foi │
 * │ gravado (reabrir mostra o MESMO), que salvar sem mexer não inventa uma versão, que um campo     │
 * │ dependente desligado não decide nada, e que o histórico mostra a regra DAQUELA época — não a de │
 * │ hoje pintada com o nome de ontem.                                                               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A VERSÃO É SEMPRE CONFERIDA PELO SERVIDOR (`GET /api/admin/tipos-operacao/:id`), nunca por um texto
 * da tela: "a tela diz versão 2" e "existe a versão 2" são perguntas diferentes, e só a segunda é a que
 * o histórico promete responder.
 */
const ROTA = "/configuracoes?tab=operacoes&sub=tipos-operacao";

async function abrirTela(page: Page) {
  await page.goto(ROTA);
  await expect(page.getByRole("heading", { name: "Tipos de Operação" })).toBeVisible();
}

/** Um código novo a cada chamada: o banco de e2e é compartilhado e o código é único na organização. */
const codigoNovo = () => `9${Math.floor(Math.random() * 90000 + 10000)}`;

/**
 * Localiza a linha da TOP PELA BUSCA da tela, e não rolando a listagem.
 *
 * O banco de e2e é compartilhado e acumula tipos de operação a cada execução: procurar a linha na
 * primeira página funcionaria hoje e falharia no dia em que a suíte tivesse cadastrado mais de uma
 * página de TOPs — uma dependência de ordem de execução disfarçada de teste de interface. A busca é
 * server-side, então o recorte é exato; a asserção de UMA linha é a prova de que ele é.
 */
async function linhaDaTop(page: Page, codigo: string): Promise<Locator> {
  const busca = page.getByLabel("Buscar tipo de operação");
  await busca.fill(codigo);
  const linha = page.getByRole("row").filter({ hasText: codigo });
  await expect(linha, "a busca precisa recortar para exatamente a TOP procurada").toHaveCount(1);
  return linha.first();
}

async function abrirMenuDaLinha(page: Page, codigo: string) {
  const linha = await linhaDaTop(page, codigo);
  await linha.getByRole("button", { name: "Mais opções" }).click();
}

const abrirEdicao = async (page: Page, codigo: string): Promise<Locator> => {
  await abrirMenuDaLinha(page, codigo);
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  return forma;
};

/** A versão CORRENTE segundo o servidor — o árbitro de "subiu" e de "não subiu". */
const versaoNoServidor = async (page: Page, id: string) =>
  (await api<{ versao: number }>(page, "GET", `/api/admin/tipos-operacao/${id}`)).versao;

/** O id da TOP recém-criada pela TELA, localizado pelo código (que é único na organização). */
async function idDoCodigo(page: Page, codigo: string): Promise<string> {
  const r = await api<{ items: { id: string; codigo: string }[] }>(page, "GET", `/api/admin/tipos-operacao?search=${codigo}`);
  const achado = r.items.find((x) => x.codigo === codigo);
  expect(achado, `a TOP ${codigo} precisa existir no servidor depois de a tela salvar`).toBeTruthy();
  return achado!.id;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E1 — CRIAR COM CONFIGURAÇÃO COMPLETA, E REABRIR EXATAMENTE IGUAL
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E1 — cria uma TOP com configuração completa, e reabrir mostra EXATAMENTE o que foi gravado", async ({ page }) => {
  await login(page);
  await abrirTela(page);

  const codigo = codigoNovo();
  const nome = uniq("Venda configurada E1");
  await page.getByRole("button", { name: "Novo tipo de operação" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  await forma.getByTestId("top-campo-codigo").fill(codigo);
  await forma.getByTestId("top-campo-nome").fill(nome);
  await forma.getByTestId("top-campo-familia").selectOption("vendas.venda");

  // O aviso de versionamento é dito UMA vez, em toda abertura: configurar não é ligar o efeito.
  await expect(forma.getByTestId("top-aviso-versionamento")).toBeVisible();

  // ESTOQUE, FISCAL e APROVAÇÃO — três seções diferentes, numa gravação só.
  await forma.getByTestId("top-aba-estoque").click();
  await forma.getByTestId("top-campo-estoque-atualizacao").selectOption("saida");
  await forma.getByTestId("top-campo-estoque-armazem").selectOption("true");
  await forma.getByTestId("top-campo-estoque-saldo").selectOption("permitir");

  await forma.getByTestId("top-aba-fiscal").click();
  await forma.getByTestId("top-campo-fiscal-habilitado").selectOption("true");
  await forma.getByTestId("top-campo-fiscal-documento").selectOption("true");

  await forma.getByTestId("top-aba-aprovacao").click();
  await forma.getByTestId("top-campo-aprovacao-politica").selectOption("por_valor");
  await forma.getByTestId("top-campo-aprovacao-valor").fill("1500.00");

  await forma.getByTestId("top-salvar").click();
  await expect(forma).toBeHidden();

  /**
   * REABRIR É A PROVA. Uma tela que MOSTRA a escolha e manda outra coisa ao servidor — ou que manda a
   * certa e relê o padrão — passaria em todo teste que só olhasse o formulário antes de salvar. Cada
   * campo é conferido um a um, e não "a seção existe": uma asserção de presença passaria com todos os
   * valores no neutro.
   */
  const edicao = await abrirEdicao(page, codigo);
  await edicao.getByTestId("top-aba-estoque").click();
  await expect(edicao.getByTestId("top-campo-estoque-atualizacao")).toHaveValue("saida");
  await expect(edicao.getByTestId("top-campo-estoque-armazem")).toHaveValue("true");
  await expect(edicao.getByTestId("top-campo-estoque-saldo")).toHaveValue("permitir");
  await edicao.getByTestId("top-aba-fiscal").click();
  await expect(edicao.getByTestId("top-campo-fiscal-habilitado")).toHaveValue("true");
  await expect(edicao.getByTestId("top-campo-fiscal-documento")).toHaveValue("true");
  await edicao.getByTestId("top-aba-aprovacao").click();
  await expect(edicao.getByTestId("top-campo-aprovacao-politica")).toHaveValue("por_valor");
  await expect(edicao.getByTestId("top-campo-aprovacao-valor")).toHaveValue("1500.00");

  // E a identidade é imutável — a tela nem oferece o caminho.
  await edicao.getByTestId("top-aba-identificacao").click();
  await expect(edicao.getByTestId("top-campo-codigo")).toBeDisabled();
  await expect(edicao.getByTestId("top-campo-familia")).toBeDisabled();

  // Nasceu na versão 1: a criação é UMA versão, mesmo mexendo em três seções.
  expect(await versaoNoServidor(page, await idDoCodigo(page, codigo)), "a criação inteira é UMA versão").toBe(1);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E2 / E3 / E4 — O QUE VERSIONA, O QUE NÃO VERSIONA, E O NO-OP
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** Cria uma TOP simples pela API, para que o caso abaixo meça só a EDIÇÃO. */
async function topSimples(page: Page, codigoBase = "vendas.venda") {
  const codigo = codigoNovo();
  const nome = uniq("TOP de edição");
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome });
  return { id: criado.id, codigo, nome };
}

test("E2/E3/E4 — editar estoque SOBE a versão; mudar só a situação e salvar sem alterar NÃO sobem", async ({ page }) => {
  await login(page);
  const top = await topSimples(page);
  expect(await versaoNoServidor(page, top.id), "a TOP nasce na versão 1").toBe(1);
  await abrirTela(page);

  /**
   * E4 — NO-OP PRIMEIRO, de propósito.
   *
   * Reenviar o formulário sem mexer em nada não pode gerar versão: a versão é o registro do que MUDOU,
   * e uma versão sem diff faz o histórico contar um evento que não existiu. Medir isto ANTES das
   * edições garante que o número comparado depois é o de uma TOP intocada.
   */
  const semMexer = await abrirEdicao(page, top.codigo);
  await semMexer.getByTestId("top-salvar").click();
  await expect(semMexer).toBeHidden();
  expect(await versaoNoServidor(page, top.id), "salvar sem alterar NÃO cria versão").toBe(1);

  // E2 — CONFIGURAÇÃO É CONTEÚDO: mexer no estoque cria a versão 2.
  const edicao = await abrirEdicao(page, top.codigo);
  await edicao.getByTestId("top-aba-estoque").click();
  await edicao.getByTestId("top-campo-estoque-atualizacao").selectOption("saida");
  await edicao.getByTestId("top-salvar").click();
  await expect(edicao).toBeHidden();
  expect(await versaoNoServidor(page, top.id), "mexer na configuração de estoque é conteúdo: versão nova").toBe(2);

  /**
   * E3 — SITUAÇÃO É ESTADO, NÃO CONTEÚDO. Desativar não muda o que a TOP É: um documento que a cita
   * continua citando a mesma regra. Se desativar versionasse, todo liga-desliga administrativo poluiria
   * o histórico da política — e a pergunta "o que mudou na versão 3?" passaria a não ter resposta.
   */
  await abrirMenuDaLinha(page, top.codigo);
  await page.getByRole("menuitem", { name: "Desativar" }).click();
  await expect(await linhaDaTop(page, top.codigo), "a premissa: a situação MUDOU de fato").toContainText("Inativo");
  expect(await versaoNoServidor(page, top.id), "ativar/desativar NÃO versiona").toBe(2);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E5 — DEPENDÊNCIA NEUTRALIZA OS FILHOS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E5 — seção desligada neutraliza os campos filhos: eles não são editáveis nem gravados como exigência", async ({ page }) => {
  await login(page);
  const top = await topSimples(page);
  await abrirTela(page);

  const forma = await abrirEdicao(page, top.codigo);
  await forma.getByTestId("top-aba-estoque").click();

  // PREMISSA: com movimentação declarada, os filhos SÃO editáveis e aceitam valor não-neutro. Sem esta
  // metade, "estão desabilitados" seria satisfeito por campos que nunca funcionaram.
  await forma.getByTestId("top-campo-estoque-atualizacao").selectOption("saida");
  await expect(forma.getByTestId("top-campo-estoque-armazem")).toBeEnabled();
  await forma.getByTestId("top-campo-estoque-armazem").selectOption("true");
  await forma.getByTestId("top-campo-estoque-saldo").selectOption("permitir");

  // DESLIGAR O PAI: os filhos param de decidir, e a tela diz por quê em vez de deixá-los à toa.
  await forma.getByTestId("top-campo-estoque-atualizacao").selectOption("nenhuma");
  await expect(forma.getByTestId("top-campo-estoque-momento"), "filho de seção desligada não é editável").toBeDisabled();
  await expect(forma.getByTestId("top-campo-estoque-armazem")).toBeDisabled();
  await expect(forma.getByTestId("top-campo-estoque-saldo")).toBeDisabled();

  await forma.getByTestId("top-salvar").click();
  await expect(forma).toBeHidden();

  /**
   * E O QUE FOI GRAVADO É O NEUTRO, não o valor que ficou na tela antes de o pai ser desligado.
   *
   * Esta é a parte que a asserção de `disabled` sozinha não pega: um campo desabilitado cujo VALOR
   * continuasse indo ao servidor gravaria "exige armazém" numa operação que não movimenta estoque — uma
   * exigência que ninguém configurou e que ninguém consegue explicar ao ler a tela.
   */
  const reaberta = await abrirEdicao(page, top.codigo);
  await reaberta.getByTestId("top-aba-estoque").click();
  await expect(reaberta.getByTestId("top-campo-estoque-atualizacao")).toHaveValue("nenhuma");
  await expect(reaberta.getByTestId("top-campo-estoque-armazem"), "o filho voltou ao neutro").toHaveValue("false");
  await expect(reaberta.getByTestId("top-campo-estoque-saldo"), "e o outro também").toHaveValue("bloquear");
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E6 — O HISTÓRICO É SOMENTE LEITURA, E CONSERVA OS VALORES DAQUELA ÉPOCA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E6 — o histórico mostra a configuração DE CADA VERSÃO, sem nenhum controle de edição", async ({ page }) => {
  await login(page);
  const top = await topSimples(page);
  await abrirTela(page);

  // VERSÃO 1 → 2: a saída de estoque entra. É o valor que a versão 2 tem e a 1 não.
  const edicao = await abrirEdicao(page, top.codigo);
  await edicao.getByTestId("top-aba-estoque").click();
  await edicao.getByTestId("top-campo-estoque-atualizacao").selectOption("saida");
  await edicao.getByTestId("top-salvar").click();
  await expect(edicao).toBeHidden();
  expect(await versaoNoServidor(page, top.id), "a premissa: existem DUAS versões para comparar").toBe(2);

  await abrirMenuDaLinha(page, top.codigo);
  await page.getByRole("menuitem", { name: "Ver versões" }).click();
  const versoes = page.getByTestId("versoes-tipo-operacao");
  await expect(versoes).toBeVisible();
  const linhas = versoes.getByTestId("top-versao-linha");
  await expect(linhas, "duas gravações, duas versões").toHaveCount(2);

  // A lista vem em ordem DECRESCENTE: a primeira linha é a versão 2, a segunda é a 1.
  const v2 = linhas.nth(0); const v1 = linhas.nth(1);
  await expect(v2).toContainText("Versão 2");
  await expect(v1).toContainText("Versão 1");

  /**
   * CADA VERSÃO MOSTRA A CONFIGURAÇÃO DELA. Se o histórico exibisse a configuração VIGENTE ao lado de
   * nomes antigos, tudo acima passaria igual e só esta asserção notaria: a versão 1 diria que movimenta
   * estoque porque a versão 2 movimenta — mentindo com a aparência de registro.
   */
  await v2.getByTestId("top-versao-detalhe").click();
  await expect(v2.getByTestId("top-versao-configuracao")).toContainText("Saída");

  await v1.getByTestId("top-versao-detalhe").click();
  const configV1 = v1.getByTestId("top-versao-configuracao");
  await expect(configV1, "a versão 1 conserva o que ELA declarava").toContainText("Não movimenta estoque");
  await expect(configV1, "e não herda o valor da versão seguinte").not.toContainText("Saída");

  // SOMENTE LEITURA: nenhum controle de formulário em lugar nenhum do histórico.
  await expect(versoes.locator("input, select, textarea"), "nada no histórico é editável").toHaveCount(0);
  await expect(versoes.getByTestId("top-salvar"), "e não existe Salvar aqui").toHaveCount(0);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E7 — CAPABILITY AUSENTE É FAIL-CLOSED
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E7 — servidor que não confirma as capacidades BLOQUEIA as seções de operação, e a identificação continua", async ({ page }) => {
  await login(page);
  const top = await topSimples(page);

  /**
   * A API ANTERIOR a esta fatia não tem `/capabilities`: o nó paramétrico `:id` casa "capabilities"
   * como id e a resposta é 404 ou 500. Gravar assim mesmo mandaria uma configuração que o servidor
   * ignoraria em silêncio — o administrador leria "salvo" sobre uma regra que não existe.
   *
   * O servidor é FABRICADO aqui de propósito: a pergunta é o que a TELA faz diante de uma resposta que
   * ela não pode ler, e não o que a API de hoje responde (ela responde certo — é o teste E1 que mede).
   */
  await page.route("**/api/admin/tipos-operacao/capabilities", (rota) =>
    rota.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "x" } }) }));

  await abrirTela(page);
  const forma = await abrirEdicao(page, top.codigo);

  // A IDENTIFICAÇÃO CONTINUA: nome e descrição não dependem da configuração, e fechar a tela inteira
  // tiraria do administrador a única edição que ainda é segura.
  await expect(forma.getByTestId("top-campo-nome"), "o nome continua editável").toBeEnabled();

  // AS SEÇÕES DE OPERAÇÃO, NÃO. Em todas elas a mesma mensagem única, e NENHUM campo na árvore: campo
  // desabilitado ainda sugere que existe algo a configurar ali.
  for (const aba of ["geral", "estoque", "financeiro", "fiscal", "aprovacao", "destinos"]) {
    await forma.getByTestId(`top-aba-${aba}`).click();
    await expect(forma.getByTestId("top-config-nao-confirmada"), `${aba}: a tela diz que o servidor não confirmou`).toBeVisible();
  }
  await expect(forma.getByTestId("top-campo-estoque-atualizacao"), "nenhum campo de operação montou").toHaveCount(0);
  await expect(forma.getByTestId("top-destinos"), "nem o editor de próximas operações").toHaveCount(0);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E8 — `view` SEM `edit` NÃO SALVA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E8 — quem tem view e não tem edit enxerga a tela e NÃO recebe caminho para gravar", async ({ page }) => {
  await login(page);
  const top = await topSimples(page);

  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles",
    { name: uniq("Leitor de TOP"), permissions: ["tipos_operacao.view"] });
  const leitor = { email: `e2e-leitor-top-${Date.now()}@demo.local`, password: "Leitor@12345" };
  await api(page, "POST", "/api/admin/members",
    { name: "Leitor E2E de TOP", email: leitor.email, password: leitor.password, role_id: papel.id, escopos_empresas: [] });

  await logout(page);
  await login(page, leitor);
  await abrirTela(page);

  // PREMISSA: ele VÊ — a linha da TOP está lá. Sem isto, "não pode gravar" seria satisfeito por uma
  // tela que ele nem consegue abrir, que é outro caso (e é o do spec de permissões).
  await expect(await linhaDaTop(page, top.codigo), "com view, a TOP é visível").toBeVisible();

  // E NÃO RECEBE CAMINHO PARA GRAVAR: nem criar, nem editar, nem mudar estado.
  await expect(page.getByRole("button", { name: "Novo tipo de operação" }), "criar exige tipos_operacao.create").toHaveCount(0);
  await abrirMenuDaLinha(page, top.codigo);
  await expect(page.getByRole("menuitem", { name: "Editar" }), "editar aparece, porém fechado").toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Desativar" })).toBeDisabled();

  /**
   * E A AUTORIDADE CONTINUA NO SERVIDOR. Esconder o botão é apresentação; o que impede a gravação é a
   * API — e é por isso que a chamada direta é feita aqui, sem passar pela tela. Sem esta asserção, o
   * teste provaria apenas que a interface é discreta.
   */
  // A base da API é resolvida FORA do navegador e passada adiante: `process.env` não existe lá dentro.
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  const recusa = await page.evaluate(async ({ id, base }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null };
    const res = await fetch(`${base}/api/admin/tipos-operacao/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) },
      body: JSON.stringify({ nome: "tentativa sem capacidade", revisao: 1 })
    });
    return res.status;
  }, { id: top.id, base });
  expect(recusa, "o servidor recusa a escrita de quem só tem view").toBe(403);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E9 — A CONFIGURAÇÃO SOBREVIVE AO REFRESH
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E9 — a configuração gravada sobrevive a um recarregamento completo da página", async ({ page }) => {
  await login(page);
  const top = await topSimples(page);
  await abrirTela(page);

  const forma = await abrirEdicao(page, top.codigo);
  await forma.getByTestId("top-aba-fiscal").click();
  await forma.getByTestId("top-campo-fiscal-habilitado").selectOption("true");
  await forma.getByTestId("top-campo-fiscal-natureza").selectOption("true");
  await forma.getByTestId("top-salvar").click();
  await expect(forma).toBeHidden();

  /**
   * `reload()` derruba TODO estado do cliente — cache de query, estado do React, memória do formulário.
   * O que voltar depois disso veio do SERVIDOR, e só isso prova que a configuração foi de fato gravada
   * em vez de ter ficado viva num cache que a próxima aba fechada levaria embora.
   */
  await page.reload();
  await expect(page.getByRole("heading", { name: "Tipos de Operação" })).toBeVisible();

  const reaberta = await abrirEdicao(page, top.codigo);
  await reaberta.getByTestId("top-aba-fiscal").click();
  await expect(reaberta.getByTestId("top-campo-fiscal-habilitado")).toHaveValue("true");
  await expect(reaberta.getByTestId("top-campo-fiscal-natureza")).toHaveValue("true");
});
