import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { formato5Top, type CatalogoTop, type ConfiguracaoTipoOperacao, type ConfiguracaoTipoOperacaoV5 } from "@agro/domain";
import { api, login, uniq } from "./helpers";
import {
  abrirTelaDeTops, catalogoPublicadoE2E, cfg5, codigoTopE2E, detalheTopNoServidor, escolherTipoNoAssistente, excluirTopE2E,
  type CapacidadesFormato5E2E
} from "./top-config-08-comum";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — AS DUAS SEÇÕES DE COMPRAS DO FORMATO 5 NO EDITOR DA TOP
 * (OPERACOES-01 F6a, decisão 283), S-1 a S-3.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────────┐
 * │ A integração prova que a API publica as seções (`formato5.secoes`), lê e grava `fluxoCompra` e     │
 * │ `divergenciaPedido` no formato 5 e recusa (422) a tolerância fora da forma; o domínio prova o      │
 * │ neutro, a leitura estrita e o perfil de cada tipo. O que nenhum dos dois alcança é a TELA: que o    │
 * │ Pedido de compra mostra a aba "Fluxo de compra" e a "Aprovação" (o pedido passa a ser aprovado ao   │
 * │ finalizar) e NÃO mostra a da divergência; que a Compra mostra "Divergência com o pedido" e NÃO a do │
 * │ fluxo; que o que se escolhe nas abas sai no corpo do POST e o servidor guarda; que com "Nenhuma" as │
 * │ tolerâncias não decidem nada (desabilitadas); e que a tolerância fora da forma é avisada ao lado do │
 * │ campo e, enviada, recusada pelo servidor sem criar nada.                                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O PERFIL É O PUBLICADO PELO SERVIDOR (`GET /api/admin/tipos-operacao/capabilities`, bloco `formato5`): a premissa de
 * cada caso é lida dele, nunca importada do domínio. Os textos da tela (rótulos das abas, a ajuda de cada seção, os
 * rótulos do modo, o aviso do cliente) estão escritos POR EXTENSO aqui: copiá-los do componente faria o teste concordar
 * com qualquer coisa que o componente dissesse. O corpo esperado parte do NEUTRO DO 5 do domínio (`cfg5`), nunca de um
 * literal: só o que o caso mexe sai do neutro.
 *
 * FIXTURE PRÓPRIA: toda TOP nasce no teste, pela tela, e sai no `finally` pela exclusão lógica da própria API. Nenhuma
 * TOP do seed é tocada.
 */

/** As abas do editor, pelo rótulo da tela — escritos por extenso (as duas novas são as da F6a). */
const ROTULO_DA_ABA: Readonly<Record<string, string>> = {
  identificacao: "Identificação",
  geral: "Geral",
  destinos: "Próximas operações",
  estoque: "Estoque",
  fluxoCompra: "Fluxo de compra",
  divergenciaPedido: "Divergência com o pedido",
  financeiroPadrao: "Padrões financeiros",
  financeiro: "Financeiro",
  fiscal: "Fiscal",
  aprovacao: "Aprovação",
  execucao: "Execução"
};

