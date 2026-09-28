"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { COPY } from "@/lib/copy";
import { Button, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, NativeSelect } from "@/components/ui";
import { BASE_LAYOUTS, TEXTOS, chaveLista, invalidarLayouts, lerLinhaLayout, rotuloDaTop } from "./contrato";
import { useTopsDoMovimento } from "./tops-do-movimento";

/**
 * NOVO LAYOUT — ASSISTENTE EM 3 PASSOS (VENDAS-A3-1d, decisão 262; a criação é a da A3-1c, decisão 261).
 *  1. Movimento e descrição — mudar o movimento reinicia o modelo e as TOPs escolhidas (as duas coisas são do movimento).
 *  2. Modelo — o layout do sistema (POST sem estrutura: o servidor copia o do sistema do movimento) ou um layout ATIVO do
 *     mesmo movimento (POST /:id/duplicar e depois PUT do nome).
 *  3. Onde usar — "Usar como padrão" (POST /:id/padrao: o servidor troca o padrão atual) e/ou TOPs ATIVAS do movimento
 *     (PUT /:id/tops: uma TOP usa um layout só — a que está em outro layout sai de lá). Sem nenhum dos dois o layout nasce
 *     sem uso: aviso, e pode criar.
 * "Criar" grava NESSA ORDEM, chama `invalidarLayouts` e entrega o id à tela (`onCriado`), que o SELECIONA — o assistente
 * não navega. Só a criação não é idempotente no servidor: se um passo seguinte falhar, o id criado fica guardado e "Criar"
 * de novo conclui o que faltou (nome, padrão e TOPs são idempotentes) em vez de criar um segundo layout; movimento e modelo
 * travam. Fechar depois disso também entrega à tela o layout que já existe.
 */
const SISTEMA = "sistema";
type Passo = 1 | 2 | 3;
const TITULOS: Record<Passo, string> = { 1: "1. Movimento e descrição", 2: "2. Modelo", 3: "3. Onde usar" };

type Top = ReturnType<typeof useTopsDoMovimento>["tops"][number];
/** O que já foi gravado nesta abertura do assistente (para "Criar" de novo não duplicar o layout). */
interface Feito { id: string | null; nome: string | null; padrao: boolean }
const NADA_FEITO: Feito = { id: null, nome: null, padrao: false };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const itens = (v: unknown): unknown[] => (Array.isArray(v) ? v : Array.isArray(obj(v).items) ? (obj(v).items as unknown[]) : []);
const idDoCriado = (v: unknown) => {
  const id = str(obj(v).id);
  if (!id) throw new Error("O servidor não devolveu o layout criado.");
  return id;
};

