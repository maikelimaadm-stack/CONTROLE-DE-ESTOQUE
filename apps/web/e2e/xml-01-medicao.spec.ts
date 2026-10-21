import type { Locator, Page, Response } from "@playwright/test";
import { getResource } from "@agro/domain";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { test as testeDaCentral, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { cnpjDeEmitenteSintetico, eanSintetico, notaSinteticaDeVariosItens, type NotaSinteticaDeVariosItens } from "./compras-f7-nfe-sintetica";

/**
 * XML-01 (decisão 312) — A MEDIÇÃO: o gesto do operador na conferência de uma NF-e de 10 itens em que 6 produtos NÃO
 * existem no cadastro, "da conferência aberta até a compra gerada". O MESMO spec mede o ANTES (a base, sem o lote) e o
 * DEPOIS (com o lote): o caminho sai da CAPACIDADE que a conferência declara (`capacidades.criarProdutosDaNota`), nunca
 * de suposição — declarada, o botão do lote TEM de existir (premissa).
 *
 * ┌─ O QUE ESTE ARQUIVO REGISTRA (nenhum número é asserção) ────────────────────────────────────────────┐
 * │ N1 = cada interação, uma por uma, com tipo e nome: "diálogo aberto" (o clique que abre), "campo        │
 * │      preenchido" (um seletor escolhido = 1; uma caixa = 1), "botão clicado" (inclusive aba). O Salvar  │
 * │      recusado que DESCOBRE o obrigatório é marcado `descoberta` e somado à parte também.               │
 * │ N2 = dessas, o Grupo e a Unidade repetidos item a item (no diálogo de cada produto); a Natureza de     │
 * │      custo vai À PARTE (campo + clique de aba para chegar a ela), fora do N2.                          │
 * │ N3 = por produto criado, os campos que a NOTA ou a IMPORTAÇÃO já sabiam e o SISTEMA não preencheu:      │
 * │      description (xProd), ncm_code (NCM), barcode (cEAN), reference (cProd), measurement_id (uCom) e   │
 * │      default_warehouse_id (o local que o item já tinha). Diálogo: o formulário lido ao ABRIR, antes de │
 * │      tocar. Lote: a linha que o servidor gravou sem pergunta. A linha gravada é lida sempre (GET).     │
 * │ Saída: linhas `XML-MEDIDA …` no console e `test.info().annotations`.                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * As ASSERÇÕES são premissas anti-vácuo: o cenário é o declarado (parceiro encontrado; itens 1–4 sugeridos pelo
 * código de barras; 5–10 sem vínculo; total e parcelas da nota conferem), o gesto chegou ao fim (a compra nasceu
 * ABERTA com valor_total = vNF, os 10 itens com produto e o local) e cada produto criado foi lido do servidor.
 *
 * O XML é SINTÉTICO (`notaSinteticaDeVariosItens`: CNPJ, chave e EAN inventados, DVs calculados lá). Os cadastros do
 * caso (fornecedor, 4 produtos, Local, TOP) nascem pela API e são limpos pela fixture da Central; os 6 produtos que a
 * TELA cria são excluídos (lógica) pela fixture daqui, sempre — caso verde ou não. A compra e a importação ficam (ledger).
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const caminho = (r: Response) => new URL(r.url()).pathname;
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** O texto inteiro, exato (com o " *" do obrigatório opcional, quando é rótulo de campo). */
const exato = (t: string, obrigatorio = false) => new RegExp(`^${escapar(t)}${obrigatorio ? "(\\s*\\*)?" : ""}$`);
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A fixture desta medição: os produtos que a TELA criou (diálogo ou lote), excluídos (lógica) no fim do caso. */
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

/* ═════════════════════════════════ o cenário ═════════════════════════════════ */

/** Os 10 itens: unidades do sistema (o uCom vai em maiúsculas), NCM de 8 dígitos vigente do seed, vProd exato. */
const ITENS = [
  { unidade: "KG", ncm: "31052000", quantidade: "100.0000", valorUnitario: "2.50", valorProdutos: "250.00" },
  { unidade: "SC", ncm: "31053000", quantidade: "20", valorUnitario: "95.00", valorProdutos: "1900.00" },
  { unidade: "UN", ncm: "23099090", quantidade: "12", valorUnitario: "15.00", valorProdutos: "180.00" },
  { unidade: "L", ncm: "38085929", quantidade: "50", valorUnitario: "8.40", valorProdutos: "420.00" },
  { unidade: "CX", ncm: "31054000", quantidade: "10", valorUnitario: "32.00", valorProdutos: "320.00" },
  { unidade: "KG", ncm: "31051000", quantidade: "250", valorUnitario: "1.80", valorProdutos: "450.00" },
  { unidade: "TON", ncm: "31056000", quantidade: "2", valorUnitario: "1250.00", valorProdutos: "2500.00" },
  { unidade: "UN", ncm: "23099010", quantidade: "30", valorUnitario: "4.50", valorProdutos: "135.00" },
  { unidade: "SC", ncm: "31055900", quantidade: "15", valorUnitario: "110.00", valorProdutos: "1650.00" },
  { unidade: "L", ncm: "23091000", quantidade: "40", valorUnitario: "12.25", valorProdutos: "490.00" }
] as const;
const EXISTENTES = [1, 2, 3, 4];
const FALTANTES = [5, 6, 7, 8, 9, 10];

interface ConferenciaLida {
  id: string; situacao: string; empresa: { id: string }; fornecedorEscolhido: string | null;
  parceiro: { situacao: string; id?: string };
  nota: { totais: { nota: string }; itens: { nItem: number; codigo: string; ean: string | null; ncm: string | null; unidade: string; descricao: string }[] };
  itens: { nItem: number; vinculo: { situacao: string; origem?: string; produto?: { id: string } } }[];
  financeiro: { parcelas: { situacao: string } };
  /** XML-01: a API com o lote declara `criarProdutosDaNota: 1`; a anterior não declara. */
  capacidades?: Record<string, unknown>;
}

async function cenario(page: Page) {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const portas = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/compras/compras/operation-types");
  expect(portas.capacidades?.["importacaoXml"], "premissa: a API declara capacidades.importacaoXml = 1").toBe(1);
  const todasAsUnidades = await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options");
  const unidadeDe = (uCom: string): Opcao => {
    const achadas = todasAsUnidades.filter((u) => u.label.toUpperCase() === uCom.toUpperCase());
    expect(achadas.map((u) => u.label), `premissa: o seed tem UMA unidade ${uCom}`).toHaveLength(1);
    return achadas[0]!;
  };

  const rodada = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const emitente = cnpjDeEmitenteSintetico();
  const forn = await criarCadastro(page, "people", { name: uniq("XML01 forn"), person_type: "legal", is_provider: true, document: emitente });
  const arm = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `M${rodada.slice(-4)}`, description: uniq(`XML01 local ${rodada}`), type: "inputs" });
  const local = { id: arm.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]) };
  const top = (await criarTop(page, { codigo: codigoTop("x1"), codigoBase: "compras.compra", nome: uniq("Compra XML01") })).id;

  const eans = ITENS.map(() => eanSintetico());
  const nota = notaSinteticaDeVariosItens({
    emitenteCnpj: emitente, emitenteNome: `Emitente sintético ${uniq("XML01")}`,
    itens: ITENS.map((i, k) => ({ ...i, codigo: `X01-${rodada}-${String(k + 1).padStart(2, "0")}`, descricao: `XML01 insumo ${k + 1} ${rodada}`, ean: eans[k]! }))
  });
  // OS 4 EXISTENTES: o código de barras é o EAN do item (o vínculo nasce "sugerido" pelo código de barras)
  const existentes = new Map<number, string>();
  for (const n of EXISTENTES) {
    const item = nota.itens[n - 1]!;
    const p = await criarCadastro(page, "products", {
      description: `XML01 existente ${n} ${rodada}`, group_id: ref.grupo.id, measurement_id: unidadeDe(item.unidade).id, financial_category_id: ref.natureza.id, barcode: item.ean
    });
    existentes.set(n, p.id);
  }
  return { empresa, ref, unidadeDe, fornecedor: forn.id, local, top, nota, existentes };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;

