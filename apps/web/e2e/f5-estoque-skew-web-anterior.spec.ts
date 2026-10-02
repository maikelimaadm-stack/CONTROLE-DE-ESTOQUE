import { test, expect, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { configuracaoNeutraTopV4, entendeMovimentacaoInterna, familiaOperacionalDeDocumentoEstoque } from "@agro/domain";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { cadastroDeEstoque, criarTopDeEstoque, entradaConfirmadaPelaApi, escolherNaReferencia, hojeISO, saldoNoServidor } from "./estoque-01-comum";
import { garantirCommit, shaDaBase } from "./skew-fonte-da-base";

/**
 * OPERACOES-01 · F5a · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (decisão 282, parte F5a; a janela "API
 * antes do web" da DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). Arquivo próprio, e não um caso a mais em `estoque-01-skew-web-anterior.spec.ts`: as fases desta
 * PR correm em paralelo, e cada uma acrescenta o SEU arquivo. A identidade do bundle da base é a do caso IDENTIDADE de
 * `skew-web-anterior.spec.ts`, na MESMA execução.
 *
 * O QUE SE MEDE. A API desta fase é ADITIVA (capacidade `movimentacaoInterna: 1`): três espécies novas, o destino, o
 * motivo da saída, a entrada sem custo, o custo no ajuste, a origem, o encerramento do saldo e a reserva da
 * requisição no disponível. O corpo que o web da base manda para ENTRADA, SAÍDA, TRANSFERÊNCIA e AJUSTE continua aceito
 * do mesmo jeito, e as respostas que ele lê (lançar, prévia, confirmar) têm as MESMAS chaves. O navegador roda o bundle
 * EXATO da base e usa a Central de Estoque dela do jeito do usuário — POR TESTID, nunca por rótulo: a base diz
 * "Armazém" onde este HEAD diz "Local de estoque". Nenhuma requisição morre no navegador, e nenhuma resposta é erro de
 * contrato (404, 422, 5xx).
 *
 * PREMISSAS (cada caso as afirma antes de medir): o web da base TEM a Central de Estoque (a marca
 * `estoque-central-armazem` no fonte do commit da base) e a API no ar é a DESTE HEAD (declara `movimentacaoInterna`).
 *
 * DUAS TELAS DA BASE QUE A API DESTA FASE MUDA SEM MUDAR O CONTRATO (K2-d, K2-e):
 *   · o "Ajustar estoque" do Saldo da base lê `empresa_id` da linha do saldo — que a base NÃO recebia (vazio → a
 *     empresa padrão) e a API desta fase passa a mandar (a empresa do local de estoque da linha). O diálogo da base não
 *     tem testid: os rótulos e a forma dos campos usados são os do commit da base (fixo), nunca os deste HEAD;
 *   · a fila de Aprovações de estoque da base lista também as espécies novas (a rota itera as sete): a base não as
 *     conhece, então a linha aparece SEM ações (transitório até a F5b, que liga a tela delas).
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const RAIZ = path.resolve(__dirname, "../../..");

/**
 * O fonte do web (`apps/web/src`) no commit da BASE contém `trecho`? Erro de leitura REPROVA — nunca vira "não contém"
 * (o mesmo contrato de `skew-fonte-da-base.ts`, cujo leitor não é exportado).
 */
function fonteDaBaseContem(trecho: string): boolean {
  const sha = shaDaBase();
  garantirCommit(sha);
  try {
    execFileSync("git", ["grep", "-qF", trecho, sha, "--", "apps/web/src"], { cwd: RAIZ, stdio: "pipe" });
    return true;
  } catch (erro) {
    if ((erro as { status?: number | null }).status === 1) return false;
    throw erro;
  }
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
    },
  };
}

