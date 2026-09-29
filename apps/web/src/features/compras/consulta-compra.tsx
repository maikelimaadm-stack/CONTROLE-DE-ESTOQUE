"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useTradutor } from "@/lib/i18n";
import { brl, dateBR, num } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { Button, Card, CardBody, CardHeader, Dialog, LoadingState, StatusBadge } from "@/components/ui";
import { DetailShell, KV, LoadingOr, SimpleTable, useDoc, type Row } from "@/features/docs/shared";
import { usePreviaDaConfirmacaoCompra, type PreviaDaConfirmacaoCompra } from "./previa-confirmacao-compra";
import type { VarianteDeCompra } from "./variantes";

/**
 * A CONSULTA DO DOCUMENTO DE COMPRA — só leitura, com Confirmar (compra, depois da prévia) e Cancelar (COMPRAS-01).
 *
 * A Consulta de Vendas (`vendas/[kind]/[id]`) é presa à venda (conversão, faturar em partes, reserva, layout de
 * impressão); esta é PRÓPRIA, no formato `DetailShell` dos documentos de estoque. Os botões aparecem por
 * capacidade (`can()` só esconde): Confirmar pede `compras.edit`, Cancelar pede `<recurso>.delete`. Quem recusa é
 * o servidor — inclusive quando o botão estava à vista.
 */
