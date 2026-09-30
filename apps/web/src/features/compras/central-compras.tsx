"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, ERRO_EXIGENCIA_NAO_ATENDIDA } from "@agro/domain";
import { api, ApiError, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useTradutor } from "@/lib/i18n";
import { brl, todayISO } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { Button, Card, CardBody, CardHeader, Field, Input, LoadingState, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect, type BuscaDeOpcoes, type Option } from "@/components/ui/ref-select";
import { ItemsEditor, PlanEditor, defaultPlan, totalDaLinhaExibido, useEmpresaPadrao, type ItemRow, type Plan } from "@/features/docs/shared";
import { CampoTipoOperacao, podeLancar } from "@/features/sales/tipo-operacao-select";
import { useTopsDaEspecie, varianteDeCompra, type VarianteDeCompra } from "./variantes";
import { useRecebimentoDoPedido } from "./receber-pedido";
import { acompanharDescontoDaOrigem, cabecalhoDoPedido, linhasDoRecebimento } from "./recebimento-linhas";
import { rotaDoDocumento } from "./documentos-compra-list";

/**
 * A CENTRAL DE COMPRAS — o lançamento de um Pedido de compra ou de uma Compra (COMPRAS-01, decisão 267).
 *
 * ┌─ O QUE FOI COPIADO E O QUE FOI REUSADO ────────────────────────────────────────────────────────┐
 * │ A Central de Vendas (`app/(app)/vendas/[kind]/new`) é presa à venda em cada campo (cliente,      │
 * │ `/api/sales`, layout do documento, cliente em atraso, reserva). Parametrizá-la mudaria vendas;   │
 * │ por isso esta Central é PRÓPRIA, no formato simples dos documentos de estoque, e reusa só as     │
 * │ peças genéricas que não mudam: o editor de itens e o de parcelas (`features/docs/shared`), o    │
 * │ campo e a descoberta de TOP (`features/sales/tipo-operacao-select`, que não conhece a porta).    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A TOP da URL é PEDIDO: vale só se estiver na lista que o servidor devolve para AQUELA espécie. Totais,
 * código e número são do servidor; o total aqui é apresentação. O contrato do POST é estrito (chave
 * desconhecida → 422): o corpo leva só as chaves do contrato, e campo vazio não viaja.
 *
 * ┌─ MODO RECEBER PEDIDO (COMPRAS-02, decisão 268) ────────────────────────────────────────────────────────┐
 * │ `/compras/compras/new?tipo_operacao_id=…&pedido=…` — a MESMA Central, aberta pelos Próximos passos do     │
 * │ pedido. Receber é lançar uma compra COM ORIGEM, e a API tem uma porta própria para isso                  │
 * │ (`POST /api/compras/pedidos/:id/convert`) que chama a MESMA função de lançar compra. O que muda aqui:    │
 * │ a TOP é a do passo escolhido (conferida contra o leque do pedido, não contra a lista de TOPs da espécie); │
 * │ fornecedor, empresa e produto vêm do pedido, travados (o corpo nem os leva); os itens são os do pedido    │
 * │ com saldo, e a quantidade vai até o saldo — travada quando a aresta não é "Em partes". O resto do         │
 * │ formulário é o de sempre: nota, série, data de entrada, armazém, lote e validade a pessoa informa.        │
 * │ Pedido que não pode ser recebido agora (fechado, TOP fora do leque, API anterior) não vira formulário:   │
 * │ a Central diz por quê, e o Salvar não aparece habilitado.                                               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
type Cabecalho = {
  empresa_id: string; fornecedor_id: string; transportadora_id: string; data_documento: string; data_entrada: string;
  data_vencimento: string; numero_nota: string; serie_nota: string; categoria_financeira_id: string; centro_custo_id: string;
  condicao_pagamento_id: string; forma_pagamento_id: string; frete: string; outras_despesas: string; desconto: string; observacao: string;
};

const vazio = (v: string) => v.trim() === "";
const opcional = (v: string) => (vazio(v) ? undefined : v.trim());

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Os erros de campo que o servidor devolveu, por caminho: `details: [{ path, message }]` (validação),
 * `details.exigencias: [{ caminho, mensagem }]` (regras da operação) e `details.campo` (condição não permitida).
 */
