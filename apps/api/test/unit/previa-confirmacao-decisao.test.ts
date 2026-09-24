import { describe, it, expect } from "vitest";
import path from "node:path";
import { decidir, ocorrenciasNaArvore, ocorrenciasNoTexto } from "../../../../scripts/lib/previa-confirmacao.mjs";

/**
 * A PROVA DE SKEW DA VENDAS-A5-1 TAMBÉM EXPIRA SOZINHA: enquanto a base não declara a rota da prévia, o
 * sentido 1 cobra que o diálogo cai no texto neutro com o botão habilitado e que a confirmação funciona;
 * quando a fatia estiver na base, a medição troca o ramo sem ninguém mexer. Aqui ficam as três metades: 0,
 * 1 e "qualquer outro número reprova" — e a assinatura, que tem de casar a DECLARAÇÃO e não as menções.
 */
const RAIZ = path.resolve(__dirname, "../../../..");

describe("decisão da prévia da confirmação da base (version skew)", () => {
  it("base sem a rota: mundo legado", () => expect(decidir({ ocorrencias: 0 }).serve).toBe(false));
  it("base com a rota exatamente uma vez: mundo atual", () => expect(decidir({ ocorrencias: 1 }).serve).toBe(true));
  it("número ambíguo REPROVA em vez de escolher um ramo", () => expect(() => decidir({ ocorrencias: 2 })).toThrow());
  it("a assinatura casa a declaração da rota, não qualquer menção ao caminho", () => {
    expect(ocorrenciasNoTexto("    if (kind === \"sale\") app.get(`${base}/:id/previa-confirmacao`, async (req) => runService(app, req, \"sales.view\", (ctx) => x));")).toBe(1);
    // O caminho aparece em comentário, no contrato e no próprio web; nenhuma dessas menções registra rota.
    for (const ruido of [
      " * Rota: GET /api/sales/sales/:id/previa-confirmacao, runService com \"sales.view\"",
      "queryFn: () => api<unknown>(`/api/sales/sales/${id}/previa-confirmacao`),",
      "app.post(`${base}/:id/confirm`, async (req) => x)",
      "savepoint previa_confirmacao_periodo",
    ]) expect(ocorrenciasNoTexto(ruido), ruido).toBe(0);
  });
  it("a árvore deste HEAD declara (exatamente uma vez)", () => expect(ocorrenciasNaArvore(RAIZ)).toBe(1));
});
