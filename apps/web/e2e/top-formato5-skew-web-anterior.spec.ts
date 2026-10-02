import { test, expect, type Locator, type Page } from "@playwright/test";
import { login, api, uniq } from "./helpers";
import { cfg4, cfg5, criarTopViaApi, excluirTopE2E, type CapacidadesFormato5E2E } from "./top-config-08-comum";
import { COMMITS_DO_EDITOR_DA_TOP, editorDaBaseGravaFormato4, editorDaBaseGravaFormato5, shaDaBase } from "./skew-fonte-da-base";

/**
 * OPERACOES-01 F4 · K-2 DO FORMATO 5, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (decisão 281; a janela "API antes
 * do web" da DEPLOYMENT).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). Arquivo próprio, e não um caso a mais em `skew-web-anterior.spec.ts` (de uso geral) nem no K-2 da
 * TOP-CONFIG-08 (que mede o 4): entra pelo nome, sem passo no CI.
 *
 * O QUE SE MEDE. A API deste HEAD declara o bloco `formato5` (a mais, na raiz das capacidades) e LÊ toda TOP como 5 — mas
 * devolve a versão COMO GRAVADA (`leituraDoDetalhe: "formato_gravado"`) e nunca promove o que o cliente manda. O navegador
 * roda o bundle EXATO da base, e:
 *   (a) o EDITOR ANTERIOR grava o formato 4 sobre uma TOP do 4, e a API o guarda no 4 (versão nova só porque mudou);
 *   (b) uma TOP já gravada no 5 (pelo web novo): o editor anterior a abre com as seções de operação BLOQUEADAS (o domínio
 *       dele não lê o 5 — `top-config-ilegivel`), renomear manda o PUT SEM `configuracao`, e a API guarda a versão nova
 *       com o 5 INTEIRO, igual ao de antes; o histórico anterior lista as versões sem quebrar (o 5 aparece "não
 *       interpretado");
 *   (c) nenhuma resposta de erro de contrato (404, 422, 5xx) e nenhuma requisição morta no navegador.
 *
 * O MUNDO, NESTE SENTIDO, É O DO WEB DA BASE. A API no ar é a deste HEAD — perguntar a ela daria sempre "formato 5" e não
 * diria nada sobre o cliente. A pergunta vai ao FONTE do commit da base (`editorDaBaseGravaFormato5`, a marca do
 * assistente `top-assistente`): não tem → mundo legado (a base de hoje, 622f194: o editor do 4); tem → mundo do 5 (a
 * base já com a F4: o editor anterior é o do 5, abre a TOP do 5 e grava o 5). A API deste HEAD entra como PREMISSA.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const ROTA_TOPS = "/configuracoes?tab=operacoes&sub=tipos-operacao";

type Mundo = "legado" | "formato5";
type DetalheTop = {
  nome: string; versao: number; revisao: number; configuracaoSchema: number;
  configuracao: { suportada: boolean; versaoSchema: number; valor?: Record<string, unknown> & { geral: { confirmacao: string; exigeObservacao: boolean } } };
};
const detalheTop = (page: Page, id: string) => api<DetalheTop>(page, "GET", `/api/admin/tipos-operacao/${id}`);

/** O web da base grava o 5? Lido do fonte do commit da árvore montada (a prova reversa do detector é o primeiro caso). */
function mundoDoWebDaBase(): Mundo {
  const sha = shaDaBase();
  const mundo: Mundo = editorDaBaseGravaFormato5(sha) ? "formato5" : "legado";
  console.log(`[skew] OPERACOES-01 F4 · K-2 do 5 · o web da base (${sha.slice(0, 7)}) ${mundo === "formato5" ? "TEM" : "NÃO tem"} o assistente da TOP → mundo ${mundo}`);
  return mundo;
}

/** Cabeçalhos da sessão gravada pelo web da base depois do login, para falar com a API deste HEAD direto. */
async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/**
 * A PREMISSA: a API no ar é a desta fatia — declara o bloco `formato5` (no 5) e continua declarando, iguais, os blocos que
 * o web anterior compara (contrato 1, `restricoes` no 3, `regrasGerais` no 4).
 */
