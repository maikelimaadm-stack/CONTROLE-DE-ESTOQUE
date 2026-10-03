/**
 * MOTOR DA CENTRAL — o CONTRATO (VISUAL-UX-04).
 *
 * O motor da Central (moldura, campo, barra, leque, documentos abertos, novo documento, itens, painel, diálogos,
 * pesquisa) não conhece espécie nenhuma. Tudo o que muda de uma espécie para outra — rotas, textos, prefixo dos
 * testids, de onde vêm os documentos abertos, colunas dos itens, ações da barra e do leque, entidade do histórico,
 * link dos títulos e a rota do novo documento por Tipo de Operação — chega pelo ADAPTADOR (`AdaptadorDaCentral`).
 *
 * Este arquivo é só TIPOS (e constantes triviais): nada de JSX, nada de chamada de API, nada de regra. A espécie que
 * já existia continua idêntica porque o adaptador dela devolve exatamente os valores que estavam fixos no código
 * (o prefixo de testid, os textos, as portas de leitura). Os recursos novos de `ItensDaCentral` (lote e validade por
 * linha, armazém por item, armazém forçado, modo "da origem") são OPCIONAIS e desligados por padrão; o custo médio no
 * unitário e as casas da quantidade na leitura têm por padrão o comportamento da espécie que já existia.
 * OPERACOES-01 F3b (decisão 280): o local de estoque vem antes do produto, o "Local de estoque" do cabeçalho preenche
 * as linhas novas (estado da tela) e a pesquisa de produto mostra o saldo do local — só com a capacidade que a API
 * declara; sem ela, a pesquisa de hoje.
 * OPERACOES-01 F5b (decisão 282): o documento de estoque não tem valor e não inventa quantidade. A criação ganha
 * `linhaNovaEmBranco` (quantidade e valor unitário da linha nova VAZIOS), `subtotal` (`false` tira o "Subtotal dos
 * itens" do rodapé) e `casasDaQuantidade` (as casas da quantidade na célula não ativa da grade); a consulta ganha
 * `subtotal: null` (sem a linha do subtotal), `rotulos` (o rótulo da espécie no lugar do fixo) e `colunasExtras` (as
 * colunas da espécie, depois de todas as outras) e `formularioPelasColunas` (o formulário de leitura só com os campos
 * das colunas da espécie). Todas são OPCIONAIS e o padrão é o de hoje: sem elas, as Centrais de Vendas e de Compras não
 * mudam nada (DOM, classes, payload, testids e textos).
 */
import type * as React from "react";
import type { ColunaDoLayout } from "@agro/domain";
import type { ItemRow, Plan, Row } from "@/features/docs/shared";
import type { WsTab } from "@/lib/workspace-tabs";

/* ─────────────────────────────── Tipos de base ─────────────────────────────── */

/** Posição do rótulo dos campos: rótulo à frente ou compacto. */
export type Densidade = "rotulo-a-frente" | "compacto";
export type IconeDoCampo = "pesquisa" | "data" | "selecao";
export type EstadoDoCampo = "editavel" | "leitura" | "travado" | "desabilitado";
/** Adorno do campo em leitura: o mesmo ícone do editável, mais o cadeado do travado. */
export type AdornoDoCampo = "pesquisa" | "data" | "selecao" | "travado";
export type RegiaoAmpliavel = "dados" | "itens" | "painel";
export type Visao = "grade" | "formulario";
export type TomDaSituacao = "positive" | "negative" | "warning" | "info" | "neutral";
/** Atributos `data-*` repassados ao invólucro (ex.: `data-campo`, `data-exigido-top`). */
export type AtributosDeDados = { [k: `data-${string}`]: string | undefined };

export interface Preferencia<K extends string> { chave: K; visivel: boolean }

/** Limites dos divisores — os mesmos do desenho aprovado. */
export const LARGURA_DADOS = { min: 17, max: 52, padrao: 30, passo: 1 } as const;
export const ALTURA_PAINEL = { min: 92, max: 430, padrao: 206, passo: 8 } as const;
/** Quanto tempo o "Salvo" fica na barra. */
export const TEMPO_DO_SALVO_MS = 2400;
/** Limite do motivo do cancelamento — o mesmo da API. */
export const LIMITE_DO_MOTIVO = 500;

/* ─────────────────────────────── O ADAPTADOR ─────────────────────────────── */

