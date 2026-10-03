/**
 * OPERACOES-01 F7 (decisão 284) — A CONFERÊNCIA DA IMPORTAÇÃO DO XML (o que a tela mostra antes de "Gerar compra").
 *
 * Tudo aqui é LEITURA, sob a RLS de quem pergunta (módulo compras) e com o escopo de empresa no SQL: nada é gravado.
 * As perguntas são feitas EM LOTE — uma consulta por pergunta, nunca uma por item da nota:
 *
 *   · a importação (`lerImportacao`) — inexistente, de outro tenant, fora do escopo de empresa e id malformado são a
 *     MESMA 404. A empresa SELECIONADA na tela não estreita a leitura (a importação é da empresa DESTINATÁRIA, que a
 *     pessoa pode ter escolhido no envio); o escopo do módulo, sim;
 *   · o PARCEIRO (`candidatosDoEmitente` + `resolverParceiro`) — o documento normalizado do emitente pela MESMA
 *     expressão do índice `ux_people_documento_normalizado` (que mantém as letras do CNPJ alfanumérico), mais as
 *     filiais de fornecedor (`provider_branches`) com o mesmo documento; com a IE do emitente e mais de um candidato,
 *     ficam os que casam a IE (do cadastro, dos endereços ou da filial) quando isso deixa ao menos um. Um → encontrado
 *     (ou "não é fornecedor"); mais de um → ambíguo, com os candidatos; nenhum → o pré-preenchimento do emitente (a
 *     tela cria SÓ com a confirmação da pessoa, pela porta de cadastro). Nunca "o primeiro";
 *   · os VÍNCULOS dos itens — três consultas no total: o vínculo LEMBRADO (fornecedor + código + unidade), o código no
 *     fornecedor (`produto_fornecedores`) e o código de barras (`products.barcode` e `produto_unidades.codigo_barras`);
 *     mais de um produto = ambíguo; produto excluído nunca é sugerido;
 *   · os PEDIDOS — os referenciados pela nota (`xPed`, o código do pedido) e até 20 candidatos do fornecedor, da
 *     empresa, abertos ou finalizados e com saldo (a conta do saldo é a da leitura do pedido); só para quem tem
 *     `pedidos_compra.view` (CAPACIDADE ∧ ESCOPO: a conferência não é uma porta lateral para o pedido);
 *   · as PARCELAS da nota, as DIVERGÊNCIAS (com `bloqueia`) e a DUPLICIDADE (a nota já lançada que a pessoa enxerga).
 */
import {
  lerNotaFiscalEletronica, quantidadeInterna, unitarioInterno, linhasDoItemDaNota, totaisDaCompra, conferirTotalDaNota, parcelasDaNota,
  valoresNaoSuportadosDaNota, normalizarUnidadeDaNota, saldoDoItemDoPedido, formatarChaveDeAcesso, CONTRATO_CONFERENCIA_IMPORTACAO_NFE,
  type NotaFiscalLida, type ItemDaNota, type ConferenciaDaImportacaoNfe, type ParceiroDaImportacaoNfe, type ProdutoDoVinculo,
  type VinculoDoItemDaNota, type ItemDaConferenciaNfe, type PedidoCandidatoDaNota, type DivergenciaDaImportacaoNfe, type TipoFator,
  type ControleDeLoteDoProduto, type SituacaoImportacaoNfe, type OrigemImportacaoNfe, type LinhaDaCompraDaNota,
} from "@agro/domain";
import { D, money } from "@agro/shared";
import { err } from "./errors.js";
import { empresaScopeSql, hasPermission, type ServiceCtx } from "./context.js";
import { documentoNormalizado, SQL_DOCUMENTO_NORMALIZADO } from "./nota-fiscal-xml.js";

/** A mesma 404 para tudo o que a pessoa não pode ver (e para o id malformado, antes de qualquer SQL). */
export const naoEncontrada = () => err("NOT_FOUND", "Importação não encontrada");
export const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recusa = (path: string, message: string, extra: Record<string, unknown> = {}) => err("VALIDATION_ERROR", message, [{ path, message, ...extra }]);

export const MSG_FORNECEDOR_NAO_EMITENTE = "O fornecedor escolhido não é o emitente desta nota.";
export const MSG_FORNECEDOR_SEM_TIPO = "O cadastro escolhido não é do tipo Fornecedor: marque-o como fornecedor no cadastro.";
export const MSG_XML_GUARDADO_ILEGIVEL = "O XML guardado desta importação não pôde ser lido de novo: descarte a importação e importe o arquivo outra vez.";
const PERMISSAO_VER_PEDIDO = "pedidos_compra.view";
const LIMITE_PEDIDOS_CANDIDATOS = 20;

// ─────────────── a importação ───────────────

export interface ImportacaoLida {
  id: string; empresa_id: string; empresa_nome: string; xml_id: string; chave_acesso: string; origem: OrigemImportacaoNfe; dfe_id: string | null;
  situacao: SituacaoImportacaoNfe; documento_compra_id: string | null; documento_compra_codigo: string | null; documento_compra_situacao: string | null;
  criado_em: string; criado_por_nome: string | null; xml_original: string;
}

