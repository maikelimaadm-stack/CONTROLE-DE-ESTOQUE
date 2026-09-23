"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { FilePlus2, Loader2 } from "lucide-react";
import { Tabs } from "@/components/ui";
import estilos from "./central-vendas-workspace.module.css";

/**
 * CENTRAL DE VENDAS — WORKSPACE FOUNDATION (VISUAL-UX-01, fidelidade na R1).
 *
 * ┌─ O QUE ESTE COMPONENTE É, E O QUE ELE NUNCA DECIDE ────────────────────────────────────────────┐
 * │ É COMPOSIÇÃO VISUAL: barra de ações de altura fixa, coluna de Dados principais, área de Itens,  │
 * │ painel inferior por abas e dois divisores redimensionáveis. Ele recebe cada região já pronta,   │
 * │ como nó React, e a organiza na tela.                                                            │
 * │                                                                                                  │
 * │ Ele NÃO conhece o formulário: não sabe o que é uma TOP, não sabe se a escrita está autorizada, │
 * │ não monta payload, não chama API. Tudo isso continua na página (`vendas/[kind]/new/page.tsx`), │
 * │ onde já estava — a moldura mudou de forma, o contrato funcional não mudou de lugar. Foi assim   │
 * │ de propósito: regra de negócio que migra para um componente "porque ficou bonito" é regra que  │
 * │ a próxima fatia visual desfaz sem perceber.                                                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ DIVISORES: ESTADO DE TELA, E SÓ ──────────────────────────────────────────────────────────────┐
 * │ A largura de Dados principais (17%–52%) e a altura do painel inferior (92–430px) vivem em       │
 * │ `useState` e morrem com a tela. NÃO há `localStorage`, `sessionStorage`, perfil de usuário nem  │
 * │ API: a persistência foi deixada explicitamente sem decisão funcional (SPLITTER_PERSISTENCE =    │
 * │ NONE), e um estado que se guarda "só por enquanto" vira contrato no dia em que alguém depende   │
 * │ dele. Remontar a tela devolve o padrão — e o E2E cobra exatamente isso.                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AS ABAS SÃO O PRIMITIVE OFICIAL ──────────────────────────────────────────────────────────────┐
 * │ `Tabs` de `@/components/ui` (Radix) já entrega `tablist`/`tab`/`tabpanel`, setas, Home/End e o  │
 * │ foco certo. Aqui só se veste: a folha local estiliza pelos papéis ARIA, e não cria um segundo   │
 * │ sistema de abas. As abas internas do lançamento não são as abas globais do workspace (`lib/    │
 * │ workspace-tabs`): estas organizam CAMPOS de um documento, aquelas organizam TELAS.               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Limites dos divisores, os mesmos do design aprovado. Percentual para a largura, pixel para a altura. */
export const LARGURA_DADOS = { min: 17, max: 52, padrao: 30, passo: 1 } as const;
export const ALTURA_PAINEL = { min: 92, max: 430, padrao: 206, passo: 8 } as const;

const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface AbaDoPainel { value: string; label: string; content: React.ReactNode }

export interface CentralVendasWorkspaceProps {
  /** Nome da região, para leitores de tela (ex.: "Nova Venda"). */
  titulo: string;
  /** Ações REAIS da etapa, já na linguagem da barra (botões redondos com dica). */
  acoes: React.ReactNode;
  /** Ações da direita da barra (ex.: documentos abertos). */
  acoesDireita?: React.ReactNode;
  /** Identidade do documento no cabeçalho de Dados principais. Em criação ainda NÃO há número. */
  identidade: { nome: string; alterado: boolean };
  /** Aviso funcional (ex.: escrita bloqueada). Fica dentro de Dados principais, acima dos campos. */
  aviso?: React.ReactNode;
  dados: React.ReactNode;
  itens: React.ReactNode;
  abas: AbaDoPainel[];
  className?: string;
}

/**
 * Um divisor: `role="separator"` focável, com `aria-valuenow` no eixo dele. O arrasto usa Pointer
 * Events com captura, então soltar o ponteiro fora do elemento ainda termina o arrasto — e o valor é
 * calculado sobre o que havia no INÍCIO do arrasto mais o deslocamento, nunca acumulado render a render.
 */
