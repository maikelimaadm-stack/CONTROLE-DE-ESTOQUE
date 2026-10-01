"use client";
import * as React from "react";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import type { Densidade } from "./campo";
import estilos from "./lancamento.module.css";

/**
 * LANÇAMENTO DE BEM/EQUIPAMENTO — moldura visual (F2, só apresentação).
 *
 * A barra redonda, a posição do rótulo, o leque de ações rápidas e o cartão em coluna única. Quem decide o que
 * cada botão FAZ (salvar, excluir, anexos) é o `ResourceForm` — aqui só se veste. Cadastro rápido (`rapido`) e
 * qualquer outro recurso continuam no chrome genérico.
 */

export const ehPeleBem = (resourceKey: string, rapido?: boolean) => resourceKey === "equipments" && !rapido;

const Icone = ({ tamanho, children }: { tamanho: number; children: React.ReactNode }) =>
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>{children}</svg>;

export const IconeNovo = () => <Icone tamanho={17}><path d="M5 12h14" /><path d="M12 5v14" /></Icone>;
export const IconeDuplicar = () => <Icone tamanho={16}><path d="M9 9.5A2.5 2.5 0 0 1 11.5 7h6A2.5 2.5 0 0 1 20 9.5v6a2.5 2.5 0 0 1-2.5 2.5h-6A2.5 2.5 0 0 1 9 15.5z" /><path d="M15.5 7V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5H9" /></Icone>;
export const IconeDescartar = () => <Icone tamanho={16}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icone>;
export const IconeSalvar = () => <Icone tamanho={16}><path d="M6 4h9.5L20 8.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="M8 4v4.5h7V4" /><path d="M8 20v-6h8v6" /></Icone>;
export const IconeEditar = () => <Icone tamanho={15}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icone>;
export const IconeExcluir = () => <Icone tamanho={15}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6" /><path d="M14 11v6" /></Icone>;
export const IconeImprimir = () => <Icone tamanho={16}><path d="M7 9V4h10v5" /><path d="M7 17H5.5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H17" /><path d="M7 14h10v6H7z" /><path d="M17 11.1a0.9 0.9 0 1 1 0 1.8a0.9 0.9 0 1 1 0 -1.8z" fill="currentColor" stroke="none" /></Icone>;
export const IconeHistorico = () => <Icone tamanho={16}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></Icone>;
export const IconeAnexos = () => <Icone tamanho={15}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Icone>;
const IconeRaio = () => <Icone tamanho={16}><path d="M13 2 3 14h9l-1 8 10-12h-9z" /></Icone>;
const IconeRotuloAntes = () => <Icone tamanho={16}><path d="M2.5 12h5" /><path d="M12 7h7.5a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-7.5a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2z" /></Icone>;
const IconeRotuloDentro = () => <Icone tamanho={16}><path d="M5 5.5h14a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1 -2.5 2.5h-14a2.5 2.5 0 0 1 -2.5 -2.5v-8a2.5 2.5 0 0 1 2.5 -2.5z" /><path d="M6.8 9.8h5" /></Icone>;
const IconeGirando = () => <span className={estilos.girar}><Icone tamanho={15}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></Icone></span>;

export const Conjunto = ({ children }: { children: React.ReactNode }) => <span className={estilos.conjunto}>{children}</span>;
export const ConjuntoDireito = ({ children }: { children: React.ReactNode }) => <span className={estilos.conjuntoDireito}>{children}</span>;

export const BotaoDaBarra = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  rotulo: string; dica?: string; solido?: boolean; ocupado?: boolean;
  /** alinhamento da dica: início (esquerda da barra, padrão) · fim (direita: ⚡) · centro */
  dicaAlinhada?: "inicio" | "fim" | "centro";
}>(({ rotulo, dica, solido, ocupado, dicaAlinhada = "inicio", className, children, disabled, ...p }, ref) =>
  <button ref={ref} type="button" aria-label={rotulo} data-dica={dica ?? rotulo}
    data-dica-inicio={dicaAlinhada === "inicio" ? "" : undefined}
    data-dica-fim={dicaAlinhada === "fim" ? "" : undefined}
    aria-busy={ocupado || undefined} disabled={disabled || ocupado}
    className={cn(estilos.botao, solido && estilos.solido, className)} {...p}>
    {ocupado ? <IconeGirando /> : children}
  </button>);
BotaoDaBarra.displayName = "BotaoDaBarra";

