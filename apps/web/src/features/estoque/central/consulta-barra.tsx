"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CAMPOS_DESTINO_ESTOQUE, type EspecieEstoque } from "@agro/domain";
import { todayISO } from "@/lib/utils";
import { useWorkspaceTabs } from "@/lib/workspace-tabs";
import { ConfirmDialog } from "@/components/ui";
import { HistoryDialog } from "@/features/base1/history-dialog";
import type { ItemRow } from "@/features/docs/shared";
import { AcoesRapidas } from "@/features/central/acoes-rapidas";
import { NovoDocumento } from "@/features/central/novo-documento";
import { DialogoCancelarDocumento } from "@/features/central/dialogos";
import { entregarCopia, montarCopia } from "@/features/central/duplicar-memoria";
import {
  BotaoDaBarra, ConjuntoDaBarra, ConjuntoDireito, IconeCancelarDocumento, IconeConfirmar, IconeConverter, IconeDuplicar, IconeEncerrarSaldo,
  IconeHistorico, IconeImprimir, IndicadorConfirmando, IndicadorSalvo, PilulaDaBarra, PosicaoDoRotulo, type ItemRapido, type PosicaoDoRotuloValor
} from "@/features/central/barra";
import { rotaDeLancamentoDeEstoque } from "../movimentacoes-variantes";
import {
  ENTIDADE_DO_HISTORICO_DE_ESTOQUE, MOTIVO_VAZIO_DO_ESTOQUE, PREFIXO_CENTRAL_ESTOQUE, chaveDaCopiaDeEstoque, fonteDoNovoDocumentoDeEstoque, fonteDosDocumentosDeEstoque
} from "./adaptador";
import { formaDaEspecieNaCentral } from "./forma";
import { destinoDaOrigem } from "./origem";
import { DialogoEncerrarSaldo } from "./dialogos-estoque";
import type { CabecalhoDeEstoque, CopiaDeEstoque } from "./estado-criacao";
import type { DocumentoDeEstoque, EstadoDaConsultaDeEstoque } from "./estado-consulta";

/**
 * BARRA DA CONSULTA DA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282) — o modelo das Centrais de Vendas e de Compras.
 *
 * Esquerda: [Novo documento +] [Duplicar documento] [Confirmar <espécie>] e, quando cabem, [Atender requisição],
 * [Devolver itens] e [Encerrar saldo]. Direita: [Salvo | Confirmando…] [Posição do rótulo] [Ações rápidas: Imprimir,
 * Histórico, N documentos abertos, Cancelar <espécie>… (vermelho)].
 *
 * Nada aqui chama a API de escrita: confirmar, cancelar e encerrar moram no estado (`useEstadoDaConsultaDeEstoque`).
 * Atender e Devolver ABREM a criação da outra espécie com a origem (`?origem=<id>`; o lançador dela pergunta a TOP).
 * Duplicar entrega a cópia em memória (nada na URL além da TOP, nada em storage) e abre a criação com a MESMA TOP.
 * Os `estoque-confirmar` e `estoque-cancelar` de antes continuam na pílula e no item do leque.
 */

const PREFIXO = PREFIXO_CENTRAL_ESTOQUE;
const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/**
 * A cópia de um documento de estoque, a partir do GET do detalhe. `null` sem TOP. O cabeçalho leva a empresa, os locais,
 * a observação, o destino gravado (com os nomes) e o motivo e a justificativa da saída; a data volta a hoje. Os itens
 * levam o produto, a quantidade (ou a contada), o custo só na entrada, e o lote e a validade onde a espécie os tem.
 * Documento que atende ou devolve outro não chega aqui (o Duplicar fica desabilitado).
 */
