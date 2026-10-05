import { describe, expect, it, vi } from "vitest";
import type { HistoricoIndice, ItemHistoricoIndice } from "./condicao-modelo";
import {
  ContornoMudouNaCarga,
  carregarHistoricoAteCobrir,
  filtrarPorJanela,
  janelaDoPeriodo
} from "./historico-periodo";

const HASH = "a".repeat(64);

function item(id: string, obs: string | null, criado: string, extra: Partial<ItemHistoricoIndice> = {}): ItemHistoricoIndice {
  return {
    id, situacao: "concluida", motivo_qualidade: null, geometria_sha256: HASH, do_poligono_atual: true,
    observacao_inicio: obs ? `${obs}T13:00:00.000Z` : null, observacao_fim: null, valor_medio: "0.5", valor_minimo: null,
    valor_maximo: null, desvio_padrao: null, cobertura_valida: "0.9", criado_em: `${criado}T20:00:00.000Z`, ...extra
  };
}
const pagina = (itens: ItemHistoricoIndice[], hash: string | null = HASH): HistoricoIndice =>
  ({ area_id: "a", indice: "ndvi", geometria_sha256: hash, do_poligono_atual: true, itens });

describe("janela do período", () => {
  const HOJE = "2026-10-05";
  const inicio = (p: Parameters<typeof janelaDoPeriodo>[0]) => {
    const j = janelaDoPeriodo(p, HOJE);
    if (!j.ok) throw new Error(j.motivo);
    return j.janela;
  };

  it("30d/60d/90d contam dias; 6m e 1a contam meses; o fim é hoje", () => {
    expect(inicio("30d")).toEqual({ inicio: "2026-09-05", fim: HOJE });
    expect(inicio("60d")).toEqual({ inicio: "2026-08-06", fim: HOJE });
    expect(inicio("90d")).toEqual({ inicio: "2026-07-07", fim: HOJE });
    expect(inicio("6m")).toEqual({ inicio: "2026-04-05", fim: HOJE });
    expect(inicio("1a")).toEqual({ inicio: "2025-10-05", fim: HOJE });
  });

  it("mês mais curto não estoura o dia (31/08 − 6 meses = 28/02)", () => {
    const j = janelaDoPeriodo("6m", "2026-08-31");
    expect(j).toEqual({ ok: true, janela: { inicio: "2026-02-28", fim: "2026-08-31" } });
  });

  it("personalizado: exige as duas datas e de ≤ até", () => {
    expect(janelaDoPeriodo("personalizado", HOJE, { de: "2026-01-01", ate: "2026-02-01" })).toEqual({ ok: true, janela: { inicio: "2026-01-01", fim: "2026-02-01" } });
    expect(janelaDoPeriodo("personalizado", HOJE, { de: "", ate: "2026-02-01" }).ok).toBe(false);
    expect(janelaDoPeriodo("personalizado", HOJE, { de: "2026-03-01", ate: "2026-02-01" }).ok).toBe(false);
    expect(janelaDoPeriodo("personalizado", HOJE).ok).toBe(false);
  });
});