function errosDoServidor(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  if (e.code === ERRO_EXIGENCIA_NAO_ATENDIDA && ehObj(e.details) && Array.isArray(e.details.exigencias)) {
    const out: Record<string, string> = {};
    for (const x of e.details.exigencias as unknown[]) if (ehObj(x) && typeof x.caminho === "string" && typeof x.mensagem === "string") out[x.caminho] = x.mensagem;
    return out;
  }
  if (e.code === ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA) return { [ehObj(e.details) && typeof e.details.campo === "string" ? e.details.campo : "condicao_pagamento_id"]: e.message };
  if (!Array.isArray(e.details)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details as unknown[]) {
    if (typeof d === "object" && d !== null && typeof (d as { path?: unknown }).path === "string" && typeof (d as { message?: unknown }).message === "string") {
      out[(d as { path: string }).path] = (d as { message: string }).message;
    }
  }
  return out;
}

/** Resposta de `/api/compras/{seg}/regras-da-operacao` conferida; forma estranha = `null` (nenhum asterisco a mais). */
interface RegrasDaCompra { exigencias: string[]; condicoesPermitidas: string[] | null; geraTitulos: boolean | null }
function lerRegras(v: unknown): RegrasDaCompra | null {
  if (!ehObj(v) || !Array.isArray(v.exigencias) || !v.exigencias.every((x) => typeof x === "string")) return null;
  const cp = v.condicoesPermitidas;
  if (cp !== null && cp !== undefined && !(Array.isArray(cp) && cp.every((x) => typeof x === "string"))) return null;
  return { exigencias: v.exigencias as string[], condicoesPermitidas: (cp as string[] | null | undefined) ?? null, geraTitulos: typeof v.geraTitulos === "boolean" ? v.geraTitulos : null };
}
function useRegrasDaCompra(segmento: string, top: string, ativo: boolean): RegrasDaCompra | null {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["compras-regras-da-operacao", segmento, top],
    queryFn: () => api<unknown>(`/api/compras/${segmento}/regras-da-operacao?tipo_operacao_id=${encodeURIComponent(top)}`),
    enabled: ativo && Boolean(top), retry: false
  });
  return React.useMemo(() => (ativo && q.data !== undefined ? lerRegras(q.data) : null), [ativo, q.data]);
}

/** Natureza de DESPESA para compra: analítica, do tipo despesa OU receita e despesa (a mesma régua da API). */
const opcoesDeNaturezaDeDespesa: BuscaDeOpcoes = {
  chave: "compras-natureza-despesa",
  buscar: async (search) => {
    const uma = (nature: string) => api<Option[]>(`/api/resources/financial_categories/options?${new URLSearchParams({ kind: "analytic", nature, ...(search ? { search } : {}) }).toString()}`);
    const [despesa, ambas] = await Promise.all([uma("expense"), uma("both")]);
    return [...despesa, ...ambas].sort((a, b) => String(a.code ?? a.label).localeCompare(String(b.code ?? b.label), "pt-BR", { numeric: true }));
  }
};

/** Controle de lote de cada produto (cadastro); desconhecido = campos abertos (o servidor é quem recusa). */
function useControleDeLote(produtos: string[]): (produtoId: string) => { lote: boolean; validade: boolean } {
  const unicos = Array.from(new Set(produtos.filter(Boolean)));
  const qs = useQueries({ queries: unicos.map((id) => ({ queryKey: ["compras-produto-lote", id], queryFn: () => api<Record<string, unknown>>(`/api/resources/products/${id}`), staleTime: 60_000, retry: false })) });
  const mapa = new Map<string, string>();
  unicos.forEach((id, i) => { const c = qs[i]?.data?.["controle_lote"]; if (typeof c === "string") mapa.set(id, c); });
  return (produtoId) => {
    const c = mapa.get(produtoId);
    if (c === undefined) return { lote: true, validade: true };
    return { lote: c !== "nenhum", validade: c === "lote_validade" };
  };
}

