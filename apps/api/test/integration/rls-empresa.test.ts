import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * RLS EMPRESARIAL — A SEGUNDA LINHA DE DEFESA, PROVADA NO BANCO (PRE-BASE2-03).
 *
 * Todos os testes de escopo anteriores passam pela API: eles provam que a APLICAÇÃO recorta. Este prova o
 * que sobra quando a aplicação não recorta — uma consulta nova sem predicado, um relatório com um `exists`
 * esquecido, um acesso direto com o papel da aplicação. Por isso aqui NÃO existe `app.inject`: as consultas
 * saem por `h.db`, que é o pool conectado como `erp_app_test`, exatamente o papel com que a API fala com o
 * banco em produção (sem BYPASSRLS).
 *
 * O usuário da matriz é um só, com as mesmas capacidades em todo lugar:
 *   ESTOQUE → [A] · FINANCEIRO → [B] · PECUÁRIA → todas · VENDAS → sem configuração.
 */
let h: Harness; let admin: Db; let I: Awaited<ReturnType<typeof ids>>;
let ORG = ""; let A = ""; let B = ""; let USUARIO = ""; let MEMBRO = "";
let OUTRA_ORG = ""; let EMPRESA_OUTRA_ORG = "";

/** Consulta sob o papel da aplicação, com o contexto de tenant e o módulo da transação. */
const comoApp = <T extends Record<string, unknown>>(modulo: string | null, sql: string, params: unknown[] = []) =>
  withTx(h.db, { orgId: ORG, userId: USUARIO, modulo }, (tx) => tx.query<T>(sql, params));

/**
 * Só os armazéns DESTE teste (`RA` na empresa A, `RB` na B). O seed da organização demo já cria armazéns em
 * cada empresa, e contá-los junto tornaria a asserção sobre o volume do seed, não sobre o recorte.
 */
const iniciais = async (modulo: string | null) =>
  (await comoApp<{ initials: string }>(modulo, "select initials from erp.warehouses where initials in ('RA','RB') order by initials")).rows.map((r) => r.initials).join(",") || "(nenhum)";

beforeAll(async () => {
  h = await harness(); I = await ids(h); ORG = h.demo.orgId; A = I.farm; B = I.farm2;
  admin = createPool(TEST_URL, { max: 3 });

  const u = await admin.query<{ id: string }>(
    "insert into erp.users(email,name,password_hash) values ('rls@demo.local','Usuario RLS','x') returning id");
  USUARIO = u.rows[0]!.id;
  const m = await admin.query<{ id: string }>(
    "insert into erp.organization_members(organization_id,user_id,is_owner,is_active) values ($1,$2,false,true) returning id", [ORG, USUARIO]);
  MEMBRO = m.rows[0]!.id;
  for (const [modulo, modo] of [["estoque", "selecionadas"], ["financeiro", "selecionadas"], ["pecuaria", "todas"]] as const) {
    await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,$3,$4)", [ORG, MEMBRO, modulo, modo]);
  }
  await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,empresa_id) values ($1,$2,'estoque',$3),($1,$2,'financeiro',$4)", [ORG, MEMBRO, A, B]);

  // um armazém em cada empresa, com iniciais reconhecíveis
  await admin.query("insert into erp.warehouses(organization_id,empresa_id,initials,description,type) values ($1,$2,'RA','Armazem A','inputs'),($1,$3,'RB','Armazem B','inputs')", [ORG, A, B]);

  // outra organização, para o teste de tenant
  const o = await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Outra RLS','outra-rls') returning id");
  OUTRA_ORG = o.rows[0]!.id;
  const f = await admin.query<{ id: string }>("insert into erp.empresas(organization_id,code,name) values ($1,99,'Empresa de outro tenant') returning id", [OUTRA_ORG]);
  EMPRESA_OUTRA_ORG = f.rows[0]!.id;
}, 180_000);

afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("matriz A/B por módulo, lida DIRETO no banco sob o papel da aplicação", () => {
  it("estoque enxerga só a empresa A", async () => { expect(await iniciais("estoque")).toBe("RA"); });
  it("financeiro enxerga só a empresa B — a MESMA pessoa, o MESMO dado, outro módulo", async () => { expect(await iniciais("financeiro")).toBe("RB"); });
  it("pecuária (modo todas) enxerga as duas", async () => { expect(await iniciais("pecuaria")).toBe("RA,RB"); });
  it("vendas, sem configuração, não enxerga NENHUMA (fail-closed)", async () => { expect(await iniciais("vendas")).toBe("(nenhum)"); });

  it("módulo indefinido vale a UNIÃO dos módulos — nunca 'todas', nunca 'nada'", async () => {
    // Rota de organização e porta de permissão dinâmica abrem a transação sem módulo. Tratar isso como
    // "tudo" reabriria o vazamento; como "nada" quebraria toda rota de organização que lê tabela com empresa.
    expect(await iniciais(null)).toBe("RA,RB");
  });

  it("empresa de OUTRA organização não aparece em módulo nenhum", async () => {
    for (const modulo of ["estoque", "financeiro", "pecuaria", null]) {
      const r = await comoApp<{ n: string }>(modulo, "select count(*) n from erp.empresas where id=$1", [EMPRESA_OUTRA_ORG]);
      expect(r.rows[0]!.n, `módulo ${modulo}`).toBe("0");
    }
  });

  it("o seletor de empresa é a UNIÃO entre módulos, e não a organização inteira", async () => {
    // `erp.empresas` alimenta o seletor de contexto de trabalho, compartilhado por telas de módulos
    // diferentes: recortá-lo pelo módulo ativo faria a empresa sumir do seletor conforme a tela aberta.
    const nomes = (await comoApp<{ name: string }>("estoque", "select name from erp.empresas order by code")).rows.map((r) => r.name);
    expect(nomes.length, "as duas empresas da organização demo, visíveis em ALGUM módulo").toBe(2);
    expect(nomes.join(",")).not.toContain("outro tenant");
  });
});

