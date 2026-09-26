"use client";
import * as React from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { COPY } from "@/lib/copy";
import {
  Badge, Button, Card, CardBody, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input,
  LoadingState, Menu, NativeSelect, PageHeader, StatusBadge
} from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import {
  catalogoDaFamilia, familiaTemLayout, validarEstruturaLayout,
  type AbaDoLayout, type CampoDoCatalogo, type CampoDoLayout, type ColunaDoLayout, type ErroDoLayout,
  type EstruturaLayout, type ParteDoLayout, type ValorPadraoLayout
} from "@agro/domain";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › LAYOUTS DE DOCUMENTO (VENDAS-A3-1, decisão 259).
 *
 * O layout governa só a DIGITAÇÃO da Central de Vendas (o que aparece, em que ordem, com que rótulo, o que é
 * obrigatório). A regra mora no domínio (`layout-documento.ts`): esta tela usa `validarEstruturaLayout` antes de
 * enviar — a mesma conta que o servidor refaz na gravação. As famílias vêm do servidor
 * (`/api/admin/tipos-operacao/familias`), recortadas por `familiaTemLayout`; o cliente não tem lista própria.
 *
 * `can()` só ESCONDE botão; quem nega é a rota (permissões `tipos_operacao.*`).
 */
const BASE = "/api/admin/layouts-documento";
const CHAVE = ["layouts-documento"] as const;

interface Familia { codigo: string; rotulo: string; modulo: string | null }
interface LayoutLinha extends Record<string, unknown> {
  id: string; code: string; nome: string; familia: string; padrao: boolean; ativo: boolean; topsLigadas: number;
}
interface TopLigada { id: string; codigo: string; nome: string }
interface LayoutDetalhe extends LayoutLinha { estrutura: EstruturaLayout; tops: TopLigada[] }
interface TopDaFamilia { id: string; codigo: string; nome: string; ativo: boolean }

// ── leitura tolerante do contrato (snake_case ou camelCase), sem inventar valor ──────────────────────
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const itens = (v: unknown): unknown[] => (Array.isArray(v) ? v : Array.isArray(obj(v).items) ? (obj(v).items as unknown[]) : []);
function lerTop(v: unknown): TopLigada {
  if (typeof v === "string") return { id: v, codigo: "", nome: "" };
  const o = obj(v);
  return { id: str(o.id ?? o.tipoOperacaoId ?? o.tipo_operacao_id), codigo: str(o.codigo), nome: str(o.nome) };
}
function lerLinha(v: unknown): LayoutLinha {
  const o = obj(v);
  const tops = o.tops;
  return {
    id: str(o.id), code: str(o.code ?? o.codigo), nome: str(o.nome), familia: str(o.familia),
    padrao: Boolean(o.padrao), ativo: Boolean(o.ativo ?? o.isActive ?? o.is_active),
    topsLigadas: Number(o.qtdTops ?? o.topsLigadas ?? o.tops_ligadas ?? o.topsCount ?? o.tops_count ?? (Array.isArray(tops) ? tops.length : 0)) || 0
  };
}
function lerDetalhe(v: unknown): LayoutDetalhe {
  const o = obj(v);
  return { ...lerLinha(o), estrutura: o.estrutura as EstruturaLayout, tops: (Array.isArray(o.tops) ? o.tops : []).map(lerTop) };
}
/** 422 → erros por caminho. Aceita `details` como lista ou `{ erros | errors | campos }`. */
function errosDaApi(e: unknown): ErroDoLayout[] {
  if (!(e instanceof ApiError)) return [];
  const d = e.details;
  const lista = Array.isArray(d) ? d : Array.isArray(obj(d).erros) ? obj(d).erros : Array.isArray(obj(d).errors) ? obj(d).errors : Array.isArray(obj(d).campos) ? obj(d).campos : [];
  return (lista as unknown[]).map((x) => { const o = obj(x); return { caminho: str(o.caminho ?? o.path), mensagem: str(o.mensagem ?? o.message) }; }).filter((x) => x.mensagem);
}

