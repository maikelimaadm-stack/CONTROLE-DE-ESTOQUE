"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rotuloFinanceiro, tituloDeDocumento } from "@agro/domain";
import { api, newIdem } from "@/lib/api";
import { toast } from "@/lib/toast";
import { COPY, enumLabel } from "@/lib/copy";
import { useIdGlobalDoRegistro } from "@/lib/id-global";
import { brl, dateBR } from "@/lib/utils";
import { Button, Dialog, Field, StatusBadge, Textarea } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";

/**
 * O QUE O DETALHE DO TÍTULO GANHA NA CENTRAL FINANCEIRA (OPERACOES-01 F8, decisão 285) — só no modo `central`; no
 * legado o detalhe é o de hoje. Origem com rótulo e "Abrir origem", o aviso do título gerado por documento, e a aba
 * Baixas com lote, tarifa e os componentes lançados em separado, mais o estorno e o recibo do LOTE inteiro.
 */

/**
 * A ORIGEM do título: o rótulo do tipo (nunca o valor técnico) e, quando é documento, "Abrir origem" pela rota que o
 * SERVIDOR resolve a partir do registro (ID Global) — com a capacidade e o escopo do registro de origem. Sem rota (não
 * visível, entidade sem número), o link simplesmente não aparece: a tela nunca monta URL por conta própria.
 */
export function OrigemDoTitulo({ sourceType, sourceId }: { sourceType: string | null; sourceId: string | null }) {
  const documento = tituloDeDocumento(sourceType);
  const registro = useIdGlobalDoRegistro(documento ? sourceType : null, documento ? sourceId : null);
  const rota = registro.data?.rota;
  return <span className="inline-flex flex-wrap items-center gap-2" data-testid="fin-origem">
    <span>{sourceType ? enumLabel("source_type", sourceType) : "Manual"}</span>
    {rota && <Link href={rota} className="text-brand-700 underline" data-testid="fin-abrir-origem">Abrir origem</Link>}
  </span>;
}

/** O aviso do título gerado por documento: valor, parceiro e rateio mudam pela ORIGEM (o servidor recusa com 409). */
export function AvisoDaOrigem({ sourceType }: { sourceType: string | null }) {
  return <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800" data-testid="fin-aviso-origem">
    Título gerado por {enumLabel("source_type", sourceType)}: valor, parceiro e rateio mudam pela origem. Altere pela origem.
  </p>;
}

type Componente = { id: string; componente: string; valor: string; natureza_nome: string | null; status: string };

/** Os componentes lançados em separado numa baixa (juros, multa, acréscimo, tarifa), com a natureza de cada um. */
function textoDosComponentes(r: Row): string {
  const comps = (r["componentes"] as Componente[] | undefined) ?? [];
  return comps.map((c) => `${rotuloFinanceiro("componente_baixa", c.componente)} ${brl(c.valor)}${c.natureza_nome ? ` (${c.natureza_nome})` : ""}${c.status === "cancelled" ? " — estornado" : ""}`).join("; ");
}

/** Estorno do LOTE inteiro (todas as baixas, o movimento único, os componentes e a tarifa do lote), com MOTIVO. */
function DialogoEstornoDoLote({ loteId, onOpenChange }: { loteId: string | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = React.useState("");
  React.useEffect(() => { if (loteId) setMotivo(""); }, [loteId]);
  const estornar = useMutation({
    mutationFn: () => api<{ baixas_estornadas: number; movimentos_estornados: number }>(`/api/financeiro/lotes-baixa/${loteId}/estorno`, { method: "POST", body: { motivo: motivo.trim() }, idempotencyKey: newIdem() }),
    onSuccess: (r) => { toast.success(`Lote estornado: ${r.baixas_estornadas} baixa(s) e ${r.movimentos_estornados} movimento(s)`); void qc.invalidateQueries(); onOpenChange(false); },
    onError: (e) => toast.error((e as Error).message)
  });
  return <Dialog open={Boolean(loteId)} onOpenChange={onOpenChange} title="Estornar lote de baixa" size="md" testId="fin-dialogo-estorno-lote"
    footer={<><Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button><Button size="sm" variant="danger" loading={estornar.isPending} disabled={!motivo.trim()} onClick={() => estornar.mutate()}>Confirmar estorno</Button></>}>
    <p className="mb-3 text-sm text-slate-600">Todas as baixas confirmadas do lote são estornadas de uma vez — inclusive as dos outros títulos do lote —, com o movimento bancário, os lançamentos separados e a tarifa do lote. Nada é excluído: os movimentos ficam cancelados, com o motivo na trilha.</p>
    <div className="grid grid-cols-12 gap-2"><Field label="Motivo" required span={12}><Textarea value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} /></Field></div>
  </Dialog>;
}

