import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withTx } from "@agro/db";
import type { DivergenciaDaImportacaoNfe, FormaDePagamentoDaConferencia, VinculoDoItemDaNota } from "@agro/domain";
import { c, iniciar, encerrar, unico, j, erro } from "./top-config-08-ajuda.js";
import { notaSintetica, importada, fornecedorComDocumento, conferencia, gerar, type ItemSintetico, type OpcoesNotaSintetica } from "./f7-ajuda.js";
import { prepararXml01, conferenciaLida, vinculoDo, eanNovo, emitenteNovo, outraOrganizacao, comConsultas, tocamUnidades, unidadesQueCasam, x, type Conferencia } from "./xml-01-ajuda.js";

/**
 * XML-04 (decisão 318) — "o fator vem do cadastro, a forma vem da nota, e a duplicata diz por quê": a CONFERÊNCIA
 * (GET /api/compras/importacoes/:id, a instância de produção `c.ligada`, sob a RLS do papel da aplicação) e o "Gerar
 * compra". A testemunha é o banco (superusuário, sem RLS); o cenário é montado por INSERT do superusuário no banco de
 * TESTE do harness. Cada caso afirma a PREMISSA junto da conclusão.
 *
 *   XML4-C1  o vínculo LEMBRADO vence o cadastro: concordante (sem aviso), discordante no número e no tipo (os dois
 *            números no `fatorPelaNota.cadastro` e o aviso que não bloqueia), uCom fora do cadastro (nada a comparar);
 *   XML4-C2  o código no fornecedor: a unidade PRINCIPAL (1) e a unidade ALTERNATIVA de compra (o fator dela, multiplica
 *            e divide) — a quantidade interna é a do cadastro;
 *   XML4-C3  a REFERÊNCIA e a DESCRIÇÃO (antes, 1 de chute) agora pelo cadastro; a descrição guarda o pré-preenchimento;
 *   XML4-C4  as PERGUNTAS: uCom fora do cadastro do produto, uCom sem unidade de medida, a linha SÓ DE VENDA (R2), a linha
 *            EXCLUÍDA (R3) — cada uma com o aviso `fator_a_informar` (não bloqueia) e o fator 1 só por compatibilidade;
 *   XML4-C5  o código de barras de OUTRA unidade do produto (de uma ou de duas) NÃO muda o fator que o uCom dá: o código
 *            de barras só ACHA o produto (decisão do Maike: a regra 3.1 à letra — o fator sai só do uCom);
 *   XML4-C6  a unidade da ORGANIZAÇÃO vence a do SISTEMA (a linha ou a principal do produto na do sistema vira
 *            pergunta, com o motivo `unidade_homonima_da_organizacao` e a mensagem que diz o porquê verdadeiro); o produto
 *            que não usa a homônima (ou só numa linha de venda) pergunta pelo motivo geral; sem a da organização, a do
 *            sistema vale;
 *   XML4-C7  CONSULTAS CONTADAS: 1 item, 10 itens e 50 itens (todos os caminhos e a forma; os 50 com 25 produtos e 15
 *            uCom distintos) fazem o MESMO número de consultas, e a consulta ÚNICA do cadastro leva todos eles;
 *   XML4-C8  a FORMA: ligada (do sistema e da organização), sem ligação, forma inativa, várias, sem tPag; a ligação
 *            EXCLUÍDA não vale; a de OUTRA organização não vale (o filtro explícito e a RLS, cada um sozinho);
 *   XML4-C9  as PARCELAS: `nao_conferem` com o total, a origem do líquido, as falhas e as diferenças, e a mensagem com
 *            os três números (o código e o `bloqueia` de antes); `sem_duplicatas` com o motivo, sem divergência;
 *   XML4-C10 o "Gerar compra" aceita o fator DIGITADO num item que é pergunta e a forma da nota; a forma inativa é
 *            recusada como sempre; o GET não grava vínculo, o gerar grava o fator digitado, e a nota seguinte o lembra.
 *   XML4-C11 o CENÁRIO DA MEDIÇÃO (fase 0), com as unidades do seed: a principal dá 1, a alternativa dá o fator dela, os
 *            DOIS itens com uCom fora do cadastro (U1 BD, U2 FD) perguntam COM a unidade, e o vínculo lembrado leva o
 *            cadastro ao lado — o fator nunca cai no 1 em silêncio.
 */

beforeAll(async () => { await iniciar(); await prepararXml01(); }, 240_000);
afterAll(encerrar);

// ─────────────── o cadastro (superusuário) ───────────────

let seqSimbolo = 0;
/** Um símbolo de unidade NOVO (6 posições, o máximo do uCom normalizado): nenhuma unidade do seed o tem. */
const simboloNovo = (): string => `Q${(++seqSimbolo).toString(36).toUpperCase().padStart(5, "0")}`;

/** Uma unidade de medida da ORGANIZAÇÃO da demo (ou do SISTEMA, `organization_id` nulo) com o símbolo dado. */
async function unidade(simbolo: string, o: { sistema?: boolean } = {}): Promise<string> {
  const r = await c.admin.query<{ id: string; da_organizacao: boolean }>(
    "insert into erp.measurement_units (organization_id, symbol, name, decimals) values ($1, $2, $3, 4) returning id::text as id, organization_id is not null as da_organizacao",
    [o.sistema ? null : c.h.demo.orgId, simbolo, `Unidade XML-04 ${unico()}`]);
  expect(r.rows[0]!.da_organizacao, "premissa: a unidade nasceu onde foi pedida").toBe(!o.sistema);
  return r.rows[0]!.id;
}

interface Produto { id: string; codigo: string }
/** Um produto NOVO (no molde de um do seed), com a unidade PRINCIPAL dada e o resto como pedido. */
async function produtoNovo(principal: string, o: { descricao?: string; reference?: string; barcode?: string } = {}): Promise<Produto> {
  const m = (await c.admin.query<Record<string, string>>("select group_id, category_id, kind_id, financial_category_id from erp.products where id=$1", [c.I.product2])).rows[0]!;
  const r = await c.admin.query<{ id: string; code: string; measurement_id: string }>(
    `insert into erp.products (organization_id, code, description, measurement_id, group_id, category_id, kind_id, financial_category_id,
                               control_stock, controle_lote, has_lot, is_active, reference, barcode)
     values ($1, $2, $3, $4, $5, $6, $7, $8, true, 'nenhum', false, true, $9, $10) returning id::text as id, code, measurement_id::text`,
    [c.h.demo.orgId, `X4${unico()}`, o.descricao ?? `CADASTRO XML04 ${unico()} ${unico()} ${unico()}`, principal, m.group_id, m.category_id, m.kind_id,
      m.financial_category_id, o.reference ?? null, o.barcode ?? null]);
  expect(r.rows[0]!.measurement_id, "premissa: a unidade principal é a pedida").toBe(principal);
  return { id: r.rows[0]!.id, codigo: r.rows[0]!.code };
}

/** Uma linha de `erp.produto_unidades` (a unidade alternativa do produto): de compra por padrão; viva por padrão. */
async function unidadeDoProduto(produtoId: string, measurementId: string, fator: string,
  o: { tipo?: "multiply" | "divide"; compra?: boolean; barcode?: string; excluida?: boolean } = {}): Promise<void> {
  const compra = o.compra ?? true;
  const r = await c.admin.query<{ uso_compra: boolean; excluida: boolean }>(
    `insert into erp.produto_unidades (organization_id, product_id, measurement_id, tipo_fator, fator, codigo_barras, uso_compra, uso_venda, deleted_at)
     values ($1, $2, $3, $4, $5::numeric, $6, $7, $8, case when $9 then now() end) returning uso_compra, deleted_at is not null as excluida`,
    [c.h.demo.orgId, produtoId, measurementId, o.tipo ?? "multiply", fator, o.barcode ?? null, compra, !compra, o.excluida ?? false]);
  expect([r.rows[0]!.uso_compra, r.rows[0]!.excluida], "premissa: a linha nasceu como pedida").toEqual([compra, o.excluida ?? false]);
}

/** O código do produto NO FORNECEDOR (`produto_fornecedores`, o cadastro do produto). */
async function codigoNoFornecedor(produtoId: string, fornecedorId: string, codigo: string): Promise<void> {
  await c.admin.query("insert into erp.produto_fornecedores (organization_id, product_id, person_id, codigo_no_fornecedor) values ($1, $2, $3, $4)",
    [c.h.demo.orgId, produtoId, fornecedorId, codigo]);
}

