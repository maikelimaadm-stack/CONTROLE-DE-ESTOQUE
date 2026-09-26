import { test, expect, type Page } from "@playwright/test";
import { login, uniq, pickRef, preencherClassificacaoFinanceira } from "./helpers";
import { baseTemFatiaDeCadastro, cpfValido } from "./skew-fichas-cadastro";
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
 * OS RÓTULOS DA CLASSIFICAÇÃO NO FORMULÁRIO DE VENDA DO WEB DA BASE — lidos do COMMIT da base (`.api-anterior.base`,
 * provado pelo caso IDENTIDADE), nunca da worktree nem da tela. `null` = o web da base não tem os campos (anterior
 * à VENDAS-A1). A assinatura é o `Field` obrigatório cujo filho é o `RefSelect` do recurso: zero ou um por recurso;
 * qualquer outro número, ou natureza sem centro, é detector quebrado e REPROVA. E a medição tem de concordar com a da
 * API da mesma base (`.skew-classificacao-financeira.json`, gravado por `scripts/skew-classificacao-financeira.mjs`):
 * os dois lados nasceram juntos na VENDAS-A1, e divergência entre eles é o detector errado, não um terceiro mundo.
 */
function rotulosDaClassificacaoNoWebDaBase(): { natureza: string; centro: string } | null {
  const raiz = path.resolve(__dirname, "../../..");
  const sha = fs.readFileSync(path.join(raiz, ".api-anterior.base"), "utf8").trim();
  expect(sha, "`.api-anterior.base` é gravado por scripts/api-anterior.mjs ao montar a árvore").toMatch(/^[0-9a-f]{40}$/);
  const fonte = execFileSync("git", ["show", `${sha}:apps/web/src/app/(app)/vendas/[kind]/new/page.tsx`], { cwd: raiz, encoding: "utf8" });
  const rotulos = (recurso: string) => [...fonte.matchAll(new RegExp(`<Field label="([^"]+)" required[^>]*><RefSelect resource="${recurso}"`, "g"))].map((m) => m[1]!);
  const natureza = rotulos("financial_categories");
  const centro = rotulos("cost_centers");
  expect([natureza.length, centro.length], `detector dos rótulos da classificação no web da base: ${JSON.stringify({ natureza, centro })}`).toEqual(natureza.length ? [1, 1] : [0, 0]);
  const arq = path.join(raiz, ".skew-classificacao-financeira.json");
  if (!fs.existsSync(arq)) {
    throw new Error(`decisão da classificação financeira ausente (${arq}): rode scripts/skew-classificacao-financeira.mjs antes do skew. `
      + "Sem ela não há como conferir a medição do web da base contra a da API da mesma base.");
  }
  const api = JSON.parse(fs.readFileSync(arq, "utf8")) as { baseSha: string; ocorrencias: number; declara: boolean };
  expect(api.baseSha, "a decisão da API foi medida na mesma base").toBe(sha);
  expect(natureza.length === 1, "o web da base tem os campos exatamente quando a API da mesma base declara a classificação").toBe(api.ocorrencias === 1 && api.declara);
  console.log(`[skew] A1-K2 · o web da base ${sha} ${natureza.length ? `desenha "${natureza[0]}" e "${centro[0]}"` : "NÃO tem os campos da classificação"}`);
  return natureza.length ? { natureza: natureza[0]!, centro: centro[0]! } : null;
}

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
 * os envia com a capacidade declarada — e aí o caso seria o do W1, não este. O POST é observado no fio.
 *
 * O RAMO É MEDIDO NO FONTE DO WEB DA BASE, E NÃO ADIVINHADO PELO RÓTULO NA TELA. A versão anterior decidia
 * contando `label` "Categoria financeira" no formulário — o rótulo que o bundle da base tinha quando o caso foi
 * escrito. A #62 renomeou os campos para "Natureza" e "Centro de resultado"; com ela na base, a contagem deu zero,
 * o caso escolheu o mundo LEGADO para um web que EXIGE a classificação, e morreu esperando um Salvar que nunca
 * habilita. Um detector que depende de um texto de tela troca de ramo em silêncio a cada renomeação. Agora os
 * rótulos saem do COMMIT da base (`rotulosDaClassificacaoNoWebDaBase`), conferidos contra a decisão medida da API
 * da mesma base: nenhum dos dois ramos é escolhido pela tela que ele mesmo vai medir.
 */
