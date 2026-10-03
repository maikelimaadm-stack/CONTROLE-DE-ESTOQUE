"use client";
import * as React from "react";
import Link from "next/link";
import { AVISO_PADRAO_INVALIDO_CENTRAL } from "@agro/domain";
import { useAuth } from "@/lib/auth";
import { RefSelect } from "@/components/ui/ref-select";
import { MensagemTop } from "@/features/sales/tipo-operacao-select";
import { CampoDaCentral, ColunaDeCampos, DataDaCentral } from "@/features/central/campo";
import type { IdentidadeDoDocumento } from "@/features/central/contrato";
import estilosCv from "@/features/central/moldura.module.css";
import { hrefDoConfigurador, textoDoLayoutQueVale } from "@/features/compras/layout-da-central";
import { CampoDaOrigem } from "./origem";
import type { EstadoDaCriacaoDeEstoque } from "./estado-criacao";

/**
 * CENTRAL DE ESTOQUE — OS DADOS PRINCIPAIS DA CRIAÇÃO E OS AVISOS (OPERACOES-01 F5b, decisão 282).
 *
 * O cabeçalho de 36 px (Ampliar, nome do documento, ponto de alteração) é da moldura do motor: daqui sai só a
 * `identidade`. Os campos, NESTA ORDEM (o layout do estoque decide rótulo, valor padrão e "editável", não a ordem nem a
 * zona — tudo fica nos Dados principais): Tipo de Operação (travado), Empresa, Data do documento, Local de estoque (ou
 * de origem, na transferência), Local de estoque de destino (transferência) e o documento de origem (consumo e
 * devolução de consumo). A Observação, o Destino e o Motivo da saída vão para as abas do painel.
 *
 * Nada aqui decide valor, obrigatoriedade, erro ou corpo: tudo vem de `useEstadoDaCriacaoDeEstoque`. Os testids
 * `estoque-central-*` de antes continuam no elemento equivalente.
 */

/** O nome do documento ainda sem número; o ponto acende com alteração. */
export function identidadeDaCriacao(e: EstadoDaCriacaoDeEstoque): IdentidadeDoDocumento {
  return {
    nome: e.titulo,
    alterado: e.alterado,
    dica: "O saldo só muda quando o documento for confirmado. Salvar grava o documento aberto."
  };
}

/**
 * Os avisos acima dos dados: o do saldo (sempre), o da requisição (reserva) e o do custo vazio (a entrada com a
 * movimentação interna); a TOP desta sessão que deixou de valer; o layout que não carregou; a origem recusada.
 */
export function AvisosDaCriacao({ e }: { e: EstadoDaCriacaoDeEstoque }) {
  const semTop = !e.escritaTopConfirmada;
  return <div className="space-y-1.5">
    <p data-testid="estoque-central-aviso-saldo" className="text-[12.5px] text-slate-500">O saldo só muda quando o documento for confirmado. Salvar grava o documento aberto.</p>
    {e.forma.colunaDoEstoque === "disponivel" && <p data-testid="estoque-central-aviso-requisicao" className="text-[12.5px] text-slate-500">
      A requisição reserva o produto no local de estoque quando for confirmada; o saldo só sai no consumo.
    </p>}
    {e.especie === "entrada" && e.forma.custo === "opcional" && <p data-testid="estoque-central-aviso-custo" className="text-[12.5px] text-slate-500">
      Custo unitário vazio: a confirmação usa o custo médio do produto.
    </p>}
    {semTop && <div className="space-y-1 rounded-md bg-amber-50 p-3">
      <MensagemTop estado={e.estadoTop} />
      {e.estadoTop.situacao === "pronto" && <p data-testid="top-indisponivel" className="text-sm text-amber-800">O Tipo de Operação selecionado não está disponível para este lançamento.</p>}
      <p className="text-xs text-amber-700">O que já foi preenchido continua aqui. Use “Alterar operação” para escolher outra.</p>
    </div>}
    {e.layoutNaoCarregado && <div className="rounded-md bg-amber-50 p-3">
      <p data-testid="estoque-central-layout-nao-carregado" className="text-sm text-amber-700">Não foi possível carregar o layout deste Tipo de Operação. O lançamento está bloqueado até ele ser carregado.</p>
    </div>}
    {e.avisoDaOrigem && <div className="rounded-md bg-amber-50 p-3">
      <p data-testid="estoque-central-origem-aviso" className="text-sm text-amber-700">{e.avisoDaOrigem}</p>
    </div>}
  </div>;
}

