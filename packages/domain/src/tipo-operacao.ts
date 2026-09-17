import { ptBR } from "@erp/plataforma";
import { CHAVES_MODULO_EMPRESA } from "./escopo-permissao.js";

/**
 * REGISTRY CANÔNICO DE TIPO DE OPERAÇÃO (TOP) — CONFIGURAÇÃO DESTE PRODUTO (BASE2-02).
 *
 * TOP é a CLASSIFICAÇÃO FUNCIONAL de um lançamento: ela responde "que operação é esta?" e nada mais.
 * Até esta fatia, a resposta existia como PROSA — dez strings em português dentro do dicionário de dados
 * (`top: "Entrada de estoque sem documento fiscal"`), sem chave, sem unicidade, sem validação e sem
 * ninguém que as lesse. Duas delas traziam DUAS ou TRÊS operações espremidas numa frase só
 * ("Conta a pagar / Conta a receber"), que é a forma mais silenciosa de perder uma distinção real.
 *
 * ┌─ CLASSIFICAR ≠ EXECUTAR ─────────────────────────────────────────────────────────────────────┐
 * │ A TOP DIZ quem o lançamento é. Ela NÃO decide o que ele FAZ.                                  │
 * │ Efeito de estoque, geração financeira, tratamento fiscal, contabilização, endpoint, serviço,  │
 * │ permissão, validação de campo, transação, cancelamento e confirmação continuam, sem exceção,  │
 * │ nos donos atuais — a rota, o service, o `runService`, o schema zod, o catálogo de permissões. │
 * │ Por isso este arquivo não tem função de efeito, nem handler, nem endpoint, nem permission key:│
 * │ um registry que soubesse executar seria o motor genérico que `docs/PRE-BASE2-FOUNDATION.md`   │
 * │ §4 proíbe criar cedo demais, e viraria acoplamento irreversível.                              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * **Tela unificada ≠ regra de negócio unificada.** A moldura do Modelo Base 2 mostra a mesma estrutura
 * para sete documentos de estoque; isso não funde as sete regras, e a TOP não é a porta por onde elas
 * seriam fundidas.
 *
 * ONDE O TEXTO MORA: aqui não. O registry guarda a CHAVE de tradução (`chaveI18n`); o rótulo em pt-BR
 * mora no catálogo (`packages/plataforma/src/idiomas/pt-BR.ts`), que é a fonte única de texto da
 * interface. Guardar um `rotulo` literal AQUI criaria dois textos para o mesmo conceito, e o segundo
 * envelheceria em silêncio — exatamente o modo de falhar que `.claude/rules/architecture.md` nomeia.
 *
 * FAIL-CLOSED: tabela sem TOP declarada e variante desconhecida devolvem `undefined`. Nunca existe
 * queda para a TOP vizinha, para a primeira variante da tabela nem para um padrão: classificar errado
 * é pior que não classificar, porque a tela passaria a afirmar com confiança uma operação que não é a
 * do registro.
 *
 * Contrato: `docs/TIPO-OPERACAO-CONTRACT.md`.
 */

/**
 * ORIGEM de uma TOP: o registro que ela classifica.
 *
 * `tabela` é sempre canônica e qualificada (`erp.<nome>`). `discriminador` e `valor` andam JUNTOS e
 * descrevem a VARIANTE — a coluna que decide qual operação aquele registro é, e o valor exato, como o
 * banco o persiste (nunca traduzido: `financial_titles.direction = "payable"`, não "a pagar").
 *
 * Tabela sem variante tem os dois ausentes. Um sem o outro é registry quebrado, e o gate reprova:
 * discriminador sem valor não seleciona nada, e valor sem discriminador não diz onde procurar.
 */
export interface OrigemTipoOperacao {
  /** Tabela canônica do registro classificado, com schema: `erp.input_entries`. */
  readonly tabela: string;
  /** Coluna que decide a variante. Ausente quando a tabela inteira é uma operação só. */
  readonly discriminador?: string;
  /** Valor persistido do discriminador, exatamente como está no banco. */
  readonly valor?: string;
}

/**
 * Uma TOP declarada.
 *
 * Nada aqui executa: são quatro dados de IDENTIDADE. Se um campo novo algum dia decidisse efeito,
 * endpoint ou permissão, ele pertenceria a outro contrato — e o teste `sem campo de execução` deste
 * registry reprova a tentativa.
 */
