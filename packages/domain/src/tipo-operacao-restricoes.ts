/**
 * TOP-CONFIG-05 — AS RESTRIÇÕES COMERCIAIS E O FISCAL DO FORMATO 3 (decisão 263).
 *
 * Um dono só para o que a API e a tela perguntam sobre as restrições de uma versão do formato 3:
 *   · as regras de SENTIDO do CFOP (dependem da família da TOP, por isso fora do leitor estrito);
 *   · as EXIGÊNCIAS GERAIS que o documento não atende — a MESMA função na API (recusa) e na tela (asterisco
 *     e bloqueio antes do POST). Duas implementações divergiriam no primeiro campo novo;
 *   · a mensagem do cliente em atraso, montada a partir dos agregados que o banco devolve;
 *   · os códigos de erro e a capacidade `regrasDaOperacao` da descoberta de vendas.
 *
 * FORMATO 1 E 2 SÃO LEGADO PARA SEMPRE: toda função daqui devolve "nada a cobrar" fora do formato 3.
 * FISCAL É SÓ CONFIGURAÇÃO: nenhuma função daqui emite documento ou calcula imposto.
 */
import {
  restricoesExecutamTop,
  type ConfiguracaoTipoOperacao,
  type PoliticaClienteEmAtraso,
  type RecusaConfiguracaoTop,
} from "./tipo-operacao-configuracao.js";
import { tipoOperacao } from "./tipo-operacao.js";
import { TABELA_DOCUMENTO_COMPRA } from "./tipo-operacao-configurado.js";
import { TABELA_DOCUMENTO_ESTOQUE } from "./estoque-documento.js";

// ─────────────── capacidade e códigos ───────────────

/**
 * A descoberta de vendas (`GET /api/sales/<variante>/operation-types`) declara `capacidades.regrasDaOperacao`
 * com ESTE valor exato. O web só consulta `/regras-da-operacao` e `/situacao-cliente` quando a API declara
 * exatamente este número; qualquer outro valor (ou ausência) é servidor anterior — a Central de hoje.
 */
export const CAPACIDADE_REGRAS_DA_OPERACAO = 1 as const;

/** O documento não atende uma exigência geral da TOP (código já existente na confirmação). */
export const ERRO_EXIGENCIA_NAO_ATENDIDA = "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA" as const;
/** A condição de pagamento escolhida não está entre as permitidas pela versão da TOP. */
export const ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA = "CONDICAO_PAGAMENTO_NAO_PERMITIDA" as const;
/** A TOP bloqueia cliente com título a receber vencido além da tolerância. */
export const ERRO_CLIENTE_EM_ATRASO = "CLIENTE_EM_ATRASO" as const;

/** Mensagem da condição fora da lista — única, para inexistente, de outra organização ou só não permitida. */
export const MENSAGEM_CONDICAO_NAO_PERMITIDA = "Esta operação não aceita esta condição de pagamento.";
/** Mensagem da exigência não atendida (o detalhe traz um item por campo). */
export const MENSAGEM_EXIGENCIA_NAO_ATENDIDA = "A operação exige dados que o documento não tem.";

/** Quantas condições permitidas uma versão pode listar. */
export const LIMITE_CONDICOES_PERMITIDAS = 50;

/** Aviso fixo da aba Fiscal do editor. */
export const AVISO_FISCAL_SO_CONFIGURACAO = "Usado na emissão da nota fiscal. A emissão ainda não existe no sistema.";

// ─────────────── CFOP ───────────────

export type SentidoCfop = "entrada" | "saida";

/**
 * O SENTIDO que o movimento impõe ao CFOP — UM mapa só, por MÓDULO do registry de TOP (`tipo-operacao.ts`).
 * Vendas = saída; compras = entrada; qualquer outro módulo não impõe sentido.
 */
export const SENTIDO_CFOP_POR_MODULO: Readonly<Record<string, SentidoCfop>> = Object.freeze({ vendas: "saida", compras: "entrada" });

