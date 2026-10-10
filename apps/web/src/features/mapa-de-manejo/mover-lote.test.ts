import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Polygon } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";

// O vitest do web não resolve o atalho `@/` (vitest.config.mts sem alias, ambiente node). mover-lote.ts usa a seleção
// (selecao-no-mapa.ts → mapa-base.tsx), que importa estes três: cada atalho aponta para o MESMO arquivo real. Do barrel
// entra só o Button do interruptor, pelo leaf que o próprio barrel reexporta (o barrel inteiro puxa a navegação do Next).
vi.mock("@/lib/utils", () => import("../../lib/utils"));
vi.mock("@/lib/api", () => import("../../lib/api"));
vi.mock("@/lib/auth", () => import("../../lib/auth"));
vi.mock("@/components/ui", async () => {
  const botao = await import("../../components/ui/button");
  return { Button: botao.Button };
});

import {
  CHAVE_DO_ARRASTE,
  InterruptorDeArraste,
  PERMISSAO_DE_MOVER,
  gravarArrasteLigado,
  lerArrasteLigado
} from "./interruptor-de-arraste";

import { CAMADAS_DE_LOTES, FONTE_LOTES } from "./camada-lotes";
import {
  CAMADAS_DO_ARRASTADO,
  FONTE_ARRASTADO,
  LIMIAR_DO_ARRASTE_PX,
  instalarCamadaDoArrastado,
  registrarArraste,
  resultadoDaSoltura,
  textoDoAviso,
  type ResultadoDoArraste
} from "./mover-lote";
import type { AreaOperacional, LoteNaArea } from "./operacional-dados";

/**
 * MAPA-MANEJO-04 — o arraste do lote no mapa ESCOLHE o destino e não grava nada: desligado não reage; soltar na
 * própria área, fora de qualquer área ou fora do mapa avisa; soltar em outra área devolve origem e destino; o pan do
 * mapa fica desligado só durante o gesto; o marcador arrastado vive numa fonte própria, e a fonte `lotes` nunca é mexida.
 *
 * Mapa falso: 1 px = 0,1 grau (lon = x/10, lat = y/10), canvas de 800 × 600 em (0, 0).
 */

/** A caixa em px de cada área (o polígono é a mesma caixa em graus): o `areas-fill` falso responde por ela. */
const CAIXAS = new Map<string, [number, number, number, number]>();

const quadrado = (id: string, x0: number, y0: number, x1: number, y1: number): Polygon => {
  CAIXAS.set(id, [x0, y0, x1, y1]);
  return {
    type: "Polygon",
    coordinates: [[[x0 / 10, y0 / 10], [x1 / 10, y0 / 10], [x1 / 10, y1 / 10], [x0 / 10, y1 / 10], [x0 / 10, y0 / 10]]]
  };
};

function lote(id: string, cabecas: number): LoteNaArea {
  return {
    id: `oc-${id}`,
    lote: { id, code: id.toUpperCase(), description: null },
    cabecas,
    ua: "1",
    cabecas_na_entrada: null,
    ua_na_entrada: null,
    data_inicio: "2026-01-01",
    origem_da_data: "movimento",
    dias_de_ocupacao: 3
  };
}

function area(id: string, geometria: Polygon | null, lotes: LoteNaArea[], centro: { x: number; y: number }): AreaOperacional {
  return {
    id, empresa_id: "e1", name: `Pasto ${id}`, code: id, color: null, area_ha: "10", usable_area_ha: null, land_use: "pasture",
    status: "active", geometria, retiro_id: null, grazing_module_id: null, support_capacity_rainy_ua_ha: null,
    support_capacity_dry_ua_ha: null, max_stocking_ua: null, ocupada: lotes.length > 0, lotes,
    cabecas_total: lotes.reduce((s, l) => s + l.cabecas, 0), ua_total: "1", ultima_saida: null, dias_de_descanso: null,
    ua_por_hectare: null, capacidade_da_estacao: null, situacao_de_lotacao: null, ultimo_manejo: null, ultima_pesagem: null,
    centroide: { lon: centro.x / 10, lat: centro.y / 10 }, identificador: null, icone: null, faixa: null
  };
}