export interface TipoOperacao {
  /**
   * Chave canônica, estável e única: `<modulo>.<operacao>`, minúsculas e `_`.
   * É a identidade da TOP no código, em teste e no dicionário — nunca um rótulo humano, que muda com
   * revisão de texto e com idioma.
   */
  readonly codigo: string;
  /** Módulo dono da operação. Chave de `MODULOS_ESCOPO_EMPRESA` — o mesmo vocabulário do escopo de empresa. */
  readonly modulo: string;
  /** Chave de tradução do nome funcional, no catálogo oficial. Derivada do código: `top.<codigo>`. */
  readonly chaveI18n: string;
  /** Que registro esta TOP classifica. */
  readonly origem: OrigemTipoOperacao;
}

/** Prefixo obrigatório das chaves de tradução das TOPs. Fixa o namespace e evita colisão com outros termos. */
export const PREFIXO_I18N_TIPO_OPERACAO = "top.";

/** Forma canônica do código: `<modulo>.<operacao>`, sem maiúscula, sem hífen, sem acento. */
const CODIGO_CANONICO = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * Construtor. `chaveI18n` é DERIVADA do código de propósito: se fosse digitada, um erro de grafia
 * produziria uma tela mostrando a chave crua em vez do rótulo, e o registry pareceria correto.
 */
const T = (codigo: string, modulo: string, origem: OrigemTipoOperacao): TipoOperacao => Object.freeze({
  codigo,
  modulo,
  chaveI18n: `${PREFIXO_I18N_TIPO_OPERACAO}${codigo}`,
  origem: Object.freeze(origem)
});

/** Tabela inteira é uma operação só. */
const entidade = (tabela: string): OrigemTipoOperacao => Object.freeze({ tabela });
/** Tabela com variantes: a coluna decide qual operação o registro é. */
const variante = (tabela: string, discriminador: string, valor: string): OrigemTipoOperacao => Object.freeze({ tabela, discriminador, valor });

/**
 * AS TOPs DECLARADAS.
 *
 * Cobertura deliberadamente PARCIAL: entra o que já tem classificação segura — os sete documentos de
 * estoque do piloto do Modelo Base 2, e as entidades que o dicionário já classificava em prosa. Entidade
 * que não se sabe classificar NÃO entra: uma TOP inventada é pior que ausência, porque a ausência se vê.
 *
 * Nunca recebem TOP: linha de item (`input_entry_items`), infraestrutura (`audit_logs`,
 * `code_sequences`) e consequência de lançamento — `stock_movements` é o caso a ter na cabeça: é o
 * EFEITO de uma operação, não uma operação (`dicionario-dados.mjs`: "Não é lançamento: é consequência
 * contábil de um").
 */
export const TIPOS_OPERACAO: readonly TipoOperacao[] = Object.freeze([
  // ---------- Estoque — os sete documentos do piloto Base 2 ----------
  T("estoque.entrada_manual", "estoque", entidade("erp.input_entries")),
  // NEUTRA DE PROPÓSITO. `erp.invoices` guarda NOVE tipos de documento
  // (check (document_type in ('nfe','cte','nfse','nfce','danfe','darf','dare','gru','other'))), e nem
  // todos dão entrada de estoque: um DARF é guia de tributo, um CT-e é frete. A classificação anterior,
  // "Entrada por documento fiscal", afirmava o EFEITO de alguns tipos como se fosse a identidade de
  // todos — e a partir da BASE2-02 isso aparece na TELA, então deixou de ser imprecisão tolerável.
  // A TOP responde O QUE O REGISTRO É, não o que alguns dos seus tipos produzem: é um documento fiscal.
  // Separar em nove seria inventar operação a partir de sigla, que o contrato proíbe (§9).
  T("estoque.documento_fiscal", "estoque", entidade("erp.invoices")),
  T("estoque.requisicao", "estoque", entidade("erp.requisitions")),
  T("estoque.baixa", "estoque", entidade("erp.stock_writeoffs")),
  T("estoque.devolucao", "estoque", entidade("erp.devolutions")),
  // A transferência tem DUAS operações numa tabela só: `kind` decide se o estoque muda de armazém dentro
  // da mesma empresa ou ATRAVESSA a fronteira de empresa. Colapsar as duas apagaria justamente a
  // distinção que o contrato multiempresa existe para proteger. O valor `farm` é o dado como o banco o
  // persiste (`check (kind in ('warehouse','farm'))`, 0003_stock_supply.sql) — nome herdado do nicho
  // anterior, que é DADO e sai por governança de dados, não por renomeação de chave nossa.
  T("estoque.transferencia_entre_armazens", "estoque", variante("erp.warehouse_transfers", "kind", "warehouse")),
  T("estoque.transferencia_entre_empresas", "estoque", variante("erp.warehouse_transfers", "kind", "farm")),
  T("estoque.producao_de_racao", "estoque", entidade("erp.feed_batches")),

  // ---------- Compras ----------
  T("compras.solicitacao", "compras", entidade("erp.purchase_requests")),

  // ---------- Financeiro ----------
  // `direction` é o discriminador que o dicionário já declarava; a prosa "Conta a pagar / Conta a
  // receber" era UMA string para DUAS operações com efeito financeiro oposto.
  T("financeiro.conta_a_pagar", "financeiro", variante("erp.financial_titles", "direction", "payable")),
  T("financeiro.conta_a_receber", "financeiro", variante("erp.financial_titles", "direction", "receivable")),

  // ---------- Vendas ----------
  // Mesma tabela, três etapas comerciais distintas (`kind`). Também vinham numa string só.
  T("vendas.orcamento", "vendas", variante("erp.sales_documents", "kind", "budget")),
  T("vendas.pedido", "vendas", variante("erp.sales_documents", "kind", "order")),
  T("vendas.venda", "vendas", variante("erp.sales_documents", "kind", "sale")),

  // ---------- Frota e Ativos ----------
  T("frota_ativos.abastecimento", "frota_ativos", entidade("erp.fuel_supplies")),
  T("frota_ativos.manutencao", "frota_ativos", entidade("erp.maintenances")),

  // ---------- Ordens de Serviço ----------
  T("ordens_servico.ordem_de_servico", "ordens_servico", entidade("erp.service_orders"))
]);

