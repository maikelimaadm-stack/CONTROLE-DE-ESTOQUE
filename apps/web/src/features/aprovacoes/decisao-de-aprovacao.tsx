"use client";
import { COPY } from "@/lib/copy";
import { Button, Dialog, Field, Textarea } from "@/components/ui";
import { LIMITE_DO_TEXTO_DA_DECISAO, type Decisao } from "./areas-de-aprovacao";

/** As props do diálogo: o estado é de quem o abre (a fila ou a consulta). */
export interface PropsDoDialogoDaDecisao {
  aberto: boolean;
  onFechar: () => void;
  decisao: Decisao | null;
  /** O código do documento, como a tela o mostra ("Aprovar o documento <código>?"). */
  codigo: string;
  texto: string;
  onTexto: (texto: string) => void;
  erro: string | null;
  ocupado: boolean;
  onEnviar: () => void;
}

/**
 * O DIÁLOGO DA DECISÃO DE APROVAÇÃO (TOP-CONFIG-08, decisão 277; extraído na OPERACOES-01 F2, decisão 279).
 *
 * É o `Dialog` oficial que a fila de Aprovações já mostrava, sem mudar testid, texto nem comportamento — agora usado
 * também pela aprovação na consulta do documento. Ele só DESENHA: quem decide o que enviar, para onde e o que fazer
 * com a resposta é quem o abre (a fila ou a consulta), e quem nega é a rota.
 *   · aprovar: "Observação (opcional)";
 *   · reprovar: "Motivo", obrigatório — o botão fica desabilitado enquanto o motivo está vazio;
 *   · `erro`: a recusa do servidor ao corpo (422), mostrada no campo; o diálogo continua aberto;
 *   · `ocupado`: o envio está em curso — nada fecha o diálogo e nenhum segundo clique sai.
 * Sem `decisao` o título fica vazio (a decisão anterior continua guardada por quem abre enquanto o diálogo fecha, para o
 * título não piscar vazio na animação de saída).
 */
export function DialogoDaDecisao({ aberto, onFechar, decisao, codigo, texto, onTexto, erro, ocupado, onEnviar }: PropsDoDialogoDaDecisao) {
  const reprovar = decisao === "reprovar";
  const podeEnviar = !reprovar || texto.trim().length > 0;
  return <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} size="sm" testId="aprovacao-dialogo" preventClose={ocupado}
    title={decisao ? `${reprovar ? "Reprovar" : "Aprovar"} o documento ${codigo}?` : ""}
    footer={<>
      <Button variant="outline" onClick={() => onFechar()} disabled={ocupado}>{COPY.fechar}</Button>
      <Button variant={reprovar ? "danger" : "default"} data-testid="aprovacao-confirmar" loading={ocupado} disabled={ocupado || !podeEnviar}
        onClick={() => onEnviar()}>{reprovar ? "Reprovar" : "Aprovar"}</Button>
    </>}>
    {reprovar
      ? <Field label="Motivo" required span={12} error={erro ?? undefined}>
        <Textarea data-testid="aprovacao-motivo" maxLength={LIMITE_DO_TEXTO_DA_DECISAO} value={texto} onChange={(e) => onTexto(e.target.value)} />
      </Field>
      : <Field label="Observação (opcional)" span={12} error={erro ?? undefined}>
        <Textarea data-testid="aprovacao-observacao" maxLength={LIMITE_DO_TEXTO_DA_DECISAO} value={texto} onChange={(e) => onTexto(e.target.value)} />
      </Field>}
  </Dialog>;
}
