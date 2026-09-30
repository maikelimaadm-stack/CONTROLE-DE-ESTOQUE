"use client";
import * as React from "react";
import { Dialog } from "@/components/ui";
import { cn } from "@/lib/utils";
import estilos from "./central-vendas-dialogos.module.css";

/**
 * OS DIÁLOGOS DA CENTRAL DE VENDAS (VISUAL-UX-02, decisão 270, item 4.6).
 *
 * ┌─ A CASCA É DO DESENHO; O DIÁLOGO É O OFICIAL ──────────────────────────────────────────────────┐
 * │ Todos sobre o `Dialog` de @/components/ui — overlay, foco preso e devolvido, Esc, título e       │
 * │ descrição acessíveis. A largura vem da prop `size` (sm), nunca de classe. O `testId` é o de      │
 * │ confirmação de sempre (`confirm-dialog`, botão `confirm-dialog-confirm`): quem lê a tela pelos    │
 * │ testids de hoje continua encontrando o mesmo diálogo, só com o texto do desenho.                  │
 * │                                                                                                  │
 * │ Nenhum decide nada. Quem confirma, cancela ou descarta é a PÁGINA, pelos handlers de sempre       │
 * │ (`act.mutate`, remontar o formulário); aqui só moram o texto e os botões.                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** O motivo padrão do cancelamento — o texto que a tela sempre mandou quando ninguém escreveu outro. */
export const MOTIVO_PADRAO_DO_CANCELAMENTO = "Cancelado pelo usuário";
/** Limite do motivo, o mesmo da API. */
const LIMITE_DO_MOTIVO = 500;

/** O `reason` que vai no corpo: o motivo aparado (1–500) ou, vazio, o texto padrão de hoje. */
export function motivoDoCancelamento(digitado: string): string {
  const aparado = digitado.trim().slice(0, LIMITE_DO_MOTIVO).trim();
  return aparado || MOTIVO_PADRAO_DO_CANCELAMENTO;
}

const Icone = ({ tamanho, children }: { tamanho: number; children: React.ReactNode }) =>
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>{children}</svg>;
const IconeConfirmar = () => <Icone tamanho={15}><path d="M20 6 9 17l-5-5" /></Icone>;
const IconeCancelar = () => <Icone tamanho={15}><path d="M12 3.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 1 1 0 -17z" /><path d="M9 9l6 6M15 9l-6 6" /></Icone>;
const IconeDescartar = () => <Icone tamanho={16}><path d="M13 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h4" /><path d="M13 3.5 17.5 8v3" /><path d="M13 3.5V8h4.5" /><path d="M17 13.2a3.8 3.8 0 1 1 0 7.6a3.8 3.8 0 1 1 0 -7.6z" /><path d="M15.2 17h3.6" /></Icone>;
const IconeGirando = () => <span className={estilos.girar}><Icone tamanho={15}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></Icone></span>;

type TomDoBotao = "cinza" | "verde" | "vermelho";
function BotaoDoDialogo({ tom = "cinza", icone, carregando, children, disabled, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tom?: TomDoBotao; icone?: React.ReactNode; carregando?: boolean }) {
  return <button type="button" className={cn(estilos.botao, tom === "verde" && estilos.verde, tom === "vermelho" && estilos.vermelho)}
    disabled={disabled || carregando} aria-busy={carregando || undefined} {...p}>
    {carregando ? <IconeGirando /> : icone}{children}
  </button>;
}

/** A casca: título, texto opcional, corpo opcional e os botões à direita. */
function DialogoDaCentral({ aberto, onFechar, titulo, texto, children, acoes, carregando, espacado }: {
  aberto: boolean; onFechar: () => void; titulo: string; texto?: React.ReactNode; children?: React.ReactNode;
  acoes: React.ReactNode; carregando?: boolean;
  /** o diálogo com campo (Cancelar) respira 10px entre as partes, como no desenho */
  espacado?: boolean;
}) {
  return <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} title={titulo} description={texto} size="sm" hideClose preventClose={carregando}
    testId="confirm-dialog" className={cn(estilos.dialogo, espacado && estilos.espacado, !children && estilos.semCorpo)} bodyClassName={estilos.corpo} footer={acoes}>
    {children}
  </Dialog>;
}

