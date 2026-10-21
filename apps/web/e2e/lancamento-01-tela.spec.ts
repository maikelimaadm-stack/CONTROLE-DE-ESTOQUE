import type { Locator, Page } from "@playwright/test";
import { LAYOUT_DO_SISTEMA, configuracaoNeutraTopV5, type ConfiguracaoTipoOperacaoV5, type EstruturaLayout } from "@agro/domain";
import { api, empresaAtiva, login, uniq, abrirAbaDoPainelDeCompras } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, doSeed, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";
import { cabecalhosDaSessao } from "./top-config-08-comum";

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
 * semeou; `fieldset[data-editavel="false"][data-travado-pela-top="true"]` na trava; `padrao-invalido-aviso`. Natureza/
 * centro moram em "Rateio e classificação"; forma/vencimento em "Financeiro" (decisão 319). O local da linha: na grade
 * enxuta a coluna some — o POST/gravado prova; com `exigeArmazem` a coluna volta (`armazemForcado`).
 *
 * FIXTURE PRÓPRIA (`central-compras-fixtures.ts`): locais, produtos, fornecedor e TOPs (no formato 5, com os padrões
 * pela porta administrativa) nascem no caso e saem no fim pela exclusão lógica; o layout dos casos de precedência sai
 * pela exclusão da própria API. Natureza, centro, tipo de título, forma e conta vêm do seed, pelo NOME. Os documentos
 * ficam (o ledger é imutável). 1440×900.
 *
 * OS DOIS MUNDOS DA CHAVE DO LOCAL DO PRODUTO (emenda R2 da decisão 311). O local padrão do produto na linha nova só vale
 * com a capacidade `localDoProdutoNaLinha` que `regras-da-operacao` declara (a chave `COMPRAS_LOCAL_DO_PRODUTO_ENABLED` da
 * API, desligada por padrão). O CI mede o mundo LIGADO (`playwright.config.ts`: `?? "1"`); `COMPRAS_LOCAL_DO_PRODUTO_ENABLED=0`
 * exportado para o runner mede o DESLIGADO. Nenhum caso pula: cada um que toca o local lê a chave NO FIO (`chaveNoFio`,
 * que também reprova se a API de pé não é a que o runner pediu) e assegura o ramo dela — LIGADA, o local do produto
 * conferido, a outra empresa ignorada, o ajuste preservado, o cabeçalho escolhido vencendo, as leituras contadas;
 * DESLIGADA, a linha nova com o local do CABEÇALHO, como na main (vazio, "—", sem padrão do layout), ZERO leitura nova,
 * e o gravado e a entrada de estoque da main. O LANC-T12 é o caso do desligado (e, ligada, o mesmo cenário no ramo
 * ligado), com a resposta SEM a chave (a API anterior) fabricada no fio: o portão fecha nos dois mundos.
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
/** O item da linha sem local (o local do cabeçalho vazio, como na main): a chave do local não vai. */
const CHAVES_DO_ITEM_SEM_LOCAL = semAs(CHAVES_DO_ITEM_DE_HOJE, ["armazem_id"]);
/** A recusa do servidor ao tipo de título trocado numa TOP que não deixa o documento trocar (emenda R2, P4) — por extenso. */
const MSG_TROCA_DO_TIPO = "Esta operação não deixa trocar o tipo de título: use o padrão da TOP.";
/** A recusa de hoje da compra cuja execução exige o local e o item foi sem ele — por extenso. */
const MSG_SEM_O_LOCAL = "A operação desta compra exige o local de estoque de todos os itens";

/** Uma linha de registro no console e nas anotações do teste (o relatório lê as duas). */
function registrar(rotulo: string, conteudo: unknown) {
  const linha = `LANC-T ${rotulo} ${JSON.stringify(conteudo)}`;
  console.log(linha);
  test.info().annotations.push({ type: "LANC-T", description: linha });
}

/* ═════════════════════════════════════ A FIXTURE ═════════════════════════════════════ */

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
/** Campo em qualquer zona da Central (Dados ou painel). Abra a aba certa antes de ler o que mora no rodapé. */
const campo = (page: Page, c: string) => central(page).locator(`[data-campo="${c}"]`);
const caixa = (page: Page, c: string) => campo(page, c).getByRole("combobox");
const linhas = (page: Page) => page.getByTestId(`${P}-linha`);
const abrirRateio = (page: Page) => abrirAbaDoPainelDeCompras(page, "Rateio e classificação");
const abrirFinanceiro = (page: Page) => abrirAbaDoPainelDeCompras(page, "Financeiro");

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

