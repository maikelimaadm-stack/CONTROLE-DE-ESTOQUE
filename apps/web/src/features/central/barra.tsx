"use client";
import * as React from "react";
import * as PopoverP from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import type {
  Densidade, PropsDaPilulaDaBarra, PropsDaPosicaoDoRotulo, PropsDasPendencias, PropsDoBotaoDaBarra,
  PropsDoConjunto, PropsDosIndicadores
} from "./contrato";
import estilos from "./barra.module.css";
import estilosCentral from "./moldura.module.css";

export type { DepoisDeSalvar, ItemRapido, Pendencia } from "./contrato";

/**
 * BARRA DE AÇÕES DA CENTRAL (motor neutro, VISUAL-UX-04).
 *
 * Apresentação, e só: botões, pílula, Posição do rótulo e indicadores (Salvo, Confirmando…, N pendências). O que cada
 * um FAZ continua na página da espécie; nenhum componente daqui chama API. O prefixo dos testids vem do adaptador.
 */

/* ── ícones do desenho (traço 2, 24×24; os caminhos são os do desenho, alguns fora do conjunto lucide) ── */
const Icone = ({ tamanho, children }: { tamanho: number; children: React.ReactNode }) =>
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>{children}</svg>;
export const IconeNovo = () => <Icone tamanho={17}><path d="M5 12h14" /><path d="M12 5v14" /></Icone>;
export const IconeDuplicar = () => <Icone tamanho={16}><path d="M9 9.5A2.5 2.5 0 0 1 11.5 7h6A2.5 2.5 0 0 1 20 9.5v6a2.5 2.5 0 0 1-2.5 2.5h-6A2.5 2.5 0 0 1 9 15.5z" /><path d="M15.5 7V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5H9" /></Icone>;
export const IconeConfirmar = () => <Icone tamanho={15}><path d="M20 6 9 17l-5-5" /></Icone>;
export const IconeDescartar = () => <Icone tamanho={16}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icone>;
export const IconeSalvar = () => <Icone tamanho={16}><path d="M6 4h9.5L20 8.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="M8 4v4.5h7V4" /><path d="M8 20v-6h8v6" /></Icone>;
export const IconeImprimir = () => <Icone tamanho={16}><path d="M7 9V4h10v5" /><path d="M7 17H5.5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H17" /><path d="M7 14h10v6H7z" /><path d="M17 11.1a0.9 0.9 0 1 1 0 1.8a0.9 0.9 0 1 1 0 -1.8z" fill="currentColor" stroke="none" /></Icone>;
export const IconeHistorico = () => <Icone tamanho={16}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></Icone>;
/** Fora do desenho (Alterar operação, Cancelar): ícones de mesmo traço, no mesmo círculo. */
export const IconeAlterarOperacao = () => <Icone tamanho={16}><path d="m2 9 3-3 3 3" /><path d="M13 18H7a2 2 0 0 1-2-2V6" /><path d="m22 15-3 3-3-3" /><path d="M11 6h6a2 2 0 0 1 2 2v10" /></Icone>;
export const IconeCancelarDocumento = () => <Icone tamanho={16}><path d="M12 3.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 1 1 0 -17z" /><path d="M9 9l6 6M15 9l-6 6" /></Icone>;
export const IconeConverter = () => <Icone tamanho={15}><path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" /></Icone>;
export const IconeEncerrarSaldo = () => <Icone tamanho={15}><path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" /><path d="M14 3v5h5" /><path d="m9.5 12.5 5 5" /><path d="m14.5 12.5-5 5" /></Icone>;
export const IconeRaio = () => <Icone tamanho={16}><path d="M13 2 3 14h9l-1 8 10-12h-9z" /></Icone>;
const IconeRotuloAntes = () => <Icone tamanho={16}><path d="M2.5 12h5" /><path d="M12 7h7.5a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-7.5a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2z" /></Icone>;
const IconeRotuloDentro = () => <Icone tamanho={16}><path d="M5 5.5h14a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1 -2.5 2.5h-14a2.5 2.5 0 0 1 -2.5 -2.5v-8a2.5 2.5 0 0 1 2.5 -2.5z" /><path d="M6.8 9.8h5" /></Icone>;
const IconeAlerta = () => <Icone tamanho={13}><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></Icone>;
const IconeSalvo = () => <Icone tamanho={13}><circle cx="12" cy="12" r="10" /><path d="m16 9-5.5 5.5L8 12" /></Icone>;
export const IconeGirando = ({ tamanho = 15 }: { tamanho?: number }) => <span className={estilos.girar}><Icone tamanho={tamanho}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></Icone></span>;

/* ── conjuntos ── */
export const ConjuntoDaBarra = ({ children }: PropsDoConjunto) => <span className={estilos.conjunto}>{children}</span>;
export const ConjuntoDireito = ({ children }: PropsDoConjunto) => <span className={estilos.conjuntoDireito}>{children}</span>;

/**
 * Botão só de ícone (`.tbi`): nome acessível e dica SEMPRE — nunca ícone mudo. `dica` troca só o texto da dica (ex.:
 * "Salvando…", ou o motivo de estar desabilitado); o nome acessível continua sendo `rotulo`.
 */
