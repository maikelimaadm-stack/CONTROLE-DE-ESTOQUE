import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Polygon } from "geojson";
import { describe, expect, it, vi } from "vitest";
import {
  FAIXA_SEM_REBANHO,
  FAIXAS_DE_LOTACAO_UA_HA,
  SITUACOES_DO_PASTO,
  TIPOS_DE_USO_DA_AREA,
  type ModoDeColoracao
} from "@agro/domain";
import {
  COR_SEM_FAIXA,
  COR_SEM_REBANHO,
  CORES_DE_CATEGORIA,
  PALETA_LOTACAO_UA_HA,
  PALETA_SITUACAO_DO_PASTO,
  PALETA_USO_DA_AREA,
  corDaFaixa
} from "./paleta-do-mapa";
import {
  OPACIDADE_FAIXA_ATENUADA,
  OPACIDADE_FAIXA_ESCOLHIDA,
  coloracaoDasAreas,
  comLinhaExtra,
  linhaDaFaixa
} from "./coloracao-no-mapa";
import type { AreaOperacional, FaixaDto, RespostaOperacional } from "./operacional-dados";

// O vitest do web não resolve o atalho `@/` (vitest.config.mts sem alias): aponta para o módulo REAL, sem dublê.
vi.mock("@/lib/utils", () => import("../../lib/utils"));

/**
 * MAPA-MANEJO-04 — a paleta (o único lugar onde a tela decide: chave → cor) e a coloração das áreas a partir da faixa
 * que a API mandou. Nenhuma conta de negócio: a tela pinta e escreve o número que veio.
 */

const HEX = /^#[0-9a-f]{6}$/;

