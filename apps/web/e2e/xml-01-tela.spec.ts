import type { Locator, Page, Request, Response } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { getResource } from "@agro/domain";
import { login, logout, api, uniq, empresaAtiva } from "./helpers";
import { test as testeDaCentral, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { cnpjDeEmitenteSintetico, eanSintetico, notaSinteticaDeVariosItens, type ItemDaNotaDeVariosItens, type NotaSinteticaDeVariosItens } from "./compras-f7-nfe-sintetica";

/**
 * XML-01 (decisão 312) — O PRODUTO DA NOTA EM LOTE, NA TELA DA CONFERÊNCIA. Os casos XML-T1 a XML-T5.
 *
 * ┌─ O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────────────────────────────────┐
 * │ XML-T1 o lote ponta a ponta na conferência REAL: 1 item sugerido (EAN de produto existente), 4 itens     │
 * │        sem vínculo com unidade do seed (KG, UN, CX, SC) — dois deles com o MESMO código e a MESMA unidade │
 * │        (UM produto) — e 1 com uCom que não casa (XYZ, fica de fora). O Local escolhido em alguns itens;   │
 * │        um com "Gera estoque" desmarcado. O botão conta PRODUTOS; abrir a aba e o diálogo não chama        │
 * │        `/criar-produtos` (contado no fio); Grupo e Natureza perguntados UMA vez; o POST leva só decisões  │
 * │        (chaves exatas); 201; os itens recebem o produto sem nenhuma releitura da conferência; os produtos │
 * │        gravados (lidos pela API) têm o que a nota disse e o local do item; e o "Gerar compra" sai (201).  │
 * │ XML-T2 a recusa no diálogo: um item com NCM VENCIDA (existe em erp.ncm, não é escolhível) → 422 com o    │
 * │        item no caminho; a tela diz "Item <n>: …", o diálogo fica aberto, nada muda na aba e ZERO produto  │
 * │        nasce (contado pela API). Desmarcado o item, o mesmo diálogo cria o outro (201).                   │
 * │ XML-T3 sem `products.create` (com `compras.create`): a mesma conferência — com a capacidade declarada e  │
 * │        o item candidato, lidos no fio — não mostra o botão; o MESMO corpo forjado pela sessão desse       │
 * │        usuário recebe 403 e nada é criado.                                                               │
 * │ XML-T4 o diálogo de UM item continua: abre com descrição, NCM, código de barras E a unidade já            │
 * │        preenchidos; a pessoa escolhe só Grupo e Natureza; salvar dá o produto ao item.                   │
 * │ XML-T5 o fornecedor AMBÍGUO sem escolha (achado A5-1 do cético): o botão do lote aparece DESABILITADO,   │
 * │        com o motivo; o corpo forjado sem `fornecedor_id` recebe 422 em `fornecedor_id` e nada nasce;      │
 * │        escolhido o fornecedor na aba Cabeçalho, o botão habilita e o motivo some.                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O XML é SINTÉTICO (`notaSinteticaDeVariosItens`: CNPJ, chave e EAN inventados, DVs calculados lá). Os cadastros do
 * caso (fornecedor, Local, produto existente, TOP) nascem pela API e são limpos pela fixture da Central; os produtos que
 * a TELA cria (lote ou diálogo) são excluídos (lógica) pela fixture daqui, sempre. A compra e a importação ficam
 * (ledger; decisão 247). O que vai no fio é lido no fio; o gravado é lido pela API.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const caminho = (r: Request | Response) => new URL(r.url()).pathname;
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** O texto inteiro, exato (com o " *" do obrigatório opcional, quando é rótulo de campo). */
const exato = (t: string, obrigatorio = false) => new RegExp(`^${escapar(t)}${obrigatorio ? "(\\s*\\*)?" : ""}$`);
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const DEF_PRODUTO = getResource("products");
const rotuloDe = (campo: string) => DEF_PRODUTO?.fields.find((f) => f.name === campo)?.label ?? campo;

/** A fixture: os produtos que a TELA criou (lote ou diálogo), excluídos (lógica) no fim do caso — verde ou não. */
const test = testeDaCentral.extend<{ produtosDaTela: Set<string> }>({
  produtosDaTela: async ({ page }, use) => {
    const ids = new Set<string>();
    await use(ids);
    if (ids.size === 0) return;
    const falhas: string[] = [];
    let cabecalhos: Record<string, string> | null = null;
    try { cabecalhos = await cabecalhosDaSessao(page); } catch (e) { falhas.push(`credencial da sessão: ${mensagem(e)}`); }
    for (const id of [...ids].reverse()) {
      if (!cabecalhos) { falhas.push(`products ${id}: não excluído (sem a credencial da sessão)`); continue; }
      try {
        const r = await page.request.fetch(`${API}/api/resources/products/${id}`, { method: "DELETE", headers: cabecalhos });
        if (!r.ok()) falhas.push(`products ${id}: ${r.status()} ${(await r.text()).slice(0, 200)}`);
      } catch (e) { falhas.push(`products ${id}: ${mensagem(e)}`); }
    }
    expect(falhas, "a limpeza excluiu os produtos que a tela criou").toEqual([]);
  }
});

/* ═════════════════════════════════ peças ═════════════════════════════════ */

/** Um seletor de referência (RefSelect) dentro de `container`: abre, pesquisa e escolhe a opção de rótulo EXATO. */
async function escolher(page: Page, container: Locator, rotuloDaOpcao: string, nome: string) {
  await container.locator("[role='combobox']").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(rotuloDaOpcao);
  await painel.getByRole("option").filter({ has: page.locator("span.truncate", { hasText: exato(rotuloDaOpcao) }) }).first().click();
  await expect(container.locator("[role='combobox']").first(), `${nome}: o seletor ficou com a escolha`).not.toHaveClass(/is-empty/);
}

/** O seletor (RefSelect) de `container` está vazio? (a caixa traz `is-empty`). */
const vazio = async (container: Locator) => ((await container.locator("[role='combobox']").first().getAttribute("class")) ?? "").split(/\s+/).includes("is-empty");

/** A caixa do campo do formulário declarativo de rótulo `rotulo` dentro de `raiz`: o pai do `<label>` de texto exato (com o " *"). */
const campoDoFormulario = (raiz: Locator, rotulo: string) =>
  raiz.locator("label", { hasText: exato(rotulo, true) }).locator("..");

/** Espera a resposta de um POST no caminho exato. */
const postEm = (page: Page, alvo: string, timeout = 20_000) => page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === alvo, { timeout });

