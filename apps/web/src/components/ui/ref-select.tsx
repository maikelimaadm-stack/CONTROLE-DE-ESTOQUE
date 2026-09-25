"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { CmdDisplay, CmdPanel } from "./mg-controls";
import { api, ApiError, qs } from "@/lib/api";
import { getResource, getReferencia, formatarCep, normalizarMascara, textoEhCep, type ChaveReferencia, type FieldDef } from "@agro/domain";
import { Plus, RotateCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Dialog } from "./overlays";
// carregado sob demanda: evita ciclo de módulos (o formulário declarativo usa RefSelect)
const ResourceQuickCreate = React.lazy(() => import("@/features/resources/quick-create").then((m) => ({ default: m.ResourceQuickCreate })));

/** `caminho` e `kind` vêm só dos cadastros em árvore ("1 Insumos › 1.01 Fertilizantes"); API anterior não os manda. */
export interface Option { id: string; label: string; code?: string | null; caminho?: string | null; kind?: string | null }

/**
 * Recorte da lista de opções de um campo de referência do registry: `filtro` fixo e, quando o lançamento
 * exige analítico (`exigeAnalitico`), só analíticos. Apresentação — quem recusa é o servidor.
 */
export function filtroDaReferencia(f: FieldDef): Record<string, string> | undefined {
  if (!f.ref) return undefined;
  if (!f.ref.exigeAnalitico) return f.ref.filtro;
  return { ...(f.ref.filtro ?? {}), kind: "analytic" };
}
/** Texto mostrado de uma opção: o caminho na árvore quando houver; senão o rótulo. */
const textoDaOpcao = (o: Option) => o.caminho || o.label;
/** Select com busca server-side (equivalente ao select2 do sistema de referência), para campos de referência. */
export function RefSelect({ resource, value, onChange, placeholder = "Selecione", filter, disabled, className, allowEmpty = true, includeInactive, labelHint, onOpenChange }: { resource: string; value: string | null | undefined; onChange: (v: string | null, opt?: Option) => void; placeholder?: string; filter?: Record<string, string | undefined>; disabled?: boolean; className?: string; allowEmpty?: boolean; includeInactive?: boolean; /** rótulo já conhecido do valor atual (evita consulta ao abrir o registro) */ labelHint?: string | null; onOpenChange?: (o: boolean) => void }) {
  const [open, setOpen] = React.useState(false); const [search, setSearch] = React.useState(""); const [creating, setCreating] = React.useState(false); const { can } = useAuth();
  const f = Object.fromEntries(Object.entries(filter ?? {}).filter(([, v]) => v));
  const { data, isLoading } = useQuery({ queryKey: ["options", resource, search, f, includeInactive], queryFn: () => api<Option[]>(`/api/resources/${resource}/options${qs({ search, ...f, include_inactive: includeInactive ? "1" : undefined })}`), enabled: open, staleTime: 60_000 });
  const [picked, setPicked] = React.useState<Option | null>(null);
  const current = data?.find((o) => o.id === value) ?? (picked && picked.id === value ? picked : null);
  const def = React.useMemo(() => getResource(resource), [resource]);
  const { data: one } = useQuery({ queryKey: ["option-one", resource, value], queryFn: async () => { const r = await api<Record<string, unknown>>(`/api/resources/${resource}/${value}`); return r; }, enabled: Boolean(value) && !current && !labelHint && !def?.tree, staleTime: 60_000 });
  // árvore: o valor já gravado também aparece pelo caminho — a MESMA rota de opções, recortada pelo id (sem o recorte de analítico, para um valor antigo continuar legível)
  const { data: umNaArvore } = useQuery({ queryKey: ["option-one-caminho", resource, value], queryFn: () => api<Option[]>(`/api/resources/${resource}/options${qs({ id: value ?? undefined, include_inactive: "1" })}`), enabled: Boolean(value) && !current && Boolean(def?.tree), staleTime: 60_000 });
  const doValor = umNaArvore?.find((o) => o.id === value);
  const label = (current ? textoDaOpcao(current) : undefined) ?? (doValor ? textoDaOpcao(doValor) : undefined) ?? labelHint ?? (one ? String(one[def?.labelField ?? "name"] ?? one["description"] ?? one["name"] ?? "") : "");
  const seen = new Set<string>(); const opts = (data ?? []).filter((o) => { const k = `${o.code ?? ""}|${o.label}`; if (seen.has(k) && o.id !== value) return false; seen.add(k); return true; }).map((o) => ({ value: o.id, label: textoDaOpcao(o), code: o.caminho ? undefined : o.code }));
  return (<>
    <Popover.Root open={open} onOpenChange={(o) => { if (disabled) return; setOpen(o); onOpenChange?.(o); if (!o) setSearch(""); }}>
      <Popover.Trigger asChild>
        <CmdDisplay disabled={disabled} empty={!value} placeholder={placeholder} aria-expanded={open} className={cn("mg-input", className)} onClear={allowEmpty ? () => onChange(null) : undefined}>{value ? label || "…" : null}</CmdDisplay>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content align="start" sideOffset={4} className="cmd-panel z-[10000] w-[var(--radix-popover-trigger-width)] min-w-[240px] outline-none">
        <CmdPanel options={opts} value={value ?? null} search={search} onSearch={setSearch} loading={isLoading} emptyText="Nenhum resultado" onPick={(o) => { const src = data?.find((x) => x.id === o.value); setPicked(src ?? { id: o.value, label: o.label, code: o.code ?? null }); onChange(o.value, src); setOpen(false); setSearch(""); }}
          footer={def && can(`${def.permission}.create`) ? <button type="button" className="cmd-panel__create" onClick={() => { setOpen(false); setCreating(true); }}><Plus className="h-3.5 w-3.5" /> Cadastrar {def.label.toLowerCase()}</button> : undefined} />
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    {def && <Dialog open={creating} onOpenChange={setCreating} title={`Novo ${def.label.toLowerCase()}`} size="xl">
      {creating && <React.Suspense fallback={<div className="p-6 text-sm text-slate-400">Carregando…</div>}><ResourceQuickCreate resourceKey={resource} preset={f as Record<string, string>} onCancel={() => setCreating(false)} onCreated={(row) => { const id = String(row["id"]); const label = String(row[def.labelField ?? "name"] ?? row["description"] ?? row["name"] ?? ""); setPicked({ id, label, code: (row["code"] as string | null) ?? null }); onChange(id, { id, label, code: (row["code"] as string | null) ?? null }); setCreating(false); }} /></React.Suspense>}
    </Dialog>}
  </>);
}

