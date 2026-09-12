/**
 * CONTRATO DE ID GLOBAL (docs/GLOBAL-ID-CONTRACT.md).
 *
 * Todo registro de negócio COM IDENTIDADE PRÓPRIA tem três identificadores:
 *   1. UUID técnico             — chave primária, nunca exibida como identidade;
 *   2. código/número da entidade — sequência por entidade, quando aplicável;
 *   3. ID GLOBAL (#55)          — sequência ÚNICA por ORGANIZAÇÃO, compartilhada por todas as empresas dela.
 *
 * O ID Global é alocado pelo BANCO, nunca pelo cliente, e não é derivado da URL: a rota canônica é resolvida
 * a partir do REGISTRO. Sequências de organizações diferentes são independentes.
 *
 * ESTE MÓDULO É MECANISMO, NÃO CATÁLOGO. As entidades elegíveis são CONFIGURAÇÃO DE PRODUTO e ficam no
 * pacote de domínio (que depende desta plataforma, nunca o contrário) — é o que mantém o núcleo neutro de
 * segmento de negócio: aqui não há nome de tabela, de coluna nem de módulo deste produto.
 *
 * PERMISSÃO É DO REGISTRO, NÃO DA ENTIDADE
 * ----------------------------------------
 * Há tabelas em que uma linha representa coisas com permissões diferentes: um título financeiro é conta a
 * pagar OU a receber; um documento de venda é orçamento, pedido OU venda; manejo e movimentação de rebanho
 * têm uma permissão por tipo. Uma permissão fixa por tabela produziria dois defeitos:
 *   (a) falso negativo — quem tem `receivables.view` não abriria um recebível;
 *   (b) VAZAMENTO — quem tem só `payables.view` abriria um recebível.
 * Por isso `resolucao` é uma união discriminada: numa entidade com variantes é impossível, pelo tipo, ler
 * uma permissão fixa. Rota e permissão saem SEMPRE da mesma coluna do mesmo registro, e valor fora do mapa
 * é negado (fail-closed), nunca resolvido por uma permissão mais ampla.
 */

/** Rota + permissão de uma variante concreta do registro. */
export interface VarianteEntidade {
  rota: string;
  permissao: string;
}

/**
 * Como rota e permissão são obtidas:
 *  - `fixa`: toda linha da tabela tem a mesma rota e a mesma permissão;
 *  - `variante`: a coluna discriminadora do próprio registro decide as duas, juntas.
 */
export type ResolucaoEntidade =
  | ({ tipo: "fixa" } & VarianteEntidade)
  | { tipo: "variante"; coluna: string; variantes: Readonly<Record<string, VarianteEntidade>> };

export interface EntidadeIdGlobal {
  /** Chave canônica estável do tipo de entidade (igual ao nome da tabela quando há 1:1). */
  tipoEntidade: string;
  rotulo: string;
  modulo: string;
  tabela: string;
  /** Coluna que amarra o registro à EMPRESA; `null` = registro da organização inteira (cadastro compartilhado). */
  colunaEmpresa: string | null;
  /**
   * A tabela esconde registros excluídos por marca de exclusão? Quando true, o resolvedor só enxerga o que a
   * rota canônica enxerga: registro excluído não vira atalho navegável por ID Global.
   */
  exclusaoLogica: boolean;
  resolucao: ResolucaoEntidade;
}

/**
 * Padrões de tabela NÃO elegíveis: linhas técnicas sem identidade própria para o usuário
 * (itens de documento, rateios, vínculos de associação, permissões de perfil, infraestrutura).
 */
export const PADROES_TABELA_NAO_ELEGIVEL: readonly { padrao: RegExp; motivo: string }[] = [
  { padrao: /_items$/, motivo: "item de documento: identidade pertence ao documento pai" },
  { padrao: /_lines$/, motivo: "linha de documento: identidade pertence ao documento pai" },
  { padrao: /_apportionments$/, motivo: "linha de rateio: estrutura interna do documento" },
  { padrao: /_permissions$/, motivo: "vínculo perfil × permissão: sem identidade para o usuário" },
  { padrao: /^member_/, motivo: "tabela de vínculo de membro: sem identidade para o usuário" },
  { padrao: /_members$/, motivo: "tabela de vínculo: sem identidade para o usuário" },
  { padrao: /^(erp\.)?(code_sequences|sequencias_id_global|idempotency_keys|audit_logs|erp_migrations|registros_globais)$/, motivo: "infraestrutura interna" }
];

