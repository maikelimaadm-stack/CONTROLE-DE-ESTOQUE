import type { Locator, Page, Response } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { getResource } from "@agro/domain";
import { D } from "@agro/shared";
import { api, uniq, empresaAtiva } from "./helpers";
import { test as testDaCentral, expect, codigoTop, criarCadastro, criarTop, referenciasDoSeed, type Opcao } from "./central-compras-fixtures";
import { CNPJ_DAS_EMPRESAS_DO_SEED, cnpjDeEmitenteSintetico, dvDaChave, notaSinteticaDeVariosItens } from "./compras-f7-nfe-sintetica";
import { cabecalhosDaSessao } from "./top-config-08-comum";
import { fonteDoCommitContem } from "./xml-02-comum";
import { shaDaBase } from "./skew-fonte-da-base";

/**
 * XML-04 — AS PEÇAS DA MEDIÇÃO DO FATOR, DA FORMA E DO VENCIMENTO NA CONFERÊNCIA DA NF-e DE COMPRA, E DO E2E DA TELA E
 * DO VERSION SKEW NOS DOIS SENTIDOS (decisão 318).
 *
 * Módulo de apoio (não é spec: o nome não termina em `.spec.ts`). Usado por `xml-04-medicao.spec.ts`, que roda NA BASE
 * (o mundo de hoje) e no fim da fatia (o mundo novo) com a MESMA especificação, por `xml-04-tela.spec.ts` (web e API
 * deste HEAD), por `xml-04-skew-api-producao.spec.ts` (sentido 1: o web deste HEAD contra a API da base) e por
 * `xml-04-skew-web-anterior.spec.ts` (sentido 2: o web da base contra a API deste HEAD). Duplicados, o cenário e os
 * detectores envelheceriam cada um por conta própria. Tudo o que é novo da XML-04 é lido por PROPRIEDADE PRÓPRIA da
 * resposta da API (`Object.hasOwn`) e só é usado quando existe — sem ele, mede-se o mundo de hoje. As propriedades que
 * este arquivo procura estão em `CAMPOS_NOVOS_DA_XML04`; os testids novos da tela, em `TESTIDS_DA_XML04`.
 *
 * ┌─ O CENÁRIO (`cenarioDaXml04`) — uma nota de 10 itens de UM fornecedor (o emitente) ─────────────────────────┐
 * │ P1..P4  o uCom é a UNIDADE PRINCIPAL do produto (`products.measurement_id`)                fator certo 1    │
 * │ A1..A3  o uCom é uma unidade ALTERNATIVA viva do produto (`produto_unidades`, multiplica,   fator certo = o  │
 * │         uso_compra) com fator ≠ 1                                                          da alternativa  │
 * │ U1, U2  o uCom NÃO está no cadastro do produto (nem principal nem alternativa)             fator certo = o  │
 * │                                                                                            do cenário      │
 * │ P1..U2  casam pela REFERÊNCIA (`products.reference` = cProd): o caminho cujo fator hoje é o "1" fixo       │
 * │         (`FATOR_SEM_UNIDADE`, apps/api/src/lib/importacao-nfe-conferencia.ts)                              │
 * │ V       vem pelo VÍNCULO LEMBRADO (fornecedor + cProd + uCom), que diz 6; o cadastro do produto tem a       │
 * │         alternativa CX com fator 12. O CERTO do cenário é o do CADASTRO (12): o vínculo ficou velho — a     │
 * │         caixa do fornecedor passou a vir com 12 e o cadastro foi corrigido. O vínculo nasce de uma COMPRA   │
 * │         GERADA ANTES pela API (nota prévia do mesmo emitente, "Gerar compra" com `lembrar_vinculo`, fator 6) │
 * │ A nota traz `<pag><detPag><tPag>15</tPag>` (boleto: a forma certa do cenário é "Boleto") e uma fatura com   │
 * │ desconto (vLiq < vNF) e DUAS duplicatas que NÃO fecham com o líquido: Σ vDup 5700,00 · vLiq 5979,00 ·       │
 * │ vNF = total da compra 6029,00 — os três números são distintos (a tela não pode achar um no lugar do outro). │
 * │ Toda descrição e todo código levam o sorteio da execução. Nenhuma palavra do cenário existe no seed.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O XML é SINTÉTICO (`notaDaXml04`, no molde de `compras-f7-nfe-sintetica.ts`: CNPJ e chave inventados, DVs calculados
 * lá; os valores conferidos aqui em inteiros, sem ponto flutuante). Os cadastros (fornecedor, Local, TOP, 10 produtos)
 * nascem pela API e são excluídos (lógica) pela fixture da Central no fim do caso. As compras e as importações ficam
 * (ledger; decisão 247). Nenhuma escrita direta no banco: o vínculo lembrado nasce pelo "Gerar compra"; o banco só é
 * LIDO (SELECT: `vinculoLembrado`, `vinculosDoFornecedor`, `compraNoBanco`, `ligacoesVivasDoCodigo`) para testemunhar
 * o que a API gravou. Nada aqui imprime credencial: os cabeçalhos da sessão viajam só nas requisições, e a conexão do
 * banco nunca entra numa mensagem.
 *
 * ┌─ A LIGAÇÃO tPag → FORMA (`test` deste arquivo, fixture `ligacoes`) ─────────────────────────────────────────┐
 * │ Na produção quem liga o código tPag a uma forma é o DONO, no cadastro "Formas de Pagamento da NF-e"        │
 * │ (`erp.formas_pagamento_da_nfe`, 0064). No banco do E2E a ligação é FIXTURE DO CASO: nasce pela porta do      │
 * │ próprio cadastro (`POST /api/resources/formas_pagamento_da_nfe`, a mesma que a tela usa) e sai no FIM DO     │
 * │ CASO pela exclusão lógica da mesma porta — numa teardown de fixture, que roda também no caso que falhou ou   │
 * │ estourou o tempo. Uma ligação viva por código e organização (índice único da 0064): antes de ligar, o caso   │
 * │ confere no banco que o código não tem ligação viva (premissa: uma sobra de execução anterior REPROVA com o   │
 * │ id dela — nunca é apagada nem reaproveitada em silêncio). A API da base (sentido 1 do skew) não tem o        │
 * │ cadastro: lá nada é ligado.                                                                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

export const caminho = (r: Response) => new URL(r.url()).pathname;
export const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const propria = (o: unknown, chave: string): unknown => (ehObjeto(o) && Object.hasOwn(o, chave) ? o[chave] : undefined);

/* ═════════════════════════════════ o XML (no molde de compras-f7-nfe-sintetica.ts) ═════════════════════════════════ */

const sorteio = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto decimal → inteiro escalado por 10^casas, sem ponto flutuante (mais casas que `casas` é erro, nunca arredonda). */
function inteiroEscalado(v: string, casas: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) throw new Error(`decimal inválido: ${v}`);
  const fracao = m[2] ?? "";
  if (fracao.length > casas) throw new Error(`${v} tem mais de ${casas} casas`);
  return BigInt(`${m[1]}${fracao.padEnd(casas, "0")}`);
}
/** Centavos → texto com 2 casas. */
const deCentavos = (c: bigint) => { const s = c.toString().padStart(3, "0"); return `${s.slice(0, -2)}.${s.slice(-2)}`; };
/** O texto decimal com exatamente `casas` casas (só completa com zeros). */
const comCasas = (v: string, casas: number) => { const [i, f = ""] = v.split("."); if (f.length > casas) throw new Error(`${v} tem mais de ${casas} casas`); return `${i}.${f.padEnd(casas, "0")}`; };

