"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, FilePlus, Loader2 } from "lucide-react";
import { Tabs } from "@/components/ui";
import { useWorkspaceImersivo } from "@/components/layout/workspace-imersivo";
import type { Densidade } from "./central-vendas-campo";
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
 *
 * ┌─ PAINEL RECOLHÍVEL E WORKSPACE IMERSIVO (R2) ──────────────────────────────────────────────────┐
 * │ "Recolher painel" deixa só a faixa das abas (39px, a medida do protótipo) e some com o divisor   │
 * │ horizontal — recolhido não se redimensiona. O conteúdo da aba sai do layout (`display: none`),  │
 * │ então nada fica focável atrás da faixa. Expandir (pelo botão ou escolhendo uma aba) devolve a    │
 * │ ÚLTIMA altura: ela nunca foi apagada, só deixou de ser aplicada. Como os divisores, é estado de  │
 * │ tela e morre com ela (PANEL_COLLAPSE_PERSISTENCE = NONE).                                        │
 * │                                                                                                  │
 * │ Montada, a Central declara-se workspace imersivo (`useWorkspaceImersivo`): o shell deixa de      │
 * │ desenhar a trilha acima dela, e a moldura começa onde o design a põe. A decisão é do shell — rota │
 * │ que admite imersão AND workspace real montado —, nunca um CSS desta folha escondendo o vizinho.  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AMPLIAR, DENSIDADE E ESQUELETO (VISUAL-UX-02) ────────────────────────────────────────────────┐
 * │ Ampliar uma região (Dados principais, Itens ou painel inferior) esconde as outras e devolve o   │
 * │ espaço inteiro a ela; "Restaurar layout" volta ao de antes. É o mesmo tipo de estado que os      │
 * │ divisores: `useState` da moldura, `data-ampliado` na raiz, nada no navegador nem no perfil. A     │
 * │ densidade (rótulo antes ou dentro do campo) é da PÁGINA; aqui ela só vira `data-densidade` na     │
 * │ raiz, que é por onde a folha dos campos a lê. Com a leitura da consulta pendente, `carregando`   │
 * │ troca os campos por barras de esqueleto — nada é inventado enquanto o servidor não respondeu.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Limites dos divisores, os mesmos do design aprovado. Percentual para a largura, pixel para a altura. */
export const LARGURA_DADOS = { min: 17, max: 52, padrao: 30, passo: 1 } as const;
export const ALTURA_PAINEL = { min: 92, max: 430, padrao: 206, passo: 8 } as const;

const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface AbaDoPainel {
  value: string; label: string; content: React.ReactNode;
  /** Selo numérico no rótulo da aba (ex.: quantos títulos o Financeiro tem). Zero ou ausente: sem selo. */
  contador?: number;
  /** Ponto vermelho no rótulo: a aba tem campo com pendência. */
  erro?: boolean;
}

/** As três regiões que se ampliam. Ampliar é estado de TELA: nada persiste. */
export type RegiaoAmpliavel = "dados" | "itens" | "painel";

/** O que a página pode pedir à moldura sem conhecer o DOM dela (ex.: a lista de pendências abre uma aba). */
export interface ControleDaCentral { abrirAba: (valor: string) => void }

const AmpliarContexto = React.createContext<{ ampliado: RegiaoAmpliavel | null; alternar: (r: RegiaoAmpliavel) => void } | null>(null);

const ROTULO_AMPLIAR: Record<RegiaoAmpliavel, string> = { dados: "Ampliar Dados principais", itens: "Ampliar Itens", painel: "Ampliar painel inferior" };

/**
 * [Ampliar] de uma região: só o ícone, sem fundo. Ampliada, o mesmo botão diz "Restaurar layout". Fora da
 * moldura não aparece — o estado mora nela, e um botão sem efeito é pior que botão nenhum.
 */