/** O sentido imposto à família (código canônico `<modulo>.<operacao>`), ou `null` quando não impõe. */
export function sentidoCfopDaFamilia(familia: string): SentidoCfop | null {
  const t = tipoOperacao(familia);
  return (t && SENTIDO_CFOP_POR_MODULO[t.modulo]) ?? null;
}

/** Os três CFOPs, com os primeiros dígitos aceitos: [entrada, saída]. */
export const CAMPOS_CFOP = [
  { campo: "cfopDentroEstado", rotulo: "CFOP dentro do estado", entrada: "1", saida: "5" },
  { campo: "cfopForaEstado", rotulo: "CFOP fora do estado", entrada: "2", saida: "6" },
  { campo: "cfopExterior", rotulo: "CFOP exterior", entrada: "3", saida: "7" },
] as const;

const sentidoDoCfop = (cfop: string): SentidoCfop => (Number(cfop[0]) <= 3 ? "entrada" : "saida");

/** Recusa com mensagem para a tela apontar o campo. Compatível com `RecusaConfiguracaoTop`. */
export interface RecusaFiscalTop extends RecusaConfiguracaoTop {
  mensagem: string;
}

/**
 * As regras de SENTIDO dos CFOPs de uma configuração do formato 3 (a FORMA já foi conferida na leitura):
 *   1. dentro do estado começa com 1 ou 5; fora, 2 ou 6; exterior, 3 ou 7;
 *   2. todos os preenchidos têm o MESMO sentido (entrada 1–3, saída 5–7);
 *   3. o sentido é o que o movimento da família impõe (vendas = saída, compras = entrada), quando impõe.
 * Erro no caminho do campo (`fiscal.<campo>`). Formato 1/2: nenhuma recusa (as chaves nem existem).
 */
export function recusasFiscaisDaFamiliaTop(c: ConfiguracaoTipoOperacao, familia: string): RecusaFiscalTop[] {
  if (!restricoesExecutamTop(c)) return [];
  const out: RecusaFiscalTop[] = [];
  const imposto = sentidoCfopDaFamilia(familia);
  let primeiro: SentidoCfop | null = null;
  for (const x of CAMPOS_CFOP) {
    const v = c.fiscal[x.campo];
    if (!v) continue;
    const caminho = `fiscal.${x.campo}`;
    if (v[0] !== x.entrada && v[0] !== x.saida) {
      out.push({ motivo: "valor_invalido", caminho, mensagem: `${x.rotulo} começa com ${x.entrada} (entrada) ou ${x.saida} (saída).` });
      continue;
    }
    const s = sentidoDoCfop(v);
    if (imposto && s !== imposto) {
      out.push({ motivo: "valor_invalido", caminho, mensagem: `Esta operação é de ${imposto === "saida" ? "saída" : "entrada"}: use um CFOP de ${imposto === "saida" ? "saída (5, 6 ou 7)" : "entrada (1, 2 ou 3)"}.` });
      continue;
    }
    if (primeiro && s !== primeiro) {
      out.push({ motivo: "valor_invalido", caminho, mensagem: "Todos os CFOPs precisam ter o mesmo sentido (entrada ou saída)." });
      continue;
    }
    primeiro ??= s;
  }
  return out;
}

// ─────────────── exigências gerais ───────────────

/** Uma linha do mapa exigência → campo do documento → rótulo. */
export interface ExigenciaGeralTop<C extends string = string> {
  readonly chave: "exigeParceiro" | "exigeCentroResultado" | "exigeObservacao" | "exigeTransportadora";
  readonly caminho: C;
  readonly rotulo: string;
}

/** O mapa exigência → campo do documento → rótulo DA VENDA. Uma lista só; a tela e a API leem esta. */
export const EXIGENCIAS_GERAIS_TOP = [
  { chave: "exigeParceiro", caminho: "client_id", rotulo: "Cliente" },
  { chave: "exigeCentroResultado", caminho: "centro_custo_id", rotulo: "Centro de resultado" },
  { chave: "exigeObservacao", caminho: "note", rotulo: "Observação" },
  { chave: "exigeTransportadora", caminho: "transporter_id", rotulo: "Transportadora" },
] as const;

