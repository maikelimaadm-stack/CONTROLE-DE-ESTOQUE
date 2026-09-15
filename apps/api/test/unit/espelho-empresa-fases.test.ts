import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — leitor e contrato em JS puro, compartilhados com os gates de documentação
import { readSchema } from "../../../../scripts/lib/schema.mjs";
// @ts-expect-error — idem
import { conferirEspelho, REMOCOES_DECLARADAS, conferirInvarianteDeTransferencia, INVARIANTE_TRANSFERENCIA } from "../../../../scripts/lib/espelho-empresa.mjs";

/**
 * O CONTRATO DO ESPELHO É COBRADO POR PAR HISTÓRICO (PRE-BASE2-05C-0).
 *
 * O gate anterior perguntava "o que existe agora" e exigia `espelhados > 0`. Isso deixava passar o modo de
 * falha mais provável da fatia destrutiva: a PURGA PARCIAL. Some o espelho de UMA tabela; sobram 51; a
 * contagem continua positiva; e a canônica órfã passa a ser lida como "canônica de nascença" — porque, só
 * com o presente à vista, uma coluna que NUNCA teve espelho é idêntica a uma que PERDEU o espelho.
 *
 * Um limiar mais apertado não resolveria (51 também é `> 0`). O que resolve é a história: cada par que
 * existiu na ponte física é cobrado individualmente. Estes casos provam a REGRA, com migrations de mentira
 * — amarrá-los ao conteúdo real de `supabase/migrations` faria o teste mudar de significado a cada fatia
 * que mexesse no schema, e é justamente na fatia que mexe no schema que ele precisa valer.
 *
 * O caso A2 é o bug auditado. Repare que ele monta DOIS pares e derruba só um: se a asserção fosse por
 * contagem, ele passaria.
 */
let dir: string;
const escrever = (nome: string, sql: string) => fs.writeFileSync(path.join(dir, nome), sql, "utf8");
const limpar = () => { for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f)); };

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "espelho-fases-")); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

interface Resultado { problemas: string[]; paresHistoricos: number; canonicasDeNascenca: number; legadasVivas: number }
const conferir = (fase: "dual" | "canonica"): Resultado => conferirEspelho(readSchema(dir), fase) as Resultado;

/** Duas tabelas com o par completo — o acervo "saudável" sobre o qual cada sabotagem é aplicada. */
const PONTE = `create table erp.a (id uuid primary key, organization_id uuid not null, empresa_id uuid not null, farm_id uuid not null);
create table erp.b (id uuid primary key, organization_id uuid not null, empresa_id uuid, farm_id uuid);`;

describe("fase dual — as duas grafias convivem", () => {
  it("A1 · par histórico completo nas duas tabelas: PASSA", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    const r = conferir("dual");
    expect(r.problemas).toEqual([]);
    expect(r.paresHistoricos, "os dois pares foram contados").toBe(2);
    expect(r.legadasVivas).toBe(2);
  });

  it("A2 · UMA legada histórica desaparece e a outra fica: REPROVA — este é o bug auditado", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    escrever("0002_purga_parcial.sql", "alter table erp.b drop column farm_id;");
    const r = conferir("dual");
    expect(r.problemas.join(" | "), "a purga parcial é nomeada, com a tabela").toMatch(/erp\.b\.farm_id.*PURGA PARCIAL/s);
    // A prova de que a asserção NÃO é por contagem: o par sobrevivente mantém o total positivo, e é
    // exatamente por isso que o gate antigo ficava verde.
    expect(r.legadasVivas, "sobrou espelho vivo — contagem global continuaria satisfeita").toBe(1);
    expect(r.paresHistoricos, "a tabela purgada continua sendo um par histórico, não vira canônica de nascença").toBe(2);
    expect(r.canonicasDeNascenca, "e não foi reclassificada").toBe(0);
  });

  it("A3 · a canônica de um par histórico desaparece: REPROVA", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    escrever("0002_erro.sql", "alter table erp.b drop column empresa_id;");
    expect(conferir("dual").problemas.join(" | ")).toMatch(/erp\.b\.empresa_id.*DESAPARECEU/s);
  });

  it("A4 · as DUAS colunas de um par histórico desaparecem: REPROVA", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    escrever("0002_erro.sql", "alter table erp.b drop column empresa_id;\nalter table erp.b drop column farm_id;");
    const r = conferir("dual");
    expect(r.problemas.length, "o par não some do radar por ter perdido as duas pontas").toBeGreaterThan(0);
    expect(r.paresHistoricos).toBe(2);
  });

  it("A9 · purga COMPLETA sem virar a fase: REPROVA", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    escrever("0002_purga.sql", "alter table erp.a drop column farm_id;\nalter table erp.b drop column farm_id;");
    expect(conferir("dual").problemas.join(" | ")).toMatch(/NENHUM espelho legado sobreviveu/);
  });
});