/** O fio da página para UMA importação: as requisições ao lote e as leituras da conferência, contadas. */
function ouvirFio(page: Page, importacaoId: string) {
  const pedidos: { metodo: string; caminho: string }[] = [];
  page.on("request", (r) => { if (r.url().startsWith(API)) pedidos.push({ metodo: r.method(), caminho: caminho(r) }); });
  const conferencia = `/api/compras/importacoes/${importacaoId}`;
  return {
    /** Qualquer requisição (qualquer método) a `…/criar-produtos`. */
    aoLote: () => pedidos.filter((p) => p.caminho === `${conferencia}/criar-produtos`).length,
    /** GET da conferência (com ou sem `?fornecedor_id`). */
    leiturasDaConferencia: () => pedidos.filter((p) => p.metodo === "GET" && p.caminho === conferencia).length,
    /** GET de um registro de produto (`/api/resources/products/<id>`). */
    leiturasDoProduto: (id: string) => pedidos.filter((p) => p.metodo === "GET" && p.caminho === `/api/resources/products/${id}`).length
  };
}

interface Vinculo { situacao: string; origem?: string; produto?: { id: string }; preenchimento?: Record<string, unknown> }
interface ConferenciaLida {
  id: string; situacao: string; empresa: { id: string }; fornecedorEscolhido: string | null; parceiro: { situacao: string; id?: string };
  nota: { totais: { nota: string }; itens: { nItem: number; codigo: string; unidade: string; ncm: string | null; ean: string | null; descricao: string }[] };
  itens: { nItem: number; vinculo: Vinculo }[];
  capacidades?: unknown;
}
interface ProdutosCriados { importacao_id: string; produtos: { id: string; codigo: string; descricao: string }[]; itens: { nItem: number; produto: { id: string; codigo: string; descricao: string }; localPadrao: string | null }[] }

const vinculoDe = (conf: ConferenciaLida, n: number) => conf.itens.find((i) => i.nItem === n)!.vinculo;

/** O cenário de um caso: a referência do seed, as unidades pelo símbolo, o fornecedor do emitente, um Local e a TOP. */
async function cenario(page: Page, rotulo: string) {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const portas = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/compras/compras/operation-types");
  expect(portas.capacidades?.["importacaoXml"], "premissa: a API declara capacidades.importacaoXml = 1").toBe(1);
  const unidades = await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options");
  const unidadeDe = (uCom: string): Opcao => {
    const achadas = unidades.filter((u) => u.label.trim().toUpperCase() === uCom.toUpperCase());
    expect(achadas.map((u) => u.label), `premissa: o seed tem UMA unidade ${uCom}`).toHaveLength(1);
    return achadas[0]!;
  };
  const semUnidade = (uCom: string) =>
    expect(unidades.filter((u) => u.label.trim().toUpperCase() === uCom.toUpperCase()).map((u) => u.label), `premissa: nenhuma unidade ${uCom} no cadastro`).toEqual([]);
  const rodada = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const emitente = cnpjDeEmitenteSintetico();
  const forn = await criarCadastro(page, "people", { name: uniq(`XML01 ${rotulo} forn`), person_type: "legal", is_provider: true, document: emitente });
  const arm = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `${rotulo.slice(-1)}${rodada.slice(-4)}`, description: uniq(`XML01 ${rotulo} local ${rodada}`), type: "inputs" });
  const local = { id: arm.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]) };
  const top = (await criarTop(page, { codigo: codigoTop("x1t"), codigoBase: "compras.compra", nome: uniq(`Compra XML01 ${rotulo}`) })).id;
  return { empresa, ref, unidadeDe, semUnidade, rodada, emitente, fornecedor: forn.id, local, top };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/** PREMISSA: cada NCM do caso é (ou não) escolhível — perguntado à busca oficial (`/api/referencias/ncm/:codigo`). */
async function premissaDasNcms(page: Page, esperado: Record<string, boolean>) {
  for (const [codigo, escolhivel] of Object.entries(esperado)) {
    const r = await api<{ codigo: string; escolhivel: boolean }>(page, "GET", `/api/referencias/ncm/${codigo}`);
    expect(r, `premissa: a NCM ${codigo} existe em erp.ncm e ${escolhivel ? "É" : "NÃO é"} escolhível (8 dígitos, vigente)`).toMatchObject({ codigo, escolhivel });
  }
}

/** A nota do caso, importada pela API (a mesma porta da tela), e a conferência lida pela API. */
async function importar(page: Page, c: Cenario, itens: ItemDaNotaDeVariosItens[]): Promise<{ nota: NotaSinteticaDeVariosItens; id: string; conf: ConferenciaLida }> {
  const nota = notaSinteticaDeVariosItens({ emitenteCnpj: c.emitente, emitenteNome: `Emitente sintético ${uniq("XML01")}`, itens });
  const imp = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", { nome_arquivo: `nfe-${nota.numero}.xml`, arquivo_base64: Buffer.from(nota.xml, "utf8").toString("base64"), empresa_id: c.empresa });
  const conf = await api<ConferenciaLida>(page, "GET", `/api/compras/importacoes/${imp.id}`);
  expect(conf, "premissa: a importação pendente, da empresa ativa, com o fornecedor encontrado pelo emitente")
    .toMatchObject({ situacao: "pendente", empresa: { id: c.empresa }, parceiro: { situacao: "encontrado", id: c.fornecedor }, fornecedorEscolhido: c.fornecedor });
  expect(conf.nota.totais.nota, "premissa: o vNF é a soma dos itens").toBe(nota.vNF);
  expect(conf.capacidades, "premissa: a API deste HEAD declara a capacidade do lote na conferência").toEqual({ criarProdutosDaNota: 1 });
  return { nota, id: imp.id, conf };
}

/** O `measurement_id` do pré-preenchimento do item (própria), ou null quando a chave não veio. */
const unidadeDoPreenchimento = (conf: ConferenciaLida, n: number): string | null => {
  const p = vinculoDe(conf, n).preenchimento;
  return p && Object.hasOwn(p, "measurement_id") ? String(p["measurement_id"]) : null;
};

/** Quantos produtos VIVOS têm `termo` na busca (description/código/referência) — a contagem pela API. */
async function produtosCom(page: Page, termo: string): Promise<number> {
  const r = await api<{ total: number; items: unknown[] }>(page, "GET", `/api/resources/products?search=${encodeURIComponent(termo)}&pageSize=50`);
  expect(typeof r.total, "premissa: a listagem de produtos responde o total").toBe("number");
  return r.total;
}

