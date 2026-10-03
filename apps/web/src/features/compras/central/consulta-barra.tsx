"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { MSG_PEDIDO_PRECISA_FINALIZAR_PARA_RECEBER } from "@agro/domain";
import { useAuth } from "@/lib/auth";
import { todayISO } from "@/lib/utils";
import { useWorkspaceTabs } from "@/lib/workspace-tabs";
import { ConfirmDialog, Menu } from "@/components/ui";
import { HistoryDialog } from "@/features/base1/history-dialog";
import { DialogoEncerrarSaldo } from "@/features/sales/faturar-em-partes";
import type { ItemRow, Row } from "@/features/docs/shared";
import { AcoesRapidas } from "@/features/central/acoes-rapidas";
import { NovoDocumento } from "@/features/central/novo-documento";
import { DialogoCancelarDocumento } from "@/features/central/dialogos";
import { entregarCopia, montarCopia } from "@/features/central/duplicar-memoria";
import {
  BotaoDaBarra, ConjuntoDaBarra, ConjuntoDireito, IconeCancelarDocumento, IconeConfirmar, IconeConverter, IconeDuplicar, IconeEncerrarSaldo,
  IconeHistorico, IconeImprimir, IconeNovo, IconeRaio, IndicadorConfirmando, IndicadorSalvo, PilulaDaBarra, PosicaoDoRotulo, type ItemRapido,
  type PosicaoDoRotuloValor
} from "@/features/central/barra";
import { TEXTO_SEM_PROXIMA_OPERACAO, rotaDeReceber, type EstadoProximosPassosDoPedido } from "../proximos-passos-pedido";
import {
  ENTIDADE_DO_HISTORICO_DE_COMPRA, MOTIVO_VAZIO_DA_COMPRA, PREFIXO_CENTRAL_COMPRAS, chaveDaCopiaDeCompra, fonteDoNovoDocumentoDeCompra,
  fonteDosDocumentosDeCompras, rotaDaNovaCompra
} from "./adaptador";
import type { Cabecalho, CopiaDeCompra, EstadoDaConsulta, OpcaoDeNovoOrcamento } from "./estado";
import { DialogoAprovarParaOrcamento, DialogoFinalizarPedido } from "./dialogos-pedido";

/**
 * BARRA DA CONSULTA DA CENTRAL DE COMPRAS (VISUAL-UX-04, decisão 276) — o modelo da venda, sobre o motor.
 *
 * Esquerda: [Novo documento +] [Duplicar documento] [pílula]. Direita: [Salvo | Confirmando…] [Posição do rótulo] [Ações rápidas].
 *   - Compra: pílula "Confirmar compra" (abre o diálogo da prévia — `e.setConfirmando(true)`); visível e DESABILITADA
 *     quando a compra não está aberta (confirmada, cancelada). O handler confere a MESMA regra (`e.podeConfirmar`, a do
 *     motor): `disabled` é apresentação.
 *   - Pedido: pílula "Receber…" pelos Próximos passos (um passo → a Central em modo receber; vários → menu; nenhum,
 *     indisponível ou pedido fechado → desabilitada com a dica), e "Encerrar saldo" (motivo obrigatório).
 * Os estados dos Próximos passos ficam VISÍVEIS com os testids de hoje (`compras-proximos-passos[data-situacao]`,
 * `-indisponivel`, `-vazio`, `-erro`).
 *   - Pedido com a capacidade da F6 (OPERACOES-01 F6b, decisão 283; sem ela, a barra de hoje): "Finalizar" (com a
 *     prévia do servidor), "Aprovar para orçamento" e "Novo orçamento" (pelo leque de TOPs de orçamento do pedido); o
 *     "Receber…" também no pedido FINALIZADO, e desabilitado no aberto cuja TOP exige o pedido finalizado.
 *
 * Nada aqui chama a API de escrita: confirmar, cancelar e encerrar moram no estado (`useEstadoDaConsulta`).
 * Duplicar entrega a cópia em memória (nada na URL além da TOP, nada em storage) e abre a criação.
 */

