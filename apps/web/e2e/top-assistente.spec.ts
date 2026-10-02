import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { configuracaoNeutraTopV5, type CatalogoTop, type ConfiguracaoTipoOperacao } from "@agro/domain";
import { api, login, uniq } from "./helpers";
import {
  abrirEditorDaTop, abrirTelaDeTops, cfg4, codigoTopE2E, detalheTopNoServidor, excluirTopE2E
} from "./top-config-08-comum";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO — O ASSISTENTE (TIPO DE MOVIMENTO PRIMEIRO) E O EDITOR DO FORMATO 5
 * (OPERACOES-01 F4, decisão 281), AS-1 a AS-3.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────────┐
 * │ A integração prova que a API publica o catálogo por tipo, grava o formato 5 e recusa (422) no 5 o    │
 * │ que o tipo não aceita. O que ela não alcança é a promessa da TELA: que a criação começa pelo TIPO DE │
 * │ MOVIMENTO, oferecendo SÓ os tipos que o catálogo publicado diz ter tela; que, escolhido o tipo, as   │
 * │ abas e as exigências são as DELE, com o rótulo dele ("Exigir cliente", "Exigir fornecedor"); que     │
 * │ trocar de tipo não deixa nada do anterior escondido no rascunho; e que a TOP antiga com o que o tipo │
 * │ não aceita não perde nada em silêncio — o diálogo diz o que volta ao padrão ANTES de gravar.         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O CATÁLOGO É O PUBLICADO PELO SERVIDOR (`GET /api/admin/tipos-operacao/capabilities`, bloco `formato5`), lido aqui
 * para a premissa; o que a tela mostra é conferido contra ele E contra o texto do pedido (os grupos e os tipos de hoje,
 * por extenso). A VERSÃO, O FORMATO E O CONTEÚDO são conferidos pelo servidor (o detalhe) e pelo corpo que saiu no fio
 * — nunca por um texto da tela. O corpo esperado parte do NEUTRO DO 5 do domínio (`configuracaoNeutraTopV5`), nunca de
 * um literal daqui.
 *
 * FIXTURE PRÓPRIA: toda TOP nasce no teste (pela tela ou pela API) e é excluída no `finally` (a exclusão lógica da
 * própria API). Nenhuma TOP do seed é tocada.
 */

const TEXTOS = {
  passo1: "Passo 1 de 2: escolha o tipo de movimento. Depois, as abas mostram só o que vale para ele.",
  /** A ajuda da Geral no editor do 5 fora do documento de estoque (decisão 281, item 4 do coordenador), por extenso. */
  ajudaGeralFormato5:
    "Confirmação automática: o documento é confirmado ao ser salvo, por quem salvou e com a mesma conferência da confirmação manual. Se a confirmação recusar, o documento fica salvo e aberto, e o motivo aparece ao salvar e ao confirmar. Documento sem itens: quando esta operação permite, a venda e a compra podem ser salvas sem item nas Centrais de Vendas e de Compras (o recebimento de um pedido sempre pede item). As exigências de preenchimento são cobradas no lançamento.",
  /** A frase da ajuda do editor do 4, que NÃO pode aparecer no editor do 5. */
  ajudaGeralAntigaTrecho: "o lançamento ainda pede ao menos um item",
  ajudaGeralEstoque: "No documento de estoque valem a confirmação automática e a observação obrigatória."
} as const;

/** O bloco do formato 5 nas capacidades, só no que este arquivo confere. */
interface CapacidadesFormato5E2E { formato5?: { suportado: boolean; versaoSchema: number; secoes: string[]; catalogo: CatalogoTop } }

/** O catálogo que o servidor publicou — a premissa de tudo: sem ele não há editor do 5. */
async function catalogoPublicado(page: Page): Promise<CatalogoTop> {
  const c = await api<CapacidadesFormato5E2E>(page, "GET", "/api/admin/tipos-operacao/capabilities");
  expect(c.formato5?.suportado, "premissa: este servidor declara o formato 5").toBe(true);
  expect(c.formato5?.versaoSchema, "premissa: no formato 5").toBe(5);
  expect(c.formato5?.secoes, "premissa: as seções de extensão do 5 são Destino e Fluxo, da F5a (decisão 282), e Fluxo de compra e Divergência, da F6a (decisão 283); o editor só liga com o mesmo conjunto")
    .toEqual(["destino", "fluxo", "fluxoCompra", "divergenciaPedido"]);
  return c.formato5!.catalogo;
}

