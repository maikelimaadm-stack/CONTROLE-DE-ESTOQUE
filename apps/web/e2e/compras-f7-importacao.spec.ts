import type { Locator, Page, Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { test, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed } from "./central-compras-fixtures";
import { arquivoDaNota, base64DaNota, cnpjDeEmitenteSintetico, notaSintetica, type NotaSintetica } from "./compras-f7-nfe-sintetica";

/**
 * OPERACOES-01 F7 (decisão 284) — A ENTRADA DE NOTA POR XML NA CENTRAL DE COMPRAS · IX-1, IX-2 e IX-3.
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────────────────────────┐
 * │ IX-1 importar e gerar: Documentos de Compras › "Importar XML" → o diálogo; o destinatário é o   │
 * │      CNPJ das DUAS empresas do seed → o servidor pede a escolha (422 com as candidatas, nunca    │
 * │      "a primeira") → a conferência; o fornecedor é o cadastro com o CNPJ do emitente; o item sem │
 * │      vínculo recebe o produto, o fator 12 (CX → UN) e o Local de estoque; a quantidade e o       │
 * │      unitário internos da tela são as contas do domínio (120,0000 e 8,333334); o total confere  │
 * │      com o vNF; as parcelas são as duplicatas; "Gerar compra" leva só DECISÕES (nenhum valor) e  │
 * │      abre a consulta da compra ABERTA — conferida também pela API (valor_total = vNF, a chave,  │
 * │      o IPI, as parcelas da nota; a importação "gerada").                                          │
 * │ IX-2 a MESMA nota de novo (a compra gerada antes, pela API): o servidor recusa (409, "já está na │
 * │      Compra <código>") e o diálogo mostra a recusa e a Compra; nenhuma navegação.                │
 * │ IX-3 o XML de homologação (tpAmb 2): o servidor recusa na leitura (422, motivo                    │
 * │      `ambiente_homologacao`) e a recusa aparece listada no diálogo; nenhuma navegação.            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O XML é SINTÉTICO (`compras-f7-nfe-sintetica.ts`: CNPJ e chave inventados, DVs calculados ali). Cada caso cria os
 * PRÓPRIOS cadastros (fornecedor com o CNPJ do emitente, produto, Local de estoque, TOP) pela API, limpos no fim pela
 * fixture; a compra e a importação ficam (ledger; decisão 247). O que vai no fio é lido no fio.
 */

const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const caminho = (r: Response) => new URL(r.url()).pathname;
const postEm = (page: Page, alvo: string | RegExp) => page.waitForResponse((r) => r.request().method() === "POST"
  && (typeof alvo === "string" ? caminho(r) === alvo : alvo.test(caminho(r))));

/* ═════════════════════════════════ fixtures ═════════════════════════════════ */

async function cenario(page: Page, rotulo: string) {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  // PREMISSA: a API desta execução DECLARA a capacidade — sem ela o botão não existe e o teste não provaria nada.
  const portas = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/compras/compras/operation-types");
  expect(portas.capacidades?.["importacaoXml"], "premissa: a API declara capacidades.importacaoXml = 1").toBe(1);

  const emitente = cnpjDeEmitenteSintetico();
  const forn = await criarCadastro(page, "people", { name: uniq(`F7 ${rotulo} forn`), person_type: "legal", is_provider: true, document: emitente });
  const fornecedor = { id: forn.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/people/${forn.id}`))["name"]) };
  const prod = await criarCadastro(page, "products", { description: uniq(`F7 ${rotulo} prod`), group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id });
  const produto = { id: prod.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${prod.id}`))["description"]) };
  const arm = await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `X${Date.now().toString(36).slice(-4).toUpperCase()}`, description: uniq(`F7 ${rotulo} local`), type: "inputs"
  });
  const local = { id: arm.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]) };
  const top = (await criarTop(page, { codigo: codigoTop("7x"), codigoBase: "compras.compra", nome: uniq(`Compra F7 ${rotulo}`) })).id;
  return { empresa, ref, emitente, fornecedor, produto, local, top };
}

/** Um seletor de referência (RefSelect) dentro de `container`: abre, pesquisa e escolhe a opção que casa. */
async function escolherNoSeletor(page: Page, container: Locator, busca: string) {
  await container.locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(busca);
  await painel.getByRole("option", { name: literal(busca) }).first().click();
}

