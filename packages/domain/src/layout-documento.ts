/**
 * LAYOUT DO DOCUMENTO (VENDAS-A3-1, decisão 259) — o que a Central de Vendas mostra, em que ordem, com que rótulo,
 * e o que é obrigatório ao salvar. Como no ERP de referência: cadastro próprio por FAMÍLIA da TOP; uma TOP usa UM
 * layout; ordem de escolha: layout ligado à TOP → padrão ativo da família → LAYOUT DO SISTEMA (a tela de hoje).
 *
 * UMA conta só: a API e a tela usam `validarEstruturaLayout`, `resolverLayout` e `camposObrigatoriosFaltando` daqui.
 * O layout governa só a DIGITAÇÃO; os efeitos continuam presos à versão da TOP do documento. Nada aqui aponta para
 * registro (nenhum UUID): o valor padrão é literal ou variável.
 */

import { TIPOS_OPERACAO } from "./tipo-operacao.js";

/** As famílias da Central de Vendas, LIDAS do registry (dono único da lista): as variantes de `erp.sales_documents`. */
export const FAMILIAS_COM_LAYOUT: readonly string[] = Object.freeze(
  TIPOS_OPERACAO.filter((t) => t.origem.tabela === "erp.sales_documents").map((t) => t.codigo)
);
export type FamiliaComLayout = string;
export function familiaTemLayout(f: string): f is FamiliaComLayout { return FAMILIAS_COM_LAYOUT.includes(f); }

export type ParteDoLayout = "cabecalho" | "rodape" | "itens";
export type TipoDoCampoLayout = "referencia" | "empresa" | "data" | "texto" | "texto_longo" | "numero" | "booleano" | "plano";
export type VariavelPadrao = "data_atual" | "empresa_selecionada";
export type ValorPadraoLayout = { tipo: "literal"; valor: string | number | boolean } | { tipo: "variavel"; variavel: VariavelPadrao };

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
}

const C = (chave: string, rotulo: string, tipo: TipoDoCampoLayout, extra: Partial<CampoDoCatalogo> = {}): CampoDoCatalogo => ({ chave, rotulo, parte: "cabecalho", tipo, ...extra });
const R = (aba: string, chave: string, rotulo: string, tipo: TipoDoCampoLayout, extra: Partial<CampoDoCatalogo> = {}): CampoDoCatalogo => ({ chave, rotulo, parte: "rodape", aba, tipo, ...extra });
const I = (chave: string, rotulo: string, tipo: TipoDoCampoLayout, extra: Partial<CampoDoCatalogo> = {}): CampoDoCatalogo => ({ chave, rotulo, parte: "itens", tipo, ...extra });

/** O catálogo das vendas (orçamento, pedido, venda): exatamente os campos da Central de hoje, na ordem de hoje. */
const CATALOGO_VENDAS: readonly CampoDoCatalogo[] = [
  C("client_id", "Cliente", "referencia", { sistema: "sempre" }),
  C("empresa_id", "Empresa", "empresa", { sistema: "sempre" }),
  C("document_date", "Data", "data", { sistema: "sempre" }),
  C("due_date", "Vencimento", "data"),
  C("payment_method_id", "Forma de pagamento", "referencia"),
  C("categoria_financeira_id", "Natureza", "referencia", { sistema: "classificacao", exige: "classificacao" }),
  C("centro_custo_id", "Centro de resultado", "referencia", { sistema: "classificacao", exige: "classificacao" }),
  C("shipping_date", "Data de saída", "data"),
  C("proprietary_id", "Proprietário", "referencia"),
  R("Totais", "discount", "Desconto", "numero", { sempreTemValor: true }),
  R("Totais", "other_values", "Outros valores", "numero", { sempreTemValor: true }),
  R("Financeiro", "condicao_pagamento_id", "Condição de pagamento", "referencia", { exige: "condicao" }),
  R("Financeiro", "installment_plan", "Parcelamento", "plano", { sempreTemValor: true }),
  R("Frete e transporte", "transporter_id", "Transportadora", "referencia"),
  R("Frete e transporte", "driver_name", "Motorista", "texto"),
  R("Frete e transporte", "freight", "Frete", "numero", { sempreTemValor: true }),
  R("Frete e transporte", "freight_icms", "ICMS frete", "numero", { sempreTemValor: true }),
  R("Fiscal", "is_deductible", "Dedutível", "booleano", { sempreTemValor: true }),
  R("Observações", "note", "Observação", "texto_longo"),
  I("codigo", "Código", "texto", { somenteLeitura: true }),
  I("product_id", "Produto", "referencia", { sistema: "sempre" }),
  I("warehouse_id", "Armazém", "referencia"),
  I("estoque", "Estoque", "numero", { somenteLeitura: true }),
  I("quantity", "Quantidade", "numero", { sistema: "sempre" }),
  I("unit_price", "Valor unitário", "numero", { sistema: "sempre" }),
  I("discount", "Desconto", "numero", { sempreTemValor: true }),
  I("discount_percent", "Desconto %", "numero", { sempreTemValor: true }),
  I("total", "Total", "numero", { somenteLeitura: true })
];

