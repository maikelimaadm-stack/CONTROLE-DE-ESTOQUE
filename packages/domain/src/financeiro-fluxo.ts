import { D, DomainError, addDays, addMonths, isISODate, money, type Decimal } from "@agro/shared";

/** Fluxo de caixa (previsto × realizado) e DRE gerencial da Central Financeira (decisão 285). */
export type Agrupamento = "dia" | "semana" | "mes";
const AGRUPAMENTOS: readonly Agrupamento[] = ["dia", "semana", "mes"];

/** Teto de colunas do fluxo: acima disso a consulta e a tela deixam de ser úteis (400 dias ≈ 13 meses por dia). */
const LIMITE_DE_PERIODOS = 400;

/**
 * Início do período que contém a data: o próprio dia; a SEGUNDA-FEIRA da semana ISO (como `date_trunc('week')` do
 * Postgres); o dia 1 do mês. Aceita data ou data-hora (lê os 10 primeiros caracteres).
 */
export function inicioDoPeriodo(data: string, ag: Agrupamento): string {
  const iso = data.slice(0, 10);
  if (!isISODate(iso)) throw new DomainError("VALIDATION_ERROR", "Data inválida", { data });
  switch (ag) {
    case "dia": return iso;
    case "mes": return `${iso.slice(0, 7)}-01`;
    case "semana": {
      const diaDaSemana = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = domingo
      return addDays(iso, -((diaDaSemana + 6) % 7));
    }
    default: throw new DomainError("VALIDATION_ERROR", "Agrupamento desconhecido", { agrupamento: ag });
  }
}

/**
 * Períodos INTEIROS que cobrem [de, ate], alinhados pelo `inicioDoPeriodo` (a 1ª semana pode começar antes de `de`
 * e o último mês terminar depois de `ate`; quem consulta filtra os lançamentos por [de, ate]). Assim cada lançamento
 * cai no período cujo `inicio` é `inicioDoPeriodo(data)`.
 */
export function periodosDoIntervalo(de: string, ate: string, ag: Agrupamento): { inicio: string; fim: string }[] {
  const invalido = () => new DomainError("VALIDATION_ERROR", "Período inválido ou longo demais para o agrupamento escolhido", { de, ate, agrupamento: ag });
  if (!isISODate(de) || !isISODate(ate) || de > ate || !AGRUPAMENTOS.includes(ag)) throw invalido();
  const periodos: { inicio: string; fim: string }[] = [];
  let inicio = inicioDoPeriodo(de, ag);
  while (inicio <= ate) {
    if (periodos.length >= LIMITE_DE_PERIODOS) throw invalido();
    const proximo = ag === "dia" ? addDays(inicio, 1) : ag === "semana" ? addDays(inicio, 7) : addMonths(inicio, 1);
    periodos.push({ inicio, fim: addDays(proximo, -1) });
    inicio = proximo;
  }
  return periodos;
}

/** Grupos da DRE gerencial, na ordem de apresentação. */
export const GRUPOS_DRE = ["receitas", "deducoes", "custos", "despesas", "investimentos"] as const;
export type GrupoDre = (typeof GRUPOS_DRE)[number];
const ehGrupoDre = (v: unknown): v is GrupoDre => typeof v === "string" && (GRUPOS_DRE as readonly string[]).includes(v);

/** Natureza (`erp.financial_categories`) com o que a DRE precisa. `grupoDre` é o marcado no cadastro (pode faltar). */
export interface NaturezaParaDre { id: string; parentId: string | null; codigo: string; nome: string; grupoDre: string | null; nature: "income" | "expense" | "both"; classification: string }

/** Grupo DERIVADO quando nem a natureza nem um ancestral foram marcados; `null` = decide pelo sinal do total. */
function grupoDerivado(n: NaturezaParaDre): GrupoDre | null {
  if (n.nature === "income") return "receitas";
  if (n.nature === "expense") return n.classification === "capex" ? "investimentos" : "despesas";
  return null;
}

/**
 * Grupo da DRE de cada natureza: o PRÓPRIO marcado → o do ancestral marcado mais próximo → o derivado do tipo da
 * natureza (receita → Receitas; despesa de investimento (capex) → Investimentos; despesa → Despesas; ambos → `null`).
 * Um valor de `grupoDre` fora da lista é tratado como não marcado. Ciclo na árvore: a subida para no nó repetido.
 */
