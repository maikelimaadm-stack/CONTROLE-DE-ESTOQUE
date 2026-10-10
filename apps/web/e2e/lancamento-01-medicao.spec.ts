import type { Locator, Page } from "@playwright/test";
import { LAYOUT_DO_SISTEMA, configuracaoNeutraTopV5, validarEstruturaLayout, type ConfiguracaoTipoOperacaoV5, type EstruturaLayout } from "@agro/domain";
import { api, empresaAtiva, login, uniq } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, doSeed, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";

/**
 * LANCAMENTO-01 (F1, decisão 311) — A MEDIÇÃO: quantos campos o operador TEM de tocar para salvar, na Central de
 * Compras REAL, uma compra que gera título e um pedido de compra que gera o previsto, com a TOP no formato 5 e os cinco
 * padrões financeiros configurados. O mesmo arquivo mede o ANTES (na main) e o DEPOIS (no HEAD da fatia): ele só
 * REGISTRA os números (linhas `LANC-MEDIDA …` no console e anotações do teste) — nenhum número é asserção.
 *
 * ┌─ O MÉTODO (o gesto do operador, sem atalho) ───────────────────────────────────────────────────────┐
 * │ Abre a criação pela rota da Central (`/compras/<segmento>/new?tipo_operacao_id=…`), NÃO preenche     │
 * │ nada, registra o que a tela já trouxe preenchido e pede o Salvar. A cada volta: se a tela listou     │
 * │ pendências (zero POST), preenche a PRIMEIRA; se o servidor recusou (4xx), preenche o campo que a     │
 * │ recusa aponta; se o servidor gravou (201), para. A lista do que foi tocado é a medida (M1, M1-E, M2).│
 * │ Uma premissa do cenário entra antes do Salvar: com produto na linha e o total ZERO, o valor unitário │
 * │ é digitado — sem ele a compra não gera título e o pedido não promete previsto (o salvar passaria,    │
 * │ mas mediria outro documento). Ele entra na medida, com o gatilho "premissa do cenário".               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * OS CENÁRIOS (cada um com a PRÓPRIA TOP, criada pela API administrativa no formato 5, com os cinco padrões —
 * natureza de despesa, centro de resultado, tipo de título, forma de pagamento e conta — e sem layout próprio: a
 * Central usa o layout que o servidor resolve para ela, e o teste registra qual):
 *   · M1   — COMPRA, execução "Comportamento legado" (a compra gera título pelo padrão), `financeiroPadrao` neutro;
 *   · M1-E — COMPRA, execução CONFIGURADA: estoque "Entrada" exigindo o local, financeiro "A pagar" exigindo forma de
 *            pagamento e vencimento — o caso em que a regra da TOP cobra campos que o padrão financeiro também tem;
 *   · M2   — PEDIDO DE COMPRA, `financeiroPadrao` com a provisão ligada (o previsto a pagar ao finalizar).
 *
 * M3 e M4 são calculados AQUI, campo a campo, sem suposição: a fonte de cada campo é LIDA no banco do E2E (o detalhe da
 * TOP, o cadastro do produto e o do local), e o "caminho de padrão hoje" é a pergunta ao PRÓPRIO domínio
 * (`validarEstruturaLayout`: o layout da família aceita um padrão de cadastro neste campo?). Campo de M1 sem
 * classificação reprova: a medição não inventa a fonte de um campo que não conhece.
 *
 * AS ASSERÇÕES SÃO PREMISSAS (anti-vácuo), nunca a contagem: a TOP tem os cinco padrões e o formato 5; a regra da
 * operação diz o que o cenário promete (gera título; as exigências da execução configurada); o Salvar passou no fim; o
 * documento existe com a TOP e total maior que zero; a prévia do SERVIDOR diz que a compra gera título a pagar e que o
 * pedido finaliza; e Fornecedor e Produto continuam sendo perguntas (só o operador sabe).
 *
 * FIXTURE PRÓPRIA (`central-compras-fixtures.ts`): local de estoque, produto, fornecedor e TOP nascem no caso e saem no
 * fim pela exclusão lógica. Natureza, centro, tipo de título, forma e conta vêm do seed, pelo NOME. Os documentos
 * ficam (o ledger é imutável); nada é confirmado nem finalizado (só as prévias, que não gravam).
 */

const P = "central-compras";
const VALOR_UNITARIO = "125.50";
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));

type Medida = "M1" | "M1-E" | "M2";
interface Cenario {
  medida: Medida;
  especie: "compra" | "pedido";
  segmento: "compras" | "pedidos";
  familia: string;
  resumo: string;
  configuracao: () => ConfiguracaoTipoOperacaoV5;
}

