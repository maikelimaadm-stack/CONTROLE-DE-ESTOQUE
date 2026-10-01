/**
 * CONFIGURAÇÃO DE LAYOUT — o contrato entre as partes da tela (decisão 275).
 *
 * A tela edita o MESMO documento de sempre (`FormLayout` de @agro/shared): o rascunho é uma cópia do salvo, toda
 * mudança passa por uma operação pura de `rascunho.ts` e entra na pilha de desfazer, e o Salvar grava o documento
 * renumerado (`paraSalvar`). Nenhuma chave nova entra no documento.
 *
 * Endereços: linha e campo são endereçados por CARD + POSIÇÃO (índice a partir de 0), nunca por `row.id` — o
 * normalizador do contrato renomeia e pode repetir ids de linha. Durante um arraste as posições são as da VISTA
 * (o layout sem o item que está na mão: o item sai do lugar na hora).
 */
import type { FormLayout, LayoutCard, LayoutFieldInfo } from "@agro/shared";
import type { FieldType } from "@agro/domain";

/*
 * ═══════════════════════════════ marcação comum (testes e medição) ═══════════════════════════════
 * Cada parte põe `data-parte` nos elementos abaixo — é por eles que o E2E e a medição desenho × produto acham as caixas.
 * Estados viram atributos (`data-*` presentes só quando verdadeiros, valor "true"), nunca só classe.
 *   raiz ................ data-testid="layout-config" data-modo="consulta|edicao"            (W1)
 *   barra ............... data-parte="barra" (o cartão) · role="toolbar" aria-label="Ações da configuração de layout" (W1)
 *   documento ........... data-parte="documento"                                           (W1)
 *   área principal ...... data-parte="principal" (faixas + linhas)                         (W1)
 *   coluna .............. data-parte="coluna" (<section aria-label="Campos">) · data-soltar="ok|sistema|ja-esta" durante o arraste (W3)
 *   busca ............... data-parte="busca" (a caixa)                                     (W3)
 *   lista da coluna ..... data-parte="lista-campos" · item: data-parte="item-campo" data-fid · data-obrigatorio  (W3)
 *   caixa de soltar ..... data-parte="caixa-soltar"                                        (W3)
 *   vazio da coluna ..... data-parte="vazio-coluna"                                        (W3)
 *   trilho .............. data-parte="trilho"                                              (W3)
 *   faixa de painéis .... data-parte="faixa-paineis" · aba: data-parte="aba-painel" data-id     (W4)
 *   faixa de cards ...... data-parte="faixa-cards" · pílula: data-parte="pilula-card" data-id   (W4)
 *   vão de aba/pílula ... data-parte="vao-faixa"                                           (W4)
 *   área das linhas ..... data-parte="area-linhas"                                         (W4)
 *   linha ............... data-parte="linha" data-linha (índice) · data-alvo-ativo · data-marcada · data-cheia (W4)
 *   cabeçalho da linha .. data-parte="cabeca-linha" · contador: data-parte="contador-linha"  (W4)
 *   corpo da linha ...... data-parte="corpo-linha"                                         (W4)
 *   campo ............... data-parte="campo" data-fid · data-selecionado · data-inspetor · data-oculto · data-obrigatorio · data-pousa
 *                         · data-troca="ok|recusa" quando é alvo de troca                    (W4)
 *   "+ Campo" ........... data-parte="mais-campo"                                          (W4)
 *   vão ................. data-parte="vao"  ·  eco: data-parte="eco"  ·  traço de linha: data-parte="traco-linha"  (W4)
 *   inspetor ............ data-parte="inspetor" (<aside aria-label="Propriedades do campo">)  (W5)
 *   fantasma ............ data-parte="fantasma" data-tipo (campo|disponivel|linha|painel|card)  (W2)
 * Dica (tooltip): `data-dica="texto"` + o mesmo texto em `aria-label` quando o botão é só ícone. O CSS da dica é um só,
 * `.raiz [data-dica]` em pagina.module.css (W1); ninguém mais desenha tooltip.
 */

export type Modo = "consulta" | "edicao";
export type AbaColuna = "disponiveis" | "em-uso";

/** Campo do cadastro como o configurador o vê: a definição (`LayoutFieldInfo`) + o tipo, para a pílula do inspetor. */
export interface CampoInfo extends LayoutFieldInfo { tipo: FieldType }