export interface ItemDaNotaDaXml04 {
  codigo: string; descricao: string; unidade: string; ncm: string;
  /** qCom, até 4 casas. */ quantidade: string;
  /** vUnCom, até 10 casas. */ valorUnitario: string;
  /** vProd, 2 casas: EXATAMENTE quantidade × valorUnitario (conferido aqui, em inteiros). */ valorProdutos: string;
}

/** Uma duplicata COMO DECLARADA na nota (`vencimento: null` = a `<dup>` sem `<dVenc>`, que o leitor descarta). */
export interface DuplicataDaNota { numero: string; vencimento: string | null; valor: string }

export interface OpcoesDaNotaDaXml04 {
  emitenteCnpj: string; emitenteNome: string; itens: ItemDaNotaDaXml04[];
  /** vDesc da fatura (o vLiq é vNF − vDesc). */ descontoDaFatura: string;
  /** As duplicatas COMO DECLARADAS (a soma NÃO é ajustada: é o caso da nota que não fecha). */ duplicatas: DuplicataDaNota[];
  /** Os `<detPag>` (tPag de 2 dígitos, vPag em 2 casas); vazio = o grupo `<pag>` sem `<detPag>` (a nota não diz a forma). */ pagamentos: { tPag: string; vPag: string }[];
}

export interface NotaDaXml04 {
  xml: string; chave: string; numero: string; emitenteCnpj: string; itens: (ItemDaNotaDaXml04 & { nItem: number })[];
  vNF: string; vLiq: string; somaDasDuplicatas: string; duplicatas: DuplicataDaNota[];
}

/**
 * A nota da XML-04: os itens declarados (sem frete, seguro, desconto, IPI ou ST — o vNF é a soma dos vProd), a fatura
 * com vOrig = vNF, o desconto declarado e vLiq = vNF − vDesc, as duplicatas COMO DECLARADAS e o grupo `<pag>`. Emitente,
 * número e código numérico sorteados (cada chamada é outra nota, com outra chave). Itens "SEM GTIN" (nenhum código de
 * barras: o caminho do código de barras não acha nada).
 */
export function notaDaXml04(o: OpcoesDaNotaDaXml04): NotaDaXml04 {
  if (o.itens.length === 0 || o.itens.length > 990) throw new Error("a nota precisa de 1 a 990 itens");
  const numero = String(Number(`1${sorteio(7)}`));
  const serie = "1";
  const cNF = sorteio(8);
  const c43 = `52` + `2609` + o.emitenteCnpj + `55` + serie.padStart(3, "0") + numero.padStart(9, "0") + `1` + cNF;
  if (!/^\d{43}$/.test(c43)) throw new Error("a chave sem o DV precisa de 43 dígitos");
  const chave = `${c43}${dvDaChave(c43)}`;
  let soma = 0n;
  const itens = o.itens.map((i, k) => {
    const produto = inteiroEscalado(i.quantidade, 4) * inteiroEscalado(i.valorUnitario, 10);
    if (produto !== inteiroEscalado(i.valorProdutos, 2) * 10n ** 12n) throw new Error(`item ${k + 1}: vProd ${i.valorProdutos} não é ${i.quantidade} × ${i.valorUnitario}`);
    soma += inteiroEscalado(i.valorProdutos, 2);
    return { ...i, nItem: k + 1 };
  });
  const vNF = deCentavos(soma);
  const desconto = inteiroEscalado(o.descontoDaFatura, 2);
  if (desconto >= soma) throw new Error("o desconto da fatura precisa deixar um líquido positivo");
  const vLiq = deCentavos(soma - desconto);
  const somaDasDuplicatas = deCentavos(o.duplicatas.reduce((a, d) => a + inteiroEscalado(d.valor, 2), 0n));
  for (const p of o.pagamentos) if (!/^\d{2}$/.test(p.tPag)) throw new Error(`tPag ${p.tPag} não tem 2 dígitos`);
  const dets = itens.map((i) => {
    const q = comCasas(i.quantidade, 4); const vUn = comCasas(i.valorUnitario, 10);
    return `<det nItem="${i.nItem}"><prod><cProd>${esc(i.codigo)}</cProd><cEAN>SEM GTIN</cEAN><xProd>${esc(i.descricao)}</xProd><NCM>${i.ncm}</NCM>`
      + `<CFOP>5102</CFOP><uCom>${esc(i.unidade)}</uCom><qCom>${q}</qCom><vUnCom>${vUn}</vUnCom><vProd>${i.valorProdutos}</vProd>`
      + `<cEANTrib>SEM GTIN</cEANTrib><uTrib>${esc(i.unidade)}</uTrib><qTrib>${q}</qTrib><vUnTrib>${vUn}</vUnTrib><indTot>1</indTot></prod>`
      + `<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vICMS>0.00</vICMS></ICMS00></ICMS></imposto></det>`;
  }).join("");
  const infNFe = `<infNFe Id="NFe${chave}" versao="4.00">`
    + `<ide><cUF>52</cUF><cNF>${cNF}</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>${serie}</serie><nNF>${numero}</nNF>`
    + `<dhEmi>2026-09-20T10:00:00-03:00</dhEmi><tpNF>1</tpNF><tpAmb>1</tpAmb><finNFe>1</finNFe></ide>`
    + `<emit><CNPJ>${o.emitenteCnpj}</CNPJ><xNome>${esc(o.emitenteNome)}</xNome><xFant>Sintética</xFant><enderEmit><xLgr>Rua Inventada</xLgr><nro>100</nro>`
    + `<xBairro>Centro</xBairro><cMun>5208707</cMun><xMun>Goiânia</xMun><UF>GO</UF><CEP>74000000</CEP><fone>6230000000</fone></enderEmit><IE>1234567890</IE></emit>`
    + `<dest><CNPJ>${CNPJ_DAS_EMPRESAS_DO_SEED}</CNPJ><xNome>Destinatário do seed</xNome></dest>`
    + dets
    + `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vST>0.00</vST><vFCPST>0.00</vFCPST><vProd>${vNF}</vProd>`
    + `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vOutro>0.00</vOutro><vNF>${vNF}</vNF></ICMSTot></total>`
    + `<cobr><fat><nFat>${numero}</nFat><vOrig>${vNF}</vOrig><vDesc>${deCentavos(desconto)}</vDesc><vLiq>${vLiq}</vLiq></fat>`
    + o.duplicatas.map((d) => `<dup><nDup>${esc(d.numero)}</nDup>${d.vencimento === null ? "" : `<dVenc>${d.vencimento}</dVenc>`}<vDup>${comCasas(d.valor, 2)}</vDup></dup>`).join("") + `</cobr>`
    + `<pag>${o.pagamentos.map((p) => `<detPag><tPag>${p.tPag}</tPag><vPag>${comCasas(p.vPag, 2)}</vPag></detPag>`).join("")}</pag>`
    + `<infAdic><infCpl>Nota sintética de teste, sem valor fiscal.</infCpl></infAdic></infNFe>`;
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-09-20T10:01:00-03:00</dhRecbto>`
    + `<nProt>152260000000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">`
    + `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>${prot}</nfeProc>\n`;
  return { xml, chave, numero, emitenteCnpj: o.emitenteCnpj, itens, vNF, vLiq, somaDasDuplicatas, duplicatas: o.duplicatas };
}

/* ═════════════════════════════════ o cenário ═════════════════════════════════ */

