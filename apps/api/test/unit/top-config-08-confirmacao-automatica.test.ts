import { describe, it, expect, afterAll } from "vitest";
import Fastify from "fastify";
import { z, type ZodError } from "zod";
import { DomainError, ErrorCodes } from "@agro/shared";
import { configuracaoNeutraTopV3, configuracaoNeutraTopV4, mensagemAprovacaoReprovada, MENSAGEM_APROVACAO_PENDENTE } from "@agro/domain";
import errorsPlugin from "../../src/plugins/errors.js";
import { fromPgError } from "../../src/lib/errors.js";
import type { ServiceCtx } from "../../src/lib/context.js";
import { confirmaAutomaticamente, lerVersaoCongeladaTop, tentarConfirmacaoAutomatica } from "../../src/lib/confirmacao-automatica.js";

/**
 * TOP-CONFIG-08 · A CONFIRMAÇÃO AUTOMÁTICA — O RESULTADO, PROVADO SEM BANCO (decisão 277; SPEC §3 e §11).
 *
 * O que está sob teste é a DECISÃO de `tentarConfirmacaoAutomatica`: se tenta, em que ordem fala com a transação,
 * e o que a resposta da gravação diz quando a confirmação não acontece. A confirmação de verdade (estoque, títulos,
 * guarda da 0041, deadlock real) é provada na integração (CA-1…CA-12); aqui o contexto é falso DE PROPÓSITO, e a
 * transação falsa imita as duas regras do Postgres que tornam o savepoint obrigatório:
 *   · depois de um erro do BANCO a transação fica ABORTADA, e o único comando que ela aceita é o
 *     `rollback to savepoint` — um `release` antes dele, ou qualquer outra consulta, falha com 25P02;
 *   · `rollback to` e `release` só existem sobre um savepoint aberto, e o `release` o fecha.
 * Com isso, uma implementação que classificasse o erro e só depois desfizesse, ou que soltasse o savepoint sem
 * desfazer, não fica verde por acidente: a transação falsa responde como a real responderia.
 *
 * O ORÁCULO DO CORPO: "o erro é o MESMO corpo que o /confirm daria" (SPEC §3) não se prova comparando com um
 * literal escrito aqui — um literal envelhece junto com o código que ele deveria vigiar. O corpo do /confirm É o
 * que o tratador de erros da API (`plugins/errors.ts`) devolve em `{ error }`; então cada recusa é comparada,
 * chave por chave, com a resposta que esse mesmo tratador dá ao mesmo erro lançado numa rota.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const SAVEPOINT = "savepoint confirmacao_automatica";
const ROLLBACK = "rollback to savepoint confirmacao_automatica";
const RELEASE = "release savepoint confirmacao_automatica";
const CONFIRMAR = "<confirmar>";

/**
 * O erro que o driver `pg` entrega: um `Error` com `code` SQLSTATE (o `DatabaseError` dele estende `Error`). Fica
 * anotado como erro DO BANCO sem que ninguém precise ler o `code` dele — a leitura do `code` é o que a espia da
 * classificação mede.
 */
const DO_BANCO = new WeakSet<object>();
const erroPg = (code: string, message: string, extra: { constraint?: string; detail?: string } = {}): Error => {
  const e = Object.assign(new Error(message), { code, ...extra });
  DO_BANCO.add(e);
  return e;
};

/** Uma transação falsa: grava cada comando e imita a transação abortada e a pilha de savepoints do Postgres. */
class TxFalsa {
  readonly comandos: string[] = [];
  readonly savepoints: string[] = [];
  abortada = false;
  /** Comando → erro que ele lança (o savepoint que não abre, o rollback de uma conexão perdida). */
  readonly falhas = new Map<string, Error>();

