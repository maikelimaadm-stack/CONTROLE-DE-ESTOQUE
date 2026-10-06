import { describe, expect, it } from "vitest";
import { dtoCapacidadeSatelite } from "../../src/routes/satelite-consultas.js";
import { motivoExecutorDesligado } from "../../src/lib/satelite/worker.js";

/**
 * MAPA-UX-FINAL Part B — GET /api/satelite/capacidade.
 * fila_disponivel espelha executorSatelite != null; copernicus_disponivel = ENABLED ∧ configurado.
 * Sem segredos no DTO.
 */
describe("MAPA-UX-03 — dtoCapacidadeSatelite", () => {
  it("fila_disponivel só quando o executor está presente", () => {
    expect(dtoCapacidadeSatelite({
      executorPresente: true, copernicusEnabled: true, clienteConfigurado: true
    })).toEqual({ fila_disponivel: true, copernicus_disponivel: true });
    expect(dtoCapacidadeSatelite({
      executorPresente: false, copernicusEnabled: true, clienteConfigurado: true
    })).toEqual({ fila_disponivel: false, copernicus_disponivel: true });
  });

  it("copernicus_disponivel exige ENABLED e cliente configurado", () => {
    expect(dtoCapacidadeSatelite({
      executorPresente: false, copernicusEnabled: false, clienteConfigurado: true
    }).copernicus_disponivel).toBe(false);
    expect(dtoCapacidadeSatelite({
      executorPresente: false, copernicusEnabled: true, clienteConfigurado: false
    }).copernicus_disponivel).toBe(false);
  });

  it("DTO não inclui nomes de env nem credenciais", () => {
    const dto = dtoCapacidadeSatelite({
      executorPresente: true, copernicusEnabled: true, clienteConfigurado: true
    });
    expect(Object.keys(dto).sort()).toEqual(["copernicus_disponivel", "fila_disponivel"]);
    expect(JSON.stringify(dto)).not.toMatch(/SATELITE_WORKER|CLIENT_SECRET|client_secret|Bearer /i);
    expect(JSON.stringify(dto)).not.toContain("token");
    expect("COPERNICUS_ENABLED" in dto).toBe(false);
  });

  it("fila_disponivel alinha com motivoExecutorDesligado (executor nulo ⇔ fila indisponível)", () => {
    const cliente = (configurado: boolean) => ({ configurado });
    // Sem worker → executor nulo → fila indisponível.
    expect(motivoExecutorDesligado(
      { SATELITE_WORKER_ENABLED: false, COPERNICUS_ENABLED: true }, cliente(true)
    )).not.toBeNull();
    expect(dtoCapacidadeSatelite({
      executorPresente: false, copernicusEnabled: true, clienteConfigurado: true
    }).fila_disponivel).toBe(false);
    // Três condições → sem motivo → executor presente → fila disponível.
    expect(motivoExecutorDesligado(
      { SATELITE_WORKER_ENABLED: true, COPERNICUS_ENABLED: true }, cliente(true)
    )).toBeNull();
    expect(dtoCapacidadeSatelite({
      executorPresente: true, copernicusEnabled: true, clienteConfigurado: true
    }).fila_disponivel).toBe(true);
  });
});