/** Posição do rótulo — estado SÓ da tela; nada persiste. */
export function PosicaoDoRotuloBem({ valor, onChange }: { valor: Densidade; onChange: (v: Densidade) => void }) {
  const opcao = (v: Densidade, rotulo: string, icone: React.ReactNode) =>
    <button type="button" aria-pressed={valor === v} aria-label={rotulo} data-dica={rotulo} data-dica-fim="" onClick={() => onChange(v)}>{icone}</button>;
  return <div role="group" aria-label="Posição do rótulo dos campos" data-testid="lancamento-bem-posicao-rotulo" className={estilos.segmentado}>
    {opcao("rotulo-a-frente", "Rótulo antes do campo", <IconeRotuloAntes />)}
    {opcao("compacto", "Rótulo dentro do campo", <IconeRotuloDentro />)}
  </div>;
}

export interface ItemRapidoBem {
  chave: string; rotulo: string; testId: string; onSelect: () => void;
  icone: React.ReactNode; desabilitado?: boolean;
}

const RAIO = 60, PASSO = 33, MEIO = 138;
function posicaoNoLeque(i: number, total: number): { x: number; y: number } {
  const angulo = ((MEIO + (i - (total - 1) / 2) * PASSO) * Math.PI) / 180;
  return { x: Math.round(Math.cos(angulo) * RAIO), y: Math.round(Math.sin(angulo) * RAIO) };
}

/** Ações rápidas (⚡): Anexos · Imprimir · Histórico — o leque do desenho. */
export function AcoesRapidasDoBem({ itens, desabilitado }: { itens: ItemRapidoBem[]; desabilitado?: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  const escolheu = React.useRef(false);
  return <span className={estilos.leque}>
    <DropdownP.Root modal={false} open={aberto} onOpenChange={setAberto}>
      <DropdownP.Trigger asChild disabled={desabilitado}>
        <BotaoDaBarra rotulo="Ações rápidas" dicaAlinhada="fim" data-testid="lancamento-bem-acoes-rapidas"><IconeRaio /></BotaoDaBarra>
      </DropdownP.Trigger>
      <DropdownP.Content side="bottom" align="center" sideOffset={-12.5} avoidCollisions={false} loop className={estilos.lequeConteudo}
        aria-label="Ações rápidas" data-testid="lancamento-bem-acoes-rapidas-leque"
        onCloseAutoFocus={(e) => { if (escolheu.current) { escolheu.current = false; e.preventDefault(); } }}>
        {itens.map((it, i) => {
          const { x, y } = posicaoNoLeque(i, itens.length);
          const posicao = { "--x": `${x}px`, "--y": `${y}px`, "--atraso-entrada": `${i * 34}ms` } as React.CSSProperties;
          return <DropdownP.Item key={it.chave} asChild disabled={it.desabilitado}
            onSelect={() => { escolheu.current = true; it.onSelect(); }}>
            <button type="button" className={estilos.lequeItem} style={posicao} data-dica={it.rotulo} data-dica-fim="" data-testid={it.testId} aria-label={it.rotulo}>
              {it.icone}
            </button>
          </DropdownP.Item>;
        })}
      </DropdownP.Content>
    </DropdownP.Root>
  </span>;
}

/** Cartão do desenho (Dados / Veículo / Depreciação / Outros): título + grade 12 colunas. */
export function CartaoDoBem({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className={cn(estilos.cartao, "col-span-12")} data-testid="lancamento-bem-cartao">
    <h3 className={estilos.cartaoTitulo}>{label}</h3>
    <div className={estilos.grade} data-testid="lancamento-bem-grade">{children}</div>
  </div>;
}

/**
 * Larguras do HTML (coluna de 12). Só a pele: o registry continua dono do campo.
 * Código não entra na grade — no desenho ele aparece no título do registro.
 */
const SPANS_DO_DESENHO: Record<string, number> = {
  description: 6, empresa_id: 6,
  family_id: 3, equipment_type: 3, proprietary_id: 3, status: 3,
  hour_value: 2, hour_meter: 2, year_model: 2, brand: 2, model: 2, patrimony: 2,
  chassis: 2, renavam: 2, serial_number: 2, plate: 2, plate_state: 2, color: 2, vehicle: 12,
  has_depreciation: 3, acquisition_value: 3, acquisition_date: 3, depreciation_type: 3,
  residual_percent: 2, life_years: 2, depreciation_percent: 2, residual_value: 2, depreciable_value: 2, depreciated_value: 2,
  provider_id: 4, product_id: 4, use_fiscal: 4, features: 6, specification: 12,
};
export function spanDoDesenhoBem(nome: string): number | undefined {
  return SPANS_DO_DESENHO[nome];
}

/** Span do registry/layout → classe da grade (2 / 3 / 4 / 6 / 12). */
export function classeDoSpan(span?: number): string {
  const n = span && span > 0 ? span : 3;
  if (n >= 12) return estilos.sp12!;
  if (n >= 6) return estilos.sp6!;
  if (n >= 4) return estilos.sp4!;
  if (n >= 3) return estilos.sp3!;
  return estilos.sp2!;
}

export { estilos as estilosLancamentoBem };
