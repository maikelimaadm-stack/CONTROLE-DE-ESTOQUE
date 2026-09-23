/**
 * Organização limpa (GO-LIVE-01): a organização em que o Maike faz as transações reais, criada no mesmo
 * banco em que a organização demo continua existindo como sandbox.
 *
 * Cria SÓ o que não tem tela para ser criado: dados de referência (globais, idempotentes), a organização,
 * o dono, o perfil "Administrador" de sistema com todas as permissões, o vínculo do dono e o escopo do dono
 * (todas as empresas em todos os módulos). Todo o resto — empresas, pessoas, produtos, armazéns, contas,
 * centros de custo, categorias, plano de contas, TOPs — tem tela e entra pelo checklist de go-live
 * (`docs/DEPLOYMENT.md` § Go-live), feito por gente, na ordem certa.
 *
 * Fail-closed de ponta a ponta: variável faltando, senha fraca ou conhecida, e-mail já cadastrado, slug já
 * usado e as duas flags ligadas juntas RECUSAM, antes de qualquer escrita e numa transação só. Nada aqui
 * "atualiza se existir": o caminho de reexecução idêntica é um no-op que não escreve uma linha.
 */
import bcrypt from "bcryptjs";
import type { Db, Queryable } from "./pool.js";
import { withTx } from "./pool.js";
import { seedReference, seedReferenceTx, seedDemo } from "./seed.js";
import { CHAVE_ORIGEM_SEED, origemDaOrganizacao } from "./origem-organizacao.js";

export class OrganizacaoLimpaRecusada extends Error {
  constructor(message: string) { super(`organização limpa recusada: ${message}`); this.name = "OrganizacaoLimpaRecusada"; }
}

/**
 * Senhas que aparecem no repositório (seed demo, fixtures de teste, e2e). Uma senha que está no git é
 * pública. `packages/db/test/organizacao-limpa.test.ts` varre o repositório e reprova se aparecer uma senha
 * de fixture que não esteja nesta lista, para ela não envelhecer em silêncio.
 */
export const SENHAS_DO_REPOSITORIO: readonly string[] = [
  "Acesso@12345", "Anexo@12345", "Borda@12345", "Busca@12345", "Conversao@12345", "Cruzado@12345", "Demo@12345",
  "Empresa@12345", "Escopo@12345", "Hotfix@12345", "Leitor@12345", "Matriz@12345", "Modulo@12345", "Notif@12345",
  "Rebanho@12345", "Resp@12345", "Restrito@12345", "Selecao@12345", "Sent@12345", "Variante@12345", "Vendedor@12345",
];
export const SENHA_TAMANHO_MINIMO = 12;

export interface ConfiguracaoOrganizacaoLimpa { orgName: string; orgSlug: string; adminName: string; adminEmail: string; adminPassword: string }

type Env = Record<string, string | undefined>;
export const VARIAVEIS_ORGANIZACAO_LIMPA = ["ORG_NAME", "ORG_SLUG", "ADMIN_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"] as const;

/** Lê e valida a configuração. Nunca devolve a senha em mensagem de erro. */
export function lerConfiguracaoOrganizacaoLimpa(env: Env): ConfiguracaoOrganizacaoLimpa {
  const faltando = VARIAVEIS_ORGANIZACAO_LIMPA.filter((k) => !env[k]?.trim());
  if (faltando.length) throw new OrganizacaoLimpaRecusada(`variável obrigatória ausente: ${faltando.join(", ")}. Nada foi gravado.`);
  const orgSlug = env.ORG_SLUG!.trim();
  const adminEmail = env.ADMIN_EMAIL!.trim().toLowerCase();
  const adminPassword = env.ADMIN_PASSWORD!;
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(orgSlug)) throw new OrganizacaoLimpaRecusada("ORG_SLUG inválido (use minúsculas, dígitos e hífen). Nada foi gravado.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new OrganizacaoLimpaRecusada("ADMIN_EMAIL inválido. Nada foi gravado.");
  if (adminPassword.length < SENHA_TAMANHO_MINIMO) throw new OrganizacaoLimpaRecusada(`ADMIN_PASSWORD precisa ter pelo menos ${SENHA_TAMANHO_MINIMO} caracteres. Nada foi gravado.`);
  const conhecida = SENHAS_DO_REPOSITORIO.some((s) => s.toLowerCase() === adminPassword.toLowerCase());
  if (conhecida) throw new OrganizacaoLimpaRecusada("ADMIN_PASSWORD é uma senha que está no repositório (pública). Escolha outra. Nada foi gravado.");
  return { orgName: env.ORG_NAME!.trim(), orgSlug, adminName: env.ADMIN_NAME!.trim(), adminEmail, adminPassword };
}

export type ResultadoOrganizacaoLimpa = { situacao: "criada" | "ja_criada"; orgId: string; slug: string; adminEmail: string };

export async function seedOrganizacaoLimpa(db: Db, cfg: ConfiguracaoOrganizacaoLimpa, log: (m: string) => void = console.log): Promise<ResultadoOrganizacaoLimpa> {
  const hash = await bcrypt.hash(cfg.adminPassword, 10);
  const r = await withTx(db, { orgId: null, userId: null }, (tx) => criarNaTransacao(tx, cfg, hash));
  if (r.situacao === "ja_criada") log(`organização já criada; remova a flag e ADMIN_PASSWORD (id=${r.orgId} slug=${r.slug} admin=${r.adminEmail})`);
  else log(`organização limpa criada: id=${r.orgId} slug=${r.slug} admin=${r.adminEmail}`);
  return r;
}

