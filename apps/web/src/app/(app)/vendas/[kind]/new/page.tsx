"use client";
import * as React from "react";
import { Suspense, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { useDirtyTab } from "@/lib/workspace-tabs";
import { Button, Card, CardHeader, CardBody, Confirm, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, PlanEditor, defaultPlan, useCreate, useEmpresaPadrao, type ItemRow, type Plan } from "@/features/docs/shared";
import { useTopsDaVariante, type TopOperacional } from "@/features/sales/tipo-operacao-select";
import { LancadorDeTipoOperacao, pedidoImpossivel, topSelecionada } from "@/features/sales/lancador-tipo-operacao";

const T: Record<string, string> = { budgets: "Novo Orçamento", orders: "Novo Pedido de Venda", sales: "Nova Venda" };

/**
 * NOVO LANÇAMENTO DE VENDAS — TOP PRIMEIRO, FORMULÁRIO DEPOIS (TOP-CONFIG-02B).
 *
 * A rota é a MESMA de antes (`/vendas/<variante>/new`), de propósito: favoritos, links do Portal e
 * permissões continuam valendo. O que mudou é o que ela mostra quando ainda não há operação escolhida.
 *
 *   sem `?tipo_operacao_id`        → LANÇADOR. O formulário não existe na árvore.
 *   com UUID que a lista confirma  → FORMULÁRIO, já contextualizado pela operação.
 *   com UUID que a lista recusa    → LANÇADOR + "não está disponível". Nenhum POST sai daqui.
 *
 * O formulário mora num componente SEPARADO e só é montado no segundo caso. Isso não é organização de
 * código: é a garantia. Enquanto não houver TOP válida não existe estado de formulário, não existe
 * botão Salvar e não existe caminho para `create.mutate` — em vez de existirem desabilitados, que é o
 * tipo de proteção que um `disabled` removido por engano desfaz sem ninguém notar.
 */
function Inner({ kind }: { kind: string }) {
  const router = useRouter();
  const pedido = useSearchParams().get("tipo_operacao_id");
  const estadoTop = useTopsDaVariante(kind);
  const top = topSelecionada(estadoTop, pedido);

  /**
   * A TRAVA DA SESSÃO DE EDIÇÃO — validar uma vez na ENTRADA, não a cada renderização.
   *
   * ┌─ O DEFEITO QUE ELA FECHA ──────────────────────────────────────────────────────────────────────┐
   * │ `top` é DERIVADO da lista que a query devolve. Se a lista for buscada de novo enquanto o        │
   * │ usuário digita, e a TOP escolhida tiver saído dela no meio do caminho, `top` vira `null`,       │
   * │ `Formulario` sai da árvore e TUDO o que foi digitado — cliente, datas, itens, observação,       │
   * │ parcelamento — desaparece sem aviso e sem confirmação. O usuário não fez nada; a tela se        │
   * │ esvaziou sozinha.                                                                               │
   * │                                                                                                 │
   * │ E isso não é hipotético: `components/layout/shell.tsx` chama `qc.invalidateQueries()` SEM chave │
   * │ ao trocar a empresa selecionada, o que refaz TODA query ativa — esta inclusive. Desligar        │
   * │ `refetchOnReconnect` não cobriria esse caminho, porque invalidação explícita não é refetch      │
   * │ automático. Por isso a correção mora aqui, e não nas opções da query.                           │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * A trava guarda a TOP que JÁ passou pela validação, junto do pedido que a produziu. Ela só é
   * ESCRITA a partir de uma validação real — nunca a partir do texto da URL —, então não abre porta
   * nenhuma: um deep link adulterado não valida, não trava, e cai no lançador como antes.
   *
   * O que ela muda é só o INSTANTE da pergunta: "esta TOP vale?" é respondida na ENTRADA do formulário,
   * e não continuamente enquanto se digita. A entrada continua fechada; o que deixa de existir é a
   * porta que se fechava com o usuário dentro.
   *
   * Trocar de pedido (Alterar operação) ou sair dele zera a trava — é outra sessão de edição, e ela
   * pergunta de novo. Um F5 também: a trava é memória de componente montado, não armazenamento; a
   * montagem refaz a descoberta e volta ao lançador se a TOP não valer mais. E o servidor continua
   * sendo a autoridade final — salvar com uma TOP que foi desativada recebe 422, não um sucesso.
   *
   * Escrita durante a renderização de propósito: um `useEffect` só correria DEPOIS, e no quadro entre
   * os dois o formulário já teria sido desmontado — que é exatamente o que se quer evitar. A escrita é
   * idempotente (mesmo pedido + mesma TOP ⇒ mesmo valor), então renderizar duas vezes não muda nada.
   */
  const trava = React.useRef<{ pedido: string; top: TopOperacional } | null>(null);
  if (!pedido || trava.current?.pedido !== pedido) trava.current = null;
  if (pedido && top) trava.current = { pedido, top };
  const topEfetiva = top ?? (pedido && trava.current?.pedido === pedido ? trava.current.top : null);

  if (topEfetiva) return <Formulario kind={kind} top={topEfetiva} familia={estadoTop.situacao === "pronto" ? estadoTop.dados.family.label : ""} />;

  return <LancadorDeTipoOperacao
    estado={estadoTop}
    titulo={T[kind] ?? "Novo"}
    indisponivel={pedidoImpossivel(estadoTop, pedido)}
    onCancelar={() => router.push("/vendas")}
    /**
     * A escolha vai para a URL — e com `replace`, não `push`: o lançador e o formulário são duas caras
     * da MESMA etapa de criação, não dois lugares. Com `push`, o Voltar do navegador devolveria o
     * usuário ao lançador que ele acabou de usar, e "Voltar" depois de digitar meia venda tem de sair
     * da criação, não reabrir a pergunta. Quem quer trocar a operação usa "Alterar operação".
     */
    onContinuar={(t) => router.replace(`/vendas/${kind}/new?tipo_operacao_id=${encodeURIComponent(t.id)}`)}
  />;
}

function Formulario({ kind, top, familia }: { kind: string; top: TopOperacional; familia: string }) {
  const router = useRouter(); const empresa = useEmpresaPadrao();
  const [h, setH] = React.useState({ empresa_id: "", document_date: todayISO(), shipping_date: "", due_date: "", client_id: "", transporter_id: "", proprietary_id: "", driver_name: "", payment_method_id: "", freight: "0", freight_icms: "0", other_values: "0", discount: "0", note: "", is_deductible: false, installments: false });
  const [items, setItems] = React.useState<ItemRow[]>([]); const [plan, setPlan] = React.useState<Plan>(defaultPlan());
  const [confirmarTroca, setConfirmarTroca] = React.useState(false);
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresa })); }, [empresa]);

  /**
   * O QUE CONTA COMO "TEM COISA DIGITADA".
   *
   * A comparação é com o estado INICIAL, capturado no primeiro render — não com uma lista de campos
   * escrita à mão, que envelheceria calada no dia em que o formulário ganhasse um campo novo.
   *
   * `empresa_id` fica FORA da comparação porque não é digitação: ele é preenchido por efeito, com a
   * empresa padrão do usuário, milissegundos depois da montagem. Incluí-lo faria todo formulário
   * nascer "sujo" e transformaria o aviso de perda de dados em ruído que se aprende a ignorar — que é
   * como um aviso deixa de proteger.
   */
  const inicial = React.useRef(h);
  const semEmpresa = ({ empresa_id: _, ...resto }: typeof h) => resto;
  const sujo = items.length > 0 || JSON.stringify(semEmpresa(h)) !== JSON.stringify(semEmpresa(inicial.current));
  useDirtyTab(sujo);

  const create = useCreate<{ id: string }>(`/api/sales/${kind}`, (r) => router.push(`/vendas/${kind}/${r.id}`));
  /** O UUID que vai no corpo é o da TOP VALIDADA contra a lista — nunca o texto cru da URL. */
  const submit = () => create.mutate({ empresa_id: h.empresa_id, document_date: h.document_date, shipping_date: h.shipping_date || null, due_date: h.due_date || null, client_id: h.client_id, transporter_id: h.transporter_id || null, proprietary_id: h.proprietary_id || null, driver_name: h.driver_name || null, payment_method_id: h.payment_method_id || null, freight: h.freight || "0", freight_icms: h.freight_icms || "0", other_values: h.other_values || "0", discount: h.discount || "0", note: h.note || null, is_deductible: h.is_deductible, installment_plan: h.installments ? plan : null, items: items.map((i) => ({ product_id: i.product_id, warehouse_id: i.warehouse_id || null, quantity: i.quantity, unit_price: i.unit_value ?? "0", discount: i.discount || "0", discount_percent: i.discount_percent || "0", note: null })), tipo_operacao_id: top.id });

  const voltarAoLancador = () => router.replace(`/vendas/${kind}/new`);
  const alterarOperacao = () => { if (sujo) setConfirmarTroca(true); else voltarAoLancador(); };

  return <Card><CardHeader title={T[kind] ?? "Novo"} subtitle={kind === "sales" ? "A confirmação da venda baixa o estoque dos itens com armazém e gera as contas a receber." : "Documento comercial sem efeito em estoque/financeiro até ser convertido em venda confirmada."} actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!h.client_id || !items.length || items.some((i) => !i.product_id)} onClick={submit}>Salvar</Button></>} /><CardBody className="space-y-4">
    {/*
      O CONTEXTO OPERACIONAL, no topo e fora do grid de campos.
      A VERSÃO não aparece aqui de propósito: o que esta tela conhece é a versão CORRENTE no momento da
      escolha, e quem congela a versão do documento é o servidor, no POST. Exibi-la antes de salvar
      prometeria um snapshot que ainda não existe e que pode mudar entre a escolha e a gravação — a
      versão congelada é mostrada na tela de DETALHE, onde ela já é fato.
    */}
    <div data-testid="top-contexto" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
      <div className="min-w-0">
        <span className="block text-xs font-semibold uppercase tracking-wide text-brand-700">Operação</span>
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-slate-900">{top.code}</span>
          <span className="text-sm text-slate-800">{top.name}</span>
        </span>
        {familia && <span className="mt-0.5 block text-xs text-slate-500">Família: {familia}</span>}
      </div>
      <Button data-testid="top-alterar" variant="outline" size="sm" onClick={alterarOperacao}>Alterar operação</Button>
    </div>

    <div className="grid grid-cols-12 gap-3">
      <Field label="Empresa" required span={3}><RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => setH({ ...h, empresa_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.document_date} onChange={(e) => setH({ ...h, document_date: e.target.value })} /></Field>
      <Field label="Data de saída" span={2}><Input type="date" value={h.shipping_date} onChange={(e) => setH({ ...h, shipping_date: e.target.value })} /></Field>
      <Field label="Vencimento" span={2}><Input type="date" value={h.due_date} onChange={(e) => setH({ ...h, due_date: e.target.value })} /></Field>
      <Field label="Forma de pagamento" span={3}><RefSelect resource="payment_methods" value={h.payment_method_id} onChange={(v) => setH({ ...h, payment_method_id: v ?? "" })} /></Field>
      <Field label="Cliente" required span={5}><RefSelect resource="people" value={h.client_id} onChange={(v) => setH({ ...h, client_id: v ?? "" })} filter={{ is_client: "true" }} /></Field>
      <Field label="Transportadora" span={4}><RefSelect resource="people" value={h.transporter_id} onChange={(v) => setH({ ...h, transporter_id: v ?? "" })} filter={{ is_transporter: "true" }} /></Field>
      <Field label="Motorista" span={3}><Input value={h.driver_name} onChange={(e) => setH({ ...h, driver_name: e.target.value })} /></Field>
      <Field label="Proprietário" span={3}><RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field>
      <Field label="Frete" span={2}><Input type="number" step="0.01" value={h.freight} onChange={(e) => setH({ ...h, freight: e.target.value })} /></Field>
      <Field label="ICMS frete" span={2}><Input type="number" step="0.01" value={h.freight_icms} onChange={(e) => setH({ ...h, freight_icms: e.target.value })} /></Field>
      <Field label="Outros valores" span={2}><Input type="number" step="0.01" value={h.other_values} onChange={(e) => setH({ ...h, other_values: e.target.value })} /></Field>
      <Field label="Desconto" span={2}><Input type="number" step="0.01" value={h.discount} onChange={(e) => setH({ ...h, discount: e.target.value })} /></Field>
      <Field label="Dedutível" span={1}><NativeSelect value={h.is_deductible ? "1" : "0"} onChange={(e) => setH({ ...h, is_deductible: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
      <Field label="Observação" span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    <h3 className="text-xs font-semibold uppercase text-brand-700">Itens</h3>
    <ItemsEditor items={items} onChange={setItems} fields={["warehouse", "product", "stock", "quantity", "unit_value", "discount", "discount_percent"]} />
    <div className="grid grid-cols-12 gap-3"><Field label="Parcelamento" span={3}><NativeSelect value={h.installments ? "1" : "0"} onChange={(e) => setH({ ...h, installments: e.target.value === "1" })}><option value="0">À vista</option><option value="1">Parcelado</option></NativeSelect></Field></div>
    {h.installments && <PlanEditor plan={plan} onChange={setPlan} />}

    {/* Trocar a operação descarta o que foi digitado — então pergunta antes, em vez de descobrir depois. */}
    <Confirm open={confirmarTroca} onOpenChange={setConfirmarTroca} title="Alterar o Tipo de Operação?"
      text="Os dados já preenchidos neste lançamento serão descartados." danger
      onConfirm={() => { setConfirmarTroca(false); voltarAoLancador(); }} />
  </CardBody></Card>;
}

export default function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params);
  return <Suspense><Inner kind={kind} /></Suspense>;
}
