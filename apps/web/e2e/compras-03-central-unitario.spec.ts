import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { LAYOUT_DO_SISTEMA, type ColunaDoLayout, type EstruturaLayout } from "@agro/domain";
import { ordemDasColunas, type ColunaDesenhada, type ColunaDoEditorDeItens, type ColunaDoLayoutNoEditor } from "../src/features/docs/shared";
import { colunasDoEditor, estruturaComExigidos, zonasDaCentral } from "../src/features/compras/layout-da-central";

/**
 * AS CONTAS DO LAYOUT NA CENTRAL DE COMPRAS, MEDIDAS SEM A CENTRAL (COMPRAS-03, decisão 269).
 *
 * O mesmo formato de `lancador-operacoes-unitario.spec.ts` (e pelo mesmo motivo: `apps/web` não tem runner de unidade;
 * o Playwright roda um teste sem `page` como teste comum de Node — nenhum navegador abre, nenhum servidor é tocado).
 *
 * O que está sob teste é a REGRA do desenho: a ordem das colunas do editor de itens, as colunas que o layout pede e a
 * regra força, as zonas do cabeçalho e os campos que aparecem mesmo que o layout os esconda. E, sobretudo, a promessa
 * que protege as OUTRAS telas: sem a prop `colunasDoLayout`, o editor desenha a ordem de sempre em todas as
 * combinações de `fields` que o repositório usa.
 *
 * Desde a VISUAL-UX-04 (decisão 276) a Central de Compras NÃO usa mais o `ItemsEditor`: os itens dela são a grade do
 * motor da Central (`features/central/itens.tsx`), e as colunas vêm de `colunasDoEditor` (testado abaixo) — não de
 * `ordemDasColunas`. As três linhas "Central de Compras · …" da tabela descreviam chamadas que não existem mais e
 * saíram (VISUAL-UX-04b): a tabela lista só quem chama o editor hoje.
 *
 * AS TABELAS SÃO CONFERIDAS CONTRA O REPOSITÓRIO (OPERACOES-01): a contagem não é um número escrito à mão. A de
 * `COMBINACOES` lê `apps/web/src` e CONTA, arquivo a arquivo, as chamadas `<ItemsEditor`: cada uma tem de ter a sua
 * linha (`chamada`, a posição no arquivo), e o `fields` literal de cada linha tem de estar DENTRO daquela chamada —
 * uma segunda chamada num arquivo que já está na tabela reprova. A do MOTOR (`COMBINACOES_DO_MOTOR`) cobra o mesmo de
 * quem desenha a grade do motor (`features/central/itens.tsx`), com as chaves que mudam o que ele faz —
 * `armazemPorItem`, `armazemForcado`, `custoMedioNoUnitario`, `lote`, `daOrigem`, `pesquisaDeProduto` — lidas na
 * chamada INTEIRA (a leitura equilibra as chaves `{…}`: um `/>` dentro de uma prop não a corta). E
 * `COMBINACOES_DA_COMPRA` mede as colunas que a compra ENTREGA ao motor em cada combinação de layout × regra × lote: `colunasDoEditor` é a função REAL (importada),
 * mas as colunas FORÇADAS que a compra lhe passa são uma RÉPLICA escrita à mão (`forcadasDaCompra`, abaixo), porque a
 * conta original vive dentro do hook da criação e não se importa aqui. O motor mesmo (um componente React com CSS) não
 * roda sem navegador — o que ele e o hook fazem está provado nos E2E (LC-W1, CX-1, CX-2, CX-3; a pesquisa de produto
 * da linha, em F3B-V2 e F3B-C1 de `operacoes-01-f3b-vendas.spec.ts`/`-compras.spec.ts`).
 */

const PEDIDO = "compras.pedido";
const COMPRA = "compras.compra";

/** A ordem de sempre, reescrita aqui à mão (e não importada): se o editor a mudar, este teste é quem avisa. */
const ORDEM_DE_SEMPRE: readonly ColunaDesenhada[] = ["warehouse", "product", "stock", "saldo", "quantity", "unit_value", "discount", "discount_percent", "total", "generate_stock", "lot", "expiration", "financial_category", "cost_center"];

/** A mesma regra de visibilidade do `ItemsEditor`: produto, quantidade e total sempre; saldo só com origem; o resto por `fields`. */
const visivelPor = (fields: readonly ColunaDoEditorDeItens[], comOrigem: boolean) => (c: ColunaDesenhada) =>
  c === "product" || c === "quantity" || c === "total" || (c === "saldo" ? comOrigem : (fields as readonly string[]).includes(c));

