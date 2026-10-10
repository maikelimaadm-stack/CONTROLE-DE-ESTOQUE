import type { Locator, Page } from "@playwright/test";
import { familiaOperacionalDeDocumentoEstoque } from "@agro/domain";
import { login, api, uniq, pickRef, empresaAtiva, primeiroId, abrirAbaDoLancamento } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import { hojeISO } from "./estoque-01-comum";

/**
 * ALINHAMENTO-01 — OS CAMPOS DAS CENTRAIS (docs/DECISIONS.md 310) — desktop 1440×900, Vendas, Compras e Estoque.
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────────────────────────────────────────┐
 * │ O campo do motor (`features/central/campo.tsx` + `campo.module.css`) é o MESMO nas três Centrais. Aqui se MEDE o │
 * │ alinhamento que a decisão 310 conserta — nada é olhado, tudo é número:                                          │
 * │ ALN-1a D3   consulta de COMPRAS: o x do texto de TODOS os valores de Dados principais (travado, pesquisa e data │
 * │             alternados na mesma coluna) é o mesmo — tolerância 1 px                                              │
 * │ ALN-1b D3   o mesmo na consulta de VENDA                                                                         │
 * │ ALN-2a D1   multilinha SÓ-LEITURA (Observações da consulta de ESTOQUE e de COMPRAS): o topo do texto do valor no │
 * │             topo do texto do rótulo — tolerância 2 px                                                            │
 * │ ALN-2b D1   texto LONGO (Observações da consulta de venda): quebra em mais de uma linha e não é cortado         │
 * │             (scrollWidth <= clientWidth no valor e no filho)                                                     │
 * │ ALN-3a D2   criação multilinha (Observação da venda, rótulo à frente): o centro da 1ª linha da textarea no      │
 * │             centro do texto do rótulo — tolerância 1 px                                                          │
 * │ ALN-3b D2   o mesmo campo no COMPACTO: a 1ª linha começa abaixo do texto do rótulo flutuante e o padding-top     │
 * │             continua 13 px (prova de que o compacto não mudou)                                                   │
 * │ ALN-4a D4+5 campo simples só-leitura (Dados principais da consulta de compras): o centro do texto do rótulo no    │
 * │             centro do texto do valor; a linha-base dos dois é REGISTRADA (o número do D5)                        │
 * │ ALN-5a D6   compacto preenchido (criação da venda): o y do texto do RefSelect = o y do texto do input da coluna  │
 * │             — tolerância 0,25 px: o D6 é de MEIO pixel, e 1 px não o veria (medido no ANTES)                     │
 * │ ALN-6a D8   a mensagem de erro começa no x do texto do controle, nas DUAS densidades (criação da saída de       │
 * │             estoque: Local de estoque, com ícone, e Justificativa, sem ícone) — tolerância 1 px                  │
 * │ ALN-7a      NÃO-REGRESSÃO nas três Centrais: rótulo 128, caixa em 137, 28 de altura, raio 8px; compacto 32       │
 * │ ALN-7b      NÃO-REGRESSÃO nas três Centrais: todo ícone dos Dados principais na faixa [137, 177)                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ COMO SE MEDE ─────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ Tudo relativo à borda externa da LINHA do campo (o pai do rótulo e da caixa; a do `.campo` é a mesma).            │
 * │ · texto de rótulo, valor e botão do RefSelect: Range sobre o NÓ DE TEXTO (`getClientRects`, uma caixa por linha │
 * │   quebrada); linha-base = topo do Range + `fontBoundingBoxAscent` do canvas com a fonte calculada do elemento;   │
 * │ · texto de input/textarea (não tem nó de texto): a CAIXA DE CONTEÚDO do controle — rect + borda + padding do     │
 * │   getComputedStyle; o input centra a linha nela; a 1ª linha da textarea = topo do conteúdo + line-height/2;     │
 * │   e, para comparar com um Range, + o DELTA DO GLIFO: numa SONDA fora da tela com a mesma fonte e line-height,   │
 * │   centro do Range − centro da linha (o glifo de 16 px numa linha de 15 fica 0,5 px acima — sem o delta, a     │
 * │   comparação misturaria glifo com caixa de linha e erraria meio pixel);                                         │
 * │ · mensagem de erro: rect + padding-left do `[data-parte="erro"]` (onde o ícone da mensagem começa).              │
 * │ Mede-se no REPOUSO: fontes carregadas e nenhuma transição finita correndo dentro da Central (a troca de        │
 * │ densidade anima rótulo, caixa e controle por 220 ms) — `expect.poll`, nunca espera fixa.                         │
 * │ Cada caso imprime `ALN-MEDIDA <caso> …` com os números: são o ANTES × DEPOIS da decisão 310.                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VERDE QUE NÃO PROVA NADA É REPROVAÇÃO ───────────────────────────────────────────────────────────────────────┐
 * │ Toda asserção tem a premissa ao lado: a lista medida não é vazia, a coluna TEM travado e TEM ícone, o texto     │
 * │ longo NÃO caberia numa linha, a mensagem de erro existe, o campo é multilinha. Os documentos nascem pela API no │
 * │ próprio caso; os cadastros e as TOPs criados por `criarCadastro`/`criarTop` saem no fim (central-compras-       │
 * │ fixtures.ts); os documentos ficam (ledger).                                                                      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * REVERSAS (do executor; duas observações cada; NUNCA commitadas): R1 `--recuo: 10px` no campo sem ícone → ALN-1a
 * vermelho · R2 `align-items: center` no multilinha só-leitura → ALN-2a · R3 `white-space: nowrap` no valor → ALN-2b ·
 * R4 as duas regras de padding-top do compacto (13 no controle × 12 no botão da pesquisa) → ALN-5a · R5 início da caixa
 * 137 → 140 → ALN-7a.
 */

