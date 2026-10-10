import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  CAMADAS_DE_LOTES,
  CAMADAS_DE_OBJETOS,
  COR_DO_MISTO,
  FONTE_LOTES,
  FONTE_OBJETOS,
  IMAGEM_FUNDO_DO_BADGE,
  SIGLA_DO_MISTO,
  aspectoDaImagem,
  circuloSdf,
  featuresDeLotes,
  featuresDeObjetos,
  instalarCamadasDeLotes,
  mostrarGrupo,
  siglaCurta,
  sincronizarLotes
} from "./camada-lotes";
import { escalaUnitaria, paresDeIcones, registrarImagensDosIcones, tamanhoExibido } from "./imagens-do-mapa";
import type { AreaOperacional, LoteNaArea, ObjetoDeMapa, RespostaOperacional } from "./operacional-dados";

/**
 * MAPA-MANEJO-04 — a fonte do marcador agregado (um ponto por ÁREA ocupada, no centróide da API), a sincronização
 * sem setData repetido, a instalação idempotente e o registro das imagens (cache, proporção, falha isolada).
 */

const QUADRADO = { type: "Polygon" as const, coordinates: [[[-55, -15], [-55, -15.01], [-54.99, -15.01], [-54.99, -15], [-55, -15]]] };

function lote(id: string, cabecas: number): LoteNaArea {
  return {
    id: `oc-${id}`, lote: { id, code: id, description: `Lote ${id}` }, cabecas, ua: String(cabecas), cabecas_na_entrada: cabecas,
    ua_na_entrada: String(cabecas), data_inicio: "2026-09-01", origem_da_data: "movimento", dias_de_ocupacao: 9
  };
}

function area(id: string, extra: Partial<AreaOperacional> = {}): AreaOperacional {
  return {
    id, empresa_id: "e1", name: `Área ${id}`, code: id, color: null, area_ha: "10", usable_area_ha: "10", land_use: "pastagem", status: "ativa",
    geometria: QUADRADO, retiro_id: null, grazing_module_id: null, support_capacity_rainy_ua_ha: null, support_capacity_dry_ua_ha: null,
    max_stocking_ua: null, ocupada: false, lotes: [], cabecas_total: 0, ua_total: "0.00", ultima_saida: null, dias_de_descanso: null,
    ua_por_hectare: null, capacidade_da_estacao: null, situacao_de_lotacao: null, ultimo_manejo: null, ultima_pesagem: null,
    centroide: { lon: -54.995, lat: -15.005 }, identificador: null, icone: null, faixa: null, ...extra
  };
}

const ocupada = (id: string, lotes: LoteNaArea[], extra: Partial<AreaOperacional> = {}) =>
  area(id, { ocupada: true, lotes, cabecas_total: lotes.reduce((s, l) => s + l.cabecas, 0), ...extra });

function resposta(areas: AreaOperacional[], objetos: ObjetoDeMapa[] = []): RespostaOperacional {
  return {
    hoje: "2026-09-10", estacao: "seca", coloracao: "padrao", capacidades: { objetos: true, manejo: true, pesagem: true, icones: true },
    areas, objetos
  };
}

const icone = (configId: string | null, url: string | null, cor: string | null = null) =>
  ({ config_id: configId, categoria: configId ? "BOI" : null, icone_url: url, cor_padrao: cor, categorias: ["BOI"] });

const nenhumaImagem = () => null;

