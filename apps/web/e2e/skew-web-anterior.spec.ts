import { test, expect, type Page } from "@playwright/test";
import { login, uniq, pickRef, preencherClassificacaoFinanceira } from "./helpers";
import { criarEmpresaEConferirContador } from "./skew-contador-empresa";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * VERSION SKEW SENTIDO 2 — O WEB EM PRODUÇÃO CONTRA A API DESTA PR.
 *
 * Roda só em `playwright.skew-web-anterior.config.ts`: o navegador executa o bundle EXATO do commit BASE
 * DESTA PR — seja ele qual for — e o servidor é a API deste HEAD. Não há mock em nenhuma das duas pontas.
 *
 * A base NÃO é uma fase nomeada. Ela é o `pull_request.base.sha`, e por isso a identidade é provada por SHA
 * (último caso deste arquivo), não por comportamento HTTP: desde que a 05B mesclou, os dois lados já são
 * canônicos, e um teste que tentasse distinguir base de HEAD pelo contrato passaria contra os DOIS
 * servidores — certificando o cenário errado com a aparência de rigor.
 *
 * POR QUE ESTE SENTIDO É O QUE IMPORTA AGORA
 *
 * Na 05A quem virava era o cliente, então o risco era o web à frente da API. Na 05B quem vira é o SERVIDOR:
 * se a API subir primeiro — e ela pode, porque Railway e Vercel não trocam de versão juntos —, todo mundo
 * que está com a aba aberta continua rodando o bundle anterior contra uma API que já removeu a borda
 * legada. Se aquele cliente dependesse de um cabeçalho, de um apelido de resposta, da chave de recurso
 * antiga ou do formato administrativo achatado, o produto quebraria em produção sem nenhum erro de
 * aplicação para investigar: o que falha é o fio.
 *
 * O teste não tenta adivinhar de que o cliente depende. Ele USA o cliente: entra, carrega o contexto,
 * troca de empresa, lista, filtra e cadastra — e falha se qualquer requisição morrer no navegador.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

const sessao = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string; empresaId?: string | null });

/**
 * Vigia do navegador. Falha de CORS não vira exceção de JavaScript nem resposta HTTP: o Chromium aborta a
 * requisição ANTES de ela existir para a aplicação (`net::ERR_FAILED`) e escreve no console. Sem este
 * coletor, a tela renderiza vazia e o teste passa — que é exatamente o modo de falha desta janela.
 */
function vigiar(page: Page) {
  const falhas: string[] = []; const respostas: { url: string; status: number }[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.url().includes("/api/")) respostas.push({ url: r.url(), status: r.status() }); });
  return {
    respostas,
    semBloqueio: () => expect(falhas, "nenhuma requisição do cliente em produção pode morrer no navegador").toEqual([]),
    /** Nenhuma resposta de erro de contrato: é assim que "a API removeu algo que o cliente usa" apareceria. */
    semErroDeContrato: () => {
      const ruins = respostas.filter((r) => r.status === 404 || r.status === 422 || r.status >= 500);
      expect(ruins, `o cliente em produção não pode receber erro de contrato da API nova: ${JSON.stringify(ruins)}`).toEqual([]);
    }
  };
}

test.describe.configure({ mode: "serial" });

test("CONTRATO · o HEAD mantém o canônico que o web da base usa, e RECUSA o idioma anterior", async ({ page, request }) => {
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId) };

  // CONTRATO, não identidade. Este caso prova o CONTRATO NEGATIVO — que o idioma antigo é RECUSADO, e
  // recusado com o código certo (404 na chave de recurso, 422 no cabeçalho), em vez de ignorado em silêncio.
  // Ele NÃO distingue este servidor do da base: desde a 05B a base também recusa, e um teste que tentasse
  // separar os dois por comportamento HTTP passaria contra os DOIS. Quem prova identidade é o SHA, no caso
  // IDENTIDADE deste arquivo. As duas provas são necessárias e medem coisas diferentes.
  const recursoAnterior = await request.get(`${API}/api/resources/farms?pageSize=1`, { headers: auth });
  expect(recursoAnterior.status(), "a API desta PR não resolve mais a chave de recurso anterior").toBe(404);

  const cabecalhoAnterior = await request.get(`${API}/api/resources/warehouses?pageSize=1`, { headers: { ...auth, "x-farm-id": String(s.orgId) } });
  expect(cabecalhoAnterior.status(), "o cabeçalho anterior é recusado, não ignorado").toBe(422);

  // E o cliente é o de produção: ele fala canônico, que é o que o torna compatível com a API acima.
  const ctx = await (await request.get(`${API}/api/auth/context`, { headers: auth })).json();
  expect(ctx["empresas"], "o contexto canônico continua sendo entregue ao cliente anterior").toBeDefined();
  expect(ctx["farms"], "a API nova não devolve mais o apelido — e o cliente anterior não precisa dele").toBeUndefined();
});

