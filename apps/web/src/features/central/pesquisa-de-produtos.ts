"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import type { FonteDaPesquisaDeProdutos, OpcaoDaPesquisa } from "./contrato";

/**
 * A PESQUISA DE PRODUTO COM O SALDO DO LOCAL (OPERACOES-01 F3b, decisão 280) — a fonte nova do motor.
 *
 * `GET /api/produtos/pesquisa` é porta GENÉRICA (como `/api/resources/<recurso>/options`): código, descrição e, para
 * quem vê o saldo do local pedido, o estoque. Os parâmetros que a F3b acrescentou (`pagina`, `com_saldo`,
 * `controla_estoque`) só saem quando a API DECLARA que os entende: `GET /api/produtos/pesquisa/capacidades` com a forma
 * e a versão EXATAS. A API anterior não tem essa rota (404 de rota) e recusa parâmetro desconhecido (422, `.strict()`);
 * sem a declaração o motor usa a pesquisa de hoje (`/api/resources/products/options`), idêntica — nem a rota nova sai.
 *
 * Nada aqui decide quem vê o saldo: o servidor manda `estoque` nulo e ignora o filtro para quem não vê (sem oráculo).
 */

/** A versão da capacidade `pesquisaDeProdutos` que esta tela sabe usar (a API declara a mesma, de propósito duplicada). */
export const CAPACIDADE_PESQUISA_DE_PRODUTOS = 1 as const;
export const PORTA_DA_PESQUISA_DE_PRODUTOS = "/api/produtos/pesquisa";
export const PORTA_DAS_CAPACIDADES_DA_PESQUISA = "/api/produtos/pesquisa/capacidades";
/** Produtos por página (o máximo do `limite` da rota). */
export const LIMITE_DA_PAGINA_DA_PESQUISA = 50;
/** A última página que a rota aceita (`LIMITE_DE_PAGINAS` da API): depois dela, quem procura refina a busca. */
export const ULTIMA_PAGINA_DA_PESQUISA = 1000;
/** O tamanho máximo da busca que a rota aceita (texto aparado). */
export const LIMITE_DA_BUSCA_DA_PESQUISA = 100;

/** A API declara a pesquisa nova? Forma e versão EXATAS — um valor desconhecido é tratado como ausente. */
export function entendePesquisaDeProdutos(r: unknown): boolean {
  if (typeof r !== "object" || r === null) return false;
  const c = (r as { capacidades?: unknown }).capacidades;
  if (typeof c !== "object" || c === null) return false;
  return (c as { pesquisaDeProdutos?: unknown }).pesquisaDeProdutos === CAPACIDADE_PESQUISA_DE_PRODUTOS;
}

/**
 * De onde vem a pesquisa de produto. Uma pergunta por sessão (cache infinito), feita quando a Central monta os itens:
 * "carregando" até a resposta; "nova" só com a declaração exata; QUALQUER outra coisa (404 de rota da API anterior,
 * 5xx, rede, forma diferente) é "legado" — a pesquisa de hoje. O 404 não é repetido (é a API anterior).
 */
export function useFonteDaPesquisaDeProdutos(): FonteDaPesquisaDeProdutos {
  const q = useQuery({
    queryKey: ["produtos-pesquisa-capacidades"],
    queryFn: () => api<unknown>(PORTA_DAS_CAPACIDADES_DA_PESQUISA),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status === 404)
  });
  if (q.isPending) return "carregando";
  return q.isSuccess && entendePesquisaDeProdutos(q.data) ? "nova" : "legado";
}

