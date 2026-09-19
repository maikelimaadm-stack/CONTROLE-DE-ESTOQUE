import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  FORMA_CODIGO_TIPO_OPERACAO,
  LIMITE_DESCRICAO_TIPO_OPERACAO,
  LIMITE_NOME_TIPO_OPERACAO,
  chaveI18nDaFamiliaOperacional,
  familiaOperacionalDeclarada,
  familiasOperacionaisDisponiveis,
  moduloDaFamiliaOperacional
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
  padrao: z.boolean().default(false)
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
  revisao: z.coerce.number().int().min(1)
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
         v.nome, v.descricao
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
}

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
  atualizadoEm: r.atualizado_em
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
    return paraTela(r.rows[0]);
  }));

  // ---------- Histórico de versões ----------
  app.get("/admin/tipos-operacao/:id/versoes", async (req) => runService(app, req, "tipos_operacao.view", async (ctx) => {
    const { id } = req.params as { id: string };
    // AUTORIZAÇÃO ANTES DOS DADOS: sem esta conferência, um id de outro tenant devolveria lista vazia com
    // 200 — o que é uma resposta diferente de 404 e, portanto, revela que o id existe em algum lugar.
    const pai = await ctx.tx.query<{ id: string }>(
      "select id from erp.tipos_operacao where id=$1 and organization_id=$2 and excluido_em is null", [id, ctx.orgId]);
    if (!pai.rows[0]) throw notFound("Tipo de operação");
    const r = await ctx.tx.query<{ versao: number; nome: string; descricao: string | null; criado_em: Date; criado_por_nome: string | null }>(
      `select v.versao, v.nome, v.descricao, v.criado_em, u.name as criado_por_nome
         from erp.tipos_operacao_versoes v
         left join erp.users u on u.id = v.criado_por
        where v.tipo_operacao_id = $1 and v.organization_id = $2
        order by v.versao desc`, [id, ctx.orgId]);
    return { items: r.rows.map((v) => ({ versao: v.versao, nome: v.nome, descricao: v.descricao, criadoEm: v.criado_em, criadoPor: v.criado_por_nome })) };
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

      await ctx.tx.query(
        `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, descricao, criado_por)
         values ($1,$2,1,$3,$4,$5)`,
        [ctx.orgId, id, d.nome, d.descricao ?? null, ctx.user.id]);

      await audit(ctx.tx, ctx, "tipos_operacao", id, "create",
        { codigo: d.codigo, codigoBase: d.codigoBase, ativo: d.ativo, padrao: nasceuPadrao, versao: 1 });
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
    // CONTEÚDO gera versão; ESTADO não. O nome de uma TOP é o que um documento vai citar — mudou o nome,
    // nasce uma versão nova, e a anterior continua legível. Ativar/desativar não muda o que a TOP É.
    const mudouConteudo = nome !== antes.nome || (descricao ?? null) !== (antes.descricao ?? null);
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
        `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, descricao, criado_por)
         values ($1,$2,$3,$4,$5,$6)`,
        [ctx.orgId, id, versao, nome, descricao ?? null, ctx.user.id]);
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
      await audit(ctx.tx, ctx, "tipos_operacao", id, "update", { versaoAnterior: antes.versao_atual, versao },
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