export function copiaDoDocumentoDeEstoque(d: DocumentoDeEstoque, especie: EspecieEstoque, segmento: string, tipoOperacaoId: string): CopiaDeEstoque | null {
  if (!tipoOperacaoId) return null;
  const forma = formaDaEspecieNaCentral(especie, true);
  const valores: Partial<CabecalhoDeEstoque> = { empresa_id: d.empresa_id, armazem_id: d.armazem_id, data_documento: todayISO() };
  const rotulos: Record<string, string> = { armazem_id: texto(d.armazem_nome) };
  if (forma.localDeDestino && d.armazem_destino_id) { valores.armazem_destino_id = d.armazem_destino_id; rotulos["armazem_destino_id"] = texto(d.armazem_destino_nome); }
  if (d.observacao) valores.observacao = d.observacao;
  if (forma.destinoInformado) {
    const destino = destinoDaOrigem(d);
    for (const c of CAMPOS_DESTINO_ESTOQUE) {
      const v = destino[c.coluna];
      if (v) { valores[c.coluna] = v.id; rotulos[c.coluna] = v.nome; }
    }
  }
  if (forma.motivoDaSaida && d.motivo_saida) { valores.motivo_saida = d.motivo_saida; valores.justificativa = texto(d.justificativa); }
  const itens = d.itens.map((it): ItemRow => {
    const linha: ItemRow = {
      product_id: texto(it["produto_id"]), quantity: texto(especie === "ajuste" ? it["quantidade_contada"] : it["quantidade"]),
      unit_value: especie === "entrada" ? texto(it["custo_unitario"]) : "", generate_stock: true, warehouse_id: d.armazem_id
    };
    if (forma.lote && texto(it["lote"])) linha.provider_lot = texto(it["lote"]);
    if (forma.validade && texto(it["validade"])) linha.expiration_date = texto(it["validade"]).slice(0, 10);
    return linha;
  }).filter((l) => l.product_id !== "");
  return montarCopia<CopiaDeEstoque["cabecalho"]>(segmento, tipoOperacaoId, { valores, rotulos }, itens, null);
}

export interface PropsDaBarraDaConsulta {
  e: EstadoDaConsultaDeEstoque;
  densidade: PosicaoDoRotuloValor;
  onDensidade: (v: PosicaoDoRotuloValor) => void;
  /** "Salvo ✓" visível agora (a página controla os 2,4 s). */
  salvoVisivel: boolean;
}

