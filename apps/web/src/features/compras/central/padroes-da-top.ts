import { FORMA_UUID_PADRAO, perfilDosPadroesFinanceiros } from "@agro/domain";
import type { ItemRow } from "@/features/docs/shared";
import type {
  ContaPadraoDaTop, PadraoComCodigo, PadraoComNome, PadroesFinanceirosDaTop, SecaoFinanceiraDaTop
} from "@/features/central/contrato";

/**
 * LANCAMENTO-01 (decisão 311) — OS PADRÕES DA TOP NA CRIAÇÃO DA CENTRAL DE COMPRAS: contas PURAS, sem React e sem rede
 * (o estado, `estado.ts`, só as chama — e o teste de unidade as prova uma a uma).
 *
 * A REGRA DO DONO: o lançamento só pergunta o que o sistema não pode saber. A constante da TOP (natureza, centro, forma
 * de pagamento, tipo de título) já está na TOP: a tela a SEMEIA no campo vazio. O corolário (D3): o valor derivado NÃO
 * vai no corpo QUANDO O SERVIDOR JÁ O DECIDE na confirmação; onde ele não decide, o valor é do documento e vai no corpo,
 * como hoje. A precedência (D2): operador > padrão de cadastro do LAYOUT (vai no corpo, como hoje) > padrão da TOP (só
 * campo vazio) > o servidor na confirmação.
 *
 *   · LEITOR (`lerPadroesDaTop`): `secao` e `padroes` de `regras-da-operacao`, fail-closed. Ausentes (a API anterior) ou
 *     fora da forma ⇒ `null` — a tela de hoje, byte a byte. Um padrão com id e sem o rótulo resolvido não semeia e dá o
 *     aviso de padrão inválido de hoje.
 *   · QUANDO VALE (`padroesDaTopAplicam`): criação (nunca o receber), padrões ≠ null e o documento que o servidor
 *     classifica pela TOP — a compra que gera título, o pedido cuja TOP provisiona. Fora disso: nada semeado, travado
 *     ou omitido.
 *   · O QUE SE SEMEIA (`planoDaSemeadura`): natureza e centro só como PAR; a forma só quando cobrada; o tipo de título
 *     dos dados fiscais.
 *   · O QUE SAI DO CORPO (`omissaoDoCorpo`): o par natureza+centro que a TOP semeou (o servidor aplica o mesmo par) e o
 *     tipo de título semeado (a confirmação usa o da TOP). A forma semeada VAI (o servidor nunca a tira da TOP).
 *   · O QUE TRAVA (`podeTrocarOsPadroes`, `travadoPelaTop`): a TOP que não deixa o documento trocar os padrões trava o
 *     campo cujo valor é o padrão dela — apresentação; quem recusa a troca é o servidor.
 *   · O LOCAL DA LINHA NOVA (`localDasLinhasNovas`): o local de estoque padrão do PRODUTO, conferido na empresa do
 *     documento, acima do padrão do cabeçalho e abaixo da resposta do operador.
 *
 * Nenhum código de família escrito aqui: o perfil sai do domínio (`perfilDosPadroesFinanceiros`).
 */

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const tem = (o: Record<string, unknown>, k: string) => Object.hasOwn(o, k);
const vazio = (v: string) => v.trim() === "";
/** Ids comparados como o servidor os compara (`camposTrocadosDosPadroes`): aparados e em minúsculas. */
export const mesmoId = (a: string | null | undefined, b: string | null | undefined): boolean =>
  typeof a === "string" && typeof b === "string" && !vazio(a) && a.trim().toLowerCase() === b.trim().toLowerCase();

/* ═════════════════════════════════════ O CONTRATO LIDO ═════════════════════════════════════ */

/** Os padrões que têm campo na Central de Compras. A conta prevista não tem campo (só a TOP a sabe): nada a semear. */
export type PadraoDaTopNaCompra = "natureza" | "centro" | "formaPagamento" | "tipoTitulo";
/** O campo de cada padrão: do cabeçalho (natureza, centro, forma) ou dos dados fiscais (o tipo de título). */
export const CAMPO_DO_PADRAO_DA_TOP = Object.freeze({
  natureza: "categoria_financeira_id", centro: "centro_custo_id", formaPagamento: "forma_pagamento_id", tipoTitulo: "tipo_titulo_id"
} as const satisfies Record<PadraoDaTopNaCompra, string>);
export type CampoDoPadraoDaTop = (typeof CAMPO_DO_PADRAO_DA_TOP)[PadraoDaTopNaCompra];
const PADRAO_DO_CAMPO: ReadonlyMap<string, PadraoDaTopNaCompra> = new Map(
  (Object.entries(CAMPO_DO_PADRAO_DA_TOP) as [PadraoDaTopNaCompra, CampoDoPadraoDaTop][]).map(([p, c]) => [c, p]));
