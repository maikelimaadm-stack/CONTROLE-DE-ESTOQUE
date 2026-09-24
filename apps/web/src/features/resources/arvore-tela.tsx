"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getResource, ehCadastroCodigoHierarquico } from "@agro/domain";
import { ChevronDown, ChevronRight, FolderTree, Plus, MoveRight } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Card, Dialog, Field, Input, Button, EmptyState } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { PillBtn } from "@/features/base1/ui";
import { ResourceForm } from "./resource-form";

/** Linha da listagem em ordem de árvore (`GET /resources/:key` sem ordenação: `nivel`, `ancestrais`, `tem_filhos`). */
interface No { id: string; code?: string | null; kind?: string | null; parent_id?: string | null; nivel: number; ancestrais: string[]; tem_filhos: boolean; [k: string]: unknown }
interface Pagina { items: No[]; total: number }

/** Limite da tela de árvore: a página máxima da listagem. Acima disso a tela avisa e manda para a lista. */
const LIMITE = 1000;

/**
 * TELA DE ÁRVORE (CADASTROS Fase 7, decisão 256): árvore à esquerda (expandir/recolher, busca que abre o
 * caminho), ficha à direita, "Novo filho" com o superior preenchido e o código sugerido pelo servidor, e
 * "Mover" (novo superior + código novo). É só apresentação: quem confere as regras da árvore (decisão 244) é
 * a API, e a recusa dela aparece aqui como veio.
 */