/* ═════════════════════════════════ a contagem ═════════════════════════════════ */

type TipoDeInteracao = "diálogo aberto" | "campo preenchido" | "botão clicado";
interface Interacao { n: number; tipo: TipoDeInteracao; nome: string; etapa: string; campo?: string; descoberta?: boolean }

class Medida {
  readonly interacoes: Interacao[] = [];
  etapa = "";
  registrar(tipo: TipoDeInteracao, nome: string, extra: { campo?: string } = {}): Interacao {
    const i: Interacao = { n: this.interacoes.length + 1, tipo, nome, etapa: this.etapa, ...extra };
    this.interacoes.push(i);
    console.log(`XML-MEDIDA interacao ${i.n} | ${i.tipo} | ${i.nome} | etapa: ${i.etapa}`);
    return i;
  }
}

/** Um clique contado. */
async function clicar(m: Medida, alvo: Locator, tipo: "diálogo aberto" | "botão clicado", nome: string, extra: { campo?: string } = {}) {
  await alvo.click();
  return m.registrar(tipo, nome, extra);
}

/** Um seletor de referência (RefSelect) dentro de `container`: abre, pesquisa e escolhe a opção de rótulo EXATO = 1 campo. */
async function escolher(m: Medida, page: Page, container: Locator, rotuloDaOpcao: string, nome: string, extra: { campo?: string } = {}) {
  await container.locator("[role='combobox']").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(rotuloDaOpcao);
  await painel.getByRole("option").filter({ has: page.locator("span.truncate", { hasText: exato(rotuloDaOpcao) }) }).first().click();
  await expect(container.locator("[role='combobox']").first(), `${nome}: o seletor ficou com a escolha`).not.toHaveClass(/is-empty/);
  return m.registrar("campo preenchido", nome, extra);
}