async function premissaDaApi(page: Page) {
  const cap = await page.request.get(`${API}/api/admin/tipos-operacao/capabilities`, { headers: await cabecalhosDaSessao(page) });
  expect(cap.status(), "premissa: a API serve as capacidades da administração de TOP").toBe(200);
  const capacidades = await cap.json() as CapacidadesFormato5E2E & { contractVersion?: number; configuracao?: unknown; restricoes?: unknown; regrasGerais?: unknown };
  expect(capacidades.contractVersion, "o contrato que o web anterior lê continua o 1").toBe(1);
  expect(capacidades.configuracao, "e o formato que ele compara continua o 1").toMatchObject({ versaoSchema: 1 });
  expect(capacidades.restricoes, "o bloco do formato 3 continua lá, igual").toMatchObject({ suportado: true, versaoSchema: 3 });
  expect(capacidades.regrasGerais, "e o do formato 4 também (o editor anterior o exige no 4)").toMatchObject({ suportado: true, versaoSchema: 4 });
  expect(capacidades.formato5, "premissa: a API julgada é a desta fatia (bloco do formato 5)")
    .toMatchObject({ suportado: true, versaoSchema: 5, leituraDoDetalhe: "formato_gravado" });
}

/** Vigia do navegador (o desenho de `skew-web-anterior.spec.ts`): CORS morto e erro de contrato não passam calados. */
function vigiar(page: Page) {
  const falhas: string[] = []; const respostas: { url: string; status: number }[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.url().includes("/api/")) respostas.push({ url: r.url(), status: r.status() }); });
  return {
    semBloqueio: () => expect(falhas, "nenhuma requisição do cliente em produção pode morrer no navegador").toEqual([]),
    semErroDeContrato: () => {
      const ruins = respostas.filter((r) => r.status === 404 || r.status === 422 || r.status >= 500);
      expect(ruins, `o cliente em produção não pode receber erro de contrato da API nova: ${JSON.stringify(ruins)}`).toEqual([]);
    }
  };
}

