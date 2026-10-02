import { test, expect, type Locator, type Page } from "@playwright/test";
import { login, api, uniq, empresaAtiva, primeiroId, abrirLancamentoDeVendas, escolherTopEContinuar } from "./helpers";
import { cadastroDeEstoque, criarTopDeEstoque, hojeISO } from "./estoque-01-comum";
import { abrirHistoricoDaTop, abrirTelaDeTops, cfg3, criarTopViaApi, detalheTopNoServidor, excluirTopE2E } from "./top-config-08-comum";

/**
 * TOP-CONFIG-08 · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (decisão 277; a janela "web antes da API" da
 * DEPLOYMENT).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O version skew roda em `playwright.skew.config.ts`, cujo `testMatch` é a
 * expressão `/skew-api-producao\.spec\.ts/` — sem âncora, então ela casa também com o fim deste nome; e o
 * `playwright.config.ts` comum ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá a API seria a
 * deste HEAD e o caso ficaria verde por vacuidade). O caso não foi acrescentado em `skew-api-producao.spec.ts` porque
 * aquele arquivo é de outra PR aberta (a da Central de Compras): editar o mesmo arquivo seria colisão (PRE-PR-02). Sem
 * `scripts/lib` e sem passo no CI: o arquivo entra pelo nome. A prova de que cada config o enxerga do jeito certo é o
 * `--list` de cada uma (relatório da fatia), e a identidade da árvore da base é a do caso IDENTIDADE de
 * `skew-api-producao.spec.ts`, na mesma execução do job.
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA, e por duas portas que nascem juntas nesta fatia: o bloco `regrasGerais` na raiz de
 * `GET /api/admin/tipos-operacao/capabilities` e a fila `GET /api/aprovacoes/vendas` (404 = a rota não existe naquele
 * binário). As duas respostas têm de descrever o MESMO binário — uma sem a outra é defeito, não skew —, e a resposta
 * decide o ramo. Os dois ramos cobram prova POSITIVA; nenhum deles só passa:
 *   · MUNDO LEGADO (a base de hoje, sem a fatia): o editor grava o formato 3, com os textos de hoje, sem o diálogo
 *     "Estas regras passam a valer"; a tela de Aprovações diz que as aprovações ainda não estão disponíveis neste
 *     servidor — nunca uma fila vazia, que afirmaria "nada a aprovar" —, sem nenhuma requisição morrer no navegador;
 *     as Centrais de Estoque e de Vendas abrem como hoje; e o histórico de versões é o de hoje (K-1d): nenhuma linha
 *     "Regras gerais e aprovação", nem na versão do formato 3 que traz as chaves.
 *   · MUNDO NOVO (a base já com a fatia, depois do merge): o editor mostra o bloco (os textos da seção 8 e o diálogo) e
 *     grava o formato 4; Aprovações carrega a fila que o servidor declara; as Centrais, iguais; e o histórico diz da
 *     versão do formato 3 o que ela era: "registradas, sem execução".
 *   · MUNDO DO FORMATO 5 (OPERACOES-01 F4, decisão 281: a base já com a F4, que declara também o bloco `formato5`): o
 *     editor é o do 5 — os textos do mundo novo, MENOS a ajuda da Geral, que passa a dizer que as Centrais aceitam o
 *     documento sem item quando a TOP permite — e grava o formato 5; Aprovações, Centrais e histórico como no mundo novo.
 *     A base de hoje (622f194) é o mundo NOVO: o editor deste HEAD, sem o bloco do 5, continua o do 4 — ajuda ANTIGA e
 *     corpo 4. Cada mundo exige a SUA ajuda e proíbe as dos outros dois.
 * Não há mock: o servidor é o binário da base, servindo o banco migrado e semeado por este HEAD.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const ROTA_TOPS = "/configuracoes?tab=operacoes&sub=tipos-operacao";

/**
 * OS TEXTOS DO EDITOR, LETRA POR LETRA. Os "de hoje" são os do editor sem o bloco `regrasGerais` (o editor desta árvore
 * os guarda para o servidor anterior); os "novos" são os da seção 8 da especificação, que só valem com o bloco. Cada
 * ramo exige os SEUS e proíbe os do outro: um editor que misturasse as duas versões passaria em qualquer uma das metades.
 */
