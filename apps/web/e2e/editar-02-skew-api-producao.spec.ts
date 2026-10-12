import type { Page, Request, Response } from "@playwright/test";
import { api, empresaAtiva, login, uniq } from "./helpers";
import { cabecalhosDaSessao, cfg4 } from "./top-config-08-comum";
import { hojeISO } from "./estoque-01-comum";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import { API, MSG_DOCUMENTO_NAO_ENCONTRADO, MSG_ROTA_NAO_ENCONTRADA, UUID_INEXISTENTE, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";

/**
 * EDITAR-02 (decisão 313) · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (a janela "web antes da API" da
 * DEPLOYMENT, e a reversão só da API).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD e o caso ficaria verde
 * por vacuidade). Sem passo no CI: o job `skew` roda a config inteira, e o arquivo entra pelo nome.
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA (`mundoDaEdicaoNaBase`), pelas DUAS portas que nascem juntas na EDITAR-02, com o id
 * bem-formado que não existe: `GET /api/compras/compras/:id/edicao` e `PATCH /api/compras/compras/:id`. No binário que não
 * as tem, as duas respondem a 404 de ROTA ("Rota não encontrada"); no que as tem, a 404 do DOCUMENTO ("Documento não
 * encontrado", a mesma do `GET :id`). Uma resposta sem a outra é defeito, não skew. Os dois ramos cobram prova POSITIVA:
 *   · MUNDO LEGADO (a base de hoje, a930fff8, sem a EDITAR-02): a consulta deste web oferece o "Editar" (a tela não sabe
 *     a versão do servidor); o clique pergunta o `/edicao`, recebe a 404 de rota e AVISA "ainda não está disponível neste
 *     servidor", volta à consulta (a mesma, aberta), e NENHUMA PATCH sai; a consulta continua funcionando — a compra
 *     confirma pela tela (200) e o pedido continua aberto; nenhuma requisição morre no navegador;
 *   · MUNDO NOVO (a base já com a EDITAR-02, depois do merge): o clique abre a Central em modo edição, e o ✕ (Voltar à
 *     consulta) volta sem gravar.
 * K-1b (P5, a aprovação com a versão): a CONSULTA deste web aprova, pelo bloco de aprovação, uma compra cuja TOP exige
 * aprovação, contra a API da base. A web só manda `version` na decisão quando a API NOVA a declara (a situação da
 * aprovação que só ela emite) — nunca pela presença da coluna no `d.*` do `GET :id` (que a base, sobre o banco já na
 * 0063, também traz). Prova: o 200 da base e NENHUM 422 no fio; no mundo legado, o corpo da decisão sem `version`.
 *
 * Não há mock: o servidor é o binário da base, servindo o banco migrado e semeado por este HEAD (com a 0063 — por isso o
 * `GET :id` da base já traz `version`: o `d.*` lê a coluna nova). As TOPs, os cadastros e os documentos nascem PELA API DA
 * BASE (as portas de `central-compras-fixtures`, com a exclusão lógica no fim do caso). Os documentos ficam (decisão 247).
 */

const P = "central-compras";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const MSG_EDICAO_INDISPONIVEL = "A edição de documento de compra ainda não está disponível neste servidor.";

/** A resposta de uma porta da EDITAR-02 ao id inexistente: a 404 de rota (ausente) ou a do documento (presente). */
async function portaNaBase(page: Page, cab: Record<string, string>, metodo: "GET" | "PATCH", porta: string): Promise<"ausente" | "presente"> {
  const r = await page.request.fetch(`${API}${porta}`, { method: metodo, headers: { ...cab, "content-type": "application/json" }, ...(metodo === "PATCH" ? { data: { version: "0" } } : {}) });
  expect(r.status(), `${metodo} ${porta}: 404 nos dois mundos — outro código é defeito`).toBe(404);
  const erro = ((await r.json()) as { error?: { code?: string; message?: string } }).error;
  expect(erro?.code, `${metodo} ${porta}: NOT_FOUND`).toBe("NOT_FOUND");
  expect([MSG_ROTA_NAO_ENCONTRADA, MSG_DOCUMENTO_NAO_ENCONTRADO], `${metodo} ${porta}: a 404 da rota ou a do documento, nenhuma outra`).toContain(erro?.message);
  return erro?.message === MSG_ROTA_NAO_ENCONTRADA ? "ausente" : "presente";
}

async function mundoDaEdicaoNaBase(page: Page, cab: Record<string, string>): Promise<Mundo> {
  const edicao = await portaNaBase(page, cab, "GET", `/api/compras/compras/${UUID_INEXISTENTE}/edicao`);
  const patch = await portaNaBase(page, cab, "PATCH", `/api/compras/compras/${UUID_INEXISTENTE}`);
  expect(patch, "o GET /edicao e a PATCH nascem no MESMO binário: uma resposta sem a outra é defeito").toBe(edicao);
  const mundo: Mundo = edicao === "presente" ? "novo" : "legado";
  console.log(`[skew] EDITAR-02 · K-1 · a base responde "${edicao === "ausente" ? MSG_ROTA_NAO_ENCONTRADA : MSG_DOCUMENTO_NAO_ENCONTRADO}" ao /edicao e à PATCH → mundo ${mundo}`);
  return mundo;
}

/** Os cadastros do caso PELA API DA BASE, e a compra e o pedido abertos. */
async function documentos(page: Page) {
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const produto = (await criarCadastro(page, "products", { description: uniq("E2K1 produto"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id })).id;
  const fornecedor = (await criarCadastro(page, "people", { name: uniq("E2K1 forn"), person_type: "legal", is_provider: true })).id;
  const armazem = (await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `K${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: uniq("E2K1 local"), type: "inputs" })).id;
  const topCompra = (await criarTop(page, { codigo: codigoTop("E2k1c"), codigoBase: "compras.compra", nome: uniq("E2 K1 compra") })).id;
  const topPedido = (await criarTop(page, { codigo: codigoTop("E2k1p"), codigoBase: "compras.pedido", nome: uniq("E2 K1 pedido") })).id;
  const comum = { empresa_id: empresa, fornecedor_id: fornecedor, data_documento: hojeISO(), categoria_financeira_id: ref.natureza.id, centro_custo_id: ref.centro.id };
  const { id: compraId } = await api<{ id: string }>(page, "POST", "/api/compras/compras", { ...comum, tipo_operacao_id: topCompra,
    itens: [{ produto_id: produto, armazem_id: armazem, quantidade: "3", valor_unitario: "7.00" }] });
  const { id: pedidoId } = await api<{ id: string }>(page, "POST", "/api/compras/pedidos", { ...comum, tipo_operacao_id: topPedido,
    itens: [{ produto_id: produto, quantidade: "4", valor_unitario: "9.00" }] });
  const compra = await api<{ id: string; codigo: string; situacao: string }>(page, "GET", `/api/compras/compras/${compraId}`);
  const pedido = await api<{ id: string; codigo: string; situacao: string }>(page, "GET", `/api/compras/pedidos/${pedidoId}`);
  expect([compra.situacao, pedido.situacao], "premissa: a base lançou os dois abertos").toEqual(["aberto", "aberto"]);
  return { compra: { ...compra, segmento: "compras" }, pedido: { ...pedido, segmento: "pedidos" } };
}

test("EDITAR-02 · K-1 (sentido 1) — o Editar deste web sobre a API da base: sem as portas, o clique avisa 'ainda não está disponível neste servidor', volta à consulta, nenhuma PATCH sai e a consulta continua funcionando (a compra confirma); com as portas, a Central em modo edição", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const mundo = await mundoDaEdicaoNaBase(page, cab);
  const docs = await documentos(page);

  const v = vigiar(page);
  const escritas: string[] = [];
  const respostas: { metodo: string; caminho: string; status: number }[] = [];
  page.on("request", (r) => { if (r.url().startsWith(API) && r.method() === "PATCH") escritas.push(`${r.method()} ${caminho(r)}`); });
  page.on("response", (r) => { if (r.url().startsWith(API)) respostas.push({ metodo: r.request().method(), caminho: caminho(r), status: r.status() }); });

  for (const doc of [docs.compra, docs.pedido]) {
    const leitura = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/${doc.segmento}/${doc.id}`);
    await page.goto(`/compras/${doc.segmento}/${doc.id}`);
    const lida = await leitura;
    expect(lida.status(), `${doc.segmento}: a base serviu a leitura`).toBe(200);
    console.log(`[skew] EDITAR-02 · K-1 · ${doc.segmento}: o GET :id da base traz version? ${"version" in ((await lida.json()) as Record<string, unknown>)}`);
    await expect(page.getByTestId(`${P}-identidade-nome`), "premissa: a consulta desenhou ESTE documento").toHaveText(doc.codigo);
    await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
    const editar = page.getByTestId("compras-editar");
    await expect(editar, `${doc.segmento}: este web oferece o Editar no documento aberto (não sabe a versão do servidor)`).toBeEnabled();
    const edicaoNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/${doc.segmento}/${doc.id}/edicao`);
    await editar.click();
    const edicao = await edicaoNoFio;
    if (mundo === "legado") {
      expect([edicao.status(), ((await edicao.json()) as { error?: { message?: string } }).error?.message], `${doc.segmento}: a base não tem a porta — a 404 de ROTA`)
        .toEqual([404, MSG_ROTA_NAO_ENCONTRADA]);
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: MSG_EDICAO_INDISPONIVEL }), `${doc.segmento}: o aviso de que a edição não existe neste servidor`).toBeVisible();
      await expect(page.getByTestId("compras-consulta-corpo"), `${doc.segmento}: volta à MESMA consulta, aberta`).toHaveAttribute("data-situacao", "aberto");
      await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText(doc.codigo);
      await expect(page.locator('[data-testid="compras-central"][data-modo="edicao"]'), `${doc.segmento}: nenhuma Central em modo edição`).toHaveCount(0);
      await expect(editar, `${doc.segmento}: o Editar continua lá (um novo clique pergunta de novo)`).toBeVisible();
    } else {
      expect(edicao.status(), `${doc.segmento}: a base tem a porta`).toBe(200);
      await expect(page.getByTestId("compras-central"), `${doc.segmento}: a Central em modo edição`).toHaveAttribute("data-modo", "edicao");
      await page.getByTestId(`${P}-descartar`).click();
      await expect(page.getByTestId("compras-consulta-corpo"), `${doc.segmento}: o ✕ volta à consulta sem gravar`).toHaveAttribute("data-situacao", "aberto");
    }
  }

  // A CONSULTA CONTINUA FUNCIONANDO: a compra confirma pela tela (a prévia da base, o 200), depois do aviso.
  await page.goto(`/compras/compras/${docs.compra.id}`);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "aberto");
  const confirmou = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/compras/${docs.compra.id}/confirm`);
  await page.getByTestId("compras-confirmar").click();
  await expect(page.getByTestId("compras-previa")).toHaveAttribute("data-situacao", "pronta");
  await page.getByTestId("confirm-dialog-confirm").click();
  expect((await confirmou).status(), "a base confirma a compra (200)").toBe(200);
  await expect(page.getByTestId("compras-consulta-corpo")).toHaveAttribute("data-situacao", "confirmado");
  await expect(page.getByTestId("compras-editar"), "confirmada: o Editar desabilitado, pelo que a consulta já sabe").toBeDisabled();

  await page.waitForLoadState("networkidle");
  expect(escritas, "nenhuma PATCH saiu deste web para a base").toEqual([]);
  const ruins = respostas.filter((r) => r.status === 422 || r.status >= 500 || (r.status === 404 && !(mundo === "legado" && r.metodo === "GET" && r.caminho.endsWith("/edicao"))));
  expect(ruins, "nenhuma resposta 404 (fora a da porta ausente), 422 ou 5xx da base no fio").toEqual([]);
  expect((await api<{ situacao: string }>(page, "GET", `/api/compras/pedidos/${docs.pedido.id}`)).situacao, "o pedido continua aberto na base").toBe("aberto");
  v.semBloqueio();
});