/** O vínculo LEMBRADO (fornecedor + código + unidade → produto e fator), gravado como o "Gerar compra" grava. */
async function lembrar(fornecedorId: string, codigo: string, unidadeDaNota: string, produtoId: string, fator: string, tipo: "multiply" | "divide" = "multiply"): Promise<void> {
  await c.admin.query(
    `insert into erp.produto_fornecedor_vinculos (organization_id, fornecedor_id, codigo_fornecedor, unidade_fornecedor, produto_id, tipo_fator, fator, criado_por)
     values ($1, $2, $3, $4, $5, $6, $7::numeric, $8)`, [c.h.demo.orgId, fornecedorId, codigo, unidadeDaNota, produtoId, tipo, fator, x.adminId]);
}

/** Quantos vínculos lembrados a organização tem (o GET da conferência nunca grava um). */
const vinculosLembrados = async (): Promise<number> =>
  Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.produto_fornecedor_vinculos where organization_id=$1", [c.h.demo.orgId])).rows[0]!.n);

/** Uma forma de pagamento da ORGANIZAÇÃO (ativa ou não). */
async function formaDaOrganizacao(o: { orgId?: string; ativa?: boolean } = {}): Promise<{ id: string; nome: string }> {
  const nome = `Forma XML-04 ${unico()}`;
  const r = await c.admin.query<{ id: string; is_active: boolean }>(
    "insert into erp.payment_methods (organization_id, name, is_active) values ($1, $2, $3) returning id::text as id, is_active", [o.orgId ?? c.h.demo.orgId, nome, o.ativa ?? true]);
  expect(r.rows[0]!.is_active, "premissa: a forma nasceu ativa ou não, como pedido").toBe(o.ativa ?? true);
  return { id: r.rows[0]!.id, nome };
}

/** A LIGAÇÃO do código tPag a uma forma (`erp.formas_pagamento_da_nfe`), viva ou excluída, na organização dada. */
async function ligar(codigo: string, formaId: string, o: { orgId?: string; excluida?: boolean } = {}): Promise<string> {
  const r = await c.admin.query<{ id: string }>(
    `insert into erp.formas_pagamento_da_nfe (organization_id, codigo_tpag, forma_pagamento_id, deleted_at)
     values ($1, $2, $3, case when $4 then now() end) returning id::text as id`, [o.orgId ?? c.h.demo.orgId, codigo, formaId, o.excluida ?? false]);
  return r.rows[0]!.id;
}

// ─────────────── a nota ───────────────

/** Um item da nota: 2 na unidade dada, 10,00 cada (vProd 20,00), sem GTIN; a descrição é única (nenhuma semelhança por acaso). */
const item = (codigo: string, unidadeDaNota: string, extra: Partial<ItemSintetico> = {}): ItemSintetico => ({
  codigo, descricao: `ITEM XML04 ${unico()} ${unico()} ${unico()} ${unico()}`, unidade: unidadeDaNota, quantidade: "2.0000", valorUnitario: "10.0000000000",
  valorProdutos: "20.00", ean: "SEM GTIN", ...extra,
});

interface OpcoesDaNota extends OpcoesNotaSintetica {
  /** Os `<detPag>` (o grupo `<pag>`), na ordem; ausente = sem `<pag>`. */
  pagamentos?: { tPag?: string; vPag?: string }[];
  /** Tira o `dVenc` de TODAS as duplicatas (o leitor as descarta). */
  semVencimento?: boolean;
}
interface NotaDoCaso { id: string; fornecedor: string; emitente: string }
/**
 * Uma nota NOVA (emitente novo, com cadastro de fornecedor) importada na 1ª empresa do seed. O grupo `<pag>` e a
 * duplicata sem vencimento são acrescentados AQUI no XML sintético (o `notaSintetica` não os escreve); premissa: o XML
 * guardado traz o que o caso pediu.
 */
async function notaImportada(itens: ItemSintetico[], o: OpcoesDaNota = {}): Promise<NotaDoCaso> {
  const { pagamentos, semVencimento, ...opcoes } = o;
  const emitente = emitenteNovo();
  const fornecedor = await fornecedorComDocumento(emitente);
  let xml = notaSintetica({ ...opcoes, emitenteCnpj: emitente, itens }).xml;
  if (pagamentos) {
    const tag = (nome: string, v: string | undefined) => (v === undefined ? "" : `<${nome}>${v}</${nome}>`);
    xml = xml.replace("</infNFe>", `<pag>${pagamentos.map((p) => `<detPag>${tag("tPag", p.tPag)}${tag("vPag", p.vPag)}</detPag>`).join("")}</pag></infNFe>`);
    expect((xml.match(/<detPag>/g) ?? []).length, "premissa: o XML traz os <detPag> pedidos").toBe(pagamentos.length);
  }
  if (semVencimento) {
    xml = xml.replace(/<dVenc>[^<]*<\/dVenc>/g, "");
    expect(xml.includes("<dup>") && !xml.includes("<dVenc>"), "premissa: as duplicatas estão no XML, sem vencimento").toBe(true);
  }
  const imp = await importada(xml, { empresaId: c.I.empresa });
  return { id: imp.id, fornecedor, emitente };
}

// ─────────────── leituras da conferência ───────────────

type VinculoComProduto = Extract<VinculoDoItemDaNota, { situacao: "lembrado" | "sugerido" }>;
/** O vínculo do item com produto (premissa: lembrado ou sugerido). */
function comProduto(conf: Conferencia, nItem: number): VinculoComProduto {
  const v = vinculoDo(conf, nItem);
  expect(["lembrado", "sugerido"], `premissa: o item ${nItem} tem produto — ${JSON.stringify(v)}`).toContain(v.situacao);
  return v as VinculoComProduto;
}
/** O fator do item reduzido ao que a regra decide: caminho, produto, fator, tipo, de onde veio, e a quantidade interna. */
function fatorDo(conf: Conferencia, nItem: number) {
  const v = comProduto(conf, nItem);
  return {
    caminho: v.situacao === "lembrado" ? "lembrado" : v.origem, produto: v.produto.id, fator: v.fator, tipoFator: v.tipoFator, fatorPelaNota: v.fatorPelaNota,
    quantidadeInterna: conf.itens.find((i) => i.nItem === nItem)!.quantidadeInterna,
  };
}
/** As divergências do FATOR de um item (as duas da XML-04). */
const doFator = (conf: Conferencia, nItem: number): DivergenciaDaImportacaoNfe[] =>
  conf.divergencias.filter((d) => d.nItem === nItem && d.codigo.startsWith("fator_"));
const perguntaFora = (nItem: number, unidadeDaNota: string, p: Produto): DivergenciaDaImportacaoNfe =>
  ({ codigo: "fator_a_informar", nItem, bloqueia: false, mensagem: `Item ${nItem}: a unidade ${unidadeDaNota} da nota não é unidade de compra do produto ${p.codigo} no cadastro: informe o fator.` });
/** A pergunta da unidade HOMÔNIMA: a unidade da nota é a da organização, e o produto está na do sistema (o porquê verdadeiro). */
const perguntaHomonima = (nItem: number, unidadeDaNota: string, p: Produto): DivergenciaDaImportacaoNfe =>
  ({ codigo: "fator_a_informar", nItem, bloqueia: false,
    mensagem: `Item ${nItem}: a unidade ${unidadeDaNota} da nota é a da organização, e o produto ${p.codigo} está cadastrado na ${unidadeDaNota} do sistema: informe o fator.` });

// ═════════════════════════════════════ XML4-C1 o vínculo lembrado ═════════════════════════════════════