test("VENDAS-A1 · A1-K2 — o web da base cria venda: sem os campos (base anterior à A1), 201 com nulos e a confirmação usa o padrão legado; com eles, 201 com o par escolhido", async ({ page, request }) => {
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
  const rotulos = rotulosDaClassificacaoNoWebDaBase();
  const baseMostraCampos = rotulos !== null;
  if (rotulos) {
    // Mundo em que a base já é posterior à A1: o web dela preenche como o deste HEAD (W1). O caso do cliente
    // ANTERIOR à fatia deixou de existir em produção, e fingi-lo aqui certificaria o que não roda.
    await expect(page.getByTestId("central-vendas").locator("label", { hasText: rotulos.natureza }).first(), "o web da base desenha o campo que o fonte dele declara").toBeVisible();
    await expect(salvar, "declarada, a classificação é exigida pelo web da base").toBeDisabled();
    await preencherClassificacaoFinanceira(page, rotulos);
    await expect(salvar, "com o par escolhido, o Salvar do web da base habilita").toBeEnabled();
  }
  await salvar.click();
  const r = await resposta;
  expect(r.status(), "a API deste HEAD aceita o corpo do cliente da base").toBe(201);
  const enviado = r.request().postDataJSON() as Record<string, unknown>;
  const { id } = await r.json() as { id: string };
  const lido = await (await request.get(`${API}/api/sales/sales/${id}`, { headers: auth })).json() as Record<string, unknown>;
  if (baseMostraCampos) {
    expect([enviado["categoria_financeira_id"], enviado["centro_custo_id"]], "o web da base (pós-A1) enviou o par escolhido").toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/), expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    expect([lido["categoria_financeira_id"], lido["centro_custo_id"]], "o web da base (pós-A1) gravou a classificação que enviou").toEqual([enviado["categoria_financeira_id"], enviado["centro_custo_id"]]);
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
 * CADASTROS-ESTRUTURA (decisão 250) e FASES 4 a 6 · WEB DA BASE × API NOVA — os casos 1 e 2 da janela de deploy
 *
 * O corpo de cada caso é o que o web DA BASE envia — e esse corpo depende de a base já ter, ou não, a fatia.
 * Este bloco nasceu na #62 dizendo "a base nunca terá os campos novos — comportamento fixo, sem decisão medida".
 * Era uma verdade COM PRAZO: com a #62 na `main`, o web da base de toda PR nova JÁ É o da ficha em abas, e o
 * "corpo antigo" que CE-K1, PA-K2, RH-K2 e PR-K2 mandavam deixou de ser o de qualquer navegador em produção —
 * certificá-lo seria provar um cliente que não roda. O mundo é MEDIDO na árvore da base (a migration de cada
 * fatia, `scripts/lib/fichas-cadastro.mjs`, lida por `skew-fichas-cadastro.ts`), e cada um cobra a sua prova:
 *
 *   base SEM a migration → o corpo ANTIGO, exatamente como antes (produto com category_id/kind_id; Pessoas sem
 *                          grade; funcionário pelo cadastro de Pessoas; produto com has_lot e 2ª unidade);
 *   base COM a migration → o corpo da ficha que o web da base manda (produto sem categoria/classe; grupo com o
 *                          código sugerido e o superior; Parceiro com grade e perfil; novo funcionário pelo CPF e
 *                          Função com CBO; produto com controle_lote e grade de unidades) — aceito com o status
 *                          exato e gravado com os valores que vieram, conferidos no banco.
 *
 * CE-K2 mudou também pelo lado da API, e isso NÃO é skew: a decisão 257 (D-1, esta PR) tornou o código das
 * árvores GERADO pelo servidor — "POST sem `code` gera; `code` igual ao gerado é aceito; diferente → 422". A
 * asserção antiga ("a API nova exige código → 422") descrevia o contrato anterior da API deste HEAD, e foi
 * trocada pela do contrato novo nos dois mundos, com a conferência no banco do código gerado.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */
async function cabecalhosDaSessao(page: Page) {
  const s = await sessao(page);
  return { Authorization: `Bearer ${s.token}`, "X-Org-Id": s.orgId!, "Content-Type": "application/json" };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("CADASTROS-ESTRUTURA · CE-K1 — corpo de produto do web da BASE (sem a 0025: com category_id e kind_id; com a 0025: sem os dois): 201 na API nova, gravado como veio", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const temArvore = baseTemFatiaDeCadastro("grupoArvore", "CE-K1");
  const primeiro = async (p: string) => {
    const r = await page.request.get(`${API}${p}`, { headers: cab });
    expect(r.status(), p).toBe(200);
    return (await r.json() as { items: { id: string }[] }).items?.[0]?.id;
  };
  const grupo = await primeiro("/api/resources/product_groups?kind=analytic&pageSize=1");
  expect(grupo, "premissa: há grupo analítico").toBeTruthy();
  const unidade = await primeiro("/api/resources/measurement_units?symbol=un&pageSize=1");
  expect(unidade, "premissa: há unidade").toBeTruthy();
  const banco = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
  if (!temArvore) {
    // MUNDO LEGADO: os lookups de Categoria/Classe que a web anterior usa continuam na API nova
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
    const gravado = execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", `select category_id || '|' || kind_id from erp.products where id = '${id}'`], { encoding: "utf8" }).trim();
    expect(gravado, "a API grava o que veio").toBe(`${categoria}|${classe}`);
    return;
  }

  // MUNDO ATUAL: o formulário de produto da base (com a 0025) não tem mais Categoria nem Classe — o corpo não os leva.
  const desc = uniq("CE-K1 produto web da base");
  const r = await page.request.post(`${API}/api/resources/products`, { headers: cab, data: { description: desc, measurement_id: unidade, group_id: grupo, control_stock: false, is_active: true } });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json() as { id: string }).id;
  expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
  const gravado = execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", `select concat_ws('|', description, group_id, measurement_id, coalesce(category_id::text, 'sem categoria'), coalesce(kind_id::text, 'sem classe')) from erp.products where id = '${id}'`], { encoding: "utf8" }).trim();
  expect(gravado, "a API grava o que veio, sem inventar categoria nem classe").toBe(`${desc}|${grupo}|${unidade}|sem categoria|sem classe`);
  execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", `update erp.products set deleted_at = now() where id = '${id}'`], { encoding: "utf8" });
});

test("CADASTROS-ESTRUTURA · CE-K2 — grupo pelo corpo do web da BASE: sem a 0025 (só o nome) a API nova GERA o código; com a 0025 (código sugerido e superior) aceita, e código diferente é 422 legível, nada gravado", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const temArvore = baseTemFatiaDeCadastro("grupoArvore", "CE-K2");
  const banco = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
  const sql = (c: string) => execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();
  const sugerir = async (superior: string | null) => {
    const r = await page.request.get(`${API}/api/resources/product_groups/proximo-codigo${superior ? `?parent_id=${superior}` : ""}`, { headers: cab });
    expect(r.status(), "a API nova sugere o código da árvore").toBe(200);
    const { codigo } = await r.json() as { codigo: string };
    expect(codigo, "premissa: a sugestão é um código de verdade").toMatch(/^\d+(\.\d+)*$/);
    return codigo;
  };
  const nome = uniq("CE-K2 grupo web anterior");

  if (!temArvore) {
    // MUNDO LEGADO: o formulário de grupo da base manda só o nome. Pelo contrato D-1 a API nova GERA o código — o
    // próximo da raiz, o mesmo que ela sugere — e grava o grupo analítico na raiz.
    const previsto = await sugerir(null);
    const r = await page.request.post(`${API}/api/resources/product_groups`, { headers: cab, data: { name: nome, is_active: true } });
    expect(r.status(), await r.text()).toBe(201);
    const id = (await r.json() as { id: string }).id;
    expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
    expect(sql(`select concat_ws('|', code, name, kind, coalesce(parent_id::text, 'raiz')) from erp.product_groups where id = '${id}' and deleted_at is null`),
      "o servidor gerou o código previsto; nome, tipo e raiz como vieram").toBe(`${previsto}|${nome}|analytic|raiz`);
    return;
  }

  // MUNDO ATUAL: o formulário de grupo da base (com a 0025, sem `codigoAutomatico`) manda o código SUGERIDO, o tipo e
  // o superior. Debaixo do primeiro sintético da raiz do seed — a raiz só comporta nove códigos de um dígito.
  const superior = sql("select id from erp.product_groups where kind = 'synthetic' and parent_id is null and deleted_at is null and code is not null order by code limit 1");
  expect(superior, "premissa: o seed tem um grupo sintético na raiz").toMatch(UUID);
  const sugerido = await sugerir(superior);
  const ok = await page.request.post(`${API}/api/resources/product_groups`, { headers: cab, data: { code: sugerido, name: nome, kind: "analytic", parent_id: superior, is_active: true } });
  expect(ok.status(), await ok.text()).toBe(201);
  const id = (await ok.json() as { id: string }).id;
  expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
  expect(sql(`select concat_ws('|', code, name, kind, parent_id) from erp.product_groups where id = '${id}' and deleted_at is null`),
    "o código sugerido que o web da base enviou foi aceito e gravado; nome, tipo e superior como vieram").toBe(`${sugerido}|${nome}|analytic|${superior}`);

  // E o código que o usuário EDITA na tela da base (lá ele é digitável): 422 no campo, com a mensagem legível, nada gravado.
  const proximo = await sugerir(superior);
  const ultimo = proximo.slice(proximo.lastIndexOf(".") + 1);
  const trocado = `${proximo.slice(0, proximo.lastIndexOf(".") + 1)}${String(Number(ultimo) >= 90 ? Number(ultimo) - 5 : Number(ultimo) + 5).padStart(ultimo.length, "0")}`;
  expect(trocado, "premissa: um código diferente do que o servidor geraria").not.toBe(proximo);
  const outro = uniq("CE-K2 grupo codigo editado");
  const ruim = await page.request.post(`${API}/api/resources/product_groups`, { headers: cab, data: { code: trocado, name: outro, kind: "analytic", parent_id: superior, is_active: true } });
  expect(ruim.status(), await ruim.text()).toBe(422);
  const erro = ((await ruim.json()) as { error: { details?: { path: string | string[]; message?: string }[] } }).error;
  expect(erro.details?.map((d) => [String(d.path), d.message]), "a recusa aponta o Código, com a mensagem do contrato").toContainEqual(["code", "O código é gerado pelo sistema."]);
  expect(sql(`select count(*) from erp.product_groups where name = '${outro.replace(/'/g, "''")}'`), "nada gravado").toBe("0");
});

