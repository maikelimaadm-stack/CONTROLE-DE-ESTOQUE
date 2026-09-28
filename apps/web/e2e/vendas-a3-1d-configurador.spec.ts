import { test, expect, type Page, type Locator, type Response } from "@playwright/test";
import { login, api, uniq, abrirAbaDoLancamento } from "./helpers";
import { TEXTOS, rotuloDaTop } from "../src/features/admin/layout-configurador/contrato";

/**
 * VENDAS-A3-1d (decisão 262) — A TELA ÚNICA DOS LAYOUTS E O "ONDE ESTÁ EM USO" (API e banco REAIS; nada mockado).
 *
 * A grade em cima, a área de configuração embaixo, sem passo "Editar". Aqui se mede o que o usuário precisa enxergar
 * para não salvar um layout que ninguém usa: o assistente Novo pulando o passo 3 (LD2-W1), o assistente marcando
 * "Usar como padrão" (LD2-W2), ligar uma TOP pelo Visualizar TOPs e abrir a Central em seguida sem cache velho (LD2-W3)
 * e o link direto / "Configurar" da Central (LD2-W4). Os textos conferidos são os de `TEXTOS` (um dono só).
 *
 * Anti-vacuidade: toda ausência vem depois de uma presença positiva do mesmo tipo de alvo.
 * Limpeza (finally): desliga as TOPs dos layouts, inativa os layouts e as TOPs criados e devolve o padrão do
 * movimento a quem o tinha. Nada é apagado.
 */

const FAM = "vendas.orcamento";
/** Segmento da Central para o movimento Orçamento (`variantesDeVenda()`: vendas.orcamento → budgets). */
const SEGMENTO = "budgets";
const BASE = "/api/admin/layouts-documento";
const ROTA_LAYOUTS = "/configuracoes?tab=operacoes&sub=layouts-documento";
const rotaDoLayout = (id: string) => `/configuracoes/layouts-documento/${id}`;
const rotaDaCentral = (top: string) => `/vendas/${SEGMENTO}/new?tipo_operacao_id=${top}`;
const ROTULO_VENC = "Venc. LD2-W2";

type Campo = { campo: string; rotulo?: string; obrigatorio: boolean; editavel: boolean; grupo?: "principal" | "adicionais" };
type Estrutura = { versaoSchema: 1; cabecalho: Campo[]; rodape: { aba: string; campos: Campo[] }[]; itens: { campo: string; obrigatorio: boolean }[] };
type Detalhe = { id: string; code: string; nome: string; familia: string; padrao: boolean; is_active: boolean; estrutura: Estrutura; tops: { id: string; codigo: string; nome: string }[] };
type Linha = { id: string; nome: string; padrao: boolean; is_active: boolean; qtdTops: number };
type Efetivo = { origem: string; id: string | null; nome: string | null };
type TopCriada = { id: string; codigo: string; nome: string };

const tid = (page: Page, id: string) => page.getByTestId(id);
const campoPrevia = (page: Page, chave: string) => tid(page, `config-campo-${chave}`);
const todosDoDocumento = (e: Estrutura) => [...e.cabecalho, ...e.rodape.flatMap((a) => a.campos)];

async function criarLayoutPorApi(page: Page, nome: string): Promise<{ id: string; code: string }> {
  return api<{ id: string; code: string }>(page, "POST", BASE, { familia: FAM, nome });
}
async function lerLayout(page: Page, id: string): Promise<Detalhe> { return api<Detalhe>(page, "GET", `${BASE}/${id}`); }
/** Quem é o padrão ATIVO do movimento agora (para devolver no finally). */
async function padraoDoMovimento(page: Page): Promise<string | null> {
  const r = await api<{ items: Linha[] }>(page, "GET", `${BASE}?familia=${FAM}`);
  return r.items.find((l) => l.padrao && l.is_active)?.id ?? null;
}
async function criarTop(page: Page, prefixo: string): Promise<TopCriada> {
  const codigo = `3d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const nome = uniq(prefixo);
  const { id } = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: FAM, nome });
  return { id, codigo, nome };
}
async function efetivoPorApi(page: Page, top: string): Promise<Efetivo> {
  return api<Efetivo>(page, "GET", `/api/sales/${SEGMENTO}/layout-efetivo?tipo_operacao_id=${top}`);
}

/** VENDAS-A3-1d (decisão 262): limpeza sem apagar — desliga TOPs, inativa layouts e TOPs criados. */
async function limpar(page: Page, layouts: string[], tops: string[]) {
  for (const id of layouts) await api(page, "PUT", `${BASE}/${id}/tops`, { tipoOperacaoIds: [] }).catch(() => undefined);
  for (const id of layouts) await api(page, "POST", `${BASE}/${id}/ativo`, { ativo: false }).catch(() => undefined);
  for (const id of tops) {
    await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${id}`)
      .then((t) => api(page, "PUT", `/api/admin/tipos-operacao/${id}`, { ativo: false, revisao: t.revisao }))
      .catch(() => undefined);
  }
}