/**
 * As chamadas do editor no repositório, SEM layout — cada `fields` de cada tela (e os dois ramos da devolução). Nenhuma
 * passa `colunasDoLayout` (a única que passava, a Central de Compras, saiu do editor na VISUAL-UX-04). `arquivo` é o de
 * `apps/web/` que faz a chamada e `chamada` é qual `<ItemsEditor` do arquivo, na ordem do texto (1 = a primeira; os
 * dois ramos da devolução são a MESMA chamada, com o `fields` num ternário); os dois são `null` nos limites, que
 * nenhuma tela usa.
 */
const COMBINACOES: { onde: string; arquivo: string | null; chamada: number | null; fields: ColunaDoEditorDeItens[]; comOrigem: boolean }[] = [
  { onde: "frota/manutencoes", arquivo: "src/app/(app)/frota/manutencoes/new/page.tsx", chamada: 1, fields: ["warehouse", "product", "stock", "quantity", "unit_value"], comOrigem: false },
  { onde: "estoque/devolucoes (com lote)", arquivo: "src/app/(app)/estoque/devolucoes/new/page.tsx", chamada: 1, fields: ["warehouse", "product", "quantity", "unit_value", "lot", "expiration", "cost_center"], comOrigem: false },
  { onde: "estoque/devolucoes (sem lote)", arquivo: "src/app/(app)/estoque/devolucoes/new/page.tsx", chamada: 1, fields: ["warehouse", "product", "quantity", "unit_value", "cost_center"], comOrigem: false },
  { onde: "estoque/baixas", arquivo: "src/app/(app)/estoque/baixas/new/page.tsx", chamada: 1, fields: ["product", "stock", "quantity", "lot"], comOrigem: false },
  { onde: "estoque/documentos-fiscais", arquivo: "src/app/(app)/estoque/documentos-fiscais/new/page.tsx", chamada: 1, fields: ["warehouse", "product", "quantity", "unit_value", "discount", "generate_stock", "lot", "expiration", "financial_category", "cost_center"], comOrigem: false },
  { onde: "estoque/entradas", arquivo: "src/app/(app)/estoque/entradas/new/page.tsx", chamada: 1, fields: ["warehouse", "product", "quantity", "unit_value", "generate_stock", "lot", "expiration", "financial_category", "cost_center"], comOrigem: false },
  { onde: "estoque/transferencias", arquivo: "src/app/(app)/estoque/transferencias/new/page.tsx", chamada: 1, fields: ["product", "stock", "quantity", "lot", "cost_center"], comOrigem: false },
  { onde: "estoque/requisicoes", arquivo: "src/app/(app)/estoque/requisicoes/new/page.tsx", chamada: 1, fields: ["warehouse", "product", "stock", "quantity", "lot", "cost_center"], comOrigem: false },
  { onde: "stock/feed-formulas", arquivo: "src/features/stock/feed-formulas.tsx", chamada: 1, fields: ["product", "quantity"], comOrigem: false },
  // Limites: o mínimo (só o que sempre aparece) e o máximo (todas as colunas, com a origem)
  { onde: "limite · mínimo", arquivo: null, chamada: null, fields: ["product"], comOrigem: false },
  { onde: "limite · todas com origem", arquivo: null, chamada: null, fields: ["warehouse", "product", "stock", "quantity", "unit_value", "discount", "discount_percent", "generate_stock", "lot", "expiration", "financial_category", "cost_center"], comOrigem: true }
];
test("as 11 combinações estão na tabela", () => { expect(COMBINACOES).toHaveLength(11); });

/* ─────────────── a contagem conferida contra o repositório ─────────────── */

const WEB = path.resolve(__dirname, "..");
/** Todo `.ts`/`.tsx` de `apps/web/src`, com o caminho relativo a `apps/web/` (o da tabela). */
function fontesDoWeb(dir = path.join(WEB, "src")): { arquivo: string; texto: string }[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) return fontesDoWeb(abs);
    return /\.tsx?$/.test(e.name) ? [{ arquivo: path.relative(WEB, abs).split(path.sep).join("/"), texto: fs.readFileSync(abs, "utf8") }] : [];
  });
}
const lerDoWeb = (arquivo: string) => fs.readFileSync(path.join(WEB, arquivo), "utf8");
/** O `fields` como o código o escreve: `["warehouse", "product"]`. */
const literalDosFields = (fields: readonly string[]) => `[${fields.map((f) => `"${f}"`).join(", ")}]`;

/** Posição logo depois da string (aspas, apóstrofo ou crase) que abre em `i`, respeitando o escape `\`. */
function depoisDaString(texto: string, i: number): number {
  const aspa = texto[i];
  let j = i + 1;
  while (j < texto.length && texto[j] !== aspa) j += texto[j] === "\\" ? 2 : 1;
  return j + 1;
}