/** O que a DEFINIÇÃO do cadastro diz de cada campo. Nunca deriva do layout. */
export interface Contexto {
  campos: CampoInfo[];
  info: (fid: string) => CampoInfo | undefined;
  /** "Campo do sistema" = obrigatório na definição (FieldDef.required): não sai do formulário, não fica oculto, segue obrigatório. */
  ehDoSistema: (fid: string) => boolean;
  /** Só leitura na definição (FieldDef.readOnly): "Somente leitura" ligado e travado; Obrigatório não liga. */
  ehSoLeituraNaDefinicao: (fid: string) => boolean;
}

export interface EnderecoLinha { cardId: string; linha: number }
export interface EnderecoCampo extends EnderecoLinha { posicao: number }

/** Destino de um campo que entra no formulário. Sem `linha`: "empurra" (última linha do card com vaga, senão linha nova). */
export interface DestinoCampo { cardId: string; linha?: number; posicao?: number }

/* ═══════════════════════════════ arrastar ═══════════════════════════════ */

/** O que está na mão. `rotulo` é o texto do fantasma e do vão. */
export type ItemArrastado =
  | { tipo: "disponivel"; fid: string; rotulo: string; obrigatorio: boolean }
  | { tipo: "campo"; fid: string; rotulo: string; obrigatorio: boolean; origem: EnderecoCampo }
  | { tipo: "linha"; cardId: string; linha: number; rotulo: string; detalhe?: string }
  | { tipo: "painel"; panelId: string; rotulo: string; detalhe?: string }
  | { tipo: "card"; cardId: string; rotulo: string; detalhe?: string };

/**
 * Alvo de soltar, como está no DOM: todo elemento que recebe um soltar leva `data-alvo={alvo(...)}`. O motor acha o
 * alvo pelo elemento sob o ponteiro (`elementFromPoint(...).closest("[data-alvo]")`), em coordenadas da VISTA.
 *  - campo: sobre o campo `posicao` da linha (ou sobre o vão aberto, que leva a própria posição) → o vão abre ANTES dele;
 *  - linha: qualquer outro ponto da linha (cabeçalho, "+ Campo", fim do corpo) → campo: fim da linha; linha: antes desta;
 *  - fim-linhas: depois da última linha (a área do "Adicionar linha") → linha arrastada vai para o fim;
 *  - coluna: a coluna da esquerda inteira (tirar do formulário);
 *  - painel / card: sobre a aba / pílula `indice` (ou o vão, ou o fim da faixa com indice = quantidade) → antes dela.
 */
export type AlvoBruto =
  | { t: "campo"; cardId: string; linha: number; posicao: number }
  | { t: "linha"; cardId: string; linha: number }
  | { t: "fim-linhas"; cardId: string }
  | { t: "coluna" }
  | { t: "painel"; indice: number }
  | { t: "card"; indice: number };

/** Valor do atributo `data-alvo`. Use SEMPRE esta função: o motor lê o atributo com `lerAlvo`. */
export const alvo = (a: AlvoBruto): string => JSON.stringify(a);
export function lerAlvo(s: string | null | undefined): AlvoBruto | null {
  if (!s) return null;
  try { const v = JSON.parse(s) as AlvoBruto; return v && typeof v === "object" && typeof v.t === "string" ? v : null; } catch { return null; }
}

/**
 * O que o soltar FARIA agora (o que a tela desenha durante o arraste). `null` = solto aqui, nada muda.
 *  - inserir: o vão aberto na linha, na posição (vista), com o rótulo do item;
 *  - trocar: linha cheia; o campo da posição vira alvo de troca (`recusa` = campo do sistema vindo da coluna: vermelho, ✕).
 *    Item vindo de outra linha: o lugar de origem (`item.origem`) mostra o eco "↔ <campo da linha cheia>";
 *  - coluna: soltar na coluna tira do formulário (`recusa`: "sistema" = campo do sistema; "ja-esta" = item da própria coluna);
 *  - linha / painel / card: o traço (linha) ou o vão (aba, pílula) antes de `antes` (vista; = quantidade → no fim).
 */
