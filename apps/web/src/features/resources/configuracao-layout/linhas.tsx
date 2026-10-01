"use client";
/**
 * CONFIGURAÇÃO DE LAYOUT — as linhas do card aberto e os campos (VISUAL-UX-03, decisão 275, 4.4 e 4.5).
 *
 * Desenha a VISTA que a página passa (o layout sem o item na mão) com a RÉGUA do desenho: cada campo ocupa 1/limite da
 * linha (7 no card inteiro, 4 no meio), o "+ Campo" ocupa uma coluna e a sobra guarda as colunas vazias. As posições são
 * as REAIS da linha da vista, contando os ocultos — com Pré-visualizar o oculto some da linha, mas continua no x/y e na
 * posição de soltar.
 *
 * Endereços por card + posição, nunca por `row.id`: a linha é alvo `{ t: "linha" }`, cada campo (com o vão de 8 px
 * antes dele) é alvo `{ t: "campo", posicao }`, e depois da última linha a área do "Adicionar linha" é `{ t: "fim-linhas" }`.
 * Os estados do arrastar (vão aberto, troca, eco, traço da linha, pouso) saem de `previsao` e `pouso` do motor.
 */
import * as React from "react";
import { EyeOff, Lock, Plus, Settings as Engrenagem, Trash2, X, Zap } from "lucide-react";
import type { LayoutCard } from "@agro/shared";
import { cn } from "@/lib/utils";
import { useArraste } from "./arraste";
import { limiteDaLinha } from "./rascunho";
import { alvo, type ApiArraste, type EnderecoLinha, type PropsLinhas } from "./tipos";
import estilos from "./estrutura.module.css";
/* a dica é uma só (W1): aqui só se escolhe a ancoragem nas pontas, para ela não sair da área das linhas */
import estilosPagina from "./pagina.module.css";

const MOTIVO_UMA_LINHA = "O card precisa de ao menos uma linha";

const sim = (v: boolean): "true" | undefined => (v ? "true" : undefined);

/** botão dentro de algo arrastável: o clique nele não começa arraste */
const naoArrasta = (e: React.PointerEvent<HTMLElement>) => e.stopPropagation();

/** title do campo: "Rótulo · obrigatório/opcional · oculto · somente leitura · com valor padrão · campo do sistema" */
function resumoDoCampo(rotulo: string, c: { obrigatorio: boolean; oculto: boolean; somenteLeitura: boolean; temValorPadrao: boolean; doSistema: boolean }): string {
  const partes = [rotulo, c.obrigatorio ? "obrigatório" : "opcional"];
  if (c.oculto) partes.push("oculto");
  if (c.somenteLeitura) partes.push("somente leitura");
  if (c.temValorPadrao) partes.push("com valor padrão");
  if (c.doSistema) partes.push("campo do sistema");
  return partes.join(" · ");
}

/** title da troca: o rótulo do LAYOUT do campo na mão (o item leva o nome do sistema, que é o do fantasma e do vão) */
function rotuloDoItem(base: PropsLinhas, item: ApiArraste["item"]): string {
  if (!item) return "";
  return item.tipo === "campo" || item.tipo === "disponivel" ? base.rotulo(item.fid) : item.rotulo;
}

interface PropsLinha {
  base: PropsLinhas;
  arraste: ApiArraste;
  card: LayoutCard;
  /** índice da linha na vista */
  indice: number;
  campos: string[];
  limite: number;
  /** "Linha 1" vazia de card sem linha: não existe no rascunho, então não se remove */
  provisoria: boolean;
}

/** vão de 8 px antes de um campo (ou no fim); aberto, é o lugar onde o item entra, com o nome dele */
function Vao({ quente, rotulo, crescer, alvoDoVao }: { quente: boolean; rotulo: string; crescer: number; alvoDoVao?: string }) {
  return (
    <span
      className={cn(estilos.vao, quente && estilos.vaoQuente)}
      style={{ flexGrow: crescer }}
      data-parte={quente ? "vao" : undefined}
      data-alvo={alvoDoVao}
      aria-hidden="true"
    >
      <span>{quente ? rotulo : ""}</span>
    </span>
  );
}

