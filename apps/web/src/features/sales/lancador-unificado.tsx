"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import * as MenuP from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { Button, Dialog, LoadingState } from "@/components/ui";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { MensagemTop, podeLancar } from "./tipo-operacao-select";
import { useTopsDeVendas, type GrupoDeTops } from "./variantes";
import {
  filtrarLinhas, linhaAtivaDoRecorte, linhasDeLancamento, linhasDoGrupo, linhasDoMenuRapido, moverAtivo,
  padraoDeLancamento, rotaDeLancamento, textoDeContagem, LIMITE_DO_MENU_RAPIDO,
  type LinhaDeLancamento, type MovimentoDeCursor
} from "./launcher-operacoes";
import estilos from "./portal-vendas.module.css";

/**
 * O `NOVO` DO PORTAL DE VENDAS — A OPERAÇÃO PRIMEIRO, O DOCUMENTO DEPOIS.
 *
 * ┌─ POR QUE NÃO PERGUNTAR "ORÇAMENTO / PEDIDO / VENDA" ───────────────────────────────────────────┐
 * │ Perguntar a VARIANTE primeiro obriga o usuário a traduzir a operação que ele quer fazer ("venda │
 * │ de gado a prazo") para o nome da TABELA em que ela cai. Quem sabe fazer essa tradução é o        │
 * │ produto, não o vendedor: a família da TOP escolhida JÁ DIZ em que documento a operação nasce.    │
 * │                                                                                                  │
 * │ Então o lançador oferece o que a organização configurou — as TOPs que o usuário pode lançar —    │
 * │ e a escolha decide sozinha a porta (`/vendas/<segmento>/new`). Nenhum mapa de família mora aqui: │
 * │ a variante vem do registry (`variantesDeVenda`) e o rótulo, do catálogo de idioma.               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O DESENHO DO DESIGN (VISUAL-UX-01 R3, docs/DECISIONS.md 228) ─────────────────────────────────┐
 * │ · `Novo` é um botão DIVIDIDO: o corpo abre a janela completa; a seta abre o menu rápido          │
 * │   "Nova operação", com as operações do tipo (todas até 8; acima disso, só as padrão) e, no pé,  │
 * │   "Escolher operação…", que abre a mesma janela.                                                 │
 * │ · O TIPO da barra é o contexto: com um tipo escolhido, menu e janela oferecem só as operações   │
 * │   dele; com "Todos os tipos", as de todos, agrupadas.                                            │
 * │ · Na janela, a família é o CABEÇALHO do grupo (rótulo + contagem); cada linha traz código, nome │
 * │   e o selo "Padrão". O rodapé resume o que vai acontecer ("Lançar Venda com 2303 · …").         │
 * │ · CLIQUE ESCOLHE, não lança. Lançam: o botão "Lançar", o Enter e o DUPLO clique. Com o clique   │
 * │   só escolhendo, o duplo clique deixa de ter a corrida de antes (o primeiro clique navegava e o │
 * │   segundo caía na página nova): o primeiro clique não sai do lugar.                             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ESCOLHER AQUI NÃO AUTORIZA NADA ──────────────────────────────────────────────────────────────┐
 * │ A escolha vira `?tipo_operacao_id=<uuid>` na rota de lançamento, e lá o `LancadorDeTipoOperacao` │
 * │ reconfere o id contra a lista que o SERVIDOR devolve para AQUELA variante. Pedido de URL é       │
 * │ pedido, nunca autoridade — inclusive quando quem montou a URL foi esta tela.                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O BLOQUEIO CONTINUA SENDO O MESMO ────────────────────────────────────────────────────────────┐
 * │ Grupo cuja lista o servidor não confirmou (API anterior a esta fatia, ou com defeito) NÃO vira   │
 * │ atalho para o formulário: ele mostra a mesma mensagem única de `MensagemTop`, e não contribui    │
 * │ com nenhuma linha (quem decide isso é `podeLancar`, dentro de `linhasDoGrupo`) — nem na janela,  │
 * │ nem no menu rápido. A mensagem de bloqueio NÃO é escondida pela pesquisa: um aviso de            │
 * │ fail-closed que some porque o usuário digitou três letras vira "sumiu a família".                │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

const contagem = (n: number) => (n === 1 ? "1 operação" : `${n} operações`);

/** Uma linha da janela — `<button role="option">`, porque a lista é um listbox com cursor virtual. */
function Linha({ linha, ativa, idOpcao, aoEscolher, aoLancar }: {
  linha: LinhaDeLancamento; ativa: boolean; idOpcao: string;
  aoEscolher: (l: LinhaDeLancamento) => void; aoLancar: (l: LinhaDeLancamento) => void;
}) {
  return <button
    type="button"
    role="option"
    id={idOpcao}
    aria-selected={ativa}
    // A LISTA É **UM** TABSTOP: quem navega é o cursor virtual (`aria-activedescendant` no campo de
    // pesquisa). O `mousedown` sem padrão mantém o foco no campo também no clique — as setas continuam
    // valendo depois de escolher com o mouse, sem Tab de volta.
    tabIndex={-1}
    onMouseDown={(e) => e.preventDefault()}
    data-testid="lancador-top"
    data-top-id={linha.id}
    data-familia={linha.familia}
    data-ativa={ativa ? "true" : "false"}
    data-padrao={linha.ehPadrao ? "true" : "false"}
    className={cn(estilos.opcao, estilos.colunas)}
    onClick={() => aoEscolher(linha)}
    onDoubleClick={() => aoLancar(linha)}
  >
    {/* Marcador: `aria-hidden` porque quem informa a seleção ao leitor de tela é `aria-selected`. */}
    <span className={estilos.opcaoMarca} aria-hidden>{ativa ? <Check strokeWidth={3} /> : null}</span>
    <span className={estilos.codigo}>{linha.code}</span>
    <span className={estilos.nome}>{linha.name}</span>
    {/* O selo "Padrão" descreve o CADASTRO, não o cursor: fica na linha que o servidor marcou. */}
    <span className={estilos.vagaDoSelo}>{linha.ehPadrao ? <span className={estilos.selo}>Padrão</span> : null}</span>
  </button>;
}