const TEXTOS_DE_HOJE = {
  ajudaGeral: "As regras de preenchimento e de ciclo de vida do documento: quem confirma, o que é obrigatório informar e o que ainda pode ser alterado depois da confirmação. Confirmação e alteração após confirmar ficam registradas nesta versão, mas ainda não são executadas: a confirmação automática, por exemplo, não confirma documento nenhum. As exigências de preenchimento só são cobradas no lançamento em versões gravadas com as restrições da operação.",
  ajudaAprovacao: "Se o documento precisa passar por aprovação antes de ser confirmado e, quando o critério for por valor, a partir de que valor a exigência começa. Configuração preparada, ainda não executada: nenhum documento é retido por aprovação.",
  avisoUltimaFrase: "Fiscal, aprovação e as regras da aba Geral continuam registrando a intenção da operação, sem executá-la.",
  declarativo: "Preparadas, ainda não executadas: fiscal, aprovação, confirmação automática e alteração após confirmar. Elas ficam registradas nesta versão, mas nada as executa nesta etapa do produto. As exigências da aba Geral só são cobradas no lançamento em versões gravadas com as restrições da operação."
} as const;
const TEXTOS_NOVOS = {
  ajudaGeral: "Confirmação automática: o documento é confirmado ao ser salvo, por quem salvou e com a mesma conferência da confirmação manual. Se a confirmação recusar, o documento fica salvo e aberto, e o motivo aparece ao confirmar. Documento sem itens: o servidor aceita o documento sem item, mas nas Centrais de Vendas e de Compras o lançamento ainda pede ao menos um item. As exigências de preenchimento são cobradas no lançamento.",
  ajudaAprovacao: "Com aprovação, o documento só é confirmado depois de aprovado em Aprovações, por quem tem a permissão Aprovar. Alterar a venda depois de aprovada pede uma aprovação nova.",
  avisoUltimaFrase: "O fiscal continua registrando a intenção da operação, sem executá-la.",
  declarativo: "Preparado, ainda não executado: o fiscal. Ele fica registrado nesta versão, mas nada o executa nesta etapa do produto."
} as const;
/**
 * OPERACOES-01 F4 — os textos do EDITOR DO 5: os do mundo novo, com a ajuda da Geral nova (a frase do documento sem
 * itens). É o único texto deste caso que muda com o 5.
 */
const TEXTOS_FORMATO5 = {
  ...TEXTOS_NOVOS,
  ajudaGeral: "Confirmação automática: o documento é confirmado ao ser salvo, por quem salvou e com a mesma conferência da confirmação manual. Se a confirmação recusar, o documento fica salvo e aberto, e o motivo aparece ao confirmar. Documento sem itens: quando esta operação permite, as Centrais de Vendas, de Compras e de Estoque aceitam o documento sem item. As exigências de preenchimento são cobradas no lançamento."
} as const;
const MSG_APROVACOES_INDISPONIVEIS = "As aprovações ainda não estão disponíveis neste servidor.";

/**
 * O mundo da base: `legado` (sem o bloco `regrasGerais`), `novo` (com ele, sem o `formato5` — a base de hoje) ou
 * `formato5` (com os dois). Os casos de Aprovações, Centrais e histórico só distinguem o legado dos outros dois: o 5 não
 * muda nada deles.
 */
type Mundo = "legado" | "novo" | "formato5";
type TextosDoEditor = Readonly<Record<keyof typeof TEXTOS_DE_HOJE, string>>;
const TEXTOS_DO_MUNDO: Readonly<Record<Mundo, TextosDoEditor>> = { legado: TEXTOS_DE_HOJE, novo: TEXTOS_NOVOS, formato5: TEXTOS_FORMATO5 };
const MUNDOS = Object.keys(TEXTOS_DO_MUNDO) as Mundo[];
/** O formato que o editor deste HEAD grava em cada mundo (o que a base daquele mundo executa). */
const FORMATO_DO_MUNDO: Readonly<Record<Mundo, number>> = { legado: 3, novo: 4, formato5: 5 };
type DetalheTop = { versao: number; revisao: number; configuracaoSchema: number; configuracao: { valor: { versaoSchema: number; geral: { confirmacao: string } } } };

