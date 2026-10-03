import type { Page, Route } from "@playwright/test";
import { login, api, uniq, empresaAtiva, primeiroId, CLASSIFICACAO_DO_SEED } from "./helpers";
import { cfg4 } from "./top-config-08-comum";
import { hojeISO } from "./estoque-01-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, doSeed, referenciasDoSeed } from "./central-compras-fixtures";

/**
 * OPERACOES-01 — A CHAVE DA DECISÃO NA CONSULTA (o `Idempotency-Key` do Aprovar/Reprovar; regra em
 * `features/aprovacoes/areas-de-aprovacao.ts`, `chaveAoAbrirDecisao`/`chaveDepoisDaDecisao`). API e banco REAIS; a rede é
 * interceptada SÓ para produzir a falha que o caso mede.
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────────────────────────────────────────┐
 * │ AK-1 VENDA: a 1ª tentativa de Aprovar morre na REDE (nunca chega ao servidor) e a 2ª volta 5xx (também sem chegar);│
 * │      a 3ª chega e aprova. As TRÊS levam a MESMA chave — a nova tentativa é a mesma operação.                      │
 * │ AK-2 COMPRA: a 1ª tentativa de Reprovar CHEGA ao servidor e grava, mas a resposta morre na rede; a 2ª, com outro │
 * │      motivo, leva a MESMA chave e o servidor RECUSA o corpo diferente (409, nada gravado de novo); depois dessa   │
 * │      recusa 4xx, a 3ª leva chave NOVA e o servidor decide.                                                      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 * Cada conclusão tem a premissa ao lado, lida no servidor: a situação antes e depois de cada tentativa.
 */

const PV = "central-vendas";
const PC = "central-compras";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Situacao = { situacao: string; ultimaDecisao: null | { decisao: string; observacao: string | null } };
const situacaoNoServidor = (page: Page, area: "vendas" | "compras", id: string) => api<Situacao>(page, "GET", `/api/aprovacoes/${area}/${id}`);
const dialogo = (page: Page) => page.getByTestId("aprovacao-dialogo");

/** Abre a decisão pelo bloco da consulta, escreve o texto (se houver) e envia. */
async function decidirNaTela(page: Page, prefixo: string, decisao: "aprovar" | "reprovar", texto?: string) {
  await page.getByTestId(`${prefixo}-${decisao}`).click();
  await expect(dialogo(page), "a decisão abre o diálogo").toBeVisible();
  if (texto !== undefined) await dialogo(page).getByTestId(decisao === "reprovar" ? "aprovacao-motivo" : "aprovacao-observacao").fill(texto);
  await dialogo(page).getByTestId("aprovacao-confirmar").click();
}

/** Intercepta SÓ o POST da decisão deste documento: guarda a chave de cada tentativa e entrega a tentativa ao `roteiro`. */
function escutarDecisao(page: Page, url: string, roteiro: (tentativa: number, route: Route) => Promise<void>) {
  const chaves: string[] = [];
  void page.route(url, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    chaves.push(route.request().headers()["idempotency-key"] ?? "");
    await roteiro(chaves.length, route);
  });
  return chaves;
}