/** As premissas do mundo: a Central de Estoque existe no web da base, e a API julgada é a desta fase. */
async function premissas(page: Page) {
  expect(fonteDaBaseContem("estoque-central-armazem"), "premissa: o web da base tem a Central de Estoque (ESTOQUE-01)").toBe(true);
  const ops = await api<{ capacidades?: unknown }>(page, "GET", "/api/estoque/entradas/operation-types");
  expect(entendeMovimentacaoInterna(ops.capacidades), "premissa: a API no ar é a desta fase (declara `movimentacaoInterna`)").toBe(true);
}

type Cadastro = Awaited<ReturnType<typeof cadastroDeEstoque>>;
type EspecieDaBase = "entrada" | "saida" | "transferencia" | "ajuste";
const SEGMENTO: Record<EspecieDaBase, string> = { entrada: "entradas", saida: "saidas", transferencia: "transferencias", ajuste: "ajustes" };

/**
 * Lança e confirma pela CENTRAL DE ESTOQUE DA BASE (os passos do ES-W1/ES-W2, só por testid). A Central já está aberta em
 * modo criação. Devolve o corpo da resposta do POST (o que o web da base recebeu) e o id do documento.
 */
async function salvarEConfirmarNaCentral(page: Page, especie: EspecieDaBase, c: Cadastro, preencher: (linha: Locator) => Promise<void>, destino?: string) {
  const central = page.getByTestId("estoque-central");
  await expect(central).toHaveAttribute("data-especie", especie);
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
  if (destino) await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem-destino"), destino);
  await page.getByTestId("estoque-item-adicionar").click();
  const linha = page.getByTestId("estoque-item").first();
  await escolherNaReferencia(page, linha.getByTestId("estoque-item-produto"), c.nomeProduto);
  await preencher(linha);
  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/estoque/${SEGMENTO[especie]}`);
  await page.getByTestId("estoque-salvar").click();
  const resposta = await post;
  expect(resposta.status(), `a API nova aceita o corpo do web da base (${especie}): ${await resposta.text()}`).toBe(201);
  const corpo = (await resposta.json()) as Record<string, unknown>;
  expect(Object.keys(corpo).sort(), `${especie}: a resposta do POST tem exatamente as chaves de sempre`).toEqual(["codigo", "especie", "id", "situacao"]);
  expect(corpo).toMatchObject({ especie, situacao: "aberto" });
  await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/${SEGMENTO[especie]}/[0-9a-f-]{36}$`));
  await expect(central).toHaveAttribute("data-situacao", "aberto");

  // CONFIRMAR COM A PRÉVIA da base: a prévia (lista fechada de `movimento` na base) abre sem falta, e a confirmação vale.
  const previa = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname.endsWith("/previa-confirmacao"));
  await page.getByTestId("estoque-confirmar").click();
  const pv = await previa;
  expect(pv.status()).toBe(200);
  expect(Object.keys((await pv.json()) as Record<string, unknown>).sort(), `${especie}: a prévia tem as chaves de hoje (sem \`baseDoSaldo\`)`)
    .toEqual(["contractVersion", "documento", "itens", "podeConfirmar"]);
  await expect(page.getByTestId("estoque-previa")).toBeVisible();
  await expect(page.getByTestId("estoque-previa-item").first()).toHaveAttribute("data-insuficiente", "false");
  await page.getByTestId("estoque-previa-confirmar").click();
  await expect(central).toHaveAttribute("data-situacao", "confirmado");
  return { corpo, id: String(corpo["id"]) };
}

