import { test, expect, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { api, empresaAtiva, login } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { API, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { corpoDoPost, saldoInicial, sqlE2e } from "./f10-comum";
import { animaisNovos, dietaDoSeed, empresaELocal, escolherNoCampo, loteDeAnimaisNovo } from "./f10-pecuaria-comum";

/**
 * OPERACOES-01 F10 (decisão 287) · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do web"
 * da DEPLOYMENT: banco → API → web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts`
 * comum ignora o mesmo padrão. Arquivo próprio: `skew-web-anterior.spec.ts` é compartilhado entre PRs.
 *
 * A API deste HEAD é a PREMISSA (declara `topNoModulo` nas rotas dos módulos — é ela que está sendo julgada). O MUNDO,
 * neste sentido, é o do WEB DA BASE, lido do fonte do commit montado em `.api-anterior` (`git grep` no `HEAD` dela):
 *   · a transferência de rebanho entre empresas do web da base chama `/api/livestock/transfers/to-empresa` (a marca
 *     no fonte é premissa) — rota que a API da base NÃO tinha (a tela respondia 404). Com a API deste HEAD, ela grava:
 *     201, as chaves de resposta de `/to-farm` e o movimento PENDENTE no banco. É a prova do conserto do achado;
 *   · MUNDO LEGADO (a base de hoje): o formulário embutido da batelada (aba Hoje › Produção, "Produzir") e o formulário
 *     antigo do manejo gravam 201 com as chaves de antes — corpo e resposta;
 *   · MUNDO NOVO (a base já com a F10): as Centrais da batelada e do manejo gravam 201 com as mesmas chaves de resposta.
 * O manejo daqui não tem produto: o que se mede é o contrato do corpo e da resposta, não a conta da dose (a do web da
 * base mandava a dose no lugar da cabeça — o defeito é do cliente anterior e some com o web novo; nenhum teste o
 * espera). Nenhuma requisição do cliente da base morre no navegador nem recebe erro de contrato da API nova.
 */
const ARVORE = path.resolve(__dirname, "../../..", ".api-anterior");

/** Quantas linhas do fonte do web da base contêm a marca. Erro de leitura REPROVA. */
function marcasNoWebDaBase(marca: string): number {
  try {
    return execFileSync("git", ["grep", "-c", "-F", marca, "HEAD", "--", "apps/web/src"], { cwd: ARVORE }).toString().trim().split("\n")
      .reduce((n, l) => n + Number(l.slice(l.lastIndexOf(":") + 1)), 0);
  } catch (e) {
    if ((e as { status?: number }).status === 1) return 0;
    throw new Error(`não foi possível medir a árvore da base em ${ARVORE}: ${String(e)}`);
  }
}

/**
 * O WEB DA BASE JÁ TEM AS CENTRAIS DA F10? O botão "Nova batelada" (`confinamento-nova-batelada`) e o formulário
 * embutido ("Nova batelada de dieta") são excludentes: exatamente um dos dois está no fonte, ou o mundo não se decide.
 */
function mundoDoWebDaBase(): Mundo {
  const novo = marcasNoWebDaBase("confinamento-nova-batelada");
  const antigo = marcasNoWebDaBase("Nova batelada de dieta");
  console.log(`[skew] F10 · K-2 · o web da base tem ${novo} marca(s) da Central da batelada e ${antigo} do formulário embutido`);
  expect(novo > 0 !== antigo > 0, "exatamente um dos dois mundos está no fonte do web da base").toBe(true);
  return novo > 0 ? "novo" : "legado";
}

/** A PREMISSA: a API no ar é a deste HEAD — declara a capacidade nas rotas dos módulos da pecuária. */
async function premissaDaApi(page: Page) {
  const cab = await cabecalhosDaSessao(page);
  for (const s of ["manejo", "batelada"]) {
    const r = await page.request.get(`${API}/api/modulos/${s}/operation-types`, { headers: cab });
    expect(r.status(), `premissa: a API julgada serve a capacidade de ${s}`).toBe(200);
    expect(((await r.json()) as { capacidades?: Record<string, unknown> }).capacidades?.["topNoModulo"], `premissa: ${s} declara topNoModulo`).toBe(1);
  }
}

/** O invólucro do campo do formulário antigo cujo rótulo casa com o padrão (o `<label>` e o controle têm o mesmo pai). */
const campoPeloRotulo = (raiz: Page | Locator, rotulo: RegExp) => raiz.locator("label").filter({ hasText: rotulo }).first().locator("..");

test.describe.configure({ mode: "serial" });

test("F10 · K-2 · a transferência de rebanho entre empresas do web da BASE chama /to-empresa e a API nova grava: 201 com as chaves de /to-farm e o movimento pendente", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await premissaDaApi(page);
  expect(marcasNoWebDaBase("/api/livestock/transfers/to-empresa"), "premissa: o web da base chama /to-empresa").toBeGreaterThan(0);
  const origem = await empresaAtiva(page);
  const ctx = await api<{ empresas?: { id: string }[] }>(page, "GET", "/api/auth/context");
  const destino = ctx.empresas?.find((e) => e.id !== origem)?.id;
  expect(destino, "premissa: a organização tem uma segunda empresa").toBeTruthy();
  const nomeDestino = sqlE2e(`select name from erp.empresas where id = '${destino}'`);
  const lote = await loteDeAnimaisNovo(page, origem, "K2 transferência");
  await animaisNovos(page, { empresa: origem, lote: lote.id, n: 1, marca: `K2T${Date.now().toString(36)}` });

  await page.goto("/pecuaria?tab=rebanho&sub=transferencias&action=empresas");
  const dialogo = page.getByRole("dialog");
  await expect(dialogo, "o diálogo da transferência entre empresas do web da base").toContainText("Transferência entre Empresas");
  await escolherNoCampo(page, campoPeloRotulo(dialogo, /^Empresa destino/), nomeDestino);
  await escolherNoCampo(page, campoPeloRotulo(dialogo, /^Lote(\s*\*)?$/), lote.nome);

  const escrita = corpoDoPost(page, "/api/livestock/transfers/to-empresa");
  await dialogo.getByRole("button", { name: "Transferir", exact: true }).click();
  const { corpo, status, resposta } = await escrita;
  expect([corpo["empresa_id"], corpo["empresa_destino_id"], corpo["batch_id"]], "premissa: o corpo é o desta transferência").toEqual([origem, destino, lote.id]);
  expect(status, JSON.stringify(resposta)).toBe(201);
  expect(Object.keys(resposta).sort(), "a resposta de /to-farm, chave por chave").toEqual(["animals", "code", "heads", "herd_lots", "id", "status"]);
  expect([resposta["status"], resposta["animals"], resposta["heads"]], "pendente, com o animal do lote").toEqual(["pending", 1, 1]);
  expect(sqlE2e(`select movement_type || '|' || status || '|' || empresa_id || '|' || empresa_destino_id || '|' || batch_id from erp.animal_movements where id = '${String(resposta["id"])}'`),
    "o movimento pendente da transferência, no banco").toBe(`farm_transfer|pending|${origem}|${destino}|${lote.id}`);
  v.semBloqueio();
  v.semErroDeContrato();
});

test("F10 · K-2 · a batelada do web da BASE (o formulário embutido no legado; a Central no novo) grava 201 com as chaves de antes", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await premissaDaApi(page);
  const mundo = mundoDoWebDaBase();
  const dieta = dietaDoSeed();
  const { empresa, local } = await empresaELocal(page, "K2 batelada");
  for (const i of dieta.ingredientes) await saldoInicial(page, { empresa, local: local.id, produto: i.produto, quantidade: "50", custo: "2" });

  const escrita = corpoDoPost(page, "/api/feedlot/diet-batches");
  if (mundo === "legado") {
    await page.goto("/confinamento?tab=hoje&sub=producao");
    await escolherNoCampo(page, campoPeloRotulo(page, /^Dieta(\s*\*)?$/), dieta.nome);
    await escolherNoCampo(page, campoPeloRotulo(page, /^(Armazém|Local de estoque)(\s*\*)?$/), local.nome);
    await campoPeloRotulo(page, /^kg(\s*\*)?$/).locator("input").fill("10");
    await page.getByRole("button", { name: "Produzir", exact: true }).click();
  } else {
    await page.goto("/confinamento/bateladas/new");
    await escolherNoCampo(page, page.getByTestId("central-batelada-campo-dieta"), dieta.nome);
    await escolherNoCampo(page, page.getByTestId("central-batelada-campo-local"), local.nome);
    await page.getByTestId("central-batelada-campo-quantidade").locator("input").fill("10");
    await page.getByTestId("central-batelada-salvar").click();
  }
  const { corpo, status, resposta } = await escrita;
  expect([corpo["diet_id"], corpo["warehouse_id"], corpo["quantity_kg"]], "premissa: o corpo é o desta batelada").toEqual([dieta.id, local.id, "10"]);
  if (mundo === "legado") expect(Object.keys(corpo).sort(), "o corpo de antes").toEqual(["batch_date", "diet_id", "empresa_id", "equipment_id", "quantity_kg", "warehouse_id"]);
  expect(status, JSON.stringify(resposta)).toBe(201);
  expect(Object.keys(resposta).sort(), "a resposta de antes, chave por chave").toEqual(["code", "cost_per_kg", "id", "total_cost"]);
  expect([resposta["total_cost"], resposta["cost_per_kg"]], "10 kg × 2,00").toEqual(["20.00", "2.000000"]);
  v.semBloqueio();
  v.semErroDeContrato();
});

