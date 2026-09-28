"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Eye, Plus, Power, Star, Trash2, Upload } from "lucide-react";
import { api, ApiError, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { COPY } from "@/lib/copy";
import { Button, ConfirmDialog, Dialog, ErrorState } from "@/components/ui";
import { catalogoDaFamilia, chavePadraoDeCadastro, type ErroDoLayout } from "@agro/domain";
import { BASE_LAYOUTS, TEXTOS, invalidarLayouts, type LayoutLinha } from "./contrato";

/**
 * BARRA DA GRADE DE LAYOUTS (VENDAS-A3-1d, decisão 262) — as ações que antes moravam no menu "⋯" de cada linha e no
 * cabeçalho do painel, agora numa faixa só, sobre a linha SELECIONADA da grade (como no ERP de referência).
 *
 * Sem linha selecionada, só Novo e Importar ficam ligados. `can()` só ESCONDE botão; quem nega é a rota
 * (`tipos_operacao.*`). TODA gravação chama `invalidarLayouts(qc)` — lista, detalhe e o cache da Central caem juntos.
 * Os endpoints são os de hoje (A3-1/A3-1b): duplicar, ativo, padrao, DELETE, exportar, importar.
 */

interface ResultadoImportacao { id: string; code: string; nome: string; removidos: { campo: string; motivo: string }[] }
type EstadoImportacao =
  | { tipo: "sucesso"; resultado: ResultadoImportacao; familia: string }
  | { tipo: "erro"; erro?: unknown; mensagem?: string };

/** Uma gravação sobre a linha selecionada. A linha vai junto: é o retrato do momento do clique. */
type Acao =
  | { tipo: "duplicar"; linha: LayoutLinha }
  | { tipo: "ativo"; linha: LayoutLinha; ativo: boolean }
  | { tipo: "padrao"; linha: LayoutLinha }
  | { tipo: "excluir"; linha: LayoutLinha };

// ── leitura tolerante do contrato (snake_case ou camelCase), sem inventar valor ──────────────────────
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function lerImportacao(v: unknown): ResultadoImportacao {
  const o = obj(v);
  const removidos = (Array.isArray(o.removidos) ? o.removidos : []).map((x) => { const r = obj(x); return { campo: str(r.campo), motivo: str(r.motivo) }; }).filter((r) => r.campo);
  return { id: str(o.id), code: str(o.code ?? o.codigo), nome: str(o.nome), removidos };
}
/** Rótulo do campo de uma chave de padrão ("client_id", "itens.warehouse_id") pelo catálogo da família (dono: domínio). */
function rotuloDaChave(familia: string, chave: string): string {
  return catalogoDaFamilia(familia).find((c) => chavePadraoDeCadastro(c.parte, c.chave) === chave)?.rotulo ?? chave;
}
/** 422 → erros por caminho. Aceita `details` como lista ou `{ erros | errors | campos }`. */
function errosDaApi(e: unknown): ErroDoLayout[] {
  if (!(e instanceof ApiError)) return [];
  const d = e.details;
  const lista = Array.isArray(d) ? d : Array.isArray(obj(d).erros) ? obj(d).erros : Array.isArray(obj(d).errors) ? obj(d).errors : Array.isArray(obj(d).campos) ? obj(d).campos : [];
  return (lista as unknown[]).map((x) => { const o = obj(x); return { caminho: str(o.caminho ?? o.path), mensagem: str(o.mensagem ?? o.message) }; }).filter((x) => x.mensagem);
}

function executar(a: Acao): Promise<unknown> {
  const url = `${BASE_LAYOUTS}/${a.linha.id}`;
  switch (a.tipo) {
    case "duplicar": return api<unknown>(`${url}/duplicar`, { method: "POST", body: {} });
    case "ativo": return api<unknown>(`${url}/ativo`, { method: "POST", body: { ativo: a.ativo } });
    case "padrao": return api<unknown>(`${url}/padrao`, { method: "POST" });
    case "excluir": return api<unknown>(url, { method: "DELETE" });
  }
}

export function BarraGrade({ linha, familias, onNovo, onSelecionar, onVisualizarTops, onExcluido }: {
  linha: LayoutLinha | null;
  familias: { codigo: string; rotulo: string }[];
  onNovo: () => void;
  onSelecionar: (id: string) => void;
  onVisualizarTops: () => void;
  /** Depois de excluir a linha selecionada (ela some da grade): a tela limpa a seleção. */
  onExcluido?: () => void;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [erro, setErro] = React.useState<unknown>(null);
  const [excluindo, setExcluindo] = React.useState<LayoutLinha | null>(null);
  const [exportando, setExportando] = React.useState(false);
  const [importacao, setImportacao] = React.useState<EstadoImportacao | null>(null);
  const arquivoRef = React.useRef<HTMLInputElement>(null);

  const podeVer = can("tipos_operacao.view");
  const podeCriar = can("tipos_operacao.create");
  const podeEditar = can("tipos_operacao.edit");
  const podeExcluir = can("tipos_operacao.delete");

  const acao = useMutation({
    mutationFn: executar,
    onMutate: () => setErro(null),
    onSuccess: (r, a) => {
      void invalidarLayouts(qc);
      if (a.tipo === "duplicar") { const id = str(obj(r).id); if (id) onSelecionar(id); }
      if (a.tipo === "excluir") { setExcluindo(null); onExcluido?.(); }
    },
    onError: (e) => { setExcluindo(null); setErro(e); }
  });
  const ocupado = acao.isPending;
  const rodando = (tipo: Acao["tipo"]) => acao.isPending && acao.variables?.tipo === tipo;

  // ── Exportar / importar (VENDAS-A3-1b) ──
  const exportar = () => {
    if (!linha) return;
    setErro(null);
    setExportando(true);
    download(`${BASE_LAYOUTS}/${linha.id}/exportar`, `layout-${linha.code}.json`)
      .catch((e: unknown) => setErro(e))
      .finally(() => setExportando(false));
  };
  const importar = useMutation({
    mutationFn: (arquivo: unknown) => api<unknown>(`${BASE_LAYOUTS}/importar`, { method: "POST", body: arquivo }),
    onSuccess: (r, arquivo) => {
      const resultado = lerImportacao(r);
      setImportacao({ tipo: "sucesso", resultado, familia: str(obj(arquivo).familia) });
      void invalidarLayouts(qc);
      if (resultado.id) onSelecionar(resultado.id);
    },
    onError: (e) => setImportacao({ tipo: "erro", erro: e })
  });
  /** Lê o arquivo escolhido e manda o objeto como veio: quem decide se o conteúdo vale é o servidor (schema estrito). */
  const escolherArquivo = async (f: File | undefined) => {
    if (!f) return;
    let conteudo: unknown;
    try { conteudo = JSON.parse(await f.text()) as unknown; } catch {
      setImportacao({ tipo: "erro", mensagem: "O arquivo não é um JSON válido. Escolha um arquivo exportado de um layout de documento." });
      return;
    }
    importar.mutate(conteudo);
  };

  const rotuloMovimento = (codigo: string) => familias.find((f) => f.codigo === codigo)?.rotulo ?? codigo;
  const semLinha = "Selecione um layout na grade.";
  const motivoPadrao = !linha ? semLinha
    : linha.padrao ? "Este layout já é o padrão do movimento."
    : !linha.ativo ? "Ative o layout antes de usá-lo como padrão do movimento."
    : undefined;

  return <div data-testid="layouts-barra" data-linha-id={linha?.id ?? ""} className="flex flex-col gap-2 no-print">
    <div role="toolbar" aria-label="Ações do layout selecionado"
      className="flex min-h-9 flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-3 py-1 shadow-sm">
      {podeCriar && <Button size="sm" data-testid="layouts-novo" onClick={onNovo}><Plus aria-hidden /> Novo</Button>}
      {podeCriar && <Button size="sm" variant="ghost" className="is-primary" data-testid="layouts-duplicar"
        disabled={!linha || ocupado} loading={rodando("duplicar")} title={linha ? undefined : semLinha}
        onClick={() => linha && acao.mutate({ tipo: "duplicar", linha })}><Copy aria-hidden /> Duplicar</Button>}
      {podeExcluir && <Button size="sm" variant="danger" data-testid="layouts-excluir"
        disabled={!linha || ocupado} title={linha ? undefined : semLinha}
        onClick={() => { if (linha) { setErro(null); setExcluindo(linha); } }}><Trash2 aria-hidden /> {COPY.excluir}</Button>}
      {podeEditar && <Button size="sm" variant="ghost" className="is-primary" data-testid="layouts-ativar"
        disabled={!linha || ocupado} loading={rodando("ativo")} title={linha ? undefined : semLinha}
        onClick={() => linha && acao.mutate({ tipo: "ativo", linha, ativo: !linha.ativo })}>
        <Power aria-hidden /> {linha && !linha.ativo ? "Ativar" : "Inativar"}
      </Button>}
      {podeEditar && <Button size="sm" variant="ghost" className="is-primary" data-testid="layouts-padrao"
        disabled={!linha || linha.padrao || !linha.ativo || ocupado} loading={rodando("padrao")} title={motivoPadrao}
        onClick={() => linha && acao.mutate({ tipo: "padrao", linha })}><Star aria-hidden /> {TEXTOS.usarComoPadrao}</Button>}
      {podeVer && <Button size="sm" variant="ghost" className="is-primary" data-testid="layouts-visualizar-tops"
        disabled={!linha} title={linha ? undefined : semLinha} onClick={onVisualizarTops}><Eye aria-hidden /> {TEXTOS.visualizarTops}</Button>}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {podeVer && <Button size="sm" variant="ghost" className="is-primary" data-testid="layouts-exportar"
          disabled={!linha || exportando} loading={exportando} title={linha ? undefined : semLinha}
          onClick={exportar}><Download aria-hidden /> Exportar</Button>}
        {podeCriar && <Button size="sm" variant="outline" data-testid="layouts-importar" loading={importar.isPending}
          onClick={() => arquivoRef.current?.click()}><Upload aria-hidden /> Importar</Button>}
      </span>
    </div>
    {podeCriar && <input ref={arquivoRef} type="file" accept="application/json,.json" data-testid="layouts-importar-arquivo" aria-label="Arquivo do layout (JSON)" hidden
      onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; void escolherArquivo(f); }} />}
    {erro ? <ErrorState error={erro} onRetry={() => setErro(null)} retryLabel={COPY.fechar} /> : null}

    <ConfirmDialog
      open={!!excluindo}
      onOpenChange={(o) => { if (!o) setExcluindo(null); }}
      title="Excluir layout"
      description={excluindo ? `O layout ${excluindo.nome} deixa de ser usado. As TOPs ligadas a ele passam a usar o padrão do movimento (ou o layout do sistema).` : ""}
      confirmLabel={COPY.excluir}
      danger
      loading={rodando("excluir")}
      onConfirm={() => excluindo && acao.mutate({ tipo: "excluir", linha: excluindo })}
    />
    {importacao && <ResultadoDaImportacao estado={importacao} rotuloMovimento={rotuloMovimento} onFechar={() => setImportacao(null)} />}
  </div>;
}

