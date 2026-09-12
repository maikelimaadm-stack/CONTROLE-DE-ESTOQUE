/**
 * Glossário de copy do ERP (docs/UI-STANDARD.md, "Idioma e terminologia") — só os termos com alto risco de
 * divergência. Rótulos de enums vêm de `@agro/domain` (`enumLabel`), nunca do valor técnico.
 *
 * A partir de PRE-BASE2-01 estes textos NÃO são mais literais aqui: são derivados do catálogo pt-BR de
 * `@agro/platform` (docs/I18N-CONTRACT.md), que é a fonte única de tradução. `COPY` continua existindo com a
 * mesma forma para não exigir mudança de tela; código novo deve preferir `t("acoes.salvar")` (lib/i18n.ts).
 */
export { ENUM_LABELS, enumLabel, enumOptions, hasEnumLabel, NOT_INFORMED, UNKNOWN_VALUE, type EnumDomain } from "@agro/domain";
import { enumLabel } from "@agro/domain";
import { ptBR } from "@agro/platform";

const m = ptBR.messages;

export const COPY = {
  situacao: m["termos.situacao"]!,
  painel: m["termos.painel"]!,
  informacoes: m["termos.informacoes"]!,
  aviso: m["termos.aviso"]!,
  erro: m["termos.erro"]!,
  sucesso: m["termos.sucesso"]!,
  maisOpcoes: m["acoes.mais_opcoes"]!,
  nenhumRegistro: m["mensagens.nenhum_registro"]!,
  nenhumItem: m["mensagens.nenhum_item"]!,
  carregando: m["mensagens.carregando"]!,
  pesquisar: m["acoes.pesquisar"]!,
  buscar: m["acoes.buscar"]!,
  excluir: m["acoes.excluir"]!,
  remover: m["acoes.remover"]!,
  fechar: m["acoes.fechar"]!,
  cancelar: m["acoes.cancelar"]!,
  salvar: m["acoes.salvar"]!,
  confirmar: m["acoes.confirmar"]!,
  voltar: m["acoes.voltar"]!,
  ok: m["acoes.ok"]!,
  naoInformado: m["termos.nao_informado"]!,
  desconhecido: m["termos.desconhecido"]!,
  camposObrigatorios: m["mensagens.campos_obrigatorios"]!,
  alteracoesNaoSalvas: m["mensagens.alteracoes_nao_salvas"]!,
  fecharAviso: m["mensagens.fechar_aviso"]!,
  tentarNovamente: m["acoes.tentar_novamente"]!,
  erroGenerico: m["mensagens.erro_generico"]!
} as const;

/** Situação genérica de documentos/registros (ver `ENUM_LABELS.status`). */
export const statusLabel = (value: unknown) => enumLabel("status", value);
