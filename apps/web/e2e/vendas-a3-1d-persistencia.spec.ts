import { test, expect, type Page, type Locator } from "@playwright/test";
import { login, api, uniq } from "./helpers";
import { BASE_LAYOUTS, TEXTOS } from "../src/features/admin/layout-configurador/contrato";
import { TEXTO_VERSAO_NOVA } from "../src/components/layout/versao-nova";

/**
 * VENDAS-A3-1d (decisão 262) — TELA ÚNICA DOS LAYOUTS: o que fica GRAVADO, o que se DESCARTA e a faixa de versão nova.
 * API e banco REAIS; só o `/api/build` é simulado no LD2-W7 (a versão do web não muda no meio de um teste).
 *
 * LD2-W5 arrastar + Configurar + Salvar sobrevivem ao reload e ao GET; depois de salvar a área continua editável.
 * LD2-W6 as duas perguntas de descarte: a do Configurar campo e a do rascunho sujo ao trocar de linha na grade.
 * LD2-W7 a faixa "versão nova": sha válido e diferente mostra; o primeiro, o igual e o "unknown" não; nunca recarrega só.
 *
 * Nunca há clique em "Editar" (a A3-1d tirou o passo). Anti-vacuidade: toda ausência vem depois de uma presença.
 * Limpeza: cada teste inativa os layouts que criou (nenhum deles mexe no padrão do movimento).
 */

const FAMILIA = "vendas.orcamento";
const ROTA_LAYOUTS = "/configuracoes?tab=operacoes&sub=layouts-documento";
const rotaDoLayout = (id: string) => `/configuracoes/layouts-documento/${id}`;

type Campo = { campo: string; rotulo?: string; obrigatorio: boolean; editavel: boolean; grupo?: "principal" | "adicionais" };
type Estrutura = { versaoSchema: 1; cabecalho: Campo[]; rodape: { aba: string; campos: Campo[] }[]; itens: { campo: string; obrigatorio: boolean }[] };
type Detalhe = { id: string; code: string; nome: string; familia: string; padrao: boolean; is_active: boolean; estrutura: Estrutura };

const tid = (page: Page, id: string) => page.getByTestId(id);
const campoPrevia = (page: Page, chave: string) => tid(page, `config-campo-${chave}`);

async function criarLayoutPorApi(page: Page, nome: string): Promise<string> {
  return (await api<{ id: string }>(page, "POST", BASE_LAYOUTS, { familia: FAMILIA, nome })).id;
}
async function lerLayout(page: Page, id: string): Promise<Detalhe> { return api<Detalhe>(page, "GET", `${BASE_LAYOUTS}/${id}`); }
async function inativar(page: Page, ids: string[]) {
  for (const id of ids) await api(page, "POST", `${BASE_LAYOUTS}/${id}/ativo`, { ativo: false }).catch(() => undefined);
}

/** A área do layout selecionado, pronta e LIMPA: linha marcada na grade e Salvar desligado (sem passo "Editar"). */
async function esperarArea(page: Page, id: string) {
  await expect(tid(page, "layouts-tela")).toBeVisible();
  await expect(tid(page, `layout-linha-${id}`)).toHaveAttribute("data-selecionado", "true");
  await expect(tid(page, "config-layout-pagina")).toBeVisible();
  await expect(tid(page, "config-salvar"), "a área abre no rascunho, com Salvar desligado até mudar algo").toBeDisabled();
}

/** Abre a tela única pelo link direto, com a linha já selecionada. */
async function abrirTela(page: Page, id: string) {
  await page.goto(rotaDoLayout(id));
  await esperarArea(page, id);
}

/** Salva e devolve o status do PUT que a área disparou. */
async function salvar(page: Page, id: string): Promise<number> {
  const put = page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `${BASE_LAYOUTS}/${id}`);
  await tid(page, "config-salvar").click();
  return (await put).status();
}

/** Arrasta (HTML5) da origem para o alvo — o mesmo gesto da A3-1c. */
async function arrastar(origem: Locator, alvo: Locator) {
  await expect(origem).toBeVisible();
  await expect(alvo).toBeVisible();
  await origem.dragTo(alvo);
}

