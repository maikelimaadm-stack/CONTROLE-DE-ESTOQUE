/**
 * CONFIGURAÇÃO DE LAYOUT — o motor do rascunho (decisão 275): operações PURAS sobre o `FormLayout` de @agro/shared, a
 * forma canônica ("alterado"), o documento do Salvar, o arrastar (vista, previsão e soltura) e a pilha de desfazer.
 * O que cada operação faz está em `Operacoes` (tipos.ts); aqui ficam só os porquês que não cabem lá.
 *
 * Invariantes do rascunho — `abrirRascunho` as estabelece e toda operação as mantém:
 *  - a posição no array É a ordem: `order` de painéis e de cards = 1..n na ordem do array (cards: o array inteiro);
 *  - as linhas de cada card se chamam r1..rN pela posição. O normalizador do contrato renomeia as linhas pela posição e
 *    pode REPETIR id; por isso nada aqui usa `row.id` como endereço (card + posição, sempre);
 *  - todo card tem ao menos uma linha, que pode estar vazia (só `paraSalvar` descarta as vazias);
 *  - ids de card são únicos (o repetido ganha sufixo ao abrir) e não há valor padrão vazio nem nulo;
 *  - nenhuma entrada é mutada: cada operação trabalha numa cópia. "Sem efeito" devolve o MESMO objeto (a pilha não
 *    empilha), e recusa devolve `null`.
 *
 * Visível × hiddenFieldIds: só a ENTRADA vinda de Disponíveis tira o campo de `hiddenFieldIds`; mover, trocar entre
 * linhas e reordenar não mexem; tudo o que sai das linhas entra. Sem isso o normalizador devolveria o campo num card
 * "Outros campos" ao salvar (ele anexa todo campo conhecido que não está numa linha nem oculto).
 */
import { FORM_LAYOUT_VERSION, MAX_FIELDS_PER_ROW, cardFieldIds, type FormLayout, type LayoutCard, type LayoutPanel, type LayoutRow } from "@agro/shared";
import { LIMITE_DA_PILHA, type AlvoBruto, type Contexto, type EnderecoCampo, type ItemArrastado, type Operacoes, type Pilha, type Previsao } from "./tipos";

/** Textos das dicas dos botões desabilitados (decisão 275). */
const MOTIVO = {
  umPainel: "O formulário precisa de ao menos um painel",
  painelComSistema: "Este painel tem campo do sistema, que não sai do formulário",
  umCard: "O painel precisa de ao menos um card",
  cardComSistema: "Este card tem campo do sistema, que não sai do formulário",
  umaLinha: "O card precisa de ao menos uma linha",
  linhaComSistema: "Esta linha tem campo do sistema, que não sai do formulário"
} as const;

/** O contrato corta nomes e rótulos em 60 caracteres (normalizeFormLayout). */
const MAX_NOME = 60;

/* ═══════════════════════════════ ajudantes (internos) ═══════════════════════════════ */

const proprio = (obj: Record<string, unknown>, chave: string): boolean => Object.prototype.hasOwnProperty.call(obj, chave);
const com = (lista: string[], fid: string): string[] => (lista.includes(fid) ? lista : [...lista, fid]);
const sem = (lista: string[], fid: string): string[] => lista.filter((x) => x !== fid);
const unicos = (lista: string[]): string[] => [...new Set(lista)];
const entre = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.trunc(v)));
const inteiroValido = (v: number): boolean => Number.isInteger(v) && v >= 0;
const limite = (card: LayoutCard): number => MAX_FIELDS_PER_ROW[card.colSpan === 6 ? 6 : 12];
const linhaVazia = (): LayoutRow => ({ id: "", fieldIds: [] });

/** Cópia profunda: o FormLayout só tem dados planos (listas de texto e mapas de valores primitivos). */
function clonar(l: FormLayout): FormLayout {
  const c: FormLayout = {
    ...l,
    panels: l.panels.map((p) => ({ ...p })),
    cards: l.cards.map((card) => ({ ...card, rows: card.rows.map((r) => ({ ...r, fieldIds: [...r.fieldIds] })) })),
    hiddenFieldIds: [...l.hiddenFieldIds],
    lockedFieldIds: [...l.lockedFieldIds],
    requiredFieldIds: [...l.requiredFieldIds],
    fieldSizes: { ...l.fieldSizes },
    fieldLabels: { ...l.fieldLabels },
    fieldDefaultValues: { ...l.fieldDefaultValues }
  };
  if (l.meta) c.meta = { ...l.meta };
  return c;
}

/** A posição é a ordem: `order` 1..n (painéis e cards) e linhas r1..rN. Muta a CÓPIA que a operação acabou de criar. */
function arrumar(l: FormLayout): FormLayout {
  l.panels.forEach((p, i) => { p.order = i + 1; });
  l.cards.forEach((c, i) => { c.order = i + 1; c.rows.forEach((r, j) => { r.id = `r${j + 1}`; }); });
  return l;
}