/** Uma linha do menu "Novo documento": uma TOP que o SERVIDOR listou para a espécie. */
export interface LinhaDoNovoDocumento { id: string; code: string; name: string; ehPadrao: boolean }

/** O que o menu "Novo documento" precisa da espécie — sem conhecer de onde vêm as TOPs. */
export interface FonteDoNovoDocumento {
  /** Hook: as TOPs da espécie (`todas`) e o corte do menu rápido (`doMenu`). Chamado incondicionalmente pelo motor. */
  useLinhas: () => { carregando: boolean; todas: readonly LinhaDoNovoDocumento[]; doMenu: readonly LinhaDoNovoDocumento[] };
  /** Rótulo da espécie no título do menu ("Nova operação · <rotulo>"). */
  rotulo: string;
  /** Rota do novo documento com a TOP escolhida (a página RECONFERE a TOP: URL não autoriza). */
  rotaDaTop: (linha: LinhaDoNovoDocumento) => string;
  /** Rota do lançador ("Escolher operação…"). */
  rotaDoLancador: string;
}

/** Um documento da espécie aberto numa aba de trabalho. `porta`: a leitura do registro salvo; null na criação. */
export interface DocumentoAberto { aba: WsTab; porta: string | null; novo: boolean }

/** De onde vêm os documentos abertos: a MESMA fonte da barra de abas, filtrada pela espécie. */
export interface FonteDosDocumentosAbertos {
  /** A aba é um documento desta espécie? Devolve a porta de leitura (registro) ou null (não é da espécie). */
  documentoDaAba: (aba: WsTab) => DocumentoAberto | null;
  /** O campo da contraparte na resposta da porta (ex.: o nome de quem está do outro lado do documento). */
  campoDaContraparte: string;
  /** Sufixo do testid da coluna da contraparte (`<prefixo>-documento-<sufixo>`), mantido pela espécie. */
  sufixoTestidDaContraparte: string;
}

/** Textos da espécie que o motor mostra. */
export interface TextosDaCentral {
  /** Nome da região para leitores de tela na criação (ex.: "Nova <Espécie>"). */
  tituloDaCriacao: string;
  /** Título da leitura pendente da consulta. */
  tituloDaLeituraPendente: string;
  /** Rótulo do botão/pílula de confirmação e título do diálogo ("Confirmar <espécie>"). */
  confirmar: string;
  /** Espécie em minúsculas, como no título e no botão do cancelamento. */
  especieMinuscula: string;
  /** Legenda dos títulos financeiros vinculados. */
  legendaDosTitulos: string;
}

/** Colunas dos itens — na criação e na leitura. */
export interface ColunasDosItens {
  /** Catálogo de colunas de item do layout da espécie (as `sistema` desenham a grade sem layout). */
  doSistema: ReadonlySet<string>;
  /** Campo do catálogo → coluna do motor. Campo sem coluna do motor é ignorado pela grade. */
  doCatalogo: Readonly<Record<string, ChaveColunaDoItem>>;
  /** Colunas da leitura (registro salvo), na ordem padrão. */
  leitura: readonly ChaveColunaSalva[];
}

/** O que cada ação do leque/barra entrega ao motor. */
export interface ItemRapido {
  chave: string; rotulo: string; testId: string; onSelect: () => void;
  icone?: React.ReactNode; numero?: number; desabilitado?: boolean; perigo?: boolean;
}

/** Ações da barra e do leque que a ESPÉCIE decide (o motor só as dispõe). */
export interface AcoesDaEspecie {
  /** Itens do leque antes de "N documentos abertos". */
  antes: (ctx: ContextoDasAcoes) => ItemRapido[];
  /** Itens do leque depois de "N documentos abertos". */
  depois?: (ctx: ContextoDasAcoes) => ItemRapido[];
  /** Botões extras da barra, à esquerda (ex.: duplicar, confirmar, converter). */
  barra?: (ctx: ContextoDasAcoes) => React.ReactNode;
}
export interface ContextoDasAcoes { modo: "criacao" | "consulta"; id?: string; can: (permissao: string) => boolean }

/**
 * O ADAPTADOR DA ESPÉCIE — tudo o que o motor precisa saber e não pode conhecer por nome.
 * A espécie existente devolve exatamente os valores que eram fixos (prefixo de testid, textos, portas).
 */
