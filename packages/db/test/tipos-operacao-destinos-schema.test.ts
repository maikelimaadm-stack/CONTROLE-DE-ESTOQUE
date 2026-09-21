import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * O GRAFO DE PRÓXIMAS OPERAÇÕES, PROVADO CONTRA O BANCO (0022).
 *
 * A promessa central desta tabela não é "guardar pares de ids": é tornar IMPOSSÍVEL o estado que uma lista
 * de UUIDs dentro do JSON deixaria passar — aresta para TOP de outro tenant, aresta para versão que não é
 * da TOP de origem, aresta órfã, política de versão já emitida reescrita depois.
 *
 * Duas conexões, e a diferença é o teste: `db` é o papel de migração (superusuário, IGNORA RLS) e serve
 * para montar cenário e exercitar gatilho/constraint; `app` é `erp_app_test`, herdeiro de `erp_app`, sem
 * bypass — só ele prova isolamento e só ele prova privilégio.
 */
let db: Db; let app: Db; let demo: DemoOrg;
beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
});
afterAll(async () => { await app.end(); await db.end(); });

/** Cria uma TOP com a versão 1 e devolve os dois ids que o grafo precisa: o da TOP e o da VERSÃO. */
async function criarTop(codigo: string, base: string, orgId = demo.orgId): Promise<{ id: string; versaoId: string }> {
  return withTx(db, { orgId, userId: demo.adminUserId, modulo: null }, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao (organization_id, codigo, codigo_base, criado_por)
       values ($1,$2,$3,$4) returning id`, [orgId, codigo, base, demo.adminUserId]);
    const id = r.rows[0]!.id;
    const v = await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, criado_por)
       values ($1,$2,1,$3,$4) returning id`, [orgId, id, `Nome de ${codigo}`, demo.adminUserId]);
    return { id, versaoId: v.rows[0]!.id };
  });
}

async function aresta(origemVersaoId: string, origemId: string, destinoId: string, ordem = 0, orgId = demo.orgId) {
  return db.query(
    `insert into erp.tipos_operacao_versao_destinos
       (organization_id, origem_versao_id, origem_tipo_operacao_id, destino_tipo_operacao_id, ordem, criado_por)
     values ($1,$2,$3,$4,$5,$6)`,
    [orgId, origemVersaoId, origemId, destinoId, ordem, demo.adminUserId]);
}

/**
 * INSERT do binário ANTIGO, ao pé da letra: a lista de colunas NÃO cita `destinos_configurados`. Está
 * escrito literal de propósito — um construtor que montasse a lista de colunas esconderia justamente o que
 * este helper existe para exibir, que é a AUSÊNCIA da coluna no comando.
 */