/** O seletor (RefSelect) está vazio? (a caixa traz `is-empty`). */
const seletorVazio = async (combo: Locator) => ((await combo.getAttribute("class")) ?? "").split(/\s+/).includes("is-empty");

/** Espera um POST no caminho, sem lançar no tempo esgotado (null). */
const postEm = (page: Page, alvo: string, timeout = 8_000) => page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === alvo, { timeout }).catch(() => null);

/* ═════════════════════════════════ o N3 ═════════════════════════════════ */

const CANDIDATOS = ["description", "ncm_code", "barcode", "reference", "measurement_id", "default_warehouse_id"] as const;
type Candidato = (typeof CANDIDATOS)[number];
const DEF_PRODUTO = getResource("products");
const rotuloDe = (campo: string) => DEF_PRODUTO?.fields.find((f) => f.name === campo)?.label ?? campo;

/** A caixa do campo (B1Field) de rótulo `rotulo` dentro de `raiz`: o pai do `<label>` de texto exato (com o " *"). */
const campoDoFormulario = (raiz: Locator, rotulo: string) => raiz.locator("label", { hasText: exato(rotulo, true) }).locator("..");

/** O que o formulário do produto TRAZ ao abrir, antes de qualquer toque (texto; null = vazio). */
async function preenchidoAoAbrir(dialogo: Locator): Promise<Record<Candidato, string | null>> {
  const caixa = async (nome: string) => { const l = dialogo.locator(`input[name="${nome}"]`); return (await l.count()) ? (await l.first().inputValue()).trim() || null : null; };
  const seletor = async (campo: string) => {
    const combo = campoDoFormulario(dialogo, rotuloDe(campo)).locator("[role='combobox']").first();
    if (!(await combo.count()) || (await seletorVazio(combo))) return null;
    return ((await combo.textContent()) ?? "").trim() || "(escolhido)";
  };
  const ncm = dialogo.getByTestId("ref-ncm-codigo");
  return {
    description: await caixa("description"),
    ncm_code: (await ncm.count()) ? (await ncm.first().inputValue()).trim() || null : null,
    barcode: await caixa("barcode"),
    reference: await caixa("reference"),
    measurement_id: await seletor("measurement_id"),
    default_warehouse_id: await seletor("default_warehouse_id")
  };
}

interface CampoDoN3 { campo: Candidato; notaSabia: string; preenchido: string | null; gravado: string | null; faltou: boolean }
interface ProdutoDoN3 { nItem: number; produtoId: string; codigo: string; campos: CampoDoN3[]; n3: number }

/** O que a NOTA (ou a IMPORTAÇÃO, no local) já sabia de cada candidato do item. */
function oQueANotaSabia(c: Cenario, nItem: number): Record<Candidato, string> {
  const i = c.nota.itens[nItem - 1]!;
  return {
    description: i.descricao.slice(0, 120), ncm_code: i.ncm, barcode: i.ean ?? "", reference: i.codigo,
    measurement_id: c.unidadeDe(i.unidade).id, default_warehouse_id: c.local.id
  };
}

/* ═════════════════════════════════ o caminho de HOJE: um diálogo por item ═════════════════════════════════ */