/**
 * COMPRAS-01 (decisão 267): o MESMO mapa, com os campos do documento de compra (`erp.documentos_compra`).
 * As chaves de exigência são as mesmas da TOP; muda só onde o documento guarda o dado e como ele se chama.
 */
export const EXIGENCIAS_GERAIS_COMPRA_TOP = [
  { chave: "exigeParceiro", caminho: "fornecedor_id", rotulo: "Fornecedor" },
  { chave: "exigeCentroResultado", caminho: "centro_custo_id", rotulo: "Centro de resultado" },
  { chave: "exigeObservacao", caminho: "observacao", rotulo: "Observação" },
  { chave: "exigeTransportadora", caminho: "transportadora_id", rotulo: "Transportadora" },
] as const;

/**
 * ESTOQUE-01 (decisão 274): o mapa do documento de estoque (`erp.documentos_estoque`). Só a observação se
 * aplica: o documento de estoque não tem parceiro, centro de resultado nem transportadora. É um mapa PRÓPRIO
 * de propósito — se as famílias de estoque caíssem no mapa padrão (o da venda), uma TOP de estoque que
 * marcasse "exige parceiro" recusaria todo lançamento por um `client_id` que o documento nem tem.
 */
export const EXIGENCIAS_GERAIS_ESTOQUE_TOP = [
  { chave: "exigeObservacao", caminho: "observacao", rotulo: "Observação" },
] as const;

export type CampoExigidoTop = (typeof EXIGENCIAS_GERAIS_TOP)[number]["caminho"];
export type CampoExigidoCompraTop = (typeof EXIGENCIAS_GERAIS_COMPRA_TOP)[number]["caminho"];
export type CampoExigidoEstoqueTop = (typeof EXIGENCIAS_GERAIS_ESTOQUE_TOP)[number]["caminho"];

/** O documento como será gravado (só os campos que as exigências olham). */
export type DocumentoParaExigencias = Partial<Record<CampoExigidoTop, unknown>>;
export type DocumentoCompraParaExigencias = Partial<Record<CampoExigidoCompraTop, unknown>>;
export type DocumentoEstoqueParaExigencias = Partial<Record<CampoExigidoEstoqueTop, unknown>>;

/**
 * O mapa de exigências do DOCUMENTO que a família lança: famílias do documento de compra → mapa da compra;
 * famílias do documento de estoque → mapa do estoque (só a observação); qualquer outra → o mapa da venda (o
 * comportamento de sempre, que não muda).
 */
export function exigenciasGeraisDaFamiliaTop(familia: string): readonly ExigenciaGeralTop[] {
  const tabela = tipoOperacao(familia)?.origem.tabela;
  if (tabela === TABELA_DOCUMENTO_COMPRA) return EXIGENCIAS_GERAIS_COMPRA_TOP;
  if (tabela === TABELA_DOCUMENTO_ESTOQUE) return EXIGENCIAS_GERAIS_ESTOQUE_TOP;
  return EXIGENCIAS_GERAIS_TOP;
}

const vazio = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Os campos que a configuração EXIGE (formato 3; vazio nos formatos 1/2). Usado pela tela para o asterisco.
 * `mapa` omitido = o da venda (saída de vendas inalterada).
 */
export function camposExigidosTop(c: ConfiguracaoTipoOperacao): CampoExigidoTop[];
export function camposExigidosTop<C extends string>(c: ConfiguracaoTipoOperacao, mapa: readonly ExigenciaGeralTop<C>[]): C[];
export function camposExigidosTop(c: ConfiguracaoTipoOperacao, mapa: readonly ExigenciaGeralTop[] = EXIGENCIAS_GERAIS_TOP): string[] {
  if (!restricoesExecutamTop(c)) return [];
  return mapa.filter((e) => c.geral[e.chave]).map((e) => e.caminho);
}

