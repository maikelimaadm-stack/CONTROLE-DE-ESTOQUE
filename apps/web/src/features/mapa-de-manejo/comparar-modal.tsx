"use client";
import * as React from "react";
import { Dialog, Button, NativeSelect } from "@/components/ui";
import { dateBR, num } from "@/lib/utils";
import { CATALOGO_INDICES, INDICES_BUNDLE_ESSENCIAL } from "@agro/domain";
import { compararObservacoes, observacoesComparaveis } from "./condicao-modelo";
import { useHistoricosDaArea } from "./condicao-dados";

/** Variação com sinal e duas casas: "+0,14" / "−0,05" / "0,00". */
function comSinal(v: number): string {
  const t = num(Math.abs(v), 2);
  return v > 0 ? `+${t}` : v < 0 ? `−${t}` : t;
}

/**
 * Comparar A × B: duas datas da MESMA área lado a lado, médias por índice e variação (B − A). Só compara observações
 * calculadas sobre o mesmo contorno; contornos diferentes bloqueiam a comparação.
 */
export function CompararModal({ aberto, onFechar, areaId, areaNome }: { aberto: boolean; onFechar: () => void; areaId: string; areaNome: string }) {
  const hist = useHistoricosDaArea(areaId, INDICES_BUNDLE_ESSENCIAL, aberto);
  const referencia = hist.porIndice.ndvi;
  const datas = React.useMemo(() => (referencia ? observacoesComparaveis(referencia.itens) : []), [referencia]);
  const [a, setA] = React.useState("");
  const [b, setB] = React.useState("");

  React.useEffect(() => {
    if (!aberto || datas.length < 2) return;
    setA((x) => (x && datas.some((d) => d.chave === x) ? x : datas[1]!.chave));
    setB((x) => (x && datas.some((d) => d.chave === x) ? x : datas[0]!.chave));
  }, [aberto, datas]);

  const resultado = a && b && a !== b ? compararObservacoes(a, b, hist.porIndice) : null;

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => { if (!o) onFechar(); }}
      title={`Comparar datas — ${areaNome}`}
      description="Médias de cada índice nas duas datas, sobre o mesmo contorno da área."
      size="lg"
      testId="comparar-modal"
      footer={<Button type="button" variant="ghost" onClick={onFechar} data-testid="comparar-fechar">Fechar</Button>}
    >
      <div className="flex flex-col gap-3 text-sm">
        {hist.carregando && <p className="text-xs text-slate-500">Carregando o histórico…</p>}
        {hist.erro && <p className="text-xs text-red-600">Não foi possível carregar o histórico desta área.</p>}
        {!hist.carregando && datas.length < 2 && (
          <p className="text-xs text-slate-600" data-testid="comparar-poucas-datas">São necessárias ao menos duas datas com análise do contorno atual para comparar.</p>
        )}
        {datas.length >= 2 && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-600">Data A (antes)
              <NativeSelect value={a} onChange={(e) => setA(e.target.value)} data-testid="comparar-data-a" aria-label="Data A">
                {datas.map((d) => <option key={d.chave} value={d.chave}>{dateBR(d.data)}</option>)}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Data B (depois)
              <NativeSelect value={b} onChange={(e) => setB(e.target.value)} data-testid="comparar-data-b" aria-label="Data B">
                {datas.map((d) => <option key={d.chave} value={d.chave}>{dateBR(d.data)}</option>)}
              </NativeSelect>
            </label>
          </div>
        )}
        {a && b && a === b && <p className="text-xs text-amber-700">Escolha datas diferentes.</p>}
        {resultado?.tipo === "bloqueada" && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="alert" data-testid="comparar-bloqueada">{resultado.motivo}</p>}
        {resultado?.tipo === "ok" && (
          <table className="w-full text-[13px] tabular-nums" data-testid="comparar-tabela">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 font-medium">Índice</th>
                <th className="py-1 text-right font-medium">A · {dateBR(a)}</th>
                <th className="py-1 text-right font-medium">B · {dateBR(b)}</th>
                <th className="py-1 text-right font-medium">B − A</th>
              </tr>
            </thead>
            <tbody>
              {resultado.linhas.map((l) => (
                <tr key={l.indice} className="border-b border-slate-100" data-testid={`comparar-linha-${l.indice}`}>
                  <td className="py-1 font-medium text-slate-700">{CATALOGO_INDICES[l.indice].nome}</td>
                  <td className="py-1 text-right">{l.a === null ? "—" : num(l.a, 2)}</td>
                  <td className="py-1 text-right">{l.b === null ? "—" : num(l.b, 2)}</td>
                  <td className={`py-1 text-right font-medium ${l.delta === null ? "text-slate-400" : l.delta > 0 ? "text-green-700" : l.delta < 0 ? "text-red-700" : "text-slate-600"}`}>{l.delta === null ? "—" : comSinal(l.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[11px] text-slate-500">Variação de índice indica mudança no sinal de satélite; confirme em campo antes de decidir.</p>
      </div>
    </Dialog>
  );
}
