/**
 * APROVAÇÃO DO DOCUMENTO (TOP-CONFIG-08, decisão 277). UM dono para as três perguntas que a confirmação (manual
 * e automática) e as rotas de aprovação fazem sobre a decisão de um documento aberto:
 *   · a SITUAÇÃO — não exigida | pendente | aprovado | reprovado (`situacaoDaAprovacao`);
 *   · a RECUSA da confirmação, já com o código e os details do contrato (`recusaDaAprovacao`);
 *   · a GRAVAÇÃO de uma decisão nova (`registrarDecisao`).
 * Quem decide se o documento EXIGE aprovação é o domínio (`regrasGeraisDaVersaoTop` + `exigeAprovacao`), sobre a
 * versão congelada que o chamador já leu e com o valor ATUAL do documento. Este arquivo não reescreve a conta: só
 * lê a decisão vigente quando a conta diz que ela importa.
 *
 * POR QUE TRÊS TABELAS, UMA AO LADO DE CADA DOCUMENTO
 * --------------------------------------------------
 * `erp.aprovacoes_venda`, `erp.aprovacoes_compra` e `erp.aprovacoes_estoque` (0041). Cada uma tem a FK do SEU
 * documento, a empresa do módulo de escopo DELE (vendas, compras, estoque) e só as colunas que ele tem: a versão do
 * documento existe só na venda; o valor, na venda e na compra (o do estoque só se conhece na confirmação). Uma
 * tabela única com "tipo de documento" trocaria a FK por um discriminador de texto e a RLS por módulo por uma
 * política que adivinha o módulo — a ampliação de escopo que a matriz de RLS existe para impedir. O módulo escolhe
 * a tabela por uma WHITELIST ESTÁTICA (`TABELA_DA_APROVACAO`): o SQL é fixo, montado na carga deste arquivo, e
 * nenhum identificador vem de entrada.
 *
 * SÓ INSERÇÃO
 * -----------
 * Uma linha por DECISÃO. Ninguém edita nem apaga uma decisão (gatilho de imutabilidade, e o erp_app sem UPDATE,
 * DELETE nem TRUNCATE): reprovar e depois aprovar é uma decisão NOVA, e a história fica. A vigente é a ÚLTIMA
 * (id desc). Por isso aqui só existe `insert`, e o que a linha carrega além do pedido (a TOP, a versão congelada,
 * o valor, quem decidiu e quando) é ATRIBUÍDO pelo gatilho de inserção a partir do documento e da transação — não
 * vem deste código, e o gatilho não compara o que viesse. O mesmo gatilho recusa o documento invisível (NOT_FOUND),
 * a versão velha da venda (CONCURRENCY_CONFLICT), o documento que não está aberto (CONFLICT) e o que não exige
 * aprovação (APROVACAO_NAO_EXIGIDA); a rota confere tudo isso ANTES, na ordem do contrato, e o banco é o fundo.
 *
 * A VERSÃO DA VENDA
 * -----------------
 * A decisão da venda vale para a VERSÃO do documento (`sales_documents.version`, 0039), e a vigente é a última
 * decisão DA VERSÃO ATUAL. Todo UPDATE da venda soma 1 na versão, então alterar a venda depois de aprovada pede
 * uma aprovação NOVA — e reprovada na versão V e alterada para V+1 volta a "pendente". É por isso que a decisão
 * mora numa tabela separada: aprovar não pode mexer na versão que ela aprova.
 *
 * COMPRA E ESTOQUE NÃO TÊM EDIÇÃO
 * -------------------------------
 * A vigente deles é a última decisão, e ela vale enquanto o documento estiver aberto. A fatia que criar a edição da
 * compra ou do documento de estoque TEM DE invalidar a aprovação (TIPO-OPERACAO-CONTRACT §17): sem isso, um
 * documento aprovado mudaria depois da aprovação e confirmaria com ela.
 *
 * O status `approved` que a venda já tem (0005) NÃO tem nada a ver com isto: nada aqui o grava nem o lê.
 *
 * O que este arquivo NÃO faz: conferir a capacidade `<recurso>.approve` (o `runService` da rota), achar o documento
 * no escopo nem travá-lo FOR UPDATE (a rota, antes), confirmar (o serviço dono do documento). A fila das rotas de
 * aprovação faz a MESMA conta em SQL com `erp.top_exige_aprovacao` — a paridade com o domínio é provada por teste.
 */
