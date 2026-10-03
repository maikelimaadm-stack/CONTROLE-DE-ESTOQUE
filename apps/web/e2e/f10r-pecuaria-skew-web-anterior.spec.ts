import { test, expect, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { MENSAGEM_EXIGE_CLASSIFICACAO, resolverTipoOperacao } from "@agro/domain";
import { empresaAtiva, login } from "./helpers";
import { catalogoPublicadoE2E, cfg5, criarTopViaApi, excluirTopE2E, type TopE2E } from "./top-config-08-comum";
import { API, vigiar } from "./operacoes-01-f2-skew-comum";
import { corpoDoPost, sqlE2e } from "./f10-comum";
import { escolherNoCampo, referenciasDaPecuaria } from "./f10-pecuaria-comum";

/**
 * OPERACOES-01 F10r (decisão 287) · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do web"
 * da DEPLOYMENT: banco → API → web). A pecuária saiu do legado: o título da compra e da venda de animais passa a vir da
 * TOP PADRÃO da família (`pecuaria.compra_de_animais` / `pecuaria.venda_de_animais`), quando ela existe.
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts`
 * comum ignora o mesmo padrão. Arquivo próprio: `skew-web-anterior.spec.ts` é compartilhado entre PRs.
 *
 * NÃO HÁ SENTIDO 1 NESTA FASE: nenhum contrato novo é visível no web (a tela de movimentação de animais é o mesmo
 * arquivo; corpo e resposta do POST são os de hoje). O contrato que muda é SÓ do servidor: QUEM classifica o título.
 *
 * A API deste HEAD é a PREMISSA (o catálogo do formato 5 que ela publica tem a compra de animais COM tela — é o que
 * deixa o Maike criar a TOP padrão pelo assistente). O MUNDO, neste sentido, é o do WEB DA BASE, lido do fonte do commit
 * montado em `.api-anterior` (`git grep` no `HEAD` dela): o formulário da compra de animais manda `generate_financial`
 * para `/api/livestock/movements` (as duas marcas no fonte são premissa). Os dois casos:
 *   · K2-1 — SEM TOP PADRÃO (o estado de produção no deploy: as famílias nem existiam): a compra com "Gerar financeiro"
 *     e sem natureza nem centro gera o título EXATAMENTE como hoje — o rateio é o par legado, calculado aqui pelas
 *     consultas de hoje escritas à mão; TOP, versão, tipo de título e conta nulos; a trilha sem `financeiro`;
 *   · K2-2 — COM TOP PADRÃO "exigir" (depois que o Maike a criar): o web da base não quebra — a recusa do servidor
 *     chega no aviso com o texto EXATO, nada é gravado; com natureza e centro informados, o documento ganha e o título
 *     leva a TOP e a versão corrente.
 * Nenhuma requisição do cliente da base morre no navegador; no K2-1 nenhuma recebe erro de contrato da API nova, e no
 * K2-2 o único erro é a recusa esperada (422 no POST do movimento).
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

/** O MUNDO DO WEB DA BASE: o formulário da compra de animais gera financeiro pela porta do movimento. */
function premissaDoWebDaBase() {
  const geraFinanceiro = marcasNoWebDaBase("generate_financial");
  const porta = marcasNoWebDaBase("/api/livestock/movements");
  console.log(`[skew] F10r · K-2 · o web da base tem ${geraFinanceiro} marca(s) de generate_financial e ${porta} de /api/livestock/movements`);
  expect(geraFinanceiro, "premissa: o web da base manda generate_financial").toBeGreaterThan(0);
  expect(porta, "premissa: o web da base grava pela porta /api/livestock/movements").toBeGreaterThan(0);
}

/** A família da compra de animais, PERGUNTADA ao registry do domínio (nunca um literal daqui). */
function familiaDaCompra(): string {
  const familia = resolverTipoOperacao("erp.animal_movements", "purchase")?.codigo;
  expect(familia, "premissa: o registry declara a família da compra de animais").toBe("pecuaria.compra_de_animais");
  return familia!;
}

/** A PREMISSA: a API no ar é a deste HEAD — o catálogo publicado tem a compra de animais, com tela, na família do registry. */
async function premissaDaApi(page: Page, familia: string) {
  const catalogo = await catalogoPublicadoE2E(page);
  const compra = catalogo.tipos.find((t) => t.chave === "compra_animais");
  expect(compra && [compra.familia, compra.temTela], "premissa: a API julgada publica a compra de animais com tela").toEqual([familia, true]);
}

/** As TOPs padrão ATIVAS E VIVAS da família na organização (a que o servidor usaria). */
const topsPadraoDaFamilia = (org: string, familia: string) =>
  Number(sqlE2e(`select count(*) from erp.tipos_operacao where organization_id = '${org}' and codigo_base = '${familia}' and padrao and ativo and excluido_em is null`));

/** O par LEGADO do movimento de hoje (compra = despesa), pelas consultas da base ESCRITAS À MÃO: é o contrato que não muda. */
function parLegadoDaCompra(org: string): { natureza: string; centro: string } {
  const deAnimais = sqlE2e(`select id from erp.financial_categories where organization_id = '${org}' and nature = 'expense' and kind = 'analytic' and is_active and deleted_at is null and (name ilike '%animais%' or name ilike '%boi%' or name ilike '%bezerro%') order by code limit 1`);
  const natureza = deAnimais || sqlE2e(`select id from erp.financial_categories where organization_id = '${org}' and nature = 'expense' and kind = 'analytic' and is_active and deleted_at is null order by code limit 1`);
  const centro = sqlE2e(`select id from erp.cost_centers where organization_id = '${org}' and kind = 'analytic' and is_active and deleted_at is null order by code limit 1`);
  expect([natureza, centro], "premissa: a organização tem o par legado (uma natureza de despesa e um centro analíticos)")
    .toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/), expect.stringMatching(/^[0-9a-f-]{36}$/)]);
  return { natureza, centro };
}