export type GrupoDoItem = "principal" | "alternativa" | "fora_do_cadastro" | "vinculo";

/** Um item do cenário: o que a nota diz, o que o cadastro do produto tem e o fator CERTO (a verdade do cenário). */
export interface ItemDoCenario {
  papel: string; grupo: GrupoDoItem;
  /** o uCom da nota (símbolo do seed, em maiúsculas) */ uCom: string;
  /** a unidade principal do produto */ principal: string;
  /** a unidade alternativa viva do produto (multiplica, uso_compra), ou nenhuma */ alternativa: { unidade: string; fator: string } | null;
  /** o fator CERTO do cenário (multiplica) */ fatorCerto: string;
  /** o fator do vínculo lembrado (só o V) */ fatorDoVinculo: string | null;
  ncm: string; quantidade: string; valorUnitario: string; valorProdutos: string;
}

/** OS 10 ITENS, na ordem da nota (nItem = posição + 1). NCM de 8 dígitos já usadas pelos specs vizinhos. */
export const ITENS_DO_CENARIO: readonly ItemDoCenario[] = [
  { papel: "P1", grupo: "principal", uCom: "KG", principal: "KG", alternativa: null, fatorCerto: "1", fatorDoVinculo: null, ncm: "31052000", quantidade: "100", valorUnitario: "2.50", valorProdutos: "250.00" },
  { papel: "P2", grupo: "principal", uCom: "L", principal: "L", alternativa: null, fatorCerto: "1", fatorDoVinculo: null, ncm: "38085929", quantidade: "40", valorUnitario: "12.25", valorProdutos: "490.00" },
  { papel: "P3", grupo: "principal", uCom: "UN", principal: "UN", alternativa: null, fatorCerto: "1", fatorDoVinculo: null, ncm: "23099010", quantidade: "30", valorUnitario: "4.50", valorProdutos: "135.00" },
  { papel: "P4", grupo: "principal", uCom: "SC", principal: "SC", alternativa: null, fatorCerto: "1", fatorDoVinculo: null, ncm: "31055900", quantidade: "15", valorUnitario: "110.00", valorProdutos: "1650.00" },
  { papel: "A1", grupo: "alternativa", uCom: "SC", principal: "KG", alternativa: { unidade: "SC", fator: "50" }, fatorCerto: "50", fatorDoVinculo: null, ncm: "31053000", quantidade: "20", valorUnitario: "95.00", valorProdutos: "1900.00" },
  { papel: "A2", grupo: "alternativa", uCom: "CX", principal: "UN", alternativa: { unidade: "CX", fator: "24" }, fatorCerto: "24", fatorDoVinculo: null, ncm: "31054000", quantidade: "10", valorUnitario: "32.00", valorProdutos: "320.00" },
  { papel: "A3", grupo: "alternativa", uCom: "GL", principal: "L", alternativa: { unidade: "GL", fator: "5" }, fatorCerto: "5", fatorDoVinculo: null, ncm: "23091000", quantidade: "8", valorUnitario: "45.00", valorProdutos: "360.00" },
  { papel: "U1", grupo: "fora_do_cadastro", uCom: "BD", principal: "KG", alternativa: null, fatorCerto: "20", fatorDoVinculo: null, ncm: "31051000", quantidade: "6", valorUnitario: "70.00", valorProdutos: "420.00" },
  { papel: "U2", grupo: "fora_do_cadastro", uCom: "FD", principal: "UN", alternativa: null, fatorCerto: "10", fatorDoVinculo: null, ncm: "23099090", quantidade: "5", valorUnitario: "48.00", valorProdutos: "240.00" },
  { papel: "V", grupo: "vinculo", uCom: "CX", principal: "UN", alternativa: { unidade: "CX", fator: "12" }, fatorCerto: "12", fatorDoVinculo: "6", ncm: "31056000", quantidade: "4", valorUnitario: "66.00", valorProdutos: "264.00" }
];

/** A fatura e o pagamento da nota (as duplicatas NÃO fecham com o líquido; os três números são distintos). */
export const COBRANCA_DO_CENARIO = {
  descontoDaFatura: "50.00",
  duplicatas: [{ numero: "001", vencimento: "2026-11-16", valor: "2850.00" }, { numero: "002", vencimento: "2026-12-16", valor: "2850.00" }],
  /** tPag 15 = boleto bancário; vPag = vNF (a soma dos vProd do cenário). */
  tPag: "15",
  /** O nome da forma de pagamento do seed que corresponde ao tPag 15 (a forma CERTA do cenário). */
  formaCerta: "Boleto"
} as const;

export interface ProdutoDoCenario { id: string; codigo: string; descricao: string }

/**
 * O cenário: a referência do seed, um fornecedor NOVO com o CNPJ do emitente, um Local e uma TOP de compra do caso
 * (o seed do E2E não tem TOP: os specs da importação criam a sua pela porta administrativa), os produtos e, para o
 * V, a COMPRA PRÉVIA que grava o vínculo lembrado (fator 6). Devolve a nota principal montada (não importada).
 *
 * `papeis` (o padrão: os 10, na ordem de `ITENS_DO_CENARIO`) escolhe os itens do caso: o nItem é a POSIÇÃO entre os
 * escolhidos (`itensDoCenario`, `nDo`). A nota principal (`nota`) leva a cobrança e o pagamento de
 * `COBRANCA_DO_CENARIO`; as premissas dos três números só valem para os 10 (a medição) — outro recorte monta as suas
 * notas por `notaDoCenario`, com a cobrança e o pagamento que o caso precisa.
 */
