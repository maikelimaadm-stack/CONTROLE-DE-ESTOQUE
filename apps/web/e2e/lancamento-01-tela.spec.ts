import type { Locator, Page } from "@playwright/test";
import { LAYOUT_DO_SISTEMA, configuracaoNeutraTopV5, type ConfiguracaoTipoOperacaoV5, type EstruturaLayout } from "@agro/domain";
import { api, empresaAtiva, login, uniq } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, doSeed, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";

/**
 * LANCAMENTO-01 (F1, decisão 311) — A TELA: a Central de Compras REAL semeia o que a TOP já sabe e o local do produto.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────┐
 * │ O unitário (`padroes-da-top.test.ts`, LANC-U01..U12) prova as contas puras uma a uma; a integração   │
 * │ (`lancamento-01-regras-padroes.test.ts`, LANC-I1..I7) prova o que a rota responde. O que nenhum dos   │
 * │ dois alcança é o ELO: o que a TELA mostra com a resposta real, o que o Salvar MANDA no fio e o que o │
 * │ servidor GRAVA — e, na compra confirmada, o título que ele gera.                                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O SERVIDOR É O ÁRBITRO. Cada caso lê a PREMISSA no fio (a resposta de `regras-da-operacao` e de `layout-efetivo` que
 * a própria página recebeu) ou na API (o detalhe da TOP); captura o POST REAL do Salvar; e lê o GRAVADO no banco do E2E
 * (o detalhe da compra; a prévia da confirmação; o título da compra confirmada). O DOM não mostra o id de um campo de
 * referência: o id que a tela tem no campo aparece no fio quando ela pede o rótulo dele (`/options?id=` da árvore), e é
 * esse pedido que T1 segura para ler a DICA ("código · nome") antes de a árvore responder.
 *
 * OS ATRIBUTOS LIDOS (nenhum desenho novo): `data-padrao-top="semeado"` no invólucro do campo cujo valor é o que a TOP
 * semeou; `fieldset[data-editavel="false"][data-travado-pela-top="true"]` na trava; `padrao-invalido-aviso`; o local da
 * linha no texto de `central-compras-armazem`.
 *
 * FIXTURE PRÓPRIA (`central-compras-fixtures.ts`): locais, produtos, fornecedor e TOPs (no formato 5, com os padrões
 * pela porta administrativa) nascem no caso e saem no fim pela exclusão lógica; o layout dos casos de precedência sai
 * pela exclusão da própria API. Natureza, centro, tipo de título, forma e conta vêm do seed, pelo NOME. Os documentos
 * ficam (o ledger é imutável). 1440×900.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const P = "central-compras";
const VALOR_UNITARIO = "125.50";
const LAYOUTS = "/api/admin/layouts-documento";
/** As chaves do POST da compra de HOJE pela tela, com natureza e centro preenchidos (as de `central-compras-desenho-b` e `operacoes-01-f3b-compras`). */
const CHAVES_DE_HOJE = ["categoria_financeira_id", "centro_custo_id", "data_documento", "desconto", "empresa_id", "fornecedor_id", "frete", "itens", "outras_despesas", "tipo_operacao_id"];
const CHAVES_DO_ITEM_DE_HOJE = ["armazem_id", "produto_id", "quantidade", "valor_unitario"];
/** O que sai do corpo quando a TOP semeou o par (o servidor aplica o MESMO par no salvar). */
const OMITIDAS_PELO_PAR = ["categoria_financeira_id", "centro_custo_id"];
/** A recusa de hoje da compra que gera título sem o par (nem no documento, nem na TOP) — escrita por extenso. */
const MSG_SEM_O_PAR = "Informe a natureza financeira e o centro de resultado: esta compra gera contas a pagar";

const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
const chaves = (o: unknown) => (ehObj(o) ? Object.keys(o).sort() : []);
const itensDe = (o: Record<string, unknown>) => (Array.isArray(o["itens"]) ? (o["itens"] as Record<string, unknown>[]) : []);
const semAs = (lista: readonly string[], fora: readonly string[]) => lista.filter((k) => !fora.includes(k));

/** Uma linha de registro no console e nas anotações do teste (o relatório lê as duas). */
function registrar(rotulo: string, conteudo: unknown) {
  const linha = `LANC-T ${rotulo} ${JSON.stringify(conteudo)}`;
  console.log(linha);
  test.info().annotations.push({ type: "LANC-T", description: linha });
}

/* ═════════════════════════════════════ A FIXTURE ═════════════════════════════════════ */

interface PadraoComCodigo { id: string; codigo: string; nome: string }
interface Montado {
  tag: string; empresa: string;
  natureza: Opcao & { codigo: string; nome: string }; centro: Opcao & { codigo: string; nome: string };
  tipoTitulo: Opcao; forma: Opcao; conta: { id: string; code: string };
  local: { id: string; nome: string };
  produto: { id: string; nome: string };
  fornecedor: { id: string; nome: string };
  grupo: Opcao; unidade: Opcao;
}

async function criarLocal(page: Page, empresa: string, tag: string, nome: string): Promise<{ id: string; nome: string }> {
  const l = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `L${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: `${tag} ${nome}`, type: "inputs" });
  const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${l.id}`);
  expect(lido["empresa_id"], `premissa: o local "${nome}" é da empresa pedida`).toBe(empresa);
  return { id: l.id, nome: texto(lido["description"]) };
}