test("entrar, carregar contexto e trocar de empresa — o cliente em produção não quebra", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const seletor = page.getByLabel("Empresa ativa");
  await expect(seletor.locator("option")).not.toHaveCount(1);   // "Todas as empresas" + as empresas reais
  await seletor.selectOption({ index: 1 });
  await expect(seletor).not.toHaveValue("");
  const s = await sessao(page);
  expect(s.empresaId, "a empresa escolhida ficou na sessão do cliente anterior").toBeTruthy();
  v.semBloqueio();
  v.semErroDeContrato();
});

test("listar cadastros e filtrar por empresa — os caminhos que o usuário usa de verdade", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await page.getByLabel("Empresa ativa").selectOption("");
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  const antes = await page.getByTestId("b1-row").count();

  await page.goto("/cadastros/empresas");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();

  // O recorte por empresa do cliente anterior continua chegando ao servidor novo.
  await page.goto("/cadastros/warehouses");
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
  await page.getByLabel("Empresa ativa").selectOption({ index: 1 });
  await expect.poll(() => page.getByTestId("b1-row").count(), { message: "a empresa selecionada recorta a listagem" }).toBeLessThan(antes);
  v.semBloqueio();
  v.semErroDeContrato();
});

test("cadastrar pelo formulário do cliente anterior: a API nova aceita o corpo que ele envia", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const desc = uniq("Armazém Cliente Anterior");
  await page.goto("/cadastros/warehouses/new");
  await expect(page.getByTestId("b1-form")).toBeVisible();

  const campoEmpresa = page.getByTestId("b1-form").locator("label", { hasText: /^Empresa/ }).first().locator("..");
  await campoEmpresa.locator("button[type=button]").first().click();
  const opcoes = page.locator(".cmd-panel [role=option]");
  await expect(opcoes.first(), "o seletor de referência listou as empresas").toBeVisible();
  await opcoes.first().click();

  await page.getByLabel(/^Sigla/).first().fill(`AN${Date.now().toString(36).slice(-3).toUpperCase()}`);
  await page.getByLabel(/^Descrição/).first().fill(desc);
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await page.waitForURL(/\/cadastros\/warehouses$/, { timeout: 20_000 });

  await page.getByLabel("Pesquisar", { exact: true }).click();
  await page.getByPlaceholder(/^Pesquisar por/).fill(desc);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("b1-row").filter({ hasText: desc }).first(), "o cadastro do cliente anterior foi gravado pela API nova").toBeVisible();
  v.semBloqueio();
  v.semErroDeContrato();
});

test("a rota de cadastro ANTERIOR continua levando o usuário à tela certa (favorito salvo)", async ({ page }) => {
  // Navegação não é protocolo: o redirect do web sobrevive até PRE-BASE2-05C, e a chave de recurso que a
  // API removeu não tem nada a ver com ele. Provado aqui para que a remoção da chave não leve o redirect
  // junto por engano — o usuário que guardou o link antigo continua chegando à tela.
  await login(page);
  await page.goto("/cadastros/farms");
  await expect(page).toHaveURL(/\/cadastros\/empresas/);
  await expect(page.getByTestId("b1-row").first()).toBeVisible();
});

/**
 * O CONTADOR DE EMPRESA, NO SENTIDO 2 (API deste HEAD) — a outra metade da prova.
 *
 * O banco é o MESMO do sentido 1 e não há reset entre as duas execuções. Então a Empresa criada ali já está
 * gravada quando esta roda, e a exigência "maior que todos os códigos existentes, sem repetir nenhum" passa
 * a atravessar os dois binários. É essa travessia que a troca de contador quebraria — e quem troca o
 * contador é a PRE-BASE2-05C-2, não a 05C-1: com `entity='farm'` e `entity='empresa'` como duas linhas de
 * `erp.code_sequences`, os dois lados emitiriam o mesmo próximo número e o segundo cadastro morreria no
 * `unique (organization_id, code)`.
 *
 * Nenhum valor é fixado (`N === 3`): o banco do e2e é semeado e reutilizado, e um número esperado viraria
 * falha por acumulação. O que se cobra é a RELAÇÃO, que é o que o contrato garante.
 */