/** O padrão da TOP que preenche o campo, ou `null` (campo que a TOP não preenche). */
export const padraoDoCampo = (campo: string): PadraoDaTopNaCompra | null => PADRAO_DO_CAMPO.get(campo) ?? null;

export interface PadroesDaTopLidos {
  secao: SecaoFinanceiraDaTop;
  /** `null`: o servidor disse que a versão não tem padrões (ou não os executa). Entrada inválida vem aqui como `null`. */
  padroes: PadroesFinanceirosDaTop | null;
  /** Os padrões que o servidor mandou com id e SEM o rótulo resolvido: não semeiam e dão o aviso de padrão inválido. */
  invalidos: ReadonlySet<keyof PadroesFinanceirosDaTop>;
}

/** Uma entrada de padrão: `null` (sem padrão), a entrada conferida, "invalida" (id sem rótulo) ou "forma" (fora da forma). */
type EntradaLida<T> = { valor: T | null } | "invalida" | "forma";
const texto = (v: unknown): v is string => typeof v === "string";
const nomeResolvido = (v: unknown): v is string => texto(v) && !vazio(v);
function entrada<T>(v: unknown, montar: (o: Record<string, unknown> & { id: string }) => T | null): EntradaLida<T> {
  if (v === null) return { valor: null };
  // id que não é UUID não é padrão de cadastro: a forma toda é estranha (nunca "um padrão a menos")
  if (!ehObj(v) || !texto(v.id) || !FORMA_UUID_PADRAO.test(v.id)) return "forma";
  const valor = montar(v as Record<string, unknown> & { id: string });
  return valor === null ? "invalida" : { valor };
}
const comCodigo = (o: Record<string, unknown> & { id: string }): PadraoComCodigo | null =>
  (texto(o.codigo) && nomeResolvido(o.nome) ? { id: o.id, codigo: o.codigo, nome: o.nome } : null);
const comNome = (o: Record<string, unknown> & { id: string }): PadraoComNome | null => (nomeResolvido(o.nome) ? { id: o.id, nome: o.nome } : null);
const daConta = (o: Record<string, unknown> & { id: string }): ContaPadraoDaTop | null =>
  (texto(o.codigo) && nomeResolvido(o.descricao) ? { id: o.id, codigo: o.codigo, descricao: o.descricao } : null);

/**
 * `secao` e `padroes` da resposta de `regras-da-operacao` (a forma de `GET /api/financeiro/tops`), FAIL-CLOSED:
 *   · a resposta sem `secao` ou sem `padroes` (a API anterior) ⇒ `null` — a tela de hoje;
 *   · `secao` fora da forma (`provisao`/`documentoTroca` não booleanos, `semClassificacao` não texto) ⇒ `null`;
 *   · `padroes: null` ⇒ a seção, sem padrões (nada a semear);
 *   · `padroes` que não é objeto, sem uma das cinco chaves, ou com uma entrada que não é `null` nem `{ id: <uuid>, … }`
 *     ⇒ `null` (forma estranha não vira "um padrão a menos": a tela de hoje inteira);
 *   · entrada com id e sem o rótulo resolvido (sem `nome`; sem `codigo` onde o contrato o tem; a conta sem `descricao`)
 *     ⇒ aquele padrão fica `null` e entra em `invalidos` (o aviso de padrão inválido), os outros valem.
 * Só as chaves do contrato são copiadas: o que mais vier não entra na tela.
 */
