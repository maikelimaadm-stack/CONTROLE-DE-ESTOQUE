"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, Input, LoadingState } from "@/components/ui";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { MensagemTop, podeLancar } from "./tipo-operacao-select";
import { useTopsDeVendas, type GrupoDeTops } from "./variantes";
import {
  filtrarLinhas, linhaAtivaDoRecorte, linhasDeLancamento, linhasDoGrupo, moverAtivo,
  padraoDeLancamento, rotaDeLancamento, textoDeContagem,
  type LinhaDeLancamento, type MovimentoDeCursor
} from "./launcher-operacoes";

/**
 * O `+ NOVO` DO PORTAL DE VENDAS — A OPERAÇÃO PRIMEIRO, O DOCUMENTO DEPOIS.
 *
 * ┌─ POR QUE NÃO PERGUNTAR "ORÇAMENTO / PEDIDO / VENDA" ───────────────────────────────────────────┐
 * │ Perguntar a VARIANTE primeiro obriga o usuário a traduzir a operação que ele quer fazer ("venda │
 * │ de gado a prazo") para o nome da TABELA em que ela cai. Quem sabe fazer essa tradução é o        │
 * │ produto, não o vendedor: a família da TOP escolhida JÁ DIZ em que documento a operação nasce.    │
 * │                                                                                                  │
 * │ Então o lançador oferece o que a organização configurou — as TOPs que o usuário pode lançar —    │
 * │ e a escolha decide sozinha a porta (`/vendas/<segmento>/new`). Nenhum mapa de família mora aqui: │
 * │ a variante vem do registry (`variantesDeVenda`) e o rótulo, do catálogo de idioma. Uma família   │
 * │ nova aparece sem que esta tela seja tocada.                                                      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE UMA JANELA, E NÃO UM MENU MAIOR ──────────────────────────────────────────────────────┐
 * │ A versão anterior era uma caixa estreita com uma pilha de botões por família: cada linha trazia  │
 * │ código e nome, e nada mais. Escolher exigia saber de cor o que cada TOP faz nascer, porque a     │
 * │ consequência da escolha — em QUE documento a operação cai — estava no cabeçalho do grupo, não na │
 * │ linha; e com a lista rolando, o cabeçalho saía da tela justamente quando era preciso.            │
 * │                                                                                                  │
 * │ Uma janela só se paga em COLUNA e CABEÇALHO, nunca em pixels. Então: `size="lg"` (o perfil       │
 * │ `large` já vem por padrão — moldura de altura fixa, cabeçalho e rodapé parados, só o corpo        │
 * │ rolando), pesquisa no topo, e cada linha carregando o que decide: Código · Operação · Tipo de     │
 * │ documento. A moldura não muda de altura entre carregando, erro, vazio e doze linhas — o rodapé   │
 * │ não pula a cada tecla digitada. A largura é a OFICIAL do sistema de design; nenhuma tela define   │
 * │ largura própria (`docs/UI-STANDARD.md`, auditado por `scripts/ui-audit.mjs`).                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A FAMÍLIA É COLUNA, NÃO CABEÇALHO DE GRUPO ───────────────────────────────────────────────────┐
 * │ Lista ÚNICA e PLANA, sempre — um só modo, um só índice de teclado, nenhum grupo vazio quando a   │
 * │ pesquisa recorta. A família aparece em TODA linha, com o rótulo humano ("Tipo de documento"),    │
 * │ e sobrevive ao filtro; cabeçalho de grupo não sobrevive. O agrupamento visual vem da ORDEM       │
 * │ (linhas da mesma família saem contíguas de `linhasDeLancamento`), não de moldura.                │
 * │                                                                                                  │
 * │ A `<div>` por família continua existindo no DOM — é ela que declara `data-familia` e contém as   │
 * │ linhas daquela família, além de ser onde o BLOQUEIO daquela família é publicado. Ela é estrutura  │
 * │ e contrato de teste; visualmente não desenha nada.                                               │
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
 * │ com nenhuma linha (quem decide isso é `podeLancar`, dentro de `linhasDoGrupo`). Abrir o          │
 * │ lançamento assim mesmo devolveria o documento sem TOP que a capability existe para impedir.      │
 * │                                                                                                  │
 * │ A mensagem de bloqueio NÃO é escondida pela pesquisa. Um aviso de fail-closed que some porque o  │
 * │ usuário digitou três letras vira "sumiu a família", e não "a família está bloqueada".            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * A GRADE DE COLUNAS, declarada UMA vez, usada no cabeçalho e em cada linha. Duas listas de colunas
 * desalinham no primeiro ajuste — e desalinham em silêncio, que é o pior jeito de desalinhar.
 *
 * Em tela estreita a grade cai para três colunas (marcador · conteúdo empilhado · selo): o bloco do
 * meio deixa de ser `display: contents` e vira uma pilha, em vez de virar uma tabela horizontal
 * impossível de ler no celular. Nenhuma largura fixa em pixel de viewport para a MOLDURA: só as
 * duas pistas de serviço (marcador e selo) têm medida fixa, e é isso que mantém o alinhamento.
 *
 * A PISTA DO SELO É FIXA, E NÃO `auto`, PORQUE `auto` NÃO ALINHA. Cada linha é uma grade PRÓPRIA —
 * não há `subgrid` —, então os tracks NÃO são compartilhados entre linhas: com `auto`, a pista vale
 * 0px na linha sem selo e ~50px na linha com selo, e "Tipo de documento" começa em posições
 * diferentes em cada uma, sem ficar sob o próprio cabeçalho. Numa janela cuja razão de existir é
 * "coluna e cabeçalho", era o defeito mais visível dela.
 */
