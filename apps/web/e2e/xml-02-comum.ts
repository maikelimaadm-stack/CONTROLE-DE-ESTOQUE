import type { Locator, Page, Request, Response } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { getResource } from "@agro/domain";
import { api, uniq, empresaAtiva } from "./helpers";
import { expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";
import { garantirCommit, shaDaBase } from "./skew-fonte-da-base";
import { cnpjDeEmitenteSintetico, eanSintetico, notaSinteticaDeVariosItens, type ItemDaNotaDeVariosItens, type NotaSinteticaDeVariosItens } from "./compras-f7-nfe-sintetica";

/**
 * XML-02 (decisão 314) — AS PEÇAS COMUNS DO E2E DA TELA E DO VERSION SKEW NOS DOIS SENTIDOS.
 *
 * Módulo de apoio (não é spec: o nome não termina em `.spec.ts`, então nenhuma config o roda). Usado por
 * `xml-02-tela.spec.ts` (web e API deste HEAD), `xml-02-skew-api-producao.spec.ts` (sentido 1: o web deste HEAD contra
 * a API da base) e `xml-02-skew-web-anterior.spec.ts` (sentido 2: o web da base contra a API deste HEAD). Duplicados,
 * o cenário e os detectores envelheceriam cada um por conta própria — e é deles que depende o ramo que cada caso cobra.
 *
 * ┌─ O CENÁRIO (`cenarioDaXml02`) ─────────────────────────────────────────────────────────────────────────────┐
 * │ Um fornecedor NOVO (o CNPJ do emitente: nada lembrado, nenhum produto_fornecedores), um Local e uma TOP de   │
 * │ compra do caso, e os itens que o caso pedir, na ordem abaixo (o nItem é a posição):                         │
 * │   G  código de barras: o produto tem `barcode` = o cEAN do item                    → identidade (caminho 3)  │
 * │   D  DESCRIÇÃO semelhante: o produto foi cadastrado à mão (sem barcode, sem referência, sem vínculo); a    │
 * │      nota troca a ordem das palavras e acrescenta a embalagem                       → palpite (caminho 5)    │
 * │   R  REFERÊNCIA: o produto tem `reference` = o cProd do item; a descrição não tem nada em comum com a nota │
 * │      → caminho 4: identidade no SERVIDOR (o lote não o cria), PALPITE na TELA (decisão do dono, 21214fd5)   │
 * │   N  sem produto no cadastro                                                        → `nenhum`               │
 * │ Toda descrição leva o sorteio da execução (`X02<rodada>`): o produto de uma execução anterior que tivesse    │
 * │ ficado vivo dividiria só 3 de 6 lexemas com o item — exatamente a metade, que NÃO casa (a 314 casa com       │
 * │ maioria estrita) —, e o item D desta execução casa com 4 de 5. Nenhuma palavra do cenário existe no seed.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O BANCO (`vinculosLembradosDo`) ──────────────────────────────────────────────────────────────────────────┐
 * │ A TESTEMUNHA do que o "Gerar compra" gravou em `erp.produto_fornecedor_vinculos`, pelo mesmo `psql` dos      │
 * │ specs que já leem o banco do E2E (`f10-comum.ts`, `aj02-comum.ts`). SÓ SELECT, recortado pelo fornecedor do  │
 * │ caso (o UUID conferido antes de entrar na consulta). A falha nunca imprime a conexão: a mensagem sai sem ela. │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ OS DETECTORES DO MUNDO DA BASE (lidos do FONTE do commit da base) ────────────────────────────────────────┐
 * │ `webDaBaseTemAXml02`: o `apps/web/src` do commit tem a linha da conferência do palpite (`sugestao-descricao`) │
 * │ `apiDaBaseTemAXml02`: o `apps/api/src` do commit monta o sugerido de origem "descricao"                     │
 * │ Os dois REPROVAM quando não conseguem ler (commit ausente, árvore quebrada) — nunca viram "não tem". A prova │
 * │ reversa de cada um roda num caso próprio do spec do sentido dele, sobre dois commits FIXOS: a main antes da │
 * │ XML-02 (`COMMITS_DA_XML02.sem`) ⇒ falso, e o commit da fatia na branch da PR #127 (`COMMITS_DA_XML02.com`, que │
 * │ entra na main por merge e continua alcançável por SHA) ⇒ verdadeiro. Depois do merge, a base do skew passa a  │
 * │ ser um commit que JÁ tem a XML-02, e os specs cobram o ramo "novo" — o mesmo comportamento deste HEAD.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Nada aqui imprime credencial: os cabeçalhos da sessão viajam só nas requisições, e a conexão do banco nunca entra
 * numa mensagem.
 */

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const RAIZ = path.resolve(__dirname, "../../..");
export const caminho = (r: Request | Response) => new URL(r.url()).pathname;
export const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exato = (t: string, obrigatorio = false) => new RegExp(`^${escapar(t)}${obrigatorio ? "(\\s*\\*)?" : ""}$`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEF_PRODUTO = getResource("products");
export const rotuloDoCampoDoProduto = (campo: string) => DEF_PRODUTO?.fields.find((f) => f.name === campo)?.label ?? campo;

/** Os rótulos que a tela deste HEAD mostra (`rotuloDoVinculo`, pelos rótulos do domínio). */
export const ROTULO = {
  descricao: "Sugerido (descrição semelhante)",
  referencia: "Sugerido (referência do produto)",
  codigoDeBarras: "Sugerido (código de barras)",
  semVinculo: "Sem vínculo"
} as const;
/** A linha que pede a conferência do palpite da DESCRIÇÃO (`importacao-item-<n>-sugestao-descricao`). */
export const TEXTO_DA_CONFERENCIA_DO_PALPITE = "Produto sugerido pela descrição semelhante: confira antes de gerar.";
/** A linha que pede a conferência do palpite da REFERÊNCIA (`importacao-item-<n>-sugestao-referencia`). */
export const TEXTO_DA_CONFERENCIA_DA_REFERENCIA = "Produto sugerido pela referência do produto: confira antes de gerar.";

/* ═════════════════════════════════ os detectores do mundo da base ═════════════════════════════════ */

/**
 * As marcas da XML-02 no fonte: a da tela (o sufixo do testid da linha do palpite) e a da API (o sugerido de origem
 * "descricao"). A da tela vai SEM o hífen: desde o 21214fd5 o testid sai de `${pede}-${palpite.sufixoDoTestid}` e o fonte
 * só tem `"sugestao-descricao"`; com o hífen, a base que já tem a XML-02 seria lida como legado.
 */
export const MARCA_DA_XML02 = { web: "sugestao-descricao", api: "origem: \"descricao\"" } as const;

/** Dois commits FIXOS, um por mundo. Nenhum é a base desta execução: ela muda a cada PR e só exercitaria o ramo dela. */
export const COMMITS_DA_XML02 = {
  /** A main com a EDITAR-02 mesclada (#126), a base da PR #127: sem a XML-02. */
  sem: "4c163ee81b9556d967a75a9af65bf464897b96fa",
  /**
   * O commit da XML-02 na branch da PR #127 (decisão 314, o contrato e as linhas de TESTING): a tela e a API da fatia.
   * Nele a tela ainda trata a referência como identidade; ele NUNCA é base de PR: entra na main no mesmo merge que o
   * 21214fd5 (a referência como palpite). Por isso o mundo "novo" é um só — o comportamento de agora —, sem um terceiro.
   */
  com: "d2086dd857750950acfb89e2bcd27f48a65f3e45"
} as const;

/** O fonte em `pasta` do commit `sha` contém `trecho`? Erro de leitura REPROVA — nunca vira "não contém". */
export function fonteDoCommitContem(sha: string, trecho: string, pasta: "apps/web/src" | "apps/api/src"): boolean {
  garantirCommit(sha);
  try {
    execFileSync("git", ["grep", "-qF", "-e", trecho, sha, "--", pasta], { cwd: RAIZ, stdio: "pipe" });
    return true;
  } catch (erro) {
    if ((erro as { status?: number | null }).status === 1) return false;   // 1 = nenhuma ocorrência; o resto é erro
    throw erro;
  }
}

/** O fonte DESTE HEAD (a árvore de trabalho, inclusive o que ainda não foi commitado) contém `trecho` em `pasta`? */
export function fonteDoHeadContem(trecho: string, pasta: string): boolean {
  try {
    execFileSync("git", ["grep", "-qF", "--untracked", "-e", trecho, "--", pasta], { cwd: RAIZ, stdio: "pipe" });
    return true;
  } catch (erro) {
    if ((erro as { status?: number | null }).status === 1) return false;
    throw erro;
  }
}

/** O web do commit (por padrão, a base desta execução) já tem a tela da XML-02? */
export const webDaBaseTemAXml02 = (sha: string = shaDaBase()) => fonteDoCommitContem(sha, MARCA_DA_XML02.web, "apps/web/src");
/** A API do commit (por padrão, a base desta execução) já monta o sugerido pela descrição? */
export const apiDaBaseTemAXml02 = (sha: string = shaDaBase()) => fonteDoCommitContem(sha, MARCA_DA_XML02.api, "apps/api/src");

/* ═════════════════════════════════ o banco (só SELECT) ═════════════════════════════════ */

const BANCO = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";

/** Uma leitura do banco do E2E. A falha sai com a saída de erro do psql SEM a conexão (nenhuma URL na mensagem). */
function lerDoBanco(consulta: string): string {
  try {
    return execFileSync("psql", [BANCO, "-v", "ON_ERROR_STOP=1", "-Atc", consulta], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (erro) {
    const saida = String((erro as { stderr?: unknown }).stderr ?? "").replace(/postgres(ql)?:\/\/\S+/gi, "<conexão>");
    throw new Error(`a leitura do banco do E2E falhou: ${saida.slice(0, 300)}`);
  }
}

/** Os vínculos LEMBRADOS do fornecedor, em `código|unidade|produto`, em ordem — a testemunha do que o Gerar gravou. */
export function vinculosLembradosDo(fornecedorId: string): string[] {
  expect(fornecedorId, "premissa: o fornecedor do caso é um UUID (entra na consulta)").toMatch(UUID);
  const linhas = lerDoBanco(`select codigo_fornecedor || '|' || unidade_fornecedor || '|' || produto_id::text from erp.produto_fornecedor_vinculos where fornecedor_id = '${fornecedorId}' order by 1`);
  return linhas ? linhas.split("\n") : [];
}

/** Quantas linhas `erp.produto_fornecedor_vinculos` tem no banco do E2E (todas as organizações) — informativo. */
export const totalDeVinculosLembrados = () => Number(lerDoBanco("select count(*) from erp.produto_fornecedor_vinculos"));

/* ═════════════════════════════════ o cenário ═════════════════════════════════ */

export type PapelDoItem = "G" | "D" | "R" | "N";
export interface ProdutoDoCaso { id: string; codigo: string; descricao: string }

interface ItemDoPapel { descricaoDaNota: (tok: string) => string; produto: ((tok: string) => string) | null; unidade: string; ncm: string; quantidade: string; valorUnitario: string; valorProdutos: string }
const DO_PAPEL: Record<PapelDoItem, ItemDoPapel> = {
  G: { descricaoDaNota: (t) => `ARAME OVALADO 700M ${t}`, produto: (t) => `ARAME LISO OVALADO ${t}`, unidade: "UN", ncm: "73130000", quantidade: "3", valorUnitario: "12.50", valorProdutos: "37.50" },
  D: { descricaoDaNota: (t) => `ADITIVO SILAGEM BACTERIANO 4KG ${t}`, produto: (t) => `ADITIVO BACTERIANO PARA SILAGEM ${t}`, unidade: "KG", ncm: "23099090", quantidade: "5", valorUnitario: "40.00", valorProdutos: "200.00" },
  R: { descricaoDaNota: (t) => `PECA TECNICA ALFA ${t}`, produto: (t) => `PRODUTO REFERENCIADO ${t}`, unidade: "UN", ncm: "38249929", quantidade: "2", valorUnitario: "15.00", valorProdutos: "30.00" },
  N: { descricaoDaNota: (t) => `PARAFUSO SEXTAVADO 3/8 ${t}`, produto: null, unidade: "UN", ncm: "73181500", quantidade: "10", valorUnitario: "1.20", valorProdutos: "12.00" }
};

/**
 * O cenário de um caso: a referência do seed, um fornecedor NOVO com o CNPJ do emitente (com `parceiroAmbiguo`, também
 * a filial de OUTRO cadastro com o mesmo documento: dois candidatos, nenhum escolhido), um Local e a TOP do caso, e o
 * produto de cada papel que tem um. Tudo pela porta de `central-compras-fixtures` (excluído no fim do caso).
 */
export async function cenarioDaXml02(page: Page, rotulo: string, papeis: readonly PapelDoItem[], o: { parceiroAmbiguo?: boolean } = {}) {
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
  const rodada = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const tok = `X02${rodada}`;
  const emitente = cnpjDeEmitenteSintetico();
  const forn = await criarCadastro(page, "people", { name: uniq(`XML02 ${rotulo} forn`), person_type: "legal", is_provider: true, document: emitente });
  if (o.parceiroAmbiguo) {
    await criarCadastro(page, "people", {
      name: uniq(`XML02 ${rotulo} outro forn`), person_type: "legal", is_provider: true, document: cnpjDeEmitenteSintetico(),
      filiais: [{ name: `Filial sintética XML02 ${rotulo} ${rodada}`, document: emitente }]
    });
  }
  const arm = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `${rotulo.slice(-1)}${rodada.slice(-4)}`, description: uniq(`XML02 ${rotulo} local ${rodada}`), type: "inputs" });
  const local = { id: arm.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]) };
  const top = (await criarTop(page, { codigo: codigoTop("x2t"), codigoBase: "compras.compra", nome: uniq(`Compra XML02 ${rotulo}`) })).id;

  const itens: ItemDaNotaDeVariosItens[] = [];
  const produtos: Partial<Record<PapelDoItem, ProdutoDoCaso>> = {};
  const n: Partial<Record<PapelDoItem, number>> = {};
  for (const [k, papel] of papeis.entries()) {
    const p = DO_PAPEL[papel];
    const codigo = `X02${papel}-${rodada}`;
    const ean = papel === "G" ? eanSintetico() : null;
    itens.push({ codigo, descricao: p.descricaoDaNota(tok), unidade: p.unidade, ncm: p.ncm, ean, quantidade: p.quantidade, valorUnitario: p.valorUnitario, valorProdutos: p.valorProdutos });
    n[papel] = k + 1;
    if (!p.produto) continue;
    const corpo: Record<string, unknown> = { description: p.produto(tok), group_id: ref.grupo.id, measurement_id: unidadeDe(p.unidade).id, financial_category_id: ref.natureza.id, ncm_code: p.ncm };
    if (papel === "G") corpo["barcode"] = ean;
    if (papel === "R") corpo["reference"] = codigo;
    const criado = await criarCadastro(page, "products", corpo);
    const row = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${criado.id}`);
    expect([row["description"], row["barcode"] ?? null, row["reference"] ?? null], `premissa: o produto do papel ${papel} gravou a descrição, o código de barras e a referência declarados`)
      .toEqual([p.produto(tok), papel === "G" ? ean : null, papel === "R" ? codigo : null]);
    produtos[papel] = { id: criado.id, codigo: String(row["code"] ?? ""), descricao: String(row["description"]) };
  }
  return { empresa, ref, unidadeDe, rodada, tok, emitente, fornecedor: forn.id, local, top, itens, produtos, n };
}
export type CenarioDaXml02 = Awaited<ReturnType<typeof cenarioDaXml02>>;

/** O produto do papel (o cenário o criou), ou o teste reprova. */
export function produtoDo(c: CenarioDaXml02, papel: PapelDoItem): ProdutoDoCaso {
  const p = c.produtos[papel];
  expect(p, `premissa: o cenário criou o produto do papel ${papel}`).toBeTruthy();
  return p!;
}
/** O nItem do papel na nota do caso, ou o teste reprova. */
export function itemDo(c: CenarioDaXml02, papel: PapelDoItem): number {
  const k = c.n[papel];
  expect(k, `premissa: a nota do caso tem o item do papel ${papel}`).toBeTruthy();
  return k!;
}

/* ═════════════════════════════════ a importação e a conferência ═════════════════════════════════ */

export interface VinculoNoFio { situacao: string; origem?: string; produto?: { id: string; codigo: string; descricao: string }; candidatos?: { id: string }[]; preenchimento?: Record<string, unknown> }
export interface ConferenciaNoFio {
  id: string; situacao: string; empresa: { id: string }; fornecedorEscolhido: string | null; parceiro: { situacao: string; id?: string };
  nota: { itens: { nItem: number; codigo: string; unidade: string; descricao: string }[] };
  itens: { nItem: number; vinculo: VinculoNoFio }[];
  capacidades?: unknown;
}

/** A nota do caso (os itens do cenário, ou outros com o mesmo emitente), importada pela API — a mesma porta da tela. */
export async function importarNota(page: Page, c: CenarioDaXml02, itens: ItemDaNotaDeVariosItens[] = c.itens): Promise<{ id: string; nota: NotaSinteticaDeVariosItens }> {
  const nota = notaSinteticaDeVariosItens({ emitenteCnpj: c.emitente, emitenteNome: `Emitente sintético ${uniq("XML02")}`, itens });
  const imp = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", {
    nome_arquivo: `nfe-${nota.numero}.xml`, arquivo_base64: Buffer.from(nota.xml, "utf8").toString("base64"), empresa_id: c.empresa
  });
  return { id: imp.id, nota };
}

export const lerConferencia = (page: Page, id: string) => api<ConferenciaNoFio>(page, "GET", `/api/compras/importacoes/${id}`);
export const vinculoDe = (conf: ConferenciaNoFio, nItem: number): VinculoNoFio => {
  const i = conf.itens.find((x) => x.nItem === nItem);
  expect(i, `premissa: a conferência traz o vínculo do item ${nItem}`).toBeTruthy();
  return i!.vinculo;
};
/** O vínculo como `[situação, origem, produto]` (o que os casos comparam). */
export const resumoDoVinculo = (v: VinculoNoFio) => [v.situacao, v.origem ?? null, v.produto?.id ?? null];

/**
 * Abre a conferência e devolve a resposta do GET que a PRÓPRIA tela fez (o fio). Com `top`, escolhe a TOP na aba
 * Cabeçalho; termina na aba Itens.
 */
export async function abrirConferencia(page: Page, id: string, top?: string): Promise<ConferenciaNoFio> {
  const leitura = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/importacoes/${id}`, { timeout: 20_000 });
  await page.goto(`/compras/importacoes/${id}`);
  const resposta = await leitura;
  expect(resposta.status(), "a tela leu a conferência (200)").toBe(200);
  const conf = (await resposta.json()) as ConferenciaNoFio;
  const raiz = page.getByTestId("importacao-conferencia");
  await expect(raiz, "a conferência desenhou, pendente").toHaveAttribute("data-situacao", "pendente");
  await expect(raiz).toHaveAttribute("data-relendo", "nao");
  await expect(page.getByText("A resposta do servidor não é a conferência que esta tela sabe ler."), "a tela leu a conferência").toHaveCount(0);
  if (top) await page.getByTestId("importacao-top").selectOption(top);
  await page.getByTestId("importacao-aba-itens-rotulo").click();
  await expect(page.getByTestId("importacao-aba-itens"), "a aba Itens abriu").toBeVisible();
  return conf;
}

