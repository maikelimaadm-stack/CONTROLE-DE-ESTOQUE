import type { Page } from "@playwright/test";
import { api, login, logout, pickRef, uniq } from "./helpers";
import { cfg5, chamarApi } from "./top-config-08-comum";
import { test, expect, criarCadastro } from "./central-compras-fixtures";
import {
  DICA_DO_EDITAR, ESPECIE, MSG_DOCUMENTO_MUDOU, MSG_NADA_MUDOU, MSG_NAO_EDITAVEL, MSG_PARTES_ATIVAS, MSG_PARTE_RESERVA_ARMAZEM, MSG_SALVO, MSG_SALVO_E_CONFIRMADO, MSG_SEM_TOP,
  SEGMENTO, abrirAba, abrirConsulta, abrirEdicao, campoDaObservacao, cenarioDeVenda, criarDoc, darSaldo, dialogo, editar, editarDesabilitado,
  efeitosNoBanco, escolherNaCelula, identidade, itensNoBanco, lerDoc, linhas, ouvirOFio, saldoNoServidor, salvar, salvarEdicao, toast, topDeVenda,
  topDeVendaAutomatica, topDeVendaManual, type DocLido, type Variante
} from "./editar-03-comum";

/**
 * EDITAR-03 (F1, decisão 315) — EDITAR O ORÇAMENTO, O PEDIDO E A VENDA SALVOS, PELA TELA.
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────────────┐
 * │ A integração (`editar-01-*.test.ts`, `top-config-08-vendas.test.ts`) prova a PATCH e o `GET /edicao` no servidor;  │
 * │ o unitário (`central-vendas-edicao*.test.ts`, `central-vendas-editar.test.ts`), as contas puras da tela. O que só  │
 * │ o E2E alcança é o ELO: a consulta oferece (ou não) o "Editar" com o motivo do servidor, a MESMA Central de Vendas  │
 * │ abre em modo edição com o GRAVADO, o Salvar manda no fio `{ version, ...só o que mudou }` com a Idempotency-Key,   │
 * │ o 409 pede para recarregar, a trava do armazém aparece na célula e a PATCH recusa o mesmo, e a venda cuja versão  │
 * │ congelada CONFIRMA ao salvar avisa ANTES — sem PATCH nenhuma até a pessoa confirmar.                              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O SERVIDOR É O ÁRBITRO: premissa e conclusão no `GET :id`/`GET /edicao`, no fio (a PATCH, as portas pedidas) e no
 * banco do E2E (só SELECT: `stock_movements`, `financial_titles` e os itens, pela origem). Cadastros e TOPs próprios,
 * excluídos no fim (`central-compras-fixtures.ts`); os documentos ficam (decisão 247). 1440×900.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const confirmarDoDialogo = (page: Page) => page.getByTestId("confirm-dialog-confirm");

/* ═════════════════════════════════════ E3-1 — A PÍLULA E OS MOTIVOS DO SERVIDOR ═════════════════════════════════════ */

test("E3-1 — a pílula Editar na consulta: habilitada na venda aberta (dica 'Editar venda'); DESABILITADA com o motivo do /edicao na confirmada, na cancelada e na venda sem TOP — e a PATCH recusa cada uma com a MESMA razão", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDeVenda(page, "E3-1");
  const top = await topDeVendaManual(page, "E3-1");
  const item = [{ product_id: c.p3.id, warehouse_id: null, quantity: "1", unit_price: "8.00" }];

  // ABERTA: habilitada, sem motivo.
  const aberta = await criarDoc(page, "sale", c, top, item);
  expect([aberta.status, aberta.version], "premissa: a venda nasce aberta, na versão 0").toEqual(["open", "0"]);
  await abrirConsulta(page, "sale", aberta);
  await expect(editar(page), "a venda aberta: Editar habilitado").toBeEnabled();
  await expect(editar(page)).toHaveAttribute("data-dica", DICA_DO_EDITAR.sale);
  await expect(editar(page), "sem motivo").not.toHaveAttribute("data-motivo", /.+/);

  // CONFIRMADA, CANCELADA e SEM TOP: desabilitada, com o motivo do servidor; a PATCH recusa com o mesmo texto.
  const confirmada = await criarDoc(page, "sale", c, top, item);
  await api(page, "POST", `/api/sales/sales/${confirmada.id}/confirm`, {});
  const cancelada = await criarDoc(page, "sale", c, top, item);
  await api(page, "POST", `/api/sales/sales/${cancelada.id}/cancel`, {});
  const semTop = await criarDoc(page, "sale", c, null, item);
  expect(semTop.tipo_operacao_id, "premissa: a venda legada, sem TOP").toBeNull();
  for (const [rotulo, doc, motivo] of [["confirmada", confirmada, MSG_NAO_EDITAVEL], ["cancelada", cancelada, MSG_NAO_EDITAVEL], ["sem TOP", semTop, MSG_SEM_TOP]] as const) {
    const lido = await lerDoc(page, "sale", doc.id);
    await abrirConsulta(page, "sale", lido);
    await editarDesabilitado(page, "sale", lido, motivo);
    const p = await chamarApi<{ error?: { code?: string; message?: string } }>(page, "PATCH", `/api/sales/sales/${doc.id}`, { version: lido.version, note: "não pode" });
    expect([p.status, p.corpo.error?.message], `${rotulo}: a PATCH recusa com a MESMA razão da tela`).toEqual([409, motivo]);
  }
  expect((await lerDoc(page, "sale", confirmada.id)).status, "premissa: a confirmada está confirmada").toBe("confirmed");
});

