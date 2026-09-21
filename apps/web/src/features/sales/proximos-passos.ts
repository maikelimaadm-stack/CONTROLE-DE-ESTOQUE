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
 * │ LISTA VAZIA DECLARADA É RESPOSTA: o documento não oferece conversão. Cair na cadeia antiga aí    │
 * │ seria transformar ausência de política em política — exatamente o que a fatia veio desfazer.     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE A CARDINALIDADE NÃO DECIDE NADA (correção R1) ────────────────────────────────────────┐
 * │ `items: []` tem DUAS histórias, e a lista sozinha não distingue uma da outra: ou ninguém nunca  │
 * │ declarou a política desta operação (acervo legado, em que a conversão segue a cadeia anterior), │
 * │ ou alguém declarou explicitamente que ela NÃO gera próxima operação. Tratar as duas como a      │
 * │ mesma coisa foi o defeito: a web escondia a conversão de documentos cuja API ainda convertia    │
 * │ pela ponte — tela e servidor discordando sobre o mesmo documento.                                │
 * │                                                                                                  │
 * │ Quem responde é `politicaConfigurada`, o discriminador que o servidor declara. A lista informa o │
 * │ QUE pode ser gerado; o booleano informa SE a pergunta já foi respondida por alguém.              │
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

/**
 * `politicaConfigurada` é OPCIONAL na leitura, e isso é medido, não descuido.
 *
 * A API desta correção a declara sempre, sob o MESMO `contractVersion: 1` (ela acrescenta informação, não
 * muda o significado de nada que já existia). Um servidor da fatia anterior serve a rota sem o campo — e
 * recusar o corpo inteiro por causa disso seria a pior das trocas: o documento com destinos configurados
 * perderia o leque do grafo e cairia na ponte, cuja escolha AQUELE servidor recusa com 422. Ausência vira
 * `null`, que é "este servidor não respondeu essa pergunta", e nunca `false`, que seria afirmar por ele.
 */
export const ehRespostaDeProximosPassos = (v: unknown): v is { contractVersion: typeof CONTRATO_PROXIMOS_PASSOS; politicaConfigurada?: boolean; items: ProximoPasso[] } =>
  ehObjeto(v) && v.contractVersion === CONTRATO_PROXIMOS_PASSOS
  && (v.politicaConfigurada === undefined || typeof v.politicaConfigurada === "boolean")
  && Array.isArray(v.items) && v.items.every(ehProximoPasso);

export type EstadoProximosPassos =
  /** Ainda perguntando — nenhuma ação de conversão é oferecida enquanto não se sabe. */
  | { situacao: "carregando" }
  /** Rota ausente, servidor com defeito ou corpo que não é o contrato 1: cai na cadeia de compatibilidade. */
  | { situacao: "nao-confirmado" }
  /**
   * A política chegou.
   *
   * `politicaConfigurada`: `true` = declarada (a lista É a política, inclusive vazia); `false` = nunca
   * declarada (legado, a ponte vale); `null` = o servidor não informou (API anterior a esta correção).
   */
  | { situacao: "pronto"; politicaConfigurada: boolean | null; itens: ProximoPasso[] };

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
  return { situacao: "pronto", politicaConfigurada: q.data.politicaConfigurada ?? null, itens: q.data.items };
}

/**
 * A CADEIA ANTERIOR AINDA VALE PARA ESTE DOCUMENTO?
 *
 * Uma pergunta, um lugar. A tela não pode responder isso com uma escada de `if` própria — foi assim que a
 * versão anterior acabou lendo "lista vazia" como "nenhuma conversão" para TODO documento, inclusive os
 * que o servidor ainda converte pela ponte.
 *
 *   carregando      não. Enquanto não se sabe, nada é oferecido — nem o grafo, nem a ponte.
 *   não confirmado  sim. Rota ausente ou corpo desconhecido: volta ao comportamento anterior à fatia.
 *   declarada       não. A lista é a política, e vazia significa "não gera próxima operação".
 *   não declarada   sim. É o acervo legado, que a API converte pela ponte — e a tela oferece o mesmo.
 *   não informada   espelha o próprio servidor que respondeu: sem discriminador, o que a API anterior faz
 *                   é usar o grafo quando ele existe e a ponte quando ele está vazio. Isto NÃO é inferir
 *                   política pela cardinalidade: é reproduzir, sem adivinhar, a regra do servidor que está
 *                   do outro lado — que é a única coisa que se sabe dele.
 */
export function usaCadeiaDeCompatibilidade(e: EstadoProximosPassos): boolean {
  if (e.situacao === "carregando") return false;
  if (e.situacao === "nao-confirmado") return true;
  if (e.politicaConfigurada !== null) return !e.politicaConfigurada;
  return e.itens.length === 0;
}

/**
 * A CADEIA DE COMPATIBILIDADE — e por que ela ainda existe, escrita, neste arquivo.
 *
 * Isto é a política ANTERIOR (orçamento gera pedido, pedido gera venda), e ela NÃO é fonte de verdade
 * de coisa nenhuma: só é consultada quando `usaCadeiaDeCompatibilidade` diz que a ponte vale — servidor
 * que não confirmou o contrato, ou operação cuja política NUNCA foi declarada. Este segundo caso é o
 * acervo de hoje (toda TOP nasceu sem grafo) e é exatamente o que a API faz com ele: converter pela
 * cadeia anterior. Declarada a política, nem a tela nem a API voltam aqui — para aquela operação.
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