export function lerPadroesDaTop(resposta: unknown): PadroesDaTopLidos | null {
  if (!ehObj(resposta) || !tem(resposta, "secao") || !tem(resposta, "padroes")) return null;
  const s = resposta.secao;
  if (!ehObj(s) || typeof s.provisao !== "boolean" || typeof s.documentoTroca !== "boolean" || !texto(s.semClassificacao)) return null;
  const secao: SecaoFinanceiraDaTop = { provisao: s.provisao, documentoTroca: s.documentoTroca, semClassificacao: s.semClassificacao };
  const p = resposta.padroes;
  if (p === null) return { secao, padroes: null, invalidos: new Set() };
  if (!ehObj(p)) return null;
  const chaves = ["natureza", "centro", "tipoTitulo", "formaPagamento", "conta"] as const;
  if (!chaves.every((k) => tem(p, k))) return null;
  const lidas = {
    natureza: entrada(p.natureza, comCodigo), centro: entrada(p.centro, comCodigo),
    tipoTitulo: entrada(p.tipoTitulo, comNome), formaPagamento: entrada(p.formaPagamento, comNome), conta: entrada(p.conta, daConta)
  };
  if (Object.values(lidas).some((x) => x === "forma")) return null;
  const invalidos = new Set<keyof PadroesFinanceirosDaTop>(chaves.filter((k) => lidas[k] === "invalida"));
  const valor = <T>(x: EntradaLida<T>): T | null => (typeof x === "object" ? x.valor : null);
  return {
    secao, invalidos,
    padroes: {
      natureza: valor(lidas.natureza), centro: valor(lidas.centro), tipoTitulo: valor(lidas.tipoTitulo),
      formaPagamento: valor(lidas.formaPagamento), conta: valor(lidas.conta)
    }
  };
}

/* ═════════════════════════════════════ QUANDO VALE ═════════════════════════════════════ */

/**
 * `podeTrocar` = a seção deixa o documento trocar (`documentoTroca`) E a família é das em que o documento INFORMA os
 * padrões (`trocaPeloDocumento` do perfil do domínio). AND, nunca OR: a solicitação de compra (`trocaPeloDocumento`
 * falso) não troca nem com `documentoTroca` ligado. Família sem perfil ⇒ `false` (o servidor nem manda padrões a ela).
 */
export function podeTrocarOsPadroes(secao: SecaoFinanceiraDaTop, familia: string): boolean {
  return secao.documentoTroca && perfilDosPadroesFinanceiros(familia)?.trocaPeloDocumento === true;
}

/**
 * `aplica` — os padrões da TOP valem neste formulário: a CRIAÇÃO (nunca o receber: as linhas e o cabeçalho vêm do
 * pedido; nunca a consulta) ∧ padrões ≠ null ∧ o documento que o servidor classifica pela TOP no salvar
 * (`padroesDaTopNoSalvarDaCompra`): a compra que gera título (`regras.geraTitulos`), o pedido cuja TOP provisiona
 * (`secao.provisao`). Fora disso: nada semeado, nada travado, nada omitido — a tela de hoje.
 */
export function padroesDaTopAplicam(p: { modo: "criacao" | "receber"; ehCompra: boolean; lidos: PadroesDaTopLidos | null; geraTitulos: boolean | null }): boolean {
  if (p.modo !== "criacao" || !p.lidos || p.lidos.padroes === null) return false;
  return p.ehCompra ? p.geraTitulos === true : p.lidos.secao.provisao === true;
}

/* ═════════════════════════════════════ O QUE SE SEMEIA ═════════════════════════════════════ */

/** O que a TOP semeou, campo a campo (a cópia que o estado guarda; a REGRA do corpo a consulta). */
export type Semeadura = Partial<Record<CampoDoPadraoDaTop, string>>;

/**
 * Os valores que a tela mostra DEPOIS do padrão de cadastro do layout (e da cópia do Duplicar), nos campos que o
 * operador ainda não tocou. `tipoTitulo: null` = sem o bloco de dados fiscais (o campo não existe).
 */
export interface ValoresAntesDaTop { natureza: string; centro: string; formaPagamento: string; tipoTitulo: string | null }

/**
 * O PLANO DA SEMEADURA — só em campo VAZIO (o layout e a cópia vêm antes e nunca são sobrescritos):
 *   · natureza e centro só como PAR: a TOP tem os DOIS e, depois do layout, cada um está vazio ou já é o da TOP. Layout
 *     ou cópia com o centro (ou a natureza) ≠ o da TOP ⇒ nada (a tela mostraria um par que o servidor não aplica: o
 *     servidor classifica pelo par, e o salvar recusa a natureza sem o centro);
 *   · a forma de pagamento só quando COBRADA (a regra da TOP a exige ou o layout a marca obrigatória): ela VAI no corpo
 *     — o servidor nunca a tira da TOP —, e semear a opcional mudaria o que se grava hoje;
 *   · o tipo de título dos dados fiscais, quando o bloco existe.
 * `livre` (padrão: todos): o campo que o OPERADOR já tocou não é semeado, mesmo vazio — esvaziar é resposta dele. No
 * par, um dos dois tocado ⇒ nenhum dos dois (semear meio par mandaria a natureza sem o centro, que o salvar recusa).
 */
