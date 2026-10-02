import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import type { ConfiguracaoTipoOperacao } from "@agro/domain";
import { api, login, uniq } from "./helpers";
import {
  abrirEditorDaTop, abrirTelaDeTops, catalogoPublicadoE2E, codigoTopE2E, detalheTopNoServidor, escolherTipoNoAssistente, excluirTopE2E
} from "./top-config-08-comum";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — A ABA "PADRÕES FINANCEIROS" (OPERACOES-01 F9a, decisão 286), PF-1 e PF-2.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────────┐
 * │ A integração (`f9a-top-financeiro-padrao.test.ts`) prova que a API grava, preserva, copia e recusa   │
 * │ os padrões. O que ela não alcança é a TELA: que a aba aparece só na família que usa os padrões, que  │
 * │ a caixa da provisão aparece só onde a provisão existe (o pedido de venda), que os seletores dos      │
 * │ padrões gravam o que o usuário escolheu — a chave `padroesFinanceiros` sai no corpo, com o 5 — e que │
 * │ o editor, reaberto, mostra o que o SERVIDOR guardou.                                                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O SERVIDOR É O ÁRBITRO: o corpo que saiu no fio e o detalhe da API (`GET /api/admin/tipos-operacao/:id`) decidem,
 * nunca um texto da tela. As premissas também são lidas nele: o bloco `formato5` com a seção `financeiroPadrao`, a
 * capacidade `padroesFinanceiros: 1` e uma natureza de receita e um centro, analíticos, do seed (pelo `/options`).
 *
 * FIXTURE PRÓPRIA: toda TOP nasce no teste (pela tela) e é excluída no `finally` (a exclusão lógica da própria API).
 */

interface CapacidadesF9a { padroesFinanceiros?: number; formato5?: { secoes: string[] } }
interface OpcaoDoSeletor { id: string; label: string }
interface PadraoNaApi { id: string; nome?: string; codigo?: string }
interface DetalheComPadroes {
  padroesFinanceiros: Record<"natureza" | "centro" | "tipoTitulo" | "formaPagamento" | "conta", PadraoNaApi | null> | null;
  configuracao: { valor?: ConfiguracaoTipoOperacao & { financeiroPadrao?: { provisao: boolean; documentoTroca: boolean; semClassificacao: string } } };
}
interface CorpoGravado {
  codigoBase?: string;
  configuracao?: ConfiguracaoTipoOperacao & { financeiroPadrao?: { provisao: boolean } };
  padroesFinanceiros?: Record<string, string | null>;
}

const ROTULO_PROVISAO = "Provisionar a receber ao salvar o pedido";
const ehPostDeTop = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/admin/tipos-operacao";

/** As premissas do servidor: o editor do 5 com a seção da F9 e a capacidade dos padrões. */
async function premissasDoServidor(page: Page): Promise<void> {
  await catalogoPublicadoE2E(page);
  const c = await api<CapacidadesF9a>(page, "GET", "/api/admin/tipos-operacao/capabilities");
  expect(c.formato5?.secoes, "premissa: o servidor lê e grava a seção financeiroPadrao").toEqual(["financeiroPadrao"]);
  expect(c.padroesFinanceiros, "premissa: o servidor grava os padrões financeiros da versão").toBe(1);
}

/** A 1ª opção ANALÍTICA do cadastro (a natureza com o tipo pedido), pela rota do seletor — o que a tela vai oferecer. */
async function opcaoAnalitica(page: Page, recurso: string, extra = ""): Promise<OpcaoDoSeletor> {
  const opcoes = await api<OpcaoDoSeletor[]>(page, "GET", `/api/resources/${recurso}/options?kind=analytic${extra}`);
  expect(opcoes.length, `premissa: o seed tem ${recurso} analítico`).toBeGreaterThan(0);
  return opcoes[0]!;
}