/**
 * A IMPORTAÇÃO, no escopo de empresa do módulo (a RLS também recorta). `lock` trava SÓ a linha da importação
 * (`for update of i`): é a 1ª trava do "Gerar compra" e do "Descartar" — duas decisões sobre a mesma importação se
 * enfileiram aqui, e a segunda lê a situação que a primeira gravou.
 */
export async function lerImportacao(ctx: ServiceCtx, id: string, o: { lock?: boolean } = {}): Promise<ImportacaoLida> {
  if (!FORMA_UUID.test(id)) throw naoEncontrada();
  const params: unknown[] = [id.toLowerCase(), ctx.orgId];
  const escopo = empresaScopeSql(ctx, "i", params, { ignoreSelected: true });
  const r = await ctx.tx.query<ImportacaoLida>(
    `select i.id::text as id, i.empresa_id::text as empresa_id, e.name as empresa_nome, i.xml_id::text as xml_id, i.chave_acesso, i.origem,
            i.dfe_id::text as dfe_id, i.situacao, i.documento_compra_id::text as documento_compra_id, dc.codigo as documento_compra_codigo,
            dc.situacao as documento_compra_situacao, to_char(i.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as criado_em,
            u.name as criado_por_nome, x.xml_original
       from erp.importacoes_nfe_compra i
       join erp.empresas e on e.id = i.empresa_id and e.organization_id = i.organization_id
       join erp.notas_fiscais_xml x on x.id = i.xml_id and x.organization_id = i.organization_id
       left join erp.users u on u.id = i.criado_por
       left join erp.documentos_compra dc on dc.id = i.documento_compra_id and dc.organization_id = i.organization_id
      where i.id = $1 and i.organization_id = $2${escopo}${o.lock ? " for update of i" : ""}`, params);
  const linha = r.rows[0];
  if (!linha) throw naoEncontrada();
  return linha;
}

/** A nota do XML GUARDADO (os valores do "Gerar compra" vêm sempre daqui, nunca do corpo). */
export function notaDaImportacao(imp: Pick<ImportacaoLida, "xml_original" | "chave_acesso">): NotaFiscalLida {
  const leitura = lerNotaFiscalEletronica(imp.xml_original);
  // O XML foi lido ao importar; ilegível agora (leitor mudou de regra) é recusa explícita, nunca uma conferência pela metade.
  if (!leitura.ok || leitura.nota.chave !== imp.chave_acesso) throw err("VALIDATION_ERROR", MSG_XML_GUARDADO_ILEGIVEL);
  return leitura.nota;
}

// ─────────────── o parceiro ───────────────

export interface CandidatoDoEmitente {
  id: string; nome: string; documento: string; origem: "cadastro" | "filial"; ie: string | null; ies: string[]; fornecedor: boolean;
}

/** IE só com dígitos; "ISENTO" literal; vazio = sem IE. */
function normalizarIe(ie: string | null | undefined): string | null {
  const t = String(ie ?? "").trim();
  if (!t) return null;
  if (t.toUpperCase() === "ISENTO") return "ISENTO";
  return t.replace(/\D/g, "") || null;
}

/**
 * Os CANDIDATOS a parceiro do emitente, numa consulta: o cadastro vivo com o documento normalizado e as pessoas vivas
 * com uma filial de fornecedor do mesmo documento. A mesma pessoa pelos dois caminhos é UM candidato (origem
 * "cadastro"). Com a IE do emitente e mais de um candidato, ficam os que casam a IE — quando isso deixa ao menos um.
 */
export async function candidatosDoEmitente(ctx: ServiceCtx, nota: NotaFiscalLida): Promise<CandidatoDoEmitente[]> {
  const documento = documentoNormalizado(nota.emitente.documento);
  if (!documento) return [];
  const r = await ctx.tx.query<{ id: string; nome: string; documento: string; origem: "cadastro" | "filial"; ie: string | null; ies: string[] | null; fornecedor: boolean }>(
    `select p.id::text as id, p.name as nome, p.document as documento, 'cadastro' as origem, p.state_registration as ie,
            array(select pe.inscricao_estadual from erp.parceiro_enderecos pe
                   where pe.organization_id = p.organization_id and pe.person_id = p.id and pe.deleted_at is null and pe.inscricao_estadual is not null) as ies,
            p.is_provider as fornecedor
       from erp.people p
      where p.organization_id = $1 and p.deleted_at is null and ${SQL_DOCUMENTO_NORMALIZADO("p.document")} = $2
     union all
     select p.id::text, p.name, b.document, 'filial', b.state_registration, array[]::text[], p.is_provider
       from erp.provider_branches b
       join erp.people p on p.id = b.person_id
      where p.organization_id = $1 and p.deleted_at is null and b.document is not null and ${SQL_DOCUMENTO_NORMALIZADO("b.document")} = $2
      order by 4, 2, 1`, [ctx.orgId, documento]);
  const porPessoa = new Map<string, CandidatoDoEmitente>();
  for (const x of r.rows) {
    const ja = porPessoa.get(x.id);
    if (ja) { if (x.ie) ja.ies.push(x.ie); continue; }
    porPessoa.set(x.id, { id: x.id, nome: x.nome, documento: x.documento, origem: x.origem, ie: x.ie, ies: [...(x.ies ?? [])], fornecedor: x.fornecedor });
  }
  const todos = [...porPessoa.values()];
  const ieNota = normalizarIe(nota.emitente.ie);
  if (ieNota && todos.length > 1) {
    const casam = todos.filter((c) => [c.ie, ...c.ies].some((ie) => normalizarIe(ie) === ieNota));
    if (casam.length >= 1) return casam;
  }
  return todos;
}

