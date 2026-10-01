"use client";
/**
 * CONFIGURAÇÃO DE LAYOUT — o motor do arrastar (decisão 275). Ponteiro, não o arrastar nativo (draggable):
 *  - `iniciar` registra o ponto e a caixa do item; o arraste só começa depois de 4 px (antes disso o pointerup é um
 *    clique normal: clique, dois cliques e foco seguem como estão). Botão ou caixa DENTRO do item (⚙, ×, +, lixeira,
 *    caixa de renomear, `[data-sem-arraste]`) não começa arraste;
 *  - os movimentos são ouvidos no DOCUMENTO, sem setPointerCapture: o item sai do DOM ao ser pego (a captura iria junto)
 *    e, com captura, o alvo sob o ponteiro não seria achado;
 *  - o alvo é o `[data-alvo]` sob o ponteiro (`elementFromPoint`; o fantasma tem pointer-events: none), lido com
 *    `lerAlvo`, e a tela recebe a previsão de `props.prever`;
 *  - soltar com previsão válida chama `props.soltar` (UMA entrada na pilha) e marca o `pouso`; soltar fora de alvo, numa
 *    recusa, Esc, pointercancel DESTE ponteiro, menu de contexto, botão solto sem o pointerup chegar (fora da janela) e
 *    perder o foco da janela: nada muda. O clique de ponteiro que o navegador dispara junto do pointerup que encerra um
 *    arraste é engolido (não seleciona nada sem querer); clique de teclado (Enter, Espaço) nunca é.
 * O fantasma é uma cópia do item num portal em document.body; inclinação, pegada e largura seguem o `moverFn` do desenho.
 */
import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import estilos from "./arraste.module.css";
import { lerAlvo, type ApiArraste, type ItemArrastado, type Pouso, type Previsao, type PropsProvedorArraste } from "./tipos";

/** distância (px) que o ponteiro anda com o botão apertado antes de o arraste começar */
const LIMIAR = 4;
/** quanto o `pouso` fica marcado: a animação "pousa" do desenho dura --mo-set (340 ms) + folga */
const DURACAO_DO_POUSO = 380;
/** inclinação de repouso do fantasma (graus), a do desenho */
const ANGULO_DE_REPOUSO = -1.2;
/** dentro do item, estes não começam arraste */
const CONTROLE_INTERNO = "button, input, textarea, select, a[href], [contenteditable=''], [contenteditable='true'], [data-sem-arraste]";

interface Fantasma { x: number; y: number; angulo: number; largura: number }

interface Sessao {
  item: ItemArrastado;
  ponteiro: number;
  /** onde o botão foi apertado */
  x0: number;
  y0: number;
  /** a pegada: onde o ponteiro encostou no item, e a largura dele */
  ox: number;
  oy: number;
  largura: number;
  fase: "espera" | "arrastando" | "cancelada";
  /** última posição do fantasma (canto superior esquerdo) e o ângulo atual */
  ultimo: { x: number; y: number } | null;
  /** último ponto do ponteiro (para reler o alvo quando a área rola sem o ponteiro andar) */
  px: number;
  py: number;
  angulo: number;
  /** último `data-alvo` lido (undefined = nenhum ainda) e a previsão dele */
  alvo: string | null | undefined;
  previsao: Previsao | null;
}

interface Saidas {
  props: React.RefObject<Pick<PropsProvedorArraste, "ativo" | "prever" | "soltar">>;
  setItem: (i: ItemArrastado | null) => void;
  setPrevisao: (p: Previsao | null) => void;
  setPouso: (p: Pouso | null) => void;
  setFantasma: (f: Fantasma | null) => void;
}

const SEM_ARRASTE: ApiArraste = { item: null, previsao: null, pouso: null, iniciar: () => undefined };
const ContextoArraste = React.createContext<ApiArraste>(SEM_ARRASTE);

const mesmaPrevisao = (a: Previsao | null, b: Previsao | null): boolean => JSON.stringify(a) === JSON.stringify(b);
/** recusa = soltar ali não muda nada (troca com campo do sistema vindo da coluna; coluna com campo do sistema ou com item dela mesma) */
const ehRecusa = (p: Previsao): boolean => (p.tipo === "trocar" && p.recusa) || (p.tipo === "coluna" && p.recusa !== null);

