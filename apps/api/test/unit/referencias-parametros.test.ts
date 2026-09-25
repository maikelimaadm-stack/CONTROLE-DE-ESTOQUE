import { describe, it, expect } from "vitest";
import { REFERENCIAS_DE_BUSCA } from "@agro/domain";
import { montarBuscaReferencia } from "../../src/routes/referencias.js";

/**
 * AJUSTES 01 · BR-1 (unidade): a causa do 500 de produção era SQL com parâmetro SOBRANDO — os dois da tabela
 * de acentos entravam sempre, e só a busca com texto os usava ("bind message supplies 2 parameters, but
 * prepared statement requires 0"). Aqui toda combinação monta o SQL e confere: cada $n usado existe, e cada
 * parâmetro enviado é usado. Não precisa de banco: o erro é de montagem, e é na montagem que se pega.
 */
const usados = (sql: string) => new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
const combinacoes = [
  { page: 1, pageSize: 30 },
  { page: 2, pageSize: 30 },
  { page: 1, pageSize: 30, search: "" },
  { page: 1, pageSize: 30, search: "   " },
  { page: 1, pageSize: 30, todos: true },
  { page: 2, pageSize: 10, todos: true },
  { page: 1, pageSize: 30, search: "sao paulo" },
  { page: 1, pageSize: 30, search: "Pontes e Lacerda - MT" },
  { page: 1, pageSize: 30, search: "5106752 · Pontes e Lacerda - MT" },
  { page: 1, pageSize: 30, search: "5106752" },
  { page: 1, pageSize: 30, search: "1" },
  { page: 1, pageSize: 30, search: "001" },
  { page: 1, pageSize: 30, search: "001 · Banco do Brasil S.A." },
  { page: 1, pageSize: 30, search: "00000000" },
  { page: 1, pageSize: 30, search: "nubank" },
  { page: 1, pageSize: 30, search: "0102.21" },
  { page: 3, pageSize: 30, search: "100%_x", todos: true }
];

describe("BR-1 montagem: nenhum parâmetro sobrando ou faltando", () => {
  for (const ref of REFERENCIAS_DE_BUSCA) {
    it(`${ref.chave}: ${combinacoes.length} combinações`, () => {
      for (const q of combinacoes) {
        const { sql, params } = montarBuscaReferencia(ref, q as Parameters<typeof montarBuscaReferencia>[1]);
        const u = usados(sql);
        const esperado = new Set(params.map((_, i) => i + 1));
        expect([...u].sort((a, b) => a - b), `${ref.chave} ${JSON.stringify(q)}: ${sql}`).toEqual([...esperado].sort((a, b) => a - b));
      }
    });
  }
});
