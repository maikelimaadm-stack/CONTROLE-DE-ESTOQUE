import { podeLancar } from "./tipo-operacao-select";
import type { GrupoDeTops } from "./variantes";

/**
 * AS DECISÕES DA JANELA DE LANÇAMENTO, SEPARADAS DA JANELA.
 *
 * ┌─ POR QUE ESTE ARQUIVO EXISTE ──────────────────────────────────────────────────────────────────┐
 * │ Tudo o que decide O QUE aparece, O QUE fica ativo e PARA ONDE o lançamento vai é função pura    │
 * │ aqui, e não `useMemo` escondido dentro do componente. Regra que mora dentro de JSX só se        │
 * │ verifica montando a árvore inteira — e as regras abaixo são exatamente as que já foram          │
 * │ bloqueadores em revisão ("um item não é padrão", "cardinalidade não decide"). Elas precisam de   │
 * │ teste direto, barato, sem React.                                                                 │
 * │                                                                                                  │
 * │ NENHUMA delas muta a entrada: todas devolvem array/valor novo. A lista de grupos vem de uma      │
 * │ consulta em cache (`useTopsDeVendas`) e é COMPARTILHADA com o filtro da listagem — ordenar ou    │
 * │ filtrar "no lugar" corromperia a outra tela sem deixar rastro.                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ NENHUM MAPA DE FAMÍLIA MORA AQUI ─────────────────────────────────────────────────────────────┐
 * │ `segmento` (a porta da rota) e `rotuloDoTipo` (o rótulo humano da família) são                   │
 * │ COPIADOS do grupo, que os recebeu do registry (`variantesDeVenda`) e do catálogo de idioma.      │
 * │ Escrever aqui um `{ "…": "…" }` de família → variante criaria a segunda lista que o gate         │
 * │ `scripts/familia-operacional-ssot-audit.mjs` existe para tornar barulhenta: uma família nova     │
 * │ apareceria no registry e sumiria desta janela, sem quebrar tipo, teste nem tela.                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Uma linha lançável da janela — já achatada, já com o rótulo humano, já com a porta de destino. */
export interface LinhaDeLancamento {
  /** UUID da TOP. É o que vai em `?tipo_operacao_id=` e o que identifica a linha na tela. */
  readonly id: string;
  /** Código da TOP (coluna "Código"). */
  readonly code: string;
  /** Nome da TOP (coluna "Operação"). */
  readonly name: string;
  /** O segmento plural da rota (`/vendas/<segmento>/new`) — veio da `VarianteDeVenda` do grupo. */
  readonly segmento: string;
  /** Código canônico da família. ATRIBUTO DE TESTE (`data-familia`), nunca texto de tela. */
  readonly familia: string;
  /** Rótulo HUMANO da família (cabeçalho do grupo e resumo do lançamento). Nunca o código canônico, nunca UUID. */
  readonly rotuloDoTipo: string;
  /** O servidor apontou esta TOP como padrão da família dela (`defaultId`). */
  readonly ehPadrao: boolean;
}

/**
 * As linhas de UM grupo — vazio quando o grupo não está lançável.
 *
 * O veredito de "está lançável" é `podeLancar`, a MESMA função que o seletor da rota `/new` usa.
 * Reescrever aqui `estado.situacao === "pronto"` seria a segunda escada de `if` sobre a mesma
 * pergunta: ela passaria a divergir na primeira vez que alguém ajustasse só um lado, em silêncio.
 *
 * `habilitado` é conferido ANTES e explicitamente: sem a capacidade a consulta nem é feita, e o
 * estado fica em "carregando" para sempre. Deixar o fail-closed por conta desse detalhe seria fazer
 * uma decisão de produto repousar sobre como a biblioteca de consultas relata uma consulta desligada.
 */
export function linhasDoGrupo(grupo: GrupoDeTops): LinhaDeLancamento[] {
  if (!grupo.habilitado) return [];
  if (!podeLancar(grupo.estado)) return [];
  const { defaultId, items } = grupo.estado.dados;
  return items.map((top) => ({
    id: top.id,
    code: top.code,
    name: top.name,
    segmento: grupo.variante.segmento,
    familia: grupo.variante.familia,
    rotuloDoTipo: grupo.rotulo,
    // `defaultId` é a ÚNICA fonte de padrão. `items.length === 1` NÃO faz padrão, e nenhuma posição
    // na lista faz padrão — as duas inferências já foram bloqueadores corrigidos em PR anterior.
    ehPadrao: defaultId !== null && top.id === defaultId
  }));
}

