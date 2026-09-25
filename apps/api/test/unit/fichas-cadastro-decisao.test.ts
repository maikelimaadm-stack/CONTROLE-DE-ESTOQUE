import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ARQUIVO_CAPACIDADES, FATIAS, declaracoesDaCapacidade, decidir, migrationsNaArvore, valorDaVariavel } from "../../../../scripts/lib/fichas-cadastro.mjs";

/**
 * A PROVA DE SKEW DOS CADASTROS DA #62 TAMBÉM EXPIRA SOZINHA: enquanto a base não tem a migration de uma fatia,
 * o sentido 1 cobra que a base RECUSA o corpo novo; quando a fatia está na base, a medição troca o ramo sem
 * ninguém mexer, e o sentido 1 passa a cobrar que a base ACEITA e grava o corpo novo. Aqui ficam as metades:
 * ausente, presente, e "detector quebrado reprova" (assinatura fora do HEAD, número reaproveitado, base vazia).
 *
 * AJUSTES 01 (0030): a fatia `cadastrosAjustes01` se mede por DUAS assinaturas que entraram juntas — a migration e a
 * capacidade `consultaCnpjJanela` em `/auth/context`. As duas concordam (as duas ou nenhuma), senão REPROVA; e a
 * fonte das capacidades ausente, com a fatia exigindo, também reprova (nunca se decide pela metade da assinatura).
 */
const RAIZ = path.resolve(__dirname, "../../../..");
const ASSINATURAS = Object.values(FATIAS).map((f) => f.migration);
const SEM_0030 = ASSINATURAS.filter((m) => m !== FATIAS.cadastrosAjustes01.migration);
const ANTERIORES = ["0001_foundation.sql", "0024_venda_classificacao_financeira.sql"];
const CAPACIDADE = FATIAS.cadastrosAjustes01.capacidade ?? "";
/** Fonte de `auth.ts` com e sem a capacidade (a forma real: `capacidades: { …, <nome>: CONSTANTE }`). */
const COM_CAP = `return { capacidades: { loteNaEntrada: 1, ${CAPACIDADE}: CAPACIDADE_CONSULTA_CNPJ_JANELA } };`;
const SEM_CAP = "return { capacidades: { loteNaEntrada: 1 } };";
const caps = (daBase: string) => ({ capacidadesDaBase: daBase, capacidadesDoHead: COM_CAP });

