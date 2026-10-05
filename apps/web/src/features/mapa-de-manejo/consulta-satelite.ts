/**
 * Nova consulta de satélite — contrato do pedido e regras puras (sem React e sem `@/`).
 *
 * POST /api/satelite/consultas  { alvo, periodo, indices, confirmar }
 *   · `confirmar:false` → prévia (nada é gravado); `confirmar:true` → cria a consulta (201).
 * A tela nunca manda geometria nem empresa: o alvo é uma lista de ids, "todas" ou um retiro, e o servidor recorta.
 */
import { BUNDLE_PASTAGEM_ESSENCIAL, JANELA_CONSULTA_DIAS, MAX_ITENS_POR_CONSULTA } from "@agro/domain";

export type SelecaoConsulta = "atual" | "escolhidas" | "viewport" | "retiro" | "fazenda" | "sem_analise";

export const ROTULO_SELECAO: Readonly<Record<SelecaoConsulta, string>> = {
  atual: "Área aberta no painel",
  escolhidas: "Áreas escolhidas na lista",
  viewport: "Áreas à vista no mapa",
  retiro: "Um retiro",
  fazenda: "Toda a fazenda",
  sem_analise: "Áreas ainda sem análise"
};

export const ORDEM_SELECAO: readonly SelecaoConsulta[] = ["atual", "escolhidas", "viewport", "retiro", "fazenda", "sem_analise"];

export type AlvoConsulta =
  | { tipo: "areas"; area_ids: string[] }
  | { tipo: "todas" }
  | { tipo: "retiro"; retiro_id: string };

export interface CorpoConsulta {
  alvo: AlvoConsulta;
  periodo: { tipo: "mais_recente"; janela_dias: number };
  indices: [typeof BUNDLE_PASTAGEM_ESSENCIAL];
  confirmar: boolean;
}

export interface FonteDeSelecao {
  areaAtualId: string | null;
  escolhidas: readonly string[];
  naVista: readonly string[];
  semAnalise: readonly string[];
  retiroId: string | null;
}

export type AlvoResolvido = { ok: true; alvo: AlvoConsulta; quantidade: number | null } | { ok: false; motivo: string };

export const JANELAS_DIAS_OPCOES: readonly number[] = [7, 15, 30, 60, 90];
export const JANELA_DIAS_PADRAO = 30;

/** Um item = área × data × índice. Aqui: uma data (mais recente) e um índice (o bundle) por área. */
export const LIMITE_AREAS_NA_CONSULTA = MAX_ITENS_POR_CONSULTA;

const unicos = (ids: readonly string[]) => [...new Set(ids)];

function porLista(ids: readonly string[], vazio: string): AlvoResolvido {
  const lista = unicos(ids);
  if (lista.length === 0) return { ok: false, motivo: vazio };
  if (lista.length > LIMITE_AREAS_NA_CONSULTA) {
    return { ok: false, motivo: `São ${lista.length} áreas; o máximo é ${LIMITE_AREAS_NA_CONSULTA} por consulta. Reduza a seleção.` };
  }
  return { ok: true, alvo: { tipo: "areas", area_ids: lista }, quantidade: lista.length };
}

export function resolverAlvo(selecao: SelecaoConsulta, f: FonteDeSelecao): AlvoResolvido {
  switch (selecao) {
    case "atual":
      return f.areaAtualId ? porLista([f.areaAtualId], "") : { ok: false, motivo: "Abra uma área no mapa para consultar só ela." };
    case "escolhidas":
      return porLista(f.escolhidas, "Marque ao menos uma área.");
    case "viewport":
      return porLista(f.naVista, "Nenhuma área com contorno está à vista no mapa.");
    case "sem_analise":
      return porLista(f.semAnalise, "Todas as áreas com contorno já têm análise.");
    case "retiro":
      return f.retiroId ? { ok: true, alvo: { tipo: "retiro", retiro_id: f.retiroId }, quantidade: null } : { ok: false, motivo: "Escolha o retiro." };
    case "fazenda":
      return { ok: true, alvo: { tipo: "todas" }, quantidade: null };
  }
}

export function montarCorpoConsulta(alvo: AlvoConsulta, janelaDias: number, confirmar: boolean): CorpoConsulta {
  const dias = Math.min(JANELA_CONSULTA_DIAS.maximo, Math.max(JANELA_CONSULTA_DIAS.minimo, Math.trunc(janelaDias)));
  return {
    alvo,
    periodo: { tipo: "mais_recente", janela_dias: dias },
    indices: [BUNDLE_PASTAGEM_ESSENCIAL],
    confirmar
  };
}

export interface PreviaConsulta {
  total_itens: number;
  reaproveitados: number;
  novos: number;
  estimativa_creditos: { minimo: string; maximo: string };
  saldo_creditos_mes: string | null;
  excede_orcamento: boolean;
  empresa_id: string;
  areas_ignoradas: { area_id: string; nome: string; motivo: string }[];
}

export interface ConsultaDto {
  id: string;
  situacao: string;
  total_itens: number;
  total_concluidos: number;
  total_falhos: number;
  total_reaproveitados: number;
  criado_em: string;
  concluida_em: string | null;
}

export interface ConsultaCriada {
  consulta: ConsultaDto;
  total_itens: number;
  reaproveitados: number;
  novos: number;
  areas_ignoradas: PreviaConsulta["areas_ignoradas"];
}

export interface RespostaConsulta {
  consulta: ConsultaDto;
  itens: unknown[];
  pagina: number;
  tamanho: number;
  tem_mais: boolean;
}

export const SITUACOES_FINAIS_CONSULTA: readonly string[] = ["concluida", "concluida_com_falhas", "cancelada"];
export const consultaTerminou = (situacao: string) => SITUACOES_FINAIS_CONSULTA.includes(situacao);

export const ROTULO_SITUACAO_CONSULTA: Readonly<Record<string, string>> = {
  pendente: "Na fila",
  executando: "Em andamento",
  concluida: "Concluída",
  concluida_com_falhas: "Concluída com falhas",
  cancelada: "Cancelada"
};

/** Progresso 0..100 a partir dos contadores da consulta (feitos = concluídos + reaproveitados + falhos, limitado ao total). */
export function progressoDaConsulta(c: Pick<ConsultaDto, "total_itens" | "total_concluidos" | "total_falhos" | "total_reaproveitados" | "situacao">): number {
  if (consultaTerminou(c.situacao)) return 100;
  if (c.total_itens <= 0) return 0;
  const feitos = Math.min(c.total_itens, c.total_concluidos + c.total_falhos + c.total_reaproveitados);
  return Math.round((feitos / c.total_itens) * 100);
}