const POR_CODIGO = new Map(TIPOS_OPERACAO.map((t) => [t.codigo, t]));

/** Índice por origem. A chave carrega o valor da variante para que `kind=warehouse` e `kind=farm` não se atropelem. */
const chaveDeOrigem = (tabela: string, valor?: string | null): string =>
  valor === undefined || valor === null || valor === "" ? tabela : `${tabela} ${valor}`;

const POR_ORIGEM = new Map(TIPOS_OPERACAO.map((t) => [chaveDeOrigem(t.origem.tabela, t.origem.valor), t]));

/** Discriminador declarado de cada tabela que tem variantes. Quem lê um registro descobre aqui qual coluna consultar. */
const DISCRIMINADOR_POR_TABELA = new Map(
  TIPOS_OPERACAO.filter((t) => t.origem.discriminador).map((t) => [t.origem.tabela, t.origem.discriminador!])
);

/** Códigos declarados, em ordem de declaração. */
export const CODIGOS_TIPO_OPERACAO: readonly string[] = Object.freeze(TIPOS_OPERACAO.map((t) => t.codigo));

/** A TOP deste código; `undefined` quando não declarada — quem chama NEGA, nunca escolhe uma vizinha. */
export const tipoOperacao = (codigo: string): TipoOperacao | undefined =>
  POR_CODIGO.get(codigo);

/** Este código está declarado? Use para validar referência vinda de outro SSOT (o dicionário, por exemplo). */
export const tipoOperacaoDeclarada = (codigo: string): boolean => POR_CODIGO.has(codigo);

/** Coluna que decide a variante desta tabela; `undefined` quando a tabela inteira é uma operação só. */
export const discriminadorDeTabela = (tabela: string): string | undefined =>
  DISCRIMINADOR_POR_TABELA.get(tabela);

/**
 * Resolve a TOP de um registro pela AUTORIDADE: tabela + valor do discriminador quando a tabela tem variantes.
 *
 * FUNÇÃO PURA — sem banco, sem rede, sem sessão, sem permissão, sem relógio, sem efeito colateral. O mesmo
 * par de argumentos devolve sempre o mesmo resultado.
 *
 * Fail-closed, os quatro casos:
 *  - tabela sem TOP declarada → `undefined`;
 *  - tabela COM variantes e valor ausente/vazio → `undefined` (não elege a primeira variante);
 *  - tabela COM variantes e valor desconhecido → `undefined` (não cai na vizinha);
 *  - tabela SEM variantes que recebe um valor → o valor é ignorado, porque a tabela já é a resposta.
 */