export function catalogoDaFamilia(familia: string): readonly CampoDoCatalogo[] { return familiaTemLayout(familia) ? CATALOGO_VENDAS : []; }

/* ─────────────── ESTRUTURA (versaoSchema 1) ─────────────── */
export interface CampoDoLayout { campo: string; rotulo?: string; obrigatorio: boolean; editavel: boolean; valorPadrao?: ValorPadraoLayout }
export interface AbaDoLayout { aba: string; campos: CampoDoLayout[] }
export interface ColunaDoLayout { campo: string; rotulo?: string; obrigatorio: boolean }
export interface EstruturaLayout { versaoSchema: 1; cabecalho: CampoDoLayout[]; rodape: AbaDoLayout[]; itens: ColunaDoLayout[] }
export interface ErroDoLayout { caminho: string; mensagem: string }

/** LAYOUT DO SISTEMA: a Central de hoje — todos os campos, ordem, rótulos e obrigatórios de hoje. */
export function LAYOUT_DO_SISTEMA(familia: string): EstruturaLayout {
  const cat = catalogoDaFamilia(familia);
  const cab = cat.filter((c) => c.parte === "cabecalho").map((c): CampoDoLayout => ({ campo: c.chave, obrigatorio: Boolean(c.sistema), editavel: true }));
  const abas: AbaDoLayout[] = [];
  for (const c of cat.filter((x) => x.parte === "rodape")) {
    let a = abas.find((x) => x.aba === c.aba); if (!a) { a = { aba: c.aba!, campos: [] }; abas.push(a); }
    a.campos.push({ campo: c.chave, obrigatorio: Boolean(c.sistema), editavel: true });
  }
  const itens = cat.filter((c) => c.parte === "itens").map((c): ColunaDoLayout => ({ campo: c.chave, obrigatorio: Boolean(c.sistema) }));
  return { versaoSchema: 1, cabecalho: cab, rodape: abas, itens };
}

/** Que valores padrão um tipo aceita. Referência a registro: nenhum (sem UUID nesta fatia). */
function padraoCompativel(tipo: TipoDoCampoLayout, v: ValorPadraoLayout): boolean {
  if (v.tipo === "variavel") return (v.variavel === "data_atual" && tipo === "data") || (v.variavel === "empresa_selecionada" && tipo === "empresa");
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
  if (!cat.length) return [{ caminho: "familia", mensagem: "Família sem layout de documento." }];
  if (!estrutura || estrutura.versaoSchema !== 1) return [{ caminho: "estrutura.versaoSchema", mensagem: "Versão da estrutura desconhecida." }];
  const porChave = (parte: ParteDoLayout) => new Map(cat.filter((c) => c.parte === parte).map((c) => [c.chave, c]));
  const topo = porChave("cabecalho"); const rod = porChave("rodape"); const it = porChave("itens");
  const vistosDoc = new Set<string>();
  const conferirCampo = (x: CampoDoLayout, caminho: string, doCatalogo: Map<string, CampoDoCatalogo>) => {
    const c = doCatalogo.get(x.campo);
    if (!c) { e.push({ caminho: `${caminho}.campo`, mensagem: `Campo "${x.campo}" não existe nesta parte do documento.` }); return; }
    if (vistosDoc.has(x.campo)) { e.push({ caminho: `${caminho}.campo`, mensagem: `Campo "${c.rotulo}" repetido no layout.` }); return; }
    vistosDoc.add(x.campo);
    if (c.somenteLeitura && (x.obrigatorio || x.editavel)) e.push({ caminho, mensagem: `"${c.rotulo}" é só leitura: não pode ser obrigatório nem editável.` });
    if (c.sempreTemValor && x.obrigatorio) e.push({ caminho: `${caminho}.obrigatorio`, mensagem: mensagemSempreTemValor(c.rotulo) });
    if (x.valorPadrao && !padraoCompativel(c.tipo, x.valorPadrao)) e.push({ caminho: `${caminho}.valorPadrao`, mensagem: `Valor padrão incompatível com "${c.rotulo}".` });
    if (x.obrigatorio && !x.editavel && !x.valorPadrao) e.push({ caminho: `${caminho}.valorPadrao`, mensagem: `"${c.rotulo}" é obrigatório e não editável: informe o valor padrão.` });
  };
  estrutura.cabecalho.forEach((x, i) => conferirCampo(x, `cabecalho[${i}]`, topo));
  estrutura.rodape.forEach((a, ai) => {
    if (!a.campos.length) e.push({ caminho: `rodape[${ai}]`, mensagem: `A aba "${a.aba}" está vazia.` });
    a.campos.forEach((x, i) => conferirCampo(x, `rodape[${ai}].campos[${i}]`, rod));
  });
  const vistosItem = new Set<string>();
  estrutura.itens.forEach((x, i) => {
    const c = it.get(x.campo); const caminho = `itens[${i}]`;
    if (!c) { e.push({ caminho: `${caminho}.campo`, mensagem: `Coluna "${x.campo}" não existe nos itens.` }); return; }
    if (vistosItem.has(x.campo)) { e.push({ caminho: `${caminho}.campo`, mensagem: `Coluna "${c.rotulo}" repetida.` }); return; }
    vistosItem.add(x.campo);
    if (c.somenteLeitura && x.obrigatorio) e.push({ caminho, mensagem: `"${c.rotulo}" é só leitura: não pode ser obrigatória.` });
    if (c.sempreTemValor && x.obrigatorio) e.push({ caminho: `${caminho}.obrigatorio`, mensagem: mensagemSempreTemValor(c.rotulo) });
  });
  // campo "do sistema" fora do layout SEM valor padrão (itens não têm padrão: a coluna tem de estar lá)
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
  return e;
}