/** Um cadastro do seed pelo nome EXATO, único na organização (o que o RefSelect da base vai mostrar). */
function doSeed(org: string, tabela: "people" | "financial_categories" | "cost_centers", nome: string, extra = ""): string {
  const ids = sqlE2e(`select id from erp.${tabela} where organization_id = '${org}' and name = '${nome.replace(/'/g, "''")}' and deleted_at is null ${extra}`).split("\n").filter(Boolean);
  expect(ids, `premissa: o seed tem exatamente um "${nome}" em ${tabela}`).toHaveLength(1);
  return ids[0]!;
}

/** As contagens da organização nas tabelas que o POST do movimento grava ("nada gravado" = iguais antes e depois). */
const contagens = (org: string) => sqlE2e(
  `select (select count(*) from erp.animal_movements where organization_id = '${org}') || '|' ||
          (select count(*) from erp.animal_movement_items i join erp.animal_movements m on m.id = i.movement_id where m.organization_id = '${org}') || '|' ||
          (select count(*) from erp.herd_lots where organization_id = '${org}') || '|' ||
          (select count(*) from erp.processings where organization_id = '${org}') || '|' ||
          (select count(*) from erp.financial_titles where organization_id = '${org}')`);

/** O título do movimento: direção | valor | TOP | versão | tipo de título | conta prevista (nulo = "-"). */
const tituloDoMovimento = (id: string) => sqlE2e(
  `select direction || '|' || amount::text || '|' || coalesce(tipo_operacao_id::text, '-') || '|' || coalesce(tipo_operacao_versao_id::text, '-') || '|' ||
          coalesce(title_type_id::text, '-') || '|' || coalesce(conta_prevista_id::text, '-')
     from erp.financial_titles where source_type = 'animal_movements' and source_id = '${id}'`);
/** O rateio do título do movimento: natureza | centro. */
const rateioDoMovimento = (id: string) => sqlE2e(
  `select a.financial_category_id::text || '|' || a.cost_center_id::text
     from erp.title_apportionments a join erp.financial_titles t on t.id = a.title_id where t.source_type = 'animal_movements' and t.source_id = '${id}'`);
/**
 * A trilha `create` do movimento: a origem de cada campo do par ("natureza/centro") e a TOP, ou "-" quando a chave
 * `financeiro` não existe.
 */
const trilhaDoMovimento = (id: string) => sqlE2e(
  `select coalesce((metadata->'financeiro'->'origem'->>'natureza') || '/' || (metadata->'financeiro'->'origem'->>'centro'), '-') || '|' || coalesce(metadata->'financeiro'->>'tipoOperacaoId', '-') || '|' || (metadata ? 'financeiro')::text
     from erp.audit_logs where entity = 'animal_movements' and entity_id = '${id}' and action = 'create'`);

/** O invólucro do campo do formulário da base cujo rótulo casa com o padrão (o `<label>` e o controle têm o mesmo pai). */
const campoPeloRotulo = (raiz: Page | Locator, rotulo: RegExp) => raiz.locator("label").filter({ hasText: rotulo }).first().locator("..");

/** As referências do caso, todas do seed. */
interface Caso { org: string; empresa: string; fornecedor: { id: string; nome: string }; categoria: string }

async function casoDaCompra(page: Page): Promise<Caso> {
  const empresa = await empresaAtiva(page);
  const org = sqlE2e(`select organization_id from erp.empresas where id = '${empresa}'`);
  const nome = "[DEMO] Agropecuária Cerrado Ltda";
  const fornecedor = { id: doSeed(org, "people", nome, "and is_provider"), nome };
  return { org, empresa, fornecedor, categoria: referenciasDaPecuaria().categoria };
}