/** Mapa simulado com só o que a camada e o registro de imagens usam; cada chamada fica no diário. */
function mapaFalso(cargas: Record<string, () => Promise<{ data: { width: number; height: number } }>> = {}) {
  const diario: string[] = [];
  const fontes = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const camadas: string[] = [];
  const layout = new Map<string, Record<string, unknown>>();
  const imagens = new Map<string, unknown>();
  const loadImage = vi.fn((url: string) => {
    diario.push(`load ${url}`);
    const c = cargas[url];
    return c ? c() : Promise.reject(new Error(`sem carga para ${url}`));
  });
  const m = {
    getSource: (id: string) => fontes.get(id),
    addSource: (id: string) => { diario.push(`addSource ${id}`); fontes.set(id, { setData: vi.fn() }); },
    getLayer: (id: string) => (camadas.includes(id) ? { id } : undefined),
    addLayer: (c: { id: string }, antes?: string) => {
      diario.push(`addLayer ${c.id}`);
      const i = antes ? camadas.indexOf(antes) : -1;
      if (i >= 0) camadas.splice(i, 0, c.id); else camadas.push(c.id);
      layout.set(c.id, {});
    },
    setLayoutProperty: (id: string, k: string, v: unknown) => { layout.get(id)![k] = v; },
    hasImage: (id: string) => imagens.has(id),
    addImage: (id: string, img: unknown) => { diario.push(`addImage ${id}`); imagens.set(id, img); },
    removeImage: (id: string) => { diario.push(`removeImage ${id}`); imagens.delete(id); },
    loadImage
  };
  return { m: m as unknown as MapLibreMap, diario, fontes, camadas, layout, imagens, loadImage };
}

const ok = (width: number, height: number) => () => Promise.resolve({ data: { width, height } });
const falha = () => Promise.reject(new Error("404"));

