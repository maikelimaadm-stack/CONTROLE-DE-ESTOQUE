import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { configuracaoNeutraTopV2, type ConfiguracaoTipoOperacao } from "@agro/domain";
import { api, login, uniq } from "./helpers";
import {
  abrirEditorDaTop, abrirHistoricoDaTop, abrirTelaDeTops, catalogoPublicadoE2E, cfg3, cfg4, codigoTopE2E, criarTopViaApi,
  detalheTopNoServidor, escolherTipoNoAssistente, excluirTopE2E, type TopE2E
} from "./top-config-08-comum";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — O EDITOR NO FORMATO 4: REGRAS GERAIS E APROVAÇÃO (TOP-CONFIG-08,
 * decisão 277), W-1 e W-2.
 *
 * OPERACOES-01 F4 (decisão 281): o servidor deste HEAD declara também o formato 5, e o editor passa a ser o DO 5 — as
 * regras gerais e a aprovação são as mesmas do 4 (o 5 é o 4 + as seções de extensão), mas a gravação sai no formato 5,
 * as abas são as do perfil do tipo (Execução some onde o tipo não aceita execução configurada) e a ajuda da Geral diz
 * que as Centrais aceitam o documento sem item quando a TOP permite. As TOPs que estes casos criam pela API continuam
 * no formato 4 (ou 3, ou 2): o que se mede é o editor do 5 lendo e regravando o que já existe. O editor do 4 (o de
 * antes, contra um servidor sem o formato 5) é medido no K-1 (`top-config-08-skew-api-producao.spec.ts`).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────────┐
 * │ A integração prova que a API grava o formato 4 e recusa (422) a regra que a família não aceita. O   │
 * │ que ela não alcança é a promessa da TELA: que o editor, diante do bloco `regrasGerais` do servidor, │
 * │ mostra a cada família SÓ o que ela executa (a matriz que o servidor publicou, nunca uma cópia), diz │
 * │ POR QUE a opção desabilitada não vale, troca os textos que diziam "não executa" — e que salvar      │
 * │ produz, no servidor, a versão nova NO FORMATO 4. E que a TOP de pedido de compra de produção        │
 * │ (formato 3 com Automática, Permitido e Permitida) não perde essas regras em silêncio: o diálogo     │
 * │ "Estas regras passam a valer" diz o que volta ao padrão ANTES de gravar.                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * FIXTURE PRÓPRIA: toda TOP nasce aqui, pela API (`top-config-08-comum.ts`), com a configuração montada a partir do
 * NEUTRO do domínio. Nenhuma TOP do seed é tocada. No `finally`, a exclusão lógica da própria API: uma TOP de venda
 * com Automática que sobrasse no lançador confirmaria sozinha a venda de quem viesse depois.
 *
 * A VERSÃO, O FORMATO E O CONTEÚDO SÃO CONFERIDOS PELO SERVIDOR (`GET /api/admin/tipos-operacao/:id`) e pelo corpo que
 * saiu no fio — nunca por um texto da tela. "A tela mostra Automática" e "a versão 2 está no formato 4 com
 * Automática" são perguntas diferentes, e só a segunda diz que a regra executa.
 */

/**
 * OS TEXTOS DO EDITOR COM O BLOCO (SPEC §8), escritos por extenso: a tela tem de dizer ISTO, letra por letra. Copiá-los
 * do componente faria o teste concordar com qualquer coisa que o componente dissesse.
 */
const TEXTOS = {
  /**
   * A ajuda da Geral do EDITOR DO 5 (decisão 281; item 4 do coordenador da F4): quando a TOP permite, as Centrais de
   * Vendas, de Compras e de Estoque aceitam o documento sem item. Só a frase do documento sem itens mudou.
   */
  ajudaGeral:
    "Confirmação automática: o documento é confirmado ao ser salvo, por quem salvou e com a mesma conferência da confirmação manual. Se a confirmação recusar, o documento fica salvo e aberto, e o motivo aparece ao confirmar. Documento sem itens: quando esta operação permite, as Centrais de Vendas, de Compras e de Estoque aceitam o documento sem item. As exigências de preenchimento são cobradas no lançamento.",
  /** O trecho que só a ajuda ANTIGA (a do editor do 4) tem: PROIBIDO na tela do editor do 5. */
  ajudaGeralAntiga: "o lançamento ainda pede ao menos um item",
  ajudaAprovacao:
    "Com aprovação, o documento só é confirmado depois de aprovado em Aprovações, por quem tem a permissão Aprovar. Alterar a venda depois de aprovada pede uma aprovação nova.",
  ajudaGeralEstoque: "No documento de estoque valem a confirmação automática e a observação obrigatória.",
  /** As três frases do aviso: as duas primeiras são as de hoje; SÓ a última muda com o bloco. */
  avisoVersionamento:
    "O que você definir aqui é guardado e versionado: cada gravação cria uma versão nova e as anteriores continuam legíveis no histórico. Estoque e financeiro só seguem esta configuração quando a aba Execução diz \"Usar configuração da TOP\", e isso vale para os documentos criados a partir da versão salva. O fiscal continua registrando a intenção da operação, sem executá-la.",
  execucaoDeclarativo:
    "Preparado, ainda não executado: o fiscal. Ele fica registrado nesta versão, mas nada o executa nesta etapa do produto.",
  /** O motivo da matriz (SPEC §2) ao lado da opção "A partir de um valor" desabilitada no estoque. */
  motivoAprovacaoPorValorEstoque: "O valor do documento de estoque só é conhecido na confirmação: use \"Sempre\".",
  historicoExecutadas: "Regras gerais e aprovação: executadas",
  historicoRegistradas: "Regras gerais e aprovação: registradas, sem execução"
} as const;

