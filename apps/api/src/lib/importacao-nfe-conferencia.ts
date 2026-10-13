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
 *   · os VÍNCULOS dos itens (decisão 314: identidade primeiro, semelhança depois) — no máximo cinco consultas, uma por
 *     caminho, cada uma só para os itens que os caminhos de cima não resolveram: o vínculo LEMBRADO (fornecedor + código
 *     + unidade), o código no fornecedor (`produto_fornecedores`), o código de barras (`products.barcode` e
 *     `produto_unidades.codigo_barras`), a REFERÊNCIA do produto (`products.reference` = cProd) e a DESCRIÇÃO semelhante
 *     (`descricao-do-produto` do domínio); mais de um produto = ambíguo; produto excluído nunca é sugerido;
 *   · o FATOR de cada item com produto (XML-04, decisão 318) e a UNIDADE do produto a criar (XML-01, decisão 312) — UMA
 *     consulta para a nota (`cadastroDoFator`): as unidades de medida dos uCom, a unidade principal e o código de barras
 *     dos produtos achados e as unidades vivas deles. O fator vem do CADASTRO pelo uCom da nota, nunca de um chute
 *     (`fatorDoItemPelaNota`); a unidade do produto a criar, da mesma linha (`unidadeDoCadastroPelaNota`); a
 *     conferência declara `criarProdutosDaNota`;
 *   · os PEDIDOS — os referenciados pela nota (`xPed`, o código do pedido) e até 20 candidatos do fornecedor, da
 *     empresa, abertos ou finalizados e com saldo (a conta do saldo é a da leitura do pedido); só para quem tem
 *     `pedidos_compra.view` (CAPACIDADE ∧ ESCOPO: a conferência não é uma porta lateral para o pedido);
 *   · as PARCELAS da nota, as DIVERGÊNCIAS (com `bloqueia`) e a DUPLICIDADE (a nota já lançada que a pessoa enxerga).
 *     As parcelas que não conferem DIZEM POR QUÊ (XML-04, decisão 318): os três números e cada comparação, com a
 *     diferença (`mensagemDasParcelas`) — a regra, o código e o `bloqueia` continuam os de antes;
 *   · a FORMA DE PAGAMENTO que a nota diz (XML-04, decisão 318) — o tPag de EXATAMENTE um `<detPag>` (`formaDaNota`)
 *     vira forma pela LIGAÇÃO viva da organização (`erp.formas_pagamento_da_nfe`), numa consulta só e só quando há um
 *     tPag (`formaDePagamentoDaNota`); nunca "a primeira", nunca a inativa como forma da nota.
 */
