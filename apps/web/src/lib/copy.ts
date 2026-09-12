/**
 * Glossário de copy do ERP (docs/UI-STANDARD.md, "Idioma e terminologia") — só os termos com alto risco de divergência.
 * Rótulos de enums vêm de `@agro/domain` (`enumLabel`), nunca do valor técnico.
 */
export { ENUM_LABELS, enumLabel, enumOptions, hasEnumLabel, NOT_INFORMED, UNKNOWN_VALUE, type EnumDomain } from "@agro/domain";
import { enumLabel } from "@agro/domain";

export const COPY = {
  situacao: "Situação",
  painel: "Painel",
  informacoes: "Informações",
  aviso: "Aviso",
  erro: "Erro",
  sucesso: "Sucesso",
  maisOpcoes: "Mais opções",
  nenhumRegistro: "Nenhum registro encontrado.",
  nenhumItem: "Nenhum item",
  carregando: "Carregando…",
  pesquisar: "Pesquisar",
  buscar: "Buscar",
  excluir: "Excluir",
  remover: "Remover",
  fechar: "Fechar",
  cancelar: "Cancelar",
  salvar: "Salvar",
  confirmar: "Confirmar",
  voltar: "Voltar",
  ok: "OK",
  naoInformado: "Não informado",
  desconhecido: "Desconhecido",
  camposObrigatorios: "Existem campos obrigatórios que precisam ser preenchidos.",
  alteracoesNaoSalvas: "Existem alterações não salvas.",
  fecharAviso: "Fechar aviso",
  tentarNovamente: "Tentar novamente",
  erroGenerico: "Não foi possível concluir. Tente novamente."
} as const;

/** Situação genérica de documentos/registros (ver `ENUM_LABELS.status`). */
export const statusLabel = (value: unknown) => enumLabel("status", value);