/** Resultado do "Importar": o layout criado e os padrões de cadastro retirados, ou a recusa (422 por caminho). */
function ResultadoDaImportacao({ estado, rotuloMovimento, onFechar }: {
  estado: EstadoImportacao;
  rotuloMovimento: (codigo: string) => string;
  onFechar: () => void;
}) {
  const detalhes = estado.tipo === "erro" ? errosDaApi(estado.erro) : [];
  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title="Importar layout" size="sm" testId="layouts-importar-resultado"
    footer={<Button variant="outline" onClick={onFechar}>{COPY.fechar}</Button>}>
    {estado.tipo === "sucesso" ? <div className="space-y-2 text-[12.5px]">
      <p data-testid="layouts-importar-sucesso" className="text-emerald-700">Layout importado: {estado.resultado.nome} ({estado.resultado.code})</p>
      {estado.familia && <p className="text-slate-600">Movimento: {rotuloMovimento(estado.familia)}</p>}
      {estado.resultado.removidos.length > 0 && <div>
        <p className="text-slate-600">Valores padrão retirados:</p>
        <ul className="ml-4 list-disc">{estado.resultado.removidos.map((r) =>
          <li key={r.campo} data-testid="layouts-importar-removido" data-campo={r.campo}>{rotuloDaChave(estado.familia, r.campo)}: {r.motivo}</li>)}
        </ul>
      </div>}
    </div> : <div data-testid="layouts-importar-erro" className="space-y-2">
      <ErrorState
        title="O layout não foi importado"
        {...(estado.mensagem ? { message: estado.mensagem }
          : detalhes.length === 1 ? { message: detalhes[0]!.mensagem }
          : detalhes.length > 1 ? { message: "O arquivo tem problemas:" }
          : { error: estado.erro })}
      />
      {detalhes.length > 1 && <ul className="ml-4 list-disc text-[12px] text-red-700">{detalhes.map((e, k) => <li key={k} data-caminho={e.caminho}>{e.mensagem}</li>)}</ul>}
    </div>}
  </Dialog>;
}
