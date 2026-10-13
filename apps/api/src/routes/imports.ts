import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getResource, type ResourceDef } from "@agro/domain";
import { runService, requirePermission } from "../lib/service.js";
import { notFound, validation } from "../lib/errors.js";
import { ACOES_IMPORTACAO, MSG_SEM_CODIGO, aceitaAtualizar, atualizarPlanilha, gerarModelo, importarPlanilha, lerPlanilha, type AcaoImportacao, type ResultadoAtualizacao, type ResultadoImportacao } from "../lib/importacao.js";
import { createOne, getOne, updateOne } from "./resources.js";

/** Desfaz a transação da importação (prévia, ou arquivo com erro) sem transformar o resultado em erro HTTP. */
class DesfazerImportacao extends Error { constructor(readonly resultado: ResultadoImportacao) { super("importação desfeita"); } }

const ARQUIVO_MAXIMO = 8 * 1024 * 1024;

/**
 * A CAPACIDADE de cada ação (decisão 317): CRIAR exige `<cadastro>.create`; ATUALIZAR exige `<cadastro>.edit`. Cada
 * ação a SUA — nunca uma OU outra.
 */
const permissaoDaAcao = (def: ResourceDef, acao: AcaoImportacao) => `${def.permission}.${acao === "atualizar" ? "edit" : "create"}`;

/**
 * Importação de cadastros por modelo XLSX. Duas ações, escolha EXPLÍCITA pelo parâmetro `acao` (IMPORTAR-01,
 * decisão 317), nunca inferida do arquivo:
 *   · `criar` (o padrão, sem o parâmetro — o pedido de sempre): importar é CRIAR em lote; a permissão é a de criar do
 *     próprio cadastro, e cada linha passa pelo mesmo `createOne` da tela. Nada mudou;
 *   · `atualizar`: casa pelo CÓDIGO e altera só as colunas presentes; a permissão é a de editar, e cada linha passa
 *     pela mesma porta de edição da tela (`getOne` + `updateOne`). Só em cadastro importável com código.
 * `acao` é um eixo próprio: `modo` (tudo | parcial) continua dizendo só o que fazer com as linhas com erro.
 */
export default async function importRoutes(app: FastifyInstance) {
  const cadastro = (key: string) => { const def = getResource(key); if (!def?.importacao) throw notFound("Importação"); return def; };

  app.get("/imports/:key/modelo", async (req, reply) => {
    const def = cadastro((req.params as { key: string }).key);
    // sem `acao`, o pedido de sempre (a consulta continua não lida, como antes); com ela, o contrato novo é estrito
    const consulta = (req.query ?? {}) as Record<string, unknown>;
    const acao: AcaoImportacao = "acao" in consulta ? z.object({ acao: z.enum(ACOES_IMPORTACAO) }).strict().parse(consulta).acao : "criar";
    if (acao === "atualizar" && !aceitaAtualizar(def)) throw validation(MSG_SEM_CODIGO);
    const buf = await runService(app, req, permissaoDaAcao(def, acao), (ctx) => gerarModelo(ctx, def, acao));
    return reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("Content-Disposition", `attachment; filename="modelo-${def.key}${acao === "atualizar" ? "-atualizar" : ""}.xlsx"`).send(buf);
  });

  app.post("/imports/:key", { bodyLimit: Math.ceil(ARQUIVO_MAXIMO * 1.4) + 4096 }, async (req, reply) => {
    const def = cadastro((req.params as { key: string }).key);
    // a AÇÃO decide a capacidade, então é lida primeiro (fora da lista ⇒ 422); o resto da consulta é conferido depois,
    // como antes — o pedido do CRIAR sem `acao` segue exatamente o caminho de sempre
    const acao = z.object({ acao: z.enum(ACOES_IMPORTACAO).default("criar") }).passthrough().parse(req.query ?? {}).acao;
    const permissao = permissaoDaAcao(def, acao);
    // a capacidade vem ANTES de abrir o arquivo: quem não pode criar (ou editar) não faz o servidor descompactar nada
    requirePermission(app.requireCtx(req), permissao);
    // `modo` (CADASTROS FASE 2): `tudo` é o padrão e o comportamento anterior; valor fora da lista é recusado (422)
    const q = z.object({ simular: z.enum(["0", "1"]).default("0"), modo: z.enum(["tudo", "parcial"]).default("tudo"), acao: z.enum(ACOES_IMPORTACAO).default("criar") }).strict().parse(req.query);
    if (acao === "atualizar" && !aceitaAtualizar(def)) throw validation(MSG_SEM_CODIGO);
    const d = z.object({ arquivo_base64: z.string().min(1) }).strict().parse(req.body);
    const arquivo = Buffer.from(d.arquivo_base64, "base64");
    if (arquivo.byteLength > ARQUIVO_MAXIMO) throw validation("Arquivo maior que 8 MB.");
    const simulacao = q.simular === "1";
    // leitura FORA da transação: nenhuma conexão do pool fica presa enquanto o XLSX é descompactado e percorrido
    const planilha = await lerPlanilha(def, arquivo, acao);
    const modo = q.modo;
    if (acao === "atualizar") {
      if (planilha.erros.length) return reply.status(422).send({ linhas: 0, gravadas: 0, erros: planilha.erros, simulacao, modo, certas: 0, com_erro: 0, planilha_erros_base64: null, acao, casaram: 0, nao_casaram: 0, sem_alteracao: 0, alteracoes: [] } satisfies ResultadoAtualizacao);
      try {
        const r = await runService(app, req, permissao, async (ctx) => {
          const res = await atualizarPlanilha(ctx, def, planilha, { ler: getOne, atualizar: updateOne }, simulacao, modo);
          // prévia: desfaz sempre. tudo: qualquer erro desfaz. parcial: grava as certas; nenhuma certa desfaz
          if (simulacao || (modo === "tudo" ? res.erros.length > 0 : res.certas === 0)) throw new DesfazerImportacao(res);
          return res;
        });
        app.clearContextCache?.();
        // nada é criado: 200 (com `gravadas` = as que mudaram)
        return reply.status(200).send(r);
      } catch (e) {
        if (!(e instanceof DesfazerImportacao)) throw e;
        const recusa = simulacao ? (modo === "parcial" ? e.resultado.certas === 0 : e.resultado.erros.length > 0) : true;
        return reply.status(recusa ? 422 : 200).send({ ...e.resultado, gravadas: 0 });
      }
    }
    if (planilha.erros.length) return reply.status(422).send({ linhas: 0, gravadas: 0, erros: planilha.erros, simulacao, modo, certas: 0, com_erro: 0, planilha_erros_base64: null } satisfies ResultadoImportacao);
    try {
      const r = await runService(app, req, permissao, async (ctx) => {
        const res = await importarPlanilha(ctx, def, planilha, createOne, simulacao, modo);
        // tudo: qualquer erro desfaz. parcial: grava as certas; zero certas (ou falha no ID Global) desfaz
        if (simulacao || res.gravadas === 0 || (modo === "tudo" && res.erros.length)) throw new DesfazerImportacao(res);
        return res;
      });
      app.clearContextCache?.();
      return reply.status(201).send(r);
    } catch (e) {
      if (!(e instanceof DesfazerImportacao)) throw e;
      // prévia: 200 com o que SERIA gravado; nada gravável: 422 com a lista, e nada gravado
      const recusa = simulacao ? (modo === "parcial" ? e.resultado.certas === 0 : e.resultado.erros.length > 0) : true;
      return reply.status(recusa ? 422 : 200).send({ ...e.resultado, gravadas: 0 });
    }
  });
}