export interface AdaptadorDaCentral {
  /** Prefixo de TODOS os testids do motor (ex.: o da espécie existente). */
  prefixoTestid: string;
  /** Segmento da espécie na rota (`/<area>/<segmento>/…`). */
  segmento: string;
  rotas: {
    /** Para onde vai "Cancelar" do lançador. */
    lista: string;
    /** Rota da criação (sem TOP). */
    nova: string;
    /** Rota do registro salvo. */
    registro: (id: string) => string;
    /** Porta de leitura do registro salvo na API. */
    porta: (id: string) => string;
  };
  textos: TextosDaCentral;
  documentosAbertos: FonteDosDocumentosAbertos;
  novoDocumento: FonteDoNovoDocumento;
  colunasDosItens: ColunasDosItens;
  acoes?: AcoesDaEspecie;
  /** Entidade auditada do histórico de alterações; null: sem histórico. */
  entidadeDoHistorico: string | null;
  /** Link de cada título financeiro vinculado (painel Financeiro). */
  linkDoTitulo: (titulo: Row) => string;
  /** Link de um documento derivado (painel). */
  linkDoDerivado?: (derivado: Row) => string;
  /** Chave (do Map em memória, nunca storage) do "Salvo" entregue da criação à consulta. */
  chaveDoSalvo: (id: string) => string;
  /** Chave da cópia que espera a criação desta espécie. */
  chaveDaCopia: (segmento: string) => string;
}

/* ─────────────── M1 — moldura.tsx (+ moldura.module.css) ─────────────── */

export interface AbaDoPainel {
  value: string; label: string; content: React.ReactNode;
  contador?: number;
  erro?: boolean;
}
export interface ControleDaCentral { abrirAba: (valor: string) => void }
export interface IdentidadeDoDocumento {
  nome: string; alterado: boolean; codigo?: boolean; dica?: string; icone?: React.ReactNode; tom?: TomDaSituacao; situacao?: React.ReactNode;
}
/** `MolduraDaCentral`. */
export interface PropsDaMoldura {
  /** O prefixo de testid vem do adaptador da espécie. */
  prefixoTestid: string;
  titulo: string;
  acoes: React.ReactNode;
  acoesDireita?: React.ReactNode;
  identidade: IdentidadeDoDocumento;
  aviso?: React.ReactNode;
  dados: React.ReactNode;
  itens: React.ReactNode;
  abas: AbaDoPainel[];
  densidade?: Densidade;
  carregando?: boolean;
  controle?: React.MutableRefObject<ControleDaCentral | null>;
  className?: string;
}
/** `BotaoAmpliar` — lê o prefixo do contexto da moldura. */
export interface PropsDoBotaoAmpliar { regiao: RegiaoAmpliavel }

/* ─────────────── M2 — campo.tsx (+ campo.module.css) ─────────────── */

export type PropsDoCampo = {
  rotulo: string; obrigatorio?: boolean; erro?: string; icone?: IconeDoCampo | null; estado?: EstadoDoCampo;
  preenchido?: boolean; multilinha?: boolean; testId?: string; abaixo?: React.ReactNode; dica?: string; children: React.ReactNode;
} & AtributosDeDados;
export interface PropsDoCampoLeitura { rotulo: string; valor: React.ReactNode; adorno?: AdornoDoCampo; testId?: string; multilinha?: boolean }
export type PropsDaChaveSimNao = { rotulo: string; valor: boolean; onChange?: (v: boolean) => void; desabilitado?: boolean; testId?: string } & AtributosDeDados;
export interface PropsDaColunaDeCampos { children: React.ReactNode; id?: string; hidden?: boolean }
export interface PropsDosDadosAdicionais { quantidade: number; aberto: boolean; onAlternar: () => void; manterMontado?: boolean; children: React.ReactNode }
export interface PropsDaData { id?: string; className?: string; value: string; onChange: (iso: string) => void; disabled?: boolean; rotulo?: string }

/* ─────────────── M3 — barra.tsx (+ barra.module.css) ─────────────── */

