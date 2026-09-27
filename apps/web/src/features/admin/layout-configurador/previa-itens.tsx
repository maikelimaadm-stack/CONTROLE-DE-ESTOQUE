"use client";
import * as React from "react";
import estilos from "../../sales/central-vendas-workspace.module.css";
import { CampoPrevia } from "./campo-previa";
import { chaveDeColuna, useConfigurador, type ZonaDoLayout } from "./contrato";
import { useZonaDeSoltura } from "./zona";

const ZONA_ITENS: ZonaDoLayout = { tipo: "itens" };

/**
 * (C) Prévia da grade de itens: só o CABEÇALHO, com as colunas na ordem da estrutura (como a grade da Central, sem
 * dados). A zona aceita só colunas e reordena pela posição de soltura — a regra é de `useZonaDeSoltura`/operações.
 * Código, Estoque e Total são só leitura no catálogo: a `CampoPrevia` mostra o cadeado.
 */
export function PreviaItens() {
  const { estrutura, catalogo } = useConfigurador();
  const soltura = useZonaDeSoltura(ZONA_ITENS);
  const somenteLeitura = React.useMemo(
    () => new Set(catalogo.filter((c) => c.parte === "itens" && c.somenteLeitura).map((c) => c.chave)),
    [catalogo]
  );
  return (
    <section aria-label="Itens do documento" className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">Itens</h3>
      <div {...soltura} className={estilos.gradeRolagem} data-testid="config-zona-itens">
        <table className={estilos.grade} aria-label="Colunas dos itens">
          <thead><tr>
            {estrutura.itens.map((c) => (
              <th key={c.campo} data-somente-leitura={somenteLeitura.has(c.campo) ? "true" : undefined}>
                <CampoPrevia chave={chaveDeColuna(c.campo)} />
              </th>
            ))}
          </tr></thead>
        </table>
        {estrutura.itens.length === 0 && <p className="p-2 text-xs text-muted-foreground">Arraste colunas para cá.</p>}
      </div>
    </section>
  );
}