/** Abre a conferência da importação e a aba dos itens (com a TOP, quando dada, escolhida antes). */
async function abrirConferencia(page: Page, id: string, top?: string) {
  await page.goto(`/compras/importacoes/${id}`);
  const raiz = page.getByTestId("importacao-conferencia");
  await expect(raiz, "a conferência desenhou, pendente").toHaveAttribute("data-situacao", "pendente");
  await expect(raiz).toHaveAttribute("data-relendo", "nao");
  if (top) await page.getByTestId("importacao-top").selectOption(top);
  await page.getByTestId("importacao-aba-itens-rotulo").click();
  await expect(page.getByTestId("importacao-aba-itens")).toBeVisible();
}

/* ═════════════════════════════════ XML-T1 ═════════════════════════════════ */

test("XML-T1 — o lote ponta a ponta: o botão conta PRODUTOS, nada é chamado antes do confirmar, Grupo e Natureza UMA vez, o POST só com decisões, 201, os itens recebem o produto sem reler a conferência, os produtos gravados têm o que a nota disse e o local do item, e o Gerar compra sai", async ({ page, produtosDaTela }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenario(page, "T1");
  const r = c.rodada;
  await premissaDasNcms(page, { "23099090": true, "31052000": true, "23099010": true, "31054000": true, "31053000": true, "31051000": true });
  c.semUnidade("XYZ");
  const [e1, e2, e3, e4, e5] = [eanSintetico(), eanSintetico(), eanSintetico(), eanSintetico(), eanSintetico()];
  const itens: ItemDaNotaDeVariosItens[] = [
    { codigo: `T1-${r}-01`, descricao: `XMLT1 sugerido ${r}`, unidade: "UN", ncm: "23099090", ean: e1!, quantidade: "12", valorUnitario: "15.00", valorProdutos: "180.00" },
    { codigo: `T1-${r}-02`, descricao: `XMLT1 adubo a granel ${r}`, unidade: "KG", ncm: "31052000", ean: e2!, quantidade: "100", valorUnitario: "2.50", valorProdutos: "250.00" },
    { codigo: `T1-${r}-03`, descricao: `XMLT1 racao em unidade ${r}`, unidade: "UN", ncm: "23099010", ean: e3!, quantidade: "30", valorUnitario: "4.50", valorProdutos: "135.00" },
    { codigo: `T1-${r}-04`, descricao: `XMLT1 adubo em caixa ${r}`, unidade: "CX", ncm: "31054000", ean: e4!, quantidade: "10", valorUnitario: "32.00", valorProdutos: "320.00" },
    { codigo: `T1-${r}-05`, descricao: `XMLT1 adubo em saco ${r}`, unidade: "SC", ncm: "31053000", ean: e5!, quantidade: "20", valorUnitario: "95.00", valorProdutos: "1900.00" },
    { codigo: `T1-${r}-05`, descricao: `XMLT1 adubo em saco bonificado ${r}`, unidade: "SC", ncm: "31053000", ean: e5!, quantidade: "2", valorUnitario: "95.00", valorProdutos: "190.00" },
    { codigo: `T1-${r}-07`, descricao: `XMLT1 unidade estranha ${r}`, unidade: "XYZ", ncm: "31051000", ean: null, quantidade: "5", valorUnitario: "10.00", valorProdutos: "50.00" }
  ];
  // O EXISTENTE do item 1: o código de barras é o EAN do item (o vínculo nasce "sugerido" pelo código de barras).
  const existente = await criarCadastro(page, "products", {
    description: `XMLT1 existente ${r}`, group_id: c.ref.grupo.id, measurement_id: c.unidadeDe("UN").id, financial_category_id: c.ref.natureza.id, barcode: e1
  });
  const { nota, id, conf } = await importar(page, c, itens);
  // PREMISSAS DO CENÁRIO, pelo servidor: 1 sugerido; 2–7 sem vínculo; a unidade resolvida em 2–6 e AUSENTE no 7.
  expect(conf.itens.map((i) => [i.nItem, i.vinculo.situacao, i.vinculo.origem ?? null, i.vinculo.produto?.id ?? null]), "premissa: 1 sugerido pelo código de barras; 2–7 sem vínculo")
    .toEqual([[1, "sugerido", "codigo_barras", existente.id], ...[2, 3, 4, 5, 6, 7].map((n) => [n, "nenhum", null, null])]);
  const unidade = { 2: c.unidadeDe("KG").id, 3: c.unidadeDe("UN").id, 4: c.unidadeDe("CX").id, 5: c.unidadeDe("SC").id, 6: c.unidadeDe("SC").id } as Record<number, string>;
  expect([2, 3, 4, 5, 6, 7].map((n) => [n, unidadeDoPreenchimento(conf, n)]), "premissa: o uCom de 2–6 resolve UMA unidade do seed; o XYZ (7) vem sem measurement_id")
    .toEqual([[2, unidade[2]], [3, unidade[3]], [4, unidade[4]], [5, unidade[5]], [6, unidade[6]], [7, null]]);

  // A TELA. O fio ouvido desde antes da página abrir.
  const fio = ouvirFio(page, id);
  await abrirConferencia(page, id, c.top);
  expect(fio.leiturasDaConferencia(), "premissa: o fio registrou a leitura da conferência (o contador funciona)").toBeGreaterThanOrEqual(1);
  for (const n of [1, 2, 3, 4, 5, 6, 7]) await expect(page.getByTestId(`importacao-item-${n}`)).toHaveAttribute("data-vinculo", n === 1 ? "sugerido" : "nenhum");
  // O LOCAL: 1, 2, 4, 5 e 6 escolhem o Local do caso; o 3 fica sem; o 4 desmarca "Gera estoque" DEPOIS de escolher.
  for (const n of [1, 2, 4, 5, 6]) await escolher(page, page.getByTestId(`importacao-item-${n}-local`), c.local.nome, `Local do item ${n}`);
  await page.getByTestId("importacao-item-4-gera-estoque").uncheck();
  await expect(page.getByTestId("importacao-item-4-gera-estoque")).not.toBeChecked();
  await expect(page.getByTestId("importacao-item-4-local"), "sem gerar estoque, o Local some do item 4").toHaveCount(0);
  expect(await vazio(page.getByTestId("importacao-item-3-local")), "premissa: o item 3 está sem Local").toBe(true);

  // O BOTÃO conta PRODUTOS: 2, 3, 4 e 5+6 (mesmo código, mesma unidade) = 4; o 7 fica de fora; o 1 já tem produto.
  const botao = page.getByTestId("importacao-criar-produtos");
  await expect(botao, "com a capacidade, products.create e candidatos, o botão do lote existe").toBeVisible();
  await expect(botao).toHaveAttribute("data-quantidade", "4");
  const quantidadeNoBotao = await botao.getAttribute("data-quantidade");
  await expect(botao).toHaveText("Criar 4 produtos da nota");
  expect(fio.aoLote(), "abrir a aba e escolher os locais: ZERO requisição a /criar-produtos").toBe(0);

  await botao.click();
  const dialogo = page.getByTestId("importacao-criar-produtos-dialogo");
  await expect(dialogo, "o diálogo do lote abriu").toBeVisible();
  for (const n of [2, 3, 4, 5, 6]) {
    await expect(dialogo.getByTestId(`importacao-criar-produtos-item-${n}`), `o item ${n} está na lista`).toBeVisible();
    await expect(dialogo.getByTestId(`importacao-criar-produtos-item-${n}-marcado`), `o item ${n} vem marcado`).toBeChecked();
  }
  for (const n of [1, 7]) await expect(dialogo.getByTestId(`importacao-criar-produtos-item-${n}`), `o item ${n} não está na lista`).toHaveCount(0);
  await expect(dialogo.locator("[data-testid^='importacao-criar-produtos-fora-']"), "UM item fica de fora").toHaveCount(1);
  await expect(dialogo.getByTestId("importacao-criar-produtos-fora-7"), "o XYZ fica de fora (crie pelo item)").toContainText("XYZ");
  const confirmar = dialogo.getByTestId("importacao-criar-produtos-confirmar");
  await expect(confirmar, "sem Grupo e Natureza não há o que mandar").toBeDisabled();
  // Grupo e Natureza: UMA pergunta para a nota (um campo de cada), respondida uma vez.
  await expect(dialogo.getByTestId("importacao-criar-produtos-grupo"), "um campo de Grupo para a nota").toHaveCount(1);
  await expect(dialogo.getByTestId("importacao-criar-produtos-natureza"), "um campo de Natureza para a nota").toHaveCount(1);
  let respostas = 0;
  await escolher(page, dialogo.getByTestId("importacao-criar-produtos-grupo"), c.ref.grupo.label, "Grupo do lote"); respostas++;
  await escolher(page, dialogo.getByTestId("importacao-criar-produtos-natureza"), c.ref.natureza.label, "Natureza do lote"); respostas++;
  expect(respostas, "Grupo e Natureza: duas respostas para os 4 produtos").toBe(2);
  await expect(confirmar).toBeEnabled();
  await expect(confirmar).toHaveText("Criar 4 produtos da nota");
  expect(fio.aoLote(), "abrir o diálogo e responder Grupo/Natureza: ZERO requisição a /criar-produtos").toBe(0);

  // CONFIRMAR: UM POST, só com decisões.
  const leiturasAntes = fio.leiturasDaConferencia();
  const aoLoteAntes = fio.aoLote();
  const post = postEm(page, `/api/compras/importacoes/${id}/criar-produtos`);
  await confirmar.click();
  const resposta = await post;
  expect(fio.aoLote(), "o confirmar fez UMA requisição ao lote").toBe(1);
  const enviado = resposta.request().postDataJSON() as Record<string, unknown> & { itens: Record<string, unknown>[] };
  expect(Object.keys(enviado).sort(), "o corpo tem EXATAMENTE group_id, financial_category_id, fornecedor_id e itens").toEqual(["financial_category_id", "fornecedor_id", "group_id", "itens"]);
  expect(enviado.itens.map((i) => Object.keys(i).sort()), "cada item só n_item e armazem_id (nenhum valor de produto)").toEqual(enviado.itens.map(() => ["armazem_id", "n_item"]));
  expect(enviado, "as decisões: Grupo, Natureza, o fornecedor da conferência e o Local de cada item (nulo sem Local e sem Gera estoque)").toEqual({
    group_id: c.ref.grupo.id, financial_category_id: c.ref.natureza.id, fornecedor_id: c.fornecedor,
    itens: [{ n_item: 2, armazem_id: c.local.id }, { n_item: 3, armazem_id: null }, { n_item: 4, armazem_id: null }, { n_item: 5, armazem_id: c.local.id }, { n_item: 6, armazem_id: c.local.id }]
  });
  expect(resposta.request().headers()["idempotency-key"], "com Idempotency-Key").toBeTruthy();
  expect(resposta.status(), `o lote foi aceito: ${resposta.status()}`).toBe(201);
  const corpo = (await resposta.json()) as ProdutosCriados;
  for (const p of corpo.produtos) produtosDaTela.add(p.id);
  expect(corpo.importacao_id).toBe(id);
  expect(corpo.produtos, "4 produtos (5 e 6 são um só)").toHaveLength(4);
  const pid = new Map(corpo.itens.map((i) => [i.nItem, i.produto.id]));
  expect(corpo.itens.map((i) => [i.nItem, i.produto.id, i.localPadrao]), "um item por item confirmado, na ordem da nota; 5 e 6 com o MESMO produto; o local gravado")
    .toEqual([[2, pid.get(2), c.local.id], [3, pid.get(3), null], [4, pid.get(4), null], [5, pid.get(5), c.local.id], [6, pid.get(5), c.local.id]]);
  expect(new Set(corpo.itens.map((i) => i.produto.id)).size, "4 produtos distintos").toBe(4);
  await expect(dialogo, "o diálogo fecha depois do 201").toBeHidden();

  // OS ITENS recebem o produto — sem nenhuma releitura (a conferência nem o produto criado são pedidos de novo).
  for (const i of corpo.itens) {
    const combo = page.getByTestId(`importacao-item-${i.nItem}-produto`).locator("[role='combobox']").first();
    await expect(combo, `o item ${i.nItem} mostra o produto criado`).toContainText(`${i.produto.codigo} — ${i.produto.descricao}`);
  }
  await expect(botao, "sem candidato a criar, o botão some").toHaveCount(0);
  expect(await vazio(page.getByTestId("importacao-item-7-produto")), "o item 7 (fora) continua sem produto").toBe(true);
  await page.waitForTimeout(500);
  expect(fio.leiturasDaConferencia() - leiturasAntes, "ZERO GET novo da conferência depois do POST").toBe(0);
  expect(corpo.produtos.map((p) => [p.id, fio.leiturasDoProduto(p.id)]), "ZERO leitura dos produtos criados: a tela os conhece pela resposta").toEqual(corpo.produtos.map((p) => [p.id, 0]));
  console.log(`[XML-T1] fio | data-quantidade=${quantidadeNoBotao} | /criar-produtos antes do confirmar=${aoLoteAntes}, depois=${fio.aoLote()} | corpo: ${JSON.stringify(Object.keys(enviado).sort())} itens ${JSON.stringify(enviado.itens)}`
    + ` | ${resposta.status()} produtos=${corpo.produtos.length} itens=${corpo.itens.length} | GET da conferência antes do POST=${leiturasAntes}, novos depois=${fio.leiturasDaConferencia() - leiturasAntes}`);

  // OS PRODUTOS GRAVADOS, lidos pela API: o que a nota disse (o do 1º item da chave) e o local do item.
  const esperadoDo = (n: number, local: string | null) => {
    const i = nota.itens[n - 1]!;
    return { description: i.descricao, ncm_code: i.ncm, barcode: i.ean, measurement_id: unidade[n], default_warehouse_id: local, group_id: c.ref.grupo.id, financial_category_id: c.ref.natureza.id };
  };
  for (const [n, local] of [[2, c.local.id], [3, null], [4, null], [5, c.local.id]] as const) {
    const row = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${pid.get(n)}`);
    expect(row, `o produto do item ${n} gravado com o que a nota disse e o local do item`).toMatchObject(esperadoDo(n, local));
    const criado = corpo.produtos.find((p) => p.id === pid.get(n))!;
    expect(String(row["code"] ?? ""), `o produto do item ${n} tem código (o contador)`).toMatch(/\S/);
    expect(row["code"], "o código gravado é o da resposta").toBe(criado.codigo);
  }

  // O "GERAR COMPRA" com eles: o item 3 ganha o Local; o 7 (fora) recebe o existente; natureza e centro do documento.
  await escolher(page, page.getByTestId("importacao-item-3-local"), c.local.nome, "Local do item 3");
  await escolher(page, page.getByTestId("importacao-item-7-produto"), `XMLT1 existente ${r}`, "Produto do item 7");
  await escolher(page, page.getByTestId("importacao-item-7-local"), c.local.nome, "Local do item 7");
  const gerar = page.getByTestId("importacao-gerar-compra");
  await expect(gerar).toBeEnabled();
  const postGerar = postEm(page, `/api/compras/importacoes/${id}/gerar-compra`);
  await gerar.click();
  const rg = await postGerar;
  const corpoGerar = rg.request().postDataJSON() as { itens: { n_item: number; produto_id: string; armazem_id: string | null; gera_estoque: boolean }[] };
  expect(rg.status(), `a compra foi gerada: ${rg.status()}`).toBe(201);
  expect(corpoGerar.itens.map((i) => [i.n_item, i.produto_id, i.armazem_id, i.gera_estoque]), "o Gerar leva os produtos criados pelo lote")
    .toEqual([[1, existente.id, c.local.id, true], [2, pid.get(2), c.local.id, true], [3, pid.get(3), c.local.id, true], [4, pid.get(4), null, false],
      [5, pid.get(5), c.local.id, true], [6, pid.get(5), c.local.id, true], [7, existente.id, c.local.id, true]]);
  const compra = (await rg.json()) as { id: string; situacao: string; valor_total: string; importacao_id: string };
  expect(compra, "a compra nasce ABERTA, com o total da nota").toMatchObject({ situacao: "aberto", valor_total: nota.vNF, importacao_id: id });
  const depois = await api<{ situacao: string; documentoCompra: { id: string } | null }>(page, "GET", `/api/compras/importacoes/${id}`);
  expect(depois, "a importação ficou gerada, ligada à compra").toMatchObject({ situacao: "gerada", documentoCompra: { id: compra.id } });
  console.log(`[XML-T1] gerar-compra ${rg.status()} | situacao ${compra.situacao} | valor_total ${compra.valor_total} = vNF ${nota.vNF} | importação ${depois.situacao}`);
});

/* ═════════════════════════════════ XML-T2 ═════════════════════════════════ */

test("XML-T2 — a recusa no diálogo: NCM vencida no lote → 422 com o item, a tela diz \"Item <n>: …\", o diálogo fica aberto, nada muda e ZERO produto nasce; desmarcado o item, o lote cria o outro (201)", async ({ page, produtosDaTela }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenario(page, "T2");
  const r = c.rodada;
  await premissaDasNcms(page, { "31052000": true, "39139050": false });
  const itens: ItemDaNotaDeVariosItens[] = [
    { codigo: `T2-${r}-01`, descricao: `XMLT2 adubo vigente ${r}`, unidade: "KG", ncm: "31052000", ean: eanSintetico(), quantidade: "100", valorUnitario: "2.50", valorProdutos: "250.00" },
    { codigo: `T2-${r}-02`, descricao: `XMLT2 quitosana vencida ${r}`, unidade: "UN", ncm: "39139050", ean: eanSintetico(), quantidade: "4", valorUnitario: "30.00", valorProdutos: "120.00" }
  ];
  const { id, conf } = await importar(page, c, itens);
  expect(conf.itens.map((i) => [i.nItem, i.vinculo.situacao]), "premissa: os dois itens sem vínculo").toEqual([[1, "nenhum"], [2, "nenhum"]]);
  expect([1, 2].map((n) => unidadeDoPreenchimento(conf, n)), "premissa: os dois com a unidade resolvida (entram na lista)").toEqual([c.unidadeDe("KG").id, c.unidadeDe("UN").id]);
  expect(vinculoDe(conf, 2).preenchimento?.["ncm_code"], "premissa: a conferência traz a NCM vencida da nota").toBe("39139050");
  const antes = await produtosCom(page, `XMLT2`);
  const doCaso = await produtosCom(page, r);
  expect(doCaso, "premissa: nenhum produto do caso antes do lote").toBe(0);

  const fio = ouvirFio(page, id);
  await abrirConferencia(page, id);
  const botao = page.getByTestId("importacao-criar-produtos");
  await expect(botao).toHaveAttribute("data-quantidade", "2");
  await botao.click();
  const dialogo = page.getByTestId("importacao-criar-produtos-dialogo");
  await expect(dialogo).toBeVisible();
  await escolher(page, dialogo.getByTestId("importacao-criar-produtos-grupo"), c.ref.grupo.label, "Grupo do lote");
  await escolher(page, dialogo.getByTestId("importacao-criar-produtos-natureza"), c.ref.natureza.label, "Natureza do lote");
  const confirmar = dialogo.getByTestId("importacao-criar-produtos-confirmar");

  // 1ª tentativa: os dois → 422 com o item 2 (índice 1 do corpo) no caminho.
  const post1 = postEm(page, `/api/compras/importacoes/${id}/criar-produtos`);
  await confirmar.click();
  const r1 = await post1;
  expect((r1.request().postDataJSON() as { itens: { n_item: number }[] }).itens.map((i) => i.n_item), "premissa: o corpo levou os dois itens").toEqual([1, 2]);
  expect(r1.status(), "a NCM vencida recusa o lote inteiro").toBe(422);
  const e1 = (await r1.json()) as { error: { code: string; details: { path: string; message: string; ncm?: string }[] } };
  expect(e1.error.code).toBe("VALIDATION_ERROR");
  expect(e1.error.details.map((d) => [d.path, d.ncm ?? null]), "a recusa aponta o item 2 (itens[1].ncm_code) e a NCM").toEqual([["itens[1].ncm_code", "39139050"]]);
  expect(e1.error.details[0]!.message, "a recusa fala da NCM").toMatch(/NCM/);
  const erro = dialogo.getByTestId("importacao-criar-produtos-erro");
  await expect(erro, "a tela diz o item da nota e a mensagem do servidor").toHaveText(`Item 2: ${e1.error.details[0]!.message}`);
  await expect(dialogo, "o diálogo continua aberto").toBeVisible();
  // NADA MUDOU: os itens sem produto, o botão com a mesma conta, e ZERO produto pela API.
  for (const n of [1, 2]) expect(await vazio(page.getByTestId(`importacao-item-${n}-produto`)), `o item ${n} continua sem produto`).toBe(true);
  await expect(botao, "o botão continua com os 2 produtos").toHaveAttribute("data-quantidade", "2");
  const depoisDaRecusa = await produtosCom(page, r);
  expect(depoisDaRecusa, "ZERO produto do caso depois da recusa").toBe(0);
  expect(await produtosCom(page, `XMLT2`), "e nenhum produto XMLT2 a mais").toBe(antes);

  // 2ª: desmarca o item 2 e confirma → 201, só o item 1.
  await dialogo.getByTestId("importacao-criar-produtos-item-2-marcado").uncheck();
  await expect(confirmar).toHaveText("Criar 1 produto da nota");
  const post2 = postEm(page, `/api/compras/importacoes/${id}/criar-produtos`);
  await confirmar.click();
  const r2 = await post2;
  expect((r2.request().postDataJSON() as { itens: { n_item: number }[] }).itens.map((i) => i.n_item), "o corpo leva só o item 1").toEqual([1]);
  expect(r2.status(), `sem o item da NCM vencida, o lote é aceito: ${r2.status()}`).toBe(201);
  const corpo = (await r2.json()) as ProdutosCriados;
  for (const p of corpo.produtos) produtosDaTela.add(p.id);
  expect(corpo.produtos).toHaveLength(1);
  expect(corpo.itens.map((i) => i.nItem)).toEqual([1]);
  await expect(dialogo, "o diálogo fecha depois do 201").toBeHidden();
  await expect(page.getByTestId("importacao-item-1-produto").locator("[role='combobox']").first()).toContainText(`${corpo.produtos[0]!.codigo} — ${corpo.produtos[0]!.descricao}`);
  expect(await vazio(page.getByTestId("importacao-item-2-produto")), "o item 2 continua sem produto").toBe(true);
  await expect(botao, "o item 2 continua candidato").toHaveAttribute("data-quantidade", "1");
  expect(fio.aoLote(), "duas requisições ao lote: a recusada e a aceita").toBe(2);
  expect(await produtosCom(page, r), "UM produto do caso").toBe(1);
  const row = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${corpo.produtos[0]!.id}`);
  expect(row, "o produto do item 1, com a NCM vigente da nota").toMatchObject({ description: itens[0]!.descricao, ncm_code: "31052000", measurement_id: c.unidadeDe("KG").id });
  console.log(`[XML-T2] fio | 1º confirmar ${r1.status()} ${JSON.stringify(e1.error.details.map((d) => d.path))} | produtos do caso depois da recusa=${depoisDaRecusa} | 2º confirmar (item 2 desmarcado) ${r2.status()} produtos=${corpo.produtos.length} | /criar-produtos=${fio.aoLote()}`);
});