export function ArvoreTela({ resourceKey, alternar }: { resourceKey: string; alternar: React.ReactNode }) {
  const def = getResource(resourceKey)!; const { can } = useAuth(); const qc = useQueryClient();
  const temKind = def.fields.some((f) => f.name === "kind");
  const podeCriar = can(`${def.permission}.create`); const podeEditar = can(`${def.permission}.edit`);
  const arvore = useQuery({ queryKey: ["b1", resourceKey, "arvore"], queryFn: () => api<Pagina>(`/api/resources/${resourceKey}${qs({ pageSize: String(LIMITE) })}`) });
  const [busca, setBusca] = React.useState(""); const [termo, setTermo] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setTermo(busca.trim()), 250); return () => clearTimeout(t); }, [busca]);
  // busca no SERVIDOR (a mesma da listagem): devolve os que batem e, de cada um, os ancestrais — o caminho a abrir
  const achados = useQuery({ queryKey: ["b1", resourceKey, "arvore-busca", termo], queryFn: () => api<Pagina>(`/api/resources/${resourceKey}${qs({ pageSize: String(LIMITE), search: termo })}`), enabled: termo.length > 0 });
  const [recolhidos, setRecolhidos] = React.useState<Set<string>>(new Set());
  const [sel, setSel] = React.useState<string | null>(null);
  const [modo, setModo] = React.useState<"view" | "edit" | "new">("view");
  const [paiNovo, setPaiNovo] = React.useState<string | null>(null);
  const [movendo, setMovendo] = React.useState(false);
  const nos = React.useMemo(() => arvore.data?.items ?? [], [arvore.data]);
  const porId = React.useMemo(() => new Map(nos.map((n) => [n.id, n])), [nos]);
  const filtro = React.useMemo(() => {
    if (!termo || !achados.data) return null;
    const bate = new Set(achados.data.items.map((n) => n.id)); const caminho = new Set<string>();
    for (const n of achados.data.items) for (const a of n.ancestrais ?? []) caminho.add(a);
    return { bate, caminho };
  }, [termo, achados.data]);
  const visiveis = nos.filter((n) => filtro ? filtro.bate.has(n.id) || filtro.caminho.has(n.id) : !(n.ancestrais ?? []).some((a) => recolhidos.has(a)));
  const alternarNo = (id: string) => setRecolhidos((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const atualizar = () => { void qc.invalidateQueries({ queryKey: ["b1", resourceKey] }); };
  const selecionado = sel ? porId.get(sel) ?? null : null;
  const rotulo = (n: No) => [n.code, n[def.labelField]].filter((x) => x !== null && x !== undefined && x !== "").map(String).join(" ");
  const podeTerFilho = (n: No | null) => podeCriar && (!n || !temKind || n.kind === "synthetic");
  const novoFilho = (pai: string | null) => { setPaiNovo(pai); setModo("new"); };

  return <div className="grid min-h-[480px] grid-cols-1 gap-3 lg:grid-cols-[minmax(260px,380px)_1fr]" data-testid="arvore-tela">
    <Card role="region" className="flex min-w-0 flex-col p-2" aria-label={`Árvore de ${def.labelPlural.toLowerCase()}`}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {alternar}
        <PillBtn tone="gray" onClick={() => setRecolhidos(new Set())}>Expandir tudo</PillBtn>
        <PillBtn tone="gray" onClick={() => setRecolhidos(new Set(nos.filter((n) => n.tem_filhos).map((n) => n.id)))}>Recolher tudo</PillBtn>
        {podeCriar && <PillBtn onClick={() => novoFilho(null)}><Plus className="h-3.5 w-3.5" /> Novo na raiz</PillBtn>}
      </div>
      <Input aria-label="Buscar na árvore" placeholder="Buscar por código ou nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {(arvore.data?.total ?? 0) > LIMITE && <p className="mt-1 text-[11px] text-amber-600">Mostrando {LIMITE} de {arvore.data!.total}. Use a lista para ver todos.</p>}
      <ul role="tree" className="mt-2 min-h-0 flex-1 overflow-auto text-[13px]">
        {arvore.isLoading && <li className="p-2 text-slate-400">Carregando…</li>}
        {!arvore.isLoading && !visiveis.length && <li className="p-2 text-slate-400">{termo ? "Nada encontrado." : "Nenhum registro."}</li>}
        {visiveis.map((n) => {
          const aberto = filtro ? true : !recolhidos.has(n.id);
          return <li key={n.id} role="treeitem" aria-level={n.nivel + 1} aria-expanded={n.tem_filhos ? aberto : undefined} aria-selected={sel === n.id} data-testid="arvore-no" data-id={n.id}
            className={cn("flex items-center gap-1 rounded px-1 py-0.5", sel === n.id ? "bg-brand-50" : "hover:bg-slate-50", filtro?.bate.has(n.id) && "ring-1 ring-amber-300")} style={{ paddingLeft: n.nivel * 16 + 4 }}>
            {n.tem_filhos && !filtro ? <button type="button" aria-label={aberto ? "Recolher" : "Expandir"} data-testid="arvore-no-alternar" className="rounded p-0.5 text-slate-500 hover:bg-slate-100" onClick={() => alternarNo(n.id)}>{aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button> : <span className="inline-block w-[18px]" />}
            <button type="button" className={cn("min-w-0 flex-1 truncate text-left", n.kind === "synthetic" && "font-semibold")} onClick={() => { setSel(n.id); setModo("view"); }}>{rotulo(n)}</button>
          </li>;
        })}
      </ul>
    </Card>
    <section className="min-w-0" aria-label="Ficha">
      {modo === "new" ? <>
        <p className="mb-2 text-[12px] text-slate-500" data-testid="arvore-novo-superior">{paiNovo ? `Novo abaixo de ${porId.get(paiNovo) ? rotulo(porId.get(paiNovo)!) : "…"}` : "Novo na raiz"}</p>
        <ResourceForm key={`novo-${paiNovo ?? "raiz"}`} resourceKey={resourceKey} id="new" presetExtra={paiNovo ? { parent_id: paiNovo } : {}}
          embedded={{ mode: "new", row: null, setMode: setModo, onExit: () => setModo("view"), refresh: atualizar }}
          afterSave={(row) => { atualizar(); setSel(String(row["id"])); setModo("view"); }} onCancel={() => setModo("view")} />
      </> : selecionado ? <>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {podeTerFilho(selecionado) && <PillBtn onClick={() => novoFilho(selecionado.id)}><Plus className="h-3.5 w-3.5" /> Novo filho</PillBtn>}
          {/* Mover só registro SEM filhos (a API recusa o resto com a mesma frase): com filhos, o botão nem aparece */}
          {podeEditar && (selecionado.tem_filhos
            ? <span className="text-[11px] text-slate-500" data-testid="arvore-mover-com-filhos">Registro com filhos: mova ou renumere os filhos antes.</span>
            : <PillBtn tone="gray" onClick={() => setMovendo(true)}><MoveRight className="h-3.5 w-3.5" /> Mover</PillBtn>)}
        </div>
        <ResourceForm key={`${selecionado.id}-${modo}`} resourceKey={resourceKey} id={selecionado.id}
          embedded={{ mode: modo, row: null, setMode: setModo, onExit: () => { setSel(null); setModo("view"); }, refresh: atualizar }}
          afterSave={() => { atualizar(); setModo("view"); }} />
        {movendo && !selecionado.tem_filhos && <MoverDialogo resourceKey={resourceKey} no={selecionado} rotulo={rotulo(selecionado)} temKind={temKind} onFechar={() => setMovendo(false)} onMovido={() => { setMovendo(false); atualizar(); void qc.invalidateQueries({ queryKey: ["res", resourceKey] }); }} />}
      </> : <EmptyState title="Escolha um registro na árvore" description={podeCriar ? "Ou use Novo na raiz." : undefined} icon={<FolderTree className="h-6 w-6" />} />}
    </section>
  </div>;
}

/**
 * MOVER = trocar o superior e, onde há código hierárquico, o código (o do filho começa pelo do superior —
 * decisão 244). O código novo vem sugerido pelo servidor e continua editável. Só registro SEM filhos: os
 * códigos dos filhos carregam o prefixo antigo e não são reescritos em silêncio.
 */
function MoverDialogo({ resourceKey, no, rotulo, temKind, onFechar, onMovido }: { resourceKey: string; no: No; rotulo: string; temKind: boolean; onFechar: () => void; onMovido: () => void }) {
  const comCodigo = ehCadastroCodigoHierarquico(resourceKey);
  const [pai, setPai] = React.useState<string | null>(no.parent_id ?? null);
  const [codigo, setCodigo] = React.useState(no.code ?? ""); const [codigoMexido, setCodigoMexido] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null); const [gravando, setGravando] = React.useState(false);
  React.useEffect(() => {
    if (!comCodigo || codigoMexido || pai === (no.parent_id ?? null)) return;
    let vivo = true;
    api<{ codigo: string }>(`/api/resources/${resourceKey}/proximo-codigo${pai ? `?parent_id=${encodeURIComponent(pai)}` : ""}`).then((r) => { if (vivo) setCodigo(r.codigo); }).catch(() => { /* sem sugestão: o usuário digita, o servidor confere */ });
    return () => { vivo = false; };
  }, [pai, comCodigo, codigoMexido, resourceKey, no.parent_id]);
  const mover = async () => {
    setGravando(true); setErro(null);
    try {
      await api(`/api/resources/${resourceKey}/${no.id}`, { method: "PUT", body: { parent_id: pai, ...(comCodigo ? { code: codigo } : {}) } });
      toast.success("Registro movido"); onMovido();
    } catch (e) {
      const det = (e as Error & { details?: { message: string }[] }).details;
      setErro(det?.length ? det.map((d) => d.message).join(" ") : (e as Error).message);
    } finally { setGravando(false); }
  };
  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title={`Mover ${rotulo}`}
    footer={<><Button variant="outline" onClick={onFechar}>Cancelar</Button><Button loading={gravando} onClick={() => { void mover(); }}>Mover</Button></>}>
    <div className="grid grid-cols-12 gap-3">
      <Field label="Novo superior" span={12} help={temKind ? "Só superior sintético (Analítica: Não). Vazio = raiz." : "Vazio = raiz."}>
        <RefSelect resource={resourceKey} value={pai} onChange={(v) => setPai(v)} filter={temKind ? { kind: "synthetic" } : undefined} />
      </Field>
      {comCodigo && <Field label="Código novo" span={12} help="Sugerido pelo servidor a partir do superior; pode editar."><Input aria-label="Código novo" value={codigo} onChange={(e) => { setCodigoMexido(true); setCodigo(e.target.value); }} /></Field>}
      {erro && <p role="alert" className="col-span-12 text-[12px] text-red-600">{erro}</p>}
    </div>
  </Dialog>;
}
