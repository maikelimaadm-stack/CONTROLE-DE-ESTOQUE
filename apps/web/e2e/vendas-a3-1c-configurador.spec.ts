import { test, expect, type Page, type Locator } from "@playwright/test";
import { login, api, uniq } from "./helpers";

/**
 * VENDAS-A3-1c — CONFIGURADOR VISUAL DO LAYOUT DO DOCUMENTO, PELA PÁGINA (API e banco REAIS; nada mockado). Decisão 261.
 *
 * O domínio prova a regra de zona e a integração prova a gravação. Aqui se mede o que a PÁGINA promete: arrastar (LC-W1),
 * as mesmas operações sem mouse (LC-W2), o Novo layout "Começar de" um existente + TOPs em lista dupla (LC-W4) e a palavra
 * "Movimento" no lugar de "família" nas telas de TOP, layout e lançador (LC-W5).
 *
 * Anti-vacuidade: toda ausência vem depois de uma presença positiva do mesmo tipo de alvo.
 * Limpeza: cada teste inativa o que criou e devolve o padrão do movimento a quem o tinha.
 *
 * A3-1d (decisão 262): TELA ÚNICA — a rota /configuracoes/layouts-documento/<id> abre a grade com a linha selecionada e a
 * área do layout logo abaixo, já no rascunho (não há mais "Editar"); Novo é o assistente de 3 passos na barra da grade e
 * SELECIONA o criado (não navega); as TOPs ligadas estão no diálogo "Visualizar TOPs". Só os passos de UI mudaram; toda
 * asserção de regra ficou.
 */

const ROTA_LAYOUTS = "/configuracoes?tab=operacoes&sub=layouts-documento";
const ROTA_TOPS = "/configuracoes?tab=operacoes&sub=tipos-operacao";
const BASE = "/api/admin/layouts-documento";
const OBRIGATORIO_NAO_SAI = "Campo obrigatório do sistema não pode sair do layout.";

type Campo = { campo: string; rotulo?: string; obrigatorio: boolean; editavel: boolean; grupo?: "principal" | "adicionais" };
type Estrutura = { versaoSchema: 1; cabecalho: Campo[]; rodape: { aba: string; campos: Campo[] }[]; itens: { campo: string; obrigatorio: boolean }[] };
type Detalhe = { id: string; nome: string; familia: string; padrao: boolean; is_active: boolean; estrutura: Estrutura; tops: { id: string }[] };
type Linha = { id: string; nome: string; padrao: boolean; is_active: boolean };

const tid = (page: Page, id: string) => page.getByTestId(id);
const campoPrevia = (page: Page, chave: string) => tid(page, `config-campo-${chave}`);

