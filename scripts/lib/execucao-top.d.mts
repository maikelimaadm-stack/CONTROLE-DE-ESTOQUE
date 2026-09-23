/** Tipos do harness de rollout `execucao-top.mjs` (JS puro), para os testes o importarem sem supressão. */
export declare const BASE_DE_ORIGEM: string;
export declare const CAMINHO_CAPACIDADES: string;
export declare const ASSINATURA: RegExp;
export declare const ARQUIVO_DECISAO: string;
export declare function ocorrenciasNoTexto(texto: string): number;
export declare function ocorrenciasNaArvore(raiz: string): number;
export declare function ocorrenciasNoCommit(sha: string, cwd?: string): number;
export declare function decidir(entrada: { ocorrencias: number }): { declara: boolean; ocorrencias: number; motivo: string };
