import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { login, api, uniq, pickRef, empresaAtiva, primeiroId, abrirAbaDoLancamento, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira, CLASSIFICACAO_DO_SEED, acaoDaCentral, abrirDadosAdicionais } from "./helpers";

/**
 * CENTRAL DE VENDAS IGUAL AO DESENHO (VISUAL-UX-02, docs/DECISIONS.md 270) — desktop.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────┐
 * │ central-vendas-workspace.spec.ts continua provando a MOLDURA e o CONTRATO de antes. Aqui se     │
 * │ mede o que a decisão 270 acrescentou: as medidas-chave do desenho (VD-1), a posição do rótulo  │
 * │ sem persistência (VD-2), o leque por modo e por permissão (VD-3), Novo documento pelas TOPs do │
 * │ servidor (VD-4), Duplicar em memória (VD-5), Descartar (VD-6), Salvar com pendências (VD-7),   │
 * │ Salvo e Confirmar venda na criação (VD-8), Cancelar com motivo (VD-9), a consulta completa     │
 * │ (VD-10), Ampliar (VD-11), o esqueleto (VD-12) e a evidência desenho × produto (VD-13).         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VERDE QUE NÃO PROVA NADA É REPROVAÇÃO ───────────────────────────────────────────────────────┐
 * │ Toda ausência vem depois de um sinal do estado final; toda escrita é CONTADA (zero POST é um   │
 * │ número, não um silêncio); toda chave do navegador é comparada antes × depois; toda fixture é  │
 * │ criada pela API e a premissa é conferida no servidor.                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

const WORKSPACE = "central-vendas";

/**
 * AS MEDIDAS-CHAVE DO DESENHO (seção 2 do pedido), lidas do CSS do desenho. Tolerância 0 px em tamanho, raio e espaço;
 * cor exata (valor calculado pelo navegador). Onde o CSS do desenho diverge do pedido, o CSS vence — e está marcado.
 */
const MEDIDAS = {
  barra: { altura: 44, raio: "12px", fundo: "rgb(255, 255, 255)", borda: "rgb(231, 234, 238)" },
  botaoRedondo: { lado: 25, fundo: "rgb(241, 243, 244)", icone: "rgb(71, 85, 105)", sombra: "rgba(34, 197, 94, 0.3) 0px 2px 6px 0px" },
  novo: { fundo: "rgb(64, 222, 99)" },
  pilula: { altura: 25, fonte: "12.5px", peso: "600" },
  posicaoDoRotulo: { altura: 25 },
  documento: { raio: "14px" },
  /** TODO-COORDENADOR: o pedido diz 36; o CSS do desenho diz `--dz-reg: 32px` + 1 px de borda. Fechar com a medida real. */
  cabecalhoDeDados: 36,
  campo: {
    rotuloLargura: 126, rotuloFonte: "12px", rotuloPeso: "500", rotuloCor: "rgb(100, 116, 139)",
    caixaInicio: 136, caixaAltura: 30, caixaRaio: "8px",
    vazia: "rgb(241, 243, 244)", preenchida: "rgb(255, 255, 255)", preenchidaBorda: "rgb(231, 234, 238)",
    leitura: "rgb(246, 248, 250)", travada: "rgb(233, 237, 242)", valorFonte: "12.5px", larguraMaxima: 560, espaco: 6
  },
  compacto: { caixaAltura: 32 },
  itens: { barra: 36, cabecalho: 28, linha: 23, rodape: 32 },
  painel: { faixa: 38 },
  esqueleto: { barra: 34, quantas: 5 }
} as const;

/** O texto padrão do motivo de cancelamento de hoje (vazio → ele). */
const MOTIVO_PADRAO = "Cancelado pelo usuário";
const TEXTO_DE_EFEITO_DO_CANCELAMENTO = "O documento será cancelado. Ele não movimentou estoque nem gerou conta a receber.";

/* ═════════════════════════════════════════════ fixtures e medidores ═════════════════════════════════════════════ */

async function cadastrarTop(page: Page, extra: Record<string, unknown> = {}) {
  const codigo = `8${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const nome = uniq("Venda Desenho");
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: "vendas.venda", nome, ...extra });
  return { id: criado.id, codigo, nome };
}

async function parDoSeed(page: Page) {
  const categoria = await primeiroId(page, `/api/resources/financial_categories?code=${CLASSIFICACAO_DO_SEED.categoria.codigo}&kind=analytic&nature=income&pageSize=1`);
  const centro = await primeiroId(page, `/api/resources/cost_centers?code=${CLASSIFICACAO_DO_SEED.centro.codigo}&kind=analytic&pageSize=1`);
  return { categoria, centro };
}

interface VendaCriada { id: string; code: string; status: string; clientName: string; productName: string }

/** Uma venda pela API oficial (o seed não traz venda), lida de volta pela porta de detalhe. */
async function vendaPelaApi(page: Page, extra: Record<string, unknown> = {}, rota = "sales"): Promise<VendaCriada> {
  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const { id } = await api<{ id: string }>(page, "POST", `/api/sales/${rota}`, {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente,
    items: [{ product_id: produto, warehouse_id: null, quantity: "2", unit_price: "10.00" }], ...extra
  });
  const d = await api<{ code: string; status: string; client_name: string; items: { product_name?: string }[] }>(page, "GET", `/api/sales/${rota}/${id}`);
  expect(d.code && d.client_name && d.status, "premissa: o documento tem código, cliente e situação").toBeTruthy();
  return { id, code: d.code, status: d.status, clientName: d.client_name, productName: String(d.items[0]?.product_name ?? "") };
}

async function abrirCriacao(page: Page, topId: string) {
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${topId}`);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(page.getByTestId("top-contexto")).toBeVisible();
}

async function abrirConsulta(page: Page, venda: VendaCriada, rota = "sales") {
  await page.goto(`/vendas/${rota}/${venda.id}`);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(page.getByTestId("central-vendas-identidade-nome"), "premissa: a tela desenhou ESTE documento").toHaveText(venda.code);
}

/** Chaves do armazenamento do navegador — a prova de "nenhuma chave nova". */
const chavesDoNavegador = (page: Page) => page.evaluate(() => ({ local: Object.keys(localStorage).sort(), sessao: Object.keys(sessionStorage).sort() }));

/** Registra toda escrita (não-GET) contra a API a partir de agora. */
function registrarEscritas(page: Page) {
  const escritas: { metodo: string; caminho: string; corpo: unknown; chave: string | undefined }[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/") || r.method() === "GET" || r.method() === "OPTIONS") return;
    let corpo: unknown = null; try { corpo = r.postDataJSON(); } catch { corpo = r.postData(); }
    escritas.push({ metodo: r.method(), caminho: u.pathname, corpo, chave: r.headers()["idempotency-key"] });
  });
  return escritas;
}

const caixa = async (l: Locator) => { const b = await l.boundingBox(); expect(b, "o elemento medido está na tela").not.toBeNull(); return b!; };
const estilo = (l: Locator, props: string[]) => l.evaluate((el, ps) => { const cs = getComputedStyle(el); return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)])); }, props);

/** O invólucro de um campo pelo rótulo: o PAI do `<label>` (contrato do CampoDaCentral com os helpers de E2E). */
const campoPeloRotulo = (escopo: Locator, rotulo: string) => escopo.locator("label", { hasText: rotulo }).first().locator("..");

/**
 * A CAIXA do campo: o primeiro elemento dentro do invólucro, fora o rótulo, cujo fundo não é transparente (a caixa
 * pintada do desenho). Devolve geometria relativa ao invólucro e o estilo calculado.
 */
async function medirCaixa(invólucro: Locator) {
  return invólucro.evaluate((raiz) => {
    const r0 = raiz.getBoundingClientRect();
    const transparente = (c: string) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
    const alvo = [...raiz.querySelectorAll<HTMLElement>("*")].find((el) => el.tagName !== "LABEL" && !el.closest("label") && !transparente(getComputedStyle(el).backgroundColor) && el.getBoundingClientRect().height >= 20);
    if (!alvo) return null;
    const r = alvo.getBoundingClientRect(); const cs = getComputedStyle(alvo);
    return { x: Math.round(r.left - r0.left), altura: Math.round(r.height), raio: cs.borderTopLeftRadius, fundo: cs.backgroundColor, borda: cs.borderTopColor, bordaLargura: cs.borderTopWidth };
  });
}