export interface ItemReferencia { codigo: string | number; rotulo: string; escolhivel: boolean }

/** Mensagens do campo de busca de referência (os E2E procuram por estes textos). */
export const MSG_LISTA_FALHOU = "Não foi possível carregar a lista.";
export const TXT_TENTAR_DE_NOVO = "Tentar de novo";

/**
 * A API não TEM a rota de busca (API anterior à Fase 3): 404 do manipulador de rota inexistente do Fastify
 * ("Rota não encontrada"). Um 404 de chave desconhecida ou de código inexistente NÃO é isto.
 */
export function rotaDeBuscaAusente(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404 && e.message === "Rota não encontrada";
}

/** Valor com espera de digitação (a busca não dispara a cada tecla). */
export function useComEspera<T>(valor: T, ms = 250): T {
  const [v, setV] = React.useState(valor);
  React.useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

/**
 * Busca numa referência oficial com a política de falha do B-1: uma tentativa automática a mais; rota ausente
 * não é retentada (é a API anterior). Falha NUNCA vira texto livre — quem chama mostra "Tentar de novo".
 */
export function useBuscaReferencia(referencia: ChaveReferencia, search: string, enabled: boolean) {
  const q = useComEspera(search.trim());
  return useQuery({
    queryKey: ["referencia", referencia, q],
    queryFn: () => api<{ items: ItemReferencia[] }>(`/api/referencias/${referencia}${qs({ search: q || undefined, pageSize: "30" })}`),
    enabled, staleTime: 300_000,
    retry: (n, e) => n < 1 && !rotaDeBuscaAusente(e), retryDelay: 400
  });
}

/**
 * Busca numa referência oficial (município, banco, NCM, CBO) — CADASTROS Fase 3 / AJUSTES 01 B-1. Grava o CÓDIGO
 * oficial. Falha da lista (500, rede) mostra "Não foi possível carregar a lista." com [Tentar de novo] e o valor
 * não muda. Só a API ANTERIOR sem a rota (404 da rota) cai em digitação do código, e aí só um código no formato
 * (`padraoCodigo`) vira valor; o rótulo por código só é pedido para valor no formato e com espera de digitação.
 */
export function ReferenciaSelect({ referencia, value, onChange, disabled, className, onOpenChange, id }: { referencia: ChaveReferencia; value: string | number | null | undefined; onChange: (v: string | number | null) => void; disabled?: boolean; className?: string; onOpenChange?: (o: boolean) => void; id?: string }) {
  const def = getReferencia(referencia);
  const [open, setOpen] = React.useState(false); const [search, setSearch] = React.useState("");
  const [picked, setPicked] = React.useState<ItemReferencia | null>(null);
  const temValor = value !== null && value !== undefined && value !== "";
  const noFormato = temValor && Boolean(def) && new RegExp(def!.padraoCodigo).test(String(value));
  const valorEstavel = useComEspera(temValor ? String(value) : "", 400);
  const lista = useBuscaReferencia(referencia, search, open);
  const atual = picked && String(picked.codigo) === String(value) ? picked : null;
  const um = useQuery({ queryKey: ["referencia-um", referencia, valorEstavel], queryFn: () => api<ItemReferencia>(`/api/referencias/${referencia}/${encodeURIComponent(valorEstavel)}`), enabled: noFormato && valorEstavel === String(value) && !atual, staleTime: 300_000, retry: false });
  if (rotaDeBuscaAusente(lista.error)) return <EntradaDeCodigo referencia={referencia} value={value} onChange={onChange} disabled={disabled} className={className} id={id} />;
  const rotulo = atual?.rotulo ?? um.data?.rotulo ?? (temValor ? String(value) : "");
  const falhou = Boolean(lista.error) && !lista.isFetching;
  const opcoes = falhou ? [] : (lista.data?.items ?? []).map((i) => ({ value: String(i.codigo), label: i.rotulo }));
  return (
    <Popover.Root open={open} onOpenChange={(o) => { if (disabled) return; setOpen(o); onOpenChange?.(o); if (!o) setSearch(""); }}>
      <Popover.Trigger asChild>
        <CmdDisplay id={id} disabled={disabled} empty={!temValor} placeholder={`Buscar ${def?.label.toLowerCase() ?? ""}`} aria-expanded={open} className={cn("w-full", className)} onClear={() => onChange(null)}>{temValor ? rotulo : null}</CmdDisplay>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content align="start" sideOffset={4} className="cmd-panel z-[10000] w-[var(--radix-popover-trigger-width)] min-w-[280px] outline-none">
        <CmdPanel options={opcoes} value={temValor ? String(value) : null} search={search} onSearch={setSearch} loading={lista.isFetching && !lista.data} emptyText={falhou ? MSG_LISTA_FALHOU : "Nenhum resultado"}
          footer={falhou ? <BotaoTentarDeNovo onClick={() => void lista.refetch()} /> : undefined}
          onPick={(o) => { const it = lista.data?.items.find((x) => String(x.codigo) === o.value) ?? null; if (!it) return; setPicked(it); onChange(it.codigo); setOpen(false); setSearch(""); }} />
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  );
}

export function BotaoTentarDeNovo({ onClick }: { onClick: () => void }) {
  return <button type="button" className="cmd-panel__create" data-testid="referencia-tentar-de-novo" onClick={onClick}><RotateCw className="h-3.5 w-3.5" /> {TXT_TENTAR_DE_NOVO}</button>;
}

/**
 * API anterior sem a rota de busca: digitação do código. Só o código no FORMATO oficial vira valor; o resto fica
 * na caixa com aviso e o valor gravado não muda (texto livre nunca vira valor).
 */
function EntradaDeCodigo({ referencia, value, onChange, disabled, className, id }: { referencia: ChaveReferencia; value: string | number | null | undefined; onChange: (v: string | number | null) => void; disabled?: boolean; className?: string; id?: string }) {
  const def = getReferencia(referencia);
  const [texto, setTexto] = React.useState(value === null || value === undefined ? "" : String(value));
  const t = texto.replace(/[\s.\-/]/g, "");
  const valido = t === "" || (def ? new RegExp(def.padraoCodigo).test(t) : false);
  return <span className="flex w-full flex-col">
    <input id={id} className={cn("w-full", className)} disabled={disabled} value={texto} inputMode="numeric" aria-invalid={!valido} data-testid="referencia-codigo"
      onChange={(e) => { const v = e.target.value; setTexto(v); const n = v.replace(/[\s.\-/]/g, ""); if (n === "") onChange(null); else if (def && new RegExp(def.padraoCodigo).test(n)) onChange(def.codigoInteiro ? Number(n) : n); }} />
    <span className="text-[11px] text-amber-600">{valido ? `Busca de ${def?.labelPlural.toLowerCase() ?? "referência"} indisponível agora; digite o código.` : `Código fora do formato de ${def?.label.toLowerCase() ?? "referência"}; não foi aceito.`}</span>
  </span>;
}

/* ───────────── CAMPO CIDADE (B-2) — no mesmo arquivo da busca de referência, que ele reusa ───────────── */

/** Município como a tela o usa: código IBGE (o valor gravado), nome e UF. */
export interface Municipio { codigoIbge: number; nome: string; uf: string }

/** Resposta de GET /api/consultas/cep/:cep (apps/api/src/routes/consultas.ts). `municipio` é null se a cidade não foi resolvida. */
export interface RespostaCep { cep: string; logradouro: string | null; complemento: string | null; bairro: string | null; municipio: Municipio | null; fonte: string; consultadoEm: string }

/** Consulta um CEP (8 dígitos, com ou sem pontuação). Lança ApiError (404 CEP inexistente, 422, 429, 503). */
export function consultarCep(cep: string): Promise<RespostaCep> {
  return api<RespostaCep>(`/api/consultas/cep/${normalizarMascara("cep", cep)}`);
}

/** Mensagem legível de uma falha da consulta de CEP (para quem mostra aviso). */
export function mensagemFalhaCep(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return "CEP não encontrado.";
    if (e.status === 429) return "Muitas consultas de CEP em 1 minuto; tente de novo em instantes.";
    if (e.status === 403) return "Sem permissão para consultar CEP.";
    if (e.status === 422) return "CEP inválido.";
  }
  return "Consulta de CEP indisponível agora; preencha o endereço.";
}

