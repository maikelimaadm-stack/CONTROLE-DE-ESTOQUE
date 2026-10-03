import { describe, it, expect } from "vitest";
import {
  TIPOS_DE_USO_DA_AREA,
  VALORES_TIPO_DE_USO_DA_AREA,
  USO_PECUARIO,
  USO_AGRICOLA,
  USO_AMBIENTAL,
  USO_INFRAESTRUTURA,
  USO_PRODUTIVO,
  USO_BLOQUEADO,
  filtroUsoSelecaoArea
} from "../src/tipos-de-uso-da-area.js";
import { getResource } from "../src/resources/index.js";
import { CADASTROS_COM_NUMERACAO } from "../src/codigo-hierarquico.js";

describe("tipos-de-uso-da-area — SSOT do cadastro de áreas", () => {
  it("lista canônica tem 17 valores únicos na ordem da fatia", () => {
    expect(VALORES_TIPO_DE_USO_DA_AREA).toHaveLength(17);
    expect(new Set(VALORES_TIPO_DE_USO_DA_AREA).size).toBe(17);
    expect(VALORES_TIPO_DE_USO_DA_AREA[0]).toBe("pastagem");
    expect(VALORES_TIPO_DE_USO_DA_AREA).toContain("reserva_legal");
    expect(VALORES_TIPO_DE_USO_DA_AREA).toContain("confinamento");
  });

  it("conjuntos derivados não se contradizem e bloqueado = ambiental", () => {
    for (const v of USO_PECUARIO) expect(VALORES_TIPO_DE_USO_DA_AREA).toContain(v);
    for (const v of USO_AGRICOLA) expect(VALORES_TIPO_DE_USO_DA_AREA).toContain(v);
    for (const v of USO_AMBIENTAL) expect(VALORES_TIPO_DE_USO_DA_AREA).toContain(v);
    for (const v of USO_INFRAESTRUTURA) expect(VALORES_TIPO_DE_USO_DA_AREA).toContain(v);
    expect([...USO_BLOQUEADO].sort()).toEqual([...USO_AMBIENTAL].sort());
    for (const v of USO_BLOQUEADO) {
      expect(USO_PECUARIO).not.toContain(v);
      expect(USO_PRODUTIVO).not.toContain(v);
    }
    expect(USO_PRODUTIVO).toEqual(expect.arrayContaining([...USO_PECUARIO, ...USO_AGRICOLA]));
  });

  it("filtroUsoSelecaoArea cobre os três conjuntos e recusa valor estranho", () => {
    expect(filtroUsoSelecaoArea("receber_animal")).toEqual({ landUses: USO_PECUARIO, statuses: ["ativa"] });
    expect(filtroUsoSelecaoArea("safra")).toEqual({ landUses: USO_AGRICOLA, statuses: ["ativa", "em_formacao"] });
    expect(filtroUsoSelecaoArea("produtiva")).toEqual({ landUses: USO_PRODUTIVO, statuses: ["ativa"] });
    expect(filtroUsoSelecaoArea("xyz")).toBeNull();
  });

  it("registry de áreas e retiros consome a lista do domínio (não outra cópia)", () => {
    const areas = getResource("areas")!;
    const land = areas.fields.find((f) => f.name === "land_use")!;
    expect(land.options?.map((o) => o.value)).toEqual([...VALORES_TIPO_DE_USO_DA_AREA]);
    expect(areas.fields.some((f) => f.name === "usable_area_ha" && f.required)).toBe(true);
    expect(areas.fields.some((f) => f.name === "retiro_id")).toBe(true);
    const retiros = getResource("retiros")!;
    expect(retiros.permission).toBe("retiros");
    expect(retiros.empresaScoped).toBe(true);
    expect(retiros.codigoAutomatico).toBe("sequencial");
    expect(CADASTROS_COM_NUMERACAO).toContain("retiros");
    const rotulos = Object.fromEntries(TIPOS_DE_USO_DA_AREA);
    expect(rotulos.pastagem).toBe("Pastagem");
  });
});