function Divisor({ eixo, valor, min, max, rotulo, onInicio, onMover, onFim, onTeclado, arrastando, testId }: {
  eixo: "vertical" | "horizontal";
  valor: number; min: number; max: number; rotulo: string;
  onInicio: () => void;
  /** Deslocamento do ponteiro desde o início do arrasto, em pixels. */
  onMover: (delta: { dx: number; dy: number }) => void;
  onFim: () => void;
  onTeclado: (tecla: string) => boolean;
  arrastando: boolean;
  testId: string;
}) {
  const inicio = React.useRef<{ x: number; y: number } | null>(null);
  const terminar = () => { if (!inicio.current) return; inicio.current = null; onFim(); };
  return <div
    role="separator"
    tabIndex={0}
    aria-orientation={eixo}
    aria-label={rotulo}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={Math.round(valor)}
    data-testid={testId}
    data-arrastando={arrastando ? "true" : "false"}
    className={eixo === "vertical" ? estilos.divisorVertical : estilos.divisorHorizontal}
    onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); inicio.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); onInicio(); }}
    onPointerMove={(e) => { if (!inicio.current) return; onMover({ dx: e.clientX - inicio.current.x, dy: e.clientY - inicio.current.y }); }}
    onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); terminar(); }}
    onPointerCancel={terminar}
    onKeyDown={(e) => { if (onTeclado(e.key)) e.preventDefault(); }}
  >
    <span className={estilos.grip} aria-hidden>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {eixo === "vertical"
          ? <><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></>
          : <><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>}
      </svg>
    </span>
  </div>;
}

