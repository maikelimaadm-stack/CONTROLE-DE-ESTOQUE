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

/** Classifica e valida: 11 posições → CPF; 14 → CNPJ (numérico ou alfanumérico). */
export function validarDocumento(valor: string): ResultadoDocumento {
  const n = normalizarDocumento(valor);
  if (n.length === 11) return validarCpf(n) ? { valido: true, tipo: "cpf", normalizado: n, formatado: formatarCpf(n), alfanumerico: false } : { valido: false, normalizado: n, motivo: "CPF inválido" };
  if (n.length === 14) return validarCnpj(n) ? { valido: true, tipo: "cnpj", normalizado: n, formatado: formatarCnpj(n), alfanumerico: cnpjAlfanumerico(n) } : { valido: false, normalizado: n, motivo: "CNPJ inválido" };
  return { valido: false, normalizado: n, motivo: "Documento deve ter 11 (CPF) ou 14 (CNPJ) posições" };
}
