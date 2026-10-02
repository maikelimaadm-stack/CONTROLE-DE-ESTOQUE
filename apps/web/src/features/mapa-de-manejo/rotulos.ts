import type { Px } from "./editor-desenho";

/** Rótulo de área no mapa (nome + ha) antes do declutter. */
export interface RotuloAreaBruto {
  id: string;
  px: Px;
  nome: string;
  ha: number;
  /** Largura aproximada do polígono na tela — rótulos em pastos minúsculos somem. */
  larguraPx?: number;
  alturaPx?: number;
}

export interface RotuloAreaVisivel extends RotuloAreaBruto {
  /** 0–1: suaviza rótulos “apertados” em vez de empilhar. */
  opacidade: number;
}

function caixa(r: RotuloAreaBruto, pad: number) {
  const w = Math.max(56, r.nome.length * 6.6) + pad * 2;
  const h = (r.ha > 0 ? 28 : 16) + pad * 2;
  return { x: r.px.x - w / 2, y: r.px.y - h / 2, w, h };
}

function colide(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Evita nomes “remontados”: prioriza pastos maiores; esconde os que colidem;
 * some rótulos de polígonos miúdos no zoom atual. O destaque (hover/seleção) sempre aparece.
 */
export function suavizarRotulos(
  rotulos: readonly RotuloAreaBruto[],
  opts?: { destaqueId?: string | null; zoom?: number }
): RotuloAreaVisivel[] {
  const destaqueId = opts?.destaqueId ?? null;
  const zoom = opts?.zoom ?? 14;
  // Quanto mais longe, mais agressivo o corte (só os maiores).
  const minLado = zoom < 12 ? 90 : zoom < 13.5 ? 56 : zoom < 15 ? 36 : 22;
  const pad = zoom < 13 ? 10 : 6;

  const candidatos = rotulos.filter((r) => {
    if (r.id === destaqueId) return true;
    const w = r.larguraPx ?? 999;
    const h = r.alturaPx ?? 999;
    return Math.min(w, h) >= minLado;
  });

  const ordenados = [...candidatos].sort((a, b) => {
    if (a.id === destaqueId) return -1;
    if (b.id === destaqueId) return 1;
    return b.ha - a.ha;
  });

  const aceitos: { r: RotuloAreaBruto; box: ReturnType<typeof caixa> }[] = [];
  for (const r of ordenados) {
    const box = caixa(r, pad);
    const bate = aceitos.some((a) => colide(box, a.box));
    if (bate && r.id !== destaqueId) continue;
    if (bate && r.id === destaqueId) {
      // Destaque ganha: remove quem atrapalha.
      for (let i = aceitos.length - 1; i >= 0; i--) {
        if (colide(box, aceitos[i]!.box)) aceitos.splice(i, 1);
      }
    }
    aceitos.push({ r, box });
  }

  return aceitos.map(({ r }) => {
    const lado = Math.min(r.larguraPx ?? 120, r.alturaPx ?? 120);
    const apertado = lado < minLado * 1.35;
    return {
      ...r,
      opacidade: r.id === destaqueId ? 1 : apertado ? 0.72 : 0.95
    };
  });
}
