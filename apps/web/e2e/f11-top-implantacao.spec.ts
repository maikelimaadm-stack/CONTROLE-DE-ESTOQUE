import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { familiaOperacionalDeDocumentoEstoque, type ConfiguracaoTipoOperacaoV5, type EspecieEstoque } from "@agro/domain";
import { api, login } from "./helpers";
import {
  abrirEditorDaTop, abrirHistoricoDaTop, abrirTelaDeTops, catalogoPublicadoE2E, cfg5, criarTopViaApi, detalheTopNoServidor,
  excluirTopE2E
} from "./top-config-08-comum";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — A ABA "IMPLANTAÇÃO" E O NEUTRO "OPCIONAL" DO DESTINO NO EDITOR DO
 * FORMATO 5 (OPERACOES-01 F11, decisão 288), TI-1 e TI-2.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────────┐
 * │ O domínio (`f11-top-implantacao-destino.test.ts`) prova a seção e o neutro; a integração             │
 * │ (`f5a-top-secoes.test.ts`, FS-0 e FS-2b) prova que a API publica, grava e recusa a seção fora da   │
 * │ entrada. O que eles não alcançam é a TELA: que a aba Implantação aparece SÓ na entrada, com o rótulo │
 * │ e a ajuda da definição; que o que se escolhe nela é o que sai no fio e o que o servidor guarda; que │
 * │ o histórico mostra a linha da seção; e que a saída abre o Destino no neutro novo ("Opcional").      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * FIXTURE PRÓPRIA: toda TOP nasce no teste (pela API, no neutro do 5) e é excluída no `finally`. A família vem do
 * registry, conferida à mão; os rótulos e a ajuda esperados estão escritos AQUI, por extenso.
 */

const AJUDA_IMPLANTACAO =
  "Marque quando esta entrada lança o saldo inicial do estoque (a implantação). O movimento passa a ser \"Estoque inicial\" e o mesmo produto, local de estoque e lote não recebe dois saldos iniciais: o segundo é recusado até o primeiro ser cancelado. No padrão, a entrada é comum.";

const SECOES_DO_5 = ["destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao", "implantacao"];

/** As seis dimensões do destino, na ordem da tela (o pedaço do testid). */
const DIMENSOES = ["centro-custo", "equipamento", "ordem-servico", "lote-animais", "area", "safra"] as const;
const SEIS_OPCIONAIS = {
  centroCusto: "opcional", equipamento: "opcional", ordemServico: "opcional", loteAnimais: "opcional", area: "opcional", safra: "opcional"
} as const;

/** A família da espécie pelo registry, conferida contra o esperado escrito à mão. */
function familiaDe(especie: EspecieEstoque, esperada: string): string {
  const f = familiaOperacionalDeDocumentoEstoque(especie);
  expect(f, `premissa: a família da espécie ${especie} no registry`).toBe(esperada);
  return f!;
}

/** As premissas do servidor: as seções do 5 (com a Implantação) e as abas do perfil publicado do tipo. */
async function premissasDoServidor(page: Page, familia: string, abas: readonly string[]): Promise<void> {
  const c = await api<{ formato5?: { secoes: string[] } }>(page, "GET", "/api/admin/tipos-operacao/capabilities");
  expect(c.formato5?.secoes, "premissa: o servidor lê e grava a seção Implantação (o editor só liga com o mesmo conjunto)").toEqual(SECOES_DO_5);
  const catalogo = await catalogoPublicadoE2E(page);
  expect(catalogo.perfis.find((p) => p.familia === familia)?.abas, `premissa: as abas do perfil publicado de ${familia}`).toEqual(abas);
}

