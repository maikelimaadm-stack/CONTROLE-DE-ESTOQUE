import { test, expect, type Locator, type Page } from "@playwright/test";
import { api, login } from "./helpers";
import { cadastroDeEstoque, criarTopDeEstoque, escolherNaReferencia, incluirItemNaCentralDeEstoque, saldoNoServidor } from "./estoque-01-comum";
import { fonteDoWebContem, shaDaBase } from "./skew-fonte-da-base";

/**
 * OPERACOES-01 · F5b · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (decisão 282, parte F5b; a janela "API
 * antes do web" da DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). Arquivo próprio: as fases desta PR correm em paralelo, e cada uma acrescenta o SEU arquivo. A
 * identidade do bundle da base é a do caso IDENTIDADE de `skew-web-anterior.spec.ts`, na MESMA execução.
 *
 * O QUE SE MEDE. A API desta fase acrescenta ao `operation-types` do estoque duas chaves ADITIVAS (`layoutDocumento` e
 * `regrasDaOperacao`, no fim do bloco, depois de `documentoEstoque` e `movimentacaoInterna`) e três rotas de LEITURA
 * (`/regras-da-operacao`, `/layout-efetivo`, `/destino/opcoes`); nenhuma rota que o web da base usa muda. O web da base
 * ignora as chaves novas: abre a Central de Estoque dele, lança uma ENTRADA com o corpo de hoje (201), confirma pela
 * prévia de hoje, e o saldo muda no servidor. A F5a já provou o resto do K-2 (`f5-estoque-skew-web-anterior.spec.ts`);
 * este caso é a prova de que as chaves da F5b não mudam nada para o cliente em produção. Nenhuma requisição morre no
 * navegador, e nenhuma resposta é erro de contrato (404, 422, 5xx).
 *
 * O MUNDO DO WEB DA BASE é LIDO DO FONTE DO COMMIT dela (`git grep` de uma marca única, nunca a worktree):
 *   · CENTRAL DE ANTES (a base de hoje, ESTOQUE-01): a grade própria, com os testids `estoque-item-*` — dirigida POR
 *     TESTID, nunca por rótulo (a base diz "Armazém" onde este HEAD diz "Local de estoque");
 *   · CENTRAL NO MOTOR (a base já com a F5b, depois do merge): a grade do motor (`central-estoque-*`).
 * Exatamente uma das duas marcas existe; nenhuma ou as duas é defeito (o detector reprova, nunca escolhe um mundo).
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

/** A marca única de cada Central no fonte do web da base. */
const MARCA_DA_CENTRAL_DE_ANTES = 'data-testid="estoque-item-adicionar"';
const MARCA_DA_CENTRAL_NO_MOTOR = 'PREFIXO_CENTRAL_ESTOQUE = "central-estoque"';

/** As chaves do CORPO DE HOJE (o da Central da base, ESTOQUE-01), por extenso. */
const CABECALHO_DE_HOJE = ["armazem_id", "data_documento", "empresa_id", "itens", "tipo_operacao_id"];

/** O fonte do web da BASE contém `trecho`? O leitor único (`fonteDoWebContem`): erro de leitura REPROVA. */
const fonteDaBaseContem = (trecho: string): boolean => fonteDoWebContem(shaDaBase(), trecho);

