"use client";
import * as React from "react";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import type { ItemRapido, PropsDasAcoesRapidas } from "./contrato";
import { BotaoDaBarra, IconeRaio } from "./barra";
import { ListaDeDocumentosAbertos, useDocumentosAbertos } from "./documentos-abertos";
import estilos from "./barra.module.css";
import estilosCentral from "./moldura.module.css";

/**
 * O ARCO DO LEQUE — raio 60, passo 33°, centrado em 138° (para baixo e para a esquerda do botão, que fica na ponta
 * direita da barra). O primeiro item é o de baixo; os seguintes sobem pela esquerda.
 */
const RAIO = 60, PASSO = 33, MEIO = 138;
export function posicaoNoLeque(i: number, total: number): { x: number; y: number } {
  const angulo = ((MEIO + (i - (total - 1) / 2) * PASSO) * Math.PI) / 180;
  return { x: Math.round(Math.cos(angulo) * RAIO), y: Math.round(Math.sin(angulo) * RAIO) };
}

/**
 * AÇÕES RÁPIDAS (⚡) — o leque, de baixo para cima: `antes`, "N documentos abertos" (a VISÃO das abas da espécie,
 * pela fonte que o adaptador injeta) e `depois`. Escolher um item fecha o leque e devolve o foco ao ⚡ antes de a ação
 * abrir o que for dela (diálogo, lista).
 */
export function AcoesRapidas({ prefixoTestid, documentosAbertos, antes, depois = [], desabilitado }: PropsDasAcoesRapidas) {
  const documentos = useDocumentosAbertos(documentosAbertos);
  const [aberto, setAberto] = React.useState(false);
  const [listaAberta, setListaAberta] = React.useState(false);
  const ancora = React.useRef<HTMLSpanElement>(null);
  const botao = React.useRef<HTMLButtonElement>(null);
  const escolheu = React.useRef(false);
  const fecharLista = React.useCallback(() => setListaAberta(false), []);
  const total = documentos?.docs.length ?? 0;
  const itens: ItemRapido[] = [
    ...antes,
    ...(documentos ? [{ chave: "documentos", rotulo: total === 1 ? "1 documento aberto" : `${total} documentos abertos`, numero: total, testId: `${prefixoTestid}-documentos`, onSelect: () => setListaAberta(true) }] : []),
    ...depois
  ];
  return <span className={estilos.leque} ref={ancora}>
    <DropdownP.Root modal={false} open={aberto} onOpenChange={(o) => { setAberto(o); if (o) setListaAberta(false); }}>
      <DropdownP.Trigger asChild disabled={desabilitado}>
        <BotaoDaBarra ref={botao} rotulo="Ações rápidas" dicaNoFim data-testid={`${prefixoTestid}-acoes-rapidas`}><IconeRaio /></BotaoDaBarra>
      </DropdownP.Trigger>
      <DropdownP.Content side="bottom" align="center" sideOffset={-12.5} avoidCollisions={false} loop className={estilos.lequeConteudo}
        aria-label="Ações rápidas" data-testid={`${prefixoTestid}-acoes-rapidas-leque`}
        onCloseAutoFocus={(e) => { if (escolheu.current) { escolheu.current = false; e.preventDefault(); } }}>
        {itens.map((it, i) => {
          const { x, y } = posicaoNoLeque(i, itens.length);
          const posicao = { "--x": `${x}px`, "--y": `${y}px`, "--atraso-entrada": `${i * 34}ms`, "--atraso-saida": `${(itens.length - 1 - i) * 22}ms` } as React.CSSProperties;
          return <DropdownP.Item key={it.chave} asChild disabled={it.desabilitado}
            onSelect={() => { escolheu.current = true; botao.current?.focus(); it.onSelect(); }}>
            <button type="button" className={cn(estilos.lequeItem, it.numero !== undefined && estilos.lequeNumero, it.perigo && estilos.lequePerigo, estilosCentral.dicaFim)} style={posicao}
              aria-label={it.rotulo} data-dica={it.rotulo} data-testid={it.testId} disabled={it.desabilitado}
              /* fechando, o círculo volta ao ⚡ por baixo do ponteiro: o Radix leria isso como "entrou/saiu do item" e
                 puxaria o foco para o menu — tirando-o de quem a ação acabou de abrir (a pesquisa da lista, o diálogo) */
              onPointerMove={(e) => { if (!aberto) e.preventDefault(); }} onPointerLeave={(e) => { if (!aberto) e.preventDefault(); }}>
              {it.numero !== undefined ? <span data-testid={`${prefixoTestid}-documentos-contador`}>{it.numero}</span> : it.icone}
            </button>
          </DropdownP.Item>;
        })}
      </DropdownP.Content>
    </DropdownP.Root>
    {documentos && <ListaDeDocumentosAbertos prefixoTestid={prefixoTestid} fonte={documentosAbertos} aberta={listaAberta} onFechar={fecharLista} ancora={ancora} botao={botao} documentos={documentos} />}
  </span>;
}