export type OrigemDoLayout = "ligado" | "padrao_da_familia" | "sistema";
/** Ordem de escolha: layout ligado à TOP → padrão ativo da família → layout do sistema. */
export function resolverLayout(familia: string, a: { ligado?: EstruturaLayout | null; padraoDaFamilia?: EstruturaLayout | null }): { estrutura: EstruturaLayout; origem: OrigemDoLayout } {
  if (a.ligado) return { estrutura: a.ligado, origem: "ligado" };
  if (a.padraoDaFamilia) return { estrutura: a.padraoDaFamilia, origem: "padrao_da_familia" };
  return { estrutura: LAYOUT_DO_SISTEMA(familia), origem: "sistema" };
}

const vazio = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Obrigatórios do layout que o documento deixa vazios → [{ caminho, rotulo }]. `documento` tem as chaves do corpo
 * da API (o valor que o documento TERÁ depois de gravar) e `items`. Caminho do item: `items[i].<campo>`.
 * Campo com `exige` que a API não declara (`capacidades`) não é cobrado.
 */
export function camposObrigatoriosFaltando(familia: string, estrutura: EstruturaLayout, documento: Record<string, unknown> & { items?: Record<string, unknown>[] }, capacidades: { classificacao?: boolean; condicao?: boolean } = {}): { caminho: string; rotulo: string }[] {
  const cat = new Map(catalogoDaFamilia(familia).map((c) => [`${c.parte}:${c.chave}`, c]));
  const ativo = (c: CampoDoCatalogo | undefined) => Boolean(c) && (!c!.exige || (c!.exige === "classificacao" ? capacidades.classificacao : capacidades.condicao));
  const out: { caminho: string; rotulo: string }[] = [];
  const topo = (x: CampoDoLayout, parte: ParteDoLayout) => {
    const c = cat.get(`${parte}:${x.campo}`);
    // sempreTemValor: defesa para estrutura gravada antes da regra (R1) — nunca cobrado
    if (!x.obrigatorio || !ativo(c) || c!.somenteLeitura || c!.sempreTemValor) return;
    if (vazio(documento[x.campo])) out.push({ caminho: x.campo, rotulo: x.rotulo ?? c!.rotulo });
  };
  estrutura.cabecalho.forEach((x) => topo(x, "cabecalho"));
  estrutura.rodape.forEach((a) => a.campos.forEach((x) => topo(x, "rodape")));
  (documento.items ?? []).forEach((linha, i) => {
    for (const x of estrutura.itens) {
      const c = cat.get(`itens:${x.campo}`);
      if (!x.obrigatorio || !c || c.somenteLeitura || c.sempreTemValor) continue;
      if (vazio(linha[x.campo])) out.push({ caminho: `items[${i}].${x.campo}`, rotulo: x.rotulo ?? c.rotulo });
    }
  });
  return out;
}

/** Capacidade declarada pela API em operation-types (capacidades.layoutDocumento), DEPOIS de condicaoPagamento. */
export const CAPACIDADE_LAYOUT_DOCUMENTO = 1;
/** Código da recusa ao salvar: obrigatório do layout vazio. Mensagem por campo: mensagemCampoObrigatorio(rotulo). */
export const ERRO_LAYOUT_CAMPO_OBRIGATORIO = "LAYOUT_CAMPO_OBRIGATORIO";
export const mensagemCampoObrigatorio = (rotulo: string) => `O campo '${rotulo}' é obrigatório nesta operação.`;
