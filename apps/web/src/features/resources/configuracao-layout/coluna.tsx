"use client";
/**
 * CONFIGURAÇÃO DE LAYOUT — a coluna da esquerda (Disponíveis × Em uso) e o trilho de mover em lote (decisão 275, 4.2).
 *
 * Só aparece na edição; o estado (aba, busca, quem entra e quem sai) é da página (form-layout.tsx). Aqui só se
 * desenha e se avisa: arrastar começa no `iniciar` do motor (arraste.tsx), o "+" e o × chamam a página, e soltar na
 * coluna é um alvo `{ t: "coluna" }` que o motor resolve. A lista procura pelo nome do sistema (o que ela mostra),
 * sem diferenciar maiúscula nem acento.
 */
import * as React from "react";
import { ChevronFirst, ChevronLast, Plus, Search as Lupa, X } from "lucide-react";
import { useArraste } from "./arraste";
import { alvo, type AbaColuna, type CampoInfo, type PropsColuna, type PropsTrilho } from "./tipos";
import estilos from "./coluna.module.css";

const ALVO_COLUNA = alvo({ t: "coluna" });

const ABAS: { id: AbaColuna; rotulo: string }[] = [
  { id: "disponiveis", rotulo: "Disponíveis" },
  { id: "em-uso", rotulo: "Em uso" }
];

const CAIXA_SOLTAR = {
  ok: "Solte para tirar do formulário",
  sistema: "Campo do sistema não sai do formulário",
  "ja-esta": "Este campo já está aqui"
} as const;

/** chave de busca: sem acento e sem diferença de maiúscula */
function chaveDeBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/** o vazio da lista, como o desenho: título e texto conforme a aba e a busca */
function textoDoVazio(vendoDisponiveis: boolean, temCampos: boolean): { titulo: string; texto: string } {
  if (vendoDisponiveis) {
    return temCampos
      ? { titulo: "Nenhum campo com esse nome.", texto: "Tente outro termo." }
      : { titulo: "Todos os campos estão no formulário.", texto: "Para liberar um campo, tire-o de uma linha." };
  }
  return {
    titulo: temCampos ? "Nenhum campo com esse nome." : "Nenhum campo no formulário.",
    texto: "Arraste um campo da lista de disponíveis."
  };
}

/** o botão do item não começa arraste: o clique dele é o caminho de teclado e de mouse sem arrastar */
const naoArrasta = (e: React.PointerEvent<HTMLButtonElement>) => e.stopPropagation();

