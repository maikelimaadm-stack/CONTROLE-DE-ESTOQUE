import {
  FORMA_UUID_PADRAO, LAYOUT_DO_SISTEMA, camposAdicionaisDoCabecalho, catalogoDaFamilia,
  type CampoDoLayout, type ColunaDoLayout, type EstruturaLayout, type OrigemDoLayout, type ValorPadraoLayout
} from "@agro/domain";
import { todayISO } from "@/lib/utils";
import type { ColunaDoEditorDeItens, ColunaDoLayoutNoEditor } from "@/features/docs/shared";

/**
 * O LAYOUT DO DOCUMENTO NA CENTRAL DE COMPRAS (COMPRAS-03, decisão 269) — contas PURAS, sem React e sem rede.
 *
 * O mecanismo é o de Vendas (`app/(app)/vendas/[kind]/new`): a resposta de `/layout-efetivo` só governa a tela depois
 * de CONFERIDA (o corpo é `unknown` até provar a forma), o padrão de cadastro vem à parte e o que não se reconhece não
 * vale. A página de Vendas não exporta essas peças e não muda nesta fatia; por isso a leitura da resposta está copiada
 * aqui, com a MESMA postura. O que é da Compra (e não existe em Vendas): os campos que a REGRA da operação força a
 * aparecer mesmo que o layout os esconda, e as colunas do editor de itens (`ItemsEditor`) em vez da grade da venda.
 *
 * Nada aqui decide: o servidor cobra o obrigatório do layout (422 LAYOUT_CAMPO_OBRIGATORIO), a exigência da TOP e as
 * exigências do título. A tela só não esconde o que vai ser cobrado, e cobra antes o que ela já sabe.
 */

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehCampoDoLayout = (v: unknown) => ehObj(v) && typeof v.campo === "string" && typeof v.obrigatorio === "boolean" && typeof v.editavel === "boolean" && (v.rotulo === undefined || v.rotulo === null || typeof v.rotulo === "string");

/** A `estrutura` da resposta, conferida campo a campo (a mesma régua da Central de Vendas). Forma estranha = não é layout. */
export function ehEstruturaLayout(v: unknown): v is EstruturaLayout {
  return ehObj(v) && v.versaoSchema === 1
    && Array.isArray(v.cabecalho) && v.cabecalho.every(ehCampoDoLayout)
    && Array.isArray(v.rodape) && v.rodape.every((a) => ehObj(a) && typeof a.aba === "string" && Array.isArray(a.campos) && a.campos.every(ehCampoDoLayout))
    && Array.isArray(v.itens) && v.itens.every((c) => ehObj(c) && typeof c.campo === "string" && typeof c.obrigatorio === "boolean");
}

/** A estrutura que governa a Central: a da resposta conferida, ou `null` (resposta ausente ou de forma estranha). */
export const estruturaDaResposta = (r: unknown): EstruturaLayout | null => (ehObj(r) && ehEstruturaLayout(r.estrutura) ? r.estrutura : null);

/** Valor padrão literal ou variável → valor do campo (todos os campos do cabeçalho da Central são texto). `null` = não se aplica. */
export function valorDoPadrao(v: ValorPadraoLayout, empresa: string): string | null {
  if (v.tipo === "variavel") return v.variavel === "data_atual" ? todayISO() : empresa || null;
  // o padrão registro nunca chega pela `estrutura` (a API o tira dela): vem em `padroesDeCadastro`
  if (v.tipo === "registro") return null;
  // nenhum campo do cabeçalho da compra é booleano: literal booleano não se aplica (o domínio já o recusa)
  return typeof v.valor === "boolean" ? null : String(v.valor);
}

/**
 * PADRÃO DE CADASTRO — `padroesDeCadastro` ({ [chave]: { id, rotulo, empresaId? } }, só os que valem AGORA) e
 * `padroesInvalidos` (as chaves dos que morreram). Ausentes = nenhum. Forma errada de um deles → ele é IGNORADO por
 * inteiro — nunca bloqueia o Salvar, que depende só da estrutura. Chave nas duas listas → não se aplica (vale o aviso).
 */
export interface PadraoDeCadastro { id: string; rotulo: string; empresaId: string | null }
export interface PadroesDaResposta { validos: ReadonlyMap<string, PadraoDeCadastro>; invalidos: ReadonlySet<string> }
export const SEM_PADROES: PadroesDaResposta = { validos: new Map(), invalidos: new Set() };
const ehPadraoDeCadastro = (v: unknown): v is { id: string; rotulo: string; empresaId?: string | null } =>
  ehObj(v) && typeof v.id === "string" && FORMA_UUID_PADRAO.test(v.id) && typeof v.rotulo === "string"
  && (v.empresaId === undefined || v.empresaId === null || typeof v.empresaId === "string");