/**
 * O formulário da compra de animais do web da BASE, preenchido como o usuário: o fornecedor, uma linha com a categoria
 * Garrote, 2 cabeças a 1500,00 e "Gerar financeiro" = "Conta a pagar". Natureza e centro ficam vazios.
 */
async function preencherCompra(page: Page, c: Caso) {
  await page.goto("/pecuaria/movimentacoes/purchase/new");
  await escolherNoCampo(page, campoPeloRotulo(page, /^Fornecedor$/), c.fornecedor.nome);
  await escolherNoCampo(page, campoPeloRotulo(page, /^Categoria(\s*\*)?$/), "Garrote");
  await campoPeloRotulo(page, /^Cabeças(\s*\*)?$/).locator("input").fill("2");
  await campoPeloRotulo(page, /^Valor unitário$/).locator("input").fill("1500");
  await campoPeloRotulo(page, /^Gerar financeiro$/).locator("select").selectOption({ label: "Conta a pagar" });
  await expect(campoPeloRotulo(page, /^Natureza$/), "com \"Gerar financeiro\", o web da base mostra a natureza").toBeVisible();
}

/** O corpo da compra que o web da base mandou é o deste caso (empresa, fornecedor, financeiro e o item). */
function confereCorpo(corpo: Record<string, unknown>, c: Caso, classificacao: { natureza: string | null; centro: string | null }) {
  const itens = corpo["items"] as { category_id: string; quantity: number; unit_value: string }[];
  expect([corpo["empresa_id"], corpo["movement_type"], corpo["person_id"], corpo["generate_financial"], corpo["financial_category_id"], corpo["cost_center_id"]],
    "premissa: o corpo é o desta compra").toEqual([c.empresa, "purchase", c.fornecedor.id, true, classificacao.natureza, classificacao.centro]);
  expect(itens.map((i) => [i.category_id, i.quantity, i.unit_value]), "premissa: um item, 2 cabeças × 1500").toEqual([[c.categoria, 2, "1500"]]);
}

test.describe.configure({ mode: "serial" });

test("F10r · K-2 · sem TOP padrão da compra de animais, o web da BASE gera o título IGUAL a hoje: o par legado, sem TOP, tipo de título nem conta", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const familia = familiaDaCompra();
  await premissaDaApi(page, familia);
  premissaDoWebDaBase();
  const c = await casoDaCompra(page);
  expect(topsPadraoDaFamilia(c.org, familia), "premissa: nenhuma TOP padrão ativa e viva da compra de animais").toBe(0);
  const legado = parLegadoDaCompra(c.org);

  await preencherCompra(page, c);
  const escrita = corpoDoPost(page, "/api/livestock/movements");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  const { corpo, status, resposta } = await escrita;
  confereCorpo(corpo, c, { natureza: null, centro: null });
  expect(status, JSON.stringify(resposta)).toBe(201);
  expect(Object.keys(resposta).sort(), "a resposta de antes, chave por chave").toEqual(["code", "id", "quantity", "title_ids", "total_value"]);
  expect([resposta["quantity"], resposta["total_value"], (resposta["title_ids"] as string[]).length], "2 cabeças, 3000,00, um título").toEqual([2, "3000.00", 1]);
  const id = String(resposta["id"]);
  await expect(page, "o web da base vai ao detalhe da compra").toHaveURL(new RegExp(`/pecuaria/movimentacoes/purchase/${id}$`));

  expect(tituloDoMovimento(id), "o título de hoje: a pagar, 3000,00, sem TOP, versão, tipo de título nem conta").toBe("payable|3000.00|-|-|-|-");
  expect(rateioDoMovimento(id), "o rateio é o par legado das consultas de hoje").toBe(`${legado.natureza}|${legado.centro}`);
  expect(trilhaDoMovimento(id), "a trilha de hoje: sem a chave financeiro").toBe("-|-|false");
  v.semBloqueio();
  v.semErroDeContrato();
});