  async query(sql: string): Promise<{ rows: unknown[]; rowCount: number | null }> {
    this.comandos.push(sql);
    const falha = this.falhas.get(sql);
    if (falha) throw falha;
    const rollback = /^rollback to savepoint (\w+)$/.exec(sql);
    if (this.abortada && !rollback) throw erroPg("25P02", "current transaction is aborted, commands ignored until end of transaction block");
    const nome = /^(?:savepoint|release savepoint|rollback to savepoint) (\w+)$/.exec(sql)?.[1];
    if (!nome) throw new Error(`TxFalsa: comando inesperado: ${sql}`);
    if (sql.startsWith("savepoint ")) this.savepoints.push(nome);
    else if (!this.savepoints.includes(nome)) throw erroPg("3B001", `savepoint "${nome}" does not exist`);
    else if (rollback) this.abortada = false;
    else this.savepoints.splice(this.savepoints.lastIndexOf(nome), 1);
    return { rows: [], rowCount: null };
  }
}

function ctxFalso(o: { permissoes?: string[]; dono?: boolean } = {}) {
  const tx = new TxFalsa();
  const ctx = {
    orgId: ORG,
    membership: { isOwner: o.dono ?? false },
    permissions: new Set(o.permissoes ?? []),
    tx,
  } as unknown as ServiceCtx;
  return { ctx, tx };
}

/**
 * O `confirmar` falso: marca na MESMA fila de comandos o momento em que roda, e lança o erro pedido. Erro do
 * BANCO (tem SQLSTATE) aborta a transação, como no Postgres; erro de JavaScript (DomainError do planejamento,
 * ZodError, bug) não — o planejamento recusa antes de qualquer comando falhar.
 */
function confirmarFalso(tx: TxFalsa, erro?: unknown): () => Promise<unknown> {
  return async () => {
    tx.comandos.push(CONFIRMAR);
    if (erro === undefined) return { id: "doc", status: "confirmed" };
    if (typeof erro === "object" && erro !== null && DO_BANCO.has(erro)) tx.abortada = true;
    throw erro;
  };
}

/**
 * Espia a CLASSIFICAÇÃO: troca a propriedade `code` do erro por um leitor que anota, na fila de comandos, o
 * momento em que alguém a lê. Classificar um erro (é APROVACAO_PENDENTE? é do banco?) é ler o `code` dele.
 */
function espiarClassificacao<T extends object>(tx: TxFalsa, erro: T): T {
  const valor = (erro as { code?: unknown }).code;
  Object.defineProperty(erro, "code", {
    configurable: true,
    enumerable: true,
    get: () => {
      tx.comandos.push("<leu code>");
      return valor;
    },
  });
  return erro;
}

/** Os comandos de transação, sem as marcas do teste. */
const soTransacao = (tx: TxFalsa): string[] => tx.comandos.filter((c) => !c.startsWith("<"));

// O tratador de erros da API, numa instância sem banco: a rota só lança o que o teste mandar.
const app = Fastify({ logger: false });
let lancar: unknown = null;
const pronto = (async () => {
  await app.register(errorsPlugin);
  app.post("/confirm", async () => {
    throw lancar;
  });
  await app.ready();
})();
afterAll(async () => {
  await app.close();
});

/** O corpo `{ error }` que o /confirm devolveria para ESTE erro — o oráculo da recusa. */
async function corpoDoConfirm(erro: unknown): Promise<{ status: number; error: unknown }> {
  await pronto;
  lancar = erro;
  const r = await app.inject({ method: "POST", url: "/confirm" });
  return { status: r.statusCode, error: (r.json() as { error: unknown }).error };
}

