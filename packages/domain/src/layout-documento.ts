/**
 * LAYOUT DO DOCUMENTO (VENDAS-A3-1, decisão 259) — o que a Central de Vendas mostra, em que ordem, com que rótulo,
 * e o que é obrigatório ao salvar. Como no ERP de referência: cadastro próprio por FAMÍLIA da TOP; uma TOP usa UM
 * layout; ordem de escolha: layout ligado à TOP → padrão ativo da família → LAYOUT DO SISTEMA (a tela de hoje).
 *
 * UMA conta só: a API e a tela usam `validarEstruturaLayout`, `resolverLayout` e `camposObrigatoriosFaltando` daqui.
 * O layout governa só a DIGITAÇÃO; os efeitos continuam presos à versão da TOP do documento. O valor padrão é literal,
 * variável ou (VENDAS-A3-1b) registro de cadastro: aqui só a forma (UUID) e o lugar; a existência é conferida pela API.
 *
 * COMPRAS-03 (decisão 269): o MESMO mecanismo vale para o Pedido de compra e a Compra. O que era "de venda" e passa a
 * ser POR FAMÍLIA: o catálogo (`catalogoDaFamilia`), a chave das linhas no corpo (`chaveDosItensDaFamilia`) e a coluna
 * que aceita padrão de cadastro (`colunasComPadraoRegistro`). Vendas não muda um byte.
 */

import { TIPOS_OPERACAO, tipoOperacao } from "./tipo-operacao.js";

/** As variantes de uma tabela, LIDAS do registry (dono único da lista), na ordem do registry. */
const variantesDaTabela = (tabela: string): string[] => TIPOS_OPERACAO.filter((t) => t.origem.tabela === tabela).map((t) => t.codigo);
/** As famílias da Central de Vendas: as variantes de `erp.sales_documents` (orçamento, pedido, venda). */
export const FAMILIAS_COM_LAYOUT_DE_VENDAS: readonly string[] = Object.freeze(variantesDaTabela("erp.sales_documents"));
/** COMPRAS-03: as famílias da Central de Compras: as variantes de `erp.documentos_compra` (pedido, compra e, desde a
 *  F6a, orçamento). */
export const FAMILIAS_COM_LAYOUT_DE_COMPRAS: readonly string[] = Object.freeze(variantesDaTabela("erp.documentos_compra"));
/**
 * Todas as famílias com layout. VENDAS PRIMEIRO, de propósito: no registry as de compras vêm antes das de vendas, e o
 * "Novo" do configurador (e toda lista que pega a primeira família) tem de continuar começando por vendas. Esta é a
 * ordem das listas de Movimento na tela.
 */
export const FAMILIAS_COM_LAYOUT: readonly string[] = Object.freeze([...FAMILIAS_COM_LAYOUT_DE_VENDAS, ...FAMILIAS_COM_LAYOUT_DE_COMPRAS]);
export type FamiliaComLayout = string;
export function familiaTemLayout(f: string): f is FamiliaComLayout { return FAMILIAS_COM_LAYOUT.includes(f); }
/** COMPRAS-03: a família é do documento de compra (pedido ou compra)? */
export function familiaDeCompras(f: string): boolean { return FAMILIAS_COM_LAYOUT_DE_COMPRAS.includes(f); }
const familiaDeVendas = (f: string): boolean => FAMILIAS_COM_LAYOUT_DE_VENDAS.includes(f);

export type ParteDoLayout = "cabecalho" | "rodape" | "itens";
export type TipoDoCampoLayout = "referencia" | "empresa" | "data" | "texto" | "texto_longo" | "numero" | "booleano" | "plano";
export type VariavelPadrao = "data_atual" | "empresa_selecionada";
/**
 * `registro` (VENDAS-A3-1b): um registro de CADASTRO já escolhido no layout (natureza, condição, armazém...). O recurso
 * NÃO vai no JSON — sai do catálogo pelo campo (`referencia`), para não haver par campo/recurso trocado. A existência
 * do registro é conferida pela API ao gravar o layout e a cada uso; o domínio só confere a forma (UUID) e o lugar.
 */
export type ValorPadraoLayout = { tipo: "literal"; valor: string | number | boolean } | { tipo: "variavel"; variavel: VariavelPadrao } | { tipo: "registro"; id: string };

/**
 * Campo do catálogo. `chave` = a chave do corpo enviado à API (cabeçalho/rodapé) ou da linha do item.
 * `sistema`: obrigatório hoje pela tela ou pelo servidor — "sempre", ou "classificacao" (só quando a API declara a
 * classificação financeira). `somenteLeitura`: por natureza (estoque, total) — nunca obrigatório nem editável.
 * `exige`: o campo só existe com a capacidade da API ("classificacao" A1, "condicao" A4).
 */
export interface CampoDoCatalogo {
  chave: string;
  rotulo: string;
  parte: ParteDoLayout;
  /** aba padrão (só rodapé) */
  aba?: string;
  tipo: TipoDoCampoLayout;
  sistema?: "sempre" | "classificacao";
  somenteLeitura?: boolean;
  exige?: "classificacao" | "condicao";
  /**
   * O corpo SEMPRE leva valor ("0", false, ou o plano nulo que o servidor deriva da condição): "obrigatório" nele
   * diria uma coisa e faria outra (ou travaria a Central, no Parcelamento). Aceita valor padrão e não editável.
   */
  sempreTemValor?: boolean;
  /**
   * VENDAS-A3-1b: o cadastro de onde vem o valor de um campo "referencia" — o MESMO recurso e filtro que a Central usa
   * no RefSelect. Dono único: a API (conferência do padrão registro) e a tela (RefSelect do padrão) leem daqui.
   */
  referencia?: { recurso: string; filtro?: Readonly<Record<string, string>> };
}