/* ═════════════════════════════════ XML-T3 ═════════════════════════════════ */

test("XML-T3 — sem products.create (com compras.create): a conferência com a capacidade e o candidato não mostra o botão; o MESMO corpo forjado pela sessão desse usuário recebe 403 e nada é criado", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenario(page, "T3");
  const r = c.rodada;
  await premissaDasNcms(page, { "31052000": true });
  const itens: ItemDaNotaDeVariosItens[] = [
    { codigo: `T3-${r}-01`, descricao: `XMLT3 adubo ${r}`, unidade: "KG", ncm: "31052000", ean: eanSintetico(), quantidade: "100", valorUnitario: "2.50", valorProdutos: "250.00" }
  ];
  const { id, conf } = await importar(page, c, itens);
  expect(conf.itens.map((i) => [i.nItem, i.vinculo.situacao, unidadeDoPreenchimento(conf, i.nItem)]), "premissa: o item sem vínculo, com a unidade (candidato ao lote)").toEqual([[1, "nenhum", c.unidadeDe("KG").id]]);
  const corpoForjado = { group_id: c.ref.grupo.id, financial_category_id: c.ref.natureza.id, fornecedor_id: c.fornecedor, itens: [{ n_item: 1, armazem_id: c.local.id }] };

  // PREMISSA: com products.create (o administrador), ESTA conferência mostra o botão do lote e o "Criar produto".
  await abrirConferencia(page, id);
  await expect(page.getByTestId("importacao-criar-produtos"), "premissa: com products.create, o botão do lote existe nesta conferência").toHaveAttribute("data-quantidade", "1");
  await expect(page.getByTestId("importacao-item-1-criar-produto"), "premissa: e o Criar produto do item").toBeVisible();

  // O PERFIL: compras.create (e as leituras da tela), SEM products.create.
  const permissoes = ["compras.view", "compras.create", "products.view", "warehouses.view"];
  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", { name: uniq("XML01 comprador sem cadastro"), permissions: permissoes });
  const comprador = { email: `e2e-xml01-sem-produto-${Date.now().toString(36)}@demo.local`, password: "Restrito@12345" };
  await api(page, "POST", "/api/admin/members", {
    name: "XML01 comprador sem cadastro de produto", email: comprador.email, password: comprador.password, role_id: papel.id,
    escopos_empresas: [{ modulo: "compras", modo: "todas", empresas: [] }]
  });
  await logout(page);
  try {
    await login(page, comprador);
    const contexto = await api<{ permissions?: string[] }>(page, "GET", "/api/auth/context");
    expect(contexto.permissions ?? [], "premissa: o comprador lança compra").toContain("compras.create");
    expect(contexto.permissions ?? [], "premissa: o comprador NÃO cria produto").not.toContain("products.create");

    const fio = ouvirFio(page, id);
    const leitura = page.waitForResponse((x) => x.request().method() === "GET" && caminho(x) === `/api/compras/importacoes/${id}`);
    await abrirConferencia(page, id);
    const lida = (await (await leitura).json()) as ConferenciaLida;
    // NO FIO: a MESMA conferência declara a capacidade e o item é candidato — o que falta é só a permissão.
    expect(lida.capacidades, "no fio: a conferência declara a capacidade do lote").toEqual({ criarProdutosDaNota: 1 });
    expect([lida.itens[0]!.vinculo.situacao, unidadeDoPreenchimento(lida, 1)], "no fio: o item 1 sem vínculo, com a unidade").toEqual(["nenhum", c.unidadeDe("KG").id]);
    await expect(page.getByTestId("importacao-item-1"), "premissa: o item desenhou para o comprador").toHaveAttribute("data-vinculo", "nenhum");
    await expect(page.getByTestId("importacao-item-1-local"), "premissa: a aba é a de lançar (o Local do item está lá)").toBeVisible();
    await expect(page.getByTestId("importacao-criar-produtos"), "sem products.create: nenhum botão do lote").toHaveCount(0);
    await expect(page.getByTestId("importacao-criar-produtos-dialogo")).toHaveCount(0);
    await expect(page.getByTestId("importacao-item-1-criar-produto"), "nem o Criar produto do item").toHaveCount(0);
    expect(fio.aoLote(), "a tela do comprador não chamou o lote").toBe(0);

    // O MESMO CORPO, forjado pela sessão do comprador (fora da tela): 403, e nada criado.
    const cab = await cabecalhosDaSessao(page);
    const forjado = await page.request.post(`${API}/api/compras/importacoes/${id}/criar-produtos`, {
      headers: { ...cab, "content-type": "application/json", "Idempotency-Key": randomUUID() }, data: corpoForjado
    });
    const texto = await forjado.text();
    expect(forjado.status(), `o lote forjado sem products.create é recusado: ${texto.slice(0, 200)}`).toBe(403);
    expect((JSON.parse(texto) as { error: { code: string } }).error.code).toBe("PERMISSION_DENIED");
    const doCaso = await produtosCom(page, r);
    expect(doCaso, "ZERO produto do caso").toBe(0);
    const depois = await api<ConferenciaLida>(page, "GET", `/api/compras/importacoes/${id}`);
    expect([depois.situacao, vinculoDe(depois, 1).situacao], "a importação continua pendente e o item sem vínculo").toEqual(["pendente", "nenhum"]);
    console.log(`[XML-T3] fio | capacidades=${JSON.stringify(lida.capacidades)} | botão do lote=${await page.getByTestId("importacao-criar-produtos").count()} | /criar-produtos da tela=${fio.aoLote()} | forjado ${forjado.status()} | produtos do caso=${doCaso}`);
  } finally {
    // A limpeza da fixture exclui os cadastros e a TOP com a sessão do administrador.
    await logout(page);
    await login(page);
  }
});