/**
 * Todas as linhas lançáveis, achatadas em UMA lista — e já na ordem de apresentação.
 *
 * ┌─ A ORDEM É O AGRUPAMENTO ──────────────────────────────────────────────────────────────────────┐
 * │ A ordem dos grupos é a do registry, e as linhas de uma mesma família saem contíguas. A janela    │
 * │ desenha o rótulo da família como CABEÇALHO do grupo (VISUAL-UX-01 R3, como no design), mas o    │
 * │ índice do teclado continua sendo ESTA lista plana: um só modo, um só cursor, com ou sem          │
 * │ pesquisa. Grupo que a pesquisa esvaziou não desenha cabeçalho — não sobra moldura vazia.         │
 * │                                                                                                  │
 * │ Dentro da família, a ordem é a que o SERVIDOR devolveu. Reordenar aqui (por código, por nome,     │
 * │ "padrão primeiro") inventaria uma hierarquia que o cadastro não declarou.                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export function linhasDeLancamento(grupos: readonly GrupoDeTops[]): LinhaDeLancamento[] {
  return grupos.flatMap((g) => linhasDoGrupo(g));
}

/**
 * Chave de comparação de texto: minúscula e sem acento.
 *
 * DÍVIDA DECLARADA: este normalizador de uma linha já existe, idêntico e privado, em
 * `lib/nav.ts`, `features/reports/catalog.tsx` e `app/(app)/configuracoes/page.tsx`. Nenhum deles o
 * exporta, e esta fatia é de UX do lançador — mover os quatro para um dono comum (`lib/utils.ts`) é
 * refatoração de superfície compartilhada, que pertence a uma fatia própria. Fica aqui EXPORTADO,
 * para ser testável e para que o dia da unificação encontre uma cópia nomeada, não mais uma anônima.
 */
export const normalizarTexto = (texto: string): string =>
  texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * O recorte da pesquisa — client-side, porque a lista JÁ veio autorizada do servidor e é pequena.
 *
 * Procura em código, nome e rótulo da família, sem acento e sem caixa. Vários termos combinam com E
 * (não OU): quem digita duas palavras está ESTREITANDO a busca; OU devolveria mais linhas a cada
 * palavra digitada, que é o oposto do que a digitação pede.
 *
 * NÃO chama endpoint nenhum, e muito menos a porta administrativa de Tipos de Operação: quem vende
 * não precisa poder configurar TOP, e pesquisar não é motivo para pedir uma capacidade a mais.
 */
export function filtrarLinhas(linhas: readonly LinhaDeLancamento[], busca: string): LinhaDeLancamento[] {
  const termos = normalizarTexto(busca).split(/\s+/).filter(Boolean);
  if (!termos.length) return linhas.slice();
  return linhas.filter((l) => {
    const alvo = normalizarTexto(`${l.code} ${l.name} ${l.rotuloDoTipo}`);
    return termos.every((t) => alvo.includes(t));
  });
}

/**
 * A PRÉ-SELEÇÃO — e por que ela é tão estreita.
 *
 * ┌─ UM PADRÃO, OU NENHUM ─────────────────────────────────────────────────────────────────────────┐
 * │ `defaultId` é declarado POR FAMÍLIA. Esta janela mistura as famílias numa lista só, então ela    │
 * │ pode receber VÁRIOS padrões ao mesmo tempo — um de cada família. Escolher "o primeiro" entre     │
 * │ eles seria decidir a operação do usuário pela ORDEM do registry: uma preferência que ninguém     │
 * │ cadastrou, apresentada com a mesma cara de uma que foi cadastrada.                               │
 * │                                                                                                  │
 * │ Então: exatamente UM padrão pré-seleciona; zero ou mais de um não pré-selecionam nada, e o botão │
 * │ "Lançar" nasce desabilitado até o usuário escolher. O selo "Padrão" continua em TODA linha que o │
 * │ servidor marcou — ele descreve o CADASTRO, não o cursor da tela, e some quando some do cadastro. │
 * │                                                                                                  │
 * │ NOTE O QUE NÃO ESTÁ ESCRITO AQUI: nada sobre `linhas.length`. Uma única TOP sem `defaultId` NÃO  │
 * │ é padrão, não fica pré-selecionada e não lança sozinha — cardinalidade não é decisão do usuário. │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export function padraoDeLancamento(linhas: readonly LinhaDeLancamento[]): string | null {
  const padroes = linhas.filter((l) => l.ehPadrao);
  return padroes.length === 1 ? padroes[0]!.id : null;
}

/**
 * A LINHA ATIVA É SEMPRE UMA LINHA DO RECORTE ATUAL — sem exceção, recalculada a cada tecla.
 *
 * ┌─ POR QUE DERIVAR EM VEZ DE GUARDAR ────────────────────────────────────────────────────────────┐
 * │ Guardar "o id selecionado" e desenhá-lo direto é exatamente como se preserva um FANTASMA: a      │
 * │ pesquisa tira a linha da tela, o id continua guardado, e o Enter lança uma operação que o        │
 * │ usuário não está vendo. Aqui o que se guarda é a ESCOLHA do usuário; o que se desenha é o que    │
 * │ esta função devolve, e ela só devolve id que está no recorte.                                    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * As três regras, nesta ordem:
 *  1. escolha EXPLÍCITA do usuário (clique nas setas) visível → é ela. Escolha explícita vence a
 *     pré-seleção automática, e continua vencendo enquanto existir no recorte.
 *  2. sem escolha explícita e com o padrão visível → o padrão.
 *  3. qualquer outro caso → NENHUMA linha ativa.
 *
 * O caso 3 é deliberado e é onde esta função diverge do reflexo comum ("cai na primeira linha do
 * recorte"): a primeira linha é uma escolha que o usuário não fez, e "Lançar"/Enter agem sobre a
 * linha ativa. Cair na primeira transformaria um recorte de uma linha em lançamento a uma tecla de
 * distância — a mesma auto-seleção por cardinalidade que já foi bloqueador. Em vez de adivinhar, a
 * janela mostra o botão primário DESABILITADO e a contagem do recorte: nada acontece por engano, e
 * a primeira seta já ativa a primeira linha.
 *
 * Repare também que uma escolha explícita fora do recorte NÃO recai no padrão: ressuscitar o padrão
 * porque a escolha do usuário está apenas escondida lançaria o que ele trocou.
 */