/**
 * As exigências gerais que o documento NÃO atende — a MESMA função na API e na tela.
 * Formato 1/2: lista vazia SEMPRE (legado, decisão 263). Observação exige texto com conteúdo.
 * `mapa` omitido = o da venda.
 */
export function exigenciasGeraisFaltando(c: ConfiguracaoTipoOperacao, documento: DocumentoParaExigencias): { caminho: CampoExigidoTop; rotulo: string }[];
export function exigenciasGeraisFaltando<C extends string>(c: ConfiguracaoTipoOperacao, documento: Partial<Record<C, unknown>>, mapa: readonly ExigenciaGeralTop<C>[]): { caminho: C; rotulo: string }[];
export function exigenciasGeraisFaltando(c: ConfiguracaoTipoOperacao, documento: Partial<Record<string, unknown>>, mapa: readonly ExigenciaGeralTop[] = EXIGENCIAS_GERAIS_TOP): { caminho: string; rotulo: string }[] {
  if (!restricoesExecutamTop(c)) return [];
  return mapa.filter((e) => c.geral[e.chave] && vazio(documento[e.caminho])).map((e) => ({ caminho: e.caminho, rotulo: e.rotulo }));
}

/** Idem, a partir da LISTA de campos exigidos (o que `/regras-da-operacao` devolve à tela). `mapa` omitido = venda. */
export function exigenciasFaltandoPorCampos(campos: readonly string[], documento: DocumentoParaExigencias): { caminho: CampoExigidoTop; rotulo: string }[];
export function exigenciasFaltandoPorCampos<C extends string>(campos: readonly string[], documento: Partial<Record<C, unknown>>, mapa: readonly ExigenciaGeralTop<C>[]): { caminho: C; rotulo: string }[];
export function exigenciasFaltandoPorCampos(campos: readonly string[], documento: Partial<Record<string, unknown>>, mapa: readonly ExigenciaGeralTop[] = EXIGENCIAS_GERAIS_TOP): { caminho: string; rotulo: string }[] {
  return mapa.filter((e) => campos.includes(e.caminho) && vazio(documento[e.caminho])).map((e) => ({ caminho: e.caminho, rotulo: e.rotulo }));
}

// ─────────────── cliente em atraso ───────────────

/** Os agregados que `erp.situacao_atraso_cliente` devolve (dinheiro em string decimal; data ISO). */
export interface SituacaoAtrasoCliente {
  titulos: number;
  total: string;
  vencimentoMaisAntigo: string | null;
}

