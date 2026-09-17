import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db, type DemoOrg } from "@agro/db";
import { SEQUENCIA_WAREHOUSE_TRANSFER } from "../../src/lib/sequencia-warehouse-transfer.js";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * NUMERAÇÃO DE `erp.warehouse_transfers` — HOTFIX PRÉ-BASE2-03.
 *
 * O DEFEITO QUE ESTA SUÍTE FECHA
 * ------------------------------
 * `erp.warehouse_transfers` tem `unique (organization_id, code)`. A unicidade NÃO inclui `kind`, logo
 * existe UM namespace de código por organização para a tabela inteira. A rota, porém, numerava com dois
 * contadores (`warehouse_transfer` para `kind='warehouse'`, `farm_transfer` para `kind='farm'`), e
 * `erp.code_sequences` tem PK `(organization_id, entity)`: duas chaves são DUAS LINHAS, com dois
 * `last_value` independentes. Os dois emitiam `0001` para a mesma coluna, e a segunda variante criada
 * numa organização morria no índice único com 409 — quebrando justamente a transferência ENTRE EMPRESAS.
 *
 * A BASE2-02 encontrou isso pelo E2E e registrou como PENDING sem corrigir, porque numeração visível de
 * documento estava fora da fronteira daquela fatia. Este arquivo é a prova pela PORTA REAL de que a
 * correção vale: rota, login, RequestContext, transação de verdade.
 *
 * POR QUE PELA ROTA, E NÃO PELO CONTADOR
 * -------------------------------------
 * `packages/db/test/hotfix-0019-upgrade.test.ts` mede o CONTADOR: reconciliação, alias, matriz de estados.
 * Isso não prova o que o usuário vive. Entre `erp.next_code` e o `insert` existe a rota inteira — o
 * `idempotent`, o `postStock` das duas pontas, o `atribuirIdGlobal`, o rateio financeiro — e é lá que a
 * colisão aparecia, como 409 na tela. Uma suíte que só olhasse o contador continuaria verde com a rota
 * quebrada, porque o defeito nunca foi do contador: era do CASAMENTO entre a chave escolhida e a
 * unicidade da tabela.
 *
 * O LIMITE DESTA SUÍTE, MEDIDO E DECLARADO
 * ----------------------------------------
 * Esta suíte NÃO é o gate contra a rota voltar a numerar por variante, e isso foi verificado, não
 * suposto: com a rota sabotada de volta para `d.kind === "farm" ? "farm_transfer" : ...`, os nove casos
 * daqui continuam VERDES.
 *
 * A razão é o alias da 0019: `erp.next_code` canonicaliza `farm_transfer` antes do `insert`, então pedir a
 * chave antiga e pedir a canônica produzem as MESMAS linhas. Nenhum experimento de comportamento separa os
 * dois — e é exatamente essa indistinguibilidade que torna o rolling deploy e o rollback de binário
 * seguros. O último caso deste arquivo mede o alias de frente, para que o leitor veja a causa em vez de
 * deduzi-la.
 *
 * O gate da ROTA é portanto estático: `scripts/sequencia-namespace-audit.mjs`, encadeado no `pnpm lint`,
 * reprova a mesma sabotagem nomeando arquivo e linha. Os dois se dividem assim: aqui prova-se o SISTEMA
 * pela porta real; lá prova-se a ROTA. Escrever que "este arquivo reprova quem tentar" seria falso, e um
 * gate que se acredita existir sem existir é pior que gate nenhum.
 *
 * REGRA DE LEITURA DESTE ARQUIVO: **409 nunca é resultado esperado aqui.** Em nenhum caso. Um `expect`
 * que aceitasse 409 documentaria o defeito como contrato e faria o dia da correção chegar como "teste
 * quebrado" — a inversão que `scripts/regressao-invertida-audit.mjs` existe para proibir.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;

/** Organização do harness: a que já tem duas empresas, produto e saldo. */
let ORG = ""; let A = ""; let B = "";
/** Armazéns próprios desta suíte — os do seed já têm movimento de outras suítes. */
let ARM_A1 = ""; let ARM_A2 = ""; let ARM_B1 = "";
let PRODUTO = "";

/** SEGUNDA organização, completa e independente: é ela que prova que o contador não atravessa tenant. */
let demo2: DemoOrg; let ORG2 = ""; let A2 = ""; let B2 = "";
let ARM2_A1 = ""; let ARM2_A2 = ""; let PRODUTO2 = "";
let token2 = "";