/**
 * O PARCEIRO da conferência e o fornecedor ESCOLHIDO. `fornecedorPedido` (o `?fornecedor_id`, ou o do corpo do gerar)
 * é PEDIDO: tem de ser um dos candidatos (senão 422 em `campo`) e, para ser escolhido, do tipo Fornecedor.
 */
export function resolverParceiro(candidatos: readonly CandidatoDoEmitente[], fornecedorPedido: string | null, campo = "fornecedor_id"):
  { parceiro: Exclude<ParceiroDaImportacaoNfe, { situacao: "nenhum" }> | null; fornecedorEscolhido: string | null } {
  const pedido = fornecedorPedido?.toLowerCase() ?? null;
  if (pedido) {
    const c = candidatos.find((x) => x.id === pedido);
    if (!c) throw recusa(campo, MSG_FORNECEDOR_NAO_EMITENTE);
    if (!c.fornecedor) throw recusa(campo, MSG_FORNECEDOR_SEM_TIPO);
  }
  if (candidatos.length === 0) return { parceiro: null, fornecedorEscolhido: null };
  if (candidatos.length === 1) {
    const c = candidatos[0]!;
    return c.fornecedor
      ? { parceiro: { situacao: "encontrado", id: c.id, nome: c.nome, documento: c.documento }, fornecedorEscolhido: c.id }
      : { parceiro: { situacao: "nao_fornecedor", id: c.id, nome: c.nome }, fornecedorEscolhido: null };
  }
  return {
    parceiro: { situacao: "ambiguo", candidatos: candidatos.map((c) => ({ id: c.id, nome: c.nome, documento: c.documento, origem: c.origem, ie: c.ie })) },
    fornecedorEscolhido: pedido,
  };
}

/** O pré-preenchimento do cadastro de fornecedor (chaves do recurso `people`), pelo emitente; a cidade só se existe. */
async function preenchimentoDoEmitente(ctx: ServiceCtx, nota: NotaFiscalLida): Promise<Extract<ParceiroDaImportacaoNfe, { situacao: "nenhum" }>> {
  const e = nota.emitente;
  const codigo = e.endereco.codigoMunicipio && /^\d{7}$/.test(e.endereco.codigoMunicipio) ? Number(e.endereco.codigoMunicipio) : null;
  const cidade = codigo === null ? null
    : (await ctx.tx.query<{ id: number }>("select id from erp.cities where id = $1", [codigo])).rows[0]?.id ?? null;
  return {
    situacao: "nenhum",
    preenchimento: {
      name: e.fantasia ?? e.nome, legal_name: e.nome, person_type: e.tipo === "cnpj" ? "legal" : "natural", document: e.documento,
      state_registration: e.ie, is_provider: true, zip_code: e.endereco.cep, address: e.endereco.logradouro, address_number: e.endereco.numero,
      district: e.endereco.bairro, city_id: cidade, phone: e.endereco.telefone,
    },
  };
}

// ─────────────── os vínculos dos itens ───────────────

interface LinhaDeProduto { id: string; codigo: string; descricao: string; unidade: string | null; controle_lote: ControleDeLoteDoProduto; controla_estoque: boolean }
const COLUNAS_PRODUTO = `p.id::text as id, p.code as codigo, p.description as descricao, mu.symbol as unidade, p.controle_lote, p.control_stock as controla_estoque`;
const produtoDoVinculo = (p: LinhaDeProduto): ProdutoDoVinculo =>
  ({ id: p.id, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, controleLote: p.controle_lote, controlaEstoque: p.controla_estoque });

/** Os códigos de barras que valem (o leitor já tirou "SEM GTIN"; vazio não casa). */
const eanDoItem = (i: ItemDaNota): string | null => (i.ean && i.ean.trim() && i.ean.trim().toUpperCase() !== "SEM GTIN" ? i.ean.trim() : null);
const chaveDoVinculo = (codigo: string, unidade: string) => `${codigo}\u0000${unidade}`;

/**
 * O VÍNCULO de cada item, em TRÊS consultas (nunca uma por item): lembrado → código no fornecedor → código de barras.
 * Sem fornecedor escolhido, só o código de barras (o vínculo é do fornecedor).
 */
