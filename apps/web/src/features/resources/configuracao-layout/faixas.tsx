"use client";
/**
 * CONFIGURAÇÃO DE LAYOUT — faixa de painéis e faixa de cards (VISUAL-UX-03, decisão 275, 4.3).
 *
 * Desenha a VISTA que a página passa (o layout sem o item na mão) e avisa a página: selecionar, renomear (dois cliques,
 * só na edição), adicionar, excluir e a largura do card. Arrastar uma aba ou uma pílula começa no `iniciar` do motor
 * (arraste.tsx); cada aba e cada pílula é um alvo `{ t: "painel" | "card", indice }` (índice na vista), mais um alvo de
 * fim (índice = quantidade), e o vão verde com o nome abre em `previsao.antes`.
 *
 * Quando a faixa não cabe, aparecem as setas ‹ › nas pontas e a faixa mostra uma JANELA: as abas que cabem inteiras, a
 * partir da primeira visível; cada clique anda uma aba. A janela é calculada pela largura real de cada aba, recua para
 * não sobrar buraco no fim (o `ancorar` do desenho) e vai até a aba ativa quando ela muda. A faixa nunca empurra o + nem
 * a lixeira.
 */
import * as React from "react";
import { BetweenHorizontalStart, ChevronLeft, ChevronRight, Plus, RectangleHorizontal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useArraste } from "./arraste";
import { cardsDoPainel, contagemDoCard } from "./rascunho";
import type { LayoutCard } from "@agro/shared";
import { alvo, type PropsFaixas } from "./tipos";
import estilos from "./estrutura.module.css";
/* a dica é uma só (W1): aqui só se escolhe a ancoragem nas pontas, para ela não sair do documento */
import estilosPagina from "./pagina.module.css";

/** o que as setas tiram da faixa: 25 px do botão + 8 px de folga de cada lado (`.navEsq` / `.navDir`) */
const CUSTO_SETAS_PAINEIS = 2 * (25 + 8);
/** idem, mais o gap de 6 px da faixa de cards entre a seta e a rolagem */
const CUSTO_SETAS_CARDS = 2 * (25 + 8 + 6);
const LARGURA_CAIXA_MINIMA = 70;
const LARGURA_CAIXA_MAXIMA = 280;
const MAXIMO_DO_NOME = 60;
const DICA_RENOMEAR = "Dois cliques para renomear";

const sim = (v: boolean): "true" | undefined => (v ? "true" : undefined);

interface Janela { setas: boolean; ini: number; fim: number; n: number }

interface ApiJanela {
  refFaixa: React.RefObject<HTMLDivElement | null>;
  refRolagem: React.RefObject<HTMLDivElement | null>;
  setas: boolean;
  podeAnterior: boolean;
  podeProximo: boolean;
  anterior: () => void;
  proximo: () => void;
  /** a aba `i` está fora da janela (escondida, mas medível) */
  fora: (i: number) => boolean;
  /** a dica da aba `i`: ancorada pela borda de fora na primeira e na última visíveis (a rolagem corta na horizontal) */
  dica: (i: number, n: number) => string | undefined;
}

/**
 * A janela das setas. Mede a largura de cada `[data-medir]` dentro da rolagem; se a soma cabe, não há setas; senão, mostra
 * as que cabem inteiras a partir de `ini`. `chave` zera o início (ex.: troca de painel na faixa de cards).
 */
