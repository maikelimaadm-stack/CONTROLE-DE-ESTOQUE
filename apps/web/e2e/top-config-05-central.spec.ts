import { test, expect, type Page, type Request } from "@playwright/test";
import {
  configuracaoNeutraTopV3, LAYOUT_DO_SISTEMA, textoSituacaoAtraso,
  type ConfiguracaoTipoOperacaoV3, type EstruturaLayout, type SituacaoClienteResposta
} from "@agro/domain";
import { login, adicionarItemNaCentral, api, uniq, pickRef, empresaAtiva, escolherPrimeiroProdutoDaLinha, preencherClassificacaoFinanceira, abrirAbaDoLancamento } from "./helpers";
import { criarParceiro } from "./aj02-comum";

/**
 * TOP-CONFIG-05 (TR-W2) — AS REGRAS DA OPERAÇÃO NA CENTRAL, PELA TELA (API e banco REAIS; nada mockado).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────┐
 * │ Com uma TOP de Pedido no FORMATO 3 (exige transportadora, cliente em atraso "bloqueia", tolerância │
 * │ 0, duas condições permitidas) e um layout LIGADO que NÃO mostra a Transportadora:                  │
 * │ (a) o campo aparece mesmo assim, com "*" e `data-exigido-top="1"`;                                │
 * │ (b) salvar sem ele → erro no campo e NENHUM POST /api/sales/orders;                               │
 * │ (c) o seletor de condição só oferece as duas permitidas;                                          │
 * │ (d) cliente EM ATRASO → faixa "bloqueia" e Salvar desabilitado;                                   │
 * │ (e) a TOP em "avisa" (versão nova pelo PUT) → faixa "avisa" e o Pedido SALVA (201).               │
 * │ A linha `central-layout-efetivo` continua lá, igual, em todos os passos.                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Anti-vacuidade: toda ausência (opção proibida, POST que não saiu, faixa ausente) vem depois de uma presença
 * positiva do mesmo alvo — senão um seletor errado deixaria o teste verde.
 * Fixtures pela API oficial; limpeza no `finally` (TOP e layout desligados, título cancelado, condições inativas).
 */

const FAMILIA = "vendas.pedido";
const SEGMENTO = "orders";
const TRANSPORTADORA = "transporter_id";
const rotaDaCentral = (top: string) => `/vendas/${SEGMENTO}/new?tipo_operacao_id=${top}`;
const LAYOUTS = "/api/admin/layouts-documento";

/** Data ISO (UTC) deslocada em dias a partir de hoje — só para montar o título vencido. */
const hojeMais = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

type Condicao = { id: string; nome: string };
type DetalheTop = { revisao: number; configuracao: { valor: ConfiguracaoTipoOperacaoV3 } };
type Efetivo = { origem: string; id: string | null };

async function criarCondicao(page: Page, nome: string): Promise<Condicao> {
  const c = await api<{ id: string }>(page, "POST", "/api/resources/condicoes_pagamento", {
    nome, parcelas: 1, dias_primeira_parcela: 30, modo: "intervalo", intervalo_dias: 30, entrada: false, is_active: true
  });
  return { id: c.id, nome };
}

/** Configuração formato 3 a partir do NEUTRO do domínio (um dono só): só as três chaves medidas mudam. */
function configuracaoDaTop(politica: "bloqueia" | "avisa"): ConfiguracaoTipoOperacaoV3 {
  const n = configuracaoNeutraTopV3();
  return {
    ...n,
    geral: { ...n.geral, exigeTransportadora: true },
    financeiro: { ...n.financeiro, clienteEmAtraso: politica, toleranciaAtrasoDias: 0 },
  };
}

/** O layout do sistema do Pedido SEM a Transportadora (aba que ficar vazia sai junto). */
function estruturaSemTransportadora(): EstruturaLayout {
  const s = LAYOUT_DO_SISTEMA(FAMILIA);
  return {
    ...s,
    cabecalho: s.cabecalho.filter((c) => c.campo !== TRANSPORTADORA),
    rodape: s.rodape.map((a) => ({ ...a, campos: a.campos.filter((c) => c.campo !== TRANSPORTADORA) })).filter((a) => a.campos.length > 0),
  };
}

async function situacaoCliente(page: Page, cliente: string, top: string): Promise<SituacaoClienteResposta> {
  return api<SituacaoClienteResposta>(page, "GET", `/api/sales/${SEGMENTO}/situacao-cliente?client_id=${cliente}&tipo_operacao_id=${top}`);
}

