#!/usr/bin/env node
/**
 * GERADOR E GATE da matriz de escopo das notificações (docs/NOTIFICATION-SCOPE-MATRIX.md).
 *
 * A caixa de notificações é uma porta DINÂMICA: a autorização de cada linha vem da fonte funcional dela.
 * Isso é fácil de descrever errado num documento escrito à mão — e um documento errado sobre autorização é
 * pior que nenhum, porque é ele que se lê na revisão seguinte. Aqui o documento é DERIVADO das duas fontes
 * que decidem de verdade: o registry (packages/domain/src/notificacoes.ts) e o catálogo do banco
 * (supabase/migrations/0012_notification_scope.sql).
 *
 * O gate também exige PROVA: todo tipo precisa de um teste nomeado nesta tabela. Sem isso, um tipo novo
 * entraria na matriz como linha "não auditada" — exatamente o que a matriz existe para não ter.
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const DOC = path.join(RAIZ, "docs", "NOTIFICATION-SCOPE-MATRIX.md");
const REGISTRY = path.join(RAIZ, "packages", "domain", "src", "notificacoes.ts");
const MIGRATION = path.join(RAIZ, "supabase", "migrations", "0012_notification_scope.sql");

/** Teste que PROVA o comportamento de cada tipo. Tipo sem prova derruba o gate. */
const PROVAS = {
  purchase_pending: "notificacao-escopo: “não vaza notificação da Empresa A”; notificacao-geracao: refresh",
  processing_pending: "notificacao-geracao: “dois processamentos na mesma empresa … geram DOIS avisos”",
  batch_transfer: "notificacao-geracao: “duas transferências … geram DOIS avisos” + destino de outra organização",
  document_expiring: "notificacao-geracao: “documento sem empresa … da organização; com empresa, da empresa”",
  birthday: "notificacao-geracao: “aniversário é da organização e cada aniversariante tem o seu aviso”",
  stock_min: "notificacao-geracao: “estoque mínimo continua sendo agregado da organização”",
  title_due: "notificacao-geracao: “títulos a pagar são contados POR EMPRESA”"
};

const QUEM_VE = {
  organizacao: "qualquer membro da organização COM a capacidade",
  empresa: "quem tem a capacidade E acesso àquela empresa NAQUELE módulo",
  modulo_todas: "só proprietário ou quem tem modo `todas` naquele módulo (nunca `selecionadas`)"
};

const ts = fs.readFileSync(REGISTRY, "utf8");
const sql = fs.readFileSync(MIGRATION, "utf8");

/** Tipos declarados no registry, na ordem em que aparecem. */
const tipos = [];
for (const bloco of ts.split(/\n  \{\n/).slice(1)) {
  const campo = (nome) => bloco.match(new RegExp(`${nome}:\\s*"([^"]+)"`))?.[1] ?? null;
  const kind = campo("kind");
  if (!kind) continue;
  tipos.push({
    kind, rotulo: campo("rotulo"), permissionKey: campo("permissionKey"),
    escopo: campo("escopo"), modulo: campo("modulo"),
    empresaOpcional: /empresaOpcional:\s*true/.test(bloco),
    origem: campo("origem")
  });
}

/** Combinações que o BANCO aceita gravar (erp.tipos_notificacao). */
const catalogo = [];
{
  const bloco = sql.split("insert into erp.tipos_notificacao")[1]?.split("on conflict")[0] ?? "";
  for (const m of bloco.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z_-]+)'\s*,\s*'([a-z_.]+)'\s*,\s*'([^']*)'/g)) {
    catalogo.push({ kind: m[1], escopo: m[2], moduloRef: m[3], permissao: m[4], observacao: m[5] });
  }
}

