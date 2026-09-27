"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, download, qs } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { COPY } from "@/lib/copy";
import {
  Badge, Button, Card, CardBody, ConfirmDialog, Dialog, EmptyState, ErrorState,
  LoadingState, Menu, NativeSelect, PageHeader, StatusBadge
} from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { catalogoDaFamilia, chavePadraoDeCadastro, familiaTemLayout, type ErroDoLayout } from "@agro/domain";
import { NovoLayoutDialogo } from "./layout-configurador/novo-layout";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › LAYOUTS DE DOCUMENTO (VENDAS-A3-1, decisão 259).
 *
 * O layout governa só a DIGITAÇÃO da Central de Vendas (o que aparece, em que ordem, com que rótulo, o que é
 * obrigatório). A regra mora no domínio (`layout-documento.ts`): esta tela usa `validarEstruturaLayout` antes de
 * enviar — a mesma conta que o servidor refaz na gravação. As famílias vêm do servidor
 * (`/api/admin/tipos-operacao/familias`), recortadas por `familiaTemLayout`; o cliente não tem lista própria.
 *
 * `can()` só ESCONDE botão; quem nega é a rota (permissões `tipos_operacao.*`).
 *
 * VENDAS-A3-1b (decisão 260): valor padrão "Registro do cadastro" nos campos de referência (o recurso e o filtro vêm
 * do catálogo do domínio, `referencia`) e na coluna Armazém; exportar/importar o layout como arquivo JSON. Quem diz se
 * o registro vale é o servidor: o GET do layout devolve `padroesDeCadastro` (rótulo do que vale) e `padroesInvalidos`
 * (o que morreu); a gravação recusa o que não vale. API anterior não manda os dois — a tela lê como vazios.
 */
const BASE = "/api/admin/layouts-documento";
const CHAVE = ["layouts-documento"] as const;

interface Familia { codigo: string; rotulo: string; modulo: string | null }
interface LayoutLinha extends Record<string, unknown> {
  id: string; code: string; nome: string; familia: string; padrao: boolean; ativo: boolean; topsLigadas: number;
}
interface ResultadoImportacao { id: string; code: string; nome: string; removidos: { campo: string; motivo: string }[] }

// ── leitura tolerante do contrato (snake_case ou camelCase), sem inventar valor ──────────────────────
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const itens = (v: unknown): unknown[] => (Array.isArray(v) ? v : Array.isArray(obj(v).items) ? (obj(v).items as unknown[]) : []);
function lerLinha(v: unknown): LayoutLinha {
  const o = obj(v);
  const tops = o.tops;
  return {
    id: str(o.id), code: str(o.code ?? o.codigo), nome: str(o.nome), familia: str(o.familia),
    padrao: Boolean(o.padrao), ativo: Boolean(o.ativo ?? o.isActive ?? o.is_active),
    topsLigadas: Number(o.qtdTops ?? o.topsLigadas ?? o.tops_ligadas ?? o.topsCount ?? o.tops_count ?? (Array.isArray(tops) ? tops.length : 0)) || 0
  };
}
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