/** O que pousa: o campo (e, na troca entre linhas, também o outro), a linha no índice final, a aba, a pílula. */
function pousoDe(item: ItemArrastado, p: Previsao): Pouso | null {
  switch (p.tipo) {
    case "inserir":
      return item.tipo === "campo" || item.tipo === "disponivel" ? { tipo: "campo", fids: [item.fid] } : null;
    case "trocar":
      if (item.tipo === "campo") return { tipo: "campo", fids: [item.fid, p.fidAlvo] };
      return item.tipo === "disponivel" ? { tipo: "campo", fids: [item.fid] } : null;
    case "coluna":
      return null;
    case "linha":
      // `antes` é a posição na lista SEM a linha: é o índice final dela
      return { tipo: "linha", cardId: p.cardId, linha: p.antes };
    case "painel":
      return item.tipo === "painel" ? { tipo: "painel", panelId: item.panelId } : null;
    case "card":
      return item.tipo === "card" ? { tipo: "card", cardId: item.cardId } : null;
  }
}

function ehControleInterno(alvo: EventTarget | null, item: HTMLElement): boolean {
  for (let el = alvo instanceof Element ? alvo : null; el && el !== item; el = el.parentElement) if (el.matches(CONTROLE_INTERNO)) return true;
  return false;
}

