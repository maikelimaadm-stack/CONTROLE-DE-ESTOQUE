import type { Page, Request, Response } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { test, expect, codigoTop, criarTop } from "./central-compras-fixtures";
import { API, MSG_ROTA_NAO_ENCONTRADA, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { arquivoDaNota, cnpjDeEmitenteSintetico, notaSintetica } from "./compras-f7-nfe-sintetica";

/**
 * OPERACOES-01 · F7 (decisão 284) · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (a janela "web antes da
 * API" da DEPLOYMENT, e a reversão só da API).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD e o caso ficaria
 * verde por vacuidade). Arquivo próprio: os specs de skew compartilhados ficam como estão. Sem `scripts/lib` e sem passo
 * no CI: o arquivo entra pelo nome (o molde da F6b e da TOP-CONFIG-08).
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA (`mundoDaF7NaBase`), por duas portas que nascem no MESMO binário (a F7): a
 * declaração `capacidades.importacaoXml` em `GET /api/compras/compras/operation-types` e a porta da importação,
 * `POST /api/compras/importacoes` (a 404 de ROTA no binário que não a tem; a recusa 422 do corpo vazio no que a tem).
 * Uma resposta sem a outra é defeito, não skew. Os ramos cobram prova POSITIVA, com a PREMISSA de que as marcas novas
 * existem no fonte deste HEAD (`git grep`) — sem ela, "não aparece" seria verde por vacuidade:
 *   · MUNDO LEGADO (a base de hoje, sem a F7): Documentos de Compras sem "Importar XML" e `?importar=xml` sem diálogo;
 *     a criação da compra sem o bloco "Dados fiscais" (com os Dados adicionais ABERTOS); a DF-e registrada pela tela
 *     deste web SEM `xml` no corpo (o XML só pré-preenche, como hoje — sem a capacidade, nada de contrato novo) → 201
 *     da base (a resposta de hoje, só o `id`), e o "Lançar" é o link de hoje para o Documento fiscal de Estoque; ZERO
 *     pedido a `/api/compras/importacoes` no fio;
 *   · MUNDO NOVO (a base já com a F7): o botão, o bloco fiscal, a DF-e com o XML guardado (`xml_id`) e o "Lançar"
 *     pela importação.
 * Em todos, nenhuma requisição morre no navegador (`semBloqueio`). Sem mock: o servidor é o binário da base, servindo
 * o banco migrado e semeado por este HEAD. A TOP nasce pela API DA BASE (`criarTop`, excluída no fim do caso).
 */

const P = "central-compras";
const RAIZ = path.resolve(__dirname, "../../..");
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const PORTA_DA_CAPACIDADE = "/api/compras/compras/operation-types";
const PORTA_DA_IMPORTACAO = "/api/compras/importacoes";
/** As capacidades de compras que vêm antes da F7, na ordem (a da F7 só pode vir DEPOIS delas). */
const CAPACIDADES_DE_ANTES = ["classificacaoFinanceira", "condicaoPagamento", "layoutDocumento", "regrasDaOperacao"];

type OperationTypes = { contractVersion?: unknown; capacidades?: Record<string, unknown> };

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

/** PREMISSA anti-vacuidade: as marcas que o ramo legado cobra AUSENTES existem no fonte deste HEAD. */
function premissaDasMarcas() {
  for (const marca of ["data-testid=\"compras-importar-xml\"", "data-testid=\"compras-dados-fiscais\"", "data-testid=\"dfe-lancar-importacao\"", "data-testid=\"importacao-upload\""]) {
    const testId = /"([^"]+)"/.exec(marca)![1]!;
    expect(fonteDoHeadContem(testId), `premissa: o testid ${testId} existe no web deste HEAD`).toBe(true);
  }
}

