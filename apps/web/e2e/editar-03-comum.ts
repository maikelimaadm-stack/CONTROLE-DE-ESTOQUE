import { execFileSync } from "node:child_process";
import type { Locator, Page, Request, Response } from "@playwright/test";
import { api, empresaAtiva, uniq } from "./helpers";
import { expect, codigoTop, criarCadastro, criarTop, doSeed, referenciasDoSeed } from "./central-compras-fixtures";
import { cfg5 } from "./top-config-08-comum";
import { hojeISO } from "./estoque-01-comum";

/**
 * AS PEÇAS COMUNS DOS E2E DA EDITAR-03 (decisão 315) — a edição do documento de venda pela tela.
 *
 * Dois specs as usam: `editar-03-venda.spec.ts` (a pílula, a abertura, o Salvar, o 409, a trava do armazém, o aviso do
 * Salvar que confirma) e `editar-03-criacao.spec.ts` (a criação de venda continua a mesma). Os cadastros nascem pela
 * API, no caso, pela porta com LIMPEZA (`central-compras-fixtures.ts`: o `test` dela exclui no fim o que o caso criou);
 * natureza de receita e centro vêm do seed pelo NOME. Os DOCUMENTOS ficam (o ledger é imutável — decisão 247).
 *
 * O SERVIDOR É O ÁRBITRO: a premissa e a conclusão de cada caso são lidas na API (`GET :id`, `GET /edicao`), no FIO (o
 * corpo da PATCH, a `Idempotency-Key`, as portas pedidas) ou no BANCO do E2E — só SELECT, pelo `psql`, com o UUID
 * conferido antes de entrar na consulta e sem a conexão em mensagem nenhuma.
 */

export type Cadastro = { id: string; nome: string };
export type Variante = "budget" | "order" | "sale";
export const SEGMENTO: Record<Variante, "budgets" | "orders" | "sales"> = { budget: "budgets", order: "orders", sale: "sales" };
/** A espécie como a tela a escreve no título da edição ("Editar orçamento de venda 0007": a família da TOP gravada). */
export const ESPECIE: Record<Variante, string> = { budget: "orçamento de venda", order: "pedido de venda", sale: "venda" };
/** A dica da pílula Editar habilitada: "Editar <o título do registro na consulta>" ("Orçamento", "Pedido de venda", "Venda"). */
export const DICA_DO_EDITAR: Record<Variante, string> = { budget: "Editar orçamento", order: "Editar pedido de venda", sale: "Editar venda" };

/* Os textos que o servidor e a tela dizem, por extenso (o texto é contrato). */
export const MSG_NAO_EDITAVEL = "Documento não editável neste status";
export const MSG_SEM_TOP = "Este documento não tem tipo de operação (registro anterior às operações) e não pode ser editado.";
export const MSG_PARTES_ATIVAS = "Este documento já tem partes geradas, e os itens não podem mais ser trocados. Para faturar o resto, converta outra parte; para parar, encerre o saldo.";
export const MSG_PARTE_RESERVA_ARMAZEM = "O local de estoque deste item vem do pedido de origem, que reserva estoque no local de estoque de cada item: não pode ser trocado. Para mudar, cancele esta venda e gere de novo.";
export const MSG_DOCUMENTO_MUDOU = "Este documento mudou desde que você o abriu. Recarregue antes de salvar.";
export const MSG_NADA_MUDOU = "Nada mudou: o documento continua como estava.";
export const MSG_SALVO = "Salvo com sucesso";
export const MSG_SALVO_E_CONFIRMADO = "Salvo e confirmado.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ═════════════════════════════════════ OS CADASTROS DO CASO ═════════════════════════════════════ */

export interface CenarioDeVenda {
  empresa: string; tag: string; natureza: Cadastro; centro: Cadastro; cliente: Cadastro;
  /** Dois locais da empresa ativa. */
  l1: Cadastro; l2: Cadastro;
  /** P1 e P2 controlam estoque; P3 não. */
  p1: Cadastro; p2: Cadastro; p3: Cadastro;
}