/** A (100,100) e B (400,100) ocupadas; C (100,400) com dois lotes; D (650,100) vazia; nada em (250,250). */
const A = area("a", quadrado("a", 50, 50, 150, 150), [lote("l1", 10)], { x: 100, y: 100 });
const B = area("b", quadrado("b", 350, 50, 450, 150), [lote("l2", 20)], { x: 400, y: 100 });
const C = area("c", quadrado("c", 50, 350, 150, 450), [lote("l3", 5), lote("l4", 7)], { x: 100, y: 400 });
const D = area("d", quadrado("d", 600, 50, 700, 150), [], { x: 650, y: 100 });
const AREAS = [A, B, C, D];
const MARCADORES = [A, B, C].map((a) => ({ areaId: a.id, x: (a.centroide?.lon ?? 0) * 10, y: (a.centroide?.lat ?? 0) * 10 }));

type Ponto = { x: number; y: number };
type Caixa = [[number, number], [number, number]] | [number, number];
type Ouvinte = (e: unknown) => void;

function criarMapa(opcoes: { panLigado?: boolean; overlay?: (x: number, y: number) => boolean } = {}) {
  const ouvintes = new Map<string, Set<Ouvinte>>();
  const camadas: string[] = ["areas-fill", ...CAMADAS_DE_LOTES];
  const fontes = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  fontes.set(FONTE_LOTES, { setData: vi.fn() });
  fontes.set("areas", { setData: vi.fn() });
  const estados: { id: string; hover: boolean }[] = [];
  let panLigado = opcoes.panLigado ?? true;
  const dragPan = {
    isEnabled: () => panLigado,
    enable: vi.fn(() => { panLigado = true; }),
    disable: vi.fn(() => { panLigado = false; })
  };
  const janela = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    defaultView: janela,
    elementFromPoint: (x: number, y: number) => {
      if (x < 0 || y < 0 || x > 800 || y > 600) return null;
      return opcoes.overlay?.(x, y) ? { tagName: "ASIDE" } : canvas;
    }
  });
  const canvas = {
    style: { cursor: "" },
    ownerDocument: doc,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
  };
  const naCaixa = (alvo: Caixa, p: Ponto) => {
    if (typeof alvo[0] === "number") return alvo[0] === p.x && alvo[1] === p.y;
    const [[x0, y0], [x1, y1]] = alvo as [[number, number], [number, number]];
    return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  };
  const m = {
    on: (tipo: string, fn: Ouvinte) => { if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set()); ouvintes.get(tipo)?.add(fn); },
    off: (tipo: string, fn: Ouvinte) => { ouvintes.get(tipo)?.delete(fn); },
    getCanvas: () => canvas,
    getLayer: (id: string) => (camadas.includes(id) ? { id } : undefined),
    addLayer: vi.fn((c: { id: string }, antes?: string) => {
      if (antes !== undefined) camadas.splice(camadas.indexOf(antes), 0, c.id);
      else camadas.push(c.id);
    }),
    getSource: (id: string) => fontes.get(id),
    addSource: vi.fn((id: string) => { fontes.set(id, { setData: vi.fn() }); }),
    setFeatureState: (alvo: { id: string }, estado: { hover: boolean }) => { estados.push({ id: alvo.id, hover: estado.hover }); },
    unproject: ([x, y]: [number, number]) => ({ lng: x / 10, lat: y / 10 }),
    queryRenderedFeatures: (alvo: Caixa, op: { layers: string[] }) => {
      const achados: { id?: string; properties: Record<string, unknown> }[] = [];
      if (op.layers.some((l) => (CAMADAS_DE_LOTES as readonly string[]).includes(l))) {
        for (const mk of MARCADORES) {
          if (naCaixa(alvo, mk)) achados.push({ properties: { area_id: mk.areaId, cabecas: 1, icone_pronto: false, icone_id: "", escala: 0, cor_padrao: "" } });
        }
      }
      if (op.layers.includes("areas-fill") && typeof alvo[0] === "number") {
        const p = { x: alvo[0], y: alvo[1] as number };
        for (const [id, [x0, y0, x1, y1]] of CAIXAS) {
          if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) achados.push({ id, properties: { id } });
        }
      }
      return achados;
    },
    dragPan
  };
  const disparar = (tipo: string, e: unknown) => { for (const fn of [...(ouvintes.get(tipo) ?? [])]) fn(e); };
  const eventoDoMapa = (p: Ponto, extra: Record<string, unknown> = {}) => ({ point: p, points: [p], preventDefault: vi.fn(), ...extra });
  return {
    mapa: m as unknown as MapLibreMap,
    canvas,
    doc,
    janela,
    dragPan,
    estados,
    fontes,
    camadas,
    ouvintes: (tipo: string) => ouvintes.get(tipo)?.size ?? 0,
    /** mouse: pressiona (evento do mapa), move e solta (no documento) */
    pressionar: (p: Ponto, botao = 0) => {
      const original = { button: botao, preventDefault: vi.fn() };
      const ev = eventoDoMapa(p, { originalEvent: original });
      disparar("mousedown", ev);
      return ev;
    },
    moverMouse: (p: Ponto) => { doc.dispatchEvent(Object.assign(new Event("mousemove"), { clientX: p.x, clientY: p.y })); },
    soltarMouse: (p: Ponto) => { doc.dispatchEvent(Object.assign(new Event("mouseup"), { clientX: p.x, clientY: p.y, button: 0 })); },
    passar: (p: Ponto) => { disparar("mousemove", eventoDoMapa(p)); },
    tocar: (pontos: Ponto[]) => {
      const p = pontos[0] ?? { x: 0, y: 0 };
      const ev = { point: p, points: pontos, preventDefault: vi.fn() };
      disparar("touchstart", ev);
      return ev;
    },
    moverDedo: (p: Ponto) => {
      const ev = Object.assign(new Event("touchmove", { cancelable: true }), { touches: [{ clientX: p.x, clientY: p.y }] });
      doc.dispatchEvent(ev);
      return ev;
    },
    soltarDedo: (p: Ponto) => { doc.dispatchEvent(Object.assign(new Event("touchend"), { touches: [], changedTouches: [{ clientX: p.x, clientY: p.y }] })); },
    teclar: (key: string) => {
      const ev = Object.assign(new Event("keydown", { cancelable: true }), { key });
      doc.dispatchEvent(ev);
      return ev;
    }
  };
}

