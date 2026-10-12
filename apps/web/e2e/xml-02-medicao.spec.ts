import type { Page, Response } from "@playwright/test";
import { login, api, uniq, empresaAtiva } from "./helpers";
import { test, expect, criarCadastro, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";
import { cnpjDeEmitenteSintetico, eanSintetico, notaSinteticaDeVariosItens } from "./compras-f7-nfe-sintetica";

/**
 * XML-02 (decisão 314) — A MEDIÇÃO: "o item da nota encontra o produto que já existe". Uma NF-e de 12 itens de UM
 * fornecedor contra um cadastro montado pelo próprio caso; o MESMO spec mede o ANTES (a base) e o DEPOIS (a fatia).
 *
 * ┌─ O CENÁRIO (a nota da fase 0) ──────────────────────────────────────────────────────────────────────────┐
 * │ G1..G4  produto com `barcode` = o cEAN do item (GTIN-13 válido)          → identidade: código de barras   │
 * │ M1..M4  produto cadastrado À MÃO: sem barcode, sem produto_fornecedores, sem vínculo lembrado, sem        │
 * │         reference; a descrição da nota difere por acento, hífen, ordem, espaço duplo e sufixo de embalagem │
 * │ R1, R2  produto com `reference` = o cProd do item, sem barcode, descrição sem nada em comum com a nota     │
 * │ N1, N2  item SEM produto no cadastro                                                                     │
 * │ + os 5 DISTRATORES do cadastro (o perigoso do M1 é "RAÇÃO BOVINA LACTAÇÃO"). O fornecedor é NOVO a cada   │
 * │   execução (nada lembrado, nenhum produto_fornecedores).                                                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AS MEDIDAS (lidas da resposta da conferência que a TELA recebeu; nenhuma é asserção) ─────────────────────┐
 * │ D1 = itens lembrado + sugerido · D2 = itens ambiguo (e quantos candidatos cada) · D3 = itens nenhum         │
 * │ D4 = as interações do operador, NA TELA (aba "Itens, vínculos e lotes"), para dar o produto certo aos      │
 * │      itens que TÊM produto no cadastro e não vieram com ele (M1..M4, R1, R2). A REGRA DE CONTAGEM:         │
 * │        · cada gesto que o teste executa no cartão do item conta 1:                                        │
 * │            "abrir o seletor"  = o clique na caixa Produto do item                                         │
 * │            "digitar a busca"  = preencher a caixa "Pesquisar opção" (o texto inteiro conta 1, não 1/tecla) │
 * │            "escolher"         = o clique na opção da lista OU num botão de candidato do ambíguo           │
 * │        · o item que JÁ VEM com o produto certo (lembrado/sugerido) não pede gesto nenhum: 0               │
 * │        · ambíguo com o produto certo entre os candidatos (botão na tela): 1 (escolher o candidato)        │
 * │        · nenhum, ambíguo sem o certo ou sugerido com o produto ERRADO: 3 (abrir + digitar + escolher)     │
 * │        · a ida à aba Itens (1 clique) é a mesma no antes e no depois: registrada À PARTE, fora do D4      │
 * │        · os G1..G4 passam pelo MESMO procedimento (a contagem deles sai à parte; esperado 0) e N1/N2 não  │
 * │          entram (não há produto a escolher)                                                               │
 * │      A conta é a dos gestos EXECUTADOS (registrados um a um), nunca uma fórmula.                          │
 * │ Saída: UMA linha estável `MEDICAO XML-02 {json}` (sem id, sem sorteio) e `test.info().annotations`.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * As ASSERÇÕES são o que vale no antes E no depois (premissas anti-vácuo): a API declara a importação; a conferência
 * pendente, da empresa ativa, com o fornecedor encontrado pelo emitente; as 12 linhas da nota como declaradas; nada
 * lembrado (o fornecedor é novo); G1..G4 sugeridos pelo CÓDIGO DE BARRAS com o produto deles (identidade primeiro);
 * N1/N2 sem vínculo (não há produto); o cartão de cada item com a situação da resposta; e, no fim, os 10 itens com
 * produto mostrando o produto CERTO (caixa + quantidade interna calculada) e só os 2 sem produto pendentes na aba.
 * O D3 da fase 0 NÃO é lei aqui (o número muda com a fatia): a asserção do "depois" é de outro dono.
 *
 * O XML é SINTÉTICO (`notaSinteticaDeVariosItens`: CNPJ, chave e EAN inventados, DVs calculados lá). Os cadastros do
 * caso (fornecedor e os 15 produtos) nascem pela API e são excluídos (lógica) pela fixture da Central no fim do caso,
 * verde ou não. A importação fica pendente (decisão 247: nada se apaga); nenhuma compra é gerada.
 */

const caminho = (r: Response) => new URL(r.url()).pathname;
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ═════════════════════════════════ o cenário ═════════════════════════════════ */

type Papel = "codigo_de_barras" | "a_mao" | "referencia" | "sem_produto";

interface CasoDaNota {
  rotulo: string;
  papel: Papel;
  /** o xProd da nota */
  nota: string;
  /** o uCom (unidade do seed) e a NCM (8 dígitos, vigente na carga oficial) — do item e do produto */
  unidade: string;
  ncm: string;
  /** a descrição do produto no cadastro; null = o item não tem produto */
  produto: string | null;
  /** o que o operador digita no seletor quando precisa achar o produto (D4); null = não há o que achar */
  busca: string | null;
}

/** OS 12 ITENS, na ordem da nota (nItem = posição + 1). */
const NOTA_DA_FASE_0: readonly CasoDaNota[] = [
  { rotulo: "G1", papel: "codigo_de_barras", nota: "ESPALHANTE ADESIVO 1L", unidade: "L", ncm: "34029090", produto: "ESPALHANTE ADESIVO AGRICOLA", busca: "ESPALHANTE" },
  { rotulo: "G2", papel: "codigo_de_barras", nota: "INOCULANTE SOJA TURFOSO 200G", unidade: "UN", ncm: "38249929", produto: "INOCULANTE TURFOSO PARA SOJA", busca: "INOCULANTE" },
  { rotulo: "G3", papel: "codigo_de_barras", nota: "ARAME FARPADO 500M", unidade: "UN", ncm: "73130000", produto: "ARAME FARPADO ROLO 500 M", busca: "ARAME" },
  { rotulo: "G4", papel: "codigo_de_barras", nota: "MANGUEIRA PVC 1/2 POL 50M", unidade: "UN", ncm: "39173900", produto: "MANGUEIRA DE PVC 1/2", busca: "MANGUEIRA" },
  { rotulo: "M1", papel: "a_mao", nota: "RACAO BOVINA ENGORDA 25KG", unidade: "SC", ncm: "23099090", produto: "RAÇÃO BOVINA ENGORDA", busca: "BOVINA ENGORDA" },
  { rotulo: "M2", papel: "a_mao", nota: "FERTILIZANTE FOLIAR CALCIO BORO 1L", unidade: "L", ncm: "31059090", produto: "FERTILIZANTE FOLIAR CÁLCIO-BORO", busca: "FOLIAR" },
  { rotulo: "M3", papel: "a_mao", nota: "PROTEINADO SAL  MINERAL", unidade: "SC", ncm: "23099010", produto: "SAL MINERAL PROTEINADO", busca: "PROTEINADO" },
  { rotulo: "M4", papel: "a_mao", nota: "GLIFOSATO HERBICIDA 480 G/L", unidade: "L", ncm: "38089329", produto: "HERBICIDA GLIFOSATO 480", busca: "GLIFOSATO" },
  { rotulo: "R1", papel: "referencia", nota: "ITEM TECNICO ALFA", unidade: "UN", ncm: "38249929", produto: "PRODUTO REFERENCIADO UM", busca: "REFERENCIADO UM" },
  { rotulo: "R2", papel: "referencia", nota: "ITEM TECNICO BETA", unidade: "KG", ncm: "31051000", produto: "PRODUTO REFERENCIADO DOIS", busca: "REFERENCIADO DOIS" },
  { rotulo: "N1", papel: "sem_produto", nota: "PARAFUSO SEXTAVADO 3/8", unidade: "UN", ncm: "73181500", produto: null, busca: null },
  { rotulo: "N2", papel: "sem_produto", nota: "LUVA NITRILICA TAM G", unidade: "UN", ncm: "40151900", produto: null, busca: null }
];

/** OS DISTRATORES do cadastro (a semelhança não pode ser trivial). */
const DISTRATORES: readonly { produto: string; unidade: string; ncm: string }[] = [
  { produto: "RAÇÃO EQUINA MANUTENÇÃO", unidade: "SC", ncm: "23099090" },
  { produto: "SAL COMUM GROSSO", unidade: "SC", ncm: "25010090" },
  { produto: "HERBICIDA 2,4-D 806", unidade: "L", ncm: "38089329" },
  { produto: "FERTILIZANTE NPK 20-05-20", unidade: "SC", ncm: "31052000" },
  { produto: "RAÇÃO BOVINA LACTAÇÃO", unidade: "SC", ncm: "23099090" }
];

/** O cProd de cada item: com o sorteio da execução (o vínculo e a referência nunca colidem entre execuções). */
const codigoDoItem = (c: CasoDaNota, rodada: string) =>
  c.papel === "referencia" ? `FX-778${c.rotulo.slice(1)}-${rodada}` : `X02${c.rotulo}-${rodada}`;

interface ProdutoDoCaso { id: string; codigo: string; descricao: string }

interface VinculoLido {
  situacao: string;
  origem?: string;
  produto?: { id: string; codigo: string; descricao: string };
  candidatos?: { id: string; codigo: string; descricao: string }[];
}
interface ConferenciaLida {
  id: string; situacao: string; empresa: { id: string }; fornecedorEscolhido: string | null;
  parceiro: { situacao: string; id?: string };
  nota: { itens: { nItem: number; codigo: string; ean: string | null; ncm: string | null; unidade: string; descricao: string }[] };
  itens: { nItem: number; vinculo: VinculoLido }[];
}

async function lerProduto(page: Page, id: string): Promise<ProdutoDoCaso> {
  const row = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${id}`);
  expect(row["id"], `premissa: o produto ${id} foi lido do servidor`).toBe(id);
  return { id, codigo: String(row["code"] ?? ""), descricao: String(row["description"] ?? "") };
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
  const forn = await criarCadastro(page, "people", { name: uniq("XML02 forn"), person_type: "legal", is_provider: true, document: emitente });

  const eans = NOTA_DA_FASE_0.map((c) => (c.papel === "codigo_de_barras" ? eanSintetico() : null));
  const nota = notaSinteticaDeVariosItens({
    emitenteCnpj: emitente, emitenteNome: `Emitente sintético ${uniq("XML02")}`,
    itens: NOTA_DA_FASE_0.map((c, k) => ({
      codigo: codigoDoItem(c, rodada), descricao: c.nota, unidade: c.unidade, ncm: c.ncm, ean: eans[k] ?? null,
      quantidade: String(k + 1), valorUnitario: "10.00", valorProdutos: `${(k + 1) * 10}.00`
    }))
  });

  // O CADASTRO: o produto de cada item que tem um (G pelo barcode, M à mão, R pela referência) e os distratores
  const base = (descricao: string, unidade: string, ncm: string) =>
    ({ description: descricao, group_id: ref.grupo.id, measurement_id: unidadeDe(unidade).id, financial_category_id: ref.natureza.id, ncm_code: ncm });
  const doItem = new Map<number, ProdutoDoCaso>();
  for (const [k, c] of NOTA_DA_FASE_0.entries()) {
    if (!c.produto) continue;
    const item = nota.itens[k]!;
    const corpo: Record<string, unknown> = base(c.produto, c.unidade, c.ncm);
    if (c.papel === "codigo_de_barras") corpo["barcode"] = item.ean;
    if (c.papel === "referencia") corpo["reference"] = item.codigo;
    const p = await criarCadastro(page, "products", corpo);
    const lido = await lerProduto(page, p.id);
    expect(lido.descricao, `premissa: o produto do ${c.rotulo} gravou a descrição declarada`).toBe(c.produto);
    doItem.set(item.nItem, lido);
  }
  const distratores: ProdutoDoCaso[] = [];
  for (const d of DISTRATORES) {
    const p = await criarCadastro(page, "products", base(d.produto, d.unidade, d.ncm));
    const lido = await lerProduto(page, p.id);
    expect(lido.descricao, `premissa: o distrator gravou a descrição declarada`).toBe(d.produto);
    distratores.push(lido);
  }
  return { empresa, fornecedor: forn.id, rodada, nota, doItem, distratores };
}

/* ═════════════════════════════════ a contagem (D4) ═════════════════════════════════ */

type Gesto = "abrir o seletor" | "digitar a busca" | "escolher";
interface Interacao { n: number; item: number; caso: string; gesto: Gesto; alvo: string }

class Registro {
  readonly interacoes: Interacao[] = [];
  /** cliques de navegação (a aba Itens), fora do D4 */
  readonly navegacao: string[] = [];
  gesto(item: number, caso: string, gesto: Gesto, alvo: string) {
    const i: Interacao = { n: this.interacoes.length + 1, item, caso, gesto, alvo };
    this.interacoes.push(i);
    console.log(`XML-02-MEDIDA interacao ${i.n} | item ${item} (${caso}) | ${gesto} | ${alvo}`);
  }
  doItem(item: number) { return this.interacoes.filter((i) => i.item === item).length; }
}

type CaminhoNaTela = "ja_escolhido" | "candidato" | "seletor";

/**
 * Dá ao item o produto CERTO pela tela, com o menor gesto que a tela oferece, e registra cada gesto executado:
 *  · lembrado/sugerido com o produto certo → nada (confere que a caixa já mostra o produto);
 *  · ambíguo com o certo entre os candidatos e o botão dele na tela → o clique no candidato;
 *  · o resto (nenhum, ambíguo sem o certo, sugerido ERRADO) → o seletor: abrir, digitar a busca, escolher.
 * No fim, a caixa mostra o produto certo e a quantidade interna foi calculada (o produto entrou na decisão do item).
 */
async function resolverNaTela(page: Page, r: Registro, nItem: number, caso: CasoDaNota, certo: ProdutoDoCaso, v: VinculoLido):
  Promise<{ caminho: CaminhoNaTela; sugestaoErrada: boolean }> {
  const pede = `importacao-item-${nItem}`;
  const caixa = page.getByTestId(`${pede}-produto`).getByRole("combobox");
  const quantidadeInterna = page.getByTestId(`${pede}-quantidade-interna`);
  const resolvido = async () => {
    await expect(caixa, `${caso.rotulo}: a caixa Produto mostra o produto certo`).toContainText(certo.descricao);
    await expect(quantidadeInterna, `${caso.rotulo}: com o produto, a quantidade interna é calculada`).not.toHaveText("—");
  };
  const veioComProduto = v.situacao === "lembrado" || v.situacao === "sugerido";
  if (veioComProduto && v.produto?.id === certo.id) { await resolvido(); return { caminho: "ja_escolhido", sugestaoErrada: false }; }

  if (v.situacao === "ambiguo" && (v.candidatos ?? []).some((c) => c.id === certo.id)) {
    const botao = page.getByTestId(`${pede}-candidato-${certo.id}`);
    if (await botao.count()) {
      await botao.click();
      r.gesto(nItem, caso.rotulo, "escolher", `candidato ${certo.descricao}`);
      await resolvido();
      return { caminho: "candidato", sugestaoErrada: false };
    }
  }

  expect(caso.busca, `${caso.rotulo}: o caso declara o que o operador digita`).toBeTruthy();
  await caixa.click();
  r.gesto(nItem, caso.rotulo, "abrir o seletor", "Produto");
  const pesquisa = page.getByRole("textbox", { name: "Pesquisar opção" });
  await expect(pesquisa, `${caso.rotulo}: o seletor abriu com a pesquisa`).toBeVisible();
  await pesquisa.fill(caso.busca!);
  r.gesto(nItem, caso.rotulo, "digitar a busca", caso.busca!);
  const opcao = page.getByRole("listbox").getByRole("option", { name: new RegExp(`^\\s*${escapar(certo.codigo)}\\s*${escapar(certo.descricao)}\\s*$`) });
  await opcao.click();
  r.gesto(nItem, caso.rotulo, "escolher", `opção ${certo.descricao}`);
  await resolvido();
  return { caminho: "seletor", sugestaoErrada: veioComProduto };
}

/* ═════════════════════════════════ a medição ═════════════════════════════════ */

test("XML-02 MEDIÇÃO — nota de 12 itens de um fornecedor: o que a conferência acha sozinha (D1, D2, D3) e o que o operador resolve na tela (D4)", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const c = await cenario(page);
  const temProduto = (k: number) => NOTA_DA_FASE_0[k]!.produto !== null;

  // A IMPORTAÇÃO pela API (a mesma porta da tela), com a empresa ativa
  const imp = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", {
    nome_arquivo: `nfe-${c.nota.numero}.xml`, arquivo_base64: Buffer.from(c.nota.xml, "utf8").toString("base64"), empresa_id: c.empresa
  });
  const direta = await api<ConferenciaLida>(page, "GET", `/api/compras/importacoes/${imp.id}`);

  // A CONFERÊNCIA QUE A TELA RECEBE: a resposta do GET que a própria tela faz ao abrir
  const daTela = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/importacoes/${imp.id}`, { timeout: 20_000 });
  await page.goto(`/compras/importacoes/${imp.id}`);
  const resposta = await daTela;
  expect(resposta.status(), "premissa: a tela leu a conferência (200)").toBe(200);
  const conf = (await resposta.json()) as ConferenciaLida;
  const raiz = page.getByTestId("importacao-conferencia");
  await expect(raiz).toHaveAttribute("data-situacao", "pendente");
  await expect(raiz).toHaveAttribute("data-relendo", "nao");

  /* ── PREMISSAS (valem no antes e no depois) ── */
  expect(conf, "premissa: a importação pendente, da empresa ativa, com o fornecedor encontrado pelo emitente")
    .toMatchObject({ id: imp.id, situacao: "pendente", empresa: { id: c.empresa }, parceiro: { situacao: "encontrado", id: c.fornecedor }, fornecedorEscolhido: c.fornecedor });
  expect(conf.nota.itens.map((i) => [i.nItem, i.codigo, i.descricao, i.unidade, i.ncm, i.ean]), "premissa: as 12 linhas da nota, como declaradas")
    .toEqual(c.nota.itens.map((i) => [i.nItem, i.codigo, i.descricao, i.unidade.toUpperCase(), i.ncm, i.ean]));
  expect(conf.itens.map((i) => i.nItem), "premissa: um vínculo para cada uma das 12 linhas").toEqual(c.nota.itens.map((i) => i.nItem));
  expect(conf.itens.map((i) => [i.nItem, i.vinculo]), "premissa: a tela recebeu os MESMOS vínculos da leitura direta").toEqual(direta.itens.map((i) => [i.nItem, i.vinculo]));
  for (const i of conf.itens) expect(["lembrado", "sugerido", "ambiguo", "nenhum"], `premissa: a situação do item ${i.nItem} é do contrato`).toContain(i.vinculo.situacao);
  expect(conf.itens.filter((i) => i.vinculo.situacao === "lembrado").map((i) => i.nItem), "premissa: o fornecedor é novo — nada lembrado").toEqual([]);
  const vinculo = (nItem: number) => conf.itens.find((i) => i.nItem === nItem)!.vinculo;
  NOTA_DA_FASE_0.forEach((caso, k) => {
    const n = k + 1;
    if (caso.papel === "codigo_de_barras") {
      expect([vinculo(n).situacao, vinculo(n).origem, vinculo(n).produto?.id], `premissa: ${caso.rotulo} sugerido pelo CÓDIGO DE BARRAS, com o produto dele`)
        .toEqual(["sugerido", "codigo_barras", c.doItem.get(n)!.id]);
    }
    if (caso.papel === "sem_produto") expect(vinculo(n).situacao, `premissa: ${caso.rotulo} não tem produto no cadastro — sem vínculo`).toBe("nenhum");
  });

  // SONDAS INFORMATIVAS, pela API do seletor de produto (a mesma da caixa Produto): ele acha o produto pelo texto da
  // nota? Pelo cProd? E o que a busca do operador lista (a escolha que a pessoa tem diante de si)?
  const opcoesDoSeletor = (busca: string) => api<{ id: string; label: string }[]>(page, "GET", `/api/resources/products/options?search=${encodeURIComponent(busca)}`);
  const sonda = async (busca: string, id: string) => (await opcoesDoSeletor(busca)).some((o) => o.id === id);

  /* ── A TELA: a aba Itens e o cartão de cada item ── */
  const contador = page.getByTestId("importacao-aba-itens-contador");
  const pendenciasAoAbrir = (await contador.count()) ? Number((await contador.textContent())?.trim() ?? "0") : 0;
  const r = new Registro();
  await page.getByTestId("importacao-aba-itens-rotulo").click();
  r.navegacao.push("aba Itens, vínculos e lotes");
  await expect(page.getByTestId("importacao-aba-itens"), "premissa: a aba Itens abriu").toBeVisible();
  for (const i of conf.itens) {
    await expect(page.getByTestId(`importacao-item-${i.nItem}`), `premissa: o cartão do item ${i.nItem} mostra a situação da resposta`).toHaveAttribute("data-vinculo", i.vinculo.situacao);
  }

  const inicio = Date.now();
  const porItem: Record<string, unknown>[] = [];
  for (const [k, caso] of NOTA_DA_FASE_0.entries()) {
    const n = k + 1;
    const v = vinculo(n);
    const linha: Record<string, unknown> = {
      item: n, caso: caso.rotulo, descricaoNota: caso.nota, situacao: v.situacao, origem: v.origem ?? null,
      produtoDoVinculo: v.produto?.descricao ?? null, candidatos: (v.candidatos ?? []).map((x) => x.descricao)
    };
    if (temProduto(k)) {
      const certo = c.doItem.get(n)!;
      const feito = await resolverNaTela(page, r, n, caso, certo, v);
      Object.assign(linha, {
        produtoCerto: certo.descricao, caminhoNaTela: feito.caminho, sugestaoErrada: feito.sugestaoErrada, interacoes: r.doItem(n),
        seletorAchaPelaDescricaoDaNota: await sonda(caso.nota, certo.id), seletorAchaPeloCProd: await sonda(c.nota.itens[k]!.codigo, certo.id),
        ...(feito.caminho === "seletor" ? { opcoesDaBusca: (await opcoesDoSeletor(caso.busca!)).map((o) => o.label) } : {})
      });
    } else {
      Object.assign(linha, { produtoCerto: null, caminhoNaTela: null, sugestaoErrada: false, interacoes: 0 });
    }
    porItem.push(linha);
  }
  const duracao = Date.now() - inicio;

  /* ── PREMISSAS DO FIM: os 10 itens com produto ficaram com o produto certo (conferido item a item acima); só os
        sem produto no cadastro pendem na aba Itens ── */
  for (const [k, caso] of NOTA_DA_FASE_0.entries()) {
    if (caso.produto !== null) continue;
    await expect(page.getByTestId(`importacao-item-${k + 1}-quantidade-interna`), `${caso.rotulo}: sem produto, sem quantidade interna`).toHaveText("—");
  }
  const semProduto = NOTA_DA_FASE_0.filter((x) => x.produto === null).length;
  await expect(contador, "premissa: no fim, só os itens sem produto no cadastro pendem na aba Itens").toHaveText(String(semProduto));

  /* ── as medidas ── */
  const situacoes = conf.itens.map((i) => i.vinculo.situacao);
  const D1 = situacoes.filter((s) => s === "lembrado" || s === "sugerido").length;
  const ambiguos = conf.itens.filter((i) => i.vinculo.situacao === "ambiguo").map((i) => ({ item: i.nItem, candidatos: (i.vinculo.candidatos ?? []).length }));
  const D2 = { total: ambiguos.length, porItem: ambiguos };
  const D3 = situacoes.filter((s) => s === "nenhum").length;
  const doD4 = NOTA_DA_FASE_0.map((x, k) => ({ x, n: k + 1 })).filter(({ x }) => x.papel === "a_mao" || x.papel === "referencia");
  const D4 = doD4.reduce((a, { n }) => a + r.doItem(n), 0);
  const nosG = NOTA_DA_FASE_0.map((x, k) => ({ x, n: k + 1 })).filter(({ x }) => x.papel === "codigo_de_barras").reduce((a, { n }) => a + r.doItem(n), 0);
  const gestos = (g: Gesto) => r.interacoes.filter((i) => i.gesto === g && doD4.some(({ n }) => n === i.item)).length;

  const resultado = {
    D1, D2, D3, D4,
    D4PorGesto: { "abrir o seletor": gestos("abrir o seletor"), "digitar a busca": gestos("digitar a busca"), escolher: gestos("escolher") },
    interacoesNosG: nosG, navegacaoForaDoD4: r.navegacao.length,
    pendenciasNaAbaItens: { aoAbrir: pendenciasAoAbrir, noFim: semProduto },
    porItem
  };
  console.log("MEDICAO XML-02", JSON.stringify(resultado));
  console.log(`XML-02-MEDIDA tempo da resolução na tela (informativo, não é medida) = ${duracao} ms`);
  test.info().annotations.push({ type: "MEDICAO XML-02", description: JSON.stringify(resultado) });
  test.info().annotations.push({ type: "XML-02-MEDIDA interacoes", description: JSON.stringify(r.interacoes) });
});
