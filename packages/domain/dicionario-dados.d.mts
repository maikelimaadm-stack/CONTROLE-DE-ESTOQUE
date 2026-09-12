/** Tipos do dicionário de dados (fonte única funcional em dicionario-dados.mjs). */
export type NaturezaEntidade = "entidade" | "linha" | "infraestrutura";
export interface CampoDicionario { nome: string; descricao: string }
export interface EntradaDicionario {
  codigo: string;
  tabela: string;
  nome: string;
  descricao: string;
  modulo: string;
  natureza: NaturezaEntidade;
  idGlobal: boolean;
  rota?: string;
  discriminador?: string;
  rotas?: Record<string, string>;
  top?: string;
  migracao?: string;
  campos?: Record<string, CampoDicionario>;
}
export interface ColunaSchema { name: string; type: string; notNull: boolean; primaryKey: boolean; references: string | null; check: string | null }
export interface TabelaSchema { table: string; columns: Map<string, ColunaSchema> }
export const VERSAO_DICIONARIO: number;
export const MODULOS_DICIONARIO: Record<string, string>;
export const DICIONARIO_DE_DADOS: readonly EntradaDicionario[];
export function dicionarioPorTabela(): Map<string, EntradaDicionario>;
export function validarDicionarioDeDados(entradas: readonly EntradaDicionario[], schema: Map<string, TabelaSchema>): string[];
