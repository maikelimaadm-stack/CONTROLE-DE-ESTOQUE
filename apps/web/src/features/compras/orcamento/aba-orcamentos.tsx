"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MSG_PEDIDO_JA_TEM_VENCEDOR, MSG_VENCEDOR_PEDIDO_COM_COMPRA, MSG_VENCEDOR_SO_PEDIDO_ABERTO } from "@agro/domain";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { enumLabel } from "@/lib/copy";
import { brl, dateBR, num } from "@/lib/utils";
import { Button, ConfirmDialog, statusTone } from "@/components/ui";
import type { Row } from "@/features/docs/shared";
import { PainelLargo, Selo } from "@/features/central/painel";
import { DialogoCancelarDocumento } from "@/features/central/dialogos";
import type { AbaDoPainel } from "@/features/central/contrato";
import { varianteDeCompra } from "../variantes";
import { MOTIVO_VAZIO_DA_COMPRA, PREFIXO_CENTRAL_COMPRAS, corpoDoCancelamento } from "../central/adaptador";
import type { EstadoDaConsulta } from "../central/estado";
import {
  aprovadoParaOrcamento, invalidarLeiturasDeCompras, novaChaveDeIdempotencia, orcamentosDoPedido,
  type ChaveDeIdempotencia, type EstadoDaCapacidade, type OrcamentoDoPedido
} from "../pedido-e-orcamento";
import {
  ESPECIE_NO_CANCELAMENTO, TEXTO_DO_CANCELAMENTO_DO_ORCAMENTO, menoresPrecosDoItem, menoresTotais, precoNoOrcamento
} from "./estado-orcamento";

/**
 * OPERACOES-01 F6b (decisão 283) — A ABA "ORÇAMENTOS" DO PEDIDO DE COMPRA: a relação dos orçamentos (com o "Menor
 * total"), o mapa de preços por item (com o "menor" de cada linha), Escolher o vencedor, Cancelar e o aviso dos
 * orçamentos abertos de um pedido que não está mais aberto (M3).
 *
 * Usa SÓ o que a consulta do pedido já tem (`documento`, `situacao`, `ehPedido`, `comprasGeradas`, `id`) e as leituras
 * ESTRITAS do módulo comum (`orcamentosDoPedido`, `aprovadoParaOrcamento`). A aba aparece com a capacidade "sim", a
 * chave `orcamentos` na leitura (quem tem `orcamentos_compra.view`) e o pedido aprovado para orçamento OU com algum
 * orçamento — o pedido que não usa cotação mantém as abas de hoje.
 *
 * M3 (escolha da F6b, o comportamento de hoje): finalizar, receber ou cancelar o pedido NÃO mexe nos orçamentos dele
 * (sem cascata). A aba avisa e oferece Cancelar em cada orçamento aberto (a rota de cancelar de cada um).
 *
 * As comparações (menor total, menor preço) são DECIMAIS (`D`), com empate marcando todos; cancelados não entram. Tudo
 * é apresentação: quem decide se o vencedor pode ser escolhido é o servidor (a mesma regra, conferida na transação).
 */

const t = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const ehRegistro = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

export const MSG_ORCAMENTOS_VAZIO = "Nenhum orçamento deste pedido. Use “Novo orçamento” na barra.";
export const MSG_ORCAMENTOS_ABERTOS = "Este pedido não está mais aberto: os orçamentos abertos não podem ser escolhidos. Cancele-os.";

/** O texto do diálogo do vencedor: o que a API faz ao escolher (o desconto sai; a aprovação pode precisar ser refeita). */
export const descricaoDoVencedor = (fornecedor: string) => `O pedido passa a ter o fornecedor ${fornecedor}, os preços deste orçamento (sem o desconto dos itens) e a condição de pagamento dele — sem condição no orçamento, a do pedido fica. Os outros orçamentos abertos ficam não escolhidos. A escolha não se desfaz, e se o total do pedido subir a aprovação dele precisa ser feita de novo.`;

/** A aba do pedido, ou null (sem a capacidade "sim", sem a chave `orcamentos`, ou pedido nem aprovado para orçamento nem com orçamento). */
export function abaDosOrcamentos(e: EstadoDaConsulta, capacidade: EstadoDaCapacidade): AbaDoPainel | null {
  if (capacidade !== "sim" || !e.ehPedido) return null;
  const orcamentos = orcamentosDoPedido(e.documento);
  if (orcamentos === null) return null;
  if (aprovadoParaOrcamento(e.documento) === null && orcamentos.length === 0) return null;
  return {
    value: "orcamentos", label: "Orçamentos", contador: orcamentos.filter((o) => o.situacao !== "cancelado").length,
    content: <OrcamentosDoPedido e={e} orcamentos={orcamentos} />
  };
}

