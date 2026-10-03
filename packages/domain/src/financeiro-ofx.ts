import { D, Decimal, DomainError, isISODate, money } from "@agro/shared";

/**
 * Extrato OFX e sugestões de conciliação (decisão 285). Tudo em decimal: o valor do extrato é lido como TEXTO e
 * normalizado para string com ponto e 2 casas; as somas das sugestões são em CENTAVOS inteiros — nunca ponto
 * flutuante (o parser antigo fazia `Number(...)` e casava só valor e data exatos).
 */
export interface ContaDoOfx { banco: string | null; agencia: string | null; conta: string | null }
/** `valor` com sinal (entrada +, saída −), 2 casas, ponto decimal. */
export interface TransacaoOfx { fitid: string; data: string; valor: string; memo: string | null; numeroCheque: string | null }
export interface LeituraOfx { conta: ContaDoOfx; transacoes: TransacaoOfx[]; recusadas: { fitid: string | null; motivo: string }[] }

const VALOR_CANONICO = /^-?\d+(\.\d{1,2})?$/;

/** Parte inteira com separador de milhar: 1º grupo com dígitos, os demais com EXATAMENTE 3. */
function inteiroComMilhar(parte: string, separador: "." | ","): string | null {
  const grupos = parte.split(separador);
  if (!/^\d+$/.test(grupos[0] ?? "")) return null;
  for (const g of grupos.slice(1)) if (!/^\d{3}$/.test(g)) return null;
  return grupos.join("");
}

/**
 * Valor do extrato em texto → decimal canônico com sinal, ou `null` quando não dá para ler SEM adivinhar.
 * - Espaços e um `+` inicial saem.
 * - Com `.` e `,`: o separador que aparece POR ÚLTIMO é o decimal; o outro é milhar (grupos de 3) e sai.
 * - Só `,` (uma): vírgula decimal. Mais de uma vírgula: `null`.
 * - Só `.`: um ponto é decimal; vários pontos são milhar só se todo grupo após o 1º tiver 3 dígitos (inteiro).
 * - O resultado tem de ter no máximo 2 casas: "12.345" (um ponto, 3 casas) é ambíguo e vira `null`.
 */
export function valorDoOfx(texto: string): string | null {
  const m = /^([+-]?)([\d.,]+)$/.exec(texto.replace(/\s+/g, ""));
  if (!m) return null;
  const sinal = m[1] === "-" ? "-" : "";
  const corpo = m[2]!;
  const ponto = corpo.lastIndexOf(".");
  const virgula = corpo.lastIndexOf(",");
  let normal: string | null;
  if (ponto >= 0 && virgula >= 0) {
    const decimal = ponto > virgula ? "." : ",";
    const i = corpo.lastIndexOf(decimal);
    const inteiro = inteiroComMilhar(corpo.slice(0, i), decimal === "." ? "," : ".");
    const fracao = corpo.slice(i + 1);
    normal = inteiro !== null && /^\d+$/.test(fracao) ? `${inteiro}.${fracao}` : null;
  } else if (virgula >= 0) {
    normal = corpo.indexOf(",") === virgula ? corpo.replace(",", ".") : null;
  } else if (ponto >= 0) {
    normal = corpo.indexOf(".") === ponto ? corpo : inteiroComMilhar(corpo, ".");
  } else {
    normal = corpo;
  }
  if (normal === null) return null;
  const resultado = sinal + normal;
  if (!VALOR_CANONICO.test(resultado)) return null;
  return money(resultado);
}

/** Conteúdo de uma tag OFX (SGML `<TAG>valor` ou XML `<TAG>valor</TAG>`); vazio vira `null`. */
function tag(trecho: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, "i").exec(trecho);
  const v = m ? m[1]!.trim() : "";
  return v === "" ? null : v;
}

const ENTIDADES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const texto = (v: string | null): string | null => (v === null ? null : v.replace(/&(amp|lt|gt|quot|apos);/g, (e) => ENTIDADES[e] ?? e));

function contaDoTrecho(trecho: string): ContaDoOfx {
  const inicio = trecho.search(/<(BANKACCTFROM|CCACCTFROM)>/i);
  if (inicio < 0) return { banco: null, agencia: null, conta: null };
  const resto = trecho.slice(inicio);
  const fim = resto.search(/<\/(BANKACCTFROM|CCACCTFROM)>|<BANKTRANLIST>|<STMTTRN>/i);
  const bloco = fim < 0 ? resto : resto.slice(0, fim);
  return { banco: tag(bloco, "BANKID"), agencia: tag(bloco, "BRANCHID"), conta: tag(bloco, "ACCTID") };
}