test("CADASTROS FASE 4 · PA-K2 — formulário de Pessoas do web da BASE contra a API nova (sem a 0027: sem grade; com a 0027: ficha com grade e perfil): grava; PUT sem grades não mexe nelas; sem tipo → 422; documento inválido 422 e duplicado 409", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const temFicha = baseTemFatiaDeCadastro("fichaParceiro", "PA-K2");
  const banco = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
  const sql = (c: string) => execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();
  // corpo do formulário anterior: só colunas de people, nenhuma chave da ficha
  const semTipo = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("PA-K2 sem tipo"), person_type: "legal", is_provider: false, is_client: false, is_employee: false, is_proprietary: false, is_transporter: false } });
  expect(semTipo.status(), await semTipo.text()).toBe(422);
  expect((await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("PA-K2 doc"), document: "529.982.247-00", person_type: "natural", is_client: true } })).status(), "CPF com DV errado").toBe(422);
  let id: string;
  if (!temFicha) {
    // MUNDO LEGADO: o formulário anterior não tem grade — ela é PREPARADA no banco, para o PUT abaixo ter o que preservar.
    const r = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("PA-K2 web anterior"), document: "12.ABC.345/01DE-35", person_type: "legal", is_client: true, is_provider: false, is_employee: false, is_proprietary: false, is_transporter: false, is_active: true } });
    expect(r.status(), await r.text()).toBe(201);
    id = (await r.json() as { id: string }).id;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const org = sql(`select organization_id from erp.people where id = '${id}'`);
    sql(`insert into erp.parceiro_enderecos (organization_id, person_id, tipo, logradouro) values ('${org}', '${id}', 'entrega', 'PA-K2 rua')`);
  } else {
    // MUNDO ATUAL: o formulário da base É a ficha em abas — a grade e o perfil vão no MESMO POST do principal.
    const nome = uniq("PA-K2 ficha da base");
    const r = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: nome, document: "12.ABC.345/01DE-35", person_type: "legal", is_client: true, is_provider: false, is_employee: false, is_proprietary: false, is_transporter: false, is_active: true,
      enderecos: [{ tipo: "entrega", logradouro: "PA-K2 rua" }], perfil_cliente: { limite_credito: "250" } } });
    expect(r.status(), await r.text()).toBe(201);
    id = (await r.json() as { id: string }).id;
    expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
    expect(sql(`select concat_ws('|', name, document, person_type, is_client) from erp.people where id = '${id}' and deleted_at is null`), "o principal, com o documento normalizado").toBe(`${nome}|12ABC34501DE35|legal|t`);
    expect(sql(`select string_agg(concat_ws('|', tipo, logradouro), ';') from erp.parceiro_enderecos where person_id = '${id}' and deleted_at is null`), "a grade de endereços, exatamente a enviada").toBe("entrega|PA-K2 rua");
    expect(sql(`select limite_credito::text from erp.client_profiles where person_id = '${id}'`), "o perfil de cliente com o limite enviado").toBe("250.00");
  }
  const put = await page.request.put(`${API}/api/resources/people/${id}`, { headers: cab, data: { phone: "63 99999-0000", is_client: true } });
  expect(put.status(), await put.text()).toBe(200);
  expect(sql(`select count(*) from erp.parceiro_enderecos where person_id = '${id}' and deleted_at is null`), "grade intacta").toBe("1");
  const dup = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("PA-K2 dup"), document: "12ABC34501DE35", person_type: "legal", is_client: true } });
  expect(dup.status(), await dup.text()).toBe(409);
  // o dado de teste fica excluído logicamente (nunca apagado)
  sql(`update erp.people set deleted_at = now() where id = '${id}'`);
});

