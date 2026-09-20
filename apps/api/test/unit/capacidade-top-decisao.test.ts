import { describe, it, expect } from "vitest";
import path from "node:path";
// @ts-expect-error — harness de rollout em JS puro, fora do grafo de tipos da API
import { ASSINATURA, CAMINHO_ROTA, decidir, ocorrenciasNaArvore, ocorrenciasNoTexto } from "../../../../scripts/lib/capacidade-top.mjs";

/**
 * A PROVA DE SKEW DA TOP-CONFIG-02 TEM DE EXPIRAR SOZINHA.
 *
 * A #47 provou uma verdade com prazo: "a API da base NÃO tem `/operation-types`, e por isso a tela
 * BLOQUEIA". Verdade enquanto a base era anterior a ela; falsa no instante em que a #47 entrou na `main`.
 * Nenhuma linha de código quebrou o teste — o TEMPO quebrou, e o resultado foi um job vermelho em toda PR
 * nova, inclusive numa de diff vazio.
 *
 * A correção não é apagar a prova: é derivá-la da CAPACIDADE MEDIDA da árvore da base, de modo que cada PR
 * seja cobrada no mundo em que ela de fato vive. Este arquivo cobra as três metades disso:
 *
 *   (1) base sem a rota  → mundo LEGADO, e a prova original da #47 continua sendo exigida;
 *   (2) base com a rota  → mundo ATUAL, e passa-se a exigir a prova positiva (200 + contractVersion);
 *   (3) qualquer outro número de ocorrências → o detector está quebrado e o gate REPROVA.
 *
 * O caso (3) é o que um teste preguiçoso esqueceria. Sem ele, o dia em que alguém duplicar ou reescrever o
 * registro da rota o gate escolheria um ramo em silêncio — e um gate que escolhe o ramo conveniente quando
 * não entende o que está vendo é indistinguível de um gate desligado.
 */
const RAIZ = path.resolve(__dirname, "../../../..");

describe("decisão da capacidade de TOP da base (version skew)", () => {
  it("base SEM a rota: mundo legado, e o sentido 1 continua cobrando o bloqueio da #47", () => {
    const d = decidir({ ocorrencias: 0 });
    expect(d.capaz).toBe(false);
    expect(d.motivo, "e diz em voz alta o que decidiu, para o log do CI").toMatch(/LEGADO/);
  });

  it("base COM a rota exatamente uma vez: mundo atual, e passa a cobrar a prova positiva", () => {
    const d = decidir({ ocorrencias: 1 });
    expect(d.capaz).toBe(true);
    expect(d.motivo).toMatch(/ATUAL/);
  });

  it("número ambíguo de ocorrências REPROVA em vez de escolher um ramo", () => {
    // Fail-closed: 2 ocorrências significam que a assinatura deixou de identificar o que promete.
    expect(() => decidir({ ocorrencias: 2 })).toThrow(/detector quebrado|apareceu 2 vezes/);
    expect(() => decidir({ ocorrencias: 7 })).toThrow();
  });

  it("a assinatura casa o REGISTRO da rota, e não qualquer menção ao nome dela", () => {
    // O que move a decisão é a linha que registra o endpoint no Fastify. Comentário, teste e chamada do
    // cliente citam "operation-types" o tempo todo; se qualquer um deles contasse, a decisão viraria ruído.
    const registro = 'app.get(`${base}/operation-types`, async (req) => runService(app, req, `${perm}.create`,';
    expect(ocorrenciasNoTexto(registro)).toBe(1);

    for (const ruido of [
      "// a rota /api/sales/budgets/operation-types responde 200 desde a #47",
      'const r = await fetch(`${API}/api/sales/${variante}/operation-types`);',
      'app.post(`${base}/operation-types`, naoEhIssoQueServeOEndpoint)',
      '"operation-types"'
    ]) {
      expect(ocorrenciasNoTexto(ruido), `não pode contar como registro: ${ruido}`).toBe(0);
    }
  });

  it("a árvore DESTE HEAD é medida como capaz — a assinatura ainda encontra o que promete encontrar", () => {
    // A guarda contra o modo de falhar mais silencioso de todos: alguém reescreve o registro da rota (troca
    // a crase por aspas, quebra a linha, renomeia `base`) e a assinatura passa a contar 0 em TODA árvore.
    // A decisão viraria "mundo legado" para sempre, o ramo fácil rodaria e ninguém veria. Este caso ancora
    // o detector no código real: se o registro mudar de forma, ele reprova aqui, perto de quem o mudou.
    expect(ocorrenciasNaArvore(RAIZ), `${CAMINHO_ROTA} deveria registrar a rota de descoberta exatamente uma vez`).toBe(1);
    expect(ASSINATURA.source, "a assinatura exige o app.get com a crase do template").toMatch(/app\\\.get/);
  });
});
