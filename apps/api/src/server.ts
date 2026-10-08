import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createPool, type Db } from "@agro/db";
import { loadConfig, type Config } from "./config.js";
import { recusarCorpoLegado, recusarQueryLegada } from "./lib/contrato-legado.js";
import authPlugin from "./plugins/auth.js";
import errorsPlugin from "./plugins/errors.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import resourceRoutes from "./routes/resources.js";
import importRoutes from "./routes/imports.js";
import preferenceRoutes from "./routes/preferences.js";
import savedReportRoutes from "./routes/saved-reports.js";
import adminRoutes from "./routes/admin.js";
import tiposOperacaoRoutes from "./routes/tipos-operacao.js";
import layoutsDocumentoRoutes from "./routes/layouts-documento.js";
import layoutsDocumentoArquivoRoutes from "./routes/layouts-documento-arquivo.js";
import attachmentRoutes from "./routes/attachments.js";
import stockRoutes from "./routes/stock.js";
import supplyRoutes from "./routes/supply.js";
import financialRoutes from "./routes/financial.js";
import financeiroTitulosRoutes from "./routes/financeiro-titulos.js";
import financeiroBancosRoutes from "./routes/financeiro-bancos.js";
import salesRoutes from "./routes/sales.js";
import comprasRoutes from "./routes/compras.js";
import comprasOrcamentoRoutes from "./routes/compras-orcamento.js";
import comprasImportacaoRoutes from "./routes/compras-importacao.js";
import estoqueRoutes from "./routes/estoque-documentos.js";
import aprovacoesVendasRoutes from "./routes/aprovacoes-vendas.js";
import aprovacoesComprasRoutes from "./routes/aprovacoes-compras.js";
import aprovacoesEstoqueRoutes from "./routes/aprovacoes-estoque.js";
import fleetHrRoutes from "./routes/fleet-hr.js";
import rhFuncionariosRoutes from "./routes/rh-funcionarios.js";
import livestockRoutes from "./routes/livestock.js";
import reportRoutes from "./routes/reports.js";
import dashboardRoutes from "./routes/dashboards.js";
import plataformaRoutes from "./routes/plataforma.js";
import referenciaRoutes from "./routes/referencias.js";
import consultaRoutes from "./routes/consultas.js";
import analisesSatelitaisRoutes from "./routes/analises-satelitais.js";
import mapaManejoRoutes from "./routes/mapa-manejo.js";
import rastersSatelitaisRoutes from "./routes/rasters-satelitais.js";
import sateliteConsultasRoutes from "./routes/satelite-consultas.js";
import sateliteCondicaoRoutes from "./routes/satelite-condicao.js";
import sateliteCondicaoPastoRoutes from "./routes/satelite-condicao-pasto.js";
import observacaoSatelitalCompletaRoutes from "./routes/observacao-satelital-completa.js";
import produtosPesquisaRoutes from "./routes/produtos-pesquisa.js";
import type { BuscarFn } from "./lib/consultas/http.js";
import { politicaDeOrigem } from "./lib/cors-origem.js";
import { ClienteCopernicus } from "./lib/satelite/copernicus.js";
import { armazenamentoRaster, type ArmazenamentoRaster } from "./lib/satelite/armazenamento-raster.js";
import { LimiteAvulsoSatelite } from "./lib/satelite/limite-avulso.js";
import { INTERVALO_EXECUTOR_PADRAO_S, limitesDaConfig } from "./lib/satelite/limites.js";
import { redigirUrlAssinada } from "./lib/satelite/url-assinada.js";
import { WorkerSatelite, motivoExecutorDesligado } from "./lib/satelite/worker.js";

/**
 * `criarPool` existe para que a ORDEM de "falha cedo" seja provável por EFEITO, e não por leitura do
 * arquivo. A primeira versão do teste conferia a posição de um substring em `server.ts`; ela passava
 * quando a chamada real migrava para depois do pool (bastava sobrar um comentário citando o nome) e
 * reprovava quando alguém extraía as opções do Fastify para uma variável. Uma catraca que aceita o
 * culpado e acusa o inocente não guarda nada. Com a costura, o teste conta quantos pools nasceram
 * antes da recusa, e a resposta certa é ZERO.
 */