test("LD2-W5 — Vencimento no Financeiro como \"Venc.\" obrigatório: Salvar mantém a área editável; reload e GET confirmam", async ({ page }) => {
  await login(page);
  const id = await criarLayoutPorApi(page, uniq("LD2-W5 Orçamento"));
  try {
    const antes = await lerLayout(page, id);
    const iFin = antes.estrutura.rodape.findIndex((a) => a.aba === "Financeiro");
    expect(iFin, "premissa: a cópia do sistema tem a aba Financeiro").toBeGreaterThanOrEqual(0);
    const venc0 = antes.estrutura.cabecalho.find((c) => c.campo === "due_date");
    expect(venc0, "premissa: Vencimento nasce no cabeçalho").toBeTruthy();
    expect(venc0!.obrigatorio, "premissa: Vencimento nasce opcional").toBe(false);
    expect(venc0!.rotulo, "premissa: Vencimento nasce sem rótulo próprio").toBeUndefined();
    expect(antes.estrutura.cabecalho.find((c) => c.campo === "proprietary_id")?.grupo, "premissa: Proprietário nasce em Dados adicionais").toBe("adicionais");

    await abrirTela(page, id);
    // VENDAS-A3-1d (decisão 262): quem pode editar já trabalha no rascunho — o botão Editar não existe mais
    await expect(tid(page, "config-salvar")).toBeVisible();
    await expect(tid(page, "config-editar")).toHaveCount(0);

    const zonaPrincipal = tid(page, "config-zona-principal");
    const zonaAdicionais = tid(page, "config-zona-adicionais");
    const zonaFin = tid(page, `config-zona-aba-${iFin}`);
    const venc = zonaFin.getByTestId("config-campo-due_date");

    // 1) Vencimento (Dados principais) → aba Financeiro, arrastando
    await tid(page, `config-aba-${iFin}`).click();
    await arrastar(zonaPrincipal.getByTestId("config-campo-due_date"), zonaFin);
    await expect(venc).toBeVisible();
    await expect(zonaPrincipal.getByTestId("config-campo-client_id"), "presença: Cliente continua nos principais").toBeVisible();
    await expect(zonaPrincipal.getByTestId("config-campo-due_date")).toHaveCount(0);
    await expect(tid(page, "config-salvar"), "rascunho sujo liga o Salvar").toBeEnabled();

    // 2) Configurar (duplo clique): rótulo "Venc." e obrigatório Sim → Aplicar
    await venc.dblclick();
    const dialogo = tid(page, "layout-configurar-campo");
    await expect(dialogo).toBeVisible();
    await dialogo.getByTestId("layout-cfg-rotulo").fill("Venc.");
    await dialogo.getByTestId("layout-cfg-obrigatorio").selectOption("true");
    await dialogo.getByTestId("layout-configurar-aplicar").click();
    await expect(dialogo).toHaveCount(0);
    await expect(venc).toContainText("Venc.");
    await expect(venc.getByTestId("config-marca-obrigatorio")).toBeVisible();

    // 3) Salvar: grava, Salvar volta a desligar e a área CONTINUA editável — o arraste seguinte vem sem clique extra
    expect(await salvar(page, id), "o layout foi gravado").toBe(200);
    await expect(tid(page, "layout-salvo")).toBeVisible();
    await expect(tid(page, "config-salvar"), "sem mudança depois de salvar, Salvar desliga").toBeDisabled();
    await arrastar(zonaAdicionais.getByTestId("config-campo-proprietary_id"), zonaPrincipal);
    await expect(zonaPrincipal.getByTestId("config-campo-proprietary_id"), "o arraste funciona logo depois de salvar").toBeVisible();
    await expect(zonaAdicionais.getByTestId("config-campo-proprietary_id")).toHaveCount(0);
    await expect(tid(page, "config-salvar")).toBeEnabled();

    // Cancelar volta ao GRAVADO de agora (Venc. no Financeiro), não ao de antes — e deixa a área limpa para o reload
    await tid(page, "config-cancelar").click();
    await expect(zonaAdicionais.getByTestId("config-campo-proprietary_id")).toBeVisible();
    await expect(zonaPrincipal.getByTestId("config-campo-proprietary_id")).toHaveCount(0);
    await expect(tid(page, "config-salvar")).toBeDisabled();
    await tid(page, `config-aba-${iFin}`).click();
    await expect(venc, "o gravado agora tem o Venc. no Financeiro").toContainText("Venc.");

    // 4) reload: a prévia mostra "Venc." com "*" na aba Financeiro
    await page.reload();
    await esperarArea(page, id);
    await tid(page, `config-aba-${iFin}`).click();
    await expect(tid(page, `config-aba-${iFin}`)).toContainText("Financeiro");
    await expect(venc).toBeVisible();
    await expect(venc).toContainText("Venc.");
    await expect(venc.getByTestId("config-marca-obrigatorio")).toBeVisible();
    await expect(zonaPrincipal.getByTestId("config-campo-client_id")).toBeVisible();
    await expect(zonaPrincipal.getByTestId("config-campo-due_date")).toHaveCount(0);

    // 5) o GET do detalhe confirma
    const d = await lerLayout(page, id);
    const fin = d.estrutura.rodape.find((a) => a.aba === "Financeiro");
    expect(fin, "a aba Financeiro continua gravada").toBeTruthy();
    const gravado = fin!.campos.find((c) => c.campo === "due_date");
    expect(gravado, "Vencimento gravado na aba Financeiro").toBeTruthy();
    expect(gravado!.rotulo).toBe("Venc.");
    expect(gravado!.obrigatorio).toBe(true);
    const cab = d.estrutura.cabecalho.map((c) => c.campo);
    expect(cab, "presença: Cliente continua no cabeçalho").toContain("client_id");
    expect(cab).not.toContain("due_date");
    expect(d.estrutura.cabecalho.find((c) => c.campo === "proprietary_id")?.grupo, "o arraste cancelado não foi gravado").toBe("adicionais");
  } finally {
    await inativar(page, [id]);
  }
});