export interface Pendencia { caminho: string; rotulo: string; mensagem: string }
export interface PropsDaPosicaoDoRotulo { valor: Densidade; onChange: (v: Densidade) => void }
export interface PropsDasPendencias {
  prefixoTestid: string;
  pendencias: readonly Pendencia[]; aberta: boolean; onAbertaChange: (a: boolean) => void; onIr: (p: Pendencia) => void;
}
/** `BotaoDaBarra`: os atributos do <button> + rótulo/dica. */
export type PropsDoBotaoDaBarra = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  rotulo: string; dica?: string; solido?: boolean; ocupado?: boolean; dicaNoFim?: boolean;
};
export type PropsDaPilulaDaBarra = React.ButtonHTMLAttributes<HTMLButtonElement> & { icone: React.ReactNode; dica?: string; ocupado?: boolean };
export interface PropsDoConjunto { children: React.ReactNode }
export interface PropsDosIndicadores { prefixoTestid: string }
/** O que a criação deixa para a consulta: o "Salvo" e o pedido de abrir a confirmação. */
export interface DepoisDeSalvar { confirmar: boolean }

/* ─────────────── M4 — acoes-rapidas.tsx ─────────────── */

export interface PropsDasAcoesRapidas {
  prefixoTestid: string;
  documentosAbertos: FonteDosDocumentosAbertos;
  antes: ItemRapido[]; depois?: ItemRapido[]; desabilitado?: boolean;
}

/* ─────────────── M5 — documentos-abertos.tsx ─────────────── */

export interface DocumentosAbertos {
  /** O contexto das abas de trabalho (`useWorkspaceTabs()` não nulo). */
  ws: {
    tabs: WsTab[]; active: string | null; dirty: ReadonlySet<string>;
    focusTab: (key: string) => void; closeTab: (key: string, force?: boolean) => boolean;
  };
  docs: DocumentoAberto[];
}
/** Hook `useDocumentosAbertos(fonte)`: null fora do shell. */
export type UseDocumentosAbertos = (fonte: FonteDosDocumentosAbertos) => DocumentosAbertos | null;
export interface PropsDaListaDeDocumentosAbertos {
  prefixoTestid: string;
  fonte: FonteDosDocumentosAbertos;
  aberta: boolean; onFechar: () => void;
  ancora: React.RefObject<HTMLSpanElement | null>;
  botao: React.RefObject<HTMLButtonElement | null>;
  documentos: DocumentosAbertos;
}

/* ─────────────── M6 — novo-documento.tsx ─────────────── */

export interface PropsDoNovoDocumento { prefixoTestid: string; fonte: FonteDoNovoDocumento }

/* ─────────────── M7 — itens.tsx (+ grade.module.css) ─────────────── */

/** Colunas da grade da criação. `lote`, `validade` e `saldo` só aparecem quando a espécie as liga. */
export type ChaveColunaDoItem =
  | "codigo" | "produto" | "armazem" | "estoque" | "quantidade" | "unitario" | "desconto" | "descontoPercentual" | "total"
  | "lote" | "validade" | "saldo";
export type ChaveCampoDoItem = Exclude<ChaveColunaDoItem, "codigo"> | "unidade";

export interface LayoutDosItens { colunas: readonly ColunaDoLayout[] }

/** Lote e validade por linha — habilitados pelo controle de lote do produto. Ausente: nenhuma das duas colunas. */
export interface LoteDosItens {
  /** O que a linha aceita, pelo cadastro do produto (desconhecido = aberto; quem recusa é o servidor). */
  daLinha: (item: ItemRow) => { lote: boolean; validade: boolean };
}

/** Modo "da origem": as linhas vêm de outro documento (coluna de saldo, produto travado, sem adicionar nem duplicar). */
export interface ItensDaOrigem {
  saldo: (item: ItemRow) => string;
  /** Quantidade travada no saldo (a aresta não é "em partes"). */
  quantidadeTravada: boolean;
  /** testid de cada linha (sobrepõe o `<prefixo>-linha`). */
  testIdDaLinha?: (item: ItemRow) => string;
}

/** OPERACOES-01 F3b: um local de estoque escolhido (o id e o rótulo que a tela mostra). */
export interface LocalDeEstoque { id: string; rotulo: string }

/**
 * A pesquisa de produto da linha (decisão 280): na SAÍDA, "Só com saldo neste local" vem ligado; na ENTRADA aparece
 * tudo, com o saldo. Só vale com a capacidade da pesquisa; sem ela, a pesquisa de hoje.
 */
export interface PesquisaDeProdutoDosItens {
  readonly sentido: "entrada" | "saida";
  /** Só produto que controla estoque (a Central que só aceita esses — a de estoque, F5b). Padrão `false`. */
  readonly soControlaEstoque?: boolean;
}
export const PESQUISA_DE_PRODUTO_DA_SAIDA: PesquisaDeProdutoDosItens = Object.freeze({ sentido: "saida" });
export const PESQUISA_DE_PRODUTO_DA_ENTRADA: PesquisaDeProdutoDosItens = Object.freeze({ sentido: "entrada" });

