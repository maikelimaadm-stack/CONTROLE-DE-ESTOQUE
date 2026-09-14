/**
 * BACKFILL DO ID GLOBAL (PRE-BASE2-04) — comando OPERACIONAL, não migration.
 *
 * POR QUE NÃO ESTÁ NA MIGRATION 0016
 * ----------------------------------
 * Numerar o acervo histórico é percorrer 23 tabelas que, em produção, podem somar milhões de linhas. Dentro
 * de uma migration isso seria uma transação de DDL segurando lock por horas e perdendo tudo se falhasse no
 * fim. Aqui é o oposto: lotes curtos, cada um com a sua transação, retomável a qualquer momento e seguro de
 * rodar de novo. O que a 0016 entrega é a infraestrutura — a reserva atômica de faixas.
 *
 * FONTE ÚNICA
 * -----------
 * As entidades, tabelas, colunas de empresa, exclusão lógica, discriminadores e variantes vêm de
 * `ENTIDADES_ID_GLOBAL` (@agro/domain), o MESMO catálogo do runtime. Não há segunda lista: uma entidade
 * acrescentada ao catálogo passa a ser numerada aqui sem que ninguém edite este arquivo.
 *
 * DETERMINISMO
 * ------------
 * Por organização; entidades em `tipo_entidade` ASC; dentro de cada entidade `created_at ASC, id ASC` — o
 * `id` é o desempate, porque dois registros podem nascer no mesmo microssegundo e "a ordem que o Postgres
 * devolveu" não é ordem. Reexecutar produz exatamente o mesmo mapa (registro já indexado nunca é renumerado).
 *
 * O QUE NÃO RECEBE NÚMERO, E POR QUÊ
 * ----------------------------------
 *  - registro EXCLUÍDO (quando a tabela tem exclusão lógica): o resolvedor não o enxerga, então um número
 *    para ele seria um atalho para lugar nenhum;
 *  - variante INTERNA DECLARADA (`farm_transfer`, `evolution`...): efeito de outra operação, sem identidade
 *    própria — exatamente a mesma regra do runtime;
 *  - variante DESCONHECIDA: NÃO é pulada em silêncio. O lote inteiro falha com diagnóstico, porque um valor
 *    fora do catálogo é dado corrompido ou variante nova não declarada, e as duas coisas precisam de gente.
 */
import { createPool, withTx, type Db, type Tx } from "@agro/db";
import { ENTIDADES_ID_GLOBAL, resolverRegistroGlobal, variantesInternasDeclaradas } from "@agro/domain";
import { colunaDiscriminadora, type EntidadeIdGlobal } from "@erp/plataforma";

/**
 * O backfill roda pela conexão de OPERAÇÃO (a mesma das migrations), que não passa por RLS: ele precisa
 * enxergar o acervo de todas as organizações e escreve o índice com `organization_id` explícito em cada
 * predicado — o tenant é preservado por consulta, nunca por política. Não há usuário humano por trás, e é
 * por isso que `criado_por` fica NULL no histórico: inventar um autor seria pior que não ter um.
 */
const SEM_TENANT = { orgId: null, userId: null } as const;

export interface OpcoesBackfill {
  batchSize: number;
  org?: string | null;
  dryRun: boolean;
  verifyOnly: boolean;
  /** Máximo de lotes por entidade (só para provar retomada em teste); 0 = sem limite. */
  maxLotes?: number;
  log?: (m: string) => void;
}

export interface ResultadoBackfill {
  organizacoes: number;
  /** Registros que ganharam número nesta execução. */
  atribuidos: number;
  /** Registros elegíveis que já tinham número (nada a fazer). */
  jaIndexados: number;
  /** Registros elegíveis ainda sem número ao fim (deve ser 0 numa execução completa). */
  faltando: number;
  porTipo: Record<string, number>;
  problemas: string[];
}

/** Entidades na ORDEM determinística do backfill. */
export const ENTIDADES_ORDENADAS: readonly EntidadeIdGlobal[] =
  [...ENTIDADES_ID_GLOBAL].sort((a, b) => a.tipoEntidade.localeCompare(b.tipoEntidade, "en"));

