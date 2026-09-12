import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCALE, SUPPORTED_LOCALES, createTranslator, enumMessageKey, interpolate, isMessageKey,
  isSupportedLocale, matchLocale, missingMessageKeys, resolveLocale, translate, validateCatalog, type Catalog
} from "../src/i18n.js";
import { ptBR } from "../src/locales/pt-BR.js";

describe("catálogo pt-BR", () => {
  it("é o idioma inicial obrigatório e está publicado", () => {
    expect(DEFAULT_LOCALE).toBe("pt-BR");
    expect(SUPPORTED_LOCALES).toContain("pt-BR");
    expect(isSupportedLocale("pt-BR")).toBe(true);
    expect(isSupportedLocale("en-US")).toBe(false);
  });
  it("não tem chave fora do padrão canônico nem tradução vazia", () => {
    expect(validateCatalog(ptBR)).toEqual([]);
  });
  it("cobre a terminologia oficial sem cair no valor técnico", () => {
    expect(ptBR.messages["termos.situacao"]).toBe("Situação");
    expect(ptBR.messages["termos.painel"]).toBe("Painel");
    expect(ptBR.messages["termos.empresa"]).toBe("Empresa");
  });
});

describe("chave canônica × tradução", () => {
  it("reconhece chaves canônicas e recusa texto livre", () => {
    expect(isMessageKey("acoes.salvar")).toBe(true);
    expect(isMessageKey("empresa.sem_acesso")).toBe(true);
    expect(isMessageKey("Salvar")).toBe(false);
    expect(isMessageKey("acoes")).toBe(false);
    expect(isMessageKey("Acoes.Salvar")).toBe(false);
  });
  it("valor de domínio vira chave de tradução sem mudar o valor persistido", () => {
    expect(enumMessageKey("status", "pending")).toBe("enums.status.pending");
  });
});

describe("tradução e fallback", () => {
  const en: Catalog = { locale: "pt-BR", messages: { "acoes.salvar": "Save" } };
  it("traduz pelo catálogo do idioma", () => {
    expect(translate("acoes.salvar", {}, { catalog: en })).toBe("Save");
  });
  it("cai no catálogo de fallback quando a chave falta", () => {
    expect(translate("acoes.cancelar", {}, { catalog: en, fallback: ptBR })).toBe("Cancelar");
  });
  it("chave inexistente devolve a própria chave (visível em revisão, nunca texto vazio)", () => {
    expect(translate("nao.existe", {}, { catalog: ptBR })).toBe("nao.existe");
    expect(translate("nao.existe", {}, { catalog: ptBR, missing: "—" })).toBe("—");
  });
  it("interpola parâmetros e mantém literal o que faltar", () => {
    expect(interpolate("Empresa {nome} (#{id})", { nome: "Matriz", id: 7 })).toBe("Empresa Matriz (#7)");
    expect(interpolate("Olá {nome}", {})).toBe("Olá {nome}");
  });
  it("tradutor pronto carrega o idioma e o fallback", () => {
    const t = createTranslator(en, ptBR);
    expect(t.locale).toBe("pt-BR");
    expect(t("acoes.salvar")).toBe("Save");
    expect(t("acoes.fechar")).toBe("Fechar");
  });
});

describe("precedência de idioma", () => {
  it("usuário › organização › padrão do sistema", () => {
    expect(resolveLocale({ user: "pt-BR", organization: "pt-BR" })).toBe("pt-BR");
    expect(resolveLocale({ user: null, organization: "pt-BR" })).toBe("pt-BR");
    expect(resolveLocale({})).toBe("pt-BR");
  });
  it("idioma sem catálogo publicado cai no padrão em vez de quebrar a tela", () => {
    expect(resolveLocale({ user: "ja-JP" })).toBe("pt-BR");
  });
  it("idioma sem região casa com a região publicada", () => {
    expect(matchLocale("pt")).toBe("pt-BR");
    expect(matchLocale("PT-br")).toBe("pt-BR");
    expect(matchLocale("es")).toBeNull();
    expect(matchLocale("es", ["es-ES", "pt-BR"])).toBe("es-ES");
  });
});

describe("completude entre idiomas", () => {
  it("aponta exatamente as chaves que faltam em um idioma novo", () => {
    const parcial: Catalog = { locale: "pt-BR", messages: { "acoes.salvar": "Guardar" } };
    const missing = missingMessageKeys(parcial, ptBR);
    expect(missing).not.toContain("acoes.salvar");
    expect(missing).toContain("acoes.cancelar");
    expect(missing.length).toBe(Object.keys(ptBR.messages).length - 1);
  });
});