test("criar Empresa pela API DESTE HEAD, no mesmo banco do sentido 1, também aloca código novo e único", async ({ page, request }) => {
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId) };
  const codigo = await criarEmpresaEConferirContador(request, API, auth, "SKEW-HEAD");
  console.log(`[skew] sentido 2 (API deste HEAD) alocou o código de Empresa ${codigo}`);
});

/**
 * A IDENTIDADE DO BINÁRIO É O SHA EXATO DA BASE — não "um commit qualquer diferente do HEAD".
 *
 * A versão anterior deste caso só exigia `anterior !== HEAD`. Isso prova que os dois lados não são o mesmo
 * commit; NÃO prova qual é o outro lado. Um commit X qualquer passaria — inclusive o commit errado que a
 * resolução por ponta de branch podia escolher, que é justamente o defeito.
 *
 * A expectativa é LIDA de `.api-anterior.base`, gravado por quem montou a árvore: uma resolução por
 * execução, sem rede e sem recálculo. Recalcular aqui reintroduziria o problema pelo outro lado — num
 * evento de `push` a resolução cai na ponta de `origin/main`, e duas leituras da ponta podem divergir
 * dentro do mesmo job. Quando o CI injeta `SKEW_BASE_COMMIT` (`pull_request.base.sha`, o SHA da base
 * CAPTURADO PARA ESTA EXECUÇÃO), a igualdade é cobrada também contra ele: é a PR declarando qual é a sua
 * base. O que se exige dele não é ser eterno — é ficar PINADO durante o run.
 *
 * O outro lado da comparação é o CHECKOUT, não "o head da PR": num evento `pull_request` o runner posiciona
 * a árvore num merge ref sintético, e exigir que ele fosse o head da PR reprovaria um CI correto.
 */
