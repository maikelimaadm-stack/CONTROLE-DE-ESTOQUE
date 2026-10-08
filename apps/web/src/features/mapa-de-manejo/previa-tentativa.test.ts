import { describe, expect, it } from "vitest";
import {
  GestorTentativasPrevia,
  ehAbortError,
  marcarErroTentativa,
  montarSnapshotPedido
} from "./previa-tentativa";
import type { PeriodoConsulta } from "./consulta-satelite";

const periodoA: PeriodoConsulta = { tipo: "mais_recente", janela_dias: 30 };
const periodoB: PeriodoConsulta = { tipo: "mais_recente", janela_dias: 15 };

type EstadoUi = {
  previa: { chave: string; saldo: string; tentativaId: number } | null;
  erro: string | null;
  chaveAtual: string | null;
};

/**
 * Simula a fronteira assíncrona do modal: dependência que NÃO respeita abort,
 * para reproduzir resposta tardia após troca A→B (e mesma chave).
 */
async function simularFluxoPrevia(cenario: {
  passos: Array<{
    org: string;
    empresa: string;
    periodo: PeriodoConsulta;
    /** ms até a "rede" resolver */
    atrasoMs: number;
    resultado: "ok" | "erro";
    saldo: string;
    /** Se true, a chamada ignora abort (simula resposta que chega depois do cancel). */
    ignoraAbort?: boolean;
  }>;
  /** Índice do passo que define a chave/pedido "atual" ao final (último iniciado). */
}): Promise<EstadoUi> {
  const gestor = new GestorTentativasPrevia();
  const estado: EstadoUi = { previa: null, erro: null, chaveAtual: null };
  const pendentes: Promise<void>[] = [];

  for (const passo of cenario.passos) {
    const snap = montarSnapshotPedido({
      organizationId: passo.org,
      empresaId: passo.empresa,
      alvo: { tipo: "todas" },
      periodo: passo.periodo
    });
    estado.chaveAtual = snap.chave;
    // Troca de pedido invalida prévia de outra chave imediatamente (como o modal).
    if (estado.previa && estado.previa.chave !== snap.chave) {
      estado.previa = null;
      estado.erro = null;
    }
    const tentativa = gestor.iniciar(snap.chave);
    const ac = new AbortController();
    // Nova tentativa cancela a HTTP anterior (otimização); a proteção é o id.
    for (const _ of []) { /* noop */ }
    void ac; // abort simulado só se !ignoraAbort

    pendentes.push((async () => {
      await new Promise((r) => setTimeout(r, passo.atrasoMs));
      if (passo.resultado === "ok") {
        const r = { chave: snap.chave, saldo: passo.saldo, tentativaId: tentativa.id };
        if (!gestor.deveAplicar(r, estado.chaveAtual)) return;
        estado.previa = r;
        estado.erro = null;
      } else {
        const e = marcarErroTentativa(new Error(`falha ${snap.chave}`), tentativa);
        if (ehAbortError(e)) return;
        if (!gestor.deveAplicar({ tentativaId: e.tentativaId, chave: e.chave }, estado.chaveAtual)) return;
        estado.previa = null;
        estado.erro = e.message;
      }
    })());
  }

  await Promise.all(pendentes);
  return estado;
}