/**
 * Os elementos JSX `<Nome …>` do texto, INTEIROS: da abertura até o `/>` (ou `>`) que fecha a TAG — o primeiro FORA de
 * chaves `{…}`, de string e de comentário. Um `/>` dentro de uma prop (`icone={<X />}`), uma seta (`=>`) ou um `a > b`
 * não fecham nada. Fail closed: tag que não fecha (o texto acaba antes, ou as chaves não equilibram) reprova AQUI —
 * nunca volta um pedaço da chamada, em que uma chave que vem depois do corte passaria por "ausente".
 */
function elementosJsx(texto: string, nome: string, onde: string): string[] {
  const elementos: string[] = [];
  for (const m of texto.matchAll(new RegExp(`<${nome}\\b`, "g"))) {
    const inicio = m.index;
    let i = inicio + m[0].length;
    let chaves = 0;
    let fim = -1;
    while (i < texto.length && fim < 0) {
      const c = texto[i]!;
      const prox = texto[i + 1];
      if (c === '"' || c === "'" || c === "`") { i = depoisDaString(texto, i); continue; }
      if (c === "/" && prox === "*") { const f = texto.indexOf("*/", i + 2); i = f < 0 ? texto.length : f + 2; continue; }
      if (c === "/" && prox === "/") { const f = texto.indexOf("\n", i + 2); i = f < 0 ? texto.length : f + 1; continue; }
      if (c === "{") chaves++;
      else if (c === "}") chaves--;
      else if (chaves === 0 && c === "/" && prox === ">") fim = i + 2;
      else if (chaves === 0 && c === ">") fim = i + 1;
      i++;
    }
    expect(fim, `${onde}: o <${nome} da posição ${inicio} fecha a tag, com as chaves equilibradas`).toBeGreaterThan(0);
    elementos.push(texto.slice(inicio, fim));
  }
  return elementos;
}

test("a leitura das chamadas JSX é a chamada INTEIRA: um '/>' dentro de uma prop não corta; tag que não fecha reprova", () => {
  const texto = `x = <Motor a={1} icone={<Icone />} seta={(v) => v > 0} texto="a/>b" /* d'água /> */ b />; <Motor c={{ d: "}" }} />`;
  expect(elementosJsx(texto, "Motor", "amostra")).toEqual([
    `<Motor a={1} icone={<Icone />} seta={(v) => v > 0} texto="a/>b" /* d'água /> */ b />`, `<Motor c={{ d: "}" }} />`
  ]);
  expect(() => elementosJsx("<Motor a={1} b={ />", "Motor", "amostra sem fim"), "a tag sem fim reprova, nunca devolve um pedaço").toThrow();
});

test("a tabela COMBINACOES é a do repositório: as chamadas <ItemsEditor CONTADAS arquivo a arquivo, cada uma com a sua linha e o fields dentro dela", () => {
  const noRepositorio = Object.fromEntries(fontesDoWeb()
    .map((f) => [f.arquivo, elementosJsx(f.texto, "ItemsEditor", f.arquivo)] as const)
    .filter(([, chamadas]) => chamadas.length > 0));
  expect(Object.keys(noRepositorio).length, "premissa: a leitura de apps/web/src achou chamadas do editor").toBeGreaterThan(0);
  /** Arquivo → as chamadas (1…n, na ordem do texto): as que a tabela cita e as que o arquivo tem. */
  const naTabela: Record<string, number[]> = {};
  for (const x of COMBINACOES) if (x.arquivo && x.chamada) naTabela[x.arquivo] = [...new Set([...(naTabela[x.arquivo] ?? []), x.chamada])].sort((a, b) => a - b);
  const contadas = Object.fromEntries(Object.entries(noRepositorio).map(([arquivo, chamadas]) => [arquivo, chamadas.map((_, i) => i + 1)]));
  expect(naTabela, "cada <ItemsEditor de cada arquivo tem a sua linha na tabela — nem arquivo nem chamada a mais ou a menos").toEqual(contadas);
  for (const x of COMBINACOES) {
    if (!x.arquivo || !x.chamada) continue;
    expect(noRepositorio[x.arquivo]?.[x.chamada - 1], `${x.onde}: o fields da tabela está DENTRO da chamada ${x.chamada} do arquivo`).toContain(literalDosFields(x.fields));
  }
});

const coluna = (c: ColunaDoEditorDeItens, chave: string): ColunaDoLayoutNoEditor => ({ coluna: c, chave, obrigatorio: false });
const SEM_REGRA = { forcadas: [] as string[], obrigatoriasPelaRegra: new Set<string>() };

