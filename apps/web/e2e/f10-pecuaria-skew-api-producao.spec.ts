import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { api, login, pickRef, uniq } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { API, MSG_ROTA_NAO_ENCONTRADA, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { corpoDoPost, saldoInicial, sqlE2e } from "./f10-comum";
import { animaisNovos, dietaDoSeed, empresaELocal, escolherNoCampo, loteDeAnimaisNovo, produtoComSaldo, produtoNovo } from "./f10-pecuaria-comum";

/**
 * OPERACOES-01 F10 (decisão 287) · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE: as Centrais do manejo, da
 * batelada e da produção de ração (a janela "web antes da API" da DEPLOYMENT, e a reversão só da API).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum. Arquivo próprio: `skew-api-producao.spec.ts` é
 * compartilhado com as fases que correm em paralelo.
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA (`mundoDaBase`): a capacidade dos módulos (`GET /api/modulos/<segmento>/
 * operation-types` — o manejo, a batelada e a produção de ração nascem no MESMO binário) e a marca no fonte da base
 * (`SEGMENTO_DO_MODULO_COM_TOP` em `apps/api/src` da árvore `.api-anterior`). As duas respostas têm de descrever o
 * mesmo binário; uma sem a outra reprova. Os dois ramos cobram prova POSITIVA:
 *   · MUNDO LEGADO (a base de hoje, sem a F10): a pergunta da capacidade que a PRÓPRIA tela faz recebe a 404 de ROTA, e
 *     a Central é a de hoje no contrato — sem o campo "Tipo de operação", sem `tipo_operacao_id` no corpo, sem a rota dos
 *     ingredientes (a batelada diz "Os ingredientes da dieta são calculados ao salvar." e não a chama), nenhum pedido a
 *     `/api/modulos/*` além do da capacidade; a base grava (201) com as chaves de hoje;
 *   · MUNDO NOVO (a base já com a F10): o campo aparece, `tipo_operacao_id` viaja, a batelada deriva a grade pelos
 *     ingredientes, e a base grava.
 * O manejo prova que o corpo NOVO é o contrato da base: 2 animais × dose 2 — cada animal vai com `quantity: "1"` (a
 * cabeça) e a base, que multiplica pela dose, baixa 4; o detalhe mostra 4. Em todos, nenhuma requisição morre no
 * navegador (`semBloqueio`). Não há mock: o servidor é o binário da base, servindo o banco migrado e semeado por este
 * HEAD, e os cadastros, os animais e o saldo nascem PELA API DA BASE.
 */
const SEGMENTOS = ["manejo", "batelada", "producao-racao"] as const;
const CHAVES_DE_HOJE = {
  manejo: ["batch_id", "dose", "empresa_id", "handling_date", "handling_type", "items", "note", "product_id", "provider_lot", "responsible", "warehouse_id"],
  batelada: ["batch_date", "diet_id", "empresa_id", "equipment_id", "quantity_kg", "warehouse_id"],
  // a validade viaja só com `loteNaEntrada`, que a base declara (o LT-K1 mede): é chave de hoje
  racao: ["batch_date", "destination_warehouse_id", "empresa_id", "formula_id", "multiplier", "origin_warehouse_id", "quantity_produced", "validade"]
} as const;

/** Quantas vezes a marca aparece no fonte da API da base (o `HEAD` da árvore `.api-anterior`). Erro de leitura REPROVA. */
function marcasNaApiDaBase(marca: string): number {
  const arvore = path.resolve(__dirname, "../../..", ".api-anterior");
  try {
    return execFileSync("git", ["grep", "-c", "-F", marca, "HEAD", "--", "apps/api/src"], { cwd: arvore }).toString().trim().split("\n")
      .reduce((n, l) => n + Number(l.slice(l.lastIndexOf(":") + 1)), 0);
  } catch (e) {
    if ((e as { status?: number }).status === 1) return 0;
    throw new Error(`não foi possível medir a árvore da base em ${arvore}: ${String(e)}`);
  }
}

/**
 * O MUNDO DA BASE, perguntado ao binário e conferido contra a árvore: as três capacidades dos módulos respondem a
 * 404 de rota (legado) ou a declaração `topNoModulo: 1` (novo) — juntas, e casando com a marca no fonte.
 */
async function mundoDaBase(page: Page): Promise<Mundo> {
  const cab = await cabecalhosDaSessao(page);
  const marcas = marcasNaApiDaBase("SEGMENTO_DO_MODULO_COM_TOP");
  const respostas = await Promise.all(SEGMENTOS.map(async (s) => {
    const r = await page.request.get(`${API}/api/modulos/${s}/operation-types`, { headers: cab });
    return { status: r.status(), corpo: await r.json() as Record<string, unknown> };
  }));
  const mundo: Mundo = respostas.every((r) => r.status === 404) ? "legado" : "novo";
  console.log(`[skew] F10 · K-1 · a API da base ${mundo === "legado" ? "NÃO tem" : "TEM"} as capacidades dos módulos (${respostas.map((r) => r.status).join(", ")}); marcas no fonte: ${marcas}`);
  if (mundo === "legado") {
    expect(respostas.map((r) => r.corpo["error"]), "a 404 é a de ROTA (chegou no fio), nas três").toEqual(SEGMENTOS.map(() => ({ code: "NOT_FOUND", message: MSG_ROTA_NAO_ENCONTRADA })));
    expect(marcas, "e o fonte da base não declara os módulos com TOP — o binário e a árvore descrevem a mesma base").toBe(0);
  } else {
    expect(respostas.map((r) => [r.status, (r.corpo["capacidades"] as Record<string, unknown> | undefined)?.["topNoModulo"]]), "as três declaram a capacidade")
      .toEqual(SEGMENTOS.map(() => [200, 1]));
    expect(marcas, "e o fonte da base declara os módulos com TOP").toBeGreaterThan(0);
  }
  return mundo;
}

/** Os pedidos a `/api/modulos/*` enquanto o caso corre (o caminho). */
function ouvirModulos(page: Page): string[] {
  const caminhos: string[] = [];
  page.on("request", (r) => { const p = new URL(r.url()).pathname; if (p.startsWith("/api/modulos/")) caminhos.push(p); });
  return caminhos;
}

test.describe.configure({ mode: "serial" });

test("F10 · K-1 · manejo sanitário: o web novo manda CABEÇAS, a base multiplica pela dose — 2 animais × 2 = 4, sem a TOP no legado", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await mundoDaBase(page);
  const modulos = ouvirModulos(page);
  const { empresa, local } = await empresaELocal(page, "K1 manejo");
  const produto = await produtoComSaldo(page, { empresa, local: local.id, rotulo: "K1 vacina", quantidade: "20", custo: "3" });
  const lote = await loteDeAnimaisNovo(page, empresa, "K1 lote");
  const animais = await animaisNovos(page, { empresa, lote: lote.id, n: 2, marca: `K1${Date.now().toString(36)}` });

  const capacidade = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/modulos/manejo/operation-types");
  await page.goto("/pecuaria/manejo/sanitary/new");
  expect((await capacidade).status(), "a tela perguntou a capacidade e a base respondeu").toBe(mundo === "legado" ? 404 : 200);
  await expect(page.getByTestId("central-manejo-identidade-nome")).toHaveText("Novo manejo sanitário");
  await expect(page.getByTestId("central-manejo-top"), mundo === "legado" ? "sem a capacidade, sem o campo" : "com a capacidade, o campo").toHaveCount(mundo === "legado" ? 0 : 1);
  await escolherNoCampo(page, page.getByTestId("central-manejo-campo-lote"), lote.nome);
  await escolherNoCampo(page, page.getByTestId("central-manejo-campo-local"), local.nome);
  await escolherNoCampo(page, page.getByTestId("central-manejo-campo-produto"), produto.nome);
  await page.getByTestId("central-manejo-campo-dose").locator("input").fill("2");
  const grade = page.getByTestId("central-manejo-animais");
  await expect(grade.getByText("Todos (2)"), "premissa: o seletor mostra os 2 animais do lote, lidos da base").toBeVisible();
  await grade.getByText("Todos (2)").click();
  await expect(page.getByTestId("central-manejo-resumo-quantidade")).toContainText("4,0000");

  const escrita = corpoDoPost(page, "/api/livestock/handlings");
  await page.getByTestId("central-manejo-salvar").click();
  const { corpo, status, resposta } = await escrita;
  expect(status, JSON.stringify(resposta)).toBe(201);
  expect(Object.keys(corpo).sort(), "as chaves de hoje (e a TOP só no mundo novo)").toEqual([...CHAVES_DE_HOJE.manejo, ...(mundo === "novo" ? ["tipo_operacao_id"] : [])].sort());
  expect((corpo["items"] as { animal_id: string; quantity: string }[]).map((i) => i.quantity), "cada animal com a CABEÇA").toEqual(["1", "1"]);
  expect((corpo["items"] as { animal_id: string }[]).map((i) => i.animal_id).sort()).toEqual([...animais].sort());
  expect(Object.keys(resposta).sort(), "a resposta de hoje").toEqual(["animals", "code", "id", "total", "withdrawal_until"]);
  expect([resposta["animals"], resposta["total"]], "a base contou 2 cabeças e baixou 4 × 3,00").toEqual([2, "12.00"]);
  const id = String(resposta["id"]);
  expect(sqlE2e(`select quantity::text from erp.stock_movements where source_type = 'animal_handlings' and source_id = '${id}'`), "a base baixou dose × cabeças = 4").toBe("4.0000");

  // da lista (para onde a Central levou) ao detalhe pela própria tela: um `goto` no meio da carga da lista abortaria os
  // pedidos dela, e o vigia não distingue pedido abortado pelo teste de pedido bloqueado no fio
  await expect(page).toHaveURL(/\/pecuaria\?tab=manejos&type=sanitary$/);
  const linha = page.getByTestId("b1-row").filter({ hasText: String(resposta["code"]) }).first();
  await expect(linha, "a lista, lida da base, mostra o manejo gravado").toBeVisible();
  await linha.click(); await page.getByLabel("Mais opções").click(); await page.getByRole("menuitem", { name: "Visualizar" }).click();
  await expect(page).toHaveURL(new RegExp(`/pecuaria/manejo/sanitary/${id}$`));
  await expect(page.locator("dt", { hasText: /^Quantidade total$/ }).locator("xpath=following-sibling::dd[1]"), "o detalhe mostra 4").toHaveText("4,0000");
  if (mundo === "legado") expect([...new Set(modulos)], "nenhum pedido a /api/modulos/* além do da capacidade").toEqual(["/api/modulos/manejo/operation-types"]);
  v.semBloqueio();
});

