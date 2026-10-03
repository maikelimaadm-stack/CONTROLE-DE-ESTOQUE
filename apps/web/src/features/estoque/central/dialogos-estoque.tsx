"use client";
import * as React from "react";
import type { EspecieEstoque } from "@agro/domain";
import { num } from "@/lib/utils";
import { Button, Dialog, Field, LoadingState, Textarea } from "@/components/ui";
import { rotuloDoMovimentoPrevisto, usePreviaDaConfirmacaoEstoque, type PreviaDaConfirmacaoEstoque } from "../previa-confirmacao-estoque";

/**
 * OS DIÁLOGOS DA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282). Cancelar é o do motor (`DialogoCancelarDocumento`,
 * montado na barra da consulta); aqui moram os dois da espécie:
 *   · a PRÉVIA da confirmação — a de antes (ESTOQUE-01, TOP-CONFIG-08), MOVIDA, com os MESMOS testids; a requisição fala
 *     do DISPONÍVEL (`data-base-do-saldo`, "Disponível agora/depois" e o bloqueio próprio);
 *   · ENCERRAR SALDO da requisição atendida em parte — motivo obrigatório (1 a 500), como o servidor exige.
 * A escrita (confirmar, encerrar) e quando cada um abre moram no estado da consulta.
 */

const traco = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * O DIÁLOGO DA PRÉVIA: antes de confirmar, o que a confirmação faria no saldo de AGORA, item por item. Falta de saldo (ou
 * de disponível, na requisição) ou uma recusa do documento (a aprovação pendente ou reprovada, a versão da TOP
 * ilegível — TOP-CONFIG-08, decisão 277) BLOQUEIA o Confirmar (`podeConfirmar: false`); prévia indisponível (API
 * anterior) deixa confirmar — o servidor confere de novo, sob a trava.
 */
export function DialogoDaPrevia({ segmento, id, especie, aberto, onAberto, ocupado, onConfirmar }: {
  segmento: string; id: string; especie: EspecieEstoque; aberto: boolean; onAberto: (v: boolean) => void; ocupado: boolean; onConfirmar: () => void;
}) {
  const estado = usePreviaDaConfirmacaoEstoque(segmento, id, aberto);
  const bloqueado = estado.situacao === "carregando" || estado.situacao === "erro" || (estado.situacao === "pronta" && !estado.previa.podeConfirmar);
  return <Dialog open={aberto} onOpenChange={onAberto} size="lg" testId="estoque-previa" title="Confirmar documento"
    description="O que a confirmação vai fazer no saldo agora, segundo o servidor."
    footer={<>
      <Button variant="outline" onClick={() => onAberto(false)}>Voltar</Button>
      <Button data-testid="estoque-previa-confirmar" loading={ocupado} disabled={bloqueado || ocupado} onClick={onConfirmar}>Confirmar</Button>
    </>}>
    <div data-testid="estoque-previa-corpo" data-situacao={estado.situacao} data-base-do-saldo={estado.situacao === "pronta" ? estado.previa.baseDoSaldo : undefined}>
      {estado.situacao === "carregando" && <LoadingState label="Calculando a prévia…" />}
      {estado.situacao === "indisponivel" && <p className="text-[12.5px] text-amber-700" data-testid="estoque-previa-indisponivel">A prévia não está disponível neste servidor. A confirmação continua conferida pelo servidor.</p>}
      {estado.situacao === "erro" && <p className="text-[12.5px] text-red-700" data-testid="estoque-previa-erro">{estado.mensagem}</p>}
      {estado.situacao === "pronta" && <CorpoDaPrevia previa={estado.previa} especie={especie} />}
    </div>
  </Dialog>;
}

/**
 * As recusas do DOCUMENTO vêm primeiro, acima da tabela, com a mensagem do servidor (a mesma que a confirmação daria);
 * o aviso de saldo só aparece quando algum item está insuficiente — com o documento recusado e o saldo coberto, ele
 * diria uma falta que não existe. Na requisição a base é o DISPONÍVEL (o físico menos o reservado pelos outros).
 */