/** Ordena por `order` sem perder a ordem do array nos empates (é o que o normalizador faz). */
function porOrdem<T extends { order: number }>(xs: T[]): T[] {
  const chave = (o: number) => (Number.isFinite(o) ? o : Number.MAX_SAFE_INTEGER);
  return xs.map((x, i) => ({ x, i })).sort((a, b) => chave(a.x.order) - chave(b.x.order) || a.i - b.i).map((v) => v.x);
}

const acharCard = (l: FormLayout, cardId: string): LayoutCard | undefined => l.cards.find((c) => c.id === cardId);
const estaNoFormulario = (l: FormLayout, fid: string): boolean => l.cards.some((c) => c.rows.some((r) => r.fieldIds.includes(fid)));
const temCampoDoSistema = (ctx: Contexto, fids: string[]): boolean => fids.some((f) => ctx.ehDoSistema(f));

/** O "empurrar" do desenho: cada campo vai para a ÚLTIMA linha do card, se couber; senão, para uma linha nova. */
function empurrar(card: LayoutCard, fids: string[]): void {
  const max = limite(card);
  for (const fid of fids) {
    const ultima = card.rows[card.rows.length - 1];
    if (!ultima || ultima.fieldIds.length >= max) card.rows.push({ id: "", fieldIds: [fid] });
    else ultima.fieldIds.push(fid);
  }
}

/** Põe o campo na linha `linha` (`linha === rows.length` cria a linha), em `posicao` (padrão: no fim). false = cheia ou inexistente. */
function inserir(card: LayoutCard, fid: string, linha: number, posicao?: number): boolean {
  if (!inteiroValido(linha) || linha > card.rows.length) return false;
  if (linha === card.rows.length) { card.rows.push({ id: "", fieldIds: [fid] }); return true; }
  const row = card.rows[linha];
  if (!row || row.fieldIds.length >= limite(card)) return false;
  const at = posicao === undefined || !Number.isFinite(posicao) ? row.fieldIds.length : entre(posicao, 0, row.fieldIds.length);
  row.fieldIds.splice(at, 0, fid);
  return true;
}

/** Rótulos como o contrato os guarda: sem espaço nas pontas, até 60, nenhum vazio. */
function rotulosLimpos(m: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) { if (typeof v !== "string") continue; const t = v.trim().slice(0, MAX_NOME); if (t) out[k] = t; }
  return out;
}

/**
 * Valor padrão vazio (ou nulo, que o normalizador aceita vindo da API) nunca é gravado: passaria por cima do valor padrão
 * da definição (a Situação "active" nasceria vazia). Para a tela, nulo é "Nenhum".
 */
function valoresLimpos(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) if (v !== "" && v !== undefined && v !== null) out[k] = v;
  return out;
}

const mapaOrdenado = (m: Record<string, unknown>): [string, unknown][] => Object.entries(m).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const listaOrdenada = (xs: string[]): string[] => unicos(xs).sort();

/* ═══════════════════════════════ contexto ═══════════════════════════════ */

export const criarContexto: Operacoes["criarContexto"] = (campos) => {
  const mapa = new Map(campos.map((c) => [c.id, c] as const));
  return {
    campos,
    info: (fid) => mapa.get(fid),
    ehDoSistema: (fid) => mapa.get(fid)?.required === true,
    ehSoLeituraNaDefinicao: (fid) => mapa.get(fid)?.readOnly === true
  };
};

/* ═══════════════════════════════ abrir, salvar e comparar ═══════════════════════════════ */

export const abrirRascunho: Operacoes["abrirRascunho"] = (salvo) => {
  const l = clonar(salvo);
  l.panels = porOrdem(l.panels);
  l.cards = porOrdem(l.cards);
  // Id de card repetido (o padrão derivado da definição dá "geral" à seção sem nome E à seção "Geral"): o primeiro na
  // ordem fica com o id, os outros ganham sufixo único. Sem isso, achar o card pelo id pega sempre o primeiro, e o
  // normalizador do servidor descartaria o segundo ao salvar. Determinístico: o `alterado` compara com o salvo aberto
  // por esta mesma função, então abrir não acende o ponto.
  const usados = new Set<string>();
  const todos = new Set(l.cards.map((c) => c.id));
  for (const c of l.cards) {
    if (usados.has(c.id)) { let n = 2; while (todos.has(`${c.id}_${n}`)) n++; c.id = `${c.id}_${n}`; todos.add(c.id); }
    usados.add(c.id);
  }
  // card sem linha (layout antigo) ganha a "Linha 1" vazia que a tela mostra; vazia, ela não muda o "alterado" nem o salvo
  for (const c of l.cards) if (!c.rows.length) c.rows.push(linhaVazia());
  // valor padrão vazio ou nulo não existe no rascunho (seria gravado por cima do valor padrão da definição)
  l.fieldDefaultValues = valoresLimpos(l.fieldDefaultValues);
  return arrumar(l);
};