export function planoDaSemeadura(padroes: PadroesFinanceirosDaTop, v: ValoresAntesDaTop, o: { formaCobrada: boolean; livre?: (campo: CampoDoPadraoDaTop) => boolean }): Semeadura {
  const livre = o.livre ?? (() => true);
  const out: Semeadura = {};
  const n = padroes.natureza?.id; const c = padroes.centro?.id;
  if (n && c && (vazio(v.natureza) || mesmoId(v.natureza, n)) && (vazio(v.centro) || mesmoId(v.centro, c))) {
    const par: Semeadura = {};
    if (vazio(v.natureza)) par.categoria_financeira_id = n;
    if (vazio(v.centro)) par.centro_custo_id = c;
    if ((Object.keys(par) as CampoDoPadraoDaTop[]).every(livre)) Object.assign(out, par);
  }
  const f = padroes.formaPagamento?.id;
  if (f && o.formaCobrada && vazio(v.formaPagamento) && livre("forma_pagamento_id")) out.forma_pagamento_id = f;
  const t = padroes.tipoTitulo?.id;
  if (t && v.tipoTitulo !== null && vazio(v.tipoTitulo) && livre("tipo_titulo_id")) out.tipo_titulo_id = t;
  return out;
}

/* ═════════════════════════════════════ O QUE SAI DO CORPO ═════════════════════════════════════ */

export interface OmissaoDoCorpo {
  /** Natureza E centro saem do corpo (juntos, sempre: o par). */
  classificacao: boolean;
  /** O tipo de título dos dados fiscais sai do corpo. */
  tipoTitulo: boolean;
}

/**
 * O que o servidor COBRA SOBRE O CORPO no salvar, ANTES de olhar os padrões da TOP (e sem saber deles): o obrigatório do
 * layout configurado (`cobrarLayoutDaCompra`) e as exigências gerais da TOP (`cobrarRegrasDaCompra` →
 * `exigenciasGeraisFaltando`, que roda antes de `padroesDaTopNoSalvarDaCompra`). `exigenciasGerais` é o `exigencias` de
 * `regras-da-operacao` — o MESMO dado de `camposExigidosPelaRegra`, nunca uma segunda lista.
 */
export interface CobrancaNoCorpo {
  obrigatorioNoLayout: (campo: string) => boolean;
  exigenciasGerais: readonly string[];
}
/** O campo é cobrado sobre o corpo antes da TOP: o obrigatório do layout OU uma exigência geral da TOP. */
export const cobradoNoCorpo = (campo: string, c: CobrancaNoCorpo): boolean => c.obrigatorioNoLayout(campo) || c.exigenciasGerais.includes(campo);

/**
 * A REGRA DO CORPO (D3 do dono: o derivado não vai no corpo quando o servidor já o decide; onde ele NÃO decide, o valor
 * é do documento e vai no corpo COMO HOJE — e hoje o corpo não leva o que o operador não escolheu). Natureza e centro
 * saem JUNTOS, só se:
 *   aplica ∧ os DOIS foram semeados pela TOP ∧ a tela ainda mostra os dois semeados (= o par da TOP) ∧ NENHUM dos dois é
 *   COBRADO SOBRE O CORPO pelo servidor antes de ele olhar a TOP (`cobradoNoCorpo`): o obrigatório do layout
 *   (`cobrarLayoutDaCompra`) e as exigências gerais da TOP (`cobrarRegrasDaCompra` → `exigenciasGeraisFaltando`, no salvar
 *   ANTES de `padroesDaTopNoSalvarDaCompra`) — omitir um campo cobrado ali seria a recusa "… é obrigatório nesta
 *   operação." para sempre, com o par da TOP na tela.
 * O TOTAL não entra: com a compra de total zero não há título, e o servidor nem usa nem cobra o par (a exigência do título
 * sai cedo e os padrões no salvar não fazem nada) — o semeado fica só exibido, FORA do corpo, e o documento grava o de
 * hoje (sem natureza e centro), nunca um par que o operador não escolheu.
 * Por que juntos: o salvar RECUSA a natureza sem o centro (e o contrário) antes de olhar a TOP — "Informe a natureza e o
 * centro de resultado juntos". O que veio do layout (ou da cópia) vai no corpo como hoje, mesmo igual ao da TOP; então
 * um par com metade do layout e metade da TOP vai INTEIRO. O operador que mudou um do par manda os DOIS (senão o
 * servidor aplicaria o par da TOP e descartaria a escolha dele).
 * O tipo de título semeado sai (a confirmação usa `tipo do documento ?? o da TOP`). A forma semeada sempre vai.
 */
