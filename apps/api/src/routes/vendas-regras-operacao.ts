/**
 * TOP-CONFIG-05 — AS REGRAS DA OPERAÇÃO NO LANÇAMENTO DE VENDA (decisão 263).
 *
 * SÓ PARA VERSÃO DO FORMATO 3 OU 4 (o 4 executa tudo o que o 3 executa, decisão 277). Formato 1/2 é legado para
 * sempre: `regrasDaVersaoTop` devolve `null` e nada é cobrado — nenhuma recusa, mensagem ou ordem muda para
 * documento de TOP antiga.
 *
 * ORDEM FIXA (quem chama garante o lugar: DEPOIS das recusas de hoje — TOP, classificação, condição inválida — e
 * ANTES da cobrança do layout): a) exigências gerais; b) condição não permitida; c) cliente em atraso.
 */
import { DomainError } from "@agro/shared";
import {
  lerConfiguracaoTop, restricoesExecutamTop, exigenciasGeraisFaltando, mensagemClienteEmAtraso,
  ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA, ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA,
  MENSAGEM_CONDICAO_NAO_PERMITIDA, ERRO_CLIENTE_EM_ATRASO, camposExigidosTop,
  type ConfiguracaoComRestricoesTop, type DocumentoParaExigencias, type RegrasDaOperacaoResposta,
} from "@agro/domain";
import type { ServiceCtx } from "../lib/context.js";
import { situacaoAtrasoCliente } from "./vendas-atraso-cliente.js";
import { regrasGeraisDaCentral, regrasGeraisDaVariante, regrasGeraisNeutrasDaCentral, type RegrasGeraisDaCentral } from "./regras-gerais-da-central.js";

/** As regras de uma versão do formato 3 ou 4. `condicoesPermitidas` null = a versão não restringe. */
export interface RegrasDaVersaoTop {
  versaoId: string;
  formato: number;
  config: ConfiguracaoComRestricoesTop;
  condicoesPermitidas: string[] | null;
}

/**
 * O que se lê de UMA versão da TOP: o formato, as regras do formato 3/4 (`null` = não executa restrições) e, desde a
 * F2 (decisão 279), as regras gerais que a Central precisa saber antes de salvar (`regrasGerais`, pela VERSÃO — a
 * variante é de quem monta a resposta, `respostaDasRegrasDaOperacao`).
 */
export interface LidasDaVersaoTop {
  formato: number;
  regras: RegrasDaVersaoTop | null;
  regrasGerais: RegrasGeraisDaCentral;
}

async function regrasPorFiltro(ctx: ServiceCtx, where: string, param: string): Promise<LidasDaVersaoTop | null> {
  // F2 (decisão 279): a família (`codigo_base`) entra na MESMA consulta, por subselect escalar — é a entrada de
  // `regrasGeraisDaVersaoTop`, a mesma de `lerVersaoCongeladaTop` na gravação. Nenhuma ida a mais ao banco.
  const r = await ctx.tx.query<{ id: string; configuracao: unknown; configuracao_schema_version: number; condicoes: string[] | null; codigo_base: string | null }>(
    `select v.id, v.configuracao, v.configuracao_schema_version,
            (select array_agg(c.condicao_pagamento_id::text order by c.condicao_pagamento_id)
               from erp.tipos_operacao_versao_condicoes c
              where c.origem_versao_id = v.id and c.organization_id = v.organization_id) as condicoes,
            (select tb.codigo_base from erp.tipos_operacao tb
              where tb.id = v.tipo_operacao_id and tb.organization_id = v.organization_id) as codigo_base
       from erp.tipos_operacao_versoes v
       ${where}`,
    [param, ctx.orgId]);
  const l = r.rows[0];
  if (!l) return null;
  // Antes do retorno antecipado: a versão que não executa restrições (formato 1/2, ilegível) ainda responde as regras
  // gerais pela régua da gravação — que, para elas, é o neutro.
  const regrasGerais = regrasGeraisDaCentral(l.codigo_base ? { codigoBase: l.codigo_base, configuracao: l.configuracao } : null);
  const lida = lerConfiguracaoTop(l.configuracao);
  if (!lida.ok || !restricoesExecutamTop(lida.valor)) return { formato: l.configuracao_schema_version, regras: null, regrasGerais };
  return { formato: l.configuracao_schema_version, regras: { versaoId: l.id, formato: l.configuracao_schema_version, config: lida.valor, condicoesPermitidas: l.condicoes && l.condicoes.length ? l.condicoes : null }, regrasGerais };
}

/** Nenhuma linha de versão a ler: formato 0, sem regras, regras gerais neutras. Um objeto novo a cada chamada. */
const NADA_LIDO = (): LidasDaVersaoTop => ({ formato: 0, regras: null, regrasGerais: regrasGeraisNeutrasDaCentral() });

/**
 * O FORMATO e as regras da VERSÃO dada (a versão CONGELADA no documento, `tipo_operacao_versao_id`) — a mesma forma
 * de `regrasDaTopAtual`, para quem precisa do formato além das regras (EDITAR-01, `GET <base>/:id/edicao`: a tela de
 * edição pergunta pela versão em que o documento nasceu, que é a que a PATCH cobra). `formato` 0 = versão ilegível.
 */
export async function regrasDaVersaoCongelada(ctx: ServiceCtx, versaoId: string): Promise<LidasDaVersaoTop> {
  return (await regrasPorFiltro(ctx, "where v.id = $1 and v.organization_id = $2", versaoId)) ?? NADA_LIDO();
}

