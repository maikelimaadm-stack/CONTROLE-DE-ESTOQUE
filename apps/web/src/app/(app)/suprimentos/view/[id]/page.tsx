"use client";
import * as React from "react";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, dateTimeBR } from "@/lib/utils";
import { Badge, Button, Dialog, Field, Input, Tabs, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { Base2Shell, Base2Section, Base2Fields, Base2Items, type Base2Field, type Base2ItemColumn } from "@/features/base2";
import { SimpleTable, useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { ActionDialog, useAction, type ActionField } from "@/features/docs/actions";
import { COPY, UNKNOWN_VALUE, enumLabel } from "@/lib/copy";
import { useTradutor } from "@/lib/i18n";
import { tipoOperacaoDoRegistro } from "@agro/domain";

/**
 * SOLICITAÇÃO DE COMPRA NO MODELO BASE 2 (BASE2-03A) — primeira entidade de módulo migrada depois do
 * piloto de estoque (docs/MODELO-BASE2-CONTRACT.md).
 *
 * TELA UNIFICADA ≠ REGRA DE NEGÓCIO UNIFICADA. O que muda aqui é a COMPOSIÇÃO: identidade, dados
 * principais e itens passam a ser os componentes oficiais do Base 2. O que NÃO muda é tudo que decide
 * alguma coisa — `allowed_actions` continua vindo do servidor, cada ação continua chamando o SEU
 * endpoint com a SUA permissão e a SUA versão otimista, e a máquina de estados segue inteira em
 * `packages/domain/src/supply-workflow.ts`. A moldura não sabe o que "aprovar" significa, e não deve.
 *
 * POR QUE OS ITENS SAEM DAS ABAS E AS DEMAIS SUPERFÍCIES FICAM. O núcleo de um lançamento é cabeçalho +
 * itens: escondê-lo atrás de uma aba faz o leitor clicar para ver o que o documento É. Já cotação,
 * aprovação, pedido, comentário e linha do tempo são o PROCESSO em volta do lançamento — continuam em
 * abas, com os componentes do próprio módulo. Converter tudo para `Base2Items` transformaria a moldura
 * numa máquina de processo, que é exatamente o que o contrato proíbe.
 *
 * DOIS HISTÓRICOS, E ELES NÃO SE FUNDEM:
 *  - o botão "Histórico" do `Base2Shell` é a AUDITORIA oficial (`erp.audit_logs`, entidade
 *    `purchase_requests`) — quem mudou o quê, no registro;
 *  - a aba "Histórico do processo" é `erp.purchase_request_events` — etapa, situação, justificativa e
 *    tempo gasto. É dado funcional de Compras, não auditoria.
 * A aba foi renomeada de "Histórico" para "Histórico do processo" porque, com o botão oficial na mesma
 * tela, dois controles com o mesmo nome e conteúdos diferentes é ambiguidade garantida.
 *
 * ANEXOS passam a usar o diálogo oficial pelo `Base2Shell`: `purchase_requests` já está em
 * `ATTACHMENT_PARENTS` (`apps/api/src/lib/attachment-parent.ts`), então o servidor aceita este pai e a
 * autorização é a dele. A aba antiga saiu: ela era SOMENTE LEITURA e mandava o usuário "usar a ação
 * Anexos na lista" — uma porta que mostrava e não deixava fazer.
 */

const ACTIONS: Record<string, { label: string; perm: string; danger?: boolean; fields?: ActionField[] }> = {
  submit: { label: "Enviar para ciência", perm: "purchase_requests.edit" }, acknowledge: { label: "Dar ciência", perm: "purchase_quotations.create" }, start_quotation: { label: "Iniciar cotação", perm: "purchase_quotations.create" },
  send_to_approval: { label: "Enviar para autorização", perm: "purchase_quotations.edit", fields: [{ name: "authorizer_id", label: "Autorizador", type: "ref", resource: "authorizers" }] },
  approve: { label: "Aprovar", perm: "purchase_authorization.edit" }, reject: { label: "Reprovar", perm: "purchase_authorization.edit", danger: true }, review: { label: "Analisar processo", perm: "purchase_authorization.edit" },
  mark_purchased: { label: "Compra efetuada", perm: "purchase_buy.edit" }, mark_received: { label: "Compra recebida", perm: "purchase_receipts.edit" }, finish: { label: "Finalizar pedido", perm: "purchase_receipts.edit" },
  back_step: { label: "Voltar etapa", perm: "purchase_requests.edit" }, cancel: { label: "Cancelar pedido", perm: "purchase_requests.delete", danger: true }
};
const EVENT_PT: Record<string, string> = { create: "Criação", comment: "Comentário", transfer: "Transferência", financial: "Financeiro", quotation: "Cotação", quotation_selected: "Cotação selecionada", update: "Alteração", ...Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.label])) };

