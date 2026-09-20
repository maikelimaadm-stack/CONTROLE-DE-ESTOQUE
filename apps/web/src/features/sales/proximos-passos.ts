"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { varianteDeVenda, type VarianteDeVenda } from "./variantes";

/**
 * OS PRÓXIMOS PASSOS DE UM DOCUMENTO — O QUE ELE PODE GERAR, SEGUNDO A POLÍTICA QUE ELE CITA.
 *
 * ┌─ O QUE MUDA EM RELAÇÃO À CADEIA FIXA ──────────────────────────────────────────────────────────┐
 * │ Até aqui a tela sabia, por escrito, que orçamento vira pedido e pedido vira venda. Isso era uma │
 * │ política de negócio morando no cliente: uma organização que não trabalha com orçamento, ou que  │
 * │ converte orçamento direto em venda, via um botão que o produto não deveria oferecer. Agora a     │
 * │ política sai da VERSÃO da TOP de origem (congelada no documento) e chega pronta do servidor,     │
 * │ já ordenada e já filtrada pelas TOPs de destino ativas.                                          │
 * │                                                                                                  │
 * │ LISTA VAZIA É RESPOSTA: o documento não oferece conversão. Cair na cadeia antiga aqui seria      │
 * │ transformar ausência de política em política — exatamente o que a fatia veio desfazer.           │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CAPABILITY: ROLLING DEPLOY ───────────────────────────────────────────────────────────────────┐
 * │ Durante a janela de implantação, a web NOVA conversa com a API ANTIGA. Lá não existe a rota      │
 * │ `/proximos-passos`: o nó paramétrico `${base}/:id` casa "proximos-passos" como id, o SQL recebe  │
 * │ a string numa coluna `uuid` e a resposta é 404 ou 500 — os mesmos dois modos medidos em          │
 * │ `tipo-operacao-select.tsx`. E um 200 de formato desconhecido é o modo de falha mais perigoso,     │
 * │ porque PARECE sucesso; por isso `contractVersion` é conferido antes de qualquer leitura.         │
 * │                                                                                                  │
 * │ Nesses casos o veredito é NÃO CONFIRMADO, e a tela cai no comportamento anterior (a cadeia de    │
 * │ compatibilidade abaixo) em vez de esconder a conversão de quem ainda depende dela. Note a        │
 * │ diferença com a capability da TOP: lá o não-confirmado BLOQUEIA a escrita, porque arriscar       │
 * │ gravaria um documento sem tipo; aqui ele DEGRADA para a política anterior, porque a conversão    │
 * │ continua sendo validada pelo servidor (que recusa com 422 o destino que não puder aceitar).      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** A ÚNICA versão de contrato que esta tela sabe ler. O servidor a declara em `/proximos-passos`. */
export const CONTRATO_PROXIMOS_PASSOS = 1 as const;

export interface ProximoPasso {
  tipoOperacaoId: string; codigo: string; nome: string;
  codigoBase: string; familiaRotulo: string; variante: string; ordem: number;
}

const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Um passo só é aceito INTEIRO: item pela metade viraria botão com rótulo vazio ou destino indefinido. */
const ehProximoPasso = (v: unknown): v is ProximoPasso =>
  ehObjeto(v) && ehTexto(v.tipoOperacaoId) && ehTexto(v.codigo) && ehTexto(v.nome)
  && ehTexto(v.codigoBase) && ehTexto(v.familiaRotulo) && ehTexto(v.variante)
  && typeof v.ordem === "number" && Number.isFinite(v.ordem);

export const ehRespostaDeProximosPassos = (v: unknown): v is { contractVersion: typeof CONTRATO_PROXIMOS_PASSOS; items: ProximoPasso[] } =>
  ehObjeto(v) && v.contractVersion === CONTRATO_PROXIMOS_PASSOS && Array.isArray(v.items) && v.items.every(ehProximoPasso);

export type EstadoProximosPassos =
  /** Ainda perguntando — nenhuma ação de conversão é oferecida enquanto não se sabe. */
  | { situacao: "carregando" }
  /** Rota ausente, servidor com defeito ou corpo que não é o contrato 1: cai na cadeia de compatibilidade. */
  | { situacao: "nao-confirmado" }
  /** A política chegou. `itens` vazio significa "este documento não gera nada". */
  | { situacao: "pronto"; itens: ProximoPasso[] };

/**
 * Pergunta ao servidor o que este documento pode gerar.
 *
 * `retry: false` pelo mesmo motivo da capability da TOP: 404 e 500 aqui são RESPOSTA (a API não tem a
 * rota), não falha transitória — insistir só atrasaria a decisão da tela.
 *
 * QUALQUER erro cai em "não confirmado". A capacidade exigida é `<variante>.view`, a mesma que já foi
 * cobrada para abrir o documento: um 403 aqui não descreve o usuário, descreve o servidor — e inventar
 * um terceiro estado para um caso que não deveria existir seria enfeitar a tela com uma mensagem que
 * ninguém sabe o que significa.
 */
export function useProximosPassos(segmento: string, id: string, habilitado = true): EstadoProximosPassos {
  // `unknown` DE PROPÓSITO: o corpo só vira contrato depois de CONFERIDO, nunca por asserção.
  const q = useQuery<unknown, ApiError>({
    queryKey: ["sales-proximos-passos", segmento, id],
    queryFn: () => api<unknown>(`/api/sales/${segmento}/${id}/proximos-passos`),
    enabled: habilitado && Boolean(segmento && id),
    retry: false
  });
  if (!habilitado || q.isPending) return { situacao: "carregando" };
  if (q.error) return { situacao: "nao-confirmado" };
  if (!ehRespostaDeProximosPassos(q.data)) return { situacao: "nao-confirmado" };
  return { situacao: "pronto", itens: q.data.items };
}

/**
 * A CADEIA DE COMPATIBILIDADE — e por que ela ainda existe, escrita, neste arquivo.
 *
 * Isto é a política ANTERIOR (orçamento gera pedido, pedido gera venda), e ela NÃO é fonte de verdade
 * de coisa nenhuma: só é consultada quando o servidor não confirmou o contrato de próximos passos,
 * durante a janela de rolling deploy. Com a API nova em produção, nenhuma tela chega aqui.
 *
 * Ela fica em UM lugar, nomeada pelo que é, em vez de espalhada pelo campo `proximo` do mapa de
 * variantes — onde parecia (e era lida como) configuração do produto. Quando a API nova estiver
 * publicada em todos os ambientes, apagar este bloco é a remoção INTEIRA da cadeia fixa do web.
 *
 * NÃO é a "segunda lista de famílias" que o gate proíbe: não há código canônico de família aqui, e sim
 * o par de ARESTAS que o produto oferecia antes do grafo. O rótulo do destino continua vindo do
 * registry, via `variantesDeVenda`.
 */
const ARESTAS_DE_COMPATIBILIDADE: Record<string, string> = { budget: "order", order: "sale" };

/** O destino que a política anterior oferecia para esta variante — ou nenhum. */
export const destinoDeCompatibilidade = (variante: string): VarianteDeVenda | undefined =>
  varianteDeVenda(ARESTAS_DE_COMPATIBILIDADE[variante] ?? "");
