import { test, expect, type Page, type Locator } from "@playwright/test";
import { login, api, uniq, pickRef, empresaAtiva, primeiroId } from "./helpers";
/**
 * O `pickRef` do helpers monta a regex com o texto cru: um nome do seed como "[DEMO] Agropecuária" vira classe de
 * caracteres e nunca casa. A busca usa o nome sem o prefixo entre colchetes (os 12 primeiros caracteres do resto).
 */
const buscaSemColchetes = (nome: string) => nome.replace(/^\[[^\]]*\]\s*/, "").slice(0, 12);

/**
 * CENTRAL DE COMPRAS NO MOTOR DA CENTRAL (VISUAL-UX-04, docs/DECISIONS.md 276) — parte A: CC-1 a CC-5.
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────────────────────────┐
 * │ CC-1 as MESMAS medidas do central-vendas-desenho.spec.ts (VD-1), número a número, na compra —    │
 * │      na criação e na consulta; CC-2 a barra e o leque por modo e por permissão (sem Anexos, Esc  │
 * │      fecha); CC-3 Novo documento pelas TOPs do servidor; CC-4 Duplicar em memória (o que copia, o │
 * │      que NÃO copia, as travas); CC-5 Descartar (volta à abertura; no receber, ao pedido).         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VERDE QUE NÃO PROVA NADA É REPROVAÇÃO ───────────────────────────────────────────────────────┐
 * │ Toda fixture é criada pela API neste arquivo (TOP, produto, compra, pedido) e conferida no      │
 * │ servidor; toda escrita da TELA é contada (zero POST é um número); toda chave do navegador é     │
 * │ comparada antes × depois. Nada depende de contagem global nem do que outro spec deixou.         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

const WORKSPACE = "central-compras";

/** As MEDIDAS do VD-1 (central-vendas-desenho.spec.ts), copiadas número a número: a paridade é com a venda. */
const MEDIDAS = {
  barra: { altura: 44, raio: "12px", fundo: "rgb(255, 255, 255)", borda: "rgb(231, 234, 238)" },
  botaoRedondo: { lado: 25, fundo: "rgb(241, 243, 244)", icone: "rgb(71, 85, 105)", sombra: "rgba(34, 197, 94, 0.3) 0px 2px 6px 0px" },
  novo: { fundo: "rgb(64, 222, 99)" },
  pilula: { altura: 25, fonte: "12.5px", peso: "600" },
  posicaoDoRotulo: { altura: 25 },
  documento: { raio: "14px" },
  cabecalhoDeDados: 37,
  campo: {
    rotuloLargura: 128, rotuloFonte: "12px", rotuloPeso: "500", rotuloCor: "rgb(100, 116, 139)",
    caixaInicio: 137, caixaAltura: 28, caixaRaio: "8px",
    vazia: "rgb(241, 243, 244)", preenchida: "rgb(255, 255, 255)", preenchidaBorda: "rgb(231, 234, 238)",
    leitura: "rgb(246, 248, 250)", travada: "rgb(233, 237, 242)", valorFonte: "12.5px", larguraMaxima: 560, espaco: 6
  },
  compacto: { caixaAltura: 32 },
  itens: { barra: 37, cabecalho: 29, linha: 24, rodape: 33 },
  painel: { faixa: 39 }
} as const;

/* ═════════════════════════════════════════════ fixtures ═════════════════════════════════════════════ */

type Opcao = { id: string; label: string };
const codigoTop = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function cadastrarTop(page: Page, codigoBase: "compras.compra" | "compras.pedido" = "compras.compra", extra: Record<string, unknown> = {}) {
  const codigo = codigoTop(codigoBase === "compras.compra" ? "7" : "5");
  const nome = uniq(codigoBase === "compras.compra" ? "Compra Desenho" : "Pedido Desenho");
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase, nome, ...extra });
  return { id: criado.id, codigo, nome };
}

interface Base {
  empresa: string; fornecedor: { id: string; nome: string }; armazem: string;
  natureza: Opcao; centro: Opcao; grupo: string; unidade: string;
}

async function base(page: Page): Promise<Base> {
  const empresa = await empresaAtiva(page);
  const fornecedor = await primeiroId(page, "/api/resources/people?is_provider=true&pageSize=1");
  const nomeFornecedor = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${fornecedor}`))["name"]);
  const armazem = await primeiroId(page, `/api/resources/warehouses?empresa_id=${empresa}&pageSize=1`);
  const naturezas = await api<Opcao[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  const centros = await api<Opcao[]>(page, "GET", "/api/resources/cost_centers/options?kind=analytic");
  const grupos = await api<Opcao[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  const un = (await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options")).find((u) => u.label.toUpperCase() === "UN");
  expect(naturezas.length && centros.length && grupos.length && un, "premissa: natureza, centro, grupo e unidade UN no seed").toBeTruthy();
  return { empresa, fornecedor: { id: fornecedor, nome: nomeFornecedor }, armazem, natureza: naturezas[0]!, centro: centros[0]!, grupo: grupos[0]!.id, unidade: un!.id };
}

async function produtoNovo(page: Page, b: Base, controleLote: "nenhum" | "lote_validade" = "nenhum") {
  const p = await api<{ id: string }>(page, "POST", "/api/resources/products", {
    description: uniq("CC produto"), group_id: b.grupo, measurement_id: b.unidade, financial_category_id: b.natureza.id, controle_lote: controleLote
  });
  const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${p.id}`);
  expect(lido["controle_lote"], "premissa: o controle de lote foi gravado").toBe(controleLote);
  return { id: p.id, nome: String(lido["description"]) };
}

interface DocumentoCriado { id: string; codigo: string; situacao: string; fornecedorNome: string; detalhe: Record<string, unknown> }

/** Um documento de compra pela API oficial, lido de volta pela porta de detalhe. */
async function documentoPelaApi(page: Page, segmento: "compras" | "pedidos", corpo: Record<string, unknown>): Promise<DocumentoCriado> {
  const { id } = await api<{ id: string }>(page, "POST", `/api/compras/${segmento}`, corpo);
  const d = await api<Record<string, unknown>>(page, "GET", `/api/compras/${segmento}/${id}`);
  expect(d["codigo"] && d["fornecedor_nome"] && d["situacao"], "premissa: o documento tem código, fornecedor e situação").toBeTruthy();
  return { id, codigo: String(d["codigo"]), situacao: String(d["situacao"]), fornecedorNome: String(d["fornecedor_nome"]), detalhe: d };
}