type Resposta = { statusCode: number; body: string; json: () => unknown };
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string; message: string } };

const post = (token: string, orgId: string, url: string, payload: Record<string, unknown>, idempotencyKey?: string): Promise<Resposta> =>
  h.app.inject({
    method: "POST", url,
    headers: { authorization: `Bearer ${token}`, "x-org-id": orgId, ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    payload,
  }) as unknown as Promise<Resposta>;

/**
 * Cria uma transferência pela rota real. `kind` é a ÚNICA diferença entre as duas chamadas — é o ponto
 * exato onde a rota antiga trocava de contador.
 */
function corpo(kind: "warehouse" | "farm", o: { empresaOrigem: string; origem: string; empresaDestino: string; destino: string; produto: string }) {
  return {
    kind,
    transfer_date: "2031-03-01",
    empresa_origem_id: o.empresaOrigem,
    origin_warehouse_id: o.origem,
    ...(kind === "farm" ? { empresa_destino_id: o.empresaDestino } : {}),
    destination_warehouse_id: o.destino,
    items: [{ product_id: o.produto, quantity: "1" }],
  };
}

/** Transferência ENTRE ARMAZÉNS da mesma empresa (`kind='warehouse'`). */
const armazens = (token: string, orgId: string, o: { empresa: string; origem: string; destino: string; produto: string }, idem?: string) =>
  post(token, orgId, "/api/stock/transfers",
    corpo("warehouse", { empresaOrigem: o.empresa, origem: o.origem, empresaDestino: o.empresa, destino: o.destino, produto: o.produto }), idem);

/** Transferência ENTRE EMPRESAS (`kind='farm'`) — a variante que morria com 409. */
const empresas = (token: string, orgId: string, o: { empresaOrigem: string; origem: string; empresaDestino: string; destino: string; produto: string }, idem?: string) =>
  post(token, orgId, "/api/stock/transfers", corpo("farm", o), idem);

/**
 * Exige 201 e devolve o código. Falhar aqui imprime o corpo inteiro: quando o defeito estava vivo, a
 * resposta era `409 CONFLICT` do índice único, e é essa mensagem que precisa aparecer no log de quem
 * reintroduzir o problema — não um `expect(...).toBe(201)` mudo.
 */
function codigoDe(r: Resposta, oQueEra: string): string {
  expect(r.statusCode, `${oQueEra} tem de nascer (201). Resposta: ${r.body}`).toBe(201);
  const code = j(r)["code"];
  expect(typeof code, `${oQueEra}: a rota devolve o código do documento`).toBe("string");
  return String(code);
}

/** `last_value` do contador canônico da organização; `null` quando a linha não existe. */
const contadorCanonico = async (orgId: string): Promise<number | null> => {
  const r = await admin.query<{ v: string }>(
    "select last_value::text v from erp.code_sequences where organization_id=$1 and entity=$2",
    [orgId, SEQUENCIA_WAREHOUSE_TRANSFER]);
  return r.rows[0] ? Number(r.rows[0].v) : null;
};

/** Todos os códigos da organização, como número, em ordem. É o acervo que a unicidade protege. */
const codigosDa = async (orgId: string): Promise<number[]> =>
  (await admin.query<{ code: string }>(
    "select code from erp.warehouse_transfers where organization_id=$1 and code ~ '^[0-9]+$' order by code::bigint", [orgId]))
    .rows.map((l) => Number(l.code));

/** Armazém novo desta suíte, na empresa pedida. */
const armazem = async (orgId: string, empresaId: string, iniciais: string, descricao: string): Promise<string> =>
  (await admin.query<{ id: string }>(
    "insert into erp.warehouses(organization_id,empresa_id,initials,description,type) values ($1,$2,$3,$4,'inputs') returning id",
    [orgId, empresaId, iniciais, descricao])).rows[0]!.id;

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  admin = createPool(TEST_URL, { max: 4 });
  ORG = h.demo.orgId; A = I.empresa; B = I.empresa2;
  // A premissa da fixture, conferida em vez de assumida: sem produto, todas as criações abaixo morreriam
  // em validação e a suíte mediria o erro errado.
  expect(I.product, "o seed precisa do produto que esta suíte transfere").toBeTruthy();
  PRODUTO = I.product!;

  ARM_A1 = await armazem(ORG, A, "NA1", "Numeracao origem A");
  ARM_A2 = await armazem(ORG, A, "NA2", "Numeracao destino A");
  ARM_B1 = await armazem(ORG, B, "NB1", "Numeracao destino B");

  // Saldo na origem: sem ele a rota morre em INSUFFICIENT_STOCK e o teste mediria outra coisa. A
  // quantidade é folgada de propósito — esta suíte cria dezenas de transferências de 1 unidade.
  const ab = await post(h.token, ORG, "/api/stock/opening-balances",
    { empresa_id: A, warehouse_id: ARM_A1, product_id: PRODUTO, quantity: "5000", unit_value: "10" });
  if (ab.statusCode !== 201) throw new Error("saldo inicial da suite de numeracao: " + ab.body);

  // SEGUNDA ORGANIZAÇÃO, de verdade: `seedDemo` com outro `slug` e outro administrador. Duas empresas,
  // produtos e permissões próprias — o isolamento medido no caso 4 é entre tenants reais, não entre dois
  // UUIDs inventados numa tabela.
  demo2 = await seedDemo(admin, {
    orgName: "[TEST] Numeracao Tenant 2", slug: "numeracao-2", adminEmail: "admin.numeracao2@demo.local",
  }, () => {});
  ORG2 = demo2.orgId; A2 = demo2.empresaIds[0]!; B2 = demo2.empresaIds[1]!;
  PRODUTO2 = (await admin.query<{ id: string }>(
    "select id from erp.products where organization_id=$1 and description like 'Sal Mineral%' limit 1", [ORG2])).rows[0]!.id;
  ARM2_A1 = await armazem(ORG2, A2, "N2A1", "Numeracao 2 origem A");
  ARM2_A2 = await armazem(ORG2, A2, "N2A2", "Numeracao 2 destino A");

  const login = await h.app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "admin.numeracao2@demo.local", password: demo2.adminPassword },
  });
  if (login.statusCode !== 200) throw new Error("login do tenant 2: " + login.body);
  token2 = (login.json() as { token: string }).token;

  const ab2 = await post(token2, ORG2, "/api/stock/opening-balances",
    { empresa_id: A2, warehouse_id: ARM2_A1, product_id: PRODUTO2, quantity: "5000", unit_value: "10" });
  if (ab2.statusCode !== 201) throw new Error("saldo inicial do tenant 2: " + ab2.body);
}, 300_000);