describe("quem confirma: a MESMA capacidade da confirmação manual — a TOP nunca dá poder", () => {
  it("sem a capacidade: sem_permissao, NENHUM comando na transação (nem o savepoint) e o confirmar nunca roda", async () => {
    const { ctx, tx } = ctxFalso({ permissoes: ["sales.view", "sales.create"] });
    const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx) });
    expect(r).toStrictEqual({ confirmado: false, motivo: "sem_permissao" });
    expect(tx.comandos).toEqual([]);
  });

  it("a capacidade de OUTRO recurso, ou a de aprovar, não serve: quem aprova sem .edit fica em sem_permissao (AP-6)", async () => {
    for (const permissoes of [["compras.edit"], ["sales.approve"], ["entradas_estoque.edit"]]) {
      const { ctx, tx } = ctxFalso({ permissoes });
      const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx) });
      expect(r, permissoes.join(",")).toStrictEqual({ confirmado: false, motivo: "sem_permissao" });
      expect(tx.comandos).toEqual([]);
    }
  });

  it("com a capacidade exata do documento, tenta", async () => {
    const { ctx, tx } = ctxFalso({ permissoes: ["saidas_estoque.edit"] });
    const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "saidas_estoque.edit", confirmar: confirmarFalso(tx) });
    expect(r).toStrictEqual({ confirmado: true });
    expect(tx.comandos).toContain(CONFIRMAR);
  });

  it("o dono da organização tem a capacidade (hasPermission), mesmo sem a chave na lista", async () => {
    const { ctx, tx } = ctxFalso({ dono: true, permissoes: [] });
    const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "compras.edit", confirmar: confirmarFalso(tx) });
    expect(r).toStrictEqual({ confirmado: true });
    expect(tx.comandos).toEqual([SAVEPOINT, CONFIRMAR, RELEASE]);
  });
});

describe("sucesso: savepoint → confirmar → release, nesta ordem", () => {
  it("{ confirmado: true }, sem chave a mais, o confirmar uma vez só e nenhum savepoint deixado aberto", async () => {
    const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
    const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx) });
    expect(r).toStrictEqual({ confirmado: true });
    expect(tx.comandos).toEqual([SAVEPOINT, CONFIRMAR, RELEASE]);
    expect(tx.savepoints).toEqual([]);
  });
});

describe("aprovação pendente: o planejamento parou no passo da aprovação → aguardando_aprovacao", () => {
  it("rollback to savepoint ANTES de classificar o erro; a resposta não carrega o erro", async () => {
    const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
    const pendente = espiarClassificacao(tx, new DomainError("APROVACAO_PENDENTE", MENSAGEM_APROVACAO_PENDENTE, {
      politica: "por_valor", valorMinimo: "1500.00", valorDocumento: "1500.00",
    }));
    const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx, pendente) });
    expect(r).toStrictEqual({ confirmado: false, motivo: "aguardando_aprovacao" });
    // A primeira leitura do `code` vem depois do rollback: desfazer primeiro, classificar depois.
    const leitura = tx.comandos.indexOf("<leu code>");
    expect(leitura, "o erro precisa ser classificado").toBeGreaterThan(-1);
    expect(tx.comandos.indexOf(ROLLBACK)).toBeGreaterThan(-1);
    expect(tx.comandos.indexOf(ROLLBACK)).toBeLessThan(leitura);
    expect(soTransacao(tx)).toEqual([SAVEPOINT, ROLLBACK, RELEASE]);
    expect(tx.savepoints).toEqual([]);
  });
});

