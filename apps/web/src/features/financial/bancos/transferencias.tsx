"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rotuloFinanceiro } from "@agro/domain";
import { api, qs, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { brl, dateBR, todayISO } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { Button, Card, CardHeader, CardBody, EmptyState, ErrorState, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useUrlParam } from "@/components/workspace";
import { colunaIdGlobalTabela } from "@/features/listing/id-global-coluna";
import { useEmpresaPadrao } from "@/features/docs/shared";
import { rotuloDaConta, usePodeVerContas, useContasDaOrganizacao, valorDecimal } from "./contas";

/**
 * BANCOS E CAIXA › TRANSFERÊNCIAS (OPERACOES-01 F8, decisão 285). Transferência entre contas, depósito (caixa →
 * banco), saque (banco → caixa), aplicação (→ conta de aplicação) e resgate (aplicação →): todos são movimento
 * interno com as DUAS pontas (saída na origem, entrada no destino), sem rateio — nenhum é receita nem despesa. A regra
 * de cada tipo pelo tipo das contas é do SERVIDOR (`POST /api/financeiro/transferencias`); a tela só orienta.
 * `?nova=1` abre o formulário (ação "Nova transferência entre contas" do menu).
 */

const TIPOS = ["transferencia", "deposito", "saque", "aplicacao", "resgate"] as const;
type TipoTransferencia = (typeof TIPOS)[number];
const ORIENTACAO: Record<TipoTransferencia, string> = {
  transferencia: "Entre duas contas quaisquer da organização.",
  deposito: "Do caixa para uma conta que não é caixa.",
  saque: "De uma conta que não é caixa para o caixa.",
  aplicacao: "De uma conta comum para uma conta de aplicação.",
  resgate: "De uma conta de aplicação para uma conta comum."
};

interface LinhaTransferencia extends Record<string, unknown> {
  id: string; code: string; movement_date: string; bank_account_id: string; bank_account_name: string; destination_account_id: string | null;
  tipo_transferencia: string | null; amount: string; document: string | null; note: string | null; id_global?: number | null;
}

export function Transferencias() {
  const { can } = useAuth(); const router = useRouter();
  const [nova, setNova] = useUrlParam("nova", "");
  const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(20);
  const contas = useContasDaOrganizacao();
  // A saída na conta de origem representa a transferência (a entrada no destino é o par dela): uma linha por transferência.
  const q = useQuery({
    queryKey: ["financeiro-transferencias", page, pageSize],
    queryFn: () => api<{ items: LinhaTransferencia[]; total: number; idGlobal?: { rotulo: string } }>(`/api/financial/bank-movements${qs({ category_type: "internal_transfer", type: "out", page, pageSize })}`)
  });
  const nomeDaConta = React.useMemo(() => new Map((contas.data?.itens ?? []).map((c) => [c.id, `${c.codigo} — ${c.descricao}`])), [contas.data]);
  const colunas = React.useMemo<Column<LinhaTransferencia>[]>(() => [
    ...(q.data?.idGlobal ? [colunaIdGlobalTabela<LinhaTransferencia>(q.data.idGlobal.rotulo)] : []),
    { key: "movement_date", label: "Data", render: (r) => dateBR(r.movement_date) },
    { key: "code", label: "Código" },
    { key: "tipo_transferencia", label: "Tipo", render: (r) => rotuloDoTipo(r.tipo_transferencia), text: (r) => rotuloDoTipo(r.tipo_transferencia) },
    { key: "bank_account_name", label: "Conta de origem" },
    { key: "destination_account_id", label: "Conta de destino", render: (r) => (r.destination_account_id && nomeDaConta.get(r.destination_account_id)) || "—", text: (r) => (r.destination_account_id && nomeDaConta.get(r.destination_account_id)) || "" },
    { key: "amount", label: "Valor", align: "right", render: (r) => brl(r.amount) },
    { key: "document", label: "Documento", render: (r) => r.document ?? "" },
    { key: "note", label: "Observação", render: (r) => r.note ?? "" }
  ], [q.data?.idGlobal, nomeDaConta]);

  return <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="fin-transferencias">
    {nova === "1" && can("bank_movements.create")
      ? <FormularioDeTransferencia onClose={() => setNova("")} />
      : <Card><CardHeader title="Transferências entre contas" subtitle="Transferência, depósito, saque, aplicação e resgate: movimentos internos com as duas pontas, que não são receita nem despesa."
          actions={can("bank_movements.create") && <Button size="sm" data-testid="fin-transferencia-nova" onClick={() => setNova("1")}>Nova transferência</Button>} /></Card>}
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    <DataTable<LinhaTransferencia> rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} loading={q.isLoading}
      columns={colunas} rowKey={(r) => r.id} caption="Últimas transferências" emptyText="Nenhuma transferência lançada." onRowClick={(r) => router.push(`/financeiro/movimentos/${r.id}`)} />
  </div>;
}