test("IDENTIDADE · o bundle do navegador é exatamente o base SHA desta execução", async () => {
  const raiz = path.resolve(__dirname, "../../..");
  const rev = (cwd: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
  // Lido do ARQUIVO, não recalculado nem importado do harness: o arquivo é o contrato entre quem monta a
  // árvore e quem a confere, e ler um arquivo não tem como divergir de si mesmo no meio do job.
  const esperada = fs.readFileSync(path.join(raiz, ".api-anterior.base"), "utf8").trim();
  expect(esperada, "`.api-anterior.base` é gravado por scripts/api-anterior.mjs ao montar a árvore").toMatch(/^[0-9a-f]{40}$/);

  const doEvento = (process.env.SKEW_BASE_COMMIT ?? "").trim();
  if (doEvento) expect(esperada, "a base usada é a que a PR declarou no evento").toBe(doEvento);

  const arvore = rev(path.join(raiz, ".api-anterior"));
  expect(arvore, "a árvore precisa estar na base EXATA, não num commit qualquer").toBe(esperada);
  expect(arvore, "e a base não pode ser o commit do checkout — seria comparar o commit com ele mesmo").not.toBe(rev(raiz));
});
/**
 * TOP-CONFIG-04A · O WEB DA BASE CONVIVE COM A TOP DO FORMATO 2 SEM APAGAR A EXECUÇÃO.
 *
 * A fase 1 da implantação põe a API nova no ar com o gate DESLIGADO, e todo navegador aberto continua com o
 * bundle anterior. Dois riscos: (a) o cliente anterior deixar de editar TOPs — as capacidades que ele lê não
 * podem mudar; (b) o cliente anterior, ao renomear uma TOP do formato 2, apagar o bloco `execucao` em
 * silêncio. O teste usa o cliente de verdade para renomear, e o SERVIDOR é o árbitro do que ficou gravado.
 * Vale nos dois mundos: um web da base anterior à fatia omite a configuração (não sabe lê-la) e o HEAD
 * preserva; um web da base posterior a reenvia igual.
 */
test("TOP-CONFIG-04A · o web da base renomeia uma TOP do formato 2 e a configuração inteira sobrevive", async ({ page, request }) => {
  const v = vigiar(page);
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId) };

  const cap = await (await request.get(`${API}/api/admin/tipos-operacao/capabilities`, { headers: auth })).json() as
    { contractVersion: number; configuracao: { versaoSchema: number }; execucao?: { runtimeHabilitado: boolean } };
  expect(cap.contractVersion, "o contrato que o web da base compara não mudou").toBe(1);
  expect(cap.configuracao.versaoSchema, "nem o formato que ele compara — mudar travaria a edição de toda TOP").toBe(1);
  expect(cap.execucao?.runtimeHabilitado, "a fase 1: a API nova no ar com o gate desligado").toBe(false);

  // A TOP do formato 2, criada pelo HEAD — com a seção de estoque declarando saída, e a execução no legado.
  const codigo = `S2${Date.now().toString(36).toUpperCase()}`;
  const configuracao = {
    versaoSchema: 2,
    geral: { confirmacao: "manual", exigeParceiro: false, exigeCentroResultado: false, exigeObservacao: false, alteracaoAposConfirmacao: "bloqueada", documentoSemItens: "proibido" },
    estoque: { atualizacao: "saida", momento: "confirmacao", exigeArmazem: false, saldoNegativo: "bloquear" },
    financeiro: { atualizacao: "nenhuma", modo: "incluir", momento: "confirmacao", exigeFormaPagamento: false, exigeVencimento: false, exigeCentroResultado: false },
    fiscal: { habilitado: false, exigeDocumentoFiscal: false, exigeNaturezaOperacao: false, exigeRegraTributaria: false, calculoTributario: "nao_aplicar" },
    aprovacao: { politica: "nenhuma", valorMinimo: null, momento: "antes_da_confirmacao" },
    execucao: { estoque: "legado", financeiro: "legado" }
  };
  const criada = await request.post(`${API}/api/admin/tipos-operacao`, { headers: auth, data: { codigo, codigoBase: "vendas.venda", nome: `Formato 2 ${codigo}`, configuracao } });
  expect(criada.status(), await criada.text()).toBe(201);
  const id = (await criada.json() as { id: string }).id;

  // Com o gate desligado, ATIVAR é recusado: a fase 1 não põe execução configurada em circulação. A revisão
  // vem do servidor e o CÓDIGO é conferido: um 409 de concorrência (revisão velha) também seria 409, e o
  // teste passaria sem nunca provar o gate.
  const lida = await (await request.get(`${API}/api/admin/tipos-operacao/${id}`, { headers: auth })).json() as { revisao: number };
  const ativar = await request.put(`${API}/api/admin/tipos-operacao/${id}`, { headers: auth,
    data: { configuracao: { ...configuracao, execucao: { estoque: "configurada", financeiro: "legado" } }, revisao: lida.revisao } });
  expect(ativar.status(), "o HEAD com o gate desligado recusa a ativação").toBe(409);
  const recusa = (await ativar.json() as { error: { code: string; details?: { efeitos?: string[] } } }).error;
  expect(recusa.code, "a recusa é a do gate, não a de concorrência").toBe("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL");
  expect(recusa.details?.efeitos).toEqual(["estoque"]);

  // O CLIENTE DA BASE renomeia pela tela.
  const nome = uniq("Renomeada pelo web da base");
  await page.goto("/configuracoes?tab=operacoes&sub=tipos-operacao");
  await page.getByLabel("Buscar tipo de operação").fill(codigo);
  const linha = page.getByRole("row").filter({ hasText: codigo });
  await expect(linha).toHaveCount(1);
  await linha.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  await forma.getByTestId("top-campo-nome").fill(nome);
  const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/api/admin/tipos-operacao/${id}`));
  await forma.getByTestId("top-salvar").click();
  expect((await resposta).status(), "o HEAD aceita a gravação do cliente da base").toBe(200);

  // O SERVIDOR é o árbitro: nome novo, versão nova, e a configuração do formato 2 INTEIRA preservada.
  const d = await (await request.get(`${API}/api/admin/tipos-operacao/${id}`, { headers: auth })).json() as
    { nome: string; versao: number; configuracaoSchema: number; configuracao: { valor: typeof configuracao } };
  expect([d.nome, d.versao, d.configuracaoSchema]).toEqual([nome, 2, 2]);
  expect(d.configuracao.valor.execucao, "o bloco de execução não foi apagado").toEqual({ estoque: "legado", financeiro: "legado" });
  expect(d.configuracao.valor.estoque.atualizacao, "nem a seção que ele não sabia ler").toBe("saida");
  v.semBloqueio();
});

/**
 * VENDAS-A1 · A1-K2 — O WEB DA BASE LANÇA UMA VENDA CONTRA A API DESTE HEAD.
 *
 * O cliente anterior não conhece `categoria_financeira_id`/`centro_custo_id`: o corpo dele não os leva. A
 * API deste HEAD tem de aceitar esse corpo (201, a mesma compatibilidade do `tipo_operacao_id`), gravar o
 * documento SEM classificação — nulos, nunca um par inventado — e, na confirmação, recuar EXATAMENTE como
 * antes: a "primeira por código", registrada na auditoria como `padrão legado`. Sem este caso, a janela
 * em que a API sobe antes do web poderia recusar lançamentos de todo navegador aberto.
 *
 * Vale nos dois mundos: um web da base anterior à fatia não envia os campos; um web da base posterior só
 * os envia com a capacidade declarada — e aí o caso seria o do W1, não este. Por isso o POST é observado
 * no fio e o ramo é escolhido pelo que o cliente da base DE FATO enviou.
 */
test("VENDAS-A1 · A1-K2 — o web da base cria venda sem classificação: 201 com nulos, e a confirmação usa o padrão legado", async ({ page, request }) => {
  const v = vigiar(page);
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId), "content-type": "application/json" };

  // Uma TOP de venda criada pelo HEAD, para o lançador da base ter o que escolher.
  const codigo = `SK2${Date.now().toString(36).toUpperCase()}`;
  const criada = await request.post(`${API}/api/admin/tipos-operacao`, { headers: auth, data: { codigo, codigoBase: "vendas.venda", nome: `Skew A1 ${codigo}` } });
  expect(criada.status(), await criada.text()).toBe(201);
  const topId = (await criada.json() as { id: string }).id;

  // O CLIENTE DA BASE lança pela própria tela: lançador → TOP → cliente → item → Salvar.
  await page.goto("/vendas/sales/new");
  await expect(page.getByTestId("top-lancador")).toBeVisible();
  await page.locator(`[data-testid="top-opcao"][data-top-id="${topId}"]`).click();
  await page.getByTestId("top-continuar").click();
  await expect(page.getByTestId("top-contexto")).toBeVisible();
  await pickRef(page, "Cliente", "DEMO");
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await page.getByTestId("central-vendas-linha").first().getByTestId("central-vendas-produto").click();
  await page.getByTestId("central-vendas-pesquisa").getByRole("option").first().click();
  // Valor POSITIVO de propósito: o recuo só existe quando há título, e título de valor zero é recusado.
  await page.getByTestId("central-vendas-linha").first().getByLabel("Valor unitário").fill("10");

  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/sales\/sales$/.test(new URL(r.url()).pathname));
  const salvar = page.getByRole("button", { name: "Salvar" });
  const baseMostraCampos = await page.getByTestId("central-vendas").locator("label", { hasText: "Categoria financeira" }).count() > 0;
  if (baseMostraCampos) {
    // Mundo em que a base já é posterior à A1: o web dela preenche como o deste HEAD (W1). O caso do cliente
    // ANTERIOR à fatia deixou de existir em produção, e fingi-lo aqui certificaria o que não roda.
    await preencherClassificacaoFinanceira(page);
  }
  await salvar.click();
  const r = await resposta;
  expect(r.status(), "a API deste HEAD aceita o corpo do cliente da base").toBe(201);
  const enviado = r.request().postDataJSON() as Record<string, unknown>;
  const { id } = await r.json() as { id: string };
  const lido = await (await request.get(`${API}/api/sales/sales/${id}`, { headers: auth })).json() as Record<string, unknown>;
  if (baseMostraCampos) {
    expect(lido["categoria_financeira_id"], "o web da base (pós-A1) gravou a classificação que enviou").toBe(enviado["categoria_financeira_id"]);
    v.semBloqueio(); v.semErroDeContrato();
    return;
  }

  // MUNDO LEGADO: o corpo NÃO tinha o par — e o documento nasceu sem ele, nulos, nunca um par inventado.
  expect(Object.keys(enviado).filter((k) => k === "categoria_financeira_id" || k === "centro_custo_id"), "premissa: o cliente da base não conhece o par").toEqual([]);
  expect([lido["categoria_financeira_id"], lido["centro_custo_id"]], "sem classificação: nulos").toEqual([null, null]);

  // A CONFIRMAÇÃO recua como antes, e a auditoria diz de onde veio a classificação usada no título.
  const conf = await request.post(`${API}/api/sales/sales/${id}/confirm`, { headers: auth, data: {} });
  expect(conf.status(), await conf.text()).toBe(200);
  const titulos = (await conf.json() as { title_ids: string[] }).title_ids;
  expect(titulos.length, "premissa: o recuo só se aplica quando HÁ título — e esta venda gerou").toBeGreaterThan(0);
  const trilha = await (await request.get(`${API}/api/admin/audit?entity=sales_documents&entity_id=${id}`, { headers: auth })).json() as
    { items: { action: string; metadata: { classificacaoFinanceira?: { origem?: string; categoriaFinanceiraId?: string; centroCustoId?: string } } | null }[] };
  const confirmacao = trilha.items.filter((i) => i.action === "confirm");
  expect(confirmacao, "uma confirmação na trilha").toHaveLength(1);
  expect(confirmacao[0]!.metadata?.classificacaoFinanceira?.origem, "o título usou o padrão legado, e a trilha diz isso").toBe("padrão legado");
  expect(confirmacao[0]!.metadata?.classificacaoFinanceira?.categoriaFinanceiraId, "com a categoria efetivamente usada").toMatch(/^[0-9a-f-]{36}$/);
  v.semBloqueio(); v.semErroDeContrato();
});

/**
 * VENDAS-A5-1 · A5-K2 — O WEB DA BASE CONFIRMA UMA VENDA CONTRA A API DESTE HEAD.
 *
 * A fatia acrescenta UMA rota de leitura (`previa-confirmacao`) e troca textos do web; a confirmação continua
 * a mesma porta, com o mesmo corpo. Se a API subir antes do web, todo navegador aberto roda o diálogo da base —
 * que não conhece a prévia — contra este servidor. Duas coisas se provam aqui: (a) a rota nova é SÓ leitura —
 * perguntar a ela não muda o documento nem a trilha, então a presença dela no servidor não altera nada para quem
 * não a usa; (b) o cliente da base confirma pela própria tela, com 200 e a venda confirmada, sem erro de contrato.
 *
 * Vale nos dois mundos: um web da base anterior à fatia não pergunta à prévia; um posterior pergunta e recebe 200
 * deste HEAD — em nenhum dos dois há 404/422/5xx no fio (`semErroDeContrato`).
 */
test("VENDAS-A5-1 · A5-K2 — o web da base confirma uma venda contra a API deste HEAD: nada quebra, e a rota nova é só leitura", async ({ page, request }) => {
  const v = vigiar(page);
  await login(page);
  const s = await sessao(page);
  const auth = { authorization: `Bearer ${s.token}`, "x-org-id": String(s.orgId), "content-type": "application/json" };
  const um = async (p: string) => {
    const r = await request.get(`${API}${p}`, { headers: auth });
    expect(r.status(), p).toBe(200);
    const id = (await r.json() as { items: { id: string }[] }).items?.[0]?.id;
    expect(id, `o seed precisa ter registro em ${p}`).toBeTruthy();
    return id!;
  };
  const ctx = await (await request.get(`${API}/api/auth/context`, { headers: auth })).json() as { empresas: { id: string }[] };
  const criada = await request.post(`${API}/api/sales/sales`, { headers: auth, data: {
    empresa_id: s.empresaId ?? ctx.empresas[0]!.id, document_date: "2026-09-01", client_id: await um("/api/resources/people?is_client=true&pageSize=1"),
    items: [{ product_id: await um("/api/resources/products?pageSize=1"), warehouse_id: null, quantity: "1", unit_price: "10.00" }] } });
  expect(criada.status(), await criada.text()).toBe(201);
  const id = (await criada.json() as { id: string }).id;

  // (a) SÓ LEITURA: documento e trilha idênticos antes e depois de perguntar à prévia.
  const documento = async () => { const d = await (await request.get(`${API}/api/sales/sales/${id}`, { headers: auth })).json() as Record<string, unknown>; return { status: d["status"], updated_at: d["updated_at"], version: d["version"] }; };
  const trilha = async () => (await (await request.get(`${API}/api/admin/audit?entity=sales_documents&entity_id=${id}`, { headers: auth })).json() as { items: { action: string }[] }).items;
  const antes = { doc: await documento(), trilha: await trilha() };
  const previa = await request.get(`${API}/api/sales/sales/${id}/previa-confirmacao`, { headers: auth });
  expect(previa.status(), "a API deste HEAD serve a prévia").toBe(200);
  const corpo = await previa.json() as { contractVersion: number; podeConfirmar: boolean };
  expect([corpo.contractVersion, corpo.podeConfirmar], "premissa: a prévia diz que esta venda confirma").toEqual([1, true]);
  expect(await documento(), "perguntar à prévia não mexeu no documento").toEqual(antes.doc);
  expect(await trilha(), "nem na trilha").toEqual(antes.trilha);
  expect(antes.doc.status, "premissa: a venda está aberta").toBe("open");

  // (b) O CLIENTE DA BASE confirma pela própria tela.
  await page.goto(`/vendas/sales/${id}`);
  const central = page.getByTestId("central-vendas");
  await expect(central).toBeVisible();
  await central.getByTestId("central-vendas-acoes").getByRole("button", { name: "Confirmar venda" }).click();
  const dlg = page.getByTestId("confirm-dialog");
  await expect(dlg.getByRole("heading", { name: "Confirmar venda" })).toBeVisible();
  await expect(dlg.getByTestId("confirm-dialog-confirm"), "o diálogo da base oferece confirmar").toBeEnabled();
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/sales/sales/${id}/confirm`);
  await dlg.getByTestId("confirm-dialog-confirm").click();
  const r = await resposta;
  expect(r.status(), "a API deste HEAD confirma o pedido do cliente da base").toBe(200);
  expect(r.request().headers()["idempotency-key"], "com a chave de idempotência de sempre").toBeTruthy();
  const depois = await (await request.get(`${API}/api/sales/sales/${id}`, { headers: auth })).json() as { status: string; titles: unknown[] };
  expect(depois.status).toBe("confirmed");
  expect(depois.titles.length, "e gerou as contas a receber, como antes").toBeGreaterThan(0);
  // A premissa da trilha: a mesma leitura ENXERGA uma escrita — a confirmação aparece nela.
  expect((await trilha()).filter((i) => i.action === "confirm"), "a confirmação ficou na trilha").toHaveLength(1);
  v.semBloqueio(); v.semErroDeContrato();
});

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * CADASTROS-ESTRUTURA (decisão 250) · WEB ANTERIOR × API NOVA — os casos 1 e 2 da janela de deploy
 *
 * (1) o formulário de produto da base manda category_id e kind_id: a API nova os aceita como campos
 *     LEGADOS opcionais (`camposLegadosDeEscrita`) e grava o que vier → 201;
 * (2) o formulário de grupo da base manda só nome: a API nova exige código → 422 DECLARADO, nada gravado.
 * O corpo é o que o web da base envia (a base nunca terá os campos novos — comportamento fixo, sem decisão
 * medida).
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */
async function cabecalhosDaSessao(page: Page) {
  const s = await sessao(page);
  return { Authorization: `Bearer ${s.token}`, "X-Org-Id": s.orgId!, "Content-Type": "application/json" };
}