/** Salva a área e devolve o status do PUT que a tela disparou. */
async function salvar(page: Page, id: string): Promise<number> {
  const put = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `${BASE}/${id}`);
  await tid(page, "config-salvar").click();
  return (await put).status();
}

/** O id do layout que o assistente criou, pela resposta do POST (criar do sistema ou duplicar o modelo). */
function esperarCriacao(page: Page, caminho: string): Promise<string> {
  return page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === caminho)
    .then(async (r) => {
      expect(r.status(), `o assistente criou o layout (${caminho})`).toBe(201);
      return ((await r.json()) as { id: string }).id;
    });
}

/** VENDAS-A3-1d (decisão 262): assistente Novo — passo 1 (Movimento e Descrição) e passo 2 (Modelo); para no passo 3. */
async function assistenteAtePasso3(page: Page, nome: string, modelo: string) {
  await tid(page, "layouts-novo").click();
  await expect(tid(page, "layout-novo")).toBeVisible();
  await expect(tid(page, "layout-novo-passo-1")).toBeVisible();
  await tid(page, "layout-novo-familia").selectOption(FAM);
  await tid(page, "layout-novo-nome").fill(nome);
  await tid(page, "layout-novo-avancar").click();
  await expect(tid(page, "layout-novo-passo-2")).toBeVisible();
  await tid(page, "layout-novo-origem").selectOption(modelo);
  await tid(page, "layout-novo-avancar").click();
  await expect(tid(page, "layout-novo-passo-3")).toBeVisible();
}

async function abrirCentral(page: Page, top: string) {
  await page.goto(rotaDaCentral(top));
  await expect(tid(page, "top-contexto"), "a Central abriu o formulário desta TOP").toBeVisible();
}

/** Abre a aba "Frete e transporte" da Central e devolve o painel (só a aba ativa é desenhada). */
async function painelDoFrete(page: Page): Promise<Locator> {
  await abrirAbaDoLancamento(page, "Frete e transporte");
  return page.getByTestId("central-vendas-painel").getByRole("tabpanel");
}

const ehLayoutEfetivoDaTop = (top: string) => (r: Response) => {
  if (r.request().method() !== "GET") return false;
  const u = new URL(r.url());
  return u.pathname === `/api/sales/${SEGMENTO}/layout-efetivo` && u.searchParams.get("tipo_operacao_id") === top;
};