import {
  lerNotaFiscalEletronica, quantidadeInterna, unitarioInterno, linhasDoItemDaNota, totaisDaCompra, conferirTotalDaNota, parcelasDaNota,
  valoresNaoSuportadosDaNota, normalizarUnidadeDaNota, saldoDoItemDoPedido, formatarChaveDeAcesso, CONTRATO_CONFERENCIA_IMPORTACAO_NFE,
  CAPACIDADE_CRIAR_PRODUTOS_DA_NOTA, type PreenchimentoDoProduto, type FatorDoItemDaNota, formaDaNota, type FormaDePagamentoDaConferencia,
  type ParcelasDaNota, type FalhaDasParcelasDaNota,
  TRADUCAO_DA_DESCRICAO_DE, TRADUCAO_DA_DESCRICAO_PARA, TETO_DE_CANDIDATOS_DA_DESCRICAO, sqlLexemasDaDescricao, sqlLexemasEmComum,
  sqlLexemasNoTotal, sqlAcimaDoLimiarDaDescricao, mesmoNcm, decidirPelaDescricao, type CandidatoDaDescricao,
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
const eanDoItem = (i: Pick<ItemDaNota, "ean">): string | null => (i.ean && i.ean.trim() && i.ean.trim().toUpperCase() !== "SEM GTIN" ? i.ean.trim() : null);
const chaveDoVinculo = (codigo: string, unidade: string) => `${codigo}\u0000${unidade}`;

/** Uma unidade de medida que o uCom pode ser: a da ORGANIZAÇÃO (`daOrganizacao`) ou a do sistema (`organization_id` nulo). */
export interface UnidadeDoCadastro { id: string; simbolo: string; daOrganizacao: boolean }

/** O símbolo do cadastro como a consulta o compara: `upper(btrim(symbol))` (o `btrim` tira só espaço). */
const simboloDoCadastro = (s: string) => String(s ?? "").replace(/^ +| +$/g, "").toUpperCase();

/**
 * A UNIDADE do cadastro pelo uCom da nota (XML-01, decisão 312) — PURA, e a única decisão (a consulta só traz as
 * linhas): o uCom normalizado (`normalizarUnidadeDaNota`) IGUAL ao símbolo aparado em maiúsculas; nunca "a mais
 * parecida", nunca "a primeira". A da organização vence a do sistema: exatamente uma da organização → ela (mesmo que o
 * sistema também tenha); mais de uma da organização → nenhuma (não cai para a do sistema); nenhuma da organização → a
 * do sistema só quando é exatamente uma. uCom vazio → nenhuma. Unidade errada num produto é custo errado para sempre:
 * na dúvida, `null` (e o pré-preenchimento vem sem `measurement_id`).
 */
export function unidadeDoCadastroPelaNota(linhas: readonly UnidadeDoCadastro[], uCom: string): string | null {
  const alvo = normalizarUnidadeDaNota(uCom);
  if (!alvo) return null;
  const casam = linhas.filter((l) => simboloDoCadastro(l.simbolo) === alvo);
  const ids = (daOrganizacao: boolean) => [...new Set(casam.filter((l) => l.daOrganizacao === daOrganizacao).map((l) => l.id))];
  const daOrganizacao = ids(true);
  if (daOrganizacao.length > 0) return daOrganizacao.length === 1 ? daOrganizacao[0]! : null;
  const doSistema = ids(false);
  return doSistema.length === 1 ? doSistema[0]! : null;
}

/**
 * Uma unidade VIVA do produto (`erp.produto_unidades`; a consulta filtra `deleted_at`), de compra ou não. `simbolo` é o
 * da unidade de medida dela — só para a pergunta DIZER qual é (nunca decide nada); ausente ou nulo, a pergunta não o diz.
 */
export interface UnidadeDoProduto { measurementId: string; fator: string; tipoFator: TipoFator; usoCompra: boolean; codigoBarras: string | null; simbolo?: string | null }

/**
 * O cadastro de UM produto que o fator lê: a unidade principal (`measurement_id`, e o `simbolo` dela, só para dizer), o
 * código de barras e as unidades vivas.
 */
export interface CadastroDoProduto { measurementId: string; codigoBarras: string | null; unidades: readonly UnidadeDoProduto[]; simbolo?: string | null }

/** O fator de um item com produto: o que vai no vínculo (`fator`, `tipoFator`) e de onde ele veio (`fatorPelaNota`). */
export interface FatorDoItem { fator: string; tipoFator: TipoFator; fatorPelaNota: FatorDoItemDaNota }

/** O código de barras do cadastro como a consulta do 3º caminho o compara: `btrim` (só espaço); vazio não é código. */
const codigoDeBarrasDoCadastro = (s: string | null) => String(s ?? "").replace(/^ +| +$/g, "") || null;

/**
 * O FATOR DO ITEM PELO CADASTRO (XML-04, decisão 318) — PURA, e a única decisão (a consulta só traz as linhas). Para o
 * produto achado e o uCom da nota (`normalizarUnidadeDaNota`):
 *   1. o uCom vira UMA unidade do cadastro (`unidadeDoCadastroPelaNota`: a da organização vence a do sistema); nenhuma,
 *      ou mais de uma → PERGUNTA (`unidade_fora_do_cadastro`);
 *   2. é a unidade PRINCIPAL do produto → 1, multiplica (`unidade_principal`);
 *   3. senão, é a unidade de uma linha VIVA e DE COMPRA do produto → o fator e o tipo dela (`unidade_do_produto`); duas
 *      linhas dessas com fatores diferentes (o índice único do banco não deixa, mas a decisão não depende dele) → PERGUNTA;
 *   4. senão → PERGUNTA (`unidade_fora_do_cadastro`): a linha só de venda e a unidade que o produto não tem também.
 *      NUNCA 1 em silêncio;
 *   5. o cEAN da nota é o código de barras de alguma unidade do produto (`products.barcode` → a principal;
 *      `produto_unidades.codigo_barras` → a da linha, de compra ou não) e NENHUMA delas é a unidade de 2/3 → PERGUNTA
 *      (`codigo_de_barras_de_outra_unidade`). O código de barras nunca DÁ fator; o que não é de unidade do produto não conta.
 *      A pergunta leva o número na mão (`codigoDeBarras`: o símbolo da unidade dona do código e o fator dela no cadastro —
 *      a principal é 1, multiplica) SÓ quando o cEAN é de EXATAMENTE uma unidade do produto, com um fator só; de duas ou
 *      mais (ou sem o símbolo), o campo não vem — nunca "a primeira" (`unidadeDoCodigoDeBarras`).
 * A PERGUNTA leva fator 1, multiplica, SÓ pela web anterior (a desta versão pede o número). Com o vínculo LEMBRADO
 * (`lembrado`), o fator e o tipo são os DELE — a decisão explícita do operador para aquele fornecedor, código e unidade
 * vence o cadastro —, e `cadastro` só vem quando o cadastro respalda (não é pergunta) um fator DIFERENTE (número ou tipo).
 * Produto que a consulta não trouxe (`null`) não tem cadastro: PERGUNTA.
 */
export function fatorDoItemPelaNota(
  unidades: readonly UnidadeDoCadastro[], produto: CadastroDoProduto | null, item: Pick<ItemDaNota, "unidade" | "ean">,
  lembrado: { fator: string; tipoFator: TipoFator } | null = null,
): FatorDoItem {
  const unidadeDaNota = normalizarUnidadeDaNota(item.unidade);
  const peloCadastro = fatorPeloCadastro(unidades, produto, unidadeDaNota, eanDoItem(item));
  if (!lembrado) return peloCadastro;
  const c = peloCadastro.fatorPelaNota.origem === "pergunta" ? null : peloCadastro;
  const cadastro = c && (!D(c.fator).eq(D(lembrado.fator)) || c.tipoFator !== lembrado.tipoFator) ? { fator: c.fator, tipoFator: c.tipoFator } : null;
  return { fator: lembrado.fator, tipoFator: lembrado.tipoFator, fatorPelaNota: { origem: "vinculo", unidadeDaNota, cadastro } };
}

type PerguntaDoFator = Extract<FatorDoItemDaNota, { origem: "pergunta" }>;
/** O número na mão da pergunta do código de barras de outra unidade (o campo aditivo do contrato). */
type UnidadeDoCodigoDeBarras = NonNullable<PerguntaDoFator["codigoDeBarras"]>;
/** Uma unidade do produto de que o cEAN é o código de barras: a principal (1, multiplica) ou a de uma linha (o fator dela). */
interface DonoDoCodigoDeBarras { measurementId: string; simbolo: string | null; fator: string; tipoFator: TipoFator }

/**
 * A unidade de que o cEAN da nota é o código de barras, com o fator dela no cadastro (XML-04, decisão 318: a pergunta diz
 * o número, nunca "confira"). Só quando é EXATAMENTE uma unidade do produto e as fontes que a apontam (o
 * `products.barcode` e as linhas) dão UM fator só (número e tipo); duas unidades, dois fatores ou o símbolo ausente →
 * nada (o campo não vem). Nunca "a primeira". O símbolo vai como a régua da 312 o compara (`simboloDoCadastro`: aparado,
 * em maiúsculas) — a MESMA forma da `unidadeDaNota` ao lado ("sc" do seed é dito "SC", contra o "KG" da nota).
 */
function unidadeDoCodigoDeBarras(donos: readonly DonoDoCodigoDeBarras[]): UnidadeDoCodigoDeBarras | null {
  const [d] = donos;
  if (!d || donos.some((x) => x.measurementId !== d.measurementId || x.tipoFator !== d.tipoFator || !D(x.fator).eq(D(d.fator)))) return null;
  const unidade = simboloDoCadastro(d.simbolo ?? "");
  return unidade ? { unidade, fator: d.fator, tipoFator: d.tipoFator } : null;
}

function fatorPeloCadastro(unidades: readonly UnidadeDoCadastro[], produto: CadastroDoProduto | null, unidadeDaNota: string, ean: string | null): FatorDoItem {
  const pergunta = (motivo: PerguntaDoFator["motivo"], codigoDeBarras: UnidadeDoCodigoDeBarras | null = null): FatorDoItem =>
    ({ fator: "1", tipoFator: "multiply", fatorPelaNota: { origem: "pergunta", unidadeDaNota, motivo, ...(codigoDeBarras ? { codigoDeBarras } : {}) } });
  const unidade = unidadeDoCadastroPelaNota(unidades, unidadeDaNota);
  if (!unidade || !produto) return pergunta("unidade_fora_do_cadastro");
  let achado: FatorDoItem;
  if (unidade === produto.measurementId) {
    achado = { fator: "1", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_principal", unidadeDaNota } };
  } else {
    const deCompra = produto.unidades.filter((l) => l.measurementId === unidade && l.usoCompra);
    const linha = deCompra[0];
    if (!linha || deCompra.some((l) => l.tipoFator !== linha.tipoFator || !D(l.fator).eq(D(linha.fator)))) return pergunta("unidade_fora_do_cadastro");
    achado = { fator: linha.fator, tipoFator: linha.tipoFator, fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota } };
  }
  if (ean) {
    const donos: DonoDoCodigoDeBarras[] = [];
    if (codigoDeBarrasDoCadastro(produto.codigoBarras) === ean) {
      donos.push({ measurementId: produto.measurementId, simbolo: produto.simbolo ?? null, fator: "1", tipoFator: "multiply" });
    }
    for (const l of produto.unidades) {
      if (codigoDeBarrasDoCadastro(l.codigoBarras) === ean) donos.push({ measurementId: l.measurementId, simbolo: l.simbolo ?? null, fator: l.fator, tipoFator: l.tipoFator });
    }
    if (donos.length > 0 && !donos.some((d) => d.measurementId === unidade)) return pergunta("codigo_de_barras_de_outra_unidade", unidadeDoCodigoDeBarras(donos));
  }
  return achado;
}

/** O que a consulta do cadastro traz: as unidades de medida dos uCom e, por produto, o cadastro que o fator lê. */
export interface CadastroDoFator { unidades: UnidadeDoCadastro[]; produtos: Map<string, CadastroDoProduto> }

/**
 * O CADASTRO para o fator e para a unidade do produto a criar — UMA consulta para a nota (nunca uma por item): as
 * unidades de medida candidatas aos uCom (normalizados e DISTINTOS; da organização OU do sistema), a unidade principal e
 * o código de barras de cada produto achado (vivo) e as linhas VIVAS de `produto_unidades` deles (o uso de compra vai
 * junto: quem decide é `fatorDoItemPelaNota`). Na MESMA consulta, o símbolo da unidade principal e o de cada linha (a
 * coluna `simbolo`, pela unidade da organização ou do sistema): só para a pergunta do código de barras de outra unidade
 * DIZER qual é. Sem uCom, nenhuma consulta: sem unidade, nada se resolve.
 */
async function cadastroDoFator(ctx: ServiceCtx, produtoIds: readonly string[], simbolos: readonly string[]): Promise<CadastroDoFator> {
  const cadastro: CadastroDoFator = { unidades: [], produtos: new Map() };
  if (simbolos.length === 0) return cadastro;
  const r = await ctx.tx.query<{
    tipo: "unidade" | "produto" | "unidade_do_produto"; id: string; simbolo: string | null; da_organizacao: boolean | null;
    measurement_id: string | null; codigo_barras: string | null; fator: string | null; tipo_fator: TipoFator | null; uso_compra: boolean | null;
  }>(
    `select 'unidade' as tipo, mu.id::text as id, mu.symbol as simbolo, mu.organization_id is not null as da_organizacao,
            null::text as measurement_id, null::text as codigo_barras, null::text as fator, null::text as tipo_fator, null::boolean as uso_compra
       from erp.measurement_units mu
      where (mu.organization_id = $1 or mu.organization_id is null) and upper(btrim(mu.symbol)) = any($2::text[])
     union all
     select 'produto', p.id::text, pm.symbol, null, p.measurement_id::text, p.barcode, null, null, null
       from erp.products p
       left join erp.measurement_units pm on pm.id = p.measurement_id and (pm.organization_id = $1 or pm.organization_id is null)
      where p.organization_id = $1 and p.deleted_at is null and p.id = any($3::uuid[])
     union all
     select 'unidade_do_produto', pu.product_id::text, um.symbol, null, pu.measurement_id::text, pu.codigo_barras, pu.fator::text, pu.tipo_fator, pu.uso_compra
       from erp.produto_unidades pu
       left join erp.measurement_units um on um.id = pu.measurement_id and (um.organization_id = $1 or um.organization_id is null)
      where pu.organization_id = $1 and pu.deleted_at is null and pu.product_id = any($3::uuid[])`,
    [ctx.orgId, [...simbolos], [...produtoIds]]);
  const unidadesPorProduto = new Map<string, UnidadeDoProduto[]>();
  for (const x of r.rows) {
    if (x.tipo === "unidade") cadastro.unidades.push({ id: x.id, simbolo: x.simbolo ?? "", daOrganizacao: x.da_organizacao === true });
    else if (x.tipo === "produto") cadastro.produtos.set(x.id, { measurementId: x.measurement_id!, codigoBarras: x.codigo_barras, unidades: [], simbolo: x.simbolo ?? null });
    else {
      const lista = unidadesPorProduto.get(x.id) ?? [];
      lista.push({ measurementId: x.measurement_id!, fator: x.fator!, tipoFator: x.tipo_fator!, usoCompra: x.uso_compra === true, codigoBarras: x.codigo_barras,
        simbolo: x.simbolo ?? null });
      unidadesPorProduto.set(x.id, lista);
    }
  }
  for (const [id, p] of cadastro.produtos) cadastro.produtos.set(id, { ...p, unidades: unidadesPorProduto.get(id) ?? [] });
  return cadastro;
}

/**
 * 4º CAMINHO — a REFERÊNCIA do produto (`products.reference`, o "Cod. Produto (fornecedor)" do cadastro) igual ao cProd,
 * aparados os DOIS lados (`btrim`), sem caixa trocada (identidade é igualdade). UMA consulta, pelos cProd DISTINTOS dos
 * itens dados (os que os caminhos 1 a 3 não resolveram); nenhum item → nenhuma consulta. Só produto vivo e ATIVO: a
 * referência é um campo do produto, sem fornecedor — identidade mais fraca que as de cima —, e o produto inativo é o
 * que o próprio seletor da tela já não oferece (`resources.options` filtra `is_active`); a sugestão não pode trazer o
 * que a pessoa não escolheria à mão. A ordem é código e id (`collate "C"`: a mesma em qualquer locale do banco); mais
 * de um produto é ambíguo, nunca "o primeiro". Devolve, por referência aparada, os produtos na ordem.
 */
async function produtosPelaReferencia(ctx: ServiceCtx, itens: readonly ItemDaNota[]): Promise<Map<string, LinhaDeProduto[]>> {
  const porReferencia = new Map<string, LinhaDeProduto[]>();
  const codigos = [...new Set(itens.map((i) => i.codigo.trim()).filter(Boolean))];
  if (codigos.length === 0) return porReferencia;
  const r = await ctx.tx.query<LinhaDeProduto & { referencia: string }>(
    `select btrim(p.reference) as referencia, ${COLUNAS_PRODUTO}
       from erp.products p left join erp.measurement_units mu on mu.id = p.measurement_id
      where p.organization_id = $1 and p.deleted_at is null and p.is_active
        and btrim(p.reference) = any(select btrim(c) from unnest($2::text[]) as c)
      order by p.code collate "C", p.id`, [ctx.orgId, codigos]);
  for (const x of r.rows) {
    const lista = porReferencia.get(x.referencia) ?? [];
    lista.push(x);
    porReferencia.set(x.referencia, lista);
  }
  return porReferencia;
}

/**
 * O "mesmo NCM" em SQL — a MESMA regra de `mesmoNcm` do domínio: só os dígitos (`[^0-9]` some), os dois preenchidos e
 * iguais; nulo ou vazio de qualquer lado ⇒ falso. Serve à ORDEM do recorte no SQL (o desempate antes do teto); a decisão
 * usa a função do domínio, e o teste de integração da XML-02 confere as duas sobre os mesmos pares.
 */
export const sqlMesmoNcm = (ncmDoItem: string, ncmDoProduto: string): string => {
  const digitos = (col: string) => `regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g')`;
  return `(${digitos(ncmDoItem)} <> '' and ${digitos(ncmDoItem)} = ${digitos(ncmDoProduto)})`;
};

/**
 * 5º CAMINHO — a DESCRIÇÃO semelhante (`descricao-do-produto` do domínio): UMA consulta para a nota inteira, só para os
 * itens dados (os que os caminhos 1 a 4 não resolveram); nenhum item → nenhuma consulta. Tudo no SQL, e o Node recebe
 * só os candidatos que importam:
 *  · `lp` (materializada): os lexemas de cada produto da ORGANIZAÇÃO, vivo e ATIVO (a RLS também recorta; o filtro é
 *    explícito), pela normalização do domínio com as strings do `translate` como PARÂMETRO; `li` (materializada): os
 *    lexemas de cada item, por `unnest` (descrição, nItem, NCM). Materializar é o que faz o `to_tsvector` rodar uma vez
 *    por produto e por item, nunca por par;
 *  · o cruzamento só onde os lexemas se tocam (`&&`), com `comuns`/`total` (o Jaccard em inteiros) e o LIMIAR do
 *    domínio; a ordem é a do domínio (`compararCandidatosDaDescricao`): pontuação (a fração `comuns/total` em `numeric`
 *    — exata para as contagens de lexemas de uma descrição), mesmo NCM primeiro, código (`collate "C"`), id (a ordem do
 *    uuid é a do texto em minúsculas);
 *  · o TETO por item no SQL (`row_number() over (partition by item)`), com a contagem dos que passaram o limiar ao lado
 *    (o `acimaDoLimiar` do domínio, antes do corte; o contrato do ambíguo não o carrega).
 * O NCM nunca casa sozinho: só ordena dentro do empate (o cruzamento e o limiar são só da descrição).
 */
async function candidatosPelaDescricao(ctx: ServiceCtx, itens: readonly ItemDaNota[]): Promise<Map<number, (CandidatoDaDescricao & { produto: ProdutoDoVinculo })[]>> {
  const porItem = new Map<number, (CandidatoDaDescricao & { produto: ProdutoDoVinculo })[]>();
  if (itens.length === 0) return porItem;
  const r = await ctx.tx.query<LinhaDeProduto & { n_item: number; posicao: number; acima_do_limiar: number; comuns: number; total: number; ncm_produto: string | null }>(
    `with lp as materialized (
       select p.id, p.code, p.ncm_code, ${sqlLexemasDaDescricao("p.description", "$2", "$3")} as lex
         from erp.products p
        where p.organization_id = $1 and p.deleted_at is null and p.is_active
     ), li as materialized (
       select t.n_item, t.ncm, ${sqlLexemasDaDescricao("t.descricao", "$2", "$3")} as lex
         from unnest($4::text[], $5::int[], $6::text[]) as t(descricao, n_item, ncm)
     ), par as (
       select li.n_item, lp.id, lp.code, ${sqlLexemasEmComum("li.lex", "lp.lex")} as comuns, ${sqlLexemasNoTotal("li.lex", "lp.lex")} as total,
              ${sqlMesmoNcm("li.ncm", "lp.ncm_code")} as mesmo_ncm
         from li join lp on lp.lex && li.lex
     ), acima as (
       select par.n_item, par.id, par.comuns, par.total,
              row_number() over (partition by par.n_item
                                 order by par.comuns::numeric / par.total desc, par.mesmo_ncm desc, par.code collate "C", par.id) as posicao,
              count(*) over (partition by par.n_item) as acima_do_limiar
         from par
        where ${sqlAcimaDoLimiarDaDescricao("par.comuns", "par.total")}
     )
     select a.n_item, a.posicao::int as posicao, a.acima_do_limiar::int as acima_do_limiar, a.comuns, a.total, p.ncm_code as ncm_produto, ${COLUNAS_PRODUTO}
       from acima a
       join erp.products p on p.id = a.id and p.organization_id = $1
       left join erp.measurement_units mu on mu.id = p.measurement_id
      where a.posicao <= $7
      order by a.n_item, a.posicao`,
    [ctx.orgId, TRADUCAO_DA_DESCRICAO_DE, TRADUCAO_DA_DESCRICAO_PARA, itens.map((i) => i.descricao), itens.map((i) => i.nItem), itens.map((i) => i.ncm),
      TETO_DE_CANDIDATOS_DA_DESCRICAO]);
  const ncmDoItem = new Map(itens.map((i) => [i.nItem, i.ncm]));
  for (const x of r.rows) {
    const lista = porItem.get(x.n_item) ?? [];
    lista.push({ id: x.id, codigo: x.codigo, comuns: x.comuns, total: x.total, mesmoNcm: mesmoNcm(ncmDoItem.get(x.n_item), x.ncm_produto), produto: produtoDoVinculo(x) });
    porItem.set(x.n_item, lista);
  }
  return porItem;
}

/**
 * Um item que ACHOU produto, antes do fator: o fator é decidido depois, para todos de uma vez, com o cadastro numa
 * consulta só (`cadastroDoFator`). O lembrado leva o fator do vínculo; o sugerido pela descrição, o pré-preenchimento.
 */
type ProdutoAchado =
  | { situacao: "lembrado"; produto: ProdutoDoVinculo; lembrado: { fator: string; tipoFator: TipoFator } }
  | { situacao: "sugerido"; origem: "codigo_fornecedor" | "codigo_barras" | "reference"; produto: ProdutoDoVinculo }
  | { situacao: "sugerido"; origem: "descricao"; produto: ProdutoDoVinculo; preenchimento: PreenchimentoDoProduto };

/** O vínculo do item achado com o fator decidido (`fatorDoItemPelaNota`). */
function vinculoComFator(a: ProdutoAchado, f: FatorDoItem): VinculoDoItemDaNota {
  if (a.situacao === "lembrado") return { situacao: "lembrado", produto: a.produto, ...f };
  if (a.origem === "descricao") return { situacao: "sugerido", origem: "descricao", produto: a.produto, ...f, preenchimento: a.preenchimento };
  return { situacao: "sugerido", origem: a.origem, produto: a.produto, ...f };
}

/**
 * O VÍNCULO de cada item (decisão 314), em no máximo CINCO consultas (nunca uma por item), na ordem da força: lembrado →
 * código no fornecedor → código de barras → referência do produto → descrição semelhante. O caminho mais forte que
 * achou decide o item, e os de baixo NÃO rodam para ele (cada consulta nova leva só os itens ainda pendentes). Sem
 * fornecedor escolhido, os dois primeiros não rodam (o vínculo é do fornecedor). A descrição no máximo SUGERE (nada é
 * gravado aqui: o vínculo lembrado nasce só do que a pessoa confirma no "Gerar compra").
 *
 * Depois da IDENTIDADE, mais UMA consulta (`cadastroDoFator`), para a nota inteira: o FATOR de cada item com produto
 * (XML-04, decisão 318) vem do cadastro pelo uCom da nota, em TODOS os caminhos — o caminho decide QUAL produto, nunca o
 * fator (`fatorDoItemPelaNota`; o lembrado guarda o dele) —, e os itens sem vínculo (`nenhum`) e os sugeridos pela
 * descrição (que a nota ainda pode cadastrar) levam o pré-preenchimento da nota e, com a unidade resolvida pelas MESMAS
 * linhas, o `measurement_id`.
 *
 * `soIdentidade` (o lote do XML-01, decisão 314): só os caminhos 1 a 4 — a IDENTIDADE. A semelhança não roda, e o item
 * que só ela ligaria fica `nenhum`, como era: o lote continua recusando o que tem produto por identidade, e a sugestão
 * por descrição nunca impede cadastrar o produto da nota.
 */
export async function vinculosDosItens(
  ctx: ServiceCtx, nota: NotaFiscalLida, fornecedorId: string | null, opcoes: { soIdentidade?: boolean } = {}
): Promise<Map<number, VinculoDoItemDaNota>> {
  const codigos = [...new Set(nota.itens.map((i) => i.codigo.trim()))];
  const unidades = nota.itens.map((i) => normalizarUnidadeDaNota(i.unidade));
  const lembrados = new Map<string, { produto: LinhaDeProduto; fator: string; tipo: TipoFator }>();
  const doFornecedor = new Map<string, Map<string, LinhaDeProduto>>();
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
    // O código no fornecedor (cadastro do produto): só a IDENTIDADE — o fator é o do cadastro pelo uCom, como nos outros.
    const s = await ctx.tx.query<LinhaDeProduto & { codigo_no_fornecedor: string }>(
      `select btrim(pf.codigo_no_fornecedor) as codigo_no_fornecedor, ${COLUNAS_PRODUTO}
         from erp.produto_fornecedores pf
         join erp.products p on p.id = pf.product_id and p.organization_id = pf.organization_id and p.deleted_at is null
         left join erp.measurement_units mu on mu.id = p.measurement_id
        where pf.organization_id = $1 and pf.person_id = $2 and pf.deleted_at is null and btrim(pf.codigo_no_fornecedor) = any($3::text[])
        order by p.code, p.id`, [ctx.orgId, fornecedorId, codigos]);
    for (const x of s.rows) {
      const m = doFornecedor.get(x.codigo_no_fornecedor) ?? new Map<string, LinhaDeProduto>();
      if (!m.has(x.id)) m.set(x.id, x);
      doFornecedor.set(x.codigo_no_fornecedor, m);
    }
  }
  const eans = [...new Set(nota.itens.map(eanDoItem).filter((x): x is string => Boolean(x)))];
  const porEan = new Map<string, Map<string, LinhaDeProduto>>();
  if (eans.length) {
    // O código de barras do produto vem ANTES do da unidade alternativa (a ordem dos candidatos). Só a IDENTIDADE: o
    // código de barras nunca dá o fator (ele só põe o fator do cadastro em DÚVIDA — `fatorDoItemPelaNota`).
    const b = await ctx.tx.query<LinhaDeProduto & { ean: string; ordem: number }>(
      `select btrim(p.barcode) as ean, 0 as ordem, ${COLUNAS_PRODUTO}
         from erp.products p left join erp.measurement_units mu on mu.id = p.measurement_id
        where p.organization_id = $1 and p.deleted_at is null and btrim(p.barcode) = any($2::text[])
       union all
       select btrim(u.codigo_barras), 1, ${COLUNAS_PRODUTO}
         from erp.produto_unidades u
         join erp.products p on p.id = u.product_id and p.organization_id = u.organization_id and p.deleted_at is null
         left join erp.measurement_units mu on mu.id = p.measurement_id
        where u.organization_id = $1 and u.deleted_at is null and btrim(u.codigo_barras) = any($2::text[])
        order by ordem, codigo, id`, [ctx.orgId, eans]);
    for (const x of b.rows) {
      const m = porEan.get(x.ean) ?? new Map<string, LinhaDeProduto>();
      if (!m.has(x.id)) m.set(x.id, x);
      porEan.set(x.ean, m);
    }
  }
  const out = new Map<number, VinculoDoItemDaNota>();
  const achados = new Map<number, ProdutoAchado>();
  // 1 a 3: a IDENTIDADE pelo fornecedor e pelo código de barras (as consultas acima).
  const semIdentidade: ItemDaNota[] = [];
  for (const item of nota.itens) {
    const lembrado = lembrados.get(chaveDoVinculo(item.codigo.trim(), normalizarUnidadeDaNota(item.unidade)));
    if (lembrado) { achados.set(item.nItem, { situacao: "lembrado", produto: produtoDoVinculo(lembrado.produto), lembrado: { fator: lembrado.fator, tipoFator: lembrado.tipo } }); continue; }
    const porCodigo = [...(doFornecedor.get(item.codigo.trim())?.values() ?? [])];
    if (porCodigo.length === 1) { achados.set(item.nItem, { situacao: "sugerido", origem: "codigo_fornecedor", produto: produtoDoVinculo(porCodigo[0]!) }); continue; }
    if (porCodigo.length > 1) { out.set(item.nItem, { situacao: "ambiguo", candidatos: porCodigo.map(produtoDoVinculo) }); continue; }
    const ean = eanDoItem(item);
    const porBarras = [...((ean && porEan.get(ean)?.values()) || [])];
    if (porBarras.length === 1) { achados.set(item.nItem, { situacao: "sugerido", origem: "codigo_barras", produto: produtoDoVinculo(porBarras[0]!) }); continue; }
    if (porBarras.length > 1) { out.set(item.nItem, { situacao: "ambiguo", candidatos: porBarras.map(produtoDoVinculo) }); continue; }
    semIdentidade.push(item);
  }
  // 4: a REFERÊNCIA do produto — só para os que 1 a 3 não resolveram.
  const porReferencia = await produtosPelaReferencia(ctx, semIdentidade);
  const semReferencia: ItemDaNota[] = [];
  for (const item of semIdentidade) {
    const achadosDaReferencia = porReferencia.get(item.codigo.trim()) ?? [];
    if (achadosDaReferencia.length === 1) { achados.set(item.nItem, { situacao: "sugerido", origem: "reference", produto: produtoDoVinculo(achadosDaReferencia[0]!) }); continue; }
    if (achadosDaReferencia.length > 1) { out.set(item.nItem, { situacao: "ambiguo", candidatos: achadosDaReferencia.map(produtoDoVinculo) }); continue; }
    semReferencia.push(item);
  }
  // 5: a DESCRIÇÃO semelhante — só para os que 1 a 4 não resolveram, e nunca no `soIdentidade`; a decisão é a do domínio.
  const porDescricao = await candidatosPelaDescricao(ctx, opcoes.soIdentidade ? [] : semReferencia);
  const cadastraveis: ItemDaNota[] = [];
  for (const item of semReferencia) {
    const decisao = decidirPelaDescricao(porDescricao.get(item.nItem) ?? []);
    if (decisao.situacao === "ambiguo") { out.set(item.nItem, { situacao: "ambiguo", candidatos: decisao.candidatos.map((c) => c.produto) }); continue; }
    const preenchimento: PreenchimentoDoProduto = { description: item.descricao, ncm_code: item.ncm, barcode: eanDoItem(item) };
    if (decisao.situacao === "sugerido") achados.set(item.nItem, { situacao: "sugerido", origem: "descricao", produto: decisao.candidato.produto, preenchimento });
    else out.set(item.nItem, { situacao: "nenhum", preenchimento });
    cadastraveis.push(item);
  }
  // O CADASTRO (uma consulta): o fator de cada item achado e a unidade dos que a nota pode cadastrar (`nenhum` e sugerido
  // pela descrição). Sem casamento único da unidade, a chave `measurement_id` não vem (nunca nula, nunca "a mais parecida").
  const precisaDoCadastro = achados.size > 0 || cadastraveis.length > 0;
  const cadastro = await cadastroDoFator(ctx, [...new Set([...achados.values()].map((a) => a.produto.id))],
    precisaDoCadastro ? [...new Set(unidades.filter(Boolean))] : []);
  for (const item of nota.itens) {
    const achado = achados.get(item.nItem);
    if (achado) {
      const lembrado = achado.situacao === "lembrado" ? achado.lembrado : null;
      out.set(item.nItem, vinculoComFator(achado, fatorDoItemPelaNota(cadastro.unidades, cadastro.produtos.get(achado.produto.id) ?? null, item, lembrado)));
    }
    const v = out.get(item.nItem)!;
    if (v.situacao !== "nenhum" && !(v.situacao === "sugerido" && v.origem === "descricao")) continue;
    const measurementId = unidadeDoCadastroPelaNota(cadastro.unidades, item.unidade);
    if (measurementId) out.set(item.nItem, { ...v, preenchimento: { ...v.preenchimento, measurement_id: measurementId } });
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

// ─────────────── a forma de pagamento ───────────────

/**
 * XML-04 (decisão 318) — a FORMA DE PAGAMENTO que a nota diz. Mais de um `<detPag>` (`varias`) e nenhum tPag
 * (`sem_tpag`) voltam como o domínio os lê, SEM consulta. Com UM tPag, UMA consulta sob a RLS da transação: a ligação
 * VIVA da organização para o código e a forma dela (da organização ou do sistema — a mesma regra do gatilho da 0064,
 * repetida no `join`). Nenhuma linha → `sem_ligacao`; uma, ativa → `ligada`; uma, inativa → `forma_inativa` (a tela diz
 * qual). Mais de uma (o índice único parcial não deixa) → `sem_ligacao`: fail-closed, nunca "a primeira".
 */
export async function formaDePagamentoDaNota(ctx: ServiceCtx, nota: Pick<NotaFiscalLida, "pagamentos">): Promise<FormaDePagamentoDaConferencia> {
  const daNota = formaDaNota(nota);
  if (daNota.situacao !== "uma") return daNota;
  const { tPag } = daNota;
  const r = await ctx.tx.query<{ id: string; nome: string; ativa: boolean }>(
    `select pm.id::text as id, pm.name as nome, pm.is_active as ativa
       from erp.formas_pagamento_da_nfe l
       join erp.payment_methods pm on pm.id = l.forma_pagamento_id and (pm.organization_id = l.organization_id or pm.organization_id is null)
      where l.organization_id = $1 and l.codigo_tpag = $2 and l.deleted_at is null`, [ctx.orgId, tPag]);
  const ligacao = r.rows.length === 1 ? r.rows[0]! : null;
  if (!ligacao) return { situacao: "sem_ligacao", tPag };
  const forma = { id: ligacao.id, nome: ligacao.nome };
  return ligacao.ativa ? { situacao: "ligada", tPag, forma } : { situacao: "forma_inativa", tPag, forma };
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

const NOME_DO_TIPO_DE_FATOR: Record<TipoFator, string> = { multiply: "multiplica", divide: "divide" };
/** O fator como número, sem as casas vazias do banco ("12.000000" → "12"). */
const numeroDoFator = (f: string) => D(f).toFixed();

/**
 * XML-04 (decisão 318) — a DIVERGÊNCIA do fator de um item com produto, ou nenhuma. NÃO bloqueia: a web anterior
 * bloquearia a nota inteira por um código que não conhece; a tela desta versão bloqueia pelo fator vazio. A PERGUNTA
 * (`fator_a_informar`) diz a unidade da nota, o produto e o motivo — no código de barras de outra unidade, a unidade de
 * que o código é e o fator dela no cadastro, quando é uma só (`codigoDeBarras`); o vínculo lembrado que o cadastro
 * contradiz (`fator_do_vinculo_diferente_do_cadastro`) diz os DOIS números, e que vale o do vínculo. Número na mão,
 * nunca "confira".
 */
export function divergenciaDoFator(nItem: number, v: VinculoDoItemDaNota): DivergenciaDaImportacaoNfe | null {
  if ((v.situacao !== "lembrado" && v.situacao !== "sugerido") || !v.fatorPelaNota) return null;
  const f = v.fatorPelaNota;
  const produto = v.produto.codigo;
  if (f.origem === "pergunta") {
    const doCodigo = f.codigoDeBarras;
    const mensagem = f.motivo === "codigo_de_barras_de_outra_unidade"
      ? doCodigo
        ? `Item ${nItem}: o código de barras da nota é da unidade ${doCodigo.unidade} do produto ${produto} `
          + `(fator ${numeroDoFator(doCodigo.fator)}, ${NOME_DO_TIPO_DE_FATOR[doCodigo.tipoFator]}), mas a nota diz ${f.unidadeDaNota}: informe o fator.`
        : `Item ${nItem}: o código de barras da nota é de outra unidade do produto ${produto}, e não da unidade ${f.unidadeDaNota} da nota: informe o fator.`
      : f.unidadeDaNota
        ? `Item ${nItem}: a unidade ${f.unidadeDaNota} da nota não é unidade de compra do produto ${produto} no cadastro: informe o fator.`
        : `Item ${nItem}: a nota não traz a unidade do item, e o cadastro do produto ${produto} não diz o fator: informe o fator.`;
    return div("fator_a_informar", mensagem, false, nItem);
  }
  if (f.origem === "vinculo" && f.cadastro) {
    return div("fator_do_vinculo_diferente_do_cadastro", `Item ${nItem}: o vínculo lembrado usa fator ${numeroDoFator(v.fator)} (${NOME_DO_TIPO_DE_FATOR[v.tipoFator]}); `
      + `o cadastro do produto ${produto}, para a unidade ${f.unidadeDaNota}, diz ${numeroDoFator(f.cadastro.fator)} (${NOME_DO_TIPO_DE_FATOR[f.cadastro.tipoFator]}). `
      + "Vale o do vínculo.", false, nItem);
  }
  return null;
}

/**
 * XML-04 (decisão 318) — a MENSAGEM das duplicatas que não conferem: os TRÊS números (Σ vDup; o líquido, dizendo se veio
 * da fatura (vLiq) ou do total da nota (vNF); o total da compra) e as DUAS comparações, cada uma com a diferença (com
 * sinal: soma − líquido, líquido − total) quando falhou ou "confere"; a última duplicata não positiva vem dita à parte.
 * Só EXPLICA o resultado de `parcelasDaNota`: o código, o `bloqueia` e a regra são os de antes. Sem os campos da XML-04
 * (o tipo os declara opcionais), a mensagem de antes — nunca um número inventado.
 */
export function mensagemDasParcelas(p: Extract<ParcelasDaNota, { situacao: "nao_conferem" }>): string {
  const { total, falhas, diferencaSomaLiquido, diferencaLiquidoTotal } = p;
  if (total === undefined || falhas === undefined || diferencaSomaLiquido === undefined || diferencaLiquidoTotal === undefined) {
    return `As duplicatas da nota (${p.soma}) não conferem com o líquido (${p.liquido}): use a condição de pagamento.`;
  }
  const comparacao = (falha: FalhaDasParcelasDaNota, diferenca: string) => (falhas.includes(falha) ? `diferença ${diferenca}` : "confere");
  const liquido = p.origemDoLiquido === "fatura" ? "líquido (fatura, vLiq)" : "líquido (total da nota, vNF)";
  const ultima = falhas.includes("ultima_parcela_nao_positiva")
    ? "; a última duplicata, ajustada para a soma fechar no total da compra, ficaria com valor zero ou negativo" : "";
  return `As duplicatas não conferem: Σ vDup ${p.soma} × ${liquido} ${p.liquido} — ${comparacao("soma_diferente_do_liquido", diferencaSomaLiquido)}; `
    + `líquido ${p.liquido} × total da compra ${total} — ${comparacao("liquido_diferente_do_total", diferencaLiquidoTotal)}${ultima}. `
    + "Use a condição de pagamento.";
}

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
    const doFator = divergenciaDoFator(item.nItem, vinculo);
    if (doFator) divergencias.push(doFator);
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
  // XML-04: a mensagem diz POR QUÊ (o código e o `bloqueia` são os de antes). `sem_duplicatas` continua SEM divergência,
  // como sempre — também quando a nota trouxe duplicatas sem vencimento: a compra usa a condição de pagamento, e o
  // motivo vai no próprio resultado (`financeiro.parcelas.motivo`), que a aba Financeiro explica.
  if (parcelas.situacao === "nao_conferem") divergencias.push(div("parcelas_nao_conferem", mensagemDasParcelas(parcelas), false));
  const forma = await formaDePagamentoDaNota(ctx, nota);

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
    financeiro: { parcelas: { ...parcelas, origem: "nota" }, forma },
    divergencias: pendente ? divergencias : [],
    duplicidade,
    capacidades: { criarProdutosDaNota: CAPACIDADE_CRIAR_PRODUTOS_DA_NOTA },
  };
}
