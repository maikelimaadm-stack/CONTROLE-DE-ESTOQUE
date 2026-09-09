import bcrypt from "bcryptjs";
import { permissionRows, PURCHASE_STATUS_LABELS } from "@agro/domain";
import type { Db, Queryable } from "./pool.js";
import { withTx } from "./pool.js";

const STATES: [string, string, number][] = [["AC","Acre",12],["AL","Alagoas",27],["AP","Amapá",16],["AM","Amazonas",13],["BA","Bahia",29],["CE","Ceará",23],["DF","Distrito Federal",53],["ES","Espírito Santo",32],["GO","Goiás",52],["MA","Maranhão",21],["MT","Mato Grosso",51],["MS","Mato Grosso do Sul",50],["MG","Minas Gerais",31],["PA","Pará",15],["PB","Paraíba",25],["PR","Paraná",41],["PE","Pernambuco",26],["PI","Piauí",22],["RJ","Rio de Janeiro",33],["RN","Rio Grande do Norte",24],["RS","Rio Grande do Sul",43],["RO","Rondônia",11],["RR","Roraima",14],["SC","Santa Catarina",42],["SP","São Paulo",35],["SE","Sergipe",28],["TO","Tocantins",17]];
const CITIES: [number, string, string][] = [[5208707,"Goiânia","GO"],[5300108,"Brasília","DF"],[3550308,"São Paulo","SP"],[3106200,"Belo Horizonte","MG"],[5103403,"Cuiabá","MT"],[5002704,"Campo Grande","MS"],[1721000,"Palmas","TO"],[1709500,"Gurupi","TO"],[2927408,"Salvador","BA"],[4106902,"Curitiba","PR"],[5218805,"Rio Verde","GO"],[5107925,"Sorriso","MT"],[3170206,"Uberlândia","MG"],[5006606,"Ponta Porã","MS"]];
const BANKS: [string, string][] = [["001","Banco do Brasil"],["033","Santander"],["104","Caixa Econômica Federal"],["237","Bradesco"],["341","Itaú"],["748","Sicredi"],["756","Sicoob"],["077","Inter"],["260","Nubank"],["000","Caixa Interno"]];
const UNITS: [string, string, number][] = [["un","Unidade",2],["kg","Quilograma",3],["g","Grama",2],["ton","Tonelada",4],["L","Litro",3],["mL","Mililitro",2],["sc","Saca",2],["cx","Caixa",2],["fd","Fardo",2],["dz","Dúzia",2],["m","Metro",2],["m²","Metro quadrado",2],["m³","Metro cúbico",3],["ha","Hectare",4],["@","Arroba",3],["cab","Cabeça",0],["dose","Dose",2],["h","Hora",2],["km","Quilômetro",2],["pc","Peça",0],["par","Par",0],["rl","Rolo",2],["gl","Galão",2],["bd","Balde",2],["BAG","Big bag",2]];
const TITLE_TYPES = ["Boleto","Duplicata","Cheque","Nota Fiscal - NFe","Recibo","Ad.Fornecedor","Ad.Funcionario","Cupom Fiscal","Folha pagto","Guias Recolhimento","Romaneio","Pix","Transferência","Dinheiro","Cartão de Crédito","Taxas/Tarifas","Fatura","Nota Fiscal Serviço - NFSe","Ad. Cliente","Débito/Conta","Débito/Cartão","Gerencial","Contrato"];
const PAYMENT_METHODS = ["À vista","Pix","Boleto","Cartão de Crédito","Cartão de Débito","Transferência","Cheque","Dinheiro","Prazo 30 dias","Prazo 30/60/90"];
const EQUIPMENT_FAMILIES: [string, number, number][] = [["Construções e Instalações",25,4],["Culturas Perenes",10,10],["Equipamentos Agrícolas",10,10],["Imóveis Rurais e Urbanos",25,4],["Implementos Agrícolas",10,10],["Máquinas Agrícolas",10,10],["Veículos",5,20],["Móveis e Utensílios",10,10],["Equipamentos de Informática",5,20],["Animais Reprodutores",5,20]];
const ID_TYPES = ["Brinco de Manejo","Brinco RFID","Brinco SISBOV","Brinco SIRBOV-TO","Brinco SRBIPA","Marca a fogo","Tatuagem"];
const BEEF_CATEGORIES: [string, "M"|"F", number|null, number|null, number][] = [["Bezerro",'M',0,12,0.25],["Bezerra",'F',0,12,0.25],["Garrote",'M',13,24,0.5],["Novilha",'F',13,24,0.5],["Boi Magro",'M',25,36,0.75],["Boi Gordo",'M',25,null,1],["Vaca",'F',25,null,1],["Touro",'M',36,null,1.25],["Matriz",'F',36,null,1]];