test("LD2-W6 — descartar: a pergunta do Configurar campo (Voltar mantém, Descartar fecha sem mudar) e a do rascunho ao trocar de linha", async ({ page }) => {
  await login(page);
  const criados: string[] = [];
  try {
    const idA = await criarLayoutPorApi(page, uniq("LD2-W6 A"));
    criados.push(idA);
    const idB = await criarLayoutPorApi(page, uniq("LD2-W6 B"));
    criados.push(idB);
    const a = await lerLayout(page, idA);
    const b = await lerLayout(page, idB);
    expect(a.estrutura.cabecalho.find((c) => c.campo === "due_date"), "premissa: Vencimento no cabeçalho").toBeTruthy();
    expect(a.estrutura.cabecalho.find((c) => c.campo === "due_date")?.rotulo, "premissa: Vencimento sem rótulo próprio").toBeUndefined();
    expect(a.estrutura.cabecalho.some((c) => c.campo === "payment_method_id"), "premissa: Forma de pagamento está no layout").toBe(true);

    await abrirTela(page, idA);
    await expect(tid(page, "config-nome")).toHaveValue(a.nome);
    // VENDAS-A3-1d (decisão 262): as duas linhas na MESMA grade; a outra está lá, não selecionada
    await expect(tid(page, `layout-linha-${idB}`)).toBeVisible();
    await expect(tid(page, `layout-linha-${idB}`)).toHaveAttribute("data-selecionado", "false");

    // 1) Configurar o Vencimento pela ferramenta da área; mudar o rótulo e Fechar → pergunta
    const venc = campoPrevia(page, "due_date");
    await expect(venc).toBeVisible();
    await expect(tid(page, "config-configurar-selecionado"), "sem seleção, Configurar fica desligado").toBeDisabled();
    await venc.click();
    await expect(venc).toHaveAttribute("data-selecionado", "true");
    await tid(page, "config-configurar-selecionado").click();
    const dialogo = tid(page, "layout-configurar-campo");
    await expect(dialogo).toBeVisible();
    const rotulo = dialogo.getByTestId("layout-cfg-rotulo");
    await expect(rotulo, "premissa: sem rótulo próprio").toHaveValue("");
    await rotulo.fill("Rótulo W6");
    // a pergunta abre num portal próprio: testids pela página, não dentro do diálogo do campo
    const perguntaCampo = tid(page, "layout-cfg-descartar-dialogo");
    await tid(page, "layout-cfg-fechar").click();
    await expect(perguntaCampo, "mudança pendente: Fechar pergunta").toBeVisible();
    await expect(perguntaCampo).toContainText(TEXTOS.descartarCampo);

    // 2) "Voltar ao campo": a pergunta some e o texto digitado continua
    await tid(page, "layout-cfg-voltar").click();
    await expect(dialogo).toBeVisible();
    await expect(perguntaCampo).toHaveCount(0);
    await expect(rotulo).toHaveValue("Rótulo W6");

    // 3) "Descartar": fecha e o campo não muda na prévia
    await tid(page, "layout-cfg-fechar").click();
    await expect(perguntaCampo).toBeVisible();
    await tid(page, "layout-cfg-descartar").click();
    await expect(venc).toBeVisible();
    await expect(dialogo).toHaveCount(0);
    await expect(perguntaCampo).toHaveCount(0);
    await expect(venc).toContainText("Vencimento");
    await expect(venc).not.toContainText("Rótulo W6");
    await expect(tid(page, "config-salvar"), "descartar o campo não suja o rascunho").toBeDisabled();

    // 4) rascunho sujo (Forma de pagamento sai) + clicar na OUTRA linha → pergunta
    const forma = campoPrevia(page, "payment_method_id");
    await forma.click();
    await expect(forma).toHaveAttribute("data-selecionado", "true");
    await tid(page, "config-acao-remover").click();
    await expect(tid(page, "config-disponivel-payment_method_id")).toBeVisible();
    await expect(forma).toHaveCount(0);
    await expect(tid(page, "config-salvar"), "rascunho sujo liga o Salvar").toBeEnabled();
    const perguntaRascunho = tid(page, "config-descartar-dialogo");
    await tid(page, `layout-linha-${idB}`).click();
    await expect(perguntaRascunho).toBeVisible();
    await expect(perguntaRascunho).toContainText(TEXTOS.descartarRascunho);

    // 5) "Voltar": continua no layout A, com a Forma de pagamento fora
    await tid(page, "config-descartar-voltar").click();
    await expect(tid(page, `layout-linha-${idA}`)).toHaveAttribute("data-selecionado", "true");
    await expect(perguntaRascunho).toHaveCount(0);
    await expect(tid(page, `layout-linha-${idB}`)).toHaveAttribute("data-selecionado", "false");
    await expect(tid(page, "config-nome")).toHaveValue(a.nome);
    await expect(tid(page, "config-disponivel-payment_method_id"), "o rascunho foi mantido").toBeVisible();
    await expect(forma).toHaveCount(0);
    await expect(tid(page, "config-salvar")).toBeEnabled();

    // 6) de novo → "Descartar": a área passa a mostrar o layout B, limpo
    await tid(page, `layout-linha-${idB}`).click();
    await expect(perguntaRascunho).toBeVisible();
    await tid(page, "config-descartar").click();
    await expect(tid(page, `layout-linha-${idB}`)).toHaveAttribute("data-selecionado", "true");
    await expect(perguntaRascunho).toHaveCount(0);
    await expect(tid(page, `layout-linha-${idA}`)).toHaveAttribute("data-selecionado", "false");
    await expect(tid(page, "config-nome")).toHaveValue(b.nome);
    await expect(tid(page, "config-codigo")).toHaveText(b.code);
    await expect(forma, "B é a cópia do sistema: tem a Forma de pagamento").toBeVisible();
    await expect(tid(page, "config-salvar")).toBeDisabled();

    // 7) nada foi gravado em A: o descarte é só da tela
    const a2 = await lerLayout(page, idA);
    expect(a2.estrutura.cabecalho.some((c) => c.campo === "payment_method_id"), "presença: Forma de pagamento continua gravada em A").toBe(true);
    expect(a2.estrutura).toEqual(a.estrutura);
    expect(a2.nome).toBe(a.nome);
  } finally {
    await inativar(page, criados);
  }
});