/** Distância de cor CIE76 em Lab (só para o teste provar que faixas vizinhas não se confundem). */
function lab(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const distancia = (a: string, b: string) => {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};
/** Limiar de "cores distintas" entre faixas vizinhas (CIE76). */
const CONTRASTE_MINIMO = 20;

const chavesDeUso = TIPOS_DE_USO_DA_AREA.map(([valor]) => valor);

describe("MM4 paleta — toda chave do domínio tem cor", () => {
  it("lotação: cada faixa de FAIXAS_DE_LOTACAO_UA_HA tem um hex próprio", () => {
    const cores = FAIXAS_DE_LOTACAO_UA_HA.map((c) => corDaFaixa("lotacao_ua_ha", c));
    for (const [i, c] of FAIXAS_DE_LOTACAO_UA_HA.entries()) {
      expect(cores[i], c).toMatch(HEX);
      expect(cores[i]).toBe(PALETA_LOTACAO_UA_HA[c]);
    }
    expect(new Set(cores).size).toBe(FAIXAS_DE_LOTACAO_UA_HA.length);
    expect(Object.keys(PALETA_LOTACAO_UA_HA).sort()).toEqual([...FAIXAS_DE_LOTACAO_UA_HA].sort());
  });

  it("situação do pasto: cada chave de SITUACOES_DO_PASTO tem um hex próprio", () => {
    const cores = SITUACOES_DO_PASTO.map((c) => corDaFaixa("situacao_pasto", c));
    for (const [i, c] of SITUACOES_DO_PASTO.entries()) {
      expect(cores[i], c).toMatch(HEX);
      expect(cores[i]).toBe(PALETA_SITUACAO_DO_PASTO[c]);
    }
    expect(new Set(cores).size).toBe(SITUACOES_DO_PASTO.length);
    expect(Object.keys(PALETA_SITUACAO_DO_PASTO).sort()).toEqual([...SITUACOES_DO_PASTO].sort());
  });

  it("uso da área: cada valor de TIPOS_DE_USO_DA_AREA tem um hex próprio (e nenhuma chave sobra na paleta)", () => {
    expect(chavesDeUso.length).toBeGreaterThan(0);
    const cores = chavesDeUso.map((c) => corDaFaixa("uso_da_area", c));
    for (const [i, c] of chavesDeUso.entries()) {
      expect(PALETA_USO_DA_AREA[c], c).toMatch(HEX);
      expect(cores[i]).toBe(PALETA_USO_DA_AREA[c]);
    }
    expect(new Set(cores).size).toBe(chavesDeUso.length);
    expect(Object.keys(PALETA_USO_DA_AREA).sort()).toEqual([...chavesDeUso].sort());
  });

  it("faixas vizinhas têm cores distintas (lotação, situação, uso e a lista de categorias)", () => {
    const listas: [string, string[]][] = [
      ["lotacao_ua_ha", FAIXAS_DE_LOTACAO_UA_HA.map((c) => corDaFaixa("lotacao_ua_ha", c))],
      ["situacao_pasto", SITUACOES_DO_PASTO.map((c) => corDaFaixa("situacao_pasto", c))],
      ["uso_da_area", chavesDeUso.map((c) => corDaFaixa("uso_da_area", c))],
      ["categoria", [...CORES_DE_CATEGORIA, CORES_DE_CATEGORIA[0]!]]
    ];
    for (const [modo, cores] of listas) {
      for (let i = 1; i < cores.length; i++) {
        expect(distancia(cores[i - 1]!, cores[i]!), `${modo}: ${cores[i - 1]} × ${cores[i]}`).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
      }
    }
  });

  it("chave fora do catálogo e o modo padrão caem na cor neutra — nunca na de uma faixa vizinha", () => {
    expect(corDaFaixa("lotacao_ua_ha", "inventada")).toBe(COR_SEM_FAIXA);
    expect(corDaFaixa("situacao_pasto", "inventada")).toBe(COR_SEM_FAIXA);
    expect(corDaFaixa("uso_da_area", "inventada")).toBe(COR_SEM_FAIXA);
    expect(corDaFaixa("padrao", "ideal")).toBe(COR_SEM_FAIXA);
    expect(corDaFaixa("desconhecido" as ModoDeColoracao, "ideal")).toBe(COR_SEM_FAIXA);
  });
});

describe("MM4 paleta — categoria: cor por ordem estável", () => {
  it("a cor depende só do CONJUNTO de chaves presentes, não da ordem em que chegaram nem de repetição", () => {
    const a = corDaFaixa("categoria", "VACA", ["VACA", "BOI", "NOVILHA"]);
    const b = corDaFaixa("categoria", "VACA", ["NOVILHA", "BOI", "VACA", "VACA"]);
    expect(a).toBe(b);
    // ordem de código: BOI (0) · NOVILHA (1) · VACA (2)
    expect(corDaFaixa("categoria", "BOI", ["VACA", "NOVILHA", "BOI"])).toBe(CORES_DE_CATEGORIA[0]);
    expect(corDaFaixa("categoria", "NOVILHA", ["VACA", "NOVILHA", "BOI"])).toBe(CORES_DE_CATEGORIA[1]);
    expect(a).toBe(CORES_DE_CATEGORIA[2]);
  });

  it("chaves diferentes ganham cores diferentes (até o tamanho da lista); sem_rebanho é neutro e não ocupa posição", () => {
    const chaves = CORES_DE_CATEGORIA.map((_, i) => `CAT${String(i).padStart(2, "0")}`);
    const cores = chaves.map((c) => corDaFaixa("categoria", c, [...chaves, FAIXA_SEM_REBANHO]));
    expect(new Set(cores).size).toBe(CORES_DE_CATEGORIA.length);
    for (const c of cores) expect(c).toMatch(HEX);
    expect(corDaFaixa("categoria", FAIXA_SEM_REBANHO, chaves)).toBe(COR_SEM_REBANHO);
    expect(CORES_DE_CATEGORIA).not.toContain(COR_SEM_REBANHO);
    // sem_rebanho na lista não desloca as outras
    expect(corDaFaixa("categoria", "CAT00", ["CAT00", FAIXA_SEM_REBANHO])).toBe(CORES_DE_CATEGORIA[0]);
  });

  it("sem a lista de presentes, a chave conta como a única (primeira cor)", () => {
    expect(corDaFaixa("categoria", "BOI")).toBe(CORES_DE_CATEGORIA[0]);
  });
});

// ------------------------------------------------------------------------------------------------
// coloracaoDasAreas — com uma resposta falsa da API
// ------------------------------------------------------------------------------------------------

const QUADRADO: Polygon = { type: "Polygon", coordinates: [[[-56, -15], [-55.99, -15], [-55.99, -15.01], [-56, -15.01], [-56, -15]]] };

function area(id: string, faixa: FaixaDto | null, geometria: Polygon | null = QUADRADO): AreaOperacional {
  return {
    id, empresa_id: "e1", name: `Pasto ${id}`, code: id, color: "#0d67ad", area_ha: "10.00", usable_area_ha: "9.00",
    land_use: "pastagem", status: "ativa", geometria, retiro_id: null, grazing_module_id: null,
    support_capacity_rainy_ua_ha: null, support_capacity_dry_ua_ha: null, max_stocking_ua: null,
    ocupada: false, lotes: [], cabecas_total: 0, ua_total: "0.00", ultima_saida: null, dias_de_descanso: null,
    ua_por_hectare: null, capacidade_da_estacao: null, situacao_de_lotacao: null, ultimo_manejo: null, ultima_pesagem: null,
    centroide: geometria ? { lon: -55.995, lat: -15.005 } : null, identificador: null, icone: null, faixa
  };
}

function resposta(coloracao: ModoDeColoracao, areas: AreaOperacional[]): RespostaOperacional {
  return {
    hoje: "2026-10-10", estacao: "seca", coloracao,
    capacidades: { objetos: true, manejo: true, pesagem: true, icones: true },
    areas, objetos: []
  };
}

const fx = (chave: string, rotulo: string, numero: FaixaDto["numero"], unidade: FaixaDto["unidade"]): FaixaDto => ({ chave, rotulo, numero, unidade });

describe("MM4 coloração — coloracaoDasAreas", () => {
  it("padrão (e sem resposta): mapas vazios — o mapa fica com a cor do cadastro", () => {
    for (const r of [coloracaoDasAreas(resposta("padrao", [area("a1", null)]), null), coloracaoDasAreas(null, "ideal")]) {
      expect(r.corPorArea.size).toBe(0);
      expect(r.opacidadePorArea.size).toBe(0);
      expect(r.linhaPorArea.size).toBe(0);
      expect(r.faixasPresentes).toEqual([]);
      expect(r.filtroAplicado).toBeNull();
    }
  });

  const lotacao = resposta("lotacao_ua_ha", [
    area("a1", fx("ideal", "Lotação ideal", "1.45", "ua_ha")),
    area("a2", fx("superlotacao", "Superlotação", "2.60", "ua_ha")),
    area("a3", fx("sem_area_util", "Sem área útil cadastrada", null, null)),
    area("a4", fx("ideal", "Lotação ideal", "1.20", "ua_ha")),
    area("a5", fx("sublotacao", "Sublotação", "0.00", "ua_ha")),
    area("sem-contorno", fx("alta", "Lotação alta", "2.00", "ua_ha"), null)
  ]);

  it("lotação: uma cor por área (pela chave), e a linha com o rótulo e o número que a API mandou", () => {
    const r = coloracaoDasAreas(lotacao, null);
    expect(r.corPorArea.get("a1")).toBe(PALETA_LOTACAO_UA_HA.ideal);
    expect(r.corPorArea.get("a2")).toBe(PALETA_LOTACAO_UA_HA.superlotacao);
    expect(r.corPorArea.get("a3")).toBe(PALETA_LOTACAO_UA_HA.sem_area_util);
    expect(r.corPorArea.get("a4")).toBe(PALETA_LOTACAO_UA_HA.ideal);
    expect(r.linhaPorArea.get("a1")).toBe("Lotação ideal · 1,45 UA/ha");
    expect(r.linhaPorArea.get("a2")).toBe("Superlotação · 2,60 UA/ha");
    expect(r.linhaPorArea.get("a4")).toBe("Lotação ideal · 1,20 UA/ha");
    expect(r.linhaPorArea.get("a5")).toBe("Sublotação · 0,00 UA/ha");
    // sem número → só o rótulo da faixa, nunca "0"
    expect(r.linhaPorArea.get("a3")).toBe("Sem área útil cadastrada");
    expect(r.linhaPorArea.get("a3")).not.toMatch(/\d/);
    // área sem contorno: fora do mapa, sem linha
    expect(r.linhaPorArea.has("sem-contorno")).toBe(false);
    // sem filtro: nada de opacidade própria (vale a normal do mapa)
    expect(r.opacidadePorArea.size).toBe(0);
  });

  it("legenda: faixas presentes na ordem do domínio, com rótulo, cor e quantidade de áreas DESENHADAS", () => {
    const r = coloracaoDasAreas(lotacao, null);
    expect(r.faixasPresentes).toEqual([
      { chave: "sublotacao", rotulo: "Sublotação", cor: PALETA_LOTACAO_UA_HA.sublotacao, quantidade: 1 },
      { chave: "ideal", rotulo: "Lotação ideal", cor: PALETA_LOTACAO_UA_HA.ideal, quantidade: 2 },
      { chave: "superlotacao", rotulo: "Superlotação", cor: PALETA_LOTACAO_UA_HA.superlotacao, quantidade: 1 },
      { chave: "sem_area_util", rotulo: "Sem área útil cadastrada", cor: PALETA_LOTACAO_UA_HA.sem_area_util, quantidade: 1 }
    ]);
    // a área sem contorno não está no mapa: nem cor, nem linha, nem contagem
    expect(r.corPorArea.has("sem-contorno")).toBe(false);
    expect(r.faixasPresentes.some((f) => f.chave === "alta")).toBe(false);
  });

  it("filtro de faixa: a escolhida plena, as outras atenuadas; filtro órfão é ignorado", () => {
    const r = coloracaoDasAreas(lotacao, "ideal");
    expect(r.filtroAplicado).toBe("ideal");
    expect(r.opacidadePorArea.get("a1")).toBe(OPACIDADE_FAIXA_ESCOLHIDA);
    expect(r.opacidadePorArea.get("a4")).toBe(OPACIDADE_FAIXA_ESCOLHIDA);
    expect(r.opacidadePorArea.get("a2")).toBe(OPACIDADE_FAIXA_ATENUADA);
    expect(r.opacidadePorArea.get("a3")).toBe(OPACIDADE_FAIXA_ATENUADA);
    expect(r.opacidadePorArea.get("a5")).toBe(OPACIDADE_FAIXA_ATENUADA);
    expect(OPACIDADE_FAIXA_ESCOLHIDA).toBeGreaterThan(OPACIDADE_FAIXA_ATENUADA);
    // a cor não muda com o filtro (só a opacidade)
    expect(r.corPorArea).toEqual(coloracaoDasAreas(lotacao, null).corPorArea);
    // faixa que não está no mapa (ou só numa área sem contorno): sem filtro, nada atenuado
    for (const orfao of ["alta", "inventada"]) {
      const o = coloracaoDasAreas(lotacao, orfao);
      expect(o.filtroAplicado).toBeNull();
      expect(o.opacidadePorArea.size).toBe(0);
    }
  });

  it("situação do pasto: \"<rótulo> · Nd\" com o número da API; sem_registro ≠ \"0d\" e 0d ≠ sem registro", () => {
    const r = coloracaoDasAreas(resposta("situacao_pasto", [
      area("d", fx("em_descanso", "Em descanso", 21, "dias")),
      area("d0", fx("em_descanso", "Em descanso", 0, "dias")),
      area("n", fx("normal", "Ocupação normal", 12, "dias")),
      area("t", fx("atencao", "Ocupação em atenção", 60, "dias")),
      area("c", fx("critico", "Ocupação crítica", 120, "dias")),
      area("s", fx("sem_registro", "Sem registro de ocupação", null, null))
    ]), null);
    expect(r.linhaPorArea.get("d")).toBe("Em descanso · 21d");
    expect(r.linhaPorArea.get("d0")).toBe("Em descanso · 0d");
    expect(r.linhaPorArea.get("d0")).not.toMatch(/sem registro/i);
    expect(r.linhaPorArea.get("n")).toBe("Ocupação normal · 12d");
    expect(r.linhaPorArea.get("t")).toBe("Ocupação em atenção · 60d");
    expect(r.linhaPorArea.get("c")).toBe("Ocupação crítica · 120d");
    const semRegistro = r.linhaPorArea.get("s");
    expect(semRegistro).toBe("Sem registro de ocupação");
    expect(semRegistro).not.toMatch(/\d/);
    expect(semRegistro).not.toBe(r.linhaPorArea.get("d0"));
    expect(r.corPorArea.get("s")).toBe(PALETA_SITUACAO_DO_PASTO.sem_registro);
    expect(r.corPorArea.get("s")).not.toBe(r.corPorArea.get("d0"));
    expect(r.faixasPresentes.map((f) => f.chave)).toEqual(["normal", "atencao", "critico", "em_descanso", "sem_registro"]);
  });

  it("linha extra em TODO modo menos padrão: uso da área e categoria levam o rótulo (categoria sem repetir as cabeças)", () => {
    const uso = coloracaoDasAreas(resposta("uso_da_area", [
      area("p", fx("pastagem", "Pastagem", null, null)),
      area("l", fx("lavoura", "Lavoura", null, null))
    ]), null);
    expect(uso.linhaPorArea.get("p")).toBe("Pastagem");
    expect(uso.linhaPorArea.get("l")).toBe("Lavoura");
    expect(uso.corPorArea.get("p")).toBe(PALETA_USO_DA_AREA.pastagem);
    expect(uso.faixasPresentes.map((f) => f.chave)).toEqual(["pastagem", "lavoura"]);

    const cat = coloracaoDasAreas(resposta("categoria", [
      area("v", fx("VACA", "Vaca", 30, "cabecas")),
      area("b", fx("BOI", "Boi", 50, "cabecas")),
      area("b2", fx("BOI", "BOI", 10, "cabecas")),
      area("x", fx(FAIXA_SEM_REBANHO, "Sem rebanho", null, null))
    ]), null);
    expect(cat.linhaPorArea.get("v")).toBe("Vaca");
    expect(cat.linhaPorArea.get("b")).toBe("Boi");
    expect(cat.linhaPorArea.get("b2")).toBe("BOI");
    expect(cat.linhaPorArea.get("x")).toBe("Sem rebanho");
    // as cabeças já estão na linha amarela do rótulo: o número não se repete
    for (const linha of cat.linhaPorArea.values()) expect(linha).not.toMatch(/\d/);
    expect(cat.corPorArea.get("b")).toBe(CORES_DE_CATEGORIA[0]);
    expect(cat.corPorArea.get("v")).toBe(CORES_DE_CATEGORIA[1]);
    expect(cat.corPorArea.get("x")).toBe(COR_SEM_REBANHO);
    expect(cat.faixasPresentes.map((f) => [f.chave, f.quantidade])).toEqual([["BOI", 2], ["VACA", 1], [FAIXA_SEM_REBANHO, 1]]);
    // a cor da legenda é a mesma do polígono
    expect(cat.faixasPresentes.find((f) => f.chave === "VACA")?.cor).toBe(cat.corPorArea.get("v"));

    expect(linhaDaFaixa("uso_da_area", fx("pastagem", "Pastagem", null, null))).toBe("Pastagem");
    expect(linhaDaFaixa("categoria", fx("BOI", "Boi", 5, "cabecas"))).toBe("Boi");
    // padrão não tem faixa e não tem linha; sem faixa, sem linha
    expect(linhaDaFaixa("padrao", fx("ideal", "Lotação ideal", "1.45", "ua_ha"))).toBeNull();
    expect(linhaDaFaixa("lotacao_ua_ha", null)).toBeNull();
  });

  it("comLinhaExtra: junta a linha ao rótulo da área; sem linha, devolve os mesmos rótulos", () => {
    const rotulos = [{ id: "a1", px: { x: 1, y: 2 }, nome: "Pasto a1", ha: 10 }, { id: "a2", px: { x: 3, y: 4 }, nome: "Pasto a2", ha: 5 }];
    const vazio = new Map<string, string>();
    expect(comLinhaExtra(rotulos, vazio)).toBe(rotulos);
    const junto = comLinhaExtra(rotulos, new Map([["a1", "Lotação ideal · 1,45 UA/ha"]]));
    expect(junto[0]).toEqual({ ...rotulos[0], linhaExtra: "Lotação ideal · 1,45 UA/ha" });
    expect(junto[1]).toBe(rotulos[1]);
    expect("linhaExtra" in junto[1]!).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------
// Estático: a tela pinta, não calcula
// ------------------------------------------------------------------------------------------------

describe("MM4 paleta — nenhuma regra de negócio na tela", () => {
  const dir = resolve(__dirname);
  const fonte = (f: string) => readFileSync(resolve(dir, f), "utf8");
  // montado em pedaços: o próprio teste não pode carregar o prefixo herdado (catraca prefixo-mg do naming-audit)
  const prefixoDeToken = ["--", "mg", "-"].join("");
  const proibidos = ["/ 450", "usable_area_ha", "categorias_misto", "Date", prefixoDeToken];

  for (const arquivo of ["paleta-do-mapa.ts", "coloracao-no-mapa.ts", "legenda-do-mapa.tsx", "seletor-de-coloracao.tsx"]) {
    it(`${arquivo}: sem conta de lotação, área útil, MISTO, data nem token CSS por nome`, () => {
      const s = fonte(arquivo);
      for (const p of proibidos) expect(s, `${arquivo} contém "${p}"`).not.toContain(p);
    });
  }

  it("seletor: os modos vêm de MODOS_DE_COLORACAO e o texto de enumLabel — sem lista redigitada", () => {
    const s = fonte("seletor-de-coloracao.tsx");
    expect(s).toContain("MODOS_DE_COLORACAO");
    expect(s).toContain("enumLabel(\"modo_de_coloracao\"");
    expect(s).not.toMatch(/"lotacao_ua_ha"|"situacao_pasto"|"uso_da_area"/);
  });

  it("alvo de toque: Button e NativeSelect do barrel usam !min-h-11 sm:!min-h-0 (as classes base das primitives ficam fora de @layer e vencem o utilitário sem !)", () => {
    for (const arquivo of ["legenda-do-mapa.tsx", "seletor-de-coloracao.tsx"]) {
      const s = fonte(arquivo);
      const primitivas = [...s.matchAll(/<(?:Button|NativeSelect)\b(?:(?!<\/?[A-Za-z]).)*?className="([^"]*)"/gs)].map((m) => m[1]!);
      expect(primitivas.length, arquivo).toBe(arquivo === "legenda-do-mapa.tsx" ? 2 : 1);
      for (const c of primitivas) {
        expect(c, `${arquivo}: ${c}`).toContain("!min-h-11");
        expect(c, `${arquivo}: ${c}`).toContain("sm:!min-h-0");
      }
    }
  });

  it("camada-desenho: a linha a mais é opcional e só aparece quando vem", () => {
    const s = fonte("camada-desenho.tsx");
    expect(s).toContain("linhaExtra?: string");
    expect(s).toContain("{r.linhaExtra && (");
    expect(s).toContain("data-testid=\"mapa-rotulo-linha-extra\"");
  });
});