export type Previsao =
  | { tipo: "inserir"; cardId: string; linha: number; posicao: number }
  | { tipo: "trocar"; cardId: string; linha: number; posicao: number; fidAlvo: string; recusa: boolean }
  | { tipo: "coluna"; recusa: null | "sistema" | "ja-esta" }
  | { tipo: "linha"; cardId: string; antes: number }
  | { tipo: "painel"; antes: number }
  | { tipo: "card"; antes: number };

/** O que acabou de pousar (o toque "pousa"); o motor limpa sozinho depois da animação. */
export type Pouso =
  | { tipo: "campo"; fids: string[] }
  | { tipo: "linha"; cardId: string; linha: number }
  | { tipo: "painel"; panelId: string }
  | { tipo: "card"; cardId: string };

export interface ApiArraste {
  /** o que está na mão (só depois do limiar de 4 px); `null` fora de arraste */
  item: ItemArrastado | null;
  /** o que o soltar faria agora */
  previsao: Previsao | null;
  pouso: Pouso | null;
  /** no `onPointerDown` do elemento arrastável (botão principal, só na edição). O arraste só começa depois de 4 px. */
  iniciar: (e: React.PointerEvent<HTMLElement>, item: ItemArrastado) => void;
}

export interface PropsProvedorArraste {
  /** só na edição; fora dela `iniciar` não faz nada */
  ativo: boolean;
  /** resolve o alvo sob o ponteiro (vista) na previsão — normalmente `preverSoltura(layout, ctx, item, alvo)` */
  prever: (item: ItemArrastado, alvo: AlvoBruto) => Previsao | null;
  /** soltar válido: UMA entrada na pilha — normalmente `aplicarSoltura(...)` e a pilha */
  soltar: (item: ItemArrastado, previsao: Previsao) => void;
  children: React.ReactNode;
}

/* ═══════════════════════════════ pilha de desfazer ═══════════════════════════════ */

/** Pilha de 50. `digitacao` = chave da entrada aberta por digitação (ex.: "rotulo:code"): a mesma chave substitui o presente. */
export interface Pilha { passado: FormLayout[]; presente: FormLayout; futuro: FormLayout[]; digitacao: string | null }
export const LIMITE_DA_PILHA = 50;

/* ═══════════════════════════════ operações puras (rascunho.ts) ═══════════════════════════════ */

/**
 * Toda operação recebe o layout e devolve um NOVO layout (nunca muta). `null` = recusa (nada muda).
 * Regras que valem para todas:
 *  - `order` de painéis e cards renumerado 1..n na ordem do array (cards: o array inteiro) a cada criar, excluir e mover;
 *  - `panel.hidden`, `card.collapsible`, `fieldSizes` e `meta` atravessam intactos;
 *  - linha vazia continua no rascunho (só `paraSalvar` a descarta) — tirar um campo nunca muda o índice das linhas;
 *  - entrada vinda de Disponíveis (usar, empurrar, usar todos, troca vinda da coluna) TIRA o campo de `hiddenFieldIds`;
 *    mover, trocar entre linhas e reordenar NÃO mexem no Visível; tudo o que sai das linhas ENTRA em `hiddenFieldIds`;
 *  - rótulo, obrigatório, só leitura e valor padrão ficam com o campo mesmo fora do formulário;
 *  - limite por linha = `MAX_FIELDS_PER_ROW[card.colSpan]` (7 inteiro, 4 meio).
 */
export interface Operacoes {
  criarContexto(campos: CampoInfo[]): Contexto;

  /** cópia profunda do salvo; painéis e cards por `order`; linhas de cada card r1..rN; `order` 1..n */
  abrirRascunho(salvo: FormLayout): FormLayout;
  /** id de card repetido ganha sufixo único (geral, geral_2…; o primeiro na ordem do array fica com o id). Sem repetição: o MESMO objeto */
  cardsComIdUnico(l: FormLayout): FormLayout;
  /** o documento do Salvar: sem linhas vazias, linhas r1..rN, `order` 1..n, SÓ as chaves do FormLayout */
  paraSalvar(rascunho: FormLayout): FormLayout;
  /** forma canônica (string): painéis e cards na ordem, cards por painel, linhas só como listas de campos e sem as vazias, listas e mapas ordenados, sem ids de linha, sem `order` e sem `meta` */
  formaCanonica(l: FormLayout): string;
  alterado(rascunho: FormLayout, salvo: FormLayout): boolean;