/** Leque de Ações rápidas: nomes dos itens na ordem do DOM (um menuitem que embrulha botão conta uma vez). */
async function nomesDoLeque(page: Page) {
  const botao = page.getByTestId("central-vendas-acoes-rapidas");
  if ((await botao.getAttribute("aria-expanded")) !== "true") await botao.click();
  const leque = page.getByTestId("central-vendas-acoes-rapidas-leque");
  await expect(leque).toBeVisible();
  return leque.evaluate((raiz) => {
    const todos = [...raiz.querySelectorAll<HTMLElement>('button, [role="menuitem"]')];
    return todos.filter((el) => !todos.some((o) => o !== el && o.contains(el))).map((el) => el.getAttribute("aria-label") ?? (el.textContent ?? "").trim());
  });
}

const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const isoParaBr = (iso: string) => iso.split("-").reverse().join("/");
/** O valor que um campo mostra: o do `input`/`textarea` quando há, senão o texto do invólucro. */
async function valorMostrado(invólucro: Locator) {
  const entrada = invólucro.locator("input:not([type=hidden]), textarea").first();
  if (await entrada.count()) return entrada.inputValue();
  return (await invólucro.innerText()).trim();
}

/* ═════════════════════════════════════════════ VD-1 medidas-chave ═════════════════════════════════════════════ */

test("VD-1 — medidas-chave do desenho na criação e na consulta: barra, botões, pílula, documento, campos, itens e painel", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const top = await cadastrarTop(page);
  await abrirCriacao(page, top.id);
  const ws = page.getByTestId(WORKSPACE);
  await expect(ws, "a densidade padrão é rótulo à frente").toHaveAttribute("data-densidade", "rotulo-a-frente");

  // BARRA: 44 px, cartão branco com borda #e7eaee e raio 12 (o próprio elemento ou o cartão que o envolve)
  const barra = ws.getByTestId("central-vendas-acoes");
  expect(Math.round((await caixa(barra)).height), "altura da barra").toBe(MEDIDAS.barra.altura);
  const cartao = await barra.evaluate((el) => {
    let n: HTMLElement | null = el as HTMLElement;
    for (let i = 0; n && i < 3; i++, n = n.parentElement) { const cs = getComputedStyle(n); if (cs.borderTopLeftRadius === "12px") return { raio: cs.borderTopLeftRadius, fundo: cs.backgroundColor, borda: cs.borderTopColor }; }
    return null;
  });
  expect(cartao, "o cartão da barra tem raio 12").toEqual({ raio: MEDIDAS.barra.raio, fundo: MEDIDAS.barra.fundo, borda: MEDIDAS.barra.borda });

  // BOTÃO REDONDO (Descartar, criação): 25×25, fundo, ícone e sombra verde
  const descartar = page.getByTestId("central-vendas-descartar");
  const bd = await caixa(descartar);
  expect([Math.round(bd.width), Math.round(bd.height)], "botão redondo 25×25").toEqual([MEDIDAS.botaoRedondo.lado, MEDIDAS.botaoRedondo.lado]);
  const ed = await estilo(descartar, ["background-color", "color", "box-shadow"]);
  expect(ed["background-color"]).toBe(MEDIDAS.botaoRedondo.fundo);
  expect(ed["box-shadow"]).toBe(MEDIDAS.botaoRedondo.sombra);
  expect(await descartar.locator("svg").first().evaluate((s) => getComputedStyle(s).color), "ícone #475569").toBe(MEDIDAS.botaoRedondo.icone);

  // PÍLULA Confirmar venda: 25 px, 12,5 px peso 600
  const pilula = page.getByTestId("central-vendas-confirmar");
  expect(Math.round((await caixa(pilula)).height)).toBe(MEDIDAS.pilula.altura);
  expect(await estilo(pilula, ["font-size", "font-weight"])).toEqual({ "font-size": MEDIDAS.pilula.fonte, "font-weight": MEDIDAS.pilula.peso });

  // POSIÇÃO DO RÓTULO: segmentado de 25 px
  expect(Math.round((await caixa(page.getByTestId("central-vendas-posicao-rotulo"))).height)).toBe(MEDIDAS.posicaoDoRotulo.altura);

  // DOCUMENTO: cartão raio 14 em volta de Dados principais; cabeçalho de Dados principais
  const raioDoDocumento = await ws.getByTestId("central-vendas-dados").evaluate((el) => {
    for (let n: HTMLElement | null = el as HTMLElement; n && n.dataset["testid"] !== "central-vendas"; n = n.parentElement) if (getComputedStyle(n).borderTopLeftRadius === "14px") return "14px";
    return null;
  });
  expect(raioDoDocumento, "o documento é um cartão de raio 14").toBe(MEDIDAS.documento.raio);
  expect(Math.round((await caixa(ws.getByTestId("central-vendas-dados").locator("div").first())).height), "cabeçalho de Dados principais").toBe(MEDIDAS.cabecalhoDeDados);

  // CAMPO COM RÓTULO À FRENTE: rótulo 126 px à direita, 12 px 500 #64748b, ":" antes do "*"; caixa em 136, 30 px, raio 8
  const dados = ws.getByRole("region", { name: "Dados principais" });
  const cliente = campoPeloRotulo(dados, "Cliente");
  const rotulo = cliente.locator("label").first();
  const er = await rotulo.evaluate((el) => { const cs = getComputedStyle(el); const depois = getComputedStyle(el, "::after").content; return { largura: Math.round(el.getBoundingClientRect().width), fonte: cs.fontSize, peso: cs.fontWeight, cor: cs.color, alinhamento: cs.textAlign === "right" || cs.justifyContent === "flex-end" || cs.textAlign === "end", texto: (el.textContent ?? "").trim(), depois }; });
  expect(er.largura, "rótulo com 126 px").toBe(MEDIDAS.campo.rotuloLargura);
  expect([er.fonte, er.peso, er.cor]).toEqual([MEDIDAS.campo.rotuloFonte, MEDIDAS.campo.rotuloPeso, MEDIDAS.campo.rotuloCor]);
  expect(er.alinhamento, "rótulo alinhado à direita").toBe(true);
  const temDoisPontos = er.texto.includes(":") || er.depois.includes(":");
  expect(temDoisPontos, "o rótulo à frente leva ':'").toBe(true);
  if (er.texto.includes(":") && er.texto.includes("*")) expect(er.texto.indexOf(":"), "':' antes do '*'").toBeLessThan(er.texto.indexOf("*"));
  const vazia = await medirCaixa(cliente);
  expect(vazia, "a caixa do campo foi encontrada").not.toBeNull();
  expect([vazia!.x, vazia!.altura, vazia!.raio], "caixa em 136 px, 30 de altura, raio 8").toEqual([MEDIDAS.campo.caixaInicio, MEDIDAS.campo.caixaAltura, MEDIDAS.campo.caixaRaio]);
  expect(vazia!.fundo, "caixa vazia").toBe(MEDIDAS.campo.vazia);
  // ícone à ESQUERDA dentro da caixa (lupa)
  const icone = await cliente.evaluate((raiz) => { const r0 = raiz.getBoundingClientRect(); const s = [...raiz.querySelectorAll("svg")].map((x) => x.getBoundingClientRect()).find((b) => b.width > 0); return s ? Math.round(s.left - r0.left) : null; });
  expect(icone, "há ícone na caixa").not.toBeNull();
  expect(icone!, "o ícone fica à esquerda, dentro da caixa").toBeGreaterThanOrEqual(MEDIDAS.campo.caixaInicio);
  expect(icone!, "o ícone fica à esquerda, dentro da caixa").toBeLessThan(MEDIDAS.campo.caixaInicio + 40);
  // espaço entre campos: Cliente → Empresa
  const bCliente = await caixa(cliente); const bEmpresa = await caixa(campoPeloRotulo(dados, "Empresa"));
  expect(Math.round(bEmpresa.y - (bCliente.y + bCliente.height)), "espaço entre campos").toBe(MEDIDAS.campo.espaco);
  // preenchida: #fff com borda #e7eaee
  await pickRef(page, "Cliente", "DEMO");
  const cheia = await medirCaixa(cliente);
  expect([cheia!.fundo, cheia!.borda], "caixa preenchida").toEqual([MEDIDAS.campo.preenchida, MEDIDAS.campo.preenchidaBorda]);
  // travada: Tipo de Operação
  const travada = await medirCaixa(page.getByTestId("top-contexto"));
  expect(travada?.fundo, "campo travado").toBe(MEDIDAS.campo.travada);

  // COMPACTO: rótulo DENTRO da caixa, 32 px
  await page.getByRole("button", { name: "Rótulo dentro do campo" }).click();
  await expect(ws).toHaveAttribute("data-densidade", "compacto");
  const compacta = await medirCaixa(cliente);
  expect(compacta?.altura, "compacto: 32 px").toBe(MEDIDAS.compacto.caixaAltura);
  const dentro = await cliente.evaluate((raiz) => { const l = raiz.querySelector("label")!.getBoundingClientRect(); const r = raiz.getBoundingClientRect(); return l.left >= r.left && l.right <= r.right && l.top >= r.top && l.bottom <= r.bottom; });
  expect(dentro, "o rótulo mora dentro da caixa").toBe(true);

  // CONSULTA: só leitura, valor 12,5 px, itens e painel
  const venda = await vendaPelaApi(page, { tipo_operacao_id: top.id });
  await abrirConsulta(page, venda);
  const consulta = page.getByTestId(WORKSPACE);
  const clienteLido = consulta.locator('[data-campo="Cliente"]');
  const leitura = await medirCaixa(clienteLido);
  expect(leitura?.fundo, "só leitura").toBe(MEDIDAS.campo.leitura);
  const fonteDoValor = await clienteLido.getByText(venda.clientName).first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(fonteDoValor, "valor 12,5 px").toBe(MEDIDAS.campo.valorFonte);
  expect((await medirCaixa(page.getByTestId("top-contexto")))?.fundo, "Tipo de Operação travado na consulta").toBe(MEDIDAS.campo.travada);
  // botão redondo e Novo verde na consulta
  const dup = page.getByTestId("central-vendas-duplicar");
  const bdup = await caixa(dup);
  expect([Math.round(bdup.width), Math.round(bdup.height)]).toEqual([MEDIDAS.botaoRedondo.lado, MEDIDAS.botaoRedondo.lado]);
  expect((await estilo(page.getByTestId("central-vendas-novo"), ["background-color"]))["background-color"], "Novo verde").toBe(MEDIDAS.novo.fundo);
  // ITENS (consulta; a grade da criação é a Fase B): barra 36, cabeçalho 28, linha 23, rodapé 32
  const itens = consulta.getByTestId("central-vendas-itens");
  expect(Math.round((await caixa(itens.getByRole("toolbar").first())).height), "barra de itens").toBe(MEDIDAS.itens.barra);
  expect(Math.round((await caixa(page.getByTestId("central-vendas-grade").locator("thead tr").first())).height), "cabeçalho da grade").toBe(MEDIDAS.itens.cabecalho);
  expect(Math.round((await caixa(page.getByTestId("central-vendas-linha").first())).height), "linha da grade").toBe(MEDIDAS.itens.linha);
  expect(Math.round((await caixa(page.getByTestId("central-vendas-subtotal").locator(".."))).height), "rodapé dos itens").toBe(MEDIDAS.itens.rodape);
  // PAINEL: faixa de abas 38 px
  expect(Math.round((await caixa(page.getByTestId("central-vendas-painel").getByRole("tablist"))).height), "faixa de abas").toBe(MEDIDAS.painel.faixa);
  // largura máxima 560: ampliado, a coluna é larga e nenhum campo passa de 560
  await page.getByTestId("central-vendas-ampliar-dados").click();
  const larguras = await consulta.getByTestId("central-vendas-dados").locator("[data-campo]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(larguras.length, "premissa: há campos para medir").toBeGreaterThan(3);
  expect(Math.max(...larguras), "largura máxima do campo").toBeLessThanOrEqual(MEDIDAS.campo.larguraMaxima);
});

