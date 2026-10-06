import { describe, it, expect } from "vitest";
import type { Db } from "@agro/db";
import { loadConfig } from "../../src/config.js";
import { buildApp } from "../../src/server.js";
import type { BuscarFn } from "../../src/lib/consultas/http.js";
import { FalhaCopernicus } from "../../src/lib/satelite/copernicus.js";
import { MODULO_EXECUTOR, PERMISSAO_EXECUTAR_ITEM } from "../../src/lib/satelite/contexto-worker.js";
import { ERROS_ITEM } from "../../src/lib/satelite/executar-item.js";
import {
  LIMITES_SATELITE_PADRAO, LIMIAR_ERRO_ESTRUTURAL_CONSECUTIVO, PAUSA_EXECUTOR_APOS_ERRO_ESTRUTURAL_S,
  PAUSA_EXECUTOR_APOS_FALHA_DO_PROVEDOR_S, limitesDaConfig
} from "../../src/lib/satelite/limites.js";
import {
  WorkerSatelite, atualizarContagemEstrutural, ERROS_ESTRUTURAIS_FILA, motivoExecutorDesligado, pausaAposFalha
} from "../../src/lib/satelite/worker.js";

/**
 * SAT-03 (decisão 296) — a CONFIGURAÇÃO do executor da fila satelital, lida no startup. O risco cercado é o executor
 * LIGADO POR ENGANO (gasto no provedor sem ninguém pedir) e o limite digitado errado virando "sem limite": `1` liga,
 * `0` ou ausente desliga, qualquer outra coisa DERRUBA o startup; intervalo e limites só aceitam inteiro canônico na
 * faixa. A recusa não repete o valor. E a API sobe igual com o executor desligado — sem reservar nada.
 */
const AMBIENTE_MINIMO = { DATABASE_URL: "postgresql://exemplo-local/banco-de-exemplo" };
const startup = (env: Record<string, string> = {}) => loadConfig({ ...AMBIENTE_MINIMO, ...env });
const mensagemDe = (env: Record<string, string>) => {
  try { startup(env); } catch (e) { return e instanceof Error ? e.message : String(e); }
  throw new Error("esperava recusa no startup");
};
const INVALIDOS_INTEIRO = ["0", "1e2", "-1", "10.5", "abc", " 3", "3 ", "05", "0x2", "+3"];
const VARIAVEIS_LIMITE = ["SATELITE_LIMITE_SIMULTANEAS", "SATELITE_LIMITE_MINUTO_CONTA", "SATELITE_LIMITE_MINUTO_ORG"] as const;

describe("SATELITE_WORKER_ENABLED · leitura no startup", () => {
  it("ausente = DESLIGADO; `0` desliga; `1` liga — e só estes", () => {
    expect(startup().SATELITE_WORKER_ENABLED).toBe(false);
    expect(startup({ SATELITE_WORKER_ENABLED: "0" }).SATELITE_WORKER_ENABLED).toBe(false);
    expect(startup({ SATELITE_WORKER_ENABLED: "1" }).SATELITE_WORKER_ENABLED).toBe(true);
  });

  it("qualquer outro valor DERRUBA o startup, inclusive os que uma coerção leria como verdadeiros", () => {
    for (const valor of ["true", "2", " 1", "1 ", "false", "yes", "on", "TRUE", "", "ligado"]) {
      expect(() => startup({ SATELITE_WORKER_ENABLED: valor }), JSON.stringify(valor)).toThrow(/SATELITE_WORKER_ENABLED/);
    }
  });

  it("a recusa não repete o valor recebido", () => {
    const m = mensagemDe({ SATELITE_WORKER_ENABLED: "valor-que-nao-deve-aparecer" });
    expect(m).toContain("SATELITE_WORKER_ENABLED");
    expect(m).not.toContain("valor-que-nao-deve-aparecer");
  });
});