/**
 * Predicado SQL das linhas ELEGÍVEIS desta entidade. Excluídos e variantes internas saem AQUI, no banco, e
 * não num `continue` do laço: uma linha filtrada em memória continuaria voltando no lote seguinte, e o
 * backfill nunca terminaria. Variante desconhecida NÃO é filtrada — ela precisa aparecer para falhar.
 */
function filtroElegivel(e: EntidadeIdGlobal, params: unknown[]): string {
  const partes = ["t.organization_id = $1"];
  if (e.exclusaoLogica) partes.push("t.deleted_at is null");
  const coluna = colunaDiscriminadora(e);
  const internas = variantesInternasDeclaradas(e.tipoEntidade);
  if (coluna && internas.length) {
    params.push(internas);
    partes.push(`(t.${coluna} is null or t.${coluna} <> all($${params.length}::text[]))`);
  }
  return partes.join(" and ");
}

const colunasLidas = (e: EntidadeIdGlobal): string[] => {
  const d = colunaDiscriminadora(e);
  return ["t.id", ...(e.colunaEmpresa ? [`t.${e.colunaEmpresa}`] : []), ...(d ? [`t.${d}`] : []), "t.created_at"];
};

/** Quantos registros elegíveis desta entidade ainda não têm índice global. */
async function contarFaltando(tx: Tx, e: EntidadeIdGlobal, org: string): Promise<number> {
  const params: unknown[] = [org];
  const r = await tx.query<{ n: string }>(
    `select count(*)::text n from ${e.tabela} t
      where ${filtroElegivel(e, params)}
        and not exists (select 1 from erp.registros_globais g
                         where g.organization_id = t.organization_id and g.tipo_entidade = $${params.push(e.tipoEntidade)}
                           and g.id_entidade = t.id)`, params);
  return Number(r.rows[0]!.n);
};

/** Quantos registros elegíveis desta entidade JÁ têm índice global. */
async function contarIndexados(tx: Tx, e: EntidadeIdGlobal, org: string): Promise<number> {
  const params: unknown[] = [org];
  const r = await tx.query<{ n: string }>(
    `select count(*)::text n from ${e.tabela} t
      where ${filtroElegivel(e, params)}
        and exists (select 1 from erp.registros_globais g
                     where g.organization_id = t.organization_id and g.tipo_entidade = $${params.push(e.tipoEntidade)}
                       and g.id_entidade = t.id)`, params);
  return Number(r.rows[0]!.n);
}

/**
 * Um LOTE: lê N pendentes na ordem determinística, resolve a rota de cada um pelo MESMO resolvedor do
 * runtime, reserva a faixa de números e grava. Tudo numa transação curta. Devolve quantos foram gravados.
 */
async function processarLote(tx: Tx, e: EntidadeIdGlobal, org: string, tamanho: number): Promise<number> {
  const params: unknown[] = [org];
  const filtro = filtroElegivel(e, params);
  const tipo = `$${params.push(e.tipoEntidade)}`;
  const r = await tx.query<Record<string, unknown>>(
    `select ${colunasLidas(e).join(", ")} from ${e.tabela} t
      where ${filtro}
        and not exists (select 1 from erp.registros_globais g
                         where g.organization_id = t.organization_id and g.tipo_entidade = ${tipo} and g.id_entidade = t.id)
      order by t.created_at asc, t.id asc
      limit ${tamanho}`, params);
  if (!r.rows.length) return 0;

  const linhas = r.rows.map((linha) => {
    const id = String(linha["id"]);
    const resolvido = resolverRegistroGlobal(e.tipoEntidade, id, linha);
    if (!resolvido) {
      const coluna = colunaDiscriminadora(e);
      throw new Error(
        `INTEGRIDADE: ${e.tipoEntidade} ${id} tem ${coluna ?? "resolução"}=${JSON.stringify(coluna ? linha[coluna] : null)}, ` +
        "que não é variante declarada nem variante interna conhecida. Nada foi gravado neste lote: " +
        "declare a variante no catálogo ou corrija o dado.");
    }
    return {
      id,
      empresa: e.colunaEmpresa ? ((linha[e.colunaEmpresa] as string | null | undefined) ?? null) : null,
      rota: resolvido.rota,
      criadoEm: linha["created_at"] as Date
    };
  });

  const faixa = await tx.query<{ primeiro: string }>("select primeiro from erp.reservar_ids_globais($1, $2)", [org, linhas.length]);
  const primeiro = Number(faixa.rows[0]!.primeiro);

  // `on conflict do nothing`: se uma criação concorrente indexou um destes registros entre a leitura e a
  // escrita, o número DELA vale. Renumerar seria trocar uma identidade que o usuário já pode ter visto.
  // O custo é uma lacuna na sequência — lacuna é permitida; duplicidade não.
  const gravado = await tx.query(
    `insert into erp.registros_globais (organization_id, id_global, tipo_entidade, id_entidade, empresa_id, modulo, rota_canonica, criado_em, criado_por)
     select $1, $2::bigint + (x.ord - 1), $3, x.id::uuid, x.empresa::uuid, $4, x.rota, x.criado_em, null
       from unnest($5::uuid[], $6::uuid[], $7::text[], $8::timestamptz[]) with ordinality as x(id, empresa, rota, criado_em, ord)
     on conflict (organization_id, tipo_entidade, id_entidade) do nothing`,
    [org, primeiro, e.tipoEntidade, e.modulo,
      linhas.map((l) => l.id), linhas.map((l) => l.empresa), linhas.map((l) => l.rota), linhas.map((l) => l.criadoEm)]);
  return gravado.rowCount ?? 0;
}

