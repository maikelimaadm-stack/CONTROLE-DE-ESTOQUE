import { expect } from "vitest";
import { crc32, deflateRawSync } from "node:zlib";
import { D, money } from "@agro/shared";
import { c, cfg4, j, top, unico, type Hdr, type Resposta } from "./top-config-08-ajuda.js";
import type { ConfiguracaoTipoOperacaoV4 } from "@agro/domain";

/**
 * OPERACOES-01 F7 (decisão 284) — O CENÁRIO DOS TESTES DE INTEGRAÇÃO DA ENTRADA DE NOTA POR XML
 * (`compras-f7-compra-fiscal`, `compras-f7-importacao`).
 *
 * Sobre o cenário `c` de `./top-config-08-ajuda.js` (cada arquivo sobe o PRÓPRIO harness com `iniciar()`; a instância
 * `c.ligada` é a de produção; `c.admin` é a testemunha sem RLS). Este arquivo só acrescenta o que a F7 precisa:
 *
 *   · o XML de NF-e SINTÉTICO — tudo INVENTADO: o CNPJ do emitente e a chave de acesso saem de bases fictícias, com o
 *     dígito verificador calculado AQUI (as contas são reescritas neste arquivo, sem usar o código testado); nenhum dado
 *     de nota real. O destinatário padrão é o CNPJ das DUAS empresas do seed (o mesmo nas duas — o destinatário
 *     AMBÍGUO de propósito: quem importa escolhe a empresa, nunca "a primeira");
 *   · o ZIP de um arquivo só (guardado ou comprimido), montado aqui com `deflateRawSync` e `crc32`;
 *   · o fornecedor com documento (com ou sem máscara), a TOP de compra (formato 4, manual ou com confirmação
 *     automática) e as chamadas: lançar a nota antiga, registrar a DF-e, importar o XML, ler a conferência, gerar a
 *     compra e descartar a importação.
 */

// ─────────────── documentos e chave (contas reescritas aqui) ───────────────