async function compraPelaApi(page: Page, b: Base, topId: string, produtoId: string, extra: Record<string, unknown> = {}, itemExtra: Record<string, unknown> = {}) {
  return documentoPelaApi(page, "compras", {
    empresa_id: b.empresa, tipo_operacao_id: topId, fornecedor_id: b.fornecedor.id, data_documento: "2026-09-01",
    categoria_financeira_id: b.natureza.id, centro_custo_id: b.centro.id,
    itens: [{ produto_id: produtoId, armazem_id: b.armazem, quantidade: "2", valor_unitario: "10.00", ...itemExtra }], ...extra
  });
}

/** O grafo Pedido de compra → Compra ("em partes"), pela API administrativa, e um pedido aberto com um item. */
async function pedidoComProximoPasso(page: Page, b: Base) {
  const topCompra = await cadastrarTop(page);
  const topPedido = await cadastrarTop(page, "compras.pedido", { destinos: [{ tipoOperacaoId: topCompra.id, ordem: 0, emPartes: true }] });
  const declarado = await api<{ destinos: { tipoOperacaoId: string }[] }>(page, "GET", `/api/admin/tipos-operacao/${topPedido.id}`);
  expect(declarado.destinos.map((d) => d.tipoOperacaoId), "premissa: a aresta pedido → compra foi gravada").toEqual([topCompra.id]);
  const produto = await produtoNovo(page, b);
  const pedido = await documentoPelaApi(page, "pedidos", {
    empresa_id: b.empresa, tipo_operacao_id: topPedido.id, fornecedor_id: b.fornecedor.id, data_documento: "2026-09-01",
    categoria_financeira_id: b.natureza.id, centro_custo_id: b.centro.id,
    itens: [{ produto_id: produto.id, quantidade: "10", valor_unitario: "20.00" }]
  });
  const itens = pedido.detalhe["itens"] as { id: string }[];
  expect(itens.length, "premissa: o pedido tem o item").toBe(1);
  return { topCompra, topPedido, produto, pedido, itemId: itens[0]!.id };
}

/* ═════════════════════════════════════════════ tela ═════════════════════════════════════════════ */

async function abrirCriacao(page: Page, topId: string, segmento: "compras" | "pedidos" = "compras") {
  await page.goto(`/compras/${segmento}/new?tipo_operacao_id=${topId}`);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(page.getByTestId("compras-top-travada"), "a criação montou com a TOP").toBeVisible();
}

async function abrirConsulta(page: Page, doc: { id: string; codigo: string }, segmento: "compras" | "pedidos" = "compras") {
  await page.goto(`/compras/${segmento}/${doc.id}`);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(page.getByTestId(`${WORKSPACE}-identidade-nome`), "premissa: a tela desenhou ESTE documento").toHaveText(doc.codigo);
}

/** Abre uma aba do painel inferior da Central de Compras pelo nome. */
async function abrirAba(page: Page, nome: string | RegExp) {
  const aba = page.getByTestId(`${WORKSPACE}-painel`).getByRole("tab", { name: nome });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
}

const chavesDoNavegador = (page: Page) => page.evaluate(() => ({ local: Object.keys(localStorage).sort(), sessao: Object.keys(sessionStorage).sort() }));

/** Registra toda escrita (não-GET) contra a API a partir de agora. */
function registrarEscritas(page: Page) {
  const escritas: { metodo: string; caminho: string }[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/") || r.method() === "GET" || r.method() === "OPTIONS") return;
    escritas.push({ metodo: r.method(), caminho: u.pathname });
  });
  return escritas;
}

const caixa = async (l: Locator) => { const b = await l.boundingBox(); expect(b, "o elemento medido está na tela").not.toBeNull(); return b!; };
const estilo = (l: Locator, props: string[]) => l.evaluate((el, ps) => { const cs = getComputedStyle(el); return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)])); }, props);
const campoPeloRotulo = (escopo: Locator, rotulo: string) => escopo.locator("label", { hasText: rotulo }).first().locator("..");

/** A caixa pintada do campo (mesmo medidor do VD-1). */
async function medirCaixa(invólucro: Locator) {
  return invólucro.evaluate((raiz) => {
    const r0 = raiz.getBoundingClientRect();
    const transparente = (c: string) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
    const alvo = [...raiz.querySelectorAll<HTMLElement>("*")].find((el) => el.tagName !== "LABEL" && !el.closest("label") && !transparente(getComputedStyle(el).backgroundColor) && el.getBoundingClientRect().height >= 20);
    if (!alvo) return null;
    const r = alvo.getBoundingClientRect(); const cs = getComputedStyle(alvo);
    return { x: Math.round(r.left - r0.left), altura: Math.round(r.height), raio: cs.borderTopLeftRadius, fundo: cs.backgroundColor, borda: cs.borderTopColor };
  });
}

/** Leque de Ações rápidas: nomes dos itens na ordem do DOM. */
async function nomesDoLeque(page: Page) {
  const botao = page.getByTestId(`${WORKSPACE}-acoes-rapidas`);
  if ((await botao.getAttribute("aria-expanded")) !== "true") await botao.click();
  const leque = page.getByTestId(`${WORKSPACE}-acoes-rapidas-leque`);
  await expect(botao, "o leque abriu").toHaveAttribute("aria-expanded", "true");
  await expect(leque.getByRole("menuitem").first(), "os itens do leque estão na tela").toBeVisible();
  return leque.evaluate((raiz) => {
    const todos = [...raiz.querySelectorAll<HTMLElement>('button, [role="menuitem"]')];
    return todos.filter((el) => !todos.some((o) => o !== el && o.contains(el))).map((el) => el.getAttribute("aria-label") ?? (el.textContent ?? "").trim());
  });
}

const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const isoParaBr = (iso: string) => iso.split("-").reverse().join("/");
async function valorMostrado(invólucro: Locator) {
  const entrada = invólucro.locator("input:not([type=hidden]), textarea").first();
  if (await entrada.count()) return entrada.inputValue();
  return (await invólucro.innerText()).trim();
}

/* ═════════════════════════════════════════════ CC-1 medidas ═════════════════════════════════════════════ */

