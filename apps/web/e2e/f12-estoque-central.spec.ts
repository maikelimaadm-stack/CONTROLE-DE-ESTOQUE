import { test, expect, type Page, type Response } from "@playwright/test";
import { login, api } from "./helpers";
import { cfg4, chamarApi, criarTopViaApi, excluirTopE2E } from "./top-config-08-comum";
import { cadastroDeEstoque, criarTopDeEstoque, entradaConfirmadaPelaApi, escolherNaReferencia, hojeISO, incluirItemNaCentralDeEstoque, saldoNoServidor } from "./estoque-01-comum";

/**
 * OPERACOES-01 · F12 (decisão 282) — A CENTRAL DE ESTOQUE: a aprovação na consulta e a transferência (API e banco
 * REAIS; nada mockado).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────────────────────┐
 * │ F12E-1 ENTRADA com a TOP no formato 4 e aprovação "Sempre": a consulta pergunta a situação                     │
 * │        (`GET /api/aprovacoes/estoque/entradas/<id>` → pendente) e mostra o bloco "Aguardando aprovação" com     │
 * │        Aprovar e Reprovar; Aprovar abre o diálogo da fila, o POST vai à porta da ESPÉCIE                         │
 * │        (`…/estoque/entradas/<id>/aprovar`) com o corpo vazio, o aviso é "Aprovado.", o bloco passa a "Aprovado"  │
 * │        com a última decisão e sem os botões, e o documento segue ABERTO — a confirmação, que recusava, passa.    │
 * │ F12E-2 TRANSFERÊNCIA pela Central: o seletor de destino NÃO oferece o local de origem (e oferece o outro); com  │
 * │        os dois locais diferentes a transferência grava e confirma, e o saldo sai de um e entra no outro.         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Toda conclusão tem a PREMISSA ao lado, lida no FIO ou no SERVIDOR (a situação que a consulta recebeu, a recusa da
 * confirmação antes de aprovar, os saldos antes de transferir). As TOPs nascem no caso; a de aprovação é excluída no
 * fim (uma TOP que retém documento não sobra no lançador). Os documentos ficam (ledger imutável, decisão 247): a
 * entrada termina CONFIRMADA, fora da fila de Aprovações das próximas execuções.
 */

const caminho = (r: Response) => new URL(r.url()).pathname;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const aviso = (page: Page, tipo: "success" | "warning" | "error") => page.locator(`[data-sonner-toast] .erp-toast-panel--${tipo} .erp-toast-panel__description`);
const P = "central-estoque";

type CorpoDaSituacao = { situacao: string; ultimaDecisao: null | { decisao: string; observacao: string | null; decididoPor: { id: string; nome: string }; decididoEm: string } };