const C = (chave: string, rotulo: string, tipo: TipoDoCampoLayout, extra: Partial<CampoDoCatalogo> = {}): CampoDoCatalogo => ({ chave, rotulo, parte: "cabecalho", tipo, ...extra });
const R = (aba: string, chave: string, rotulo: string, tipo: TipoDoCampoLayout, extra: Partial<CampoDoCatalogo> = {}): CampoDoCatalogo => ({ chave, rotulo, parte: "rodape", aba, tipo, ...extra });
const I = (chave: string, rotulo: string, tipo: TipoDoCampoLayout, extra: Partial<CampoDoCatalogo> = {}): CampoDoCatalogo => ({ chave, rotulo, parte: "itens", tipo, ...extra });

/** O catálogo das vendas (orçamento, pedido, venda): exatamente os campos da Central de hoje; nos itens, o Local de estoque antes do produto (decisão 280). */
export const CATALOGO_VENDAS: readonly CampoDoCatalogo[] = [
  C("client_id", "Cliente", "referencia", { sistema: "sempre", referencia: { recurso: "people", filtro: { is_client: "true" } } }),
  C("empresa_id", "Empresa", "empresa", { sistema: "sempre" }),
  C("document_date", "Data", "data", { sistema: "sempre" }),
  C("due_date", "Vencimento", "data"),
  C("payment_method_id", "Forma de pagamento", "referencia", { referencia: { recurso: "payment_methods" } }),
  C("categoria_financeira_id", "Natureza", "referencia", { sistema: "classificacao", exige: "classificacao", referencia: { recurso: "financial_categories", filtro: { kind: "analytic", nature: "income" } } }),
  C("centro_custo_id", "Centro de resultado", "referencia", { sistema: "classificacao", exige: "classificacao", referencia: { recurso: "cost_centers", filtro: { kind: "analytic" } } }),
  C("shipping_date", "Data de saída", "data"),
  C("proprietary_id", "Proprietário", "referencia", { referencia: { recurso: "people", filtro: { is_proprietary: "true" } } }),
  R("Totais", "discount", "Desconto", "numero", { sempreTemValor: true }),
  R("Totais", "other_values", "Outros valores", "numero", { sempreTemValor: true }),
  R("Financeiro", "condicao_pagamento_id", "Condição de pagamento", "referencia", { exige: "condicao", referencia: { recurso: "condicoes_pagamento" } }),
  R("Financeiro", "installment_plan", "Parcelamento", "plano", { sempreTemValor: true }),
  R("Frete e transporte", "transporter_id", "Transportadora", "referencia", { referencia: { recurso: "people", filtro: { is_transporter: "true" } } }),
  R("Frete e transporte", "driver_name", "Motorista", "texto"),
  R("Frete e transporte", "freight", "Frete", "numero", { sempreTemValor: true }),
  R("Frete e transporte", "freight_icms", "ICMS frete", "numero", { sempreTemValor: true }),
  R("Fiscal", "is_deductible", "Dedutível", "booleano", { sempreTemValor: true }),
  R("Observações", "note", "Observação", "texto_longo"),
  // OPERACOES-01 F3b (decisão 280): o Local de estoque vem antes do produto; o Código fica junto do Produto
  I("warehouse_id", "Local de estoque", "referencia", { referencia: { recurso: "warehouses" } }),
  I("codigo", "Código", "texto", { somenteLeitura: true }),
  I("product_id", "Produto", "referencia", { sistema: "sempre" }),
  I("estoque", "Estoque", "numero", { somenteLeitura: true }),
  I("quantity", "Quantidade", "numero", { sistema: "sempre" }),
  I("unit_price", "Valor unitário", "numero", { sistema: "sempre" }),
  I("discount", "Desconto", "numero", { sempreTemValor: true }),
  I("discount_percent", "Desconto %", "numero", { sempreTemValor: true }),
  I("total", "Total", "numero", { somenteLeitura: true })
];

/**
 * COMPRAS-03 (decisão 269): o catálogo do Pedido de compra e da Compra — as chaves do CORPO da compra (o que a Central
 * de Compras envia à API), na ordem e com os rótulos da Central de Compras de hoje. Tudo é "cabecalho": a Central de
 * Compras não tem rodapé com abas, e o layout do sistema põe tudo no grupo principal. `daCompra` acrescenta o que só a
 * Compra tem (entrada, nota, lote e validade): o Pedido não conhece esses campos, e o layout dele não pode citá-los.
 *
 * NÃO são "do sistema", de propósito: Natureza de despesa e Centro de resultado. Quem os exige é a REGRA da TOP quando a
 * compra gera título; cobrá-los sempre recusaria o pedido que não gera título. Nenhum campo tem `exige`: a API de compras
 * sempre declara classificação e condição. Natureza de despesa SEM `referencia`: o filtro dela (despesa OU ambas) não
 * cabe no filtro de igualdade do padrão de cadastro — sem `referencia`, o domínio recusa padrão registro nela.
 */