/** Os cabeçalhos de CORS de uma resposta fabricada para o navegador (a API mora noutra origem). */
const cors = (route: Route) => ({ "access-control-allow-origin": route.request().headers()["origin"] ?? "*", "content-type": "application/json" });

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("AK-1 — venda: Aprovar falha na rede e depois com 5xx (sem chegar ao servidor); a 3ª tentativa aprova — as três com a MESMA chave", async ({ page }) => {
  await login(page);
  let vendaId: string | null = null;
  try {
    const { id: top } = await criarTop(page, { codigo: codigoTop("akv"), codigoBase: "vendas.venda", nome: uniq("AK-1 venda"), configuracao: cfg4({ confirmacao: "manual", aprovacao: "sempre" }) });
    const cliente = await criarCadastro(page, "people", { name: uniq("Cliente AK-1"), person_type: "legal", is_client: true });
    const natureza = await doSeed(page, "/api/resources/financial_categories/options?kind=analytic&nature=income", CLASSIFICACAO_DO_SEED.categoria.nome);
    const centro = await doSeed(page, "/api/resources/cost_centers/options?kind=analytic", CLASSIFICACAO_DO_SEED.centro.nome);
    const venda = await api<{ id: string }>(page, "POST", "/api/sales/sales", {
      empresa_id: await empresaAtiva(page), document_date: hojeISO(), client_id: cliente.id, tipo_operacao_id: top,
      categoria_financeira_id: natureza.id, centro_custo_id: centro.id,
      items: [{ product_id: await primeiroId(page, "/api/resources/products?pageSize=1"), warehouse_id: null, quantity: "1", unit_price: "10.00" }]
    });
    vendaId = venda.id;
    expect(await situacaoNoServidor(page, "vendas", venda.id), "premissa: a venda aberta aguarda a aprovação").toEqual({ situacao: "pendente", ultimaDecisao: null });

    const chaves = escutarDecisao(page, `**/api/aprovacoes/vendas/${venda.id}/aprovar`, async (n, route) => {
      if (n === 1) return route.abort("failed");                                              // a rede caiu: nada chegou
      if (n === 2) return route.fulfill({ status: 503, headers: cors(route), body: JSON.stringify({ error: { code: "INTERNAL", message: "Indisponível" } }) });
      return route.continue();                                                                  // a 3ª chega ao servidor
    });
    await page.goto(`/vendas/sales/${venda.id}`);
    const bloco = page.getByTestId(`${PV}-aprovacao`);
    await expect(bloco, "o bloco pendente na consulta").toHaveAttribute("data-situacao", "pendente");

    // 1ª — REDE.
    await decidirNaTela(page, PV, "aprovar");
    await expect(dialogo(page), "erro que não é 422: o diálogo fecha").toBeHidden();
    await expect.poll(() => chaves.length, "a 1ª tentativa saiu do navegador").toBe(1);
    expect((await situacaoNoServidor(page, "vendas", venda.id)).situacao, "premissa: nada chegou ao servidor").toBe("pendente");
    await expect(bloco, "o bloco continua pendente").toHaveAttribute("data-situacao", "pendente");

    // 2ª — 5xx.
    const r503 = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/aprovacoes/vendas/${venda.id}/aprovar`));
    await decidirNaTela(page, PV, "aprovar");
    expect((await r503).status(), "premissa: a 2ª tentativa recebeu 5xx").toBe(503);
    await expect(dialogo(page)).toBeHidden();
    expect((await situacaoNoServidor(page, "vendas", venda.id)).situacao, "premissa: ainda nada no servidor").toBe("pendente");

    // 3ª — chega e aprova.
    const r200 = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/aprovacoes/vendas/${venda.id}/aprovar`));
    await decidirNaTela(page, PV, "aprovar");
    expect((await r200).status(), "a 3ª tentativa aprovou").toBe(200);
    await expect(bloco, "o bloco passa a aprovado").toHaveAttribute("data-situacao", "aprovado");
    expect((await situacaoNoServidor(page, "vendas", venda.id)).ultimaDecisao?.decisao, "no servidor, aprovado").toBe("aprovado");

    // A CONCLUSÃO: três tentativas, UMA chave.
    expect(chaves, "três tentativas").toHaveLength(3);
    expect(chaves[0], "a chave é um UUID").toMatch(UUID);
    expect(new Set(chaves).size, `rede e 5xx mantêm a chave: ${chaves.join(", ")}`).toBe(1);
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (vendaId) await api(page, "POST", `/api/sales/sales/${vendaId}/cancel`, {}).catch(() => undefined);
  }
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("AK-2 — compra: Reprovar grava mas a resposta morre na rede; a 2ª (outro motivo) leva a MESMA chave e recebe 409 sem gravar; depois do 4xx, a 3ª leva chave NOVA e o servidor decide", async ({ page }) => {
  await login(page);
  let compraId: string | null = null;
  try {
    const ref = await referenciasDoSeed(page);
    const empresa = await empresaAtiva(page);
    const { id: top } = await criarTop(page, { codigo: codigoTop("akc"), codigoBase: "compras.compra", nome: uniq("AK-2 compra"), configuracao: cfg4({ confirmacao: "manual", aprovacao: "sempre" }) });
    const produto = await criarCadastro(page, "products", { description: uniq("AK-2 produto"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id });
    const armazem = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `K${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq("AK-2 local"), type: "inputs" });
    const fornecedor = await criarCadastro(page, "people", { name: uniq("AK-2 forn"), person_type: "legal", is_provider: true });
    const compra = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
      empresa_id: empresa, tipo_operacao_id: top, fornecedor_id: fornecedor.id, data_documento: hojeISO(),
      categoria_financeira_id: ref.natureza.id, centro_custo_id: ref.centro.id,
      itens: [{ produto_id: produto.id, armazem_id: armazem.id, quantidade: "2", valor_unitario: "10.00" }]
    });
    compraId = compra.id;
    expect(await situacaoNoServidor(page, "compras", compra.id), "premissa: a compra aberta aguarda a aprovação").toEqual({ situacao: "pendente", ultimaDecisao: null });

    let statusDaPrimeiraNoServidor = 0;
    const chaves = escutarDecisao(page, `**/api/aprovacoes/compras/${compra.id}/reprovar`, async (n, route) => {
      if (n === 1) {
        // A 1ª CHEGA ao servidor (que grava) e a resposta morre no caminho: o cliente não sabe que gravou.
        statusDaPrimeiraNoServidor = (await route.fetch()).status();
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.goto(`/compras/compras/${compra.id}`);
    const bloco = page.getByTestId(`${PC}-aprovacao`);
    await expect(bloco, "o bloco pendente na consulta").toHaveAttribute("data-situacao", "pendente");

    // 1ª — gravou, mas o cliente viu erro de rede.
    await decidirNaTela(page, PC, "reprovar", "Motivo A");
    await expect(dialogo(page), "erro que não é 422: o diálogo fecha").toBeHidden();
    await expect.poll(() => statusDaPrimeiraNoServidor, "premissa: a 1ª chegou ao servidor e foi aceita").toBe(200);
    expect((await situacaoNoServidor(page, "compras", compra.id)).ultimaDecisao, "premissa: o servidor gravou a reprovação com o motivo A")
      .toMatchObject({ decisao: "reprovado", observacao: "Motivo A" });
    await expect(bloco, "a consulta recarregada mostra a reprovação").toHaveAttribute("data-situacao", "reprovado");

    // 2ª — a MESMA chave, outro corpo: o servidor recusa (4xx) e não decide de novo.
    const r409 = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/aprovacoes/compras/${compra.id}/reprovar`));
    await decidirNaTela(page, PC, "reprovar", "Motivo B");
    const recusa = await r409;
    expect([recusa.status(), ((await recusa.json()) as { error?: { code?: string } }).error?.code], "a chave repetida com outro corpo é recusada").toEqual([409, "CONFLICT"]);
    await expect(dialogo(page)).toBeHidden();
    expect((await situacaoNoServidor(page, "compras", compra.id)).ultimaDecisao?.observacao, "nada gravado de novo: ainda o motivo A").toBe("Motivo A");
    expect(chaves[1], "a 2ª tentativa (sem resposta da 1ª) levou a MESMA chave").toBe(chaves[0]);

    // 3ª — depois da recusa 4xx, chave NOVA: o servidor julga um pedido novo e decide.
    const r200 = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/aprovacoes/compras/${compra.id}/reprovar`));
    await decidirNaTela(page, PC, "reprovar", "Motivo B");
    expect((await r200).status(), "a 3ª tentativa foi aceita").toBe(200);
    expect((await situacaoNoServidor(page, "compras", compra.id)).ultimaDecisao, "a nova decisão gravada, com o motivo B")
      .toMatchObject({ decisao: "reprovado", observacao: "Motivo B" });

    expect(chaves, "três tentativas").toHaveLength(3);
    expect(chaves[0], "a chave é um UUID").toMatch(UUID);
    expect(chaves[2], `depois do 4xx a chave foi renovada: ${chaves.join(", ")}`).not.toBe(chaves[0]);
    expect(chaves[2], "a chave nova também é um UUID").toMatch(UUID);
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (compraId) await api(page, "POST", `/api/compras/compras/${compraId}/cancel`, {}).catch(() => undefined);
  }
});
