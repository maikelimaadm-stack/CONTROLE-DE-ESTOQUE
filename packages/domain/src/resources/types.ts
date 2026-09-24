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
  ref?: {
    resource: string; labelField?: string;
    /**
     * Recorte fixo da LISTA de opções (`GET /resources/:key/options?campo=valor`). Só apresentação: quem
     * recusa o valor fora do recorte é o servidor ao gravar.
     */
    filtro?: Record<string, string>;
  };
  /**
   * Campo preenchido por BUSCA numa referência oficial (município, banco, NCM, CBO — `referencias.ts`). O
   * valor gravado continua o CÓDIGO oficial (o mesmo de antes da busca existir); só a tela muda.
   */
  busca?: import("./referencias.js").ChaveReferencia;
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
  /**
   * obrigatório CONDICIONAL: só quando outro campo tem esse valor (vazio = `default` dele).
   * O banco continua sendo a autoridade; isto serve para a tela e o modelo de importação avisarem antes.
   */
  requiredWhen?: { field: string; equals: unknown };
  /**
   * Cadastro em árvore: no registro NOVO, o campo nasce com o valor do SUPERIOR escolhido (pré-preenchido e
   * editável, enquanto o usuário não o alterou). Só a tela usa; a regra que recusa divergência mora na API.
   */
  herdaDoSuperior?: boolean;
}

export interface ResourceDef {
  key: string;
  label: string;
  labelPlural: string;
  table: string;
  /** chave de permissão (recurso) */
  permission: string;
  /** possui `empresa_id` NOT NULL (escopo da empresa do registro) */
  empresaScoped?: boolean;
  /**
   * possui `empresa_id` ANULÁVEL, em que nulo = registro da ORGANIZAÇÃO (vale para todas as empresas).
   * O recorte de leitura é o mesmo, com semântica nullable: o registro sem empresa continua visível.
   * Na ESCRITA, criar um registro sem empresa alcança todas elas — então só quem tem o módulo em
   * `todas` (ou o proprietário) pode fazê-lo; quem tem `selecionadas` precisa dizer a empresa.
   */
  empresaScopedNulo?: boolean;
  /** entidade de sequência para código automático (coluna code) */
  codeEntity?: string;
  fields: FieldDef[];
  /**
   * Campos que a API ainda ACEITA na escrita, mas que saíram da tela, da listagem, dos filtros e da
   * importação (legado). Existem para a janela de deploy: a web ANTERIOR continua mandando o campo e a API
   * nova grava o que vier, em vez de recusar o corpo inteiro pelo `.strict()`. Nunca obrigatórios.
   */
  camposLegadosDeEscrita?: FieldDef[];
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
  /** importação por modelo XLSX (baixar modelo + importar), com o servidor conferindo cada linha pelas regras do cadastro */
  importacao?: boolean;
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
