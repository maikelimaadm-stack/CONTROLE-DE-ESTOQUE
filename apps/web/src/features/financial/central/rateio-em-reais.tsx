"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { D, money, sum, type Decimal } from "@agro/shared";
import { diferencaDoRateio } from "@agro/domain";
import { Button, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { brl, cn } from "@/lib/utils";

/**
 * DINHEIRO DIGITADO → DECIMAL (Central Financeira, decisão 285). O campo numérico do navegador entrega texto com ponto
 * decimal ("1234.5") ou vazio; o que não é número volta `null` — nunca vira zero em silêncio e nunca passa por
 * `Number()`, que arredonda em ponto flutuante. É a régua de toda conta de dinheiro das telas da Central.
 */
export function lerDecimal(v: string | null | undefined): Decimal | null {
  const t = (v ?? "").trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? D(t) : null;
}

/** Uma linha do rateio em R$: natureza, centro de resultado, safra e área (as duas últimas opcionais) e o valor. */
export interface LinhaRateio { financial_category_id: string; cost_center_id: string; harvest_id: string; area_id: string; amount: string }
export const linhaDeRateioVazia = (amount = ""): LinhaRateio => ({ financial_category_id: "", cost_center_id: "", harvest_id: "", area_id: "", amount });

export interface SituacaoDoRateio {
  /** Σ dos valores digitados (2 casas). */
  soma: string;
  /** total − Σ (positivo: falta; negativo: sobra); `null` quando o total não é um valor válido. */
  diferenca: string | null;
  /** Diferença ZERO, todo valor válido e positivo, natureza e centro em toda linha: é o que libera o Salvar. */
  fechado: boolean;
}

/**
 * Situação do rateio contra o total (o valor LÍQUIDO do título). A diferença sai de `diferencaDoRateio` do domínio — a
 * mesma régua com que o servidor recusa o rateio que não fecha (`exigirRateioFechado`), sem a tolerância de centavos do
 * rateio por percentual. Linha de valor zero não fecha: o banco exige percentual positivo em cada linha.
 */
export function situacaoDoRateio(total: string | null, linhas: readonly LinhaRateio[]): SituacaoDoRateio {
  const valores = linhas.map((l) => lerDecimal(l.amount));
  const soma = money(sum(valores.map((v) => v ?? D(0))));
  if (total === null) return { soma, diferenca: null, fechado: false };
  const diferenca = diferencaDoRateio(total, valores.map((v) => (v ?? D(0)).toFixed()));
  const valido = linhas.length > 0 && valores.every((v) => v !== null && v.gt(0)) && linhas.every((l) => l.financial_category_id && l.cost_center_id);
  return { soma, diferenca, fechado: valido && D(diferenca).isZero() };
}

/** O corpo da API: cada linha com o VALOR (o servidor exige que feche no líquido); safra e área vazias vão nulas. */
export const rateioParaApi = (linhas: readonly LinhaRateio[]) => linhas.map((l) => ({
  financial_category_id: l.financial_category_id, cost_center_id: l.cost_center_id,
  harvest_id: l.harvest_id || null, area_id: l.area_id || null, amount: money(lerDecimal(l.amount) ?? D(0))
}));

/**
 * RATEIO EM R$ DO LANÇAMENTO (OPERACOES-01 F8, decisão 285): natureza, centro de resultado, safra e área por linha, em
 * reais, fechando EXATAMENTE no valor líquido do título. Com uma linha só, ela acompanha o líquido (não há o que
 * ratear); com duas ou mais, o usuário distribui e a tela mostra quanto falta, quanto sobra ou que fechou — o Salvar só
 * libera com o rateio fechado. A conta é apresentação: quem recusa o rateio que não fecha é o servidor.
 */
export function RateioEmReais({ total, linhas, onChange, desabilitado }: { total: string | null; linhas: LinhaRateio[]; onChange: (l: LinhaRateio[]) => void; desabilitado?: boolean }) {
  const unica = linhas.length === 1;
  // Linha única acompanha o líquido. A guarda (valor diferente) impede o laço: o efeito só escreve quando há o que mudar.
  React.useEffect(() => {
    if (!desabilitado && unica && total !== null && linhas[0]!.amount !== total) onChange([{ ...linhas[0]!, amount: total }]);
  }, [total, unica, desabilitado, linhas, onChange]);
  const s = situacaoDoRateio(total, linhas);
  const upd = (i: number, k: keyof LinhaRateio, v: string) => onChange(linhas.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const acrescentar = () => {
    // A linha nova nasce com o que FALTA (nunca negativo): com o rateio fechado, ela nasce zerada e o usuário distribui.
    const falta = s.diferenca !== null && D(s.diferenca).gt(0) ? s.diferenca : "";
    onChange([...linhas, linhaDeRateioVazia(falta)]);
  };
  const dif = s.diferenca === null ? null : D(s.diferenca);
  const texto = dif === null ? "Informe o valor do título" : dif.isZero() ? "Rateio fechado" : dif.gt(0) ? `Falta ${brl(dif.toFixed(2))}` : `Sobra ${brl(dif.abs().toFixed(2))}`;
  return <div className="overflow-x-auto rounded border" data-testid="fin-rateio">
    <table className="table-dense w-full text-[12.5px]">
      <thead><tr><th className="min-w-[220px]">Natureza</th><th className="min-w-[200px]">Centro de resultado</th><th className="min-w-[160px]">Safra</th><th className="min-w-[160px]">Área</th><th className="w-36 text-right">Valor</th><th className="w-8" /></tr></thead>
      <tbody>
        {linhas.map((l, i) => <tr key={i}>
          <td><RefSelect resource="financial_categories" value={l.financial_category_id || null} onChange={(v) => upd(i, "financial_category_id", v ?? "")} filter={{ kind: "analytic" }} disabled={desabilitado} /></td>
          <td><RefSelect resource="cost_centers" value={l.cost_center_id || null} onChange={(v) => upd(i, "cost_center_id", v ?? "")} filter={{ kind: "analytic" }} disabled={desabilitado} /></td>
          <td><RefSelect resource="harvests" value={l.harvest_id || null} onChange={(v) => upd(i, "harvest_id", v ?? "")} disabled={desabilitado} /></td>
          <td><RefSelect resource="areas" value={l.area_id || null} onChange={(v) => upd(i, "area_id", v ?? "")} disabled={desabilitado} /></td>
          <td><Input type="number" step="0.01" min="0" className="text-right" aria-label={`Valor da linha ${i + 1} do rateio`} value={l.amount} disabled={desabilitado || unica} title={unica ? "Com uma linha só, o rateio acompanha o valor líquido do título" : undefined} onChange={(e) => upd(i, "amount", e.target.value)} /></td>
          <td>{!desabilitado && linhas.length > 1 && <button type="button" className="p-1 text-slate-400 hover:text-red-600" aria-label={`Remover a linha ${i + 1} do rateio`} onClick={() => onChange(linhas.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}</td>
        </tr>)}
      </tbody>
      <tfoot><tr><td colSpan={6} className="p-2">
        <span className="flex flex-wrap items-center gap-4">
          {!desabilitado && <Button type="button" size="sm" variant="outline" onClick={acrescentar}><Plus className="h-3.5 w-3.5" /> Adicionar linha</Button>}
          <span className="font-semibold">Total do rateio: {brl(s.soma)}</span>
          <span data-testid="fin-rateio-diferenca" data-diferenca={s.diferenca ?? ""} className={cn("font-semibold", dif !== null && dif.isZero() ? "text-green-700" : "text-red-600")}>{texto}</span>
        </span>
      </td></tr></tfoot>
    </table>
  </div>;
}