/** As regras da VERSÃO dada (a versão em que o documento nasceu). `null` = versão não é formato 3 nem 4. */
export async function regrasDaVersaoTop(ctx: ServiceCtx, versaoId: string): Promise<RegrasDaVersaoTop | null> {
  return (await regrasDaVersaoCongelada(ctx, versaoId)).regras;
}

/**
 * As regras da versão ATUAL da TOP (conversão, `/regras-da-operacao`, `/situacao-cliente`). Quem chama já
 * resolveu a TOP pela porta de lançamento; aqui não se decide existência. `formato` 0 = TOP sem versão legível.
 */
export async function regrasDaTopAtual(ctx: ServiceCtx, tipoOperacaoId: string): Promise<LidasDaVersaoTop> {
  return (await regrasPorFiltro(ctx,
    `join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.organization_id = v.organization_id and t.versao_atual = v.versao
      where t.id = $1 and t.organization_id = $2`, tipoOperacaoId)) ?? NADA_LIDO();
}

/**
 * O contrato de `/regras-da-operacao` de vendas: o do domínio + `reservaEstoque` (TOP-CONFIG-07, aditivo) +
 * `regrasGerais` (OPERACOES-01 F2, decisão 279, aditivo e por último).
 */
export type RegrasDaOperacaoDaVenda = RegrasDaOperacaoResposta & { reservaEstoque: boolean; regrasGerais: RegrasGeraisDaCentral };

/** A resposta NEUTRA: sem regras a executar (formato 1/2, ou documento sem TOP) — nada exigido, toda condição, não valida. */
const CLIENTE_EM_ATRASO_NEUTRO = { politica: "nao_valida", toleranciaDias: 0 } as const;

/**
 * A MONTAGEM da resposta das regras da operação — UM dono para as DUAS portas que a servem:
 *   `GET <base>/regras-da-operacao?tipo_operacao_id=` → a versão ATUAL da TOP escolhida (lançamento);
 *   `GET <base>/:id/edicao` (EDITAR-01, decisão 272) → a versão CONGELADA do documento salvo.
 * A pergunta (qual versão) é de cada porta; a FORMA é esta, e só esta: a tela de edição lê o bloco com o MESMO leitor
 * da Central, e duas montagens acabariam divergindo em silêncio (um campo novo aparece numa porta e não na outra).
 * `formato` é o da versão lida (0 = sem versão legível); sem regras do formato 3 a resposta é a NEUTRA.
 * `reservaEstoque` vem de quem chama: cada porta o tira da versão que ela lê (e só pedido pode ser true).
 * `regrasGerais` (F2, decisão 279) é a ÚLTIMA chave, nas duas formas e por isso nas DUAS portas — é o desenho: a
 * versão é a que a porta leu (atual no lançamento, congelada na edição), e `executaRegrasGerais` é a variante, que
 * vem de quem chama com a MESMA condição da gravação (`kind === "sale"`): orçamento e pedido respondem o neutro.
 */
export function respostaDasRegrasDaOperacao(lidas: LidasDaVersaoTop, reservaEstoque: boolean, executaRegrasGerais: boolean): RegrasDaOperacaoDaVenda {
  const { formato, regras } = lidas;
  const regrasGerais = regrasGeraisDaVariante(lidas.regrasGerais, executaRegrasGerais);
  if (!regras) return { formato, exigencias: [], condicoesPermitidas: null, clienteEmAtraso: { ...CLIENTE_EM_ATRASO_NEUTRO }, reservaEstoque, regrasGerais };
  return {
    formato,
    exigencias: camposExigidosTop(regras.config),
    condicoesPermitidas: regras.condicoesPermitidas,
    clienteEmAtraso: { politica: regras.config.financeiro.clienteEmAtraso, toleranciaDias: regras.config.financeiro.toleranciaAtrasoDias },
    reservaEstoque,
    regrasGerais,
  };
}

/** O documento como será gravado — só o que as regras olham. */
export type DocumentoParaRegras = DocumentoParaExigencias & { condicao_pagamento_id?: string | null; client_id?: string | null };

/** Cobra a), b), c) na ordem fixa. Sem regras (formato 1/2) não faz nada. */
export async function cobrarRegrasDaOperacao(
  ctx: ServiceCtx,
  regras: RegrasDaVersaoTop | null,
  doc: DocumentoParaRegras,
  opcoes: { conferirCondicao: boolean; conferirAtraso: boolean },
): Promise<void> {
  if (!regras) return;
  const faltando = exigenciasGeraisFaltando(regras.config, doc);
  if (faltando.length) {
    throw new DomainError(ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA,
      { exigencias: faltando.map((f) => ({ caminho: f.caminho, mensagem: `${f.rotulo} é obrigatório nesta operação.` })) });
  }
  if (opcoes.conferirCondicao && doc.condicao_pagamento_id && regras.condicoesPermitidas && !regras.condicoesPermitidas.includes(doc.condicao_pagamento_id)) {
    throw new DomainError(ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, MENSAGEM_CONDICAO_NAO_PERMITIDA, { campo: "condicao_pagamento_id" });
  }
  if (opcoes.conferirAtraso && regras.config.financeiro.clienteEmAtraso === "bloqueia" && doc.client_id) {
    const s = await situacaoAtrasoCliente(ctx, doc.client_id, regras.config.financeiro.toleranciaAtrasoDias);
    if (s.titulos > 0) {
      throw new DomainError(ERRO_CLIENTE_EM_ATRASO, mensagemClienteEmAtraso(s),
        { campo: "client_id", titulos: s.titulos, total: s.total, vencimentoMaisAntigo: s.vencimentoMaisAntigo });
    }
  }
}