/** Organizações a processar (todas, ou a informada). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Organizações a percorrer — e o ponto em que "não achei nada" deixa de ser confundido com "não há nada".
 *
 * `--org` é PROVADO contra o banco, não aceito de palavra: um UUID que não existe devolvia lista de uma
 * organização fantasma, zero pendentes e sucesso — um certificado para um alvo inexistente. Sem `--org`,
 * ZERO organizações é ERRO: produção tem organização, e a única forma honesta de ver zero é estar olhando
 * pelo lugar errado (ver `validarPapelOperacional`). "0 organizações, invariantes OK" não certifica nada.
 */
export async function organizacoes(db: Db, org?: string | null): Promise<string[]> {
  if (org) {
    if (!UUID.test(org)) throw new Error(`--org inválido: não é um UUID`);
    const r = await db.query<{ n: string }>("select count(*)::text n from erp.organizations where id=$1", [org]);
    if (!Number(r.rows[0]!.n)) throw new Error(`--org: organização não encontrada nesta conexão`);
    return [org];
  }
  const r = await db.query<{ id: string }>("select id from erp.organizations order by created_at asc, id asc");
  if (!r.rows.length) {
    throw new Error("nenhuma organização visível nesta conexão — recusando certificar um resultado vazio. "
      + "Verifique se o comando está usando a conexão operacional correta.");
  }
  return r.rows.map((x) => x.id);
}

export async function executarBackfill(db: Db, opts: OpcoesBackfill): Promise<ResultadoBackfill> {
  const log = opts.log ?? (() => {});
  const res: ResultadoBackfill = { organizacoes: 0, atribuidos: 0, jaIndexados: 0, faltando: 0, porTipo: {}, problemas: [] };
  const orgs = await organizacoes(db, opts.org);
  res.organizacoes = orgs.length;

  for (const org of orgs) {
    for (const e of ENTIDADES_ORDENADAS) {
      const antes = await withTx(db, SEM_TENANT, (tx) => contarFaltando(tx, e, org));
      const indexados = await withTx(db, SEM_TENANT, (tx) => contarIndexados(tx, e, org));
      res.jaIndexados += indexados;
      if (opts.dryRun || opts.verifyOnly) {
        res.faltando += antes;
        if (antes) { res.porTipo[e.tipoEntidade] = (res.porTipo[e.tipoEntidade] ?? 0) + antes; log(`[${org}] ${e.tipoEntidade}: ${antes} pendente(s)`); }
        continue;
      }
      let lotes = 0;
      for (;;) {
        if (opts.maxLotes && lotes >= opts.maxLotes) break;
        const n = await withTx(db, SEM_TENANT, (tx) => processarLote(tx, e, org, opts.batchSize));
        if (!n) break;
        lotes++; res.atribuidos += n;
        res.porTipo[e.tipoEntidade] = (res.porTipo[e.tipoEntidade] ?? 0) + n;
        log(`[${org}] ${e.tipoEntidade}: lote ${lotes} → ${n} número(s)`);
      }
      res.faltando += await withTx(db, SEM_TENANT, (tx) => contarFaltando(tx, e, org));
    }
  }
  return res;
}

