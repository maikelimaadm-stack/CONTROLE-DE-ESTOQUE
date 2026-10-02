import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { familiaOperacionalDeDocumentoEstoque, type ConfiguracaoTipoOperacaoV5, type EspecieEstoque } from "@agro/domain";
import { api, login } from "./helpers";
import {
  abrirEditorDaTop, abrirHistoricoDaTop, abrirTelaDeTops, catalogoPublicadoE2E, cfg5, criarTopViaApi, detalheTopNoServidor,
  excluirTopE2E, type TopE2E
} from "./top-config-08-comum";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — AS ABAS "DESTINO" E "FLUXO" DO EDITOR DO FORMATO 5
 * (OPERACOES-01 F5a, decisão 282), E5A-1 a E5A-3.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────────┐
 * │ A integração (`f5a-top-secoes.test.ts`) prova que a API lê, grava, compara e recusa as duas seções │
 * │ — inclusive a seção que o tipo não usa (422) e a leitura estrita. O que ela não alcança é a TELA:   │
 * │ que o editor mostra Destino e Fluxo SÓ nos tipos que as usam (Destino: requisição, consumo e saída;│
 * │ Fluxo: só o consumo), com os rótulos e as opções do domínio; que o que se escolhe nas abas é o que  │
 * │ sai no fio e o que o servidor guarda; que o erro de campo do servidor aparece debaixo do campo, na  │
 * │ aba dele; e que o histórico mostra o bloco de cada seção com as linhas da definição.              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A FAMÍLIA vem do registry (`familiaOperacionalDeDocumentoEstoque`), conferida à mão. O QUE O SERVIDOR GUARDA é lido
 * no detalhe — nunca num texto da tela. Os RÓTULOS, as OPÇÕES e as AJUDAS esperadas estão escritos AQUI, por extenso:
 * o domínio não se aprova sozinho.
 *
 * FIXTURE PRÓPRIA: toda TOP nasce no teste (pela API, no neutro do 5) e é excluída no `finally`. As famílias novas
 * (requisição de material, consumo e devolução de consumo) ainda não têm tela no passo 1 (a F5b liga): por isso a TOP
 * de consumo nasce pela API, e o editor a abre na EDIÇÃO.
 */

const AJUDA = {
  destino:
    "O destino diz para onde vai o que sai do estoque: centro de resultado, máquina/equipamento, ordem de serviço, lote de animais, área/talhão e safra. Cada um pode ser não usado, opcional ou obrigatório nesta operação. Vale para a requisição, o consumo e a saída; o consumo que atende uma requisição leva o destino dela, e a devolução de consumo leva o do consumo.",
  fluxo:
    "O fluxo diz se o consumo precisa vir de uma requisição de material e se pode atender a requisição em parte. No padrão, o consumo pode ser lançado direto e atende em parte."
} as const;

/** As seis dimensões do destino, na ordem da tela: o rótulo, o pedaço do testid e a chave da seção. */
const DIMENSOES = [
  { rotulo: "Centro de resultado", testid: "centro-custo", chave: "centroCusto" },
  { rotulo: "Máquina/equipamento", testid: "equipamento", chave: "equipamento" },
  { rotulo: "Ordem de serviço", testid: "ordem-servico", chave: "ordemServico" },
  { rotulo: "Lote de animais", testid: "lote-animais", chave: "loteAnimais" },
  { rotulo: "Área/talhão", testid: "area", chave: "area" },
  { rotulo: "Safra", testid: "safra", chave: "safra" }
] as const;
const OPCOES_DESTINO = ["Não usada", "Opcional", "Obrigatória"];
const OPCOES_EXIGE_REQUISICAO = ["Não", "Em algum item", "Em todos os itens"];

