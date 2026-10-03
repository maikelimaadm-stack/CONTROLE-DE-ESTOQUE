import { test, expect, type Page, type Response } from "@playwright/test";
import { entendeSaldoInicialEstoque, familiaOperacionalDeDocumentoEstoque } from "@agro/domain";
import { api, login } from "./helpers";
import { cadastroDeEstoque, escolherNaReferencia, hojeISO, incluirItemNaCentralDeEstoque } from "./estoque-01-comum";
import { cfg5, criarTopViaApi, detalheTopNoServidor, excluirTopE2E, type TopE2E } from "./top-config-08-comum";

/**
 * CONFIGURAÇÕES › IMPLANTAÇÃO › SALDOS INICIAIS DE ESTOQUE — A PORTA PARA A CENTRAL (OPERACOES-01 F11, decisão 288),
 * IM-1 a IM-3.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────────┐
 * │ A integração (`f11-saldo-inicial.test.ts`) prova no servidor o `opening_balance`, a recusa da         │
 * │ duplicidade nas duas portas, o cancelamento, o estorno e a concorrência. O que ela não alcança é a  │
 * │ TELA: que a Implantação troca o "Adicionar novo" pelo "Lançar saldo inicial" quando há TOP marcada, │
 * │ que ele leva à Central de Estoque com a TOP, que a Central confirma o saldo inicial e mostra a      │
 * │ recusa da duplicidade com a mensagem do servidor, e que sem TOP marcada a tela de hoje volta, com a  │
 * │ dica de como marcar.                                                                                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * FIXTURE PRÓPRIA: a TOP marcada e o produto nascem no teste, pela API; a TOP é excluída no `finally`. O banco do E2E é
 * COMPARTILHADO: outra TOP marcada pode existir. IM-1 escolhe a TOP do teste na MESMA resposta do `operation-types` que
 * a tela leu (direto com uma, pelo menu com várias). IM-3 desativa as outras marcadas ativas (sobras; o E2E roda em
 * série) e as reativa no fim, para o ramo "sem TOP marcada" rodar SEMPRE — afirmado sobre a resposta que a tela leu.
 */

const MENSAGEM = "Já existe estoque inicial confirmado para este produto/local de estoque/lote";
const DICA = "Para lançar o saldo inicial pela Central de Estoque, marque \"Lança o saldo inicial\" na aba Implantação de um tipo de operação de entrada (Configurações › Operações › Tipos de operação).";
const ROTA_IMPLANTACAO = "/configuracoes?tab=implantacao&sub=estoque";

/** A família da entrada pelo registry, conferida à mão. */
function familiaDaEntrada(): string {
  const f = familiaOperacionalDeDocumentoEstoque("entrada");
  expect(f, "premissa: a família da entrada no registry").toBe("estoque.entrada");
  return f!;
}

/** A TOP de entrada no 5 com "Lança o saldo inicial" ligado — conferida no servidor. */
async function criarTopMarcada(page: Page, rotulo: string): Promise<TopE2E> {
  const top = await criarTopViaApi(page, familiaDaEntrada(), cfg5({}, (c) => ({ ...c, implantacao: { saldoInicial: true } })), { rotulo });
  const lida = await detalheTopNoServidor(page, top.id);
  expect((lida.configuracao.valor as { implantacao?: unknown }).implantacao, "premissa: o servidor guarda a TOP marcada").toEqual({ saldoInicial: true });
  return top;
}

type TopsDaEntrada = { capacidades?: unknown; items?: { id: string; name: string; saldoInicial?: unknown }[] };
const ehOperationTypesDaEntrada = (r: Response) => new URL(r.url()).pathname === "/api/estoque/entradas/operation-types" && r.request().method() === "GET";

/** Abre a Implantação e devolve a resposta do `operation-types` da entrada QUE A TELA LEU. */
async function abrirImplantacao(page: Page): Promise<TopsDaEntrada> {
  const resposta = page.waitForResponse(ehOperationTypesDaEntrada);
  await page.goto(ROTA_IMPLANTACAO);
  await expect(page.getByRole("heading", { name: "Estoques Iniciais" }), "premissa: a Implantação abriu").toBeVisible();
  const r = await resposta;
  expect(r.status(), "premissa: a API respondeu a lista de TOPs de entrada").toBe(200);
  return (await r.json()) as TopsDaEntrada;
}

