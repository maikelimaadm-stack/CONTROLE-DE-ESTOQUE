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
 * DOIS GRAFOS, UMA REGRA (COMPRAS-02, decisão 268). Vendas (`erp.sales_documents`) e compras
 * (`erp.documentos_compra`) têm cada uma o seu grafo, e as arestas nunca atravessam de uma tabela para a
 * outra. Em vendas vale o que já valia; em compras só o pedido → compra tem serviço atrás.
 *
 * ESTE ARQUIVO NÃO EXECUTA NADA. Ele não converte documento, não cria linha, não conhece rota e não
 * conhece permissão. Habilitar uma aresta NUNCA autoriza ninguém a criar o destino: a capacidade continua
 * sendo conferida pela API, e autorização é CAPACIDADE ∧ ESCOPO — se o grafo passasse a liberar caminho,
 * a autorização viraria OR e valeria sempre pela mais frouxa.
 */
import { CODIGOS_TIPO_OPERACAO, tipoOperacao } from "./tipo-operacao.js";
import {
  familiaOperacionalDeDocumentoCompra, familiaOperacionalDeDocumentoVenda, TABELA_DOCUMENTO_COMPRA, TABELA_DOCUMENTO_VENDA,
  type EspecieDocumentoCompra
} from "./tipo-operacao-configurado.js";

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

/** As espécies que `erp.documentos_compra` persiste — o `check` da 0036, e o tipo que o domínio já declara. */
const ehEspecieDocumentoCompra = (v: string | undefined): v is EspecieDocumentoCompra => v === "pedido" || v === "compra";

/**
 * COMPRAS-02 (decisão 268): a ESPÉCIE de `erp.documentos_compra` que uma família canônica de compras É — o
 * caminho inverso de `familiaOperacionalDeDocumentoCompra`, pelo MESMO desenho de
 * `varianteDeDocumentoVendaDaFamilia`: pergunta ao registry pela origem declarada, e a família tem de voltar
 * a ser ela mesma na ida e volta. Nenhum par família → espécie está escrito aqui.
 *
 * FAIL-CLOSED: família desconhecida, de outra tabela (`compras.solicitacao` mora em `erp.purchase_requests`),
 * sem variante, ou com um valor que a coluna não persiste → `undefined`. A espécie fora da união não "passa
 * como string": o tipo de retorno promete `"pedido" | "compra"`, e quem o consome decide efeito por ele.
 */
export function varianteDeDocumentoCompraDaFamilia(codigoBase: string | null | undefined): EspecieDocumentoCompra | undefined {
  if (!codigoBase) return undefined;
  const declarada = tipoOperacao(codigoBase);
  if (!declarada || declarada.origem.tabela !== TABELA_DOCUMENTO_COMPRA) return undefined;
  const especie = declarada.origem.valor;
  if (!ehEspecieDocumentoCompra(especie)) return undefined;
  return familiaOperacionalDeDocumentoCompra(especie) === codigoBase ? especie : undefined;
}

/**
 * A TABELA COMERCIAL de que a família é variante — `erp.sales_documents` ou `erp.documentos_compra` — e
 * `undefined` para qualquer outra coisa (família desconhecida, de estoque, de financeiro, entidade inteira).
 *
 * É a pergunta que separa os dois grafos: uma aresta só existe entre documentos da MESMA tabela, porque a
 * conversão copia linhas de um documento para outro da mesma estrutura, com a mesma FK de origem. Uma venda
 * "gerada de um pedido de compra" não teria coluna onde guardar a origem, nem regra que a sustentasse.
 *
 * O endereço das duas tabelas vem de `tipo-operacao-configurado.ts`; as famílias, do registry. Só volta
 * valor quando a ida e volta fecha (`variante…DaFamilia`), senão uma família mal declarada entraria no grafo.
 */
export function tabelaComercialDaFamilia(codigoBase: string | null | undefined): string | undefined {
  if (varianteDeDocumentoVendaDaFamilia(codigoBase) !== undefined) return TABELA_DOCUMENTO_VENDA;
  if (varianteDeDocumentoCompraDaFamilia(codigoBase) !== undefined) return TABELA_DOCUMENTO_COMPRA;
  return undefined;
}

/**
 * A ÚNICA ARESTA EXECUTÁVEL EM COMPRAS, escrita em ESPÉCIES (o dado que o banco persiste), nunca em códigos de
 * família — assim ela não é uma segunda lista de famílias, e renomear a família no registry não a desfaz.
 *
 * Por que só pedido → compra (decisão 268): a COMPRA não converte — não existe rota de conversão a partir
 * dela, e ela é o fim da cadeia (dá entrada e gera a conta a pagar); o PEDIDO não nasce de conversão — é
 * lançado direto. Aceitar "compra → pedido" na configuração seria gravar um botão sem serviço atrás
 * (§11 do contrato da TOP): a política passaria, o administrador acreditaria nela, e o primeiro clique
 * do operador falharia.
 */