/* expect.soft nas MEDIDAS, como no VD-1: uma divergência não esconde as seguintes; o caso reprova do mesmo jeito. */
test("CC-1 — as MESMAS medidas do VD-1 na Central de Compras, na criação e na consulta", async ({ page }) => {
  await login(page);
  page.on("dialog", (d) => { void d.accept(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const b = await base(page);
  const top = await cadastrarTop(page);
  const produto = await produtoNovo(page, b);
  const compra = await compraPelaApi(page, b, top.id, produto.id);
  await abrirCriacao(page, top.id);
  const ws = page.getByTestId(WORKSPACE);
  await expect(ws, "a densidade padrão é rótulo à frente").toHaveAttribute("data-densidade", "rotulo-a-frente");

  // BARRA
  const barra = ws.getByTestId(`${WORKSPACE}-acoes`);
  expect.soft(Math.round((await caixa(barra)).height), "altura da barra").toBe(MEDIDAS.barra.altura);
  const cartao = await barra.evaluate((el) => {
    let n: HTMLElement | null = el as HTMLElement;
    for (let i = 0; n && i < 3; i++, n = n.parentElement) { const cs = getComputedStyle(n); if (cs.borderTopLeftRadius === "12px") return { raio: cs.borderTopLeftRadius, fundo: cs.backgroundColor, borda: cs.borderTopColor }; }
    return null;
  });
  expect.soft(cartao, "o cartão da barra tem raio 12").toEqual({ raio: MEDIDAS.barra.raio, fundo: MEDIDAS.barra.fundo, borda: MEDIDAS.barra.borda });

  // BOTÃO REDONDO (Descartar)
  const descartar = page.getByTestId(`${WORKSPACE}-descartar`);
  const bd = await caixa(descartar);
  expect.soft([Math.round(bd.width), Math.round(bd.height)], "botão redondo 25×25").toEqual([MEDIDAS.botaoRedondo.lado, MEDIDAS.botaoRedondo.lado]);
  const ed = await estilo(descartar, ["background-color", "box-shadow"]);
  expect.soft(ed["background-color"]).toBe(MEDIDAS.botaoRedondo.fundo);
  expect.soft(ed["box-shadow"]).toBe(MEDIDAS.botaoRedondo.sombra);
  expect.soft(await descartar.locator("svg").first().evaluate((s) => getComputedStyle(s).color), "ícone #475569").toBe(MEDIDAS.botaoRedondo.icone);

  // PÍLULA Confirmar compra
  const pilula = page.getByTestId(`${WORKSPACE}-confirmar`);
  expect.soft(Math.round((await caixa(pilula)).height)).toBe(MEDIDAS.pilula.altura);
  expect.soft(await estilo(pilula, ["font-size", "font-weight"])).toEqual({ "font-size": MEDIDAS.pilula.fonte, "font-weight": MEDIDAS.pilula.peso });

  // POSIÇÃO DO RÓTULO
  expect.soft(Math.round((await caixa(page.getByTestId(`${WORKSPACE}-posicao-rotulo`))).height)).toBe(MEDIDAS.posicaoDoRotulo.altura);

  // DOCUMENTO e cabeçalho de Dados principais
  const raioDoDocumento = await ws.getByTestId(`${WORKSPACE}-dados`).evaluate((el) => {
    for (let n: HTMLElement | null = el as HTMLElement; n && n.dataset["testid"] !== "central-compras"; n = n.parentElement) if (getComputedStyle(n).borderTopLeftRadius === "14px") return "14px";
    return null;
  });
  expect.soft(raioDoDocumento, "o documento é um cartão de raio 14").toBe(MEDIDAS.documento.raio);
  expect.soft(Math.round((await caixa(ws.getByTestId(`${WORKSPACE}-dados`).locator("div").first())).height), "cabeçalho de Dados principais").toBe(MEDIDAS.cabecalhoDeDados);

  // CAMPO COM RÓTULO À FRENTE: Fornecedor (o par do Cliente da venda)
  const dados = ws.getByRole("region", { name: "Dados principais" });
  const fornecedor = campoPeloRotulo(dados, "Fornecedor");
  const er = await fornecedor.locator("label").first().evaluate((el) => { const cs = getComputedStyle(el); const depois = getComputedStyle(el, "::after").content; return { largura: Math.round(el.getBoundingClientRect().width), fonte: cs.fontSize, peso: cs.fontWeight, cor: cs.color, alinhamento: cs.textAlign === "right" || cs.justifyContent === "flex-end" || cs.textAlign === "end", texto: (el.textContent ?? "").trim(), depois }; });
  expect.soft(er.largura, "rótulo: 128 de caixa").toBe(MEDIDAS.campo.rotuloLargura);
  expect.soft([er.fonte, er.peso, er.cor]).toEqual([MEDIDAS.campo.rotuloFonte, MEDIDAS.campo.rotuloPeso, MEDIDAS.campo.rotuloCor]);
  expect.soft(er.alinhamento, "rótulo alinhado à direita").toBe(true);
  expect.soft(er.texto.includes(":") || er.depois.includes(":"), "o rótulo à frente leva ':'").toBe(true);
  if (er.texto.includes(":") && er.texto.includes("*")) expect(er.texto.indexOf(":"), "':' antes do '*'").toBeLessThan(er.texto.indexOf("*"));
  const vazia = await medirCaixa(fornecedor);
  expect.soft(vazia, "a caixa do campo foi encontrada").not.toBeNull();
  expect.soft([vazia?.x, vazia?.altura, vazia?.raio], "caixa em 137, 28 de altura, raio 8").toEqual([MEDIDAS.campo.caixaInicio, MEDIDAS.campo.caixaAltura, MEDIDAS.campo.caixaRaio]);
  expect.soft(vazia?.fundo, "caixa vazia").toBe(MEDIDAS.campo.vazia);
  const icone = await fornecedor.evaluate((raiz) => { const r0 = raiz.getBoundingClientRect(); const s = [...raiz.querySelectorAll("svg")].map((x) => x.getBoundingClientRect()).find((q) => q.width > 0); return s ? Math.round(s.left - r0.left) : null; });
  expect.soft(icone, "há ícone na caixa").not.toBeNull();
  expect.soft(icone ?? -1, "o ícone fica à esquerda, dentro da caixa").toBeGreaterThanOrEqual(MEDIDAS.campo.caixaInicio);
  expect.soft(icone ?? 999, "o ícone fica à esquerda, dentro da caixa").toBeLessThan(MEDIDAS.campo.caixaInicio + 40);
  // espaço entre campos: o Fornecedor e o campo que vem logo depois dele na coluna
  // como no VD-1 (Cliente → Empresa): da caixa do Fornecedor à do campo logo abaixo, na mesma coluna
  const bForn = await caixa(fornecedor);
  const abaixo = await dados.locator("label").evaluateAll((labels, ref) => {
    const tops = labels.map((l) => l.parentElement!.getBoundingClientRect())
      .filter((r) => r.width > 0 && Math.abs(r.left - ref.x) < 2 && r.top > ref.y + ref.height - 1)
      .map((r) => r.top);
    return tops.length ? Math.min(...tops) : null;
  }, bForn);
  const espaco = abaixo === null ? null : Math.round(abaixo - (bForn.y + bForn.height));
  expect.soft(espaco, "espaço entre campos").toBe(MEDIDAS.campo.espaco);
  // preenchida
  await pickRef(page, "Fornecedor", buscaSemColchetes(b.fornecedor.nome));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const cheia = await medirCaixa(fornecedor);
  expect.soft([cheia?.fundo, cheia?.borda], "caixa preenchida").toEqual([MEDIDAS.campo.preenchida, MEDIDAS.campo.preenchidaBorda]);
  // travada: Tipo de Operação
  expect.soft((await medirCaixa(page.getByTestId("compras-top-travada")))?.fundo, "campo travado").toBe(MEDIDAS.campo.travada);

  // COMPACTO
  await page.getByRole("button", { name: "Rótulo dentro do campo" }).click();
  await expect(ws).toHaveAttribute("data-densidade", "compacto");
  expect.soft((await medirCaixa(fornecedor))?.altura, "compacto: 32 px").toBe(MEDIDAS.compacto.caixaAltura);
  const dentro = await fornecedor.evaluate((raiz) => { const l = raiz.querySelector("label")!.getBoundingClientRect(); const r = raiz.getBoundingClientRect(); return l.left >= r.left && l.right <= r.right && l.top >= r.top && l.bottom <= r.bottom; });
  expect.soft(dentro, "o rótulo mora dentro da caixa").toBe(true);

  // CONSULTA
  await abrirConsulta(page, compra);
  const consulta = page.getByTestId(WORKSPACE);
  const fornecedorLido = consulta.locator('[data-campo="Fornecedor"]');
  expect.soft((await medirCaixa(fornecedorLido))?.fundo, "só leitura").toBe(MEDIDAS.campo.leitura);
  const fonteDoValor = await fornecedorLido.getByText(compra.fornecedorNome).first().evaluate((el) => getComputedStyle(el).fontSize);
  expect.soft(fonteDoValor, "valor 12,5 px").toBe(MEDIDAS.campo.valorFonte);
  expect.soft((await medirCaixa(page.getByTestId("compras-consulta-top")))?.fundo, "Tipo de Operação travado na consulta").toBe(MEDIDAS.campo.travada);
  const bdup = await caixa(page.getByTestId(`${WORKSPACE}-duplicar`));
  expect.soft([Math.round(bdup.width), Math.round(bdup.height)]).toEqual([MEDIDAS.botaoRedondo.lado, MEDIDAS.botaoRedondo.lado]);
  expect.soft((await estilo(page.getByTestId(`${WORKSPACE}-novo`), ["background-color"]))["background-color"], "Novo verde").toBe(MEDIDAS.novo.fundo);
  const pilulaConsulta = page.getByTestId("compras-confirmar");
  expect.soft(Math.round((await caixa(pilulaConsulta)).height), "pílula Confirmar compra na consulta").toBe(MEDIDAS.pilula.altura);
  // ITENS
  const itens = consulta.getByTestId(`${WORKSPACE}-itens`);
  expect.soft(Math.round((await caixa(itens.getByRole("toolbar").first())).height), "barra de itens").toBe(MEDIDAS.itens.barra);
  expect.soft(Math.round((await caixa(page.getByTestId(`${WORKSPACE}-grade`).locator("thead tr").first())).height), "cabeçalho da grade").toBe(MEDIDAS.itens.cabecalho);
  expect.soft(Math.round((await caixa(page.getByTestId(`${WORKSPACE}-linha`).first())).height), "linha da grade").toBe(MEDIDAS.itens.linha);
  const rodape = await page.getByTestId(`${WORKSPACE}-subtotal`).evaluate((el) => { let n = el.parentElement; while (n && n.getBoundingClientRect().height < 25) n = n.parentElement; return n ? Math.round(n.getBoundingClientRect().height) : 0; });
  expect.soft(rodape, "rodapé dos itens").toBe(MEDIDAS.itens.rodape);
  // PAINEL
  const faixa = await page.getByTestId(`${WORKSPACE}-painel`).evaluate((el) => {
    const antes = getComputedStyle(el, "::before");
    if (antes.content !== "none" && antes.content !== "normal") return Math.round(parseFloat(antes.height));
    const lista = el.querySelector('[role="tablist"]');
    return lista ? Math.round(lista.getBoundingClientRect().height) : 0;
  });
  expect.soft(faixa, "faixa de abas (caixa com a borda)").toBe(MEDIDAS.painel.faixa);
  expect.soft(Math.round((await caixa(page.getByTestId(`${WORKSPACE}-painel`).getByRole("tablist"))).height), "abas: 38 de altura").toBe(MEDIDAS.painel.faixa - 1);
  // largura máxima 560
  await page.getByTestId(`${WORKSPACE}-ampliar-dados`).click();
  const larguras = await consulta.getByTestId(`${WORKSPACE}-dados`).locator("[data-campo]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect.soft(larguras.length, "premissa: há campos para medir").toBeGreaterThan(3);
  expect.soft(Math.max(...larguras), "largura máxima do campo").toBeLessThanOrEqual(MEDIDAS.campo.larguraMaxima);
});

/* ═════════════════════════════════════════════ CC-2 barra e leque ═════════════════════════════════════════════ */

test("CC-2 — barra e leque por modo e por permissão; sem Anexos; Esc fecha", async ({ page }) => {
  await login(page);
  const b = await base(page);
  const top = await cadastrarTop(page);
  const produto = await produtoNovo(page, b);
  const compra = await compraPelaApi(page, b, top.id, produto.id);
  const documentos = /^\d+ documentos? abertos?$/;

  // CRIAÇÃO: barra [Descartar] [Salvar] [Confirmar compra]; leque Alterar operação, Imprimir, Histórico, N documentos
  await abrirCriacao(page, top.id);
  await expect(page.getByTestId(`${WORKSPACE}-descartar`)).toBeVisible();
  await expect(page.getByTestId("compras-salvar")).toBeVisible();
  await expect(page.getByTestId(`${WORKSPACE}-confirmar`)).toHaveText(/Confirmar compra/);
  await expect(page.getByTestId(`${WORKSPACE}-posicao-rotulo`)).toBeVisible();
  const criacao = await nomesDoLeque(page);
  expect(criacao.slice(0, 3)).toEqual(["Alterar operação", "Imprimir", "Histórico de alterações"]);
  expect(criacao[3]).toMatch(documentos);
  expect(criacao, "exatamente quatro itens na criação").toHaveLength(4);
  await expect(page.getByTestId(`${WORKSPACE}-imprimir`)).toBeDisabled();
  await expect(page.getByTestId(`${WORKSPACE}-historico`)).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(`${WORKSPACE}-acoes-rapidas`), "Esc fecha").toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId(`${WORKSPACE}-acoes-rapidas-leque`), "e o leque sai da árvore").toHaveCount(0);
  await expect(page.getByTestId(`${WORKSPACE}-acoes-rapidas`), "e o foco volta ao botão").toBeFocused();

  // CONSULTA da compra aberta: [Novo] [Duplicar] [Confirmar compra]; leque Imprimir, Histórico, N documentos, Cancelar compra…
  await abrirConsulta(page, compra);
  await expect(page.getByTestId(`${WORKSPACE}-novo`)).toBeVisible();
  await expect(page.getByTestId(`${WORKSPACE}-duplicar`)).toBeVisible();
  await expect(page.getByTestId("compras-confirmar")).toBeEnabled();
  const consulta = await nomesDoLeque(page);
  expect(consulta).toEqual(["Imprimir", "Histórico de alterações", expect.stringMatching(documentos), "Cancelar compra…"]);
  const leque = page.getByTestId(`${WORKSPACE}-acoes-rapidas-leque`);
  await expect(leque.getByText(/anexo/i), "sem Anexos").toHaveCount(0);
  await expect(leque.getByRole("menuitem", { name: /anexo/i })).toHaveCount(0);
  const cor = await page.getByTestId("compras-cancelar").evaluate((el) => getComputedStyle(el).color);
  const [r, g, bl] = (cor.match(/\d+/g) ?? []).map(Number);
  expect(r! > g! && r! > bl!, `Cancelar em vermelho (${cor})`).toBe(true);
  await page.keyboard.press("Escape");
  await expect(leque).toHaveCount(0);

  // POR PERMISSÃO: sem audit_logs.view e sem compras.delete, o leque não oferece Histórico nem Cancelar
  await page.route("**/api/auth/context", async (rota) => {
    const resposta = await rota.fetch();
    const corpo = await resposta.json() as { permissions: string[] };
    await rota.fulfill({ response: resposta, json: { ...corpo, isOwner: false, permissions: corpo.permissions.filter((p) => p !== "audit_logs.view" && p !== "compras.delete") } });
  });
  await page.reload();
  await expect(page.getByTestId(`${WORKSPACE}-identidade-nome`)).toHaveText(compra.codigo);
  const semPermissao = await nomesDoLeque(page);
  expect(semPermissao[0], "premissa: o leque abriu").toBe("Imprimir");
  expect(semPermissao.some((n) => /Histórico/.test(n)), "sem audit_logs.view, sem Histórico").toBe(false);
  expect(semPermissao.some((n) => /^Cancelar/.test(n)), "sem compras.delete, sem Cancelar").toBe(false);
  await page.keyboard.press("Escape");
  await page.unroute("**/api/auth/context");

  // CANCELADA: a pílula Confirmar fica visível e DESABILITADA, e o leque não oferece Cancelar
  await api(page, "POST", `/api/compras/compras/${compra.id}/cancel`, {});
  await page.reload();
  await expect(page.getByTestId("compras-consulta-corpo"), "premissa: cancelada").toHaveAttribute("data-situacao", "cancelado");
  await expect(page.getByTestId("compras-confirmar"), "visível e desabilitada").toBeDisabled();
  const cancelada = await nomesDoLeque(page);
  expect(cancelada).toEqual(["Imprimir", "Histórico de alterações", expect.stringMatching(documentos)]);
  await page.keyboard.press("Escape");
});

/* ═════════════════════════════════════════════ CC-3 Novo documento ═════════════════════════════════════════════ */

test("CC-3 — Novo documento: as TOPs vêm do servidor, a padrão é marcada, e o clique abre o lançamento com a TOP", async ({ page }) => {
  await login(page);
  const b = await base(page);
  const topDoDoc = await cadastrarTop(page);
  const produto = await produtoNovo(page, b);
  const compra = await compraPelaApi(page, b, topDoDoc.id, produto.id);
  const a = await cadastrarTop(page);
  const c = await cadastrarTop(page);

  // (1) CONTRA O SERVIDOR REAL
  const real = await api<{ items: { id: string; code: string; isDefault: boolean }[] }>(page, "GET", "/api/compras/compras/operation-types");
  const esperadas = real.items.length <= 8 ? real.items : real.items.filter((x) => x.isDefault);
  const perguntas: string[] = [];
  page.on("request", (r) => { if (r.method() === "GET" && new URL(r.url()).pathname === "/api/compras/compras/operation-types") perguntas.push(r.url()); });
  await abrirConsulta(page, compra);
  await page.getByTestId(`${WORKSPACE}-novo`).click();
  const menu = page.getByTestId(`${WORKSPACE}-novo-menu`);
  await expect(menu, "o menu diz a espécie").toContainText("Nova operação · Compra");
  await expect.poll(() => perguntas.length, { message: "a lista é a do servidor (GET operation-types)" }).toBeGreaterThan(0);
  for (const t of esperadas) await expect(menu.getByRole("menuitem").filter({ hasText: t.code }).first(), `a TOP ${t.code} do servidor está no menu`).toBeVisible();
  if (real.items.length > 8) await expect(menu.getByRole("menuitem", { name: /Escolher operação/ }), "acima do corte, o pé leva à janela").toBeVisible();
  await page.keyboard.press("Escape");

  // (2) RESPOSTA CONTROLADA com duas TOPs REAIS
  const corpo = { contractVersion: 1, family: { code: "compras.compra", label: "Compra" }, defaultId: a.id, items: [
    { id: a.id, code: a.codigo, name: a.nome, version: 1, isDefault: true },
    { id: c.id, code: c.codigo, name: c.nome, version: 1, isDefault: false }
  ] };
  await page.route("**/api/compras/compras/operation-types", (rota) => rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corpo) }));
  await page.reload();
  await expect(page.getByTestId(`${WORKSPACE}-identidade-nome`)).toHaveText(compra.codigo);
  await page.getByTestId(`${WORKSPACE}-novo`).click();
  await expect(menu).toBeVisible();
  const itemA = menu.getByRole("menuitem").filter({ hasText: a.codigo });
  const itemC = menu.getByRole("menuitem").filter({ hasText: c.codigo });
  await expect(itemA).toContainText(a.nome);
  await expect(itemA, "a padrão leva o selo").toContainText("Padrão");
  await expect(itemC).not.toContainText("Padrão");
  await expect(menu.getByRole("menuitem", { name: /Escolher operação/ }), "abaixo do corte, sem o pé").toHaveCount(0);
  await itemC.click();
  await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?tipo_operacao_id=${c.id}$`));
  await expect(page.getByTestId("compras-top-travada"), "a rota de destino reconferiu a TOP escolhida").toContainText(c.codigo);
});

/* ═════════════════════════════════════════════ CC-4 Duplicar ═════════════════════════════════════════════ */

const CHAVES_DO_POST_DA_COMPRA = [
  "empresa_id", "fornecedor_id", "tipo_operacao_id", "transportadora_id", "data_documento", "data_entrada", "data_vencimento", "numero_nota", "serie_nota",
  "categoria_financeira_id", "centro_custo_id", "condicao_pagamento_id", "plano_parcelas", "forma_pagamento_id", "frete", "outras_despesas", "desconto",
  "observacao", "itens"
];
const CHAVES_DO_ITEM_DA_COMPRA = ["produto_id", "armazem_id", "quantidade", "valor_unitario", "desconto", "desconto_percentual", "lote", "validade"];

test("CC-4 — Duplicar: copia o que deve, NÃO copia nota, série, datas nem origem; ponto aceso; nada na URL nem no navegador; POST com as chaves de sempre", async ({ page }) => {
  await login(page);
  const b = await base(page);
  const top = await cadastrarTop(page);
  const produto = await produtoNovo(page, b);
  const notaOriginal = `NF-ORIG-${Date.now().toString(36)}`;
  const original = await compraPelaApi(page, b, top.id, produto.id, {
    data_documento: "2026-08-03", data_entrada: "2026-08-04", data_vencimento: "2026-08-20", numero_nota: notaOriginal, serie_nota: "9",
    frete: "12.00", outras_despesas: "3.00", desconto: "1.50", observacao: "observação do original"
  }, { desconto: "0.50" });
  expect(original.detalhe["tipo_operacao_id"], "premissa: o detalhe traz tipo_operacao_id (select d.*)").toBe(top.id);
  expect(original.detalhe["numero_nota"], "premissa: o original tem nota").toBe(notaOriginal);
  const antes = await chavesDoNavegador(page);
  await abrirConsulta(page, original);
  const escritas = registrarEscritas(page);
  const duplicar = page.getByTestId(`${WORKSPACE}-duplicar`);
  await expect(duplicar).toBeEnabled();
  await duplicar.click();

  // abre o lançamento da MESMA TOP, e a URL não leva dado nenhum além dela
  await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?tipo_operacao_id=${top.id}$`));
  expect([...new URL(page.url()).searchParams.keys()], "a URL leva só a TOP").toEqual(["tipo_operacao_id"]);
  await expect(page.getByTestId(WORKSPACE)).toBeVisible();
  await expect(page.getByTestId("compras-top-travada")).toContainText(top.codigo);
  await expect(page.getByTestId(`${WORKSPACE}-alterado`), "os valores trazidos contam como alteração").toBeVisible();

  // os valores vieram
  const dados = page.getByTestId(WORKSPACE).getByRole("region", { name: "Dados principais" });
  await expect(campoPeloRotulo(dados, "Fornecedor")).toContainText(original.fornecedorNome);
  await expect(page.getByTestId(`${WORKSPACE}-linha`), "os itens vieram").toHaveCount(1);
  await abrirAba(page, "Observações");
  await expect(page.getByTestId("compras-observacao")).toHaveValue("observação do original");
  // as datas NÃO vieram: Data = hoje
  expect(await valorMostrado(campoPeloRotulo(dados, "Data")), "Data = hoje").toMatch(new RegExp(`${hojeIso()}|${isoParaBr(hojeIso())}`));
  expect(await chavesDoNavegador(page), "nenhuma chave nova no navegador: a cópia foi em memória").toEqual(antes);
  expect(escritas, "duplicar não escreveu nada").toEqual([]);
  // o aviso da cópia (2.6) — por último entre as asserções de tela: o toast pode já ter saído, mas a decisão o exige
  await expect(page.getByText("Cópia aberta como rascunho"), "o aviso da cópia").toBeVisible();

  // salvar a cópia é o POST de sempre, com as MESMAS chaves
  let corpo: Record<string, unknown> | null = null;
  await page.route("**/api/compras/compras", async (rota) => {
    if (rota.request().method() !== "POST") return rota.fallback();
    corpo = rota.request().postDataJSON() as Record<string, unknown>;
    await rota.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000000" }) });
  });
  await page.getByTestId("compras-salvar").click();
  await expect.poll(() => corpo, { message: "o POST da cópia saiu" }).not.toBeNull();
  const enviado = corpo as unknown as Record<string, unknown>;
  for (const k of Object.keys(enviado)) expect(CHAVES_DO_POST_DA_COMPRA, `chave ${k} é das de sempre`).toContain(k);
  expect(enviado["tipo_operacao_id"]).toBe(top.id);
  expect(enviado["empresa_id"]).toBe(b.empresa);
  expect(enviado["fornecedor_id"]).toBe(b.fornecedor.id);
  expect(enviado["categoria_financeira_id"]).toBe(b.natureza.id);
  expect(enviado["centro_custo_id"]).toBe(b.centro.id);
  expect(enviado["observacao"]).toBe("observação do original");
  expect([enviado["frete"], enviado["outras_despesas"], enviado["desconto"]].map(Number), "frete, outras despesas e desconto vieram").toEqual([12, 3, 1.5]);
  expect(enviado["data_documento"], "Data = hoje").toBe(hojeIso());
  expect(enviado["numero_nota"], "NÃO copia a nota").toBeUndefined();
  expect(enviado["serie_nota"], "NÃO copia a série").toBeUndefined();
  expect(enviado["data_entrada"], "NÃO copia a data de entrada").not.toBe("2026-08-04");
  expect(enviado["data_vencimento"], "NÃO copia o vencimento").not.toBe("2026-08-20");
  const item = (enviado["itens"] as Record<string, unknown>[])[0]!;
  for (const k of Object.keys(item)) expect(CHAVES_DO_ITEM_DA_COMPRA, `chave do item ${k} é das de sempre`).toContain(k);
  expect([item["produto_id"], item["armazem_id"]]).toEqual([produto.id, b.armazem]);
  expect([item["quantidade"], item["valor_unitario"], item["desconto"]].map(Number)).toEqual([2, 10, 0.5]);
});