describe("o erro que a migration evita: políticas PERMISSIVE combinam com OR", () => {
  it("reintroduzir a política tenant-only ao lado da combinada REABRE o vazamento — e o teste acusa", async () => {
    // Este é o teste que impede a regressão mais provável desta arquitetura: alguém acrescenta uma política
    // `tenant_isolation` de volta (num hotfix, numa migration futura) achando que está SOMANDO segurança. O
    // PostgreSQL combina políticas permissivas com OR, então a antiga sozinha liberaria a organização inteira.
    expect(await iniciais("estoque")).toBe("RA");
    await admin.query(`create policy tenant_isolation on erp.warehouses for all to erp_app, authenticated
                       using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id))`);
    try {
      expect(await iniciais("estoque"), "com a política tenant-only de volta, o recorte de empresa some").toBe("RA,RB");
    } finally {
      await admin.query("drop policy tenant_isolation on erp.warehouses");
    }
    expect(await iniciais("estoque"), "removida a política tenant-only, o recorte volta").toBe("RA");
  });
});

describe("escrita sob RLS", () => {
  const inserir = (modulo: string | null, empresa: string | null, iniciais: string) =>
    comoApp(modulo, "insert into erp.warehouses(organization_id,empresa_id,initials,description,type) values ($1,$2,$3,'x','inputs')", [ORG, empresa, iniciais]);

  it("grava na empresa permitida pelo módulo", async () => {
    await expect(inserir("estoque", A, "W1")).resolves.toBeTruthy();
  });
  it("RECUSA gravar na empresa que o módulo não alcança", async () => {
    await expect(inserir("estoque", B, "W2")).rejects.toThrow(/row-level security|violates/i);
  });
  it("RECUSA gravar com empresa de outro tenant (a referência composta prova a organização)", async () => {
    await expect(inserir("estoque", EMPRESA_OUTRA_ORG, "W3")).rejects.toThrow();
  });
  it("RECUSA criar registro SEM empresa quando o módulo é `selecionadas`", async () => {
    // Registro sem empresa vale para a ORGANIZAÇÃO INTEIRA: criá-lo alcança empresas que o autor não
    // enxerga. É ampliação de autorização pela porta da escrita — a mesma regra de `exigirEscopoTotalDoModulo`.
    await expect(comoApp("financeiro",
      "insert into erp.financial_freezes(organization_id,empresa_id,year,month,is_frozen) values ($1,null,2031,7,true)", [ORG]))
      .rejects.toThrow(/row-level security|violates/i);
  });
  it("PERMITE criar registro sem empresa quando o módulo é `todas`", async () => {
    await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,'documentos','todas')", [ORG, MEMBRO]);
    await expect(comoApp("documentos",
      "insert into erp.documents(organization_id,empresa_id,title,document_type_id,expiration_date) select $1,null,'Doc org',id,current_date from erp.document_types limit 1", [ORG]))
      .resolves.toBeTruthy();
  });
});