function useJanela(ativo: number, custoSetas: number, chave: string): ApiJanela {
  const refFaixa = React.useRef<HTMLDivElement | null>(null);
  const refRolagem = React.useRef<HTMLDivElement | null>(null);
  const refInicio = React.useRef(0);
  const refAtivo = React.useRef<number | null>(null);
  const refChave = React.useRef(chave);
  const [janela, setJanela] = React.useState<Janela>({ setas: false, ini: 0, fim: 0, n: 0 });
  const [, setTique] = React.useState(0);
  const recalcular = React.useCallback(() => setTique((t) => t + 1), []);

  React.useLayoutEffect(() => {
    const rolagem = refRolagem.current;
    if (!rolagem) return;
    if (refChave.current !== chave) { refChave.current = chave; refInicio.current = 0; refAtivo.current = null; }
    const larguras = Array.from(rolagem.querySelectorAll<HTMLElement>("[data-medir]"), (el) => el.offsetWidth);
    const n = larguras.length;
    const vao = Number.parseFloat(getComputedStyle(rolagem).columnGap) || 0;
    const disponivel = rolagem.clientWidth + (janela.setas ? custoSetas : 0);
    const total = larguras.reduce((soma, w) => soma + w, 0) + vao * Math.max(0, n - 1);
    let proxima: Janela;
    if (n === 0 || total <= disponivel) {
      proxima = { setas: false, ini: 0, fim: n, n };
    } else {
      const orcamento = disponivel - custoSetas;
      const fimDe = (ini: number): number => {
        let usado = 0;
        let fim = ini;
        for (let i = ini; i < n; i++) {
          const w = (larguras[i] ?? 0) + (i > ini ? vao : 0);
          if (usado + w > orcamento && fim > ini) break;
          usado += w;
          fim = i + 1;
        }
        return fim;
      };
      let ini = Math.min(Math.max(0, refInicio.current), n - 1);
      /* a aba ativa fica à vista quando muda */
      if (ativo !== refAtivo.current && ativo >= 0 && ativo < n) {
        if (ativo < ini) ini = ativo;
        else while (ini < ativo && fimDe(ini) <= ativo) ini++;
      }
      /* o início recua enquanto a janela continuar terminando na última: não sobra buraco */
      while (ini > 0 && fimDe(ini - 1) >= n) ini--;
      proxima = { setas: true, ini, fim: fimDe(ini), n };
    }
    refAtivo.current = ativo;
    refInicio.current = proxima.ini;
    if (proxima.setas !== janela.setas || proxima.ini !== janela.ini || proxima.fim !== janela.fim || proxima.n !== janela.n) setJanela(proxima);
  });

  React.useEffect(() => {
    const faixa = refFaixa.current;
    if (!faixa) return;
    const observador = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => recalcular());
    observador?.observe(faixa);
    let vivo = true;
    void document.fonts?.ready.then(() => { if (vivo) recalcular(); });
    return () => { vivo = false; observador?.disconnect(); };
  }, [recalcular]);

  return {
    refFaixa,
    refRolagem,
    setas: janela.setas,
    podeAnterior: janela.setas && janela.ini > 0,
    podeProximo: janela.setas && janela.fim < janela.n,
    anterior: () => { refInicio.current = Math.max(0, janela.ini - 1); recalcular(); },
    proximo: () => { refInicio.current = janela.ini + 1; recalcular(); },
    fora: (i) => janela.setas && (i < janela.ini || i >= janela.fim),
    dica: (i, n) => {
      const primeira = janela.setas ? janela.ini : 0;
      const ultima = janela.setas ? janela.fim - 1 : n - 1;
      if (i === primeira) return estilosPagina.dicaInicio;
      if (i === ultima && janela.setas) return estilosPagina.dicaFim;
      return undefined;
    }
  };
}