test("F10 · K-1 · batelada: sem a capacidade, 'Os ingredientes da dieta são calculados ao salvar.', nenhuma chamada aos ingredientes e a base grava com o corpo de hoje", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await mundoDaBase(page);
  const modulos = ouvirModulos(page);
  const dieta = dietaDoSeed();
  const { empresa, local } = await empresaELocal(page, "K1 batelada");
  for (const i of dieta.ingredientes) await saldoInicial(page, { empresa, local: local.id, produto: i.produto, quantidade: "50", custo: "2" });

  await page.goto("/confinamento/bateladas/new");
  await expect(page.getByTestId("central-batelada-identidade-nome")).toHaveText("Nova batelada");
  await escolherNoCampo(page, page.getByTestId("central-batelada-campo-dieta"), dieta.nome);
  await escolherNoCampo(page, page.getByTestId("central-batelada-campo-local"), local.nome);
  await page.getByTestId("central-batelada-campo-quantidade").locator("input").fill("10");
  if (mundo === "legado") {
    await expect(page.getByTestId("central-batelada-itens-ao-salvar"), "sem a rota dos ingredientes, a Central diz quando eles são calculados").toHaveText("Os ingredientes da dieta são calculados ao salvar.");
    await expect(page.getByTestId("central-batelada-grade"), "e não desenha grade nenhuma").toHaveCount(0);
    await expect(page.getByTestId("central-batelada-top")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("central-batelada-linha"), "com a capacidade, a grade derivada da dieta").toHaveCount(dieta.ingredientes.length);
  }

  const escrita = corpoDoPost(page, "/api/feedlot/diet-batches");
  await page.getByTestId("central-batelada-salvar").click();
  const { corpo, status, resposta } = await escrita;
  expect(status, JSON.stringify(resposta)).toBe(201);
  expect(Object.keys(corpo).sort(), "as chaves de hoje (e a TOP só no mundo novo)").toEqual([...CHAVES_DE_HOJE.batelada, ...(mundo === "novo" ? ["tipo_operacao_id"] : [])].sort());
  expect([corpo["diet_id"], corpo["warehouse_id"], corpo["quantity_kg"]]).toEqual([dieta.id, local.id, "10"]);
  expect(Object.keys(resposta).sort(), "a resposta de hoje").toEqual(["code", "cost_per_kg", "id", "total_cost"]);
  expect(sqlE2e(`select count(*) from erp.stock_movements where source_type = 'diet_batches' and source_id = '${String(resposta["id"])}'`), "a base baixou um movimento por ingrediente").toBe(String(dieta.ingredientes.length));
  if (mundo === "legado") {
    expect(modulos.filter((p) => p.includes("/dietas/")), "nenhuma chamada à rota dos ingredientes").toEqual([]);
    expect([...new Set(modulos)], "nenhum pedido a /api/modulos/* além do da capacidade").toEqual(["/api/modulos/batelada/operation-types"]);
  }
  v.semBloqueio();
});

