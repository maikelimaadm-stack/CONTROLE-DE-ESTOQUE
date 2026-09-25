/**
 * APELIDOS POPULARES DE BANCO (CADASTROS AJUSTES 01, A-3).
 *
 * Quem digita "nubank" ou "caixa" no campo Banco não sabe que o nome oficial do BCB é "NU PAGAMENTOS S.A."
 * ou "CAIXA ECONOMICA FEDERAL". Esta tabela estática traduz o apelido para o código COMPE; a busca
 * (`GET /api/referencias/bancos`) acrescenta o banco apontado às linhas achadas pelo nome oficial.
 *
 * Só aponta para código que existe na carga da 0026 — o teste de domínio confere código e nome contra o
 * arquivo da migration. Apelido nunca vira valor gravado: o cadastro grava o código.
 *
 * Chave: apelido já normalizado (minúsculas, sem acento, espaços simples). `nome` é o nome oficial esperado
 * (parte dele, sem caixa/acento) — é o que o teste confere contra a 0026.
 */
export interface ApelidoDeBanco { codigo: string; nome: string; apelidos: readonly string[] }

export const APELIDOS_DE_BANCO: readonly ApelidoDeBanco[] = [
  { codigo: "001", nome: "banco do brasil", apelidos: ["bb", "banco do brasil"] },
  { codigo: "104", nome: "caixa economica federal", apelidos: ["caixa", "cef"] },
  { codigo: "237", nome: "bradesco", apelidos: ["bradesco"] },
  { codigo: "341", nome: "itau", apelidos: ["itau"] },
  { codigo: "033", nome: "santander", apelidos: ["santander"] },
  { codigo: "260", nome: "nu pagamentos", apelidos: ["nubank", "nu"] },
  { codigo: "077", nome: "banco inter", apelidos: ["inter"] },
  { codigo: "336", nome: "banco c6", apelidos: ["c6"] },
  { codigo: "748", nome: "sicredi", apelidos: ["sicredi"] },
  { codigo: "756", nome: "sicoob", apelidos: ["sicoob"] },
  { codigo: "212", nome: "banco original", apelidos: ["original"] },
  { codigo: "208", nome: "btg pactual", apelidos: ["btg"] },
  { codigo: "041", nome: "rio grande do sul", apelidos: ["banrisul"] },
  { codigo: "422", nome: "banco safra", apelidos: ["safra"] },
  { codigo: "323", nome: "mercado pago", apelidos: ["mercado pago"] },
  { codigo: "290", nome: "pagseguro", apelidos: ["pagbank", "pagseguro"] },
  { codigo: "380", nome: "picpay", apelidos: ["picpay"] },
  { codigo: "070", nome: "brb", apelidos: ["brb"] },
  { codigo: "004", nome: "banco do nordeste", apelidos: ["bnb", "banco do nordeste"] },
  { codigo: "136", nome: "unicred", apelidos: ["unicred"] },
  { codigo: "085", nome: "ailos", apelidos: ["ailos"] },
  { codigo: "403", nome: "cora", apelidos: ["cora"] },
  { codigo: "197", nome: "stone", apelidos: ["stone"] },
  { codigo: "655", nome: "votorantim", apelidos: ["bv", "votorantim"] }
];

const ACENTOS = "áàâãäéèêëíìîïóòôõöúùûüçñ";
const SEM = "aaaaaeeeeiiiiooooouuuucn";
/** minúsculas, sem acento, espaços simples */
export function normalizarApelido(s: string): string {
  let o = ""; for (const c of String(s ?? "").toLowerCase()) { const i = ACENTOS.indexOf(c); o += i >= 0 ? SEM[i] : c; }
  return o.replace(/\s+/g, " ").trim();
}

/**
 * Códigos COMPE apontados pelo texto digitado: apelido IGUAL ao texto, ou que COMEÇA com ele quando o texto
 * tem 3+ caracteres ("merc" → mercado pago). Texto curto só casa exato ("nu", "bb", "c6").
 */
export function bancosPorApelido(texto: string): string[] {
  const t = normalizarApelido(texto); if (!t) return [];
  const out = new Set<string>();
  for (const b of APELIDOS_DE_BANCO) for (const a of b.apelidos) if (a === t || (t.length >= 3 && a.startsWith(t))) out.add(b.codigo);
  return [...out];
}
