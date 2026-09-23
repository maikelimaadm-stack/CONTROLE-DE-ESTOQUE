import { test, expect, type Page } from "@playwright/test";
import { login, api, empresaAtiva } from "./helpers";
import { ptBR } from "@erp/plataforma";

/**
 * BASE2-03C — DOCUMENTO DE VENDA NO MODELO BASE 2.
 *
 * Terceira entidade de módulo migrada, e a primeira com TRÊS variantes da MESMA tabela: orçamento,
 * pedido de venda e venda são o mesmo `erp.sales_documents`, a mesma tela e três famílias de capacidade
 * (`budgets.*`, `orders.*`, `sales.*`). Muda o `kind` do REGISTRO.
 *
 * Por isso metade destes casos existe para provar que as três variantes não se cruzam e que a identidade
 * apresentada sai do REGISTRO — nunca do segmento da URL, que antes desta fatia era a autoridade da tela
 * e ainda caía na semântica de VENDA quando o segmento era desconhecido.
 *
 * A outra metade protege o que a migração NÃO podia perder: os campos do documento, os itens, o TOTAL do
 * servidor (que inclui frete e outros valores e por isso não é a soma da coluna de itens), os
 * relacionamentos com link e o histórico oficial.
 *
 * VISUAL-UX-01 R3 (docs/DECISIONS.md 227): o documento salvo passou a abrir na CENTRAL DE VENDAS, em
 * consulta, em vez da moldura Base 2. As asserções de CONTRATO acima continuam todas aqui, com os mesmos
 * dados; mudou só ONDE a tela os desenha — campos da Central, grade da Central, abas do painel inferior,
 * ações como ícones (Mais ações → Histórico / Cancelar) e nenhum "Voltar".
 */

/** Rótulo da TOP lido do CATÁLOGO, nunca copiado: renomear a copy move tela e teste juntos. */
const rotuloTop = (codigo: string) => {
  const r = ptBR.mensagens[`top.${codigo}`];
  if (!r) throw new Error(`TOP ${codigo} sem rótulo no catálogo pt-BR`);
  return r;
};

type Variante = "budget" | "order" | "sale";
interface Doc { id: string; code: string; total: string; itens: number; variante: Variante; rota: string }

const V: Record<Variante, { rota: string; titulo: string; top: string }> = {
  budget: { rota: "budgets", titulo: "Orçamento", top: rotuloTop("vendas.orcamento") },
  order: { rota: "orders", titulo: "Pedido de venda", top: rotuloTop("vendas.pedido") },
  sale: { rota: "sales", titulo: "Venda", top: rotuloTop("vendas.venda") }
};

async function umId(page: Page, path: string, oQue: string): Promise<string> {
  const r = await api<{ items: { id: string }[] }>(page, "GET", path);
  const id = r.items?.[0]?.id;
  expect(id, `o seed precisa ter ${oQue} para esta fixture existir`).toBeTruthy();
  return id!;
}

/**
 * Cria um documento da variante pedida pela API REAL, com FRETE — de propósito.
 *
 * O frete é o que separa o TOTAL do documento da soma dos itens. Sem ele a asserção do total passaria
 * mesmo que a tela somasse a coluna de itens no cliente, que é justamente o que a moldura não faz.
 */
async function criar(page: Page, variante: Variante): Promise<Doc> {
  const empresa = await empresaAtiva(page);
  const cliente = await umId(page, "/api/resources/people?is_client=true&pageSize=1", "um cliente");
  const produto = await umId(page, "/api/resources/products?pageSize=1", "um produto");
  const armazem = await umId(page, `/api/resources/warehouses?empresa_id=${empresa}&pageSize=1`, "um armazém da empresa ativa");

  const criado = await api<{ id: string }>(page, "POST", `/api/sales/${V[variante].rota}`, {
    empresa_id: empresa, document_date: "2026-09-01", client_id: cliente, freight: "30.00",
    items: [{ product_id: produto, warehouse_id: armazem, quantity: "2", unit_price: "50.00" }]
  });
  expect(criado.id, "a API precisa devolver o id do documento criado").toBeTruthy();

  const lido = await api<{ code: string; total: string; subtotal: string; kind: string; items: unknown[] }>(page, "GET", `/api/sales/${V[variante].rota}/${criado.id}`);
  expect(lido.kind, "a fixture precisa nascer na variante pedida").toBe(variante);
  expect(Number(lido.total), "premissa: com frete, o total do documento NÃO é a soma dos itens").toBeGreaterThan(Number(lido.subtotal));
  return { id: criado.id, code: lido.code, total: lido.total, itens: lido.items.length, variante, rota: V[variante].rota };
}