/** A geometria que NÃO muda (a mesma de central-vendas-desenho.spec.ts MEDIDAS.campo e de central-compras-desenho-a). */
const GEOMETRIA = { rotuloLargura: 128, caixaInicio: 137, caixaAltura: 28, caixaRaio: "8px", compactoAltura: 32, iconeDe: 137, iconeAte: 177 } as const;

test.use({ viewport: { width: 1440, height: 900 } });

/* ═════════════════════════════════════════════ o medidor ═════════════════════════════════════════════ */

interface TextoMedido {
  esq: number; topo: number; base: number; centro: number; altura: number;
  /** topo do Range + fontBoundingBoxAscent (canvas, fonte calculada do elemento) */
  linhaBase: number | null;
  /** quantas linhas o nó de texto ocupa (tops distintos das caixas do Range) */
  linhas: number;
  /** largura do texto inteiro numa linha só (canvas): a premissa do "texto longo" */
  larguraNatural: number | null;
  conteudo: string; fonte: string;
}
interface ControleMedido {
  tipo: string; conteudoX: number; conteudoTopo: number; conteudoAltura: number; alturaDeLinha: number | null; paddingTop: string;
  /** só o botão do RefSelect tem nó de texto */
  texto: TextoMedido | null;
  /**
   * Onde o centro do GLIFO fica em relação ao centro da caixa de linha, com a fonte e o line-height do controle: o Range
   * dá a caixa do glifo (ascent + descent arredondados), e quando ela é maior que a linha o Chrome a reparte desigual
   * (DM Sans 12,5 px em 15 px: 16 de glifo, −1/0 ⇒ o centro do glifo fica 0,5 px acima do da linha). Input e textarea
   * não têm nó de texto: o centro do texto deles = centro da linha (pela caixa de conteúdo) + este delta, medido numa
   * SONDA com a mesma fonte e o mesmo line-height — a mesma régua do Range do RefSelect e do rótulo.
   */
  deltaDoGlifo: number | null;
}
interface CampoMedido {
  rotulo: string; estado: string | null; icone: string | null; preenchido: boolean; multilinha: boolean; alturaDaLinha: number;
  rotuloLargura: number; rotuloTexto: TextoMedido | null;
  caixa: { x: number; y: number; altura: number; largura: number; raio: string } | null;
  valor: { texto: TextoMedido | null; scroll: number; client: number; filho: { scroll: number; client: number } | null } | null;
  controle: ControleMedido | null;
  erro: { conteudoX: number } | null;
  icones: number[];
}

/**
 * Mede UMA linha de campo (o elemento que tem o rótulo e a caixa). Autocontida de propósito: o Playwright a serializa
 * para o navegador, e ela não pode usar nada de fora.
 */
function medirLinha(linha: Element): CampoMedido {
  const L = linha.getBoundingClientRect();
  const ctx = document.createElement("canvas").getContext("2d");
  const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const textoDe = (raiz: Element | null): TextoMedido | null => {
    if (!raiz) return null;
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.textContent ?? "").trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const no = w.nextNode();
    const pai = no?.parentElement;
    if (!no || !pai) return null;
    const r = document.createRange();
    r.selectNodeContents(no);
    const caixas = [...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0);
    const p = caixas[0];
    if (!p) return null;
    const cs = getComputedStyle(pai);
    const conteudo = no.textContent ?? "";
    let ascent: number | null = null;
    let larguraNatural: number | null = null;
    if (ctx) {
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText(conteudo);
      ascent = m.fontBoundingBoxAscent;
      larguraNatural = m.width;
    }
    const topo = p.top - L.top;
    return {
      esq: p.left - L.left, topo, base: p.bottom - L.top, centro: topo + p.height / 2, altura: p.height,
      linhaBase: ascent === null ? null : topo + ascent, linhas: new Set(caixas.map((q) => Math.round(q.top))).size,
      larguraNatural, conteudo, fonte: cs.fontSize
    };
  };
  const rotulo = linha.querySelector('[data-parte="rotulo"]');
  const caixa = linha.querySelector('[data-parte="caixa"]');
  const valor = linha.querySelector('[data-parte="valor"]');
  const controle = caixa?.querySelector<HTMLElement>('textarea, input:not([type="hidden"]), button[role="combobox"], select') ?? null;
  const erro = linha.parentElement?.querySelector('[data-parte="erro"]') ?? null;
  /* a sonda: um bloco fora da tela com a fonte e o line-height dados; delta = centro do Range do texto − centro da linha */
  const deltaDoGlifo = (cs: CSSStyleDeclaration, lh: number): number | null => {
    const sonda = document.createElement("div");
    sonda.textContent = "Hg";
    Object.assign(sonda.style, {
      position: "absolute", left: "-10000px", top: "0px", margin: "0", padding: "0", border: "0", whiteSpace: "nowrap",
      fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, lineHeight: `${lh}px`
    });
    document.body.appendChild(sonda);
    const S = sonda.getBoundingClientRect();
    const no = sonda.firstChild;
    let delta: number | null = null;
    if (no) {
      const r = document.createRange();
      r.selectNodeContents(no);
      const q = r.getBoundingClientRect();
      if (q.height > 0) delta = q.top + q.height / 2 - (S.top + lh / 2);
    }
    sonda.remove();
    return delta;
  };
  let medidaDoControle: ControleMedido | null = null;
  if (controle) {
    const C = controle.getBoundingClientRect();
    const cs = getComputedStyle(controle);
    const bt = px(cs.borderTopWidth), bb = px(cs.borderBottomWidth), pt = px(cs.paddingTop), pb = px(cs.paddingBottom);
    const lh = parseFloat(cs.lineHeight);
    medidaDoControle = {
      tipo: controle.tagName, conteudoX: C.left + px(cs.borderLeftWidth) + px(cs.paddingLeft) - L.left, conteudoTopo: C.top + bt + pt - L.top,
      conteudoAltura: C.height - bt - bb - pt - pb, alturaDeLinha: Number.isFinite(lh) ? lh : null, paddingTop: cs.paddingTop,
      texto: controle.tagName === "BUTTON" ? textoDe(controle) : null,
      deltaDoGlifo: Number.isFinite(lh) ? deltaDoGlifo(cs, lh) : null
    };
  }
  const K = caixa?.getBoundingClientRect();
  const filho = valor?.firstElementChild ?? null;
  return {
    rotulo: (rotulo?.textContent ?? "").trim(),
    estado: linha.getAttribute("data-estado"), icone: linha.getAttribute("data-icone"),
    preenchido: linha.getAttribute("data-preenchido") === "true", multilinha: linha.hasAttribute("data-multilinha"), alturaDaLinha: L.height,
    rotuloLargura: rotulo ? rotulo.getBoundingClientRect().width : 0, rotuloTexto: textoDe(rotulo),
    caixa: caixa && K ? { x: K.left - L.left, y: K.top - L.top, altura: K.height, largura: K.width, raio: getComputedStyle(caixa).borderTopLeftRadius } : null,
    valor: valor ? { texto: textoDe(valor), scroll: valor.scrollWidth, client: valor.clientWidth, filho: filho ? { scroll: filho.scrollWidth, client: filho.clientWidth } : null } : null,
    controle: medidaDoControle,
    erro: erro ? { conteudoX: erro.getBoundingClientRect().left + px(getComputedStyle(erro).borderLeftWidth) + px(getComputedStyle(erro).paddingLeft) - L.left } : null,
    icones: [...linha.querySelectorAll('[data-parte="icone"]')].map((i) => i.querySelector("svg")?.getBoundingClientRect() ?? i.getBoundingClientRect())
      .filter((q) => q.width > 0).map((q) => q.left - L.left)
  };
}