test("CADASTROS-ESTRUTURA · CE-K1 — corpo ANTIGO de produto (com category_id e kind_id): 201 na API nova, gravado como veio", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const primeiro = async (p: string) => {
    const r = await page.request.get(`${API}${p}`, { headers: cab });
    expect(r.status(), p).toBe(200);
    return (await r.json() as { items: { id: string }[] }).items?.[0]?.id;
  };
  const grupo = await primeiro("/api/resources/product_groups?kind=analytic&pageSize=1");
  expect(grupo, "premissa: há grupo analítico").toBeTruthy();
  const unidade = await primeiro("/api/resources/measurement_units?symbol=un&pageSize=1");
  expect(unidade, "premissa: há unidade").toBeTruthy();
  // os lookups de Categoria/Classe que a web anterior usa continuam na API nova
  const cat = await page.request.post(`${API}/api/resources/product_categories`, { headers: cab, data: { group_id: grupo, name: uniq("CE-K1 Categoria"), is_active: true } });
  expect(cat.status(), await cat.text()).toBe(201);
  const categoria = (await cat.json() as { id: string }).id;
  const cls = await page.request.post(`${API}/api/resources/product_kinds`, { headers: cab, data: { category_id: categoria, name: uniq("CE-K1 Classe"), is_active: true } });
  expect(cls.status(), await cls.text()).toBe(201);
  const classe = (await cls.json() as { id: string }).id;

  const r = await page.request.post(`${API}/api/resources/products`, { headers: cab, data: {
    description: uniq("CE-K1 produto web anterior"), measurement_id: unidade, group_id: grupo, category_id: categoria, kind_id: classe, control_stock: false, is_active: true } });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json() as { id: string }).id;
  expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  // Lido do BANCO: a API nova não devolve os campos legados na leitura (saíram do registry), só os grava.
  const banco = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
  const gravado = execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", `select category_id || '|' || kind_id from erp.products where id = '${id}'`], { encoding: "utf8" }).trim();
  expect(gravado, "a API grava o que veio").toBe(`${categoria}|${classe}`);
});

