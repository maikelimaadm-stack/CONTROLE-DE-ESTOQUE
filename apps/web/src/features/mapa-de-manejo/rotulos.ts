import type { Px } from "./editor-desenho";

/** Rótulo de área no mapa (nome + ha) antes do declutter. */
export interface RotuloAreaBruto {
  id: string;
  px: Px;
  nome: string;
  ha: number;
  larguraPx?: number;
  alturaPx?: number;
}

export interface RotuloAreaVisivel extends RotuloAreaBruto {
  opacidade: number;
  fonteNome: number;
  fonteHa: number;
}

/** Fonte compacta: sobe com o zoom, mas fica menor que antes. */
export function fontesDoZoom(zoom: number): { nome: number; ha: number } {
  const nome = Math.max(7, Math.min(12.5, 5.5 + (zoom - 11) * 1.05));
  const ha = Math.max(6.5, Math.min(10.5, nome - 1.2));
  return { nome, ha };
}

function caixa(r: RotuloAreaBruto, pad: number, fonteNome: number) {
  const w = Math.max(fonteNome * 3.5, r.nome.length * (fonteNome * 0.58)) + pad * 2;
  const h = (r.ha > 0 ? fonteNome * 2.2 : fonteNome * 1.25) + pad * 2;
  return { x: r.px.x - w / 2, y: r.px.y - h / 2, w, h };
}

function colide(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Declutter simples: prioriza pastos maiores; esconde o que colide.
 * Sem regra confusa de “tamanho mínimo” por zoom — só some se o polígono
 * na tela for menor que o próprio rótulo, ou se encostar noutro nome.
 */
export function suavizarRotulos(
  rotulos: readonly RotuloAreaBruto[],
  opts?: { destaqueId?: string | null; zoom?: number }
): RotuloAreaVisivel[] {
  const destaqueId = opts?.destaqueId ?? null;
  const zoom = opts?.zoom ?? 14;
  const { nome: fonteNome, ha: fonteHa } = fontesDoZoom(zoom);
  const pad = 4;

  const candidatos = rotulos.filter((r) => {
    if (r.id === destaqueId) return true;
    const w = r.larguraPx ?? 999;
    const h = r.alturaPx ?? 999;
    // Cabe o texto no pasto? Se o pasto for menor que o rótulo, some.
    const precisaW = Math.max(40, r.nome.length * (fonteNome * 0.55));
    const precisaH = r.ha > 0 ? fonteNome * 2.1 : fonteNome * 1.2;
    return w >= precisaW && h >= precisaH;
  });

  const ordenados = [...candidatos].sort((a, b) => {
    if (a.id === destaqueId) return -1;
    if (b.id === destaqueId) return 1;
    return b.ha - a.ha;
  });

  const aceitos: { r: RotuloAreaBruto; box: ReturnType<typeof caixa> }[] = [];
  for (const r of ordenados) {
    const box = caixa(r, pad, fonteNome);
    const bate = aceitos.some((a) => colide(box, a.box));
    if (bate && r.id !== destaqueId) continue;
    if (bate && r.id === destaqueId) {
      for (let i = aceitos.length - 1; i >= 0; i--) {
        if (colide(box, aceitos[i]!.box)) aceitos.splice(i, 1);
      }
    }
    aceitos.push({ r, box });
  }

  return aceitos.map(({ r }) => ({
    ...r,
    opacidade: r.id === destaqueId ? 1 : 0.94,
    fonteNome,
    fonteHa
  }));
}