// ── Painel ──────────────────────────────────────────────────────────────────────────────────────────────
export function LayoutsDocumentoPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [filtroFamilia, setFiltroFamilia] = React.useState("");
  const [criando, setCriando] = React.useState(false);
  const [editando, setEditando] = React.useState<LayoutLinha | null>(null);
  const [excluindo, setExcluindo] = React.useState<LayoutLinha | null>(null);
  const [erro, setErro] = React.useState<unknown>(null);

  const familiasQ = useQuery({
    queryKey: ["tipos-operacao", "familias"],
    queryFn: () => api<{ items: Familia[] }>("/api/admin/tipos-operacao/familias")
  });
  const familias = React.useMemo(() => (familiasQ.data?.items ?? []).filter((f) => familiaTemLayout(f.codigo)), [familiasQ.data]);
  const rotuloFamilia = (c: string) => familias.find((f) => f.codigo === c)?.rotulo ?? c;

  const consulta = useQuery({
    queryKey: [...CHAVE, "lista", filtroFamilia],
    queryFn: async () => itens(await api<unknown>(`${BASE}${qs({ familia: filtroFamilia })}`)).map(lerLinha)
  });
  const recarregar = () => { void qc.invalidateQueries({ queryKey: CHAVE }); };
  const acao = useMutation({
    mutationFn: (v: { caminho: string; method: "POST" | "DELETE"; body?: unknown }) => api(v.caminho, { method: v.method, body: v.body }),
    onSuccess: () => { setExcluindo(null); recarregar(); },
    onError: (e) => { setExcluindo(null); setErro(e); }
  });

  const podeEditar = can("tipos_operacao.edit");
  const podeCriar = can("tipos_operacao.create");
  const podeExcluir = can("tipos_operacao.delete");
  const linhas = consulta.data ?? [];

  return <Card>
    <PageHeader
      inCard
      title="Layouts de documento"
      subtitle="O que a Central de Vendas mostra, em que ordem, com que rótulo e o que é obrigatório ao salvar. A TOP usa o layout ligado a ela; sem ligação, o padrão da família; sem padrão, o layout do sistema."
      actions={podeCriar && <Button size="sm" onClick={() => setCriando(true)}>Novo layout</Button>}
    />
    <CardBody>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Família" data-testid="layouts-filtro-familia" className="w-56" value={filtroFamilia} onChange={(e) => setFiltroFamilia(e.target.value)}>
          <option value="">Todas as famílias</option>
          {familias.map((f) => <option key={f.codigo} value={f.codigo}>{f.rotulo}</option>)}
        </NativeSelect>
      </div>
      {erro ? <div className="mb-3"><ErrorState error={erro} onRetry={() => setErro(null)} retryLabel={COPY.fechar} /></div> : null}
      <div data-testid="layouts-documento">
        {consulta.isLoading ? <LoadingState /> : consulta.isError ? <ErrorState error={consulta.error} onRetry={recarregar} />
          : linhas.length === 0 ? <EmptyState title="Nenhum layout cadastrado" description="Sem layout, a Central usa o layout do sistema." />
          : <DataTable
              rows={linhas}
              actions={(r: LayoutLinha) => <Menu
                trigger={<Button variant="ghost" size="sm" aria-label={COPY.maisOpcoes}>⋯</Button>}
                items={[
                  { label: podeEditar ? "Editar" : "Ver", onClick: () => setEditando(r) },
                  ...(podeCriar ? [{ label: "Duplicar", onClick: () => acao.mutate({ caminho: `${BASE}/${r.id}/duplicar`, method: "POST" }) }] : []),
                  ...(podeEditar ? [
                    { label: r.ativo ? "Inativar" : "Ativar", onClick: () => acao.mutate({ caminho: `${BASE}/${r.id}/ativo`, method: "POST", body: { ativo: !r.ativo } }) },
                    { label: "Padrão da família", disabled: r.padrao || !r.ativo, onClick: () => acao.mutate({ caminho: `${BASE}/${r.id}/padrao`, method: "POST" }) }
                  ] : []),
                  ...(podeExcluir ? [{ label: COPY.excluir, danger: true, onClick: () => setExcluindo(r) }] : [])
                ]}
              />}
              columns={[
                { key: "code", label: "Código", width: 110, render: (r: LayoutLinha) => <span data-testid={`layout-linha-${r.id}`} data-ativo={r.ativo} data-padrao={r.padrao}>{r.code}</span> },
                { key: "nome", label: "Nome" },
                { key: "familia", label: "Família", render: (r: LayoutLinha) => rotuloFamilia(r.familia) },
                { key: "padrao", label: "Padrão", render: (r: LayoutLinha) => r.padrao ? <Badge tone="blue">Padrão</Badge> : <span className="text-slate-400">—</span> },
                { key: "ativo", label: COPY.situacao, render: (r: LayoutLinha) => <StatusBadge domain="status" value={r.ativo ? "active" : "inactive"} /> },
                { key: "topsLigadas", label: "TOPs ligadas", align: "right", render: (r: LayoutLinha) => r.topsLigadas }
              ]}
            />}
      </div>
    </CardBody>

    {criando && <NovoLayout familias={familias} onFechar={() => setCriando(false)} onPronto={() => { setCriando(false); recarregar(); }} />}
    {editando && <EditorLayout id={editando.id} podeEditar={podeEditar} rotuloFamilia={rotuloFamilia} onFechar={() => setEditando(null)} onPronto={recarregar} />}
    <ConfirmDialog
      open={!!excluindo}
      onOpenChange={(o) => { if (!o) setExcluindo(null); }}
      title="Excluir layout"
      description={excluindo ? `O layout ${excluindo.nome} deixa de ser usado. As TOPs ligadas a ele passam a usar o padrão da família (ou o layout do sistema).` : ""}
      confirmLabel={COPY.excluir}
      danger
      loading={acao.isPending}
      onConfirm={() => excluindo && acao.mutate({ caminho: `${BASE}/${excluindo.id}`, method: "DELETE" })}
    />
  </Card>;
}