afterAll(async () => { await admin?.end(); await h?.app.close(); await h?.db.end(); });

describe("as DUAS variantes convivem na MESMA organização", () => {
  it("armazéns e depois empresas: 201 nas duas, códigos DIFERENTES e consecutivos", async () => {
    const antes = await contadorCanonico(ORG);

    const c1 = codigoDe(await armazens(h.token, ORG, { empresa: A, origem: ARM_A1, destino: ARM_A2, produto: PRODUTO }),
      "transferência entre armazéns");
    const c2 = codigoDe(await empresas(h.token, ORG, { empresaOrigem: A, origem: ARM_A1, empresaDestino: B, destino: ARM_B1, produto: PRODUTO }),
      "transferência entre empresas (a que dava 409)");

    expect(c1, "os dois documentos não podem receber o mesmo código").not.toBe(c2);
    expect(Number(c2), "a segunda variante continua a MESMA sequência, não recomeça em 1").toBe(Number(c1) + 1);
    expect(Number(c1), "e a primeira saiu do contador canônico, não de um contador zerado").toBe((antes ?? 0) + 1);
  });

  it("ORDEM INVERSA — empresas primeiro, armazéns depois: o resultado é o mesmo", async () => {
    // A ordem importava no defeito: qual variante dava 409 dependia de qual tinha nascido antes. Se a
    // correção fosse "o `farm` passa a ler o contador do `warehouse`" só num sentido, este caso reprovaria.
    const c1 = codigoDe(await empresas(h.token, ORG, { empresaOrigem: A, origem: ARM_A1, empresaDestino: B, destino: ARM_B1, produto: PRODUTO }),
      "transferência entre empresas, emitida primeiro");
    const c2 = codigoDe(await armazens(h.token, ORG, { empresa: A, origem: ARM_A1, destino: ARM_A2, produto: PRODUTO }),
      "transferência entre armazéns, emitida depois");

    expect(Number(c2), "a sequência é da TABELA: quem vier depois recebe o próximo número, seja qual for a variante")
      .toBe(Number(c1) + 1);
  });

  it("alternando as variantes seis vezes, os códigos formam UM bloco contínuo e sem repetição", async () => {
    const roteiro: ("warehouse" | "farm")[] = ["warehouse", "farm", "farm", "warehouse", "farm", "warehouse"];
    const emitidos: number[] = [];
    for (const kind of roteiro) {
      const r = kind === "warehouse"
        ? await armazens(h.token, ORG, { empresa: A, origem: ARM_A1, destino: ARM_A2, produto: PRODUTO })
        : await empresas(h.token, ORG, { empresaOrigem: A, origem: ARM_A1, empresaDestino: B, destino: ARM_B1, produto: PRODUTO });
      emitidos.push(Number(codigoDe(r, `transferência ${kind} do roteiro alternado`)));
    }

    expect(emitidos.length, "a premissa: as seis chamadas realmente aconteceram").toBe(6);
    expect(new Set(emitidos).size, "nenhum código repetido").toBe(6);
    const esperado = Array.from({ length: 6 }, (_, i) => emitidos[0]! + i);
    expect(emitidos, "e a sequência é contínua, sem lacuna entre variantes").toEqual(esperado);
  });

  it("a organização tem UMA linha de contador para a tabela — e NENHUMA chave legada", async () => {
    // O estado que sustenta tudo acima. Se alguém reintroduzir o contador por variante, a linha
    // `farm_transfer` reaparece aqui ANTES de qualquer 409 ser observável na tela.
    const r = await admin.query<{ entity: string; last_value: string }>(
      "select entity, last_value::text from erp.code_sequences where organization_id=$1 and entity in ($2,'farm_transfer') order by entity",
      [ORG, SEQUENCIA_WAREHOUSE_TRANSFER]);
    expect(r.rows.map((l) => l.entity), "só a chave canônica existe").toEqual([SEQUENCIA_WAREHOUSE_TRANSFER]);

    const codigos = await codigosDa(ORG);
    expect(codigos.length, "a premissa: esta organização tem acervo (um teste sobre zero linha não prova nada)")
      .toBeGreaterThanOrEqual(8);
    expect(new Set(codigos).size, "o acervo inteiro é distinto — é o que a UNIQUE protege").toBe(codigos.length);
    expect(Number(r.rows[0]!.last_value), "o contador cobre o maior código já emitido")
      .toBeGreaterThanOrEqual(Math.max(...codigos));
  });
});