test("F10 · K-2 · o manejo do web da BASE (o formulário antigo no legado; a Central no novo) grava 201 com as chaves de antes", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  await premissaDaApi(page);
  const mundo = mundoDoWebDaBase();
  const empresa = await empresaAtiva(page);
  const lote = await loteDeAnimaisNovo(page, empresa, "K2 manejo");
  const marca = `K2M${Date.now().toString(36)}`;
  const [animal] = await animaisNovos(page, { empresa, lote: lote.id, n: 1, marca });

  await page.goto("/pecuaria/manejo/sanitary/new");
  await page.getByPlaceholder("Buscar por brinco / identificação…").fill(marca);
  const linha = page.getByRole("row").filter({ hasText: `${marca}-1` });
  await expect(linha, "premissa: o seletor do web da base acha o animal do caso").toHaveCount(1);
  await linha.click();
  const escrita = corpoDoPost(page, "/api/livestock/handlings");
  if (mundo === "legado") await page.getByRole("button", { name: "Salvar", exact: true }).click();
  else await page.getByTestId("central-manejo-salvar").click();
  const { corpo, status, resposta } = await escrita;
  expect([corpo["handling_type"], (corpo["items"] as { animal_id: string }[]).map((i) => i.animal_id)], "premissa: o corpo é o deste manejo").toEqual(["sanitary", [animal]]);
  if (mundo === "legado") expect(Object.keys(corpo).sort(), "o corpo de antes").toEqual(["batch_id", "dose", "empresa_id", "handling_date", "handling_type", "items", "note", "product_id", "responsible", "warehouse_id"]);
  expect(status, JSON.stringify(resposta)).toBe(201);
  expect(Object.keys(resposta).sort(), "a resposta de antes, chave por chave").toEqual(["animals", "code", "id", "total", "withdrawal_until"]);
  expect([resposta["animals"], resposta["total"], resposta["withdrawal_until"]], "um animal, sem produto").toEqual([1, "0.00", null]);
  const gravado = sqlE2e(`select animals_count::text || '|' || coalesce(tipo_operacao_id::text, 'sem TOP') from erp.animal_handlings where id = '${String(resposta["id"])}'`);
  expect(gravado.split("|")[0], "o servidor gravou o manejo com um animal").toBe("1");
  if (mundo === "legado") expect(gravado, "e sem TOP: o web da base não a conhece").toBe("1|sem TOP");
  v.semBloqueio();
  v.semErroDeContrato();
});