const t = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export function ConsultaDeCompra({ variante, id }: { variante: VarianteDeCompra; id: string }) {
  const { can } = useAuth(); const tr = useTradutor(); const qc = useQueryClient();
  const porta = `/api/compras/${variante.segmento}/${id}`;
  const q = useDoc<Row & { itens?: Row[]; titulos?: Row[]; movimentos?: Row[] }>(porta);
  const [confirmando, setConfirmando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const chaveConfirmar = React.useRef(newIdem());
  const chaveCancelar = React.useRef(newIdem());
  const recarregar = () => { void qc.invalidateQueries({ queryKey: ["docone", porta] }); void qc.invalidateQueries({ queryKey: ["compras-previa-confirmacao", id] }); };

  const confirmar = useMutation({
    mutationFn: () => api(`/api/compras/compras/${id}/confirm`, { method: "POST", idempotencyKey: chaveConfirmar.current }),
    onSuccess: () => { toast.success("Compra confirmada"); setConfirmando(false); recarregar(); },
    onError: (e) => { chaveConfirmar.current = newIdem(); toast.error((e as Error).message); recarregar(); }
  });
  const cancelar = useMutation({
    mutationFn: () => api(`/api/compras/${variante.segmento}/${id}/cancel`, { method: "POST", idempotencyKey: chaveCancelar.current }),
    onSuccess: () => { toast.success("Documento cancelado"); setCancelando(false); recarregar(); },
    onError: (e) => { chaveCancelar.current = newIdem(); toast.error((e as Error).message); }
  });

  const d = q.data;
  const situacao = d ? String(d["situacao"] ?? "") : "";
  const ehCompra = variante.variante === "compra";
  const podeConfirmar = ehCompra && situacao === "aberto" && can("compras.edit");
  const podeCancelar = (situacao === "aberto" || situacao === "confirmado") && can(`${variante.perm}.delete`);
  const top = d?.["tipo_operacao"] as { codigo?: string; nome?: string; versao?: number } | null | undefined;
  const titulo = d ? `${tr(variante.chaveI18n)} ${t(d["codigo"])}` : tr(variante.chaveI18n);

  return <LoadingOr q={q}>{d && <DetailShell testId="compras-consulta" title={titulo} backHref="/compras?tab=documentos"
    status={<StatusBadge domain="situacao_documento_compra" value={situacao} />}
    actions={<>
      {podeConfirmar && <Button size="sm" data-testid="compras-confirmar" onClick={() => setConfirmando(true)}>Confirmar</Button>}
      {podeCancelar && <Button size="sm" variant="outline" data-testid="compras-cancelar" onClick={() => setCancelando(true)}>Cancelar documento</Button>}
    </>}>
    <div className="space-y-4" data-testid="compras-consulta-corpo" data-situacao={situacao} data-especie={variante.variante}>
      <Card><CardBody>
        <KV items={[
          ["Código", <span key="c" data-testid="compras-consulta-codigo">{t(d["codigo"])}</span>],
          ["Tipo de documento", enumLabel("especie_documento_compra", d["especie"])],
          ["Tipo de Operação", top ? `${t(top.codigo)} — ${t(top.nome)}${top.versao ? ` (versão ${top.versao})` : ""}` : "—"],
          ["Empresa", t(d["empresa_nome"])],
          ["Fornecedor", t(d["fornecedor_nome"])],
          ["Transportadora", t(d["transportadora_nome"])],
          ["Data do documento", dateBR(d["data_documento"] as string)],
          ...(ehCompra ? [["Data de entrada", d["data_entrada"] ? dateBR(d["data_entrada"] as string) : "—"] as [string, React.ReactNode]] : []),
          ["Vencimento", d["data_vencimento"] ? dateBR(d["data_vencimento"] as string) : "—"],
          ...(ehCompra ? [["Nota / série", d["numero_nota"] ? `${t(d["numero_nota"])} / ${t(d["serie_nota"] || "1")}` : "—"] as [string, React.ReactNode]] : []),
          ["Itens", brl(d["valor_itens"] as string)],
          ["Frete", brl(d["frete"] as string)],
          ["Outras despesas", brl(d["outras_despesas"] as string)],
          ["Desconto", brl(d["desconto"] as string)],
          ["Total", <span key="t" data-testid="compras-consulta-total">{brl(d["valor_total"] as string)}</span>],
          ["Observação", t(d["observacao"])]
        ]} />
      </CardBody></Card>
      <Card data-testid="compras-consulta-itens"><CardHeader title="Itens" /><CardBody>
        <SimpleTable rows={d.itens ?? []} cols={[
          { key: "produto_nome", label: "Produto", render: (r) => [r["produto_codigo"], r["produto_nome"]].filter(Boolean).join(" — ") || "—" },
          { key: "armazem_nome", label: "Armazém", render: (r) => t(r["armazem_nome"]) },
          ...(ehCompra ? [{ key: "lote", label: "Lote", render: (r: Row) => t(r["lote"]) }, { key: "validade", label: "Validade", render: (r: Row) => (r["validade"] ? dateBR(r["validade"] as string) : "—") }] : []),
          { key: "quantidade", label: "Quantidade", align: "right", render: (r) => `${num(r["quantidade"] as string, 4)}${r["unidade"] ? ` ${String(r["unidade"])}` : ""}` },
          { key: "valor_unitario", label: "Valor unitário", align: "right", render: (r) => brl(r["valor_unitario"] as string) },
          { key: "desconto", label: "Desconto", align: "right", render: (r) => brl(r["desconto"] as string) },
          { key: "valor_total", label: "Total", align: "right", render: (r) => brl(r["valor_total"] as string) }
        ]} />
      </CardBody></Card>
      {ehCompra && <Card data-testid="compras-consulta-movimentos"><CardHeader title="Entradas no estoque" /><CardBody>
        {(d.movimentos ?? []).length ? <SimpleTable rows={d.movimentos ?? []} cols={[
          { key: "movement_date", label: "Data", render: (r) => (r["movement_date"] ? dateBR(r["movement_date"] as string) : "—") },
          { key: "product_name", label: "Produto", render: (r) => t(r["product_name"] ?? r["produto_nome"] ?? r["product_id"]) },
          { key: "warehouse_name", label: "Armazém", render: (r) => t(r["warehouse_name"] ?? r["armazem_nome"]) },
          { key: "movement_type", label: "Movimento", render: (r) => enumLabel("stock_movement_type", r["movement_type"]) },
          { key: "quantity", label: "Quantidade", align: "right", render: (r) => num(r["quantity"] as string, 4) },
          { key: "unit_cost", label: "Custo unitário", align: "right", render: (r) => brl(r["unit_cost"] as string) },
          { key: "total_cost", label: "Custo total", align: "right", render: (r) => brl(r["total_cost"] as string) }
        ]} /> : <p className="text-[12.5px] text-slate-500">Nenhuma entrada no estoque gerada.</p>}
      </CardBody></Card>}
      {ehCompra && <Card data-testid="compras-consulta-titulos"><CardHeader title="Contas a pagar" /><CardBody>
        {(d.titulos ?? []).length ? <SimpleTable rows={d.titulos ?? []} cols={[
          { key: "number", label: "Número", render: (r) => t(r["number"] ?? r["code"]) },
          { key: "due_date", label: "Vencimento", render: (r) => (r["due_date"] ? dateBR(r["due_date"] as string) : "—") },
          { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) },
          { key: "status", label: "Situação", render: (r) => <StatusBadge domain="title_status" value={r["status"]} /> }
        ]} /> : <p className="text-[12.5px] text-slate-500">Nenhuma conta a pagar gerada.</p>}
      </CardBody></Card>}
    </div>

    {ehCompra && <DialogoConfirmar id={id} aberto={confirmando} onAberto={setConfirmando} ocupado={confirmar.isPending} onConfirmar={() => confirmar.mutate()} />}
    <Dialog open={cancelando} onOpenChange={setCancelando} size="sm" testId="compras-cancelar-dialogo" title="Cancelar documento"
      description={situacao === "confirmado"
        ? "A compra confirmada é estornada: a entrada sai do estoque e as contas a pagar são canceladas. Conta com baixa precisa ter a baixa cancelada antes."
        : "O documento passa a cancelado e não pode mais ser confirmado."}
      footer={<>
        <Button variant="outline" onClick={() => setCancelando(false)}>Voltar</Button>
        <Button variant="danger" data-testid="compras-cancelar-confirmar" loading={cancelar.isPending} disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar documento</Button>
      </>}>
      <span />
    </Dialog>
  </DetailShell>}</LoadingOr>;
}