describe("SATELITE_WORKER_INTERVALO_S e SATELITE_LIMITE_* · inteiro canônico na faixa", () => {
  it("ausente (ou vazio) = undefined: quem usa aplica o padrão de limites.ts", () => {
    const c = startup();
    expect(c.SATELITE_WORKER_INTERVALO_S).toBeUndefined();
    for (const v of VARIAVEIS_LIMITE) expect(c[v]).toBeUndefined();
    expect(startup({ SATELITE_WORKER_INTERVALO_S: "" }).SATELITE_WORKER_INTERVALO_S).toBeUndefined();
    expect(limitesDaConfig(c)).toEqual({ ...LIMITES_SATELITE_PADRAO });
  });

  it("inteiro canônico na faixa é aceito e troca o padrão", () => {
    expect(startup({ SATELITE_WORKER_INTERVALO_S: "7" }).SATELITE_WORKER_INTERVALO_S).toBe(7);
    expect(startup({ SATELITE_WORKER_INTERVALO_S: "3600" }).SATELITE_WORKER_INTERVALO_S).toBe(3600);
    const c = startup({ SATELITE_LIMITE_SIMULTANEAS: "4", SATELITE_LIMITE_MINUTO_CONTA: "120", SATELITE_LIMITE_MINUTO_ORG: "15" });
    expect(limitesDaConfig(c)).toEqual({ simultaneas: 4, porMinutoConta: 120, porMinutoOrganizacao: 15 });
  });

  it("valor fora da forma ou da faixa DERRUBA o startup — limite digitado errado nunca vira 'sem limite'", () => {
    for (const valor of [...INVALIDOS_INTEIRO, "3601"]) {
      expect(() => startup({ SATELITE_WORKER_INTERVALO_S: valor }), `intervalo ${JSON.stringify(valor)}`).toThrow(/SATELITE_WORKER_INTERVALO_S/);
    }
    for (const v of VARIAVEIS_LIMITE) {
      for (const valor of INVALIDOS_INTEIRO) expect(() => startup({ [v]: valor }), `${v} ${JSON.stringify(valor)}`).toThrow(new RegExp(v));
    }
    expect(() => startup({ SATELITE_LIMITE_SIMULTANEAS: "1001" })).toThrow(/SATELITE_LIMITE_SIMULTANEAS/);
  });

  it("a recusa não repete o valor recebido", () => {
    for (const v of ["SATELITE_WORKER_INTERVALO_S", ...VARIAVEIS_LIMITE]) {
      for (const valor of ["1e2", "10.5", "abc", "-1", "98765x-nao-deve-aparecer"]) {
        const m = mensagemDe({ [v]: valor });
        expect(m, `${v} ${valor}`).toContain(v);
        expect(m, `${v} ${valor}`).not.toContain(valor);
      }
    }
  });
});

describe("executor · as três condições", () => {
  const cliente = (configurado: boolean) => ({ configurado });
  it("só roda com SATELITE_WORKER_ENABLED, COPERNICUS_ENABLED e credencial; o motivo diz qual falta, sem valor nenhum", () => {
    expect(motivoExecutorDesligado({ SATELITE_WORKER_ENABLED: false, COPERNICUS_ENABLED: true }, cliente(true))).toBe("SATELITE_WORKER_ENABLED desligado");
    expect(motivoExecutorDesligado({ SATELITE_WORKER_ENABLED: true, COPERNICUS_ENABLED: false }, cliente(true))).toBe("COPERNICUS_ENABLED desligado");
    expect(motivoExecutorDesligado({ SATELITE_WORKER_ENABLED: true, COPERNICUS_ENABLED: true }, cliente(false))).toBe("credencial do Copernicus ausente");
    expect(motivoExecutorDesligado({ SATELITE_WORKER_ENABLED: true, COPERNICUS_ENABLED: true }, cliente(true))).toBeNull();
  });
});