/** Cabeçalhos da sessão gravada pelo web depois do login, para perguntar à base direto. */
async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/**
 * Vigia do navegador (o desenho de `skew-api-producao.spec.ts`): falha de CORS não vira exceção nem resposta HTTP — o
 * Chromium aborta a requisição antes de ela existir para a aplicação. Sem o coletor, a tela renderiza vazia e o teste
 * passa, que é exatamente o modo de falha desta janela. O 404 da fila na base é RESPOSTA (o aviso depende de lê-la), não
 * falha de rede: se o CORS da base não o deixasse chegar, é aqui que apareceria.
 */
function vigiar(page: Page) {
  const falhas: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  return { semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]) };
}

/**
 * A PERGUNTA À BASE, feita antes de qualquer tela. Devolve o mundo e o total da fila de vendas que a base declara (o
 * número que a tela tem de mostrar no mundo novo). Status fora de {200, 404} na fila é defeito, não skew.
 */
async function perguntarABase(page: Page, cab: Record<string, string>): Promise<{ mundo: Mundo; totalDaFila: number | null }> {
  const cap = await page.request.get(`${API}/api/admin/tipos-operacao/capabilities`, { headers: cab });
  expect(cap.status(), "premissa: a base serve as capacidades da administração de TOP").toBe(200);
  const capacidades = await cap.json() as { contractVersion?: number; restricoes?: { suportado?: boolean; versaoSchema?: number }; regrasGerais?: unknown; formato5?: unknown };
  expect(capacidades.contractVersion, "o contrato que o web lê continua o 1, nos dois mundos").toBe(1);
  // O editor sem o bloco grava o formato 3 SÓ porque a base declara as restrições (TOP-CONFIG-05); sem elas o ramo
  // legado mediria outro editor (o do formato 2), e o caso provaria a coisa errada.
  expect(capacidades.restricoes, "premissa: a base declara as restrições (o formato 3)").toMatchObject({ suportado: true, versaoSchema: 3 });

  const fila = await page.request.get(`${API}/api/aprovacoes/vendas?page=1&pageSize=1`, { headers: cab });
  expect([200, 404], "a base ou serve a fila ou não a conhece — outro código é defeito, não skew").toContain(fila.status());
  const temBloco = capacidades.regrasGerais !== undefined;
  const temFila = fila.status() === 200;
  expect(temFila, "o bloco `regrasGerais` e a fila de aprovação nascem no MESMO binário: uma resposta sem a outra é defeito").toBe(temBloco);
  // OPERACOES-01 F4: o bloco `formato5` só existe por cima do do 4 (o editor do 5 exige o do 4) — sem `regrasGerais`, com
  // `formato5` é defeito, não skew.
  const temFormato5 = capacidades.formato5 !== undefined;
  if (!temBloco) expect(capacidades.formato5, "o formato 5 nasce por cima do 4: sem `regrasGerais`, nada de `formato5`").toBeUndefined();
  const mundo: Mundo = !temBloco ? "legado" : temFormato5 ? "formato5" : "novo";
  let totalDaFila: number | null = null;
  if (mundo !== "legado") {
    expect(capacidades.regrasGerais, "o bloco declarado é o do formato 4 (o 5 não o muda)").toMatchObject({ suportado: true, versaoSchema: 4 });
    totalDaFila = Number((await fila.json() as { total: number }).total);
    expect(Number.isInteger(totalDaFila), "a fila declara o total, como as listas de hoje").toBe(true);
  }
  if (mundo === "formato5") expect(capacidades.formato5, "o bloco do formato 5").toMatchObject({ suportado: true, versaoSchema: 5 });
  console.log(`[skew] TOP-CONFIG-08 · K-1 · a base responde ${fila.status()} a GET /api/aprovacoes/vendas, ${temBloco ? "DECLARA" : "NÃO declara"} o bloco regrasGerais e ${temFormato5 ? "DECLARA" : "NÃO declara"} o bloco formato5 → mundo ${mundo}`);
  return { mundo, totalDaFila };
}

