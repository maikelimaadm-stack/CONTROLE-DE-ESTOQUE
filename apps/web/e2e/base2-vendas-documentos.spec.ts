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
  await expect(page.getByTestId("base2-shell")).toBeVisible();
}

const campo = (page: Page, rotulo: string) => page.locator(`[data-testid="base2-field"][data-campo="${rotulo}"]`);

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
  test(`BASE2-03C: ${variante} abre no Modelo Base 2 com identidade, TOP, itens e total do servidor`, async ({ page }) => {
    await login(page);
    const d = await criar(page, variante);
    await abrir(page, d);

    // IDENTIDADE — o título funcional do REGISTRO + o código do registro
    await expect(page.getByRole("heading", { name: new RegExp(`${V[variante].titulo}\\s+${d.code}`) })).toBeVisible();
    await expect(campo(page, "Código")).toContainText(d.code);

    // empresa e situação no cabeçalho
    await expect(page.getByTestId("base2-empresa")).toBeVisible();
    await expect(page.getByTestId("base2-empresa")).not.toHaveText(/Empresa:\s*$/);
    await expect(page.getByTestId("base2-shell").locator("[data-status]").first()).toBeVisible();

    // TOP da variante — e NUNCA a de nenhuma das vizinhas
    const tipo = campo(page, ptBR.mensagens["termos.tipo_operacao"]!);
    await expect(tipo).toContainText(V[variante].top);
    for (const outra of (["budget", "order", "sale"] as Variante[]).filter((x) => x !== variante)) {
      await expect(tipo, `${variante} não pode exibir a TOP de ${outra}`).not.toContainText(V[outra].top);
    }

    // DADOS PRINCIPAIS — os campos do documento continuam existindo depois da migração
    await expect(page.getByTestId("base2-fields")).toBeVisible();
    for (const rotulo of ["Data", "Cliente", "Subtotal", "Frete", "Total", "Origem"]) {
      await expect(campo(page, rotulo), `campo "${rotulo}" sumiu dos dados principais`).toBeVisible();
    }

    // ITENS — na moldura, com a contagem do servidor e SEM rodapé de total
    const secao = page.locator('[data-testid="base2-section"][data-secao="Itens"]');
    await expect(secao).toBeVisible();
    expect(d.itens, "a fixture precisa ter item, senão a tabela passaria vazia").toBeGreaterThan(0);
    await expect(secao.getByTestId("base2-section-contagem")).toHaveText(String(d.itens));
    await expect(secao.getByTestId("base2-items-linha")).toHaveCount(d.itens);
    for (const coluna of ["Código", "Produto", "Armazém", "Quantidade", "Valor unitário", "Desconto", "Total"]) {
      await expect(secao.locator("thead th", { hasText: coluna }).first()).toBeVisible();
    }
    await expect(secao.locator("tfoot"), "o Base2Items não totaliza — total de documento é campo do cabeçalho").toHaveCount(0);

    // TOTAL — o número do SERVIDOR, que com frete difere da soma dos itens
    const formatado = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(Number(d.total));
    await expect(campo(page, "Total"), "o total exibido é o do servidor").toContainText(formatado);

    // ROTA CANÔNICA da variante DO REGISTRO
    await page.getByRole("button", { name: "Voltar" }).click();
    await expect(page).toHaveURL(new RegExp(`(/vendas/${V[variante].rota}(\\?|$)|/vendas\\?)`));
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
  await expect(page.getByTestId("base2-shell")).toHaveCount(0);
  await expect(page.getByText(orcamento.code, { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Venda/ }), "variante errada não pode cair no rótulo de venda").toHaveCount(0);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 3 · RELACIONAMENTOS — documento derivado e conta a receber
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("BASE2-03C: a conversão liga origem e derivado, e cada lado abre na SUA rota canônica", async ({ page }) => {
  await login(page);
  const orcamento = await criar(page, "budget");

  const convertido = await api<{ id: string; kind: string }>(page, "POST", `/api/sales/${orcamento.rota}/${orcamento.id}/convert`, {});
  expect(convertido.kind, "budget converte em order").toBe("order");

  // ORIGEM: a seção de derivados existe, com link para o pedido
  await abrir(page, orcamento);
  const derivados = page.locator('[data-testid="base2-section"][data-secao="Documentos derivados"]');
  await expect(derivados).toBeVisible();
  await expect(derivados.getByTestId("base2-section-contagem")).toHaveText("1");
  await expect(derivados.getByTestId("base2-items-linha")).toHaveCount(1);
  await expect(derivados.locator(`a[href="/vendas/orders/${convertido.id}"]`), "o link do derivado aponta para a rota da variante DELE").toBeVisible();
  await expect(page.getByTestId("base2-shell").locator("[data-status]").first(), "a origem fica convertida").toHaveText(/Convertid/i);

  // DERIVADO: abre como PEDIDO — identidade e TOP do registro derivado, não da origem
  const pedido = await api<{ code: string }>(page, "GET", `/api/sales/orders/${convertido.id}`);
  await page.goto(`/vendas/orders/${convertido.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
  await expect(page.getByRole("heading", { name: new RegExp(`Pedido de venda\\s+${pedido.code}`) })).toBeVisible();
  await expect(campo(page, ptBR.mensagens["termos.tipo_operacao"]!)).toContainText(V.order.top);
  await expect(campo(page, "Origem"), "o pedido nasceu de uma conversão").toContainText("Convertido");
});

test("BASE2-03C: venda confirmada mostra as contas a receber geradas, com link para o título", async ({ page }) => {
  await login(page);
  const venda = await criar(page, "sale");

  const confirmada = await api<{ title_ids: string[] }>(page, "POST", `/api/sales/sales/${venda.id}/confirm`, {});
  expect(confirmada.title_ids.length, "a confirmação precisa gerar título, senão a seção passaria vazia").toBeGreaterThan(0);

  await abrir(page, venda);
  const contas = page.locator('[data-testid="base2-section"][data-secao="Contas a receber geradas"]');
  await expect(contas).toBeVisible();
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

  await page.getByTestId("base2-historico").click();
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
  await expect(page.getByTestId("base2-anexos"), "não abrir anexos sem suporte do servidor").toHaveCount(0);
});