/** Escolhe a opção no seletor do padrão (`top-campo-padrao-<campo>`), pela busca no servidor — o gesto do usuário. */
async function escolherPadrao(page: Page, forma: Locator, testId: string, opcao: OpcaoDoSeletor): Promise<void> {
  const campo = forma.getByTestId(testId);
  await campo.getByRole("combobox").click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).fill(opcao.label);
  await painel.getByRole("option", { name: new RegExp(opcao.label.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first().click();
  await expect(campo.getByRole("combobox"), `o padrão escolhido aparece no campo ${testId}`).toContainText(opcao.label);
}

async function idDaTopCriada(page: Page, codigo: string): Promise<string> {
  const lista = await api<{ items: { id: string; codigo: string }[] }>(page, "GET", `/api/admin/tipos-operacao?search=${codigo}`);
  const id = lista.items.find((x) => x.codigo === codigo)?.id;
  expect(id, "a TOP criada pela tela existe no servidor").toBeTruthy();
  return id!;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * PF-1 — O CAMINHO PRINCIPAL: PEDIDO DE VENDA COM A PROVISÃO E A NATUREZA E O CENTRO PADRÃO, SALVO E RELIDO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("PF-1 — Pedido de venda: a aba Padrões financeiros, a provisão e a natureza e o centro padrão; o POST leva a seção e os padrões; reaberto, o editor mostra o que o servidor guardou", async ({ page }) => {
  await login(page);
  await premissasDoServidor(page);
  const natureza = await opcaoAnalitica(page, "financial_categories", "&nature=income");
  const centro = await opcaoAnalitica(page, "cost_centers");

  await abrirTelaDeTops(page);
  const codigo = codigoTopE2E();
  let id: string | null = null;
  try {
    await page.getByRole("button", { name: "Novo tipo de operação" }).click();
    const forma = page.getByTestId("form-tipo-operacao");
    await escolherTipoNoAssistente(forma, "vendas.pedido");
    await forma.getByTestId("top-campo-codigo").fill(codigo);
    await forma.getByTestId("top-campo-nome").fill(uniq("Pedido PF-1"));

    // A ABA DA SEÇÃO, com o rótulo do domínio; a caixa da provisão (o pedido provisiona) começa DESLIGADA.
    const aba = forma.getByTestId("top-aba-financeiroPadrao");
    await expect(aba).toHaveText("Padrões financeiros");
    await aba.click();
    const provisao = forma.getByTestId("top-campo-financeiroPadrao-provisao");
    await expect(provisao, "tudo nasce desligado").not.toBeChecked();
    await expect(forma.getByText(ROTULO_PROVISAO, { exact: true })).toBeVisible();
    await expect(forma.getByTestId("top-campo-financeiroPadrao-documentoTroca"), "o documento troca, como hoje").toBeChecked();
    // O pedido só gera título PELA provisão: sem ela, "Sem natureza e centro" não tem efeito e não aparece.
    await expect(forma.getByTestId("top-campo-financeiroPadrao-semClassificacao"), "sem a provisão, a regra não aparece").toHaveCount(0);
    // Os cinco padrões do pedido (o perfil da família), todos vazios.
    for (const t of ["natureza", "centro", "tipo-titulo", "forma", "conta"]) {
      await expect(forma.getByTestId(`top-campo-padrao-${t}`).getByRole("combobox"), `o padrão ${t} começa vazio`).toContainText("Sem padrão");
    }

    await provisao.check();
    await expect(forma.getByTestId("top-campo-financeiroPadrao-semClassificacao"), "com a provisão, a regra aparece, no padrão de hoje").toHaveValue("padrao_legado");
    await escolherPadrao(page, forma, "top-campo-padrao-natureza", natureza);
    await escolherPadrao(page, forma, "top-campo-padrao-centro", centro);

    // SALVAR → o POST no 5 com a provisão na seção e os padrões na chave própria (os não escolhidos, nulos).
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await post).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "POST 201").toBe(201);
    expect(corpo.codigoBase).toBe("vendas.pedido");
    expect(corpo.configuracao?.versaoSchema, "grava o formato 5").toBe(5);
    expect(corpo.configuracao?.financeiroPadrao?.provisao, "a provisão vai na seção do JSON").toBe(true);
    expect(corpo.padroesFinanceiros, "os padrões vão na chave própria, só os escolhidos").toEqual({
      naturezaId: natureza.id, centroCustoId: centro.id, tipoTituloId: null, formaPagamentoId: null, contaBancariaId: null
    });
    await expect(forma).toBeHidden();

    // O SERVIDOR GUARDOU: a seção e os padrões, com o cadastro de cada um.
    id = await idDaTopCriada(page, codigo);
    const d = await api<DetalheComPadroes>(page, "GET", `/api/admin/tipos-operacao/${id}`);
    expect(d.configuracao.valor?.financeiroPadrao).toEqual({ provisao: true, documentoTroca: true, semClassificacao: "padrao_legado" });
    expect(d.padroesFinanceiros?.natureza?.id).toBe(natureza.id);
    expect(d.padroesFinanceiros?.centro?.id).toBe(centro.id);
    expect([d.padroesFinanceiros?.tipoTitulo, d.padroesFinanceiros?.formaPagamento, d.padroesFinanceiros?.conta]).toEqual([null, null, null]);
    expect((await detalheTopNoServidor(page, id)).versao, "a criação é UMA versão").toBe(1);

    // REABERTO: o editor mostra o que o servidor guardou — a caixa marcada e os dois padrões; os outros, vazios.
    const editor = await abrirEditorDaTop(page, codigo);
    await editor.getByTestId("top-aba-financeiroPadrao").click();
    await expect(editor.getByTestId("top-campo-financeiroPadrao-provisao")).toBeChecked();
    await expect(editor.getByTestId("top-campo-padrao-natureza").getByRole("combobox")).toContainText(natureza.label);
    await expect(editor.getByTestId("top-campo-padrao-centro").getByRole("combobox")).toContainText(centro.label);
    await expect(editor.getByTestId("top-campo-padrao-conta").getByRole("combobox")).toContainText("Sem padrão");
  } finally {
    if (id) await excluirTopE2E(page, id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * PF-2 — O QUE A FAMÍLIA NÃO USA NÃO APARECE: O ORÇAMENTO SEM A ABA, A VENDA SEM A PROVISÃO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("PF-2 — Orçamento: a aba Padrões financeiros não existe e o POST sai sem padrões; Venda: a aba existe, sem a caixa da provisão e com os cinco padrões", async ({ page }) => {
  await login(page);
  await premissasDoServidor(page);
  await abrirTelaDeTops(page);
  const codigo = codigoTopE2E();
  let id: string | null = null;
  try {
    await page.getByRole("button", { name: "Novo tipo de operação" }).click();
    const forma = page.getByTestId("form-tipo-operacao");

    // ORÇAMENTO: o perfil não usa os padrões — nem a aba nem os campos.
    await escolherTipoNoAssistente(forma, "vendas.orcamento");
    await expect(forma.getByTestId("top-aba-identificacao"), "premissa: as abas do tipo já estão na tela").toBeVisible();
    await expect(forma.getByTestId("top-aba-financeiro"), "premissa: o orçamento tem a aba Financeiro").toHaveCount(1);
    await expect(forma.getByTestId("top-aba-financeiroPadrao"), "o orçamento não usa padrões financeiros").toHaveCount(0);
    await expect(forma.getByTestId("top-padroes-financeiros")).toHaveCount(0);

    // TROCAR → VENDA: a aba existe; a caixa da provisão não (só o pedido provisiona); os cinco padrões sim.
    await forma.getByTestId("top-assistente-trocar").click();
    await escolherTipoNoAssistente(forma, "vendas.venda");
    await forma.getByTestId("top-aba-financeiroPadrao").click();
    await expect(forma.getByTestId("top-secao-financeiro-padrao"), "a aba da seção abriu").toBeVisible();
    await expect(forma.getByTestId("top-campo-financeiroPadrao-provisao"), "a venda não provisiona").toHaveCount(0);
    await expect(forma.getByText(ROTULO_PROVISAO, { exact: true })).toHaveCount(0);
    await expect(forma.getByTestId("top-campo-financeiroPadrao-semClassificacao"), "a venda pode chegar sem natureza e centro").toBeVisible();
    await expect(forma.getByTestId("top-campo-financeiroPadrao-documentoTroca")).toBeVisible();
    for (const t of ["natureza", "centro", "tipo-titulo", "forma", "conta"]) {
      await expect(forma.getByTestId(`top-campo-padrao-${t}`), `a venda usa o padrão ${t}`).toBeVisible();
    }

    // SALVAR SEM MEXER NOS PADRÕES: o POST no 5 sem a chave `padroesFinanceiros` (intocados = não declarados).
    await forma.getByTestId("top-aba-identificacao").click();
    await forma.getByTestId("top-campo-codigo").fill(codigo);
    await forma.getByTestId("top-campo-nome").fill(uniq("Venda PF-2"));
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await post).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "POST 201").toBe(201);
    expect(corpo.codigoBase).toBe("vendas.venda");
    expect(corpo.configuracao?.versaoSchema).toBe(5);
    expect(corpo.configuracao?.financeiroPadrao?.provisao, "a seção no neutro").toBe(false);
    expect(corpo, "os padrões intocados não vão no corpo").not.toHaveProperty("padroesFinanceiros");
    await expect(forma).toBeHidden();
    id = await idDaTopCriada(page, codigo);
    const d = await api<DetalheComPadroes>(page, "GET", `/api/admin/tipos-operacao/${id}`);
    expect(d.padroesFinanceiros, "a versão nasceu sem padrão").toBeNull();
  } finally {
    if (id) await excluirTopE2E(page, id);
  }
});