describe("fase canonica — o nome antigo não existe mais", () => {
  it("A5 · purga completa com a fase virada: PASSA", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    escrever("0002_purga.sql", "alter table erp.a drop column farm_id;\nalter table erp.b drop column farm_id;");
    const r = conferir("canonica");
    expect(r.problemas).toEqual([]);
    // A história sobrevive à purga: os pares continuam sendo cobrados, agora pelo outro lado.
    expect(r.paresHistoricos, "o gate continua tendo o que medir depois da remoção").toBe(2);
    expect(r.legadasVivas).toBe(0);
  });

  it("A6 · UMA legada sobrevive à purga: REPROVA", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    escrever("0002_purga.sql", "alter table erp.a drop column farm_id;");
    expect(conferir("canonica").problemas.join(" | ")).toMatch(/erp\.b\.farm_id sobreviveu à purga/);
  });

  it("A7 · a canônica histórica é removida junto com a legada: REPROVA", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    escrever("0002_purga.sql", [
      "alter table erp.a drop column farm_id;",
      "alter table erp.b drop column farm_id;",
      "alter table erp.b drop column empresa_id;"
    ].join("\n"));
    expect(conferir("canonica").problemas.join(" | ")).toMatch(/erp\.b\.empresa_id.*DESAPARECEU/s);
  });

  it("A10 · virar a fase sem purgar: REPROVA", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    const p = conferir("canonica").problemas.join(" | ");
    expect(p).toMatch(/erp\.a\.farm_id sobreviveu/);
    expect(p).toMatch(/erp\.b\.farm_id sobreviveu/);
  });
});

describe("canônica de nascença — nunca teve espelho", () => {
  it("A8 · não vira falso positivo em NENHUMA das duas fases", () => {
    limpar();
    escrever("0001_base.sql", `${PONTE}
create table erp.nasceu_canonica (id uuid primary key, organization_id uuid not null, empresa_id uuid not null);`);
    for (const fase of ["dual", "canonica"] as const) {
      const r = conferir(fase);
      expect(r.canonicasDeNascenca, `contada como de nascença (${fase})`).toBe(1);
      expect(r.paresHistoricos, `e NÃO inflou os pares históricos (${fase})`).toBe(2);
      expect(r.problemas.filter((x) => x.includes("nasceu_canonica")), `sem reclamação sobre ela (${fase})`).toEqual([]);
    }
  });

  it("mas some-la é perda igual: REPROVA nas duas fases", () => {
    limpar();
    escrever("0001_base.sql", `${PONTE}
create table erp.nasceu_canonica (id uuid primary key, organization_id uuid not null, empresa_id uuid not null);`);
    escrever("0002_erro.sql", "alter table erp.nasceu_canonica drop column empresa_id;");
    for (const fase of ["dual", "canonica"] as const) {
      expect(conferir(fase).problemas.join(" | "), fase).toMatch(/nasceu_canonica\.empresa_id nasceu canônica e DESAPARECEU/);
    }
  });
});

/**
 * A TABELA INTEIRA É O MESMO PECADO UM DEGRAU ACIMA.
 *
 * Dropar uma tabela com coluna de empresa derruba o total de pares e não deixa rastro nenhum no presente:
 * a tabela simplesmente não está mais lá. Um gate que olhasse só a contagem veria 51 onde havia 52 e não
 * teria o que reclamar — exatamente a purga parcial, com outro objeto. A lápide que o leitor guarda é o que
 * permite NOMEAR a tabela que sumiu; e a remoção consciente (houve uma, na 0014) se declara com o destino
 * do dado, em vez de abrir uma exceção genérica.
 */
