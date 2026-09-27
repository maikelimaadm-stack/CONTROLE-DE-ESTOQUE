"use client";
import * as React from "react";
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
  /** o rascunho atual (em edição) ou o gravado (fora de edição) */
  estrutura: EstruturaLayout;
  editando: boolean;
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
