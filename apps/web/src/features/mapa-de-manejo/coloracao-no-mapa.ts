/**
 * MAPA-MANEJO-04 (F2) — a coloração das áreas a partir da FAIXA que a API mandou.
 *
 * Entra a resposta de `GET /api/mapa/operacional` (a faixa de cada área já resolvida pelo domínio) e o filtro de faixa
 * escolhido na legenda; sai o que o mapa precisa para pintar: cor e opacidade por área (para `desenharAreas`), a linha
 * a mais do rótulo da área e as faixas presentes (para a legenda). Nenhuma conta de negócio: a chave vira cor pela
 * paleta (`paleta-do-mapa.ts`), e a linha é o rótulo da faixa com o número que a API mandou, só formatado em pt-BR.
 */
import {
  FAIXA_SEM_REBANHO,
  FAIXAS_DE_LOTACAO_UA_HA,
  SITUACOES_DO_PASTO,
  TIPOS_DE_USO_DA_AREA,
  type ModoDeColoracao
} from "@agro/domain";
import { num } from "@/lib/utils";
import type { RotuloArea } from "./camada-desenho";
import type { AreaOperacional, FaixaDto, RespostaOperacional } from "./operacional-dados";
import { categoriasOrdenadas, corDaFaixa } from "./paleta-do-mapa";

/**
 * Opacidade do preenchimento com um filtro de faixa: a faixa escolhida plena, as outras atenuadas — o mesmo par da
 * legenda do mapa geral (`camada-zonas-condicao.ts`). Sem filtro, nada é enviado e vale a opacidade normal do
 * preenchimento das áreas (`mapa-base.tsx`).
 */
export const OPACIDADE_FAIXA_ESCOLHIDA = 0.95;
export const OPACIDADE_FAIXA_ATENUADA = 0.12;

/** Uma faixa que aparece no mapa agora, como a legenda a mostra. */
export interface FaixaPresente {
  chave: string;
  /** O texto que a API mandou para a faixa (fonte única: `labels.ts` ou o catálogo do dono). */
  rotulo: string;
  cor: string;
  /** Quantas áreas DESENHADAS (com contorno) estão nesta faixa. */
  quantidade: number;
}

export interface ColoracaoDasAreas {
  /** Cor exibida por área (vazio em `padrao`: vale a cor do cadastro). */
  corPorArea: Map<string, string>;
  /** Opacidade por área — só com filtro de faixa aplicado. */
  opacidadePorArea: Map<string, number>;
  /** Linha a mais do rótulo da área (rótulo da faixa e, quando há, o número) — em todo modo menos `padrao`. */
  linhaPorArea: Map<string, string>;
  /** Faixas presentes, na ordem do catálogo do domínio (categoria: ordem de código, `sem_rebanho` por último). */
  faixasPresentes: FaixaPresente[];
  /** O filtro que valeu: o pedido, se alguma área desenhada está nessa faixa; senão `null` (filtro órfão não apaga o mapa). */
  filtroAplicado: string | null;
}

const vazia = (): ColoracaoDasAreas => ({
  corPorArea: new Map(),
  opacidadePorArea: new Map(),
  linhaPorArea: new Map(),
  faixasPresentes: [],
  filtroAplicado: null
});

/** Só a área com contorno vai para o mapa (o mesmo critério de `desenharAreas`). */
const desenhada = (a: AreaOperacional) => a.geometria?.type === "Polygon";

/** Ordem de exibição das faixas de cada modo: a do catálogo do domínio. */
function ordemDoModo(modo: ModoDeColoracao, chaves: readonly string[]): readonly string[] {
  switch (modo) {
    case "lotacao_ua_ha": return FAIXAS_DE_LOTACAO_UA_HA;
    case "situacao_pasto": return SITUACOES_DO_PASTO;
    case "uso_da_area": return TIPOS_DE_USO_DA_AREA.map(([valor]) => valor);
    case "categoria": return [...categoriasOrdenadas(chaves), FAIXA_SEM_REBANHO];
    default: return [];
  }
}

/** Separador entre o rótulo da faixa e o número dela na linha do rótulo da área. */
export const SEPARADOR_DA_LINHA = " · ";

/**
 * O número da faixa como a API mandou, só formatado em pt-BR: `ua_ha` → "1,45 UA/ha" (lotação); `dias` → "21d"
 * (situação do pasto; 0 é "0d"). Categoria não repete o número: as cabeças já estão na linha amarela do rótulo.
 */