/** "1234.5" → "1.234,50" sem ponto flutuante. */
export function formatarDinheiroBr(decimal: string): string {
  const negativo = decimal.startsWith("-");
  const [int = "0", frac = ""] = (negativo ? decimal.slice(1) : decimal).split(".");
  const milhar = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${milhar},${(frac + "00").slice(0, 2)}`;
}

/** "2026-09-01" → "01/09/2026". */
export const formatarDataBr = (iso: string): string => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

/** O texto da situação (faixa da tela e mensagem da recusa usam o mesmo começo). */
export function textoSituacaoAtraso(s: SituacaoAtrasoCliente): string {
  const mais = s.vencimentoMaisAntigo ? `, o mais antigo de ${formatarDataBr(s.vencimentoMaisAntigo)}` : "";
  return `O cliente tem ${s.titulos} título(s) vencido(s), total R$ ${formatarDinheiroBr(s.total)}${mais}.`;
}

/** A mensagem do 422 `CLIENTE_EM_ATRASO`. */
export const mensagemClienteEmAtraso = (s: SituacaoAtrasoCliente): string =>
  `${textoSituacaoAtraso(s)} Esta operação não aceita cliente em atraso.`;

/**
 * COMPRAS-01 (decisão 267): "Cliente em atraso" vale para esta família? Só fora do documento de compra —
 * comprar de um fornecedor não tem cliente, e a política não tem o que conferir. A API da TOP recusa, nas
 * famílias de compra, qualquer valor diferente de "não valida"; o editor esconde o bloco.
 * ESTOQUE-01 (decisão 274): o documento de estoque também não tem cliente — mesma recusa. As oito famílias
 * antigas de estoque não mudam (continuam como estavam, sem consumidor).
 */
export function clienteEmAtrasoValeParaFamiliaTop(familia: string): boolean {
  const tabela = tipoOperacao(familia)?.origem.tabela;
  return tabela !== TABELA_DOCUMENTO_COMPRA && tabela !== TABELA_DOCUMENTO_ESTOQUE;
}

/** Mensagem da recusa do "Cliente em atraso" numa família de compra (422 no campo). */
export const MENSAGEM_CLIENTE_EM_ATRASO_FORA_DE_VENDAS = "\"Cliente em atraso\" não vale para compras: use \"Não valida\".";
/** ESTOQUE-01: a mesma recusa numa família do documento de estoque — dita com o nome do portal certo. */
export const MENSAGEM_CLIENTE_EM_ATRASO_FORA_DE_VENDAS_ESTOQUE = "\"Cliente em atraso\" não vale para estoque: use \"Não valida\".";

/**
 * A recusa do "Cliente em atraso" para a família (formato 3; vazio nos formatos 1/2 e nas famílias em que vale).
 * Caminho `financeiro.clienteEmAtraso`, no formato das outras recusas de configuração.
 */
export function recusasClienteEmAtrasoDaFamiliaTop(c: ConfiguracaoTipoOperacao, familia: string): RecusaFiscalTop[] {
  if (!restricoesExecutamTop(c) || clienteEmAtrasoValeParaFamiliaTop(familia)) return [];
  if (c.financeiro.clienteEmAtraso === "nao_valida") return [];
  const mensagem = tipoOperacao(familia)?.origem.tabela === TABELA_DOCUMENTO_ESTOQUE
    ? MENSAGEM_CLIENTE_EM_ATRASO_FORA_DE_VENDAS_ESTOQUE : MENSAGEM_CLIENTE_EM_ATRASO_FORA_DE_VENDAS;
  return [{ motivo: "valor_invalido", caminho: "financeiro.clienteEmAtraso", mensagem }];
}

// ─────────────── respostas das rotas novas de vendas ───────────────

/** `GET /api/sales/<variante>/regras-da-operacao?tipo_operacao_id=` — da versão ATUAL da TOP. */
export interface RegrasDaOperacaoResposta<C extends string = CampoExigidoTop> {
  formato: number;
  exigencias: C[];
  condicoesPermitidas: string[] | null;
  clienteEmAtraso: { politica: PoliticaClienteEmAtraso; toleranciaDias: number };
}

/** `GET /api/sales/<variante>/situacao-cliente?client_id=&tipo_operacao_id=`. */
export type SituacaoClienteResposta =
  | { politica: "nao_valida" }
  | { politica: "avisa" | "bloqueia"; emAtraso: boolean; titulos: number; total: string; vencimentoMaisAntigo: string | null };

// ─────────────── exigências que passam a valer (TOP-CONFIG-05_R1) ───────────────

/**
 * As exigências da Geral que ESTAVAM só registradas (versão vigente no formato 1/2) e PASSAM A SER COBRADAS
 * porque a gravação leva a TOP ao formato 3. Rótulos na ordem de `EXIGENCIAS_GERAIS_TOP`.
 * Vazio quando: a vigente já é formato 3; a nova não é formato 3; ou nenhuma marca antiga continua ligada.
 * "Exige transportadora" nunca entra: não existe fora do formato 3 (é marcada agora, não "passa a valer").
 */
export function exigenciasQuePassamAValer(vigente: ConfiguracaoTipoOperacao, nova: ConfiguracaoTipoOperacao, mapa: readonly ExigenciaGeralTop[] = EXIGENCIAS_GERAIS_TOP): string[] {
  if (restricoesExecutamTop(vigente) || !restricoesExecutamTop(nova)) return [];
  const antes = vigente.geral as unknown as Record<string, unknown>;
  return mapa
    .filter((e) => e.chave !== "exigeTransportadora" && antes[e.chave] === true && nova.geral[e.chave])
    .map((e) => e.rotulo);
}