/** Fontes carregadas e nenhuma transição/animação FINITA correndo dentro da raiz (as infinitas, como o ponto da pílula, não contam). */
async function noRepouso(raiz: Locator) {
  await raiz.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect.poll(() => raiz.evaluate((r) => document.getAnimations().filter((a) => {
    const efeito = a.effect;
    const alvo = efeito instanceof KeyframeEffect ? efeito.target : null;
    return a.playState === "running" && efeito !== null && efeito.getComputedTiming().endTime !== Infinity && alvo instanceof Element && r.contains(alvo);
  }).length), { message: "premissa: a Central está no repouso (nenhuma transição correndo) antes de medir" }).toBe(0);
}

/** A linha de um campo dentro do escopo: o pai do `[data-parte="caixa"]` (rótulo e caixa são irmãos nela). */
const linhaDe = (campo: Locator) => campo.locator('[data-parte="caixa"]').first().locator("..");
/** A linha pelo texto EXATO do rótulo (sem o "*" do obrigatório). */
const linhaPeloRotulo = (escopo: Locator, rotulo: string) =>
  escopo.locator('[data-parte="rotulo"]').filter({ hasText: new RegExp(`^${rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\*?$`) }).first().locator("..");

async function medir(linha: Locator): Promise<CampoMedido> {
  await expect(linha, "premissa: o campo medido está na tela").toBeVisible();
  return linha.evaluate(medirLinha);
}

/** Todas as linhas VISÍVEIS de campo dentro do escopo (Dados principais), na ordem da tela. */
async function medirTodas(escopo: Locator): Promise<CampoMedido[]> {
  const linhas = escopo.locator('[data-parte="caixa"]').locator("..");
  await expect(linhas.first(), "premissa: há campos no escopo").toBeVisible();
  const medidas: CampoMedido[] = [];
  for (const l of await linhas.all()) if (await l.isVisible()) medidas.push(await l.evaluate(medirLinha));
  return medidas;
}

/** O rótulo como o usuário o lê, sem o "*" do obrigatório (o obrigatório vem do layout da TOP). */
const nomeDoRotulo = (m: CampoMedido) => m.rotulo.replace(/\s*\*$/, "");
const f = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));
const amplitude = (xs: readonly number[]) => Math.max(...xs) - Math.min(...xs);
const log = (caso: string, texto: string) => console.log(`ALN-MEDIDA ${caso} ${texto}`);

async function compacto(raiz: Locator) {
  await raiz.getByRole("button", { name: "Rótulo dentro do campo" }).click();
  await expect(raiz, "a densidade passou a compacto").toHaveAttribute("data-densidade", "compacto");
  await raiz.page().evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await noRepouso(raiz);
}

async function abrirAba(page: Page, prefixo: string, nome: string) {
  const aba = page.getByTestId(`${prefixo}-painel`).getByRole("tab", { name: nome });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId(`${prefixo}-painel`).getByRole("tabpanel")).toBeVisible();
}

/* ═════════════════════════════════════════════ fixtures (pela API) ═════════════════════════════════════════════ */

/** Uma TOP da família pela porta administrativa, com a exclusão registrada na limpeza do caso. */
async function topDe(page: Page, codigoBase: string, prefixo: string) {
  return (await criarTop(page, { codigo: codigoTop(prefixo), codigoBase, nome: uniq(`ALN ${codigoBase}`) })).id;
}

/** Uma venda pela API oficial (cliente e produto do seed, a TOP do caso), lida de volta pela porta de detalhe. */
async function vendaPelaApi(page: Page, extra: Record<string, unknown> = {}) {
  const top = await topDe(page, "vendas.venda", "8");
  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const { id } = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, tipo_operacao_id: top,
    items: [{ product_id: produto, warehouse_id: null, quantity: "2", unit_price: "10.00" }], ...extra
  });
  const d = await api<{ code: string; note: string | null }>(page, "GET", `/api/sales/sales/${id}`);
  expect(d.code, "premissa: a venda tem código").toBeTruthy();
  return { id, codigo: d.code, nota: d.note };
}