function numeroDaFaixa(modo: ModoDeColoracao, faixa: FaixaDto): string | null {
  if (faixa.numero === null || faixa.unidade === null) return null;
  if (modo === "lotacao_ua_ha" && faixa.unidade === "ua_ha") return `${num(faixa.numero, 2)} UA/ha`;
  if (modo === "situacao_pasto" && faixa.unidade === "dias") return `${num(faixa.numero, 0)}d`;
  return null;
}

/**
 * O texto da linha a mais do rótulo da área em TODO modo diferente de `padrao` — cor nunca carrega significado
 * sozinha: sempre o rótulo que a API mandou (`faixa.rotulo`, dono único do texto) e, quando há número, o número que
 * veio — "Lotação ideal · 1,45 UA/ha", "Em descanso · 21d", "Ocupação normal · 12d", "Pastagem", "Boi". Sem número,
 * só o rótulo: "Sem registro de ocupação" nunca vira "0d", e "0d" nunca vira "sem registro".
 */
export function linhaDaFaixa(modo: ModoDeColoracao, faixa: FaixaDto | null): string | null {
  if (!faixa || modo === "padrao") return null;
  const numero = numeroDaFaixa(modo, faixa);
  return numero === null ? faixa.rotulo : `${faixa.rotulo}${SEPARADOR_DA_LINHA}${numero}`;
}

/**
 * Cor, opacidade, linha do rótulo e faixas presentes das áreas desenhadas, no modo da resposta. Em `padrao` (ou sem
 * resposta) tudo vem vazio: o mapa fica com a cor do cadastro. `faixaFiltro` destaca uma faixa e atenua as outras;
 * um filtro sem nenhuma área desenhada naquela faixa é ignorado.
 */
export function coloracaoDasAreas(resposta: RespostaOperacional | null, faixaFiltro: string | null): ColoracaoDasAreas {
  if (!resposta || resposta.coloracao === "padrao") return vazia();
  const modo = resposta.coloracao;
  const areas = resposta.areas.filter(desenhada);

  const porChave = new Map<string, { rotulo: string; quantidade: number }>();
  for (const a of areas) {
    if (!a.faixa) continue;
    const atual = porChave.get(a.faixa.chave);
    if (!atual) porChave.set(a.faixa.chave, { rotulo: a.faixa.rotulo, quantidade: 1 });
    else {
      atual.quantidade += 1;
      if (a.faixa.rotulo < atual.rotulo) atual.rotulo = a.faixa.rotulo;
    }
  }
  const chaves = [...porChave.keys()];
  const filtro = faixaFiltro !== null && porChave.has(faixaFiltro) ? faixaFiltro : null;

  const r = vazia();
  r.filtroAplicado = filtro;
  for (const a of areas) {
    if (a.faixa) {
      r.corPorArea.set(a.id, corDaFaixa(modo, a.faixa.chave, chaves));
      const linha = linhaDaFaixa(modo, a.faixa);
      if (linha !== null) r.linhaPorArea.set(a.id, linha);
    }
    if (filtro !== null) {
      r.opacidadePorArea.set(a.id, a.faixa?.chave === filtro ? OPACIDADE_FAIXA_ESCOLHIDA : OPACIDADE_FAIXA_ATENUADA);
    }
  }

  const ordem = ordemDoModo(modo, chaves);
  const posicao = (c: string) => {
    const i = ordem.indexOf(c);
    return i < 0 ? ordem.length : i;
  };
  r.faixasPresentes = chaves
    .sort((x, y) => posicao(x) - posicao(y) || (x < y ? -1 : x > y ? 1 : 0))
    .map((chave) => {
      const f = porChave.get(chave)!;
      return { chave, rotulo: f.rotulo, cor: corDaFaixa(modo, chave, chaves), quantidade: f.quantidade };
    });
  return r;
}

/**
 * Junta a linha a mais aos rótulos que `rotulosDasAreas` (mapa-base) calculou. Sem linha nenhuma, devolve os mesmos
 * rótulos — quem não colore o mapa não vê diferença.
 */
export function comLinhaExtra(rotulos: RotuloArea[], linhaPorArea: ReadonlyMap<string, string>): RotuloArea[] {
  if (linhaPorArea.size === 0) return rotulos;
  return rotulos.map((rotulo) => {
    const linha = linhaPorArea.get(rotulo.id);
    return linha === undefined ? rotulo : { ...rotulo, linhaExtra: linha };
  });
}
