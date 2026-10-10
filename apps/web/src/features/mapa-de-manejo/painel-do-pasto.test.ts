import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import { enumLabel } from "@agro/domain";

// O vitest do web não resolve o atalho `@/` (vitest.config.mts sem alias, ambiente node). Cada atalho aponta para o
// MESMO arquivo real — nenhum comportamento é trocado. Do barrel entram as primitives que o painel usa, pelos leaves
// que o próprio barrel reexporta (o barrel inteiro puxa a navegação do Next).
vi.mock("@/lib/utils", () => import("../../lib/utils"));
vi.mock("@/lib/copy", () => import("../../lib/copy"));
vi.mock("@/lib/api", () => import("../../lib/api"));
vi.mock("@/lib/auth", () => import("../../lib/auth"));
vi.mock("@/components/ui", async () => {
  const [botao, situacao] = await Promise.all([import("../../components/ui/button"), import("../../components/ui/status-badge")]);
  return { Button: botao.Button, buttonVariants: botao.buttonVariants, StatusBadge: situacao.StatusBadge };
});

import {
  CLASSES_DA_MOLDURA,
  CLASSES_DO_PAINEL,
  MolduraDoPainel,
  PainelDoPasto,
  fichaDaArea,
  nomeDoLote,
  objetosDaArea,
  textoDaCapacidade,
  textoDeCabecas,
  textoDeDias,
  textoDoDescanso,
  textoDoNumeroDaFaixa
} from "./painel-do-pasto";
import {
  ATRASO_DO_RESIZE_MS,
  CAMADA_AREAS,
  CAMADAS_DO_MARCADOR,
  TOLERANCIA_DO_MARCADOR_PX,
  areaDoClique,
  destacarSelecao,
  registrarSelecao,
  type FeatureDoClique
} from "./selecao-no-mapa";
import { campoEditavel, dentroDeDialogo, dialogoAberto, etapaDoEsc, tratarEsc, type EtapaDoEsc, type TeclaDoEsc } from "./use-esc-em-cascata";
import { ID_CONTORNO_ATUAL } from "./mapa-base";
import type { AreaOperacional, LoteNaArea, ObjetoDeMapa } from "./operacional-dados";

/**
 * MAPA-MANEJO-04 — CAMADA 2: o painel do pasto (um <aside>, não modal; só o que a API mandou), o clique que escolhe a
 * área (marcador antes do polígono; vazio → nenhuma) e o ESC em cascata (faixa → seleção → nada).
 */

const fonte = (f: string) => readFileSync(resolve(__dirname, f), "utf8");

const QUADRADO = { type: "Polygon" as const, coordinates: [[[-55, -15], [-55, -15.01], [-54.99, -15.01], [-54.99, -15], [-55, -15]]] };

function lote(id: string, extra: Partial<LoteNaArea> = {}): LoteNaArea {
  return {
    id: `oc-${id}`, lote: { id, code: `L-${id}`, description: `Lote ${id}` }, cabecas: 10, ua: "7.5", cabecas_na_entrada: 10,
    ua_na_entrada: "7.5", data_inicio: "2026-09-01", origem_da_data: "movimento", dias_de_ocupacao: 9, ...extra
  };
}

function area(id: string, extra: Partial<AreaOperacional> = {}): AreaOperacional {
  return {
    id, empresa_id: "e1", name: `Pasto ${id}`, code: `P-${id}`, color: null, area_ha: "12.5", usable_area_ha: "10", land_use: "pastagem",
    status: "ativa", geometria: QUADRADO, retiro_id: null, grazing_module_id: null, support_capacity_rainy_ua_ha: null,
    support_capacity_dry_ua_ha: null, max_stocking_ua: null, ocupada: false, lotes: [], cabecas_total: 0, ua_total: "0",
    ultima_saida: null, dias_de_descanso: null, ua_por_hectare: null, capacidade_da_estacao: null, situacao_de_lotacao: null,
    ultimo_manejo: null, ultima_pesagem: null, centroide: { lon: -54.995, lat: -15.005 }, identificador: null, icone: null, faixa: null,
    ...extra
  };
}