test.describe("OP01-F5a · K-2 (sentido 2) — a Central de Estoque do web da base contra a API deste HEAD", () => {
  test("K2-a entrada (com custo) e saída lançadas e confirmadas pela Central da base: corpo de sempre, saldo certo no servidor", async ({ page }) => {
    await login(page);
    await premissas(page);
    const { id: topEntrada } = await criarTopDeEstoque(page, "entrada");
    const { id: topSaida } = await criarTopDeEstoque(page, "saida");
    const c = await cadastroDeEstoque(page);
    expect(Number((await saldoNoServidor(page, c.armazem, c.produto)).quantity), "premissa: produto novo, sem saldo").toBe(0);

    const v = vigiar(page);
    // ENTRADA pelo `+ Novo` da aba Movimentações da base (o caminho do ES-W1).
    await page.goto("/estoque?tab=movimentacoes");
    await expect(page.getByTestId("estoque-movimentacoes"), "a aba Movimentações da base abre").toBeVisible();
    await expect(page.getByTestId("estoque-movimentacoes-indisponivel"), "a API deste HEAD serve a lista única").toHaveCount(0);
    await page.getByTestId("estoque-novo").click();
    const lancador = page.getByTestId("lancador-unificado");
    await expect(lancador).toBeVisible();
    await lancador.locator(`[data-testid="lancador-top"][data-top-id="${topEntrada}"]`).click();
    await page.getByTestId("lancador-lancar").click();
    await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/entradas/new\\?tipo_operacao_id=${topEntrada}`));
    const entrada = await salvarEConfirmarNaCentral(page, "entrada", c, async (linha) => {
      await linha.getByTestId("estoque-item-quantidade").fill("5");
      await linha.getByTestId("estoque-item-custo").fill("12,5");
    });
    const lida = await api<{ itens: { custo_unitario: string | null }[]; movimentos: { movement_type: string; unit_cost: string }[] }>(page, "GET", `/api/estoque/entradas/${entrada.id}`);
    expect(lida.movimentos.map((m) => [m.movement_type, Number(m.unit_cost)]), "a entrada vale pelo custo informado na tela da base").toEqual([["entry", 12.5]]);
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity).toBe("5.0000");

    // SAÍDA pela rota de criação da base (o caminho do ES-W2): sem motivo — o par é opcional.
    await page.goto(`/estoque/movimentacoes/saidas/new?tipo_operacao_id=${topSaida}`);
    const saida = await salvarEConfirmarNaCentral(page, "saida", c, async (linha) => {
      await linha.getByTestId("estoque-item-quantidade").fill("2");
    });
    const saidaLida = await api<{ motivo_saida: string | null; movimentos: { movement_type: string; quantity: string }[] }>(page, "GET", `/api/estoque/saidas/${saida.id}`);
    expect(saidaLida.motivo_saida, "a saída da base nasce sem motivo").toBeNull();
    expect(saidaLida.movimentos.map((m) => [m.movement_type, Number(m.quantity)])).toEqual([["writeoff", 2]]);
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "o saldo no servidor bate: 5 − 2").toBe("3.0000");

    v.semBloqueio();
    v.semErroDeContrato();
  });

  test("K2-b transferência e ajuste lançados e confirmados pela Central da base: corpo de sempre, saldos certos no servidor", async ({ page }) => {
    await login(page);
    await premissas(page);
    const { id: topEntrada } = await criarTopDeEstoque(page, "entrada");
    const { id: topTransferencia } = await criarTopDeEstoque(page, "transferencia");
    const { id: topAjuste } = await criarTopDeEstoque(page, "ajuste");
    const c = await cadastroDeEstoque(page);
    const locais = await api<{ items: { id: string; description: string }[] }>(page, "GET", `/api/resources/warehouses?empresa_id=${c.empresa}&pageSize=50`);
    const destino = locais.items.find((w) => w.id !== c.armazem);
    expect(destino, "premissa: a empresa tem um segundo local de estoque").toBeTruthy();
    await entradaConfirmadaPelaApi(page, { top: topEntrada, empresa: c.empresa, armazem: c.armazem, produto: c.produto }, "5", "10");
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "premissa: a partida é 5").toBe("5.0000");

    const v = vigiar(page);
    await page.goto(`/estoque/movimentacoes/transferencias/new?tipo_operacao_id=${topTransferencia}`);
    const transf = await salvarEConfirmarNaCentral(page, "transferencia", c, async (linha) => {
      await linha.getByTestId("estoque-item-quantidade").fill("2");
    }, destino!.description);
    const tLida = await api<{ movimentos: { movement_type: string }[] }>(page, "GET", `/api/estoque/transferencias/${transf.id}`);
    expect(tLida.movimentos.map((m) => m.movement_type).sort()).toEqual(["transfer_in", "transfer_out"]);
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "origem: 5 − 2").toBe("3.0000");
    expect((await saldoNoServidor(page, destino!.id, c.produto)).quantity, "destino: 2").toBe("2.0000");

    await page.goto(`/estoque/movimentacoes/ajustes/new?tipo_operacao_id=${topAjuste}`);
    const ajuste = await salvarEConfirmarNaCentral(page, "ajuste", c, async (linha) => {
      await linha.getByTestId("estoque-item-quantidade-contada").fill("1");
    });
    const aLida = await api<{ itens: { custo_unitario: string | null }[]; movimentos: { movement_type: string; quantity: string }[] }>(page, "GET", `/api/estoque/ajustes/${ajuste.id}`);
    expect(aLida.movimentos.map((m) => [m.movement_type, Number(m.quantity)]), "contou 1 de 3: correção para baixo de 2").toEqual([["correction_out", 2]]);
    expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "o saldo é a contagem").toBe("1.0000");

    v.semBloqueio();
    v.semErroDeContrato();
  });

  test("K2-c com uma requisição CONFIRMADA (pela API deste HEAD) no local: a lista de Movimentações e o Saldo da base abrem, e o Saldo mostra o reservado", async ({ page }) => {
    await login(page);
    await premissas(page);
    const { id: topEntrada } = await criarTopDeEstoque(page, "entrada");
    const c = await cadastroDeEstoque(page);
    await entradaConfirmadaPelaApi(page, { top: topEntrada, empresa: c.empresa, armazem: c.armazem, produto: c.produto }, "5", "10");
    // A requisição de material nasce pela API DESTE HEAD (a base não a lança), na família que o registry declara.
    const familia = familiaOperacionalDeDocumentoEstoque("requisicao");
    expect(familia, "premissa: o registry deste HEAD declara a família da requisição").toEqual(expect.any(String));
    const topRequisicao = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao",
      { codigo: `7${Math.floor(Math.random() * 900000 + 100000)}`, codigoBase: familia, nome: uniq("K2 requisição") });
    const req = await api<{ id: string; codigo: string; situacao: string }>(page, "POST", "/api/estoque/requisicoes", {
      empresa_id: c.empresa, tipo_operacao_id: topRequisicao.id, armazem_id: c.armazem, data_documento: hojeISO(),
      itens: [{ produto_id: c.produto, quantidade: "3" }],
    });
    expect(await api<{ situacao: string; movimentos: number }>(page, "POST", `/api/estoque/requisicoes/${req.id}/confirmar`, {}),
      "premissa: a requisição confirmada reserva sem mover o razão").toMatchObject({ situacao: "confirmado", movimentos: 0 });
    const doPar = await api<{ quantity: string; reservado: string; disponivel: string }>(page, "GET", `/api/stock/balances/${c.armazem}/${c.produto}`);
    expect([doPar.quantity, doPar.reservado, doPar.disponivel], "premissa: o servidor reserva 3 dos 5").toEqual(["5.0000", "3.0000", "2.0000"]);

    const v = vigiar(page);
    // A LISTA de Movimentações da base: abre, sem "indisponível", e a linha da requisição aparece (rótulo do servidor).
    await page.goto("/estoque?tab=movimentacoes");
    await expect(page.getByTestId("estoque-movimentacoes"), "a aba Movimentações da base abre").toBeVisible();
    await expect(page.getByTestId("estoque-movimentacoes-indisponivel")).toHaveCount(0);
    // O código é numerado POR ESPÉCIE (a entrada desta execução também é a 0001): a linha é a da espécie E do código.
    const linhaDaRequisicao = page.locator(`[data-testid="estoque-doc-linha"][data-especie="requisicao"][data-codigo="${req.codigo}"]`);
    await expect(linhaDaRequisicao, "a requisição aparece na lista da base, sem quebrar a lista").toBeVisible();
    await expect(linhaDaRequisicao).toHaveAttribute("data-situacao", "confirmado");

    // O SALDO da base, filtrado pelo produto: o físico 5, o reservado 3 e o disponível 2 (as colunas da reserva da base).
    await page.goto(`/estoque?tab=estoque&sub=saldo&product_id=${c.produto}`);
    const noSaldo = page.getByRole("row").filter({ hasText: c.nomeProduto }).first();
    await expect(noSaldo, "o produto aparece no Saldo da base").toBeVisible();
    await expect(noSaldo).toContainText("5,0000");
    await expect(noSaldo.getByTestId("saldo-reservado"), "o Saldo da base mostra o reservado pela requisição").toHaveText("3,0000");
    await expect(noSaldo.getByTestId("saldo-disponivel")).toHaveText("2,0000");

    v.semBloqueio();
    v.semErroDeContrato();
  });

  test("K2-d o \"Ajustar estoque\" do Saldo da base, numa linha de OUTRA empresa: o diálogo da base usa a empresa da linha (o `empresa_id` novo do saldo), e a correção vale", async ({ page }) => {
    await login(page);
    await premissas(page);
    const { id: topEntrada } = await criarTopDeEstoque(page, "entrada");
    const c = await cadastroDeEstoque(page);
    // A linha do saldo é de uma empresa que NÃO é a padrão: só assim o ajuste prova que usa a empresa da linha (a base,
    // sem a chave, cairia na empresa padrão — `useEmpresaPadrao`).
    const padrao = await empresaAtiva(page);
    const ctx = await api<{ empresas?: { id: string }[] }>(page, "GET", "/api/auth/context");
    const locais = await api<{ items: { id: string; empresa_id?: string }[] }>(page, "GET", "/api/resources/warehouses?pageSize=100");
    const outra = (ctx.empresas ?? []).map((e) => e.id).filter((id) => id !== padrao)
      .map((empresa) => ({ empresa, armazem: locais.items.find((w) => w.empresa_id === empresa)?.id }))
      .find((x) => x.armazem);
    expect(outra, "premissa: a semente tem uma segunda empresa com local de estoque").toBeTruthy();
    const { empresa, armazem } = outra as { empresa: string; armazem: string };
    await entradaConfirmadaPelaApi(page, { top: topEntrada, empresa, armazem, produto: c.produto }, "5", "10");
    const saldo = await api<{ items: { warehouse_id: string; empresa_id?: string }[] }>(page, "GET", `/api/stock/balances?product_id=${c.produto}`);
    expect(saldo.items.map((x) => [x.warehouse_id, x.empresa_id]), "premissa: a API deste HEAD manda a empresa da linha do saldo").toEqual([[armazem, empresa]]);

    const v = vigiar(page);
    await page.goto(`/estoque?tab=estoque&sub=saldo&product_id=${c.produto}`);
    const noSaldo = page.getByRole("row").filter({ hasText: c.nomeProduto }).first();
    await expect(noSaldo, "o produto aparece no Saldo da base").toBeVisible();
    await noSaldo.getByRole("button", { name: "Ajustar estoque" }).click();
    const dialogo = page.getByTestId("dialog");
    await expect(dialogo, "o diálogo de ajuste da base abre").toBeVisible();
    await dialogo.locator('input[type="number"][step="0.0001"]').fill("3");
    await dialogo.locator("textarea").fill("Contagem do K2-d");
    const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/stock/corrections");
    await dialogo.getByRole("button", { name: "Salvar" }).click();
    const resposta = await post;
    expect(resposta.status(), `a correção da base vale contra a API nova: ${await resposta.text()}`).toBe(201);
    expect(resposta.request().postDataJSON(), "o corpo da base leva a empresa DA LINHA, o local e o produto da linha")
      .toMatchObject({ empresa_id: empresa, warehouse_id: armazem, product_id: c.produto, new_quantity: "3" });
    expect((await saldoNoServidor(page, armazem, c.produto)).quantity, "o saldo é a contagem").toBe("3.0000");

    v.semBloqueio();
    v.semErroDeContrato();
  });

  test("K2-e a fila de Aprovações de estoque da base com uma requisição PENDENTE (pela API deste HEAD): a fila abre, a linha aparece sem ações; a entrada pendente, que a base conhece, tem as dela", async ({ page }) => {
    await login(page);
    await premissas(page);
    const c = await cadastroDeEstoque(page);
    // TOPs do formato 4 com "Sempre" (o molde do K-2 da TOP-CONFIG-08), uma da requisição de material e uma da entrada.
    const configuracao = { ...configuracaoNeutraTopV4(), aprovacao: { politica: "sempre" as const, valorMinimo: null, momento: "antes_da_confirmacao" as const } };
    const criarTop = async (especie: "requisicao" | "entrada") => {
      const familia = familiaOperacionalDeDocumentoEstoque(especie);
      expect(familia, `premissa: o registry declara a família de ${especie}`).toEqual(expect.any(String));
      return (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao",
        { codigo: `7${Math.floor(Math.random() * 900000 + 100000)}`, codigoBase: familia, nome: uniq(`K2-e ${especie}`), configuracao })).id;
    };
    const base = { empresa_id: c.empresa, armazem_id: c.armazem, data_documento: hojeISO() };
    const req = await api<{ id: string; situacao: string }>(page, "POST", "/api/estoque/requisicoes",
      { ...base, tipo_operacao_id: await criarTop("requisicao"), itens: [{ produto_id: c.produto, quantidade: "1" }] });
    const ent = await api<{ id: string; situacao: string }>(page, "POST", "/api/estoque/entradas",
      { ...base, tipo_operacao_id: await criarTop("entrada"), itens: [{ produto_id: c.produto, quantidade: "1", custo_unitario: "1" }] });
    try {
      const fila = await api<{ items: { id: string; especie: string; situacao: string }[] }>(page, "GET", "/api/aprovacoes/estoque?page=1&pageSize=200");
      const doServidor = (id: string) => fila.items.find((l) => l.id === id);
      expect([doServidor(req.id)?.especie, doServidor(req.id)?.situacao], "premissa: a fila do servidor tem a requisição pendente").toEqual(["requisicao", "pendente"]);
      expect([doServidor(ent.id)?.especie, doServidor(ent.id)?.situacao], "premissa: e a entrada pendente").toEqual(["entrada", "pendente"]);

      const v = vigiar(page);
      await page.goto("/aprovacoes?tab=estoque");
      await expect(page.getByTestId("aprovacoes-indisponivel"), "a API deste HEAD serve a fila da base").toHaveCount(0);
      await expect(page.getByTestId("aprovacoes-lista"), "a fila de estoque da base montou").toHaveAttribute("data-area", "estoque");
      const linha = (id: string) => page.locator(`[data-testid="aprovacao-linha"][data-id="${id}"]`);
      // PREMISSA DA AUSÊNCIA: a entrada (espécie que a base conhece) tem as ações — quem lê pode abrir e aprovar.
      await expect(linha(ent.id), "a entrada pendente aparece").toHaveAttribute("data-especie", "entrada");
      await expect(page.getByTestId(`aprovacao-aprovar-${ent.id}`), "a entrada tem Aprovar").toBeVisible();
      // A requisição aparece, sem quebrar a fila, e SEM ações (a base não conhece a espécie: nada para abrir ou decidir).
      await expect(linha(req.id), "a requisição pendente aparece na fila da base").toHaveAttribute("data-especie", "requisicao");
      await expect(page.getByTestId(`aprovacao-aprovar-${req.id}`)).toHaveCount(0);
      await expect(page.getByTestId(`aprovacao-abrir-${req.id}`)).toHaveCount(0);
      v.semBloqueio();
      v.semErroDeContrato();
    } finally {
      // A fila das próximas execuções não herda nada daqui: os dois documentos abertos são cancelados.
      await api(page, "POST", `/api/estoque/requisicoes/${req.id}/cancelar`, {}).catch(() => undefined);
      await api(page, "POST", `/api/estoque/entradas/${ent.id}/cancelar`, {}).catch(() => undefined);
    }
  });
});
