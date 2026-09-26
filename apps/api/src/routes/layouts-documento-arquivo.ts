import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  FORMATO_ARQUIVO_LAYOUT, VERSAO_ARQUIVO_LAYOUT, familiaTemLayout, padroesRegistroDaEstrutura, removerPadroesRegistro,
  validarEstruturaLayout, type ArquivoLayoutDocumento, type EstruturaLayout
} from "@agro/domain";
import { runService, audit, nextCode } from "../lib/service.js";
import { err, notFound, validation } from "../lib/errors.js";
import type { ServiceCtx } from "../lib/context.js";
import { conferirPadroesRegistro } from "../lib/layout-documento.js";

/**
 * ARQUIVO DO LAYOUT DO DOCUMENTO (VENDAS-A3-1b) — exportar e importar.
 *
 * O arquivo é `{ formato: "layout-documento", versao: 1, familia, nome, estrutura }` (constantes do domínio). Exportar
 * é LEITURA com a capacidade da tela (`tipos_operacao.view`); importar é CRIAÇÃO (`tipos_operacao.create`) e nasce
 * exatamente como o POST do cadastro cria: código novo, `padrao=false`, ativo, sem TOP.
 *
 * O registro padrão (`valorPadrao: { tipo: "registro" }`) viaja no arquivo com o id da organização de ORIGEM. Na
 * importação ele é CONFERIDO nesta organização (`conferirPadroesRegistro`, a mesma conferência do salvar): o que não
 * vale aqui é REMOVIDO e devolvido em `removidos`, e o resto passa pela validação do domínio como qualquer layout.
 *
 * SUPERFÍCIE DE RECUSA: layout inexistente, de outra organização, excluído ou id malformado → a MESMA 404 da leitura
 * do cadastro ("Layout"). Toda gravação confere ROW COUNT.
 */

const LIMITE_ARQUIVO = 65536;
const MOTIVO_REGISTRO_NAO_VALE = "Registro padrão não vale nesta organização.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idSchema = z.object({ id: z.string() }).strict();
const nomeSchema = z.string().trim().min(1).max(120);

/*
 * CÓPIA FIEL da forma da EstruturaLayout v1 de `routes/layouts-documento.ts` (lá ela não é exportada, e aquele arquivo
 * é de outro agente nesta fatia), já com o `registro` do contrato 2.2 no campo e na coluna. Só tipos: as regras são
 * do domínio. Strict: chave desconhecida é 422. Ao exportar o schema de lá, este bloco sai e passa a importá-lo.
 */