describe("recusa de domínio → recusada, com o MESMO corpo de erro do /confirm", () => {
  it("APROVACAO_REPROVADA com details: erro { code, message, details } idêntico ao toJSON e ao corpo do /confirm", async () => {
    const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
    const reprovada = new DomainError("APROVACAO_REPROVADA", mensagemAprovacaoReprovada("Preço abaixo da tabela"), {
      motivo: "Preço abaixo da tabela",
      decididoPor: { id: "22222222-2222-4222-8222-222222222222", nome: "Aprovadora" },
      decididoEm: "2026-10-01T12:00:00.000Z",
    });
    const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx, reprovada) });
    expect(r).toStrictEqual({ confirmado: false, motivo: "recusada", erro: reprovada.toJSON() });
    expect(r).toStrictEqual({ confirmado: false, motivo: "recusada", erro: (await corpoDoConfirm(reprovada)).error });
    expect(r.confirmado === false && r.motivo === "recusada" ? r.erro.message : null).toBe("Este documento foi reprovado: Preço abaixo da tabela.");
    expect(soTransacao(tx)).toEqual([SAVEPOINT, ROLLBACK, RELEASE]);
  });

  it("DomainError SEM details: o objeto do erro não tem a chave details — o JSON é o mesmo do /confirm", async () => {
    const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
    const periodo = new DomainError("PERIOD_FROZEN", "Período fechado para lançamentos");
    const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx, periodo) });
    if (r.confirmado || r.motivo !== "recusada") throw new Error(`esperava recusada, veio ${JSON.stringify(r)}`);
    expect(Object.keys(r.erro)).toEqual(["code", "message"]);
    expect(r.erro).toStrictEqual({ code: "PERIOD_FROZEN", message: "Período fechado para lançamentos" });
    const confirm = await corpoDoConfirm(periodo);
    expect(confirm.error).toStrictEqual(r.erro);
    expect(JSON.stringify(r.erro)).toBe(JSON.stringify(periodo.toJSON()));
  });

  it("toda recusa de domínio é resolvida, nunca lançada: cada código do ErrorCodes vira recusada (a pendente, aguardando)", async () => {
    const codigos = Object.values(ErrorCodes);
    // A premissa junto com a conclusão: o laço percorre o catálogo de verdade, com os três códigos desta fatia.
    expect(codigos).toEqual(expect.arrayContaining(["APROVACAO_PENDENTE", "APROVACAO_REPROVADA", "APROVACAO_NAO_EXIGIDA", "CONFLICT", "CONCURRENCY_CONFLICT"]));
    for (const code of codigos) {
      const { ctx, tx } = ctxFalso({ permissoes: ["compras.edit"] });
      const erro = new DomainError(code, `recusa ${code}`, { campo: code });
      const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "compras.edit", confirmar: confirmarFalso(tx, erro) });
      if (code === "APROVACAO_PENDENTE") expect(r).toStrictEqual({ confirmado: false, motivo: "aguardando_aprovacao" });
      else expect(r, code).toStrictEqual({ confirmado: false, motivo: "recusada", erro: { code, message: `recusa ${code}`, details: { campo: code } } });
      expect(soTransacao(tx), code).toEqual([SAVEPOINT, ROLLBACK, RELEASE]);
    }
  });
});

describe("recusa do BANCO (o que o fromPgError traduz) → recusada; a transação abortada volta pelo rollback", () => {
  // Cada caso: o erro que o driver entrega e o código que o /confirm responderia.
  const CASOS: { nome: string; erro: () => Error; code: string }[] = [
    { nome: "P0001 da guarda da 0041 (CONFLICT, mensagem fixa, sem details)", code: "CONFLICT",
      erro: () => erroPg("P0001", "CONFLICT: Este documento precisa de aprovação antes de ser confirmado.") },
    { nome: "P0001 da guarda da 0041, reprovado", code: "CONFLICT",
      erro: () => erroPg("P0001", "CONFLICT: Este documento foi reprovado e não pode ser confirmado.") },
    { nome: "40P01 (deadlock: a automática foi a vítima — CA-12)", code: "CONCURRENCY_CONFLICT",
      erro: () => erroPg("40P01", "deadlock detected") },
    { nome: "40001 (serialização)", code: "CONCURRENCY_CONFLICT",
      erro: () => erroPg("40001", "could not serialize access due to concurrent update") },
    { nome: "23505 (duplicidade, com constraint e detail)", code: "CONFLICT",
      erro: () => erroPg("23505", "duplicate key value violates unique constraint \"uq_titulos_codigo\"", { constraint: "uq_titulos_codigo", detail: "Key (codigo)=(V-1) already exists." }) },
  ];

  for (const caso of CASOS) {
    it(`${caso.nome} → recusada ${caso.code}, com o corpo do /confirm`, async () => {
      const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
      const erro = caso.erro();
      const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx, erro) });
      const confirm = await corpoDoConfirm(caso.erro());
      expect(confirm.status, "o /confirm responde 409 a este erro").toBe(409);
      expect(r).toStrictEqual({ confirmado: false, motivo: "recusada", erro: confirm.error });
      expect(r.confirmado === false && r.motivo === "recusada" ? r.erro.code : null).toBe(caso.code);
      expect(soTransacao(tx)).toEqual([SAVEPOINT, ROLLBACK, RELEASE]);
      expect(tx.abortada, "o rollback devolveu a transação viva").toBe(false);
      expect(tx.savepoints).toEqual([]);
    });
  }

  it("a guarda do banco chega sem details: a chave nem existe (AP-12)", async () => {
    const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
    const r = await tentarConfirmacaoAutomatica(ctx, {
      permissao: "sales.edit",
      confirmar: confirmarFalso(tx, erroPg("P0001", "CONFLICT: Este documento precisa de aprovação antes de ser confirmado.")),
    });
    expect(r).toStrictEqual({
      confirmado: false, motivo: "recusada",
      erro: { code: "CONFLICT", message: "Este documento precisa de aprovação antes de ser confirmado." },
    });
  });

  it("o erro do banco também é classificado só DEPOIS do rollback", async () => {
    const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
    const erro = espiarClassificacao(tx, erroPg("40P01", "deadlock detected"));
    const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx, erro) });
    expect(r.confirmado === false && r.motivo === "recusada" ? r.erro.code : null).toBe("CONCURRENCY_CONFLICT");
    expect(tx.comandos.indexOf(ROLLBACK)).toBeGreaterThan(-1);
    expect(tx.comandos.indexOf(ROLLBACK)).toBeLessThan(tx.comandos.indexOf("<leu code>"));
  });

  it("o resultado traz exatamente o que o fromPgError traduz — nem a mais, nem a menos", async () => {
    const erro = erroPg("23505", "duplicate key", { constraint: "uq_x", detail: "Key (x)=(1) already exists." });
    const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
    const r = await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx, erro) });
    expect(r).toStrictEqual({ confirmado: false, motivo: "recusada", erro: fromPgError(erro)!.toJSON() });
  });
});