describe("remoção de TABELA com coluna de empresa", () => {
  it("dropar a tabela sem declarar: REPROVA nas duas fases, nomeando a tabela", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    escrever("0002_drop.sql", "drop table erp.b;");
    for (const fase of ["dual", "canonica"] as const) {
      expect(conferir(fase).problemas.join(" | "), fase).toMatch(/erp\.b tinha coluna de empresa.*tabela INTEIRA foi removida/s);
    }
  });

  it("e a contagem NÃO delata sozinha — sobra par histórico, como na purga parcial", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    escrever("0002_drop.sql", "drop table erp.b;");
    expect(conferir("dual").paresHistoricos, "o total continua positivo: um limiar global ficaria satisfeito").toBe(1);
  });

  it("tabela SEM coluna de empresa pode ser removida à vontade", () => {
    limpar();
    escrever("0001_base.sql", `${PONTE}\ncreate table erp.solta (id uuid primary key, nome text);`);
    escrever("0002_drop.sql", "drop table erp.solta;");
    expect(conferir("dual").problemas).toEqual([]);
  });

  it("a remoção DECLARADA da 0014 não reprova o schema real — e é a única declarada", () => {
    expect(Object.keys(REMOCOES_DECLARADAS)).toEqual(["erp.member_farms"]);
    expect((REMOCOES_DECLARADAS as Record<string, string>)["erp.member_farms"], "a declaração diz para ONDE o dado foi").toMatch(/legado_escopo_empresa_v0/);
  });
});

/**
 * A PROVA DE QUE ESTES TESTES PROVAM ALGUMA COISA. Um contrato que não encontrasse par histórico nenhum
 * passaria todos os casos acima por vacuidade — o laço não executaria asserção alguma.
 */
describe("premissa", () => {
  it("schema sem nenhuma coluna de empresa REPROVA em vez de imprimir OK", () => {
    limpar();
    escrever("0001_nada.sql", "create table erp.sem_empresa (id uuid primary key, nome text);");
    for (const fase of ["dual", "canonica"] as const) {
      expect(conferir(fase).problemas.join(" | "), fase).toMatch(/nenhum par histórico encontrado/);
    }
  });

  it("fase inválida REPROVA — não cai num padrão", () => {
    limpar();
    escrever("0001_ponte.sql", PONTE);
    expect((conferirEspelho(readSchema(dir), "quase") as Resultado).problemas.join(" | ")).toMatch(/fase inválida/);
  });
});

/**
 * A INVARIANTE DE TRANSFERÊNCIA, COBRADA POR FASE (PRE-BASE2-05C-G1).
 *
 * `erp.equipment_transfers` tem, desde a 0005, um CHECK anônimo negando origem = destino. Medido em banco
 * descartável: o `drop column` da 05C-1 leva esse CHECK junto, sem erro, sem aviso e sem `cascade` — a
 * migration termina verde e a regra de negócio evapora. Aqui se prova a REGRA (função pura, sem banco);
 * quem a aplica contra o `pg_constraint` vivo é `apps/api/test/integration/rls-matriz.test.ts`.
 */