/** A família do tipo de chave `chave` no catálogo publicado (a premissa diz qual é, por extenso). */
function familiaDoTipo(catalogo: CatalogoTop, chave: string): string {
  const familia = catalogo.tipos.find((t) => t.chave === chave)?.familia;
  expect(familia, `premissa: o tipo "${chave}" tem família no catálogo publicado`).toBeTruthy();
  return familia!;
}

/** Escritas na TOP: o que NÃO pode sair enquanto o administrador ainda está decidindo. */
const ehEscritaDeTop = (r: Request) =>
  ["POST", "PUT", "PATCH"].includes(r.method()) && new URL(r.url()).pathname.startsWith("/api/admin/tipos-operacao");
const ehPostDeTop = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/admin/tipos-operacao";
const ehPutDaTop = (id: string) => (r: Request) =>
  r.method() === "PUT" && new URL(r.url()).pathname === `/api/admin/tipos-operacao/${id}`;

interface CorpoGravado { codigo?: string; codigoBase?: string; configuracao?: ConfiguracaoTipoOperacao }

/** Abre "Novo tipo de operação" e devolve o diálogo, já no passo 1 (o assistente). */
async function abrirCriacao(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Novo tipo de operação" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  await expect(forma.getByTestId("top-assistente"), "o editor do 5 começa pelo passo 1").toBeVisible();
  return forma;
}

/** Os textos das abas, na ordem da tela. */
const abasDaTela = (forma: Locator) => forma.locator("[role='tablist'] [data-testid^='top-aba-']");