describe("MM4 — fonte do marcador agregado (um ponto por área ocupada)", () => {
  it("um ponto por área com lote, NO centróide da API; área com 2 lotes = 1 ponto com a soma; vazia e sem centróide ficam fora", () => {
    // centróide de propósito longe do centro do polígono: o ponto tem de ser o da API, não uma conta da tela
    const r = resposta([
      ocupada("a1", [lote("l1", 10), lote("l2", 15)], { centroide: { lon: -54.9961, lat: -15.0042 } }),
      ocupada("a2", [lote("l3", 7)]),
      area("a3"),
      ocupada("a4", [lote("l4", 3)], { centroide: null })
    ]);
    const fc = featuresDeLotes(r, nenhumaImagem);
    expect(fc.features.map((f) => f.properties.area_id)).toEqual(["a1", "a2"]);
    const [f1] = fc.features;
    expect(f1!.geometry.coordinates).toEqual([-54.9961, -15.0042]);
    expect(f1!.properties.cabecas).toBe(25);
    expect(featuresDeLotes(null, nenhumaImagem).features).toEqual([]);
  });

  it("o contador é o total que a API somou (cabecas_total), não uma recontagem", () => {
    const r = resposta([ocupada("a1", [lote("l1", 10)], { cabecas_total: 12 })]);
    expect(featuresDeLotes(r, nenhumaImagem).features[0]!.properties.cabecas).toBe(12);
  });

  it("ícone: pronto só com a imagem da config registrada; sem config ou sem capacidade, fallback", () => {
    const r = resposta([
      ocupada("a1", [lote("l1", 1)], { icone: icone("cfg1", "https://x/1.png", "#123456") }),
      ocupada("a2", [lote("l2", 1)], { icone: icone("cfg2", "https://x/2.png") }),
      ocupada("a3", [lote("l3", 1)], { icone: icone(null, null) }),
      ocupada("a4", [lote("l4", 1)], { icone: null })
    ]);
    const fc = featuresDeLotes(r, (id) => (id === "cfg1" ? { escala: 1 / 92, largura: 92, altura: 46 } : null));
    const p = Object.fromEntries(fc.features.map((f) => [f.properties.area_id, f.properties]));
    expect(p.a1).toMatchObject({ icone_id: "cfg1", icone_url: "https://x/1.png", cor_padrao: "#123456", icone_pronto: true, escala: 1 / 92, aspecto: -0.5 });
    expect(p.a2).toMatchObject({ icone_id: "cfg2", icone_pronto: false, escala: 0, aspecto: 0 });
    expect(p.a3).toMatchObject({ icone_id: "", icone_url: "", cor_padrao: "", icone_pronto: false });
    expect(p.a4).toMatchObject({ icone_id: "", icone_pronto: false });
    for (const f of fc.features) expect(f.properties.tem_alerta).toBe(false);
  });

  it("badge: sigla cortada em 2 letras; misto = M+ neutro; sem identificador, sem badge; só cor = badge sem texto", () => {
    expect(siglaCurta("ABC")).toBe("AB");
    expect(siglaCurta(" Água ")).toBe("Ág");
    expect(siglaCurta("X")).toBe("X");
    const r = resposta([
      ocupada("a1", [lote("l1", 1)], { identificador: { misto: false, cor: "#ff0000", sigla: "NELORE", nome: "Nelore" } }),
      ocupada("a2", [lote("l2", 1), lote("l3", 1)], { identificador: { misto: true } }),
      ocupada("a3", [lote("l4", 1)], { identificador: null }),
      ocupada("a4", [lote("l5", 1)], { identificador: { misto: false, cor: "#00ff00", sigla: "", nome: "" } })
    ]);
    const p = Object.fromEntries(featuresDeLotes(r, nenhumaImagem).features.map((f) => [f.properties.area_id, f.properties]));
    expect(p.a1).toMatchObject({ tem_identificador: true, identificador_sigla: "NE", identificador_cor: "#ff0000", identificador_misto: false });
    expect(p.a2).toMatchObject({ tem_identificador: true, identificador_sigla: SIGLA_DO_MISTO, identificador_cor: COR_DO_MISTO, identificador_misto: true });
    expect(p.a3).toMatchObject({ tem_identificador: false, identificador_sigla: "" });
    expect(p.a4).toMatchObject({ tem_identificador: true, identificador_sigla: "", identificador_cor: "#00ff00" });
  });

  it("objetos de mapa: só forma ponto (Point) entra na fonte; nenhum tem imagem (a API não manda ícone de objeto)", () => {
    const base = { empresa_id: "e1", code: null, descricao: null, capacidade: null, unidade_capacidade: null, trough_id: null };
    const objetos: ObjetoDeMapa[] = [
      { ...base, id: "o1", area_id: "a1", tipo: "cocho", forma: "ponto", geometria: { type: "Point", coordinates: [-54.99, -15] }, name: "Cocho 1", is_active: true },
      { ...base, id: "o2", area_id: null, tipo: "deposito_a_pasto", forma: "ponto", geometria: { type: "Point", coordinates: [-55, -15.1] }, name: "Depósito", is_active: false },
      { ...base, id: "o3", area_id: "a1", tipo: "cocho", forma: "linha", geometria: { type: "LineString", coordinates: [[-55, -15], [-55.01, -15]] }, name: "Linha", is_active: true }
    ];
    const fc = featuresDeObjetos(resposta([], objetos));
    expect(fc.features.map((f) => f.properties.objeto_id)).toEqual(["o1", "o2"]);
    expect(fc.features[1]!.properties).toMatchObject({ area_id: "", ativo: false, icone_id: "", icone_pronto: false });
  });
});

