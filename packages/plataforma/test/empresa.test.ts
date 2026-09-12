import { describe, it, expect } from "vitest";
import {
  TODAS_EMPRESAS, TODAS_AS_EMPRESAS, empresasSelecionadas, exigirEmpresaVisivel, exigirEmpresaPersistivel,
  descreverEscopoEmpresa, empresaAutorizada, resolverEscopoEmpresa, selecionarEmpresaDoLancamento
} from "../src/empresa.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
/** Autorizado a NENHUMA empresa: estado legítimo e distinto de "todas" (é o ponto do contrato explícito). */
const NENHUMA = empresasSelecionadas([]);

describe("escopo de empresa (leitura)", () => {
  it("autorizado a todas e sem pedido: todas as empresas da organização", () => {
    expect(resolverEscopoEmpresa(TODAS_AS_EMPRESAS)).toEqual({ empresaIds: null, recusadas: [], todas: true });
  });
  it("autorização restrita e sem pedido: só as empresas autorizadas", () => {
    expect(resolverEscopoEmpresa(empresasSelecionadas([A, B]))).toEqual({ empresaIds: [A, B], recusadas: [], todas: true });
  });
  it("autorizado a NENHUMA empresa não enxerga nada (nunca é lido como \"todas\")", () => {
    expect(resolverEscopoEmpresa(NENHUMA)).toEqual({ empresaIds: [], recusadas: [], todas: true });
    expect(resolverEscopoEmpresa(NENHUMA, { pedidas: [A] })).toEqual({ empresaIds: [], recusadas: [A], todas: false });
    expect(resolverEscopoEmpresa(NENHUMA, { pedidas: TODAS_EMPRESAS }).empresaIds).toEqual([]);
    expect(resolverEscopoEmpresa(NENHUMA, { selecionada: A }).empresaIds).toEqual([]);
    expect(empresaAutorizada(NENHUMA, A)).toBe(false);
  });
  it("empresa selecionada recorta o escopo sem ampliar a autorização", () => {
    expect(resolverEscopoEmpresa(empresasSelecionadas([A, B]), { selecionada: A }).empresaIds).toEqual([A]);
  });
  it("pedido fora da autorização NUNCA amplia: resulta em nenhuma linha e registra a recusa", () => {
    const r = resolverEscopoEmpresa(empresasSelecionadas([A]), { pedidas: [B, C] });
    expect(r.empresaIds).toEqual([]);
    expect(r.recusadas).toEqual([B, C]);
  });
  it("pedido parcialmente autorizado devolve só a interseção", () => {
    const r = resolverEscopoEmpresa(empresasSelecionadas([A, B]), { pedidas: [B, C] });
    expect(r.empresaIds).toEqual([B]);
    expect(r.recusadas).toEqual([C]);
  });
  it("\"todas\" pedido explicitamente ignora a seleção de trabalho", () => {
    expect(resolverEscopoEmpresa(empresasSelecionadas([A, B]), { pedidas: TODAS_EMPRESAS, selecionada: A }).empresaIds).toEqual([A, B]);
    expect(resolverEscopoEmpresa(TODAS_AS_EMPRESAS, { pedidas: TODAS_EMPRESAS, selecionada: A }).empresaIds).toBeNull();
  });
  it("aceita lista separada por vírgula e ignora vazios/duplicados", () => {
    expect(resolverEscopoEmpresa(TODAS_AS_EMPRESAS, { pedidas: `${A},,${A}, ${B} ` }).empresaIds).toEqual([A, B]);
  });
  it("descreve o escopo resolvido", () => {
    expect(descreverEscopoEmpresa(resolverEscopoEmpresa(TODAS_AS_EMPRESAS))).toEqual({ tipo: "todas" });
    expect(descreverEscopoEmpresa(resolverEscopoEmpresa(empresasSelecionadas([A])))).toEqual({ tipo: "uma", empresaId: A });
    expect(descreverEscopoEmpresa(resolverEscopoEmpresa(empresasSelecionadas([A, B])))).toEqual({ tipo: "conjunto", empresaIds: [A, B] });
  });
});

describe("autorização por empresa", () => {
  it("modo \"todas\" autoriza qualquer empresa; \"selecionadas\" bloqueia as demais", () => {
    expect(empresaAutorizada(TODAS_AS_EMPRESAS, B)).toBe(true);
    expect(empresaAutorizada(empresasSelecionadas([A]), A)).toBe(true);
    expect(empresaAutorizada(empresasSelecionadas([A]), B)).toBe(false);
  });
  it("registro sem empresa (cadastro da organização) é visível a qualquer membro", () => {
    expect(empresaAutorizada(empresasSelecionadas([A]), null)).toBe(true);
    expect(empresaAutorizada(NENHUMA, null)).toBe(true);
  });
  it("registro fora do escopo não existe (NOT_FOUND, nunca 403 que revele existência)", () => {
    expect(() => exigirEmpresaVisivel(empresasSelecionadas([A]), B, "Lançamento")).toThrowError(/não encontrado/i);
    expect(() => exigirEmpresaVisivel(empresasSelecionadas([A]), A)).not.toThrow();
  });
  it("a autorização é uma cópia: mexer na lista de origem não afrouxa o escopo", () => {
    const origem = [A];
    const auth = empresasSelecionadas(origem);
    origem.push(B);
    expect(empresaAutorizada(auth, B)).toBe(false);
  });
});

