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
  SECOES_CONFIGURACAO_TOP,
  configuracaoNeutraTop,
  configuracoesTopIguais,
  lerConfiguracaoTop,
  secoesAlteradasTop,
  type ConfiguracaoTipoOperacaoV1
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
  configuracao: z.unknown().optional()
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
  configuracao: z.unknown().optional()
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
         v.nome, v.descricao, v.configuracao, v.configuracao_schema_version
    from erp.tipos_operacao t
    join erp.tipos_operacao_versoes v
      on v.tipo_operacao_id = t.id and v.versao = t.versao_atual
`;

/** O que o `returning` de `liberarPadrao` devolve: exatamente quem o banco alterou. */
interface PadraoLiberado { id: string; codigo: string; codigo_base: string }

interface LinhaTipoOperacao {
  id: string; codigo: string; codigo_base: string; ativo: boolean; padrao: boolean;
  versao_atual: number; revisao: number; criado_em: Date; atualizado_em: Date;
  nome: string; descricao: string | null;
  configuracao: unknown; configuracao_schema_version: number;
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
function configuracaoPedida(bruta: unknown): ConfiguracaoTipoOperacaoV1 {
  const r = lerConfiguracaoTop(bruta);
  if (r.ok) return r.valor;
  const schema = r.recusas.find((x) => x.motivo === "schema_nao_suportado");
  if (schema) {
    throw new DomainError("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO",
      "A configuração enviada usa uma versão de formato que este servidor não conhece",
      { versaoSuportada: VERSAO_SCHEMA_CONFIGURACAO_TOP });
  }
  throw new DomainError("TIPO_OPERACAO_CONFIGURACAO_INVALIDA",
    "A configuração operacional enviada é inválida", { recusas: r.recusas });
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
  | { suportada: true; versaoSchema: number; valor: ConfiguracaoTipoOperacaoV1 }
  | { suportada: false; versaoSchema: number };

function configuracaoParaTela(bruta: unknown, versaoSchema: number): ConfiguracaoParaTela {
  if (versaoSchema !== VERSAO_SCHEMA_CONFIGURACAO_TOP) return { suportada: false, versaoSchema };
  const r = lerConfiguracaoTop(bruta);
  return r.ok ? { suportada: true, versaoSchema, valor: r.valor } : { suportada: false, versaoSchema };
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

/** O DETALHE — aí sim com a configuração, porque é a tela que vai editá-la. */
const paraTelaDetalhe = (r: LinhaTipoOperacao) => ({
  ...paraTela(r),
  configuracao: configuracaoParaTela(r.configuracao, r.configuracao_schema_version)
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
    }
  })));

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
    if (!r.rows[0]) throw notFound("Tipo de operação");
    return paraTelaDetalhe(r.rows[0]);
  }));

  // ---------- Histórico de versões ----------
  app.get("/admin/tipos-operacao/:id/versoes", async (req) => runService(app, req, "tipos_operacao.view", async (ctx) => {
    const { id } = req.params as { id: string };
    // AUTORIZAÇÃO ANTES DOS DADOS: sem esta conferência, um id de outro tenant devolveria lista vazia com
    // 200 — o que é uma resposta diferente de 404 e, portanto, revela que o id existe em algum lugar.
    const pai = await ctx.tx.query<{ id: string }>(
      "select id from erp.tipos_operacao where id=$1 and organization_id=$2 and excluido_em is null", [id, ctx.orgId]);
    if (!pai.rows[0]) throw notFound("Tipo de operação");
    const r = await ctx.tx.query<{ versao: number; nome: string; descricao: string | null; criado_em: Date; criado_por_nome: string | null; configuracao: unknown; configuracao_schema_version: number }>(
      `select v.versao, v.nome, v.descricao, v.criado_em, u.name as criado_por_nome,
              v.configuracao, v.configuracao_schema_version
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

      const nasceuPadrao = d.padrao && d.ativo;
      // Se nasce como padrão, o posto tem de estar livre — e a troca é atômica (mesma transação).
      const liberados = nasceuPadrao ? await liberarPadrao(ctx, d.codigoBase, null) : [];

      const pai = await ctx.tx.query<{ id: string }>(
        `insert into erp.tipos_operacao (organization_id, codigo, codigo_base, ativo, padrao, versao_atual, revisao, criado_por)
         values ($1,$2,$3,$4,$5,1,1,$6) returning id`,
        [ctx.orgId, d.codigo, d.codigoBase, d.ativo, nasceuPadrao, ctx.user.id]);
      const id = pai.rows[0]!.id;

      // AUSENTE = NEUTRO. Não é o mesmo que "configurado com tudo desligado por decisão": é "ninguém
      // declarou". O efeito guardado é idêntico, e é o único que não inventa intenção alheia.
      const configuracao = d.configuracao === undefined ? configuracaoNeutraTop() : configuracaoPedida(d.configuracao);

      await ctx.tx.query(
        `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, descricao, criado_por, configuracao, configuracao_schema_version)
         values ($1,$2,1,$3,$4,$5,$6::jsonb,$7)`,
        [ctx.orgId, id, d.nome, d.descricao ?? null, ctx.user.id, JSON.stringify(configuracao), VERSAO_SCHEMA_CONFIGURACAO_TOP]);

      await audit(ctx.tx, ctx, "tipos_operacao", id, "create",
        { codigo: d.codigo, codigoBase: d.codigoBase, ativo: d.ativo, padrao: nasceuPadrao, versao: 1,
          configuracaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP });
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
    const mudouConfiguracao = !configuracoesTopIguais(atualConfig.valor, configuracao);

    // CONTEÚDO gera versão; ESTADO não. O nome de uma TOP é o que um documento vai citar — mudou o nome,
    // nasce uma versão nova, e a anterior continua legível. Ativar/desativar não muda o que a TOP É.
    //
    // A CONFIGURAÇÃO É CONTEÚDO, pelo mesmo motivo e com mais força: ela é a REGRA que explica o efeito.
    // E nome + descrição + configuração viajam numa versão SÓ — uma edição que mexe nos três gera UMA
    // N+1, não três. Versão por aba faria o histórico contar uma sequência de eventos que nunca existiu.
    const mudouConteudo = nome !== antes.nome || (descricao ?? null) !== (antes.descricao ?? null) || mudouConfiguracao;
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
      await ctx.tx.query(
        `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, descricao, criado_por, configuracao, configuracao_schema_version)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [ctx.orgId, id, versao, nome, descricao ?? null, ctx.user.id, JSON.stringify(configuracao), VERSAO_SCHEMA_CONFIGURACAO_TOP]);
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
      await audit(ctx.tx, ctx, "tipos_operacao", id, "update",
        { versaoAnterior: antes.versao_atual, versao,
          secoesAlteradas: mudouConfiguracao ? secoesAlteradasTop(atualConfig.valor, configuracao) : [],
          configuracaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP },
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