/** Recibo do LOTE (texto do servidor). */
function ReciboDoLote({ loteId, onOpenChange }: { loteId: string | null; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({ queryKey: ["financeiro-recibo-lote", loteId], queryFn: () => api<{ recibo: string }>(`/api/financeiro/lotes-baixa/${loteId}/recibo`), enabled: Boolean(loteId) });
  return <Dialog open={Boolean(loteId)} onOpenChange={onOpenChange} title="Recibo do lote" size="lg" profile="content" testId="fin-recibo-lote" footer={<Button size="sm" onClick={() => window.print()}>Imprimir</Button>}>
    <pre className="whitespace-pre-wrap rounded border bg-slate-50 p-3 text-xs">{q.data?.recibo ?? (q.error ? (q.error as Error).message : "…")}</pre>
  </Dialog>;
}

/**
 * A aba BAIXAS na Central: as colunas de hoje mais Tarifa, Lote e Componentes; as ações "Cancelar baixa" (a de hoje,
 * uma baixa) e, para baixa feita em lote, "Estornar lote" e "Recibo do lote". A baixa de lote com movimento único só
 * sai inteira: cancelar uma baixa dela o servidor recusa — o caminho é estornar o lote.
 */
export function BaixasDoTitulo({ baixas, podeEstornar, podeRecibo, onCancelarBaixa }: { baixas: Row[]; podeEstornar: boolean; podeRecibo: boolean; onCancelarBaixa: (id: string) => void }) {
  const [estornarLote, setEstornarLote] = React.useState<string | null>(null);
  const [recibo, setRecibo] = React.useState<string | null>(null);
  return <>
    <SimpleTable rows={baixas} cols={[
      { key: "settlement_date", label: "Data", render: (r) => dateBR(r["settlement_date"] as string) },
      { key: "settlement_kind", label: "Tipo", render: (r) => enumLabel("settlement_kind", r["settlement_kind"]) },
      { key: "bank_account_name", label: "Conta" },
      { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) },
      { key: "discount", label: "Desconto", align: "right", render: (r) => brl(r["discount"] as string) },
      { key: "interest", label: "Juros", align: "right", render: (r) => brl(r["interest"] as string) },
      { key: "penalty", label: "Multa", align: "right", render: (r) => brl(r["penalty"] as string) },
      { key: "tarifa", label: "Tarifa", align: "right", render: (r) => (r["tarifa"] ? brl(r["tarifa"] as string) : "—") },
      { key: "net_amount", label: "Líquido", align: "right", render: (r) => brl(r["net_amount"] as string) },
      { key: "lote_id", label: "Lote", render: (r) => (r["lote_id"] ? <span title="Baixa feita em lote" data-testid="fin-baixa-em-lote">Em lote</span> : "—") },
      { key: "componentes", label: "Componentes", render: (r) => textoDosComponentes(r) || "—" },
      { key: "status", label: COPY.situacao, render: (r) => <StatusBadge domain="status" value={r["status"]} label={r["status"] === "confirmed" ? "Confirmada" : "Cancelada"} /> },
      { key: "created_by_name", label: "Usuário" },
      { key: "x", label: "", render: (r) => <span className="inline-flex flex-wrap gap-1">
        {r["status"] === "confirmed" && podeEstornar && <Button size="sm" variant="ghost" onClick={() => onCancelarBaixa(String(r["id"]))}>Cancelar baixa</Button>}
        {Boolean(r["lote_id"]) && r["status"] === "confirmed" && podeEstornar && <Button size="sm" variant="ghost" data-testid="fin-estornar-lote" onClick={() => setEstornarLote(String(r["lote_id"]))}>Estornar lote</Button>}
        {Boolean(r["lote_id"]) && podeRecibo && <Button size="sm" variant="ghost" onClick={() => setRecibo(String(r["lote_id"]))}>Recibo do lote</Button>}
      </span> }
    ]} />
    <DialogoEstornoDoLote loteId={estornarLote} onOpenChange={(o) => { if (!o) setEstornarLote(null); }} />
    <ReciboDoLote loteId={recibo} onOpenChange={(o) => { if (!o) setRecibo(null); }} />
  </>;
}
