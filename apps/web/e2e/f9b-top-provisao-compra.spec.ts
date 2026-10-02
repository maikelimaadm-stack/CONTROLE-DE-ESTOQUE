import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import type { CatalogoTop, ConfiguracaoTipoOperacao } from "@agro/domain";
import { api, login, uniq } from "./helpers";
import {
  abrirTelaDeTops, catalogoPublicadoE2E, cfg5, codigoTopE2E, escolherTipoNoAssistente, excluirTopE2E
} from "./top-config-08-comum";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — A ABA "PADRÕES FINANCEIROS" NAS DUAS FAMÍLIAS DE COMPRAS
 * (OPERACOES-01 F9b, decisão 286 — complemento F9b), PFC-1 e PFC-2.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────────┐
 * │ A integração (`f9b-compra-padroes-top.test.ts`, `f9b-provisao-compra.test.ts`) prova que a API     │
 * │ grava a seção e os padrões nas famílias de compras, recusa a natureza de receita e executa a        │
 * │ provisão do pedido FINALIZADO; o domínio prova o perfil. O que nenhum dos dois alcança é a TELA:    │
 * │ que a aba aparece no editor do pedido de compra e da compra; que a caixa da provisão aparece SÓ no  │
 * │ pedido, com o rótulo e a ajuda da regra da família ("a pagar", "ao finalizar o pedido"), e não com  │
 * │ os do pedido de venda; que "Sem natureza e centro" não aparece em nenhuma das duas (a compra não tem │
 * │ padrão legado); que o que se escolhe sai no corpo do POST e o servidor guarda; e que a recusa da    │
 * │ natureza de receita volta para o campo dela, sem criar nada.                                         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O SERVIDOR É O ÁRBITRO: o corpo que saiu no fio, a resposta e o detalhe da API (`GET /api/admin/tipos-operacao/:id`)
 * decidem, nunca um texto da tela. As premissas também são lidas nele: o bloco `formato5` (as seções e o catálogo
 * publicado), a capacidade `padroesFinanceiros: 1` e os cadastros do seed pelo `/options` (uma natureza de despesa, uma
 * de receita e um centro, analíticos). Os textos da tela e a mensagem da recusa estão escritos POR EXTENSO: copiá-los do
 * componente ou do servidor faria o teste concordar com qualquer coisa que eles dissessem.
 *
 * FIXTURE PRÓPRIA: toda TOP nasce no teste, pela tela, e sai no `finally` pela exclusão lógica da própria API (procurada
 * pelo código, para sair também quando uma asserção falha depois do POST). Nenhuma TOP do seed é tocada.
 */

interface CapacidadesF9b { padroesFinanceiros?: number; formato5?: { secoes: string[] } }
interface OpcaoDoSeletor { id: string; label: string }
interface PadraoNaApi { id: string; nome?: string; codigo?: string }
interface DetalheComPadroes {
  versao: number;
  configuracaoSchema: number;
  padroesFinanceiros: Record<"natureza" | "centro" | "tipoTitulo" | "formaPagamento" | "conta", PadraoNaApi | null> | null;
  configuracao: { valor?: ConfiguracaoTipoOperacao & { financeiroPadrao?: { provisao: boolean; documentoTroca: boolean; semClassificacao: string } } };
}
interface CorpoGravado {
  codigoBase?: string;
  configuracao?: ConfiguracaoTipoOperacao;
  padroesFinanceiros?: Record<string, string | null>;
}
interface CorpoDeErro { error?: { code?: string; message?: string; details?: { recusas?: { caminho?: string; motivo?: string; mensagem?: string }[] } } }