/** A tabela é técnica (linha auxiliar, vínculo, item)? Recebe o nome com ou sem o schema. */
export function tabelaTecnica(tabela: string): { tecnica: boolean; motivo?: string } {
  const nua = tabela.replace(/^erp\./, "");
  for (const r of PADROES_TABELA_NAO_ELEGIVEL) {
    if (r.padrao.test(nua) || r.padrao.test(tabela)) return { tecnica: true, motivo: r.motivo };
  }
  return { tecnica: false };
}

/** Coluna do registro que decide rota e permissão; null quando a entidade é fixa. */
export const colunaDiscriminadora = (entidade: EntidadeIdGlobal): string | null =>
  entidade.resolucao.tipo === "variante" ? entidade.resolucao.coluna : null;

/** Valores de variante declarados (vazio quando a entidade é fixa). */
export const variantesDeclaradas = (entidade: EntidadeIdGlobal): string[] =>
  entidade.resolucao.tipo === "variante" ? Object.keys(entidade.resolucao.variantes) : [];

export const PREFIXO_ID_GLOBAL = "#";
/** ID Global é um inteiro positivo por organização; exibido com "#". */
export const formatarIdGlobal = (n: number | string): string => `${PREFIXO_ID_GLOBAL}${String(n).replace(/^#/, "")}`;

/** Aceita "#55", "55" e " #55 ". Devolve null quando não for um ID Global válido (nunca lança). */
export function interpretarIdGlobal(entrada: unknown): number | null {
  if (typeof entrada === "number") return Number.isSafeInteger(entrada) && entrada > 0 ? entrada : null;
  if (typeof entrada !== "string") return null;
  const m = /^\s*#?(\d{1,15})\s*$/.exec(entrada);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Rota canônica + permissão exigida para ESTE registro. */
export interface RegistroResolvido {
  rota: string;
  permissao: string;
}

/**
 * Resolve rota e permissão a partir do REGISTRO — sempre juntas, sempre da mesma coluna.
 * `linha` é a linha VIVA do banco. Devolve `null` quando o discriminador está ausente ou o valor não está
 * declarado: o chamador NEGA (404). Nunca há queda para uma permissão mais ampla.
 */
export function resolverRegistroDaEntidade(entidade: EntidadeIdGlobal, idEntidade: string, linha: Readonly<Record<string, unknown>> = {}): RegistroResolvido | null {
  const r = entidade.resolucao;
  if (r.tipo === "fixa") return { rota: r.rota.replace(":id", idEntidade), permissao: r.permissao };
  const valor = linha[r.coluna];
  if (typeof valor !== "string" || !valor) return null;
  const variante = r.variantes[valor];
  if (!variante) return null;
  return { rota: variante.rota.replace(":id", idEntidade), permissao: variante.permissao };
}

/** Consistência de um catálogo de entidades (usada pelos testes e pelo gate). Lista vazia = íntegro. */
export function validarEntidadesIdGlobal(entidades: readonly EntidadeIdGlobal[]): string[] {
  const problemas: string[] = [];
  const vistos = new Set<string>();
  const permValida = (p: string) => /^[a-z_]+\.[a-z_]+$/.test(p);
  const rotaValida = (r: string) => r.includes(":id") && r.startsWith("/");
  for (const e of entidades) {
    const onde = e.tipoEntidade;
    if (vistos.has(onde)) problemas.push(`${onde}: tipo de entidade duplicado`);
    vistos.add(onde);
    if (!e.tabela.startsWith("erp.")) problemas.push(`${onde}: tabela deve ser qualificada (erp.<tabela>)`);
    const tec = tabelaTecnica(e.tabela);
    if (tec.tecnica) problemas.push(`${onde}: ${tec.motivo} — não deve receber ID Global`);
    const r = e.resolucao;
    if (r.tipo === "fixa") {
      if (!rotaValida(r.rota)) problemas.push(`${onde}: rota canônica inválida (${r.rota})`);
      if (!permValida(r.permissao)) problemas.push(`${onde}: permissão inválida (${r.permissao})`);
    } else {
      if (!/^[a-z_]+$/.test(r.coluna)) problemas.push(`${onde}: coluna discriminadora inválida (${r.coluna})`);
      const valores = Object.entries(r.variantes);
      if (valores.length < 2) problemas.push(`${onde}: entidade com variantes precisa declarar pelo menos duas`);
      for (const [valor, v] of valores) {
        if (!rotaValida(v.rota)) problemas.push(`${onde}[${valor}]: rota canônica inválida (${v.rota})`);
        if (!permValida(v.permissao)) problemas.push(`${onde}[${valor}]: permissão inválida (${v.permissao})`);
      }
      const permissoes = new Set(valores.map(([, v]) => v.permissao));
      if (permissoes.size === 1) problemas.push(`${onde}: todas as variantes têm a mesma permissão — use resolução fixa`);
    }
  }
  return problemas;
}