export async function vinculosDosItens(ctx: ServiceCtx, nota: NotaFiscalLida, fornecedorId: string | null): Promise<Map<number, VinculoDoItemDaNota>> {
  const codigos = [...new Set(nota.itens.map((i) => i.codigo.trim()))];
  const unidades = nota.itens.map((i) => normalizarUnidadeDaNota(i.unidade));
  const lembrados = new Map<string, { produto: LinhaDeProduto; fator: string; tipo: TipoFator }>();
  const doFornecedor = new Map<string, Map<string, { produto: LinhaDeProduto; fator: string; tipo: TipoFator }>>();
  if (fornecedorId) {
    const l = await ctx.tx.query<LinhaDeProduto & { codigo_fornecedor: string; unidade_fornecedor: string; fator: string; tipo_fator: TipoFator }>(
      `select v.codigo_fornecedor, v.unidade_fornecedor, v.fator::text as fator, v.tipo_fator, ${COLUNAS_PRODUTO}
         from erp.produto_fornecedor_vinculos v
         join erp.products p on p.id = v.produto_id and p.organization_id = v.organization_id and p.deleted_at is null
         left join erp.measurement_units mu on mu.id = p.measurement_id
        where v.organization_id = $1 and v.fornecedor_id = $2
          and (v.codigo_fornecedor, v.unidade_fornecedor) in (select * from unnest($3::text[], $4::text[]))`,
      [ctx.orgId, fornecedorId, nota.itens.map((i) => i.codigo.trim()), unidades]);
    for (const x of l.rows) lembrados.set(chaveDoVinculo(x.codigo_fornecedor, x.unidade_fornecedor), { produto: x, fator: x.fator, tipo: x.tipo_fator });
    // O código no fornecedor (cadastro do produto). A unidade de compra do cadastro, quando é uma unidade alternativa do
    // produto, dá o fator dela; senão 1 (multiplica).
    const s = await ctx.tx.query<LinhaDeProduto & { codigo_no_fornecedor: string; fator: string | null; tipo_fator: TipoFator | null }>(
      `select btrim(pf.codigo_no_fornecedor) as codigo_no_fornecedor, pu.fator::text as fator, pu.tipo_fator, ${COLUNAS_PRODUTO}
         from erp.produto_fornecedores pf
         join erp.products p on p.id = pf.product_id and p.organization_id = pf.organization_id and p.deleted_at is null
         left join erp.measurement_units mu on mu.id = p.measurement_id
         left join erp.produto_unidades pu on pu.product_id = pf.product_id and pu.organization_id = pf.organization_id
                                          and pu.measurement_id = pf.measurement_id and pu.deleted_at is null
        where pf.organization_id = $1 and pf.person_id = $2 and pf.deleted_at is null and btrim(pf.codigo_no_fornecedor) = any($3::text[])
        order by p.code, p.id`, [ctx.orgId, fornecedorId, codigos]);
    for (const x of s.rows) {
      const m = doFornecedor.get(x.codigo_no_fornecedor) ?? new Map();
      if (!m.has(x.id)) m.set(x.id, { produto: x, fator: x.fator ?? "1", tipo: x.tipo_fator ?? "multiply" });
      doFornecedor.set(x.codigo_no_fornecedor, m);
    }
  }
  const eans = [...new Set(nota.itens.map(eanDoItem).filter((x): x is string => Boolean(x)))];
  const porEan = new Map<string, Map<string, { produto: LinhaDeProduto; fator: string; tipo: TipoFator }>>();
  if (eans.length) {
    // O código de barras do produto (unidade padrão, fator 1) vem ANTES do da unidade alternativa (o fator dela).
    const b = await ctx.tx.query<LinhaDeProduto & { ean: string; fator: string; tipo_fator: TipoFator; ordem: number }>(
      `select btrim(p.barcode) as ean, '1' as fator, 'multiply' as tipo_fator, 0 as ordem, ${COLUNAS_PRODUTO}
         from erp.products p left join erp.measurement_units mu on mu.id = p.measurement_id
        where p.organization_id = $1 and p.deleted_at is null and btrim(p.barcode) = any($2::text[])
       union all
       select btrim(u.codigo_barras), u.fator::text, u.tipo_fator, 1, ${COLUNAS_PRODUTO}
         from erp.produto_unidades u
         join erp.products p on p.id = u.product_id and p.organization_id = u.organization_id and p.deleted_at is null
         left join erp.measurement_units mu on mu.id = p.measurement_id
        where u.organization_id = $1 and u.deleted_at is null and btrim(u.codigo_barras) = any($2::text[])
        order by ordem, codigo, id`, [ctx.orgId, eans]);
    for (const x of b.rows) {
      const m = porEan.get(x.ean) ?? new Map();
      if (!m.has(x.id)) m.set(x.id, { produto: x, fator: x.fator, tipo: x.tipo_fator });
      porEan.set(x.ean, m);
    }
  }
  const out = new Map<number, VinculoDoItemDaNota>();
  for (const item of nota.itens) {
    const lembrado = lembrados.get(chaveDoVinculo(item.codigo.trim(), normalizarUnidadeDaNota(item.unidade)));
    if (lembrado) { out.set(item.nItem, { situacao: "lembrado", produto: produtoDoVinculo(lembrado.produto), fator: lembrado.fator, tipoFator: lembrado.tipo }); continue; }
    const porCodigo = [...(doFornecedor.get(item.codigo.trim())?.values() ?? [])];
    if (porCodigo.length === 1) { const x = porCodigo[0]!; out.set(item.nItem, { situacao: "sugerido", origem: "codigo_fornecedor", produto: produtoDoVinculo(x.produto), fator: x.fator, tipoFator: x.tipo }); continue; }
    if (porCodigo.length > 1) { out.set(item.nItem, { situacao: "ambiguo", candidatos: porCodigo.map((x) => produtoDoVinculo(x.produto)) }); continue; }
    const ean = eanDoItem(item);
    const porBarras = [...((ean && porEan.get(ean)?.values()) || [])];
    if (porBarras.length === 1) { const x = porBarras[0]!; out.set(item.nItem, { situacao: "sugerido", origem: "codigo_barras", produto: produtoDoVinculo(x.produto), fator: x.fator, tipoFator: x.tipo }); continue; }
    if (porBarras.length > 1) { out.set(item.nItem, { situacao: "ambiguo", candidatos: porBarras.map((x) => produtoDoVinculo(x.produto)) }); continue; }
    out.set(item.nItem, { situacao: "nenhum", preenchimento: { description: item.descricao, ncm_code: item.ncm, barcode: ean } });
  }
  return out;
}