async function criarLayoutPorApi(page: Page, familia: string, nome: string): Promise<string> {
  return (await api<{ id: string }>(page, "POST", BASE, { familia, nome })).id;
}
async function lerLayout(page: Page, id: string): Promise<Detalhe> { return api<Detalhe>(page, "GET", `${BASE}/${id}`); }
async function inativar(page: Page, ids: string[]) {
  for (const id of ids) await api(page, "POST", `${BASE}/${id}/ativo`, { ativo: false }).catch(() => undefined);
}
async function criarTop(page: Page, familia: string, nome: string): Promise<string> {
  const codigo = `3c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return (await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: familia, nome: uniq(nome) })).id;
}

/**
 * Abre o layout pela rota dele. A3-1d (decisão 262): a rota abre a TELA ÚNICA com a linha já selecionada na grade e a
 * área logo abaixo, já no rascunho — não há mais o passo `config-editar`; sem mudança, Salvar fica desligado.
 */
async function abrirPagina(page: Page, id: string) {
  await page.goto(`/configuracoes/layouts-documento/${id}`);
  await expect(tid(page, `layout-linha-${id}`), "a rota abre com a linha selecionada").toHaveAttribute("data-selecionado", "true");
  await expect(tid(page, "config-layout-pagina")).toBeVisible();
  await expect(tid(page, "config-salvar")).toBeVisible();
  await expect(tid(page, "config-salvar"), "sem mudança, Salvar desligado").toBeDisabled();
}

/** Salva e devolve o status do PUT que a página disparou. */
async function salvar(page: Page, id: string): Promise<number> {
  const put = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `${BASE}/${id}`);
  await tid(page, "config-salvar").click();
  return (await put).status();
}

/** Ordem dos campos (chaves) mostrados numa zona, pela ordem do DOM. */
async function ordemNaZona(zona: Locator): Promise<string[]> {
  return zona.locator('[data-testid^="config-campo-"]').evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") ?? "").slice("config-campo-".length)));
}

/** Arrasta (HTML5) soltando na borda inicial do alvo — "antes de" quando o alvo é um campo. */
async function arrastar(origem: Locator, alvo: Locator, antes = false) {
  await expect(origem).toBeVisible();
  await expect(alvo).toBeVisible();
  await origem.dragTo(alvo, antes ? { targetPosition: { x: 3, y: 3 } } : undefined);
}

/** Escolhe no <select> a opção cujo TEXTO contém `texto` (o valor é detalhe da implementação). */
async function escolherPorTexto(select: Locator, texto: RegExp) {
  const opcoes = await select.locator("option").evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? "" })));
  const alvo = opcoes.find((o) => texto.test(o.t));
  expect(alvo, `a opção ${texto} existe em ${JSON.stringify(opcoes.map((o) => o.t))}`).toBeTruthy();
  await select.selectOption(alvo!.v);
}

const todosDoDocumento = (e: Estrutura) => [...e.cabecalho, ...e.rodape.flatMap((a) => a.campos)];

test.describe.configure({ mode: "serial" });

test("LC-W1 — arrastando: ICMS frete sai, Vencimento vai ao Financeiro, Proprietário ao principal, Armazém antes de Produto, aba renomeada, Desfazer/Refazer, Salvar", async ({ page }) => {
  await login(page);
  const id = await criarLayoutPorApi(page, "vendas.pedido", uniq("LC-W1 Pedido"));
  try {
    const antes = await lerLayout(page, id);
    const iFin = antes.estrutura.rodape.findIndex((a) => a.aba === "Financeiro");
    const iFrete = antes.estrutura.rodape.findIndex((a) => a.aba === "Frete e transporte");
    expect(iFin, "premissa: a cópia do sistema tem a aba Financeiro").toBeGreaterThanOrEqual(0);
    expect(iFrete, "premissa: a cópia do sistema tem a aba Frete e transporte").toBeGreaterThanOrEqual(0);
    expect(antes.estrutura.cabecalho.find((c) => c.campo === "proprietary_id")?.grupo, "premissa: Proprietário nasce em Dados adicionais").toBe("adicionais");

    await abrirPagina(page, id);

    // 1) ICMS frete → Disponíveis: sai da prévia, aparece como disponível
    await tid(page, `config-aba-${iFrete}`).click();
    await expect(campoPrevia(page, "freight"), "presença: o Frete continua na aba").toBeVisible();
    await expect(tid(page, "config-disponivel-freight_icms"), "premissa: ICMS frete não está disponível antes").toHaveCount(0);
    await arrastar(campoPrevia(page, "freight_icms"), tid(page, "config-disponiveis"));
    await expect(tid(page, "config-disponivel-freight_icms")).toBeVisible();
    await expect(campoPrevia(page, "freight_icms")).toHaveCount(0);

    // 2) Vencimento (cabeçalho) → zona da aba Financeiro
    await tid(page, `config-aba-${iFin}`).click();
    const zonaFin = tid(page, `config-zona-aba-${iFin}`);
    await expect(zonaFin).toBeVisible();
    await arrastar(tid(page, "config-zona-principal").getByTestId("config-campo-due_date"), zonaFin);
    await expect(zonaFin.getByTestId("config-campo-due_date")).toBeVisible();
    await expect(tid(page, "config-zona-principal").getByTestId("config-campo-due_date")).toHaveCount(0);

    // 3) Proprietário: Dados adicionais → Dados principais
    await expect(tid(page, "config-zona-adicionais").getByTestId("config-campo-proprietary_id")).toBeVisible();
    await arrastar(campoPrevia(page, "proprietary_id"), tid(page, "config-zona-principal"));
    await expect(tid(page, "config-zona-principal").getByTestId("config-campo-proprietary_id")).toBeVisible();
    await expect(tid(page, "config-zona-adicionais").getByTestId("config-campo-proprietary_id")).toHaveCount(0);

    // 4) Armazém solto ANTES de Produto nos itens
    const zonaItens = tid(page, "config-zona-itens");
    const ordem0 = await ordemNaZona(zonaItens);
    expect(ordem0.indexOf("itens.product_id"), "premissa: Produto antes de Armazém").toBeLessThan(ordem0.indexOf("itens.warehouse_id"));
    await arrastar(campoPrevia(page, "itens.warehouse_id"), campoPrevia(page, "itens.product_id"), true);
    await expect.poll(async () => { const o = await ordemNaZona(zonaItens); return o.indexOf("itens.warehouse_id") === o.indexOf("itens.product_id") - 1; }, { message: "Armazém imediatamente antes de Produto" }).toBe(true);

    // 5) Renomear a aba Financeiro com duplo clique
    await tid(page, `config-aba-${iFin}`).dblclick();
    const nome = tid(page, `config-aba-nome-${iFin}`);
    await expect(nome).toBeVisible();
    await nome.fill("Pagamento");
    await nome.press("Enter");
    await expect(tid(page, `config-aba-${iFin}`)).toContainText("Pagamento");

    // 6) Desfazer volta o nome; Refazer o reaplica
    await tid(page, "config-desfazer").click();
    await expect(tid(page, `config-aba-${iFin}`)).toContainText("Financeiro");
    await tid(page, "config-refazer").click();
    await expect(tid(page, `config-aba-${iFin}`)).toContainText("Pagamento");

    // 7) Salvar → o servidor tem a estrutura
    expect(await salvar(page, id), "o layout foi gravado").toBe(200);
    const d = await lerLayout(page, id);
    const todos = todosDoDocumento(d.estrutura);
    expect(todos.some((c) => c.campo === "freight"), "presença: Frete continua").toBe(true);
    expect(todos.some((c) => c.campo === "freight_icms"), "ICMS frete saiu").toBe(false);
    expect(d.estrutura.rodape[iFin].aba).toBe("Pagamento");
    expect(d.estrutura.rodape[iFin].campos.map((c) => c.campo)).toContain("due_date");
    expect(d.estrutura.cabecalho.map((c) => c.campo)).not.toContain("due_date");
    const prop = d.estrutura.cabecalho.find((c) => c.campo === "proprietary_id");
    expect(prop, "Proprietário continua no cabeçalho").toBeTruthy();
    expect(prop!.grupo ?? "principal").toBe("principal");
    const itens = d.estrutura.itens.map((c) => c.campo);
    expect(itens.indexOf("warehouse_id")).toBe(itens.indexOf("product_id") - 1);
  } finally {
    await inativar(page, [id]);
  }
});

test("LC-W2 — sem mouse: selecionar, descer, mover para aba, Delete; obrigatório do sistema recusa com aviso", async ({ page }) => {
  await login(page);
  const id = await criarLayoutPorApi(page, "vendas.orcamento", uniq("LC-W2 Orçamento"));
  try {
    const antes = await lerLayout(page, id);
    const cab0 = antes.estrutura.cabecalho.map((c) => c.campo);
    const iObs = antes.estrutura.rodape.findIndex((a) => a.aba === "Observações");
    expect(iObs, "premissa: aba Observações").toBeGreaterThanOrEqual(0);
    await abrirPagina(page, id);

    // Descer: Vencimento troca de lugar com o seguinte
    const iDue = cab0.indexOf("due_date");
    const seguinte = cab0[iDue + 1];
    await campoPrevia(page, "due_date").click();
    await expect(campoPrevia(page, "due_date")).toHaveAttribute("data-selecionado", "true");
    await expect(tid(page, "config-acoes")).toBeVisible();
    await tid(page, "config-acao-descer").click();
    const zonaPrincipal = tid(page, "config-zona-principal");
    await expect.poll(async () => { const o = await ordemNaZona(zonaPrincipal); return o.indexOf("due_date") > o.indexOf(seguinte); }).toBe(true);

    // Mover para…: Data de saída → aba Observações
    await campoPrevia(page, "shipping_date").click();
    await expect(campoPrevia(page, "shipping_date")).toHaveAttribute("data-selecionado", "true");
    await escolherPorTexto(tid(page, "config-acao-mover"), /Observa/);
    await tid(page, `config-aba-${iObs}`).click();
    await expect(tid(page, `config-zona-aba-${iObs}`).getByTestId("config-campo-shipping_date")).toBeVisible();

    // Delete num campo comum: Forma de pagamento sai e vira disponível
    await campoPrevia(page, "payment_method_id").click();
    await expect(campoPrevia(page, "payment_method_id")).toHaveAttribute("data-selecionado", "true");
    await page.keyboard.press("Delete");
    await expect(tid(page, "config-disponivel-payment_method_id")).toBeVisible();
    await expect(campoPrevia(page, "payment_method_id")).toHaveCount(0);

    // Delete no obrigatório do sistema: aviso e o campo fica
    await campoPrevia(page, "client_id").click();
    await expect(campoPrevia(page, "client_id")).toHaveAttribute("data-selecionado", "true");
    await page.keyboard.press("Delete");
    await expect(tid(page, "config-aviso")).toContainText(OBRIGATORIO_NAO_SAI);
    await expect(campoPrevia(page, "client_id")).toBeVisible();
    await expect(tid(page, "config-disponivel-client_id")).toHaveCount(0);

    expect(await salvar(page, id), "o layout foi gravado").toBe(200);
    const d = await lerLayout(page, id);
    const cab = d.estrutura.cabecalho.map((c) => c.campo);
    expect(cab).toContain("client_id");
    expect(cab.indexOf("due_date")).toBeGreaterThan(cab.indexOf(seguinte));
    expect(cab).not.toContain("shipping_date");
    expect(d.estrutura.rodape[iObs].campos.map((c) => c.campo)).toContain("shipping_date");
    expect(todosDoDocumento(d.estrutura).some((c) => c.campo === "note"), "presença: Observação continua").toBe(true);
    expect(todosDoDocumento(d.estrutura).some((c) => c.campo === "payment_method_id"), "Forma de pagamento saiu").toBe(false);
  } finally {
    await inativar(page, [id]);
  }
});

test("LC-W4 — Novo layout começando de um existente, como padrão; TOPs em lista dupla", async ({ page }) => {
  await login(page);
  const familia = "vendas.orcamento";
  const criados: string[] = [];
  const padraoAnterior = (await api<{ items: Linha[] }>(page, "GET", `${BASE}?familia=${familia}`)).items.find((l) => l.padrao && l.is_active)?.id ?? null;
  try {
    // Origem com estrutura própria (sem ICMS frete, Vencimento renomeado)
    const origem = await criarLayoutPorApi(page, familia, uniq("LC-W4 Origem"));
    criados.push(origem);
    const o = await lerLayout(page, origem);
    const estrutura: Estrutura = {
      ...o.estrutura,
      cabecalho: o.estrutura.cabecalho.map((c) => (c.campo === "due_date" ? { ...c, rotulo: "Venc. W4" } : c)),
      rodape: o.estrutura.rodape.map((a) => ({ ...a, campos: a.campos.filter((c) => c.campo !== "freight_icms") }))
    };
    await api(page, "PUT", `${BASE}/${origem}`, { estrutura });
    const origemGravada = (await lerLayout(page, origem)).estrutura;

    await page.goto(ROTA_LAYOUTS);
    await expect(page.getByTestId("layouts-documento")).toBeVisible();
    // A3-1d (decisão 262): "Novo" da barra da grade abre o ASSISTENTE de 3 passos (antes: botão "Novo layout", um passo).
    await tid(page, "layouts-barra").getByTestId("layouts-novo").click();
    const dialogo = tid(page, "layout-novo");
    await expect(dialogo).toBeVisible();
    await expect(dialogo, "o diálogo fala em Movimento").toContainText("Movimento");
    // passo 1: movimento e descrição
    await dialogo.getByTestId("layout-novo-familia").selectOption(familia);
    const nome = uniq("LC-W4 Cópia");
    await dialogo.getByTestId("layout-novo-nome").fill(nome);
    await dialogo.getByTestId("layout-novo-avancar").click();
    // passo 2: o modelo é o layout existente
    await dialogo.getByTestId("layout-novo-origem").selectOption(origem);
    await dialogo.getByTestId("layout-novo-avancar").click();
    // passo 3: padrão do movimento
    await dialogo.getByTestId("layout-novo-padrao").check();
    const duplicou = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `${BASE}/${origem}/duplicar`);
    await dialogo.getByTestId("layout-novo-criar").click();

    // A3-1d (decisão 262): ao criar, a tela SELECIONA o novo (não navega mais para /configuracoes/layouts-documento/<id>):
    // o id sai da resposta do POST que a tela disparou (duplicar a origem), e a asserção de URL virou "a linha do novo
    // está selecionada e a área mostra o código e o nome dele".
    const rd = await duplicou;
    expect(rd.status(), "a cópia da origem foi criada").toBe(201);
    const { id: novo, code } = (await rd.json()) as { id: string; code: string };
    criados.push(novo);
    expect(novo).not.toBe(origem);
    await expect(dialogo).toHaveCount(0);
    await expect(tid(page, `layout-linha-${novo}`)).toHaveAttribute("data-selecionado", "true");
    await expect(tid(page, "config-layout-pagina")).toBeVisible();
    await expect(tid(page, "config-layout-pagina").getByTestId("config-codigo")).toHaveText(code);
    // A3-1d (decisão 262): com permissão o nome é campo editável da área (Input) — antes era título (h1)
    await expect(tid(page, "config-nome")).toHaveValue(nome);
    await expect(tid(page, "config-padrao-selo")).toBeVisible();

    const d = await lerLayout(page, novo);
    expect(d.nome).toBe(nome);
    expect(d.familia).toBe(familia);
    expect(d.padrao, "nasceu padrão do movimento").toBe(true);
    expect(d.estrutura, "mesma estrutura da origem").toEqual(origemGravada);

    // TOPs em lista dupla: Mover → e duplo clique; Salvar
    const topA = await criarTop(page, familia, "LC-W4 A");
    const topB = await criarTop(page, familia, "LC-W4 B");
    // A3-1d (decisão 262): a tela não navegou ao criar (a URL segue a da lista), então "recarregar" é abrir a rota do
    // layout, que abre a tela com a linha selecionada — as TOPs novas chegam do servidor (antes: page.reload()).
    await abrirPagina(page, novo);
    // A3-1d (decisão 262): a lista dupla saiu do fim da página para o diálogo "Visualizar TOPs" (barra da grade, age sobre
    // a linha selecionada); mesmos testids `config-tops-*`, e Salvar desligado enquanto nada muda.
    await tid(page, "layouts-barra").getByTestId("layouts-visualizar-tops").click();
    const dlg = tid(page, "config-tops-dialogo");
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId("config-tops")).toBeVisible();
    const disp = dlg.getByTestId("config-tops-disponiveis");
    const lig = dlg.getByTestId("config-tops-ligadas");
    await expect(disp.getByTestId(`config-top-${topA}`)).toBeVisible();
    await expect(disp.getByTestId(`config-top-${topB}`)).toBeVisible();
    await expect(dlg.getByTestId("config-tops-salvar"), "sem mudança, Salvar das TOPs desligado").toBeDisabled();
    await disp.getByTestId(`config-top-${topA}`).click();
    await dlg.getByTestId("config-tops-mover").click();
    await expect(lig.getByTestId(`config-top-${topA}`)).toBeVisible();
    await expect(disp.getByTestId(`config-top-${topA}`)).toHaveCount(0);
    await disp.getByTestId(`config-top-${topB}`).dblclick();
    await expect(lig.getByTestId(`config-top-${topB}`)).toBeVisible();
    const put = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `${BASE}/${novo}/tops`);
    await dlg.getByTestId("config-tops-salvar").click();
    expect((await put).status()).toBe(200);
    await expect(dlg.getByTestId("config-tops-salvo")).toBeVisible();
    const comTops = await lerLayout(page, novo);
    expect(comTops.tops.map((t) => t.id).sort()).toEqual([topA, topB].sort());
  } finally {
    await inativar(page, criados);
    if (padraoAnterior) await api(page, "POST", `${BASE}/${padraoAnterior}/padrao`, {}).catch(() => undefined);
  }
});

/** "Movimento" presente e nenhuma "família" visível no texto da tela. */
async function semFamilia(page: Page, tela: string) {
  await expect(page.locator("body"), `${tela}: presença de "Movimento"`).toContainText(/Movimento/);
  const texto = await page.evaluate(() => document.body.innerText);
  expect(texto.match(/fam[ií]lia[^\n]{0,40}/gi) ?? [], `${tela}: nenhuma "família" visível`).toEqual([]);
}

test("LC-W5 — \"Movimento\" no lugar de \"família\": TOPs, editor da TOP, layouts, Novo layout e lançador", async ({ page }) => {
  await login(page);

  // Lista de Tipos de Operação
  await page.goto(ROTA_TOPS);
  await expect(page.getByLabel("Buscar tipo de operação")).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toBeVisible();
  await semFamilia(page, "lista de TOPs");

  // Editor da TOP
  await page.getByRole("row").nth(1).getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(tid(page, "form-tipo-operacao")).toBeVisible();
  await semFamilia(page, "editor da TOP");

  // Lista de layouts e o Novo layout
  await page.goto(ROTA_LAYOUTS);
  await expect(tid(page, "layouts-documento")).toBeVisible();
  await semFamilia(page, "lista de layouts");
  // A3-1d (decisão 262): "Novo" está na barra da grade (antes: botão "Novo layout") e abre o assistente no passo 1
  await tid(page, "layouts-barra").getByTestId("layouts-novo").click();
  await expect(tid(page, "layout-novo")).toBeVisible();
  await semFamilia(page, "Novo layout");

  // Lançador de vendas
  await page.goto("/vendas/orders/new");
  await expect(tid(page, "top-lancador")).toBeVisible();
  await expect(page.locator('[data-testid="top-opcao"]').first()).toBeVisible();
  await semFamilia(page, "lançador de vendas");
});
