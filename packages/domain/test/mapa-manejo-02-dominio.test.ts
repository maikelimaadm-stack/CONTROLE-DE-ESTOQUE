import { describe, it, expect } from "vitest";
import {
  CATEGORIA_MISTO, resolverIconeDoLote, type ConfiguracaoDeIcone
} from "../src/configuracao-de-icone.js";
import {
  COR_PADRAO_DO_IDENTIFICADOR, resolverIdentificadorDaArea, type LoteComIdentificador
} from "../src/identificador-do-lote.js";
import { centroideDePoligono, type CentroideDoPoligono } from "../src/centroide-de-poligono.js";
import {
  FAIXAS_DE_LOTACAO_UA_HA, MODOS_DE_COLORACAO, SITUACOES_DO_PASTO, faixaDaArea, faixaDeCategoria, faixaDeLotacaoUaHa,
  faixaDeSituacaoDoPasto, faixaDeUsoDaArea, type EntradaFaixaDaArea, type FaixaDoMapa, type ModoDeColoracao
} from "../src/cores-do-mapa.js";
import { TIPOS_DE_USO_DA_AREA } from "../src/tipos-de-uso-da-area.js";
import { UNKNOWN_VALUE, enumLabel, hasEnumLabel } from "../src/labels.js";
import * as dominio from "../src/index.js";

/**
 * MAPA-MANEJO-02 — o domínio do marcador agregado da área: qual ícone vale para o lote (MM2-7), o identificador
 * da área (MM2-8), o centróide onde o marcador ancora (MM2-9) e as faixas de coloração do mapa (MM2-10 lotação,
 * MM2-11 situação do pasto). Cada `it` testa a REGRA, com asserção exata; toda lista conferida tem o tamanho
 * conferido junto, para que nenhum laço passe verde sem ter rodado.
 */

// --------------------------------------------------------------------------------------------------
// Ajudantes
// --------------------------------------------------------------------------------------------------

/** Configuração de ícone de lote, ativa e viva; `extra` muda só o que o caso precisa. Sem URL de ícone de propósito. */
function cfg(id: string, categoria: string, extra: Partial<ConfiguracaoDeIcone> = {}): ConfiguracaoDeIcone {
  return { id, tipo_entidade: "lote", categoria, categorias_misto: null, icone_url: null, cor_padrao: null, ativo: true, deleted_at: null, ...extra };
}
/** Configuração MISTO que cobre as categorias dadas (já canônicas, como o banco grava). */
const misto = (id: string, categorias: string[], extra: Partial<ConfiguracaoDeIcone> = {}): ConfiguracaoDeIcone =>
  cfg(id, CATEGORIA_MISTO, { categorias_misto: categorias, ...extra });

/** Todas as permutações de uma lista (n! — só para listas curtas). */
function permutacoes<T>(lista: readonly T[]): T[][] {
  if (lista.length <= 1) return [[...lista]];
  const saida: T[][] = [];
  lista.forEach((item, i) => {
    for (const resto of permutacoes([...lista.slice(0, i), ...lista.slice(i + 1)])) saida.push([item, ...resto]);
  });
  return saida;
}

const lote = (nome: string | null, sigla: string | null, cor: string | null): LoteComIdentificador =>
  ({ identificador_nome: nome, identificador_sigla: sigla, identificador_cor: cor });

type Ponto = readonly [number, number];
const poligono = (anel: readonly Ponto[], ...furos: (readonly Ponto[])[]): unknown =>
  ({ type: "Polygon", coordinates: [anel.map((p) => [...p]), ...furos.map((f) => f.map((p) => [...p]))] });
/** Anel fechado (GeoJSON): repete o primeiro ponto no fim. */
const fechado = (anel: readonly Ponto[]): Ponto[] => [...anel, anel[0]!];

/**
 * PONTO NO POLÍGONO por raio (ray casting), escrito AQUI — independente do código testado. O raio sai do ponto
 * para +x e conta quantas arestas cruza: ímpar = dentro. Serve a anel aberto ou fechado (a aresta de fecho de
 * comprimento zero não cruza nada).
 */
function pontoDentro(p: CentroideDoPoligono, anel: readonly Ponto[]): boolean {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i]!;
    const [xj, yj] = anel[j]!;
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
/** Média dos vértices (sem o ponto de fecho): o que a reversa R3 põe no lugar do centróide de área. */
function mediaDosVertices(anel: readonly Ponto[]): CentroideDoPoligono {
  return { lon: anel.reduce((s, [x]) => s + x, 0) / anel.length, lat: anel.reduce((s, [, y]) => s + y, 0) / anel.length };
}