export function BotaoAmpliar({ regiao }: { regiao: RegiaoAmpliavel }) {
  const ctx = React.useContext(AmpliarContexto);
  if (!ctx) return null;
  const ativo = ctx.ampliado === regiao;
  const rotulo = ativo ? "Restaurar layout" : ROTULO_AMPLIAR[regiao];
  return <button type="button" className={cn(estilos.ampliar, estilos.dicaInicio)} aria-label={rotulo} data-dica={rotulo} aria-pressed={ativo}
    data-testid={`central-vendas-ampliar-${regiao}`} onClick={() => ctx.alternar(regiao)}>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ativo ? <><path d="M13.5 4.5v6h6" /><path d="M10.5 19.5v-6h-6" /></> : <><path d="M13.5 4.5h6v6" /><path d="M10.5 19.5h-6v-6" /></>}
    </svg>
  </button>;
}

export interface CentralVendasWorkspaceProps {
  /** Nome da região, para leitores de tela (ex.: "Nova Venda"). */
  titulo: string;
  /** Ações REAIS da etapa, já na linguagem da barra (botões redondos com dica). */
  acoes: React.ReactNode;
  /** Ações da direita da barra (ex.: documentos abertos). */
  acoesDireita?: React.ReactNode;
  /**
   * Identidade do documento no cabeçalho de Dados principais. Em criação ainda NÃO há número (nome =
   * "Nova Venda", ícone de documento novo); em consulta, o código do servidor, o ícone da situação e a
   * situação por `StatusBadge`.
   */
  identidade: {
    nome: string; alterado: boolean;
    /** o nome é o CÓDIGO do servidor (consulta): fonte de código, como no design */
    codigo?: boolean;
    /** o que este tipo de documento faz — dica do ícone, fora do corpo, como no design */
    dica?: string;
    icone?: React.ReactNode;
    /** família de tonalidade do ícone (a mesma de `statusTone`) */
    tom?: "positive" | "negative" | "warning" | "info" | "neutral";
    situacao?: React.ReactNode;
  };
  /** Aviso funcional (ex.: escrita bloqueada). Fica dentro de Dados principais, acima dos campos. */
  aviso?: React.ReactNode;
  dados: React.ReactNode;
  itens: React.ReactNode;
  abas: AbaDoPainel[];
  /** Posição do rótulo dos campos — estado da PÁGINA; aqui vira `data-densidade` na raiz. */
  densidade?: Densidade;
  /** Leitura da consulta pendente: Dados principais mostra o esqueleto, nada do documento é inventado. */
  carregando?: boolean;
  /** Preenchido pela moldura ao montar: o que a página pode pedir a ela (abrir uma aba do painel). */
  controle?: React.MutableRefObject<ControleDaCentral | null>;
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

export function CentralVendasWorkspace({ titulo, acoes, acoesDireita, identidade, aviso, dados, itens, abas, densidade = "rotulo-a-frente", carregando = false, controle, className }: CentralVendasWorkspaceProps) {
  const corpoRef = React.useRef<HTMLDivElement>(null);
  const painelRef = React.useRef<HTMLDivElement>(null);
  const [largura, setLargura] = React.useState<number>(LARGURA_DADOS.padrao);
  const [altura, setAltura] = React.useState<number>(ALTURA_PAINEL.padrao);
  const [arrastando, setArrastando] = React.useState<"vertical" | "horizontal" | null>(null);
  const [recolhido, setRecolhido] = React.useState(false);
  const [ampliado, setAmpliado] = React.useState<RegiaoAmpliavel | null>(null);
  useWorkspaceImersivo();
  /** Ampliar o painel inferior recolhido o expande: ampliar para mostrar só a faixa não faria sentido. */
  const ampliar = React.useMemo(() => ({
    ampliado,
    alternar: (r: RegiaoAmpliavel) => { setAmpliado((a) => (a === r ? null : r)); if (r === "painel") setRecolhido(false); }
  }), [ampliado]);
  /**
   * Abrir uma aba pelo nome: expande o painel, desfaz a ampliação de OUTRA região e FOCA a aba — o `Tabs`
   * oficial ativa a aba que recebe foco, então quem escolhe continua sendo o primitive.
   */
  React.useEffect(() => {
    if (!controle) return;
    controle.current = {
      abrirAba: (valor) => {
        setRecolhido(false);
        setAmpliado((a) => (a === "painel" ? a : null));
        const aba = [...(painelRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find((el) => el.id.endsWith(`-trigger-${valor}`));
        aba?.focus();
      }
    };
    return () => { controle.current = null; };
  }, [controle]);
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

  /**
   * Recolhido, escolher uma aba EXPANDE — pelo clique ou pelas teclas que ativam aba (setas, Home, End,
   * Enter, Espaço), como no protótipo. A captura olha o papel ARIA do alvo: o primitive `Tabs` continua
   * dono da ativação; aqui só se decide se o painel volta a ter altura.
   */
  const ehAba = (alvo: EventTarget) => alvo instanceof Element && Boolean(alvo.closest('[role="tab"]'));
  const expandirPelaAba = (alvo: EventTarget) => { if (recolhido && ehAba(alvo)) setRecolhido(false); };
  const rotuloRecolher = recolhido ? "Expandir painel" : "Recolher painel";

  /** O selo e o ponto vão pelo `badge` do `Tabs` oficial: o rótulo continua sendo o texto da aba. */
  const abasDoPainel = abas.map(({ contador, erro, ...a }) => ({
    ...a,
    badge: contador || erro ? <>
      {contador ? <span className={estilos.abaContador}>{contador}</span> : null}
      {erro ? <span className={estilos.abaErro} role="img" aria-label="Com pendência" /> : null}
    </> : undefined
  }));

  return <div role="region" aria-label={titulo} data-testid="central-vendas" data-arrastando={arrastando ?? undefined}
    data-densidade={densidade} data-ampliado={ampliado ?? undefined} aria-busy={carregando || undefined}
    className={cn(estilos.workspace, className)} style={estilo}>
    <AmpliarContexto.Provider value={ampliar}>
      {/* A barra é AÇÃO, não cabeçalho: o contexto do documento mora no cabeçalho de Dados principais.
          O cartão é a moldura (borda e sombra); a barra de 44px mora dentro dele. */}
      <div className={estilos.barraCartao}>
        <div className={estilos.barra} data-testid="central-vendas-acoes" role="toolbar" aria-label={`Ações · ${titulo}`}>
          {acoes}
          <span className={estilos.barraEspaco} />
          {acoesDireita}
        </div>
      </div>

      <section className={estilos.doc} aria-label="Documento em edição">
        <div ref={corpoRef} className={estilos.corpo}>
          <section className={estilos.coluna} data-testid="central-vendas-dados" data-regiao="dados" aria-label="Dados principais">
            <div className={estilos.cabecalho}>
              <BotaoAmpliar regiao="dados" />
              <span>Dados principais</span>
              <span className={estilos.cabecalhoEspaco} />
              <span className={estilos.identidade} data-testid="central-vendas-identidade">
                {carregando
                  ? <span className={estilos.skLinha} aria-hidden />
                  : <span className={cn(estilos.identidadeIcone, estilos.dicaFim)} data-tom={identidade.tom} data-dica={identidade.dica} tabIndex={identidade.dica ? 0 : undefined} role={identidade.dica ? "img" : undefined} aria-label={identidade.dica} aria-hidden={identidade.dica ? undefined : true}>{identidade.icone ?? <FilePlus />}</span>}
                {/* o nome do documento é o TÍTULO da tela (h1): leitor de tela e atalho de título chegam nele */}
                <h1 className={cn(estilos.identidadeNome, carregando && "sr-only")} data-codigo={identidade.codigo ? "true" : undefined} data-testid="central-vendas-identidade-nome">{identidade.nome}</h1>
                {identidade.situacao && <span className={estilos.identidadeSituacao} data-testid="central-vendas-situacao">{identidade.situacao}</span>}
                {identidade.alterado && <span className={estilos.pontoAlterado} role="img" aria-label="Alterações não salvas" data-testid="central-vendas-alterado" />}
              </span>
            </div>
            <div className={estilos.dadosCorpo}>
              {carregando
                ? <div className={estilos.esqueleto} data-testid="central-vendas-esqueleto" aria-hidden>
                  {[0, 1, 2, 3, 4].map((i) => <div key={i} className={estilos.sk} />)}
                </div>
                : <>
                  {aviso && <div className={estilos.aviso}>{aviso}</div>}
                  {dados}
                </>}
            </div>
          </section>

          <Divisor eixo="vertical" valor={largura} min={LARGURA_DADOS.min} max={LARGURA_DADOS.max}
            rotulo="Largura de Dados principais e Itens" onInicio={() => iniciar("vertical")} onMover={moverVertical} onFim={terminar} onTeclado={tecladoVertical}
            arrastando={arrastando === "vertical"} testId="central-vendas-divisor-vertical" />

          <section className={estilos.coluna} data-testid="central-vendas-itens" data-regiao="itens" aria-label="Itens">
            {itens}
          </section>
        </div>

        {!recolhido && <Divisor eixo="horizontal" valor={altura} min={ALTURA_PAINEL.min} max={ALTURA_PAINEL.max}
          rotulo="Altura de Itens e do painel inferior" onInicio={() => iniciar("horizontal")} onMover={moverHorizontal} onFim={terminar} onTeclado={tecladoHorizontal}
          arrastando={arrastando === "horizontal"} testId="central-vendas-divisor-horizontal" />}

        <div ref={painelRef} className={estilos.painel} data-testid="central-vendas-painel" data-recolhido={recolhido ? "true" : "false"}
          onClickCapture={(e) => expandirPelaAba(e.target)}
          onKeyDownCapture={(e) => { if (["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(e.key)) expandirPelaAba(e.target); }}>
          <span className={estilos.painelAmpliar}><BotaoAmpliar regiao="painel" /></span>
          {/* O `Tabs` oficial lê a aba inicial só ao montar: sem a chave, a Central que nasceu carregando (sem abas)
              ficaria sem aba ativa quando a leitura chega — a mesma instância, agora com abas. */}
          <Tabs key={abas[0]?.value ?? "sem-abas"} className={estilos.abas} tabs={abasDoPainel} />
          <span className={estilos.painelAcoes}>
            <button type="button" className={cn(estilos.recolher, estilos.dicaFim)} aria-label={rotuloRecolher} data-dica={rotuloRecolher}
              aria-expanded={!recolhido} data-testid="central-vendas-recolher" onClick={() => setRecolhido((r) => !r)}><span className={estilos.recolherIcone}><ChevronDown aria-hidden /></span></button>
          </span>
        </div>
      </section>
    </AmpliarContexto.Provider>
  </div>;
}

/** Botão só de ícone da barra: redondo, com nome acessível e dica — nunca ícone mudo. */
export const AcaoDaBarra = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { rotulo: string; destaque?: "salvar" | "novo"; ocupado?: boolean; aberta?: boolean; dica?: "inicio" | "fim" }>(
  ({ rotulo, destaque, ocupado, aberta, dica, className, children, disabled, ...p }, ref) => <button ref={ref} type="button" aria-label={rotulo} data-dica={rotulo}
    aria-busy={ocupado || undefined} disabled={disabled || ocupado}
    className={cn(estilos.acao, destaque === "salvar" && estilos.acaoSalvar, destaque === "novo" && estilos.acaoNovo, aberta && estilos.acaoAberta, dica === "inicio" && estilos.dicaInicio, dica === "fim" && estilos.dicaFim, className)} {...p}>
    {ocupado ? <Loader2 className={estilos.girar} aria-hidden /> : children}
  </button>
);
AcaoDaBarra.displayName = "AcaoDaBarra";

/**
 * A ação de MAIOR hierarquia da etapa (Confirmar venda, Converter): pílula verde sólida com ícone E
 * texto, como no design. É a única ação da barra que não é só ícone — o texto nomeia o efeito.
 */
export const AcaoPrincipal = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { icone: React.ReactNode; ocupado?: boolean }>(
  ({ icone, ocupado, className, children, disabled, ...p }, ref) => <button ref={ref} type="button" aria-busy={ocupado || undefined} disabled={disabled || ocupado}
    className={cn(estilos.acaoPrincipal, className)} {...p}>
    {ocupado ? <Loader2 className={estilos.girar} aria-hidden /> : icone}{children}
  </button>
);
AcaoPrincipal.displayName = "AcaoPrincipal";

export const DivisorDaBarra = () => <span className={estilos.barraDivisor} aria-hidden />;