function objeto(id: string, areaId: string | null, extra: Partial<ObjetoDeMapa> = {}): ObjetoDeMapa {
  return {
    id, empresa_id: "e1", area_id: areaId, tipo: "cocho", forma: "ponto", geometria: { type: "Point", coordinates: [-54.995, -15.005] },
    code: null, name: `Objeto ${id}`, descricao: null, capacidade: null, unidade_capacidade: null, trough_id: null, is_active: true, ...extra
  };
}

const html = (a: AreaOperacional, objetos: ObjetoDeMapa[] = []) =>
  renderToStaticMarkup(React.createElement(PainelDoPasto, { area: a, objetos, aoFechar: () => undefined }));

const semTags = (markup: string) => markup.replace(/<[^>]+>/g, "");

/** Texto do elemento com aquele data-testid (os elementos do painel não aninham a própria tag). */
function textoDo(markup: string, testId: string): string | null {
  const m = new RegExp(`<(\\w+)[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</\\1>`).exec(markup);
  return m ? semTags(m[2] ?? "") : null;
}

const contar = (markup: string, trecho: string) => markup.split(trecho).length - 1;

describe("MM4 — painel do pasto: textos (só formatação do que a API mandou)", () => {
  it("descanso: null é 'Sem registro de ocupação', NUNCA '0 dias'; 0 é '0 dias'", () => {
    expect(textoDoDescanso(null)).toBe("Sem registro de ocupação");
    expect(textoDoDescanso(0)).toBe("0 dias");
    expect(textoDoDescanso(1)).toBe("1 dia");
    expect(textoDoDescanso(21)).toBe("21 dias");
    expect(textoDoDescanso(null)).not.toBe(textoDoDescanso(0));
  });

  it("dias e cabeças com singular e plural", () => {
    expect(textoDeDias(1)).toBe("1 dia");
    expect(textoDeDias(1200)).toBe("1.200 dias");
    expect(textoDeCabecas(1)).toBe("1 cabeça");
    expect(textoDeCabecas(150)).toBe("150 cabeças");
  });

  it("número da faixa com a unidade que a API mandou; sem número, nada", () => {
    expect(textoDoNumeroDaFaixa({ numero: "1.45", unidade: "ua_ha" })).toBe("1,45 UA/ha");
    expect(textoDoNumeroDaFaixa({ numero: 21, unidade: "dias" })).toBe("21 dias");
    expect(textoDoNumeroDaFaixa({ numero: 80, unidade: "cabecas" })).toBe("80 cabeças");
    expect(textoDoNumeroDaFaixa({ numero: null, unidade: null })).toBeNull();
  });

  it("nome do lote: código e descrição como vieram", () => {
    expect(nomeDoLote({ id: "1", code: "L-01", description: "Novilhas" })).toBe("L-01 · Novilhas");
    expect(nomeDoLote({ id: "1", code: "L-01", description: null })).toBe("L-01");
    expect(nomeDoLote({ id: "1", code: null, description: " " })).toBe("Lote sem código");
  });

  it("objetos: só os da área; capacidade com o rótulo da unidade do domínio", () => {
    const lista = [objeto("o1", "a1"), objeto("o2", "a2"), objeto("o3", null), objeto("o4", "a1")];
    expect(objetosDaArea(lista, "a1").map((o) => o.id)).toEqual(["o1", "o4"]);
    expect(textoDaCapacidade({ capacidade: "1000.000", unidade_capacidade: "kg" })).toBe(`1.000 ${enumLabel("unidade_capacidade_objeto_mapa", "kg")}`);
    expect(textoDaCapacidade({ capacidade: "2.5", unidade_capacidade: "t" })).toBe("2,5 toneladas");
    expect(textoDaCapacidade({ capacidade: null, unidade_capacidade: "m" })).toBeNull();
  });

  it("ficha da área: a rota real de detalhe dos cadastros", () => {
    expect(fichaDaArea("a1")).toBe("/cadastros/areas/a1");
  });
});