const TEXTOS = {
  /** O rótulo e a ajuda da caixa no PEDIDO DE COMPRA (a regra: a pagar, ao finalizar o pedido). */
  rotuloProvisaoCompra: "Provisionar a pagar ao finalizar o pedido",
  ajudaProvisaoCompra:
    "O pedido finalizado gera títulos previstos a pagar, fora das baixas. A compra confirmada os troca pelos títulos de verdade; encerrar o saldo ou cancelar o pedido os cancela.",
  /** Os do PEDIDO DE VENDA — que NÃO podem aparecer nas famílias de compras. */
  rotuloProvisaoVenda: "Provisionar a receber ao salvar o pedido",
  ajudaProvisaoVenda:
    "O pedido gera títulos previstos, fora das baixas. A venda os troca pelos títulos de verdade; encerrar o saldo ou cancelar o pedido os cancela.",
  /** A ajuda da aba (sem a "1ª por código", que é falsa na compra). */
  ajudaDaAba: "Provisão e padrões do lançamento financeiro desta operação. Tudo nasce desligado: sem padrão, o documento decide, como hoje.",
  semClassificacao: "Sem natureza e centro",
  /** A ajuda do campo da natureza nas famílias de compras (o perfil aceita despesa, ou receita e despesa). */
  ajudaNaturezaDespesa: "Uma natureza analítica e ativa de despesa (ou de receita e despesa).",
  /** A recusa do servidor (422) da natureza padrão de tipo que a família não aceita — a mesma para todo motivo. */
  naturezaInvalida: "Natureza padrão inválida para esta operação: escolha uma natureza analítica, ativa e do tipo da operação.",
  /** A mensagem geral do 422 de configuração, que o editor mostra no erro geral. */
  configuracaoInvalida: "A configuração operacional enviada é inválida"
} as const;

const PADROES = ["natureza", "centro", "tipo-titulo", "forma", "conta"] as const;

const ehPostDeTop = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/admin/tipos-operacao";