/** As TOPs marcadas da resposta (o booleano próprio do item), e a premissa: a capacidade está declarada. */
function marcadasDa(lida: TopsDaEntrada): { id: string; name: string }[] {
  expect(entendeSaldoInicialEstoque(lida.capacidades), "premissa: a API declara `saldoInicial`").toBe(true);
  return (lida.items ?? []).filter((x) => x.saldoInicial === true);
}

/** O "Lançar saldo inicial" leva à Central de entrada com ESTA TOP (direto com uma; pelo menu com várias). */
async function lancarPelaImplantacao(page: Page, marcadas: { id: string; name: string }[], top: TopE2E) {
  const botao = page.getByTestId("implantacao-saldo-inicial");
  await expect(botao).toHaveText("Lançar saldo inicial");
  await botao.click();
  if (marcadas.length > 1) await page.getByRole("menuitem", { name: top.nome, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/estoque/movimentacoes/entradas/new\\?tipo_operacao_id=${top.id}$`));
}

type DocLido = { situacao: string; movimentos: { movement_type: string; quantity: string }[] };

test("IM-1 — com TOP marcada: a Implantação mostra só 'Lançar saldo inicial', que leva à Central; a entrada confirmada é o Estoque inicial", async ({ page }) => {
  await login(page);
  const top = await criarTopMarcada(page, "Saldo inicial IM-1");
  try {
    const c = await cadastroDeEstoque(page);
    const lida = await abrirImplantacao(page);
    const marcadas = marcadasDa(lida);
    expect(marcadas.map((x) => x.id), "premissa: a TOP do teste está entre as marcadas que a tela leu").toContain(top.id);
    await expect(page.getByRole("button", { name: "Adicionar novo" }), "uma porta só: o 'Adicionar novo' antigo não aparece").toHaveCount(0);
    await expect(page.getByTestId("implantacao-saldo-inicial-dica")).toHaveCount(0);
    await expect(page.getByText("Os saldos iniciais lançados pela Central de Estoque aparecem em Estoque › Movimentações.", { exact: false })).toBeVisible();
    await lancarPelaImplantacao(page, marcadas, top);

    const central = page.getByTestId("estoque-central");
    await expect(central).toHaveAttribute("data-especie", "entrada");
    await expect(page.getByTestId("estoque-central-top"), "a TOP marcada vem travada").toHaveAttribute("data-tipo-operacao-id", top.id);
    await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);
    await incluirItemNaCentralDeEstoque(page, { nomeProduto: c.nomeProduto, quantidade: "3", custo: "4" });
    await page.getByTestId("estoque-salvar").click();
    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/entradas\/[0-9a-f-]{36}$/);
    const id = /\/estoque\/movimentacoes\/entradas\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
    await expect(central).toHaveAttribute("data-situacao", "aberto");
    await page.getByTestId("estoque-confirmar").click();
    await expect(page.getByTestId("estoque-previa")).toBeVisible();
    await page.getByTestId("estoque-previa-confirmar").click();
    await expect(central).toHaveAttribute("data-situacao", "confirmado");

    const doc = await api<DocLido>(page, "GET", `/api/estoque/entradas/${id}`);
    expect(doc.movimentos.map((m) => [m.movement_type, m.quantity]), "no servidor: o Estoque inicial, não a entrada comum").toEqual([["opening_balance", "3.0000"]]);
  } finally {
    await excluirTopE2E(page, top.id);
  }
});

test("IM-2 — o segundo saldo inicial da mesma chave pela Central: a confirmação mostra a recusa do servidor e o documento fica aberto", async ({ page }) => {
  await login(page);
  const top = await criarTopMarcada(page, "Saldo inicial IM-2");
  try {
    const c = await cadastroDeEstoque(page);
    const corpo = { empresa_id: c.empresa, tipo_operacao_id: top.id, armazem_id: c.armazem, data_documento: hojeISO(), itens: [{ produto_id: c.produto, quantidade: "2", custo_unitario: "5" }] };
    const primeiro = await api<{ id: string }>(page, "POST", "/api/estoque/entradas", corpo);
    await api(page, "POST", `/api/estoque/entradas/${primeiro.id}/confirmar`, {});
    const vivo = await api<DocLido>(page, "GET", `/api/estoque/entradas/${primeiro.id}`);
    expect(vivo.movimentos.map((m) => m.movement_type), "premissa: o primeiro saldo inicial está vivo").toEqual(["opening_balance"]);
    const segundo = await api<{ id: string }>(page, "POST", "/api/estoque/entradas", { ...corpo, itens: [{ produto_id: c.produto, quantidade: "7", custo_unitario: "5" }] });

    await page.goto(`/estoque/movimentacoes/entradas/${segundo.id}`);
    const central = page.getByTestId("estoque-central");
    await expect(central).toHaveAttribute("data-situacao", "aberto");
    const confirmar = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/estoque/entradas/${segundo.id}/confirmar` && r.request().method() === "POST");
    await page.getByTestId("estoque-confirmar").click();
    await expect(page.getByTestId("estoque-previa")).toBeVisible();
    await page.getByTestId("estoque-previa-confirmar").click();
    const r = await confirmar;
    expect(r.status(), "o servidor recusa a duplicidade").toBe(409);
    await expect(page.getByTestId("estoque-central-erros"), "a recusa aparece no documento").toContainText(MENSAGEM);
    await expect(central, "o documento continua aberto").toHaveAttribute("data-situacao", "aberto");

    const lido = await api<DocLido>(page, "GET", `/api/estoque/entradas/${segundo.id}`);
    expect([lido.situacao, lido.movimentos], "no servidor: aberto, nenhum movimento").toEqual(["aberto", []]);
  } finally {
    await excluirTopE2E(page, top.id);
  }
});

