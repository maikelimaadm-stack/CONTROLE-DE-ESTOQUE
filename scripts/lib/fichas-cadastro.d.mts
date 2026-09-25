/** Tipos do harness de rollout `fichas-cadastro.mjs` (JS puro), para os testes o importarem sem supressão. */
export type ChaveDaFatia = "grupoArvore" | "fichaParceiro" | "rhFuncionarios" | "fichaProduto" | "cadastrosAjustes01";
export declare const DIR_MIGRATIONS: string;
export declare const FATIAS: Readonly<Record<ChaveDaFatia, Readonly<{ migration: string; capacidade?: string; oQue: string }>>>;
export declare const ARQUIVO_CAPACIDADES: string;
export declare const ARQUIVO_DECISAO: string;
export declare const VARIAVEL: string;
export declare function declaracoesDaCapacidade(fonte: string | null | undefined, nome: string): number | null;
export declare function migrationsNaArvore(raiz: string): string[];
export declare function migrationsNoCommit(sha: string, cwd?: string): string[];
export declare function valorDaVariavel(fatias: Record<string, boolean>): string;
export declare function decidir(entrada: { daBase: string[]; doHead: string[]; capacidadesDaBase?: string | null; capacidadesDoHead?: string | null }): { fatias: Record<string, boolean>; motivo: string };