import { DomainError } from "@agro/shared";
import { MENSAGEM_APROVACAO_PENDENTE, exigeAprovacao, mensagemAprovacaoReprovada, regrasGeraisDaVersaoTop, type RegrasGeraisDaVersao } from "@agro/domain";
import type { ServiceCtx } from "./context.js";
import { notFound } from "./errors.js";

export type ModuloAprovacao = "vendas" | "compras" | "estoque";
export type SituacaoAprovacao = "nao_exigida" | "pendente" | "aprovado" | "reprovado";

/**
 * O que a situação precisa saber do documento — lido pelo chamador, na MESMA transação:
 *   · `versaoDocumento`: a `version` ATUAL da venda (bigint, string ou número); compra e estoque mandam `null`;
 *   · `valorDocumento`: o total ATUAL (decimal em string); o estoque manda `null`;
 *   · `versaoTop`: a versão congelada que o documento cita (configuração + família), ou `null` sem TOP.
 */
export interface DadosDaAprovacao {
  modulo: ModuloAprovacao;
  documentoId: string;
  versaoDocumento: string | number | null;
  valorDocumento: string | null;
  versaoTop: { codigoBase: string; configuracao: unknown } | null;
}

/** A WHITELIST: o módulo escolhe a tabela; nenhum nome de tabela é montado de entrada. */
export const TABELA_DA_APROVACAO: Readonly<Record<ModuloAprovacao, string>> = Object.freeze({
  vendas: "erp.aprovacoes_venda",
  compras: "erp.aprovacoes_compra",
  estoque: "erp.aprovacoes_estoque",
});

/** Só a venda tem versão do documento: a decisão dela vale para uma versão; a dos outros, para o documento aberto. */
const DECIDE_POR_VERSAO: Readonly<Record<ModuloAprovacao, boolean>> = Object.freeze({ vendas: true, compras: false, estoque: false });

/**
 * A decisão vigente e o nome de quem decidiu, numa consulta só (a recusa reprovada precisa dos dois). O `join` em
 * `erp.users` é pela FK `decidido_por` (not null): a decisão nunca some por causa dele. `$3` só existe na venda.
 */
const consultaDaVigente = (tabela: string, porVersao: boolean): string =>
  `select a.decisao, a.observacao, a.decidido_por::text as decidido_por, u.name as decidido_por_nome, a.decidido_em
     from ${tabela} a
     join erp.users u on u.id = a.decidido_por
    where a.documento_id = $1 and a.organization_id = $2${porVersao ? " and a.versao_documento = $3::bigint" : ""}
    order by a.id desc
    limit 1`;

/**
 * A inserção manda SÓ o pedido: organização, empresa, documento, (versão, na venda), decisão e observação. O resto
 * das colunas NOT NULL é atribuído pelo gatilho BEFORE INSERT, que roda antes da conferência de NOT NULL.
 */
const insercaoDaDecisao = (tabela: string, porVersao: boolean): string =>
  porVersao
    ? `insert into ${tabela} (organization_id, empresa_id, documento_id, versao_documento, decisao, observacao)
       values ($1, $2, $3, $4::bigint, $5, $6)
       returning id::text as id, decidido_em`
    : `insert into ${tabela} (organization_id, empresa_id, documento_id, decisao, observacao)
       values ($1, $2, $3, $4, $5)
       returning id::text as id, decidido_em`;