/** Os três campos de `geral` que a matriz controla, pelo `data-testid` do editor. */
const CAMPO = {
  confirmacao: "top-campo-geral-confirmacao",
  semItens: "top-campo-geral-sem-itens",
  alteracao: "top-campo-geral-alteracao",
  aprovacao: "top-campo-aprovacao-politica"
} as const;

/** Escritas na TOP: é o que NÃO pode sair enquanto o administrador ainda está decidindo. */
const ehEscritaDeTop = (r: Request) =>
  ["POST", "PUT", "PATCH"].includes(r.method()) && new URL(r.url()).pathname.startsWith("/api/admin/tipos-operacao");

/** O PUT da edição desta TOP — o que de fato foi pedido ao servidor. */
const ehPutDaTop = (id: string) => (r: Request) =>
  r.method() === "PUT" && new URL(r.url()).pathname === `/api/admin/tipos-operacao/${id}`;

/** O corpo da gravação, só nas chaves que este arquivo confere. */
interface CorpoGravado { configuracao?: ConfiguracaoTipoOperacao }

/** A configuração que o servidor devolveu no detalhe, já exigida legível (sem ela não há o que conferir). */
async function configuracaoNoServidor(page: Page, id: string) {
  const d = await detalheTopNoServidor(page, id);
  expect(d.configuracao.suportada, "o servidor lê a versão que ele mesmo gravou").toBe(true);
  return { versao: d.versao, schema: d.configuracaoSchema, valor: d.configuracao.valor! };
}

/** As opções de um `<select>` do editor: o valor e se está habilitada — o que o administrador pode ESCOLHER. */
async function opcoesDoCampo(campo: Locator): Promise<Record<string, boolean>> {
  return campo.locator("option").evaluateAll((os) =>
    Object.fromEntries(os.map((o) => [(o as HTMLOptionElement).value, !(o as HTMLOptionElement).disabled])));
}

