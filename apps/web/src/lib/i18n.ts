"use client";
/**
 * Ligação da interface com a INFRAESTRUTURA DE IDIOMA (`@agro/platform`, docs/I18N-CONTRACT.md).
 *
 * Uma única fonte de texto pt-BR: o catálogo. `COPY` (lib/copy.ts) é derivado daqui, e código novo usa
 * `t("acoes.salvar")` em vez de literal espalhado. A formatação de data/número/moeda sai de `useFormatter`,
 * nunca de `toFixed`/Intl solto na tela.
 *
 * O idioma efetivo vem do servidor (`/api/auth/context` → `language.effective`), que aplica a precedência
 * usuário › organização › padrão. Enquanto só pt-BR está publicado, o resultado é sempre pt-BR — a troca de
 * idioma passa a funcionar sem tocar em tela alguma, bastando publicar um catálogo novo.
 */
import { useMemo } from "react";
import { createFormatter, createTranslator, ptBR, resolveLocale, type LocaleFormatter, type MessageParams, type SupportedLocale } from "@agro/platform";
import { useAuth } from "./auth";

/** Catálogo de referência (pt-BR) e tradutor padrão — utilizável fora de componentes. */
export const catalog = ptBR;
export const t = createTranslator(ptBR);

/** Idioma efetivo da sessão; cai no padrão enquanto o contexto não carregou. */
export function useLocale(): SupportedLocale {
  const { ctx } = useAuth();
  return resolveLocale({ user: ctx?.language?.user ?? null, organization: ctx?.language?.organization ?? null });
}

/** Tradutor do idioma da sessão. Assinatura estável: `tr("chave", { parametro })`. */
export function useTranslator(): (key: string, params?: MessageParams) => string {
  const locale = useLocale();
  return useMemo(() => (locale === ptBR.locale ? t : createTranslator(ptBR)), [locale]);
}

/** Formatadores (data, hora, número, moeda, percentual) já amarrados ao idioma da sessão. */
export function useFormatter(): LocaleFormatter {
  const locale = useLocale();
  return useMemo(() => createFormatter({ locale }), [locale]);
}