const ARESTA_EXECUTAVEL_EM_COMPRAS: { readonly origem: EspecieDocumentoCompra; readonly destino: EspecieDocumentoCompra } =
  Object.freeze({ origem: "pedido", destino: "compra" });

/** Por que uma aresta origem → destino foi recusada. Cada motivo vira uma recusa estável na API. */
export type RecusaDestinoOperacao =
  | { motivo: "origem_nao_executavel"; codigoBase: string }
  | { motivo: "destino_nao_executavel"; codigoBase: string }
  | { motivo: "mesma_familia"; codigoBase: string }
  /** COMPRAS-02: as pontas são documentos comerciais de TABELAS diferentes — venda × compra, nos dois sentidos. */
  | { motivo: "tabelas_diferentes" }
  /** COMPRAS-02: as duas pontas são de compras, mas o produto não executa esta aresta (só pedido → compra). */
  | { motivo: "aresta_nao_executavel"; origem: string; destino: string };

/**
 * O TETO DE COMPATIBILIDADE, derivado — o que o PRODUTO admite, antes de o cliente escolher o que habilitar.
 *
 * Quatro regras, e nenhuma delas é uma lista de famílias:
 *
 *   1. AS DUAS PONTAS PRECISAM SER EXECUTÁVEIS — documentos de uma das duas tabelas comerciais que o produto
 *      sabe criar. Configurar "deste orçamento gere uma devolução de venda" seria configurar um botão que,
 *      ao ser clicado, não tem serviço nenhum atrás. A configuração passaria, o administrador acreditaria
 *      nela, e a falha apareceria no primeiro clique do operador. Quando `vendas.devolucao` existir de
 *      verdade no registry, ela entra aqui sozinha — sem tocar neste arquivo.
 *
 *   2. AS DUAS PONTAS SÃO DA MESMA TABELA COMERCIAL (COMPRAS-02, decisão 268). Venda nunca liga com compra,
 *      em nenhum dos dois sentidos: a conversão grava a origem numa FK para a PRÓPRIA tabela, e a regra de
 *      saldo, de preço e de efeito de cada lado é outra. "Deste pedido de venda gere uma compra" seria um
 *      botão sem serviço — e, pior, um que prometeria ligar dois ledgers que o produto mantém separados.
 *
 *   3. DESTINO DE FAMÍLIA IGUAL À ORIGEM NÃO É CONVERSÃO, É CÓPIA. "Deste pedido gere outro pedido" não
 *      descreve uma etapa seguinte; descreve duplicar um documento — que é outra funcionalidade, com outras
 *      perguntas (copia os itens? o preço? mantém o vínculo?) e que esta fatia não implementa. Recusar é
 *      honesto; aceitar seria oferecer um caminho cujo comportamento ninguém definiu.
 *
 *   4. EM COMPRAS, SÓ A ARESTA QUE TEM SERVIÇO: pedido → compra (`ARESTA_EXECUTAVEL_EM_COMPRAS`). Em VENDAS
 *      esta regra não existe e nada muda: as três regras acima são exatamente as que valiam antes.
 *
 * O que NÃO está aqui, deliberadamente: nenhuma ordem obrigatória entre as famílias de VENDAS. Orçamento
 * pode apontar direto para venda, pulando o pedido, porque isso é decisão da organização — e era exatamente
 * o que a cadeia fixa no código impedia. Compras tem uma aresta só porque só uma tem serviço atrás; quando
 * outra ganhar serviço (solicitação → pedido, por exemplo), ela entra na regra 4, não numa lista.
 */
