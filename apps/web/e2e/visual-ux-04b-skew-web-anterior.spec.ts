import { test, expect } from "@playwright/test";
import {
  COMMITS_DA_PILULA, COMMITS_DO_EDITOR_DA_TOP, PILULA_DO_MOTOR, PILULA_LITERAL, editorDaBaseGravaFormato4, grafiasDaPendencia, pendenciaNoClique
} from "./skew-fonte-da-base";

/**
 * VISUAL-UX-04b (decisão 278) — PROVA REVERSA DOS DETECTORES DO SENTIDO 2, SEM NAVEGADOR.
 *
 * Roda em `playwright.skew-web-anterior.config.ts` (o `testMatch` casa o sufixo), num arquivo próprio e FORA do modo
 * serial de `skew-web-anterior.spec.ts`: as provas buscam commits fixos por SHA (o checkout do CI é raso) e, se um
 * deles não vier, REPROVAM com o motivo — nunca passam vazias. Dentro da série, essa reprovação pularia todos os casos
 * com navegador declarados depois dela; aqui ela reprova só a si mesma.
 */

/**
 * `pendenciaNoClique` decide o ramo do A1-K2 (Salvar desabilitado × pendência no clique) e já errou em silêncio uma vez:
 * só conhecia o literal da VISUAL-UX-02 e, com a base no motor da Central, escolheu o mundo do Salvar desabilitado — o
 * A1-K2 ficou vermelho e levou os casos seguintes do modo serial. Cada grafia é provada SOZINHA: o commit do literal
 * não tem a do motor e vice-versa, então tirar qualquer uma das duas do detector reprova este caso.
 */
test("VISUAL-UX-04b · prova reversa do detector da pendência no clique: sem a pílula → false; literal da VISUAL-UX-02 → true; motor da Central → true", () => {
  expect(grafiasDaPendencia(COMMITS_DA_PILULA.semPilula), "#77: anterior à pílula — nenhuma das duas grafias").toStrictEqual([]);
  expect(grafiasDaPendencia(COMMITS_DA_PILULA.literal), "#79 (VISUAL-UX-02): só o literal").toStrictEqual([PILULA_LITERAL]);
  expect(grafiasDaPendencia(COMMITS_DA_PILULA.motor), "#87 (VISUAL-UX-04): só o motor").toStrictEqual([PILULA_DO_MOTOR]);
  expect([COMMITS_DA_PILULA.semPilula, COMMITS_DA_PILULA.literal, COMMITS_DA_PILULA.motor].map((sha) => pendenciaNoClique(sha))).toStrictEqual([false, true, true]);
});

/**
 * `editorDaBaseGravaFormato4` decide o formato que o TOP-CONFIG-04A espera da TOP renomeada pelo web da base. Com a
 * #88 na main, o editor da base passou a gravar o formato 4, e o caso, que só conhecia o 2 e o 3, ficou vermelho
 * (esperava 3, recebeu 4). Os dois mundos, cada um num commit fixo: um detector que respondesse sempre o mesmo reprova.
 */
test("VISUAL-UX-04b · prova reversa do detector do editor de TOP no formato 4: antes da TOP-CONFIG-08 → false; com ela → true", () => {
  expect(editorDaBaseGravaFormato4(COMMITS_DO_EDITOR_DA_TOP.semFormato4), "#87: o editor ainda grava o formato 3").toBe(false);
  expect(editorDaBaseGravaFormato4(COMMITS_DO_EDITOR_DA_TOP.formato4), "#88 (TOP-CONFIG-08): o editor grava o formato 4").toBe(true);
});
