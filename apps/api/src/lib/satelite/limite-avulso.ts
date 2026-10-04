/**
 * LIMITE DO PEDIDO AVULSO AO COPERNICUS, POR INSTÂNCIA (SAT-01 → SAT-03 → SAT-06, decisões 293, 296 e 297).
 *
 * O limite de chamadas é o GLOBAL, contado pelo banco (`limite-global.ts`, SAT-03), E um PISO por instância em TENTATIVAS
 * por organização por minuto (`TENTATIVAS_AVULSAS_POR_MINUTO_INSTANCIA`): o ledger só conta resposta 2xx, e recusa, 429,
 * 5xx, tempo e rede também precisam de taxa. Este objeto guarda o estado em memória do processo que as duas contas
 * precisam:
 *   - as chamadas EM VOO (abertas, consumo ainda não gravado: o banco não as vê, então entram na conta do limite global
 *     como 'executando');
 *   - o piso em tentativas (`LimitePorMinuto`).
 *
 * UM objeto por processo (`app.limiteAvulsoSatelite`, decorado em server.ts ANTES das rotas), COMPARTILHADO pelos dois
 * pedidos avulsos que chamam o provedor: a análise da SAT-01 (`routes/analises-satelitais.ts`, Statistical API) e a
 * imagem por pixel da SAT-06 (`routes/rasters-satelitais.ts`, Process API). O mesmo limite global, o mesmo piso, as
 * mesmas vagas em voo: um pedido de imagem ocupa a mesma vaga que um pedido de análise.
 *
 * Até a SAT-06 este estado morava dentro da rota da SAT-01; o comportamento dela é o mesmo (a decisão e a ocupação da
 * vaga continuam no mesmo passo síncrono de quem chama, sem `await` entre `admitir` e `ocupar`).
 */
import { LimitePorMinuto } from "../consultas/http.js";
import { classificarLimite, type ChamadasEmVoo, type ContagemChamadas } from "./limite-global.js";
import { TENTATIVAS_AVULSAS_POR_MINUTO_INSTANCIA, type LimitesSatelite } from "./limites.js";

declare module "fastify" {
  interface FastifyInstance {
    /** O limite do pedido avulso desta instância (em voo + piso), compartilhado pela SAT-01 e pela SAT-06. */
    limiteAvulsoSatelite: LimiteAvulsoSatelite;
  }
}

export class LimiteAvulsoSatelite {
  private readonly tentativasPorOrganizacao: LimitePorMinuto;
  private conta = 0;
  private readonly porOrganizacao = new Map<string, number>();

  constructor(private readonly limites: LimitesSatelite, agora?: () => number) {
    this.tentativasPorOrganizacao = new LimitePorMinuto(TENTATIVAS_AVULSAS_POR_MINUTO_INSTANCIA, agora);
  }

  /** As chamadas em voo AGORA: todas desta instância e as da organização. */
  emVoo(orgId: string): ChamadasEmVoo {
    return { conta: this.conta, organizacao: this.porOrganizacao.get(orgId) ?? 0 };
  }

  /**
   * Pode abrir MAIS UMA chamada? O veredito do limite global (contagem do banco lida pela transação de quem chama +
   * as chamadas em voo agora) e, só se ele deixou, o piso por instância (que então conta a tentativa). Contagem ausente
   * (`null`) NEGA: limite ilegível nunca vira "livre". Quem chama ocupa a vaga (`ocupar`) no MESMO passo síncrono.
   */
  admitir(orgId: string, contagem: ContagemChamadas | null): boolean {
    if (!contagem || classificarLimite(contagem, this.limites, this.emVoo(orgId)) !== "livre") return false;
    return this.tentativasPorOrganizacao.permitir(orgId);
  }

  /** A chamada aberta entra na conta das em voo (até `liberar`, depois de o consumo dela estar no ledger). */
  ocupar(orgId: string): void {
    this.conta++;
    this.porOrganizacao.set(orgId, (this.porOrganizacao.get(orgId) ?? 0) + 1);
  }

  liberar(orgId: string): void {
    this.conta--;
    const n = (this.porOrganizacao.get(orgId) ?? 1) - 1;
    if (n > 0) this.porOrganizacao.set(orgId, n); else this.porOrganizacao.delete(orgId);
  }
}