/** Tipo de título no Financeiro (decisão 319); sem acordeão Dados adicionais. */
async function extrasFiscais(page: Page) {
  await expect(dados(page).getByRole("button", { name: /^Dados adicionais/ }), "sem acordeão").toHaveCount(0);
  await expect(page.getByTestId("compras-tipo-titulo"), "tipo de título no Financeiro").toBeVisible();
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

/** O local da linha N, escolhido pelo operador na célula (só quando a coluna está na grade — ex.: exigeArmazem). */
async function escolherLocalDaLinha(page: Page, i: number, local: { nome: string }) {
  const linha = linhas(page).nth(i);
  const celula = linha.getByTestId(`${P}-armazem`);
  await expect(celula, `a célula do local da linha ${i + 1} está na grade (exigeArmazem / armazemForcado)`).toHaveCount(1);
  await celula.click();
  await page.getByPlaceholder("Pesquisar pela descrição").fill(local.nome);
  await page.getByRole("option", { name: literal(local.nome) }).click();
  await expect(celula).toContainText(local.nome);
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

/* ═════════════════════════════ A CHAVE DO LOCAL DO PRODUTO (emenda R2 da decisão 311) ═════════════════════════════ */

/**
 * O MUNDO DO CASO, lido NO FIO: a capacidade `localDoProdutoNaLinha` que a página recebeu de `regras-da-operacao`, pela
 * MESMA régua da tela (só o booleano `true` liga; ausente — a API anterior — é desligada). E conferido contra o mundo que
 * o runner PEDIU (`playwright.config.ts` passa `COMPRAS_LOCAL_DO_PRODUTO_ENABLED ?? "1"` à API): uma API de pé com outro
 * valor (servidor reaproveitado) não mede o que o caso diz — reprova aqui, em vez de passar pelo outro ramo.
 */
function chaveNoFio(regras: Record<string, unknown>, onde: string): boolean {
  const ligada = regras["localDoProdutoNaLinha"] === true;
  const pedida = (process.env.COMPRAS_LOCAL_DO_PRODUTO_ENABLED ?? "1") === "1";
  registrar(`${onde} chave`, { localDoProdutoNaLinha: Object.hasOwn(regras, "localDoProdutoNaLinha") ? regras["localDoProdutoNaLinha"] : "(ausente)", pedidaPeloRunner: pedida ? "1" : "0" });
  expect(ligada, `premissa no fio (${onde}): a chave que a API de pé declara é a que o runner pediu`).toBe(pedida);
  return ligada;
}

/** O local que a célula da linha mostra: o dado, ou o vazio ("—") — a linha com o local do cabeçalho vazio. */
async function localDaLinha(linha: Locator, local: { nome: string } | null, mensagem: string) {
  const celula = linha.getByTestId(`${P}-armazem`);
  // Grade enxuta (decisão 319): sem coluna do Armazém — o POST/gravado prova o local da linha.
  if (!(await celula.count())) return;
  if (local) await expect(celula, mensagem).toContainText(local.nome);
  else await expect(celula, mensagem).toHaveText("—");
}

/** As leituras que o local do produto pode fazer, no fio: o cadastro do produto e TODA pergunta a `warehouses/options`. */
interface Leituras { produto: number; opcoesDoLocal: string[]; conferencias: string[] }
function escutarLeituras(page: Page, produtoId: string): { zerar: () => void; agora: () => Leituras } {
  let produto = 0; let opcoes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") return;
    const u = new URL(r.url());
    if (u.pathname === `/api/resources/products/${produtoId}`) produto++;
    if (u.pathname === "/api/resources/warehouses/options") opcoes.push(u.search);
  });
  return {
    zerar: () => { produto = 0; opcoes = []; },
    agora: () => ({
      produto, opcoesDoLocal: [...opcoes],
      // a CONFERÊNCIA do local na empresa: a pergunta com `id` (o par empresa × local)
      conferencias: opcoes.map((q) => new URLSearchParams(q)).filter((q) => q.has("id")).map((q) => `${q.get("empresa_id")}|${q.get("id")}`)
    })
  };
}