async function criarProduto(page: Page, m: Pick<Montado, "tag" | "grupo" | "unidade" | "natureza">, nome: string, localPadrao: string | null): Promise<{ id: string; nome: string }> {
  const p = await criarCadastro(page, "products", {
    description: `${m.tag} ${nome}`, group_id: m.grupo.id, measurement_id: m.unidade.id, financial_category_id: m.natureza.id,
    control_stock: true, controle_lote: "nenhum", ...(localPadrao ? { default_warehouse_id: localPadrao } : {})
  });
  const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`);
  expect([lido["control_stock"], lido["controle_lote"], lido["default_warehouse_id"] ?? null], `premissa: o produto "${nome}" controla estoque, sem lote, com o local padrão pedido`)
    .toEqual([true, "nenhum", localPadrao]);
  return { id: p.id, nome: texto(lido["description"]) };
}

async function montar(page: Page): Promise<Montado> {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const tag = `LT${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const tipoTitulo = await doSeed(page, "/api/resources/title_types/options", "Boleto");
  const forma = await doSeed(page, "/api/resources/payment_methods/options", "Pix");
  const contas = await api<{ items: { id: string; code: string }[] }>(page, "GET", "/api/financial/bank-accounts/balances");
  const conta = contas.items.find((x) => x.code === "BB");
  expect(conta, "premissa: a conta BB do seed").toBeTruthy();
  // o código e o nome da natureza e do centro no CADASTRO (o padrão da TOP tem de vir com eles)
  const daArvore = async (recurso: string, o: Opcao) => {
    const r = await api<Record<string, unknown>>(page, "GET", `/api/resources/${recurso}/${o.id}`);
    expect([texto(r["code"]) !== "", texto(r["name"]) !== ""], `premissa: ${recurso} ${o.label} com código e nome no cadastro`).toEqual([true, true]);
    return { ...o, codigo: texto(r["code"]), nome: texto(r["name"]) };
  };
  const natureza = await daArvore("financial_categories", ref.natureza);
  const centro = await daArvore("cost_centers", ref.centro);
  const base = { tag, grupo: ref.grupo, unidade: ref.unidade, natureza };
  const local = await criarLocal(page, empresa, tag, "local base");
  const produto = await criarProduto(page, base, "produto base", local.id);
  const forn = await criarCadastro(page, "people", { name: uniq(`${tag} forn`), person_type: "legal", is_provider: true });
  const fornecedor = { id: forn.id, nome: texto((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${forn.id}`))["name"]) };
  return { tag, empresa, natureza, centro, tipoTitulo, forma, conta: conta!, local, produto, fornecedor, grupo: ref.grupo, unidade: ref.unidade };
}

interface PadroesDoCorpo { naturezaId?: string | null; centroCustoId?: string | null; tipoTituloId?: string | null; formaPagamentoId?: string | null; contaBancariaId?: string | null }
const OS_CINCO = (m: Montado): PadroesDoCorpo => ({ naturezaId: m.natureza.id, centroCustoId: m.centro.id, tipoTituloId: m.tipoTitulo.id, formaPagamentoId: m.forma.id, contaBancariaId: m.conta.id });

/** A TOP do caso, pela porta administrativa: no formato 5 com a configuração e os padrões dados, ou (sem eles) a de hoje. */
async function topDoCaso(page: Page, rotulo: string, o: { familia?: string; configuracao?: ConfiguracaoTipoOperacaoV5; padroes?: PadroesDoCorpo; destinos?: unknown[] } = {}) {
  const codigo = codigoTop("LT");
  const nome = uniq(`LANC-T ${rotulo}`);
  const corpo: Record<string, unknown> = { codigo, codigoBase: o.familia ?? "compras.compra", nome };
  if (o.configuracao) corpo["configuracao"] = o.configuracao;
  if (o.padroes) corpo["padroesFinanceiros"] = { naturezaId: null, centroCustoId: null, tipoTituloId: null, formaPagamentoId: null, contaBancariaId: null, ...o.padroes };
  if (o.destinos) corpo["destinos"] = o.destinos;
  const top = await criarTop(page, corpo);
  return { id: top.id, codigo, nome };
}

/** A execução CONFIGURADA que cobra a forma de pagamento (e, com `tudo`, o local e o vencimento: a do M1-E). */
function configuradaComForma(tudo: boolean, documentoTroca = true): ConfiguracaoTipoOperacaoV5 {
  const c = configuracaoNeutraTopV5();
  return {
    ...c,
    execucao: { estoque: "configurada", financeiro: "configurada" },
    estoque: { ...c.estoque, atualizacao: "entrada", exigeArmazem: tudo },
    financeiro: { ...c.financeiro, atualizacao: "pagar", exigeFormaPagamento: true, exigeVencimento: tudo },
    financeiroPadrao: { ...c.financeiroPadrao, documentoTroca }
  };
}

/* ═════════════════════════════════════ A TELA ═════════════════════════════════════ */

const central = (page: Page) => page.getByTestId("compras-central");
const dados = (page: Page) => page.getByTestId(`${P}-dados`);
const campo = (page: Page, c: string) => dados(page).locator(`[data-campo="${c}"]`);
const caixa = (page: Page, c: string) => campo(page, c).getByRole("combobox");
const linhas = (page: Page) => page.getByTestId(`${P}-linha`);

interface Aberta { regras: Record<string, unknown>; layout: Record<string, unknown> }

/**
 * Abre a criação pela rota da Central e devolve o que a PÁGINA recebeu no fio: a regra da operação e o layout efetivo.
 * Espera a tela parar de mudar (os efeitos de padrão rodam depois da carga).
 */
async function abrirCriacao(page: Page, segmento: "compras" | "pedidos", topId: string): Promise<Aberta> {
  const doFio = (rota: string) => page.waitForResponse((r) => {
    const u = new URL(r.url());
    return r.request().method() === "GET" && u.pathname === `/api/compras/${segmento}/${rota}` && u.searchParams.get("tipo_operacao_id") === topId;
  });
  const regras = doFio("regras-da-operacao"); const layout = doFio("layout-efetivo");
  await page.goto(`/compras/${segmento}/new?tipo_operacao_id=${topId}`);
  const aberta = { regras: (await (await regras).json()) as Record<string, unknown>, layout: (await (await layout).json()) as Record<string, unknown> };
  await expect(central(page), "a Central abriu a criação").toHaveAttribute("data-modo", "lancar");
  await expect(page.getByTestId("compras-top-travada"), "com a TOP do caso").toHaveAttribute("data-tipo-operacao-id", topId);
  await expect(page.getByTestId("compras-salvar"), "o Salvar destravou (layout e regras carregados)").toBeEnabled();
  await estavel(page);
  return aberta;
}

/** Os Dados da criação pararam de mudar: o que cada campo mostra e as marcas dele, lidos até duas leituras iguais. */
async function estavel(page: Page) {
  const ler = () => central(page).evaluate((el) => Array.from(el.querySelectorAll("[data-campo], [data-campo-fiscal]")).map((c) =>
    [c.getAttribute("data-campo") ?? c.getAttribute("data-campo-fiscal"), c.getAttribute("data-padrao-top"), c.closest("fieldset")?.getAttribute("data-travado-pela-top") ?? null,
      (c.querySelector('[role="combobox"]')?.textContent ?? "").trim()].join("|")).join("\n"));
  let anterior = "";
  await expect.poll(async () => { const agora = await ler(); const igual = agora === anterior; anterior = agora; return igual; },
    { message: "os Dados da criação pararam de mudar", intervals: [300, 300, 300, 600, 1000] }).toBe(true);
}

async function abrirDadosAdicionais(page: Page) {
  const botao = dados(page).getByRole("button", { name: /^Dados adicionais/ });
  if ((await botao.getAttribute("aria-expanded")) !== "true") await botao.click();
  await expect(botao).toHaveAttribute("aria-expanded", "true");
}

/** Escolhe a opção no RefSelect de um campo (o invólucro dado) pelo nome — o gesto do operador. */
async function escolherNoCampo(page: Page, alvo: Locator, nome: string) {
  await alvo.getByRole("combobox").click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).click();
  await expect(alvo.getByRole("combobox")).toContainText(nome);
}

async function entradaDaLinha(linha: Locator, rotulo: string): Promise<Locator> {
  const e = linha.getByLabel(rotulo, { exact: true });
  if (!(await e.isVisible())) await linha.getByTestId(`${P}-selecionar-item`).click();
  await expect(e, `a entrada "${rotulo}" está à vista`).toBeVisible();
  return e;
}

/** Escolhe o produto da linha N pela pesquisa da grade. */
async function escolherProduto(page: Page, i: number, produto: { nome: string }) {
  const linha = linhas(page).nth(i);
  await linha.getByTestId(`${P}-produto`).click();
  const pesquisa = page.getByTestId(`${P}-pesquisa`);
  await pesquisa.getByPlaceholder("Pesquisar pela descrição").fill(produto.nome);
  await pesquisa.getByRole("option").filter({ hasText: produto.nome }).click();
  await expect(linha.getByTestId(`${P}-produto`)).toContainText(produto.nome);
}

/** Adiciona a linha N+1 e escolhe o produto dela. */
async function novaLinhaCom(page: Page, produto: { nome: string }) {
  const n = await linhas(page).count();
  await page.getByTestId(`${P}-adicionar-item`).click();
  await expect(linhas(page), "a grade ganhou a linha").toHaveCount(n + 1);
  await escolherProduto(page, n, produto);
}

/** O local da linha N, escolhido pelo operador na célula. */
async function escolherLocalDaLinha(page: Page, i: number, local: { nome: string }) {
  const linha = linhas(page).nth(i);
  await linha.getByTestId(`${P}-armazem`).click();
  await page.getByPlaceholder("Pesquisar pela descrição").fill(local.nome);
  await page.getByRole("option", { name: literal(local.nome) }).click();
  await expect(linha.getByTestId(`${P}-armazem`)).toContainText(local.nome);
}

/** O documento mínimo do operador: o fornecedor, uma linha com o produto e o valor unitário (o resto vem da tela). */
async function preencherOMinimo(page: Page, m: Montado, produto = m.produto) {
  await escolherNoCampo(page, campo(page, "fornecedor_id"), m.fornecedor.nome);
  await novaLinhaCom(page, produto);
  const i = (await linhas(page).count()) - 1;
  await (await entradaDaLinha(linhas(page).nth(i), `Valor unitário do item ${i + 1}`)).fill(VALOR_UNITARIO);
}

const dataBr = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const dataIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ═════════════════════════════════════ O FIO ═════════════════════════════════════ */

interface Envio { corpo: Record<string, unknown>; status: number; json: unknown }

/** Todo POST na porta dada: o corpo que SAIU, o status e a resposta. */
function escutarPosts(page: Page, caminho: string | RegExp): Envio[] {
  const envios: Envio[] = [];
  page.on("response", async (r) => {
    const p = new URL(r.url()).pathname;
    if (r.request().method() !== "POST" || (typeof caminho === "string" ? p !== caminho : !caminho.test(p))) return;
    const corpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
    const json: unknown = await r.json().catch(() => null);
    envios.push({ corpo, status: r.status(), json });
  });
  return envios;
}

/** Salvar: o desfecho é o POST (com a resposta) — parar nas pendências da tela (zero POST) reprova, com elas no texto. */
async function salvar(page: Page, envios: Envio[]): Promise<Envio> {
  const antes = envios.length;
  const lista = page.getByTestId(`${P}-pendencias-lista`);
  await page.getByTestId("compras-salvar").click();
  await expect.poll(async () => (envios.length > antes ? "resposta" : (await lista.isVisible()) ? "pendencias" : "aguardando"),
    { message: "o Salvar teve desfecho: a resposta do servidor ou a lista de pendências" }).not.toBe("aguardando");
  const pendencias = envios.length > antes ? "" : await lista.innerText();
  expect(envios.length, `o Salvar enviou o POST (a tela parou nas pendências: ${pendencias})`).toBeGreaterThan(antes);
  return envios[antes]!;
}

/** O 201 e o id gravado; a Central foi para a consulta dele. */
async function gravou(page: Page, envio: Envio, segmento = "compras"): Promise<string> {
  expect(envio.status, `o servidor gravou: ${JSON.stringify(envio.json)}`).toBe(201);
  const id = ehObj(envio.json) ? texto(envio.json["id"]) : "";
  expect(id, "o 201 devolve o id").toMatch(/^[0-9a-f-]{36}$/);
  await expect(page, "a Central foi para o documento salvo").toHaveURL(new RegExp(`/compras/${segmento}/${id}$`));
  return id;
}

/** O que o servidor GRAVOU no cabeçalho (e o local de cada item). */
async function gravado(page: Page, id: string, segmento = "compras") {
  const d = await api<Record<string, unknown>>(page, "GET", `/api/compras/${segmento}/${id}`);
  return {
    categoria_financeira_id: d["categoria_financeira_id"] ?? null, centro_custo_id: d["centro_custo_id"] ?? null,
    forma_pagamento_id: d["forma_pagamento_id"] ?? null, tipo_titulo_id: d["tipo_titulo_id"] ?? null,
    itens_armazem: itensDe(d).map((i) => i["armazem_id"] ?? null)
  };
}

/** A premissa da TOP no fio: a seção e os padrões que a página recebeu, chave por chave. */
function premissaDosPadroes(regras: Record<string, unknown>, m: Montado, esperado: { secao: Record<string, unknown>; padroes: Record<string, string | null> | null }) {
  expect(regras["secao"], "premissa no fio: a seção da TOP").toEqual(esperado.secao);
  const p = regras["padroes"];
  if (esperado.padroes === null) { expect(p, "premissa no fio: padroes null").toBeNull(); return; }
  expect(ehObj(p), `premissa no fio: padroes é objeto (${JSON.stringify(p)})`).toBe(true);
  const ids = Object.fromEntries(["natureza", "centro", "tipoTitulo", "formaPagamento", "conta"].map((k) => [k, ehObj(p) && ehObj(p[k]) ? texto(p[k]["id"]) : null]));
  expect(ids, "premissa no fio: os padrões da TOP").toEqual(esperado.padroes);
  if (esperado.padroes["natureza"]) expect(ehObj(p) ? p["natureza"] : null, "premissa no fio: a natureza com código e nome").toEqual({ id: m.natureza.id, codigo: m.natureza.codigo, nome: m.natureza.nome });
  if (esperado.padroes["centro"]) expect(ehObj(p) ? p["centro"] : null, "premissa no fio: o centro com código e nome").toEqual({ id: m.centro.id, codigo: m.centro.codigo, nome: m.centro.nome });
}

const CINCO_IDS = (m: Montado) => ({ natureza: m.natureza.id, centro: m.centro.id, tipoTitulo: m.tipoTitulo.id, formaPagamento: m.forma.id, conta: m.conta.id });
const SECAO_NEUTRA = { provisao: false, documentoTroca: true, semClassificacao: "padrao_legado" };

/* ═════════════════════════════════════ LANC-T1 ═════════════════════════════════════ */

test("LANC-T1 — compra que gera título, TOP com os 5 padrões, o documento troca: natureza e centro SEMEADOS com o 'código · nome' da TOP na dica, o tipo de título semeado, a forma não cobrada vazia; o POST sem natureza, centro e tipo de título; o gravado com os três nulos; a prévia e o título da confirmação com o par e o tipo da TOP (R2)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const top = await topDoCaso(page, "T1", { configuracao: configuracaoNeutraTopV5(), padroes: OS_CINCO(m) });
  const envios = escutarPosts(page, "/api/compras/compras");

  // A DICA: o rótulo do valor de um campo de ÁRVORE vem do `/options?id=` dela. Segurado, a caixa mostra a dica (o rótulo
  // da TOP); o pedido diz no fio QUAL id a tela tem no campo.
  let soltar: () => void = () => undefined;
  const solto = new Promise<void>((r) => { soltar = r; });
  const pedidosDoRotulo: { recurso: string; id: string }[] = [];
  await page.route(/\/api\/resources\/(financial_categories|cost_centers)\/options\?/, async (rota) => {
    const u = new URL(rota.request().url());
    const id = u.searchParams.get("id");
    if (id) { pedidosDoRotulo.push({ recurso: u.pathname.split("/")[3] ?? "", id }); await solto; }
    await rota.continue();
  });
  const { regras } = await abrirCriacao(page, "compras", top.id);
  premissaDosPadroes(regras, m, { secao: SECAO_NEUTRA, padroes: CINCO_IDS(m) });
  expect([regras["geraTitulos"], regras["exigeFormaPagamento"]], "premissa no fio: gera título; a forma não é cobrada").toEqual([true, false]);

  // SEMEADOS, com a dica da TOP enquanto a árvore não responde.
  for (const [c, p] of [["categoria_financeira_id", m.natureza], ["centro_custo_id", m.centro]] as const) {
    await expect(campo(page, c), `${c}: semeado pela TOP`).toHaveAttribute("data-padrao-top", "semeado");
    await expect(caixa(page, c), `${c}: a dica é o "código · nome" do padrão da TOP`).toHaveText(`${p.codigo} · ${p.nome}`);
  }
  expect(pedidosDoRotulo, "no fio: a tela tem no campo o id da natureza e o do centro da TOP").toEqual(expect.arrayContaining([
    { recurso: "financial_categories", id: m.natureza.id }, { recurso: "cost_centers", id: m.centro.id }]));
  soltar();
  for (const [c, p] of [["categoria_financeira_id", m.natureza], ["centro_custo_id", m.centro]] as const) {
    await expect(caixa(page, c).locator(".cmd-option__code"), `${c}: depois da árvore, o chip do código`).toHaveText(p.codigo);
    await expect(caixa(page, c), `${c}: e o nome`).toContainText(p.nome);
    await expect(campo(page, c).locator('[data-parte="req"]'), `${c}: o "*" de hoje (a compra gera título)`).toHaveCount(1);
  }
  // A forma NÃO cobrada não é semeada (S4); nada trava (o documento troca); nenhum aviso; semeado não é alteração.
  await expect(campo(page, "forma_pagamento_id"), "a forma (presença do campo)").toHaveCount(1);
  await expect(caixa(page, "forma_pagamento_id"), "a forma opcional continua vazia").toHaveClass(/is-empty/);
  await expect(campo(page, "forma_pagamento_id")).not.toHaveAttribute("data-padrao-top", "semeado");
  await expect(dados(page).locator('fieldset[data-travado-pela-top="true"]'), "o documento troca: nada travado pela TOP").toHaveCount(0);
  await expect(page.getByTestId("padrao-invalido-aviso"), "nenhum aviso de padrão inválido").toHaveCount(0);
  await expect(page.getByTestId(`${P}-alterado`), "o semeado entra no inicial: não é alteração").toHaveCount(0);
  // O TIPO DE TÍTULO dos dados fiscais (S5): semeado com o nome da TOP.
  await abrirDadosAdicionais(page);
  const tipo = page.getByTestId("compras-tipo-titulo");
  await expect(tipo, "o tipo de título: semeado pela TOP").toHaveAttribute("data-padrao-top", "semeado");
  await expect(tipo.getByRole("combobox"), "com o nome do padrão").toContainText(m.tipoTitulo.label);

  await preencherOMinimo(page, m);
  await expect(linhas(page).first().getByTestId(`${P}-armazem`), "a linha nova nasce com o local do produto").toContainText(m.local.nome);
  const envio = await salvar(page, envios);
  const id = await gravou(page, envio);
  registrar("T1 corpo", { chaves: chaves(envio.corpo), item0: itensDe(envio.corpo)[0] ?? null });

  // O CORPO: as chaves de hoje MENOS o par (o servidor o aplica); sem a forma (vazia) e sem o tipo de título semeado.
  expect(chaves(envio.corpo), "o POST com as chaves de hoje menos natureza e centro").toEqual(semAs(CHAVES_DE_HOJE, OMITIDAS_PELO_PAR));
  for (const k of [...OMITIDAS_PELO_PAR, "forma_pagamento_id", "tipo_titulo_id"]) expect(Object.hasOwn(envio.corpo, k), `${k} fora do corpo`).toBe(false);
  expect(itensDe(envio.corpo).map(chaves), "o item com as chaves de hoje").toEqual([CHAVES_DO_ITEM_DE_HOJE]);
  expect(itensDe(envio.corpo)[0], "o item com o produto e o local dele").toMatchObject({ produto_id: m.produto.id, armazem_id: m.local.id });

  // O GRAVADO: natureza, centro, forma e tipo de título nulos (como hoje); o item no local do produto.
  const g = await gravado(page, id);
  registrar("T1 gravado", g);
  expect(g, "o servidor gravou o que o corpo levou").toEqual({ categoria_financeira_id: null, centro_custo_id: null, forma_pagamento_id: null, tipo_titulo_id: null, itens_armazem: [m.local.id] });

  // A PRÉVIA DA CONFIRMAÇÃO: o par da TOP.
  const previa = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/${id}/previa-confirmacao`);
  const fin = ehObj(previa["financeiro"]) ? previa["financeiro"] : {};
  registrar("T1 previa", fin);
  expect(fin["efeito"], "a prévia: título a pagar").toBe("pagar");
  expect(fin["classificacao"], "a prévia classifica com o par da TOP").toEqual({
    categoria: { id: m.natureza.id, codigo: m.natureza.codigo, nome: m.natureza.nome }, centro: { id: m.centro.id, codigo: m.centro.codigo, nome: m.centro.nome }, padraoDaTop: true });

  // A CONFIRMAÇÃO: o título com o par e o tipo de título da TOP.
  await page.getByTestId("compras-confirmar").click();
  await expect(page.getByTestId("compras-previa")).toHaveAttribute("data-situacao", "pronta");
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "confirmado");
  const titulos = (await api<{ titulos: { id: string }[] }>(page, "GET", `/api/compras/compras/${id}`)).titulos;
  expect(titulos.length, "a compra confirmada gerou um título").toBe(1);
  const titulo = await api<{ title_type_id: string | null; conta_prevista_id?: string | null; apportionments: { financial_category_id: string; cost_center_id: string }[] }>(
    page, "GET", `/api/financial/payables/${titulos[0]!.id}`);
  registrar("T1 titulo", { title_type_id: titulo.title_type_id, conta_prevista_id: titulo.conta_prevista_id ?? null, rateio: titulo.apportionments.map((a) => [a.financial_category_id, a.cost_center_id]) });
  expect(titulo.apportionments.map((a) => [a.financial_category_id, a.cost_center_id]), "o título com o par da TOP").toEqual([[m.natureza.id, m.centro.id]]);
  expect(titulo.title_type_id, "e o tipo de título da TOP (o semeado não foi no corpo; a confirmação usa o da TOP)").toBe(m.tipoTitulo.id);
});

/* ═════════════════════════════════════ LANC-T2 ═════════════════════════════════════ */

test("LANC-T2 — a TOP que NÃO deixa o documento trocar (documentoTroca false), com a forma cobrada: natureza, centro, forma e tipo de título semeados e TRAVADOS pelo fieldset de sempre, sem estilo novo; o fornecedor livre; o Salvar grava sem a troca (R1)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const top = await topDoCaso(page, "T2", { configuracao: configuradaComForma(false, false), padroes: OS_CINCO(m) });
  const envios = escutarPosts(page, "/api/compras/compras");
  const { regras } = await abrirCriacao(page, "compras", top.id);
  premissaDosPadroes(regras, m, { secao: { ...SECAO_NEUTRA, documentoTroca: false }, padroes: CINCO_IDS(m) });
  expect([regras["geraTitulos"], regras["exigeFormaPagamento"]], "premissa no fio: gera título e cobra a forma").toEqual([true, true]);

  const travas = dados(page).locator('fieldset[data-editavel="false"][data-travado-pela-top="true"]');
  for (const [c, rotulo] of [["categoria_financeira_id", m.natureza.nome], ["centro_custo_id", m.centro.nome], ["forma_pagamento_id", m.forma.label]] as const) {
    await expect(campo(page, c), `${c}: semeado pela TOP`).toHaveAttribute("data-padrao-top", "semeado");
    await expect(caixa(page, c), `${c}: com o padrão da TOP`).toContainText(rotulo);
    await expect(travas.locator(`[data-campo="${c}"]`), `${c}: dentro do fieldset da trava`).toHaveCount(1);
    await expect(caixa(page, c), `${c}: o seletor desabilitado`).toBeDisabled();
  }
  await expect(travas, "três campos travados pela TOP nos Dados").toHaveCount(3);
  // SEM ESTILO NOVO: a trava é o fieldset do layout, com os mesmos atributos (só a marca de onde veio).
  const atributos = await travas.evaluateAll((els) => els.map((el) => [el.getAttributeNames().sort().join(","), el.getAttribute("style")]));
  expect(atributos, "o fieldset de sempre: disabled, data-editavel, display: contents — e a marca da TOP").toEqual(
    Array.from({ length: 3 }, () => ["data-editavel,data-travado-pela-top,disabled,style", "display: contents;"]));
  await expect(caixa(page, "fornecedor_id"), "o que a TOP não padroniza continua livre").toBeEnabled();
  await abrirDadosAdicionais(page);
  const tipo = page.getByTestId("compras-tipo-titulo");
  await expect(tipo, "o tipo de título: semeado").toHaveAttribute("data-padrao-top", "semeado");
  await expect(page.locator('fieldset[data-editavel="false"][data-travado-pela-top="true"]').filter({ has: tipo }), "e travado pelo mesmo fieldset").toHaveCount(1);
  await expect(tipo.getByRole("combobox")).toBeDisabled();

  await preencherOMinimo(page, m);
  const envio = await salvar(page, envios);
  const id = await gravou(page, envio);
  expect(chaves(envio.corpo), "o par semeado fora do corpo; a forma semeada no corpo").toEqual([...semAs(CHAVES_DE_HOJE, OMITIDAS_PELO_PAR), "forma_pagamento_id"].sort());
  expect(envio.corpo["forma_pagamento_id"], "a forma semeada vai: a da TOP").toBe(m.forma.id);
  const g = await gravado(page, id);
  registrar("T2 gravado", g);
  expect(g, "o gravado: o par nulo (o servidor classifica pela TOP), a forma da TOP").toEqual({ categoria_financeira_id: null, centro_custo_id: null, forma_pagamento_id: m.forma.id, tipo_titulo_id: null, itens_armazem: [m.local.id] });
});