/**
 * Uma família da janela: cabeçalho (rótulo + contagem do recorte), o bloqueio dela quando houver, e as
 * linhas. `role="group"` com o rótulo da família: listbox → grupo → opção é a árvore que o leitor de
 * tela entende. Grupo que a pesquisa esvaziou e que não está bloqueado não desenha nada.
 */
function Grupo({ grupo, linhas, ativo, idOpcao, aoEscolher, aoLancar }: {
  grupo: GrupoDeTops; linhas: LinhaDeLancamento[]; ativo: string | null; idOpcao: (id: string) => string;
  aoEscolher: (l: LinhaDeLancamento) => void; aoLancar: (l: LinhaDeLancamento) => void;
}) {
  const idRotulo = React.useId();
  // O CARREGAMENTO NÃO É PUBLICADO AQUI: quem anuncia "carregando" é a janela inteira, uma vez.
  const bloqueado = grupo.estado.situacao !== "carregando" && !podeLancar(grupo.estado);
  const vazio = !linhas.length && !bloqueado;
  return <div role="group" aria-labelledby={vazio ? undefined : idRotulo} hidden={vazio} data-testid="lancador-grupo" data-familia={grupo.variante.familia}>
    {!vazio && <div className={estilos.grupo} id={idRotulo} data-testid="lancador-grupo-rotulo"><span>{grupo.rotulo}</span><span aria-hidden>{contagem(linhas.length)}</span></div>}
    {bloqueado && <div className={estilos.bloqueio}><MensagemTop estado={grupo.estado} /></div>}
    {linhas.map((l) => <Linha key={l.id} linha={l} ativa={l.id === ativo} idOpcao={idOpcao(l.id)} aoEscolher={aoEscolher} aoLancar={aoLancar} />)}
  </div>;
}

