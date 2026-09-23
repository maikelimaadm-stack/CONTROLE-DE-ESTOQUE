import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  FORMA_CODIGO_TIPO_OPERACAO,
  LIMITE_DESCRICAO_TIPO_OPERACAO,
  LIMITE_NOME_TIPO_OPERACAO,
  chaveI18nDaFamiliaOperacional,
  familiaOperacionalDeclarada,
  familiasOperacionaisDisponiveis,
  moduloDaFamiliaOperacional,
  VERSAO_SCHEMA_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V2,
  VERSOES_SCHEMA_CONFIGURACAO_TOP,
  SECOES_CONFIGURACAO_TOP,
  MATRIZ_EXECUCAO_TOP,
  configuracaoNeutraTopV2,
  configuracoesTopIguais,
  efeitosAtivadosTop,
  execucaoDeclaradaTop,
  lerConfiguracaoTop,
  secoesAlteradasTop,
  validarExecucaoTop,
  lerDestinosOperacao,
  destinosOperacaoIguais,
  validarDestinoOperacao,
  varianteDeDocumentoVendaDaFamilia,
  LIMITE_DESTINOS_POR_VERSAO,
  type DestinoOperacaoV1,
  type ConfiguracaoTipoOperacao
} from "@agro/domain";
import { DomainError } from "@agro/shared";
import { criarTradutor, ptBR } from "@erp/plataforma";
import { runService, audit } from "../lib/service.js";
import { notFound } from "../lib/errors.js";
import { pageQuerySchema } from "../lib/pagination.js";
import type { ServiceCtx } from "../lib/context.js";

/**
 * ADMINISTRAÇÃO DAS TOPs CONFIGURADAS (TOP-CONFIG-01).
 *
 * ESTA API É SÓ DE CONFIGURAÇÃO. Nenhuma tela de lançamento a consome nesta fatia: os detalhes do Modelo
 * Base 2 continuam resolvendo a classificação pelo REGISTRY em memória (`tipoOperacaoDoRegistro`), sem rede.
 * Ligar lançamento e TOP é a TOP-CONFIG-02, e fazer isso agora criaria dependência de rede numa tela que
 * hoje não tem nenhuma — regressão de disponibilidade em troca de nada.
 *
 * RECURSO DA ORGANIZAÇÃO, NÃO DA EMPRESA. `erp.tipos_operacao` não tem coluna de empresa, e `tipos_operacao`
 * está em `RECURSOS_ORGANIZACAO`. Por isso `runService` resolve módulo `null` e não há escopo empresarial a
 * cruzar: quem tem a capacidade, tem na organização inteira. Nenhuma consulta aqui usa `empresaScope`.
 *
 * SUPERFÍCIE DE RECUSA. Registro inexistente, de outro tenant ou excluído respondem a MESMA 404 — a consulta
 * filtra por `organization_id` e `excluido_em is null` ANTES de qualquer decisão, então o servidor não sabe
 * distinguir os três casos e não tem como vazar a diferença. 403 fica para falta de capacidade.
 */

/**
 * O rótulo humano da família sai do CATÁLOGO pt-BR, pela chave que o registry declara (`top.vendas.venda`).
 * A TOP configurada nunca guarda esse rótulo: guardá-lo seria uma cópia que envelhece quando o catálogo
 * mudar, e a tela passaria a exibir dois nomes para a mesma família sem ninguém perceber.
 */
const t = criarTradutor(ptBR);

/** Uma família canônica, como a tela precisa vê-la: código técnico + rótulo humano + módulo. */
const familiaParaTela = (codigo: string) => ({
  codigo,
  rotulo: t(chaveI18nDaFamiliaOperacional(codigo) ?? codigo),
  modulo: moduloDaFamiliaOperacional(codigo) ?? null
});

const codigoSchema = z.string().trim().regex(FORMA_CODIGO_TIPO_OPERACAO, "Código inválido");
const nomeSchema = z.string().trim().min(1).max(LIMITE_NOME_TIPO_OPERACAO);
const descricaoSchema = z.string().trim().max(LIMITE_DESCRICAO_TIPO_OPERACAO).optional().nullable();

/**
 * `.strict()` NAS TRÊS ENTRADAS DE ESCRITA — porque `z.object` descarta chave desconhecida EM SILÊNCIO.
 *
 * `{ "ativoo": false, "revisao": 3 }` virava 200 com o campo ignorado: o administrador lia "salvo", e a TOP
 * continuava ativa. Descarte silencioso de campo é ampliação de escopo pela porta de trás (`backend-api.md`),
 * e num cadastro de configuração ele é especialmente caro, porque ninguém confere o efeito depois.
 * Com `.strict()`, o erro de digitação é 422 e nada é escrito.
 */
const criarSchema = z.object({
  codigo: codigoSchema,
  codigoBase: z.string().trim(),
  nome: nomeSchema,
  descricao: descricaoSchema,
  ativo: z.boolean().default(true),
  padrao: z.boolean().default(false),
  /**
   * OPCIONAL, E ISSO É O CONTRATO DE COMPATIBILIDADE.
   *
   * A web ANTIGA não manda este campo, e durante o rolling deploy ela continua criando TOPs contra a API
   * nova. Exigir configuração aqui quebraria a criação no meio da implantação. Ausente significa "quem
   * chamou não declarou nada" — e a leitura honesta disso é o NEUTRO, não uma configuração inventada.
   *
   * `z.unknown()` de propósito: quem valida a forma é o DOMÍNIO (`lerConfiguracaoTop`), que é o dono do
   * contrato. Reescrever o schema em zod aqui criaria uma segunda definição, livre para divergir da
   * primeira — e divergir para o lado permissivo é exatamente o descarte silencioso que se quer evitar.
   */
  configuracao: z.unknown().optional(),
  /** Grafo de próximas operações. Ausente = nenhuma transição declarada. Mesma razão do `z.unknown()`. */
  destinos: z.unknown().optional()
}).strict();

/**
 * ENTRADA DA EDIÇÃO — `codigo` e `codigoBase` NÃO ESTÃO AQUI, e isso é deliberado.
 *
 * `z.object` descarta chave desconhecida em silêncio, e descarte silencioso de campo de identidade é
 * ampliação de escopo: quem mandasse `codigoBase` novo receberia 200 e acharia que trocou a família.
 * Por isso a rota RECUSA explicitamente (422) antes de validar o resto, e o gatilho da 0020 barra quem
 * chegar por fora da API.
 */
const editarSchema = z.object({
  nome: nomeSchema.optional(),
  descricao: descricaoSchema,
  ativo: z.boolean().optional(),
  padrao: z.boolean().optional(),
  revisao: z.coerce.number().int().min(1),
  /** Ausente = PRESERVAR a configuração atual. Ver `configuracaoPedida` e o handler de edição. */
  configuracao: z.unknown().optional(),
  /** Ausente = PRESERVAR os destinos da versão corrente, pelo mesmo motivo. */
  destinos: z.unknown().optional()
}).strict();

/**
 * A EXCLUSÃO TAMBÉM É UMA ESCRITA, e por isso também exige a revisão conhecida pelo cliente.
 *
 * Sem ela: o administrador A lê a revisão 5, o B edita (vira 6), e o A exclui com a tela velha — a exclusão
 * vence em silêncio uma alteração que o A nunca viu. É o mesmo lost update que o PUT já impedia, pela única
 * porta que tinha ficado aberta. Vai na query porque o DELETE não tem corpo por convenção.
 */
const excluirSchema = z.object({ revisao: z.coerce.number().int().min(1) }).strict();

