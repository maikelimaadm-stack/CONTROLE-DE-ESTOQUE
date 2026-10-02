"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { dateBR, dateTimeBR } from "@/lib/utils";
import { COPY } from "@/lib/copy";
import { Button, Card, CardHeader, CardBody, Dialog, ErrorState, Field, Input, NativeSelect, StatusBadge } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { colunaIdGlobalTabela } from "@/features/listing/id-global-coluna";
import { POR_PAGINA } from "./contas";

/**
 * CONCILIAÇÃO OFX (OPERACOES-01 F8, decisão 285). A lista das importações é PAGINADA no servidor, com as contagens
 * de cada uma (transações, conciliadas, pendentes, ignoradas). Importar valida a conta no servidor (a do arquivo tem de
 * ser a cadastrada), lê os valores em DECIMAL (ponto ou vírgula) e concilia sozinho só o "Encontrado" único (mesmo
 * valor e mesma data); sugestão e soma de vários pedem confirmação humana no detalhe.
 */

interface LinhaImportacao extends Record<string, unknown> {
  id: string; codigo: string; descricao: string; conta_id: string; conta: string; de: string | null; ate: string | null; situacao: string;
  transacoes: number; conciliadas: number; ignoradas: number; pendentes: number; criado_em: string; id_global?: number | null;
}
interface RespostaImportacoes { itens: LinhaImportacao[]; total: number; page: number; pageSize: number; idGlobal?: { rotulo: string } }
interface ResultadoImportacao { id: string; codigo: string; transacoes: number; duplicadas: number; recusadas: { fitid: string | null; motivo: string }[]; conciliadas_automaticamente: number }

export function ConciliacaoOfx() {
  const { can } = useAuth(); const router = useRouter();
  const [f, setF] = React.useState({ conta: "", situacao: "" });
  const [page, setPage] = React.useState(1); const pageSize = POR_PAGINA;
  const [importar, setImportar] = React.useState(false);
  const q = useQuery({
    queryKey: ["financeiro-ofx-importacoes", f, page, pageSize],
    queryFn: () => api<RespostaImportacoes>(`/api/financeiro/conciliacao/importacoes${qs({ conta_id: f.conta, situacao: f.situacao, page, pageSize })}`)
  });
  const colunas = React.useMemo<Column<LinhaImportacao>[]>(() => [
    ...(q.data?.idGlobal ? [colunaIdGlobalTabela<LinhaImportacao>(q.data.idGlobal.rotulo)] : []),
    { key: "codigo", label: "Código" },
    { key: "descricao", label: "Descrição" },
    { key: "conta", label: "Conta" },
    { key: "de", label: "De", render: (r) => dateBR(r.de) },
    { key: "ate", label: "Até", render: (r) => dateBR(r.ate) },
    { key: "transacoes", label: "Transações", align: "right" },
    { key: "conciliadas", label: "Conciliadas", align: "right" },
    { key: "pendentes", label: "Pendentes", align: "right" },
    { key: "ignoradas", label: "Ignoradas", align: "right" },
    { key: "situacao", label: COPY.situacao, render: (r) => <StatusBadge domain="status" value={r.situacao} /> },
    { key: "criado_em", label: "Importado em", render: (r) => dateTimeBR(r.criado_em) }
  ], [q.data?.idGlobal]);
  const setFiltro = (k: keyof typeof f, v: string) => { setF((o) => ({ ...o, [k]: v })); setPage(1); };
  return <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="fin-conciliacao">
    <Card>
      <CardHeader title="Conciliação bancária (OFX)" subtitle="Importe o extrato OFX da conta e confirme cada transação com os movimentos: Encontrado (valor e data iguais), Sugestão (mesmo valor, data até 3 dias) ou Soma de vários."
        actions={can("ofx_imports.create") && <Button size="sm" data-testid="fin-ofx-importar" onClick={() => setImportar(true)}>Importar OFX</Button>} />
      <CardBody className="grid grid-cols-12 gap-2 pt-0">
        <Field label="Conta bancária" span={5}><RefSelect resource="bank_accounts" value={f.conta} onChange={(v) => setFiltro("conta", v ?? "")} /></Field>
        <Field label={COPY.situacao} span={3}><NativeSelect value={f.situacao} onChange={(e) => setFiltro("situacao", e.target.value)}>
          <option value="">Todas</option><option value="imported">Importado</option><option value="reconciling">Conciliando</option><option value="reconciled">Conciliado</option>
        </NativeSelect></Field>
      </CardBody>
    </Card>
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    <DataTable<LinhaImportacao> rows={q.data?.itens ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} loading={q.isLoading}
      columns={colunas} rowKey={(r) => r.id} emptyText="Nenhuma importação OFX." onRowClick={(r) => router.push(`/financeiro/ofx/${r.id}`)} />
    {importar && <DialogoImportarOfx onClose={() => setImportar(false)} onImportado={(id) => router.push(`/financeiro/ofx/${id}`)} />}
  </div>;
}