export async function seedReference(db: Db, log: (m: string) => void = console.log) {
  await withTx(db, { orgId: null, userId: null }, async (tx) => {
    for (const [code, name, ibge] of STATES) await tx.query("insert into erp.states(code,name,ibge_code) values ($1,$2,$3) on conflict (code) do nothing", [code, name, ibge]);
    for (const [id, name, st] of CITIES) await tx.query("insert into erp.cities(id,name,state_code) values ($1,$2,$3) on conflict (id) do nothing", [id, name, st]);
    for (const [code, name] of BANKS) await tx.query("insert into erp.banks(code,name) values ($1,$2) on conflict (code) do nothing", [code, name]);
    for (const [symbol, name, decimals] of UNITS) await tx.query("insert into erp.measurement_units(organization_id,symbol,name,decimals) values (null,$1,$2,$3) on conflict do nothing", [symbol, name, decimals]);
    for (const name of TITLE_TYPES) await tx.query("insert into erp.title_types(organization_id,name,is_advance) values (null,$1,$2) on conflict do nothing", [name, name.startsWith("Ad")]);
    for (const name of PAYMENT_METHODS) await tx.query("insert into erp.payment_methods(organization_id,name) values (null,$1) on conflict do nothing", [name]);
    for (const [name, life, pct] of EQUIPMENT_FAMILIES) await tx.query("insert into erp.equipment_families(organization_id,name,default_life_years,default_depreciation_percent) select null,$1,$2,$3 where not exists (select 1 from erp.equipment_families where organization_id is null and name=$1)", [name, life, pct]);
    for (const name of ID_TYPES) await tx.query("insert into erp.identification_types(organization_id,name) values (null,$1) on conflict do nothing", [name]);
    const sp = await tx.query<{ id: string }>("insert into erp.animal_species(organization_id,name) values (null,'Bovinos de Corte') on conflict (organization_id,name) do update set name=excluded.name returning id");
    const speciesId = sp.rows[0]!.id;
    for (const [name, sex, min, max, ua] of BEEF_CATEGORIES) await tx.query("insert into erp.animal_categories(organization_id,species_id,name,sex,min_age_months,max_age_months,ua_factor) values (null,$1,$2,$3,$4,$5,$6) on conflict (species_id,name) do nothing", [speciesId, name, sex, min, max, ua]);
    for (const b of ["Nelore","Angus","Brangus","Girolando","Senepol","Tabapuã","Guzerá","Brahman","Cruzado"]) await tx.query("insert into erp.breeds(organization_id,species_id,name) values (null,$1,$2) on conflict do nothing", [speciesId, b]);
    for (const p of permissionRows()) await tx.query("insert into erp.permissions(key,module,resource,action,label) values ($1,$2,$3,$4,$5) on conflict (key) do update set module=excluded.module,resource=excluded.resource,label=excluded.label", [p.key, p.module, p.resource, p.action, p.label]);
  });
  log("reference data seeded");
}

export interface DemoOrg { orgId: string; adminUserId: string; farmIds: string[]; adminEmail: string; adminPassword: string }

