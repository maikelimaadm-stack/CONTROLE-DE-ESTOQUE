import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getResource } from "@agro/domain";
import { runService, requirePermission } from "../lib/service.js";
import { notFound, validation } from "../lib/errors.js";
import { gerarModelo, importarPlanilha, lerPlanilha, type ResultadoImportacao } from "../lib/importacao.js";
import { createOne } from "./resources.js";

/** Desfaz a transação da importação (prévia, ou arquivo com erro) sem transformar o resultado em erro HTTP. */
class DesfazerImportacao extends Error { constructor(readonly resultado: ResultadoImportacao) { super("importação desfeita"); } }

const ARQUIVO_MAXIMO = 8 * 1024 * 1024;

/**
 * Importação de cadastros por modelo XLSX. Importar é CRIAR em lote: a permissão exigida é a de criar do
 * próprio cadastro, e cada linha passa pelo mesmo `createOne` da tela.
 */
export default async function importRoutes(app: FastifyInstance) {
  const cadastro = (key: string) => { const def = getResource(key); if (!def?.importacao) throw notFound("Importação"); return def; };

  app.get("/imports/:key/modelo", async (req, reply) => {
    const def = cadastro((req.params as { key: string }).key);
    const buf = await runService(app, req, `${def.permission}.create`, (ctx) => gerarModelo(ctx, def));
    return reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("Content-Disposition", `attachment; filename="modelo-${def.key}.xlsx"`).send(buf);
  });

  app.post("/imports/:key", { bodyLimit: Math.ceil(ARQUIVO_MAXIMO * 1.4) + 4096 }, async (req, reply) => {
    const def = cadastro((req.params as { key: string }).key);
    const permissao = `${def.permission}.create`;
    // a capacidade vem ANTES de abrir o arquivo: quem não pode criar não faz o servidor descompactar nada
    requirePermission(app.requireCtx(req), permissao);
    // `modo` (CADASTROS FASE 2): `tudo` é o padrão e o comportamento anterior; valor fora da lista é recusado (422)
    const q = z.object({ simular: z.enum(["0", "1"]).default("0"), modo: z.enum(["tudo", "parcial"]).default("tudo") }).strict().parse(req.query);
    const d = z.object({ arquivo_base64: z.string().min(1) }).strict().parse(req.body);
    const arquivo = Buffer.from(d.arquivo_base64, "base64");
    if (arquivo.byteLength > ARQUIVO_MAXIMO) throw validation("Arquivo maior que 8 MB.");
    const simulacao = q.simular === "1";
    // leitura FORA da transação: nenhuma conexão do pool fica presa enquanto o XLSX é descompactado e percorrido
    const planilha = await lerPlanilha(def, arquivo);
    const modo = q.modo;
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