/* ═════════════════════════════════════════════ VD-2 posição do rótulo ═════════════════════════════════════════════ */

test("VD-2 — posição do rótulo: alterna, não grava NADA no navegador nem no perfil, e remontar volta ao padrão", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page);
  const antes = await chavesDoNavegador(page);
  await abrirCriacao(page, top.id);
  const escritas = registrarEscritas(page);
  const ws = page.getByTestId(WORKSPACE);
  const grupo = page.getByTestId("central-vendas-posicao-rotulo");
  await expect(grupo).toHaveAttribute("role", "group");
  await expect(grupo).toHaveAccessibleName("Posição do rótulo");
  const antesDoCampo = grupo.getByRole("button", { name: "Rótulo antes do campo" });
  const dentroDoCampo = grupo.getByRole("button", { name: "Rótulo dentro do campo" });
  await expect(antesDoCampo, "padrão: rótulo antes do campo").toHaveAttribute("aria-pressed", "true");
  await expect(dentroDoCampo).toHaveAttribute("aria-pressed", "false");
  await expect(ws).toHaveAttribute("data-densidade", "rotulo-a-frente");

  await dentroDoCampo.click();
  await expect(dentroDoCampo).toHaveAttribute("aria-pressed", "true");
  await expect(antesDoCampo).toHaveAttribute("aria-pressed", "false");
  await expect(ws).toHaveAttribute("data-densidade", "compacto");
  // vale para todos os campos da Central: o rótulo do Cliente e o de uma aba mudaram juntos
  const cliente = campoPeloRotulo(ws.getByRole("region", { name: "Dados principais" }), "Cliente");
  const rotuloDentro = () => cliente.evaluate((raiz) => { const l = raiz.querySelector("label")!.getBoundingClientRect(); const r = raiz.getBoundingClientRect(); return Math.round(l.left - r.left) < 126; });
  expect(await rotuloDentro(), "compacto: o rótulo começa dentro da caixa").toBe(true);
  await antesDoCampo.click();
  await expect(ws).toHaveAttribute("data-densidade", "rotulo-a-frente");
  await dentroDoCampo.click();
  await expect(ws).toHaveAttribute("data-densidade", "compacto");

  expect(await chavesDoNavegador(page), "nenhuma chave nova no navegador (nem local, nem sessão)").toEqual(antes);
  expect(escritas, "nenhuma escrita na API: o perfil não guarda a posição").toEqual([]);

  // remontar a MESMA URL devolve o padrão — não há onde ter guardado
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top.id}`);
  await expect(page.getByTestId(WORKSPACE)).toHaveAttribute("data-densidade", "rotulo-a-frente");
  await expect(page.getByTestId("central-vendas-posicao-rotulo").getByRole("button", { name: "Rótulo antes do campo" })).toHaveAttribute("aria-pressed", "true");
  // e a consulta também nasce no padrão
  const venda = await vendaPelaApi(page);
  await abrirConsulta(page, venda);
  await expect(page.getByTestId(WORKSPACE)).toHaveAttribute("data-densidade", "rotulo-a-frente");
});

/* ═════════════════════════════════════════════ VD-3 leque ═════════════════════════════════════════════ */

test("VD-3 — leque de Ações rápidas: itens por modo e por permissão; sem Anexos; Esc fecha", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page);
  const venda = await vendaPelaApi(page, { tipo_operacao_id: top.id });
  const documentos = /^\d+ documentos? abertos?$/;

  // CRIAÇÃO
  await abrirCriacao(page, top.id);
  const criacao = await nomesDoLeque(page);
  expect(criacao.slice(0, 3)).toEqual(["Alterar operação", "Imprimir", "Histórico de alterações"]);
  expect(criacao[3]).toMatch(documentos);
  expect(criacao, "exatamente quatro itens na criação").toHaveLength(4);
  await expect(page.getByTestId("central-vendas-imprimir")).toBeDisabled();
  await expect(page.getByTestId("central-vendas-historico")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("central-vendas-acoes-rapidas-leque"), "Esc fecha").toBeHidden();
  await expect(page.getByTestId("central-vendas-acoes-rapidas"), "e o foco volta ao botão").toBeFocused();

  // CONSULTA (venda aberta, com todas as capacidades)
  await abrirConsulta(page, venda);
  const consulta = await nomesDoLeque(page);
  expect(consulta).toEqual(["Imprimir", "Histórico de alterações", expect.stringMatching(documentos), "Cancelar venda…"]);
  const leque = page.getByTestId("central-vendas-acoes-rapidas-leque");
  await expect(leque.getByRole("button", { name: /anexo/i }), "sem Anexos").toHaveCount(0);
  await expect(leque.getByRole("menuitem", { name: /anexo/i })).toHaveCount(0);
  await expect(leque.getByText(/anexo/i)).toHaveCount(0);
  // Cancelar em vermelho (perigo)
  const cor = await page.getByTestId("central-vendas-cancelar").evaluate((el) => getComputedStyle(el).color);
  const [r, g, b] = (cor.match(/\d+/g) ?? []).map(Number);
  expect(r! > g! && r! > b!, `Cancelar em vermelho (${cor})`).toBe(true);
  await page.keyboard.press("Escape");
  await expect(leque).toBeHidden();

  // POR PERMISSÃO: sem audit_logs.view e sem sales.delete, o leque não OFERECE Histórico nem Cancelar (quem nega é a API)
  await page.route("**/api/auth/context", async (rota) => {
    const resposta = await rota.fetch();
    const corpo = await resposta.json() as { permissions: string[] };
    await rota.fulfill({ response: resposta, json: { ...corpo, isOwner: false, permissions: corpo.permissions.filter((p) => p !== "audit_logs.view" && p !== "sales.delete") } });
  });
  await page.reload();
  await expect(page.getByTestId("central-vendas-identidade-nome")).toHaveText(venda.code);
  const semPermissao = await nomesDoLeque(page);
  expect(semPermissao[0], "premissa: o leque abriu").toBe("Imprimir");
  expect(semPermissao.some((n) => /Histórico/.test(n)), "sem audit_logs.view, sem Histórico").toBe(false);
  expect(semPermissao.some((n) => /^Cancelar/.test(n)), "sem sales.delete, sem Cancelar").toBe(false);
  await page.keyboard.press("Escape");
  await page.unroute("**/api/auth/context");

  // CONFIRMADA: não oferece Cancelar (a regra de hoje)
  await api(page, "POST", `/api/sales/sales/${venda.id}/confirm`, {});
  await page.reload();
  await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]"), "premissa: confirmada").toHaveAttribute("data-status", "confirmed");
  const confirmada = await nomesDoLeque(page);
  expect(confirmada).toEqual(["Imprimir", "Histórico de alterações", expect.stringMatching(documentos)]);
  await page.keyboard.press("Escape");
});

/* ═════════════════════════════════════════════ VD-4 Novo documento ═════════════════════════════════════════════ */

test("VD-4 — Novo documento: as TOPs vêm do servidor, a padrão é marcada, e o clique abre o lançamento com a TOP", async ({ page }) => {
  await login(page);
  const venda = await vendaPelaApi(page);
  const a = await cadastrarTop(page);
  const b = await cadastrarTop(page);

  // (1) CONTRA O SERVIDOR REAL: o menu segue o corte do menu rápido do portal sobre a MESMA resposta
  const real = await api<{ items: { id: string; code: string; isDefault: boolean }[] }>(page, "GET", "/api/sales/sales/operation-types");
  const esperadas = real.items.length <= 8 ? real.items : real.items.filter((x) => x.isDefault);
  const perguntas: string[] = [];
  page.on("request", (r) => { if (r.method() === "GET" && new URL(r.url()).pathname === "/api/sales/sales/operation-types") perguntas.push(r.url()); });
  await abrirConsulta(page, venda);
  await page.getByTestId("central-vendas-novo").click();
  const menu = page.getByRole("menu").filter({ hasText: "Nova operação · Venda" });
  await expect(menu, "o menu diz a espécie").toBeVisible();
  await expect.poll(() => perguntas.length, { message: "a lista é a do servidor (GET operation-types)" }).toBeGreaterThan(0);
  for (const t of esperadas) await expect(menu.getByRole("menuitem").filter({ hasText: t.code }).first(), `a TOP ${t.code} do servidor está no menu`).toBeVisible();
  if (real.items.length > 8) await expect(menu.getByRole("menuitem", { name: /Escolher operação/ }), "acima do corte, o pé leva à janela").toBeVisible();
  await page.keyboard.press("Escape");

  // (2) RESPOSTA CONTROLADA com duas TOPs REAIS: a padrão tem o selo, e o clique lança com a TOP escolhida
  const corpo = { contractVersion: 1, family: { code: "vendas.venda", label: "Venda" }, defaultId: a.id, items: [
    { id: a.id, code: a.codigo, name: a.nome, version: 1, isDefault: true },
    { id: b.id, code: b.codigo, name: b.nome, version: 1, isDefault: false }
  ] };
  await page.route("**/api/sales/sales/operation-types", (rota) => rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corpo) }));
  await page.reload();
  await expect(page.getByTestId("central-vendas-identidade-nome")).toHaveText(venda.code);
  await page.getByTestId("central-vendas-novo").click();
  await expect(menu).toBeVisible();
  const itemA = menu.getByRole("menuitem").filter({ hasText: a.codigo });
  const itemB = menu.getByRole("menuitem").filter({ hasText: b.codigo });
  await expect(itemA).toContainText(a.nome);
  await expect(itemA, "a padrão leva o selo").toContainText("Padrão");
  await expect(itemB).not.toContainText("Padrão");
  await expect(menu.getByRole("menuitem", { name: /Escolher operação/ }), "abaixo do corte, sem o pé").toHaveCount(0);
  await itemB.click();
  await expect(page).toHaveURL(new RegExp(`/vendas/sales/new\\?tipo_operacao_id=${b.id}$`));
  await expect(page.getByTestId("top-contexto"), "a rota de destino reconferiu a TOP escolhida").toContainText(b.codigo);
});

/* ═════════════════════════════════════════════ VD-5 Duplicar ═════════════════════════════════════════════ */

test("VD-5 — Duplicar: mesmos valores sem datas nem identidade; ponto aceso; nada na URL nem no navegador; POST com as chaves do W4", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page);
  const par = await parDoSeed(page);
  const original = await vendaPelaApi(page, {
    tipo_operacao_id: top.id, categoria_financeira_id: par.categoria, centro_custo_id: par.centro,
    document_date: "2026-08-03", due_date: "2026-08-20", shipping_date: "2026-08-05",
    note: "observação do original", driver_name: "Motorista do original", freight: "12.00", discount: "1.50"
  });
  const antes = await chavesDoNavegador(page);
  await abrirConsulta(page, original);
  const escritas = registrarEscritas(page);
  const duplicar = page.getByTestId("central-vendas-duplicar");
  await expect(duplicar).toBeEnabled();
  await duplicar.click();

  // abre o lançamento da MESMA TOP, e a URL não leva dado nenhum além dela
  await expect(page).toHaveURL(new RegExp(`/vendas/sales/new\\?tipo_operacao_id=${top.id}$`));
  expect([...new URL(page.url()).searchParams.keys()], "a URL leva só a TOP").toEqual(["tipo_operacao_id"]);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(page.getByText("Cópia aberta como rascunho"), "o aviso da cópia").toBeVisible();
  await expect(page.getByTestId("central-vendas-alterado"), "os valores trazidos contam como alteração").toBeVisible();
  await expect(page.getByTestId("top-contexto")).toContainText(top.codigo);

  // os valores vieram
  const dados = page.getByTestId(WORKSPACE).getByRole("region", { name: "Dados principais" });
  await expect(campoPeloRotulo(dados, "Cliente")).toContainText(original.clientName);
  await expect(page.getByTestId("central-vendas-linha"), "os itens vieram").toHaveCount(1);
  await abrirAbaDoLancamento(page, "Observações");
  await expect(page.getByLabel("Observação")).toHaveValue("observação do original");
  await abrirAbaDoLancamento(page, "Frete e transporte");
  await expect(page.getByLabel("Motorista")).toHaveValue("Motorista do original");

  // as datas NÃO vieram: Data = hoje; Vencimento e Data de saída sem as do original
  expect(await valorMostrado(campoPeloRotulo(dados, "Data")), "Data = hoje").toMatch(new RegExp(`${hojeIso()}|${isoParaBr(hojeIso())}`));
  for (const [rotulo, iso] of [["Vencimento", "2026-08-20"], ["Data de saída", "2026-08-05"]] as const) {
    const campo = page.getByTestId(WORKSPACE).locator("label", { hasText: rotulo }).first().locator("..");
    if (await campo.count()) expect(await valorMostrado(campo), `${rotulo} não é a do original`).not.toMatch(new RegExp(`${iso}|${isoParaBr(iso)}`));
  }
  expect(await chavesDoNavegador(page), "nenhuma chave nova no navegador: a cópia foi em memória").toEqual(antes);
  expect(escritas, "duplicar não escreveu nada").toEqual([]);

  // salvar a cópia é o POST de sempre, com as MESMAS chaves do W4
  let corpo: Record<string, unknown> | null = null;
  await page.route("**/api/sales/sales", async (rota) => {
    if (rota.request().method() !== "POST") return rota.fallback();
    corpo = rota.request().postDataJSON() as Record<string, unknown>;
    await rota.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000000" }) });
  });
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => corpo, { message: "o POST da cópia saiu" }).not.toBeNull();
  expect(Object.keys(corpo!).sort(), "as MESMAS 20 chaves do W4").toEqual([
    "categoria_financeira_id", "centro_custo_id",
    "client_id", "discount", "document_date", "driver_name", "due_date", "empresa_id", "freight", "freight_icms",
    "installment_plan", "is_deductible", "items", "note", "other_values", "payment_method_id", "proprietary_id",
    "shipping_date", "tipo_operacao_id", "transporter_id"
  ]);
  expect(corpo!["tipo_operacao_id"]).toBe(top.id);
  expect(corpo!["document_date"], "Data = hoje").toBe(hojeIso());
  expect(corpo!["due_date"], "sem o vencimento do original").not.toBe("2026-08-20");
  expect(corpo!["shipping_date"], "sem a data de saída do original").not.toBe("2026-08-05");
  expect(corpo!["note"]).toBe("observação do original");
  expect(corpo!["categoria_financeira_id"]).toBe(par.categoria);
  const item = (corpo!["items"] as Record<string, unknown>[])[0]!;
  expect(Object.keys(item).sort()).toEqual(["discount", "discount_percent", "note", "product_id", "quantity", "unit_price", "warehouse_id"]);
  expect([item["quantity"], item["unit_price"]].map((v) => Number(v))).toEqual([2, 10]);
});

test("VD-5b — Duplicar: documento com origem ou sem TOP fica desabilitado com o motivo; TOP inativa avisa e nada abre", async ({ page }) => {
  await login(page);
  // SEM TOP (registro legado)
  const legado = await vendaPelaApi(page);
  await abrirConsulta(page, legado);
  const duplicar = page.getByTestId("central-vendas-duplicar");
  await expect(duplicar, "sem TOP não duplica").toBeDisabled();
  expect((await duplicar.getAttribute("data-dica")) ?? "", "a dica diz o motivo").not.toBe("Duplicar documento");

  // COM ORIGEM: pedido gerado de orçamento
  const orcamento = await vendaPelaApi(page, {}, "budgets");
  const pedido = await api<{ id: string; kind: string }>(page, "POST", `/api/sales/budgets/${orcamento.id}/convert`, {});
  expect(pedido.kind, "premissa: o orçamento virou pedido").toBe("order");
  const lidoPedido = await api<{ code: string }>(page, "GET", `/api/sales/orders/${pedido.id}`);
  await page.goto(`/vendas/orders/${pedido.id}`);
  await expect(page.getByTestId("central-vendas-identidade-nome")).toHaveText(lidoPedido.code);
  await expect(page.getByTestId("central-vendas-duplicar"), "documento com origem não duplica").toBeDisabled();
  expect((await page.getByTestId("central-vendas-duplicar").getAttribute("data-dica")) ?? "").not.toBe("Duplicar documento");

  // TOP QUE FICOU INATIVA: a mensagem de hoje do lançamento, e a cópia é descartada
  const top = await cadastrarTop(page);
  const venda = await vendaPelaApi(page, { tipo_operacao_id: top.id, note: "não pode reaparecer" });
  const atual = await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${top.id}`);
  await api(page, "PUT", `/api/admin/tipos-operacao/${top.id}`, { ativo: false, revisao: atual.revisao });
  await abrirConsulta(page, venda);
  const escritas = registrarEscritas(page);
  await page.getByTestId("central-vendas-duplicar").click();
  await expect(page.getByTestId("top-indisponivel"), "a mensagem de hoje").toBeVisible();
  await expect(page.getByTestId(WORKSPACE), "nada aberto com a TOP inativa").toHaveCount(0);
  // a cópia foi descartada: um lançamento novo com outra TOP nasce limpo
  const outra = await cadastrarTop(page);
  await abrirCriacao(page, outra.id);
  await expect(page.getByTestId("central-vendas-alterado"), "lançamento limpo").toHaveCount(0);
  await abrirAbaDoLancamento(page, "Observações");
  await expect(page.getByLabel("Observação")).toHaveValue("");
  expect(escritas).toEqual([]);
});

