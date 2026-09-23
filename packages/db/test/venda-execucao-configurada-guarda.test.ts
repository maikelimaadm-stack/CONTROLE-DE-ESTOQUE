import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O QUE A 0023 PROMETEU, PROVADO CONTRA O BANCO (TOP-CONFIG-04A).
 *
 * A promessa: uma venda cuja versão congelada declara execução configurada NUNCA é confirmada por um
 * binário que não a executa. "Um binário que não a executa" é modelado aqui exatamente como ele é na
 * vida real: uma transação do papel da aplicação (`erp_app_test`, sem bypass de RLS) que move o status
 * para `confirmed` SEM gravar a marca `app.venda_execucao_configurada` — que é o que o binário anterior
 * à TOP-CONFIG-04A faz, porque ele não sabe que a marca existe.
 *
 * E a contraprova, sem a qual o gatilho poderia estar recusando TUDO: o acervo (sem TOP), o formato 1 e
 * o formato 2 todo em legado confirmam como sempre, sem marca nenhuma.
 */
let db: Db; let app: Db; let demo: DemoOrg;
beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

const SECOES = {
  geral: { confirmacao: "manual", exigeParceiro: false, exigeCentroResultado: false, exigeObservacao: false, alteracaoAposConfirmacao: "bloqueada", documentoSemItens: "proibido" },
  estoque: { atualizacao: "saida", momento: "confirmacao", exigeArmazem: false, saldoNegativo: "bloquear" },
  financeiro: { atualizacao: "receber", modo: "incluir", momento: "confirmacao", exigeFormaPagamento: false, exigeVencimento: false, exigeCentroResultado: false },
  fiscal: { habilitado: false, exigeDocumentoFiscal: false, exigeNaturezaOperacao: false, exigeRegraTributaria: false, calculoTributario: "nao_aplicar" },
  aprovacao: { politica: "nenhuma", valorMinimo: null, momento: "antes_da_confirmacao" },
};
const formato1 = () => ({ versaoSchema: 1, ...SECOES });
const formato2 = (estoque: string, financeiro: string) => ({ versaoSchema: 2, ...SECOES, execucao: { estoque, financeiro } });

let seq = 0;
/** TOP + versão 1 com a configuração pedida, como o superusuário de migração (monta cenário). */
async function versaoCom(configuracao: Record<string, unknown>): Promise<{ topId: string; versaoId: string }> {
  seq += 1;
  const codigo = `G23${String(seq).padStart(2, "0")}`;
  return withTx(db, { orgId: demo.orgId, userId: demo.adminUserId, modulo: null }, async (tx) => {
    const p = await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao (organization_id, codigo, codigo_base, criado_por) values ($1,$2,'vendas.venda',$3) returning id`,
      [demo.orgId, codigo, demo.adminUserId]);
    const v = await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, criado_por, configuracao, configuracao_schema_version)
       values ($1,$2,1,$3,$4,$5::jsonb,$6) returning id`,
      [demo.orgId, p.rows[0]!.id, `Guarda ${codigo}`, demo.adminUserId, JSON.stringify(configuracao), configuracao.versaoSchema]);
    return { topId: p.rows[0]!.id, versaoId: v.rows[0]!.id };
  });
}

async function venda(top: { topId: string; versaoId: string } | null): Promise<string> {
  seq += 1;
  const empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  const cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client limit 1", [demo.orgId])).rows[0]!.id;
  const r = await db.query<{ id: string }>(
    `insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, tipo_operacao_id, tipo_operacao_versao_id)
     values ($1,$2,'sale',$3,'2026-09-01',$4,$5,$6) returning id`,
    [demo.orgId, empresa, `G23-${seq}`, cliente, top?.topId ?? null, top?.versaoId ?? null]);
  return r.rows[0]!.id;
}