describe("erro que NÃO é de domínio: rollback to savepoint, e o MESMO erro sobe", () => {
  const zod = (): ZodError => z.object({ total: z.string() }).safeParse({ total: 1 }).error!;
  const CASOS: { nome: string; erro: () => Error }[] = [
    { nome: "Error comum (bug)", erro: () => new TypeError("Cannot read properties of undefined (reading 'id')") },
    { nome: "ZodError (documento gravado fora do esquema)", erro: zod },
    { nome: "pg 22012 (divisão por zero: o fromPgError não traduz)", erro: () => erroPg("22012", "division by zero") },
    { nome: "P0001 sem o prefixo CODIGO: (raise que ninguém nomeou)", erro: () => erroPg("P0001", "algo deu errado no gatilho") },
    // A decisão de deixar o ZodError subir é do arquivo, não um acaso do fromPgError: mesmo carregando um
    // SQLSTATE que o fromPgError traduziria, ele sobe.
    { nome: "ZodError carregando um code de banco", erro: () => Object.assign(zod(), { code: "23505" }) },
  ];

  for (const caso of CASOS) {
    it(`${caso.nome} → rejects.toBe(o mesmo erro), depois do rollback`, async () => {
      const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
      const erro = caso.erro();
      await expect(tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx, erro) })).rejects.toBe(erro);
      expect(soTransacao(tx)).toEqual([SAVEPOINT, ROLLBACK, RELEASE]);
      expect(tx.abortada).toBe(false);
      expect(tx.savepoints).toEqual([]);
      expect(erro, "o que sobe nunca é um DomainError").not.toBeInstanceOf(DomainError);
    });
  }

  it("o savepoint que não abre: a falha sobe como está, e o confirmar nunca roda", async () => {
    const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
    const falha = erroPg("25P02", "current transaction is aborted, commands ignored until end of transaction block");
    tx.falhas.set(SAVEPOINT, falha);
    await expect(tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx) })).rejects.toBe(falha);
    expect(tx.comandos).toEqual([SAVEPOINT]);
  });

  it("o rollback que falha (conexão perdida): a falha do rollback sobe — não existe recusada sobre uma transação morta", async () => {
    const { ctx, tx } = ctxFalso({ permissoes: ["sales.edit"] });
    const conexao = new Error("Connection terminated unexpectedly");
    tx.falhas.set(ROLLBACK, conexao);
    const recusa = new DomainError("INSUFFICIENT_STOCK", "Saldo insuficiente");
    await expect(tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: confirmarFalso(tx, recusa) })).rejects.toBe(conexao);
    expect(tx.comandos).toEqual([SAVEPOINT, CONFIRMAR, ROLLBACK]);
  });
});