async function versaoDoBinarioAntigo(topId: string, numero: number, orgId = demo.orgId): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, criado_por)
     values ($1,$2,$3,$4,$5) returning id`,
    [orgId, topId, numero, `Versao ${numero} do binario antigo`, demo.adminUserId]);
  return r.rows[0]!.id;
}

/** INSERT do binário NOVO: a política é declarada explicitamente, e a declaração viaja na própria versão. */
async function versaoDeclarada(topId: string, numero: number, configurados: boolean, orgId = demo.orgId): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into erp.tipos_operacao_versoes
       (organization_id, tipo_operacao_id, versao, nome, destinos_configurados, criado_por)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [orgId, topId, numero, `Versao ${numero} declarada`, configurados, demo.adminUserId]);
  return r.rows[0]!.id;
}

let seq = 0;
const codigo = () => `D${String(++seq).padStart(3, "0")}`;

describe("0022 — o grafo existe e tem integridade", () => {
  it("a tabela existe com RLS habilitada E forçada, e com UMA única política", async () => {
    const rls = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='erp' and c.relname='tipos_operacao_versao_destinos'`);
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    // Política ÚNICA: PERMISSIVE combinam com OR, e duas conviventes valeriam sempre pela mais frouxa.
    const pol = await db.query(`select 1 from pg_policies where schemaname='erp' and tablename='tipos_operacao_versao_destinos'`);
    expect(pol.rowCount, "exatamente uma política de RLS").toBe(1);
  });

  it("uma aresta legítima é aceita — a PREMISSA de todas as recusas abaixo", async () => {
    // Sem esta prova, "o banco recusa tudo" passaria igual e os testes de recusa não provariam nada.
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await expect(aresta(o.versaoId, o.id, d.id)).resolves.toBeTruthy();
    const r = await db.query(`select 1 from erp.tipos_operacao_versao_destinos where origem_versao_id=$1`, [o.versaoId]);
    expect(r.rowCount).toBe(1);
  });

  it("a FK da ORIGEM prova PARENTESCO: a versão precisa ser DAQUELA TOP", async () => {
    const a = await criarTop(codigo(), "vendas.orcamento");
    const b = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    // A versão é da TOP `a`, mas a aresta afirma que a origem é a TOP `b`. Sem a FK COMPOSTA isso passaria,
    // e o leque de `b` passaria a ser lido a partir da política de `a`.
    await expect(aresta(a.versaoId, b.id, d.id)).rejects.toThrow(/fk_tipos_operacao_versao_destinos_origem/);
  });

  it("a FK do DESTINO prova TENANT: não existe aresta para TOP de outra organização", async () => {
    const outra = "00000000-0000-4000-8000-0000000000c0";
    await db.query(`insert into erp.organizations(id,name,legal_name,document,slug) values ($1,'[TEST] Org grafo','[TEST] Org grafo Ltda','00000000000272','orggrafo') on conflict (id) do nothing`, [outra]);
    const o = await criarTop(codigo(), "vendas.orcamento");
    const estrangeira = await criarTop(codigo(), "vendas.pedido", outra);
    // Coluna única não prova tenant: é a chave COMPOSTA (destino, organização) que recusa.
    await expect(aresta(o.versaoId, o.id, estrangeira.id))
      .rejects.toThrow(/fk_tipos_operacao_versao_destinos_destino/);
  });

  it("o mesmo destino não entra duas vezes na mesma versão", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id, 0);
    // Duplicar não acrescenta política nenhuma e faria a tela oferecer a mesma opção duas vezes.
    await expect(aresta(o.versaoId, o.id, d.id, 1)).rejects.toThrow(/uq_tipos_operacao_versao_destinos/);
  });

  it("laço sobre a PRÓPRIA TOP é recusado pelo banco", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    // "Deste pedido gere outro pedido desta mesma TOP" não descreve operação de negócio nenhuma.
    await expect(aresta(o.versaoId, o.id, o.id)).rejects.toThrow(/ck_tipos_operacao_versao_destinos_sem_laco/);
  });

  it("ciclo entre TOPs DIFERENTES não é barrado — e isso é deliberado", async () => {
    const a = await criarTop(codigo(), "vendas.pedido");
    const b = await criarTop(codigo(), "vendas.venda");
    await aresta(a.versaoId, a.id, b.id);
    // A → B e B → A. Uma devolução que gera reentrada é um ciclo legítimo; barrar a FORMA do grafo
    // proibiria casos reais. Quem limita é a compatibilidade de família, na borda.
    await expect(aresta(b.versaoId, b.id, a.id)).resolves.toBeTruthy();
  });
});