test("CADASTROS-ESTRUTURA · CE-K2 — grupo pelo corpo ANTIGO (sem código): 422 declarado no código, nada gravado", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const nome = uniq("CE-K2 grupo web anterior");
  const r = await page.request.post(`${API}/api/resources/product_groups`, { headers: cab, data: { name: nome, is_active: true } });
  expect(r.status(), await r.text()).toBe(422);
  const erro = ((await r.json()) as { error: { details?: { path: string | string[] }[] } }).error;
  expect(erro.details?.map((d) => String(d.path)), "a recusa aponta o Código").toContain("code");
  const lista = await (await page.request.get(`${API}/api/resources/product_groups?search=${encodeURIComponent(nome)}`, { headers: cab })).json() as { items: unknown[] };
  expect(lista.items, "nada gravado").toHaveLength(0);
});

test("CADASTROS FASE 4 · PA-K2 — formulário ANTERIOR de Pessoas contra a API nova: grava; PUT sem grades não mexe nelas; sem tipo → 422; documento inválido 422 e duplicado 409", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const banco = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
  const sql = (c: string) => execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();
  // corpo do formulário anterior: só colunas de people, nenhuma chave da ficha
  const semTipo = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("PA-K2 sem tipo"), person_type: "legal", is_provider: false, is_client: false, is_employee: false, is_proprietary: false, is_transporter: false } });
  expect(semTipo.status(), await semTipo.text()).toBe(422);
  expect((await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("PA-K2 doc"), document: "529.982.247-00", person_type: "natural", is_client: true } })).status(), "CPF com DV errado").toBe(422);
  const r = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("PA-K2 web anterior"), document: "12.ABC.345/01DE-35", person_type: "legal", is_client: true, is_provider: false, is_employee: false, is_proprietary: false, is_transporter: false, is_active: true } });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json() as { id: string }).id;
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const org = sql(`select organization_id from erp.people where id = '${id}'`);
  sql(`insert into erp.parceiro_enderecos (organization_id, person_id, tipo, logradouro) values ('${org}', '${id}', 'entrega', 'PA-K2 rua')`);
  const put = await page.request.put(`${API}/api/resources/people/${id}`, { headers: cab, data: { phone: "63 99999-0000", is_client: true } });
  expect(put.status(), await put.text()).toBe(200);
  expect(sql(`select count(*) from erp.parceiro_enderecos where person_id = '${id}' and deleted_at is null`), "grade intacta").toBe("1");
  const dup = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("PA-K2 dup"), document: "12ABC34501DE35", person_type: "legal", is_client: true } });
  expect(dup.status(), await dup.text()).toBe(409);
  // o dado de teste fica excluído logicamente (nunca apagado)
  sql(`update erp.people set deleted_at = now() where id = '${id}'`);
});