const TEXTOS = {
  /** Decisão do Maike de 03/10 (o par): a ajuda diz que a aprovação e esta regra andam juntas. */
  ajudaFluxoCompra:
    "Exigir pedido finalizado para receber: com Sim, o pedido só é recebido depois de finalizado e aprovado. Com Não, o pedido aberto ou finalizado é recebido, como hoje. Esta regra anda junto com a aprovação do pedido (aba Aprovação), que vale ao finalizar: com aprovação ela é Sim, sem aprovação ela é Não — ligar ou desligar a aprovação liga ou desliga esta regra.",
  ajudaDivergencia:
    "Na compra recebida de um pedido, compara cada item com o pedido: o preço unitário líquido e a quantidade (contra o saldo do pedido). Nenhuma: não compara, como hoje. Avisar: a prévia da confirmação mostra a divergência. Bloquear: a compra com divergência acima da tolerância não é confirmada. Tolerância em %, de 0 a 100, com ponto como separador decimal.",
  /** OPERACOES-01 F6b: a ajuda da aba Aprovação no PEDIDO de compra — a aprovação vale ao finalizar. */
  ajudaAprovacaoPedido:
    "No pedido de compra, a aprovação vale ao finalizar: com aprovação, o pedido só é finalizado depois de aprovado em Aprovações, por quem tem as permissões Aprovar de Pedidos de Compra e Aprovar de Compras. Se o valor do pedido subir depois da aprovação (o orçamento vencedor muda os preços), ela precisa ser feita de novo. A aprovação anda junto com \"Exigir pedido finalizado para receber\" (aba Fluxo de compra): ligar a aprovação liga essa regra e desligá-la a desliga; com aprovação, o pedido só é recebido depois de finalizado.",
  /** A ajuda da aba Aprovação de HOJE, que os outros documentos (a compra inclusive) mantêm. */
  ajudaAprovacaoGeral:
    "Com aprovação, o documento só é confirmado depois de aprovado em Aprovações, por quem tem a permissão Aprovar. Alterar a venda depois de aprovada pede uma aprovação nova.",
  /** O aviso do CLIENTE ao lado da tolerância fora da forma (só apresentação: não bloqueia o envio). */
  avisoPercentual: "Informe um percentual de 0 a 100, com até duas casas decimais.",
  /** A mensagem do 422 de configuração (`TIPO_OPERACAO_CONFIGURACAO_INVALIDA`), a que o editor mostra no erro geral. */
  configuracaoInvalida: "A configuração operacional enviada é inválida",
  /** A recusa do PAR (decisão do Maike de 03/10): o mesmo texto no editor (antes de enviar) e no servidor (422). */
  recusaPar: "Com aprovação, o pedido de compra só é recebido depois de finalizado: \"Exigir pedido finalizado para receber\" tem de ser Sim. As duas andam juntas.",
  /** O lado inverso do par: "exigir" sem aprovação, recusado no campo da aprovação. */
  recusaParInversa: "\"Exigir pedido finalizado para receber\" só vale com aprovação do pedido: escolha o critério de aprovação ou deixe a regra em Não. As duas andam juntas.",
  /** O texto do campo apontado por uma recusa `valor_invalido` do parse (que vem sem mensagem) — escrito à mão. */
  recusaValorInvalido: "Valor inválido: confira o que foi informado neste campo."
} as const;

const CAMPO = {
  exigeFinalizar: "top-campo-fluxoCompra-exigeFinalizar",
  modo: "top-campo-divergenciaPedido-modo",
  toleranciaPreco: "top-campo-divergenciaPedido-toleranciaPrecoPercentual",
  toleranciaQuantidade: "top-campo-divergenciaPedido-toleranciaQuantidadePercentual",
  aprovacao: "top-campo-aprovacao-politica"
} as const;

const ehPostDeTop = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/admin/tipos-operacao";

interface CorpoGravado { codigo?: string; codigoBase?: string; configuracao?: ConfiguracaoTipoOperacao }
interface CorpoDeErro { error?: { code?: string; message?: string; details?: { recusas?: { motivo?: string; caminho?: string }[] } } }

/** O perfil publicado de uma família (as abas, na ordem da tela). Ausente é falha: sem perfil não há editor do 5. */
function perfilPublicado(catalogo: CatalogoTop, familia: string) {
  const perfil = catalogo.perfis.find((p) => p.familia === familia);
  expect(perfil, `premissa: o catálogo publicado tem o perfil de ${familia}`).toBeTruthy();
  return perfil!;
}

/** As capacidades do formato 5 com as DUAS seções desta fase — a premissa de todo caso daqui. */
async function premissaDasSecoes(page: Page): Promise<CatalogoTop> {
  const c = await api<CapacidadesFormato5E2E>(page, "GET", "/api/admin/tipos-operacao/capabilities");
  expect(c.formato5?.secoes, "premissa: o servidor declara as seções de compras da F6a, depois das da F5a (e antes da da F9 e da da F11)").toEqual(["destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao", "implantacao"]);
  return catalogoPublicadoE2E(page);
}

