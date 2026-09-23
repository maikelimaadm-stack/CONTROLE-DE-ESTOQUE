import { test, expect, type Page } from "@playwright/test";
import { login, uniq } from "./helpers";
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

  // Com o gate desligado, ATIVAR é recusado: a fase 1 não põe execução configurada em circulação.
  const ativar = await request.put(`${API}/api/admin/tipos-operacao/${id}`, { headers: auth,
    data: { configuracao: { ...configuracao, execucao: { estoque: "configurada", financeiro: "legado" } }, revisao: 1 } });
  expect(ativar.status(), "o HEAD com o gate desligado recusa a ativação").toBe(409);

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