describe("invariante origem ≠ destino por fase", () => {
  // As grafias saem do SSOT, não de literais: assim o caso mede o CONTRATO e não uma cópia dele — e o
  // inventário de dívida não conta como ocorrência nova o nome que este arquivo existe para vigiar.
  const [LEG_O, LEG_D] = INVARIANTE_TRANSFERENCIA.colunasPorFase.dual as [string, string];
  const [CAN_O, CAN_D] = INVARIANTE_TRANSFERENCIA.colunasPorFase.canonica as [string, string];
  const LEGADO = { nome: "equipment_transfers_check", definicao: `CHECK ((${LEG_O} <> ${LEG_D}))`, validado: true };
  const CANONICO = { nome: "equipment_transfers_empresas_check", definicao: `CHECK ((${CAN_O} <> ${CAN_D}))`, validado: true };

  it("fase dual: o CHECK legado satisfaz", () => {
    expect(conferirInvarianteDeTransferencia("dual", [LEGADO])).toEqual([]);
  });

  it("fase dual: a ordem das pontas é indiferente, a coluna não", () => {
    expect(conferirInvarianteDeTransferencia("dual", [{ ...LEGADO, definicao: `CHECK ((${LEG_D} <> ${LEG_O}))` }])).toEqual([]);
    expect(conferirInvarianteDeTransferencia("dual", [{ ...LEGADO, definicao: "CHECK ((origin_warehouse_id <> destination_warehouse_id))" }]).join(" | ")).toMatch(/exige um CHECK VALIDADO negando/);
  });

  it("as três grafias corretas da mesma regra são aceitas — inclusive a mais forte", () => {
    for (const d of [`CHECK ((NOT (${LEG_O} = ${LEG_D})))`, `CHECK ((${LEG_O} IS DISTINCT FROM ${LEG_D}))`, `check(("${LEG_O}")<>("${LEG_D}"))`]) {
      expect(conferirInvarianteDeTransferencia("dual", [{ ...LEGADO, definicao: d }]), d).toEqual([]);
    }
  });

  /**
   * O ataque que derrubou a primeira versão deste guarda: ela testava SUBSTRING, então qualquer
   * predicado que CONTIVESSE a desigualdade passava — `NOT (a <> b)`, que afirma o CONTRÁRIO da
   * invariante, inclusive. É a mesma família de falha que a decisão 116 fechou para políticas.
   */
  it("predicado que apenas CONTÉM a desigualdade é RECUSADO — inclusive o que a nega", () => {
    const neutralizados = [
      `CHECK (((${LEG_O} <> ${LEG_D}) OR (note IS NOT NULL)))`,
      `CHECK ((true OR (${LEG_O} <> ${LEG_D})))`,
      `CHECK ((NOT (${LEG_O} <> ${LEG_D})))`,
      `CHECK (((1 = 0) AND (${LEG_O} <> ${LEG_D})))`,
      `CHECK ((note <> '${LEG_O} <> ${LEG_D}'::text))`,
      `CHECK ((${LEG_O} IS NULL OR ${LEG_D} IS NULL OR ${LEG_O} <> ${LEG_D}))`
    ];
    for (const d of neutralizados) {
      expect(conferirInvarianteDeTransferencia("dual", [{ ...LEGADO, definicao: d }]), d).not.toEqual([]);
    }
  });

  it("um CHECK válido que casa basta, mesmo com outro NOT VALID ao lado", () => {
    expect(conferirInvarianteDeTransferencia("dual", [LEGADO, { nome: "rascunho", definicao: LEGADO.definicao, validado: false }])).toEqual([]);
  });

  it("validado AUSENTE não conta como validado — o default é fail-closed", () => {
    for (const v of [undefined, null, "f"]) {
      expect(conferirInvarianteDeTransferencia("dual", [{ nome: "x", definicao: LEGADO.definicao, validado: v as never }]), String(v)).not.toEqual([]);
    }
  });

  /**
   * `INVARIANTE_TRANSFERENCIA.origem` aponta para a linha da migration que criou o CHECK. Sem esta
   * asserção o ponteiro é uma segunda lista que envelhece em silêncio: o arquivo muda, o texto fica.
   */
  it("o ponteiro para a migration de origem ainda descreve o que está lá", () => {
    const [arquivo, linha] = INVARIANTE_TRANSFERENCIA.origem.split(":");
    const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
    const conteudo = fs.readFileSync(path.join(raiz, arquivo!), "utf8").split("\n");
    const [o, d] = INVARIANTE_TRANSFERENCIA.colunasPorFase.dual as [string, string];
    expect(conteudo[Number(linha) - 1], `${INVARIANTE_TRANSFERENCIA.origem} deveria conter a desigualdade`).toMatch(new RegExp(`${o}\\s*<>\\s*${d}`));
  });

  it("fase dual SEM CHECK nenhum REPROVA — é o que o `drop column` produz em silêncio", () => {
    expect(conferirInvarianteDeTransferencia("dual", []).join(" | ")).toMatch(/drop column. derruba o CHECK legado EM SIL/);
  });

  it("fase canonica exige o substituto sobre as colunas canônicas", () => {
    expect(conferirInvarianteDeTransferencia("canonica", [CANONICO])).toEqual([]);
    // Purgar sem criar o substituto é exatamente o cenário que a 05C-1 não pode produzir.
    expect(conferirInvarianteDeTransferencia("canonica", []).length).toBe(1);
  });

  it("fase canonica com o CHECK LEGADO ainda vivo REPROVA nos dois flancos", () => {
    const p = conferirInvarianteDeTransferencia("canonica", [LEGADO]).join(" | ");
    expect(p).toMatch(/exige um CHECK VALIDADO negando a igualdade entre empresa_origem_id e empresa_destino_id/);
    expect(p).toMatch(new RegExp(`ainda existe CHECK sobre ${LEG_O}`));
  });

  it("CHECK NOT VALID sozinho não conta como invariante — existir não é valer", () => {
    expect(conferirInvarianteDeTransferencia("dual", [{ ...LEGADO, validado: false }]).join(" | ")).toMatch(/nenhum validado/);
  });

  it("fase inválida NEGA — não cai na vizinha", () => {
    expect(conferirInvarianteDeTransferencia("quase", [LEGADO]).join(" | ")).toMatch(/fase inválida/);
  });
});
