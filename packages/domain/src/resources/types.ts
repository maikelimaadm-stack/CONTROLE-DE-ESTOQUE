/**
 * Definição declarativa de recursos (cadastros) — usada pela API (rotas genéricas, validação, SQL) e pelo
 * frontend (listagem, filtros e formulários). Evita telas vazias: todo recurso definido aqui persiste de verdade.
 */
export type FieldType = "text" | "textarea" | "number" | "integer" | "money" | "quantity" | "percent" | "date" | "boolean" | "select" | "ref" | "email" | "json" | "tags";

export interface FieldOption { value: string; label: string }

export interface FieldDef {
  /** nome do campo = coluna no banco (snake_case) */
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  /** referência a outro recurso (select com busca) */
  ref?: { resource: string; labelField?: string };
  /** exibir na listagem */
  list?: boolean;
  /** filtrar na listagem */
  filter?: boolean;
  /** participa da busca textual */
  search?: boolean;
  readOnly?: boolean;
  default?: unknown;
  help?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  /** agrupamento visual no formulário */
  section?: string;
  /** largura em colunas (1-12) */
  span?: number;
  /** campo dependente: só visível quando outro campo tem valor */
  visibleWhen?: { field: string; equals: unknown };
}

export interface ResourceDef {
  key: string;
  label: string;
  labelPlural: string;
  table: string;
  /** chave de permissão (recurso) */
  permission: string;
  /** possui farm_id (escopo por fazenda ativa) */
  farmScoped?: boolean;
  /** entidade de sequência para código automático (coluna code) */
  codeEntity?: string;
  fields: FieldDef[];
  /** coluna padrão de ordenação */
  defaultSort?: string;
  /** soft delete (deleted_at) */
  softDelete?: boolean;
  /** campo usado como rótulo em selects */
  labelField: string;
  /** relatório/impressão da listagem disponível */
  printable?: boolean;
  /** importação/exportação XLSX/CSV */
  importExport?: boolean;
  /** rota no menu (para links) */
  route: string;
  /** hierarquia (parent_id) */
  tree?: boolean;
  /** tabela sem organization_id, referência global (somente leitura) */
  reference?: boolean;
  /** tabela com registros padrão do sistema (organization_id null) visíveis a todas as organizações */
  sharedDefaults?: boolean;
}

export const yesNo: FieldOption[] = [{ value: "true", label: "Sim" }, { value: "false", label: "Não" }];
