import { describe, expect, it } from "vitest";
import {
  MSG_FILA_INDISPONIVEL,
  consultaViva,
  deveAvisarFilaIndisponivel,
  estadoUiDaSituacao,
  feitosDaConsulta,
  primeiraConsultaViva,
  rotuloBarraAnalise
} from "./operacao-analise";
import type { ConsultaDto } from "./consulta-satelite";

const base = (p: Partial<ConsultaDto> = {}): ConsultaDto => ({
  id: "c1",
  situacao: "pendente",
  total_itens: 102,
  total_concluidos: 0,
  total_falhos: 0,
  total_reaproveitados: 0,
  criado_em: "2026-10-06T12:00:00.000Z",
  concluida_em: null,
  ...p
});

describe("operacao-analise — helpers puros", () => {
  it("consultaViva só pendente/executando", () => {
    expect(consultaViva("pendente")).toBe(true);
    expect(consultaViva("executando")).toBe(true);
    expect(consultaViva("concluida")).toBe(false);
    expect(consultaViva("concluida_com_falhas")).toBe(false);
    expect(consultaViva("cancelada")).toBe(false);
    expect(consultaViva(null)).toBe(false);
  });

  it("estadoUiDaSituacao mapeia para o canônico", () => {
    expect(estadoUiDaSituacao(null)).toBe("ociosa");
    expect(estadoUiDaSituacao("pendente", { preparando: true })).toBe("preparando");
    expect(estadoUiDaSituacao("pendente")).toBe("na_fila");
    expect(estadoUiDaSituacao("executando")).toBe("processando");
    expect(estadoUiDaSituacao("concluida")).toBe("concluida");
    expect(estadoUiDaSituacao("concluida_com_falhas")).toBe("concluida_com_falhas");
    expect(estadoUiDaSituacao("cancelada")).toBe("falhou");
  });

  it("rotuloBarraAnalise e feitos", () => {
    const c = base({ total_concluidos: 30, total_reaproveitados: 8 });
    expect(feitosDaConsulta(c)).toBe(38);
    expect(rotuloBarraAnalise(c)).toBe("Analisando áreas · 38/102");
  });

  it("primeiraConsultaViva pega a primeira viva da lista", () => {
    expect(primeiraConsultaViva([
      base({ id: "a", situacao: "concluida" }),
      base({ id: "b", situacao: "executando" }),
      base({ id: "c", situacao: "pendente" })
    ])?.id).toBe("b");
    expect(primeiraConsultaViva([base({ situacao: "concluida" })])).toBeNull();
  });

  it("deveAvisarFilaIndisponivel — ao criar imediato; pendente 0 feitos após limiar", () => {
    expect(deveAvisarFilaIndisponivel({
      filaDisponivel: false, situacao: null, feitos: 0, agoraMs: 1000, aoCriar: true
    })).toBe(true);
    expect(deveAvisarFilaIndisponivel({
      filaDisponivel: true, situacao: null, feitos: 0, agoraMs: 1000, aoCriar: true
    })).toBe(false);
    expect(deveAvisarFilaIndisponivel({
      filaDisponivel: false, situacao: "pendente", feitos: 0,
      criadoEmMs: 0, agoraMs: 9_000, limiarMs: 8_000
    })).toBe(true);
    expect(deveAvisarFilaIndisponivel({
      filaDisponivel: false, situacao: "pendente", feitos: 0,
      criadoEmMs: 0, agoraMs: 3_000, limiarMs: 8_000
    })).toBe(false);
    expect(deveAvisarFilaIndisponivel({
      filaDisponivel: false, situacao: "executando", feitos: 0,
      criadoEmMs: 0, agoraMs: 20_000
    })).toBe(false);
    expect(MSG_FILA_INDISPONIVEL).toContain("fila indisponível");
    expect(MSG_FILA_INDISPONIVEL).not.toMatch(/SATELITE_WORKER|COPERNICUS_/);
  });
});
