"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { api, newIdem } from "@/lib/api";
import { toast } from "@/lib/toast";
import { brl, dateBR, num } from "@/lib/utils";
import { LoadingState } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";
import { DialogoCancelarDocumento as DialogoCancelarDoMotor, DialogoConfirmar } from "@/features/central/dialogos";
import { DialogoEncerrarSaldo } from "@/features/sales/faturar-em-partes";
import { usePreviaDaConfirmacaoCompra, type PreviaDaConfirmacaoCompra } from "../previa-confirmacao-compra";
import { MOTIVO_VAZIO_DA_COMPRA, PREFIXO_CENTRAL_COMPRAS, corpoDoCancelamento } from "./adaptador";

/**
 * OS DIÁLOGOS DA CENTRAL DE COMPRAS (VISUAL-UX-04, decisão 276).
 *
 * A casca é a do motor (`@/features/central/dialogos`, sobre o `Dialog` oficial). Aqui moram o texto da compra,
 * a prévia da confirmação de hoje (recusas, entrada no estoque, parcelas a pagar) e as duas escritas:
 * - Confirmar: POST /api/compras/compras/<id>/confirm, corpo vazio, Idempotency-Key.
 * - Cancelar: POST /api/compras/<seg>/<id>/cancel, `{ motivo }` aparado 1–500 ou `{}` vazio, Idempotency-Key;
 *   a recusa (409 inclusive) mostra a mensagem do servidor.
 * Encerrar saldo continua o diálogo de hoje (motivo obrigatório).
 */

export { DialogoDescartar } from "@/features/central/dialogos";
export { DialogoEncerrarSaldo };

/** O texto de efeito de hoje, por situação do documento. */
export function textoDoCancelamentoDeCompra(situacao: string): string {
  return situacao === "confirmado"
    ? "A compra confirmada é estornada: a entrada sai do estoque e as contas a pagar são canceladas. Conta com baixa precisa ter a baixa cancelada antes."
    : "O documento passa a cancelado e não pode mais ser confirmado.";
}

/** O texto do Encerrar saldo do pedido (o de hoje). */
export const DESCRICAO_ENCERRAR_SALDO_DO_PEDIDO =
  "O saldo que falta receber deixa de poder ser recebido, e o pedido passa a convertido. As compras já geradas não mudam.";

const mensagemDoErro = (e: unknown) => (e instanceof Error && e.message ? e.message : "Não foi possível concluir a operação.");

/** CONFIRMAR COMPRA — corpo vazio; a chave de idempotência renova só depois de erro. */
export function useConfirmarCompra(id: string, onSucesso: () => void) {
  const chave = React.useRef(newIdem());
  return useMutation({
    mutationFn: () => api(`/api/compras/compras/${id}/confirm`, { method: "POST", idempotencyKey: chave.current }),
    onSuccess: () => { chave.current = newIdem(); toast.success("Compra confirmada"); onSucesso(); },
    onError: (e) => { chave.current = newIdem(); toast.error(mensagemDoErro(e)); }
  });
}

/** CANCELAR — `{ motivo }` aparado 1–500, vazio sem motivo; a mensagem do servidor (409 incluso) vai ao aviso. */
export function useCancelarCompra(segmento: string, id: string, onSucesso: () => void) {
  const chave = React.useRef(newIdem());
  return useMutation({
    mutationFn: (motivo: string) => api(`/api/compras/${segmento}/${id}/cancel`, { method: "POST", body: corpoDoCancelamento(motivo), idempotencyKey: chave.current }),
    onSuccess: () => { chave.current = newIdem(); toast.success("Documento cancelado"); onSucesso(); },
    onError: (e) => { chave.current = newIdem(); toast.error(mensagemDoErro(e)); }
  });
}

/** CONFIRMAR COMPRA <código>? — a prévia do servidor; carregando ou com recusa prevista, o botão trava. */
export function DialogoConfirmarCompra({ id, aberto, onFechar, codigo, carregando, onConfirmar }: {
  id: string; aberto: boolean; onFechar: () => void; codigo: string; carregando: boolean; onConfirmar: () => void;
}) {
  const estado = usePreviaDaConfirmacaoCompra(id, aberto);
  const bloqueado = estado.situacao === "carregando" || (estado.situacao === "pronta" && !estado.previa.podeConfirmar);
  return <DialogoConfirmar aberto={aberto} onFechar={onFechar} rotulo="Confirmar compra" codigo={codigo} carregando={carregando}
    confirmarDesabilitado={bloqueado} onConfirmar={onConfirmar}>
    <div data-testid="compras-previa" data-situacao={estado.situacao}>
      {estado.situacao === "carregando" && <LoadingState label="Calculando a prévia…" />}
      {estado.situacao === "indisponivel" && <p className="text-[12.5px] text-amber-700" data-testid="compras-previa-indisponivel">A prévia não está disponível neste servidor. A confirmação continua conferida pelo servidor.</p>}
      {estado.situacao === "erro" && <p className="text-[12.5px] text-red-700" data-testid="compras-previa-erro">{estado.mensagem}</p>}
      {estado.situacao === "pronta" && <CorpoDaPrevia previa={estado.previa} />}
    </div>
  </DialogoConfirmar>;
}

/** CANCELAR <ESPÉCIE> <código>? — motivo opcional; vazio, o corpo sai sem motivo. */
export function DialogoCancelarCompra({ aberto, onFechar, especie, codigo, situacao, carregando, onCancelar }: {
  aberto: boolean; onFechar: () => void;
  /** em minúsculas ("compra", "pedido de compra") */
  especie: string; codigo: string; situacao: string; carregando: boolean;
  onCancelar: (motivo: string) => void;
}) {
  return <DialogoCancelarDoMotor prefixoTestid={PREFIXO_CENTRAL_COMPRAS} aberto={aberto} onFechar={onFechar} especie={especie} codigo={codigo}
    texto={textoDoCancelamentoDeCompra(situacao)} carregando={carregando} motivoVazio={MOTIVO_VAZIO_DA_COMPRA} onCancelar={onCancelar} />;
}

const t = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const rotuloClass = (i: { codigo: string; nome: string }) => [i.codigo, i.nome].filter(Boolean).join(" — ");

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
      {(estoque.itensForaDaEntrada ?? 0) > 0 && <p className="mt-1 text-slate-600" data-testid="compras-previa-fora-da-entrada">
        {estoque.itensForaDaEntrada === 1 ? "1 item não entra no estoque" : `${estoque.itensForaDaEntrada} itens não entram no estoque`} (sem armazém ou produto sem controle de estoque).
      </p>}
    </section>
    <section data-testid="compras-previa-financeiro" data-efeito={financeiro.efeito ?? ""}>
      <h3 className="mb-1 font-semibold">Financeiro</h3>
      {financeiro.efeito === "pagar"
        ? <>
          <p className="mb-1 text-slate-600">Gera contas a pagar de {brl(financeiro.valor ?? "0")}{financeiro.numero ? `, número ${financeiro.numero}` : ""}.</p>
          {financeiro.classificacao && <p className="mb-1 text-slate-600" data-testid="compras-previa-classificacao">
            Natureza {rotuloClass(financeiro.classificacao.categoria)} · centro de resultado {rotuloClass(financeiro.classificacao.centro)}
          </p>}
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