/**
 * TODO-COORDENADOR: o shell só mantém montada a tela ATIVA e `useDirtyTab` limpa o ponto ao desmontar — trocar para a
 * aba da consulta pode apagar o rascunho antes do clique em Duplicar. Se o caso for inalcançável no produto, a decisão
 * (manter, trocar a prova ou registrar a regra como inaplicável) é do coordenador; este caso prova o que o pedido diz.
 */
test("VD-5c — Duplicar com rascunho alterado da mesma espécie pergunta antes de trocar; Continuar editando preserva o rascunho", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page);
  const venda = await vendaPelaApi(page, { tipo_operacao_id: top.id });
  await abrirConsulta(page, venda);
  await abrirCriacao(page, top.id);
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("rascunho que não pode sumir calado");
  const abaNova = page.locator('[data-testid="workspace-tab"][data-tab-key="/vendas/sales/new"]');
  await expect(abaNova).toHaveAttribute("data-dirty", "true");
  const escritas = registrarEscritas(page);

  await page.locator(`[data-testid="workspace-tab"][data-tab-key="/vendas/sales/${venda.id}"]`).click();
  await expect(page.getByTestId("central-vendas-identidade-nome")).toHaveText(venda.code);
  await page.getByTestId("central-vendas-duplicar").click();
  const dlg = page.getByTestId("confirm-dialog");
  await expect(dlg, "rascunho nunca é sobrescrito calado").toBeVisible();
  await expect(dlg.getByRole("heading", { name: /^Fechar .+\?$/ })).toBeVisible();
  await dlg.getByRole("button", { name: "Continuar editando", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(abaNova, "o rascunho continua lá, sujo").toHaveAttribute("data-dirty", "true");
  await abaNova.click();
  await abrirAbaDoLancamento(page, "Observações");
  await expect(page.getByLabel("Observação"), "e com o que foi digitado").toHaveValue("rascunho que não pode sumir calado");
  expect(escritas).toEqual([]);
});

