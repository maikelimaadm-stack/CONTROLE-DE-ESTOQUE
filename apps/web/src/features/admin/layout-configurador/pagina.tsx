"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronFirst, ChevronLast, Redo2, RotateCcw, Save, Settings2, Undo2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDirtyTab } from "@/lib/workspace-tabs";
import { cn } from "@/lib/utils";
import { Badge, ConfirmDialog, ErrorState, Input, LoadingState } from "@/components/ui";
import {
  LAYOUT_DO_SISTEMA, catalogoDaFamilia, familiaTemLayout, validarEstruturaLayout,
  type ErroDoLayout, type EstruturaLayout
} from "@agro/domain";
import {
  BASE_LAYOUTS, ConfiguradorContexto, TEXTOS, chaveDetalhe, invalidarLayouts,
  type ConfiguradorCtx, type RegistroConhecido, type ResultadoOperacao
} from "./contrato";
import { ondeEsta, removerCampo } from "./operacoes";
import { useRascunho } from "./rascunho";
import { Disponiveis } from "./disponiveis";
import { PreviaPrincipal } from "./previa-principal";
import { PreviaItens } from "./previa-itens";
import { PreviaRodape } from "./previa-rodape";
import { ConfigurarCampoDialogo } from "./configurar-campo";
import { AvisoNaoUsado, StatusDeUso, useUsoDoLayout } from "./status-uso";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › LAYOUTS DE DOCUMENTO — ÁREA DE CONFIGURAÇÃO do layout selecionado na grade
 * (VENDAS-A3-1c, decisão 261; tela única da VENDAS-A3-1d, decisão 262).
 *
 * Sem passo "Editar": quem pode editar (`can` só apresenta; quem nega é a rota) já trabalha no RASCUNHO (`useRascunho`,
 * desfazer/refazer até 50). Salvar e Cancelar só ligam quando o rascunho (nome + estrutura) difere do GRAVADO; Salvar =
 * validação do domínio (a mesma que o servidor refaz) + PUT {nome, estrutura} → o gravado novo vira a base e a área
 * continua editável; 422 → erros por caminho visíveis. Toda gravação derruba o cache dos layouts E o da Central
 * (`invalidarLayouts`). Sem permissão: somente leitura, com a frase dita na barra. As TOPs, o Exportar e o "Voltar" saíram
 * daqui: ficam na barra da grade, logo acima.
 *
 * CACHE DO DETALHE: `chaveDetalhe(id)` é a MESMA chave em toda peça (área, status de uso, TOPs). Por isso o cache guarda
 * o JSON CRU do GET e cada peça lê com `select` — um formato só na chave, qualquer que seja a peça que buscou primeiro.
 */

interface TopLigada { id: string; codigo: string; nome: string }
interface Detalhe {
  id: string; code: string; nome: string; familia: string; padrao: boolean;
  estrutura: EstruturaLayout | null; tops: TopLigada[];
  padroesDeCadastro: ReadonlyMap<string, RegistroConhecido>; padroesInvalidos: ReadonlySet<string>;
}
interface Familia { codigo: string; rotulo: string }
interface Gravado { nome: string; estrutura: EstruturaLayout }

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
  const entradas = v instanceof Map ? [...(v as Map<string, unknown>).entries()] : v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v as Obj) : [];
  for (const [chave, x] of entradas) { const o = obj(x); const id = str(o.id); if (id) m.set(chave, { id, rotulo: str(o.rotulo) }); }
  return m;
}
function lerDetalhe(v: unknown): Detalhe {
  const o = obj(v);
  const est = o.estrutura && typeof o.estrutura === "object" ? (o.estrutura as EstruturaLayout) : null;
  const invalidos: unknown[] = o.padroesInvalidos instanceof Set ? [...(o.padroesInvalidos as Set<unknown>)] : Array.isArray(o.padroesInvalidos) ? o.padroesInvalidos : [];
  return {
    id: str(o.id), code: str(o.code ?? o.codigo), nome: str(o.nome), familia: str(o.familia), padrao: Boolean(o.padrao),
    estrutura: est, tops: (Array.isArray(o.tops) ? o.tops : []).map(lerTop),
    padroesDeCadastro: lerPadroes(o.padroesDeCadastro),
    padroesInvalidos: new Set(invalidos.filter((x): x is string => typeof x === "string"))
  };
}
/** 422 → erros por caminho. Aceita `details` como lista ou `{ erros | errors | campos }`. */
function errosDaApi(e: unknown): ErroDoLayout[] {
  if (!(e instanceof ApiError)) return [];
  const d = e.details;
  const lista = Array.isArray(d) ? d : Array.isArray(obj(d).erros) ? obj(d).erros : Array.isArray(obj(d).errors) ? obj(d).errors : Array.isArray(obj(d).campos) ? obj(d).campos : [];
  return (lista as unknown[]).map((x) => { const o = obj(x); return { caminho: str(o.caminho ?? o.path), mensagem: str(o.mensagem ?? o.message) }; }).filter((x) => x.mensagem);
}