describe("XML4-C1 o vínculo LEMBRADO vence o cadastro e diz quando o cadastro discorda", () => {
  it("concordante: sem aviso; discordante no número e no tipo: os dois números e o aviso (não bloqueia); uCom fora do cadastro: nada a comparar", async () => {
    const u = unico();
    const [principal, caixa, fora] = [simboloNovo(), simboloNovo(), simboloNovo()];
    const [uPrincipal, uCaixa] = [await unidade(principal), await unidade(caixa)];
    await unidade(fora);
    const p = await produtoNovo(uPrincipal);
    await unidadeDoProduto(p.id, uCaixa, "12");
    const n = await notaImportada([item(`L1-${u}`, caixa), item(`L2-${u}`, caixa), item(`L3-${u}`, caixa), item(`L4-${u}`, fora)]);
    await lembrar(n.fornecedor, `L1-${u}`, caixa, p.id, "12");
    await lembrar(n.fornecedor, `L2-${u}`, caixa, p.id, "1");
    await lembrar(n.fornecedor, `L3-${u}`, caixa, p.id, "12", "divide");
    await lembrar(n.fornecedor, `L4-${u}`, fora, p.id, "3");
    const conf = await conferenciaLida(n.id);
    expect(conf.fornecedorEscolhido, "premissa: o fornecedor dos vínculos é o escolhido").toBe(n.fornecedor);
    const cadastro = { fator: "12.000000", tipoFator: "multiply" };
    expect([1, 2, 3, 4].map((k) => fatorDo(conf, k))).toEqual([
      { caminho: "lembrado", produto: p.id, fator: "12.000000", tipoFator: "multiply", fatorPelaNota: { origem: "vinculo", unidadeDaNota: caixa, cadastro: null }, quantidadeInterna: "24.0000" },
      { caminho: "lembrado", produto: p.id, fator: "1.000000", tipoFator: "multiply", fatorPelaNota: { origem: "vinculo", unidadeDaNota: caixa, cadastro }, quantidadeInterna: "2.0000" },
      { caminho: "lembrado", produto: p.id, fator: "12.000000", tipoFator: "divide", fatorPelaNota: { origem: "vinculo", unidadeDaNota: caixa, cadastro }, quantidadeInterna: "0.1667" },
      { caminho: "lembrado", produto: p.id, fator: "3.000000", tipoFator: "multiply", fatorPelaNota: { origem: "vinculo", unidadeDaNota: fora, cadastro: null }, quantidadeInterna: "6.0000" },
    ]);
    expect([1, 2, 3, 4].map((k) => doFator(conf, k))).toEqual([
      [],
      [{ codigo: "fator_do_vinculo_diferente_do_cadastro", nItem: 2, bloqueia: false,
        mensagem: `Item 2: o vínculo lembrado usa fator 1 (multiplica); o cadastro do produto ${p.codigo}, para a unidade ${caixa}, diz 12 (multiplica). Vale o do vínculo.` }],
      [{ codigo: "fator_do_vinculo_diferente_do_cadastro", nItem: 3, bloqueia: false,
        mensagem: `Item 3: o vínculo lembrado usa fator 12 (divide); o cadastro do produto ${p.codigo}, para a unidade ${caixa}, diz 12 (multiplica). Vale o do vínculo.` }],
      [],
    ]);
  });
});

// ═════════════════════════════════════ XML4-C2 o código no fornecedor ═════════════════════════════════════

describe("XML4-C2 o código no fornecedor: o fator é o do cadastro pelo uCom", () => {
  it("a unidade PRINCIPAL dá 1; a ALTERNATIVA de compra dá o fator dela (multiplica e divide); nenhum aviso", async () => {
    const u = unico();
    const [principal, caixa, fardo] = [simboloNovo(), simboloNovo(), simboloNovo()];
    const [uPrincipal, uCaixa, uFardo] = [await unidade(principal), await unidade(caixa), await unidade(fardo)];
    const p = await produtoNovo(uPrincipal);
    await unidadeDoProduto(p.id, uCaixa, "12");
    await unidadeDoProduto(p.id, uFardo, "4", { tipo: "divide" });
    const n = await notaImportada([item(`CF-${u}`, principal), item(`CF-${u}`, caixa), item(`CF-${u}`, fardo)]);
    await codigoNoFornecedor(p.id, n.fornecedor, `CF-${u}`);
    const conf = await conferenciaLida(n.id);
    expect([1, 2, 3].map((k) => fatorDo(conf, k))).toEqual([
      { caminho: "codigo_fornecedor", produto: p.id, fator: "1", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_principal", unidadeDaNota: principal }, quantidadeInterna: "2.0000" },
      { caminho: "codigo_fornecedor", produto: p.id, fator: "12.000000", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: caixa }, quantidadeInterna: "24.0000" },
      { caminho: "codigo_fornecedor", produto: p.id, fator: "4.000000", tipoFator: "divide", fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: fardo }, quantidadeInterna: "0.5000" },
    ]);
    expect([1, 2, 3].flatMap((k) => doFator(conf, k)), "nada a perguntar").toEqual([]);
    expect(conf.itens.map((i) => i.valorUnitarioInterno), "o unitário interno é o da quantidade do cadastro").toEqual(["10.000000", "0.833333", "40.000000"]);
  });
});

// ═════════════════════════════════════ XML4-C3 a referência e a descrição ═════════════════════════════════════

describe("XML4-C3 a REFERÊNCIA e a DESCRIÇÃO: o fator agora é o do cadastro (antes, 1 de chute)", () => {
  it("a referência com a unidade alternativa dá o fator dela; a descrição também — e guarda o pré-preenchimento com a unidade", async () => {
    const u = unico().toUpperCase();
    const [principal, saco, balde] = [simboloNovo(), simboloNovo(), simboloNovo()];
    const [uPrincipal, uSaco, uBalde] = [await unidade(principal), await unidade(saco), await unidade(balde)];
    const pr = await produtoNovo(uPrincipal, { reference: `RF-${u}` });
    await unidadeDoProduto(pr.id, uSaco, "6");
    const [t1, t2, t3] = [unico(), unico(), unico()];
    const pd = await produtoNovo(uPrincipal, { descricao: `${t1} ${t2} ${t3}` });
    await unidadeDoProduto(pd.id, uBalde, "10");
    const pdPrincipal = await produtoNovo(uPrincipal, { descricao: `${unico()} ${unico()} ${unico()}` });
    const descricaoPrincipal = (await c.admin.query<{ d: string }>("select description d from erp.products where id=$1", [pdPrincipal.id])).rows[0]!.d;
    const n = await notaImportada([
      item(`RF-${u}`, saco),
      item(`DS-${u}`, balde, { descricao: `${t1} ${t2} ${t3} XMLQUATRO` }),
      item(`DP-${u}`, principal, { descricao: `${descricaoPrincipal} XMLQUATRO` }),
    ]);
    const conf = await conferenciaLida(n.id);
    expect([1, 2, 3].map((k) => fatorDo(conf, k))).toEqual([
      { caminho: "reference", produto: pr.id, fator: "6.000000", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: saco }, quantidadeInterna: "12.0000" },
      { caminho: "descricao", produto: pd.id, fator: "10.000000", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: balde }, quantidadeInterna: "20.0000" },
      { caminho: "descricao", produto: pdPrincipal.id, fator: "1", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_principal", unidadeDaNota: principal }, quantidadeInterna: "2.0000" },
    ]);
    const v2 = vinculoDo(conf, 2) as Extract<VinculoDoItemDaNota, { origem: "descricao" }>;
    expect(v2.preenchimento, "a descrição continua oferecendo criar o produto, com a unidade do uCom").toEqual({
      description: `${t1} ${t2} ${t3} XMLQUATRO`, ncm_code: null, barcode: null, measurement_id: uBalde,
    });
    expect([1, 2, 3].flatMap((k) => doFator(conf, k))).toEqual([]);
  });
});

// ═════════════════════════════════════ XML4-C4 as perguntas ═════════════════════════════════════

describe("XML4-C4 nada respalda o fator: PERGUNTA (nunca 1 em silêncio)", () => {
  it("uCom fora do cadastro do produto, uCom sem unidade de medida, linha só de VENDA (R2) e linha EXCLUÍDA (R3) → pergunta e aviso; a linha de compra viva confirma", async () => {
    const u = unico();
    const [principal, caixa, outra, semUnidade, deVenda, excluida] = [simboloNovo(), simboloNovo(), simboloNovo(), simboloNovo(), simboloNovo(), simboloNovo()];
    const uPrincipal = await unidade(principal);
    const [uCaixa, uDeVenda, uExcluida] = [await unidade(caixa), await unidade(deVenda), await unidade(excluida)];
    await unidade(outra);
    const p = await produtoNovo(uPrincipal);
    await unidadeDoProduto(p.id, uCaixa, "12");
    await unidadeDoProduto(p.id, uDeVenda, "5", { compra: false });
    await unidadeDoProduto(p.id, uExcluida, "8", { excluida: true });
    expect((await c.admin.query("select 1 from erp.measurement_units where upper(btrim(symbol)) = $1", [semUnidade])).rowCount, "premissa: o uCom do item 2 não é unidade nenhuma").toBe(0);
    const n = await notaImportada([item(`PG-${u}`, outra), item(`PG-${u}`, semUnidade), item(`PG-${u}`, deVenda), item(`PG-${u}`, excluida), item(`PG-${u}`, caixa)]);
    await codigoNoFornecedor(p.id, n.fornecedor, `PG-${u}`);
    const conf = await conferenciaLida(n.id);
    const pergunta = (unidadeDaNota: string) => ({ caminho: "codigo_fornecedor", produto: p.id, fator: "1", tipoFator: "multiply",
      fatorPelaNota: { origem: "pergunta", unidadeDaNota, motivo: "unidade_fora_do_cadastro" }, quantidadeInterna: "2.0000" });
    expect([1, 2, 3, 4, 5].map((k) => fatorDo(conf, k))).toEqual([
      pergunta(outra), pergunta(semUnidade), pergunta(deVenda), pergunta(excluida),
      { caminho: "codigo_fornecedor", produto: p.id, fator: "12.000000", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: caixa }, quantidadeInterna: "24.0000" },
    ]);
    expect([1, 2, 3, 4, 5].map((k) => doFator(conf, k))).toEqual([
      [perguntaFora(1, outra, p)], [perguntaFora(2, semUnidade, p)], [perguntaFora(3, deVenda, p)], [perguntaFora(4, excluida, p)], [],
    ]);
    expect(conf.divergencias.filter((d) => d.bloqueia).map((d) => d.codigo), "a pergunta não bloqueia no servidor (a tela bloqueia pelo fator vazio)").toEqual([]);
  });
});

