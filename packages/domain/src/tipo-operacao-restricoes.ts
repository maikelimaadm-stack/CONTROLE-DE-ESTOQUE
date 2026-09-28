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

/** O mapa exigência → campo do documento → rótulo. Uma lista só; a tela e a API leem esta. */
export const EXIGENCIAS_GERAIS_TOP = [
  { chave: "exigeParceiro", caminho: "client_id", rotulo: "Cliente" },
  { chave: "exigeCentroResultado", caminho: "centro_custo_id", rotulo: "Centro de resultado" },
  { chave: "exigeObservacao", caminho: "note", rotulo: "Observação" },
  { chave: "exigeTransportadora", caminho: "transporter_id", rotulo: "Transportadora" },
] as const;

export type CampoExigidoTop = (typeof EXIGENCIAS_GERAIS_TOP)[number]["caminho"];

/** O documento como será gravado (só os campos que as exigências olham). */
export type DocumentoParaExigencias = Partial<Record<CampoExigidoTop, unknown>>;

const vazio = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Os campos que a configuração EXIGE (formato 3; vazio nos formatos 1/2). Usado pela tela para o asterisco. */
export function camposExigidosTop(c: ConfiguracaoTipoOperacao): CampoExigidoTop[] {
  if (!restricoesExecutamTop(c)) return [];
  return EXIGENCIAS_GERAIS_TOP.filter((e) => c.geral[e.chave]).map((e) => e.caminho);
}

/**
 * As exigências gerais que o documento NÃO atende — a MESMA função na API e na tela.
 * Formato 1/2: lista vazia SEMPRE (legado, decisão 263). Observação exige texto com conteúdo.
 */
export function exigenciasGeraisFaltando(c: ConfiguracaoTipoOperacao, documento: DocumentoParaExigencias): { caminho: CampoExigidoTop; rotulo: string }[] {
  if (!restricoesExecutamTop(c)) return [];
  return EXIGENCIAS_GERAIS_TOP.filter((e) => c.geral[e.chave] && vazio(documento[e.caminho])).map((e) => ({ caminho: e.caminho, rotulo: e.rotulo }));
}

/** Idem, a partir da LISTA de campos exigidos (o que `/regras-da-operacao` devolve à tela). */
export function exigenciasFaltandoPorCampos(campos: readonly string[], documento: DocumentoParaExigencias): { caminho: CampoExigidoTop; rotulo: string }[] {
  return EXIGENCIAS_GERAIS_TOP.filter((e) => campos.includes(e.caminho) && vazio(documento[e.caminho])).map((e) => ({ caminho: e.caminho, rotulo: e.rotulo }));
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

// ─────────────── respostas das rotas novas de vendas ───────────────

/** `GET /api/sales/<variante>/regras-da-operacao?tipo_operacao_id=` — da versão ATUAL da TOP. */
export interface RegrasDaOperacaoResposta {
  formato: number;
  exigencias: CampoExigidoTop[];
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
export function exigenciasQuePassamAValer(vigente: ConfiguracaoTipoOperacao, nova: ConfiguracaoTipoOperacao): string[] {
  if (restricoesExecutamTop(vigente) || !restricoesExecutamTop(nova)) return [];
  const antes = vigente.geral as unknown as Record<string, unknown>;
  return EXIGENCIAS_GERAIS_TOP
    .filter((e) => e.chave !== "exigeTransportadora" && antes[e.chave] === true && nova.geral[e.chave])
    .map((e) => e.rotulo);
}