function catalogoDeCompras(daCompra: boolean): readonly CampoDoCatalogo[] {
  const soNaCompra = (c: CampoDoCatalogo): CampoDoCatalogo[] => (daCompra ? [c] : []);
  return Object.freeze([
    C("empresa_id", "Empresa", "empresa", { sistema: "sempre" }),
    C("fornecedor_id", "Fornecedor", "referencia", { sistema: "sempre", referencia: { recurso: "people", filtro: { is_provider: "true" } } }),
    C("data_documento", "Data do documento", "data", { sistema: "sempre" }),
    ...soNaCompra(C("data_entrada", "Data de entrada", "data")),
    C("data_vencimento", "Vencimento", "data"),
    ...soNaCompra(C("numero_nota", "Número da nota", "texto")),
    ...soNaCompra(C("serie_nota", "Série", "texto")),
    C("transportadora_id", "Transportadora", "referencia", { referencia: { recurso: "people", filtro: { is_transporter: "true" } } }),
    C("categoria_financeira_id", "Natureza de despesa", "referencia"),
    C("centro_custo_id", "Centro de resultado", "referencia", { referencia: { recurso: "cost_centers", filtro: { kind: "analytic" } } }),
    C("condicao_pagamento_id", "Condição de pagamento", "referencia", { referencia: { recurso: "condicoes_pagamento" } }),
    C("forma_pagamento_id", "Forma de pagamento", "referencia", { referencia: { recurso: "payment_methods" } }),
    C("frete", "Frete", "numero", { sempreTemValor: true }),
    C("outras_despesas", "Outras despesas", "numero", { sempreTemValor: true }),
    C("desconto", "Desconto", "numero", { sempreTemValor: true }),
    C("plano_parcelas", "Parcelas", "plano", { sempreTemValor: true }),
    C("observacao", "Observação", "texto_longo"),
    // o Local de estoque antes do Produto (decisão 280); a ordem é a do ItemsEditor de hoje
    I("armazem_id", "Local de estoque", "referencia", { referencia: { recurso: "warehouses" } }),
    I("produto_id", "Produto", "referencia", { sistema: "sempre" }),
    I("quantidade", "Quantidade", "numero", { sistema: "sempre" }),
    I("valor_unitario", "Valor unitário", "numero", { sistema: "sempre" }),
    I("desconto", "Desconto", "numero", { sempreTemValor: true }),
    I("desconto_percentual", "Desconto %", "numero", { sempreTemValor: true }),
    ...soNaCompra(I("lote", "Lote", "texto")),
    ...soNaCompra(I("validade", "Validade", "data"))
  ]);
}
/**
 * OPERACOES-01 F6a (decisão 283): o catálogo do ORÇAMENTO DE COMPRA — as chaves do corpo do orçamento (criar e editar).
 * O orçamento nasce do pedido: empresa e itens (produto e quantidade) vêm dele; o que se digita é o preço de cada item,
 * a condição, o prazo de entrega (dias), a validade e a observação. Sem frete, outras despesas, desconto, natureza,
 * centro, transportadora, forma de pagamento, parcelas, Local de estoque, lote e validade de item: o orçamento não mexe
 * em estoque nem em financeiro, e o layout dele não pode citar o que o corpo não tem.
 */
function catalogoDoOrcamento(): readonly CampoDoCatalogo[] {
  return Object.freeze([
    C("empresa_id", "Empresa", "empresa", { sistema: "sempre" }),
    C("fornecedor_id", "Fornecedor", "referencia", { sistema: "sempre", referencia: { recurso: "people", filtro: { is_provider: "true" } } }),
    C("data_documento", "Data do documento", "data", { sistema: "sempre" }),
    C("condicao_pagamento_id", "Condição de pagamento", "referencia", { referencia: { recurso: "condicoes_pagamento" } }),
    C("prazo_entrega_dias", "Prazo de entrega (dias)", "numero"),
    C("validade_orcamento", "Validade do orçamento", "data"),
    C("observacao", "Observação", "texto_longo"),
    I("produto_id", "Produto", "referencia", { sistema: "sempre" }),
    I("quantidade", "Quantidade", "numero", { sistema: "sempre" }),
    I("valor_unitario", "Valor unitário", "numero", { sistema: "sempre" })
  ]);
}
/**
 * Pela ESPÉCIE do documento (`erp.documentos_compra.especie`, o valor que o banco persiste), lida do registry pela
 * variante da família — nunca pelo código da família, para o registry continuar sendo o único dono da lista de famílias.
 * Espécie nova no registry sem catálogo aqui: nenhum campo (fail-closed), nunca o catálogo da vizinha.
 */
const CATALOGO_DE_COMPRAS_POR_ESPECIE: ReadonlyMap<string, readonly CampoDoCatalogo[]> = new Map([
  ["pedido", catalogoDeCompras(false)],
  ["compra", catalogoDeCompras(true)],
  ["orcamento", catalogoDoOrcamento()]
]);

/** O catálogo da família: vendas → CATALOGO_VENDAS; compras → o da espécie; outra → nenhum (fail-closed). */
export function catalogoDaFamilia(familia: string): readonly CampoDoCatalogo[] {
  if (familiaDeVendas(familia)) return CATALOGO_VENDAS;
  if (familiaDeCompras(familia)) return CATALOGO_DE_COMPRAS_POR_ESPECIE.get(tipoOperacao(familia)?.origem.valor ?? "") ?? [];
  return [];
}

/**
 * COMPRAS-03: a chave das LINHAS no corpo do documento — "items" em vendas (o corpo de sales), "itens" em compras. É
 * também a dona do caminho do erro do item (`items[i].x` × `itens[i].x`), que a tela usa para apontar o 422 no campo.
 */
export function chaveDosItensDaFamilia(familia: string): "items" | "itens" { return familiaDeCompras(familia) ? "itens" : "items"; }

