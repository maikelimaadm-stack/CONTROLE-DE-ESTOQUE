"use client";
import * as React from "react";
import { ConfirmDialog } from "@/components/ui";
import { CentralDeDocumento, type ControleDaCentral } from "@/features/central/moldura";
import type { Pendencia, PosicaoDoRotuloValor } from "@/features/central/barra";
import { LancadorDeTipoOperacao, pedidoImpossivel } from "@/features/sales/lancador-tipo-operacao";
import type { VarianteDeCompra } from "./variantes";
import { PREFIXO_CENTRAL_COMPRAS } from "./central/adaptador";
import { descreverCaminhoDeItem, useAberturaDaEdicao, useEntradaDaCentral, useEstadoDaCriacao, type EstadoDaCriacao, type PropsDoEstadoDaCriacao } from "./central/estado";
import { irParaPendenciaDaCompra, useBarraDaCriacao } from "./central/criacao-barra";
import { AvisosDaCriacao, DadosDaCriacao, identidadeDaCriacao } from "./central/criacao-dados";
import { ItensDaCriacaoDeCompra } from "./central/criacao-itens";
import { ItensDoRecebimento } from "./central/receber";
import { CAMPOS_DOS_DADOS_PRINCIPAIS, abaDoCampoNoPainel, abasDoPainelDaCriacao, faixaDosTotaisDoPainel } from "./central/organizacao-do-painel";
import { CentralDoOrcamento } from "./orcamento/central-orcamento";

/**
 * A CENTRAL DE COMPRAS — criação de Pedido de compra e de Compra (COMPRAS-01..03; sobre o motor na VISUAL-UX-04,
 * decisão 276). Só COMPOSIÇÃO: a lógica (TOP da URL como pedido, trava da sessão, layout por TOP, regras, receber
 * pedido, corpo do POST, pendências, alterado/useDirtyTab) mora em `central/estado.ts`; as peças só desenham.
 * Sem TOP efetiva a página é o lançador (tela normal, com a trilha); com ela, a moldura do motor.
 *
 * OPERACOES-01 F6b (decisão 283): um DESPACHANTE, sem hook — o orçamento de compra (`/compras/orcamentos/new`, que
 * nasce do pedido) é a Central do orçamento (`orcamento/central-orcamento.tsx`); o pedido e a compra, a de hoje.
 *
 * EDITAR-02 (decisão 313): `modo="edicao"` — o pedido ou a compra SALVO no MESMO formulário, aberto pela consulta no
 * lugar (sem rota nova; o molde do orçamento): o `GET /edicao` carrega, e o formulário é o de sempre
 * (`useEstadoDaCriacao` com `edicao`). Sem `modo` (a rota de criação), nada muda.
 */
export type PropsDaCentralDeCompras =
  | { variante: VarianteDeCompra; modo?: "criacao" }
  | { variante: VarianteDeCompra; modo: "edicao"; id: string; onFechar: (salvou: boolean) => void; onRecusada: (motivo: string) => void };

export function CentralDeCompras(props: PropsDaCentralDeCompras) {
  const { variante } = props;
  if (props.modo === "edicao") return <EdicaoDoPedidoEDaCompra variante={variante} id={props.id} onFechar={props.onFechar} onRecusada={props.onRecusada} />;
  if (variante.variante === "orcamento") return <CentralDoOrcamento variante={variante} />;
  return <CentralDoPedidoEDaCompra variante={variante} />;
}

/** A EDIÇÃO no lugar da consulta: carregando o `/edicao`, a moldura de sempre em "carregando"; pronta, o formulário. */
function EdicaoDoPedidoEDaCompra({ variante, id, onFechar, onRecusada }: { variante: VarianteDeCompra; id: string; onFechar: (salvou: boolean) => void; onRecusada: (motivo: string) => void }) {
  const abertura = useAberturaDaEdicao({ variante, id, onFechar, onRecusada });
  if (abertura.situacao === "carregando") {
    return <div data-testid="compras-central" data-especie={variante.variante} data-modo="edicao" data-situacao="carregando" className="contents">
      <CentralDeDocumento prefixoTestid={PREFIXO_CENTRAL_COMPRAS} carregando titulo="Documento de compra"
        identidade={{ nome: "Carregando documento", alterado: false }} acoes={null} dados={null} itens={null} abas={[]} />
    </div>;
  }
  return <FormularioDeCompra key={abertura.chave} {...abertura.props} />;
}

