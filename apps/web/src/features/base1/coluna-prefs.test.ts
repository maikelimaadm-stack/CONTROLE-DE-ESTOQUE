import { describe, expect, it } from "vitest";

/**
 * Contrato decisão 356 — o mesmo que `list.tsx` / `itens-da-nota.tsx` aplicam nos handlers:
 * `onResize` só grava largura; `onAutoFit` alterna o modo. Assim o remeasure ao congelar/descongelar
 * (efeito do Base1Grid que chama onResize) NÃO apaga autoFit.
 */
function aoRedimensionar<T extends { widths?: Record<string, number>; autoFit?: string[] }>(c: T, k: string, w: number): T {
  return { ...c, widths: { ...(c.widths ?? {}), [k]: w } };
}

function aoAlternarAutoFit<T extends { autoFit?: string[] }>(c: T, k: string): T {
  const n = new Set(c.autoFit ?? []);
  if (n.has(k)) n.delete(k); else n.add(k);
  const autoFit = [...n];
  return { ...c, autoFit: autoFit.length ? autoFit : undefined };
}

describe("coluna prefs — autofit vs resize (356)", () => {
  it("remeasure (como ao descongelar) preserva autoFit", () => {
    const c = { widths: { nome: 100 }, autoFit: ["nome"], frozen: 1 };
    const next = aoRedimensionar(c, "nome", 140);
    expect(next.autoFit).toEqual(["nome"]);
    expect(next.widths.nome).toBe(140);
    expect(next.frozen).toBe(1);
  });

  it("arraste desliga o modo via onAutoFit separado (não via onResize)", () => {
    const c = { widths: { nome: 100 }, autoFit: ["nome"] };
    const sized = aoRedimensionar(c, "nome", 90);
    expect(sized.autoFit).toEqual(["nome"]);
    const off = aoAlternarAutoFit(sized, "nome");
    expect(off.autoFit).toBeUndefined();
    expect(off.widths?.nome).toBe(90);
  });

  it("menu liga: resize depois toggle adiciona a chave", () => {
    const c = { widths: {} as Record<string, number>, autoFit: undefined as string[] | undefined };
    const sized = aoRedimensionar(c, "nome", 160);
    const on = aoAlternarAutoFit(sized, "nome");
    expect(on.autoFit).toEqual(["nome"]);
    expect(on.widths.nome).toBe(160);
  });
});