describe("transferência entre empresas: leitura pelas duas pontas, escrita pela origem", () => {
  let transferencia = "";
  beforeAll(async () => {
    // origem A (que o usuário enxerga em estoque), destino B (que ele NÃO enxerga em estoque)
    const whA = (await admin.query<{ id: string }>("select id from erp.warehouses where organization_id=$1 and initials='RA'", [ORG])).rows[0]!.id;
    const whB = (await admin.query<{ id: string }>("select id from erp.warehouses where organization_id=$1 and initials='RB'", [ORG])).rows[0]!.id;
    const t = await admin.query<{ id: string }>(
      `insert into erp.warehouse_transfers(organization_id,code,transfer_date,empresa_origem_id,empresa_destino_id,origin_warehouse_id,destination_warehouse_id,kind,status,created_by)
       values ($1,'TR-RLS',current_date,$2,$3,$4,$5,'farm','pending',$6) returning id`,
      [ORG, A, B, whA, whB, h.demo.adminUserId]);
    transferencia = t.rows[0]!.id;
  });

  it("quem enxerga só a ORIGEM vê a transferência", async () => {
    const r = await comoApp<{ code: string }>("estoque", "select code from erp.warehouse_transfers where id=$1", [transferencia]);
    expect(r.rows.length).toBe(1);
  });
  it("quem enxerga só o DESTINO também vê — quem recebe precisa saber o que está chegando", async () => {
    const r = await comoApp<{ code: string }>("financeiro", "select code from erp.warehouse_transfers where id=$1", [transferencia]);
    expect(r.rows.length).toBe(1);
  });
  it("CRIAR exige a origem no escopo — mas NÃO exige o destino", async () => {
    // Enviar para uma empresa que o autor não enxerga é o caso NORMAL do negócio: quem recebe é que aceita.
    // Exigir as duas pontas quebraria a operação que a transferência existe para fazer.
    const whA = (await admin.query<{ id: string }>("select id from erp.warehouses where organization_id=$1 and initials='RA'", [ORG])).rows[0]!.id;
    const whB = (await admin.query<{ id: string }>("select id from erp.warehouses where organization_id=$1 and initials='RB'", [ORG])).rows[0]!.id;
    await expect(comoApp("estoque",
      `insert into erp.warehouse_transfers(organization_id,code,transfer_date,empresa_origem_id,empresa_destino_id,origin_warehouse_id,destination_warehouse_id,kind,status,created_by)
       values ($1,'TR-OK',current_date,$2,$3,$4,$5,'farm','pending',$6)`, [ORG, A, B, whA, whB, h.demo.adminUserId])).resolves.toBeTruthy();
    // o inverso (origem que ele não enxerga naquele módulo) é recusado
    await expect(comoApp("estoque",
      `insert into erp.warehouse_transfers(organization_id,code,transfer_date,empresa_origem_id,empresa_destino_id,origin_warehouse_id,destination_warehouse_id,kind,status,created_by)
       values ($1,'TR-NAO',current_date,$2,$3,$4,$5,'farm','pending',$6)`, [ORG, B, A, whB, whA, h.demo.adminUserId])).rejects.toThrow(/row-level security|violates/i);
  });
});

describe("porta de permissão dinâmica: o módulo resolvido tem de chegar ao PostgreSQL", () => {
  it("a transação começa SEM módulo e passa a recortar pelo módulo resolvido", async () => {
    // Antes da RLS empresarial bastava atualizar `ctx.moduloEmpresa` em memória, porque só o JavaScript
    // montava o recorte. Agora o banco também decide: se o GUC não acompanhasse a resolução, JS e
    // PostgreSQL ficariam com módulos diferentes na MESMA consulta.
    const r = await withTx(h.db, { orgId: ORG, userId: USUARIO, modulo: null }, async (tx) => {
      const uniao = (await tx.query<{ initials: string }>("select initials from erp.warehouses where initials in ('RA','RB') order by initials")).rows.map((x) => x.initials).join(",");
      // é isto que `comPermissaoResolvida` faz ao descobrir a permissão real do registro
      await tx.query("select set_config('app.modulo_empresa', $1, true)", ["estoque"]);
      const depois = (await tx.query<{ initials: string }>("select initials from erp.warehouses where initials in ('RA','RB') order by initials")).rows.map((x) => x.initials).join(",");
      return { uniao, depois };
    });
    expect(r.uniao, "sem módulo: união dos módulos").toBe("RA,RB");
    expect(r.depois, "com o módulo resolvido: só a empresa daquele módulo").toBe("RA");
  });
});

describe("erp.v_bank_account_balances não é mais uma porta dos fundos", () => {
  it("a view devolve exatamente o que a tabela devolve sob o papel da aplicação", async () => {
    // A view foi criada sem `security_invoker`: rodava com a RLS do DONO, e onde o dono é superusuário não
    // há RLS nenhuma. Sob o papel da aplicação, com uma organização no contexto, ela devolvia as contas e os
    // SALDOS de TODAS as organizações. As duas rotas que a consomem seguravam o resultado pelo join com
    // `erp.bank_accounts`; a view em si era leitura irrestrita, e qualquer consulta nova sem o join herdaria.
    await admin.query("insert into erp.bank_accounts(organization_id,code,description,type,opening_balance) values ($1,'RLS1','Conta desta org','checking',100)", [ORG]);
    await admin.query("insert into erp.bank_accounts(organization_id,code,description,type,opening_balance) values ($1,'RLS2','Conta de outra org','checking',999)", [OUTRA_ORG]);
    const naTabela = await comoApp<{ n: string }>(null, "select count(*) n from erp.bank_accounts");
    const naView = await comoApp<{ n: string; soma: string }>(null, "select count(*) n, coalesce(sum(balance),0)::text soma from erp.v_bank_account_balances");
    expect(naView.rows[0]!.n).toBe(naTabela.rows[0]!.n);
    const temOutraOrg = await comoApp<{ n: string }>(null,
      "select count(*) n from erp.v_bank_account_balances where organization_id=$1", [OUTRA_ORG]);
    expect(temOutraOrg.rows[0]!.n, "saldo de outra organização não pode aparecer").toBe("0");
  });
});