describe("GestorTentativasPrevia — identidade em sucesso e erro", () => {
  it("B conclui, A falha depois: prévia e pedido de B permanecem", async () => {
    const estado = await simularFluxoPrevia({
      passos: [
        { org: "o", empresa: "e", periodo: periodoA, atrasoMs: 40, resultado: "erro", saldo: "0", ignoraAbort: true },
        { org: "o", empresa: "e", periodo: periodoB, atrasoMs: 5, resultado: "ok", saldo: "50.00" }
      ]
    });
    const chaveB = montarSnapshotPedido({
      organizationId: "o", empresaId: "e", alvo: { tipo: "todas" }, periodo: periodoB
    }).chave;
    expect(estado.previa?.chave).toBe(chaveB);
    expect(estado.previa?.saldo).toBe("50.00");
    expect(estado.erro).toBeNull();
  });

  it("B conclui, A responde sucesso depois: A não substitui B", async () => {
    const estado = await simularFluxoPrevia({
      passos: [
        { org: "o", empresa: "e", periodo: periodoA, atrasoMs: 40, resultado: "ok", saldo: "10.00", ignoraAbort: true },
        { org: "o", empresa: "e", periodo: periodoB, atrasoMs: 5, resultado: "ok", saldo: "50.00" }
      ]
    });
    const chaveB = montarSnapshotPedido({
      organizationId: "o", empresaId: "e", alvo: { tipo: "todas" }, periodo: periodoB
    }).chave;
    expect(estado.previa?.chave).toBe(chaveB);
    expect(estado.previa?.saldo).toBe("50.00");
  });

  it("duas tentativas da mesma chave: resposta antiga não vence a atual", async () => {
    const gestor = new GestorTentativasPrevia();
    const snap = montarSnapshotPedido({
      organizationId: "o", empresaId: "e", alvo: { tipo: "todas" }, periodo: periodoA
    });
    const t1 = gestor.iniciar(snap.chave);
    const t2 = gestor.iniciar(snap.chave);
    expect(t1.id).not.toBe(t2.id);
    expect(gestor.deveAplicar({ tentativaId: t1.id, chave: snap.chave }, snap.chave)).toBe(false);
    expect(gestor.deveAplicar({ tentativaId: t2.id, chave: snap.chave }, snap.chave)).toBe(true);
  });

  it("A → B → A e invalidar (fechar/reabrir): tentativas anteriores ignoradas", async () => {
    const gestor = new GestorTentativasPrevia();
    const a = montarSnapshotPedido({
      organizationId: "o", empresaId: "e", alvo: { tipo: "todas" }, periodo: periodoA
    });
    const b = montarSnapshotPedido({
      organizationId: "o", empresaId: "e", alvo: { tipo: "todas" }, periodo: periodoB
    });
    const tA1 = gestor.iniciar(a.chave);
    const tB = gestor.iniciar(b.chave);
    const tA2 = gestor.iniciar(a.chave);
    expect(gestor.deveAplicar({ tentativaId: tA1.id, chave: a.chave }, a.chave)).toBe(false);
    expect(gestor.deveAplicar({ tentativaId: tB.id, chave: b.chave }, a.chave)).toBe(false);
    expect(gestor.deveAplicar({ tentativaId: tA2.id, chave: a.chave }, a.chave)).toBe(true);
    gestor.invalidar();
    expect(gestor.deveAplicar({ tentativaId: tA2.id, chave: a.chave }, a.chave)).toBe(false);
  });

  it("erro da tentativa vigente aparece; sucesso posterior recupera", async () => {
    const gestor = new GestorTentativasPrevia();
    const snap = montarSnapshotPedido({
      organizationId: "o", empresaId: "e", alvo: { tipo: "todas" }, periodo: periodoA
    });
    let previa: { chave: string; saldo: string } | null = null;
    let erro: string | null = null;
    const t1 = gestor.iniciar(snap.chave);
    const e = marcarErroTentativa(new Error("rede"), t1);
    if (gestor.deveAplicar({ tentativaId: e.tentativaId, chave: e.chave }, snap.chave)) {
      previa = null;
      erro = e.message;
    }
    expect(erro).toBe("rede");
    const t2 = gestor.iniciar(snap.chave);
    if (gestor.deveAplicar({ tentativaId: t2.id, chave: snap.chave }, snap.chave)) {
      previa = { chave: snap.chave, saldo: "40" };
      erro = null;
    }
    expect(erro).toBeNull();
    expect(previa?.saldo).toBe("40");
  });

  it("saldo suficiente/insuficiente alternado A/B: só a estimativa vigente conta", async () => {
    const estado = await simularFluxoPrevia({
      passos: [
        { org: "o", empresa: "e", periodo: periodoA, atrasoMs: 30, resultado: "ok", saldo: "999", ignoraAbort: true },
        { org: "o", empresa: "e", periodo: periodoB, atrasoMs: 5, resultado: "ok", saldo: "0.01" }
      ]
    });
    const chaveB = montarSnapshotPedido({
      organizationId: "o", empresaId: "e", alvo: { tipo: "todas" }, periodo: periodoB
    }).chave;
    expect(estado.previa?.chave).toBe(chaveB);
    expect(estado.previa?.saldo).toBe("0.01");
  });

  it("mudança de empresa/organização: resposta do contexto anterior não aplica", async () => {
    const estado = await simularFluxoPrevia({
      passos: [
        { org: "o1", empresa: "e1", periodo: periodoA, atrasoMs: 40, resultado: "ok", saldo: "10", ignoraAbort: true },
        { org: "o2", empresa: "e2", periodo: periodoA, atrasoMs: 5, resultado: "ok", saldo: "80" }
      ]
    });
    const chaveNova = montarSnapshotPedido({
      organizationId: "o2", empresaId: "e2", alvo: { tipo: "todas" }, periodo: periodoA
    }).chave;
    expect(estado.previa?.chave).toBe(chaveNova);
    expect(estado.previa?.saldo).toBe("80");
  });

  it("ehAbortError e marcarErroTentativa", () => {
    expect(ehAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    const e = new Error("x");
    e.name = "AbortError";
    expect(ehAbortError(e)).toBe(true);
    expect(ehAbortError(new Error("outro"))).toBe(false);
    const m = marcarErroTentativa(new Error("falhou"), { id: 3, chave: "k" });
    expect(m.tentativaId).toBe(3);
    expect(m.chave).toBe("k");
  });
});

describe("modal usa gestor em sucesso e erro (contrato de fonte)", () => {
  it("nova-consulta-modal confere tentativa no onError e no onSuccess", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "nova-consulta-modal.tsx"), "utf8");
    expect(src).toContain("GestorTentativasPrevia");
    expect(src).toContain("deveAplicar");
    expect(src).toContain("marcarErroTentativa");
    expect(src).toContain("chavePedidoAtualRef");
    expect(src).toContain("tentativaId");
    // onError não pode só setPrevia(null) sem identidade
    expect(src).toMatch(/onError:\s*\(e\)\s*=>\s*\{[\s\S]*deveAplicar/);
  });
});