function registrar(f: ReturnType<typeof criarMapa>, ligado = true) {
  const soltos: ResultadoDoArraste[] = [];
  const remover = registrarArraste(f.mapa, { ligado: () => ligado, areas: () => AREAS, aoSoltar: (r) => soltos.push(r) });
  return { soltos, remover };
}

/** Arrasta com o mouse de `de` até `ate`, passando pelo meio. */
function arrastar(f: ReturnType<typeof criarMapa>, de: Ponto, ate: Ponto) {
  const ev = f.pressionar(de);
  f.moverMouse({ x: (de.x + ate.x) / 2, y: (de.y + ate.y) / 2 });
  f.moverMouse(ate);
  f.soltarMouse(ate);
  return ev;
}

const setDataDe = (f: ReturnType<typeof criarMapa>, fonte: string) => f.fontes.get(fonte)?.setData.mock.calls ?? [];

describe("MM4-5 — arraste do lote: o gesto escolhe, não grava", () => {
  it("DESLIGADO: pressionar e arrastar sobre o marcador não faz nada (o pan do mapa segue normal)", () => {
    const f = criarMapa();
    const { soltos } = registrar(f, false);
    const ev = arrastar(f, { x: 100, y: 100 }, { x: 400, y: 100 });
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(f.dragPan.disable).not.toHaveBeenCalled();
    expect(soltos).toEqual([]);
    expect(setDataDe(f, FONTE_ARRASTADO)).toEqual([]);
  });

  it("soltar em OUTRA área: devolve origem e destino; o pan fica desligado só durante o gesto", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    const ev = f.pressionar({ x: 100, y: 100 });
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(f.dragPan.isEnabled()).toBe(false);
    f.moverMouse({ x: 250, y: 100 });
    expect(f.canvas.style.cursor).toBe("grabbing");
    f.moverMouse({ x: 400, y: 100 });
    f.soltarMouse({ x: 400, y: 100 });
    expect(soltos).toEqual([{ tipo: "destino", origem: A, destino: B }]);
    expect(f.dragPan.isEnabled()).toBe(true);
    // soltou em cima do marcador de B, com o arraste ligado: o cursor volta a "grab", não fica "grabbing"
    expect(f.canvas.style.cursor).toBe("grab");
  });

  it("a fonte `lotes` NUNCA é mexida; o arrastado acompanha o ponteiro na fonte própria e esvazia no fim", () => {
    const f = criarMapa();
    registrar(f);
    arrastar(f, { x: 100, y: 100 }, { x: 400, y: 100 });
    expect(setDataDe(f, FONTE_LOTES)).toEqual([]);
    const chamadas = setDataDe(f, FONTE_ARRASTADO);
    expect(chamadas.length).toBe(3); // dois movimentos + a limpeza
    expect(chamadas[1]?.[0]).toMatchObject({ features: [{ geometry: { type: "Point", coordinates: [40, 10] }, properties: { area_id: "a" } }] });
    expect(chamadas.at(-1)?.[0]).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("o destino em vista ganha o contorno de destaque (hover), a origem não; no fim ele apaga", () => {
    const f = criarMapa();
    registrar(f);
    arrastar(f, { x: 100, y: 100 }, { x: 400, y: 100 });
    expect(f.estados).toEqual([{ id: "b", hover: true }, { id: "b", hover: false }]);
  });

  it("soltar na PRÓPRIA área: mesma-area, com o aviso", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    arrastar(f, { x: 100, y: 100 }, { x: 130, y: 130 });
    expect(soltos).toEqual([{ tipo: "mesma-area", origem: A }]);
    expect(textoDoAviso(soltos[0] as ResultadoDoArraste)).toBe("Arraste para outra área: o lote continua em Pasto a.");
  });

  it("soltar FORA de qualquer polígono: fora, com o aviso", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    arrastar(f, { x: 100, y: 100 }, { x: 250, y: 250 });
    expect(soltos).toEqual([{ tipo: "fora", origem: A }]);
    expect(textoDoAviso(soltos[0] as ResultadoDoArraste)).toMatch(/^Solte o lote sobre uma área do mapa/);
  });

  it("soltar sobre algo por cima do mapa (painel, barra) ou fora do canvas: fora, mesmo que embaixo houvesse área", () => {
    const f = criarMapa({ overlay: (x) => x > 300 });
    const { soltos } = registrar(f);
    arrastar(f, { x: 100, y: 100 }, { x: 400, y: 100 });
    arrastar(f, { x: 100, y: 100 }, { x: 900, y: 100 });
    expect(soltos).toEqual([{ tipo: "fora", origem: A }, { tipo: "fora", origem: A }]);
  });

  it("área VAZIA (sem lote) também é destino; o lote da área com dois lotes sai com a origem inteira", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    arrastar(f, { x: 100, y: 400 }, { x: 650, y: 100 });
    expect(soltos).toEqual([{ tipo: "destino", origem: C, destino: D }]);
    // soltou sobre o polígono de D, sem marcador: o cursor volta ao da seleção
    expect(f.canvas.style.cursor).toBe("pointer");
  });

  it("movimento abaixo do limiar é CLIQUE: nada é reportado (o painel cuida) e o pan volta", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    f.pressionar({ x: 100, y: 100 });
    f.moverMouse({ x: 100 + LIMIAR_DO_ARRASTE_PX.mouse - 1, y: 100 });
    f.soltarMouse({ x: 100 + LIMIAR_DO_ARRASTE_PX.mouse - 1, y: 100 });
    expect(soltos).toEqual([]);
    expect(setDataDe(f, FONTE_ARRASTADO)).toEqual([]);
    expect(f.dragPan.isEnabled()).toBe(true);
  });

  it("pressionar FORA do marcador (polígono ou vazio) não começa arraste: o pan do mapa segue", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    const ev = arrastar(f, { x: 130, y: 60 }, { x: 400, y: 100 });
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(f.dragPan.disable).not.toHaveBeenCalled();
    expect(soltos).toEqual([]);
  });

  it("botão do meio/direito não arrasta", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    const ev = f.pressionar({ x: 100, y: 100 }, 2);
    f.moverMouse({ x: 400, y: 100 });
    f.soltarMouse({ x: 400, y: 100 });
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(soltos).toEqual([]);
  });

  it("pan já desligado por outro motivo: o arraste não o religa", () => {
    const f = criarMapa({ panLigado: false });
    registrar(f);
    arrastar(f, { x: 100, y: 100 }, { x: 400, y: 100 });
    expect(f.dragPan.enable).not.toHaveBeenCalled();
  });

  it("Escape no meio do arraste cancela sem resultado e não chega à cascata do ESC (evento marcado)", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    f.pressionar({ x: 100, y: 100 });
    f.moverMouse({ x: 400, y: 100 });
    const esc = f.teclar("Escape");
    f.soltarMouse({ x: 400, y: 100 });
    expect(esc.defaultPrevented).toBe(true);
    expect(soltos).toEqual([]);
    expect(f.dragPan.isEnabled()).toBe(true);
    expect(setDataDe(f, FONTE_ARRASTADO).at(-1)?.[0]).toEqual({ type: "FeatureCollection", features: [] });
    expect(f.canvas.style.cursor).toBe("");
    // fora do arraste, o Escape não é deste arquivo
    expect(f.teclar("Escape").defaultPrevented).toBe(false);
  });

  it("janela perdendo o foco cancela o arraste", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    f.pressionar({ x: 100, y: 100 });
    f.moverMouse({ x: 400, y: 100 });
    f.janela.dispatchEvent(new Event("blur"));
    f.soltarMouse({ x: 400, y: 100 });
    expect(soltos).toEqual([]);
    expect(f.dragPan.isEnabled()).toBe(true);
  });

  it("TOQUE: um dedo arrasta até outra área; a página não rola durante o arraste", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    const ev = f.tocar([{ x: 400, y: 100 }]);
    expect(ev.preventDefault).toHaveBeenCalled();
    const mov = f.moverDedo({ x: 250, y: 100 });
    expect(mov.defaultPrevented).toBe(true);
    f.moverDedo({ x: 100, y: 100 });
    f.soltarDedo({ x: 100, y: 100 });
    expect(soltos).toEqual([{ tipo: "destino", origem: B, destino: A }]);
    expect(f.dragPan.isEnabled()).toBe(true);
  });

  it("TOQUE: tremor abaixo do limiar do dedo é toque (painel), não arraste", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    f.tocar([{ x: 100, y: 100 }]);
    f.moverDedo({ x: 100 + LIMIAR_DO_ARRASTE_PX.toque - 1, y: 100 });
    f.soltarDedo({ x: 100 + LIMIAR_DO_ARRASTE_PX.toque - 1, y: 100 });
    expect(soltos).toEqual([]);
  });

  it("TOQUE: segundo dedo é pinça (zoom) — cancela o arraste sem resultado", () => {
    const f = criarMapa();
    const { soltos } = registrar(f);
    f.tocar([{ x: 100, y: 100 }]);
    f.moverDedo({ x: 250, y: 100 });
    const pinca = f.tocar([{ x: 250, y: 100 }, { x: 300, y: 300 }]);
    f.soltarDedo({ x: 400, y: 100 });
    expect(pinca.preventDefault).not.toHaveBeenCalled();
    expect(soltos).toEqual([]);
    expect(f.dragPan.isEnabled()).toBe(true);
  });

  it("cursor: grab sobre o marcador só LIGADO; ao sair, o da seleção (pointer na área, vazio fora)", () => {
    const desligado = criarMapa();
    registrar(desligado, false);
    desligado.passar({ x: 100, y: 100 });
    expect(desligado.canvas.style.cursor).toBe("");

    const f = criarMapa();
    registrar(f);
    f.passar({ x: 100, y: 100 });
    expect(f.canvas.style.cursor).toBe("grab");
    f.passar({ x: 140, y: 140 });
    expect(f.canvas.style.cursor).toBe("pointer");
    f.passar({ x: 100, y: 100 });
    f.passar({ x: 250, y: 250 });
    expect(f.canvas.style.cursor).toBe("");
  });

  it("remover: tira os ouvintes do mapa; depois disso nada reage", () => {
    const f = criarMapa();
    const { soltos, remover } = registrar(f);
    remover();
    for (const tipo of ["mousedown", "touchstart", "mousemove", "mouseout"]) expect(f.ouvintes(tipo)).toBe(0);
    arrastar(f, { x: 100, y: 100 }, { x: 400, y: 100 });
    expect(soltos).toEqual([]);
  });
});