export function NovoDocumentoDeVenda({ variante, rotuloDoTipo }: {
  /** A variante do contexto da barra (`?kind=`), ou "" para todos os tipos. */
  variante: string;
  /** O rótulo humano do contexto ("Venda", "Todos os tipos") — o mesmo que a pílula Tipo mostra. */
  rotuloDoTipo: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  /**
   * A ESCOLHA DO USUÁRIO — e só ela. A linha ATIVA é derivada disto, do padrão e do recorte, em
   * `linhaAtivaDoRecorte`: guardar aqui "a linha ativa" já resolvida seria guardar um fantasma que a
   * pesquisa tirou da tela e o Enter lançaria mesmo assim.
   */
  const [escolhido, setEscolhido] = React.useState<string | null>(null);
  const [anuncio, setAnuncio] = React.useState("");
  /**
   * GUARDA DE REENTRÂNCIA. `router.push` é assíncrono: sem isto, um segundo Enter (ou um clique
   * enquanto a rota carrega) dispararia uma segunda navegação. `useRef` porque a decisão precisa valer
   * JÁ, no mesmo evento.
   */
  const lancando = React.useRef(false);
  const [ocupado, setOcupado] = React.useState(false);
  const campoBusca = React.useRef<HTMLInputElement>(null);
  const botaoNovo = React.useRef<HTMLButtonElement>(null);
  /** "Escolher operação…" pede a janela; ela abre DEPOIS que o menu devolve o foco (ver `onCloseAutoFocus`). */
  const janelaPedidaPeloMenu = React.useRef(false);
  const idLista = React.useId();
  const idOpcao = React.useCallback((id: string) => `${idLista}-${id}`, [idLista]);

  // Só os grupos que o usuário pode LANÇAR, e só os do tipo da barra. Sem nenhum, o `Novo` não existe:
  // oferecer "Novo" a quem não pode criar nada NESTE contexto é oferecer uma porta fechada.
  const grupos = useTopsDeVendas().filter((g) => g.habilitado && (!variante || g.variante.variante === variante));
  const todas = linhasDeLancamento(grupos);
  const visiveis = filtrarLinhas(todas, busca);
  const padrao = padraoDeLancamento(todas);
  const ativo = linhaAtivaDoRecorte({ visiveis, escolhido, padrao });
  const linhaAtiva = visiveis.find((l) => l.id === ativo) ?? null;
  const doMenu = linhasDoMenuRapido(todas);

  const algumCarregando = grupos.some((g) => g.estado.situacao === "carregando");
  const algumBloqueio = grupos.some((g) => g.estado.situacao !== "carregando" && !podeLancar(g.estado));
  const buscando = busca.trim().length > 0;
  /** O vazio só fala quando ninguém mais está falando (carregando, ou um bloqueio já explicando). */
  const mostrarVazio = !algumCarregando && visiveis.length === 0 && (buscando || !algumBloqueio);

  const abrir = () => {
    // Cada abertura começa limpa: pesquisa vazia, sem escolha herdada e com a guarda rearmada.
    setBusca(""); setEscolhido(null); setOcupado(false); lancando.current = false;
    setAberto(true);
  };

  const confirmar = React.useCallback((linha: LinhaDeLancamento) => {
    if (lancando.current) return;
    lancando.current = true;
    setOcupado(true);
    // FECHA ANTES DE NAVEGAR: com o overlay montado sobre a rota nova, ele capturaria o clique seguinte.
    setAberto(false);
    router.push(rotaDeLancamento(linha));
  }, [router]);

  const escolher = (linha: LinhaDeLancamento) => { setEscolhido(linha.id); campoBusca.current?.focus(); };

  /** Foco inicial no campo de pesquisa — digitar é a ação mais provável; o padrão já nasce ativo. */
  React.useEffect(() => {
    if (!aberto) return;
    const t = window.setTimeout(() => campoBusca.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [aberto]);

  /** A lista rola até a linha ativa — `block: "nearest"`, para não arrastar a tela sem necessidade. */
  React.useEffect(() => {
    if (!aberto || !ativo) return;
    document.getElementById(idOpcao(ativo))?.scrollIntoView({ block: "nearest" });
  }, [aberto, ativo, idOpcao]);

  /** REGIÃO VIVA: o foco não se move com as setas; sem anunciar a contagem, o leitor de tela digita no vazio. */
  React.useEffect(() => {
    if (!aberto) { setAnuncio(""); return; }
    const t = window.setTimeout(() => setAnuncio(textoDeContagem(visiveis.length)), 250);
    return () => window.clearTimeout(t);
  }, [aberto, visiveis.length]);

  /**
   * A ESCADA DO TECLADO — toda capturada pelo CAMPO. ESC não aparece aqui: quem fecha é o overlay
   * oficial, SEMPRE, inclusive com texto na pesquisa (o campo já tem "Limpar").
   */
  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const mover = (movimento: MovimentoDeCursor) => { const alvo = moverAtivo(visiveis, ativo, movimento); if (alvo) setEscolhido(alvo); };
    if (e.key === "ArrowDown") { e.preventDefault(); mover("proximo"); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); mover("anterior"); return; }
    // Home/End só navegam a LISTA sem texto: com texto, são as teclas de edição do campo.
    if ((e.key === "Home" || e.key === "End") && busca === "") {
      e.preventDefault(); mover(e.key === "Home" ? "primeiro" : "ultimo"); return;
    }
    if (e.key === "Enter") {
      // Enter SEM linha ativa é NO-OP declarado: não fecha, não lança e não "tenta a primeira".
      e.preventDefault();
      if (linhaAtiva) confirmar(linhaAtiva);
    }
  };

  const limparBusca = () => { setBusca(""); campoBusca.current?.focus(); };

  if (!grupos.length) return null;
  return <>
    <span className={estilos.dividido}>
      <button ref={botaoNovo} type="button" className={estilos.novo} data-testid="vendas-novo" aria-haspopup="dialog" aria-expanded={aberto}
        title={`Novo documento · ${rotuloDoTipo}: escolher a operação`} onClick={abrir}>
        <Plus strokeWidth={2.4} aria-hidden /><span>Novo</span>
      </button>
      <MenuP.Root modal={false}>
        <MenuP.Trigger asChild>
          <button type="button" className={estilos.abrirMenu} aria-label="Escolher a operação do novo documento" data-testid="vendas-novo-menu">
            <ChevronDown strokeWidth={2.4} aria-hidden />
          </button>
        </MenuP.Trigger>
        <MenuP.Portal>
          <MenuP.Content align="start" sideOffset={6} className={cn(estilos.menu, estilos.menuOperacoes)} aria-label="Nova operação" data-testid="vendas-novo-operacoes"
            // "Escolher operação…": o menu devolve o foco ao `Novo` e SÓ ENTÃO a janela abre — assim a
            // janela guarda o `Novo` como quem a abriu, e o ESC devolve o foco a ele, não ao `<body>`.
            onCloseAutoFocus={(e) => { if (!janelaPedidaPeloMenu.current) return; janelaPedidaPeloMenu.current = false; e.preventDefault(); botaoNovo.current?.focus(); abrir(); }}>
            <div className={estilos.menuCabecalho}>
              <span className={estilos.menuTitulo}>Nova operação · {rotuloDoTipo}</span>
              <span className={estilos.menuSubtitulo}>{todas.length <= LIMITE_DO_MENU_RAPIDO ? contagem(todas.length) : "Só as operações padrão"}</span>
            </div>
            <div className={estilos.menuLista}>
              {algumCarregando && <div className={estilos.menuAviso} data-testid="menu-rapido-carregando">Carregando os tipos de operação…</div>}
              {!algumCarregando && doMenu.length === 0 && <div className={estilos.menuAviso} data-testid="menu-rapido-vazio">
                {todas.length ? "Nenhuma operação padrão: use Escolher operação." : "Nenhuma operação disponível para lançamento."}
              </div>}
              {doMenu.map((l) => <MenuP.Item key={l.id} className={estilos.operacao} data-testid="menu-rapido-top" data-top-id={l.id} data-familia={l.familia} onSelect={() => confirmar(l)}>
                <span className={estilos.codigo}>{l.code}</span>
                <span className={estilos.nome}>{l.name}</span>
                {/* a família só se escreve quando o contexto mistura tipos — com um tipo escolhido, ela é o título */}
                <span className={estilos.familia}>{variante ? "" : l.rotuloDoTipo}</span>
                <span className={estilos.vagaDoSelo}>{l.ehPadrao ? <span className={estilos.selo}>Padrão</span> : null}</span>
              </MenuP.Item>)}
            </div>
            <div className={estilos.menuRodape}>
              <MenuP.Item className={cn(estilos.operacao, estilos.escolherOperacao)} data-testid="menu-rapido-escolher" onSelect={() => { janelaPedidaPeloMenu.current = true; }}>
                <span className={estilos.iconePesquisa}><Search aria-hidden /></span>
                <span className={estilos.rotuloForte}>Escolher operação…</span>
                <span className={estilos.familia}>{todas.length === 1 ? "1 TOP" : `${todas.length} TOPs`}</span>
              </MenuP.Item>
            </div>
          </MenuP.Content>
        </MenuP.Portal>
      </MenuP.Root>
    </span>

    <Dialog
      open={aberto} onOpenChange={setAberto} size="lg" testId="lancador-unificado"
      title="Novo documento"
      description={<>Escolha a TOP para iniciar o documento.<span className={estilos.contextoDaJanela} data-testid="lancador-contexto">
        <span className={estilos.contextoRotulo}>Tipo</span><span className={estilos.contextoValor}>{rotuloDoTipo}</span>
      </span></>}
      bodyClassName={estilos.corpo}
      footer={<>
        <div className={estilos.rodapeResumo}>
          <span className={estilos.resumo} data-testid="lancador-resumo">
            {linhaAtiva ? `Lançar ${linhaAtiva.rotuloDoTipo} com ${linhaAtiva.code} · ${linhaAtiva.name}` : "Nenhuma operação selecionada"}
          </span>
          <span className={estilos.atalhos} aria-hidden>
            <kbd className={estilos.tecla}>↑</kbd> <kbd className={estilos.tecla}>↓</kbd> navegar · <kbd className={estilos.tecla}>Enter</kbd> lançar · <kbd className={estilos.tecla}>Esc</kbd> fechar · {contagem(visiveis.length)}
          </span>
        </div>
        <Button variant="outline" data-testid="lancador-cancelar" onClick={() => setAberto(false)}>{COPY.fechar}</Button>
        {/* A AÇÃO PRIMÁRIA fica sempre visível (rodapé fixo) e desabilitada sem linha ativa: com o recorte
            vazio, com o padrão fora do recorte e com uma operação única sem padrão declarado. */}
        <Button data-testid="lancador-lancar" disabled={!linhaAtiva || ocupado} onClick={() => { if (linhaAtiva) confirmar(linhaAtiva); }}>Lançar</Button>
      </>}
    >
      <div className={estilos.linhaDePesquisa}>
        <div className={estilos.pesquisa}>
          <Search aria-hidden />
          <input
            ref={campoBusca}
            data-testid="lancador-busca"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={aoTeclar}
            placeholder="Pesquisar por código ou descrição da operação"
            aria-label="Pesquisar operação"
            // combobox + listbox: o foco do DOM fica no campo e `aria-activedescendant` aponta a linha ativa.
            role="combobox"
            aria-expanded="true"
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={ativo ? idOpcao(ativo) : undefined}
          />
          {buscando && <button type="button" className={estilos.limpar} data-testid="lancador-limpar-busca" onClick={limparBusca}>Limpar</button>}
        </div>
      </div>

      {/* SÓ A LISTA ROLA, com o cabeçalho de colunas `sticky` DENTRO dela: fora, ele não sofreria o recuo
          da barra de rolagem e as colunas sairiam do lugar quando a lista transborda. */}
      <div className={estilos.rolagem}>
        <div className={cn(estilos.colunas, estilos.cabecalhoColunas)} aria-hidden="true">
          <span /><span>Código</span><span>Tipo de Operação</span><span />
        </div>
        {/* UM aviso de carregamento para a janela inteira, e não um por família. */}
        {algumCarregando && <div data-testid="lancador-carregando"><LoadingState label="Carregando os tipos de operação…" /></div>}
        <div role="listbox" id={idLista} aria-label="Operações disponíveis para lançamento" className={estilos.lista}>
          {grupos.map((g) => <Grupo
            key={g.variante.variante}
            grupo={g}
            linhas={filtrarLinhas(linhasDoGrupo(g), busca)}
            ativo={ativo}
            idOpcao={idOpcao}
            aoEscolher={escolher}
            aoLancar={confirmar}
          />)}
        </div>
        {mostrarVazio && <div className={estilos.vazio} data-testid="lancador-vazio">
          <Search aria-hidden />
          <div className={estilos.vazioTitulo}>{buscando ? "Nenhuma operação encontrada para esta busca." : "Nenhuma operação disponível para lançamento."}</div>
          {buscando && <div className={estilos.vazioTexto}>Confira o código ou tente parte da descrição.</div>}
          {buscando && <Button variant="outline" data-testid="lancador-vazio-limpar" onClick={limparBusca}>Limpar pesquisa</Button>}
        </div>}
      </div>

      <span className="sr-only" role="status" aria-live="polite" data-testid="lancador-contagem">{anuncio}</span>
    </Dialog>
  </>;
}