export const paraSalvar: Operacoes["paraSalvar"] = (r) => {
  const panels = r.panels.map((p, i): LayoutPanel => (p.hidden === true ? { id: p.id, label: p.label, order: i + 1, hidden: true } : { id: p.id, label: p.label, order: i + 1 }));
  const cards = r.cards.map((c, i): LayoutCard => {
    const rows = c.rows.filter((x) => x.fieldIds.length > 0).map((x, j): LayoutRow => ({ id: `r${j + 1}`, fieldIds: [...x.fieldIds] }));
    const base = { id: c.id, panelId: c.panelId, label: c.label, order: i + 1, colSpan: c.colSpan === 6 ? (6 as const) : (12 as const) };
    return c.collapsible === true ? { ...base, collapsible: true, rows } : { ...base, rows };
  });
  const doc: FormLayout = {
    version: FORM_LAYOUT_VERSION,
    panels,
    cards,
    hiddenFieldIds: unicos(r.hiddenFieldIds),
    lockedFieldIds: unicos(r.lockedFieldIds),
    requiredFieldIds: unicos(r.requiredFieldIds),
    fieldSizes: { ...r.fieldSizes },
    fieldLabels: rotulosLimpos(r.fieldLabels),
    fieldDefaultValues: valoresLimpos(r.fieldDefaultValues)
  };
  if (r.meta) doc.meta = { ...r.meta };
  return doc;
};

export const formaCanonica: Operacoes["formaCanonica"] = (l) => {
  const card = (c: LayoutCard) => ({ id: c.id, label: c.label, colSpan: c.colSpan, collapsible: c.collapsible === true, rows: c.rows.filter((r) => r.fieldIds.length > 0).map((r) => r.fieldIds) });
  const paineis = new Set(l.panels.map((p) => p.id));
  return JSON.stringify({
    panels: l.panels.map((p) => ({ id: p.id, label: p.label, hidden: p.hidden === true, cards: l.cards.filter((c) => c.panelId === p.id).map(card) })),
    // card de painel inexistente (não deveria haver): conta à parte, para não sumir da comparação
    semPainel: l.cards.filter((c) => !paineis.has(c.panelId)).map(card),
    hiddenFieldIds: listaOrdenada(l.hiddenFieldIds),
    lockedFieldIds: listaOrdenada(l.lockedFieldIds),
    requiredFieldIds: listaOrdenada(l.requiredFieldIds),
    fieldSizes: mapaOrdenado(l.fieldSizes),
    fieldLabels: mapaOrdenado(rotulosLimpos(l.fieldLabels)),
    fieldDefaultValues: mapaOrdenado(valoresLimpos(l.fieldDefaultValues))
  });
};

/** O salvo passa pelo mesmo `abrirRascunho` que criou o rascunho: a comparação não depende de como o salvo chegou. */
export const alterado: Operacoes["alterado"] = (rascunho, salvo) => formaCanonica(rascunho) !== formaCanonica(abrirRascunho(salvo));

/* ═══════════════════════════════ consultas ═══════════════════════════════ */

export const posicionados: Operacoes["posicionados"] = (l) => new Set(l.cards.flatMap(cardFieldIds));
export const cardsDoPainel: Operacoes["cardsDoPainel"] = (l, panelId) => l.cards.filter((c) => c.panelId === panelId);
export const contagemDoCard: Operacoes["contagemDoCard"] = (card) => card.rows.reduce((n, r) => n + r.fieldIds.length, 0);
export const contagemDoPainel: Operacoes["contagemDoPainel"] = (l, panelId) => cardsDoPainel(l, panelId).reduce((n, c) => n + contagemDoCard(c), 0);
export const limiteDaLinha: Operacoes["limiteDaLinha"] = (card) => limite(card);

export const enderecoDe: Operacoes["enderecoDe"] = (l, fid) => {
  for (const c of l.cards) for (const [linha, r] of c.rows.entries()) { const posicao = r.fieldIds.indexOf(fid); if (posicao >= 0) return { cardId: c.id, linha, posicao }; }
  return null;
};

export const obrigatorio: Operacoes["obrigatorio"] = (l, ctx, fid) => ctx.ehDoSistema(fid) || l.requiredFieldIds.includes(fid);
/** campo do sistema nunca fica oculto (o normalizador também o tira de `hiddenFieldIds`) */
export const visivel: Operacoes["visivel"] = (l, ctx, fid) => ctx.ehDoSistema(fid) || !l.hiddenFieldIds.includes(fid);
export const somenteLeitura: Operacoes["somenteLeitura"] = (l, ctx, fid) => ctx.ehSoLeituraNaDefinicao(fid) || l.lockedFieldIds.includes(fid);

/* Com um só E com campo do sistema, vale o motivo de "um só" (é a regra que o desenho já mostra). */
export const motivoNaoExcluirPainel: Operacoes["motivoNaoExcluirPainel"] = (l, ctx, panelId) => {
  if (l.panels.length <= 1) return MOTIVO.umPainel;
  return temCampoDoSistema(ctx, cardsDoPainel(l, panelId).flatMap(cardFieldIds)) ? MOTIVO.painelComSistema : null;
};