describe("o contador é POR ORGANIZAÇÃO — e não atravessa tenant", () => {
  it("o segundo tenant começa do próprio 1, com o primeiro já bem à frente", async () => {
    const doPrimeiro = await contadorCanonico(ORG);
    expect(doPrimeiro, "a premissa: o tenant 1 já numerou bastante").toBeGreaterThan(5);

    expect(await contadorCanonico(ORG2), "o tenant 2 ainda não emitiu transferência nenhuma").toBeNull();

    const c1 = codigoDe(await armazens(token2, ORG2, { empresa: A2, origem: ARM2_A1, destino: ARM2_A2, produto: PRODUTO2 }),
      "primeira transferência do tenant 2");
    expect(Number(c1), "o contador do tenant 2 nasce em 1, ignorando o do tenant 1").toBe(1);

    expect(await contadorCanonico(ORG), "e o contador do tenant 1 não se moveu por causa disso").toBe(doPrimeiro);
  });

  it("as duas variantes também convivem no segundo tenant — a correção não é um remendo do seed", async () => {
    const c1 = codigoDe(await empresas(token2, ORG2, { empresaOrigem: A2, origem: ARM2_A1, empresaDestino: B2, destino: (await armazem(ORG2, B2, "N2B1", "Numeracao 2 destino B")), produto: PRODUTO2 }),
      "transferência entre empresas do tenant 2");
    const c2 = codigoDe(await armazens(token2, ORG2, { empresa: A2, origem: ARM2_A1, destino: ARM2_A2, produto: PRODUTO2 }),
      "transferência entre armazéns do tenant 2");
    expect(Number(c2), "mesma sequência, mesmo tenant novo").toBe(Number(c1) + 1);
  });
});