/** Nome do lançamento na identidade. O código do registro entra ao lado, pelo `Base2Shell`. */
const TITULO = "Solicitação de compra";
/** Nome da tabela, como o backend a grava na auditoria e como `ATTACHMENT_PARENTS` a conhece. */
const ENTIDADE = "purchase_requests";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { can, ctx } = useAuth(); const tr = useTradutor();
  const q = useDoc<Row & { items: Row[]; events: Row[]; quotations: Row[]; approvals: Row[]; children: Row[]; attachments: Row[]; allowed_actions: string[]; can_transfer: boolean }>(`/api/supply/requests/${id}`);
  const [action, setAction] = React.useState<string | null>(null); const [transfer, setTransfer] = React.useState(false); const [quote, setQuote] = React.useState(false); const [fin, setFin] = React.useState(false);
  const act = useAction(() => { setAction(null); setTransfer(false); setQuote(false); setFin(false); });
  const d = q.data;
  const doAction = (a: string, v: Record<string, string>) => act.mutate({ path: `/api/supply/requests/${id}/actions/${a}`, body: { justification: v["justification"] || ACTIONS[a]?.label, version: d?.["version"], authorizer_id: v["authorizer_id"] || null } });
  if (!d) return <LoadingOr q={q}>{null}</LoadingOr>;

  // Autorização segue EXATAMENTE como era: o servidor diz o que é permitido pelo ESTADO
  // (`allowed_actions`) e o cliente apenas esconde o que o usuário não pode ver (`can`). Nenhuma das
  // duas metades migrou para a moldura — `can()` aqui é apresentação, e quem nega é a rota.
  const allowed = (d.allowed_actions ?? []).filter((a) => ACTIONS[a] && can(ACTIONS[a]!.perm));
  const isOwnerOrResponsible = d["current_responsible_user_id"] === ctx?.user.id || d["requester_user_id"] === ctx?.user.id || ctx?.isOwner;

  // TIPO DE OPERAÇÃO (BASE2-02): resolvido AQUI, no módulo dono da tela, e entregue ao shell como texto
  // já traduzido. A autoridade é a entidade declarada no registry (`erp.purchase_requests`), nunca a
  // rota, o título, a permissão ou o status. Registro que não resolve não exibe o campo — a tela cala
  // em vez de afirmar a operação errada.
  const top = tipoOperacaoDoRegistro(`erp.${ENTIDADE}`, d);

  // Dinheiro é do SERVIDOR: `estimated_total` e `approved_total` chegam calculados e a tela apenas
  // formata. Somar item a item aqui seria ponto flutuante sobre dinheiro, que o CLAUDE.md proíbe.
  const campos: Base2Field[] = [
    { label: "Código", valor: String(d["code"] ?? "") },
    { label: tr("termos.tipo_operacao"), valor: top ? tr(top.chaveI18n) : "", ocultarSeVazio: true },
    { label: "Data", valor: dateBR(d["request_date"] as string) },
    { label: "Tipo", valor: enumLabel("request_type", d["request_type"]) },
    { label: "Prioridade", valor: enumLabel("priority", d["priority"]) },
    { label: "Solicitante", valor: String(d["requester_name"] ?? "") },
    // "—" aqui é INFORMAÇÃO do processo: solicitação sem responsável atual é um estado que o usuário
    // precisa enxergar, não um campo que não se aplica. Por isso não leva `ocultarSeVazio`.
    { label: "Responsável atual", valor: String(d["current_responsible_name"] ?? "") },
    { label: "Valor estimado", valor: brl(d["estimated_total"] as string) },
    { label: "Valor aprovado", valor: d["approved_total"] ? brl(d["approved_total"] as string) : "" },
    { label: "Versão", valor: String(d["version"] ?? "") },
    { label: "Classificação", valor: enumLabel("classification", d["classification"] ?? "unclassified") },
    { label: "Vencimento financeiro", valor: d["financial_due_date"] ? dateBR(d["financial_due_date"] as string) : "" },
    { label: "Nota fiscal", valor: String(d["invoice_number"] ?? "") },
    { label: "Documento fiscal lançado", valor: d["invoice_id"] ? "Sim" : "Não" },
    // frases, não palavras: largura própria para não serem truncadas junto com código e data
    { label: "Descrição", valor: String(d["description"] ?? ""), span: 6 },
    { label: "Justificativa", valor: String(d["justification"] ?? ""), span: 6 },
    { label: "Observação", valor: String(d["observation"] ?? ""), span: 12, ocultarSeVazio: true }
  ];

  // Nenhuma coluna é totalizada: o valor estimado do documento é campo do cabeçalho e não é a soma
  // desta coluna (item pode ter `amount` nulo e só `reference_value`). Ver features/base2/items.tsx.
  const colunasItens: Base2ItemColumn<Row>[] = [
    { key: "product_name", label: "Produto", render: (r) => String(r["product_name"] ?? "") },
    { key: "description", label: "Descrição" },
    { key: "quantity", label: "Quantidade", align: "right", render: (r) => num(r["quantity"] as string, 4) },
    { key: "reference_value", label: "Valor de referência", align: "right", render: (r) => (r["reference_value"] ? brl(r["reference_value"] as string) : "") },
    { key: "amount", label: "Valor", align: "right", render: (r) => (r["amount"] ? brl(r["amount"] as string) : "") },
    { key: "observation", label: "Observação" }
  ];

  return <Base2Shell
    titulo={TITULO}
    codigo={d["code"] as React.ReactNode}
    situacao={String(d["status"])}
    situacaoDominio="purchase_status"
    empresa={d["empresa_name"] as React.ReactNode}
    voltarHref="/compras?tab=processos&scope=mine"
    historico={{ entidade: ENTIDADE, id }}
    anexos={{ entidade: ENTIDADE, id }}
    acoes={<>
      {allowed.map((a) => <Button key={a} size="sm" variant={ACTIONS[a]!.danger ? "danger" : a === "back_step" ? "outline" : "default"} onClick={() => setAction(a)}>{ACTIONS[a]!.label}</Button>)}
      {d.can_transfer && <Button size="sm" variant="outline" onClick={() => setTransfer(true)}>Transferir responsável</Button>}
      {can("purchase_requests.financial") && <Button size="sm" variant="outline" onClick={() => setFin(true)}>Financeiro</Button>}
    </>}
  >
    {!isOwnerOrResponsible && <p className="text-xs text-slate-500">Você não é o responsável atual por este processo.</p>}

    <Base2Fields campos={campos} />

    <Base2Section titulo="Itens" contagem={d.items.length}>
      <Base2Items legenda={`Itens da solicitação de compra ${String(d["code"] ?? "")}`} colunas={colunasItens} linhas={d.items} />
    </Base2Section>

    <Tabs tabs={[
      { value: "quotes", label: "Cotações", badge: d.quotations.length, content: <Quotations d={d} id={id} onNew={() => setQuote(true)} act={act} /> },
      { value: "approvals", label: "Aprovações", badge: d.approvals.length, content: <SimpleTable rows={d.approvals} cols={[{ key: "decided_at", label: "Data", render: (r) => dateTimeBR(r["decided_at"] as string) }, { key: "decided_by_name", label: "Autorizador" }, { key: "level", label: "Nível" }, { key: "decision", label: "Decisão", render: (r) => <Badge tone={r["decision"] === "approved" ? "green" : r["decision"] === "rejected" ? "red" : "slate"}>{enumLabel("decision", r["decision"])}</Badge> }, { key: "justification", label: "Justificativa" }]} /> },
      { value: "order", label: "Pedido de compra", content: <Order id={id} enabled={can("purchase_buy.view")} /> },
      { value: "comments", label: "Comentários", content: <Comment id={id} act={act} /> },
      // "do processo" no rótulo: o botão "Histórico" do cabeçalho é a AUDITORIA do registro, esta aba é
      // a linha do tempo do fluxo de compra. Nomes iguais para conteúdos diferentes confundem.
      { value: "events", label: "Histórico do processo", badge: d.events.length, content: <SimpleTable rows={d.events} cols={[{ key: "created_at", label: "Data", render: (r) => dateTimeBR(r["created_at"] as string) }, { key: "user_name", label: "Usuário" }, { key: "action", label: "Ação", render: (r) => EVENT_PT[String(r["action"])] ?? UNKNOWN_VALUE }, { key: "to_status_label", label: COPY.situacao }, { key: "justification", label: "Justificativa / comentário" }, { key: "time_spent_minutes", label: "Tempo etapa", align: "right", render: (r) => r["time_spent_minutes"] != null ? `${Math.round(Number(r["time_spent_minutes"]) / 60)}h` : "" }]} /> }
    ]} />

    <ActionDialog open={Boolean(action)} onOpenChange={() => setAction(null)} title={action ? ACTIONS[action]!.label : ""} danger={action ? ACTIONS[action]!.danger : false} loading={act.isPending} fields={[...(action ? ACTIONS[action]!.fields ?? [] : []), { name: "justification", label: "Justificativa", type: "textarea", required: action === "reject" || action === "cancel" || action === "review" }]} onSubmit={(v) => action && doAction(action, v)} />
    <ActionDialog open={transfer} onOpenChange={setTransfer} title="Transferir responsável" fields={[{ name: "responsible_user_id", label: "Novo responsável", type: "ref", resource: "users", required: true, span: 12 }, { name: "justification", label: "Justificativa", type: "textarea", required: true }]} loading={act.isPending} onSubmit={(v) => act.mutate({ path: `/api/supply/requests/${id}/transfer`, body: v })} />
    <ActionDialog open={fin} onOpenChange={setFin} title="Dados financeiros da solicitação" fields={[{ name: "classification", label: "Classificação", type: "select", options: [{ value: "unclassified", label: "Não classificado" }, { value: "capex", label: "CAPEX (investimento)" }, { value: "opex", label: "OPEX (custeio)" }], default: String(d["classification"] ?? "unclassified") }, { name: "financial_due_date", label: "Vencimento", type: "date", default: String(d["financial_due_date"] ?? "").slice(0, 10) }, { name: "invoice_number", label: "Nota fiscal", default: String(d["invoice_number"] ?? "") }]} loading={act.isPending} submitLabel="Salvar" onSubmit={(v) => act.mutate({ path: `/api/supply/requests/${id}/financial`, method: "PUT", body: { classification: v["classification"] || undefined, financial_due_date: v["financial_due_date"] || null, invoice_number: v["invoice_number"] || null } })} />
    <QuotationDialog open={quote} onOpenChange={setQuote} id={id} items={d.items} act={act} />
  </Base2Shell>;
}