// ─────────────── os pedidos ───────────────

/** O saldo de um item de pedido: quantidade − o ligado em compras NÃO canceladas (a conta da leitura do pedido). */
const SQL_RECEBIDO = (item: string) => `coalesce((select sum(ci.quantidade) from erp.documentos_compra_itens ci
    join erp.documentos_compra cd on cd.id = ci.documento_id and cd.organization_id = ci.organization_id
   where ci.origem_item_id = ${item}.id and ci.organization_id = ${item}.organization_id and cd.situacao <> 'cancelado'), 0)`;

interface PedidoDaNota { id: string; codigo: string; situacao: string; data_documento: string; valor_total: string; condicao_pagamento_id: string | null }

/** Os pedidos referenciados (`xPed`, aparado) e os candidatos (com saldo, até 20), com os itens — três consultas. */
async function pedidosDaNota(ctx: ServiceCtx, imp: ImportacaoLida, nota: NotaFiscalLida, fornecedorId: string | null) {
  const xPeds = [...new Set([nota.xPedCabecalho, ...nota.itens.map((i) => i.xPed)].map((x) => x?.trim() ?? "").filter(Boolean))];
  const vazio = { referenciados: xPeds.map((xPed) => ({ xPed, pedido: null })), candidatos: [] as PedidoCandidatoDaNota[], porXPed: new Map<string, PedidoDaNota>(), itens: new Map<string, PedidoCandidatoDaNota["itens"]>() };
  if (!fornecedorId || !hasPermission(ctx, PERMISSAO_VER_PEDIDO)) return vazio;
  const base = (params: unknown[]) => `select d.id::text as id, d.codigo, d.situacao, to_char(d.data_documento, 'YYYY-MM-DD') as data_documento,
            d.valor_total::text as valor_total, d.condicao_pagamento_id::text as condicao_pagamento_id
       from erp.documentos_compra d
      where d.organization_id = $1 and d.especie = 'pedido' and d.empresa_id = $2 and d.fornecedor_id = $3 and d.situacao in ('aberto', 'finalizado')
        ${empresaScopeSql(ctx, "d", params, { ignoreSelected: true })}`;
  const pRef: unknown[] = [ctx.orgId, imp.empresa_id, fornecedorId];
  const sqlRef = base(pRef);
  pRef.push(xPeds);
  const referenciados = xPeds.length
    ? (await ctx.tx.query<PedidoDaNota>(`${sqlRef} and d.codigo = any($${pRef.length}::text[]) order by d.codigo, d.id`, pRef)).rows : [];
  const pCand: unknown[] = [ctx.orgId, imp.empresa_id, fornecedorId];
  const candidatos = (await ctx.tx.query<PedidoDaNota>(
    `${base(pCand)} and exists (select 1 from erp.documentos_compra_itens i
                                 where i.documento_id = d.id and i.organization_id = d.organization_id and i.quantidade > ${SQL_RECEBIDO("i")})
      order by d.data_documento desc, d.created_at desc, d.id limit ${LIMITE_PEDIDOS_CANDIDATOS}`, pCand)).rows;
  const ids = [...new Set([...referenciados, ...candidatos].map((p) => p.id))];
  const itens = new Map<string, PedidoCandidatoDaNota["itens"]>();
  if (ids.length) {
    const r = await ctx.tx.query<{ id: string; documento_id: string; posicao: number; produto_id: string; produto_descricao: string; quantidade: string; recebido: string; valor_unitario: string }>(
      `select i.id::text as id, i.documento_id::text as documento_id, i.posicao, i.produto_id::text as produto_id, p.description as produto_descricao,
              i.quantidade::text as quantidade, ${SQL_RECEBIDO("i")}::text as recebido, i.valor_unitario::text as valor_unitario
         from erp.documentos_compra_itens i
         join erp.products p on p.id = i.produto_id and p.organization_id = i.organization_id
        where i.organization_id = $1 and i.documento_id = any($2::uuid[])
        order by i.documento_id, i.posicao, i.id`, [ctx.orgId, ids]);
    for (const x of r.rows) {
      const lista = itens.get(x.documento_id) ?? [];
      lista.push({ id: x.id, posicao: x.posicao, produtoId: x.produto_id, produtoDescricao: x.produto_descricao, quantidade: x.quantidade,
        saldo: saldoDoItemDoPedido({ quantidade: x.quantidade, recebido: x.recebido }), valorUnitario: x.valor_unitario });
      itens.set(x.documento_id, lista);
    }
  }
  const porXPed = new Map(referenciados.map((p) => [p.codigo.trim(), p]));
  return {
    referenciados: xPeds.map((xPed) => { const p = porXPed.get(xPed); return { xPed, pedido: p ? { id: p.id, codigo: p.codigo, situacao: p.situacao } : null }; }),
    candidatos: candidatos.map((p) => ({ id: p.id, codigo: p.codigo, situacao: p.situacao, dataDocumento: p.data_documento, valorTotal: p.valor_total,
      condicaoPagamentoId: p.condicao_pagamento_id, itens: itens.get(p.id) ?? [] })),
    porXPed, itens,
  };
}

