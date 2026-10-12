import type { Locator, Page, Request, Response } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { getResource } from "@agro/domain";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { test as testeDaCentral, expect, criarCadastro, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";
import { API, MSG_ROTA_NAO_ENCONTRADA, UUID_INEXISTENTE, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { cnpjDeEmitenteSintetico, eanSintetico, notaSinteticaDeVariosItens } from "./compras-f7-nfe-sintetica";

/**
 * XML-01 (decisão 312) · K1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (a janela "web antes da API" da
 * DEPLOYMENT, e a reversão só da API).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` (sem âncora: casa com o fim deste nome); o `playwright.config.ts` comum ignora o mesmo
 * padrão — este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD e o caso ficaria verde por vacuidade).
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA (`mundoDoLoteNaBase`), por duas portas que nascem no MESMO binário (XML-01): a
 * declaração `capacidades.criarProdutosDaNota` na conferência de uma importação do caso e a rota do lote,
 * `POST /api/compras/importacoes/:id/criar-produtos` (a 404 de ROTA no binário que não a tem; a recusa 422 do corpo vazio
 * no que a tem). Uma resposta sem a outra é defeito, não skew. Os ramos cobram prova POSITIVA, com a PREMISSA de que as
 * marcas novas existem no fonte deste HEAD (`git grep`) — sem ela, "não aparece" seria verde por vacuidade:
 *   · MUNDO LEGADO (a base de hoje, sem o lote): a conferência no fio SEM `capacidades` e o item sem `measurement_id`;
 *     a aba sem o botão do lote e ZERO requisição a `/criar-produtos`; o diálogo de UM item abre com o preset de hoje
 *     (descrição, NCM, código de barras — a unidade VAZIA), a pessoa escolhe a unidade, e o produto nasce (201) e vai
 *     para o item: a aba não quebra;
 *   · MUNDO NOVO (a base já com o lote): o botão do lote existe, e o diálogo de um item traz a unidade.
 * Em todos, nenhuma requisição morre no navegador (`semBloqueio`). Sem mock: o servidor é o binário da base, servindo o
 * banco migrado e semeado por este HEAD. Os cadastros nascem pela API DA BASE (limpos no fim do caso).
 */

const RAIZ = path.resolve(__dirname, "../../..");
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exato = (t: string, obrigatorio = false) => new RegExp(`^${escapar(t)}${obrigatorio ? "(\\s*\\*)?" : ""}$`);
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const DEF_PRODUTO = getResource("products");
const rotuloDe = (campo: string) => DEF_PRODUTO?.fields.find((f) => f.name === campo)?.label ?? campo;

/** A fixture: o produto que a TELA criou, excluído (lógica) no fim do caso — verde ou não. */
const test = testeDaCentral.extend<{ produtosDaTela: Set<string> }>({
  produtosDaTela: async ({ page }, use) => {
    const ids = new Set<string>();
    await use(ids);
    if (ids.size === 0) return;
    const falhas: string[] = [];
    let cabecalhos: Record<string, string> | null = null;
    try { cabecalhos = await cabecalhosDaSessao(page); } catch (e) { falhas.push(`credencial da sessão: ${mensagem(e)}`); }
    for (const id of [...ids].reverse()) {
      if (!cabecalhos) { falhas.push(`products ${id}: não excluído (sem a credencial da sessão)`); continue; }
      try {
        const r = await page.request.fetch(`${API}/api/resources/products/${id}`, { method: "DELETE", headers: cabecalhos });
        if (!r.ok()) falhas.push(`products ${id}: ${r.status()} ${(await r.text()).slice(0, 200)}`);
      } catch (e) { falhas.push(`products ${id}: ${mensagem(e)}`); }
    }
    expect(falhas, "a limpeza excluiu o produto que a tela criou").toEqual([]);
  }
});

/** O fonte do web DESTE HEAD (a árvore de trabalho, inclusive o que ainda não foi commitado) contém `trecho`? */
function fonteDoHeadContem(trecho: string): boolean {
  try {
    execFileSync("git", ["grep", "-qF", "--untracked", trecho, "--", "apps/web/src"], { cwd: RAIZ, stdio: "pipe" });
    return true;
  } catch (erro) {
    if ((erro as { status?: number | null }).status === 1) return false;   // 1 = nenhuma ocorrência; o resto é erro
    throw erro;
  }
}

/** PREMISSA anti-vacuidade: as marcas que o ramo legado cobra AUSENTES (e o preset da unidade) existem no fonte deste HEAD. */
function premissaDasMarcas() {
  for (const marca of ["data-testid=\"importacao-criar-produtos\"", "testId=\"importacao-criar-produtos-dialogo\"", "measurement_id: unidade"]) {
    expect(fonteDoHeadContem(marca), `premissa: o web deste HEAD contém ${marca}`).toBe(true);
  }
}

/** Um seletor de referência (RefSelect) dentro de `container`: abre, pesquisa e escolhe a opção de rótulo EXATO. */
async function escolher(page: Page, container: Locator, rotuloDaOpcao: string, nome: string) {
  await container.locator("[role='combobox']").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(rotuloDaOpcao);
  await painel.getByRole("option").filter({ has: page.locator("span.truncate", { hasText: exato(rotuloDaOpcao) }) }).first().click();
  await expect(container.locator("[role='combobox']").first(), `${nome}: o seletor ficou com a escolha`).not.toHaveClass(/is-empty/);
}

const campoDoFormulario = (raiz: Locator, rotulo: string) =>
  raiz.locator("label", { hasText: exato(rotulo, true) }).locator("..");

interface ConferenciaNoFio { capacidades?: unknown; itens: { nItem: number; vinculo: { situacao: string; preenchimento?: Record<string, unknown> } }[] }

/** A forma do lote numa conferência: `capacidades` (própria) e o `measurement_id` do item sem vínculo (próprio). */
function loteNaConferencia(conf: ConferenciaNoFio, unidadeEsperada: string): "ausente" | "declarado" {
  const p = conf.itens[0]?.vinculo.preenchimento ?? {};
  expect(conf.itens[0]?.vinculo.situacao, "premissa: o item 1 sem vínculo (com o pré-preenchimento)").toBe("nenhum");
  if (!Object.hasOwn(conf, "capacidades")) {
    expect(Object.hasOwn(p, "measurement_id"), "sem a capacidade, o pré-preenchimento de hoje (sem measurement_id)").toBe(false);
    return "ausente";
  }
  expect(conf.capacidades, "a capacidade declarada é a versão 1").toEqual({ criarProdutosDaNota: 1 });
  expect(p["measurement_id"], "com a capacidade, o pré-preenchimento traz a unidade do uCom").toBe(unidadeEsperada);
  return "declarado";
}

/** O MUNDO, perguntado à API da base (fora do fio do navegador): as duas portas do lote têm de descrever o MESMO binário. */
async function mundoDoLoteNaBase(page: Page, cab: Record<string, string>, importacaoId: string, unidadeEsperada: string): Promise<Mundo> {
  const c = await page.request.get(`${API}/api/compras/importacoes/${importacaoId}`, { headers: cab });
  expect(c.status(), "premissa: a base serve a conferência da importação do caso").toBe(200);
  const declarado = loteNaConferencia((await c.json()) as ConferenciaNoFio, unidadeEsperada) === "declarado";
  const porta = `/api/compras/importacoes/${UUID_INEXISTENTE}/criar-produtos`;
  const i = await page.request.post(`${API}${porta}`, { headers: { ...cab, "content-type": "application/json" }, data: {} });
  const texto = await i.text();
  let rota: boolean;
  if (i.status() === 404) {
    expect(JSON.parse(texto), `POST ${porta}: a 404 é a de ROTA (o binário não tem o lote)`).toEqual({ error: { code: "NOT_FOUND", message: MSG_ROTA_NAO_ENCONTRADA } });
    rota = false;
  } else {
    expect(i.status(), `POST ${porta} com o corpo vazio: a 404 de rota ou a recusa do corpo (422) — outra resposta é defeito: ${texto.slice(0, 300)}`).toBe(422);
    rota = true;
  }
  expect(rota, "a capacidade criarProdutosDaNota e a rota do lote nascem no MESMO binário").toBe(declarado);
  const mundo: Mundo = declarado ? "novo" : "legado";
  console.log(`[skew] XML-01 · K1 · a base ${declarado ? "DECLARA" : "NÃO declara"} criarProdutosDaNota e responde ${i.status()} a POST ${porta} → mundo ${mundo}`);
  return mundo;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K1 · A ABA DE ITENS DESTE WEB SOBRE A CONFERÊNCIA DA BASE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("XML-01 · K1 (sentido 1) — a aba de itens deste web sobre a API da base: sem a capacidade, nenhum botão do lote, ZERO requisição a /criar-produtos, e o diálogo de UM item abre com o preset de hoje (sem a unidade) e cria o produto; com ela, o botão e a unidade", async ({ page, produtosDaTela }) => {
  test.setTimeout(180_000);
  premissaDasMarcas();
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const kg = (await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options")).filter((u) => u.label.trim().toUpperCase() === "KG");
  expect(kg.map((u) => u.label), "premissa: o seed tem UMA unidade KG").toHaveLength(1);
  const rodada = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const emitente = cnpjDeEmitenteSintetico();
  await criarCadastro(page, "people", { name: uniq("XML01 K1 forn"), person_type: "legal", is_provider: true, document: emitente });
  const ean = eanSintetico();
  const item = { codigo: `K1-${rodada}-01`, descricao: `XMLK1 adubo ${rodada}`, unidade: "KG", ncm: "31052000", ean, quantidade: "100", valorUnitario: "2.50", valorProdutos: "250.00" };
  const nota = notaSinteticaDeVariosItens({ emitenteCnpj: emitente, emitenteNome: `Emitente sintético ${uniq("K1")}`, itens: [item] });
  const imp = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", { nome_arquivo: `nfe-${nota.numero}.xml`, arquivo_base64: Buffer.from(nota.xml, "utf8").toString("base64"), empresa_id: empresa });
  const mundo = await mundoDoLoteNaBase(page, cab, imp.id, kg[0]!.id);

  const v = vigiar(page);
  const pedidosAoLote: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith(API) && caminho(r).endsWith("/criar-produtos")) pedidosAoLote.push(`${r.method()} ${caminho(r)}`); });
  const leitura = page.waitForResponse((x) => x.request().method() === "GET" && caminho(x) === `/api/compras/importacoes/${imp.id}`);
  await page.goto(`/compras/importacoes/${imp.id}`);
  const lida = await leitura;
  expect(lida.status(), "a tela leu a conferência da base").toBe(200);
  expect(loteNaConferencia((await lida.json()) as ConferenciaNoFio, kg[0]!.id), `mundo ${mundo}: a conferência no fio`).toBe(mundo === "novo" ? "declarado" : "ausente");
  await expect(page.getByTestId("importacao-conferencia"), "a conferência desenhou, pendente").toHaveAttribute("data-situacao", "pendente");
  await page.getByTestId("importacao-aba-itens-rotulo").click();
  await expect(page.getByTestId("importacao-item-1"), "premissa: o item 1 desenhou, sem vínculo").toHaveAttribute("data-vinculo", "nenhum");
  await expect(page.getByTestId("importacao-item-1-criar-produto"), "premissa: o Criar produto do item (products.create) está lá").toBeVisible();
  if (mundo === "legado") {
    await expect(page.getByTestId("importacao-criar-produtos"), "sem a capacidade: nenhum botão do lote").toHaveCount(0);
    await expect(page.getByTestId("importacao-criar-produtos-dialogo")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("importacao-criar-produtos"), "com a capacidade: o botão do lote").toHaveAttribute("data-quantidade", "1");
  }

  // O DIÁLOGO DE UM ITEM: o preset; a unidade só no mundo novo.
  await page.getByTestId("importacao-item-1-criar-produto").click();
  const dialogo = page.getByTestId("importacao-cadastro-products");
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByTestId("b1-form"), "o formulário carregou").toBeVisible();
  await expect(dialogo.locator("input[name='description']"), "o preset de hoje: a descrição").toHaveValue(item.descricao);
  await expect(dialogo.getByTestId("ref-ncm-codigo").first(), "a NCM").toHaveValue(/^3105\.?20\.?00$/);
  await expect(dialogo.locator("input[name='barcode']"), "o código de barras").toHaveValue(ean);
  const campoUnidade = campoDoFormulario(dialogo, rotuloDe("measurement_id"));
  const unidadeNoForm = campoUnidade.locator("[role='combobox']").first();
  if (mundo === "legado") {
    await expect(unidadeNoForm, "sem a capacidade: a unidade vem VAZIA (o preset de hoje)").toHaveClass(/is-empty/);
    await escolher(page, campoUnidade, kg[0]!.label, "Unidade do produto");
  } else {
    await expect(unidadeNoForm, "com a capacidade: a unidade do uCom já vem").not.toHaveClass(/is-empty/);
  }
  await escolher(page, campoDoFormulario(dialogo, rotuloDe("group_id")), ref.grupo.label, "Grupo do produto");
  await dialogo.getByRole("tab", { name: "Custos e venda" }).click();
  await escolher(page, campoDoFormulario(dialogo, rotuloDe("financial_category_id")), ref.natureza.label, "Natureza de custo do produto");
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/resources/products");
  await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
  const resposta = await post;
  expect(resposta.status(), `a base cria o produto: ${resposta.status()}`).toBe(201);
  const row = (await resposta.json()) as { id: string; description: string };
  produtosDaTela.add(row.id);
  expect(resposta.request().postDataJSON(), "o produto com a nota e a unidade").toMatchObject({ description: item.descricao, ncm_code: item.ncm, barcode: ean, measurement_id: kg[0]!.id });
  await expect(dialogo, "o diálogo fecha").toBeHidden();
  await expect(page.getByTestId("importacao-item-1-produto").locator("[role='combobox']").first(), "a aba não quebra: o item recebe o produto").toContainText(row.description);

  if (mundo === "legado") expect(pedidosAoLote, "ZERO requisição a /criar-produtos").toEqual([]);
  v.semBloqueio();
});
