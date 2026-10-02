"use client";
import * as React from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { MSG_ORCAMENTO_NAO_ABERTO } from "@agro/domain";
import { useTradutor } from "@/lib/i18n";
import { useTabTitle } from "@/lib/workspace-tabs";
import { brl, dateBR } from "@/lib/utils";
import { StatusBadge, statusTone } from "@/components/ui";
import { LoadingOr, type Row } from "@/features/docs/shared";
import { HistoryDialog } from "@/features/base1/history-dialog";
import { CentralDeDocumento } from "@/features/central/moldura";
import { TEMPO_DO_SALVO_MS } from "@/features/central/salvo";
import { CampoLeitura, ColunaDeCampos, DadosAdicionais } from "@/features/central/campo";
import { ItensSalvos } from "@/features/central/itens-salvos";
import { PainelColuna, PainelLargo } from "@/features/central/painel";
import { AcoesRapidas } from "@/features/central/acoes-rapidas";
import {
  ConjuntoDaBarra, ConjuntoDireito, IconeCancelarDocumento, IconeHistorico, IconeImprimir, IndicadorSalvo, PilulaDaBarra, PosicaoDoRotulo,
  type ItemRapido, type PosicaoDoRotuloValor
} from "@/features/central/barra";
import { DialogoCancelarDocumento } from "@/features/central/dialogos";
import type { AbaDoPainel, ColunasDosItens } from "@/features/central/contrato";
import { varianteDeCompra, type VarianteDeCompra } from "../variantes";
import {
  ENTIDADE_DO_HISTORICO_DE_COMPRA, MOTIVO_VAZIO_DA_COMPRA, PREFIXO_CENTRAL_COMPRAS, colunasDosItensDeCompras, fonteDosDocumentosDeCompras
} from "../central/adaptador";
import { itemParaOMotor } from "../central/consulta-corpo";
import { CentralDoOrcamento } from "./central-orcamento";
import {
  ESPECIE_NO_CANCELAMENTO, TEXTO_DO_CANCELAMENTO_DO_ORCAMENTO, useEstadoDaConsultaDoOrcamento, type EstadoDaConsultaDoOrcamento
} from "./estado-orcamento";

/**
 * OPERACOES-01 F6b (decisão 283) — A CONSULTA DO ORÇAMENTO DE COMPRA: `/compras/<seg>/:id`, na moldura da consulta de
 * compras (os testids `compras-consulta*` de hoje). Só composição: a leitura, o cancelar e o "Salvo" moram em
 * `estado-orcamento.ts`; a edição é a Central do orçamento em modo "edicao", NO LUGAR (sem rota nova).
 *
 * Barra: SEM Novo documento e SEM Duplicar (o orçamento nasce do pedido, pelo "Novo orçamento" dele). A pílula "Editar
 * orçamento" (com `orcamentos_compra.edit`; habilitada com o orçamento aberto). O leque: Imprimir, Histórico e "Cancelar
 * orçamento de compra…" (com `orcamentos_compra.delete` e o orçamento aberto). Escolher o vencedor é da aba "Orçamentos"
 * do pedido, onde está a comparação — não daqui.
 */

const PREFIXO = PREFIXO_CENTRAL_COMPRAS;
const t = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
const dataOuVazio = (v: unknown) => (typeof v === "string" && v ? dateBR(v) : "");
const codigoNome = (codigo: unknown, nome: unknown) => (nome ? [codigo, nome].filter(Boolean).join(" — ") : "");
const ehRegistro = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
/** As linhas de uma lista da leitura (o que não é registro não vira linha). */
const linhasLidas = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(ehRegistro) : []);


/** As colunas da leitura: o Local de estoque (copiado do pedido pelo servidor), o produto, a quantidade, o preço e o total. */
function colunasDaLeitura(variante: VarianteDeCompra): ColunasDosItens {
  return { ...colunasDosItensDeCompras(variante), leitura: ["armazem", "codigo", "produto", "quantidade", "unitario", "total"] };
}

const IconeEditar = () => <Pencil width={15} height={15} strokeWidth={2} aria-hidden />;