// ═════════════════════════════════════ XML4-C5 o código de barras ═════════════════════════════════════

/**
 * XML4-C5 provava, até a decisão do Maike ("seguir a 3.1 à letra"), que o código de barras de OUTRA unidade punha o fator
 * em dúvida. Agora prova o CONTRÁRIO: o fator sai SÓ do uCom pelo cadastro, em todos os caminhos, e o código de barras só
 * ACHA o produto (a identidade do 3º caminho, que não muda) — nunca dá fator nem o põe em dúvida. O cenário é o MESMO.
 */
describe("XML4-C5 o código de barras de OUTRA unidade do produto NÃO muda o fator que o uCom dá (decisão do Maike: a 3.1 à letra)", () => {
  it("cEAN da caixa com uCom da principal → 1; cEAN da principal com uCom da caixa → 12; cada um com a própria unidade → o mesmo; cEAN de DUAS unidades com uCom do fardo → 4 — e nada a perguntar", async () => {
    const [principal, caixa, fardo] = [simboloNovo(), simboloNovo(), simboloNovo()];
    const [uPrincipal, uCaixa, uFardo] = [await unidade(principal), await unidade(caixa), await unidade(fardo)];
    const [eanPrincipal, eanCaixa, eanDeDuas] = [eanNovo(), eanNovo(), eanNovo()];
    const p = await produtoNovo(uPrincipal, { barcode: eanPrincipal });
    await unidadeDoProduto(p.id, uCaixa, "12", { barcode: eanCaixa });
    // O código de DUAS unidades do mesmo produto: o do produto (a principal) e o da caixa; a nota diz o fardo (de compra, 4).
    const p2 = await produtoNovo(uPrincipal, { barcode: eanDeDuas });
    await unidadeDoProduto(p2.id, uCaixa, "12", { barcode: eanDeDuas });
    await unidadeDoProduto(p2.id, uFardo, "4");
    const doisDonos = await c.admin.query<{ n: string }>(
      `select ((select count(*) from erp.products where id = $1 and barcode = $2) + (select count(*) from erp.produto_unidades where product_id = $1 and codigo_barras = $2 and deleted_at is null))::text n`,
      [p2.id, eanDeDuas]);
    expect(doisDonos.rows[0]!.n, "premissa: o código do item 5 é de DUAS unidades do produto (a principal e a caixa)").toBe("2");
    const n = await notaImportada([
      item(`EA1-${unico()}`, principal, { ean: eanCaixa }), item(`EA2-${unico()}`, caixa, { ean: eanCaixa }),
      item(`EA3-${unico()}`, caixa, { ean: eanPrincipal }), item(`EA4-${unico()}`, principal, { ean: eanPrincipal }),
      item(`EA5-${unico()}`, fardo, { ean: eanDeDuas }),
    ]);
    const conf = await conferenciaLida(n.id);
    const peloUCom = (produto: Produto, unidadeDaNota: string, fator: string, origem: "unidade_principal" | "unidade_do_produto", quantidadeInterna: string) =>
      ({ caminho: "codigo_barras", produto: produto.id, fator, tipoFator: "multiply", fatorPelaNota: { origem, unidadeDaNota }, quantidadeInterna });
    expect([1, 2, 3, 4, 5].map((k) => fatorDo(conf, k)), "o código de barras ACHOU cada produto; o fator é o do uCom, com ou sem o cEAN de outra unidade").toEqual([
      peloUCom(p, principal, "1", "unidade_principal", "2.0000"),
      peloUCom(p, caixa, "12.000000", "unidade_do_produto", "24.0000"),
      peloUCom(p, caixa, "12.000000", "unidade_do_produto", "24.0000"),
      peloUCom(p, principal, "1", "unidade_principal", "2.0000"),
      peloUCom(p2, fardo, "4.000000", "unidade_do_produto", "8.0000"),
    ]);
    // O mesmo uCom dá o MESMO fator com o cEAN de OUTRA unidade (1, 3) e com o da própria (4, 2): o cEAN não entra.
    const fatorEOrigem = (k: number) => { const f = fatorDo(conf, k); return [f.fator, f.tipoFator, f.fatorPelaNota]; };
    expect([1, 3].map(fatorEOrigem), "com o cEAN de outra unidade = com o da própria").toEqual([4, 2].map(fatorEOrigem));
    expect([1, 2, 3, 4, 5].map((k) => doFator(conf, k)), "nada a perguntar: o cadastro respalda o uCom").toEqual([[], [], [], [], []]);
  });
});

// ═════════════════════════════════════ XML4-C6 organização × sistema ═════════════════════════════════════

describe("XML4-C6 a unidade da ORGANIZAÇÃO vence a do SISTEMA, e a pergunta diz o porquê verdadeiro", () => {
  it("o mesmo símbolo nas duas: a linha do produto na da organização vale; na do sistema (linha de compra ou principal) é pergunta HOMÔNIMA; o produto sem a homônima (ou só com uma linha de venda nela) pergunta pelo motivo geral; só no sistema, a do sistema vale", async () => {
    const u = unico();
    const [ambos, soSistema, principal] = [simboloNovo(), simboloNovo(), simboloNovo()];
    const uPrincipal = await unidade(principal);
    const daOrganizacao = await unidade(ambos);
    const doSistema = await unidade(ambos, { sistema: true });
    const soDoSistema = await unidade(soSistema, { sistema: true });
    expect(await unidadesQueCasam(ambos), "premissa: o símbolo casa com UMA da organização e UMA do sistema").toEqual({ organizacao: [daOrganizacao], sistema: [doSistema] });
    const pOrg = await produtoNovo(uPrincipal);
    await unidadeDoProduto(pOrg.id, daOrganizacao, "5");
    const pSis = await produtoNovo(uPrincipal);
    await unidadeDoProduto(pSis.id, doSistema, "7");
    const pPrincipalSis = await produtoNovo(doSistema);
    const pSoSistema = await produtoNovo(uPrincipal);
    await unidadeDoProduto(pSoSistema.id, soDoSistema, "3");
    const pSemHomonima = await produtoNovo(uPrincipal);
    const pVendaSis = await produtoNovo(uPrincipal);
    await unidadeDoProduto(pVendaSis.id, doSistema, "7", { compra: false });
    const produtos = [pOrg, pSis, pPrincipalSis, pSoSistema, pSemHomonima, pVendaSis];
    const n = await notaImportada([item(`OS1-${u}`, ambos), item(`OS2-${u}`, ambos), item(`OS3-${u}`, ambos), item(`OS4-${u}`, soSistema),
      item(`OS5-${u}`, ambos), item(`OS6-${u}`, ambos)]);
    for (const [k, p] of produtos.entries()) await codigoNoFornecedor(p.id, n.fornecedor, `OS${k + 1}-${u}`);
    const conf = await conferenciaLida(n.id);
    const pergunta = (p: Produto, motivo: "unidade_homonima_da_organizacao" | "unidade_fora_do_cadastro") => ({ caminho: "codigo_fornecedor", produto: p.id, fator: "1",
      tipoFator: "multiply", fatorPelaNota: { origem: "pergunta", unidadeDaNota: ambos, motivo }, quantidadeInterna: "2.0000" });
    expect([1, 2, 3, 4, 5, 6].map((k) => fatorDo(conf, k))).toEqual([
      { caminho: "codigo_fornecedor", produto: pOrg.id, fator: "5.000000", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: ambos }, quantidadeInterna: "10.0000" },
      pergunta(pSis, "unidade_homonima_da_organizacao"), pergunta(pPrincipalSis, "unidade_homonima_da_organizacao"),
      { caminho: "codigo_fornecedor", produto: pSoSistema.id, fator: "3.000000", tipoFator: "multiply", fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: soSistema }, quantidadeInterna: "6.0000" },
      pergunta(pSemHomonima, "unidade_fora_do_cadastro"), pergunta(pVendaSis, "unidade_fora_do_cadastro"),
    ]);
    expect([1, 2, 3, 4, 5, 6].map((k) => doFator(conf, k)), "a homônima diz que a unidade da nota é a da organização e o produto está na do sistema; as outras, o motivo geral").toEqual([
      [], [perguntaHomonima(2, ambos, pSis)], [perguntaHomonima(3, ambos, pPrincipalSis)], [], [perguntaFora(5, ambos, pSemHomonima)], [perguntaFora(6, ambos, pVendaSis)],
    ]);
  });
});