const CENARIOS: readonly Cenario[] = [
  {
    medida: "M1", especie: "compra", segmento: "compras", familia: "compras.compra",
    resumo: "COMPRA · formato 5 neutro: execução 'Comportamento legado' (estoque e financeiro pelo padrão: entrada e título a pagar), financeiroPadrao neutro (provisão desligada, o documento troca, padrão legado) + os 5 padrões",
    configuracao: () => configuracaoNeutraTopV5()
  },
  {
    medida: "M1-E", especie: "compra", segmento: "compras", familia: "compras.compra",
    resumo: "COMPRA · formato 5 com a execução CONFIGURADA: estoque 'Entrada' com exigeArmazem, financeiro 'A pagar' com exigeFormaPagamento e exigeVencimento; financeiroPadrao neutro + os 5 padrões",
    configuracao: () => {
      const c = configuracaoNeutraTopV5();
      return {
        ...c,
        execucao: { estoque: "configurada", financeiro: "configurada" },
        estoque: { ...c.estoque, atualizacao: "entrada", exigeArmazem: true },
        financeiro: { ...c.financeiro, atualizacao: "pagar", exigeFormaPagamento: true, exigeVencimento: true }
      };
    }
  },
  {
    medida: "M2", especie: "pedido", segmento: "pedidos", familia: "compras.pedido",
    resumo: "PEDIDO DE COMPRA · formato 5 neutro, financeiroPadrao com a PROVISÃO LIGADA (previsto a pagar ao finalizar; o documento troca; padrão legado) + os 5 padrões",
    configuracao: () => {
      const c = configuracaoNeutraTopV5();
      return { ...c, financeiroPadrao: { ...c.financeiroPadrao, provisao: true } };
    }
  }
];

interface PadraoLido { id: string; codigo?: string; nome?: string; descricao?: string }
type ChavePadrao = "natureza" | "centro" | "tipoTitulo" | "formaPagamento" | "conta";
interface DetalheDaTop {
  versao: number;
  configuracaoSchema: number;
  padroesFinanceiros: Record<ChavePadrao, PadraoLido | null> | null;
  configuracao: { valor?: { financeiroPadrao?: unknown } };
}
interface Montado {
  tag: string;
  empresa: string;
  local: { id: string; nome: string; empresaId: string };
  produto: { id: string; nome: string; localPadraoId: string; naturezaDeCustoId: string; centroPadraoId: string };
  fornecedor: { id: string; nome: string };
  natureza: Opcao; centro: Opcao; tipoTitulo: Opcao; forma: Opcao; conta: { id: string; code: string; description: string };
  top: { id: string; codigo: string; nome: string };
  detalhe: DetalheDaTop;
  regras: Record<string, unknown>;
  layout: { origem: string; nome: string | null; id: string | null };
}

/** Uma linha de medida no console (o relatório do coordenador) e nas anotações do teste. */
function medir(rotulo: string, conteudo: unknown) {
  const linha = `LANC-MEDIDA ${rotulo} ${typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo)}`;
  console.log(linha);
  test.info().annotations.push({ type: "LANC-MEDIDA", description: linha });
}

/* ═════════════════════════════════════ A FIXTURE DO CENÁRIO ═════════════════════════════════════ */

async function montar(page: Page, c: Cenario): Promise<Montado> {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const tag = `LANC${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const local = await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `L${Date.now().toString(36).slice(-5).toUpperCase()}`, description: `${tag} local`, type: "inputs"
  });
  const localLido = await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${local.id}`);
  expect(localLido["empresa_id"], "premissa: o local é da empresa em que a Central abre o documento").toBe(empresa);

  // O produto como o seed os cria (seed.ts: todo produto com Local de estoque padrão): controla estoque, sem lote.
  const produto = await criarCadastro(page, "products", {
    description: `${tag} produto`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id,
    control_stock: true, controle_lote: "nenhum", default_warehouse_id: local.id
  });
  const produtoLido = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${produto.id}`);
  expect([produtoLido["control_stock"], produtoLido["controle_lote"], produtoLido["default_warehouse_id"]],
    "premissa: o produto controla estoque, sem lote, com o Local de estoque padrão no cadastro").toEqual([true, "nenhum", local.id]);

  const forn = await criarCadastro(page, "people", { name: uniq(`${tag} forn`), person_type: "legal", is_provider: true });
  const fornecedor = { id: forn.id, nome: texto((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${forn.id}`))["name"]) };

  const tipoTitulo = await doSeed(page, "/api/resources/title_types/options", "Boleto");
  const forma = await doSeed(page, "/api/resources/payment_methods/options", "Pix");
  const contas = await api<{ items: { id: string; code: string; description: string }[] }>(page, "GET", "/api/financial/bank-accounts/balances");
  const conta = contas.items.find((x) => x.code === "BB");
  expect(conta, "premissa: a conta BB do seed").toBeTruthy();

  const configuracao = c.configuracao();
  const codigo = codigoTop("LC");
  const nome = uniq(`LANC-01 ${c.medida}`);
  const top = await criarTop(page, {
    codigo, codigoBase: c.familia, nome, configuracao,
    padroesFinanceiros: { naturezaId: ref.natureza.id, centroCustoId: ref.centro.id, tipoTituloId: tipoTitulo.id, formaPagamentoId: forma.id, contaBancariaId: conta!.id }
  });

  // PREMISSAS DA TOP, lidas no servidor: o formato 5, a seção como foi enviada e os CINCO padrões.
  const detalhe = await api<DetalheDaTop>(page, "GET", `/api/admin/tipos-operacao/${top.id}`);
  expect([detalhe.versao, detalhe.configuracaoSchema], "premissa: versão 1, no formato 5").toEqual([1, 5]);
  expect(detalhe.configuracao.valor?.financeiroPadrao, "premissa: a seção financeiroPadrao gravada como enviada").toEqual(configuracao.financeiroPadrao);
  const p = detalhe.padroesFinanceiros;
  expect([p?.natureza?.id, p?.centro?.id, p?.tipoTitulo?.id, p?.formaPagamento?.id, p?.conta?.id], "premissa: a TOP tem os cinco padrões financeiros")
    .toEqual([ref.natureza.id, ref.centro.id, tipoTitulo.id, forma.id, conta!.id]);

  // A REGRA DA OPERAÇÃO que a Central lê (a mesma pergunta da tela) e o LAYOUT que o servidor resolve para a TOP.
  const regras = await api<Record<string, unknown>>(page, "GET", `/api/compras/${c.segmento}/regras-da-operacao?tipo_operacao_id=${top.id}`);
  if (c.especie === "compra") expect(regras["geraTitulos"], "premissa: a compra desta TOP gera título a pagar").toBe(true);
  if (c.medida === "M1-E") {
    expect([regras["exigeArmazem"], regras["exigeFormaPagamento"], regras["exigeVencimento"]], "premissa: a execução configurada exige local, forma e vencimento")
      .toEqual([true, true, true]);
  }
  const layout = await api<Record<string, unknown>>(page, "GET", `/api/compras/${c.segmento}/layout-efetivo?tipo_operacao_id=${top.id}`);
  expect(ehObj(layout["estrutura"]), "premissa: o servidor resolveu um layout para a TOP").toBe(true);

  return {
    tag, empresa,
    local: { id: local.id, nome: texto(localLido["description"]), empresaId: texto(localLido["empresa_id"]) },
    produto: {
      id: produto.id, nome: texto(produtoLido["description"]), localPadraoId: texto(produtoLido["default_warehouse_id"]),
      naturezaDeCustoId: texto(produtoLido["financial_category_id"]), centroPadraoId: texto(produtoLido["default_cost_center_id"])
    },
    fornecedor, natureza: ref.natureza, centro: ref.centro, tipoTitulo, forma, conta: conta!,
    top: { id: top.id, codigo, nome }, detalhe, regras,
    layout: { origem: texto(layout["origem"]), nome: typeof layout["nome"] === "string" ? layout["nome"] : null, id: typeof layout["id"] === "string" ? layout["id"] : null }
  };
}