export function validarDestinoOperacao(origemCodigoBase: string, destinoCodigoBase: string): RecusaDestinoOperacao[] {
  const recusas: RecusaDestinoOperacao[] = [];
  const tabelaOrigem = tabelaComercialDaFamilia(origemCodigoBase);
  const tabelaDestino = tabelaComercialDaFamilia(destinoCodigoBase);
  if (!tabelaOrigem) {
    recusas.push({ motivo: "origem_nao_executavel", codigoBase: origemCodigoBase });
  }
  if (!tabelaDestino) {
    recusas.push({ motivo: "destino_nao_executavel", codigoBase: destinoCodigoBase });
  }
  if (tabelaOrigem && tabelaDestino && tabelaOrigem !== tabelaDestino) {
    recusas.push({ motivo: "tabelas_diferentes" });
  }
  if (origemCodigoBase === destinoCodigoBase) {
    recusas.push({ motivo: "mesma_familia", codigoBase: destinoCodigoBase });
  } else if (tabelaOrigem === TABELA_DOCUMENTO_COMPRA && tabelaDestino === TABELA_DOCUMENTO_COMPRA) {
    const origem = varianteDeDocumentoCompraDaFamilia(origemCodigoBase);
    const destino = varianteDeDocumentoCompraDaFamilia(destinoCodigoBase);
    if (origem !== ARESTA_EXECUTAVEL_EM_COMPRAS.origem || destino !== ARESTA_EXECUTAVEL_EM_COMPRAS.destino) {
      recusas.push({ motivo: "aresta_nao_executavel", origem: origemCodigoBase, destino: destinoCodigoBase });
    }
  }
  return recusas;
}

/**
 * A FAMÍLIA PODE TER PRÓXIMAS OPERAÇÕES? — existe ao menos UM destino que o teto de compatibilidade admite.
 *
 * DERIVADA, e não uma segunda lista: pergunta a `validarDestinoOperacao` por cada família do registry. Hoje
 * responde sim para as três de vendas (qualquer uma aponta para outra) e para o pedido de compra (aponta para
 * a compra); não para a compra, que é o fim da cadeia, nem para família desconhecida — fail-closed, lista
 * vazia e nunca "todas". Uma família nova com serviço de conversão entra aqui sozinha, pela regra do grafo.
 *
 * É a porta de `/destinos-possiveis`: origem sem destino possível não abre consulta nenhuma.
 */
export function familiaTemProximasOperacoes(codigoBase: string | null | undefined): boolean {
  if (!codigoBase || tabelaComercialDaFamilia(codigoBase) === undefined) return false;
  return CODIGOS_TIPO_OPERACAO.some((destino) => validarDestinoOperacao(codigoBase, destino).length === 0);
}

/** Um destino declarado por uma versão, como o cliente o envia e como a API o devolve. */
export interface DestinoOperacaoV1 {
  /** Identidade ESTÁVEL da TOP de destino. Nunca a versão dela: ver o cabeçalho deste arquivo. */
  readonly tipoOperacaoId: string;
  /** Ordem de APRESENTAÇÃO. Sem significado de negócio; existe para o leque não sair do acaso do insert. */
  readonly ordem: number;
  /**
   * "Em partes" (TOP-CONFIG-06, decisão 265): o documento pode ser convertido várias vezes para este destino,
   * escolhendo itens e quantidades. AUSENTE na entrada = "não declarado": a API preserva o valor da versão
   * atual para o mesmo destino (aresta nova: falso). Depois de resolvido, sempre booleano.
   */
  readonly emPartes?: boolean;
}

export type RecusaListaDestinos =
  | { motivo: "forma_invalida" }
  | { motivo: "excede_limite"; limite: number }
  | { motivo: "destino_duplicado"; tipoOperacaoId: string }
  | { motivo: "id_invalido"; posicao: number }
  | { motivo: "ordem_invalida"; posicao: number }
  | { motivo: "em_partes_invalido"; posicao: number };

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
      if (chave !== "tipoOperacaoId" && chave !== "ordem" && chave !== "emPartes") {
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
    if (saco.emPartes !== undefined && typeof saco.emPartes !== "boolean") {
      recusas.push({ motivo: "em_partes_invalido", posicao });
      return;
    }
    if (vistos.has(id)) {
      recusas.push({ motivo: "destino_duplicado", tipoOperacaoId: id });
      return;
    }
    vistos.add(id);
    lidos.push(saco.emPartes === undefined ? { tipoOperacaoId: id, ordem } : { tipoOperacaoId: id, ordem, emPartes: saco.emPartes });
  });

  if (recusas.length > 0) return { ok: false, recusas };

  const ordenados = [...lidos].sort((a, b) => (a.ordem - b.ordem) || a.tipoOperacaoId.localeCompare(b.tipoOperacaoId));
  return { ok: true, valor: ordenados.map((d, i) => (d.emPartes === undefined ? { tipoOperacaoId: d.tipoOperacaoId, ordem: i } : { tipoOperacaoId: d.tipoOperacaoId, ordem: i, emPartes: d.emPartes })) };
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
  // "Em partes" é parte da política: mudar só a caixa cria versão nova. Ausente conta como falso.
  return a.every((x, i) => x.tipoOperacaoId === b[i]!.tipoOperacaoId && x.ordem === b[i]!.ordem && Boolean(x.emPartes) === Boolean(b[i]!.emPartes));
}