/* ─────────────── ESTRUTURA (versaoSchema 1) ─────────────── */
/**
 * VENDAS-A3-1c (decisão 261): `grupo` só no CABEÇALHO — "principal" (Dados principais) ou "adicionais" (Dados adicionais,
 * recolhível na Central). Ausente = principal. Estrutura em que NENHUM campo do cabeçalho declara grupo segue a regra de
 * antes (Proprietário em Dados adicionais): compatibilidade com layout gravado antes da fatia.
 */
export type GrupoDoCabecalho = "principal" | "adicionais";
export const GRUPOS_DO_CABECALHO: readonly GrupoDoCabecalho[] = Object.freeze(["principal", "adicionais"]);
export interface CampoDoLayout { campo: string; rotulo?: string; obrigatorio: boolean; editavel: boolean; valorPadrao?: ValorPadraoLayout; grupo?: GrupoDoCabecalho }
export interface AbaDoLayout { aba: string; campos: CampoDoLayout[] }
/** `valorPadrao` (VENDAS-A3-1b): só na coluna Armazém e só do tipo registro. */
export interface ColunaDoLayout { campo: string; rotulo?: string; obrigatorio: boolean; valorPadrao?: ValorPadraoLayout }
export interface EstruturaLayout { versaoSchema: 1; cabecalho: CampoDoLayout[]; rodape: AbaDoLayout[]; itens: ColunaDoLayout[] }
export interface ErroDoLayout { caminho: string; mensagem: string }

/** LAYOUT DO SISTEMA: a Central de hoje — todos os campos, ordem, rótulos e obrigatórios de hoje. */
export function LAYOUT_DO_SISTEMA(familia: string): EstruturaLayout {
  const cat = catalogoDaFamilia(familia);
  const cab = cat.filter((c) => c.parte === "cabecalho").map((c): CampoDoLayout => ({ campo: c.chave, obrigatorio: Boolean(c.sistema), editavel: true, ...(CAMPOS_ADICIONAIS_DO_SISTEMA.includes(c.chave) ? { grupo: "adicionais" as const } : {}) }));
  const abas: AbaDoLayout[] = [];
  for (const c of cat.filter((x) => x.parte === "rodape")) {
    let a = abas.find((x) => x.aba === c.aba); if (!a) { a = { aba: c.aba!, campos: [] }; abas.push(a); }
    a.campos.push({ campo: c.chave, obrigatorio: Boolean(c.sistema), editavel: true });
  }
  const itens = cat.filter((c) => c.parte === "itens").map((c): ColunaDoLayout => ({ campo: c.chave, obrigatorio: Boolean(c.sistema) }));
  return { versaoSchema: 1, cabecalho: cab, rodape: abas, itens };
}

/**
 * Que valores padrão um campo do catálogo aceita. `registro` (VENDAS-A3-1b): só em campo "referencia" que declara o
 * cadastro (`referencia`) e só com id em forma de UUID — "Empresa" (tipo empresa) continua só com a variável. ONDE
 * vale nos itens (só a coluna Armazém) é conferido na coluna; a existência do registro é da API.
 */
function padraoCompativel(c: CampoDoCatalogo, v: ValorPadraoLayout): boolean {
  const tipo = c.tipo;
  if (v.tipo === "variavel") return (v.variavel === "data_atual" && tipo === "data") || (v.variavel === "empresa_selecionada" && tipo === "empresa");
  if (v.tipo === "registro") return tipo === "referencia" && Boolean(c.referencia) && typeof v.id === "string" && FORMA_UUID_PADRAO.test(v.id);
  switch (tipo) {
    case "data": return typeof v.valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.valor);
    case "texto": case "texto_longo": return typeof v.valor === "string";
    case "numero": return (typeof v.valor === "number" && Number.isFinite(v.valor)) || (typeof v.valor === "string" && /^-?\d+(\.\d+)?$/.test(v.valor));
    case "booleano": return typeof v.valor === "boolean";
    default: return false;
  }
}

/** Recusa do obrigatório em campo que sempre tem valor (R1). */
export const mensagemSempreTemValor = (rotulo: string) => `"${rotulo}" sempre tem valor: não pode ser obrigatório.`;

