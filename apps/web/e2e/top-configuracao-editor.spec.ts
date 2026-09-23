import { test, expect, type Page, type Locator } from "@playwright/test";
import { login, logout, api, uniq, empresaAtiva, primeiroId } from "./helpers";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — O EDITOR DE SETE SEÇÕES (TOP-CONFIG-03), E1 a E9 e E20.
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

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E20 — DECLARAR QUE NÃO HÁ PRÓXIMA OPERAÇÃO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ┌─ O QUE SÓ ESTE TESTE PROVA ─────────────────────────────────────────────────────────────────────┐
 * │ Que a AUSÊNCIA de política e a política VAZIA são estados diferentes ATRAVESSANDO A TELA INTEIRA: │
 * │ o editor mostra frases diferentes para os dois, declarar o vazio cria versão, e o documento       │
 * │ nascido em cada um deles recebe tratamento OPOSTO na tela de vendas.                              │
 * │                                                                                                   │
 * │ Nenhum outro teste cobre esse caminho inteiro. O E16 (portal) já mede "política vazia não oferece │
 * │ conversão", mas parte de uma TOP semeada pela API JÁ declarada — ele nunca passa pelo estado não  │
 * │ declarado, e por isso não mediria uma tela que tratasse os dois como a mesma coisa. A integração  │
 * │ (`tipos-operacao-destinos.test.ts`) prova o mesmo no servidor, e é lá que fica a recusa 422 da     │
 * │ conversão pedida por fora: aqui não se chama a rota de conversão por `fetch`, porque o que este   │
 * │ arquivo mede é a TELA, e fabricar um pedido que nenhum botão da tela faz não é medir tela.         │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE O CONTRASTE É OBRIGATÓRIO, E NÃO ENFEITE ──────────────────────────────────────────────┐
 * │ Uma TOP recém-criada que ninguém tocou TAMBÉM tem zero destinos. Se este teste apenas criasse    │
 * │ uma TOP e verificasse "o documento dela não oferece conversão", ele passaria IGUALMENTE no        │
 * │ estado errado — o estado legado, em que a tela DEVE oferecer a conversão pela cadeia anterior —   │
 * │ e não provaria absolutamente nada. Por isso as duas TOPs abaixo são gêmeas: mesma família, mesmo  │
 * │ usuário, mesma situação, e as DUAS com a lista de destinos vazia. A ÚNICA diferença entre elas é  │
 * │ o booleano `destinosConfigurados`, e é a ele que as duas conclusões opostas são atribuídas.       │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE ORÇAMENTO, E NÃO VENDA ────────────────────────────────────────────────────────────────┐
 * │ A cadeia anterior do produto liga orçamento → pedido → venda. A VENDA é a ponta dela: uma venda   │
 * │ legada não oferece conversão nenhuma, porque não há aresta de compatibilidade saindo dela. Com    │
 * │ venda, o contraste seria silencioso (os dois lados sem botão) e o teste voltaria a ser vácuo. O   │
 * │ orçamento é a única escolha em que o estado legado tem comportamento VISÍVEL para contrastar.     │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** O detalhe administrativo: a versão corrente, o estado da política e as arestas DAQUELA versão. */
const politicaNoServidor = (page: Page, id: string) =>
  api<{ versao: number; destinosConfigurados: boolean; destinos: { tipoOperacaoId: string }[] }>(
    page, "GET", `/api/admin/tipos-operacao/${id}`);

/** O histórico: é onde o estado da política de CADA época fica legível, versão por versão. */
const versoesNoServidor = (page: Page, id: string) =>
  api<{ items: { versao: number; destinosConfigurados: boolean; destinos: unknown[] }[] }>(
    page, "GET", `/api/admin/tipos-operacao/${id}/versoes`);