/** "5106752 · Pontes e Lacerda - MT" */
export const rotuloMunicipio = (m: Municipio) => `${m.codigoIbge} · ${m.nome} - ${m.uf}`;

/** Item da referência de municípios → Municipio. Aceita o rótulo da API nova ("5106752 · Nome - UF") e da anterior ("Nome - UF"). */
export function municipioDoItem(it: ItemReferencia): Municipio | null {
  const codigo = Number(it.codigo);
  if (!Number.isInteger(codigo)) return null;
  const sem = it.rotulo.replace(/^\s*\d{7}\s*·\s*/, "");
  const m = /^(.*?)\s*-\s*([A-Z]{2})\s*$/.exec(sem);
  return m ? { codigoIbge: codigo, nome: m[1]!.trim(), uf: m[2]! } : { codigoIbge: codigo, nome: sem.trim(), uf: "" };
}

const porCodigo = (codigo: string) => api<ItemReferencia>(`/api/referencias/municipios/${codigo}`);

/**
 * CAMPO CIDADE (CADASTROS AJUSTES 01, B-2) — endereço principal, outros endereços, empresas, filiais.
 * Três caixas numa linha: Cidade (busca) · Código IBGE (editável) · UF (só leitura). Cidade e Código IBGE andam juntos:
 * `value` é o código IBGE gravado; `onChange(codigo, municipio)` entrega os dois.
 * Na caixa Cidade o texto pode ser NOME, CÓDIGO IBGE (7 dígitos) ou CEP (8 dígitos, com/sem hífen): o CEP é
 * consultado e a cidade dele vem como 1ª opção "CEP 78250-000 → 5106752 · Pontes e Lacerda - MT".
 * No Código IBGE, 7 dígitos resolvem a cidade; código inexistente não muda o valor.
 * Falha da lista segue o B-1 ("Não foi possível carregar a lista." + [Tentar de novo]); texto nunca vira valor.
 */
