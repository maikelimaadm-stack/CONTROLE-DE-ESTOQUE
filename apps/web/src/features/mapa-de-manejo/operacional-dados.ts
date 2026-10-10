"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { LineString, Point, Polygon } from "geojson";
import type {
  EstacaoDoAno,
  FaixaDoMapa,
  FormaDeObjeto,
  IdentificadorDaArea,
  ModoDeColoracao,
  SituacaoDeLotacao,
  UnidadeDeCapacidade
} from "@agro/domain";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * MAPA-MANEJO-04 (F2) — a ÚNICA fonte de dados da tela do mapa operacional: `GET /api/mapa/operacional`
 * (apps/api/src/routes/mapa-ocupacao.ts). Os tipos abaixo são o contrato da rota, campo a campo; a tela só LÊ.
 * Ícone, centróide, dias, faixa, UA/ha e identificador chegam RESOLVIDOS pelo domínio: nada disso é recalculado aqui.
 */

/** Faixa da área no modo de coloração pedido (`null` em `padrao`). A cor de cada chave é da tela (paleta). */
export type FaixaDto = FaixaDoMapa;

/** Identificador comum dos lotes abertos da área; `{ misto: true }` quando divergem; `null` sem lote identificado. */
export type IdentificadorDto = IdentificadorDaArea;

/**
 * Ícone resolvido da área. O bloco inteiro é `null` sem `icon_config.view`; com ela, `config_id` nulo = nenhuma
 * configuração casou (e `categorias` continua com as categorias presentes, normalizadas e em ordem).
 */
export interface IconeDto {
  config_id: string | null;
  categoria: string | null;
  icone_url: string | null;
  cor_padrao: string | null;
  categorias: string[];
}

/** Lote presente na área (ocupação aberta), com cabeças e UA de agora e os números congelados na entrada. */
export interface LoteNaArea {
  /** id da ocupação aberta */
  id: string;
  lote: { id: string; code: string | null; description: string | null };
  cabecas: number;
  ua: string;
  cabecas_na_entrada: number | null;
  ua_na_entrada: string | null;
  data_inicio: string;
  origem_da_data: string;
  dias_de_ocupacao: number;
}

/** Uma área do escopo, como a rota a devolve. */
export interface AreaOperacional {
  id: string;
  empresa_id: string;
  name: string;
  code: string;
  color: string | null;
  area_ha: string;
  usable_area_ha: string | null;
  land_use: string;
  status: string;
  geometria: Polygon | null;
  retiro_id: string | null;
  grazing_module_id: string | null;
  support_capacity_rainy_ua_ha: string | null;
  support_capacity_dry_ua_ha: string | null;
  max_stocking_ua: string | null;
  ocupada: boolean;
  lotes: LoteNaArea[];
  cabecas_total: number;
  ua_total: string;
  ultima_saida: string | null;
  /** `null` = ocupada ou nunca teve saída ("sem registro" ≠ "0 dias"). */
  dias_de_descanso: number | null;
  ua_por_hectare: string | null;
  capacidade_da_estacao: string | null;
  situacao_de_lotacao: SituacaoDeLotacao | null;
  /** `null` sem `nutritions.view` OU sem registro — `capacidades.manejo` diz qual. */
  ultimo_manejo: string | null;
  /** `null` sem `weighings.view` OU sem registro — `capacidades.pesagem` diz qual. */
  ultima_pesagem: string | null;
  /** Centróide calculado pelo domínio (`centroideDePoligono`); `null` sem geometria válida. */
  centroide: { lon: number; lat: number } | null;
  identificador: IdentificadorDto | null;
  icone: IconeDto | null;
  faixa: FaixaDto | null;
}

/** Objeto de mapa vivo do escopo (só com `map_objects.view`). A API não manda ícone de objeto. */
export interface ObjetoDeMapa {
  id: string;
  empresa_id: string;
  area_id: string | null;
  tipo: string;
  forma: FormaDeObjeto;
  /** `Point` para forma `ponto`; `LineString` para forma `linha`. */
  geometria: Point | LineString;
  code: string | null;
  name: string;
  descricao: string | null;
  capacidade: string | null;
  unidade_capacidade: UnidadeDeCapacidade | null;
  trough_id: string | null;
  is_active: boolean;
}

/** Quais blocos opcionais vieram: `null` sem capacidade é diferente de `null` sem registro. */
export interface CapacidadesDoMapa {
  objetos: boolean;
  manejo: boolean;
  pesagem: boolean;
  icones: boolean;
}

/** Resposta inteira de `GET /api/mapa/operacional`. */
export interface RespostaOperacional {
  hoje: string;
  estacao: EstacaoDoAno;
  coloracao: ModoDeColoracao;
  capacidades: CapacidadesDoMapa;
  areas: AreaOperacional[];
  objetos: ObjetoDeMapa[];
}

/** Filtros que a tela passa à rota (a rota aceita só estes e recusa o resto com 422). */
export interface FiltrosDoMapa {
  coloracao: ModoDeColoracao;
  retiro_id: string | null;
  grazing_module_id: string | null;
}

/** Caminho da rota com os filtros (nulos ficam fora da query). */
export const caminhoOperacional = (f: FiltrosDoMapa) =>
  `/api/mapa/operacional${qs({ coloracao: f.coloracao, retiro_id: f.retiro_id, grazing_module_id: f.grazing_module_id })}`;

/**
 * UMA chamada por combinação de filtros — nada por área. Na troca de filtro a resposta anterior continua na tela
 * (`keepPreviousData`) até a nova chegar: o mapa não pisca nem volta ao estado de carregando.
 */
export function useMapaOperacional(filtros: FiltrosDoMapa) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["mapa", "operacional", session?.empresaId ?? null, filtros],
    queryFn: ({ signal }) => api<RespostaOperacional>(caminhoOperacional(filtros), { signal }),
    placeholderData: keepPreviousData
  });
}
