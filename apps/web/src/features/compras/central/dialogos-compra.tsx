"use client";
import { brl, dateBR, num } from "@/lib/utils";
import { LoadingState } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";
import { DialogoConfirmar } from "@/features/central/dialogos";
import { usePreviaDaConfirmacaoCompra, type PreviaDaConfirmacaoCompra } from "../previa-confirmacao-compra";

/**
 * O DIÁLOGO DE CONFIRMAR COMPRA (VISUAL-UX-04, decisão 276).
 *
 * A casca é a do motor (`DialogoConfirmar` de `@/features/central/dialogos`, sobre o `Dialog` oficial). Aqui moram o
 * texto da compra e a prévia da confirmação de hoje (recusas, entrada no estoque, parcelas a pagar). A escrita
 * (POST /api/compras/compras/<id>/confirm, corpo vazio, Idempotency-Key) e quando o diálogo abre moram no estado
 * (`useEstadoDaConsulta`); Cancelar e Encerrar saldo são os diálogos do motor e o de hoje, montados na barra da consulta.
 */

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
            // o Local de estoque antes do Produto (OPERACOES-01 F3b, decisão 280)
            { key: "armazem", label: "Local de estoque", render: (r) => t(r["armazem"]) },
            { key: "produto", label: "Produto" },
            { key: "lote", label: "Lote", render: (r) => t(r["lote"]) },
            { key: "quantidade", label: "Quantidade", align: "right", render: (r) => num(r["quantidade"] as string, 4) },
            { key: "valorEntrada", label: "Valor de entrada", align: "right", render: (r) => brl(r["valorEntrada"] as string) },
            { key: "custoUnitario", label: "Custo unitário", align: "right", render: (r) => brl(r["custoUnitario"] as string) }
          ]} />
        </>
        : <p className="text-slate-600">{estoque.efeito === "nenhum" ? "Não movimenta o estoque." : "O efeito no estoque não pôde ser previsto."}</p>}
      {(estoque.itensForaDaEntrada ?? 0) > 0 && <p className="mt-1 text-slate-600" data-testid="compras-previa-fora-da-entrada">
        {estoque.itensForaDaEntrada === 1 ? "1 item não entra no estoque" : `${estoque.itensForaDaEntrada} itens não entram no estoque`} (sem local de estoque ou produto sem controle de estoque).
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
