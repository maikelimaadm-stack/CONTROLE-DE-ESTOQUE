/**
 * ESBOÇO — W2 substitui por inteiro (operações puras sobre o FormLayout, pilha e arrastar). Assinaturas: `Operacoes` em tipos.ts.
 */
import type { Operacoes } from "./tipos";

const naoFeito = (nome: string): never => { throw new Error(`rascunho.${nome}: não implementado`); };

export const criarContexto: Operacoes["criarContexto"] = () => naoFeito("criarContexto");
export const abrirRascunho: Operacoes["abrirRascunho"] = () => naoFeito("abrirRascunho");
export const paraSalvar: Operacoes["paraSalvar"] = () => naoFeito("paraSalvar");
export const formaCanonica: Operacoes["formaCanonica"] = () => naoFeito("formaCanonica");
export const alterado: Operacoes["alterado"] = () => naoFeito("alterado");
export const posicionados: Operacoes["posicionados"] = () => naoFeito("posicionados");
export const cardsDoPainel: Operacoes["cardsDoPainel"] = () => naoFeito("cardsDoPainel");
export const contagemDoPainel: Operacoes["contagemDoPainel"] = () => naoFeito("contagemDoPainel");
export const contagemDoCard: Operacoes["contagemDoCard"] = () => naoFeito("contagemDoCard");
export const limiteDaLinha: Operacoes["limiteDaLinha"] = () => naoFeito("limiteDaLinha");
export const enderecoDe: Operacoes["enderecoDe"] = () => naoFeito("enderecoDe");
export const obrigatorio: Operacoes["obrigatorio"] = () => naoFeito("obrigatorio");
export const visivel: Operacoes["visivel"] = () => naoFeito("visivel");
export const somenteLeitura: Operacoes["somenteLeitura"] = () => naoFeito("somenteLeitura");
export const motivoNaoExcluirPainel: Operacoes["motivoNaoExcluirPainel"] = () => naoFeito("motivoNaoExcluirPainel");
export const motivoNaoExcluirCard: Operacoes["motivoNaoExcluirCard"] = () => naoFeito("motivoNaoExcluirCard");
export const motivoNaoRemoverLinha: Operacoes["motivoNaoRemoverLinha"] = () => naoFeito("motivoNaoRemoverLinha");
export const usarCampo: Operacoes["usarCampo"] = () => naoFeito("usarCampo");
export const moverCampo: Operacoes["moverCampo"] = () => naoFeito("moverCampo");
export const trocarEntreLinhas: Operacoes["trocarEntreLinhas"] = () => naoFeito("trocarEntreLinhas");
export const trocarComDisponivel: Operacoes["trocarComDisponivel"] = () => naoFeito("trocarComDisponivel");
export const tirarCampo: Operacoes["tirarCampo"] = () => naoFeito("tirarCampo");
export const usarTodos: Operacoes["usarTodos"] = () => naoFeito("usarTodos");
export const tirarTodos: Operacoes["tirarTodos"] = () => naoFeito("tirarTodos");
export const adicionarLinha: Operacoes["adicionarLinha"] = () => naoFeito("adicionarLinha");
export const removerLinha: Operacoes["removerLinha"] = () => naoFeito("removerLinha");
export const moverLinha: Operacoes["moverLinha"] = () => naoFeito("moverLinha");
export const adicionarPainel: Operacoes["adicionarPainel"] = () => naoFeito("adicionarPainel");
export const removerPainel: Operacoes["removerPainel"] = () => naoFeito("removerPainel");
export const moverPainel: Operacoes["moverPainel"] = () => naoFeito("moverPainel");
export const renomearPainel: Operacoes["renomearPainel"] = () => naoFeito("renomearPainel");
export const adicionarCard: Operacoes["adicionarCard"] = () => naoFeito("adicionarCard");
export const removerCard: Operacoes["removerCard"] = () => naoFeito("removerCard");
export const moverCard: Operacoes["moverCard"] = () => naoFeito("moverCard");
export const renomearCard: Operacoes["renomearCard"] = () => naoFeito("renomearCard");
export const alternarLargura: Operacoes["alternarLargura"] = () => naoFeito("alternarLargura");
export const definirRotulo: Operacoes["definirRotulo"] = () => naoFeito("definirRotulo");
export const definirObrigatorio: Operacoes["definirObrigatorio"] = () => naoFeito("definirObrigatorio");
export const definirVisivel: Operacoes["definirVisivel"] = () => naoFeito("definirVisivel");
export const definirSomenteLeitura: Operacoes["definirSomenteLeitura"] = () => naoFeito("definirSomenteLeitura");
export const definirValorPadrao: Operacoes["definirValorPadrao"] = () => naoFeito("definirValorPadrao");
export const vistaDuranteArraste: Operacoes["vistaDuranteArraste"] = () => naoFeito("vistaDuranteArraste");
export const preverSoltura: Operacoes["preverSoltura"] = () => naoFeito("preverSoltura");
export const aplicarSoltura: Operacoes["aplicarSoltura"] = () => naoFeito("aplicarSoltura");
export const criarPilha: Operacoes["criarPilha"] = () => naoFeito("criarPilha");
export const aplicar: Operacoes["aplicar"] = () => naoFeito("aplicar");
export const fecharDigitacao: Operacoes["fecharDigitacao"] = () => naoFeito("fecharDigitacao");
export const desfazer: Operacoes["desfazer"] = () => naoFeito("desfazer");
export const refazer: Operacoes["refazer"] = () => naoFeito("refazer");
export const podeDesfazer: Operacoes["podeDesfazer"] = () => naoFeito("podeDesfazer");
export const podeRefazer: Operacoes["podeRefazer"] = () => naoFeito("podeRefazer");