/** Transferência antiga (sem rótulo gravado) continua sendo "transferência interna" — o rótulo de hoje. */
function rotuloDoTipo(tipo: string | null): string {
  return tipo ? rotuloFinanceiro("tipo_transferencia", tipo) : enumLabel("bank_category_type", "internal_transfer");
}

function FormularioDeTransferencia({ onClose }: { onClose: () => void }) {
  const pode = usePodeVerContas(); const qc = useQueryClient();
  const contas = useContasDaOrganizacao();
  const empresaPadrao = useEmpresaPadrao();
  const vazio = { tipo: "transferencia" as TipoTransferencia, origem: "", destino: "", data: todayISO(), valor: "", empresa: empresaPadrao, documento: "", observacao: "" };
  const [h, setH] = React.useState(vazio);
  const [erro, setErro] = React.useState<string | null>(null);
  // A chave de idempotência nasce com o formulário e muda a cada lançamento: clique duplo não lança duas vezes.
  const chave = React.useRef(newIdem());
  const enviar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => api<{ id: string; par_id: string }>("/api/financeiro/transferencias", { method: "POST", body: corpo, idempotencyKey: chave.current }),
    onSuccess: () => {
      toast.success("Transferência lançada");
      chave.current = newIdem(); setErro(null); setH({ ...vazio, tipo: h.tipo, data: h.data, empresa: h.empresa });
      void qc.invalidateQueries();
    },
    onError: (e) => setErro((e as Error).message)
  });
  const ativas = (contas.data?.itens ?? []).filter((c) => c.ativa);
  const valor = valorDecimal(h.valor);
  const iguais = Boolean(h.origem && h.origem === h.destino);
  const pronto = Boolean(h.origem && h.destino && !iguais && h.data && valor && h.empresa);
  if (!pode) return <Card><CardBody><EmptyState title="Lançar transferência exige ver as contas bancárias da organização." /></CardBody></Card>;
  return <Card data-testid="fin-transferencia-form">
    <CardHeader title="Nova transferência entre contas" subtitle={ORIENTACAO[h.tipo]} actions={<Button size="sm" variant="outline" onClick={onClose}>Fechar</Button>} />
    <CardBody className="grid grid-cols-12 gap-2">
      <Field label="Tipo" required span={3}><NativeSelect value={h.tipo} onChange={(e) => setH({ ...h, tipo: e.target.value as TipoTransferencia })}>
        {TIPOS.map((t) => <option key={t} value={t}>{rotuloFinanceiro("tipo_transferencia", t)}</option>)}
      </NativeSelect></Field>
      <Field label="Conta de origem" required span={3}><NativeSelect value={h.origem} onChange={(e) => setH({ ...h, origem: e.target.value })}>
        <option value="">Selecione</option>{ativas.map((c) => <option key={c.id} value={c.id}>{rotuloDaConta(c)}</option>)}
      </NativeSelect></Field>
      <Field label="Conta de destino" required span={3} error={iguais ? "Conta de origem e destino iguais" : undefined}><NativeSelect value={h.destino} onChange={(e) => setH({ ...h, destino: e.target.value })}>
        <option value="">Selecione</option>{ativas.map((c) => <option key={c.id} value={c.id}>{rotuloDaConta(c)}</option>)}
      </NativeSelect></Field>
      <Field label="Data" required span={3}><Input type="date" value={h.data} onChange={(e) => setH({ ...h, data: e.target.value })} /></Field>
      <Field label="Valor" required span={3} error={h.valor && !valor ? "Valor inválido" : undefined}><Input type="number" step="0.01" min="0" value={h.valor} onChange={(e) => setH({ ...h, valor: e.target.value })} /></Field>
      <Field label="Empresa" required span={3}><RefSelect resource="empresas" value={h.empresa} onChange={(v) => setH({ ...h, empresa: v ?? "" })} /></Field>
      <Field label="Documento" span={3}><Input value={h.documento} maxLength={60} onChange={(e) => setH({ ...h, documento: e.target.value })} /></Field>
      <Field label="Observação" span={3}><Input value={h.observacao} maxLength={500} placeholder={rotuloFinanceiro("tipo_transferencia", h.tipo)} onChange={(e) => setH({ ...h, observacao: e.target.value })} /></Field>
      {erro && <p className="col-span-12 text-sm text-red-600" role="alert" data-testid="fin-transferencia-erro">{erro}</p>}
      <div className="col-span-12 flex justify-end">
        <Button size="sm" loading={enviar.isPending} disabled={!pronto || enviar.isPending} data-testid="fin-transferencia-lancar"
          onClick={() => valor && enviar.mutate({ tipo: h.tipo, conta_origem_id: h.origem, conta_destino_id: h.destino, data: h.data, valor, empresa_id: h.empresa, documento: h.documento || null, observacao: h.observacao || null })}>Lançar transferência</Button>
      </div>
    </CardBody>
  </Card>;
}