/** A capacidade no corpo de `/operation-types`: o contrato 1, as capacidades de antes na ordem, e `importacaoXml` ausente ou 1. */
function capacidadeDoCorpo(corpo: OperationTypes, contexto: string): "ausente" | "declarada" {
  expect(corpo.contractVersion, `${contexto}: o contrato que o web lê é o 1`).toBe(1);
  expect(Object.keys(corpo.capacidades ?? {}).slice(0, 4), `${contexto}: as capacidades de antes, na ordem`).toEqual(CAPACIDADES_DE_ANTES);
  if (!Object.hasOwn(corpo.capacidades ?? {}, "importacaoXml")) return "ausente";
  expect(corpo.capacidades?.["importacaoXml"], `${contexto}: a capacidade da F7 declarada é a versão 1`).toBe(1);
  return "declarada";
}

/** O MUNDO, perguntado à API da base (fora do fio do navegador): as duas portas da F7 têm de descrever o MESMO binário. */
async function mundoDaF7NaBase(page: Page, cab: Record<string, string>): Promise<Mundo> {
  const r = await page.request.get(`${API}${PORTA_DA_CAPACIDADE}`, { headers: cab });
  expect(r.status(), `premissa: a base serve ${PORTA_DA_CAPACIDADE}`).toBe(200);
  const capacidade = capacidadeDoCorpo((await r.json()) as OperationTypes, PORTA_DA_CAPACIDADE);
  const i = await page.request.post(`${API}${PORTA_DA_IMPORTACAO}`, { headers: { ...cab, "content-type": "application/json" }, data: {} });
  const texto = await i.text();
  let porta: "ausente" | "presente";
  if (i.status() === 404) {
    expect(JSON.parse(texto), `POST ${PORTA_DA_IMPORTACAO}: a 404 é a de ROTA (o binário não tem a porta)`).toEqual({ error: { code: "NOT_FOUND", message: MSG_ROTA_NAO_ENCONTRADA } });
    porta = "ausente";
  } else {
    expect(i.status(), `POST ${PORTA_DA_IMPORTACAO} com o corpo vazio: a 404 de rota ou a recusa do corpo (422) — outra resposta é defeito: ${texto.slice(0, 300)}`).toBe(422);
    porta = "presente";
  }
  expect(porta === "presente", "a capacidade importacaoXml e a porta da importação nascem no MESMO binário").toBe(capacidade === "declarada");
  const mundo: Mundo = capacidade === "declarada" ? "novo" : "legado";
  console.log(`[skew] OPERACOES-01 F7 · K-1 · a base ${capacidade === "declarada" ? "DECLARA" : "NÃO declara"} importacaoXml e responde ${i.status()} a POST ${PORTA_DA_IMPORTACAO} → mundo ${mundo}`);
  return mundo;
}