/** De onde vem a pesquisa de produto: a capacidade ainda chegando, a pesquisa nova (com o saldo) ou a de hoje. */
export type FonteDaPesquisaDeProdutos = "carregando" | "nova" | "legado";

export interface PropsDosItens {
  prefixoTestid: string;
  colunas: ColunasDosItens;
  items: ItemRow[]; onChange: (i: ItemRow[]) => void;
  layout?: LayoutDosItens | null;
  erros?: Record<string, string>;
  /** O local de estoque das linhas NOVAS (só elas o recebem; cada linha troca o seu). */
  armazemPadrao?: LocalDeEstoque | null;
  /**
   * A pesquisa de produto da linha (saída: só com saldo no local da linha; entrada: tudo, com o saldo). Ausente:
   * entrada (tudo, com o saldo quando o servidor o mostra). Só vale com a capacidade; sem ela, a pesquisa de hoje.
   */
  pesquisaDeProduto?: PesquisaDeProdutoDosItens | null;
  reservaEstoque?: { obrigatorias: readonly string[] } | null;
  /**
   * A coluna de armazém é PERMITIDA por linha (só `false` a desliga; padrão: o comportamento de hoje). Permitir não é
   * forçar: com layout, ela aparece se o layout a mostra — ou se `armazemForcado`.
   */
  armazemPorItem?: boolean;
  /**
   * Com layout, a coluna de armazém aparece mesmo que o layout a esconda (ex.: a regra da operação exige o armazém),
   * logo ANTES do Código/Produto (decisão 280: o local antes do produto). Padrão `false`: manda o layout.
   */
  armazemForcado?: boolean;
  /**
   * O custo médio do armazém preenche o valor unitário VAZIO ou "0" da linha. Padrão `true` (a venda). `false`: o
   * saldo continua sendo lido fora da vista, mas nada é escrito no unitário — o "0" digitado (ex.: bonificação) fica "0".
   */
  custoMedioNoUnitario?: boolean;
  /** Desligado por padrão. */
  lote?: LoteDosItens | null;
  /** Desligado por padrão. */
  daOrigem?: ItensDaOrigem | null;
  /**
   * OPERACOES-01 F10 (decisão 287): UMA linha só (o abastecimento) — sem Adicionar, Duplicar e Remover; a linha nasce
   * com a página. Padrão `false` (o de hoje).
   */
  linhaUnica?: boolean;
  /**
   * OPERACOES-01 F5b (decisão 282): a linha nova nasce com a quantidade e o valor unitário VAZIOS — nada inventado (a
   * contagem do ajuste nunca nasce "1"; o custo vazio da entrada é "use o custo médio"); a quantidade vazia da célula
   * não ativa aparece "—", nunca "0". Padrão `false`: a linha de hoje ("1" e "0").
   */
  linhaNovaEmBranco?: boolean;
  /** OPERACOES-01 F5b: `false` tira do rodapé o "Subtotal dos itens" (documento sem valor); "Itens (N)" fica. Padrão `true`. */
  subtotal?: boolean;
  /** OPERACOES-01 F5b: casas da quantidade na célula NÃO ativa da grade. Padrão 2 (o de hoje). */
  casasDaQuantidade?: number;
}

/* ─────────────── M8 — itens-salvos.tsx e configurar-colunas.tsx ─────────────── */

export type ChaveColunaSalva = ChaveColunaDoItem | "faturado" | "reservado";
export type ChaveCampoSalvo = Exclude<ChaveColunaSalva, "codigo"> | "unidade";
export interface AvisoDosItens { testId: string; conteudo: React.ReactNode }
/**
 * OPERACOES-01 F5b (decisão 282): uma coluna que só a ESPÉCIE conhece (ex.: o saldo na confirmação e a diferença do
 * ajuste). Entra DEPOIS de todas as outras, na grade e no formulário de leitura (campo travado). O motor não interpreta
 * o valor: só o desenha. `chave` é única entre as extras.
 */