describe("MM4 — instalação e sincronização no mapa", () => {
  it("instalação idempotente: 2 fontes, 1 fundo de badge e 5 camadas na ordem z, uma vez só", () => {
    const { m, camadas, diario } = mapaFalso();
    instalarCamadasDeLotes(m);
    instalarCamadasDeLotes(m);
    expect(camadas).toEqual([...CAMADAS_DE_LOTES, ...CAMADAS_DE_OBJETOS]);
    expect(diario.filter((d) => d.startsWith("addSource"))).toEqual([`addSource ${FONTE_LOTES}`, `addSource ${FONTE_OBJETOS}`]);
    expect(diario.filter((d) => d.startsWith("addLayer"))).toHaveLength(5);
    expect(diario.filter((d) => d === `addImage ${IMAGEM_FUNDO_DO_BADGE}`)).toHaveLength(1);
  });

  it("camada que faltava volta no lugar certo (abaixo da próxima do grupo)", () => {
    const { m, camadas } = mapaFalso();
    instalarCamadasDeLotes(m);
    camadas.splice(camadas.indexOf("lotes-icone"), 1);
    instalarCamadasDeLotes(m);
    expect(camadas).toEqual([...CAMADAS_DE_LOTES, ...CAMADAS_DE_OBJETOS]);
  });

  it("mesma resposta → nenhum setData na segunda sincronização; mudou → só a fonte que mudou", () => {
    const { m, fontes } = mapaFalso();
    const r1 = resposta([ocupada("a1", [lote("l1", 10)])]);
    expect(sincronizarLotes(m, r1)).toBe(true);
    const lotes = fontes.get(FONTE_LOTES)!.setData;
    const objetos = fontes.get(FONTE_OBJETOS)!.setData;
    expect(lotes).toHaveBeenCalledTimes(1);
    expect(objetos).toHaveBeenCalledTimes(1);
    // refetch com o mesmo conteúdo (objeto novo, mesma serialização): o mapa não é tocado
    expect(sincronizarLotes(m, structuredClone(r1))).toBe(false);
    expect(lotes).toHaveBeenCalledTimes(1);
    expect(objetos).toHaveBeenCalledTimes(1);
    const r2 = resposta([ocupada("a1", [lote("l1", 11)])]);
    expect(sincronizarLotes(m, r2)).toBe(true);
    expect(lotes).toHaveBeenCalledTimes(2);
    expect(objetos).toHaveBeenCalledTimes(1);
  });

  it("mostrarGrupo liga e desliga só as camadas do grupo", () => {
    const { m, layout } = mapaFalso();
    instalarCamadasDeLotes(m);
    mostrarGrupo(m, "lotes", false);
    for (const id of CAMADAS_DE_LOTES) expect(layout.get(id)!.visibility).toBe("none");
    for (const id of CAMADAS_DE_OBJETOS) expect(layout.get(id)!.visibility).toBeUndefined();
    mostrarGrupo(m, "objetos", false);
    mostrarGrupo(m, "lotes", true);
    for (const id of CAMADAS_DE_LOTES) expect(layout.get(id)!.visibility).toBe("visible");
    for (const id of CAMADAS_DE_OBJETOS) expect(layout.get(id)!.visibility).toBe("none");
  });

  it("fundo do badge: círculo SDF gerado em memória (borda em 0,75, fora transparente)", () => {
    const img = circuloSdf(48, 18);
    const alfa = (x: number, y: number) => img.data[(y * img.width + x) * 4 + 3]!;
    expect(img.width).toBe(48);
    expect(alfa(24, 24)).toBe(255);
    expect(alfa(0, 0)).toBe(0);
    expect(alfa(24 + 18, 24)).toBeGreaterThan(150);
    expect(alfa(24 + 18, 24)).toBeLessThan(200);
  });
});

