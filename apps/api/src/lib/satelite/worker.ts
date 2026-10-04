/**
 * EXECUTOR DA FILA SATELITAL (SAT-03, decisão 296) — consome `erp.satelite_consulta_itens` DENTRO do processo da API,
 * sem fila externa (nada de pg-boss, BullMQ ou Redis): a fila é a tabela, e a coordenação entre réplicas é do banco.
 *
 * UMA RODADA:
 *   1. RESERVA, numa transação curta e SEM contexto de tenant (GUC vazia): `erp.satelite_reservar_itens` (migration
 *      0054), a porta estreita que, sob advisory lock, devolve vencidos à fila, confere os três tetos GLOBAIS (simultâneas,
 *      por minuto na conta, por minuto na organização — `limites.ts`) e o ACESSO do criador (o mesmo predicado da RLS), e
 *      marca os itens 'executando' com prazo (`for update skip locked`: duas réplicas nunca pegam o mesmo item). Limite
 *      atingido não é falha: o item simplesmente não é reservado nesta rodada.
 *   2. Cada item reservado em paralelo (o lote já conta como 'executando' no limite), por `executar-item.ts`, em nome do
 *      criador da consulta. Um item nunca derruba o lote: o desfecho de cada um entra na contagem.
 *
 * LIGA/DESLIGA (`server.ts`): só roda com SATELITE_WORKER_ENABLED=1, COPERNICUS_ENABLED=1 e o cliente com credencial —
 * `motivoExecutorDesligado` diz qual falta. Ligado, `iniciar()` no onReady e `parar()` no onClose (espera a rodada em
 * curso). Desligado, nada é reservado: as consultas ficam na fila, sem gasto.
 */
import { withTx, type Db } from "@agro/db";
import type { Config } from "../../config.js";
import type { ClienteCopernicus } from "./copernicus.js";
import { executarItem, resumoDoErro, type DesfechoItem, type ItemReservado, type LogSatelite } from "./executar-item.js";
import { INTERVALO_EXECUTOR_PADRAO_S, LOTE_EXECUTOR, PRAZO_EXECUCAO_S, simultaneasDoExecutor, type LimitesSatelite } from "./limites.js";

declare module "fastify" {
  interface FastifyInstance {
    /** O cliente Copernicus do PROCESSO (um token só): a rota avulsa da SAT-01 e o executor da fila usam este. */
    clienteCopernicus: ClienteCopernicus;
    /** O executor da fila satelital, ou `null` quando desligado (`motivoExecutorDesligado`). */
    executorSatelite: WorkerSatelite | null;
  }
}

export interface ResumoRodada { reservados: number; concluidos: number; falhos: number; adiados: number }

export interface OpcoesWorker {
  db: Db;
  cliente: ClienteCopernicus;
  limites: LimitesSatelite;
  log: LogSatelite;
  /** Entre o fim de uma rodada e o começo da próxima (padrão: `INTERVALO_EXECUTOR_PADRAO_S`). */
  intervaloMs?: number;
  /** Itens pedidos à reserva por rodada (1–50; padrão `LOTE_EXECUTOR`). O teto real é a capacidade livre. */
  lote?: number;
  /** Prazo do 'executando' (padrão `PRAZO_EXECUCAO_S`). */
  prazoSegundos?: number;
  agora?: () => number;
  aleatorio?: () => number;
}

/**
 * Por que o executor NÃO roda neste processo — ou `null` quando as três condições valem. O texto vai para o log de
 * uma linha do startup: só o nome da condição, nunca valor de variável nem credencial.
 */
export function motivoExecutorDesligado(config: Pick<Config, "SATELITE_WORKER_ENABLED" | "COPERNICUS_ENABLED">, cliente: Pick<ClienteCopernicus, "configurado">): string | null {
  if (!config.SATELITE_WORKER_ENABLED) return "SATELITE_WORKER_ENABLED desligado";
  if (!config.COPERNICUS_ENABLED) return "COPERNICUS_ENABLED desligado";
  if (!cliente.configurado) return "credencial do Copernicus ausente";
  return null;
}

export class WorkerSatelite {
  private emCurso: Promise<ResumoRodada> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ligado = false;

  constructor(private readonly opcoes: OpcoesWorker) {}

  /** Uma rodada (reserva + execução do lote). Chamada durante outra rodada desta instância: a MESMA rodada. */
  rodarUmaVez(): Promise<ResumoRodada> {
    if (!this.emCurso) this.emCurso = this.rodada().finally(() => { this.emCurso = null; });
    return this.emCurso;
  }

  /** Liga o ciclo: uma rodada a cada intervalo (contado do FIM da anterior — rodadas desta instância nunca se sobrepõem). */
  iniciar(): void {
    if (this.ligado) return;
    this.ligado = true;
    this.agendar();
  }

  /** Desliga o ciclo e ESPERA a rodada em curso terminar (nenhum item fica no meio por causa do desligamento). */
  async parar(): Promise<void> {
    this.ligado = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.emCurso) await this.emCurso.catch(() => undefined);
  }

  private agendar(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.rodarUmaVez()
        .catch((e: unknown) => this.opcoes.log.error({ satelite_executor: { etapa: "rodada", ...resumoDoErro(e) } }, "rodada do executor satelital falhou"))
        .finally(() => { if (this.ligado) this.agendar(); });
    }, this.opcoes.intervaloMs ?? INTERVALO_EXECUTOR_PADRAO_S * 1000);
    // O ciclo não segura o processo vivo: quem encerra a API é o onClose (que chama parar()).
    this.timer.unref?.();
  }

  private async reservar(): Promise<ItemReservado[]> {
    const { db, limites } = this.opcoes;
    // GUC VAZIA de propósito: a porta é SECURITY DEFINER e confere o acesso de cada criador por dentro; nenhuma
    // organização "do executor" existe para ser posta aqui.
    const r = await withTx(db, { orgId: null, userId: null, modulo: null }, (tx) => tx.query<ItemReservado>(
      "select organization_id, empresa_id, consulta_id, item_id, criado_por from erp.satelite_reservar_itens($1, $2, $3, $4, $5)",
      [this.opcoes.lote ?? LOTE_EXECUTOR, simultaneasDoExecutor(limites), limites.porMinutoConta, limites.porMinutoOrganizacao, this.opcoes.prazoSegundos ?? PRAZO_EXECUCAO_S]));
    return r.rows;
  }

  private async rodada(): Promise<ResumoRodada> {
    const itens = await this.reservar();
    const dep = { db: this.opcoes.db, cliente: this.opcoes.cliente, log: this.opcoes.log, agora: this.opcoes.agora ?? Date.now, aleatorio: this.opcoes.aleatorio ?? Math.random };
    // `executarItem` não lança; o `allSettled` é a garantia de que nem um defeito nele derruba o lote.
    const desfechos = await Promise.allSettled(itens.map((item) => executarItem(dep, item)));
    const contar = (d: DesfechoItem) => desfechos.filter((x) => (x.status === "fulfilled" ? x.value : "adiado") === d).length;
    const resumo: ResumoRodada = { reservados: itens.length, concluidos: contar("concluido"), falhos: contar("falho"), adiados: contar("adiado") };
    if (resumo.reservados) this.opcoes.log.info({ satelite_executor: resumo }, "rodada do executor satelital");
    return resumo;
  }
}