test("CADASTROS FASE 5 · RH-K2 — web da BASE contra a API nova: sem a 0028, nada muda (funcionário pelo cadastro de Pessoas grava; Funções como antes); com a 0028, o novo pelo CPF e a Função com CBO gravam", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const temRh = baseTemFatiaDeCadastro("rhFuncionarios", "RH-K2");
  const banco = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
  if (!temRh) {
    // MUNDO LEGADO — "Novo funcionário" da web anterior: formulário de Pessoas com is_employee
    const r = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("RH-K2 funcionario"), person_type: "natural", is_employee: true, is_client: false, is_provider: false, is_proprietary: false, is_transporter: false } });
    expect(r.status(), await r.text()).toBe(201);
    // Funções: o corpo anterior (sem CBO) grava
    const f = await page.request.post(`${API}/api/resources/job_functions`, { headers: cab, data: { name: uniq("RH-K2 funcao"), base_salary: "1000", monthly_hours: 220, hour_value: "5", description: "RH-K2", is_active: true } });
    expect(f.status(), await f.text()).toBe(201);
    // o dado de teste fica excluído logicamente (nunca apagado)
    const id = (await r.json() as { id: string }).id;
    execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", `update erp.people set deleted_at = now() where id = '${id}'`], { encoding: "utf8" });
    return;
  }

  // MUNDO ATUAL: o "Novo funcionário" do web da base (com a 0028) é a porta do CPF, e a Função leva a CBO oficial.
  const sql = (c: string) => execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();
  const cpf = cpfValido();
  const nome = uniq("RH-K2 funcionario");
  const novo = await page.request.post(`${API}/api/hr/funcionarios/por-cpf`, { headers: cab, data: { document: cpf, name: nome } });
  expect(novo.status(), await novo.text()).toBe(201);
  const criado = await novo.json() as { id: string; criado: boolean };
  expect(criado.criado, "CPF novo: o parceiro nasce agora").toBe(true);
  expect(criado.id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
  expect(sql(`select concat_ws('|', document, name, is_employee) from erp.people where id = '${criado.id}' and deleted_at is null`), "gravado como Funcionário, com o CPF e o nome enviados").toBe(`${cpf}|${nome}|t`);
  const cbo = sql("select codigo from erp.cbo_ocupacoes order by codigo limit 1");
  expect(cbo, "premissa: a CBO oficial está carregada (0026)").toMatch(/^\d{6}$/);
  const funcao = uniq("RH-K2 funcao");
  const f = await page.request.post(`${API}/api/resources/job_functions`, { headers: cab, data: { name: funcao, cbo_code: cbo, base_salary: "1000", monthly_hours: 220, hour_value: "5", description: "RH-K2", is_active: true } });
  expect(f.status(), await f.text()).toBe(201);
  const funcaoId = (await f.json() as { id: string }).id;
  expect(funcaoId, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
  expect(sql(`select concat_ws('|', name, cbo_code) from erp.job_functions where id = '${funcaoId}'`), "a Função gravou a CBO enviada").toBe(`${funcao}|${cbo}`);
  // o dado de teste fica excluído logicamente (nunca apagado)
  sql(`update erp.people set deleted_at = now() where id = '${criado.id}'`);
});

