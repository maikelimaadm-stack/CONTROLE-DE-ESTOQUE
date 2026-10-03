import type { Locator, Page, Response } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { api, empresaAtiva, login, uniq } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import { vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { garantirCommit, shaDaBase } from "./skew-fonte-da-base";
import { arquivoDaNota, cnpjDeEmitenteSintetico, notaSintetica } from "./compras-f7-nfe-sintetica";

/**
 * OPERACOES-01 · F7 (decisão 284) · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do web"
 * da DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). Arquivo próprio: os specs de skew compartilhados ficam como estão.
 *
 * O QUE SE MEDE. A API da F7 é ADITIVA: a compra ganha colunas (nulas na compra de hoje), a leitura ganha chaves só
 * quando há o que dizer, a DF-e ganha `xml_id` (nulo sem XML) e `operation-types` ganha `importacaoXml` no FIM. O
 * navegador roda o bundle EXATO da base, que não conhece nada disso, e faz pela tela dela o que faz hoje:
 *   · K2-1 a Central de Compras da base lança uma compra (o corpo de hoje, sem nenhuma chave da F7, aceito: 201) e a
 *     consulta da base abre a compra; a leitura que ela recebe tem as chaves NOVAS todas nulas e nenhuma derivada;
 *   · K2-2 a DF-e registrada pela tela da base (o XML lido no navegador, só o pré-preenchimento — sem `xml` no corpo):
 *     201 com a resposta de hoje (só o `id`), e o "Lançar" da base é o link de hoje.
 * PREMISSA: a API julgada é a desta fase (declara `importacaoXml` = 1). O VIGIA: nenhuma resposta 404/422/5xx da API
 * nova ao cliente da base e nenhuma requisição morta. O mundo do WEB DA BASE é medido no fonte do commit da base
 * (`git grep` de uma marca da F7): com a base já na F7 (depois do merge), a DF-e dela manda o XML e a resposta traz o
 * `xml_id` — o ramo cobra isso.
 *
 * OS DADOS nascem pela API DESTE HEAD (as portas de `central-compras-fixtures`, com a exclusão lógica no fim do caso);
 * os documentos ficam (ledger; decisão 247). Os seletores são os da base (622f194), conferidos nos K-2 da F2 e da F6b.
 */

const PC = "central-compras";
const RAIZ = path.resolve(__dirname, "../../..");
const caminho = (r: Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/** As colunas que a 0047 acrescenta à compra e ao item (na compra de hoje, todas nulas). */
const NOVAS_DO_CABECALHO = ["chave_acesso", "uf_nota", "tipo_documento_fiscal", "valor_ipi", "valor_icms_st", "seguro", "tipo_titulo_id", "classificacao_gasto", "rateio_tipo", "parcelas_nota", "dfe_id", "solicitacao_compra_id"];
const NOVAS_DO_ITEM = ["gera_estoque", "imobilizado", "bem_id", "categoria_financeira_id", "centro_custo_id", "valor_ipi", "valor_icms_st", "n_item_nota", "codigo_produto_nota", "descricao_produto_nota", "unidade_nota", "quantidade_nota", "fator_conversao", "tipo_fator_conversao"];
/** As chaves DERIVADAS da leitura, que só existem quando há o que dizer (nunca na compra de hoje). */
const DERIVADAS_DO_CABECALHO = ["rateio", "tipo_titulo_nome", "importacao_id", "dfe"];
/** As chaves do corpo que a F7 acrescenta (o web da base não as conhece). */
const DA_F7_NO_CORPO = [...NOVAS_DO_CABECALHO.filter((k) => k !== "rateio_tipo" && k !== "parcelas_nota" && k !== "dfe_id" && k !== "solicitacao_compra_id"), "rateio"];
const DA_F7_NO_ITEM = ["gera_estoque", "imobilizado", "categoria_financeira_id", "centro_custo_id", "valor_ipi", "valor_icms_st"];

/** O web da base já tem a F7? Medido no fonte do commit da base (`git grep` da marca do "Importar XML"); erro de leitura REPROVA. */
function mundoDoWebDaBase(): Mundo {
  const sha = shaDaBase();
  garantirCommit(sha);
  try {
    execFileSync("git", ["grep", "-qF", "compras-importar-xml", sha, "--", "apps/web/src"], { cwd: RAIZ, stdio: "pipe" });
    return "novo";
  } catch (erro) {
    if ((erro as { status?: number | null }).status === 1) return "legado";
    throw erro;
  }
}

/** A API deste HEAD declara a capacidade da F7 (as capacidades de antes, na ordem de antes, e a nova no fim): a premissa do sentido 2. */
async function premissaDaApi(page: Page) {
  const ot = await api<{ contractVersion: number; capacidades: Record<string, unknown> }>(page, "GET", "/api/compras/compras/operation-types");
  expect(ot.contractVersion, "o contrato que a base lê continua o 1").toBe(1);
  const chaves = Object.keys(ot.capacidades);
  expect(chaves.slice(0, 4), "as quatro capacidades de hoje, na ordem de hoje").toEqual(["classificacaoFinanceira", "condicaoPagamento", "layoutDocumento", "regrasDaOperacao"]);
  expect(chaves.at(-1), "a capacidade da F7 entra no FIM do bloco").toBe("importacaoXml");
  expect(ot.capacidades["importacaoXml"], "premissa: a API julgada é a desta fase (declara importacaoXml)").toBe(1);
}

/** Escolhe no RefSelect da Central de Compras da base pelo rótulo do campo. */
async function escolher(page: Page, rotulo: string, nome: string) {
  const campo = page.getByTestId("compras-central").locator("label", { hasText: rotulo }).first().locator("..");
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/** Escolhe na pesquisa do motor ancorada à célula (produto ou local de estoque) da linha da base — pelo nome inteiro. */
async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const pesquisa = page.getByTestId(`${PC}-pesquisa`);
  await expect(pesquisa).toBeVisible();
  await pesquisa.getByPlaceholder("Pesquisar pela descrição").fill(nome);
  await pesquisa.getByRole("option", { name: literal(nome) }).first().click();
  await expect(pesquisa).toHaveCount(0);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K2-1 · A CENTRAL DE COMPRAS DA BASE LANÇA A COMPRA DE HOJE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F7 · K2-1 (sentido 2) — a Central de Compras da base lança a compra de hoje contra a API deste HEAD: o corpo sem nenhuma chave da F7 é aceito (201), a consulta da base abre a compra, e a leitura traz as colunas novas nulas e nenhuma chave derivada", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  await login(page);
  await premissaDaApi(page);
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const p = await criarCadastro(page, "products", { description: uniq("F7K2 produto"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id });
  const nomeProduto = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`))["description"]);
  const arm = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `Y${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("F7K2 local"), type: "inputs" });
  const nomeLocal = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]);
  const forn = await criarCadastro(page, "people", { name: uniq("F7K2 forn"), person_type: "legal", is_provider: true });
  const nomeFornecedor = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${forn.id}`))["name"]);
  const top = (await criarTop(page, { codigo: codigoTop("7k2"), codigoBase: "compras.compra", nome: uniq("F7 K2-1 compra") })).id;

  const v = vigiar(page);
  await page.goto(`/compras/compras/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId("compras-central")).toHaveAttribute("data-especie", "compra");
  await expect(page.getByTestId("compras-salvar"), "o Salvar saiu da trava: as regras chegaram").toBeEnabled();
  await escolher(page, "Fornecedor", nomeFornecedor);
  await escolher(page, "Natureza de despesa", ref.natureza.label);
  await escolher(page, "Centro de resultado", ref.centro.label);
  await page.getByTestId(`${PC}-adicionar-item`).click();
  const linha = page.getByTestId(`${PC}-linha`).first();
  await escolherNaCelula(page, linha.getByTestId(`${PC}-produto`), nomeProduto);
  await escolherNaCelula(page, linha.getByTestId(`${PC}-armazem`), nomeLocal);
  await linha.getByLabel("Quantidade do item 1").fill("4");
  await linha.getByLabel("Valor unitário do item 1").fill("25");
  await expect(page.getByTestId("compras-total")).toContainText("100,00");

  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/compras/compras");
  await page.getByTestId("compras-salvar").click();
  const r = await post;
  expect(r.status(), "a API nova aceita o corpo do web da base").toBe(201);
  const enviado = r.request().postDataJSON() as Record<string, unknown> & { itens: Record<string, unknown>[] };
  if (mundo === "legado") {
    for (const k of DA_F7_NO_CORPO) expect(Object.hasOwn(enviado, k), `o corpo da base não leva ${k}`).toBe(false);
    for (const k of DA_F7_NO_ITEM) expect(Object.hasOwn(enviado.itens[0]!, k), `o item da base não leva ${k}`).toBe(false);
  }
  expect(enviado, "os valores que a tela mostrou").toMatchObject({ tipo_operacao_id: top, fornecedor_id: forn.id, categoria_financeira_id: ref.natureza.id, centro_custo_id: ref.centro.id });
  const criada = (await r.json()) as { id: string };

  // A CONSULTA DA BASE abre a compra; a LEITURA que ela recebeu (no fio): as colunas novas nulas, nenhuma derivada.
  const leituraNoFio = page.waitForResponse((x) => x.request().method() === "GET" && caminho(x) === `/api/compras/compras/${criada.id}`);
  await expect(page).toHaveURL(new RegExp(`/compras/compras/${criada.id}$`));
  await expect(page.getByTestId("compras-consulta-corpo"), "a consulta da base abre a compra aberta").toHaveAttribute("data-situacao", "aberto");
  const leitura = await leituraNoFio;
  expect(leitura.status()).toBe(200);
  const lida = (await leitura.json()) as Record<string, unknown> & { itens: Record<string, unknown>[] };
  expect(Object.fromEntries(NOVAS_DO_CABECALHO.map((k) => [k, lida[k]])), "as colunas novas do cabeçalho: presentes e nulas na compra de hoje")
    .toEqual(Object.fromEntries(NOVAS_DO_CABECALHO.map((k) => [k, null])));
  for (const k of DERIVADAS_DO_CABECALHO) expect(Object.hasOwn(lida, k), `a chave derivada ${k} não existe na compra de hoje`).toBe(false);
  expect(lida.itens.map((i) => Object.fromEntries(NOVAS_DO_ITEM.map((k) => [k, i[k]]))), "as colunas novas do item: nulas")
    .toEqual([Object.fromEntries(NOVAS_DO_ITEM.map((k) => [k, null]))]);
  expect(Object.hasOwn(lida.itens[0]!, "bem_codigo"), "nem o bem do item").toBe(false);
  expect(lida, "e os valores de hoje: o total sem IPI, ST nem seguro").toMatchObject({ situacao: "aberto", valor_itens: "100.00", valor_total: "100.00", fornecedor_id: forn.id });
  v.semBloqueio();
  v.semErroDeContrato();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K2-2 · A DF-e REGISTRADA PELA TELA DA BASE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("OP01-F7 · K2-2 (sentido 2) — a DF-e registrada pela tela da base (sem o XML no corpo) contra a API deste HEAD: 201 com a resposta de hoje, e o 'Lançar' da base é o link de hoje", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  await login(page);
  await premissaDaApi(page);
  const empresa = await empresaAtiva(page);
  const contexto = await api<{ empresas?: { id: string; name: string }[] }>(page, "GET", "/api/auth/context");
  const nomeDaEmpresa = contexto.empresas?.find((x) => x.id === empresa)?.name;
  expect(nomeDaEmpresa, "premissa: a empresa ativa está no contexto").toBeTruthy();
  const nota = notaSintetica({ emitenteCnpj: cnpjDeEmitenteSintetico(), emitenteNome: `Emitente sintético ${uniq("K2-2")}` });

  const v = vigiar(page);
  await page.goto("/estoque?tab=recebimentos&sub=dfe");
  await page.getByRole("button", { name: "Importar DFe" }).click();
  const dialogo = page.getByTestId("dialog").filter({ hasText: "Registrar DFe recebida" });
  await expect(dialogo).toBeVisible();
  await dialogo.locator("input[type=file]").setInputFiles(arquivoDaNota(nota));
  await expect(dialogo.locator("label", { hasText: "Chave de acesso" }).locator("..").locator("input"), "a base pré-preenche pelo XML lido no navegador").toHaveValue(nota.chave);
  await dialogo.locator("label", { hasText: /^Empresa$/ }).locator("..").locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nomeDaEmpresa!.slice(0, 20));
  await painel.getByRole("option", { name: literal(nomeDaEmpresa!.slice(0, 20)) }).first().click();

  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === "/api/stock/dfe");
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  const r = await post;
  expect(r.status(), "a API nova registra a DF-e da base (201)").toBe(201);
  const enviado = r.request().postDataJSON() as Record<string, unknown>;
  const corpo = (await r.json()) as Record<string, unknown>;
  expect(enviado, "o corpo da base: a chave e a empresa").toMatchObject({ access_key: nota.chave, empresa_id: empresa });
  if (mundo === "legado") {
    expect(Object.hasOwn(enviado, "xml"), "o web da base não manda o XML").toBe(false);
    expect(Object.keys(corpo), "sem XML, a resposta de hoje: só o id").toEqual(["id"]);
  } else {
    expect(enviado["xml"], "o web da base (já na F7) manda o XML").toBe(nota.xml);
    expect(Object.keys(corpo), "e a API guarda o XML").toEqual(["id", "xml_id"]);
  }
  const dfe = await api<{ items: Record<string, unknown>[] }>(page, "GET", `/api/stock/dfe?search=${nota.chave}`);
  const registrada = dfe.items.find((x) => x["id"] === corpo["id"]);
  expect(registrada, "a DF-e está na fila").toBeTruthy();
  expect(registrada, "registrada como hoje: a chave, o número, a empresa, pendente de lançamento").toMatchObject({ access_key: nota.chave, number: nota.numero, empresa_id: empresa, launch_status: "pending" });
  if (mundo === "legado") expect(registrada!["xml_id"], "sem o XML, nenhum XML guardado").toBeNull();

  // O "LANÇAR" DA BASE: o link de hoje para o Documento fiscal de Estoque.
  await page.getByLabel("Chave/Emitente/Número").fill(nota.chave);
  await page.getByLabel("Chave/Emitente/Número").press("Enter");
  const linha = page.locator("tr", { hasText: nota.chave });
  await expect(linha, "premissa: a DF-e registrada está na fila da tela").toHaveCount(1);
  if (mundo === "legado") await expect(linha.locator(`a[href="/estoque/documentos-fiscais/new?dfe_id=${String(corpo["id"])}"]`), "o Lançar de hoje").toHaveCount(1);
  v.semBloqueio();
  v.semErroDeContrato();
});