/**
 * INVARIANTES FINAIS — o que precisa ser verdade depois de uma execução completa. Também é o `--verify-only`
 * e o gate de certificação: "os testes passaram" não é o mesmo que "o acervo está numerado".
 */
export async function verificarInvariantes(db: Db, org?: string | null): Promise<string[]> {
  return (await verificar(db, org)).problemas;
}

export interface ResumoVerificacao {
  organizacoes: number;
  entidades: number;
  registrosGlobais: number;
  faltando: number;
  problemas: string[];
}

/**
 * Mesma verificação, com os NÚMEROS que a tornam auditável de relance. Sem eles, "invariantes OK" é uma
 * frase que sobrevive a um banco vazio e a uma conexão cega — o operador precisa ver quantas organizações
 * foram realmente percorridas para reconhecer um resultado absurdo.
 */
export async function verificar(db: Db, org?: string | null): Promise<ResumoVerificacao> {
  const problemas: string[] = [];
  let faltandoTotal = 0;
  let registrosGlobais = 0;
  const orgs = await organizacoes(db, org);
  for (const o of orgs) {
    for (const e of ENTIDADES_ORDENADAS) {
      const faltando = await withTx(db, SEM_TENANT, (tx) => contarFaltando(tx, e, o));
      faltandoTotal += faltando;
      if (faltando) problemas.push(`${e.tipoEntidade}: ${faltando} registro(s) elegível(is) sem ID Global na organização ${o}`);
      // variante interna DECLARADA não pode ter número: seria identidade para o que não tem tela
      const coluna = colunaDiscriminadora(e);
      const internas = variantesInternasDeclaradas(e.tipoEntidade);
      if (coluna && internas.length) {
        const r = await db.query<{ n: string }>(
          `select count(*)::text n from erp.registros_globais g join ${e.tabela} t on t.id = g.id_entidade
            where g.organization_id = $1 and g.tipo_entidade = $2 and t.${coluna} = any($3::text[])`, [o, e.tipoEntidade, internas]);
        if (Number(r.rows[0]!.n)) problemas.push(`${e.tipoEntidade}: ${r.rows[0]!.n} variante(s) INTERNA(s) com ID Global indevido na organização ${o}`);
      }
    }
    // índice órfão: aponta para registro que não existe mais em tabela alguma do catálogo
    for (const e of ENTIDADES_ORDENADAS) {
      const r = await db.query<{ n: string }>(
        `select count(*)::text n from erp.registros_globais g
          where g.organization_id = $1 and g.tipo_entidade = $2
            and not exists (select 1 from ${e.tabela} t where t.id = g.id_entidade and t.organization_id = g.organization_id)`, [o, e.tipoEntidade]);
      if (Number(r.rows[0]!.n)) problemas.push(`${e.tipoEntidade}: ${r.rows[0]!.n} índice(s) global(is) apontando para registro inexistente na organização ${o}`);
    }
    // tipo fora do catálogo
    const tipos = ENTIDADES_ORDENADAS.map((e) => e.tipoEntidade);
    const fora = await db.query<{ tipo_entidade: string; n: string }>(
      "select tipo_entidade, count(*)::text n from erp.registros_globais where organization_id=$1 and tipo_entidade <> all($2::text[]) group by 1", [o, tipos]);
    for (const f of fora.rows) problemas.push(`${f.tipo_entidade}: ${f.n} índice(s) de tipo FORA do catálogo na organização ${o}`);
    // o contador nunca pode ficar abaixo do maior número já entregue
    const seq = await db.query<{ ultimo: string | null; maior: string | null }>(
      `select (select ultimo_valor::text from erp.sequencias_id_global where organization_id=$1) ultimo,
              (select max(id_global)::text from erp.registros_globais where organization_id=$1) maior`, [o]);
    const ultimo = Number(seq.rows[0]?.ultimo ?? 0); const maior = Number(seq.rows[0]?.maior ?? 0);
    if (maior > ultimo) problemas.push(`sequência da organização ${o}: contador ${ultimo} menor que o maior ID entregue ${maior}`);
    const total = await db.query<{ n: string }>("select count(*)::text n from erp.registros_globais where organization_id=$1", [o]);
    registrosGlobais += Number(total.rows[0]!.n);
  }
  // duplicidades são impedidas por PK e UNIQUE; a verificação existe para o caso de alguém as afrouxar
  const dupGlobal = await db.query<{ n: string }>(
    "select count(*)::text n from (select organization_id, id_global from erp.registros_globais group by 1,2 having count(*) > 1) d");
  if (Number(dupGlobal.rows[0]!.n)) problemas.push(`${dupGlobal.rows[0]!.n} par(es) (organização, id_global) duplicado(s)`);
  const dupEntidade = await db.query<{ n: string }>(
    "select count(*)::text n from (select organization_id, tipo_entidade, id_entidade from erp.registros_globais group by 1,2,3 having count(*) > 1) d");
  if (Number(dupEntidade.rows[0]!.n)) problemas.push(`${dupEntidade.rows[0]!.n} mapeamento(s) (organização, tipo, registro) duplicado(s)`);
  return { organizacoes: orgs.length, entidades: ENTIDADES_ORDENADAS.length, registrosGlobais, faltando: faltandoTotal, problemas };
}

