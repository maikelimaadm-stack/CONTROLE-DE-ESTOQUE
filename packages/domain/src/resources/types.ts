/**
 * Definição declarativa de recursos (cadastros) — usada pela API (rotas genéricas, validação, SQL) e pelo
 * frontend (listagem, filtros e formulários). Evita telas vazias: todo recurso definido aqui persiste de verdade.
 */
import type { ChaveReferencia } from "./referencias.js";

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
  busca?: ChaveReferencia;
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
  /**
   * Campo `json` desenhado como CAMPOS (CADASTROS Fase 6): as chaves conhecidas viram entradas tipadas; o valor
   * continua UM objeto JSON. Chave desconhecida é PRESERVADA: na edição a API funde o objeto enviado sobre o
   * gravado (só `null` remove uma chave).
   */
  camposJson?: FieldDef[];
  /**
   * SIGILO (CADASTROS Fase 5): permissão exigida para o campo SAIR da API (leitura) e ser gravado (escrita).
   * Sem ela o campo some da resposta (lista e ficha) e a gravação dele é recusada (403). Ex.: salário.
   */
  sigilo?: string;
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
  /**
   * FICHA EM ABAS (CADASTROS Fase 4, decisão 253) — ver `AbaDef`, `DetalheDef` e `PerfilDef`. Cadastro sem
   * `abas` continua exatamente como antes (formulário de painéis do layout configurável).
   */
  abas?: AbaDef[];
  /** tabelas 1:N gravadas junto com o principal (grade dentro de uma aba) */
  detalhes?: DetalheDef[];
  /** tabelas 1:1 (perfil) gravadas junto com o principal */
  perfis?: PerfilDef[];
  /** campos do cabeçalho FIXO da ficha (ficam visíveis em todas as abas) */
  cabecalho?: string[];
  /** campos do CADASTRO RÁPIDO (diálogo aberto de dentro de outra tela: venda, compra…) — mesma API */
  camposRapidos?: string[];
  /**
   * Recorte FIXO do cadastro (CADASTROS Fase 5): a lista, a ficha e a edição só alcançam linhas com estes
   * valores (ex.: Funcionários = parceiros com `is_employee = true`). Linha fora do recorte = a mesma 404.
   */
  filtroFixo?: Record<string, string | boolean>;
  /**
   * O registro NÃO nasce nem é excluído pela porta genérica (`POST`/`DELETE /resources/:key`): nasce por
   * `rota` (ex.: novo funcionário pelo CPF). A tela de "novo" pergunta `campos` e chama a rota.
   */
  criacao?: { rota: string; mensagem: string; campos: string[] };
}

/**
 * FICHA EM ABAS — mecanismo GENÉRICO do registry (Fases 4 a 7 do programa CADASTROS).
 *
 * API do mecanismo (quem declara, o que acontece):
 *  · `ResourceDef.abas`: ordem = ordem do array. Cada aba junta SEÇÕES de campos do principal (`FieldDef.section`),
 *    grades de DETALHE (`detalhes`, chaves de `ResourceDef.detalhes`) e PERFIS (`perfis`, chaves de
 *    `ResourceDef.perfis`). `visivelQuando` esconde a aba inteira enquanto o campo do principal não tem o valor.
 *    Campo sem seção cai na PRIMEIRA aba.
 *  · Corpo do POST/PUT `/resources/:key[/:id]`: os campos do principal + `<detalhe.key>: linha[]` +
 *    `<perfil.key>: {…}`. Schema ESTRITO: uma API anterior ao mecanismo recusa essas chaves (422) em vez de
 *    ignorá-las.
 *  · GRAVAÇÃO ATÔMICA: principal, detalhes e perfis na MESMA transação do `runService`. Qualquer erro → nada
 *    gravado; o 422 traz `details[]` com `path`, `aba`, `detalhe` e `linha` (1-based) para a tela marcar a aba.
 *  · PUT: detalhe AUSENTE no corpo = a grade não é tocada; PRESENTE = lista COMPLETA (linha com `id` atualiza,
 *    sem `id` inclui, linha viva que não veio é removida — soft delete quando a tabela tem `deleted_at`).
 *  · PERFIL com `ativoPor`: o perfil acompanha o campo booleano do principal. Desmarcar NÃO apaga o perfil:
 *    inativa (`is_active = false`) e a aba some; remarcar reativa com os dados de antes.
 *  · GET `/resources/:key/:id` devolve as grades e os perfis nas mesmas chaves do corpo.
 */
export interface AbaDef {
  key: string;
  label: string;
  /** seções de `fields` exibidas nesta aba, na ordem */
  secoes?: string[];
  /** grades de detalhe (chaves de `ResourceDef.detalhes`) */
  detalhes?: string[];
  /** perfis 1:1 (chaves de `ResourceDef.perfis`) */
  perfis?: string[];
  /** aba só aparece quando o campo do principal tem esse valor */
  visivelQuando?: { field: string; equals: unknown };
  /**
   * Painel SOMENTE LEITURA da aba (CADASTROS Fase 6): `historico` = auditoria do registro e das suas grades
   * (`GET /resources/:key/:id/historico`); `saldo_por_lote` = saldo do produto por armazém e lote no escopo de
   * empresa do usuário (`GET /stock/balances?product_id=`).
   */
  painel?: "historico" | "saldo_por_lote";
  /**
   * Os campos das SEÇÕES desta aba só são gravados por quem tem esta permissão (além da do cadastro); sem
   * ela a aba é somente leitura na tela e a API recusa (403) o corpo que os traga (CADASTROS Fase 5). Ex.: aba
   * Pessoal da ficha de RH exige `people.edit`.
   */
  permissaoDeEdicao?: string;
  /** link da aba para outro cadastro (ex.: "Editar no cadastro de parceiros"); `:id` = id do registro */
  link?: { label: string; href: string };
}

export interface DetalheDef {
  /** chave no corpo da API e na resposta */
  key: string;
  label: string;
  table: string;
  /** coluna que aponta para o principal (ex.: person_id) */
  chavePai: string;
  fields: FieldDef[];
  /**
   * Linha SEM coluna `id`: a identidade é esta coluna (ex.: empresa_id em proprietary_empresas). Sem ela a
   * tabela tem `id uuid`.
   */
  chaveNatural?: string;
  /** a tabela tem `organization_id` (FK composta com o principal) */
  organizacao?: boolean;
  /** a tabela tem `deleted_at`: linha removida da grade é EXCLUÍDA logicamente, nunca apagada */
  softDelete?: boolean;
  /** coluna de empresa da linha: cada empresa é conferida contra o escopo de lançamento do usuário */
  campoEmpresa?: string;
  /** máximo de linhas por gravação */
  maxLinhas?: number;
}

export interface PerfilDef {
  key: string;
  label: string;
  table: string;
  /** coluna que aponta para o principal (é a chave primária do perfil) */
  chavePai: string;
  fields: FieldDef[];
  /** campo booleano do principal que liga o perfil (ex.: is_client) */
  ativoPor?: string;
}

export const yesNo: FieldOption[] = [{ value: "true", label: "Sim" }, { value: "false", label: "Não" }];
