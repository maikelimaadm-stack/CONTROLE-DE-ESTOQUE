"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { api, qs, newIdem } from "@/lib/api";
import { brl, num, dateBR } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Card, CardHeader, CardBody, Button, Dialog, Field, Input, Confirm, Menu } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { RefSelect } from "@/components/ui/ref-select";
import { StatusBadge, useEmpresaPadrao, type Row } from "@/features/docs/shared";
import { COPY } from "@/lib/copy";
import { rotaDeLancamentoDeEstoque, useTopsDeSaldoInicial, type TopDeSaldoInicial } from "@/features/estoque/movimentacoes-variantes";

const SUBTITULO = "Saldo de abertura por produto/local de estoque/lote (gera lançamento no ledger)";
const SUBTITULO_DA_CENTRAL = "Os saldos iniciais lançados pela Central de Estoque aparecem em Estoque › Movimentações.";
const DICA_SEM_TOP = "Para lançar o saldo inicial pela Central de Estoque, marque \"Lança o saldo inicial\" na aba Implantação de um tipo de operação de entrada (Configurações › Operações › Tipos de operação).";

/**
 * "LANÇAR SALDO INICIAL" PELA CENTRAL (OPERACOES-01 F11, decisão 288): a entrada da Central de Estoque com a TOP que
 * lança o saldo inicial. Uma TOP marcada → vai direto para o lançamento dela; várias → o usuário escolhe qual.
 */
function LancarSaldoInicial({ tops }: { tops: TopDeSaldoInicial[] }) {
  const router = useRouter();
  const rota = (top: TopDeSaldoInicial) => rotaDeLancamentoDeEstoque({ segmento: "entradas", id: top.id });
  const [unica] = tops;
  if (tops.length === 1 && unica) return <Button size="sm" data-testid="implantacao-saldo-inicial" onClick={() => router.push(rota(unica))}>Lançar saldo inicial</Button>;
  // Várias: o MESMO botão abre a lista (itens `menuitem` com o nome de cada TOP; o `Menu` do sistema de design não
  // aceita testid por item). O botão é o mesmo nos dois casos: a porta não muda de nome por quantas TOPs há.
  return <Menu trigger={<Button size="sm" data-testid="implantacao-saldo-inicial">Lançar saldo inicial</Button>} items={tops.map((top) => ({ label: top.nome, href: rota(top) }))} />;
}

/**
 * Configurações › Implantação › Saldos iniciais de estoque.
 *
 * A PORTA DE LANÇAMENTO (F11) depende do que a API declara no `operation-types` da entrada (`useTopsDeSaldoInicial`):
 *   · carregando → nenhum botão (não oferecer uma porta e trocá-la logo depois);
 *   · declarada, com TOP marcada → "Lançar saldo inicial" (a Central) NO LUGAR do "Adicionar novo": uma porta só;
 *   · declarada, sem TOP marcada → o "Adicionar novo" de hoje e a dica de como marcar a TOP;
 *   · não declarada (API anterior, sem `entradas_estoque.create`, erro) → exatamente a tela de hoje.
 * O histórico antigo (com "Estornar") não muda. A regra da duplicidade é UMA no servidor, para as duas portas.
 */