// ═════════════════════════════════════ XML4-C7 consultas contadas ═════════════════════════════════════

/** As consultas da FORMA (a ligação da organização). */
const daForma = (sqls: string[]): string[] => sqls.filter((s) => /\bfrom\s+erp\.formas_pagamento_da_nfe\b/.test(s));

/**
 * UM BLOCO dos 10 caminhos da contagem, com unidades, produtos e códigos PRÓPRIOS (nada repetido entre blocos: cada
 * bloco a mais é produto, unidade e código a mais na nota): lembrado, código no fornecedor (unidade alternativa,
 * principal e fora do cadastro), código de barras, referência, descrição (pergunta) e três `nenhum`. `registrar` grava,
 * DEPOIS da importação (o fornecedor nasce com a nota), o vínculo lembrado e o código no fornecedor do bloco.
 */
async function blocoDaContagem() {
  const u = unico().toUpperCase();
  const [principal, caixa, fora] = [simboloNovo(), simboloNovo(), simboloNovo()];
  const [uPrincipal, uCaixa] = [await unidade(principal), await unidade(caixa)];
  await unidade(fora);
  const ean = eanNovo();
  const [t1, t2, t3] = [unico(), unico(), unico()];
  const pLembrado = await produtoNovo(uPrincipal);
  const pCodigo = await produtoNovo(uPrincipal);
  await unidadeDoProduto(pCodigo.id, uCaixa, "12");
  const pBarras = await produtoNovo(uPrincipal, { barcode: ean });
  const pReferencia = await produtoNovo(uPrincipal, { reference: `CT-R-${u}` });
  const pDescricao = await produtoNovo(uPrincipal, { descricao: `${t1} ${t2} ${t3}` });
  const itens = [
    item(`CT-L-${u}`, principal), item(`CT-C-${u}`, caixa), item(`CT-C-${u}`, principal), item(`CT-B-${u}`, principal, { ean }),
    item(`CT-R-${u}`, principal), item(`CT-D-${u}`, caixa, { descricao: `${t1} ${t2} ${t3} CONTADO` }), item(`CT-C-${u}`, fora),
    item(`CT-N1-${u}`, principal, { ean: eanNovo() }), item(`CT-N2-${u}`, fora), item(`CT-N3-${u}`, caixa),
  ];
  const registrar = async (fornecedor: string): Promise<void> => {
    await lembrar(fornecedor, `CT-L-${u}`, principal, pLembrado.id, "1");
    await codigoNoFornecedor(pCodigo.id, fornecedor, `CT-C-${u}`);
  };
  return {
    u, principal, itens, registrar, pBarras, pReferencia, pDescricao,
    /** Os símbolos (uCom) e os produtos que o bloco põe na consulta do cadastro. */
    simbolos: [principal, caixa, fora], produtos: [pLembrado, pCodigo, pBarras, pReferencia, pDescricao].map((p) => p.id),
  };
}
/** O caminho de cada item da conferência (o lembrado, a origem do sugerido, ou a situação). */
const caminhosDa = (conf: Conferencia): string[] => conf.itens.map((i) => (i.vinculo.situacao === "sugerido" ? i.vinculo.origem : i.vinculo.situacao));
/** De onde veio o fator de cada item com produto. */
const origensDoFator = (conf: Conferencia) => conf.itens.filter((i) => i.vinculo.situacao === "sugerido" || i.vinculo.situacao === "lembrado")
  .map((i) => (i.vinculo as VinculoComProduto).fatorPelaNota?.origem);
/** A consulta do cadastro (premissa: exatamente uma) e o que ela pergunta: os uCom e os produtos, em ordem. */
function consultaDoCadastro(medida: { sqls: string[]; params: unknown[][] }): { simbolos: string[]; produtos: string[] } {
  const k = medida.sqls.findIndex((sql) => tocamUnidades([sql]).length > 0);
  expect(k, "premissa: a consulta do cadastro foi feita").toBeGreaterThanOrEqual(0);
  const p = medida.params[k]!;
  return { simbolos: [...(p[1] as string[])].sort(), produtos: [...(p[2] as string[])].sort() };
}

describe("XML4-C7 CONSULTAS CONTADAS: nada por item", () => {
  it("1, 10 e 50 itens (lembrado, código no fornecedor, código de barras, referência, descrição, pergunta, nenhum; com a forma da nota) → o MESMO número de consultas", async () => {
    const forma = await formaDaOrganizacao();
    await ligar("13", forma.id);
    const pagamentos = [{ tPag: "13", vPag: "20.00" }];
    const bloco = await blocoDaContagem();
    const { u, principal, pBarras, pReferencia, pDescricao } = bloco;
    const dez = await notaImportada(bloco.itens, { pagamentos: [{ tPag: "13", vPag: "200.00" }] });
    await bloco.registrar(dez.fornecedor);
    const um = await notaImportada([item(`CT-UM-${u}`, principal, { ean: eanNovo() })], { pagamentos });
    // 50 itens: CINCO blocos dos 10 caminhos, cada um com os PRÓPRIOS produtos, unidades e códigos (25 produtos achados e
    // 15 uCom distintos na MESMA consulta do cadastro).
    const blocos: Awaited<ReturnType<typeof blocoDaContagem>>[] = [];
    for (let k = 0; k < 5; k++) blocos.push(await blocoDaContagem());
    const cinquenta = await notaImportada(blocos.flatMap((b) => b.itens), { pagamentos: [{ tPag: "13", vPag: "1000.00" }] });
    for (const b of blocos) await b.registrar(cinquenta.fornecedor);
    await conferenciaLida(dez.id); await conferenciaLida(um.id); await conferenciaLida(cinquenta.id); // aquece a rota (o cache da autenticação)

    const d = await comConsultas(() => conferenciaLida(dez.id));
    const s = await comConsultas(() => conferenciaLida(um.id));
    const q = await comConsultas(() => conferenciaLida(cinquenta.id));
    const caminhos = caminhosDa(d.r);
    expect(caminhos, "premissa: os 10 itens passam por todos os caminhos").toEqual([
      "lembrado", "codigo_fornecedor", "codigo_fornecedor", "codigo_barras", "reference", "descricao", "codigo_fornecedor", "nenhum", "nenhum", "nenhum"]);
    expect(origensDoFator(d.r), "premissa: o fator de cada caminho saiu do cadastro")
      .toEqual(["vinculo", "unidade_do_produto", "unidade_principal", "unidade_principal", "unidade_principal", "pergunta", "pergunta"]);
    expect([pBarras.id, pReferencia.id, pDescricao.id], "premissa: os produtos dos caminhos 3 a 5").toEqual(
      [4, 5, 6].map((k) => (vinculoDo(d.r, k) as VinculoComProduto).produto.id));
    expect([vinculoDo(s.r, 1).situacao, s.r.financeiro.forma, d.r.financeiro.forma], "premissa: o item único chega ao fim dos caminhos; as duas com a forma ligada")
      .toEqual(["nenhum", { situacao: "ligada", tPag: "13", forma }, { situacao: "ligada", tPag: "13", forma }]);
    expect([tocamUnidades(d.sqls).length, tocamUnidades(s.sqls).length], "UMA consulta do cadastro (unidades, produtos e linhas), 10 itens e 1").toEqual([1, 1]);
    expect([daForma(d.sqls).length, daForma(s.sqls).length], "UMA consulta da forma, 10 itens e 1").toEqual([1, 1]);
    expect(d.sqls.length, `o MESMO número de consultas, 10 itens e 1 (10: ${d.sqls.length}; 1: ${s.sqls.length})`).toBe(s.sqls.length);

    // 50 itens: os MESMOS caminhos e as MESMAS origens do fator, cinco vezes — e a MESMA contagem de 1 e de 10.
    expect(q.r.itens, "premissa: a nota tem 50 itens").toHaveLength(50);
    expect(caminhosDa(q.r), "premissa: os 50 itens passam pelos mesmos caminhos (cinco blocos)").toEqual(blocos.flatMap(() => caminhos));
    expect(origensDoFator(q.r), "premissa: o fator dos 50 saiu do cadastro como o dos 10").toEqual(blocos.flatMap(() => origensDoFator(d.r)));
    expect(blocos.flatMap((b) => [b.pBarras.id, b.pReferencia.id, b.pDescricao.id]), "premissa: os produtos dos caminhos 3 a 5 de cada bloco")
      .toEqual(blocos.flatMap((_, b) => [4, 5, 6].map((k) => (vinculoDo(q.r, b * 10 + k) as VinculoComProduto).produto.id)));
    expect(q.r.financeiro.forma, "premissa: a forma ligada").toEqual({ situacao: "ligada", tPag: "13", forma });
    expect([tocamUnidades(q.sqls).length, daForma(q.sqls).length], "UMA consulta do cadastro e UMA da forma, 50 itens").toEqual([1, 1]);
    expect([consultaDoCadastro(d), consultaDoCadastro(q)], "a consulta ÚNICA leva TODOS os uCom e TODOS os produtos achados: 3 e 5 (10 itens), 15 e 25 (50 itens)")
      .toEqual([{ simbolos: [...bloco.simbolos].sort(), produtos: [...bloco.produtos].sort() },
        { simbolos: blocos.flatMap((b) => b.simbolos).sort(), produtos: blocos.flatMap((b) => b.produtos).sort() }]);
    expect([q.sqls.length, d.sqls.length], `o MESMO número de consultas, 50 itens, 10 e 1 (50: ${q.sqls.length}; 10: ${d.sqls.length}; 1: ${s.sqls.length})`)
      .toEqual([s.sqls.length, s.sqls.length]);
    console.log(`XML4-C7 CONSULTAS ${JSON.stringify({ umItem: s.sqls.length, dezItens: d.sqls.length, cinquentaItens: q.sqls.length })}`);
  });
});