export const motivoNaoExcluirCard: Operacoes["motivoNaoExcluirCard"] = (l, ctx, cardId) => {
  const card = acharCard(l, cardId);
  if (!card) return null;
  if (cardsDoPainel(l, card.panelId).length <= 1) return MOTIVO.umCard;
  return temCampoDoSistema(ctx, cardFieldIds(card)) ? MOTIVO.cardComSistema : null;
};

export const motivoNaoRemoverLinha: Operacoes["motivoNaoRemoverLinha"] = (l, ctx, end) => {
  const card = acharCard(l, end.cardId);
  if (!card) return null;
  if (card.rows.length <= 1) return MOTIVO.umaLinha;
  const row = card.rows[end.linha];
  return row && temCampoDoSistema(ctx, row.fieldIds) ? MOTIVO.linhaComSistema : null;
};

/* ═══════════════════════════════ campos ═══════════════════════════════ */

/** Entrada vinda de Disponíveis: só campo da definição que ainda não está no formulário; sai de `hiddenFieldIds`. */
export const usarCampo: Operacoes["usarCampo"] = (l, ctx, fid, destino) => {
  if (!ctx.info(fid) || estaNoFormulario(l, fid)) return null;
  const n = clonar(l);
  const card = acharCard(n, destino.cardId);
  if (!card) return null;
  if (destino.linha === undefined) empurrar(card, [fid]);
  else if (!inserir(card, fid, destino.linha, destino.posicao)) return null;
  n.hiddenFieldIds = sem(n.hiddenFieldIds, fid);
  return arrumar(n);
};

/**
 * `destino` em coordenadas da VISTA (o layout sem o campo): o campo sai do lugar e entra na posição apontada — é o
 * índice final. Tirar um campo nunca muda o índice das linhas. Não mexe no Visível.
 */
export const moverCampo: Operacoes["moverCampo"] = (l, _ctx, fid, destino) => {
  const de = enderecoDe(l, fid);
  if (!de) return null;
  if (de.cardId === destino.cardId && de.linha === destino.linha && de.posicao === destino.posicao) return l;
  const n = clonar(l);
  const origem = acharCard(n, de.cardId)?.rows[de.linha];
  const card = acharCard(n, destino.cardId);
  if (!origem || !card) return null;
  origem.fieldIds.splice(de.posicao, 1);
  if (!inserir(card, fid, destino.linha, destino.posicao)) return null;
  return arrumar(n);
};

/** Linha cheia, vindo de outra linha: os dois trocam de lugar (qualquer campo, inclusive o do sistema). Não mexe no Visível. */
export const trocarEntreLinhas: Operacoes["trocarEntreLinhas"] = (l, _ctx, fid, fidAlvo) => {
  if (fid === fidAlvo) return null;
  const a = enderecoDe(l, fid);
  const b = enderecoDe(l, fidAlvo);
  if (!a || !b) return null;
  const n = clonar(l);
  const ra = acharCard(n, a.cardId)?.rows[a.linha];
  const rb = acharCard(n, b.cardId)?.rows[b.linha];
  if (!ra || !rb) return null;
  ra.fieldIds[a.posicao] = fidAlvo;
  rb.fieldIds[b.posicao] = fid;
  return arrumar(n);
};

/** Linha cheia, vindo da coluna: o novo entra no lugar e o de lá vai para Disponíveis (oculto). Campo do sistema recusa. */
export const trocarComDisponivel: Operacoes["trocarComDisponivel"] = (l, ctx, fidNovo, fidAlvo) => {
  if (!ctx.info(fidNovo) || estaNoFormulario(l, fidNovo) || ctx.ehDoSistema(fidAlvo)) return null;
  const b = enderecoDe(l, fidAlvo);
  if (!b) return null;
  const n = clonar(l);
  const row = acharCard(n, b.cardId)?.rows[b.linha];
  if (!row) return null;
  row.fieldIds[b.posicao] = fidNovo;
  n.hiddenFieldIds = com(sem(n.hiddenFieldIds, fidNovo), fidAlvo);
  return arrumar(n);
};

/** × e soltar na coluna: o campo sai da linha (a linha fica, mesmo vazia) e entra em `hiddenFieldIds`. */
export const tirarCampo: Operacoes["tirarCampo"] = (l, ctx, fid) => {
  if (ctx.ehDoSistema(fid)) return null;
  const e = enderecoDe(l, fid);
  if (!e) return null;
  const n = clonar(l);
  const row = acharCard(n, e.cardId)?.rows[e.linha];
  if (!row) return null;
  row.fieldIds.splice(e.posicao, 1);
  n.hiddenFieldIds = com(n.hiddenFieldIds, fid);
  return arrumar(n);
};

