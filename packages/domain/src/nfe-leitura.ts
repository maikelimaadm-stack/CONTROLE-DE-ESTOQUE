/**
 * OPERACOES-01 F7 (decisão 284) — A LEITURA DA NF-e PROCESSADA (modelo 55), no SERVIDOR.
 *
 * Recebe o TEXTO do XML e devolve a nota lida (`NotaFiscalLida`, decimais em string) ou TODAS as recusas que couberem,
 * cada uma com o motivo, a mensagem PT-BR e o caminho no XML. Só entra:
 *
 *   · `nfeProc` com `NFe/infNFe` e `protNFe/infProt` (a nota autorizada, com o protocolo);
 *   · `cStat` 100 (autorizada) ou 150 (autorizada fora do prazo); `ide/mod` 55; `ide/tpAmb` 1 (produção);
 *   · chave: `infNFe/@Id` = "NFe" + 44 dígitos, DV (módulo 11) certo, posições 21-22 = "55", e `infProt/chNFe` igual;
 *   · `ide/finNFe` 4 (devolução) fica FORA desta entrega (`devolucao_fora`);
 *   · emitente e destinatário com CNPJ/CPF válido (`validarDocumento`); destinatário estrangeiro é recusado;
 *   · ao menos um `det`; decimais no formato da NF-e (valores em dinheiro com até 2 casas); datas AAAA-MM-DD válidas.
 *
 * Lê também o rastro (lote) de cada item, a fatura e as duplicatas (`cobr`), o pedido do item (`xPed`/`nItemPed`) e o
 * do cabeçalho (`compra/xPed`). ICMS-ST do item = `vICMSST` + `vFCPST` do grupo de ICMS do item; ICMS-ST do total =
 * `vST` + `vFCPST`. Valor opcional ausente vale "0.00".
 *
 * FUNÇÃO PURA: sem DOM, sem Node, sem relógio. Nada de ponto flutuante: os números ficam como texto decimal.
 */
import { D, money } from "@agro/shared";
import { validarDocumento } from "./documento.js";
import { filho, filhosChamados, lerXml, textoEm, type NoXml } from "./xml-leitor.js";

export const CSTAT_AUTORIZADA = ["100", "150"] as const;

const PESOS_DA_CHAVE = [2, 3, 4, 5, 6, 7, 8, 9] as const;

