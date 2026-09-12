import { describe, it, expect } from "vitest";
import {
  IDIOMA_PADRAO, IDIOMAS_PUBLICADOS, criarTradutor, chaveDeEnum, interpolar, ehChaveDeMensagem,
  idiomaPublicado, negociarIdioma, chavesFaltantes, resolverIdioma, traduzir, validarCatalogo, type Catalogo
} from "../src/idioma.js";
import { ptBR } from "../src/idiomas/pt-BR.js";

describe("catálogo pt-BR", () => {
  it("é o idioma inicial obrigatório e está publicado", () => {
    expect(IDIOMA_PADRAO).toBe("pt-BR");
    expect(IDIOMAS_PUBLICADOS).toContain("pt-BR");
    expect(idiomaPublicado("pt-BR")).toBe(true);
    expect(idiomaPublicado("en-US")).toBe(false);
  });
  it("não tem chave fora do padrão canônico nem tradução vazia", () => {
    expect(validarCatalogo(ptBR)).toEqual([]);
  });
  it("cobre a terminologia oficial sem cair no valor técnico", () => {
    expect(ptBR.mensagens["termos.situacao"]).toBe("Situação");
    expect(ptBR.mensagens["termos.painel"]).toBe("Painel");
    expect(ptBR.mensagens["termos.empresa"]).toBe("Empresa");
  });
});

describe("chave canônica × tradução", () => {
  it("reconhece chaves canônicas e recusa texto livre", () => {
    expect(ehChaveDeMensagem("acoes.salvar")).toBe(true);
    expect(ehChaveDeMensagem("empresa.sem_acesso")).toBe(true);
    expect(ehChaveDeMensagem("Salvar")).toBe(false);
    expect(ehChaveDeMensagem("acoes")).toBe(false);
    expect(ehChaveDeMensagem("Acoes.Salvar")).toBe(false);
  });
  it("valor de domínio vira chave de tradução sem mudar o valor persistido", () => {
    expect(chaveDeEnum("status", "pending")).toBe("enums.status.pending");
  });
});

describe("tradução e fallback", () => {
  const en: Catalogo = { idioma: "pt-BR", mensagens: { "acoes.salvar": "Save" } };
  it("traduz pelo catálogo do idioma", () => {
    expect(traduzir("acoes.salvar", {}, { catalogo: en })).toBe("Save");
  });
  it("cai no catálogo de fallback quando a chave falta", () => {
    expect(traduzir("acoes.cancelar", {}, { catalogo: en, reserva: ptBR })).toBe("Cancelar");
  });
  it("chave inexistente devolve a própria chave (visível em revisão, nunca texto vazio)", () => {
    expect(traduzir("nao.existe", {}, { catalogo: ptBR })).toBe("nao.existe");
    expect(traduzir("nao.existe", {}, { catalogo: ptBR, ausente: "—" })).toBe("—");
  });
  it("interpola parâmetros e mantém literal o que faltar", () => {
    expect(interpolar("Empresa {nome} (#{id})", { nome: "Matriz", id: 7 })).toBe("Empresa Matriz (#7)");
    expect(interpolar("Olá {nome}", {})).toBe("Olá {nome}");
  });
  it("tradutor pronto carrega o idioma e o fallback", () => {
    const t = criarTradutor(en, ptBR);
    expect(t.idioma).toBe("pt-BR");
    expect(t("acoes.salvar")).toBe("Save");
    expect(t("acoes.fechar")).toBe("Fechar");
  });
});

describe("precedência de idioma", () => {
  it("usuário › organização › padrão do sistema", () => {
    expect(resolverIdioma({ usuario: "pt-BR", organizacao: "pt-BR" })).toBe("pt-BR");
    expect(resolverIdioma({ usuario: null, organizacao: "pt-BR" })).toBe("pt-BR");
    expect(resolverIdioma({})).toBe("pt-BR");
  });
  it("idioma sem catálogo publicado cai no padrão em vez de quebrar a tela", () => {
    expect(resolverIdioma({ usuario: "ja-JP" })).toBe("pt-BR");
  });
  it("idioma sem região casa com a região publicada", () => {
    expect(negociarIdioma("pt")).toBe("pt-BR");
    expect(negociarIdioma("PT-br")).toBe("pt-BR");
    expect(negociarIdioma("es")).toBeNull();
    expect(negociarIdioma("es", ["es-ES", "pt-BR"])).toBe("es-ES");
  });
});

describe("completude entre idiomas", () => {
  it("aponta exatamente as chaves que faltam em um idioma novo", () => {
    const parcial: Catalogo = { idioma: "pt-BR", mensagens: { "acoes.salvar": "Guardar" } };
    const missing = chavesFaltantes(parcial, ptBR);
    expect(missing).not.toContain("acoes.salvar");
    expect(missing).toContain("acoes.cancelar");
    expect(missing.length).toBe(Object.keys(ptBR.mensagens).length - 1);
  });
});