/** a caixa de renomear: o texto em edição é daqui; Enter e sair gravam, Esc cancela, vazio cancela */
function CaixaRenomear({ tipo, id, inicial, aoRenomear }: { tipo: "painel" | "card"; id: string; inicial: string; aoRenomear: PropsFaixas["aoRenomear"] }) {
  const [texto, setTexto] = React.useState(inicial);
  const ref = React.useRef<HTMLInputElement | null>(null);
  const encerrada = React.useRef(false);
  React.useEffect(() => {
    const caixa = ref.current;
    if (!caixa) return;
    caixa.focus();
    caixa.select();
  }, []);
  const encerrar = (nome: string | null) => {
    if (encerrada.current) return;
    encerrada.current = true;
    const limpo = nome === null ? "" : nome.trim();
    aoRenomear(tipo, id, limpo ? limpo : null);
  };
  const largura = Math.round(Math.max(LARGURA_CAIXA_MINIMA, Math.min(LARGURA_CAIXA_MAXIMA, texto.length * 7.6 + 26)));
  return (
    <input
      ref={ref}
      className={cn(estilos.renomear, tipo === "card" && estilos.renomearCard)}
      style={{ width: largura }}
      value={texto}
      maxLength={MAXIMO_DO_NOME}
      aria-label={tipo === "painel" ? "Renomear painel" : "Renomear card"}
      data-medir={tipo === "card" ? "" : undefined}
      onChange={(e) => setTexto(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); encerrar(texto); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); encerrar(null); }
      }}
      onBlur={() => encerrar(texto)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

/** o vão verde de aba e pílula: fechado não ocupa nada; aberto mostra o nome do que está na mão */
function VaoFaixa({ quente, rotulo, crescer }: { quente: boolean; rotulo: string; crescer?: boolean }) {
  return (
    <span
      className={cn(estilos.vaoFaixa, quente && estilos.vaoFaixaQuente)}
      style={crescer ? { flexGrow: 1 } : undefined}
      data-parte={quente ? "vao-faixa" : undefined}
      aria-hidden="true"
    >
      <span className={estilos.vaoFaixaInterno}>{quente ? rotulo : ""}</span>
    </span>
  );
}

function Setas({ api, anterior, proximo, lado }: { api: ApiJanela; anterior: string; proximo: string; lado: "esq" | "dir" }) {
  if (!api.setas) return null;
  return lado === "esq" ? (
    <span className={cn(estilos.nav, estilos.navEsq)}>
      <button type="button" className={cn(estilos.botaoRedondo, estilosPagina.dicaInicio)} aria-label={anterior} data-dica={anterior} disabled={!api.podeAnterior} onClick={api.anterior}>
        <ChevronLeft size={14} />
      </button>
    </span>
  ) : (
    <span className={cn(estilos.nav, estilos.navDir)}>
      <button type="button" className={cn(estilos.botaoRedondo, estilosPagina.dicaFim)} aria-label={proximo} data-dica={proximo} disabled={!api.podeProximo} onClick={api.proximo}>
        <ChevronRight size={14} />
      </button>
    </span>
  );
}

export function Faixas(props: PropsFaixas) {
  const { item, previsao, pouso, iniciar } = useArraste();
  const edicao = props.modo === "edicao";
  const paineis = props.layout.panels;
  const cards = cardsDoPainel(props.layout, props.painelId);
  /* a pílula do card ativo na mão sai da vista: até soltar, vale o card ativo que estava na faixa (largura e lixeira) */
  const refCardAtivo = React.useRef<LayoutCard | undefined>(undefined);
  const cardNaVista = cards.find((c) => c.id === props.cardId);
  const cardAtivo = cardNaVista
    ?? (item?.tipo === "card" && item.cardId === props.cardId && refCardAtivo.current?.id === props.cardId ? refCardAtivo.current : undefined);
  React.useEffect(() => { if (cardNaVista) refCardAtivo.current = cardNaVista; });
  const meio = cardAtivo?.colSpan === 6;

  const janelaPaineis = useJanela(paineis.findIndex((p) => p.id === props.painelId), CUSTO_SETAS_PAINEIS, "paineis");
  const janelaCards = useJanela(cards.findIndex((c) => c.id === props.cardId), CUSTO_SETAS_CARDS, props.painelId);

  const vaoPainel = item?.tipo === "painel" && previsao?.tipo === "painel" ? previsao.antes : null;
  const vaoCard = item?.tipo === "card" && previsao?.tipo === "card" ? previsao.antes : null;
  const rotuloNaMao = item?.rotulo ?? "";
  const dicaLargura = meio ? "Card meio — clique para inteiro" : "Card inteiro — clique para meio";
  const renomeandoPainel = edicao && props.renomeando?.tipo === "painel" ? props.renomeando.id : null;
  const renomeandoCard = edicao && props.renomeando?.tipo === "card" ? props.renomeando.id : null;

  return (
    <>
      <div ref={janelaPaineis.refFaixa} role="tablist" aria-label="Painéis do formulário" data-parte="faixa-paineis" className={estilos.faixaPaineis}>
        <Setas api={janelaPaineis} anterior="Painéis anteriores" proximo="Próximos painéis" lado="esq" />
        <div ref={janelaPaineis.refRolagem} className={estilos.rolagemPaineis}>
          {paineis.map((p, i) => {
            const ativo = p.id === props.painelId;
            const contagem = props.contagemDoPainel(p.id);
            return (
              <span
                key={p.id}
                className={cn(estilos.envoltorioAba, janelaPaineis.fora(i) && estilos.foraDaJanela)}
                data-alvo={alvo({ t: "painel", indice: i })}
              >
                <VaoFaixa quente={vaoPainel === i} rotulo={rotuloNaMao} />
                {renomeandoPainel === p.id ? (
                  <span className={cn(estilos.aba, estilos.abaRenomeando)} data-parte="aba-painel" data-id={p.id} data-medir="">
                    <CaixaRenomear tipo="painel" id={p.id} inicial={p.label} aoRenomear={props.aoRenomear} />
                  </span>
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={ativo}
                    data-parte="aba-painel"
                    data-id={p.id}
                    data-medir=""
                    data-dica={edicao ? DICA_RENOMEAR : undefined}
                    data-pousa={sim(pouso?.tipo === "painel" && pouso.panelId === p.id)}
                    className={cn(estilos.aba, edicao && janelaPaineis.dica(i, paineis.length))}
                    onClick={() => props.aoSelecionarPainel(p.id)}
                    onDoubleClick={edicao ? () => props.aoIniciarRenomear("painel", p.id) : undefined}
                    onPointerDown={edicao ? (e) => iniciar(e, { tipo: "painel", panelId: p.id, rotulo: p.label, detalhe: String(contagem) }) : undefined}
                  >
                    {p.label}
                    <span className={estilos.contador}>{contagem}</span>
                  </button>
                )}
              </span>
            );
          })}
          <span className={estilos.envoltorioAba} style={{ flexGrow: 1 }} data-alvo={alvo({ t: "painel", indice: paineis.length })}>
            <VaoFaixa quente={vaoPainel !== null && vaoPainel >= paineis.length} rotulo={rotuloNaMao} crescer />
          </span>
        </div>
        <Setas api={janelaPaineis} anterior="Painéis anteriores" proximo="Próximos painéis" lado="dir" />
        {edicao && (
          <span className={estilos.fixo}>
            <button type="button" className={cn(estilos.botaoRedondo, estilos.botaoNovo, estilosPagina.dicaFim)} aria-label="Adicionar painel" data-dica="Adicionar painel" onClick={props.aoAdicionarPainel}>
              <Plus size={14} />
            </button>
            <button
              type="button"
              className={cn(estilos.lixeira, estilosPagina.dicaFim)}
              aria-label="Excluir painel"
              data-dica={props.motivoNaoExcluirPainel ?? "Excluir este painel"}
              disabled={props.motivoNaoExcluirPainel !== null}
              onClick={props.aoExcluirPainel}
            >
              <Trash2 size={15} />
            </button>
          </span>
        )}
      </div>

      <div ref={janelaCards.refFaixa} role="tablist" aria-label="Cards do painel" data-parte="faixa-cards" className={estilos.faixaCards}>
        <Setas api={janelaCards} anterior="Cards anteriores" proximo="Próximos cards" lado="esq" />
        <div ref={janelaCards.refRolagem} className={estilos.rolagemCards}>
          {cards.map((c, i) => {
            const ativo = c.id === props.cardId;
            /* a contagem é a do documento: o campo na mão ainda é do card de origem (no desenho o "· N" não muda no arraste) */
            const contagem = contagemDoCard(c) + (item?.tipo === "campo" && item.origem.cardId === c.id ? 1 : 0);
            return (
              <span
                key={c.id}
                className={cn(estilos.envoltorioAba, janelaCards.fora(i) && estilos.foraDaJanela)}
                data-alvo={alvo({ t: "card", indice: i })}
              >
                <VaoFaixa quente={vaoCard === i} rotulo={rotuloNaMao} />
                {renomeandoCard === c.id ? (
                  <CaixaRenomear tipo="card" id={c.id} inicial={c.label} aoRenomear={props.aoRenomear} />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={ativo}
                    data-parte="pilula-card"
                    data-id={c.id}
                    data-medir=""
                    data-dica={edicao ? DICA_RENOMEAR : undefined}
                    data-pousa={sim(pouso?.tipo === "card" && pouso.cardId === c.id)}
                    className={cn(estilos.pilula, edicao && janelaCards.dica(i, cards.length))}
                    onClick={() => props.aoSelecionarCard(c.id)}
                    onDoubleClick={edicao ? () => props.aoIniciarRenomear("card", c.id) : undefined}
                    onPointerDown={edicao ? (e) => iniciar(e, { tipo: "card", cardId: c.id, rotulo: c.label, detalhe: `· ${contagem}` }) : undefined}
                  >
                    {c.label}
                    <span className={estilos.pilulaMeta}>· {contagem}</span>
                  </button>
                )}
              </span>
            );
          })}
          <span className={estilos.envoltorioAba} style={{ flexGrow: 1 }} data-alvo={alvo({ t: "card", indice: cards.length })}>
            <VaoFaixa quente={vaoCard !== null && vaoCard >= cards.length} rotulo={rotuloNaMao} crescer />
          </span>
        </div>
        <Setas api={janelaCards} anterior="Cards anteriores" proximo="Próximos cards" lado="dir" />
        {edicao && (
          <span className={estilos.fixo}>
            <button
              type="button"
              className={cn(estilos.botaoRedondo, estilosPagina.dicaFim)}
              aria-label={dicaLargura}
              data-dica={dicaLargura}
              data-parte="largura-card"
              disabled={!cardAtivo}
              onClick={props.aoAlternarLargura}
            >
              {meio ? <BetweenHorizontalStart size={14} /> : <RectangleHorizontal size={14} />}
            </button>
            <button type="button" className={cn(estilos.botaoRedondo, estilos.botaoNovo, estilosPagina.dicaFim)} aria-label="Adicionar card" data-dica="Adicionar card" onClick={props.aoAdicionarCard}>
              <Plus size={14} />
            </button>
            <button
              type="button"
              className={cn(estilos.lixeira, estilosPagina.dicaFim)}
              aria-label="Excluir card"
              data-dica={props.motivoNaoExcluirCard ?? "Excluir este card"}
              disabled={props.motivoNaoExcluirCard !== null}
              onClick={props.aoExcluirCard}
            >
              <Trash2 size={15} />
            </button>
          </span>
        )}
      </div>
    </>
  );
}