describe("decisão das fichas de cadastro da base (version skew)", () => {
  it("premissa: a fatia da 0030 se mede também pela capacidade consultaCnpjJanela", () => {
    expect(FATIAS.cadastrosAjustes01).toMatchObject({ migration: "0030_cadastros_ajustes_01.sql", capacidade: "consultaCnpjJanela" });
  });
  it("base sem nenhuma das migrations (e sem a capacidade): mundo legado em todas as fatias", () => {
    const d = decidir({ daBase: ANTERIORES, doHead: [...ANTERIORES, ...ASSINATURAS], ...caps(SEM_CAP) });
    expect(Object.values(d.fatias)).toEqual([false, false, false, false, false]);
    expect(valorDaVariavel(d.fatias)).toBe("");
  });
  it("base com as quatro da #62 e sem a 0030 (a base d91a772 desta PR): cadastrosAjustes01 no mundo legado", () => {
    const d = decidir({ daBase: [...ANTERIORES, ...SEM_0030], doHead: [...ANTERIORES, ...ASSINATURAS], ...caps(SEM_CAP) });
    expect(d.fatias).toEqual({ grupoArvore: true, fichaParceiro: true, rhFuncionarios: true, fichaProduto: true, cadastrosAjustes01: false });
    expect(valorDaVariavel(d.fatias)).toBe("fichaParceiro,fichaProduto,grupoArvore,rhFuncionarios");
  });
  it("base com todas (o mundo DEPOIS do merge desta PR): mundo atual em todas, e a variável lista as chaves em ordem", () => {
    const d = decidir({ daBase: [...ANTERIORES, ...ASSINATURAS], doHead: [...ANTERIORES, ...ASSINATURAS], ...caps(COM_CAP) });
    expect(Object.values(d.fatias)).toEqual([true, true, true, true, true]);
    expect(valorDaVariavel(d.fatias)).toBe("cadastrosAjustes01,fichaParceiro,fichaProduto,grupoArvore,rhFuncionarios");
  });
  it("cada fatia é medida pela SUA migration, não pela vizinha", () => {
    const d = decidir({ daBase: [...ANTERIORES, FATIAS.grupoArvore.migration], doHead: [...ANTERIORES, ...ASSINATURAS], ...caps(SEM_CAP) });
    expect(d.fatias).toEqual({ grupoArvore: true, fichaParceiro: false, rhFuncionarios: false, fichaProduto: false, cadastrosAjustes01: false });
  });
  it("base sem migration nenhuma é leitura quebrada: REPROVA em vez de escolher o legado", () => {
    expect(() => decidir({ daBase: [], doHead: ASSINATURAS, ...caps(SEM_CAP) })).toThrow(/leitura quebrada/);
  });
  it("assinatura ausente deste HEAD (migration renomeada): REPROVA", () => {
    expect(() => decidir({ daBase: ANTERIORES, doHead: ASSINATURAS.slice(1), ...caps(SEM_CAP) })).toThrow(/não existe neste HEAD/);
    expect(() => decidir({ daBase: ANTERIORES, doHead: SEM_0030, ...caps(SEM_CAP) })).toThrow(/0030_cadastros_ajustes_01\.sql \(cadastrosAjustes01\) não existe neste HEAD/);
  });
  it("o número da migration com OUTRO nome na base: REPROVA — a presença do nome deixou de responder", () => {
    expect(() => decidir({ daBase: [...ANTERIORES, "0025_outra_coisa.sql"], doHead: ASSINATURAS, ...caps(SEM_CAP) })).toThrow(/numeração foi reaproveitada/);
    expect(() => decidir({ daBase: [...ANTERIORES, FATIAS.grupoArvore.migration, "0025_outra_coisa.sql"], doHead: ASSINATURAS, ...caps(SEM_CAP) })).toThrow(/numeração foi reaproveitada/);
    expect(() => decidir({ daBase: [...ANTERIORES, ...SEM_0030, "0030_outra_coisa.sql"], doHead: ASSINATURAS, ...caps(SEM_CAP) })).toThrow(/numeração foi reaproveitada/);
  });

  describe("AJUSTES 01: a 0030 e a capacidade consultaCnpjJanela concordam, senão REPROVA", () => {
    const comTodas = [...ANTERIORES, ...ASSINATURAS];
    it("migration SEM a capacidade na base (ou o contrário): estado que ninguém publicou → REPROVA", () => {
      expect(() => decidir({ daBase: comTodas, doHead: comTodas, ...caps(SEM_CAP) })).toThrow(/tem 0030_cadastros_ajustes_01\.sql mas NÃO declara consultaCnpjJanela/);
      expect(() => decidir({ daBase: [...ANTERIORES, ...SEM_0030], doHead: comTodas, ...caps(COM_CAP) })).toThrow(/NÃO tem 0030_cadastros_ajustes_01\.sql mas declara consultaCnpjJanela/);
    });
    it("fonte das capacidades não lida (da base ou do HEAD): REPROVA — nunca decide pela metade da assinatura", () => {
      expect(() => decidir({ daBase: comTodas, doHead: comTodas })).toThrow(/não foi lida/);
      expect(() => decidir({ daBase: comTodas, doHead: comTodas, capacidadesDaBase: COM_CAP })).toThrow(/fonte deste HEAD não foi lida/);
      expect(() => decidir({ daBase: comTodas, doHead: comTodas, capacidadesDoHead: COM_CAP })).toThrow(/fonte da base não foi lida/);
    });
    it("capacidade ausente ou duplicada NESTE HEAD (renomeada): o detector morreu → REPROVA", () => {
      expect(() => decidir({ daBase: comTodas, doHead: comTodas, capacidadesDaBase: COM_CAP, capacidadesDoHead: SEM_CAP })).toThrow(/aparece 0 vez\(es\) .* deste HEAD/);
      expect(() => decidir({ daBase: comTodas, doHead: comTodas, capacidadesDaBase: COM_CAP, capacidadesDoHead: COM_CAP + COM_CAP })).toThrow(/aparece 2 vez\(es\) .* deste HEAD/);
    });
    it("capacidade duplicada na base: contagem ambígua não decide ramo nenhum → REPROVA", () => {
      expect(() => decidir({ daBase: comTodas, doHead: comTodas, capacidadesDaBase: COM_CAP + COM_CAP, capacidadesDoHead: COM_CAP })).toThrow(/contagem ambígua/);
    });
    it("a contagem lê a CHAVE do objeto (`<nome>:`), não a menção em comentário", () => {
      expect(declaracoesDaCapacidade(`/** \`${CAPACIDADE}\` (AJUSTES 01) */ ${SEM_CAP}`, CAPACIDADE)).toBe(0);
      expect(declaracoesDaCapacidade(COM_CAP, CAPACIDADE)).toBe(1);
      expect(declaracoesDaCapacidade(null, CAPACIDADE)).toBeNull();
    });
  });

  it("a árvore deste HEAD tem as cinco assinaturas e declara a capacidade UMA vez (o detector está vivo)", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, ARQUIVO_CAPACIDADES), "utf8");
    expect(declaracoesDaCapacidade(fonte, CAPACIDADE)).toBe(1);
    const d = decidir({ daBase: migrationsNaArvore(RAIZ), doHead: migrationsNaArvore(RAIZ), capacidadesDaBase: fonte, capacidadesDoHead: fonte });
    expect(Object.values(d.fatias)).toEqual([true, true, true, true, true]);
  });
});