export async function buildApp(opts: {
  config?: Config; db?: Db; logger?: boolean; criarPool?: (dsn: string) => Db;
  /** porta HTTP das consultas externas (CEP/CNPJ); testes injetam mock */ buscarExterno?: BuscarFn;
  /** onde o arquivo do raster satelital é guardado (SAT-06); testes injetam um que falha */ armazenamentoRaster?: ArmazenamentoRaster;
  /** destino do log (testes leem o que foi registrado); ausente = a saída padrão */ logStream?: NodeJS.WritableStream;
} = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  // PRIMEIRA COISA, antes de existir servidor e antes de existir pool: a política de origem é montada
  // a partir do valor BRUTO da configuração e VALIDA o sufixo de preview ali dentro. Sufixo genérico
  // ou malformado lança aqui, e o processo morre sem nunca ter atendido requisição. `loadConfig` já
  // recusa o mesmo valor; esta linha fecha o caminho de quem monta um `Config` à mão (os testes).
  const politicaDeCors = politicaDeOrigem(config.WEB_ORIGIN.split(","), config.WEB_ORIGIN_PREVIEW_SUFFIX);
  // O registro de cada requisição leva a URL: a da imagem satelital assinada (SAT-06) carrega o token na query, e o token
  // NUNCA vai para log — o serializador troca a query dessa rota por um marcador (`redigirUrlAssinada`).
  const registroDeRequisicao = (req: FastifyRequest) => {
    const versao = req.headers?.["accept-version"];
    return {
      method: req.method, url: redigirUrlAssinada(req.url), version: typeof versao === "string" ? versao : undefined, host: req.host,
      remoteAddress: req.ip, remotePort: req.socket ? req.socket.remotePort : undefined
    };
  };
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.API_LOG_LEVEL, serializers: { req: registroDeRequisicao }, ...(opts.logStream ? { stream: opts.logStream } : {}) },
    bodyLimit: 5 * 1024 * 1024, trustProxy: true
  });
  const db = opts.db ?? (opts.criarPool ?? createPool)(config.DATABASE_URL);
  app.decorate("db", db);
  app.decorate("config", config);
  app.decorate("buscarExterno", opts.buscarExterno ?? ((url, init) => fetch(url, init)));
  // SAT-03 (decisão 296): UM cliente Copernicus por PROCESSO — a rota avulsa da SAT-01 e o executor da fila emitem e
  // reaproveitam o MESMO token (o provedor limita a emissão). Decorado ANTES das rotas: elas o leem no registro.
  const clienteCopernicus = new ClienteCopernicus({
    buscar: app.buscarExterno,
    credenciais: config.COPERNICUS_CLIENT_ID && config.COPERNICUS_CLIENT_SECRET ? { clienteId: config.COPERNICUS_CLIENT_ID, segredo: config.COPERNICUS_CLIENT_SECRET } : null
  });
  app.decorate("clienteCopernicus", clienteCopernicus);
  // SAT-06 (decisão 297): o estado do pedido avulso ao provedor (chamadas em voo + piso por instância) é UM objeto por
  // processo, compartilhado pela análise da SAT-01 e pela imagem por pixel — o mesmo limite, as mesmas vagas.
  const limiteAvulsoSatelite = new LimiteAvulsoSatelite(limitesDaConfig(config));
  app.decorate("limiteAvulsoSatelite", limiteAvulsoSatelite);
  const armazenamentoRasterEfetivo = opts.armazenamentoRaster ?? armazenamentoRaster;
  app.decorate("armazenamentoRaster", armazenamentoRasterEfetivo);
  // O EXECUTOR DA FILA SATELITAL só existe com as três condições (SATELITE_WORKER_ENABLED, COPERNICUS_ENABLED e a
  // credencial); faltando uma, UMA linha de log diz qual (sem valor nenhum) e nada é reservado — a API sobe igual.
  const motivoDesligado = motivoExecutorDesligado(config, clienteCopernicus);
  const executorSatelite = motivoDesligado ? null : new WorkerSatelite({
    db, cliente: clienteCopernicus, limites: limitesDaConfig(config), log: app.log,
    limiteAvulso: limiteAvulsoSatelite, copernicusEnabled: config.COPERNICUS_ENABLED,
    armazenamento: armazenamentoRasterEfetivo,
    intervaloMs: (config.SATELITE_WORKER_INTERVALO_S ?? INTERVALO_EXECUTOR_PADRAO_S) * 1000
  });
  app.decorate("executorSatelite", executorSatelite);
  if (executorSatelite) {
    app.addHook("onReady", async () => {
      executorSatelite.iniciar();
      app.log.info({ satelite_executor: "ligado" }, "executor da fila satelital iniciado");
    });
  } else {
    app.log.info({ satelite_executor: "desligado", motivo: motivoDesligado }, "executor da fila satelital não iniciado");
  }
  await app.register(helmet, { contentSecurityPolicy: false });
  // Origem exata (produção) OU preview ancorado na conta do projeto. A decisão mora em `cors-origem.ts`,
  // com o porquê de não existir curinga de provedor aqui: `credentials` está ligado.
  await app.register(cors, { origin: politicaDeCors, credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "X-Org-Id", "X-Empresa-Id", "Idempotency-Key"] });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: "1 minute" });
  await app.register(errorsPlugin);
  await app.register(authPlugin);
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(resourceRoutes, { prefix: "/api" });
  await app.register(importRoutes, { prefix: "/api" });
  await app.register(preferenceRoutes, { prefix: "/api" });
  await app.register(savedReportRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api" });
  await app.register(tiposOperacaoRoutes, { prefix: "/api" });
  await app.register(layoutsDocumentoRoutes, { prefix: "/api" });
  await app.register(layoutsDocumentoArquivoRoutes, { prefix: "/api" });
  await app.register(attachmentRoutes, { prefix: "/api" });
  await app.register(stockRoutes, { prefix: "/api" });
  await app.register(supplyRoutes, { prefix: "/api" });
  await app.register(financialRoutes, { prefix: "/api" });
  // OPERACOES-01 F8 (decisão 285): a Central Financeira mora num prefixo PRÓPRIO, /api/financeiro. A API anterior
  // responde 404 de rota a `GET /api/financeiro/capacidades` — e a web nova lê esse 404 como "tela de hoje".
  await app.register(financeiroTitulosRoutes, { prefix: "/api" });
  await app.register(financeiroBancosRoutes, { prefix: "/api" });
  await app.register(salesRoutes, { prefix: "/api" });
  await app.register(comprasRoutes, { prefix: "/api" });
  await app.register(comprasOrcamentoRoutes, { prefix: "/api" });
  // OPERACOES-01 F7 (decisão 284): a importação do XML da NF-e na Central de Compras (/api/compras/importacoes). A API
  // anterior responde 404 de rota — e a web nova só chama estas rotas com `capacidades.importacaoXml`.
  await app.register(comprasImportacaoRoutes, { prefix: "/api" });
  await app.register(estoqueRoutes, { prefix: "/api" });
  // TOP-CONFIG-08 (decisão 277): as aprovações moram num prefixo PRÓPRIO, /api/aprovacoes, e não dentro de
  // /api/sales, /api/compras ou /api/estoque. Assim o binário anterior, que não conhece estas rotas,
  // responde 404 limpo — e a web nova lê esse 404 como "aprovações ainda não disponíveis neste servidor".
  await app.register(aprovacoesVendasRoutes, { prefix: "/api" });
  await app.register(aprovacoesComprasRoutes, { prefix: "/api" });
  await app.register(aprovacoesEstoqueRoutes, { prefix: "/api" });
  await app.register(fleetHrRoutes, { prefix: "/api" });
  await app.register(rhFuncionariosRoutes, { prefix: "/api" });
  await app.register(livestockRoutes, { prefix: "/api" });
  await app.register(reportRoutes, { prefix: "/api" });
  await app.register(dashboardRoutes, { prefix: "/api" });
  await app.register(plataformaRoutes, { prefix: "/api" });
  await app.register(referenciaRoutes, { prefix: "/api" });
  await app.register(consultaRoutes, { prefix: "/api" });
  await app.register(analisesSatelitaisRoutes, { prefix: "/api" });
  await app.register(mapaManejoRoutes, { prefix: "/api" });
  await app.register(rastersSatelitaisRoutes, { prefix: "/api" });
  await app.register(sateliteConsultasRoutes, { prefix: "/api" });
  await app.register(sateliteCondicaoRoutes, { prefix: "/api" });
  await app.register(sateliteCondicaoPastoRoutes, { prefix: "/api" });
  await app.register(observacaoSatelitalCompletaRoutes, { prefix: "/api" });
  await app.register(produtosPesquisaRoutes, { prefix: "/api" });
  // ------------------------------------------------------------------------------------------------
  // CONTRATO NEGATIVO DO NOME ANTIGO DE EMPRESA (PRE-BASE2-05B).
  // A borda de COMPATIBILIDADE acabou: não há mais tradução de entrada nem apelido de saída. O que sobra é
  // uma lápide que RECUSA o contrato anterior — porque schema `z.object` descarta chave desconhecida, e um
  // `farm_id` descartado em silêncio mudaria a empresa da operação sem ninguém ver. Ver `lib/contrato-legado.ts`.
  // ------------------------------------------------------------------------------------------------
  app.addHook("preValidation", async (req) => {
    recusarCorpoLegado(req.body);
    recusarQueryLegada(req.query);
  });
  // O executor para (e termina a rodada em curso) ANTES de o pool fechar: no mesmo gancho, a ordem não depende do Fastify.
  app.addHook("onClose", async () => { await executorSatelite?.parar(); if (!opts.db) await db.end(); });
  return app;
}