export async function cenarioDaXml04(page: Page, o: { papeis?: readonly string[] } = {}) {
  const escolhidos = o.papeis ? ITENS_DO_CENARIO.filter((i) => o.papeis!.includes(i.papel)) : [...ITENS_DO_CENARIO];
  expect(escolhidos.length, `premissa: cada papel pedido (${JSON.stringify(o.papeis ?? "todos")}) existe no cenário, uma vez`).toBe(o.papeis?.length ?? ITENS_DO_CENARIO.length);
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const portas = await api<{ capacidades?: Record<string, unknown> }>(page, "GET", "/api/compras/compras/operation-types");
  expect(portas.capacidades?.["importacaoXml"], "premissa: a API declara capacidades.importacaoXml = 1").toBe(1);
  const unidades = await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options");
  const unidadeDe = (simbolo: string): Opcao => {
    const achadas = unidades.filter((u) => u.label.trim().toUpperCase() === simbolo.toUpperCase());
    expect(achadas.map((u) => u.label), `premissa: o seed tem UMA unidade ${simbolo}`).toHaveLength(1);
    return achadas[0]!;
  };
  const formas = await api<Opcao[]>(page, "GET", "/api/resources/payment_methods/options");
  const formasCertas = formas.filter((f) => f.label.includes(COBRANCA_DO_CENARIO.formaCerta));
  expect(formasCertas.map((f) => f.label), `premissa: o seed tem UMA forma de pagamento "${COBRANCA_DO_CENARIO.formaCerta}"`).toHaveLength(1);
  const formaCerta = formasCertas[0]!;

  const rodada = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const tok = `X04${rodada}`;
  const emitente = cnpjDeEmitenteSintetico();
  const forn = await criarCadastro(page, "people", { name: uniq("XML04 forn"), person_type: "legal", is_provider: true, document: emitente });
  const arm = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `W${rodada.slice(-4)}`, description: uniq(`XML04 local ${rodada}`), type: "inputs" });
  const local = { id: arm.id, nome: String((await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${arm.id}`))["description"]) };
  const top = (await criarTop(page, { codigo: codigoTop("x4"), codigoBase: "compras.compra", nome: uniq("Compra XML04") })).id;

  const codigoDo = (papel: string) => `X04${papel}-${rodada}`;
  const itensDaNota: ItemDaNotaDaXml04[] = escolhidos.map((i) => ({
    codigo: codigoDo(i.papel), descricao: `XML04 INSUMO ${i.papel} ${tok}`, unidade: i.uCom, ncm: i.ncm,
    quantidade: i.quantidade, valorUnitario: i.valorUnitario, valorProdutos: i.valorProdutos
  }));

  // OS PRODUTOS: a unidade principal, a alternativa (a grade "Unidades e embalagens" da ficha) e, para os 9 primeiros,
  // a referência = o cProd. O V não tem referência: ele vem pelo vínculo lembrado.
  const produtos = new Map<number, ProdutoDoCenario>();
  for (const [k, i] of escolhidos.entries()) {
    const corpo: Record<string, unknown> = {
      description: `XML04 PRODUTO ${i.papel} ${tok}`, group_id: ref.grupo.id, measurement_id: unidadeDe(i.principal).id,
      financial_category_id: ref.natureza.id, ncm_code: i.ncm
    };
    if (i.grupo !== "vinculo") corpo["reference"] = codigoDo(i.papel);
    if (i.alternativa) corpo["unidades"] = [{ measurement_id: unidadeDe(i.alternativa.unidade).id, tipo_fator: "multiply", fator: i.alternativa.fator, uso_compra: true, uso_venda: true }];
    const criado = await criarCadastro(page, "products", corpo);
    const row = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${criado.id}`);
    const grade = Array.isArray(row["unidades"]) ? (row["unidades"] as Record<string, unknown>[]) : [];
    expect([row["measurement_id"], row["reference"] ?? null, grade.map((u) => [u["measurement_id"], u["tipo_fator"], D(String(u["fator"])).toFixed(), u["uso_compra"]])],
      `premissa: o produto do ${i.papel} gravou a unidade principal, a referência e a grade de unidades declaradas`)
      .toEqual([unidadeDe(i.principal).id, i.grupo === "vinculo" ? null : codigoDo(i.papel),
        i.alternativa ? [[unidadeDe(i.alternativa.unidade).id, "multiply", D(i.alternativa.fator).toFixed(), true]] : []]);
    produtos.set(k + 1, { id: criado.id, codigo: String(row["code"] ?? ""), descricao: String(row["description"]) });
  }

  // O VÍNCULO LEMBRADO DO V (só quando o recorte tem o V): uma nota PRÉVIA do mesmo emitente com o item do V (mesmo
  // cProd, mesmo uCom), importada e gerada pela API — a mesma porta da tela — com o fator 6 e `lembrar_vinculo`. Quem
  // grava o vínculo é o servidor.
  const nV = escolhidos.findIndex((i) => i.grupo === "vinculo") + 1;
  let compraPrevia: string | null = null;
  if (nV > 0) {
    const iV = escolhidos[nV - 1]!;
    const produtoV = produtos.get(nV)!;
    const previa = notaSinteticaDeVariosItens({
      emitenteCnpj: emitente, emitenteNome: `Emitente sintético ${uniq("XML04")}`,
      itens: [{ codigo: codigoDo(iV.papel), descricao: `XML04 INSUMO ${iV.papel} ${tok}`, unidade: iV.uCom, ncm: iV.ncm, ean: null, quantidade: "2", valorUnitario: iV.valorUnitario, valorProdutos: D(iV.valorUnitario).times(2).toFixed(2) }]
    });
    const impPrevia = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", {
      nome_arquivo: `nfe-${previa.numero}.xml`, arquivo_base64: Buffer.from(previa.xml, "utf8").toString("base64"), empresa_id: empresa
    });
    const gerada = await api<{ id: string; situacao: string }>(page, "POST", `/api/compras/importacoes/${impPrevia.id}/gerar-compra`, {
      tipo_operacao_id: top, fornecedor_id: forn.id,
      financeiro: { parcelas: "nota", rateio: { tipo: "documento", categoria_financeira_id: ref.natureza.id, centro_custo_id: ref.centro.id } },
      itens: [{ n_item: 1, produto_id: produtoV.id, fator: iV.fatorDoVinculo, tipo_fator: "multiply", lembrar_vinculo: true, armazem_id: local.id }]
    });
    expect(gerada.situacao, "premissa: a compra prévia (a que grava o vínculo lembrado do V) nasceu aberta").toBe("aberto");
    compraPrevia = gerada.id;
  }

  const base = { empresa, ref, unidadeDe, formaCerta, rodada, tok, emitente, fornecedor: forn.id, local, top, produtos, codigoDo, compraPrevia, itensDoCenario: escolhidos, itensDaNota };
  const vNF = deCentavos(escolhidos.reduce((a, i) => a + inteiroEscalado(i.valorProdutos, 2), 0n));
  const nota = notaDoCenario(base, { pagamentos: [COBRANCA_DO_CENARIO.tPag] });
  expect(nota.vNF, "premissa: o vNF é a soma dos vProd do cenário").toBe(vNF);
  if (!o.papeis) {
    expect(new Set([nota.somaDasDuplicatas, nota.vLiq, nota.vNF]).size, "premissa: Σ duplicatas, líquido e total são três números distintos").toBe(3);
    expect(D(nota.somaDasDuplicatas).minus(D(nota.vLiq)).abs().gt(D("0.01")), "premissa: as duplicatas NÃO fecham com o líquido (mais de R$ 0,01)").toBe(true);
  }
  return { ...base, nota };
}
export type CenarioDaXml04 = Awaited<ReturnType<typeof cenarioDaXml04>>;
type BaseDoCenario = Pick<CenarioDaXml04, "emitente" | "itensDaNota">;

/** O nItem do papel na nota do cenário (a posição entre os escolhidos), ou o teste reprova. */
export function nDo(c: Pick<CenarioDaXml04, "itensDoCenario">, papel: string): number {
  const n = c.itensDoCenario.findIndex((i) => i.papel === papel) + 1;
  expect(n, `premissa: o recorte do cenário tem o papel ${papel}`).toBeGreaterThan(0);
  return n;
}

/** As duplicatas que SOMAM exatamente `total` (em `partes` parcelas, a última com o resto dos centavos), vencendo no dia 16 de cada mês a partir de 11/2026. */
export function duplicatasQueSomam(total: string, partes = 2): DuplicataDaNota[] {
  const centavos = inteiroEscalado(total, 2);
  const parte = centavos / BigInt(partes);
  return Array.from({ length: partes }, (_, k) => ({
    numero: String(k + 1).padStart(3, "0"), vencimento: new Date(Date.UTC(2026, 10 + k, 16)).toISOString().slice(0, 10),
    valor: deCentavos(k === partes - 1 ? centavos - parte * BigInt(partes - 1) : parte)
  }));
}

/**
 * OUTRA NOTA DO MESMO CENÁRIO (o mesmo emitente, os mesmos itens: os mesmos produtos e o mesmo vínculo), com a cobrança
 * e o pagamento que o caso pede: `pagamentos` são os tPag dos `<detPag>` (cada um com vPag = vNF; vazio = nenhum
 * `<detPag>`); sem `duplicatas`/`descontoDaFatura`, as de `COBRANCA_DO_CENARIO`. Outro número, outra chave.
 */
