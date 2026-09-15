import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — parser de migrations em JS puro, compartilhado com os gates de documentação
import { readSchema } from "../../../../scripts/lib/schema.mjs";

/**
 * O LEITOR DE MIGRATIONS PRECISA ENXERGAR REMOÇÃO (PRE-BASE2-05C-0).
 *
 * `scripts/lib/schema.mjs` é a fonte técnica do dicionário de dados, do `company-schema-sync`, da matriz de
 * RLS e do inventário de dependência. Enquanto o repositório só teve migrations ADITIVAS, um leitor cego a
 * `drop column` acertava por acidente: nada era removido, então "tudo que foi criado ainda existe" era
 * verdade.
 *
 * A PRE-BASE2-05C-1 remove 52 colunas. Sem este suporte, os quatro instrumentos acima continuariam
 * afirmando que a coluna legada existe — e VERDES. É o pior modo de falha possível: não é um gate que
 * quebra, é um gate que mente com confiança. Por isso o suporte nasce AQUI, uma fatia ANTES da migration
 * que o exige, com a prova junto.
 *
 * Os casos usam migrations de MENTIRA num diretório temporário, não as reais: o que se prova é a GRAMÁTICA
 * do leitor, e amarrá-la ao conteúdo de `supabase/migrations` faria o teste mudar de significado a cada
 * fatia que mexesse no schema de verdade.
 */
let dir: string;
const escrever = (nome: string, sql: string) => fs.writeFileSync(path.join(dir, nome), sql, "utf8");
const limpar = () => { for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f)); };

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-reader-")); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const colunas = (tabela: string) => {
  const t = readSchema(dir).get(tabela) as { columns: Map<string, unknown> } | undefined;
  return t ? [...t.columns.keys()] : null;
};

describe("leitor de migrations — criação e adição (o que já funcionava, preso por teste)", () => {
  it("create table registra as colunas declaradas", () => {
    limpar();
    escrever("0001_base.sql", `create table erp.exemplo (
      id uuid primary key,
      organization_id uuid not null,
      legado_id uuid
    );`);
    expect(colunas("erp.exemplo")).toEqual(["id", "organization_id", "legado_id"]);
  });

  it("add column acrescenta no arquivo seguinte", () => {
    limpar();
    escrever("0001_base.sql", "create table erp.exemplo (id uuid primary key, legado_id uuid);");
    escrever("0002_add.sql", "alter table erp.exemplo add column empresa_id uuid;");
    expect(colunas("erp.exemplo")).toContain("empresa_id");
  });
});

