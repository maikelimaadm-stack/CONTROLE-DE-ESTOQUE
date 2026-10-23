import { describe, expect, it } from "vitest";
import {
  cabeNoDocumento, linhasDoProdutoCruzado, projetarRateioIndependente, somaDasPartes,
} from "./rateio-independente";

describe("rateio independente Natureza × Centro", () => {
  it("produto cruzado 60/40 × 70/30 → 42/18/28/12 = 100%", () => {
    const linhas = linhasDoProdutoCruzado(
      [{ id: "a", percentual: "60" }, { id: "b", percentual: "40" }],
      [{ id: "x", percentual: "70" }, { id: "y", percentual: "30" }],
      "conta",
      "safra",
    );
    expect(linhas).toEqual([
      { categoriaId: "a", centroId: "x", contaId: "conta", safraId: "safra", percentual: "42" },
      { categoriaId: "a", centroId: "y", contaId: "conta", safraId: "safra", percentual: "18" },
      { categoriaId: "b", centroId: "x", contaId: "conta", safraId: "safra", percentual: "28" },
      { categoriaId: "b", centroId: "y", contaId: "conta", safraId: "safra", percentual: "12" },
    ]);
    expect(somaDasPartes([
      { id: "a", percentual: "60" }, { id: "b", percentual: "40" },
    ])).toBe("100");
  });

  it("projetar agrega margem e carimba Conta/Safra da 1ª linha preenchida", () => {
    const vista = projetarRateioIndependente([
      { categoriaId: "a", centroId: "x", contaId: "c1", safraId: "", percentual: "42" },
      { categoriaId: "a", centroId: "y", contaId: "", safraId: "s1", percentual: "18" },
      { categoriaId: "b", centroId: "x", contaId: "", safraId: "", percentual: "28" },
      { categoriaId: "b", centroId: "y", contaId: "", safraId: "", percentual: "12" },
    ]);
    expect(vista.naturezas).toEqual([
      { id: "a", percentual: "60" },
      { id: "b", percentual: "40" },
    ]);
    expect(vista.centros).toEqual([
      { id: "x", percentual: "70" },
      { id: "y", percentual: "30" },
    ]);
    expect(vista.contaId).toBe("c1");
    expect(vista.safraId).toBe("s1");
  });

  it("cabeNoDocumento só com 1×1 a 100% sem conta/safra", () => {
    expect(cabeNoDocumento(
      [{ id: "n", percentual: "100" }],
      [{ id: "c", percentual: "100" }],
      "", "",
    )).toBe(true);
    expect(cabeNoDocumento(
      [{ id: "n", percentual: "100" }],
      [{ id: "c", percentual: "100" }],
      "conta", "",
    )).toBe(false);
    expect(cabeNoDocumento(
      [{ id: "n", percentual: "60" }, { id: "n2", percentual: "40" }],
      [{ id: "c", percentual: "100" }],
      "", "",
    )).toBe(false);
  });
});
