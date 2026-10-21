import type { EstadoDaCriacao } from "./estado";

/**
 * RATEIO-01 (decisão 316) — O RATEIO MORA NO RODAPÉ: contas PURAS, sem React e sem rede (os desenhos — `criacao-dados.tsx`,
 * `criacao-painel.tsx`, `criacao-barra.tsx` — só as chamam; o teste de unidade as prova uma a uma).
 *
 * A REGRA (do dono): o rateio é classificação do que a compra vai PAGAR, não dado de identificação do documento. Na
 * criação da compra com a capacidade `importacaoXml` (OPERACOES-01 F7, decisão 284), o rateio (do documento, por valor ou
 * por produto) e a CLASSIFICAÇÃO DE CADA ITEM (gera estoque, imobilizado e, com o rateio por produto, natureza e centro)
 * saem do bloco "Dados fiscais" dos Dados adicionais e moram numa aba própria do painel inferior, "Rateio", logo depois
 * do Financeiro. Os oito dados fiscais do cabeçalho (`CAMPOS_DOS_DADOS_FISCAIS`) ficam onde estavam. Um campo nunca
 * aparece em dois lugares. Nada de função muda: o estado, o corpo, as recusas e o efeito são os de antes.
 *
 *   · ONDE: `rateioNoPainel` — usa `mostrarFiscal` (criação com capacidade OU edição aberta). Sem mostrar, nenhuma aba.
 *     Editar o corpo fiscal continua só com `editarFiscal` / `dadosFiscaisAtivos`.
 *   · A RECUSA: os caminhos do servidor que são do rateio (`ehCaminhoDoRateio`) ABREM a aba do rateio (`abaDoRateio`) e
 *     levam ao controle (`testIdDoAlvoDoRateio`), pelo MESMO caminho da pendência no painel; não abrem mais os Dados
 *     adicionais (`erroEscondidoNosDados`).
 *   · A CONTAGEM de "Dados adicionais · N campos" (`quantidadeDosDadosAdicionais`): na criação, só os fiscais (o rateio
 *     saiu); na edição (EDITAR-02), em leitura, os fiscais e o rateio em leitura, como antes.
 */

/** O valor (`AbaDoPainel.value`) e o rótulo da aba do painel que recebe o rateio e a classificação. */
export const ABA_DO_RATEIO = "rateio";
export const ROTULO_DA_ABA_DO_RATEIO = "Rateio e classificação";

/** O caminho da recusa da classificação de um item (F7), nos dois formatos do servidor: `itens[0].x` e `itens.0.x`. */
export const CAMINHO_DA_CLASSIFICACAO_DO_ITEM = /^itens(?:\[(\d+)\]|\.(\d+))\.(?:gera_estoque|imobilizado|categoria_financeira_id|centro_custo_id)$/;
/** A linha do rateio por valor num caminho de recusa: `rateio.linhas[0].x` (regras) e `rateio.linhas.0.x` (esquema). */
const CAMINHO_DA_LINHA_DO_RATEIO = /^rateio\.linhas(?:\[(\d+)\]|\.(\d+))(?:\.|$)/;

/** O caminho de recusa é do rateio — o rateio do documento ou a classificação de um item? */
export function ehCaminhoDoRateio(caminho: string): boolean {
  return caminho.startsWith("rateio") || CAMINHO_DA_CLASSIFICACAO_DO_ITEM.test(caminho);
}

type OndeDesenha = Pick<EstadoDaCriacao, "mostrarFiscal" | "top">;

/**
 * Os dados fiscais saíram dos Dados principais e moram na aba Fiscal do painel.
 * `blocoFiscalNosDados` fica falso — criação e edição usam a aba; nunca o bloco nos Dados.
 */
export function blocoFiscalNosDados(_e: OndeDesenha): boolean {
  return false;
}

/** Aba Fiscal do painel: criação com capacidade OU edição aberta, com TOP e formulário à vista. */
export function fiscalNoPainel(e: OndeDesenha & Pick<EstadoDaCriacao, "mostrarFormulario">): boolean {
  return e.mostrarFormulario && e.mostrarFiscal && e.top !== null;
}

/** O rateio/classificação está no painel (mesma condição da aba Fiscal). */
export function rateioNoPainel(e: OndeDesenha & Pick<EstadoDaCriacao, "mostrarFormulario">): boolean {
  return fiscalNoPainel(e);
}

/** O primeiro caminho de recusa que é do rateio (na ordem em que o servidor os deu), ou `null`. */
export function caminhoDoRateioComErro(erros: Readonly<Record<string, string>>): string | null {
  return Object.keys(erros).find(ehCaminhoDoRateio) ?? null;
}

/** A aba do painel em que o caminho mora, quando é do rateio e o rateio está no painel; senão `null`. */
export function abaDoRateio(e: OndeDesenha & Pick<EstadoDaCriacao, "mostrarFormulario">, caminho: string): string | null {
  return rateioNoPainel(e) && ehCaminhoDoRateio(caminho) ? ABA_DO_RATEIO : null;
}

/**
 * O testid do pedaço do rateio que mostra a recusa do caminho (o "levar até lá"): a linha do rateio por valor, a linha da
 * classificação do item, ou o próprio "Rateio". `null` = o caminho não é do rateio.
 */
export function testIdDoAlvoDoRateio(caminho: string): string | null {
  const item = CAMINHO_DA_CLASSIFICACAO_DO_ITEM.exec(caminho);
  if (item) return `compras-item-classificacao-${item[1] ?? item[2]}`;
  if (!caminho.startsWith("rateio")) return null;
  const linha = CAMINHO_DA_LINHA_DO_RATEIO.exec(caminho);
  return linha ? `compras-rateio-linha-${linha[1] ?? linha[2]}` : "compras-rateio";
}

/**
 * Erro numa zona recolhida dos Dados não ficaria à vista: com erro lá dentro, os Dados adicionais abrem. Os campos
 * recolhidos e os fiscais do bloco — o rateio NÃO: a recusa dele abre a aba dele.
 */
export function erroEscondidoNosDados(a: {
  recolhidos: readonly string[]; blocoFiscal: boolean; camposFiscais: readonly string[]; erro: (caminho: string) => string | undefined;
}): boolean {
  return a.recolhidos.some((c) => Boolean(a.erro(c))) || (a.blocoFiscal && a.camposFiscais.some((c) => Boolean(a.erro(c))));
}

/**
 * Quantos campos "Dados adicionais · N campos" anuncia: os recolhidos, o Local de estoque quando a Empresa mora lá, e o
 * bloco fiscal — na CRIAÇÃO, os campos fiscais (o rateio está no painel); em LEITURA (a edição, EDITAR-02), os fiscais e
 * o rateio em leitura, que continuam nos Dados.
 */
export function quantidadeDosDadosAdicionais(a: {
  recolhidos: readonly string[]; localNaGrade: boolean; fiscais: "criacao" | "leitura" | null; camposFiscais: number;
}): number {
  const local = a.localNaGrade && a.recolhidos.includes("empresa_id") ? 1 : 0;
  const fiscais = a.fiscais === "criacao" ? a.camposFiscais : a.fiscais === "leitura" ? a.camposFiscais + 1 : 0;
  return a.recolhidos.length + local + fiscais;
}