/** DV da chave de acesso: módulo 11 sobre as 43 posições, pesos 2..9 a partir da DIREITA; resto 0 ou 1 → 0. */
export function digitoDaChaveDeAcesso(chave43: string): number {
  if (!/^\d{43}$/.test(chave43)) throw new RangeError("a chave sem o DV tem 43 dígitos");
  let soma = 0;
  for (let k = 0; k < 43; k++) soma += Number(chave43[42 - k]) * PESOS_DA_CHAVE[k % 8]!;
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** 44 dígitos e o DV certo. Não confere o modelo (a compra manual aceita outros documentos com chave). */
export function chaveDeAcessoValida(chave: string): boolean {
  return /^\d{44}$/.test(chave) && digitoDaChaveDeAcesso(chave.slice(0, 43)) === Number(chave[43]);
}

/** Chave em grupos de 4 dígitos, para a tela. Texto fora do formato volta como veio. */
export function formatarChaveDeAcesso(chave: string): string {
  return /^\d{44}$/.test(chave) ? chave.replace(/(\d{4})(?=\d)/g, "$1 ") : chave;
}

export type MotivoDaRecusaNfe =
  | "xml_invalido" | "xml_inseguro" | "xml_grande" | "nao_e_nfe_processada" | "sem_protocolo"
  | "nao_autorizada" | "modelo_nao_aceito" | "ambiente_homologacao" | "chave_invalida" | "chave_divergente" | "devolucao_fora"
  | "emitente_invalido" | "destinatario_invalido" | "sem_itens" | "valor_invalido" | "data_invalida";

export const MENSAGEM_DA_RECUSA_NFE: Readonly<Record<MotivoDaRecusaNfe, string>> = {
  xml_invalido: "O arquivo não é um XML válido.",
  xml_inseguro: "O XML traz uma declaração DOCTYPE ou ENTITY, que não é aceita por segurança.",
  xml_grande: "O XML passa do tamanho aceito (2 MB e 200.000 elementos).",
  nao_e_nfe_processada: "O arquivo não é o XML de uma NF-e processada (nfeProc com a nota e o protocolo de autorização).",
  sem_protocolo: "O XML não traz o protocolo de autorização (protNFe): envie o XML da nota autorizada.",
  nao_autorizada: "A nota não está autorizada: só nota com situação 100 ou 150 (cStat) é importada.",
  modelo_nao_aceito: "Só NF-e modelo 55 é importada.",
  ambiente_homologacao: "A nota é de homologação (tpAmb 2): só nota de produção (tpAmb 1) é importada.",
  chave_invalida: "A chave de acesso da nota é inválida: confira os 44 dígitos, o dígito verificador e o modelo 55.",
  chave_divergente: "A chave de acesso do protocolo de autorização não é a mesma da nota.",
  devolucao_fora: "Nota de devolução (finalidade 4) não é importada como compra.",
  emitente_invalido: "O emitente da nota não tem CNPJ/CPF válido, nome ou UF.",
  destinatario_invalido: "O destinatário da nota precisa ter CNPJ ou CPF válido (destinatário estrangeiro não é aceito).",
  sem_itens: "A nota não tem itens.",
  valor_invalido: "Campo obrigatório ausente ou valor fora do formato da NF-e.",
  data_invalida: "Data ausente ou inválida na nota."
};

export interface RastroDaNota { lote: string; quantidade: string; fabricacao: string | null; validade: string | null }

export interface ItemDaNota {
  nItem: number;
  codigo: string;
  ean: string | null;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  /** uCom normalizado: maiúsculas, sem espaço nas pontas. */
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  valorProdutos: string;
  desconto: string;
  frete: string;
  seguro: string;
  outras: string;
  ipi: string;
  /** vICMSST + vFCPST do grupo de ICMS do item. */
  icmsSt: string;
  icms: string;
  xPed: string | null;
  nItemPed: number | null;
  rastro: RastroDaNota[];
}

export interface ParcelaDaNota { numero: string; vencimento: string; valor: string }

export interface EnderecoDoEmitente {
  logradouro: string | null; numero: string | null; bairro: string | null; codigoMunicipio: string | null;
  municipio: string | null; cep: string | null; telefone: string | null;
}

export interface NotaFiscalLida {
  chave: string;
  versao: string | null;
  modelo: "55";
  serie: string;
  numero: string;
  /** AAAA-MM-DD (os 10 primeiros de dhEmi, ou dEmi). */
  dataEmissao: string;
  naturezaOperacao: string | null;
  finalidade: string;
  tipoOperacao: string;
  ufEmitente: string;
  protocolo: { cStat: string; numero: string | null; recebidoEm: string | null };
  emitente: {
    documento: string; tipo: "cnpj" | "cpf"; nome: string; fantasia: string | null; ie: string | null; uf: string;
    endereco: EnderecoDoEmitente;
  };
  destinatario: { documento: string; tipo: "cnpj" | "cpf"; nome: string | null; ie: string | null };
  itens: ItemDaNota[];
  totais: {
    produtos: string; desconto: string; frete: string; seguro: string; outras: string; ipi: string;
    /** vST + vFCPST */
    icmsSt: string;
    icms: string; ii: string; icmsDesonerado: string; ipiDevolvido: string;
    /** vNF */
    nota: string;
  };
  fatura: { numero: string | null; valorOriginal: string | null; desconto: string | null; liquido: string | null } | null;
  duplicatas: ParcelaDaNota[];
  xPedCabecalho: string | null;
  informacoesComplementares: string | null;
}

export interface RecusaDaNfe { motivo: MotivoDaRecusaNfe; mensagem: string; caminho: string }
export type LeituraDaNfe = { ok: true; nota: NotaFiscalLida } | { ok: false; recusas: RecusaDaNfe[] };

const DECIMAL = /^\d+(\.\d+)?$/;
const DINHEIRO = /^\d+(\.\d{1,2})?$/;

/** Data AAAA-MM-DD que existe no calendário. */
function dataValida(texto: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const dias = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]!;
  return dia <= dias;
}

