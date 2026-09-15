/**
 * G-U5 — O BINÁRIO ANTERIOR DA API CONTRA O BANCO PÓS-0017.
 *
 * PERGUNTA QUE ESTE GATE RESPONDE. Durante a janela de deploy da PRE-BASE2-05C-1 o pré-deploy aplica a
 * 0017 e SÓ DEPOIS troca o processo da API. Entre um instante e outro existe um intervalo real em que o
 * binário que está no ar é o ANTERIOR (main @ ec5e771, que não conhece a 0017) e o banco já está purgado.
 * Se alguma consulta desse binário dependesse de coluna, view ou função removida pela 0017, a aplicação
 * quebraria nesse intervalo — e a evidência que vale é ela RODANDO, não um grep dizendo que não achou
 * `farm_id`. Auditoria estática não vê SQL montado em tempo de execução, nem view consultada por dentro de
 * outra view, nem função chamada por trigger. Por isso este gate sobe a API de verdade e fala HTTP com ela.
 *
 * POR QUE AQUI, E NÃO EM `packages/db/test/`. A missão sugeriu `packages/db/test/purga-0017-runtime-anterior.test.ts`
 * e abriu a alternativa de propor outro lugar. Três razões para este ser um script de gate:
 *   1. o sujeito do teste é o BINÁRIO de `apps/api` (dist compilado), não o pacote `@agro/db`. Um teste em
 *      `packages/db` faria o pacote de baixo depender do artefato de build do pacote de cima — inversão de
 *      camada que `.claude/rules/architecture.md` proíbe no código e que aqui apareceria como dependência
 *      de ORDEM não declarada: `pnpm --filter @agro/db test:integration` passaria ou falharia conforme
 *      alguém tivesse rodado `pnpm build` antes, e a falha não falaria sobre a purga;
 *   2. o gate precisa de um PROCESSO e de uma PORTA TCP. Isso é orquestração de deploy, não teste de unidade
 *      nem de integração de repositório;
 *   3. o gate precisa provar, antes de tudo, que o CÓDIGO que ele sobe é o de `ec5e771`. Essa prova é uma
 *      comparação de git, natural num script e estranha dentro de um `describe`.
 *
 * NÃO É GATE DE PRODUÇÃO. Roda só contra laboratório local (127.0.0.1:5433) — a checagem está logo abaixo e
 * não tem contorno. Nada aqui toca Supabase, Railway ou Vercel.
 *
 * COMO RODAR (banco é criado antes, à parte):
 *   psql "postgresql://postgres@127.0.0.1:5433/postgres" -c "create database d_gu5_lab"
 *   pnpm --filter @agro/db build && pnpm --filter @agro/api build
 *   node scripts/gate-purga-0017-runtime-anterior.mjs d_gu5_lab
 *
 * SAÍDA: 0 = o binário anterior sobrevive ao banco pós-0017. Diferente de 0 = BLOQUEADOR, com a mensagem
 * exata do que falhou. Todo número afirmado abaixo é CONTADO; nenhuma asserção passa por conjunto vazio.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../packages/db/dist/pool.js";
import { migrate, resetSchema } from "../packages/db/dist/migrate.js";
import { seedReference, seedDemo } from "../packages/db/dist/seed.js";
import { permissionRows } from "../packages/domain/dist/index.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_REF = process.env.BASE_REF ?? "ec5e771";
const BANCO = process.argv[2] ?? "d_gu5_lab";

// -------------------------------------------------------------------------------------------------
// CERCA DE LABORATÓRIO. Montada a partir do nome do banco, nunca de DSN recebida por ambiente: assim não
// existe valor de entrada capaz de apontar este script para outro host.
// -------------------------------------------------------------------------------------------------
if (!/^[a-z][a-z0-9_]{2,40}$/.test(BANCO) || /prod|producao|supabase|railway/i.test(BANCO)) {
  throw new Error(`nome de banco recusado: ${BANCO}`);
}
const DSN = `postgresql://postgres@127.0.0.1:5433/${BANCO}`;

// Segredo de ASSINATURA DE TOKEN de um laboratório descartável. Não é credencial de nenhum ambiente real e
// não abre nada: o banco é criado e destruído por esta execução.
const SEGREDO_LAB = "gu5-laboratorio-local-sem-valor";

const evidencias = [];
let falhas = 0;
const ok = (id, texto) => { evidencias.push(`  OK   ${id}  ${texto}`); };
const falhar = (id, texto) => { falhas++; evidencias.push(`  FALHA ${id}  ${texto}`); };
function exigir(id, condicao, texto) { condicao ? ok(id, texto) : falhar(id, texto); return condicao; }

const git = async (args) => (await exec("git", args, { cwd: RAIZ })).stdout.trim();

function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// =================================================================================================
async function main() {
  const db = createPool(DSN, { max: 6 });
  let api = null;
  let motivo = null;
  const logApi = [];
  try {
    // -------------------------------------------------------------------------------------------
    // FASE 1 — O CÓDIGO QUE VAI SUBIR É O DE ec5e771?
    // A fatia da 05C-1 acrescenta migration, testes, documentos e este gate; nada disso é compilado para
    // dentro da API. Se TODO caminho que entra no binário for idêntico ao da base, subir a API daqui É
    // subir o binário anterior — e a prova é o hash de cada caminho, não a leitura do diff.
    // -------------------------------------------------------------------------------------------

    // O que entra no BINÁRIO é só `src/` (todo tsconfig.build.json do monorepo tem `include: ["src"]`) mais
    // os manifestos que fixam a resolução de dependência. Arquivo de teste, script `.mjs` de auditoria e
    // documento não são compilados — e como outras fatias editam esses caminhos em paralelo, exigir a
    // árvore INTEIRA limpa reprovaria por motivo alheio ao que este gate mede.
    const COMPILADOS = ["apps/api/src", "packages/db/src", "packages/domain/src", "packages/shared/src",
                        "packages/plataforma/src", "apps/api/package.json", "packages/db/package.json",
                        "packages/domain/package.json", "packages/shared/package.json",
                        "packages/plataforma/package.json", "pnpm-lock.yaml"];
    const sujo = (await git(["status", "--porcelain", "--", ...COMPILADOS])).trim();

    // A comparação é POR CAMINHO COMPILADO, não pelas árvores inteiras de `apps/` e `packages/`.
    // A versão anterior comparava `HEAD:apps` e `HEAD:packages` com a base, o que contradizia o próprio
    // raciocínio acima: assim que a fatia commitasse qualquer coisa nesses diretórios — um teste novo, um
    // SSOT `.mjs` que ninguém importa — o gate se recusava a rodar por um motivo que não é o que ele mede.
    // Comparar caminho a caminho é ao mesmo tempo mais estrito (diz QUAL caminho divergiu) e mais honesto
    // (só reprova quando o que divergiu entra mesmo no binário).
    const divergentes = [];
    for (const caminho of COMPILADOS) {
      const base = await git(["rev-parse", `${BASE_REF}:${caminho}`]).catch(() => "ausente-na-base");
      const head = await git(["rev-parse", `HEAD:${caminho}`]).catch(() => "ausente-no-head");
      if (base !== head) divergentes.push(caminho);
    }
    exigir("F1.1", divergentes.length === 0,
      `todo caminho COMPILADO identico a ${BASE_REF} (${COMPILADOS.length} caminhos)${divergentes.length ? " — divergem: " + divergentes.join(", ") : ""}`);
    exigir("F1.2", sujo === "", `nenhuma modificacao local no que compila (src/ e manifestos) [${sujo || "limpo"}]`);
    if (falhas) throw new Error("o codigo compilado desta arvore NAO e o de " + BASE_REF + " (" + divergentes.join(", ") + "): use `git worktree add` no commit base e construa a API la.");

    // Reconstrói ANTES de subir. Sem isto o gate mediria um `dist/` de origem desconhecida — possivelmente
    // de outra fatia, possivelmente antigo — e o veredito não falaria sobre o código que acabou de ser
    // conferido logo acima.
    for (const alvo of ["@agro/shared", "@agro/domain", "@erp/plataforma", "@agro/db", "@agro/api"]) {
      const b = await exec("pnpm", ["--filter", alvo, "build"], { cwd: RAIZ });
      if (!exigir("F1.4:" + alvo, b.code === 0, `build de ${alvo} => codigo ${b.code}`)) {
        throw new Error(`build de ${alvo} falhou:\n${b.stdout}\n${b.stderr}`);
      }
    }

    // -------------------------------------------------------------------------------------------
    // FASE 2 — BANCO PÓS-0017, MONTADO AGORA
    // -------------------------------------------------------------------------------------------
    await resetSchema(db);
    const aplicadas = await migrate(db, () => {});
    exigir("F2.1", aplicadas.length === 17, `migrations aplicadas: ${aplicadas.length} (esperado 17)`);
    exigir("F2.2", aplicadas.at(-1) === "0017_purge_farm_legacy.sql", `ultima migration: ${aplicadas.at(-1)}`);

    // -------------------------------------------------------------------------------------------
    // FASE 3 — A PREMISSA, CONTADA. Sem isto o gate inteiro passaria por vacuidade: uma API saudável
    // contra um banco AINDA COM a ponte não prova absolutamente nada sobre a purga.
    // -------------------------------------------------------------------------------------------
    const um = async (sql, params) => (await db.query(sql, params)).rows[0];
    const colunas = await um(`select count(*)::int n from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='erp' and c.relkind='r' and a.attnum>0
      and not a.attisdropped and a.attname in ('farm_id','origin_farm_id','destination_farm_id')`);
    const views = await um(`select count(*)::int n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
      where ns.nspname='erp' and c.relkind='v' and c.relname in
      ('farms','proprietary_farms','authorizer_farms','bank_account_farms','farm_cost_centers')`);
    const gatilhos = await um(`select count(*)::int n from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where not t.tgisinternal and p.proname like 'sincronizar_empresa%'`);
    const funcoes = await um(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='erp' and p.proname like 'sincronizar_empresa%'`);
    const compostas = await um(`select count(*)::int n from pg_constraint k join pg_class c on c.oid=k.conrelid
      join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='erp' and k.contype='f'
      and array_length(k.conkey,1)=2 and k.confrelid='erp.empresas'::regclass and k.convalidated`);
    const cheque = await um(`select count(*)::int n from pg_constraint where conrelid='erp.equipment_transfers'::regclass
      and contype='c' and conname='equipment_transfers_empresa_origem_destino_check' and convalidated`);
    exigir("F3.1", colunas.n === 0, `colunas legadas no catalogo: ${colunas.n} (esperado 0)`);
    exigir("F3.2", views.n === 0, `views de nome antigo: ${views.n} (esperado 0)`);
    exigir("F3.3", gatilhos.n === 0, `gatilhos de espelho: ${gatilhos.n} (esperado 0)`);
    exigir("F3.4", funcoes.n === 0, `funcoes erp.sincronizar_empresa*: ${funcoes.n} (esperado 0)`);
    exigir("F3.5", compostas.n === 50, `FKs compostas canonicas validadas: ${compostas.n} (esperado 50)`);
    exigir("F3.6", cheque.n === 1, `CHECK canonico de transferencia: ${cheque.n} (esperado 1)`);
    if (falhas) throw new Error("o banco de laboratorio NAO esta pos-0017; qualquer verde daqui para a frente seria vacuo.");

    // -------------------------------------------------------------------------------------------
    // FASE 4 — ACERVO. Um banco com zero linha responde 200 para tudo e não prova nada.
    // -------------------------------------------------------------------------------------------
    await seedReference(db, () => {});
    const demo = await seedDemo(db, {}, () => {});
    const [e1, e2] = demo.empresaIds;
    const armazensSemeados = await um("select count(*)::int n from erp.warehouses where organization_id=$1", [demo.orgId]);
    exigir("F4.1", demo.empresaIds.length === 2, `empresas semeadas: ${demo.empresaIds.length} (esperado 2)`);
    exigir("F4.2", armazensSemeados.n >= 6, `armazens semeados: ${armazensSemeados.n} (esperado >= 6, 3 por empresa)`);

    // -------------------------------------------------------------------------------------------
    // FASE 5 — BOOT REAL DO BINÁRIO ANTERIOR
    // -------------------------------------------------------------------------------------------
    const porta = await portaLivre();
    api = spawn(process.execPath, ["dist/main.js"], {
      cwd: path.join(RAIZ, "apps", "api"),
      env: { ...process.env, NODE_ENV: "test", DATABASE_URL: DSN, AUTH_MODE: "local",
             LOCAL_AUTH_SECRET: SEGREDO_LAB, PORT: String(porta), HOST: "127.0.0.1",
             API_LOG_LEVEL: "warn", WEB_ORIGIN: "http://127.0.0.1:3000",
             // A varredura da fase 9 dispara centenas de requisições em segundos. O teto padrão (300/min)
             // é proteção de borda, não objeto deste gate: recusa por excesso de requisição mascararia a
             // resposta real da rota, que é o que se quer medir.
             RATE_LIMIT_MAX: "100000", LOGIN_RATE_LIMIT_MAX: "1000" }
    });
    api.stdout.on("data", (d) => logApi.push(String(d)));
    api.stderr.on("data", (d) => logApi.push(String(d)));
    let morreu = null;
    api.on("exit", (code, sig) => { morreu = `code=${code} sig=${sig}`; });

    const base = `http://127.0.0.1:${porta}`;
    let saude = null;
    for (let i = 0; i < 150 && !morreu; i++) {
      try { const r = await fetch(`${base}/health`); if (r.ok) { saude = await r.json(); break; } } catch { /* ainda subindo */ }
      await dormir(200);
    }
    exigir("F5.1", morreu === null, `processo da API vivo apos o boot [${morreu ?? "vivo"}]`);
    exigir("F5.2", saude?.status === "ok" && saude?.db === "ok", `GET /health => ${JSON.stringify(saude)}`);
    if (!saude) throw new Error("a API do binario anterior NAO subiu contra o banco pos-0017. Log:\n" + logApi.join(""));

    // -------------------------------------------------------------------------------------------
    // FASE 6 — LOGIN REAL POR HTTP
    // -------------------------------------------------------------------------------------------
    const login = await fetch(`${base}/api/auth/login`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: demo.adminEmail, password: demo.adminPassword }) });
    const loginBody = await login.json();
    exigir("F6.1", login.status === 200 && typeof loginBody.token === "string" && loginBody.token.length > 20,
      `POST /api/auth/login => ${login.status}, token emitido: ${typeof loginBody.token === "string"}`);
    if (login.status !== 200) throw new Error("login recusado: " + JSON.stringify(loginBody));
    const token = loginBody.token;

    const H = (empresaId) => ({ authorization: `Bearer ${token}`, "x-org-id": demo.orgId,
      ...(empresaId ? { "x-empresa-id": empresaId } : {}), "content-type": "application/json" });
    const get = async (rota, empresaId) => {
      const r = await fetch(`${base}${rota}`, { headers: H(empresaId) });
      let body = null; try { body = await r.json(); } catch { body = null; }
      return { status: r.status, body };
    };

    const ctxResp = await get("/api/auth/context");
    exigir("F6.2", ctxResp.status === 200 && Array.isArray(ctxResp.body?.empresas) && ctxResp.body.empresas.length === 2,
      `GET /api/auth/context => ${ctxResp.status}, empresas visiveis: ${ctxResp.body?.empresas?.length}`);

    // -------------------------------------------------------------------------------------------
    // FASE 7 — LEITURA ESCOPADA POR EMPRESA
    // `warehouses` é `empresaScoped` e a tabela `erp.warehouses` perdeu `farm_id` e o índice legado
    // `warehouses_organization_id_farm_id_idx` na 0017. Se o recorte ainda dependesse da ponte, é aqui
    // que apareceria: ou erro, ou a lista errada.
    // -------------------------------------------------------------------------------------------
    const a1 = await get("/api/resources/warehouses?pageSize=100", e1);
    const a2 = await get("/api/resources/warehouses?pageSize=100", e2);
    // A página da listagem genérica é `{ items, page, pageSize, total }`.
    const linhas = (r) => (Array.isArray(r.body?.items) ? r.body.items : []);
    const l1 = linhas(a1), l2 = linhas(a2);
    exigir("F7.1", a1.status === 200 && l1.length > 0, `GET warehouses (empresa 1) => ${a1.status}, ${l1.length} linha(s), total=${a1.body?.total}`);
    exigir("F7.2", a2.status === 200 && l2.length > 0, `GET warehouses (empresa 2) => ${a2.status}, ${l2.length} linha(s), total=${a2.body?.total}`);
    // `every` sobre lista vazia é verdadeiro: sem o `length > 0` estas três asserções passariam com a API
    // devolvendo nada, que é justamente o modo de falha que elas existem para pegar.
    exigir("F7.3", l1.length > 0 && l1.every((x) => x.empresa_id === e1), `toda linha da empresa 1 tem empresa_id da empresa 1 (${l1.filter((x) => x.empresa_id === e1).length}/${l1.length})`);
    exigir("F7.4", l2.length > 0 && l2.every((x) => x.empresa_id === e2), `toda linha da empresa 2 tem empresa_id da empresa 2 (${l2.filter((x) => x.empresa_id === e2).length}/${l2.length})`);
    const ids1 = new Set(l1.map((x) => x.id));
    exigir("F7.5", l1.length > 0 && l2.length > 0 && l2.every((x) => !ids1.has(x.id)), `as duas listas sao disjuntas (nenhum dos ${l2.length} ids da empresa 2 aparece nos ${l1.length} da empresa 1)`);
    // A conferência contra o próprio banco: a API não pode estar escondendo linha que existe no escopo.
    const noBanco = await um("select count(*)::int n from erp.warehouses where organization_id=$1 and empresa_id=$2 and deleted_at is null", [demo.orgId, e1]);
    exigir("F7.6", noBanco.n === l1.length, `linhas da empresa 1 no banco: ${noBanco.n}; devolvidas pela API: ${l1.length}`);

    // -------------------------------------------------------------------------------------------
    // FASE 8 — ESCRITA REAL, E ROW COUNT CONFERIDO NO BANCO
    // -------------------------------------------------------------------------------------------
    const sigla = "G5" + String(Date.now()).slice(-3);
    const escrita = await fetch(`${base}/api/resources/warehouses`, { method: "POST", headers: H(e1),
      body: JSON.stringify({ empresa_id: e1, initials: sigla, description: "Armazem gate G-U5", type: "inputs" }) });
    const criado = await escrita.json();
    exigir("F8.1", escrita.status === 201 && typeof criado.id === "string",
      `POST /api/resources/warehouses => ${escrita.status} ${escrita.status === 201 ? "" : JSON.stringify(criado)}`);
    const conferencia = await db.query(
      "select id, empresa_id, organization_id from erp.warehouses where organization_id=$1 and initials=$2", [demo.orgId, sigla]);
    exigir("F8.2", conferencia.rowCount === 1, `ROW COUNT no banco para a sigla ${sigla}: ${conferencia.rowCount} (esperado 1)`);
    exigir("F8.3", conferencia.rows[0]?.empresa_id === e1, `a linha gravada esta na empresa pedida (empresa_id confere)`);
    exigir("F8.4", conferencia.rows[0]?.id === criado.id, `o id devolvido pelo HTTP e o id gravado`);
    // Leitura de volta pela mesma rota: o registro novo entra no escopo da empresa que o criou.
    const releitura = await get(`/api/resources/warehouses/${criado.id}`, e1);
    exigir("F8.5", releitura.status === 200 && releitura.body?.initials === sigla,
      `GET /api/resources/warehouses/:id do registro novo => ${releitura.status}`);

    // -------------------------------------------------------------------------------------------
    // FASE 8b — A ESCRITA MAIS EXPOSTA DA FATIA: TRANSFERÊNCIA DE BEM
    // `erp.equipment_transfers` é a tabela que a 0017 mexeu mais: perdeu DUAS colunas legadas
    // (origin_farm_id, destination_farm_id), perdeu dois gatilhos de espelho, perdeu o CHECK legado e
    // GANHOU o CHECK canônico. E a rota escreve nela E em `erp.equipments` (que também perdeu coluna e
    // gatilho) na mesma transação. Se a purga tivesse quebrado alguma escrita, aqui seria o lugar.
    // -------------------------------------------------------------------------------------------
    const bem = await um("select id from erp.equipments where organization_id=$1 and empresa_id=$2 order by code limit 1", [demo.orgId, e1]);
    exigir("F8b.1", !!bem?.id, `bem semeado na empresa 1 para transferir: ${bem?.id ? "sim" : "nao"}`);
    const transf = await fetch(`${base}/api/fleet/equipment-transfers`, { method: "POST", headers: H(e1),
      body: JSON.stringify({ equipment_id: bem.id, empresa_destino_id: e2, transfer_date: new Date().toISOString().slice(0, 10) }) });
    const transfBody = await transf.json();
    exigir("F8b.2", transf.status === 201 && typeof transfBody.id === "string",
      `POST /api/fleet/equipment-transfers => ${transf.status} ${transf.status === 201 ? `codigo ${transfBody.code}` : JSON.stringify(transfBody)}`);
    const linhaTransf = await db.query("select empresa_origem_id, empresa_destino_id from erp.equipment_transfers where organization_id=$1 and id=$2", [demo.orgId, transfBody.id]);
    exigir("F8b.3", linhaTransf.rowCount === 1, `ROW COUNT da transferencia gravada: ${linhaTransf.rowCount} (esperado 1)`);
    exigir("F8b.4", linhaTransf.rows[0]?.empresa_origem_id === e1 && linhaTransf.rows[0]?.empresa_destino_id === e2,
      `origem e destino canonicos gravados corretamente`);
    const bemDepois = await um("select empresa_id from erp.equipments where id=$1", [bem.id]);
    exigir("F8b.5", bemDepois.empresa_id === e2, `o bem mudou de empresa na tabela erp.equipments (efeito colateral da mesma transacao)`);

    // O CHECK canônico criado pela 0017 precisa REPROVAR de verdade. Vai direto no banco porque a rota
    // barra antes (validação de aplicação); o que se mede aqui é a invariante no banco, que é a que
    // sobrevive a qualquer caminho de escrita.
    let recusou = false, msgCheck = "";
    try {
      await db.query(`insert into erp.equipment_transfers(organization_id,code,transfer_date,equipment_id,empresa_origem_id,empresa_destino_id,created_by)
                      values ($1,'G5X',current_date,$2,$3,$3,$4)`, [demo.orgId, bem.id, e2, demo.adminUserId]);
    } catch (e) { recusou = true; msgCheck = String(e.message).slice(0, 120); }
    exigir("F8b.6", recusou && /equipment_transfers_empresa_origem_destino_check/.test(msgCheck),
      `CHECK canonico recusa origem = destino: ${recusou ? msgCheck : "ACEITOU (invariante perdida)"}`);

    // -------------------------------------------------------------------------------------------
    // FASE 9 — VARREDURA: NENHUMA CONSULTA PODE DEPENDER DE OBJETO REMOVIDO
    // Este é o item 8 da missão. Os alvos NÃO são uma lista escrita à mão: vêm do próprio servidor
    // (`GET /api/resources` e `GET /api/reports`) mais as rotas GET sem parâmetro de caminho. Um 5xx, ou
    // qualquer resposta que fale de objeto inexistente, é BLOQUEADOR — é exatamente o sintoma de consulta
    // presa à ponte removida. 4xx de contrato (filtro obrigatório ausente, capacidade) é resposta legítima
    // do binário e fica registrado como tal.
    // -------------------------------------------------------------------------------------------
    const listaRecursos = await get("/api/resources");
    const listaRelatorios = await get("/api/reports");
    const chavesRecurso = (listaRecursos.body ?? []).map((r) => r.key);
    const chavesRelatorio = (listaRelatorios.body ?? []).map((r) => r.key);
    exigir("F9.1", chavesRecurso.length > 50, `recursos anunciados pelo servidor: ${chavesRecurso.length}`);
    exigir("F9.2", chavesRelatorio.length > 10, `relatorios anunciados pelo servidor: ${chavesRelatorio.length}`);

    const rotasFixas = ROTAS_GET_SEM_PARAMETRO;
    const alvos = [
      ...rotasFixas,
      ...chavesRecurso.map((k) => `/api/resources/${k}?pageSize=5`),
      ...chavesRecurso.map((k) => `/api/resources/${k}/definition`),
      ...chavesRecurso.map((k) => `/api/resources/${k}/options?search=a`),
      ...chavesRelatorio.map((k) => `/api/reports/${k}`)
    ];
    const quebradas = [];
    const citamPurgado = [];
    const objetoInexistente = new Set();
    let duasXX = 0, quatroXX = 0;
    for (const alvo of alvos) {
      for (const emp of [e1, null]) {
        const r = await get(alvo, emp);
        const texto = JSON.stringify(r.body ?? "");
        if (r.status >= 500) quebradas.push(`${alvo} [empresa=${emp ? "1" : "-"}] => ${r.status} ${texto.slice(0, 300)}`);
        if (PURGADOS.test(texto)) citamPurgado.push(`${alvo} => ${texto.slice(0, 300)}`);
        if (/does not exist|undefined column|undefined table/i.test(texto)) objetoInexistente.add(alvo.split("?")[0]);
        if (r.status < 300) duasXX++; else if (r.status < 500) quatroXX++;
      }
    }
    exigir("F9.3", quebradas.length === 0, `respostas 5xx em ${alvos.length * 2} chamadas: ${quebradas.length}${quebradas.length ? "\n         " + quebradas.slice(0, 15).join("\n         ") : ""}`);
    exigir("F9.4", citamPurgado.length === 0, `respostas citando objeto PURGADO pela 0017: ${citamPurgado.length}${citamPurgado.length ? "\n         " + citamPurgado.slice(0, 15).join("\n         ") : ""}`);
    /**
     * "column ... does not exist" separado em dois: o que a 0017 causou (F9.4, zero tolerância) e o que já
     * existia em ec5e771. Estas três rotas devolvem 422 com o mesmo `detail` do PostgreSQL contra um banco
     * 0001..0016, SEM a purga — foram conferidas assim, num banco de controle com as 52 colunas e as 5 views
     * legadas ainda de pé. Não são efeito desta fatia e não podem ser usadas para reprovar a purga; também
     * não podem ser esquecidas, então ficam NOMEADAS. A lista só encolhe: rota nova que passe a vazar
     * objeto inexistente reprova aqui.
     */
    const sobrando = [...objetoInexistente].filter((x) => !PRE_EXISTENTES_EC5E771.includes(x));
    const sumiram = PRE_EXISTENTES_EC5E771.filter((x) => !objetoInexistente.has(x));
    exigir("F9.5", sobrando.length === 0, `rotas NAO declaradas vazando objeto inexistente: ${sobrando.length} [${sobrando.join(", ")}]`);
    exigir("F9.6", sumiram.length === 0, `defeitos pre-existentes declarados que nao reproduziram (lista desatualizada): ${sumiram.length} [${sumiram.join(", ")}]`);
    exigir("F9.7", duasXX > alvos.length, `chamadas 2xx na varredura: ${duasXX} (4xx de contrato: ${quatroXX}) — a varredura exercitou consulta de verdade`);

    // O log do processo também é evidência: erro de SQL aparece ali mesmo quando a rota devolve 200.
    const logJunto = logApi.join("");
    const gritos = logJunto.match(PURGADOS_G) ?? [];
    exigir("F9.8", gritos.length === 0, `mencoes a objeto purgado no log do processo: ${gritos.length}`);

    // -------------------------------------------------------------------------------------------
    // FASE 10 — O CAMINHO DE PRÉ-DEPLOY: `node dist/migrate.js` (migrate + seedPermissions)
    // É o comando que o Railway roda antes de trocar o processo. Contra o banco já pós-0017 ele não tem
    // migration pendente, mas AINDA roda seedPermissions — e é esse trecho que precisa completar.
    // -------------------------------------------------------------------------------------------
    const antes = await um("select count(*)::int n from erp.permissions");
    const pre = await exec(process.execPath, ["dist/migrate.js"], {
      cwd: path.join(RAIZ, "apps", "api"),
      env: { ...process.env, DATABASE_URL: DSN, MIGRATE_DATABASE_URL: DSN, SEED_ON_DEPLOY: "" }
    });
    const esperadas = permissionRows().length;
    const depois = await um("select count(*)::int n from erp.permissions");
    const concedidas = await um(`select count(*)::int n from erp.role_permissions rp
      join erp.roles r on r.id=rp.role_id where r.is_system and r.name='Administrador'`);
    exigir("F10.1", pre.code === 0, `node dist/migrate.js saiu com codigo ${pre.code}${pre.code ? "\n         stderr: " + pre.stderr.slice(0, 600) : ""}`);
    exigir("F10.2", /migrations aplicadas: \[\]/.test(pre.stdout), `nada pendente a aplicar: ${pre.stdout.trim().split("\n")[0]}`);
    exigir("F10.3", esperadas > 100 && depois.n === esperadas, `erp.permissions: ${depois.n} linha(s); catalogo do codigo: ${esperadas} (antes do pre-deploy: ${antes.n})`);
    exigir("F10.4", concedidas.n === esperadas, `role_permissions do perfil de sistema "Administrador": ${concedidas.n} (esperado ${esperadas})`);

    // Idempotência: o pré-deploy roda a cada deploy, inclusive em retentativa.
    const segunda = await exec(process.execPath, ["dist/migrate.js"], {
      cwd: path.join(RAIZ, "apps", "api"),
      env: { ...process.env, DATABASE_URL: DSN, MIGRATE_DATABASE_URL: DSN, SEED_ON_DEPLOY: "" }
    });
    const depois2 = await um("select count(*)::int n from erp.permissions");
    exigir("F10.5", segunda.code === 0 && depois2.n === esperadas, `segunda execucao do pre-deploy: codigo ${segunda.code}, erp.permissions ${depois2.n}`);

    // -------------------------------------------------------------------------------------------
    // FASE 11 — A API CONTINUA VIVA DEPOIS DE TUDO
    // -------------------------------------------------------------------------------------------
    const saudeFinal = await get("/health");
    exigir("F11.1", morreu === null && saudeFinal.status === 200, `processo vivo e /health => ${saudeFinal.status} apos ${alvos.length * 2} chamadas e 2 pre-deploys`);
  } catch (e) {
    // Interrupção precoce (premissa reprovada, build quebrado, API que não subiu) ainda precisa mostrar O
    // QUE reprovou. Um gate que morre sem dizer onde obriga quem opera a reexecutar às cegas.
    motivo = e instanceof Error ? e.message : String(e);
  } finally {
    if (api && api.exitCode === null) { api.kill("SIGTERM"); await dormir(400); if (api.exitCode === null) api.kill("SIGKILL"); }
    await db.end().catch(() => {});
  }

  console.log(`\nG-U5 — binario anterior (${BASE_REF}) x banco pos-0017 (${BANCO})\n`);
  console.log(evidencias.join("\n"));
  if (motivo) console.log(`\n  INTERROMPIDO: ${motivo}`);
  console.log(`\n${falhas === 0 && !motivo ? "APROVADO" : `BLOQUEADOR: ${falhas} asercao(oes) reprovada(s)`}\n`);
  if (falhas || motivo) process.exit(1);
}