/** Abre a Central do Pedido com a TOP e confere que a linha do layout efetivo é a do layout ligado. */
async function abrirCentral(page: Page, top: string, layoutId: string) {
  await page.goto(rotaDaCentral(top));
  await expect(page.getByTestId("top-contexto"), "a Central abriu o formulário desta TOP").toBeVisible();
  const efetivo = page.getByTestId("central-layout-efetivo");
  await expect(efetivo, "a linha do layout efetivo continua presente").toBeVisible();
  await expect(efetivo).toHaveAttribute("data-origem", "ligado");
  await expect(efetivo).toHaveAttribute("data-layout-id", layoutId);
}

/** Cliente, 1 item de 1 × 100,00 e a classificação do seed — tudo o que o Salvar pede além das regras da TOP. */
async function preencherDocumento(page: Page, cliente: string) {
  await pickRef(page, "Cliente", cliente);
  await adicionarItemNaCentral(page);
  await escolherPrimeiroProdutoDaLinha(page);
  const linha = page.getByTestId("central-vendas-linha").first();
  await linha.getByLabel("Quantidade").fill("1");
  await linha.getByLabel("Valor unitário").fill("100");
  await preencherClassificacaoFinanceira(page);
}

const campoTransportadora = (page: Page) => page.getByTestId(`central-campo-${TRANSPORTADORA}`);
const botaoSalvar = (page: Page) => page.getByRole("button", { name: "Salvar", exact: true });
const faixaAtraso = (page: Page) => page.getByTestId("central-faixa-atraso");
const ehPostDePedido = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === `/api/sales/${SEGMENTO}`;