export function CentralVendasWorkspace({ titulo, acoes, acoesDireita, identidade, aviso, dados, itens, abas, className }: CentralVendasWorkspaceProps) {
  const corpoRef = React.useRef<HTMLDivElement>(null);
  const [largura, setLargura] = React.useState<number>(LARGURA_DADOS.padrao);
  const [altura, setAltura] = React.useState<number>(ALTURA_PAINEL.padrao);
  const [arrastando, setArrastando] = React.useState<"vertical" | "horizontal" | null>(null);
  /** Valor no INÍCIO do arrasto: o delta do ponteiro é aplicado sobre ele, não sobre o último render. */
  const base = React.useRef<{ largura: number; altura: number }>({ largura: LARGURA_DADOS.padrao, altura: ALTURA_PAINEL.padrao });

  const iniciar = (eixo: "vertical" | "horizontal") => { base.current = { largura, altura }; setArrastando(eixo); };
  const terminar = () => setArrastando(null);
  const moverVertical = ({ dx }: { dx: number }) => {
    const total = corpoRef.current?.getBoundingClientRect().width ?? 0;
    if (!total) return;
    setLargura(limitar(Math.round((base.current.largura + (dx / total) * 100) * 10) / 10, LARGURA_DADOS.min, LARGURA_DADOS.max));
  };
  // o painel fica embaixo: arrastar para CIMA (dy negativo) aumenta a altura dele
  const moverHorizontal = ({ dy }: { dy: number }) => setAltura(limitar(Math.round(base.current.altura - dy), ALTURA_PAINEL.min, ALTURA_PAINEL.max));

  /**
   * Teclado, pelo padrão de `separator` focável: setas no eixo, Home = mínimo, End = máximo.
   * No divisor horizontal a seta para CIMA aumenta o painel (o divisor sobe), coerente com o arrasto.
   */
  const tecladoVertical = (tecla: string) => {
    const passo = { ArrowRight: LARGURA_DADOS.passo, ArrowLeft: -LARGURA_DADOS.passo }[tecla];
    if (passo !== undefined) { setLargura((v) => limitar(v + passo, LARGURA_DADOS.min, LARGURA_DADOS.max)); return true; }
    if (tecla === "Home") { setLargura(LARGURA_DADOS.min); return true; }
    if (tecla === "End") { setLargura(LARGURA_DADOS.max); return true; }
    return false;
  };
  const tecladoHorizontal = (tecla: string) => {
    const passo = { ArrowUp: ALTURA_PAINEL.passo, ArrowDown: -ALTURA_PAINEL.passo }[tecla];
    if (passo !== undefined) { setAltura((v) => limitar(v + passo, ALTURA_PAINEL.min, ALTURA_PAINEL.max)); return true; }
    if (tecla === "Home") { setAltura(ALTURA_PAINEL.min); return true; }
    if (tecla === "End") { setAltura(ALTURA_PAINEL.max); return true; }
    return false;
  };

  const estilo = { "--largura-dados": `${largura}%`, "--altura-painel": `${altura}px` } as React.CSSProperties;

  return <div role="region" aria-label={titulo} data-testid="central-vendas" data-arrastando={arrastando ?? undefined}
    className={cn(estilos.workspace, className)} style={estilo}>
    {/* A barra é AÇÃO, não cabeçalho: o contexto do documento mora no cabeçalho de Dados principais. */}
    <div className={estilos.barra} data-testid="central-vendas-acoes" role="toolbar" aria-label={`Ações · ${titulo}`}>
      {acoes}
      <span className={estilos.barraEspaco} />
      {acoesDireita}
    </div>

    <section className={estilos.doc} aria-label="Documento em edição">
      <div ref={corpoRef} className={estilos.corpo}>
        <section className={estilos.coluna} data-testid="central-vendas-dados" aria-label="Dados principais">
          <div className={estilos.cabecalho}>
            <span>Dados principais</span>
            <span className={estilos.cabecalhoEspaco} />
            <span className={estilos.identidade} data-testid="central-vendas-identidade">
              <span className={estilos.identidadeIcone} aria-hidden><FilePlus2 size={15} /></span>
              <span className={estilos.identidadeNome}>{identidade.nome}</span>
              {identidade.alterado && <span className={estilos.pontoAlterado} role="img" aria-label="Alterações não salvas" data-testid="central-vendas-alterado" />}
            </span>
          </div>
          <div className={estilos.dadosCorpo}>
            {aviso && <div className={estilos.aviso}>{aviso}</div>}
            {dados}
          </div>
        </section>

        <Divisor eixo="vertical" valor={largura} min={LARGURA_DADOS.min} max={LARGURA_DADOS.max}
          rotulo="Largura de Dados principais e Itens" onInicio={() => iniciar("vertical")} onMover={moverVertical} onFim={terminar} onTeclado={tecladoVertical}
          arrastando={arrastando === "vertical"} testId="central-vendas-divisor-vertical" />

        <section className={estilos.coluna} data-testid="central-vendas-itens" aria-label="Itens">
          {itens}
        </section>
      </div>

      <Divisor eixo="horizontal" valor={altura} min={ALTURA_PAINEL.min} max={ALTURA_PAINEL.max}
        rotulo="Altura de Itens e do painel inferior" onInicio={() => iniciar("horizontal")} onMover={moverHorizontal} onFim={terminar} onTeclado={tecladoHorizontal}
        arrastando={arrastando === "horizontal"} testId="central-vendas-divisor-horizontal" />

      <div className={estilos.painel} data-testid="central-vendas-painel">
        <Tabs className={estilos.abas} tabs={abas} />
      </div>
    </section>
  </div>;
}

/** Botão só de ícone da barra: redondo, com nome acessível e dica — nunca ícone mudo. */
export const AcaoDaBarra = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { rotulo: string; destaque?: "salvar"; ocupado?: boolean; aberta?: boolean; dica?: "inicio" | "fim" }>(
  ({ rotulo, destaque, ocupado, aberta, dica, className, children, disabled, ...p }, ref) => <button ref={ref} type="button" aria-label={rotulo} data-dica={rotulo}
    aria-busy={ocupado || undefined} disabled={disabled || ocupado}
    className={cn(estilos.acao, destaque === "salvar" && estilos.acaoSalvar, aberta && estilos.acaoAberta, dica === "inicio" && estilos.dicaInicio, dica === "fim" && estilos.dicaFim, className)} {...p}>
    {ocupado ? <Loader2 className={estilos.girar} aria-hidden /> : children}
  </button>
);
AcaoDaBarra.displayName = "AcaoDaBarra";

export const DivisorDaBarra = () => <span className={estilos.barraDivisor} aria-hidden />;