/* ═════════════════════════════════════ A TELA ═════════════════════════════════════ */

interface CampoNaTela { zona: string; campo: string; nome: string; obrigatorio: boolean; preenchido: boolean; valor: string; visivel: boolean }

/** Os campos que a Central desenha (Dados principais, o Local de estoque do cabeçalho e a aba aberta do painel), como estão. */
async function lerCampos(page: Page): Promise<CampoNaTela[]> {
  const ler = (zona: string, alvo: Locator) => alvo.evaluateAll((els, z) => els.map((el) => {
    const caixa = el.querySelector('[data-parte="caixa"]');
    const oculto = caixa?.querySelector<HTMLInputElement>('input[type="hidden"]') ?? null;
    const entrada = caixa?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input:not([type="hidden"]), textarea, select') ?? null;
    const preenchido = Boolean(el.querySelector('[data-preenchido="true"]'));
    const soLeitura = !caixa?.hasAttribute("data-controle");
    const doSelect = entrada instanceof HTMLSelectElement ? entrada.selectedOptions[0]?.text ?? "" : "";
    const valor = oculto?.value || doSelect || entrada?.value || (preenchido || soLeitura ? (caixa?.textContent ?? "").trim() : "");
    return {
      zona: z, campo: el.getAttribute("data-campo") ?? el.getAttribute("data-testid") ?? "?",
      nome: (el.querySelector('[data-parte="rotulo"]')?.textContent ?? "").replace(/\s*\*\s*$/, "").trim(),
      obrigatorio: Boolean(el.querySelector('[data-parte="req"]')), preenchido, valor, visivel: el.getClientRects().length > 0
    };
  }), zona);
  return [
    ...(await ler("dados", page.getByTestId(`${P}-dados`).locator("[data-campo]"))),
    ...(await ler("dados", page.getByTestId(`${P}-local-padrao`))),
    ...(await ler("painel", page.getByTestId(`${P}-painel`).locator("[data-campo]")))
  ];
}

/** A linha N da grade como está (local, produto, quantidade, valor unitário). */
async function lerLinha(page: Page, i: number): Promise<Record<string, string>> {
  const linha = page.getByTestId(`${P}-linha`).nth(i);
  const celula = async (testId: string) => ((await linha.getByTestId(testId).count()) ? (await linha.getByTestId(testId).first().innerText()).trim() : "");
  const entrada = async (rotulo: string, testId: string) => {
    const e = linha.getByLabel(rotulo, { exact: true });
    return (await e.count()) ? await e.inputValue() : await celula(testId);
  };
  return {
    local: await celula(`${P}-armazem`), produto: await celula(`${P}-produto`),
    quantidade: await entrada(`Quantidade do item ${i + 1}`, `${P}-quantidade`),
    valorUnitario: await entrada(`Valor unitário do item ${i + 1}`, "-")
  };
}

