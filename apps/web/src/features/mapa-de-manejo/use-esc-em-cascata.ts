import * as React from "react";

/**
 * MAPA-MANEJO-04 (F2) — ESC em CASCATA no mapa operacional: cada Escape desfaz UMA etapa, a primeira ativa da lista,
 * e para. A ordem é a do chamador (filtro de faixa → seleção). Nenhuma ativa → nada.
 *
 * O ESC é ignorado quando já tem dono:
 * - foco num campo editável (texto, número, lista de opções, área de texto, conteúdo editável): o Escape é do campo;
 * - diálogo aberto ou foco dentro de um (Dialog, Drawer e ConfirmDialog do barrel tratam o próprio ESC);
 * - evento já tratado (`defaultPrevented`: o Radix marca o Escape que fechou a camada dele), composição de texto (IME)
 *   ou tecla segurada (repetição não desfaz a cascata inteira de uma vez).
 */

export interface EtapaDoEsc {
  ativo: boolean;
  desfazer: () => void;
}

/** A primeira etapa ativa, na ordem da cascata; `null` quando nenhuma está ativa. */
export function etapaDoEsc(etapas: readonly EtapaDoEsc[]): EtapaDoEsc | null {
  return etapas.find((e) => e.ativo) ?? null;
}

/** O que a cascata lê do alvo do evento (um `HTMLElement` satisfaz). */
interface AlvoDoEsc {
  tagName?: unknown;
  type?: unknown;
  isContentEditable?: unknown;
  closest?: (seletor: string) => unknown;
}

/** `input` que não edita texto: o Escape nele não pertence ao campo. */
const ENTRADAS_SEM_TEXTO = new Set(["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"]);

/** Seletor de diálogo: o papel de diálogo que o Radix (barrel) põe no conteúdo, e o `<dialog>` nativo. */
const SELETOR_DE_DIALOGO = "[role=dialog],[role=alertdialog],dialog";
/** Diálogo ABERTO no documento: o Radix marca o conteúdo aberto com `data-state=open`; o nativo, com `open`. */
const SELETOR_DE_DIALOGO_ABERTO = "[role=dialog][data-state=open],[role=alertdialog][data-state=open],dialog[open]";

/** Foco num campo que edita texto ou escolhe opção. */
export function campoEditavel(alvo: EventTarget | null): boolean {
  const el = alvo as AlvoDoEsc | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const tipo = typeof el.type === "string" && el.type !== "" ? el.type.toLowerCase() : "text";
  return !ENTRADAS_SEM_TEXTO.has(tipo);
}

/** Foco dentro de um diálogo. */
export function dentroDeDialogo(alvo: EventTarget | null): boolean {
  const el = alvo as AlvoDoEsc | null;
  return typeof el?.closest === "function" && el.closest(SELETOR_DE_DIALOGO) != null;
}

/** Há diálogo aberto no documento. */
export function dialogoAberto(doc: Pick<Document, "querySelector"> | null): boolean {
  return doc !== null && doc.querySelector(SELETOR_DE_DIALOGO_ABERTO) !== null;
}

/** O que a cascata lê do evento de teclado. */
export type TeclaDoEsc = Pick<KeyboardEvent, "key" | "defaultPrevented" | "isComposing" | "repeat" | "target">;

/** Trata UM keydown: desfaz a primeira etapa ativa e devolve `true`; `false` quando o ESC não é da cascata. */
export function tratarEsc(e: TeclaDoEsc, etapas: readonly EtapaDoEsc[], doc: Pick<Document, "querySelector"> | null): boolean {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.repeat) return false;
  if (campoEditavel(e.target) || dentroDeDialogo(e.target) || dialogoAberto(doc)) return false;
  const etapa = etapaDoEsc(etapas);
  if (!etapa) return false;
  etapa.desfazer();
  return true;
}

/** Liga a cascata ao `keydown` da janela. As etapas são lidas na hora do Escape (sempre as da última renderização). */
export function useEscEmCascata(etapas: readonly EtapaDoEsc[]): void {
  const etapasRef = React.useRef(etapas);
  React.useEffect(() => { etapasRef.current = etapas; });
  React.useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { tratarEsc(e, etapasRef.current, document); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);
}