test("CC-4b — Duplicar: lote e validade NÃO vêm; compra com origem e documento sem TOP ficam desabilitados com o motivo; TOP inativa avisa e nada abre", async ({ page }) => {
  await login(page);
  const b = await base(page);

  // LOTE E VALIDADE não vêm na cópia
  const topLote = await cadastrarTop(page);
  const comLote = await produtoNovo(page, b, "lote_validade");
  const loteOriginal = `LOTE-${Date.now().toString(36).toUpperCase()}`;
  const original = await compraPelaApi(page, b, topLote.id, comLote.id, {}, { lote: loteOriginal, validade: "2027-03-15" });
  const itemLido = (original.detalhe["itens"] as Record<string, unknown>[])[0]!;
  expect(itemLido["lote"], "premissa: o original tem lote").toBe(loteOriginal);
  await abrirConsulta(page, original);
  await page.getByTestId(`${WORKSPACE}-duplicar`).click();
  await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?tipo_operacao_id=${topLote.id}$`));
  const linha = page.getByTestId(`${WORKSPACE}-linha`);
  await expect(linha, "o item veio").toHaveCount(1);
  const textoDaLinha = await linha.evaluate((el) => [el.textContent ?? "", ...[...el.querySelectorAll("input")].map((i) => i.value)].join(" | "));
  expect(textoDaLinha, "o lote do original não veio").not.toContain(loteOriginal);
  expect(textoDaLinha, "a validade do original não veio").not.toMatch(/2027-03-15|15\/03\/2027/);

  // COM ORIGEM: compra recebida de pedido
  page.on("dialog", (d) => { void d.accept(); });
  const p = await pedidoComProximoPasso(page, b);
  const recebida = await api<{ id: string }>(page, "POST", `/api/compras/pedidos/${p.pedido.id}/convert`, {
    tipo_operacao_id: p.topCompra.id, data_documento: "2026-09-02", categoria_financeira_id: b.natureza.id, centro_custo_id: b.centro.id,
    itens: [{ item_origem_id: p.itemId, armazem_id: b.armazem, quantidade: "4", valor_unitario: "20.00" }]
  });
  const lidaRecebida = await api<{ codigo: string; origem_documento_id: string | null }>(page, "GET", `/api/compras/compras/${recebida.id}`);
  expect(lidaRecebida.origem_documento_id, "premissa: a compra tem origem").toBe(p.pedido.id);
  await abrirConsulta(page, { id: recebida.id, codigo: lidaRecebida.codigo });
  const duplicar = page.getByTestId(`${WORKSPACE}-duplicar`);
  await expect(duplicar, "compra com origem não duplica").toBeDisabled();
  expect((await duplicar.getAttribute("data-dica")) ?? "", "a dica diz o motivo").toMatch(/pedido/i);

  // SEM TOP: o servidor não cria documento de compra sem TOP (tipo_operacao_id é obrigatório); o registro legado sem TOP é
  // simulado na LEITURA do detalhe — só a apresentação do botão está sob prova.
  const topSem = await cadastrarTop(page);
  const semTop = await compraPelaApi(page, b, topSem.id, comLote.id, {}, { lote: "L-SEM-TOP", validade: "2027-01-01" });
  await page.route(`**/api/compras/compras/${semTop.id}`, async (rota) => {
    if (rota.request().method() !== "GET") return rota.fallback();
    const resposta = await rota.fetch();
    const corpo = await resposta.json() as Record<string, unknown>;
    await rota.fulfill({ response: resposta, json: { ...corpo, tipo_operacao_id: null, tipo_operacao: null } });
  });
  await abrirConsulta(page, semTop);
  await expect(page.getByTestId(`${WORKSPACE}-duplicar`), "sem TOP não duplica").toBeDisabled();
  expect((await page.getByTestId(`${WORKSPACE}-duplicar`).getAttribute("data-dica")) ?? "", "a dica diz o motivo").toMatch(/Tipo de Operação/);
  await page.unroute(`**/api/compras/compras/${semTop.id}`);

  // TOP QUE FICOU INATIVA: a mensagem de hoje do lançamento, e nada abre
  const topInativa = await cadastrarTop(page);
  const produto = await produtoNovo(page, b);
  const compra = await compraPelaApi(page, b, topInativa.id, produto.id, { observacao: "não pode reaparecer" });
  const atual = await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${topInativa.id}`);
  await api(page, "PUT", `/api/admin/tipos-operacao/${topInativa.id}`, { ativo: false, revisao: atual.revisao });
  const outra = await cadastrarTop(page);
  await abrirConsulta(page, compra);
  const escritas = registrarEscritas(page);
  await page.getByTestId(`${WORKSPACE}-duplicar`).click();
  await expect(page.getByTestId("top-indisponivel"), "a mensagem de hoje").toBeVisible();
  await expect(page.getByTestId(WORKSPACE), "nada aberto com a TOP inativa").toHaveCount(0);
  // a cópia não reaparece: um lançamento com outra TOP nasce limpo
  await abrirCriacao(page, outra.id);
  await expect(page.getByTestId(`${WORKSPACE}-alterado`), "lançamento limpo").toHaveCount(0);
  await abrirAba(page, "Observações");
  await expect(page.getByTestId("compras-observacao")).toHaveValue("");
  expect(escritas).toEqual([]);
});