/** O nome que a TELA dá ao campo: o rótulo do campo no cabeçalho, ou "Item N · <coluna da grade>". */
async function nomeNaTela(page: Page, caminho: string): Promise<string> {
  if (caminho === "itens") return "Itens";
  const item = /^itens\[(\d+)\]\.([a-z_]+)$/.exec(caminho);
  if (item) {
    const th = page.getByTestId("compras-itens").locator(`thead th[data-campo="${item[2]}"]`);
    const coluna = (await th.count()) ? (await th.first().innerText()).replace(/\s*\*\s*$/, "").trim() : item[2]!;
    return `Item ${Number(item[1]) + 1} · ${coluna}`;
  }
  const r = page.getByTestId(`${P}-dados`).locator(`[data-campo="${caminho}"] [data-parte="rotulo"]`);
  return (await r.count()) ? (await r.first().innerText()).replace(/\s*\*\s*$/, "").trim() : caminho;
}

/** `itens.0.x` → `itens[0].x` (os dois formatos de caminho do servidor). */
const normalizar = (c: string) => c.replace(/^itens\.(\d+)\./, "itens[$1].").replace(/^itens\.(\d+)$/, "itens[$1]");
/** `itens[0].x` → `itens[].x` (a chave da classificação, sem a linha). */
const chaveDoCampo = (c: string) => c.replace(/^itens\[\d+\]\./, "itens[].");

/** Os campos que uma recusa do servidor aponta, na ordem dela. */
function camposDaRecusa(corpo: unknown): { caminho: string; mensagem: string }[] {
  const e = ehObj(corpo) && ehObj(corpo["error"]) ? corpo["error"] : null;
  if (!e) return [];
  const d = e["details"];
  if (ehObj(d) && typeof d["campo"] === "string") return [{ caminho: normalizar(d["campo"]), mensagem: texto(e["message"]) }];
  const lista: unknown[] = Array.isArray(d) ? d : ehObj(d) && Array.isArray(d["exigencias"]) ? d["exigencias"] : [];
  return lista.flatMap((x) => (ehObj(x) ? [{ caminho: normalizar(texto(x["path"] ?? x["caminho"])), mensagem: texto(x["message"] ?? x["mensagem"] ?? e["message"]) }] : []))
    .filter((x) => x.caminho !== "");
}

/** Escolhe a opção no RefSelect de um campo dos Dados principais (o invólucro dado) pelo nome. */
async function escolherNoCampo(page: Page, campo: Locator, nome: string) {
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome.slice(0, 20));
  await painel.getByRole("option", { name: literal(nome.slice(0, 20)) }).first().click();
}

/** A entrada de uma célula da linha (só existe com a linha marcada): marca a linha quando preciso. */
async function entradaDaLinha(linha: Locator, rotulo: string): Promise<Locator> {
  const e = linha.getByLabel(rotulo, { exact: true });
  if (!(await e.isVisible())) await linha.getByTestId(`${P}-selecionar-item`).click();
  await expect(e, `a entrada "${rotulo}" está à vista`).toBeVisible();
  return e;
}

const dataBr = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const dataIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * O GESTO DO OPERADOR no campo que a tela (ou o servidor) pediu, com o valor que ele usaria: o fornecedor, o produto e o
 * local do caso; natureza, centro e forma os da TOP (os padrões que ela já tem). Devolve o que foi feito. Campo sem
 * gesto conhecido REPROVA: a medição não pula o que não sabe tocar.
 */
async function preencher(page: Page, m: Montado, caminho: string): Promise<string> {
  if (caminho === "itens") {
    await page.getByTestId(`${P}-adicionar-item`).click();
    await expect(page.getByTestId(`${P}-linha`), "a grade ganhou a linha").toHaveCount(1);
    return "Adicionar produto (a linha 1 nasce na grade)";
  }
  const item = /^itens\[(\d+)\]\.([a-z_]+)$/.exec(caminho);
  if (item) {
    const i = Number(item[1]);
    const linha = page.getByTestId(`${P}-linha`).nth(i);
    switch (item[2]) {
      case "produto_id": {
        await linha.getByTestId(`${P}-produto`).click();
        const pesquisa = page.getByTestId(`${P}-pesquisa`);
        await pesquisa.getByPlaceholder("Pesquisar pela descrição").fill(m.tag);
        await pesquisa.getByRole("option").filter({ hasText: m.produto.nome }).click();
        await expect(linha.getByTestId(`${P}-produto`)).toContainText(m.produto.nome);
        return `escolheu o produto ${m.produto.nome}`;
      }
      case "armazem_id": {
        await linha.getByTestId(`${P}-armazem`).click();
        await page.getByPlaceholder("Pesquisar pela descrição").fill(m.tag);
        await page.getByRole("option", { name: literal(m.local.nome.slice(0, 20)) }).first().click();
        await expect(linha.getByTestId(`${P}-armazem`)).toContainText(m.local.nome);
        return `escolheu o local ${m.local.nome}`;
      }
      case "valor_unitario": {
        await (await entradaDaLinha(linha, `Valor unitário do item ${i + 1}`)).fill(VALOR_UNITARIO);
        return `digitou ${VALOR_UNITARIO}`;
      }
      case "quantidade": {
        await (await entradaDaLinha(linha, `Quantidade do item ${i + 1}`)).fill("3");
        return "digitou 3";
      }
      default: throw new Error(`a medição não sabe tocar o campo do item "${caminho}": acrescente o gesto em preencher()`);
    }
  }
  const dados = page.getByTestId(`${P}-dados`);
  const campo = dados.locator(`[data-campo="${caminho}"]`);
  await expect(campo, `o campo ${caminho} está desenhado nos Dados`).toHaveCount(1);
  if (!(await campo.isVisible())) {
    const grupo = dados.getByRole("button", { name: /^Dados adicionais/ });
    if ((await grupo.getAttribute("aria-expanded")) !== "true") await grupo.click();
  }
  await expect(campo).toBeVisible();
  const ref = (o: Opcao) => escolherNoCampo(page, campo, o.label).then(() => `escolheu ${o.label}`);
  switch (caminho) {
    case "fornecedor_id": await escolherNoCampo(page, campo, m.fornecedor.nome); return `escolheu o fornecedor ${m.fornecedor.nome}`;
    case "categoria_financeira_id": return ref(m.natureza);
    case "centro_custo_id": return ref(m.centro);
    case "forma_pagamento_id": return ref(m.forma);
    case "data_vencimento": {
      // O calendário do produto: digita-se dd/mm/aaaa e Enter confirma (o valor vira ISO no campo oculto). A caixa é
      // achada DENTRO do invólucro do campo: o nome acessível dela leva o "*" quando a regra a exige.
      const vence = new Date(Date.now() + 30 * 86_400_000);
      const entrada = campo.locator('input:not([type="hidden"])').first();
      await entrada.fill(dataBr(vence));
      await entrada.press("Enter");
      await expect(campo.locator('input[type="hidden"]')).toHaveValue(dataIso(vence));
      return `digitou ${dataBr(vence)}`;
    }
    default: throw new Error(`a medição não sabe tocar o campo "${caminho}": acrescente o gesto em preencher()`);
  }
}