function NovoLayout({ familias, onFechar, onPronto }: { familias: Familia[]; onFechar: () => void; onPronto: () => void }) {
  const [familia, setFamilia] = React.useState(familias[0]?.codigo ?? "");
  const [nome, setNome] = React.useState("");
  const criar = useMutation({
    // Sem estrutura: o servidor cria a cópia do layout do sistema da família.
    mutationFn: () => api(BASE, { method: "POST", body: { familia, nome: nome.trim() } }),
    onSuccess: onPronto
  });
  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title="Novo layout" size="sm" testId="layout-novo"
    footer={<><Button variant="outline" onClick={onFechar}>{COPY.fechar}</Button><Button data-testid="layout-novo-criar" loading={criar.isPending} disabled={!familia || !nome.trim()} onClick={() => criar.mutate()}>Criar</Button></>}>
    <div className="grid grid-cols-12 gap-3">
      <Field label="Família" span={12} required>
        <NativeSelect data-testid="layout-novo-familia" value={familia} onChange={(e) => setFamilia(e.target.value)}>
          {familias.map((f) => <option key={f.codigo} value={f.codigo}>{f.rotulo}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Nome" span={12} required>
        <Input data-testid="layout-novo-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      </Field>
    </div>
    <p className="mt-2 text-[12px] text-slate-500">O layout nasce como cópia do layout do sistema (a Central de hoje).</p>
    {criar.isError && <div className="mt-2"><ErrorState error={criar.error} /></div>}
  </Dialog>;
}

// ── Editor ──────────────────────────────────────────────────────────────────────────────────────────────
type Alvo = { parte: "cabecalho" | "itens"; i: number } | { parte: "rodape"; aba: number; i: number };
const caminhoDe = (a: Alvo) => a.parte === "rodape" ? `rodape[${a.aba}].campos[${a.i}]` : `${a.parte}[${a.i}]`;
const mover = <T,>(l: T[], i: number, d: number): T[] => { const j = i + d; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; };

function EditorLayout({ id, podeEditar, rotuloFamilia, onFechar, onPronto }: {
  id: string; podeEditar: boolean; rotuloFamilia: (c: string) => string; onFechar: () => void; onPronto: () => void;
}) {
  const detalhe = useQuery<LayoutDetalhe, ApiError>({ queryKey: [...CHAVE, id, "detalhe"], queryFn: async () => lerDetalhe(await api<unknown>(`${BASE}/${id}`)), retry: false });
  if (detalhe.isPending || detalhe.isError || !detalhe.data.estrutura) {
    return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title="Layout de documento" size="xl" testId="layout-editor">
      {detalhe.isPending ? <LoadingState /> : <ErrorState error={detalhe.error} message={detalhe.error ? undefined : "O servidor respondeu o layout sem estrutura."} />}
    </Dialog>;
  }
  return <CorpoEditor key={id} d={detalhe.data} podeEditar={podeEditar} rotuloFamilia={rotuloFamilia} onFechar={onFechar} onPronto={onPronto} />;
}

function CorpoEditor({ d, podeEditar, rotuloFamilia, onFechar, onPronto }: {
  d: LayoutDetalhe; podeEditar: boolean; rotuloFamilia: (c: string) => string; onFechar: () => void; onPronto: () => void;
}) {
  const qc = useQueryClient();
  const cat = React.useMemo(() => catalogoDaFamilia(d.familia), [d.familia]);
  const doCat = (parte: ParteDoLayout, chave: string) => cat.find((c) => c.parte === parte && c.chave === chave);
  const [nome, setNome] = React.useState(d.nome);
  const [est, setEst] = React.useState<EstruturaLayout>(d.estrutura);
  const [erros, setErros] = React.useState<ErroDoLayout[]>([]);
  const [soObrigatorios, setSoObrigatorios] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const [configurando, setConfigurando] = React.useState<Alvo | null>(null);
  const [salvo, setSalvo] = React.useState(false);

  const mudar = (e: EstruturaLayout) => { setEst(e); setSalvo(false); };
  const noLayout = new Set([...est.cabecalho.map((x) => `cabecalho:${x.campo}`), ...est.rodape.flatMap((a) => a.campos.map((x) => `rodape:${x.campo}`)), ...est.itens.map((x) => `itens:${x.campo}`)]);
  const termo = busca.trim().toLowerCase();
  const disponiveis = cat.filter((c) => !noLayout.has(`${c.parte}:${c.chave}`) && (!soObrigatorios || c.sistema) && (!termo || c.rotulo.toLowerCase().includes(termo)));

  const incluir = (c: CampoDoCatalogo) => {
    if (c.parte === "cabecalho") mudar({ ...est, cabecalho: [...est.cabecalho, { campo: c.chave, obrigatorio: Boolean(c.sistema), editavel: !c.somenteLeitura }] });
    else if (c.parte === "itens") mudar({ ...est, itens: [...est.itens, { campo: c.chave, obrigatorio: Boolean(c.sistema) && !c.somenteLeitura }] });
    else {
      const novo: CampoDoLayout = { campo: c.chave, obrigatorio: Boolean(c.sistema), editavel: true };
      const i = est.rodape.findIndex((a) => a.aba === c.aba);
      const rodape = i >= 0 ? est.rodape.map((a, k) => k === i ? { ...a, campos: [...a.campos, novo] } : a) : [...est.rodape, { aba: c.aba ?? "Outros", campos: [novo] }];
      mudar({ ...est, rodape });
    }
  };
  const remover = (a: Alvo) => {
    if (a.parte === "cabecalho") mudar({ ...est, cabecalho: est.cabecalho.filter((_, k) => k !== a.i) });
    else if (a.parte === "itens") mudar({ ...est, itens: est.itens.filter((_, k) => k !== a.i) });
    else if (a.parte === "rodape") mudar({ ...est, rodape: est.rodape.map((x, k) => k === a.aba ? { ...x, campos: x.campos.filter((_, j) => j !== a.i) } : x) });
  };
  const deslocar = (a: Alvo, dir: number) => {
    if (a.parte === "cabecalho") mudar({ ...est, cabecalho: mover(est.cabecalho, a.i, dir) });
    else if (a.parte === "itens") mudar({ ...est, itens: mover(est.itens, a.i, dir) });
    else if (a.parte === "rodape") mudar({ ...est, rodape: est.rodape.map((x, k) => k === a.aba ? { ...x, campos: mover(x.campos, a.i, dir) } : x) });
  };
  const moverParaAba = (aba: number, i: number, destino: number) => {
    const campo = est.rodape[aba]?.campos[i]; if (!campo || destino === aba) return;
    mudar({ ...est, rodape: est.rodape.map((x, k) => k === aba ? { ...x, campos: x.campos.filter((_, j) => j !== i) } : k === destino ? { ...x, campos: [...x.campos, campo] } : x) });
  };
  const renomearAba = (aba: number, v: string) => mudar({ ...est, rodape: est.rodape.map((x, k) => k === aba ? { ...x, aba: v } : x) });
  const removerAba = (aba: number) => mudar({ ...est, rodape: est.rodape.filter((_, k) => k !== aba) });
  const adicionarAba = () => mudar({ ...est, rodape: [...est.rodape, { aba: `Nova aba ${est.rodape.length + 1}`, campos: [] }] });
  const aplicarConfig = (a: Alvo, v: CampoDoLayout | ColunaDoLayout) => {
    if (a.parte === "cabecalho") mudar({ ...est, cabecalho: est.cabecalho.map((x, k) => k === a.i ? v as CampoDoLayout : x) });
    else if (a.parte === "itens") mudar({ ...est, itens: est.itens.map((x, k) => k === a.i ? v as ColunaDoLayout : x) });
    else if (a.parte === "rodape") mudar({ ...est, rodape: est.rodape.map((x, k) => k === a.aba ? { ...x, campos: x.campos.map((c, j) => j === a.i ? v as CampoDoLayout : c) } : x) });
  };

  const salvar = useMutation({
    mutationFn: () => api(`${BASE}/${d.id}`, { method: "PUT", body: { nome: nome.trim(), estrutura: est } }),
    onSuccess: () => { setErros([]); setSalvo(true); void qc.invalidateQueries({ queryKey: CHAVE }); onPronto(); },
    onError: (e) => setErros(errosDaApi(e))
  });
  const tentarSalvar = () => {
    const locais = validarEstruturaLayout(d.familia, est);
    setErros(locais);
    if (!locais.length) salvar.mutate();
  };
  const errosDe = (caminho: string) => erros.filter((e) => e.caminho === caminho || e.caminho.startsWith(`${caminho}.`));

  const linhaCampo = (a: Alvo, x: CampoDoLayout | ColunaDoLayout, total: number, parte: ParteDoLayout, extra?: React.ReactNode) => {
    const c = doCat(parte, x.campo);
    const caminho = caminhoDe(a);
    const meus = errosDe(caminho);
    const cfg = x as Partial<CampoDoLayout>;
    return <li key={`${parte}-${x.campo}`} data-testid={`layout-campo-${x.campo}`} data-campo={x.campo} data-caminho={caminho} className="border-b border-slate-100 py-1.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="min-w-0 flex-1 truncate">{x.rotulo || c?.rotulo || x.campo}
          {x.rotulo && c && x.rotulo !== c.rotulo && <span className="ml-1 text-[11px] text-slate-400">({c.rotulo})</span>}
        </span>
        {x.obrigatorio && <Badge tone="amber">Obrigatório</Badge>}
        {cfg.editavel === false && <Badge tone="slate">Não editável</Badge>}
        {cfg.valorPadrao && <Badge tone="blue">Com valor padrão</Badge>}
        {podeEditar && <>
          {extra}
          <Button variant="ghost" size="sm" aria-label={`Subir ${c?.rotulo ?? x.campo}`} disabled={a.i === 0} onClick={() => deslocar(a, -1)}>↑</Button>
          <Button variant="ghost" size="sm" aria-label={`Descer ${c?.rotulo ?? x.campo}`} disabled={a.i === total - 1} onClick={() => deslocar(a, 1)}>↓</Button>
          <Button variant="outline" size="sm" onClick={() => setConfigurando(a)}>Configurar campo</Button>
          <Button variant="ghost" size="sm" aria-label={`Remover ${c?.rotulo ?? x.campo}`} onClick={() => remover(a)}>Remover</Button>
        </>}
      </div>
      {meus.map((e, k) => <p key={k} role="alert" data-testid="layout-erro-campo" className="mt-0.5 text-[11.5px] text-red-600">{e.mensagem}</p>)}
    </li>;
  };
  const errosParte = (parte: string) => erros.filter((e) => e.caminho === parte).map((e, k) => <p key={k} role="alert" className="text-[11.5px] text-red-600">{e.mensagem}</p>);

  const alvoCfg = configurando;
  const campoCfg = alvoCfg ? (alvoCfg.parte === "rodape" ? est.rodape[alvoCfg.aba]?.campos[alvoCfg.i] : est[alvoCfg.parte][alvoCfg.i]) : undefined;
  const catCfg = alvoCfg && campoCfg ? doCat(alvoCfg.parte, campoCfg.campo) : undefined;

  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title={`Layout de documento — ${d.nome}`} description={`${rotuloFamilia(d.familia)} · ${d.code}`} size="xl" testId="layout-editor"
    footer={<><Button variant="outline" onClick={onFechar}>{COPY.fechar}</Button>{podeEditar && <Button data-testid="layout-salvar" loading={salvar.isPending} onClick={tentarSalvar}>Salvar layout</Button>}</>}>
    <div className="mb-3 grid grid-cols-12 gap-3">
      <Field label="Nome" span={6} required><Input data-testid="layout-nome" value={nome} disabled={!podeEditar} onChange={(e) => { setNome(e.target.value); setSalvo(false); }} /></Field>
    </div>
    {salvo && <p data-testid="layout-salvo" className="mb-2 text-[12px] text-emerald-700">Layout salvo.</p>}
    {erros.length > 0 && <div data-testid="layout-erros" role="alert" className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
      <p className="font-medium">O layout não foi salvo:</p>
      <ul className="ml-4 list-disc">{erros.map((e, k) => <li key={k} data-caminho={e.caminho}>{e.mensagem}</li>)}</ul>
    </div>}
    {salvar.isError && !erros.length && <div className="mb-3"><ErrorState error={salvar.error} /></div>}

    <div className="grid grid-cols-12 gap-4">
      <section data-testid="layout-campos-disponiveis" className="col-span-12 md:col-span-4">
        <h3 className="mb-2 text-[13px] font-semibold text-slate-700">Campos disponíveis</h3>
        <Input aria-label="Buscar campo" placeholder="Buscar campo…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-600">
          <input type="checkbox" data-testid="layout-so-obrigatorios" checked={soObrigatorios} onChange={(e) => setSoObrigatorios(e.target.checked)} />
          Mostrar só obrigatórios
        </label>
        <ul className="mt-2">
          {disponiveis.length === 0 && <li className="py-2 text-[12px] text-slate-400">Nenhum campo disponível.</li>}
          {disponiveis.map((c) => <li key={`${c.parte}:${c.chave}`} data-testid={`layout-disponivel-${c.parte}-${c.chave}`} data-campo={c.chave} className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-[12.5px]">
            <span className="flex-1">{c.rotulo} <span className="text-[11px] text-slate-400">{c.parte === "cabecalho" ? "Cabeçalho" : c.parte === "itens" ? "Itens" : `Rodapé · ${c.aba ?? ""}`}</span></span>
            {c.sistema && <Badge tone="amber">Obrigatório do sistema</Badge>}
            {podeEditar && <Button variant="outline" size="sm" aria-label={`Incluir ${c.rotulo}`} onClick={() => incluir(c)}>Incluir</Button>}
          </li>)}
        </ul>
      </section>

      <div className="col-span-12 space-y-4 md:col-span-8">
        <section data-testid="layout-cabecalho">
          <h3 className="mb-1 text-[13px] font-semibold text-slate-700">Cabeçalho</h3>
          {errosParte("cabecalho")}
          <ul>{est.cabecalho.map((x, i) => linhaCampo({ parte: "cabecalho", i }, x, est.cabecalho.length, "cabecalho"))}</ul>
        </section>
        <section data-testid="layout-itens">
          <h3 className="mb-1 text-[13px] font-semibold text-slate-700">Itens (colunas)</h3>
          {errosParte("itens")}
          <ul>{est.itens.map((x, i) => linhaCampo({ parte: "itens", i }, x, est.itens.length, "itens"))}</ul>
        </section>
        <section data-testid="layout-rodape">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="flex-1 text-[13px] font-semibold text-slate-700">Rodapé</h3>
            {podeEditar && <Button variant="outline" size="sm" data-testid="layout-adicionar-aba" onClick={adicionarAba}>Adicionar aba</Button>}
          </div>
          {errosParte("rodape")}
          {est.rodape.map((aba: AbaDoLayout, ai) => <div key={ai} data-testid={`layout-aba-${ai}`} className="mb-2 rounded border border-slate-200 px-3 py-2">
            <div className="flex items-center gap-2">
              <Input aria-label="Nome da aba" data-testid={`layout-aba-nome-${ai}`} className="w-60" value={aba.aba} disabled={!podeEditar} onChange={(e) => renomearAba(ai, e.target.value)} />
              {podeEditar && aba.campos.length === 0 && <Button variant="ghost" size="sm" onClick={() => removerAba(ai)}>Remover aba</Button>}
            </div>
            {errosDe(`rodape[${ai}]`).filter((e) => e.caminho === `rodape[${ai}]`).map((e, k) => <p key={k} role="alert" className="text-[11.5px] text-red-600">{e.mensagem}</p>)}
            <ul>{aba.campos.map((x, i) => linhaCampo({ parte: "rodape", aba: ai, i }, x, aba.campos.length, "rodape",
              est.rodape.length > 1 && <NativeSelect aria-label={`Mover ${x.campo} para a aba`} data-testid={`layout-mover-aba-${x.campo}`} className="w-40" value={ai} onChange={(e) => moverParaAba(ai, i, Number(e.target.value))}>
                {est.rodape.map((o, k) => <option key={k} value={k}>{k === ai ? "Mover para aba…" : o.aba}</option>)}
              </NativeSelect>))}</ul>
          </div>)}
        </section>
      </div>
    </div>

    <TopsLigadas layout={d} podeEditar={podeEditar} />

    {alvoCfg && campoCfg && <ConfigurarCampo
      parte={alvoCfg.parte} valor={campoCfg} catalogo={catCfg}
      onFechar={() => setConfigurando(null)}
      onAplicar={(v) => { aplicarConfig(alvoCfg, v); setConfigurando(null); }}
    />}
  </Dialog>;
}

// ── Configurar campo ────────────────────────────────────────────────────────────────────────────────────
type ModoPadrao = "nenhum" | "literal" | "variavel";
function ConfigurarCampo({ parte, valor, catalogo, onFechar, onAplicar }: {
  parte: ParteDoLayout; valor: CampoDoLayout | ColunaDoLayout; catalogo?: CampoDoCatalogo;
  onFechar: () => void; onAplicar: (v: CampoDoLayout | ColunaDoLayout) => void;
}) {
  const ehItem = parte === "itens";
  const base = valor as Partial<CampoDoLayout>;
  const tipo = catalogo?.tipo ?? "texto";
  const [rotulo, setRotulo] = React.useState(valor.rotulo ?? "");
  const [obrigatorio, setObrigatorio] = React.useState(valor.obrigatorio);
  const [editavel, setEditavel] = React.useState(base.editavel ?? true);
  const [modo, setModo] = React.useState<ModoPadrao>(base.valorPadrao ? (base.valorPadrao.tipo === "literal" ? "literal" : "variavel") : "nenhum");
  const [literal, setLiteral] = React.useState<string>(base.valorPadrao?.tipo === "literal" ? String(base.valorPadrao.valor) : "");
  const aceitaLiteral = ["data", "texto", "texto_longo", "numero", "booleano"].includes(tipo);
  const variavel = tipo === "data" ? "data_atual" as const : tipo === "empresa" ? "empresa_selecionada" as const : null;
  const somenteLeitura = Boolean(catalogo?.somenteLeitura);
  /** R1: o corpo sempre leva valor ("0", false, plano derivado) — o domínio recusa "obrigatório" nele. */
  const sempreTemValor = Boolean(catalogo?.sempreTemValor);

  const aplicar = () => {
    const r = rotulo.trim() ? { rotulo: rotulo.trim() } : {};
    if (ehItem) { onAplicar({ campo: valor.campo, ...r, obrigatorio }); return; }
    let vp: ValorPadraoLayout | undefined;
    if (modo === "variavel" && variavel) vp = { tipo: "variavel", variavel };
    if (modo === "literal") vp = { tipo: "literal", valor: tipo === "numero" ? Number(literal) : tipo === "booleano" ? literal === "true" : literal };
    onAplicar({ campo: valor.campo, ...r, obrigatorio, editavel, ...(vp ? { valorPadrao: vp } : {}) });
  };

  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title={`Configurar campo — ${catalogo?.rotulo ?? valor.campo}`} size="sm" testId="layout-configurar-campo"
    footer={<><Button variant="outline" onClick={onFechar}>{COPY.fechar}</Button><Button data-testid="layout-configurar-aplicar" onClick={aplicar}>Aplicar</Button></>}>
    <div className="grid grid-cols-12 gap-3">
      <Field label="Rótulo" span={12} help={catalogo ? `Vazio = "${catalogo.rotulo}".` : undefined}>
        <Input data-testid="layout-cfg-rotulo" value={rotulo} onChange={(e) => setRotulo(e.target.value)} />
      </Field>
      <Field label="Obrigatório" span={6} help={sempreTemValor ? "Sempre tem valor" : undefined}>
        <NativeSelect data-testid="layout-cfg-obrigatorio" value={obrigatorio ? "true" : "false"} disabled={somenteLeitura || sempreTemValor} onChange={(e) => setObrigatorio(e.target.value === "true")}>
          <option value="false">Não</option><option value="true">Sim</option>
        </NativeSelect>
      </Field>
      {!ehItem && <Field label="Editável" span={6}>
        <NativeSelect data-testid="layout-cfg-editavel" value={editavel ? "true" : "false"} disabled={somenteLeitura} onChange={(e) => setEditavel(e.target.value === "true")}>
          <option value="true">Sim</option><option value="false">Não</option>
        </NativeSelect>
      </Field>}
      {!ehItem && <Field label="Valor padrão" span={12}>
        <NativeSelect data-testid="layout-cfg-padrao-modo" value={modo} onChange={(e) => setModo(e.target.value as ModoPadrao)}>
          <option value="nenhum">Nenhum</option>
          {aceitaLiteral && <option value="literal">Valor fixo</option>}
          {variavel && <option value="variavel">{variavel === "data_atual" ? "Variável: data de hoje" : "Variável: empresa selecionada"}</option>}
        </NativeSelect>
      </Field>}
      {!ehItem && modo === "literal" && <Field label="Valor fixo" span={12}>
        {tipo === "booleano"
          ? <NativeSelect data-testid="layout-cfg-padrao-valor" value={literal} onChange={(e) => setLiteral(e.target.value)}><option value="">—</option><option value="true">Sim</option><option value="false">Não</option></NativeSelect>
          : <Input data-testid="layout-cfg-padrao-valor" type={tipo === "data" ? "date" : tipo === "numero" ? "number" : "text"} value={literal} onChange={(e) => setLiteral(e.target.value)} />}
      </Field>}
    </div>
  </Dialog>;
}

// ── TOPs ligadas ────────────────────────────────────────────────────────────────────────────────────────
function TopsLigadas({ layout, podeEditar }: { layout: LayoutDetalhe; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [marcadas, setMarcadas] = React.useState<Set<string>>(() => new Set(layout.tops.map((t) => t.id)));
  const [salvo, setSalvo] = React.useState(false);
  const topsQ = useQuery({
    queryKey: ["tipos-operacao", "por-familia", layout.familia],
    queryFn: async () => itens(await api<unknown>(`/api/admin/tipos-operacao${qs({ codigoBase: layout.familia, pageSize: 1000 })}`))
      .map((x): TopDaFamilia => { const o = obj(x); return { id: str(o.id), codigo: str(o.codigo), nome: str(o.nome), ativo: Boolean(o.ativo) }; })
  });
  // TOP → layout onde ela está hoje: os OUTROS layouts da família, lidos pelo detalhe (que traz as TOPs).
  const outrosQ = useQuery({
    queryKey: [...CHAVE, "lista", layout.familia],
    queryFn: async () => itens(await api<unknown>(`${BASE}${qs({ familia: layout.familia })}`)).map(lerLinha)
  });
  const outros = (outrosQ.data ?? []).filter((l) => l.id !== layout.id && l.topsLigadas > 0);
  const detalhes = useQueries({ queries: outros.map((l) => ({ queryKey: [...CHAVE, l.id, "detalhe"], queryFn: async () => lerDetalhe(await api<unknown>(`${BASE}/${l.id}`)) })) });
  const ondeEsta = new Map<string, string>();
  detalhes.forEach((q) => { if (q.data) for (const t of q.data.tops) ondeEsta.set(t.id, q.data.nome); });

  const salvar = useMutation({
    mutationFn: () => api(`${BASE}/${layout.id}/tops`, { method: "PUT", body: { tipoOperacaoIds: [...marcadas] } }),
    onSuccess: () => { setSalvo(true); void qc.invalidateQueries({ queryKey: CHAVE }); }
  });
  const alternar = (id: string) => { setSalvo(false); setMarcadas((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const tops = topsQ.data ?? [];

  return <section data-testid="layout-tops-ligadas" className="mt-4 border-t border-slate-200 pt-3">
    <div className="mb-1 flex items-center gap-2">
      <h3 className="flex-1 text-[13px] font-semibold text-slate-700">TOPs ligadas</h3>
      {podeEditar && <Button size="sm" variant="outline" data-testid="layout-tops-salvar" loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar TOPs ligadas</Button>}
    </div>
    <p className="mb-2 text-[12px] text-slate-500">Uma TOP usa um layout só. Ligar aqui uma TOP que está em outro layout a tira de lá.</p>
    {salvo && <p data-testid="layout-tops-salvo" className="mb-1 text-[12px] text-emerald-700">TOPs ligadas salvas.</p>}
    {salvar.isError && <ErrorState error={salvar.error} />}
    {topsQ.isLoading ? <LoadingState variant="compact" /> : topsQ.isError ? <ErrorState error={topsQ.error} />
      : tops.length === 0 ? <EmptyState compact title="Nenhum tipo de operação desta família." />
      : <ul>{tops.map((t) => {
          const outro = ondeEsta.get(t.id);
          return <li key={t.id} data-testid={`layout-top-${t.id}`} className="flex items-center gap-2 py-1 text-[12.5px]">
            <label className="flex flex-1 items-center gap-2">
              <input type="checkbox" aria-label={`Ligar ${t.codigo} — ${t.nome}`} checked={marcadas.has(t.id)} disabled={!podeEditar} onChange={() => alternar(t.id)} />
              <span>{t.codigo} — {t.nome}</span>
              {!t.ativo && <Badge tone="slate">Inativa</Badge>}
            </label>
            {marcadas.has(t.id) && outro && <span data-testid="layout-top-aviso" className="text-[11.5px] text-amber-700">sairá do layout {outro}</span>}
          </li>;
        })}</ul>}
  </section>;
}