test("LD2-W1 — assistente pulando o passo 3: \"Não está em uso\" na grade e na faixa; salvar avisa; a Central não usa o layout", async ({ page }) => {
  await login(page);
  const layouts: string[] = [];
  const tops: string[] = [];
  try {
    const top = await criarTop(page, "LD2-W1 TOP");
    tops.push(top.id);
    const nome = uniq("LD2-W1 Layout");

    await page.goto(ROTA_LAYOUTS);
    await expect(tid(page, "layouts-tela")).toBeVisible();
    await expect(tid(page, "layouts-documento")).toBeVisible();
    await assistenteAtePasso3(page, nome, "sistema");

    // VENDAS-A3-1d (decisão 262): passo 3 PULADO — havia TOP para escolher, e nada foi marcado nem ligado
    await expect(tid(page, "layout-novo-tops-disponiveis").getByTestId(`layout-novo-top-${top.id}`), "presença: a TOP do movimento estava disponível").toBeVisible();
    await expect(tid(page, "layout-novo-tops-ligadas").locator('[data-testid^="layout-novo-top-"]')).toHaveCount(0);
    await expect(tid(page, "layout-novo-padrao")).not.toBeChecked();
    await expect(tid(page, "layout-novo-aviso-nao-usado")).toContainText(TEXTOS.novoNaoUsado);
    const criado = esperarCriacao(page, BASE);
    await tid(page, "layout-novo-criar").click();
    const id = await criado;
    layouts.push(id);
    await expect(tid(page, "layout-novo")).toHaveCount(0);

    // Grade: a linha nova selecionada e "Não está em uso"; área: faixa amarela com os dois caminhos
    const linha = tid(page, `layout-linha-${id}`);
    await expect(linha).toHaveAttribute("data-selecionado", "true");
    await expect(linha).toHaveAttribute("data-padrao", "false");
    const emUso = tid(page, `layout-em-uso-${id}`);
    await expect(emUso).toContainText(TEXTOS.naoEstaEmUso);
    await expect(emUso).toHaveAttribute("data-em-uso", "false");
    await expect(tid(page, "config-layout-pagina")).toBeVisible();
    // VENDAS-A3-1d (decisão 262): sem passo "Editar" — com permissão (o admin tem) o nome já é um Input
    await expect(tid(page, "config-nome"), "a área é a do layout criado").toHaveValue(nome);
    await expect(tid(page, "config-status")).toHaveAttribute("data-estado", "nao-usado");
    await expect(tid(page, "config-status-nao-usado")).toContainText(TEXTOS.naoUsado);
    await expect(tid(page, "config-status-visualizar-tops")).toBeVisible();
    await expect(tid(page, "config-status-usar-padrao")).toBeVisible();
    const criadoNoServidor = await lerLayout(page, id);
    expect(criadoNoServidor).toMatchObject({ nome, familia: FAM, padrao: false, is_active: true });
    expect(criadoNoServidor.tops, "nenhuma TOP ligada").toEqual([]);

    // Mexer num campo (Data de saída sai pelas ações sem mouse) e Salvar → o aviso vem na confirmação
    await expect(tid(page, "config-salvar"), "sem mudança, Salvar desligado").toBeDisabled();
    await expect(campoPrevia(page, "client_id"), "presença: a prévia está desenhada").toBeVisible();
    await campoPrevia(page, "shipping_date").click();
    await expect(campoPrevia(page, "shipping_date")).toHaveAttribute("data-selecionado", "true");
    await tid(page, "config-acao-remover").click();
    await expect(tid(page, "config-disponivel-shipping_date")).toBeVisible();
    await expect(campoPrevia(page, "shipping_date")).toHaveCount(0);
    await expect(tid(page, "config-salvar")).toBeEnabled();
    expect(await salvar(page, id), "o layout foi gravado").toBe(200);
    await expect(tid(page, "layout-salvo")).toContainText("Layout salvo.");
    const aviso = tid(page, "config-salvo-nao-usado");
    await expect(aviso).toContainText(TEXTOS.naoUsado);
    await expect(tid(page, "config-salvo-nao-usado-visualizar-tops")).toBeVisible();
    await expect(tid(page, "config-salvo-nao-usado-usar-padrao")).toBeVisible();
    const gravado = await lerLayout(page, id);
    expect(gravado.estrutura.cabecalho.map((c) => c.campo), "presença: Cliente continua").toContain("client_id");
    expect(gravado.estrutura.cabecalho.map((c) => c.campo), "Data de saída saiu").not.toContain("shipping_date");

    // A Central de uma TOP do movimento NÃO usa este layout (linha "Layout:" presente, sem ele)
    await abrirCentral(page, top.id);
    const efetivo = tid(page, "central-layout-efetivo");
    await expect(efetivo).toBeVisible();
    await expect(efetivo).toContainText("Layout:");
    await expect(efetivo).not.toHaveAttribute("data-origem", "ligado");
    await expect(efetivo).not.toHaveAttribute("data-layout-id", id);
    await expect(efetivo).not.toContainText(nome);
    const doServidor = await efetivoPorApi(page, top.id);
    expect(doServidor.origem, "presença: o servidor respondeu o layout efetivo").toBeTruthy();
    expect(doServidor.id, "o servidor também não usa o layout novo").not.toBe(id);
  } finally {
    await limpar(page, layouts, tops);
  }
});