/* ═════════════════════════════════ a tela ═════════════════════════════════ */

/**
 * Um seletor de referência dentro de `container` (por papel e texto): abre a caixa, digita a busca e escolhe a ÚNICA
 * opção que contém `rotulo`; no fim, a caixa mostra o rótulo escolhido.
 */
export async function escolherNoSeletor(page: Page, container: Locator, rotulo: string, nome: string) {
  await container.getByRole("combobox").click();
  const pesquisa = page.getByRole("textbox", { name: "Pesquisar opção" });
  await expect(pesquisa, `${nome}: o seletor abriu com a pesquisa`).toBeVisible();
  await pesquisa.fill(rotulo);
  const opcao = page.getByRole("listbox").getByRole("option", { name: new RegExp(escapar(rotulo)) });
  await expect(opcao, `${nome}: a busca oferece UMA opção "${rotulo}"`).toHaveCount(1);
  await opcao.click();
  await expect(container.getByRole("combobox"), `${nome}: a caixa ficou com a escolha`).toContainText(rotulo);
}

/** A caixa Produto do item. */
export const caixaDoProduto = (page: Page, nItem: number) => page.getByTestId(`importacao-item-${nItem}-produto`).getByRole("combobox");

/** O campo do formulário declarativo de rótulo `rotulo` dentro de `raiz`: o pai do `<label>` de texto exato (com o " *"). */
export const campoDoFormulario = (raiz: Locator, rotulo: string) => raiz.locator("label", { hasText: exato(rotulo, true) }).locator("..");