/**
 * Um orçamento citando a TOP dada, semeado pela API.
 *
 * A data é arbitrária de propósito: este teste chega ao documento pela URL DELE, nunca por listagem —
 * então nada aqui depende de ordenação, de paginação ou de quantos lançamentos o banco compartilhado já
 * acumulou. O que a fixture precisa garantir é outra coisa, e está asseverado abaixo: que o documento
 * nasceu na variante certa e citando a VERSÃO certa da TOP.
 */
const DATA_DO_DOCUMENTO = "2027-12-31";
async function criarOrcamento(page: Page, topId: string) {
  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const criado = await api<{ id: string }>(page, "POST", "/api/sales/budgets", {
    empresa_id: empresa, document_date: DATA_DO_DOCUMENTO, client_id: cliente, tipo_operacao_id: topId,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });
  const lido = await api<{ code: string; kind: string; tipo_operacao: { id: string; versao: number } | null }>(
    page, "GET", `/api/sales/budgets/${criado.id}`);
  expect(lido.kind, "a fixture precisa nascer como orçamento").toBe("budget");
  return { id: criado.id, code: lido.code, top: lido.tipo_operacao };
}

/** Abre o detalhe e só devolve quando a moldura montou — e quando é o documento CERTO que está nela. */
async function abrirOrcamento(page: Page, doc: { id: string; code: string }) {
  await page.goto(`/vendas/budgets/${doc.id}`);
  await expect(page.getByTestId("central-vendas"), "a premissa: o documento abriu").toBeVisible();
  await expect(page.getByRole("heading", { name: new RegExp(doc.code) }),
    "e é o documento da fixture, não outro que por acaso estava na tela").toBeVisible();
}