/** Documentos de Compras › "Importar XML" → o diálogo, com o arquivo escolhido. */
async function abrirImportacao(page: Page, nota: NotaSintetica) {
  await page.goto("/compras?tab=documentos");
  const botao = page.getByTestId("compras-importar-xml");
  await expect(botao, "com a capacidade, o botão Importar XML está na barra dos Documentos").toBeVisible();
  await botao.click();
  await expect(page).toHaveURL(/importar=xml/);
  const dialogo = page.getByTestId("importacao-upload");
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText("Importar XML de nota de compra");
  await dialogo.getByTestId("importacao-arquivo").setInputFiles(arquivoDaNota(nota));
  return dialogo;
}

/** Enviar; o seed tem DUAS empresas com o CNPJ do destinatário → a 422 com as candidatas e a escolha da empresa ativa. */
async function enviarEscolhendoAEmpresa(page: Page, dialogo: Locator, empresa: string): Promise<Response> {
  const primeiro = postEm(page, "/api/compras/importacoes");
  await dialogo.getByTestId("importacao-enviar").click();
  const r1 = await primeiro;
  expect(r1.status(), "premissa: o destinatário corresponde a mais de uma empresa do seed").toBe(422);
  const e1 = (await r1.json()) as { error: { details: { path: string; candidatos?: { id: string }[] }[] } };
  const candidatas = e1.error.details.find((d) => d.path === "empresa_id")?.candidatos?.map((c) => c.id) ?? [];
  expect(candidatas.length, "o servidor manda as candidatas (nunca escolhe a primeira)").toBeGreaterThan(1);
  expect(candidatas, "a empresa ativa é uma delas").toContain(empresa);
  expect(r1.request().postDataJSON(), "o primeiro envio não pediu empresa").not.toHaveProperty("empresa_id");
  await dialogo.getByTestId("importacao-empresa").selectOption(empresa);
  const segundo = postEm(page, "/api/compras/importacoes");
  await dialogo.getByTestId("importacao-enviar").click();
  const r2 = await segundo;
  expect(r2.request().postDataJSON(), "o reenvio pede a empresa escolhida").toMatchObject({ empresa_id: empresa });
  return r2;
}

/* ═════════════════════════════════ IX-1 ═════════════════════════════════ */