/** O SQL de cada módulo, fixado na carga a partir da whitelist. */
const SQL_DA_APROVACAO: Readonly<Record<ModuloAprovacao, { vigente: string; inserir: string }>> = Object.freeze({
  vendas: { vigente: consultaDaVigente(TABELA_DA_APROVACAO.vendas, true), inserir: insercaoDaDecisao(TABELA_DA_APROVACAO.vendas, true) },
  compras: { vigente: consultaDaVigente(TABELA_DA_APROVACAO.compras, false), inserir: insercaoDaDecisao(TABELA_DA_APROVACAO.compras, false) },
  estoque: { vigente: consultaDaVigente(TABELA_DA_APROVACAO.estoque, false), inserir: insercaoDaDecisao(TABELA_DA_APROVACAO.estoque, false) },
});

/**
 * Módulo desconhecido NEGA (erro do chamador, 500), nunca cai na tabela vizinha. O tipo já fecha o conjunto; a
 * conferência em tempo de execução fecha a porta para quem chega sem ele.
 */
function sqlDoModulo(modulo: ModuloAprovacao): { vigente: string; inserir: string } {
  if (!Object.hasOwn(SQL_DA_APROVACAO, modulo)) throw new Error("aprovacao-documento: módulo de aprovação desconhecido");
  return SQL_DA_APROVACAO[modulo];
}

/**
 * A versão da venda como texto de bigint. Obrigatória na venda: sem ela não há como dizer qual decisão é a vigente,
 * e adivinhar seria aprovar uma versão que ninguém viu. Erro do chamador (500), nunca "pendente" calado.
 */
function versaoDaVenda(v: string | number | null): string {
  const texto = typeof v === "number" ? (Number.isSafeInteger(v) && v >= 0 ? String(v) : null) : v;
  if (texto === null || !/^\d{1,19}$/.test(texto)) throw new Error("aprovacao-documento: a decisão da venda exige a versão do documento");
  return texto;
}

interface DecisaoVigente {
  decisao: "aprovado" | "reprovado";
  observacao: string | null;
  decidido_por: string;
  decidido_por_nome: string;
  decidido_em: Date | string;
}

/** O pg entrega timestamptz como Date; a API responde ISO (o mesmo texto que o JSON de um Date daria). */
const emIso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

/** A conta do domínio sobre a versão congelada. Ilegível → recusa sem efeito (fail-closed). */
function regrasDaVersao(d: DadosDaAprovacao): RegrasGeraisDaVersao {
  const r = regrasGeraisDaVersaoTop(d.versaoTop);
  if (r.ok) return r.regras;
  throw new DomainError("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", "A configuração da operação deste documento está num formato que este servidor não executa.",
    { motivo: r.motivo, recusas: [] });
}

type PoliticaDeAprovacao = NonNullable<RegrasGeraisDaVersao["aprovacao"]>;
type Avaliacao =
  | { exige: false }
  | { exige: true; politica: PoliticaDeAprovacao; vigente: DecisaoVigente | null };

/**
 * A MESMA conta para a situação e para a recusa: a versão congelada diz se o documento exige aprovação com o valor
 * ATUAL; só então UMA consulta lê a decisão vigente. Sem consulta quando não exige — o caminho de toda TOP de
 * formato 1 a 3, e de todo documento sem TOP, não ganha ida ao banco.
 */
async function avaliar(ctx: ServiceCtx, d: DadosDaAprovacao): Promise<Avaliacao> {
  const sql = sqlDoModulo(d.modulo);
  const versao = DECIDE_POR_VERSAO[d.modulo] ? versaoDaVenda(d.versaoDocumento) : null;
  const regras = regrasDaVersao(d);
  // Sem política o domínio já diz "não exige"; a pergunta explícita só estreita o tipo para a recusa pendente.
  if (regras.aprovacao === null || !exigeAprovacao(regras, d.valorDocumento)) return { exige: false };
  const params: unknown[] = [d.documentoId, ctx.orgId];
  if (versao !== null) params.push(versao);
  const r = await ctx.tx.query<DecisaoVigente>(sql.vigente, params);
  return { exige: true, politica: regras.aprovacao, vigente: r.rows[0] ?? null };
}

