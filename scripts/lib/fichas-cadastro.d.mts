/** Tipos do harness de rollout `fichas-cadastro.mjs` (JS puro), para os testes o importarem sem supressão. */
export declare const DIR_MIGRATIONS: string;
export declare const FATIAS: Readonly<Record<"grupoArvore" | "fichaParceiro" | "rhFuncionarios" | "fichaProduto", Readonly<{ migration: string; oQue: string }>>>;
export declare const ARQUIVO_DECISAO: string;
export declare const VARIAVEL: string;
export declare function migrationsNaArvore(raiz: string): string[];
export declare function migrationsNoCommit(sha: string, cwd?: string): string[];
export declare function valorDaVariavel(fatias: Record<string, boolean>): string;
export declare function decidir(entrada: { daBase: string[]; doHead: string[] }): { fatias: Record<string, boolean>; motivo: string };