/* ═════════════════════════════════════ E3-2 — QUEM SÓ VÊ, QUEM EDITA SEM LANÇAR ═════════════════════════════════════ */

test("E3-2 — sem .edit o Editar NÃO aparece (orçamento, pedido e venda) e a consulta nem pergunta o /edicao; o servidor recusa com 403. Com .view+.edit e SEM .create: o Editar abre e grava, sem pedir nenhuma porta do lançamento", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  const c = await cenarioDeVenda(page, "E3-2");
  const tops = { budget: await topDeVenda(page, "budget", "E3-2"), order: await topDeVenda(page, "order", "E3-2"), sale: await topDeVendaManual(page, "E3-2") };
  const item = [{ product_id: c.p3.id, warehouse_id: null, quantity: "1", unit_price: "4.00" }];
  const docs: [Variante, DocLido][] = [];
  for (const v of ["budget", "order", "sale"] as const) docs.push([v, await criarDoc(page, v, c, tops[v], item)]);
  // PREMISSA anti-vacuidade: no MESMO documento, o administrador tem o Editar habilitado.
  for (const [v, doc] of docs) {
    await abrirConsulta(page, v, doc);
    await expect(editar(page), `premissa: o administrador tem o Editar do ${ESPECIE[v]}`).toBeEnabled();
    await expect(editar(page)).toHaveAttribute("data-dica", DICA_DO_EDITAR[v]);
  }

  const marca = Date.now().toString(36);
  const escopos = [{ modulo: "vendas", modo: "todas", empresas: [] }, { modulo: "estoque", modo: "todas", empresas: [] }];
  const leitor = { email: `e3-leitor-${marca}@demo.local`, password: "Leitor@12345" };
  const editor = { email: `e3-editor-${marca}@demo.local`, password: "Vendedor@12345" };
  const papelLeitor = await api<{ id: string }>(page, "POST", "/api/admin/roles", { name: uniq("Leitor de vendas E3"), permissions: ["budgets.view", "orders.view", "sales.view", "people.view", "products.view", "warehouses.view"] });
  const papelEditor = await api<{ id: string }>(page, "POST", "/api/admin/roles", { name: uniq("Editor de vendas E3"), permissions: [
    "budgets.view", "budgets.edit", "orders.view", "orders.edit", "sales.view", "sales.edit", "people.view", "products.view", "warehouses.view", "financial_categories.view", "cost_centers.view"
  ] });
  await api(page, "POST", "/api/admin/members", { name: "Leitor de vendas E3", email: leitor.email, password: leitor.password, role_id: papelLeitor.id, escopos_empresas: escopos });
  await api(page, "POST", "/api/admin/members", { name: "Editor de vendas E3", email: editor.email, password: editor.password, role_id: papelEditor.id, escopos_empresas: escopos });
  await logout(page);
  try {
    // QUEM SÓ VÊ: nem a pílula, nem a pergunta; o servidor recusa as duas portas.
    await login(page, leitor);
    for (const [v, doc] of docs) {
      const perguntas: string[] = [];
      const ouvir = (r: { url(): string }) => { if (new URL(r.url()).pathname.endsWith("/edicao")) perguntas.push(new URL(r.url()).pathname); };
      page.on("request", ouvir);
      await abrirConsulta(page, v, doc);
      await page.waitForLoadState("networkidle");
      await expect(editar(page), `${ESPECIE[v]}: sem .edit, o Editar não aparece`).toHaveCount(0);
      page.off("request", ouvir);
      expect(perguntas, `${ESPECIE[v]}: a consulta não pergunta o /edicao a quem não edita`).toEqual([]);
      const p = await chamarApi(page, "PATCH", `/api/sales/${SEGMENTO[v]}/${doc.id}`, { version: "0", note: "não pode" });
      const g = await chamarApi(page, "GET", `/api/sales/${SEGMENTO[v]}/${doc.id}/edicao`);
      expect([p.status, g.status], `${ESPECIE[v]}: a PATCH e o /edicao recusam quem não tem .edit`).toEqual([403, 403]);
    }
    await logout(page);

    // QUEM EDITA SEM LANÇAR: o Editar abre e grava; nenhuma porta que pede .create é pedida, nenhum 403 de vendas.
    await login(page, editor);
    const [, venda] = docs[2]!;
    await abrirConsulta(page, "sale", venda);
    await expect(editar(page), "o editor tem o Editar habilitado").toBeEnabled();
    const fio = ouvirOFio(page);
    fio.abrirJanela();
    await abrirEdicao(page, "sale", venda);
    await (await campoDaObservacao(page)).fill("editada por quem não lança");
    fio.fecharJanela();
    const patch = await salvarEdicao(page, "sale", venda);
    fio.parar();
    expect([patch.status, patch.corpo], "a PATCH do editor grava só a observação").toEqual([200, { version: "0", note: "editada por quem não lança" }]);
    expect([fio.portasDaCriacao, fio.topsDeOutraVariante], "a edição não pede nenhuma porta do lançamento (.create), de variante nenhuma").toEqual([[], []]);
    expect(fio.recusas403, "nenhuma porta de vendas respondeu 403 na edição").toEqual([]);
    await expect(identidade(page), "volta à consulta").toHaveText(venda.code);
  } finally {
    await logout(page).catch(() => page.evaluate(() => localStorage.removeItem("agro.session")));
    await login(page);
  }
  const depois = await lerDoc(page, "sale", docs[2]![1].id);
  expect([depois.version, depois.note], "o servidor gravou a edição do editor").toEqual(["1", "editada por quem não lança"]);
  for (const [v, doc] of docs.slice(0, 2)) expect((await lerDoc(page, v, doc.id)).version, `${ESPECIE[v]}: nada gravado pelo leitor`).toBe("0");
});