/**
 * CC-4c — RASCUNHO DA ESPÉCIE. Como no VD-5c: o shell só mantém montada a tela ATIVA e `useDirtyTab` limpa o ponto ao
 * desmontar — com a consulta na tela, a aba de lançamento não fica suja, e a pergunta "Substituir o rascunho?" não é
 * alcançável pela interface. O que É alcançável fica provado: com a aba de lançamento da espécie aberta e limpa,
 * Duplicar não pergunta, reaproveita a MESMA aba e traz a cópia na TOP do original.
 */
test("CC-4c — Duplicar com a aba de lançamento da espécie já aberta (limpa): não pergunta, reaproveita a aba e traz a cópia", async ({ page }) => {
  await login(page);
  const b = await base(page);
  const top = await cadastrarTop(page);
  const outra = await cadastrarTop(page);
  const produto = await produtoNovo(page, b);
  const compra = await compraPelaApi(page, b, top.id, produto.id, { observacao: "observação que a cópia leva" });
  await abrirCriacao(page, outra.id);
  const abaNova = page.locator('[data-testid="workspace-tab"][data-tab-key="/compras/compras/new"]');
  await expect(abaNova, "premissa: a aba de lançamento da espécie está aberta").toHaveCount(1);
  await abrirConsulta(page, compra);
  await expect(abaNova, "premissa: ela continua aberta").toHaveCount(1);
  await expect(abaNova, "e limpa").not.toHaveAttribute("data-dirty", "true");
  const escritas = registrarEscritas(page);

  await page.getByTestId(`${WORKSPACE}-duplicar`).click();
  await expect(page).toHaveURL(new RegExp(`/compras/compras/new\\?tipo_operacao_id=${top.id}$`));
  await expect(page.getByTestId("confirm-dialog"), "aba limpa: nada a perguntar").toHaveCount(0);
  await expect(abaNova, "a MESMA aba de lançamento, não uma segunda").toHaveCount(1);
  await expect(page.getByTestId("compras-top-travada"), "com a TOP do original").toContainText(top.codigo);
  await expect(page.getByTestId(`${WORKSPACE}-alterado`), "a cópia conta como alteração").toBeVisible();
  await abrirAba(page, "Observações");
  await expect(page.getByTestId("compras-observacao")).toHaveValue("observação que a cópia leva");
  expect(escritas).toEqual([]);
});

