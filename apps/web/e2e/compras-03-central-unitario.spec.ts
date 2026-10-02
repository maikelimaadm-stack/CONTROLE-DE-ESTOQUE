import { test, expect } from "@playwright/test";
import { LAYOUT_DO_SISTEMA, type EstruturaLayout } from "@agro/domain";
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
 * passa `colunasDoLayout` (a única que passava, a Central de Compras, saiu do editor na VISUAL-UX-04).
 */
const COMBINACOES: { onde: string; fields: ColunaDoEditorDeItens[]; comOrigem: boolean }[] = [
  { onde: "frota/manutencoes", fields: ["warehouse", "product", "stock", "quantity", "unit_value"], comOrigem: false },
  { onde: "estoque/devolucoes (com lote)", fields: ["warehouse", "product", "quantity", "unit_value", "lot", "expiration", "cost_center"], comOrigem: false },
  { onde: "estoque/devolucoes (sem lote)", fields: ["warehouse", "product", "quantity", "unit_value", "cost_center"], comOrigem: false },
  { onde: "estoque/baixas", fields: ["product", "stock", "quantity", "lot"], comOrigem: false },
  { onde: "estoque/documentos-fiscais", fields: ["warehouse", "product", "quantity", "unit_value", "discount", "generate_stock", "lot", "expiration", "financial_category", "cost_center"], comOrigem: false },
  { onde: "estoque/entradas", fields: ["warehouse", "product", "quantity", "unit_value", "generate_stock", "lot", "expiration", "financial_category", "cost_center"], comOrigem: false },
  { onde: "estoque/transferencias", fields: ["product", "stock", "quantity", "lot", "cost_center"], comOrigem: false },
  { onde: "estoque/requisicoes", fields: ["warehouse", "product", "stock", "quantity", "lot", "cost_center"], comOrigem: false },
  { onde: "stock/feed-formulas", fields: ["product", "quantity"], comOrigem: false },
  // Limites: o mínimo (só o que sempre aparece) e o máximo (todas as colunas, com a origem)
  { onde: "limite · mínimo", fields: ["product"], comOrigem: false },
  { onde: "limite · todas com origem", fields: ["warehouse", "product", "stock", "quantity", "unit_value", "discount", "discount_percent", "generate_stock", "lot", "expiration", "financial_category", "cost_center"], comOrigem: true }
];
test("as 11 combinações estão na tabela", () => { expect(COMBINACOES).toHaveLength(11); });

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
      [campo("empresa_id"), campo("observacao", { grupo: "adicionais" }), campo("nao_existe"), campo("fornecedor_id", { grupo: "principais" })],
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