/* ═════════════════════════════════════ M3 E M4: A FONTE DE CADA CAMPO ═════════════════════════════════════ */

type Classificacao = { tipo: "sistema"; fonte: string; prova: string } | { tipo: "operador"; motivo: string };

/**
 * ONDE MORA A RESPOSTA de cada campo. "sistema": a resposta está num cadastro ou na TOP, e a PROVA é o que este caso leu
 * no banco do E2E. "operador": só ele sabe (a nota, a negociação, quem vendeu). Campo fora desta lista = `null` (reprova).
 */
function classificar(chave: string, m: Montado): Classificacao | null {
  const p = m.detalhe.padroesFinanceiros;
  const daTop = (k: ChavePadrao, rotulo: string): Classificacao => ({
    tipo: "sistema", fonte: `padrão financeiro da TOP (${rotulo})`,
    prova: `GET /api/admin/tipos-operacao/${m.top.id} → padroesFinanceiros.${k} = ${[p?.[k]?.codigo, p?.[k]?.nome ?? p?.[k]?.descricao].filter(Boolean).join(" ")} (${p?.[k]?.id ?? "—"})`
  });
  switch (chave) {
    case "categoria_financeira_id": {
      const c = daTop("natureza", "natureza");
      return c.tipo === "sistema" ? { ...c, prova: `${c.prova}; o cadastro do produto também tem a "Natureza de custo" (products.financial_category_id = ${m.produto.naturezaDeCustoId})` } : c;
    }
    case "centro_custo_id": {
      const c = daTop("centro", "centro de resultado");
      return c.tipo === "sistema" ? { ...c, prova: `${c.prova}; o cadastro do produto tem "Centro de resultado padrão" (products.default_cost_center_id = ${m.produto.centroPadraoId || "vazio nesta fixture"}) e o perfil de fornecedor também (provider_profiles.default_cost_center_id)` } : c;
    }
    case "forma_pagamento_id": return daTop("formaPagamento", "forma de pagamento");
    case "itens[].armazem_id": return {
      tipo: "sistema", fonte: "cadastro do produto: \"Local de estoque padrão\" (products.default_warehouse_id)",
      prova: `GET /api/resources/products/${m.produto.id} → default_warehouse_id = ${m.produto.localPadraoId} (${m.local.nome}, empresa ${m.local.empresaId === m.empresa ? "DO documento" : "de OUTRA empresa"})`
    };
    case "empresa_id": return { tipo: "sistema", fonte: "a empresa da sessão (useEmpresaPadrao)", prova: `a Central abre com a empresa ${m.empresa}` };
    case "fornecedor_id": return { tipo: "operador", motivo: "quem vendeu: o fornecedor É a pergunta (nenhum cadastro, TOP ou empresa o sabe)" };
    case "itens[].produto_id": return { tipo: "operador", motivo: "o que foi comprado" };
    case "itens[].quantidade": return { tipo: "operador", motivo: "a quantidade da nota" };
    case "itens[].valor_unitario": return { tipo: "operador", motivo: "o valor da nota: o cadastro tem 'Valor de referência' e o custo médio, mas a compra FORMA o custo e a Central não os usa de propósito (criacao-itens.tsx, custoMedioNoUnitario={false})" };
    case "data_vencimento": return { tipo: "operador", motivo: "o vencimento da nota (ou o 1º do plano derivado da condição de pagamento, que também é pergunta); nenhuma TOP, fornecedor ou empresa guarda vencimento padrão" };
    case "condicao_pagamento_id": return { tipo: "operador", motivo: "a condição negociada (o perfil de fornecedor não tem condição padrão)" };
    case "data_entrada": case "numero_nota": case "serie_nota": case "itens[].lote": case "itens[].validade":
      return { tipo: "operador", motivo: "dado da nota" };
    case "transportadora_id": case "observacao": return { tipo: "operador", motivo: "dado do documento" };
    default: return null;
  }
}