test("LD2-W2 — assistente com \"Usar como padrão\": status de padrão; a Central de TOP sem layout ligado usa e obedece a ele", async ({ page }) => {
  await login(page);
  const layouts: string[] = [];
  const tops: string[] = [];
  // VENDAS-A3-1d (decisão 262): este teste troca o padrão do movimento — lê quem era para devolver no finally
  const padraoAnterior = await padraoDoMovimento(page);
  try {
    const top = await criarTop(page, "LD2-W2 TOP");
    tops.push(top.id);

    // Modelo com estrutura própria: Vencimento renomeado e sem ICMS frete (é o que a Central tem de obedecer)
    const modelo = await criarLayoutPorApi(page, uniq("LD2-W2 Modelo"));
    layouts.push(modelo.id);
    const m = await lerLayout(page, modelo.id);
    expect(m.estrutura.cabecalho.some((c) => c.campo === "due_date"), "premissa: Vencimento nasce no cabeçalho").toBe(true);
    expect(todosDoDocumento(m.estrutura).some((c) => c.campo === "freight_icms"), "premissa: ICMS frete nasce no layout").toBe(true);
    const estrutura: Estrutura = {
      ...m.estrutura,
      cabecalho: m.estrutura.cabecalho.map((c) => (c.campo === "due_date" ? { ...c, rotulo: ROTULO_VENC } : c)),
      rodape: m.estrutura.rodape.map((a) => ({ ...a, campos: a.campos.filter((c) => c.campo !== "freight_icms") }))
    };
    await api(page, "PUT", `${BASE}/${modelo.id}`, { estrutura });
    const modeloGravado = (await lerLayout(page, modelo.id)).estrutura;

    const nome = uniq("LD2-W2 Padrão");
    await page.goto(ROTA_LAYOUTS);
    await expect(tid(page, "layouts-tela")).toBeVisible();
    await assistenteAtePasso3(page, nome, modelo.id);
    await expect(tid(page, "layout-novo-aviso-nao-usado"), "premissa: sem padrão e sem TOP o assistente avisa").toContainText(TEXTOS.novoNaoUsado);
    await tid(page, "layout-novo-padrao").check();
    await expect(tid(page, "layout-novo-padrao")).toBeChecked();
    await expect(tid(page, "layout-novo-aviso-nao-usado"), "com padrão marcado, o aviso some").toHaveCount(0);
    const criado = esperarCriacao(page, `${BASE}/${modelo.id}/duplicar`);
    await tid(page, "layout-novo-criar").click();
    const id = await criado;
    layouts.push(id);
    await expect(tid(page, "layout-novo")).toHaveCount(0);

    // Grade e área: padrão do movimento, em uso
    const linha = tid(page, `layout-linha-${id}`);
    await expect(linha).toHaveAttribute("data-selecionado", "true");
    await expect(linha).toHaveAttribute("data-padrao", "true");
    const emUso = tid(page, `layout-em-uso-${id}`);
    await expect(emUso).toHaveAttribute("data-em-uso", "true");
    await expect(emUso).toContainText("Padrão do movimento");
    await expect(tid(page, "config-layout-pagina")).toBeVisible();
    await expect(tid(page, "config-nome"), "a área é a do layout criado").toHaveValue(nome);
    await expect(tid(page, "config-padrao-selo")).toBeVisible();
    const status = tid(page, "config-status");
    await expect(status).toHaveAttribute("data-estado", "padrao");
    const [antesDoMovimento = "", depoisDoMovimento = ""] = TEXTOS.emUsoPadrao("§").split("§");
    await expect(status).toContainText(antesDoMovimento.trim());
    await expect(status).toContainText(depoisDoMovimento.trim());
    await expect(tid(page, "config-status-nao-usado")).toHaveCount(0);

    // O servidor: nasceu padrão, com o nome pedido e a estrutura do modelo; o padrão anterior perdeu o posto
    const d = await lerLayout(page, id);
    expect(d).toMatchObject({ nome, familia: FAM, padrao: true, is_active: true });
    expect(d.estrutura, "mesma estrutura do modelo").toEqual(modeloGravado);
    expect(await padraoDoMovimento(page), "o padrão do movimento agora é o layout criado").toBe(id);

    // A Central de uma TOP SEM layout ligado usa o padrão — e obedece a ele
    await abrirCentral(page, top.id);
    const efetivo = tid(page, "central-layout-efetivo");
    await expect(efetivo).toHaveAttribute("data-origem", "padrao_da_familia");
    await expect(efetivo).toHaveAttribute("data-layout-id", id);
    await expect(efetivo).toContainText(`Layout: ${nome} (padrão do movimento)`);
    expect(await efetivoPorApi(page, top.id)).toMatchObject({ origem: "padrao_da_familia", id });
    const dados = tid(page, "central-vendas-dados");
    await expect(dados.locator('[data-campo="due_date"]')).toContainText(ROTULO_VENC);
    const frete = await painelDoFrete(page);
    await expect(frete.locator('[data-campo="freight"]'), "presença: o Frete está na aba").toBeVisible();
    await expect(page.locator('[data-campo="freight_icms"]'), "o padrão tirou o ICMS frete").toHaveCount(0);
  } finally {
    if (padraoAnterior) await api(page, "POST", `${BASE}/${padraoAnterior}/padrao`, {}).catch(() => undefined);
    await limpar(page, layouts, tops);
  }
});

