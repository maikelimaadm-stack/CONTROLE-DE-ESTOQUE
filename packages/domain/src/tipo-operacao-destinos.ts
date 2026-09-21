/**
 * PRÓXIMAS OPERAÇÕES — O GRAFO VERSIONADO DE TRANSIÇÕES ENTRE TOPs (TOP-CONFIG-03).
 *
 * Até aqui, "o que este documento pode virar" era uma constante do produto: `FLOW` em `sales.ts` diz que
 * orçamento vira pedido e pedido vira venda, e a tela repete a mesma cadeia em dois literais próprios. Isso
 * é política de NEGÓCIO escrita em código: a organização que quisesse lançar venda direto de um orçamento,
 * ou que quisesse dois tipos de pedido diferentes a partir do mesmo orçamento, precisava de um release.
 *
 * O grafo devolve essa decisão para quem configura a operação. Uma VERSÃO da TOP de origem declara para
 * quais TOPs (identidade estável) um documento dela pode ser convertido, e a tabela
 * `erp.tipos_operacao_versao_destinos` (0022) guarda as arestas com integridade referencial de verdade.
 *
 * ┌─ AS DUAS PERGUNTAS QUE NÃO PODEM TER A MESMA RESPOSTA ──────────────────────────────────────────────┐
 * │ "QUE POLÍTICA VALIA?"      → a VERSÃO que o documento cita (0021). Congelada. É história.           │
 * │ "O DESTINO SERVE AGORA?"   → a TOP de destino, no estado de HOJE. Avaliada na ação. É presente.     │
 * │                                                                                                      │
 * │ Misturar as duas é o erro caro nos dois sentidos: ler a política do cadastro atual faz a edição de   │
 * │ hoje mudar retroativamente o que um documento de ontem podia virar; congelar a VERSÃO do destino faz │
 * │ o documento novo nascer sob uma regra que o administrador já corrigiu.                               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ESTE ARQUIVO NÃO EXECUTA NADA. Ele não converte documento, não cria linha, não conhece rota e não
 * conhece permissão. Habilitar uma aresta NUNCA autoriza ninguém a criar o destino: a capacidade continua
 * sendo conferida pela API, e autorização é CAPACIDADE ∧ ESCOPO — se o grafo passasse a liberar caminho,
 * a autorização viraria OR e valeria sempre pela mais frouxa.
 */
import { tipoOperacao } from "./tipo-operacao.js";
import { familiaOperacionalDeDocumentoVenda, TABELA_DOCUMENTO_VENDA } from "./tipo-operacao-configurado.js";

/** Quantos destinos uma versão pode declarar. Teto de sanidade, não regra de negócio. */
export const LIMITE_DESTINOS_POR_VERSAO = 20;

/**
 * A VARIANTE de `erp.sales_documents` que uma família canônica de vendas É — o caminho inverso de
 * `familiaOperacionalDeDocumentoVenda`.
 *
 * NÃO É A SEGUNDA LISTA QUE O CONTRATO PROÍBE. A segunda lista seria escrever
 * `{ "vendas.orcamento": "budget", ... }` aqui: uma cópia que envelheceria em silêncio na primeira família
 * nova. Esta função PERGUNTA ao registry pela origem declarada da família e devolve o valor do
 * discriminador que o próprio registry guarda — a mesma fonte que o sentido direto usa.
 *
 * FAIL-CLOSED e, mais do que isso, ESPECÍFICA: devolve `undefined` para família desconhecida, para família
 * que não é de documento de venda (`estoque.baixa` tem origem em outra tabela) e para família declarada
 * como entidade inteira, sem variante. Só volta um valor quando o produto de fato sabe criar aquele
 * documento — que é exatamente a pergunta que o grafo precisa fazer antes de aceitar um destino.
 */