/** Regras do layout → erros por caminho (vazio = válido). */
export function validarEstruturaLayout(familia: string, estrutura: EstruturaLayout): ErroDoLayout[] {
  const e: ErroDoLayout[] = [];
  const cat = catalogoDaFamilia(familia);
  if (!cat.length) return [{ caminho: "familia", mensagem: "Movimento sem layout de documento." }];
  if (!estrutura || estrutura.versaoSchema !== 1) return [{ caminho: "estrutura.versaoSchema", mensagem: "Versão da estrutura desconhecida." }];
  const porChave = (parte: ParteDoLayout) => new Map(cat.filter((c) => c.parte === parte).map((c) => [c.chave, c]));
  // VENDAS-A3-1c (decisão 261): campo do DOCUMENTO (cabeçalho ou rodapé no catálogo) vale em qualquer zona do documento
  const doDocumento = new Map(cat.filter((c) => c.parte !== "itens").map((c) => [c.chave, c]));
  const it = porChave("itens");
  const vistosDoc = new Set<string>();
  const conferirCampo = (x: CampoDoLayout, caminho: string, zona: ZonaDoLayout) => {
    const c = doDocumento.get(x.campo);
    if (!c) { e.push({ caminho: `${caminho}.campo`, mensagem: `Campo "${x.campo}" não existe nesta parte do documento.` }); return; }
    if (motivoZonaProibida(familia, x.campo, zona) !== null) { e.push({ caminho: `${caminho}.campo`, mensagem: mensagemSoNoRodape(c.rotulo) }); return; }
    if (zona.tipo === "aba" && x.grupo !== undefined) e.push({ caminho: `${caminho}.grupo`, mensagem: MENSAGEM_GRUPO_SO_NO_CABECALHO });
    if (vistosDoc.has(x.campo)) { e.push({ caminho: `${caminho}.campo`, mensagem: `Campo "${c.rotulo}" repetido no layout.` }); return; }
    vistosDoc.add(x.campo);
    if (c.somenteLeitura && (x.obrigatorio || x.editavel)) e.push({ caminho, mensagem: `"${c.rotulo}" é só leitura: não pode ser obrigatório nem editável.` });
    if (c.sempreTemValor && x.obrigatorio) e.push({ caminho: `${caminho}.obrigatorio`, mensagem: mensagemSempreTemValor(c.rotulo) });
    if (x.valorPadrao && !padraoCompativel(c, x.valorPadrao)) e.push({ caminho: `${caminho}.valorPadrao`, mensagem: `Valor padrão incompatível com "${c.rotulo}".` });
    if (x.obrigatorio && !x.editavel && !x.valorPadrao) e.push({ caminho: `${caminho}.valorPadrao`, mensagem: `"${c.rotulo}" é obrigatório e não editável: informe o valor padrão.` });
  };
  estrutura.cabecalho.forEach((x, i) => conferirCampo(x, `cabecalho[${i}]`, { tipo: x.grupo === "adicionais" ? "adicionais" : "principal" }));
  estrutura.rodape.forEach((a, ai) => {
    if (!a.campos.length) e.push({ caminho: `rodape[${ai}]`, mensagem: `A aba "${a.aba}" está vazia.` });
    a.campos.forEach((x, i) => conferirCampo(x, `rodape[${ai}].campos[${i}]`, { tipo: "aba", indice: ai }));
  });
  const vistosItem = new Set<string>();
  const colunasComPadrao = colunasComPadraoRegistro(familia);
  estrutura.itens.forEach((x, i) => {
    const c = it.get(x.campo); const caminho = `itens[${i}]`;
    if (!c) { e.push({ caminho: `${caminho}.campo`, mensagem: `Coluna "${x.campo}" não existe nos itens.` }); return; }
    if (vistosItem.has(x.campo)) { e.push({ caminho: `${caminho}.campo`, mensagem: `Coluna "${c.rotulo}" repetida.` }); return; }
    vistosItem.add(x.campo);
    if (c.somenteLeitura && x.obrigatorio) e.push({ caminho, mensagem: `"${c.rotulo}" é só leitura: não pode ser obrigatória.` });
    if (c.sempreTemValor && x.obrigatorio) e.push({ caminho: `${caminho}.obrigatorio`, mensagem: mensagemSempreTemValor(c.rotulo) });
    // VENDAS-A3-1b: valor padrão de coluna só na coluna Armazém e só do tipo registro (UUID); COMPRAS-03: a da família
    // COMPRAS-03_R1: em compras, lote e validade têm a recusa própria (mais clara) — uma mensagem só por campo
    const temRecusaPropria = familiaDeCompras(familia) && (x.campo === "lote" || x.campo === "validade");
    if (x.valorPadrao && !temRecusaPropria && !(colunasComPadrao.includes(x.campo) && x.valorPadrao.tipo === "registro" && padraoCompativel(c, x.valorPadrao)))
      e.push({ caminho: `${caminho}.valorPadrao`, mensagem: `Valor padrão incompatível com "${c.rotulo}".` });
  });
  // campo "do sistema" fora do layout SEM valor padrão (coluna do sistema não tem padrão: tem de estar lá)
  const caminhoDe = (campo: string): string => {
    const i = estrutura.cabecalho.findIndex((x) => x.campo === campo); if (i >= 0) return `cabecalho[${i}]`;
    for (const [ai, a] of estrutura.rodape.entries()) { const j = a.campos.findIndex((x) => x.campo === campo); if (j >= 0) return `rodape[${ai}].campos[${j}]`; }
    return campo;
  };
  const noLayout = new Map<string, CampoDoLayout>([...estrutura.cabecalho, ...estrutura.rodape.flatMap((a) => a.campos)].map((x) => [x.campo, x]));
  for (const c of cat) {
    if (!c.sistema) continue;
    if (c.parte === "itens") {
      const i = estrutura.itens.findIndex((x) => x.campo === c.chave);
      if (i < 0) e.push({ caminho: "itens", mensagem: `A coluna "${c.rotulo}" é obrigatória do sistema e tem de estar no layout.` });
      else if (!estrutura.itens[i]!.obrigatorio) e.push({ caminho: `itens[${i}].obrigatorio`, mensagem: `A coluna "${c.rotulo}" é obrigatória do sistema: não pode ficar opcional.` });
      continue;
    }
    const x = noLayout.get(c.chave);
    if (!x) e.push({ caminho: c.parte, mensagem: `"${c.rotulo}" é obrigatório do sistema: ponha no layout.` });
    else if (!x.obrigatorio) e.push({ caminho: caminhoDe(x.campo) + ".obrigatorio", mensagem: `"${c.rotulo}" é obrigatório do sistema: não pode ficar opcional.` });
  }
  if (familiaDeCompras(familia)) conferirRegrasDeCompras(estrutura, noLayout, caminhoDe, e);
  return e;
}

/**
 * COMPRAS-03_R1 (decisão 269): o que o lançar de compras SEMPRE recusaria é recusado já na gravação do layout. Só nas
 * famílias de compras — vendas não passa por aqui (a saída de vendas não muda). Cada recusa aponta o campo.
 *  - Lote e Validade: o layout só decide se aparecem, rótulo e ordem; quem os exige é a regra do produto, item a item.
 *  - Série só com Número da nota no layout; Série fixa (padrão e não editável) só com Número editável.
 *  - Natureza de despesa e Centro de resultado: os dois no layout ou os dois fora, com o mesmo "obrigatório"; Centro fixo
 *    (padrão e não editável) só com Natureza no layout e editável.
 */