const abasDaTela = (forma: Locator) => forma.locator("[role='tablist'] [data-testid^='top-aba-']");
const ehPutDaTop = (id: string) => (r: Request) => r.method() === "PUT" && new URL(r.url()).pathname === `/api/admin/tipos-operacao/${id}`;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * TI-1 — ENTRADA: A ABA IMPLANTAÇÃO, "NÃO" → "SIM", GRAVADO NO SERVIDOR E NO HISTÓRICO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("TI-1 — Entrada: a aba Implantação começa em 'Não'; 'Lança o saldo inicial: Sim' grava a versão 2 no 5 com implantacao.saldoInicial = true, e o histórico mostra a linha", async ({ page }) => {
  await login(page);
  const familia = familiaDe("entrada", "estoque.entrada");
  await premissasDoServidor(page, familia, ["identificacao", "geral", "estoque", "implantacao", "aprovacao"]);
  const top = await criarTopViaApi(page, familia, cfg5(), { rotulo: "Entrada TI-1" });
  try {
    const antes = await detalheTopNoServidor(page, top.id);
    expect([antes.versao, antes.configuracaoSchema], "premissa: versão 1 no formato 5").toEqual([1, 5]);
    expect((antes.configuracao.valor as ConfiguracaoTipoOperacaoV5).implantacao, "premissa: o servidor guarda a Implantação desligada")
      .toEqual({ saldoInicial: false });

    await abrirTelaDeTops(page);
    const forma = await abrirEditorDaTop(page, top.codigo);
    await expect(abasDaTela(forma), "a Implantação depois de Estoque; sem Destino e Fluxo").toHaveText(["Identificação", "Geral", "Estoque", "Implantação", "Aprovação"]);
    await forma.getByTestId("top-aba-implantacao").click();
    const secao = forma.getByTestId("top-secao-implantacao");
    await expect(secao).toBeVisible();
    await expect(forma.getByText(AJUDA_IMPLANTACAO, { exact: true })).toBeVisible();
    const campo = secao.getByTestId("top-campo-implantacao-saldo-inicial");
    await expect(secao.getByLabel("Lança o saldo inicial", { exact: true }), "o rótulo é o do campo").toHaveAttribute("data-testid", "top-campo-implantacao-saldo-inicial");
    await expect(campo, "o neutro: a entrada é comum").toHaveValue("false");
    expect(await campo.locator("option").allTextContents()).toEqual(["Não", "Sim"]);
    await campo.selectOption({ label: "Sim" });

    const put = page.waitForRequest(ehPutDaTop(top.id));
    const resposta = page.waitForResponse((r) => ehPutDaTop(top.id)(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await put).postDataJSON() as { configuracao?: ConfiguracaoTipoOperacaoV5 };
    expect((await resposta).status(), "PUT 200").toBe(200);
    expect(corpo.configuracao, "o 5 neutro com a Implantação ligada, e mais nada").toEqual(cfg5({}, (c) => ({ ...c, implantacao: { saldoInicial: true } })));
    await expect(forma).toBeHidden();

    const depois = await detalheTopNoServidor(page, top.id);
    expect([depois.versao, depois.configuracaoSchema], "a versão 2, no formato 5").toEqual([2, 5]);
    expect((depois.configuracao.valor as ConfiguracaoTipoOperacaoV5).implantacao, "o servidor guardou a Implantação ligada").toEqual({ saldoInicial: true });

    const versoes = await abrirHistoricoDaTop(page, top.codigo);
    const linha2 = versoes.getByTestId("top-versao-linha").first();
    await expect(linha2).toContainText("Versão 2");
    await expect(linha2).toContainText("Seções alteradas: Implantação");
    await linha2.getByTestId("top-versao-detalhe").click();
    const bloco = linha2.getByTestId("top-versao-secao-implantacao");
    await expect(bloco.locator("dt")).toHaveText(["Lança o saldo inicial"]);
    await expect(bloco.locator("dd")).toHaveText(["Sim"]);
  } finally {
    await excluirTopE2E(page, top.id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * TI-2 — SAÍDA: SEM A ABA IMPLANTAÇÃO; O DESTINO NO NEUTRO NOVO (AS SEIS EM "OPCIONAL")
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("TI-2 — Saída: sem a aba Implantação; a aba Destino abre com as seis dimensões em 'Opcional' (o neutro, F11)", async ({ page }) => {
  await login(page);
  const familia = familiaDe("saida", "estoque.saida");
  await premissasDoServidor(page, familia, ["identificacao", "geral", "estoque", "destino", "aprovacao"]);
  const top = await criarTopViaApi(page, familia, cfg5(), { rotulo: "Saída TI-2" });
  try {
    const regras = await api<{ destino: unknown }>(page, "GET", `/api/estoque/saidas/regras-da-operacao?tipo_operacao_id=${top.id}`);
    expect(regras.destino, "premissa: as regras da operação da MESMA TOP respondem as seis em 'opcional'").toEqual(SEIS_OPCIONAIS);

    await abrirTelaDeTops(page);
    const forma = await abrirEditorDaTop(page, top.codigo);
    await expect(abasDaTela(forma)).toHaveText(["Identificação", "Geral", "Estoque", "Destino", "Aprovação"]);
    await expect(forma.getByTestId("top-aba-implantacao"), "a Implantação é só da entrada").toHaveCount(0);
    await expect(forma.getByTestId("top-secao-implantacao")).toHaveCount(0);
    await forma.getByTestId("top-aba-destino").click();
    const destino = forma.getByTestId("top-secao-destino");
    await expect(destino).toBeVisible();
    for (const d of DIMENSOES) await expect(destino.getByTestId(`top-campo-destino-${d}`), d).toHaveValue("opcional");
  } finally {
    await excluirTopE2E(page, top.id);
  }
});