function CorpoDaPrevia({ previa, especie }: { previa: PreviaDaConfirmacaoEstoque; especie: EspecieEstoque }) {
  const ehAjuste = especie === "ajuste";
  const disponivel = previa.baseDoSaldo === "disponivel";
  const faltaSaldo = previa.itens.some((it) => it.insuficiente);
  return <div className="space-y-2 text-[12.5px]">
    {previa.recusas.length > 0 && <ul data-testid="estoque-previa-recusas" className="space-y-0.5 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
      {previa.recusas.map((r, i) => <li key={`${r.code}:${i}`} data-testid="estoque-previa-recusa" data-code={r.code}>{r.message}</li>)}
    </ul>}
    {faltaSaldo && <p data-testid="estoque-previa-bloqueio" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
      {disponivel
        ? "Há item sem disponível suficiente no local de estoque. Ajuste a requisição ou o saldo antes de confirmar."
        : "Há item sem saldo suficiente no local de estoque de origem. Ajuste o documento ou o saldo antes de confirmar."}
    </p>}
    <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[12.5px]"><thead><tr>
      <th>Produto</th>
      <th>Lote</th>
      <th className="text-right">{disponivel ? "Disponível agora" : "Saldo atual"}</th>
      <th className="text-right">{ehAjuste ? "Saldo contado" : disponivel ? "Disponível depois" : "Saldo depois"}</th>
      {ehAjuste && <th className="text-right">Diferença</th>}
      <th>Movimento</th>
    </tr></thead><tbody>
      {previa.itens.map((it) => <tr key={it.item_id} data-testid="estoque-previa-item" data-insuficiente={String(it.insuficiente)}
        data-diferenca={it.diferenca ?? ""} data-saldo-atual={it.saldo_atual} data-saldo-depois={it.saldo_depois}>
        <td>{it.produto_nome}</td>
        <td>{traco(it.lote)}</td>
        <td className="num">{num(it.saldo_atual, 4)}</td>
        <td className={it.insuficiente ? "num text-red-700" : "num"}>{num(it.saldo_depois, 4)}{it.insuficiente && (disponivel ? " — disponível insuficiente" : " — saldo insuficiente")}</td>
        {ehAjuste && <td className="num">{num(it.diferenca, 4)}</td>}
        <td>{rotuloDoMovimentoPrevisto(it.movimento, especie)}</td>
      </tr>)}
    </tbody></table></div>
  </div>;
}

/** O limite do motivo do encerramento do saldo — o mesmo da API (`encerrarSchema`, 1 a 500). */
const LIMITE_DO_MOTIVO_DO_ENCERRAMENTO = 500;

/**
 * ENCERRAR O SALDO DA REQUISIÇÃO — o que falta atender deixa de ser reservado; os consumos já lançados continuam
 * valendo. O motivo é obrigatório (o botão fica desabilitado vazio; o servidor também recusa). O campo recomeça vazio a
 * cada abertura.
 */
export function DialogoEncerrarSaldo({ aberto, onAberto, ocupado, onEncerrar }: {
  aberto: boolean; onAberto: (v: boolean) => void; ocupado: boolean; onEncerrar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  React.useEffect(() => { if (aberto) setMotivo(""); }, [aberto]);
  const aparado = motivo.trim();
  return <Dialog open={aberto} onOpenChange={onAberto} size="sm" testId="estoque-encerrar-dialogo" title="Encerrar o saldo da requisição"
    description="O saldo que falta atender deixa de ser reservado. Os consumos já lançados continuam valendo."
    footer={<>
      <Button variant="outline" onClick={() => onAberto(false)}>Voltar</Button>
      <Button data-testid="estoque-encerrar-confirmar" loading={ocupado} disabled={!aparado || ocupado} onClick={() => { if (aparado) onEncerrar(aparado); }}>Encerrar saldo</Button>
    </>}>
    <Field label="Motivo" required span={12}>
      <Textarea data-testid="estoque-encerrar-motivo" maxLength={LIMITE_DO_MOTIVO_DO_ENCERRAMENTO} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
    </Field>
  </Dialog>;
}