export function notaDoCenario(c: BaseDoCenario, o: { pagamentos: readonly string[]; duplicatas?: DuplicataDaNota[]; descontoDaFatura?: string }): NotaDaXml04 {
  const vNF = deCentavos(c.itensDaNota.reduce((a, i) => a + inteiroEscalado(i.valorProdutos, 2), 0n));
  return notaDaXml04({
    emitenteCnpj: c.emitente, emitenteNome: `Emitente sintético ${uniq("XML04")}`, itens: c.itensDaNota,
    descontoDaFatura: o.descontoDaFatura ?? COBRANCA_DO_CENARIO.descontoDaFatura, duplicatas: o.duplicatas ?? [...COBRANCA_DO_CENARIO.duplicatas],
    pagamentos: o.pagamentos.map((tPag) => ({ tPag, vPag: vNF }))
  });
}

/** A nota importada pela API (a mesma porta da tela), na empresa do cenário. Devolve o id da importação. */
export async function importarNotaDaXml04(page: Page, c: Pick<CenarioDaXml04, "empresa">, nota: NotaDaXml04): Promise<string> {
  const imp = await api<{ id: string }>(page, "POST", "/api/compras/importacoes", {
    nome_arquivo: `nfe-${nota.numero}.xml`, arquivo_base64: Buffer.from(nota.xml, "utf8").toString("base64"), empresa_id: c.empresa
  });
  return imp.id;
}

/* ═════════════════════════════════ o banco (só SELECT) ═════════════════════════════════ */

