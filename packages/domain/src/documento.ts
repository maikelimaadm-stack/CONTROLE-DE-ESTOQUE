/**
 * DOCUMENTO (CPF / CNPJ) — UMA regra para a web e para a API (CADASTROS Fase 3).
 *
 * CNPJ ALFANUMÉRICO (IN RFB 2.229/2024): 14 posições; as 12 primeiras são dígitos ou letras MAIÚSCULAS e
 * as 2 últimas (DV) são sempre dígitos. Cada caractere vale (código ASCII − 48): '0'..'9' → 0..9 e
 * 'A'..'Z' → 17..42. 1º DV com pesos 5,4,3,2,9,8,7,6,5,4,3,2 sobre as 12 primeiras; 2º DV com pesos
 * 6,5,4,3,2,9,8,7,6,5,4,3,2 sobre as 13; resto 0 ou 1 → 0, senão 11 − resto. O CNPJ só de dígitos é o
 * caso particular da mesma conta. Sequência repetida (000…, 111…, AAA…) é recusada.
 */

export type TipoDocumento = "cpf" | "cnpj";
export type ResultadoDocumento =
  | { valido: true; tipo: TipoDocumento; normalizado: string; formatado: string; alfanumerico: boolean }
  | { valido: false; normalizado: string; motivo: string };

/** Tira pontuação e espaços e passa para maiúsculas. Não valida nada. */
export function normalizarDocumento(valor: string): string {
  return String(valor ?? "").replace(/[\s.\-/]/g, "").toUpperCase();
}

