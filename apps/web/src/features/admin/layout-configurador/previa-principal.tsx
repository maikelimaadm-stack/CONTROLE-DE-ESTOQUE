"use client";
import * as React from "react";
import { ChevronDown, LockKeyhole } from "lucide-react";
import { camposAdicionaisDoCabecalho, familiaDeCompras, familiaDeEstoque } from "@agro/domain";
import { CampoPrevia } from "./campo-previa";
import { useConfigurador } from "./contrato";
import { useZonaDeSoltura } from "./zona";

/**
 * Prévia do cabeçalho (VENDAS-A3-1c): "Dados principais" na ordem do layout, com a linha "Operação" fixa logo depois da
 * Empresa (ou depois dos dois primeiros) — a mesma regra da Central — e o grupo "Dados adicionais" aberto.
 * COMPRAS-03 (decisão 269): nos movimentos de compra a "Operação" vem PRIMEIRO — é onde a Central de Compras põe o Tipo
 * de Operação, abrindo a grade do cabeçalho. A prévia mostra a tela que o layout vai governar, não a de vendas.
 * OPERACOES-01 F5b (decisão 282): nos movimentos de estoque também — a Central de Estoque abre os Dados principais pelo
 * Tipo de Operação.
 */
export function PreviaPrincipal() {
  const ctx = useConfigurador();
  const zonaPrincipal = useZonaDeSoltura({ tipo: "principal" });
  const zonaAdicionais = useZonaDeSoltura({ tipo: "adicionais" });
  const adicionais = camposAdicionaisDoCabecalho(ctx.estrutura);
  const principais = ctx.estrutura.cabecalho.map((x) => x.campo).filter((c) => !adicionais.includes(c));
  const posEmpresa = principais.indexOf("empresa_id");
  const posOperacao = familiaDeCompras(ctx.familia) || familiaDeEstoque(ctx.familia) ? 0 : posEmpresa >= 0 ? posEmpresa + 1 : Math.min(2, principais.length);

  const operacao = (
    <div key="__operacao" className="emp-layout-config-field-slot" style={{ flex: "3 1 0" }}>
      <div data-testid="config-operacao-fixa" className="emp-layout-config-field emp-layout-config-field-panel emp-layout-config-field-required emp-layout-config-field-readonly" title="A operação vem da TOP escolhida e não sai do layout.">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">Operação</span>
        <span className="emp-layout-config-field-status-icons flex items-center"><LockKeyhole className="h-3 w-3" aria-label="Fixo" /></span>
      </div>
    </div>
  );
  const itens: React.ReactNode[] = principais.map((c) => <CampoPrevia key={c} chave={c} />);
  itens.splice(posOperacao, 0, operacao);

  return (
    <section className="emp-layout-config-card-shell space-y-2 p-2" aria-label="Cabeçalho">
      <div className="emp-layout-config-row-header"><span className="emp-layout-config-row-label">Dados principais</span></div>
      <div {...zonaPrincipal} data-testid="config-zona-principal" className="emp-layout-config-panel-fields flex-wrap">
        {itens}
      </div>
      <details open className="rounded border border-slate-200">
        <summary className="flex cursor-pointer items-center gap-1 px-2 py-1 text-xs font-semibold">
          <ChevronDown className="h-3 w-3" aria-hidden /> Dados adicionais <span className="font-normal text-slate-500">· {adicionais.length} {adicionais.length === 1 ? "campo" : "campos"}</span>
        </summary>
        <div {...zonaAdicionais} data-testid="config-zona-adicionais" className="emp-layout-config-panel-fields flex-wrap p-2">
          {adicionais.length === 0 && <span className="emp-layout-config-row-dropzone">{ctx.editando ? "Arraste campos para Dados adicionais" : "Nenhum campo em Dados adicionais"}</span>}
          {adicionais.map((c) => <CampoPrevia key={c} chave={c} />)}
        </div>
      </details>
    </section>
  );
}