test("CADASTROS FASE 6 · PR-K2 — formulário de Produto do web da BASE contra a API nova: sem a 0029, has_lot=true grava 'lote', false grava 'nenhum' e a 2ª unidade é aceita como legado; com a 0029, controle_lote e a grade de unidades gravam como vieram", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const temFicha = baseTemFatiaDeCadastro("fichaProduto", "PR-K2");
  const banco = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
  const sql = (c: string) => execFileSync("psql", [banco, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();
  const grupo = sql("select id from erp.product_groups where deleted_at is null and kind = 'analytic' order by code limit 1");
  const un = sql("select id from erp.measurement_units where upper(symbol) = 'UN' order by organization_id nulls last limit 1");
  const kg = sql("select id from erp.measurement_units where upper(symbol) = 'KG' order by organization_id nulls last limit 1");
  const natureza = sql("select id from erp.financial_categories where deleted_at is null and kind = 'analytic' and nature = 'expense' order by code limit 1");
  if (!temFicha) {
    // MUNDO LEGADO — corpo do formulário anterior: has_lot e a 2ª unidade, nenhuma chave da ficha
    const r = await page.request.post(`${API}/api/resources/products`, { headers: cab, data: { description: uniq("PR-K2 web anterior"), group_id: grupo, measurement_id: un, financial_category_id: natureza, has_lot: true, second_measurement_id: kg, factor_type: "multiply", factor: "25", control_stock: true, is_active: true } });
    expect(r.status(), await r.text()).toBe(201);
    const id = (await r.json() as { id: string; has_lot: boolean }).id;
    expect(sql(`select controle_lote || '/' || has_lot from erp.products where id = '${id}'`)).toBe("lote/true");
    const put = await page.request.put(`${API}/api/resources/products/${id}`, { headers: cab, data: { has_lot: false } });
    expect(put.status(), await put.text()).toBe(200);
    expect(sql(`select controle_lote || '/' || has_lot from erp.products where id = '${id}'`)).toBe("nenhum/false");
    sql(`update erp.products set deleted_at = now() where id = '${id}'`);
    return;
  }

  // MUNDO ATUAL: o formulário da base (com a 0029) é a ficha do Produto — controle_lote e a grade de unidades.
  expect([grupo, un, kg, natureza], "premissas do seed: grupo analítico, UN, KG e natureza de despesa").toEqual([expect.stringMatching(UUID), expect.stringMatching(UUID), expect.stringMatching(UUID), expect.stringMatching(UUID)]);
  const desc = uniq("PR-K2 ficha da base");
  const r = await page.request.post(`${API}/api/resources/products`, { headers: cab, data: { description: desc, group_id: grupo, measurement_id: un, financial_category_id: natureza, controle_lote: "lote", unidades: [{ measurement_id: kg, tipo_fator: "multiply", fator: "25" }], control_stock: true, is_active: true } });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json() as { id: string }).id;
  expect(id, "o id vem da API e entra no SQL — tem de ser um UUID").toMatch(UUID);
  expect(sql(`select controle_lote || '/' || has_lot from erp.products where id = '${id}' and description = '${desc.replace(/'/g, "''")}'`), "o controle de lote enviado, e o legado derivado dele").toBe("lote/true");
  expect(sql(`select string_agg(concat_ws('|', measurement_id, tipo_fator, fator), ';') from erp.produto_unidades where product_id = '${id}' and deleted_at is null`), "a grade de unidades, exatamente a enviada").toBe(`${kg}|multiply|25.000000`);
  const put = await page.request.put(`${API}/api/resources/products/${id}`, { headers: cab, data: { controle_lote: "nenhum" } });
  expect(put.status(), await put.text()).toBe(200);
  expect(sql(`select controle_lote || '/' || has_lot from erp.products where id = '${id}'`), "o PUT da ficha troca o controle, e o legado acompanha").toBe("nenhum/false");
  sql(`update erp.products set deleted_at = now() where id = '${id}'`);
});

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * CADASTROS AJUSTES 01 · AJ-W1..AJ-W4 — o web da BASE contra a API deste HEAD (seção 7 da missão).
 *
 * (1) a busca de referência que o web da base abre SEM texto responde 200 com lista (na base ela dava 500);
 * (2) POST de árvore com o código SUGERIDO (o que o web da base manda) é aceito; código diferente → 422 legível;
 * (3) conta bancária/área/curral com `code` (a base exige "Sigla"/"Código") → 422 legível, nada gravado;
 * (4) PUT de Parceiro sem os campos novos da 0030 → nada muda neles.
 * /api/referencias/* nunca é mockado aqui: a lista vem do banco real (0026).
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */
const BANCO_AJ = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
const sqlAj = (c: string) => execFileSync("psql", [BANCO_AJ, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();
const mensagensDoErro = async (r: { json: () => Promise<unknown> }) => { const e = (await r.json() as { error?: { message?: string; details?: { message?: string }[] } }).error; return [e?.message, ...(e?.details ?? []).map((d) => d.message)].filter(Boolean).join(" | "); };

test("CADASTROS AJUSTES 01 · AJ-W1 — o campo Banco do web da base, aberto SEM texto, lista pela API nova (200, nunca 500)", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const buscas: { url: string; status: number }[] = [];
  page.on("response", (r) => { if (/\/api\/referencias\/bancos(\?|$)/.test(r.url())) buscas.push({ url: r.url(), status: r.status() }); });
  await page.goto("/cadastros/people/new");
  await page.getByTestId("ficha-em-abas").getByRole("tab", { name: "Financeiro" }).click();
  await page.getByLabel("Banco", { exact: true }).click();
  const opcoes = page.locator(".cmd-panel [role=option]");
  await expect(opcoes.first(), "a lista aparece sem digitar").toBeVisible();
  expect(buscas.length, "premissa: a busca foi chamada").toBeGreaterThan(0);
  expect(buscas.every((b) => b.status === 200), JSON.stringify(buscas)).toBe(true);
  expect(buscas.some((b) => !new URL(b.url).searchParams.get("search")), "a busca SEM texto foi a que respondeu").toBe(true);
  v.semBloqueio();
  v.semErroDeContrato();
});

test("CADASTROS AJUSTES 01 · AJ-W2 — árvore: o código SUGERIDO que o web da base envia é aceito; código diferente → 422 legível, nada gravado", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const sug = await (await page.request.get(`${API}/api/resources/financial_categories/proximo-codigo`, { headers: cab })).json() as { codigo: string };
  expect(sug.codigo, "premissa: a sugestão continua servida ao web da base").toMatch(/^\d+$/);
  const nome = uniq("AJ-W2 natureza web base");
  const ok = await page.request.post(`${API}/api/resources/financial_categories`, { headers: cab, data: { code: sug.codigo, name: nome, nature: "both", kind: "synthetic", is_active: true } });
  expect(ok.status(), await ok.text()).toBe(201);
  const id = (await ok.json() as { id: string }).id;
  expect(sqlAj(`select code from erp.financial_categories where id = '${id}'`)).toBe(sug.codigo);
  const outro = uniq("AJ-W2 natureza pulando");
  const ruim = await page.request.post(`${API}/api/resources/financial_categories`, { headers: cab, data: { code: String(Number(sug.codigo) + 5), name: outro, nature: "both", kind: "synthetic", is_active: true } });
  expect(ruim.status(), await ruim.text()).toBe(422);
  expect(await mensagensDoErro(ruim)).toContain("O código é gerado pelo sistema.");
  expect(sqlAj(`select count(*) from erp.financial_categories where name = '${outro}'`), "nada gravado").toBe("0");
  sqlAj(`update erp.financial_categories set deleted_at = now() where id = '${id}'`);
});