async function criarNaTransacao(tx: Queryable, cfg: ConfiguracaoOrganizacaoLimpa, hash: string): Promise<ResultadoOrganizacaoLimpa> {
  // Dois deploys simultâneos não criam duas vezes: o segundo espera e cai no no-op.
  await tx.query("select pg_advisory_xact_lock(hashtext('go-live-01:organizacao-limpa'))");
  const base = { slug: cfg.orgSlug, adminEmail: cfg.adminEmail };

  const existente = await tx.query<{ id: string; parameters: unknown; legal_name: string | null; document: string | null }>("select id, parameters, legal_name, document from erp.organizations where slug=$1", [cfg.orgSlug]);
  const org = existente.rows[0];
  if (org) {
    // Reexecução idêntica: o slug foi criado POR ESTE MECANISMO e o dono é este e-mail. Não escreve nada —
    // nem a senha, que pode já ter sido trocada pela tela.
    const dono = await tx.query("select 1 from erp.organization_members m join erp.users u on u.id=m.user_id where m.organization_id=$1 and m.is_owner and u.email=$2", [org.id, cfg.adminEmail]);
    if (origemDaOrganizacao(org) === "organizacao_limpa" && dono.rowCount) return { situacao: "ja_criada", orgId: org.id, ...base };
    throw new OrganizacaoLimpaRecusada(`o slug "${cfg.orgSlug}" já existe e não é uma organização limpa deste dono. Nada foi gravado; a organização existente não foi alterada. Use outro ORG_SLUG.`);
  }
  const usuario = await tx.query("select 1 from erp.users where email=$1", [cfg.adminEmail]);
  if (usuario.rowCount) throw new OrganizacaoLimpaRecusada(`o e-mail ${cfg.adminEmail} já está cadastrado. Senha, nome e vínculos dele não foram alterados. Use um ADMIN_EMAIL que ainda não exista (o login escolhe a primeira organização do usuário por nome e não há seletor: o e-mail do dono tem de pertencer só à organização nova).`);

  await seedReferenceTx(tx);
  const o = await tx.query<{ id: string }>("insert into erp.organizations(name,slug,parameters) values ($1,$2,$3) returning id", [cfg.orgName, cfg.orgSlug, JSON.stringify({ [CHAVE_ORIGEM_SEED]: "organizacao_limpa" })]);
  const orgId = o.rows[0]!.id;
  await tx.query("select set_config('app.org_id',$1,true)", [orgId]);
  const u = await tx.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [cfg.adminEmail, cfg.adminName, hash]);
  const userId = u.rows[0]!.id;
  await tx.query("select set_config('app.user_id',$1,true)", [userId]);
  const role = await tx.query<{ id: string }>("insert into erp.roles(organization_id,name,description,is_system) values ($1,'Administrador','Acesso total',true) returning id", [orgId]);
  await tx.query("insert into erp.role_permissions(role_id,permission_key) select $1,key from erp.permissions", [role.rows[0]!.id]);
  await tx.query("insert into erp.organization_members(organization_id,user_id,role_id,is_owner) values ($1,$2,$3,true)", [orgId, userId, role.rows[0]!.id]);
  // Sem escopo configurado o membro não enxerga empresa nenhuma (fail-closed). O dono nasce com "todas" em
  // todos os módulos: é o único jeito de ele cadastrar a primeira empresa e de ela aparecer para ele.
  await tx.query(
    `insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo)
     select m.organization_id, m.id, mm.chave, 'todas'
     from erp.organization_members m cross join erp.modulos_escopo_empresa mm
     where m.organization_id=$1 and m.user_id=$2`, [orgId, userId]);
  return { situacao: "criada", orgId, ...base };
}

export type ModoSeedDoDeploy = "nenhum" | "demo" | "organizacao_limpa";

/** As duas flags são mutuamente exclusivas. Ligadas juntas, recusa: não existe ordem "certa" entre elas. */
export function resolverSeedDoDeploy(env: Env): ModoSeedDoDeploy {
  const demo = env.SEED_ON_DEPLOY === "1", limpa = env.ORGANIZACAO_LIMPA_ON_DEPLOY === "1";
  if (demo && limpa) throw new OrganizacaoLimpaRecusada("SEED_ON_DEPLOY=1 e ORGANIZACAO_LIMPA_ON_DEPLOY=1 ao mesmo tempo. Ligue no máximo uma. Nada foi gravado.");
  return limpa ? "organizacao_limpa" : demo ? "demo" : "nenhum";
}

/** O trecho de semeadura do pre-deploy (`apps/api/src/migrate.ts`), testável sem subir o processo. */
export async function semearNoDeploy(db: Db, env: Env, log: (m: string) => void = console.log): Promise<ModoSeedDoDeploy> {
  const modo = resolverSeedDoDeploy(env);
  if (modo === "organizacao_limpa") {
    await seedOrganizacaoLimpa(db, lerConfiguracaoOrganizacaoLimpa(env), log);
  } else if (modo === "demo") {
    await seedReference(db, log);
    const org = await seedDemo(db, { orgName: env.ORG_NAME, adminEmail: env.ADMIN_EMAIL, adminPassword: env.ADMIN_PASSWORD, slug: env.ORG_SLUG }, log);
    log(`seed concluído: organização ${org.orgId} admin ${org.adminEmail}`);
  }
  return modo;
}
