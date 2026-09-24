import { describe, it, expect } from "vitest";
import { RESOURCES, getResource, type FieldDef, type ResourceDef } from "../src/resources/index.js";

/**
 * OBRIGATÓRIO CONDICIONAL (`requiredWhen`) — consistência do Resource Registry.
 *
 * O banco é a autoridade (ex.: `chk_product_fin_cat`: `not control_stock or financial_category_id is not null`);
 * a declaração no registry existe para a tela e o modelo de importação avisarem ANTES, com a coluna certa.
 * Uma condição que aponta para campo inexistente, ou compara com um valor que o campo nunca assume, nunca
 * dispara: o aviso some em silêncio e o usuário volta a receber o erro genérico do banco. Estes casos
 * impedem que a declaração envelheça assim.
 */

type CampoCondicional = FieldDef & { requiredWhen: NonNullable<FieldDef["requiredWhen"]> };
const comCondicao: { r: ResourceDef; f: CampoCondicional }[] = RESOURCES.flatMap((r) =>
  r.fields.filter((f): f is CampoCondicional => f.requiredWhen !== undefined).map((f) => ({ r, f }))
);

describe("requiredWhen no Resource Registry", () => {
  it("1 · há ao menos uma declaração para conferir (varredura vazia não prova nada)", () => {
    expect(comCondicao.length).toBeGreaterThan(0);
  });

  it("2 · o campo de condição existe no MESMO recurso e é outro campo", () => {
    for (const { r, f } of comCondicao) {
      const cond = r.fields.find((c) => c.name === f.requiredWhen.field);
      expect(cond, `${r.key}.${f.name}: campo de condição "${f.requiredWhen.field}" não existe em ${r.key}`).toBeDefined();
      expect(f.requiredWhen.field, `${r.key}.${f.name}: a condição não pode apontar para o próprio campo`).not.toBe(f.name);
    }
  });

  it("3 · `equals` é um valor que o campo de condição assume (boolean → boolean; select → uma das opções)", () => {
    for (const { r, f } of comCondicao) {
      const cond = r.fields.find((c) => c.name === f.requiredWhen.field);
      if (!cond) continue; // coberto pelo caso 2
      if (cond.type === "boolean") expect(typeof f.requiredWhen.equals, `${r.key}.${f.name}: "${cond.name}" é boolean`).toBe("boolean");
      if (cond.type === "select") expect((cond.options ?? []).map((o) => o.value), `${r.key}.${f.name}: "${cond.name}" é select`).toContain(f.requiredWhen.equals);
    }
  });

  it("4 · o campo condicional não é `required` (seria incondicional) nem `readOnly` (ninguém o preencheria)", () => {
    for (const { r, f } of comCondicao) {
      expect(f.required ?? false, `${r.key}.${f.name}: required + requiredWhen se contradizem`).toBe(false);
      expect(f.readOnly ?? false, `${r.key}.${f.name}: readOnly não pode ser obrigatório`).toBe(false);
    }
  });

  it("5 · produtos: Categoria financeira (custo) é obrigatória quando Controla estoque = Sim (padrão Sim)", () => {
    const produtos = getResource("products");
    const campo = produtos?.fields.find((f) => f.name === "financial_category_id");
    expect(campo?.requiredWhen).toEqual({ field: "control_stock", equals: true });
    const controla = produtos?.fields.find((f) => f.name === "control_stock");
    expect(controla?.type).toBe("boolean");
    expect(controla?.default, "vazio vale o padrão: Controla estoque nasce Sim").toBe(true);
  });
});