function conferirRegrasDeCompras(estrutura: EstruturaLayout, noLayout: ReadonlyMap<string, CampoDoLayout>, caminhoDe: (campo: string) => string, e: ErroDoLayout[]): void {
  estrutura.itens.forEach((x, i) => {
    if (x.campo !== "lote" && x.campo !== "validade") return;
    const rotulo = x.campo === "lote" ? "Lote" : "Validade";
    if (x.obrigatorio) e.push({ caminho: `itens[${i}].obrigatorio`, mensagem: `"${rotulo}" é exigido pela regra do produto: o layout não o torna obrigatório.` });
    if (x.valorPadrao) e.push({ caminho: `itens[${i}].valorPadrao`, mensagem: `"${rotulo}" é informado item a item: não aceita valor padrão.` });
  });
  const fixo = (x: CampoDoLayout) => Boolean(x.valorPadrao) && !x.editavel;
  const serie = noLayout.get("serie_nota"); const numero = noLayout.get("numero_nota");
  if (serie && !numero) e.push({ caminho: `${caminhoDe("serie_nota")}.campo`, mensagem: `"Série" só entra no layout com "Número da nota".` });
  else if (serie && numero && fixo(serie) && !numero.editavel)
    e.push({ caminho: `${caminhoDe("serie_nota")}.editavel`, mensagem: `"Série" com valor padrão fixo exige "Número da nota" editável.` });
  const natureza = noLayout.get("categoria_financeira_id"); const centro = noLayout.get("centro_custo_id");
  if (natureza && !centro) e.push({ caminho: `${caminhoDe("categoria_financeira_id")}.campo`, mensagem: `"Natureza de despesa" e "Centro de resultado" entram juntos no layout: ponha também "Centro de resultado".` });
  if (centro && !natureza) e.push({ caminho: `${caminhoDe("centro_custo_id")}.campo`, mensagem: `"Natureza de despesa" e "Centro de resultado" entram juntos no layout: ponha também "Natureza de despesa".` });
  if (natureza && centro) {
    if (natureza.obrigatorio !== centro.obrigatorio)
      e.push({ caminho: `${caminhoDe("centro_custo_id")}.obrigatorio`, mensagem: `"Centro de resultado" e "Natureza de despesa" têm de ser ambos obrigatórios ou ambos opcionais.` });
    if (fixo(centro) && !natureza.editavel)
      e.push({ caminho: `${caminhoDe("centro_custo_id")}.editavel`, mensagem: `"Centro de resultado" com valor padrão fixo exige "Natureza de despesa" editável.` });
  }
}

export type OrigemDoLayout = "ligado" | "padrao_da_familia" | "sistema";
/** Ordem de escolha: layout ligado à TOP → padrão ativo da família → layout do sistema. */
export function resolverLayout(familia: string, a: { ligado?: EstruturaLayout | null; padraoDaFamilia?: EstruturaLayout | null }): { estrutura: EstruturaLayout; origem: OrigemDoLayout } {
  if (a.ligado) return { estrutura: a.ligado, origem: "ligado" };
  if (a.padraoDaFamilia) return { estrutura: a.padraoDaFamilia, origem: "padrao_da_familia" };
  return { estrutura: LAYOUT_DO_SISTEMA(familia), origem: "sistema" };
}

const vazio = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const ehLinha = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === "object" && v !== null;

/**
 * Obrigatórios do layout que o documento deixa vazios → [{ caminho, rotulo }]. `documento` tem as chaves do corpo
 * da API (o valor que o documento TERÁ depois de gravar) e as linhas em `documento[chaveDosItensDaFamilia(familia)]`
 * ("items" em vendas, "itens" em compras). Caminho do item: `<chave>[i].<campo>` — em vendas `items[i].<campo>`, como
 * sempre foi. Campo com `exige` que a API não declara (`capacidades`) não é cobrado. Linha que não é objeto conta como
 * linha vazia (cobra tudo): falhar fechado, nunca pular a linha.
 */
export function camposObrigatoriosFaltando(familia: string, estrutura: EstruturaLayout, documento: Record<string, unknown>, capacidades: { classificacao?: boolean; condicao?: boolean } = {}): { caminho: string; rotulo: string }[] {
  // VENDAS-A3-1c: campo do documento achado pela CHAVE em qualquer zona (cabeçalho ou aba); coluna só nos itens
  const cat = new Map(catalogoDaFamilia(familia).map((c) => [c.parte === "itens" ? `itens:${c.chave}` : `documento:${c.chave}`, c]));
  const ativo = (c: CampoDoCatalogo | undefined) => Boolean(c) && (!c!.exige || (c!.exige === "classificacao" ? capacidades.classificacao : capacidades.condicao));
  const out: { caminho: string; rotulo: string }[] = [];
  const topo = (x: CampoDoLayout) => {
    const c = cat.get(`documento:${x.campo}`);
    // sempreTemValor: defesa para estrutura gravada antes da regra (R1) — nunca cobrado
    if (!x.obrigatorio || !ativo(c) || c!.somenteLeitura || c!.sempreTemValor) return;
    if (vazio(documento[x.campo])) out.push({ caminho: x.campo, rotulo: x.rotulo ?? c!.rotulo });
  };
  estrutura.cabecalho.forEach((x) => topo(x));
  estrutura.rodape.forEach((a) => a.campos.forEach((x) => topo(x)));
  const chave = chaveDosItensDaFamilia(familia);
  const linhas: unknown = documento[chave];
  const lista: readonly unknown[] = Array.isArray(linhas) ? linhas : [];
  lista.forEach((linha, i) => {
    const l: Readonly<Record<string, unknown>> = ehLinha(linha) ? linha : {};
    for (const x of estrutura.itens) {
      const c = cat.get(`itens:${x.campo}`);
      if (!x.obrigatorio || !c || c.somenteLeitura || c.sempreTemValor) continue;
      if (vazio(l[x.campo])) out.push({ caminho: `${chave}[${i}].${x.campo}`, rotulo: x.rotulo ?? c.rotulo });
    }
  });
  return out;
}

