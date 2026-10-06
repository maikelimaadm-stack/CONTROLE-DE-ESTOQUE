/**
 * Histórico por período — regras puras (sem React e sem `@/`, para serem testadas).
 *
 * A API devolve o histórico do contorno ATUAL, do mais recente ao mais antigo, paginado por `antes` (instante de criação
 * da análise; a página seguinte pede `antes = criado_em` da mais antiga recebida). O período é filtrado AQUI, pela data
 * da observação, e a tela pagina até cobrir o início do período ou esgotar o histórico — sem passar de um teto de páginas.
 * Análise de contorno antigo nunca entra: a API já filtra, e esta carga ainda confere o hash entre as páginas.
 */
import type { HistoricoIndice, ItemHistoricoIndice } from "./condicao-modelo";
import { diaDaObservacao, ehDiaIso } from "./data-camada";

export type PeriodoHistorico = "30d" | "60d" | "90d" | "6m" | "1a" | "personalizado";

export const PERIODOS_HISTORICO: readonly { valor: PeriodoHistorico; rotulo: string }[] = [
  { valor: "30d", rotulo: "30 dias" },
  { valor: "60d", rotulo: "60 dias" },
  { valor: "90d", rotulo: "90 dias" },
  { valor: "6m", rotulo: "6 meses" },
  { valor: "1a", rotulo: "1 ano" },
  { valor: "personalizado", rotulo: "Personalizado" }
];

export const PERIODO_HISTORICO_PADRAO: PeriodoHistorico = "1a";
/** Observações por página pedida (o máximo da rota). */
export const LIMITE_PAGINA_HISTORICO = 100;
/** Teto de páginas por carga: evita paginar sem fim um histórico enorme. */
export const MAX_PAGINAS_HISTORICO = 12;

export interface JanelaHistorico { inicio: string; fim: string }
export type JanelaOuErro = { ok: true; janela: JanelaHistorico } | { ok: false; motivo: string };

function somarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function subtrairMeses(dia: string, meses: number): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  const diaDoMes = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - meses);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(diaDoMes, ultimo));
  return d.toISOString().slice(0, 10);
}

/** A janela [início, fim] (dias UTC, inclusiva) do período. `hoje` = 'YYYY-MM-DD'. */
export function janelaDoPeriodo(periodo: PeriodoHistorico, hoje: string, personalizado?: { de: string; ate: string }): JanelaOuErro {
  switch (periodo) {
    case "30d": return { ok: true, janela: { inicio: somarDias(hoje, -30), fim: hoje } };
    case "60d": return { ok: true, janela: { inicio: somarDias(hoje, -60), fim: hoje } };
    case "90d": return { ok: true, janela: { inicio: somarDias(hoje, -90), fim: hoje } };
    case "6m": return { ok: true, janela: { inicio: subtrairMeses(hoje, 6), fim: hoje } };
    case "1a": return { ok: true, janela: { inicio: subtrairMeses(hoje, 12), fim: hoje } };
    case "personalizado": {
      const de = personalizado?.de ?? "";
      const ate = personalizado?.ate ?? "";
      if (!ehDiaIso(de) || !ehDiaIso(ate)) return { ok: false, motivo: "Informe a data inicial e a final." };
      if (de > ate) return { ok: false, motivo: "A data inicial não pode ser posterior à final." };
      return { ok: true, janela: { inicio: de, fim: ate } };
    }
  }
}

/** Itens cuja OBSERVAÇÃO cai na janela (dia UTC). Sem data de observação não há como situar no tempo: fica de fora. */
export function filtrarPorJanela(itens: readonly ItemHistoricoIndice[], janela: JanelaHistorico): ItemHistoricoIndice[] {
  return itens.filter((i) => {
    const dia = diaDaObservacao(i.observacao_inicio);
    return dia !== null && dia >= janela.inicio && dia <= janela.fim;
  });
}

export class ContornoMudouNaCarga extends Error {
  constructor() {
    super("O contorno da área mudou durante a leitura do histórico. Abra o histórico de novo.");
    this.name = "ContornoMudouNaCarga";
  }
}

export interface CargaHistorico {
  itens: ItemHistoricoIndice[];
  geometriaSha256: string | null;
  paginas: number;
  /** A última página lida só tem observações anteriores ao início do período. */
  coberto: boolean;
  /** O histórico acabou (a API devolveu menos que o limite pedido). */
  exaurido: boolean;
  /** Parou no teto de páginas sem cobrir o período nem esgotar o histórico. */
  truncado: boolean;
}

export type BuscarPaginaHistorico = (antes: string | undefined, limite: number) => Promise<HistoricoIndice>;

/**
 * Pagina por `antes` até COBRIR o início da janela ou ESGOTAR o histórico. O cursor é o `criado_em` da análise mais
 * antiga de cada página (a ordem da API é por criação). Duplicata por id é descartada; página sem avanço encerra a carga.
 * Item de hash diferente do hash da resposta (contorno antigo) é descartado e nunca atravessa a tela.
 */
export async function carregarHistoricoAteCobrir(
  buscar: BuscarPaginaHistorico,
  janela: JanelaHistorico,
  opcoes: { limite?: number; maxPaginas?: number } = {}
): Promise<CargaHistorico> {
  const limite = opcoes.limite ?? LIMITE_PAGINA_HISTORICO;
  const maxPaginas = opcoes.maxPaginas ?? MAX_PAGINAS_HISTORICO;
  const vistos = new Set<string>();
  const itens: ItemHistoricoIndice[] = [];
  let hash: string | null | undefined;
  let antes: string | undefined;
  let paginas = 0;
  let coberto = false;
  let exaurido = false;

  while (paginas < maxPaginas) {
    const r = await buscar(antes, limite);
    paginas += 1;
    if (hash === undefined) hash = r.geometria_sha256;
    else if (r.geometria_sha256 !== hash) throw new ContornoMudouNaCarga();

    const daPagina = r.itens.filter((i) => hash === null || i.geometria_sha256 === hash);
    for (const i of daPagina) {
      if (vistos.has(i.id)) continue;
      vistos.add(i.id);
      itens.push(i);
    }
    if (r.itens.length < limite) { exaurido = true; break; }

    const maisAntigo = r.itens.reduce<string | null>((m, i) => (m === null || i.criado_em < m ? i.criado_em : m), null);
    if (maisAntigo === null || (antes !== undefined && maisAntigo >= antes)) { exaurido = true; break; }

    const dias = r.itens.map((i) => diaDaObservacao(i.observacao_inicio)).filter((d): d is string => d !== null);
    if (dias.length > 0 && dias.every((d) => d < janela.inicio)) { coberto = true; break; }
    antes = maisAntigo;
  }

  return {
    itens,
    geometriaSha256: hash ?? null,
    paginas,
    coberto,
    exaurido,
    truncado: !coberto && !exaurido
  };
}