test("IX-1 — importar o XML e gerar a compra: escolha da empresa, fornecedor pelo emitente, produto + fator 12, total = vNF, parcelas da nota; a compra nasce ABERTA", async ({ page }) => {
  await login(page);
  const c = await cenario(page, "IX1");
  const nota = notaSintetica({ emitenteCnpj: c.emitente, emitenteNome: `Emitente sintético ${uniq("IX1")}` });

  const dialogo = await abrirImportacao(page, nota);
  const r = await enviarEscolhendoAEmpresa(page, dialogo, c.empresa);
  expect(r.status(), "a importação foi aceita").toBe(201);
  const conf = (await r.json()) as { id: string; situacao: string; empresa: { id: string }; parceiro: { situacao: string; id?: string }; nota: { chave: string } };
  expect(conf).toMatchObject({ situacao: "pendente", empresa: { id: c.empresa }, parceiro: { situacao: "encontrado", id: c.fornecedor.id }, nota: { chave: nota.chave } });

  // A CONFERÊNCIA
  await expect(page).toHaveURL(new RegExp(`/compras/importacoes/${conf.id}$`));
  const raiz = page.getByTestId("importacao-conferencia");
  await expect(raiz).toHaveAttribute("data-situacao", "pendente");
  await expect(page.getByTestId("importacao-chave")).toContainText(nota.chave.slice(0, 4) + " " + nota.chave.slice(4, 8));
  await expect(page.getByTestId("importacao-parceiro")).toHaveAttribute("data-situacao", "encontrado");
  await expect(page.getByTestId("importacao-parceiro")).toContainText(c.fornecedor.nome);
  await expect(page.getByTestId("importacao-gerar-compra"), "premissa: com o item sem produto, Gerar compra fica travado").toBeDisabled();
  await page.getByTestId("importacao-top").selectOption(c.top);

  // ITENS: o item sem vínculo; produto, fator 12 (CX → UN), Local de estoque
  await page.getByTestId("importacao-aba-itens-rotulo").click();
  const item = page.getByTestId("importacao-item-1");
  await expect(item).toHaveAttribute("data-vinculo", "nenhum");
  await expect(item.getByTestId("importacao-item-1-quantidade-nota")).toContainText("10.0000 CX");
  await escolherNoSeletor(page, item.getByTestId("importacao-item-1-produto"), c.produto.nome);
  await item.getByTestId("importacao-item-1-fator").fill("12");
  await expect(item.getByTestId("importacao-item-1-tipo-fator")).toHaveValue("multiply");
  await expect(item.getByTestId("importacao-item-1-quantidade-interna"), "10 × 12").toHaveText("120.0000");
  await expect(item.getByTestId("importacao-item-1-unitario-interno"), "1.000,00 ÷ 120, arredondado para cima (a linha fecha o vProd)").toHaveText("8.333334");
  await escolherNoSeletor(page, item.getByTestId("importacao-item-1-local"), c.local.nome);
  await expect(item.getByTestId("importacao-item-1-lembrar"), "lembrar o vínculo vem marcado").toBeChecked();

  // FINANCEIRO: as duplicatas da nota; natureza e centro do documento
  await page.getByTestId("importacao-aba-financeiro-rotulo").click();
  await expect(page.getByTestId("importacao-parcelas").getByTestId("importacao-parcela"), "as duas duplicatas").toHaveCount(2);
  await expect(page.getByTestId("importacao-usar-condicao")).not.toBeChecked();
  await escolherNoSeletor(page, page.getByTestId("importacao-natureza"), c.ref.natureza.label.slice(0, 20));
  await escolherNoSeletor(page, page.getByTestId("importacao-centro"), c.ref.centro.label.slice(0, 20));

  // DIVERGÊNCIAS: nenhuma; o total confere com o vNF
  await page.getByTestId("importacao-aba-divergencias-rotulo").click();
  await expect(page.getByTestId("importacao-divergencias-vazia")).toHaveText("Nenhuma divergência.");
  await expect(page.getByTestId("importacao-total-calculado")).toHaveAttribute("data-confere", "sim");

  // GERAR: o corpo leva só decisões (nenhum valor), e a compra nasce ABERTA
  const gerar = page.getByTestId("importacao-gerar-compra");
  await expect(gerar).toBeEnabled();
  const post = postEm(page, `/api/compras/importacoes/${conf.id}/gerar-compra`);
  await gerar.click();
  const resposta = await post;
  expect(resposta.status(), "a compra foi gerada").toBe(201);
  const enviado = resposta.request().postDataJSON() as { fornecedor_id: string; tipo_operacao_id: string; financeiro: Record<string, unknown>; itens: Record<string, unknown>[] };
  expect(enviado).toMatchObject({ fornecedor_id: c.fornecedor.id, tipo_operacao_id: c.top, financeiro: { parcelas: "nota", rateio: { tipo: "documento", categoria_financeira_id: c.ref.natureza.id, centro_custo_id: c.ref.centro.id } } });
  expect(enviado.itens, "uma decisão por item da nota: produto, fator em TEXTO, local").toEqual([expect.objectContaining({ n_item: 1, produto_id: c.produto.id, fator: "12", tipo_fator: "multiply", armazem_id: c.local.id, lembrar_vinculo: true })]);
  for (const valor of ["quantidade", "valor_unitario", "desconto", "valor_total"]) expect(Object.hasOwn(enviado.itens[0]!, valor), `${valor} não vai no corpo: o servidor relê da nota`).toBe(false);
  const compra = (await resposta.json()) as { id: string; codigo: string; situacao: string; valor_total: string; importacao_id: string };
  expect(compra).toMatchObject({ situacao: "aberto", valor_total: "1080.00", importacao_id: conf.id });

  // A CONSULTA DA COMPRA e o SERVIDOR
  await expect(page).toHaveURL(new RegExp(`/compras/compras/${compra.id}$`));
  await expect(page.getByTestId("compras-consulta-corpo"), "a compra gerada está ABERTA (nunca confirmada sozinha)").toHaveAttribute("data-situacao", "aberto");
  await expect(page.getByTestId("compras-consulta-total")).toContainText("1.080,00");
  const gravada = await api<Record<string, unknown> & { itens: Record<string, unknown>[] }>(page, "GET", `/api/compras/compras/${compra.id}`);
  expect(gravada).toMatchObject({
    situacao: "aberto", chave_acesso: nota.chave, numero_nota: nota.numero, fornecedor_id: c.fornecedor.id, empresa_id: c.empresa,
    valor_ipi: "50.00", frete: "30.00", valor_total: "1080.00", tipo_documento_fiscal: "nfe", uf_nota: "GO", importacao_id: conf.id
  });
  expect(gravada["parcelas_nota"], "as parcelas da nota (as duplicatas)").toEqual(nota.duplicatas);
  expect(gravada.itens.map((i) => [i["quantidade"], i["valor_unitario"], i["fator_conversao"], i["unidade_nota"]]), "a quantidade e o unitário internos").toEqual([["120.0000", "8.333334", "12.000000", "CX"]]);
  const depois = await api<{ situacao: string; documentoCompra: { id: string } | null }>(page, "GET", `/api/compras/importacoes/${conf.id}`);
  expect(depois, "a importação ficou gerada, ligada à compra").toMatchObject({ situacao: "gerada", documentoCompra: { id: compra.id } });
});