/* ═════════════════════════════════════════════ CC-5 Descartar ═════════════════════════════════════════════ */

test("CC-5 — Descartar: pergunta, Continuar editando mantém, confirmar volta à ABERTURA (mesma TOP, padrões) sem escrita", async ({ page }) => {
  await login(page);
  const b = await base(page);
  const top = await cadastrarTop(page);
  await abrirCriacao(page, top.id);
  const ws = page.getByTestId(WORKSPACE);
  const dados = ws.getByRole("region", { name: "Dados principais" });
  const retrato = async () => ({ dados: (await dados.innerText()).replace(/\s+/g, " ").trim(), data: await valorMostrado(campoPeloRotulo(dados, "Data")) });
  const abertura = await retrato();
  expect(abertura.data, "premissa: a abertura aplica os padrões (Data = hoje)").toMatch(new RegExp(`${hojeIso()}|${isoParaBr(hojeIso())}`));
  const descartar = page.getByTestId(`${WORKSPACE}-descartar`);
  await expect(descartar, "sem alteração, nada a descartar").toBeDisabled();
  const escritas = registrarEscritas(page);

  await pickRef(page, "Fornecedor", buscaSemColchetes(b.fornecedor.nome));
  await abrirAba(page, "Observações");
  await page.getByTestId("compras-observacao").fill("vai ser descartado");
  await expect(page.getByTestId(`${WORKSPACE}-alterado`)).toBeVisible();

  await descartar.click();
  const dlg = page.getByTestId("confirm-dialog");
  await expect(dlg.getByRole("heading", { name: "Descartar as alterações?" })).toBeVisible();
  await expect(dlg).toContainText("O documento volta como estava antes desta edição.");
  await dlg.getByRole("button", { name: "Continuar editando", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("compras-observacao"), "continuar editando mantém tudo").toHaveValue("vai ser descartado");

  await descartar.click();
  await dlg.getByRole("button", { name: "Descartar alterações", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId(`${WORKSPACE}-alterado`), "voltou à abertura: nada alterado").toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`tipo_operacao_id=${top.id}$`));
  await expect(page.getByTestId("compras-top-travada"), "a MESMA TOP").toContainText(top.codigo);
  await expect.poll(retrato, { message: "Dados principais como na abertura (padrões reaplicados)" }).toEqual(abertura);
  await abrirAba(page, "Observações");
  await expect(page.getByTestId("compras-observacao")).toHaveValue("");
  expect(escritas, "descartar não escreve").toEqual([]);
});