export function varianteDeDocumentoVendaDaFamilia(codigoBase: string | null | undefined): string | undefined {
  if (!codigoBase) return undefined;
  const declarada = tipoOperacao(codigoBase);
  if (!declarada || declarada.origem.tabela !== TABELA_DOCUMENTO_VENDA) return undefined;
  const variante = declarada.origem.valor;
  if (!variante) return undefined;
  // Ida e volta pelo registry: a família tem de voltar a ser ela mesma. Se o registry algum dia declarasse
  // duas famílias com o mesmo valor de discriminador, o sentido inverso seria ambíguo — e ambiguidade aqui
  // classificaria um documento como a operação errada, que é pior do que recusar.
  return familiaOperacionalDeDocumentoVenda(variante) === codigoBase ? variante : undefined;
}

/** O produto sabe CRIAR um documento desta família de vendas? */
export const familiaExecutavelEmVendas = (codigoBase: string | null | undefined): boolean =>
  varianteDeDocumentoVendaDaFamilia(codigoBase) !== undefined;

/** Por que uma aresta origem → destino foi recusada. Cada motivo vira uma recusa estável na API. */
export type RecusaDestinoOperacao =
  | { motivo: "origem_nao_executavel"; codigoBase: string }
  | { motivo: "destino_nao_executavel"; codigoBase: string }
  | { motivo: "mesma_familia"; codigoBase: string };

/**
 * O TETO DE COMPATIBILIDADE, derivado — o que o PRODUTO admite, antes de o cliente escolher o que habilitar.
 *
 * Duas regras, e nenhuma delas é uma lista:
 *
 *   1. AS DUAS PONTAS PRECISAM SER EXECUTÁVEIS. Configurar "deste orçamento gere uma devolução de venda"
 *      seria configurar um botão que, ao ser clicado, não tem serviço nenhum atrás. A configuração passaria,
 *      o administrador acreditaria nela, e a falha apareceria no primeiro clique do operador. Quando
 *      `vendas.devolucao` existir de verdade no registry, ela entra aqui sozinha — sem tocar neste arquivo.
 *
 *   2. DESTINO DE FAMÍLIA IGUAL À ORIGEM NÃO É CONVERSÃO, É CÓPIA. "Deste pedido gere outro pedido" não
 *      descreve uma etapa seguinte; descreve duplicar um documento — que é outra funcionalidade, com outras
 *      perguntas (copia os itens? o preço? mantém o vínculo?) e que esta fatia não implementa. Recusar é
 *      honesto; aceitar seria oferecer um caminho cujo comportamento ninguém definiu.
 *
 * O que NÃO está aqui, deliberadamente: nenhuma ordem obrigatória entre as famílias. Orçamento pode apontar
 * direto para venda, pulando o pedido, porque isso é decisão da organização — e era exatamente o que a
 * cadeia fixa no código impedia.
 */
export function validarDestinoOperacao(origemCodigoBase: string, destinoCodigoBase: string): RecusaDestinoOperacao[] {
  const recusas: RecusaDestinoOperacao[] = [];
  if (!familiaExecutavelEmVendas(origemCodigoBase)) {
    recusas.push({ motivo: "origem_nao_executavel", codigoBase: origemCodigoBase });
  }
  if (!familiaExecutavelEmVendas(destinoCodigoBase)) {
    recusas.push({ motivo: "destino_nao_executavel", codigoBase: destinoCodigoBase });
  }
  if (origemCodigoBase === destinoCodigoBase) {
    recusas.push({ motivo: "mesma_familia", codigoBase: destinoCodigoBase });
  }
  return recusas;
}

/** Um destino declarado por uma versão, como o cliente o envia e como a API o devolve. */
export interface DestinoOperacaoV1 {
  /** Identidade ESTÁVEL da TOP de destino. Nunca a versão dela: ver o cabeçalho deste arquivo. */
  readonly tipoOperacaoId: string;
  /** Ordem de APRESENTAÇÃO. Sem significado de negócio; existe para o leque não sair do acaso do insert. */
  readonly ordem: number;
}

export type RecusaListaDestinos =
  | { motivo: "forma_invalida" }
  | { motivo: "excede_limite"; limite: number }
  | { motivo: "destino_duplicado"; tipoOperacaoId: string }
  | { motivo: "id_invalido"; posicao: number }
  | { motivo: "ordem_invalida"; posicao: number };