test("LD2-W3 — Visualizar TOPs: Salvar só depois de mover; \"Abrir na Central\" em < 15 s mostra o layout ligado (o cache da Central caiu)", async ({ page }) => {
  await login(page);
  const layouts: string[] = [];
  const tops: string[] = [];
  try {
    const top = await criarTop(page, "LD2-W3 TOP");
    tops.push(top.id);
    const nome = uniq("LD2-W3 Layout");
    const layout = await criarLayoutPorApi(page, nome);
    layouts.push(layout.id);
    const antes = await lerLayout(page, layout.id);
    const iFrete = antes.estrutura.rodape.findIndex((a) => a.aba === "Frete e transporte");
    expect(iFrete, "premissa: a cópia do sistema tem a aba Frete e transporte").toBeGreaterThanOrEqual(0);
    expect(antes.estrutura.rodape[iFrete]?.campos.map((c) => c.campo), "premissa: ICMS frete nasce no layout").toContain("freight_icms");

    // 1) O layout tira o ICMS frete (ações sem mouse) e é salvo — ANTES de ligar a TOP
    await page.goto(rotaDoLayout(layout.id));
    await expect(tid(page, `layout-linha-${layout.id}`)).toHaveAttribute("data-selecionado", "true");
    await expect(tid(page, "config-layout-pagina")).toBeVisible();
    await tid(page, `config-aba-${iFrete}`).click();
    await expect(campoPrevia(page, "freight"), "presença: o Frete está na aba").toBeVisible();
    await campoPrevia(page, "freight_icms").click();
    await expect(campoPrevia(page, "freight_icms")).toHaveAttribute("data-selecionado", "true");
    await tid(page, "config-acao-remover").click();
    await expect(tid(page, "config-disponivel-freight_icms")).toBeVisible();
    await expect(campoPrevia(page, "freight_icms")).toHaveCount(0);
    expect(await salvar(page, layout.id), "o layout foi gravado").toBe(200);
    await expect(tid(page, "layout-salvo")).toBeVisible();
    const gravado = todosDoDocumento((await lerLayout(page, layout.id)).estrutura).map((c) => c.campo);
    expect(gravado, "presença: Frete continua").toContain("freight");
    expect(gravado, "ICMS frete saiu").not.toContain("freight_icms");

    // 2) ANTES de ligar: a Central da TOP não usa este layout e mostra o ICMS frete — e a resposta fica no cache
    // A hora é a da CHEGADA da resposta (é dela que conta o staleTime de 15 s do cache da Central)
    const respostaDaCentral = page.waitForResponse(ehLayoutEfetivoDaTop(top.id)).then((r) => ({ ok: r.ok(), em: Date.now() }));
    await abrirCentral(page, top.id);
    const primeira = await respostaDaCentral;
    expect(primeira.ok, "a Central perguntou o layout efetivo da TOP").toBe(true);
    const cacheDesde = primeira.em;
    const efetivo = tid(page, "central-layout-efetivo");
    await expect(efetivo).toBeVisible();
    await expect(efetivo).toContainText("Layout:");
    await expect(efetivo).not.toHaveAttribute("data-origem", "ligado");
    await expect(efetivo).not.toHaveAttribute("data-layout-id", layout.id);
    await expect(efetivo).not.toContainText(nome);
    const freteAntes = await painelDoFrete(page);
    await expect(freteAntes.locator('[data-campo="freight"]')).toBeVisible();
    await expect(freteAntes.locator('[data-campo="freight_icms"]'), "premissa: antes de ligar, a Central desta TOP mostra o ICMS frete").toBeVisible();
    // Marca no documento: se alguma navegação abaixo recarregar a página, o cache some e o teste não provaria nada
    await page.evaluate(() => { Object.assign(window, { __ld2w3: true }); });

    // 3) Volta pela navegação do cliente ("Configurar" da Central) e seleciona o layout na grade
    await tid(page, "central-layout-configurar").click();
    await expect(tid(page, "layouts-tela")).toBeVisible();
    await tid(page, `layout-linha-${layout.id}`).click();
    await expect(tid(page, `layout-linha-${layout.id}`)).toHaveAttribute("data-selecionado", "true");
    await expect(tid(page, "config-status")).toHaveAttribute("data-estado", "nao-usado");

    // 4) Visualizar TOPs: selecionar sem mover NÃO liga (Salvar desligado + aviso); mover → Salvar
    await tid(page, "layouts-visualizar-tops").click();
    const dialogo = tid(page, "config-tops-dialogo");
    await expect(dialogo).toBeVisible();
    const disponiveis = tid(page, "config-tops-disponiveis");
    const ligadas = tid(page, "config-tops-ligadas");
    const salvarTops = tid(page, "config-tops-salvar");
    await expect(disponiveis.getByTestId(`config-top-${top.id}`)).toBeVisible();
    await expect(salvarTops, "nada mudou: Salvar desligado").toBeDisabled();
    await disponiveis.getByTestId(`config-top-${top.id}`).click();
    await expect(tid(page, "config-tops-pendente")).toContainText(TEXTOS.topsPendente);
    await expect(salvarTops, "selecionada e não movida: Salvar continua desligado").toBeDisabled();
    await tid(page, "config-tops-mover").click();
    await expect(ligadas.getByTestId(`config-top-${top.id}`)).toBeVisible();
    await expect(disponiveis.getByTestId(`config-top-${top.id}`)).toHaveCount(0);
    await expect(tid(page, "config-tops-pendente")).toHaveCount(0);
    await expect(salvarTops).toBeEnabled();
    const put = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `${BASE}/${layout.id}/tops`);
    await salvarTops.click();
    expect((await put).status(), "as TOPs foram gravadas").toBe(200);
    const salvouTops = Date.now();
    await expect(tid(page, "config-tops-salvo")).toBeVisible();
    await expect(salvarTops, "gravado = o novo: Salvar volta a desligar").toBeDisabled();
    await tid(page, "config-tops-fechar").click();
    await expect(dialogo).toHaveCount(0);

    // 5) Status: em uso na TOP, com o "Abrir na Central" dela
    const status = tid(page, "config-status");
    await expect(status).toHaveAttribute("data-estado", "tops");
    await expect(status).toContainText(TEXTOS.emUsoTops(rotuloDaTop(top)));
    const abrir = page.locator(`[data-testid="config-abrir-central"][data-top-id="${top.id}"]`);
    await expect(abrir).toBeVisible();
    await expect(abrir).toHaveAttribute("href", rotaDaCentral(top.id));

    // 6) "Abrir na Central" (navegação do cliente, sem goto/reload): o layout ligado em < 15 s, sem o ICMS frete
    expect(Date.now() - cacheDesde, "premissa: a resposta anterior da Central ainda está fresca (staleTime 15 s) — sem isso, a Central refaria a pergunta sozinha e o teste não provaria a invalidação").toBeLessThan(15_000);
    await abrir.click();
    await expect(efetivo).toHaveAttribute("data-origem", "ligado", { timeout: Math.max(1_000, 15_000 - (Date.now() - salvouTops)) });
    expect(Date.now() - salvouTops, "a Central mostrou o layout ligado em < 15 s depois de salvar as TOPs").toBeLessThan(15_000);
    expect(await page.evaluate(() => "__ld2w3" in window), "o mesmo documento (sem recarga): foi o cache da Central que caiu").toBe(true);
    await expect(efetivo).toHaveAttribute("data-layout-id", layout.id);
    await expect(efetivo).toContainText(`Layout: ${nome} (ligado à TOP)`);
    const freteDepois = await painelDoFrete(page);
    await expect(freteDepois.locator('[data-campo="freight"]'), "presença: o Frete continua na aba").toBeVisible();
    await expect(page.locator('[data-campo="freight_icms"]'), "o layout ligado tirou o ICMS frete").toHaveCount(0);
  } finally {
    await limpar(page, layouts, tops);
  }
});