test("CC-5b — Descartar no modo receber: pergunta e volta ao pedido, sem escrita", async ({ page }) => {
  await login(page);
  const b = await base(page);
  const p = await pedidoComProximoPasso(page, b);
  await abrirConsulta(page, p.pedido, "pedidos");
  await expect(page.getByTestId("compras-proximos-passos")).toHaveAttribute("data-situacao", "pronto");
  await page.getByTestId(`compras-proximo-passo-${p.topCompra.codigo}`).click();
  await expect(page.getByTestId("compras-central"), "a Central em modo receber").toHaveAttribute("data-modo", "receber");
  await expect(page.getByTestId("compras-central-receber")).toHaveAttribute("data-situacao", "pronto");
  const escritas = registrarEscritas(page);

  const descartar = page.getByTestId(`${WORKSPACE}-descartar`);
  await expect(descartar, "no receber, Descartar volta ao pedido").toBeEnabled();
  await descartar.click();
  const dlg = page.getByTestId("confirm-dialog");
  await expect(dlg.getByRole("heading", { name: "Descartar as alterações?" })).toBeVisible();
  await dlg.getByRole("button", { name: "Descartar alterações", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/compras/pedidos/${p.pedido.id}$`));
  await expect(page.getByTestId(`${WORKSPACE}-identidade-nome`), "o pedido carregado").toHaveText(p.pedido.codigo);
  expect(escritas, "descartar não escreve").toEqual([]);
  const lido = await api<{ situacao: string; compras_geradas?: unknown[] }>(page, "GET", `/api/compras/pedidos/${p.pedido.id}`);
  expect(lido.situacao, "o pedido continua aberto").toBe("aberto");
  expect(lido.compras_geradas ?? [], "nenhuma compra gerada").toEqual([]);
});