/** A linha "Seções alteradas" de uma versão do histórico. */
const secoesDaVersao = (linha: Locator) => linha.locator("p", { hasText: "Seções alteradas:" });

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * W-1 — CADA FAMÍLIA VÊ SÓ O QUE EXECUTA; OS TEXTOS NOVOS; SALVAR GRAVA O FORMATO 4; O HISTÓRICO DIZ "EXECUTADAS"
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("W-1 — venda gravada no formato 4: Confirmação, Documento sem itens e a aba Aprovação, sem Alteração; os textos novos; Automática grava a versão 2 no formato 5 e o histórico diz 'executadas'", async ({ page }) => {
  await login(page);
  const top = await criarTopViaApi(page, "vendas.venda", cfg4(), { rotulo: "Venda W-1" });
  try {
    const antes = await configuracaoNoServidor(page, top.id);
    expect(antes.versao, "premissa: a TOP nasce na versão 1").toBe(1);
    expect(antes.schema, "premissa: no formato 4").toBe(4);
    expect(antes.valor.geral.confirmacao, "premissa: no neutro (Manual)").toBe("manual");

    await abrirTelaDeTops(page);
    const forma = await abrirEditorDaTop(page, top.codigo);

    // O AVISO: as três frases, e só a última trocada (as duas primeiras ficam letra por letra).
    await expect(forma.getByTestId("top-aviso-versionamento")).toHaveText(TEXTOS.avisoVersionamento);

    // GERAL — a ajuda nova; Confirmação e Documento sem itens com TODAS as opções; Alteração escondida (a venda só aceita Bloqueada).
    await forma.getByTestId("top-aba-geral").click();
    await expect(forma.getByText(TEXTOS.ajudaGeral, { exact: true }), "a ajuda da Geral diz que a confirmação automática EXECUTA e que as Centrais aceitam o documento sem item").toBeVisible();
    await expect(forma.getByText(TEXTOS.ajudaGeralAntiga), "a ajuda do editor do 4 (as Centrais ainda pedem um item) não aparece").toHaveCount(0);
    const confirmacao = forma.getByTestId(CAMPO.confirmacao);
    await expect(confirmacao).toHaveValue("manual");
    expect(await opcoesDoCampo(confirmacao), "a venda aceita Manual e Automática").toEqual({ manual: true, automatica: true });
    const semItens = forma.getByTestId(CAMPO.semItens);
    await expect(semItens).toHaveValue("proibido");
    expect(await opcoesDoCampo(semItens), "a venda aceita Proibido e Permitido").toEqual({ proibido: true, permitido: true });
    await expect(forma.getByTestId(CAMPO.alteracao), "Alteração após confirmar: a venda só aceita o neutro, o campo some").toHaveCount(0);
    await expect(forma.locator("[data-testid^='top-regra-motivo-']"), "nenhuma opção indisponível, nenhum motivo").toHaveCount(0);

    // APROVAÇÃO — a aba inteira, com as três políticas.
    await forma.getByTestId("top-aba-aprovacao").click();
    await expect(forma.getByText(TEXTOS.ajudaAprovacao, { exact: true }), "a ajuda da Aprovação diz onde e por quem se aprova").toBeVisible();
    expect(await opcoesDoCampo(forma.getByTestId(CAMPO.aprovacao)), "a venda aceita as três políticas")
      .toEqual({ nenhuma: true, sempre: true, por_valor: true });
    await expect(forma.locator("[data-testid^='top-regra-motivo-']")).toHaveCount(0);

    // EXECUÇÃO — sobra só o fiscal como "preparado, ainda não executado".
    await forma.getByTestId("top-aba-execucao").click();
    await expect(forma.getByTestId("top-execucao-declarativo")).toHaveText(TEXTOS.execucaoDeclarativo);

    // SALVAR COM AUTOMÁTICA — a versão vigente já é formato 4 (as regras já executam): nada "passa a valer" (é uma
    // edição comum), sem diálogo — o 4 lido como 5 não muda o que executa.
    await forma.getByTestId("top-aba-geral").click();
    await confirmacao.selectOption("automatica");
    const put = page.waitForRequest(ehPutDaTop(top.id));
    const resposta = page.waitForResponse((r) => ehPutDaTop(top.id)(r.request()));
    await forma.getByTestId("top-salvar").click();
    const corpo = (await put).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "PUT 200").toBe(200);
    expect(corpo.configuracao?.versaoSchema, "o corpo enviado é o formato 5").toBe(5);
    expect(corpo.configuracao?.geral.confirmacao, "com Automática").toBe("automatica");
    await expect(page.getByTestId("top-regras-passam-a-valer"), "edição de uma versão já no formato 4 não pergunta").toHaveCount(0);
    await expect(forma).toBeHidden();

    /**
     * O SERVIDOR É O ÁRBITRO. Formato e regra conferidos um a um — "existe a versão 2" passaria com a versão gravada no
     * formato 3, que é exatamente o rebaixamento silencioso que faria a Automática nunca executar.
     */
    const depois = await configuracaoNoServidor(page, top.id);
    expect(depois.versao, "regra geral é conteúdo: versão nova").toBe(2);
    expect(depois.schema, "a versão nova é do formato 5 (a coluna)").toBe(5);
    expect(depois.valor.versaoSchema, "e o payload também").toBe(5);
    expect(depois.valor.geral.confirmacao, "Automática").toBe("automatica");
    expect(depois.valor.geral.documentoSemItens, "o resto continua no neutro").toBe("proibido");
    expect(depois.valor.geral.alteracaoAposConfirmacao).toBe("bloqueada");
    expect(depois.valor.aprovacao.politica).toBe("nenhuma");

    // HISTÓRICO — a versão 2 diz que executa; a 1 (neutra) não diz nada (a linha só aparece com regra fora do neutro).
    const versoes = await abrirHistoricoDaTop(page, top.codigo);
    const linhas = versoes.getByTestId("top-versao-linha");
    await expect(linhas, "duas gravações, duas versões").toHaveCount(2);
    const v2 = linhas.nth(0); const v1 = linhas.nth(1);
    await expect(v2).toContainText("Versão 2");
    await expect(v2).toContainText("Formato da configuração: 5");
    await expect(v2.getByTestId("top-historico-regras-executadas")).toHaveText(TEXTOS.historicoExecutadas);
    await expect(v2.getByTestId("top-historico-regras-registradas")).toHaveCount(0);
    await expect(secoesDaVersao(v2)).toHaveText("Seções alteradas: Geral");
    await expect(v1).toContainText("Versão 1");
    await expect(v1.getByTestId("top-historico-regras-executadas"), "a versão 1 estava no neutro").toHaveCount(0);
    await expect(v1.getByTestId("top-historico-regras-registradas")).toHaveCount(0);
  } finally {
    await excluirTopE2E(page, top.id);
  }
});

