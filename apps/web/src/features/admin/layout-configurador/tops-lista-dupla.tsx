"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { familiaTemLayout } from "@agro/domain";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { COPY } from "@/lib/copy";
import { Badge, Button, Dialog, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { BASE_LAYOUTS, TEXTOS, invalidarLayouts } from "./contrato";
import { consultaDetalheTops, lerTopsDoDetalhe, useTopsDoMovimento, type TopDoMovimento, type TopResumo } from "./tops-do-movimento";

/**
 * VISUALIZAR TOPs (VENDAS-A3-1d, decisão 262) — a lista dupla da A3-1c (Disponíveis × Ligadas, só TOPs do mesmo
 * movimento) dentro de um diálogo, aberto pela barra da grade e pelo status de uso. Salvar grava pela rota de hoje
 * (PUT /:id/tops). Uma TOP usa um layout só: ligar aqui uma TOP de outro layout a tira de lá (o aviso diz de qual —
 * `useTopsDoMovimento().ondeEsta`). Guardas: Salvar só com mudança; TOP selecionada e não movida avisa; fechar com
 * mudança não salva pergunta antes. `can()` só apresenta; quem nega é a rota.
 */
const NENHUMA: ReadonlySet<string> = new Set();
const mesmoConjunto = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export function VisualizarTopsDialogo({ layoutId, familia, onFechar }: { layoutId: string; familia: string; onFechar: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const detalhe = useQuery(consultaDetalheTops(layoutId));
  const movimento = familia || detalhe.data?.familia || "";
  const podeEditar = can("tipos_operacao.edit") && familiaTemLayout(movimento);
  const mov = useTopsDoMovimento(movimento);

  // Gravado = o do detalhe até o primeiro Salvar; depois, o que o servidor devolveu. `ligadas` null = sem mudança.
  const [gravado, setGravado] = React.useState<ReadonlySet<string> | null>(null);
  const [ligadas, setLigadas] = React.useState<ReadonlySet<string> | null>(null);
  const [selDisp, setSelDisp] = React.useState<ReadonlySet<string>>(NENHUMA);
  const [selLig, setSelLig] = React.useState<ReadonlySet<string>>(NENHUMA);
  const [salvo, setSalvo] = React.useState(false);
  const [salvas, setSalvas] = React.useState<readonly TopResumo[]>([]);
  const [confirmaDescarte, setConfirmaDescarte] = React.useState(false);

  const doDetalhe = React.useMemo(() => (detalhe.data ? new Set(detalhe.data.tops.map((t) => t.id)) : null), [detalhe.data]);
  const base = gravado ?? doDetalhe;
  const atuais = ligadas ?? base ?? NENHUMA;
  const sujo = ligadas !== null && base !== null && !mesmoConjunto(ligadas, base);

  const salvar = useMutation({
    mutationFn: (ids: string[]) => api<{ tops?: unknown } | null>(`${BASE_LAYOUTS}/${layoutId}/tops`, { method: "PUT", body: { tipoOperacaoIds: ids } }),
    onSuccess: (resposta, ids) => {
      // O PUT devolve as TOPs que ficaram ligadas: é o novo gravado. Sem a lista na resposta, vale o que foi enviado.
      const devolvidas = lerTopsDoDetalhe(resposta);
      setGravado(new Set(Array.isArray(resposta?.tops) ? devolvidas.map((t) => t.id) : ids));
      setSalvas(devolvidas);
      setLigadas(null);
      setSalvo(true);
      void invalidarLayouts(qc);
    }
  });
  const bloqueado = !podeEditar || salvar.isPending;

  const mover = (ids: Iterable<string>, ligar: boolean) => {
    const lista = [...ids];
    if (bloqueado || lista.length === 0) return;
    setSalvo(false);
    if (salvar.isError) salvar.reset();
    setLigadas((l) => { const n = new Set(l ?? base ?? NENHUMA); for (const id of lista) { if (ligar) n.add(id); else n.delete(id); } return n; });
    if (ligar) setSelDisp(NENHUMA); else setSelLig(NENHUMA);
  };
  const alternar = (set: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>, id: string) =>
    set((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const pedirFechar = () => {
    if (salvar.isPending) return;
    if (sujo) setConfirmaDescarte(true); else onFechar();
  };

  const tops = mov.tops;
  const disponiveis = tops.filter((t) => !atuais.has(t.id));
  const noLayout = tops.filter((t) => atuais.has(t.id));
  // TOP ligada que a lista do movimento não trouxe (fora do filtro/limite) continua visível e removível.
  const doMovimento = new Set(tops.map((t) => t.id));
  const conhecidas = new Map<string, TopResumo>([...(detalhe.data?.tops ?? []), ...salvas].map((t) => [t.id, t]));
  const extras = [...atuais].filter((id) => !doMovimento.has(id))
    .map((id): TopDoMovimento => ({ ...(conhecidas.get(id) ?? { id, codigo: "", nome: "TOP fora da lista do movimento" }), ativo: true }));
  // Espera o detalhe e a lista de TOPs; o "sairá do layout X" (detalhes dos outros layouts) aparece quando chegar.
  const carregando = detalhe.isPending || (mov.carregando && tops.length === 0);

  const item = (t: TopDoMovimento, ligada: boolean) => {
    const sel = ligada ? selLig.has(t.id) : selDisp.has(t.id);
    const onde = ligada ? mov.ondeEsta.get(t.id) : undefined;
    const outro = onde && onde.layoutId !== layoutId ? onde.nome : undefined;
    return <li key={t.id} data-testid={`config-top-${t.id}`} data-selecionado={sel ? "true" : "false"}>
      <button type="button" aria-pressed={sel} disabled={bloqueado}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] ${sel ? "bg-emerald-100 text-emerald-900" : "hover:bg-slate-100"}`}
        onClick={() => alternar(ligada ? setSelLig : setSelDisp, t.id)}
        onDoubleClick={() => mover([t.id], !ligada)}>
        <span className="flex-1">{t.codigo ? `${t.codigo} — ${t.nome}` : t.nome}</span>
        {!t.ativo && <Badge tone="slate">Inativa</Badge>}
      </button>
      {outro && <span data-testid="config-tops-aviso" className="block px-2 text-[11.5px] text-amber-700">sairá do layout {outro}</span>}
    </li>;
  };

  return <>
    <Dialog open onOpenChange={(o) => { if (!o) pedirFechar(); }} title={TEXTOS.visualizarTops} size="lg" testId="config-tops-dialogo"
      description={detalhe.data ? (detalhe.data.code ? `${detalhe.data.code} — ${detalhe.data.nome}` : detalhe.data.nome) : undefined}
      preventClose={salvar.isPending}
      footer={<Button variant="outline" data-testid="config-tops-fechar" disabled={salvar.isPending} onClick={pedirFechar}>{COPY.fechar}</Button>}>
      <section data-testid="config-tops" className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-[13px] font-semibold text-slate-700">TOPs ligadas</h3>
          {podeEditar && <Button size="sm" data-testid="config-tops-salvar" loading={salvar.isPending}
            disabled={!sujo || salvar.isPending} onClick={() => salvar.mutate([...atuais])}>Salvar TOPs ligadas</Button>}
        </div>
        <p className="text-[12px] text-slate-500">Só TOPs deste movimento. Uma TOP usa um layout só: ligar aqui uma TOP que está em outro layout a tira de lá. Duplo clique move.</p>
        {salvo && <p data-testid="config-tops-salvo" className="text-[12px] text-emerald-700">TOPs ligadas salvas.</p>}
        {salvar.isError && <ErrorState error={salvar.error} />}
        {detalhe.isError ? <ErrorState error={detalhe.error} />
          : carregando ? <LoadingState variant="compact" />
          : <>
              {mov.erro ? <ErrorState error={mov.erro} /> : null}
              {tops.length === 0 && extras.length === 0 ? (mov.erro ? null : <EmptyState compact title="Nenhum tipo de operação deste movimento." />)
                : <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
                    <div>
                      <p className="mb-1 text-[12px] font-semibold text-slate-600">Disponíveis</p>
                      <ul data-testid="config-tops-disponiveis" aria-label="TOPs disponíveis" className="min-h-[120px] rounded border border-slate-200 p-1">
                        {disponiveis.map((t) => item(t, false))}
                      </ul>
                    </div>
                    <div className="emp-layout-config-transfer flex flex-col justify-center gap-2">
                      <Button size="sm" variant="outline" data-testid="config-tops-mover" disabled={bloqueado || selDisp.size === 0} onClick={() => mover(selDisp, true)}>Mover →</Button>
                      <Button size="sm" variant="outline" data-testid="config-tops-remover" disabled={bloqueado || selLig.size === 0} onClick={() => mover(selLig, false)}>← Remover</Button>
                    </div>
                    <div>
                      <p className="mb-1 text-[12px] font-semibold text-slate-600">Ligadas</p>
                      <ul data-testid="config-tops-ligadas" aria-label="TOPs ligadas" className="min-h-[120px] rounded border border-slate-200 p-1">
                        {[...noLayout, ...extras].map((t) => item(t, true))}
                      </ul>
                    </div>
                  </div>}
            </>}
        {/* A3-1d: o aviso fica ABAIXO das listas — acima, ele empurraria as TOPs no 1º clique e o duplo clique erraria o alvo */}
        {selDisp.size > 0 && <p data-testid="config-tops-pendente" role="status"
          className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{TEXTOS.topsPendente}</p>}
      </section>
    </Dialog>
    <Dialog open={confirmaDescarte} onOpenChange={setConfirmaDescarte} title="Descartar mudanças" size="sm" testId="config-tops-descartar-dialogo"
      footer={<>
        <Button variant="outline" data-testid="config-tops-descartar-voltar" onClick={() => setConfirmaDescarte(false)}>{COPY.voltar}</Button>
        <Button variant="danger" data-testid="config-tops-descartar" onClick={() => { setConfirmaDescarte(false); onFechar(); }}>Descartar</Button>
      </>}>
      <p className="text-sm text-slate-600">{TEXTOS.descartarTops}</p>
    </Dialog>
  </>;
}