/** O motor fica fora do React: ouvintes no documento, um arraste por vez. A tela só recebe o estado pelos `set*`. */
function criarMotor(s: Saidas) {
  let sessao: Sessao | null = null;
  let relogioDoPouso: ReturnType<typeof setTimeout> | null = null;
  let largarClique: (() => void) | null = null;
  /** a mão fechada (e nada de seleção de texto) na raiz do documento enquanto há algo na mão */
  const maoFechada = (sim: boolean) => { const classe = estilos.arrastando; if (classe) document.documentElement.classList.toggle(classe, sim); };

  const limparPouso = () => { if (relogioDoPouso) clearTimeout(relogioDoPouso); relogioDoPouso = null; s.setPouso(null); };
  const marcarPouso = (p: Pouso) => {
    if (relogioDoPouso) clearTimeout(relogioDoPouso);
    s.setPouso(p);
    relogioDoPouso = setTimeout(() => { relogioDoPouso = null; s.setPouso(null); }, DURACAO_DO_POUSO);
  };

  /**
   * O navegador dispara o click no mesmo ciclo do pointerup: depois de um arraste ele não pode selecionar nada. Só o
   * clique de PONTEIRO (detail > 0) é engolido, e a armadilha expira no fim do ciclo: Enter ou Espaço depois nunca somem.
   */
  const engolirClique = () => {
    largarClique?.();
    const engole = (e: MouseEvent) => { if (e.detail === 0) return; e.preventDefault(); e.stopPropagation(); largar(); };
    const relogio = setTimeout(() => largar(), 0);
    const largar = () => {
      clearTimeout(relogio);
      window.removeEventListener("click", engole, true);
      window.removeEventListener("pointerdown", largar, true);
      if (largarClique === largar) largarClique = null;
    };
    window.addEventListener("click", engole, true);
    window.addEventListener("pointerdown", largar, true);
    largarClique = largar;
  };

  /** tira o que está na mão da tela (fantasma, previsão, item, a mão fechada) */
  const soltarDaMao = () => {
    maoFechada(false);
    s.setItem(null);
    s.setPrevisao(null);
    s.setFantasma(null);
  };

  const desligar = () => {
    document.removeEventListener("pointermove", aoMover, true);
    document.removeEventListener("pointerup", aoSoltar, true);
    document.removeEventListener("pointercancel", aoCancelarPonteiro, true);
    document.removeEventListener("contextmenu", aoInterromper, true);
    document.removeEventListener("dragstart", aoArrastoNativo, true);
    document.removeEventListener("scroll", aoRolar, true);
    window.removeEventListener("keydown", aoTeclar, true);
    window.removeEventListener("blur", aoInterromper);
  };
  const ligar = () => {
    document.addEventListener("pointermove", aoMover, true);
    document.addEventListener("pointerup", aoSoltar, true);
    document.addEventListener("pointercancel", aoCancelarPonteiro, true);
    document.addEventListener("contextmenu", aoInterromper, true);
    document.addEventListener("dragstart", aoArrastoNativo, true);
    document.addEventListener("scroll", aoRolar, true);
    window.addEventListener("keydown", aoTeclar, true);
    window.addEventListener("blur", aoInterromper);
  };

  const encerrar = () => {
    const tinhaNaMao = sessao?.fase === "arrastando";
    sessao = null;
    desligar();
    if (tinhaNaMao) soltarDaMao();
  };

  /** o fantasma segue o ponteiro menos a pegada e inclina para o lado em que vai (o `moverFn` do desenho) */
  const moverFantasma = (atual: Sessao, cx: number, cy: number) => {
    const x = cx - atual.ox;
    const y = cy - atual.oy;
    const u = atual.ultimo;
    if (u && Math.abs(x - u.x) < 1 && Math.abs(y - u.y) < 1) return;
    const dx = u ? x - u.x : 0;
    const mira = Math.abs(dx) < 0.7 ? ANGULO_DE_REPOUSO : Math.max(-6, Math.min(6, dx * 0.5));
    atual.angulo = Math.round((atual.angulo * 0.55 + mira * 0.45) * 100) / 100;
    atual.ultimo = { x, y };
    s.setFantasma({ x, y, angulo: atual.angulo, largura: atual.largura });
  };

  /** lê o alvo sob o ponteiro e pede a previsão (só quando o alvo muda: item e layout não mudam durante o arraste) */
  const mirar = (atual: Sessao, cx: number, cy: number) => {
    const sob = document.elementFromPoint(cx, cy);
    const bruto = sob instanceof Element ? sob.closest("[data-alvo]")?.getAttribute("data-alvo") ?? null : null;
    if (bruto === atual.alvo) return;
    atual.alvo = bruto;
    const a = lerAlvo(bruto);
    const p = a ? s.props.current.prever(atual.item, a) : null;
    if (mesmaPrevisao(p, atual.previsao)) return;
    atual.previsao = p;
    s.setPrevisao(p);
  };

  function aoMover(e: PointerEvent) {
    const atual = sessao;
    if (!atual || e.pointerId !== atual.ponteiro) return;
    // o botão principal já não está apertado: o pointerup se perdeu (solto fora da janela, menu de contexto) — cancela
    if ((e.buttons & 1) === 0) { encerrar(); return; }
    if (atual.fase === "cancelada") return;
    atual.px = e.clientX;
    atual.py = e.clientY;
    if (atual.fase === "espera") {
      if (Math.hypot(e.clientX - atual.x0, e.clientY - atual.y0) < LIMIAR) return;
      atual.fase = "arrastando";
      window.getSelection()?.removeAllRanges();
      maoFechada(true);
      if (relogioDoPouso) clearTimeout(relogioDoPouso);
      relogioDoPouso = null;
      // o item sai do lugar e o fantasma aparece no mesmo quadro; o alvo é lido já na tela sem o item (a VISTA)
      flushSync(() => { s.setPouso(null); s.setItem(atual.item); moverFantasma(atual, e.clientX, e.clientY); });
    } else moverFantasma(atual, e.clientX, e.clientY);
    mirar(atual, e.clientX, e.clientY);
  }

  function aoSoltar(e: PointerEvent) {
    const atual = sessao;
    if (!atual || e.pointerId !== atual.ponteiro) return;
    if (atual.fase === "espera") { encerrar(); return; } // foi um clique
    if (atual.fase === "arrastando") mirar(atual, e.clientX, e.clientY);
    const p = atual.fase === "arrastando" ? atual.previsao : null;
    encerrar();
    engolirClique();
    if (!p || ehRecusa(p)) return;
    s.props.current.soltar(atual.item, p);
    const pouso = pousoDe(atual.item, p);
    if (pouso) marcarPouso(pouso);
  }

  /** Esc: o que está na mão volta para o lugar; o pointerup que ainda vem só engole o clique */
  function aoTeclar(e: KeyboardEvent) {
    if (e.key !== "Escape" || sessao?.fase !== "arrastando") return;
    e.preventDefault();
    e.stopPropagation();
    sessao.fase = "cancelada";
    soltarDaMao();
  }

  /** a área das linhas (ou a lista da coluna) rolou com o item na mão: o que está sob o ponteiro mudou */
  function aoRolar() { if (sessao?.fase === "arrastando") mirar(sessao, sessao.px, sessao.py); }

  /** menu de contexto e a janela perdendo o foco: nada muda e nenhum clique vem depois */
  function aoInterromper() { if (sessao) encerrar(); }

  /** pointercancel só vale para o ponteiro do arraste em curso (outro dedo, outra caneta não cancelam nada) */
  function aoCancelarPonteiro(e: PointerEvent) { if (sessao && e.pointerId === sessao.ponteiro) encerrar(); }

  /** texto já selecionado ou imagem dentro do item não abrem o arrastar nativo por cima do nosso */
  function aoArrastoNativo(e: DragEvent) { e.preventDefault(); }

  return {
    iniciar(e: React.PointerEvent<HTMLElement>, item: ItemArrastado) {
      if (!s.props.current.ativo || sessao || e.button !== 0 || !e.isPrimary) return;
      if (ehControleInterno(e.target, e.currentTarget)) return;
      const caixa = e.currentTarget.getBoundingClientRect();
      sessao = {
        item, ponteiro: e.pointerId, x0: e.clientX, y0: e.clientY, px: e.clientX, py: e.clientY,
        ox: e.clientX - caixa.left, oy: e.clientY - caixa.top, largura: caixa.width,
        fase: "espera", ultimo: null, angulo: ANGULO_DE_REPOUSO, alvo: undefined, previsao: null
      };
      ligar();
    },
    /** a tela saiu da edição no meio de um arraste */
    cancelar() { if (sessao) encerrar(); },
    /** desmontar (ou o efeito rodar de novo, no modo estrito e no recarregamento a quente): nada fica preso na mão */
    desmontar() {
      sessao = null;
      desligar();
      soltarDaMao();
      limparPouso();
      largarClique?.();
    },
    limparPouso
  };
}