/* ═════════════════════════════════════ E3-3 — O ORÇAMENTO ═════════════════════════════════════ */

test("E3-3 — orçamento ABERTO: a Central em modo edição com o gravado (sem o Local de estoque do cabeçalho, que a criação tem); Salvar sem mudar nada = ZERO PATCH e volta à consulta; mudar a observação = PATCH { version, note } com Idempotency-Key; nenhuma porta do lançamento; zero efeito em estoque e financeiro", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDeVenda(page, "E3-3");
  const top = await topDeVenda(page, "budget", "E3-3");
  const doc = await criarDoc(page, "budget", c, top, [{ product_id: c.p1.id, warehouse_id: c.l1.id, quantity: "2", unit_price: "10.00" }]);
  expect([doc.status, doc.version, doc.note]).toEqual(["open", "0", "nota gravada"]);

  // PREMISSA anti-vacuidade: a CRIAÇÃO com a mesma TOP tem o "Local de estoque" do cabeçalho.
  await page.goto(`/vendas/budgets/new?tipo_operacao_id=${top}`);
  await expect(page.getByTestId("top-contexto")).toBeVisible();
  await expect(page.getByTestId("central-vendas-local-padrao"), "premissa: a criação tem o Local de estoque do cabeçalho").toHaveCount(1);

  await abrirConsulta(page, "budget", doc);
  const fio = ouvirOFio(page, "budget");
  fio.abrirJanela();
  const edicao = await abrirEdicao(page, "budget", doc);
  expect([edicao["podeEditar"], edicao["version"]], "o /edicao que a tela recebeu").toEqual([true, "0"]);
  await expect(salvar(page), "orçamento não confirma: o Salvar é 'Salvar'").toHaveAttribute("aria-label", "Salvar");
  await expect(page.getByTestId("central-vendas-confirmar"), "sem Confirmar venda na edição").toHaveCount(0);
  await expect(page.getByTestId("central-vendas-local-padrao"), "a edição não semeia o local das linhas novas: o campo do cabeçalho não existe").toHaveCount(0);
  await expect(page.getByTestId("central-vendas-descartar"), "sem alteração, o ✕ é Voltar à consulta").toHaveAttribute("aria-label", "Voltar à consulta");
  await expect(linhas(page), "o item gravado").toHaveCount(1);
  await expect(linhas(page).nth(0).getByTestId("central-vendas-produto")).toContainText(c.p1.nome);
  await expect(linhas(page).nth(0).getByTestId("central-vendas-armazem")).toContainText(c.l1.nome);
  const observacao = await campoDaObservacao(page);
  await expect(observacao, "a observação GRAVADA").toHaveValue("nota gravada");

  // NADA MUDOU: zero PATCH, o aviso, de volta à consulta, a versão igual.
  fio.fecharJanela();
  await salvar(page).click();
  await expect(toast(page, MSG_NADA_MUDOU)).toBeVisible();
  await expect(identidade(page), "volta à consulta").toHaveText(doc.code);
  await page.waitForTimeout(300);
  expect(fio.escritas, "ZERO escrita: nada mudou").toEqual([]);
  expect((await lerDoc(page, "budget", doc.id)).version, "a versão não subiu").toBe("0");

  // A MUDANÇA: só a observação.
  fio.abrirJanela();
  await abrirEdicao(page, "budget", doc);
  await (await campoDaObservacao(page)).fill("orçamento editado E3-3");
  await expect(page.getByTestId("central-vendas-alterado"), "a identidade acende o ponto de alteração").toHaveCount(1);
  await expect(page.getByTestId("central-vendas-descartar")).toHaveAttribute("aria-label", "Descartar alterações");
  const antes = efeitosNoBanco(doc.id);
  fio.fecharJanela();
  const patch = await salvarEdicao(page, "budget", doc);
  fio.parar();
  expect(patch.status, "a PATCH gravou").toBe(200);
  expect(patch.chave, "com Idempotency-Key").toMatch(/.{8,}/);
  expect(patch.corpo, "o corpo: a versão lida e SÓ o que mudou").toEqual({ version: "0", note: "orçamento editado E3-3" });
  expect(fio.escritas, "uma escrita só: a PATCH").toEqual([`PATCH /api/sales/budgets/${doc.id}`]);
  expect(fio.portasDaCriacao, "nenhuma porta do lançamento (.create) do orçamento foi pedida nas duas aberturas da edição").toEqual([]);
  // informativo: as TOPs do destino da conversão que a CONSULTA (montada por baixo da edição) pergunta para quem tem o `.create` dele
  console.log(`E3-3 TOPS-DE-OUTRA-VARIANTE-NA-JANELA ${JSON.stringify(fio.topsDeOutraVariante)}`);
  await expect(page.getByTestId("central-vendas-salvo"), "a consulta volta e acende o Salvo").toBeVisible();
  await expect(identidade(page), "a consulta do documento").toHaveText(doc.code);
  await expect(toast(page, MSG_SALVO)).toBeVisible();
  await abrirAba(page, "Observações");
  await expect(page.getByTestId("central-vendas-painel").getByRole("tabpanel")).toContainText("orçamento editado E3-3");
  const depois = await lerDoc(page, "budget", doc.id);
  expect([depois.version, depois.note, depois.status]).toEqual(["1", "orçamento editado E3-3", "open"]);
  expect(efeitosNoBanco(doc.id), "o orçamento não produz efeito").toEqual({ ...antes, situacao: "open" });
  expect([antes.movimentos, antes.titulos]).toEqual([0, 0]);
});