/** Texto aparado; vazio vira `null`. */
const opcional = (v: string | null): string | null => (v === null || v === "" ? null : v);

/** Soma de dois valores em dinheiro (decimal.js, nunca ponto flutuante). */
const somaDinheiro = (a: string, b: string): string => money(D(a).plus(D(b)));

class Leitor {
  readonly recusas: RecusaDaNfe[] = [];

  recusar(motivo: MotivoDaRecusaNfe, caminho: string): void {
    if (this.recusas.some((r) => r.motivo === motivo && r.caminho === caminho)) return;
    this.recusas.push({ motivo, mensagem: MENSAGEM_DA_RECUSA_NFE[motivo], caminho });
  }

  /** Texto obrigatório; ausente ou vazio → recusa com o motivo dado. */
  texto(no: NoXml | undefined, caminho: string, campos: string[], motivo: MotivoDaRecusaNfe = "valor_invalido"): string {
    const v = opcional(textoEm(no, ...campos));
    if (v === null) { this.recusar(motivo, [caminho, ...campos].join("/")); return ""; }
    return v;
  }

  /** Dinheiro (até 2 casas) normalizado em 2 casas; ausente → "0.00" (ou recusa, se obrigatório). */
  dinheiro(no: NoXml | undefined, caminho: string, campos: string[], obrigatorio = false): string {
    const v = opcional(textoEm(no, ...campos));
    if (v === null) {
      if (obrigatorio) this.recusar("valor_invalido", [caminho, ...campos].join("/"));
      return "0.00";
    }
    if (!DINHEIRO.test(v)) { this.recusar("valor_invalido", [caminho, ...campos].join("/")); return "0.00"; }
    return money(v);
  }

  /** Dinheiro opcional que fica `null` quando ausente (fatura). */
  dinheiroOuNulo(no: NoXml | undefined, caminho: string, campos: string[]): string | null {
    return opcional(textoEm(no, ...campos)) === null ? null : this.dinheiro(no, caminho, campos);
  }

  /** Quantidade ou unitário: decimal da NF-e mantido como veio; obrigatório; `positivo` exige > 0. */
  decimal(no: NoXml | undefined, caminho: string, campos: string[], positivo: boolean): string {
    const v = opcional(textoEm(no, ...campos));
    if (v === null || !DECIMAL.test(v) || (positivo && /^[0.]+$/.test(v))) {
      this.recusar("valor_invalido", [caminho, ...campos].join("/"));
      return "0";
    }
    return v;
  }

  /** Data AAAA-MM-DD opcional; presente e inválida → recusa. */
  data(no: NoXml | undefined, caminho: string, campos: string[]): string | null {
    const v = opcional(textoEm(no, ...campos));
    if (v === null) return null;
    if (!dataValida(v)) { this.recusar("data_invalida", [caminho, ...campos].join("/")); return null; }
    return v;
  }
}

function documentoDaParte(no: NoXml | undefined): { documento: string; tipo: "cnpj" | "cpf" } | null {
  if (!no) return null;
  const cnpj = opcional(textoEm(no, "CNPJ"));
  const cpf = opcional(textoEm(no, "CPF"));
  const informado = cnpj ?? cpf;
  if (informado === null || (cnpj !== null && cpf !== null)) return null;
  const r = validarDocumento(informado);
  if (!r.valido || r.tipo !== (cnpj !== null ? "cnpj" : "cpf")) return null;
  return { documento: r.normalizado, tipo: r.tipo };
}

const semGtin = (v: string | null): string | null => {
  const t = opcional(v);
  return t === null || t.toUpperCase() === "SEM GTIN" ? null : t;
};