  /* consultas */
  posicionados(l: FormLayout): Set<string>;
  cardsDoPainel(l: FormLayout, panelId: string): LayoutCard[];
  contagemDoPainel(l: FormLayout, panelId: string): number;
  contagemDoCard(card: LayoutCard): number;
  limiteDaLinha(card: LayoutCard): number;
  /** onde o campo está (null = fora do formulário) */
  enderecoDe(l: FormLayout, fid: string): EnderecoCampo | null;
  obrigatorio(l: FormLayout, ctx: Contexto, fid: string): boolean;
  visivel(l: FormLayout, ctx: Contexto, fid: string): boolean;
  somenteLeitura(l: FormLayout, ctx: Contexto, fid: string): boolean;
  /** motivo para o botão ficar desabilitado (texto da dica) ou null */
  motivoNaoExcluirPainel(l: FormLayout, ctx: Contexto, panelId: string): string | null;
  motivoNaoExcluirCard(l: FormLayout, ctx: Contexto, cardId: string): string | null;
  motivoNaoRemoverLinha(l: FormLayout, ctx: Contexto, end: EnderecoLinha): string | null;

  /* campos */
  usarCampo(l: FormLayout, ctx: Contexto, fid: string, destino: DestinoCampo): FormLayout | null;
  moverCampo(l: FormLayout, ctx: Contexto, fid: string, destino: EnderecoCampo): FormLayout | null;
  trocarEntreLinhas(l: FormLayout, ctx: Contexto, fid: string, fidAlvo: string): FormLayout | null;
  trocarComDisponivel(l: FormLayout, ctx: Contexto, fidNovo: string, fidAlvo: string): FormLayout | null;
  tirarCampo(l: FormLayout, ctx: Contexto, fid: string): FormLayout | null;
  /** todos os disponíveis no card, empurrando (ignora busca e marca) */
  usarTodos(l: FormLayout, ctx: Contexto, cardId: string): FormLayout | null;
  /** todos do card, menos os do sistema */
  tirarTodos(l: FormLayout, ctx: Contexto, cardId: string): FormLayout | null;

  /* linhas (índice `linha` = posição no card; `linha === rows.length` cria a linha) */
  adicionarLinha(l: FormLayout, cardId: string): FormLayout;
  removerLinha(l: FormLayout, ctx: Contexto, end: EnderecoLinha): FormLayout | null;
  /** `para` = posição de inserção na lista SEM a linha (vista) */
  moverLinha(l: FormLayout, cardId: string, de: number, para: number): FormLayout | null;

  /* painéis: "Painel N" (N = quantos passam a existir) com um card "Dados" inteiro */
  adicionarPainel(l: FormLayout, ids: { painel: string; card: string }): FormLayout;
  removerPainel(l: FormLayout, ctx: Contexto, panelId: string): FormLayout | null;
  moverPainel(l: FormLayout, panelId: string, para: number): FormLayout | null;
  renomearPainel(l: FormLayout, panelId: string, nome: string): FormLayout | null;

  /* cards: "Card N" inteiro (N = quantos o painel passa a ter) */
  adicionarCard(l: FormLayout, panelId: string, cardId: string): FormLayout;
  removerCard(l: FormLayout, ctx: Contexto, cardId: string): FormLayout | null;
  moverCard(l: FormLayout, cardId: string, para: number): FormLayout | null;
  renomearCard(l: FormLayout, cardId: string, nome: string): FormLayout | null;
  /** inteiro ↔ meio; indo para meio, a linha com mais de 4 campos se divide (empacotamento do normalizador), só neste card */
  alternarLargura(l: FormLayout, cardId: string): FormLayout;

  /* propriedades do campo */
  definirRotulo(l: FormLayout, fid: string, texto: string): FormLayout;
  /** ligar liga Visível e desliga Somente leitura (um passo só); travado no campo do sistema; não liga no só leitura da definição */
  definirObrigatorio(l: FormLayout, ctx: Contexto, fid: string, ligado: boolean): FormLayout;
  definirVisivel(l: FormLayout, ctx: Contexto, fid: string, ligado: boolean): FormLayout;
  definirSomenteLeitura(l: FormLayout, ctx: Contexto, fid: string, ligado: boolean): FormLayout;
  /** `undefined` ou "" apaga a chave (nunca grava "") */
  definirValorPadrao(l: FormLayout, fid: string, valor: string | undefined): FormLayout;