describe("a versão congelada decide se confirma sozinho (confirmaAutomaticamente / lerVersaoCongeladaTop)", () => {
  const VERSAO = "33333333-3333-4333-8333-333333333333";

  function ctxComVersao(linha: { configuracao: unknown; codigo_base: string } | null) {
    const consultas: { sql: string; params: unknown[] }[] = [];
    const ctx = {
      orgId: ORG,
      tx: {
        query: async (sql: string, params: unknown[] = []) => {
          consultas.push({ sql, params });
          return { rows: linha ? [linha] : [], rowCount: linha ? 1 : 0 };
        },
      },
    } as unknown as ServiceCtx;
    return { ctx, consultas };
  }

  const neutra4 = configuracaoNeutraTopV4();
  const neutra3 = configuracaoNeutraTopV3();
  const automatica4 = { ...neutra4, geral: { ...neutra4.geral, confirmacao: "automatica" } };
  // O pedido de compra de produção: formato 3, Automática e Sem itens Permitido gravados — e nada executa (CA-9).
  const automatica3 = { ...neutra3, geral: { ...neutra3.geral, confirmacao: "automatica", documentoSemItens: "permitido" } };

  it("documento sem TOP: null, false, e nenhuma consulta", async () => {
    const { ctx, consultas } = ctxComVersao(null);
    expect(await lerVersaoCongeladaTop(ctx, null)).toBeNull();
    expect(await confirmaAutomaticamente(ctx, null)).toBe(false);
    expect(consultas).toEqual([]);
  });

  it("UMA consulta pela linha exata da versão, recortada pela organização, sem trava e sem filtro de estado no pai", async () => {
    const { ctx, consultas } = ctxComVersao({ configuracao: automatica4, codigo_base: "vendas.venda" });
    expect(await lerVersaoCongeladaTop(ctx, VERSAO)).toStrictEqual({ codigoBase: "vendas.venda", configuracao: automatica4 });
    expect(consultas).toHaveLength(1);
    expect(consultas[0]!.params).toEqual([VERSAO, ORG]);
    expect(consultas[0]!.sql).toContain("v.id = $1 and v.organization_id = $2");
    expect(consultas[0]!.sql).not.toMatch(/for (share|update)|deleted_at|ativo|versao_atual/i);
  });

  it("a versão que a organização não enxerga é corrupção, nunca 'sem TOP': TIPO_OPERACAO_INDISPONIVEL", async () => {
    const { ctx } = ctxComVersao(null);
    await expect(lerVersaoCongeladaTop(ctx, VERSAO)).rejects.toMatchObject({ code: "TIPO_OPERACAO_INDISPONIVEL" });
    await expect(confirmaAutomaticamente(ctx, VERSAO)).rejects.toBeInstanceOf(DomainError);
  });

  const CASOS: { nome: string; configuracao: unknown; esperado: boolean }[] = [
    { nome: "formato 4 Automática", configuracao: automatica4, esperado: true },
    { nome: "formato 4 Manual", configuracao: neutra4, esperado: false },
    { nome: "formato 3 com 'automatica' gravado (o corte — CA-9)", configuracao: automatica3, esperado: false },
    { nome: "formato 4 malformado (ilegível: a manual recusa como hoje)", configuracao: { ...automatica4, geral: { confirmacao: "automatica" } }, esperado: false },
    { nome: "formato desconhecido", configuracao: { ...automatica4, versaoSchema: 99 }, esperado: false },
  ];
  for (const caso of CASOS) {
    it(`${caso.nome} → ${caso.esperado}`, async () => {
      const { ctx, consultas } = ctxComVersao({ configuracao: caso.configuracao, codigo_base: "compras.compra" });
      expect(await confirmaAutomaticamente(ctx, VERSAO)).toBe(caso.esperado);
      expect(consultas).toHaveLength(1);
    });
  }
});