export function CentralDeCompras({ variante }: { variante: VarianteDeCompra }) {
  const router = useRouter(); const sp = useSearchParams(); const tr = useTradutor(); const qc = useQueryClient();
  const { can } = useAuth();
  const ehCompra = variante.variante === "compra";
  const empresaPadrao = useEmpresaPadrao();
  const pedidaNaUrl = sp.get("tipo_operacao_id") ?? "";
  // RECEBER PEDIDO só existe na COMPRA: `pedido` na URL de outra espécie não muda nada (é o lançamento de sempre).
  const pedidoId = ehCompra ? sp.get("pedido") ?? "" : "";
  const recebimento = useRecebimentoDoPedido(pedidoId, pedidaNaUrl, variante.variante);
  const modoReceber = recebimento.situacao !== "inativo";
  const recebendo = recebimento.situacao === "pronto" ? recebimento : null;
  // No modo receber a lista de TOPs da espécie não é perguntada: a TOP é a do passo, e o leque do pedido a conferiu.
  const estado = useTopsDaEspecie(variante.segmento, can(`${variante.perm}.create`) && !modoReceber);
  const [top, setTop] = React.useState("");
  // A TOP da URL só é aceita se o servidor a listou para esta espécie; sem ela, o padrão do cadastro (se houver).
  React.useEffect(() => {
    if (modoReceber || !podeLancar(estado) || top) return;
    const naLista = estado.dados.items.some((i) => i.id === pedidaNaUrl);
    const escolha = naLista ? pedidaNaUrl : estado.dados.defaultId;
    if (escolha) setTop(escolha);
  }, [modoReceber, estado, top, pedidaNaUrl]);
  const topRecusada = !modoReceber && podeLancar(estado) && !!pedidaNaUrl && !estado.dados.items.some((i) => i.id === pedidaNaUrl);

  const [h, setH] = React.useState<Cabecalho>({
    empresa_id: "", fornecedor_id: "", transportadora_id: "", data_documento: todayISO(), data_entrada: "", data_vencimento: "",
    numero_nota: "", serie_nota: "", categoria_financeira_id: "", centro_custo_id: "", condicao_pagamento_id: "", forma_pagamento_id: "",
    frete: "0", outras_despesas: "0", desconto: "0", observacao: ""
  });
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresaPadrao })); }, [empresaPadrao]);
  const mudar = (p: Partial<Cabecalho>) => setH((o) => ({ ...o, ...p }));
  const [itens, setItensCru] = React.useState<ItemRow[]>([]);
  // No modo receber, o desconto em valor acompanha a quantidade (na proporção do pedido) até a pessoa mexer nele.
  const setItens = (novos: ItemRow[]) => setItensCru((antes) => (modoReceber ? acompanharDescontoDaOrigem(antes, novos) : novos));
  const [ajustarParcelas, setAjustarParcelas] = React.useState(false);
  const [plano, setPlano] = React.useState<Plan>(defaultPlan());
  const [erros, setErros] = React.useState<Record<string, string>>({});

  /**
   * O PEDIDO PREENCHE A CENTRAL UMA VEZ, quando fica pronto. Depois disso o formulário é da pessoa: uma nova leitura
   * do pedido (foco na janela, invalidação) não pode apagar o que ela já digitou.
   */
  const preenchidoDe = React.useRef("");
  React.useEffect(() => {
    // A chave é o PEDIDO e o PASSO: outro passo do mesmo pedido (outra TOP, outra regra de partes) preenche de novo.
    const chaveDoPreenchimento = recebendo ? `${pedidoId}|${recebendo.passo.tipoOperacaoId}` : "";
    if (!recebendo || preenchidoDe.current === chaveDoPreenchimento) return;
    preenchidoDe.current = chaveDoPreenchimento;
    const p = recebendo.pedido;
    setTop(recebendo.passo.tipoOperacaoId);
    setH((o) => ({ ...o, empresa_id: String(p["empresa_id"] ?? ""), fornecedor_id: String(p["fornecedor_id"] ?? ""), ...cabecalhoDoPedido(p) }));
    setItensCru(linhasDoRecebimento(p.itens));
  }, [recebendo, pedidoId]);

  const totalItens = itens.reduce((a, it) => a + totalDaLinhaExibido(it), 0);
  const totalExibido = totalItens + Number(h.frete || 0) + Number(h.outras_despesas || 0) - Number(h.desconto || 0);

  /** O que o lançamento comum e o recebimento têm em comum: tudo, menos empresa, fornecedor e produto. */
  const cabecalhoDoCorpo = () => ({
    tipo_operacao_id: top,
    transportadora_id: opcional(h.transportadora_id),
    data_documento: h.data_documento,
    data_vencimento: opcional(h.data_vencimento),
    ...(ehCompra ? { data_entrada: opcional(h.data_entrada), numero_nota: opcional(h.numero_nota), serie_nota: opcional(h.serie_nota) } : {}),
    categoria_financeira_id: opcional(h.categoria_financeira_id),
    centro_custo_id: opcional(h.centro_custo_id),
    condicao_pagamento_id: opcional(h.condicao_pagamento_id),
    ...(ajustarParcelas ? { plano_parcelas: plano } : {}),
    forma_pagamento_id: opcional(h.forma_pagamento_id),
    frete: opcional(h.frete),
    outras_despesas: opcional(h.outras_despesas),
    desconto: opcional(h.desconto),
    observacao: opcional(h.observacao)
  });
  const camposDoItem = (i: ItemRow) => ({
    armazem_id: opcional(i.warehouse_id ?? ""),
    quantidade: i.quantity,
    valor_unitario: i.unit_value || "0",
    desconto: opcional(i.discount ?? ""),
    desconto_percentual: opcional(i.discount_percent ?? ""),
    ...(ehCompra ? { lote: opcional(i.provider_lot ?? ""), validade: opcional(i.expiration_date ?? "") } : {})
  });
  /**
   * O corpo do POST. No recebimento é o contrato do `/convert`: SEM empresa e SEM fornecedor (vêm do pedido), e cada
   * item com `item_origem_id` no lugar de `produto_id` (o produto vem do item do pedido). Mandar as chaves do
   * lançamento comum ali seria 422 — o contrato é estrito, e ainda bem.
   */
  const corpo = () => (modoReceber
    ? { ...cabecalhoDoCorpo(), itens: itens.map((i) => ({ item_origem_id: String(i["item_origem_id"] ?? ""), ...camposDoItem(i) })) }
    : { empresa_id: h.empresa_id, fornecedor_id: h.fornecedor_id, ...cabecalhoDoCorpo(), itens: itens.map((i) => ({ produto_id: i.product_id, ...camposDoItem(i) })) });

  /** A porta do POST: a da espécie, ou a do recebimento do pedido. O retorno das duas é o documento criado (`id`). */
  const segmentoDoPedido = varianteDeCompra("pedido")?.segmento ?? "";
  const porta = modoReceber ? `/api/compras/${segmentoDoPedido}/${pedidoId}/convert` : `/api/compras/${variante.segmento}`;

  // Uma chave de idempotência por TENTATIVA de lançamento; renovada só depois de uma recusa.
  const chave = React.useRef(newIdem());
  const salvar = useMutation({
    mutationFn: () => api<{ id: string }>(porta, { method: "POST", body: corpo(), idempotencyKey: chave.current }),
    onSuccess: (r) => { toast.success("Salvo com sucesso"); void qc.invalidateQueries(); router.push(`/compras/${variante.segmento}/${r.id}`); },
    onError: (e) => { chave.current = newIdem(); setErros(errosDoServidor(e)); toast.error((e as Error).message); }
  });

  const regras = useRegrasDaCompra(variante.segmento, top, modoReceber ? Boolean(recebendo) && !!top : pronto0(estado, top));
  const exigidos = new Set(regras?.exigencias ?? []);
  // Compra que gera contas a pagar exige natureza e centro (a API recusa no campo); pedido não gera título.
  const classificacaoObrigatoria = ehCompra && regras?.geraTitulos === true;
  const obrig = (c: string) => exigidos.has(c) || ((c === "categoria_financeira_id" || c === "centro_custo_id") && classificacaoObrigatoria);
  const loteDoProduto = useControleDeLote(ehCompra ? itens.map((i) => i.product_id) : []);
  // Produto que deixou de controlar lote/validade não leva o valor digitado antes (evita a recusa do item).
  React.useEffect(() => {
    if (!ehCompra) return;
    let mudou = false;
    const novos = itens.map((it) => {
      const c = loteDoProduto(it.product_id);
      const lote = c.lote ? it.provider_lot : ""; const validade = c.validade ? it.expiration_date : "";
      if ((it.provider_lot ?? "") !== (lote ?? "") || (it.expiration_date ?? "") !== (validade ?? "")) { mudou = true; return { ...it, provider_lot: lote, expiration_date: validade }; }
      return it;
    });
    if (mudou) setItens(novos);
  });
  const erro = (c: string) => erros[c];
  const errosDeItens = Object.entries(erros).filter(([c]) => c.startsWith("itens"));
  const pronto = modoReceber ? Boolean(recebendo) && !!top : pronto0(estado, top) && !topRecusada;
  const rotuloDoPedido = enumLabel("especie_documento_compra", "pedido");
  const codigoDoPedido = recebendo ? String(recebendo.pedido["codigo"] ?? "") : "";
  const titulo = modoReceber ? `Receber ${rotuloDoPedido.toLowerCase()} ${codigoDoPedido}`.trim() : `Novo documento · ${tr(variante.chaveI18n)}`;
  // Sem o pedido pronto não há formulário a mostrar: só a faixa do recebimento, dizendo o que falta.
  const mostrarFormulario = !modoReceber || Boolean(recebendo);
  const emPartes = recebendo?.passo.emPartes === true;

  return <Card data-testid="compras-central" data-especie={variante.variante} data-modo={modoReceber ? "receber" : "lancar"}>
    <CardHeader title={titulo} actions={<>
      {/* No recebimento, voltar é voltar ao PEDIDO: foi de lá que a pessoa veio, pelos Próximos passos. */}
      <Button variant="outline" size="sm" onClick={() => router.push(modoReceber ? rotaDoDocumento({ id: pedidoId, especie: "pedido" }) : "/compras?tab=documentos")}>Voltar</Button>
      <Button size="sm" data-testid="compras-salvar" loading={salvar.isPending} disabled={!pronto || !itens.length || salvar.isPending} onClick={() => { setErros({}); salvar.mutate(); }}>Salvar</Button>
    </>} />
    <CardBody className="space-y-4">
      {topRecusada && <p data-testid="compras-top-recusada" className="text-sm text-amber-700">O Tipo de Operação pedido não está disponível para {tr(variante.chaveI18n)}. Escolha outro.</p>}
      {modoReceber && <div data-testid="compras-central-receber" data-pedido-id={pedidoId} data-situacao={recebimento.situacao} data-em-partes={recebendo ? String(emPartes) : undefined} className="space-y-1 text-[12.5px] text-slate-700">
        {recebimento.situacao === "carregando" && <LoadingState variant="compact" label="Carregando o pedido de compra…" />}
        {recebimento.situacao === "recusado" && <p data-testid="compras-receber-recusado" className="text-sm text-amber-700">{recebimento.mensagem}</p>}
        {recebendo && <>
          <p>
            Recebendo o <Link className="text-brand-700 underline" data-testid="compras-receber-pedido" href={rotaDoDocumento({ id: pedidoId, especie: "pedido" })}>{rotuloDoPedido.toLowerCase()} {codigoDoPedido}</Link>
            {" "}pela operação <span className="font-mono font-semibold">{recebendo.passo.codigo}</span> — {recebendo.passo.nome}.
          </p>
          <p className="text-slate-500" data-testid="compras-receber-regra">
            {emPartes
              ? "Em partes: escolha os itens e as quantidades desta compra, cada uma até o saldo do item."
              : "Esta operação recebe o pedido inteiro: cada item com o saldo, sem mudar a quantidade."}
            {" "}Fornecedor, empresa e produto vêm do pedido. Valor unitário e descontos também, e podem mudar: valem os da nota.
          </p>
        </>}
      </div>}
      {mostrarFormulario && <>
      <div className="grid grid-cols-12 gap-3">
        {recebendo
          ? <Field label="Tipo de Operação" required span={4}>
            <Input data-testid="compras-receber-top" readOnly disabled value={`${recebendo.passo.codigo} — ${recebendo.passo.nome}`} />
            <span className="mt-1 block text-xs text-slate-500">Movimento: {recebendo.passo.familiaRotulo}</span>
          </Field>
          : <CampoTipoOperacao estado={estado} valor={top} onChange={setTop} span={4} />}
        <Field label="Empresa" required span={4} error={erro("empresa_id")}><RefSelect resource="empresas" value={h.empresa_id} disabled={modoReceber || undefined} allowEmpty={!modoReceber}
          labelHint={recebendo ? String(recebendo.pedido["empresa_nome"] ?? "") || null : undefined} onChange={(v) => mudar({ empresa_id: v ?? "" })} /></Field>
        <Field label="Fornecedor" required span={4} error={erro("fornecedor_id")}><RefSelect resource="people" value={h.fornecedor_id} disabled={modoReceber || undefined} allowEmpty={!modoReceber}
          labelHint={recebendo ? String(recebendo.pedido["fornecedor_nome"] ?? "") || null : undefined} onChange={(v) => mudar({ fornecedor_id: v ?? "" })} filter={{ is_provider: "true" }} /></Field>
        <Field label="Data do documento" required span={2} error={erro("data_documento")}><Input data-testid="compras-data-documento" type="date" value={h.data_documento} onChange={(e) => mudar({ data_documento: e.target.value })} /></Field>
        {ehCompra && <Field label="Data de entrada" span={2} error={erro("data_entrada")}><Input data-testid="compras-data-entrada" type="date" value={h.data_entrada} onChange={(e) => mudar({ data_entrada: e.target.value })} /></Field>}
        <Field label="Vencimento" span={2} error={erro("data_vencimento")}><Input data-testid="compras-data-vencimento" type="date" value={h.data_vencimento} onChange={(e) => mudar({ data_vencimento: e.target.value })} /></Field>
        {ehCompra && <Field label="Número da nota" span={2} error={erro("numero_nota")}><Input data-testid="compras-numero-nota" value={h.numero_nota} onChange={(e) => mudar({ numero_nota: e.target.value })} /></Field>}
        {ehCompra && <Field label="Série" span={1} error={erro("serie_nota")}><Input data-testid="compras-serie-nota" value={h.serie_nota} onChange={(e) => mudar({ serie_nota: e.target.value })} /></Field>}
        <Field label="Transportadora" required={obrig("transportadora_id")} span={3} error={erro("transportadora_id")}><RefSelect resource="people" value={h.transportadora_id} onChange={(v) => mudar({ transportadora_id: v ?? "" })} filter={{ is_transporter: "true" }} /></Field>
        <Field label="Natureza de despesa" required={obrig("categoria_financeira_id")} span={3} error={erro("categoria_financeira_id")}><RefSelect resource="financial_categories" value={h.categoria_financeira_id} onChange={(v) => mudar({ categoria_financeira_id: v ?? "" })} buscarOpcoes={opcoesDeNaturezaDeDespesa} /></Field>
        <Field label="Centro de resultado" required={obrig("centro_custo_id")} span={3} error={erro("centro_custo_id")}><RefSelect resource="cost_centers" value={h.centro_custo_id} onChange={(v) => mudar({ centro_custo_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field>
        <Field label="Condição de pagamento" span={3} error={erro("condicao_pagamento_id")}><RefSelect resource="condicoes_pagamento" somenteIds={regras?.condicoesPermitidas ?? null} value={h.condicao_pagamento_id} onChange={(v) => mudar({ condicao_pagamento_id: v ?? "" })} /></Field>
        <Field label="Forma de pagamento" span={3} error={erro("forma_pagamento_id")}><RefSelect resource="payment_methods" value={h.forma_pagamento_id} onChange={(v) => mudar({ forma_pagamento_id: v ?? "" })} /></Field>
        <Field label="Frete" span={2} error={erro("frete")}><Input data-testid="compras-frete" type="number" step="0.01" min="0" value={h.frete} onChange={(e) => mudar({ frete: e.target.value })} /></Field>
        <Field label="Outras despesas" span={2} error={erro("outras_despesas")}><Input data-testid="compras-outras-despesas" type="number" step="0.01" min="0" value={h.outras_despesas} onChange={(e) => mudar({ outras_despesas: e.target.value })} /></Field>
        <Field label="Desconto" span={2} error={erro("desconto")}><Input data-testid="compras-desconto" type="number" step="0.01" min="0" value={h.desconto} onChange={(e) => mudar({ desconto: e.target.value })} /></Field>
        <Field label="Parcelas" span={3} error={erro("plano_parcelas")}>
          <NativeSelect data-testid="compras-parcelas" value={ajustarParcelas ? "ajustar" : "padrao"} onChange={(e) => setAjustarParcelas(e.target.value === "ajustar")}>
            <option value="padrao">Pela condição (ou à vista)</option>
            <option value="ajustar">Ajustar parcelas</option>
          </NativeSelect>
        </Field>
        <Field label="Observação" required={obrig("observacao")} span={12} error={erro("observacao")}><Textarea data-testid="compras-observacao" value={h.observacao} onChange={(e) => mudar({ observacao: e.target.value })} /></Field>
      </div>
      {ajustarParcelas && <div data-testid="compras-plano"><PlanEditor plan={plano} onChange={setPlano} /></div>}
      <div data-testid="compras-itens">
        <ItemsEditor items={itens} onChange={setItens} loteDaLinha={ehCompra ? (it) => loteDoProduto(it.product_id) : undefined}
          daOrigem={modoReceber ? { saldo: (it) => String(it["saldo"] ?? "0"), quantidadeTravada: !emPartes, testIdDaLinha: (it) => `compras-receber-item-${String(it["item_origem_id"] ?? "")}` } : undefined}
          fields={ehCompra ? ["warehouse", "product", "quantity", "unit_value", "discount", "discount_percent", "lot", "expiration"] : ["warehouse", "product", "quantity", "unit_value", "discount", "discount_percent"]} />
        {errosDeItens.length > 0 && <ul data-testid="compras-erros-itens" className="mt-2 space-y-0.5 text-[12px] text-red-700">
          {errosDeItens.map(([c, m]) => <li key={c}>{descreverCaminhoDeItem(c)}: {m}</li>)}
        </ul>}
      </div>
      <div className="text-right text-sm font-semibold" data-testid="compras-total">Total do documento: {brl(totalExibido)}</div>
      </>}
    </CardBody>
  </Card>;
}

function pronto0(estado: ReturnType<typeof useTopsDaEspecie>, top: string): boolean { return podeLancar(estado) && !!top; }

const ROTULO_DO_CAMPO_DO_ITEM: Record<string, string> = {
  produto_id: "produto", item_origem_id: "item do pedido", armazem_id: "armazém", quantidade: "quantidade", valor_unitario: "valor unitário",
  desconto: "desconto", desconto_percentual: "desconto %", lote: "lote", validade: "validade"
};

/** `itens.0.lote` / `itens[0].lote` → "Item 1 · lote". */
function descreverCaminhoDeItem(caminho: string): string {
  const m = /^itens(?:\.|\[)(\d+)\]?(?:\.([a-z_]+))?$/.exec(caminho);
  if (!m) return "Itens";
  const n = Number(m[1]) + 1;
  return m[2] ? `Item ${n} · ${ROTULO_DO_CAMPO_DO_ITEM[m[2]] ?? m[2]}` : `Item ${n}`;
}
