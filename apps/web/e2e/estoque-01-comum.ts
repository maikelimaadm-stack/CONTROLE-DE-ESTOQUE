import { expect, type Page } from "@playwright/test";
import { familiaOperacionalDeDocumentoEstoque, type ConfiguracaoTipoOperacao } from "@agro/domain";
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
 *
 * OPERACOES-01 F5b (decisão 282): as SETE espécies (as três da movimentação interna — requisição, consumo e devolução
 * de consumo — entraram na F5a), a TOP com configuração opcional (o formato 5, com Destino e Fluxo) e o item lançado
 * pela Central de Estoque no MOTOR (`incluirItemNaCentralDeEstoque`). `escolherNaReferencia` continua: é o campo de
 * referência dos Dados principais (e o da Central de antes, que o skew sentido 2 ainda dirige).
 */
export type EspecieEstoqueE2E = "entrada" | "saida" | "transferencia" | "ajuste" | "requisicao" | "consumo" | "devolucao_consumo";

type Opcao = { id: string; label: string };
export type Saldo = { quantity: string; average_cost?: string };

const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
/** Data de hoje no fuso do navegador do teste — a mesma que a Central põe por padrão no campo. */
export const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * Uma TOP da família da espécie, cadastrada pela API administrativa (sem execução configurada: o movimento é o da
 * espécie). A FAMÍLIA é perguntada ao registry (`familiaOperacionalDeDocumentoEstoque`: a requisição é
 * `estoque.requisicao_material`, não `estoque.requisicao`). `configuracao` ausente = o servidor grava o neutro dele;
 * presente (o formato 5 de `cfg5`, com Destino e Fluxo) vai como está, e o servidor a confere.
 */
export async function criarTopDeEstoque(page: Page, especie: EspecieEstoqueE2E, configuracao?: ConfiguracaoTipoOperacao): Promise<{ id: string; codigo: string }> {
  const codigo = `7${Math.floor(Math.random() * 900000 + 100000)}`;
  const codigoBase = familiaOperacionalDeDocumentoEstoque(especie);
  expect(codigoBase, `premissa: o registry declara a família da espécie ${especie}`).toBeTruthy();
  const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo, codigoBase, nome: uniq(`ES ${especie}`), ...(configuracao ? { configuracao } : {})
  });
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

/**
 * INCLUI UM ITEM NA CENTRAL DE ESTOQUE NO MOTOR (OPERACOES-01 F5b): "Adicionar produto" (a barra da grade) → a linha
 * nova, marcada → a pesquisa de produto do motor (`central-estoque-pesquisa`, pela descrição) → a quantidade (ou a
 * contada, no ajuste: a MESMA coluna do motor, com o rótulo da espécie), o custo e o lote nos campos da linha, pelos
 * rótulos acessíveis do motor ("Quantidade do item <n>", "Valor unitário do item <n>", "Lote do item <n>"). A linha nova
 * nasce EM BRANCO (nada inventado): o que não for passado fica vazio.
 *
 * A pesquisa das espécies que tiram do local (saída, transferência, requisição, consumo) vem com "Só com saldo neste
 * local" ligado. O produto SEM saldo (o caso que lança a saída sem saldo de propósito, para ver a recusa) só aparece com o
 * filtro desligado: se o produto não vem e o filtro está à vista, ele é desligado — e o produto tem de aparecer. A
 * decisão só sai DEPOIS de a pesquisa do termo responder (a lista sem "Carregando…", com o termo no campo): o filtro já
 * está à vista desde a pesquisa vazia da abertura, e decidir antes desligaria o filtro à toa — mascarando, nas espécies
 * de saída, a regressão do "Só com saldo" (M-2 da revisão da F5b).
 *
 * `naoOferecidos`: produtos cujo nome TAMBÉM casa com o termo e que a pesquisa da Central NÃO pode oferecer (o que não
 * controla estoque — a Central de Estoque pede `soControlaEstoque`). Conferidos na lista do termo, antes do filtro.
 */
export async function incluirItemNaCentralDeEstoque(page: Page, o: { nomeProduto: string; quantidade?: string; contada?: string; custo?: string; lote?: string; naoOferecidos?: readonly string[] }) {
  const linhas = page.getByTestId("central-estoque-linha");
  const antes = await linhas.count();
  await page.getByTestId("central-estoque-adicionar-item").click();
  await expect(linhas, "a linha nova entrou na grade").toHaveCount(antes + 1);
  const linha = linhas.nth(antes);
  const n = antes + 1;
  await linha.getByTestId("central-estoque-produto").click();
  const pesquisa = page.getByTestId("central-estoque-pesquisa");
  const termo = o.nomeProduto.slice(0, 20);
  const campoDaBusca = pesquisa.getByPlaceholder("Pesquisar pela descrição");
  await campoDaBusca.fill(termo);
  await expect(campoDaBusca, "o termo está no campo da pesquisa").toHaveValue(termo);
  await expect(pesquisa.getByRole("listbox").getByText("Carregando…", { exact: true }), "a pesquisa do termo respondeu (antes de decidir pelo filtro)").toHaveCount(0);
  const opcao = pesquisa.getByRole("option", { name: literal(termo) }).first();
  for (const nome of o.naoOferecidos ?? []) {
    expect(nome.startsWith(termo), `premissa: "${nome}" casa com o termo "${termo}" (a ausência dele prova o recorte, não a busca)`).toBe(true);
    await expect(pesquisa.getByRole("option", { name: literal(nome) }), `"${nome}" não é oferecido pela pesquisa da Central de Estoque`).toHaveCount(0);
  }
  const filtro = pesquisa.getByTestId("central-estoque-pesquisa-so-com-saldo");
  await expect(opcao.or(filtro).first(), "o produto, ou o filtro do saldo que o esconde").toBeVisible();
  if (!(await opcao.isVisible())) await filtro.locator("input").uncheck();
  await opcao.click();
  await expect(pesquisa, "a pesquisa fecha com o produto escolhido").toHaveCount(0);
  const quantidade = o.contada ?? o.quantidade;
  if (quantidade !== undefined) await linha.getByLabel(`Quantidade do item ${n}`).fill(quantidade);
  if (o.custo !== undefined) await linha.getByLabel(`Valor unitário do item ${n}`).fill(o.custo);
  if (o.lote !== undefined) await linha.getByLabel(`Lote do item ${n}`).fill(o.lote);
  return linha;
}