const SELECAO = `
  select t.id, t.codigo, t.codigo_base, t.ativo, t.padrao, t.versao_atual, t.revisao,
         t.criado_em, t.atualizado_em,
         v.id as versao_id, v.nome, v.descricao, v.configuracao, v.configuracao_schema_version,
         v.destinos_configurados
    from erp.tipos_operacao t
    join erp.tipos_operacao_versoes v
      on v.tipo_operacao_id = t.id and v.versao = t.versao_atual
`;

/** O que o `returning` de `liberarPadrao` devolve: exatamente quem o banco alterou. */
interface PadraoLiberado { id: string; codigo: string; codigo_base: string }

interface LinhaTipoOperacao {
  id: string; codigo: string; codigo_base: string; ativo: boolean; padrao: boolean;
  versao_atual: number; revisao: number; criado_em: Date; atualizado_em: Date;
  versao_id: string; nome: string; descricao: string | null;
  configuracao: unknown; configuracao_schema_version: number;
  /**
   * A POLÍTICA DE PRÓXIMAS OPERAÇÕES CHEGOU A SER DECLARADA NESTA VERSÃO?
   *
   * É o único jeito de separar "ninguém nunca declarou" (acervo, e a conversão segue a cadeia antiga) de
   * "declarei que não há próxima operação" (a conversão é RECUSADA). Contar as arestas responde as duas
   * coisas com o mesmo zero. Ver o cabeçalho da coluna na migration 0022.
   */
  destinos_configurados: boolean;
}

/**
 * A CONFIGURAÇÃO PEDIDA PELO CLIENTE, VALIDADA — ou uma recusa estável.
 *
 * Dois códigos de erro, e não um por campo: quem consome precisa distinguir "o formato é de outra versão
 * do produto" (nada a corrigir no formulário; é questão de implantação) de "há campo inválido aqui" (o
 * usuário conserta). Um código por checkbox transformaria o contrato de erro num segundo schema, que
 * envelheceria à parte do primeiro.
 *
 * O `caminho` de cada recusa nomeia a FORMA do payload, nunca dado de outra organização — não há
 * superfície de vazamento: quem manda o corpo já sabe o que mandou.
 */
function configuracaoPedida(bruta: unknown): ConfiguracaoTipoOperacao {
  const r = lerConfiguracaoTop(bruta);
  if (r.ok) return r.valor;
  const schema = r.recusas.find((x) => x.motivo === "schema_nao_suportado");
  if (schema) {
    throw new DomainError("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO",
      "A configuração enviada usa uma versão de formato que este servidor não conhece",
      { versaoSuportada: VERSAO_SCHEMA_CONFIGURACAO_TOP, versoesSuportadas: [...VERSOES_SCHEMA_CONFIGURACAO_TOP] });
  }
  throw new DomainError("TIPO_OPERACAO_CONFIGURACAO_INVALIDA",
    "A configuração operacional enviada é inválida", { recusas: r.recusas });
}

/**
 * A EXECUÇÃO PEDIDA PODE SER GRAVADA? — a porta de ativação da TOP-CONFIG-04A, ANTES de qualquer escrita.
 *
 * Duas perguntas, nesta ordem, e cada uma com o seu código:
 *
 *   1. A COMBINAÇÃO É EXECUTÁVEL para esta família? (matriz de suporte, `validarExecucaoTop`)
 *      Não → `TIPO_OPERACAO_CONFIGURACAO_INVALIDA` (422), com as recusas por caminho e a mensagem em
 *      português. É uma resposta sobre o PEDIDO, e vale com o gate ligado ou desligado: família sem
 *      consumidor não ganha execução nem quando o gate ligar.
 *   2. ESTA INSTÂNCIA pode pôr execução configurada em circulação agora? (gate operacional)
 *      Não → `TIPO_OPERACAO_EXECUCAO_INDISPONIVEL` (409). É estado do servidor, não erro do formulário.
 *
 * O que conta como ATIVAÇÃO é decisão do domínio (`efeitosAtivadosTop`): passar um efeito para
 * `configurada`, ou mudar o que um efeito configurado executa. Voltar para `legado` e renomear não são
 * ativação — com o gate desligado, reduzir o risco tem de continuar possível.
 */
function conferirExecucaoPedida(
  codigoBase: string,
  vigente: ConfiguracaoTipoOperacao | null,
  pedida: ConfiguracaoTipoOperacao,
  execucaoHabilitada: boolean,
): void {
  const recusas = validarExecucaoTop(codigoBase, pedida);
  if (recusas.length) {
    const mensagens = [...new Set(recusas.map((r) => r.mensagem))];
    throw new DomainError("TIPO_OPERACAO_CONFIGURACAO_INVALIDA", mensagens.join(" "), { recusas });
  }
  if (execucaoHabilitada) return;
  const ativados = efeitosAtivadosTop(vigente, pedida);
  if (ativados.length) {
    throw new DomainError("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL",
      "A execução configurada ainda não está habilitada neste ambiente. Mantenha o comportamento legado; a ativação fica disponível quando a implantação for concluída.",
      { efeitos: ativados });
  }
}

/**
 * A CONFIGURAÇÃO GUARDADA, LIDA PARA A TELA — sem nunca derrubar a leitura.
 *
 * O payload no banco é `unknown`: ele pode ter sido escrito por uma versão FUTURA do produto (durante um
 * rollback, por exemplo) ou estar corrompido. Nos dois casos, a leitura do HISTÓRICO precisa continuar
 * funcionando: quem abre "ver versões" para investigar um documento de dois anos atrás não pode receber
 * uma tela branca porque UMA das versões não é legível.
 *
 * Então o não-legível vira ESTADO DECLARADO (`suportada: false`) em vez de exceção — e, por ser declarado,
 * a tela pode mostrar "configuração registrada num formato que esta versão não interpreta" no lugar de
 * inventar valores. O que NUNCA acontece é reinterpretar silenciosamente: um payload v2 lido com o
 * dicionário v1 não dá erro, dá significado trocado.
 */
type ConfiguracaoParaTela =
  | { suportada: true; versaoSchema: number; valor: ConfiguracaoTipoOperacao }
  | { suportada: false; versaoSchema: number };

function configuracaoParaTela(bruta: unknown, versaoSchema: number): ConfiguracaoParaTela {
  // A COLUNA E O PAYLOAD TÊM DE CONCORDAR. A 0022 já garante isso no banco; conferir aqui de novo é o que
  // impede um formato de ser lido pelo número do outro se a garantia algum dia mudar.
  if (!(VERSOES_SCHEMA_CONFIGURACAO_TOP as readonly number[]).includes(versaoSchema)) return { suportada: false, versaoSchema };
  const r = lerConfiguracaoTop(bruta);
  return r.ok && r.valor.versaoSchema === versaoSchema ? { suportada: true, versaoSchema, valor: r.valor } : { suportada: false, versaoSchema };
}

/**
 * A LISTAGEM NÃO CARREGA A CONFIGURAÇÃO INTEIRA.
 *
 * Uma página de 50 TOPs traria 50 payloads que ninguém lê para decidir em qual clicar — tráfego e parse
 * proporcionais ao tamanho do cadastro, para nada. O que a lista precisa é de identidade e estado; a
 * configuração é do DETALHE, sob demanda. Vai só a versão de schema, que é um inteiro e responde
 * "esta linha é legível por este cliente?".
 */