/* ═════════════════════════════════════ E3-4 — O PEDIDO ═════════════════════════════════════ */

test("E3-4 — pedido ABERTO: muda a quantidade de um item e a observação → PATCH com os itens COMPLETOS (os salvos pelo id, só o campo que mudou) → o GET com o valor novo e a versão +1; zero efeito", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDeVenda(page, "E3-4");
  const top = await topDeVenda(page, "order", "E3-4");
  const doc = await criarDoc(page, "order", c, top, [
    { product_id: c.p1.id, warehouse_id: c.l1.id, quantity: "2", unit_price: "10.00" }, { product_id: c.p2.id, warehouse_id: c.l1.id, quantity: "1", unit_price: "5.00" }
  ]);
  const [a, b] = doc.items;
  expect([a?.product_id, b?.product_id], "premissa: P1 e P2, na ordem").toEqual([c.p1.id, c.p2.id]);

  await abrirConsulta(page, "order", doc);
  await abrirEdicao(page, "order", doc);
  await linhas(page).nth(0).click();
  await linhas(page).nth(0).getByLabel("Quantidade do item 1").fill("5");
  await (await campoDaObservacao(page)).fill("pedido editado E3-4");
  const patch = await salvarEdicao(page, "order", doc);
  expect([patch.status, patch.corpo]).toEqual([200, { version: "0", note: "pedido editado E3-4", items: [{ id: a!.id, quantity: "5" }, { id: b!.id }] }]);
  expect(patch.chave, "com Idempotency-Key").toMatch(/.{8,}/);
  await expect(toast(page, MSG_SALVO)).toBeVisible();
  await expect(identidade(page)).toHaveText(doc.code);
  const depois = await lerDoc(page, "order", doc.id);
  expect({ version: depois.version, note: depois.note, total: depois.total, itens: depois.items.map((i) => [i.id, i.quantity]) }).toEqual({
    version: "1", note: "pedido editado E3-4", total: "55.00", itens: [[a!.id, "5.0000"], [b!.id, "1.0000"]]
  });
  expect(efeitosNoBanco(doc.id), "o pedido não confirma: zero efeito").toEqual({ movimentos: 0, titulos: 0, valores: [], situacao: "open" });
});

/* ═════════════════════════════════════ E3-5 — A VENDA REMOVE ITEM ═════════════════════════════════════ */

test("E3-5 — venda ABERTA (Confirmação Manual): o item salvo tem o Remover; remover o 2º e trocar o local do 1º (item sem trava) → PATCH { version, items: [{ id, warehouse_id }] } → o item SOME no banco; o Salvar é 'Salvar' e não confirma (zero efeito)", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDeVenda(page, "E3-5");
  const top = await topDeVendaManual(page, "E3-5");
  const doc = await criarDoc(page, "sale", c, top, [
    { product_id: c.p1.id, warehouse_id: c.l1.id, quantity: "2", unit_price: "10.00" }, { product_id: c.p2.id, warehouse_id: c.l1.id, quantity: "1", unit_price: "5.00" }
  ]);
  const [a, b] = doc.items;
  expect(itensNoBanco(doc.id), "premissa: os dois itens no banco").toEqual([`${a!.id}|${c.p1.id}|${c.l1.id}`, `${b!.id}|${c.p2.id}|${c.l1.id}`]);

  await abrirConsulta(page, "sale", doc);
  const edicao = await abrirEdicao(page, "sale", doc);
  expect((edicao["limites"] as Record<string, unknown>)["somenteArmazemEObservacao"], "premissa no fio: venda livre").toBe(false);
  await expect(salvar(page), "TOP Manual: o Salvar é 'Salvar'").toHaveAttribute("aria-label", "Salvar");
  await expect(page.getByTestId("central-vendas-confirmar"), "sem Confirmar venda na edição").toHaveCount(0);

  // O ITEM SALVO SAI (a venda remove item): marcado, o Remover aparece; a linha some.
  await linhas(page).nth(1).click();
  await expect(page.getByTestId("central-vendas-remover-item"), "o item salvo da venda tem o Remover").toHaveCount(1);
  await page.getByTestId("central-vendas-remover-item").click();
  await expect(linhas(page)).toHaveCount(1);
  // O ITEM SEM TRAVA TROCA O LOCAL: a célula é a de pesquisa (sem `data-travado`).
  const local = linhas(page).nth(0).getByTestId("central-vendas-armazem");
  await expect(local, "item sem trava: a célula do local é a de pesquisa").not.toHaveAttribute("data-travado", /.*/);
  await escolherNaCelula(page, local, c.l2.nome);

  const patch = await salvarEdicao(page, "sale", doc);
  expect([patch.status, patch.corpo], "a lista COMPLETA sem o 2º item, e o local novo no 1º").toEqual([200, { version: "0", items: [{ id: a!.id, warehouse_id: c.l2.id }] }]);
  expect(patch.resposta["confirmacaoAutomatica"], "Confirmação Manual: a PATCH não tenta confirmar").toBeUndefined();
  await expect(toast(page, MSG_SALVO)).toBeVisible();
  await expect(identidade(page)).toHaveText(doc.code);
  expect(itensNoBanco(doc.id), "o 2º item SUMIU do banco; o 1º no local novo").toEqual([`${a!.id}|${c.p1.id}|${c.l2.id}`]);
  const depois = await lerDoc(page, "sale", doc.id);
  expect([depois.version, depois.status, depois.total]).toEqual(["1", "open", "20.00"]);
  expect(efeitosNoBanco(doc.id), "a venda Manual não confirma ao salvar").toEqual({ movimentos: 0, titulos: 0, valores: [], situacao: "open" });
});

