"use client";
import * as React from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { CampoDoCatalogo, CampoDoLayout, ColunaDoLayout, EstruturaLayout, ZonaDoLayout } from "@agro/domain";

/**
 * CONFIGURADOR VISUAL DO LAYOUT DO DOCUMENTO (VENDAS-A3-1c, decisão 261) — CONTRATO entre as peças da página.
 *
 * A página (`pagina.tsx`) guarda o RASCUNHO (`useRascunho`) e entrega às peças o `ConfiguradorCtx`. Toda mudança de
 * estrutura passa por uma OPERAÇÃO pura de `operacoes.ts` (arrastar e os botões sem mouse usam as MESMAS): a regra de
 * zona tem um dono só (`motivoZonaProibida` do domínio), e o obrigatório do sistema nunca sai do layout.
 */

/** Resultado de uma operação: a estrutura nova, ou o motivo da recusa (mostrado na tela; nada muda). */
export type ResultadoOperacao = { ok: true; estrutura: EstruturaLayout } | { ok: false; motivo: string };

/** Registro padrão conhecido (A3-1b): id → rótulo. */
export interface RegistroConhecido { id: string; rotulo: string }

export interface ConfiguradorCtx {
  familia: string;
  /** o rascunho atual (VENDAS-A3-1d: sem passo "Editar" — quem pode editar já trabalha no rascunho) */
  estrutura: EstruturaLayout;
  /** VENDAS-A3-1d: = `podeEditar` (mantido com este nome para as peças da A3-1c: arrastar, ações, zonas) */
  editando: boolean;
  /** VENDAS-A3-1d: `can("tipos_operacao.edit")` e movimento com layout — `can` só apresenta; quem nega é a rota */
  podeEditar: boolean;
  /** VENDAS-A3-1d: mostra um aviso na área (ex.: TEXTOS.somenteLeitura ao clicar num campo sem permissão) */
  avisar: (mensagem: string) => void;
  /** chave do campo selecionado (documento: a chave; coluna: "itens.<chave>") */
  selecionado: string | null;
  selecionar: (chave: string | null) => void;
  /** aplica o resultado de uma operação ao rascunho (entra no histórico de desfazer); recusa → aviso na tela */
  aplicar: (r: ResultadoOperacao) => void;
  /** chave sendo arrastada (HTML5) — para as zonas mostrarem se aceitam */
  arrastando: string | null;
  setArrastando: (chave: string | null) => void;
  /** aba do rodapé mostrada na prévia */
  abaAtiva: number;
  setAbaAtiva: (i: number) => void;
  /** abre "Configurar campo" */
  configurar: (chave: string) => void;
  /** A3-1b: do GET admin — rótulo do registro padrão que vale; chaves dos que morreram */
  padroesDeCadastro: ReadonlyMap<string, RegistroConhecido>;
  padroesInvalidos: ReadonlySet<string>;
  /** catálogo da família (dono: domínio) */
  catalogo: readonly CampoDoCatalogo[];
}

export const ConfiguradorContexto = React.createContext<ConfiguradorCtx | null>(null);
export function useConfigurador(): ConfiguradorCtx {
  const c = React.useContext(ConfiguradorContexto);
  if (!c) throw new Error("useConfigurador fora da página do configurador");
  return c;
}

/** Chave de seleção/arraste: documento = a chave; coluna de item = "itens.<chave>" (mesma de chavePadraoDeCadastro). */
export const chaveDeColuna = (campo: string) => `itens.${campo}`;
export const ehChaveDeColuna = (k: string) => k.startsWith("itens.");
export const campoDaChave = (k: string) => (ehChaveDeColuna(k) ? k.slice("itens.".length) : k);

/** Tipo MIME do arraste (HTML5), como no configurador dos cadastros ("text/field"). */
export const MIME_ARRASTE = "text/layout-campo";

export type { CampoDoLayout, ColunaDoLayout, EstruturaLayout, ZonaDoLayout };

/* ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * VENDAS-A3-1d (decisão 262) — TELA ÚNICA como a do ERP de referência: a grade de layouts em cima e, ao selecionar
 * uma linha, a área de configuração logo abaixo. Só web: as rotas são as de hoje.
 * ══════════════════════════════════════════════════════════════════════════════════════════════════════════════ */

export const BASE_LAYOUTS = "/api/admin/layouts-documento";
/** Raiz das chaves de cache dos layouts (lista, detalhe, tops de outro layout). */
export const CHAVE_LAYOUTS = ["layouts-documento"] as const;
/** Detalhe (GET admin /:id) — a MESMA chave em toda peça (área, status, TOPs), para uma consulta só. */
export const chaveDetalhe = (id: string) => [...CHAVE_LAYOUTS, id, "detalhe"] as const;
/** Lista (GET admin ?familia=) — `familia` vazio = todos os movimentos. */
export const chaveLista = (familia: string) => [...CHAVE_LAYOUTS, "lista", familia] as const;

