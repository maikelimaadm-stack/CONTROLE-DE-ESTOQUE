/**
 * TIPOS de `empresa-rls.mjs`. O SSOT de runtime continua sendo o `.mjs`, e ele não muda: este arquivo só
 * descreve o que aquele já exporta, para que quem consome de TypeScript não precise suprimir o erro.
 *
 * Mesmo padrão já usado em `dicionario-dados.d.mts`. Duas regras valem aqui, e as duas são o motivo de o
 * arquivo ser curto: (1) não existe valor declarado aqui que não exista lá — este arquivo não é um segundo
 * SSOT, é a sombra tipada do primeiro; (2) tipa-se o que o repositório de fato consome, com fidelidade,
 * nunca um contrato mais largo do que o real (um `Record<string, any>` de conveniência devolveria, por
 * outro caminho, exatamente a supressão que se está removendo).
 */

/** Chaves das categorias da matriz. O texto é o rótulo humano exibido em `docs/COMPANY-RLS-MATRIX.md`. */
export type Categoria = "A" | "B" | "C" | "D" | "E" | "F";
export declare const CATEGORIAS: Record<Categoria, string>;

/** Forma de `protecao`, como as fábricas `tenantDireto` e `filhoDe` a constroem. */
export interface ProtecaoDeExcecao {
  politica: string;
  familia: "tenant_direct" | "api_child";
  cmd: string;
  permissiva: boolean;
  papeis: string[];
  exigeUsing: boolean;
  exigeCheck: boolean;
  /** Só na família `api_child`: o cadastro pai e a coluna de vínculo com ele. */
  pai?: string;
  colunaVinculo?: string;
}

export interface ExcecaoRlsEmpresa {
  categoria: Categoria;
  protecao: ProtecaoDeExcecao;
  motivo: string;
  protegidaPor: string;
}
export declare const EXCECOES_RLS_EMPRESA: Record<string, ExcecaoRlsEmpresa>;

export declare const PARES_ORIGEM_DESTINO: string[];

export interface SubcategoriaTransferencia {
  id: string;
  rotulo: string;
  leitura: string;
  escrita: string;
  porque: string;
  prova: string;
  /** Só onde o aceite é operação privilegiada (C1). */
  privilegiada?: string;
}
export declare const SUBCATEGORIAS_TRANSFERENCIA: Record<string, SubcategoriaTransferencia>;
export declare function subcategoriaTransferencia(tabela: string): SubcategoriaTransferencia | null;

export declare function classificarTabela(tabela: string, colunas: string[], anulavel: boolean): Categoria;

/** O que se espera de CADA comando. `null` onde o lado não se aplica àquele comando. */
export interface PoliticaEsperada {
  cmd: string;
  using: string | null;
  check: string | null;
}
/** `null` para tabela de exceção: ali a pergunta é respondida por `validarProtecaoDaExcecao`. */
export declare function politicasEsperadas(
  categoria: Categoria,
  tabela: string,
): Record<string, PoliticaEsperada> | null;

export declare function protecaoDaExcecao(tabela: string): ProtecaoDeExcecao | null;
export declare const TABELAS_DE_EXCECAO: string[];

/** Uma linha de `pg_policies`, como o guarda a lê do banco. */
export interface LinhaPgPolicies {
  policyname: string;
  cmd: string;
  permissive: string;
  papeis?: string[];
  qual?: string | null;
  with_check?: string | null;
}
/** Devolve a lista de problemas; vazia significa aprovado. */
export declare function validarProtecaoDaExcecao(
  tabela: string,
  protecao: ProtecaoDeExcecao | null,
  politicas: LinhaPgPolicies[] | null | undefined,
): string[];

export declare function politicaEsperada(categoria: Categoria): string;

/** Coluna de empresa sem FK composta, declarada uma a uma: chave `tabela.coluna`, valor = o motivo. */
export declare const SEM_FK_COMPOSTA_DECLARADA: Record<string, string>;