/** As abas da tela, na ordem. */
const abasDaTela = (forma: Locator) => forma.locator("[role='tablist'] [data-testid^='top-aba-']");

/** As opções de um `<select>`: o valor e se está habilitada. */
async function opcoesDoCampo(campo: Locator): Promise<Record<string, boolean>> {
  return campo.locator("option").evaluateAll((os) =>
    Object.fromEntries(os.map((o) => [(o as HTMLOptionElement).value, !(o as HTMLOptionElement).disabled])));
}

/** Abre "Novo tipo de operação", escolhe o tipo pela família no assistente e preenche código e nome. */
async function criarPelaTela(page: Page, familia: string, rotulo: string): Promise<{ forma: Locator; codigo: string }> {
  await abrirTelaDeTops(page);
  await page.getByRole("button", { name: "Novo tipo de operação" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  await escolherTipoNoAssistente(forma, familia);
  const codigo = codigoTopE2E();
  await forma.getByTestId("top-campo-codigo").fill(codigo);
  await forma.getByTestId("top-campo-nome").fill(uniq(rotulo));
  return { forma, codigo };
}

/** As TOPs com este código, pela busca server-side (o código é único por execução). */
async function topsComCodigo(page: Page, codigo: string): Promise<{ id: string; codigo: string }[]> {
  const lista = await api<{ items: { id: string; codigo: string }[] }>(page, "GET", `/api/admin/tipos-operacao?search=${codigo}`);
  return lista.items.filter((x) => x.codigo === codigo);
}

/** A configuração que o SERVIDOR guardou, exigida no formato 5 (as seções só existem nele). */
async function configuracaoGravadaV5(page: Page, id: string): Promise<{ versao: number; schema: number; valor: ConfiguracaoTipoOperacaoV5 }> {
  const d = await detalheTopNoServidor(page, id);
  expect(d.configuracao.suportada, "o servidor lê a versão que ele mesmo gravou").toBe(true);
  const valor = d.configuracao.valor;
  if (!valor || !formato5Top(valor)) throw new Error(`a versão gravada não está no formato 5 (configuracaoSchema ${d.configuracaoSchema})`);
  return { versao: d.versao, schema: d.configuracaoSchema, valor };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * S-1 — PEDIDO DE COMPRA: "FLUXO DE COMPRA" E "APROVAÇÃO"; GRAVA exigeFinalizar E APROVAÇÃO "SEMPRE" NO FORMATO 5
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("S-1 — pedido de compra pelo assistente: as abas 'Fluxo de compra' e 'Aprovação' (sem a da divergência); 'Exigir pedido finalizado para receber' = Sim e aprovação 'Sempre' saem no POST do formato 5 e o servidor guarda", async ({ page }) => {
  await login(page);
  const catalogo = await premissaDasSecoes(page);
  const perfil = perfilPublicado(catalogo, "compras.pedido");
  expect(perfil.abas, "premissa: o perfil publicado do pedido de compra tem o fluxo, os padrões financeiros (F9b) e a aprovação, e não a divergência")
    .toEqual(["identificacao", "geral", "destinos", "estoque", "fluxoCompra", "financeiroPadrao", "financeiro", "fiscal", "aprovacao"]);
  expect(perfil.secoesNeutras, "premissa: a divergência fica no padrão no pedido").toContain("divergenciaPedido");

  let id: string | null = null;
  try {
    const { forma, codigo } = await criarPelaTela(page, "compras.pedido", "Pedido de compra S-1");

    // AS ABAS: as do perfil publicado, com os rótulos da tela — e a da divergência NÃO existe no pedido.
    await expect(abasDaTela(forma)).toHaveText(perfil.abas.map((a) => ROTULO_DA_ABA[a]!));
    await expect(forma.getByTestId("top-aba-divergenciaPedido"), "a divergência é da compra, não do pedido").toHaveCount(0);

    // FLUXO DE COMPRA: a ajuda da seção, por extenso; o campo nasce no neutro ("Não", o comportamento de hoje).
    await forma.getByTestId("top-aba-fluxoCompra").click();
    await expect(forma.getByText(TEXTOS.ajudaFluxoCompra, { exact: true })).toBeVisible();
    const exige = forma.getByLabel("Exigir pedido finalizado para receber", { exact: true });
    await expect(exige, "o rótulo é do campo da seção").toHaveAttribute("data-testid", CAMPO.exigeFinalizar);
    await expect(exige, "nasce desligado").toHaveValue("false");
    await expect(exige.locator("option")).toHaveText(["Não", "Sim"]);
    await exige.selectOption("true");
    await expect(exige).toHaveValue("true");

    // APROVAÇÃO: o pedido de compra aceita as três políticas (decisão 283: aprova ao finalizar), sem motivo de recusa.
    // A AJUDA (OPERACOES-01 F6b): a do pedido, que diz que a aprovação vale ao FINALIZAR — e não a de hoje, que fala em
    // "confirmado" (a premissa: a compra, no S-2, continua com a de hoje).
    await forma.getByTestId("top-aba-aprovacao").click();
    await expect(forma.getByText(TEXTOS.ajudaAprovacaoPedido, { exact: true }), "a ajuda da Aprovação do pedido diz 'ao finalizar'").toBeVisible();
    await expect(forma.getByText(TEXTOS.ajudaAprovacaoGeral, { exact: true }), "a ajuda de hoje não aparece no pedido de compra").toHaveCount(0);
    const politica = forma.getByTestId(CAMPO.aprovacao);
    await expect(politica, "nasce sem aprovação").toHaveValue("nenhuma");
    expect(await opcoesDoCampo(politica), "o pedido de compra aceita as três políticas").toEqual({ nenhuma: true, sempre: true, por_valor: true });
    await expect(forma.locator("[data-testid^='top-regra-motivo-']"), "nenhuma opção indisponível, nenhum motivo").toHaveCount(0);
    await politica.selectOption("sempre");

    // SALVAR → o POST no 5: o neutro do domínio com SÓ o que o caso mexeu (o fluxo e a aprovação).
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await post).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "POST 201").toBe(201);
    expect(corpo.codigo).toBe(codigo);
    expect(corpo.codigoBase, "a família vem do tipo escolhido").toBe("compras.pedido");
    expect(corpo.configuracao?.versaoSchema, "a criação grava o formato 5").toBe(5);
    expect(corpo.configuracao, "o neutro do 5 com o fluxo exigindo finalizar e a aprovação 'Sempre' — nada a mais")
      .toEqual(cfg5({ aprovacao: "sempre" }, (c) => ({ ...c, fluxoCompra: { exigeFinalizar: true } })));
    await expect(forma).toBeHidden();

    // O SERVIDOR É O ÁRBITRO: a versão 1, no formato 5, com as duas regras.
    const criadas = await topsComCodigo(page, codigo);
    expect(criadas, "a TOP criada pela tela existe no servidor").toHaveLength(1);
    id = criadas[0]!.id;
    const gravada = await configuracaoGravadaV5(page, id);
    expect([gravada.versao, gravada.schema], "versão 1, no formato 5").toEqual([1, 5]);
    expect(gravada.valor.fluxoCompra, "o servidor guardou o fluxo").toEqual({ exigeFinalizar: true });
    expect(gravada.valor.aprovacao.politica, "e a aprovação").toBe("sempre");
    expect(gravada.valor.divergenciaPedido, "a divergência do pedido continua no padrão").toEqual({ modo: "nenhuma", toleranciaPrecoPercentual: "0", toleranciaQuantidadePercentual: "0" });
  } finally {
    if (id) await excluirTopE2E(page, id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * S-2 — COMPRA: "DIVERGÊNCIA COM O PEDIDO" — NENHUMA DESABILITA AS TOLERÂNCIAS; BLOQUEAR 5.5 / 10 SAI NO POST
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("S-2 — compra pelo assistente: a aba 'Divergência com o pedido' (sem a do fluxo); com 'Nenhuma' as tolerâncias ficam desabilitadas; 'Bloquear' com 5.5 e 10 sai no POST como foi digitado e o servidor guarda", async ({ page }) => {
  await login(page);
  const catalogo = await premissaDasSecoes(page);
  const perfil = perfilPublicado(catalogo, "compras.compra");
  expect(perfil.abas, "premissa: o perfil publicado da compra tem a divergência e os padrões financeiros (F9b), e não o fluxo")
    .toEqual(["identificacao", "geral", "estoque", "divergenciaPedido", "financeiroPadrao", "financeiro", "fiscal", "aprovacao", "execucao"]);
  expect(perfil.secoesNeutras, "premissa: o fluxo de compra fica no padrão na compra").toContain("fluxoCompra");

  let id: string | null = null;
  try {
    const { forma, codigo } = await criarPelaTela(page, "compras.compra", "Compra S-2");
    await expect(abasDaTela(forma)).toHaveText(perfil.abas.map((a) => ROTULO_DA_ABA[a]!));
    await expect(forma.getByTestId("top-aba-fluxoCompra"), "o fluxo é do pedido, não da compra").toHaveCount(0);

    // A ABA: a ajuda por extenso; o modo com os três rótulos, nascendo em "Nenhuma".
    await forma.getByTestId("top-aba-divergenciaPedido").click();
    await expect(forma.getByText(TEXTOS.ajudaDivergencia, { exact: true })).toBeVisible();
    const modo = forma.getByLabel("Divergência", { exact: true });
    await expect(modo).toHaveAttribute("data-testid", CAMPO.modo);
    await expect(modo, "nasce sem comparar (o comportamento de hoje)").toHaveValue("nenhuma");
    await expect(modo.locator("option")).toHaveText(["Nenhuma", "Avisar", "Bloquear"]);
    expect(await opcoesDoCampo(modo), "os três modos, habilitados").toEqual({ nenhuma: true, avisa: true, bloqueia: true });

    // COM "NENHUMA", AS TOLERÂNCIAS NÃO DECIDEM NADA: à vista, no "0" do neutro, DESABILITADAS.
    const preco = forma.getByLabel("Tolerância de preço (%)", { exact: true });
    const quantidade = forma.getByLabel("Tolerância de quantidade (%)", { exact: true });
    await expect(preco).toHaveAttribute("data-testid", CAMPO.toleranciaPreco);
    await expect(quantidade).toHaveAttribute("data-testid", CAMPO.toleranciaQuantidade);
    for (const campo of [preco, quantidade]) {
      await expect(campo, "presença: o campo está à vista").toBeVisible();
      await expect(campo).toHaveValue("0");
      await expect(campo, "com Nenhuma, desabilitado").toBeDisabled();
    }

    // BLOQUEAR → as duas habilitam. Um "150" digitado (o aviso do cliente aparece) e a volta a "Nenhuma": as duas voltam
    // ao "0" do neutro, desabilitadas e sem aviso — o valor recusado não fica preso num campo que não se edita.
    await modo.selectOption("bloqueia");
    for (const campo of [preco, quantidade]) await expect(campo, "com Bloquear, habilitado").toBeEnabled();
    await preco.fill("150");
    await expect(forma.getByTestId("top-aviso-divergenciaPedido.toleranciaPrecoPercentual"), "premissa: o 150 avisa").toHaveText(TEXTOS.avisoPercentual);
    await modo.selectOption("nenhuma");
    for (const campo of [preco, quantidade]) {
      await expect(campo, "de volta a Nenhuma: o 0 do neutro").toHaveValue("0");
      await expect(campo, "de volta a Nenhuma: desabilitado").toBeDisabled();
    }
    await expect(forma.locator("[data-testid^='top-aviso-divergenciaPedido.']"), "nenhum aviso preso").toHaveCount(0);

    // BLOQUEAR de novo → 5.5 e 10, sem aviso do cliente (a forma é aceita).
    await modo.selectOption("bloqueia");
    for (const campo of [preco, quantidade]) await expect(campo, "com Bloquear, habilitado").toBeEnabled();
    await preco.fill("5.5");
    await quantidade.fill("10");
    await expect(preco).toHaveValue("5.5");
    await expect(quantidade).toHaveValue("10");
    await expect(forma.locator("[data-testid^='top-aviso-divergenciaPedido.']"), "a forma é aceita: nenhum aviso").toHaveCount(0);

    // A AJUDA DA APROVAÇÃO NA COMPRA (a premissa do S-1): a de hoje, letra por letra — a do pedido não aparece.
    await forma.getByTestId("top-aba-aprovacao").click();
    await expect(forma.getByText(TEXTOS.ajudaAprovacaoGeral, { exact: true }), "a compra mantém a ajuda da Aprovação de hoje").toBeVisible();
    await expect(forma.getByText(TEXTOS.ajudaAprovacaoPedido, { exact: true }), "a ajuda do pedido não aparece na compra").toHaveCount(0);

    // SALVAR → o POST no 5 com a seção como foi digitada ("5.5", não "5.50"), e o resto no neutro.
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await post).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "POST 201").toBe(201);
    expect(corpo.codigoBase).toBe("compras.compra");
    expect(corpo.configuracao?.versaoSchema).toBe(5);
    const divergencia = { modo: "bloqueia", toleranciaPrecoPercentual: "5.5", toleranciaQuantidadePercentual: "10" } as const;
    expect(corpo.configuracao, "o neutro do 5 com SÓ a divergência mexida").toEqual(cfg5({}, (c) => ({ ...c, divergenciaPedido: divergencia })));
    await expect(forma).toBeHidden();

    const criadas = await topsComCodigo(page, codigo);
    expect(criadas, "a TOP criada pela tela existe no servidor").toHaveLength(1);
    id = criadas[0]!.id;
    const gravada = await configuracaoGravadaV5(page, id);
    expect([gravada.versao, gravada.schema], "versão 1, no formato 5").toEqual([1, 5]);
    expect(gravada.valor.divergenciaPedido, "o servidor guardou a divergência como foi digitada").toEqual(divergencia);
    expect(gravada.valor.fluxoCompra, "o fluxo da compra continua no padrão").toEqual({ exigeFinalizar: false });
  } finally {
    if (id) await excluirTopE2E(page, id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * S-3 — A RECUSA: TOLERÂNCIA "150" — O AVISO DO CLIENTE, O 422 DO SERVIDOR E NADA CRIADO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("S-3 — compra com tolerância de preço '150': o aviso ao lado do campo; salvar recebe o 422 do servidor no caminho da tolerância e nada é criado; corrigida para 15, a mesma criação passa", async ({ page }) => {
  await login(page);
  const catalogo = await premissaDasSecoes(page);
  expect(perfilPublicado(catalogo, "compras.compra").abas, "premissa: a compra tem a aba da divergência").toContain("divergenciaPedido");

  let id: string | null = null;
  try {
    const { forma, codigo } = await criarPelaTela(page, "compras.compra", "Compra S-3");
    expect(await topsComCodigo(page, codigo), "premissa: nenhuma TOP com este código antes de salvar").toEqual([]);

    await forma.getByTestId("top-aba-divergenciaPedido").click();
    await forma.getByTestId(CAMPO.modo).selectOption("bloqueia");
    const preco = forma.getByTestId(CAMPO.toleranciaPreco);
    const aviso = forma.getByTestId("top-aviso-divergenciaPedido.toleranciaPrecoPercentual");

    // PRESENÇA ANTES DA AUSÊNCIA: o valor aceito não avisa; "150" (acima de 100) avisa, ao lado do campo.
    await preco.fill("15");
    await expect(aviso, "15 está na forma: sem aviso").toHaveCount(0);
    await preco.fill("150");
    await expect(aviso, "o aviso do cliente, por extenso").toHaveText(TEXTOS.avisoPercentual);
    await expect(forma.getByTestId("top-aviso-divergenciaPedido.toleranciaQuantidadePercentual"), "só no campo errado").toHaveCount(0);

    // SALVAR: o aviso é só apresentação — o corpo VAI com "150", e quem recusa é o servidor (422).
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const enviado = (await post).postDataJSON() as CorpoGravado;
    expect(enviado.configuracao && formato5Top(enviado.configuracao) ? enviado.configuracao.divergenciaPedido : null,
      "o corpo leva o valor digitado").toEqual({ modo: "bloqueia", toleranciaPrecoPercentual: "150", toleranciaQuantidadePercentual: "0" });
    const recusada = await resposta;
    expect(recusada.status(), "o servidor recusa").toBe(422);
    const erro = (await recusada.json()) as CorpoDeErro;
    expect(erro.error?.code).toBe("TIPO_OPERACAO_CONFIGURACAO_INVALIDA");
    expect(erro.error?.details?.recusas, "a recusa aponta a tolerância de preço, e só ela")
      .toEqual([{ motivo: "valor_invalido", caminho: "divergenciaPedido.toleranciaPrecoPercentual" }]);

    // A TELA: o editor continua aberto, na aba da divergência, com o aviso ao lado do campo e o erro do servidor.
    await expect(forma, "o editor continua aberto").toBeVisible();
    await expect(forma.getByTestId("top-aba-divergenciaPedido")).toHaveAttribute("aria-selected", "true");
    await expect(aviso).toHaveText(TEXTOS.avisoPercentual);
    await expect(forma.getByTestId("error-state"), "a recusa do servidor aparece no editor").toContainText(TEXTOS.configuracaoInvalida);
    await expect(forma.getByTestId("top-erro-divergenciaPedido.toleranciaPrecoPercentual"), "e no CAMPO que o 422 aponta")
      .toHaveText(TEXTOS.recusaValorInvalido);
    await expect(forma.getByTestId("top-erro-divergenciaPedido.toleranciaQuantidadePercentual"), "só no campo que o servidor apontou").toHaveCount(0);
    expect(await topsComCodigo(page, codigo), "nada foi criado").toEqual([]);

    // A PREMISSA AO LADO DA RECUSA: o MESMO rascunho, só com a tolerância corrigida, é criado.
    await preco.fill("15");
    await expect(aviso).toHaveCount(0);
    const post2 = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    expect((await post2).status(), "corrigida, a mesma criação passa").toBe(201);
    await expect(forma).toBeHidden();
    const criadas = await topsComCodigo(page, codigo);
    expect(criadas, "uma TOP só, a da segunda tentativa").toHaveLength(1);
    id = criadas[0]!.id;
    const gravada = await configuracaoGravadaV5(page, id);
    expect(gravada.versao, "a recusa não gastou versão").toBe(1);
    expect(gravada.valor.divergenciaPedido).toEqual({ modo: "bloqueia", toleranciaPrecoPercentual: "15", toleranciaQuantidadePercentual: "0" });
  } finally {
    if (id) await excluirTopE2E(page, id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * S-4 — O PAR (decisão do Maike de 03/10): A APROVAÇÃO E "EXIGIR PEDIDO FINALIZADO PARA RECEBER" ANDAM JUNTAS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("S-4 — pedido de compra: marcar a aprovação 'Sempre' marca 'Exigir pedido finalizado para receber' e desmarcá-la o desmarca; uma sem a outra é recusada no campo que falta antes de enviar (nenhum POST); com as duas, o POST grava as duas", async ({ page }) => {
  await login(page);
  const catalogo = await premissaDasSecoes(page);
  expect(perfilPublicado(catalogo, "compras.pedido").abas, "premissa: o pedido tem o fluxo e a aprovação").toEqual(expect.arrayContaining(["fluxoCompra", "aprovacao"]));

  let id: string | null = null;
  const posts: Request[] = [];
  page.on("request", (r) => { if (ehPostDeTop(r)) posts.push(r); });
  try {
    const { forma, codigo } = await criarPelaTela(page, "compras.pedido", "Pedido de compra S-4");
    const exige = forma.getByTestId(CAMPO.exigeFinalizar);

    // PREMISSA: as duas nascem desligadas.
    await forma.getByTestId("top-aba-fluxoCompra").click();
    await expect(exige, "premissa: nasce Não").toHaveValue("false");

    // MARCAR A APROVAÇÃO → o "exigir" vem junto.
    await forma.getByTestId("top-aba-aprovacao").click();
    await forma.getByTestId(CAMPO.aprovacao).selectOption("sempre");
    await forma.getByTestId("top-aba-fluxoCompra").click();
    await expect(exige, "ligar a aprovação ligou o 'exigir'").toHaveValue("true");

    // VOLTAR O "EXIGIR" A NÃO com a aprovação ligada → salvar recusa no campo, com o texto do servidor, e nada é enviado.
    await exige.selectOption("false");
    await forma.getByTestId("top-aba-identificacao").click();
    await page.getByTestId("top-salvar").click();
    await expect(forma.getByTestId("top-aba-fluxoCompra"), "a aba do campo abre").toHaveAttribute("aria-selected", "true");
    await expect(forma.getByTestId("top-erro-fluxoCompra.exigeFinalizar"), "a recusa no campo, por extenso").toHaveText(TEXTOS.recusaPar);
    expect(posts, "nada foi enviado").toHaveLength(0);
    expect(await topsComCodigo(page, codigo), "nada foi criado").toEqual([]);

    // DESMARCAR A APROVAÇÃO → o "exigir" vai junto (para Não).
    await exige.selectOption("true");
    await forma.getByTestId("top-aba-aprovacao").click();
    await forma.getByTestId(CAMPO.aprovacao).selectOption("nenhuma");
    await forma.getByTestId("top-aba-fluxoCompra").click();
    await expect(exige, "desligar a aprovação desligou o 'exigir'").toHaveValue("false");

    // "EXIGIR" SEM APROVAÇÃO → salvar recusa no campo da aprovação (o que falta), com o texto do servidor; nada é enviado.
    await exige.selectOption("true");
    await page.getByTestId("top-salvar").click();
    await expect(forma.getByTestId("top-aba-aprovacao"), "a aba da aprovação abre").toHaveAttribute("aria-selected", "true");
    await expect(forma.getByTestId("top-erro-aprovacao.politica"), "a recusa no campo da aprovação, por extenso").toHaveText(TEXTOS.recusaParInversa);
    expect(posts, "nada foi enviado").toHaveLength(0);
    await forma.getByTestId(CAMPO.aprovacao).selectOption("sempre");
    await forma.getByTestId("top-aba-fluxoCompra").click();
    await expect(exige, "com a aprovação, o 'exigir' continua Sim").toHaveValue("true");

    // A PREMISSA AO LADO DA RECUSA: o MESMO rascunho com as duas ligadas → o POST leva as duas e o servidor guarda.
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await post).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "POST 201").toBe(201);
    expect(corpo.configuracao, "o neutro do 5 com as duas ligadas — nada a mais")
      .toEqual(cfg5({ aprovacao: "sempre" }, (c) => ({ ...c, fluxoCompra: { exigeFinalizar: true } })));
    await expect(forma).toBeHidden();
    const criadas = await topsComCodigo(page, codigo);
    expect(criadas, "a TOP criada pela tela existe no servidor").toHaveLength(1);
    id = criadas[0]!.id;
    const gravada = await configuracaoGravadaV5(page, id);
    expect([gravada.versao, gravada.valor.aprovacao.politica, gravada.valor.fluxoCompra], "versão 1, com as duas").toEqual([1, "sempre", { exigeFinalizar: true }]);
  } finally {
    if (id) await excluirTopE2E(page, id);
  }
});
