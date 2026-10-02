import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { SECOES_EXTENSAO_V5, secoesExtensaoNeutrasTop } from "@agro/domain";
import { login, api, uniq } from "./helpers";
import {
  abrirTelaDeTops, cfg4, cfg5, chamarApi, codigoTopE2E, detalheTopNoServidor, escolherTipoNoAssistente, excluirTopE2E,
  type CapacidadesFormato5E2E
} from "./top-config-08-comum";

/**
 * OPERACOES-01 F4 · K-1 DO FORMATO 5, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (decisão 281; a janela "web antes
 * da API" da DEPLOYMENT).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD, e o ramo da base
 * sem o 5 nunca seria medido). Arquivo próprio, e não um caso a mais em `skew-api-producao.spec.ts` (de uso geral, de
 * outras fatias) nem no K-1 da TOP-CONFIG-08 (que mede o 4): entra pelo nome, sem passo no CI.
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA: o bloco `formato5` na raiz de `GET /api/admin/tipos-operacao/capabilities`. A
 * premissa dos dois mundos é a mesma — a base é, no mínimo, a da TOP-CONFIG-08 (declara `regrasGerais` no formato 4) —,
 * e a resposta decide o ramo. Os dois cobram prova POSITIVA; nenhum só passa:
 *   · MUNDO LEGADO (a base de hoje, 622f194, sem a F4): a base NÃO conhece o 5 — recusa um POST no formato 5 com 422
 *     `TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO` e não cria nada (o MESMO corpo no 4 ela aceita: a recusa é o
 *     número). O web deste HEAD, sem o bloco, é o editor do 4 de HOJE: "Novo" abre com o seletor de família (sem o
 *     assistente), o pedido de venda mostra a aba Execução com "Execução configurada ainda não disponível para este
 *     movimento." (a única prova E2E dessa frase: no editor do 5 a aba some), a ajuda da Geral é a ANTIGA, e a criação
 *     de uma venda pela tela sai no formato 4 — que a base grava.
 *   · MUNDO DO FORMATO 5 (a base já com a F4): a base aceita e guarda o 5; "Novo" começa pelo passo 1 (o assistente,
 *     com os tipos que o catálogo dela publica), a ajuda é a nova, e a criação sai no formato 5.
 * Não há mock: o servidor é o binário da base, servindo o banco migrado e semeado por este HEAD. O corpo no fio e o
 * detalhe da BASE são o árbitro do formato — nunca um texto da tela.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

/** As duas ajudas da Geral, letra por letra: a do editor do 4 (a de hoje) e a do editor do 5. Cada mundo proíbe a outra. */
const AJUDA_GERAL_DO_4 = "Confirmação automática: o documento é confirmado ao ser salvo, por quem salvou e com a mesma conferência da confirmação manual. Se a confirmação recusar, o documento fica salvo e aberto, e o motivo aparece ao confirmar. Documento sem itens: o servidor aceita o documento sem item, mas nas Centrais de Vendas e de Compras o lançamento ainda pede ao menos um item. As exigências de preenchimento são cobradas no lançamento.";
const AJUDA_GERAL_DO_5 = "Confirmação automática: o documento é confirmado ao ser salvo, por quem salvou e com a mesma conferência da confirmação manual. Se a confirmação recusar, o documento fica salvo e aberto, e o motivo aparece ao salvar e ao confirmar. Documento sem itens: quando esta operação permite, a venda e a compra podem ser salvas sem item nas Centrais de Vendas e de Compras (o recebimento de um pedido sempre pede item). As exigências de preenchimento são cobradas no lançamento.";
/** A frase da aba Execução do editor do 4 para a família sem execução configurada (decisão 261: "movimento" na tela). */
const MENSAGEM_EXECUCAO_NAO_DISPONIVEL = "Execução configurada ainda não disponível para este movimento.";
/** A última frase do aviso de versionamento do editor com o bloco `regrasGerais` — a prova de que o editor JÁ leu as capacidades. */
const AVISO_COM_REGRAS_GERAIS = "O fiscal continua registrando a intenção da operação, sem executá-la.";

type Mundo = "legado" | "formato5";
type Capacidades = CapacidadesFormato5E2E & { contractVersion?: number; restricoes?: unknown; regrasGerais?: unknown };