test("LD2-W4 — link direto abre a tela com a linha selecionada; o \"Configurar\" da Central leva lá", async ({ page }) => {
  await login(page);
  const layouts: string[] = [];
  const tops: string[] = [];
  try {
    const outro = await criarLayoutPorApi(page, uniq("LD2-W4 Outro"));
    layouts.push(outro.id);
    const nome = uniq("LD2-W4 Alvo");
    const alvo = await criarLayoutPorApi(page, nome);
    layouts.push(alvo.id);
    const top = await criarTop(page, "LD2-W4 TOP");
    tops.push(top.id);
    await api(page, "PUT", `${BASE}/${alvo.id}/tops`, { tipoOperacaoIds: [top.id] });

    /** A tela única com o alvo selecionado (e o outro, presente, não). */
    const conferirSelecao = async () => {
      await expect(tid(page, "layouts-tela")).toBeVisible();
      await expect(tid(page, `layout-linha-${outro.id}`), "presença: a outra linha está na grade").toBeVisible();
      await expect(tid(page, `layout-linha-${outro.id}`)).toHaveAttribute("data-selecionado", "false");
      await expect(tid(page, `layout-linha-${alvo.id}`)).toHaveAttribute("data-selecionado", "true");
      await expect(tid(page, "config-layout-pagina")).toBeVisible();
      await expect(tid(page, "config-nome"), "a área é a do layout do link").toHaveValue(nome);
      await expect(tid(page, "config-codigo")).toContainText(alvo.code);
    };

    // 1) Link direto
    await page.goto(rotaDoLayout(alvo.id));
    await conferirSelecao();

    // 2) A Central da TOP ligada mostra o layout e o "Configurar" leva à mesma tela
    await abrirCentral(page, top.id);
    const efetivo = tid(page, "central-layout-efetivo");
    await expect(efetivo).toHaveAttribute("data-origem", "ligado");
    await expect(efetivo).toHaveAttribute("data-layout-id", alvo.id);
    await expect(efetivo).toContainText(`Layout: ${nome} (ligado à TOP)`);
    const configurar = tid(page, "central-layout-configurar");
    await expect(configurar).toHaveAttribute("href", rotaDoLayout(alvo.id));
    await configurar.click();
    await expect(page).toHaveURL(new RegExp(`/configuracoes/layouts-documento/${alvo.id}(\\?|$)`));
    await conferirSelecao();
  } finally {
    await limpar(page, layouts, tops);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * LD2-W8 (VENDAS-A3-1d_R1) — "Abrir na Central" não joga o rascunho fora; a seleção mora no endereço
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("LD2-W8 a) — com rascunho sujo, \"Abrir na Central\" desliga com a frase; salvo, volta a ser link e a Central mostra a mudança", async ({ page }) => {
  await login(page);
  const layouts: string[] = [];
  const tops: string[] = [];
  try {
    const top = await criarTop(page, "LD2-W8a TOP");
    tops.push(top.id);
    const nome = uniq("LD2-W8a Layout");
    const layout = await criarLayoutPorApi(page, nome);
    layouts.push(layout.id);
    await api(page, "PUT", `${BASE}/${layout.id}/tops`, { tipoOperacaoIds: [top.id] });
    const antes = await lerLayout(page, layout.id);
    const iFrete = antes.estrutura.rodape.findIndex((a) => a.aba === "Frete e transporte");
    expect(iFrete, "premissa: a cópia do sistema tem a aba Frete e transporte").toBeGreaterThanOrEqual(0);

    await page.goto(rotaDoLayout(layout.id));
    await expect(tid(page, "config-layout-pagina")).toBeVisible();
    const abrir = page.locator(`[data-testid="config-abrir-central"][data-top-id="${top.id}"]`);
    const frase = tid(page, "config-abrir-central-salvar-antes");
    // PRESENÇA ANTES DA AUSÊNCIA: sem mudança, é link habilitado e a frase não existe.
    await expect(abrir).toBeVisible();
    await expect(abrir).toHaveAttribute("href", rotaDaCentral(top.id));
    await expect(abrir).toBeEnabled();
    await expect(frase).toHaveCount(0);

    // Mexer num campo (sem salvar) → cada "Abrir na Central" desligado + a frase, uma vez.
    await tid(page, `config-aba-${iFrete}`).click();
    await campoPrevia(page, "freight_icms").click();
    await tid(page, "config-acao-remover").click();
    await expect(tid(page, "config-salvar"), "premissa: o rascunho ficou sujo").toBeEnabled();
    const todos = page.getByTestId("config-abrir-central");
    const n = await todos.count();
    expect(n, "premissa: há pelo menos um Abrir na Central").toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(todos.nth(i)).toBeDisabled();
      await expect(todos.nth(i)).not.toHaveAttribute("href", /.*/);
    }
    await expect(abrir).toHaveText(TEXTOS.abrirNaCentral);
    await expect(frase).toHaveCount(1);
    await expect(frase).toHaveText(TEXTOS.salvarAntesDeAbrirCentral);
    await expect(page, "nada navegou").toHaveURL(new RegExp(`/configuracoes/layouts-documento/${layout.id}`));

    // Salvar → volta a ser link, sem recarregar.
    expect(await salvar(page, layout.id), "o layout foi gravado").toBe(200);
    await expect(abrir).toHaveAttribute("href", rotaDaCentral(top.id));
    await expect(frase).toHaveCount(0);

    // Clicar → a Central mostra o layout ligado, com a mudança.
    await abrir.click();
    const efetivo = tid(page, "central-layout-efetivo");
    await expect(efetivo).toContainText(`Layout: ${nome} (ligado à TOP)`);
    const frete = await painelDoFrete(page);
    await expect(frete.locator('[data-campo="freight"]'), "presença: o Frete continua").toBeVisible();
    await expect(page.locator('[data-campo="freight_icms"]'), "a mudança salva vale na Central").toHaveCount(0);
  } finally {
    await limpar(page, layouts, tops);
  }
});

test("LD2-W8 b) — na tela de Configurações a seleção vai para &layout=; voltar da Central reabre a mesma linha; id inexistente sai do endereço", async ({ page }) => {
  await login(page);
  const layouts: string[] = [];
  const tops: string[] = [];
  try {
    const top = await criarTop(page, "LD2-W8b TOP");
    tops.push(top.id);
    const layout = await criarLayoutPorApi(page, uniq("LD2-W8b Layout"));
    layouts.push(layout.id);
    await api(page, "PUT", `${BASE}/${layout.id}/tops`, { tipoOperacaoIds: [top.id] });

    await page.goto(ROTA_LAYOUTS);
    await expect(tid(page, "layouts-tela")).toBeVisible();
    const abas = page.getByTestId("workspace-tabs").getByRole("tab");
    const nAbas = await abas.count();
    expect(nAbas, "premissa: a barra de abas existe").toBeGreaterThan(0);
    const linha = tid(page, `layout-linha-${layout.id}`);
    await linha.click();
    await expect(linha).toHaveAttribute("data-selecionado", "true");
    await expect(page).toHaveURL((u) => u.searchParams.get("layout") === layout.id
      && u.searchParams.get("tab") === "operacoes" && u.searchParams.get("sub") === "layouts-documento");
    await expect(abas, "nenhuma aba de trabalho nova").toHaveCount(nAbas);

    // "Abrir na Central" → Voltar do navegador → a MESMA linha, com a área aberta.
    await expect(tid(page, "config-layout-pagina")).toBeVisible();
    await page.locator(`[data-testid="config-abrir-central"][data-top-id="${top.id}"]`).click();
    await expect(tid(page, "central-layout-efetivo")).toBeVisible();
    await page.goBack();
    await expect(tid(page, "layouts-tela")).toBeVisible();
    await expect(tid(page, `layout-linha-${layout.id}`)).toHaveAttribute("data-selecionado", "true");
    await expect(tid(page, "config-layout-pagina")).toBeVisible();

    // id que a API não encontra → nenhuma linha, nenhum erro, e o layout= sai do endereço.
    const inexistente = "00000000-0000-4000-8000-000000000000";
    await page.goto(`${ROTA_LAYOUTS}&layout=${inexistente}`);
    await expect(tid(page, "layouts-tela")).toBeVisible();
    await expect(page).toHaveURL((u) => !u.searchParams.has("layout") && u.searchParams.get("sub") === "layouts-documento");
    await expect(tid(page, "layouts-sem-selecao"), "nenhuma linha selecionada").toBeVisible();
    await expect(page.locator('[data-selecionado="true"][data-testid^="layout-linha-"]')).toHaveCount(0);
    await expect(tid(page, "config-layout-pagina")).toHaveCount(0);
    await expect(tid(page, "layouts-tela").getByRole("alert")).toHaveCount(0);
  } finally {
    await limpar(page, layouts, tops);
  }
});
