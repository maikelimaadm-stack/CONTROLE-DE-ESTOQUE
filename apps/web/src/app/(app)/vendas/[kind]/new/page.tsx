"use client";
import * as React from "react";
import { Suspense, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { useDirtyTab, useTabTitle } from "@/lib/workspace-tabs";
import { Confirm, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { PlanEditor, defaultPlan, useCreate, useEmpresaPadrao, type ItemRow, type Plan } from "@/features/docs/shared";
import { MensagemTop, entendeClassificacaoFinanceira, podeLancar, useTopsDaVariante, type EstadoTop, type TopOperacional } from "@/features/sales/tipo-operacao-select";
import { LancadorDeTipoOperacao, pedidoImpossivel, topSelecionada } from "@/features/sales/lancador-tipo-operacao";
import { ChevronRight, Repeat2, Save, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { AcaoDaBarra, CentralVendasWorkspace, DivisorDaBarra } from "@/features/sales/central-vendas-workspace";
import { ItensDaCentral, Travado } from "@/features/sales/central-vendas-itens";
import { DocumentosAbertos } from "@/features/sales/central-vendas-documentos";
import estilosCv from "@/features/sales/central-vendas-workspace.module.css";

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
  /**
   * O RÓTULO DA ABA DE TRABALHO SAI DAQUI, e não mais do registro de navegação.
   *
   * Até esta correção a barra de abas lia o rótulo da AÇÃO "Novo orçamento" do `nav.registry.mjs`. Essas
   * ações saíram do registro — elas ensinavam a escolher a variante antes da operação —, e sem um título
   * próprio a aba passaria a se chamar "Novo · Vendas" para as três portas. O título pertence à TELA, que
   * é quem sabe qual variante está sendo criada; o registro voltou a tratar só de navegação.
   */
  useTabTitle(T[kind] ?? "Novo lançamento");
  const topAtual = topSelecionada(estadoTop, pedido);

  /**
   * A TRAVA DA SESSÃO DE EDIÇÃO — preserva o RASCUNHO, nunca a AUTORIZAÇÃO DE ESCRITA.
   *
   * ┌─ AS DUAS PERGUNTAS, QUE NÃO SÃO A MESMA ───────────────────────────────────────────────────────┐
   * │ 1. O FORMULÁRIO DEVE CONTINUAR MONTADO?  → sim, se a sessão já entrou com uma TOP validada.     │
   * │ 2. A ESCRITA ESTÁ AUTORIZADA AGORA?      → só se a descoberta ATUAL confirmar a TOP escolhida.  │
   * │                                                                                                 │
   * │ A primeira versão desta trava respondia as duas com o mesmo valor, e foi um erro: ela mantinha  │
   * │ o `Salvar` habilitado mesmo depois de a capability cair para `nao-confirmado`. Isso reabria      │
   * │ exatamente o buraco que a TOP-CONFIG-02 fechou — num rolling deploy, o formulário abre contra a  │
   * │ API nova e o refetch seguinte pode cair na API ANTIGA, que é justamente a que IGNORA             │
   * │ `tipo_operacao_id` EM SILÊNCIO. "O servidor devolve 422" não vale como garantia quando o         │
   * │ servidor que vai responder talvez não conheça o campo.                                          │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * Então a trava vale para estado de tela, e SÓ. Quem autoriza o POST é `escritaTopConfirmada`,
   * derivado do estado ATUAL da descoberta — fail-closed, como antes desta fatia existir.
   *
   * A CHAVE É `kind:pedido`, não o pedido sozinho. Uma TOP de `vendas.venda` não pode valer para
   * `orders` só porque o UUID veio junto: se o router preservar a instância ao trocar o segmento
   * dinâmico, a chave muda e a trava é ignorada. Não se apoia em detalhe de ciclo de vida do Next —
   * segurança que depende de "o componente vai remontar, certo?" é segurança que alguém remove sem ver.
   *
   * Escrita em `useLayoutEffect`, depois do commit, e não durante a renderização. O quadro inseguro
   * que eu temia não existe: quando o usuário clica em Continuar, a lista JÁ está em cache, então o
   * primeiro render do formulário tem `topAtual` e não precisa da trava. Ela só é lida nos renders
   * SEGUINTES, quando um refetch adverso zerou `topAtual` — e aí ela já foi gravada há muito.
   */
  const chave = pedido ? `${kind}:${pedido}` : null;
  const trava = React.useRef<{ chave: string; top: TopOperacional } | null>(null);
  React.useLayoutEffect(() => {
    if (!chave) { trava.current = null; return; }
    if (topAtual) trava.current = { chave, top: topAtual };
  });

  /** A TOP desta sessão de edição: a atual, ou a que já foi validada sob ESTA MESMA chave. */
  const topDaSessao = chave && trava.current?.chave === chave ? trava.current.top : null;
  const topEfetiva = topAtual ?? topDaSessao;

  /**
   * A ESCRITA SÓ É AUTORIZADA PELO ESTADO ATUAL. `podeLancar` continua sendo a regra — a trava não a
   * afrouxa e não ganhou uma variante permissiva. `topAtual` só é não-nulo quando a descoberta está
   * `pronto` E a TOP escolhida está na lista de AGORA; as duas condições estão escritas para que
   * remover uma delas de `topSelecionada` não passe despercebido aqui.
   */
  const escritaTopConfirmada = podeLancar(estadoTop) && topAtual !== null;

  if (topEfetiva) return <Formulario
    kind={kind}
    top={topEfetiva}
    familia={estadoTop.situacao === "pronto" ? estadoTop.dados.family.label : ""}
    estadoTop={estadoTop}
    escritaTopConfirmada={escritaTopConfirmada}
  />;

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

function Formulario({ kind, top, familia, estadoTop, escritaTopConfirmada }: {
  kind: string;
  top: TopOperacional;
  familia: string;
  /** O estado ATUAL da descoberta — o que reabilita o Salvar quando a capability volta. */
  estadoTop: EstadoTop;
  /** A descoberta de AGORA confirma esta TOP? Só isso autoriza o POST. */
  escritaTopConfirmada: boolean;
}) {
  const router = useRouter(); const empresa = useEmpresaPadrao();
  const [h, setH] = React.useState({ empresa_id: "", document_date: todayISO(), shipping_date: "", due_date: "", client_id: "", transporter_id: "", proprietary_id: "", driver_name: "", payment_method_id: "", freight: "0", freight_icms: "0", other_values: "0", discount: "0", note: "", is_deductible: false, installments: false, categoria_financeira_id: "", centro_custo_id: "" });
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
  /**
   * CLASSIFICAÇÃO FINANCEIRA (VENDAS-A1): só existe na tela quando a API DECLARA que a entende. Obrigatória
   * nas TRÊS variantes: documento salvo não tem edição aqui e a conversão só copia — pedido sem
   * classificação viraria venda sem classificação, sem conserto.
   */
  const classificacaoAtiva = entendeClassificacaoFinanceira(estadoTop);
  const semClassificacao = classificacaoAtiva && (!h.categoria_financeira_id || !h.centro_custo_id);
  /** O UUID que vai no corpo é o da TOP VALIDADA contra a lista — nunca o texto cru da URL. */
  const submit = () => {
    /**
     * A DEFESA NO HANDLER, e não só no `disabled` do botão.
     *
     * `disabled` é apresentação: some com uma linha removida por engano, com um clique programático,
     * ou com qualquer caminho que chame `submit` sem passar pelo botão. A regra que impede a gravação
     * de um documento cuja operação não está confirmada tem de estar onde a gravação acontece.
     */
    if (!escritaTopConfirmada) return;
    if (semClassificacao) return;
    create.mutate({ empresa_id: h.empresa_id, document_date: h.document_date, shipping_date: h.shipping_date || null, due_date: h.due_date || null, client_id: h.client_id, transporter_id: h.transporter_id || null, proprietary_id: h.proprietary_id || null, driver_name: h.driver_name || null, payment_method_id: h.payment_method_id || null, freight: h.freight || "0", freight_icms: h.freight_icms || "0", other_values: h.other_values || "0", discount: h.discount || "0", note: h.note || null, is_deductible: h.is_deductible, installment_plan: h.installments ? plan : null, items: items.map((i) => ({ product_id: i.product_id, warehouse_id: i.warehouse_id || null, quantity: i.quantity, unit_price: i.unit_value ?? "0", discount: i.discount || "0", discount_percent: i.discount_percent || "0", note: null })), tipo_operacao_id: top.id, ...(classificacaoAtiva ? { categoria_financeira_id: h.categoria_financeira_id, centro_custo_id: h.centro_custo_id } : {}) });
  };

  const voltarAoLancador = () => router.replace(`/vendas/${kind}/new`);
  const alterarOperacao = () => { if (sujo) setConfirmarTroca(true); else voltarAoLancador(); };

  /**
   * A MOLDURA É VISUAL; O CONTRATO CONTINUA AQUI (VISUAL-UX-01, fidelidade na R1).
   *
   * `CentralVendasWorkspace` e `ItensDaCentral` recebem o estado desta função e só o apresentam. Nada de
   * regra saiu daqui — `escritaTopConfirmada`, o guard dentro de `submit`, `podeLancar`, a trava da
   * sessão, o rascunho (`sujo`/`useDirtyTab`) e o payload são os mesmos, linha a linha. O que mudou é
   * ONDE e COMO cada campo aparece:
   *
   *   Dados principais → Cliente, Empresa, Tipo de Operação (travado), Data, Vencimento, Forma de
   *                      pagamento, Data de saída; Proprietário em "Dados adicionais"
   *   Itens            → grade, formulário ou os dois, sobre o MESMO `items`
   *   Totais           → Desconto, Outros valores
   *   Financeiro       → Parcelamento e plano de parcelas
   *   Frete e transporte → Transportadora, Motorista, Frete, ICMS do frete
   *   Fiscal           → Dedutível
   *   Observações      → Observação
   *
   * A BARRA SÓ TEM AÇÕES QUE EXISTEM: Voltar, Salvar e Alterar operação (e Documentos abertos, que é
   * visão da barra de abas). "Confirmar venda", "Descartar", "Editar" e "Anexos" do design não têm
   * contrato nesta etapa (`docs/DECISIONS.md` 224) — não aparecem, nem desabilitadas.
   */
  const [maisDados, setMaisDados] = React.useState(false);

  /*
    A OPERAÇÃO É CONTEXTO, NÃO IDENTIDADE. Ela aparece como campo travado em Dados principais — o design
    mostra o Tipo de Operação assim —, e nunca no lugar do número do documento: em criação o documento
    ainda NÃO tem número, e exibir o código da TOP ali faria parecer que tem.
    A VERSÃO não aparece de propósito: o que esta tela conhece é a versão CORRENTE no momento da
    escolha, e quem congela a versão do documento é o servidor, no POST. Exibi-la antes de salvar
    prometeria um snapshot que ainda não existe — a versão congelada é mostrada no DETALHE.
  */
  const contextoOperacional = <Travado rotulo={familia ? `Tipo de Operação · ${familia}` : "Tipo de Operação"} testId="top-contexto">
    <span className={estilosCv.codigo}>{top.code}</span><span className={estilosCv.separador}>·</span><span>{top.name}</span>
  </Travado>;

  /*
    POR QUE A ESCRITA ESTÁ BLOQUEADA — dentro do formulário, que continua inteiro.

    A operação da SESSÃO segue no campo travado de Dados principais: ela não é trocada, não é apagada e
    não vira outra. O que some é o direito de gravar, e a razão aparece aqui.

    `MensagemTop` cobre os estados que ela já explica (servidor não confirmado, erro, nenhuma TOP
    cadastrada) — a mesma frase da etapa de escolha, sem segunda redação do mesmo diagnóstico.
    Sobra UM caso que ela não cobre, e que é novo aqui: o servidor está COMPATÍVEL (contrato 1,
    lista válida) e ainda assim a TOP desta sessão não está mais em `items`. Não é falha de
    servidor nem configuração ausente; é a operação escolhida que saiu de circulação. A frase é a
    mesma da recusa do lançador, e continua sem revelar a causa.
  */
  const avisoDeEscrita = !escritaTopConfirmada && <div className="space-y-1 rounded-md bg-amber-50 p-3">
    <MensagemTop estado={estadoTop} />
    {estadoTop.situacao === "pronto" && <p data-testid="top-indisponivel" className="text-sm text-amber-800">
      O Tipo de Operação selecionado não está disponível para este lançamento.
    </p>}
    <p className="text-xs text-amber-700">
      O que já foi preenchido continua aqui. Use “Alterar operação” para escolher outra.
    </p>
  </div>;

  const pesquisa = (conteudo: React.ReactNode) => <div className={cn(estilosCv.campo, estilosCv.campoPesquisa)}>{conteudo}<span className={estilosCv.adorno} aria-hidden><Search /></span></div>;
  const campo = (conteudo: React.ReactNode) => <div className={estilosCv.campo}>{conteudo}</div>;

  return <>
    <CentralVendasWorkspace
      titulo={T[kind] ?? "Novo"}
      identidade={{ nome: T[kind] ?? "Novo documento", alterado: sujo, dica: kind === "sales" ? "A confirmação da venda baixa o estoque dos itens com armazém e gera as contas a receber." : "Documento comercial sem efeito em estoque/financeiro até ser convertido em venda confirmada." }}
      acoes={<>
        {/* sem "Voltar": como no design, a barra só tem ações do documento; navegar é a barra de abas */}
        <AcaoDaBarra rotulo="Salvar" destaque="salvar" dica="inicio" ocupado={create.isPending} disabled={!escritaTopConfirmada || semClassificacao || !h.client_id || !items.length || items.some((i) => !i.product_id)} onClick={submit}><Save aria-hidden /></AcaoDaBarra>
        <DivisorDaBarra />
        <AcaoDaBarra rotulo="Alterar operação" data-testid="top-alterar" onClick={alterarOperacao}><Repeat2 aria-hidden /></AcaoDaBarra>
      </>}
      acoesDireita={<DocumentosAbertos />}
      aviso={avisoDeEscrita}
      dados={<>
        {pesquisa(<Field label="Cliente" required span={12}><RefSelect resource="people" value={h.client_id} onChange={(v) => setH({ ...h, client_id: v ?? "" })} filter={{ is_client: "true" }} /></Field>)}
        {pesquisa(<Field label="Empresa" required span={12}><RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => setH({ ...h, empresa_id: v ?? "" })} /></Field>)}
        {contextoOperacional}
        {campo(<Field label="Data" required span={12}><Input type="date" value={h.document_date} onChange={(e) => setH({ ...h, document_date: e.target.value })} /></Field>)}
        {campo(<Field label="Vencimento" span={12}><Input type="date" value={h.due_date} onChange={(e) => setH({ ...h, due_date: e.target.value })} /></Field>)}
        {pesquisa(<Field label="Forma de pagamento" span={12}><RefSelect resource="payment_methods" value={h.payment_method_id} onChange={(v) => setH({ ...h, payment_method_id: v ?? "" })} /></Field>)}
        {classificacaoAtiva && pesquisa(<Field label="Categoria financeira" required span={12}><RefSelect resource="financial_categories" value={h.categoria_financeira_id} onChange={(v) => setH({ ...h, categoria_financeira_id: v ?? "" })} filter={{ kind: "analytic", nature: "income" }} /></Field>)}
        {classificacaoAtiva && pesquisa(<Field label="Centro de custo" required span={12}><RefSelect resource="cost_centers" value={h.centro_custo_id} onChange={(v) => setH({ ...h, centro_custo_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field>)}
        {campo(<Field label="Data de saída" span={12}><Input type="date" value={h.shipping_date} onChange={(e) => setH({ ...h, shipping_date: e.target.value })} /></Field>)}
        <button type="button" className={estilosCv.maisDados} aria-expanded={maisDados} aria-controls="dados-adicionais" onClick={() => setMaisDados((m) => !m)}>
          <ChevronRight aria-hidden /> Dados adicionais <span className={estilosCv.mudo}>· 1 campo</span>
        </button>
        {maisDados && <div id="dados-adicionais">
          {pesquisa(<Field label="Proprietário" span={12}><RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field>)}
        </div>}
      </>}
      itens={<ItensDaCentral items={items} onChange={setItems} />}
      abas={[
        { value: "totais", label: "Totais", content: <div className={estilosCv.painelColuna} style={{ maxWidth: 330 }}>
          {campo(<Field label="Desconto" span={12}><Input type="number" step="0.01" value={h.discount} onChange={(e) => setH({ ...h, discount: e.target.value })} /></Field>)}
          {campo(<Field label="Outros valores" span={12}><Input type="number" step="0.01" value={h.other_values} onChange={(e) => setH({ ...h, other_values: e.target.value })} /></Field>)}
        </div> },
        { value: "financeiro", label: "Financeiro", content: <div className={estilosCv.painelColuna}>
          <div style={{ maxWidth: 330 }}>{campo(<Field label="Parcelamento" span={12}><NativeSelect value={h.installments ? "1" : "0"} onChange={(e) => setH({ ...h, installments: e.target.value === "1" })}><option value="0">À vista</option><option value="1">Parcelado</option></NativeSelect></Field>)}</div>
          {h.installments && <div className={estilosCv.painelLargo}><div className={estilosCv.subtitulo}>Plano de parcelas</div><PlanEditor plan={plan} onChange={setPlan} /></div>}
        </div> },
        { value: "frete", label: "Frete e transporte", content: <div className={estilosCv.painelGrade}>
          <div className={estilosCv.painelColuna}>
            {pesquisa(<Field label="Transportadora" span={12}><RefSelect resource="people" value={h.transporter_id} onChange={(v) => setH({ ...h, transporter_id: v ?? "" })} filter={{ is_transporter: "true" }} /></Field>)}
            {campo(<Field label="Motorista" span={12}><Input value={h.driver_name} onChange={(e) => setH({ ...h, driver_name: e.target.value })} /></Field>)}
          </div>
          <div className={estilosCv.painelColuna}>
            {campo(<Field label="Frete" span={12}><Input type="number" step="0.01" value={h.freight} onChange={(e) => setH({ ...h, freight: e.target.value })} /></Field>)}
            {campo(<Field label="ICMS frete" span={12}><Input type="number" step="0.01" value={h.freight_icms} onChange={(e) => setH({ ...h, freight_icms: e.target.value })} /></Field>)}
          </div>
        </div> },
        { value: "fiscal", label: "Fiscal", content: <div className={estilosCv.painelColuna} style={{ maxWidth: 330 }}>
          {campo(<Field label="Dedutível" span={12}><NativeSelect value={h.is_deductible ? "1" : "0"} onChange={(e) => setH({ ...h, is_deductible: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>)}
        </div> },
        { value: "observacoes", label: "Observações", content: <div className={estilosCv.painelLargo}>
          {campo(<Field label="Observação" span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>)}
        </div> }
      ]}
    />

    {/* Trocar a operação descarta o que foi digitado — então pergunta antes, em vez de descobrir depois. */}
    <Confirm open={confirmarTroca} onOpenChange={setConfirmarTroca} title="Alterar o Tipo de Operação?"
      text="Os dados já preenchidos neste lançamento serão descartados." danger
      onConfirm={() => { setConfirmarTroca(false); voltarAoLancador(); }} />
  </>;
}

export default function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params);
  return <Suspense><Inner kind={kind} /></Suspense>;
}