// ═════════════════════════════════════ XML4-C8 a forma ═════════════════════════════════════

/** A forma da conferência (premissa: a conferência a declara). */
function formaDe(conf: Conferencia): FormaDePagamentoDaConferencia {
  expect(Object.hasOwn(conf.financeiro, "forma"), "premissa: a conferência declara a forma da nota").toBe(true);
  return conf.financeiro.forma!;
}
/** A conferência de uma nota de 1 item (sem produto) com os `<detPag>` dados, com as consultas contadas. */
async function conferenciaDaForma(pagamentos: OpcoesDaNota["pagamentos"]) {
  const n = await notaImportada([item(`FP-${unico()}`, "UN")], { pagamentos });
  await conferenciaLida(n.id);
  const { r, sqls, params } = await comConsultas(() => conferenciaLida(n.id));
  return { conf: r, forma: formaDe(r), consultas: daForma(sqls), params: params.filter((_, k) => daForma([sqls[k]!]).length > 0), n };
}

describe("XML4-C8 a FORMA DE PAGAMENTO que a nota diz", () => {
  it("UM <detPag> com tPag ligado: a forma do SISTEMA e a da ORGANIZAÇÃO (uma consulta); a nota lida traz os pagamentos", async () => {
    const doSistema = (await c.admin.query<{ id: string; nome: string }>(
      "select id::text as id, name as nome from erp.payment_methods where organization_id is null and is_active order by name limit 1")).rows[0];
    expect(doSistema, "premissa: o seed tem formas do SISTEMA").toBeTruthy();
    await ligar("15", doSistema!.id);
    const daOrganizacao = await formaDaOrganizacao();
    await ligar("17", daOrganizacao.id);
    const sistema = await conferenciaDaForma([{ tPag: "15", vPag: "20.00" }]);
    expect(sistema.forma).toEqual({ situacao: "ligada", tPag: "15", forma: doSistema });
    expect(sistema.conf.nota.pagamentos).toEqual([{ tPag: "15", vPag: "20.00" }]);
    expect(sistema.consultas, "UMA consulta da ligação").toHaveLength(1);
    const organizacao = await conferenciaDaForma([{ tPag: "17", vPag: "20.00" }]);
    expect(organizacao.forma).toEqual({ situacao: "ligada", tPag: "17", forma: daOrganizacao });
    expect(organizacao.conf.divergencias.filter((d) => d.codigo.includes("forma")), "a forma não vira divergência").toEqual([]);
  });

  it("sem ligação → sem_ligacao; a forma INATIVA → forma_inativa, com a forma (nunca a forma da nota)", async () => {
    expect((await c.admin.query("select 1 from erp.formas_pagamento_da_nfe where organization_id=$1 and codigo_tpag='03'", [c.h.demo.orgId])).rowCount,
      "premissa: o 03 não tem ligação na demo").toBe(0);
    const sem = await conferenciaDaForma([{ tPag: "03", vPag: "20.00" }]);
    expect(sem.forma).toEqual({ situacao: "sem_ligacao", tPag: "03" });
    expect(sem.consultas).toHaveLength(1);
    const inativa = await formaDaOrganizacao({ ativa: false });
    await ligar("04", inativa.id);
    expect((await conferenciaDaForma([{ tPag: "04", vPag: "20.00" }])).forma).toEqual({ situacao: "forma_inativa", tPag: "04", forma: inativa });
  });

  it("mais de um <detPag> (mesmo com o mesmo tPag ligado) → varias; nenhum <pag>, ou o único sem tPag → sem_tpag — SEM consulta da ligação", async () => {
    const varias = await conferenciaDaForma([{ tPag: "15", vPag: "10.00" }, { tPag: "15", vPag: "10.00" }]);
    expect([varias.forma, varias.consultas.length]).toEqual([{ situacao: "varias", quantidade: 2 }, 0]);
    const tres = await conferenciaDaForma([{ tPag: "15", vPag: "5.00" }, { tPag: "01", vPag: "5.00" }, { vPag: "10.00" }]);
    expect([tres.forma, tres.consultas.length]).toEqual([{ situacao: "varias", quantidade: 3 }, 0]);
    const semPag = await conferenciaDaForma(undefined);
    expect([semPag.forma, semPag.consultas.length, semPag.conf.nota.pagamentos]).toEqual([{ situacao: "sem_tpag" }, 0, []]);
    const semCodigo = await conferenciaDaForma([{ vPag: "20.00" }]);
    expect([semCodigo.forma, semCodigo.consultas.length, semCodigo.conf.nota.pagamentos]).toEqual([{ situacao: "sem_tpag" }, 0, [{ tPag: null, vPag: "20.00" }]]);
  });

  it("a ligação EXCLUÍDA não vale (sem_ligacao); a viva criada depois vale, e a excluída continua no banco", async () => {
    const velha = await formaDaOrganizacao();
    const excluida = await ligar("05", velha.id, { excluida: true });
    expect((await conferenciaDaForma([{ tPag: "05" }])).forma).toEqual({ situacao: "sem_ligacao", tPag: "05" });
    const nova = await formaDaOrganizacao();
    await ligar("05", nova.id);
    expect((await conferenciaDaForma([{ tPag: "05" }])).forma).toEqual({ situacao: "ligada", tPag: "05", forma: nova });
    expect((await c.admin.query<{ excluida: boolean }>("select deleted_at is not null as excluida from erp.formas_pagamento_da_nfe where id=$1", [excluida])).rows[0]!.excluida).toBe(true);
  });

  it("a ligação de OUTRA organização não vale: sem_ligacao; a consulta recorta pela organização sozinha, e a RLS sozinha também", async () => {
    const outra = await outraOrganizacao();
    const formaDaOutra = await formaDaOrganizacao({ orgId: outra.orgId });
    await ligar("16", formaDaOutra.id, { orgId: outra.orgId });
    expect((await c.admin.query("select 1 from erp.formas_pagamento_da_nfe where organization_id=$1 and codigo_tpag='16'", [c.h.demo.orgId])).rowCount,
      "premissa: o 16 só tem ligação na OUTRA organização").toBe(0);
    const caso = await conferenciaDaForma([{ tPag: "16" }]);
    expect(caso.forma).toEqual({ situacao: "sem_ligacao", tPag: "16" });
    const [sql] = caso.consultas;
    const [params] = caso.params;
    expect(params, "premissa: a consulta pergunta pela organização da sessão e pelo código").toEqual([c.h.demo.orgId, "16"]);
    // O filtro explícito, sem a RLS (superusuário): pela demo, nada; pela outra organização, a ligação dela (premissa).
    expect((await c.admin.query(sql!, params)).rowCount, "sem a RLS, o filtro da organização recorta").toBe(0);
    expect((await c.admin.query<{ id: string }>(sql!, [outra.orgId, "16"])).rows.map((r) => r.id), "premissa: a ligação existe na outra").toEqual([formaDaOutra.id]);
    // A RLS, sem o filtro: o papel da aplicação na transação da DEMO perguntando pela OUTRA organização não vê nada.
    const pelaRls = await withTx(c.h.db, { orgId: c.h.demo.orgId, userId: x.adminId, modulo: "compras" }, (tx) => tx.query(sql!, [outra.orgId, "16"]));
    expect(pelaRls.rowCount, "a RLS recorta sozinha").toBe(0);
  });
});

// ═════════════════════════════════════ XML4-C9 as parcelas ═════════════════════════════════════