test.describe("ordemDasColunas", () => {
  for (const x of COMBINACOES) {
    test(`sem a prop colunasDoLayout = a ordem de sempre — ${x.onde}`, () => {
      const visivel = visivelPor(x.fields, x.comOrigem);
      expect(ordemDasColunas(visivel, undefined)).toEqual(ORDEM_DE_SEMPRE.filter(visivel));
    });
  }

  test("com layout: a ordem da lista; o que ela não cita vem depois, na ordem de sempre; o total logo depois da última que o precede", () => {
    const visivel = visivelPor(["warehouse", "product", "quantity", "unit_value", "lot", "expiration"], false);
    const layout = [coluna("unit_value", "valor_unitario"), coluna("product", "produto_id"), coluna("lot", "lote")];
    expect(ordemDasColunas(visivel, layout)).toEqual(["unit_value", "product", "lot", "warehouse", "quantity", "total", "expiration"]);
  });

  test("com layout e origem: o saldo entra logo antes da quantidade; coluna invisível ou repetida na lista não entra", () => {
    const visivel = visivelPor(["warehouse", "product", "quantity", "unit_value"], true);
    const layout = [coluna("quantity", "quantidade"), coluna("quantity", "quantidade"), coluna("lot", "lote"), coluna("product", "produto_id")];
    expect(ordemDasColunas(visivel, layout)).toEqual(["saldo", "quantity", "product", "warehouse", "unit_value", "total"]);
  });

  test("com o layout do sistema da compra, o editor desenha a mesma ordem que sem layout", () => {
    const fields: ColunaDoEditorDeItens[] = ["warehouse", "product", "quantity", "unit_value", "discount", "discount_percent", "lot", "expiration"];
    const layout = colunasDoEditor(COMPRA, LAYOUT_DO_SISTEMA(COMPRA).itens, SEM_REGRA);
    expect(ordemDasColunas(visivelPor(fields, false), layout)).toEqual(ordemDasColunas(visivelPor(fields, false), undefined));
  });
});

test.describe("colunasDoEditor", () => {
  test("layout do sistema: as colunas de hoje, na ordem de hoje, sem '*' nas colunas do sistema", () => {
    expect(colunasDoEditor(PEDIDO, LAYOUT_DO_SISTEMA(PEDIDO).itens, SEM_REGRA)).toEqual([
      coluna("warehouse", "armazem_id"), coluna("product", "produto_id"), coluna("quantity", "quantidade"),
      coluna("unit_value", "valor_unitario"), coluna("discount", "desconto"), coluna("discount_percent", "desconto_percentual")
    ]);
    expect(colunasDoEditor(COMPRA, LAYOUT_DO_SISTEMA(COMPRA).itens, SEM_REGRA).map((c) => c.coluna))
      .toEqual(["warehouse", "product", "quantity", "unit_value", "discount", "discount_percent", "lot", "expiration"]);
  });

  test("rótulo e obrigatório do layout; chave que o editor não desenha não entra; coluna do sistema não ganha '*'", () => {
    const r = colunasDoEditor(COMPRA, [
      { campo: "quantidade", obrigatorio: true, rotulo: "Qtd." }, { campo: "lote", obrigatorio: true }, { campo: "desconhecida", obrigatorio: true }
    ], SEM_REGRA);
    expect(r).toEqual([{ coluna: "quantity", chave: "quantidade", rotulo: "Qtd.", obrigatorio: false }, { coluna: "lot", chave: "lote", obrigatorio: true }]);
  });

  test("coluna forçada pela regra entra na posição do layout do sistema, com '*' quando a regra a exige", () => {
    const itens = [{ campo: "produto_id", obrigatorio: true }, { campo: "quantidade", obrigatorio: true }, { campo: "valor_unitario", obrigatorio: true }];
    const r = colunasDoEditor(COMPRA, itens, { forcadas: ["armazem_id", "validade"], obrigatoriasPelaRegra: new Set(["armazem_id"]) });
    expect(r.map((c) => [c.chave, c.obrigatorio])).toEqual([
      ["armazem_id", true], ["produto_id", false], ["quantidade", false], ["valor_unitario", false], ["validade", false]
    ]);
  });

  test("forçada que o layout já desenha não se duplica", () => {
    const r = colunasDoEditor(COMPRA, [{ campo: "lote", obrigatorio: false }, { campo: "produto_id", obrigatorio: true }], { forcadas: ["lote"], obrigatoriasPelaRegra: new Set() });
    expect(r.map((c) => c.chave)).toEqual(["lote", "produto_id"]);
  });
});