const significativos = (v: string | null): string => (v ?? "").replace(/\D/g, "").replace(/^0+/, "");
/** Trecho do arquivo citado num motivo de recusa: curto, para um arquivo torto não inflar a resposta. */
const citado = (v: string): string => (v.length > 40 ? `${v.slice(0, 40)}…` : v);

/** `DTPOSTED` (AAAAMMDD[HHMMSS[.XXX]][[fuso]]) → data ISO válida, ou `null`. */
function dataDoOfx(v: string | null): string | null {
  const m = v === null ? null : /^(\d{4})(\d{2})(\d{2})/.exec(v);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return isISODate(iso) ? iso : null;
}

/**
 * Lê um extrato OFX (SGML ou XML). A conta vem de `BANKACCTFROM` (ou `CCACCTFROM`): `BANKID`, `BRANCHID`, `ACCTID`.
 * Cada `<STMTTRN>` vira uma transação ou uma RECUSADA com o motivo — nada é descartado em silêncio:
 * sem FITID; data inválida; valor ilegível ou ausente; valor zero; FITID repetido no arquivo (a importação guarda um
 * FITID por arquivo); transação de um extrato de OUTRA conta no mesmo arquivo.
 */
export function lerOfx(conteudo: string): LeituraOfx {
  const partes = conteudo.split(/<(?:STMTRS|CCSTMTRS)>/i);
  const extratos = partes.length > 1 ? partes.slice(1) : partes;
  const conta = contaDoTrecho(extratos[0] ?? "");
  const contaDoArquivo = significativos(conta.conta);
  const transacoes: TransacaoOfx[] = [];
  const recusadas: { fitid: string | null; motivo: string }[] = [];
  const aceitos = new Set<string>();

  extratos.forEach((extrato, indice) => {
    const contaDoExtrato = indice === 0 ? conta : contaDoTrecho(extrato);
    const outraConta = indice > 0 && significativos(contaDoExtrato.conta) !== contaDoArquivo;
    for (const pedaco of extrato.split(/<STMTTRN>/i).slice(1)) {
      const fimDoBloco = pedaco.search(/<\/STMTTRN>|<\/BANKTRANLIST>/i);
      const bloco = fimDoBloco < 0 ? pedaco : pedaco.slice(0, fimDoBloco);
      const fitid = tag(bloco, "FITID");
      if (fitid === null) { recusadas.push({ fitid: null, motivo: "Transação sem identificador (FITID)" }); continue; }
      if (outraConta) { recusadas.push({ fitid, motivo: `Transação de outra conta do arquivo (conta ${citado(contaDoExtrato.conta ?? "não informada")})` }); continue; }
      const data = dataDoOfx(tag(bloco, "DTPOSTED"));
      if (data === null) { recusadas.push({ fitid, motivo: "Data inválida" }); continue; }
      const bruto = tag(bloco, "TRNAMT");
      const valor = bruto === null ? null : valorDoOfx(bruto);
      if (valor === null) { recusadas.push({ fitid, motivo: `Valor inválido no extrato: ${citado(bruto ?? "(vazio)")}` }); continue; }
      if (D(valor).isZero()) { recusadas.push({ fitid, motivo: "Valor zero" }); continue; }
      if (aceitos.has(fitid)) { recusadas.push({ fitid, motivo: "Transação repetida no arquivo (mesmo FITID)" }); continue; }
      aceitos.add(fitid);
      transacoes.push({ fitid, data, valor, memo: texto(tag(bloco, "MEMO") ?? tag(bloco, "NAME")), numeroCheque: tag(bloco, "CHECKNUM") });
    }
  });
  return { conta, transacoes, recusadas };
}

/**
 * Menor sufixo que conta como "a mesma conta" quando os números não são iguais: com menos dígitos, o "termina com"
 * casaria contas diferentes (o cadastro "1" casaria com todo ACCTID terminado em 1) — aí só a igualdade vale.
 */
export const MIN_DIGITOS_DO_SUFIXO_DA_CONTA = 4;

