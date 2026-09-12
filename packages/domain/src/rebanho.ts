/**
 * OPERAÇÕES DE REBANHO — FONTE ÚNICA DA MATRIZ DE PERMISSÃO POR TIPO.
 *
 * `animal_movements` e `animal_handlings` guardam, cada uma, várias operações diferentes numa só tabela, e
 * cada operação tem a SUA permissão. Antes desta fonte única a mesma matriz aparecia (com divergências) em
 * três lugares: autorização de anexos, rotas operacionais e registry de ID Global — e dois deles ainda
 * caíam num `?? "animal_sales.view"` / `?? "nutritions.view"`, que é o oposto de fail-closed.
 *
 * Agora é uma verdade só, consumida pelos três, com teste de consistência. Regra: tipo conhecido → a sua
 * permissão exata; tipo desconhecido ou sem porta funcional → `null`, e quem chama NEGA.
 */
export type AcaoOperacao = "view" | "create" | "edit" | "delete";

export interface OperacaoRebanho {
  /** Valor persistido na coluna discriminadora (nunca traduzido). */
  tipo: string;
  rotulo: string;
  /** Recurso do catálogo de permissões: a permissão é `${recurso}.${acao}`. */
  recurso: string;
  /** Rota canônica de detalhe da operação. */
  rota: string;
}

const O = (tipo: string, rotulo: string, recurso: string, rota: string): OperacaoRebanho => ({ tipo, rotulo, recurso, rota });

/** Movimentações com tela própria (as que o usuário cria e consulta como lançamento). */
export const MOVIMENTACOES_REBANHO: readonly OperacaoRebanho[] = [
  O("purchase", "Compra de Animais", "animal_purchases", "/pecuaria/movimentacoes/purchase/:id"),
  O("sale", "Venda de Animais", "animal_sales", "/pecuaria/movimentacoes/sale/:id"),
  O("birth", "Nascimento", "animal_births", "/pecuaria/movimentacoes/birth/:id"),
  O("death", "Morte", "animal_deaths", "/pecuaria/movimentacoes/death/:id"),
  O("loss", "Perda", "animal_losses", "/pecuaria/movimentacoes/loss/:id")
];

/**
 * Movimentações que são EFEITO de outra operação (transferência, evolução, inventário, processamento):
 * a tabela as registra, mas elas não têm tela de lançamento própria. Não recebem ID Global, não aparecem na
 * listagem de movimentações e NUNCA herdam a permissão de venda — são consultadas na tela da operação que
 * as originou. Espelha exatamente o CHECK de `erp.animal_movements.movement_type`.
 */
export const MOVIMENTACOES_INTERNAS: readonly string[] = [
  "evolution", "batch_transfer", "farm_transfer", "module_area_transfer", "inventory", "weaning", "separation", "processing"
];

/** Manejos: cada tipo tem tela e permissão próprias. */
export const MANEJOS_REBANHO: readonly OperacaoRebanho[] = [
  O("nutrition", "Nutrição", "nutritions", "/pecuaria/manejo/nutrition/:id"),
  O("sanitary", "Sanitário", "sanitaries", "/pecuaria/manejo/sanitary/:id"),
  O("weaning", "Desmama", "weanings", "/pecuaria/manejo/weaning/:id"),
  O("separation", "Apartação", "separations", "/pecuaria/manejo/separation/:id"),
  O("pasture", "Pastagem", "pastures", "/pecuaria/manejo/pasture/:id"),
  O("locate", "Localização de Animal", "locate_animals", "/pecuaria/manejo/locate/:id")
];

const porTipo = (lista: readonly OperacaoRebanho[]) => new Map(lista.map((o) => [o.tipo, o]));
const MOV = porTipo(MOVIMENTACOES_REBANHO);
const MAN = porTipo(MANEJOS_REBANHO);

export const movimentacaoRebanho = (tipo: string): OperacaoRebanho | undefined => MOV.get(tipo);
export const manejoRebanho = (tipo: string): OperacaoRebanho | undefined => MAN.get(tipo);

/** Permissão exata da movimentação; `null` para tipo interno ou desconhecido — quem chama NEGA. */
export const permissaoMovimentacao = (tipo: string | null | undefined, acao: AcaoOperacao): string | null => {
  const o = tipo ? MOV.get(tipo) : undefined;
  return o ? `${o.recurso}.${acao}` : null;
};
/** Permissão exata do manejo; `null` para tipo desconhecido — quem chama NEGA. */
export const permissaoManejo = (tipo: string | null | undefined, acao: AcaoOperacao): string | null => {
  const o = tipo ? MAN.get(tipo) : undefined;
  return o ? `${o.recurso}.${acao}` : null;
};

/** Tipos que o usuário pode VER, dado o que ele tem: alimenta o filtro das listagens (nunca o cliente). */
export const tiposMovimentacaoVisiveis = (tem: (permissao: string) => boolean): string[] =>
  MOVIMENTACOES_REBANHO.filter((o) => tem(`${o.recurso}.view`)).map((o) => o.tipo);
export const tiposManejoVisiveis = (tem: (permissao: string) => boolean): string[] =>
  MANEJOS_REBANHO.filter((o) => tem(`${o.recurso}.view`)).map((o) => o.tipo);

/** Todos os valores aceitos pela coluna discriminadora (com e sem tela) — usado nos testes de cobertura. */
export const TODOS_TIPOS_MOVIMENTACAO: readonly string[] = [...MOVIMENTACOES_REBANHO.map((o) => o.tipo), ...MOVIMENTACOES_INTERNAS];