/** Cria uma organização DEMO completa (claramente marcada) com usuário admin local. */
export async function seedDemo(db: Db, opts: { orgName?: string; adminEmail?: string; adminPassword?: string; slug?: string } = {}, log: (m: string) => void = console.log): Promise<DemoOrg> {
  const adminEmail = opts.adminEmail ?? "admin@demo.local";
  const adminPassword = opts.adminPassword ?? "Demo@12345";
  const slug = opts.slug ?? "demo";
  const hash = await bcrypt.hash(adminPassword, 10);
  return withTx(db, { orgId: null, userId: null }, async (tx) => {
    const org = await tx.query<{ id: string }>("insert into erp.organizations(name,legal_name,document,slug,parameters) values ($1,$2,$3,$4,$5) on conflict (slug) do update set name=excluded.name returning id", [opts.orgName ?? "[DEMO] Fazendas Modelo", "[DEMO] Fazendas Modelo Ltda", "00000000000191", slug, JSON.stringify({ calc_icms_desonerado: true, financial_freeze_scope: "organization" })]);
    const orgId = org.rows[0]!.id;
    await tx.query("select set_config('app.org_id',$1,true)", [orgId]);
    const u = await tx.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) on conflict (email) do update set password_hash=excluded.password_hash returning id", [adminEmail, "Administrador DEMO", hash]);
    const adminUserId = u.rows[0]!.id;
    await tx.query("select set_config('app.user_id',$1,true)", [adminUserId]);
    const role = await tx.query<{ id: string }>("insert into erp.roles(organization_id,name,description,is_system) values ($1,'Administrador','Acesso total',true) on conflict (organization_id,name) do update set description=excluded.description returning id", [orgId]);
    await tx.query("insert into erp.role_permissions(role_id,permission_key) select $1,key from erp.permissions on conflict do nothing", [role.rows[0]!.id]);
    const opRole = await tx.query<{ id: string }>("insert into erp.roles(organization_id,name,description) values ($1,'Operador de Estoque','Estoque e suprimentos (sem financeiro)') on conflict (organization_id,name) do update set description=excluded.description returning id", [orgId]);
    await tx.query("insert into erp.role_permissions(role_id,permission_key) select $1,key from erp.permissions where key like 'products.%' or key like 'stocks.%' or key like 'requisitions.%' or key like 'input_entries.%' or key like 'purchase_requests.view' or key like 'purchase_requests.create' or key like 'dashboard.home.%' or key like 'warehouses.view' on conflict do nothing", [opRole.rows[0]!.id]);
    await tx.query("insert into erp.organization_members(organization_id,user_id,role_id,is_owner) values ($1,$2,$3,true) on conflict (organization_id,user_id) do update set is_owner=true", [orgId, adminUserId, role.rows[0]!.id]);
    const opHash = await bcrypt.hash("Demo@12345", 10);
    const op = await tx.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ('operador@demo.local','Operador DEMO',$1) on conflict (email) do update set name=excluded.name returning id", [opHash]);
    await tx.query("insert into erp.organization_members(organization_id,user_id,role_id,is_owner) values ($1,$2,$3,false) on conflict do nothing", [orgId, op.rows[0]!.id, opRole.rows[0]!.id]);

    const farmIds: string[] = [];
    for (const [code, name, city] of [[1, "[DEMO] Fazenda Santa Luzia", 5208707], [2, "[DEMO] Fazenda Boa Vista", 1709500]] as const) {
      const f = await tx.query<{ id: string }>("insert into erp.farms(organization_id,code,name,document,address_city,address_state,area_ha,created_by) values ($1,$2,$3,'00000000000191',(select name from erp.cities where id=$4),(select state_code from erp.cities where id=$4),1200,$5) on conflict (organization_id,code) do update set name=excluded.name returning id", [orgId, code, name, city, adminUserId]);
      farmIds.push(f.rows[0]!.id);
    }
    // Centros de custo
    const cc = async (code: string, name: string, kind: string, parent: string | null) => (await tx.query<{ id: string }>("insert into erp.cost_centers(organization_id,code,name,kind,parent_id) values ($1,$2,$3,$4,$5) on conflict (organization_id,code) do update set name=excluded.name returning id", [orgId, code, name, kind, parent])).rows[0]!.id;
    const ccAdm = await cc("1.01", "Administração", "synthetic", null); const ccAdmGeral = await cc("1.01.001", "Adm Geral", "analytic", ccAdm);
    const ccEst = await cc("1.02", "Estoque", "synthetic", null); await cc("1.02.001", "Estoque Insumos", "analytic", ccEst); const ccMaq = await cc("1.03.001", "Parque de Máquinas", "analytic", null);
    const ccPec = await cc("2.01", "Pecuária", "synthetic", null); const ccCria = await cc("2.01.001", "Cria", "analytic", ccPec); await cc("2.01.002", "Recria", "analytic", ccPec); const ccEng = await cc("2.01.003", "Engorda/Confinamento", "analytic", ccPec);
    const ccAgro = await cc("3.01", "Agricultura", "synthetic", null); await cc("3.01.001", "Soja", "analytic", ccAgro);
    for (const fid of farmIds) for (const c of [ccAdmGeral, ccMaq, ccCria, ccEng]) await tx.query("insert into erp.farm_cost_centers(farm_id,cost_center_id) values ($1,$2) on conflict do nothing", [fid, c]);
    // Safras
    await tx.query("insert into erp.harvests(organization_id,description,start_date,end_date,is_current,first_semester_month,second_semester_month) values ($1,'Safra 2025/2026','2025-07-01','2026-06-30',false,1,7),($1,'Safra 2026/2027','2026-07-01','2027-06-30',true,1,7) on conflict do nothing", [orgId]);
    // Categorias financeiras
    const fc = async (code: string, name: string, nature: string, kind: string, parent: string | null) => (await tx.query<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind,parent_id) values ($1,$2,$3,$4,$5,$6) on conflict (organization_id,code) do update set name=excluded.name returning id", [orgId, code, name, nature, kind, parent])).rows[0]!.id;
    const rec = await fc("1", "RECEITAS", "income", "synthetic", null); const recPec = await fc("1.01", "Receitas da Pecuária", "income", "synthetic", rec);
    await fc("1.01.001", "Venda de Boi Gordo", "income", "analytic", recPec); await fc("1.01.002", "Venda de Bezerros", "income", "analytic", recPec); const recAgro = await fc("1.02", "Receitas Agrícolas", "income", "synthetic", rec); await fc("1.02.001", "Venda de Soja", "income", "analytic", recAgro); const recOut = await fc("1.03", "Outras Receitas", "income", "synthetic", rec); await fc("1.03.001", "Venda de Produtos", "income", "analytic", recOut);
    const desp = await fc("2", "DESPESAS", "expense", "synthetic", null); const dAdm = await fc("2.01", "Despesas Administrativas", "expense", "synthetic", desp);
    await fc("2.01.001", "Energia Elétrica", "expense", "analytic", dAdm); await fc("2.01.002", "Telefone/Internet", "expense", "analytic", dAdm); await fc("2.01.003", "Salários e Encargos", "expense", "analytic", dAdm);
    const dPec = await fc("2.02", "Custos da Pecuária", "expense", "synthetic", desp); const catNutri = await fc("2.02.001", "Nutrição Animal", "expense", "analytic", dPec); const catSan = await fc("2.02.002", "Sanidade Animal", "expense", "analytic", dPec); await fc("2.02.003", "Compra de Animais", "expense", "analytic", dPec);
    const dMaq = await fc("2.03", "Máquinas e Veículos", "expense", "synthetic", desp); const catComb = await fc("2.03.001", "Combustíveis", "expense", "analytic", dMaq); const catPecas = await fc("2.03.002", "Peças e Manutenção", "expense", "analytic", dMaq);
    const dAgro = await fc("2.04", "Custos Agrícolas", "expense", "synthetic", desp); const catFert = await fc("2.04.001", "Fertilizantes", "expense", "analytic", dAgro); await fc("2.04.002", "Sementes", "expense", "analytic", dAgro); await fc("2.04.003", "Defensivos", "expense", "analytic", dAgro);
    // Plano de contas (mínimo)
    await tx.query("insert into erp.chart_accounts(organization_id,code,description,condition,kind) values ($1,'1','ATIVO','debit','synthetic'),($1,'1.1.01','Caixa e Bancos','debit','analytic'),($1,'1.1.02','Estoques','debit','analytic'),($1,'2','PASSIVO','credit','synthetic'),($1,'2.1.01','Fornecedores','credit','analytic'),($1,'3','RESULTADO','both','synthetic'),($1,'3.1.01','Receitas','credit','analytic'),($1,'3.2.01','Despesas','debit','analytic') on conflict do nothing", [orgId]);
    // Produtos: grupos/categorias/classes
    const pg = async (name: string) => (await tx.query<{ id: string }>("insert into erp.product_groups(organization_id,name) values ($1,$2) on conflict (organization_id,name) do update set name=excluded.name returning id", [orgId, name])).rows[0]!.id;
    const pc = async (g: string, name: string) => (await tx.query<{ id: string }>("insert into erp.product_categories(organization_id,group_id,name) values ($1,$2,$3) on conflict (group_id,name) do update set name=excluded.name returning id", [orgId, g, name])).rows[0]!.id;
    const pk = async (c: string, name: string) => (await tx.query<{ id: string }>("insert into erp.product_kinds(organization_id,category_id,name) values ($1,$2,$3) on conflict (category_id,name) do update set name=excluded.name returning id", [orgId, c, name])).rows[0]!.id;
    const gPec = await pg("Insumos Pecuária"), gAgro = await pg("Insumos Agrícola"), gGer = await pg("Insumos Gerais"), gMaq = await pg("Máquinas/Equipamentos/Veículos"), gProd = await pg("Produção");
    const cNut = await pc(gPec, "Nutrição Animal"), cSan = await pc(gPec, "Sanidade Animal"), cFert = await pc(gAgro, "Fertilizantes"), cComb = await pc(gGer, "Combustíveis"), cPecas = await pc(gMaq, "Peças"), cGraos = await pc(gProd, "Grãos");
    const kSal = await pk(cNut, "Sal Mineral"), kRacao = await pk(cNut, "Ração/Concentrado"), kVac = await pk(cSan, "Vacinas"), kVerm = await pk(cSan, "Vermífugos"), kNPK = await pk(cFert, "NPK"), kDiesel = await pk(cComb, "Diesel"), kFiltro = await pk(cPecas, "Filtros"), kSoja = await pk(cGraos, "Soja");
    const unit = async (s: string) => (await tx.query<{ id: string }>("select id from erp.measurement_units where organization_id is null and symbol=$1", [s])).rows[0]!.id;
    const uKg = await unit("kg"), uSc = await unit("sc"), uL = await unit("L"), uUn = await unit("un"), uDose = await unit("dose"), uTon = await unit("ton");
    const wh: Record<string, string> = {};
    for (const [i, fid] of farmIds.entries()) {
      const w = await tx.query<{ id: string }>("insert into erp.warehouses(organization_id,farm_id,initials,description,type) values ($1,$2,$3,$4,'inputs') on conflict (farm_id,initials) do update set description=excluded.description returning id", [orgId, fid, "ALM", `Almoxarifado Central ${i + 1}`]);
      wh[fid] = w.rows[0]!.id;
      await tx.query("insert into erp.warehouses(organization_id,farm_id,initials,description,type) values ($1,$2,'FAB','Fábrica de Ração','formulation'),($1,$2,'SILO','Silo de Grãos','production') on conflict do nothing", [orgId, fid]);
    }
    const prod = async (desc: string, g: string, c: string, k: string, u: string, fcat: string, extra: Record<string, unknown> = {}) => {
      const code = String((await tx.query<{ n: string }>("select erp.next_code($1,'product') n", [orgId])).rows[0]!.n).padStart(5, "0");
      return (await tx.query<{ id: string }>("insert into erp.products(organization_id,code,description,group_id,category_id,kind_id,measurement_id,financial_category_id,control_stock,has_lot,min_stock,reference_price,default_warehouse_id,withdrawal_period_days,ncm_code,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13,$14,$15) returning id", [orgId, code, desc, g, c, k, u, fcat, extra.has_lot ?? false, extra.min_stock ?? 0, extra.price ?? 0, wh[farmIds[0]!], extra.withdrawal ?? null, extra.ncm ?? null, adminUserId])).rows[0]!.id;
    };
    const existing = await tx.query("select 1 from erp.products where organization_id=$1 limit 1", [orgId]);
    let products: Record<string, string> = {};
    if (!existing.rowCount) {
      products = {
        sal: await prod("Sal Mineral 80 Proteinado 25kg", gPec, cNut, kSal, uKg, catNutri, { min_stock: 500, price: 4.5 }),
        racao: await prod("Ração Confinamento 18% 40kg", gPec, cNut, kRacao, uKg, catNutri, { min_stock: 2000, price: 2.1 }),
        vacina: await prod("Vacina Aftosa 50 doses", gPec, cSan, kVac, uDose, catSan, { has_lot: true, min_stock: 100, price: 3.2, withdrawal: 0 }),
        ivermectina: await prod("Ivermectina 1% 500mL", gPec, cSan, kVerm, uL, catSan, { has_lot: true, min_stock: 5, price: 85, withdrawal: 28 }),
        npk: await prod("Adubo NPK 04-14-08 50kg", gAgro, cFert, kNPK, uSc, catFert, { min_stock: 100, price: 180 }),
        diesel: await prod("Óleo Diesel S10", gGer, cComb, kDiesel, uL, catComb, { min_stock: 1000, price: 6.2 }),
        filtro: await prod("Filtro de Óleo Trator", gMaq, cPecas, kFiltro, uUn, catPecas, { min_stock: 4, price: 95 }),
        soja: await prod("Soja em Grãos", gProd, cGraos, kSoja, uTon, catFert, { price: 1950 })
      };
    }
    // Pessoas
    const person = async (data: Record<string, unknown>) => {
      const code = String((await tx.query<{ n: string }>("select erp.next_code($1,'person') n", [orgId])).rows[0]!.n).padStart(5, "0");
      return (await tx.query<{ id: string }>("insert into erp.people(organization_id,code,document,person_type,name,legal_name,email,phone,city_id,is_provider,is_client,is_employee,is_proprietary,is_transporter) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict do nothing returning id", [orgId, code, data.document, data.person_type ?? "legal", data.name, data.legal_name ?? data.name, data.email ?? null, data.phone ?? null, data.city_id ?? 5208707, !!data.is_provider, !!data.is_client, !!data.is_employee, !!data.is_proprietary, !!data.is_transporter])).rows[0]?.id;
    };
    const havePeople = await tx.query("select 1 from erp.people where organization_id=$1 limit 1", [orgId]);
    if (!havePeople.rowCount) {
      const prov1 = await person({ document: "11111111000191", name: "[DEMO] Agropecuária Cerrado Ltda", is_provider: true });
      const prov2 = await person({ document: "22222222000192", name: "[DEMO] Posto Rural Diesel", is_provider: true });
      const cli1 = await person({ document: "33333333000193", name: "[DEMO] Frigorífico Boi Bom S.A.", is_client: true });
      const emp1 = await person({ document: "12345678909", person_type: "natural", name: "[DEMO] João Vaqueiro", is_employee: true });
      const owner = await person({ document: "98765432100", person_type: "natural", name: "[DEMO] Proprietário Gestor", is_proprietary: true });
      if (prov1) await tx.query("insert into erp.provider_profiles(person_id,provider_type) values ($1,'provider'),($2,'provider') on conflict do nothing", [prov1, prov2]);
      if (cli1) await tx.query("insert into erp.client_profiles(person_id,final_customer,taxpayer) values ($1,false,true) on conflict do nothing", [cli1]);
      if (emp1) {
        const fn = await tx.query<{ id: string }>("insert into erp.job_functions(organization_id,name,description,base_salary,monthly_hours,hour_value) values ($1,'Vaqueiro','Manejo de gado',2200,220,10) returning id", [orgId]);
        await tx.query("insert into erp.employee_profiles(person_id,function_id,base_salary,cost_center_id,birthday,admission_date) values ($1,$2,2200,$3,'1990-05-20','2024-02-01') on conflict do nothing", [emp1, fn.rows[0]!.id, ccCria]);
      }
      if (owner) { await tx.query("insert into erp.proprietary_profiles(person_id) values ($1) on conflict do nothing", [owner]); for (const fid of farmIds) await tx.query("insert into erp.proprietary_farms(person_id,farm_id,percentage) values ($1,$2,100) on conflict do nothing", [owner, fid]); }
    }
    // Contas bancárias
    await tx.query("insert into erp.bank_accounts(organization_id,code,description,bank_code,agency,account_number,type,opening_balance) values ($1,'CXF','Caixa Fazenda','000','0','0','cash',5000),($1,'BB','Banco do Brasil Principal','001','1234','56789-0','checking',150000) on conflict do nothing", [orgId]);
    // SLA
    for (const [status] of Object.entries(PURCHASE_STATUS_LABELS)) await tx.query("insert into erp.supply_status_sla(organization_id,status,max_hours) values ($1,$2,$3) on conflict do nothing", [orgId, status, status === "quotation_in_progress" ? 5 : 0]);
    // Autorizador
    await tx.query("insert into erp.authorizers(organization_id,user_id,max_value,min_quotes,levels) values ($1,$2,100000,1,'{1,2}') on conflict do nothing", [orgId, adminUserId]);
    // Bens
    for (const [code, desc, fam, val] of [["0001", "Trator 4x4 110cv", "Máquinas Agrícolas", 380000], ["0002", "Caminhonete Cabine Dupla", "Veículos", 220000], ["0003", "Balança Bovina 3.000kg", "Equipamentos Agrícolas", 25000]] as const) {
      await tx.query("insert into erp.equipments(organization_id,farm_id,code,description,family_id,equipment_type,hour_value,year_model,has_depreciation,acquisition_value,acquisition_date,depreciation_type,residual_percent,life_years,depreciation_percent,residual_value,depreciable_value,features) values ($1,$2,$3,$4,(select id from erp.equipment_families where name=$5 and organization_id is null),'own',120,'2023',true,$6,'2023-03-01','with_residual',10,10,10,$6*0.1,$6*0.9,'{supply,maintenance}') on conflict do nothing", [orgId, farmIds[0], code, desc, fam, val]);
    }
    // Pecuária: lotes, módulos, áreas, animais
    const species = (await tx.query<{ id: string }>("select id from erp.animal_species where organization_id is null and name='Bovinos de Corte'")).rows[0]!.id;
    const cat = async (n: string) => (await tx.query<{ id: string }>("select id from erp.animal_categories where species_id=$1 and name=$2", [species, n])).rows[0]!.id;
    const fodder = await tx.query<{ id: string }>("insert into erp.fodders(organization_id,description) values ($1,'Brachiaria Marandu') returning id", [orgId]);
    const mod = await tx.query<{ id: string }>("insert into erp.grazing_modules(organization_id,farm_id,code,module_date,description,fodder_id,color) values ($1,$2,'M01',current_date,'Módulo Pastejo 01',$3,'#2e7d32') on conflict do nothing returning id", [orgId, farmIds[0], fodder.rows[0]!.id]);
    if (mod.rowCount) for (const a of ["01", "02", "03", "04"]) await tx.query("insert into erp.areas(organization_id,farm_id,grazing_module_id,code,name,area_ha,fodder_id) values ($1,$2,$3,$4,$5,25,$6) on conflict do nothing", [orgId, farmIds[0], mod.rows[0]!.id, a, `Piquete ${a}`, fodder.rows[0]!.id]);
    const haveAnimals = await tx.query("select 1 from erp.animals where organization_id=$1 limit 1", [orgId]);
    if (!haveAnimals.rowCount) {
      const b1 = (await tx.query<{ id: string }>("insert into erp.batches(organization_id,farm_id,code,batch_date,description,species_id,batch_type,grazing_module_id,entry_date) values ($1,$2,'L0001',current_date,'Lote Recria Machos','$3','pasture',$4,current_date) returning id".replace("'$3'", "$3"), [orgId, farmIds[0], species, mod.rows[0]?.id ?? null])).rows[0]!.id;
      const b2 = (await tx.query<{ id: string }>("insert into erp.batches(organization_id,farm_id,code,batch_date,description,species_id,batch_type,entry_date) values ($1,$2,'L0002',current_date,'Lote Matrizes',$3,'breeding',current_date) returning id", [orgId, farmIds[0], species])).rows[0]!.id;
      const breed = (await tx.query<{ id: string }>("select id from erp.breeds where name='Nelore' and organization_id is null")).rows[0]!.id;
      const idType = (await tx.query<{ id: string }>("select id from erp.identification_types where name='Brinco de Manejo' and organization_id is null")).rows[0]!.id;
      const catGar = await cat("Garrote"), catMat = await cat("Matriz");
      for (let i = 1; i <= 20; i++) {
        const isFemale = i > 12;
        const a = await tx.query<{ id: string }>("insert into erp.animals(organization_id,farm_id,species_id,category_id,breed_id,batch_id,sex,entry_date,birth_date,current_weight,entry_weight,price_arroba_alive,unit_value,created_by) values ($1,$2,$3,$4,$5,$6,$7,current_date - 90,$8,$9,$9,300,$10,$11) returning id", [orgId, farmIds[0], species, isFemale ? catMat : catGar, breed, isFemale ? b2 : b1, isFemale ? "F" : "M", isFemale ? "2021-03-10" : "2024-09-15", isFemale ? 430 : 260, isFemale ? 4300 : 2600, adminUserId]);
        await tx.query("insert into erp.animal_identifications(animal_id,organization_id,identification_type_id,value,is_primary) values ($1,$2,$3,$4,true)", [a.rows[0]!.id, orgId, idType, `DEMO-${String(i).padStart(4, "0")}`]);
      }
      await tx.query("insert into erp.herd_lots(organization_id,farm_id,batch_id,species_id,category_id,breed_id,quantity,average_weight,unit_value,entry_date) values ($1,$2,$3,$4,$5,$6,35,180,1800,current_date - 60)", [orgId, farmIds[0], b1, species, await cat("Bezerro"), breed]);
    }
    // Confinamento
    const yard = await tx.query<{ id: string }>("insert into erp.feedlot_yards(organization_id,farm_id,code,name) values ($1,$2,'P1','Pátio 1') on conflict do nothing returning id", [orgId, farmIds[0]]);
    if (yard.rowCount) {
      const sec = await tx.query<{ id: string }>("insert into erp.feedlot_sectors(organization_id,yard_id,code,name) values ($1,$2,'S1','Setor A') returning id", [orgId, yard.rows[0]!.id]);
      for (const c of ["C01", "C02", "C03"]) await tx.query("insert into erp.feedlot_corrals(organization_id,sector_id,code,name,capacity,area_m2) values ($1,$2,$3,$4,120,1800)", [orgId, sec.rows[0]!.id, c, `Curral ${c}`]);
      const diet = await tx.query<{ id: string }>("insert into erp.diets(organization_id,code,name,dry_matter_percent) values ($1,'D01','Dieta Adaptação',65) returning id", [orgId]);
      if (products.racao) await tx.query("insert into erp.diet_items(diet_id,product_id,percentage) values ($1,$2,60),($1,$3,40)", [diet.rows[0]!.id, products.racao, products.sal]);
      await tx.query("insert into erp.feeding_phases(organization_id,name,diet_id,days_in_phase) values ($1,'Adaptação',$2,14)", [orgId, diet.rows[0]!.id]);
    }
    log(`demo org ${orgId} seeded (admin ${adminEmail})`);
    return { orgId, adminUserId, farmIds, adminEmail, adminPassword };
  });
}

export async function truncateDemo(db: Queryable, orgId: string) {
  await db.query("delete from erp.organizations where id=$1", [orgId]);
}