/* ─────────────── o MOTOR da Central: quem o chama, com que chaves ─────────────── */

/**
 * Uma chave da chamada do motor: `ausente` (vale o padrão do motor), `ligada` (a forma curta, `armazemPorItem`) ou a
 * expressão EXATA entre chaves (`custoMedioNoUnitario={false}` → "false").
 */
type ChaveDaChamada = "ausente" | "ligada" | string;
const CHAVES_DO_MOTOR = ["armazemPorItem", "armazemForcado", "custoMedioNoUnitario", "lote", "daOrigem", "pesquisaDeProduto"] as const;

/**
 * AS CHAMADAS DO MOTOR (`ItensDaCentral` de `features/central/itens.tsx`) no repositório e o que cada uma liga. O que
 * as chaves fazem no motor hoje (`itens.tsx`):
 * - `armazemPorItem` — a coluna Armazém é PERMITIDA (`ligada`: só `false` a desliga); permitir não é forçar: com
 *   layout, ela aparece se o layout a mostra (decisão 278, S2);
 * - `armazemForcado` (padrão `false`) — com layout, a coluna aparece mesmo que o layout a esconda, logo antes do
 *   Código/Produto (OPERACOES-01 F3b, decisão 280: o Local de estoque antes do produto; sem nenhum dos dois, no início);
 * - `custoMedioNoUnitario` (padrão `true`, a venda) — o custo médio do armazém preenche o unitário vazio ou "0"; com
 *   `false` o saldo continua lido e nada é escrito (decisão 278, M1);
 * - `lote` (padrão desligado) — as colunas Lote e Validade por linha;
 * - `daOrigem` (padrão desligado) — a coluna Saldo, o produto travado, sem Adicionar nem Duplicar (o receber pedido);
 * - `pesquisaDeProduto` (padrão: entrada) — a pesquisa de produto da linha (OPERACOES-01 F3b, decisão 280). Com a
 *   capacidade `pesquisaDeProdutos` da API, ela vai a `/api/produtos/pesquisa` pelo Local de estoque DA LINHA, com a
 *   coluna Estoque para quem vê o saldo daquele local; `PESQUISA_DE_PRODUTO_DA_SAIDA` liga "Só com saldo neste local"
 *   (`com_saldo=true`) e `PESQUISA_DE_PRODUTO_DA_ENTRADA` mostra tudo, com o saldo. Sem a capacidade (a API anterior),
 *   a pesquisa de hoje, `/api/resources/products/options`, idêntica. Ausente = entrada (o receber pedido não pesquisa
 *   produto: ele vem travado do pedido).
 */
const COMBINACOES_DO_MOTOR: ({ onde: string; arquivo: string; prova: string } & Record<(typeof CHAVES_DO_MOTOR)[number], ChaveDaChamada>)[] = [
  {
    onde: "Central de Vendas", arquivo: "src/features/sales/central-vendas-itens.tsx", prova: "CX-3 (o unitário vazio vira o custo médio), F3B-V2 (a saída só com saldo)",
    armazemPorItem: "ausente", armazemForcado: "ausente", custoMedioNoUnitario: "ausente", lote: "ausente", daOrigem: "ausente",
    pesquisaDeProduto: "PESQUISA_DE_PRODUTO_DA_SAIDA"
  },
  {
    onde: "Central de Compras · lançar", arquivo: "src/features/compras/central/criacao-itens.tsx", prova: "CX-1 (o 0 continua 0), LC-W1 (o layout esconde o Armazém), F3B-C1 (a entrada com tudo e o saldo)",
    armazemPorItem: "ligada", armazemForcado: "regras?.exigeArmazem === true", custoMedioNoUnitario: "false", lote: "controleDeLote", daOrigem: "ausente",
    pesquisaDeProduto: "PESQUISA_DE_PRODUTO_DA_ENTRADA"
  },
  {
    onde: "Central de Compras · receber pedido", arquivo: "src/features/compras/central/receber.tsx", prova: "CX-2 (o /convert leva 0), CC-9 (a coluna do saldo)",
    armazemPorItem: "ligada", armazemForcado: "regras?.exigeArmazem === true", custoMedioNoUnitario: "false", lote: "controleDeLote", daOrigem: "daOrigem",
    pesquisaDeProduto: "ausente"
  },
  {
    onde: "Central de Compras · orçamento", arquivo: "src/features/compras/orcamento/central-orcamento.tsx", prova: "F6B-O2 (o preço digitado, sem custo médio; produto e quantidade do pedido, travados)",
    armazemPorItem: "false", armazemForcado: "ausente", custoMedioNoUnitario: "false", lote: "ausente", daOrigem: "daOrigem",
    pesquisaDeProduto: "ausente"
  }
];
test("as 4 chamadas do motor estão na tabela", () => { expect(COMBINACOES_DO_MOTOR).toHaveLength(4); });