describe("CONCORRÊNCIA — as duas variantes emitidas ao mesmo tempo", () => {
  it("doze criações SIMULTÂNEAS, das duas variantes, recebem doze códigos distintos e nenhum 409", async () => {
    // Esta é a prova que um contador em memória, um `max(code)+1` ou um `select` fora do lock não
    // sobrevivem. `erp.next_code` é `insert ... on conflict do update`: a linha do contador é travada
    // dentro da transação de cada requisição, então as doze serializam naquele ponto e só naquele ponto.
    const antes = (await contadorCanonico(ORG))!;
    const disparos = Array.from({ length: 12 }, (_, i) => i % 2 === 0
      ? armazens(h.token, ORG, { empresa: A, origem: ARM_A1, destino: ARM_A2, produto: PRODUTO })
      : empresas(h.token, ORG, { empresaOrigem: A, origem: ARM_A1, empresaDestino: B, destino: ARM_B1, produto: PRODUTO }));

    const respostas = await Promise.all(disparos);

    const conflitos = respostas.filter((r) => r.statusCode === 409);
    expect(conflitos.map((r) => r.body), "409 NUNCA é resultado esperado: era exatamente o defeito").toEqual([]);
    const falhas = respostas.filter((r) => r.statusCode !== 201);
    expect(falhas.map((r) => `${r.statusCode} ${r.body}`), "as doze nascem").toEqual([]);

    const codigos = respostas.map((r) => Number(j(r)["code"]));
    expect(new Set(codigos).size, "doze códigos distintos").toBe(12);
    expect([...codigos].sort((x, y) => x - y), "e contíguos a partir de onde o contador estava")
      .toEqual(Array.from({ length: 12 }, (_, i) => antes + 1 + i));
    expect(await contadorCanonico(ORG), "o contador avançou exatamente doze").toBe(antes + 12);
  });
});

describe("IDEMPOTÊNCIA — reenvio não consome número", () => {
  it("a mesma Idempotency-Key devolve o MESMO documento, com o MESMO código, sem mexer no contador", async () => {
    const chave = "hotfix-0019-idem-empresas";
    const corpoPedido = { empresaOrigem: A, origem: ARM_A1, empresaDestino: B, destino: ARM_B1, produto: PRODUTO };

    const primeira = await empresas(h.token, ORG, corpoPedido, chave);
    const code = codigoDe(primeira, "primeira emissão com chave de idempotência");
    const id = String(j(primeira)["id"]);
    const depoisDaPrimeira = await contadorCanonico(ORG);

    const reenvio = await empresas(h.token, ORG, corpoPedido, chave);
    expect(reenvio.statusCode, `o reenvio não pode falhar. Resposta: ${reenvio.body}`).toBeLessThan(300);
    expect(String(j(reenvio)["id"]), "o reenvio devolve o MESMO documento").toBe(id);
    expect(String(j(reenvio)["code"]), "e o MESMO código").toBe(code);

    expect(await contadorCanonico(ORG), "o contador NÃO avançou no reenvio — número queimado é lacuna visível ao usuário")
      .toBe(depoisDaPrimeira);

    const quantos = await admin.query<{ n: string }>(
      "select count(*)::text n from erp.warehouse_transfers where organization_id=$1 and code=$2", [ORG, code]);
    expect(Number(quantos.rows[0]!.n), "e existe UM documento com aquele código, não dois").toBe(1);
  });
});

describe("o runtime aponta para a chave que o BANCO de fato tem", () => {
  it("SEQUENCIA_WAREHOUSE_TRANSFER é a entidade persistida — e a legada não existe em nenhuma organização", async () => {
    // Amarrar a constante ao BANCO, e não a um segundo literal escrito aqui, é o que faz este caso
    // continuar valendo se a chave mudar de novo: ele compara o runtime com o que a 0019 deixou de pé.
    const persistidas = (await admin.query<{ entity: string }>(
      "select distinct entity from erp.code_sequences where entity in ('warehouse_transfer','farm_transfer') order by 1"))
      .rows.map((l) => l.entity);
    expect(persistidas, "depois da 0019 a chave legada não existe como linha em banco nenhum").not.toContain("farm_transfer");
    expect(persistidas, "e a canônica existe, porque esta suíte acabou de numerar com ela").toContain(SEQUENCIA_WAREHOUSE_TRANSFER);

    const m = await admin.query<{ n: string }>(
      "select count(*)::text n from public.erp_migrations where name = '0019_warehouse_transfer_code_sequence.sql'");
    expect(Number(m.rows[0]!.n), "e quem produziu esse estado foi a migration da fatia, não um acaso do seed").toBe(1);
  });
});