export const usarTodos: Operacoes["usarTodos"] = (l, ctx, cardId) => {
  const no = posicionados(l);
  const fids = ctx.campos.map((c) => c.id).filter((f) => !no.has(f));
  const n = clonar(l);
  const card = acharCard(n, cardId);
  if (!card || !fids.length) return null;
  empurrar(card, fids);
  n.hiddenFieldIds = n.hiddenFieldIds.filter((h) => !fids.includes(h));
  return arrumar(n);
};

/** O `tirarTodosFn` do desenho, menos o descarte das linhas vazias: as linhas ficam (e o card segue com ao menos uma). */
export const tirarTodos: Operacoes["tirarTodos"] = (l, ctx, cardId) => {
  const n = clonar(l);
  const card = acharCard(n, cardId);
  if (!card) return null;
  const saem = cardFieldIds(card).filter((f) => !ctx.ehDoSistema(f));
  if (!saem.length) return null;
  for (const r of card.rows) r.fieldIds = r.fieldIds.filter((f) => ctx.ehDoSistema(f));
  n.hiddenFieldIds = unicos([...n.hiddenFieldIds, ...saem]);
  return arrumar(n);
};

/* ═══════════════════════════════ linhas ═══════════════════════════════ */

export const adicionarLinha: Operacoes["adicionarLinha"] = (l, cardId) => {
  if (!acharCard(l, cardId)) return l;
  const n = clonar(l);
  acharCard(n, cardId)?.rows.push(linhaVazia());
  return arrumar(n);
};

export const removerLinha: Operacoes["removerLinha"] = (l, ctx, end) => {
  if (motivoNaoRemoverLinha(l, ctx, end) !== null) return null;
  const n = clonar(l);
  const card = acharCard(n, end.cardId);
  const row = card?.rows[end.linha];
  if (!card || !row || !inteiroValido(end.linha)) return null;
  card.rows.splice(end.linha, 1);
  n.hiddenFieldIds = unicos([...n.hiddenFieldIds, ...row.fieldIds]);
  return arrumar(n);
};

export const moverLinha: Operacoes["moverLinha"] = (l, cardId, de, para) => {
  const card = acharCard(l, cardId);
  if (!card || !inteiroValido(de) || !card.rows[de] || !inteiroValido(para)) return null;
  const alvo = Math.min(para, card.rows.length - 1);
  if (alvo === de) return l;
  const n = clonar(l);
  const rows = acharCard(n, cardId)?.rows;
  const [row] = rows ? rows.splice(de, 1) : [];
  if (!rows || !row) return null;
  rows.splice(alvo, 0, row);
  return arrumar(n);
};

/* ═══════════════════════════════ painéis ═══════════════════════════════ */

/** Id já usado no documento: sem efeito (o normalizador descartaria o repetido). */
export const adicionarPainel: Operacoes["adicionarPainel"] = (l, ids) => {
  if (l.panels.some((p) => p.id === ids.painel) || l.cards.some((c) => c.id === ids.card)) return l;
  const n = clonar(l);
  n.panels.push({ id: ids.painel, label: `Painel ${n.panels.length + 1}`, order: 0 });
  n.cards.push({ id: ids.card, panelId: ids.painel, label: "Dados", order: 0, colSpan: 12, rows: [linhaVazia()] });
  return arrumar(n);
};

export const removerPainel: Operacoes["removerPainel"] = (l, ctx, panelId) => {
  if (!l.panels.some((p) => p.id === panelId) || motivoNaoExcluirPainel(l, ctx, panelId) !== null) return null;
  const n = clonar(l);
  const saem = cardsDoPainel(n, panelId).flatMap(cardFieldIds);
  n.panels = n.panels.filter((p) => p.id !== panelId);
  n.cards = n.cards.filter((c) => c.panelId !== panelId);
  n.hiddenFieldIds = unicos([...n.hiddenFieldIds, ...saem]);
  return arrumar(n);
};

/** `para` = posição na faixa SEM o painel (vista) */
export const moverPainel: Operacoes["moverPainel"] = (l, panelId, para) => {
  const de = l.panels.findIndex((p) => p.id === panelId);
  if (de < 0 || !inteiroValido(para)) return null;
  const alvo = Math.min(para, l.panels.length - 1);
  if (alvo === de) return l;
  const n = clonar(l);
  const [p] = n.panels.splice(de, 1);
  if (!p) return null;
  n.panels.splice(alvo, 0, p);
  return arrumar(n);
};

export const renomearPainel: Operacoes["renomearPainel"] = (l, panelId, nome) => {
  const novo = nome.trim().slice(0, MAX_NOME);
  const atual = l.panels.find((p) => p.id === panelId);
  if (!novo || !atual) return null;
  if (atual.label === novo) return l;
  const n = clonar(l);
  for (const p of n.panels) if (p.id === panelId) p.label = novo;
  return n;
};

/* ═══════════════════════════════ cards ═══════════════════════════════ */