export function linhaAtivaDoRecorte({ visiveis, escolhido, padrao }: {
  visiveis: readonly LinhaDeLancamento[];
  escolhido: string | null;
  padrao: string | null;
}): string | null {
  const existe = (id: string | null) => id !== null && visiveis.some((l) => l.id === id);
  if (escolhido !== null) return existe(escolhido) ? escolhido : null;
  return existe(padrao) ? padrao : null;
}

/** Os quatro movimentos do cursor virtual da lista (↓ ↑ Home End). */
export type MovimentoDeCursor = "proximo" | "anterior" | "primeiro" | "ultimo";

/**
 * O cursor virtual, SEM WRAP.
 *
 * ↑ na primeira e ↓ na última PARAM. Dar a volta faz a tela inteira saltar do topo para o fim e o
 * usuário perde o lugar; o ganho é zero numa lista que cabe em poucas rolagens.
 *
 * Com nada ativo, ↓ entra pela primeira linha e ↑ pela última — é a entrada natural na lista, e
 * continua sendo um ato explícito do usuário (ele apertou uma seta).
 */
export function moverAtivo(
  visiveis: readonly LinhaDeLancamento[],
  ativo: string | null,
  movimento: MovimentoDeCursor
): string | null {
  if (!visiveis.length) return null;
  const primeiro = visiveis[0]!.id;
  const ultimo = visiveis[visiveis.length - 1]!.id;
  if (movimento === "primeiro") return primeiro;
  if (movimento === "ultimo") return ultimo;
  const i = ativo === null ? -1 : visiveis.findIndex((l) => l.id === ativo);
  if (i < 0) return movimento === "proximo" ? primeiro : ultimo;
  const j = movimento === "proximo" ? i + 1 : i - 1;
  if (j < 0 || j >= visiveis.length) return visiveis[i]!.id;
  return visiveis[j]!.id;
}

/**
 * O MENU RÁPIDO DA SETA DO `Novo` — atalho, nunca a lista inteira (VISUAL-UX-01 R3).
 *
 * Até `LIMITE_DO_MENU_RAPIDO` operações no contexto, o menu mostra todas; acima disso, só as que o
 * SERVIDOR marcou como padrão (`ehPadrao`, vindo de `defaultId`). Nenhuma outra régua: nem "as
 * primeiras", nem "as mais usadas" — isso seria inventar uma preferência que ninguém cadastrou. Quem
 * precisa de outra operação tem "Escolher operação…", que abre a janela completa com pesquisa.
 *
 * O corte existe porque um menu de trinta linhas deixa de ser atalho: vira uma lista sem pesquisa.
 */
export const LIMITE_DO_MENU_RAPIDO = 8;

export function linhasDoMenuRapido(linhas: readonly LinhaDeLancamento[], limite = LIMITE_DO_MENU_RAPIDO): LinhaDeLancamento[] {
  return linhas.length <= limite ? linhas.slice() : linhas.filter((l) => l.ehPadrao);
}

/**
 * A porta do lançamento — montada num lugar só.
 *
 * O segmento vem da `VarianteDeVenda` da linha (registry), NUNCA de um mapa escrito aqui. E o
 * resultado continua sendo um PEDIDO: a página de criação reconfere o id contra a lista que o
 * servidor devolve para AQUELA variante. URL não autoriza — inclusive quando quem a montou fomos nós.
 */
export function rotaDeLancamento(linha: LinhaDeLancamento): string {
  return `/vendas/${linha.segmento}/new?tipo_operacao_id=${encodeURIComponent(linha.id)}`;
}

/** O que a região viva anuncia depois da digitação. Sem ela, quem usa leitor de tela digita no vazio. */
export function textoDeContagem(total: number): string {
  if (total === 0) return "Nenhuma operação encontrada";
  return total === 1 ? "1 operação encontrada" : `${total} operações encontradas`;
}