describe("o ALIAS da 0019 é o que torna a chave pedida pela rota indiferente", () => {
  it("pedir a chave LEGADA e pedir a CANÔNICA move o MESMO contador, e a legada não vira linha", async () => {
    // Este caso não mede a rota: mede a porta de alocação que a rota usa, e é ele que explica por que os
    // oito casos acima continuariam verdes com a rota pedindo `farm_transfer`. Sem isso escrito, a suíte
    // pareceria provar mais do que prova.
    //
    // Roda numa organização própria e dentro de `begin`/`rollback`: nenhum contador real avança.
    const c = await admin.connect();
    try {
      await c.query("begin");
      const orgId = (await c.query<{ id: string }>(
        "insert into erp.organizations (name) values ('[TEST] alias 0019') returning id")).rows[0]!.id;

      const canonico = Number((await c.query<{ n: string }>(
        "select erp.next_code($1,$2)::text n", [orgId, SEQUENCIA_WAREHOUSE_TRANSFER])).rows[0]!.n);
      const legado = Number((await c.query<{ n: string }>(
        "select erp.next_code($1,'farm_transfer')::text n", [orgId])).rows[0]!.n);

      expect(canonico, "o contador da organização nova nasce em 1").toBe(1);
      expect(legado, "e a chave LEGADA continua a MESMA sequência — não recomeça em 1").toBe(2);

      const linhas = (await c.query<{ entity: string }>(
        "select entity from erp.code_sequences where organization_id=$1 order by entity", [orgId])).rows.map((l) => l.entity);
      expect(linhas, "pedir a chave legada NÃO a recria como linha: o alias reescreve antes do insert")
        .toEqual([SEQUENCIA_WAREHOUSE_TRANSFER]);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  });
});

describe("a chave legada é SOBRECARREGADA — e as duas rotas dividem a MESMA linha de contador", () => {
  it("a transferência de rebanho pela ROTA REAL avança o contador canônico — é isso que serializa os binários", async () => {
    // `erp.animal_movements` tem namespace próprio (`unique (organization_id, movement_type, code)`) e
    // numera com a MESMA chave `'farm_transfer'` que a rota de estoque usava para `kind='farm'`. Dar a ela
    // um contador próprio AGORA criaria uma corrida com o binário anterior, que pede a chave legada e é
    // desviado pelo alias para o contador de estoque: duas LINHAS, sem trava em comum, mesmo número.
    //
    // Enquanto o alias existir, as duas rotas pedem a MESMA chave e `erp.next_code` serializa na linha.
    // Aqui prova-se, pela porta real, que a criação de rebanho de fato move o contador canônico — a
    // premissa da serialização. A prova COM concorrência está no quadrante C de `pnpm gate:0019`.
    const especie = (await admin.query<{ id: string }>("select id from erp.animal_species limit 1")).rows[0]!.id;
    const categoria = (await admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]!.id;
    const lote = async (empresa: string, code: string) => (await admin.query<{ id: string }>(
      "insert into erp.batches(organization_id,empresa_id,code,batch_date,description,status) values ($1,$2,$3,current_date,$4,'active') returning id",
      [ORG, empresa, code, `Lote numeracao ${code}`])).rows[0]!.id;
    const origem = await lote(A, "NUMA");
    const destino = await lote(B, "NUMB");
    await admin.query(
      "insert into erp.herd_lots(organization_id,empresa_id,batch_id,species_id,category_id,quantity,entry_date) values ($1,$2,$3,$4,$5,5,current_date)",
      [ORG, A, origem, especie, categoria]);

    const antes = (await contadorCanonico(ORG))!;

    const r = await post(h.token, ORG, "/api/livestock/transfers/to-farm", {
      empresa_id: A, empresa_destino_id: B, movement_date: "2031-03-05",
      batch_id: origem, destination_batch_id: destino,
    });
    expect(r.statusCode, `a transferência de rebanho tem de nascer. Resposta: ${r.body}`).toBe(201);

    expect(await contadorCanonico(ORG), "a criação de REBANHO avança o contador canônico — a linha é a mesma")
      .toBe(antes + 1);

    const legadas = Number((await admin.query<{ n: string }>(
      "select count(*)::text n from erp.code_sequences where organization_id=$1 and entity='farm_transfer'", [ORG])).rows[0]!.n);
    expect(legadas, "e a chave legada continua sem existir como LINHA — o alias reescreve antes do insert").toBe(0);

    const proprio = Number((await admin.query<{ n: string }>(
      "select count(*)::text n from erp.code_sequences where organization_id=$1 and entity='animal_farm_transfer'", [ORG])).rows[0]!.n);
    expect(proprio, "e nenhum contador próprio de rebanho foi criado nesta fatia").toBe(0);
  });
});
