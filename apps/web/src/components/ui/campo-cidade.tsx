"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import * as Popover from "@radix-ui/react-popover";
import { formatarCep, normalizarMascara, textoEhCep } from "@agro/domain";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { CmdDisplay, CmdPanel } from "./mg-controls";
import { BotaoTentarDeNovo, MSG_LISTA_FALHOU, useBuscaReferencia, useComEspera, type ItemReferencia } from "./ref-select";

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
export function CampoCidade({ value, onChange, disabled, className, id, municipioInicial }: {
  value: number | string | null | undefined;
  onChange: (codigo: number | null, municipio: Municipio | null) => void;
  disabled?: boolean; className?: string;
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
          <CmdDisplay id={id} disabled={disabled} empty={codigoAtual === null} placeholder="Nome, código IBGE ou CEP" aria-label="Cidade" aria-expanded={open} className="w-full" data-testid="cidade-busca" onClear={() => escolher(null)}>
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
      <input id={id ? `${id}-ibge` : undefined} aria-label="Código IBGE" title="Código IBGE" placeholder="Código IBGE" inputMode="numeric" maxLength={7} disabled={disabled} className="mg-input w-full" data-testid="cidade-ibge"
        value={ibge} aria-invalid={Boolean(ibgeErro) || undefined} onChange={(e) => void aoDigitarIbge(e.target.value)} />
      {ibgeErro && <span className="text-[11px] text-red-600" role="alert">{ibgeErro}</span>}
    </span>
    <input id={id ? `${id}-uf` : undefined} aria-label="UF" title="UF" placeholder="UF" readOnly tabIndex={-1} className="mg-input w-12 shrink-0 bg-slate-50" data-testid="cidade-uf" value={codigoAtual === null ? "" : atual?.uf ?? ""} />
  </span>;
}