describe("leitor de migrations — REMOÇÃO (PRE-BASE2-05C-0)", () => {
  it("drop column faz a coluna deixar de existir", () => {
    limpar();
    escrever("0001_base.sql", "create table erp.exemplo (id uuid primary key, legado_id uuid, empresa_id uuid);");
    escrever("0002_purga.sql", "alter table erp.exemplo drop column legado_id;");
    const c = colunas("erp.exemplo");
    expect(c, "a coluna legada some").not.toContain("legado_id");
    expect(c, "a canônica fica").toContain("empresa_id");
  });

  it("aceita `if exists`, `cascade` e várias remoções na mesma instrução", () => {
    limpar();
    escrever("0001_base.sql", "create table erp.exemplo (id uuid primary key, a uuid, b uuid, c uuid, d uuid);");
    escrever("0002_purga.sql", [
      "alter table erp.exemplo drop column if exists a;",
      "alter table erp.exemplo drop column b cascade;",
      "alter table erp.exemplo drop column c, drop column d;"
    ].join("\n"));
    expect(colunas("erp.exemplo")).toEqual(["id"]);
  });

  it("drop de coluna que não existe não derruba o leitor nem apaga outra", () => {
    limpar();
    escrever("0001_base.sql", "create table erp.exemplo (id uuid primary key, empresa_id uuid);");
    escrever("0002_purga.sql", "alter table erp.exemplo drop column if exists legado_id;");
    expect(colunas("erp.exemplo")).toEqual(["id", "empresa_id"]);
  });

  it("a constraint de tabela que citava a coluna removida sai junto — como o PostgreSQL faz", () => {
    limpar();
    escrever("0001_base.sql", `create table erp.exemplo (
      id uuid primary key,
      organization_id uuid not null,
      legado_id uuid,
      empresa_id uuid,
      foreign key (organization_id, legado_id) references erp.empresas(organization_id, id),
      foreign key (organization_id, empresa_id) references erp.empresas(organization_id, id)
    );`);
    escrever("0002_purga.sql", "alter table erp.exemplo drop column legado_id;");
    const t = readSchema(dir).get("erp.exemplo") as { constraints: string[] };
    expect(t.constraints.some((c) => /legado_id/.test(c)), "a FK legada não sobrevive à coluna").toBe(false);
    expect(t.constraints.some((c) => /empresa_id/.test(c)), "a FK canônica permanece").toBe(true);
  });

  it("drop seguido de re-add no MESMO arquivo respeita a ORDEM do texto", () => {
    limpar();
    escrever("0001_base.sql", "create table erp.exemplo (id uuid primary key, x uuid);");
    escrever("0002_ordem.sql", [
      "alter table erp.exemplo drop column x;",
      "alter table erp.exemplo add column x text;"
    ].join("\n"));
    const t = readSchema(dir).get("erp.exemplo") as { columns: Map<string, { type: string }> };
    expect(t.columns.has("x"), "removida e recriada: existe no fim").toBe(true);
    expect(t.columns.get("x")!.type, "e é a definição NOVA, não a antiga").toBe("text");
  });

  it("re-add seguido de drop no MESMO arquivo também respeita a ordem (o inverso do caso acima)", () => {
    limpar();
    escrever("0001_base.sql", "create table erp.exemplo (id uuid primary key);");
    escrever("0002_ordem.sql", [
      "alter table erp.exemplo add column x text;",
      "alter table erp.exemplo drop column x;"
    ].join("\n"));
    expect(colunas("erp.exemplo")).toEqual(["id"]);
  });

  it("rename da tabela + drop pelo nome NOVO aplica na tabela certa", () => {
    limpar();
    escrever("0001_base.sql", "create table erp.antiga (id uuid primary key, legado_id uuid, empresa_id uuid);");
    escrever("0002_rename.sql", "alter table erp.antiga rename to nova;");
    escrever("0003_purga.sql", "alter table erp.nova drop column legado_id;");
    const mapa = readSchema(dir);
    expect(mapa.has("erp.antiga"), "o nome antigo não sobrevive").toBe(false);
    expect(colunas("erp.nova")).toEqual(["id", "empresa_id"]);
  });

  it("drop pelo nome ANTIGO depois do rename não apaga nada — e não inventa tabela", () => {
    limpar();
    escrever("0001_base.sql", "create table erp.antiga (id uuid primary key, legado_id uuid);");
    escrever("0002_rename.sql", "alter table erp.antiga rename to nova;");
    escrever("0003_engano.sql", "alter table erp.nova drop column legado_id;\nalter table erp.antiga drop column id;");
    const mapa = readSchema(dir);
    expect(mapa.has("erp.antiga")).toBe(false);
    expect(colunas("erp.nova"), "o drop no nome antigo é inócuo, não destrutivo").toEqual(["id"]);
  });
});

/**
 * A PROVA DE QUE ESTE TESTE PROVA ALGUMA COISA.
 *
 * Um teste de parser passa por engano com facilidade: basta o arquivo de migration não casar com a regex e
 * tudo "funciona" porque nada foi lido. Este caso fecha essa porta pelo outro lado — se o leitor voltasse a
 * ignorar `drop column`, a coluna continuaria presente e a asserção acima falharia; aqui se confirma que o
 * leitor está de fato LENDO o arquivo (a tabela existe e tem o resto das colunas), e não devolvendo vazio.
 */
describe("premissa do teste", () => {
  it("o diretório temporário é lido de verdade: a tabela existe e as demais colunas continuam lá", () => {
    limpar();
    escrever("0001_base.sql", "create table erp.exemplo (id uuid primary key, a uuid, legado_id uuid);");
    escrever("0002_purga.sql", "alter table erp.exemplo drop column legado_id;");
    const mapa = readSchema(dir);
    expect(mapa.size, "o leitor encontrou a migration de mentira").toBeGreaterThan(0);
    expect(colunas("erp.exemplo")).toEqual(["id", "a"]);
  });
});