test("F10r · K-2 · com a TOP padrão \"exigir\", o web da BASE mostra a recusa do servidor sem gravar nada; com natureza e centro, grava com a TOP no título", async ({ page }) => {
  const v = vigiar(page);
  const erros: string[] = [];
  page.on("response", (r) => { if (r.url().startsWith(API) && r.status() >= 400) erros.push(`${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`); });
  await login(page);
  const familia = familiaDaCompra();
  await premissaDaApi(page, familia);
  premissaDoWebDaBase();
  const c = await casoDaCompra(page);
  expect(topsPadraoDaFamilia(c.org, familia), "premissa: nenhuma TOP padrão ativa e viva da compra de animais antes do caso").toBe(0);
  expect(MENSAGEM_EXIGE_CLASSIFICACAO, "premissa: o texto da recusa é o do domínio")
    .toBe("A operação exige natureza e centro de resultado: informe no documento ou configure os padrões da TOP.");
  const legado = parLegadoDaCompra(c.org);
  const natureza = { id: doSeed(c.org, "financial_categories", "Sanidade Animal", "and nature = 'expense' and kind = 'analytic' and is_active"), nome: "Sanidade Animal" };
  const centro = { id: doSeed(c.org, "cost_centers", "Recria", "and kind = 'analytic' and is_active"), nome: "Recria" };
  expect([natureza.id === legado.natureza, centro.id === legado.centro], "premissa: a natureza e o centro do caso NÃO são o par legado").toEqual([false, false]);

  let top: TopE2E | null = null;
  try {
    top = await criarTopViaApi(page, familia,
      cfg5({}, (cfg) => ({ ...cfg, financeiroPadrao: { ...cfg.financeiroPadrao, semClassificacao: "exigir" } })), { rotulo: "F10r K2 exigir", padrao: true });
    expect(topsPadraoDaFamilia(c.org, familia), "premissa: a TOP do caso é a única padrão da família").toBe(1);
    const versao = sqlE2e(`select v.id from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and v.versao = t.versao_atual where t.id = '${top.id}'`);
    expect(sqlE2e(`select configuracao_schema_version || '|' || (configuracao->'financeiroPadrao'->>'semClassificacao') from erp.tipos_operacao_versoes where id = '${versao}'`),
      "premissa: a versão corrente está no formato 5 com \"exigir\"").toBe("5|exigir");

    // 1. Sem natureza e centro: a recusa do servidor, no aviso do web da base, e nada gravado.
    await preencherCompra(page, c);
    const antes = contagens(c.org);
    const recusa = corpoDoPost(page, "/api/livestock/movements");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    const r1 = await recusa;
    confereCorpo(r1.corpo, c, { natureza: null, centro: null });
    expect(r1.status, JSON.stringify(r1.resposta)).toBe(422);
    const erro = r1.resposta["error"] as { code: string; message: string; details?: { path: string[] }[] };
    expect([erro.code, erro.message], "a recusa \"exigir\" do servidor").toEqual(["VALIDATION_ERROR", MENSAGEM_EXIGE_CLASSIFICACAO]);
    expect((erro.details ?? []).map((d) => d.path.join(".")), "os dois campos que faltam").toEqual(["financial_category_id", "cost_center_id"]);
    await expect(page.locator(".erp-toast-panel--error .erp-toast-panel__description"), "o aviso do web da base mostra o texto EXATO do servidor")
      .toHaveText(MENSAGEM_EXIGE_CLASSIFICACAO);
    await expect(page, "a tela continua no formulário").toHaveURL(/\/pecuaria\/movimentacoes\/purchase\/new$/);
    expect(contagens(c.org), "nada gravado: movimentos, itens, rebanhos, processamentos e títulos iguais").toBe(antes);

    // 2. Com natureza e centro informados: o documento ganha, e o título leva a TOP padrão e a versão corrente.
    await escolherNoCampo(page, campoPeloRotulo(page, /^Natureza$/), natureza.nome);
    await escolherNoCampo(page, campoPeloRotulo(page, /^Centro de resultado$/), centro.nome);
    const escrita = corpoDoPost(page, "/api/livestock/movements");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    const r2 = await escrita;
    confereCorpo(r2.corpo, c, { natureza: natureza.id, centro: centro.id });
    expect(r2.status, JSON.stringify(r2.resposta)).toBe(201);
    expect(Object.keys(r2.resposta).sort(), "a resposta de antes, chave por chave").toEqual(["code", "id", "quantity", "title_ids", "total_value"]);
    const id = String(r2.resposta["id"]);
    await expect(page, "o web da base vai ao detalhe da compra").toHaveURL(new RegExp(`/pecuaria/movimentacoes/purchase/${id}$`));
    expect(tituloDoMovimento(id), "o título a pagar de 3000,00 leva a TOP e a versão corrente (sem padrões: sem tipo de título nem conta)")
      .toBe(`payable|3000.00|${top.id}|${versao}|-|-`);
    expect(rateioDoMovimento(id), "o rateio é o do documento").toBe(`${natureza.id}|${centro.id}`);
    expect(trilhaDoMovimento(id), "a trilha diz que a TOP agiu, com a classificação do documento").toBe(`documento/documento|${top.id}|true`);
    v.semBloqueio();
    expect(erros, "o único erro que o web da base recebeu é a recusa esperada").toEqual(["POST /api/livestock/movements → 422"]);
  } finally {
    if (top) await excluirTopE2E(page, top.id);
    expect(topsPadraoDaFamilia(c.org, familia), "a limpeza não deixou TOP padrão da compra de animais").toBe(0);
  }
});
