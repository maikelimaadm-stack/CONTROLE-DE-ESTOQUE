"use client";
import * as React from "react";
import { useAuth } from "@/lib/auth";
import { AcoesRapidas } from "@/features/central/acoes-rapidas";
import {
  BotaoDaBarra, ConjuntoDaBarra, ConjuntoDireito, IconeAlterarOperacao, IconeConfirmar, IconeDescartar, IconeHistorico, IconeImprimir,
  IconeSalvar, PendenciasDoDocumento, PilulaDaBarra, PosicaoDoRotulo, type ItemRapido, type Pendencia, type PosicaoDoRotuloValor
} from "@/features/central/barra";
import { DialogoDescartar } from "@/features/central/dialogos";
import { PREFIXO_CENTRAL_COMPRAS, fonteDosDocumentosDeCompras } from "./adaptador";
import type { EstadoDaCriacao, TravaDoSalvar } from "./estado";

/**
 * BARRA DA CRIAÇÃO DA CENTRAL DE COMPRAS (VISUAL-UX-04, decisão 276) — o mesmo modelo da venda, sobre o motor.
 *
 * Esquerda: [Descartar alterações ✕] [Salvar] [Confirmar compra (só compra, fora do receber)].
 * Direita: [N pendências] [Posição do rótulo] [Ações rápidas].
 *
 * O que cada botão FAZ mora no estado (`useEstadoDaCriacao`): aqui nada chama a API. As checagens do Salvar são as
 * do estado (obrigatórios do layout, exigências da TOP, itens); clicar com pendência = zero POST e a pílula abre.
 * O Salvar continua DESABILITADO por estado (`travaDoSalvar`), com a dica do motivo. O rótulo dele vem do estado
 * (`rotuloDoSalvar`, OPERACOES-01 F2): "Salvar e confirmar" com a TOP de Confirmação Automática, "Salvar" no resto.
 */

export const PREFIXO = PREFIXO_CENTRAL_COMPRAS;

/** A dica do Salvar desabilitado POR ESTADO. null = habilitado. */
export function dicaDaTravaDoSalvar(trava: TravaDoSalvar): string | null {
  switch (trava) {
    case null: return null;
    case "salvando": return "Salvando…";
    case "top-nao-confirmada": return "A operação ainda não foi confirmada pelo servidor";
    case "pedido-carregando": return "Carregando o pedido…";
    case "pedido-recusado": return "O pedido não pode ser recebido";
    case "layout-carregando": return "Carregando o layout…";
    case "layout-falhou": return "Layout não carregado";
    case "regras-carregando": return "Carregando as regras da operação…";
    case "regras-falharam": return "As regras da operação não carregaram";
    case "capacidade-carregando": return "Carregando…";
  }
}

/** Leva ao campo da pendência: itens → a linha da grade; cabeçalho → o primeiro controle com o nome do campo. */
export function irParaPendenciaDaCompra(p: Pendencia): void {
  const central = document.querySelector<HTMLElement>(`[data-testid="${PREFIXO}"]`) ?? document.body;
  const controle = (raiz: Element | null | undefined) =>
    raiz?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") ?? null;
  const focar = (el: HTMLElement | null) => { if (!el) return; el.scrollIntoView({ block: "nearest" }); el.focus(); };
  if (p.caminho.startsWith("itens") || p.caminho.startsWith("items")) {
    const regiao = central.querySelector<HTMLElement>(`[data-testid="${PREFIXO}-itens"]`);
    const i = /^ite[mn]s\[(\d+)\]/.exec(p.caminho)?.[1];
    const linha = i === undefined ? null : central.querySelectorAll(`[data-testid="${PREFIXO}-linha"]`)[Number(i)];
    focar(controle(linha) ?? controle(regiao) ?? regiao);
    return;
  }
  const campo = central.querySelector<HTMLElement>(`[data-campo="${CSS.escape(p.caminho)}"], [name="${CSS.escape(p.caminho)}"]`);
  focar(campo && campo.matches("input, select, textarea, button") ? campo : controle(campo) ?? campo);
}