/** Cabeçalhos da sessão gravada pelo web depois do login, para perguntar à base direto. */
async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/**
 * Vigia do navegador (o desenho de `skew-api-producao.spec.ts`): falha de CORS não vira exceção nem resposta HTTP — o
 * Chromium aborta a requisição antes de ela existir para a aplicação. Sem o coletor, a tela renderiza vazia e o teste
 * passa, que é exatamente o modo de falha desta janela.
 */
function vigiar(page: Page) {
  const falhas: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  return { semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]) };
}

/** A PERGUNTA À BASE, feita antes de qualquer tela: o bloco `formato5` decide o mundo; o do 4 é premissa dos dois. */
async function perguntarABase(page: Page): Promise<{ mundo: Mundo; capacidades: Capacidades }> {
  const cap = await page.request.get(`${API}/api/admin/tipos-operacao/capabilities`, { headers: await cabecalhosDaSessao(page) });
  expect(cap.status(), "premissa: a base serve as capacidades da administração de TOP").toBe(200);
  const capacidades = await cap.json() as Capacidades;
  expect(capacidades.contractVersion, "o contrato que o web lê continua o 1, nos dois mundos").toBe(1);
  expect(capacidades.restricoes, "premissa: a base declara as restrições (o formato 3)").toMatchObject({ suportado: true, versaoSchema: 3 });
  // O editor do 5 exige o do 4: sem `regrasGerais` o ramo legado mediria outro editor (o do 3), e o caso provaria a
  // coisa errada — esse mundo é o do K-1 da TOP-CONFIG-08.
  expect(capacidades.regrasGerais, "premissa: a base declara o bloco do formato 4 (TOP-CONFIG-08)").toMatchObject({ suportado: true, versaoSchema: 4 });
  const mundo: Mundo = capacidades.formato5 === undefined ? "legado" : "formato5";
  if (mundo === "formato5") expect(capacidades.formato5, "o bloco declarado é o do formato 5").toMatchObject({ suportado: true, versaoSchema: 5 });
  console.log(`[skew] OPERACOES-01 F4 · K-1 do 5 · a base ${mundo === "formato5" ? "DECLARA" : "NÃO declara"} o bloco formato5 → mundo ${mundo}`);
  return { mundo, capacidades };
}

/** A TOP pelo código, na BASE (busca server-side): o id, se ela existir. */
async function idPeloCodigo(page: Page, codigo: string): Promise<string | null> {
  const r = await api<{ items: { id: string; codigo: string }[] }>(page, "GET", `/api/admin/tipos-operacao?search=${encodeURIComponent(codigo)}`);
  return r.items.find((x) => x.codigo === codigo)?.id ?? null;
}