test("W-1 — orçamento, pedido de venda e pedido de compra: Confirmação, Documento sem itens, Alteração e a aba Execução escondidos; a aba Aprovação some nos dois de venda e aparece no pedido de compra, com as três políticas (decisão 283)", async ({ page }) => {
  await login(page);
  // A PREMISSA NO SERVIDOR: nenhum dos três tem execução configurada no perfil que ele publica (a aba não decidiria nada).
  const catalogo = await catalogoPublicadoE2E(page);
  /** O rótulo do parceiro no documento de cada tipo — o que o editor do 5 mostra na Geral ("Exigir cliente"…). */
  const PARCEIRO_DO_TIPO: Readonly<Record<string, string>> = { "vendas.orcamento": "Exigir cliente", "vendas.pedido": "Exigir cliente", "compras.pedido": "Exigir fornecedor" };
  /**
   * A aba Aprovação, por tipo. OPERACOES-01 F6a (decisão 283): o pedido de compra passa a ser aprovado ao FINALIZAR — a
   * matriz aceita as três políticas nele, e a aba aparece. O orçamento e o pedido de venda continuam só com "Sem
   * aprovação": a aba some.
   */
  const MOSTRA_APROVACAO: Readonly<Record<string, boolean>> = { "vendas.orcamento": false, "vendas.pedido": false, "compras.pedido": true };
  const tops: TopE2E[] = [];
  try {
    for (const codigoBase of ["vendas.orcamento", "vendas.pedido", "compras.pedido"]) {
      const perfil = catalogo.perfis.find((p) => p.familia === codigoBase);
      expect(perfil?.abas, `premissa: o perfil publicado de ${codigoBase} não tem a aba Execução`).not.toContain("execucao");
      expect(perfil?.abas, `premissa: e tem Próximas operações`).toContain("destinos");
      expect(perfil?.abas.includes("aprovacao"), `premissa: o perfil publicado de ${codigoBase} ${MOSTRA_APROVACAO[codigoBase] ? "tem" : "não tem"} a aba Aprovação`)
        .toBe(MOSTRA_APROVACAO[codigoBase]);
      tops.push(await criarTopViaApi(page, codigoBase, cfg4(), { rotulo: `W-1 ${codigoBase}` }));
    }
    await abrirTelaDeTops(page);
    for (const top of tops) {
      const forma = await abrirEditorDaTop(page, top.codigo);
      // PRESENÇA ANTES DA AUSÊNCIA: o editor do formato 5 montou (o aviso com a última frase nova, a ajuda nova e o
      // parceiro com o rótulo do tipo) e a Geral existe — as exigências de preenchimento continuam valendo para estes
      // documentos.
      await expect(forma.getByTestId("top-aviso-versionamento"), `${top.codigoBase}: o aviso do editor com as regras gerais`).toHaveText(TEXTOS.avisoVersionamento);
      await forma.getByTestId("top-aba-geral").click();
      await expect(forma.getByTestId("top-campo-geral-observacao"), `${top.codigoBase}: a Geral abriu`).toBeVisible();
      await expect(forma.getByLabel(PARCEIRO_DO_TIPO[top.codigoBase]!, { exact: true }), `${top.codigoBase}: o editor é o do 5 (o rótulo do tipo)`)
        .toHaveAttribute("data-testid", "top-campo-geral-parceiro");
      await expect(forma.getByText(TEXTOS.ajudaGeral, { exact: true }), `${top.codigoBase}: a ajuda da Geral do editor do 5`).toBeVisible();
      for (const campo of [CAMPO.confirmacao, CAMPO.semItens, CAMPO.alteracao]) {
        await expect(forma.getByTestId(campo), `${top.codigoBase}: ${campo} some (a família só aceita o neutro)`).toHaveCount(0);
      }
      await expect(forma.locator("[data-testid^='top-regra-motivo-']"), `${top.codigoBase}: campo escondido não deixa motivo solto`).toHaveCount(0);
      if (MOSTRA_APROVACAO[top.codigoBase]) {
        // O PEDIDO DE COMPRA MOSTRA A APROVAÇÃO: a aba inteira, no neutro do 4, com as três políticas habilitadas e
        // nenhum motivo de opção indisponível.
        await forma.getByTestId("top-aba-aprovacao").click();
        const politica = forma.getByTestId(CAMPO.aprovacao);
        await expect(politica, `${top.codigoBase}: a aba Aprovação aparece, no neutro`).toHaveValue("nenhuma");
        expect(await opcoesDoCampo(politica), `${top.codigoBase}: as três políticas`).toEqual({ nenhuma: true, sempre: true, por_valor: true });
        await expect(forma.locator("[data-testid^='top-regra-motivo-']"), `${top.codigoBase}: nenhuma opção indisponível, nenhum motivo`).toHaveCount(0);
      } else {
        await expect(forma.getByTestId("top-aba-aprovacao"), `${top.codigoBase}: a aba Aprovação some`).toHaveCount(0);
      }
      await expect(forma.getByTestId("top-aba-execucao"), `${top.codigoBase}: a aba Execução some (o tipo não aceita execução configurada)`).toHaveCount(0);
      await expect(forma.getByTestId("top-aba-destinos"), `${top.codigoBase}: as outras abas continuam`).toBeVisible();
      await forma.getByTestId("top-cancelar").click();
      await expect(forma, "sem alteração, fechar não pergunta nada").toBeHidden();
    }
  } finally {
    for (const t of tops) await excluirTopE2E(page, t.id);
  }
});