test("E20 — declarar pela tela que NÃO há próxima operação cria versão, sobrevive à reabertura, e o documento nascido nela não oferece conversão nenhuma", async ({ page }) => {
  await login(page);

  /**
   * AS DUAS GÊMEAS. `topSimples` posta SEM a chave `destinos` — é o que o acervo é, e é o que faz as duas
   * nascerem com a política NÃO declarada. (O helper `cadastrarTop` do spec do portal manda `destinos: []`
   * sempre, ou seja, já nasce DECLARADA: usá-lo aqui apagaria justamente o estado de partida deste teste.)
   */
  const muda = await topSimples(page, "vendas.orcamento");
  const legada = await topSimples(page, "vendas.orcamento");

  // (a) PREMISSA NO SERVIDOR: as duas partem do MESMO estado — versão 1, zero destinos, NÃO declarada.
  for (const [rotulo, top] of [["a que vai declarar", muda], ["a que fica legada", legada]] as const) {
    const antes = await politicaNoServidor(page, top.id);
    expect(antes.versao, `${rotulo}: nasce na versão 1`).toBe(1);
    expect(antes.destinos, `${rotulo}: nasce sem nenhuma aresta`).toHaveLength(0);
    expect(antes.destinosConfigurados, `${rotulo}: e com a política NÃO declarada — é este o estado de partida`).toBe(false);
  }

  // (a) E A TELA DIZ ISSO COM TODAS AS LETRAS. Sem esta metade, o clique seguinte seria num botão cuja
  // razão de existir ninguém verificou — e um editor que mostrasse "política vazia" desde o começo
  // passaria no resto do teste inteiro sem nunca ter distinguido coisa nenhuma.
  await abrirTela(page);
  const forma = await abrirEdicao(page, muda.codigo);
  await forma.getByTestId("top-aba-destinos").click();
  await expect(forma.getByTestId("top-destinos"), "a aba de próximas operações montou").toBeVisible();
  await expect(forma.getByTestId("top-destinos-politica-nao-declarada"),
    "a premissa: a tela reconhece o estado NÃO DECLARADO").toBeVisible();
  await expect(forma.getByTestId("top-destinos-politica-vazia"),
    "e não confunde ausência de política com política vazia").toHaveCount(0);
  /**
   * E A ABA NÃO ESTÁ BLOQUEADA POR OUTRO MOTIVO. `top-destinos-estado-desconhecido` (o servidor não
   * informou o campo) e `top-destinos-ilegiveis` (a lista não veio legível) também escondem a lista e
   * também impedem a gravação do encadeamento: se qualquer um deles estivesse na tela, o "declarado"
   * medido adiante seria consequência de um bloqueio, e não da decisão do administrador.
   */
  await expect(forma.getByTestId("top-destinos-estado-desconhecido"), "o servidor informou o estado da política").toHaveCount(0);
  await expect(forma.getByTestId("top-destinos-ilegiveis"), "e devolveu a lista em formato legível").toHaveCount(0);
  // O ZERO QUE OS DOIS ESTADOS COMPARTILHAM: é por ele ser idêntico aqui e depois que a contagem de
  // linhas não pode ser o discriminador de nada neste teste.
  await expect(forma.getByTestId("top-destino-linha"), "não declarada e vazia têm a MESMA lista: nenhuma").toHaveCount(0);

  // (b) DECLARAR O VAZIO PELA TELA — pelo botão que só existe no estado não declarado.
  await forma.getByTestId("top-destinos-declarar").click();
  // ANTES DE SALVAR a tela já troca de frase: a decisão é do rascunho, e o administrador lê o que vai
  // gravar. Se só mudasse depois do salvar, ele confirmaria uma decisão sem nunca a ter visto escrita.
  await expect(forma.getByTestId("top-destinos-politica-vazia"),
    "declarar troca a frase da aba, e a troca acontece ANTES da gravação").toBeVisible();
  await expect(forma.getByTestId("top-destinos-politica-nao-declarada"),
    "e o aviso de 'ainda não declarou' sai de cena").toHaveCount(0);
  await forma.getByTestId("top-salvar").click();
  await expect(forma).toBeHidden();

  /**
   * (c) NO SERVIDOR: A VERSÃO SUBIU. Este é o ponto em que um defeito muito plausível morreria calado —
   * as arestas eram zero antes e continuam zero depois, então uma comparação de listas concluiria
   * "nada mudou" e descartaria a edição como no-op. A tela responderia "salvo" sobre uma política que
   * continuaria NÃO declarada, e a conversão continuaria caindo na cadeia antiga.
   */
  const depois = await politicaNoServidor(page, muda.id);
  expect(depois.versao, "declarar o vazio é CONTEÚDO: nasce a versão 2").toBe(2);
  expect(depois.destinosConfigurados, "e o estado da política virou DECLARADA").toBe(true);
  expect(depois.destinos, "declarada com a lista vazia — que é a decisão, não a falta dela").toHaveLength(0);

  /**
   * E O HISTÓRICO GUARDA AS DUAS ÉPOCAS SEPARADAS. É a única prova de que a versão 1 não foi reescrita:
   * se o booleano morasse no cadastro em vez de na versão, as duas linhas abaixo diriam `true` e o
   * histórico passaria a afirmar que a política sempre existiu.
   */
  const historico = await versoesNoServidor(page, muda.id);
  const v2 = historico.items.find((v) => v.versao === 2);
  const v1 = historico.items.find((v) => v.versao === 1);
  expect(v2?.destinosConfigurados, "a versão 2 registra a política declarada").toBe(true);
  expect(v1?.destinosConfigurados, "e a versão 1 continua registrando que nada tinha sido declarado").toBe(false);
  expect(v2?.destinos, "as duas versões têm zero arestas — só o booleano as distingue").toHaveLength(0);
  expect(v1?.destinos, "as duas versões têm zero arestas — só o booleano as distingue").toHaveLength(0);

  /**
   * (d) REABRIR É A PROVA DO LADO DA TELA. O que volta aqui veio do SERVIDOR, e é o que separa "a tela
   * gravou a decisão" de "a tela guardou a decisão no estado do React até alguém fechar a aba".
   */
  const reaberta = await abrirEdicao(page, muda.codigo);
  await reaberta.getByTestId("top-aba-destinos").click();
  await expect(reaberta.getByTestId("top-destinos-politica-vazia"),
    "reabrindo, a aba continua dizendo que a política foi declarada e é vazia").toBeVisible();
  await expect(reaberta.getByTestId("top-destinos-politica-nao-declarada"),
    "e nunca volta a oferecer o estado de quem não declarou").toHaveCount(0);
  await expect(reaberta.getByTestId("top-destinos-declarar"),
    "o botão de declarar não reaparece: declarar de novo o que já está declarado não é uma ação").toHaveCount(0);
  await expect(reaberta.getByTestId("top-destino-linha"), "e continua sem nenhum destino").toHaveCount(0);
  // DECLARAR O VAZIO NÃO TRANCA A ABA: a decisão é reversível pelo caminho normal, acrescentando um
  // destino. Sem esta asserção, "a política é vazia" seria indistinguível de "a seção ficou inerte".
  // `toBeEnabled` e não `toBeVisible`: uma regressão que trancasse a aba depois de declarar o vazio
  // deixaria o seletor VISÍVEL e desabilitado, e a asserção passaria — medindo o contrário do que o
  // comentário acima promete. "Editável" é sobre estar habilitado, então é isso que se afirma.
  await expect(reaberta.getByTestId("top-destino-escolha"),
    "a decisão continua editável: o seletor de destino segue habilitado").toBeEnabled();
  await reaberta.getByTestId("top-cancelar").click();

  /**
   * (e) e (f) OS DOIS DOCUMENTOS — criados AGORA, depois da declaração, para que o de `muda` cite a
   * versão 2. Criá-lo antes o congelaria na versão 1, que é a política NÃO declarada: o teste mediria o
   * documento errado e chegaria à conclusão oposta.
   */
  const doLegado = await criarOrcamento(page, legada.id);
  const doDeclarado = await criarOrcamento(page, muda.id);

  // PREMISSA DO SNAPSHOT: cada documento cita a TOP e a VERSÃO que este teste quis medir.
  expect(doDeclarado.top?.id, "o documento nasceu citando a TOP de política declarada").toBe(muda.id);
  expect(doDeclarado.top?.versao, "e citando a VERSÃO 2 — a que declara a política vazia").toBe(2);
  expect(doLegado.top?.versao, "o irmão legado cita a versão 1, a que nunca declarou nada").toBe(1);
  expect((await politicaNoServidor(page, legada.id)).destinosConfigurados,
    "e a TOP legada continua NÃO declarada: é só nisto que as duas diferem").toBe(false);

  /**
   * (f) O IRMÃO LEGADO PRIMEIRO — a premissa. "Não há conversão" é satisfeito de graça por um documento
   * cancelado, por falta de capacidade, por uma tela que não montou ou por um defeito que apagou a ação
   * de todo mundo. Um orçamento GÊMEO, criado pelo mesmo usuário no mesmo minuto, com a mesma lista
   * vazia de destinos, OFERECENDO a conversão é o que transforma a ausência medida adiante numa
   * afirmação sobre a POLÍTICA.
   */
  await abrirOrcamento(page, doLegado);
  const acaoLegada = page.getByTestId("acao-conversao");
  /**
   * O RÓTULO É A ASSINATURA DA PONTE. Pelo grafo, o botão nomearia a TOP de destino ("Converter em 8xxxx
   * — …") ou apenas convidaria ao diálogo ("Converter"); nomear a FAMÍLIA do destino é exatamente o que
   * só a cadeia de compatibilidade faz. A asserção portanto não diz só "há um botão": diz QUAL caminho
   * a tela escolheu, que é a pergunta deste teste.
   */
  await expect(acaoLegada, "premissa: política NÃO declarada segue oferecendo a conversão pela cadeia anterior")
    .toHaveText("Converter em Pedido de venda");
  await acaoLegada.click();
  const dialogoLegado = page.getByTestId("dialog-conversao");
  await expect(dialogoLegado).toBeVisible();
  await expect(dialogoLegado.getByTestId("select-tipo-operacao"),
    "e o diálogo é o da cadeia anterior: escolher a TOP do destino").toBeVisible();
  await expect(dialogoLegado.getByTestId("proximo-passo-unico"), "sem grafo, não há próximo passo único").toHaveCount(0);
  await expect(dialogoLegado.getByTestId("proximo-passo-opcao"), "nem leque de opções do grafo").toHaveCount(0);

  /**
   * (e) A CONCLUSÃO — e ela SÓ é uma afirmação depois que a pergunta foi respondida.
   *
   * ┌─ POR QUE ESPERAR A RESPOSTA, E NÃO SÓ A TELA ────────────────────────────────────────────────┐
   * │ A tela do documento monta ANTES de perguntar a política, e não por acaso: a consulta de       │
   * │ próximos passos é habilitada por `Boolean(k)`, e `k` só existe depois que a consulta do        │
   * │ DOCUMENTO resolveu. Enquanto a resposta não chega, `situacao` é `carregando`,                  │
   * │ `usaCadeiaDeCompatibilidade` devolve `false`, o leque está vazio e `ofereceConversao` é falso  │
   * │ — ou seja, `acao-conversao` está ausente POR CONSTRUÇÃO durante uma ida e volta HTTP inteira.  │
   * │                                                                                                │
   * │ Medir a ausência nessa janela passaria IGUAL com a funcionalidade regredida: o botão da ponte  │
   * │ apareceria um instante depois de o teste já ter seguido adiante. Não é instabilidade — é um    │
   * │ verde determinístico que não prova nada, que é REPROVAÇÃO neste repositório.                    │
   * │                                                                                                │
   * │ Esperar `/proximos-passos` e CONFERIR O CORPO resolve as duas coisas de uma vez: sincroniza o  │
   * │ instante da medição e prova, no SERVIDOR, que o estado sob teste é mesmo "declarada e vazia".  │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  const respostaPolitica = page.waitForResponse((r) =>
    r.url().includes(`/${doDeclarado.id}/proximos-passos`) && r.request().method() === "GET");
  await abrirOrcamento(page, doDeclarado);
  const politicaServida = await (await respostaPolitica).json() as { politicaConfigurada?: boolean; items?: unknown[] };
  expect(politicaServida.politicaConfigurada,
    "o servidor declara a política — sem isto, a ausência abaixo seria do estado legado").toBe(true);
  expect(politicaServida.items, "e a política declarada é vazia").toHaveLength(0);

  // AGORA a ausência é afirmação: a resposta chegou, a tela já reagiu a ela, e o que não existe
  // não existe porque a política assim decidiu.
  await expect(page.getByTestId("acao-conversao"),
    "política declarada vazia: nenhuma ação de conversão na moldura").toHaveCount(0);
  // O diálogo é filho de `Dialog open={...}` sem `forceMount`, então esta linha NÃO tem poder
  // discriminante próprio — o diálogo está fechado sempre. Fica como arame de tropeço contra
  // renomeação de `data-testid`, e é assim que ela deve ser lida, não como evidência separada.
  await expect(page.getByTestId("dialog-conversao"), "e nenhum diálogo de conversão aberto").toHaveCount(0);

  /**
   * E A TELA MONTOU INTEIRA. Note que esta asserção prova APENAS isso: "Imprimir" é renderizado
   * incondicionalmente, no mesmo fragmento de ações, sem depender da política. Ela descarta a página
   * quebrada; quem descarta a medição prematura é a espera pela resposta, lá em cima.
   */
  await expect(page.getByRole("button", { name: "Imprimir" }),
    "a tela montou: as demais ações do documento seguem lá").toBeVisible();
});