function lerItem(l: Leitor, det: NoXml, posicao: number, vistos: Set<number>): ItemDaNota {
  const caminho = `NFe/infNFe/det[${posicao}]`;
  const nItemTexto = det.atributos["nItem"] ?? "";
  let nItem = posicao;
  if (!/^\d{1,3}$/.test(nItemTexto) || Number(nItemTexto) < 1 || vistos.has(Number(nItemTexto))) {
    l.recusar("valor_invalido", `${caminho}/@nItem`);
  } else {
    nItem = Number(nItemTexto);
  }
  vistos.add(nItem);
  const prod = filho(det, "prod");
  const imposto = filho(det, "imposto");
  const grupoIcms = imposto ? filho(imposto, "ICMS")?.filhos[0] : undefined;
  const caminhoIcms = `${caminho}/imposto/ICMS/${grupoIcms?.nome ?? "ICMS"}`;
  const st = l.dinheiro(grupoIcms, caminhoIcms, ["vICMSST"]);
  const fcpSt = l.dinheiro(grupoIcms, caminhoIcms, ["vFCPST"]);
  const nItemPedTexto = opcional(textoEm(prod, "nItemPed"));
  const nItemPed = nItemPedTexto !== null && /^\d{1,6}$/.test(nItemPedTexto) && Number(nItemPedTexto) >= 1 ? Number(nItemPedTexto) : null;
  const rastro: RastroDaNota[] = (prod ? filhosChamados(prod, "rastro") : []).map((r, k) => {
    const cr = `${caminho}/prod/rastro[${k + 1}]`;
    return {
      lote: l.texto(r, cr, ["nLote"]),
      quantidade: l.decimal(r, cr, ["qLote"], true),
      fabricacao: l.data(r, cr, ["dFab"]),
      validade: l.data(r, cr, ["dVal"])
    };
  });
  return {
    nItem,
    codigo: l.texto(prod, `${caminho}/prod`, ["cProd"]),
    ean: semGtin(textoEm(prod, "cEAN")) ?? semGtin(textoEm(prod, "cEANTrib")),
    descricao: l.texto(prod, `${caminho}/prod`, ["xProd"]),
    ncm: opcional(textoEm(prod, "NCM")),
    cfop: opcional(textoEm(prod, "CFOP")),
    unidade: l.texto(prod, `${caminho}/prod`, ["uCom"]).toUpperCase(),
    quantidade: l.decimal(prod, `${caminho}/prod`, ["qCom"], true),
    valorUnitario: l.decimal(prod, `${caminho}/prod`, ["vUnCom"], false),
    valorProdutos: l.dinheiro(prod, `${caminho}/prod`, ["vProd"], true),
    desconto: l.dinheiro(prod, `${caminho}/prod`, ["vDesc"]),
    frete: l.dinheiro(prod, `${caminho}/prod`, ["vFrete"]),
    seguro: l.dinheiro(prod, `${caminho}/prod`, ["vSeg"]),
    outras: l.dinheiro(prod, `${caminho}/prod`, ["vOutro"]),
    ipi: l.dinheiro(imposto, `${caminho}/imposto`, ["IPI", "IPITrib", "vIPI"]),
    icmsSt: somaDinheiro(st, fcpSt),
    icms: l.dinheiro(grupoIcms, caminhoIcms, ["vICMS"]),
    xPed: opcional(textoEm(prod, "xPed")),
    nItemPed,
    rastro
  };
}