const duplicatas = (...valores: string[]) => valores.map((valor, k) => ({ numero: String(k + 1).padStart(3, "0"), vencimento: `2026-1${k}-08`, valor }));
/** Um item de 1000,00 (vNF 1000,00), sem produto: o total comparado é o vNF. */
const itemDeMil = () => item(`PC-${unico()}`, "UN", { quantidade: "10.0000", valorUnitario: "100.0000000000", valorProdutos: "1000.00" });
const parcelasDasDivergencias = (conf: Conferencia) => conf.divergencias.filter((d) => /parcela|duplicata/.test(d.codigo));

describe("XML4-C9 as PARCELAS que não servem dizem por quê", () => {
  it("líquido da FATURA: as duas comparações falham, com as diferenças (com sinal) e a mensagem com os três números; o código e o bloqueia são os de antes", async () => {
    const n = await notaImportada([itemDeMil()], { fatura: { numero: "F1", original: "1000.00", desconto: "10.00", liquido: "990.00" }, duplicatas: duplicatas("500.00", "500.00") });
    const conf = await conferenciaLida(n.id);
    expect(conf.nota.totais.nota, "premissa: vNF 1000,00").toBe("1000.00");
    expect(conf.financeiro.parcelas).toEqual({
      situacao: "nao_conferem", soma: "1000.00", liquido: "990.00", total: "1000.00", origemDoLiquido: "fatura",
      falhas: ["soma_diferente_do_liquido", "liquido_diferente_do_total"], diferencaSomaLiquido: "10.00", diferencaLiquidoTotal: "-10.00", origem: "nota",
    });
    expect(parcelasDasDivergencias(conf)).toEqual([{ codigo: "parcelas_nao_conferem", nItem: null, bloqueia: false,
      mensagem: "As duplicatas não conferem: Σ vDup 1000.00 × líquido (fatura, vLiq) 990.00 — diferença 10.00; líquido 990.00 × total da compra 1000.00 — diferença -10.00. Use a condição de pagamento." }]);
  });

  it("líquido da NOTA (sem fatura): só a soma falha, e a mensagem diz que o líquido confere com o total", async () => {
    const n = await notaImportada([itemDeMil()], { duplicatas: duplicatas("400.00", "590.00") });
    const conf = await conferenciaLida(n.id);
    expect(conf.financeiro.parcelas).toEqual({
      situacao: "nao_conferem", soma: "990.00", liquido: "1000.00", total: "1000.00", origemDoLiquido: "nota",
      falhas: ["soma_diferente_do_liquido"], diferencaSomaLiquido: "-10.00", diferencaLiquidoTotal: "0.00", origem: "nota",
    });
    expect(parcelasDasDivergencias(conf)).toEqual([{ codigo: "parcelas_nao_conferem", nItem: null, bloqueia: false,
      mensagem: "As duplicatas não conferem: Σ vDup 990.00 × líquido (total da nota, vNF) 1000.00 — diferença -10.00; líquido 1000.00 × total da compra 1000.00 — confere. Use a condição de pagamento." }]);
  });

  it("a soma e o líquido conferem, mas a última duplicata ficaria zerada: a falha dita à parte", async () => {
    const n = await notaImportada([itemDeMil()], { duplicatas: duplicatas("1000.00", "0.00") });
    const conf = await conferenciaLida(n.id);
    expect(conf.financeiro.parcelas).toEqual({
      situacao: "nao_conferem", soma: "1000.00", liquido: "1000.00", total: "1000.00", origemDoLiquido: "nota",
      falhas: ["ultima_parcela_nao_positiva"], diferencaSomaLiquido: "0.00", diferencaLiquidoTotal: "0.00", origem: "nota",
    });
    expect(parcelasDasDivergencias(conf)).toEqual([{ codigo: "parcelas_nao_conferem", nItem: null, bloqueia: false,
      mensagem: "As duplicatas não conferem: Σ vDup 1000.00 × líquido (total da nota, vNF) 1000.00 — confere; líquido 1000.00 × total da compra 1000.00 — confere; "
        + "a última duplicata, ajustada para a soma fechar no total da compra, ficaria com valor zero ou negativo. Use a condição de pagamento." }]);
  });

  it("sem_duplicatas leva o MOTIVO: a nota sem <dup>, e a nota com <dup> sem vencimento (descartadas) — nenhuma divergência, como antes", async () => {
    const semDup = await conferenciaLida((await notaImportada([itemDeMil()])).id);
    expect([semDup.financeiro.parcelas, semDup.nota.duplicatasDescartadas]).toEqual([{ situacao: "sem_duplicatas", motivo: "nota_sem_duplicatas", origem: "nota" }, 0]);
    expect(parcelasDasDivergencias(semDup)).toEqual([]);
    const semVenc = await conferenciaLida((await notaImportada([itemDeMil()], { duplicatas: duplicatas("500.00", "500.00"), semVencimento: true })).id);
    expect([semVenc.financeiro.parcelas, semVenc.nota.duplicatasDescartadas, semVenc.nota.duplicatas])
      .toEqual([{ situacao: "sem_duplicatas", motivo: "duplicata_sem_vencimento", origem: "nota" }, 2, []]);
    expect(parcelasDasDivergencias(semVenc), "o motivo vai no resultado, não vira divergência").toEqual([]);
    expect(semVenc.divergencias.map((d) => d.codigo).sort(), "premissa: as divergências de sempre (o item sem produto)").toEqual(semDup.divergencias.map((d) => d.codigo).sort());
  });
});

// ═════════════════════════════════════ XML4-C10 o "Gerar compra" ═════════════════════════════════════

describe("XML4-C10 o \"Gerar compra\" com o fator DIGITADO e a forma da NOTA", () => {
  it("o GET não grava vínculo; a forma inativa é recusada; o fator digitado e a forma da nota geram a compra; o vínculo nasce no gerar e a nota seguinte o lembra", async () => {
    const u = unico();
    const [principal, caixa] = [simboloNovo(), simboloNovo()];
    const uPrincipal = await unidade(principal);
    await unidade(caixa);
    const p = await produtoNovo(uPrincipal);
    const forma = await formaDaOrganizacao();
    await ligar("18", forma.id);
    const inativa = await formaDaOrganizacao({ ativa: false });
    const n = await notaImportada([item(`GC-${u}`, caixa)], { pagamentos: [{ tPag: "18", vPag: "20.00" }] });
    await codigoNoFornecedor(p.id, n.fornecedor, `GC-${u}`);

    const antes = await vinculosLembrados();
    const conf = await conferenciaLida(n.id);
    expect(await vinculosLembrados(), "o GET da conferência não grava vínculo").toBe(antes);
    expect(fatorDo(conf, 1), "premissa: o item é PERGUNTA (a caixa não está no cadastro do produto)").toEqual({ caminho: "codigo_fornecedor", produto: p.id, fator: "1", tipoFator: "multiply",
      fatorPelaNota: { origem: "pergunta", unidadeDaNota: caixa, motivo: "unidade_fora_do_cadastro" }, quantidadeInterna: "2.0000" });
    expect(formaDe(conf), "premissa: a forma da nota").toEqual({ situacao: "ligada", tPag: "18", forma });

    const corpo = (formaId: string) => ({
      tipo_operacao_id: c.tops.compra, fornecedor_id: n.fornecedor, data_entrada: "2026-09-10",
      financeiro: { parcelas: "condicao", forma_pagamento_id: formaId, rateio: { tipo: "documento", categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter } },
      itens: [{ n_item: 1, produto_id: p.id, fator: "12", tipo_fator: "multiply", armazem_id: c.I.warehouse }],
    });
    const recusada = await gerar(n.id, corpo(inativa.id));
    expect(recusada.statusCode, recusada.body).toBe(422);
    expect((erro(recusada).details as { path: string }[]).map((d) => d.path), "a forma inativa: a recusa de sempre, no campo").toEqual(["financeiro.forma_pagamento_id"]);
    expect(await vinculosLembrados(), "nada gravado na recusa").toBe(antes);

    const r = await gerar(n.id, corpo(forma.id));
    expect(r.statusCode, r.body).toBe(201);
    const compra = j(r) as { id: string; valor_total: string };
    expect(compra.valor_total, "o total é o vNF").toBe("20.00");
    const doc = (await c.admin.query<{ forma: string }>("select forma_pagamento_id::text as forma from erp.documentos_compra where id=$1", [compra.id])).rows[0]!;
    expect(doc.forma, "a forma da nota foi gravada").toBe(forma.id);
    const linhas = (await c.admin.query(
      "select produto_id::text, quantidade::text, unidade_nota, quantidade_nota::text, fator_conversao::text, tipo_fator_conversao from erp.documentos_compra_itens where documento_id=$1", [compra.id])).rows;
    expect(linhas).toEqual([{ produto_id: p.id, quantidade: "24.0000", unidade_nota: caixa, quantidade_nota: "2.0000", fator_conversao: "12.000000", tipo_fator_conversao: "multiply" }]);
    expect(await vinculosLembrados(), "o vínculo nasce no gerar").toBe(antes + 1);
    const lembrado = (await c.admin.query("select codigo_fornecedor, unidade_fornecedor, produto_id::text, fator::text, tipo_fator from erp.produto_fornecedor_vinculos where fornecedor_id=$1", [n.fornecedor])).rows;
    expect(lembrado).toEqual([{ codigo_fornecedor: `GC-${u}`, unidade_fornecedor: caixa, produto_id: p.id, fator: "12.000000", tipo_fator: "multiply" }]);

    // A nota seguinte do MESMO fornecedor, código e unidade: o fator digitado é lembrado (o cadastro não diz nada: sem aviso).
    const seguinte = await importada(notaSintetica({ emitenteCnpj: n.emitente, itens: [item(`GC-${u}`, caixa)] }).xml, { empresaId: c.I.empresa });
    const conf2 = await conferenciaLida(seguinte.id);
    expect(fatorDo(conf2, 1)).toEqual({ caminho: "lembrado", produto: p.id, fator: "12.000000", tipoFator: "multiply",
      fatorPelaNota: { origem: "vinculo", unidadeDaNota: caixa, cadastro: null }, quantidadeInterna: "24.0000" });
    expect(doFator(conf2, 1)).toEqual([]);
  });
});