// ─────────────── duplicidade e DF-e ───────────────

/** A nota (chave) já lançada que a pessoa ENXERGA: compra viva ou Documento fiscal de Estoque não cancelado. */
export async function duplicidadeDaChave(ctx: ServiceCtx, chave: string): Promise<ConferenciaDaImportacaoNfe["duplicidade"]> {
  const compra = await ctx.tx.query<{ codigo: string }>(
    `select codigo from erp.documentos_compra where organization_id = $1 and especie = 'compra' and situacao <> 'cancelado' and chave_acesso = $2
      order by created_at, id limit 1`, [ctx.orgId, chave]);
  if (compra.rows[0]) return { onde: "compra", codigo: compra.rows[0].codigo };
  const nf = await ctx.tx.query<{ code: string }>(
    `select code from erp.invoices where organization_id = $1 and access_key = $2 and status <> 'cancelled' and deleted_at is null
      order by created_at, id limit 1`, [ctx.orgId, chave]);
  return nf.rows[0] ? { onde: "documento_fiscal_estoque", codigo: nf.rows[0].code } : null;
}

export interface DfeDaNota { id: string; launch_status: string; empresa_id: string | null }

/**
 * A DF-e que a compra gerada vai citar: a da importação (origem DF-e) ou, vinda de arquivo, a DF-e VISÍVEL da mesma
 * chave, sem empresa ou da empresa da importação, que não foi ignorada. Nenhuma → `null`.
 */
export async function dfeDaNota(ctx: ServiceCtx, imp: Pick<ImportacaoLida, "dfe_id" | "chave_acesso" | "empresa_id">, o: { lock?: boolean } = {}): Promise<DfeDaNota | null> {
  const params: unknown[] = [ctx.orgId];
  let filtro: string;
  if (imp.dfe_id) { params.push(imp.dfe_id); filtro = `d.id = $${params.length}`; }
  else { params.push(imp.chave_acesso, imp.empresa_id); filtro = `d.access_key = $2 and (d.empresa_id is null or d.empresa_id = $3) and d.launch_status <> 'ignored'`; }
  const escopo = empresaScopeSql(ctx, "d", params, { nullable: true, ignoreSelected: true });
  const r = await ctx.tx.query<DfeDaNota>(
    `select d.id::text as id, d.launch_status, d.empresa_id::text as empresa_id from erp.dfe_documents d
      where d.organization_id = $1 and ${filtro}${escopo}${o.lock ? " for update of d" : ""}`, params);
  return r.rows[0] ?? null;
}

// ─────────────── as contas da conferência ───────────────

/** As linhas que a compra teria com o vínculo (para o total e o rastro); `null` sem vínculo resolvido. */
function linhasDoVinculo(item: ItemDaNota, v: VinculoDoItemDaNota): { ok: true; linhas: LinhaDaCompraDaNota[] } | { ok: false; motivo: string } | null {
  if (v.situacao !== "lembrado" && v.situacao !== "sugerido") return null;
  try {
    const controle = v.produto.controlaEstoque ? v.produto.controleLote : "nenhum";
    const r = linhasDoItemDaNota(item, { produtoId: v.produto.id, fator: v.fator, tipoFator: v.tipoFator, controlaLote: controle });
    if (r.ok || r.motivo !== "lote_obrigatorio") return r;
    // Sem rastro, o lote é digitado na tela: para o total, a linha única.
    return linhasDoItemDaNota(item, { produtoId: v.produto.id, fator: v.fator, tipoFator: v.tipoFator, controlaLote: "nenhum" });
  } catch {
    return { ok: false, motivo: "quantidade_invalida" };
  }
}