/* ═════════════════════════════════════════════ VD-6 Descartar ═════════════════════════════════════════════ */

test("VD-6 — Descartar: pergunta, Continuar editando mantém, confirmar volta ao estado de ABERTURA (mesma TOP, padrões) sem escrita", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page);
  await abrirCriacao(page, top.id);
  const ws = page.getByTestId(WORKSPACE);
  const dados = ws.getByRole("region", { name: "Dados principais" });
  const retrato = async () => ({ dados: (await dados.innerText()).replace(/\s+/g, " ").trim(), data: await valorMostrado(campoPeloRotulo(dados, "Data")) });
  const abertura = await retrato();
  expect(abertura.data, "premissa: a abertura aplica os padrões (Data = hoje)").toMatch(new RegExp(`${hojeIso()}|${isoParaBr(hojeIso())}`));
  const escritas = registrarEscritas(page);

  await pickRef(page, "Cliente", "DEMO");
  await abrirAbaDoLancamento(page, "Observações");
  await page.getByLabel("Observação").fill("vai ser descartado");
  await expect(page.getByTestId("central-vendas-alterado")).toBeVisible();

  const descartar = page.getByTestId("central-vendas-descartar");
  await descartar.click();
  const dlg = page.getByTestId("confirm-dialog");
  await expect(dlg.getByRole("heading", { name: "Descartar as alterações?" })).toBeVisible();
  await expect(dlg).toContainText("O documento volta como estava antes desta edição.");
  await dlg.getByRole("button", { name: "Continuar editando", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByLabel("Observação"), "continuar editando mantém tudo").toHaveValue("vai ser descartado");

  await descartar.click();
  await dlg.getByRole("button", { name: "Descartar alterações", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("central-vendas-alterado"), "voltou à abertura: nada alterado").toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`tipo_operacao_id=${top.id}$`));
  await expect(page.getByTestId("top-contexto"), "a MESMA TOP").toContainText(top.codigo);
  await expect.poll(retrato, { message: "Dados principais como na abertura (padrões reaplicados, não um formulário em branco)" }).toEqual(abertura);
  await abrirAbaDoLancamento(page, "Observações");
  await expect(page.getByLabel("Observação")).toHaveValue("");
  expect(escritas, "descartar não escreve").toEqual([]);
});