/** Entra no fim do array (é o último do painel). Painel inexistente ou id já usado: sem efeito. */
export const adicionarCard: Operacoes["adicionarCard"] = (l, panelId, cardId) => {
  if (!l.panels.some((p) => p.id === panelId) || l.cards.some((c) => c.id === cardId)) return l;
  const n = clonar(l);
  const qtd = cardsDoPainel(n, panelId).length;
  n.cards.push({ id: cardId, panelId, label: `Card ${qtd + 1}`, order: 0, colSpan: 12, rows: [linhaVazia()] });
  return arrumar(n);
};

export const removerCard: Operacoes["removerCard"] = (l, ctx, cardId) => {
  const card = acharCard(l, cardId);
  if (!card || motivoNaoExcluirCard(l, ctx, cardId) !== null) return null;
  const n = clonar(l);
  n.cards = n.cards.filter((c) => c.id !== cardId);
  n.hiddenFieldIds = unicos([...n.hiddenFieldIds, ...cardFieldIds(card)]);
  return arrumar(n);
};

/**
 * `para` = posição entre os cards DO PAINEL, sem o card (vista). Os cards do painel trocam de lugar só entre as vagas
 * que já ocupavam no array inteiro: os dos outros painéis não se mexem.
 */
export const moverCard: Operacoes["moverCard"] = (l, cardId, para) => {
  const card = acharCard(l, cardId);
  if (!card || !inteiroValido(para)) return null;
  const doPainel = cardsDoPainel(l, card.panelId);
  const de = doPainel.indexOf(card);
  const alvo = Math.min(para, doPainel.length - 1);
  if (alvo === de) return l;
  const n = clonar(l);
  const vagas: number[] = [];
  n.cards.forEach((c, i) => { if (c.panelId === card.panelId) vagas.push(i); });
  const lista = vagas.map((i) => n.cards[i]).filter((c): c is LayoutCard => c !== undefined);
  const [m] = lista.splice(de, 1);
  if (!m) return null;
  lista.splice(alvo, 0, m);
  vagas.forEach((pos, k) => { const c = lista[k]; if (c) n.cards[pos] = c; });
  return arrumar(n);
};

export const renomearCard: Operacoes["renomearCard"] = (l, cardId, nome) => {
  const novo = nome.trim().slice(0, MAX_NOME);
  const atual = acharCard(l, cardId);
  if (!novo || !atual) return null;
  if (atual.label === novo) return l;
  const n = clonar(l);
  for (const c of n.cards) if (c.id === cardId) c.label = novo;
  return n;
};

/**
 * Inteiro ↔ meio. Indo para meio, a linha com mais de 4 campos se divide em pedaços de 4 consecutivos, as linhas novas
 * logo depois da original — o empacotamento do normalizeFormLayout, só neste card (o rascunho nunca passa pelo
 * normalizador inteiro). Voltando para inteiro, nada se junta.
 */
export const alternarLargura: Operacoes["alternarLargura"] = (l, cardId) => {
  if (!acharCard(l, cardId)) return l;
  const n = clonar(l);
  const card = acharCard(n, cardId);
  if (!card) return l;
  if (card.colSpan === 6) { card.colSpan = 12; return arrumar(n); }
  card.colSpan = 6;
  const max = MAX_FIELDS_PER_ROW[6];
  card.rows = card.rows.flatMap((r) => {
    if (r.fieldIds.length <= max) return [r];
    const pedacos: LayoutRow[] = [];
    for (let k = 0; k < r.fieldIds.length; k += max) pedacos.push({ id: "", fieldIds: r.fieldIds.slice(k, k + max) });
    return pedacos;
  });
  return arrumar(n);
};

/* ═══════════════════════════════ propriedades do campo ═══════════════════════════════ */

/** O texto vai como foi digitado (o espaço entre palavras precisa sobreviver a cada tecla); `paraSalvar` apara. */
export const definirRotulo: Operacoes["definirRotulo"] = (l, fid, texto) => {
  const tem = proprio(l.fieldLabels, fid);
  if (!texto.trim()) {
    if (!tem) return l;
    const n = clonar(l);
    delete n.fieldLabels[fid];
    return n;
  }
  const novo = texto.slice(0, MAX_NOME);
  if (tem && l.fieldLabels[fid] === novo) return l;
  const n = clonar(l);
  n.fieldLabels[fid] = novo;
  return n;
};

/**
 * Ligar = entra em `requiredFieldIds` e sai de `lockedFieldIds` e de `hiddenFieldIds`, num passo só (obrigatório e só
 * leitura sem valor padrão impede gravar registro novo; obrigatório e oculto deixa de ser exigido). O "sai de oculto"
 * vale para o campo que está numa linha: fora delas, tirar de `hiddenFieldIds` mandaria o campo para "Outros campos".
 */