export function omissaoDoCorpo(p: {
  aplica: boolean; padroes: PadroesFinanceirosDaTop | null; semeado: Semeadura;
  natureza: string; centro: string; tipoTitulo: string;
  /** O que o servidor cobra SOBRE O CORPO antes de olhar a TOP (`cobradoNoCorpo`). */
  cobrancaNoCorpo: CobrancaNoCorpo;
}): OmissaoDoCorpo {
  if (!p.aplica || !p.padroes) return { classificacao: false, tipoTitulo: false };
  const s = p.semeado;
  const classificacao = mesmoId(s.categoria_financeira_id, p.padroes.natureza?.id) && mesmoId(s.centro_custo_id, p.padroes.centro?.id)
    && mesmoId(p.natureza, s.categoria_financeira_id) && mesmoId(p.centro, s.centro_custo_id)
    && !cobradoNoCorpo("categoria_financeira_id", p.cobrancaNoCorpo) && !cobradoNoCorpo("centro_custo_id", p.cobrancaNoCorpo);
  const tipoTitulo = mesmoId(s.tipo_titulo_id, p.padroes.tipoTitulo?.id) && mesmoId(p.tipoTitulo, s.tipo_titulo_id);
  return { classificacao, tipoTitulo };
}

/* ═════════════════════════════════════ TRAVA, DICA E AVISO ═════════════════════════════════════ */

const idDoPadrao = (padroes: PadroesFinanceirosDaTop | null, campo: string): string | null => {
  const k = padraoDoCampo(campo);
  return padroes && k ? padroes[k]?.id ?? null : null;
};

/**
 * TRAVA (`!podeTrocar ∧ aplica`): o campo cujo valor É o padrão da TOP. O campo vazio ou com outro valor (o do layout, o
 * da cópia) não trava: o salvar recusa a troca como hoje, e o operador precisa poder corrigir.
 */
export function travadoPelaTop(p: { aplica: boolean; podeTrocar: boolean; padroes: PadroesFinanceirosDaTop | null; campo: string; valor: string }): boolean {
  return p.aplica && !p.podeTrocar && mesmoId(p.valor, idDoPadrao(p.padroes, p.campo));
}

/** O rótulo do padrão: "código · nome" na natureza e no centro (só o nome sem código); o nome na forma e no tipo de título. */
export function rotuloDoPadraoDaTop(padroes: PadroesFinanceirosDaTop | null, campo: string): string | null {
  const k = padraoDoCampo(campo);
  if (!padroes || !k) return null;
  if (k === "natureza" || k === "centro") {
    const x = padroes[k];
    return x ? (vazio(x.codigo) ? x.nome : `${x.codigo} · ${x.nome}`) : null;
  }
  return padroes[k]?.nome ?? null;
}

/** A DICA (o rótulo ao `RefSelect`) enquanto o valor do campo é o padrão da TOP. O padrão do layout vem antes (no estado). */
export function dicaDaTop(p: { aplica: boolean; padroes: PadroesFinanceirosDaTop | null; campo: string; valor: string }): string | undefined {
  if (!p.aplica || !mesmoId(p.valor, idDoPadrao(p.padroes, p.campo))) return undefined;
  return rotuloDoPadraoDaTop(p.padroes, p.campo) ?? undefined;
}

/** O AVISO de padrão inválido: a TOP mandou o padrão do campo com id e sem o rótulo (o campo não foi semeado). */
export function padraoDaTopInvalido(aplica: boolean, lidos: PadroesDaTopLidos | null, campo: string): boolean {
  const k = padraoDoCampo(campo);
  return aplica && lidos !== null && k !== null && lidos.invalidos.has(k);
}

/* ═════════════════════════════════════ O LOCAL DA LINHA NOVA ═════════════════════════════════════ */

/** O `default_warehouse_id` do cadastro do produto (`GET /api/resources/products/:id`), só com forma de UUID. */
export function localDoCadastroDoProduto(produto: unknown): string | null {
  const l = ehObj(produto) ? produto["default_warehouse_id"] : undefined;
  return texto(l) && FORMA_UUID_PADRAO.test(l) ? l : null;
}

/**
 * O local é da EMPRESA do documento e está ativo? A resposta de `GET /api/resources/warehouses/options?empresa_id=<a
 * empresa>&id=<o local>` — `[local]` quando é, `[]` quando não. Resposta que não é a lista com o próprio local (vazia,
 * erro, forma estranha) ⇒ não: o local é IGNORADO (nunca usado).
 */