/* ═════════════════════════════════════ E3-6 — O DOCUMENTO MUDOU (409), EM DUAS ABAS ═════════════════════════════════════ */

test("E3-6 — duas abas editam a MESMA venda (versão 0): a 1ª grava (200); a 2ª recebe 409 → o diálogo 'O documento mudou' com a mensagem do servidor; 'Continuar editando' mantém o rascunho e nada sobrescreve; 'Recarregar o documento' traz o gravado e a gravação seguinte vale", async ({ page, context }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDeVenda(page, "E3-6");
  const top = await topDeVendaManual(page, "E3-6");
  const doc = await criarDoc(page, "sale", c, top, [{ product_id: c.p1.id, warehouse_id: c.l1.id, quantity: "2", unit_price: "10.00" }]);

  const outra = await context.newPage();
  try {
    for (const p of [page, outra]) { await abrirConsulta(p, "sale", doc); await abrirEdicao(p, "sale", doc); }
    await (await campoDaObservacao(page)).fill("a aba 1 grava");
    await (await campoDaObservacao(outra)).fill("o rascunho da aba 2");
    const primeira = await salvarEdicao(page, "sale", doc);
    expect([primeira.status, primeira.corpo], "a 1ª aba grava sobre a versão 0").toEqual([200, { version: "0", note: "a aba 1 grava" }]);

    const segunda = await salvarEdicao(outra, "sale", doc);
    expect([segunda.status, segunda.corpo], "a 2ª aba leva a versão que ELA leu, e é recusada").toEqual([409, { version: "0", note: "o rascunho da aba 2" }]);
    const conflito = outra.getByTestId("vendas-edicao-conflito");
    await expect(conflito, "o diálogo do conflito, com a mensagem do servidor").toHaveText(MSG_DOCUMENTO_MUDOU);
    await expect(confirmarDoDialogo(outra)).toHaveText("Recarregar o documento");
    expect((await lerDoc(page, "sale", doc.id)).note, "a recusa NÃO sobrescreveu").toBe("a aba 1 grava");

    // CONTINUAR EDITANDO: o rascunho fica; salvar de novo leva a MESMA versão e volta a 409 — nunca sobrescreve calado.
    await dialogo(outra).getByRole("button", { name: "Continuar editando" }).click();
    await expect(conflito).toHaveCount(0);
    await expect(identidade(outra), "continua editando").toHaveText(`Editar venda ${doc.code}`);
    await expect(await campoDaObservacao(outra), "o rascunho continua").toHaveValue("o rascunho da aba 2");
    const deNovo = await salvarEdicao(outra, "sale", doc);
    expect([deNovo.status, deNovo.corpo["version"]]).toEqual([409, "0"]);
    await expect(conflito).toHaveText(MSG_DOCUMENTO_MUDOU);
    expect((await lerDoc(page, "sale", doc.id)).note, "de novo, nada sobrescrito").toBe("a aba 1 grava");

    // RECARREGAR: o /edicao e o documento de novo, a versão 1 e o valor da 1ª aba (o rascunho sai, de propósito).
    const relido = outra.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === `/api/sales/sales/${doc.id}/edicao`);
    await confirmarDoDialogo(outra).click();
    expect(((await (await relido).json()) as Record<string, unknown>)["version"], "recarregou a versão nova").toBe("1");
    await expect(conflito).toHaveCount(0);
    await expect(identidade(outra)).toHaveText(`Editar venda ${doc.code}`);
    await expect(await campoDaObservacao(outra), "o formulário mostra o gravado pela 1ª aba").toHaveValue("a aba 1 grava");
    await (await campoDaObservacao(outra)).fill("depois de recarregar");
    const ok = await salvarEdicao(outra, "sale", doc);
    expect([ok.status, ok.corpo], "agora com a versão 1").toEqual([200, { version: "1", note: "depois de recarregar" }]);
    expect(ok.chave, "a chave de idempotência da edição recarregada é OUTRA").not.toBe(segunda.chave);
  } finally {
    await outra.close();
  }
  const depois = await lerDoc(page, "sale", doc.id);
  expect([depois.version, depois.note]).toEqual(["2", "depois de recarregar"]);
});

/* ═════════════════════════════ E3-7 — A TRAVA DO ARMAZÉM (A PARTE DE PEDIDO QUE RESERVA ESTOQUE) ═════════════════════════════ */