const problemas = [];
if (tipos.length === 0) problemas.push("nenhum tipo lido de packages/domain/src/notificacoes.ts");
if (catalogo.length === 0) problemas.push("nenhuma combinação lida de erp.tipos_notificacao");
for (const t of tipos) {
  if (!PROVAS[t.kind]) problemas.push(`${t.kind}: sem teste declarado em PROVAS — a matriz não admite linha não auditada`);
  const canonica = catalogo.some((c) => c.kind === t.kind && c.escopo === t.escopo && c.moduloRef === (t.modulo ?? "-") && c.permissao === t.permissionKey);
  if (!canonica) problemas.push(`${t.kind}: forma canônica do registry ausente do catálogo do banco`);
}
for (const c of catalogo) if (!tipos.some((t) => t.kind === c.kind)) problemas.push(`${c.kind}: existe no catálogo do banco e não no registry`);
if (problemas.length) {
  console.error("notification-matrix: fontes inconsistentes:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}

const esc = (s) => String(s ?? "—").replace(/\|/g, "\\|");
const linhas = [];
linhas.push("# Matriz de escopo das notificações");
linhas.push("");
linhas.push("<!-- GERADO por scripts/notification-matrix.mjs — não edite à mão. Gate: `node scripts/notification-matrix.mjs --check`. -->");
linhas.push("");
linhas.push("A caixa de notificações é uma **porta dinâmica**: a autorização de cada linha não vem da caixa, vem da");
linhas.push("FONTE funcional daquela linha. Um aviso só chega a quem tem a CAPACIDADE da fonte **e** o ESCOPO dela —");
linhas.push("interseção, nunca união. O link dar 404 depois não corrige nada: o título já teria informado.");
linhas.push("");
linhas.push("As duas fontes desta matriz decidem de verdade: o registry `packages/domain/src/notificacoes.ts`");
linhas.push("(o que o runtime cria) e `erp.tipos_notificacao` (o que o banco aceita gravar, por chave estrangeira).");
linhas.push("");
linhas.push("## Os três escopos");
linhas.push("");
linhas.push("| Escopo | Significado | Quem enxerga |");
linhas.push("| --- | --- | --- |");
linhas.push(`| \`organizacao\` | não depende de empresa nenhuma | ${QUEM_VE.organizacao} |`);
linhas.push(`| \`empresa\` | pertence a UMA empresa concreta | ${QUEM_VE.empresa} |`);
linhas.push(`| \`modulo_todas\` | agregado real da organização dentro de um módulo | ${QUEM_VE.modulo_todas} |`);
linhas.push("");
linhas.push("`selecionadas` cobrindo todas as empresas de hoje **não** é `todas`: a empresa criada amanhã entraria no");
linhas.push("agregado sem entrar na autorização de quem o recebe.");
linhas.push("");
linhas.push("## Tipo por tipo");
linhas.push("");
linhas.push("| Tipo | Rótulo | Escopo | Módulo | Capacidade | De onde sai a empresa |");
linhas.push("| --- | --- | --- | --- | --- | --- |");
for (const t of tipos) {
  const escopo = `\`${t.escopo}\`` + (t.empresaOpcional ? " — sem empresa vira `organizacao`" : "");
  linhas.push(`| \`${t.kind}\` | ${esc(t.rotulo)} | ${escopo} | ${t.modulo ? `\`${t.modulo}\`` : "—"} | \`${t.permissionKey}\` | ${esc(t.origem)} |`);
}
linhas.push("");
linhas.push("## O que o banco aceita gravar");
linhas.push("");
linhas.push("Combinação fora desta tabela é recusada por `notifications_tipo_fk`. É o que impede um aviso de compra");
linhas.push("nascer como aviso de organização e alcançar quem não enxerga a empresa de origem — por rota, por");
linhas.push("migration futura ou por `psql`.");
linhas.push("");
linhas.push("| Tipo | Escopo | Módulo | Capacidade | Por quê |");
linhas.push("| --- | --- | --- | --- | --- |");
for (const c of catalogo) {
  linhas.push(`| \`${c.kind}\` | \`${c.escopo}\` | ${c.moduloRef === "-" ? "—" : `\`${c.moduloRef}\``} | \`${c.permissao}\` | ${esc(c.observacao)} |`);
}
linhas.push("");
linhas.push("## Prova");
linhas.push("");
linhas.push("Cada tipo tem um teste que o exercita de ponta a ponta. Tipo sem prova derruba este gate — a matriz não");
linhas.push("admite linha “não auditada”.");
linhas.push("");
linhas.push("| Tipo | Teste |");
linhas.push("| --- | --- |");
for (const t of tipos) linhas.push(`| \`${t.kind}\` | ${esc(PROVAS[t.kind])} |`);
linhas.push("");
linhas.push("Além da matriz por tipo, `apps/api/test/integration/notificacao-escopo.test.ts` prova a LEITURA:");
linhas.push("nada da Empresa A aparece para quem só enxerga a B (lista, contador ou alvo de “marcar como lida”),");
linhas.push("o recibo de leitura é por usuário, e marcar uma notificação invisível responde 404, não 403.");
linhas.push("");
linhas.push("## Leitura e janela");
linhas.push("");
linhas.push("A caixa devolve as **50 mais recentes entre as que o usuário pode ver** — a autorização entra no `where`,");
linhas.push("antes do `limit`; o contrário devolveria “as 50 mais recentes da organização, menos as proibidas”.");
linhas.push("O contador de não lidas usa exatamente a mesma regra de visibilidade (`visibilidadeNotificacaoSql`) e");
linhas.push("conta sem o limite da janela, então em caixas com mais de 50 avisos visíveis ele pode ser maior que a");
linhas.push("lista. É diferença de JANELA, não de autoridade: nada contado está fora do que o usuário pode ver.");
linhas.push("");
linhas.push("A leitura é do usuário (`erp.notificacao_leituras`), não do aviso: `erp.notifications.read_at` é legado.");
linhas.push("A política de RLS amarra o recibo ao usuário da sessão — nem pelo papel da aplicação se grava leitura");
linhas.push("em nome de outro.");
linhas.push("");

const texto = linhas.join("\n");
const check = process.argv.includes("--check");
const atual = fs.existsSync(DOC) ? fs.readFileSync(DOC, "utf8") : "";
if (check) {
  if (atual !== texto) {
    console.error("docs/NOTIFICATION-SCOPE-MATRIX.md desatualizado: rode `node scripts/notification-matrix.mjs` e commite o resultado.");
    process.exit(1);
  }
  console.log(`notification-matrix: OK (${tipos.length} tipos, ${catalogo.length} combinações)`);
} else {
  fs.writeFileSync(DOC, texto);
  console.log(`notification-matrix: docs/NOTIFICATION-SCOPE-MATRIX.md gerado (${tipos.length} tipos, ${catalogo.length} combinações)`);
}