/** O editor do web da base, aberto pela busca da lista (server-side: a asserção de UMA linha é a prova do recorte). */
async function abrirEditorDaBase(page: Page, codigo: string): Promise<Locator> {
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

/** O corpo de cada PUT desta TOP que sai do navegador — a prova do que o cliente anterior pediu. */
function escutarPuts(page: Page, id: string): Record<string, unknown>[] {
  const corpos: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && new URL(r.url()).pathname === `/api/admin/tipos-operacao/${id}`) corpos.push(r.postDataJSON() as Record<string, unknown>);
  });
  return corpos;
}
const respostaDoPut = (page: Page, id: string) =>
  page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/admin/tipos-operacao/${id}`);

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-2 DO 5 · O DETECTOR DO MUNDO (PROVA REVERSA, SEM NAVEGADOR)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OPERACOES-01 F4 · K-2 do 5 (sentido 2) — o detector `editorDaBaseGravaFormato5` lê o fonte do commit: na TOP-CONFIG-08 da main (o editor do 4) dá FALSO, com a marca do 4 presente no MESMO commit", () => {
  const sha = COMMITS_DO_EDITOR_DA_TOP.formato4;
  // A PREMISSA: o detector consegue ler o fonte deste commit — a marca do editor do 4 está lá. Sem ela, o "falso" abaixo
  // poderia ser só um commit que não se leu.
  expect(editorDaBaseGravaFormato4(sha), "premissa: o commit da TOP-CONFIG-08 tem o diálogo das regras gerais (o editor do 4)").toBe(true);
  expect(editorDaBaseGravaFormato5(sha), "o editor do 4 não tem o assistente: não grava o 5").toBe(false);
  // O LADO VERDADEIRO não tem commit fixo enquanto a F4 não entrar na main (nenhum commit da main tem o assistente):
  // declarado, e não fabricado. Quando ela entrar, o merge dela vira o commit fixo do lado verdadeiro.
  test.info().annotations.push({
    type: "declarado",
    description: "o lado verdadeiro de editorDaBaseGravaFormato5 não tem commit fixo até a F4 (OPERACOES-01) entrar na main"
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-2 DO 5 · (a) O EDITOR ANTERIOR SOBRE UMA TOP DO 4
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OPERACOES-01 F4 · K-2 do 5 (sentido 2) — (a) o editor da base muda a observação de uma TOP do 4: o PUT sai no 4 e a API deste HEAD guarda a versão nova no 4, sem promover (com a base já na F4, o editor anterior grava o 5)", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  await login(page);
  await premissaDaApi(page);
  const top = await criarTopViaApi(page, "vendas.venda", cfg4(), { rotulo: "K-2 do 5 · venda no 4" });
  try {
    const antes = await detalheTop(page, top.id);
    expect([antes.versao, antes.configuracaoSchema, antes.configuracao.valor?.geral.exigeObservacao], "premissa: versão 1 no formato 4, sem exigir observação")
      .toEqual([1, 4, false]);

    const v = vigiar(page);
    const forma = await abrirEditorDaBase(page, top.codigo);
    const corpos = escutarPuts(page, top.id);
    await forma.getByTestId("top-aba-geral").click();
    const observacao = forma.getByTestId("top-campo-geral-observacao");
    await expect(observacao, "o editor da base abre a Geral da TOP do 4 (ele lê o 4)").toHaveValue("false");
    await observacao.selectOption("true");
    const resposta = respostaDoPut(page, top.id);
    await forma.getByTestId("top-salvar").click();
    expect((await resposta).status(), "a API deste HEAD aceita o que o editor anterior enviou").toBe(200);
    await expect(forma).toBeHidden();
    await expect(page.getByTestId("top-regras-passam-a-valer"), "uma exigência numa versão do 4 não abre o diálogo das regras").toHaveCount(0);

    const formato = mundo === "legado" ? 4 : 5;
    expect(corpos, "uma gravação").toHaveLength(1);
    const enviada = corpos[0]!["configuracao"] as { versaoSchema?: number; geral?: { exigeObservacao?: boolean } } | undefined;
    expect(enviada?.versaoSchema, `o editor anterior gravou o formato ${formato}`).toBe(formato);
    expect(enviada?.geral?.exigeObservacao).toBe(true);
    const depois = await detalheTop(page, top.id);
    expect([depois.versao, depois.configuracaoSchema, depois.configuracao.valor?.versaoSchema, depois.configuracao.valor?.geral.exigeObservacao],
      "a API criou a versão nova NO FORMATO ENVIADO — nunca o promoveu").toEqual([2, formato, formato, true]);
    v.semBloqueio();
    v.semErroDeContrato();
  } finally {
    await excluirTopE2E(page, top.id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-2 DO 5 · (b) O EDITOR ANTERIOR DIANTE DE UMA TOP JÁ GRAVADA NO 5
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OPERACOES-01 F4 · K-2 do 5 (sentido 2) — (b) uma TOP gravada no 5: o editor da base bloqueia as seções de operação (`top-config-ilegivel`), renomear manda o PUT SEM configuração e a versão nova guarda o 5 inteiro; o histórico da base lista as versões sem quebrar", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  await login(page);
  await premissaDaApi(page);
  // A TOP do 5, com uma regra fora do neutro (Automática): é o que o web NOVO grava, e o que o anterior não sabe ler.
  const top = await criarTopViaApi(page, "vendas.venda", cfg5({ confirmacao: "automatica" }), { rotulo: "K-2 do 5 · venda no 5" });
  try {
    const antes = await detalheTop(page, top.id);
    expect([antes.versao, antes.configuracaoSchema, antes.configuracao.suportada, antes.configuracao.valor?.geral.confirmacao],
      "premissa: versão 1 no formato 5, legível pela API deste HEAD, com Automática").toEqual([1, 5, true, "automatica"]);

    const v = vigiar(page);
    const forma = await abrirEditorDaBase(page, top.codigo);
    if (mundo === "legado") {
      // O DOMÍNIO DA BASE NÃO LÊ O 5: cada seção de operação diz por que está bloqueada, e NENHUM campo dela monta —
      // abrir no neutro convidaria a salvar o 4 por cima de uma regra que ninguém leu.
      for (const aba of ["geral", "estoque", "aprovacao", "execucao"]) {
        await forma.getByTestId(`top-aba-${aba}`).click();
        await expect(forma.getByTestId("top-config-ilegivel"), `${aba}: o editor da base diz que não sabe interpretar a versão`).toBeVisible();
      }
      await expect(forma.getByTestId("top-campo-geral-confirmacao"), "nenhum campo de operação montou").toHaveCount(0);
      await expect(forma.getByTestId("top-campo-estoque-atualizacao")).toHaveCount(0);
    } else {
      // A BASE JÁ NA F4: o editor anterior é o do 5 — lê a TOP do 5 e mostra a regra dela.
      await forma.getByTestId("top-aba-geral").click();
      await expect(forma.getByTestId("top-config-ilegivel"), "o editor do 5 lê o 5").toHaveCount(0);
      await expect(forma.getByTestId("top-campo-geral-confirmacao")).toHaveValue("automatica");
    }

    // RENOMEAR — a identificação continua editável nos dois mundos.
    const nome = uniq("K-2 do 5 · renomeada pelo web da base");
    await forma.getByTestId("top-aba-identificacao").click();
    await forma.getByTestId("top-campo-nome").fill(nome);
    const corpos = escutarPuts(page, top.id);
    const resposta = respostaDoPut(page, top.id);
    await forma.getByTestId("top-salvar").click();
    expect((await resposta).status(), "a API deste HEAD aceita a gravação do cliente da base").toBe(200);
    await expect(forma).toBeHidden();
    expect(corpos, "uma gravação").toHaveLength(1);
    if (mundo === "legado") {
      // SEM CONFIGURAÇÃO NO CORPO: ausente = "preserve o que está lá" — o editor anterior não manda o que não leu.
      expect("configuracao" in corpos[0]!, "o editor da base não manda a configuração que não leu").toBe(false);
    } else {
      expect((corpos[0]!["configuracao"] as { versaoSchema?: number } | undefined)?.versaoSchema, "o editor do 5 reenvia o 5").toBe(5);
    }

    // O SERVIDOR É O ÁRBITRO: nome novo, versão nova, e o 5 INTEIRO — igual, chave por chave, ao de antes.
    const depois = await detalheTop(page, top.id);
    expect([depois.nome, depois.versao, depois.configuracaoSchema], "renomear é conteúdo: versão 2, ainda no formato 5").toEqual([nome, 2, 5]);
    expect(depois.configuracao.valor, "a configuração do 5 sobreviveu inteira").toEqual(antes.configuracao.valor);

    // O HISTÓRICO DA BASE: as duas versões, no formato 5, sem quebrar. No mundo legado o detalhe de cada uma diz que o
    // formato não é interpretado (e não inventa valores); no do 5, mostra a configuração.
    await page.getByLabel("Buscar tipo de operação").fill(top.codigo);
    const linha = page.getByRole("row").filter({ hasText: top.codigo });
    await expect(linha).toHaveCount(1);
    await linha.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menuitem", { name: "Ver versões" }).click();
    const versoes = page.getByTestId("versoes-tipo-operacao");
    await expect(versoes).toBeVisible();
    const linhas = versoes.getByTestId("top-versao-linha");
    await expect(linhas, "o histórico da base lista as duas versões").toHaveCount(2);
    const v2 = linhas.nth(0); const v1 = linhas.nth(1);
    await expect(v2).toContainText("Versão 2");
    await expect(v2).toContainText(nome);
    await expect(v2, "o histórico da base mostra o formato gravado").toContainText("Formato da configuração: 5");
    await expect(v1).toContainText("Versão 1");
    await expect(v1).toContainText("Formato da configuração: 5");
    await v2.getByTestId("top-versao-detalhe").click();
    if (mundo === "legado") {
      await expect(v2.getByTestId("top-versao-ilegivel"), "o detalhe diz que não sabe interpretar o formato 5").toContainText("(formato 5)");
      await expect(v2.getByTestId("top-versao-configuracao"), "e não mostra valores que não leu").toHaveCount(0);
    } else {
      await expect(v2.getByTestId("top-versao-configuracao"), "o histórico do 5 mostra a configuração").toBeVisible();
      await expect(v2.getByTestId("top-versao-ilegivel")).toHaveCount(0);
    }
    v.semBloqueio();
    v.semErroDeContrato();
  } finally {
    await excluirTopE2E(page, top.id);
  }
});