function Linha({ base, arraste, card, indice, campos, limite, provisoria }: PropsLinha) {
  const { item, previsao, pouso, iniciar } = arraste;
  const edicao = base.modo === "edicao";
  const numero = indice + 1;
  const titulo = `Linha ${numero}`;
  const endereco: EnderecoLinha = { cardId: card.id, linha: indice };
  const n = campos.length;
  const cheia = n >= limite;
  const rotuloNaMao = item?.rotulo ?? "";

  const nestaLinha = (p: { cardId: string; linha: number }) => p.cardId === card.id && p.linha === indice;
  const inserir = previsao?.tipo === "inserir" && nestaLinha(previsao) ? previsao.posicao : null;
  const troca = previsao?.tipo === "trocar" && nestaLinha(previsao) ? previsao : null;
  /* eco: o lugar que o campo arrastado deixou mostra quem vem para cá */
  const eco = previsao?.tipo === "trocar" && !previsao.recusa && item?.tipo === "campo" && nestaLinha(item.origem)
    ? { posicao: item.origem.posicao, rotulo: base.rotulo(previsao.fidAlvo) }
    : null;
  const traco = previsao?.tipo === "linha" && previsao.cardId === card.id && previsao.antes === indice;
  const marcada = !!base.marca && base.marca.cardId === card.id && base.marca.linha === indice;
  const pousou = pouso?.tipo === "linha" && pouso.cardId === card.id && pouso.linha === indice;

  /* a régua: o "+ Campo" só existe na edição, em linha com vaga e sem vão aberto nem eco; a sobra completa o limite */
  const comMaisCampo = edicao && !cheia && inserir === null && eco === null;
  const sobra = Math.max(0, limite - n - (eco ? 1 : 0) - (comMaisCampo ? 1 : 0) - (inserir !== null ? 1 : 0));
  const fimQuente = inserir !== null && inserir >= n;
  const motivoRemover = provisoria ? MOTIVO_UMA_LINHA : base.motivoNaoRemoverLinha(endereco);

  const elementoEco = eco ? (
    <span key="eco" className={estilos.envoltorioCampo} style={{ flexGrow: 1 }}>
      <Vao quente={false} rotulo="" crescer={0} />
      <span className={cn(estilos.campo, estilos.eco)} style={{ flexGrow: 1 }} data-parte="eco" title={`${eco.rotulo} vem para cá`}>
        <span className={estilos.campoTexto}><span className={estilos.campoRotulo}>↔ {eco.rotulo}</span></span>
      </span>
    </span>
  ) : null;

  const corpo: React.ReactNode[] = [];
  campos.forEach((fid, posicao) => {
    if (eco && eco.posicao === posicao) corpo.push(elementoEco);
    const quente = inserir === posicao;
    const escondido = base.preVisualizar && base.oculto(fid);
    if (escondido && !quente) return;
    corpo.push(
      <span
        key={fid}
        className={estilos.envoltorioCampo}
        style={{ flexGrow: quente && !escondido ? 2 : 1 }}
        data-alvo={alvo({ t: "campo", cardId: card.id, linha: indice, posicao })}
      >
        <Vao quente={quente} rotulo={rotuloNaMao} crescer={quente ? 1 : 0} />
        {!escondido && (
          <CampoDaLinha
            base={base}
            arraste={arraste}
            fid={fid}
            endereco={{ ...endereco, posicao }}
            troca={troca && troca.posicao === posicao ? troca : null}
            naPonta={posicao >= limite - 1}
          />
        )}
      </span>
    );
  });
  if (eco && eco.posicao >= n) corpo.push(elementoEco);

  return (
    <div
      role="group"
      aria-label={`${titulo} do card ${card.label}`}
      data-parte="linha"
      data-linha={indice}
      data-alvo-ativo={sim(inserir !== null)}
      data-marcada={sim(marcada)}
      data-cheia={sim(cheia)}
      data-pousa={sim(pousou)}
      data-alvo={alvo({ t: "linha", cardId: card.id, linha: indice })}
      className={estilos.linha}
    >
      {traco && <span data-parte="traco-linha" className={estilos.tracoLinha} aria-hidden="true" />}
      <div
        className={estilos.cabecaLinha}
        data-parte="cabeca-linha"
        onPointerDown={edicao && !provisoria ? (e) => iniciar(e, { tipo: "linha", cardId: card.id, linha: indice, rotulo: titulo, detalhe: `${n}/${limite}` }) : undefined}
      >
        <span className={estilos.tituloLinha}>{titulo}</span>
        <span
          className={cn(estilos.contadorLinha, cheia ? estilos.contadorCheio : n >= limite - 1 && estilos.contadorUmaVaga, estilosPagina.dicaInicio)}
          data-parte="contador-linha"
          data-dica="Campos na linha / limite do card"
        >
          {n}/{limite}
        </span>
        <span className={estilos.espaco} />
        {edicao && (
          <button
            type="button"
            className={cn(estilos.lixeira, estilosPagina.dicaFim)}
            aria-label={`Remover ${titulo}`}
            data-dica={motivoRemover ?? "Remover linha"}
            disabled={motivoRemover !== null}
            onPointerDown={naoArrasta}
            onClick={() => base.aoRemoverLinha(endereco)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <div className={estilos.corpoLinha} data-parte="corpo-linha">
        {corpo}
        <Vao
          quente={fimQuente}
          rotulo={rotuloNaMao}
          crescer={fimQuente ? 1 : 0}
          alvoDoVao={fimQuente ? alvo({ t: "campo", cardId: card.id, linha: indice, posicao: n }) : undefined}
        />
        {comMaisCampo && (
          <button
            type="button"
            className={estilos.maisCampo}
            style={{ flexGrow: 1 }}
            data-parte="mais-campo"
            aria-label={`Adicionar campo em ${titulo}`}
            onClick={() => base.aoMarcarLinha(endereco)}
          >
            <Plus size={13} />
            Campo
          </button>
        )}
        <span className={estilos.sobra} style={{ flexGrow: sobra }} aria-hidden="true" />
      </div>
    </div>
  );
}

interface PropsCampoDaLinha {
  base: PropsLinhas;
  arraste: ApiArraste;
  fid: string;
  endereco: EnderecoLinha & { posicao: number };
  /** a previsão de troca, quando este campo é o alvo dela */
  troca: { recusa: boolean } | null;
  /** última coluna da linha: a dica do ⚙ e do × ancora pela direita */
  naPonta: boolean;
}

function CampoDaLinha({ base, arraste, fid, endereco, troca, naPonta }: PropsCampoDaLinha) {
  const edicao = base.modo === "edicao";
  const rotulo = base.rotulo(fid);
  const estado = {
    obrigatorio: base.obrigatorio(fid),
    oculto: base.oculto(fid),
    somenteLeitura: base.somenteLeitura(fid),
    temValorPadrao: base.temValorPadrao(fid),
    doSistema: base.doSistema(fid)
  };
  const selecionado = base.selecionado === fid;
  const comInspetor = base.inspetor === fid;
  const pousou = arraste.pouso?.tipo === "campo" && arraste.pouso.fids.includes(fid);
  const titulo = troca
    ? (troca.recusa ? "Campo do sistema — não sai do formulário" : `Trocar de lugar com ${rotuloDoItem(base, arraste.item)}`)
    : resumoDoCampo(rotulo, estado);

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={rotulo}
      aria-pressed={selecionado}
      title={titulo}
      data-parte="campo"
      data-fid={fid}
      data-selecionado={sim(selecionado)}
      data-inspetor={sim(comInspetor)}
      data-oculto={sim(estado.oculto)}
      data-obrigatorio={sim(estado.obrigatorio)}
      data-somente-leitura={sim(estado.somenteLeitura)}
      data-pousa={sim(pousou)}
      data-troca={troca ? (troca.recusa ? "recusa" : "ok") : undefined}
      className={estilos.campo}
      style={{ flexGrow: 1 }}
      onClick={() => base.aoSelecionar(fid)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); base.aoAbrirInspetor(fid); }
      }}
      onPointerDown={edicao
        /* o item leva o nome do sistema (o texto do fantasma e do vão, como `dragCampo.label` do desenho) */
        ? (e) => arraste.iniciar(e, { tipo: "campo", fid, rotulo: base.nomeDoSistema(fid), obrigatorio: estado.obrigatorio, origem: endereco })
        : undefined}
    >
      <span className={estilos.campoTexto}>
        <span className={estilos.campoRotulo}>{rotulo}</span>
        {estado.obrigatorio && <span className={estilos.asterisco} title="Obrigatório">*</span>}
      </span>
      {estado.oculto && <span className={estilos.marca} title="Oculto no formulário"><EyeOff size={12} /></span>}
      {estado.somenteLeitura && <span className={estilos.marca} title="Somente leitura"><Lock size={12} /></span>}
      {estado.temValorPadrao && <span className={estilos.marca} title="Tem valor padrão"><Zap size={12} /></span>}
      {edicao && !troca && (
        <>
          <button
            type="button"
            className={cn(estilos.botaoPropriedades, comInspetor && estilos.botaoPropriedadesAtivo, naPonta && estilosPagina.dicaFim)}
            aria-label={`Propriedades de ${rotulo}`}
            data-dica="Propriedades do campo"
            onPointerDown={naoArrasta}
            onClick={(e) => { e.stopPropagation(); base.aoAbrirInspetor(fid); }}
          >
            <Engrenagem size={13} />
          </button>
          <button
            type="button"
            className={cn(estilos.botaoTirar, naPonta && estilosPagina.dicaFim)}
            aria-label={`Tirar ${rotulo} do formulário`}
            data-dica={estado.doSistema ? "Campo do sistema — não sai do formulário" : "Tirar do formulário"}
            disabled={estado.doSistema}
            onPointerDown={naoArrasta}
            onClick={(e) => { e.stopPropagation(); base.aoTirar(fid); }}
          >
            <X size={12} />
          </button>
        </>
      )}
    </span>
  );
}