/* ═════════════════════════════════════ LANC-T3 ═════════════════════════════════════ */

test("LANC-T3 — receber um pedido cuja TOP de compra tem os 5 padrões: na criação a mesma TOP semeia; no receber NADA é semeado (natureza, centro e forma vazios como vieram do pedido) e o corpo do recebimento não os leva (R3)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const topCompra = await topDoCaso(page, "T3 compra", { configuracao: configuracaoNeutraTopV5(), padroes: OS_CINCO(m) });
  const topPedido = await topDoCaso(page, "T3 pedido", { familia: "compras.pedido", destinos: [{ tipoOperacaoId: topCompra.id, ordem: 0, emPartes: false }] });

  // PRESENÇA antes da ausência: a MESMA TOP, na criação, semeia o par.
  const { regras } = await abrirCriacao(page, "compras", topCompra.id);
  premissaDosPadroes(regras, m, { secao: SECAO_NEUTRA, padroes: CINCO_IDS(m) });
  await expect(campo(page, "categoria_financeira_id"), "premissa: na criação, a TOP semeia a natureza").toHaveAttribute("data-padrao-top", "semeado");
  await expect(campo(page, "centro_custo_id"), "premissa: e o centro").toHaveAttribute("data-padrao-top", "semeado");

  // O PEDIDO sem natureza, centro e forma.
  const pedido = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", {
    empresa_id: m.empresa, tipo_operacao_id: topPedido.id, fornecedor_id: m.fornecedor.id, data_documento: dataIso(new Date()),
    itens: [{ produto_id: m.produto.id, armazem_id: m.local.id, quantidade: "2", valor_unitario: "10.00" }]
  });
  const lido = await api<Record<string, unknown>>(page, "GET", `/api/compras/pedidos/${pedido.id}`);
  expect([lido["categoria_financeira_id"] ?? null, lido["centro_custo_id"] ?? null, lido["forma_pagamento_id"] ?? null], "premissa: o pedido sem natureza, centro e forma").toEqual([null, null, null]);

  const envios = escutarPosts(page, `/api/compras/pedidos/${pedido.id}/convert`);
  await page.goto(`/compras/pedidos/${pedido.id}`);
  const passos = page.getByTestId("compras-proximos-passos");
  await expect(passos).toHaveAttribute("data-situacao", "pronto");
  await passos.getByTestId(`compras-proximo-passo-${topCompra.codigo}`).click();
  await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?.*pedido=${pedido.id}`));
  await expect(central(page)).toHaveAttribute("data-modo", "receber");
  await expect(page.getByTestId("compras-central-receber")).toHaveAttribute("data-situacao", "pronto");
  await expect(page.getByTestId("compras-top-travada"), "o receber pela TOP de compra com os padrões").toHaveAttribute("data-tipo-operacao-id", topCompra.id);
  await expect(page.getByTestId("compras-salvar")).toBeEnabled();
  await estavel(page);

  for (const c of ["categoria_financeira_id", "centro_custo_id", "forma_pagamento_id"]) {
    await expect(campo(page, c), `${c}: o campo está na tela do receber`).toHaveCount(1);
    await expect(caixa(page, c), `${c}: vazio, como veio do pedido`).toHaveClass(/is-empty/);
  }
  await expect(central(page).locator("[data-padrao-top]"), "no receber, nada semeado pela TOP").toHaveCount(0);
  await expect(central(page).locator('fieldset[data-travado-pela-top="true"]'), "nem travado").toHaveCount(0);
  await expect(page.getByTestId("padrao-invalido-aviso"), "nem aviso").toHaveCount(0);

  const envio = await salvar(page, envios);
  registrar("T3 corpo do recebimento", { chaves: chaves(envio.corpo), status: envio.status });
  for (const k of ["categoria_financeira_id", "centro_custo_id", "forma_pagamento_id"]) expect(Object.hasOwn(envio.corpo, k), `${k}: fora do corpo do recebimento (vazio)`).toBe(false);
  const id = await gravou(page, envio);
  const g = await gravado(page, id);
  expect([g.categoria_financeira_id, g.centro_custo_id, g.forma_pagamento_id], "a compra recebida: como o pedido (vazios)").toEqual([null, null, null]);
});

/* ═════════════════════════════════════ LANC-T4 ═════════════════════════════════════ */

test("LANC-T4 — TOP no 5 que gera título com SÓ o centro: nada semeado (meio par não vale), o '*' de hoje na natureza e no centro, e o Salvar recebe o 422 de hoje no campo da natureza (R4)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const top = await topDoCaso(page, "T4", { configuracao: configuracaoNeutraTopV5(), padroes: { centroCustoId: m.centro.id } });
  const envios = escutarPosts(page, "/api/compras/compras");
  const { regras } = await abrirCriacao(page, "compras", top.id);
  premissaDosPadroes(regras, m, { secao: SECAO_NEUTRA, padroes: { natureza: null, centro: m.centro.id, tipoTitulo: null, formaPagamento: null, conta: null } });
  expect(regras["geraTitulos"], "premissa no fio: gera título").toBe(true);

  for (const c of ["categoria_financeira_id", "centro_custo_id"]) {
    await expect(caixa(page, c), `${c}: vazio`).toHaveClass(/is-empty/);
    await expect(campo(page, c).locator('[data-parte="req"]'), `${c}: o "*" de hoje`).toHaveCount(1);
  }
  await expect(central(page).locator("[data-padrao-top]"), "nada semeado: a TOP sem o par").toHaveCount(0);

  await preencherOMinimo(page, m);
  const envio = await salvar(page, envios);
  registrar("T4 recusa", { status: envio.status, json: envio.json, chaves: chaves(envio.corpo) });
  for (const k of OMITIDAS_PELO_PAR) expect(Object.hasOwn(envio.corpo, k), `${k}: vazio, fora do corpo`).toBe(false);
  expect(envio.status, "a recusa de hoje do servidor").toBe(422);
  expect(envio.json, "no caminho da natureza, com a mensagem de hoje").toMatchObject({ error: { code: "VALIDATION_ERROR", message: MSG_SEM_O_PAR, details: [{ path: "categoria_financeira_id", message: MSG_SEM_O_PAR }] } });
  await expect(campo(page, "categoria_financeira_id").locator('[data-parte="erro"]'), "a recusa aparece NO campo").toContainText(MSG_SEM_O_PAR);
  await expect(page, "nada gravado: a Central continua na criação").toHaveURL(/\/compras\/compras\/new\?/);
});

/* ═════════════════════════════════════ LANC-T5 ═════════════════════════════════════ */

test("LANC-T5a — o local do produto: a linha nova nasce com o local do produto da empresa do documento; o de OUTRA empresa é IGNORADO (o POST nunca o leva); o ajuste do operador não muda ao trocar o produto; N linhas do mesmo produto = uma leitura do produto e uma conferência do local (R5)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const ctx = await api<{ empresas?: { id: string }[] }>(page, "GET", "/api/auth/context");
  const outra = (ctx.empresas ?? []).map((e) => e.id).find((e) => e !== m.empresa);
  expect(outra, "premissa: o usuário vê uma segunda empresa").toBeTruthy();
  const daOutra = await criarLocal(page, outra!, m.tag, "local outra empresa");
  const ajuste = await criarLocal(page, m.empresa, m.tag, "local ajuste");
  const doTerceiro = await criarLocal(page, m.empresa, m.tag, "local terceiro");
  // nomes que não são prefixo um do outro: a pesquisa da grade escolhe pelo nome inteiro
  const comOutra = await criarProduto(page, m, "item da outra empresa", daOutra.id);
  const terceiro = await criarProduto(page, m, "item terceiro", doTerceiro.id);
  const top = await topDoCaso(page, "T5a", { configuracao: configuracaoNeutraTopV5(), padroes: OS_CINCO(m) });

  // O FIO: as leituras do cadastro do produto e as conferências do local na empresa (`warehouses/options` com `id`).
  const leituras: string[] = []; const conferencias: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") return;
    const u = new URL(r.url());
    if (u.pathname === `/api/resources/products/${m.produto.id}`) leituras.push(u.pathname);
    if (u.pathname === "/api/resources/warehouses/options" && u.searchParams.has("id")) conferencias.push(`${u.searchParams.get("empresa_id")}|${u.searchParams.get("id")}`);
  });
  const envios = escutarPosts(page, "/api/compras/compras");
  await abrirCriacao(page, "compras", top.id);
  await expect(page.getByTestId(`${P}-local-padrao`).getByRole("combobox"), "premissa: o local do cabeçalho vazio (sem padrão do layout)").toHaveClass(/is-empty/);
  await escolherNoCampo(page, campo(page, "fornecedor_id"), m.fornecedor.nome);

  // (1) TRÊS linhas do MESMO produto: todas no local dele; uma leitura do cadastro e uma conferência do local.
  for (let i = 0; i < 3; i++) {
    await novaLinhaCom(page, m.produto);
    await expect(linhas(page).nth(i).getByTestId(`${P}-armazem`), `linha ${i + 1}: o local do produto`).toContainText(m.local.nome);
  }
  registrar("T5a leituras", { produto: leituras.length, conferencias });
  // a leitura do cadastro é UMA por produto distinto, com a chave do controle de lote (o local a reusa); a outra
  // leitura do mesmo endereço é a da unidade, do motor da grade, que já existia — e nenhuma cresce com as linhas.
  expect(leituras.length, "o cadastro do produto: a do motor (unidade) e a da Central (lote e local), nenhuma por linha").toBe(2);
  expect(conferencias, "uma conferência do local, na empresa do documento").toEqual([`${m.empresa}|${m.local.id}`]);

  // (2) O produto com o local de OUTRA empresa: ignorado — a linha fica com o do cabeçalho (vazio).
  await novaLinhaCom(page, comOutra);
  await estavel(page);
  await expect(linhas(page).nth(3).getByTestId(`${P}-armazem`), "linha 4: o local de outra empresa é ignorado").toHaveText("—");

  // (3) O AJUSTE do operador: a linha nasce no local do produto, ele troca, e trocar o produto não derruba o ajuste.
  await novaLinhaCom(page, m.produto);
  await expect(linhas(page).nth(4).getByTestId(`${P}-armazem`), "linha 5: nasce no local do produto").toContainText(m.local.nome);
  await escolherLocalDaLinha(page, 4, ajuste);
  await escolherProduto(page, 4, terceiro);
  await estavel(page);
  await expect(linhas(page).nth(4).getByTestId(`${P}-armazem`), "linha 5: o ajuste do operador fica (não o local do terceiro produto)").toContainText(ajuste.nome);

  for (let i = 0; i < 5; i++) await (await entradaDaLinha(linhas(page).nth(i), `Valor unitário do item ${i + 1}`)).fill("10");
  const envio = await salvar(page, envios);
  const id = await gravou(page, envio);
  const noCorpo = itensDe(envio.corpo).map((i) => i["armazem_id"] ?? null);
  registrar("T5a corpo", noCorpo);
  expect(noCorpo, "no POST: o local do produto, o vazio (outra empresa ignorada) e o ajuste").toEqual([m.local.id, m.local.id, m.local.id, null, ajuste.id]);
  expect(JSON.stringify(envio.corpo).includes(daOutra.id), "o POST nunca leva o local da outra empresa").toBe(false);
  expect((await gravado(page, id)).itens_armazem, "o gravado igual ao corpo").toEqual([m.local.id, m.local.id, m.local.id, null, ajuste.id]);
});

test("LANC-T5b — o local do cabeçalho ESCOLHIDO pelo operador vence o do produto para a linha nova", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const escolhido = await criarLocal(page, m.empresa, m.tag, "local escolhido");
  const top = await topDoCaso(page, "T5b", { configuracao: configuracaoNeutraTopV5(), padroes: OS_CINCO(m) });
  const envios = escutarPosts(page, "/api/compras/compras");
  await abrirCriacao(page, "compras", top.id);
  await escolherNoCampo(page, page.getByTestId(`${P}-local-padrao`), escolhido.nome);
  await preencherOMinimo(page, m);
  await estavel(page);
  await expect(linhas(page).first().getByTestId(`${P}-armazem`), "a escolha do operador no cabeçalho vence o local do produto").toContainText(escolhido.nome);
  const envio = await salvar(page, envios);
  await gravou(page, envio);
  expect(itensDe(envio.corpo).map((i) => i["armazem_id"] ?? null), "no POST: o local escolhido").toEqual([escolhido.id]);
});

/* ═════════════════════════════════════ LANC-T6 ═════════════════════════════════════ */

/** Um layout de compra (a cópia do do sistema) com o padrão de cadastro no Centro de resultado, ligado à TOP. */
async function layoutComOCentro(page: Page, topId: string, centroId: string): Promise<string> {
  const estrutura: EstruturaLayout = structuredClone(LAYOUT_DO_SISTEMA("compras.compra"));
  expect(estrutura.cabecalho.map((x) => x.campo), "premissa: o centro está no layout do sistema da compra").toContain("centro_custo_id");
  estrutura.cabecalho = estrutura.cabecalho.map((x) => (x.campo === "centro_custo_id" ? { ...x, valorPadrao: { tipo: "registro" as const, id: centroId } } : x));
  const id = (await api<{ id: string }>(page, "POST", LAYOUTS, { familia: "compras.compra", nome: uniq("Layout LANC-T6"), estrutura })).id;
  await api(page, "PUT", `${LAYOUTS}/${id}/tops`, { tipoOperacaoIds: [topId] });
  return id;
}

/** Roda o caso com o layout vivo e o exclui no fim (a exclusão que falha reprova o caso verde; no caso vermelho, não o mascara). */
async function comLayout(page: Page, layoutId: string, caso: () => Promise<void>) {
  let vivo = true;
  try {
    await caso();
    await api(page, "DELETE", `${LAYOUTS}/${layoutId}`, {});
    vivo = false;
  } finally {
    if (vivo) await api(page, "DELETE", `${LAYOUTS}/${layoutId}`, {}).catch(() => undefined);
  }
}

test("LANC-T6a — PRECEDÊNCIA: o padrão de cadastro do LAYOUT no centro (≠ o da TOP) vence — a tela mostra o do layout, a natureza NÃO é semeada (S3), o POST leva o centro do layout e o GRAVADO sai com ele (R7)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const outros = await api<Opcao[]>(page, "GET", "/api/resources/cost_centers/options?kind=analytic");
  const doLayout = outros.find((o) => o.id !== m.centro.id && !o.label.includes(m.centro.nome));
  expect(doLayout, "premissa: um segundo centro analítico no seed").toBeTruthy();
  const top = await topDoCaso(page, "T6a", { configuracao: configuracaoNeutraTopV5(), padroes: OS_CINCO(m) });
  const layout = await layoutComOCentro(page, top.id, doLayout!.id);
  await comLayout(page, layout, async () => {
    const envios = escutarPosts(page, "/api/compras/compras");
    const { regras, layout: efetivo } = await abrirCriacao(page, "compras", top.id);
    premissaDosPadroes(regras, m, { secao: SECAO_NEUTRA, padroes: CINCO_IDS(m) });
    expect(efetivo, "premissa no fio: o layout ligado com o padrão de cadastro no centro").toMatchObject({ origem: "ligado", id: layout, padroesDeCadastro: { centro_custo_id: { id: doLayout!.id } } });
    registrar("T6a ids", { centroDoLayout: doLayout!.id, centroDaTop: m.centro.id });

    // A TELA (soft: o caso segue até o gravado, que é a conclusão).
    await expect.soft(caixa(page, "centro_custo_id"), "o centro do LAYOUT na tela").toContainText(doLayout!.label);
    await expect.soft(campo(page, "centro_custo_id"), "o centro não é o semeado pela TOP").not.toHaveAttribute("data-padrao-top", "semeado");
    await expect.soft(caixa(page, "categoria_financeira_id"), "a natureza NÃO é semeada (o par da TOP não é o da tela)").toHaveClass(/is-empty/);
    await expect.soft(campo(page, "categoria_financeira_id"), "nem marcada como semeada").not.toHaveAttribute("data-padrao-top", "semeado");

    // O operador responde a natureza (a da TOP) — a única pergunta que sobrou do par.
    await escolherNoCampo(page, campo(page, "categoria_financeira_id"), m.natureza.label);
    await preencherOMinimo(page, m);
    const envio = await salvar(page, envios);
    const id = await gravou(page, envio);
    const g = await gravado(page, id);
    registrar("T6a corpo e gravado", { corpo: { categoria_financeira_id: envio.corpo["categoria_financeira_id"] ?? null, centro_custo_id: envio.corpo["centro_custo_id"] ?? null }, gravado: g });
    expect.soft([envio.corpo["categoria_financeira_id"] ?? null, envio.corpo["centro_custo_id"] ?? null], "o POST leva a natureza respondida e o centro do LAYOUT").toEqual([m.natureza.id, doLayout!.id]);
    expect([g.categoria_financeira_id, g.centro_custo_id], `o GRAVADO sai com o centro do LAYOUT (${doLayout!.id}), não com o da TOP (${m.centro.id})`).toEqual([m.natureza.id, doLayout!.id]);
  });
});

test("LANC-T6b — o layout com o MESMO centro da TOP: a natureza é semeada pela TOP, o centro é o do layout, e o par vai INTEIRO no POST (metade layout, metade TOP)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const top = await topDoCaso(page, "T6b", { configuracao: configuracaoNeutraTopV5(), padroes: OS_CINCO(m) });
  const layout = await layoutComOCentro(page, top.id, m.centro.id);
  await comLayout(page, layout, async () => {
    const envios = escutarPosts(page, "/api/compras/compras");
    const { regras, layout: efetivo } = await abrirCriacao(page, "compras", top.id);
    premissaDosPadroes(regras, m, { secao: SECAO_NEUTRA, padroes: CINCO_IDS(m) });
    expect(efetivo, "premissa no fio: o layout com o centro da TOP como padrão de cadastro").toMatchObject({ origem: "ligado", id: layout, padroesDeCadastro: { centro_custo_id: { id: m.centro.id } } });
    await expect(campo(page, "categoria_financeira_id"), "a natureza: semeada pela TOP").toHaveAttribute("data-padrao-top", "semeado");
    await expect(caixa(page, "categoria_financeira_id")).toContainText(m.natureza.nome);
    await expect(caixa(page, "centro_custo_id"), "o centro: o do layout").toContainText(m.centro.nome);
    await expect(campo(page, "centro_custo_id"), "o centro veio do layout, não da TOP").not.toHaveAttribute("data-padrao-top", "semeado");
    await preencherOMinimo(page, m);
    const envio = await salvar(page, envios);
    const id = await gravou(page, envio);
    expect([envio.corpo["categoria_financeira_id"] ?? null, envio.corpo["centro_custo_id"] ?? null], "o par INTEIRO no POST: a natureza da TOP e o centro do layout").toEqual([m.natureza.id, m.centro.id]);
    expect(chaves(envio.corpo), "as chaves de hoje").toEqual(CHAVES_DE_HOJE);
    const g = await gravado(page, id);
    expect([g.categoria_financeira_id, g.centro_custo_id], "o gravado com o par").toEqual([m.natureza.id, m.centro.id]);
  });
});

/* ═════════════════════════════════════ LANC-T7 ═════════════════════════════════════ */

test("LANC-T7 — a forma COBRADA (execução do M1-E: forma, local e vencimento exigidos): a forma semeada com a da TOP VAI no POST e o local vem do produto — o primeiro Salvar grava, sem as recusas de forma e de local; sobram fornecedor, produto, valor e vencimento", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const top = await topDoCaso(page, "T7", { configuracao: configuradaComForma(true), padroes: OS_CINCO(m) });
  const envios = escutarPosts(page, "/api/compras/compras");
  const { regras } = await abrirCriacao(page, "compras", top.id);
  premissaDosPadroes(regras, m, { secao: SECAO_NEUTRA, padroes: CINCO_IDS(m) });
  expect([regras["exigeFormaPagamento"], regras["exigeArmazem"], regras["exigeVencimento"]], "premissa no fio: a execução do M1-E").toEqual([true, true, true]);
  await expect(campo(page, "forma_pagamento_id"), "a forma cobrada: semeada").toHaveAttribute("data-padrao-top", "semeado");
  await expect(caixa(page, "forma_pagamento_id"), "com a da TOP").toContainText(m.forma.label);
  await expect(campo(page, "forma_pagamento_id").locator('[data-parte="req"]'), "o \"*\" da regra, já preenchido").toHaveCount(1);
  await expect(caixa(page, "forma_pagamento_id"), "o documento troca: a forma não trava").toBeEnabled();

  const gestos: string[] = [];
  await preencherOMinimo(page, m); gestos.push("Fornecedor", "Item 1 · Produto", "Item 1 · Valor unitário");
  await expect(linhas(page).first().getByTestId(`${P}-armazem`), "o local exigido: o do produto").toContainText(m.local.nome);
  const vence = new Date(Date.now() + 30 * 86_400_000);
  const entrada = campo(page, "data_vencimento").locator('input:not([type="hidden"])').first();
  await entrada.fill(dataBr(vence)); await entrada.press("Enter");
  await expect(campo(page, "data_vencimento").locator('input[type="hidden"]')).toHaveValue(dataIso(vence));
  gestos.push("Vencimento");
  registrar("T7 gestos", gestos);

  const envio = await salvar(page, envios);
  const id = await gravou(page, envio);
  expect(envios.length, "um POST só: nenhuma recusa de forma nem de local antes").toBe(1);
  expect(envio.corpo["forma_pagamento_id"], "a forma semeada VAI no corpo").toBe(m.forma.id);
  expect(itensDe(envio.corpo).map((i) => i["armazem_id"] ?? null), "o local do produto no item").toEqual([m.local.id]);
  for (const k of OMITIDAS_PELO_PAR) expect(Object.hasOwn(envio.corpo, k), `${k}: o par semeado fora do corpo`).toBe(false);
  expect(await gravado(page, id), "o gravado").toEqual({ categoria_financeira_id: null, centro_custo_id: null, forma_pagamento_id: m.forma.id, tipo_titulo_id: null, itens_armazem: [m.local.id] });
});

/* ═════════════════════════════════════ LANC-T8 ═════════════════════════════════════ */

test("LANC-T8 — cabeçalho e itens de hoje intactos: a TOP sem padrões (padroes null no fio) não semeia, não trava, não omite — o POST com EXATAMENTE as chaves da compra de hoje e o item com as de hoje (a T1 tem as mesmas menos o par)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const top = await topDoCaso(page, "T8");
  const envios = escutarPosts(page, "/api/compras/compras");
  const { regras } = await abrirCriacao(page, "compras", top.id);
  premissaDosPadroes(regras, m, { secao: SECAO_NEUTRA, padroes: null });
  expect(regras["geraTitulos"], "premissa no fio: a compra de hoje gera título").toBe(true);
  await expect(campo(page, "categoria_financeira_id"), "premissa: o campo da natureza está na tela").toHaveCount(1);
  await expect(central(page).locator("[data-padrao-top]"), "sem padrões: nada semeado").toHaveCount(0);
  await expect(central(page).locator('fieldset[data-travado-pela-top="true"]'), "nada travado").toHaveCount(0);
  await escolherNoCampo(page, campo(page, "categoria_financeira_id"), m.natureza.label);
  await escolherNoCampo(page, campo(page, "centro_custo_id"), m.centro.label);
  await preencherOMinimo(page, m);
  const envio = await salvar(page, envios);
  const id = await gravou(page, envio);
  registrar("T8 corpo", { chaves: chaves(envio.corpo), item: itensDe(envio.corpo).map(chaves) });
  expect(chaves(envio.corpo), "as chaves da compra de hoje").toEqual(CHAVES_DE_HOJE);
  expect(itensDe(envio.corpo).map(chaves), "o item de hoje").toEqual([CHAVES_DO_ITEM_DE_HOJE]);
  expect([envio.corpo["categoria_financeira_id"], envio.corpo["centro_custo_id"]], "o par do operador").toEqual([m.natureza.id, m.centro.id]);
  const g = await gravado(page, id);
  expect([g.categoria_financeira_id, g.centro_custo_id], "o gravado com o par do operador").toEqual([m.natureza.id, m.centro.id]);
});

/* ═════════════════════════════════════ LANC-T9 ═════════════════════════════════════ */

test("LANC-T9 — o PEDIDO de compra: com a provisão ligada a TOP semeia o par e ele sai do corpo (o servidor aplica o par com qualquer total), a linha nasce no local do produto (leitura nova no pedido: uma por produto distinto) e o pedido finaliza; a MESMA TOP com a provisão desligada não semeia nada", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const neutra = configuracaoNeutraTopV5();
  const comProvisao = await topDoCaso(page, "T9 provisão", { familia: "compras.pedido", configuracao: { ...neutra, financeiroPadrao: { ...neutra.financeiroPadrao, provisao: true } }, padroes: OS_CINCO(m) });
  const semProvisao = await topDoCaso(page, "T9 sem provisão", { familia: "compras.pedido", configuracao: neutra, padroes: OS_CINCO(m) });

  // SEM a provisão: o pedido não é classificado pela TOP no salvar — nada semeado (presença do campo antes da ausência).
  const sem = await abrirCriacao(page, "pedidos", semProvisao.id);
  premissaDosPadroes(sem.regras, m, { secao: SECAO_NEUTRA, padroes: CINCO_IDS(m) });
  await expect(campo(page, "categoria_financeira_id"), "premissa: o campo da natureza está no pedido").toHaveCount(1);
  await expect(central(page).locator("[data-padrao-top]"), "sem a provisão, nada semeado").toHaveCount(0);

  // COM a provisão: o par semeado, fora do corpo.
  const leituras: string[] = []; const conferencias: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") return;
    const u = new URL(r.url());
    if (u.pathname === `/api/resources/products/${m.produto.id}`) leituras.push(u.pathname);
    if (u.pathname === "/api/resources/warehouses/options" && u.searchParams.has("id")) conferencias.push(`${u.searchParams.get("empresa_id")}|${u.searchParams.get("id")}`);
  });
  const envios = escutarPosts(page, "/api/compras/pedidos");
  const com = await abrirCriacao(page, "pedidos", comProvisao.id);
  await expect(central(page)).toHaveAttribute("data-especie", "pedido");
  premissaDosPadroes(com.regras, m, { secao: { ...SECAO_NEUTRA, provisao: true }, padroes: CINCO_IDS(m) });
  for (const c of ["categoria_financeira_id", "centro_custo_id"]) await expect(campo(page, c), `${c}: semeado pela TOP que provisiona`).toHaveAttribute("data-padrao-top", "semeado");
  await expect(caixa(page, "forma_pagamento_id"), "a forma não cobrada: vazia").toHaveClass(/is-empty/);
  await preencherOMinimo(page, m);
  await novaLinhaCom(page, m.produto);
  await (await entradaDaLinha(linhas(page).nth(1), "Valor unitário do item 2")).fill("10");
  for (let i = 0; i < 2; i++) await expect(linhas(page).nth(i).getByTestId(`${P}-armazem`), `linha ${i + 1}: o local do produto`).toContainText(m.local.nome);
  registrar("T9 leituras no pedido", { produto: leituras.length, conferencias });
  expect(leituras.length, "duas linhas do mesmo produto: a leitura do motor (unidade) e a da Central (o local), nenhuma por linha").toBe(2);
  expect(conferencias, "uma conferência do local, na empresa do documento").toEqual([`${m.empresa}|${m.local.id}`]);

  const envio = await salvar(page, envios);
  const id = await gravou(page, envio, "pedidos");
  registrar("T9 corpo", { chaves: chaves(envio.corpo), itens: itensDe(envio.corpo).map((i) => i["armazem_id"] ?? null) });
  for (const k of OMITIDAS_PELO_PAR) expect(Object.hasOwn(envio.corpo, k), `${k}: o par semeado fora do corpo do pedido`).toBe(false);
  expect(itensDe(envio.corpo).map((i) => i["armazem_id"] ?? null), "os itens no local do produto").toEqual([m.local.id, m.local.id]);
  const g = await gravado(page, id, "pedidos");
  expect([g.categoria_financeira_id, g.centro_custo_id], "o pedido gravado com o par nulo, como hoje").toEqual([null, null]);
  const previa = await api<Record<string, unknown>>(page, "GET", `/api/compras/pedidos/${id}/previa-finalizacao`);
  expect(previa["podeFinalizar"], `o servidor diz que o pedido finaliza (a provisão com o par da TOP): ${JSON.stringify(previa["recusas"])}`).toBe(true);
});

/* ═════════════════════════════════════ LANC-T10 ═════════════════════════════════════ */

test("LANC-T10 — a TOP com os 5 padrões E 'Exigir centro de resultado' (exigência geral, que o servidor cobra SOBRE O CORPO antes de olhar a TOP), na compra e no pedido com provisão: a tela semeia o par e o PRIMEIRO Salvar grava, com o PAR INTEIRO da TOP no corpo e no gravado", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const neutra = configuracaoNeutraTopV5();
  const exigeCentro: ConfiguracaoTipoOperacaoV5 = { ...neutra, geral: { ...neutra.geral, exigeCentroResultado: true } };
  const compra = await topDoCaso(page, "T10 compra", { configuracao: exigeCentro, padroes: OS_CINCO(m) });
  const pedido = await topDoCaso(page, "T10 pedido", { familia: "compras.pedido", configuracao: { ...exigeCentro, financeiroPadrao: { ...neutra.financeiroPadrao, provisao: true } }, padroes: OS_CINCO(m) });
  const casos = [
    { segmento: "compras" as const, top: compra, secao: SECAO_NEUTRA },
    { segmento: "pedidos" as const, top: pedido, secao: { ...SECAO_NEUTRA, provisao: true } }
  ];
  for (const c of casos) {
    const envios = escutarPosts(page, `/api/compras/${c.segmento}`);
    const { regras } = await abrirCriacao(page, c.segmento, c.top.id);
    premissaDosPadroes(regras, m, { secao: c.secao, padroes: CINCO_IDS(m) });
    expect(regras["exigencias"], `premissa no fio (${c.segmento}): a TOP exige o centro de resultado`).toEqual(["centro_custo_id"]);
    for (const k of OMITIDAS_PELO_PAR) await expect(campo(page, k), `${c.segmento} · ${k}: semeado pela TOP`).toHaveAttribute("data-padrao-top", "semeado");
    await expect(campo(page, "centro_custo_id").locator('[data-parte="req"]'), `${c.segmento}: o "*" da exigência no centro, já preenchido`).toHaveCount(1);
    await preencherOMinimo(page, m);
    const envio = await salvar(page, envios);
    registrar(`T10 ${c.segmento}`, { status: envio.status, chaves: chaves(envio.corpo), json: envio.status === 201 ? null : envio.json });
    const id = await gravou(page, envio, c.segmento);
    expect(envios.length, `${c.segmento}: o PRIMEIRO Salvar gravou — um POST só`).toBe(1);
    expect([envio.corpo["categoria_financeira_id"] ?? null, envio.corpo["centro_custo_id"] ?? null], `${c.segmento}: o par INTEIRO no corpo (o centro é cobrado sobre o corpo)`).toEqual([m.natureza.id, m.centro.id]);
    const g = await gravado(page, id, c.segmento);
    expect([g.categoria_financeira_id, g.centro_custo_id], `${c.segmento}: o gravado com a natureza e o centro da TOP`).toEqual([m.natureza.id, m.centro.id]);
  }
});

/* ═════════════════════════════════════ LANC-T11 ═════════════════════════════════════ */

test("LANC-T11 — a compra de TOTAL ZERO com a TOP de 5 padrões: o par aparece semeado, mas o POST não leva natureza nem centro e o documento grava os dois nulos, como hoje (sem título, o servidor nem usa nem cobra o par)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const top = await topDoCaso(page, "T11", { configuracao: configuracaoNeutraTopV5(), padroes: OS_CINCO(m) });
  const envios = escutarPosts(page, "/api/compras/compras");
  const { regras } = await abrirCriacao(page, "compras", top.id);
  premissaDosPadroes(regras, m, { secao: SECAO_NEUTRA, padroes: CINCO_IDS(m) });
  expect(regras["geraTitulos"], "premissa no fio: a TOP gera título (o que não gera é o total zero)").toBe(true);
  for (const k of OMITIDAS_PELO_PAR) await expect(campo(page, k), `${k}: semeado pela TOP`).toHaveAttribute("data-padrao-top", "semeado");
  await escolherNoCampo(page, campo(page, "fornecedor_id"), m.fornecedor.nome);
  await novaLinhaCom(page, m.produto);
  await expect(await entradaDaLinha(linhas(page).first(), "Valor unitário do item 1"), "premissa: o valor unitário fica no zero com que a linha nasce").toHaveValue("0");
  await expect(page.getByTestId("compras-total"), "premissa: o total do documento é zero").toContainText("0,00");
  for (const k of OMITIDAS_PELO_PAR) await expect(campo(page, k), `${k}: continua semeado com o total zero`).toHaveAttribute("data-padrao-top", "semeado");
  const envio = await salvar(page, envios);
  const id = await gravou(page, envio);
  registrar("T11 corpo", { chaves: chaves(envio.corpo), itens: itensDe(envio.corpo) });
  for (const k of OMITIDAS_PELO_PAR) expect(Object.hasOwn(envio.corpo, k), `${k}: fora do corpo também com o total zero`).toBe(false);
  expect(chaves(envio.corpo), "as chaves de hoje menos o par").toEqual(semAs(CHAVES_DE_HOJE, OMITIDAS_PELO_PAR));
  const d = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/${id}`);
  expect(Number(texto(d["valor_total"])), "premissa: o servidor gravou total zero").toBe(0);
  const g = await gravado(page, id);
  expect([g.categoria_financeira_id, g.centro_custo_id], "o gravado sem natureza e centro, como hoje — nunca um par que o operador não escolheu").toEqual([null, null]);
});