/** O cabeçalho da compra pela nota: frete, outras, seguro, IPI e ICMS-ST; o desconto vai por item. */
export const cabecalhoDaNota = (nota: NotaFiscalLida) => ({
  frete: money(nota.totais.frete), outras: money(nota.totais.outras), desconto: "0.00", ipi: money(nota.totais.ipi),
  icmsSt: money(nota.totais.icmsSt), seguro: money(nota.totais.seguro),
});

const div = (codigo: string, mensagem: string, bloqueia: boolean, nItem: number | null = null): DivergenciaDaImportacaoNfe => ({ codigo, mensagem, nItem, bloqueia });
const MSG_NAO_SUPORTADO: Record<string, string> = {
  ii: "A nota tem Imposto de Importação (vII), que a compra não representa.",
  icms_desonerado: "A nota tem ICMS desonerado (vICMSDeson), que a compra não representa.",
  ipi_devolvido: "A nota tem IPI devolvido (vIPIDevol), que a compra não representa.",
};
export const mensagemNaoSuportado = (v: string) => MSG_NAO_SUPORTADO[v] ?? "A nota tem um valor que a compra não representa.";

/**
 * A CONFERÊNCIA (`ConferenciaDaImportacaoNfe`). `fornecedorPedido` = o `?fornecedor_id` (pedido, conferido contra os
 * candidatos). Pendências e divergências só na importação PENDENTE; decidida, a conferência é o registro do que foi.
 */