/* ═════════════════════════════════ XML-T4 ═════════════════════════════════ */

test("XML-T4 — o diálogo de UM item continua: abre com descrição, NCM, código de barras E a unidade preenchidos; Grupo e Natureza escolhidos; salvar dá o produto ao item", async ({ page, produtosDaTela }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenario(page, "T4");
  const r = c.rodada;
  await premissaDasNcms(page, { "31052000": true });
  const ean = eanSintetico();
  const itens: ItemDaNotaDeVariosItens[] = [
    { codigo: `T4-${r}-01`, descricao: `XMLT4 adubo pelo item ${r}`, unidade: "KG", ncm: "31052000", ean, quantidade: "100", valorUnitario: "2.50", valorProdutos: "250.00" }
  ];
  const kg = c.unidadeDe("KG");
  const { id, conf } = await importar(page, c, itens);
  expect(unidadeDoPreenchimento(conf, 1), "premissa: a conferência traz a unidade do uCom").toBe(kg.id);

  await abrirConferencia(page, id);
  await expect(page.getByTestId("importacao-criar-produtos"), "o lote existe ao lado (a capacidade), e o diálogo de um item continua").toHaveAttribute("data-quantidade", "1");
  await page.getByTestId("importacao-item-1-criar-produto").click();
  const dialogo = page.getByTestId("importacao-cadastro-products");
  await expect(dialogo, "o cadastro de produto pelo item abriu").toBeVisible();
  await expect(dialogo.getByTestId("b1-form"), "o formulário carregou").toBeVisible();
  // O QUE O FORMULÁRIO TRAZ AO ABRIR, antes de qualquer toque.
  await expect(dialogo.locator("input[name='description']")).toHaveValue(itens[0]!.descricao);
  await expect(dialogo.getByTestId("ref-ncm-codigo").first(), "a NCM da nota").toHaveValue(/^3105\.?20\.?00$/);
  await expect(dialogo.locator("input[name='barcode']"), "o código de barras da nota").toHaveValue(ean);
  const unidadeNoForm = campoDoFormulario(dialogo, rotuloDe("measurement_id")).locator("[role='combobox']").first();
  await expect(unidadeNoForm, "a unidade do uCom já vem escolhida").not.toHaveClass(/is-empty/);
  await expect(unidadeNoForm).toContainText(kg.label);
  // A pessoa escolhe só o que a nota não sabe: o Grupo e (na aba de custos) a Natureza.
  await escolher(page, campoDoFormulario(dialogo, rotuloDe("group_id")), c.ref.grupo.label, "Grupo do produto");
  await dialogo.getByRole("tab", { name: "Custos e venda" }).click();
  await escolher(page, campoDoFormulario(dialogo, rotuloDe("financial_category_id")), c.ref.natureza.label, "Natureza de custo do produto");
  const post = postEm(page, "/api/resources/products");
  await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
  const resposta = await post;
  const enviado = resposta.request().postDataJSON() as Record<string, unknown>;
  expect(resposta.status(), `o produto foi criado: ${resposta.status()}`).toBe(201);
  const row = (await resposta.json()) as { id: string; code: string; description: string };
  produtosDaTela.add(row.id);
  expect(enviado, "o corpo leva o que a nota disse, a unidade sem ter sido tocada, e o Grupo e a Natureza escolhidos")
    .toMatchObject({ description: itens[0]!.descricao, ncm_code: "31052000", barcode: ean, measurement_id: kg.id, group_id: c.ref.grupo.id, financial_category_id: c.ref.natureza.id });
  await expect(dialogo, "o diálogo fecha depois do 201").toBeHidden();
  await expect(page.getByTestId("importacao-item-1-produto").locator("[role='combobox']").first(), "o item recebe o produto").toContainText(row.description);
  await expect(page.getByTestId("importacao-criar-produtos"), "o item tem produto: nada a criar em lote").toHaveCount(0);
  const gravado = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${row.id}`);
  expect(gravado, "o produto gravado com a unidade do uCom").toMatchObject({ description: itens[0]!.descricao, ncm_code: "31052000", barcode: ean, measurement_id: kg.id });
  console.log(`[XML-T4] fio | POST /api/resources/products ${resposta.status()} | measurement_id enviado = ${String(enviado["measurement_id"])} (KG ${kg.id}) sem a pessoa tocar na unidade`);
});

/* ═════════════════════════════════ XML-T5 ═════════════════════════════════ */

test("XML-T5 — o fornecedor ambíguo sem escolha: o botão do lote fica DESABILITADO com o motivo; o corpo forjado sem fornecedor recebe 422 em fornecedor_id e nada nasce; escolhido o fornecedor, o botão habilita", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const c = await cenario(page, "T5");
  const r = c.rodada;
  await premissaDasNcms(page, { "31052000": true });
  // A FILIAL de outro fornecedor com o documento do emitente: o cadastro e a filial são DOIS candidatos ⇒ ambíguo.
  await criarCadastro(page, "people", {
    name: uniq("XML01 T5 outro forn"), person_type: "legal", is_provider: true, document: cnpjDeEmitenteSintetico(),
    filiais: [{ name: `Filial sintética XML01 T5 ${r}`, document: c.emitente }]
  });
  const itens: ItemDaNotaDeVariosItens[] = [
    { codigo: `T5-${r}-01`, descricao: `XMLT5 adubo ${r}`, unidade: "KG", ncm: "31052000", ean: eanSintetico(), quantidade: "10", valorUnitario: "3.00", valorProdutos: "30.00" }
  ];
  const nota = notaSinteticaDeVariosItens({ emitenteCnpj: c.emitente, emitenteNome: `Emitente sintético ${uniq("XML01")}`, itens });
  const imp = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", { nome_arquivo: `nfe-${nota.numero}.xml`, arquivo_base64: Buffer.from(nota.xml, "utf8").toString("base64"), empresa_id: c.empresa });
  const conf = await api<ConferenciaLida>(page, "GET", `/api/compras/importacoes/${imp.id}`);
  expect([conf.parceiro.situacao, conf.fornecedorEscolhido, vinculoDe(conf, 1).situacao, unidadeDoPreenchimento(conf, 1)],
    "premissa: o parceiro AMBÍGUO, nenhum fornecedor escolhido, o item sem vínculo e com a unidade (candidato do lote)").toEqual(["ambiguo", null, "nenhum", c.unidadeDe("KG").id]);

  // A TELA: o botão aparece (é aplicável), mas DESABILITADO, com o motivo.
  const fio = ouvirFio(page, imp.id);
  await abrirConferencia(page, imp.id);
  const botao = page.getByTestId("importacao-criar-produtos");
  await expect(botao, "o lote é aplicável: o botão aparece").toBeVisible();
  await expect(botao, "sem fornecedor escolhido: desabilitado").toBeDisabled();
  await expect(page.getByTestId("importacao-criar-produtos-sem-fornecedor")).toHaveText("Escolha o fornecedor na aba Cabeçalho para criar os produtos de uma vez: os vínculos do item dependem dele.");

  // O SERVIDOR é quem nega: o corpo forjado sem `fornecedor_id` → 422 em `fornecedor_id`, e nada criado.
  const cab = await cabecalhosDaSessao(page);
  const forjado = await page.request.post(`${API}/api/compras/importacoes/${imp.id}/criar-produtos`, {
    headers: { ...cab, "content-type": "application/json", "Idempotency-Key": randomUUID() },
    data: { group_id: c.ref.grupo.id, financial_category_id: c.ref.natureza.id, itens: [{ n_item: 1, armazem_id: null }] }
  });
  const texto = await forjado.text();
  expect(forjado.status(), `o lote sem fornecedor escolhido é recusado: ${texto.slice(0, 300)}`).toBe(422);
  const erro = (JSON.parse(texto) as { error: { code: string; details: { path: string; message: string }[] } }).error;
  expect([erro.code, erro.details.map((d) => d.path)]).toEqual(["VALIDATION_ERROR", ["fornecedor_id"]]);
  expect(erro.details[0]!.message).toBe("Escolha o fornecedor da nota antes de criar os produtos: sem ele não se sabe se o código do fornecedor já liga o item a um produto.");
  expect(await produtosCom(page, r), "ZERO produto do caso").toBe(0);
  expect(fio.aoLote(), "a tela não chamou o lote (o botão está desabilitado)").toBe(0);

  // Escolhido o fornecedor (na aba Cabeçalho), a conferência relida o traz e o botão habilita.
  await page.getByTestId("importacao-aba-cabecalho-rotulo").click();
  await page.getByTestId("importacao-parceiro-escolha").selectOption(c.fornecedor);
  await expect(page.getByTestId("importacao-conferencia")).toHaveAttribute("data-relendo", "nao");
  await page.getByTestId("importacao-aba-itens-rotulo").click();
  await expect(botao, "com o fornecedor escolhido: habilitado").toBeEnabled();
  await expect(page.getByTestId("importacao-criar-produtos-sem-fornecedor")).toHaveCount(0);
  console.log(`[XML-T5] fio | parceiro=${conf.parceiro.situacao} escolhido=${String(conf.fornecedorEscolhido)} | botão desabilitado com o motivo | forjado ${forjado.status()} ${erro.details[0]!.path} | produtos do caso=0 | escolhido ⇒ habilitado`);
});