// ── Painel ──────────────────────────────────────────────────────────────────────────────────────────────
export function LayoutsDocumentoPanel() {
  const { can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [filtroFamilia, setFiltroFamilia] = React.useState("");
  const [criando, setCriando] = React.useState(false);
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

  // ── Exportar / importar (VENDAS-A3-1b) ──
  const exportar = (r: LayoutLinha) => {
    setErro(null);
    download(`${BASE}/${r.id}/exportar`, `layout-${r.code}.json`).catch((e: unknown) => setErro(e));
  };
  const arquivoRef = React.useRef<HTMLInputElement>(null);
  const [importacao, setImportacao] = React.useState<
    { tipo: "sucesso"; resultado: ResultadoImportacao; familia: string } | { tipo: "erro"; erro?: unknown; mensagem?: string } | null
  >(null);
  const importar = useMutation({
    mutationFn: (arquivo: unknown) => api<unknown>(`${BASE}/importar`, { method: "POST", body: arquivo }),
    onSuccess: (r, arquivo) => { setImportacao({ tipo: "sucesso", resultado: lerImportacao(r), familia: str(obj(arquivo).familia) }); recarregar(); },
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

  const podeVer = can("tipos_operacao.view");
  const podeEditar = can("tipos_operacao.edit");
  const podeCriar = can("tipos_operacao.create");
  const podeExcluir = can("tipos_operacao.delete");
  const linhas = consulta.data ?? [];

  return <Card>
    <PageHeader
      inCard
      title="Layouts de documento"
      subtitle="O que a Central de Vendas mostra, em que ordem, com que rótulo e o que é obrigatório ao salvar. A TOP usa o layout ligado a ela; sem ligação, o padrão do movimento; sem padrão, o layout do sistema."
      actions={podeCriar && <>
        <Button size="sm" variant="outline" data-testid="layouts-importar" loading={importar.isPending} onClick={() => arquivoRef.current?.click()}>Importar</Button>
        <Button size="sm" onClick={() => setCriando(true)}>Novo layout</Button>
      </>}
    />
    {podeCriar && <input ref={arquivoRef} type="file" accept="application/json,.json" data-testid="layouts-importar-arquivo" aria-label="Arquivo do layout (JSON)" hidden
      onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; void escolherArquivo(f); }} />}
    <CardBody>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Movimento" data-testid="layouts-filtro-familia" className="w-56" value={filtroFamilia} onChange={(e) => setFiltroFamilia(e.target.value)}>
          <option value="">Todos os movimentos</option>
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
                  { label: podeEditar ? "Editar" : "Ver", onClick: () => router.push(`/configuracoes/layouts-documento/${r.id}`) },
                  ...(podeCriar ? [{ label: "Duplicar", onClick: () => acao.mutate({ caminho: `${BASE}/${r.id}/duplicar`, method: "POST" }) }] : []),
                  ...(podeVer ? [{ label: "Exportar", onClick: () => exportar(r) }] : []),
                  ...(podeEditar ? [
                    { label: r.ativo ? "Inativar" : "Ativar", onClick: () => acao.mutate({ caminho: `${BASE}/${r.id}/ativo`, method: "POST", body: { ativo: !r.ativo } }) },
                    { label: "Padrão do movimento", disabled: r.padrao || !r.ativo, onClick: () => acao.mutate({ caminho: `${BASE}/${r.id}/padrao`, method: "POST" }) }
                  ] : []),
                  ...(podeExcluir ? [{ label: COPY.excluir, danger: true, onClick: () => setExcluindo(r) }] : [])
                ]}
              />}
              columns={[
                { key: "code", label: "Código", width: 110, render: (r: LayoutLinha) => <span data-testid={`layout-linha-${r.id}`} data-ativo={r.ativo} data-padrao={r.padrao}>{r.code}</span> },
                { key: "nome", label: "Nome" },
                { key: "familia", label: "Movimento", render: (r: LayoutLinha) => rotuloFamilia(r.familia) },
                { key: "padrao", label: "Padrão", render: (r: LayoutLinha) => r.padrao ? <Badge tone="blue">Padrão</Badge> : <span className="text-slate-400">—</span> },
                { key: "ativo", label: COPY.situacao, render: (r: LayoutLinha) => <StatusBadge domain="status" value={r.ativo ? "active" : "inactive"} /> },
                { key: "topsLigadas", label: "TOPs ligadas", align: "right", render: (r: LayoutLinha) => r.topsLigadas }
              ]}
            />}
      </div>
    </CardBody>

    {criando && <NovoLayoutDialogo familias={familias.map((f) => ({ codigo: f.codigo, nome: f.rotulo }))} onFechar={() => { setCriando(false); recarregar(); }} />}
    <ConfirmDialog
      open={!!excluindo}
      onOpenChange={(o) => { if (!o) setExcluindo(null); }}
      title="Excluir layout"
      description={excluindo ? `O layout ${excluindo.nome} deixa de ser usado. As TOPs ligadas a ele passam a usar o padrão do movimento (ou o layout do sistema).` : ""}
      confirmLabel={COPY.excluir}
      danger
      loading={acao.isPending}
      onConfirm={() => excluindo && acao.mutate({ caminho: `${BASE}/${excluindo.id}`, method: "DELETE" })}
    />
    {importacao && <ResultadoDaImportacao estado={importacao} onFechar={() => setImportacao(null)} />}
  </Card>;
}

/** Resultado do "Importar": o layout criado e os padrões de cadastro retirados, ou a recusa (422 por caminho). */
function ResultadoDaImportacao({ estado, onFechar }: {
  estado: { tipo: "sucesso"; resultado: ResultadoImportacao; familia: string } | { tipo: "erro"; erro?: unknown; mensagem?: string };
  onFechar: () => void;
}) {
  const detalhes = estado.tipo === "erro" ? errosDaApi(estado.erro) : [];
  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title="Importar layout" size="sm" testId="layouts-importar-resultado"
    footer={<Button variant="outline" onClick={onFechar}>{COPY.fechar}</Button>}>
    {estado.tipo === "sucesso" ? <div className="space-y-2 text-[12.5px]">
      <p data-testid="layouts-importar-sucesso" className="text-emerald-700">Layout importado: {estado.resultado.nome} ({estado.resultado.code})</p>
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
