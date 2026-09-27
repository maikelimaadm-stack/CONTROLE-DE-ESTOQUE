"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronFirst, ChevronLast, Download, Pencil, Redo2, RotateCcw, Save, Undo2, X } from "lucide-react";
import { api, ApiError, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTabTitle } from "@/lib/workspace-tabs";
import { cn } from "@/lib/utils";
import { Badge, ConfirmDialog, ErrorState, Input, LoadingState } from "@/components/ui";
import {
  LAYOUT_DO_SISTEMA, catalogoDaFamilia, familiaTemLayout, validarEstruturaLayout,
  type ErroDoLayout, type EstruturaLayout
} from "@agro/domain";
import { ConfiguradorContexto, type ConfiguradorCtx, type RegistroConhecido, type ResultadoOperacao } from "./contrato";
import { removerCampo } from "./operacoes";
import { useRascunho } from "./rascunho";
import { Disponiveis } from "./disponiveis";
import { PreviaPrincipal } from "./previa-principal";
import { PreviaItens } from "./previa-itens";
import { PreviaRodape } from "./previa-rodape";
import { ConfigurarCampoDialogo } from "./configurar-campo";
import { TopsListaDupla } from "./tops-lista-dupla";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › LAYOUT DO DOCUMENTO — página do configurador visual (VENDAS-A3-1c, decisão 261).
 *
 * Casca: lê o GET admin do layout, guarda o rascunho (`useRascunho`, desfazer/refazer até 50) e entrega às peças o
 * `ConfiguradorCtx`. Toda mudança passa por uma operação pura de `operacoes.ts`. Salvar = PUT {nome, estrutura}: a
 * validação do domínio roda antes (a mesma que o servidor refaz); 422 → erros por caminho visíveis. Estilo e grade
 * 268/40/1fr do configurador dos cadastros (`emp-layout-config-*`). `can()` só esconde botão; quem nega é a rota.
 */

const BASE = "/api/admin/layouts-documento";
const CHAVE = ["layouts-documento"] as const;

interface TopLigada { id: string; codigo: string; nome: string }
interface Detalhe {
  id: string; code: string; nome: string; familia: string; padrao: boolean;
  estrutura: EstruturaLayout | null; tops: TopLigada[];
  padroesDeCadastro: ReadonlyMap<string, RegistroConhecido>; padroesInvalidos: ReadonlySet<string>;
}
interface Familia { codigo: string; rotulo: string }

// ── leitura tolerante do contrato (mesma de layouts-documento.tsx), sem inventar valor ──
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
function lerTop(v: unknown): TopLigada {
  if (typeof v === "string") return { id: v, codigo: "", nome: "" };
  const o = obj(v);
  return { id: str(o.id ?? o.tipoOperacaoId ?? o.tipo_operacao_id), codigo: str(o.codigo), nome: str(o.nome) };
}
function lerPadroes(v: unknown): Map<string, RegistroConhecido> {
  const m = new Map<string, RegistroConhecido>();
  if (!v || typeof v !== "object" || Array.isArray(v)) return m;
  for (const [chave, x] of Object.entries(v as Obj)) { const o = obj(x); const id = str(o.id); if (id) m.set(chave, { id, rotulo: str(o.rotulo) }); }
  return m;
}
function lerDetalhe(v: unknown): Detalhe {
  const o = obj(v);
  const est = o.estrutura && typeof o.estrutura === "object" ? (o.estrutura as EstruturaLayout) : null;
  return {
    id: str(o.id), code: str(o.code ?? o.codigo), nome: str(o.nome), familia: str(o.familia), padrao: Boolean(o.padrao),
    estrutura: est, tops: (Array.isArray(o.tops) ? o.tops : []).map(lerTop),
    padroesDeCadastro: lerPadroes(o.padroesDeCadastro),
    padroesInvalidos: new Set(Array.isArray(o.padroesInvalidos) ? o.padroesInvalidos.filter((x): x is string => typeof x === "string") : [])
  };
}
/** 422 → erros por caminho. Aceita `details` como lista ou `{ erros | errors | campos }`. */
function errosDaApi(e: unknown): ErroDoLayout[] {
  if (!(e instanceof ApiError)) return [];
  const d = e.details;
  const lista = Array.isArray(d) ? d : Array.isArray(obj(d).erros) ? obj(d).erros : Array.isArray(obj(d).errors) ? obj(d).errors : Array.isArray(obj(d).campos) ? obj(d).campos : [];
  return (lista as unknown[]).map((x) => { const o = obj(x); return { caminho: str(o.caminho ?? o.path), mensagem: str(o.mensagem ?? o.message) }; }).filter((x) => x.mensagem);
}