export const PREFIXO = PREFIXO_CENTRAL_COMPRAS;

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Os campos do cabeçalho que a cópia LEVA. Número, nota, série, datas, lote, validade, origem, títulos e situação, não. */
const CAMPOS_COPIADOS = [
  "empresa_id", "fornecedor_id", "transportadora_id", "categoria_financeira_id", "centro_custo_id", "condicao_pagamento_id",
  "forma_pagamento_id", "frete", "outras_despesas", "desconto", "observacao"
] as const satisfies readonly (keyof Cabecalho)[];

/**
 * A cópia de um documento de compra a partir do GET do detalhe. `null` sem TOP. A Data volta a hoje (a criação já
 * põe hoje); vencimento fica vazio (ou pela condição, que a criação recalcula); o plano não vai (recalculado).
 */
export function copiaDaCompra(d: Row, segmento: string, tipoOperacaoId: string): CopiaDeCompra | null {
  if (!tipoOperacaoId) return null;
  const cabecalho: Partial<Cabecalho> = { data_documento: todayISO() };
  for (const c of CAMPOS_COPIADOS) if (d[c] !== undefined && d[c] !== null) cabecalho[c] = texto(d[c]);
  const itens = (Array.isArray(d["itens"]) ? (d["itens"] as Row[]) : []).map((it): ItemRow => {
    const linha: ItemRow = { product_id: texto(it["produto_id"]), quantity: texto(it["quantidade"]) };
    if (texto(it["armazem_id"])) linha.warehouse_id = texto(it["armazem_id"]);
    if (texto(it["valor_unitario"])) linha.unit_value = texto(it["valor_unitario"]);
    if (texto(it["desconto"])) linha.discount = texto(it["desconto"]);
    if (texto(it["desconto_percentual"])) linha.discount_percent = texto(it["desconto_percentual"]);
    return linha;
  }).filter((l) => l.product_id !== "");
  return montarCopia<Partial<Cabecalho>>(segmento, tipoOperacaoId, cabecalho, itens, null);
}

/**
 * A dica da pílula "Receber…" desabilitada — null quando há o que receber. Fora de aberto/finalizado, com a capacidade da
 * F6 o texto diz as duas situações; sem ela, o texto de hoje. O ABERTO cuja TOP exige o pedido finalizado: a mensagem do
 * servidor (o `/convert` recusaria com ela).
 */
function dicaDoReceber(e: EstadoDaConsulta): string | null {
  if (!e.pedidoEmAndamento) return e.capacidade === "sim" ? "Só pedido aberto ou finalizado é recebido" : "Só pedido aberto é recebido";
  if (!e.podeReceber) return "Sem permissão para receber este pedido";
  const p = e.passos;
  switch (p.situacao) {
    case "carregando": return "Carregando os próximos passos…";
    case "indisponivel": return "Próximos passos indisponíveis nesta versão do servidor";
    case "erro": return p.mensagem;
    case "pronto":
      if (!p.itens.some((x) => rotaDeReceber(x, e.id))) return TEXTO_SEM_PROXIMA_OPERACAO;
      return p.exigeFinalizar && e.situacao === "aberto" ? MSG_PEDIDO_PRECISA_FINALIZAR_PARA_RECEBER : null;
  }
}

/** Os estados dos Próximos passos, VISÍVEIS ao lado da pílula (os testids de hoje). */
function SituacaoDosProximosPassos({ estado, children }: { estado: EstadoProximosPassosDoPedido; children: React.ReactNode }) {
  return <span data-testid="compras-proximos-passos" data-situacao={estado.situacao} className="inline-flex items-center gap-2">
    {children}
    {estado.situacao === "indisponivel" && <span data-testid="compras-proximos-passos-indisponivel" className="text-[12px] text-amber-700">
      A lista de próximos passos está indisponível nesta versão do servidor. O pedido continua disponível para consulta.
    </span>}
    {estado.situacao === "erro" && <span data-testid="compras-proximos-passos-erro" className="text-[12px] text-red-700">{estado.mensagem}</span>}
    {estado.situacao === "pronto" && estado.itens.length === 0 && <span data-testid="compras-proximos-passos-vazio" className="text-[12px] text-slate-500">{TEXTO_SEM_PROXIMA_OPERACAO}</span>}
  </span>;
}