test("CADASTROS AJUSTES 01 · AJ-W3 — conta bancária, área e curral com `code` (formulário da base) → 422 legível, nada gravado", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const empresa = sqlAj("select e.id from erp.empresas e join erp.organization_members m on m.organization_id = e.organization_id join erp.users u on u.id = m.user_id where u.email = 'admin@demo.local' and e.deleted_at is null order by e.code limit 1");
  const setor = sqlAj(`select s.id from erp.feedlot_sectors s join erp.empresas e on e.organization_id = s.organization_id where e.id = '${empresa}' and s.deleted_at is null limit 1`);
  const casos: [string, string, Record<string, unknown>][] = [
    ["bank_accounts", "description", { code: "AJW3", description: uniq("AJ-W3 conta"), type: "checking", is_active: true }],
    ["areas", "name", { empresa_id: empresa, code: "AJW3", name: uniq("AJ-W3 area"), area_ha: "1", is_active: true }],
    ["feedlot_corrals", "name", { sector_id: setor, code: "AJW3", name: uniq("AJ-W3 curral"), capacity: 10, is_active: true }]
  ];
  for (const [key, campo, corpo] of casos) {
    const r = await page.request.post(`${API}/api/resources/${key}`, { headers: cab, data: corpo });
    expect(r.status(), `${key}: ${await r.text()}`).toBe(422);
    const msg = await mensagensDoErro(r);
    expect(msg, `${key}: mensagem legível`).toMatch(/c[óo]digo/i);
    expect(msg).not.toMatch(/Unrecognized|Expected|Campo não reconhecido/);
    expect(sqlAj(`select count(*) from erp.${key} where ${campo} = '${String(corpo[campo])}'`), `${key}: nada gravado`).toBe("0");
  }
});

