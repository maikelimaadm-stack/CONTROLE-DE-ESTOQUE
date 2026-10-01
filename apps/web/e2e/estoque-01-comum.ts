import { expect, type Page } from "@playwright/test";
import { api, uniq, empresaAtiva, primeiroId } from "./helpers";

/**
 * O CADASTRO DOS TESTES DO DOCUMENTO DE ESTOQUE (ESTOQUE-01, decisão 274) — de quem é este arquivo e por quê.
 *
 * Dois specs precisam das mesmas peças: o E2E da tela (`estoque-01-documento.spec.ts`) e o sentido 2 do version
 * skew (`estoque-01-skew-web-anterior.spec.ts`). Duplicado, cada um envelheceria por conta própria no dia em que o
 * contrato do documento mudar. Não mora em `helpers.ts` porque aquele arquivo é de outra PR aberta (#79): aqui só
 * se IMPORTA dele.
 *
 * Tudo nasce pela API, no próprio teste: a produção não tem TOP de estoque (nenhuma), e o seed também não — a
 * conta nunca depende do que outro spec deixou no banco. Cada execução cria as PRÓPRIAS TOPs e o PRÓPRIO produto.
 * Nada é apagado (decisão 247): o que o teste cria fica, com nome único.
 */
export type EspecieEstoqueE2E = "entrada" | "saida" | "transferencia" | "ajuste";

type Opcao = { id: string; label: string };
export type Saldo = { quantity: string; average_cost?: string };

const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
/** Data de hoje no fuso do navegador do teste — a mesma que a Central põe por padrão no campo. */
export const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Uma TOP da família `estoque.<espécie>`, cadastrada pela API administrativa (sem execução configurada: o movimento é o da espécie). */
export async function criarTopDeEstoque(page: Page, especie: EspecieEstoqueE2E): Promise<{ id: string; codigo: string }> {
  const codigo = `7${Math.floor(Math.random() * 900000 + 100000)}`;
  const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: `estoque.${especie}`, nome: uniq(`ES ${especie}`) });
  return { id: top.id, codigo };
}

/**
 * Produto NOVO que controla estoque, sem lote (o padrão do cadastro), e o primeiro armazém da empresa efetiva —
 * a mesma empresa que a Central escolhe sozinha (`useEmpresaPadrao`), para o armazém escolhido na tela ser
 * oferecido pelo filtro de empresa dela.
 */
export async function cadastroDeEstoque(page: Page) {
  const unidades = await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options");
  const un = unidades.find((u) => u.label.toUpperCase() === "UN");
  expect(un, "premissa: o seed tem a unidade UN").toBeTruthy();
  const grupos = await api<Opcao[]>(page, "GET", "/api/resources/product_groups/options?kind=analytic");
  expect(grupos.length, "premissa: há grupo de produto analítico").toBeGreaterThan(0);
  // Produto que controla estoque exige natureza de custo (CHECK chk_product_fin_cat da 0002).
  const naturezas = await api<Opcao[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  expect(naturezas.length, "premissa: há natureza de despesa analítica").toBeGreaterThan(0);
  const produto = await api<{ id: string }>(page, "POST", "/api/resources/products", { description: uniq("ES-W produto"), group_id: grupos[0]!.id, measurement_id: un!.id, financial_category_id: naturezas[0]!.id });
  const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${produto.id}`);
  expect(lido["control_stock"], "premissa: o produto novo controla estoque (padrão do cadastro)").toBe(true);
  const empresa = await empresaAtiva(page);
  const armazem = await primeiroId(page, `/api/resources/warehouses?empresa_id=${empresa}&pageSize=1`);
  const nomeArmazem = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${armazem}`))["description"]);
  return { produto: produto.id, nomeProduto: String(lido["description"]), empresa, armazem, nomeArmazem };
}

/** O saldo do par (armazém × produto) que o SERVIDOR diz — produto sem saldo responde zero, nunca erro. */
export async function saldoNoServidor(page: Page, armazem: string, produto: string): Promise<Saldo> {
  return api<Saldo>(page, "GET", `/api/stock/balances/${armazem}/${produto}`).catch(() => ({ quantity: "0" }));
}

/**
 * Lança e confirma uma ENTRADA pela API — a partida de saldo dos casos que não são sobre a entrada (o ajuste do
 * ES-W2, o ledger do sentido 2 do skew). A confirmação vai sem corpo de efeito: `{}` é o corpo vazio que o
 * contrato estrito aceita.
 */
export async function entradaConfirmadaPelaApi(page: Page, c: { top: string; empresa: string; armazem: string; produto: string }, quantidade: string, custo: string) {
  const doc = await api<{ id: string; codigo: string; situacao: string }>(page, "POST", "/api/estoque/entradas", {
    empresa_id: c.empresa, tipo_operacao_id: c.top, armazem_id: c.armazem, data_documento: hojeISO(),
    itens: [{ produto_id: c.produto, quantidade, custo_unitario: custo }]
  });
  expect(doc.situacao, "a entrada nasce aberta").toBe("aberto");
  const confirmado = await api<{ situacao: string; movimentos: number }>(page, "POST", `/api/estoque/entradas/${doc.id}/confirmar`, {});
  expect(confirmado, "a entrada confirmada gerou um movimento").toMatchObject({ situacao: "confirmado", movimentos: 1 });
  return doc;
}

/** Escolhe num RefSelect (o `combobox` do campo) pelo nome — o nome vai escapado (nomes do seed têm colchetes). */
export async function escolherNaReferencia(page: Page, campo: import("@playwright/test").Locator, nome: string) {
  await campo.getByRole("combobox").first().click();
  await page.getByPlaceholder("Pesquisar...").fill(nome.slice(0, 20));
  await page.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}