describe("0022 — a aresta é tão imutável quanto a versão que a ancora", () => {
  it("UPDATE é recusado pelo gatilho", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id);
    // Editar a política de uma versão JÁ EMITIDA reescreveria a explicação de conversões que já aconteceram.
    await expect(db.query(`update erp.tipos_operacao_versao_destinos set ordem=9 where origem_versao_id=$1`, [o.versaoId]))
      .rejects.toThrow(/TIPO_OPERACAO_DESTINO_IMUTAVEL/);
  });

  it("DELETE é recusado pelo gatilho", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id);
    await expect(db.query(`delete from erp.tipos_operacao_versao_destinos where origem_versao_id=$1`, [o.versaoId]))
      .rejects.toThrow(/TIPO_OPERACAO_DESTINO_IMUTAVEL/);
  });

  it("a aplicação NÃO tem UPDATE nem DELETE nesta tabela", async () => {
    // O `grant` sozinho não bastaria: os default privileges da 0007 já concedem os quatro privilégios a
    // toda tabela nova do schema. O que prova a revogação explícita é esta consulta.
    const r = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema='erp' and table_name='tipos_operacao_versao_destinos' and grantee='erp_app'
          and privilege_type in ('UPDATE','DELETE')`);
    expect(r.rows).toEqual([]);
  });

  it("excluir a TOP de destino é LÓGICO e a aresta histórica permanece legível", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id);
    await db.query(`update erp.tipos_operacao set excluido_em=now() where id=$1`, [d.id]);
    // A política continua registrando que aquele caminho existiu — é isso que faz uma conversão já
    // realizada continuar explicável. Quem some é a OFERTA, e isso é filtro de leitura, não exclusão.
    const r = await db.query(`select 1 from erp.tipos_operacao_versao_destinos where origem_versao_id=$1`, [o.versaoId]);
    expect(r.rowCount, "a aresta não é apagada pela exclusão lógica do destino").toBe(1);
  });

  it("DELETE FÍSICO da TOP de destino é TRAVADO pela FK — sem cascata", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id);
    // `on delete cascade` apagaria em silêncio a política que explica por que um documento pôde virar outro.
    await expect(db.query(`delete from erp.tipos_operacao where id=$1`, [d.id])).rejects.toThrow();
  });
});

describe("0022 — isolamento por tenant do grafo", () => {
  it("ISOLAMENTO sob RLS: a organização B não lê a aresta da A pelo papel da aplicação", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    const d = await criarTop(codigo(), "vendas.pedido");
    await aresta(o.versaoId, o.id, d.id);

    const outraOrg = "00000000-0000-4000-8000-0000000000b0";
    const r = await withTx(app, { orgId: outraOrg, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query(`select 1 from erp.tipos_operacao_versao_destinos where origem_versao_id = $1`, [o.versaoId]));
    expect(r.rowCount, "a organização B não lê a aresta da A").toBe(0);

    // A PREMISSA CONTADA: a organização A LÊ a própria aresta. Sem isto, "B não lê" seria verdade de graça
    // se a consulta estivesse simplesmente errada.
    const a = await withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query(`select 1 from erp.tipos_operacao_versao_destinos where origem_versao_id = $1`, [o.versaoId]));
    expect(a.rowCount, "a organização A lê a própria aresta").toBe(1);
  });
});

/**
 * `destinos_configurados`: o DISCRIMINADOR que separa "nunca declarou" de "declarou que não há destino".
 *
 * Sem ele, o único sinal disponível é a CARDINALIDADE das arestas — e zero aresta é o mesmo número nos dois
 * casos, que têm significados OPOSTOS: um manda cair na cadeia antiga, o outro manda recusar a conversão.
 * Nenhum teste de aresta acima enxerga essa diferença, porque ela não mora na aresta: mora na VERSÃO, junto
 * com o resto da política histórica, e herda dela a imutabilidade.
 *
 * O `DEFAULT` da coluna sustenta DUAS coisas, e só UMA delas é observável aqui. Este arquivo roda sobre
 * banco FRESCO, onde não existe versão anterior à 0022: o que ele prova é o ROLLING DEPLOY (INSERT que não
 * cita a coluna). A outra metade — o ACERVO preenchido por DDL numa tabela que recusa UPDATE — exige linhas
 * escritas ANTES da migration, e por isso vive em `tipos-operacao-destinos-acervo.test.ts`.
 */
describe("0022 — `destinos_configurados` separa LEGADO de POLÍTICA DECLARADA VAZIA", () => {
  it("a coluna existe na VERSÃO, é booleana, NOT NULL e mantém DEFAULT false", async () => {
    const r = await db.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_schema='erp' and table_name='tipos_operacao_versoes' and column_name='destinos_configurados'`);
    expect(r.rowCount, "a coluna precisa existir em tipos_operacao_versoes").toBe(1);
    expect(r.rows[0]!.data_type).toBe("boolean");
    // NOT NULL fecha a TERCEIRA leitura. `null` seria "não se sabe se declarou", e não existe caminho no
    // servidor que trate esse estado: ele viraria, na prática, um dos dois outros por acidente de código.
    expect(r.rows[0]!.is_nullable, "sem NOT NULL apareceria um terceiro estado que ninguém trata").toBe("NO");
    // O DEFAULT sustenta DUAS coisas ao mesmo tempo, e é por isso que ele PERMANECE depois da migration:
    // o ACERVO (a tabela recusa UPDATE, então preencher linha antiga só é possível pelo DDL) e o ROLLING
    // DEPLOY (o binário antigo insere versão sem citar a coluna; sem DEFAULT o NOT NULL derrubaria a
    // criação de TOP no meio da implantação).
    expect(r.rows[0]!.column_default, "o DEFAULT precisa continuar lá, e precisa ser false").toBe("false");
  });

  it("a coluna NÃO existe no pai: política histórica não mora em `tipos_operacao`", async () => {
    // Se morasse no pai, editar o cadastro hoje reescreveria a explicação de todo documento já emitido —
    // e, pior, haveria DUAS fontes para a mesma pergunta, com a segunda envelhecendo em silêncio.
    const r = await db.query(
      `select 1 from information_schema.columns
        where table_schema='erp' and table_name='tipos_operacao' and column_name='destinos_configurados'`);
    expect(r.rowCount, "o discriminador pertence à versão, não à TOP").toBe(0);
  });

  it("A3 — versão inserida SEM citar a coluna nasce `false`: é o rolling deploy", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    // Exatamente o INSERT do binário ANTIGO: ele não conhece a coluna e tampouco sabe declarar política.
    // Nascer `false` é a descrição EXATA do que aconteceu naquele INSERT, não um palpite conservador.
    const nova = await versaoDoBinarioAntigo(o.id, 2);
    const r = await db.query<{ destinos_configurados: boolean }>(
      `select destinos_configurados from erp.tipos_operacao_versoes where id=$1`, [nova]);
    expect(r.rowCount, "a versão do binário antigo precisa ter sido aceita — é metade da prova").toBe(1);
    expect(r.rows[0]!.destinos_configurados).toBe(false);
  });

  it("versão inserida com `true` PERMANECE `true`, e a irmã não declarada permanece `false`", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    await versaoDeclarada(o.id, 2, true);
    await versaoDoBinarioAntigo(o.id, 3);
    // As três linhas saem da MESMA consulta e da MESMA TOP: é isso que prova que o valor é por LINHA, e
    // que declarar na versão 2 não promoveu nem a anterior nem a seguinte.
    const r = await db.query<{ versao: number; configurados: boolean }>(
      `select versao, destinos_configurados as configurados
         from erp.tipos_operacao_versoes where tipo_operacao_id=$1 order by versao`, [o.id]);
    expect(r.rows.map((x) => [x.versao, x.configurados])).toEqual([[1, false], [2, true], [3, false]]);
  });

  it("UPDATE da coluna é recusado pelo gatilho da 0020 — ela herda a imutabilidade da versão", async () => {
    const o = await criarTop(codigo(), "vendas.orcamento");
    // PREMISSA: o valor que se tenta mudar está lá e é o que se afirma. Sem isto, a recusa abaixo poderia
    // estar acontecendo por a linha não existir.
    const antes = await db.query<{ d: boolean }>(
      `select destinos_configurados as d from erp.tipos_operacao_versoes where id=$1`, [o.versaoId]);
    expect(antes.rowCount).toBe(1);
    expect(antes.rows[0]!.d).toBe(false);

    // Declarar política é criar a versão N+1, como mudar nome ou configuração. Reescrever a bandeira de uma
    // versão JÁ EMITIDA mudaria retroativamente o que um documento de ontem pode virar hoje.
    await expect(db.query(
      `update erp.tipos_operacao_versoes set destinos_configurados = true where id=$1`, [o.versaoId]))
      .rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);

    const depois = await db.query<{ d: boolean }>(
      `select destinos_configurados as d from erp.tipos_operacao_versoes where id=$1`, [o.versaoId]);
    expect(depois.rows[0]!.d, "a recusa não pode ter deixado efeito parcial").toBe(false);
  });

  it("nenhum gatilho NOVO foi criado para a coluna: a proteção herdada é a única verdade", async () => {
    // Um segundo gatilho sobre a mesma tabela seria uma segunda afirmação sobre a mesma regra, e as duas
    // divergiriam no dia em que só uma fosse alterada.
    const r = await db.query<{ tgname: string }>(
      `select t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='erp' and c.relname='tipos_operacao_versoes' and not t.tgisinternal
        order by t.tgname`);
    expect(r.rows.map((x) => x.tgname)).toEqual(["trg_tipos_operacao_versoes_imutavel"]);
  });

  it("`true` com ZERO arestas é estado VÁLIDO e representável — e a cardinalidade sozinha não o distingue do legado", async () => {
    const destino = await criarTop(codigo(), "vendas.pedido");
    const top = await criarTop(codigo(), "vendas.orcamento"); // versão 1: nasceu antes de haver o que declarar
    const vazia = await versaoDeclarada(top.id, 2, true);     // declarou: NENHUM próximo passo
    const cheia = await versaoDeclarada(top.id, 3, true);     // declarou: exatamente um destino
    await aresta(cheia, top.id, destino.id);

    // Esta é a consulta que monta `Próximos passos`: a bandeira da versão ao lado da CONTAGEM de arestas
    // daquela versão. O `left join` é obrigatório — com `join` a versão de política vazia sumiria da
    // resposta, que é a forma mais silenciosa de confundi-la com o legado.
    const r = await db.query<{ versao: number; configurados: boolean; arestas: string }>(
      `select v.versao, v.destinos_configurados as configurados, count(d.id)::text as arestas
         from erp.tipos_operacao_versoes v
         left join erp.tipos_operacao_versao_destinos d on d.origem_versao_id = v.id
        where v.tipo_operacao_id = $1
        group by v.versao, v.destinos_configurados
        order by v.versao`, [top.id]);
    expect(r.rows.map((x) => [x.versao, x.configurados, Number(x.arestas)])).toEqual([
      [1, false, 0], // LEGADO: nunca declarou — só aqui a ponte da cadeia antiga tem o direito de valer
      [2, true, 0],  // DECLARADO VAZIO: zero próximos passos, e a conversão tem de ser RECUSADA
      [3, true, 1],  // DECLARADO com um destino: exatamente aquele caminho é permitido
    ]);

    // O QUE AS DUAS PRIMEIRAS LINHAS PROVAM, E É O DEFEITO INTEIRO: mesma contagem, significados opostos.
    // Quem decide por `arestas.length > 0` lê as duas como "não configurado" e converte justamente onde o
    // administrador declarou que não há próximo passo.
    const zeroArestas = r.rows.filter((x) => Number(x.arestas) === 0);
    expect(zeroArestas.length, "duas versões com zero arestas").toBe(2);
    expect(new Set(zeroArestas.map((x) => x.configurados)).size,
      "…e elas só são separáveis pela coluna, nunca pela contagem").toBe(2);

    // A versão de política vazia existe de fato como LINHA — não é ausência de linha disfarçada de vazio.
    const v = await db.query(`select 1 from erp.tipos_operacao_versoes where id=$1 and destinos_configurados`, [vazia]);
    expect(v.rowCount, "a versão declarada vazia é uma linha real, com a bandeira ligada").toBe(1);
    const semArestas = await db.query(`select 1 from erp.tipos_operacao_versao_destinos where origem_versao_id=$1`, [vazia]);
    expect(semArestas.rowCount, "e ela não tem nenhuma aresta").toBe(0);
  });

  it("a bandeira atravessa o papel da aplicação sob RLS: A lê a própria, B não lê a da A", async () => {
    const top = await criarTop(codigo(), "vendas.orcamento");
    const declarada = await versaoDeclarada(top.id, 2, true);

    // A PREMISSA: sob o papel SEM bypass de RLS, a organização dona lê a bandeira e lê o valor CERTO.
    // Sem isto, "B não lê" seria verdade de graça se a coluna não fosse legível por ninguém.
    const a = await withTx(app, { orgId: demo.orgId, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query<{ d: boolean }>(`select destinos_configurados as d from erp.tipos_operacao_versoes where id=$1`, [declarada]));
    expect(a.rowCount, "a organização A lê a própria versão").toBe(1);
    expect(a.rows[0]!.d).toBe(true);

    const outraOrg = "00000000-0000-4000-8000-0000000000b0";
    const b = await withTx(app, { orgId: outraOrg, userId: demo.adminUserId, modulo: null }, (tx) =>
      tx.query(`select destinos_configurados from erp.tipos_operacao_versoes where id=$1`, [declarada]));
    expect(b.rowCount, "a organização B não lê a política da A").toBe(0);
  });
});
