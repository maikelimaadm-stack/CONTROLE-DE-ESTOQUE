/**
 * Data ativa da camada do Mapa geral — regra pura (sem React e sem `@/`, para ser testada).
 *
 * `ultima`: a API devolve o raster da última análise útil do contorno atual de cada área.
 * `data`: a API devolve só o raster daquele dia (UTC). Sem raster naquele dia a área fica SEM imagem: a tela nunca
 * troca em silêncio por outra data.
 */
import type { ItemHistoricoIndice } from "./condicao-modelo";

export type DataDaCamada = { tipo: "ultima" } | { tipo: "data"; data: string };

export const DATA_ULTIMA_IMAGEM: DataDaCamada = { tipo: "ultima" };

const FORMA_DIA = /^\d{4}-\d{2}-\d{2}$/;

export const ehDiaIso = (v: string): boolean => {
  if (!FORMA_DIA.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export function dataEscolhida(data: string): DataDaCamada {
  if (!ehDiaIso(data)) throw new RangeError(`data da camada inválida: ${data}`);
  return { tipo: "data", data };
}

/** Chave estável (string) da data — para dependências de efeito e identidade do cache. */
export const chaveDaData = (d: DataDaCamada): string => (d.tipo === "ultima" ? "ultima" : `data:${d.data}`);

/** Valor do `data_imagem` da listagem de rasters; ausente quando a camada é a última imagem útil. */
export const dataImagemDoPedido = (d: DataDaCamada): string | undefined => (d.tipo === "data" ? d.data : undefined);

/** Valor do seletor da tela ↔ estado. */
export const valorDoSeletorDeData = (d: DataDaCamada): string => (d.tipo === "ultima" ? "ultima" : d.data);
export function dataDoSeletor(valor: string): DataDaCamada {
  return valor === "ultima" || !ehDiaIso(valor) ? DATA_ULTIMA_IMAGEM : { tipo: "data", data: valor };
}

/** Dia UTC (YYYY-MM-DD) de uma observação — o mesmo critério da API para `data_imagem` do raster. */
export const diaDaObservacao = (observacaoInicio: string | null | undefined): string | null => {
  if (!observacaoInicio) return null;
  const dia = observacaoInicio.slice(0, 10);
  return ehDiaIso(dia) ? dia : null;
};

/** Item do histórico com observação útil: concluído, com data e com média. */
export const itemUtil = (i: Pick<ItemHistoricoIndice, "situacao" | "observacao_inicio" | "valor_medio">): boolean =>
  i.situacao === "concluida" && diaDaObservacao(i.observacao_inicio) !== null && i.valor_medio !== null && Number.isFinite(Number(i.valor_medio));

/** Datas úteis (dias distintos), da mais recente à mais antiga. */
export function datasUteisDoHistorico(itens: readonly ItemHistoricoIndice[]): string[] {
  const dias = new Set<string>();
  for (const i of itens) {
    if (!itemUtil(i)) continue;
    dias.add(diaDaObservacao(i.observacao_inicio)!);
  }
  return [...dias].sort((a, b) => b.localeCompare(a));
}

/** A análise concluída mais recente (por criação) cuja observação cai no dia — para gerar a imagem daquela data. */
export function analiseIdDaData(itens: readonly ItemHistoricoIndice[], dia: string): string | null {
  let melhor: ItemHistoricoIndice | null = null;
  for (const i of itens) {
    if (!itemUtil(i) || diaDaObservacao(i.observacao_inicio) !== dia) continue;
    if (!melhor || melhor.criado_em < i.criado_em) melhor = i;
  }
  return melhor?.id ?? null;
}

export interface OpcaoDeData { valor: string; rotulo: string }

/**
 * Opções do seletor DATA: "Última imagem útil" + as datas úteis da área aberta para o índice ativo. A data JÁ escolhida
 * permanece na lista mesmo que a área aberta mude — o seletor nunca mostra um valor que o estado não tem.
 */
export function opcoesDeData(datasUteis: readonly string[], atual: DataDaCamada, formatar: (dia: string) => string): OpcaoDeData[] {
  const dias = new Set(datasUteis);
  if (atual.tipo === "data") dias.add(atual.data);
  return [
    { valor: "ultima", rotulo: "Última imagem útil" },
    ...[...dias].sort((a, b) => b.localeCompare(a)).map((d) => ({ valor: d, rotulo: formatar(d) }))
  ];
}