export async function montarConferencia(ctx: ServiceCtx, imp: ImportacaoLida, fornecedorPedido: string | null): Promise<ConferenciaDaImportacaoNfe> {
  const nota = notaDaImportacao(imp);
  const candidatos = await candidatosDoEmitente(ctx, nota);
  const { parceiro: achado, fornecedorEscolhido } = resolverParceiro(candidatos, fornecedorPedido);
  const parceiro: ParceiroDaImportacaoNfe = achado ?? await preenchimentoDoEmitente(ctx, nota);
  const vinculos = await vinculosDosItens(ctx, nota, fornecedorEscolhido);
  const pedidos = await pedidosDaNota(ctx, imp, nota, fornecedorEscolhido);
  const pendente = imp.situacao === "pendente";
  const divergencias: DivergenciaDaImportacaoNfe[] = [];

  if (parceiro.situacao === "nenhum") divergencias.push(div("parceiro_nenhum", "Nenhum cadastro com o CNPJ/CPF do emitente: cadastre o fornecedor.", true));
  if (parceiro.situacao === "nao_fornecedor") divergencias.push(div("parceiro_nao_fornecedor", "O cadastro encontrado não é do tipo Fornecedor.", true));
  if (parceiro.situacao === "ambiguo" && !fornecedorEscolhido) divergencias.push(div("parceiro_ambiguo", "Mais de um cadastro corresponde ao emitente: escolha o fornecedor.", true));
  // A IE com UM candidato só: o documento achou o cadastro; a IE dele (ou das filiais/endereços) diferente da do emitente
  // é AVISO (não bloqueia — a IE muda e o cadastro atrasa): a pessoa confere antes de gerar. Cadastro sem IE: nada a comparar.
  if (parceiro.situacao === "encontrado" && candidatos.length === 1) {
    const ieNota = normalizarIe(nota.emitente.ie);
    const iesDoCadastro = [candidatos[0]!.ie, ...candidatos[0]!.ies].map(normalizarIe).filter((x): x is string => x !== null);
    if (ieNota && iesDoCadastro.length > 0 && !iesDoCadastro.includes(ieNota)) {
      divergencias.push(div("parceiro_ie_diferente", `A inscrição estadual do cadastro ${parceiro.nome} não é a do emitente da nota (${nota.emitente.ie}): confira o fornecedor.`, false));
    }
  }

  const linhasDaConta: LinhaDaCompraDaNota[] = [];
  let todosComVinculo = true;
  const itens: ItemDaConferenciaNfe[] = nota.itens.map((item) => {
    const vinculo = vinculos.get(item.nItem)!;
    let quantidade: string | null = null; let unitario: string | null = null;
    if (vinculo.situacao === "lembrado" || vinculo.situacao === "sugerido") {
      try {
        quantidade = quantidadeInterna(item.quantidade, vinculo.fator, vinculo.tipoFator);
        unitario = D(quantidade).gt(0) ? unitarioInterno(item.valorProdutos, quantidade) : null;
      } catch { quantidade = null; unitario = null; }
    }
    if (vinculo.situacao === "nenhum") divergencias.push(div("item_sem_vinculo", `Item ${item.nItem}: associe um produto (ou crie o produto).`, true, item.nItem));
    if (vinculo.situacao === "ambiguo") divergencias.push(div("item_ambiguo", `Item ${item.nItem}: mais de um produto corresponde; escolha o produto.`, true, item.nItem));
    const linhas = linhasDoVinculo(item, vinculo);
    if (!linhas) todosComVinculo = false;
    else if (!linhas.ok) {
      todosComVinculo = false;
      if (linhas.motivo === "rastro_diferente_da_quantidade") divergencias.push(div("rastro_diferente_da_quantidade", `Item ${item.nItem}: a soma dos lotes do rastro não é a quantidade do item.`, true, item.nItem));
      else divergencias.push(div("quantidade_invalida", `Item ${item.nItem}: a conversão pelo fator deixa a quantidade zerada; confira o fator.`, true, item.nItem));
    } else linhasDaConta.push(...linhas.linhas);
    if ((vinculo.situacao === "lembrado" || vinculo.situacao === "sugerido") && vinculo.produto.controlaEstoque && vinculo.produto.controleLote !== "nenhum" && item.rastro.length === 0) {
      divergencias.push(div("lote_sem_rastro", `Item ${item.nItem}: o produto controla lote e a nota não traz o rastro; informe o lote.`, false, item.nItem));
    }
    // O item do pedido pela nota: xPed (do item, ou do cabeçalho) e nItemPed (1, 2, …) → posição (0, 1, …).
    const xPed = (item.xPed ?? nota.xPedCabecalho)?.trim() ?? "";
    const pedido = xPed ? pedidos.porXPed.get(xPed) : undefined;
    const itemDoPedido = pedido && item.nItemPed !== null ? (pedidos.itens.get(pedido.id) ?? []).find((x) => x.posicao === item.nItemPed! - 1) : undefined;
    if (itemDoPedido && unitario !== null && (vinculo.situacao === "lembrado" || vinculo.situacao === "sugerido") && !D(unitario).eq(D(itemDoPedido.valorUnitario))) {
      divergencias.push(div("preco_diferente_do_pedido", `Item ${item.nItem}: o preço da nota (${unitario}) é diferente do preço do pedido ${pedido!.codigo} (${itemDoPedido.valorUnitario}).`, false, item.nItem));
    }
    return { nItem: item.nItem, vinculo, quantidadeInterna: quantidade, valorUnitarioInterno: unitario,
      itemDoPedido: itemDoPedido ? { pedidoId: pedido!.id, itemId: itemDoPedido.id, posicao: itemDoPedido.posicao } : null };
  });

  for (const v of valoresNaoSuportadosDaNota(nota)) divergencias.push(div(`nao_suportado_${v}`, mensagemNaoSuportado(v), true));
  // O total da compra com os vínculos: só quando TODO item tem vínculo resolvido (senão a conta não existe ainda).
  let totalDaCompra = money(nota.totais.nota);
  if (todosComVinculo) {
    const t = totaisDaCompra(linhasDaConta.map((l) => ({ quantidade: l.quantidade, valorUnitario: l.valorUnitario, desconto: l.desconto })), cabecalhoDaNota(nota));
    const conf = conferirTotalDaNota(t.total, nota.totais.nota);
    if (!conf.confere) divergencias.push(div("total_diferente", `O total calculado (${t.total}) não bate com o total da nota (${money(nota.totais.nota)}).`, true));
    else totalDaCompra = t.total;
  }
  const parcelas = parcelasDaNota(nota, totalDaCompra);
  if (parcelas.situacao === "nao_conferem") {
    divergencias.push(div("parcelas_nao_conferem", `As duplicatas da nota (${parcelas.soma}) não conferem com o líquido (${parcelas.liquido}): use a condição de pagamento.`, false));
  }

  let duplicidade: ConferenciaDaImportacaoNfe["duplicidade"] = null;
  if (pendente) {
    duplicidade = await duplicidadeDaChave(ctx, imp.chave_acesso);
    if (duplicidade) {
      const onde = duplicidade.onde === "compra" ? `na Compra ${duplicidade.codigo}` : `no Documento fiscal de Estoque ${duplicidade.codigo}`;
      divergencias.push(div("nota_ja_lancada", `A nota de chave ${formatarChaveDeAcesso(imp.chave_acesso)} já está ${onde}.`, true));
    }
    const dfe = await dfeDaNota(ctx, imp);
    if (dfe && dfe.launch_status !== "pending") {
      divergencias.push(div("dfe_em_andamento", dfe.launch_status === "draft"
        ? "A DF-e desta nota tem um rascunho de aprovação pendente: aprove-o ou ignore-o na fila de DF-e."
        : dfe.launch_status === "ignored" ? "A DF-e desta nota foi ignorada na fila de DF-e." : "A DF-e desta nota já foi lançada.", true));
    }
  }

  return {
    contractVersion: CONTRATO_CONFERENCIA_IMPORTACAO_NFE,
    id: imp.id, situacao: imp.situacao, origem: imp.origem, dfeId: imp.dfe_id, criadoEm: imp.criado_em, criadoPorNome: imp.criado_por_nome,
    empresa: { id: imp.empresa_id, nome: imp.empresa_nome },
    documentoCompra: imp.documento_compra_id && imp.documento_compra_codigo
      ? { id: imp.documento_compra_id, codigo: imp.documento_compra_codigo, situacao: imp.documento_compra_situacao ?? "" } : null,
    nota, fornecedorEscolhido, parceiro, itens,
    pedidos: { referenciados: pedidos.referenciados, candidatos: pedidos.candidatos },
    financeiro: { parcelas: { ...parcelas, origem: "nota" } },
    divergencias: pendente ? divergencias : [],
    duplicidade,
  };
}