test("E3-7 — a venda gerada em partes de um pedido que RESERVA estoque: o item que controla estoque tem o local TRAVADO (a célula travada, o campo travado no formulário), o que não controla troca; nada de item novo, Duplicar ou Remover; a PATCH aceita a troca do livre e RECUSA a do travado (422 em items[0].warehouse_id, a razão do servidor); o pedido com parte ativa: Editar desabilitado com o motivo", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  const c = await cenarioDeVenda(page, "E3-7");
  const topVenda = await topDeVendaManual(page, "E3-7");
  const topPedido = await topDeVenda(page, "order", "E3-7 com reserva", { reservaEstoque: true, destinos: [{ tipoOperacaoId: topVenda, ordem: 0, emPartes: true }] });
  const pedido = await criarDoc(page, "order", c, topPedido, [
    { product_id: c.p1.id, warehouse_id: c.l1.id, quantity: "4", unit_price: "10.00" }, { product_id: c.p3.id, warehouse_id: c.l1.id, quantity: "2", unit_price: "5.00" }
  ]);
  const [o1, o3] = pedido.items;
  const { id: parteId } = await api<{ id: string }>(page, "POST", `/api/sales/orders/${pedido.id}/convert`, {
    tipo_operacao_id: topVenda, itens: [{ item_id: o1!.id, quantidade: "2" }, { item_id: o3!.id, quantidade: "1" }]
  });
  const parte = await lerDoc(page, "sale", parteId);
  const [i1, i3] = parte.items;
  expect([i1?.product_id, i1?.warehouse_id, i3?.product_id, parte.status], "premissa: a parte com P1 em L1 e P3, aberta").toEqual([c.p1.id, c.l1.id, c.p3.id, "open"]);

  // O PEDIDO COM PARTE ATIVA: Editar desabilitado com o motivo do servidor; a PATCH recusa com o mesmo texto.
  await abrirConsulta(page, "order", await lerDoc(page, "order", pedido.id));
  await editarDesabilitado(page, "order", pedido, MSG_PARTES_ATIVAS);
  const pp = await chamarApi<{ error?: { message?: string } }>(page, "PATCH", `/api/sales/orders/${pedido.id}`, { version: (await lerDoc(page, "order", pedido.id)).version, note: "x" });
  expect([pp.status, pp.corpo.error?.message]).toEqual([409, MSG_PARTES_ATIVAS]);

  // A PARTE: o /edicao declara o armazém travado SÓ no item que controla estoque.
  await abrirConsulta(page, "sale", parte);
  const edicao = await abrirEdicao(page, "sale", parte);
  expect(edicao["limites"], "premissa no fio: só armazém e observação; o local de P1 travado, o de P3 livre").toEqual({
    somenteArmazemEObservacao: true, itens: [{ id: i1!.id, armazemTravado: true }, { id: i3!.id, armazemTravado: false }]
  });
  await expect(linhas(page)).toHaveCount(2);
  const [linhaP1, linhaP3] = [linhas(page).nth(0), linhas(page).nth(1)];
  await expect(linhaP1.getByTestId("central-vendas-produto")).toContainText(c.p1.nome);
  await expect(linhaP1.getByTestId("central-vendas-armazem"), "P1: a célula do local TRAVADA").toHaveAttribute("data-travado", "");
  await expect(linhaP1.getByTestId("central-vendas-armazem"), "mostrando o local gravado").toContainText(c.l1.nome);
  await expect(linhaP1.locator('button[data-testid="central-vendas-armazem"]'), "P1: não é botão de pesquisa").toHaveCount(0);
  await expect(linhaP3.getByTestId("central-vendas-armazem"), "P3 (não controla estoque): a célula de pesquisa").not.toHaveAttribute("data-travado", /.*/);
  for (const l of [linhaP1, linhaP3]) await expect(l.getByTestId("central-vendas-produto"), "o produto da parte, travado").toHaveAttribute("data-travado", "");
  await expect(page.getByTestId("central-vendas-adicionar-item"), "a parte não acrescenta").toHaveCount(0);
  await linhaP1.click();
  await expect(page.getByTestId("central-vendas-duplicar-item"), "nem Duplicar").toHaveCount(0);
  await expect(page.getByTestId("central-vendas-remover-item"), "nem Remover").toHaveCount(0);
  // clicar na célula travada não abre a pesquisa
  await linhaP1.getByTestId("central-vendas-armazem").click();
  await expect(page.getByTestId("central-vendas-pesquisa"), "a célula travada não abre a pesquisa").toHaveCount(0);

  // O FORMULÁRIO DO ITEM: o local de P1 travado (o ramo travado do produto); o de P3, editável.
  await page.getByRole("group", { name: "Visualização dos itens" }).getByRole("button", { name: "Formulário" }).click();
  const formulario = page.getByTestId("central-vendas-item-form");
  await expect(formulario.getByTestId("central-vendas-item-posicao")).toHaveText("Item 1 de 2");
  const campoDoLocal = () => formulario.locator('[data-parte="rotulo"]', { hasText: "Local de estoque" }).locator("xpath=..");
  await expect(campoDoLocal(), "P1: o campo do local, travado").toHaveAttribute("data-estado", "travado");
  await expect(campoDoLocal()).toContainText(c.l1.nome);
  await formulario.getByRole("button", { name: "Próximo item" }).click();
  await expect(formulario.getByTestId("central-vendas-item-posicao")).toHaveText("Item 2 de 2");
  await expect(campoDoLocal(), "P3: o campo do local, editável").not.toHaveAttribute("data-estado", /.*/);
  await page.getByRole("group", { name: "Visualização dos itens" }).getByRole("button", { name: "Grade" }).click();

  // O LIVRE TROCA: P3 vai a L2 pela célula; a PATCH grava.
  await escolherNaCelula(page, linhas(page).nth(1).getByTestId("central-vendas-armazem"), c.l2.nome);
  const patch = await salvarEdicao(page, "sale", parte);
  expect([patch.status, patch.corpo], "a lista completa: P1 só pelo id, P3 com o local novo").toEqual([200, { version: "0", items: [{ id: i1!.id }, { id: i3!.id, warehouse_id: c.l2.id }] }]);
  await expect(identidade(page)).toHaveText(parte.code);
  expect(itensNoBanco(parte.id), "P3 em L2; P1 continua em L1").toEqual([`${i1!.id}|${c.p1.id}|${c.l1.id}`, `${i3!.id}|${c.p3.id}|${c.l2.id}`]);

  // A RECUSA DO SERVIDOR É A MESMA TRAVA: trocar o local de P1 pela PATCH ⇒ 422 no item, com a razão do servidor; nada grava.
  const recusa = await chamarApi<{ error?: { code?: string; message?: string; details?: unknown } }>(page, "PATCH", `/api/sales/sales/${parte.id}`,
    { version: "1", items: [{ id: i1!.id, warehouse_id: c.l2.id }, { id: i3!.id }] });
  expect([recusa.status, recusa.corpo.error?.code, recusa.corpo.error?.message]).toEqual([422, "VALIDATION_ERROR", MSG_PARTE_RESERVA_ARMAZEM]);
  expect(recusa.corpo.error?.details, "o caminho do item travado").toEqual([{ path: "items[0].warehouse_id", message: MSG_PARTE_RESERVA_ARMAZEM }]);
  expect(itensNoBanco(parte.id), "a recusa não gravou nada").toEqual([`${i1!.id}|${c.p1.id}|${c.l1.id}`, `${i3!.id}|${c.p3.id}|${c.l2.id}`]);
  expect((await lerDoc(page, "sale", parte.id)).version).toBe("1");
});

