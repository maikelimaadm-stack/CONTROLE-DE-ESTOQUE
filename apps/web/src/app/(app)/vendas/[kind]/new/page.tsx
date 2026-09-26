"use client";
import * as React from "react";
import { Suspense, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { useDirtyTab, useTabTitle } from "@/lib/workspace-tabs";
import { Confirm, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { PlanEditor, defaultPlan, useCreate, useEmpresaPadrao, type ItemRow, type Plan } from "@/features/docs/shared";
import { useQuery } from "@tanstack/react-query";
import { ERRO_LAYOUT_CAMPO_OBRIGATORIO, LAYOUT_DO_SISTEMA, camposObrigatoriosFaltando, catalogoDaFamilia, documentTotals, mensagemCampoObrigatorio, normalizarCondicaoPagamento, planoDaCondicao, validarCondicaoPagamento, type CampoDoLayout, type CondicaoPagamento, type EstruturaLayout, type ValorPadraoLayout } from "@agro/domain";
import { api, ApiError } from "@/lib/api";
import { MensagemTop, entendeClassificacaoFinanceira, entendeCondicaoPagamento, entendeLayoutDocumento, podeLancar, useTopsDaVariante, type EstadoTop, type TopOperacional } from "@/features/sales/tipo-operacao-select";
import { LancadorDeTipoOperacao, pedidoImpossivel, topSelecionada } from "@/features/sales/lancador-tipo-operacao";
import { ChevronRight, Repeat2, Save, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { AcaoDaBarra, CentralVendasWorkspace, DivisorDaBarra } from "@/features/sales/central-vendas-workspace";
import { ItensDaCentral, Travado } from "@/features/sales/central-vendas-itens";
import { DocumentosAbertos } from "@/features/sales/central-vendas-documentos";
import estilosCv from "@/features/sales/central-vendas-workspace.module.css";

const T: Record<string, string> = { budgets: "Novo Orçamento", orders: "Novo Pedido de Venda", sales: "Nova Venda" };

/**
 * LAYOUT DO DOCUMENTO (VENDAS-A3-1) — o que `/layout-efetivo` devolve, CONFERIDO antes de governar a tela (mesma
 * postura de `ehTopsDaVariante`: o corpo é `unknown` até provar a forma; o que não se reconhece não vale).
 */
const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehCampoDoLayout = (v: unknown) => ehObj(v) && typeof v.campo === "string" && typeof v.obrigatorio === "boolean" && typeof v.editavel === "boolean" && (v.rotulo === undefined || v.rotulo === null || typeof v.rotulo === "string");
function ehEstruturaLayout(v: unknown): v is EstruturaLayout {
  return ehObj(v) && v.versaoSchema === 1
    && Array.isArray(v.cabecalho) && v.cabecalho.every(ehCampoDoLayout)
    && Array.isArray(v.rodape) && v.rodape.every((a) => ehObj(a) && typeof a.aba === "string" && Array.isArray(a.campos) && a.campos.every(ehCampoDoLayout))
    && Array.isArray(v.itens) && v.itens.every((c) => ehObj(c) && typeof c.campo === "string" && typeof c.obrigatorio === "boolean");
}

/** Valor padrão do layout → valor do estado do formulário. `null` = não se aplica (o validador do domínio já recusa esses). */
function valorDoPadrao(v: ValorPadraoLayout, empresa: string): string | boolean | null {
  if (v.tipo === "variavel") return v.variavel === "data_atual" ? todayISO() : empresa || null;
  return typeof v.valor === "boolean" ? v.valor : String(v.valor);
}

/** Detalhe do 422 LAYOUT_CAMPO_OBRIGATORIO → { caminho: mensagem }. Aceita lista direta ou embrulhada. */
function errosDoServidor(details: unknown): Record<string, string> {
  const lista: unknown[] = Array.isArray(details) ? details
    : ehObj(details) ? (Array.isArray(details.campos) ? details.campos : Array.isArray(details.fields) ? details.fields : Array.isArray(details.erros) ? details.erros : []) : [];
  const out: Record<string, string> = {};
  for (const d of lista) {
    if (!ehObj(d)) continue;
    const caminho = typeof d.caminho === "string" ? d.caminho : typeof d.path === "string" ? d.path : typeof d.campo === "string" ? d.campo : null;
    if (!caminho) continue;
    const msg = typeof d.mensagem === "string" ? d.mensagem : typeof d.message === "string" ? d.message : typeof d.rotulo === "string" ? mensagemCampoObrigatorio(d.rotulo) : "Campo obrigatório.";
    out[caminho] = msg;
  }
  return out;
}

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
  const [h, setH] = React.useState({ empresa_id: "", document_date: todayISO(), shipping_date: "", due_date: "", client_id: "", transporter_id: "", proprietary_id: "", driver_name: "", payment_method_id: "", freight: "0", freight_icms: "0", other_values: "0", discount: "0", note: "", is_deductible: false, installments: false, categoria_financeira_id: "", centro_custo_id: "", condicao_pagamento_id: "" });
  const [items, setItems] = React.useState<ItemRow[]>([]); const [plan, setPlan] = React.useState<Plan>(defaultPlan());
  const [confirmarTroca, setConfirmarTroca] = React.useState(false);
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresa })); }, [empresa]);

  /**
   * LAYOUT DO DOCUMENTO (VENDAS-A3-1): SÓ com `capacidades.layoutDocumento` EXATA. Sem ela nenhuma pergunta sai e a
   * tela é a de hoje (a estrutura usada para desenhar é `LAYOUT_DO_SISTEMA`, que É a tela de hoje, e nenhum
   * `data-campo` nem cobrança nova aparece). Com ela, a TOP escolhida (trocar a TOP remonta este formulário, então a
   * chave é `top.id`) pergunta o layout efetivo; enquanto ele não chega, ou se não chega conferido, o Salvar trava:
   * gravar sem saber o que é obrigatório seria descobrir no 422.
   */
  /* A família vem do SERVIDOR (`family.code` de `/operation-types`) — o cliente não enumera famílias. Guardada ao
     montar: um refetch adverso não pode desmontar a estrutura da tela. */
  const familiaAgora = estadoTop.situacao === "pronto" ? estadoTop.dados.family.code : "";
  const [familiaLayout, setFamiliaLayout] = React.useState(familiaAgora);
  React.useEffect(() => { if (familiaAgora && familiaAgora !== familiaLayout) setFamiliaLayout(familiaAgora); }, [familiaAgora, familiaLayout]);
  const layoutAtivo = entendeLayoutDocumento(estadoTop);
  const layoutQ = useQuery<unknown, ApiError>({
    queryKey: ["layout-efetivo", kind, top.id],
    queryFn: () => api<unknown>(`/api/sales/${kind}/layout-efetivo?tipo_operacao_id=${encodeURIComponent(top.id)}`),
    enabled: layoutAtivo,
    retry: false
  });
  const layoutRecebido = layoutQ.data;
  const layout: EstruturaLayout | null = React.useMemo(() => {
    if (!layoutAtivo || !ehObj(layoutRecebido)) return null;
    return ehEstruturaLayout(layoutRecebido.estrutura) ? layoutRecebido.estrutura : null;
  }, [layoutAtivo, layoutRecebido]);
  const layoutPendente = layoutAtivo && !layout;
  const estrutura = React.useMemo(() => layout ?? LAYOUT_DO_SISTEMA(familiaLayout), [layout, familiaLayout]);
  /** Configuração do layout por chave (cabeçalho e rodapé) — só com layout de verdade. */
  const cfg = React.useMemo(() => new Map<string, CampoDoLayout>(layout ? [...layout.cabecalho, ...layout.rodape.flatMap((a) => a.campos)].map((x) => [x.campo, x]) : []), [layout]);
  const rotuloDoCatalogo = React.useMemo(() => new Map(catalogoDaFamilia(familiaLayout).filter((c) => c.parte !== "itens").map((c) => [c.chave, c.rotulo])), [familiaLayout]);

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

  /**
   * VALOR PADRÃO DO LAYOUT, aplicado ao ABRIR (quando o layout chega), só a campo ainda intocado — o valor digitado
   * nunca é sobrescrito. O estado inicial acompanha, para o padrão não contar como "tem coisa digitada".
   */
  const padroesAplicados = React.useRef<EstruturaLayout | null>(null);
  React.useEffect(() => {
    if (!layout || padroesAplicados.current === layout) return;
    padroesAplicados.current = layout;
    const novos: Partial<typeof h> = {};
    for (const x of [...layout.cabecalho, ...layout.rodape.flatMap((a) => a.campos)]) {
      if (!x.valorPadrao || !(x.campo in inicial.current)) continue;
      const v = valorDoPadrao(x.valorPadrao, empresa);
      if (v === null) continue;
      Object.assign(novos, { [x.campo]: v });
    }
    if (!Object.keys(novos).length) return;
    const antes = inicial.current;
    inicial.current = { ...antes, ...novos };
    setH((o) => {
      const r = { ...o };
      for (const [k, v] of Object.entries(novos)) if (JSON.stringify(o[k as keyof typeof o]) === JSON.stringify(antes[k as keyof typeof antes]) || k === "empresa_id") Object.assign(r, { [k]: v });
      return r;
    });
  }, [layout, empresa]);

  const create = useCreate<{ id: string }>(`/api/sales/${kind}`, (r) => router.push(`/vendas/${kind}/${r.id}`));
  /**
   * CLASSIFICAÇÃO FINANCEIRA (VENDAS-A1): só existe na tela quando a API DECLARA que a entende. Obrigatória
   * nas TRÊS variantes: documento salvo não tem edição aqui e a conversão só copia — pedido sem
   * classificação viraria venda sem classificação, sem conserto.
   */
  const classificacaoAtiva = entendeClassificacaoFinanceira(estadoTop);
  /**
   * CONDIÇÃO DE PAGAMENTO (VENDAS-A4): só existe na tela quando a API DECLARA que a entende. Escolhida, o plano
   * mostrado é o de `planoDaCondicao` (a MESMA conta da API) sobre a data e o total do documento (`documentTotals`,
   * o MESMO total da API). Enquanto o usuário não mexe no plano, o corpo leva `installment_plan: null` e o servidor
   * deriva; mexeu em qualquer campo do plano → AJUSTE: o corpo leva o plano e a tela para de recalcular.
   */
  const condicaoAtiva = entendeCondicaoPagamento(estadoTop);
  const condicaoId = condicaoAtiva ? h.condicao_pagamento_id : "";
  const [ajustado, setAjustado] = React.useState(false);
  const condicao = useQuery({
    queryKey: ["condicao-pagamento", condicaoId],
    queryFn: () => api<Record<string, unknown>>(`/api/resources/condicoes_pagamento/${encodeURIComponent(condicaoId)}`),
    enabled: Boolean(condicaoId)
  });
  const planoCalculado = React.useMemo(() => {
    const r = condicao.data;
    if (!condicaoId || !r) return null;
    const c = normalizarCondicaoPagamento({
      parcelas: Number(r["parcelas"]), dias_primeira_parcela: Number(r["dias_primeira_parcela"]), modo: r["modo"] as CondicaoPagamento["modo"],
      intervalo_dias: Number(r["intervalo_dias"]), dia_vencimento: r["dia_vencimento"] === null || r["dia_vencimento"] === undefined ? null : Number(r["dia_vencimento"]),
      entrada: r["entrada"] === true, entrada_percentual: (r["entrada_percentual"] ?? null) as CondicaoPagamento["entrada_percentual"]
    });
    if (validarCondicaoPagamento(c).length) return null;
    try {
      const { total } = documentTotals(items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_value ?? "0", discount: i.discount || "0", discountPercent: i.discount_percent || "0" })), { freight: h.freight || "0", freightIcms: h.freight_icms || "0", otherValues: h.other_values || "0", discount: h.discount || "0" });
      return planoDaCondicao(c, { dataDocumento: h.document_date, total }) as Plan;
    } catch { return null; }
  }, [condicaoId, condicao.data, items, h.freight, h.freight_icms, h.other_values, h.discount, h.document_date]);
  /** Sem ajuste, a data ou o total mudou → o plano mostrado acompanha. Ajustado, a tela não recalcula mais. */
  React.useEffect(() => { if (planoCalculado && !ajustado) setPlan(planoCalculado); }, [planoCalculado, ajustado]);
  const escolherCondicao = (v: string | null) => {
    setH((o) => ({ ...o, condicao_pagamento_id: v ?? "" }));
    setAjustado(false);
    if (!v) setPlan(defaultPlan());
  };
  const ajustarPlano = (p: Plan) => { setPlan(p); setAjustado(true); };
  const semClassificacao = classificacaoAtiva && (!h.categoria_financeira_id || !h.centro_custo_id);
  /** O corpo do POST — o MESMO objeto que a cobrança do layout confere antes de sair. */
  const corpo = () => ({ empresa_id: h.empresa_id, document_date: h.document_date, shipping_date: h.shipping_date || null, due_date: h.due_date || null, client_id: h.client_id, transporter_id: h.transporter_id || null, proprietary_id: h.proprietary_id || null, driver_name: h.driver_name || null, payment_method_id: h.payment_method_id || null, freight: h.freight || "0", freight_icms: h.freight_icms || "0", other_values: h.other_values || "0", discount: h.discount || "0", note: h.note || null, is_deductible: h.is_deductible, installment_plan: condicaoId ? (ajustado ? plan : null) : (h.installments ? plan : null), items: items.map((i) => ({ product_id: i.product_id, warehouse_id: i.warehouse_id || null, quantity: i.quantity, unit_price: i.unit_value ?? "0", discount: i.discount || "0", discount_percent: i.discount_percent || "0", note: null })), tipo_operacao_id: top.id, ...(classificacaoAtiva ? { categoria_financeira_id: h.categoria_financeira_id, centro_custo_id: h.centro_custo_id } : {}), ...(condicaoId ? { condicao_pagamento_id: condicaoId } : {}) });

  /**
   * OBRIGATÓRIOS DO LAYOUT: a MESMA função do domínio que a API usa (`camposObrigatoriosFaltando`), sobre o MESMO
   * corpo. Depois da primeira tentativa de salvar, os erros acompanham a digitação; os do servidor (422
   * LAYOUT_CAMPO_OBRIGATORIO) ficam até a próxima tentativa.
   */
  const [tentouSalvar, setTentouSalvar] = React.useState(false);
  const [errosServidor, setErrosServidor] = React.useState<Record<string, string>>({});
  const faltando = () => (layout ? camposObrigatoriosFaltando(familiaLayout, layout, corpo(), { classificacao: classificacaoAtiva, condicao: condicaoAtiva }) : []);
  const errosLocais: Record<string, string> = layout && tentouSalvar ? Object.fromEntries(faltando().map((f) => [f.caminho, mensagemCampoObrigatorio(f.rotulo)])) : {};
  const erros: Record<string, string> = layout ? { ...errosServidor, ...errosLocais } : {};
  const [maisDados, setMaisDados] = React.useState(false);
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
    if (!layoutAtivo) { create.mutate(corpo()); return; }
    if (!layout) return;
    setTentouSalvar(true); setErrosServidor({});
    const f = faltando();
    if (f.length) { if (f.some((x) => x.caminho === "proprietary_id")) setMaisDados(true); return; }
    create.mutate(corpo(), {
      onError: (e) => { if (e instanceof ApiError && e.code === ERRO_LAYOUT_CAMPO_OBRIGATORIO) { const m = errosDoServidor(e.details); setErrosServidor(m); if ("proprietary_id" in m) setMaisDados(true); } }
    });
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
  const avisoDeLayout = layoutPendente && (layoutQ.isError || (layoutQ.isSuccess && !layout)) && <div className="rounded-md bg-amber-50 p-3">
    <p data-testid="layout-nao-carregado" className="text-sm text-amber-700">Não foi possível carregar o layout deste Tipo de Operação. O lançamento está bloqueado até ele ser carregado.</p>
  </div>;
  const avisoDeEscrita = !escritaTopConfirmada && <div className="space-y-1 rounded-md bg-amber-50 p-3">
    <MensagemTop estado={estadoTop} />
    {estadoTop.situacao === "pronto" && <p data-testid="top-indisponivel" className="text-sm text-amber-800">
      O Tipo de Operação selecionado não está disponível para este lançamento.
    </p>}
    <p className="text-xs text-amber-700">
      O que já foi preenchido continua aqui. Use “Alterar operação” para escolher outra.
    </p>
  </div>;

  /**
   * CADA CAMPO DESENHADO PELA ESTRUTURA (VENDAS-A3-1). Sem layout (sem a capacidade) a estrutura é `LAYOUT_DO_SISTEMA`
   * — a ordem, os rótulos e as abas de hoje — e nada muda no DOM: sem `data-campo`, sem erro, sem obrigatório novo.
   * Com layout: rótulo e obrigatório do layout, `data-campo="<chave>"` no invólucro, erro no próprio campo, e o campo
   * não editável aparece travado (fieldset desabilitado) mostrando o valor (o padrão aplicado ao abrir).
   */
  const dc = (chave: string) => (layout ? { "data-campo": chave } : {});
  const rot = (chave: string, hoje: string) => cfg.get(chave)?.rotulo || hoje;
  const req = (chave: string, hoje: boolean) => (layout ? Boolean(cfg.get(chave)?.obrigatorio) : hoje);
  const err = (chave: string) => erros[chave];
  const pesquisa = (conteudo: React.ReactNode, chave?: string) => <div className={cn(estilosCv.campo, estilosCv.campoPesquisa)} {...(chave ? dc(chave) : {})}>{conteudo}<span className={estilosCv.adorno} aria-hidden><Search /></span></div>;
  const campo = (conteudo: React.ReactNode, chave?: string) => <div className={estilosCv.campo} {...(chave ? dc(chave) : {})}>{conteudo}</div>;
  const larguraFixa = { maxWidth: 330 };

  const desenhar = (chave: string): React.ReactNode => {
    switch (chave) {
      case "client_id": return pesquisa(<Field label={rot(chave, "Cliente")} required={req(chave, true)} error={err(chave)} span={12}><RefSelect resource="people" value={h.client_id} onChange={(v) => setH({ ...h, client_id: v ?? "" })} filter={{ is_client: "true" }} /></Field>, chave);
      case "empresa_id": return pesquisa(<Field label={rot(chave, "Empresa")} required={req(chave, true)} error={err(chave)} span={12}><RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => setH({ ...h, empresa_id: v ?? "" })} /></Field>, chave);
      case "document_date": return campo(<Field label={rot(chave, "Data")} required={req(chave, true)} error={err(chave)} span={12}><Input type="date" value={h.document_date} onChange={(e) => setH({ ...h, document_date: e.target.value })} /></Field>, chave);
      case "due_date": return campo(<Field label={rot(chave, "Vencimento")} required={req(chave, false)} error={err(chave)} span={12}><Input type="date" value={h.due_date} onChange={(e) => setH({ ...h, due_date: e.target.value })} /></Field>, chave);
      case "payment_method_id": return pesquisa(<Field label={rot(chave, "Forma de pagamento")} required={req(chave, false)} error={err(chave)} span={12}><RefSelect resource="payment_methods" value={h.payment_method_id} onChange={(v) => setH({ ...h, payment_method_id: v ?? "" })} /></Field>, chave);
      case "categoria_financeira_id": return classificacaoAtiva && pesquisa(<Field label={rot(chave, "Natureza")} required={req(chave, true)} error={err(chave)} span={12}><RefSelect resource="financial_categories" value={h.categoria_financeira_id} onChange={(v) => setH({ ...h, categoria_financeira_id: v ?? "" })} filter={{ kind: "analytic", nature: "income" }} /></Field>, chave);
      case "centro_custo_id": return classificacaoAtiva && pesquisa(<Field label={rot(chave, "Centro de resultado")} required={req(chave, true)} error={err(chave)} span={12}><RefSelect resource="cost_centers" value={h.centro_custo_id} onChange={(v) => setH({ ...h, centro_custo_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field>, chave);
      case "shipping_date": return campo(<Field label={rot(chave, "Data de saída")} required={req(chave, false)} error={err(chave)} span={12}><Input type="date" value={h.shipping_date} onChange={(e) => setH({ ...h, shipping_date: e.target.value })} /></Field>, chave);
      case "proprietary_id": return pesquisa(<Field label={rot(chave, "Proprietário")} required={req(chave, false)} error={err(chave)} span={12}><RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field>, chave);
      case "discount": return campo(<Field label={rot(chave, "Desconto")} required={req(chave, false)} error={err(chave)} span={12}><Input type="number" step="0.01" value={h.discount} onChange={(e) => setH({ ...h, discount: e.target.value })} /></Field>, chave);
      case "other_values": return campo(<Field label={rot(chave, "Outros valores")} required={req(chave, false)} error={err(chave)} span={12}><Input type="number" step="0.01" value={h.other_values} onChange={(e) => setH({ ...h, other_values: e.target.value })} /></Field>, chave);
      case "condicao_pagamento_id": return condicaoAtiva && <div style={larguraFixa} data-testid="condicao-pagamento">{pesquisa(<Field label={rot(chave, "Condição de pagamento")} required={req(chave, false)} error={err(chave)} span={12}><RefSelect resource="condicoes_pagamento" value={h.condicao_pagamento_id} onChange={escolherCondicao} /></Field>, chave)}</div>;
      case "installment_plan": return <>
        {!condicaoId && <div style={larguraFixa}>{campo(<Field label={rot(chave, "Parcelamento")} required={req(chave, false)} error={err(chave)} span={12}><NativeSelect value={h.installments ? "1" : "0"} onChange={(e) => setH({ ...h, installments: e.target.value === "1" })}><option value="0">À vista</option><option value="1">Parcelado</option></NativeSelect></Field>, chave)}</div>}
        {!condicaoId && h.installments && <div className={estilosCv.painelLargo}><div className={estilosCv.subtitulo}>Plano de parcelas</div><PlanEditor plan={plan} onChange={setPlan} /></div>}
        {condicaoId && planoCalculado && <div className={estilosCv.painelLargo}><div className={estilosCv.subtitulo}>Plano de parcelas</div><PlanEditor plan={plan} onChange={ajustarPlano} /></div>}
      </>;
      case "transporter_id": return pesquisa(<Field label={rot(chave, "Transportadora")} required={req(chave, false)} error={err(chave)} span={12}><RefSelect resource="people" value={h.transporter_id} onChange={(v) => setH({ ...h, transporter_id: v ?? "" })} filter={{ is_transporter: "true" }} /></Field>, chave);
      case "driver_name": return campo(<Field label={rot(chave, "Motorista")} required={req(chave, false)} error={err(chave)} span={12}><Input value={h.driver_name} onChange={(e) => setH({ ...h, driver_name: e.target.value })} /></Field>, chave);
      case "freight": return campo(<Field label={rot(chave, "Frete")} required={req(chave, false)} error={err(chave)} span={12}><Input type="number" step="0.01" value={h.freight} onChange={(e) => setH({ ...h, freight: e.target.value })} /></Field>, chave);
      case "freight_icms": return campo(<Field label={rot(chave, "ICMS frete")} required={req(chave, false)} error={err(chave)} span={12}><Input type="number" step="0.01" value={h.freight_icms} onChange={(e) => setH({ ...h, freight_icms: e.target.value })} /></Field>, chave);
      case "is_deductible": return campo(<Field label={rot(chave, "Dedutível")} required={req(chave, false)} error={err(chave)} span={12}><NativeSelect value={h.is_deductible ? "1" : "0"} onChange={(e) => setH({ ...h, is_deductible: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>, chave);
      case "note": return campo(<Field label={rot(chave, "Observação")} required={req(chave, false)} error={err(chave)} span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>, chave);
      default: return null;
    }
  };
  /** Campo com gate de capacidade que a API não declara não existe — nem conta para montar aba. */
  const existe = (chave: string) => rotuloDoCatalogo.has(chave)
    && !((chave === "categoria_financeira_id" || chave === "centro_custo_id") && !classificacaoAtiva)
    && !(chave === "condicao_pagamento_id" && !condicaoAtiva);
  /** O campo, com a chave do React e — só com layout e `editavel: false` — travado. */
  const render = (chave: string) => {
    const n = desenhar(chave);
    const travado = layout && cfg.get(chave)?.editavel === false;
    return <React.Fragment key={chave}>{travado ? <fieldset disabled data-editavel="false" style={{ display: "contents" }}>{n}</fieldset> : n}</React.Fragment>;
  };

  /* Dados principais: ordem do layout; a Operação logo depois da Empresa (ou depois dos dois primeiros); o
     Proprietário em "Dados adicionais", como hoje. */
  const cabecalho = estrutura.cabecalho.map((x) => x.campo).filter(existe);
  const principais = cabecalho.filter((c) => c !== "proprietary_id");
  const adicionais = cabecalho.filter((c) => c === "proprietary_id");
  const posEmpresa = principais.indexOf("empresa_id");
  const posTop = posEmpresa >= 0 ? posEmpresa + 1 : Math.min(2, principais.length);

  /* Rodapé: as abas do layout, na ordem, com os campos dele. A arrumação de cada aba segue a de hoje. */
  const VALOR_DA_ABA: Record<string, string> = { "Totais": "totais", "Financeiro": "financeiro", "Frete e transporte": "frete", "Fiscal": "fiscal", "Observações": "observacoes" };
  const usados = new Set<string>();
  const abas = estrutura.rodape.flatMap((a, i) => {
    const campos = a.campos.map((x) => x.campo).filter(existe);
    if (!campos.length) return [];
    const preferido = VALOR_DA_ABA[a.aba];
    const value = preferido && !usados.has(preferido) ? preferido : `aba-${i}`;
    usados.add(value);
    const especial = (c: string) => c === "installment_plan" || c === "condicao_pagamento_id";
    let content: React.ReactNode;
    if (campos.length === 1 && campos[0] === "note") content = <div className={estilosCv.painelLargo}>{render("note")}</div>;
    else if (campos.some(especial)) content = <div className={estilosCv.painelColuna}>{campos.map((c) => (especial(c) ? render(c) : <div key={c} style={larguraFixa}>{render(c)}</div>))}</div>;
    else if (campos.length >= 4) {
      const metade = Math.ceil(campos.length / 2);
      content = <div className={estilosCv.painelGrade}>
        <div className={estilosCv.painelColuna}>{campos.slice(0, metade).map(render)}</div>
        <div className={estilosCv.painelColuna}>{campos.slice(metade).map(render)}</div>
      </div>;
    } else content = <div className={estilosCv.painelColuna} style={larguraFixa}>{campos.map(render)}</div>;
    return [{ value, label: a.aba, content }];
  });
  const layoutDosItens = React.useMemo(() => (layout ? { colunas: layout.itens } : null), [layout]);

  return <>
    <CentralVendasWorkspace
      titulo={T[kind] ?? "Novo"}
      identidade={{ nome: T[kind] ?? "Novo documento", alterado: sujo, dica: kind === "sales" ? "O que a confirmação faz no estoque e no financeiro depende do Tipo de Operação e é mostrado antes de confirmar." : "Documento comercial sem efeito em estoque/financeiro até ser convertido em venda confirmada." }}
      acoes={<>
        {/* sem "Voltar": como no design, a barra só tem ações do documento; navegar é a barra de abas */}
        <AcaoDaBarra rotulo="Salvar" destaque="salvar" dica="inicio" ocupado={create.isPending} disabled={!escritaTopConfirmada || semClassificacao || layoutPendente || !h.client_id || !items.length || items.some((i) => !i.product_id)} onClick={submit}><Save aria-hidden /></AcaoDaBarra>
        <DivisorDaBarra />
        <AcaoDaBarra rotulo="Alterar operação" data-testid="top-alterar" onClick={alterarOperacao}><Repeat2 aria-hidden /></AcaoDaBarra>
      </>}
      acoesDireita={<DocumentosAbertos />}
      aviso={avisoDeLayout ? <>{avisoDeEscrita}{avisoDeLayout}</> : avisoDeEscrita}
      dados={<>
        {principais.slice(0, posTop).map(render)}
        {contextoOperacional}
        {principais.slice(posTop).map(render)}
        {adicionais.length > 0 && <>
          <button type="button" className={estilosCv.maisDados} aria-expanded={maisDados} aria-controls="dados-adicionais" onClick={() => setMaisDados((m) => !m)}>
            <ChevronRight aria-hidden /> Dados adicionais <span className={estilosCv.mudo}>· {adicionais.length} {adicionais.length === 1 ? "campo" : "campos"}</span>
          </button>
          {maisDados && <div id="dados-adicionais">
            {adicionais.map(render)}
          </div>}
        </>}
      </>}
      itens={<ItensDaCentral items={items} onChange={setItems} layout={layoutDosItens} erros={layout ? erros : undefined} />}
      abas={abas}
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