const paraTela = (r: LinhaTipoOperacao) => ({
  id: r.id,
  codigo: r.codigo,
  nome: r.nome,
  descricao: r.descricao,
  familia: familiaParaTela(r.codigo_base),
  ativo: r.ativo,
  padrao: r.padrao,
  versao: r.versao_atual,
  revisao: r.revisao,
  criadoEm: r.criado_em,
  atualizadoEm: r.atualizado_em,
  configuracaoSchema: r.configuracao_schema_version
});

/**
 * OS DESTINOS PEDIDOS, LIDOS E NORMALIZADOS — forma primeiro, existência depois.
 *
 * A forma é do domínio (`lerDestinosOperacao`): é lá que mora o que conta como lista válida, o teto, a
 * recusa de chave desconhecida e a normalização determinística que impede versão falsa por reordenação.
 */
function destinosPedidos(bruta: unknown): DestinoOperacaoV1[] {
  const r = lerDestinosOperacao(bruta);
  if (r.ok) return r.valor;
  throw new DomainError("TIPO_OPERACAO_DESTINO_INVALIDO",
    "A lista de próximas operações enviada é inválida", { recusas: r.recusas, limite: LIMITE_DESTINOS_POR_VERSAO });
}

/** Uma aresta do grafo, já resolvida para a tela. */
interface DestinoResolvido {
  tipoOperacaoId: string; ordem: number; codigo: string; nome: string;
  codigoBase: string; familiaRotulo: string; ativo: boolean; disponivel: boolean;
}

/**
 * CONFERE OS DESTINOS PEDIDOS CONTRA O BANCO E CONTRA O REGISTRY — em UMA consulta.
 *
 * ┌─ POR QUE UMA CONSULTA, E NÃO UMA POR DESTINO ───────────────────────────────────────────────────────┐
 * │ `= any($2::uuid[])` resolve a lista inteira de uma vez. Um `await` dentro de um laço aqui viraria    │
 * │ vinte consultas numa política com vinte destinos, e nenhuma asserção funcional notaria — o resultado │
 * │ seria idêntico, só mais lento. É a regra de N+1 do repositório, e ela vale também para escrita.      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * SUPERFÍCIE ÚNICA DE RECUSA. Destino inexistente, de outro tenant, inativo, excluído e de família
 * incompatível respondem a MESMA recusa, com a mesma mensagem. Distinguir transformaria o editor num
 * oráculo: quem tentasse UUIDs saberia quais existem na organização vizinha e de que família cada um é.
 * É a mesma razão que faz inexistente e fora de escopo responderem a mesma 404.
 *
 * `for share` nas linhas de destino: elas não podem ser excluídas entre esta conferência e o `insert` das
 * arestas, ou a política nasceria apontando para uma TOP que deixou de existir dentro da mesma janela.
 */
async function conferirDestinos(
  ctx: ServiceCtx, origemCodigoBase: string, pedidos: readonly DestinoOperacaoV1[]
): Promise<DestinoOperacaoV1[]> {
  if (pedidos.length === 0) return [];
  const ids = pedidos.map((d) => d.tipoOperacaoId);
  const r = await ctx.tx.query<{ id: string; codigo_base: string }>(
    `select id, codigo_base from erp.tipos_operacao
      where organization_id = $1 and id = any($2::uuid[]) and ativo and excluido_em is null
      for share`,
    [ctx.orgId, ids]);
  const porId = new Map(r.rows.map((x) => [x.id, x]));

  for (const pedido of pedidos) {
    const achado = porId.get(pedido.tipoOperacaoId);
    // A recusa NÃO diz qual das cinco razões foi. Ver o bloco acima.
    if (!achado || validarDestinoOperacao(origemCodigoBase, achado.codigo_base).length > 0) {
      throw new DomainError("TIPO_OPERACAO_INDISPONIVEL",
        "Uma das próximas operações escolhidas não está disponível para esta operação");
    }
  }
  return [...pedidos];
}

/**
 * OS DESTINOS DE UMA VERSÃO, PARA A TELA — em lote, nunca por linha.
 *
 * `disponivel` é a pergunta do PRESENTE ("esta TOP ainda serve hoje?") e é calculada aqui, contra o estado
 * atual da TOP de destino. Ela é DIFERENTE de a aresta existir: a aresta é história congelada na versão, e
 * nunca deixa de existir; o destino é que pode ter sido desativado ou excluído desde então. Colapsar as
 * duas apagaria do histórico uma política que de fato valeu.
 */
async function destinosDaVersao(ctx: ServiceCtx, versaoIds: readonly string[]): Promise<Map<string, DestinoResolvido[]>> {
  const mapa = new Map<string, DestinoResolvido[]>();
  if (versaoIds.length === 0) return mapa;
  const r = await ctx.tx.query<{
    origem_versao_id: string; destino_tipo_operacao_id: string; ordem: number;
    codigo: string; nome: string; codigo_base: string; ativo: boolean; excluido: boolean;
  }>(
    `select d.origem_versao_id, d.destino_tipo_operacao_id, d.ordem,
            t.codigo, tv.nome, t.codigo_base, t.ativo,
            (t.excluido_em is not null) as excluido
       from erp.tipos_operacao_versao_destinos d
       join erp.tipos_operacao t
         on t.id = d.destino_tipo_operacao_id and t.organization_id = d.organization_id
       left join erp.tipos_operacao_versoes tv
         on tv.tipo_operacao_id = t.id and tv.organization_id = t.organization_id and tv.versao = t.versao_atual
      where d.organization_id = $1 and d.origem_versao_id = any($2::uuid[])
      order by d.ordem, t.codigo`,
    [ctx.orgId, [...versaoIds]]);

  for (const linha of r.rows) {
    const lista = mapa.get(linha.origem_versao_id) ?? [];
    lista.push({
      tipoOperacaoId: linha.destino_tipo_operacao_id,
      ordem: linha.ordem,
      codigo: linha.codigo,
      // O nome sai da versão CORRENTE do destino, porque o destino é identidade estável: quem escolher
      // esta próxima operação hoje vai criar um documento sob a versão de hoje, e o rótulo tem de
      // corresponder ao que será criado.
      nome: linha.nome ?? linha.codigo,
      codigoBase: linha.codigo_base,
      familiaRotulo: familiaParaTela(linha.codigo_base).rotulo,
      ativo: linha.ativo,
      disponivel: linha.ativo && !linha.excluido
    });
    mapa.set(linha.origem_versao_id, lista);
  }
  return mapa;
}

/** Grava as arestas de UMA versão. Uma instrução para a lista inteira: nada de `insert` dentro de laço. */
async function gravarDestinos(ctx: ServiceCtx, versaoId: string, tipoOperacaoId: string, destinos: readonly DestinoOperacaoV1[]) {
  if (destinos.length === 0) return;
  await ctx.tx.query(
    `insert into erp.tipos_operacao_versao_destinos
       (organization_id, origem_versao_id, origem_tipo_operacao_id, destino_tipo_operacao_id, ordem, criado_por)
     select $1, $2, $3, x.destino::uuid, x.ordem::int, $4
       from jsonb_to_recordset($5::jsonb) as x(destino text, ordem int)`,
    [ctx.orgId, versaoId, tipoOperacaoId, ctx.user.id,
     JSON.stringify(destinos.map((d) => ({ destino: d.tipoOperacaoId, ordem: d.ordem })))]);
}

/** Só a identidade e a ordem entram na comparação de no-op: código e nome são apresentação, não política. */
const soPolitica = (d: readonly DestinoResolvido[]): DestinoOperacaoV1[] =>
  d.map((x) => ({ tipoOperacaoId: x.tipoOperacaoId, ordem: x.ordem }));

