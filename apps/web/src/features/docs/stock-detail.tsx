"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, dateTimeBR, pct } from "@/lib/utils";
import { Button, ConfirmDialog, StatusBadge } from "@/components/ui";
import { Base2Shell, Base2Section, Base2Fields, Base2Items, type Base2Field, type Base2ItemColumn } from "@/features/base2";
import { useDoc, LoadingOr, type Row } from "./shared";
import { COPY, enumLabel } from "@/lib/copy";

/**
 * PILOTO DO MODELO BASE 2 (docs/MODELO-BASE2-CONTRACT.md) — detalhe de documento de estoque.
 *
 * É UM componente que atende sete rotas reais (entradas, documentos fiscais, requisições, baixas,
 * devoluções, transferências e batidas), todas pelos MESMOS endpoints, permissões e efeitos de antes.
 * A fatia troca a composição da tela, não o que a tela faz.
 *
 * O que mudou de fato, e por quê:
 *  - a empresa do registro subiu para a identidade (subtítulo), em vez de ser mais um campo no meio da
 *    lista — quem confere um lançamento confere primeiro DE QUEM ele é;
 *  - os itens ganharam rodapé de total alinhado à coluna, com o total DO SERVIDOR;
 *  - cada bloco virou seção titulada com contagem, em vez de um `<h3>` solto;
 *  - o histórico do registro (auditoria) passou a existir nesta tela: os eventos já eram gravados pelo
 *    backend (`apps/api/src/routes/stock.ts`), mas não havia por onde lê-los aqui.
 *
 * ANEXOS continuam de fora, de propósito: o servidor recusa estas entidades com 422 porque elas não
 * estão em `ATTACHMENT_PARENTS`. Ligar o botão só produziria um controle que aparece e não funciona.
 */