/* ═════════════════════════════════════════════ VD-7 pendências ═════════════════════════════════════════════ */

test("VD-7 — Salvar com pendências: ZERO POST, pílula com a lista, clique leva ao campo; estado (layout) continua DESABILITANDO", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page);
  await abrirCriacao(page, top.id);
  const escritas = registrarEscritas(page);
  const salvar = page.getByRole("button", { name: "Salvar" });
  await preencherClassificacaoFinanceira(page);                     // Fase A: Natureza/Centro ainda desabilitam (ajuste B)
  await expect(salvar, "com alteração, o Salvar habilita").toBeEnabled();

  await salvar.click();
  const pilula = page.getByTestId("central-vendas-pendencias");
  await expect(pilula).toBeVisible();
  const n = Number(/(\d+)\s+pend/.exec(await pilula.innerText())?.[1] ?? "0");
  expect(n, "cliente e itens faltando: ao menos duas pendências").toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(400);
  expect(escritas, "ZERO POST — a guarda está no handler").toEqual([]);
  // a cor do desenho: pílula vermelha
  const corDaPilula = await pilula.evaluate((el) => getComputedStyle(el).color);
  const [r, g, b] = (corDaPilula.match(/\d+/g) ?? []).map(Number);
  expect(r! > g! && r! > b!, `pílula vermelha (${corDaPilula})`).toBe(true);

  await pilula.click();
  const lista = page.getByTestId("central-vendas-pendencias-lista");
  await expect(lista.getByTestId("central-vendas-pendencia")).toHaveCount(n);
  await lista.getByTestId("central-vendas-pendencia").filter({ hasText: "Cliente" }).first().click();
  await expect(lista, "a lista fecha").toBeHidden();
  const cliente = campoPeloRotulo(page.getByTestId(WORKSPACE).getByRole("region", { name: "Dados principais" }), "Cliente");
  await expect.poll(async () => (await cliente.evaluate((el) => el.contains(document.activeElement))) || (await page.locator("[data-radix-popper-content-wrapper]").count()) > 0,
    { message: "Cliente → o foco vai ao campo (ou a pesquisa dele abre)" }).toBe(true);
  await page.keyboard.press("Escape");

  // ESTADO que não é pendência de campo continua DESABILITANDO: layout que não carrega
  await page.route("**/api/sales/sales/layout-efetivo**", (rota) => rota.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "falha simulada" } }) }));
  const outra = await cadastrarTop(page);
  await abrirCriacao(page, outra.id);
  await expect(page.getByTestId("layout-nao-carregado"), "premissa: o layout falhou").toBeVisible({ timeout: 20_000 });
  await preencherClassificacaoFinanceira(page);
  await expect(page.getByRole("button", { name: "Salvar" }), "layout com falha: desabilitado, como hoje").toBeDisabled();
  expect(escritas).toEqual([]);
});

/* ═════════════════════════════════════════════ VD-8 Salvo e Confirmar na criação ═════════════════════════════════════════════ */

async function preencherLancamentoValido(page: Page) {
  await pickRef(page, "Cliente", "DEMO");
  await preencherClassificacaoFinanceira(page);
  await page.getByRole("button", { name: /Adicionar item/ }).click();
  await escolherPrimeiroProdutoDaLinha(page);
  await page.getByTestId("central-vendas-linha").first().getByLabel("Valor unitário").fill("10");
}

test("VD-8 — Salvo aparece e some; Confirmar venda na criação salva e abre o diálogo com a prévia; fechar deixa Aberto", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page);

  // SALVAR → o documento salvo abre com "Salvo" por ~2,4 s, sem URL nem armazenamento
  const antes = await chavesDoNavegador(page);
  await abrirCriacao(page, top.id);
  await preencherLancamentoValido(page);
  const criada = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/sales/sales");
  await page.getByRole("button", { name: "Salvar" }).click();
  const r1 = await criada;
  expect(r1.status()).toBe(201);
  const { id } = await r1.json() as { id: string };
  await expect(page).toHaveURL(new RegExp(`/vendas/sales/${id}$`));
  const salvo = page.getByTestId("central-vendas-salvo");
  await expect(salvo, "Salvo aparece").toBeVisible();
  await expect(salvo).toContainText("Salvo");
  await expect(salvo, "e some sozinho (2,4 s)").toBeHidden({ timeout: 5_000 });
  expect(await chavesDoNavegador(page), "o aviso não passou pelo navegador").toEqual(antes);

  // CONFIRMAR VENDA NA CRIAÇÃO: o MESMO POST; depois, o diálogo de Confirmar venda COM a prévia do servidor
  await abrirCriacao(page, top.id);
  await preencherLancamentoValido(page);
  const escritas = registrarEscritas(page);
  const criada2 = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/sales/sales");
  const previa = page.waitForResponse((r) => r.request().method() === "GET" && /\/api\/sales\/sales\/[0-9a-f-]{36}\/previa-confirmacao$/.test(new URL(r.url()).pathname));
  await page.getByTestId("central-vendas-acoes").getByRole("button", { name: "Confirmar venda" }).click();
  const r2 = await criada2;
  expect(r2.status()).toBe(201);
  const { id: id2 } = await r2.json() as { id: string };
  const lida = await api<{ code: string }>(page, "GET", `/api/sales/sales/${id2}`);
  await expect(page).toHaveURL(new RegExp(`/vendas/sales/${id2}$`));
  const dlg = page.getByTestId("confirm-dialog");
  await expect(dlg.getByRole("heading", { name: `Confirmar venda ${lida.code}?` }), "o diálogo abre sozinho no documento salvo").toBeVisible();
  expect((await previa).status(), "a prévia foi pedida ao servidor").toBeLessThan(500);
  await expect(dlg.getByTestId("previa-confirmacao").or(dlg.getByTestId("previa-confirmacao-neutra")).or(dlg.getByTestId("previa-confirmacao-recusa")), "nenhuma confirmação sem prévia").toBeVisible();
  await dlg.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(dlg).toBeHidden();
  const depois = await api<{ status: string }>(page, "GET", `/api/sales/sales/${id2}`);
  expect(depois.status, "fechar o diálogo deixa a venda salva como Aberto").toBe("open");
  expect(escritas.map((e) => `${e.metodo} ${e.caminho}`), "um POST de criação e NENHUM de confirmação").toEqual(["POST /api/sales/sales"]);

  // "Confirmando…" na barra enquanto a confirmação corre
  let soltar!: () => void;
  const segura = new Promise<void>((ok) => { soltar = ok; });
  await page.route(`**/api/sales/sales/${id2}/confirm`, async (rota) => { await segura; await rota.continue(); });
  await page.getByTestId("central-vendas-acoes").getByRole("button", { name: "Confirmar venda" }).click();
  await expect(dlg.getByTestId("confirm-dialog-confirm")).toBeEnabled({ timeout: 15_000 });
  await dlg.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("central-vendas-confirmando"), "Confirmando… na barra").toBeVisible();
  soltar();
  await expect(page.getByTestId("central-vendas-confirmando")).toBeHidden({ timeout: 15_000 });
  await expect.poll(async () => (await api<{ status: string }>(page, "GET", `/api/sales/sales/${id2}`)).status).toBe("confirmed");
});

