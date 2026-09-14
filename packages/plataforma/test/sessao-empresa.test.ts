import { describe, it, expect } from "vitest";
import { lerSessaoArmazenada } from "../src/sessao-empresa.js";

/**
 * SESSÃO DO NAVEGADOR — CONTRATO CANÔNICO (PRE-BASE2-05B).
 *
 * A promoção da chave anterior saiu com a borda legada do servidor. O que estes casos cobrem é o contrato
 * que ficou: a sessão só é aceita quando a empresa gravada é `null` ou UUID. É aqui que um erro custa a
 * empresa errada em tela, ou um logout em massa — por isso a matriz é explícita, e não uma amostra.
 */

const TOKEN = "jwt";
const ORG = "11111111-1111-4111-8111-111111111111";
const EMPRESA = "aaaaaaaa-0000-4000-8000-00000000000a";
const sessao = (extra: Record<string, unknown>) => ({ token: TOKEN, orgId: ORG, ...extra });

describe("sessão canônica", () => {
  it("empresaId com UUID válido passa direto e NÃO pede regravação", () => {
    const r = lerSessaoArmazenada(sessao({ empresaId: EMPRESA }));
    expect(r.tipo).toBe("canonica");
    if (r.tipo !== "canonica") return;
    expect(r.sessao["empresaId"]).toBe(EMPRESA);
    // O resto da sessão segue intacto — validar não é recriar.
    expect(r.sessao["token"]).toBe(TOKEN);
    expect(r.sessao["orgId"]).toBe(ORG);
  });

  it("empresaId null é estado válido: 'nenhuma empresa selecionada' é escolha, não ausência", () => {
    expect(lerSessaoArmazenada(sessao({ empresaId: null })).tipo).toBe("canonica");
  });
});

describe("sessão fora do contrato", () => {
  const tipoDe = (extra: Record<string, unknown>) => lerSessaoArmazenada(sessao(extra));

  it("empresaId número, objeto, lista, booleano, vazio, texto solto ou UUID malformado → invalida", () => {
    for (const v of [42, {}, [], true, "", "abc", "aaaaaaaa-0000-4000-8000-00000000000"]) {
      const r = tipoDe({ empresaId: v });
      expect(r.tipo, `empresaId=${JSON.stringify(v)}`).toBe("invalida");
      if (r.tipo === "invalida") expect(r.motivo.length).toBeGreaterThan(0);
    }
  });

  it('"todas" é ESCOPO de leitura resolvido no servidor, nunca empresa persistida', () => {
    expect(tipoDe({ empresaId: "todas" }).tipo).toBe("invalida");
  });

  it("sessão SEM a chave canônica → invalida (nada é assumido em nome do usuário)", () => {
    const r = lerSessaoArmazenada({ token: TOKEN, orgId: ORG });
    expect(r.tipo).toBe("invalida");
  });

  /**
   * Uma sessão dormante, gravada por uma versão do cliente anterior à PRE-BASE2-05A, não é mais promovida:
   * ela cai aqui e o usuário faz login de novo. É a troca deliberada de 05B — um login a mais em vez de uma
   * ponte que nenhuma versão viva do cliente ainda atravessa.
   */
  it("sessão gravada por um cliente anterior à virada canônica → invalida, sem promoção", () => {
    expect(lerSessaoArmazenada({ token: TOKEN, orgId: ORG, farmId: EMPRESA }).tipo).toBe("invalida");
    expect(lerSessaoArmazenada({ token: TOKEN, orgId: ORG, farmId: null }).tipo).toBe("invalida");
  });

  it("a chave anterior NÃO sustenta uma sessão nem quando o canônico está presente e inválido", () => {
    expect(lerSessaoArmazenada({ token: TOKEN, orgId: ORG, empresaId: 7, farmId: EMPRESA }).tipo).toBe("invalida");
  });

  it("a chave anterior é IGNORADA como dado quando o canônico é válido — sem conflito, sem eleição", () => {
    // Não existe mais ambiguidade a resolver: o canônico é a única autoridade, e nada é lido da chave velha.
    const r = lerSessaoArmazenada({ token: TOKEN, orgId: ORG, empresaId: EMPRESA, farmId: "bbbbbbbb-0000-4000-8000-00000000000b" });
    expect(r.tipo).toBe("canonica");
    if (r.tipo === "canonica") expect(r.sessao["empresaId"]).toBe(EMPRESA);
  });
});

describe("armazenamento inutilizável", () => {
  it("ausente, nulo, texto solto ou lista não viram sessão", () => {
    for (const bruto of [undefined, null, "", "sessao", 7, [], [{ token: TOKEN }]]) {
      expect(lerSessaoArmazenada(bruto).tipo, String(JSON.stringify(bruto))).toBe("ausente");
    }
  });
});
