import { describe, it, expect } from "vitest";
import { ENTIDADES_ID_GLOBAL, colunaDiscriminadora, resolverRegistroGlobal, validarRegistroIdGlobal, variantesDeclaradas } from "@erp/plataforma";
import { allPermissionKeys } from "@agro/domain";

/**
 * O registry de ID Global vive no núcleo neutro (`@erp/plataforma`), que por contrato NUNCA importa o
 * catálogo de permissões do domínio. O cruzamento entre os dois acontece aqui, na API — que já depende dos
 * dois lados — para que segurança não fique dependendo de um texto livre nunca conferido.
 */
const CATALOGO = new Set(allPermissionKeys());

describe("registry de ID Global × catálogo de permissões", () => {
  it("o registry é estruturalmente íntegro", () => {
    expect(validarRegistroIdGlobal()).toEqual([]);
  });

  it("toda permissão declarada existe no catálogo real", () => {
    const desconhecidas: string[] = [];
    for (const e of ENTIDADES_ID_GLOBAL) {
      const r = e.resolucao;
      if (r.tipo === "fixa") {
        if (!CATALOGO.has(r.permissao)) desconhecidas.push(`${e.tipoEntidade}: ${r.permissao}`);
      } else {
        for (const [valor, v] of Object.entries(r.variantes)) {
          if (!CATALOGO.has(v.permissao)) desconhecidas.push(`${e.tipoEntidade}[${valor}]: ${v.permissao}`);
        }
      }
    }
    expect(desconhecidas).toEqual([]);
  });

  it("toda variante resolve rota e permissão, e nenhuma variante repete a permissão de outra", () => {
    for (const e of ENTIDADES_ID_GLOBAL) {
      const coluna = colunaDiscriminadora(e);
      if (!coluna) continue;
      const permissoes = new Set<string>();
      for (const valor of variantesDeclaradas(e)) {
        const resolvido = resolverRegistroGlobal(e.tipoEntidade, "id", { [coluna]: valor });
        expect(resolvido, `${e.tipoEntidade}[${valor}]`).not.toBeNull();
        expect(permissoes.has(resolvido!.permissao), `${e.tipoEntidade}[${valor}]: permissão repetida entre variantes`).toBe(false);
        permissoes.add(resolvido!.permissao);
      }
    }
  });

  it("a matriz de manejo e movimentação é a mesma já usada na autorização de anexos", () => {
    const manejo: Record<string, string> = { nutrition: "nutritions.view", sanitary: "sanitaries.view", weaning: "weanings.view", separation: "separations.view", pasture: "pastures.view", locate: "locate_animals.view" };
    const movimento: Record<string, string> = { purchase: "animal_purchases.view", sale: "animal_sales.view", birth: "animal_births.view", death: "animal_deaths.view", loss: "animal_losses.view" };
    for (const [tipo, permissao] of Object.entries(manejo)) {
      expect(resolverRegistroGlobal("animal_handlings", "id", { handling_type: tipo })?.permissao, tipo).toBe(permissao);
    }
    for (const [tipo, permissao] of Object.entries(movimento)) {
      expect(resolverRegistroGlobal("animal_movements", "id", { movement_type: tipo })?.permissao, tipo).toBe(permissao);
    }
  });
});