const NEUTRO_DESTINO = {
  centroCusto: "nao_usada", equipamento: "nao_usada", ordemServico: "nao_usada", loteAnimais: "nao_usada", area: "nao_usada", safra: "nao_usada"
} as const;
const NEUTRO_FLUXO = { exigeRequisicao: "nao", permiteParcial: true } as const;

/** A família da espécie pelo registry, conferida contra o esperado escrito à mão. */
function familiaDe(especie: EspecieEstoque, esperada: string): string {
  const f = familiaOperacionalDeDocumentoEstoque(especie);
  expect(f, `premissa: a família da espécie ${especie} no registry`).toBe(esperada);
  return f!;
}

/** As premissas do servidor: o formato 5 com as duas seções, e o perfil publicado do tipo com as abas esperadas. */
async function premissasDoServidor(page: Page, familia: string, abas: readonly string[]): Promise<void> {
  const c = await api<{ formato5?: { secoes: string[] } }>(page, "GET", "/api/admin/tipos-operacao/capabilities");
  expect(c.formato5?.secoes, "premissa: o servidor lê e grava Destino e Fluxo, com as de compras da F6a e a da F9 (o editor só liga com o mesmo conjunto)").toEqual(["destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
  const catalogo = await catalogoPublicadoE2E(page);
  expect(catalogo.perfis.find((p) => p.familia === familia)?.abas, `premissa: as abas do perfil publicado de ${familia}`).toEqual(abas);
}

/** Os textos das abas, na ordem da tela. */
const abasDaTela = (forma: Locator) => forma.locator("[role='tablist'] [data-testid^='top-aba-']");
const ehPutDaTop = (id: string) => (r: Request) => r.method() === "PUT" && new URL(r.url()).pathname === `/api/admin/tipos-operacao/${id}`;
type CorpoGravado = { configuracao?: ConfiguracaoTipoOperacaoV5 };

/** As opções de um `<select>`, pelo texto. */
const textosDasOpcoes = (select: Locator) => select.locator("option").allTextContents();

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E5A-1 — CONSUMO: AS DUAS ABAS, A EDIÇÃO, O ERRO DE CAMPO DO SERVIDOR E A GRAVAÇÃO CONFERIDA NO SERVIDOR
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E5A-1 — Consumo: abas Destino e Fluxo com os rótulos e as opções do domínio; o erro de campo do servidor aparece debaixo do campo; 'Centro de resultado: Obrigatória' e 'Exigir requisição: Em todos os itens' gravam a versão 2 no 5", async ({ page }) => {
  await login(page);
  const familia = familiaDe("consumo", "estoque.consumo");
  await premissasDoServidor(page, familia, ["identificacao", "geral", "estoque", "destino", "fluxo", "aprovacao"]);
  const top = await criarTopViaApi(page, familia, cfg5(), { rotulo: "Consumo E5A-1" });
  try {
    const antes = await detalheTopNoServidor(page, top.id);
    expect([antes.versao, antes.configuracaoSchema], "premissa: versão 1 no formato 5").toEqual([1, 5]);
    const valorAntes = antes.configuracao.valor as ConfiguracaoTipoOperacaoV5;
    expect([valorAntes.destino, valorAntes.fluxo], "premissa: as duas no neutro").toEqual([NEUTRO_DESTINO, NEUTRO_FLUXO]);

    await abrirTelaDeTops(page);
    const forma = await abrirEditorDaTop(page, top.codigo);
    await expect(abasDaTela(forma), "Destino e Fluxo depois de Estoque").toHaveText(["Identificação", "Geral", "Estoque", "Destino", "Fluxo", "Aprovação"]);

    // DESTINO: a ajuda da definição, as seis dimensões na ordem, "Não usada" em todas, as três opções.
    await forma.getByTestId("top-aba-destino").click();
    const destino = forma.getByTestId("top-secao-destino");
    await expect(destino).toBeVisible();
    await expect(forma.getByText(AJUDA.destino, { exact: true })).toBeVisible();
    await expect(destino.locator("select"), "um campo por dimensão").toHaveCount(DIMENSOES.length);
    for (const d of DIMENSOES) {
      const campo = destino.getByTestId(`top-campo-destino-${d.testid}`);
      await expect(destino.getByLabel(d.rotulo, { exact: true }), `o rótulo "${d.rotulo}" é o do campo`).toHaveAttribute("data-testid", `top-campo-destino-${d.testid}`);
      await expect(campo).toHaveValue("nao_usada");
      expect(await textosDasOpcoes(campo)).toEqual(OPCOES_DESTINO);
    }
    await destino.getByTestId("top-campo-destino-centro-custo").selectOption({ label: "Obrigatória" });

    // FLUXO: a ajuda, "Exigir requisição: Não" e "Atender requisição em parte: Sim".
    await forma.getByTestId("top-aba-fluxo").click();
    const fluxo = forma.getByTestId("top-secao-fluxo");
    await expect(fluxo).toBeVisible();
    await expect(forma.getByText(AJUDA.fluxo, { exact: true })).toBeVisible();
    const exige = fluxo.getByTestId("top-campo-fluxo-exige-requisicao");
    const parcial = fluxo.getByTestId("top-campo-fluxo-permite-parcial");
    await expect(fluxo.getByLabel("Exigir requisição", { exact: true })).toHaveAttribute("data-testid", "top-campo-fluxo-exige-requisicao");
    await expect(fluxo.getByLabel("Atender requisição em parte", { exact: true })).toHaveAttribute("data-testid", "top-campo-fluxo-permite-parcial");
    await expect(exige).toHaveValue("nao");
    expect(await textosDasOpcoes(exige)).toEqual(OPCOES_EXIGE_REQUISICAO);
    await expect(parcial).toHaveValue("true");
    expect(await textosDasOpcoes(parcial)).toEqual(["Não", "Sim"]);
    await exige.selectOption({ label: "Em todos os itens" });

    // O rascunho sobrevive à troca de aba.
    await forma.getByTestId("top-aba-destino").click();
    await expect(forma.getByTestId("top-campo-destino-centro-custo")).toHaveValue("obrigatoria");

    // A RECUSA DE CAMPO (UMA instância divergente, como no W4c: a resposta é a ÚNICA coisa fabricada aqui — o servidor
    // deste E2E aceita estes valores, e as recusas reais estão provadas em `f5a-top-secoes.test.ts`): cada mensagem
    // aparece debaixo do SEU campo, e a aba do primeiro caminho abre.
    const msgDestino = "O centro de resultado desta operação foi recusado pelo servidor.";
    const msgFluxo = "A exigência de requisição desta operação foi recusada pelo servidor.";
    await page.route(`**/api/admin/tipos-operacao/${top.id}`, async (rota) => {
      if (rota.request().method() !== "PUT") return rota.fallback();
      await rota.fulfill({ status: 422, json: { error: { code: "TIPO_OPERACAO_CONFIGURACAO_INVALIDA", message: "A configuração operacional enviada é inválida",
        details: { recusas: [
          { motivo: "combinacao_nao_suportada", caminho: "destino.centroCusto", mensagem: msgDestino },
          { motivo: "combinacao_nao_suportada", caminho: "fluxo.exigeRequisicao", mensagem: msgFluxo }
        ] } } } });
    });
    await forma.getByTestId("top-aba-identificacao").click();
    await page.getByTestId("top-salvar").click();
    await expect(forma.getByTestId("top-secao-destino"), "a aba do primeiro caminho (Destino) abre").toBeVisible();
    await expect(forma.getByTestId("top-erro-destino-centro-custo")).toHaveText(msgDestino);
    await forma.getByTestId("top-aba-fluxo").click();
    await expect(forma.getByTestId("top-erro-fluxo-exige-requisicao")).toHaveText(msgFluxo);
    await expect(forma.getByTestId("top-erro-fluxo-permite-parcial"), "só o campo recusado").toHaveCount(0);
    expect((await detalheTopNoServidor(page, top.id)).versao, "a recusa não grava").toBe(1);
    await page.unroute(`**/api/admin/tipos-operacao/${top.id}`);

    // SALVAR (o servidor de verdade): o corpo no fio é o neutro do 5 com as duas escolhas, e mais nada.
    const put = page.waitForRequest(ehPutDaTop(top.id));
    const resposta = page.waitForResponse((r) => ehPutDaTop(top.id)(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await put).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "PUT 200").toBe(200);
    const esperado = cfg5({}, (c) => ({ ...c, destino: { ...c.destino, centroCusto: "obrigatoria" }, fluxo: { ...c.fluxo, exigeRequisicao: "todos" } }));
    expect(corpo.configuracao, "o 5 com as duas escolhas, o resto no neutro").toEqual(esperado);
    await expect(forma).toBeHidden();

    const depois = await detalheTopNoServidor(page, top.id);
    expect([depois.versao, depois.configuracaoSchema], "a versão 2, no formato 5").toEqual([2, 5]);
    const valor = depois.configuracao.valor as ConfiguracaoTipoOperacaoV5;
    expect(valor.destino, "o servidor guardou o Destino").toEqual({ ...NEUTRO_DESTINO, centroCusto: "obrigatoria" });
    expect(valor.fluxo, "e o Fluxo").toEqual({ exigeRequisicao: "todos", permiteParcial: true });
  } finally {
    await page.unroute(`**/api/admin/tipos-operacao/${top.id}`);
    await excluirTopE2E(page, top.id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E5A-2 — SAÍDA SÓ COM DESTINO; ENTRADA SEM AS DUAS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E5A-2 — Saída: aba Destino sem Fluxo, e 'Máquina/equipamento: Opcional' grava com o Fluxo no neutro; Entrada: nenhuma das duas", async ({ page }) => {
  await login(page);
  const familiaSaida = familiaDe("saida", "estoque.saida");
  const familiaEntrada = familiaDe("entrada", "estoque.entrada");
  await premissasDoServidor(page, familiaSaida, ["identificacao", "geral", "estoque", "destino", "aprovacao"]);
  await premissasDoServidor(page, familiaEntrada, ["identificacao", "geral", "estoque", "aprovacao"]);
  const tops: TopE2E[] = [];
  try {
    const saida = await criarTopViaApi(page, familiaSaida, cfg5(), { rotulo: "Saída E5A-2" });
    tops.push(saida);
    const entrada = await criarTopViaApi(page, familiaEntrada, cfg5(), { rotulo: "Entrada E5A-2" });
    tops.push(entrada);

    await abrirTelaDeTops(page);
    // SAÍDA: Destino, sem Fluxo.
    const forma = await abrirEditorDaTop(page, saida.codigo);
    await expect(abasDaTela(forma)).toHaveText(["Identificação", "Geral", "Estoque", "Destino", "Aprovação"]);
    await expect(forma.getByTestId("top-aba-fluxo"), "o Fluxo é só do consumo").toHaveCount(0);
    await forma.getByTestId("top-aba-destino").click();
    const destino = forma.getByTestId("top-secao-destino");
    await expect(forma.getByText(AJUDA.destino, { exact: true })).toBeVisible();
    for (const d of DIMENSOES) await expect(destino.getByTestId(`top-campo-destino-${d.testid}`)).toHaveValue("nao_usada");
    await destino.getByTestId("top-campo-destino-equipamento").selectOption({ label: "Opcional" });
    const put = page.waitForRequest(ehPutDaTop(saida.id));
    const resposta = page.waitForResponse((r) => ehPutDaTop(saida.id)(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await put).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "PUT 200").toBe(200);
    expect(corpo.configuracao, "o Destino escolhido; o Fluxo, que a saída não mostra, vai no neutro")
      .toEqual(cfg5({}, (c) => ({ ...c, destino: { ...c.destino, equipamento: "opcional" } })));
    await expect(forma).toBeHidden();
    const d = await detalheTopNoServidor(page, saida.id);
    expect([d.versao, d.configuracaoSchema]).toEqual([2, 5]);
    expect((d.configuracao.valor as ConfiguracaoTipoOperacaoV5).destino).toEqual({ ...NEUTRO_DESTINO, equipamento: "opcional" });

    // ENTRADA: nenhuma das duas.
    const formaEntrada = await abrirEditorDaTop(page, entrada.codigo);
    await expect(abasDaTela(formaEntrada)).toHaveText(["Identificação", "Geral", "Estoque", "Aprovação"]);
    await expect(formaEntrada.getByTestId("top-aba-destino")).toHaveCount(0);
    await expect(formaEntrada.getByTestId("top-aba-fluxo")).toHaveCount(0);
    await expect(formaEntrada.getByTestId("top-secao-destino")).toHaveCount(0);
  } finally {
    for (const t of tops) await excluirTopE2E(page, t.id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * E5A-3 — O HISTÓRICO: O BLOCO DE CADA SEÇÃO, COM AS LINHAS DA DEFINIÇÃO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("E5A-3 — o histórico do consumo mostra 'Seções alteradas: Destino, Fluxo' e os blocos Destino ('Centro de resultado: Obrigatória') e Fluxo ('Exigir requisição: Em todos os itens')", async ({ page }) => {
  await login(page);
  const familia = familiaDe("consumo", "estoque.consumo");
  await premissasDoServidor(page, familia, ["identificacao", "geral", "estoque", "destino", "fluxo", "aprovacao"]);
  const top = await criarTopViaApi(page, familia, cfg5(), { rotulo: "Consumo E5A-3" });
  try {
    // A versão 2 pela API: as duas seções mudam.
    const v1 = await detalheTopNoServidor(page, top.id);
    await api(page, "PUT", `/api/admin/tipos-operacao/${top.id}`, {
      revisao: v1.revisao,
      configuracao: cfg5({}, (c) => ({ ...c, destino: { ...c.destino, centroCusto: "obrigatoria" }, fluxo: { exigeRequisicao: "todos", permiteParcial: false } }))
    });
    const v2 = await detalheTopNoServidor(page, top.id);
    expect([v2.versao, v2.configuracaoSchema], "premissa: a versão 2 no formato 5").toEqual([2, 5]);

    await abrirTelaDeTops(page);
    const versoes = await abrirHistoricoDaTop(page, top.codigo);
    const linhas = versoes.getByTestId("top-versao-linha");
    await expect(linhas).toHaveCount(2);
    const linha2 = linhas.first();
    await expect(linha2).toContainText("Versão 2");
    await expect(linha2).toContainText("Formato da configuração: 5");
    await expect(linha2).toContainText("Seções alteradas: Destino, Fluxo");
    await linha2.getByTestId("top-versao-detalhe").click();

    const blocoDestino = linha2.getByTestId("top-versao-secao-destino");
    await expect(blocoDestino).toContainText("Destino");
    await expect(blocoDestino.locator("dt")).toHaveText(DIMENSOES.map((d) => d.rotulo));
    await expect(blocoDestino.locator("dd")).toHaveText(["Obrigatória", "Não usada", "Não usada", "Não usada", "Não usada", "Não usada"]);
    const blocoFluxo = linha2.getByTestId("top-versao-secao-fluxo");
    await expect(blocoFluxo).toContainText("Fluxo");
    await expect(blocoFluxo.locator("dt")).toHaveText(["Exigir requisição", "Atender requisição em parte"]);
    await expect(blocoFluxo.locator("dd")).toHaveText(["Em todos os itens", "Não"]);
  } finally {
    await excluirTopE2E(page, top.id);
  }
});