describe("MM4 — painel do pasto: forma e conteúdo renderizados", () => {
  const ocupada = area("a1", {
    ocupada: true,
    // Os números da API NÃO são a soma nem a divisão dos lotes abaixo: o painel mostra o que veio (prova que não recalcula).
    lotes: [lote("1", { cabecas: 60, ua: "45.5", dias_de_ocupacao: 12 }), lote("2", { cabecas: 45, ua: "30", dias_de_ocupacao: 3, origem_da_data: "criacao_do_lote" })],
    cabecas_total: 100,
    ua_total: "70.25",
    ua_por_hectare: "1.45",
    situacao_de_lotacao: "dentro",
    faixa: { chave: "ideal", rotulo: "Lotação ideal", numero: "1.45", unidade: "ua_ha" },
    icone: { config_id: null, categoria: null, icone_url: null, cor_padrao: null, categorias: ["BEZERRO", "VACA"] },
    ultimo_manejo: "2026-10-05",
    ultima_pesagem: "2026-09-28"
  });
  const objetos = [
    objeto("o1", "a1", { name: "Cocho norte", code: "C-1", capacidade: "12", unidade_capacidade: "m" }),
    objeto("o2", "a2", { name: "Cocho de outra área" }),
    objeto("o3", "a1", { name: "Depósito", tipo: "deposito_a_pasto", is_active: false })
  ];

  it("é um <aside> com aria-label 'Detalhe de <nome>' — não é modal", () => {
    const m = html(ocupada, objetos);
    expect(m.startsWith("<aside")).toBe(true);
    expect(m).toContain('aria-label="Detalhe de Pasto a1"');
    expect(m).toContain('data-testid="painel-do-pasto"');
    expect(m).not.toMatch(/role="(?:alert)?dialog"|aria-modal|fixed inset-0|bg-black\//);
  });

  it("bottom sheet no celular e lateral de 320 px em lg (classes do precedente do /mapa-geral)", () => {
    for (const c of ["max-h-[min(45dvh,22rem)]", "rounded-t-xl", "overflow-hidden", "lg:h-full", "lg:max-h-none", "lg:w-[320px]", "lg:shrink-0"]) {
      expect(CLASSES_DO_PAINEL.split(" ")).toContain(c);
    }
    expect(html(ocupada)).toContain(`class="${CLASSES_DO_PAINEL}"`);
    expect(html(ocupada)).toContain("overflow-y-auto overscroll-contain");
    for (const c of ["absolute", "inset-x-0", "bottom-0", "lg:static"]) expect(CLASSES_DA_MOLDURA.split(" ")).toContain(c);
    const moldura = renderToStaticMarkup(React.createElement(MolduraDoPainel, null, "x"));
    expect(moldura).toContain(`class="${CLASSES_DA_MOLDURA}"`);
    expect(moldura).not.toMatch(/fixed|role=/);
  });

  it("área ocupada: cabeças, UA, UA/ha e situação com os MESMOS valores da API", () => {
    const m = html(ocupada, objetos);
    expect(textoDo(m, "painel-cabecas")).toBe("100");
    expect(textoDo(m, "painel-ua")).toBe("70,25");
    expect(textoDo(m, "painel-ua-ha")).toBe("1,45");
    expect(textoDo(m, "painel-situacao-lotacao")).toBe(enumLabel("situacao_lotacao", "dentro"));
    expect(textoDo(m, "painel-faixa")).toBe("Lotação ideal · 1,45 UA/ha");
    expect(textoDo(m, "painel-area-total")).toBe("12,50 ha");
    expect(textoDo(m, "painel-area-pastejavel")).toBe("10,00 ha");
    expect(textoDo(m, "painel-codigo")).toBe("Código P-a1");
    expect(m).not.toContain('data-testid="painel-dias-descanso"');
  });

  it("sem situação de lotação calculada: 'Sem referência' (o domínio não deu referência)", () => {
    expect(textoDo(html({ ...ocupada, situacao_de_lotacao: null, ua_por_hectare: null }), "painel-situacao-lotacao")).toBe("Sem referência");
  });

  it("um item por lote, com nome, cabeças, UA e dias no piquete", () => {
    const m = html(ocupada, objetos);
    expect(contar(m, 'data-testid="painel-lote"')).toBe(2);
    expect(m).toContain("L-1 · Lote 1");
    expect(textoDo(m, "painel-lote-cabecas")).toBe("60 cabeças");
    expect(textoDo(m, "painel-lote-ua")).toBe("45,50 UA");
    expect(textoDo(m, "painel-lote-dias")).toBe("12 dias no piquete");
    expect(semTags(m)).toContain("3 dias no piquete");
    expect(m).toContain(enumLabel("origem_da_data_ocupacao", "criacao_do_lote"));
  });

  it("categorias da ÁREA (não por lote) só quando o ícone veio", () => {
    expect(textoDo(html(ocupada), "painel-categorias")).toBe("Categorias na área: BEZERRO, VACA");
    expect(html({ ...ocupada, icone: null })).not.toContain("painel-categorias");
  });

  it("último manejo e última pesagem quando vierem; objetos só desta área", () => {
    const m = html(ocupada, objetos);
    expect(textoDo(m, "painel-ultimo-manejo")).toBe("05/10/2026");
    expect(textoDo(m, "painel-ultima-pesagem")).toBe("28/09/2026");
    expect(contar(m, 'data-testid="painel-objeto"')).toBe(2);
    const texto = semTags(m);
    expect(texto).toContain("Cocho norte (C-1)");
    expect(texto).toContain(`${enumLabel("tipo_objeto_mapa", "cocho")} · 12 metros`);
    expect(texto).toContain(enumLabel("tipo_objeto_mapa", "deposito_a_pasto"));
    expect(texto).toContain("Depósito · inativo");
    expect(texto).not.toContain("Cocho de outra área");
    const semDatas = html({ ...ocupada, ultimo_manejo: null, ultima_pesagem: null });
    expect(semDatas).not.toContain("painel-ultimo-manejo");
    expect(semDatas).not.toContain("painel-ultima-pesagem");
  });

  it("Abrir cadastro e Fechar: link da ficha e botão com aria-label, alvo de toque no celular", () => {
    const m = html(ocupada);
    expect(m).toMatch(/<a href="\/cadastros\/areas\/a1"[^>]*data-testid="painel-abrir-cadastro"[^>]*>Abrir cadastro<\/a>/);
    expect(m).toMatch(/<button[^>]*aria-label="Fechar detalhe"[^>]*data-testid="painel-fechar"/);
    expect(contar(m, "!min-h-11 sm:!min-h-0")).toBe(2);
  });

  it("área VAZIA nunca ocupada: 'Sem registro de ocupação', não '0 dias'", () => {
    const m = html(area("v1", { dias_de_descanso: null }));
    expect(textoDo(m, "painel-dias-descanso")).toBe("Sem registro de ocupação");
    expect(semTags(m)).not.toContain("0 dias");
    expect(m).not.toContain('data-testid="painel-lote"');
    expect(m).not.toContain('data-testid="painel-lotacao"');
  });

  it("área VAZIA com descanso: os dias da API e a faixa de situação do pasto", () => {
    const vazia = area("v2", {
      dias_de_descanso: 21, ultima_saida: "2026-09-19",
      faixa: { chave: "em_descanso", rotulo: enumLabel("situacao_do_pasto", "em_descanso"), numero: 21, unidade: "dias" }
    });
    const m = html(vazia);
    expect(textoDo(m, "painel-dias-descanso")).toBe("21 dias");
    expect(textoDo(m, "painel-ultima-saida")).toBe("19/09/2026");
    expect(textoDo(m, "painel-faixa")).toBe(`${enumLabel("situacao_do_pasto", "em_descanso")} · 21 dias`);
    expect(textoDo(html(area("v3", { dias_de_descanso: 0 })), "painel-dias-descanso")).toBe("0 dias");
  });

  it("área pastejável não cadastrada: diz isso (nenhuma conta com a área)", () => {
    expect(textoDo(html(area("v4", { usable_area_ha: null })), "painel-area-pastejavel")).toBe("Não informada");
  });
});

/** Mapa falso: registra os eventos, responde `queryRenderedFeatures` pelas camadas pedidas e guarda o feature-state. */
class MapaFalso {
  eventos = new Map<string, Set<(e: unknown) => void>>();
  camadas = new Set<string>([CAMADA_AREAS, ...CAMADAS_DO_MARCADOR]);
  sobOPonto: Record<string, FeatureDoClique[]> = {};
  consultas: { alvo: unknown; camadas: string[] }[] = [];
  estados: { source: string; id: string; selecionada: unknown }[] = [];
  canvas = { style: { cursor: "" } };
  on(tipo: string, fn: (e: unknown) => void) {
    const lista = this.eventos.get(tipo) ?? new Set();
    lista.add(fn);
    this.eventos.set(tipo, lista);
    return this;
  }
  off(tipo: string, fn: (e: unknown) => void) { this.eventos.get(tipo)?.delete(fn); return this; }
  getLayer(id: string) { return this.camadas.has(id) ? { id } : undefined; }
  queryRenderedFeatures(alvo: unknown, opcoes: { layers: string[] }) {
    this.consultas.push({ alvo, camadas: opcoes.layers });
    return opcoes.layers.flatMap((c) => this.sobOPonto[c] ?? []);
  }
  getCanvas() { return this.canvas; }
  setFeatureState(alvo: { source: string; id: string }, estado: { selecionada: unknown }) {
    this.estados.push({ source: alvo.source, id: alvo.id, selecionada: estado.selecionada });
  }
  disparar(tipo: string, e: unknown = { point: { x: 100, y: 50 } }) { for (const fn of [...(this.eventos.get(tipo) ?? [])]) fn(e); }
  get total() { return [...this.eventos.values()].reduce((s, c) => s + c.size, 0); }
}
const comoMapa = (f: MapaFalso) => f as unknown as MapLibreMap;

describe("MM4 — clique no mapa escolhe a área do painel", () => {
  it("prioridade: marcador antes do polígono; o contorno da ficha não é área; vazio → null", () => {
    const marcador: FeatureDoClique = { properties: { area_id: "a-marcador" } };
    const poligono: FeatureDoClique = { id: "a-poligono", properties: { id: "a-poligono" } };
    expect(areaDoClique([marcador], [poligono])).toBe("a-marcador");
    expect(areaDoClique([], [poligono])).toBe("a-poligono");
    expect(areaDoClique([], [{ id: "so-id" }])).toBe("so-id");
    expect(areaDoClique([], [{ id: ID_CONTORNO_ATUAL, properties: { id: ID_CONTORNO_ATUAL } }])).toBeNull();
    expect(areaDoClique([{ properties: {} }], [])).toBeNull();
    expect(areaDoClique([], [])).toBeNull();
  });

  it("registrarSelecao: marcador → area_id; área vazia → id do polígono; nada → null; remove os eventos", () => {
    const f = new MapaFalso();
    const escolhas: (string | null)[] = [];
    const remover = registrarSelecao(comoMapa(f), (id) => escolhas.push(id));

    f.sobOPonto = { "lotes-icone": [{ properties: { area_id: "a1" } }], [CAMADA_AREAS]: [{ id: "a1", properties: { id: "a1" } }] };
    f.disparar("click");
    f.sobOPonto = { [CAMADA_AREAS]: [{ id: "v1", properties: { id: "v1" } }] };
    f.disparar("click");
    f.sobOPonto = {};
    f.disparar("click");
    expect(escolhas).toEqual(["a1", "v1", null]);

    // o marcador é consultado numa caixa de tolerância ao redor do toque; o polígono, no ponto exato
    const doMarcador = f.consultas.find((c) => c.camadas.includes("lotes-icone"));
    const t = TOLERANCIA_DO_MARCADOR_PX;
    expect(doMarcador?.alvo).toEqual([[100 - t, 50 - t], [100 + t, 50 + t]]);
    expect([...(doMarcador?.camadas ?? [])].sort()).toEqual(["lotes-badge", "lotes-fallback", "lotes-icone"]);
    expect(f.consultas.find((c) => c.camadas.includes(CAMADA_AREAS))?.alvo).toEqual([100, 50]);

    remover();
    expect(f.total).toBe(0);
    f.sobOPonto = { [CAMADA_AREAS]: [{ id: "v2", properties: { id: "v2" } }] };
    f.disparar("click");
    expect(escolhas).toEqual(["a1", "v1", null]);
  });

  it("camada que não existe não é consultada (o MapLibre reprovaria a consulta)", () => {
    const f = new MapaFalso();
    f.camadas = new Set([CAMADA_AREAS]);
    const escolhas: (string | null)[] = [];
    registrarSelecao(comoMapa(f), (id) => escolhas.push(id));
    f.sobOPonto = { [CAMADA_AREAS]: [{ id: "a9", properties: { id: "a9" } }] };
    f.disparar("click");
    expect(escolhas).toEqual(["a9"]);
    expect(f.consultas.length).toBeGreaterThan(0);
    expect(f.consultas.every((c) => c.camadas.every((id) => f.camadas.has(id)))).toBe(true);
  });

  it("cursor pointer sobre marcador ou área; volta ao sair e ao remover", () => {
    const f = new MapaFalso();
    const remover = registrarSelecao(comoMapa(f), () => undefined);
    f.sobOPonto = { "lotes-fallback": [{ properties: { area_id: "a1" } }] };
    f.disparar("mousemove");
    expect(f.canvas.style.cursor).toBe("pointer");
    f.sobOPonto = {};
    f.disparar("mousemove");
    expect(f.canvas.style.cursor).toBe("");
    f.sobOPonto = { [CAMADA_AREAS]: [{ id: "v1", properties: { id: "v1" } }] };
    f.disparar("mousemove");
    expect(f.canvas.style.cursor).toBe("pointer");
    f.disparar("mouseout", {});
    expect(f.canvas.style.cursor).toBe("");
    f.disparar("mousemove");
    expect(f.canvas.style.cursor).toBe("pointer");
    remover();
    expect(f.canvas.style.cursor).toBe("");
  });

  it("destacarSelecao: apaga o anterior e acende o atual pelo feature-state da fonte das áreas", () => {
    const f = new MapaFalso();
    destacarSelecao(comoMapa(f), null, "a1");
    destacarSelecao(comoMapa(f), "a1", "a2");
    destacarSelecao(comoMapa(f), "a2", "a2");
    destacarSelecao(comoMapa(f), "a2", null);
    expect(f.estados).toEqual([
      { source: "areas", id: "a1", selecionada: true },
      { source: "areas", id: "a1", selecionada: false },
      { source: "areas", id: "a2", selecionada: true },
      { source: "areas", id: "a2", selecionada: true },
      { source: "areas", id: "a2", selecionada: false }
    ]);
  });

  it("resize adiado ao abrir/fechar o painel: setTimeout + clearTimeout, como o /mapa-geral", () => {
    const s = fonte("selecao-no-mapa.ts");
    expect(ATRASO_DO_RESIZE_MS).toBe(80);
    expect(s).toContain("window.setTimeout(() => { m.resize(); }, ATRASO_DO_RESIZE_MS)");
    expect(s).toContain("return () => window.clearTimeout(t);");
  });
});

const tecla = (extra: Partial<TeclaDoEsc> = {}): TeclaDoEsc => ({ key: "Escape", defaultPrevented: false, isComposing: false, repeat: false, target: null, ...extra });
const docSemDialogo: Pick<Document, "querySelector"> = { querySelector: () => null };

describe("MM4 — ESC em cascata: faixa → seleção → nada", () => {
  function cascata() {
    const estado: { faixa: string | null; selecao: string | null } = { faixa: "ideal", selecao: "a1" };
    const etapas = (): EtapaDoEsc[] => [
      { ativo: estado.faixa !== null, desfazer: () => { estado.faixa = null; } },
      { ativo: estado.selecao !== null, desfazer: () => { estado.selecao = null; } }
    ];
    return { estado, etapas };
  }

  it("cada Escape desfaz só a primeira etapa ativa; nenhuma ativa → nada", () => {
    const { estado, etapas } = cascata();
    expect(tratarEsc(tecla(), etapas(), docSemDialogo)).toBe(true);
    expect(estado).toEqual({ faixa: null, selecao: "a1" });
    expect(tratarEsc(tecla(), etapas(), docSemDialogo)).toBe(true);
    expect(estado).toEqual({ faixa: null, selecao: null });
    expect(tratarEsc(tecla(), etapas(), docSemDialogo)).toBe(false);
    expect(etapaDoEsc(etapas())).toBeNull();
  });

  it("outra tecla, evento já tratado, composição ou repetição: nada", () => {
    for (const e of [tecla({ key: "Enter" }), tecla({ defaultPrevented: true }), tecla({ isComposing: true }), tecla({ repeat: true })]) {
      const { estado, etapas } = cascata();
      expect(tratarEsc(e, etapas(), docSemDialogo)).toBe(false);
      expect(estado).toEqual({ faixa: "ideal", selecao: "a1" });
    }
  });

  it("foco em campo editável: o Escape é do campo", () => {
    const alvo = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;
    expect(campoEditavel(alvo("INPUT"))).toBe(true);
    expect(campoEditavel(alvo("INPUT", { type: "search" }))).toBe(true);
    expect(campoEditavel(alvo("TEXTAREA"))).toBe(true);
    expect(campoEditavel(alvo("SELECT"))).toBe(true);
    expect(campoEditavel(alvo("DIV", { isContentEditable: true }))).toBe(true);
    expect(campoEditavel(alvo("INPUT", { type: "checkbox" }))).toBe(false);
    expect(campoEditavel(alvo("BUTTON"))).toBe(false);
    expect(campoEditavel(null)).toBe(false);
    const { estado, etapas } = cascata();
    expect(tratarEsc(tecla({ target: alvo("INPUT", { type: "text" }) }), etapas(), docSemDialogo)).toBe(false);
    expect(estado.faixa).toBe("ideal");
    expect(tratarEsc(tecla({ target: alvo("BUTTON") }), etapas(), docSemDialogo)).toBe(true);
    expect(estado.faixa).toBeNull();
  });

  it("diálogo aberto (ou foco dentro de um): o Dialog do barrel trata o próprio ESC", () => {
    const seletores: string[] = [];
    const docComDialogo: Pick<Document, "querySelector"> = {
      querySelector: ((s: string) => { seletores.push(s); return {}; }) as unknown as Document["querySelector"]
    };
    expect(dialogoAberto(docComDialogo)).toBe(true);
    expect(seletores[0]).toContain("[role=dialog][data-state=open]");
    expect(dialogoAberto(docSemDialogo)).toBe(false);
    const dentro = { tagName: "BUTTON", closest: (s: string) => (s.includes("[role=dialog]") ? {} : null) } as unknown as EventTarget;
    expect(dentroDeDialogo(dentro)).toBe(true);
    const { estado, etapas } = cascata();
    expect(tratarEsc(tecla(), etapas(), docComDialogo)).toBe(false);
    expect(tratarEsc(tecla({ target: dentro }), etapas(), docSemDialogo)).toBe(false);
    expect(estado).toEqual({ faixa: "ideal", selecao: "a1" });
  });

  it("o hook escuta o keydown da janela e remove ao desmontar", () => {
    const s = fonte("use-esc-em-cascata.ts");
    expect(s).toContain('window.addEventListener("keydown", aoTeclar)');
    expect(s).toContain('window.removeEventListener("keydown", aoTeclar)');
  });
});

describe("MM4 — a tela desenha, não decide (CAMADA 2)", () => {
  it("o painel é <aside> e não traz overlay manual nem Dialog/Drawer", () => {
    const s = fonte("painel-do-pasto.tsx");
    expect(s).toContain("<aside");
    expect(s).not.toMatch(/role="(?:alert)?dialog"|aria-modal|fixed inset-0|bg-black\/|<Dialog\b|<Drawer\b/);
  });

  it("nenhuma conta de data nos arquivos da camada 2 (os dias vêm prontos da API)", () => {
    for (const f of ["painel-do-pasto.tsx", "selecao-no-mapa.ts", "use-esc-em-cascata.ts"]) {
      expect(fonte(f), f).not.toMatch(/new Date\(|Date\.now|Date\.parse|getTime\(|\.valueOf\(\)/);
    }
  });
});