describe("MM4 — imagens: proporção, cache e falha isolada", () => {
  it("escala uniforme pelo maior lado: 92×46 → 46×23 no trabalho e 20×10 no piso; nunca distorce", () => {
    expect(escalaUnitaria(92, 46)).toBe(1 / 92);
    expect(tamanhoExibido(92, 46, 46)).toEqual({ largura: 46, altura: 23 });
    expect(tamanhoExibido(92, 46, 20)).toEqual({ largura: 20, altura: 10 });
    expect(tamanhoExibido(30, 60, 46)).toEqual({ largura: 23, altura: 46 });
    expect(escalaUnitaria(0, 0)).toBe(0);
    // o formato posiciona contador e badge no ícone REAL (deitado, em pé ou quadrado)
    expect(aspectoDaImagem(92, 46)).toBe(-0.5);
    expect(aspectoDaImagem(30, 60)).toBe(0.5);
    expect(aspectoDaImagem(40, 40)).toBe(0);
    expect(aspectoDaImagem(0, 0)).toBe(0);
  });

  it("pares distintos por config, só das áreas que viram marcador", () => {
    const r = resposta([
      ocupada("a1", [lote("l1", 1)], { icone: icone("cfg1", "https://x/1.png") }),
      ocupada("a2", [lote("l2", 1)], { icone: icone("cfg1", "https://x/1.png") }),
      ocupada("a3", [lote("l3", 1)], { icone: icone("cfg2", null) }),
      area("a4", { icone: icone("cfg3", "https://x/3.png") }),
      ocupada("a5", [lote("l5", 1)], { icone: icone("cfg4", "https://x/4.png"), centroide: null })
    ]);
    expect(paresDeIcones(r)).toEqual([{ id: "cfg1", url: "https://x/1.png" }]);
  });

  it("uma imagem que falha não derruba as outras; refetch não recarrega; a área da falha cai no fallback", async () => {
    const { m, imagens, loadImage, fontes } = mapaFalso({ "https://x/1.png": ok(92, 46), "https://x/2.png": falha });
    const r = resposta([
      ocupada("a1", [lote("l1", 1)], { icone: icone("cfg1", "https://x/1.png") }),
      ocupada("a2", [lote("l2", 1)], { icone: icone("cfg2", "https://x/2.png") })
    ]);
    sincronizarLotes(m, r);
    await expect(registrarImagensDosIcones(m, r)).resolves.toBe(true);
    expect(imagens.has("cfg1")).toBe(true);
    expect(imagens.has("cfg2")).toBe(false);
    sincronizarLotes(m, r);
    const ultimo = fontes.get(FONTE_LOTES)!.setData.mock.calls.at(-1)![0] as ReturnType<typeof featuresDeLotes>;
    const p = Object.fromEntries(ultimo.features.map((f) => [f.properties.area_id, f.properties]));
    expect(p.a1).toMatchObject({ icone_pronto: true, escala: 1 / 92, aspecto: -0.5 });
    expect(p.a2).toMatchObject({ icone_pronto: false });
    // refetch com as mesmas urls: nada é baixado de novo (nem a que falhou)
    await expect(registrarImagensDosIcones(m, structuredClone(r))).resolves.toBe(false);
    expect(loadImage).toHaveBeenCalledTimes(2);
  });

  it("url nova para o mesmo id: removeImage antes de addImage; url nova que falha tira a antiga", async () => {
    const { m, diario, imagens } = mapaFalso({ "https://x/1.png": ok(40, 40), "https://x/1b.png": ok(60, 30), "https://x/1c.png": falha });
    const com = (url: string) => resposta([ocupada("a1", [lote("l1", 1)], { icone: icone("cfg1", url) })]);
    await registrarImagensDosIcones(m, com("https://x/1.png"));
    diario.length = 0;
    await expect(registrarImagensDosIcones(m, com("https://x/1b.png"))).resolves.toBe(true);
    expect(diario).toEqual(["load https://x/1b.png", "removeImage cfg1", "addImage cfg1"]);
    await expect(registrarImagensDosIcones(m, com("https://x/1c.png"))).resolves.toBe(true);
    expect(imagens.has("cfg1")).toBe(false);
  });

  it("duas sincronizações seguidas dividem a mesma carga (uma requisição por imagem)", async () => {
    let soltar: () => void = () => {};
    const { m, loadImage } = mapaFalso({
      "https://x/1.png": () => new Promise((res) => { soltar = () => res({ data: { width: 10, height: 10 } }); })
    });
    const r = resposta([ocupada("a1", [lote("l1", 1)], { icone: icone("cfg1", "https://x/1.png") })]);
    const primeira = registrarImagensDosIcones(m, r);
    const segunda = registrarImagensDosIcones(m, r);
    await vi.waitFor(() => expect(loadImage).toHaveBeenCalledTimes(1));
    soltar();
    // as duas veem a imagem ficar pronta, mesmo que só uma a tenha registrado
    await expect(Promise.all([primeira, segunda])).resolves.toEqual([true, true]);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });
});