/** Arquivo lido no navegador como TEXTO e enviado inteiro: a leitura (SGML ou XML, valores em decimal) é do servidor. */
function DialogoImportarOfx({ onClose, onImportado }: { onClose: () => void; onImportado: (id: string) => void }) {
  const qc = useQueryClient();
  const [h, setH] = React.useState({ conta: "", descricao: "", conteudo: "", arquivo: "" });
  const [erro, setErro] = React.useState<string | null>(null);
  const chave = React.useRef(newIdem());
  const enviar = useMutation({
    mutationFn: () => api<ResultadoImportacao>("/api/financeiro/conciliacao/importacoes", { method: "POST", body: { conta_id: h.conta, descricao: h.descricao.trim(), conteudo: h.conteudo }, idempotencyKey: chave.current }),
    onSuccess: (r) => {
      const partes = [`${r.transacoes} transação(ões) importada(s)`, `${r.conciliadas_automaticamente} conciliada(s) automaticamente`];
      if (r.duplicadas) partes.push(`${r.duplicadas} já importada(s) antes`);
      if (r.recusadas.length) partes.push(`${r.recusadas.length} recusada(s)`);
      toast.success(`Importação ${r.codigo}: ${partes.join(" · ")}`);
      void qc.invalidateQueries(); onClose(); onImportado(r.id);
    },
    onError: (e) => { chave.current = newIdem(); setErro((e as Error).message); }
  });
  const pronto = Boolean(h.conta && h.descricao.trim() && h.conteudo.length >= 10);
  return <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title="Importar arquivo OFX" size="md" testId="fin-dialogo-ofx-importar"
    footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button><Button size="sm" loading={enviar.isPending} disabled={!pronto || enviar.isPending} data-testid="fin-ofx-importar-confirmar" onClick={() => { setErro(null); enviar.mutate(); }}>Importar</Button></>}>
    <div className="grid grid-cols-12 gap-2">
      <Field label="Conta bancária" required span={7}><RefSelect resource="bank_accounts" value={h.conta} onChange={(v) => setH({ ...h, conta: v ?? "" })} /></Field>
      <Field label="Descrição" required span={5}><Input value={h.descricao} maxLength={200} onChange={(e) => setH({ ...h, descricao: e.target.value })} /></Field>
      <Field label="Arquivo" required span={12} help="Extrato no formato OFX exportado pelo banco"><Input type="file" accept=".ofx,.txt" data-testid="fin-ofx-arquivo" onChange={(e) => {
        const arq = e.target.files?.[0];
        if (arq) void arq.text().then((t) => setH((o) => ({ ...o, conteudo: t, arquivo: arq.name, descricao: o.descricao || arq.name })));
      }} /></Field>
      {h.arquivo && <p className="col-span-12 text-xs text-slate-500">Arquivo: {h.arquivo}</p>}
      {erro && <p className="col-span-12 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700" role="alert" data-testid="fin-ofx-importar-erro">{erro}</p>}
    </div>
  </Dialog>;
}