/* ═════════════════════════════════════════════ VD-9 Cancelar com motivo ═════════════════════════════════════════════ */

test("VD-9 — Cancelar com motivo: reason = texto aparado; vazio → o texto padrão de hoje; sempre com Idempotency-Key", async ({ page }) => {
  await login(page);
  for (const caso of [{ digitado: "  Cliente desistiu da compra  ", esperado: "Cliente desistiu da compra" }, { digitado: "", esperado: MOTIVO_PADRAO }]) {
    const venda = await vendaPelaApi(page);
    await abrirConsulta(page, venda);
    await (await acaoDaCentral(page, "central-vendas-cancelar")).click();
    const dlg = page.getByTestId("confirm-dialog");
    await expect(dlg.getByRole("heading", { name: `Cancelar venda ${venda.code}?` })).toBeVisible();
    await expect(dlg, "o texto de efeito de hoje").toContainText(TEXTO_DE_EFEITO_DO_CANCELAMENTO);
    await expect(dlg).toContainText("Motivo (opcional)");
    const motivo = dlg.getByPlaceholder("Registrado no cancelamento");
    await expect(motivo).toBeVisible();
    if (caso.digitado) await motivo.fill(caso.digitado);
    const botao = dlg.getByRole("button", { name: "Cancelar venda", exact: true });
    await expect(botao).toBeVisible();
    const corDoBotao = await botao.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = (corDoBotao.match(/\d+/g) ?? []).map(Number);
    expect(r! > g! && r! > b!, `botão vermelho (${corDoBotao})`).toBe(true);

    const resposta = page.waitForResponse((x) => x.request().method() === "POST" && new URL(x.url()).pathname === `/api/sales/sales/${venda.id}/cancel`);
    await botao.click();
    const res = await resposta;
    expect(res.status(), await res.text()).toBe(200);
    expect(res.request().postDataJSON(), "reason = motivo aparado, ou o texto padrão").toEqual({ reason: caso.esperado });
    expect(res.request().headers()["idempotency-key"], "com Idempotency-Key").toBeTruthy();
    const depois = await api<{ status: string }>(page, "GET", `/api/sales/sales/${venda.id}`);
    expect(depois.status).toBe("cancelled");
  }
});

/* ═════════════════════════════════════════════ VD-10 consulta ═════════════════════════════════════════════ */

test("VD-10 — consulta: Fiscal (NF-e e Dedutível do registro), Financeiro com o plano e o contador de títulos, Total do servidor em Totais, Dados adicionais", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page);
  const antes = await chavesDoNavegador(page);
  const venda = await vendaPelaApi(page, { tipo_operacao_id: top.id, is_deductible: true, freight: "5.00", installment_plan: { installments: 3, first_due_date: "2026-10-15", mode: "interval", interval_days: 30 } });
  const lido = await api<{ total: string; installment_plan: { is_deductible?: boolean; installments?: number } }>(page, "GET", `/api/sales/sales/${venda.id}`);
  expect(lido.installment_plan.is_deductible, "premissa: o registro é dedutível").toBe(true);
  expect(lido.installment_plan.installments, "premissa: o plano do registro tem 3 parcelas").toBe(3);
  await abrirConsulta(page, venda);
  const painel = page.getByTestId("central-vendas-painel");
  await expect(painel.getByRole("tab")).toHaveText(["Totais", "Financeiro", "Frete e transporte", "Fiscal", "Observações"]);

  // TOTAIS: Total do documento do SERVIDOR, campo travado
  await abrirAbaDoLancamento(page, "Totais");
  const reais = (v: string) => Number(v).toFixed(2).replace(".", ",");
  await expect(page.getByTestId("central-vendas-total")).toContainText(reais(lido.total));
  expect((await medirCaixa(page.getByTestId("central-vendas-total")))?.fundo ?? (await medirCaixa(page.getByTestId("central-vendas-total").locator("..")))?.fundo, "total travado").toBe(MEDIDAS.campo.travada);

  // FISCAL: NF-e "Nenhuma vinculada"; Dedutível do registro, só leitura
  await abrirAbaDoLancamento(page, "Fiscal");
  const fiscal = painel.getByRole("tabpanel");
  await expect(fiscal).toContainText("NF-e");
  await expect(fiscal).toContainText("Nenhuma vinculada");
  const chave = fiscal.getByRole("switch").first();
  await expect(chave, "Dedutível do registro").toHaveAttribute("aria-checked", "true");
  await chave.click({ force: true });
  await expect(chave, "só leitura na consulta").toHaveAttribute("aria-checked", "true");

  // FINANCEIRO: o plano do registro em só leitura
  await abrirAbaDoLancamento(page, "Financeiro");
  const fin = painel.getByRole("tabpanel");
  await expect(fin.locator('[data-campo="Parcelamento"]')).toContainText("Parcelado");
  await expect(fin.locator('[data-campo="Nº de parcelas"]')).toContainText("3");
  await expect(fin.locator('[data-campo="1º vencimento"]')).toContainText("15/10/2026");
  await expect(fin.locator('[data-campo="Intervalo (dias)"]')).toContainText("30");
  await expect(fin, "sem títulos ainda").toContainText("Nenhum título vinculado a este documento.");
  await expect(fin.locator("input:not([type=hidden]):enabled, select:enabled, textarea:enabled"), "nada editável no plano da consulta").toHaveCount(0);

  // DADOS ADICIONAIS: Movimento, Versão da operação, Origem "Lançamento direto"
  await abrirDadosAdicionais(page);
  const ws = page.getByTestId(WORKSPACE);
  await expect(ws.locator('[data-campo="Movimento"]')).not.toBeEmpty();
  await expect(ws.locator('[data-campo="Versão da operação"]')).toContainText("1");
  await expect(ws.locator('[data-campo="Origem"]')).toContainText("Lançamento direto");
  // Número, Natureza e Centro ficam em Dados principais (fora do grupo)
  await expect(ws.getByTestId("central-vendas-dados").locator('[data-campo="Número"]')).toContainText(venda.code);

  // CONFIRMADA: o contador de títulos na aba Financeiro e a lista de títulos
  const confirmada = await api<{ title_ids: string[] }>(page, "POST", `/api/sales/sales/${venda.id}/confirm`, {});
  expect(confirmada.title_ids.length, "premissa: a confirmação gerou títulos").toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByTestId("central-vendas-identidade-nome")).toHaveText(venda.code);
  await expect(painel.getByRole("tab", { name: /Financeiro/ }), "o contador de títulos").toContainText(String(confirmada.title_ids.length));
  await abrirAbaDoLancamento(page, "Financeiro");
  await expect(painel.getByRole("tabpanel").locator(`a[href="/financeiro/contas-a-receber/${confirmada.title_ids[0]}"]`)).toBeVisible();
  expect(await chavesDoNavegador(page), "a consulta não escreve no navegador").toEqual(antes);
});

/* ═════════════════════════════════════════════ VD-11 ampliar ═════════════════════════════════════════════ */