/**
 * A situação da aprovação do documento aberto. "nao_exigida": sem TOP, versão no formato 1 a 3, ou formato 4 cuja
 * política não exige com o valor atual. Senão, a decisão vigente: nenhuma = "pendente".
 * Formato 4 ilegível → TIPO_OPERACAO_EXECUCAO_INDISPONIVEL (os chamadores já recusam antes; aqui é o fundo).
 */
export async function situacaoDaAprovacao(ctx: ServiceCtx, d: DadosDaAprovacao): Promise<SituacaoAprovacao> {
  const a = await avaliar(ctx, d);
  if (!a.exige) return "nao_exigida";
  return a.vigente ? a.vigente.decisao : "pendente";
}

/**
 * O passo da aprovação no planejamento da confirmação (manual, automática e prévia): a recusa pronta, ou `null`
 * quando a confirmação pode seguir (não exigida, ou aprovada).
 *   · pendente  → 409 APROVACAO_PENDENTE, details { politica, valorMinimo (null na "sempre"), valorDocumento };
 *   · reprovado → 409 APROVACAO_REPROVADA com o motivo gravado, details { motivo, decididoPor: { id, nome }, decididoEm }.
 * Devolve o erro em vez de lançá-lo: a prévia o põe na lista de recusas, a confirmação o lança.
 */
export async function recusaDaAprovacao(ctx: ServiceCtx, d: DadosDaAprovacao): Promise<DomainError | null> {
  const a = await avaliar(ctx, d);
  if (!a.exige) return null;
  const v = a.vigente;
  if (!v) {
    return new DomainError("APROVACAO_PENDENTE", MENSAGEM_APROVACAO_PENDENTE, {
      politica: a.politica.politica,
      valorMinimo: a.politica.politica === "por_valor" ? a.politica.valorMinimo : null,
      valorDocumento: d.valorDocumento,
    });
  }
  if (v.decisao === "aprovado") return null;
  // O CHECK da 0041 obriga o motivo na reprovação; o `?? ""` só estreita o tipo.
  const motivo = v.observacao ?? "";
  return new DomainError("APROVACAO_REPROVADA", mensagemAprovacaoReprovada(motivo), {
    motivo,
    decididoPor: { id: v.decidido_por, nome: v.decidido_por_nome },
    decididoEm: emIso(v.decidido_em),
  });
}

/**
 * Grava UMA decisão nova. A rota já conferiu a capacidade, a visibilidade, a trava FOR UPDATE do documento, a versão
 * (venda), a situação e a exigência — nessa ordem; o gatilho de inserção confere de novo e atribui a TOP, a versão
 * congelada, o valor, `decidido_por` (o usuário da transação) e `decidido_em`. O que o banco recusar sobe como veio
 * (o tratador de erros traduz o prefixo do código). Na venda, `versaoDocumento` é obrigatória.
 * ROW COUNT conferido: zero linha nunca vira sucesso sem efeito.
 */
export async function registrarDecisao(
  ctx: ServiceCtx,
  d: { modulo: ModuloAprovacao; documentoId: string; empresaId: string; versaoDocumento: string | number | null; decisao: "aprovado" | "reprovado"; observacao: string | null },
): Promise<{ id: string; decididoEm: string }> {
  const sql = sqlDoModulo(d.modulo);
  const params: unknown[] = DECIDE_POR_VERSAO[d.modulo]
    ? [ctx.orgId, d.empresaId, d.documentoId, versaoDaVenda(d.versaoDocumento), d.decisao, d.observacao]
    : [ctx.orgId, d.empresaId, d.documentoId, d.decisao, d.observacao];
  const r = await ctx.tx.query<{ id: string; decidido_em: Date | string }>(sql.inserir, params);
  const linha = r.rows[0];
  if (r.rowCount !== 1 || !linha) throw notFound("Documento");
  return { id: linha.id, decididoEm: emIso(linha.decidido_em) };
}