test("TR-W2 — TOP de Pedido formato 3 na Central: transportadora exigida aparece fora do layout, condições filtradas, cliente em atraso bloqueia e, em 'avisa', salva", async ({ page }) => {
  await login(page);
  const marca = Date.now().toString(36);
  const condicoes: string[] = [];
  const layouts: string[] = [];
  const tops: string[] = [];
  const titulos: string[] = [];
  const pedidos: string[] = [];
  try {
    const empresa = await empresaAtiva(page);

    // ── Condições: duas permitidas e uma de fora, todas com o mesmo marcador (a busca mostra as três candidatas).
    const token = `TRW2${marca}`;
    const permitidaA = await criarCondicao(page, `${token} A permitida`); condicoes.push(permitidaA.id);
    const permitidaB = await criarCondicao(page, `${token} B permitida`); condicoes.push(permitidaB.id);
    const proibida = await criarCondicao(page, `${token} C fora`); condicoes.push(proibida.id);

    // ── A TOP de Pedido no formato 3, com as duas condições permitidas.
    const codigo = `5t${marca}${Math.random().toString(36).slice(2, 5)}`;
    const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
      codigo, codigoBase: FAMILIA, nome: uniq("TR-W2 Pedido"),
      configuracao: configuracaoDaTop("bloqueia"), condicoesPermitidas: [permitidaA.id, permitidaB.id]
    });
    tops.push(top.id);
    const regras = await api<{ formato: number; exigencias: string[]; condicoesPermitidas: string[] | null; clienteEmAtraso: { politica: string } }>(
      page, "GET", `/api/sales/${SEGMENTO}/regras-da-operacao?tipo_operacao_id=${top.id}`);
    expect(regras.formato, "premissa: a TOP gravou no formato 3").toBe(3);
    expect(regras.exigencias, "premissa: a transportadora é exigida").toContain(TRANSPORTADORA);
    expect([...(regras.condicoesPermitidas ?? [])].sort(), "premissa: a lista de condições gravou").toEqual([permitidaA.id, permitidaB.id].sort());
    expect(regras.clienteEmAtraso.politica).toBe("bloqueia");

    // ── O layout ligado à TOP, SEM a Transportadora (o do sistema mostra todas).
    const layout = await api<{ id: string }>(page, "POST", LAYOUTS, { familia: FAMILIA, nome: uniq("TR-W2 sem transportadora"), estrutura: estruturaSemTransportadora() });
    layouts.push(layout.id);
    await api(page, "PUT", `${LAYOUTS}/${layout.id}/tops`, { tipoOperacaoIds: [top.id] });
    const gravado = await api<{ estrutura: EstruturaLayout }>(page, "GET", `${LAYOUTS}/${layout.id}`);
    const camposDoLayout = [...gravado.estrutura.cabecalho, ...gravado.estrutura.rodape.flatMap((a) => a.campos)].map((c) => c.campo);
    expect(camposDoLayout, "presença: o layout gravado tem o Cliente").toContain("client_id");
    expect(camposDoLayout, "premissa: o layout gravado NÃO tem a Transportadora").not.toContain(TRANSPORTADORA);
    const efetivo = await api<Efetivo>(page, "GET", `/api/sales/${SEGMENTO}/layout-efetivo?tipo_operacao_id=${top.id}`);
    expect([efetivo.origem, efetivo.id], "premissa: a Central desta TOP usa o layout ligado").toEqual(["ligado", layout.id]);

    // ── Clientes: um em dia e um EM ATRASO (título a receber vencido há 30 dias, pela rota financeira).
    const nomeEmDia = uniq(`Em dia TRW2 ${marca}`);
    const nomeAtrasado = uniq(`Atrasado TRW2 ${marca}`);
    const emDia = await criarParceiro(page, { name: nomeEmDia });
    const atrasado = await criarParceiro(page, { name: nomeAtrasado });
    const categoria = (await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/financial_categories?kind=analytic&nature=income&pageSize=1")).items[0]?.id;
    const centro = (await api<{ items: { id: string }[] }>(page, "GET", "/api/resources/cost_centers?kind=analytic&pageSize=1")).items[0]?.id;
    expect(categoria && centro, "premissa: há categoria de receita e centro analíticos para o rateio do título").toBeTruthy();
    const vencido = hojeMais(-30);
    const titulo = await api<{ id: string }>(page, "POST", "/api/financial/receivables", {
      empresa_id: empresa, number: `TRW2-${marca}`, person_id: atrasado.id, amount: "50.00",
      emission_date: vencido, due_date: vencido, note: "TOP-CONFIG-05 TR-W2 — título vencido",
      apportionment: [{ financial_category_id: categoria, cost_center_id: centro, percentage: "100" }]
    });
    titulos.push(titulo.id);
    const situacao = await situacaoCliente(page, atrasado.id, top.id);
    expect(situacao.politica, "premissa: a política da versão atual é bloqueia").toBe("bloqueia");
    if (situacao.politica === "nao_valida") throw new Error("premissa: a política não pode ser nao_valida");
    expect([situacao.emAtraso, situacao.titulos], "premissa: o cliente está em atraso com 1 título").toEqual([true, 1]);
    const situacaoEmDia = await situacaoCliente(page, emDia.id, top.id);
    expect(situacaoEmDia.politica === "nao_valida" ? null : situacaoEmDia.emAtraso, "premissa: o outro cliente está em dia").toBe(false);

    // ── (a) A Central: o campo exigido aparece mesmo fora do layout, com "*" e a marca da TOP.
    await abrirCentral(page, top.id, layout.id);
    await abrirAbaDoLancamento(page, "Frete e transporte");
    await expect(campoTransportadora(page), "(a) a Transportadora aparece mesmo sem estar no layout").toBeVisible();
    await expect(campoTransportadora(page)).toHaveAttribute("data-exigido-top", "1");
    await expect(campoTransportadora(page)).toContainText("Transportadora");
    await expect(campoTransportadora(page), "(a) com o asterisco de obrigatório").toContainText("*");

    // ── (b) Salvar sem transportadora: erro no campo e NENHUM POST.
    await preencherDocumento(page, nomeEmDia);
    const postsDePedido: string[] = [];
    page.on("request", (r) => { if (ehPostDePedido(r)) postsDePedido.push(r.url()); });
    await expect(faixaAtraso(page), "cliente em dia: sem faixa").toHaveCount(0);
    await expect(botaoSalvar(page), "cliente em dia: o Salvar está habilitado").toBeEnabled();
    await botaoSalvar(page).click();
    await abrirAbaDoLancamento(page, "Frete e transporte");
    await expect(campoTransportadora(page), "(b) o erro aparece NO campo").toContainText(/obrigatóri/i);
    expect(postsDePedido, "(b) nenhum POST /api/sales/orders saiu").toEqual([]);

    // ── (c) O seletor de condição só oferece as duas permitidas.
    await abrirAbaDoLancamento(page, "Financeiro");
    const condicao = page.getByTestId("condicao-pagamento");
    await expect(condicao, "o campo da condição existe na aba").toBeVisible();
    await condicao.locator("button").first().click();
    await page.getByPlaceholder("Pesquisar...").fill(token);
    const opcoes = page.locator("[data-radix-popper-content-wrapper]").last();
    await expect(opcoes.getByRole("option", { name: new RegExp(escapar(permitidaA.nome)) }), "(c) a permitida A é oferecida").toBeVisible();
    await expect(opcoes.getByRole("option", { name: new RegExp(escapar(permitidaB.nome)) }), "(c) a permitida B é oferecida").toBeVisible();
    await expect(opcoes.getByRole("option", { name: new RegExp(escapar(proibida.nome)) }), "(c) a de fora NÃO é oferecida").toHaveCount(0);
    await expect(opcoes.getByRole("option", { name: new RegExp(escapar(token)) }), "(c) só as duas").toHaveCount(2);
    await page.keyboard.press("Escape");

    // ── (d) Cliente EM ATRASO com "bloqueia": faixa vermelha e Salvar desabilitado.
    await pickRef(page, "Cliente", nomeAtrasado);
    await expect(faixaAtraso(page), "(d) a faixa de atraso aparece").toBeVisible();
    await expect(faixaAtraso(page)).toHaveAttribute("data-politica", "bloqueia");
    await expect(faixaAtraso(page)).toContainText(textoSituacaoAtraso(situacao));
    await expect(botaoSalvar(page), "(d) o Salvar fica desabilitado").toBeDisabled();
    expect(postsDePedido, "(d) e continua sem POST").toEqual([]);
    await expect(page.getByTestId("central-layout-efetivo"), "a linha do layout efetivo continua presente").toBeVisible();

    // ── (e) A TOP em "avisa" (versão nova pelo PUT; condições ausentes = preservadas): faixa amarela e o Pedido SALVA.
    const detalhe = await api<DetalheTop>(page, "GET", `/api/admin/tipos-operacao/${top.id}`);
    const atual = detalhe.configuracao.valor;
    await api(page, "PUT", `/api/admin/tipos-operacao/${top.id}`, {
      revisao: detalhe.revisao, configuracao: { ...atual, financeiro: { ...atual.financeiro, clienteEmAtraso: "avisa" } }
    });
    const situacaoAvisa = await situacaoCliente(page, atrasado.id, top.id);
    expect(situacaoAvisa.politica, "premissa: a versão nova avisa").toBe("avisa");
    const regrasAvisa = await api<{ condicoesPermitidas: string[] | null }>(page, "GET", `/api/sales/${SEGMENTO}/regras-da-operacao?tipo_operacao_id=${top.id}`);
    expect([...(regrasAvisa.condicoesPermitidas ?? [])].sort(), "premissa: o PUT sem a lista preservou as condições").toEqual([permitidaA.id, permitidaB.id].sort());

    const transportadora = uniq(`Transp TRW2 ${marca}`);
    await criarParceiro(page, { name: transportadora, is_transporter: true });
    postsDePedido.length = 0;
    await abrirCentral(page, top.id, layout.id);
    await preencherDocumento(page, nomeAtrasado);
    await expect(faixaAtraso(page), "(e) a faixa de atraso aparece").toBeVisible();
    await expect(faixaAtraso(page)).toHaveAttribute("data-politica", "avisa");
    await expect(faixaAtraso(page)).toContainText(textoSituacaoAtraso(situacao));
    await abrirAbaDoLancamento(page, "Frete e transporte");
    await expect(campoTransportadora(page)).toHaveAttribute("data-exigido-top", "1");
    await pickRef(page, "Transportadora", transportadora);
    await expect(botaoSalvar(page), "(e) em 'avisa' o Salvar fica habilitado").toBeEnabled();
    const resposta = page.waitForResponse((r) => ehPostDePedido(r.request()));
    await botaoSalvar(page).click();
    const r = await resposta;
    expect(r.status(), "(e) o Pedido foi criado").toBe(201);
    const { id } = await r.json() as { id: string };
    pedidos.push(id);
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    expect([corpo["client_id"], corpo["tipo_operacao_id"]], "o corpo leva o cliente em atraso e a TOP").toEqual([atrasado.id, top.id]);
    expect(corpo[TRANSPORTADORA], "e a transportadora escolhida").toBeTruthy();
    await expect(page.getByTestId("central-layout-efetivo"), "a linha do layout efetivo continua presente").toHaveCount(1);
  } finally {
    for (const id of pedidos) await api(page, "POST", `/api/sales/${SEGMENTO}/${id}/cancel`, {}).catch(() => undefined);
    for (const id of titulos) await api(page, "POST", `/api/financial/receivables/${id}/cancel`, {}).catch(() => undefined);
    for (const id of layouts) await api(page, "PUT", `${LAYOUTS}/${id}/tops`, { tipoOperacaoIds: [] }).catch(() => undefined);
    for (const id of layouts) await api(page, "POST", `${LAYOUTS}/${id}/ativo`, { ativo: false }).catch(() => undefined);
    for (const id of tops) {
      await api<{ revisao: number }>(page, "GET", `/api/admin/tipos-operacao/${id}`)
        .then((t) => api(page, "PUT", `/api/admin/tipos-operacao/${id}`, { ativo: false, revisao: t.revisao }))
        .catch(() => undefined);
    }
    for (const id of condicoes) await api(page, "PUT", `/api/resources/condicoes_pagamento/${id}`, { is_active: false }).catch(() => undefined);
  }
});
