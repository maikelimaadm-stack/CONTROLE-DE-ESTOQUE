"use client";
import * as React from "react";
import { Button, Dialog } from "@/components/ui";
import { toast } from "@/lib/toast";
import { TransferBatchLocation } from "@/features/livestock/transfer-batch-location";
import { textoDoAviso, type ResultadoDoArraste } from "./mover-lote";
import type { AreaOperacional } from "./operacional-dados";
import { nomeDoLote, textoDeCabecas } from "./painel-do-pasto";

/**
 * MAPA-MANEJO-04 (F2) — CAMADA 4: depois do soltar em OUTRA área, o diálogo da movimentação. UM overlay só (um único
 * `Dialog` do barrel, que troca de etapa por dentro):
 *
 *   1. origem com VÁRIOS lotes → "Qual lote mover?": o marcador é da área, a movimentação é de UM lote — a tela
 *      pergunta, nunca escolhe o primeiro;
 *   2. lote escolhido (ou o único) → o formulário que JÁ EXISTE na Pecuária (`TransferBatchLocation`, o mesmo do
 *      "Mover lote de local"), com o lote e a ÁREA DE DESTINO PRÉ-SELECIONADOS.
 *
 * NADA é gravado antes do botão "Transferir" do formulário: o gesto e a escolha só preenchem campos. O POST é o do
 * formulário (`POST /api/livestock/transfers/batch-to-module-area`, permissão `batch_module_area_transfer.create`) —
 * nenhuma rota nova, nenhuma chamada daqui. O formulário continua editável: a pessoa pode trocar data, empresa,
 * módulo, área ou curral antes de confirmar.
 */

/** Mostra, no aviso da casa (toast), o soltar que não abre formulário (mesma área, fora de qualquer área). Devolve se avisou. */
export function avisarArraste(r: ResultadoDoArraste): boolean {
  const texto = textoDoAviso(r);
  if (texto === null) return false;
  toast.warning(texto);
  return true;
}

export interface MoverLoteDialogoProps {
  /** área de onde o marcador saiu (os lotes dela são as opções) */
  origem: AreaOperacional | null;
  /** área onde o marcador foi solto (pré-selecionada no formulário) */
  destino: AreaOperacional | null;
  aberto: boolean;
  /** fechar sem gravar (X, Esc, clique fora) */
  aoFechar: () => void;
  /** a transferência foi gravada pelo formulário */
  aoConcluir: () => void;
}

/** Diálogo de mover lote pelo mapa: escolha do lote (quando há mais de um) e o formulário de movimentação existente. */
export function MoverLoteDialogo({ origem, destino, aberto, aoFechar, aoConcluir }: MoverLoteDialogoProps) {
  const chave = `${origem?.id ?? ""}>${destino?.id ?? ""}`;
  const [escolha, setEscolha] = React.useState<{ chave: string; loteId: string } | null>(null);
  const lotes = origem?.lotes ?? [];
  const unico = lotes.length === 1 ? lotes[0] : undefined;
  // A escolha vale só para o MESMO par origem → destino (e para um lote que ainda está na origem).
  const escolhido = escolha !== null && escolha.chave === chave && lotes.some((l) => l.lote.id === escolha.loteId) ? escolha.loteId : null;
  const loteId = unico ? unico.lote.id : escolhido;
  const visivel = aberto && origem !== null && destino !== null;

  const fechar = () => {
    setEscolha(null);
    aoFechar();
  };
  const concluir = () => {
    setEscolha(null);
    aoConcluir();
  };

  if (!visivel) return null;

  if (loteId === null) {
    return (
      <Dialog
        open
        onOpenChange={(o) => { if (!o) fechar(); }}
        title={lotes.length === 0 ? "Nenhum lote para mover" : "Qual lote mover?"}
        description={`De ${origem.name} para ${destino.name}`}
        size="sm"
        testId="mover-lote-dialogo"
      >
        {lotes.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="escolher-lote-vazio">{origem.name} não tem lote presente agora.</p>
        ) : (
          <div className="space-y-2" data-testid="escolher-lote">
            <p className="text-sm text-slate-600">
              {origem.name} tem {lotes.length} lotes. O marcador é da área; a movimentação é de um lote só.
            </p>
            <ul className="space-y-1.5">
              {lotes.map((l) => (
                <li key={l.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full min-w-0 justify-between !min-h-11 sm:!min-h-0"
                    onClick={() => setEscolha({ chave, loteId: l.lote.id })}
                    data-testid={`escolher-lote-${l.lote.id}`}
                  >
                    <span className="min-w-0 truncate">{nomeDoLote(l.lote)}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">{textoDeCabecas(l.cabecas)}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) fechar(); }}
      title={`Mover lote para ${destino.name}`}
      description={`Saindo de ${origem.name}. O destino veio do mapa; nada é gravado até você clicar em Transferir.`}
      size="xl"
      testId="mover-lote-dialogo"
      footer={unico ? undefined : (
        <Button type="button" variant="outline" className="!min-h-11 sm:!min-h-0" onClick={() => setEscolha(null)} data-testid="mover-lote-trocar-lote">
          Trocar lote
        </Button>
      )}
    >
      <TransferBatchLocation
        key={`${chave}:${loteId}`}
        batchId={loteId}
        areaIdInicial={destino.id}
        onDone={concluir}
        history={false}
      />
    </Dialog>
  );
}