test("F12E-1 — entrada com 'Sempre': a consulta mostra 'Aguardando aprovação'; Aprovar pela consulta → 'Aprovado.', o bloco passa a 'Aprovado' e a confirmação passa", async ({ page }) => {
  await login(page);
  const top = await criarTopViaApi(page, "estoque.entrada", cfg4({ confirmacao: "manual", aprovacao: "sempre" }), { rotulo: "F12E entrada" });
  try {
    const c = await cadastroDeEstoque(page);
    const doc = await api<{ id: string; codigo: string; situacao: string }>(page, "POST", "/api/estoque/entradas", {
      empresa_id: c.empresa, tipo_operacao_id: top.id, armazem_id: c.armazem, data_documento: hojeISO(),
      itens: [{ produto_id: c.produto, quantidade: "2", custo_unitario: "3" }]
    });
    expect(doc.situacao, "premissa: a entrada nasce aberta").toBe("aberto");
    const antes = await chamarApi<{ error?: { code?: string } }>(page, "POST", `/api/estoque/entradas/${doc.id}/confirmar`, {});
    expect([antes.status, antes.corpo.error?.code], "premissa: sem aprovação, a confirmação recusa").toEqual([409, "APROVACAO_PENDENTE"]);

    // (1) A CONSULTA pergunta a situação DESTE documento, pela porta da espécie, e desenha o bloco pendente.
    const situacaoNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/aprovacoes/estoque/entradas/${doc.id}`);
    await page.goto(`/estoque/movimentacoes/entradas/${doc.id}`);
    const s = await situacaoNoFio;
    expect(s.status(), "a API respondeu a situação").toBe(200);
    expect(await s.json() as CorpoDaSituacao, "premissa: o servidor diz pendente, sem decisão").toEqual({ situacao: "pendente", ultimaDecisao: null });
    const central = page.getByTestId("estoque-central");
    await expect(central).toHaveAttribute("data-modo", "consulta");
    await expect(central).toHaveAttribute("data-situacao", "aberto");
    const bloco = page.getByTestId(`${P}-aprovacao`);
    await expect(bloco).toHaveAttribute("data-situacao", "pendente");
    await expect(page.getByTestId(`${P}-aprovacao-situacao`)).toHaveText("Aguardando aprovação");
    await expect(page.getByTestId(`${P}-reprovar`), "quem aprova vê os dois botões").toBeVisible();

    // (2) APROVAR pela consulta: o diálogo da fila, o POST na porta da espécie, corpo vazio.
    await page.getByTestId(`${P}-aprovar`).click();
    const dialogo = page.getByTestId("aprovacao-dialogo");
    await expect(dialogo.getByRole("heading", { name: `Aprovar o documento ${doc.codigo}?`, exact: true })).toBeVisible();
    const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/aprovacoes/estoque/entradas/${doc.id}/aprovar`);
    await dialogo.getByTestId("aprovacao-confirmar").click();
    const r = await post;
    expect(r.status(), "a porta da decisão é a da espécie").toBe(200);
    expect(r.request().postDataJSON(), "o estoque não leva versão; sem observação, corpo vazio").toEqual({});
    expect(((await r.json()) as { aprovacao: { decisao: string } }).aprovacao.decisao).toBe("aprovado");
    await expect(aviso(page, "success")).toHaveText("Aprovado.");

    // (3) O BLOCO passa a "Aprovado", com a última decisão e SEM os botões; o documento segue aberto.
    await expect(bloco).toHaveAttribute("data-situacao", "aprovado");
    await expect(page.getByTestId(`${P}-aprovacao-situacao`)).toHaveText("Aprovado");
    const eu = (await api<{ user: { name: string } }>(page, "GET", "/api/auth/context")).user.name;
    await expect(page.getByTestId(`${P}-aprovacao-decisao`)).toContainText(`Última decisão: Aprovado por ${eu} em`);
    await expect(page.getByTestId(`${P}-aprovar`), "aprovado: nada a decidir").toHaveCount(0);
    await expect(page.getByTestId(`${P}-reprovar`)).toHaveCount(0);
    await expect(central).toHaveAttribute("data-situacao", "aberto");
    const lida = await api<CorpoDaSituacao>(page, "GET", `/api/aprovacoes/estoque/entradas/${doc.id}`);
    expect([lida.situacao, lida.ultimaDecisao?.decisao], "o servidor diz o mesmo").toEqual(["aprovado", "aprovado"]);

    // (4) A DECISÃO VALE: a confirmação, que recusava, passa — e o bloco some com o documento fechado.
    const confirmado = await api<{ situacao: string }>(page, "POST", `/api/estoque/entradas/${doc.id}/confirmar`, {});
    expect(confirmado.situacao).toBe("confirmado");
    await page.reload();
    await expect(central).toHaveAttribute("data-situacao", "confirmado");
    await expect(bloco, "documento fechado: o bloco não aparece").toHaveCount(0);
  } finally {
    await excluirTopE2E(page, top.id);
  }
});

