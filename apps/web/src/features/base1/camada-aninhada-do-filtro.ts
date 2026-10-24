/**
 * Camadas portaladas do filtro (condição Radix Select, cmd-panel, calendário).
 * Clique / foco nelas NÃO deve fechar o shell do filtro — só Cancelar / Aplicar (ícones) / fora de verdade.
 * Enter nelas escolhe a opção (não aplica o filtro); Enter no campo de valor do shell aplica (decisão 358).
 *
 * O Select Radix usa `disableOutsidePointerEvents`: com a lista aberta, `body` fica
 * `pointer-events: none` e o alvo do mousedown pode ser `html`/`body` mesmo com o
 * cursor sobre o shell ou o gatilho — aí o dismiss por “fora” precisa da geometria
 * do ponteiro (decisão 359), não só de `contains(target)`.
 */
export const SELETOR_CAMADA_ANINHADA_DO_FILTRO =
  "[data-filtro-camada], [data-radix-select-content], .fsell, .foperadores, .cmd-panel, .mg-dp-panel";

/** `true` quando o alvo (ou ancestral) é uma camada aninhada do filtro. */
export function ehCamadaAninhadaDoFiltro(alvo: EventTarget | null): boolean {
  return Boolean(
    alvo &&
      typeof (alvo as Element).closest === "function" &&
      (alvo as Element).closest(SELETOR_CAMADA_ANINHADA_DO_FILTRO)
  );
}

/** Há uma camada aninhada aberta no DOM (lista de condição, calendário, cmd-panel). */
export function haCamadaAninhadaDoFiltroAberta(doc: ParentNode = typeof document !== "undefined" ? document : (null as unknown as ParentNode)): boolean {
  return Boolean(doc?.querySelector?.(SELETOR_CAMADA_ANINHADA_DO_FILTRO));
}

/** Ponteiro geometricamente sobre o elemento (ignora `pointer-events: none` do Select aninhado). */
export function ponteiroSobreElemento(
  ponto: Pick<MouseEvent, "clientX" | "clientY"> | null | undefined,
  el: Element | null | undefined,
): boolean {
  if (!ponto || !el) return false;
  const r = el.getBoundingClientRect();
  return ponto.clientX >= r.left && ponto.clientX <= r.right && ponto.clientY >= r.top && ponto.clientY <= r.bottom;
}

/**
 * Clique “fora” do shell do filtro? `false` = manter aberto (dentro, âncora, camada
 * portalada, ou ponteiro sobre o shell/âncora apesar de `pointer-events: none`).
 */
function ehNo(alvo: EventTarget | null): alvo is Node {
  return Boolean(alvo && typeof (alvo as Node).nodeType === "number");
}

export function deveFecharFiltroPorFora(opts: {
  alvo: EventTarget | null;
  ponto?: Pick<MouseEvent, "clientX" | "clientY"> | null;
  shell: Element | null | undefined;
  ancora?: Element | null | undefined;
}): boolean {
  const { alvo, ponto, shell, ancora } = opts;
  if (shell && ehNo(alvo) && typeof shell.contains === "function" && shell.contains(alvo)) return false;
  if (ancora && ehNo(alvo) && typeof ancora.contains === "function" && ancora.contains(alvo)) return false;
  if (ehCamadaAninhadaDoFiltro(alvo)) return false;
  if (ponto && (ponteiroSobreElemento(ponto, shell) || ponteiroSobreElemento(ponto, ancora))) return false;
  return true;
}