export function ConsultaDeOrcamento({ variante, id }: { variante: VarianteDeCompra; id: string }) {
  const tr = useTradutor();
  const e = useEstadoDaConsultaDoOrcamento({ variante, id });
  const rotulo = tr(variante.chaveI18n);
  const [densidade, setDensidade] = React.useState<PosicaoDoRotuloValor>("rotulo-a-frente");
  const [salvoVisivel, setSalvoVisivel] = React.useState(e.salvoAgora);
  React.useEffect(() => {
    if (!salvoVisivel) return;
    const timer = window.setTimeout(() => setSalvoVisivel(false), TEMPO_DO_SALVO_MS);
    return () => window.clearTimeout(timer);
  }, [salvoVisivel]);
  const [historico, setHistorico] = React.useState(false);
  const { setEditando } = e;
  /* Voltar da edição: com o PUT gravado, o "Salvo ✓" (a leitura já foi invalidada pelo estado do formulário). */
  const fecharEdicao = React.useCallback((salvou: boolean) => { setEditando(false); if (salvou) setSalvoVisivel(true); }, [setEditando]);
  const colunas = React.useMemo(() => colunasDaLeitura(variante), [variante]);
  const d = e.documento;
  const itensDoMotor = React.useMemo(() => linhasLidas(d?.["itens"]).map(itemParaOMotor), [d]);
  useTabTitle(d ? e.titulo : null);

  if (!d) {
    if (e.q.isLoading) {
      return <CentralDeDocumento prefixoTestid={PREFIXO} carregando titulo="Documento de compra"
        identidade={{ nome: "Carregando documento", alterado: false }} acoes={null} dados={null} itens={null} abas={abasDoOrcamento(e)} />;
    }
    return <LoadingOr q={e.q}>{null}</LoadingOr>;
  }
  if (e.editando) return <CentralDoOrcamento variante={variante} modo="edicao" orcamento={d} onFechar={fecharEdicao} />;

  const codigo = e.codigo;
  const acoes = <ConjuntoDaBarra>
    {e.podeEditar && <PilulaDaBarra icone={<IconeEditar />} dica={e.editarHabilitado ? "Editar orçamento" : MSG_ORCAMENTO_NAO_ABERTO} disabled={!e.editarHabilitado}
      data-testid="compras-orcamento-editar" onClick={() => { if (e.editarHabilitado) e.setEditando(true); }}>Editar orçamento</PilulaDaBarra>}
  </ConjuntoDaBarra>;
  const antes: ItemRapido[] = [
    { chave: "imprimir", rotulo: "Imprimir", testId: `${PREFIXO}-imprimir`, icone: <IconeImprimir />, onSelect: () => window.print() },
    ...(e.podeVerHistorico ? [{ chave: "historico", rotulo: "Histórico de alterações", testId: `${PREFIXO}-historico`, icone: <IconeHistorico />, onSelect: () => setHistorico(true) }] : [])
  ];
  const depois: ItemRapido[] = e.podeCancelar ? [{
    chave: "cancelar", rotulo: `Cancelar ${ESPECIE_NO_CANCELAMENTO}…`, testId: "compras-cancelar", icone: <IconeCancelarDocumento />, perigo: true,
    desabilitado: e.cancelarOcupado, onSelect: () => e.setCancelando(true)
  }] : [];
  const direita = <ConjuntoDireito>
    {salvoVisivel ? <IndicadorSalvo prefixoTestid={PREFIXO} /> : null}
    <PosicaoDoRotulo prefixoTestid={PREFIXO} valor={densidade} onChange={setDensidade} />
    <AcoesRapidas prefixoTestid={PREFIXO} documentosAbertos={fonteDosDocumentosDeCompras} antes={antes} depois={depois} />
  </ConjuntoDireito>;

  return <div data-testid="compras-consulta" className="contents">
    <div data-testid="compras-consulta-corpo" data-situacao={e.situacao} data-especie={variante.variante} className="contents">
      <CentralDeDocumento
        prefixoTestid={PREFIXO}
        titulo={e.titulo}
        identidade={{ nome: codigo || rotulo, codigo: Boolean(codigo), alterado: false, tom: statusTone(e.situacao, "situacao_documento_compra"), dica: rotulo,
          situacao: <StatusBadge domain="situacao_documento_compra" value={e.situacao} /> }}
        densidade={densidade}
        acoes={acoes}
        acoesDireita={direita}
        dados={<DadosDoOrcamentoSalvo e={e} />}
        itens={<div data-testid="compras-consulta-itens" className="contents">
          <ItensSalvos prefixoTestid={PREFIXO} colunas={colunas} itens={itensDoMotor}
            subtotal={String(d["valor_itens"] ?? "0")} legenda={`Itens do ${rotulo.toLowerCase()} ${codigo}`} casasDaQuantidade={4} />
        </div>}
        abas={abasDoOrcamento(e)}
      />
    </div>
    <DialogoCancelarDocumento prefixoTestid={PREFIXO} aberto={e.cancelando} onFechar={() => e.setCancelando(false)} especie={ESPECIE_NO_CANCELAMENTO} codigo={codigo}
      texto={TEXTO_DO_CANCELAMENTO_DO_ORCAMENTO} carregando={e.cancelarOcupado} motivoVazio={MOTIVO_VAZIO_DA_COMPRA} onCancelar={e.cancelar} />
    {e.podeVerHistorico && <HistoryDialog open={historico} onOpenChange={setHistorico} entity={ENTIDADE_DO_HISTORICO_DE_COMPRA} entityId={id} title={e.titulo} />}
  </div>;
}

