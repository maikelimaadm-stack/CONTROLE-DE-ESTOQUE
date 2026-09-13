import { describe, it, expect } from "vitest";
import { lerPedidoEmpresa, empresaDestinoDoRegistro } from "../src/contexto-empresa.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

/**
 * A máquina de estado da troca de empresa, sem navegador. É ela que decide se a navegação por `#N` precisa
 * mudar o contexto — e o que ela NÃO faz importa tanto quanto o que faz: não estreita um contexto em "todas"
 * e não inventa empresa para um cadastro da organização.
 */
describe("quando a empresa ativa precisa mudar", () => {
  it("empresa específica diferente da do registro: troca", () => {
    expect(empresaDestinoDoRegistro(A, B)).toBe(B);
  });
  it("mesma empresa: não troca", () => {
    expect(empresaDestinoDoRegistro(A, A)).toBeNull();
  });
  it("contexto em 'todas as empresas' é preservado", () => {
    expect(empresaDestinoDoRegistro(null, B), "abrir a rota não exige estreitar o contexto do usuário").toBeNull();
  });
  it("registro da organização inteira não escolhe empresa nenhuma", () => {
    expect(empresaDestinoDoRegistro(A, null)).toBeNull();
  });
});

describe("forma do pedido", () => {
  it("formato canônico carrega empresa e destino", () => {
    expect(lerPedidoEmpresa({ empresaId: B, rota: `/financeiro/contas-a-pagar/${A}` })).toEqual({ empresaId: B, rota: `/financeiro/contas-a-pagar/${A}` });
  });
  it("formato legado (só o identificador) continua aceito", () => {
    expect(lerPedidoEmpresa(B)).toEqual({ empresaId: B });
  });
  it("'todas as empresas' chega como nulo, venha vazio, nulo ou indefinido", () => {
    for (const bruto of ["", null, undefined]) expect(lerPedidoEmpresa(bruto)).toEqual({ empresaId: null });
  });
  it("rota vazia ou de outro tipo não vira destino", () => {
    expect(lerPedidoEmpresa({ empresaId: B, rota: "" })).toEqual({ empresaId: B });
    expect(lerPedidoEmpresa({ empresaId: B, rota: 42 })).toEqual({ empresaId: B });
  });
});