const rotuloDoPasso = (x: { codigo: string; nome: string; emPartes: boolean }) => `Receber em ${x.codigo} — ${x.nome}${x.emPartes ? " (em partes)" : ""}`;
const rotuloDoOrcamento = (o: OpcaoDeNovoOrcamento) => `Orçamento em ${o.top.codigo} — ${o.top.nome}`;

export interface PropsDaBarraDaConsulta {
  e: EstadoDaConsulta;
  /** Rótulo da espécie (ex.: "Compra", "Pedido de compra"). */
  rotulo: string;
  densidade: PosicaoDoRotuloValor;
  onDensidade: (v: PosicaoDoRotuloValor) => void;
  /** "Salvo ✓" visível agora (a página controla os 2,4 s). */
  salvoVisivel: boolean;
}

/**
 * A barra pronta para a moldura do motor: `acoes` (esquerda), `direita` e os `dialogos` (Cancelar, Encerrar saldo,
 * Histórico, Duplicar sobre rascunho e, no pedido com a capacidade da F6, Finalizar e Aprovar para orçamento).
 */
export function useBarraDaConsulta({ e, rotulo, densidade, onDensidade, salvoVisivel }: PropsDaBarraDaConsulta): {
  acoes: React.ReactNode; direita: React.ReactNode; dialogos: React.ReactNode;
} {
  const { can } = useAuth();
  const router = useRouter();
  const ws = useWorkspaceTabs();
  const [historico, setHistorico] = React.useState(false);
  const [perguntaDuplicar, setPerguntaDuplicar] = React.useState(false);
  const { variante, documento: d, id } = e;
  const codigo = d ? texto(d["codigo"]) : "";
  const especie = rotulo.toLowerCase();
  const fonteNovo = React.useMemo(() => fonteDoNovoDocumentoDeCompra(variante, rotulo), [variante, rotulo]);
  const podeCriar = can(`${variante.perm}.create`);

  /* DUPLICAR — entrega em memória e abre a criação com a MESMA TOP. Rascunho alterado da espécie: pergunta antes. */
  const chaveDaCriacao = `/compras/${variante.segmento}/new`;
  const abrirCopia = () => {
    setPerguntaDuplicar(false);
    if (!d) return;
    const copia = copiaDaCompra(d, variante.segmento, e.tipoOperacaoId);
    if (!copia) return;
    entregarCopia(chaveDaCopiaDeCompra, copia);
    router.push(rotaDaNovaCompra(variante.segmento, copia.tipoOperacaoId));
  };
  const duplicar = () => {
    if (!e.podeDuplicar) return;
    if (ws?.dirty.has(chaveDaCriacao)) { setPerguntaDuplicar(true); return; }
    abrirCopia();
  };

  /* RECEBER — pelos Próximos passos do pedido. */
  const dicaReceber = e.ehPedido ? dicaDoReceber(e) : null;
  const passosComRota = e.passos.situacao === "pronto"
    ? e.passos.itens.flatMap((x) => { const rota = rotaDeReceber(x, e.id); return rota ? [{ x, rota }] : []; })
    : [];
  const unico = passosComRota.length === 1 ? passosComRota[0] : undefined;
  const pilulaReceber = (() => {
    if (dicaReceber !== null || passosComRota.length === 0) {
      return <PilulaDaBarra icone={<IconeConverter />} dica={dicaReceber ?? TEXTO_SEM_PROXIMA_OPERACAO} disabled data-testid={`${PREFIXO}-receber`}>Receber…</PilulaDaBarra>;
    }
    if (unico) {
      return <PilulaDaBarra icone={<IconeConverter />} dica={rotuloDoPasso(unico.x)} data-testid={`compras-proximo-passo-${unico.x.codigo}`}
        data-top-id={unico.x.tipoOperacaoId} data-em-partes={String(unico.x.emPartes)} onClick={() => router.push(unico.rota)}>Receber…</PilulaDaBarra>;
    }
    return <Menu trigger={<PilulaDaBarra icone={<IconeConverter />} dica="Escolher o próximo passo" data-testid={`${PREFIXO}-receber`}>Receber…</PilulaDaBarra>}
      items={passosComRota.map(({ x, rota }) => ({ label: rotuloDoPasso(x), onClick: () => router.push(rota) }))} />;
  })();

  /* NOVO ORÇAMENTO (F6b) — uma TOP no leque: a pílula leva direto à criação; várias: o menu; senão, desabilitada com a
     dica. O handler confere a MESMA regra do `disabled`. */
  const { novoOrcamento } = e;
  const abrirOrcamento = (o: OpcaoDeNovoOrcamento) => { if (novoOrcamento.dicaDesabilitada === null) router.push(o.rota); };
  const pilulaNovoOrcamento = (() => {
    if (!novoOrcamento.visivel) return null;
    const [unicaTop] = novoOrcamento.opcoes;
    if (novoOrcamento.dicaDesabilitada !== null || !unicaTop) {
      return <PilulaDaBarra icone={<IconeNovo />} dica={novoOrcamento.dicaDesabilitada ?? "Novo orçamento"} disabled data-testid="compras-novo-orcamento">Novo orçamento</PilulaDaBarra>;
    }
    if (novoOrcamento.opcoes.length === 1) {
      return <PilulaDaBarra icone={<IconeNovo />} dica={rotuloDoOrcamento(unicaTop)} data-testid="compras-novo-orcamento" data-top-id={unicaTop.top.tipoOperacaoId}
        onClick={() => abrirOrcamento(unicaTop)}>Novo orçamento</PilulaDaBarra>;
    }
    return <Menu trigger={<PilulaDaBarra icone={<IconeNovo />} dica="Escolher a operação de orçamento" data-testid="compras-novo-orcamento">Novo orçamento</PilulaDaBarra>}
      items={novoOrcamento.opcoes.map((o) => ({ label: rotuloDoOrcamento(o), onClick: () => abrirOrcamento(o) }))} />;
  })();

  const acoes = <ConjuntoDaBarra>
    {podeCriar && <NovoDocumento prefixoTestid={PREFIXO} fonte={fonteNovo} />}
    {podeCriar && <BotaoDaBarra rotulo="Duplicar documento" dica={e.dicaDuplicarDesabilitado ?? "Duplicar documento"} disabled={!e.podeDuplicar}
      data-testid={`${PREFIXO}-duplicar`} onClick={duplicar}><IconeDuplicar /></BotaoDaBarra>}
    {e.ehCompra && can("compras.edit") && <PilulaDaBarra icone={<IconeConfirmar />} dica="Confirmar compra" disabled={!e.podeConfirmar || e.confirmarOcupado}
      data-testid="compras-confirmar" onClick={() => { if (e.podeConfirmar) e.setConfirmando(true); }}>Confirmar compra</PilulaDaBarra>}
    {e.ehPedido && (e.podeReceber || !e.pedidoEmAndamento)
      && (e.podeReceber ? <SituacaoDosProximosPassos estado={e.passos}>{pilulaReceber}</SituacaoDosProximosPassos> : pilulaReceber)}
    {e.podeEncerrarSaldo && <PilulaDaBarra icone={<IconeEncerrarSaldo />} dica="Encerrar o saldo a receber" data-testid="compras-encerrar-saldo"
      onClick={() => e.setEncerrando(true)}>Encerrar saldo</PilulaDaBarra>}
    {e.finalizar.visivel && <PilulaDaBarra icone={<IconeConfirmar />} dica={e.finalizar.dicaDesabilitada ?? "Finalizar o pedido de compra"}
      disabled={e.finalizar.dicaDesabilitada !== null} ocupado={e.finalizar.ocupado} data-testid="compras-finalizar" onClick={e.finalizar.abrir}>Finalizar</PilulaDaBarra>}
    {e.aprovarParaOrcamento.visivel && <PilulaDaBarra icone={<IconeRaio />} dica="Aprovar o pedido para orçamento" ocupado={e.aprovarParaOrcamento.ocupado}
      data-testid="compras-aprovar-para-orcamento" onClick={e.aprovarParaOrcamento.abrir}>Aprovar para orçamento</PilulaDaBarra>}
    {pilulaNovoOrcamento}
  </ConjuntoDaBarra>;

  /* O LEQUE: Imprimir, Histórico, N documentos abertos, Cancelar <espécie>… (vermelho). Sem Anexos. */
  const antes: ItemRapido[] = [
    { chave: "imprimir", rotulo: "Imprimir", testId: `${PREFIXO}-imprimir`, icone: <IconeImprimir />, onSelect: () => window.print() },
    ...(e.podeVerHistorico ? [{ chave: "historico", rotulo: "Histórico de alterações", testId: `${PREFIXO}-historico`, icone: <IconeHistorico />, onSelect: () => setHistorico(true) }] : [])
  ];
  const depois: ItemRapido[] = e.podeCancelar ? [{
    chave: "cancelar", rotulo: e.dicaCancelarDesabilitado ?? `Cancelar ${especie}…`, testId: "compras-cancelar", icone: <IconeCancelarDocumento />, perigo: true,
    desabilitado: e.dicaCancelarDesabilitado !== null || e.cancelarOcupado, onSelect: () => e.setCancelando(true)
  }] : [];

  const direita = <ConjuntoDireito>
    {e.confirmarOcupado ? <IndicadorConfirmando prefixoTestid={PREFIXO} /> : salvoVisivel ? <IndicadorSalvo prefixoTestid={PREFIXO} /> : null}
    <PosicaoDoRotulo prefixoTestid={PREFIXO} valor={densidade} onChange={onDensidade} />
    <AcoesRapidas prefixoTestid={PREFIXO} documentosAbertos={fonteDosDocumentosDeCompras} antes={antes} depois={depois} />
  </ConjuntoDireito>;

  const dialogos = <>
    <DialogoCancelarDocumento prefixoTestid={PREFIXO} aberto={e.cancelando} onFechar={() => e.setCancelando(false)} especie={especie} codigo={codigo}
      texto={e.textoDoCancelamento} carregando={e.cancelarOcupado} motivoVazio={MOTIVO_VAZIO_DA_COMPRA} onCancelar={e.cancelar} />
    {e.ehPedido && <DialogoEncerrarSaldo open={e.encerrando} onOpenChange={e.setEncerrando} loading={e.encerrarOcupado} onConfirmar={e.encerrar}
      descricao="O saldo que falta receber deixa de poder ser recebido, e o pedido passa a convertido. As compras já geradas não mudam." />}
    {e.podeVerHistorico && <HistoryDialog open={historico} onOpenChange={setHistorico} entity={ENTIDADE_DO_HISTORICO_DE_COMPRA} entityId={id} title={e.titulo} />}
    <ConfirmDialog open={perguntaDuplicar} onOpenChange={setPerguntaDuplicar} title="Substituir o rascunho?"
      description={`Já há um lançamento de ${especie} com alterações não salvas. A cópia o substitui.`}
      confirmLabel="Duplicar mesmo assim" dismissLabel="Continuar editando" onConfirm={abrirCopia} />
    {e.finalizar.visivel && <DialogoFinalizarPedido id={id} aberto={e.finalizar.aberto} onFechar={e.finalizar.fechar} codigo={codigo}
      carregando={e.finalizar.ocupado} onFinalizar={e.finalizar.executar} />}
    {e.aprovarParaOrcamento.visivel && <DialogoAprovarParaOrcamento aberto={e.aprovarParaOrcamento.aberto} onFechar={e.aprovarParaOrcamento.fechar}
      codigo={codigo} carregando={e.aprovarParaOrcamento.ocupado} onAprovar={e.aprovarParaOrcamento.executar} />}
  </>;
  return { acoes, direita, dialogos };
}