/* ═════════════════════════════════ IX-2 ═════════════════════════════════ */

test("IX-2 — a mesma nota de novo: o servidor recusa (409, já está na Compra) e o diálogo mostra a recusa e a Compra", async ({ page }) => {
  await login(page);
  const c = await cenario(page, "IX2");
  const nota = notaSintetica({ emitenteCnpj: c.emitente, emitenteNome: `Emitente sintético ${uniq("IX2")}` });

  // A COMPRA DA NOTA, gerada antes pela API (a mesma porta da tela).
  const conf = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", { nome_arquivo: "nota.xml", arquivo_base64: base64DaNota(nota), empresa_id: c.empresa });
  const compra = await api<{ id: string; codigo: string; situacao: string }>(page, "POST", `/api/compras/importacoes/${conf.id}/gerar-compra`, {
    tipo_operacao_id: c.top, fornecedor_id: c.fornecedor.id,
    financeiro: { parcelas: "nota", rateio: { tipo: "documento", categoria_financeira_id: c.ref.natureza.id, centro_custo_id: c.ref.centro.id } },
    itens: [{ n_item: 1, produto_id: c.produto.id, fator: "12", tipo_fator: "multiply", armazem_id: c.local.id }]
  });
  expect(compra.situacao, "premissa: a nota já está numa compra aberta").toBe("aberto");

  const dialogo = await abrirImportacao(page, nota);
  const r = await enviarEscolhendoAEmpresa(page, dialogo, c.empresa);
  expect(r.status(), "a nota repetida é recusada").toBe(409);
  const { error: erro } = (await r.json()) as { error: { code: string; message: string; details: { onde: string; codigo: string } } };
  expect(erro).toMatchObject({ code: "DUPLICATE_DOCUMENT", details: { onde: "compra", codigo: compra.codigo } });
  const conflito = dialogo.getByTestId("importacao-conflito");
  await expect(conflito).toContainText(`já está na Compra ${compra.codigo}`);
  await expect(conflito.getByTestId("importacao-abrir-compra")).toHaveText(`Abrir a Compra ${compra.codigo}`);
  await expect(page, "nenhuma navegação: o diálogo continua").toHaveURL(/\/compras\?.*importar=xml/);
});

/* ═════════════════════════════════ IX-3 ═════════════════════════════════ */

test("IX-3 — o XML de homologação (tpAmb 2): o servidor recusa na leitura e a recusa aparece listada no diálogo", async ({ page }) => {
  await login(page);
  const portas = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/compras/compras/operation-types");
  expect(portas.capacidades?.["importacaoXml"], "premissa: a API declara capacidades.importacaoXml = 1").toBe(1);
  const nota = notaSintetica({ emitenteCnpj: cnpjDeEmitenteSintetico(), emitenteNome: "Emitente sintético de homologação", tpAmb: "2" });
  expect(nota.xml, "premissa: o XML é de homologação").toContain("<tpAmb>2</tpAmb>");

  const dialogo = await abrirImportacao(page, nota);
  const post = postEm(page, "/api/compras/importacoes");
  await dialogo.getByTestId("importacao-enviar").click();
  const r = await post;
  expect(r.status(), "a leitura recusa").toBe(422);
  const { error: erro } = (await r.json()) as { error: { details: { path: string; motivo?: string; message: string }[] } };
  expect(erro.details.map((d) => [d.path, d.motivo]), "uma recusa, no arquivo, pelo ambiente").toEqual([["arquivo", "ambiente_homologacao"]]);
  const recusas = dialogo.getByTestId("importacao-recusa");
  await expect(recusas).toHaveCount(1);
  await expect(recusas.first()).toHaveText("A nota é de homologação (tpAmb 2): só nota de produção (tpAmb 1) é importada.");
  await expect(dialogo.getByTestId("importacao-empresa"), "a leitura recusa antes do destinatário: nada de escolher empresa").toHaveCount(0);
  await expect(page, "nenhuma navegação").toHaveURL(/\/compras\?.*importar=xml/);
});