/* ── LD2-W7, VENDAS-A3-1d (decisão 262): a faixa "versão nova" do shell — o /api/build simulado responde o sha da vez ── */

const SHA_A = "a1".repeat(20);
const SHA_B = "b2".repeat(20);
const ehBuild = (url: string) => new URL(url).pathname === "/api/build";

/** Intercepta o GET /api/build do web: responde `{ build: { sha } }` com o sha da vez (mutável pelo teste). */
async function simularBuild(page: Page, inicial: string) {
  const estado = { sha: inicial };
  await page.route((url) => url.pathname === "/api/build", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify({ build: { sha: estado.sha } }) });
  });
  return estado;
}

/**
 * Espera a PRÓXIMA resposta do /api/build com este sha (corpo inteiro já lido), vinda do documento da TELA: uma
 * resposta atrasada da página anterior (o Início, depois do login) não vale como a primeira verificação desta.
 */
function respostaDoBuild(page: Page, sha: string) {
  return page.waitForResponse(async (r) => {
    if (!ehBuild(r.url())) return false;
    if (!new URL(r.frame().url()).pathname.startsWith("/configuracoes")) return false;
    try { return ((await r.json()) as { build?: { sha?: string } }).build?.sha === sha; } catch { return false; }
  });
}

/** O mesmo evento que a janela recebe ao voltar ao foco. */
async function focarJanela(page: Page) {
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
}