const codigoNovo = (prefixo: string) => `${prefixo}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();

/** A TOP como o SERVIDOR (a base) a guarda — o árbitro do formato gravado, nunca um texto da tela. */
const detalheTop = (page: Page, id: string) => api<DetalheTop>(page, "GET", `/api/admin/tipos-operacao/${id}`);

/** O editor da TOP, aberto pela busca da lista (server-side: a asserção de UMA linha é a prova do recorte). */
async function abrirEditor(page: Page, codigo: string) {
  await page.goto(ROTA_TOPS);
  await expect(page.getByRole("heading", { name: "Tipos de Operação" })).toBeVisible();
  await page.getByLabel("Buscar tipo de operação").fill(codigo);
  const linha = page.getByRole("row").filter({ hasText: codigo });
  await expect(linha, "a busca recorta para exatamente a TOP do caso").toHaveCount(1);
  await linha.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  return forma;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1 · O EDITOR DA TOP
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("TOP-CONFIG-08 · K-1 (sentido 1) — o editor deste web sobre a API da base: sem o bloco `regrasGerais`, os textos de hoje, sem o diálogo das regras, e grava o formato 3; com o bloco, os textos novos, o diálogo e o formato 4; com o `formato5` também, a ajuda nova da Geral e o formato 5", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const { mundo } = await perguntarABase(page, await cabecalhosDaSessao(page));

  // A TOP de venda nasce PELA API DA BASE, sem configuração: o que ela grava é a verdade daquele binário.
  const codigo = codigoNovo("K1E");
  const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: "vendas.venda", nome: uniq("K-1 editor") });
  const antes = await detalheTop(page, top.id);
  expect(antes.configuracaoSchema, "premissa: sem configuração no corpo, a base grava o formato 2").toBe(2);

  const forma = await abrirEditor(page, codigo);
  const textos = TEXTOS_DO_MUNDO[mundo];
  /** Os textos de cada chave que os OUTROS mundos dizem e este não diz — proibidos aqui (os iguais não discriminam). */
  const dosOutros = (chave: keyof TextosDoEditor) =>
    [...new Set(MUNDOS.filter((m) => m !== mundo).map((m) => TEXTOS_DO_MUNDO[m][chave]))].filter((t) => t !== textos[chave]);
  const aviso = forma.getByTestId("top-aviso-versionamento");
  await expect(aviso, "o aviso de versionamento termina na frase deste mundo").toContainText(textos.avisoUltimaFrase);
  for (const outra of dosOutros("avisoUltimaFrase")) await expect(aviso, "e nunca na de outro").not.toContainText(outra);

  // GERAL: a ajuda e os campos das regras gerais. A ajuda é a única que distingue os TRÊS mundos.
  await forma.getByTestId("top-aba-geral").click();
  await expect(forma.getByText(textos.ajudaGeral, { exact: true }), "a ajuda da Geral é a deste mundo").toBeVisible();
  expect(dosOutros("ajudaGeral"), "premissa: a ajuda da Geral de cada um dos outros dois mundos é diferente desta").toHaveLength(2);
  for (const outra of dosOutros("ajudaGeral")) await expect(forma.getByText(outra, { exact: true }), "e não a de outro mundo").toHaveCount(0);
  const confirmacao = forma.getByTestId("top-campo-geral-confirmacao");
  await expect(confirmacao, "a Confirmação aparece nos dois mundos (a venda aceita Automática)").toBeVisible();
  await expect(forma.getByTestId("top-campo-geral-sem-itens"), "o Documento sem itens também (a venda aceita Permitido)").toBeVisible();
  if (mundo === "legado") {
    // O editor de hoje: as três regras, todas as opções escolhíveis, nenhum motivo de matriz ao lado.
    await expect(forma.getByTestId("top-campo-geral-alteracao"), "sem o bloco, a Alteração após confirmar continua no editor").toBeVisible();
    for (const campo of ["top-campo-geral-confirmacao", "top-campo-geral-alteracao", "top-campo-geral-sem-itens"]) {
      await expect(forma.getByTestId(campo).locator("option"), `${campo}: as duas opções de hoje`).toHaveCount(2);
      await expect(forma.getByTestId(campo).locator("option[disabled]"), `${campo}: nenhuma opção desabilitada pela matriz`).toHaveCount(0);
    }
  } else {
    // Com o bloco: a venda só aceita "Bloqueada" na Alteração, e o campo some (a regra que só aceita o neutro não decide nada).
    await expect(forma.getByTestId("top-campo-geral-alteracao"), "com o bloco, a Alteração após confirmar some na venda").toHaveCount(0);
  }
  await expect(forma.locator("[data-testid^='top-regra-motivo-']"), "na venda nenhuma opção visível é recusada pela matriz: nenhum motivo ao lado").toHaveCount(0);

  // APROVAÇÃO: a ajuda deste mundo, e "A partir de um valor" escolhível (a venda aceita as três políticas).
  await forma.getByTestId("top-aba-aprovacao").click();
  await expect(forma.getByText(textos.ajudaAprovacao, { exact: true }), "a ajuda da Aprovação é a deste mundo").toBeVisible();
  for (const outra of dosOutros("ajudaAprovacao")) await expect(forma.getByText(outra, { exact: true })).toHaveCount(0);
  await expect(forma.getByTestId("top-campo-aprovacao-politica").locator("option[disabled]"), "nenhuma política desabilitada na venda").toHaveCount(0);

  // EXECUÇÃO: a frase do que continua só declarado. A base declara a execução configurada (TOP-CONFIG-04A).
  await forma.getByTestId("top-aba-execucao").click();
  await expect(forma.getByTestId("top-execucao-declarativo"), "o que continua declarado, na frase deste mundo").toHaveText(textos.declarativo);

  // GRAVAR: Confirmação Automática. O corpo que sai do navegador é a prova do formato, não a tela.
  const corpos: { configuracao?: { versaoSchema?: number; geral?: { confirmacao?: string } } }[] = [];
  page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes(`/api/admin/tipos-operacao/${top.id}`)) corpos.push(r.postDataJSON()); });
  await forma.getByTestId("top-aba-geral").click();
  await confirmacao.selectOption("automatica");
  const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/api/admin/tipos-operacao/${top.id}`));
  await forma.getByTestId("top-salvar").click();
  const dialogoDasRegras = page.getByTestId("top-regras-passam-a-valer");
  if (mundo !== "legado") {
    // Editar uma TOP que já existe e ligar uma regra que passa a executar: o diálogo pergunta antes de gravar (no editor
    // do 4 e no do 5: a versão vigente é do formato 2, onde a Automática não executava).
    await expect(dialogoDasRegras, "com o bloco, o diálogo das regras abre antes de gravar").toBeVisible();
    await expect(dialogoDasRegras).toContainText("Estas regras passam a valer");
    await expect(dialogoDasRegras.getByTestId("top-regra-passa-a-valer"), "a lista é a do domínio: a confirmação automática").toHaveText(["Confirmação automática"]);
    await dialogoDasRegras.getByTestId("top-regras-salvar").click();
  }
  expect((await resposta).status(), "a base aceita o que este web enviou").toBe(200);
  await expect(dialogoDasRegras, "nenhum diálogo das regras fica na tela").toHaveCount(0);
  expect(corpos, "uma gravação").toHaveLength(1);
  const formato = FORMATO_DO_MUNDO[mundo];
  expect(corpos[0]!.configuracao?.versaoSchema, `o web gravou no formato que a base deste mundo executa (${formato})`).toBe(formato);
  expect(corpos[0]!.configuracao?.geral?.confirmacao).toBe("automatica");
  const depois = await detalheTop(page, top.id);
  expect([depois.versao, depois.configuracaoSchema, depois.configuracao.valor.geral.confirmacao],
    "a base criou a versão nova, no formato enviado, com a regra marcada").toEqual([antes.versao + 1, formato, "automatica"]);
  v.semBloqueio();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1 · A TELA DE APROVAÇÕES
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("TOP-CONFIG-08 · K-1 (sentido 1) — Aprovações deste web sobre a API da base: sem as rotas, \"ainda não estão disponíveis neste servidor\" nas três abas, sem quebrar; com elas, a fila que o servidor declara", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const { mundo, totalDaFila } = await perguntarABase(page, await cabecalhosDaSessao(page));

  await page.goto("/aprovacoes");
  await expect(page.getByRole("heading", { level: 1, name: "Aprovações" }), "o módulo novo monta nos dois mundos").toBeVisible();
  const indisponivel = page.getByTestId("aprovacoes-indisponivel");
  const lista = page.getByTestId("aprovacoes-lista");
  if (mundo === "legado") {
    // As abas do MÓDULO (o trilho do Workspace, rotulado pelo título) — não as abas abertas da moldura do shell.
    const abas = page.getByRole("tablist", { name: "Aprovações", exact: true });
    for (const aba of ["Vendas", "Compras", "Estoque"] as const) {
      await abas.getByRole("tab", { name: aba, exact: true }).click();
      await expect(abas.getByRole("tab", { name: aba, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(indisponivel, `${aba}: a fila da base não existe, e a aba diz isso`).toHaveText(MSG_APROVACOES_INDISPONIVEIS);
      await expect(lista, `${aba}: nada de lista afirmando que não há o que aprovar`).toHaveCount(0);
      await expect(page.getByTestId("aprovacoes-vazia"), `${aba}: nem o "Nenhum documento aguardando aprovação"`).toHaveCount(0);
    }
  } else {
    await expect(lista, "a base serve a fila: a lista monta").toBeVisible();
    await expect(lista).toHaveAttribute("data-area", "vendas");
    await expect(lista, "com o total que a base declarou na pergunta direta").toHaveAttribute("data-total", String(totalDaFila));
    await expect(indisponivel).toHaveCount(0);
  }

  // O RESTO DO SISTEMA NÃO DEPENDE DO MÓDULO NOVO: o Início abre, e o aviso não vaza para ele.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Início" }), "o Início abre depois de Aprovações").toBeVisible();
  await expect(indisponivel).toHaveCount(0);
  v.semBloqueio();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1 · AS CENTRAIS FICAM IGUAIS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("TOP-CONFIG-08 · K-1 (sentido 1) — as Centrais deste web sobre a API da base ficam iguais: a de Estoque abre, lê a prévia SEM `recusas` como a de hoje e confirma; a de Vendas abre na criação e na consulta", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const { mundo } = await perguntarABase(page, await cabecalhosDaSessao(page));

  // ── CENTRAL DE ESTOQUE. TOP e documento nascem PELA API DA BASE (TOP sem configuração: o formato 2, que nos dois
  // mundos não tem regra geral nem aprovação a executar).
  const topEstoque = await criarTopDeEstoque(page, "entrada");
  const c = await cadastroDeEstoque(page);
  await page.goto(`/estoque/movimentacoes/entradas/new?tipo_operacao_id=${topEstoque.id}`);
  const central = page.getByTestId("estoque-central");
  await expect(central, "a Central de Estoque abre na criação").toHaveAttribute("data-modo", "criacao");
  await expect(central).toHaveAttribute("data-especie", "entrada");
  await expect(page.getByTestId("estoque-central-top"), "com a TOP da base travada").toHaveAttribute("data-tipo-operacao-id", topEstoque.id);

  const doc = await api<{ id: string; situacao: string }>(page, "POST", "/api/estoque/entradas", {
    empresa_id: c.empresa, tipo_operacao_id: topEstoque.id, armazem_id: c.armazem, data_documento: hojeISO(),
    itens: [{ produto_id: c.produto, quantidade: "3", custo_unitario: "10" }]
  });
  expect(doc.situacao, "a base lança o documento aberto").toBe("aberto");
  // A PRÉVIA QUE A BASE DEVOLVE: sem a chave `recusas` (a base de hoje não a conhece; a de depois só a manda no formato
  // 4). É contra ESTE corpo que a Central deste HEAD — que agora lê `recusas` — tem de continuar igual.
  const previaNoFio = page.waitForResponse((r) => r.request().method() === "GET" && r.url().includes(`/api/estoque/entradas/${doc.id}/previa-confirmacao`));
  await page.goto(`/estoque/movimentacoes/entradas/${doc.id}`);
  await expect(central, "a consulta abre").toHaveAttribute("data-modo", "consulta");
  await expect(central).toHaveAttribute("data-situacao", "aberto");
  await page.getByTestId("estoque-confirmar").click();
  await expect(page.getByTestId("estoque-previa")).toBeVisible();
  const corpoDaPrevia = await (await previaNoFio).json() as Record<string, unknown>;
  expect("recusas" in corpoDaPrevia, `a base não manda \`recusas\` para TOP sem formato 4 (mundo ${mundo})`).toBe(false);
  await expect(page.getByTestId("estoque-previa-corpo"), "o corpo de hoje é lido como prévia PRONTA, não como indisponível").toHaveAttribute("data-situacao", "pronta");
  await expect(page.getByTestId("estoque-previa-item"), "o item da prévia").toHaveCount(1);
  await expect(page.getByTestId("estoque-previa-recusas"), "sem recusa nenhuma na tela").toHaveCount(0);
  await expect(page.getByTestId("estoque-previa-bloqueio"), "nem o aviso de saldo (é uma entrada)").toHaveCount(0);
  await expect(page.getByTestId("estoque-previa-confirmar"), "o Confirmar fica habilitado, como hoje").toBeEnabled();
  await page.getByTestId("estoque-previa-confirmar").click();
  await expect(central, "a base confirmou pelo clique deste web").toHaveAttribute("data-situacao", "confirmado");

  // ── CENTRAL DE VENDAS. Criação pelo lançador com uma TOP de venda da base, e a consulta de uma venda da base.
  const codigoVenda = codigoNovo("K1V");
  const topVenda = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo: codigoVenda, codigoBase: "vendas.venda", nome: uniq("K-1 Central de Vendas") });
  await abrirLancamentoDeVendas(page, "sales");
  await escolherTopEContinuar(page, topVenda.id);
  const centralVendas = page.getByTestId("central-vendas");
  await expect(centralVendas, "a Central de Vendas abre na criação com a TOP da base").toBeVisible();
  await expect(page.getByTestId("central-vendas-acoes"), "com a barra de ações").toBeVisible();

  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const venda = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: hojeISO(), client_id: cliente, tipo_operacao_id: topVenda.id,
    items: [{ product_id: produto, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });
  const lida = await api<{ code: string; status: string }>(page, "GET", `/api/sales/sales/${venda.id}`);
  expect(lida.status, "a base lança a venda aberta").toBe("open");
  await page.goto(`/vendas/sales/${venda.id}`);
  await expect(centralVendas, "a consulta da venda da base abre na Central").toBeVisible();
  await expect(centralVendas, "a do documento certo").toHaveAttribute("aria-label", new RegExp(lida.code));
  v.semBloqueio();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1d · O HISTÓRICO DE VERSÕES
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** A frase do histórico com o bloco, letra por letra; sem o bloco, nada que comece por "Regras gerais e aprovação". */
const LINHA_REGISTRADAS = "Regras gerais e aprovação: registradas, sem execução";

/** O valor de um campo no detalhe somente leitura da versão (`<dt>rótulo</dt><dd>valor</dd>`), pelo rótulo EXATO. */
const valorNoDetalhe = (secao: Locator, rotulo: string) =>
  secao.locator("div").filter({ has: secao.page().locator("dt").getByText(rotulo, { exact: true }) }).locator("dd");

test("TOP-CONFIG-08 · K-1d (sentido 1) — o histórico deste web sobre a API da base: a versão do formato 3 com as regras gerais declaradas (a forma do pedido de compra de produção) aparece sem nenhuma das duas linhas \"Regras gerais e aprovação\" quando a base não declara o bloco; com o bloco, \"registradas, sem execução\"", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const { mundo } = await perguntarABase(page, await cabecalhosDaSessao(page));

  // A TOP nasce PELA API DA BASE, no formato 3, na forma EXATA do pedido de compra de produção: Automática, Permitido,
  // Permitida — as chaves das regras gerais fora do neutro, que no formato 3 só DECLARAM (nos dois mundos).
  const top = await criarTopViaApi(page, "compras.pedido",
    cfg3({ confirmacao: "automatica", documentoSemItens: "permitido", alteracaoAposConfirmacao: "permitida" }), { rotulo: "K-1d histórico" });
  try {
    const gravada = await detalheTopNoServidor(page, top.id);
    const g = gravada.configuracao.valor?.geral;
    expect([gravada.versao, gravada.configuracaoSchema, g?.confirmacao, g?.documentoSemItens, g?.alteracaoAposConfirmacao],
      "premissa: a base gravou a versão 1 no formato 3, com as três regras de produção").toEqual([1, 3, "automatica", "permitido", "permitida"]);

    // O histórico pergunta à base o que ela declara (a MESMA pergunta do editor). A tela é carregada do zero aqui, então a
    // pergunta nasce com o histórico, e a resposta é a deste mundo.
    await abrirTelaDeTops(page);
    const capacidades = page.waitForResponse((r) => r.request().method() === "GET" && r.url().endsWith("/api/admin/tipos-operacao/capabilities"));
    const versoes = await abrirHistoricoDaTop(page, top.codigo);
    expect((await capacidades).status(), "o histórico perguntou à base as capacidades, e ela respondeu").toBe(200);

    // PROVA POSITIVA, nos dois mundos: a versão está lá, no formato 3, e o web LEU as chaves das regras gerais dela.
    const linhas = versoes.getByTestId("top-versao-linha");
    await expect(linhas, "a TOP tem uma versão só").toHaveCount(1);
    const v1 = linhas.first();
    await expect(v1).toContainText("Versão 1");
    await expect(v1, "o web leu a versão no formato 3").toContainText("Formato da configuração: 3");
    await v1.getByTestId("top-versao-detalhe").click();
    const geral = v1.getByTestId("top-versao-secao-geral");
    await expect(valorNoDetalhe(geral, "Confirmação"), "o detalhe mostra a regra declarada").toHaveText("Automática");
    await expect(valorNoDetalhe(geral, "Documento sem itens")).toHaveText("Permitido");
    await expect(valorNoDetalhe(geral, "Alteração após confirmar")).toHaveText("Permitida");

    const registradas = v1.getByTestId("top-historico-regras-registradas");
    const executadas = v1.getByTestId("top-historico-regras-executadas");
    if (mundo === "legado") {
      // Sem o bloco, o histórico de HOJE: nenhuma das duas linhas, embora a versão traga as chaves fora do neutro.
      await expect(registradas, "sem o bloco `regrasGerais`, nada de \"registradas, sem execução\"").toHaveCount(0);
      await expect(executadas, "nem \"executadas\"").toHaveCount(0);
      await expect(versoes, "nenhuma frase das regras gerais em lugar nenhum do histórico").not.toContainText("Regras gerais e aprovação");
    } else {
      // Com o bloco, a versão do formato 3 é o que sempre foi: declarava, sem executar.
      await expect(registradas, "com o bloco, a versão do formato 3 registrava, sem executar").toHaveText(LINHA_REGISTRADAS);
      await expect(executadas, "e nunca \"executadas\": o formato 3 não executa regra geral").toHaveCount(0);
    }
    v.semBloqueio();
  } finally {
    await excluirTopE2E(page, top.id);
  }
});