test("F10 · K-1 · produção de ração: sem a capacidade, sem o campo e sem `tipo_operacao_id`; a base grava", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await mundoDaBase(page);
  const modulos = ouvirModulos(page);
  const { empresa, local } = await empresaELocal(page, "K1 racao");
  const materia = await produtoComSaldo(page, { empresa, local: local.id, rotulo: "K1 milho", quantidade: "10", custo: "2" });
  const acabado = await produtoNovo(page, "K1 ração acabada");
  const formula = await api<{ id: string }>(page, "POST", "/api/stock/feed-formulas", { name: uniq("F10 K1 formulação"), product_id: acabado.id, items: [{ product_id: materia.id, quantity: "1" }] });

  await page.goto("/estoque/batidas/new");
  await expect(page.getByTestId("central-racao-identidade-nome")).toHaveText("Nova produção de ração");
  await expect(page.getByTestId("central-racao-top"), mundo === "legado" ? "sem a capacidade, sem o campo" : "com a capacidade, o campo").toHaveCount(mundo === "legado" ? 0 : 1);
  await page.getByLabel("Formulação").selectOption(formula.id);
  await pickRef(page, "Local de estoque das matérias-primas", local.nome);
  await pickRef(page, "Local de estoque do produto acabado", local.nome);
  await page.getByLabel("Quantidade produzida").fill("2");
  await expect(page.getByTestId("central-racao-linha"), "a grade derivada da fórmula").toHaveCount(1);

  const escrita = corpoDoPost(page, "/api/stock/feed-batches");
  await page.getByTestId("central-racao-salvar").click();
  const { corpo, status, resposta } = await escrita;
  expect(status, JSON.stringify(resposta)).toBe(201);
  expect(Object.keys(corpo).sort(), "as chaves de hoje (e a TOP só no mundo novo)").toEqual([...CHAVES_DE_HOJE.racao, ...(mundo === "novo" ? ["tipo_operacao_id"] : [])].sort());
  expect([corpo["formula_id"], corpo["origin_warehouse_id"], corpo["destination_warehouse_id"], corpo["quantity_produced"]]).toEqual([formula.id, local.id, local.id, "2"]);
  expect(Object.keys(resposta).sort(), "a resposta de hoje").toEqual(["code", "id", "production_cost", "unit_cost"]);
  expect(resposta["production_cost"], "a base consumiu 1 × 2,00").toBe("2.00");
  if (mundo === "legado") expect([...new Set(modulos)], "nenhum pedido a /api/modulos/* além do da capacidade").toEqual(["/api/modulos/producao-racao/operation-types"]);
  v.semBloqueio();
});