export interface PropsDaBarraDaCriacao {
  e: EstadoDaCriacao;
  densidade: PosicaoDoRotuloValor;
  onDensidade: (v: PosicaoDoRotuloValor) => void;
  /** Ir à pendência; padrão `irParaPendenciaDaCompra`. */
  onIr?: (p: Pendencia) => void;
}

/** A barra pronta para a moldura do motor: `acoes` (esquerda), `direita` e os `dialogos` (Descartar). */
export function useBarraDaCriacao({ e, densidade, onDensidade, onIr = irParaPendenciaDaCompra }: PropsDaBarraDaCriacao): {
  acoes: React.ReactNode; direita: React.ReactNode; dialogos: React.ReactNode;
} {
  const { can } = useAuth();
  const [perguntaDescartar, setPerguntaDescartar] = React.useState(false);
  /* A pílula só aparece depois de um clique em Salvar que não enviou nada (como na venda). */
  const [tentou, setTentou] = React.useState(false);
  const temPendencia = e.pendencias.length > 0;
  const fecharPendencias = e.setPendenciasAbertas;
  React.useEffect(() => { if (!temPendencia) fecharPendencias(false); }, [temPendencia, fecharPendencias]);

  const dicaTrava = dicaDaTravaDoSalvar(e.travaDoSalvar);
  const clicarSalvar = (confirmar: boolean) => {
    if (e.salvarDesabilitado) return;
    setTentou(true);
    e.salvar(confirmar ? { confirmar: true } : undefined);
  };
  const descartar = () => { setPerguntaDescartar(false); setTentou(false); e.descartar(); };
  const podeConfirmar = e.podeConfirmarNaCriacao && can("compras.edit");
  const receber = e.modo === "receber";

  /* O leque da criação: Alterar operação (fora do receber), Imprimir e Histórico desabilitados (ainda não há documento). */
  const rapidas: ItemRapido[] = [
    ...(receber ? [] : [{ chave: "alterar", rotulo: "Alterar operação", testId: "top-alterar", icone: <IconeAlterarOperacao />, onSelect: e.alterarOperacao }]),
    { chave: "imprimir", rotulo: "Imprimir", testId: `${PREFIXO}-imprimir`, icone: <IconeImprimir />, desabilitado: true, onSelect: () => undefined },
    ...(can("audit_logs.view") ? [{ chave: "historico", rotulo: "Histórico de alterações", testId: `${PREFIXO}-historico`, icone: <IconeHistorico />, desabilitado: true, onSelect: () => undefined }] : [])
  ];

  const acoes = <ConjuntoDaBarra>
    <BotaoDaBarra rotulo="Descartar alterações" disabled={(!e.alterado && !receber) || e.salvando} data-testid={`${PREFIXO}-descartar`}
      onClick={() => setPerguntaDescartar(true)}><IconeDescartar /></BotaoDaBarra>
    <BotaoDaBarra rotulo={e.rotuloDoSalvar} dica={dicaTrava ?? e.rotuloDoSalvar} ocupado={e.salvando} disabled={e.salvarDesabilitado}
      data-testid="compras-salvar" onClick={() => clicarSalvar(false)}><IconeSalvar /></BotaoDaBarra>
    {podeConfirmar && <PilulaDaBarra icone={<IconeConfirmar />} dica={dicaTrava ?? "Confirmar compra"} disabled={e.salvarDesabilitado}
      data-testid={`${PREFIXO}-confirmar`} onClick={() => clicarSalvar(true)}>Confirmar compra</PilulaDaBarra>}
  </ConjuntoDaBarra>;

  const direita = <ConjuntoDireito>
    {tentou && <PendenciasDoDocumento prefixoTestid={PREFIXO} pendencias={e.pendencias} aberta={e.pendenciasAbertas} onAbertaChange={e.setPendenciasAbertas} onIr={onIr} />}
    <PosicaoDoRotulo prefixoTestid={PREFIXO} valor={densidade} onChange={onDensidade} />
    <AcoesRapidas prefixoTestid={PREFIXO} documentosAbertos={fonteDosDocumentosDeCompras} antes={rapidas} desabilitado={e.salvando} />
  </ConjuntoDireito>;

  const dialogos = <DialogoDescartar aberto={perguntaDescartar} onFechar={() => setPerguntaDescartar(false)} onDescartar={descartar} />;
  return { acoes, direita, dialogos };
}