test("CADASTROS FASE 5 · RH-K2 — web ANTERIOR contra a API nova: nada muda (funcionário pelo cadastro de Pessoas grava; folha e Funções como antes)", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  // "Novo funcionário" da web anterior: formulário de Pessoas com is_employee
  const r = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("RH-K2 funcionario"), person_type: "natural", is_employee: true, is_client: false, is_provider: false, is_proprietary: false, is_transporter: false } });
  expect(r.status(), await r.text()).toBe(201);
  // Funções: o corpo anterior (sem CBO) grava
  const f = await page.request.post(`${API}/api/resources/job_functions`, { headers: cab, data: { name: uniq("RH-K2 funcao"), base_salary: "1000", monthly_hours: 220, hour_value: "5", description: "RH-K2", is_active: true } });
  expect(f.status(), await f.text()).toBe(201);
  // o dado de teste fica excluído logicamente (nunca apagado)
  const id = (await r.json() as { id: string }).id;
  const banco = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
  execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", `update erp.people set deleted_at = now() where id = '${id}'`], { encoding: "utf8" });
});

test("CADASTROS FASE 6 · PR-K2 — formulário ANTERIOR de Produto contra a API nova: has_lot=true grava 'lote', false grava 'nenhum'; 2ª unidade aceita como legado", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const banco = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
  const sql = (c: string) => execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();
  const grupo = sql("select id from erp.product_groups where deleted_at is null and kind = 'analytic' order by code limit 1");
  const un = sql("select id from erp.measurement_units where upper(symbol) = 'UN' order by organization_id nulls last limit 1");
  const kg = sql("select id from erp.measurement_units where upper(symbol) = 'KG' order by organization_id nulls last limit 1");
  const natureza = sql("select id from erp.financial_categories where deleted_at is null and kind = 'analytic' and nature = 'expense' order by code limit 1");
  // corpo do formulário anterior: has_lot e a 2ª unidade, nenhuma chave da ficha
  const r = await page.request.post(`${API}/api/resources/products`, { headers: cab, data: { description: uniq("PR-K2 web anterior"), group_id: grupo, measurement_id: un, financial_category_id: natureza, has_lot: true, second_measurement_id: kg, factor_type: "multiply", factor: "25", control_stock: true, is_active: true } });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json() as { id: string; has_lot: boolean }).id;
  expect(sql(`select controle_lote || '/' || has_lot from erp.products where id = '${id}'`)).toBe("lote/true");
  const put = await page.request.put(`${API}/api/resources/products/${id}`, { headers: cab, data: { has_lot: false } });
  expect(put.status(), await put.text()).toBe(200);
  expect(sql(`select controle_lote || '/' || has_lot from erp.products where id = '${id}'`)).toBe("nenhum/false");
  sql(`update erp.products set deleted_at = now() where id = '${id}'`);
});
