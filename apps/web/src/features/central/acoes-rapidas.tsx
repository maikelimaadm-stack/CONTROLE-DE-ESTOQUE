"use client";
import * as React from "react";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import type { ItemRapido, PropsDasAcoesRapidas } from "./contrato";
import { BotaoDaBarra, IconeRaio } from "./barra";
import { ListaDeDocumentosAbertos, useDocumentosAbertos } from "./documentos-abertos";
import estilos from "./barra.module.css";

/**
 * Posição no arco do leque antigo (API mantida para quem ainda importa).
 * Decisão 353: o menu passou a lista vertical estilo Portal — a função não é mais usada na UI.
 */
export function posicaoNoLeque(i: number, total: number): { x: number; y: number } {
  const RAIO = 60, PASSO = 33, MEIO = 138;
  const angulo = ((MEIO + (i - (total - 1) / 2) * PASSO) * Math.PI) / 180;
  return { x: Math.round(Math.cos(angulo) * RAIO), y: Math.round(Math.sin(angulo) * RAIO) };
}

/**
 * AÇÕES RÁPIDAS (⚡) — decisão 353: lista vertical no estilo do Mais opções do Portal (ícone + rótulo),
 * na ordem `antes` → "N documentos abertos" → `depois`. Escolher um item fecha o menu e devolve o foco ao ⚡.
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
      <DropdownP.Portal>
        <DropdownP.Content side="bottom" align="end" sideOffset={6} loop className={estilos.menuPortal}
          aria-label="Ações rápidas" data-testid={`${prefixoTestid}-acoes-rapidas-leque`}
          onCloseAutoFocus={(e) => { if (escolheu.current) { escolheu.current = false; e.preventDefault(); } }}>
          {itens.map((it) => (
            <DropdownP.Item key={it.chave} asChild disabled={it.desabilitado}
              onSelect={() => { escolheu.current = true; botao.current?.focus(); it.onSelect(); }}>
              <button type="button" className={cn(estilos.menuItem, it.perigo && estilos.menuItemPerigo)}
                aria-label={it.rotulo} data-testid={it.testId} disabled={it.desabilitado}>
                {it.numero !== undefined
                  ? <span className={estilos.menuNumero} data-testid={`${prefixoTestid}-documentos-contador`}>{it.numero}</span>
                  : it.icone ? <span className={estilos.menuIcone} aria-hidden>{it.icone}</span> : null}
                <span className={estilos.menuRotulo}>{it.rotulo}</span>
              </button>
            </DropdownP.Item>
          ))}
        </DropdownP.Content>
      </DropdownP.Portal>
    </DropdownP.Root>
    {documentos && <ListaDeDocumentosAbertos prefixoTestid={prefixoTestid} fonte={documentosAbertos} aberta={listaAberta} onFechar={fecharLista} ancora={ancora} botao={botao} documentos={documentos} />}
  </span>;
}
