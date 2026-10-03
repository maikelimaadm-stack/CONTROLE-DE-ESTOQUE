/**
 * OPERACOES-01 F7 (decisão 284) — LEITOR DE XML MÍNIMO, sem DOM e sem dependência.
 *
 * Existe para o SERVIDOR ler a NF-e (o navegador não é autoridade) sem trazer biblioteca nova para a árvore de
 * dependências. Lê só o subconjunto de XML que um documento fiscal usa, e RECUSA o resto:
 *
 *   · `<!DOCTYPE` ou `<!ENTITY` em QUALQUER lugar → `xml_inseguro` (fecha a porta de XXE e de expansão de entidade);
 *   · entidades: só as cinco predefinidas (`&lt; &gt; &amp; &quot; &apos;`) e as numéricas (`&#N;`, `&#xH;`);
 *     qualquer outra → `xml_invalido`;
 *   · `<?xml …?>` só no INÍCIO (depois do BOM, que é retirado, e de espaço em branco); outras instruções de processamento e comentários são
 *     ignorados; CDATA entra no texto como está;
 *   · atributos com aspas simples ou duplas; atributo repetido no mesmo elemento → `xml_invalido`;
 *   · o NOME do nó é o nome LOCAL (sem o prefixo de namespace); os atributos ficam como escritos (inclusive `xmlns*`);
 *   · tag não fechada, fechamento trocado, texto fora da raiz ou segunda raiz → `xml_invalido`;
 *   · limites: mais de LIMITE_XML_CARACTERES caracteres ou mais de LIMITE_XML_NOS elementos → `xml_grande`;
 *     aninhamento acima de LIMITE_XML_PROFUNDIDADE → `xml_invalido` (nenhum documento fiscal chega perto disso).
 *
 * `texto` de um nó é o texto DIRETO dele (sem o dos filhos), com as entidades já resolvidas. FUNÇÃO PURA e
 * determinística; percorre o texto uma vez, sem recursão.
 */

export interface NoXml {
  nome: string;
  atributos: Readonly<Record<string, string>>;
  filhos: NoXml[];
  texto: string;
}

export type MotivoDaRecusaXml = "xml_invalido" | "xml_inseguro" | "xml_grande";
export type ResultadoXml = { ok: true; raiz: NoXml } | { ok: false; motivo: MotivoDaRecusaXml };

export const LIMITE_XML_CARACTERES = 2_097_152;
export const LIMITE_XML_PROFUNDIDADE = 64;
export const LIMITE_XML_NOS = 200_000;

const INSEGURO = /<!\s*(?:DOCTYPE|ENTITY)/i;
const NOME = /[A-Za-z_:À-￿][A-Za-z0-9_:.\-·À-￿]*/y;
const ESPACO = /[ \t\r\n]*/y;
const SO_ESPACO = /^[ \t\r\n]*$/;
const PREDEFINIDAS: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

class XmlRecusado extends Error {
  constructor(readonly motivo: MotivoDaRecusaXml) { super(motivo); }
}
const invalido = (): never => { throw new XmlRecusado("xml_invalido"); };

/** Resolve as entidades permitidas; outra entidade, `&` solto ou ponto de código inválido → xml_invalido. */
function resolverEntidades(bruto: string): string {
  if (!bruto.includes("&")) return bruto;
  let saida = "";
  let i = 0;
  for (;;) {
    const amp = bruto.indexOf("&", i);
    if (amp < 0) return saida + bruto.slice(i);
    saida += bruto.slice(i, amp);
    const fim = bruto.indexOf(";", amp + 1);
    if (fim < 0 || fim - amp > 12) invalido();
    const nome = bruto.slice(amp + 1, fim);
    const predefinida = Object.prototype.hasOwnProperty.call(PREDEFINIDAS, nome) ? PREDEFINIDAS[nome] : undefined;
    if (predefinida !== undefined) {
      saida += predefinida;
    } else {
      const hex = /^#x([0-9A-Fa-f]{1,6})$/.exec(nome);
      const dec = /^#([0-9]{1,7})$/.exec(nome);
      const ponto = hex ? parseInt(hex[1]!, 16) : dec ? parseInt(dec[1]!, 10) : -1;
      const valido = ponto === 0x9 || ponto === 0xA || ponto === 0xD || (ponto >= 0x20 && ponto <= 0xD7FF)
        || (ponto >= 0xE000 && ponto <= 0xFFFD) || (ponto >= 0x10000 && ponto <= 0x10FFFF);
      if (!valido) invalido();
      saida += String.fromCodePoint(ponto);
    }
    i = fim + 1;
  }
}

function lerNome(s: string, i: number): { nome: string; fim: number } {
  NOME.lastIndex = i;
  const m = NOME.exec(s);
  if (!m) return invalido();
  return { nome: m[0], fim: i + m[0].length };
}

function pularEspaco(s: string, i: number): number {
  ESPACO.lastIndex = i;
  ESPACO.exec(s);
  return ESPACO.lastIndex;
}

function nomeLocal(qualificado: string): string {
  const doisPontos = qualificado.lastIndexOf(":");
  const local = doisPontos < 0 ? qualificado : qualificado.slice(doisPontos + 1);
  if (local === "" || doisPontos === 0) invalido();
  return local;
}

interface Aberto { no: NoXml; qualificado: string }