/**
 * A conta do arquivo é a conta cadastrada? Só dígitos, sem zeros à esquerda; `true` se iguais ou se um termina com o
 * outro e o mais curto tem pelo menos `MIN_DIGITOS_DO_SUFIXO_DA_CONTA` dígitos (o OFX costuma trazer a agência antes
 * e zeros à esquerda). `null` quando um dos lados não tem dígitos: não dá para conferir.
 */
export function contaDoOfxConfere(conta: ContaDoOfx, numeroDaConta: string | null): boolean | null {
  const doArquivo = (conta.conta ?? "").replace(/\D/g, "");
  const cadastrada = (numeroDaConta ?? "").replace(/\D/g, "");
  if (doArquivo === "" || cadastrada === "") return null;
  const a = doArquivo.replace(/^0+/, "");
  const b = cadastrada.replace(/^0+/, "");
  // Só zeros de um lado: "termina com" seria sempre verdadeiro com o vazio — compara igualdade.
  if (a === "" || b === "") return a === b;
  if (a === b) return true;
  const [curta, longa] = a.length <= b.length ? [a, b] : [b, a];
  return curta.length >= MIN_DIGITOS_DO_SUFIXO_DA_CONTA && longa.endsWith(curta);
}

/** Movimento ainda não conciliado da conta. `valor` com sinal (entrada +, saída −) = `amount + interest`. */
export interface MovimentoCandidato { id: string; data: string; valor: string }
export type TipoSugestao = "encontrado" | "sugestao" | "soma" | "nenhuma";
export interface SugestaoConciliacao { transacaoId: string; tipo: TipoSugestao; grupos: string[][] }

const MS_POR_DIA = 86_400_000;
function diaDaData(v: string): number | null {
  const iso = v.slice(0, 10);
  if (!isISODate(iso)) return null;
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / MS_POR_DIA;
}
function centavos(v: string): bigint | null {
  try {
    return BigInt(D(v).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toFixed(0));
  } catch {
    return null;
  }
}
const sinalDe = (c: bigint): number => (c > 0n ? 1 : c < 0n ? -1 : 0);
const abs = (c: bigint): bigint => (c < 0n ? -c : c);
const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function opcao(nome: string, v: number | undefined, padrao: number, min: number, max: number): number {
  if (v === undefined) return padrao;
  if (!Number.isInteger(v) || v < min || v > max) throw new DomainError("VALIDATION_ERROR", "Opções da sugestão de conciliação inválidas", { opcao: nome, min, max });
  return v;
}

interface Movimento { id: string; data: string; dia: number; centavos: bigint }

/**
 * Sugestões de conciliação por transação, DETERMINÍSTICAS (mesma entrada → mesma saída), na ordem das transações:
 * 1. movimentos com o MESMO valor e a MESMA data: um só → `encontrado`; dois ou mais → `sugestao` (um grupo cada).
 *    `encontrado` exige também que aquele movimento não seja o exato de OUTRA transação da lista: o encontrado é
 *    1:1, e dois extratos iguais disputando um movimento ficam como `sugestao` (decisão humana);
 * 2. senão, mesmo valor com |Δdias| ≤ janela → `sugestao`, por |Δdias|, data e id;
 * 3. senão, de 2 a `maxItensSoma` movimentos do MESMO sinal na janela (até `maxCandidatosSoma`, os mais próximos em
 *    data) cuja soma é o valor → `soma`, até `maxGrupos` grupos (menos itens, menor Σ|Δdias|, ids);
 * 4. senão `nenhuma`.
 * Só "encontrado" é candidato a conciliação automática; os demais pedem confirmação.
 */
