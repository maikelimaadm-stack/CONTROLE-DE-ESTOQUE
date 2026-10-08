/**
 * Nova consulta de satélite — contrato do pedido e regras puras (sem React e sem `@/`).
 *
 * POST /api/satelite/consultas  { alvo, periodo, indices, confirmar }
 *   · `confirmar:false` → prévia (nada é gravado); `confirmar:true` → cria a consulta (201).
 * A tela nunca manda geometria nem empresa: o alvo é uma lista de ids, "todas" ou um retiro, e o servidor recorta.
 */
import {
  BUNDLE_PASTAGEM_ESSENCIAL,
  ErroPeriodoConsulta,
  JANELA_CONSULTA_DIAS,
  MAX_ITENS_POR_CONSULTA,
  TOLERANCIA_CONSULTA_DIAS,
  slotsDoPeriodo,
  type PeriodoConsulta
} from "@agro/domain";

export type SelecaoConsulta = "atual" | "escolhidas" | "viewport" | "retiro" | "empresa" | "sem_analise" | "desatualizadas";

export const ROTULO_SELECAO: Readonly<Record<SelecaoConsulta, string>> = {
  atual: "Área aberta no painel",
  escolhidas: "Escolher áreas",
  viewport: "Áreas visíveis no mapa",
  retiro: "Por retiro",
  empresa: "Todos os pastos",
  sem_analise: "Sem análise",
  desatualizadas: "Desatualizados"
};

/** Ordem do modal "Analisar áreas" (MAPA-UX-02): sem "atual" — o fluxo padrão é em lote. */
export const ORDEM_SELECAO: readonly SelecaoConsulta[] = ["empresa", "viewport", "escolhidas", "retiro", "sem_analise", "desatualizadas"];

export type AlvoConsulta =
  | { tipo: "areas"; area_ids: string[] }
  | { tipo: "todas" }
  | { tipo: "retiro"; retiro_id: string };

export type { PeriodoConsulta };

export interface CorpoConsulta {
  alvo: AlvoConsulta;
  periodo: PeriodoConsulta;
  indices: [typeof BUNDLE_PASTAGEM_ESSENCIAL];
  confirmar: boolean;
}

export interface FonteDeSelecao {
  areaAtualId: string | null;
  escolhidas: readonly string[];
  naVista: readonly string[];
  semAnalise: readonly string[];
  /** `null` = não dá para afirmar (resumo ainda não chegou, ou foi cortado no teto da página). */
  desatualizadas?: readonly string[] | null;
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
    case "desatualizadas":
      return f.desatualizadas == null
        ? { ok: false, motivo: "Ainda não é possível saber quais áreas estão desatualizadas (o resumo das áreas não está completo)." }
        : porLista(f.desatualizadas, "Todas as áreas com contorno têm análise válida do contorno atual para o índice ativo.");
    case "retiro":
      return f.retiroId ? { ok: true, alvo: { tipo: "retiro", retiro_id: f.retiroId }, quantidade: null } : { ok: false, motivo: "Escolha o retiro." };
    case "empresa":
      return { ok: true, alvo: { tipo: "todas" }, quantidade: null };
  }
}

/**
 * Áreas cujo contorno ATUAL não tem análise válida do método ativo: sem observação útil no resumo do índice, ou com a
 * observação de outro contorno (`do_poligono_atual` falso). Só áreas com contorno entram (sem contorno não há o que analisar).
 * Calculado no cliente a partir do resumo por área; é recorte de seleção, não autorização — o servidor recorta de novo.
 */
export function areasDesatualizadas(
  areas: readonly { id: string; geometria: unknown }[],
  resumoPorArea: ReadonlyMap<string, { ultima_observacao: { do_poligono_atual: boolean } | null }>
): string[] {
  return areas
    .filter((a) => {
      if (!a.geometria) return false;
      const obs = resumoPorArea.get(a.id)?.ultima_observacao;
      return !obs || !obs.do_poligono_atual;
    })
    .map((a) => a.id);
}

/** O período da tela antes de virar corpo: campos de data como o usuário os digita ("" = ainda não escolheu). */
export type PeriodoDoFormulario =
  | { tipo: "mais_recente"; janelaDias: number }
  | { tipo: "data"; data: string; toleranciaDias: number }
  | { tipo: "intervalo"; de: string; ate: string; cadencia: "mensal" | "decendial" };

export const PERIODO_PADRAO: PeriodoDoFormulario = { tipo: "mais_recente", janelaDias: JANELA_DIAS_PADRAO };
export const TOLERANCIA_DIAS_PADRAO = 3;
export const TOLERANCIAS_DIAS_OPCOES: readonly number[] = [0, 1, 3, 5, 10, 15, 30];

export const ROTULO_TIPO_PERIODO: Readonly<Record<PeriodoDoFormulario["tipo"], string>> = {
  mais_recente: "Imagem mais recente disponível",
  data: "Uma data",
  intervalo: "Intervalo"
};
export const ROTULO_CADENCIA: Readonly<Record<"mensal" | "decendial", string>> = { mensal: "Mensal", decendial: "Decendial (a cada 10 dias)" };

export type PeriodoValidado = { ok: true; periodo: PeriodoConsulta; slots: number } | { ok: false; motivo: string };

/**
 * Valida o período com a MESMA função do servidor (`slotsDoPeriodo`): data futura, anterior ao acervo, de > ate,
 * janela/tolerância fora da faixa… viram o motivo na tela, nunca um valor corrigido em silêncio. `hoje` = 'YYYY-MM-DD' (UTC).
 */
export function validarPeriodo(p: PeriodoDoFormulario, hoje: string): PeriodoValidado {
  const periodo: PeriodoConsulta =
    p.tipo === "mais_recente" ? { tipo: "mais_recente", janela_dias: p.janelaDias }
    : p.tipo === "data" ? { tipo: "data", data: p.data, tolerancia_dias: p.toleranciaDias }
    : { tipo: "intervalo", de: p.de, ate: p.ate, cadencia: p.cadencia };
  if (p.tipo === "data" && !p.data) return { ok: false, motivo: "Escolha a data." };
  if (p.tipo === "intervalo" && (!p.de || !p.ate)) return { ok: false, motivo: "Escolha a data inicial e a final." };
  try {
    return { ok: true, periodo, slots: slotsDoPeriodo(periodo, hoje).length };
  } catch (e) {
    if (e instanceof ErroPeriodoConsulta) return { ok: false, motivo: e.message };
    throw e;
  }
}

export const LIMITES_PERIODO = { janela: JANELA_CONSULTA_DIAS, tolerancia: TOLERANCIA_CONSULTA_DIAS } as const;

/** Itens = áreas × recortes de tempo (um índice, o bundle). Acima do teto a consulta é recusada, não truncada. */
export function itensDaConsulta(quantidadeAreas: number | null, slots: number): number | null {
  return quantidadeAreas === null ? null : quantidadeAreas * slots;
}

/** Corpo estrito: alvo, período já VALIDADO, bundle de 6 índices e confirmar — nada mais. */
export function montarCorpoConsulta(alvo: AlvoConsulta, periodo: PeriodoConsulta, confirmar: boolean): CorpoConsulta {
  return {
    alvo,
    periodo,
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