/** A Central de Compras do pedido e da compra (o corpo de antes da F6b, sem mudança). */
function CentralDoPedidoEDaCompra({ variante }: { variante: VarianteDeCompra }) {
  const entrada = useEntradaDaCentral(variante);
  if (entrada.formulario) return <FormularioDeCompra key={entrada.formulario.chave} {...entrada.formulario.props} />;
  return <LancadorDeTipoOperacao
    estado={entrada.estado}
    titulo={`Novo documento · ${entrada.rotuloDaEspecie}`}
    indisponivel={pedidoImpossivel(entrada.estado, entrada.pedidaNaUrl)}
    onCancelar={entrada.voltarALista}
    // `replace`: o lançador e o formulário são duas caras da MESMA etapa de criação
    onContinuar={entrada.escolherTop}
  />;
}

/** Dados principais: só identificação da compra, na ordem fixa; o restante vai ao painel. */
function estadoDosDados(e: EstadoDaCriacao): EstadoDaCriacao {
  const noLayout = new Set([...e.zonas.principais, ...e.zonas.adicionais]);
  return {
    ...e,
    zonas: {
      principais: CAMPOS_DOS_DADOS_PRINCIPAIS.filter((c) => noLayout.has(c)),
      adicionais: [],
      abas: []
    }
  };
}

/** Um campo só, pelo MESMO renderizador dos Dados (rótulo, "*", erro, padrão, trava do layout). */
function estadoDeUmCampo(e: EstadoDaCriacao, campo: string): EstadoDaCriacao {
  return { ...e, top: null, layoutVale: null, zonas: { principais: [campo], adicionais: [], abas: [] } };
}

function FormularioDeCompra(props: PropsDoEstadoDaCriacao) {
  const e = useEstadoDaCriacao(props);
  /* Paridade com a consulta e com o motor da Central: rótulo à frente (não redesenhar a geometria). */
  const [densidade, setDensidade] = React.useState<PosicaoDoRotuloValor>("rotulo-a-frente");
  const controle = React.useRef<ControleDaCentral | null>(null);
  /** Pendência no painel: abre a aba primeiro, depois leva ao campo. */
  const irPara = (p: Pendencia) => {
    const aba = abaDoCampoNoPainel(e, p.caminho);
    if (aba && controle.current) { controle.current.abrirAba(aba); window.setTimeout(() => irParaPendenciaDaCompra(p), 0); return; }
    irParaPendenciaDaCompra(p);
  };
  const barra = useBarraDaCriacao({ e, densidade, onDensidade: setDensidade, onIr: irPara });
  const receber = e.modo === "receber";
  const desenharCampo = (c: string) => <DadosDaCriacao e={estadoDeUmCampo(e, c)} />;
  const abas = abasDoPainelDaCriacao(e, desenharCampo);

  return <div data-testid="compras-central" data-especie={e.variante.variante} data-modo={receber ? "receber" : e.modo === "edicao" ? "edicao" : "lancar"}
    data-documento-id={e.documentoEmEdicao ? String(e.documentoEmEdicao["id"] ?? "") : undefined} className="contents">
    <CentralDeDocumento
      prefixoTestid={PREFIXO_CENTRAL_COMPRAS}
      titulo={e.titulo}
      identidade={identidadeDaCriacao(e)}
      densidade={densidade}
      controle={controle}
      acoes={barra.acoes}
      acoesDireita={barra.direita}
      aviso={<AvisosDaCriacao e={e} />}
      dados={<DadosDaCriacao e={estadoDosDados(e)} />}
      itens={e.mostrarFormulario ? <>
        {receber ? <ItensDoRecebimento estado={e} /> : <ItensDaCriacaoDeCompra estado={e} />}
        {e.errosDeItens.length > 0 && <ul data-testid="compras-erros-itens" className="mt-2 space-y-0.5 text-[12px] text-red-700">
          {e.errosDeItens.map(([c, m]) => <li key={c}>{descreverCaminhoDeItem(c)}: {m}</li>)}
        </ul>}
      </> : null}
      faixaDoPainel={faixaDosTotaisDoPainel(e)}
      abas={abas}
    />
    {barra.dialogos}
    {/* Trocar a operação descarta o que foi digitado — então pergunta antes. */}
    <ConfirmDialog open={e.confirmarTroca} onOpenChange={e.setConfirmarTroca} title="Alterar o Tipo de Operação?"
      description="Os dados já preenchidos neste lançamento serão descartados." danger
      onConfirm={() => { e.setConfirmarTroca(false); e.voltarAoLancador(); }} />
    {/* EDITAR-02: o documento mudou desde que a edição abriu (409 da PATCH) — a mensagem do servidor e a OFERTA de
        recarregar (o rascunho só é descartado se a pessoa aceitar). */}
    <ConfirmDialog open={e.conflito !== null} onOpenChange={(aberto) => { if (!aberto) e.fecharConflito(); }} title="O documento mudou"
      confirmLabel="Recarregar o documento" dismissLabel="Continuar editando" onConfirm={e.recarregarEdicao}>
      <p data-testid="compras-edicao-conflito" className="text-sm text-slate-600">{e.conflito}</p>
    </ConfirmDialog>
  </div>;
}