export const definirObrigatorio: Operacoes["definirObrigatorio"] = (l, ctx, fid, ligado) => {
  if (ctx.ehDoSistema(fid)) return l;
  if (!ligado) {
    if (!l.requiredFieldIds.includes(fid)) return l;
    const n = clonar(l);
    n.requiredFieldIds = sem(n.requiredFieldIds, fid);
    return n;
  }
  if (ctx.ehSoLeituraNaDefinicao(fid)) return l;
  const tirarOculto = l.hiddenFieldIds.includes(fid) && estaNoFormulario(l, fid);
  if (l.requiredFieldIds.includes(fid) && !tirarOculto && !l.lockedFieldIds.includes(fid)) return l;
  const n = clonar(l);
  n.requiredFieldIds = com(n.requiredFieldIds, fid);
  n.lockedFieldIds = sem(n.lockedFieldIds, fid);
  if (tirarOculto) n.hiddenFieldIds = sem(n.hiddenFieldIds, fid);
  return n;
};

/** Desligar não mexe no Obrigatório. Ligar só vale para o campo numa linha (fora dela ele iria para "Outros campos"). */
export const definirVisivel: Operacoes["definirVisivel"] = (l, ctx, fid, ligado) => {
  if (ctx.ehDoSistema(fid)) return l;
  const oculto = l.hiddenFieldIds.includes(fid);
  if (ligado) {
    if (!oculto || !estaNoFormulario(l, fid)) return l;
    const n = clonar(l);
    n.hiddenFieldIds = sem(n.hiddenFieldIds, fid);
    return n;
  }
  if (oculto) return l;
  const n = clonar(l);
  n.hiddenFieldIds = com(n.hiddenFieldIds, fid);
  return n;
};

/** Ligar não mexe no Obrigatório. Campo só leitura na definição: travado (sem efeito). */
export const definirSomenteLeitura: Operacoes["definirSomenteLeitura"] = (l, ctx, fid, ligado) => {
  if (ctx.ehSoLeituraNaDefinicao(fid) || l.lockedFieldIds.includes(fid) === ligado) return l;
  const n = clonar(l);
  n.lockedFieldIds = ligado ? com(n.lockedFieldIds, fid) : sem(n.lockedFieldIds, fid);
  return n;
};

export const definirValorPadrao: Operacoes["definirValorPadrao"] = (l, fid, valor) => {
  const tem = proprio(l.fieldDefaultValues, fid);
  if (valor === undefined || valor === "") {
    if (!tem) return l;
    const n = clonar(l);
    delete n.fieldDefaultValues[fid];
    return n;
  }
  if (tem && l.fieldDefaultValues[fid] === valor) return l;
  const n = clonar(l);
  n.fieldDefaultValues[fid] = valor;
  return n;
};

/* ═══════════════════════════════ arrastar ═══════════════════════════════ */

/**
 * O item sai do lugar na hora: campo some da linha (a linha fica), linha some do card, painel some da faixa (os cards
 * dele ficam no documento: a área das linhas não pisca) e card some do array. Sem renumerar nada: é só a vista.
 */
export const vistaDuranteArraste: Operacoes["vistaDuranteArraste"] = (l, item) => {
  if (!item) return l;
  switch (item.tipo) {
    case "disponivel":
      return l;
    case "campo": {
      const e = enderecoDe(l, item.fid);
      if (!e) return l;
      const n = clonar(l);
      acharCard(n, e.cardId)?.rows[e.linha]?.fieldIds.splice(e.posicao, 1);
      return n;
    }
    case "linha": {
      if (!inteiroValido(item.linha) || !acharCard(l, item.cardId)?.rows[item.linha]) return l;
      const n = clonar(l);
      acharCard(n, item.cardId)?.rows.splice(item.linha, 1);
      return n;
    }
    case "painel": {
      if (!l.panels.some((p) => p.id === item.panelId)) return l;
      const n = clonar(l);
      n.panels = n.panels.filter((p) => p.id !== item.panelId);
      return n;
    }
    case "card": {
      if (!acharCard(l, item.cardId)) return l;
      const n = clonar(l);
      n.cards = n.cards.filter((c) => c.id !== item.cardId);
      return n;
    }
  }
};

function preverCampo(vista: FormLayout, ctx: Contexto, item: Extract<ItemArrastado, { tipo: "campo" | "disponivel" }>, a: AlvoBruto): Previsao | null {
  if (a.t === "coluna") return { tipo: "coluna", recusa: item.tipo === "disponivel" ? "ja-esta" : ctx.ehDoSistema(item.fid) ? "sistema" : null };
  if (a.t !== "campo" && a.t !== "linha") return null;
  const card = acharCard(vista, a.cardId);
  if (!card || !inteiroValido(a.linha)) return null;
  const row = card.rows[a.linha];
  // card sem linha nenhuma (a "Linha 1" que a tela desenha): o campo cria a linha
  if (!row) return card.rows.length === 0 && a.linha === 0 ? { tipo: "inserir", cardId: card.id, linha: 0, posicao: 0 } : null;
  if (row.fieldIds.length < limite(card)) {
    const posicao = a.t === "campo" && Number.isFinite(a.posicao) ? entre(a.posicao, 0, row.fieldIds.length) : row.fieldIds.length;
    return { tipo: "inserir", cardId: card.id, linha: a.linha, posicao };
  }
  // linha cheia: só o campo vira alvo, de TROCA (a linha inteira e o "+ Campo" não aceitam)
  if (a.t !== "campo" || !inteiroValido(a.posicao)) return null;
  const fidAlvo = row.fieldIds[a.posicao];
  if (!fidAlvo) return null;
  return { tipo: "trocar", cardId: card.id, linha: a.linha, posicao: a.posicao, fidAlvo, recusa: item.tipo === "disponivel" && ctx.ehDoSistema(fidAlvo) };
}

