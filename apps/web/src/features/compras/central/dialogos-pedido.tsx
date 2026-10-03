"use client";
import { ConfirmDialog, LoadingState } from "@/components/ui";
import { DialogoConfirmar } from "@/features/central/dialogos";
import { usePreviaDaFinalizacaoPedido, type PreviaDaFinalizacaoPedido, type SituacaoDaAprovacaoNaPrevia } from "../previa-finalizacao-pedido";

/**
 * OS DIÁLOGOS DO PEDIDO DE COMPRA (OPERACOES-01 F6b, decisão 283) — Finalizar e Aprovar para orçamento.
 *
 * As cascas são as oficiais: Finalizar sobre o `DialogoConfirmar` do motor (como o Confirmar compra), Aprovar para
 * orçamento sobre o `ConfirmDialog` de `@/components/ui`. Aqui moram o texto e a PRÉVIA da finalização; a escrita (o POST
 * com corpo vazio e Idempotency-Key), quando cada diálogo abre e o que acontece depois moram no estado
 * (`useEstadoDaConsulta`). Só aparecem com a capacidade `finalizacaoEOrcamento` declarada pelo servidor.
 */

/** A linha da aprovação na prévia, pela situação que o servidor calculou (a mesma conta do finalizar). */
const TEXTO_DA_APROVACAO: Readonly<Record<SituacaoDaAprovacaoNaPrevia, string>> = Object.freeze({
  nao_exigida: "Esta operação não exige aprovação para finalizar.",
  pendente: "Aguardando aprovação: o pedido está na fila de Aprovações.",
  aprovado: "Aprovado.",
  reprovado: "Reprovado: o pedido só é finalizado depois de uma aprovação nova."
});

/** FINALIZAR PEDIDO DE COMPRA <código>? — a prévia do servidor; carregando ou com recusa prevista, o botão trava. */
export function DialogoFinalizarPedido({ id, aberto, onFechar, codigo, carregando, onFinalizar }: {
  id: string; aberto: boolean; onFechar: () => void; codigo: string; carregando: boolean; onFinalizar: () => void;
}) {
  const estado = usePreviaDaFinalizacaoPedido(id, aberto);
  const bloqueado = estado.situacao === "carregando" || (estado.situacao === "pronta" && !estado.previa.podeFinalizar);
  return <DialogoConfirmar aberto={aberto} onFechar={onFechar} rotulo="Finalizar pedido de compra" codigo={codigo} carregando={carregando}
    confirmarDesabilitado={bloqueado} onConfirmar={onFinalizar}>
    <div data-testid="compras-previa-finalizacao" data-situacao={estado.situacao}>
      {estado.situacao === "carregando" && <LoadingState label="Conferindo o pedido…" />}
      {estado.situacao === "indisponivel" && <p className="text-[12.5px] text-amber-700" data-testid="compras-previa-finalizacao-indisponivel">A prévia da finalização não está disponível neste servidor. A finalização continua conferida pelo servidor.</p>}
      {estado.situacao === "erro" && <p className="text-[12.5px] text-red-700" data-testid="compras-previa-finalizacao-erro">{estado.mensagem}</p>}
      {estado.situacao === "pronta" && <CorpoDaPreviaDaFinalizacao previa={estado.previa} />}
    </div>
  </DialogoConfirmar>;
}

function CorpoDaPreviaDaFinalizacao({ previa }: { previa: PreviaDaFinalizacaoPedido }) {
  return <div className="space-y-3 text-[12.5px]">
    <p className="text-slate-600">Finalizar confirma o pedido de compra: ele não volta a aberto. Não mexe em estoque, e os orçamentos abertos continuam abertos. Se esta operação provisiona contas a pagar, os títulos previstos nascem agora.</p>
    {previa.aprovacao && <p data-testid="compras-previa-finalizacao-aprovacao" data-situacao={previa.aprovacao.situacao} className="text-slate-600">
      {TEXTO_DA_APROVACAO[previa.aprovacao.situacao]}
    </p>}
    {previa.recusas.length > 0 && <ul data-testid="compras-previa-finalizacao-recusas" className="space-y-0.5 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
      {previa.recusas.map((r, i) => <li key={i}>{r.message}</li>)}
    </ul>}
  </div>;
}

/** APROVAR O PEDIDO <código> PARA ORÇAMENTO? — registra quem e quando, e não se desfaz. */
export function DialogoAprovarParaOrcamento({ aberto, onFechar, codigo, carregando, onAprovar }: {
  aberto: boolean; onFechar: () => void; codigo: string; carregando: boolean; onAprovar: () => void;
}) {
  return <ConfirmDialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} title={`Aprovar o pedido ${codigo} para orçamento?`}
    description="O pedido passa a receber orçamentos de compra, um por fornecedor. A aprovação para orçamento fica registrada com quem aprovou e quando, e não se desfaz."
    confirmLabel="Aprovar para orçamento" loading={carregando} onConfirm={onAprovar} />;
}