/** O nome com que o arquivo importa o motor (`ItensDaCentral`, ou o apelido do `as`), ou `null` se não o importa. */
function nomeDoMotorNoArquivo(arquivo: string, texto: string): string | null {
  for (const m of texto.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    const origem = m[2]!.startsWith("@/") ? path.join("src", m[2]!.slice(2)) : path.join(path.dirname(arquivo), m[2]!);
    if (path.normalize(origem).split(path.sep).join("/") !== "src/features/central/itens") continue;
    const nome = /(?:^|,)\s*ItensDaCentral(?:\s+as\s+(\w+))?\s*(?:,|$)/.exec(m[1]!);
    if (nome) return nome[1] ?? "ItensDaCentral";
  }
  return null;
}

/** O elemento `<Motor … />` do arquivo, INTEIRO (`elementosJsx`) — exatamente um por arquivo, fechado em si mesmo. */
function chamadaDoMotor(arquivo: string): string {
  const texto = lerDoWeb(arquivo);
  const nome = nomeDoMotorNoArquivo(arquivo, texto);
  expect(nome, `${arquivo} importa o motor`).not.toBeNull();
  const chamadas = elementosJsx(texto, nome!, arquivo);
  expect(chamadas, `${arquivo}: uma chamada do motor`).toHaveLength(1);
  expect(chamadas[0]!.endsWith("/>"), `${arquivo}: a chamada lida termina no '/>' que fecha o motor`).toBe(true);
  return chamadas[0]!;
}

