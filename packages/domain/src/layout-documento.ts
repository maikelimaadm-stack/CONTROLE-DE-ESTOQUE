/**
 * LAYOUT DO DOCUMENTO (VENDAS-A3-1, decisão 259) — o que a Central de Vendas mostra, em que ordem, com que rótulo,
 * e o que é obrigatório ao salvar. Como no ERP de referência: cadastro próprio por FAMÍLIA da TOP; uma TOP usa UM
 * layout; ordem de escolha: layout ligado à TOP → padrão ativo da família → LAYOUT DO SISTEMA (a tela de hoje).
 *
 * UMA conta só: a API e a tela usam `validarEstruturaLayout`, `resolverLayout` e `camposObrigatoriosFaltando` daqui.
 * O layout governa só a DIGITAÇÃO; os efeitos continuam presos à versão da TOP do documento. O valor padrão é literal,
 * variável ou (VENDAS-A3-1b) registro de cadastro: aqui só a forma (UUID) e o lugar; a existência é conferida pela API.
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

/** O catálogo das vendas (orçamento, pedido, venda): exatamente os campos da Central de hoje, na ordem de hoje. */
const CATALOGO_VENDAS: readonly CampoDoCatalogo[] = [
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
  I("codigo", "Código", "texto", { somenteLeitura: true }),
  I("product_id", "Produto", "referencia", { sistema: "sempre" }),
  I("warehouse_id", "Armazém", "referencia", { referencia: { recurso: "warehouses" } }),
  I("estoque", "Estoque", "numero", { somenteLeitura: true }),
  I("quantity", "Quantidade", "numero", { sistema: "sempre" }),
  I("unit_price", "Valor unitário", "numero", { sistema: "sempre" }),
  I("discount", "Desconto", "numero", { sempreTemValor: true }),
  I("discount_percent", "Desconto %", "numero", { sempreTemValor: true }),
  I("total", "Total", "numero", { somenteLeitura: true })
];

export function catalogoDaFamilia(familia: string): readonly CampoDoCatalogo[] { return familiaTemLayout(familia) ? CATALOGO_VENDAS : []; }

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
    if (x.valorPadrao && !padraoCompativel(c, x.valorPadrao)) e.push({ caminho: `${caminho}.valorPadrao`, mensagem: `Valor padrão incompatível com "${c.rotulo}".` });
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
    // VENDAS-A3-1b: valor padrão de coluna só na coluna Armazém e só do tipo registro (UUID)
    if (x.valorPadrao && !(COLUNAS_COM_PADRAO_REGISTRO.includes(x.campo) && x.valorPadrao.tipo === "registro" && padraoCompativel(c, x.valorPadrao)))
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

/* ─────────────── VENDAS-A3-1b: padrão de CADASTRO (registro) e arquivo do layout ─────────────── */
/** Colunas de item que aceitam padrão registro (só o Armazém). */
export const COLUNAS_COM_PADRAO_REGISTRO: readonly string[] = Object.freeze(["warehouse_id"]);
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