/** As premissas do servidor: o editor do 5 com as cinco seções de hoje, a capacidade dos padrões e o catálogo publicado. */
async function premissasDoServidor(page: Page): Promise<CatalogoTop> {
  const catalogo = await catalogoPublicadoE2E(page);
  const c = await api<CapacidadesF9b>(page, "GET", "/api/admin/tipos-operacao/capabilities");
  expect(c.formato5?.secoes, "premissa: as cinco seções de hoje (a F9b não acrescenta seção)").toEqual(["destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
  expect(c.padroesFinanceiros, "premissa: o servidor grava os padrões financeiros da versão").toBe(1);
  return catalogo;
}

/** As abas publicadas de uma família, exigindo o perfil (sem ele não há editor do 5 para ela). */
function abasPublicadas(catalogo: CatalogoTop, familia: string): readonly string[] {
  const perfil = catalogo.perfis.find((p) => p.familia === familia);
  expect(perfil, `premissa: o catálogo publicado tem o perfil de ${familia}`).toBeTruthy();
  return perfil!.abas;
}

/** A 1ª opção ANALÍTICA do cadastro (com o recorte pedido), pela rota do seletor — o que a tela vai oferecer. */
async function opcaoAnalitica(page: Page, recurso: string, extra = ""): Promise<OpcaoDoSeletor> {
  const opcoes = await api<OpcaoDoSeletor[]>(page, "GET", `/api/resources/${recurso}/options?kind=analytic${extra}`);
  expect(opcoes.length, `premissa: o seed tem ${recurso} analítico${extra ? ` (${extra.slice(1)})` : ""}`).toBeGreaterThan(0);
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

/** Abre "Novo tipo de operação", escolhe o tipo pela família no assistente e preenche código e nome. */
async function criarPelaTela(page: Page, familia: string, rotulo: string, codigo: string): Promise<Locator> {
  await abrirTelaDeTops(page);
  await page.getByRole("button", { name: "Novo tipo de operação" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  await escolherTipoNoAssistente(forma, familia);
  await forma.getByTestId("top-campo-codigo").fill(codigo);
  await forma.getByTestId("top-campo-nome").fill(uniq(rotulo));
  return forma;
}

/** As TOPs com este código, pela busca server-side (o código é único por execução). */
async function topsComCodigo(page: Page, codigo: string): Promise<{ id: string; codigo: string }[]> {
  const lista = await api<{ items: { id: string; codigo: string }[] }>(page, "GET", `/api/admin/tipos-operacao?search=${codigo}`);
  return lista.items.filter((x) => x.codigo === codigo);
}

/** Limpeza do `finally`: toda TOP com o código do teste sai (nenhuma, quando o servidor recusou). */
async function excluirPeloCodigo(page: Page, codigo: string): Promise<void> {
  for (const t of await topsComCodigo(page, codigo)) await excluirTopE2E(page, t.id);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * PFC-1 — PEDIDO DE COMPRA: A PROVISÃO A PAGAR AO FINALIZAR, COM A NATUREZA DE DESPESA E O CENTRO PADRÃO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("PFC-1 — Pedido de compra: a aba Padrões financeiros com a caixa 'Provisionar a pagar ao finalizar o pedido' (desligada) e sem 'Sem natureza e centro'; ligada, com natureza de despesa e centro, o POST no 5 leva a seção e os dois padrões e o servidor guarda", async ({ page }) => {
  await login(page);
  const catalogo = await premissasDoServidor(page);
  const abas = abasPublicadas(catalogo, "compras.pedido");
  expect(abas, "premissa: o perfil publicado do pedido de compra tem a aba dos padrões financeiros").toContain("financeiroPadrao");
  expect(abas.indexOf("financeiroPadrao"), "premissa: logo depois do fluxo de compra").toBe(abas.indexOf("fluxoCompra") + 1);
  const natureza = await opcaoAnalitica(page, "financial_categories", "&nature=expense");
  const centro = await opcaoAnalitica(page, "cost_centers");

  const codigo = codigoTopE2E();
  try {
    const forma = await criarPelaTela(page, "compras.pedido", "Pedido de compra PFC-1", codigo);

    // A ABA, com o rótulo e a ajuda de hoje (sem a "1ª por código").
    const aba = forma.getByTestId("top-aba-financeiroPadrao");
    await expect(aba).toHaveText("Padrões financeiros");
    await aba.click();
    await expect(forma.getByTestId("top-secao-financeiro-padrao"), "a aba da seção abriu").toBeVisible();
    await expect(forma.getByText(TEXTOS.ajudaDaAba, { exact: true })).toBeVisible();

    // A CAIXA DA PROVISÃO: desligada (tudo nasce desligado), com o rótulo e a ajuda da REGRA do pedido de compra.
    const provisao = forma.getByTestId("top-campo-financeiroPadrao-provisao");
    await expect(provisao, "o pedido de compra provisiona: a caixa existe").toBeVisible();
    await expect(provisao, "tudo nasce desligado").not.toBeChecked();
    await expect(forma.getByText(TEXTOS.rotuloProvisaoCompra, { exact: true })).toBeVisible();
    await expect(forma.getByText(TEXTOS.ajudaProvisaoCompra, { exact: true })).toBeVisible();
    await expect(provisao, "a ajuda é a descrição da própria caixa").toHaveAccessibleDescription(TEXTOS.ajudaProvisaoCompra);
    await expect(forma.getByText(TEXTOS.rotuloProvisaoVenda, { exact: true }), "nada do pedido de venda").toHaveCount(0);
    await expect(forma.getByText(TEXTOS.ajudaProvisaoVenda, { exact: true }), "nada do pedido de venda").toHaveCount(0);

    // A compra não tem padrão legado: "Sem natureza e centro" não existe aqui, nem com a provisão desligada…
    await expect(forma.getByTestId("top-campo-financeiroPadrao-semClassificacao"), "sem a provisão, a regra não aparece").toHaveCount(0);
    await expect(forma.getByText(TEXTOS.semClassificacao, { exact: true })).toHaveCount(0);
    await expect(forma.getByTestId("top-campo-financeiroPadrao-documentoTroca"), "o documento troca, como hoje").toBeChecked();
    for (const t of PADROES) {
      await expect(forma.getByTestId(`top-campo-padrao-${t}`).getByRole("combobox"), `o padrão ${t} começa vazio`).toContainText("Sem padrão");
    }

    // …nem com ela ligada (no pedido de VENDA, ligar a provisão faz a regra aparecer — PF-1 da F9a).
    await provisao.check();
    await expect(provisao).toBeChecked();
    await expect(forma.getByTestId("top-campo-financeiroPadrao-semClassificacao"), "com a provisão, continua sem a regra").toHaveCount(0);
    await expect(forma.getByText(TEXTOS.semClassificacao, { exact: true })).toHaveCount(0);
    await escolherPadrao(page, forma, "top-campo-padrao-natureza", natureza);
    await escolherPadrao(page, forma, "top-campo-padrao-centro", centro);

    // SALVAR → o POST no 5: o neutro do domínio com SÓ a provisão ligada, e os padrões na chave própria.
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await post).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "POST 201").toBe(201);
    expect(corpo.codigoBase, "a família vem do tipo escolhido").toBe("compras.pedido");
    expect(corpo.configuracao?.versaoSchema, "grava o formato 5").toBe(5);
    expect(corpo.configuracao, "o neutro do 5 com a provisão ligada — nada a mais")
      .toEqual(cfg5({}, (c) => ({ ...c, financeiroPadrao: { ...c.financeiroPadrao, provisao: true } })));
    expect(corpo.padroesFinanceiros, "os padrões vão na chave própria, só os escolhidos").toEqual({
      naturezaId: natureza.id, centroCustoId: centro.id, tipoTituloId: null, formaPagamentoId: null, contaBancariaId: null
    });
    await expect(forma).toBeHidden();

    // O SERVIDOR GUARDOU: a seção (provisão ligada, o resto no neutro) e os dois padrões; a criação é a versão 1, no 5.
    const criadas = await topsComCodigo(page, codigo);
    expect(criadas, "a TOP criada pela tela existe no servidor").toHaveLength(1);
    const d = await api<DetalheComPadroes>(page, "GET", `/api/admin/tipos-operacao/${criadas[0]!.id}`);
    expect([d.versao, d.configuracaoSchema], "versão 1, no formato 5").toEqual([1, 5]);
    expect(d.configuracao.valor?.financeiroPadrao).toEqual({ provisao: true, documentoTroca: true, semClassificacao: "padrao_legado" });
    expect(d.padroesFinanceiros?.natureza?.id, "a natureza de despesa").toBe(natureza.id);
    expect(d.padroesFinanceiros?.centro?.id, "o centro").toBe(centro.id);
    expect([d.padroesFinanceiros?.tipoTitulo, d.padroesFinanceiros?.formaPagamento, d.padroesFinanceiros?.conta], "os outros, vazios")
      .toEqual([null, null, null]);
  } finally {
    await excluirPeloCodigo(page, codigo);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * PFC-2 — COMPRA: A ABA SEM A PROVISÃO; A NATUREZA DE RECEITA É RECUSADA NO CAMPO E NADA É CRIADO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("PFC-2 — Compra: a aba Padrões financeiros sem a caixa da provisão e sem 'Sem natureza e centro'; a natureza de receita como padrão recebe o 422 no campo e nada é criado; com a de despesa, a mesma criação passa", async ({ page }) => {
  await login(page);
  const catalogo = await premissasDoServidor(page);
  expect(abasPublicadas(catalogo, "compras.compra"), "premissa: o perfil publicado da compra tem a aba dos padrões financeiros").toContain("financeiroPadrao");
  const receita = await opcaoAnalitica(page, "financial_categories", "&nature=income");
  const despesa = await opcaoAnalitica(page, "financial_categories", "&nature=expense");

  const codigo = codigoTopE2E();
  try {
    const forma = await criarPelaTela(page, "compras.compra", "Compra PFC-2", codigo);
    expect(await topsComCodigo(page, codigo), "premissa: nenhuma TOP com este código antes de salvar").toEqual([]);

    // A ABA EXISTE (presença antes da ausência): a seção, a troca pelo documento e os cinco padrões.
    await forma.getByTestId("top-aba-financeiroPadrao").click();
    await expect(forma.getByTestId("top-secao-financeiro-padrao"), "a aba da seção abriu").toBeVisible();
    await expect(forma.getByTestId("top-campo-financeiroPadrao-documentoTroca"), "o documento troca, como hoje").toBeChecked();
    for (const t of PADROES) {
      await expect(forma.getByTestId(`top-campo-padrao-${t}`), `a compra usa o padrão ${t}`).toBeVisible();
    }
    // A compra não provisiona (só o pedido) e não tem padrão legado: nem a caixa, nem "Sem natureza e centro".
    await expect(forma.getByTestId("top-campo-financeiroPadrao-provisao"), "a compra não provisiona").toHaveCount(0);
    await expect(forma.getByText(/^Provisionar /), "nenhum rótulo de provisão").toHaveCount(0);
    await expect(forma.getByTestId("top-campo-financeiroPadrao-semClassificacao"), "a compra não tem padrão legado").toHaveCount(0);
    await expect(forma.getByText(TEXTOS.semClassificacao, { exact: true })).toHaveCount(0);

    // PREMISSA: a ajuda do campo diz que a compra aceita natureza DE DESPESA — e a escolhida é de receita.
    await expect(forma.getByTestId("top-campo-padrao-natureza").getByTitle(TEXTOS.ajudaNaturezaDespesa, { exact: true }),
      "a ajuda da natureza pelo perfil da compra").toHaveCount(1);
    await escolherPadrao(page, forma, "top-campo-padrao-natureza", receita);

    // SALVAR → o corpo leva a natureza de receita; o servidor recusa (422) no caminho dela, e só nele.
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const enviado = (await post).postDataJSON() as CorpoGravado;
    expect(enviado.codigoBase).toBe("compras.compra");
    expect(enviado.padroesFinanceiros, "o corpo leva a natureza escolhida").toEqual({
      naturezaId: receita.id, centroCustoId: null, tipoTituloId: null, formaPagamentoId: null, contaBancariaId: null
    });
    const recusada = await resposta;
    expect(recusada.status(), "o servidor recusa").toBe(422);
    const erro = (await recusada.json()) as CorpoDeErro;
    expect(erro.error?.code).toBe("TIPO_OPERACAO_CONFIGURACAO_INVALIDA");
    expect(erro.error?.details?.recusas, "a recusa aponta a natureza padrão, e só ela")
      .toEqual([{ caminho: "padroesFinanceiros.naturezaId", motivo: "valor_invalido", mensagem: TEXTOS.naturezaInvalida }]);

    // A TELA: o editor continua aberto, na aba dos padrões, com a mensagem do servidor DENTRO do campo da natureza.
    await expect(forma, "o editor continua aberto").toBeVisible();
    await expect(forma.getByTestId("top-aba-financeiroPadrao")).toHaveAttribute("aria-selected", "true");
    await expect(forma.getByTestId("top-campo-padrao-natureza"), "a recusa no campo da natureza").toContainText(TEXTOS.naturezaInvalida);
    await expect(forma.getByTestId("top-campo-padrao-centro"), "só no campo que o servidor apontou").not.toContainText("inválid");
    await expect(forma.getByTestId("error-state"), "e no erro geral do editor").toContainText(TEXTOS.configuracaoInvalida);
    expect(await topsComCodigo(page, codigo), "nada foi criado").toEqual([]);

    // A PREMISSA AO LADO DA RECUSA: o MESMO rascunho, só com a natureza de despesa, é criado — o que recusou foi o tipo.
    await escolherPadrao(page, forma, "top-campo-padrao-natureza", despesa);
    const post2 = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    expect((await post2).status(), "com a natureza de despesa, a mesma criação passa").toBe(201);
    await expect(forma).toBeHidden();
    const criadas = await topsComCodigo(page, codigo);
    expect(criadas, "uma TOP só, a da segunda tentativa").toHaveLength(1);
    const d = await api<DetalheComPadroes>(page, "GET", `/api/admin/tipos-operacao/${criadas[0]!.id}`);
    expect([d.versao, d.configuracaoSchema], "a recusa não gastou versão: versão 1, no formato 5").toEqual([1, 5]);
    expect(d.padroesFinanceiros?.natureza?.id, "o servidor guardou a natureza de despesa").toBe(despesa.id);
    expect(d.configuracao.valor?.financeiroPadrao, "a seção no neutro: a compra não provisiona")
      .toEqual({ provisao: false, documentoTroca: true, semClassificacao: "padrao_legado" });
  } finally {
    await excluirPeloCodigo(page, codigo);
  }
});