export function lerNotaFiscalEletronica(texto: string): LeituraDaNfe {
  const xml = lerXml(texto);
  if (!xml.ok) return { ok: false, recusas: [{ motivo: xml.motivo, mensagem: MENSAGEM_DA_RECUSA_NFE[xml.motivo], caminho: "" }] };
  const l = new Leitor();
  const raiz = xml.raiz;

  // Estrutura: nfeProc/NFe/infNFe + nfeProc/protNFe/infProt. A NF-e sem o envelope é recusada como "sem protocolo".
  let infNFe: NoXml | undefined;
  let infProt: NoXml | undefined;
  if (raiz.nome === "nfeProc") {
    const nfe = filho(raiz, "NFe");
    infNFe = nfe ? filho(nfe, "infNFe") : undefined;
    const prot = filho(raiz, "protNFe");
    infProt = prot ? filho(prot, "infProt") : undefined;
  } else if (raiz.nome === "NFe") {
    infNFe = filho(raiz, "infNFe");
  }
  if (!infNFe) return { ok: false, recusas: [{ motivo: "nao_e_nfe_processada", mensagem: MENSAGEM_DA_RECUSA_NFE.nao_e_nfe_processada, caminho: raiz.nome }] };
  if (!infProt) l.recusar("sem_protocolo", "protNFe/infProt");

  // Protocolo.
  const cStat = opcional(textoEm(infProt, "cStat")) ?? "";
  if (infProt && !(CSTAT_AUTORIZADA as readonly string[]).includes(cStat)) l.recusar("nao_autorizada", "protNFe/infProt/cStat");

  // Chave de acesso.
  const id = infNFe.atributos["Id"] ?? "";
  const chave = /^NFe\d{44}$/.test(id) ? id.slice(3) : "";
  if (chave === "" || !chaveDeAcessoValida(chave) || chave.slice(20, 22) !== "55") l.recusar("chave_invalida", "NFe/infNFe/@Id");
  if (infProt && opcional(textoEm(infProt, "chNFe")) !== (chave || id.replace(/^NFe/, ""))) l.recusar("chave_divergente", "protNFe/infProt/chNFe");

  // Identificação.
  const ide = filho(infNFe, "ide");
  const modelo = opcional(textoEm(ide, "mod"));
  if (modelo !== "55") l.recusar("modelo_nao_aceito", "NFe/infNFe/ide/mod");
  if (opcional(textoEm(ide, "tpAmb")) !== "1") l.recusar("ambiente_homologacao", "NFe/infNFe/ide/tpAmb");
  const finalidade = l.texto(ide, "NFe/infNFe/ide", ["finNFe"]);
  if (finalidade === "4") l.recusar("devolucao_fora", "NFe/infNFe/ide/finNFe");
  const tipoOperacao = l.texto(ide, "NFe/infNFe/ide", ["tpNF"]);
  const serie = l.texto(ide, "NFe/infNFe/ide", ["serie"]);
  const numero = l.texto(ide, "NFe/infNFe/ide", ["nNF"]);
  const dhEmi = opcional(textoEm(ide, "dhEmi")) ?? opcional(textoEm(ide, "dEmi"));
  const dataEmissao = dhEmi !== null && (dhEmi.length === 10 || dhEmi.charAt(10) === "T") && dataValida(dhEmi.slice(0, 10)) ? dhEmi.slice(0, 10) : "";
  if (dataEmissao === "") l.recusar("data_invalida", "NFe/infNFe/ide/dhEmi");

  // Emitente.
  const emit = filho(infNFe, "emit");
  const docEmit = documentoDaParte(emit);
  const nomeEmit = opcional(textoEm(emit, "xNome"));
  const enderEmit = emit ? filho(emit, "enderEmit") : undefined;
  const ufEmit = opcional(textoEm(enderEmit, "UF"));
  if (!docEmit || nomeEmit === null || ufEmit === null || !/^[A-Z]{2}$/.test(ufEmit)) l.recusar("emitente_invalido", "NFe/infNFe/emit");

  // Destinatário.
  const dest = filho(infNFe, "dest");
  const docDest = dest && opcional(textoEm(dest, "idEstrangeiro")) === null ? documentoDaParte(dest) : null;
  if (!docDest) l.recusar("destinatario_invalido", "NFe/infNFe/dest");

  // Itens.
  const dets = filhosChamados(infNFe, "det");
  if (dets.length === 0) l.recusar("sem_itens", "NFe/infNFe/det");
  const vistos = new Set<number>();
  const itens = dets.map((det, k) => lerItem(l, det, k + 1, vistos));

  // Totais.
  const tot = filho(infNFe, "total");
  const icmsTot = tot ? filho(tot, "ICMSTot") : undefined;
  const ct = "NFe/infNFe/total/ICMSTot";
  const totais = {
    produtos: l.dinheiro(icmsTot, ct, ["vProd"], true),
    desconto: l.dinheiro(icmsTot, ct, ["vDesc"]),
    frete: l.dinheiro(icmsTot, ct, ["vFrete"]),
    seguro: l.dinheiro(icmsTot, ct, ["vSeg"]),
    outras: l.dinheiro(icmsTot, ct, ["vOutro"]),
    ipi: l.dinheiro(icmsTot, ct, ["vIPI"]),
    icmsSt: somaDinheiro(l.dinheiro(icmsTot, ct, ["vST"]), l.dinheiro(icmsTot, ct, ["vFCPST"])),
    icms: l.dinheiro(icmsTot, ct, ["vICMS"]),
    ii: l.dinheiro(icmsTot, ct, ["vII"]),
    icmsDesonerado: l.dinheiro(icmsTot, ct, ["vICMSDeson"]),
    ipiDevolvido: l.dinheiro(icmsTot, ct, ["vIPIDevol"]),
    nota: l.dinheiro(icmsTot, ct, ["vNF"], true)
  };

  // Cobrança: fatura e duplicatas. Duplicata sem vencimento não vira parcela: sem as datas, a nota fica "sem duplicatas"
  // e a pessoa usa a condição de pagamento (o original continua guardado).
  const cobr = filho(infNFe, "cobr");
  const fat = cobr ? filho(cobr, "fat") : undefined;
  const fatura = fat ? {
    numero: opcional(textoEm(fat, "nFat")),
    valorOriginal: l.dinheiroOuNulo(fat, "NFe/infNFe/cobr/fat", ["vOrig"]),
    desconto: l.dinheiroOuNulo(fat, "NFe/infNFe/cobr/fat", ["vDesc"]),
    liquido: l.dinheiroOuNulo(fat, "NFe/infNFe/cobr/fat", ["vLiq"])
  } : null;
  const dups = cobr ? filhosChamados(cobr, "dup") : [];
  const lidas = dups.map((dup, k) => {
    const cd = `NFe/infNFe/cobr/dup[${k + 1}]`;
    return {
      numero: opcional(textoEm(dup, "nDup")) ?? String(k + 1).padStart(3, "0"),
      vencimento: l.data(dup, cd, ["dVenc"]),
      valor: l.dinheiro(dup, cd, ["vDup"], true)
    };
  });
  const duplicatas: ParcelaDaNota[] = lidas.every((d) => d.vencimento !== null)
    ? lidas.map((d) => ({ numero: d.numero, vencimento: d.vencimento!, valor: d.valor }))
    : [];

  if (l.recusas.length > 0 || !docEmit || !docDest) {
    return { ok: false, recusas: l.recusas };
  }

  return {
    ok: true,
    nota: {
      chave,
      versao: opcional(infNFe.atributos["versao"] ?? null),
      modelo: "55",
      serie,
      numero,
      dataEmissao,
      naturezaOperacao: opcional(textoEm(ide, "natOp")),
      finalidade,
      tipoOperacao,
      ufEmitente: ufEmit!,
      protocolo: { cStat, numero: opcional(textoEm(infProt, "nProt")), recebidoEm: opcional(textoEm(infProt, "dhRecbto")) },
      emitente: {
        documento: docEmit.documento,
        tipo: docEmit.tipo,
        nome: nomeEmit!,
        fantasia: opcional(textoEm(emit, "xFant")),
        ie: opcional(textoEm(emit, "IE")),
        uf: ufEmit!,
        endereco: {
          logradouro: opcional(textoEm(enderEmit, "xLgr")),
          numero: opcional(textoEm(enderEmit, "nro")),
          bairro: opcional(textoEm(enderEmit, "xBairro")),
          codigoMunicipio: opcional(textoEm(enderEmit, "cMun")),
          municipio: opcional(textoEm(enderEmit, "xMun")),
          cep: opcional(textoEm(enderEmit, "CEP")),
          telefone: opcional(textoEm(enderEmit, "fone"))
        }
      },
      destinatario: { documento: docDest.documento, tipo: docDest.tipo, nome: opcional(textoEm(dest, "xNome")), ie: opcional(textoEm(dest, "IE")) },
      itens,
      totais,
      fatura,
      duplicatas,
      xPedCabecalho: opcional(textoEm(infNFe, "compra", "xPed")),
      informacoesComplementares: opcional(textoEm(infNFe, "infAdic", "infCpl"))
    }
  };
}
