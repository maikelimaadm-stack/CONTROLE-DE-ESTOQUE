"use client";
import * as React from "react";
import { useAuth } from "@/lib/auth";
import { AcoesRapidas } from "@/features/central/acoes-rapidas";
import {
  BotaoDaBarra, ConjuntoDaBarra, ConjuntoDireito, IconeAlterarOperacao, IconeConfirmar, IconeDescartar, IconeHistorico, IconeImprimir,
  IconeSalvar, PendenciasDoDocumento, PilulaDaBarra, PosicaoDoRotulo, type ItemRapido, type Pendencia, type PosicaoDoRotuloValor
} from "@/features/central/barra";
import { DialogoDescartar } from "@/features/central/dialogos";
import { PREFIXO_CENTRAL_ESTOQUE, fonteDosDocumentosDeEstoque } from "./adaptador";
import type { EstadoDaCriacaoDeEstoque, TravaDoSalvar } from "./estado-criacao";

/**
 * BARRA DA CRIAÇÃO DA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282) — o modelo das Centrais de Vendas e de Compras.
 *
 * Esquerda: [Descartar alterações ✕] [Salvar] [Confirmar <espécie> (quem pode confirmar)].
 * Direita: [N pendências] [Posição do rótulo] [Ações rápidas: Alterar operação, Imprimir, Histórico].
 *
 * O que cada botão FAZ mora no estado (`useEstadoDaCriacaoDeEstoque`): aqui nada chama a API. Clicar com pendência =
 * zero POST e a pílula abre. O Salvar fica DESABILITADO por estado (`travaDoSalvar`), com a dica do motivo; o rótulo
 * ("Salvar" ou "Salvar e confirmar") vem das regras gerais que o servidor declarou. O `estoque-salvar` de antes continua
 * no Salvar, e o `estoque-alterar-operacao` no item do leque.
 */

const PREFIXO = PREFIXO_CENTRAL_ESTOQUE;

/** A dica do Salvar desabilitado POR ESTADO. null = habilitado. */
export function dicaDaTravaDoSalvar(trava: TravaDoSalvar): string | null {
  switch (trava) {
    case null: return null;
    case "salvando": return "Salvando…";
    case "top-nao-confirmada": return "A operação ainda não foi confirmada pelo servidor";
    case "layout-carregando": return "Carregando o layout…";
    case "layout-falhou": return "Layout não carregado";
    case "regras-carregando": return "Carregando as regras da operação…";
    case "regras-falharam": return "As regras da operação não carregaram";
    case "origem-carregando": return "Carregando o documento de origem…";
  }
}

/** Leva ao campo da pendência: itens → a linha da grade; cabeçalho → o controle do campo (`data-campo` ou `name`). */
export function irParaPendenciaDoEstoque(p: Pendencia): void {
  const central = document.querySelector<HTMLElement>(`[data-testid="${PREFIXO}"]`) ?? document.body;
  const controle = (raiz: Element | null | undefined) =>
    raiz?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") ?? null;
  const focar = (el: HTMLElement | null) => { if (!el) return; el.scrollIntoView({ block: "nearest" }); el.focus(); };
  if (p.caminho.startsWith("itens")) {
    const regiao = central.querySelector<HTMLElement>(`[data-testid="${PREFIXO}-itens"]`);
    const i = /^itens(?:\.(\d+)|\[(\d+)\])/.exec(p.caminho);
    const n = i ? Number(i[1] ?? i[2]) : null;
    const linha = n === null ? null : central.querySelectorAll(`[data-testid="${PREFIXO}-linha"]`)[n];
    focar(controle(linha) ?? controle(regiao) ?? regiao);
    return;
  }
  const campo = central.querySelector<HTMLElement>(`[data-campo="${CSS.escape(p.caminho)}"], [name="${CSS.escape(p.caminho)}"]`);
  focar(campo && campo.matches("input, select, textarea, button") ? campo : controle(campo) ?? campo);
}

export interface PropsDaBarraDaCriacao {
  e: EstadoDaCriacaoDeEstoque;
  densidade: PosicaoDoRotuloValor;
  onDensidade: (v: PosicaoDoRotuloValor) => void;
  /** Ir à pendência (a página abre a aba do painel antes); padrão `irParaPendenciaDoEstoque`. */
  onIr?: (p: Pendencia) => void;
}

/** A barra pronta para a moldura do motor: `acoes` (esquerda), `direita` e os `dialogos` (Descartar). */
export function useBarraDaCriacao({ e, densidade, onDensidade, onIr = irParaPendenciaDoEstoque }: PropsDaBarraDaCriacao): {
  acoes: React.ReactNode; direita: React.ReactNode; dialogos: React.ReactNode;
} {
  const { can } = useAuth();
  const [perguntaDescartar, setPerguntaDescartar] = React.useState(false);
  /* A pílula só aparece depois de um clique em Salvar que não enviou nada (como na venda e na compra). */
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
  const rotuloConfirmar = `Confirmar ${e.rotuloDaEspecie.toLowerCase()}`;

  /* O leque da criação: Alterar operação, Imprimir e Histórico desabilitados (ainda não há documento). */
  const rapidas: ItemRapido[] = [
    { chave: "alterar", rotulo: "Alterar operação", testId: "estoque-alterar-operacao", icone: <IconeAlterarOperacao />, onSelect: e.alterarOperacao },
    { chave: "imprimir", rotulo: "Imprimir", testId: `${PREFIXO}-imprimir`, icone: <IconeImprimir />, desabilitado: true, onSelect: () => undefined },
    ...(can("audit_logs.view") ? [{ chave: "historico", rotulo: "Histórico de alterações", testId: `${PREFIXO}-historico`, icone: <IconeHistorico />, desabilitado: true, onSelect: () => undefined }] : [])
  ];

  const acoes = <ConjuntoDaBarra>
    <BotaoDaBarra rotulo="Descartar alterações" disabled={!e.alterado || e.salvando} data-testid={`${PREFIXO}-descartar`}
      onClick={() => setPerguntaDescartar(true)}><IconeDescartar /></BotaoDaBarra>
    <BotaoDaBarra rotulo={e.rotuloDoSalvar} dica={dicaTrava ?? e.rotuloDoSalvar} ocupado={e.salvando} disabled={e.salvarDesabilitado}
      data-testid="estoque-salvar" onClick={() => clicarSalvar(false)}><IconeSalvar /></BotaoDaBarra>
    {e.podeConfirmarNaCriacao && <PilulaDaBarra icone={<IconeConfirmar />} dica={dicaTrava ?? rotuloConfirmar} disabled={e.salvarDesabilitado}
      data-testid={`${PREFIXO}-confirmar`} onClick={() => clicarSalvar(true)}>{rotuloConfirmar}</PilulaDaBarra>}
  </ConjuntoDaBarra>;

  const direita = <ConjuntoDireito>
    {tentou && <PendenciasDoDocumento prefixoTestid={PREFIXO} pendencias={e.pendencias} aberta={e.pendenciasAbertas} onAbertaChange={e.setPendenciasAbertas} onIr={onIr} />}
    <PosicaoDoRotulo prefixoTestid={PREFIXO} valor={densidade} onChange={onDensidade} />
    <AcoesRapidas prefixoTestid={PREFIXO} documentosAbertos={fonteDosDocumentosDeEstoque} antes={rapidas} desabilitado={e.salvando} />
  </ConjuntoDireito>;

  const dialogos = <DialogoDescartar aberto={perguntaDescartar} onFechar={() => setPerguntaDescartar(false)} onDescartar={descartar} />;
  return { acoes, direita, dialogos };
}