// --------------------------------------------------------------------------------------------------
// CONEXÃO OPERACIONAL — de onde este comando fala com o banco, e por que não é a conexão da API
// --------------------------------------------------------------------------------------------------
/**
 * A API conecta como `erp_app`, SEM bypass de RLS — é assim que ela deve ser, e não vai mudar por causa
 * deste comando. Mas este comando percorre TODAS as organizações sem contexto de tenant (`SEM_TENANT`), e
 * `erp.organizations` tem RLS: pela conexão da API, `select id from erp.organizations` sem `app.org_id`
 * pode devolver ZERO LINHAS.
 *
 * O perigo não é o erro — é a AUSÊNCIA dele. Zero organizações vira zero pendentes, zero atribuídos e
 * "invariantes OK", com milhares de registros históricos sem número do outro lado da política. Um
 * certificado falso é pior que uma falha, porque ninguém volta para conferir.
 *
 * Por isso NÃO existe `?? process.env.DATABASE_URL`: aceitar a variável da API como último recurso
 * reconstruiria exatamente esse caminho, e bastaria um operador esquecer de exportar a variável certa.
 * Sem conexão operacional declarada, o comando NÃO RODA.
 */
export function resolverUrlOperacional(env: NodeJS.ProcessEnv): string {
  const url = env.ID_GLOBAL_DATABASE_URL || env.MIGRATE_DATABASE_URL;
  if (!url) {
    throw new Error("MIGRATE_DATABASE_URL não definida para o backfill operacional "
      + "(ou ID_GLOBAL_DATABASE_URL). A conexão da API (DATABASE_URL) NÃO serve: ela passa por RLS e "
      + "faria este comando certificar um acervo que não consegue enxergar.");
  }
  return url;
}

export interface PapelOperacional { usuario: string; superusuario: boolean; bypassRls: boolean }

/** O papel realmente conectado — o NOME da variável de ambiente não prova nada sobre ele. */
export async function inspecionarPapel(db: Db): Promise<PapelOperacional> {
  const r = await db.query<{ usuario: string; rolsuper: boolean; rolbypassrls: boolean }>(
    "select current_user as usuario, r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user");
  const linha = r.rows[0];
  if (!linha) throw new Error("não foi possível inspecionar o papel da conexão operacional");
  return { usuario: linha.usuario, superusuario: linha.rolsuper, bypassRls: linha.rolbypassrls };
}

/** Atravessa a RLS de verdade? É a única pergunta que importa para um comando que varre todos os tenants. */
export const papelAtravessaRls = (p: PapelOperacional): boolean => p.superusuario || p.bypassRls;

