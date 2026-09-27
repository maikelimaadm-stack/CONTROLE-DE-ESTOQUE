import type { EstruturaLayout, ZonaDoLayout } from "@agro/domain";
import type { ResultadoOperacao } from "./contrato";

/**
 * OPERAÇÕES PURAS sobre a estrutura (VENDAS-A3-1c). Dono: agente W6. Arrastar e os botões sem mouse chamam as MESMAS.
 * Regra de zona: `motivoZonaProibida` do domínio. Obrigatório do sistema (catálogo `sistema`) nunca sai
 * (MENSAGEM_OBRIGATORIO_NAO_SAI). Campo do documento que entra vem com os valores do layout do sistema (obrigatorio do
 * sistema, editavel true); coluna idem. Sair do cabeçalho apaga `grupo`; entrar no cabeçalho define `grupo` — e, na
 * PRIMEIRA vez que algum campo ganha grupo, os demais do cabeçalho recebem o grupo que tinham pela regra antiga
 * (camposAdicionaisDoCabecalho), para a prévia não mudar sozinha. Aba que fica vazia continua existindo (a validação
 * recusa aba vazia ao salvar; a tela avisa).
 */
const pendente = (): ResultadoOperacao => ({ ok: false, motivo: "Operação ainda não implementada." });

/** Onde está a chave ("itens.<c>" para coluna) na estrutura; null = fora do layout. */
export function ondeEsta(_e: EstruturaLayout, _chave: string): ZonaDoLayout | null { return null; }
/** Põe (ou move) a chave na zona, antes de `antesDe` (chave) ou no fim. */
export function moverCampo(_familia: string, _e: EstruturaLayout, _chave: string, _zona: ZonaDoLayout, _antesDe?: string): ResultadoOperacao { return pendente(); }
/** Tira a chave do layout (recusa obrigatório do sistema). */
export function removerCampo(_familia: string, _e: EstruturaLayout, _chave: string): ResultadoOperacao { return pendente(); }
/** Sobe (-1) ou desce (+1) dentro da zona. */
export function deslocarCampo(_e: EstruturaLayout, _chave: string, _delta: -1 | 1): ResultadoOperacao { return pendente(); }
/** Abas: criar (nome único), renomear (nome não vazio e único), mover (-1/+1), remover (só vazia). */
export function adicionarAba(_e: EstruturaLayout, _nome?: string): ResultadoOperacao { return pendente(); }
export function renomearAba(_e: EstruturaLayout, _indice: number, _nome: string): ResultadoOperacao { return pendente(); }
export function deslocarAba(_e: EstruturaLayout, _indice: number, _delta: -1 | 1): ResultadoOperacao { return pendente(); }
export function removerAba(_e: EstruturaLayout, _indice: number): ResultadoOperacao { return pendente(); }
/** Troca a configuração de um campo/coluna (Configurar campo). */
export function substituirCampo(_e: EstruturaLayout, _chave: string, _novo: Record<string, unknown>): ResultadoOperacao { return pendente(); }