/** Move o status como o PAPEL DA APLICAÇÃO move, com ou sem a marca da execução configurada. */
async function moverComoApp(id: string, status: string, marca: string | null): Promise<void> {
  await withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "vendas" }, async (tx) => {
    if (marca !== null) await tx.query("select set_config('app.venda_execucao_configurada', $1, true)", [marca]);
    const u = await tx.query("update erp.sales_documents set status=$3 where id=$1 and organization_id=$2", [id, demo.orgId, status]);
    // A premissa: a linha é visível e atualizável para o papel. Sem isto, "passou" poderia ser zero linha.
    expect(u.rowCount, "a venda precisa ser visível para o papel da aplicação").toBe(1);
  });
}
/** Confirma como o PAPEL DA APLICAÇÃO confirma, com ou sem a marca da execução configurada. */
const confirmarComoApp = (id: string, marca: string | null) => moverComoApp(id, "confirmed", marca);

const statusDe = async (id: string) => (await db.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!.status;

describe("0023 — o gatilho existe e está ligado", () => {
  it("G1 um gatilho, habilitado, só no UPDATE de status, com search_path fixo na função", async () => {
    const t = await db.query<{ tgenabled: string; def: string }>(
      `select t.tgenabled, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid=t.tgrelid
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='erp' and c.relname='sales_documents' and t.tgname='trg_sales_documents_execucao_configurada'`);
    expect(t.rowCount).toBe(1);
    expect(t.rows[0]!.tgenabled).toBe("O");
    expect(t.rows[0]!.def).toContain("BEFORE UPDATE OF status");
    const f = await db.query<{ proconfig: string[] | null; prosecdef: boolean }>(
      "select proconfig, prosecdef from pg_proc where proname='venda_execucao_configurada_guarda'");
    expect(f.rows[0]!.prosecdef, "INVOKER: lê a versão com a RLS de quem confirma").toBe(false);
    expect(f.rows[0]!.proconfig?.join(",")).toContain("search_path");
  });
});

describe("0023 — o binário que não executa a configuração NÃO confirma a venda configurada", () => {
  it("G2 estoque configurado, sem a marca: recusa com um código que o binário anterior conhece, e o status não muda", async () => {
    const id = await venda(await versaoCom(formato2("configurada", "legado")));
    await expect(confirmarComoApp(id, null)).rejects.toThrow(/^TIPO_OPERACAO_INDISPONIVEL: /);
    expect(await statusDe(id)).toBe("open");
  });

  it("G3 financeiro configurado, sem a marca: também recusa", async () => {
    const id = await venda(await versaoCom(formato2("legado", "configurada")));
    await expect(confirmarComoApp(id, null)).rejects.toThrow(/TIPO_OPERACAO_INDISPONIVEL/);
    expect(await statusDe(id)).toBe("open");
  });

  it("G4 a marca de OUTRA venda não serve: ela é amarrada ao id", async () => {
    const outra = await venda(null);
    const id = await venda(await versaoCom(formato2("configurada", "configurada")));
    await expect(confirmarComoApp(id, outra)).rejects.toThrow(/TIPO_OPERACAO_INDISPONIVEL/);
    expect(await statusDe(id)).toBe("open");
  });

  it("G5 formato que o banco ainda não conhece exige a marca (fail-closed)", async () => {
    const id = await venda(await versaoCom({ ...formato2("legado", "legado"), versaoSchema: 3 }));
    await expect(confirmarComoApp(id, null)).rejects.toThrow(/TIPO_OPERACAO_INDISPONIVEL/);
    expect(await statusDe(id)).toBe("open");
  });

  it("G6 com a marca desta venda, a confirmação passa — é o caminho do binário da TOP-CONFIG-04A", async () => {
    const id = await venda(await versaoCom(formato2("configurada", "configurada")));
    await confirmarComoApp(id, id);
    expect(await statusDe(id)).toBe("confirmed");
  });
});

describe("0023 — o legado confirma como sempre, sem marca nenhuma (contraprova)", () => {
  it("G7 sem TOP, formato 1 (mesmo declarando saída e contas a receber) e formato 2 todo em legado", async () => {
    const casos = [
      await venda(null),
      await venda(await versaoCom(formato1())),
      await venda(await versaoCom(formato2("legado", "legado"))),
    ];
    for (const id of casos) {
      await confirmarComoApp(id, null);
      expect(await statusDe(id)).toBe("confirmed");
    }
  });

  it("G8 o gatilho só olha a ENTRADA no estado pós-confirmação: cancelar e editar outra coluna de uma venda configurada passam", async () => {
    const id = await venda(await versaoCom(formato2("configurada", "configurada")));
    await withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: "vendas" }, async (tx) => {
      expect((await tx.query("update erp.sales_documents set note='x' where id=$1", [id])).rowCount).toBe(1);
      expect((await tx.query("update erp.sales_documents set status='cancelled' where id=$1", [id])).rowCount).toBe(1);
    });
    expect(await statusDe(id)).toBe("cancelled");
  });
});