export interface ColunaExtraDoItemSalvo {
  chave: string;
  rotulo: string;
  /** Largura na grade (padrão 100). */
  largura?: number;
  /** Alinhada à direita, como os números. */
  numero?: boolean;
  /** `data-testid` da célula da grade. */
  testId?: string;
  valor: (it: Row) => React.ReactNode;
}
/** A chave de uma coluna extra nas preferências do "Configurar colunas" — nunca colide com as do motor. */
export type ChaveDaColunaExtra = `extra:${string}`;
export interface PropsDosItensSalvos {
  prefixoTestid: string;
  colunas: ColunasDosItens;
  /** `subtotal`: o DO SERVIDOR; `null` (OPERACOES-01 F5b: documento sem valor) tira a linha do rodapé. */
  itens: Row[]; subtotal: string | null; legenda: string;
  mostrarSaldo?: boolean; mostrarReservado?: boolean;
  /** Lote e validade gravados no item (só a espécie que os grava liga). */
  mostrarLote?: boolean;
  /** Rótulo da parte já gerada no item, com `mostrarSaldo` (padrão "Faturado"; a compra diz "Recebido"). */
  rotuloDoGerado?: string;
  /** Casas decimais da quantidade, da parte gerada e do saldo (padrão 2; a compra mostra 4). */
  casasDaQuantidade?: number;
  avisos?: readonly AvisoDosItens[];
  /** OPERACOES-01 F5b: o rótulo da espécie no lugar do fixo, na grade, no formulário e no "Configurar colunas". */
  rotulos?: Partial<Record<ChaveColunaSalva, string>>;
  /** OPERACOES-01 F5b: as colunas da espécie, depois de todas as outras. Padrão: nenhuma. */
  colunasExtras?: readonly ColunaExtraDoItemSalvo[];
  /**
   * OPERACOES-01 F5b (I-1 da revisão da fase): o formulário de leitura RECORTADO pelas colunas da espécie
   * (`colunas.leitura`) — só os campos cujas colunas ela tem (a Unidade, junto da quantidade, fica), e nada que ela não
   * tenha (o documento de estoque não mostra desconto, desconto % nem total, nem um Local de estoque por item: o local
   * é do cabeçalho). Padrão `false`: a lista fixa de hoje (as Centrais de Vendas e de Compras não mudam).
   */
  formularioPelasColunas?: boolean;
}
export interface PropsDeConfigurarColunas<K extends string> {
  prefixoTestid: string;
  titulo: string; subtitulo: string; rotulos: Record<K, string>; lista: readonly Preferencia<K>[];
  onLista: (l: Preferencia<K>[]) => void; onRestaurar: () => void; ambos: boolean; onAmbos: () => void;
}

/* ─────────────── M9 — painel.tsx (+ painel.module.css) ─────────────── */

export interface PropsDoPainelRepartido { lado?: React.ReactNode; children: React.ReactNode }
export interface PropsDoPainelSimples { children: React.ReactNode }
export interface PropsDoPlano { plano: Plan; onChange: (p: Plan) => void }
export interface PropsDosTitulos { titulos: Row[]; legenda: string; linkDoTitulo: (titulo: Row) => string }
export interface PropsDosDerivados { derivados: Row[]; legenda: string; linkDoDerivado: (derivado: Row) => string }
export interface PropsDoPlanoEmLeitura { plano: unknown }

/* ─────────────── M10 — dialogos.tsx (+ dialogos.module.css) ─────────────── */

export interface PropsDoDialogoConfirmar {
  aberto: boolean; onFechar: () => void;
  /** Rótulo da ação ("Confirmar <espécie>"): título `${rotulo} ${codigo}?` e botão. */
  rotulo: string;
  codigo: string; carregando: boolean; confirmarDesabilitado: boolean; onConfirmar: () => void; children: React.ReactNode;
}
export interface PropsDoDialogoCancelar {
  prefixoTestid: string;
  aberto: boolean; onFechar: () => void;
  especie: string; codigo: string; texto: string; carregando: boolean;
  /** O motivo aparado (1–500) ou, vazio, `motivoVazio`. */
  motivoVazio: string;
  onCancelar: (motivo: string) => void;
}
export interface PropsDoDialogoDescartar { aberto: boolean; onFechar: () => void; onDescartar: () => void }

/* ─────────────── M11 — pesquisa.tsx, duplicar-memoria.ts, salvo.ts ─────────────── */