export function PaginaConfigurador({ id }: { id: string }) {
  const detalhe = useQuery<Detalhe, ApiError>({ queryKey: [...CHAVE, id, "detalhe"], queryFn: async () => lerDetalhe(await api<unknown>(`${BASE}/${id}`)), retry: false });
  useTabTitle(detalhe.data?.nome ?? "Layout do documento");
  if (detalhe.isPending) return <div data-testid="config-layout-pagina"><LoadingState /></div>;
  if (detalhe.isError || !detalhe.data.estrutura) {
    return <div data-testid="config-layout-pagina" className="space-y-3">
      <ErrorState error={detalhe.error ?? undefined} message={detalhe.error ? undefined : "O servidor respondeu o layout sem estrutura."} />
      <Link href="/configuracoes?tab=operacoes&sub=layouts-documento" data-testid="config-voltar" className="tb-btn tb-btn-ghost is-primary">Voltar</Link>
    </div>;
  }
  return <Configurador key={id} d={detalhe.data} estrutura={detalhe.data.estrutura} />;
}

function Configurador({ d, estrutura: gravada }: { d: Detalhe; estrutura: EstruturaLayout }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const podeEditar = can("tipos_operacao.edit") && familiaTemLayout(d.familia);
  const familiasQ = useQuery({ queryKey: ["tipos-operacao", "familias"], queryFn: () => api<{ items: Familia[] }>("/api/admin/tipos-operacao/familias") });
  const rotuloMovimento = familiasQ.data?.items.find((f) => f.codigo === d.familia)?.rotulo ?? d.familia;
  const catalogo = React.useMemo(() => catalogoDaFamilia(d.familia), [d.familia]);

  const [base, setBase] = React.useState<EstruturaLayout>(gravada);
  const [nomeGravado, setNomeGravado] = React.useState(d.nome);
  const [nome, setNome] = React.useState(d.nome);
  const r = useRascunho(gravada);
  const [editando, setEditando] = React.useState(false);
  const [selecionado, setSelecionado] = React.useState<string | null>(null);
  const [arrastando, setArrastando] = React.useState<string | null>(null);
  const [abaAtiva, setAbaAtiva] = React.useState(0);
  const [configurando, setConfigurando] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);
  const [erros, setErros] = React.useState<ErroDoLayout[]>([]);
  const [salvo, setSalvo] = React.useState(false);
  const [confirmaRestaurar, setConfirmaRestaurar] = React.useState(false);
  const [erroExportar, setErroExportar] = React.useState<unknown>(null);

  const estrutura = editando ? r.estrutura : base;
  const aplicar = React.useCallback((res: ResultadoOperacao) => {
    if (res.ok) { r.mudar(res.estrutura); setAviso(null); setSalvo(false); } else setAviso(res.motivo);
  }, [r]);

  const ctx: ConfiguradorCtx = {
    familia: d.familia, estrutura, editando, selecionado, selecionar: setSelecionado, aplicar,
    arrastando, setArrastando, abaAtiva, setAbaAtiva, configurar: setConfigurando,
    padroesDeCadastro: d.padroesDeCadastro, padroesInvalidos: d.padroesInvalidos, catalogo
  };

  const entrar = () => { r.reiniciar(base); setNome(nomeGravado); setEditando(true); setErros([]); setAviso(null); setSalvo(false); };
  const cancelar = () => { r.reiniciar(base); setNome(nomeGravado); setEditando(false); setErros([]); setAviso(null); setSelecionado(null); setConfigurando(null); };

  const salvar = useMutation({
    mutationFn: (v: { nome: string; estrutura: EstruturaLayout }) => api(`${BASE}/${d.id}`, { method: "PUT", body: v }),
    onSuccess: (_x, v) => {
      setBase(v.estrutura); setNomeGravado(v.nome); setErros([]); setSalvo(true); setEditando(false); setSelecionado(null);
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => setErros(errosDaApi(e))
  });
  const tentarSalvar = () => {
    const locais = validarEstruturaLayout(d.familia, r.estrutura);
    const semNome = nome.trim() ? [] : [{ caminho: "nome", mensagem: "Informe o nome do layout." }];
    const todos = [...semNome, ...locais];
    setErros(todos);
    if (!todos.length) salvar.mutate({ nome: nome.trim(), estrutura: r.estrutura });
  };

  const exportar = () => { setErroExportar(null); download(`${BASE}/${d.id}/exportar`, `layout-${d.code}.json`).catch((e: unknown) => setErroExportar(e)); };

  // Tecla Delete no selecionado (fora de campo de texto) = remover do layout — a mesma operação do botão.
  React.useEffect(() => {
    if (!editando || !selecionado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName))) return;
      e.preventDefault();
      const res = removerCampo(d.familia, r.estrutura, selecionado);
      aplicar(res);
      if (res.ok) setSelecionado(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editando, selecionado, d.familia, r.estrutura, aplicar]);

  return <ConfiguradorContexto.Provider value={ctx}>
    <div className="b1 emp-layout-configurator flex flex-col gap-2" data-testid="config-layout-pagina">
      {/* cabeçalho */}
      <div className="mg-card flex flex-wrap items-center gap-3 px-3 py-2">
        <Link href="/configuracoes?tab=operacoes&sub=layouts-documento" data-testid="config-voltar" className="tb-btn tb-btn-ghost is-primary">Voltar</Link>
        {editando
          ? <Input data-testid="config-nome" aria-label="Nome do layout" className="w-72" value={nome} onChange={(e) => { setNome(e.target.value); setSalvo(false); }} />
          : <h1 data-testid="config-nome" className="text-[15px] font-semibold text-[var(--mg-text-1)]">{nomeGravado}</h1>}
        <span className="text-[12px] text-[var(--mg-text-2)]">Movimento: <b data-testid="config-movimento">{rotuloMovimento}</b></span>
        <span className="text-[12px] text-[var(--mg-text-2)]">Código: <b data-testid="config-codigo">{d.code}</b></span>
        {d.padrao && <Badge tone="green" data-testid="config-padrao-selo">Padrão do movimento</Badge>}
      </div>

      {/* barra de ações */}
      <div className="mg-toolbar mg-card flex-wrap no-print">
        {podeEditar && !editando && <button type="button" data-testid="config-editar" className="tb-btn tb-btn-ghost is-primary" onClick={entrar}><Pencil /> Editar</button>}
        {editando && <>
          <button type="button" data-testid="config-salvar" className="tb-btn tb-btn-green" disabled={salvar.isPending} onClick={tentarSalvar}><Save /> Salvar</button>
          <button type="button" data-testid="config-cancelar" className="tb-btn tb-btn-ghost is-primary" onClick={cancelar}><X /> Cancelar</button>
          <button type="button" data-testid="config-desfazer" className="tb-btn tb-btn-ghost is-primary" disabled={!r.podeDesfazer} onClick={r.desfazer} title="Desfazer"><Undo2 /> Desfazer</button>
          <button type="button" data-testid="config-refazer" className="tb-btn tb-btn-ghost is-primary" disabled={!r.podeRefazer} onClick={r.refazer} title="Refazer"><Redo2 /> Refazer</button>
          <button type="button" data-testid="config-restaurar" className="tb-btn tb-btn-ghost is-primary" onClick={() => setConfirmaRestaurar(true)}><RotateCcw /> Restaurar layout do sistema</button>
        </>}
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" data-testid="config-exportar" className="tb-btn tb-btn-ghost is-primary" onClick={exportar}><Download /> Exportar</button>
        </span>
      </div>

      {salvo && <p data-testid="layout-salvo" className="text-[12px] text-emerald-700">Layout salvo.</p>}
      {aviso && <p data-testid="config-aviso" role="alert" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{aviso}</p>}
      {erros.length > 0 && <div data-testid="layout-erros" role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
        <p className="font-medium">O layout não foi salvo:</p>
        <ul className="ml-4 list-disc">{erros.map((e, k) => <li key={k} data-caminho={e.caminho}>{e.mensagem}</li>)}</ul>
      </div>}
      {salvar.isError && !erros.length && <ErrorState error={salvar.error} />}
      {erroExportar !== null && <ErrorState error={erroExportar} />}

      {/* grade 268/40/1fr do configurador dos cadastros */}
      <div className={cn("emp-layout-config-grid", editando && "emp-layout-config-editing", arrastando && "emp-layout-config-is-dragging")}>
        <aside className="emp-layout-config-sidebar"><Disponiveis /></aside>
        <section className="emp-layout-config-transfer" aria-hidden>
          <span className="mg-nav-btn emp-layout-config-transfer-btn"><ChevronFirst /></span>
          <span className="mg-nav-btn emp-layout-config-transfer-btn"><ChevronLast /></span>
        </section>
        <main className="emp-layout-config-main flex flex-col gap-3">
          <PreviaPrincipal />
          <PreviaItens />
          <PreviaRodape />
        </main>
      </div>

      <TopsListaDupla layoutId={d.id} familia={d.familia} podeEditar={podeEditar} ligadas={d.tops} />

      {configurando && editando && <ConfigurarCampoDialogo chave={configurando} onFechar={() => setConfigurando(null)} />}
      <ConfirmDialog open={confirmaRestaurar} onOpenChange={setConfirmaRestaurar} title="Restaurar layout do sistema"
        text="Troca o rascunho pelo layout do sistema (a Central de hoje). Nada é gravado até você salvar; dá para desfazer."
        confirmLabel="Restaurar" onConfirm={() => { setConfirmaRestaurar(false); aplicar({ ok: true, estrutura: LAYOUT_DO_SISTEMA(d.familia) }); setSelecionado(null); }} />
    </div>
  </ConfiguradorContexto.Provider>;
}
