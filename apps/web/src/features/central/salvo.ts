import { descartarEntrega, entregarEmMemoria, espiarEntrega } from "@/lib/entrega-em-memoria";
import type { ConsumirSalvo, DepoisDeSalvar, EntregarSalvo } from "./contrato";

export { TEMPO_DO_SALVO_MS } from "./contrato";
export type { DepoisDeSalvar } from "./contrato";

/**
 * DEPOIS DE SALVAR — o que a criação deixa para a consulta que ela abre: o "Salvo" e, quando pedido, o diálogo de
 * Confirmar. Vai por `entregarEmMemoria` (Map em memória, com dono): nada na URL, nada no armazenamento do navegador.
 * A chave vem da espécie (`adaptador.chaveDoSalvo`); `chaveDepoisDeSalvar(prefixo)` monta a chave padrão
 * `<prefixo>:salvo:<id>`.
 */
export const chaveDepoisDeSalvar = (prefixo: string) => (id: string) => `${prefixo}:salvo:${id}`;

export const entregarSalvo: EntregarSalvo = (chave, id, depois) => { entregarEmMemoria(chave(id), depois); };

/** Lê SEM apagar (o efeito pode rodar duas vezes em desenvolvimento): espie ao montar e chame `descartarSalvo` no efeito. */
export const consumirSalvo: ConsumirSalvo = (chave, id) => espiarEntrega<DepoisDeSalvar>(chave(id));

export function descartarSalvo(chave: (id: string) => string, id: string): void { descartarEntrega(chave(id)); }