test.describe("o motor da Central", () => {
  test("a tabela COMBINACOES_DO_MOTOR é a do repositório: todo arquivo que importa o motor está nela", () => {
    const chamadores = fontesDoWeb().filter((f) => nomeDoMotorNoArquivo(f.arquivo, f.texto) !== null).map((f) => f.arquivo).sort();
    expect(chamadores.length, "premissa: a leitura de apps/web/src achou quem importa o motor").toBeGreaterThan(0);
    expect(COMBINACOES_DO_MOTOR.map((x) => x.arquivo).sort(), "os arquivos da tabela = os que importam o motor").toEqual(chamadores);
  });

  for (const x of COMBINACOES_DO_MOTOR) {
    test(`${x.onde}: as chaves que a chamada liga são as da tabela — prova de comportamento: ${x.prova}`, () => {
      const chamada = chamadaDoMotor(x.arquivo);
      expect(chamada, "premissa: a chamada lida é a do motor, com o prefixo dos testids").toMatch(/\bprefixoTestid=\{/);
      for (const chave of CHAVES_DO_MOTOR) {
        const esperado = x[chave];
        const presente = new RegExp(`\\s${chave}(?=[\\s=/])`).test(chamada);
        if (esperado === "ausente") expect(presente, `${chave} ausente: vale o padrão do motor`).toBe(false);
        else if (esperado === "ligada") expect(new RegExp(`\\s${chave}(?=[\\s/])`).test(chamada), `${chave} na forma curta (true)`).toBe(true);
        else expect(chamada, `${chave}={${esperado}}`).toContain(`${chave}={${esperado}}`);
      }
    });
  }
});

/* ─────────────── as colunas que a COMPRA entrega ao motor ─────────────── */

/**
 * As colunas FORÇADAS pela regra — uma RÉPLICA escrita à mão, não a conta da tela. A original (`colunasForcadas`, em
 * `compras/central/estado.ts`) é um trecho DENTRO do hook `useEstadoDaCriacao`, que lê o estado do próprio hook (a
 * regra da TOP, os itens, o controle de lote dos produtos): não há função para importar, e o módulo do hook (React,
 * Next, a sessão) não roda neste teste de Node. A réplica diz o mesmo que ela diz hoje: o armazém quando a regra da
 * operação o exige; lote e validade (só na compra) quando algum produto da grade os controla. As combinações abaixo
 * provam `colunasDoEditor` (a função real) sobre a réplica; que o hook passa isso ao motor é o que os E2E provam.
 */
function forcadasDaCompra(familia: string, exigeArmazem: boolean, oProdutoPede: readonly ("lote" | "validade")[]) {
  return {
    forcadas: [...(exigeArmazem ? ["armazem_id"] : []), ...(familia === COMPRA ? oProdutoPede : [])],
    obrigatoriasPelaRegra: new Set(exigeArmazem ? ["armazem_id"] : [])
  };
}
const semCampos = (familia: string, ...fora: string[]): ColunaDoLayout[] => LAYOUT_DO_SISTEMA(familia).itens.filter((c) => !fora.includes(c.campo));
/** `chave*` = a coluna leva o "*" (obrigatória pela regra ou pelo layout). */
const comoTexto = (r: readonly ColunaDoLayoutNoEditor[]) => r.map((c) => `${c.chave}${c.obrigatorio ? "*" : ""}`).join(" ");

/**
 * AS COMBINAÇÕES layout × regra × lote da Central de Compras — o que a compra entrega ao motor (`colunasDoEditor`). O
 * motor recebe a compra com `armazemPorItem` e `armazemForcado={exigeArmazem}`: quando a regra exige, o Armazém JÁ está
 * na lista (a conta abaixo o põe), e o motor não tem o que forçar; quando não exige, o layout manda — escondido, a
 * coluna não volta (a S2 da decisão 278). O esperado é escrito à mão.
 */
const COMBINACOES_DA_COMPRA: { onde: string; familia: string; itens: ColunaDoLayout[]; exigeArmazem: boolean; oProdutoPede: ("lote" | "validade")[]; esperado: string }[] = [
  { onde: "compra · layout do sistema · regra não exige", familia: COMPRA, itens: semCampos(COMPRA), exigeArmazem: false, oProdutoPede: [],
    esperado: "armazem_id produto_id quantidade valor_unitario desconto desconto_percentual lote validade" },
  { onde: "compra · layout do sistema · regra exige o armazém (não duplica; ganha o '*')", familia: COMPRA, itens: semCampos(COMPRA), exigeArmazem: true, oProdutoPede: [],
    esperado: "armazem_id* produto_id quantidade valor_unitario desconto desconto_percentual lote validade" },
  { onde: "compra · layout sem Armazém · regra não exige (o layout manda)", familia: COMPRA, itens: semCampos(COMPRA, "armazem_id"), exigeArmazem: false, oProdutoPede: [],
    esperado: "produto_id quantidade valor_unitario desconto desconto_percentual lote validade" },
  { onde: "compra · layout sem Armazém · regra exige (volta na posição do sistema, com '*')", familia: COMPRA, itens: semCampos(COMPRA, "armazem_id"), exigeArmazem: true, oProdutoPede: [],
    esperado: "armazem_id* produto_id quantidade valor_unitario desconto desconto_percentual lote validade" },
  { onde: "compra · layout sem Armazém, Lote e Validade · nada forçado", familia: COMPRA, itens: semCampos(COMPRA, "armazem_id", "lote", "validade"), exigeArmazem: false, oProdutoPede: [],
    esperado: "produto_id quantidade valor_unitario desconto desconto_percentual" },
  { onde: "compra · layout sem Armazém, Lote e Validade · produto com lote e validade", familia: COMPRA, itens: semCampos(COMPRA, "armazem_id", "lote", "validade"), exigeArmazem: false, oProdutoPede: ["lote", "validade"],
    esperado: "produto_id quantidade valor_unitario desconto desconto_percentual lote validade" },
  { onde: "compra · layout sem Armazém, Lote e Validade · produto só com lote · regra exige", familia: COMPRA, itens: semCampos(COMPRA, "armazem_id", "lote", "validade"), exigeArmazem: true, oProdutoPede: ["lote"],
    esperado: "armazem_id* produto_id quantidade valor_unitario desconto desconto_percentual lote" },
  { onde: "pedido · layout do sistema · regra não exige", familia: PEDIDO, itens: semCampos(PEDIDO), exigeArmazem: false, oProdutoPede: [],
    esperado: "armazem_id produto_id quantidade valor_unitario desconto desconto_percentual" },
  { onde: "pedido · layout do sistema · regra exige", familia: PEDIDO, itens: semCampos(PEDIDO), exigeArmazem: true, oProdutoPede: [],
    esperado: "armazem_id* produto_id quantidade valor_unitario desconto desconto_percentual" },
  { onde: "pedido · layout sem Armazém · regra não exige", familia: PEDIDO, itens: semCampos(PEDIDO, "armazem_id"), exigeArmazem: false, oProdutoPede: [],
    esperado: "produto_id quantidade valor_unitario desconto desconto_percentual" },
  { onde: "pedido · layout sem Armazém · regra exige", familia: PEDIDO, itens: semCampos(PEDIDO, "armazem_id"), exigeArmazem: true, oProdutoPede: [],
    esperado: "armazem_id* produto_id quantidade valor_unitario desconto desconto_percentual" }
];
test("as 11 combinações da compra estão na tabela, sem repetir", () => {
  expect(COMBINACOES_DA_COMPRA).toHaveLength(11);
  const chaves = COMBINACOES_DA_COMPRA.map((x) => JSON.stringify([x.familia, x.itens.map((c) => c.campo), x.exigeArmazem, x.oProdutoPede]));
  expect(new Set(chaves).size, "nenhuma combinação repetida").toBe(chaves.length);
});

test.describe("as colunas que a compra entrega ao motor", () => {
  test("premissa: o layout do sistema da compra e o do pedido têm o Armazém; só o da compra tem Lote e Validade", () => {
    expect(LAYOUT_DO_SISTEMA(COMPRA).itens.map((c) => c.campo)).toEqual(["armazem_id", "produto_id", "quantidade", "valor_unitario", "desconto", "desconto_percentual", "lote", "validade"]);
    expect(LAYOUT_DO_SISTEMA(PEDIDO).itens.map((c) => c.campo)).toEqual(["armazem_id", "produto_id", "quantidade", "valor_unitario", "desconto", "desconto_percentual"]);
  });
  for (const x of COMBINACOES_DA_COMPRA) {
    test(x.onde, () => {
      expect(comoTexto(colunasDoEditor(x.familia, x.itens, forcadasDaCompra(x.familia, x.exigeArmazem, x.oProdutoPede)))).toBe(x.esperado);
    });
  }
});

const estrutura = (cabecalho: EstruturaLayout["cabecalho"], rodape: EstruturaLayout["rodape"] = []): EstruturaLayout =>
  ({ ...LAYOUT_DO_SISTEMA(COMPRA), cabecalho, rodape });
const campo = (c: string, extra: Partial<EstruturaLayout["cabecalho"][number]> = {}) => ({ campo: c, obrigatorio: false, editavel: true, ...extra });

test.describe("zonasDaCentral", () => {
  test("layout do sistema: todos os campos principais, sem adicionais e sem abas", () => {
    const z = zonasDaCentral(PEDIDO, LAYOUT_DO_SISTEMA(PEDIDO));
    expect(z.principais).toEqual(LAYOUT_DO_SISTEMA(PEDIDO).cabecalho.map((x) => x.campo));
    expect(z).toMatchObject({ adicionais: [], abas: [] });
  });

  test("adicionais pelo grupo; abas na ordem do layout; aba vazia some sem renumerar; campo fora do catálogo não é desenhado", () => {
    const z = zonasDaCentral(COMPRA, estrutura(
      [campo("empresa_id"), campo("observacao", { grupo: "adicionais" }), campo("nao_existe"), campo("fornecedor_id", { grupo: "principal" })],
      [{ aba: "Vazia", campos: [campo("nao_existe")] }, { aba: "Nota", campos: [campo("numero_nota"), campo("serie_nota")] }]
    ));
    expect(z).toEqual({ principais: ["empresa_id", "fornecedor_id"], adicionais: ["observacao"], abas: [{ indice: 1, aba: "Nota", campos: ["numero_nota", "serie_nota"] }] });
  });

  test("campo só da compra não é desenhado no pedido", () => {
    expect(zonasDaCentral(PEDIDO, estrutura([campo("empresa_id"), campo("numero_nota")])).principais).toEqual(["empresa_id"]);
  });
});

test.describe("estruturaComExigidos", () => {
  test("nada a forçar: a mesma estrutura, nenhum forçado", () => {
    const e = estrutura([campo("empresa_id")]);
    const r = estruturaComExigidos(COMPRA, e, []);
    expect(r.estrutura).toBe(e);
    expect([...r.forcados]).toEqual([]);
  });

  test("o que falta entra no fim dos principais, editável e sem grupo; o que está numa aba não se repete", () => {
    const e = estrutura([campo("empresa_id", { editavel: false })], [{ aba: "Pagamento", campos: [campo("forma_pagamento_id")] }]);
    const r = estruturaComExigidos(COMPRA, e, ["forma_pagamento_id", "condicao_pagamento_id", "empresa_id"]);
    expect(r.estrutura.cabecalho).toEqual([campo("empresa_id", { editavel: false }), { campo: "condicao_pagamento_id", obrigatorio: false, editavel: true }]);
    expect(r.estrutura.rodape).toEqual(e.rodape);
    expect([...r.forcados]).toEqual(["condicao_pagamento_id"]);
  });

  test("caminho de item (erro do 422 em itens[i].x) e chave fora do catálogo da família não são forçados", () => {
    const r = estruturaComExigidos(PEDIDO, estrutura([campo("empresa_id")]), ["itens[0].lote", "itens.0.quantidade", "numero_nota", "desconhecida", "data_vencimento"]);
    expect([...r.forcados]).toEqual(["data_vencimento"]);
  });
});