function Quotations({ d, id, onNew, act }: { d: Row & { quotations: Row[]; items: Row[] }; id: string; onNew: () => void; act: ReturnType<typeof useAction> }) {
  const { can } = useAuth(); const open = !["finished", "cancelled", "not_approved", "awaiting_purchase", "purchase_done", "purchase_received"].includes(String(d["status"]));
  return <div className="space-y-2">
    {open && can("purchase_quotations.create") && <Button size="sm" onClick={onNew}>Adicionar cotação</Button>}
    <SimpleTable rows={d.quotations} cols={[{ key: "provider_name", label: "Fornecedor" }, { key: "quotation_date", label: "Data", render: (r) => dateBR(r["quotation_date"] as string) }, { key: "payment_condition", label: "Condição de pagamento" }, { key: "delivery_days", label: "Prazo (dias)", align: "right" }, { key: "freight", label: "Frete", align: "right", render: (r) => brl(r["freight"] as string) }, { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }, { key: "is_selected", label: "Vencedora", render: (r) => r["is_selected"] ? <Badge tone="green">Selecionada</Badge> : open && can("purchase_quotations.edit") ? <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `/api/supply/requests/${id}/quotations/${r["id"]}/select` })}>Selecionar</Button> : "" }, { key: "del", label: "", render: (r) => open && !r["is_selected"] && can("purchase_quotations.delete") ? <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/api/supply/requests/${id}/quotations/${r["id"]}`, method: "DELETE" })}>Excluir</Button> : "" }]} />
    {d.quotations.map((qt) => <details key={String(qt["id"])} className="rounded border p-2 text-xs"><summary className="cursor-pointer">Itens — {String(qt["provider_name"])}</summary><SimpleTable rows={(qt["items"] as Row[] | null) ?? []} cols={[{ key: "request_item_id", label: "Item", render: (r) => String(d.items.find((i) => i["id"] === r["request_item_id"])?.["description"] ?? "") }, { key: "brand", label: "Marca" }, { key: "quantity", label: "Quantidade", align: "right" }, { key: "unit_price", label: "Valor unitário", align: "right", render: (r) => brl(r["unit_price"] as string) }, { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }]} /></details>)}
  </div>;
}
function QuotationDialog({ open, onOpenChange, id, items, act }: { open: boolean; onOpenChange: (o: boolean) => void; id: string; items: Row[]; act: ReturnType<typeof useAction> }) {
  const [h, setH] = React.useState({ provider_id: "", payment_condition: "", delivery_days: "", freight: "0", note: "" });
  const [prices, setPrices] = React.useState<Record<string, { unit_price: string; brand: string }>>({});
  const total = items.reduce((a, i) => a + Number(prices[String(i["id"])]?.unit_price || 0) * Number(i["quantity"]), 0) + Number(h.freight || 0);
  return <Dialog open={open} onOpenChange={onOpenChange} title="Nova cotação" size="lg" footer={<><Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button><Button size="sm" loading={act.isPending} disabled={!h.provider_id} onClick={() => act.mutate({ path: `/api/supply/requests/${id}/quotations`, idem: true, body: { provider_id: h.provider_id, payment_condition: h.payment_condition || null, delivery_days: h.delivery_days ? Number(h.delivery_days) : null, freight: h.freight || "0", note: h.note || null, items: items.map((i) => ({ request_item_id: i["id"], unit_price: prices[String(i["id"])]?.unit_price || "0", brand: prices[String(i["id"])]?.brand || null })) } })}>Salvar cotação</Button></>}>
    <div className="grid grid-cols-12 gap-2">
      <Field label="Fornecedor" required span={6}><RefSelect resource="people" value={h.provider_id} onChange={(v) => setH({ ...h, provider_id: v ?? "" })} filter={{ is_provider: "true" }} /></Field>
      <Field label="Condição de pagamento" span={3}><Input value={h.payment_condition} onChange={(e) => setH({ ...h, payment_condition: e.target.value })} /></Field>
      <Field label="Prazo entrega (dias)" span={3}><Input type="number" value={h.delivery_days} onChange={(e) => setH({ ...h, delivery_days: e.target.value })} /></Field>
      <Field label="Frete" span={3}><Input type="number" step="0.01" value={h.freight} onChange={(e) => setH({ ...h, freight: e.target.value })} /></Field>
      <Field label="Observação" span={9}><Input value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    <table className="table-dense mt-3 w-full text-[12.5px]"><thead><tr><th>Item</th><th className="w-20">Quantidade</th><th className="w-32">Marca</th><th className="w-32">Valor unitário</th><th className="w-28 text-right">Total</th></tr></thead><tbody>
      {items.map((i) => { const k = String(i["id"]); const p = prices[k] ?? { unit_price: "", brand: "" }; return <tr key={k}><td>{String(i["description"])}</td><td>{num(i["quantity"] as string, 2)}</td><td><Input value={p.brand} onChange={(e) => setPrices({ ...prices, [k]: { ...p, brand: e.target.value } })} /></td><td><Input type="number" step="0.01" value={p.unit_price} onChange={(e) => setPrices({ ...prices, [k]: { ...p, unit_price: e.target.value } })} /></td><td className="num">{brl(Number(p.unit_price || 0) * Number(i["quantity"]))}</td></tr>; })}
    </tbody><tfoot><tr><td colSpan={4} className="text-right font-semibold">Total com frete</td><td className="num font-semibold">{brl(total)}</td></tr></tfoot></table>
  </Dialog>;
}
function Order({ id, enabled }: { id: string; enabled: boolean }) {
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api<{ code: string; provider: Row | null; text: string; whatsapp_url: string | null; mailto_url: string | null }>(`/api/supply/requests/${id}/order`), enabled });
  if (!enabled) return <p className="text-xs text-slate-500">Sem permissão para visualizar o pedido de compra.</p>;
  if (!q.data) return null;
  return <div className="space-y-2"><p className="text-xs text-slate-500">{q.data.provider ? `Fornecedor: ${String(q.data.provider["provider_name"])}` : "Nenhuma cotação selecionada — o pedido usa os itens da solicitação."}</p><pre className="whitespace-pre-wrap rounded border bg-slate-50 p-3 text-xs">{q.data.text}</pre><div className="flex gap-2">{q.data.whatsapp_url && <a href={q.data.whatsapp_url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline">Enviar via WhatsApp</Button></a>}{q.data.mailto_url && <a href={q.data.mailto_url}><Button size="sm" variant="outline">Enviar por e-mail</Button></a>}<Button size="sm" variant="outline" onClick={() => window.print()}>Imprimir</Button></div></div>;
}
function Comment({ id, act }: { id: string; act: ReturnType<typeof useAction> }) {
  const [t, setT] = React.useState("");
  return <div className="space-y-2"><Textarea value={t} onChange={(e) => setT(e.target.value)} placeholder="Escreva um comentário para o histórico do processo" /><Button size="sm" disabled={!t} loading={act.isPending} onClick={() => { act.mutate({ path: `/api/supply/requests/${id}/comments`, body: { text: t } }); setT(""); }}>Comentar</Button></div>;
}