export const BotaoDaBarra = React.forwardRef<HTMLButtonElement, PropsDoBotaoDaBarra>(({ rotulo, dica, solido, ocupado, dicaNoFim, className, children, disabled, ...p }, ref) =>
  <button ref={ref} type="button" aria-label={rotulo} data-dica={dica ?? rotulo} aria-busy={ocupado || undefined} disabled={disabled || ocupado}
    className={cn(estilos.botao, solido && estilos.solido, dicaNoFim ? estilosCentral.dicaFim : estilosCentral.dicaInicio, className)} {...p}>
    {ocupado ? <IconeGirando /> : children}
  </button>);
BotaoDaBarra.displayName = "BotaoDaBarra";

/** A pílula (`.tbp`): ícone e texto — Confirmar e as ações de avanço da espécie. */
export const PilulaDaBarra = React.forwardRef<HTMLButtonElement, PropsDaPilulaDaBarra>(
  ({ icone, dica, ocupado, className, children, disabled, ...p }, ref) =>
    <button ref={ref} type="button" data-dica={dica} aria-busy={ocupado || undefined} disabled={disabled || ocupado}
      className={cn(estilos.pilula, estilosCentral.dicaInicio, className)} {...p}>
      {ocupado ? <IconeGirando /> : icone}{children}
    </button>);
PilulaDaBarra.displayName = "PilulaDaBarra";

/* ── Posição do rótulo ── */
/** Os dois valores da densidade da Central (o mesmo `Densidade` do contrato). */
export type PosicaoDoRotuloValor = Densidade;
/**
 * POSIÇÃO DO RÓTULO — estado SÓ da tela: a página o guarda em `useState` e ele morre com ela. Nada vai para
 * localStorage, sessionStorage ou perfil; remontar devolve o padrão ("Rótulo antes do campo").
 */
export function PosicaoDoRotulo({ prefixoTestid, valor, onChange }: PropsDaPosicaoDoRotulo & { prefixoTestid: string }) {
  const opcao = (v: PosicaoDoRotuloValor, rotulo: string, icone: React.ReactNode) =>
    <button type="button" aria-pressed={valor === v} aria-label={rotulo} data-dica={rotulo} className={estilosCentral.dicaFim} onClick={() => onChange(v)}>{icone}</button>;
  return <div role="group" aria-label="Posição do rótulo dos campos" data-testid={`${prefixoTestid}-posicao-rotulo`} className={estilos.segmentado}>
    {opcao("rotulo-a-frente", "Rótulo antes do campo", <IconeRotuloAntes />)}
    {opcao("compacto", "Rótulo dentro do campo", <IconeRotuloDentro />)}
  </div>;
}

/* ── indicadores ── */
export const IndicadorSalvo = ({ prefixoTestid }: PropsDosIndicadores) => <span className={estilos.salvo} role="status" data-testid={`${prefixoTestid}-salvo`}><IconeSalvo />Salvo</span>;
export const IndicadorConfirmando = ({ prefixoTestid }: PropsDosIndicadores) => <span className={estilos.confirmando} role="status" data-testid={`${prefixoTestid}-confirmando`}><IconeGirando tamanho={13} />Confirmando…</span>;


/**
 * N PENDÊNCIAS — só aparece depois de um clique em Salvar que não enviou nada. A lista leva ao campo: quem sabe ONDE
 * o campo está é a página (`onIr`); aqui só se fecha a lista antes, para o foco não voltar para a pílula.
 */
export function PendenciasDoDocumento({ prefixoTestid, pendencias, aberta, onAbertaChange, onIr }: PropsDasPendencias) {
  const indo = React.useRef(false);
  if (!pendencias.length) return null;
  const n = pendencias.length;
  return <span className={estilos.pendenciasAncora}>
    <PopoverP.Root open={aberta} onOpenChange={onAbertaChange}>
      <PopoverP.Trigger asChild>
        <button type="button" className={estilos.pendencias} data-testid={`${prefixoTestid}-pendencias`}><IconeAlerta />{n} {n === 1 ? "pendência" : "pendências"}</button>
      </PopoverP.Trigger>
      <PopoverP.Portal>
        <PopoverP.Content align="end" side="bottom" sideOffset={8} className={cn(estilos.pop, estilos.pendenciasLista)} aria-label="Pendências do documento" data-testid={`${prefixoTestid}-pendencias-lista`}
          onCloseAutoFocus={(e) => { if (indo.current) { indo.current = false; e.preventDefault(); } }}>
          {pendencias.map((p) => <button key={p.caminho} type="button" className={estilos.pendencia} data-testid={`${prefixoTestid}-pendencia`} data-caminho={p.caminho}
            onClick={() => { indo.current = true; onAbertaChange(false); requestAnimationFrame(() => onIr(p)); }}>
            <b>{p.rotulo}</b><span>{p.mensagem}</span>
          </button>)}
        </PopoverP.Content>
      </PopoverP.Portal>
    </PopoverP.Root>
  </span>;
}