async function criarPeloDialogo(m: Medida, page: Page, c: Cenario, nItem: number, ids: Set<string>): Promise<{ produtoId: string; preenchido: Record<Candidato, string | null> }> {
  m.etapa = `produto do item ${nItem}`;
  await clicar(m, page.getByTestId(`importacao-item-${nItem}-criar-produto`), "diálogo aberto", `Criar produto (item ${nItem})`);
  const dialogo = page.getByTestId("importacao-cadastro-products");
  await expect(dialogo, "premissa: o diálogo do cadastro de produto abriu").toBeVisible();
  await expect(dialogo.getByTestId("b1-form"), "premissa: o formulário do produto carregou").toBeVisible();
  await expect(dialogo.locator("input[name='description']"), "premissa: o formulário tem a Descrição").toBeAttached();
  const preenchido = await preenchidoAoAbrir(dialogo);
  console.log(`XML-MEDIDA preenchido-ao-abrir item ${nItem} | ${JSON.stringify(preenchido)}`);

  const unidade = c.unidadeDe(c.nota.itens[nItem - 1]!.unidade);
  const resposta: Record<string, string> = { group_id: c.ref.grupo.label, measurement_id: unidade.label, financial_category_id: c.ref.natureza.label };
  const porRotulo = new Map((DEF_PRODUTO?.fields ?? []).map((f) => [f.label, f]));
  const salvar = dialogo.getByRole("button", { name: "Salvar", exact: true });
  // o rótulo de cada caixa que a validação marcou (`is-invalid` na caixa do B1Field)
  const invalidos = dialogo.locator(".is-invalid > label");

  for (let rodada = 1; rodada <= 5; rodada++) {
    // o Salvar que passa na tela ENVIA logo (a validação do formulário é local): sem POST na janela, a tela recusou
    const enviou = page.waitForRequest((q) => q.method() === "POST" && new URL(q.url()).pathname === "/api/resources/products", { timeout: 2_500 }).catch(() => null);
    const clique = await clicar(m, salvar, "botão clicado", "Salvar (diálogo do produto)");
    const pedido = await enviou;
    const r = pedido ? await pedido.response() : null;
    if (pedido) expect(r, "premissa: o POST do produto teve resposta").not.toBeNull();
    let pendentes: string[];
    if (r) {
      if (r.status() === 201) {
        const row = (await r.json()) as { id: string };
        ids.add(row.id);
        await expect(dialogo, "o diálogo fecha depois do 201").toBeHidden();
        return { produtoId: row.id, preenchido };
      }
      const corpo = (await r.json().catch(() => ({}))) as { error?: { message?: string; details?: { path?: string; message?: string }[] } };
      pendentes = (corpo.error?.details ?? []).map((d) => String(d.path ?? "")).filter(Boolean);
      console.log(`XML-MEDIDA recusa-do-servidor item ${nItem} | ${r.status()} | ${JSON.stringify(corpo.error ?? {})}`);
      if (!pendentes.length) throw new Error(`o cadastro do produto do item ${nItem} foi recusado sem campo: ${r.status()} ${corpo.error?.message ?? ""}`);
    } else {
      // a recusa da TELA: os campos marcados como inválidos (rótulo → campo do registry)
      await expect(invalidos.first(), `premissa: o Salvar recusado (rodada ${rodada}) marca o campo que falta`).toBeAttached();
      const rotulos = (await invalidos.allTextContents()).map((t) => t.replace(/\s*\*\s*$/, "").trim());
      pendentes = rotulos.map((t) => porRotulo.get(t)?.name ?? `?${t}`);
      const aviso = page.getByText("Campos obrigatórios pendentes").first();
      console.log(`XML-MEDIDA descoberta item ${nItem} rodada ${rodada} | campos apontados: ${rotulos.join(", ")}${(await aviso.count()) ? " | aviso: Campos obrigatórios pendentes" : ""}`);
    }
    clique.descoberta = true;
    for (const campo of pendentes) {
      const rotulo = rotuloDe(campo);
      const opcao = resposta[campo];
      const def = DEF_PRODUTO?.fields.find((f) => f.name === campo);
      if (!opcao || def?.type !== "ref") throw new Error(`campo obrigatório que a medição não sabe preencher no produto do item ${nItem}: ${campo} (${rotulo})`);
      const alvo = campoDoFormulario(dialogo, rotulo);
      await expect(alvo, `o campo apontado (${rotulo}) existe no formulário`).toHaveCount(1);
      if (!(await alvo.isVisible())) {
        // o campo mora em outra aba do formulário: a aba do corpo que o contém. O corpo é o irmão do trilho que tem a
        // lista de abas (`role="tablist"`); a ordem dos corpos = a ordem das abas
        const indice = await alvo.evaluate((el) => {
          let p: Element | null = el;
          while (p && p.parentElement) {
            const pai: Element = p.parentElement;
            const atual: Element = p;
            const trilho = Array.from(pai.children).find((x) => x !== atual && (x.matches("[role='tablist']") || x.querySelector("[role='tablist']") !== null));
            if (trilho) return Array.from(pai.children).filter((x) => x !== trilho).indexOf(p);
            p = pai;
          }
          return -1;
        });
        expect(indice, `a aba do campo ${rotulo} foi achada`).toBeGreaterThanOrEqual(0);
        const aba = dialogo.getByRole("tab").nth(indice);
        const nomeDaAba = ((await aba.textContent()) ?? "").trim();
        await clicar(m, aba, "botão clicado", `aba "${nomeDaAba}" do formulário do produto`, { campo });
        await expect(alvo).toBeVisible();
      }
      await escolher(m, page, alvo, opcao, `${rotulo} (produto do item ${nItem})`, { campo });
    }
  }
  throw new Error(`o produto do item ${nItem} não foi criado em 5 rodadas`);
}