/** Uma cópia do item que segue o ponteiro (campo 30 px, linha 32 px, aba 26 px e card 23 px em pílula). */
function FantasmaDoItem({ item, f, trocando }: { item: ItemArrastado; f: Fantasma; trocando: boolean }) {
  const ehCampo = item.tipo === "campo" || item.tipo === "disponivel";
  const obrigatorio = ehCampo && item.obrigatorio;
  const largura = Math.round(Math.max(60, Math.min(item.tipo === "linha" ? 460 : 340, f.largura || 160)));
  const forma = ehCampo ? estilos.campo : item.tipo === "linha" ? estilos.linha : item.tipo === "painel" ? estilos.aba : estilos.card;
  return <div aria-hidden="true" data-parte="fantasma" data-tipo={item.tipo} data-trocando={trocando ? "true" : undefined} data-obrigatorio={obrigatorio ? "true" : undefined}
    className={cn(estilos.fantasma, forma, obrigatorio && estilos.obrigatorio, trocando && estilos.trocando)}
    style={{ left: Math.round(f.x), top: Math.round(f.y), width: largura, transform: `rotate(${f.angulo}deg) scale(1.03)` }}>
    {ehCampo
      ? <><span className={estilos.rotulo}>{item.rotulo}</span>{obrigatorio && <span className={estilos.asterisco}>*</span>}</>
      : item.tipo === "linha"
        ? <><span className={estilos.titulo}>{item.rotulo}</span>{item.detalhe && <span className={estilos.contador}>{item.detalhe}</span>}</>
        : <>{item.rotulo}{item.detalhe && <span className={estilos.selo}>{item.detalhe}</span>}</>}
  </div>;
}

export function ProvedorArraste({ ativo, prever, soltar, children }: PropsProvedorArraste) {
  const [item, setItem] = React.useState<ItemArrastado | null>(null);
  const [previsao, setPrevisao] = React.useState<Previsao | null>(null);
  const [pouso, setPouso] = React.useState<Pouso | null>(null);
  const [fantasma, setFantasma] = React.useState<Fantasma | null>(null);
  // os ouvintes do documento leem sempre as props da última renderização
  const props = React.useRef({ ativo, prever, soltar });
  React.useLayoutEffect(() => { props.current = { ativo, prever, soltar }; });
  const [motor] = React.useState(() => criarMotor({ props, setItem, setPrevisao, setPouso, setFantasma }));
  React.useEffect(() => () => motor.desmontar(), [motor]);
  React.useEffect(() => { if (!ativo) { motor.cancelar(); motor.limparPouso(); } }, [ativo, motor]);

  const api = React.useMemo<ApiArraste>(() => ({ item, previsao, pouso, iniciar: motor.iniciar }), [item, previsao, pouso, motor]);
  return <ContextoArraste.Provider value={api}>
    {children}
    {item && fantasma ? createPortal(<FantasmaDoItem item={item} f={fantasma} trocando={previsao?.tipo === "trocar"} />, document.body) : null}
  </ContextoArraste.Provider>;
}

export const useArraste = (): ApiArraste => React.useContext(ContextoArraste);