/**
 * O CAMINHO DE PADRÃO HOJE (M4): o layout da família aceita um PADRÃO DE CADASTRO neste campo? Pergunta ao domínio, a
 * MESMA régua que a API usa ao gravar o layout (`validarEstruturaLayout`): o layout do sistema com um padrão registro no
 * campo — recusa no `.valorPadrao` dele = sem caminho. (A existência do registro é conferida pela API; aqui só o lugar.)
 */
function aceitaPadraoDeCadastro(familia: string, chave: string): boolean {
  const base = LAYOUT_DO_SISTEMA(familia);
  const valorPadrao = { tipo: "registro" as const, id: "00000000-0000-4000-8000-000000000001" };
  const campo = chave.replace(/^itens\[\]\./, "");
  const nosItens = chave.startsWith("itens[].");
  if (nosItens ? !base.itens.some((x) => x.campo === campo) : !base.cabecalho.some((x) => x.campo === campo)) return false;
  const estrutura: EstruturaLayout = nosItens
    ? { ...base, itens: base.itens.map((x) => (x.campo === campo ? { ...x, valorPadrao } : x)) }
    : { ...base, cabecalho: base.cabecalho.map((x) => (x.campo === campo ? { ...x, valorPadrao } : x)) };
  return !validarEstruturaLayout(familia, estrutura).some((e) => e.caminho.endsWith(".valorPadrao"));
}

/* ═════════════════════════════════════ A MEDIÇÃO ═════════════════════════════════════ */

interface Passo {
  n: number; gatilho: "pendência da tela" | "recusa do servidor" | "premissa do cenário"; caminho: string; nome: string;
  /** O rótulo que a lista de pendências mostra (só no gatilho "pendência da tela"). */
  comoAPendenciaDiz?: string;
  mensagem: string; gesto: string; campo: boolean;
}
interface Resposta { status: number; corpo: Promise<unknown>; enviado: unknown }