/**
 * O "Gerar compra" pela tela: o Local de cada item (`itensComLocal`), a natureza e o centro do documento na aba
 * Financeiro e o clique. Devolve o corpo que foi no fio, o status e a resposta.
 */
export async function gerarCompraPelaTela(page: Page, c: CenarioDaXml02, importacaoId: string, itensComLocal: readonly number[]) {
  for (const n of itensComLocal) await escolherNoSeletor(page, page.getByTestId(`importacao-item-${n}-local`), c.local.nome, `Local do item ${n}`);
  await page.getByTestId("importacao-aba-financeiro-rotulo").click();
  await escolherNoSeletor(page, page.getByTestId("importacao-natureza"), c.ref.natureza.label, "Natureza de despesa da compra");
  await escolherNoSeletor(page, page.getByTestId("importacao-centro"), c.ref.centro.label, "Centro de resultado da compra");
  const gerar = page.getByTestId("importacao-gerar-compra");
  await expect(gerar, "nada bloqueia o Gerar compra").toBeEnabled();
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/importacoes/${importacaoId}/gerar-compra`, { timeout: 30_000 });
  await gerar.click();
  const resposta = await post;
  const corpo = resposta.request().postDataJSON() as { fornecedor_id: string; itens: { n_item: number; produto_id: string; lembrar_vinculo?: boolean }[] };
  const texto = await resposta.text();
  return { status: resposta.status(), corpo, texto, compra: resposta.ok() ? (JSON.parse(texto) as { id: string; situacao: string; valor_total: string; importacao_id: string }) : null };
}

/** O que o corpo do Gerar mandou em cada item: `[n_item, produto_id, lembrar_vinculo]` (a chave ausente vira `null`). */
export const lembrarNoCorpo = (corpo: { itens: { n_item: number; produto_id: string; lembrar_vinculo?: boolean }[] }) =>
  corpo.itens.map((i) => [i.n_item, i.produto_id, Object.hasOwn(i, "lembrar_vinculo") ? i.lembrar_vinculo : null]);