test("VD-11 — Ampliar e restaurar as três regiões; Dados em duas colunas; nada persiste", async ({ page }) => {
  await login(page);
  const venda = await vendaPelaApi(page);
  const antes = await chavesDoNavegador(page);
  await abrirConsulta(page, venda);
  const ws = page.getByTestId(WORKSPACE);
  const regioes = { dados: "central-vendas-dados", itens: "central-vendas-itens", painel: "central-vendas-painel" } as const;
  for (const [regiao, testId] of Object.entries(regioes) as [keyof typeof regioes, string][]) {
    const botao = page.getByTestId(`central-vendas-ampliar-${regiao}`);
    await expect(botao).toHaveAccessibleName(/^Ampliar/);
    await botao.click();
    await expect(ws).toHaveAttribute("data-ampliado", regiao);
    await expect(page.getByTestId(testId), `${regiao} ampliado continua visível`).toBeVisible();
    for (const [outra, outroId] of Object.entries(regioes)) if (outra !== regiao) await expect(page.getByTestId(outroId), `ampliar ${regiao} esconde ${outra}`).toBeHidden();
    if (regiao === "dados") {
      const xs = await page.getByTestId("central-vendas-dados").locator("[data-campo]").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
      expect(xs.length, "Dados ampliado: campos em duas colunas").toBeGreaterThanOrEqual(2);
    }
    await expect(botao).toHaveAccessibleName("Restaurar layout");
    await botao.click();
    await expect(ws).not.toHaveAttribute("data-ampliado", /.+/);
    for (const id of Object.values(regioes)) await expect(page.getByTestId(id)).toBeVisible();
  }
  await page.getByTestId("central-vendas-ampliar-painel").click();
  expect(await chavesDoNavegador(page), "ampliar não deixa rastro no navegador").toEqual(antes);
  await page.reload();
  await expect(page.getByTestId("central-vendas-identidade-nome")).toHaveText(venda.code);
  await expect(page.getByTestId(WORKSPACE), "remontar volta ao normal").not.toHaveAttribute("data-ampliado", /.+/);
});

/* ═════════════════════════════════════════════ VD-12 esqueleto ═════════════════════════════════════════════ */

test("VD-12 — esqueleto com a leitura atrasada: cinco barras de 34 px com brilho; reduced-motion sem animação", async ({ page }) => {
  await login(page);
  const venda = await vendaPelaApi(page);
  for (const movimento of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion: movimento });
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => { soltar = ok; });
    await page.route(`**/api/sales/sales/${venda.id}`, async (rota) => { if (rota.request().method() === "GET") await segura; await rota.continue(); });
    await page.goto(`/vendas/sales/${venda.id}`);
    const esqueleto = page.getByTestId("central-vendas-esqueleto");
    await expect(esqueleto, "a leitura pendente monta a Central com o esqueleto").toBeVisible();
    const barras = await esqueleto.evaluate((raiz) => [...raiz.querySelectorAll<HTMLElement>("*")]
      .filter((el) => Math.round(el.getBoundingClientRect().height) === 34)
      .map((el) => ({ animacao: getComputedStyle(el).animationName, duracao: getComputedStyle(el).animationDuration })));
    expect(barras.length, "cinco barras de 34 px").toBe(MEDIDAS.esqueleto.quantas);
    if (movimento === "reduce") expect(barras.every((b) => b.animacao === "none" || parseFloat(b.duracao) === 0), "reduced-motion: sem animação").toBe(true);
    else expect(barras.some((b) => b.animacao !== "none" && parseFloat(b.duracao) > 0), "sem a preferência, há brilho — senão o caso acima seria vazio").toBe(true);
    soltar();
    await expect(page.getByTestId("central-vendas-identidade-nome")).toHaveText(venda.code);
    await expect(esqueleto).toHaveCount(0);
    await page.unroute(`**/api/sales/sales/${venda.id}`);
  }
});

/* ═════════════════════════════════════════════ VD-13 evidência ═════════════════════════════════════════════ */

/**
 * PARES DESENHO × PRODUTO por estado da seção 1 do pedido, em 1440×900 e 1280×800, gravados em EVIDENCIA_DIR (fora do
 * commit). As capturas do desenho NÃO moram no repositório: com DESENHO_SHOTS_DIR apontando para a pasta delas, cada
 * par ganha a do desenho ao lado (`<cena>__desenho.png`). Sem EVIDENCIA_DIR o caso é pulado, com anotação.
 * Estados da criação que dependem da grade de itens (lancar-produto, item-formulario, …) são da Fase B.
 */
test("VD-13 — evidência desenho × produto em 1440×900 e 1280×800, sem rolagem horizontal", async ({ page }) => {
  const pasta = process.env.EVIDENCIA_DIR;
  test.skip(!pasta, "EVIDENCIA_DIR não definido: a evidência visual só é gravada quando a pasta é informada");
  test.setTimeout(240_000);
  fs.mkdirSync(pasta!, { recursive: true });
  const desenhos = process.env.DESENHO_SHOTS_DIR;
  const par = (cena: string) => {
    if (!desenhos) return;
    for (const densidade of ["rotulo-a-frente", "compacto"]) {
      const origem = path.join(desenhos, `${cena}__${densidade}__1440x900.png`);
      if (fs.existsSync(origem)) fs.copyFileSync(origem, path.join(pasta!, `${cena}__${densidade}__desenho.png`));
    }
  };
  await login(page);
  const top = await cadastrarTop(page);
  const venda = await vendaPelaApi(page, { tipo_operacao_id: top.id, installment_plan: { installments: 2, first_due_date: "2026-10-15", mode: "interval", interval_days: 30 } });
  const confirmada = await vendaPelaApi(page, { tipo_operacao_id: top.id });
  await api(page, "POST", `/api/sales/sales/${confirmada.id}/confirm`, {});

  const foto = async (cena: string, w: number, h: number) => {
    const rolagem = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(rolagem, `${cena}: rolagem horizontal em ${w}×${h}`).toBeLessThanOrEqual(0);
    await page.mouse.move(5, h - 5); await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(pasta!, `${cena}__produto__${w}x${h}.png`) });
    if (w === 1440) par(cena);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]] as const) {
    await page.setViewportSize({ width: w, height: h });
    // criação
    await abrirCriacao(page, top.id);
    await foto("novo-documento", w, h);
    await abrirAbaDoLancamento(page, "Observações");
    await page.getByLabel("Observação").fill("rascunho da evidência");
    await page.getByTestId("central-vendas-descartar").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await foto("descartando", w, h);
    await page.getByTestId("confirm-dialog").getByRole("button", { name: "Continuar editando", exact: true }).click();
    // consulta
    await abrirConsulta(page, venda);
    await foto("view-documento", w, h);
    for (const [aba, cena] of [["Totais", "totais"], ["Financeiro", "financeiro"], ["Frete e transporte", "frete"]] as const) { await abrirAbaDoLancamento(page, aba); await foto(cena, w, h); }
    await abrirAbaDoLancamento(page, "Financeiro");
    await page.getByTestId("central-vendas-ampliar-painel").click();
    await foto("financeiro-ampliado", w, h);
    await page.getByTestId("central-vendas-ampliar-painel").click();
    await page.getByTestId("central-vendas-divisor-horizontal").focus(); await page.keyboard.press("Home");
    await foto("painel-estreito", w, h);
    await page.keyboard.press("End");
    await foto("painel-largo", w, h);
    await page.getByTestId("central-vendas-acoes").getByRole("button", { name: "Confirmar venda" }).click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await foto("confirmando", w, h);
    await page.keyboard.press("Escape");
    await (await acaoDaCentral(page, "central-vendas-documentos")).click();
    await expect(page.getByTestId("central-vendas-documentos-lista")).toBeVisible();
    await foto("multi-view", w, h);
    await page.keyboard.press("Escape");
    await abrirConsulta(page, confirmada);
    await foto("confirmado", w, h);
    // carregando
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => { soltar = ok; });
    await page.route(`**/api/sales/sales/${venda.id}`, async (rota) => { if (rota.request().method() === "GET") await segura; await rota.continue(); });
    await page.goto(`/vendas/sales/${venda.id}`);
    await expect(page.getByTestId("central-vendas-esqueleto")).toBeVisible();
    await foto("carregando", w, h);
    soltar();
    await page.unroute(`**/api/sales/sales/${venda.id}`);
  }
  test.info().annotations.push({ type: "evidencia", description: `pares gravados em ${pasta}${desenhos ? "" : " (sem DESENHO_SHOTS_DIR: só o produto)"}` });
});