  /* arrastar */
  /** o layout como a tela o mostra durante o arraste: sem o item na mão (campo, linha, painel ou card) */
  vistaDuranteArraste(l: FormLayout, item: ItemArrastado | null): FormLayout;
  /** `layout` é o REAL; o alvo vem em coordenadas da vista */
  preverSoltura(l: FormLayout, ctx: Contexto, item: ItemArrastado, a: AlvoBruto): Previsao | null;
  aplicarSoltura(l: FormLayout, ctx: Contexto, item: ItemArrastado, p: Previsao): FormLayout | null;

  /* pilha */
  criarPilha(l: FormLayout): Pilha;
  /** mudança nova: empilha (corta o refazer; limite 50). Com `digitacao` igual à aberta: substitui o presente. */
  aplicar(p: Pilha, novo: FormLayout, digitacao?: string): Pilha;
  fecharDigitacao(p: Pilha): Pilha;
  desfazer(p: Pilha): Pilha;
  refazer(p: Pilha): Pilha;
  podeDesfazer(p: Pilha): boolean;
  podeRefazer(p: Pilha): boolean;
}

/* ═══════════════════════════════ props das partes da tela ═══════════════════════════════ */

/** barra.tsx (W1) */
export interface PropsBarra {
  modo: Modo;
  /** leitura das preferências (p.loaded / erro): só com "ok" o Editar abre — sem isso o rascunho nasceria do padrão */
  leitura: "carregando" | "ok" | "falhou";
  alterado: boolean;
  podeDesfazer: boolean;
  podeRefazer: boolean;
  preVisualizar: boolean;
  /** a personalização é do usuário (source = "user") */
  temPersonalizacao: boolean;
  podeEditarOrg: boolean;
  temPadraoOrg: boolean;
  voltarHref: string;
  aoEditar: () => void;
  aoSalvar: () => void;
  aoDescartar: () => void;
  aoDesfazer: () => void;
  aoRefazer: () => void;
  aoAlternarPreVisualizar: () => void;
  aoRestaurar: () => void;
  aoUsarComoPadraoOrg: () => void;
  aoRemoverPadraoOrg: () => void;
}

/** coluna.tsx (W3): a coluna da esquerda (só na edição) */
export interface PropsColuna {
  aba: AbaColuna;
  aoTrocarAba: (a: AbaColuna) => void;
  busca: string;
  aoBuscar: (texto: string) => void;
  refBusca: React.RefObject<HTMLInputElement | null>;
  /** todos os campos fora do formulário, na ordem da definição (a coluna filtra pela busca) */
  disponiveis: CampoInfo[];
  /** todos os campos no formulário, na ordem da definição */
  emUso: CampoInfo[];
  obrigatorio: (fid: string) => boolean;
  doSistema: (fid: string) => boolean;
  aoAdicionar: (fid: string) => void;
  aoTirar: (fid: string) => void;
}

/** coluna.tsx (W3): o trilho entre a coluna e as linhas (só na edição) */
export interface PropsTrilho {
  /** quantos disponíveis entram com "Usar todos" (0 = desabilitado) */
  usarTodos: number;
  /** quantos saem do card aberto com "Tirar todos" (0 = desabilitado) */
  tirarTodos: number;
  aoUsarTodos: () => void;
  aoTirarTodos: () => void;
}

/** faixas.tsx (W4): faixa de painéis + faixa de cards */
export interface PropsFaixas {
  modo: Modo;
  /** a vista (sem o item na mão) */
  layout: FormLayout;
  painelId: string;
  cardId: string;
  aoSelecionarPainel: (panelId: string) => void;
  aoSelecionarCard: (cardId: string) => void;
  contagemDoPainel: (panelId: string) => number;
  renomeando: { tipo: "painel" | "card"; id: string } | null;
  aoIniciarRenomear: (tipo: "painel" | "card", id: string) => void;
  /** `nome` null = cancelar (Esc ou vazio); texto = gravar (Enter ou sair da caixa) */
  aoRenomear: (tipo: "painel" | "card", id: string, nome: string | null) => void;
  aoAdicionarPainel: () => void;
  aoExcluirPainel: () => void;
  motivoNaoExcluirPainel: string | null;
  aoAdicionarCard: () => void;
  aoExcluirCard: () => void;
  motivoNaoExcluirCard: string | null;
  aoAlternarLargura: () => void;
}