export function padroesDaResposta(r: unknown): PadroesDaResposta {
  if (!ehObj(r)) return SEM_PADROES;
  let validos = new Map<string, PadraoDeCadastro>();
  if (ehObj(r.padroesDeCadastro)) {
    for (const [chave, v] of Object.entries(r.padroesDeCadastro)) {
      if (!ehPadraoDeCadastro(v)) { validos = new Map(); break; }
      validos.set(chave, { id: v.id, rotulo: v.rotulo, empresaId: typeof v.empresaId === "string" ? v.empresaId : null });
    }
  }
  const lista = r.padroesInvalidos;
  const invalidos = new Set<string>(Array.isArray(lista) && lista.every((x): x is string => typeof x === "string") ? lista : []);
  for (const chave of invalidos) validos.delete(chave);
  return validos.size || invalidos.size ? { validos, invalidos } : SEM_PADROES;
}

/**
 * QUAL LAYOUT VALE — `origem`/`nome`/`id` da mesma resposta. Origem que não se reconhece NÃO vira "do sistema" (seria
 * afirmar o que não se sabe): a linha não aparece. O `id` só vale com forma de UUID (vai para o endereço do configurador).
 */
export interface LayoutQueVale { origem: OrigemDoLayout; nome: string | null; id: string | null }
export function layoutQueVale(r: unknown): LayoutQueVale | null {
  if (!ehObj(r)) return null;
  const origem = r.origem === "ligado" || r.origem === "padrao_da_familia" || r.origem === "sistema" ? r.origem : null;
  if (!origem) return null;
  return { origem, nome: typeof r.nome === "string" && r.nome.trim() ? r.nome : null, id: typeof r.id === "string" && FORMA_UUID_PADRAO.test(r.id) ? r.id : null };
}
export function textoDoLayoutQueVale(l: LayoutQueVale): string {
  if (l.origem === "sistema" || !l.nome) return "Layout: do sistema";
  return l.origem === "ligado" ? `Layout: ${l.nome} (ligado à TOP)` : `Layout: ${l.nome} (padrão do movimento)`;
}
/** "Configurar": o layout que vale, ou — no do sistema / sem id — a lista de layouts em Configurações. */
export const hrefDoConfigurador = (l: LayoutQueVale) => (l.origem !== "sistema" && l.id
  ? `/configuracoes/layouts-documento/${l.id}`
  : "/configuracoes?tab=operacoes&sub=layouts-documento");

/**
 * REGRAS DA OPERAÇÃO da compra (`/api/compras/{seg}/regras-da-operacao`), conferidas. Forma estranha = `null` (nenhum
 * asterisco a mais). COMPRAS-03: `exigeFormaPagamento`, `exigeVencimento` e `exigeArmazem` — ausentes na API anterior,
 * e aí valem `false` (a Central de hoje, sem campo forçado nem asterisco a mais).
 */
export interface RegrasDaCompra {
  exigencias: string[]; condicoesPermitidas: string[] | null; geraTitulos: boolean | null;
  exigeFormaPagamento: boolean; exigeVencimento: boolean; exigeArmazem: boolean;
}
export function lerRegras(v: unknown): RegrasDaCompra | null {
  if (!ehObj(v) || !Array.isArray(v.exigencias) || !v.exigencias.every((x) => typeof x === "string")) return null;
  const cp = v.condicoesPermitidas;
  if (cp !== null && cp !== undefined && !(Array.isArray(cp) && cp.every((x) => typeof x === "string"))) return null;
  return {
    exigencias: v.exigencias as string[], condicoesPermitidas: (cp as string[] | null | undefined) ?? null, geraTitulos: typeof v.geraTitulos === "boolean" ? v.geraTitulos : null,
    exigeFormaPagamento: v.exigeFormaPagamento === true, exigeVencimento: v.exigeVencimento === true, exigeArmazem: v.exigeArmazem === true
  };
}

/**
 * OS CAMPOS DO CABEÇALHO QUE A REGRA EXIGE — os que aparecem (e ganham "*") mesmo que o layout os esconda: esconder um
 * campo que o servidor vai cobrar faria o Salvar recusar algo invisível. As exigências gerais da TOP; natureza e centro
 * quando a compra gera título; forma de pagamento e vencimento quando a política da TOP os exige. Sem `regras` (API que
 * não respondeu, ou anterior), nenhum — a Central de hoje.
 */
export function camposExigidosPelaRegra(regras: RegrasDaCompra | null, ehCompra: boolean): string[] {
  if (!regras) return [];
  const out = [...regras.exigencias];
  if (ehCompra && regras.geraTitulos === true) out.push("categoria_financeira_id", "centro_custo_id");
  if (regras.exigeFormaPagamento) out.push("forma_pagamento_id");
  if (regras.exigeVencimento) out.push("data_vencimento");
  return [...new Set(out)];
}

/**
 * A ESTRUTURA DESENHADA = a do layout + os campos que a regra exige e o layout não desenha (nem no cabeçalho nem em aba
 * alguma). Eles entram no fim dos campos principais, EDITÁVEIS e sem `grupo` (não mudam a zona de ninguém) — e não
 * entram na configuração do layout: rótulo de hoje, sem padrão, sem trava. Só o DESENHO: a cobrança do layout continua
 * lendo a estrutura da resposta. Devolve também quais foram forçados (`data-forcado` no invólucro).
 */