/**
 * Nomes que a 0017 removeu do banco. Se qualquer um deles aparecer numa resposta HTTP ou no log do
 * processo, alguma consulta do binário anterior ainda dependia da ponte — que é o defeito que este gate
 * existe para encontrar.
 */
const ALVO_PURGADO = "farm_id|origin_farm_id|destination_farm_id|sincronizar_empresa|erp\\.farms|proprietary_farms|authorizer_farms|bank_account_farms|farm_cost_centers";
const PURGADOS = new RegExp(ALVO_PURGADO, "i");
const PURGADOS_G = new RegExp(ALVO_PURGADO, "gi");

/**
 * Rotas de ec5e771 que já vazavam `detail` do PostgreSQL ANTES da 0017 (conferido em banco 0001..0016).
 * Defeito real, de outra fatia; aqui só impede que ele seja confundido com estrago da purga.
 */
const PRE_EXISTENTES_EC5E771 = [
  "/api/stock/corrections",
  "/api/resources/supply_status_sla",
  "/api/resources/supply_status_sla/options"
];

/**
 * Rotas GET sem parâmetro de caminho, transcritas de `apps/api/src/routes/*.ts` em ec5e771. As que TÊM
 * parâmetro precisam de um id existente e entram na varredura pelas chaves que o próprio servidor anuncia.
 */