const COLUNAS = "grid-cols-[18px_minmax(0,1fr)_64px] sm:grid-cols-[18px_minmax(72px,104px)_minmax(0,1fr)_minmax(112px,176px)_64px]";

/** Uma linha da janela — `<button role="option">`, porque a lista é um listbox com cursor virtual. */
function Linha({ linha, ativa, idOpcao, aoConfirmar }: {
  linha: LinhaDeLancamento; ativa: boolean; idOpcao: string; aoConfirmar: (l: LinhaDeLancamento) => void;
}) {
  return <button
    type="button"
    role="option"
    id={idOpcao}
    aria-selected={ativa}
    // A LISTA É **UM** TABSTOP, não um por linha: quem navega é o cursor virtual
    // (`aria-activedescendant` no campo de pesquisa), e o foco do DOM nunca sai dele. Com uma dúzia
    // de operações, Tab linha a linha transformaria "escolher uma operação" numa maratona.
    tabIndex={-1}
    data-testid="lancador-top"
    data-top-id={linha.id}
    data-familia={linha.familia}
    data-ativa={ativa ? "true" : "false"}
    data-padrao={linha.ehPadrao ? "true" : "false"}
    className={cn(
      "grid w-full items-center gap-x-3 gap-y-0.5 border-l-[3px] px-2 py-1.5 text-left text-[12.5px] transition-colors",
      COLUNAS,
      // O DESTAQUE DA LINHA ATIVA NÃO PODE DEPENDER DE COR, e nenhum destes sinais sozinho basta:
      //  · o marcador da primeira coluna (FORMA) — a coluna tem largura fixa e existe em todas as
      //    linhas, então virar ativa não empurra o texto para o lado;
      //  · a barra sólida de 3px na borda esquerda (FORMA) — a borda também existe em todas as
      //    linhas, transparente quando inativa, pelo mesmo motivo;
      //  · o contorno de 2px — `outline`, e não `box-shadow`, porque box-shadow SOME no modo de
      //    alto contraste do sistema operacional e o contorno sobrevive;
      //  · o peso tipográfico do nome da operação (ver abaixo).
      // O fundo é REFORÇO, nunca o sinal: em escala de cinza a diferença tem de continuar visível.
      ativa
        ? "border-l-brand-600 bg-brand-50 outline-2 -outline-offset-2 outline-brand-600"
        : "border-l-transparent hover:bg-slate-50"
    )}
    // CLIQUE ÚNICO CONFIRMA — e por isso NÃO existe duplo clique aqui. Se o clique já lança,
    // acrescentar o duplo criaria a corrida clássica: o primeiro `click` navega, o segundo cai na
    // página de destino (clique fantasma no mesmo pixel) ou dispara uma segunda navegação. Quem
    // precisa de um caminho de confirmação explícito tem o botão primário do rodapé e o Enter.
    onClick={() => aoConfirmar(linha)}
  >
    {/* Marcador: `aria-hidden` porque quem informa a seleção ao leitor de tela é `aria-selected`. */}
    <span className="flex items-center justify-center text-brand-700" aria-hidden>
      {ativa ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
    {/* Em tela larga estes três viram células da grade; em tela estreita, uma pilha na coluna do meio. */}
    <span className="flex min-w-0 flex-col gap-0.5 sm:contents">
      <span className="truncate font-mono text-[12px] font-semibold text-slate-900">{linha.code}</span>
      <span className={cn("truncate text-slate-800", ativa && "font-semibold")}>{linha.name}</span>
      <span className="truncate text-[11.5px] text-slate-500">{linha.rotuloDoTipo}</span>
    </span>
    {/*
      O SELO "PADRÃO" DESCREVE O CADASTRO, NÃO O CURSOR. Ele é TEXTO (lido por leitor de tela e por
      quem não distingue cor), fica na linha que o servidor marcou e NÃO migra para a linha ativa.
      Quando não há padrão, o espaço continua reservado: o selo aparecendo não empurra as colunas.
    */}
    <span className="flex justify-end">{linha.ehPadrao ? <Badge>Padrão</Badge> : null}</span>
  </button>;
}

/** O bloco de uma família: o bloqueio dela (quando houver) e as linhas dela. */
function Grupo({ grupo, linhas, ativo, idOpcao, aoConfirmar }: {
  grupo: GrupoDeTops; linhas: LinhaDeLancamento[]; ativo: string | null;
  idOpcao: (id: string) => string; aoConfirmar: (l: LinhaDeLancamento) => void;
}) {
  const estado = grupo.estado;
  return <div
    // `role="presentation"` de propósito: a família é COLUNA, não grupo anunciado. Sem isto o leitor
    // de tela leria "grupo" entre as linhas de uma lista que na tela é plana — som e imagem divergindo.
    role="presentation"
    data-testid="lancador-grupo"
    data-familia={grupo.variante.familia}
  >
    {/* `empty:hidden`: quando não há bloqueio nem carregamento, `MensagemTop` devolve `null` e o
        contêiner some — nenhum espaçamento sobra entre as famílias, e a lista continua plana. */}
    {/* O CARREGAMENTO NÃO É PUBLICADO AQUI. São três consultas independentes (uma por família) e
        três avisos idênticos e centralizados, empilhados numa lista alinhada à esquerda, diziam
        menos do que um só. Quem anuncia "carregando" é a lista inteira, uma vez; aqui fica só o
        BLOQUEIO, que é por família e precisa dizer QUAL família está bloqueada. */}
    <div className="px-2 py-1 empty:hidden">
      {estado.situacao === "carregando" ? null : <MensagemTop estado={estado} />}
    </div>
    {linhas.map((l) => <Linha key={l.id} linha={l} ativa={l.id === ativo} idOpcao={idOpcao(l.id)} aoConfirmar={aoConfirmar} />)}
  </div>;
}

export function LancadorUnificadoDeVendas() {
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
   * GUARDA DE REENTRÂNCIA. `router.push` é assíncrono e o diálogo continua montado até desmontar:
   * sem isto, um segundo Enter (ou um clique enquanto a rota carrega) dispararia uma segunda
   * navegação. `useRef` porque a decisão precisa valer JÁ, no mesmo evento — estado só valeria no
   * próximo render, que é tarde demais.
   */
  const lancando = React.useRef(false);
  const [ocupado, setOcupado] = React.useState(false);
  const campoBusca = React.useRef<HTMLInputElement>(null);
  const idLista = React.useId();
  const idOpcao = React.useCallback((id: string) => `${idLista}-${id}`, [idLista]);

  // Só os grupos que o usuário pode LANÇAR. Sem nenhum, o botão não existe: oferecer "Novo" a quem não
  // pode criar nada é oferecer uma porta fechada.
  const grupos = useTopsDeVendas().filter((g) => g.habilitado);
  const todas = linhasDeLancamento(grupos);
  const visiveis = filtrarLinhas(todas, busca);
  const padrao = padraoDeLancamento(todas);
  const ativo = linhaAtivaDoRecorte({ visiveis, escolhido, padrao });
  const linhaAtiva = visiveis.find((l) => l.id === ativo) ?? null;

  const algumCarregando = grupos.some((g) => g.estado.situacao === "carregando");
  // `!podeLancar(...)` e não uma terceira leitura do discriminador: quem responde "esta família
  // pode lançar?" é o dono da pergunta. Ler o enum cru aqui funcionaria hoje e divergiria em
  // silêncio no dia em que `podeLancar` aceitasse um estado novo.
  const algumBloqueio = grupos.some((g) => g.estado.situacao !== "carregando" && !podeLancar(g.estado));
  const buscando = busca.trim().length > 0;
  /**
   * O VAZIO SÓ FALA QUANDO NINGUÉM MAIS ESTÁ FALANDO. Enquanto alguma família carrega, o silêncio é
   * honesto (ainda não se sabe). Se alguma família já publicou bloqueio e o usuário não pesquisou
   * nada, a mensagem dela já explica a ausência — repetir "nenhuma operação disponível" ao lado
   * seria ruído contraditório.
   */
  const mostrarVazio = !algumCarregando && visiveis.length === 0 && (buscando || !algumBloqueio);

  const abrir = () => {
    // Cada abertura começa limpa: pesquisa vazia, sem escolha herdada da vez anterior e com a guarda
    // de reentrância rearmada.
    setBusca(""); setEscolhido(null); setOcupado(false); lancando.current = false;
    setAberto(true);
  };

  const confirmar = React.useCallback((linha: LinhaDeLancamento) => {
    if (lancando.current) return;
    lancando.current = true;
    setOcupado(true);
    // FECHA ANTES DE NAVEGAR: com o overlay ainda montado sobre a rota nova, ele capturaria o clique
    // seguinte e o usuário voltaria à pergunta que acabou de responder.
    setAberto(false);
    router.push(rotaDeLancamento(linha));
  }, [router]);

  /**
   * FOCO INICIAL NO CAMPO DE PESQUISA, sempre — nunca na linha padrão. Digitar é a ação mais
   * provável, e recuperar o padrão custa UMA tecla (ele já nasce como linha ativa); o inverso
   * custaria Shift+Tab e procurar o campo. O `setTimeout(0)` roda DEPOIS do foco automático do
   * próprio overlay, que sem isto ficaria por último.
   */
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

  /**
   * REGIÃO VIVA. O foco do DOM não se move com as setas e o recorte muda a cada tecla: sem anunciar
   * a contagem, quem usa leitor de tela digita no vazio. O atraso evita anunciar cada caractere.
   */
  React.useEffect(() => {
    if (!aberto) { setAnuncio(""); return; }
    const t = window.setTimeout(() => setAnuncio(textoDeContagem(visiveis.length)), 250);
    return () => window.clearTimeout(t);
  }, [aberto, visiveis.length]);

  /**
   * A ESCADA DO TECLADO — toda capturada pelo CAMPO, com `preventDefault`, para que o foco do DOM
   * nunca saia dele.
   *
   * ESC não aparece aqui de propósito: quem fecha é o overlay oficial, SEMPRE, inclusive com texto
   * na pesquisa. "Primeiro ESC limpa, segundo fecha" seria uma exceção local numa convenção que vale
   * em todo o resto do produto — e o campo já tem um botão Limpar para isso.
   */
  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // `moverAtivo` só devolve `null` quando o recorte está VAZIO. Nesse caso a seta não apaga a escolha
    // que o usuário já tinha feito: ela está apenas escondida pela pesquisa, e volta quando o texto sair.
    const mover = (movimento: MovimentoDeCursor) => { const alvo = moverAtivo(visiveis, ativo, movimento); if (alvo) setEscolhido(alvo); };
    if (e.key === "ArrowDown") { e.preventDefault(); mover("proximo"); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); mover("anterior"); return; }
    // Home/End só viram navegação da LISTA quando não há texto: com texto digitado eles são as teclas
    // de edição do campo, e sequestrá-las seria quebrar o que o usuário espera de uma caixa de texto.
    if ((e.key === "Home" || e.key === "End") && busca === "") {
      e.preventDefault(); mover(e.key === "Home" ? "primeiro" : "ultimo"); return;
    }
    if (e.key === "Enter") {
      // Enter SEM linha ativa é NO-OP declarado: não fecha, não lança e não "tenta a primeira".
      // Enter que não faz nada é previsível; Enter que lança o item errado é incidente.
      e.preventDefault();
      if (linhaAtiva) confirmar(linhaAtiva);
    }
  };

  if (!grupos.length) return null;
  return <>
    <button type="button" className="tb-btn is-primary" data-testid="vendas-novo" aria-haspopup="dialog" aria-expanded={aberto} onClick={abrir}>
      <Plus className="h-3.5 w-3.5" /> Novo
    </button>
    <Dialog
      open={aberto} onOpenChange={setAberto} size="lg" testId="lancador-unificado"
      title="Novo documento" description="Escolha a operação que deseja lançar."
      bodyClassName="flex flex-col gap-2"
      footer={<>
        <Button variant="outline" data-testid="lancador-cancelar" onClick={() => setAberto(false)}>{COPY.fechar}</Button>
        {/*
          A AÇÃO PRIMÁRIA É NOMEADA E FICA SEMPRE VISÍVEL (o rodapé do perfil `large` é fixo). Ela é o
          CONTRATO da janela; o clique na linha é só um atalho. Desabilitada sem linha ativa: com o
          recorte vazio, com o padrão fora do recorte, e — deliberadamente — quando há uma única
          operação sem padrão declarado. Cardinalidade não escolhe pelo usuário.
        */}
        <Button data-testid="lancador-lancar" disabled={!linhaAtiva || ocupado} onClick={() => { if (linhaAtiva) confirmar(linhaAtiva); }}>Lançar</Button>
      </>}
    >
      <div className="flex items-center gap-2">
        <Input
          ref={campoBusca}
          data-testid="lancador-busca"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={aoTeclar}
          placeholder="Pesquisar por código ou descrição da operação"
          aria-label="Pesquisar operação"
          // O par combobox + listbox é o que faz o leitor de tela ACOMPANHAR as setas: o foco do DOM
          // fica no campo, e `aria-activedescendant` aponta a linha ativa. `role="grid"` seria errado
          // aqui — grid obriga navegação por célula (← →), que ninguém quer para escolher uma operação.
          role="combobox"
          aria-expanded="true"
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={ativo ? idOpcao(ativo) : undefined}
          className="flex-1"
        />
        {buscando && <Button variant="outline" data-testid="lancador-limpar-busca" onClick={() => { setBusca(""); campoBusca.current?.focus(); }}>Limpar</Button>}
      </div>

      {/* SÓ O CORPO ROLA. A moldura e o rodapé ficam parados entre carregando, bloqueio, vazio e lista
          cheia — é isso que impede o diálogo de pular de tamanho a cada tecla. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {/*
          O CABEÇALHO MORA DENTRO DO ROLADOR, e é `sticky` em vez de ficar acima dele.
          Fora do rolador, ele não sofre o recuo da barra de rolagem: quando a lista transborda e a
          barra CLÁSSICA aparece (~15px no Windows e no Linux), a largura útil das LINHAS encolhe e a
          do cabeçalho não — as colunas saem do lugar. Pior: o recuo APARECE e SOME conforme a
          pesquisa recorta a lista, então as colunas pulariam a cada tecla, que é exatamente o que
          esta janela existe para não fazer. Dentro, os dois encolhem juntos.

          `aria-hidden` porque cada linha já se anuncia inteira; para o leitor de tela ele seria texto
          solto dentro de um listbox. Some em tela estreita, onde não há colunas.

          A borda esquerda transparente de 3px espelha a das linhas: sem ela, o conteúdo do cabeçalho
          ficaria permanentemente 3px à esquerda do conteúdo das linhas.

          `bg-white` e não o token do cartão: a catraca de nomenclatura (`scripts/naming-audit.mjs`)
          conta o prefixo herdado do sistema de referência e só aceita que ele DIMINUA — código novo
          nasce neutro. O valor é o mesmo (`#ffffff`, e o produto não tem tema escuro), então a
          equivalência é exata e não se paga dívida nova por ela.
        */}
        <div className={cn("sticky top-0 z-10 hidden border-b border-l-[3px] border-slate-200 border-l-transparent bg-white px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid", COLUNAS, "items-center gap-x-3")} aria-hidden="true">
          <span />
          <span>Código</span>
          <span>Tipo de Operação</span>
          <span>Tipo de documento</span>
          <span />
        </div>
        {/* UM aviso de carregamento para a janela inteira, ocupando a altura do rolador — e não um
            por família. A moldura já é de altura fixa, então nada pula quando ele sai. */}
        {algumCarregando && <div className="h-full" data-testid="lancador-carregando">
          <LoadingState label="Carregando os tipos de operação…" />
        </div>}
        <div role="listbox" id={idLista} aria-label="Operações disponíveis para lançamento">
          {grupos.map((g) => <Grupo
            key={g.variante.variante}
            grupo={g}
            linhas={filtrarLinhas(linhasDoGrupo(g), busca)}
            ativo={ativo}
            idOpcao={idOpcao}
            aoConfirmar={confirmar}
          />)}
        </div>
        {/* O testid mora no invólucro: `EmptyState` não repassa props desconhecidas, e um
            `data-testid` entregue a ele sumiria no caminho sem ninguém perceber. */}
        {/* `h-full`: a regra de centragem do `globals.css` exige filho DIRETO do corpo do diálogo, e
            aqui o EmptyState está dois níveis abaixo. Sem isto ele fica colado no topo, com meia
            janela vazia embaixo. O próprio EmptyState já se centra dentro da altura que receber. */}
        {mostrarVazio && <div className="h-full" data-testid="lancador-vazio">
          <EmptyState
            title={buscando ? "Nenhuma operação encontrada para esta busca." : "Nenhuma operação disponível para lançamento."}
            action={buscando ? <Button variant="outline" data-testid="lancador-vazio-limpar" onClick={() => { setBusca(""); campoBusca.current?.focus(); }}>Limpar pesquisa</Button> : undefined}
          />
        </div>}
      </div>

      <span className="sr-only" role="status" aria-live="polite" data-testid="lancador-contagem">{anuncio}</span>
    </Dialog>
  </>;
}
