"use client";
import { ViewSegment, tab } from "@/components/workspace";
import { ContasBancarias } from "./contas";
import { ExtratoDaConta } from "./extrato";
import { Transferencias } from "./transferencias";
import { ConciliacaoOfx } from "./conciliacao";
import { FluxoDeCaixa } from "./fluxo";
import { ResultadoDre } from "./resultado";
import { AdiantamentosPorParceiro } from "./adiantamentos";

/**
 * As abas de tesouraria da Central Financeira (OPERACOES-01 F8, decisão 285). Só existem no modo `central`
 * (a página decide pela capacidade); os rótulos e as permissões vêm do registro de navegação.
 */
export function AbaBancosECaixa() {
  return <ViewSegment tabs={[
    tab("financeiro.bancos.contas", <ContasBancarias />),
    tab("financeiro.bancos.extrato", <ExtratoDaConta />),
    tab("financeiro.bancos.transferencias", <Transferencias />)
  ]} />;
}
export function AbaConciliacao() { return <ConciliacaoOfx />; }
export function AbaFluxoEResultado() {
  return <ViewSegment tabs={[
    tab("financeiro.fluxo.fluxo", <FluxoDeCaixa />),
    tab("financeiro.fluxo.resultado", <ResultadoDre />)
  ]} />;
}
export function AbaAdiantamentos() { return <AdiantamentosPorParceiro />; }