describe("seleção de empresa no lançamento", () => {
  /**
   * `disponiveis` é SERVER-AUTHORITATIVE: são as empresas que a organização realmente tem. A regra efetiva é
   * a interseção autorização ∩ disponíveis — é isso que impede o modo "todas" de virar "qualquer UUID".
   */
  it("uma única empresa efetiva é preenchida automaticamente", () => {
    expect(selecionarEmpresaDoLancamento(empresasSelecionadas([A]), { disponiveis: [A] })).toEqual({ situacao: "automatica", empresaId: A });
    expect(selecionarEmpresaDoLancamento(TODAS_AS_EMPRESAS, { disponiveis: [A] })).toEqual({ situacao: "automatica", empresaId: A });
  });
  it("autorizado a duas mas só uma disponível: automática (a interseção manda)", () => {
    expect(selecionarEmpresaDoLancamento(empresasSelecionadas([A, B]), { disponiveis: [A] })).toEqual({ situacao: "automatica", empresaId: A });
  });
  it("mais de uma empresa efetiva exige seleção explícita", () => {
    expect(selecionarEmpresaDoLancamento(empresasSelecionadas([A, B]), { disponiveis: [A, B, C] })).toEqual({ situacao: "obrigatoria", opcoes: [A, B] });
    expect(selecionarEmpresaDoLancamento(TODAS_AS_EMPRESAS, { disponiveis: [A, B, C] })).toEqual({ situacao: "obrigatoria", opcoes: [A, B, C] });
  });
  it("MODO \"TODAS\" NÃO É \"QUALQUER UUID\": empresa fora das disponíveis é recusada", () => {
    expect(selecionarEmpresaDoLancamento(TODAS_AS_EMPRESAS, { disponiveis: [A, B], pedida: A })).toEqual({ situacao: "escolhida", empresaId: A });
    expect(selecionarEmpresaDoLancamento(TODAS_AS_EMPRESAS, { disponiveis: [A, B], pedida: C })).toEqual({ situacao: "recusada", empresaId: C });
    // sem nenhuma empresa na organização, "todas" não autoriza nada
    expect(selecionarEmpresaDoLancamento(TODAS_AS_EMPRESAS, { disponiveis: [], pedida: A })).toEqual({ situacao: "recusada", empresaId: A });
  });
  it("empresa pedida fora da autorização é recusada mesmo estando disponível", () => {
    expect(selecionarEmpresaDoLancamento(empresasSelecionadas([A]), { disponiveis: [A, B], pedida: B })).toEqual({ situacao: "recusada", empresaId: B });
    expect(selecionarEmpresaDoLancamento(NENHUMA, { disponiveis: [A, B], pedida: A })).toEqual({ situacao: "recusada", empresaId: A });
  });
  it("zero empresas efetivas é um estado EXPLÍCITO — nunca \"obrigatória\" com lista vazia, nunca padrão inventado", () => {
    // autorizado a empresas que a organização não tem (ou que foram excluídas/desativadas)
    expect(selecionarEmpresaDoLancamento(empresasSelecionadas([A, B]), { disponiveis: [C] })).toEqual({ situacao: "indisponivel" });
    // autorizado a nenhuma empresa
    expect(selecionarEmpresaDoLancamento(NENHUMA, { disponiveis: [A, B] })).toEqual({ situacao: "indisponivel" });
    // organização sem empresa disponível
    expect(selecionarEmpresaDoLancamento(TODAS_AS_EMPRESAS, { disponiveis: [] })).toEqual({ situacao: "indisponivel" });
  });
  it("\"todas as empresas\" nunca vira empresa de um lançamento", () => {
    expect(() => selecionarEmpresaDoLancamento(empresasSelecionadas([A, B]), { disponiveis: [A, B], pedida: TODAS_EMPRESAS })).toThrowError(/escopo de consulta/i);
    expect(() => selecionarEmpresaDoLancamento(TODAS_AS_EMPRESAS, { disponiveis: [A], pedida: TODAS_EMPRESAS })).toThrowError(/escopo de consulta/i);
    expect(() => exigirEmpresaPersistivel(TODAS_EMPRESAS)).toThrowError(/não pode ser gravado/i);
    expect(() => exigirEmpresaPersistivel(null)).toThrowError(/obrigatória/i);
    expect(exigirEmpresaPersistivel(A)).toBe(A);
  });
  it("a ordem das opções segue a lista server-side e duplicatas não contam duas vezes", () => {
    expect(selecionarEmpresaDoLancamento(TODAS_AS_EMPRESAS, { disponiveis: [B, A, B] })).toEqual({ situacao: "obrigatoria", opcoes: [B, A] });
  });
});