/**
 * CONFIRMAR VENDA — o corpo é a PRÉVIA do servidor (os estados e textos de hoje, montados pela página). Enquanto ela
 * carrega, e quando prevê recusa, o botão fica desabilitado (`confirmarDesabilitado`, a mesma regra de antes).
 */
export function DialogoConfirmarVenda({ aberto, onFechar, codigo, carregando, confirmarDesabilitado, onConfirmar, children }: {
  aberto: boolean; onFechar: () => void; codigo: string; carregando: boolean; confirmarDesabilitado: boolean; onConfirmar: () => void; children: React.ReactNode;
}) {
  return <DialogoDaCentral aberto={aberto} onFechar={onFechar} titulo={`Confirmar venda ${codigo}?`.replace(/\s+\?$/, "?")} carregando={carregando}
    acoes={<>
      <BotaoDoDialogo onClick={onFechar} disabled={carregando}>Voltar</BotaoDoDialogo>
      <BotaoDoDialogo tom="verde" icone={<IconeConfirmar />} carregando={carregando} disabled={confirmarDesabilitado} onClick={onConfirmar} data-testid="confirm-dialog-confirm">Confirmar venda</BotaoDoDialogo>
    </>}>
    {children}
  </DialogoDaCentral>;
}

/**
 * CANCELAR <ESPÉCIE> — o texto de efeito é o de hoje; o motivo é opcional e vai no `reason` (aparado, até 500). Vazio,
 * vai o texto padrão de hoje. O campo recomeça vazio a cada abertura.
 */
export function DialogoCancelarDocumento({ aberto, onFechar, especie, codigo, texto, carregando, onCancelar }: {
  aberto: boolean; onFechar: () => void;
  /** a espécie em minúsculas, como no título e no botão ("venda", "pedido de venda", "orçamento") */
  especie: string; codigo: string; texto: string; carregando: boolean;
  onCancelar: (reason: string) => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const id = React.useId();
  React.useEffect(() => { if (aberto) setMotivo(""); }, [aberto]);
  return <DialogoDaCentral aberto={aberto} onFechar={onFechar} titulo={`Cancelar ${especie} ${codigo}?`.replace(/\s+\?$/, "?")} texto={texto} carregando={carregando} espacado
    acoes={<>
      <BotaoDoDialogo onClick={onFechar} disabled={carregando}>Voltar</BotaoDoDialogo>
      <BotaoDoDialogo tom="vermelho" icone={<IconeCancelar />} carregando={carregando} onClick={() => onCancelar(motivoDoCancelamento(motivo))} data-testid="confirm-dialog-confirm">{`Cancelar ${especie}`}</BotaoDoDialogo>
    </>}>
    <div className={estilos.motivo}>
      <label className={estilos.motivoRotulo} htmlFor={`${id}-motivo`}>Motivo (opcional)</label>
      <input id={`${id}-motivo`} className={estilos.motivoCaixa} value={motivo} maxLength={LIMITE_DO_MOTIVO} placeholder="Registrado no cancelamento"
        onChange={(e) => setMotivo(e.target.value)} data-testid="central-vendas-cancelar-motivo" />
    </div>
  </DialogoDaCentral>;
}

/** DESCARTAR — pergunta antes de devolver o lançamento à abertura. Nada é escrito. */
export function DialogoDescartar({ aberto, onFechar, onDescartar }: { aberto: boolean; onFechar: () => void; onDescartar: () => void }) {
  return <DialogoDaCentral aberto={aberto} onFechar={onFechar} titulo="Descartar as alterações?" texto="O documento volta como estava antes desta edição."
    acoes={<>
      <BotaoDoDialogo onClick={onFechar}>Continuar editando</BotaoDoDialogo>
      <BotaoDoDialogo icone={<IconeDescartar />} onClick={onDescartar} data-testid="confirm-dialog-confirm">Descartar alterações</BotaoDoDialogo>
    </>} />;
}