/** A barra pronta para a moldura do motor: `acoes` (esquerda), `direita` e os `dialogos` (Cancelar, Encerrar saldo, Histórico, Duplicar sobre rascunho). */
export function useBarraDaConsulta({ e, densidade, onDensidade, salvoVisivel }: PropsDaBarraDaConsulta): {
  acoes: React.ReactNode; direita: React.ReactNode; dialogos: React.ReactNode;
} {
  const router = useRouter();
  const ws = useWorkspaceTabs();
  const [historico, setHistorico] = React.useState(false);
  const [perguntaDuplicar, setPerguntaDuplicar] = React.useState(false);
  const { variante, documento: d, id } = e;
  const codigo = d ? d.codigo : "";
  const especieMinuscula = e.rotuloDaEspecie.toLowerCase();
  const fonteNovo = React.useMemo(() => fonteDoNovoDocumentoDeEstoque(variante, e.rotuloDaEspecie), [variante, e.rotuloDaEspecie]);

  /* DUPLICAR — entrega em memória e abre a criação com a MESMA TOP. Rascunho alterado da espécie: pergunta antes. */
  const chaveDaCriacao = `/estoque/movimentacoes/${variante.segmento}/new`;
  const abrirCopia = () => {
    setPerguntaDuplicar(false);
    if (!d) return;
    const copia = copiaDoDocumentoDeEstoque(d, e.especie, variante.segmento, e.tipoOperacaoId);
    if (!copia) return;
    entregarCopia(chaveDaCopiaDeEstoque, copia);
    router.push(rotaDeLancamentoDeEstoque({ segmento: variante.segmento, id: copia.tipoOperacaoId }));
  };
  const duplicar = () => {
    if (!e.podeDuplicar) return;
    if (ws?.dirty.has(chaveDaCriacao)) { setPerguntaDuplicar(true); return; }
    abrirCopia();
  };
  const rotuloConfirmar = `Confirmar ${especieMinuscula}`;

  const acoes = <ConjuntoDaBarra>
    {e.podeCriar && <NovoDocumento prefixoTestid={PREFIXO} fonte={fonteNovo} />}
    {e.podeCriar && <BotaoDaBarra rotulo="Duplicar documento" dica={e.dicaDuplicarDesabilitado ?? "Duplicar documento"} disabled={!e.podeDuplicar}
      data-testid={`${PREFIXO}-duplicar`} onClick={duplicar}><IconeDuplicar /></BotaoDaBarra>}
    {e.mostrarConfirmar && <PilulaDaBarra icone={<IconeConfirmar />} dica={rotuloConfirmar} disabled={!e.podeConfirmar || e.confirmarOcupado}
      data-testid="estoque-confirmar" onClick={() => { if (e.podeConfirmar) e.setConfirmando(true); }}>{rotuloConfirmar}</PilulaDaBarra>}
    {e.rotaDeAtender && <PilulaDaBarra icone={<IconeConverter />} dica="Lançar o consumo desta requisição" data-testid="estoque-atender"
      onClick={() => { if (e.rotaDeAtender) router.push(e.rotaDeAtender); }}>Atender requisição</PilulaDaBarra>}
    {e.rotaDeDevolver && <PilulaDaBarra icone={<IconeConverter />} dica="Lançar a devolução deste consumo" data-testid="estoque-devolver"
      onClick={() => { if (e.rotaDeDevolver) router.push(e.rotaDeDevolver); }}>Devolver itens</PilulaDaBarra>}
    {e.podeEncerrarSaldo && <BotaoDaBarra rotulo="Encerrar saldo" dica="Encerrar o saldo da requisição" data-testid="estoque-encerrar-saldo"
      disabled={e.encerrarOcupado} onClick={() => e.setEncerrando(true)}><IconeEncerrarSaldo /></BotaoDaBarra>}
  </ConjuntoDaBarra>;

  /* O LEQUE: Imprimir, Histórico, N documentos abertos, Cancelar <espécie>… (vermelho). */
  const antes: ItemRapido[] = [
    { chave: "imprimir", rotulo: "Imprimir", testId: `${PREFIXO}-imprimir`, icone: <IconeImprimir />, onSelect: () => window.print() },
    ...(e.podeVerHistorico ? [{ chave: "historico", rotulo: "Histórico de alterações", testId: `${PREFIXO}-historico`, icone: <IconeHistorico />, onSelect: () => setHistorico(true) }] : [])
  ];
  const depois: ItemRapido[] = e.podeCancelar ? [{
    chave: "cancelar", rotulo: `Cancelar ${especieMinuscula}…`, testId: "estoque-cancelar", icone: <IconeCancelarDocumento />, perigo: true,
    desabilitado: e.cancelarOcupado, onSelect: () => e.setCancelando(true)
  }] : [];

  const direita = <ConjuntoDireito>
    {e.confirmarOcupado ? <IndicadorConfirmando prefixoTestid={PREFIXO} /> : salvoVisivel ? <IndicadorSalvo prefixoTestid={PREFIXO} /> : null}
    <PosicaoDoRotulo prefixoTestid={PREFIXO} valor={densidade} onChange={onDensidade} />
    <AcoesRapidas prefixoTestid={PREFIXO} documentosAbertos={fonteDosDocumentosDeEstoque} antes={antes} depois={depois} />
  </ConjuntoDireito>;

  const dialogos = <>
    <DialogoCancelarDocumento prefixoTestid={PREFIXO} aberto={e.cancelando} onFechar={() => e.setCancelando(false)} especie={especieMinuscula} codigo={codigo}
      texto={e.textoDoCancelamento} carregando={e.cancelarOcupado} motivoVazio={MOTIVO_VAZIO_DO_ESTOQUE} onCancelar={e.cancelar} />
    {e.especie === "requisicao" && <DialogoEncerrarSaldo aberto={e.encerrando} onAberto={e.setEncerrando} ocupado={e.encerrarOcupado} onEncerrar={e.encerrar} />}
    {e.podeVerHistorico && <HistoryDialog open={historico} onOpenChange={setHistorico} entity={ENTIDADE_DO_HISTORICO_DE_ESTOQUE} entityId={id} title={e.titulo} />}
    <ConfirmDialog open={perguntaDuplicar} onOpenChange={setPerguntaDuplicar} title="Substituir o rascunho?"
      description={`Já há um lançamento de ${especieMinuscula} com alterações não salvas. A cópia o substitui.`}
      confirmLabel="Duplicar mesmo assim" dismissLabel="Continuar editando" onConfirm={abrirCopia} />
  </>;
  return { acoes, direita, dialogos };
}