/** linhas.tsx (W4): as linhas do card aberto */
export interface PropsLinhas {
  modo: Modo;
  /** a vista (sem o item na mão) */
  layout: FormLayout;
  card: LayoutCard | undefined;
  rotulo: (fid: string) => string;
  /** o nome do campo na definição (o fantasma e o vão do desenho mostram este, não o rótulo do layout) */
  nomeDoSistema: (fid: string) => string;
  obrigatorio: (fid: string) => boolean;
  doSistema: (fid: string) => boolean;
  oculto: (fid: string) => boolean;
  somenteLeitura: (fid: string) => boolean;
  temValorPadrao: (fid: string) => boolean;
  preVisualizar: boolean;
  selecionado: string | null;
  inspetor: string | null;
  marca: EnderecoLinha | null;
  aoSelecionar: (fid: string) => void;
  aoAbrirInspetor: (fid: string) => void;
  aoTirar: (fid: string) => void;
  aoMarcarLinha: (end: EnderecoLinha) => void;
  aoRemoverLinha: (end: EnderecoLinha) => void;
  motivoNaoRemoverLinha: (end: EnderecoLinha) => string | null;
  aoAdicionarLinha: () => void;
}

/** inspetor.tsx (W5): <aside aria-label="Propriedades do campo"> à direita (só na edição) */
export interface PropsInspetor {
  campo: CampoInfo;
  /** o rótulo próprio (fieldLabels[fid]); undefined = nome do sistema */
  rotulo: string | undefined;
  obrigatorio: boolean;
  visivel: boolean;
  somenteLeitura: boolean;
  valorPadrao: string | undefined;
  doSistema: boolean;
  soLeituraNaDefinicao: boolean;
  /** cada tecla; a pilha junta a digitação numa entrada só até `aoFecharDigitacao` */
  aoRotulo: (texto: string) => void;
  aoValorPadrao: (valor: string | undefined) => void;
  /** sair da caixa ou Enter */
  aoFecharDigitacao: () => void;
  aoObrigatorio: (ligado: boolean) => void;
  aoVisivel: (ligado: boolean) => void;
  aoSomenteLeitura: (ligado: boolean) => void;
  aoFechar: () => void;
}

/* ═══════════════════════════════ notas do motor (W2) ═══════════════════════════════
 * Acréscimo do dono do contrato (W2); nada acima mudou.
 *  - Operação "sem efeito" devolve o MESMO objeto que recebeu (ex.: definirObrigatorio no campo do sistema, renomear com o
 *    mesmo nome, mover para a mesma posição, adicionarLinha num card inexistente). `aplicar` com a mesma referência não
 *    empilha. Recusa continua sendo `null`.
 *  - Rascunho: todo card tem ao menos uma linha (abrirRascunho dá a "Linha 1" vazia ao card sem linha de um layout antigo);
 *    as linhas se chamam r1..rN e `order` = posição, depois de qualquer operação.
 *  - definirObrigatorio(ligado) e definirVisivel(ligado) só tiram de `hiddenFieldIds` o campo que está numa linha (fora
 *    delas ele iria para "Outros campos" ao salvar). O inspetor só abre para campo numa linha: na tela não muda nada.
 *  - vistaDuranteArraste de PAINEL tira só a aba (os cards dele continuam no documento); de CARD tira o card do array —
 *    a área das linhas usa o card do layout real enquanto a pílula está na mão.
 *  - Arrastar: elemento com `data-sem-arraste` (e todo button, input, textarea, select, a[href] ou contenteditable) DENTRO
 *    do elemento que chama `iniciar` não começa arraste. Recusa (troca vermelha, coluna "sistema" ou "ja-esta") não chama
 *    `soltar` nem marca `pouso`. `pouso` dura 380 ms (a animação "pousa" = --mo-set, 340 ms, + folga). Durante o arraste o
 *    <html> leva a classe da mão fechada (cursor grabbing e sem seleção de texto em toda a tela).
 */