async function abrir(page: Page, d: Doc): Promise<void> {
  await page.goto(`/vendas/${d.rota}/${d.id}`);
  await expect(page.getByTestId("central-vendas")).toBeVisible();
}

const campo = (page: Page, rotulo: string) => page.getByTestId("central-vendas").locator(`[data-campo="${rotulo}"]`);
/** Abre uma aba do painel inferior da Central e devolve o painel dela. */
async function aba(page: Page, nome: string) {
  const t = page.getByTestId("central-vendas-painel").getByRole("tab", { name: nome });
  await t.click();
  await expect(t).toHaveAttribute("aria-selected", "true");
  return page.getByTestId("central-vendas-painel").getByRole("tabpanel");
}
/** Abre "Mais ações" (⋮) e escolhe o item. */
async function maisAcoes(page: Page, item: string | RegExp) {
  await page.getByTestId("central-vendas-mais-acoes").click();
  await page.getByTestId("central-vendas-mais-acoes-menu").getByRole("menuitem", { name: item }).click();
}

/** Status CRU de uma porta da API — o helper `api` lança em erro, e aqui o erro é o que se mede. */
async function statusDaApi(page: Page, path: string): Promise<number> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  return page.evaluate(async ({ path, base }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {}) } });
    return res.status;
  }, { path, base });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 1 · AS TRÊS VARIANTES NO MODELO BASE 2
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