const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResultadoDestinos =
  | { ok: true; valor: DestinoOperacaoV1[] }
  | { ok: false; recusas: RecusaListaDestinos[] };

/**
 * Lê e NORMALIZA a lista de destinos que o cliente enviou.
 *
 * A normalização é determinística e é o que impede versão falsa: a mesma política enviada em outra ordem,
 * ou com a mesma `ordem` repetida, tem de produzir exatamente a mesma lista — senão salvar duas vezes sem
 * mudar nada criaria a versão N+1, e o histórico passaria a registrar edições que não existiram.
 *
 * Ordena por `ordem` e desempata pelo id, que é estável. Depois REESCREVE `ordem` como 0..n-1: a posição
 * relativa é o que o administrador declarou; o número absoluto é detalhe de armazenamento, e guardar
 * `[0, 5, 17]` faria duas listas idênticas na intenção parecerem diferentes.
 *
 * O que esta função NÃO faz: conferir se a TOP existe, se é deste tenant, se está ativa e se a família é
 * compatível. Nada disso é respondível sem o banco e sem o registry da linha — é trabalho da borda de
 * escrita, onde a recusa é uniforme.
 */
export function lerDestinosOperacao(bruta: unknown): ResultadoDestinos {
  if (bruta === null || bruta === undefined) return { ok: true, valor: [] };
  if (!Array.isArray(bruta)) return { ok: false, recusas: [{ motivo: "forma_invalida" }] };

  const recusas: RecusaListaDestinos[] = [];
  if (bruta.length > LIMITE_DESTINOS_POR_VERSAO) {
    recusas.push({ motivo: "excede_limite", limite: LIMITE_DESTINOS_POR_VERSAO });
  }

  const lidos: DestinoOperacaoV1[] = [];
  const vistos = new Set<string>();
  bruta.forEach((item, posicao) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      recusas.push({ motivo: "id_invalido", posicao });
      return;
    }
    const saco = item as Record<string, unknown>;
    // ENTRADA ESTRITA: chave desconhecida é RECUSA, não descarte. Um editor que mandasse `{ id }` em vez de
    // `{ tipoOperacaoId }` receberia 200 com a lista vazia, e o administrador leria "salvo" sobre uma
    // política que não existe.
    for (const chave of Object.keys(saco)) {
      if (chave !== "tipoOperacaoId" && chave !== "ordem") {
        recusas.push({ motivo: "id_invalido", posicao });
        return;
      }
    }
    const id = saco.tipoOperacaoId;
    if (typeof id !== "string" || !FORMA_UUID.test(id)) {
      recusas.push({ motivo: "id_invalido", posicao });
      return;
    }
    const ordem = saco.ordem === undefined ? posicao : saco.ordem;
    if (typeof ordem !== "number" || !Number.isInteger(ordem) || ordem < 0) {
      recusas.push({ motivo: "ordem_invalida", posicao });
      return;
    }
    if (vistos.has(id)) {
      recusas.push({ motivo: "destino_duplicado", tipoOperacaoId: id });
      return;
    }
    vistos.add(id);
    lidos.push({ tipoOperacaoId: id, ordem });
  });

  if (recusas.length > 0) return { ok: false, recusas };

  const ordenados = [...lidos].sort((a, b) => (a.ordem - b.ordem) || a.tipoOperacaoId.localeCompare(b.tipoOperacaoId));
  return { ok: true, valor: ordenados.map((d, i) => ({ tipoOperacaoId: d.tipoOperacaoId, ordem: i })) };
}

/**
 * Duas políticas de destino são a MESMA?
 *
 * É a pergunta do no-op, e ela é semântica: compara a SEQUÊNCIA normalizada, porque a ordem É parte da
 * política (o administrador decidiu o que aparece primeiro). Comparar como conjunto faria reordenar o leque
 * passar despercebido; comparar o JSON cru faria a mesma lista em outra ordem de chaves criar versão falsa.
 */
export function destinosOperacaoIguais(a: readonly DestinoOperacaoV1[], b: readonly DestinoOperacaoV1[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.tipoOperacaoId === b[i]!.tipoOperacaoId && x.ordem === b[i]!.ordem);
}