/**
 * O CACHE DA CENTRAL CAI EM TODA GRAVAÇÃO DE LAYOUT (2.7 e). A Central guarda ["layout-efetivo", kind, topId] por 15 s
 * (staleTime do QueryClient): sem isto, salvar e abrir a Central em seguida mostrava o layout anterior. Um helper só,
 * chamado em TODA gravação: salvar, TOPs, padrão, ativar/inativar, excluir, duplicar, importar, criar.
 */
export function invalidarLayouts(qc: QueryClient): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: CHAVE_LAYOUTS }),
    qc.invalidateQueries({ queryKey: ["layout-efetivo"] })
  ]).then(() => undefined);
}

/** Linha da grade (GET admin da lista). Leitura tolerante: `is_active`/`ativo`, `qtdTops`. */
export interface LayoutLinha extends Record<string, unknown> {
  id: string; code: string; nome: string; familia: string; padrao: boolean; ativo: boolean; qtdTops: number;
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
export function lerLinhaLayout(v: unknown): LayoutLinha {
  const o = obj(v);
  return {
    id: str(o.id), code: str(o.code ?? o.codigo), nome: str(o.nome), familia: str(o.familia),
    padrao: Boolean(o.padrao), ativo: Boolean(o.ativo ?? o.isActive ?? o.is_active),
    qtdTops: Number(o.qtdTops ?? o.topsLigadas ?? (Array.isArray(o.tops) ? o.tops.length : 0)) || 0
  };
}

/** Coluna "Em uso" da grade (2.1). Inativo não é usado por ninguém. */
export function usoDaLinha(l: Pick<LayoutLinha, "padrao" | "ativo" | "qtdTops">): { emUso: boolean; texto: string } {
  if (!l.ativo) return { emUso: false, texto: TEXTOS.naoEstaEmUso };
  const partes = [l.padrao ? "Padrão do movimento" : "", l.qtdTops > 0 ? `${l.qtdTops} TOP(s)` : ""].filter(Boolean);
  return partes.length ? { emUso: true, texto: partes.join(" · ") } : { emUso: false, texto: TEXTOS.naoEstaEmUso };
}

/** Textos de tela da A3-1d — um dono só (os E2E conferem estes textos). */
export const TEXTOS = {
  naoEstaEmUso: "Não está em uso",
  naoUsado: "Este layout NÃO está em uso: a Central continua usando outro. Ligue a uma TOP ou use como padrão do movimento.",
  emUsoTops: (lista: string) => `Em uso nas TOPs: ${lista}`,
  emUsoPadrao: (movimento: string) => `Em uso como padrão do movimento ${movimento}: vale para as TOPs desse movimento que não têm layout ligado.`,
  inativo: "Inativo: não é usado por nenhuma TOP.",
  somenteLeitura: "Somente leitura: você não tem permissão para alterar layouts.",
  descartarRascunho: "Há alterações não salvas neste layout. Descartar?",
  descartarCampo: "Descartar as alterações deste campo?",
  descartarTops: "Descartar as mudanças nas TOPs?",
  topsPendente: "A TOP selecionada ainda não está ligada: clique em Mover → (ou dê duplo clique) e depois em Salvar.",
  novoNaoUsado: "Sem padrão e sem TOP, o layout não estará em uso: a Central continua usando outro.",
  versaoNova: "Saiu uma versão nova do sistema. Atualize a página para usar a versão nova.",
  visualizarTops: "Visualizar TOPs",
  usarComoPadrao: "Usar como padrão do movimento",
  abrirNaCentral: "Abrir na Central"
} as const;

/** "1 · Orçamento" — como a TOP aparece no status de uso. */
export const rotuloDaTop = (t: { codigo: string; nome: string }) => (t.codigo ? `${t.codigo} · ${t.nome}` : t.nome);

/**
 * TESTIDS DA A3-1d (contrato com os E2E — não renomeie; os da A3-1c acima continuam valendo onde a peça ficou):
 *  tela ................. layouts-documento (container da grade, como antes), layouts-tela (a tela única)
 *  grade ................ layout-linha-<id> (célula do código, clicável: SELECIONA; data-selecionado="true"|"false",
 *                         data-ativo, data-padrao), layout-em-uso-<id> (coluna "Em uso"; data-em-uso="true"|"false")
 *  barra da grade ....... layouts-barra, layouts-novo, layouts-duplicar, layouts-excluir, layouts-ativar (Ativar/Inativar),
 *                         layouts-padrao ("Usar como padrão do movimento"), layouts-visualizar-tops, layouts-exportar,
 *                         layouts-importar, layouts-importar-arquivo, layouts-importar-resultado/-sucesso/-erro/-removido
 *  área ................. config-layout-pagina (a área do layout selecionado), config-nome (input), config-movimento,
 *                         config-codigo, config-padrao-selo, config-somente-leitura, config-aviso, layout-erros, layout-salvo
 *  ferramentas .......... config-salvar, config-cancelar, config-desfazer, config-refazer, config-configurar-selecionado,
 *                         config-restaurar  (NÃO existe mais config-editar)
 *  rascunho sujo ........ config-descartar-dialogo, config-descartar, config-descartar-voltar
 *  status de uso ........ config-status (data-estado="tops"|"padrao"|"nao-usado"|"inativo"), config-status-nao-usado
 *                         (faixa amarela), config-status-visualizar-tops, config-status-usar-padrao, config-status-ativar,
 *                         config-abrir-central (um por TOP; data-top-id), config-salvo-nao-usado (aviso ao salvar)
 *  visualizar TOPs ...... config-tops-dialogo + os da A3-1c (config-tops, config-tops-disponiveis, config-tops-ligadas,
 *                         config-top-<id>, config-tops-mover, config-tops-remover, config-tops-salvar, config-tops-salvo,
 *                         config-tops-aviso) + config-tops-pendente, config-tops-fechar, config-tops-descartar,
 *                         config-tops-descartar-voltar
 *  configurar campo ..... layout-configurar-campo, layout-cfg-*, layout-configurar-aplicar, layout-cfg-fechar,
 *                         layout-cfg-descartar, layout-cfg-voltar
 *  assistente Novo ...... layout-novo (diálogo), layout-novo-passo-1|2|3, layout-novo-familia, layout-novo-nome,
 *                         layout-novo-origem, layout-novo-padrao, layout-novo-tops-disponiveis, layout-novo-tops-ligadas,
 *                         layout-novo-top-<id>, layout-novo-tops-mover, layout-novo-tops-remover, layout-novo-aviso-nao-usado,
 *                         layout-novo-avancar, layout-novo-voltar, layout-novo-criar
 *  Central .............. central-layout-efetivo (data-origem="ligado"|"padrao_da_familia"|"sistema", data-layout-id),
 *                         central-layout-configurar
 *  versão nova .......... versao-nova, versao-nova-atualizar
 */

/**
 * TESTIDS (contrato com os E2E — não renomeie):
 *  página ............... config-layout-pagina · cabeçalho: config-nome, config-movimento, config-codigo, config-padrao-selo, config-voltar
 *  barra ................ config-editar, config-salvar, config-cancelar, config-desfazer, config-refazer, config-restaurar, config-exportar
 *  aviso ................ config-aviso (recusa de operação: motivo)
 *  (A) disponíveis ...... config-disponiveis, config-busca, config-so-obrigatorios, config-disponivel-<chave> (coluna: config-disponivel-itens.<campo>),
 *                         config-disponiveis-vazio ("Todos os campos já estão no layout."), config-incluir-em (menu "Incluir em…")
 *  (C) prévia ........... config-zona-principal, config-zona-adicionais, config-zona-itens, config-zona-aba-<i>,
 *                         config-operacao-fixa (linha "Operação"), config-aba-<i> (tab do rodapé), config-aba-nova ("+ Aba"),
 *                         config-aba-nome-<i> (input de renomear), config-aba-remover-<i>, config-aba-esquerda-<i>, config-aba-direita-<i>
 *  campo na prévia ...... config-campo-<chave> (coluna: config-campo-itens.<campo>); data-selecionado="true"; marcas:
 *                         config-marca-obrigatorio ("*"), config-marca-travado (cadeado), config-marca-padrao, config-marca-padrao-invalido
 *  ações do selecionado . config-acoes, config-acao-subir, config-acao-descer, config-acao-mover ("Mover para…" select),
 *                         config-acao-configurar, config-acao-remover
 *  configurar campo ..... o diálogo de hoje (layout-configurar-campo, layout-cfg-*) + layout-cfg-restaurar-nome
 *  novo layout .......... layout-novo (diálogo), layout-novo-familia (select "Movimento"), layout-novo-nome, layout-novo-origem
 *                         (select "Começar de": "sistema" | <id>), layout-novo-padrao (caixa), layout-novo-criar
 *  TOPs ................. config-tops, config-tops-disponiveis (lista), config-tops-ligadas (lista), config-top-<id> (item),
 *                         config-tops-mover, config-tops-remover, config-tops-salvar, config-tops-salvo, config-tops-aviso
 */
