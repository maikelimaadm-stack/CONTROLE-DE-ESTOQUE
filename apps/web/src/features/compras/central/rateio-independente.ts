import { D } from "@agro/shared";

/**
 * Rateio independente Natureza × Centro (F2, decisão 325): a tela edita duas distribuições
 * separadas; o corpo da API continua com linhas pareadas — o produto cruzado das %
 * (natureza% × centro% / 100) em cada par, com Conta Contábil e Safra carimbados no documento.
 */

export type ParteDoRateioIndependente = { id: string; percentual: string };

/** Forma da linha pareada no corpo (espelha `LinhaDoRateioDaCompra` sem importar `estado`). */
export type LinhaPareadaDoRateio = {
  categoriaId: string; centroId: string; contaId: string; safraId: string; percentual: string;
};

export type VistaDoRateioIndependente = {
  naturezas: ParteDoRateioIndependente[];
  centros: ParteDoRateioIndependente[];
  contaId: string;
  safraId: string;
};

const pct = (v: string) => {
  try { return v.trim() ? D(v.trim()) : D(0); } catch { return D(0); }
};

const parteVazia = (): ParteDoRateioIndependente => ({ id: "", percentual: "100" });

/** Agrega linhas pareadas em duas listas (soma marginal) + Conta/Safra do documento. */
export function projetarRateioIndependente(linhas: readonly LinhaPareadaDoRateio[]): VistaDoRateioIndependente {
  const natOrdem: string[] = [];
  const cenOrdem: string[] = [];
  const natSoma = new Map<string, ReturnType<typeof D>>();
  const cenSoma = new Map<string, ReturnType<typeof D>>();
  let contaId = "";
  let safraId = "";
  for (const l of linhas) {
    const p = pct(l.percentual);
    const nk = l.categoriaId;
    const ck = l.centroId;
    if (!natSoma.has(nk)) { natOrdem.push(nk); natSoma.set(nk, D(0)); }
    if (!cenSoma.has(ck)) { cenOrdem.push(ck); cenSoma.set(ck, D(0)); }
    natSoma.set(nk, (natSoma.get(nk) ?? D(0)).plus(p));
    cenSoma.set(ck, (cenSoma.get(ck) ?? D(0)).plus(p));
    if (!contaId && l.contaId) contaId = l.contaId;
    if (!safraId && l.safraId) safraId = l.safraId;
  }
  const naturezas = natOrdem.length
    ? natOrdem.map((id) => ({ id, percentual: (natSoma.get(id) ?? D(0)).toFixed() }))
    : [parteVazia()];
  const centros = cenOrdem.length
    ? cenOrdem.map((id) => ({ id, percentual: (cenSoma.get(id) ?? D(0)).toFixed() }))
    : [parteVazia()];
  return { naturezas, centros, contaId, safraId };
}

/** Produto cruzado Natureza × Centro; Conta/Safra iguais em todas as linhas. Teto 50 (contrato atual). */
export function linhasDoProdutoCruzado(
  naturezas: readonly ParteDoRateioIndependente[],
  centros: readonly ParteDoRateioIndependente[],
  contaId: string,
  safraId: string,
): LinhaPareadaDoRateio[] {
  const n = naturezas.length ? naturezas : [parteVazia()];
  const c = centros.length ? centros : [parteVazia()];
  const out: LinhaPareadaDoRateio[] = [];
  for (const nat of n) {
    for (const cen of c) {
      out.push({
        categoriaId: nat.id,
        centroId: cen.id,
        contaId,
        safraId,
        percentual: pct(nat.percentual).times(pct(cen.percentual)).div(100).toFixed(),
      });
      if (out.length >= 50) return out;
    }
  }
  return out;
}

/** Soma dos percentuais de uma parte (natureza ou centro). */
export function somaDasPartes(partes: readonly ParteDoRateioIndependente[]): string {
  return partes.reduce((a, p) => a.plus(pct(p.percentual)), D(0)).toFixed();
}

/**
 * Classificação única (documento): um par a 100%, sem conta/safra e ainda no modo documento.
 * Qualquer divisão, 2ª linha, conta ou safra exige `por_valor`.
 */
export function cabeNoDocumento(
  naturezas: readonly ParteDoRateioIndependente[],
  centros: readonly ParteDoRateioIndependente[],
  contaId: string,
  safraId: string,
): boolean {
  if (contaId || safraId) return false;
  if (naturezas.length !== 1 || centros.length !== 1) return false;
  const pn = pct(naturezas[0]!.percentual);
  const pc = pct(centros[0]!.percentual);
  const cem = (x: ReturnType<typeof D>) => x.eq(0) || x.eq(100);
  return cem(pn) && cem(pc);
}