export function Coluna(props: PropsColuna) {
  const { item, previsao, iniciar } = useArraste();
  const vendoDisponiveis = props.aba === "disponiveis";
  const fonte = vendoDisponiveis ? props.disponiveis : props.emUso;
  const termo = chaveDeBusca(props.busca.trim());
  const itens = termo ? fonte.filter((c) => chaveDeBusca(c.label).includes(termo)) : fonte;
  const vazio = itens.length === 0 ? textoDoVazio(vendoDisponiveis, fonte.length > 0) : null;
  const soltar = previsao?.tipo === "coluna" ? (previsao.recusa ?? "ok") : null;
  /* o item na mão colapsa na lista (o desenho colapsa também o de Em uso quando o campo sai de uma linha) */
  const naMao = item && (item.tipo === "disponivel" || item.tipo === "campo") ? item.fid : null;
  const contagem: Record<AbaColuna, number> = { disponiveis: props.disponiveis.length, "em-uso": props.emUso.length };

  const linhaDoItem = (c: CampoInfo) => {
    const obrigatorio = props.obrigatorio(c.id);
    const doSistema = props.doSistema(c.id);
    return (
      <div
        key={c.id}
        className={vendoDisponiveis ? `${estilos.item} ${estilos.itemArrasta}` : estilos.item}
        role="listitem"
        data-parte="item-campo"
        data-fid={c.id}
        data-obrigatorio={obrigatorio ? "true" : undefined}
        data-na-mao={naMao === c.id ? "true" : undefined}
        title={vendoDisponiveis ? "Segure e arraste para uma linha" : "Já está no formulário"}
        onPointerDown={vendoDisponiveis ? (e) => iniciar(e, { tipo: "disponivel", fid: c.id, rotulo: c.label, obrigatorio }) : undefined}
      >
        <span className={estilos.itemTexto}>
          <span className={estilos.itemNome}>{c.label}</span>
          {obrigatorio && <span className={estilos.asterisco} title="Obrigatório">*</span>}
        </span>
        {vendoDisponiveis ? (
          <button
            type="button"
            className={estilos.itemAcao}
            aria-label={`Adicionar ${c.label}`}
            data-dica="Adicionar ao card"
            onPointerDown={naoArrasta}
            onClick={() => props.aoAdicionar(c.id)}
          >
            <Plus size={12} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className={`${estilos.itemAcao} ${estilos.itemAcaoFixo}`}
            aria-label={`Tirar ${c.label} do formulário`}
            data-dica={doSistema ? "Campo do sistema — não sai" : "Tirar do formulário"}
            disabled={doSistema}
            onPointerDown={naoArrasta}
            onClick={() => props.aoTirar(c.id)}
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </div>
    );
  };

  return (
    <section aria-label="Campos" className={estilos.coluna} data-parte="coluna" data-alvo={ALVO_COLUNA} data-soltar={soltar ?? undefined}>
      {soltar && (
        <div className={estilos.caixaSoltar} data-parte="caixa-soltar" data-recusa={soltar === "ok" ? undefined : "true"}>
          {CAIXA_SOLTAR[soltar]}
        </div>
      )}

      <div className={estilos.abas} role="tablist" aria-label="Lista de campos">
        {ABAS.map((a) => {
          const ativa = props.aba === a.id;
          return (
            <button key={a.id} type="button" role="tab" aria-selected={ativa} className={estilos.aba} onClick={() => props.aoTrocarAba(a.id)}>
              {a.rotulo}
              <span className={estilos.contador}>{contagem[a.id]}</span>
            </button>
          );
        })}
      </div>

      <div className={estilos.buscaFaixa}>
        <label className={estilos.busca} data-parte="busca">
          <Lupa size={14} aria-hidden className={estilos.buscaIcone} />
          <input
            ref={props.refBusca}
            type="text"
            className={estilos.buscaCampo}
            value={props.busca}
            onChange={(e) => props.aoBuscar(e.target.value)}
            placeholder={vendoDisponiveis ? "Procurar campo disponível" : "Procurar campo em uso"}
            aria-label="Procurar campo"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      <div className={estilos.lista} data-parte="lista-campos" role={vazio ? undefined : "list"}>
        {itens.map(linhaDoItem)}
        {vazio && (
          <div className={estilos.vazio} data-parte="vazio-coluna">
            <span className={estilos.vazioTitulo}>{vazio.titulo}</span>
            <span className={estilos.vazioTexto}>{vazio.texto}</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** O trilho entre a coluna e as linhas: Usar todos (todos os disponíveis no card aberto) e Tirar todos (menos os do sistema). */
export function Trilho(props: PropsTrilho) {
  const usar = props.usarTodos > 0 ? `Usar todos · ${props.usarTodos} campos` : "Nada disponível para usar";
  const tirar = props.tirarTodos > 0 ? `Tirar todos · ${props.tirarTodos} campos` : "Nada para tirar deste card";
  return (
    <div className={estilos.trilho} data-parte="trilho">
      <button type="button" className={estilos.trilhoBotao} aria-label={usar} data-dica={usar} disabled={props.usarTodos === 0} onClick={props.aoUsarTodos}>
        <ChevronLast size={14} aria-hidden />
      </button>
      <button type="button" className={estilos.trilhoBotao} aria-label={tirar} data-dica={tirar} disabled={props.tirarTodos === 0} onClick={props.aoTirarTodos}>
        <ChevronFirst size={14} aria-hidden />
      </button>
    </div>
  );
}
