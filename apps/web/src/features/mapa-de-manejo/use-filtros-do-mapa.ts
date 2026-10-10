"use client";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * MAPA-MANEJO-04 (F2) — as OPÇÕES dos filtros de retiro e de módulo de pastejo do mapa operacional.
 *
 * Vêm das listagens genéricas de cadastro (`GET /api/resources/:key`), uma vez por empresa da sessão: a chave da query
 * NÃO tem os filtros, então trocar retiro, módulo ou coloração não busca as opções de novo (a única chamada por mudança
 * de filtro é a de `/api/mapa/operacional`). A chave fica sob `["res", <cadastro>]` de propósito: salvar ou excluir um
 * retiro ou módulo na ficha invalida esse prefixo e as opções acompanham.
 *
 * Sem a permissão de leitura do cadastro, a listagem nem é pedida; recusa, erro ou carga em andamento devolvem `null`,
 * e o select correspondente simplesmente não aparece — a tela do mapa continua inteira.
 */

/** Uma opção de filtro: o id que vai na query de `/api/mapa/operacional` e o texto que a pessoa lê. */
export interface OpcaoDeFiltro {
  id: string;
  rotulo: string;
}

/** As opções dos dois filtros; `null` = indisponível (sem permissão, recusada, com erro ou ainda sem resposta). */
export interface OpcoesDeFiltro {
  retiros: OpcaoDeFiltro[] | null;
  modulos: OpcaoDeFiltro[] | null;
}

/** Linha da listagem de retiros (só os campos que o select usa). */
interface RetiroListado {
  id: string;
  code: string | null;
  name: string | null;
}

/** Linha da listagem de módulos de pastejo: o rótulo do cadastro é `description` (módulo não tem `name`). */
interface ModuloListado {
  id: string;
  code: string | null;
  description: string | null;
}

interface PaginaDaListagem<T> {
  items: T[];
  total: number;
}

/** Retiros: a listagem já sai ordenada pelo código (ordem padrão do cadastro). */
export const CAMINHO_DOS_RETIROS = `/api/resources/retiros${qs({ pageSize: 200 })}`;
/** Módulos: o cadastro não tem ordem padrão (sairia pela data de criação); a ordem pelo código é pedida ao servidor. */
export const CAMINHO_DOS_MODULOS = `/api/resources/grazing_modules${qs({ pageSize: 200, sort: "code" })}`;

const rotuloDaOpcao = (codigo: string | null, nome: string | null): string => {
  const c = (codigo ?? "").trim();
  const n = (nome ?? "").trim();
  if (c && n) return `${c} · ${n}`;
  return n || c || "Sem nome";
};

const opcoesDosRetiros = (p: PaginaDaListagem<RetiroListado>): OpcaoDeFiltro[] =>
  p.items.map((r) => ({ id: r.id, rotulo: rotuloDaOpcao(r.code, r.name) }));

const opcoesDosModulos = (p: PaginaDaListagem<ModuloListado>): OpcaoDeFiltro[] =>
  p.items.map((m) => ({ id: m.id, rotulo: rotuloDaOpcao(m.code, m.description) }));

/** Recusa (4xx) não se repete: negar de novo não muda a resposta. Falha do servidor tenta uma vez mais. */
const repeteSoFalhaDoServidor = (falhas: number, e: unknown): boolean =>
  !(e instanceof ApiError && e.status < 500) && falhas < 1;

const CINCO_MINUTOS = 5 * 60_000;

export function useOpcoesDeFiltro(): OpcoesDeFiltro {
  const { session, can } = useAuth();
  const empresa = session?.empresaId ?? null;
  const podeRetiros = can("retiros.view");
  const podeModulos = can("grazing_modules.view");

  const retiros = useQuery({
    queryKey: ["res", "retiros", "mapa-operacional", empresa],
    queryFn: ({ signal }) => api<PaginaDaListagem<RetiroListado>>(CAMINHO_DOS_RETIROS, { signal }),
    select: opcoesDosRetiros,
    enabled: podeRetiros,
    staleTime: CINCO_MINUTOS,
    retry: repeteSoFalhaDoServidor
  });

  const modulos = useQuery({
    queryKey: ["res", "grazing_modules", "mapa-operacional", empresa],
    queryFn: ({ signal }) => api<PaginaDaListagem<ModuloListado>>(CAMINHO_DOS_MODULOS, { signal }),
    select: opcoesDosModulos,
    enabled: podeModulos,
    staleTime: CINCO_MINUTOS,
    retry: repeteSoFalhaDoServidor
  });

  // `data` só existe depois de uma resposta boa, e fica se uma nova busca (invalidação) falhar: o select não some
  // com um filtro aplicado.
  return {
    retiros: podeRetiros ? retiros.data ?? null : null,
    modulos: podeModulos ? modulos.data ?? null : null
  };
}