// ═════════════════════════════════════ XML4-C11 o cenário da medição ═════════════════════════════════════

/**
 * O CENÁRIO DA MEDIÇÃO da fase 0 (`ITENS_DO_CENARIO` de `apps/web/e2e/xml-04-comum.ts`), na conferência e com as
 * unidades do SEED (do sistema): P1..P4 na unidade principal; A1..A3 numa alternativa de compra com fator ≠ 1; U1 (BD) e
 * U2 (FD) com um uCom que o cadastro do produto NÃO tem — os nove pela REFERÊNCIA, o caminho cujo fator era o "1" fixo
 * (`FATOR_SEM_UNIDADE`) —; e o V pelo vínculo LEMBRADO (6) contra o cadastro (CX = 12).
 */
interface ItemDaMedicao { papel: string; uCom: string; principal: string; alternativa: { unidade: string; fator: string } | null; vinculo: string | null }
const CENARIO_DA_MEDICAO: readonly ItemDaMedicao[] = [
  { papel: "P1", uCom: "KG", principal: "KG", alternativa: null, vinculo: null },
  { papel: "P2", uCom: "L", principal: "L", alternativa: null, vinculo: null },
  { papel: "P3", uCom: "UN", principal: "UN", alternativa: null, vinculo: null },
  { papel: "P4", uCom: "SC", principal: "SC", alternativa: null, vinculo: null },
  { papel: "A1", uCom: "SC", principal: "KG", alternativa: { unidade: "SC", fator: "50" }, vinculo: null },
  { papel: "A2", uCom: "CX", principal: "UN", alternativa: { unidade: "CX", fator: "24" }, vinculo: null },
  { papel: "A3", uCom: "GL", principal: "L", alternativa: { unidade: "GL", fator: "5" }, vinculo: null },
  { papel: "U1", uCom: "BD", principal: "KG", alternativa: null, vinculo: null },
  { papel: "U2", uCom: "FD", principal: "UN", alternativa: null, vinculo: null },
  { papel: "V", uCom: "CX", principal: "UN", alternativa: { unidade: "CX", fator: "12" }, vinculo: "6" },
];

describe("XML4-C11 o cenário da MEDIÇÃO: os 2 itens com uCom fora do cadastro PERGUNTAM, com a unidade — nunca 1 em silêncio", () => {
  it("P1..P4 → 1 (principal); A1..A3 → o fator da alternativa; U1 (BD) e U2 (FD) → pergunta com a unidade e o aviso que a diz; V → o vínculo (6), com o cadastro (12) ao lado", async () => {
    const doSeed = new Map<string, string>();
    for (const s of new Set(CENARIO_DA_MEDICAO.flatMap((i) => [i.uCom, i.principal, ...(i.alternativa ? [i.alternativa.unidade] : [])]))) {
      const casam = await unidadesQueCasam(s);
      expect(casam, `premissa: o uCom ${s} casa com UMA unidade, a do sistema (seed), e com nenhuma da organização`).toEqual({ organizacao: [], sistema: [expect.any(String)] });
      doSeed.set(s, casam.sistema[0]!);
    }
    const u = unico().toUpperCase();
    const codigo = (papel: string) => `MD-${papel}-${u}`;
    const produtos: Produto[] = [];
    for (const i of CENARIO_DA_MEDICAO) {
      const p = await produtoNovo(doSeed.get(i.principal)!, i.vinculo ? {} : { reference: codigo(i.papel) });
      if (i.alternativa) await unidadeDoProduto(p.id, doSeed.get(i.alternativa.unidade)!, i.alternativa.fator);
      produtos.push(p);
    }
    const n = await notaImportada(CENARIO_DA_MEDICAO.map((i) => item(codigo(i.papel), i.uCom)));
    const nV = CENARIO_DA_MEDICAO.findIndex((i) => i.vinculo !== null) + 1;
    await lembrar(n.fornecedor, codigo("V"), "CX", produtos[nV - 1]!.id, "6");
    const conf = await conferenciaLida(n.id);
    const doItem = (nItem: number) => ({ produto: produtos[nItem - 1]!.id, quantidadeInterna: "2.0000" });
    const naPrincipal = (nItem: number) => ({ caminho: "reference", ...doItem(nItem), fator: "1", tipoFator: "multiply",
      fatorPelaNota: { origem: "unidade_principal", unidadeDaNota: CENARIO_DA_MEDICAO[nItem - 1]!.uCom } });
    const naAlternativa = (nItem: number, fator: string, quantidadeInterna: string) => ({ caminho: "reference", ...doItem(nItem), fator, tipoFator: "multiply",
      fatorPelaNota: { origem: "unidade_do_produto", unidadeDaNota: CENARIO_DA_MEDICAO[nItem - 1]!.uCom }, quantidadeInterna });
    const pergunta = (nItem: number) => ({ caminho: "reference", ...doItem(nItem), fator: "1", tipoFator: "multiply",
      fatorPelaNota: { origem: "pergunta", unidadeDaNota: CENARIO_DA_MEDICAO[nItem - 1]!.uCom, motivo: "unidade_fora_do_cadastro" } });
    expect(CENARIO_DA_MEDICAO.map((_, k) => fatorDo(conf, k + 1))).toEqual([
      naPrincipal(1), naPrincipal(2), naPrincipal(3), naPrincipal(4),
      naAlternativa(5, "50.000000", "100.0000"), naAlternativa(6, "24.000000", "48.0000"), naAlternativa(7, "5.000000", "10.0000"),
      pergunta(8), pergunta(9),
      { caminho: "lembrado", ...doItem(10), fator: "6.000000", tipoFator: "multiply", quantidadeInterna: "12.0000",
        fatorPelaNota: { origem: "vinculo", unidadeDaNota: "CX", cadastro: { fator: "12.000000", tipoFator: "multiply" } } },
    ]);
    // U1 e U2: a pergunta diz a UNIDADE que a nota trouxe (o fator "1" do fio é só a compatibilidade com a web anterior).
    expect([doFator(conf, 8), doFator(conf, 9)], "U1 e U2: o aviso com a unidade da nota (BD, FD) e o produto")
      .toEqual([[perguntaFora(8, "BD", produtos[7]!)], [perguntaFora(9, "FD", produtos[8]!)]]);
    expect(CENARIO_DA_MEDICAO.map((_, k) => doFator(conf, k + 1).map((x) => x.codigo)), "nenhum outro aviso de fator, só o do V")
      .toEqual([[], [], [], [], [], [], [], ["fator_a_informar"], ["fator_a_informar"], ["fator_do_vinculo_diferente_do_cadastro"]]);
    expect(doFator(conf, 10)[0]!.mensagem).toBe(
      `Item 10: o vínculo lembrado usa fator 6 (multiplica); o cadastro do produto ${produtos[9]!.codigo}, para a unidade CX, diz 12 (multiplica). Vale o do vínculo.`);
  });
});

// O 404 da conferência (premissa de que `conferencia` é a rota real e não um atalho): o id inexistente.
describe("XML4 a rota é a real", () => {
  it("id inexistente → a mesma 404 de sempre", async () => {
    const r = await conferencia("00000000-0000-4000-8000-000000000318");
    expect([r.statusCode, erro(r).code]).toEqual([404, "NOT_FOUND"]);
  });
});