const BANCO = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Uma leitura do banco do E2E (o mesmo `psql` de `xml-02-comum.ts`). A falha sai SEM a conexão na mensagem. */
function lerDoBanco(consulta: string): string {
  try {
    return execFileSync("psql", [BANCO, "-v", "ON_ERROR_STOP=1", "-Atc", consulta], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (erro) {
    const saida = String((erro as { stderr?: unknown }).stderr ?? "").replace(/postgres(ql)?:\/\/\S+/gi, "<conexão>");
    throw new Error(`a leitura do banco do E2E falhou: ${saida.slice(0, 300)}`);
  }
}

/**
 * A TESTEMUNHA do vínculo lembrado que a compra prévia gravou: `produto|tipo|fator` do fornecedor + código + unidade
 * (o UUID e o código conferidos antes de entrar na consulta). Vazio = nenhum vínculo.
 */
export function vinculoLembrado(fornecedorId: string, codigo: string, unidade: string): string {
  expect(fornecedorId, "premissa: o fornecedor do caso é um UUID (entra na consulta)").toMatch(UUID);
  expect(`${codigo}|${unidade}`, "premissa: o código e a unidade do vínculo são do cenário (entram na consulta)").toMatch(/^[A-Z0-9-]+\|[A-Z]+$/);
  return lerDoBanco(`select produto_id::text || '|' || tipo_fator || '|' || trim(trailing '.' from trim(trailing '0' from fator::text))
    from erp.produto_fornecedor_vinculos where fornecedor_id = '${fornecedorId}' and codigo_fornecedor = '${codigo}' and unidade_fornecedor = '${unidade}'`);
}

/** O fator como o banco o guarda (numeric(18,6)) sem os zeros à direita: "12.000000" → "12". */
const SEM_ZEROS = (coluna: string) => `trim(trailing '.' from trim(trailing '0' from ${coluna}::text))`;

/** TODOS os vínculos lembrados do fornecedor, `código|unidade|produto|tipo|fator`, em ordem — a testemunha do que o Gerar gravou. */
export function vinculosDoFornecedor(fornecedorId: string): string[] {
  expect(fornecedorId, "premissa: o fornecedor do caso é um UUID (entra na consulta)").toMatch(UUID);
  const linhas = lerDoBanco(`select codigo_fornecedor || '|' || unidade_fornecedor || '|' || produto_id::text || '|' || tipo_fator || '|' || ${SEM_ZEROS("fator")}
    from erp.produto_fornecedor_vinculos where fornecedor_id = '${fornecedorId}' order by 1`);
  return linhas ? linhas.split("\n") : [];
}

/** A compra GRAVADA: a forma de pagamento do documento e, por item da nota, `nItem|produto|tipo|fator`. */
export function compraNoBanco(compraId: string): { forma: string | null; itens: string[] } {
  expect(compraId, "premissa: a compra é um UUID (entra na consulta)").toMatch(UUID);
  const forma = lerDoBanco(`select coalesce(forma_pagamento_id::text, '') from erp.documentos_compra where id = '${compraId}'`);
  const itens = lerDoBanco(`select n_item_nota::text || '|' || produto_id::text || '|' || tipo_fator_conversao || '|' || ${SEM_ZEROS("fator_conversao")}
    from erp.documentos_compra_itens where documento_id = '${compraId}' order by n_item_nota`);
  return { forma: forma === "" ? null : forma, itens: itens ? itens.split("\n") : [] };
}

/** As ligações VIVAS do código tPag (todas as organizações do banco do E2E), `id|organização|forma`. */
export function ligacoesVivasDoCodigo(codigo: string): string[] {
  expect(codigo, "premissa: o código tPag tem 2 dígitos (entra na consulta)").toMatch(/^\d{2}$/);
  const linhas = lerDoBanco(`select id::text || '|' || organization_id::text || '|' || forma_pagamento_id::text from erp.formas_pagamento_da_nfe where codigo_tpag = '${codigo}' and deleted_at is null order by 1`);
  return linhas ? linhas.split("\n") : [];
}

/** A ligação pelo id: `codigo|organização|forma|organização da forma ('sistema' quando nula)|excluída(sim/nao)`. */
export function ligacaoNoBanco(id: string): string {
  expect(id, "premissa: a ligação é um UUID (entra na consulta)").toMatch(UUID);
  return lerDoBanco(`select l.codigo_tpag || '|' || l.organization_id::text || '|' || l.forma_pagamento_id::text || '|' || coalesce(f.organization_id::text, 'sistema') || '|' || case when l.deleted_at is null then 'nao' else 'sim' end
    from erp.formas_pagamento_da_nfe l join erp.payment_methods f on f.id = l.forma_pagamento_id where l.id = '${id}'`);
}

/* ═════════════════════════════════ a ligação tPag → forma (fixture do caso) ═════════════════════════════════ */

const API_DO_E2E = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
/** O cadastro da ligação no domínio desta árvore (`null` = a árvore não tem a XML-04: nada se liga). */
export const CADASTRO_DA_LIGACAO = "formas_pagamento_da_nfe";
export const cadastroDaLigacaoNoDominio = (): string | null => (getResource(CADASTRO_DA_LIGACAO) ? CADASTRO_DA_LIGACAO : null);

/** As ligações que o caso criou, desligadas (exclusão lógica pela porta do cadastro) no fim do caso. */
export class LigacoesDoCaso {
  private readonly criadas: { id: string; codigo: string }[] = [];
  constructor(private readonly page: Page) {}

  /**
   * Liga o código `codigo` à forma `formaId` pela porta do cadastro (`POST /api/resources/formas_pagamento_da_nfe`) e
   * confere no banco o que ficou gravado. Premissa: o código não tem ligação viva (uma sobra REPROVA, com o id dela).
   */
  async ligar(codigo: string, formaId: string): Promise<string> {
    expect(ligacoesVivasDoCodigo(codigo), `premissa: o código ${codigo} não tem ligação viva no banco do E2E (sobra de uma execução anterior?)`).toEqual([]);
    const criada = await api<{ id: string }>(this.page, "POST", `/api/resources/${CADASTRO_DA_LIGACAO}`, { codigo_tpag: codigo, forma_pagamento_id: formaId });
    expect(criada.id, `premissa: a ligação do código ${codigo} foi criada`).toBeTruthy();
    this.registrar(criada.id, codigo);
    expect(ligacaoNoBanco(criada.id).split("|").filter((_, k) => k === 0 || k === 2 || k === 4), `premissa: o banco gravou a ligação ${codigo} → a forma pedida, viva`)
      .toEqual([codigo, formaId, "nao"]);
    return criada.id;
  }

  /** Uma ligação criada por OUTRA porta (a tela do cadastro): registrada para sair no fim do caso. */
  registrar(id: string, codigo: string) { this.criadas.push({ id, codigo }); }

  /** Desliga tudo o que o caso ligou (ordem inversa); junta as falhas e só no fim reprova. */
  async desligarTudo() {
    const pendentes = [...this.criadas].reverse();
    this.criadas.length = 0;
    if (pendentes.length === 0) return;
    const falhas: string[] = [];
    let cabecalhos: Record<string, string> | null = null;
    try { cabecalhos = await cabecalhosDaSessao(this.page); } catch (e) { falhas.push(`credencial da sessão: ${e instanceof Error ? e.message : String(e)}`); }
    for (const l of pendentes) {
      if (!cabecalhos) { falhas.push(`ligação ${l.codigo} ${l.id}: não desligada (sem a credencial da sessão)`); continue; }
      // Sem content-type: o DELETE vai sem corpo (a mesma chamada da limpeza da Central).
      const r = await this.page.request.fetch(`${API_DO_E2E}/api/resources/${CADASTRO_DA_LIGACAO}/${l.id}`, { method: "DELETE", headers: cabecalhos });
      if (!r.ok()) falhas.push(`ligação ${l.codigo} ${l.id}: ${r.status()} ${(await r.text()).slice(0, 200)}`);
    }
    expect(falhas, "a limpeza desligou todas as ligações tPag que o caso criou").toEqual([]);
  }
}

/** O `test` da XML-04: o da Central (com a limpeza dos cadastros) e a fixture `ligacoes` (desligadas no fim do caso). */
export const test = testDaCentral.extend<{ ligacoes: LigacoesDoCaso }>({
  ligacoes: async ({ page }, use) => {
    const l = new LigacoesDoCaso(page);
    await use(l);
    await l.desligarTudo();
  }
});
export { expect };

/* ═════════════════════════════════ o que é NOVO da XML-04 no fio (lido só quando existe) ═════════════════════════════════ */

/**
 * As propriedades da XML-04 que a medição procura — os nomes REAIS do contrato da fatia (`packages/domain/src/
 * nfe-compra.ts`: `FatorDoItemDaNota`, `FormaDePagamentoDaConferencia`, `ParcelasDaNota`). NENHUMA existe na base; cada
 * uma é usada SÓ quando a resposta a tem como propriedade PRÓPRIA. Mudou o nome no contrato? Mude AQUI (e só aqui).
 */
export const CAMPOS_NOVOS_DA_XML04 = {
  /**
   * `itens[].vinculo.fatorPelaNota`: `origem` ("unidade_principal" | "unidade_do_produto" | "vinculo" | "pergunta") e
   * `unidadeDaNota`; no `vinculo`, `cadastro` (o fator DIFERENTE que o cadastro respalda, ou null); na `pergunta`,
   * `motivo`. E1 (b) e (c4).
   */
  fatorPelaNota: "fatorPelaNota",
  /** `financeiro.forma.situacao` ("ligada" | "sem_ligacao" | "forma_inativa" | "varias" | "sem_tpag"). Marca o mundo (E2 é lido na TELA). */
  forma: "forma",
  /** `financeiro.parcelas.total` / `financeiro.parcelas.falhas`: só marcam o mundo (E3 e E3b são lidos na TELA). */
  parcelasTotal: "total", parcelasFalhas: "falhas"
} as const;

/**
 * Os data-testid NOVOS da tela da XML-04 (acréscimo declarado; nenhum existe na base). E1 (c2) os acha pela regra de
 * sempre (o cartão do item, "fator" + aviso); E3b, pelo prefixo `importacao-parcelas-`; o resto é dos casos da tela.
 */
export const TESTIDS_DA_XML04 = {
  /** Perto do Fator: de onde ele veio (`data-origem`: unidade_principal | unidade_do_produto | vinculo | informado). */
  fatorOrigem: (n: number) => `importacao-item-${n}-fator-origem`,
  /** O fator a informar: o porquê (o campo nasce vazio). */
  fatorPergunta: (n: number) => `importacao-item-${n}-fator-pergunta`,
  /** O vínculo lembrado contra o cadastro: os dois números. */
  fatorAviso: (n: number) => `importacao-item-${n}-fator-aviso`,
  /** Os três números das duplicatas que não servem. */
  parcelasNumeros: "importacao-parcelas-numeros",
  /** Cada comparação que falhou, com a diferença (`data-falha`). */
  parcelasFalha: "importacao-parcelas-falha",
  /** De onde veio a forma (a nota, o padrão da TOP). */
  formaOrigem: "importacao-forma-origem",
  /** O porquê do campo da forma vazio. */
  formaPergunta: "importacao-forma-pergunta",
  /** A TOP venceu a forma da nota (ou a escolha da pessoa): as duas. */
  formaAviso: "importacao-forma-aviso",
  /** No invólucro `importacao-forma` (que já existe): `data-origem` (operador | nota | top | pergunta) e `data-travado-pela-top`. */
  formaAtributoOrigem: "data-origem", formaAtributoTrava: "data-travado-pela-top"
} as const;

/** Reexporta os asserts da aba Itens sem fator/conversão (mesmo contrato da XML-02). */
export { CAMPOS_AVANCADOS_REMOVIDOS_DO_ITEM, expectCamposAvancadosAusentes, quantidadeNotaBR } from "./xml-02-comum";

/** Fator que o corpo do Gerar leva com a tela sem campo (estado válido ou "1"). */
export function fatorNoCorpoDoItem(item: ItemDoCenario, vinculo?: { fator?: string | null }) {
  if (item.grupo === "fora_do_cadastro" || item.grupo === "principal") return "1";
  if (item.grupo === "alternativa") return item.alternativa!.fator;
  if (item.grupo === "vinculo") return item.fatorDoVinculo!;
  const f = vinculo?.fator;
  return f && /^\d/.test(String(f)) ? D(String(f)).toFixed() : "1";
}

/** Uma marca de "confira o fator" numa propriedade booleana do `fatorPelaNota` (E1 (c), pelo fio). */
const NOME_DE_AVISO = /diverg|confer|confira|aviso/i;

/** As marcas da XML-04 presentes na RESPOSTA da conferência (vazio = o mundo de hoje). */
export function marcasDaXml04NoFio(conf: unknown): string[] {
  const marcas: string[] = [];
  const itens = propria(conf, "itens");
  if (Array.isArray(itens) && itens.some((i) => propria(propria(i, "vinculo"), CAMPOS_NOVOS_DA_XML04.fatorPelaNota) !== undefined)) marcas.push("itens[].vinculo.fatorPelaNota");
  const financeiro = propria(conf, "financeiro");
  if (propria(financeiro, CAMPOS_NOVOS_DA_XML04.forma) !== undefined) marcas.push("financeiro.forma");
  const parcelas = propria(financeiro, "parcelas");
  if (propria(parcelas, CAMPOS_NOVOS_DA_XML04.parcelasTotal) !== undefined) marcas.push("financeiro.parcelas.total");
  if (propria(parcelas, CAMPOS_NOVOS_DA_XML04.parcelasFalhas) !== undefined) marcas.push("financeiro.parcelas.falhas");
  return marcas;
}

/** De onde veio o fator do item, e se a origem saiu do FIO (o mundo novo) ou da regra de hoje (a base). */
export interface OrigemDoFator { origem: string; doFio: boolean; avisoNoFio: string | null }

/**
 * A ORIGEM DO FATOR de um vínculo:
 *  · mundo novo — `vinculo.fatorPelaNota.origem` (texto), quando existe; o AVISO no fio (E1 (c4)) é a marca que manda
 *    conferir o fator: uma propriedade booleana verdadeira com nome de aviso (`NOME_DE_AVISO`) ou — o nome REAL do
 *    contrato da XML-04 — o `cadastro` (objeto) do `vinculo`, que só vem quando o cadastro respalda OUTRO fator;
 *  · mundo de hoje — lembrado → "vinculo"; sugerido pelo código do fornecedor ou pelo código de barras → "cadastro"
 *    (a unidade do cadastro do produto); sugerido pela referência ou pela descrição → "chute" (o `FATOR_SEM_UNIDADE`
 *    do servidor, sempre 1); nenhum/ambíguo → "chute" (o "1" com que a tela nasce, `decisaoDoVinculo`).
 */
export function origemDoFator(vinculo: unknown): OrigemDoFator {
  const fpn = propria(vinculo, CAMPOS_NOVOS_DA_XML04.fatorPelaNota);
  if (ehObjeto(fpn) && typeof fpn["origem"] === "string") {
    const booleano = Object.entries(fpn).find(([k, v]) => NOME_DE_AVISO.test(k) && v === true)?.[0] ?? null;
    const doCadastro = fpn["origem"] === "vinculo" && ehObjeto(fpn["cadastro"]) ? "cadastro" : null;
    return { origem: fpn["origem"], doFio: true, avisoNoFio: booleano ?? doCadastro };
  }
  const situacao = propria(vinculo, "situacao");
  const origem = propria(vinculo, "origem");
  if (situacao === "lembrado") return { origem: "vinculo", doFio: false, avisoNoFio: null };
  if (situacao === "sugerido" && (origem === "codigo_fornecedor" || origem === "codigo_barras")) return { origem: "cadastro", doFio: false, avisoNoFio: null };
  return { origem: "chute", doFio: false, avisoNoFio: null };
}

/** O fator NÃO tem respaldo (nem cadastro nem vínculo)? Mundo novo: origem "pergunta". Hoje: o "chute". */
export const fatorSemRespaldo = (o: OrigemDoFator) => (o.doFio ? o.origem === "pergunta" : o.origem === "chute");

/* ═════════════════════════════════ o contador de gestos (E4) ═════════════════════════════════ */

/**
 * O CONTADOR ÚNICO DOS GESTOS DO OPERADOR: toda ação do "operador mínimo" passa por aqui — click, fill, selectOption,
 * check e a tecla (`press`: o Enter que confirma a data digitada no calendário do sistema, `MgDatePicker`) —, executa e
 * só então registra (`tipo:alvo`). O que não passa por aqui (leituras, esperas, a medição) não é gesto.
 * E4 = `lista.length`.
 */
export class Gestos {
  readonly lista: string[] = [];
  private registrar(tipo: "click" | "fill" | "selectOption" | "check" | "press", alvo: string) {
    this.lista.push(`${tipo}:${alvo}`);
  }
  async click(l: Locator, alvo: string) { await l.click(); this.registrar("click", alvo); }
  async fill(l: Locator, valor: string, alvo: string) { await l.fill(valor); this.registrar("fill", `${alvo}=${valor}`); }
  async selectOption(l: Locator, valor: string, alvo: string) { await l.selectOption(valor); this.registrar("selectOption", alvo); }
  async check(l: Locator, alvo: string) { await l.check(); this.registrar("check", alvo); }
  async press(l: Locator, tecla: string, alvo: string) { await l.press(tecla); this.registrar("press", `${alvo}=${tecla}`); }
  get total() { return this.lista.length; }
}

/** "2026-11-16" → "16/11/2026" (o que se digita no calendário do sistema). */
export const dataComoSeDigita = (iso: string) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a}`; };

/**
 * Um seletor de referência dentro de `container`, CONTANDO: abrir a caixa (click), digitar a busca (fill) e escolher a
 * ÚNICA opção que contém `rotulo` (click) — 3 gestos. No fim, a caixa mostra a escolha.
 */
export async function escolherNoSeletorContando(page: Page, g: Gestos, container: Locator, rotulo: string, nome: string) {
  await g.click(container.getByRole("combobox"), `${nome}: abrir o seletor`);
  const pesquisa = page.getByRole("textbox", { name: "Pesquisar opção" });
  await expect(pesquisa, `${nome}: o seletor abriu com a pesquisa`).toBeVisible();
  await g.fill(pesquisa, rotulo, `${nome}: busca`);
  const opcao = page.getByRole("listbox").getByRole("option", { name: new RegExp(escapar(rotulo)) });
  await expect(opcao, `${nome}: a busca oferece UMA opção "${rotulo}"`).toHaveCount(1);
  await g.click(opcao, `${nome}: escolher`);
  await expect(container.getByRole("combobox"), `${nome}: a caixa ficou com a escolha`).toContainText(rotulo);
}

/** A caixa de um seletor de referência está VAZIA? (o gatilho `cmd-display` leva `is-empty` sem valor). */
export async function seletorVazio(container: Locator): Promise<boolean> {
  const caixa = container.getByRole("combobox");
  await expect(caixa).toBeVisible();
  return /\bis-empty\b/.test((await caixa.getAttribute("class")) ?? "");
}

/* ═════════════════════════════════ E3: os números na tela ═════════════════════════════════ */

/** O texto com os espaços especiais da formatação de moeda (NBSP, NNBSP) trocados por espaço comum. */
export const textoNormalizado = (t: string) => t.replace(/[  ]/g, " ");

/** "5700.00" → "5.700,00" (o número como o `brl` da tela o escreve, sem o "R$"). */
export function comoATelaEscreve(valor: string): string {
  const [inteiro, fracao = "00"] = D(valor).toFixed(2).split(".");
  return `${inteiro!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fracao}`;
}

/** As formas de um número no texto: formatado como dinheiro ("R$ 5.700,00" ou "5.700,00") ou cru ("5700.00"). */
export function formasDoNumeroNoTexto(texto: string, valor: string): ("formatado" | "cru")[] {
  const t = textoNormalizado(texto);
  const formas: ("formatado" | "cru")[] = [];
  if (new RegExp(`(^|[^\\d.,])${escapar(comoATelaEscreve(valor))}(?![\\d])`).test(t)) formas.push("formatado");
  if (new RegExp(`(^|[^\\d.,])${escapar(D(valor).toFixed(2))}(?![\\d])`).test(t)) formas.push("cru");
  return formas;
}

/* ═════════════════════════════════ E3b: a explicação das duplicatas ═════════════════════════════════ */

/**
 * AS COMPARAÇÕES DA REGRA DAS DUPLICATAS (`parcelasDaNota`, que a XML-04 NÃO muda) sobre os números do cenário, contadas
 * AQUI, pelo teste, sem perguntar à tela nem ao servidor: Σ vDup × líquido e líquido × total, cada uma FALHA quando a
 * diferença passa de R$ 0,01 (a tolerância da regra). `diferenca` é o valor absoluto, em 2 casas.
 */
export function comparacoesDasDuplicatas(n: { somaDasDuplicatas: string; liquido: string; totalDaCompra: string }) {
  const tolerancia = D("0.01");
  const soma = D(n.somaDasDuplicatas).minus(D(n.liquido)); const liq = D(n.liquido).minus(D(n.totalDaCompra));
  return [
    { codigo: "soma_diferente_do_liquido", falhou: soma.abs().gt(tolerancia), diferenca: soma.abs().toFixed(2) },
    { codigo: "liquido_diferente_do_total", falhou: liq.abs().gt(tolerancia), diferenca: liq.abs().toFixed(2) }
  ] as const;
}

/* ═════════════════════════════════ os detectores do mundo da base (skew) ═════════════════════════════════ */

/**
 * As marcas da XML-04 no fonte: a da API (a conferência monta `fatorPelaNota`) e a da tela (testid da origem da
 * forma de pagamento, `importacao-forma-origem` — sobrevive à importação enxuta; o antigo `fator-origem` saiu da
 * aba Itens). Lidas do FONTE do commit (`fonteDoCommitContem`, de `xml-02-comum.ts`: reprova quando não consegue
 * ler — nunca vira "não tem").
 */
export const MARCA_DA_XML04 = { api: "fatorPelaNota", web: "importacao-forma-origem" } as const;

/** Dois commits FIXOS, um por mundo. Nenhum é a base desta execução: ela muda a cada PR e só exercitaria o ramo dela. */
export const COMMITS_DA_XML04 = {
  /** A main com a XML-02 mesclada (#127), a base da branch da XML-04: sem a XML-04. */
  sem: "332918798b039a0b2cf61c9334c30644a167e532",
  /** O commit da XML-04 na branch `claude/xml-04-fator-forma-e-vencimento` (a API, o domínio e a tela da fatia). */
  com: "9abd33dedba94ce7fbd2b4aed552b9cae8424b7a"
} as const;

/** A API do commit (por padrão, a base desta execução) já monta o `fatorPelaNota`? */
export const apiDaBaseTemAXml04 = (sha: string = shaDaBase()) => fonteDoCommitContem(sha, MARCA_DA_XML04.api, "apps/api/src");
/** O web do commit (por padrão, a base desta execução) já diz a origem do fator? */
export const webDaBaseTemAXml04 = (sha: string = shaDaBase()) => fonteDoCommitContem(sha, MARCA_DA_XML04.web, "apps/web/src");

/* ═════════════════════════════════ a conferência na tela ═════════════════════════════════ */

export interface VinculoNoFioDaXml04 {
  situacao: string; origem?: string; produto?: { id: string }; fator?: string; tipoFator?: string;
  fatorPelaNota?: { origem: string; unidadeDaNota: string; cadastro?: { fator: string; tipoFator: string } | null; motivo?: string };
}
export interface ConferenciaNoFioDaXml04 {
  id: string; situacao: string; empresa: { id: string }; fornecedorEscolhido: string | null; parceiro: { situacao: string; id?: string };
  nota: { itens: { nItem: number; codigo: string; unidade: string; quantidade: string }[]; totais: { nota: string };
    fatura: { liquido: string | null } | null; duplicatas: { numero: string; vencimento: string; valor: string }[] };
  itens: { nItem: number; vinculo: VinculoNoFioDaXml04 }[];
  divergencias: { codigo: string; mensagem: string; nItem: number | null; bloqueia: boolean }[];
  financeiro: { parcelas: Record<string, unknown> & { situacao: string }; forma?: Record<string, unknown> & { situacao: string } };
}

/** O vínculo do item `n` na conferência do fio, ou o teste reprova. */
export function vinculoNoFio(conf: Pick<ConferenciaNoFioDaXml04, "itens">, n: number): VinculoNoFioDaXml04 {
  const i = conf.itens.find((x) => x.nItem === n);
  expect(i, `premissa: a conferência traz o vínculo do item ${n}`).toBeTruthy();
  return i!.vinculo;
}

/**
 * Abre a conferência e devolve a resposta do GET que a PRÓPRIA tela fez (o fio). Com `top`, escolhe a TOP na aba
 * Cabeçalho. Termina na aba Cabeçalho.
 */
export async function abrirConferenciaDaXml04(page: Page, id: string, top?: string): Promise<ConferenciaNoFioDaXml04> {
  const leitura = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === `/api/compras/importacoes/${id}`, { timeout: 20_000 });
  await page.goto(`/compras/importacoes/${id}`);
  const resposta = await leitura;
  expect(resposta.status(), "a tela leu a conferência (200)").toBe(200);
  const conf = (await resposta.json()) as ConferenciaNoFioDaXml04;
  const raiz = page.getByTestId("importacao-conferencia");
  await expect(raiz, "a conferência desenhou, pendente").toHaveAttribute("data-situacao", "pendente");
  await expect(raiz).toHaveAttribute("data-relendo", "nao");
  await expect(page.getByText("A resposta do servidor não é a conferência que esta tela sabe ler."), "a tela leu a conferência").toHaveCount(0);
  await expect(page.getByTestId("importacao-aba-cabecalho"), "a conferência abre no Cabeçalho").toBeVisible();
  if (top) {
    await page.getByTestId("importacao-top").selectOption(top);
    await expect(page.getByTestId("importacao-top")).toHaveValue(top);
  }
  return conf;
}

/** Vai para a aba `aba` da conferência (pelo rótulo) e espera ela abrir. */
export async function irParaAba(page: Page, aba: "cabecalho" | "itens" | "pedido" | "financeiro" | "divergencias") {
  await page.getByTestId(`importacao-aba-${aba}-rotulo`).click();
  await expect(page.getByTestId(`importacao-aba-${aba}`), `a aba ${aba} abriu`).toBeVisible();
}

/** Os testids NOVOS da XML-04 presentes na página agora (vazio = a tela de hoje). */
export async function testidsDaXml04NaTela(page: Page): Promise<string[]> {
  const todos = await page.locator("[data-testid]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
  const t = TESTIDS_DA_XML04;
  const fixos: string[] = [t.parcelasNumeros, t.parcelasFalha, t.formaOrigem, t.formaPergunta, t.formaAviso];
  return todos.filter((x) => fixos.includes(x) || /^importacao-item-\d+-fator-(origem|pergunta|aviso)$/.test(x));
}

/**
 * Conta, NO FIO, os pedidos às portas da TOP (`/regras-da-operacao`, `/layout-efetivo`) feitos ENQUANTO a página é a
 * conferência `id` (a consulta da compra que abre depois do "Gerar compra" não conta). O controle POSITIVO do contador
 * é o X4-T1 (web e API deste HEAD: a conferência que declara a forma da nota pergunta a TOP); o sentido 1 do skew cobra
 * ZERO com a API da base.
 */
export function contarPedidosDaTop(page: Page, id: string): string[] {
  const pedidos: string[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (!/\/(regras-da-operacao|layout-efetivo)$/.test(p)) return;
    if (new URL(page.url()).pathname === `/compras/importacoes/${id}`) pedidos.push(`${r.method()} ${p}`);
  });
  return pedidos;
}