/**
 * Os cadastros: L1 e L2, P1/P2 (controlam estoque) e P3 (não controla), um cliente; natureza de receita e centro do seed.
 * `saldo` (padrão 10) de P1 e de P2 em L1 entra por saldo inicial — `saldo: false` deixa o estoque vazio (o caso que
 * precisa da criação SEM confirmar numa TOP Automática).
 */
export async function cenarioDeVenda(page: Page, rotulo: string, o: { saldo?: string | false } = {}): Promise<CenarioDeVenda> {
  const empresa = await empresaAtiva(page);
  const tag = `e3${rotulo.replace(/[^a-z0-9]/gi, "").toLowerCase()}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const ref = await referenciasDoSeed(page);
  const natureza = await doSeed(page, "/api/resources/financial_categories/options?kind=analytic&nature=income", "Venda de Boi Gordo");
  const local = async (sigla: string): Promise<Cadastro> => {
    const { id } = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `${sigla}${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: `E3 ${sigla} ${tag}`, type: "inputs" });
    const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${id}`);
    expect(lido["empresa_id"], `premissa: ${sigla} é da empresa do documento`).toBe(empresa);
    return { id, nome: String(lido["description"]) };
  };
  const produto = async (sigla: string, controla: boolean): Promise<Cadastro> => {
    const { id } = await criarCadastro(page, "products", {
      description: `E3 ${sigla} ${tag}`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id, control_stock: controla
    });
    const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${id}`);
    expect(lido["control_stock"], `premissa: ${sigla} ${controla ? "controla" : "NÃO controla"} estoque`).toBe(controla);
    return { id, nome: String(lido["description"]) };
  };
  const l1 = await local("L1"); const l2 = await local("L2");
  const p1 = await produto("P1", true); const p2 = await produto("P2", true); const p3 = await produto("P3", false);
  const { id: clienteId } = await criarCadastro(page, "people", { name: `E3 cliente ${tag}`, person_type: "legal", is_client: true });
  const cliente = { id: clienteId, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${clienteId}`))["name"]) };
  if (o.saldo !== false) for (const p of [p1, p2]) await darSaldo(page, empresa, l1, p, o.saldo ?? "10");
  return { empresa, tag, natureza: { id: natureza.id, nome: natureza.label }, centro: { id: ref.centro.id, nome: ref.centro.label }, cliente, l1, l2, p1, p2, p3 };
}

export const saldoNoServidor = (page: Page, local: Cadastro, produto: Cadastro) => api<{ quantity: string }>(page, "GET", `/api/stock/balances/${local.id}/${produto.id}`).then((s) => s.quantity);

/** Saldo inicial de `quantidade` do produto no local (a premissa é lida no servidor). */
export async function darSaldo(page: Page, empresa: string, local: Cadastro, produto: Cadastro, quantidade: string) {
  const antes = Number(await saldoNoServidor(page, local, produto));
  await api(page, "POST", "/api/stock/opening-balances", { empresa_id: empresa, warehouse_id: local.id, product_id: produto.id, quantity: quantidade, unit_value: "3" });
  expect(Number(await saldoNoServidor(page, local, produto)), `premissa: o saldo de ${produto.nome} em ${local.nome} subiu ${quantidade}`).toBe(antes + Number(quantidade));
}

/** As TOPs do caso: orçamento e pedido no neutro do servidor; venda no formato 5 (`confirmacao`: Manual por padrão). */
export async function topDeVenda(page: Page, variante: Variante, rotulo: string, extra: Record<string, unknown> = {}): Promise<string> {
  const codigoBase = variante === "budget" ? "vendas.orcamento" : variante === "order" ? "vendas.pedido" : "vendas.venda";
  return (await criarTop(page, { codigo: codigoTop("E3"), codigoBase, nome: uniq(`E3 ${rotulo} ${ESPECIE[variante]}`), ...extra })).id;
}
export const topDeVendaManual = (page: Page, rotulo: string) => topDeVenda(page, "sale", `${rotulo} manual`, { configuracao: cfg5() });
export const topDeVendaAutomatica = (page: Page, rotulo: string) => topDeVenda(page, "sale", `${rotulo} automática`, { configuracao: cfg5({ confirmacao: "automatica" }) });

/* ═════════════════════════════════════ OS DOCUMENTOS ═════════════════════════════════════ */

export type ItemLido = { id: string; product_id: string; warehouse_id: string | null; quantity: string; unit_price: string; note: string | null };
export type DocLido = {
  id: string; code: string; kind: string; status: string; version: string; note: string | null; total: string; freight: string;
  tipo_operacao_id: string | null; categoria_financeira_id: string | null; centro_custo_id: string | null; client_id: string; items: ItemLido[];
};
export const lerDoc = (page: Page, v: Variante, id: string) => api<DocLido>(page, "GET", `/api/sales/${SEGMENTO[v]}/${id}`);
export type ItemNovo = { product_id: string; warehouse_id: string | null; quantity: string; unit_price: string };

/** O documento pela API (o POST de sempre), com cliente, natureza e centro do caso; devolve o `GET :id`. */
export async function criarDoc(page: Page, v: Variante, c: CenarioDeVenda, top: string | null, items: ItemNovo[], extra: Record<string, unknown> = {}): Promise<DocLido> {
  const { id } = await api<{ id: string }>(page, "POST", `/api/sales/${SEGMENTO[v]}`, {
    empresa_id: c.empresa, document_date: hojeISO(), client_id: c.cliente.id, categoria_financeira_id: c.natureza.id, centro_custo_id: c.centro.id,
    note: "nota gravada", items, ...(top ? { tipo_operacao_id: top } : {}), ...extra
  });
  return lerDoc(page, v, id);
}

/* ═════════════════════════════════════ O BANCO DO E2E (só SELECT) ═════════════════════════════════════ */

const BANCO = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";

/** Uma leitura do banco do E2E. A falha sai com a saída de erro do psql SEM a conexão (nenhuma URL na mensagem). */
function lerDoBanco(consulta: string): string {
  try {
    return execFileSync("psql", [BANCO, "-v", "ON_ERROR_STOP=1", "-Atc", consulta], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (erro) {
    const saida = String((erro as { stderr?: unknown }).stderr ?? "").replace(/postgres(ql)?:\/\/\S+/gi, "<conexão>");
    throw new Error(`a leitura do banco do E2E falhou: ${saida.slice(0, 300)}`);
  }
}
const uuidConferido = (id: string) => { expect(id, "premissa: o id que entra na consulta é um UUID").toMatch(UUID); return id; };

/** O que o documento produziu em estoque e financeiro, contado pela ORIGEM (as linhas que a confirmação grava). */
export function efeitosNoBanco(documentoId: string): { movimentos: number; titulos: number; valores: string[]; situacao: string } {
  const id = uuidConferido(documentoId);
  const movimentos = Number(lerDoBanco(`select count(*) from erp.stock_movements where source_type = 'sales_documents' and source_id = '${id}'`));
  const titulos = lerDoBanco(`select amount::text from erp.financial_titles where source_type = 'sales_documents' and source_id = '${id}' order by amount`);
  const situacao = lerDoBanco(`select status from erp.sales_documents where id = '${id}'`);
  const valores = titulos ? titulos.split("\n") : [];
  return { movimentos, titulos: valores.length, valores, situacao };
}

/** Os itens do documento NO BANCO, em ordem: `id|produto|local`. */
export function itensNoBanco(documentoId: string): string[] {
  const id = uuidConferido(documentoId);
  const linhas = lerDoBanco(`select id::text || '|' || product_id::text || '|' || coalesce(warehouse_id::text, '-') from erp.sales_document_items where document_id = '${id}' order by position, id`);
  return linhas ? linhas.split("\n") : [];
}

/* ═════════════════════════════════════ O FIO ═════════════════════════════════════ */

export const caminho = (r: Request | Response) => new URL(r.url()).pathname;
/**
 * As portas de apoio do LANÇAMENTO, que pedem `.create` (A0): a edição não pergunta nenhuma. As regras, o layout e a
 * situação do cliente, de QUALQUER variante; as TOPs do lançamento, da variante do PRÓPRIO documento. As TOPs de OUTRA
 * variante (a do destino da conversão pela cadeia de compatibilidade) são da CONSULTA, cujos hooks continuam montados
 * por baixo da edição no lugar — e só para quem tem o `.create` daquela variante; ficam registradas à parte.
 */
const PORTAS_DE_APOIO = /^\/api\/sales\/(budgets|orders|sales)\/(regras-da-operacao|layout-efetivo|situacao-cliente)$/;
const TOPS_DO_LANCAMENTO = /^\/api\/sales\/(budgets|orders|sales)\/operation-types$/;

/**
 * Ouve a página: as escritas de documento de venda (sempre) e — só com a JANELA DA EDIÇÃO aberta (`abrirJanela`, do
 * clique em Editar até o clique que fecha a edição) — os pedidos às portas do lançamento e as respostas 403 de
 * `/api/sales`. Fora da janela é a CONSULTA que está na tela, e ela (para quem tem `.create`) pergunta as portas do
 * lançamento por conta própria (o "Novo documento"): isso não é da edição.
 */
export function ouvirOFio(page: Page, v?: Variante) {
  const escritas: string[] = []; const portasDaCriacao: string[] = []; const topsDeOutraVariante: string[] = []; const recusas403: string[] = [];
  let janela = false;
  const pedido = (r: Request) => {
    const p = caminho(r);
    if (["PATCH", "POST", "PUT", "DELETE"].includes(r.method()) && /^\/api\/sales\/(budgets|orders|sales)(\/|$)/.test(p)) escritas.push(`${r.method()} ${p}`);
    if (!janela) return;
    if (PORTAS_DE_APOIO.test(p) || (TOPS_DO_LANCAMENTO.test(p) && (!v || p === `/api/sales/${SEGMENTO[v]}/operation-types`))) portasDaCriacao.push(`${r.method()} ${p}`);
    else if (TOPS_DO_LANCAMENTO.test(p)) topsDeOutraVariante.push(`${r.method()} ${p}`);
  };
  const resposta = (r: Response) => { if (janela && r.status() === 403 && caminho(r).startsWith("/api/sales/")) recusas403.push(`${r.request().method()} ${caminho(r)}`); };
  page.on("request", pedido); page.on("response", resposta);
  return {
    escritas, portasDaCriacao, topsDeOutraVariante, recusas403,
    abrirJanela: () => { janela = true; }, fecharJanela: () => { janela = false; },
    parar: () => { janela = false; page.off("request", pedido); page.off("response", resposta); }
  };
}

/* ═════════════════════════════════════ A TELA ═════════════════════════════════════ */

export const editar = (page: Page) => page.getByTestId("vendas-editar");
export const identidade = (page: Page) => page.getByTestId("central-vendas-identidade-nome");
export const salvar = (page: Page) => page.getByTestId("central-vendas-salvar");
export const linhas = (page: Page) => page.getByTestId("central-vendas-itens").getByTestId("central-vendas-linha");
export const toast = (page: Page, texto: string) => page.locator("[data-sonner-toast]").filter({ hasText: texto });
export const dialogo = (page: Page) => page.getByTestId("confirm-dialog");
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/** A consulta do documento, aberta e assentada (o nome é o código do documento). */
export async function abrirConsulta(page: Page, v: Variante, doc: DocLido) {
  await page.goto(`/vendas/${SEGMENTO[v]}/${doc.id}`);
  await expect(identidade(page), "premissa: a consulta desenhou ESTE documento").toHaveText(doc.code);
}

/** O título da edição: "Editar <espécie> <código>". */
export const tituloDaEdicao = (v: Variante, doc: DocLido) => `Editar ${ESPECIE[v]} ${doc.code}`;

/**
 * Clica em Editar e espera a Central em modo edição, aberta pelo `GET :id` + `GET /edicao` (o `/edicao` devolvido como a
 * tela o recebeu). A pílula tem de estar habilitada ANTES (a pergunta da consulta já voltou).
 */
export async function abrirEdicao(page: Page, v: Variante, doc: DocLido): Promise<Record<string, unknown>> {
  await expect(editar(page), "o Editar está habilitado").toBeEnabled();
  const base = `/api/sales/${SEGMENTO[v]}/${doc.id}`;
  const doFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `${base}/edicao`);
  const documentoNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === base);
  await editar(page).click();
  const [resposta] = await Promise.all([doFio, documentoNoFio]);
  expect(resposta.status(), "o /edicao respondeu").toBe(200);
  const corpo = (await resposta.json()) as Record<string, unknown>;
  await expect(identidade(page), "a Central abriu NO LUGAR da consulta, em modo edição").toHaveText(tituloDaEdicao(v, doc));
  await expect(salvar(page), "o Salvar destravou (layout e regras do /edicao)").toBeEnabled();
  return corpo;
}

/** Salva a edição (o Salvar da barra) e devolve a PATCH que saiu no fio. */
export async function salvarEdicao(page: Page, v: Variante, doc: DocLido, clicar: () => Promise<void> = () => salvar(page).click()) {
  const alvo = `/api/sales/${SEGMENTO[v]}/${doc.id}`;
  const resposta = page.waitForResponse((r) => r.request().method() === "PATCH" && caminho(r) === alvo);
  await clicar();
  const r = await resposta;
  const corpoDaResposta = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { corpo: r.request().postDataJSON() as Record<string, unknown>, status: r.status(), chave: r.request().headers()["idempotency-key"], resposta: corpoDaResposta };
}

/** Abre uma aba do painel inferior da Central (consulta ou edição). */
export async function abrirAba(page: Page, nome: "Totais" | "Financeiro" | "Frete e transporte" | "Fiscal" | "Observações") {
  const aba = page.getByTestId("central-vendas-painel").getByRole("tab", { name: nome });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
}

/** A observação do documento na edição (o campo da aba Observações). */
export async function campoDaObservacao(page: Page): Promise<Locator> {
  await abrirAba(page, "Observações");
  return page.getByTestId("central-vendas-painel").getByLabel("Observação", { exact: true });
}

/** O Editar presente e DESABILITADO com o motivo do servidor (na dica e em `data-motivo`) — o MESMO do `/edicao` e da PATCH. */
export async function editarDesabilitado(page: Page, v: Variante, doc: DocLido, motivo: string) {
  await expect(editar(page), "o Editar aparece (quem vê tem .edit e .view)").toBeVisible();
  await expect(editar(page), "e está desabilitado").toBeDisabled();
  await expect(editar(page), "com o motivo em data-motivo").toHaveAttribute("data-motivo", motivo);
  await expect(editar(page), "e na dica").toHaveAttribute("data-dica", motivo);
  const doServidor = await api<{ podeEditar: boolean; motivo: string | null }>(page, "GET", `/api/sales/${SEGMENTO[v]}/${doc.id}/edicao`);
  expect([doServidor.podeEditar, doServidor.motivo], "o motivo da tela é o MESMO do /edicao").toEqual([false, motivo]);
}

/** Pesquisa na célula da linha (produto ou local) pelo NOME inteiro e escolhe. */
export async function escolherNaCelula(page: Page, celula: Locator, nome: string) {
  await celula.click();
  const painel = page.getByTestId("central-vendas-pesquisa");
  await expect(painel).toBeVisible();
  await painel.getByRole("combobox").fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(painel).toHaveCount(0);
  await expect(celula).toContainText(nome);
}