test("EDITAR-02 · K-1b (sentido 1, P5) — a aprovação pela CONSULTA deste web sobre a API da base: a compra cuja TOP exige aprovação é aprovada pelo bloco (200 da base), sem `version` no corpo enquanto a base não a declara, e nenhum 422 no fio", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  const mundo = await mundoDaEdicaoNaBase(page, cab);

  // A COMPRA PELA API DA BASE: TOP de compra no formato 4 com a aprovação "Sempre" e a confirmação Manual (aprovar não
  // confirma), um item; aberta e aguardando a aprovação.
  const ref = await referenciasDoSeed(page);
  const empresa = await empresaAtiva(page);
  const produto = (await criarCadastro(page, "products", { description: uniq("E2K1b produto"), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id })).id;
  const fornecedor = (await criarCadastro(page, "people", { name: uniq("E2K1b forn"), person_type: "legal", is_provider: true })).id;
  const armazem = (await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `B${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: uniq("E2K1b local"), type: "inputs" })).id;
  const top = (await criarTop(page, { codigo: codigoTop("E2k1b"), codigoBase: "compras.compra", nome: uniq("E2 K1b compra com aprovação"),
    configuracao: cfg4({ confirmacao: "manual", aprovacao: "sempre" }) })).id;
  const { id } = await api<{ id: string }>(page, "POST", "/api/compras/compras", {
    empresa_id: empresa, tipo_operacao_id: top, fornecedor_id: fornecedor, data_documento: hojeISO(),
    categoria_financeira_id: ref.natureza.id, centro_custo_id: ref.centro.id,
    itens: [{ produto_id: produto, armazem_id: armazem, quantidade: "2", valor_unitario: "8.00" }]
  });
  const compra = await api<{ codigo: string; situacao: string }>(page, "GET", `/api/compras/compras/${id}`);
  expect(compra.situacao, "premissa: a base lançou a compra aberta").toBe("aberto");

  const v = vigiar(page);
  const respostas: { metodo: string; caminho: string; status: number }[] = [];
  page.on("response", (r) => { if (r.url().startsWith(API)) respostas.push({ metodo: r.request().method(), caminho: caminho(r), status: r.status() }); });
  const situacaoNoFio = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/aprovacoes/compras/${id}`);
  await page.goto(`/compras/compras/${id}`);
  await expect(page.getByTestId(`${P}-identidade-nome`), "premissa: a consulta desenhou ESTE documento").toHaveText(compra.codigo);
  const s = await situacaoNoFio;
  expect([s.status(), ((await s.json()) as { situacao?: string }).situacao], "premissa no fio: a base diz que a compra aguarda aprovação").toEqual([200, "pendente"]);
  const bloco = page.getByTestId(`${P}-aprovacao`);
  await expect(bloco, "o bloco da aprovação, pendente").toHaveAttribute("data-situacao", "pendente");

  // APROVAR PELO BLOCO DA CONSULTA: o diálogo da fila, e o POST à base.
  await page.getByTestId(`${P}-aprovar`).click();
  const dialogo = page.getByTestId("aprovacao-dialogo");
  await expect(dialogo).toBeVisible();
  const decidiu = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/aprovacoes/compras/${id}/aprovar`);
  await dialogo.getByTestId("aprovacao-confirmar").click();
  const r = await decidiu;
  const enviado = r.request().postDataJSON() as Record<string, unknown>;
  console.log(`[skew] EDITAR-02 · K-1b · mundo ${mundo}: o corpo da decisão leva version? ${"version" in enviado}`);
  expect(r.status(), `a base aprova pela consulta deste web (o corpo foi ${JSON.stringify(enviado)})`).toBe(200);
  if (mundo === "legado") expect("version" in enviado, "sem a declaração da API nova, a decisão vai sem `version` (a base a recusaria: .strict())").toBe(false);
  await expect(bloco, "o bloco mostra a compra aprovada").toHaveAttribute("data-situacao", "aprovado");

  await page.waitForLoadState("networkidle");
  expect(respostas.filter((x) => x.status === 422), "nenhum 422 da base no fio").toEqual([]);
  expect(respostas.filter((x) => x.status >= 500), "nenhum 5xx").toEqual([]);
  v.semBloqueio();
});