export function sugerirConciliacao(
  transacoes: readonly { id: string; data: string; valor: string }[],
  movimentos: readonly MovimentoCandidato[],
  opcoes?: { janelaDias?: number; maxItensSoma?: number; maxCandidatosSoma?: number; maxGrupos?: number }
): SugestaoConciliacao[] {
  const janela = opcao("janelaDias", opcoes?.janelaDias, 3, 0, 31);
  const maxItens = opcao("maxItensSoma", opcoes?.maxItensSoma, 4, 1, 5);
  const maxCandidatos = opcao("maxCandidatosSoma", opcoes?.maxCandidatosSoma, 12, 0, 16);
  const maxGrupos = opcao("maxGrupos", opcoes?.maxGrupos, 3, 1, 20);

  const movs: Movimento[] = [];
  for (const m of movimentos) {
    const dia = diaDaData(m.data);
    const c = centavos(m.valor);
    if (dia !== null && c !== null) movs.push({ id: m.id, data: m.data.slice(0, 10), dia, centavos: c });
  }
  const lidas = transacoes.map((t) => ({ id: t.id, dia: diaDaData(t.data), centavos: centavos(t.valor) }));
  // Índice por (dia, centavos): o casamento exato não varre a lista de movimentos a cada transação.
  const porDiaEValor = new Map<string, Movimento[]>();
  for (const m of movs) {
    const chave = `${m.dia}|${m.centavos}`;
    const lista = porDiaEValor.get(chave);
    if (lista) lista.push(m); else porDiaEValor.set(chave, [m]);
  }
  const exatosDe = (t: (typeof lidas)[number]): Movimento[] =>
    t.dia === null || t.centavos === null ? [] : (porDiaEValor.get(`${t.dia}|${t.centavos}`) ?? []).slice();

  // Quantas transações têm cada movimento como exato (para o "encontrado" ser 1:1).
  const disputa = new Map<string, number>();
  for (const t of lidas) for (const m of exatosDe(t)) disputa.set(m.id, (disputa.get(m.id) ?? 0) + 1);

  return lidas.map((t): SugestaoConciliacao => {
    if (t.dia === null || t.centavos === null) return { transacaoId: t.id, tipo: "nenhuma", grupos: [] };
    const dia = t.dia;
    const alvo = t.centavos;
    const delta = (m: Movimento) => Math.abs(m.dia - dia);
    const ordem = (a: Movimento, b: Movimento) => delta(a) - delta(b) || porTexto(a.data, b.data) || porTexto(a.id, b.id);

    const exatos = exatosDe(t).sort(ordem);
    if (exatos.length === 1 && disputa.get(exatos[0]!.id) === 1) return { transacaoId: t.id, tipo: "encontrado", grupos: [[exatos[0]!.id]] };
    if (exatos.length >= 1) return { transacaoId: t.id, tipo: "sugestao", grupos: exatos.map((m) => [m.id]) };

    const proximos = movs.filter((m) => m.centavos === alvo && delta(m) <= janela).sort(ordem);
    if (proximos.length) return { transacaoId: t.id, tipo: "sugestao", grupos: proximos.map((m) => [m.id]) };

    // Soma: todos do mesmo sinal, cada um menor (em módulo) que o alvo — então a soma parcial só cresce e poda.
    const sinal = sinalDe(alvo);
    const alvoAbs = abs(alvo);
    const candidatos = sinal === 0 || maxItens < 2
      ? []
      : movs.filter((m) => sinalDe(m.centavos) === sinal && abs(m.centavos) < alvoAbs && delta(m) <= janela).sort(ordem).slice(0, maxCandidatos);
    const achados: { itens: Movimento[]; deltaTotal: number }[] = [];
    const escolha: Movimento[] = [];
    const buscar = (inicio: number, soma: bigint) => {
      if (escolha.length >= 2 && soma === alvoAbs) {
        achados.push({ itens: escolha.slice(), deltaTotal: escolha.reduce((s, m) => s + delta(m), 0) });
        return;
      }
      if (escolha.length >= maxItens) return;
      for (let i = inicio; i < candidatos.length; i++) {
        const m = candidatos[i]!;
        const nova = soma + abs(m.centavos);
        if (nova > alvoAbs) continue;
        escolha.push(m);
        buscar(i + 1, nova);
        escolha.pop();
      }
    };
    buscar(0, 0n);
    if (!achados.length) return { transacaoId: t.id, tipo: "nenhuma", grupos: [] };
    const grupos = achados
      .map((g) => ({ ...g, itens: g.itens.slice().sort((a, b) => porTexto(a.data, b.data) || porTexto(a.id, b.id)) }))
      .sort((a, b) => {
        if (a.itens.length !== b.itens.length) return a.itens.length - b.itens.length;
        if (a.deltaTotal !== b.deltaTotal) return a.deltaTotal - b.deltaTotal;
        for (let i = 0; i < a.itens.length; i++) {
          const c = porTexto(a.itens[i]!.id, b.itens[i]!.id);
          if (c) return c;
        }
        return 0;
      })
      .slice(0, maxGrupos)
      .map((g) => g.itens.map((m) => m.id));
    return { transacaoId: t.id, tipo: "soma", grupos };
  });
}