/** Capacidade declarada pela API em operation-types (capacidades.layoutDocumento), DEPOIS de condicaoPagamento. */
export const CAPACIDADE_LAYOUT_DOCUMENTO = 1;
/** Código da recusa ao salvar: obrigatório do layout vazio. Mensagem por campo: mensagemCampoObrigatorio(rotulo). */
export const ERRO_LAYOUT_CAMPO_OBRIGATORIO = "LAYOUT_CAMPO_OBRIGATORIO";
export const mensagemCampoObrigatorio = (rotulo: string) => `O campo '${rotulo}' é obrigatório nesta operação.`;

/* ─────────────── VENDAS-A3-1b: padrão de CADASTRO (registro) e arquivo do layout ─────────────── */
/**
 * Colunas de item que aceitam padrão registro (só o Armazém) — as de VENDAS. Continua exportada para quem já a importa;
 * a regra (validação e configurador) passa pela família: `colunasComPadraoRegistro`.
 */
export const COLUNAS_COM_PADRAO_REGISTRO: readonly string[] = Object.freeze(["warehouse_id"]);
const COLUNAS_COM_PADRAO_REGISTRO_DE_COMPRAS: readonly string[] = Object.freeze(["armazem_id"]);
const NENHUMA_COLUNA: readonly string[] = Object.freeze([]);
/** OPERACOES-01 F6a: todas as `colunas` existem nos itens do catálogo da família? */
const colunasDoCatalogo = (familia: string, colunas: readonly string[]): boolean =>
  colunas.every((col) => catalogoDaFamilia(familia).some((c) => c.parte === "itens" && c.chave === col));
/** COMPRAS-03: as colunas de item que aceitam padrão registro NA FAMÍLIA — o Armazém de cada corpo; outra família, nenhuma. */
export function colunasComPadraoRegistro(familia: string): readonly string[] {
  if (familiaDeVendas(familia)) return COLUNAS_COM_PADRAO_REGISTRO;
  // OPERACOES-01 F6a: só a espécie cujo catálogo TEM a coluna (o orçamento de compra não tem Local de estoque: nenhuma).
  if (familiaDeCompras(familia)) return colunasDoCatalogo(familia, COLUNAS_COM_PADRAO_REGISTRO_DE_COMPRAS) ? COLUNAS_COM_PADRAO_REGISTRO_DE_COMPRAS : NENHUMA_COLUNA;
  return NENHUMA_COLUNA;
}
/** Chave do padrão de cadastro nos mapas da API: o campo (cabeçalho/rodapé) ou "itens.<coluna>". */
export const chavePadraoDeCadastro = (parte: ParteDoLayout, campo: string) => (parte === "itens" ? `itens.${campo}` : campo);
export const FORMA_UUID_PADRAO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Recusa ao gravar/importar: a MESMA para inexistente, de outra organização, inativo, excluído e fora do filtro. */
export const mensagemRegistroPadraoInvalido = (rotulo: string) => `Registro padrão inválido para "${rotulo}".`;
/** Aviso no editor quando o padrão gravado morreu. */
export const AVISO_PADRAO_REGISTRO_MORTO = "O registro padrão não vale mais (inativo ou excluído). Escolha outro.";
/** Aviso na Central quando o padrão de um campo morreu (o campo fica editável nessa abertura). */
export const AVISO_PADRAO_INVALIDO_CENTRAL = "O valor padrão deste campo não vale mais no cadastro. Ajuste o layout.";
/** Arquivo exportado: { formato, versao, familia, nome, estrutura }. */
export const FORMATO_ARQUIVO_LAYOUT = "layout-documento";
export const VERSAO_ARQUIVO_LAYOUT = 1;
export interface ArquivoLayoutDocumento { formato: typeof FORMATO_ARQUIVO_LAYOUT; versao: typeof VERSAO_ARQUIVO_LAYOUT; familia: string; nome: string; estrutura: EstruturaLayout }

export interface PadraoRegistroDaEstrutura {
  /** chavePadraoDeCadastro: o campo, ou "itens.<coluna>" */
  chave: string;
  /** caminho do valor padrão na estrutura, ex.: "rodape[1].campos[0].valorPadrao", "itens[2].valorPadrao" */
  caminho: string;
  parte: ParteDoLayout;
  campo: string;
  id: string;
  /** rótulo do campo: o do layout, ou o do catálogo */
  rotulo: string;
  /** recurso e filtro do catálogo; ausente se o campo não é de referência (a validação do domínio recusa) */
  referencia?: { recurso: string; filtro?: Readonly<Record<string, string>> };
}