function analisar(s: string): NoXml {
  const n = s.length;
  // A declaração `<?xml …?>` só vale no início do documento (espaço em branco antes dela é tolerado).
  let i = pularEspaco(s, 0);
  if (s.startsWith("<?xml", i) && /[ \t\r\n?]/.test(s.charAt(i + 5))) {
    const fim = s.indexOf("?>", i + 5);
    if (fim < 0) invalido();
    i = fim + 2;
  }
  const pilha: Aberto[] = [];
  let raiz: NoXml | null = null;
  let nos = 0;

  const anexarTexto = (bruto: string, resolver: boolean) => {
    const topo = pilha[pilha.length - 1];
    if (!topo) {
      if (!SO_ESPACO.test(bruto)) invalido();
      return;
    }
    topo.no.texto += resolver ? resolverEntidades(bruto) : bruto;
  };

  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      anexarTexto(s.slice(i), true);
      break;
    }
    if (lt > i) anexarTexto(s.slice(i, lt), true);
    i = lt;

    if (s.startsWith("<!--", i)) {
      const fim = s.indexOf("-->", i + 4);
      if (fim < 0) invalido();
      i = fim + 3;
      continue;
    }
    if (s.startsWith("<![CDATA[", i)) {
      if (pilha.length === 0) invalido();
      const fim = s.indexOf("]]>", i + 9);
      if (fim < 0) invalido();
      anexarTexto(s.slice(i + 9, fim), false);
      i = fim + 3;
      continue;
    }
    if (s.startsWith("<!", i)) invalido();
    if (s.startsWith("<?", i)) {
      const fim = s.indexOf("?>", i + 2);
      if (fim < 0) invalido();
      const alvo = /^[^ \t\r\n?]*/.exec(s.slice(i + 2, fim))![0];
      if (alvo.toLowerCase() === "xml") invalido(); // declaração fora do início
      i = fim + 2;
      continue;
    }
    if (s.startsWith("</", i)) {
      const { nome, fim } = lerNome(s, i + 2);
      const depois = pularEspaco(s, fim);
      if (s.charAt(depois) !== ">") invalido();
      const topo = pilha.pop();
      if (!topo || topo.qualificado !== nome) invalido();
      i = depois + 1;
      continue;
    }

    // Abertura de elemento.
    if (raiz !== null && pilha.length === 0) invalido(); // segunda raiz
    const { nome: qualificado, fim: fimDoNome } = lerNome(s, i + 1);
    const atributos = Object.create(null) as Record<string, string>;
    let j = fimDoNome;
    let autoFechado = false;
    for (;;) {
      const antes = j;
      j = pularEspaco(s, j);
      const c = s.charAt(j);
      if (c === ">") { j += 1; break; }
      if (c === "/") {
        if (s.charAt(j + 1) !== ">") invalido();
        autoFechado = true;
        j += 2;
        break;
      }
      if (j === antes) invalido(); // atributo sem espaço antes
      const { nome: nomeAttr, fim } = lerNome(s, j);
      j = pularEspaco(s, fim);
      if (s.charAt(j) !== "=") invalido();
      j = pularEspaco(s, j + 1);
      const aspa = s.charAt(j);
      if (aspa !== "\"" && aspa !== "'") invalido();
      const fecha = s.indexOf(aspa, j + 1);
      if (fecha < 0) invalido();
      const bruto = s.slice(j + 1, fecha);
      if (bruto.includes("<")) invalido();
      if (Object.prototype.hasOwnProperty.call(atributos, nomeAttr)) invalido();
      atributos[nomeAttr] = resolverEntidades(bruto.replace(/[\t\n\r]/g, " "));
      j = fecha + 1;
    }

    nos += 1;
    if (nos > LIMITE_XML_NOS) throw new XmlRecusado("xml_grande");
    if (pilha.length + 1 > LIMITE_XML_PROFUNDIDADE) invalido();
    const no: NoXml = { nome: nomeLocal(qualificado), atributos, filhos: [], texto: "" };
    const pai = pilha[pilha.length - 1];
    if (pai) pai.no.filhos.push(no);
    else raiz = no;
    if (!autoFechado) pilha.push({ no, qualificado });
    i = j;
  }

  if (pilha.length > 0 || raiz === null) invalido();
  return raiz as NoXml;
}

export function lerXml(texto: string): ResultadoXml {
  if (typeof texto !== "string") return { ok: false, motivo: "xml_invalido" };
  if (texto.length > LIMITE_XML_CARACTERES) return { ok: false, motivo: "xml_grande" };
  const s = texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto;
  if (INSEGURO.test(s)) return { ok: false, motivo: "xml_inseguro" };
  try {
    return { ok: true, raiz: analisar(s) };
  } catch (e) {
    if (e instanceof XmlRecusado) return { ok: false, motivo: e.motivo };
    throw e;
  }
}

/** Primeiro filho com o nome LOCAL dado. */
export function filho(no: NoXml, nome: string): NoXml | undefined {
  return no.filhos.find((f) => f.nome === nome);
}

/** Todos os filhos diretos com o nome LOCAL dado, na ordem do documento. */
export function filhosChamados(no: NoXml, nome: string): NoXml[] {
  return no.filhos.filter((f) => f.nome === nome);
}

/** Texto aparado do nó no fim do caminho (nomes locais, filho a filho); `null` se algum passo não existe. */
export function textoEm(no: NoXml | undefined, ...caminho: string[]): string | null {
  let atual = no;
  for (const passo of caminho) {
    if (!atual) return null;
    atual = filho(atual, passo);
  }
  return atual ? atual.texto.trim() : null;
}