describe("MM4-5 — camadas do arrastado", () => {
  it("instalação idempotente, no TOPO da pilha (acima dos lotes)", () => {
    const f = criarMapa();
    instalarCamadaDoArrastado(f.mapa);
    instalarCamadaDoArrastado(f.mapa);
    registrar(f);
    expect((f.mapa.addSource as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(f.camadas.slice(-CAMADAS_DO_ARRASTADO.length)).toEqual([...CAMADAS_DO_ARRASTADO]);
    expect(f.camadas.indexOf(CAMADAS_DO_ARRASTADO[0])).toBeGreaterThan(Math.max(...CAMADAS_DE_LOTES.map((c) => f.camadas.indexOf(c))));
  });
});

describe("MM4-5 — resultadoDaSoltura e textoDoAviso (puros)", () => {
  it("outra área → destino; a própria → mesma-area; nenhuma ou ponto nulo → fora", () => {
    expect(resultadoDaSoltura("a", { lon: 40, lat: 10 }, AREAS)).toEqual({ tipo: "destino", origem: A, destino: B });
    expect(resultadoDaSoltura("a", { lon: 10, lat: 10 }, AREAS)).toEqual({ tipo: "mesma-area", origem: A });
    expect(resultadoDaSoltura("a", { lon: 25, lat: 25 }, AREAS)).toEqual({ tipo: "fora", origem: A });
    expect(resultadoDaSoltura("a", null, AREAS)).toEqual({ tipo: "fora", origem: A });
  });

  it("origem que saiu da resposta (refetch no meio do gesto): nada a reportar", () => {
    expect(resultadoDaSoltura("sumiu", { lon: 40, lat: 10 }, AREAS)).toBeNull();
  });

  it("destino não tem aviso; os outros dois têm", () => {
    expect(textoDoAviso({ tipo: "destino", origem: A, destino: B })).toBeNull();
    expect(textoDoAviso({ tipo: "mesma-area", origem: A })).toContain("Arraste para outra área");
    expect(textoDoAviso({ tipo: "fora", origem: A })).toContain("fora de qualquer área nada é movido");
  });
});

describe("MM4-5a/5b — o interruptor do arraste", () => {
  const storage = (valor: string | null) => ({ getItem: vi.fn(() => valor), setItem: vi.fn() });

  it("nasce DESLIGADO: sem storage, sem valor, valor estranho ou storage que lança", () => {
    expect(lerArrasteLigado(null)).toBe(false);
    expect(lerArrasteLigado(undefined)).toBe(false);
    expect(lerArrasteLigado(storage(null))).toBe(false);
    expect(lerArrasteLigado(storage("1"))).toBe(false);
    expect(lerArrasteLigado(storage("false"))).toBe(false);
    expect(lerArrasteLigado({ getItem: () => { throw new Error("bloqueado"); } })).toBe(false);
  });

  it("liga só com o valor guardado exato, na chave estável", () => {
    const s = storage("true");
    expect(lerArrasteLigado(s)).toBe(true);
    expect(s.getItem).toHaveBeenCalledWith(CHAVE_DO_ARRASTE);
    expect(CHAVE_DO_ARRASTE).toBe("mapa-manejo.arraste-ligado");
  });

  it("guarda a escolha; storage que lança não derruba a tela", () => {
    const s = storage(null);
    gravarArrasteLigado(s, true);
    gravarArrasteLigado(s, false);
    expect(s.setItem.mock.calls).toEqual([[CHAVE_DO_ARRASTE, "true"], [CHAVE_DO_ARRASTE, "false"]]);
    expect(() => gravarArrasteLigado({ setItem: () => { throw new Error("cota"); } }, true)).not.toThrow();
    expect(() => gravarArrasteLigado(null, true)).not.toThrow();
  });

  it("controle explícito: aria-pressed marca o estado, com o texto e o testid; alvo de toque de 44 px", () => {
    const desligado = renderToStaticMarkup(React.createElement(InterruptorDeArraste, { ligado: false, aoMudar: () => undefined }));
    expect(desligado).toContain('aria-pressed="false"');
    expect(desligado).toContain('data-testid="interruptor-arraste"');
    expect(desligado).toContain('data-ligado="nao"');
    expect(desligado).toContain("Mover lote no mapa");
    expect(desligado).toContain("!min-h-11 sm:!min-h-0");
    const ligado = renderToStaticMarkup(React.createElement(InterruptorDeArraste, { ligado: true, aoMudar: () => undefined }));
    expect(ligado).toContain('aria-pressed="true"');
    expect(ligado).toContain('data-ligado="sim"');
  });

  it("a capacidade que mostra o interruptor é a de criar a transferência (a mesma da Pecuária)", () => {
    expect(PERMISSAO_DE_MOVER).toBe("batch_module_area_transfer.create");
  });
});