export function NovoLayoutAssistente({ familias, onFechar, onCriado }: {
  familias: readonly { codigo: string; rotulo: string }[];
  onFechar: () => void;
  /** a tela seleciona o layout criado; o assistente se fecha logo depois (`onFechar`) */
  onCriado: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [passo, setPasso] = React.useState<Passo>(1);
  const [familiaEscolhida, setFamilia] = React.useState(familias[0]?.codigo ?? "");
  // A lista de movimentos pode chegar depois de abrir: sem escolha válida, vale o primeiro.
  const familia = familias.some((f) => f.codigo === familiaEscolhida) ? familiaEscolhida : (familias[0]?.codigo ?? "");
  const [nome, setNome] = React.useState("");
  const [origem, setOrigem] = React.useState(SISTEMA);
  const [padrao, setPadrao] = React.useState(false);
  const [ligadas, setLigadas] = React.useState<ReadonlySet<string>>(() => new Set());
  const feitoRef = React.useRef<Feito>(NADA_FEITO);
  const [feito, setFeito] = React.useState<Feito>(NADA_FEITO);
  const marcar = (p: Partial<Feito>) => { feitoRef.current = { ...feitoRef.current, ...p }; setFeito(feitoRef.current); };

  // Modelos: layouts ATIVOS do movimento (mesma chave e mesma leitura da lista da tela).
  const origensQ = useQuery({
    queryKey: chaveLista(familia),
    enabled: Boolean(familia),
    queryFn: () => api<unknown>(`${BASE_LAYOUTS}${qs({ familia })}`),
    select: (d) => itens(d).map(lerLinhaLayout).filter((l) => l.ativo)
  });
  const origens = origensQ.data ?? [];
  const origemValida = origem === SISTEMA || origens.some((l) => l.id === origem);

  const criar = useMutation({
    mutationFn: async (): Promise<string> => {
      const n = nome.trim();
      const tipoOperacaoIds = [...ligadas];
      try {
        let id = feitoRef.current.id;
        if (!id) {
          if (origem === SISTEMA) {
            id = idDoCriado(await api<unknown>(BASE_LAYOUTS, { method: "POST", body: { familia, nome: n } }));
            marcar({ id, nome: n });
          } else {
            if (!origemValida) throw new Error("O layout escolhido como modelo não está mais ativo. Volte ao passo 2 e escolha outro.");
            id = idDoCriado(await api<unknown>(`${BASE_LAYOUTS}/${origem}/duplicar`, { method: "POST", body: {} }));
            marcar({ id });
          }
        }
        if (feitoRef.current.nome !== n) {
          await api(`${BASE_LAYOUTS}/${id}`, { method: "PUT", body: { nome: n } });
          marcar({ nome: n });
        }
        if (padrao && !feitoRef.current.padrao) {
          await api(`${BASE_LAYOUTS}/${id}/padrao`, { method: "POST", body: {} });
          marcar({ padrao: true });
        }
        if (tipoOperacaoIds.length) await api(`${BASE_LAYOUTS}/${id}/tops`, { method: "PUT", body: { tipoOperacaoIds } });
        return id;
      } finally {
        // Toda gravação derruba o cache dos layouts e o da Central — também quando só a criação passou.
        if (feitoRef.current.id) await invalidarLayouts(qc);
      }
    },
    onSuccess: (id) => { onCriado(id); onFechar(); }
  });

  const ocupado = criar.isPending;
  const criado = feito.id !== null;
  const fechar = () => {
    if (ocupado) return;
    if (feito.id) onCriado(feito.id);
    onFechar();
  };
  const mudarFamilia = (v: string) => { setFamilia(v); setOrigem(SISTEMA); setLigadas(new Set()); };
  const podeAvancar = passo === 1 ? Boolean(familia) && nome.trim().length > 0 : passo === 2 ? criado || origemValida : false;
  const avancar = () => { if (podeAvancar) setPasso(passo === 1 ? 2 : 3); };
  const usaPadrao = padrao || feito.padrao;

  const titulo = (p: Passo) => <h3 className="mb-2 text-[13px] font-semibold text-slate-700">{TITULOS[p]}</h3>;

  return <Dialog open onOpenChange={(o) => { if (!o) fechar(); }} title="Novo layout" description={`Passo ${passo} de 3`} size="md"
    testId="layout-novo" preventClose={ocupado}
    footer={<>
      <Button variant="outline" onClick={fechar} disabled={ocupado}>{COPY.fechar}</Button>
      {passo > 1 && <Button variant="outline" data-testid="layout-novo-voltar" disabled={ocupado} onClick={() => setPasso(passo === 3 ? 2 : 1)}>{COPY.voltar}</Button>}
      {passo < 3
        ? <Button data-testid="layout-novo-avancar" disabled={!podeAvancar} onClick={avancar}>Avançar</Button>
        : <Button data-testid="layout-novo-criar" loading={ocupado} disabled={!familia || !nome.trim()} onClick={() => criar.mutate()}>Criar</Button>}
    </>}>
    {passo === 1 && <section data-testid="layout-novo-passo-1">
      {titulo(1)}
      <div className="grid grid-cols-12 gap-3">
        <Field label="Movimento" span={12} required>
          <NativeSelect data-testid="layout-novo-familia" value={familia} disabled={criado || ocupado} onChange={(e) => mudarFamilia(e.target.value)}>
            {familias.map((f) => <option key={f.codigo} value={f.codigo}>{f.rotulo}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Descrição" span={12} required>
          <Input data-testid="layout-novo-nome" value={nome} maxLength={120} disabled={ocupado}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); avancar(); } }} />
        </Field>
      </div>
      {familias.length === 0 && <p className="mt-2 text-[12px] text-slate-500">Nenhum movimento com layout.</p>}
    </section>}

    {passo === 2 && <section data-testid="layout-novo-passo-2">
      {titulo(2)}
      <div className="grid grid-cols-12 gap-3">
        <Field label="Começar de" span={12} required>
          <NativeSelect data-testid="layout-novo-origem" value={origem} disabled={criado || ocupado} onChange={(e) => setOrigem(e.target.value)}>
            <option value={SISTEMA}>Layout do sistema (a Central de hoje)</option>
            {origens.map((l) => <option key={l.id} value={l.id}>{l.code ? `${l.code} — ${l.nome}` : l.nome}</option>)}
          </NativeSelect>
        </Field>
      </div>
      <p className="mt-2 text-[12px] text-slate-500">
        {origem === SISTEMA ? "O layout nasce como cópia do layout do sistema: a Central de hoje, sem mudança." : "O layout nasce como cópia do layout escolhido."}
      </p>
      {origensQ.isLoading && <LoadingState variant="inline" label="Carregando os layouts do movimento…" className="mt-2" />}
      {origensQ.isError && <div className="mt-2"><ErrorState error={origensQ.error} /></div>}
    </section>}

    {passo === 3 && <section data-testid="layout-novo-passo-3">
      {titulo(3)}
      <label className="flex items-center gap-2 text-[12.5px] text-slate-700">
        <input type="checkbox" data-testid="layout-novo-padrao" checked={usaPadrao} disabled={feito.padrao || ocupado}
          onChange={(e) => setPadrao(e.target.checked)} />
        Usar como padrão para este tipo de movimento?
      </label>
      {usaPadrao && <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] text-amber-800">O padrão atual deste movimento deixa de ser o padrão.</p>}
      <p className="mb-1 mt-3 text-[12.5px] font-semibold text-slate-700">TOPs que usam este layout</p>
      <p className="mb-2 text-[12px] text-slate-500">Só TOPs ativas deste movimento. Uma TOP usa um layout só: a que está em outro layout sai de lá. Duplo clique move.</p>
      <EscolhaDeTops familia={familia} ligadas={ligadas} onMudar={setLigadas} bloqueado={ocupado} proprioId={feito.id} />
      {!usaPadrao && ligadas.size === 0 && <p data-testid="layout-novo-aviso-nao-usado"
        className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] text-amber-800">{TEXTOS.novoNaoUsado}</p>}
    </section>}

    {criar.isError && <div className="mt-3">
      {criado && <p className="mb-1 text-[12px] text-amber-700">O layout já foi criado: corrija e clique em Criar para concluir o que faltou.</p>}
      <ErrorState error={criar.error} />
    </div>}
  </Dialog>;
}

