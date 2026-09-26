import { describe, expect, it } from "vitest";
import { LAYOUT_DO_SISTEMA, FAMILIAS_COM_LAYOUT, validarEstruturaLayout } from "../src/index.js";

describe("layout do documento — contrato (PASSO 0)", () => {
  for (const f of FAMILIAS_COM_LAYOUT) it(`o layout do sistema de ${f} é válido`, () => expect(validarEstruturaLayout(f, LAYOUT_DO_SISTEMA(f))).toEqual([]));
});
