import { describe, it, expect } from "vitest";
import { lerSessaoArmazenada } from "../src/sessao-empresa.js";

/**
 * SESSÃO DO NAVEGADOR NA VIRADA CANÔNICA (PRE-BASE2-05A).
 *
 * A sessão é o único estado do cliente que atravessa um deploy. Estes casos cobrem os três destinos
 * possíveis de uma sessão gravada — seguir como está, ser promovida uma vez, ou ser recusada por
 * ambiguidade — porque é aqui que um erro custa a empresa errada em tela, ou um logout em massa.
 */

const TOKEN = "jwt";
const ORG = "11111111-1111-4111-8111-111111111111";
const EMPRESA_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const EMPRESA_B = "aaaaaaaa-0000-4000-8000-00000000000b";

/** A chave antiga aparece uma vez no teste inteiro — como aparece uma vez no módulo que a conhece. */
const LEGADA = "farmId";
/** Monta a sessão como a versão anterior do cliente a gravaria. */
const gravadaPorClienteAnterior = (extra: Record<string, unknown>) => ({ token: TOKEN, orgId: ORG, ...extra });
/** A promoção só está completa quando a chave antiga some — é isso que impede a migração de se repetir. */
const temChaveAntiga = (sessao: Record<string, unknown>) => LEGADA in sessao;

describe("sessão já canônica", () => {
  it("passa direto e NÃO pede regravação — o caminho comum não escreve no armazenamento", () => {
    const r = lerSessaoArmazenada({ token: TOKEN, orgId: ORG, empresaId: EMPRESA_A });
    expect(r.tipo).toBe("canonica");
    if (r.tipo !== "canonica") return;
    expect(r.sessao["empresaId"]).toBe(EMPRESA_A);
    expect(temChaveAntiga(r.sessao)).toBe(false);
  });

  it("empresa nenhuma selecionada continua sendo estado válido", () => {
    const r = lerSessaoArmazenada({ token: TOKEN, orgId: ORG, empresaId: null });
    expect(r.tipo).toBe("canonica");
  });
});

describe("sessão anterior a PRE-BASE2-03 (só a chave antiga)", () => {
  it("promove para empresaId, REMOVE a chave legada e pede regravação", () => {
    const r = lerSessaoArmazenada(gravadaPorClienteAnterior({ [LEGADA]: EMPRESA_A }));
    expect(r.tipo, "sem promoção o usuário perde a empresa selecionada no primeiro acesso").toBe("migrada");
    if (r.tipo !== "migrada") return;
    expect(r.empresaId).toBe(EMPRESA_A);
    expect(r.sessao["empresaId"]).toBe(EMPRESA_A);
    expect(temChaveAntiga(r.sessao), "a chave antiga tem de SAIR do armazenamento").toBe(false);
    // O resto da sessão sobrevive intacto — promover não é recriar.
    expect(r.sessao["token"]).toBe(TOKEN);
    expect(r.sessao["orgId"]).toBe(ORG);
  });

  it("chave antiga nula também é promovida: 'nenhuma empresa' é escolha, não ausência de dado", () => {
    const r = lerSessaoArmazenada(gravadaPorClienteAnterior({ [LEGADA]: null }));
    expect(r.tipo).toBe("migrada");
    if (r.tipo !== "migrada") return;
    expect(r.empresaId).toBeNull();
    expect(temChaveAntiga(r.sessao)).toBe(false);
  });

  it("as duas chaves com o MESMO valor: sobra legada, não conflito — limpa e segue", () => {
    const r = lerSessaoArmazenada(gravadaPorClienteAnterior({ empresaId: EMPRESA_A, [LEGADA]: EMPRESA_A }));
    expect(r.tipo).toBe("migrada");
    if (r.tipo !== "migrada") return;
    expect(r.empresaId).toBe(EMPRESA_A);
    expect(temChaveAntiga(r.sessao)).toBe(false);
  });
});