/**
 * PREFLIGHT: recusa ANTES de contar organizações, para que um papel sem travessia nunca chegue a produzir
 * um número. A saída é o operador usar a conexão correta — NUNCA a aplicação conceder o que lhe falta:
 * `alter role erp_app bypassrls`, `set role`, desligar RLS ou um `security definer` genérico para o
 * backfill destruiriam, cada um deles, a separação entre runtime e operação que existe de propósito.
 *
 * O erro cita o NOME do papel (identificador, não credencial). Nenhum DSN, host ou senha é impresso.
 */
export async function validarPapelOperacional(db: Db): Promise<PapelOperacional> {
  const papel = await inspecionarPapel(db);
  if (!papelAtravessaRls(papel)) {
    throw new Error(`conexão operacional recusada: o papel "${papel.usuario}" não tem rolsuper nem `
      + "rolbypassrls e, sob RLS, enxergaria um acervo vazio. Use a conexão de operação (erp_migrator).");
  }
  return papel;
}

/** Lê as opções da linha de comando. Nunca imprime DSN, senha nem qualquer segredo. */
export function lerOpcoes(argv: readonly string[]): OpcoesBackfill {
  const valor = (nome: string): string | undefined => {
    const i = argv.indexOf(`--${nome}`);
    if (i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1];
    const inline = argv.find((a) => a.startsWith(`--${nome}=`));
    return inline ? inline.slice(nome.length + 3) : undefined;
  };
  const n = Number(valor("batch-size") ?? 500);
  if (!Number.isSafeInteger(n) || n < 1 || n > 50_000) throw new Error(`--batch-size inválido: ${valor("batch-size")}`);
  return { batchSize: n, org: valor("org") ?? null, dryRun: argv.includes("--dry-run"), verifyOnly: argv.includes("--verify-only") };
}

async function main() {
  const opts = lerOpcoes(process.argv.slice(2));
  let url: string;
  try { url = resolverUrlOperacional(process.env); }
  catch (e) { console.error((e as Error).message); process.exit(2); return; }
  const db = createPool(url, { max: 4 });
  const inicio = Date.now();
  try {
    const papel = await validarPapelOperacional(db);
    console.log(`conexão operacional: papel "${papel.usuario}" (rolsuper=${papel.superusuario}, rolbypassrls=${papel.bypassRls}).`);
    if (opts.verifyOnly) {
      const r = await verificar(db, opts.org);
      console.log(`organizações verificadas: ${r.organizacoes} · entidades verificadas: ${r.entidades} · `
        + `registros globais: ${r.registrosGlobais} · elegíveis faltando: ${r.faltando}`);
      if (r.problemas.length) { console.error("INVARIANTES VIOLADAS:"); for (const p of r.problemas) console.error(`  - ${p}`); process.exit(1); }
      console.log("ID Global: invariantes OK (zero elegível sem número, zero duplicidade, zero órfão).");
      return;
    }
    const r = await executarBackfill(db, { ...opts, log: (m) => console.log(m) });
    console.log(`\norganizações: ${r.organizacoes} · atribuídos agora: ${r.atribuidos} · já indexados: ${r.jaIndexados} · ` +
      `${opts.dryRun ? "pendentes" : "faltando ao fim"}: ${r.faltando} · ${Math.round((Date.now() - inicio) / 1000)}s`);
    for (const [t, n] of Object.entries(r.porTipo).sort()) console.log(`  ${t}: ${n}`);
    if (opts.dryRun) { console.log("\n--dry-run: nada foi gravado."); return; }
    const v = await verificar(db, opts.org);
    console.log(`\norganizações verificadas: ${v.organizacoes} · entidades verificadas: ${v.entidades} · `
      + `registros globais: ${v.registrosGlobais} · elegíveis faltando: ${v.faltando}`);
    if (v.problemas.length) { console.error("\nINVARIANTES VIOLADAS:"); for (const p of v.problemas) console.error(`  - ${p}`); process.exit(1); }
    console.log("\nInvariantes OK: zero registro elegível sem ID Global.");
  } catch (e) {
    // Mensagem apenas: um stack trace de erro de conexão pode carregar a DSN inteira para o log.
    console.error(`backfill do ID Global: ${(e as Error).message}`);
    process.exitCode = 2;
  } finally { await db.end(); }
}

if (process.argv[1] && process.argv[1].includes("id-global-backfill")) await main();