/** O L de braço largo do caso MM2-9b: 10 × 10 sem o quadrado de cima à direita (braços de largura 4). */
const L_LARGO: readonly Ponto[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];

const HOJE = "2026-06-30";
/** A data `n` dias antes de HOJE (calendário UTC). Ancorada por asserção no MM2-11a. */
const diasAntes = (n: number): string => new Date(Date.parse(`${HOJE}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

const lotacao = (chave: string, numero: string | null): FaixaDoMapa =>
  ({ chave, rotulo: enumLabel("faixa_de_lotacao_ua_ha", chave), numero, unidade: numero === null ? null : "ua_ha" });
const situacao = (chave: string, numero: number | null): FaixaDoMapa =>
  ({ chave, rotulo: enumLabel("situacao_do_pasto", chave), numero, unidade: numero === null ? null : "dias" });

// --------------------------------------------------------------------------------------------------
// MM2-7 — ícone do lote
// --------------------------------------------------------------------------------------------------

describe("MM2-7 — resolverIconeDoLote: qual configuração de ícone vale para o lote", () => {
  it("MM2-7a uma categoria: match exato pela categoria normalizada (\" vaca \" acha \"VACA\"); MISTO não toma o lugar do exato", () => {
    const vaca = cfg("c-vaca", "VACA");
    const boi = cfg("c-boi", "BOI");
    const mistoComVaca = misto("c-misto", ["BOI", "VACA"]);
    const configs = [mistoComVaca, boi, vaca];
    expect(resolverIconeDoLote([" vaca "], configs)).toBe(vaca);
    expect(resolverIconeDoLote(["Vaca"], configs)).toBe(vaca);
    expect(resolverIconeDoLote(["VACA"], configs)).toBe(vaca);
    // a mesma categoria repetida, escrita de jeitos diferentes, continua sendo UMA categoria — não vira misto
    expect(resolverIconeDoLote(["Vaca", " VACA", "vaca "], configs)).toBe(vaca);
    expect(resolverIconeDoLote(["boi"], configs)).toBe(boi);
  });

  it("MM2-7b várias categorias: a MISTO mais específica (menor conjunto que contém todas) ganha, em qualquer ordem de cadastro", () => {
    // ids escolhidos para que a ordem por id aponte a MISTO ERRADA: o id não pode ser o que decide
    const boiVaca = misto("c-misto-b", ["BOI", "VACA"]);
    const boiVacaBezerro = misto("c-misto-a", ["BEZERRO", "BOI", "VACA"]);
    const ordens = [[boiVacaBezerro, boiVaca], [boiVaca, boiVacaBezerro]];
    expect(ordens).toHaveLength(2);
    for (const configs of ordens) {
      const ordem = configs.map((c) => c.id).join(",");
      expect(resolverIconeDoLote(["Boi", "Vaca"], configs), `Boi+Vaca, ordem ${ordem}`).toBe(boiVaca);
      expect(resolverIconeDoLote(["Vaca", "boi ", "BOI"], configs), `Vaca+Boi repetido, ordem ${ordem}`).toBe(boiVaca);
      expect(resolverIconeDoLote(["Boi", "Vaca", "Bezerro"], configs), `Boi+Vaca+Bezerro, ordem ${ordem}`).toBe(boiVacaBezerro);
      // nenhuma MISTO contém Touro → nada
      expect(resolverIconeDoLote(["Boi", "Touro"], configs), `Boi+Touro, ordem ${ordem}`).toBeNull();
    }
  });

  it("MM2-7c nada casa → null; inativa, excluída e de outro tipo_entidade não concorrem; uma categoria NÃO cai em MISTO; zero categorias → null", () => {
    // nada casa
    expect(resolverIconeDoLote(["Touro"], [cfg("c-vaca", "VACA"), misto("c-m", ["BOI", "VACA"])])).toBeNull();
    expect(resolverIconeDoLote(["Vaca"], [])).toBeNull();

    // cada filtro com o seu controle: a MESMA configuração, só com o campo ligado, casaria
    const filtros: [string, Partial<ConfiguracaoDeIcone>, Partial<ConfiguracaoDeIcone>][] = [
      ["inativa", { ativo: false }, { ativo: true }],
      ["excluída", { deleted_at: "2026-05-01T12:00:00Z" }, { deleted_at: null }],
      ["tipo área", { tipo_entidade: "area" }, { tipo_entidade: "lote" }],
      ["tipo objeto do mapa", { tipo_entidade: "objeto_de_mapa" }, { tipo_entidade: "lote" }]
    ];
    expect(filtros).toHaveLength(4);
    for (const [nome, fora, dentro] of filtros) {
      const exataFora = cfg("c-vaca", "VACA", fora);
      expect(resolverIconeDoLote(["Vaca"], [exataFora]), `exata ${nome}`).toBeNull();
      const exataDentro = cfg("c-vaca", "VACA", dentro);
      expect(resolverIconeDoLote(["Vaca"], [exataDentro]), `controle da exata ${nome}`).toBe(exataDentro);
      // na MISTO o mesmo filtro vale: a mais específica fora do jogo passa a vez à seguinte
      const especificaFora = misto("c-m2", ["BOI", "VACA"], fora);
      const geral = misto("c-m3", ["BEZERRO", "BOI", "VACA"]);
      expect(resolverIconeDoLote(["Boi", "Vaca"], [especificaFora, geral]), `MISTO ${nome}`).toBe(geral);
      expect(resolverIconeDoLote(["Boi", "Vaca"], [especificaFora]), `só a MISTO ${nome}`).toBeNull();
    }
    // sem deleted_at na linha (campo ausente) é viva
    const semCampo: ConfiguracaoDeIcone = { id: "c-x", tipo_entidade: "lote", categoria: "VACA", categorias_misto: null, icone_url: null, cor_padrao: null, ativo: true };
    expect(resolverIconeDoLote(["Vaca"], [semCampo])).toBe(semCampo);

    // UMA categoria sem configuração exata não cai na MISTO, mesmo que a MISTO a contenha
    const boi = cfg("c-boi", "BOI");
    const mistoBoiVaca = misto("c-m", ["BOI", "VACA"]);
    expect(resolverIconeDoLote(["Vaca"], [mistoBoiVaca, boi])).toBeNull();
    expect(resolverIconeDoLote(["Boi"], [mistoBoiVaca, boi])).toBe(boi);

    // zero categorias (nenhuma, ou só texto vazio/espaço) → null, mesmo com configurações cadastradas
    const todas = [boi, mistoBoiVaca, cfg("c-vaca", "VACA")];
    expect(resolverIconeDoLote([], todas)).toBeNull();
    expect(resolverIconeDoLote(["", "   "], todas)).toBeNull();
  });

  it("MM2-7d empate de cardinalidade entre MISTO: o MESMO resultado em todas as permutações da lista de entrada", () => {
    const mA = misto("c-3", ["BEZERRO", "BOI", "VACA"]);
    const mB = misto("c-1", ["BOI", "NOVILHA", "VACA"]);
    // o mesmo conjunto de mA (o banco aceita; o domínio desempata)
    const mD = misto("c-2", ["BEZERRO", "BOI", "VACA"]);
    // mais geral (4): nunca ganha enquanto houver uma de 3 que contenha as presentes
    const mC = misto("c-0", ["BEZERRO", "BOI", "NOVILHA", "VACA"]);
    const exata = cfg("c-boi", "BOI");
    const empatadas = new Set([mA, mB, mD]);

    const todas = permutacoes([mA, mB, mD, mC, exata]);
    expect(todas).toHaveLength(120);
    const presentesEmOrdens = [["Boi", "Vaca"], ["Vaca", "Boi"], [" vaca", "BOI", "boi"]];
    const resultados = new Set<ConfiguracaoDeIcone | null>();
    for (const configs of todas) for (const presentes of presentesEmOrdens) resultados.add(resolverIconeDoLote(presentes, configs));
    expect(resultados.size).toBe(1);
    const [vencedora] = [...resultados];
    expect(vencedora).not.toBeNull();
    expect(empatadas.has(vencedora!)).toBe(true);

    // só o par de MESMO conjunto (o desempate não tem a lista para decidir): determinístico também
    const doPar = new Set(permutacoes([mA, mD, mC]).map((configs) => resolverIconeDoLote(["Boi", "Vaca"], configs)));
    expect(doPar.size).toBe(1);
    const [doParVencedora] = [...doPar];
    expect([mA, mD]).toContain(doParVencedora);
  });
});

// --------------------------------------------------------------------------------------------------
// MM2-8 — identificador da área
// --------------------------------------------------------------------------------------------------

describe("MM2-8 — resolverIdentificadorDaArea: o marcador dos lotes abertos na área", () => {
  it("MM2-8a um lote identificado → ele: cor, sigla INTEIRA, nome (com btrim), misto false; lote sem identificador não vota", () => {
    const r = resolverIdentificadorDaArea([
      lote(null, null, null),
      lote(" Recria Norte ", " RN01 ", "#1A2B3C"),
      lote("   ", " ", null)
    ]);
    expect(r).toEqual({ misto: false, cor: "#1A2B3C", sigla: "RN01", nome: "Recria Norte" });
    expect(Object.keys(r!).sort()).toEqual(["cor", "misto", "nome", "sigla"]);
    // a sigla de 4 caracteres (o máximo da CHECK) sai inteira: quem corta para caber é a tela
    expect(resolverIdentificadorDaArea([lote("Engorda Sul", "ENGS", "#00FF00")])).toEqual({ misto: false, cor: "#00FF00", sigla: "ENGS", nome: "Engorda Sul" });
  });

  it("MM2-8b sigla sem cor usa COR_PADRAO_DO_IDENTIFICADOR ('#64748b'); cor só com espaço também é sem cor", () => {
    expect(COR_PADRAO_DO_IDENTIFICADOR).toBe("#64748b");
    expect(resolverIdentificadorDaArea([lote("Engorda", "EG", null)])).toEqual({ misto: false, cor: "#64748b", sigla: "EG", nome: "Engorda" });
    expect(resolverIdentificadorDaArea([lote("Engorda", "EG", "   ")])).toEqual({ misto: false, cor: COR_PADRAO_DO_IDENTIFICADOR, sigla: "EG", nome: "Engorda" });
  });

  it("MM2-8c dois identificadores distintos → { misto: true } e NADA mais (sem cor, sem sigla, sem nome)", () => {
    const recria = lote("Recria", "RC", "#111111");
    const engorda = lote("Engorda", "EG", "#222222");
    const casos = [[recria, engorda], [engorda, recria], [recria, lote(null, null, null), engorda, recria]];
    expect(casos).toHaveLength(3);
    for (const lotes of casos) {
      const r = resolverIdentificadorDaArea(lotes);
      expect(r).toEqual({ misto: true });
      expect(Object.keys(r!)).toEqual(["misto"]);
    }
  });

  it("MM2-8d dois IGUAIS deduplicam → um marcador só, não misto (iguais depois do btrim também)", () => {
    const esperado = { misto: false, cor: "#1A2B3C", sigla: "RC", nome: "Recria" };
    expect(resolverIdentificadorDaArea([lote("Recria", "RC", "#1A2B3C"), lote("Recria", "RC", "#1A2B3C")])).toEqual(esperado);
    expect(resolverIdentificadorDaArea([lote("Recria", "RC", "#1A2B3C"), lote(" Recria ", "RC ", " #1A2B3C")])).toEqual(esperado);
    expect(resolverIdentificadorDaArea([lote("Recria", "RC", "#1A2B3C"), lote(null, null, null), lote("Recria", "RC", "#1A2B3C")])).toEqual(esperado);
  });

  it("MM2-8e nenhum lote identificado (todos nulos, ou só espaço) → null; lista vazia → null", () => {
    expect(resolverIdentificadorDaArea([lote(null, null, null)])).toBeNull();
    expect(resolverIdentificadorDaArea([lote(null, null, null), lote(null, null, null)])).toBeNull();
    expect(resolverIdentificadorDaArea([lote(" ", "  ", "   "), lote("", "", "")])).toBeNull();
    expect(resolverIdentificadorDaArea([])).toBeNull();
  });
});

// --------------------------------------------------------------------------------------------------
// MM2-9 — centróide
// --------------------------------------------------------------------------------------------------

describe("MM2-9 — centroideDePoligono: onde o marcador ancora", () => {
  it("MM2-9a quadrado → centro exato (em graus também); o furo não desloca (vale o anel externo)", () => {
    expect(centroideDePoligono(poligono(fechado([[0, 0], [4, 0], [4, 4], [0, 4]])))).toEqual({ lon: 2, lat: 2 });
    // sentido horário dá o mesmo ponto
    expect(centroideDePoligono(poligono(fechado([[0, 0], [0, 4], [4, 4], [4, 0]])))).toEqual({ lon: 2, lat: 2 });
    // quadrado em graus (lon, lat do Centro-Oeste), com coordenadas exatas em binário
    const emGraus: Ponto[] = [[-56.5, -15.5], [-56, -15.5], [-56, -15], [-56.5, -15]];
    expect(centroideDePoligono(poligono(fechado(emGraus)))).toEqual({ lon: -56.25, lat: -15.25 });
    // furo fora do centro: o marcador continua no centro do anel externo
    expect(centroideDePoligono(poligono(fechado([[0, 0], [4, 0], [4, 4], [0, 4]]), fechado([[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]]))))
      .toEqual({ lon: 2, lat: 2 });
  });

  it("MM2-9b polígono em L de braço largo → o ponto cai DENTRO (ray casting); a média dos vértices do mesmo L cai FORA", () => {
    // o ray casting do teste discrimina: um ponto do braço de baixo dentro, o canto vazio e o centro da caixa fora
    expect(pontoDentro({ lon: 8, lat: 2 }, L_LARGO)).toBe(true);
    expect(pontoDentro({ lon: 2, lat: 8 }, L_LARGO)).toBe(true);
    expect(pontoDentro({ lon: 8, lat: 8 }, L_LARGO)).toBe(false);
    expect(pontoDentro({ lon: 5, lat: 5 }, L_LARGO)).toBe(false);

    const media = mediaDosVertices(L_LARGO);
    expect(pontoDentro(media, L_LARGO)).toBe(false);

    // o mesmo L em quatro apresentações: aberto, fechado, horário, e em graus
    const horario = [...L_LARGO].reverse();
    const emGraus: Ponto[] = L_LARGO.map(([x, y]) => [-56 + x * 0.001, -15 + y * 0.001]);
    const casos: [string, readonly Ponto[]][] = [["aberto", L_LARGO], ["fechado", fechado(L_LARGO)], ["horário", horario], ["em graus", emGraus]];
    expect(casos).toHaveLength(4);
    for (const [nome, anel] of casos) {
      const c = centroideDePoligono(poligono(anel));
      expect(c, nome).not.toBeNull();
      expect(pontoDentro(c!, anel), `${nome}: centróide ${JSON.stringify(c)} dentro do L`).toBe(true);
      expect(pontoDentro(mediaDosVertices(anel.length === 7 ? anel.slice(0, 6) : anel), anel), `${nome}: média dos vértices fora`).toBe(false);
    }
  });

  it("MM2-9c degenerado (colinear, dois pontos, área zero) → centro da caixa, sem lançar; geometria nula/inválida → null, sem lançar", () => {
    const degenerados: [string, readonly Ponto[], CentroideDoPoligono][] = [
      ["colinear horizontal", [[0, 0], [5, 0], [10, 0]], { lon: 5, lat: 0 }],
      ["colinear diagonal fechado", fechado([[0, 0], [5, 5], [10, 10]]), { lon: 5, lat: 5 }],
      ["dois pontos", [[0, 0], [4, 2]], { lon: 2, lat: 1 }],
      ["dois pontos fechado", fechado([[0, 0], [4, 2]]), { lon: 2, lat: 1 }],
      ["um ponto", [[3, 7]], { lon: 3, lat: 7 }],
      ["ponto repetido", [[1, 1], [1, 1], [1, 1], [1, 1]], { lon: 1, lat: 1 }],
      // gravata: quatro pontos distintos, área com sinal zero
      ["área zero (gravata)", fechado([[0, 0], [2, 2], [2, 0], [0, 2]]), { lon: 1, lat: 1 }]
    ];
    expect(degenerados).toHaveLength(7);
    for (const [nome, anel, esperado] of degenerados) {
      let c: CentroideDoPoligono | null = null;
      expect(() => { c = centroideDePoligono(poligono(anel)); }, nome).not.toThrow();
      expect(c, nome).toEqual(esperado);
    }

    const invalidas: unknown[] = [
      null, undefined, 42, "Polygon", [], {},
      { type: "Point", coordinates: [1, 2] },
      { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] },
      { type: "Polygon" },
      { type: "Polygon", coordinates: null },
      { type: "Polygon", coordinates: [] },
      { type: "Polygon", coordinates: [[]] },
      { type: "Polygon", coordinates: [null] },
      { type: "Polygon", coordinates: [[["a", "b"], [null, 1], [1]]] },
      { type: "Polygon", coordinates: [[[Number.NaN, 1], [Number.POSITIVE_INFINITY, 2]]] }
    ];
    expect(invalidas).toHaveLength(15);
    for (const g of invalidas) {
      let c: CentroideDoPoligono | null | "não rodou" = "não rodou";
      expect(() => { c = centroideDePoligono(g); }, JSON.stringify(g) ?? String(g)).not.toThrow();
      expect(c, JSON.stringify(g) ?? String(g)).toBeNull();
    }

    // posição inválida no meio do anel não derruba a conta: vale o que é ponto
    const comLixo = { type: "Polygon", coordinates: [[[0, 0], ["x", 1], [4, 0], [4, 4], null, [0, 4], [0, 0]]] };
    expect(() => centroideDePoligono(comLixo)).not.toThrow();
    expect(centroideDePoligono(comLixo)).toEqual({ lon: 2, lat: 2 });
  });

  it("MM2-9d anel fechado dá o MESMO resultado do anel aberto", () => {
    const aneis: [string, readonly Ponto[]][] = [
      ["quadrado", [[0, 0], [4, 0], [4, 4], [0, 4]]],
      ["L largo", L_LARGO],
      ["triângulo", [[0, 0], [9, 0], [0, 6]]],
      ["irregular em graus", [[-56.123, -15.456], [-56.101, -15.449], [-56.095, -15.47], [-56.11, -15.482], [-56.13, -15.475]]]
    ];
    expect(aneis).toHaveLength(4);
    for (const [nome, anel] of aneis) {
      const aberto = centroideDePoligono(poligono(anel));
      expect(aberto, nome).not.toBeNull();
      expect(centroideDePoligono(poligono(fechado(anel))), nome).toEqual(aberto);
    }
    // o triângulo confere o valor: o centróide é a média dos três vértices (3, 2)
    expect(centroideDePoligono(poligono(fechado([[0, 0], [9, 0], [0, 6]])))).toEqual({ lon: 3, lat: 2 });
  });
});

// --------------------------------------------------------------------------------------------------
// MM2-10 — lotação UA/ha
// --------------------------------------------------------------------------------------------------

describe("MM2-10 — faixaDeLotacaoUaHa: a faixa da área pela lotação em UA/ha da área ÚTIL", () => {
  it("MM2-10a as 5 faixas nos limites EXATOS (0.79/0.80, 1.19/1.20, 1.79/1.80, 2.39/2.40); sem área útil → sem_area_util", () => {
    // área útil 100 ha (total igual, para o caso não depender do denominador): UA = 100 × UA/ha
    const casos: [string, string, string][] = [
      ["0", "0.00", "sublotacao"],
      ["79", "0.79", "sublotacao"],
      ["80", "0.80", "moderada"],
      ["119", "1.19", "moderada"],
      ["120", "1.20", "ideal"],
      ["179", "1.79", "ideal"],
      ["180", "1.80", "alta"],
      ["239", "2.39", "alta"],
      ["240", "2.40", "superlotacao"],
      ["900", "9.00", "superlotacao"],
      // classifica o número EXIBIDO (2 casas, meio para cima): 0,795 aparece 0.80 e é moderada
      ["79.5", "0.80", "moderada"]
    ];
    expect(casos).toHaveLength(11);
    for (const [uaTotal, uaHa, chave] of casos) {
      expect(faixaDeLotacaoUaHa({ uaTotal, usableAreaHa: "100", areaHa: "100" }), `UA ${uaTotal} em 100 ha`).toEqual(lotacao(chave, uaHa));
    }
    // as cinco faixas apareceram (nenhuma ficou sem caso)
    expect(new Set(casos.map(([, , chave]) => chave))).toEqual(new Set(FAIXAS_DE_LOTACAO_UA_HA.filter((f) => f !== "sem_area_util")));

    // sem área útil (nula, 0, negativa) → sem_area_util, sem número — mesmo com a área total cadastrada
    const semAreaUtil: (string | null)[] = [null, "0", "0.00", "-5"];
    expect(semAreaUtil).toHaveLength(4);
    for (const usableAreaHa of semAreaUtil) {
      const r = faixaDeLotacaoUaHa({ uaTotal: "150", usableAreaHa, areaHa: "100" });
      expect(r, `área útil ${String(usableAreaHa)}`).toEqual({ chave: "sem_area_util", rotulo: "Sem área útil cadastrada", numero: null, unidade: null });
    }
  });

  it("MM2-10b divide por usable_area_ha, NÃO por area_ha: mesma UA, áreas diferentes que caem em faixas diferentes — vale a da área útil", () => {
    // 150 UA: ÷ 100 (útil) = 1.50 ideal; ÷ 200 (total) seria 0.75 sublotação
    expect(faixaDeLotacaoUaHa({ uaTotal: "150", usableAreaHa: "100", areaHa: "200" })).toEqual(lotacao("ideal", "1.50"));
    // 100 UA: ÷ 40 (útil) = 2.50 superlotação; ÷ 125 (total) seria 0.80 moderada
    expect(faixaDeLotacaoUaHa({ uaTotal: "100", usableAreaHa: "40", areaHa: "125" })).toEqual(lotacao("superlotacao", "2.50"));
    // a área total nula não tira a lotação de quem tem área útil
    expect(faixaDeLotacaoUaHa({ uaTotal: "100", usableAreaHa: "50", areaHa: null })).toEqual(lotacao("alta", "2.00"));
    // pelo despacho que a API usa, o mesmo
    const dados: EntradaFaixaDaArea = {
      landUse: "pastagem", uaTotal: "150", usableAreaHa: "100", areaHa: "200",
      inicioDaAbertaMaisAntiga: null, ultimaSaida: null, hoje: HOJE, categorias: []
    };
    expect(faixaDaArea("lotacao_ua_ha", dados)).toEqual(lotacao("ideal", "1.50"));
  });
});

// --------------------------------------------------------------------------------------------------
// MM2-11 — situação do pasto
// --------------------------------------------------------------------------------------------------

describe("MM2-11 — faixaDeSituacaoDoPasto: dias de ocupação ou de descanso", () => {
  it("MM2-11a ocupada: 30d normal, 60d atenção, 120d crítico; limites 45/46 e 90/91", () => {
    expect(diasAntes(30)).toBe("2026-05-31");
    expect(diasAntes(91)).toBe("2026-03-31");
    const casos: [number, string][] = [
      [0, "normal"], [30, "normal"], [45, "normal"], [46, "atencao"], [60, "atencao"], [90, "atencao"], [91, "critico"], [120, "critico"]
    ];
    expect(casos).toHaveLength(8);
    for (const [dias, chave] of casos) {
      const r = faixaDeSituacaoDoPasto({ inicioDaAbertaMaisAntiga: diasAntes(dias), ultimaSaida: null, hoje: HOJE });
      expect(r, `${dias} dias ocupada`).toEqual(situacao(chave, dias));
    }
    // ocupada com saída anterior registrada: vale a ocupação (não o descanso)
    expect(faixaDeSituacaoDoPasto({ inicioDaAbertaMaisAntiga: diasAntes(60), ultimaSaida: diasAntes(70), hoje: HOJE })).toEqual(situacao("atencao", 60));
  });

  it("MM2-11b vazia com saída → em_descanso com hoje − última saída em dias", () => {
    const casos: [string, number][] = [["2026-06-10", 20], ["2026-05-31", 30], ["2025-12-31", 181]];
    expect(casos).toHaveLength(3);
    for (const [ultimaSaida, dias] of casos) {
      expect(faixaDeSituacaoDoPasto({ inicioDaAbertaMaisAntiga: null, ultimaSaida, hoje: HOJE }), ultimaSaida).toEqual(situacao("em_descanso", dias));
    }
  });

  it("MM2-11c nunca ocupada → sem_registro com número null, DIFERENTE de 0 dias (vazia com saída HOJE → em_descanso, 0)", () => {
    const nunca = faixaDeSituacaoDoPasto({ inicioDaAbertaMaisAntiga: null, ultimaSaida: null, hoje: HOJE });
    expect(nunca).toEqual({ chave: "sem_registro", rotulo: "Sem registro de ocupação", numero: null, unidade: null });
    expect(nunca.numero).toBeNull();
    const saiuHoje = faixaDeSituacaoDoPasto({ inicioDaAbertaMaisAntiga: null, ultimaSaida: HOJE, hoje: HOJE });
    expect(saiuHoje).toEqual({ chave: "em_descanso", rotulo: "Em descanso", numero: 0, unidade: "dias" });
    expect(saiuHoje.numero).toBe(0);
    expect(nunca).not.toEqual(saiuHoje);
  });
});

// --------------------------------------------------------------------------------------------------
// Os outros modos que a integração usa: categoria, uso da área, despacho e rótulos
// --------------------------------------------------------------------------------------------------

describe("MM2-10 — demais modos de coloração, o despacho e os rótulos (o que /mapa/operacional consome)", () => {
  it("MM2-10 faixaDeCategoria: predominante por cabeças somadas na categoria normalizada; empate pela chave alfabética; sem rebanho", () => {
    // "Vaca" (10) e "vaca " (3) são a mesma: 13 > Boi 5; o rótulo é o nome cadastrado (o menor em ordem)
    expect(faixaDeCategoria([{ nome: "Vaca", cabecas: 10 }, { nome: "Boi", cabecas: 5 }, { nome: "vaca ", cabecas: 3 }]))
      .toEqual({ chave: "VACA", rotulo: "Vaca", numero: 13, unidade: "cabecas" });
    // a soma decide: Boi 6 + BOI 6 = 12 vence Vaca 10, embora cada linha de Boi seja menor
    expect(faixaDeCategoria([{ nome: "Boi", cabecas: 6 }, { nome: "Vaca", cabecas: 10 }, { nome: "BOI ", cabecas: 6 }]))
      .toEqual({ chave: "BOI", rotulo: "BOI ", numero: 12, unidade: "cabecas" });
    // empate de cabeças → a menor chave em ordem alfabética, qualquer que seja a ordem de entrada
    const empate = [{ nome: "Vaca", cabecas: 5 }, { nome: "Novilha", cabecas: 5 }, { nome: "Boi", cabecas: 5 }, { nome: "Bezerro", cabecas: 2 }];
    const ordens = permutacoes(empate);
    expect(ordens).toHaveLength(24);
    for (const o of ordens) expect(faixaDeCategoria(o)).toEqual({ chave: "BOI", rotulo: "Boi", numero: 5, unidade: "cabecas" });
    // sem nenhuma cabeça → sem_rebanho, sem número
    const semRebanho = { chave: "sem_rebanho", rotulo: "Sem rebanho", numero: null, unidade: null };
    expect(faixaDeCategoria([])).toEqual(semRebanho);
    expect(faixaDeCategoria([{ nome: "Boi", cabecas: 0 }, { nome: "  ", cabecas: 4 }])).toEqual(semRebanho);
  });

  it("MM2-10 faixaDeUsoDaArea: chave = land_use, rótulo do catálogo tipos-de-uso-da-area, sem número; fora do catálogo → Desconhecido", () => {
    expect(faixaDeUsoDaArea("pastagem")).toEqual({ chave: "pastagem", rotulo: "Pastagem", numero: null, unidade: null });
    expect(TIPOS_DE_USO_DA_AREA).toHaveLength(17);
    for (const [valor, rotulo] of TIPOS_DE_USO_DA_AREA) expect(faixaDeUsoDaArea(valor)).toEqual({ chave: valor, rotulo, numero: null, unidade: null });
    // nunca devolve o valor cru como rótulo
    expect(faixaDeUsoDaArea("lagoa_secreta")).toEqual({ chave: "lagoa_secreta", rotulo: UNKNOWN_VALUE, numero: null, unidade: null });
  });

  it("MM2-10 faixaDaArea: padrao → null; cada modo devolve a faixa da função dele; modo desconhecido LANÇA", () => {
    expect(MODOS_DE_COLORACAO).toEqual(["padrao", "uso_da_area", "lotacao_ua_ha", "situacao_pasto", "categoria"]);
    const dados: EntradaFaixaDaArea = {
      landUse: "ilp", uaTotal: "90", usableAreaHa: "50", areaHa: "60",
      inicioDaAbertaMaisAntiga: "2026-05-01", ultimaSaida: "2026-04-01", hoje: HOJE,
      categorias: [{ nome: "Novilha", cabecas: 40 }, { nome: "Vaca", cabecas: 12 }]
    };
    expect(faixaDaArea("padrao", dados)).toBeNull();
    expect(faixaDaArea("uso_da_area", dados)).toEqual({ chave: "ilp", rotulo: "Integração lavoura-pecuária (ILP)", numero: null, unidade: null });
    expect(faixaDaArea("lotacao_ua_ha", dados)).toEqual(lotacao("alta", "1.80"));
    expect(faixaDaArea("situacao_pasto", dados)).toEqual(situacao("atencao", 60));
    expect(faixaDaArea("categoria", dados)).toEqual({ chave: "NOVILHA", rotulo: "Novilha", numero: 40, unidade: "cabecas" });
    // discriminador desconhecido nega: não cai em `padrao` (a API recusa antes; o domínio não confia)
    const desconhecido: string = "arco_iris";
    expect(() => faixaDaArea(desconhecido as ModoDeColoracao, dados)).toThrowError(RangeError);
  });

  it("MM2-10 rótulos das faixas moram em labels.ts: todo valor tem rótulo (nenhum Desconhecido); o barril exporta o domínio novo", () => {
    expect(FAIXAS_DE_LOTACAO_UA_HA).toEqual(["sublotacao", "moderada", "ideal", "alta", "superlotacao", "sem_area_util"]);
    expect(SITUACOES_DO_PASTO).toEqual(["normal", "atencao", "critico", "em_descanso", "sem_registro"]);
    const dominios: [Parameters<typeof enumLabel>[0], readonly string[]][] = [
      ["modo_de_coloracao", MODOS_DE_COLORACAO],
      ["faixa_de_lotacao_ua_ha", FAIXAS_DE_LOTACAO_UA_HA],
      ["situacao_do_pasto", SITUACOES_DO_PASTO],
      ["faixa_de_categoria", ["sem_rebanho"]],
      ["identificador_do_lote", ["misto"]]
    ];
    expect(dominios).toHaveLength(5);
    let conferidos = 0;
    for (const [dominioDoRotulo, valores] of dominios) {
      for (const v of valores) {
        expect(hasEnumLabel(dominioDoRotulo, v), `${dominioDoRotulo}.${v}`).toBe(true);
        expect(enumLabel(dominioDoRotulo, v), `${dominioDoRotulo}.${v}`).not.toBe(UNKNOWN_VALUE);
        conferidos++;
      }
    }
    expect(conferidos).toBe(5 + 6 + 5 + 1 + 1);
    expect(dominio.resolverIconeDoLote).toBe(resolverIconeDoLote);
    expect(dominio.resolverIdentificadorDaArea).toBe(resolverIdentificadorDaArea);
    expect(dominio.centroideDePoligono).toBe(centroideDePoligono);
    expect(dominio.faixaDaArea).toBe(faixaDaArea);
  });
});