/** DV de CNPJ numérico (pesos 5..2,9..2 e 6..2,9..2; resto < 2 → 0). */
export function cnpjComDv(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error("a base do CNPJ tem 12 dígitos");
  const dv = (s: string, pesos: number[]) => { const r = pesos.reduce((a, p, i) => a + Number(s[i]) * p, 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${dv(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

/** O CNPJ com a máscara de tela (`00.000.000/0000-00`) — o cadastro do acervo pode guardá-lo assim. */
export const cnpjMascarado = (cnpj: string): string => cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/** DV da chave de acesso (módulo 11, pesos 2..9 da direita para a esquerda; resto < 2 → 0). */
export function dvDaChave(chave43: string): number {
  let soma = 0; let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) { soma += Number(chave43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Chave de 44 posições com o DV calculado: cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) tpEmis(1) cNF(8) DV(1). */
export function chaveSintetica(p: { cnpj: string; serie?: string; nNF: string; cNF: string; mod?: string; cUF?: string; aamm?: string }): string {
  const base = `${p.cUF ?? "52"}${p.aamm ?? "2609"}${p.cnpj}${p.mod ?? "55"}${(p.serie ?? "1").padStart(3, "0")}${p.nNF.padStart(9, "0")}1${p.cNF.padStart(8, "0")}`;
  if (base.length !== 43) throw new Error("a chave sem o DV tem 43 posições");
  return `${base}${dvDaChave(base)}`;
}

/** O emitente inventado (base fictícia, DV calculado) e o documento das duas empresas do seed. */
export const CNPJ_EMITENTE_F7 = cnpjComDv("381745290001");
export const CNPJ_EMPRESAS_DO_SEED = "00000000000191";

let sequenciaDaNota = 0;
/** Um número de nota e um cNF novos por chamada (cada caso usa a SUA nota: nenhuma chave se repete por acaso). */
export function numeroNovo(): { nNF: string; cNF: string } {
  sequenciaDaNota += 1;
  const n = (Date.now() % 1_000_000) * 10 + sequenciaDaNota;
  return { nNF: String(n % 999_999_999 || 1), cNF: String((n * 7 + 13) % 99_999_999).padStart(8, "0") };
}

/** Uma chave sintética NOVA (emitente F7, série 1), válida (DV certo): para os campos fiscais da compra manual. */
export function chaveNova(cnpj: string = CNPJ_EMITENTE_F7): string {
  const { nNF, cNF } = numeroNovo();
  return chaveSintetica({ cnpj, nNF, cNF });
}

// ─────────────── o XML sintético ───────────────

export interface RastroSintetico { lote: string; quantidade: string; fabricacao?: string; validade?: string }
export interface ItemSintetico {
  codigo: string; descricao: string; unidade: string; quantidade: string; valorUnitario: string; valorProdutos: string;
  ean?: string; eanTrib?: string; ncm?: string; desconto?: string; frete?: string; seguro?: string; outras?: string;
  ipi?: string; icmsSt?: string; fcpSt?: string; xPed?: string; nItemPed?: string; rastro?: RastroSintetico[];
}
export interface OpcoesNotaSintetica {
  numero?: string; serie?: string; cNF?: string; dhEmi?: string;
  emitenteCnpj?: string; emitenteNome?: string; emitenteIe?: string;
  destinatario?: { cnpj?: string; cpf?: string; nome?: string; ie?: string };
  itens?: ItemSintetico[];
  duplicatas?: { numero: string; vencimento: string; valor: string }[];
  fatura?: { numero: string; original: string; desconto: string; liquido: string };
  xPedCabecalho?: string;
  tpAmb?: string; cStat?: string; mod?: string;
  /** Declara ISO-8859-1 no prólogo (o texto continua ASCII). */
  latin1?: boolean;
}
export interface NotaSintetica { xml: string; chave: string; vNF: string; numero: string; serie: string; emitente: string; dataEmissao: string }

/** O item padrão: 10 CX de um insumo, 100,00 cada (vProd 1000,00). */
export const ITEM_PADRAO: ItemSintetico = {
  codigo: "F7-INS-01", descricao: "Insumo sintético da F7", unidade: "CX", quantidade: "10.0000", valorUnitario: "100.0000000000", valorProdutos: "1000.00",
  ean: "SEM GTIN", ncm: "31052000",
};

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tag = (nome: string, valor: string | undefined) => (valor === undefined ? "" : `<${nome}>${esc(valor)}</${nome}>`);
const soma = (vs: (string | undefined)[]) => vs.reduce((a, v) => a.plus(D(v ?? 0)), D(0));

/**
 * A NF-e PROCESSADA (nfeProc + protNFe) SINTÉTICA, no leiaute 4.00 só no que o leitor usa. O vNF é a conta da nota
 * (vProd − vDesc + vFrete + vSeg + vOutro + vIPI + vST + vFCPST).
 */
export function notaSintetica(o: OpcoesNotaSintetica = {}): NotaSintetica {
  const emitente = o.emitenteCnpj ?? CNPJ_EMITENTE_F7;
  const novo = numeroNovo();
  const numero = o.numero ?? novo.nNF;
  const serie = o.serie ?? "1";
  const cNF = o.cNF ?? novo.cNF;
  const chave = chaveSintetica({ cnpj: emitente, serie, nNF: numero, cNF, mod: o.mod ?? "55" });
  const itens = o.itens ?? [ITEM_PADRAO];
  const vProd = soma(itens.map((i) => i.valorProdutos)); const vDesc = soma(itens.map((i) => i.desconto));
  const vFrete = soma(itens.map((i) => i.frete)); const vSeg = soma(itens.map((i) => i.seguro)); const vOutro = soma(itens.map((i) => i.outras));
  const vIPI = soma(itens.map((i) => i.ipi)); const vST = soma(itens.map((i) => i.icmsSt)); const vFCPST = soma(itens.map((i) => i.fcpSt));
  const vNF = money(vProd.minus(vDesc).plus(vFrete).plus(vSeg).plus(vOutro).plus(vIPI).plus(vST).plus(vFCPST));
  const dhEmi = o.dhEmi ?? "2026-09-08T10:30:00-03:00";

  const dets = itens.map((i, k) => {
    const rastro = (i.rastro ?? []).map((r) => `<rastro>${tag("nLote", r.lote)}${tag("qLote", r.quantidade)}${tag("dFab", r.fabricacao)}${tag("dVal", r.validade)}</rastro>`).join("");
    const icms = `<ICMS><ICMS10><orig>0</orig><CST>10</CST><vICMS>0.00</vICMS>${tag("vICMSST", i.icmsSt)}${tag("vFCPST", i.fcpSt)}</ICMS10></ICMS>`;
    const ipi = i.ipi === undefined ? "" : `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST>${tag("vIPI", i.ipi)}</IPITrib></IPI>`;
    return `<det nItem="${k + 1}"><prod>${tag("cProd", i.codigo)}${tag("cEAN", i.ean)}${tag("xProd", i.descricao)}${tag("NCM", i.ncm)}<CFOP>5102</CFOP>`
      + `${tag("uCom", i.unidade)}${tag("qCom", i.quantidade)}${tag("vUnCom", i.valorUnitario)}${tag("vProd", i.valorProdutos)}${tag("cEANTrib", i.eanTrib)}`
      + `${tag("vFrete", i.frete)}${tag("vSeg", i.seguro)}${tag("vDesc", i.desconto)}${tag("vOutro", i.outras)}${tag("xPed", i.xPed)}${tag("nItemPed", i.nItemPed)}`
      + `${rastro}</prod><imposto>${icms}${ipi}</imposto></det>`;
  }).join("");
  const dest = o.destinatario ?? { cnpj: CNPJ_EMPRESAS_DO_SEED, nome: "Destinatário sintético", ie: "ISENTO" };
  const cobr = o.fatura || o.duplicatas
    ? `<cobr>${o.fatura ? `<fat>${tag("nFat", o.fatura.numero)}${tag("vOrig", o.fatura.original)}${tag("vDesc", o.fatura.desconto)}${tag("vLiq", o.fatura.liquido)}</fat>` : ""}`
      + `${(o.duplicatas ?? []).map((p) => `<dup>${tag("nDup", p.numero)}${tag("dVenc", p.vencimento)}${tag("vDup", p.valor)}</dup>`).join("")}</cobr>`
    : "";
  const infNFe = `<infNFe Id="NFe${chave}" versao="4.00">`
    + `<ide><cUF>52</cUF><cNF>${cNF}</cNF><natOp>Venda sintética</natOp><mod>${o.mod ?? "55"}</mod><serie>${serie}</serie><nNF>${numero}</nNF>`
    + `<dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF><tpAmb>${o.tpAmb ?? "1"}</tpAmb><finNFe>1</finNFe></ide>`
    + `<emit><CNPJ>${emitente}</CNPJ><xNome>${esc(o.emitenteNome ?? "Fornecedor Sintético F7 Ltda")}</xNome><xFant>Sintético F7</xFant>`
    + `<enderEmit><xLgr>Rua Inventada</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>5208707</cMun><xMun>Goiânia</xMun><UF>GO</UF><CEP>74000000</CEP></enderEmit>`
    + `<IE>${o.emitenteIe ?? "1029384756"}</IE></emit>`
    + `<dest>${tag("CNPJ", dest.cnpj)}${tag("CPF", dest.cpf)}${tag("xNome", dest.nome)}${tag("IE", dest.ie)}</dest>${dets}`
    + `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vST>${money(vST)}</vST><vFCPST>${money(vFCPST)}</vFCPST>`
    + `<vProd>${money(vProd)}</vProd><vFrete>${money(vFrete)}</vFrete><vSeg>${money(vSeg)}</vSeg><vDesc>${money(vDesc)}</vDesc><vII>0.00</vII>`
    + `<vIPI>${money(vIPI)}</vIPI><vIPIDevol>0.00</vIPIDevol><vOutro>${money(vOutro)}</vOutro><vNF>${vNF}</vNF></ICMSTot></total>`
    + cobr + (o.xPedCabecalho ? `<compra><xPed>${esc(o.xPedCabecalho)}</xPed></compra>` : "") + `</infNFe>`;
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>${o.tpAmb ?? "1"}</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-09-08T10:31:00-03:00</dhRecbto>`
    + `<nProt>152260000000099</nProt><cStat>${o.cStat ?? "100"}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  const xml = `<?xml version="1.0" encoding="${o.latin1 ? "ISO-8859-1" : "UTF-8"}"?>\n`
    + `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>${prot}</nfeProc>\n`;
  return { xml, chave, vNF, numero, serie, emitente, dataEmissao: dhEmi.slice(0, 10) };
}

/** O arquivo em base64 (o corpo da importação). */
export const base64 = (conteudo: string | Buffer): string => (typeof conteudo === "string" ? Buffer.from(conteudo, "utf8") : conteudo).toString("base64");

/**
 * Um ZIP com UM arquivo (método 0, guardado; ou 8, comprimido), montado aqui: cabeçalho local, dados, diretório
 * central e o fim do diretório. Sem criptografia nem ZIP64. `extras` acrescenta outras entradas guardadas.
 */
export function zipDeArquivos(entradas: { nome: string; conteudo: string | Buffer; comprimir?: boolean }[]): Buffer {
  const locais: Buffer[] = []; const centrais: Buffer[] = []; let deslocamento = 0;
  for (const e of entradas) {
    const dados = typeof e.conteudo === "string" ? Buffer.from(e.conteudo, "utf8") : e.conteudo;
    const metodo = e.comprimir ? 8 : 0;
    const gravado = e.comprimir ? deflateRawSync(dados) : dados;
    const nome = Buffer.from(e.nome, "utf8");
    const crc = crc32(dados) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(gravado.length, 18);
    local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(nome.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(metodo, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(gravado.length, 20); central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(nome.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(deslocamento, 42);
    locais.push(local, nome, gravado); centrais.push(central, nome);
    deslocamento += local.length + nome.length + gravado.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(entradas.length, 8); fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12); fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

// ─────────────── cadastros (superusuário) ───────────────

/**
 * Um FORNECEDOR novo com o documento dado (com máscara, se `mascarado`) e a IE. Premissa: a linha nasceu com o
 * documento EXATAMENTE como pedido (a máscara inclusive).
 */
export async function fornecedorComDocumento(documento: string, o: { mascarado?: boolean; ie?: string | null; nome?: string; fornecedor?: boolean } = {}): Promise<string> {
  const gravado = o.mascarado ? cnpjMascarado(documento) : documento;
  const r = await c.admin.query<{ id: string; document: string }>(
    `insert into erp.people (organization_id, code, name, legal_name, person_type, document, state_registration, is_provider)
     values ($1, $2, $3, $3, $4, $5, $6, $7) returning id::text as id, document`,
    [c.h.demo.orgId, `F7${unico()}`.slice(0, 20), o.nome ?? `Fornecedor F7 ${unico()}`, documento.length === 11 ? "natural" : "legal", gravado, o.ie ?? null, o.fornecedor ?? true]);
  expect(r.rows[0]!.document, "premissa: o fornecedor guarda o documento como pedido").toBe(gravado);
  return r.rows[0]!.id;
}

/** O código de um registro de compra (o banco). */
export async function codigoDaCompra(id: string): Promise<string> {
  return (await c.admin.query<{ codigo: string }>("select codigo from erp.documentos_compra where id = $1", [id])).rows[0]!.codigo;
}

/** Uma TOP de COMPRA no formato 4 neutro, com o ajuste do caso (ex.: confirmação automática). */
export const topCompra = (ajuste?: (x: ConfiguracaoTipoOperacaoV4) => void): Promise<string> => top("compras.compra", { configuracao: cfg4(ajuste) });
/** Uma TOP de COMPRA com CONFIRMAÇÃO AUTOMÁTICA (a importação NUNCA a usa: a compra gerada nasce aberta). */
export const topCompraAutomatica = (): Promise<string> => topCompra((x) => { x.geral.confirmacao = "automatica"; });

// ─────────────── chamadas ───────────────

const comChave = (headers: Hdr, chave?: string): Hdr => (chave ? { ...headers, "idempotency-key": chave } : headers);
const chamar = (method: "GET" | "POST", url: string, payload?: Record<string, unknown>, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method, url, headers: comChave(headers, chave), ...(payload === undefined ? {} : { payload }) });

/** POST /api/stock/invoices — a nota antiga (Documento fiscal de Estoque). */
export const lancarNotaAntiga = (corpo: Record<string, unknown>, headers?: Hdr): Promise<Resposta> => chamar("POST", "/api/stock/invoices", corpo, headers);
/** O corpo mínimo da nota antiga: 1 item que não gera estoque, sem financeiro, do fornecedor e com a chave dados. */
export const corpoNotaAntiga = (fornecedorId: string, produtoId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  empresa_id: c.I.empresa, number: String(numeroNovo().nNF).slice(-9), series: "1", provider_id: fornecedorId, emission_date: "2026-09-10",
  generate_financial: false, items: [{ product_id: produtoId, quantity: "1", unit_value: "10.00", generate_stock: false }], ...extra,
});

/** POST /api/stock/dfe — a DF-e (com `xml`, a F7). */
export const registrarDfe = (corpo: Record<string, unknown>, headers?: Hdr): Promise<Resposta> => chamar("POST", "/api/stock/dfe", corpo, headers);
/** POST /api/stock/dfe-drafts/:id/approve. */
export const aprovarRascunho = (id: string, headers?: Hdr): Promise<Resposta> => chamar("POST", `/api/stock/dfe-drafts/${id}/approve`, {}, headers);

/**
 * POST /api/compras/importacoes — importa o arquivo (o XML como texto, ou um Buffer — o ZIP). `empresaId` é o pedido
 * de empresa (destinatário ambíguo); `chave` é a Idempotency-Key.
 */
export function importar(arquivo: string | Buffer, o: { nomeArquivo?: string; empresaId?: string; headers?: Hdr; chave?: string } = {}): Promise<Resposta> {
  const nome = o.nomeArquivo ?? (typeof arquivo === "string" ? "nota.xml" : "nota.zip");
  return chamar("POST", "/api/compras/importacoes", { nome_arquivo: nome, arquivo_base64: base64(arquivo), ...(o.empresaId ? { empresa_id: o.empresaId } : {}) },
    o.headers, o.chave);
}
/** Importa e exige o 201 (premissa); devolve a conferência. */
export async function importada(arquivo: string | Buffer, o: Parameters<typeof importar>[1] = {}): Promise<Record<string, unknown> & { id: string }> {
  const r = await importar(arquivo, o);
  expect(r.statusCode, `premissa: a nota é importada — ${r.body}`).toBe(201);
  return j(r) as Record<string, unknown> & { id: string };
}
/** GET /api/compras/importacoes/:id (com `?fornecedor_id=` quando dado). */
export const conferencia = (id: string, o: { fornecedorId?: string; headers?: Hdr } = {}): Promise<Resposta> =>
  chamar("GET", `/api/compras/importacoes/${id}${o.fornecedorId ? `?fornecedor_id=${o.fornecedorId}` : ""}`, undefined, o.headers);
/** POST /api/compras/importacoes/:id/gerar-compra. */
export const gerar = (id: string, corpo: Record<string, unknown>, o: { headers?: Hdr; chave?: string } = {}): Promise<Resposta> =>
  chamar("POST", `/api/compras/importacoes/${id}/gerar-compra`, corpo, o.headers, o.chave);
/** POST /api/compras/importacoes/:id/descartar. */
export const descartar = (id: string, o: { headers?: Hdr; chave?: string } = {}): Promise<Resposta> =>
  chamar("POST", `/api/compras/importacoes/${id}/descartar`, {}, o.headers, o.chave);
/** POST /api/compras/importacoes/da-dfe/:dfeId. */
export const importarDaDfe = (dfeId: string, corpo: Record<string, unknown> = {}, o: { headers?: Hdr; chave?: string } = {}): Promise<Resposta> =>
  chamar("POST", `/api/compras/importacoes/da-dfe/${dfeId}`, corpo, o.headers, o.chave);

// ─────────────── testemunhas (superusuário, sem RLS) ───────────────

/** A linha da compra no banco com os dados fiscais (texto). */
export async function compraNoBanco(id: string): Promise<Record<string, string | null>> {
  return (await c.admin.query<Record<string, string | null>>(
    `select situacao, empresa_id::text, valor_itens::text, valor_total::text, chave_acesso, uf_nota, tipo_documento_fiscal, valor_ipi::text, valor_icms_st::text,
            seguro::text, tipo_titulo_id::text, classificacao_gasto, rateio_tipo, parcelas_nota::text, dfe_id::text, solicitacao_compra_id::text,
            to_char(data_vencimento, 'YYYY-MM-DD') as data_vencimento
       from erp.documentos_compra where id = $1`, [id])).rows[0]!;
}
export interface TituloDaCompraNoBanco {
  id: string; empresa_id: string; status: string; amount: string; due_date: string; title_type_id: string | null; classification: string; document_type: string | null;
}
/** Os títulos da origem com o que a F7 grava (tipo, classificação, tipo de documento), em ordem de vencimento. */
export async function titulosDaCompra(id: string): Promise<TituloDaCompraNoBanco[]> {
  return (await c.admin.query<TituloDaCompraNoBanco>(
    `select id::text, empresa_id::text, status, amount::text, to_char(due_date, 'YYYY-MM-DD') as due_date, title_type_id::text, classification, document_type
       from erp.financial_titles where source_type = 'documentos_compra' and source_id = $1 order by due_date, installment_number, id`, [id])).rows;
}
export interface RateioDoTituloNoBanco {
  financial_category_id: string; cost_center_id: string; chart_account_id: string | null; harvest_id: string | null; percentage: string; amount: string;
}
/** O rateio gravado nos títulos da origem: por título (vencimento, parcela) e, dentro dele, do maior percentual para o menor. */
export async function rateioDosTitulos(id: string): Promise<RateioDoTituloNoBanco[]> {
  return (await c.admin.query<RateioDoTituloNoBanco>(
    `select a.financial_category_id::text, a.cost_center_id::text, a.chart_account_id::text, a.harvest_id::text, a.percentage::text, a.amount::text
       from erp.title_apportionments a join erp.financial_titles t on t.id = a.title_id
      where t.source_type = 'documentos_compra' and t.source_id = $1 order by t.due_date, t.installment_number, a.percentage desc, a.financial_category_id`, [id])).rows;
}