const ehPostDeTop = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/admin/tipos-operacao";

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1 DO 5 · A BASE E O CORPO NO FORMATO 5
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OPERACOES-01 F4 · K-1 do 5 (sentido 1) — a base sem o formato 5 RECUSA o corpo no 5 (422, nada criado) e aceita o mesmo corpo no 4; a base com o 5 o aceita e guarda no 5", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const { mundo } = await perguntarABase(page);

  const no5 = cfg5();
  expect(no5.versaoSchema, "premissa: o corpo é o NEUTRO DO 5 do domínio deste HEAD").toBe(5);
  const codigo = codigoTopE2E();
  const pedido = await chamarApi<{ id?: string; error?: { code: string; details?: { versoesSuportadas?: number[] } } }>(
    page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: "vendas.venda", nome: uniq("K-1 do 5 · corpo no 5"), configuracao: no5 });

  if (mundo === "legado") {
    // A RECUSA É EXPLÍCITA — o código de skew, e a lista do que a base conhece (sem o 5). "Aceitar e ignorar" gravaria
    // um 4 com outro significado; é por esta recusa que o web não pode mandar o 5 a quem não o declarou.
    expect(pedido.status, "a base recusa o formato que não conhece").toBe(422);
    expect(pedido.corpo.error?.code).toBe("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO");
    expect(pedido.corpo.error?.details?.versoesSuportadas, "a base conhece do 1 ao 4, e não o 5").toEqual([1, 2, 3, 4]);
    expect(await idPeloCodigo(page, codigo), "e nada foi criado").toBeNull();

    // A PREMISSA AO LADO: o MESMO corpo, só com o número 4 e sem as seções de extensão (que o 4 não tem), a base aceita
    // (201) — a recusa acima é do número, não do conteúdo. O 5 é o 4 MAIS as seções de extensão da lista do domínio
    // (`SECOES_EXTENSAO_V5`; desde a F5a, Destino e Fluxo; desde a F6a, Fluxo de compra e Divergência), todas no NEUTRO
    // — e nada além delas. A lista e o neutro vêm do domínio deste HEAD, nunca de um literal.
    const codigo4 = codigoTopE2E();
    const no4 = cfg4();
    const extensoes: readonly string[] = SECOES_EXTENSAO_V5;
    const chavesSoDo5 = Object.keys(no5).filter((k) => !(k in no4));
    expect([...chavesSoDo5].sort(), "premissa: o que o 5 tem a mais que o 4 são exatamente as seções de extensão").toEqual([...extensoes].sort());
    expect(Object.fromEntries(Object.entries(no5).filter(([k]) => extensoes.includes(k))), "premissa: as seções de extensão do corpo no 5 estão no neutro")
      .toEqual(secoesExtensaoNeutrasTop());
    const no5SemExtensoes = Object.fromEntries(Object.entries(no5).filter(([k]) => !extensoes.includes(k)));
    expect({ ...no5SemExtensoes, versaoSchema: 4 }, "premissa: sem as seções de extensão, o 5 é o 4 com outro número").toEqual(no4);
    const aceito = await chamarApi<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo: codigo4, codigoBase: "vendas.venda", nome: uniq("K-1 do 5 · corpo no 4"), configuracao: no4 });
    expect(aceito.status, "o mesmo corpo no 4 a base aceita").toBe(201);
    const d4 = await detalheTopNoServidor(page, aceito.corpo.id);
    expect([d4.versao, d4.configuracaoSchema], "e guarda no 4").toEqual([1, 4]);
    await excluirTopE2E(page, aceito.corpo.id);
  } else {
    expect(pedido.status, "a base com a F4 aceita o formato 5").toBe(201);
    const d5 = await detalheTopNoServidor(page, pedido.corpo.id!);
    expect([d5.versao, d5.configuracaoSchema, d5.configuracao.valor?.versaoSchema], "e o guarda no 5, como gravado").toEqual([1, 5, 5]);
    await excluirTopE2E(page, pedido.corpo.id!);
  }
  v.semBloqueio();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-1 DO 5 · O EDITOR DESTE WEB
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** Abre "Novo tipo de operação" e só devolve o diálogo DEPOIS de a base responder às capacidades — senão a ausência
 *  do assistente seria medida antes de o editor saber com que servidor fala. */
async function abrirCriacaoComCapacidades(page: Page): Promise<Locator> {
  const capacidades = page.waitForResponse((r) => r.request().method() === "GET" && r.url().endsWith("/api/admin/tipos-operacao/capabilities"));
  await page.getByRole("button", { name: "Novo tipo de operação" }).click();
  expect((await capacidades).status(), "o editor perguntou à base as capacidades, e ela respondeu").toBe(200);
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  return forma;
}