/** Deixa a resposta já recebida chegar ao React (dois quadros) antes de afirmar uma AUSÊNCIA. */
async function assentar(page: Page) {
  await page.evaluate(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));
}

type JanelaMarcada = Window & { __a31dAntesDoReload?: boolean };

test("LD2-W7 — versão nova: sha diferente mostra a faixa e \"Atualizar agora\" recarrega; o primeiro, o igual e o \"unknown\" não mostram", async ({ page }) => {
  await login(page);
  const build = await simularBuild(page, SHA_A);
  const faixa = tid(page, "versao-nova");

  // 1) abrir com A: o primeiro sha válido é a versão rodando — nenhuma faixa
  const primeiroA = respostaDoBuild(page, SHA_A);
  await page.goto(ROTA_LAYOUTS);
  await primeiroA;
  await expect(tid(page, "layouts-tela")).toBeVisible();
  await assentar(page);
  await expect(faixa).toHaveCount(0);

  // 2) o servidor passa a responder B; a janela volta ao foco → a faixa aparece, sem recarregar sozinha
  await page.evaluate(() => { (window as JanelaMarcada).__a31dAntesDoReload = true; });
  build.sha = SHA_B;
  const chegouB = respostaDoBuild(page, SHA_B);
  await focarJanela(page);
  await chegouB;
  await expect(faixa).toBeVisible();
  await expect(faixa).toContainText(TEXTO_VERSAO_NOVA);
  await expect(tid(page, "versao-nova-atualizar")).toBeVisible();
  expect(await page.evaluate(() => (window as JanelaMarcada).__a31dAntesDoReload === true), "a faixa nunca recarrega sozinha").toBe(true);

  // 3) "Atualizar agora" recarrega a página; com B desde o início, nenhuma faixa
  const recarga = page.waitForEvent("load");
  const primeiroDepois = respostaDoBuild(page, SHA_B);
  await tid(page, "versao-nova-atualizar").click();
  await recarga;
  await primeiroDepois;
  await expect(tid(page, "layouts-tela")).toBeVisible();
  expect(await page.evaluate(() => (window as JanelaMarcada).__a31dAntesDoReload === true), "a página recarregou de verdade").toBe(false);
  await assentar(page);
  await expect(faixa).toHaveCount(0);
  // o mesmo sha de novo no foco: continua sem faixa
  const deNovoB = respostaDoBuild(page, SHA_B);
  await focarJanela(page);
  await deNovoB;
  await assentar(page);
  await expect(faixa).toHaveCount(0);

  // 4) documento novo com A; o servidor passa a responder "unknown" → foco → nenhuma faixa
  build.sha = SHA_A;
  const outroA = respostaDoBuild(page, SHA_A);
  await page.goto(ROTA_LAYOUTS);
  await outroA;
  await expect(tid(page, "layouts-tela")).toBeVisible();
  build.sha = "unknown";
  const desconhecido = respostaDoBuild(page, "unknown");
  await focarJanela(page);
  await desconhecido;
  await assentar(page);
  await expect(faixa, "sha desconhecido não é versão nova").toHaveCount(0);

  // controle: a escuta continua viva e a versão rodando continua A — B no foco mostra a faixa
  build.sha = SHA_B;
  const depoisB = respostaDoBuild(page, SHA_B);
  await focarJanela(page);
  await depoisB;
  await expect(faixa).toBeVisible();
});
