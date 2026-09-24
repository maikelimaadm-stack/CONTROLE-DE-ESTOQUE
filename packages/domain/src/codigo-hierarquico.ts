/**
 * Código hierárquico dos cadastros em árvore (Plano de Contas, Naturezas, Centros de Resultado e
 * Grupos de Produtos).
 *
 * O código de um filho é SEMPRE o código do superior + um nível: `1.01` → `1.01.001`. A máscara diz
 * quantos níveis existem e quantos dígitos cada um tem (`9.99.999.9999`), e é configurada POR CADASTRO
 * nos parâmetros da organização (`mascaras_codigo`). Sem configuração vale a máscara padrão, que é o
 * formato que o sistema sempre usou.
 *
 * Funções puras: o servidor as usa para sugerir e para recusar, a tela só para sugerir. Quem decide é o
 * servidor — um código que a tela deixasse passar é recusado do mesmo jeito.
 */

/** Cadastros com código hierárquico. Endereçamento é árvore, mas não tem código. */
export const CADASTROS_CODIGO_HIERARQUICO = ["chart_accounts", "financial_categories", "cost_centers", "product_groups"] as const;
export type CadastroCodigoHierarquico = (typeof CADASTROS_CODIGO_HIERARQUICO)[number];

export const PARAMETRO_MASCARAS_CODIGO = "mascaras_codigo";
export const MASCARA_CODIGO_PADRAO = "9.99.999.9999";
export const MASCARA_NIVEIS_MAXIMO = 8;
export const MASCARA_DIGITOS_MAXIMO = 6;

export function ehCadastroCodigoHierarquico(chave: string): chave is CadastroCodigoHierarquico {
  return (CADASTROS_CODIGO_HIERARQUICO as readonly string[]).includes(chave);
}

/** Larguras de cada nível, ou null se a máscara é inválida. */
export function larguraDosNiveis(mascara: string): number[] | null {
  if (!/^9+(\.9+)*$/.test(mascara)) return null;
  const larguras = mascara.split(".").map((s) => s.length);
  if (larguras.length > MASCARA_NIVEIS_MAXIMO || larguras.some((l) => l > MASCARA_DIGITOS_MAXIMO)) return null;
  return larguras;
}

export function mascaraValida(mascara: string): boolean {
  return larguraDosNiveis(mascara) !== null;
}

/**
 * A máscara efetiva de um cadastro a partir dos parâmetros da organização. Valor ausente ou inválido cai
 * na padrão: a gravação dos parâmetros já recusa máscara inválida, então inválido aqui só aparece em dado
 * antigo ou editado fora da API — e nesse caso a padrão é o comportamento conhecido.
 */
export function mascaraDoCadastro(parametros: unknown, cadastro: CadastroCodigoHierarquico): string {
  const p = parametros && typeof parametros === "object" ? (parametros as Record<string, unknown>)[PARAMETRO_MASCARAS_CODIGO] : undefined;
  const m = p && typeof p === "object" ? (p as Record<string, unknown>)[cadastro] : undefined;
  return typeof m === "string" && mascaraValida(m) ? m : MASCARA_CODIGO_PADRAO;
}

export function nivelDoCodigo(codigo: string): number {
  return codigo.split(".").length;
}

/**
 * Recusa (mensagem em PT-BR) ou null. `codigoPai` null = raiz. Só confere a forma do código NOVO: um pai
 * gravado antes da máscara continua valendo como prefixo, sem ser revalidado.
 */
export function validarCodigoHierarquico(codigo: string, mascara: string, codigoPai: string | null): string | null {
  const larguras = larguraDosNiveis(mascara) ?? larguraDosNiveis(MASCARA_CODIGO_PADRAO)!;
  const partes = codigo.split(".");
  if (partes.length > larguras.length) return `O código tem mais níveis que a máscara (${mascara}).`;
  for (const [i, parte] of partes.entries()) {
    const largura = larguras[i]!;
    if (!/^\d+$/.test(parte) || parte.length !== largura) return `O ${i + 1}º nível do código deve ter ${largura} dígito(s) (máscara ${mascara}).`;
  }
  if (codigoPai === null) {
    if (partes.length !== 1) return "Sem superior, o código é de 1º nível. Informe o superior ou use um código de um nível só.";
    return null;
  }
  if (!codigo.startsWith(`${codigoPai}.`) || partes.length !== nivelDoCodigo(codigoPai) + 1) {
    return `O código deve começar com o código do superior (${codigoPai}.) e ter um nível a mais.`;
  }
  return null;
}

/** Próximo código livre abaixo do superior (ou na raiz). `codigosExistentes` pode trazer o cadastro inteiro. */
export function proximoCodigoHierarquico(codigoPai: string | null, codigosExistentes: readonly string[], mascara: string): { codigo: string } | { erro: string } {
  const larguras = larguraDosNiveis(mascara) ?? larguraDosNiveis(MASCARA_CODIGO_PADRAO)!;
  const nivel = codigoPai === null ? 1 : nivelDoCodigo(codigoPai) + 1;
  if (nivel > larguras.length) return { erro: `O superior já está no último nível da máscara (${mascara}).` };
  const largura = larguras[nivel - 1]!;
  const prefixo = codigoPai === null ? "" : `${codigoPai}.`;
  let maior = 0;
  for (const c of codigosExistentes) {
    if (!c.startsWith(prefixo) || nivelDoCodigo(c) !== nivel) continue;
    const ultimo = c.slice(prefixo.length);
    if (/^\d+$/.test(ultimo)) maior = Math.max(maior, Number(ultimo));
  }
  const proximo = maior + 1;
  if (proximo >= 10 ** largura) return { erro: `Não há mais códigos livres neste nível (${largura} dígito(s)).` };
  return { codigo: prefixo + String(proximo).padStart(largura, "0") };
}