/** Os Dados do orçamento salvo, em LEITURA, com o link do pedido que ele cota. */
function DadosDoOrcamentoSalvo({ e }: { e: EstadoDaConsultaDoOrcamento }) {
  const tr = useTradutor();
  const [maisDados, setMaisDados] = React.useState(false);
  const d = e.documento;
  if (!d) return null;
  const top = ehRegistro(d["tipo_operacao"]) ? d["tipo_operacao"] : null;
  const pedidoId = t(d["pedido_orcado_id"]);
  const segmentoDoPedido = varianteDeCompra("pedido")?.segmento ?? "pedidos";
  const pedido = pedidoId
    ? <Link data-testid="compras-orcamento-pedido" className="text-brand-700 underline" href={`/compras/${segmentoDoPedido}/${encodeURIComponent(pedidoId)}`}>
      Pedido de compra {t(d["pedido_orcado_codigo"])}
    </Link>
    : "";
  const prazo = d["prazo_entrega_dias"];
  return <>
    <ColunaDeCampos>
      <CampoLeitura rotulo="Fornecedor" adorno="pesquisa" testId="compras-consulta-fornecedor" valor={t(d["fornecedor_nome"])} />
      <CampoLeitura rotulo="Empresa" adorno="pesquisa" testId="compras-consulta-empresa" valor={t(d["empresa_nome"])} />
      <CampoLeitura rotulo={tr("termos.tipo_operacao")} adorno="travado" testId="compras-consulta-top" valor={top ? `${t(top["codigo"])} — ${t(top["nome"])}` : ""} />
      <CampoLeitura rotulo="Data" adorno="data" valor={dataOuVazio(d["data_documento"])} />
      <CampoLeitura rotulo="Condição de pagamento" adorno="pesquisa" valor={codigoNome(d["condicao_pagamento_codigo"], d["condicao_pagamento_nome"])} />
      <CampoLeitura rotulo="Prazo de entrega (dias)" adorno="travado" testId="compras-orcamento-prazo" valor={prazo === null || prazo === undefined ? "" : String(prazo)} />
      <CampoLeitura rotulo="Validade do orçamento" adorno="data" testId="compras-orcamento-validade" valor={dataOuVazio(d["validade_orcamento"])} />
      <CampoLeitura rotulo="Pedido de compra" adorno="travado" valor={pedido} />
      <div data-testid="compras-consulta-codigo-campo"><CampoLeitura rotulo="Número" adorno="travado" testId="compras-consulta-codigo" valor={t(d["codigo"])} /></div>
    </ColunaDeCampos>
    <DadosAdicionais quantidade={top ? 2 : 1} aberto={maisDados} onAlternar={() => setMaisDados((m) => !m)} manterMontado>
      <CampoLeitura rotulo="Movimento" adorno="travado" valor={tr(e.variante.chaveI18n)} />
      {top && <CampoLeitura rotulo="Versão da TOP" adorno="travado" valor={top["versao"] ? String(top["versao"]) : ""} />}
    </DadosAdicionais>
  </>;
}

/** As abas da consulta do orçamento: Totais (do servidor) e Observações. Sem documento, a estrutura sem conteúdo. */
function abasDoOrcamento(e: EstadoDaConsultaDoOrcamento): AbaDoPainel[] {
  const d = e.documento;
  if (!d) return [{ value: "totais", label: "Totais", content: null }, { value: "observacoes", label: "Observações", content: null }];
  return [
    { value: "totais", label: "Totais", content: <PainelColuna>
      <CampoLeitura rotulo="Subtotal dos itens" valor={brl(String(d["valor_itens"] ?? "0"))} />
      <div data-testid="compras-consulta-total"><CampoLeitura rotulo="Total do documento" adorno="travado" testId="central-compras-total" valor={brl(String(d["valor_total"] ?? "0"))} /></div>
    </PainelColuna> },
    { value: "observacoes", label: "Observações", content: <PainelLargo><CampoLeitura rotulo="Observação" multilinha valor={t(d["observacao"])} /></PainelLargo> }
  ];
}