const valorPadraoSchema = z.union([
  z.object({ tipo: z.literal("literal"), valor: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
  z.object({ tipo: z.literal("variavel"), variavel: z.enum(["data_atual", "empresa_selecionada"]) }).strict(),
  z.object({ tipo: z.literal("registro"), id: z.string() }).strict()
]);
const campoSchema = z.object({
  campo: z.string().min(1).max(80), rotulo: z.string().max(120).optional(), obrigatorio: z.boolean(), editavel: z.boolean(),
  valorPadrao: valorPadraoSchema.optional()
}).strict();
const estruturaSchema = z.object({
  versaoSchema: z.literal(1),
  cabecalho: z.array(campoSchema).max(200),
  rodape: z.array(z.object({ aba: z.string().min(1).max(80), campos: z.array(campoSchema).max(200) }).strict()).max(50),
  itens: z.array(z.object({
    campo: z.string().min(1).max(80), rotulo: z.string().max(120).optional(), obrigatorio: z.boolean(),
    valorPadrao: valorPadraoSchema.optional()
  }).strict()).max(200)
}).strict();

/** O arquivo, ESTRITO: chave desconhecida, formato, versão ou família fora do contrato → 422 no próprio caminho. */
const arquivoSchema = z.object({
  formato: z.string().refine((v) => v === FORMATO_ARQUIVO_LAYOUT, `Formato de arquivo não reconhecido (esperado "${FORMATO_ARQUIVO_LAYOUT}").`),
  versao: z.number().refine((v) => v === VERSAO_ARQUIVO_LAYOUT, `Versão do arquivo não suportada (esperada ${VERSAO_ARQUIVO_LAYOUT}).`),
  familia: z.string().refine((v) => familiaTemLayout(v), "Família sem layout de documento."),
  nome: nomeSchema,
  estrutura: estruturaSchema
}).strict();

interface LinhaLayout { id: string; code: string; nome: string; familia: string; estrutura: EstruturaLayout }

/** A MESMA leitura do cadastro: UUID conferido, organização e `deleted_at is null` antes de decidir; senão 404 "Layout". */
async function lerLayout(ctx: ServiceCtx, id: string): Promise<LinhaLayout> {
  if (!UUID.test(id)) throw notFound("Layout");
  const r = await ctx.tx.query<LinhaLayout>(
    "select id, code, nome, familia, estrutura from erp.layouts_documento where id=$1 and organization_id=$2 and deleted_at is null", [id, ctx.orgId]);
  if (!r.rows[0]) throw notFound("Layout");
  return r.rows[0];
}

/** O MESMO gerador de código do POST do cadastro (contador `layout_documento`, pulando código já ocupado). */
async function gerarCodigo(ctx: ServiceCtx): Promise<string> {
  for (let i = 0; i < 1000; i++) {
    const codigo = await nextCode(ctx.tx, ctx.orgId, "layout_documento");
    const usado = await ctx.tx.query("select 1 from erp.layouts_documento where organization_id=$1 and code=$2", [ctx.orgId, codigo]);
    if (!usado.rowCount) return codigo;
  }
  throw validation("Não foi possível gerar o código do layout.");
}

/**
 * Nome livre entre os VIVOS da organização: o do arquivo, senão "<nome> (importado)", "<nome> (importado 2)"...
 * UMA consulta: os candidatos vão em lista e o PostgreSQL devolve o primeiro livre com o MESMO `lower()` do índice
 * único (`ux_layouts_documento_nome_vivo`), sem laço de consultas e sem comparar maiúsculas em JavaScript.
 */
async function nomeImportadoLivre(ctx: ServiceCtx, nome: string): Promise<string> {
  const candidatos = Array.from({ length: 1000 }, (_, n) => (n === 0 ? nome : `${nome} (importado${n > 1 ? ` ${n}` : ""})`));
  const r = await ctx.tx.query<{ nome: string }>(
    `select c.nome from unnest($2::text[]) with ordinality as c(nome, ordem)
      where not exists (select 1 from erp.layouts_documento l where l.organization_id = $1 and l.deleted_at is null and lower(l.nome) = lower(c.nome))
      order by c.ordem limit 1`, [ctx.orgId, candidatos]);
  if (!r.rows[0]) throw validation("Não foi possível gerar o nome do layout importado.");
  return r.rows[0].nome;
}

export default async function layoutsDocumentoArquivoRoutes(app: FastifyInstance) {
  const BASE = "/admin/layouts-documento";

  /** EXPORTAR: o arquivo do layout, como anexo `layout-<code>.json`. A estrutura vai COMPLETA (com os registros). */
  app.get(`${BASE}/:id/exportar`, async (req, reply) => {
    const r = await runService(app, req, "tipos_operacao.view", async (ctx) => {
      const { id } = idSchema.parse(req.params);
      const l = await lerLayout(ctx, id);
      const arquivo: ArquivoLayoutDocumento = { formato: FORMATO_ARQUIVO_LAYOUT, versao: VERSAO_ARQUIVO_LAYOUT, familia: l.familia, nome: l.nome, estrutura: l.estrutura };
      return { code: l.code, arquivo };
    });
    // O código é gerado pelo sistema (dígitos); a limpeza é só defesa do cabeçalho.
    const nomeDoArquivo = `layout-${r.code.replace(/[^0-9A-Za-z_-]/g, "_")}.json`;
    return reply.header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${nomeDoArquivo}"`)
      .send(r.arquivo);
  });

  /**
   * IMPORTAR: rota ESTÁTICA (`/importar`); o POST do cadastro é na BASE e os demais são `/:id/<ação>` — não há POST
   * `/:id` com que colidir. Ordem: tamanho (≤ 64 KiB do JSON) → forma estrita do arquivo → registro padrão conferido
   * nesta organização (o que não vale sai e é listado) → validação do domínio → gravação numa transação.
   */
  app.post(`${BASE}/importar`, async (req, reply) => reply.status(201).send(await runService(app, req, "tipos_operacao.create", async (ctx) => {
    const bruto: unknown = req.body ?? null;
    if (Buffer.byteLength(JSON.stringify(bruto), "utf8") > LIMITE_ARQUIVO) {
      throw validation("Arquivo do layout grande demais", [{ path: "arquivo", message: "O arquivo excede 64 KiB." }]);
    }
    const arq = arquivoSchema.parse(bruto);
    const familia = arq.familia;
    let estrutura = arq.estrutura as EstruturaLayout;

    const removidos: { campo: string; motivo: string }[] = [];
    if (padroesRegistroDaEstrutura(familia, estrutura).length) {
      const { invalidos } = await conferirPadroesRegistro(ctx, familia, estrutura);
      const chaves = new Set(invalidos.map((x) => x.chave));
      if (chaves.size) {
        estrutura = removerPadroesRegistro(estrutura, chaves);
        for (const campo of chaves) removidos.push({ campo, motivo: MOTIVO_REGISTRO_NAO_VALE });
      }
    }

    const erros = validarEstruturaLayout(familia, estrutura);
    if (erros.length) {
      const details = erros.map((e) => ({ path: e.caminho, message: e.mensagem }));
      throw validation(details.length === 1 ? `${details[0]!.path}: ${details[0]!.message}` : "Estrutura do layout inválida", details);
    }

    const code = await gerarCodigo(ctx);
    const nome = await nomeImportadoLivre(ctx, arq.nome);
    const r = await ctx.tx.query<{ id: string }>(
      `insert into erp.layouts_documento (organization_id, code, nome, familia, estrutura, padrao, is_active)
       values ($1,$2,$3,$4,$5,false,true) returning id`,
      [ctx.orgId, code, nome, familia, JSON.stringify(estrutura)]);
    const id = r.rows[0]?.id;
    if (r.rowCount !== 1 || !id) throw err("CONFLICT", "Não foi possível importar o layout.");
    await audit(ctx.tx, ctx, "layouts_documento", id, "import",
      { code, familia, nomeNoArquivo: arq.nome, removidos: removidos.map((x) => x.campo) },
      { after: { nome, estrutura } });
    return { id, code, nome, removidos };
  })));
}
