/**
 * LIMITE GLOBAL DE CHAMADAS AO COPERNICUS NO PEDIDO AVULSO (SAT-03, decisão 296) — a rota da SAT-01 pergunta ao BANCO
 * antes de chamar o provedor. Substitui o limite em memória por instância (`LimitePorMinuto`), que com duas réplicas
 * deixava passar o dobro.
 *
 * A contagem é a da porta estreita `erp.satelite_contar_chamadas()` (migration 0054), na transação de quem chama — a
 * organização é a da GUC posta pelo `runService`, nunca um parâmetro:
 *   - chamadas no último minuto = linhas do ledger do último minuto + itens 'executando' (conta inteira e organização);
 *   - chamadas simultâneas      = itens 'executando' da fila.
 * Esta chamada seria MAIS UMA: passa só se cada contagem estiver ABAIXO do teto. O pedido avulso usa o teto inteiro de
 * simultâneas (o executor da fila deixa `RESERVA_INTERATIVA` vagas para ele).
 *
 * CHAMADAS EM VOO: um pedido avulso que já chamou o provedor e ainda não gravou o consumo não está no ledger nem é item
 * da fila — o banco não o vê. Quem chama soma as suas (`emVoo`, contadas no processo) como chamadas 'executando': sem
 * isso, uma rajada de pedidos simultâneos passaria inteira pela mesma contagem antes da primeira resposta.
 */
import type { Tx } from "@agro/db";
import type { LimitesSatelite } from "./limites.js";

export type VereditoLimite = "livre" | "conta" | "organizacao" | "simultaneas";

export interface ContagemChamadas { conta_minuto: number; conta_executando: number; org_minuto: number; org_executando: number }
/** Chamadas avulsas em voo deste processo: todas (conta) e as da organização do pedido. */
export interface ChamadasEmVoo { conta: number; organizacao: number }
const NENHUMA_EM_VOO: ChamadasEmVoo = { conta: 0, organizacao: 0 };

/** Contagem (+ em voo) → veredito. Número fora de inteiro ≥ 0 (contagem quebrada) LANÇA: limite ilegível nunca vira "livre". */
export function classificarLimite(c: ContagemChamadas, l: LimitesSatelite, emVoo: ChamadasEmVoo = NENHUMA_EM_VOO): VereditoLimite {
  for (const v of [c.conta_minuto, c.conta_executando, c.org_minuto, c.org_executando, emVoo.conta, emVoo.organizacao]) {
    if (!Number.isInteger(v) || v < 0) throw new Error("limite satelital: contagem de chamadas fora do formato");
  }
  const contaExecutando = c.conta_executando + emVoo.conta;
  if (c.conta_minuto + contaExecutando >= l.porMinutoConta) return "conta";
  if (c.org_minuto + c.org_executando + emVoo.organizacao >= l.porMinutoOrganizacao) return "organizacao";
  if (contaExecutando >= l.simultaneas) return "simultaneas";
  return "livre";
}

/** A contagem do banco, na transação de quem chama (organização da GUC). */
export async function lerContagemChamadas(tx: Tx): Promise<ContagemChamadas> {
  const r = await tx.query<ContagemChamadas>("select conta_minuto, conta_executando, org_minuto, org_executando from erp.satelite_contar_chamadas()");
  if (r.rowCount !== 1) throw new Error("limite satelital: a contagem de chamadas não devolveu exatamente uma linha");
  return r.rows[0]!;
}

/** Ler e classificar de uma vez (quem decide na mesma hora em que lê). */
export async function conferirLimiteGlobal(tx: Tx, l: LimitesSatelite, emVoo: ChamadasEmVoo = NENHUMA_EM_VOO): Promise<VereditoLimite> {
  return classificarLimite(await lerContagemChamadas(tx), l, emVoo);
}