/** Todos os padrões `registro` da estrutura, com o recurso tirado do CATÁLOGO pelo campo. */
export function padroesRegistroDaEstrutura(familia: string, estrutura: EstruturaLayout): PadraoRegistroDaEstrutura[] {
  const cat = catalogoDaFamilia(familia);
  const doCatalogo = (parte: ParteDoLayout, campo: string) =>
    cat.find((c) => c.chave === campo && (parte === "itens" ? c.parte === "itens" : c.parte !== "itens"));
  const out: PadraoRegistroDaEstrutura[] = [];
  const ver = (parte: ParteDoLayout, x: { campo: string; rotulo?: string; valorPadrao?: ValorPadraoLayout }, caminho: string) => {
    if (x.valorPadrao?.tipo !== "registro") return;
    const c = doCatalogo(parte, x.campo);
    out.push({ chave: chavePadraoDeCadastro(parte, x.campo), caminho: `${caminho}.valorPadrao`, parte, campo: x.campo, id: x.valorPadrao.id,
      rotulo: x.rotulo ?? c?.rotulo ?? x.campo, ...(c?.referencia ? { referencia: c.referencia } : {}) });
  };
  estrutura.cabecalho.forEach((x, i) => ver("cabecalho", x, `cabecalho[${i}]`));
  estrutura.rodape.forEach((a, ai) => a.campos.forEach((x, i) => ver("rodape", x, `rodape[${ai}].campos[${i}]`)));
  estrutura.itens.forEach((x, i) => ver("itens", x, `itens[${i}]`));
  return out;
}

/**
 * Cópia da estrutura SEM os padrões `registro` — todos, ou só os das `chaves` dadas. Usada na resposta do layout efetivo
 * (a web da A3-1 nunca vê um tipo de padrão que não conhece) e na importação (padrão que não vale nesta organização).
 * O resto fica igual, inclusive `editavel`.
 */
export function removerPadroesRegistro(estrutura: EstruturaLayout, chaves?: ReadonlySet<string>): EstruturaLayout {
  const tira = <T extends { campo: string; valorPadrao?: ValorPadraoLayout }>(parte: ParteDoLayout, x: T): T => {
    if (x.valorPadrao?.tipo !== "registro" || (chaves && !chaves.has(chavePadraoDeCadastro(parte, x.campo)))) return { ...x };
    const { valorPadrao: _fora, ...resto } = x;
    return resto as T;
  };
  return {
    versaoSchema: 1,
    cabecalho: estrutura.cabecalho.map((x) => tira("cabecalho", x)),
    rodape: estrutura.rodape.map((a) => ({ aba: a.aba, campos: a.campos.map((x) => tira("rodape", x)) })),
    itens: estrutura.itens.map((x) => tira("itens", x))
  };
}

/* ─────────────── VENDAS-A3-1c: ZONAS do documento (decisão 261) ─────────────── */
/**
 * Campo do DOCUMENTO (parte "cabecalho" ou "rodape" no catálogo) pode ficar em QUALQUER zona do documento: cabeçalho
 * (grupo principal ou adicionais) ou qualquer aba do rodapé. A `parte` do catálogo continua sendo a posição NO LAYOUT DO
 * SISTEMA. Exceção: os campos de BLOCO LARGO só no rodapé. Coluna de item só nos itens.
 */
export const CAMPOS_SO_NO_RODAPE: readonly string[] = Object.freeze(["installment_plan"]);
/** Onde o layout do sistema põe em "Dados adicionais" (a Central de antes da fatia: o Proprietário). */
export const CAMPOS_ADICIONAIS_DO_SISTEMA: readonly string[] = Object.freeze(["proprietary_id"]);
export const mensagemSoNoRodape = (rotulo: string) => `"${rotulo}" só pode ficar numa aba do rodapé.`;
export const MENSAGEM_GRUPO_SO_NO_CABECALHO = "Grupo só vale nos campos do cabeçalho.";
export const MENSAGEM_OBRIGATORIO_NAO_SAI = "Campo obrigatório do sistema não pode sair do layout.";
/** Zona do documento onde um campo pode ser solto. */
export type ZonaDoLayout = { tipo: "principal" } | { tipo: "adicionais" } | { tipo: "aba"; indice: number } | { tipo: "itens" };
/**
 * Pode soltar `chave` (do catálogo da família) em `zona`? null = pode; string = o motivo (mostrado na tela). Dono único
 * da regra de zona para o configurador; `validarEstruturaLayout` aplica a mesma regra na gravação.
 */
export function motivoZonaProibida(familia: string, chave: string, zona: ZonaDoLayout): string | null {
  const cat = catalogoDaFamilia(familia);
  const doc = cat.find((c) => c.chave === chave && c.parte !== "itens");
  const col = cat.find((c) => c.chave === chave && c.parte === "itens");
  if (zona.tipo === "itens") return col ? null : "Só colunas dos itens podem ficar na grade de itens.";
  if (!doc) return "Colunas dos itens só podem ficar na grade de itens.";
  if ((zona.tipo === "principal" || zona.tipo === "adicionais") && CAMPOS_SO_NO_RODAPE.includes(chave)) return mensagemSoNoRodape(doc.rotulo);
  return null;
}
/**
 * Os campos do cabeçalho em "Dados adicionais" SEGUNDO a estrutura: se algum campo do cabeçalho declara grupo, vale o
 * grupo; se nenhum declara (layout gravado antes da A3-1c), vale a regra de antes (CAMPOS_ADICIONAIS_DO_SISTEMA).
 */
export function camposAdicionaisDoCabecalho(estrutura: EstruturaLayout): string[] {
  const algumDeclara = estrutura.cabecalho.some((x) => x.grupo !== undefined);
  return estrutura.cabecalho.filter((x) => (algumDeclara ? x.grupo === "adicionais" : CAMPOS_ADICIONAIS_DO_SISTEMA.includes(x.campo))).map((x) => x.campo);
}