/* ═════════════════════════════ E3-8 — A VENDA QUE CONFIRMA AO SALVAR: O AVISO ANTES ═════════════════════════════ */

test("E3-8 — venda ABERTA de TOP com Confirmação Automática: o Salvar se chama 'Salvar e confirmar' e ABRE O AVISO antes — nenhuma PATCH; Voltar não manda nada e não cria movimento nem título; com a quantidade mudada a prévia mostra só a política (os números são da venda gravada); confirmar no aviso manda UMA PATCH, que confirma: +1 saída de estoque, +1 título de 30,00, e o Editar passa a desabilitado", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  const c = await cenarioDeVenda(page, "E3-8", { saldo: false });
  const top = await topDeVendaAutomatica(page, "E3-8");
  // Sem saldo, a confirmação automática da CRIAÇÃO é recusada e a venda fica aberta; depois o saldo entra.
  const doc = await criarDoc(page, "sale", c, top, [{ product_id: c.p1.id, warehouse_id: c.l1.id, quantity: "2", unit_price: "10.00" }]);
  expect([doc.status, doc.version], "premissa: a criação não confirmou (sem saldo), a venda está aberta").toEqual(["open", "0"]);
  await darSaldo(page, c.empresa, c.l1, c.p1, "10");
  expect(efeitosNoBanco(doc.id), "premissa: nenhum efeito ainda").toEqual({ movimentos: 0, titulos: 0, valores: [], situacao: "open" });

  await abrirConsulta(page, "sale", doc);
  const fio = ouvirOFio(page, "sale");
  fio.abrirJanela();
  const edicao = await abrirEdicao(page, "sale", doc);
  expect((edicao["regras"] as Record<string, unknown>)["regrasGerais"], "premissa no fio: a versão congelada confirma ao salvar").toEqual({ confirmacaoAutomatica: true, aceitaSemItens: false });
  await expect(salvar(page), "o rótulo do servidor").toHaveAttribute("aria-label", "Salvar e confirmar");

  // (1) SÓ A OBSERVAÇÃO: o aviso abre, com os números da prévia (eles valem: a PATCH não toca o que a prévia lê).
  await (await campoDaObservacao(page)).fill("confirmar pela edição");
  await salvar(page).click();
  await expect(dialogo(page), "o aviso abriu ANTES de salvar").toBeVisible();
  await expect(dialogo(page), "o título do diálogo de confirmação da Central").toContainText(`Salvar e confirmar ${doc.code}?`);
  await expect(dialogo(page).getByTestId("previa-confirmacao"), "a prévia do servidor, com os números").toBeVisible();
  await expect(dialogo(page).getByTestId("previa-confirmacao-financeiro")).toContainText("20,00");
  await expect(dialogo(page).getByTestId("previa-confirmacao-na-edicao")).toHaveCount(0);
  await expect(confirmarDoDialogo(page)).toHaveText("Salvar e confirmar");
  await expect(confirmarDoDialogo(page)).toBeEnabled();
  await page.waitForTimeout(300);
  expect(fio.escritas, "o aviso aberto: ZERO PATCH").toEqual([]);
  await dialogo(page).getByRole("button", { name: "Voltar" }).click();
  await expect(dialogo(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(fio.escritas, "Voltar: ZERO PATCH").toEqual([]);
  expect(efeitosNoBanco(doc.id), "Voltar: nenhum movimento, nenhum título, a venda aberta").toEqual({ movimentos: 0, titulos: 0, valores: [], situacao: "open" });
  await expect(identidade(page), "continua editando").toHaveText(`Editar venda ${doc.code}`);

  // (2) A QUANTIDADE TAMBÉM: os números da prévia (da venda GRAVADA) não são o efeito — só a política, e a frase.
  await linhas(page).nth(0).click();
  await linhas(page).nth(0).getByLabel("Quantidade do item 1").fill("3");
  await salvar(page).click();
  await expect(dialogo(page)).toBeVisible();
  const politica = dialogo(page).getByTestId("previa-confirmacao-politica");
  await expect(politica, "só a política").toBeVisible();
  await expect(politica.getByTestId("previa-confirmacao-estoque")).toHaveText("Baixa o estoque dos itens com local de estoque.");
  await expect(politica.getByTestId("previa-confirmacao-financeiro")).toHaveText("Gera contas a receber do total da venda.");
  await expect(politica.getByTestId("previa-confirmacao-na-edicao")).toHaveText("Quantidades, valores e vencimentos da confirmação saem do documento com as suas alterações, calculados pelo servidor ao salvar.");
  await expect(dialogo(page).getByTestId("previa-confirmacao"), "nenhum número da venda gravada").toHaveCount(0);
  await expect(dialogo(page)).not.toContainText("20,00");
  await page.waitForTimeout(300);
  expect(fio.escritas, "o aviso de novo: ZERO PATCH").toEqual([]);

  // (3) CONFIRMAR NO AVISO: UMA PATCH, que confirma.
  const saldoAntes = await saldoNoServidor(page, c.l1, c.p1);
  fio.fecharJanela();
  const patch = await salvarEdicao(page, "sale", doc, () => confirmarDoDialogo(page).click());
  fio.parar();
  expect([patch.status, patch.corpo]).toEqual([200, { version: "0", note: "confirmar pela edição", items: [{ id: doc.items[0]!.id, quantity: "3" }] }]);
  expect(patch.chave, "com Idempotency-Key").toMatch(/.{8,}/);
  expect(patch.resposta["confirmacaoAutomatica"], "a resposta: confirmada").toEqual({ confirmado: true });
  expect(fio.escritas, "exatamente UMA escrita").toEqual([`PATCH /api/sales/sales/${doc.id}`]);
  expect(fio.portasDaCriacao, "a edição (com o aviso e a prévia) não pediu nenhuma porta do lançamento").toEqual([]);
  await expect(toast(page, MSG_SALVO_E_CONFIRMADO)).toBeVisible();
  await expect(identidade(page)).toHaveText(doc.code);
  expect(efeitosNoBanco(doc.id), "a confirmação: 1 saída de estoque e 1 título a receber do total novo").toEqual({ movimentos: 1, titulos: 1, valores: ["30.00"], situacao: "confirmed" });
  expect([saldoAntes, await saldoNoServidor(page, c.l1, c.p1)], "o saldo de P1 em L1: 10 → 7").toEqual(["10.0000", "7.0000"]);
  expect((await lerDoc(page, "sale", doc.id)).version, "a gravação e a confirmação").toBe("2");
  await page.reload();
  await expect(identidade(page)).toHaveText(doc.code);
  await editarDesabilitado(page, "sale", doc, MSG_NAO_EDITAVEL);
});

/* ═════════════════════════════ E3-9 — A RECUSA DO SERVIDOR (422) NO CAMPO ═════════════════════════════ */

test("E3-9 — a recusa 422 do servidor cai NO CAMPO: trocar o cliente por um em atraso numa TOP que 'bloqueia' → a PATCH sai (a tela não pergunta a porta do atraso, que pede .create) → 422 CLIENTE_EM_ATRASO → a mensagem do servidor no campo Cliente, a edição continua aberta e nada grava", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenarioDeVenda(page, "E3-9");
  const top = await topDeVenda(page, "sale", "E3-9 bloqueia atraso", {
    configuracao: cfg5({}, (x) => ({ ...x, financeiro: { ...x.financeiro, clienteEmAtraso: "bloqueia", toleranciaAtrasoDias: 0 } }))
  });
  const { id: atrasadoId } = await criarCadastro(page, "people", { name: `E3 atrasado ${c.tag}`, person_type: "legal", is_client: true });
  const atrasado = String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${atrasadoId}`))["name"]);
  const vencido = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const titulo = await api<{ id: string }>(page, "POST", "/api/financial/receivables", {
    empresa_id: c.empresa, number: `E3-9-${c.tag}`.slice(0, 30), person_id: atrasadoId, amount: "50.00", emission_date: vencido, due_date: vencido,
    note: "EDITAR-03 E3-9 — título vencido", apportionment: [{ financial_category_id: c.natureza.id, cost_center_id: c.centro.id, percentage: "100" }]
  });
  try {
    const doc = await criarDoc(page, "sale", c, top, [{ product_id: c.p3.id, warehouse_id: null, quantity: "1", unit_price: "4.00" }]);
    await abrirConsulta(page, "sale", doc);
    const fio = ouvirOFio(page, "sale");
    fio.abrirJanela();
    await abrirEdicao(page, "sale", doc);
    await expect(page.getByTestId("central-faixa-atraso"), "o cliente gravado está em dia: sem faixa").toHaveCount(0);
    await pickRef(page, "Cliente", atrasado);
    const patch = await salvarEdicao(page, "sale", doc);
    fio.fecharJanela();
    expect([patch.status, patch.corpo], "a PATCH leva só o cliente novo").toEqual([422, { version: "0", client_id: atrasadoId }]);
    const erro = (patch.resposta["error"] ?? {}) as { code?: string; message?: string };
    expect(erro.code, "a recusa do servidor").toBe("CLIENTE_EM_ATRASO");
    expect(erro.message, "premissa: a mensagem do servidor").toMatch(/Esta operação não aceita cliente em atraso\.$/);
    const campo = page.getByTestId("central-vendas-dados").locator('[data-campo="client_id"]');
    await expect(campo.locator('[data-parte="erro"]'), "a mensagem DO SERVIDOR no campo Cliente").toHaveText(erro.message!);
    await expect(identidade(page), "a edição continua aberta").toHaveText(`Editar venda ${doc.code}`);
    expect(fio.portasDaCriacao, "a tela não perguntou a porta do atraso (nem outra do lançamento)").toEqual([]);
    const depois = await lerDoc(page, "sale", doc.id);
    expect([depois.version, depois.client_id], "nada gravado").toEqual(["0", c.cliente.id]);
    fio.parar();
  } finally {
    await api(page, "POST", `/api/financial/receivables/${titulo.id}/cancel`, {}).catch(() => undefined);
  }
});
