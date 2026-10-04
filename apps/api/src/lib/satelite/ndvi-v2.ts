/**
 * MÉTODO NDVI DA CONSULTA EM LOTE (versão `VERSAO_METODO_NDVI_V2`) — SAT-03, decisão 296.
 *
 * O MESMO evalscript, a MESMA máscara e o MESMO critério de observação útil da v1 (`ndvi.ts`, SAT-01): o que muda é a
 * JANELA (a do item da fila, não "os últimos 30 dias") e a ESCOLHA quando o item tem data alvo. Puro: sem rede, sem
 * banco, sem relógio.
 *
 *  1. `janelaDoItem`: o item guarda a janela em DIAS INCLUSIVOS ('YYYY-MM-DD' nas duas pontas, `erp.satelite_consulta_itens`);
 *     a análise e o provedor usam INSTANTES com FIM EXCLUSIVO (`erp.analises_satelitais.janela_fim`, `timeRange.to`). A
 *     conversão é uma só: início = meia-noite UTC do primeiro dia; fim = meia-noite UTC do dia SEGUINTE ao último.
 *     Usar o fim do item direto perderia o último dia inteiro (e a data alvo, quando ela cai nele).
 *  2. `escolherObservacaoV2`: sem data alvo, a útil MAIS RECENTE — é a v1, chamada como está. Com data alvo, a útil
 *     MAIS PERTO do dia alvo (empate: a mais recente). Um dia com ERRO do provedor que poderia ganhar da escolha (mais
 *     perto, ou tão perto e mais recente; ou qualquer erro quando nada serviu) torna a escolha inafirmável:
 *     `processamento_parcial`, nada é gravado e o item pode ser repetido — a regra da v1, medida pela distância.
 *  3. `EVALSCRIPT_NDVI_SHA256` (gravado na análise: prova QUAL evalscript gerou o número) e `RESOLUCAO_NATIVA_NDVI_M`.
 */
import { createHash } from "node:crypto";
import { CRITERIO_OBSERVACAO_UTIL } from "@agro/domain";
import { FalhaCopernicus } from "./copernicus.js";
import {
  EVALSCRIPT_NDVI, escolherObservacao, type EstatisticaLida, type IntervaloEstatistico, type Janela, type MetadadosAnalise, type ResultadoNdvi
} from "./ndvi.js";

const DIA_MS = 86_400_000;
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** sha256 (hex) do evalscript enviado ao provedor — o da v1, byte a byte. */
export const EVALSCRIPT_NDVI_SHA256 = createHash("sha256").update(EVALSCRIPT_NDVI, "utf8").digest("hex");

/** Resolução nativa das bandas B04/B08 da Sentinel-2 L2A, em metros. */
export const RESOLUCAO_NATIVA_NDVI_M = 10;

/** Meia-noite UTC do dia 'YYYY-MM-DD'. Dia que não existe no calendário (2026-02-30) é defeito de quem chama: lança. */
function meiaNoiteUtc(dia: string): number {
  const ms = DIA_ISO.test(dia) ? Date.parse(`${dia}T00:00:00Z`) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== dia) throw new RangeError("dia fora do formato AAAA-MM-DD");
  return ms;
}

/** Janela INCLUSIVA do item (dias) → janela da análise e do provedor (instantes, fim EXCLUSIVO). */
export function janelaDoItem(item: { janela_inicio: string; janela_fim: string }): Janela {
  const inicio = meiaNoiteUtc(item.janela_inicio);
  const fim = meiaNoiteUtc(item.janela_fim) + DIA_MS;
  if (!(fim > inicio)) throw new RangeError("janela do item com fim antes do início");
  return { inicio: new Date(inicio), fim: new Date(fim) };
}

/** Cobertura em décimos de milésimo, inteira e arredondada para baixo — a conta da v1. */
function coberturaDezMil(validos: number, pixelsGeometria: number): number {
  if (pixelsGeometria <= 0) return 0;
  return Math.min(10_000, Math.floor((validos * 10_000) / pixelsGeometria));
}

/** O critério útil da v1 (`CRITERIO_OBSERVACAO_UTIL`), sobre um intervalo. */
function util(i: IntervaloEstatistico, pixelsGeometria: number): boolean {
  return i.validos >= CRITERIO_OBSERVACAO_UTIL.pixelsValidosMinimos
    && coberturaDezMil(i.validos, pixelsGeometria) >= Math.round(CRITERIO_OBSERVACAO_UTIL.coberturaMinima * 10_000);
}

/** Os metadados da resposta INTEIRA, com as regras da v1 (lista branca: só contagens e rótulos fixos). */
function metadadosDe(lida: EstatisticaLida, pixelsGeometria: number): MetadadosAnalise {
  const maior = lida.intervalos.reduce<number | null>((m, i) => Math.max(m ?? 0, coberturaDezMil(i.validos, pixelsGeometria)), null);
  return {
    intervalos_recebidos: lida.intervalos.length + lida.errosEm.length,
    intervalos_com_erro: lida.errosEm.length,
    intervalos_com_dado: lida.intervalos.filter((i) => i.validos > 0).length,
    intervalos_uteis: lida.intervalos.filter((i) => util(i, pixelsGeometria)).length,
    maior_cobertura: maior === null ? null : (maior / 10_000).toFixed(4),
    fonte_pixels_geometria: "grade_crs84",
    status_provedor: lida.statusProvedor
  };
}

export function escolherObservacaoV2(lida: EstatisticaLida, pixelsGeometria: number, dataAlvo: string | null): ResultadoNdvi {
  if (dataAlvo === null) return escolherObservacao(lida, pixelsGeometria);
  const alvo = meiaNoiteUtc(dataAlvo);
  const distancia = (inicio: Date) => Math.abs(inicio.getTime() - alvo);
  const escolhida = lida.intervalos.filter((i) => util(i, pixelsGeometria))
    .sort((a, b) => distancia(a.inicio) - distancia(b.inicio) || b.inicio.getTime() - a.inicio.getTime())[0];
  const erroDecisivo = lida.errosEm.some((em) => em === null || !escolhida
    || distancia(em) < distancia(escolhida.inicio)
    || (distancia(em) === distancia(escolhida.inicio) && em.getTime() >= escolhida.inicio.getTime()));
  if (erroDecisivo) throw new FalhaCopernicus("processamento_parcial", 200);
  // Sem útil (e, por isso, sem erro nenhum): a v1 diz a falta — motivo e metadados.
  if (!escolhida) return escolherObservacao(lida, pixelsGeometria);
  // Com a escolha, quem mede, formata e confere os valores é a v1, sobre a escolhida e os dias NÃO úteis (a útil mais
  // recente desse conjunto é ela). Os metadados descrevem a resposta inteira, não o recorte.
  const recorte = { intervalos: lida.intervalos.filter((i) => i === escolhida || !util(i, pixelsGeometria)), errosEm: [], statusProvedor: lida.statusProvedor };
  return { ...escolherObservacao(recorte, pixelsGeometria), metadados: metadadosDe(lida, pixelsGeometria) };
}