/**
 * As OUTRAS TOPs marcadas e ativas (sobra de uma execução anterior que não limpou: o E2E roda em série, `workers: 1`,
 * e cada teste exclui a sua TOP no `finally`) são DESATIVADAS para o ramo "sem TOP marcada" rodar sempre — e
 * reativadas no fim (`reativarTops`). Devolve os ids que desativou.
 */
async function desativarOutrasMarcadas(page: Page): Promise<string[]> {
  const lida = await api<TopsDaEntrada>(page, "GET", "/api/estoque/entradas/operation-types");
  const ids = (lida.items ?? []).filter((x) => x.saldoInicial === true).map((x) => x.id);
  for (const id of ids) {
    const t = await detalheTopNoServidor(page, id);
    await api(page, "PUT", `/api/admin/tipos-operacao/${id}`, { ativo: false, revisao: t.revisao });
  }
  return ids;
}

async function reativarTops(page: Page, ids: string[]) {
  for (const id of ids) {
    await detalheTopNoServidor(page, id)
      .then((t) => api(page, "PUT", `/api/admin/tipos-operacao/${id}`, { ativo: true, revisao: t.revisao }))
      .catch((e: unknown) => { console.warn(`[f11-implantacao] reativação da TOP ${id} falhou: ${String(e)}`); });
  }
}

test("IM-3 — sem TOP marcada ativa (a do teste desativada): o 'Adicionar novo' de hoje e a dica; a TOP desativada não é oferecida", async ({ page }) => {
  await login(page);
  const top = await criarTopMarcada(page, "Saldo inicial IM-3");
  const desativadas = await desativarOutrasMarcadas(page);
  try {
    expect(desativadas, "premissa: a TOP do teste estava entre as marcadas ativas antes de desativá-la").toContain(top.id);
    const lida = await abrirImplantacao(page);
    const marcadas = marcadasDa(lida);
    expect((lida.items ?? []).map((x) => x.id), "premissa: a TOP desativada não está na lista que a tela leu").not.toContain(top.id);
    expect(marcadas, "premissa: nenhuma TOP marcada ativa na resposta que a tela leu").toEqual([]);
    await expect(page.getByRole("button", { name: "Adicionar novo" }), "sem TOP marcada: o 'Adicionar novo' de hoje").toBeVisible();
    await expect(page.getByTestId("implantacao-saldo-inicial")).toHaveCount(0);
    await expect(page.getByTestId("implantacao-saldo-inicial-dica")).toHaveText(DICA);
    // O "Adicionar novo" é o diálogo antigo, como hoje.
    await page.getByRole("button", { name: "Adicionar novo" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Novo estoque inicial" })).toBeVisible();
  } finally {
    await reativarTops(page, desativadas.filter((id) => id !== top.id));
    await excluirTopE2E(page, top.id);
  }
});