/** Lista dupla Disponíveis × Ligadas das TOPs ATIVAS do movimento (seleção por clique; Mover/Remover; duplo clique move). */
function EscolhaDeTops({ familia, ligadas, onMudar, bloqueado, proprioId }: {
  familia: string;
  ligadas: ReadonlySet<string>;
  onMudar: (ligadas: ReadonlySet<string>) => void;
  bloqueado: boolean;
  /** o layout já criado nesta abertura (depois de uma falha): não é "outro layout" */
  proprioId: string | null;
}) {
  const { tops, ondeEsta, carregando, erro } = useTopsDoMovimento(familia);
  const [selDisp, setSelDisp] = React.useState<ReadonlySet<string>>(() => new Set());
  const [selLig, setSelLig] = React.useState<ReadonlySet<string>>(() => new Set());
  const ativas = tops.filter((t) => t.ativo);
  const disponiveis = ativas.filter((t) => !ligadas.has(t.id));
  const escolhidas = ativas.filter((t) => ligadas.has(t.id));

  const mover = (ids: Iterable<string>, ligar: boolean) => {
    const lista = [...ids];
    if (bloqueado || lista.length === 0) return;
    const n = new Set(ligadas);
    for (const id of lista) { if (ligar) n.add(id); else n.delete(id); }
    onMudar(n);
    if (ligar) setSelDisp(new Set()); else setSelLig(new Set());
  };
  const alternar = (set: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>, id: string) =>
    set((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const item = (t: Top, ligada: boolean) => {
    const sel = (ligada ? selLig : selDisp).has(t.id);
    const onde = ondeEsta.get(t.id);
    const sairaDe = ligada && onde && onde.layoutId !== proprioId ? onde.nome : null;
    return <li key={t.id} data-testid={`layout-novo-top-${t.id}`} data-selecionado={sel ? "true" : undefined}>
      <button type="button" aria-pressed={sel} disabled={bloqueado}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] ${sel ? "bg-emerald-100 text-emerald-900" : "hover:bg-slate-100"}`}
        onClick={() => alternar(ligada ? setSelLig : setSelDisp, t.id)}
        onDoubleClick={() => mover([t.id], !ligada)}>
        <span className="flex-1">{rotuloDaTop(t)}</span>
      </button>
      {sairaDe && <span className="block px-2 text-[11.5px] text-amber-700">sairá do layout {sairaDe}</span>}
    </li>;
  };

  if (carregando) return <LoadingState variant="compact" />;
  if (erro) return <ErrorState error={erro} />;
  if (ativas.length === 0) return <EmptyState compact title="Nenhuma TOP ativa deste movimento." />;
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
    <div>
      <p className="mb-1 text-[12px] font-semibold text-slate-600">Disponíveis</p>
      <ul data-testid="layout-novo-tops-disponiveis" aria-label="TOPs disponíveis" className="max-h-[220px] min-h-[120px] overflow-y-auto rounded border border-slate-200 p-1">
        {disponiveis.map((t) => item(t, false))}
      </ul>
    </div>
    <div className="flex flex-row items-center justify-center gap-2 sm:flex-col">
      <Button size="sm" variant="outline" data-testid="layout-novo-tops-mover" disabled={bloqueado || selDisp.size === 0} onClick={() => mover(selDisp, true)}>Mover →</Button>
      <Button size="sm" variant="outline" data-testid="layout-novo-tops-remover" disabled={bloqueado || selLig.size === 0} onClick={() => mover(selLig, false)}>← Remover</Button>
    </div>
    <div>
      <p className="mb-1 text-[12px] font-semibold text-slate-600">Ligadas</p>
      <ul data-testid="layout-novo-tops-ligadas" aria-label="TOPs ligadas" className="max-h-[220px] min-h-[120px] overflow-y-auto rounded border border-slate-200 p-1">
        {escolhidas.map((t) => item(t, true))}
      </ul>
    </div>
  </div>;
}
