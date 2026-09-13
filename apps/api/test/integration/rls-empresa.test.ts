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
let USUARIO_TOTAL = ""; let USUARIO_DESTINO = ""; let USUARIO_DESTINO2 = ""; let USUARIO_AMBAS = ""; let CONGELAMENTO_GLOBAL = ""; let TRANSFERENCIA = "";

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

  // MEMBRO TOTAL no financeiro: a contraprova de todo teste de escrita da categoria B.
  const ut = await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ('rls-total@demo.local','Usuario Total','x') returning id");
  USUARIO_TOTAL = ut.rows[0]!.id;
  const mt = await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,is_owner,is_active) values ($1,$2,false,true) returning id", [ORG, USUARIO_TOTAL]);
  await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,'financeiro','todas'),($1,$2,'frota_ativos','todas')", [ORG, mt.rows[0]!.id]);

  // MEMBRO QUE SÓ ENXERGA O DESTINO da transferência (frota_ativos = [B]).
  const ud = await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ('rls-destino@demo.local','So Destino','x') returning id");
  USUARIO_DESTINO = ud.rows[0]!.id;
  const md = await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,is_owner,is_active) values ($1,$2,false,true) returning id", [ORG, USUARIO_DESTINO]);
  await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,'frota_ativos','selecionadas')", [ORG, md.rows[0]!.id]);
  await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,'frota_ativos','selecionadas',$3)", [ORG, md.rows[0]!.id, B]);
  // o membro da matriz vê a ORIGEM (A) no mesmo módulo
  await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,'frota_ativos','selecionadas')", [ORG, MEMBRO]);
  await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,'frota_ativos','selecionadas',$3)", [ORG, MEMBRO, A]);

  // DESTINO-ONLY NA PECUÁRIA: o aceite é dele, o documento não.
  const ud2 = await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ('rls-destino-pec@demo.local','So Destino Pecuaria','x') returning id");
  USUARIO_DESTINO2 = ud2.rows[0]!.id;
  const md2 = await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,is_owner,is_active) values ($1,$2,false,true) returning id", [ORG, USUARIO_DESTINO2]);
  await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,'pecuaria','selecionadas')", [ORG, md2.rows[0]!.id]);
  await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,'pecuaria','selecionadas',$3)", [ORG, md2.rows[0]!.id, B]);

  // AS DUAS PONTAS no estoque: a contraprova de toda recusa por ponta única na transferência de armazém.
  const ua = await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ('rls-ambas@demo.local','Ambas as pontas','x') returning id");
  USUARIO_AMBAS = ua.rows[0]!.id;
  const ma = await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,is_owner,is_active) values ($1,$2,false,true) returning id", [ORG, USUARIO_AMBAS]);
  await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,'estoque','selecionadas')", [ORG, ma.rows[0]!.id]);
  await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,'estoque','selecionadas',$3),($1,$2,'estoque','selecionadas',$4)", [ORG, ma.rows[0]!.id, A, B]);

  // CATEGORIA B: congelamento financeiro SEM empresa = vale para a organização inteira.
  const cg = await admin.query<{ id: string }>("insert into erp.financial_freezes(organization_id,empresa_id,year,month,is_frozen) values ($1,null,2031,7,true) returning id", [ORG]);
  CONGELAMENTO_GLOBAL = cg.rows[0]!.id;

  // CATEGORIA C: transferência de equipamento da empresa A para a B.
  const fam = await admin.query<{ id: string }>("insert into erp.equipment_families(organization_id,name) values ($1,'[TEST] Familia RLS') returning id", [ORG]);
  const eq = await admin.query<{ id: string }>("insert into erp.equipments(organization_id,empresa_id,family_id,code,description) values ($1,$2,$3,'RLS-EQ','Trator RLS') returning id", [ORG, A, fam.rows[0]!.id]);
  const tr = await admin.query<{ id: string }>("insert into erp.equipment_transfers(organization_id,code,transfer_date,equipment_id,empresa_origem_id,empresa_destino_id) values ($1,'RLS-TR','2031-07-01',$2,$3,$4) returning id", [ORG, eq.rows[0]!.id, A, B]);
  TRANSFERENCIA = tr.rows[0]!.id;

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
  it("CRIAR transferência de ARMAZÉM exige as DUAS pontas — a operação lança nas duas", async () => {
    // A generalização "enviar para uma empresa que o autor não enxerga é o caso normal" NÃO vale para os
    // três domínios. Aqui a criação dá baixa na origem, dá entrada no destino e pode gerar título nos dois
    // lados — e a rota já exige `assertFarm` nas duas pontas. Certificar no banco um contrato mais largo
    // que a operação foi o que permitiu o cancelamento pela metade.
    const whA = (await admin.query<{ id: string }>("select id from erp.warehouses where organization_id=$1 and initials='RA'", [ORG])).rows[0]!.id;
    const whB = (await admin.query<{ id: string }>("select id from erp.warehouses where organization_id=$1 and initials='RB'", [ORG])).rows[0]!.id;
    // o membro da matriz enxerga A no estoque, mas não B: uma ponta só não cria
    await expect(comoApp("estoque",
      `insert into erp.warehouse_transfers(organization_id,code,transfer_date,empresa_origem_id,empresa_destino_id,origin_warehouse_id,destination_warehouse_id,kind,status,created_by)
       values ($1,'TR-UMA',current_date,$2,$3,$4,$5,'farm','pending',$6)`, [ORG, A, B, whA, whB, h.demo.adminUserId])).rejects.toThrow(/row-level security|violates/i);
    // origem que ele não enxerga naquele módulo continua recusada
    await expect(comoApp("estoque",
      `insert into erp.warehouse_transfers(organization_id,code,transfer_date,empresa_origem_id,empresa_destino_id,origin_warehouse_id,destination_warehouse_id,kind,status,created_by)
       values ($1,'TR-NAO',current_date,$2,$3,$4,$5,'farm','pending',$6)`, [ORG, B, A, whB, whA, h.demo.adminUserId])).rejects.toThrow(/row-level security|violates/i);
  });

  it("CRIAR transferência de REBANHO exige só a ORIGEM — lá quem aceita é o destinatário", async () => {
    // O contraste com o caso acima é o ponto: na pecuária o destino não participa da emissão; ele recebe um
    // aviso e ACEITA depois, e é o aceite que move os animais. O destino é validado como EMPRESA DA
    // ORGANIZAÇÃO (`erp.empresa_da_organizacao_atual`), não como empresa visível ao remetente.
    const ok = await afetadas(USUARIO, "pecuaria",
      "insert into erp.animal_movements(organization_id,empresa_id,code,movement_type,movement_date,empresa_destino_id,status,quantity) values ($1,$2,'RLSMOV-OK','farm_transfer','2031-04-05',$3,'pending',0)", [ORG, A, B]);
    expect(ok, "a origem emite sozinha").toBe("1");
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

/** Consulta sob o papel da aplicação com OUTRO usuário (as contraprovas de escrita usam papéis distintos). */
const comoUsuario = <T extends Record<string, unknown>>(usuario: string, modulo: string | null, sql: string, params: unknown[] = []) =>
  withTx(h.db, { orgId: ORG, userId: usuario, modulo }, (tx) => tx.query<T>(sql, params));
/** Quantas linhas a instrução REALMENTE alterou. A RLS não levanta erro no UPDATE/DELETE: ela some com a linha. */
const afetadas = async (usuario: string, modulo: string | null, sql: string, params: unknown[] = []) =>
  (await comoUsuario<{ n: string }>(usuario, modulo, `with alvo as (${sql} returning 1) select count(*)::text n from alvo`, params)).rows[0]!.n;

describe("CATEGORIA B — empresa NULA é da organização: legível por quem vê parte, mutável só por quem vê tudo", () => {
  it("quem enxerga só uma empresa LÊ o registro sem empresa", async () => {
    const r = await comoUsuario<{ n: string }>(USUARIO, "financeiro", "select count(*)::text n from erp.financial_freezes where id=$1", [CONGELAMENTO_GLOBAL]);
    expect(r.rows[0]!.n).toBe("1");
  });
  it("mas NÃO o altera", async () => {
    expect(await afetadas(USUARIO, "financeiro", "update erp.financial_freezes set is_frozen=false where id=$1", [CONGELAMENTO_GLOBAL])).toBe("0");
  });
  it("e NÃO o transforma num registro da empresa que ele enxerga — o caminho que o `for all` deixava aberto", async () => {
    // OLD passava no `using` permissivo (`empresa_id is null`) e NEW passava no `with check` (empresa B no
    // escopo): a linha da organização virava linha da empresa dele, sem erro nenhum.
    expect(await afetadas(USUARIO, "financeiro", "update erp.financial_freezes set empresa_id=$2 where id=$1", [CONGELAMENTO_GLOBAL, B])).toBe("0");
  });
  it("e NÃO o apaga — DELETE não tem `with check` para segurá-lo", async () => {
    expect(await afetadas(USUARIO, "financeiro", "delete from erp.financial_freezes where id=$1", [CONGELAMENTO_GLOBAL])).toBe("0");
  });
  it("quem tem escopo TOTAL do módulo altera", async () => {
    expect(await afetadas(USUARIO_TOTAL, "financeiro", "update erp.financial_freezes set is_frozen=false where id=$1", [CONGELAMENTO_GLOBAL])).toBe("1");
  });
  it("quem tem escopo TOTAL do módulo apaga", async () => {
    expect(await afetadas(USUARIO_TOTAL, "financeiro", "delete from erp.financial_freezes where id=$1", [CONGELAMENTO_GLOBAL])).toBe("1");
  });
});

describe("CATEGORIA C — transferência: ler pelas duas pontas NÃO é escrever pelas duas", () => {
  it("quem enxerga só o DESTINO vê a transferência chegando", async () => {
    const r = await comoUsuario<{ n: string }>(USUARIO_DESTINO, "frota_ativos", "select count(*)::text n from erp.equipment_transfers where id=$1", [TRANSFERENCIA]);
    expect(r.rows[0]!.n).toBe("1");
  });
  it("mas NÃO altera a linha — `note` é do documento, e o documento é da ORIGEM", async () => {
    // Aqui estava o buraco: o UPDATE em envelope existia para o aceite pecuário e para o cancelamento de
    // estoque, e acabou dando ao destinatário de QUALQUER transferência autoridade para reescrever a linha
    // inteira. `equipment_transfers` nem sequer tem rota de aceite — a exceção de domínio tinha de ser tão
    // estreita quanto a ação de domínio.
    expect(await afetadas(USUARIO_DESTINO, "frota_ativos", "update erp.equipment_transfers set note='aceite' where id=$1", [TRANSFERENCIA])).toBe("0");
  });
  it("nem redireciona as pontas — a política já o exclui, e o gatilho continua como segunda barreira", async () => {
    expect(await afetadas(USUARIO_DESTINO, "frota_ativos", "update erp.equipment_transfers set empresa_origem_id=$2 where id=$1", [TRANSFERENCIA, B])).toBe("0");
  });
  it("e NÃO a apaga — receber não é poder desfazer o envio", async () => {
    expect(await afetadas(USUARIO_DESTINO, "frota_ativos", "delete from erp.equipment_transfers where id=$1", [TRANSFERENCIA])).toBe("0");
  });
  it("quem enxerga a ORIGEM altera", async () => {
    expect(await afetadas(USUARIO, "frota_ativos", "update erp.equipment_transfers set note='ok' where id=$1", [TRANSFERENCIA])).toBe("1");
  });
  it("quem enxerga a ORIGEM apaga", async () => {
    expect(await afetadas(USUARIO, "frota_ativos", "delete from erp.equipment_transfers where id=$1", [TRANSFERENCIA])).toBe("1");
  });

  it("MOVIMENTO DE REBANHO: o destino lê, mas o UPDATE normal é da origem — o aceite é a operação privilegiada", async () => {
    const mov = await admin.query<{ id: string }>(
      "insert into erp.animal_movements(organization_id,empresa_id,code,movement_type,movement_date,empresa_destino_id,status,quantity) values ($1,$2,'RLSMOV','farm_transfer','2031-04-01',$3,'pending',0) returning id", [ORG, A, B]);
    const id = mov.rows[0]!.id;
    const visto = await comoUsuario<{ n: string }>(USUARIO_DESTINO2, "pecuaria", "select count(*)::text n from erp.animal_movements where id=$1", [id]);
    expect(visto.rows[0]!.n, "o destinatário precisa ver o que está chegando").toBe("1");
    expect(await afetadas(USUARIO_DESTINO2, "pecuaria", "update erp.animal_movements set note='aceite' where id=$1", [id]),
      "aceitar é mover animais, não editar o documento").toBe("0");
    expect(await afetadas(USUARIO_DESTINO2, "pecuaria", "delete from erp.animal_movements where id=$1", [id])).toBe("0");
  });

  it("TRANSFERÊNCIA DE ARMAZÉM: escrever exige AS DUAS pontas, porque o estorno desfaz as duas", async () => {
    const t = await admin.query<{ id: string }>(
      "insert into erp.warehouse_transfers(organization_id,code,transfer_date,kind,empresa_origem_id,origin_warehouse_id,empresa_destino_id,destination_warehouse_id) select $1,'RLSWT','2031-04-02','farm',$2,wa.id,$3,wb.id from (select id from erp.warehouses where organization_id=$1 and initials='RA') wa, (select id from erp.warehouses where organization_id=$1 and initials='RB') wb returning id", [ORG, A, B]);
    const id = t.rows[0]!.id;
    expect((await comoUsuario<{ n: string }>(USUARIO, "estoque", "select count(*)::text n from erp.warehouse_transfers where id=$1", [id])).rows[0]!.n,
      "quem enxerga uma ponta LÊ").toBe("1");
    expect(await afetadas(USUARIO, "estoque", "update erp.warehouse_transfers set status='cancelled' where id=$1", [id]),
      "mas cancelar com uma ponta só deixaria meio ledger estornado").toBe("0");
    expect(await afetadas(USUARIO_AMBAS, "estoque", "update erp.warehouse_transfers set status='cancelled' where id=$1", [id]),
      "quem alcança as duas pontas escreve").toBe("1");
  });

  it("INSERIR transferência de armazém com só uma ponta é recusado; com as duas passa", async () => {
    const armazens = await admin.query<{ ra: string; rb: string }>(
      "select (select id from erp.warehouses where organization_id=$1 and initials='RA') ra, (select id from erp.warehouses where organization_id=$1 and initials='RB') rb", [ORG]);
    const { ra, rb } = armazens.rows[0]!;
    await expect(comoUsuario(USUARIO, "estoque",
      "insert into erp.warehouse_transfers(organization_id,code,transfer_date,kind,empresa_origem_id,origin_warehouse_id,empresa_destino_id,destination_warehouse_id) values ($1,'RLSWT2','2031-04-03','farm',$2,$3,$4,$5)", [ORG, A, ra, B, rb]))
      .rejects.toThrow();
    const ok = await afetadas(USUARIO_AMBAS, "estoque",
      "insert into erp.warehouse_transfers(organization_id,code,transfer_date,kind,empresa_origem_id,origin_warehouse_id,empresa_destino_id,destination_warehouse_id) values ($1,'RLSWT3','2031-04-03','farm',$2,$3,$4,$5)", [ORG, A, ra, B, rb]);
    expect(ok, "com as duas pontas a operação é legítima").toBe("1");
  });
});