/** O fio da página: cada requisição à API (método e caminho) e cada resposta, enquanto o caso corre. */
function ouvirFio(page: Page) {
  const requisicoes: { metodo: string; caminho: string }[] = [];
  page.on("request", (r) => { if (r.url().startsWith(API)) requisicoes.push({ metodo: r.method(), caminho: caminho(r) }); });
  return { requisicoes, daImportacao: () => requisicoes.filter((r) => r.caminho.startsWith(PORTA_DA_IMPORTACAO)).map((r) => `${r.metodo} ${r.caminho}`) };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K1-1 · DOCUMENTOS DE COMPRAS E A CRIAÇÃO DA COMPRA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F7 · K1-1 (sentido 1) — Documentos de Compras e a criação da compra deste web sobre a API da base: sem a capacidade, sem 'Importar XML' (nem por ?importar=xml) e sem o bloco 'Dados fiscais'; nenhum pedido à importação; com ela, os dois", async ({ page }) => {
  premissaDasMarcas();
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const mundo = await mundoDaF7NaBase(page, cab);
  const nomeDaTop = uniq("F7 K1-1 compra");
  const top = (await criarTop(page, { codigo: codigoTop("7k1"), codigoBase: "compras.compra", nome: nomeDaTop })).id;

  const v = vigiar(page);
  const fio = ouvirFio(page);

  // (1) DOCUMENTOS, já com ?importar=xml: a capacidade perguntada no fio (a premissa do ramo) e o botão.
  const capacidadeNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === PORTA_DA_CAPACIDADE);
  await page.goto("/compras?tab=documentos&importar=xml");
  const ot = await capacidadeNoFio;
  expect(ot.status(), "a tela perguntou a capacidade à base").toBe(200);
  expect(capacidadeDoCorpo((await ot.json()) as OperationTypes, "o operation-types que a tela recebeu"), `mundo ${mundo}: a capacidade no fio`)
    .toBe(mundo === "novo" ? "declarada" : "ausente");
  await expect(page.getByTestId("compras-documentos"), "premissa: a aba Documentos desenhou").toBeVisible();
  await expect(page.getByTestId("compras-novo"), "premissa: a barra dos Documentos desenhou (o Novo)").toBeVisible();
  await page.waitForLoadState("networkidle");
  if (mundo === "legado") {
    await expect(page.getByTestId("compras-importar-xml"), "sem a capacidade: nenhum 'Importar XML'").toHaveCount(0);
    await expect(page.getByTestId("importacao-upload"), "e ?importar=xml não abre diálogo nenhum").toHaveCount(0);
  } else {
    await expect(page.getByTestId("compras-importar-xml"), "com a capacidade: o 'Importar XML'").toBeVisible();
    await expect(page.getByTestId("importacao-upload"), "e ?importar=xml abre o diálogo").toBeVisible();
    await page.keyboard.press("Escape");
  }

  // (2) A CRIAÇÃO DA COMPRA. O bloco fiscal mora DENTRO dos Dados adicionais (que só existem quando há campo a
  //     recolher). PREMISSA: os Dados desenharam com a TOP travada (o desenho em que o bloco nasceria). Legado: nada de
  //     Dados fiscais — e, havendo os Dados adicionais, ABERTOS, também nada lá dentro. Novo: os Dados adicionais
  //     existem (os campos fiscais contam) e, abertos, mostram o bloco.
  await page.goto(`/compras/compras/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  const dados = page.getByTestId(`${P}-dados`);
  await expect(dados, "premissa: os Dados desenharam com a TOP travada").toContainText(nomeDaTop);
  await page.waitForLoadState("networkidle");
  const grupo = dados.getByRole("button", { name: /^Dados adicionais/ });
  if (mundo === "novo") await expect(grupo, "com a capacidade, os Dados adicionais existem (os campos fiscais)").toHaveCount(1);
  if ((await grupo.count()) > 0) {
    if ((await grupo.getAttribute("aria-expanded")) !== "true") await grupo.click();
    await expect(grupo, "premissa: os Dados adicionais estão abertos").toHaveAttribute("aria-expanded", "true");
  }
  if (mundo === "legado") await expect(page.getByTestId("compras-dados-fiscais"), "sem a capacidade: nada de Dados fiscais").toHaveCount(0);
  else await expect(page.getByTestId("compras-dados-fiscais"), "com a capacidade: o bloco Dados fiscais").toBeVisible();

  // (3) O FIO: a tela falou com a base (premissa) e, sem a capacidade, nunca com a importação.
  expect(fio.requisicoes.some((r) => r.caminho === PORTA_DA_CAPACIDADE), "premissa: o fio registrou a pergunta da capacidade").toBe(true);
  if (mundo === "legado") expect(fio.daImportacao(), "ZERO pedido a /api/compras/importacoes").toEqual([]);
  v.semBloqueio();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K1-2 · A DF-e REGISTRADA COM O XML E O "LANÇAR"
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F7 · K1-2 (sentido 1) — a DF-e registrada pela tela deste web: sem a capacidade, o corpo de hoje (o XML só pré-preenche, nada de `xml`), 201 como hoje e o 'Lançar' é o link de hoje; nenhum pedido à importação; com a capacidade, o XML no corpo, guardado, e o 'Lançar' pela importação", async ({ page }) => {
  premissaDasMarcas();
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const mundo = await mundoDaF7NaBase(page, cab);
  const empresa = await empresaAtiva(page);
  const contexto = await api<{ empresas?: { id: string; name: string }[] }>(page, "GET", "/api/auth/context");
  const nomeDaEmpresa = contexto.empresas?.find((x) => x.id === empresa)?.name;
  expect(nomeDaEmpresa, "premissa: a empresa ativa está no contexto").toBeTruthy();
  const nota = notaSintetica({ emitenteCnpj: cnpjDeEmitenteSintetico(), emitenteNome: `Emitente sintético ${uniq("K1-2")}` });

  const v = vigiar(page);
  const fio = ouvirFio(page);
  await page.goto("/estoque?tab=recebimentos&sub=dfe");
  await page.getByRole("button", { name: "Importar DFe" }).click();
  const dialogo = page.getByTestId("dialog").filter({ hasText: "Registrar DFe recebida" });
  await expect(dialogo).toBeVisible();
  await dialogo.locator("input[type=file]").setInputFiles(arquivoDaNota(nota));
  await expect(dialogo.locator("label", { hasText: "Chave de acesso" }).locator("..").locator("input"), "o pré-preenchimento de hoje").toHaveValue(nota.chave);
  // Sem a capacidade, o diálogo não promete guardar o XML (ele não vai no corpo); com ela, promete e manda.
  if (mundo === "legado") await expect(dialogo.getByTestId("dfe-xml-anexado"), "sem a capacidade: nada de 'o XML vai junto'").toHaveCount(0);
  else await expect(dialogo.getByTestId("dfe-xml-anexado"), "com a capacidade: o XML vai no corpo").toBeVisible();
  // A empresa do registro (com o XML, a API da F7 resolve o destinatário — o seed tem duas empresas com o CNPJ).
  await dialogo.locator("label", { hasText: /^Empresa$/ }).locator("..").locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nomeDaEmpresa!.slice(0, 20));
  await painel.getByRole("option", { name: new RegExp(nomeDaEmpresa!.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first().click();

  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/stock/dfe");
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  const r = await post;
  const enviado = r.request().postDataJSON() as Record<string, unknown>;
  if (mundo === "legado") expect(Object.hasOwn(enviado, "xml"), "sem a capacidade: o corpo de hoje, sem `xml`").toBe(false);
  else expect(enviado["xml"], "com a capacidade: o XML foi no corpo").toBe(nota.xml);
  expect(enviado, "com a chave e a empresa").toMatchObject({ access_key: nota.chave, empresa_id: empresa });
  expect(r.status(), `mundo ${mundo}: a base registra a DF-e (201)`).toBe(201);
  const corpo = (await r.json()) as Record<string, unknown>;
  if (mundo === "legado") expect(Object.keys(corpo), "a resposta de hoje, só o id").toEqual(["id"]);
  else expect(Object.keys(corpo), "com a F7, o XML guardado").toEqual(["id", "xml_id"]);

  // A LINHA DA DF-e: o "Lançar".
  await page.getByLabel("Chave/Emitente/Número").fill(nota.chave);
  await page.getByLabel("Chave/Emitente/Número").press("Enter");
  const linha = page.locator("tr", { hasText: nota.chave });
  await expect(linha, "premissa: a DF-e registrada está na fila").toHaveCount(1);
  await page.waitForLoadState("networkidle");
  if (mundo === "legado") {
    await expect(linha.getByTestId("dfe-lancar-importacao"), "sem a capacidade: nada de Lançar pela importação").toHaveCount(0);
    await expect(linha.locator(`a[href="/estoque/documentos-fiscais/new?dfe_id=${String(corpo["id"])}"]`), "o Lançar de hoje: o link do Documento fiscal de Estoque").toHaveCount(1);
    expect(fio.daImportacao(), "ZERO pedido a /api/compras/importacoes").toEqual([]);
  } else {
    await expect(linha.getByTestId("dfe-lancar-importacao"), "com a capacidade e o XML guardado: o Lançar pela importação").toBeVisible();
  }
  v.semBloqueio();
});