/** O id da TOP criada pela tela, pela busca server-side do código. */
async function idDaTopCriada(page: Page, codigo: string): Promise<string> {
  const lista = await api<{ items: { id: string; codigo: string }[] }>(page, "GET", `/api/admin/tipos-operacao?search=${codigo}`);
  const id = lista.items.find((x) => x.codigo === codigo)?.id;
  expect(id, "a TOP criada pela tela existe no servidor").toBeTruthy();
  return id!;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * AS-1 — O CAMINHO PRINCIPAL: PASSO 1 PELO CATÁLOGO PUBLICADO, ENTRADA, ABAS E EXIGÊNCIAS DO TIPO, POST NO 5
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("AS-1 — Novo começa pelo tipo de movimento (só os tipos com tela do catálogo publicado); Entrada mostra só as abas e a exigência dela; o POST sai no formato 5", async ({ page }) => {
  await login(page);
  const catalogo = await catalogoPublicado(page);
  const comTela = catalogo.tipos.filter((t) => t.temTela);
  // 9 dos documentos (venda, compra e estoque) e, desde a F10 (decisão 287), os 6 de Módulos
  expect(comTela, "premissa: o catálogo publicado tem 15 tipos com tela").toHaveLength(15);
  const familias = await api<{ items: { codigo: string }[] }>(page, "GET", "/api/admin/tipos-operacao/familias");
  expect(familias.items.length, "premissa: o registry (/familias, inteiro) tem mais famílias do que tipos com tela").toBeGreaterThan(comTela.length);
  const semTela = catalogo.tipos.filter((t) => !t.temTela && t.familia !== null).map((t) => t.familia);
  expect(semTela.length, "premissa: há tipos COM família e SEM tela (o financeiro e os que esperam a tela da F5b e da F6b)").toBeGreaterThan(0);

  await abrirTelaDeTops(page);
  const codigo = codigoTopE2E();
  let id: string | null = null;
  try {
    const forma = await abrirCriacao(page);

    // O PASSO 1 VEM ANTES: só o assistente — sem código, sem abas, sem o aviso de versionamento; Salvar desabilitado.
    await expect(forma.getByTestId("top-assistente-passo")).toHaveText(TEXTOS.passo1);
    await expect(forma.getByTestId("top-campo-codigo"), "o código vem depois do tipo").toHaveCount(0);
    await expect(forma.getByTestId("top-aba-identificacao"), "nenhuma aba no passo 1").toHaveCount(0);
    await expect(forma.getByTestId("top-aviso-versionamento")).toHaveCount(0);
    await expect(page.getByTestId("top-salvar"), "sem tipo, nada a salvar").toBeDisabled();

    // OS GRUPOS E OS TIPOS: os de hoje, por extenso, e exatamente os com tela do catálogo publicado. Desde a F10
    // (decisão 287) os 6 de Módulos têm tela; o Financeiro continua fora (nenhum tipo dele tem tela).
    const grupos = forma.locator("[data-testid^='top-assistente-grupo-']");
    await expect(grupos, "Financeiro não aparece: nenhum tipo dele tem tela").toHaveCount(4);
    expect(await grupos.evaluateAll((gs) => gs.map((g) => g.getAttribute("data-testid"))))
      .toEqual(["top-assistente-grupo-vendas", "top-assistente-grupo-compras", "top-assistente-grupo-movimentacao_interna", "top-assistente-grupo-modulos"]);
    await expect(forma.getByTestId("top-assistente-grupo-vendas").getByRole("heading")).toHaveText("Vendas");
    await expect(forma.getByTestId("top-assistente-grupo-movimentacao_interna").getByRole("heading")).toHaveText("Movimentação interna");
    const botoes = (g: string) => forma.getByTestId(`top-assistente-grupo-${g}`).locator("[data-testid^='top-assistente-tipo-']");
    await expect(botoes("vendas")).toHaveText(["Orçamento", "Pedido", "Venda"]);
    await expect(botoes("compras")).toHaveText(["Pedido", "Compra"]);
    await expect(botoes("movimentacao_interna")).toHaveText(["Entrada", "Saída/baixa", "Transferência", "Ajuste"]);
    await expect(forma.getByTestId("top-assistente-grupo-modulos").getByRole("heading")).toHaveText("Módulos");
    await expect(botoes("modulos")).toHaveText(["Abastecimento", "Manutenção", "Ordem de serviço", "Manejo", "Batelada", "Produção de ração"]);
    const oferecidas = await forma.locator("[data-testid^='top-assistente-tipo-']").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-familia")));
    expect(oferecidas, "os botões são os tipos com tela do catálogo publicado, na ordem dele").toEqual(comTela.map((t) => t.familia));
    for (const f of semTela) expect(oferecidas, `a família sem tela ${f} não é oferecida`).not.toContain(f);

    // ESCOLHE ENTRADA → o passo 2, na Identificação, com o movimento escolhido (sem seletor) e o botão Trocar.
    const familiaEntrada = familiaDoTipo(catalogo, "entrada");
    expect(familiaEntrada, "premissa: a Entrada é a espécie de entrada do documento de estoque").toBe("estoque.entrada");
    await forma.getByTestId("top-assistente-tipo-entrada").click();
    await expect(forma.getByTestId("top-assistente")).toHaveCount(0);
    const movimento = forma.getByTestId("top-campo-familia");
    await expect(movimento).toBeDisabled();
    expect(await movimento.evaluate((e) => e.tagName), "o movimento aparece, não se escolhe de novo aqui").toBe("INPUT");
    await expect(movimento).toHaveValue(new RegExp(`\\(${familiaEntrada.replace(".", "\\.")}\\)$`));
    await expect(forma.getByTestId("top-assistente-trocar")).toHaveText("Trocar");

    // AS ABAS DA ENTRADA: Identificação, Geral, Estoque e Aprovação — sem Próximas operações, Financeiro, Fiscal e Execução.
    await expect(abasDaTela(forma)).toHaveText(["Identificação", "Geral", "Estoque", "Aprovação"]);
    for (const fora of ["destinos", "financeiro", "fiscal", "execucao"]) {
      await expect(forma.getByTestId(`top-aba-${fora}`), `a aba ${fora} não vale para a Entrada`).toHaveCount(0);
    }

    // GERAL: só "Exigir observação" (o documento de estoque não tem parceiro, centro de resultado nem transportadora).
    await forma.getByTestId("top-aba-geral").click();
    await expect(forma.getByText(TEXTOS.ajudaGeralEstoque, { exact: true })).toBeVisible();
    await expect(forma.getByLabel("Exigir observação", { exact: true })).toHaveAttribute("data-testid", "top-campo-geral-observacao");
    await expect(forma.getByTestId("top-campo-geral-parceiro")).toHaveCount(0);
    await expect(forma.getByTestId("top-campo-geral-centro")).toHaveCount(0);
    await expect(forma.getByTestId("top-geral-exige-transportadora")).toHaveCount(0);

    // CÓDIGO E NOME → SALVAR: o POST sai com a família da Entrada e o NEUTRO DO 5 (nada foi mexido).
    await forma.getByTestId("top-aba-identificacao").click();
    await forma.getByTestId("top-campo-codigo").fill(codigo);
    await forma.getByTestId("top-campo-nome").fill(uniq("Entrada AS-1"));
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await post).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "POST 201").toBe(201);
    expect(corpo.codigo).toBe(codigo);
    expect(corpo.codigoBase, "a família vem do tipo escolhido").toBe(familiaEntrada);
    expect(corpo.configuracao?.versaoSchema, "a criação grava o formato 5").toBe(5);
    expect(corpo.configuracao, "o neutro do 5 do domínio, nada a mais").toEqual(configuracaoNeutraTopV5());
    await expect(forma).toBeHidden();

    id = await idDaTopCriada(page, codigo);
    const d = await detalheTopNoServidor(page, id);
    expect(d.versao, "a criação é UMA versão").toBe(1);
    expect(d.configuracaoSchema, "o servidor guardou no formato 5").toBe(5);
    expect(d.configuracao.suportada).toBe(true);
    expect(d.configuracao.valor?.versaoSchema).toBe(5);
  } finally {
    if (id) await excluirTopE2E(page, id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * AS-2 — TROCAR O TIPO: OS RÓTULOS DO TIPO, E NADA DO TIPO ANTERIOR FICA ESCONDIDO NO RASCUNHO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("AS-2 — Venda mostra 'Exigir cliente' e a ajuda nova; Automática; Trocar → Pedido de compra mostra 'Exigir fornecedor' sem Confirmação; o POST sai no neutro do 5", async ({ page }) => {
  await login(page);
  const catalogo = await catalogoPublicado(page);
  const familiaVenda = familiaDoTipo(catalogo, "venda");
  const familiaPedidoCompra = familiaDoTipo(catalogo, "pedido_compra");
  expect([familiaVenda, familiaPedidoCompra], "premissa: as famílias da venda e do pedido de compra").toEqual(["vendas.venda", "compras.pedido"]);

  await abrirTelaDeTops(page);
  const codigo = codigoTopE2E();
  let id: string | null = null;
  try {
    const forma = await abrirCriacao(page);
    await forma.getByTestId("top-assistente-tipo-venda").click();
    await forma.getByTestId("top-campo-codigo").fill(codigo);
    await forma.getByTestId("top-campo-nome").fill(uniq("Pedido de compra AS-2"));

    // VENDA: o rótulo do tipo ("cliente") e a ajuda nova, letra por letra — a antiga, proibida.
    await forma.getByTestId("top-aba-geral").click();
    await expect(forma.getByLabel("Exigir cliente", { exact: true }), "o parceiro da venda é o cliente").toHaveAttribute("data-testid", "top-campo-geral-parceiro");
    await expect(forma.getByText(TEXTOS.ajudaGeralFormato5, { exact: true }), "a ajuda da Geral do editor do 5").toBeVisible();
    await expect(forma.getByText(TEXTOS.ajudaGeralAntigaTrecho), "a ajuda do editor do 4 não aparece no do 5").toHaveCount(0);
    await expect(forma.getByTestId("top-aba-execucao"), "premissa: a venda tem execução configurada").toHaveCount(1);
    const confirmacao = forma.getByTestId("top-campo-geral-confirmacao");
    await confirmacao.selectOption("automatica");
    await expect(confirmacao).toHaveValue("automatica");

    // TROCAR → o passo 1 de novo, e o pedido de compra.
    await forma.getByTestId("top-aba-identificacao").click();
    await forma.getByTestId("top-assistente-trocar").click();
    await expect(forma.getByTestId("top-assistente")).toBeVisible();
    await expect(forma.getByTestId("top-campo-codigo")).toHaveCount(0);
    await forma.getByTestId("top-assistente-tipo-pedido_compra").click();

    // PEDIDO DE COMPRA: o rótulo do tipo ("fornecedor"); Confirmação some (o pedido só aceita Manual).
    await expect(forma.getByTestId("top-campo-codigo"), "código e nome digitados ficam: não dependem do tipo").toHaveValue(codigo);
    await expect(forma.getByTestId("top-campo-familia")).toHaveValue(new RegExp(`\\(${familiaPedidoCompra.replace(".", "\\.")}\\)$`));
    await forma.getByTestId("top-aba-geral").click();
    await expect(forma.getByLabel("Exigir fornecedor", { exact: true }), "o parceiro do pedido de compra é o fornecedor").toHaveAttribute("data-testid", "top-campo-geral-parceiro");
    await expect(forma.getByLabel("Exigir cliente", { exact: true })).toHaveCount(0);
    await expect(confirmacao, "o pedido de compra só aceita Manual: o campo some").toHaveCount(0);
    await expect(forma.getByTestId("top-aba-execucao"), "o pedido de compra não tem execução configurada").toHaveCount(0);

    // SALVAR → o POST no 5 com a Confirmação MANUAL: a Automática da venda não ficou escondida no rascunho.
    const post = page.waitForRequest(ehPostDeTop);
    const resposta = page.waitForResponse((r) => ehPostDeTop(r.request()));
    await page.getByTestId("top-salvar").click();
    const corpo = (await post).postDataJSON() as CorpoGravado;
    expect((await resposta).status(), "POST 201").toBe(201);
    expect(corpo.codigoBase).toBe(familiaPedidoCompra);
    expect(corpo.configuracao?.versaoSchema).toBe(5);
    expect(corpo.configuracao?.geral.confirmacao, "nada da venda foi junto").toBe("manual");
    expect(corpo.configuracao, "o neutro do 5, inteiro").toEqual(configuracaoNeutraTopV5());
    await expect(forma).toBeHidden();
    await expect(page.getByTestId("top-regras-passam-a-valer"), "a criação nunca pergunta").toHaveCount(0);

    id = await idDaTopCriada(page, codigo);
    const d = await detalheTopNoServidor(page, id);
    expect([d.versao, d.configuracaoSchema], "versão 1, no formato 5").toEqual([1, 5]);
    expect(d.configuracao.valor?.geral.confirmacao).toBe("manual");
  } finally {
    if (id) await excluirTopE2E(page, id);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * AS-3 — A RECUSA: A TOP ANTIGA COM O QUE O TIPO NÃO ACEITA VOLTA AO PADRÃO, AVISANDO ANTES
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("AS-3 — Entrada gravada no 4 com 'Exigir parceiro' e uma condição de pagamento: salvar sem mexer abre o diálogo com 'Exigir parceiro: Sim → Não' e 'Condições de pagamento: voltam ao padrão'; voltar não grava; 'Salvar assim mesmo' grava a versão 2 no 5, sem condição", async ({ page }) => {
  await login(page);
  await catalogoPublicado(page);
  // O 4 confere valor por valor, como sempre: a exigência de parceiro e uma condição de pagamento numa Entrada são
  // aceitas (201) — o 5 é que as recusa (a condição, enviada ou preservada: T5-4).
  const condicao = await api<{ id: string }>(page, "POST", "/api/resources/condicoes_pagamento", {
    nome: uniq("Condição AS-3"), parcelas: 1, dias_primeira_parcela: 30, modo: "intervalo", intervalo_dias: 30, entrada: false, is_active: true
  });
  expect(condicao.id, "premissa: a condição de pagamento foi criada").toBeTruthy();
  const codigoTop = codigoTopE2E();
  const criada = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo: codigoTop, codigoBase: "estoque.entrada", nome: uniq("Entrada AS-3"),
    configuracao: cfg4({}, (c) => ({ ...c, geral: { ...c.geral, exigeParceiro: true } })), condicoesPermitidas: [condicao.id]
  });
  expect(criada.id, "premissa: a Entrada no 4 com a condição foi criada").toBeTruthy();
  const top = { id: criada.id, codigo: codigoTop };
  const condicoesNoServidor = async () => (await api<{ condicoesPermitidas: { id: string }[] }>(page, "GET", `/api/admin/tipos-operacao/${top.id}`))
    .condicoesPermitidas.map((c) => c.id);
  const escritas: string[] = [];
  const registrar = (r: Request) => { if (ehEscritaDeTop(r)) escritas.push(`${r.method()} ${new URL(r.url()).pathname}`); };
  try {
    const antes = await detalheTopNoServidor(page, top.id);
    expect([antes.versao, antes.configuracaoSchema], "premissa: versão 1 no formato 4").toEqual([1, 4]);
    expect(antes.configuracao.valor?.geral.exigeParceiro, "premissa: o 4 aceitou 'Exigir parceiro' na Entrada").toBe(true);
    expect(await condicoesNoServidor(), "premissa: e a condição de pagamento").toEqual([condicao.id]);

    await abrirTelaDeTops(page);
    const forma = await abrirEditorDaTop(page, top.codigo);
    // O editor do 5: as abas da Entrada; a exigência de parceiro nem aparece — por isso a volta precisa ser DITA.
    await expect(abasDaTela(forma)).toHaveText(["Identificação", "Geral", "Estoque", "Aprovação"]);
    await forma.getByTestId("top-aba-geral").click();
    await expect(forma.getByTestId("top-campo-geral-observacao")).toBeVisible();
    await expect(forma.getByTestId("top-campo-geral-parceiro")).toHaveCount(0);

    // SALVAR SEM MEXER → o diálogo, e nada sai no fio.
    page.on("request", registrar);
    await page.getByTestId("top-salvar").click();
    const dialogo = page.getByTestId("top-regras-passam-a-valer");
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("Estas regras passam a valer");
    await expect(dialogo).toContainText("Estas opções voltam ao padrão, porque esta operação não as executa:");
    const voltam = dialogo.getByTestId("top-regra-volta-ao-padrao");
    // A exigência e a lista de condições — nessa ordem (a configuração e, depois, a lista que mora fora dela).
    await expect(voltam, "só o que o tipo não aceita: a exigência e as condições").toHaveText(["Exigir parceiro: Sim → Não", "Condições de pagamento: voltam ao padrão"]);
    await expect(dialogo.locator("[data-testid='top-regra-volta-ao-padrao'][data-caminho='geral.exigeParceiro']")).toHaveText("Exigir parceiro: Sim → Não");
    await expect(dialogo.locator("[data-testid='top-regra-volta-ao-padrao'][data-caminho='condicoesPermitidas']")).toHaveText("Condições de pagamento: voltam ao padrão");
    await expect(dialogo.getByTestId("top-regra-passa-a-valer"), "nada passa a executar (a vigente já é do 4)").toHaveCount(0);
    await expect(page.getByTestId("top-exigencias-passam-a-valer")).toHaveCount(0);

    // VOLTAR E REVISAR → fecha, o editor continua aberto, nenhuma escrita.
    await dialogo.getByTestId("top-regras-voltar").click();
    await expect(dialogo).toHaveCount(0);
    await expect(forma, "o editor continua aberto").toBeVisible();
    const aindaAntes = await detalheTopNoServidor(page, top.id);
    expect([aindaAntes.versao, aindaAntes.configuracaoSchema], "voltar não grava").toEqual([1, 4]);
    expect(await condicoesNoServidor(), "e a condição continua").toEqual([condicao.id]);
    expect(escritas, "nenhum PUT saiu ao voltar").toEqual([]);

    // SALVAR → SALVAR ASSIM MESMO → PUT no 5 com a exigência desligada.
    await page.getByTestId("top-salvar").click();
    await expect(dialogo).toBeVisible();
    const put = page.waitForRequest(ehPutDaTop(top.id));
    const resposta = page.waitForResponse((r) => ehPutDaTop(top.id)(r.request()));
    await dialogo.getByTestId("top-regras-salvar").click();
    const corpo = (await put).postDataJSON() as CorpoGravado & { condicoesPermitidas?: string[] };
    expect((await resposta).status(), "PUT 200 (o 5 sem o que o tipo não aceita passa no servidor)").toBe(200);
    expect(corpo.configuracao?.versaoSchema, "o corpo enviado é o formato 5").toBe(5);
    expect(corpo.configuracao?.geral.exigeParceiro, "a exigência voltou a Não").toBe(false);
    expect(corpo.configuracao, "o resto era o neutro: o neutro do 5, inteiro").toEqual(configuracaoNeutraTopV5());
    expect(corpo.condicoesPermitidas, "a lista de condições vai VAZIA (ausente, o servidor preservaria a lida e recusaria)").toEqual([]);
    await expect(forma).toBeHidden();

    const depois = await detalheTopNoServidor(page, top.id);
    expect([depois.versao, depois.configuracaoSchema], "a volta ao padrão é mudança: versão 2, no formato 5").toEqual([2, 5]);
    expect(depois.configuracao.valor?.versaoSchema).toBe(5);
    expect(depois.configuracao.valor?.geral.exigeParceiro).toBe(false);
    expect(await condicoesNoServidor(), "a versão 2 não carrega condição").toEqual([]);
  } finally {
    page.off("request", registrar);
    await excluirTopE2E(page, top.id);
  }
});