/** Uma compra pela API oficial: fornecedor, armazém e produto CRIADOS aqui; natureza e centro do seed pelo nome. */
async function compraPelaApi(page: Page, extra: Record<string, unknown> = {}) {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const fornecedor = (await criarCadastro(page, "people", { name: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)} ALN forn`, person_type: "legal", is_provider: true })).id;
  const armazem = (await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `L${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("ALN arm"), type: "inputs" })).id;
  const produto = (await criarCadastro(page, "products", { description: uniq("ALN produto"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id })).id;
  const top = await topDe(page, "compras.compra", "7");
  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: empresa, tipo_operacao_id: top, fornecedor_id: fornecedor, data_documento: "2026-09-01",
    categoria_financeira_id: ref.natureza.id, centro_custo_id: ref.centro.id,
    itens: [{ produto_id: produto, armazem_id: armazem, quantidade: "2", valor_unitario: "10.00" }], ...extra
  });
  const d = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/${id}`);
  expect(d["codigo"], "premissa: a compra tem número").toBeTruthy();
  return { id, codigo: String(d["codigo"]), observacao: d["observacao"] };
}

/** Uma entrada de estoque ABERTA pela API, com observação: produto criado aqui, o primeiro local de estoque da empresa. */
async function entradaPelaApi(page: Page, observacao: string) {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const produto = (await criarCadastro(page, "products", { description: uniq("ALN prod est"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id })).id;
  const armazem = await primeiroId(page, `/api/resources/warehouses?empresa_id=${empresa}&pageSize=1`);
  const familia = familiaOperacionalDeDocumentoEstoque("entrada");
  expect(familia, "premissa: o registry declara a família da entrada").toBeTruthy();
  const top = await topDe(page, familia!, "6");
  const doc = await api<{ id: string; codigo: string; situacao: string }>(page, "POST", "/api/estoque/entradas", {
    empresa_id: empresa, tipo_operacao_id: top, armazem_id: armazem, data_documento: hojeISO(), observacao,
    itens: [{ produto_id: produto, quantidade: "2", custo_unitario: "3" }]
  });
  expect(doc.situacao, "premissa: a entrada nasce aberta").toBe("aberto");
  return doc;
}

async function consultaDeVenda(page: Page, venda: { id: string; codigo: string }) {
  await page.goto(`/vendas/sales/${venda.id}`);
  const raiz = page.getByTestId("central-vendas");
  await expect(raiz).toBeVisible();
  await expect(page.getByTestId("central-vendas-identidade-nome"), "premissa: a tela desenhou ESTE documento").toHaveText(venda.codigo);
  await expect(raiz, "a densidade padrão é rótulo à frente").toHaveAttribute("data-densidade", "rotulo-a-frente");
  return raiz;
}

async function consultaDeCompra(page: Page, compra: { id: string; codigo: string }) {
  await page.goto(`/compras/compras/${compra.id}`);
  const raiz = page.getByTestId("central-compras");
  await expect(raiz).toBeVisible();
  await expect(page.getByTestId("central-compras-identidade-nome"), "premissa: a tela desenhou ESTE documento").toHaveText(compra.codigo);
  await expect(raiz, "a densidade padrão é rótulo à frente").toHaveAttribute("data-densidade", "rotulo-a-frente");
  return raiz;
}

async function consultaDeEntrada(page: Page, doc: { id: string; codigo: string }) {
  await page.goto(`/estoque/movimentacoes/entradas/${doc.id}`);
  await expect(page.getByTestId("estoque-central")).toHaveAttribute("data-modo", "consulta");
  await expect(page.getByTestId("estoque-central-codigo"), "premissa: a tela desenhou ESTE documento").toHaveText(doc.codigo);
  const raiz = page.getByTestId("central-estoque");
  await expect(raiz, "a densidade padrão é rótulo à frente").toHaveAttribute("data-densidade", "rotulo-a-frente");
  return raiz;
}

async function criacaoDeVenda(page: Page) {
  const top = await topDe(page, "vendas.venda", "8");
  await page.goto(`/vendas/sales/new?tipo_operacao_id=${top}`);
  const raiz = page.getByTestId("central-vendas");
  await expect(raiz).toBeVisible();
  await expect(page.getByTestId("top-contexto"), "a criação montou com a TOP").toBeVisible();
  await expect(raiz, "a densidade padrão é rótulo à frente").toHaveAttribute("data-densidade", "rotulo-a-frente");
  return raiz;
}

async function criacaoDeCompra(page: Page) {
  const top = await topDe(page, "compras.compra", "7");
  await page.goto(`/compras/compras/new?tipo_operacao_id=${top}`);
  const raiz = page.getByTestId("central-compras");
  await expect(raiz).toBeVisible();
  await expect(page.getByTestId("compras-top-travada"), "a criação montou com a TOP").toBeVisible();
  await expect(raiz, "a densidade padrão é rótulo à frente").toHaveAttribute("data-densidade", "rotulo-a-frente");
  return raiz;
}

async function criacaoDeEstoque(page: Page, especie: "entrada" | "saida") {
  const familia = familiaOperacionalDeDocumentoEstoque(especie);
  expect(familia, `premissa: o registry declara a família da ${especie}`).toBeTruthy();
  const top = await topDe(page, familia!, "6");
  await page.goto(`/estoque/movimentacoes/${especie === "entrada" ? "entradas" : "saidas"}/new?tipo_operacao_id=${top}`);
  const central = page.getByTestId("estoque-central");
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await expect(central).toHaveAttribute("data-especie", especie);
  await expect(page.getByTestId("estoque-central-top"), "a criação montou com a TOP").toBeVisible();
  const raiz = page.getByTestId("central-estoque");
  await expect(raiz, "a densidade padrão é rótulo à frente").toHaveAttribute("data-densidade", "rotulo-a-frente");
  return raiz;
}

/* ═════════════════════════════════════════════ ALN-1 (D3) ═════════════════════════════════════════════ */

/** O x do texto de TODOS os valores de Dados principais é o mesmo: travado (sem ícone) e com ícone na mesma coluna. */
function conferirUmSoRecuo(caso: string, medidas: CampoMedido[]) {
  expect(medidas.length, "premissa: Dados principais tem campos para medir").toBeGreaterThan(3);
  expect(medidas.filter((m) => !m.valor?.texto).map((m) => m.rotulo), "premissa: todo valor visível tem texto medido (o \"—\" também)").toEqual([]);
  expect(medidas.some((m) => m.estado === "travado"), "premissa: a coluna tem campo TRAVADO (sem ícone)").toBe(true);
  expect(medidas.some((m) => m.icone !== null), "premissa: a coluna tem campo COM ÍCONE (pesquisa/data)").toBe(true);
  const xs = medidas.map((m) => m.valor!.texto!.esq);
  log(caso, `x do texto do valor (px da borda do campo): ${medidas.map((m) => `${m.rotulo}[${m.estado}${m.icone ? `/${m.icone}` : ""}]=${f(m.valor!.texto!.esq)}`).join(" · ")} · amplitude=${f(amplitude(xs))}`);
  expect(amplitude(xs), `${caso}: o texto de todos os valores começa no MESMO x (travado e com ícone) — tolerância 1 px`).toBeLessThanOrEqual(1);
}

test("ALN-1a — D3: na consulta de COMPRAS, o texto de todos os valores de Dados principais começa no mesmo x (travado, pesquisa e data alternados)", async ({ page }) => {
  await login(page);
  const compra = await compraPelaApi(page);
  const raiz = await consultaDeCompra(page, compra);
  await noRepouso(raiz);
  conferirUmSoRecuo("ALN-1a", await medirTodas(raiz.getByTestId("central-compras-dados")));
});

test("ALN-1b — D3: na consulta de VENDA, o texto de todos os valores de Dados principais começa no mesmo x", async ({ page }) => {
  await login(page);
  const venda = await vendaPelaApi(page);
  const raiz = await consultaDeVenda(page, venda);
  await noRepouso(raiz);
  conferirUmSoRecuo("ALN-1b", await medirTodas(raiz.getByTestId("central-vendas-dados")));
});

/* ═════════════════════════════════════════════ ALN-2 (D1) ═════════════════════════════════════════════ */

/** Multilinha só-leitura: o topo do texto do valor no topo do texto do rótulo (2 px). */
function conferirTopoDoMultilinha(caso: string, onde: string, m: CampoMedido) {
  expect(m.multilinha, `premissa (${onde}): o campo é multilinha`).toBe(true);
  expect(m.controle, `premissa (${onde}): só leitura (sem controle)`).toBeNull();
  expect(m.rotuloTexto, `premissa (${onde}): o rótulo tem texto`).not.toBeNull();
  expect(m.valor?.texto, `premissa (${onde}): o valor tem texto`).toBeTruthy();
  const d = m.valor!.texto!.topo - m.rotuloTexto!.topo;
  log(caso, `${onde}: linha=${f(m.alturaDaLinha)} · topo do texto do rótulo=${f(m.rotuloTexto!.topo)} · topo do texto do valor=${f(m.valor!.texto!.topo)} · centro rótulo=${f(m.rotuloTexto!.centro)} · centro 1ª linha do valor=${f(m.valor!.texto!.centro)} · diferença=${f(d)}`);
  expect.soft(Math.abs(d), `${caso} (${onde}): o topo do texto do valor fica no topo do texto do rótulo — tolerância 2 px`).toBeLessThanOrEqual(2);
}

test("ALN-2a — D1: multilinha só-leitura (Observações da consulta de Estoque e de Compras): o texto do valor começa na altura do rótulo", async ({ page }) => {
  await login(page);
  const entrada = await entradaPelaApi(page, "Conferir a nota na portaria.");
  const raizEstoque = await consultaDeEntrada(page, entrada);
  await abrirAba(page, "central-estoque", "Observações");
  await expect(page.getByTestId("estoque-central-observacao"), "premissa: a observação do servidor").toHaveText("Conferir a nota na portaria.");
  await noRepouso(raizEstoque);
  conferirTopoDoMultilinha("ALN-2a", "estoque", await medir(linhaDe(page.getByTestId("central-estoque-painel").locator('[data-campo="Observação"]'))));

  const compra = await compraPelaApi(page, { observacao: "Entregar no armazém da sede." });
  expect(compra.observacao, "premissa: o servidor gravou a observação").toBe("Entregar no armazém da sede.");
  const raizCompras = await consultaDeCompra(page, compra);
  await abrirAba(page, "central-compras", "Observações");
  await noRepouso(raizCompras);
  conferirTopoDoMultilinha("ALN-2a", "compras", await medir(linhaDe(page.getByTestId("central-compras-painel").locator('[data-campo="Observação"]'))));
});

const NOTA_LONGA = "Entregar no armazém da sede antes das dez horas. Conferir os lacres de cada volume e registrar a temperatura da carga na chegada. "
  + "Se houver avaria, fotografar a carga, anotar no verso da nota e avisar o comprador responsável pelo pedido. "
  + "A descarga só começa depois da conferência do motorista com o encarregado da portaria.";

test("ALN-2b — D1: texto longo no multilinha só-leitura (Observações da consulta de venda) quebra em mais de uma linha e não é cortado", async ({ page }) => {
  await login(page);
  const venda = await vendaPelaApi(page, { note: NOTA_LONGA });
  expect(venda.nota, "premissa: o servidor gravou a observação inteira").toBe(NOTA_LONGA);
  const raiz = await consultaDeVenda(page, venda);
  await abrirAbaDoLancamento(page, "Observações");
  await noRepouso(raiz);
  const m = await medir(linhaDe(page.getByTestId("central-vendas-painel").locator('[data-campo="Observação"]')));
  expect(m.multilinha, "premissa: o campo é multilinha").toBe(true);
  const texto = m.valor?.texto;
  expect(texto, "premissa: o valor tem texto").toBeTruthy();
  expect(texto!.conteudo, "premissa: o DOM tem a observação inteira").toBe(NOTA_LONGA);
  expect(texto!.larguraNatural ?? 0, "premissa: o texto NÃO caberia numa linha da caixa (largura natural > largura da caixa)").toBeGreaterThan(m.caixa?.largura ?? Infinity);
  log("ALN-2b", `largura natural do texto=${f(texto!.larguraNatural)} · largura da caixa=${f(m.caixa?.largura)} · linhas do Range=${texto!.linhas} · valor scrollWidth/clientWidth=${m.valor!.scroll}/${m.valor!.client} · filho scrollWidth/clientWidth=${m.valor!.filho?.scroll ?? "—"}/${m.valor!.filho?.client ?? "—"}`);
  expect(texto!.linhas, "ALN-2b: o texto longo QUEBRA em mais de uma linha (Range.getClientRects com tops distintos)").toBeGreaterThan(1);
  expect(m.valor!.scroll, "ALN-2b: o valor não está cortado na horizontal (scrollWidth <= clientWidth)").toBeLessThanOrEqual(m.valor!.client);
  expect(m.valor!.filho, "premissa: o valor tem o filho que leva o texto").not.toBeNull();
  expect(m.valor!.filho!.scroll, "ALN-2b: o filho do valor não está cortado (scrollWidth <= clientWidth)").toBeLessThanOrEqual(m.valor!.filho!.client);
});

/* ═════════════════════════════════════════════ ALN-3 (D2) ═════════════════════════════════════════════ */

/** A Observação da criação da venda (aba Observações), com texto. */
async function observacaoDaCriacaoDeVenda(page: Page) {
  const raiz = await criacaoDeVenda(page);
  await abrirAbaDoLancamento(page, "Observações");
  const painel = page.getByTestId("central-vendas-painel");
  const campo = painel.getByLabel("Observação", { exact: true });
  await campo.fill("Entregar na portaria.");
  await expect(campo).toHaveValue("Entregar na portaria.");
  return { raiz, linha: linhaPeloRotulo(painel, "Observação") };
}

function primeiraLinhaDaTextarea(m: CampoMedido) {
  expect(m.multilinha, "premissa: o campo é multilinha").toBe(true);
  expect(m.controle?.tipo, "premissa: o controle é a textarea").toBe("TEXTAREA");
  expect(m.controle!.alturaDeLinha, "premissa: a textarea tem line-height em px").not.toBeNull();
  expect(m.controle!.deltaDoGlifo, "premissa: a sonda mediu o glifo com a fonte da textarea").not.toBeNull();
  expect(m.rotuloTexto, "premissa: o rótulo tem texto").not.toBeNull();
  const linha = m.controle!.conteudoTopo + m.controle!.alturaDeLinha! / 2;
  /* `centro` é o do GLIFO da 1ª linha (a régua do Range do rótulo); `linha` é o centro da caixa de linha */
  return { topo: m.controle!.conteudoTopo, linha, centro: linha + m.controle!.deltaDoGlifo! };
}

test("ALN-3a — D2: criação multilinha (Observação da venda, rótulo à frente): o centro da 1ª linha fica no centro do texto do rótulo", async ({ page }) => {
  await login(page);
  const { raiz, linha } = await observacaoDaCriacaoDeVenda(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await noRepouso(raiz);
  const m = await medir(linha);
  const l1 = primeiraLinhaDaTextarea(m);
  const d = l1.centro - m.rotuloTexto!.centro;
  log("ALN-3a", `padding-top da textarea=${m.controle!.paddingTop} · line-height=${f(m.controle!.alturaDeLinha)} · topo do conteúdo=${f(l1.topo)} · centro da caixa da 1ª linha=${f(l1.linha)} · delta do glifo=${f(m.controle!.deltaDoGlifo)} · centro do texto da 1ª linha=${f(l1.centro)} · centro do texto do rótulo=${f(m.rotuloTexto!.centro)} · diferença=${f(d)}`);
  expect(Math.abs(d), "ALN-3a: a 1ª linha da textarea no centro do texto do rótulo — tolerância 1 px").toBeLessThanOrEqual(1);
});

test("ALN-3b — D2: no COMPACTO, a 1ª linha da Observação começa abaixo do rótulo flutuante e o padding-top continua 13px", async ({ page }) => {
  await login(page);
  const { raiz, linha } = await observacaoDaCriacaoDeVenda(page);
  await compacto(raiz);
  const m = await medir(linha);
  const l1 = primeiraLinhaDaTextarea(m);
  log("ALN-3b", `padding-top da textarea=${m.controle!.paddingTop} · topo da 1ª linha=${f(l1.topo)} · centro da 1ª linha=${f(l1.centro)} · texto do rótulo flutuante ${f(m.rotuloTexto!.topo)}–${f(m.rotuloTexto!.base)} · folga=${f(l1.topo - m.rotuloTexto!.base)}`);
  expect(m.controle!.paddingTop, "ALN-3b: o padding-top do compacto continua o de hoje").toBe("13px");
  expect(l1.topo, "ALN-3b: a 1ª linha começa ABAIXO do texto do rótulo flutuante (sem sobrepor)").toBeGreaterThanOrEqual(m.rotuloTexto!.base);
});

/* ═════════════════════════════════════════════ ALN-4 (D4 + D5) ═════════════════════════════════════════════ */

test("ALN-4a — D4+D5: campo simples só-leitura (consulta de compras): o centro do texto do rótulo coincide com o do valor; a linha-base é registrada", async ({ page }) => {
  await login(page);
  const compra = await compraPelaApi(page);
  const raiz = await consultaDeCompra(page, compra);
  await noRepouso(raiz);
  const medidas = (await medirTodas(raiz.getByTestId("central-compras-dados"))).filter((m) => !m.multilinha);
  expect(medidas.length, "premissa: Dados principais tem campos simples para medir").toBeGreaterThan(3);
  expect(medidas.filter((m) => !m.rotuloTexto || !m.valor?.texto).map((m) => m.rotulo), "premissa: todo campo tem texto no rótulo e no valor").toEqual([]);
  const linhas = medidas.map((m) => {
    const r = m.rotuloTexto!, v = m.valor!.texto!;
    return { rotulo: m.rotulo, centro: v.centro - r.centro, base: r.linhaBase === null || v.linhaBase === null ? null : v.linhaBase - r.linhaBase, r, v };
  });
  for (const l of linhas) {
    log("ALN-4a", `${l.rotulo}: rótulo ${l.r.fonte} topo=${f(l.r.topo)} altura=${f(l.r.altura)} centro=${f(l.r.centro)} linha-base=${f(l.r.linhaBase)} · valor ${l.v.fonte} topo=${f(l.v.topo)} altura=${f(l.v.altura)} centro=${f(l.v.centro)} linha-base=${f(l.v.linhaBase)} · Δcentro=${f(l.centro)} · Δlinha-base=${f(l.base)}`);
  }
  const pior = linhas.reduce((a, b) => (Math.abs(b.centro) > Math.abs(a.centro) ? b : a));
  log("ALN-4a", `maior |Δcentro| = ${f(Math.abs(pior.centro))} (${pior.rotulo})`);
  for (const l of linhas) expect(Math.abs(l.centro), `ALN-4a (${l.rotulo}): o centro do texto do rótulo coincide com o centro do texto do valor — tolerância 1 px`).toBeLessThanOrEqual(1);
});

/* ═════════════════════════════════════════════ ALN-5 (D6) ═════════════════════════════════════════════ */

test("ALN-5a — D6: no COMPACTO preenchido (criação da venda), o texto do RefSelect fica na mesma altura do texto do input da coluna", async ({ page }) => {
  await login(page);
  const raiz = await criacaoDeVenda(page);
  await pickRef(page, "Cliente", "DEMO");
  const dados = raiz.getByTestId("central-vendas-dados");
  await expect(linhaPeloRotulo(dados, "Cliente"), "premissa: o Cliente ficou preenchido").toHaveAttribute("data-preenchido", "true");
  await expect(linhaPeloRotulo(dados, "Data"), "premissa: a Data vem preenchida").toHaveAttribute("data-preenchido", "true");
  await compacto(raiz);
  const medidas = (await medirTodas(dados)).filter((m) => m.preenchido && m.controle !== null && Math.round(m.alturaDaLinha) === GEOMETRIA.compactoAltura);
  const pesquisas = medidas.filter((m) => m.controle!.tipo === "BUTTON" && m.controle!.texto !== null);
  const entradas = medidas.filter((m) => m.controle!.tipo === "INPUT");
  expect(pesquisas.map(nomeDoRotulo), "premissa: o Cliente (RefSelect preenchido) está entre os medidos").toContain("Cliente");
  expect(entradas.map(nomeDoRotulo), "premissa: a Data (input preenchido) está entre os medidos").toContain("Data");
  expect(entradas.filter((m) => m.controle!.deltaDoGlifo === null).map((m) => m.rotulo), "premissa: a sonda mediu o glifo de todo input").toEqual([]);
  /* as duas pela MESMA régua, o centro do GLIFO: o do RefSelect pelo Range; o do input pela caixa de conteúdo (o input
     centra a linha nela) + o delta do glifo da sonda. Misturar glifo com caixa de linha erra meio pixel justo aqui. */
  const yPesquisa = (m: CampoMedido) => m.controle!.texto!.centro;
  const yEntrada = (m: CampoMedido) => m.controle!.conteudoTopo + m.controle!.conteudoAltura / 2 + m.controle!.deltaDoGlifo!;
  log("ALN-5a", `centro do texto (px do topo da linha de ${GEOMETRIA.compactoAltura}): ${[
    ...pesquisas.map((m) => `RefSelect ${m.rotulo} (padding-top ${m.controle!.paddingTop}; conteúdo ${f(m.controle!.conteudoTopo)}+${f(m.controle!.conteudoAltura)}; glifo ${f(m.controle!.texto!.topo)}–${f(m.controle!.texto!.base)})=${f(yPesquisa(m))}`),
    ...entradas.map((m) => `input ${m.rotulo} (padding-top ${m.controle!.paddingTop}; conteúdo ${f(m.controle!.conteudoTopo)}+${f(m.controle!.conteudoAltura)}; delta do glifo ${f(m.controle!.deltaDoGlifo)})=${f(yEntrada(m))}`)
  ].join(" · ")}`);
  const cliente = pesquisas.find((m) => nomeDoRotulo(m) === "Cliente")!;
  const data = entradas.find((m) => nomeDoRotulo(m) === "Data")!;
  const d = yPesquisa(cliente) - yEntrada(data);
  const todos = [...pesquisas.map(yPesquisa), ...entradas.map(yEntrada)];
  log("ALN-5a", `Cliente × Data: Δy=${f(d)} · amplitude entre todos os preenchidos=${f(amplitude(todos))}`);
  /* TOLERÂNCIA 0,25 px, e não 1: o D6 é de MEIO pixel (13 × 12 de padding-top numa linha de 15 com glifo de 16) — com
     1 px este caso passaria no ANTES e não morderia (medido: Δy 0,50). Glifo e caixa são medidos em fração de pixel. */
  expect(Math.abs(d), "ALN-5a: o texto do RefSelect (Cliente) e o do input (Data) na mesma altura — tolerância 0,25 px").toBeLessThanOrEqual(0.25);
  expect(amplitude(todos), "ALN-5a: todos os RefSelect e inputs preenchidos da coluna na mesma altura — tolerância 0,25 px").toBeLessThanOrEqual(0.25);
});

/* ═════════════════════════════════════════════ ALN-6 (D8) ═════════════════════════════════════════════ */

test("ALN-6a — D8: a mensagem de erro começa no x do texto do controle, nas DUAS densidades (saída de estoque: com e sem ícone)", async ({ page }) => {
  await login(page);
  const raiz = await criacaoDeEstoque(page, "saida");
  const salvar = page.getByTestId("estoque-salvar");
  await expect(salvar).toBeEnabled();
  await salvar.click();
  const lista = page.getByTestId("central-estoque-pendencias-lista");
  await expect(lista, "a pílula abre a lista das pendências").toBeVisible();
  for (const caminho of ["armazem_id", "justificativa"]) {
    await expect(lista.locator(`[data-testid="central-estoque-pendencia"][data-caminho="${caminho}"]`), `premissa: ${caminho} é pendência`).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  await expect(lista).toBeHidden();
  await abrirAba(page, "central-estoque", "Motivo da saída");
  const local = linhaDe(page.getByTestId("estoque-central-armazem"));
  const justificativa = linhaDe(page.locator('[data-campo="justificativa"]'));
  await expect(page.getByTestId("estoque-central-armazem").locator('[data-parte="erro"]'), "premissa: o erro do Local de estoque está na tela").toBeVisible();
  await expect(page.locator('[data-campo="justificativa"] [data-parte="erro"]'), "premissa: o erro da Justificativa está na tela").toBeVisible();

  for (const densidade of ["rotulo-a-frente", "compacto"] as const) {
    if (densidade === "compacto") await compacto(raiz);
    else await noRepouso(raiz);
    for (const [nome, linha, comIcone] of [["Local de estoque", local, true], ["Justificativa", justificativa, false]] as const) {
      const m = await medir(linha);
      expect(m.erro, `premissa (${nome}, ${densidade}): há mensagem de erro`).not.toBeNull();
      expect(m.controle, `premissa (${nome}, ${densidade}): há controle`).not.toBeNull();
      expect(m.icone !== null, `premissa (${nome}): ${comIcone ? "com" : "sem"} ícone`).toBe(comIcone);
      const d = m.erro!.conteudoX - m.controle!.conteudoX;
      log("ALN-6a", `${densidade} · ${nome} (${m.controle!.tipo}${comIcone ? ", com ícone" : ", sem ícone"}): x do texto do controle=${f(m.controle!.conteudoX)} · x do início da mensagem de erro=${f(m.erro!.conteudoX)} · diferença=${f(d)}`);
      expect.soft(Math.abs(d), `ALN-6a (${nome}, ${densidade}): a mensagem de erro começa no x do texto do controle — tolerância 1 px`).toBeLessThanOrEqual(1);
    }
  }
});

/* ═════════════════════════════════════════════ ALN-7 (não-regressão) ═════════════════════════════════════════════ */

/** As três criações e o campo de pesquisa medido em cada uma (o par do Cliente da venda). */
const CENTRAIS = [
  { nome: "vendas", abrir: criacaoDeVenda, dados: "central-vendas-dados", campo: "Cliente" },
  { nome: "compras", abrir: criacaoDeCompra, dados: "central-compras-dados", campo: "Fornecedor" },
  { nome: "estoque", abrir: (page: Page) => criacaoDeEstoque(page, "entrada"), dados: "central-estoque-dados", campo: "Local de estoque" }
] as const;

test("ALN-7a — não-regressão nas três Centrais: rótulo 128, caixa em 137 com 28 de altura e raio 8px; compacto 32", async ({ page }) => {
  await login(page);
  page.on("dialog", (d) => { void d.accept(); });
  for (const c of CENTRAIS) {
    const raiz = await c.abrir(page);
    await noRepouso(raiz);
    const linha = linhaPeloRotulo(raiz.getByTestId(c.dados), c.campo);
    const m = await medir(linha);
    expect(m.caixa, `premissa (${c.nome}): a caixa do ${c.campo} existe`).not.toBeNull();
    await compacto(raiz);
    const mc = await medir(linha);
    log("ALN-7a", `${c.nome} · ${c.campo}: rótulo=${f(m.rotuloLargura)} · caixa x=${f(m.caixa!.x)} altura=${f(m.caixa!.altura)} raio=${m.caixa!.raio} · compacto altura=${f(mc.caixa?.altura)}`);
    expect.soft([Math.round(m.rotuloLargura), Math.round(m.caixa!.x), Math.round(m.caixa!.altura), m.caixa!.raio], `ALN-7a (${c.nome}): rótulo 128, caixa em 137, 28 de altura, raio 8px`)
      .toEqual([GEOMETRIA.rotuloLargura, GEOMETRIA.caixaInicio, GEOMETRIA.caixaAltura, GEOMETRIA.caixaRaio]);
    expect.soft(Math.round(mc.caixa?.altura ?? 0), `ALN-7a (${c.nome}): compacto, 32 de altura`).toBe(GEOMETRIA.compactoAltura);
  }
});

test("ALN-7b — não-regressão nas três Centrais: todo ícone de Dados principais continua na faixa [137, 177)", async ({ page }) => {
  await login(page);
  page.on("dialog", (d) => { void d.accept(); });
  for (const c of CENTRAIS) {
    const raiz = await c.abrir(page);
    await noRepouso(raiz);
    const medidas = await medirTodas(raiz.getByTestId(c.dados));
    const icones = medidas.flatMap((m) => m.icones.map((x) => ({ rotulo: m.rotulo, x })));
    expect(icones.length, `premissa (${c.nome}): Dados principais tem ícones para medir`).toBeGreaterThan(0);
    log("ALN-7b", `${c.nome}: ${icones.map((i) => `${i.rotulo}=${f(i.x)}`).join(" · ")}`);
    for (const i of icones) {
      expect.soft(i.x, `ALN-7b (${c.nome}, ${i.rotulo}): o ícone começa em >= 137`).toBeGreaterThanOrEqual(GEOMETRIA.iconeDe);
      expect.soft(i.x, `ALN-7b (${c.nome}, ${i.rotulo}): o ícone começa em < 177`).toBeLessThan(GEOMETRIA.iconeAte);
    }
  }
});