/* ═════════════════════════════════ o caminho do LOTE (XML-01) ═════════════════════════════════ */

interface ProdutosCriados { importacao_id: string; produtos: { id: string; codigo: string; descricao: string }[]; itens: { nItem: number; produto: { id: string }; localPadrao: string | null }[] }

async function criarPeloLote(m: Medida, page: Page, c: Cenario, importacaoId: string, ids: Set<string>): Promise<ProdutosCriados> {
  m.etapa = "lote";
  const botao = page.getByTestId("importacao-criar-produtos");
  await expect(botao, "premissa: com a capacidade declarada, o botão do lote existe").toBeVisible();
  const quantidade = await botao.getAttribute("data-quantidade");
  console.log(`XML-MEDIDA lote data-quantidade = ${quantidade}`);
  expect(quantidade, "premissa: o lote cria os 6 produtos que faltam").toBe(String(FALTANTES.length));
  await clicar(m, botao, "diálogo aberto", "Criar os produtos da nota (lote)");
  const dialogo = page.getByTestId("importacao-criar-produtos-dialogo");
  await expect(dialogo, "premissa: o diálogo do lote abriu").toBeVisible();
  for (const n of FALTANTES) await expect(dialogo.getByTestId(`importacao-criar-produtos-item-${n}`), `premissa: o item ${n} está na lista do lote`).toBeVisible();
  await expect(dialogo.locator("[data-testid^='importacao-criar-produtos-fora-']"), "premissa: nenhum item fica de fora (os 6 têm unidade)").toHaveCount(0);
  // a marca do item, quando é uma caixa desmarcada, é uma decisão que a tela pede
  for (const n of FALTANTES) {
    const marca = dialogo.getByTestId(`importacao-criar-produtos-item-${n}-marcado`);
    if (!(await marca.count())) continue;
    const caixa = await marca.evaluate((el) => el instanceof HTMLInputElement && el.type === "checkbox");
    if (caixa && !(await marca.isChecked())) { await marca.check(); m.registrar("campo preenchido", `marcar o item ${n} no lote`); }
  }
  for (const [testId, campo, opcao] of [["importacao-criar-produtos-grupo", "group_id", c.ref.grupo.label], ["importacao-criar-produtos-natureza", "financial_category_id", c.ref.natureza.label]] as const) {
    const container = dialogo.getByTestId(testId);
    await expect(container, `premissa: o diálogo do lote pergunta ${rotuloDe(campo)}`).toBeVisible();
    if (await seletorVazio(container.locator("[role='combobox']").first())) await escolher(m, page, container, opcao, `${rotuloDe(campo)} (lote, uma vez para a nota)`, { campo });
  }
  const post = postEm(page, `/api/compras/importacoes/${importacaoId}/criar-produtos`, 15_000);
  await clicar(m, dialogo.getByTestId("importacao-criar-produtos-confirmar"), "botão clicado", "Confirmar (lote)");
  const r = await post;
  expect(r, "premissa: o confirmar chamou a rota do lote").not.toBeNull();
  const enviado = r!.request().postDataJSON() as Record<string, unknown>;
  console.log(`XML-MEDIDA lote corpo enviado | ${JSON.stringify(enviado)}`);
  if (r!.status() !== 201) {
    const erro = await dialogo.getByTestId("importacao-criar-produtos-erro").textContent().catch(() => null);
    throw new Error(`o lote foi recusado: ${r!.status()} ${(await r!.text()).slice(0, 400)} | tela: ${erro ?? "—"}`);
  }
  const corpo = (await r!.json()) as ProdutosCriados;
  for (const p of corpo.produtos) ids.add(p.id);
  await expect(dialogo, "o diálogo do lote fecha depois do 201").toBeHidden();
  return corpo;
}

/* ═════════════════════════════════ a medição ═════════════════════════════════ */