export function localConfirmadoNaEmpresa(resposta: unknown, local: string): boolean {
  return Array.isArray(resposta) && resposta.some((o) => ehObj(o) && texto(o.id) && mesmoId(o.id, local));
}

/**
 * A chave da LINHA que guarda de quem é o local dela (o motor da grade preserva as chaves que não desenha — o mesmo
 * molde de `CLASSIFICACAO_DO_ITEM`: a marca anda com a linha quando ela é duplicada, removida ou reordenada, nunca num
 * índice paralelo). Nunca vai no corpo (o corpo lê só as chaves dele).
 *   · `{ dono: "operador" }` — a resposta do operador: nada a mexe (o ajuste na célula; a linha nascida com o local do
 *     cabeçalho ESCOLHIDO por ele; a linha da cópia, que já veio com produto);
 *   · `{ dono: "sistema", base, atual }` — o local que o sistema pôs: `base` é o do cabeçalho quando a linha nasceu (o de
 *     hoje), `atual` o que está nela. A célula diferente de `atual` = o operador mexeu.
 */
export const LOCAL_DA_LINHA = "compra_local_da_linha";
export type MarcaDoLocal = { dono: "operador" } | { dono: "sistema"; base: string; atual: string };
export function marcaDoLocal(i: ItemRow): MarcaDoLocal | null {
  const m = i[LOCAL_DA_LINHA];
  if (!ehObj(m)) return null;
  if (m.dono === "operador") return { dono: "operador" };
  return m.dono === "sistema" && texto(m.base) && texto(m.atual) ? { dono: "sistema", base: m.base, atual: m.atual } : null;
}
const mesmaMarca = (a: MarcaDoLocal | null, b: MarcaDoLocal): boolean =>
  a !== null && a.dono === b.dono && (a.dono === "operador" || (b.dono === "sistema" && a.base === b.base && a.atual === b.atual));

/**
 * O LOCAL DAS LINHAS NOVAS (decisão 311; L3): a precedência é a resposta do operador na linha → o local padrão do
 * PRODUTO (conferido na empresa do documento) → o local do cabeçalho. O local do cabeçalho ESCOLHIDO pelo operador (o
 * campo "Local de estoque" do cabeçalho) é resposta dele para as linhas que nascem depois — vence o do produto; o que é
 * só padrão (o de cadastro do layout) ou vazio fica abaixo do produto (a 280 não é desmentida quando ele escolheu).
 *   1. a linha sem marca e SEM produto acabou de nascer no motor, com o local do cabeçalho: com o cabeçalho escolhido,
 *      é do operador; senão, do sistema (base = o local com que nasceu). Sem marca e COM produto (a cópia): do operador;
 *   2. a do sistema cuja célula ≠ `atual`: o operador mexeu ⇒ do operador (o ajuste nunca é derrubado);
 *   3. a do sistema com produto que gera estoque: o local do produto conferido; sem ele (ainda chegando, sem
 *      `products.view`, de outra empresa, inativo), a `base` — o de hoje.
 * Devolve o MESMO array quando nada muda (o estado não re-renderiza à toa).
 */
export function localDasLinhasNovas(linhas: ItemRow[], ctx: {
  cabecalhoEscolhido: boolean; localDoProduto: (produtoId: string) => string | null; geraEstoque: (i: ItemRow) => boolean;
}): ItemRow[] {
  let mudou = false;
  const novas = linhas.map((l) => {
    const local = texto(l.warehouse_id) ? l.warehouse_id : "";
    const antes = marcaDoLocal(l);
    let m: MarcaDoLocal;
    if (!antes) m = !l.product_id && !ctx.cabecalhoEscolhido ? { dono: "sistema", base: local, atual: local } : { dono: "operador" };
    else m = antes.dono === "sistema" && local !== antes.atual ? { dono: "operador" } : antes;
    let alvo = local;
    if (m.dono === "sistema" && l.product_id && ctx.geraEstoque(l)) {
      alvo = ctx.localDoProduto(l.product_id) ?? m.base;
      if (alvo !== m.atual) m = { ...m, atual: alvo };
    }
    if (alvo === local && mesmaMarca(antes, m)) return l;
    mudou = true;
    return { ...l, ...(alvo !== local ? { warehouse_id: alvo } : {}), [LOCAL_DA_LINHA]: m };
  });
  return mudou ? novas : linhas;
}