export function resolverTipoOperacao(tabela: string, valorDiscriminador?: string | null): TipoOperacao | undefined {
  if (typeof tabela !== "string" || tabela === "") return undefined;
  const discriminador = DISCRIMINADOR_POR_TABELA.get(tabela);
  if (!discriminador) return POR_ORIGEM.get(chaveDeOrigem(tabela));
  if (typeof valorDiscriminador !== "string" || valorDiscriminador === "") return undefined;
  return POR_ORIGEM.get(chaveDeOrigem(tabela, valorDiscriminador));
}

/**
 * Mesma resolução, lendo o valor do discriminador DO PRÓPRIO REGISTRO.
 *
 * Existe para que o consumidor não precise saber qual coluna decide a variante de qual tabela — esse
 * conhecimento é do registry, e espalhá-lo pela interface criaria a segunda fonte de verdade que esta
 * fatia veio eliminar. Continua pura: só lê uma propriedade do objeto que recebeu.
 */
export function tipoOperacaoDoRegistro(tabela: string, registro: Readonly<Record<string, unknown>> | null | undefined): TipoOperacao | undefined {
  const discriminador = DISCRIMINADOR_POR_TABELA.get(tabela);
  if (!discriminador) return resolverTipoOperacao(tabela);
  // Propriedade PRÓPRIA, nunca herdada: um `Object.prototype.kind` em qualquer ponto do bundle faria
  // TODA transferência afirmar a mesma variante — o dano exato que a resolução fail-closed existe para
  // impedir. É a mesma guarda que `attachment-parent.ts` usa na whitelist de anexos.
  const bruto = registro && Object.prototype.hasOwnProperty.call(registro, discriminador) ? registro[discriminador] : undefined;
  return resolverTipoOperacao(tabela, typeof bruto === "string" ? bruto : undefined);
}

/**
 * Consistência do registry. Lista vazia = íntegro; cada item é um problema legível.
 *
 * Confere contra os SSOTs reais (módulo e catálogo de tradução), não contra uma cópia — é isso que
 * impede o registry de envelhecer sozinho.
 */
export function validarRegistroTipoOperacao(): string[] {
  const problemas: string[] = [];
  const modulos = new Set(CHAVES_MODULO_EMPRESA);
  const vistos = new Set<string>();
  const origens = new Map<string, string>();
  const discriminadorDaTabela = new Map<string, string | undefined>();

  for (const t of TIPOS_OPERACAO) {
    if (!CODIGO_CANONICO.test(t.codigo)) problemas.push(`${t.codigo}: código fora da forma canônica <modulo>.<operacao>`);
    if (vistos.has(t.codigo)) problemas.push(`${t.codigo}: código duplicado`);
    vistos.add(t.codigo);

    if (!modulos.has(t.modulo)) problemas.push(`${t.codigo}: módulo desconhecido "${t.modulo}"`);
    if (!t.codigo.startsWith(`${t.modulo}.`)) problemas.push(`${t.codigo}: o código precisa começar pelo módulo "${t.modulo}"`);

    if (t.chaveI18n !== `${PREFIXO_I18N_TIPO_OPERACAO}${t.codigo}`) problemas.push(`${t.codigo}: chave de tradução não deriva do código`);
    if (!ptBR.mensagens[t.chaveI18n]) problemas.push(`${t.codigo}: sem rótulo pt-BR para "${t.chaveI18n}"`);

    const { tabela, discriminador, valor } = t.origem;
    if (!tabela.startsWith("erp.")) problemas.push(`${t.codigo}: origem precisa ser tabela canônica (erp.<nome>)`);
    if (discriminador && !valor) problemas.push(`${t.codigo}: discriminador "${discriminador}" sem valor declarado`);
    if (valor && !discriminador) problemas.push(`${t.codigo}: valor "${valor}" sem discriminador declarado`);

    const chave = chaveDeOrigem(tabela, valor);
    const dono = origens.get(chave);
    if (dono) problemas.push(`${t.codigo}: mesma origem de ${dono} (${chave.replace(" ", " = ")})`);
    origens.set(chave, t.codigo);

    // Uma tabela não pode ser decidida por duas colunas diferentes: o leitor não saberia qual consultar.
    if (discriminadorDaTabela.has(tabela) && discriminadorDaTabela.get(tabela) !== discriminador) {
      problemas.push(`${t.codigo}: a tabela ${tabela} já usa o discriminador "${String(discriminadorDaTabela.get(tabela))}"`);
    }
    discriminadorDaTabela.set(tabela, discriminador);
  }
  return problemas;
}
