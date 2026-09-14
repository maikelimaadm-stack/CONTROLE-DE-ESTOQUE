import { DomainError } from "@agro/shared";

/**
 * CONTRATO NEGATIVO DO NOME ANTIGO DE EMPRESA (PRE-BASE2-05B) — lápide, não tradutor.
 *
 * A API é canônica desde esta fase: `empresa_id`, `empresa_origem_id`, `empresa_destino_id`, `X-Empresa-Id`,
 * recurso `empresas`. Este módulo NÃO traduz nada. Ele só RECUSA, e existe por um motivo específico.
 *
 * POR QUE RECUSAR EM VEZ DE IGNORAR
 *
 * Ignorar parece inofensivo e é o caminho mais perigoso dos três. Os schemas de entrada são `z.object`, que
 * por padrão DESCARTA chave desconhecida — então `farm_id: B` enviado por um cliente antigo simplesmente
 * sumiria, e a operação continuaria com a empresa do CONTEXTO. O cliente pediu a empresa B, o servidor
 * gravou na empresa do cabeçalho, e ninguém viu. O mesmo vale na leitura: um filtro `farm_id__eq` descartado
 * devolve a lista SEM o recorte — mais linhas do que foram pedidas, o que é ampliação silenciosa de escopo.
 *
 * Um erro de contrato é barulhento e o cliente conserta. Um pedido silenciosamente ignorado vira lançamento
 * na empresa errada, e aparece meses depois num relatório.
 *
 * LIMITES DELIBERADOS
 *
 * - Só o NÍVEL DE CIMA do corpo e da query. O contrato de empresa sempre esteve aí; um `farm_id` dentro de
 *   `extra`, `definition` ou `metadata` é dado do usuário, e descer nele seria a API opinando sobre o
 *   conteúdo de um campo livre — o mesmo limite que o adaptador respeitava.
 * - Não olha resposta, não olha caminho, não reescreve nada.
 * - Não vigia vocabulário do domínio: `farm_transfer` (tipo de movimentação) e `farm_transfers.view`
 *   (permissão) são contratos próprios do servidor, com vida independente — mudá-los é outra decisão.
 *
 * PRAZO: esta lápide é a única coisa que resta do nome antigo no runtime da API e é a ÚLTIMA a sair.
 * Enquanto houver qualquer chance de um cliente fora do nosso controle (script, integração, link salvo)
 * falar o idioma antigo, recusar é melhor do que aceitar em silêncio. A decisão de removê-la fica para
 * depois da PRE-BASE2-05C, e depende de observar tráfego real — não de acharmos que ninguém mais usa.
 */

/** Cabeçalho de empresa da versão anterior. Fora do CORS desde 05B; recusado no servidor para quem não passa por CORS. */
export const CABECALHO_LEGADO_EMPRESA = "x-farm-id";

/** Campos de empresa do contrato anterior, no corpo e na query. */
const CAMPOS_LEGADOS = new Set(["farm_id", "origin_farm_id", "destination_farm_id", "farm_ids", "farm_name", "origin_farm_name", "destination_farm_name"]);

/** Parâmetros que carregam o NOME de uma coluna como VALOR (e não como chave). */
const PARAMETROS_COM_NOME_DE_COLUNA = ["field", "sort"];

const recusar = (nome: string, onde: string): never => {
  throw new DomainError("VALIDATION_ERROR",
    `${nome} não é mais aceito ${onde}: use o contrato canônico de empresa (empresa_id, empresa_origem_id, empresa_destino_id). A API é canônica desde PRE-BASE2-05B.`);
};

/** Corpo: nome de empresa do contrato anterior em qualquer chave do nível de cima. */
export function recusarCorpoLegado(corpo: unknown): void {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return;
  for (const chave of Object.keys(corpo as Record<string, unknown>)) if (CAMPOS_LEGADOS.has(chave)) recusar(chave, "no corpo");
}

/**
 * Query: três formas de o nome antigo viajar, e as três são recusadas.
 *   • chave simples ............ `?farm_id=<uuid>`
 *   • chave de filtro .......... `?farm_id__eq=<uuid>` (o nome da coluna faz parte da CHAVE)
 *   • valor que nomeia coluna .. `?field=farm_id`, `?sort=farm_id`
 */
export function recusarQueryLegada(query: unknown): void {
  if (!query || typeof query !== "object" || Array.isArray(query)) return;
  const obj = query as Record<string, unknown>;
  for (const chave of Object.keys(obj)) {
    const corte = chave.indexOf("__");
    const campo = corte > 0 ? chave.slice(0, corte) : chave;
    if (CAMPOS_LEGADOS.has(campo)) recusar(chave, "na consulta");
  }
  for (const parametro of PARAMETROS_COM_NOME_DE_COLUNA) {
    const v = obj[parametro];
    if (typeof v === "string" && CAMPOS_LEGADOS.has(v)) recusar(`${parametro}=${v}`, "na consulta");
  }
}

/**
 * Contrato ADMINISTRATIVO achatado (`empresa_ids` como lista única de acesso).
 *
 * Não entra nos conjuntos acima porque `empresa_ids` é um nome CANÔNICO e legítimo em outro lugar: é o
 * filtro de empresas dos painéis. O que morreu em 05B é o seu uso como CONFIGURAÇÃO DE ACESSO de um membro
 * — "lista vazia = todas as empresas, em todos os módulos" —, que é justamente a semântica que a autorização
 * por CAPACIDADE × ESCOPO substituiu. Por isso a recusa é local ao endpoint administrativo, e não global:
 * o mesmo nome quer dizer coisas diferentes em lugares diferentes, e um guard global confundiria as duas.
 */
export function recusarEscopoAchatado(corpo: unknown): void {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return;
  if ("empresa_ids" in (corpo as Record<string, unknown>)) {
    throw new DomainError("VALIDATION_ERROR",
      "empresa_ids não configura mais acesso: envie escopos_empresas ([{ modulo, modo, empresas }]). O acesso é por MÓDULO desde PRE-BASE2-02, e uma lista única não consegue expressá-lo.");
  }
}
