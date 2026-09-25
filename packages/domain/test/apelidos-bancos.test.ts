import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { APELIDOS_DE_BANCO, bancosPorApelido, normalizarApelido } from "../src/resources/apelidos-bancos.js";

// A carga oficial de bancos está na 0026: a tabela de apelidos só pode apontar para código que existe lá,
// e o nome oficial carregado tem de conter o nome esperado (sem caixa/acento).
const migrations = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");
const arquivo = readdirSync(migrations).find((f) => f.startsWith("0026_"))!;
const sql = readFileSync(join(migrations, arquivo), "utf8");
const bancos = new Map([...sql.matchAll(/\('(\d{3})','\d{8}','((?:[^']|'')*)'\)/g)].map((m) => [m[1]!, m[2]!.replace(/''/g, "'")]));

describe("A-3 apelidos de banco conferidos contra a 0026", () => {
  it("premissa: a carga da 0026 foi lida", () => expect(bancos.size).toBeGreaterThan(100));
  it.each(APELIDOS_DE_BANCO.map((a) => [a.codigo, a]))("%s existe na 0026 e o nome bate", (_c, a) => {
    expect(bancos.has(a.codigo), `código ${a.codigo} na 0026`).toBe(true);
    expect(normalizarApelido(bancos.get(a.codigo)!)).toContain(a.nome);
  });
  it("apelidos pedidos pela missão resolvem para o código certo", () => {
    const esperado: Record<string, string> = { bb: "001", "banco do brasil": "001", caixa: "104", cef: "104", bradesco: "237", itau: "341", "itaú": "341", santander: "033",
      nubank: "260", nu: "260", inter: "077", c6: "336", sicredi: "748", sicoob: "756", original: "212", btg: "208", banrisul: "041", safra: "422",
      "mercado pago": "323", pagbank: "290", pagseguro: "290", picpay: "380", brb: "070", bnb: "004", "banco do nordeste": "004", unicred: "136",
      ailos: "085", cora: "403", stone: "197", bv: "655", votorantim: "655" };
    for (const [t, c] of Object.entries(esperado)) expect(bancosPorApelido(t), t).toContain(c);
  });
  it("texto curto só casa exato; prefixo a partir de 3 letras; vazio não casa", () => {
    expect(bancosPorApelido("n")).toEqual([]);
    expect(bancosPorApelido("merc")).toEqual(["323"]);
    expect(bancosPorApelido("  ")).toEqual([]);
    expect(bancosPorApelido("NUBANK")).toEqual(["260"]);
  });
});