/** O mundo do web da base: exatamente uma das duas Centrais. */
function mundoDoWebDaBase(): "antes" | "motor" {
  const antes = fonteDaBaseContem(MARCA_DA_CENTRAL_DE_ANTES);
  const motor = fonteDaBaseContem(MARCA_DA_CENTRAL_NO_MOTOR);
  expect([antes, motor].filter(Boolean), "o web da base tem exatamente UMA Central de Estoque (a de antes ou a do motor)").toHaveLength(1);
  const mundo = antes ? "antes" : "motor";
  console.log(`[skew] F5b · K-2 · o web da base ${shaDaBase().slice(0, 7)} tem a Central de Estoque ${mundo === "antes" ? "DE ANTES (estoque-item-*)" : "NO MOTOR (central-estoque-*)"}`);
  return mundo;
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

/** Inclui o item na Central DA BASE, no mundo dela: a grade de antes (por testid) ou a do motor. */
async function incluirItemNaCentralDaBase(page: Page, mundo: "antes" | "motor", nomeProduto: string) {
  if (mundo === "antes") {
    await page.getByTestId("estoque-item-adicionar").click();
    const linha: Locator = page.getByTestId("estoque-item").first();
    await escolherNaReferencia(page, linha.getByTestId("estoque-item-produto"), nomeProduto);
    await linha.getByTestId("estoque-item-quantidade").fill("5");
    await linha.getByTestId("estoque-item-custo").fill("12,5");
    return;
  }
  await incluirItemNaCentralDeEstoque(page, { nomeProduto, quantidade: "5", custo: "12.5" });
}

test("OP01-F5b · K-2 (sentido 2) — a API deste HEAD declara as quatro chaves do estoque (as duas da F5b no fim); a Central de Estoque do web da base lança uma entrada com o corpo de hoje, confirma pela prévia de hoje, e o saldo muda no servidor", async ({ page }) => {
  await login(page);
  const mundo = mundoDoWebDaBase();
  // PREMISSA: a API no ar é a DESTA fase — as quatro chaves, nesta ordem (as aditivas da F5b no fim do bloco).
  const ops = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/estoque/entradas/operation-types");
  expect(Object.entries(ops.capacidades ?? {}), "premissa: a API deste HEAD declara documentoEstoque, movimentacaoInterna, layoutDocumento e regrasDaOperacao")
    .toEqual([["documentoEstoque", 1], ["movimentacaoInterna", 1], ["layoutDocumento", 1], ["regrasDaOperacao", 1]]);
  const { id: top } = await criarTopDeEstoque(page, "entrada");
  const c = await cadastroDeEstoque(page);
  expect(Number((await saldoNoServidor(page, c.armazem, c.produto)).quantity), "premissa: produto novo, sem saldo").toBe(0);

  const v = vigiar(page);
  // A CENTRAL DA BASE em modo criação, pela rota de hoje com a TOP.
  await page.goto(`/estoque/movimentacoes/entradas/new?tipo_operacao_id=${top}`);
  const central = page.getByTestId("estoque-central");
  await expect(central).toHaveAttribute("data-especie", "entrada");
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
  await incluirItemNaCentralDaBase(page, mundo, c.nomeProduto);

  // SALVAR: o corpo de hoje, chave por chave; a resposta do POST, as chaves de sempre.
  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/estoque/entradas");
  await page.getByTestId("estoque-salvar").click();
  const resposta = await post;
  expect(resposta.status(), `a API nova aceita o corpo do web da base: ${await resposta.text()}`).toBe(201);
  const enviado = resposta.request().postDataJSON() as Record<string, unknown>;
  expect(Object.keys(enviado).sort(), "o cabeçalho de hoje, nem uma chave a mais").toEqual(CABECALHO_DE_HOJE);
  expect(enviado, "a empresa, o local e a TOP").toMatchObject({ empresa_id: c.empresa, armazem_id: c.armazem, tipo_operacao_id: top });
  expect(enviado["itens"], "o item de hoje: produto, quantidade e custo em texto").toEqual([{ produto_id: c.produto, quantidade: "5", custo_unitario: "12.5" }]);
  const corpo = (await resposta.json()) as Record<string, unknown>;
  expect(Object.keys(corpo).sort(), "a resposta do POST tem exatamente as chaves de sempre").toEqual(["codigo", "especie", "id", "situacao"]);
  expect(corpo).toMatchObject({ especie: "entrada", situacao: "aberto" });
  const id = String(corpo["id"]);
  await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/entradas/${id}$`));
  await expect(central).toHaveAttribute("data-situacao", "aberto");
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "salvar não move o saldo").toBe("0.0000");

  // CONFIRMAR COM A PRÉVIA da base: as chaves de hoje (sem `recusas` — TOP sem formato 4 — e sem `baseDoSaldo` — não é
  // requisição), sem falta, e a confirmação vale.
  const previa = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === `/api/estoque/entradas/${id}/previa-confirmacao`);
  await page.getByTestId("estoque-confirmar").click();
  const pv = await previa;
  expect(pv.status()).toBe(200);
  expect(Object.keys((await pv.json()) as Record<string, unknown>).sort(), "a prévia tem as chaves de hoje").toEqual(["contractVersion", "documento", "itens", "podeConfirmar"]);
  await expect(page.getByTestId("estoque-previa")).toBeVisible();
  await expect(page.getByTestId("estoque-previa-item").first()).toHaveAttribute("data-insuficiente", "false");
  await page.getByTestId("estoque-previa-confirmar").click();
  await expect(central, "a API nova confirmou pelo clique do web da base").toHaveAttribute("data-situacao", "confirmado");

  // O SERVIDOR: a entrada pelo custo informado na tela da base, e o saldo.
  const lida = await api<{ situacao: string; movimentos: { movement_type: string; quantity: string; unit_cost: string }[] }>(page, "GET", `/api/estoque/entradas/${id}`);
  expect(lida.situacao).toBe("confirmado");
  expect(lida.movimentos.map((m) => [m.movement_type, m.quantity, Number(m.unit_cost)]), "a entrada de 5 pelo custo de 12,50").toEqual([["entry", "5.0000", 12.5]]);
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "o saldo mudou no servidor").toBe("5.0000");

  v.semBloqueio();
  v.semErroDeContrato();
});