function OrcamentosDoPedido({ e, orcamentos }: { e: EstadoDaConsulta; orcamentos: OrcamentoDoPedido[] }) {
  const { can } = useAuth(); const qc = useQueryClient();
  const codigoDoPedido = t(e.documento?.["codigo"]);
  const segmentoDoPedido = varianteDeCompra("pedido")?.segmento ?? "pedidos";
  const segmentoDoOrcamento = varianteDeCompra("orcamento")?.segmento ?? "orcamentos";
  const pedidoAberto = e.situacao === "aberto";
  const comVencedor = orcamentos.some((o) => o.situacao === "escolhido");
  const comCompra = (e.comprasGeradas?.length ?? 0) > 0;
  /** Escolher muda os dois documentos: `pedidos_compra.edit` ∧ `orcamentos_compra.edit` (as portas da rota). */
  const escolhePelaCapacidade = can("pedidos_compra.edit") && can("orcamentos_compra.edit");
  const cancelaPelaCapacidade = can("orcamentos_compra.delete");
  /** Por que Escolher está desabilitado — as mesmas recusas da API, na mesma ordem (aberto → compra → vencedor). null = pode escolher. */
  const dicaDoEscolher = !pedidoAberto ? MSG_VENCEDOR_SO_PEDIDO_ABERTO : comCompra ? MSG_VENCEDOR_PEDIDO_COM_COMPRA : comVencedor ? MSG_PEDIDO_JA_TEM_VENCEDOR : null;

  /* A CHAVE DE IDEMPOTÊNCIA: uma por par pedido × orçamento (e por ação), trocada só quando o servidor RECUSA
     (`novaChaveDeIdempotencia`, a mesma regra da consulta). */
  const chaves = React.useRef(new Map<string, ChaveDeIdempotencia>());
  const chaveDe = (acao: string, orcamentoId: string): ChaveDeIdempotencia => {
    const k = `${acao}:${e.id}:${orcamentoId}`;
    const atual = chaves.current.get(k);
    if (atual) return atual;
    const nova = novaChaveDeIdempotencia();
    chaves.current.set(k, nova);
    return nova;
  };

  const [escolhendo, setEscolhendo] = React.useState<OrcamentoDoPedido | null>(null);
  const [cancelando, setCancelando] = React.useState<OrcamentoDoPedido | null>(null);
  const escolherM = useMutation({
    mutationFn: (o: OrcamentoDoPedido) => api(`/api/compras/${segmentoDoPedido}/${encodeURIComponent(e.id)}/orcamentos/${encodeURIComponent(o.id)}/escolher`,
      { method: "POST", body: {}, idempotencyKey: chaveDe("escolher", o.id).doEnvio({}) }),
    onSuccess: (_r, o) => { toast.success(`Orçamento ${o.codigo} escolhido como vencedor.`); setEscolhendo(null); },
    onError: (err, o) => { toast.error(chaveDe("escolher", o.id).depoisDoErro(err)); },
    onSettled: () => { void invalidarLeiturasDeCompras(qc); }
  });
  const cancelarM = useMutation({
    mutationFn: ({ o, motivo }: { o: OrcamentoDoPedido; motivo: string }) => {
      const corpo = corpoDoCancelamento(motivo);
      return api(`/api/compras/${segmentoDoOrcamento}/${encodeURIComponent(o.id)}/cancel`, { method: "POST", body: corpo, idempotencyKey: chaveDe("cancelar", o.id).doEnvio(corpo) });
    },
    onSuccess: () => { toast.success("Orçamento cancelado"); setCancelando(null); },
    onError: (err, { o }) => { toast.error(chaveDe("cancelar", o.id).depoisDoErro(err)); },
    onSettled: () => { void invalidarLeiturasDeCompras(qc); }
  });

  const menores = menoresTotais(orcamentos);
  const vivos = orcamentos.filter((o) => o.situacao !== "cancelado");
  const comMapa = vivos.length > 0 && vivos.every((o) => o.itens !== null);
  const itensLidos: unknown = e.documento?.["itens"];
  const itensDoPedido = Array.isArray(itensLidos) ? itensLidos.filter(ehRegistro) : [];
  const avisoDosAbertos = !pedidoAberto && orcamentos.some((o) => o.situacao === "aberto");

  return <PainelLargo><div data-testid="compras-orcamentos" className="space-y-3">
    {avisoDosAbertos && <p data-testid="compras-orcamentos-abertos-aviso" className="rounded-md bg-amber-50 p-2 text-[12.5px] text-amber-800">{MSG_ORCAMENTOS_ABERTOS}</p>}
    {orcamentos.length === 0
      ? <p data-testid="compras-orcamentos-vazio" className="text-[12.5px] text-slate-500">{MSG_ORCAMENTOS_VAZIO}</p>
      : <div data-testid="compras-orcamentos-relacao" className="overflow-x-auto rounded border">
        <table className="table-dense w-full text-[12.5px]">
          <caption className="sr-only">{`Orçamentos do pedido ${codigoDoPedido}`}</caption>
          <thead><tr>
            <th>Código</th><th>Fornecedor</th><th>Situação</th><th>Condição de pagamento</th>
            <th className="text-right">Prazo de entrega (dias)</th><th>Validade</th><th className="text-right">Total</th><th>Ações</th>
          </tr></thead>
          <tbody>{orcamentos.map((o) => {
            const aberto = o.situacao === "aberto";
            return <tr key={o.id} data-testid="compras-orcamento-linha" data-id={o.id} data-situacao={o.situacao}>
              <td><Link data-testid="compras-orcamento-link" className="text-brand-700 underline" href={`/compras/${segmentoDoOrcamento}/${encodeURIComponent(o.id)}`}>{o.codigo}</Link></td>
              <td>{o.fornecedorNome}</td>
              <td><Selo tom={statusTone(o.situacao, "situacao_documento_compra")} valor={o.situacao}>{enumLabel("situacao_documento_compra", o.situacao)}</Selo></td>
              <td>{o.condicao ? `${o.condicao.codigo} — ${o.condicao.nome}` : "—"}</td>
              <td className="num">{o.prazoEntregaDias === null ? "—" : String(o.prazoEntregaDias)}</td>
              <td>{dateBR(o.validadeOrcamento)}</td>
              <td className="num" data-testid="compras-orcamento-total">
                {brl(o.valorTotal)}
                {menores.has(o.id) && <span data-testid="compras-orcamento-menor-total" className="ml-1.5 rounded bg-emerald-50 px-1 text-[11px] font-semibold text-emerald-700">Menor total</span>}
              </td>
              <td><span className="inline-flex gap-1.5">
                {escolhePelaCapacidade && aberto && <Button size="sm" variant="outline" data-testid={`compras-orcamento-escolher-${o.id}`}
                  disabled={dicaDoEscolher !== null || escolherM.isPending} title={dicaDoEscolher ?? `Escolher o orçamento ${o.codigo} como vencedor`}
                  onClick={() => { if (dicaDoEscolher === null) setEscolhendo(o); }}>Escolher</Button>}
                {cancelaPelaCapacidade && aberto && <Button size="sm" variant="ghost" data-testid={`compras-orcamento-cancelar-${o.id}`}
                  disabled={cancelarM.isPending} title={`Cancelar o orçamento ${o.codigo}`} onClick={() => setCancelando(o)}>Cancelar</Button>}
              </span></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    {comMapa && <div data-testid="compras-orcamentos-mapa" className="space-y-1">
      <p className="text-[12px] font-semibold text-slate-700">Preço por item</p>
      <div className="overflow-x-auto rounded border">
        <table className="table-dense w-full text-[12.5px]">
          <caption className="sr-only">Preço por item</caption>
          <thead><tr>
            <th>Produto</th><th className="text-right">Quantidade</th>
            {vivos.map((o) => <th key={o.id} className="text-right" data-orcamento-id={o.id}>{`${o.codigo} · ${o.fornecedorNome}`}</th>)}
          </tr></thead>
          <tbody>{itensDoPedido.map((it) => {
            const itemId = t(it["id"]);
            const menorDaLinha = menoresPrecosDoItem(vivos, itemId);
            return <tr key={itemId} data-testid="compras-orcamentos-mapa-linha" data-item-id={itemId}>
              <td>{[t(it["produto_codigo"]), t(it["produto_nome"])].filter(Boolean).join(" — ")}</td>
              <td className="num">{num(t(it["quantidade"]), 4)}</td>
              {vivos.map((o) => {
                const preco = precoNoOrcamento(o, itemId);
                const menor = preco !== null && menorDaLinha.has(o.id);
                return <td key={o.id} className="num" data-testid="compras-orcamentos-mapa-celula" data-orcamento-id={o.id} data-menor={menor ? "true" : undefined}>
                  {preco === null ? "—" : brl(preco)}
                  {menor && <span className="ml-1.5 text-[11px] font-semibold text-emerald-700">menor</span>}
                </td>;
              })}
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>}

    <ConfirmDialog open={escolhendo !== null} onOpenChange={(aberto) => { if (!aberto) setEscolhendo(null); }}
      title={`Escolher o orçamento ${escolhendo?.codigo ?? ""} como vencedor?`} description={descricaoDoVencedor(escolhendo?.fornecedorNome ?? "")}
      confirmLabel="Escolher vencedor" loading={escolherM.isPending}
      onConfirm={() => { if (escolhendo && dicaDoEscolher === null) escolherM.mutate(escolhendo); }} />
    <DialogoCancelarDocumento prefixoTestid={PREFIXO_CENTRAL_COMPRAS} aberto={cancelando !== null} onFechar={() => setCancelando(null)}
      especie={ESPECIE_NO_CANCELAMENTO} codigo={cancelando?.codigo ?? ""} texto={TEXTO_DO_CANCELAMENTO_DO_ORCAMENTO} carregando={cancelarM.isPending}
      motivoVazio={MOTIVO_VAZIO_DA_COMPRA} onCancelar={(motivo) => { if (cancelando) cancelarM.mutate({ o: cancelando, motivo }); }} />
  </div></PainelLargo>;
}