export interface OpcaoReal { id: string; label: string; code?: string | null }
/** Uma opção da pesquisa com o saldo do local (só na fonte nova; ausente na de hoje). */
export interface OpcaoDaPesquisa extends OpcaoReal { estoque?: string | null }
/** O que a pesquisa de PRODUTO sabe (a de local não o recebe): a fonte, o local da LINHA e o sentido. */
export interface ProdutoNaPesquisa {
  fonte: FonteDaPesquisaDeProdutos;
  /** O local da LINHA (o que vai no POST), nunca o do cabeçalho; sem ele, sem saldo e sem o filtro. */
  armazemId?: string;
  sentido: "entrada" | "saida";
  soControlaEstoque?: boolean;
}
export interface PropsDaPesquisa {
  recurso: string; rotulo: string; filtro?: Record<string, string>; valor?: string | null;
  modo: "flutuante" | "fluxo"; ancora?: HTMLElement | null;
  onEscolher: (o: OpcaoReal) => void; onFechar: () => void; testId?: string;
  /** OPERACOES-01 F3b: só a pesquisa de PRODUTO o recebe. Ausente (ou fonte "legado"): a pesquisa de hoje, idêntica. */
  produto?: ProdutoNaPesquisa | null;
}

/* ─────────────── OPERACOES-01 F3b — local-padrao.tsx: o "Local de estoque" do cabeçalho ─────────────── */

/** O campo do cabeçalho: os locais da empresa do documento. Estado da TELA: nunca vai no corpo. */
export interface PropsDoLocalPadrao {
  prefixoTestid: string;
  empresaId: string;
  valor: LocalDeEstoque | null;
  onChange: (l: LocalDeEstoque | null) => void;
}
/** `useLocalDoCabecalho`: o local das linhas novas, a escolha (por empresa) e o descarte (volta ao padrão). */
export interface LocalDoCabecalho {
  local: LocalDeEstoque | null;
  escolher: (l: LocalDeEstoque | null) => void;
  descartar: () => void;
}
/** duplicar-memoria.ts: a cópia genérica que espera a criação, guardada no Map em memória pela chave do adaptador. */
export interface CopiaEmMemoria<C> {
  segmento: string; tipoOperacaoId: string; cabecalho: C; itens: ItemRow[]; plano: Plan | null;
}
/** Assinaturas esperadas de duplicar-memoria.ts. */
export type CopiaValePara = <C>(copia: CopiaEmMemoria<C> | null, segmento: string, tipoOperacaoId: string) => copia is CopiaEmMemoria<C>;
/** salvo.ts: entrega/consumo do "Salvo" pela chave do adaptador. */
export type EntregarSalvo = (chave: (id: string) => string, id: string, depois: DepoisDeSalvar) => void;
export type ConsumirSalvo = (chave: (id: string) => string, id: string) => DepoisDeSalvar | null;

/* ─────────────── F2 (decisão 279) — o Salvar da Central e as regras gerais da TOP ─────────────── */

/**
 * O resultado da confirmação automática (TOP no formato 4 com Confirmação Automática), como o servidor o devolve no
 * 201 do POST que grava o documento, no `/convert` do pedido de compra e no 200 da decisão de aprovar. Sem a chave: a
 * TOP não confirma sozinha (formato 1 a 3, ou Manual) — o corpo de antes.
 */
export type ResultadoConfirmacaoAutomatica =
  | { confirmado: true }
  | { confirmado: false; motivo: "aguardando_aprovacao" }
  | { confirmado: false; motivo: "sem_permissao" }
  | { confirmado: false; motivo: "recusada"; erro: { code: string; message: string; details?: unknown } };

/** O 201 do Salvar: o id do documento gravado e, só com a TOP de Confirmação Automática, o que a confirmação fez. */
export interface RespostaDoSalvar { id: string; confirmacaoAutomatica?: ResultadoConfirmacaoAutomatica }

/** O tom do aviso do Salvar — o nome da função do `toast` que o mostra. */
export type TipoDoAviso = "success" | "info" | "warning";
/** O aviso do Salvar: UM por Salvar, com o tom e o texto exato. */
export interface AvisoDoSalvar { tipo: TipoDoAviso; texto: string }

/**
 * As regras gerais da TOP que a Central precisa ANTES de salvar (`regrasGerais` de `/regras-da-operacao`): se o Salvar
 * também confirma e se o documento pode ser salvo sem itens. Quem decide o valor é o servidor, pela MESMA régua da
 * gravação; a Central só lê.
 */
export interface RegrasGeraisDaCentral { confirmacaoAutomatica: boolean; aceitaSemItens: boolean }