test("XML-01 MEDIÇÃO — conferência de 10 itens com 6 produtos inexistentes: da conferência aberta até a compra gerada (N1, N2, N3)", async ({ page, produtosDaTela }) => {
  test.setTimeout(300_000);
  await login(page);
  const c = await cenario(page);
  const nota: NotaSinteticaDeVariosItens = c.nota;

  // A IMPORTAÇÃO pela API (a mesma porta da tela), com a empresa ativa
  const imp = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", { nome_arquivo: `nfe-${nota.numero}.xml`, arquivo_base64: Buffer.from(nota.xml, "utf8").toString("base64"), empresa_id: c.empresa });
  const conf = await api<ConferenciaLida>(page, "GET", `/api/compras/importacoes/${imp.id}`);
  // PREMISSAS DO CENÁRIO (o servidor confirma o que o caso montou)
  expect(conf, "premissa: a importação pendente, da empresa ativa, com o fornecedor encontrado pelo emitente")
    .toMatchObject({ situacao: "pendente", empresa: { id: c.empresa }, parceiro: { situacao: "encontrado", id: c.fornecedor }, fornecedorEscolhido: c.fornecedor });
  expect(conf.nota.totais.nota, "premissa: o vNF é a soma dos itens").toBe(nota.vNF);
  expect(conf.financeiro.parcelas.situacao, "premissa: as duplicatas da nota conferem").toBe("conferem");
  expect(conf.nota.itens.map((i) => [i.nItem, i.ean, i.ncm, i.unidade]), "premissa: os 10 itens com EAN, NCM e unidade da nota")
    .toEqual(nota.itens.map((i) => [i.nItem, i.ean, i.ncm, i.unidade.toUpperCase()]));
  expect(conf.itens.map((i) => [i.nItem, i.vinculo.situacao, i.vinculo.origem ?? null, i.vinculo.produto?.id ?? null]), "premissa: 1–4 sugeridos pelo código de barras; 5–10 sem vínculo")
    .toEqual(nota.itens.map((i) => (EXISTENTES.includes(i.nItem) ? [i.nItem, "sugerido", "codigo_barras", c.existentes.get(i.nItem)!] : [i.nItem, "nenhum", null, null])));
  const capacidade = conf.capacidades?.["criarProdutosDaNota"] ?? null;
  const comLote = capacidade === 1;
  console.log(`XML-MEDIDA capacidade criarProdutosDaNota = ${JSON.stringify(capacidade)} | caminho = ${comLote ? "lote" : "por item"}`);

  // A CONFERÊNCIA ABERTA: aqui começa a medida
  await page.goto(`/compras/importacoes/${imp.id}`);
  const raiz = page.getByTestId("importacao-conferencia");
  await expect(raiz).toHaveAttribute("data-situacao", "pendente");
  await expect(raiz).toHaveAttribute("data-relendo", "nao");
  const selectTop = page.getByTestId("importacao-top");
  await expect(selectTop, "premissa: as TOPs de compra carregaram").toBeVisible();
  const gerar = page.getByTestId("importacao-gerar-compra");
  await expect(gerar, "premissa: com 6 itens sem produto, Gerar compra começa travado").toBeDisabled();
  const inicio = Date.now();
  const m = new Medida();

  // 1. a TOP, se a tela não a trouxe
  m.etapa = "TOP";
  // a TOP padrão da espécie entra num efeito logo depois das TOPs carregarem: a leitura espera o efeito assentar
  await page.waitForTimeout(500);
  const topDaTela = await selectTop.inputValue();
  console.log(`XML-MEDIDA TOP trazida pela tela = ${topDaTela || "(nenhuma)"}`);
  if (!topDaTela) { await selectTop.selectOption(c.top); m.registrar("campo preenchido", "TOP de compra"); }

  // 2. o LOCAL de cada um dos 10 itens (antes de criar produto)
  m.etapa = "locais";
  await clicar(m, page.getByTestId("importacao-aba-itens-rotulo"), "botão clicado", "aba Itens, vínculos e lotes");
  for (const i of nota.itens) {
    await expect(page.getByTestId(`importacao-item-${i.nItem}`)).toHaveAttribute("data-vinculo", EXISTENTES.includes(i.nItem) ? "sugerido" : "nenhum");
    await escolher(m, page, page.getByTestId(`importacao-item-${i.nItem}-local`), c.local.nome, `Local de estoque (item ${i.nItem})`, { campo: "armazem_id" });
  }

  // 3. os produtos que faltam
  const criados = new Map<number, { produtoId: string; preenchido: Record<Candidato, string | null> | null }>();
  if (comLote) {
    const lote = await criarPeloLote(m, page, c, imp.id, produtosDaTela);
    expect(lote.itens.map((i) => i.nItem), "premissa: a resposta do lote traz os 6 itens confirmados, na ordem da nota").toEqual(FALTANTES);
    for (const i of lote.itens) criados.set(i.nItem, { produtoId: i.produto.id, preenchido: null });
  } else {
    for (const n of FALTANTES) criados.set(n, await criarPeloDialogo(m, page, c, n, produtosDaTela));
  }
  expect(new Set([...criados.values()].map((x) => x.produtoId)).size, "premissa: 6 produtos distintos foram criados").toBe(FALTANTES.length);

  // 4. o que a conferência ainda listar como pendência que bloqueia — a primeira, e repete
  m.etapa = "pendências";
  for (let rodada = 1; rodada <= 6; rodada++) {
    const livre = await expect(gerar).toBeEnabled({ timeout: 5_000 }).then(() => true, () => false);
    if (livre) break;
    await clicar(m, page.getByTestId("importacao-aba-divergencias-rotulo"), "botão clicado", "aba Divergências");
    const primeira = page.locator("[data-testid='importacao-divergencia'][data-bloqueia='sim']").first();
    await expect(primeira, "o Gerar travado tem uma pendência que bloqueia listada").toBeVisible();
    const codigo = await primeira.getAttribute("data-codigo");
    const texto = ((await primeira.textContent()) ?? "").trim();
    console.log(`XML-MEDIDA pendência rodada ${rodada} | ${codigo} | ${texto}`);
    if (codigo === "top") {
      await clicar(m, page.getByTestId("importacao-aba-cabecalho-rotulo"), "botão clicado", "aba Cabeçalho");
      await selectTop.selectOption(c.top); m.registrar("campo preenchido", "TOP de compra");
      continue;
    }
    throw new Error(`pendência que a medição não sabe resolver: ${codigo} — ${texto}`);
  }

  // 5. Gerar compra, até o 201. A recusa do servidor (422) aponta UM campo; a tela leva à aba dele: preenche-se o
  //    apontado e gera de novo (o clique recusado é marcado `descoberta`). Só os campos que esta medição conhece.
  m.etapa = "gerar";
  const RECUSA_DO_GERAR: Record<string, { aba: string; testId: string; opcao: string; nome: string }> = {};
  let resposta: Response | null = null;
  for (let rodada = 1; rodada <= 6 && !resposta; rodada++) {
    await expect(gerar, "premissa: sem pendência da tela, Gerar compra libera").toBeEnabled();
    const postGerar = postEm(page, `/api/compras/importacoes/${imp.id}/gerar-compra`, 20_000);
    const clique = await clicar(m, gerar, "botão clicado", "Gerar compra");
    const r = await postGerar;
    expect(r, "premissa: o Gerar chamou o servidor").not.toBeNull();
    if (r!.status() === 201) { resposta = r; break; }
    clique.descoberta = true;
    const corpo = (await r!.json().catch(() => ({}))) as { error?: { message?: string; details?: { path?: string; message?: string }[] } };
    const apontado = String(corpo.error?.details?.[0]?.path ?? "");
    console.log(`XML-MEDIDA recusa-do-gerar rodada ${rodada} | ${r!.status()} | ${apontado} | ${corpo.error?.message ?? ""}`);
    const alvo = RECUSA_DO_GERAR[apontado];
    if (r!.status() !== 422 || !alvo) {
      const recusas = await page.getByTestId("importacao-recusa-do-servidor").allTextContents().catch(() => []);
      throw new Error(`o Gerar compra foi recusado num ponto que a medição não sabe resolver: ${r!.status()} ${JSON.stringify(corpo.error ?? {})} | tela: ${recusas.join(" · ")}`);
    }
    const container = page.getByTestId(alvo.testId);
    if (!(await container.isVisible())) await clicar(m, page.getByTestId(`importacao-aba-${alvo.aba}-rotulo`), "botão clicado", `aba ${alvo.aba} (a recusa do Gerar)`);
    await expect(container, `a recusa leva ao campo apontado (${apontado})`).toBeVisible();
    await escolher(m, page, container, alvo.opcao, alvo.nome, { campo: apontado });
  }
  expect(resposta, "premissa: a compra foi gerada (201) em até 6 rodadas").not.toBeNull();
  const duracao = Date.now() - inicio;
  const enviado = resposta!.request().postDataJSON() as { itens: { n_item: number; produto_id: string; armazem_id: string | null }[] };
  const compra = (await resposta!.json()) as { id: string; codigo: string; situacao: string; valor_total: string; importacao_id: string };
  // PREMISSAS DO FIM: a compra nasceu ABERTA, com o total da nota, os 10 itens com produto e o local
  expect(compra, "premissa: a compra nasce aberta, valor_total = vNF").toMatchObject({ situacao: "aberto", valor_total: nota.vNF, importacao_id: imp.id });
  expect(enviado.itens.map((i) => [i.n_item, i.produto_id, i.armazem_id]), "premissa: os 10 itens com o produto (existente ou criado) e o local decidido")
    .toEqual(nota.itens.map((i) => [i.nItem, EXISTENTES.includes(i.nItem) ? c.existentes.get(i.nItem)! : criados.get(i.nItem)!.produtoId, c.local.id]));
  const depois = await api<{ situacao: string; documentoCompra: { id: string } | null }>(page, "GET", `/api/compras/importacoes/${imp.id}`);
  expect(depois, "premissa: a importação ficou gerada, ligada à compra").toMatchObject({ situacao: "gerada", documentoCompra: { id: compra.id } });

  /* ── N3: a linha GRAVADA de cada produto criado × o que a nota/importação sabiam ── */
  const n3: ProdutoDoN3[] = [];
  for (const n of FALTANTES) {
    const criado = criados.get(n)!;
    const row = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${criado.produtoId}`);
    expect(row["id"], `premissa: o produto do item ${n} foi lido do servidor`).toBe(criado.produtoId);
    const sabia = oQueANotaSabia(c, n);
    const campos: CampoDoN3[] = CANDIDATOS.map((campo) => {
      const gravado = row[campo] === null || row[campo] === undefined || row[campo] === "" ? null : String(row[campo]);
      // diálogo: o que o formulário trouxe ao abrir (e, se trouxe, o que ficou gravado tem de ser o que a nota sabia);
      // lote: o que o servidor gravou sem pergunta
      const preenchido = criado.preenchido ? criado.preenchido[campo] : gravado;
      const faltou = preenchido === null || gravado !== sabia[campo];
      return { campo, notaSabia: sabia[campo], preenchido, gravado, faltou };
    });
    // o operador NÃO tocou nos candidatos que já vieram: o que ele preencheu no diálogo foi a unidade (N3 conta igual)
    n3.push({ nItem: n, produtoId: criado.produtoId, codigo: String(row["code"] ?? ""), campos, n3: campos.filter((x) => x.faltou).length });
  }

  /* ── o relatório ── */
  const lista = m.interacoes;
  const porTipo = (t: TipoDeInteracao) => lista.filter((i) => i.tipo === t).length;
  const descobertas = lista.filter((i) => i.descoberta).length;
  const doDialogoDoItem = (campo: string) => lista.filter((i) => i.etapa.startsWith("produto do item") && i.campo === campo && i.tipo === "campo preenchido").length;
  const grupoRepetido = doDialogoDoItem("group_id"); const unidadeRepetida = doDialogoDoItem("measurement_id");
  const naturezaCampos = lista.filter((i) => i.campo === "financial_category_id" && i.tipo === "campo preenchido").length;
  const naturezaAbas = lista.filter((i) => i.campo === "financial_category_id" && i.tipo === "botão clicado").length;
  const grupoNoLote = lista.filter((i) => i.etapa === "lote" && i.campo === "group_id").length;
  const totalN3 = n3.reduce((a, p) => a + p.n3, 0);

  const linhas = [
    `caminho = ${comLote ? "lote" : "por item"} | capacidade criarProdutosDaNota = ${JSON.stringify(capacidade)} | TOP trazida pela tela = ${topDaTela ? "sim" : "não"}`,
    `N1 = ${lista.length} (diálogo aberto ${porTipo("diálogo aberto")}, campo preenchido ${porTipo("campo preenchido")}, botão clicado ${porTipo("botão clicado")}) | das quais ${descobertas} de descoberta (Salvar/Gerar recusado: ${lista.filter((i) => i.descoberta).map((i) => `#${i.n}`).join(" ")}) | sem elas = ${lista.length - descobertas}`,
    `N2 (Grupo + Unidade repetidos item a item) = ${grupoRepetido + unidadeRepetida} (Grupo ${grupoRepetido}, Unidade ${unidadeRepetida}) | Grupo perguntado uma vez para a nota (lote) = ${grupoNoLote}`,
    `Natureza de custo (à parte, fora do N2) = ${naturezaCampos} campo(s) + ${naturezaAbas} clique(s) de aba para chegar a ela`,
    ...n3.map((p) => `N3 item ${p.nItem} (produto ${p.codigo}) = ${p.n3} | faltaram: ${p.campos.filter((x) => x.faltou).map((x) => x.campo).join(", ") || "nenhum"} | vieram: ${p.campos.filter((x) => !x.faltou).map((x) => x.campo).join(", ") || "nenhum"}`),
    `N3 total = ${totalN3} (${n3.length} produtos × ${CANDIDATOS.length} candidatos)`,
    `tempo da conferência até o 201 (informativo, não é medida) = ${duracao} ms`,
    `compra ${compra.codigo} | situacao ${compra.situacao} | valor_total ${compra.valor_total} | vNF ${nota.vNF}`
  ];
  for (const l of linhas) { console.log(`XML-MEDIDA ${l}`); test.info().annotations.push({ type: "XML-MEDIDA", description: l }); }
  for (const p of n3) for (const x of p.campos) console.log(`XML-MEDIDA N3-detalhe item ${p.nItem} | ${x.campo} | nota sabia: ${x.notaSabia} | preenchido: ${x.preenchido ?? "(vazio)"} | gravado: ${x.gravado ?? "(vazio)"} | ${x.faltou ? "FALTOU" : "veio"}`);
  test.info().annotations.push({ type: "XML-MEDIDA interacoes", description: JSON.stringify(lista) });
  test.info().annotations.push({ type: "XML-MEDIDA N3", description: JSON.stringify(n3) });
});