test("OPERACOES-01 F4 · K-1 do 5 (sentido 1) — o editor deste web sobre a base: sem o `formato5`, o editor do 4 de hoje (seletor de família, Execução indisponível no pedido, ajuda antiga, grava o 4); com ele, o assistente, a ajuda nova e grava o 5", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const { mundo, capacidades } = await perguntarABase(page);
  const familias = await api<{ items: { codigo: string }[] }>(page, "GET", "/api/admin/tipos-operacao/familias");

  await abrirTelaDeTops(page);
  const codigo = codigoTopE2E();
  let id: string | null = null;
  try {
    const forma = await abrirCriacaoComCapacidades(page);
    if (mundo === "legado") {
      // O EDITOR JÁ LEU AS CAPACIDADES (a última frase do aviso só existe com o bloco do 4) — e mesmo assim não há
      // assistente: sem o bloco do 5, o editor é o do 4 de hoje, com o seletor plano de TODAS as famílias da base.
      await expect(forma.getByTestId("top-aviso-versionamento"), "premissa: o editor leu o bloco do 4 da base").toContainText(AVISO_COM_REGRAS_GERAIS);
      await expect(forma.getByTestId("top-assistente"), "sem o formato 5, nada de assistente").toHaveCount(0);
      const seletor = forma.getByTestId("top-campo-familia");
      expect(await seletor.evaluate((e) => e.tagName), "o movimento se escolhe no seletor de hoje").toBe("SELECT");
      const opcoes = await seletor.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
      expect([...opcoes].sort(), "o seletor oferece as famílias que a base devolve, como hoje").toEqual(familias.items.map((f) => f.codigo).sort());
      // A PEÇA QUE SÓ O EDITOR DO 4 TEM: a família sem execução configurada (o pedido de venda) abre a aba Execução e diz
      // por quê, com os dois efeitos presos no legado. No editor do 5 a aba some nesse tipo (W5); este é o único lugar
      // em que o editor do 4 deste web roda — e é ele que fica em produção na janela "web antes da API".
      await seletor.selectOption("vendas.pedido");
      await forma.getByTestId("top-aba-execucao").click();
      await expect(forma.getByTestId("top-execucao-familia-nao-suportada")).toContainText(MENSAGEM_EXECUCAO_NAO_DISPONIVEL);
      for (const efeito of ["estoque", "financeiro"]) {
        await expect(forma.getByTestId(`top-campo-execucao-${efeito}`), `${efeito}: fica no legado`).toHaveValue("legado");
        await expect(forma.getByTestId(`top-campo-execucao-${efeito}`), `${efeito}: sem escolha`).toBeDisabled();
      }
      await forma.getByTestId("top-aba-identificacao").click();
      await forma.getByTestId("top-campo-codigo").fill(codigo);
      await forma.getByTestId("top-campo-nome").fill(uniq("K-1 do 5 · venda pelo editor do 4"));
      await seletor.selectOption("vendas.venda");
    } else {
      // A BASE COM O 5: o passo 1, com os tipos que o catálogo DELA publica (só os com tela, na ordem dele).
      const comTela = capacidades.formato5!.catalogo.tipos.filter((t) => t.temTela).map((t) => t.familia);
      await expect(forma.getByTestId("top-assistente"), "com o formato 5, a criação começa pelo passo 1").toBeVisible();
      const oferecidas = await forma.locator("[data-testid^='top-assistente-tipo-']").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-familia")));
      expect(oferecidas, "os tipos oferecidos são os com tela do catálogo da base").toEqual(comTela);
      await escolherTipoNoAssistente(forma, "vendas.venda");
      await forma.getByTestId("top-campo-codigo").fill(codigo);
      await forma.getByTestId("top-campo-nome").fill(uniq("K-1 do 5 · venda pelo editor do 5"));
    }

    // A AJUDA DA GERAL: a deste mundo, letra por letra; a do outro, proibida.
    const [ajuda, outra] = mundo === "legado" ? [AJUDA_GERAL_DO_4, AJUDA_GERAL_DO_5] : [AJUDA_GERAL_DO_5, AJUDA_GERAL_DO_4];
    await forma.getByTestId("top-aba-geral").click();
    await expect(forma.getByText(ajuda, { exact: true }), "a ajuda da Geral é a deste mundo").toBeVisible();
    await expect(forma.getByText(outra, { exact: true }), "e não a do outro").toHaveCount(0);
    await expect(forma.getByTestId("top-campo-geral-confirmacao"), "a Geral da venda, com a Confirmação").toHaveValue("manual");

    // SALVAR: o corpo no fio é a prova do formato; o detalhe da BASE, a do que ela guardou.
    const formato = mundo === "legado" ? 4 : 5;
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await post).postDataJSON() as { codigoBase?: string; configuracao?: { versaoSchema?: number } };
    expect((await resposta).status(), "a base aceita o que este web enviou").toBe(201);
    expect(corpo.codigoBase).toBe("vendas.venda");
    expect(corpo.configuracao?.versaoSchema, `o web gravou no formato que a base deste mundo conhece (${formato})`).toBe(formato);
    await expect(forma).toBeHidden();

    id = await idPeloCodigo(page, codigo);
    expect(id, "a TOP criada pela tela existe na base").toBeTruthy();
    const d = await detalheTopNoServidor(page, id!);
    expect([d.versao, d.configuracaoSchema, d.configuracao.valor?.versaoSchema], "a base guardou a versão 1 no formato enviado").toEqual([1, formato, formato]);
  } finally {
    if (id) await excluirTopE2E(page, id);
  }
  v.semBloqueio();
});
