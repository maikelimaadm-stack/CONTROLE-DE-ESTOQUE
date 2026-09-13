"use client";
/**
 * Ligação da interface com a INFRAESTRUTURA DE IDIOMA (`@erp/plataforma`, docs/I18N-CONTRACT.md).
 *
 * Uma única fonte de texto pt-BR: o catálogo. `COPY` (lib/copy.ts) é derivado daqui, e código novo usa
 * `t("acoes.salvar")` em vez de literal espalhado. A formatação de data/número/moeda sai de `useFormatador`,
 * nunca de conversão manual na tela.
 *
 * O idioma efetivo vem do servidor (`/api/auth/context` → `idioma.efetivo`), que aplica a precedência
 * usuário › organização › padrão. Enquanto só pt-BR está publicado o resultado é sempre pt-BR — a troca de
 * idioma passa a funcionar sem tocar em tela alguma, bastando publicar um catálogo novo.
 */
import { useMemo } from "react";
import { criarFormatador, criarTradutor, ptBR, resolverIdioma, type Formatador, type IdiomaPublicado, type ParametrosMensagem } from "@erp/plataforma";
import { useAuth } from "./auth";

/** Catálogo de referência (pt-BR) e tradutor padrão — utilizável fora de componentes. */
export const catalogo = ptBR;
export const t = criarTradutor(ptBR);

/** Idioma efetivo da sessão; cai no padrão enquanto o contexto não carregou. */
export function useIdioma(): IdiomaPublicado {
  const { ctx } = useAuth();
  return resolverIdioma({ usuario: ctx?.idioma?.usuario ?? null, organizacao: ctx?.idioma?.organizacao ?? null });
}

/** Tradutor do idioma da sessão. Assinatura estável: `tr("chave", { parametro })`. */
export function useTradutor(): (chave: string, parametros?: ParametrosMensagem) => string {
  const idioma = useIdioma();
  return useMemo(() => (idioma === ptBR.idioma ? t : criarTradutor(ptBR)), [idioma]);
}

/** Formatadores (data, hora, número, moeda, percentual) já amarrados ao idioma da sessão. */
export function useFormatador(): Formatador {
  const idioma = useIdioma();
  return useMemo(() => criarFormatador({ idioma }), [idioma]);
}