export const preverSoltura: Operacoes["preverSoltura"] = (l, ctx, item, a) => {
  const vista = vistaDuranteArraste(l, item);
  switch (item.tipo) {
    case "campo":
    case "disponivel":
      return preverCampo(vista, ctx, item, a);
    case "linha": {
      if ((a.t !== "linha" && a.t !== "fim-linhas") || a.cardId !== item.cardId) return null;
      const card = acharCard(vista, item.cardId);
      if (!card) return null;
      if (a.t === "fim-linhas") return { tipo: "linha", cardId: item.cardId, antes: card.rows.length };
      return inteiroValido(a.linha) ? { tipo: "linha", cardId: item.cardId, antes: Math.min(a.linha, card.rows.length) } : null;
    }
    case "painel":
      return a.t === "painel" && inteiroValido(a.indice) ? { tipo: "painel", antes: Math.min(a.indice, vista.panels.length) } : null;
    case "card": {
      const painel = acharCard(l, item.cardId)?.panelId;
      if (a.t !== "card" || painel === undefined || !inteiroValido(a.indice)) return null;
      return { tipo: "card", antes: Math.min(a.indice, cardsDoPainel(vista, painel).length) };
    }
  }
};

export const aplicarSoltura: Operacoes["aplicarSoltura"] = (l, ctx, item, p) => {
  switch (p.tipo) {
    case "inserir": {
      const destino: EnderecoCampo = { cardId: p.cardId, linha: p.linha, posicao: p.posicao };
      if (item.tipo === "disponivel") return usarCampo(l, ctx, item.fid, destino);
      if (item.tipo === "campo") return moverCampo(l, ctx, item.fid, destino);
      return null;
    }
    case "trocar":
      if (p.recusa) return null;
      if (item.tipo === "disponivel") return trocarComDisponivel(l, ctx, item.fid, p.fidAlvo);
      if (item.tipo === "campo") return trocarEntreLinhas(l, ctx, item.fid, p.fidAlvo);
      return null;
    case "coluna":
      return p.recusa === null && item.tipo === "campo" ? tirarCampo(l, ctx, item.fid) : null;
    case "linha":
      return item.tipo === "linha" && item.cardId === p.cardId ? moverLinha(l, item.cardId, item.linha, p.antes) : null;
    case "painel":
      return item.tipo === "painel" ? moverPainel(l, item.panelId, p.antes) : null;
    case "card":
      return item.tipo === "card" ? moverCard(l, item.cardId, p.antes) : null;
  }
};

/* ═══════════════════════════════ pilha ═══════════════════════════════ */

export const criarPilha: Operacoes["criarPilha"] = (l) => ({ passado: [], presente: l, futuro: [], digitacao: null });

export const fecharDigitacao: Operacoes["fecharDigitacao"] = (p) => (p.digitacao === null ? p : { ...p, digitacao: null });

/**
 * Empilha sempre que a REFERÊNCIA muda (adicionar linha vazia é uma entrada da pilha, só não acende o "alterado").
 * Mesma referência = nada mudou: não empilha — e, se não é a digitação aberta, fecha a digitação (abrir uma digitação
 * sem entrada faria a próxima tecla substituir um presente que nunca foi guardado).
 */
export const aplicar: Operacoes["aplicar"] = (p, novo, digitacao) => {
  const mesmaDigitacao = digitacao !== undefined && digitacao === p.digitacao;
  if (novo === p.presente) return mesmaDigitacao ? p : fecharDigitacao(p);
  if (mesmaDigitacao) return { ...p, presente: novo, futuro: [] };
  return { passado: [...p.passado, p.presente].slice(-LIMITE_DA_PILHA), presente: novo, futuro: [], digitacao: digitacao ?? null };
};

export const desfazer: Operacoes["desfazer"] = (p) => {
  const anterior = p.passado[p.passado.length - 1];
  if (anterior === undefined) return fecharDigitacao(p);
  return { passado: p.passado.slice(0, -1), presente: anterior, futuro: [p.presente, ...p.futuro], digitacao: null };
};

export const refazer: Operacoes["refazer"] = (p) => {
  const [proximo, ...resto] = p.futuro;
  if (proximo === undefined) return fecharDigitacao(p);
  return { passado: [...p.passado, p.presente].slice(-LIMITE_DA_PILHA), presente: proximo, futuro: resto, digitacao: null };
};

export const podeDesfazer: Operacoes["podeDesfazer"] = (p: Pilha) => p.passado.length > 0;
export const podeRefazer: Operacoes["podeRefazer"] = (p: Pilha) => p.futuro.length > 0;