const valorDe = (c: string) => c.charCodeAt(0) - 48;
const dv = (base: string, pesos: number[]) => {
  const soma = pesos.reduce((acc, p, i) => acc + valorDe(base[i]!) * p, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
};
const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const repetido = (s: string) => /^(.)\1*$/.test(s);

export function validarCpf(valor: string): boolean {
  const d = normalizarDocumento(valor);
  if (!/^\d{11}$/.test(d) || repetido(d)) return false;
  const calc = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function validarCnpj(valor: string): boolean {
  const d = normalizarDocumento(valor);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(d) || repetido(d)) return false;
  const d1 = dv(d.slice(0, 12), PESOS_CNPJ_1);
  const d2 = dv(d.slice(0, 12) + String(d1), PESOS_CNPJ_2);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

export const cnpjAlfanumerico = (valor: string) => /[A-Z]/.test(normalizarDocumento(valor));

export function formatarCnpj(valor: string): string {
  const d = normalizarDocumento(valor);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
}
export function formatarCpf(valor: string): string {
  const d = normalizarDocumento(valor);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
}

/** Mensagens da regra tipo de pessoa × documento (decisão 253, R1-6). */
export const MSG_FISICA_USA_CPF = "Pessoa física usa CPF";
export const MSG_JURIDICA_USA_CNPJ = "Pessoa jurídica usa CNPJ";

/**
 * TIPO DE PESSOA × DOCUMENTO (decisão 253, R1-6), pela largura do documento NORMALIZADO: Física (`natural`) usa
 * CPF (11 posições); Jurídica (`legal`) usa CNPJ (14 posições, numérico OU alfanumérico); Estrangeira (`foreign`)
 * é livre. Tipo fora dos três NEGA (discriminador desconhecido não cai em regra vizinha). Devolve a mensagem da
 * recusa ou `null`. Só diz se o documento é da espécie do tipo — o dígito verificador é de `validarDocumento`.
 * Chamada com documento INFORMADO: o documento continua opcional, e vazio não chega aqui.
 */
export function recusaDoTipoDePessoa(tipo: string, valor: string): string | null {
  const n = normalizarDocumento(valor);
  if (tipo === "foreign") return null;
  if (tipo === "natural") return n.length === 11 ? null : MSG_FISICA_USA_CPF;
  if (tipo === "legal") return n.length === 14 ? null : MSG_JURIDICA_USA_CNPJ;
  return "Tipo de pessoa inválido";
}

/** Classifica e valida: 11 posições → CPF; 14 → CNPJ (numérico ou alfanumérico). */
export function validarDocumento(valor: string): ResultadoDocumento {
  const n = normalizarDocumento(valor);
  if (n.length === 11) return validarCpf(n) ? { valido: true, tipo: "cpf", normalizado: n, formatado: formatarCpf(n), alfanumerico: false } : { valido: false, normalizado: n, motivo: "CPF inválido" };
  if (n.length === 14) return validarCnpj(n) ? { valido: true, tipo: "cnpj", normalizado: n, formatado: formatarCnpj(n), alfanumerico: cnpjAlfanumerico(n) } : { valido: false, normalizado: n, motivo: "CNPJ inválido" };
  return { valido: false, normalizado: n, motivo: "Documento deve ter 11 (CPF) ou 14 (CNPJ) posições" };
}

/*
 * MÁSCARAS DE ENTRADA (CADASTROS AJUSTES 01, B-3) — formatadores ÚNICOS para a web. A tela MOSTRA o formatado
 * e GRAVA o normalizado (`normalizarMascara`). São PROGRESSIVOS: formatam o que já foi digitado, para a máscara
 * acompanhar a digitação e o colar com pontuação. Não validam — o DV é de `validarCpf`/`validarCnpj`.
 */
export type TipoMascara = "cpf" | "cnpj" | "cep" | "telefone";

const soDigitos = (v: string) => String(v ?? "").replace(/\D/g, "");
/** Encaixa `valor` no molde (`0` = uma posição); para onde o valor acaba, sem pontuação sobrando no fim. */
function encaixar(valor: string, molde: string): string {
  let o = ""; let i = 0;
  for (const m of molde) {
    if (i >= valor.length) break;
    if (m === "0") o += valor[i++]; else o += m;
  }
  return o;
}

/** Normaliza para gravar: CPF/CEP/telefone só dígitos; CNPJ [0-9A-Z] maiúsculo, DV (2 últimas) só dígito. Corta no tamanho. */
export function normalizarMascara(tipo: TipoMascara, valor: string): string {
  switch (tipo) {
    case "cpf": return soDigitos(valor).slice(0, 11);
    case "cep": return soDigitos(valor).slice(0, 8);
    case "telefone": return soDigitos(valor).slice(0, 11);
    case "cnpj": {
      const bruto = String(valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
      let o = "";
      for (const c of bruto) { if (o.length >= 14) break; if (o.length >= 12 && !/\d/.test(c)) continue; o += c; }
      return o;
    }
  }
}

/** Formata (progressivo): CPF 000.000.000-00 · CNPJ 00.000.000/0000-00 (alfanumérico AA.AAA.AAA/AAAA-00) · CEP 00000-000 · telefone (00) 0000-0000 / celular (00) 00000-0000. */
export function formatarMascara(tipo: TipoMascara, valor: string): string {
  const n = normalizarMascara(tipo, valor);
  switch (tipo) {
    case "cpf": return encaixar(n, "000.000.000-00");
    case "cnpj": return encaixar(n, "00.000.000/0000-00");
    case "cep": return encaixar(n, "00000-000");
    case "telefone":
      if (n.length <= 2) return n.length ? `(${n}` : "";
      return encaixar(n, n.length === 11 ? "(00) 00000-0000" : "(00) 0000-0000");
  }
}

export const formatarCep = (v: string) => formatarMascara("cep", v);
export const formatarTelefone = (v: string) => formatarMascara("telefone", v);

/** Máscara do documento pelo tipo de pessoa: Física → CPF; Jurídica → CNPJ; Estrangeira ou desconhecido → sem máscara (null). */
export function mascaraDoTipoDePessoa(tipo: string | null | undefined): "cpf" | "cnpj" | null {
  if (tipo === "natural") return "cpf";
  if (tipo === "legal") return "cnpj";
  return null;
}

/**
 * Máscara EFETIVA do CPF/CNPJ enquanto se digita ou cola (AJUSTES 01, B-3/C-3). O tipo de pessoa dá o ponto de
 * partida, mas NUNCA corta o documento: em Física, o 12º caractere (ou uma letra) passa para CNPJ, e o tipo segue o
 * documento na ficha. Em Jurídica o CNPJ é formatado desde o 1º dígito. Estrangeira = sem máscara (null).
 * O valor normalizado do documento, para qualquer máscara, é `normalizarMascara("cnpj", v)`: [0-9A-Z], até 14.
 */
export function mascaraDoDocumento(tipoPessoa: string | null | undefined, valor: string | null | undefined): "cpf" | "cnpj" | null {
  if (tipoPessoa === "foreign") return null;
  const n = normalizarMascara("cnpj", String(valor ?? ""));
  if (n.length > 11 || /[A-Z]/.test(n)) return "cnpj";
  return tipoPessoa === "legal" ? "cnpj" : "cpf";
}

/** DV do documento conferido ao sair do campo: mensagem da recusa ou null. Vazio não é recusado aqui (documento é opcional). */
export function recusaDoDigitoDoDocumento(tipo: "cpf" | "cnpj", valor: string): string | null {
  const n = normalizarMascara(tipo, valor);
  if (!n) return null;
  if (tipo === "cpf") return validarCpf(n) ? null : "CPF inválido";
  return validarCnpj(n) ? null : "CNPJ inválido";
}

/** Texto é um CEP (8 dígitos, com ou sem hífen/ponto)? Usado pelo campo Cidade para decidir consultar o CEP. */
export function textoEhCep(texto: string): boolean {
  return /^\d{5}[-.]?\d{3}$/.test(String(texto ?? "").trim()) || /^\d{2}\.\d{3}-\d{3}$/.test(String(texto ?? "").trim());
}