export function OpeningBalancesPanel() {
  const qc = useQueryClient(); const { can } = useAuth(); const empresa = useEmpresaPadrao();
  const [open, setOpen] = React.useState(false); const [rev, setRev] = React.useState<string | null>(null); const [page, setPage] = React.useState(1);
  const [v, setV] = React.useState({ empresa_id: "", warehouse_id: "", product_id: "", quantity: "", unit_value: "", provider_lot: "", expiration_date: "" });
  React.useEffect(() => { setV((o) => ({ ...o, empresa_id: o.empresa_id || empresa })); }, [empresa]);
  const q = useQuery({ queryKey: ["opening", page], queryFn: () => api<{ items: Row[]; total: number }>(`/api/stock/opening-balances${qs({ page, pageSize: 30 })}`) });
  const create = useMutation({ mutationFn: () => api("/api/stock/opening-balances", { method: "POST", body: { ...v, provider_lot: v.provider_lot || null, expiration_date: v.expiration_date || null }, idempotencyKey: newIdem() }), onSuccess: () => { toast.success("Estoque inicial lançado"); setOpen(false); setV((o) => ({ ...o, product_id: "", quantity: "", unit_value: "", provider_lot: "", expiration_date: "" })); void qc.invalidateQueries({ queryKey: ["opening"] }); }, onError: (e) => toast.error((e as Error).message) });
  const saldoInicial = useTopsDeSaldoInicial();
  const pelaCentral = saldoInicial !== "carregando" && saldoInicial.declarada && saldoInicial.tops.length > 0;
  const dicaSemTop = saldoInicial !== "carregando" && saldoInicial.declarada && saldoInicial.tops.length === 0;
  const acoes = saldoInicial === "carregando" ? null
    : pelaCentral ? <LancarSaldoInicial tops={saldoInicial.tops} />
    : can("opening_balances.create") && <Button size="sm" onClick={() => setOpen(true)}>Adicionar novo</Button>;
  const reverse = useMutation({ mutationFn: (id: string) => api(`/api/stock/opening-balances/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Estornado"); setRev(null); void qc.invalidateQueries({ queryKey: ["opening"] }); }, onError: (e) => toast.error((e as Error).message) });
  return <Card><CardHeader title="Estoques Iniciais" subtitle={pelaCentral ? `${SUBTITULO}. ${SUBTITULO_DA_CENTRAL}` : SUBTITULO} actions={acoes} /><CardBody>
    {dicaSemTop && <p data-testid="implantacao-saldo-inicial-dica" className="mb-2 text-[11.5px] leading-relaxed text-slate-500">{DICA_SEM_TOP}</p>}
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={30} onPage={setPage} loading={q.isLoading} columns={[{ key: "product_code", label: "Código" }, { key: "product_name", label: "Produto" }, { key: "warehouse_name", label: "Local de estoque" }, { key: "quantity", label: "Quantidade total", align: "right", render: (r) => `${num(r["quantity"] as string, 4)} ${r["unit"] ?? ""}` }, { key: "unit_value", label: "Valor unitário", align: "right", render: (r) => brl(r["unit_value"] as string) }, { key: "total_value", label: "Valor total", align: "right", render: (r) => brl(r["total_value"] as string) }, { key: "provider_lot", label: "Lote Fornecedor" }, { key: "expiration_date", label: "Validade", render: (r) => dateBR(r["expiration_date"] as string) }, { key: "status", label: COPY.situacao, render: (r) => <StatusBadge s={String(r["status"])} /> }]}
      actions={(r) => r["status"] === "confirmed" && can("opening_balances.delete") ? <Button size="sm" variant="ghost" onClick={() => setRev(String(r["id"]))}>Estornar</Button> : null} />
    <Dialog open={open} onOpenChange={setOpen} title="Novo estoque inicial" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Salvar</Button></>}>
      <div className="grid grid-cols-12 gap-3">
        <Field label="Empresa" required span={6}><RefSelect resource="empresas" value={v.empresa_id} onChange={(x) => setV({ ...v, empresa_id: x ?? "", warehouse_id: "" })} /></Field>
        <Field label="Local de estoque" required span={6}><RefSelect resource="warehouses" value={v.warehouse_id} onChange={(x) => setV({ ...v, warehouse_id: x ?? "" })} filter={{ empresa_id: v.empresa_id }} /></Field>
        <Field label="Produto" required span={12}><RefSelect resource="products" value={v.product_id} onChange={(x) => setV({ ...v, product_id: x ?? "" })} /></Field>
        <Field label="Quantidade total" required span={3}><Input type="number" step="0.0001" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} /></Field>
        <Field label="Valor unitário" required span={3}><Input type="number" step="0.000001" value={v.unit_value} onChange={(e) => setV({ ...v, unit_value: e.target.value })} /></Field>
        <Field label="Valor total" span={3}><Input readOnly value={brl(Number(v.quantity || 0) * Number(v.unit_value || 0))} /></Field>
        <Field label="Lote Fornecedor" span={3}><Input value={v.provider_lot} onChange={(e) => setV({ ...v, provider_lot: e.target.value })} /></Field>
        <Field label="Data de Validade" span={3}><Input type="date" value={v.expiration_date} onChange={(e) => setV({ ...v, expiration_date: e.target.value })} /></Field>
      </div>
    </Dialog>
    <Confirm open={Boolean(rev)} onOpenChange={() => setRev(null)} title="Estornar estoque inicial" text="Gera lançamento inverso no ledger. Continuar?" danger loading={reverse.isPending} onConfirm={() => rev && reverse.mutate(rev)} />
  </CardBody></Card>;
}
