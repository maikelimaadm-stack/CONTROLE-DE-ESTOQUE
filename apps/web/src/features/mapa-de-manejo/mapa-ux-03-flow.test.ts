import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORDEM_SELECAO, ROTULO_SELECAO } from "./consulta-satelite";
import {
  MSG_FILA_INDISPONIVEL,
  consultaViva,
  estadoUiDaSituacao,
  rotuloBarraAnalise
} from "./operacao-analise";
import type { ConsultaDto } from "./consulta-satelite";

const mapaGeralSrc = readFileSync(resolve(__dirname, "mapa-geral.tsx"), "utf8");
const modalSrc = readFileSync(resolve(__dirname, "nova-consulta-modal.tsx"), "utf8");
const barraSrc = readFileSync(resolve(__dirname, "barra-status-analise.tsx"), "utf8");
const hookSrc = readFileSync(resolve(__dirname, "use-operacao-analise.ts"), "utf8");
const operacaoSrc = readFileSync(resolve(__dirname, "operacao-analise.ts"), "utf8");

/**
 * MAPA-UX-FINAL Part B — FLOW-01..04 + QUEUE (fonte/estático).
 */
describe("MAPA-UX-03 — FLOW + QUEUE", () => {
  it("FLOW-01 recupera consulta viva no load (lista + poll)", () => {
    expect(hookSrc).toContain("/api/satelite/consultas");
    expect(hookSrc).toContain("pagina: 1");
    expect(hookSrc).toContain("tamanho: 5");
    expect(hookSrc).toContain("primeiraConsultaViva");
    expect(hookSrc).toContain("refetchInterval");
    expect(mapaGeralSrc).toContain("useOperacaoAnaliseViva");
    expect(consultaViva("pendente")).toBe(true);
    expect(consultaViva("executando")).toBe(true);
  });

  it("FLOW-02 barra persistente após iniciar; distinta de Atualizando mapa", () => {
    expect(operacaoSrc).toContain("Analisando pastos");
    expect(barraSrc).toContain("rotuloBarraAnalise");
    expect(barraSrc).toContain('data-testid="mapa-barra-analise"');
    expect(barraSrc).toContain("Atualizando mapa…");
    expect(barraSrc).toContain('data-testid="mapa-atualizando"');
    expect(mapaGeralSrc).toContain("BarraStatusAnalise");
    expect(mapaGeralSrc).toContain("AvisoAtualizandoMapa");
    expect(mapaGeralSrc).toContain('mapasCond.atualizando');
    expect(modalSrc).toContain("Continuar em segundo plano");
    const c: ConsultaDto = {
      id: "x", situacao: "executando", total_itens: 102,
      total_concluidos: 38, total_falhos: 0, total_reaproveitados: 0,
      criado_em: "2026-10-06T12:00:00.000Z", concluida_em: null
    };
    expect(rotuloBarraAnalise(c)).toBe("Analisando pastos · 38/102");
  });

  it("FLOW-03 uma op viva → Analisar áreas abre acompanhar (não inicia outra)", () => {
    expect(mapaGeralSrc).toContain("operacao.viva && operacao.consultaId");
    expect(mapaGeralSrc).toContain("acompanhar: true");
    expect(mapaGeralSrc).toContain("modoAcompanhar");
    expect(modalSrc).toContain("modoAcompanhar");
    expect(modalSrc).toContain("Há uma análise em andamento");
    expect(modalSrc).toContain("consultaIdInicial");
    expect(modalSrc).toContain("setConsultaId(p.consultaIdInicial)");
  });

  it("FLOW-04 fila indisponível: mensagem amigável sem nomes de env", () => {
    expect(operacaoSrc).toContain("MSG_FILA_INDISPONIVEL");
    expect(MSG_FILA_INDISPONIVEL).toBe("Processamento em fila indisponível neste ambiente.");
    expect(MSG_FILA_INDISPONIVEL).not.toMatch(/SATELITE_WORKER|COPERNICUS_|ENABLED/);
    expect(modalSrc).toContain("consulta-fila-indisponivel");
    expect(barraSrc).toContain("mapa-fila-indisponivel");
    expect(modalSrc).toContain("filaDisponivel");
    expect(estadoUiDaSituacao("pendente")).toBe("na_fila");
  });

  it("QUEUE — cliente pede capacidade sem segredos (contrato web)", () => {
    expect(hookSrc).toContain("/api/satelite/capacidade");
    expect(hookSrc).toContain("fila_disponivel");
    expect(hookSrc).toContain("copernicus_disponivel");
    expect(hookSrc).not.toMatch(/SATELITE_WORKER|COPERNICUS_PROCESS|process\.env/);
    expect(MSG_FILA_INDISPONIVEL).not.toMatch(/SATELITE_WORKER|COPERNICUS_|ENABLED/);
  });

  it("Part B modal: default empresa, contagem, prévia e Analisar áreas", () => {
    expect(ORDEM_SELECAO[0]).toBe("empresa");
    expect(ROTULO_SELECAO.empresa).toBe("Todos os pastos");
    expect(modalSrc).toContain("consulta-todos-contador");
    expect(modalSrc).toContain("totalAreas");
    expect(modalSrc).toContain("consulta-previa-resultado");
    expect(modalSrc).toContain("Analisar áreas");
    expect(modalSrc).toContain("consulta-progresso-pastos");
    expect(modalSrc).toContain("setAvancadasAbertas(false)");
    expect(mapaGeralSrc).toContain("totalAreas={totalAreasAnalisaveis}");
  });
});