/** Os Dados principais da criação. */
export function DadosDaCriacao({ e }: { e: EstadoDaCriacaoDeEstoque }) {
  const { can } = useAuth();
  const h = e.cabecalho;
  const daOrigem = e.origemAplicada !== null;
  const transferencia = e.forma.localDeDestino;
  const aviso = (c: string) => (e.padraoInvalido(c) ? <p data-testid="padrao-invalido-aviso" className="mt-0.5 text-[11px] text-amber-700">{AVISO_PADRAO_INVALIDO_CENTRAL}</p> : null);
  /** O campo travado pelo layout (não editável, com padrão válido) fica num fieldset desabilitado, mostrando o valor. */
  const travar = (c: string, n: React.ReactNode) => (e.travadoPeloLayout(c)
    ? <fieldset key={c} disabled data-editavel="false" style={{ display: "contents" }}>{n}</fieldset>
    : <React.Fragment key={c}>{n}</React.Fragment>);
  /** Empresa e Local de estoque vêm da origem aplicada, TRAVADOS. */
  const dicaDaOrigem = daOrigem ? "Vem do documento de origem." : undefined;

  /* A TOP TRAVADA: contexto do lançamento, não campo; "<código> — <nome>", o movimento na dica. */
  const top = <CampoDaCentral key="top" rotulo="Tipo de Operação" obrigatorio estado="travado" testId="estoque-central-top" data-tipo-operacao-id={e.top.id}
    dica={e.top.movimento ? `Movimento: ${e.top.movimento} (o movimento é definido pela espécie)` : undefined}>
    <span className={estilosCv.codigo}>{e.top.codigo}</span> <span className={estilosCv.separador}>—</span> <span>{e.top.nome}</span>
  </CampoDaCentral>;

  const empresa = travar("empresa_id", <CampoDaCentral rotulo={e.rotuloDoCampo("empresa_id")} obrigatorio={e.obrigatorio("empresa_id")} erro={e.erro("empresa_id")} icone="pesquisa"
    preenchido={Boolean(h.empresa_id)} estado={daOrigem ? "desabilitado" : "editavel"} testId="estoque-central-empresa" data-campo="empresa_id" dica={dicaDaOrigem} abaixo={aviso("empresa_id")}>
    <RefSelect resource="empresas" value={h.empresa_id} disabled={daOrigem || undefined} allowEmpty={!daOrigem} labelHint={e.origemAplicada?.empresa_nome} onChange={(v) => e.escolherEmpresa(v ?? "")} />
  </CampoDaCentral>);

  const data = travar("data_documento", <CampoDaCentral rotulo={e.rotuloDoCampo("data_documento")} obrigatorio={e.obrigatorio("data_documento")} erro={e.erro("data_documento")} icone="data"
    preenchido={Boolean(h.data_documento)} testId="estoque-central-data" data-campo="data_documento" abaixo={aviso("data_documento")}>
    <DataDaCentral rotulo={e.rotuloDoCampo("data_documento")} value={h.data_documento} onChange={(v) => e.mudar({ data_documento: v })} />
  </CampoDaCentral>);

  const local = travar("armazem_id", <CampoDaCentral rotulo={e.rotuloDoCampo("armazem_id")} obrigatorio={e.obrigatorio("armazem_id")} erro={e.erro("armazem_id")} icone="pesquisa"
    preenchido={Boolean(h.armazem_id)} estado={daOrigem || !h.empresa_id ? "desabilitado" : "editavel"} testId="estoque-central-armazem" data-campo="armazem_id" dica={dicaDaOrigem} abaixo={aviso("armazem_id")}>
    <RefSelect resource="warehouses" value={h.armazem_id} disabled={daOrigem || !h.empresa_id || undefined} filter={{ empresa_id: h.empresa_id }}
      labelHint={e.rotulos["armazem_id"] || undefined} excluirIds={transferencia && h.armazem_destino_id ? [h.armazem_destino_id] : undefined}
      onChange={(v, opcao) => e.escolherLocal("armazem_id", v ?? "", opcao?.label ?? "")} />
  </CampoDaCentral>);

  const localDeDestino = transferencia && travar("armazem_destino_id", <CampoDaCentral rotulo={e.rotuloDoCampo("armazem_destino_id")} obrigatorio={e.obrigatorio("armazem_destino_id")}
    erro={e.erro("armazem_destino_id")} icone="pesquisa" preenchido={Boolean(h.armazem_destino_id)} estado={h.empresa_id ? "editavel" : "desabilitado"}
    testId="estoque-central-armazem-destino" data-campo="armazem_destino_id" abaixo={aviso("armazem_destino_id")}>
    <RefSelect resource="warehouses" value={h.armazem_destino_id} disabled={!h.empresa_id || undefined} filter={{ empresa_id: h.empresa_id }}
      labelHint={e.rotulos["armazem_destino_id"] || undefined} excluirIds={h.armazem_id ? [h.armazem_id] : undefined}
      onChange={(v, opcao) => e.escolherLocal("armazem_destino_id", v ?? "", opcao?.label ?? "")} />
  </CampoDaCentral>);

  const origem = e.forma.origem && e.mostrarOrigem
    ? <CampoDaOrigem key="origem" especieDaOrigem={e.forma.origem} empresaId={h.empresa_id} armazemId={h.armazem_id} valor={h.origem_documento_id}
      rotuloDoValor={e.rotulos["origem_documento_id"] ?? ""} obrigatorio={e.obrigatorio("origem_documento_id")} erro={e.erro("origem_documento_id")}
      onChange={e.escolherOrigem} />
    : null;

  /* Só com a capacidade do layout E a resposta conferida. `can` só decide se o atalho aparece (apresentação). */
  const linhaDoLayout = e.layoutVale && <div className="flex flex-wrap items-baseline gap-x-2">
    <p data-testid="estoque-central-layout-efetivo" data-origem={e.layoutVale.origem} data-layout-id={e.layoutVale.id ?? ""} className="text-[11.5px] text-slate-500">{textoDoLayoutQueVale(e.layoutVale)}</p>
    {can("tipos_operacao.edit") && <Link data-testid="estoque-central-layout-configurar" href={hrefDoConfigurador(e.layoutVale)} className="text-[11.5px] font-medium text-emerald-700 hover:underline">Configurar</Link>}
  </div>;

  return <>
    {linhaDoLayout}
    <ColunaDeCampos>
      {top}
      {empresa}
      {data}
      {local}
      {localDeDestino}
      {origem}
    </ColunaDeCampos>
  </>;
}
