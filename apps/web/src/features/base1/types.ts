import type * as React from "react";
import type { FilterKind } from "@agro/shared";

/**
 * MODELO BASE1 — modelo de tela reutilizável (réplica do cadastro de Empresas do sistema de referência MG):
 * barra superior (Novo, pesquisa, alternância Registro/Tabela/Cards, mais opções), faixa de chips de filtro por
 * coluna, grade com seleção/menus de coluna/congelar/redimensionar, cards configuráveis, rodapé com contadores.
 */
export type Row = Record<string, unknown>;

export interface Base1Column {
  key: string;
  label: string;
  /** família de operadores/valores (para o chip de filtro desta coluna) */
  kind?: FilterKind;
  render?: (row: Row) => React.ReactNode;
  /** texto simples da célula (tooltip, cards, exportação); padrão: String(row[key]) */
  text?: (row: Row) => string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  width?: number;
  /**
   * CAPACIDADES DA COLUNA — o que a grade pode OFERECER sobre ela.
   *
   * Existem por causa de um defeito real: uma coluna pode ser estruturalmente fixa (a identidade `#N` da
   * PRE-BASE2-05B.1, por exemplo, que vive fora das preferências do usuário), mas a grade continuava
   * oferecendo "Ocultar", "Auto ajustar", "Congelar" e a alça de redimensionar para TODA coluna. Os
   * controles apareciam habilitados e não faziam nada — ou faziam durante o gesto e voltavam depois, que é
   * pior: o usuário não sabe se o sistema o ignorou ou se ele errou.
   *
   * A declaração é da COLUNA, não da grade: nenhum componente genérico precisa conhecer `id_global` nem
   * qualquer outra chave de domínio, e a próxima coluna travada nasce funcionando.
   *
   * Padrão `true` em todas — colunas comuns continuam exatamente como sempre foram.
   */
  hideable?: boolean;
  resizable?: boolean;
  freezable?: boolean;
  autoFit?: boolean;
  filterable?: boolean;
  /**
   * PINAGEM ESTRUTURAL — diferente de `freezable`, e a distinção é o ponto.
   *
   * `freezable: false` diz "o USUÁRIO não muda isto"; não diz que a coluna está fixa. São duas perguntas
   * independentes, e uma coluna pode responder sim a uma e não à outra: a identidade (`id_global`) nega todas
   * as capacidades e, desde a PRE-BASE2-05B.2, NÃO usa `pinned` — ela rola com as demais.
   *
   * Quem declara `pinned` fica preso à borda mesmo na listagem que nunca configura congelamento (é o caso de
   * toda tela montada com `DataTable`, que passa `frozen` zero). Hoje nenhuma coluna do produto declara — o
   * campo existe para quando uma precisar, e é o motor que sabe honrá-lo.
   *
   * As colunas pinadas formam o PREFIXO da grade: valem as que estiverem no começo da lista. Uma coluna
   * marcada como pinada fora desse prefixo não é pinada — pinar do meio exigiria reordenar a grade por
   * conta própria, que é surpresa pior do que o pedido ignorado.
   */
  pinned?: "left";
}

/** Como o filtro vira parâmetro de consulta. `advanced` = `campo__operador=valor` (recursos declarativos); `simple` = `campo=valor`. */
export interface Base1FilterDef {
  key: string;
  label: string;
  kind: FilterKind;
  mode: "advanced" | "simple";
  /** recurso referenciado (kind ref): lista de valores via /options */
  resource?: string;
  /** filtro extra para as opções do recurso referenciado */
  resourceFilter?: Record<string, string>;
  /** opções fixas (kind enum/boolean) */
  options?: { value: string; label: string }[];
  /** modo simple + kind date: nomes dos parâmetros de início/fim (ex.: start_date/end_date) */
  range?: { from: string; to: string };
}

export interface FilterValue { op: string; value: string; value2?: string; values?: string[] }
export type FilterValues = Record<string, FilterValue>;

export interface DistinctValue { value: string; label: string; count?: number }