describe("executor · módulo do contexto do criador e pausa", () => {
  it("o módulo da transação do executor é 'pecuaria' — o MESMO que erp.modulo_satelite_executor() (0060)", () => {
    // Se a classificação da permissão mudar de módulo, este teste cai antes de o executor e a reserva divergirem.
    expect(PERMISSAO_EXECUTAR_ITEM).toBe("analises_satelitais.create");
    expect(MODULO_EXECUTOR).toBe("pecuaria");
  });

  it("pausa só para provedor sem serviço (429, 5xx, tempo, rede): a maior entre a pausa padrão e o Retry-After", () => {
    for (const tipo of ["limite", "indisponivel", "tempo", "rede"] as const) {
      expect(pausaAposFalha(new FalhaCopernicus(tipo, 503)), tipo).toBe(PAUSA_EXECUTOR_APOS_FALHA_DO_PROVEDOR_S);
    }
    expect(pausaAposFalha(new FalhaCopernicus("limite", 429, 600))).toBe(600);
    expect(pausaAposFalha(new FalhaCopernicus("limite", 429, 3))).toBe(PAUSA_EXECUTOR_APOS_FALHA_DO_PROVEDOR_S);
    for (const tipo of ["requisicao_recusada", "acesso_negado", "autenticacao", "resposta_malformada", "configuracao", "processamento_parcial"] as const) {
      expect(pausaAposFalha(new FalhaCopernicus(tipo, 400)), tipo).toBeNull();
    }
    expect(pausaAposFalha(new Error("erro de banco"))).toBeNull();
  });

  it("HOTFIX fail-safe: area_nao_encontrada é estrutural; limiar 2; pausa longa; sucesso zera a contagem", () => {
    expect(ERROS_ESTRUTURAIS_FILA.has(ERROS_ITEM.areaNaoEncontrada)).toBe(true);
    expect(LIMIAR_ERRO_ESTRUTURAL_CONSECUTIVO).toBe(2);
    expect(PAUSA_EXECUTOR_APOS_ERRO_ESTRUTURAL_S).toBe(3600);
    expect(atualizarContagemEstrutural(0, ERROS_ITEM.areaNaoEncontrada, "falho")).toBe(1);
    expect(atualizarContagemEstrutural(1, ERROS_ITEM.areaNaoEncontrada, "falho")).toBe(2);
    expect(atualizarContagemEstrutural(2, null, "concluido")).toBe(0);
    expect(atualizarContagemEstrutural(1, "geometria_alterada", "falho")).toBe(1);
    expect(atualizarContagemEstrutural(1, "limite (HTTP 429)", "adiado")).toBe(1);
  });
});

describe("a API sobe igual com o executor desligado", () => {
  /** Banco FALSO que conta qualquer uso: o boot da API não pode tocar nele, e o executor desligado também não. */
  function bancoQueConta() {
    const usos: string[] = [];
    const db = {
      query: async () => { usos.push("query"); throw new Error("banco falso: query no boot"); },
      connect: async () => { usos.push("connect"); throw new Error("banco falso: connect no boot"); },
      end: async () => { usos.push("end"); }
    } as unknown as Db;
    return { db, usos };
  }
  const chamadasExternas: string[] = [];
  const buscarProibido: BuscarFn = async (url) => { chamadasExternas.push(url); throw new Error("chamada externa no boot"); };
  const CREDENCIAL = { COPERNICUS_ENABLED: "1", COPERNICUS_CLIENT_ID: "id-falso-sat03", COPERNICUS_CLIENT_SECRET: "segredo-falso-sat03" };

  async function subir(env: Record<string, string>) {
    const banco = bancoQueConta();
    const app = await buildApp({ config: startup(env), db: banco.db, logger: false, buscarExterno: buscarProibido });
    await app.ready();
    return { app, banco };
  }

  it("sem a variável (e com a integração ligada e credencial): sobe, decora o cliente compartilhado, executor nulo, nada consumido", async () => {
    const { app, banco } = await subir(CREDENCIAL);
    try {
      expect(app.executorSatelite).toBeNull();
      expect(app.clienteCopernicus.configurado).toBe(true);
      await new Promise((r) => setTimeout(r, 300));
      expect(banco.usos).toEqual([]);
      expect(chamadasExternas).toEqual([]);
    } finally { await app.close(); }
  });

  it("ligado sem COPERNICUS_ENABLED, ou sem credencial: executor nulo, nada consumido", async () => {
    for (const env of [{ ...CREDENCIAL, SATELITE_WORKER_ENABLED: "1", COPERNICUS_ENABLED: "0" }, { SATELITE_WORKER_ENABLED: "1", COPERNICUS_ENABLED: "1" }]) {
      const { app, banco } = await subir(env);
      try {
        expect(app.executorSatelite).toBeNull();
        expect(banco.usos).toEqual([]);
      } finally { await app.close(); }
    }
    expect(chamadasExternas).toEqual([]);
  });

  it("com as três condições, o executor existe (o ciclo é provado contra o banco real na integração)", async () => {
    const { app, banco } = await subir({ ...CREDENCIAL, SATELITE_WORKER_ENABLED: "1", SATELITE_WORKER_INTERVALO_S: "3600" });
    try {
      expect(app.executorSatelite).toBeInstanceOf(WorkerSatelite);
      // Intervalo de 1 h: a primeira rodada nem começa durante o teste — o boot em si não toca o banco.
      expect(banco.usos).toEqual([]);
    } finally { await app.close(); }
    expect(chamadasExternas).toEqual([]);
  });
});