const ROTAS_GET_SEM_PARAMETRO = [
  "/health", "/health/live",
  "/api/auth/me", "/api/auth/context",
  "/api/admin/audit", "/api/admin/members", "/api/admin/modulos-empresa", "/api/admin/notifications",
  "/api/admin/parameters", "/api/admin/permissions", "/api/admin/roles",
  "/api/assets/depreciation-forecast", "/api/assets/depreciations",
  "/api/attachments?entity=warehouses&entity_id=00000000-0000-0000-0000-000000000000",
  "/api/dashboards/assets", "/api/dashboards/cash-book", "/api/dashboards/depreciation",
  "/api/dashboards/feed-consumption", "/api/dashboards/feedlot", "/api/dashboards/feedlot-cost",
  "/api/dashboards/feedlot-performance", "/api/dashboards/financial", "/api/dashboards/home",
  "/api/dashboards/livestock", "/api/dashboards/nutrition-stock", "/api/dashboards/rainfall",
  "/api/dashboards/supply", "/api/dashboards/user-analysis",
  "/api/feedlot/deliveries", "/api/feedlot/diet-batches", "/api/feedlot/map",
  "/api/financial/bank-accounts/balances", "/api/financial/bank-movements", "/api/financial/cash-flow",
  "/api/financial/ofx-imports", "/api/financial/ofx-report", "/api/financial/tax-accounts",
  "/api/fleet/alerts", "/api/fleet/equipment-transfers", "/api/fleet/fuel-supplies", "/api/fleet/maintenances",
  "/api/hr/advances", "/api/hr/earnings",
  "/api/livestock/animals", "/api/livestock/handlings", "/api/livestock/herd-lots", "/api/livestock/locate",
  "/api/livestock/matings", "/api/livestock/movements", "/api/livestock/processings",
  "/api/livestock/reproduction/overview", "/api/livestock/weighings",
  "/api/plataforma/idioma", "/api/preferences/bootstrap",
  "/api/reports", "/api/resources", "/api/saved-reports", "/api/saved-reports/resources",
  "/api/sales/abc", "/api/service-orders", "/api/service-orders-monitoring",
  "/api/stock/balances", "/api/stock/corrections", "/api/stock/devolutions", "/api/stock/dfe",
  "/api/stock/dfe-drafts", "/api/stock/feed-batches", "/api/stock/feed-formulas", "/api/stock/input-entries",
  "/api/stock/invoices", "/api/stock/movements", "/api/stock/opening-balances", "/api/stock/requisitions",
  "/api/stock/transfers", "/api/stock/writeoffs",
  "/api/supply/requests", "/api/supply/requests/counts", "/api/supply/sla"
];

await main();