/** O DETALHE — aí sim com a configuração, porque é a tela que vai editá-la. */
const paraTelaDetalhe = (r: LinhaTipoOperacao) => ({
  ...paraTela(r),
  configuracao: configuracaoParaTela(r.configuracao, r.configuracao_schema_version),
  /**
   * LIDO DA COLUNA, NUNCA DEDUZIDO DE `destinos.length`.
   *
   * Deduzir devolveria `false` para a versão que declarou "esta operação não gera nada" — e o editor
   * mostraria o estado de quem nunca configurou a uma política que alguém escreveu de propósito.
   */
  destinosConfigurados: r.destinos_configurados
});

export default async function tiposOperacaoRoutes(app: FastifyInstance) {
  /**
   * FAMÍLIAS CANÔNICAS DISPONÍVEIS — derivadas do registry, servidas pelo servidor.
   *
   * A tela NÃO tem catálogo próprio de famílias: uma segunda lista no front nasceria desatualizada na
   * primeira família nova e ninguém perceberia (docs/TIPO-OPERACAO-CONTRACT.md §10). Quem declara é o
   * registry; esta rota apenas o publica com o rótulo já traduzido.
   */
  app.get("/admin/tipos-operacao/familias", async (req) => runService(app, req, "tipos_operacao.view", async () => ({
    items: familiasOperacionaisDisponiveis().map((c) => familiaParaTela(c))
  })));

  /**
   * DESCOBERTA DE CAPACIDADE — o que ESTA API sabe fazer com configuração de TOP.
   *
   * ┌─ POR QUE UM ENDPOINT, E NÃO UM `try/catch` NO CLIENTE ─────────────────────────────────────────┐
   * │ Durante o rolling deploy a WEB NOVA conversa com a API ANTIGA por alguns minutos. A API antiga │
   * │ valida o corpo com `.strict()`, então mandar `configuracao` para ela produz 422 — o editor     │
   * │ inteiro pareceria quebrado, e pior: se algum dia um schema frouxo aceitasse e DESCARTASSE o     │
   * │ campo, o administrador leria "salvo" sobre uma configuração que não existe.                     │
   * │                                                                                                 │
   * │ Deduzir a capacidade pela falha é adivinhação: 422 também é o que se recebe por payload         │
   * │ inválido, e 404 é o que se recebe de uma rota que existe mas está protegida. Perguntar ANTES,   │
   * │ e não escrever enquanto a resposta não vier, é a diferença entre negociar e torcer.             │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * `contractVersion` distingue as três situações que o cliente precisa separar: rota AUSENTE (API
   * anterior), rota presente com contrato CONHECIDO, e rota presente com contrato FUTURO. Sem ela, as
   * duas últimas seriam indistinguíveis — e um 200 de formato desconhecido é o modo de falha mais
   * perigoso, porque parece sucesso.
   *
   * A capacidade exigida é `tipos_operacao.view`: perguntar o que a API sabe fazer não é configurar.
   */
  app.get("/admin/tipos-operacao/capabilities", async (req) => runService(app, req, "tipos_operacao.view", async () => ({
    contractVersion: 1,
    configuracao: {
      versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP,
      secoes: [...SECOES_CONFIGURACAO_TOP]
    },
    /**
     * BLOCO PRÓPRIO, E NÃO UMA SEÇÃO DA CONFIGURAÇÃO — porque o grafo não mora no payload: mora em tabela.
     * Declará-lo aqui permite que um cliente mais novo ligue a aba de próximas operações só quando o
     * servidor de fato a sustenta, sem deduzir capacidade pela falha de uma escrita.
     */
    destinos: { suportado: true, limite: LIMITE_DESTINOS_POR_VERSAO },
    /**
     * EXECUÇÃO CONFIGURADA (TOP-CONFIG-04A) — outro bloco OPCIONAL, pelo mesmo precedente de `destinos`.
     *
     * `contractVersion` e `configuracao.versaoSchema` NÃO mudam, e é de propósito: o cliente anterior
     * compara os dois com o que conhece e, se mudassem, travaria a edição de TODA TOP durante a
     * implantação — inclusive as do formato 1, que ele sabe editar. Quem sabe o formato 2 descobre por
     * AQUI: ausente = servidor sem execução configurada; presente = o formato que ele grava, se ESTA
     * instância executa (`runtimeHabilitado`) e a MATRIZ que decide o que é executável. A tela avalia a
     * matriz declarada pelo servidor, nunca uma cópia própria.
     */
    execucao: {
      suportado: true,
      versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2,
      runtimeHabilitado: app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED,
      matriz: MATRIZ_EXECUCAO_TOP
    }
  })));

  /**
   * AS TOPs QUE PODEM SER DESTINO DE UMA ORIGEM — decididas PELO SERVIDOR.
   *
   * A tela NÃO monta esta lista. Se ela filtrasse no cliente, precisaria de uma cópia da regra de
   * compatibilidade de família — a segunda lista que o contrato proíbe — e ela divergiria da regra real na
   * primeira família nova, oferecendo ao administrador um destino que a escrita vai recusar.
   *
   * O recorte é fail-closed em três frentes ao mesmo tempo: RLS resolve o tenant, o `where` resolve o
   * estado (ativa, não excluída) e o registry resolve a compatibilidade. Família de origem desconhecida
   * devolve lista VAZIA, nunca "todas".
   */
  app.get("/admin/tipos-operacao/destinos-possiveis", async (req) => runService(app, req, "tipos_operacao.view", async (ctx) => {
    const q = z.object({ codigoBase: z.string().trim().min(1) }).strict().parse(req.query);

    // Origem que o produto não sabe executar não tem próxima operação nenhuma. Recusar aqui evita oferecer
    // um leque para uma operação cuja conversão não existe.
    if (!varianteDeDocumentoVendaDaFamilia(q.codigoBase)) return { items: [] };

    const r = await ctx.tx.query<{ id: string; codigo: string; nome: string; codigo_base: string }>(
      `select t.id, t.codigo, v.nome, t.codigo_base
         from erp.tipos_operacao t
         join erp.tipos_operacao_versoes v
           on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
        where t.organization_id = $1 and t.ativo and t.excluido_em is null
        order by t.codigo`,
      [ctx.orgId]);

    // A COMPATIBILIDADE É APLICADA AQUI, com a MESMA função que a escrita usa. Duas regras (uma para
    // oferecer, outra para aceitar) divergiriam, e a divergência apareceria como "escolhi e deu erro".
    return {
      items: r.rows
        .filter((x) => validarDestinoOperacao(q.codigoBase, x.codigo_base).length === 0)
        .map((x) => ({ id: x.id, codigo: x.codigo, nome: x.nome, codigoBase: x.codigo_base,
                       familiaRotulo: familiaParaTela(x.codigo_base).rotulo }))
    };
  }));

  // ---------- Lista ----------
  app.get("/admin/tipos-operacao", async (req) => runService(app, req, "tipos_operacao.view", async (ctx) => {
    const q = pageQuerySchema.parse(req.query);
    const f = z.object({
      ativo: z.enum(["true", "false"]).optional(),
      codigoBase: z.string().optional(),
      modulo: z.string().optional()
    }).partial().parse(req.query);

    const where = ["t.organization_id = $1", "t.excluido_em is null"];
    const params: unknown[] = [ctx.orgId];

    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`(t.codigo ilike $${params.length} or v.nome ilike $${params.length})`);
    }
    if (f.ativo !== undefined) { params.push(f.ativo === "true"); where.push(`t.ativo = $${params.length}`); }
    if (f.codigoBase) { params.push(f.codigoBase); where.push(`t.codigo_base = $${params.length}`); }
    // Filtrar por MÓDULO é filtrar por um conjunto de famílias — e esse conjunto sai do registry, nunca de
    // um `like` no código. `vendas.%` pareceria funcionar e casaria com uma família futura que o módulo
    // `vendas` não contivesse.
    if (f.modulo) {
      const familias = familiasOperacionaisDisponiveis().filter((c) => moduloDaFamiliaOperacional(c) === f.modulo);
      params.push(familias);
      where.push(`t.codigo_base = any($${params.length}::text[])`);
    }

    const filtro = where.join(" and ");
    const total = await ctx.tx.query<{ n: string }>(
      `select count(*) n from erp.tipos_operacao t join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.versao = t.versao_atual where ${filtro}`,
      params
    );
    // Ordenação por whitelist declarativa: nunca montar identificador de coluna a partir de entrada.
    const ORDENAVEIS: Record<string, string> = { codigo: "t.codigo", nome: "v.nome", atualizado_em: "t.atualizado_em" };
    const coluna = (q.sort && ORDENAVEIS[q.sort]) ?? "t.codigo";
    const direcao = q.dir === "desc" ? "desc" : "asc";
    const r = await ctx.tx.query<LinhaTipoOperacao>(
      `${SELECAO} where ${filtro} order by ${coluna} ${direcao} limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`,
      params
    );
    return { items: r.rows.map((x) => paraTela(x)), total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize };
  }));

  // ---------- Detalhe ----------
  app.get("/admin/tipos-operacao/:id", async (req) => runService(app, req, "tipos_operacao.view", async (ctx) => {
    const { id } = req.params as { id: string };
    const r = await ctx.tx.query<LinhaTipoOperacao>(
      `${SELECAO} where t.id = $1 and t.organization_id = $2 and t.excluido_em is null`, [id, ctx.orgId]);
    const linha = r.rows[0];
    if (!linha) throw notFound("Tipo de operação");
    // UMA consulta para os destinos desta versão — a mesma função que o histórico usa, para as duas telas
    // nunca discordarem sobre o que a versão declara.
    const destinos = (await destinosDaVersao(ctx, [linha.versao_id])).get(linha.versao_id) ?? [];
    return { ...paraTelaDetalhe(linha), destinos };
  }));

  // ---------- Histórico de versões ----------
  app.get("/admin/tipos-operacao/:id/versoes", async (req) => runService(app, req, "tipos_operacao.view", async (ctx) => {
    const { id } = req.params as { id: string };
    // AUTORIZAÇÃO ANTES DOS DADOS: sem esta conferência, um id de outro tenant devolveria lista vazia com
    // 200 — o que é uma resposta diferente de 404 e, portanto, revela que o id existe em algum lugar.
    const pai = await ctx.tx.query<{ id: string }>(
      "select id from erp.tipos_operacao where id=$1 and organization_id=$2 and excluido_em is null", [id, ctx.orgId]);
    if (!pai.rows[0]) throw notFound("Tipo de operação");
    const r = await ctx.tx.query<{ id: string; versao: number; nome: string; descricao: string | null; criado_em: Date; criado_por_nome: string | null; configuracao: unknown; configuracao_schema_version: number; destinos_configurados: boolean }>(
      `select v.id, v.versao, v.nome, v.descricao, v.criado_em, u.name as criado_por_nome,
              v.configuracao, v.configuracao_schema_version, v.destinos_configurados
         from erp.tipos_operacao_versoes v
         left join erp.users u on u.id = v.criado_por
        where v.tipo_operacao_id = $1 and v.organization_id = $2
        order by v.versao desc`, [id, ctx.orgId]);

    /**
     * CADA VERSÃO MOSTRA A CONFIGURAÇÃO DELA — nunca a atual.
     *
     * Esta é a razão de a configuração morar na versão. Se o histórico exibisse a configuração vigente ao
     * lado de nomes antigos, ele estaria MENTINDO com a aparência de registro: a tela diria que a versão 1
     * baixava estoque porque a versão 7 baixa. O payload sai da própria linha, que é imutável.
     *
     * `secoesAlteradas` é DERIVADA aqui, comparando com a versão anterior — e não gravada numa coluna.
     * Guardá-la criaria uma segunda verdade que pode discordar das versões que ela resume; derivar não
     * pode divergir do que aconteceu, porque é calculado do que aconteceu.
     */
    const linhas = r.rows;
    const cfg = linhas.map((v) => configuracaoParaTela(v.configuracao, v.configuracao_schema_version));
    // UMA consulta para o histórico INTEIRO. Uma por versão viraria N+1 numa TOP com trinta versões, e
    // nenhuma asserção funcional notaria — a tela ficaria idêntica, só mais lenta a cada edição.
    const destinosPorVersao = await destinosDaVersao(ctx, linhas.map((v) => v.id));
    return {
      items: linhas.map((v, i) => {
        const atual = cfg[i]!;
        // As linhas vêm em ordem DECRESCENTE: a anterior desta versão é a do índice seguinte.
        const anterior = cfg[i + 1];
        const comparavel = atual.suportada && anterior?.suportada === true;
        return {
          versao: v.versao,
          nome: v.nome,
          descricao: v.descricao,
          criadoEm: v.criado_em,
          criadoPor: v.criado_por_nome,
          configuracao: atual,
          // OS DESTINOS DAQUELA ÉPOCA, não os de hoje. É a mesma razão pela qual a configuração sai da
          // própria linha: o histórico não pode explicar uma conversão antiga com a política atual.
          destinos: destinosPorVersao.get(v.id) ?? [],
          /**
           * E SE AQUELA VERSÃO CHEGOU A DECLARAR POLÍTICA — lido da coluna da PRÓPRIA linha, nunca deduzido
           * do tamanho da lista acima. Uma versão com zero destinos tem duas histórias possíveis, e só esta
           * coluna sabe qual delas é: "ninguém tinha declarado nada ainda" ou "aqui foi decidido que esta
           * operação não gera nenhuma outra". O histórico existe justamente para responder isso.
           */
          destinosConfigurados: v.destinos_configurados,
          // Sem versão anterior legível não há comparação possível — e `[]` afirmaria "nada mudou", que é
          // diferente de "não dá para saber". `null` diz a segunda coisa.
          secoesAlteradas: comparavel ? secoesAlteradasTop(anterior.valor, atual.valor) : null
        };
      })
    };
  }));

  // ---------- Criação ----------
  app.post("/admin/tipos-operacao", async (req, reply) => reply.status(201).send(
    await runService(app, req, "tipos_operacao.create", async (ctx) => {
      const d = criarSchema.parse(req.body);

      // FAIL-CLOSED contra o registry, ANTES de qualquer escrita. Família desconhecida não vira linha.
      if (!familiaOperacionalDeclarada(d.codigoBase)) {
        throw new DomainError("TIPO_OPERACAO_BASE_DESCONHECIDA",
          `Família operacional desconhecida: ${d.codigoBase}`, { codigoBase: d.codigoBase });
      }

      // AUSENTE = NEUTRO. Não é o mesmo que "configurado com tudo desligado por decisão": é "ninguém
      // declarou". Desde a TOP-CONFIG-04A o neutro de uma TOP NOVA é o formato 2 com os dois efeitos em
      // `legado`: nenhuma TOP começa executando configuração sem decisão explícita. Um corpo no formato 1
      // (o cliente anterior, durante a implantação) é gravado COMO VEIO — formato 1, legado por definição;
      // traduzi-lo seria reescrever o que o cliente disse.
      //
      // LIDA E CONFERIDA ANTES DE QUALQUER ESCRITA: a recusa de ativação não pode chegar depois de o posto
      // de padrão já ter sido trocado dentro da transação.
      const configuracao = d.configuracao === undefined ? configuracaoNeutraTopV2() : configuracaoPedida(d.configuracao);
      conferirExecucaoPedida(d.codigoBase, null, configuracao, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED);

      const nasceuPadrao = d.padrao && d.ativo;
      // Se nasce como padrão, o posto tem de estar livre — e a troca é atômica (mesma transação).
      const liberados = nasceuPadrao ? await liberarPadrao(ctx, d.codigoBase, null) : [];

      const pai = await ctx.tx.query<{ id: string }>(
        `insert into erp.tipos_operacao (organization_id, codigo, codigo_base, ativo, padrao, versao_atual, revisao, criado_por)
         values ($1,$2,$3,$4,$5,1,1,$6) returning id`,
        [ctx.orgId, d.codigo, d.codigoBase, d.ativo, nasceuPadrao, ctx.user.id]);
      const id = pai.rows[0]!.id;

      /**
       * DECLAROU A POLÍTICA DE PRÓXIMAS OPERAÇÕES? — PRESENÇA DA CHAVE, NUNCA TAMANHO DA LISTA.
       *
       * `d.destinos !== undefined` é literalmente "a chave veio no corpo": JSON não transporta `undefined`,
       * então a ausência só pode vir de quem não escreveu o campo — a web ANTIGA durante o rolling deploy.
       * `"destinos": null` e `"destinos": []` CONTAM COMO DECLARAÇÃO, e é essa a diferença que a coluna
       * existe para guardar: "não declarei nada" (o acervo, que segue a cadeia antiga) não é a mesma coisa
       * que "declarei que esta operação não gera próxima operação" (que RECUSA a conversão).
       *
       * `?? []` resolveria a normalização e apagaria a pergunta. Por isso a presença é lida aqui, antes, e
       * a normalização de `null` para lista vazia continua sendo trabalho do domínio.
       */
      const declarouDestinos = d.destinos !== undefined;

      const versaoNova = await ctx.tx.query<{ id: string }>(
        `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, descricao, criado_por, configuracao, configuracao_schema_version, destinos_configurados)
         values ($1,$2,1,$3,$4,$5,$6::jsonb,$7,$8) returning id`,
        [ctx.orgId, id, d.nome, d.descricao ?? null, ctx.user.id, JSON.stringify(configuracao), configuracao.versaoSchema, declarouDestinos]);

      // AS PRÓXIMAS OPERAÇÕES DA VERSÃO 1. Conferidas contra banco e registry ANTES de gravar: uma aresta
      // para TOP indisponível nasceria como um botão que não tem serviço atrás.
      const destinos = await conferirDestinos(ctx, d.codigoBase, destinosPedidos(d.destinos));
      await gravarDestinos(ctx, versaoNova.rows[0]!.id, id, destinos);

      await audit(ctx.tx, ctx, "tipos_operacao", id, "create",
        { codigo: d.codigo, codigoBase: d.codigoBase, ativo: d.ativo, padrao: nasceuPadrao, versao: 1,
          configuracaoSchema: configuracao.versaoSchema, execucao: execucaoDeclaradaTop(configuracao),
          // O NÚMERO E O ESTADO, porque um não responde pelo outro: `destinos: 0` com
          // `destinosConfigurados: true` é "não gera nada, por decisão", e com `false` é "ninguém decidiu".
          // Sem o booleano, a trilha registra o mesmo zero para as duas e a investigação fica sem resposta.
          destinosConfigurados: declarouDestinos, destinos: destinos.length });
      // A TOP anterior perdeu o padrão nesta mesma transação: quem perdeu tem evento próprio, com autor.
      await auditarPadraoLiberado(ctx, liberados, id);
      // E quem ASSUMIU também. Sem isto, "esta TOP virou padrão ao nascer" só existiria dentro do payload
      // do `create`, e a pergunta "desde quando a 2103 é a padrão?" teria de ser respondida lendo dois
      // formatos de evento diferentes conforme a TOP tenha nascido padrão ou virado padrão depois.
      if (nasceuPadrao) {
        await audit(ctx.tx, ctx, "tipos_operacao", id, "set_default",
          { codigo: d.codigo, codigoBase: d.codigoBase });
      }
      return { id };
    })));

  // ---------- Edição ----------
  app.put("/admin/tipos-operacao/:id", async (req) => runService(app, req, "tipos_operacao.edit", async (ctx) => {
    const { id } = req.params as { id: string };
    const corpo = (req.body ?? {}) as Record<string, unknown>;

    // Contrato não canônico é RECUSADO, nunca ignorado (CLAUDE.md, "Arquitetura").
    for (const imutavel of ["codigo", "codigoBase", "codigo_base"]) {
      if (imutavel in corpo) {
        throw new DomainError("TIPO_OPERACAO_IDENTIDADE_IMUTAVEL",
          "Código e família operacional não mudam depois da criação; crie um tipo de operação novo",
          { campo: imutavel });
      }
    }
    const d = editarSchema.parse(corpo);

    // `for update` trava a linha durante a transação; `revisao` recusa a escrita de quem leu uma versão
    // velha. Os dois juntos: o lock resolve simultaneidade, a revisão resolve a aba aberta há dez minutos.
    const atual = await ctx.tx.query<LinhaTipoOperacao>(
      `${SELECAO} where t.id=$1 and t.organization_id=$2 and t.excluido_em is null for update of t`,
      [id, ctx.orgId]);
    const antes = atual.rows[0];
    if (!antes) throw notFound("Tipo de operação");
    if (antes.revisao !== d.revisao) {
      throw new DomainError("CONCURRENCY_CONFLICT",
        "Este tipo de operação foi alterado por outra pessoa; recarregue e tente novamente",
        { revisaoAtual: antes.revisao, revisaoEnviada: d.revisao });
    }

    const ativo = d.ativo ?? antes.ativo;
    // Desativar quem é padrão tira o posto na MESMA transação: um padrão inativo seria oferecido a ninguém
    // e continuaria bloqueando o índice para o próximo candidato.
    const padrao = (d.padrao ?? antes.padrao) && ativo;

    const nome = d.nome ?? antes.nome;
    const descricao = d.descricao === undefined ? antes.descricao : d.descricao;

    /**
     * A CONFIGURAÇÃO ATUAL, E A PEDIDA.
     *
     * A atual vem da VERSÃO CORRENTE, e ela pode ser ilegível — foi escrita por um binário futuro durante
     * um rollback, ou está corrompida. Nesse caso EDITAR É RECUSADO, e recusar é a única saída honesta:
     * gravar por cima transformaria uma configuração que não se sabe ler numa que se acabou de inventar,
     * sem ninguém perceber que algo foi perdido. Ler o histórico continua funcionando (ver
     * `configuracaoParaTela`); é só a ESCRITA que fecha.
     */
    const atualConfig = configuracaoParaTela(antes.configuracao, antes.configuracao_schema_version);
    if (!atualConfig.suportada) {
      throw new DomainError("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO",
        "A configuração vigente deste tipo de operação está num formato que este servidor não interpreta; atualize o servidor antes de editar",
        { versaoSuportada: VERSAO_SCHEMA_CONFIGURACAO_TOP, versaoEncontrada: antes.configuracao_schema_version });
    }
    // AUSENTE = PRESERVAR. É o que a web ANTIGA manda durante o rolling deploy, e interpretar a ausência
    // como "zerar" apagaria configuração que ninguém pediu para apagar.
    const configuracao = d.configuracao === undefined ? atualConfig.valor : configuracaoPedida(d.configuracao);
    /**
     * O FORMATO NÃO RETROCEDE. Um corpo no formato 1 sobre uma versão vigente no formato 2 só pode vir de
     * um cliente desatualizado (o editor anterior trava ao ler o formato 2) ou de uma chamada direta — e
     * aceitá-lo desligaria a execução configurada EM SILÊNCIO, porque o formato 1 é legado por definição.
     * Voltar ao legado continua possível, e explícito: formato 2 com o efeito em `legado`.
     */
    if (configuracao.versaoSchema === VERSAO_SCHEMA_CONFIGURACAO_TOP && atualConfig.valor.versaoSchema === VERSAO_SCHEMA_CONFIGURACAO_TOP_V2) {
      throw new DomainError("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO",
        "Este tipo de operação já usa o formato atual de configuração; recarregue a tela antes de editar",
        { versaoEnviada: VERSAO_SCHEMA_CONFIGURACAO_TOP, versaoVigente: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2 });
    }
    conferirExecucaoPedida(antes.codigo_base, atualConfig.valor, configuracao, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED);
    const mudouConfiguracao = !configuracoesTopIguais(atualConfig.valor, configuracao);

    /**
     * OS DESTINOS SÃO CONTEÚDO, EXATAMENTE COMO A CONFIGURAÇÃO.
     *
     * "Deste orçamento pode sair um pedido especial" é uma REGRA que explica por que um documento pôde
     * virar outro. Se ela fosse estado do pai, editar o cadastro hoje mudaria retroativamente o leque de
     * um documento de ontem, e a conversão daquele documento ficaria sem explicação.
     *
     * AUSENTE = PRESERVAR, pela mesma razão da configuração: é o que a web antiga manda, e ler a ausência
     * como "apague todas as transições" destruiria política que ninguém pediu para destruir.
     */
    const destinosAtuais = soPolitica((await destinosDaVersao(ctx, [antes.versao_id])).get(antes.versao_id) ?? []);
    /**
     * DUAS COISAS MUDAM AQUI, E SÓ UMA DELAS É A LISTA.
     *
     * `declarouAgora` é PRESENÇA DA CHAVE (`d.destinos !== undefined`), não tamanho de lista: JSON não
     * transporta `undefined`, então ausência é "o cliente não escreveu o campo" — o que a web ANTIGA faz
     * durante o rolling deploy, e o que obriga a PRESERVAR arestas e booleano. `null` e `[]` são presença.
     */
    const declarouAgora = d.destinos !== undefined;
    const destinos = declarouAgora
      ? await conferirDestinos(ctx, antes.codigo_base, destinosPedidos(d.destinos))
      : destinosAtuais;
    /**
     * A VERSÃO NOVA É AUTOSSUFICIENTE, ENTÃO O BOOLEANO TAMBÉM VIAJA. Quando uma versão nasce por mudança
     * de nome ou de configuração com `destinos` AUSENTE, ela COPIA o estado da anterior — junto com as
     * arestas. Herdar por referência faria a versão N+1 depender da N para ser lida.
     *
     * DECLARAR NUNCA VOLTA A SER "NÃO DECLARADO": só `true` se sobrepõe, porque `destinos` ausente é
     * silêncio do cliente, e silêncio não desfaz decisão.
     */
    const destinosConfigurados = declarouAgora ? true : antes.destinos_configurados;
    /**
     * O CASO CRÍTICO DO NO-OP: versão atual com ZERO arestas e `destinos_configurados = false`, e um PUT
     * com `destinos: []`. As arestas são idênticas (nenhuma, antes e depois), então comparar só a lista
     * diria "nada mudou" e a edição seria descartada como no-op — com a tela respondendo "salvo" sobre uma
     * política que continua NÃO DECLARADA, e a conversão continuando a cair na cadeia antiga.
     *
     * Só que a política MUDOU, e mudou no ponto que mais importa: de "ninguém nunca decidiu" para
     * "decidido: esta operação não gera próxima operação". É conteúdo, e conteúdo cria a versão N+1.
     */
    const mudouDestinos = !destinosOperacaoIguais(destinosAtuais, destinos)
      || (destinosConfigurados && !antes.destinos_configurados);

    // CONTEÚDO gera versão; ESTADO não. O nome de uma TOP é o que um documento vai citar — mudou o nome,
    // nasce uma versão nova, e a anterior continua legível. Ativar/desativar não muda o que a TOP É.
    //
    // A CONFIGURAÇÃO É CONTEÚDO, pelo mesmo motivo e com mais força: ela é a REGRA que explica o efeito.
    // E nome + descrição + configuração viajam numa versão SÓ — uma edição que mexe nos três gera UMA
    // N+1, não três. Versão por aba faria o histórico contar uma sequência de eventos que nunca existiu.
    const mudouConteudo = nome !== antes.nome || (descricao ?? null) !== (antes.descricao ?? null)
      || mudouConfiguracao || mudouDestinos;
    const versao = mudouConteudo ? antes.versao_atual + 1 : antes.versao_atual;

    /**
     * NO-OP NÃO É ESCRITA — e precisa vir ANTES de `liberarPadrao`, porque um efeito colateral disparado
     * aqui já teria acontecido quando a conferência chegasse.
     *
     * Reenviar o formulário sem mexer em nada incrementava a revisão. O custo não é o `update` inútil: é que
     * a revisão é a moeda do controle de concorrência. Toda outra aba aberta na mesma TOP passava a estar
     * "velha" e recebia 409 por uma mudança que não existiu, e a trilha ganhava um `update` sem diff que
     * ninguém sabe ler. Salvar sem alterar devolve o estado atual, intacto.
     */
    if (!mudouConteudo && ativo === antes.ativo && padrao === antes.padrao) {
      return { id, versao: antes.versao_atual, revisao: antes.revisao };
    }

    const liberados = padrao && !(antes.padrao && antes.ativo)
      ? await liberarPadrao(ctx, antes.codigo_base, id)
      : [];

    if (mudouConteudo) {
      const versaoNova = await ctx.tx.query<{ id: string }>(
        `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, descricao, criado_por, configuracao, configuracao_schema_version, destinos_configurados)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) returning id`,
        [ctx.orgId, id, versao, nome, descricao ?? null, ctx.user.id, JSON.stringify(configuracao), configuracao.versaoSchema, destinosConfigurados]);
      // As arestas são COPIADAS para a versão nova mesmo quando não mudaram: a versão N+1 precisa declarar
      // a política INTEIRA dela. Herdar por referência faria a versão nova depender da anterior para ser
      // lida, e o histórico deixaria de ser autossuficiente — que é a única coisa que ele promete ser.
      await gravarDestinos(ctx, versaoNova.rows[0]!.id, id, destinos);
    }

    const u = await ctx.tx.query(
      `update erp.tipos_operacao set ativo=$3, padrao=$4, versao_atual=$5, revisao=revisao+1
        where id=$1 and organization_id=$2 and excluido_em is null and revisao=$6`,
      [id, ctx.orgId, ativo, padrao, versao, antes.revisao]);
    // ROW COUNT SOB RLS: fora de escopo a política devolve zero linhas, e zero linha sem conferência vira
    // sucesso sem efeito.
    if (!u.rowCount) throw notFound("Tipo de operação");

    // Uma ação por mudança, para que a trilha responda "quem desativou isto?" sem interpretar diff.
    if (mudouConteudo) {
      /**
       * A AUDITORIA REGISTRA QUAIS SEÇÕES MUDARAM, não o payload inteiro.
       *
       * Despejar a configuração completa a cada edição faria do log uma SEGUNDA cópia da configuração —
       * que envelhece em silêncio e diverge da versão, que é a verdade. `["estoque","fiscal"]` responde a
       * pergunta que se faz numa investigação ("o que mexeram?") e manda o leitor à versão para o detalhe
       * exato, que está lá, imutável, por construção.
       */
      const secoesAlteradas = mudouConfiguracao ? secoesAlteradasTop(atualConfig.valor, configuracao) : [];
      await audit(ctx.tx, ctx, "tipos_operacao", id, "update",
        { versaoAnterior: antes.versao_atual, versao,
          secoesAlteradas,
          // O CUTOVER NA TRILHA: quando um efeito troca de autoridade (legado ↔ configurada), o evento de
          // edição que criou a versão diz de onde saiu e para onde foi, sem precisar reabrir as duas.
          ...(secoesAlteradas.includes("execucao")
            ? { execucao: { antes: execucaoDeclaradaTop(atualConfig.valor), depois: execucaoDeclaradaTop(configuracao) } }
            : {}),
          // `destinos: 0` sozinho não responde o que aconteceu. Com `destinosConfigurados`, a trilha separa
          // a edição que DECLAROU "não gera nada" da que apenas não falou do assunto.
          destinosAlterados: mudouDestinos, destinos: destinos.length, destinosConfigurados,
          configuracaoSchema: configuracao.versaoSchema },
        { before: { nome: antes.nome, descricao: antes.descricao }, after: { nome, descricao } });
    }
    if (ativo !== antes.ativo) {
      await audit(ctx.tx, ctx, "tipos_operacao", id, ativo ? "activate" : "deactivate",
        { codigo: antes.codigo, codigoBase: antes.codigo_base });
    }
    if (padrao !== antes.padrao) {
      await audit(ctx.tx, ctx, "tipos_operacao", id, padrao ? "set_default" : "unset_default",
        { codigo: antes.codigo, codigoBase: antes.codigo_base });
    }
    // A TROCA ALTERA DUAS LINHAS. A que assume já tem evento acima; a que abdica mudava de `padrao` e de
    // `revisao` sem nenhum autor na trilha — "quem tirou o padrão da 2101?" não tinha resposta.
    await auditarPadraoLiberado(ctx, liberados, id);
    return { id, versao, revisao: antes.revisao + 1 };
  }));

  // ---------- Exclusão lógica ----------
  app.delete("/admin/tipos-operacao/:id", async (req) => runService(app, req, "tipos_operacao.delete", async (ctx) => {
    const { id } = req.params as { id: string };
    const d = excluirSchema.parse(req.query);

    // A ORDEM É 404 ANTES DE 409. Conferir a revisão primeiro devolveria 409 para um id de outro tenant
    // sempre que a revisão enviada não coincidisse — e 409 ≠ 404 revela que o id existe em algum lugar.
    const atual = await ctx.tx.query<{ codigo: string; codigo_base: string; padrao: boolean; revisao: number }>(
      `select codigo, codigo_base, padrao, revisao from erp.tipos_operacao
        where id=$1 and organization_id=$2 and excluido_em is null for update`, [id, ctx.orgId]);
    const antes = atual.rows[0];
    if (!antes) throw notFound("Tipo de operação");
    if (antes.revisao !== d.revisao) {
      throw new DomainError("CONCURRENCY_CONFLICT",
        "Este tipo de operação foi alterado por outra pessoa; recarregue e tente novamente",
        { revisaoAtual: antes.revisao, revisaoEnviada: d.revisao });
    }

    // Excluir tira o posto de padrão junto: deixar `padrao` marcado num registro excluído manteria o índice
    // parcial ocupado por alguém que não existe mais, e o próximo candidato seria recusado sem explicação.
    const u = await ctx.tx.query(
      `update erp.tipos_operacao set excluido_em=now(), padrao=false, revisao=revisao+1
        where id=$1 and organization_id=$2 and excluido_em is null and revisao=$3`,
      [id, ctx.orgId, d.revisao]);
    // ROW COUNT SOB RLS: fora de escopo a política devolve zero linhas, e zero linha sem conferência vira
    // sucesso sem efeito.
    if (!u.rowCount) throw notFound("Tipo de operação");

    // Perder o padrão por exclusão é a MESMA perda de estado que perdê-lo numa troca, e merece o mesmo
    // evento: sem ele, a família fica sem padrão e a trilha só registra um `delete`, de onde ninguém deduz
    // que o posto vagou. Sem sucessor — por isso `novoPadraoId` é nulo aqui.
    //
    // Aqui a origem do "quem perdeu" é a leitura TRAVADA acima, não um `returning`: com a linha sob
    // `for update` dentro da transação, `antes.padrao` é exatamente o valor que este `update` sobrescreveu.
    if (antes.padrao) {
      await auditarPadraoLiberado(ctx, [{ id, codigo: antes.codigo, codigo_base: antes.codigo_base }], null);
    }
    await audit(ctx.tx, ctx, "tipos_operacao", id, "delete",
      { codigo: antes.codigo, codigoBase: antes.codigo_base });
    return { ok: true };
  }));
}