/**
 * SÓ A ENTRADA NO ESTADO PÓS-CONFIRMAÇÃO É GUARDADA (revisão R1). É na entrada que os efeitos acontecem;
 * faturar uma venda JÁ confirmada não executa estoque nem financeiro de novo, e exigir a marca ali quebraria
 * a primeira fatia fiscal — que não tem por que conhecer a marca da execução configurada.
 */
describe("0023 — só a ENTRADA em confirmada/faturada é guardada; o faturamento de uma venda já confirmada passa", () => {
  it("G9 confirmada → faturada, SEM a marca, passa para a venda configurada", async () => {
    const id = await venda(await versaoCom(formato2("configurada", "configurada")));
    await confirmarComoApp(id, id);
    expect(await statusDe(id), "premissa: confirmada pelo caminho da TOP-CONFIG-04A").toBe("confirmed");
    await moverComoApp(id, "invoiced", null);
    expect(await statusDe(id)).toBe("invoiced");
  });

  it("G10 aberta → faturada DIRETO, sem a marca, é recusada: o salto não contorna a guarda", async () => {
    const id = await venda(await versaoCom(formato2("configurada", "legado")));
    await expect(moverComoApp(id, "invoiced", null)).rejects.toThrow(/^TIPO_OPERACAO_INDISPONIVEL: /);
    expect(await statusDe(id)).toBe("open");
    // A contraprova: com a marca DESTA venda, o mesmo salto passa — a recusa era a falta da marca.
    await moverComoApp(id, "invoiced", id);
    expect(await statusDe(id)).toBe("invoiced");
  });

  it("G11 aprovada → confirmada, sem a marca, é recusada: aprovada é estado ANTERIOR à confirmação", async () => {
    const id = await venda(await versaoCom(formato2("legado", "configurada")));
    await moverComoApp(id, "approved", null);
    expect(await statusDe(id), "premissa: sair de aberta para aprovada não dispara").toBe("approved");
    await expect(confirmarComoApp(id, null)).rejects.toThrow(/TIPO_OPERACAO_INDISPONIVEL/);
    expect(await statusDe(id)).toBe("approved");
  });

  it("G12 cancelada → confirmada, sem a marca, é recusada: ressuscitar a venda não contorna a guarda", async () => {
    const id = await venda(await versaoCom(formato2("configurada", "configurada")));
    await moverComoApp(id, "cancelled", null);
    await expect(confirmarComoApp(id, null)).rejects.toThrow(/TIPO_OPERACAO_INDISPONIVEL/);
    expect(await statusDe(id)).toBe("cancelled");
  });

  it("G13 sair do estado pós-confirmação não dispara: faturada → confirmada e confirmada → cancelada passam sem a marca", async () => {
    const id = await venda(await versaoCom(formato2("configurada", "configurada")));
    await moverComoApp(id, "invoiced", id);
    await moverComoApp(id, "confirmed", null);
    expect(await statusDe(id)).toBe("confirmed");
    await moverComoApp(id, "cancelled", null);
    expect(await statusDe(id)).toBe("cancelled");
  });
});