describe("filtro do período pela data da observação", () => {
  it("as pontas entram; fora e sem data de observação ficam de fora", () => {
    const itens = [
      item("a", "2026-07-07", "2026-07-08"),
      item("b", "2026-10-05", "2026-10-06"),
      item("c", "2026-07-06", "2026-07-08"),
      item("d", null, "2026-09-01", { situacao: "sem_observacao_util" })
    ];
    expect(filtrarPorJanela(itens, { inicio: "2026-07-07", fim: "2026-10-05" }).map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("paginação por `antes` até cobrir ou esgotar", () => {
  const janela = { inicio: "2026-07-01", fim: "2026-10-05" };

  it("para quando a página só tem observações anteriores ao período (coberto), usando o criado_em mais antigo como cursor", async () => {
    const p1 = pagina([item("i3", "2026-09-10", "2026-09-11"), item("i2", "2026-08-10", "2026-08-11")]);
    const p2 = pagina([item("i1", "2026-07-10", "2026-07-11"), item("i0", "2026-06-10", "2026-06-11")]);
    const p3 = pagina([item("i-1", "2026-05-10", "2026-05-11"), item("i-2", "2026-04-10", "2026-04-11")]);
    const buscar = vi.fn()
      .mockResolvedValueOnce(p1).mockResolvedValueOnce(p2).mockResolvedValueOnce(p3);
    // p2 ainda tem uma observação dentro do período (2026-07-10); p3 só tem anteriores → cobre
    const r = await carregarHistoricoAteCobrir(buscar, janela, { limite: 2 });
    expect(buscar.mock.calls.map((c) => c[0])).toEqual([undefined, "2026-08-11T20:00:00.000Z", "2026-06-11T20:00:00.000Z"]);
    expect(r).toMatchObject({ paginas: 3, coberto: true, exaurido: false, truncado: false });
    expect(r.itens.map((i) => i.id)).toEqual(["i3", "i2", "i1", "i0", "i-1", "i-2"]);
  });

  it("para ao esgotar o histórico (página menor que o limite) sem marcar como coberto", async () => {
    const buscar = vi.fn().mockResolvedValueOnce(pagina([item("i1", "2026-09-10", "2026-09-11")]));
    const r = await carregarHistoricoAteCobrir(buscar, janela, { limite: 5 });
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ paginas: 1, exaurido: true, coberto: false, truncado: false });
  });

  it("tem teto de páginas: truncado é dito, não escondido", async () => {
    let n = 0;
    const buscar = vi.fn(async () => {
      n += 1;
      const dia = `2026-09-${String(30 - n).padStart(2, "0")}`;
      return pagina([item(`i${n}a`, dia, dia), item(`i${n}b`, dia, `2026-08-${String(30 - n).padStart(2, "0")}`)]);
    });
    const r = await carregarHistoricoAteCobrir(buscar, janela, { limite: 2, maxPaginas: 3 });
    expect(buscar).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ paginas: 3, truncado: true, coberto: false, exaurido: false });
  });

  it("página que não avança o cursor encerra (sem laço infinito) e duplicata por id é descartada", async () => {
    const igual = pagina([item("x1", "2026-09-10", "2026-09-11"), item("x2", "2026-09-09", "2026-09-10")]);
    const buscar = vi.fn(async () => igual);
    const r = await carregarHistoricoAteCobrir(buscar, janela, { limite: 2 });
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(r.itens).toHaveLength(2);
    expect(r.exaurido).toBe(true);
  });

  it("nunca mistura contorno antigo: item de outro hash é descartado e contorno que muda entre páginas aborta", async () => {
    const velho = item("velho", "2026-09-10", "2026-09-11", { geometria_sha256: "b".repeat(64) });
    const r = await carregarHistoricoAteCobrir(async () => pagina([item("ok", "2026-09-10", "2026-09-12"), velho]), janela, { limite: 5 });
    expect(r.itens.map((i) => i.id)).toEqual(["ok"]);

    const buscar = vi.fn()
      .mockResolvedValueOnce(pagina([item("a", "2026-09-10", "2026-09-11"), item("b", "2026-09-09", "2026-09-10")]))
      .mockResolvedValueOnce(pagina([item("c", "2026-08-10", "2026-08-11")], "c".repeat(64)));
    await expect(carregarHistoricoAteCobrir(buscar, janela, { limite: 2 })).rejects.toBeInstanceOf(ContornoMudouNaCarga);
  });

  it("área sem contorno (hash nulo, sem itens) esgota na primeira página", async () => {
    const r = await carregarHistoricoAteCobrir(async () => pagina([], null), janela, { limite: 5 });
    expect(r).toMatchObject({ itens: [], geometriaSha256: null, exaurido: true });
  });
});