async function medirCenario(page: Page, c: Cenario) {
  test.setTimeout(240_000);
  await login(page);
  const m = await montar(page, c);
  medir(c.medida, `cenario ${JSON.stringify({ resumo: c.resumo, top: `${m.top.codigo} — ${m.top.nome}`, layout: m.layout, regras: m.regras })}`);
  medir(c.medida, `padroes-da-top ${JSON.stringify(m.detalhe.padroesFinanceiros)}`);

  // O fio: cada POST da Central na porta da espécie, com o status, o corpo da resposta e o corpo enviado.
  const porta = `/api/compras/${c.segmento}`;
  const respostas: Resposta[] = [];
  page.on("response", (r) => {
    if (r.request().method() !== "POST" || new URL(r.url()).pathname !== porta) return;
    const enviado: unknown = r.request().postDataJSON();
    respostas.push({ status: r.status(), corpo: r.json().then((x: unknown) => x, () => null), enviado });
  });

  await page.goto(`/compras/${c.segmento}/new?tipo_operacao_id=${m.top.id}`);
  const central = page.getByTestId("compras-central");
  await expect(central, "a Central abriu o formulário da espécie").toHaveAttribute("data-especie", c.especie);
  await expect(central).toHaveAttribute("data-modo", "lancar");
  await expect(page.getByTestId("compras-top-travada"), "com a TOP do cenário").toHaveAttribute("data-tipo-operacao-id", m.top.id);
  await expect(page.getByTestId("compras-layout-efetivo"), "a tela usa o layout que o servidor resolveu").toHaveAttribute("data-origem", m.layout.origem);
  const salvar = page.getByTestId("compras-salvar");
  await expect(salvar, "o Salvar destravou (layout e regras carregados)").toBeEnabled();

  // O QUE A TELA JÁ TRAZ: lido quando parar de mudar (os efeitos de padrão rodam depois da carga).
  let anterior = "";
  await expect.poll(async () => { const agora = JSON.stringify(await lerCampos(page)); const estavel = agora === anterior; anterior = agora; return estavel; },
    { message: "os Dados da criação pararam de mudar", intervals: [300, 300, 300, 600, 1000] }).toBe(true);
  const abertura = await lerCampos(page);
  medir(c.medida, `pre-preenchido ${JSON.stringify(abertura.filter((x) => x.preenchido).map((x) => ({ campo: x.campo, nome: x.nome, valor: x.valor })))}`);
  medir(c.medida, `abertura-todos ${JSON.stringify(abertura)}`);
  const asteriscoVazio = abertura.filter((x) => x.obrigatorio && !x.preenchido && x.visivel);
  medir(c.medida, `asterisco-vazio-na-abertura ${JSON.stringify(asteriscoVazio.map((x) => ({ campo: x.campo, nome: x.nome })))}`);

  // O LAÇO: Salvar → pendência (zero POST) ou recusa → preencher UM campo → Salvar de novo, até gravar.
  const passos: Passo[] = [];
  // Cada passo vai ao console NA HORA: se uma volta seguinte falhar, o que já foi medido está no relatório.
  const registrar = (x: Omit<Passo, "n">) => { const p = { n: passos.length + 1, ...x }; passos.push(p); medir(c.medida, `passo ${JSON.stringify(p)}`); };
  const lista = page.getByTestId(`${P}-pendencias-lista`);
  let gravado: { id: string; enviado: unknown } | null = null;
  let linhaNova: Record<string, string> | null = null;
  for (let volta = 1; volta <= 20 && !gravado; volta++) {
    // A premissa do cenário: com produto na linha e o total zero, o documento não geraria título/previsto.
    const linhas = page.getByTestId(`${P}-linha`);
    if ((await linhas.count()) > 0 && !(await linhas.first().getByTestId(`${P}-produto`).innerText()).includes("Selecione")) {
      const total = page.getByTestId("compras-total");
      await expect(total, "o total do documento está à vista").toBeVisible();
      if (Number((await total.innerText()).replace(/\D/g, "")) === 0) {
        const caminho = "itens[0].valor_unitario";
        registrar({ gatilho: "premissa do cenário", caminho, nome: await nomeNaTela(page, caminho),
          mensagem: "total zero: sem valor a compra não gera título e o pedido não promete previsto", gesto: await preencher(page, m, caminho), campo: true });
        continue;
      }
    }
    const antes = respostas.length;
    await salvar.click();
    await expect.poll(async () => (respostas.length > antes ? "resposta" : (await lista.isVisible()) ? "pendencias" : "aguardando"),
      { message: "o Salvar teve desfecho: a lista de pendências (zero POST) ou a resposta do servidor" }).not.toBe("aguardando");

    if (respostas.length === antes) {
      const todas = lista.getByTestId(`${P}-pendencia`);
      const listadas = await todas.evaluateAll((els) => els.map((el) => el.getAttribute("data-caminho") ?? ""));
      const primeira = todas.first();
      const caminho = normalizar((await primeira.getAttribute("data-caminho")) ?? "");
      const comoAPendenciaDiz = (await primeira.locator("b").innerText()).trim();
      const mensagem = (await primeira.locator("span").first().innerText()).trim();
      await page.keyboard.press("Escape");
      await expect(lista).toBeHidden();
      const nome = await nomeNaTela(page, caminho);
      const gesto = await preencher(page, m, caminho);
      if (caminho === "itens") { linhaNova = await lerLinha(page, 0); medir(c.medida, `linha-nova ${JSON.stringify(linhaNova)}`); }
      registrar({ gatilho: "pendência da tela", caminho, nome, comoAPendenciaDiz, mensagem: `${mensagem} · listadas: ${listadas.join(", ")}`, gesto, campo: caminho !== "itens" });
      continue;
    }
    const r = respostas[antes]!;
    const corpo = await r.corpo;
    if (r.status === 201) {
      expect(ehObj(corpo) && typeof corpo["id"] === "string", "o 201 devolve o id do documento").toBe(true);
      gravado = { id: texto(ehObj(corpo) ? corpo["id"] : ""), enviado: r.enviado };
      break;
    }
    const alvos = camposDaRecusa(corpo);
    expect(alvos.length, `a recusa do servidor (${r.status}) aponta um campo: ${JSON.stringify(corpo)}`).toBeGreaterThan(0);
    const alvo = alvos[0]!;
    const nome = await nomeNaTela(page, alvo.caminho);
    registrar({ gatilho: "recusa do servidor", caminho: alvo.caminho, nome,
      mensagem: `${r.status} ${ehObj(corpo) && ehObj(corpo["error"]) ? texto(corpo["error"]["code"]) : ""}: ${alvo.mensagem}`, gesto: await preencher(page, m, alvo.caminho), campo: true });
  }
  expect(linhaNova, "premissa: a medição viu a linha nova nascer (a pendência de itens veio da tela)").not.toBeNull();

  // PREMISSA: o Salvar passou, e o documento existe com a TOP do cenário e total maior que zero.
  expect(gravado, `o Salvar gravou o documento (passos: ${JSON.stringify(passos)})`).not.toBeNull();
  const id = gravado!.id;
  await expect(page, "a Central foi para o documento salvo").toHaveURL(new RegExp(`/compras/${c.segmento}/${id}$`));
  const doc = await api<Record<string, unknown>>(page, "GET", `/api/compras/${c.segmento}/${id}`);
  const topDoDoc = ehObj(doc["tipo_operacao"]) ? doc["tipo_operacao"]["id"] : doc["tipo_operacao_id"];
  expect(topDoDoc, "o documento existe, com a TOP do cenário").toBe(m.top.id);
  expect(Number(texto(doc["valor_total"])), "e total maior que zero").toBeGreaterThan(0);

  // A MEDIDA.
  const tocados = passos.filter((x) => x.campo);
  const unicos = [...new Map(tocados.map((x) => [x.caminho, x])).values()];
  medir(c.medida, `n=${unicos.length} campos=${JSON.stringify(unicos.map((x) => x.nome))} caminhos=${JSON.stringify(unicos.map((x) => x.caminho))}`);
  medir(c.medida, `gestos-sem-campo ${JSON.stringify(passos.filter((x) => !x.campo).map((x) => x.gesto))}`);
  expect(unicos.map((x) => chaveDoCampo(x.caminho)), "anti-vácuo: o que só o operador sabe (fornecedor e produto) continua sendo pergunta")
    .toEqual(expect.arrayContaining(["fornecedor_id", "itens[].produto_id"]));

  // M3 e M4 (de M1/M1-E/M2): a fonte de cada campo tocado e, dos que têm fonte, o caminho de padrão hoje.
  const classificados = unicos.map((x) => ({ nome: x.nome, chave: chaveDoCampo(x.caminho), c: classificar(chaveDoCampo(x.caminho), m) }));
  expect(classificados.filter((x) => x.c === null).map((x) => x.chave), "todo campo medido tem a fonte classificada (acrescente-o em classificar())").toEqual([]);
  const comFonte = classificados.flatMap((x) => (x.c?.tipo === "sistema" ? [{ nome: x.nome, chave: x.chave, fonte: x.c.fonte, prova: x.c.prova, caminhoHoje: aceitaPadraoDeCadastro(c.familia, x.chave) }] : []));
  medir(`M3 (de ${c.medida})`, `n=${comFonte.length} ${JSON.stringify(comFonte.map(({ nome, chave, fonte, prova }) => ({ nome, chave, fonte, prova })))}`);
  medir(`M3 (de ${c.medida})`, `so-o-operador-sabe ${JSON.stringify(classificados.flatMap((x) => (x.c?.tipo === "operador" ? [{ nome: x.nome, motivo: x.c.motivo }] : [])))}`);
  const comCaminho = comFonte.filter((x) => x.caminhoHoje);
  const semCaminho = comFonte.filter((x) => !x.caminhoHoje);
  medir(`M4 (de ${c.medida})`, `com-caminho=${comCaminho.length} ${JSON.stringify(comCaminho.map((x) => x.nome))} sem-caminho=${semCaminho.length} ${JSON.stringify(semCaminho.map((x) => x.nome))}`);

  // O que a tela marca com "*" na abertura e NÃO cobrou (o operador vê como obrigatório): a mesma classificação.
  const percebidos = asteriscoVazio.filter((x) => !unicos.some((u) => chaveDoCampo(u.caminho) === x.campo)).map((x) => {
    const k = classificar(x.campo, m);
    return { nome: x.nome, chave: x.campo, fonte: k?.tipo === "sistema" ? k.fonte : k?.tipo === "operador" ? `só o operador: ${k.motivo}` : "não classificado",
      caminhoHoje: k?.tipo === "sistema" ? aceitaPadraoDeCadastro(c.familia, x.campo) : null };
  });
  medir(c.medida, `asterisco-nao-cobrado ${JSON.stringify(percebidos)}`);

  // O CORPO QUE SAIU no POST que gravou, e o que o SERVIDOR gravou (o ANTES do A5).
  const enviado = ehObj(gravado!.enviado) ? gravado!.enviado : {};
  const itensEnviados = Array.isArray(enviado["itens"]) ? enviado["itens"] : [];
  medir(c.medida, `corpo ${JSON.stringify({ chaves: Object.keys(enviado).sort(), categoria_financeira_id: enviado["categoria_financeira_id"] ?? null, centro_custo_id: enviado["centro_custo_id"] ?? null,
    forma_pagamento_id: enviado["forma_pagamento_id"] ?? null, data_vencimento: enviado["data_vencimento"] ?? null, item0: itensEnviados[0] ?? null })}`);
  const itensGravados = Array.isArray(doc["itens"]) ? doc["itens"] : [];
  const item0 = ehObj(itensGravados[0]) ? itensGravados[0] : {};
  medir(c.medida, `gravado ${JSON.stringify({ id, codigo: doc["codigo"], situacao: doc["situacao"], valor_total: doc["valor_total"], categoria_financeira_id: doc["categoria_financeira_id"] ?? null,
    centro_custo_id: doc["centro_custo_id"] ?? null, forma_pagamento_id: doc["forma_pagamento_id"] ?? null, data_vencimento: doc["data_vencimento"] ?? null, item0_armazem_id: item0["armazem_id"] ?? null })}`);

  // A PRÉVIA DO SERVIDOR (só leitura): a compra gera título a pagar; o pedido finaliza (e a provisão promete o previsto).
  if (c.especie === "compra") {
    const previa = await api<Record<string, unknown>>(page, "GET", `/api/compras/compras/${id}/previa-confirmacao`);
    const fin = ehObj(previa["financeiro"]) ? previa["financeiro"] : {};
    expect([fin["efeito"], Number(texto(fin["valor"])) > 0], "premissa: a prévia do servidor diz que a compra gera título a pagar, com valor").toEqual(["pagar", true]);
    medir(c.medida, `previa-confirmacao ${JSON.stringify({ podeConfirmar: previa["podeConfirmar"], recusas: previa["recusas"], financeiro: { efeito: fin["efeito"], valor: fin["valor"], classificacao: fin["classificacao"] }, politica: previa["politica"] })}`);
  } else {
    const previa = await api<Record<string, unknown>>(page, "GET", `/api/compras/pedidos/${id}/previa-finalizacao`);
    expect(previa["podeFinalizar"], `premissa: a prévia do servidor diz que o pedido finaliza (e a provisão nasce): ${JSON.stringify(previa["recusas"])}`).toBe(true);
    medir(c.medida, `previa-finalizacao ${JSON.stringify(previa)}`);
  }
}

for (const c of CENARIOS) {
  test(`LANCAMENTO-01 · ${c.medida} — ${c.especie === "compra" ? "a compra que gera título" : "o pedido de compra que gera o previsto"}: os campos que o operador TEM de tocar na Central de Compras real até o Salvar gravar (${c.medida === "M1-E" ? "execução configurada" : "TOP no formato 5 com os cinco padrões"})`, async ({ page }) => {
    await medirCenario(page, c);
  });
}