for (const variante of ["budget", "order", "sale"] as Variante[]) {
  test(`BASE2-03C: ${variante} abre na Central (consulta) com identidade, TOP, itens e total do servidor`, async ({ page }) => {
    await login(page);
    const d = await criar(page, variante);
    await abrir(page, d);

    // IDENTIDADE — o título funcional do REGISTRO + o código do registro (região nomeada e aba de trabalho)
    await expect(page.getByRole("region", { name: `${V[variante].titulo} ${d.code}` })).toBeVisible();
    await expect(page.getByTestId("central-vendas-identidade-nome")).toHaveText(d.code);
    await expect(page.locator('[data-testid="workspace-tab"][data-tab-key="' + `/vendas/${V[variante].rota}/${d.id}` + '"]')).toContainText(`${V[variante].titulo} ${d.code}`);
    await expect(campo(page, "Número")).toContainText(d.code);

    // empresa e situação
    await expect(campo(page, "Empresa")).toBeVisible();
    await expect(campo(page, "Empresa")).not.toContainText("—");
    await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]")).toBeVisible();

    // FAMÍLIA OPERACIONAL da variante — e NUNCA a de nenhuma das vizinhas.
    // A TOP-CONFIG-02 separou dois conceitos que antes dividiam o mesmo campo: a FAMÍLIA canônica
    // (código do produto, derivada do `kind` do registro) passou para o campo "Família operacional",
    // e "Tipo de operação" passou a carregar a TOP CONFIGURADA pela organização. A asserção de
    // não-cruzamento entre variantes segue valendo — mas no campo que continua sendo derivado do
    // registro, que é onde ela sempre quis morar.
    const familia = campo(page, "Família operacional");
    await expect(familia).toContainText(V[variante].top);
    for (const outra of (["budget", "order", "sale"] as Variante[]).filter((x) => x !== variante)) {
      await expect(familia, `${variante} não pode exibir a família de ${outra}`).not.toContainText(V[outra].top);
    }

    // Estes documentos nascem pela API SEM `tipo_operacao_id` (acervo/rolling deploy): o campo da TOP
    // configurada diz isso em letras, e NUNCA inventa um número nem cai na família.
    await expect(campo(page, ptBR.mensagens["termos.tipo_operacao"]!)).toContainText("Não configurada");

    // DADOS PRINCIPAIS — os campos do documento continuam existindo depois da migração
    for (const rotulo of ["Data", "Cliente", "Origem"]) {
      await expect(campo(page, rotulo), `campo "${rotulo}" sumiu dos dados principais`).toBeVisible();
    }

    // ITENS — na grade da Central, com a contagem do servidor, sem lixeira nem edição
    expect(d.itens, "a fixture precisa ter item, senão a tabela passaria vazia").toBeGreaterThan(0);
    await expect(page.getByTestId("central-vendas-itens-contagem")).toHaveText(`(${d.itens})`);
    await expect(page.getByTestId("central-vendas-linha")).toHaveCount(d.itens);
    const grade = page.getByTestId("central-vendas-grade");
    for (const coluna of ["Código", "Produto", "Armazém", "Quantidade", "Valor unitário", "Desconto", "Total"]) {
      await expect(grade.locator("thead th", { hasText: coluna }).first()).toBeVisible();
    }
    await expect(grade.locator("input"), "consulta: nada editável na grade").toHaveCount(0);

    // TOTAL — o número do SERVIDOR, que com frete difere da soma dos itens (subtotal)
    const formatado = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(Number(d.total));
    await expect(page.getByTestId("central-vendas-total"), "o total exibido é o do servidor").toContainText(formatado);
    const totais = await aba(page, "Totais");
    for (const rotulo of ["Subtotal dos itens", "Frete", "Total do documento"]) await expect(totais.locator(`[data-campo="${rotulo}"]`)).toBeVisible();
    await expect(totais.locator('[data-campo="Total do documento"]')).toContainText(formatado);

    // sem "Voltar" (VISUAL-UX-01 R3): quem navega é a barra de abas, onde este documento é uma aba
    await expect(page.getByRole("button", { name: "Voltar", exact: true })).toHaveCount(0);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 2 · A ROTA DE UMA VARIANTE NÃO SERVE A OUTRA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("BASE2-03C: a rota de outra variante NÃO serve o registro — 404 e a tela não monta nada", async ({ page }) => {
  await login(page);
  const orcamento = await criar(page, "budget");
  const venda = await criar(page, "sale");

  // CONTRATO DURO: `kind` faz parte da AUTORIZAÇÃO. O usuário do e2e tem TODAS as capacidades de vendas,
  // então um 404 aqui só pode vir da variante do registro — nunca de falta de permissão.
  expect(await statusDaApi(page, `/api/sales/budgets/${orcamento.id}`), "premissa: a rota própria serve").toBe(200);
  expect(await statusDaApi(page, `/api/sales/orders/${orcamento.id}`), "rota de pedidos servindo um ORÇAMENTO").toBe(404);
  expect(await statusDaApi(page, `/api/sales/sales/${orcamento.id}`), "rota de vendas servindo um ORÇAMENTO").toBe(404);
  expect(await statusDaApi(page, `/api/sales/budgets/${venda.id}`), "rota de orçamentos servindo uma VENDA").toBe(404);

  // e a tela pela rota errada não monta o registro: nada do documento sai antes da autorização completa
  await page.goto(`/vendas/orders/${orcamento.id}`);
  await expect(page.getByTestId("error-state").or(page.getByText(/não encontrad/i)).first(), "premissa: a tela terminou de responder").toBeVisible();
  await expect(page.getByTestId("central-vendas")).toHaveCount(0);
  await expect(page.getByText(orcamento.code, { exact: false })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Venda/ }), "variante errada não pode cair no rótulo de venda").toHaveCount(0);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 3 · RELACIONAMENTOS — documento derivado e conta a receber
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("BASE2-03C: a conversão liga origem e derivado, e cada lado abre na SUA rota canônica", async ({ page }) => {
  await login(page);
  const orcamento = await criar(page, "budget");

  const convertido = await api<{ id: string; kind: string }>(page, "POST", `/api/sales/${orcamento.rota}/${orcamento.id}/convert`, {});
  expect(convertido.kind, "budget converte em order").toBe("order");

  // ORIGEM: a aba de derivados existe, com link para o pedido
  await abrir(page, orcamento);
  const derivados = await aba(page, "Documentos derivados");
  await expect(derivados.getByTestId("base2-items-linha")).toHaveCount(1);
  await expect(derivados.locator(`a[href="/vendas/orders/${convertido.id}"]`), "o link do derivado aponta para a rota da variante DELE").toBeVisible();
  await expect(page.getByTestId("central-vendas-situacao").locator("[data-status]"), "a origem fica convertida").toHaveText(/Convertid/i);

  // DERIVADO: abre como PEDIDO — identidade e TOP do registro derivado, não da origem
  const pedido = await api<{ code: string }>(page, "GET", `/api/sales/orders/${convertido.id}`);
  await page.goto(`/vendas/orders/${convertido.id}`);
  await expect(page.getByTestId("central-vendas")).toBeVisible();
  await expect(page.getByRole("region", { name: `Pedido de venda ${pedido.code}` })).toBeVisible();
  await expect(campo(page, "Família operacional"), "a família sai do registro DERIVADO").toContainText(V.order.top);
  await expect(campo(page, "Origem"), "o pedido nasceu de uma conversão").toContainText("Convertido");
});

test("BASE2-03C: venda confirmada mostra as contas a receber geradas, com link para o título", async ({ page }) => {
  await login(page);
  const venda = await criar(page, "sale");

  const confirmada = await api<{ title_ids: string[] }>(page, "POST", `/api/sales/sales/${venda.id}/confirm`, {});
  expect(confirmada.title_ids.length, "a confirmação precisa gerar título, senão a seção passaria vazia").toBeGreaterThan(0);

  await abrir(page, venda);
  const contas = await aba(page, "Financeiro");
  await expect(contas.getByTestId("base2-items-linha")).toHaveCount(confirmada.title_ids.length);
  await expect(contas.locator(`a[href="/financeiro/contas-a-receber/${confirmada.title_ids[0]}"]`), "o link precisa levar ao título real").toBeVisible();

  // e a ação de confirmar não é mais oferecida para um documento já confirmado
  await expect(page.getByRole("button", { name: "Confirmar venda" })).toHaveCount(0);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 4 · HISTÓRICO OFICIAL E AUSÊNCIA DE ANEXOS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("BASE2-03C: o histórico oficial abre com conteúdo real; anexos NÃO são oferecidos", async ({ page }) => {
  await login(page);
  const d = await criar(page, "order");
  await abrir(page, d);

  await maisAcoes(page, "Histórico de alterações");
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText("Histórico");
  // criar o documento grava `audit(..., "sales_documents", ...)`: lista vazia aqui significa entidade
  // errada, e "nenhum evento" é indistinguível disso na tela — por isso a asserção é sobre o conteúdo.
  await expect(dialogo, "a auditoria de sales_documents não pode vir vazia").not.toContainText("Nenhum evento registrado");
  await expect(dialogo.locator("ol > li").first(), "histórico vazio não prova nada").toBeVisible();
  await page.keyboard.press("Escape");

  // ANEXOS: `sales_documents` não está em ATTACHMENT_PARENTS. O botão responderia 422 — então ele não
  // existe. Abrir a superfície é outra fatia, com backend.
  await expect(page.getByRole("button", { name: /anexo/i }), "não abrir anexos sem suporte do servidor").toHaveCount(0);
  await expect(page.getByText(/anexos/i), "nem como texto").toHaveCount(0);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 5 · CANCELAMENTO IDEMPOTENTE (HOTFIX de concorrência)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("HOTFIX: o cancelamento sai da tela COM Idempotency-Key, como a confirmação e a conversão", async ({ page }) => {
  // Das três ações desta tela, o cancelamento era a única que mandava o pedido sem chave — e é a que
  // ESTORNA estoque e cancela títulos quando a venda está confirmada. Um reenvio do mesmo pedido sem
  // chave é indistinguível, para o servidor, de um pedido novo.
  //
  // A asserção é sobre o CABEÇALHO que sai do navegador, não sobre o código-fonte da tela: é o que um
  // proxy, um retry ou uma segunda aba realmente entregariam à API.
  await login(page);
  const d = await criar(page, "budget");
  await abrir(page, d);

  // Espera a RESPOSTA, não o request: `waitForRequest` resolve quando o pedido SAI, e o `GET` de
  // conferência logo abaixo correria na frente da mutação — um teste que falharia (ou passaria) pelo
  // relógio, não pelo comportamento.
  const resposta = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/api/sales/${d.rota}/${d.id}/cancel`));
  await maisAcoes(page, /^Cancelar /);
  await page.getByTestId("confirm-dialog-confirm").click();
  const res = await resposta;
  const req = res.request();

  expect(res.status(), `o servidor precisa ter aceitado o cancelamento: ${await res.text()}`).toBe(200);
  expect(req.headers()["idempotency-key"], "sem chave, o reenvio do cancelamento vira um segundo estorno").toBeTruthy();
  expect(req.postDataJSON(), "o motivo continua sendo enviado, e agora é conferido pelo servidor").toMatchObject({ reason: expect.any(String) });

  const depois = await api<{ status: string }>(page, "GET", `/api/sales/${d.rota}/${d.id}`);
  expect(depois.status, "o clique precisa ter cancelado de verdade — cabeçalho certo em pedido que não faz nada não prova nada").toBe("cancelled");
});
