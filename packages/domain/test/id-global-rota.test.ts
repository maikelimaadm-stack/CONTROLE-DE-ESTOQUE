import { describe, it, expect } from "vitest";
import { variantesDeclaradas } from "@erp/plataforma";
import { ENTIDADES_ID_GLOBAL } from "../src/id-global.js";
import { entidadeDaRota, ROTAS_CANONICAS_ID_GLOBAL } from "../src/id-global-rota.js";

/**
 * COBERTURA VISUAL (PRE-BASE2-04 §36): o `#N` aparece porque a UI reconhece, pela ROTA ABERTA, qual entidade
 * e qual registro estão na tela. Se uma rota canônica do catálogo não for reconhecida, aquela tela nunca
 * mostra a identidade — e o buraco seria invisível, porque nada quebra: o badge simplesmente não aparece.
 *
 * Este teste percorre o catálogo inteiro, VARIANTE POR VARIANTE, e exige que o detector acerte. É o que
 * substitui 23 edições manuais por uma prova.
 */
const UUID = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("detector de rota da UI — 100% do catálogo", () => {
  it("toda rota canônica declarada (incluindo cada variante) é reconhecida", () => {
    const naoReconhecidas: string[] = [];
    for (const e of ENTIDADES_ID_GLOBAL) {
      const rotas = e.resolucao.tipo === "fixa"
        ? [{ variante: "-", rota: e.resolucao.rota }]
        : variantesDeclaradas(e).map((v) => ({ variante: v, rota: (e.resolucao as { variantes: Record<string, { rota: string }> }).variantes[v]!.rota }));
      for (const { variante, rota } of rotas) {
        const pathname = rota.replace(":id", UUID).split("?")[0]!;
        const achado = entidadeDaRota(pathname);
        if (!achado || achado.tipo !== e.tipoEntidade || achado.id !== UUID) {
          naoReconhecidas.push(`${e.tipoEntidade}[${variante}] → ${pathname} (achou ${JSON.stringify(achado)})`);
        }
      }
    }
    expect(naoReconhecidas, "rota canônica sem exibição de #N").toEqual([]);
  });

  it("o detector deriva do catálogo, então cresce sozinho", () => {
    expect(ROTAS_CANONICAS_ID_GLOBAL.length, "uma rota por variante declarada").toBeGreaterThanOrEqual(ENTIDADES_ID_GLOBAL.length);
  });

  it("telas que NÃO são detalhe de registro não disparam consulta", () => {
    for (const rota of ["/os", "/os/nova", "/cadastros/products", "/cadastros/products/novo", "/pecuaria", "/", "/financeiro/contas-a-pagar", "/pecuaria/animais/abc"]) {
      expect(entidadeDaRota(rota), `${rota} não é um registro`).toBeNull();
    }
  });

  it("a consulta (`?view=1`) faz parte da rota canônica do cadastro, mas não do pathname", () => {
    expect(entidadeDaRota(`/cadastros/products/${UUID}`)).toEqual({ tipo: "products", id: UUID });
    expect(entidadeDaRota(`/cadastros/people/${UUID}`)).toEqual({ tipo: "people", id: UUID });
  });
});