function DialogoConfirmar({ id, aberto, onAberto, ocupado, onConfirmar }: { id: string; aberto: boolean; onAberto: (v: boolean) => void; ocupado: boolean; onConfirmar: () => void }) {
  const estado = usePreviaDaConfirmacaoCompra(id, aberto);
  const bloqueado = estado.situacao === "carregando" || (estado.situacao === "pronta" && !estado.previa.podeConfirmar);
  return <Dialog open={aberto} onOpenChange={onAberto} size="lg" testId="compras-confirmar-dialogo" title="Confirmar compra"
    description="O que a confirmação vai fazer agora, segundo o servidor."
    footer={<>
      <Button variant="outline" onClick={() => onAberto(false)}>Voltar</Button>
      <Button data-testid="compras-confirmar-executar" loading={ocupado} disabled={bloqueado || ocupado} onClick={onConfirmar}>Confirmar</Button>
    </>}>
    <div data-testid="compras-previa" data-situacao={estado.situacao}>
      {estado.situacao === "carregando" && <LoadingState label="Calculando a prévia…" />}
      {estado.situacao === "indisponivel" && <p className="text-[12.5px] text-amber-700" data-testid="compras-previa-indisponivel">A prévia não está disponível neste servidor. A confirmação continua conferida pelo servidor.</p>}
      {estado.situacao === "erro" && <p className="text-[12.5px] text-red-700" data-testid="compras-previa-erro">{estado.mensagem}</p>}
      {estado.situacao === "pronta" && <CorpoDaPrevia previa={estado.previa} />}
    </div>
  </Dialog>;
}

function CorpoDaPrevia({ previa }: { previa: PreviaDaConfirmacaoCompra }) {
  const { estoque, financeiro } = previa;
  return <div className="space-y-3 text-[12.5px]">
    {previa.recusas.length > 0 && <ul data-testid="compras-previa-recusas" className="space-y-0.5 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
      {previa.recusas.map((r, i) => <li key={i}>{r.message}</li>)}
    </ul>}
    <section data-testid="compras-previa-estoque" data-efeito={estoque.efeito ?? ""}>
      <h3 className="mb-1 font-semibold">Estoque</h3>
      {estoque.efeito === "entrada"
        ? <>
          <p className="mb-1 text-slate-600">Entrada no estoque{estoque.dataEntrada ? ` em ${dateBR(estoque.dataEntrada)}` : ""}, com o custo de cada item (frete, outras despesas e desconto rateados).</p>
          <SimpleTable rows={estoque.itens as unknown as Row[]} cols={[
            { key: "produto", label: "Produto" },
            { key: "armazem", label: "Armazém", render: (r) => t(r["armazem"]) },
            { key: "lote", label: "Lote", render: (r) => t(r["lote"]) },
            { key: "quantidade", label: "Quantidade", align: "right", render: (r) => num(r["quantidade"] as string, 4) },
            { key: "valorEntrada", label: "Valor de entrada", align: "right", render: (r) => brl(r["valorEntrada"] as string) },
            { key: "custoUnitario", label: "Custo unitário", align: "right", render: (r) => brl(r["custoUnitario"] as string) }
          ]} />
        </>
        : <p className="text-slate-600">{estoque.efeito === "nenhum" ? "Não movimenta o estoque." : "O efeito no estoque não pôde ser previsto."}</p>}
    </section>
    <section data-testid="compras-previa-financeiro" data-efeito={financeiro.efeito ?? ""}>
      <h3 className="mb-1 font-semibold">Financeiro</h3>
      {financeiro.efeito === "pagar"
        ? <>
          <p className="mb-1 text-slate-600">Gera contas a pagar de {brl(financeiro.valor ?? "0")}{financeiro.numero ? `, número ${financeiro.numero}` : ""}.</p>
          <SimpleTable rows={financeiro.parcelas as unknown as Row[]} cols={[
            { key: "numero", label: "Parcela", render: (r) => (r["entrada"] ? "Entrada" : String(r["numero"])) },
            { key: "vencimento", label: "Vencimento", render: (r) => dateBR(r["vencimento"] as string) },
            { key: "valor", label: "Valor", align: "right", render: (r) => brl(r["valor"] as string) }
          ]} />
        </>
        : <p className="text-slate-600">{financeiro.efeito === "nenhum" ? "Não gera contas a pagar." : "O efeito financeiro não pôde ser previsto."}</p>}
    </section>
  </div>;
}