export function StockDocDetail({ id, endpoint, base, title, perm, entidade, dateKey, extraKV, cancelLabel = "Cancelar documento", extraActions }: {
  id: string; endpoint: string; base: string; title: string; perm: string;
  /** Nome da tabela, como o backend a grava na auditoria. Distinto de `perm` por serem conceitos diferentes. */
  entidade: string;
  dateKey: string; extraKV?: (d: Row) => [string, React.ReactNode][]; cancelLabel?: string;
  /** ações contextuais (ex.: "Devolver itens" na requisição) */
  extraActions?: (d: Row & { items: Row[] }) => React.ReactNode;
}) {
  const { can } = useAuth(); const qc = useQueryClient(); const [c, setC] = React.useState(false);
  const q = useDoc<Row & { items: Row[]; movements: Row[]; titles?: Row[]; apportionments?: Row[]; provider?: Row }>(`${endpoint}/${id}`);
  const cancel = useMutation({ mutationFn: () => api(`${endpoint}/${id}/cancel`, { method: "POST", body: {} }), onSuccess: () => { toast.success("Cancelado"); setC(false); void qc.invalidateQueries(); }, onError: (e) => toast.error((e as Error).message) });
  const d = q.data;
  if (!d) return <LoadingOr q={q}>{null}</LoadingOr>;

  // total do documento: o valor que o SERVIDOR calculou. A tela nunca soma item a item (ver contrato § Totais).
  const totalDocumento = (d["total_amount"] ?? d["total"] ?? d["total_value"]) as string | undefined;

  const campos: Base2Field[] = [
    { label: "Código", valor: String(d["code"] ?? "") },
    { label: "Data", valor: dateBR(d[dateKey] as string) },
    { label: "Responsável", valor: String(d["created_by_name"] ?? ""), ocultarSeVazio: true },
    { label: "Documento", valor: d["number"] ? `${d["number"]}/${d["series"] ?? ""}` : "", ocultarSeVazio: true },
    { label: "Fornecedor", valor: d["provider"] ? String((d["provider"] as Row)["name"]) : "", ocultarSeVazio: true },
    { label: "Armazém", valor: String(d["warehouse_name"] ?? ""), ocultarSeVazio: true },
    { label: "Motivo", valor: d["reason"] ? enumLabel("writeoff_reason", d["reason"]) : "", ocultarSeVazio: true },
    { label: "Justificativa", valor: String(d["justification"] ?? ""), span: 6, ocultarSeVazio: true },
    { label: "Observação", valor: String(d["note"] ?? ""), span: 6, ocultarSeVazio: true },
    ...(extraKV?.(d) ?? []).map(([label, valor]): Base2Field => ({ label, valor, ocultarSeVazio: true })),
    { label: "Total", valor: <b>{brl(totalDocumento)}</b> }
  ];

  // Quantidade NÃO é totalizada: um documento mistura unidades (quilo, litro, unidade) e a soma seria um
  // número sem significado. Só o dinheiro, que tem uma unidade só, e vindo do servidor.
  const colunasItens: Base2ItemColumn<Row>[] = [
    { key: "product_code", label: "Código" },
    { key: "product_name", label: "Produto" },
    { key: "warehouse_name", label: "Armazém" },
    { key: "quantity", label: "Quantidade", align: "right", render: (r) => `${num(r["quantity"] as string, 4)} ${r["unit"] ?? ""}` },
    { key: "unit_value", label: "Valor unitário", align: "right", render: (r) => brl((r["unit_value"] ?? r["unit_cost"]) as string) },
    { key: "total_value", label: "Total", align: "right", render: (r) => brl((r["total_value"] ?? r["total"] ?? r["total_cost"]) as string), total: () => brl(totalDocumento) },
    { key: "provider_lot", label: "Lote" },
    { key: "cost_center_name", label: "Centro de custo" },
    { key: "generate_stock", label: "Gera estoque", render: (r) => (r["generate_stock"] === false ? "Não" : "Sim") }
  ];

  return <Base2Shell
    titulo={title}
    codigo={d["code"] as React.ReactNode}
    situacao={String(d["status"])}
    situacaoDominio="status"
    empresa={d["empresa_name"] as React.ReactNode}
    voltarHref={base}
    historico={{ entidade, id }}
    acoes={<>
      {extraActions?.(d)}
      {d["status"] !== "cancelled" && can(`${perm}.delete`) && <Button size="sm" variant="danger" onClick={() => setC(true)}>{cancelLabel}</Button>}
    </>}
  >
    <Base2Fields campos={campos} />

    <Base2Section titulo="Itens" contagem={d.items.length}>
      <Base2Items legenda={`Itens do documento ${String(d["code"] ?? "")}`} colunas={colunasItens} linhas={d.items} />
    </Base2Section>

    {d.apportionments && d.apportionments.length > 0 && <Base2Section titulo="Rateio financeiro" contagem={d.apportionments.length}>
      <Base2Items colunas={[
        { key: "category_name", label: "Categoria" },
        { key: "cost_center_name", label: "Centro de custo" },
        { key: "percentage", label: "Percentual", align: "right", render: (r) => pct(r["percentage"] as string, 2) },
        { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) }
      ]} linhas={d.apportionments} />
    </Base2Section>}

    {d.titles && d.titles.length > 0 && <Base2Section titulo="Títulos financeiros gerados" contagem={d.titles.length}>
      <Base2Items colunas={[
        { key: "code", label: "Código" },
        { key: "number", label: "Número do título" },
        { key: "direction", label: "Natureza", render: (r) => (r["direction"] === "payable" ? "A pagar" : "A receber") },
        { key: "due_date", label: "Vencimento", render: (r) => dateBR(r["due_date"] as string) },
        { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) },
        { key: "balance", label: "Saldo", align: "right", render: (r) => brl(r["balance"] as string) },
        { key: "status", label: COPY.situacao, render: (r) => <StatusBadge domain="status" value={r["status"]} /> }
      ]} linhas={d.titles} />
    </Base2Section>}

    <Base2Section titulo="Movimentações de estoque (ledger)" contagem={d.movements.length}
      descricao="Lançamentos gerados por este documento. O ledger é imutável: correção é cancelamento com estorno.">
      <Base2Items colunas={[
        { key: "movement_date", label: "Data", render: (r) => dateBR(r["movement_date"] as string) },
        { key: "movement_type", label: "Tipo", render: (r) => enumLabel("stock_movement_type", r["movement_type"]) },
        { key: "direction", label: "Entrada ou saída", render: (r) => (r["direction"] === 1 ? "Entrada" : "Saída") },
        { key: "quantity", label: "Quantidade", align: "right", render: (r) => num(r["quantity"] as string, 4) },
        { key: "unit_cost", label: "Custo unitário", align: "right", render: (r) => brl(r["unit_cost"] as string) },
        { key: "total_cost", label: "Total", align: "right", render: (r) => brl(r["total_cost"] as string) },
        { key: "balance_after", label: "Saldo após", align: "right", render: (r) => num(r["balance_after"] as string, 4) }
      ]} linhas={d.movements} />
    </Base2Section>

    <p className="text-[11px] text-slate-400">Criado em {dateTimeBR(d["created_at"] as string)}</p>
    <ConfirmDialog open={c} onOpenChange={setC} title={cancelLabel} text="Estorna todos os lançamentos vinculados. Continuar?" danger loading={cancel.isPending} onConfirm={() => cancel.mutate()} />
  </Base2Shell>;
}