test("W-1 — as quatro espécies de estoque: Confirmação e a aba Aprovação (sem Execução), com 'A partir de um valor' desabilitada e o motivo da matriz ao lado", async ({ page }) => {
  await login(page);
  const tops: TopE2E[] = [];
  try {
    for (const especie of ["entrada", "saida", "transferencia", "ajuste"]) {
      tops.push(await criarTopViaApi(page, `estoque.${especie}`, cfg4(), { rotulo: `W-1 estoque ${especie}` }));
    }
    await abrirTelaDeTops(page);
    for (const top of tops) {
      const forma = await abrirEditorDaTop(page, top.codigo);
      await expect(forma.getByTestId("top-aviso-versionamento")).toHaveText(TEXTOS.avisoVersionamento);

      // GERAL — a ajuda do estoque com o bloco; Confirmação com as duas opções; sem itens e alteração continuam escondidos.
      await forma.getByTestId("top-aba-geral").click();
      await expect(forma.getByText(TEXTOS.ajudaGeralEstoque, { exact: true }), `${top.codigoBase}: a ajuda da Geral do estoque`).toBeVisible();
      const confirmacao = forma.getByTestId(CAMPO.confirmacao);
      await expect(confirmacao, `${top.codigoBase}: Confirmação aparece`).toHaveValue("manual");
      expect(await opcoesDoCampo(confirmacao), `${top.codigoBase}: Manual e Automática`).toEqual({ manual: true, automatica: true });
      await expect(forma.getByTestId(CAMPO.semItens), `${top.codigoBase}: Documento sem itens continua escondido`).toHaveCount(0);
      await expect(forma.getByTestId(CAMPO.alteracao), `${top.codigoBase}: Alteração continua escondida`).toHaveCount(0);
      await expect(forma.getByTestId("top-campo-geral-observacao"), `${top.codigoBase}: a observação continua`).toBeVisible();
      await expect(forma.getByTestId("top-campo-geral-parceiro"), `${top.codigoBase}: o estoque não tem parceiro`).toHaveCount(0);

      // APROVAÇÃO — volta para o estoque com o bloco; "A partir de um valor" aparece DESABILITADA, com o motivo exato.
      // Financeiro, fiscal e próximas operações continuam fora do documento de estoque; no editor do 5 a Execução
      // também (as espécies de estoque não têm execução configurada: a aba não decidiria nada). As abas que ficam são
      // exatamente as do perfil — a presença ao lado da ausência.
      await expect(forma.locator("[role='tablist'] [data-testid^='top-aba-']"), `${top.codigoBase}: as abas do documento de estoque no editor do 5`)
        .toHaveText(["Identificação", "Geral", "Estoque", "Aprovação"]);
      for (const fora of ["destinos", "financeiro", "fiscal", "execucao"]) {
        await expect(forma.getByTestId(`top-aba-${fora}`), `${top.codigoBase}: a aba ${fora} não se aplica`).toHaveCount(0);
      }
      await forma.getByTestId("top-aba-aprovacao").click();
      const politica = forma.getByTestId(CAMPO.aprovacao);
      await expect(politica).toHaveValue("nenhuma");
      expect(await opcoesDoCampo(politica), `${top.codigoBase}: Sem aprovação e Sempre; "A partir de um valor" desabilitada`)
        .toEqual({ nenhuma: true, sempre: true, por_valor: false });
      await expect(politica.locator("option[value='por_valor']"), "a opção indisponível continua à vista").toHaveText("A partir de um valor");
      await expect(forma.getByTestId("top-regra-motivo-aprovacao"), `${top.codigoBase}: o motivo ao lado`).toHaveText(TEXTOS.motivoAprovacaoPorValorEstoque);
      await expect(forma.locator("[data-testid^='top-regra-motivo-']"), "só a aprovação tem opção indisponível").toHaveCount(1);
      await expect(forma.getByText(TEXTOS.ajudaAprovacao, { exact: true })).toBeVisible();

      await forma.getByTestId("top-cancelar").click();
      await expect(forma).toBeHidden();
    }
  } finally {
    for (const t of tops) await excluirTopE2E(page, t.id);
  }
});