export function grupoDreDasNaturezas(naturezas: readonly NaturezaParaDre[]): Map<string, GrupoDre | null> {
  const porId = new Map(naturezas.map((n) => [n.id, n] as const));
  const grupos = new Map<string, GrupoDre | null>();
  for (const n of naturezas) {
    let marcado: GrupoDre | null = null;
    const visitados = new Set<string>();
    let atual: NaturezaParaDre | undefined = n;
    while (atual && !visitados.has(atual.id)) {
      visitados.add(atual.id);
      if (ehGrupoDre(atual.grupoDre)) { marcado = atual.grupoDre; break; }
      atual = atual.parentId === null ? undefined : porId.get(atual.parentId);
    }
    grupos.set(n.id, marcado ?? grupoDerivado(n));
  }
  return grupos;
}

/** Valor com sinal: + receita/entrada, − despesa/saída. */
export interface LinhaDre { naturezaId: string; valor: string }
export interface Dre {
  grupos: { grupo: GrupoDre; total: string; naturezas: { id: string; codigo: string; nome: string; total: string }[] }[];
  receitaLiquida: string;
  resultadoOperacional: string;
  investimentos: string;
  resultadoFinal: string;
}

/** Código hierárquico em ordem natural ("1.2" antes de "1.10"); empate decidido pelo texto. */
function compararCodigo(a: string, b: string): number {
  const pa = a.match(/\d+|\D+/g) ?? [];
  const pb = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i]!;
    const y = pb[i]!;
    if (x === y) continue;
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const nx = x.replace(/^0+/, "");
      const ny = y.replace(/^0+/, "");
      if (nx.length !== ny.length) return nx.length - ny.length;
      if (nx !== ny) return nx < ny ? -1 : 1;
    }
    return x < y ? -1 : 1;
  }
  return pa.length - pb.length;
}

/**
 * DRE gerencial: soma por natureza, natureza no seu grupo (sem grupo: total ≥ 0 → Receitas, < 0 → Despesas), grupos
 * na ordem de `GRUPOS_DRE` (só os que têm linha), naturezas por código. Valores com sinal:
 * receita líquida = receitas + deduções; resultado operacional = receita líquida + custos + despesas;
 * resultado final = resultado operacional + investimentos. Linha de natureza que não veio na lista não some:
 * entra pelo sinal, como "Natureza não encontrada", para os totais continuarem batendo com o caixa.
 */
export function montarDre(linhas: readonly LinhaDre[], naturezas: readonly NaturezaParaDre[]): Dre {
  const grupoDe = grupoDreDasNaturezas(naturezas);
  const porId = new Map(naturezas.map((n) => [n.id, n] as const));
  const somaPorNatureza = new Map<string, Decimal>();
  for (const l of linhas) somaPorNatureza.set(l.naturezaId, (somaPorNatureza.get(l.naturezaId) ?? D(0)).plus(D(l.valor)));

  const porGrupo = new Map<GrupoDre, { id: string; codigo: string; nome: string; total: Decimal }[]>();
  for (const [id, total] of somaPorNatureza) {
    const n = porId.get(id);
    const grupo = (n ? grupoDe.get(id) : null) ?? (total.gte(0) ? "receitas" : "despesas");
    const lista = porGrupo.get(grupo) ?? [];
    lista.push({ id, codigo: n?.codigo ?? "", nome: n?.nome ?? "Natureza não encontrada", total });
    porGrupo.set(grupo, lista);
  }

  const totalDo = new Map<GrupoDre, Decimal>();
  const grupos = GRUPOS_DRE.filter((g) => porGrupo.has(g)).map((grupo) => {
    const lista = porGrupo.get(grupo)!.slice().sort((a, b) => compararCodigo(a.codigo, b.codigo) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const total = lista.reduce((s, n) => s.plus(n.total), D(0));
    totalDo.set(grupo, total);
    return { grupo, total: money(total), naturezas: lista.map((n) => ({ id: n.id, codigo: n.codigo, nome: n.nome, total: money(n.total) })) };
  });
  const t = (g: GrupoDre) => totalDo.get(g) ?? D(0);
  const receitaLiquida = t("receitas").plus(t("deducoes"));
  const resultadoOperacional = receitaLiquida.plus(t("custos")).plus(t("despesas"));
  const resultadoFinal = resultadoOperacional.plus(t("investimentos"));
  return {
    grupos,
    receitaLiquida: money(receitaLiquida),
    resultadoOperacional: money(resultadoOperacional),
    investimentos: money(t("investimentos")),
    resultadoFinal: money(resultadoFinal)
  };
}