test("F12E-2 — transferência: o destino não oferece o local de origem; com dois locais diferentes grava, confirma e o saldo passa de um ao outro", async ({ page }) => {
  await login(page);
  const { id: topEntrada } = await criarTopDeEstoque(page, "entrada");
  const { id: topTransf } = await criarTopDeEstoque(page, "transferencia");
  const c = await cadastroDeEstoque(page);
  const locais = await api<{ items: { id: string; description: string }[] }>(page, "GET", `/api/resources/warehouses?empresa_id=${c.empresa}&pageSize=50`);
  // O outro local: nenhum nome contém o outro (a busca de um nunca acha o outro).
  const destino = locais.items.find((w) => w.id !== c.armazem && !w.description.toLowerCase().includes(c.nomeArmazem.toLowerCase())
    && !c.nomeArmazem.toLowerCase().includes(w.description.toLowerCase()));
  expect(destino, "premissa: a empresa tem um segundo local de estoque, de nome distinto").toBeTruthy();
  await entradaConfirmadaPelaApi(page, { top: topEntrada, empresa: c.empresa, armazem: c.armazem, produto: c.produto }, "10", "2");
  expect([(await saldoNoServidor(page, c.armazem, c.produto)).quantity, Number((await saldoNoServidor(page, destino!.id, c.produto)).quantity)],
    "premissa: 10 na origem, nada no destino").toEqual(["10.0000", 0]);

  await page.goto(`/estoque/movimentacoes/transferencias/new?tipo_operacao_id=${topTransf}`);
  const central = page.getByTestId("estoque-central");
  await expect(central).toHaveAttribute("data-especie", "transferencia");
  await expect(central).toHaveAttribute("data-modo", "criacao");
  await escolherNaReferencia(page, page.getByTestId("estoque-central-armazem"), c.nomeArmazem);

  // O DESTINO não oferece a origem. Premissa no SERVIDOR: a busca pelo nome da origem, no filtro da empresa, devolve a
  // origem; na tela, a MESMA busca termina vazia ("Nenhum resultado" — a lista respondeu, e a origem foi excluída).
  const opcoes = (termo: string) => api<{ id: string }[]>(page, "GET", `/api/resources/warehouses/options?search=${encodeURIComponent(termo)}&empresa_id=${c.empresa}`);
  expect((await opcoes(c.nomeArmazem)).map((o) => o.id), "premissa: o servidor oferece a origem para este termo").toContain(c.armazem);
  const campoDestino = page.getByTestId("estoque-central-armazem-destino");
  await campoDestino.getByRole("combobox").first().click();
  await page.getByPlaceholder("Pesquisar...").fill(c.nomeArmazem);
  await expect(page.getByText("Nenhum resultado", { exact: true }), "o local de origem não é oferecido como destino").toBeVisible();
  await expect(page.getByRole("option", { name: literal(c.nomeArmazem) })).toHaveCount(0);
  await page.getByPlaceholder("Pesquisar...").fill(destino!.description);
  const opcaoDestino = page.getByRole("option", { name: literal(destino!.description) }).first();
  await expect(opcaoDestino, "o seletor oferece o outro local").toBeVisible();
  await opcaoDestino.click();
  // E a origem, reaberta, também não oferece o destino escolhido (os dois seletores se excluem).
  expect((await opcoes(destino!.description)).map((o) => o.id), "premissa: o servidor oferece o destino para este termo").toContain(destino!.id);
  await page.getByTestId("estoque-central-armazem").getByRole("combobox").first().click();
  await page.getByPlaceholder("Pesquisar...").fill(destino!.description);
  await expect(page.getByText("Nenhum resultado", { exact: true }), "a origem não oferece o destino").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Pesquisar..."), "o seletor fechou sem mudar a origem").toHaveCount(0);

  await incluirItemNaCentralDeEstoque(page, { nomeProduto: c.nomeProduto, quantidade: "4" });
  const postReq = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/estoque/transferencias");
  await page.getByTestId("estoque-salvar").click();
  const corpo = (await postReq).postDataJSON() as { armazem_id: string; armazem_destino_id: string };
  expect([corpo.armazem_id, corpo.armazem_destino_id], "o corpo leva os dois locais, diferentes").toEqual([c.armazem, destino!.id]);
  await expect(page).toHaveURL(/\/estoque\/movimentacoes\/transferencias\/[0-9a-f-]{36}$/);
  await expect(central).toHaveAttribute("data-situacao", "aberto");
  expect((await saldoNoServidor(page, c.armazem, c.produto)).quantity, "salvar não muda o saldo").toBe("10.0000");

  await page.getByTestId("estoque-confirmar").click();
  await expect(page.getByTestId("estoque-previa")).toBeVisible();
  await page.getByTestId("estoque-previa-confirmar").click();
  await expect(central).toHaveAttribute("data-situacao", "confirmado");
  expect([(await saldoNoServidor(page, c.armazem, c.produto)).quantity, (await saldoNoServidor(page, destino!.id, c.produto)).quantity],
    "4 saíram da origem e entraram no destino").toEqual(["6.0000", "4.0000"]);
});