/** Um produto da página, como a rota o devolve (campo que o usuário não vê sai nulo). */
export interface ItemDaPesquisa {
  id: string; codigo: string | null; descricao: string | null; referencia: string | null; unidade: string | null;
  /** Saldo físico no local, decimal em texto; nulo para quem não vê o saldo daquele local. */
  estoque: string | null;
}
/** Uma página da pesquisa nova. */
export interface PaginaDaPesquisa {
  itens: ItemDaPesquisa[];
  /** O saldo do local está nesta resposta (o chamador o vê). */
  estoqueDoArmazem: boolean;
  /** Há ao menos um produto depois desta página. */
  temMais: boolean;
  /** O filtro "só com saldo" foi APLICADO (pedido e o chamador vê o saldo do local). */
  filtradoPorSaldo: boolean;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function foraDaForma(onde: string): never {
  throw new Error(`A pesquisa de produtos respondeu fora da forma esperada (${onde}).`);
}
const textoOuNulo = (v: unknown, onde: string): string | null => {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : foraDaForma(onde);
};
const booleano = (v: unknown, onde: string): boolean => {
  if (v === undefined) return false;
  return typeof v === "boolean" ? v : foraDaForma(onde);
};

/**
 * Leitor ESTRITO da página: `itens` é lista de objetos com `id` texto; os campos de texto são texto ou nulo; `estoque`,
 * decimal em texto ou nulo; as marcas são booleanas (ausente = falso). Fora da forma, lança — e a query mostra o erro,
 * nunca uma lista inventada.
 */
export function lerPaginaDaPesquisa(r: unknown): PaginaDaPesquisa {
  if (!ehObjeto(r) || !Array.isArray(r["itens"])) foraDaForma("itens");
  const itens = (r["itens"] as unknown[]).map((x, i): ItemDaPesquisa => {
    if (!ehObjeto(x) || typeof x["id"] !== "string" || !x["id"]) foraDaForma(`itens[${i}].id`);
    const estoque = textoOuNulo(x["estoque"], `itens[${i}].estoque`);
    if (estoque !== null && !DECIMAL.test(estoque)) foraDaForma(`itens[${i}].estoque`);
    return {
      id: x["id"] as string,
      codigo: textoOuNulo(x["codigo"], `itens[${i}].codigo`),
      descricao: textoOuNulo(x["descricao"], `itens[${i}].descricao`),
      referencia: textoOuNulo(x["referencia"], `itens[${i}].referencia`),
      unidade: textoOuNulo(x["unidade"], `itens[${i}].unidade`),
      estoque
    };
  });
  return {
    itens,
    estoqueDoArmazem: booleano(r["estoqueDoArmazem"], "estoqueDoArmazem"),
    temMais: booleano(r["temMais"], "temMais"),
    filtradoPorSaldo: booleano(r["filtradoPorSaldo"], "filtradoPorSaldo")
  };
}

export interface ConsultaDaPesquisa {
  busca: string;
  /** O local da LINHA; sem ele, nem saldo nem filtro. */
  armazemId?: string;
  /** "Só com saldo neste local" (só sai com o local). */
  soComSaldo: boolean;
  /** Só produto que controla estoque. */
  soControlaEstoque?: boolean;
  pagina: number;
}

/** A busca como a rota a aceita: aparada e no máximo `LIMITE_DA_BUSCA_DA_PESQUISA` caracteres. */
const buscaDaRota = (busca: string) => busca.trim().slice(0, LIMITE_DA_BUSCA_DA_PESQUISA).trim();

/**
 * A query string de UMA página. Os booleanos só saem como "true" (ausente = falso; "false" nunca sai):
 * `com_saldo=true` só com `soComSaldo` E o local (sem local a rota recusa); `controla_estoque=true` só com
 * `soControlaEstoque`. Página sempre explícita, limite de `LIMITE_DA_PAGINA_DA_PESQUISA`.
 */
export function consultaDaPesquisaDeProdutos({ busca, armazemId, soComSaldo, soControlaEstoque, pagina }: ConsultaDaPesquisa): string {
  return qs({
    busca: buscaDaRota(busca) || undefined,
    armazem_id: armazemId || undefined,
    limite: LIMITE_DA_PAGINA_DA_PESQUISA,
    pagina,
    com_saldo: soComSaldo && armazemId ? "true" : undefined,
    controla_estoque: soControlaEstoque ? "true" : undefined
  });
}

/**
 * A pesquisa nova, página a página ("Mostrar mais"): chave de cache PRÓPRIA (nunca a `["options", …]` do `RefSelect`),
 * a página seguinte só enquanto o servidor diz `temMais` (e até a última que a rota aceita).
 */
export function usePesquisaDeProdutos({ busca, armazemId, soComSaldo, soControlaEstoque, ativo }: Omit<ConsultaDaPesquisa, "pagina"> & { ativo: boolean }) {
  const termo = buscaDaRota(busca);
  const local = armazemId || undefined;
  // o filtro só existe com o local: a chave diz o que vai no fio
  const comSaldo = soComSaldo && Boolean(local);
  const soEstoque = Boolean(soControlaEstoque);
  return useInfiniteQuery({
    queryKey: ["produtos-pesquisa", termo, local ?? "", comSaldo, soEstoque],
    queryFn: async ({ pageParam }) => lerPaginaDaPesquisa(await api<unknown>(
      `${PORTA_DA_PESQUISA_DE_PRODUTOS}${consultaDaPesquisaDeProdutos({ busca: termo, armazemId: local, soComSaldo: comSaldo, soControlaEstoque: soEstoque, pagina: pageParam })}`
    )),
    initialPageParam: 1,
    getNextPageParam: (ultima: PaginaDaPesquisa, todas: PaginaDaPesquisa[]) =>
      (ultima.temMais && todas.length < ULTIMA_PAGINA_DA_PESQUISA ? todas.length + 1 : undefined),
    enabled: ativo,
    staleTime: 60_000
  });
}

/** O item da página como opção do painel: rótulo pela descrição (o código, se ela não vier) e o saldo à parte. */
export function opcaoDoProduto(item: ItemDaPesquisa): OpcaoDaPesquisa {
  return { id: item.id, label: item.descricao ?? item.codigo ?? "—", code: item.codigo, estoque: item.estoque };
}