export function estruturaComExigidos(familia: string, estrutura: EstruturaLayout, exigidos: readonly string[]): { estrutura: EstruturaLayout; forcados: ReadonlySet<string> } {
  const doCatalogo = new Set(catalogoDaFamilia(familia).filter((c) => c.parte !== "itens").map((c) => c.chave));
  const desenhados = new Set([...estrutura.cabecalho.map((x) => x.campo), ...estrutura.rodape.flatMap((a) => a.campos.map((x) => x.campo))]);
  const faltam = exigidos.filter((c) => doCatalogo.has(c) && !desenhados.has(c));
  if (!faltam.length) return { estrutura, forcados: new Set() };
  const sinteticos = faltam.map((campo): CampoDoLayout => ({ campo, obrigatorio: false, editavel: true }));
  return { estrutura: { ...estrutura, cabecalho: [...estrutura.cabecalho, ...sinteticos] }, forcados: new Set(faltam) };
}

/**
 * AS ZONAS, EM SEQUÊNCIA (sem desenho novo): os campos principais no grid de hoje; depois "Dados adicionais" (os que o
 * layout põe lá — dono: `camposAdicionaisDoCabecalho`); depois cada aba do rodapé, na ordem do layout. Campo que não é
 * do catálogo da família não é desenhado. `indice` = a posição da aba no layout (aba vazia não aparece, mas não renumera
 * as outras).
 */
export interface ZonasDaCentral { principais: string[]; adicionais: string[]; abas: { indice: number; aba: string; campos: string[] }[] }
export function zonasDaCentral(familia: string, estrutura: EstruturaLayout): ZonasDaCentral {
  const doCatalogo = new Set(catalogoDaFamilia(familia).filter((c) => c.parte !== "itens").map((c) => c.chave));
  const adicionaisDoLayout = new Set(camposAdicionaisDoCabecalho(estrutura));
  const cabecalho = estrutura.cabecalho.map((x) => x.campo).filter((c) => doCatalogo.has(c));
  return {
    principais: cabecalho.filter((c) => !adicionaisDoLayout.has(c)),
    adicionais: cabecalho.filter((c) => adicionaisDoLayout.has(c)),
    abas: estrutura.rodape.flatMap((a, indice) => {
      const campos = a.campos.map((x) => x.campo).filter((c) => doCatalogo.has(c));
      return campos.length ? [{ indice, aba: a.aba, campos }] : [];
    })
  };
}

/** A coluna do editor de itens que desenha cada chave do item da compra (a linha do corpo → o `ItemRow` do editor). */
const COLUNA_DO_EDITOR: Readonly<Record<string, ColunaDoEditorDeItens>> = {
  armazem_id: "warehouse", produto_id: "product", quantidade: "quantity", valor_unitario: "unit_value",
  desconto: "discount", desconto_percentual: "discount_percent", lote: "lot", validade: "expiration"
};

/**
 * AS COLUNAS DO EDITOR DE ITENS segundo o layout: a ordem, o rótulo e o "*" do layout (ou da regra: o armazém que a TOP
 * exige). As colunas que a regra força e o layout esconde (armazém exigido; lote e validade de produto que controla
 * lote) entram na posição do LAYOUT DO SISTEMA — logo depois da última coluna que as precede nele —, com o rótulo de
 * hoje. Chave que o editor não sabe desenhar não entra.
 *
 * Colunas do SISTEMA (produto, quantidade, valor unitário): o editor de hoje não as marca com "*" — quem as exige é o
 * Salvar desabilitado e o servidor, como sempre. O "*" da GRADE marca só o que o layout TORNOU obrigatório (ou a regra),
 * para o layout do sistema desenhar exatamente a Central de hoje — a mesma régua da grade de Vendas.
 */
export function colunasDoEditor(familia: string, itens: readonly ColunaDoLayout[], a: { forcadas: readonly string[]; obrigatoriasPelaRegra: ReadonlySet<string> }): ColunaDoLayoutNoEditor[] {
  const lista: ColunaDoLayout[] = [...itens];
  const ordemDoSistema = LAYOUT_DO_SISTEMA(familia).itens.map((c) => c.campo);
  for (const campo of ordemDoSistema) {
    if (!a.forcadas.includes(campo) || lista.some((x) => x.campo === campo)) continue;
    const antes = ordemDoSistema.slice(0, ordemDoSistema.indexOf(campo));
    let pos = 0;
    lista.forEach((x, i) => { if (antes.includes(x.campo)) pos = i + 1; });
    lista.splice(pos, 0, { campo, obrigatorio: false });
  }
  const doSistema = new Set(catalogoDaFamilia(familia).filter((c) => c.parte === "itens" && c.sistema).map((c) => c.chave));
  return lista.flatMap((x) => {
    const coluna = COLUNA_DO_EDITOR[x.campo];
    if (!coluna) return [];
    const obrigatorio = (x.obrigatorio && !doSistema.has(x.campo)) || a.obrigatoriasPelaRegra.has(x.campo);
    return [{ coluna, chave: x.campo, ...(x.rotulo ? { rotulo: x.rotulo } : {}), obrigatorio }];
  });
}