/** Um POST forjado pelo `page.request` — o corpo que a TELA não deixa mandar —, com a sessão da página: o status e a resposta. */
async function postForjado(page: Page, caminho: string, corpo: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const r = await page.request.post(`${process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333"}${caminho}`, { headers: await cabecalhosDaSessao(page), data: corpo });
  return { status: r.status(), json: await r.json().catch(() => null) };
}

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
  const ligada = chaveNoFio(regras, "T1");
  // O LOCAL DA LINHA NOVA: ligada, o do produto; desligada, o do cabeçalho — vazio (sem padrão do layout), como na main.
  const localNovo = ligada ? m.local : null;

  // SEMEADOS, com a dica da TOP enquanto a árvore não responde (aba Rateio — decisão 319).
  await abrirRateio(page);
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
  await abrirFinanceiro(page);
  await expect(campo(page, "forma_pagamento_id"), "a forma (presença do campo)").toHaveCount(1);
  await expect(caixa(page, "forma_pagamento_id"), "a forma opcional continua vazia").toHaveClass(/is-empty/);
  await expect(campo(page, "forma_pagamento_id")).not.toHaveAttribute("data-padrao-top", "semeado");
  await expect(central(page).locator('fieldset[data-travado-pela-top="true"]'), "o documento troca: nada travado pela TOP").toHaveCount(0);
  await expect(page.getByTestId("padrao-invalido-aviso"), "nenhum aviso de padrão inválido").toHaveCount(0);
  await expect(page.getByTestId(`${P}-alterado`), "o semeado entra no inicial: não é alteração").toHaveCount(0);
  // O TIPO DE TÍTULO no Financeiro (S5): semeado com o nome da TOP.
  await extrasFiscais(page);
  const tipo = page.getByTestId("compras-tipo-titulo");
  await expect(tipo, "o tipo de título: semeado pela TOP").toHaveAttribute("data-padrao-top", "semeado");
  await expect(tipo.getByRole("combobox"), "com o nome do padrão").toContainText(m.tipoTitulo.label);

  await preencherOMinimo(page, m);
  await localDaLinha(linhas(page).first(), localNovo, ligada ? "a linha nova nasce com o local do produto" : "desligada: a linha nova com o local do cabeçalho (vazio), como na main");
  const envio = await salvar(page, envios);
  const id = await gravou(page, envio);
  registrar("T1 corpo", { chaves: chaves(envio.corpo), item0: itensDe(envio.corpo)[0] ?? null });

  // O CORPO: as chaves de hoje MENOS o par (o servidor o aplica); sem a forma (vazia) e sem o tipo de título semeado.
  expect(chaves(envio.corpo), "o POST com as chaves de hoje menos natureza e centro").toEqual(semAs(CHAVES_DE_HOJE, OMITIDAS_PELO_PAR));
  for (const k of [...OMITIDAS_PELO_PAR, "forma_pagamento_id", "tipo_titulo_id"]) expect(Object.hasOwn(envio.corpo, k), `${k} fora do corpo`).toBe(false);
  expect(itensDe(envio.corpo).map(chaves), ligada ? "o item com as chaves de hoje" : "desligada: o item sem local, sem a chave do local (a main)").toEqual([ligada ? CHAVES_DO_ITEM_DE_HOJE : CHAVES_DO_ITEM_SEM_LOCAL]);
  expect(itensDe(envio.corpo)[0], ligada ? "o item com o produto e o local dele" : "o item com o produto").toMatchObject({ produto_id: m.produto.id, ...(localNovo ? { armazem_id: localNovo.id } : {}) });

  // O GRAVADO: natureza, centro, forma e tipo de título nulos (como hoje); o item no local do produto (ligada) ou sem local.
  const g = await gravado(page, id);
  registrar("T1 gravado", g);
  expect(g, "o servidor gravou o que o corpo levou").toEqual({ categoria_financeira_id: null, centro_custo_id: null, forma_pagamento_id: null, tipo_titulo_id: null, itens_armazem: [localNovo?.id ?? null] });

  // A PRÉVIA DA CONFIRMAÇÃO: o par da TOP; e a ENTRADA DE ESTOQUE que ela prevê (ligada, no local do produto; desligada,
  // nenhuma — o item sem local fica fora da entrada, como na main).
  const previa = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/${id}/previa-confirmacao`);
  const fin = ehObj(previa["financeiro"]) ? previa["financeiro"] : {};
  registrar("T1 previa", fin);
  expect(fin["efeito"], "a prévia: título a pagar").toBe("pagar");
  expect(fin["classificacao"], "a prévia classifica com o par da TOP").toEqual({
    categoria: { id: m.natureza.id, codigo: m.natureza.codigo, nome: m.natureza.nome }, centro: { id: m.centro.id, codigo: m.centro.codigo, nome: m.centro.nome }, padraoDaTop: true });
  const est = ehObj(previa["estoque"]) ? previa["estoque"] : {};
  expect([est["efeito"], Array.isArray(est["itens"])], "premissa: a prévia dá entrada de estoque (a política) e lista os itens que entram").toEqual(["entrada", true]);
  const previstas = (Array.isArray(est["itens"]) ? (est["itens"] as Record<string, unknown>[]) : []).map((i) => [i["armazem_id"], i["produto_id"]]);
  registrar("T1 previa estoque", { itens: previstas, itensForaDaEntrada: est["itensForaDaEntrada"] ?? null });
  expect(previstas, ligada ? "a prévia: a entrada no local do produto" : "desligada: a prévia sem entrada (o item sem local), como na main").toEqual(localNovo ? [[localNovo.id, m.produto.id]] : []);

  // A CONFIRMAÇÃO: o título com o par e o tipo de título da TOP; e a entrada de estoque que a confirmação FEZ.
  await page.getByTestId("compras-confirmar").click();
  await expect(page.getByTestId("compras-previa")).toHaveAttribute("data-situacao", "pronta");
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "confirmado");
  const confirmada = await api<{ titulos: { id: string }[]; movimentos?: unknown }>(page, "GET", `/api/compras/compras/${id}`);
  expect(Array.isArray(confirmada.movimentos), "premissa: o detalhe da compra confirmada traz as entradas no estoque").toBe(true);
  const entradas = (confirmada.movimentos as Record<string, unknown>[]).map((x) => [x["warehouse_id"], x["product_id"]]);
  registrar("T1 entradas no estoque", entradas);
  expect(entradas, ligada ? "a entrada de estoque no local do produto" : "desligada: nenhuma entrada de estoque (o item sem local), como na main").toEqual(localNovo ? [[localNovo.id, m.produto.id]] : []);
  const titulos = confirmada.titulos;
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
  const ligada = chaveNoFio(regras, "T2");

  const travas = () => central(page).locator('fieldset[data-editavel="false"][data-travado-pela-top="true"]');
  const conferirTrava = async (c: string, rotulo: string) => {
    await expect(campo(page, c), `${c}: semeado pela TOP`).toHaveAttribute("data-padrao-top", "semeado");
    await expect(caixa(page, c), `${c}: com o padrão da TOP`).toContainText(rotulo);
    await expect(travas().locator(`[data-campo="${c}"]`), `${c}: dentro do fieldset da trava`).toHaveCount(1);
    await expect(caixa(page, c), `${c}: o seletor desabilitado`).toBeDisabled();
  };
  // Rateio: natureza e centro (decisão 319).
  await abrirRateio(page);
  for (const [c, rotulo] of [["categoria_financeira_id", m.natureza.nome], ["centro_custo_id", m.centro.nome]] as const) await conferirTrava(c, rotulo);
  await expect(travas(), "dois campos travados pela TOP no Rateio").toHaveCount(2);
  // SEM ESTILO NOVO: a trava é o fieldset do layout, com os mesmos atributos (só a marca de onde veio).
  expect(await travas().evaluateAll((els) => els.map((el) => [el.getAttributeNames().sort().join(","), el.getAttribute("style")])),
    "o fieldset de sempre: disabled, data-editavel, display: contents — e a marca da TOP").toEqual(
    Array.from({ length: 2 }, () => ["data-editavel,data-travado-pela-top,disabled,style", "display: contents;"]));
  await expect(caixa(page, "fornecedor_id"), "o que a TOP não padroniza continua livre").toBeEnabled();
  // Financeiro: forma e tipo de título.
  await abrirFinanceiro(page);
  await conferirTrava("forma_pagamento_id", m.forma.label);
  await extrasFiscais(page);
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
  expect(g, "o gravado: o par nulo (o servidor classifica pela TOP), a forma da TOP; o item no local do produto (ligada) ou sem local (desligada, a main)")
    .toEqual({ categoria_financeira_id: null, centro_custo_id: null, forma_pagamento_id: m.forma.id, tipo_titulo_id: null, itens_armazem: [ligada ? m.local.id : null] });

  // E O SERVIDOR TAMBÉM RECUSA (emenda R2, P4): a trava da tela é a régua do servidor, nunca mais estrita. O MESMO corpo
  // que a tela mandou, FORJADO pelo `page.request` com OUTRO tipo de título (a tela travada não deixa) → a recusa da troca;
  // com o tipo da TOP → grava (a recusa é a TROCA, não o campo).
  const tipos = await api<Opcao[]>(page, "GET", "/api/resources/title_types/options");
  const outroTipo = tipos.find((t) => t.id !== m.tipoTitulo.id);
  expect(outroTipo, "premissa: um segundo tipo de título no seed").toBeTruthy();
  const forjado = await postForjado(page, "/api/compras/compras", { ...envio.corpo, tipo_titulo_id: outroTipo!.id });
  registrar("T2 forjado com outro tipo de título", { tipo: outroTipo!.label, status: forjado.status, json: forjado.json });
  expect(forjado.status, `o servidor recusa a troca do tipo de título: ${JSON.stringify(forjado.json)}`).toBe(422);
  expect(ehObj(forjado.json) ? forjado.json["error"] : null, "a recusa da troca, no caminho da seção, com a mensagem do domínio").toEqual({
    code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG_TROCA_DO_TIPO, details: { exigencias: [{ caminho: "financeiroPadrao.documentoTroca", mensagem: MSG_TROCA_DO_TIPO }] } });
  const comOTipoDaTop = await postForjado(page, "/api/compras/compras", { ...envio.corpo, tipo_titulo_id: m.tipoTitulo.id });
  expect(comOTipoDaTop.status, `premissa: o MESMO corpo com o tipo da TOP grava — a recusa é a troca: ${JSON.stringify(comOTipoDaTop.json)}`).toBe(201);
  const comOTipo = ehObj(comOTipoDaTop.json) ? texto(comOTipoDaTop.json["id"]) : "";
  expect((await gravado(page, comOTipo)).tipo_titulo_id, "e gravou o tipo da TOP").toBe(m.tipoTitulo.id);
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
  chaveNoFio(regras, "T3");
  await abrirRateio(page);
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

  await abrirRateio(page);
  for (const c of ["categoria_financeira_id", "centro_custo_id"]) {
    await expect(campo(page, c), `${c}: o campo está na tela do receber`).toHaveCount(1);
    await expect(caixa(page, c), `${c}: vazio, como veio do pedido`).toHaveClass(/is-empty/);
  }
  await abrirFinanceiro(page);
  await expect(campo(page, "forma_pagamento_id"), "forma_pagamento_id: o campo está na tela do receber").toHaveCount(1);
  await expect(caixa(page, "forma_pagamento_id"), "forma_pagamento_id: vazio, como veio do pedido").toHaveClass(/is-empty/);
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
  chaveNoFio(regras, "T4");

  await abrirRateio(page);
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
  await abrirRateio(page);
  await expect(campo(page, "categoria_financeira_id").locator('[data-parte="erro"]'), "a recusa aparece NO campo").toContainText(MSG_SEM_O_PAR);
  await expect(page, "nada gravado: a Central continua na criação").toHaveURL(/\/compras\/compras\/new\?/);
});

/* ═════════════════════════════════════ LANC-T5 ═════════════════════════════════════ */

test("LANC-T5a — o local do produto: a linha nova nasce com o local do produto da empresa do documento; o de OUTRA empresa é IGNORADO (o POST nunca o leva); o ajuste do operador não muda ao trocar o produto; N linhas do mesmo produto = uma leitura do produto e uma conferência do local (R5) — com a chave DESLIGADA (no fio), as linhas com o local do cabeçalho (vazio), nenhuma conferência, e o ajuste do operador", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const ctx = await api<{ empresas?: { id: string }[] }>(page, "GET", "/api/auth/context");
  const outra = (ctx.empresas ?? []).map((e) => e.id).find((e) => e !== m.empresa);
  expect(outra, "premissa: o usuário vê uma segunda empresa").toBeTruthy();
  const daOutra = await criarLocal(page, outra!, m.tag, "local outra empresa");
  // nomes que não são prefixo um do outro: a pesquisa da grade escolhe pelo nome inteiro
  const comOutra = await criarProduto(page, m, "item da outra empresa", daOutra.id);
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
  const { regras } = await abrirCriacao(page, "compras", top.id);
  const ligada = chaveNoFio(regras, "T5a");
  // ligada, a linha nova nasce no local do produto; desligada, no do cabeçalho (vazio), como na main
  const localNovo = ligada ? m.local : null;
  await escolherNoCampo(page, campo(page, "fornecedor_id"), m.fornecedor.nome);

  // (1) TRÊS linhas do MESMO produto: todas no local dele (ligada); uma leitura do cadastro e uma conferência do local.
  for (let i = 0; i < 3; i++) {
    await novaLinhaCom(page, m.produto);
    await localDaLinha(linhas(page).nth(i), localNovo, ligada ? `linha ${i + 1}: o local do produto` : `linha ${i + 1}: desligada, o local do cabeçalho (vazio)`);
  }
  await estavel(page);
  registrar("T5a leituras", { produto: leituras.length, conferencias });
  // a leitura do cadastro é UMA por produto distinto, com a chave do controle de lote (o local a reusa); a outra
  // leitura do mesmo endereço é a da unidade, do motor da grade, que já existia — e nenhuma cresce com as linhas.
  // Desligada, as MESMAS duas (as de hoje, na compra) e nenhuma conferência do local.
  expect(leituras.length, "o cadastro do produto: a do motor (unidade) e a da Central (lote e local), nenhuma por linha").toBe(2);
  expect(conferencias, ligada ? "uma conferência do local, na empresa do documento" : "desligada: nenhuma conferência do local").toEqual(ligada ? [`${m.empresa}|${m.local.id}`] : []);

  // (2) O produto com o local de OUTRA empresa: ignorado — a linha fica sem local (POST; grade enxuta sem coluna).
  await novaLinhaCom(page, comOutra);
  await estavel(page);
  await localDaLinha(linhas(page).nth(3), null, "linha 4: o local de outra empresa é ignorado");

  // (3) Quinta linha do produto (POST confirma o local). Grade enxuta (decisão 319): sem ajuste por linha na UI —
  // o invariante "ajuste do operador não cai ao trocar o produto" continua coberto quando exigeArmazem força a coluna (T7).
  await novaLinhaCom(page, m.produto);
  await localDaLinha(linhas(page).nth(4), localNovo, ligada ? "linha 5: nasce no local do produto" : "linha 5: desligada, nasce no do cabeçalho (vazio)");

  for (let i = 0; i < 5; i++) await (await entradaDaLinha(linhas(page).nth(i), `Valor unitário do item ${i + 1}`)).fill("10");
  const envio = await salvar(page, envios);
  const id = await gravou(page, envio);
  const noCorpo = itensDe(envio.corpo).map((i) => i["armazem_id"] ?? null);
  registrar("T5a corpo", noCorpo);
  const esperado = [localNovo?.id ?? null, localNovo?.id ?? null, localNovo?.id ?? null, null, localNovo?.id ?? null];
  expect(noCorpo, ligada ? "no POST: o local do produto nas quatro linhas dele e o vazio (outra empresa ignorada)" : "no POST (desligada): sem local nas cinco, como na main").toEqual(esperado);
  expect(JSON.stringify(envio.corpo).includes(daOutra.id), "o POST nunca leva o local da outra empresa").toBe(false);
  expect((await gravado(page, id)).itens_armazem, "o gravado igual ao corpo").toEqual(esperado);
});

test("LANC-T5b — o local ESCOLHIDO pelo operador na LINHA vence o local padrão do produto", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const escolhido = await criarLocal(page, m.empresa, m.tag, "local escolhido");
  const top = await topDoCaso(page, "T5b", { configuracao: configuracaoNeutraTopV5(), padroes: OS_CINCO(m) });
  const envios = escutarPosts(page, "/api/compras/compras");
  // o local é POR LINHA (a coluna da grade): a escolha do operador na célula vence o padrão do produto
  chaveNoFio((await abrirCriacao(page, "compras", top.id)).regras, "T5b");
  await preencherOMinimo(page, m);
  await escolherLocalDaLinha(page, 0, escolhido);
  await estavel(page);
  await localDaLinha(linhas(page).first(), escolhido, "a escolha do operador na linha vence o local do produto");
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
    chaveNoFio(regras, "T6a");
    expect(efetivo, "premissa no fio: o layout ligado com o padrão de cadastro no centro").toMatchObject({ origem: "ligado", id: layout, padroesDeCadastro: { centro_custo_id: { id: doLayout!.id } } });
    registrar("T6a ids", { centroDoLayout: doLayout!.id, centroDaTop: m.centro.id });

    // A TELA (soft: o caso segue até o gravado, que é a conclusão) — Rateio e classificação.
    await abrirRateio(page);
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
    chaveNoFio(regras, "T6b");
    expect(efetivo, "premissa no fio: o layout com o centro da TOP como padrão de cadastro").toMatchObject({ origem: "ligado", id: layout, padroesDeCadastro: { centro_custo_id: { id: m.centro.id } } });
    await abrirRateio(page);
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

test("LANC-T7 — a forma COBRADA (execução do M1-E: forma, local e vencimento exigidos): a forma semeada com a da TOP VAI no POST e o local vem do produto — o primeiro Salvar grava, sem as recusas de forma e de local; sobram fornecedor, produto, valor e vencimento — com a chave DESLIGADA (no fio), o local volta a ser pergunta: a recusa de hoje no local do item, e o operador o responde", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const top = await topDoCaso(page, "T7", { configuracao: configuradaComForma(true), padroes: OS_CINCO(m) });
  const envios = escutarPosts(page, "/api/compras/compras");
  const { regras } = await abrirCriacao(page, "compras", top.id);
  premissaDosPadroes(regras, m, { secao: SECAO_NEUTRA, padroes: CINCO_IDS(m) });
  expect([regras["exigeFormaPagamento"], regras["exigeArmazem"], regras["exigeVencimento"]], "premissa no fio: a execução do M1-E").toEqual([true, true, true]);
  const ligada = chaveNoFio(regras, "T7");
  await abrirFinanceiro(page);
  await expect(campo(page, "forma_pagamento_id"), "a forma cobrada: semeada").toHaveAttribute("data-padrao-top", "semeado");
  await expect(caixa(page, "forma_pagamento_id"), "com a da TOP").toContainText(m.forma.label);
  await expect(campo(page, "forma_pagamento_id").locator('[data-parte="req"]'), "o \"*\" da regra, já preenchido").toHaveCount(1);
  await expect(caixa(page, "forma_pagamento_id"), "o documento troca: a forma não trava").toBeEnabled();

  const gestos: string[] = [];
  await preencherOMinimo(page, m); gestos.push("Fornecedor", "Item 1 · Produto", "Item 1 · Valor unitário");
  await localDaLinha(linhas(page).first(), ligada ? m.local : null, ligada ? "o local exigido: o do produto" : "desligada: a linha com o local do cabeçalho (vazio), como na main");
  await abrirFinanceiro(page);
  const vence = new Date(Date.now() + 30 * 86_400_000);
  const entrada = campo(page, "data_vencimento").locator('input:not([type="hidden"])').first();
  await entrada.fill(dataBr(vence)); await entrada.press("Enter");
  await expect(campo(page, "data_vencimento").locator('input[type="hidden"]')).toHaveValue(dataIso(vence));
  gestos.push("Vencimento");

  let envio = await salvar(page, envios);
  if (!ligada) {
    // DESLIGADA: o local volta a ser pergunta (a main) — a recusa de hoje do servidor, no local do item; o operador
    // escolhe o local na linha e o Salvar seguinte grava. A forma continua semeada (não há recusa de forma).
    registrar("T7 recusa do local (desligada)", { status: envio.status, json: envio.json, item0: itensDe(envio.corpo)[0] ?? null });
    expect(Object.hasOwn(itensDe(envio.corpo)[0] ?? {}, "armazem_id"), "desligada: o item foi sem local").toBe(false);
    expect(envio.status, "desligada: o servidor recusa o item sem local (a de hoje)").toBe(422);
    expect(envio.json, "no local do item, com a mensagem de hoje").toMatchObject({ error: { code: "VALIDATION_ERROR", message: MSG_SEM_O_LOCAL, details: [{ path: "itens[0].armazem_id", message: MSG_SEM_O_LOCAL }] } });
    await escolherLocalDaLinha(page, 0, m.local);
    gestos.push("Item 1 · Local de estoque");
    envio = await salvar(page, envios);
  }
  registrar("T7 gestos", gestos);
  const id = await gravou(page, envio);
  expect(envios.length, ligada ? "um POST só: nenhuma recusa de forma nem de local antes" : "desligada: dois POSTs — a recusa do local e o que gravou; nenhuma recusa de forma").toBe(ligada ? 1 : 2);
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
  const ligada = chaveNoFio(regras, "T8");
  await abrirRateio(page);
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
  // o item de hoje: ligada, com o local do produto; desligada, a linha com o local do cabeçalho vazio — sem a chave do local
  expect(itensDe(envio.corpo).map(chaves), ligada ? "o item de hoje" : "o item de hoje sem local (a linha com o cabeçalho vazio, como na main)").toEqual([ligada ? CHAVES_DO_ITEM_DE_HOJE : CHAVES_DO_ITEM_SEM_LOCAL]);
  expect([envio.corpo["categoria_financeira_id"], envio.corpo["centro_custo_id"]], "o par do operador").toEqual([m.natureza.id, m.centro.id]);
  const g = await gravado(page, id);
  expect([g.categoria_financeira_id, g.centro_custo_id], "o gravado com o par do operador").toEqual([m.natureza.id, m.centro.id]);
  expect(g.itens_armazem, "o item gravado: no local do produto (ligada) ou sem local (desligada)").toEqual([ligada ? m.local.id : null]);
});

/* ═════════════════════════════════════ LANC-T9 ═════════════════════════════════════ */

test("LANC-T9 — o PEDIDO de compra: com a provisão ligada a TOP semeia o par e ele sai do corpo (o servidor aplica o par com qualquer total), a linha nasce no local do produto (leitura nova no pedido: uma por produto distinto) e o pedido finaliza; a MESMA TOP com a provisão desligada não semeia nada — com a chave DESLIGADA (no fio), a linha com o local do cabeçalho (vazio), sem a leitura nova nem a conferência", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const m = await montar(page);
  const neutra = configuracaoNeutraTopV5();
  const comProvisao = await topDoCaso(page, "T9 provisão", { familia: "compras.pedido", configuracao: { ...neutra, financeiroPadrao: { ...neutra.financeiroPadrao, provisao: true } }, padroes: OS_CINCO(m) });
  const semProvisao = await topDoCaso(page, "T9 sem provisão", { familia: "compras.pedido", configuracao: neutra, padroes: OS_CINCO(m) });

  // SEM a provisão: o pedido não é classificado pela TOP no salvar — nada semeado (presença do campo antes da ausência).
  const sem = await abrirCriacao(page, "pedidos", semProvisao.id);
  premissaDosPadroes(sem.regras, m, { secao: SECAO_NEUTRA, padroes: CINCO_IDS(m) });
  await abrirRateio(page);
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
  const ligada = chaveNoFio(com.regras, "T9");
  const localNovo = ligada ? m.local : null;
  await abrirRateio(page);
  for (const c of ["categoria_financeira_id", "centro_custo_id"]) await expect(campo(page, c), `${c}: semeado pela TOP que provisiona`).toHaveAttribute("data-padrao-top", "semeado");
  await abrirFinanceiro(page);
  await expect(caixa(page, "forma_pagamento_id"), "a forma não cobrada: vazia").toHaveClass(/is-empty/);
  await preencherOMinimo(page, m);
  await novaLinhaCom(page, m.produto);
  await (await entradaDaLinha(linhas(page).nth(1), "Valor unitário do item 2")).fill("10");
  for (let i = 0; i < 2; i++) await localDaLinha(linhas(page).nth(i), localNovo, ligada ? `linha ${i + 1}: o local do produto` : `linha ${i + 1}: desligada, o local do cabeçalho (vazio)`);
  await estavel(page);
  registrar("T9 leituras no pedido", { produto: leituras.length, conferencias });
  // ligada: a leitura do motor (unidade) e a da Central (o local); desligada: SÓ a do motor, a de hoje — nenhuma nova
  expect(leituras.length, ligada ? "duas linhas do mesmo produto: a leitura do motor (unidade) e a da Central (o local), nenhuma por linha" : "desligada: só a leitura do motor (unidade), a de hoje — nenhuma leitura nova no pedido").toBe(ligada ? 2 : 1);
  expect(conferencias, ligada ? "uma conferência do local, na empresa do documento" : "desligada: nenhuma conferência do local").toEqual(ligada ? [`${m.empresa}|${m.local.id}`] : []);

  const envio = await salvar(page, envios);
  const id = await gravou(page, envio, "pedidos");
  registrar("T9 corpo", { chaves: chaves(envio.corpo), itens: itensDe(envio.corpo).map((i) => i["armazem_id"] ?? null) });
  for (const k of OMITIDAS_PELO_PAR) expect(Object.hasOwn(envio.corpo, k), `${k}: o par semeado fora do corpo do pedido`).toBe(false);
  expect(itensDe(envio.corpo).map((i) => i["armazem_id"] ?? null), ligada ? "os itens no local do produto" : "desligada: os itens sem local, como na main").toEqual([localNovo?.id ?? null, localNovo?.id ?? null]);
  const g = await gravado(page, id, "pedidos");
  expect([g.categoria_financeira_id, g.centro_custo_id], "o pedido gravado com o par nulo, como hoje").toEqual([null, null]);
  expect(g.itens_armazem, "os itens gravados como o corpo os levou").toEqual([localNovo?.id ?? null, localNovo?.id ?? null]);
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
    chaveNoFio(regras, `T10 ${c.segmento}`);
    expect(regras["exigencias"], `premissa no fio (${c.segmento}): a TOP exige o centro de resultado`).toEqual(["centro_custo_id"]);
    await abrirRateio(page);
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
  chaveNoFio(regras, "T11");
  await abrirRateio(page);
  for (const k of OMITIDAS_PELO_PAR) await expect(campo(page, k), `${k}: semeado pela TOP`).toHaveAttribute("data-padrao-top", "semeado");
  await escolherNoCampo(page, campo(page, "fornecedor_id"), m.fornecedor.nome);
  await novaLinhaCom(page, m.produto);
  await expect(await entradaDaLinha(linhas(page).first(), "Valor unitário do item 1"), "premissa: o valor unitário fica no zero com que a linha nasce").toHaveValue("0");
  await abrirAbaDoPainelDeCompras(page, "Totais");
  await expect(page.getByTestId("compras-total"), "premissa: o total do documento é zero").toContainText("0,00");
  await abrirRateio(page);
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

/* ═════════════════════════════════════ LANC-T12 ═════════════════════════════════════ */

/** Um layout de compra (a cópia do do sistema) com o padrão de cadastro no Local de estoque dos ITENS, ligado à TOP. */
async function layoutComOLocal(page: Page, topId: string, localId: string): Promise<string> {
  const estrutura: EstruturaLayout = structuredClone(LAYOUT_DO_SISTEMA("compras.compra"));
  expect(estrutura.itens.map((x) => x.campo), "premissa: o local está nos itens do layout do sistema da compra").toContain("armazem_id");
  estrutura.itens = estrutura.itens.map((x) => (x.campo === "armazem_id" ? { ...x, valorPadrao: { tipo: "registro" as const, id: localId } } : x));
  const id = (await api<{ id: string }>(page, "POST", LAYOUTS, { familia: "compras.compra", nome: uniq("Layout LANC-T12"), estrutura })).id;
  await api(page, "PUT", `${LAYOUTS}/${id}/tops`, { tipoOperacaoIds: [topId] });
  return id;
}

test("LANC-T12 — a CHAVE do local do produto (emenda R2), lida no fio: DESLIGADA, N linhas do mesmo produto não fazem NENHUMA leitura nova — zero `warehouses/options`; no pedido, de `products/:id` só a do motor da grade (a unidade), a de hoje; na compra, a do motor e a do controle de lote, as de hoje — e a linha nova nasce e fica com o local do CABEÇALHO (o padrão do layout na compra, o vazio no pedido), gravada assim, como na main; LIGADA, o MESMO cenário assegura o ramo ligado; e a resposta SEM a chave (a API anterior, fabricada no fio) fecha o portão nos dois mundos", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const m = await montar(page);
  const doCabecalho = await criarLocal(page, m.empresa, m.tag, "local do cabecalho");
  // As TOPs de hoje, sem padrões: o operador responde o par na compra (o mesmo caso roda contra a API da main).
  const compra = await topDoCaso(page, "T12 compra");
  const pedido = await topDoCaso(page, "T12 pedido", { familia: "compras.pedido" });
  const layout = await layoutComOLocal(page, compra.id, doCabecalho.id);
  const N = 3;
  const leituras = escutarLeituras(page, m.produto.id);
  const valores = async () => { for (let i = 0; i < N; i++) await (await entradaDaLinha(linhas(page).nth(i), `Valor unitário do item ${i + 1}`)).fill("10"); };

  // (1) A COMPRA, com o local do CABEÇALHO vindo do padrão do layout (não escolhido pelo operador): ligada, o local do
  // produto vence a base; desligada, a linha fica com o do cabeçalho — a main.
  await comLayout(page, layout, async () => {
    const envios = escutarPosts(page, "/api/compras/compras");
    const { regras, layout: efetivo } = await abrirCriacao(page, "compras", compra.id);
    const ligada = chaveNoFio(regras, "T12 compra");
    expect(efetivo, "premissa no fio: o layout ligado com o padrão de cadastro no local dos itens").toMatchObject({ origem: "ligado", id: layout, padroesDeCadastro: { "itens.armazem_id": { id: doCabecalho.id } } });
    const localNovo = ligada ? m.local : doCabecalho;
    leituras.zerar();
    await escolherNoCampo(page, campo(page, "fornecedor_id"), m.fornecedor.nome);
    for (let i = 0; i < N; i++) {
      await novaLinhaCom(page, m.produto);
      await localDaLinha(linhas(page).nth(i), localNovo, ligada ? `compra, linha ${i + 1}: o local do produto (vence a base do cabeçalho)` : `compra, linha ${i + 1}: desligada, o local do cabeçalho`);
    }
    await estavel(page);
    const lidas = leituras.agora();
    registrar("T12 compra leituras", lidas);
    expect(lidas.produto, "compra: o cadastro do produto lido pelo motor (unidade) e pelo controle de lote — as de hoje, nenhuma por linha").toBe(2);
    if (ligada) expect(lidas.conferencias, "compra ligada: uma conferência do local do produto, na empresa do documento").toEqual([`${m.empresa}|${m.local.id}`]);
    else expect(lidas.opcoesDoLocal, "compra desligada: NENHUMA pergunta a warehouses/options").toEqual([]);
    await abrirRateio(page);
    await escolherNoCampo(page, campo(page, "categoria_financeira_id"), m.natureza.label);
    await escolherNoCampo(page, campo(page, "centro_custo_id"), m.centro.label);
    await valores();
    const envio = await salvar(page, envios);
    const id = await gravou(page, envio);
    const noCorpo = itensDe(envio.corpo).map((i) => i["armazem_id"] ?? null);
    registrar("T12 compra corpo", noCorpo);
    expect(itensDe(envio.corpo).map(chaves), "compra: os itens com as chaves de hoje").toEqual(Array.from({ length: N }, () => CHAVES_DO_ITEM_DE_HOJE));
    expect(noCorpo, ligada ? "compra ligada: o local do produto no POST" : "compra desligada: o local do cabeçalho no POST").toEqual(Array.from({ length: N }, () => localNovo.id));
    expect((await gravado(page, id)).itens_armazem, "compra: o gravado igual ao corpo").toEqual(noCorpo);
  });

  // (2) O PEDIDO, sem layout (o cabeçalho vazio): ligada, a leitura NOVA do produto e a conferência; desligada, nenhuma.
  {
    const envios = escutarPosts(page, "/api/compras/pedidos");
    const { regras } = await abrirCriacao(page, "pedidos", pedido.id);
    const ligada = chaveNoFio(regras, "T12 pedido");
      const localNovo = ligada ? m.local : null;
    leituras.zerar();
    await escolherNoCampo(page, campo(page, "fornecedor_id"), m.fornecedor.nome);
    for (let i = 0; i < N; i++) {
      await novaLinhaCom(page, m.produto);
      await localDaLinha(linhas(page).nth(i), localNovo, ligada ? `pedido, linha ${i + 1}: o local do produto` : `pedido, linha ${i + 1}: desligada, o local do cabeçalho (vazio)`);
    }
    await estavel(page);
    const lidas = leituras.agora();
    registrar("T12 pedido leituras", lidas);
    expect(lidas.produto, ligada ? "pedido ligado: a leitura do motor (unidade) e a NOVA da Central (o local), nenhuma por linha" : "pedido desligado: só a leitura do motor (unidade), a de hoje — nenhuma products/:id nova").toBe(ligada ? 2 : 1);
    if (ligada) expect(lidas.conferencias, "pedido ligado: uma conferência do local do produto").toEqual([`${m.empresa}|${m.local.id}`]);
    else expect(lidas.opcoesDoLocal, "pedido desligado: NENHUMA pergunta a warehouses/options").toEqual([]);
    await valores();
    const envio = await salvar(page, envios);
    const id = await gravou(page, envio, "pedidos");
    const noCorpo = itensDe(envio.corpo).map((i) => i["armazem_id"] ?? null);
    registrar("T12 pedido corpo", { chaves: itensDe(envio.corpo).map(chaves), armazem: noCorpo });
    expect(itensDe(envio.corpo).map(chaves), ligada ? "pedido ligado: os itens com o local" : "pedido desligado: os itens sem a chave do local, como na main")
      .toEqual(Array.from({ length: N }, () => (ligada ? CHAVES_DO_ITEM_DE_HOJE : CHAVES_DO_ITEM_SEM_LOCAL)));
    expect(noCorpo, "pedido: o local de cada item no POST").toEqual(Array.from({ length: N }, () => localNovo?.id ?? null));
    expect((await gravado(page, id, "pedidos")).itens_armazem, "pedido: o gravado igual ao corpo").toEqual(noCorpo);
  }

  // (3) A API ANTERIOR: a MESMA resposta de `regras-da-operacao` SEM a chave (fabricada no fio, o resto intacto). A tela é
  // fail-closed — ausente é desligada — nos DOIS mundos: nenhuma leitura nova, a linha com o local do cabeçalho (vazio).
  const rotaDasRegras = (u: URL) => u.pathname === "/api/compras/pedidos/regras-da-operacao" && u.searchParams.get("tipo_operacao_id") === pedido.id;
  await page.route(rotaDasRegras, async (rota) => {
    const r = await rota.fetch();
    const corpo = (await r.json()) as Record<string, unknown>;
    await rota.fulfill({ response: r, json: Object.fromEntries(Object.entries(corpo).filter(([k]) => k !== "localDoProdutoNaLinha")) });
  });
  {
    const { regras } = await abrirCriacao(page, "pedidos", pedido.id);
    registrar("T12 API anterior: as chaves que a página recebeu", Object.keys(regras));
    expect(Object.hasOwn(regras, "localDoProdutoNaLinha"), "premissa no fio: a página recebeu a resposta SEM a chave (a API anterior)").toBe(false);
    expect([Object.keys(regras).at(-1), Array.isArray(regras["exigencias"])], "premissa: o resto da resposta intacto (regrasGerais a última)").toEqual(["regrasGerais", true]);
    leituras.zerar();
    await escolherNoCampo(page, campo(page, "fornecedor_id"), m.fornecedor.nome);
    for (let i = 0; i < N; i++) {
      await novaLinhaCom(page, m.produto);
      await localDaLinha(linhas(page).nth(i), null, `API anterior, linha ${i + 1}: o local do cabeçalho (vazio) — o portão fechado`);
    }
    await estavel(page);
    const lidas = leituras.agora();
    registrar("T12 API anterior leituras", lidas);
    expect(lidas.produto, "API anterior: só a leitura do motor (unidade) — a ausência fecha o portão").toBe(1);
    expect(lidas.opcoesDoLocal, "API anterior: NENHUMA pergunta a warehouses/options").toEqual([]);
  }
  await page.unroute(rotaDasRegras);
});