/**
 * Assinatura para comparar rascunho × gravado: JSON.stringify com as chaves de objeto em ordem — mover um campo e
 * devolvê-lo, ou reaplicar o mesmo valor no "Configurar", não é mudança só porque a ordem das chaves mudou.
 */
function assinatura(nome: string, estrutura: EstruturaLayout): string {
  return JSON.stringify({ nome: nome.trim(), estrutura }, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

export function AreaConfiguracao({ id, onSujo, onVisualizarTops }: {
  id: string;
  /** a tela pergunta antes de trocar de linha / criar outro com o rascunho sujo */
  onSujo: (sujo: boolean) => void;
  onVisualizarTops: () => void;
}) {
  const detalhe = useQuery<unknown, ApiError, Detalhe>({
    queryKey: chaveDetalhe(id), queryFn: () => api<unknown>(`${BASE_LAYOUTS}/${id}`), select: lerDetalhe, retry: false
  });
  const d = detalhe.data;
  const est = d?.estrutura;
  // Com o detalhe em mãos a área fica: um refetch que falhe (ex.: rede) não descarta o rascunho de quem está editando.
  if (d && est) return <Configurador key={d.id} d={d} estrutura={est} onSujo={onSujo} onVisualizarTops={onVisualizarTops} />;
  if (detalhe.isPending) return <div data-testid="config-layout-pagina"><LoadingState /></div>;
  return <div data-testid="config-layout-pagina" className="space-y-3">
    <ErrorState error={detalhe.error ?? undefined} message={detalhe.error ? undefined : "O servidor respondeu o layout sem estrutura."} />
  </div>;
}

function Configurador({ d, estrutura: gravadaInicial, onSujo, onVisualizarTops }: {
  d: Detalhe; estrutura: EstruturaLayout; onSujo: (sujo: boolean) => void; onVisualizarTops: () => void;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const podeEditar = can("tipos_operacao.edit") && familiaTemLayout(d.familia);
  const familiasQ = useQuery({ queryKey: ["tipos-operacao", "familias"], queryFn: () => api<{ items: Familia[] }>("/api/admin/tipos-operacao/familias") });
  const rotuloMovimento = familiasQ.data?.items.find((f) => f.codigo === d.familia)?.rotulo ?? d.familia;
  const catalogo = React.useMemo(() => catalogoDaFamilia(d.familia), [d.familia]);
  const uso = useUsoDoLayout(d.id, d.familia);

  const [gravado, setGravado] = React.useState<Gravado>(() => ({ nome: d.nome, estrutura: gravadaInicial }));
  const [nome, setNome] = React.useState(d.nome);
  const r = useRascunho(gravadaInicial);
  const { mudar, reiniciar } = r;
  const [selecionado, setSelecionado] = React.useState<string | null>(null);
  const [arrastando, setArrastando] = React.useState<string | null>(null);
  const [abaAtiva, setAbaAtiva] = React.useState(0);
  const [configurando, setConfigurando] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);
  const [erros, setErros] = React.useState<ErroDoLayout[]>([]);
  const [salvo, setSalvo] = React.useState(false);
  const [confirmaRestaurar, setConfirmaRestaurar] = React.useState(false);

  // SUJO = rascunho (nome.trim + estrutura) ≠ gravado. É o que liga Salvar/Cancelar, marca a aba e avisa a tela.
  const assinaturaGravada = React.useMemo(() => assinatura(gravado.nome, gravado.estrutura), [gravado]);
  const assinaturaAtual = React.useMemo(() => assinatura(nome, r.estrutura), [nome, r.estrutura]);
  const sujo = podeEditar && assinaturaAtual !== assinaturaGravada;
  useDirtyTab(sujo);
  React.useEffect(() => { onSujo(sujo); }, [sujo, onSujo]);
  React.useEffect(() => () => onSujo(false), [onSujo]);
  // o rascunho de AGORA (para o sucesso do PUT saber se houve mudança enquanto gravava)
  const atual = React.useRef({ nome, estrutura: r.estrutura });
  atual.current = { nome, estrutura: r.estrutura };

  const aplicar = React.useCallback((res: ResultadoOperacao) => {
    if (!podeEditar) { setAviso(TEXTOS.somenteLeitura); return; }
    if (res.ok) { mudar(res.estrutura); setAviso(null); setSalvo(false); } else setAviso(res.motivo);
  }, [podeEditar, mudar]);
  const configurar = React.useCallback((chave: string) => {
    if (podeEditar) setConfigurando(chave); else setAviso(TEXTOS.somenteLeitura);
  }, [podeEditar]);

  const ctx: ConfiguradorCtx = {
    familia: d.familia, estrutura: r.estrutura, editando: podeEditar, podeEditar, avisar: setAviso,
    selecionado, selecionar: setSelecionado, aplicar, arrastando, setArrastando, abaAtiva, setAbaAtiva, configurar,
    padroesDeCadastro: d.padroesDeCadastro, padroesInvalidos: d.padroesInvalidos, catalogo
  };

  const salvar = useMutation({
    mutationFn: (v: Gravado) => api(`${BASE_LAYOUTS}/${d.id}`, { method: "PUT", body: v }),
    onSuccess: (_x, v) => {
      // o gravado novo vira a base; sem mudança durante a gravação, o rascunho recomeça dele (sem histórico)
      const semMudancaNoMeio = assinatura(atual.current.nome, atual.current.estrutura) === assinatura(v.nome, v.estrutura);
      setGravado(v); setErros([]); setSalvo(true);
      if (semMudancaNoMeio) { reiniciar(v.estrutura); setNome(v.nome); }
      void invalidarLayouts(qc);
    },
    onError: (e) => setErros(errosDaApi(e))
  });
  const tentarSalvar = () => {
    if (!podeEditar || !sujo) return;
    const locais = validarEstruturaLayout(d.familia, r.estrutura);
    const semNome = nome.trim() ? [] : [{ caminho: "nome", mensagem: "Informe o nome do layout." }];
    const todos = [...semNome, ...locais];
    setErros(todos); setSalvo(false);
    if (!todos.length) salvar.mutate({ nome: nome.trim(), estrutura: r.estrutura });
  };
  const cancelar = () => {
    reiniciar(gravado.estrutura); setNome(gravado.nome);
    setSelecionado(null); setConfigurando(null); setAviso(null); setErros([]); setSalvo(false); salvar.reset();
  };
  const desfazer = () => { r.desfazer(); setSalvo(false); };
  const refazer = () => { r.refazer(); setSalvo(false); };
  const selecionadoNoLayout = selecionado !== null && ondeEsta(r.estrutura, selecionado) !== null;

  // Tecla Delete no selecionado (fora de campo de texto e de diálogo) = remover do layout — a mesma operação do botão.
  React.useEffect(() => {
    if (!podeEditar || !selecionado || configurando || confirmaRestaurar) return;
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
  }, [podeEditar, selecionado, configurando, confirmaRestaurar, d.familia, r.estrutura, aplicar]);

  const mostrarSalvo = salvo && !sujo;

  return <ConfiguradorContexto.Provider value={ctx}>
    <div className="b1 emp-layout-configurator flex flex-col gap-2" data-testid="config-layout-pagina">
      {/* cabeçalho do layout selecionado (a grade e a barra dela ficam logo acima) */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white px-3 py-2 shadow-sm">
        {podeEditar
          ? <Input data-testid="config-nome" aria-label="Nome do layout" className="w-72" value={nome} onChange={(e) => { setNome(e.target.value); setSalvo(false); }} />
          : <h2 data-testid="config-nome" className="text-[15px] font-semibold text-slate-900">{gravado.nome}</h2>}
        <span className="text-[12px] text-slate-600">Movimento: <b data-testid="config-movimento">{rotuloMovimento}</b></span>
        <span className="text-[12px] text-slate-600">Código: <b data-testid="config-codigo">{d.code}</b></span>
        {d.padrao && <Badge tone="green" data-testid="config-padrao-selo">Padrão do movimento</Badge>}
      </div>

      <StatusDeUso layoutId={d.id} familia={d.familia} rotuloMovimento={rotuloMovimento} onVisualizarTops={onVisualizarTops} sujo={sujo} />

      {/* ferramentas da área */}
      <div className="flex min-h-9 flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-3 py-1 shadow-sm no-print">
        {podeEditar ? <>
          <button type="button" data-testid="config-salvar" className="tb-btn tb-btn-green" disabled={!sujo || salvar.isPending} onClick={tentarSalvar}><Save /> Salvar</button>
          <button type="button" data-testid="config-cancelar" className="tb-btn tb-btn-ghost is-primary" disabled={!sujo || salvar.isPending} onClick={cancelar}><X /> Cancelar</button>
          <button type="button" data-testid="config-desfazer" className="tb-btn tb-btn-ghost is-primary" disabled={!r.podeDesfazer} onClick={desfazer} title="Desfazer"><Undo2 /> Desfazer</button>
          <button type="button" data-testid="config-refazer" className="tb-btn tb-btn-ghost is-primary" disabled={!r.podeRefazer} onClick={refazer} title="Refazer"><Redo2 /> Refazer</button>
          <button type="button" data-testid="config-configurar-selecionado" className="tb-btn tb-btn-ghost is-primary" disabled={!selecionadoNoLayout}
            onClick={() => { if (selecionado) setConfigurando(selecionado); }}><Settings2 /> Configurar o item selecionado</button>
          <button type="button" data-testid="config-restaurar" className="tb-btn tb-btn-ghost is-primary" onClick={() => setConfirmaRestaurar(true)}><RotateCcw /> Restaurar layout do sistema</button>
        </> : <p data-testid="config-somente-leitura" className="text-[12px] text-slate-600">{TEXTOS.somenteLeitura}</p>}
      </div>

      {mostrarSalvo && <p data-testid="layout-salvo" className="text-[12px] text-emerald-700">Layout salvo.</p>}
      {mostrarSalvo && uso.estado === "nao-usado" && <AvisoNaoUsado layoutId={d.id} onVisualizarTops={onVisualizarTops} testId="config-salvo-nao-usado" />}
      {aviso && <p data-testid="config-aviso" role="alert" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{aviso}</p>}
      {erros.length > 0 && <div data-testid="layout-erros" role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
        <p className="font-medium">O layout não foi salvo:</p>
        <ul className="ml-4 list-disc">{erros.map((e, k) => <li key={k} data-caminho={e.caminho}>{e.mensagem}</li>)}</ul>
      </div>}
      {salvar.isError && !erros.length && <ErrorState error={salvar.error} />}

      {/* grade 268/40/1fr do configurador dos cadastros */}
      <div className={cn("emp-layout-config-grid", podeEditar && "emp-layout-config-editing", arrastando && "emp-layout-config-is-dragging")}>
        <aside className="emp-layout-config-sidebar"><Disponiveis /></aside>
        <section className="emp-layout-config-transfer" aria-hidden>
          <span className="emp-layout-config-transfer-btn inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 [&_svg]:h-3 [&_svg]:w-3"><ChevronFirst /></span>
          <span className="emp-layout-config-transfer-btn inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 [&_svg]:h-3 [&_svg]:w-3"><ChevronLast /></span>
        </section>
        <main className="emp-layout-config-main flex flex-col gap-3">
          <PreviaPrincipal />
          <PreviaItens />
          <PreviaRodape />
        </main>
      </div>

      {configurando && podeEditar && <ConfigurarCampoDialogo chave={configurando} onFechar={() => setConfigurando(null)} />}
      <ConfirmDialog open={confirmaRestaurar} onOpenChange={setConfirmaRestaurar} title="Restaurar layout do sistema"
        text="Troca o rascunho pelo layout do sistema (a Central de hoje). Nada é gravado até você salvar; dá para desfazer."
        confirmLabel="Restaurar" onConfirm={() => { setConfirmaRestaurar(false); aplicar({ ok: true, estrutura: LAYOUT_DO_SISTEMA(d.familia) }); setSelecionado(null); setConfigurando(null); }} />
    </div>
  </ConfiguradorContexto.Provider>;
}