export function Linhas(props: PropsLinhas) {
  const arraste = useArraste();
  const { item, previsao } = arraste;
  const edicao = props.modo === "edicao";
  /* o card da VISTA (sem o item na mão), pelo id do card aberto */
  const card = props.card ? (props.layout.cards.find((c) => c.id === props.card?.id) ?? props.card) : undefined;

  if (!card) return <div data-parte="area-linhas" className={cn(estilos.areaLinhas, edicao && estilos.emEdicao, item && estilos.arrastando)} />;

  const limite = limiteDaLinha(card);
  /* a linha na mão saiu da vista: as seguintes guardam a chave da posição real (sem piscar a entrada) */
  const linhaNaMao = item?.tipo === "linha" && item.cardId === card.id ? item.linha : null;
  const chaveReal = (i: number) => (linhaNaMao !== null && i >= linhaNaMao ? i + 1 : i);
  const provisoria = card.rows.length === 0 && linhaNaMao === null;
  const linhas: string[][] = provisoria ? [[]] : card.rows.map((r) => r.fieldIds);
  const tracoNoFim = previsao?.tipo === "linha" && previsao.cardId === card.id && previsao.antes >= linhas.length;
  const alvoFim = alvo({ t: "fim-linhas", cardId: card.id });

  return (
    <div data-parte="area-linhas" className={cn(estilos.areaLinhas, edicao && estilos.emEdicao, item && estilos.arrastando)}>
      {linhas.map((campos, i) => (
        <Linha
          key={`${card.id}:${chaveReal(i)}`}
          base={props}
          arraste={arraste}
          card={card}
          indice={i}
          campos={campos}
          limite={limite}
          provisoria={provisoria}
        />
      ))}
      {/* depois da última linha (`.fim`) e o "Adicionar linha": filhos diretos da área (entram com o fadeIn dela), os dois
          alvo de fim — linha arrastada vai para o fim */}
      <div key={`${card.id}:fim`} className={estilos.fimLinhas} data-alvo={alvoFim} aria-hidden="true">
        {tracoNoFim && <span data-parte="traco-linha" className={estilos.tracoFim} />}
      </div>
      {edicao && (
        <button key={`${card.id}:adicionar`} type="button" className={estilos.adicionarLinha} data-alvo={alvoFim} onClick={props.aoAdicionarLinha}>
          <Plus size={14} />
          Adicionar linha
        </button>
      )}
    </div>
  );
}
