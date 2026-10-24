/**
 * Número digitado na tela (pt-BR) ↔ canônico da API (ponto decimal, sem milhar).
 * Inteiro exibe `1.000`; decimal `1.000,00` (via `numeroBR`). Na digitação, zero some no foco.
 */

/** Valor canônico que conta como zero para limpar o campo ao focar. */
export function ehZeroCanonico(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined || v === "") return true;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n === 0;
}

/** Canônico (`1000.5`) → texto para digitar (`1000,5`), sem milhar. */
export function paraDigitacao(canonico: string): string {
  const t = String(canonico ?? "").trim();
  if (!t) return "";
  if (ehZeroCanonico(t)) return "";
  return t.replace(".", ",");
}

/**
 * Filtra tecla a tecla: dígitos, um separador decimal (vírgula ou ponto) e pontos de milhar.
 * `casas` limita a parte fracionária; `inteiro` recusa separador decimal.
 */
export function filtrarDigitacao(bruto: string, opts?: { casas?: number; inteiro?: boolean }): string {
  let s = bruto.replace(/\s/g, "");
  if (!s) return "";
  const inteiro = opts?.inteiro === true;
  const casas = inteiro ? 0 : opts?.casas;
  // aceita vírgula ou ponto como decimal; se os dois aparecem, o último manda
  const ultVirgula = s.lastIndexOf(",");
  const ultPonto = s.lastIndexOf(".");
  let decPos = -1;
  let sep = "";
  if (!inteiro) {
    if (ultVirgula >= 0 && ultPonto >= 0) {
      decPos = Math.max(ultVirgula, ultPonto);
      sep = ",";
    } else if (ultVirgula >= 0) {
      decPos = ultVirgula;
      sep = ",";
    } else if (ultPonto >= 0) {
      // um único ponto no fim da parte fracionária curta: trata como decimal; senão milhar
      const apos = s.slice(ultPonto + 1);
      if (apos === "" || (apos.length <= (casas ?? 6) && /^\d*$/.test(apos) && !s.slice(0, ultPonto).includes("."))) {
        decPos = ultPonto;
        sep = ",";
      }
    }
  }
  const parteIntBruta = decPos >= 0 ? s.slice(0, decPos) : s;
  const parteDecBruta = decPos >= 0 ? s.slice(decPos + 1).replace(/\D/g, "") : "";
  let intDigitos = parteIntBruta.replace(/\D/g, "");
  // sem zero à esquerda na parte inteira (exceto "0," / "0")
  intDigitos = intDigitos.replace(/^0+(?=\d)/, "");
  let dec = parteDecBruta;
  if (casas !== undefined) dec = dec.slice(0, casas);
  if (inteiro || decPos < 0) return intDigitos;
  return `${intDigitos}${sep}${dec}`;
}

/** Texto da tela → canônico (`""` se vazio/incompleto só com separador). */
export function canonicoDoDigitado(texto: string): string {
  const t = texto.trim().replace(/\s/g, "");
  if (!t || t === "," || t === ".") return "";
  let s = t;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else {
    // só pontos: se há mais de um, são milhar; um só pode ser decimal
    const partes = s.split(".");
    if (partes.length > 2) s = partes.join("");
    else if (partes.length === 2 && partes[1] !== undefined) {
      // "1.000" (milhar) vs "1.5" (decimal): 3 dígitos exatos após o ponto sem mais → milhar
      if (partes[1].length === 3 && /^\d+$/.test(partes[1]) && partes[0] !== undefined && partes[0] !== "") {
        s = partes[0] + partes[1];
      }
    }
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    // incompleto "12." → "12"
    if (/^-?\d+\.$/.test(s)) return s.slice(0, -1);
    return "";
  }
  // normaliza zeros à esquerda no canônico
  const n = Number(s);
  if (!Number.isFinite(n)) return "";
  if (n === 0) return s.includes(".") ? s.replace(/^0+(?=\d)/, "0") : "0";
  // preserva casas digitadas
  const [i, d] = s.replace(/^-/, "").split(".");
  const int = (i ?? "0").replace(/^0+(?=\d)/, "") || "0";
  const sinal = s.startsWith("-") ? "-" : "";
  return d !== undefined ? `${sinal}${int}.${d}` : `${sinal}${int}`;
}