test("CADASTROS AJUSTES 01 · AJ-W4 — PUT de Parceiro do web da base (sem os campos da 0030): nada muda neles", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const r = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { name: uniq("AJ-W4 parceiro"), person_type: "natural", is_client: true, is_provider: false, is_employee: false, is_proprietary: false, is_transporter: false, is_active: true } });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json() as { id: string }).id;
  sqlAj(`update erp.people set rg = '1234567', sexo = 'F', site = 'exemplo.com.br', latitude = -15.2, longitude = -59.3, calcula_funrural = true where id = '${id}'`);
  const put = await page.request.put(`${API}/api/resources/people/${id}`, { headers: cab, data: { phone: "63 99999-0000", is_client: true } });
  expect(put.status(), await put.text()).toBe(200);
  expect(sqlAj(`select concat_ws('|', rg, sexo, site, latitude::text, longitude::text, calcula_funrural::text) from erp.people where id = '${id}'`)).toBe("1234567|F|exemplo.com.br|-15.200000|-59.300000|true");
  sqlAj(`update erp.people set deleted_at = now() where id = '${id}'`);
});

/**
 * VENDAS-A4 · CP-K2 — O WEB DA BASE CRIA ORÇAMENTO, PEDIDO E VENDA CONTRA A API DESTE HEAD.
 *
 * O cliente da base não conhece `condicao_pagamento_id`: o corpo dele não o leva. A API deste HEAD tem de
 * aceitar esse corpo (201), gravar o documento com a condição NULA (conferido por SQL) e o plano como veio, e
 * a conversão (orçamento → pedido → venda) e a confirmação seguem como hoje. O corpo é observado no fio.
 */
test("VENDAS-A4 · CP-K2 — o web da base cria orçamento, pedido e venda sem a condição de pagamento: 201, condição nula, plano como enviado; conversão e confirmação como hoje", async ({ page, request }) => {
  const v = vigiar(page);
  await login(page);
  const auth = await cabecalhosDaSessao(page);
  const rotulos = rotulosDaClassificacaoNoWebDaBase();
  const BASE = { budgets: "vendas.orcamento", orders: "vendas.pedido", sales: "vendas.venda" } as const;
  const criados: Partial<Record<keyof typeof BASE, string>> = {};

  for (const variante of ["budgets", "orders", "sales"] as const) {
    const codigo = `CK2${variante[0]!.toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
    const criada = await request.post(`${API}/api/admin/tipos-operacao`, { headers: auth, data: { codigo, codigoBase: BASE[variante], nome: `Skew A4 ${codigo}` } });
    expect(criada.status(), await criada.text()).toBe(201);
    const topId = (await criada.json() as { id: string }).id;

    await page.goto(`/vendas/${variante}/new`);
    await expect(page.getByTestId("top-lancador")).toBeVisible();
    await page.locator(`[data-testid="top-opcao"][data-top-id="${topId}"]`).click();
    await page.getByTestId("top-continuar").click();
    await expect(page.getByTestId("top-contexto")).toBeVisible();
    await pickRef(page, "Cliente", "DEMO");
    await page.getByRole("button", { name: /Adicionar item/ }).click();
    await page.getByTestId("central-vendas-linha").first().getByTestId("central-vendas-produto").click();
    await page.getByTestId("central-vendas-pesquisa").getByRole("option").first().click();
    await page.getByTestId("central-vendas-linha").first().getByLabel("Valor unitário").fill("10");
    if (rotulos) await preencherClassificacaoFinanceira(page, rotulos);
    await expect(page.getByTestId("condicao-pagamento"), "o web da base não conhece o campo").toHaveCount(0);

    const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/sales/${variante}`);
    await page.getByRole("button", { name: "Salvar" }).click();
    const r = await resposta;
    expect(r.status(), `a API deste HEAD aceita o corpo do cliente da base (${variante})`).toBe(201);
    const enviado = r.request().postDataJSON() as Record<string, unknown>;
    expect(Object.keys(enviado), "premissa: o cliente da base não conhece o campo").not.toContain("condicao_pagamento_id");
    const { id } = await r.json() as { id: string };
    expect(id).toMatch(UUID);
    expect(sqlAj(`select coalesce(condicao_pagamento_id::text, 'NULL') from erp.sales_documents where id = '${id}'`), `condição nula (${variante})`).toBe("NULL");
    // O plano como veio: o web da base (à vista) envia null, e a API grava só o `is_deductible` de sempre.
    const plano = sqlAj(`select (installment_plan - 'is_deductible')::text from erp.sales_documents where id = '${id}'`);
    expect(JSON.parse(plano), `plano como enviado (${variante})`).toEqual((enviado["installment_plan"] as Record<string, unknown> | null) ?? {});
    criados[variante] = id;
  }

  // CONVERSÃO como hoje: orçamento → pedido e pedido → venda, 201 e fonte `converted`; a condição segue nula.
  for (const variante of ["budgets", "orders"] as const) {
    const c = await request.post(`${API}/api/sales/${variante}/${criados[variante]}/convert`, { headers: auth, data: {} });
    expect(c.status(), await c.text()).toBe(201);
    expect(sqlAj(`select status from erp.sales_documents where id = '${criados[variante]}'`), `a fonte (${variante}) virou convertida`).toBe("converted");
    const destino = (await c.json() as { id: string }).id;
    expect(destino).toMatch(UUID);
    expect(sqlAj(`select coalesce(condicao_pagamento_id::text, 'NULL') from erp.sales_documents where id = '${destino}'`), "a conversão não inventa condição").toBe("NULL");
  }

  // CONFIRMAÇÃO como hoje: a venda criada pelo web da base confirma (200) e gera título.
  const conf = await request.post(`${API}/api/sales/sales/${criados.sales}/confirm`, { headers: auth, data: {} });
  expect(conf.status(), await conf.text()).toBe(200);
  expect(sqlAj(`select status from erp.sales_documents where id = '${criados.sales}'`)).toBe("confirmed");
  expect((await conf.json() as { title_ids: string[] }).title_ids.length, "a confirmação gerou título, como hoje").toBeGreaterThan(0);
  v.semBloqueio(); v.semErroDeContrato();
});

