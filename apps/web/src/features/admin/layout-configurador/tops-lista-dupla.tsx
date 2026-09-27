"use client";
import * as React from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { Badge, Button, EmptyState, ErrorState, LoadingState } from "@/components/ui";

/**
 * TOPs LIGADAS EM LISTA DUPLA (VENDAS-A3-1c, decisão 261): Disponíveis × Ligadas, só TOPs do mesmo movimento
 * (`codigoBase`). Salvar grava pela rota de hoje (PUT /:id/tops). Uma TOP usa um layout só: ligar aqui uma TOP de outro
 * layout a tira de lá (o aviso diz de qual — lido dos detalhes dos OUTROS layouts do movimento, como na tela anterior).
 */
const BASE = "/api/admin/layouts-documento";

export interface TopLigadaResumo { id: string; codigo: string; nome: string }
interface TopDoMovimento { id: string; codigo: string; nome: string; ativo: boolean }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const itens = (v: unknown): unknown[] => (Array.isArray(v) ? v : Array.isArray(obj(v).items) ? (obj(v).items as unknown[]) : []);
const idDaTop = (v: unknown) => (typeof v === "string" ? v : str(obj(v).id ?? obj(v).tipoOperacaoId ?? obj(v).tipo_operacao_id));

export function TopsListaDupla({ layoutId, familia, podeEditar, ligadas }: {
  layoutId: string; familia: string; podeEditar: boolean; ligadas: readonly TopLigadaResumo[];
}) {
  const qc = useQueryClient();
  const [marcadas, setMarcadas] = React.useState<ReadonlySet<string>>(() => new Set(ligadas.map((t) => t.id)));
  const [selDisp, setSelDisp] = React.useState<ReadonlySet<string>>(() => new Set());
  const [selLig, setSelLig] = React.useState<ReadonlySet<string>>(() => new Set());
  const [salvo, setSalvo] = React.useState(false);

  const topsQ = useQuery({
    queryKey: ["tipos-operacao", "por-familia", familia],
    queryFn: async () => itens(await api<unknown>(`/api/admin/tipos-operacao${qs({ codigoBase: familia, pageSize: 1000 })}`))
      .map((x): TopDoMovimento => { const o = obj(x); return { id: str(o.id), codigo: str(o.codigo), nome: str(o.nome), ativo: Boolean(o.ativo) }; })
  });
  const outrosQ = useQuery({
    queryKey: ["layouts-documento", "lista", familia],
    queryFn: async () => itens(await api<unknown>(`${BASE}${qs({ familia })}`)).map(obj)
  });
  const outros = (outrosQ.data ?? []).filter((l) => str(l.id) !== layoutId && Number(l.qtdTops ?? l.topsLigadas ?? 0) > 0);
  const detalhes = useQueries({
    queries: outros.map((l) => ({
      queryKey: ["layouts-documento", str(l.id), "tops-de-outro"],
      queryFn: async () => { const d = obj(await api<unknown>(`${BASE}/${str(l.id)}`)); return { nome: str(d.nome), tops: itens(d.tops).map(idDaTop) }; }
    }))
  });
  const ondeEsta = new Map<string, string>();
  detalhes.forEach((q) => { if (q.data) for (const t of q.data.tops) ondeEsta.set(t, q.data.nome); });

  const salvar = useMutation({
    mutationFn: () => api(`${BASE}/${layoutId}/tops`, { method: "PUT", body: { tipoOperacaoIds: [...marcadas] } }),
    onSuccess: () => { setSalvo(true); void qc.invalidateQueries({ queryKey: ["layouts-documento"] }); }
  });

  const tops = topsQ.data ?? [];
  const disponiveis = tops.filter((t) => !marcadas.has(t.id));
  const noLayout = tops.filter((t) => marcadas.has(t.id));
  // TOP ligada que a lista do movimento não trouxe (excluída/fora do filtro) continua visível e removível.
  const extras = ligadas.filter((t) => marcadas.has(t.id) && !tops.some((x) => x.id === t.id)).map((t) => ({ ...t, ativo: true }));

  const mover = (ids: Iterable<string>, ligar: boolean) => {
    const lista = [...ids];
    if (!podeEditar || lista.length === 0) return;
    setSalvo(false);
    setMarcadas((m) => { const n = new Set(m); for (const id of lista) { if (ligar) n.add(id); else n.delete(id); } return n; });
    if (ligar) setSelDisp(new Set()); else setSelLig(new Set());
  };
  const alternar = (set: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>, id: string) =>
    set((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const item = (t: TopDoMovimento, ligada: boolean) => {
    const sel = ligada ? selLig.has(t.id) : selDisp.has(t.id);
    const outro = ligada ? ondeEsta.get(t.id) : undefined;
    return <li key={t.id} data-testid={`config-top-${t.id}`} data-selecionado={sel ? "true" : undefined}>
      <button type="button" aria-pressed={sel} disabled={!podeEditar}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] ${sel ? "bg-emerald-100 text-emerald-900" : "hover:bg-slate-100"}`}
        onClick={() => alternar(ligada ? setSelLig : setSelDisp, t.id)}
        onDoubleClick={() => mover([t.id], !ligada)}>
        <span className="flex-1">{t.codigo} — {t.nome}</span>
        {!t.ativo && <Badge tone="slate">Inativa</Badge>}
      </button>
      {outro && <span data-testid="config-tops-aviso" className="block px-2 text-[11.5px] text-amber-700">sairá do layout {outro}</span>}
    </li>;
  };

  return <section data-testid="config-tops" className="mt-4 border-t border-slate-200 pt-3">
    <div className="mb-1 flex items-center gap-2">
      <h3 className="flex-1 text-[13px] font-semibold text-slate-700">TOPs ligadas</h3>
      {podeEditar && <Button size="sm" variant="outline" data-testid="config-tops-salvar" loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar TOPs ligadas</Button>}
    </div>
    <p className="mb-2 text-[12px] text-slate-500">Só TOPs deste movimento. Uma TOP usa um layout só: ligar aqui uma TOP que está em outro layout a tira de lá. Duplo clique move.</p>
    {salvo && <p data-testid="config-tops-salvo" className="mb-1 text-[12px] text-emerald-700">TOPs ligadas salvas.</p>}
    {salvar.isError && <ErrorState error={salvar.error} />}
    {topsQ.isLoading ? <LoadingState variant="compact" /> : topsQ.isError ? <ErrorState error={topsQ.error} />
      : tops.length === 0 && extras.length === 0 ? <EmptyState compact title="Nenhum tipo de operação deste movimento." />
      : <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
          <div>
            <p className="mb-1 text-[12px] font-semibold text-slate-600">Disponíveis</p>
            <ul data-testid="config-tops-disponiveis" aria-label="TOPs disponíveis" className="min-h-[120px] rounded border border-slate-200 p-1">
              {disponiveis.map((t) => item(t, false))}
            </ul>
          </div>
          <div className="emp-layout-config-transfer flex flex-col justify-center gap-2">
            <Button size="sm" variant="outline" data-testid="config-tops-mover" disabled={!podeEditar || selDisp.size === 0} onClick={() => mover(selDisp, true)}>Mover →</Button>
            <Button size="sm" variant="outline" data-testid="config-tops-remover" disabled={!podeEditar || selLig.size === 0} onClick={() => mover(selLig, false)}>← Remover</Button>
          </div>
          <div>
            <p className="mb-1 text-[12px] font-semibold text-slate-600">Ligadas</p>
            <ul data-testid="config-tops-ligadas" aria-label="TOPs ligadas" className="min-h-[120px] rounded border border-slate-200 p-1">
              {[...noLayout, ...extras].map((t) => item(t, true))}
            </ul>
          </div>
        </div>}
  </section>;
}