export function CampoCidade({ value, onChange, disabled, className, classeEntrada, id, municipioInicial }: {
  value: number | string | null | undefined;
  onChange: (codigo: number | null, municipio: Municipio | null) => void;
  disabled?: boolean; className?: string;
  /** classe das caixas Código IBGE e UF (a mesma das outras entradas da ficha) */
  classeEntrada?: string;
  /** id da caixa Cidade (para <label htmlFor>); as outras recebem `${id}-ibge` e `${id}-uf` */
  id?: string;
  /** município já conhecido do valor (evita consulta ao abrir o registro) */
  municipioInicial?: Municipio | null;
}) {
  const codigoAtual = value === null || value === undefined || value === "" ? null : Number(value);
  const [open, setOpen] = React.useState(false); const [search, setSearch] = React.useState("");
  const [escolhido, setEscolhido] = React.useState<Municipio | null>(municipioInicial ?? null);
  const conhecido = escolhido && escolhido.codigoIbge === codigoAtual ? escolhido : null;
  const um = useQuery({ queryKey: ["referencia-um", "municipios", String(codigoAtual)], queryFn: () => porCodigo(String(codigoAtual)), enabled: codigoAtual !== null && /^\d{7}$/.test(String(codigoAtual)) && !conhecido, staleTime: 300_000, retry: false });
  const atual = conhecido ?? (um.data ? municipioDoItem(um.data) : null);

  const lista = useBuscaReferencia("municipios", search, open);
  const q = useComEspera(search.trim());
  const cepDigitado = textoEhCep(q) ? normalizarMascara("cep", q) : null;
  const cep = useQuery({ queryKey: ["cep", cepDigitado], queryFn: () => consultarCep(cepDigitado!), enabled: open && cepDigitado !== null, staleTime: 300_000, retry: false });
  const ibgeDigitado = /^\d{7}$/.test(q) ? q : null;
  const doCodigo = useQuery({ queryKey: ["referencia-um", "municipios", ibgeDigitado], queryFn: () => porCodigo(ibgeDigitado!), enabled: open && ibgeDigitado !== null, staleTime: 300_000, retry: false });

  const escolhas = new Map<string, Municipio>();
  const opcoes: { value: string; label: string }[] = [];
  const cepMun = cep.data?.municipio ?? null;
  if (cepDigitado && cepMun) { escolhas.set(`cep:${cepMun.codigoIbge}`, cepMun); opcoes.push({ value: `cep:${cepMun.codigoIbge}`, label: `CEP ${formatarCep(cepDigitado)} → ${rotuloMunicipio(cepMun)}` }); }
  const itens = [...(doCodigo.data ? [doCodigo.data] : []), ...(lista.data?.items ?? [])];
  for (const it of itens) { const m = municipioDoItem(it); if (!m || escolhas.has(String(m.codigoIbge))) continue; escolhas.set(String(m.codigoIbge), m); opcoes.push({ value: String(m.codigoIbge), label: rotuloMunicipio(m) }); }
  const falhou = Boolean(lista.error) && !lista.isFetching && opcoes.length === 0;
  const aviso = cepDigitado && cep.error ? mensagemFalhaCep(cep.error) : cepDigitado && cep.data && !cepMun ? "A cidade deste CEP não foi encontrada; busque pelo nome." : null;
  const carregando = (lista.isFetching && !lista.data) || (cepDigitado !== null && cep.isFetching);

  const escolher = (m: Municipio | null) => { setEscolhido(m); onChange(m ? m.codigoIbge : null, m); };

  // Código IBGE: caixa própria; reflete o valor quando ele muda por fora
  const [ibge, setIbge] = React.useState(codigoAtual === null ? "" : String(codigoAtual));
  const [ibgeErro, setIbgeErro] = React.useState<string | null>(null);
  React.useEffect(() => { setIbge(codigoAtual === null ? "" : String(codigoAtual)); setIbgeErro(null); }, [codigoAtual]);
  const aoDigitarIbge = async (t: string) => {
    const d = t.replace(/\D/g, "").slice(0, 7); setIbge(d); setIbgeErro(null);
    if (d === "") { if (codigoAtual !== null) escolher(null); return; }
    if (d.length < 7 || Number(d) === codigoAtual) return;
    try { const m = municipioDoItem(await porCodigo(d)); if (m) escolher(m); else setIbgeErro("Código IBGE não encontrado."); }
    catch (e) { setIbgeErro(e instanceof ApiError && e.status === 404 ? "Código IBGE não encontrado." : "Não foi possível conferir o código agora."); }
  };

  return <span className={cn("flex w-full min-w-0 items-start gap-2", className)} data-testid="campo-cidade">
    <span className="flex min-w-0 flex-1 flex-col">
      <Popover.Root open={open} onOpenChange={(o) => { if (disabled) return; setOpen(o); if (!o) setSearch(""); }}>
        <Popover.Trigger asChild>
          <CmdDisplay id={id} disabled={disabled} empty={codigoAtual === null} placeholder="Nome, código IBGE ou CEP" aria-label="Cidade" aria-expanded={open} className={cn("w-full", classeEntrada)} data-testid="cidade-busca" onClear={() => escolher(null)}>
            {codigoAtual === null ? null : atual ? `${atual.nome} - ${atual.uf}`.replace(/ - $/, "") : String(codigoAtual)}
          </CmdDisplay>
        </Popover.Trigger>
        <Popover.Portal><Popover.Content align="start" sideOffset={4} className="cmd-panel z-[10000] w-[var(--radix-popover-trigger-width)] min-w-[320px] outline-none">
          <CmdPanel options={opcoes} value={codigoAtual === null ? null : String(codigoAtual)} search={search} onSearch={setSearch} loading={carregando} placeholder="Nome, código IBGE ou CEP"
            emptyText={aviso ?? (falhou ? MSG_LISTA_FALHOU : "Nenhum resultado")}
            footer={falhou ? <BotaoTentarDeNovo onClick={() => void lista.refetch()} /> : undefined}
            onPick={(o) => { const m = escolhas.get(o.value); if (!m) return; escolher(m); setOpen(false); setSearch(""); }} />
        </Popover.Content></Popover.Portal>
      </Popover.Root>
      {aviso && opcoes.length > 0 && open && <span className="text-[11px] text-amber-600">{aviso}</span>}
    </span>
    <span className="flex w-24 shrink-0 flex-col">
      <input id={id ? `${id}-ibge` : undefined} aria-label="Código IBGE" title="Código IBGE" placeholder="Código IBGE" inputMode="numeric" maxLength={7} disabled={disabled} className={cn("w-full", classeEntrada)} data-testid="cidade-ibge"
        value={ibge} aria-invalid={Boolean(ibgeErro) || undefined} onChange={(e) => void aoDigitarIbge(e.target.value)} />
      {ibgeErro && <span className="text-[11px] text-red-600" role="alert">{ibgeErro}</span>}
    </span>
    <input id={id ? `${id}-uf` : undefined} aria-label="UF" title="UF" placeholder="UF" readOnly tabIndex={-1} className={cn("w-12 shrink-0", classeEntrada)} data-testid="cidade-uf" value={codigoAtual === null ? "" : atual?.uf ?? ""} />
  </span>;
}