/**
 * VENDAS-A3-1 · LD-K2 — O WEB DA BASE CRIA ORÇAMENTO, PEDIDO E VENDA CONTRA A API DESTE HEAD.
 *
 * O web da base não conhece o layout do documento e nenhum layout está cadastrado: nada muda. A API deste HEAD
 * aceita o corpo de sempre e cada documento nasce (201), aberto, conferido por SQL. O corpo é observado no fio.
 */
test("VENDAS-A3-1 · LD-K2 — o web da base cria orçamento, pedido e venda como hoje contra a API deste HEAD: 201", async ({ page, request }) => {
  const v = vigiar(page);
  await login(page);
  const auth = await cabecalhosDaSessao(page);
  const rotulos = rotulosDaClassificacaoNoWebDaBase();
  const BASE = { budgets: "vendas.orcamento", orders: "vendas.pedido", sales: "vendas.venda" } as const;

  for (const variante of ["budgets", "orders", "sales"] as const) {
    const codigo = `LK2${variante[0]!.toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
    const criada = await request.post(`${API}/api/admin/tipos-operacao`, { headers: auth, data: { codigo, codigoBase: BASE[variante], nome: `Skew A3-1 ${codigo}` } });
    expect(criada.status(), await criada.text()).toBe(201);
    const topId = (await criada.json() as { id: string }).id;

    await page.goto(`/vendas/${variante}/new`);
    await expect(page.getByTestId("top-lancador")).toBeVisible();
    await page.locator(`[data-testid="top-opcao"][data-top-id="${topId}"]`).click();
    await page.getByTestId("top-continuar").click();
    await expect(page.getByTestId("top-contexto")).toBeVisible();
    await pickRef(page, "Cliente", "DEMO");
    await page.getByRole("button", { name: /Adicionar item/ }).click();
    await page.getByTestId("central-vendas-linha").first().getByTestId("central-vendas-produto").click();
    await page.getByTestId("central-vendas-pesquisa").getByRole("option").first().click();
    await page.getByTestId("central-vendas-linha").first().getByLabel("Valor unitário").fill("10");
    if (rotulos) await preencherClassificacaoFinanceira(page, rotulos);

    const resposta = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/sales/${variante}`);
    await page.getByRole("button", { name: "Salvar" }).click();
    const r = await resposta;
    expect(r.status(), `a API deste HEAD aceita o corpo do cliente da base (${variante})`).toBe(201);
    const enviado = r.request().postDataJSON() as Record<string, unknown>;
    expect(enviado["tipo_operacao_id"], `premissa: o corpo capturado é o deste lançamento (${variante})`).toBe(topId);
    const { id } = await r.json() as { id: string };
    expect(id).toMatch(UUID);
    expect(sqlAj(`select status from erp.sales_documents where id = '${id}'`), `no banco: aberto, como hoje (${variante})`).toBe("open");
  }
  v.semBloqueio(); v.semErroDeContrato();
});