test("W-1 — criação pelo assistente: Trocar o tipo de movimento volta as regras ao neutro do formato 5, e o POST sai no formato 5 sem diálogo", async ({ page }) => {
  await login(page);
  await abrirTelaDeTops(page);
  const codigo = codigoTopE2E();
  let id: string | null = null;
  try {
    await page.getByRole("button", { name: "Novo tipo de operação" }).click();
    const forma = page.getByTestId("form-tipo-operacao");
    await expect(forma).toBeVisible();
    // O PASSO 1: o tipo de movimento antes de tudo. Depois, código e nome.
    await escolherTipoNoAssistente(forma, "vendas.venda");
    await forma.getByTestId("top-campo-codigo").fill(codigo);
    await forma.getByTestId("top-campo-nome").fill(uniq("Venda criada W-1"));

    // Venda: marca Automática.
    await forma.getByTestId("top-aba-geral").click();
    await forma.getByTestId(CAMPO.confirmacao).selectOption("automatica");
    await expect(forma.getByTestId(CAMPO.confirmacao)).toHaveValue("automatica");

    // TROCAR → o passo 1 de novo → Orçamento: os campos somem (a família só aceita o neutro)…
    await forma.getByTestId("top-aba-identificacao").click();
    await forma.getByTestId("top-assistente-trocar").click();
    await escolherTipoNoAssistente(forma, "vendas.orcamento");
    await expect(forma.getByTestId("top-campo-codigo"), "o código digitado fica: ele não depende do tipo").toHaveValue(codigo);
    await forma.getByTestId("top-aba-geral").click();
    await expect(forma.getByTestId("top-campo-geral-observacao")).toBeVisible();
    await expect(forma.getByTestId(CAMPO.confirmacao)).toHaveCount(0);
    // …e TROCAR de volta para a venda: a Automática NÃO ficou escondida no rascunho — o campo volta no neutro.
    await forma.getByTestId("top-aba-identificacao").click();
    await forma.getByTestId("top-assistente-trocar").click();
    await escolherTipoNoAssistente(forma, "vendas.venda");
    await forma.getByTestId("top-aba-geral").click();
    await expect(forma.getByTestId(CAMPO.confirmacao), "trocar o tipo volta ao neutro do formato 5").toHaveValue("manual");

    // Automática e aprovação Sempre, e salvar: na criação não há o que "passaria a valer" — sem diálogo.
    await forma.getByTestId(CAMPO.confirmacao).selectOption("automatica");
    await forma.getByTestId("top-aba-aprovacao").click();
    await forma.getByTestId(CAMPO.aprovacao).selectOption("sempre");
    const post = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/admin/tipos-operacao");
    await forma.getByTestId("top-salvar").click();
    const corpo = (await post).postDataJSON() as CorpoGravado & { codigo?: string; codigoBase?: string };
    expect(corpo.codigoBase).toBe("vendas.venda");
    expect(corpo.configuracao?.versaoSchema, "a criação grava o formato 5").toBe(5);
    expect(corpo.configuracao?.geral.confirmacao).toBe("automatica");
    expect(corpo.configuracao?.aprovacao.politica).toBe("sempre");
    await expect(forma).toBeHidden();
    await expect(page.getByTestId("top-regras-passam-a-valer"), "a criação nunca pergunta").toHaveCount(0);

    const lista = await api<{ items: { id: string; codigo: string }[] }>(page, "GET", `/api/admin/tipos-operacao?search=${codigo}`);
    id = lista.items.find((x) => x.codigo === codigo)?.id ?? null;
    expect(id, "a TOP criada pela tela existe no servidor").toBeTruthy();
    const gravada = await configuracaoNoServidor(page, id!);
    expect(gravada.versao, "a criação é UMA versão").toBe(1);
    expect(gravada.schema, "no formato 5").toBe(5);
    expect(gravada.valor.geral.confirmacao).toBe("automatica");
    expect(gravada.valor.aprovacao.politica).toBe("sempre");
  } finally {
    if (id) await excluirTopE2E(page, id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * W-2 — A TOP DE PEDIDO DE COMPRA DE PRODUÇÃO (FORMATO 3, AUTOMÁTICA/PERMITIDO/PERMITIDA): O QUE VOLTA AO PADRÃO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("W-2 — pedido de compra no formato 3 com os valores de produção: o diálogo lista o que volta ao padrão; voltar não grava; 'Salvar assim mesmo' grava o formato 5 no neutro", async ({ page }) => {
  await login(page);
  // A forma EXATA da produção (lida em 01/10): formato 3, Automática, Permitido, Permitida — o resto no neutro.
  const top = await criarTopViaApi(page, "compras.pedido",
    cfg3({ confirmacao: "automatica", documentoSemItens: "permitido", alteracaoAposConfirmacao: "permitida" }), { rotulo: "Pedido de compra W-2" });
  const escritas: string[] = [];
  const registrar = (r: Request) => { if (ehEscritaDeTop(r)) escritas.push(`${r.method()} ${new URL(r.url()).pathname}`); };
  try {
    const antes = await configuracaoNoServidor(page, top.id);
    expect(antes.versao, "premissa: versão 1").toBe(1);
    expect(antes.schema, "premissa: no formato 3, como a produção").toBe(3);
    expect([antes.valor.geral.confirmacao, antes.valor.geral.documentoSemItens, antes.valor.geral.alteracaoAposConfirmacao],
      "premissa: os três valores de produção").toEqual(["automatica", "permitido", "permitida"]);

    await abrirTelaDeTops(page);
    const forma = await abrirEditorDaTop(page, top.codigo);
    // O pedido só aceita o neutro: os campos nem aparecem — e é por isso que a volta precisa ser DITA no diálogo.
    await forma.getByTestId("top-aba-geral").click();
    await expect(forma.getByTestId("top-campo-geral-observacao")).toBeVisible();
    await expect(forma.getByTestId(CAMPO.confirmacao)).toHaveCount(0);

    // SALVAR (sem mexer em nada) → o diálogo, e nada sai no fio.
    page.on("request", registrar);
    await forma.getByTestId("top-salvar").click();
    const dialogo = page.getByTestId("top-regras-passam-a-valer");
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("Estas regras passam a valer");
    await expect(page.getByTestId("top-exigencias-passam-a-valer"), "nenhuma exigência passa a valer (o formato 3 já as cobrava)").toHaveCount(0);
    await expect(dialogo).toContainText("Estas opções voltam ao padrão, porque esta operação não as executa:");
    const voltam = dialogo.getByTestId("top-regra-volta-ao-padrao");
    await expect(voltam, "as três regras de produção, e só elas").toHaveCount(3);
    await expect(voltam).toHaveText([
      "Confirmação: Automática → Manual",
      "Documento sem itens: Permitido → Proibido",
      "Alteração após confirmar: Permitida → Bloqueada"
    ]);
    await expect(voltam.nth(0)).toHaveAttribute("data-caminho", "geral.confirmacao");
    await expect(voltam.nth(1)).toHaveAttribute("data-caminho", "geral.documentoSemItens");
    await expect(voltam.nth(2)).toHaveAttribute("data-caminho", "geral.alteracaoAposConfirmacao");
    await expect(dialogo.getByTestId("top-regra-passa-a-valer"), "nada passa a executar: tudo volta ao neutro").toHaveCount(0);

    // VOLTAR E REVISAR → fecha, o editor continua aberto, e nenhuma escrita sai.
    await dialogo.getByTestId("top-regras-voltar").click();
    await expect(dialogo).toHaveCount(0);
    await expect(forma, "o editor continua aberto").toBeVisible();
    // O servidor confirma (o GET dá tempo a uma escrita que tivesse saído de chegar à escuta).
    const aindaAntes = await configuracaoNoServidor(page, top.id);
    expect(aindaAntes.versao, "voltar não grava: a versão não mudou").toBe(1);
    expect(aindaAntes.schema).toBe(3);
    expect(escritas, "nenhum PUT saiu ao voltar").toEqual([]);

    // SALVAR → SALVAR ASSIM MESMO → PUT com o formato 5 no neutro.
    await forma.getByTestId("top-salvar").click();
    await expect(dialogo).toBeVisible();
    const put = page.waitForRequest(ehPutDaTop(top.id));
    const resposta = page.waitForResponse((r) => ehPutDaTop(top.id)(r.request()));
    await dialogo.getByTestId("top-regras-salvar").click();
    const corpo = (await put).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "PUT 200 (o servidor aceita: a matriz do pedido só tem o neutro)").toBe(200);
    expect(corpo.configuracao?.versaoSchema, "o corpo enviado é o formato 5").toBe(5);
    expect(corpo.configuracao?.geral.confirmacao).toBe("manual");
    expect(corpo.configuracao?.geral.documentoSemItens).toBe("proibido");
    expect(corpo.configuracao?.geral.alteracaoAposConfirmacao).toBe("bloqueada");
    expect(corpo.configuracao?.aprovacao.politica).toBe("nenhuma");
    await expect(forma).toBeHidden();

    const depois = await configuracaoNoServidor(page, top.id);
    expect(depois.versao, "as regras voltaram ao padrão: é mudança, versão nova").toBe(2);
    expect(depois.schema, "no formato 5").toBe(5);
    expect(depois.valor.versaoSchema).toBe(5);
    expect([depois.valor.geral.confirmacao, depois.valor.geral.documentoSemItens, depois.valor.geral.alteracaoAposConfirmacao, depois.valor.aprovacao.politica],
      "as quatro regras no neutro").toEqual(["manual", "proibido", "bloqueada", "nenhuma"]);

    // HISTÓRICO — a versão 1 (formato 3) só declarava; a 2 está no neutro (nada a dizer); a troca aparece em Geral.
    const versoes = await abrirHistoricoDaTop(page, top.codigo);
    const linhas = versoes.getByTestId("top-versao-linha");
    await expect(linhas).toHaveCount(2);
    const v2 = linhas.nth(0); const v1 = linhas.nth(1);
    await expect(v2).toContainText("Versão 2");
    await expect(v2).toContainText("Formato da configuração: 5");
    await expect(secoesDaVersao(v2)).toHaveText("Seções alteradas: Geral");
    await expect(v2.getByTestId("top-historico-regras-executadas"), "a versão 2 está no neutro").toHaveCount(0);
    await expect(v2.getByTestId("top-historico-regras-registradas")).toHaveCount(0);
    await expect(v1).toContainText("Versão 1");
    await expect(v1).toContainText("Formato da configuração: 3");
    await expect(v1.getByTestId("top-historico-regras-registradas"), "a versão anterior registrava, sem executar").toHaveText(TEXTOS.historicoRegistradas);
    await expect(v1.getByTestId("top-historico-regras-executadas")).toHaveCount(0);
  } finally {
    page.off("request", registrar);
    await excluirTopE2E(page, top.id);
  }
});

test("W-2 — venda no formato 2 com observação, Automática e aprovação por valor: primeiro as exigências, depois as regras que passam a valer; a versão 2 executa", async ({ page }) => {
  await login(page);
  const v2 = configuracaoNeutraTopV2();
  const top = await criarTopViaApi(page, "vendas.venda", {
    ...v2,
    geral: { ...v2.geral, exigeObservacao: true, confirmacao: "automatica" },
    aprovacao: { ...v2.aprovacao, politica: "por_valor", valorMinimo: "1500.00" }
  }, { rotulo: "Venda formato 2 W-2" });
  try {
    const antes = await configuracaoNoServidor(page, top.id);
    expect(antes.schema, "premissa: formato 2").toBe(2);

    await abrirTelaDeTops(page);
    const forma = await abrirEditorDaTop(page, top.codigo);
    // O editor lê o 2 como 4 sem perder o que estava declarado.
    await forma.getByTestId("top-aba-geral").click();
    await expect(forma.getByTestId(CAMPO.confirmacao)).toHaveValue("automatica");
    await forma.getByTestId("top-aba-aprovacao").click();
    await expect(forma.getByTestId(CAMPO.aprovacao)).toHaveValue("por_valor");
    await expect(forma.getByTestId("top-campo-aprovacao-valor")).toHaveValue("1500.00");

    // SALVAR → primeiro o diálogo das exigências (TOP-CONFIG-05, igual ao de hoje) e, só depois dele, o das regras.
    await forma.getByTestId("top-salvar").click();
    const exigencias = page.getByTestId("top-exigencias-passam-a-valer");
    const regras = page.getByTestId("top-regras-passam-a-valer");
    await expect(exigencias).toBeVisible();
    await expect(exigencias).toContainText("A partir desta versão, o lançamento vai exigir: Observação. Até hoje essas marcas estavam só registradas e não eram cobradas.");
    await expect(regras, "um diálogo por vez: as regras esperam as exigências").toHaveCount(0);
    await exigencias.getByTestId("top-exigencias-salvar").click();
    await expect(exigencias).toHaveCount(0);

    await expect(regras).toBeVisible();
    await expect(regras).toContainText("Estas regras passam a valer");
    await expect(regras.getByTestId("top-regra-passa-a-valer"), "o que passa a executar, na ordem do domínio")
      .toHaveText(["Confirmação automática", "Aprovação a partir de R$ 1.500,00"]);
    await expect(regras.getByTestId("top-regra-volta-ao-padrao"), "nada volta: a venda aceita as duas").toHaveCount(0);
    await expect(regras).not.toContainText("Estas opções voltam ao padrão");

    const put = page.waitForRequest(ehPutDaTop(top.id));
    await regras.getByTestId("top-regras-salvar").click();
    const corpo = (await put).postDataJSON() as CorpoGravado;
    expect(corpo.configuracao?.versaoSchema, "o corpo enviado é o formato 5").toBe(5);
    await expect(forma).toBeHidden();

    const depois = await configuracaoNoServidor(page, top.id);
    expect(depois.versao, "as regras passam a valer: versão nova").toBe(2);
    expect(depois.schema, "no formato 5").toBe(5);
    expect(depois.valor.geral.confirmacao).toBe("automatica");
    expect(depois.valor.geral.exigeObservacao).toBe(true);
    expect(depois.valor.aprovacao).toMatchObject({ politica: "por_valor", valorMinimo: "1500.00" });

    const versoes = await abrirHistoricoDaTop(page, top.codigo);
    const linhas = versoes.getByTestId("top-versao-linha");
    await expect(linhas).toHaveCount(2);
    await expect(linhas.nth(0).getByTestId("top-historico-regras-executadas")).toHaveText(TEXTOS.historicoExecutadas);
    // A troca 2 → 4 com regra fora do neutro aparece como mudança de geral E de aprovação (cada uma por si).
    await expect(secoesDaVersao(linhas.nth(0))).toHaveText("Seções alteradas: Geral, Aprovação");
    await expect(linhas.nth(1).getByTestId("top-historico-regras-registradas")).toHaveText(TEXTOS.historicoRegistradas);
  } finally {
    await excluirTopE2E(page, top.id);
  }
});