describe("conflito: nunca escolher uma das empresas", () => {
  it("chave antiga=A e empresaId=B → FAIL-SAFE, sem eleger nenhuma das duas", () => {
    const r = lerSessaoArmazenada(gravadaPorClienteAnterior({ empresaId: EMPRESA_B, [LEGADA]: EMPRESA_A }));
    expect(r.tipo, "os dois clientes preservam a chave alheia: o armazenamento não diz qual é a atual").toBe("conflito");
    if (r.tipo !== "conflito") return;
    expect(r.canonico).toBe(EMPRESA_B);
    expect(r.legado).toBe(EMPRESA_A);
  });

  it("empresaId nulo com a chave antiga preenchida também é ambíguo", () => {
    const r = lerSessaoArmazenada(gravadaPorClienteAnterior({ empresaId: null, [LEGADA]: EMPRESA_A }));
    expect(r.tipo).toBe("conflito");
  });

});

/**
 * O VALOR também é contrato — não só a chave. `localStorage` é editável pelo usuário e sobrevive a
 * qualquer versão do cliente; uma empresa que não seja UUID (nem nula) viajaria em `X-Empresa-Id` e
 * voltaria como 422 em telas sem relação com a causa. O backend segue sendo a autoridade, mas contrato que
 * só o servidor faz cumprir não é contrato.
 */
describe("empresa gravada fora do contrato canônico", () => {
  const invalida = (bruto: unknown) => lerSessaoArmazenada(bruto);

  it("canônico com número, objeto, lista, booleano, vazio ou UUID malformado → invalida", () => {
    for (const v of [42, {}, [], true, "", "abc", "todas", "aaaaaaaa-0000-4000-8000-00000000000"]) {
      const r = invalida({ token: TOKEN, orgId: ORG, empresaId: v });
      expect(r.tipo, `empresaId=${JSON.stringify(v)}`).toBe("invalida");
      if (r.tipo === "invalida") expect(r.motivo.length).toBeGreaterThan(0);
    }
  });

  it('"todas" é ESCOPO de leitura, nunca empresa persistida', () => {
    expect(invalida({ token: TOKEN, orgId: ORG, empresaId: "todas" }).tipo).toBe("invalida");
  });

  it("chave antiga com valor fora do contrato → invalida, não conflito: não há duas verdades, há dado que não serve", () => {
    for (const v of [42, { id: EMPRESA_A }, "abc", ""]) {
      expect(invalida(gravadaPorClienteAnterior({ [LEGADA]: v })).tipo, JSON.stringify(v)).toBe("invalida");
    }
  });

  it("as duas chaves com o MESMO valor inválido: a igualdade não legitima o valor", () => {
    expect(invalida(gravadaPorClienteAnterior({ empresaId: "abc", [LEGADA]: "abc" })).tipo).toBe("invalida");
  });

  it("sessão sem NENHUMA das duas chaves → invalida", () => {
    // Evidência: todo cliente que já gravou sessão neste produto gravou a chave da empresa explicitamente
    // (`empresaId: null` hoje, a legada com `null` antes de PRE-BASE2-03 — ver o histórico de
    // apps/web/src/app/login/page.tsx). Não há versão legítima a acomodar, então migrar para `null` seria
    // inventar compatibilidade sem prova.
    const r = invalida({ token: TOKEN, orgId: ORG });
    expect(r.tipo).toBe("invalida");
  });

  it("divergência vence a validação: dois valores diferentes continuam CONFLITO, mesmo com um inválido", () => {
    expect(invalida(gravadaPorClienteAnterior({ empresaId: EMPRESA_A, [LEGADA]: 42 })).tipo).toBe("conflito");
  });
});

describe("armazenamento inutilizável", () => {
  it("ausente, nulo, texto solto ou lista não viram sessão", () => {
    for (const bruto of [undefined, null, "", "sessao", 7, [], [{ token: TOKEN }]]) {
      expect(lerSessaoArmazenada(bruto).tipo, String(JSON.stringify(bruto))).toBe("ausente");
    }
  });
});