/**
 * Tira o padrão de quem ocupa o posto nesta família, na MESMA transação em que o novo o assume.
 *
 * Sem isto o índice único parcial recusaria a escrita e o administrador veria "registro duplicado" sem
 * entender o quê. A política escolhida é a TROCA ATÔMICA (e não "falhe e peça troca explícita") porque
 * "definir como padrão" já é a declaração explícita de quem deve ser o padrão.
 */
async function liberarPadrao(ctx: ServiceCtx, codigoBase: string, exceto: string | null): Promise<PadraoLiberado[]> {
  const r = await ctx.tx.query<PadraoLiberado>(
    `update erp.tipos_operacao set padrao=false, revisao=revisao+1
      where organization_id=$1 and codigo_base=$2 and padrao and excluido_em is null and ($3::uuid is null or id <> $3)
      returning id, codigo, codigo_base`,
    [ctx.orgId, codigoBase, exceto]);
  return r.rows;
}

/**
 * Registra na trilha quem PERDEU o padrão — e só quem realmente perdeu.
 *
 * A troca de padrão altera DUAS linhas: a que assume e a que abdica. A segunda mudava de estado e de revisão
 * sem nenhum autor na auditoria, então "quem tirou o padrão da 2101?" não tinha resposta.
 *
 * O que esta função NÃO faz é decidir quem perdeu: ela recebe a lista pronta. Nas trocas, a lista vem do
 * `returning` de `liberarPadrao` — do que o banco DE FATO alterou, nunca da intenção da rota, senão um
 * cenário sem padrão anterior registraria uma perda que não aconteceu. Na exclusão, vem da leitura sob
 * `for update`, que dentro da transação é o mesmo valor que o `update` sobrescreveu. Em nenhum dos dois
 * caminhos a origem é "o que a rota pretendia fazer".
 */
async function auditarPadraoLiberado(ctx: ServiceCtx, liberados: PadraoLiberado[], novoPadraoId: string | null): Promise<void> {
  for (const anterior of liberados) {
    await audit(ctx.tx, ctx, "tipos_operacao", anterior.id, "unset_default", {
      codigo: anterior.codigo,
      codigoBase: anterior.codigo_base,
      ...(novoPadraoId ? { novoPadraoId } : {})
    });
  }
}
