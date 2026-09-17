import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";
import {
  ALVO, CANONICA, CANONICA_REBANHO, LEGADA, subirAte0018, aplicarHotfix, fotoDoContador, fotoDoAcervo,
  linhasDaEntidade, contador, valorDoContador, proximoCodigo, orgComArmazens, transferenciaComCodigo,
  movimentoDeRebanhoComCodigo,
} from "./hotfix-0019-ajuda.js";

/**
 * 0018 → 0019 COM ACERVO — hotfix da numeração de `erp.warehouse_transfers`.
 *
 * O que precisa ser verdade depois da migration, e que um banco zero NÃO consegue provar:
 *
 *   • o contador canônico cobre TUDO que já foi emitido — os dois contadores antigos e o acervo real.
 *     Se ele ficar abaixo de qualquer um dos três, a próxima criação colide e o defeito volta;
 *   • nenhum documento é renumerado. Código já exposto ao usuário não volta atrás;
 *   • a chave legada some como LINHA e continua aceita como ALIAS, porque o binário anterior ainda a
 *     pede durante o rolling deploy;
 *   • contadores de OUTRAS entidades não são tocados.
 *
 * O banco é montado só até a 0018 — exatamente o estado de produção — e recebe um acervo
 * propositalmente desconfortável: organizações em todas as combinações de contador (nenhum, só um, os
 * dois com cada um por cima), uma com o ACERVO à frente dos dois contadores, e códigos não numéricos
 * convivendo com numéricos.
 *
 * Os valores não são redondos nem iguais entre si: coincidência não vira prova.
 */
let db: Db;

/** Uma organização por cenário da matriz. O nome diz o que cada uma está provando. */
const CENARIOS = [
  "zero-zero",        // 1. sem transferência e sem contador
  "so-canonico",      // 2. só warehouse_transfer
  "so-legado",        // 3. só farm_transfer
  "ambos-canon-maior",// 4. os dois, canônico maior
  "ambos-legado-maior",// 5. os dois, legado maior
  "acervo-na-frente", // 6. acervo maior que os dois contadores
  "codigo-nao-numerico", // 8. código não numérico convivendo com numéricos
  "chave-compartilhada", // 9. a chave legada servindo TAMBÉM ao contador de rebanho
  "rebanho-na-frente",   // 10. acervo de REBANHO à frente do contador legado, sem acervo de estoque
] as const;

type Cenario = (typeof CENARIOS)[number];
const org: Record<Cenario, Awaited<ReturnType<typeof orgComArmazens>>> = {} as never;

let contadorAntes: Record<string, string>;
let acervoAntes: Record<string, string>;
let resultado: { ok: true } | { ok: false; erro: string };

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 6 });
  await resetSchema(db);
  await subirAte0018(db);

  for (const c of CENARIOS) org[c] = await orgComArmazens(db, `[TEST] 0019 ${c}`);

  // 2. só o canônico, sem acervo
  await contador(db, org["so-canonico"].orgId, CANONICA, 7);

  // 3. só o legado, sem acervo — o valor tem de SOBREVIVER como canônico
  await contador(db, org["so-legado"].orgId, LEGADA, 23);

  // 4. os dois, canônico maior
  await contador(db, org["ambos-canon-maior"].orgId, CANONICA, 31);
  await contador(db, org["ambos-canon-maior"].orgId, LEGADA, 12);

  // 5. os dois, legado maior — o caso que uma implementação preguiçosa perde
  await contador(db, org["ambos-legado-maior"].orgId, CANONICA, 4);
  await contador(db, org["ambos-legado-maior"].orgId, LEGADA, 57);

  // 6. o ACERVO à frente dos dois contadores (restauração parcial, importação, correção manual).
  //    É o caso que prova por que `max(code)` entra no GREATEST: sem ele o contador "reconciliado"
  //    emitiria um número que já existe.
  await contador(db, org["acervo-na-frente"].orgId, CANONICA, 2);
  await contador(db, org["acervo-na-frente"].orgId, LEGADA, 3);
  await transferenciaComCodigo(db, org["acervo-na-frente"], "0088", "warehouse");
  await transferenciaComCodigo(db, org["acervo-na-frente"], "0089", "farm");

  // 8. não numérico convivendo com numérico: o não numérico é ignorado no max (não colide com código
  //    gerado, que é sempre dígito) e continua intocado.
  await contador(db, org["codigo-nao-numerico"].orgId, LEGADA, 1);
  await transferenciaComCodigo(db, org["codigo-nao-numerico"], "0005", "warehouse");
  await transferenciaComCodigo(db, org["codigo-nao-numerico"], "TRF-LEGADO", "farm");

  // 9. A CHAVE SOBRECARREGADA. `erp.animal_movements` numerava com a MESMA chave legada — e ela tem
  //    namespace PRÓPRIO (`unique (organization_id, movement_type, code)`). Aqui a organização tem
  //    acervo das DUAS tabelas e o contador legado à frente de ambos: é o estado em que um alias
  //    ingênuo levaria a numeração do rebanho para o contador de estoque e apagaria a linha que era o
  //    contador do rebanho.
  await contador(db, org["chave-compartilhada"].orgId, LEGADA, 40);
  await transferenciaComCodigo(db, org["chave-compartilhada"], "0038", "farm");
  await movimentoDeRebanhoComCodigo(db, org["chave-compartilhada"], "00039");

  // 10. O CASO QUE A AFIRMAÇÃO FALSA ESCONDIA. O contador legado está ATRÁS do acervo de rebanho
  //     (restauração parcial, importação — o mesmo cenário que a migration já trata como realista para
  //     estoque), e a organização NÃO tem acervo de estoque nenhum. A primeira versão desta fatia
  //     reconciliava o contador canônico sem olhar o acervo de rebanho: ele ficava em 40 com o rebanho
  //     já em 120, e a primeira transferência de rebanho da janela de rolling deploy — que o alias manda
  //     para esse contador — colidia de imediato.
  await contador(db, org["rebanho-na-frente"].orgId, LEGADA, 40);
  for (const code of ["00118", "00119", "00120"]) {
    await movimentoDeRebanhoComCodigo(db, org["rebanho-na-frente"], code);
  }

  // Contadores de OUTRAS entidades no meio, para provar que a reconciliação não os arrasta.
  for (const [e, v] of [["product", 99], ["person", 5], ["title_payable", 17]] as const) {
    await contador(db, org["zero-zero"].orgId, e, v);
  }

  contadorAntes = await fotoDoContador(db);
  acervoAntes = await fotoDoAcervo(db);
  resultado = await aplicarHotfix(db);
});

afterAll(async () => { await db.end(); });

describe("a 0019 aplica sobre o acervo", () => {
  it("1 · a migration passa, e o ledger registra exatamente uma vez", async () => {
    expect(resultado.ok ? "" : resultado.erro, "a migration não podia falhar neste acervo").toBe("");
    const n = Number((await db.query<{ n: string }>(
      "select count(*)::text n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n);
    expect(n, "a 0019 aparece uma única vez no ledger").toBe(1);
  });

  it("2 · a fixture não é vazia — premissa junto com a conclusão", () => {
    // Sem esta guarda, um `resetSchema` acidental ou uma falha silenciosa no beforeAll faria TODA a
    // matriz abaixo passar por vacuidade, que é a forma de verde que este repositório trata como
    // reprovação.
    expect(Object.keys(acervoAntes).length, "o acervo de fixture precisa existir").toBeGreaterThan(0);
    expect(Object.keys(contadorAntes).length, "os contadores de fixture precisam existir").toBeGreaterThan(0);
  });
});

describe("o contador canônico fica no baseline correto em cada cenário", () => {
  it("3 · sem transferência e sem contador: nenhuma linha é inventada", async () => {
    expect(await valorDoContador(db, org["zero-zero"].orgId, CANONICA),
      "organização sem nada não ganha contador — ele nasce com o primeiro documento").toBeNull();
  });

  it("4 · só o canônico: fica onde estava", async () => {
    expect(await valorDoContador(db, org["so-canonico"].orgId, CANONICA)).toBe(7);
  });

  it("5 · só o legado: o valor ATRAVESSA para o canônico", async () => {
    // Perder isto faria a numeração reiniciar em 1 sobre o que a variante `farm` já emitiu.
    expect(await valorDoContador(db, org["so-legado"].orgId, CANONICA)).toBe(23);
  });

  it("6 · os dois, canônico maior: vence o canônico", async () => {
    expect(await valorDoContador(db, org["ambos-canon-maior"].orgId, CANONICA)).toBe(31);
  });

  it("7 · os dois, legado maior: vence o LEGADO", async () => {
    // O caso que uma implementação que só apagasse a chave legada perderia inteiro.
    expect(await valorDoContador(db, org["ambos-legado-maior"].orgId, CANONICA)).toBe(57);
  });

  it("8 · acervo à frente dos dois contadores: vence o ACERVO", async () => {
    // Contadores em 2 e 3, acervo em 88 e 89. Sem `max(code)` no GREATEST o contador ficaria em 3 e a
    // próxima criação emitiria 0004 — que não colide hoje, mas colidiria ao alcançar 0088.
    expect(await valorDoContador(db, org["acervo-na-frente"].orgId, CANONICA)).toBe(89);
  });

  it("9 · código não numérico é ignorado no baseline e continua intocado", async () => {
    // Acervo: '0005' e 'TRF-LEGADO'. Contador legado em 1. O baseline é 5, não erro e não NULL.
    expect(await valorDoContador(db, org["codigo-nao-numerico"].orgId, CANONICA)).toBe(5);
    const r = await db.query<{ code: string }>(
      "select code from erp.warehouse_transfers where organization_id=$1 order by code", [org["codigo-nao-numerico"].orgId]);
    expect(r.rows.map((x) => x.code), "nenhum código foi reescrito").toEqual(["0005", "TRF-LEGADO"]);
  });

  it("10 · o contador canônico nunca fica abaixo do maior código da sua organização", async () => {
    // Forma agregada da invariante central, que vale para TODA organização e não só para a amostra.
    const r = await db.query<{ organization_id: string; maior: string; atual: string | null }>(`
      select a.organization_id::text, a.maior::text, cs.last_value::text as atual
      from (select organization_id, max(code::bigint) as maior from erp.warehouse_transfers
            where code ~ '^[0-9]+$' group by 1) a
      left join erp.code_sequences cs on cs.organization_id = a.organization_id and cs.entity = $1`, [CANONICA]);
    expect(r.rows.length, "precisa haver organização com acervo numerado para esta asserção valer").toBeGreaterThan(0);
    for (const l of r.rows) {
      expect(Number(l.atual), `org ${l.organization_id}: contador abaixo do maior código emitido`)
        .toBeGreaterThanOrEqual(Number(l.maior));
    }
  });
});

describe("preservação — o que a migration NÃO pode ter tocado", () => {
  it("11 · nenhum código existente mudou", async () => {
    expect(await fotoDoAcervo(db), "o acervo inteiro precisa atravessar idêntico").toEqual(acervoAntes);
  });

  it("12 · a chave legada desapareceu como LINHA", async () => {
    expect(await linhasDaEntidade(db, LEGADA), `sobrou linha entity='${LEGADA}'`).toBe(0);
  });

  it("13 · contadores de OUTRAS entidades não foram tocados", async () => {
    const depois = await fotoDoContador(db);
    for (const entidade of ["product", "person", "title_payable"]) {
      const k = `${org["zero-zero"].orgId}|${entidade}`;
      expect(depois[k], `${entidade} intacto: a reconciliação não pode arrastar outros contadores`)
        .toBe(contadorAntes[k]);
    }
  });

  it("14 · nenhuma organização tem mais de uma linha canônica", async () => {
    const n = Number((await db.query<{ n: string }>(`
      select count(*)::text n from (
        select organization_id from erp.code_sequences where entity=$1 group by 1 having count(*) > 1) d`,
      [CANONICA])).rows[0]!.n);
    expect(n).toBe(0);
  });
});

describe("o ALIAS — a chave antiga continua servindo o binário anterior", () => {
  it("15 · pedir a chave legada devolve número do contador CANÔNICO, e não recria a linha", async () => {
    const o = org["ambos-legado-maior"].orgId;   // canônico reconciliado em 57
    const a = await proximoCodigo(db, o, LEGADA);
    const b = await proximoCodigo(db, o, CANONICA);
    const c = await proximoCodigo(db, o, LEGADA);

    expect(a, "a chave legada continua a sequência canônica").toBe(58);
    expect(b, "a canônica segue de onde a legada parou — é o MESMO contador").toBe(59);
    expect(c, "e alternar entre as duas chaves não cria duas sequências").toBe(60);
    expect(await linhasDaEntidade(db, LEGADA), "pedir a chave legada não pode RESSUSCITAR a linha").toBe(0);
  });

  it("16 · as demais entidades continuam com a semântica de sempre", async () => {
    // O alias não pode ter virado um `case` que afete quem não pediu por ele.
    const o = org["zero-zero"].orgId;
    expect(await proximoCodigo(db, o, "product"), "product continua de 99").toBe(100);
    expect(await proximoCodigo(db, o, "person"), "person continua de 5").toBe(6);
    expect(await proximoCodigo(db, o, "entidade-que-nunca-existiu"), "entidade nova nasce em 1").toBe(1);
  });
});

describe("reaplicação", () => {
  it("17 · aplicar a 0019 de novo é inócuo — o contador não desce e nada é renumerado", async () => {
    // O ledger impede a reaplicação pelo runner; esta prova é sobre a migration em si, para o caso de
    // alguém precisar reexecutá-la à mão num incidente. `GREATEST` inclui o próprio valor canônico, e o
    // `delete` de uma chave ausente casa zero linhas.
    const contadorPre = await fotoDoContador(db);
    const acervoPre = await fotoDoAcervo(db);

    const r = await aplicarHotfix(db, false);
    expect(r.ok ? "" : r.erro, "a reaplicação não podia falhar").toBe("");

    expect(await fotoDoContador(db), "nenhum contador mudou na reaplicação").toEqual(contadorPre);
    expect(await fotoDoAcervo(db), "nenhum código mudou na reaplicação").toEqual(acervoPre);
  });
});

describe("a chave legada era SOBRECARREGADA — e a 0019 divide o histórico em vez de sequestrá-lo", () => {
  it("18 · o contador de REBANHO nasce como linha própria, no maior entre o legado e o acervo dele", async () => {
    // `LEGADA` valia 40 e o acervo de rebanho chega a 39: o baseline é 40, e a primeira alocação
    // depois do hotfix tem de ser 41 — nunca 1 (reinício) e nunca um número já emitido.
    const v = await valorDoContador(db, org["chave-compartilhada"].orgId, CANONICA_REBANHO);
    expect(v, "a chave canônica do rebanho existe depois da 0019").not.toBeNull();
    expect(v, "e herda o histórico COMPARTILHADO que estava na chave legada").toBe(40);
  });

  it("19 · os dois contadores são INDEPENDENTES — alocar num não move o outro", async () => {
    const o = org["chave-compartilhada"].orgId;
    const estoqueAntes = (await valorDoContador(db, o, CANONICA))!;
    const rebanhoAntes = (await valorDoContador(db, o, CANONICA_REBANHO))!;

    const doRebanho = await proximoCodigo(db, o, CANONICA_REBANHO);
    expect(doRebanho, "o rebanho continua da SUA sequência").toBe(rebanhoAntes + 1);
    expect(await valorDoContador(db, o, CANONICA), "e o contador de ESTOQUE não se mexeu")
      .toBe(estoqueAntes);

    const doEstoque = await proximoCodigo(db, o, CANONICA);
    expect(doEstoque, "o estoque continua da SUA sequência").toBe(estoqueAntes + 1);
    expect(await valorDoContador(db, o, CANONICA_REBANHO), "e o contador de REBANHO não se mexeu")
      .toBe(doRebanho);
  });

  it("20 · o contador de rebanho cobre o acervo de rebanho de TODAS as organizações", async () => {
    // A mesma asserção que a pós-condição 8.4 da migration faz, refeita do lado de fora: contador
    // abaixo do maior código já emitido significa 409 na próxima transferência de rebanho.
    const r = await db.query<{ n: string; amostra: string }>(`
      select count(*)::text n, coalesce(string_agg(a.organization_id::text, ','), '') amostra
      from (
        select am.organization_id, max(am.code::bigint) as maior
        from erp.animal_movements am
        where am.movement_type = 'farm_transfer' and am.code ~ '^[0-9]+$'
        group by am.organization_id
      ) a
      left join erp.code_sequences cs
        on cs.organization_id = a.organization_id and cs.entity = $1
      where coalesce(cs.last_value, -1) < a.maior`, [CANONICA_REBANHO]);
    expect(Number(r.rows[0]!.n), `organizações com contador de rebanho atrás do acervo: ${r.rows[0]!.amostra}`).toBe(0);

    // E a premissa: existe acervo de rebanho para cobrir. Zero linha aqui tornaria a asserção vazia.
    const acervo = Number((await db.query<{ n: string }>(
      "select count(*)::text n from erp.animal_movements where movement_type='farm_transfer'")).rows[0]!.n);
    expect(acervo, "a fixture precisa ter transferência de rebanho").toBeGreaterThan(0);
  });

  it("21 · MEDIDO: o alias desvia a chave legada para ESTOQUE — por isso o rebanho precisa da própria", async () => {
    // Este caso documenta o RISCO RESIDUAL declarado da fatia, em vez de o esconder: durante o rolling
    // deploy o binário anterior pede `LEGADA` para as DUAS rotas, e o alias só pode acertar uma. Ele
    // acerta a de estoque. A prova de que isso é SEGURO para o rebanho é o número que sai: ele vem do
    // contador de estoque, que a seção 6.1 deixou acima de todo código de rebanho já emitido.
    const o = org["chave-compartilhada"].orgId;
    const estoqueAntes = (await valorDoContador(db, o, CANONICA))!;
    const rebanhoAntes = (await valorDoContador(db, o, CANONICA_REBANHO))!;

    const pelaLegada = await proximoCodigo(db, o, LEGADA);
    expect(pelaLegada, "a chave legada cai no contador de ESTOQUE").toBe(estoqueAntes + 1);
    expect(await valorDoContador(db, o, CANONICA_REBANHO), "o contador de rebanho não se move por isso")
      .toBe(rebanhoAntes);

    const maiorDoRebanho = Number((await db.query<{ n: string }>(
      "select coalesce(max(code::bigint),0)::text n from erp.animal_movements where organization_id=$1 and movement_type='farm_transfer' and code ~ '^[0-9]+$'",
      [o])).rows[0]!.n);
    expect(pelaLegada, "e o número emitido está ACIMA de todo código de rebanho já existente — comita em segurança")
      .toBeGreaterThan(maiorDoRebanho);
  });

  it("22 · nenhuma organização ficou com a chave legada viva, nem como linha de rebanho", async () => {
    expect(await linhasDaEntidade(db, LEGADA), "a chave sobrecarregada não existe mais como linha").toBe(0);
    const canonicas = Number((await db.query<{ n: string }>(
      "select count(*)::text n from erp.code_sequences where entity=$1", [CANONICA_REBANHO])).rows[0]!.n);
    expect(canonicas, "e existe contador canônico de rebanho onde havia histórico").toBeGreaterThan(0);
  });
});

describe("o contador ALIASADO cobre o acervo de TODA tabela que o alias alcança", () => {
  it("23 · organização com acervo de REBANHO à frente do contador legado, e nenhum acervo de estoque", async () => {
    const o = org["rebanho-na-frente"].orgId;
    // A premissa, medida: o acervo de rebanho existe e o de estoque não. Sem isso o caso seria vazio.
    const rebanho = Number((await db.query<{ n: string }>(
      "select count(*)::text n from erp.animal_movements where organization_id=$1 and movement_type='farm_transfer'", [o])).rows[0]!.n);
    const estoque = Number((await db.query<{ n: string }>(
      "select count(*)::text n from erp.warehouse_transfers where organization_id=$1", [o])).rows[0]!.n);
    expect(rebanho, "a fixture precisa do acervo de rebanho").toBe(3);
    expect(estoque, "e de NENHUM acervo de estoque — é o que torna o caso perigoso").toBe(0);

    // O contador canônico (destino do alias) tem de cobrir o acervo de REBANHO, não só o de estoque.
    // Antes da correção ele valia 40 aqui, e a janela de rolling deploy colidia na primeira criação.
    expect(await valorDoContador(db, o, CANONICA),
      "o contador aliasado precisa cobrir o maior código de rebanho (120), não parar no legado (40)").toBe(120);
    expect(await valorDoContador(db, o, CANONICA_REBANHO),
      "e o contador próprio do rebanho também").toBe(120);
  });

  it("24 · o número que o ALIAS emite nunca colide com o acervo de rebanho existente", async () => {
    // É a afirmação que a primeira redação da fatia fazia "por construção" sem construir nada. Aqui ela
    // é MEDIDA, em todas as organizações da matriz que têm acervo de rebanho.
    const r = await db.query<{ n: string; amostra: string }>(`
      select count(*)::text n, coalesce(string_agg(a.organization_id::text, ','), '') amostra
      from (
        select am.organization_id, max(am.code::bigint) as maior
        from erp.animal_movements am
        where am.movement_type = 'farm_transfer' and am.code ~ '^[0-9]+$'
        group by am.organization_id
      ) a
      left join erp.code_sequences cs
        on cs.organization_id = a.organization_id and cs.entity = $1
      where coalesce(cs.last_value, -1) < a.maior`, [CANONICA]);
    expect(Number(r.rows[0]!.n), `organizações onde o alias emitiria colisão: ${r.rows[0]!.amostra}`).toBe(0);

    // E a prova positiva, pela porta real: pedir a chave LEGADA devolve número livre naquela tabela.
    const o = org["rebanho-na-frente"].orgId;
    const emitido = await proximoCodigo(db, o, LEGADA);
    const ocupado = Number((await db.query<{ n: string }>(
      "select count(*)::text n from erp.animal_movements where organization_id=$1 and movement_type='farm_transfer' and code::bigint=$2",
      [o, emitido])).rows[0]!.n);
    expect(ocupado, `o alias emitiu ${emitido}, e esse código não pode estar ocupado no rebanho`).toBe(0);
  });

  it("25 · REPRODUZIDO: sem laço de retentativa, a colisão do rebanho TRAVA a rota para sempre", async () => {
    // O achado que o red team desta fatia derrubou: "um 409 que se resolve na tentativa seguinte" era
    // FALSO. `erp.next_code` e o `insert` rodam na mesma transação, então a violação desfaz o incremento
    // junto e a tentativa seguinte aloca EXATAMENTE o mesmo número.
    //
    // Aqui isso é reproduzido contra o banco de verdade, e depois se mostra que o laço — a forma que a
    // rota passou a usar (`codigoDeMovimento`, apps/api/src/routes/livestock.ts) — resolve.
    const o = org["rebanho-na-frente"];
    const antes = (await valorDoContador(db, o.orgId, CANONICA_REBANHO))!;

    // Ocupa o PRÓXIMO número, como a janela de rolling deploy faria.
    await movimentoDeRebanhoComCodigo(db, o, String(antes + 1).padStart(5, "0"));

    /** Uma tentativa SEM laço, do jeito que a rota fazia: alocar e inserir na MESMA transação. */
    const semLaco = async (): Promise<string> => {
      const c = await db.connect();
      try {
        await c.query("begin");
        const code = String(Number((await c.query<{ n: string }>(
          "select erp.next_code($1,$2)::text n", [o.orgId, CANONICA_REBANHO])).rows[0]!.n)).padStart(5, "0");
        await c.query(
          `insert into erp.animal_movements (organization_id, empresa_id, code, movement_type, movement_date, status)
           values ($1,$2,$3,'farm_transfer','2026-01-01','pending')`, [o.orgId, o.empresaId, code]);
        await c.query("commit");
        return "";
      } catch (e) {
        await c.query("rollback").catch(() => {});
        return (e as Error).message;
      } finally { c.release(); }
    };

    const erro1 = await semLaco();
    expect(erro1, "a primeira tentativa colide").toMatch(/duplicat|unique/i);
    expect(await valorDoContador(db, o.orgId, CANONICA_REBANHO),
      "e o ROLLBACK devolve o contador ao valor anterior — é daqui que vem o travamento").toBe(antes);

    const erro2 = await semLaco();
    expect(erro2, "a SEGUNDA tentativa colide igual: não se resolve sozinha, nunca").toMatch(/duplicat|unique/i);
    expect(await valorDoContador(db, o.orgId, CANONICA_REBANHO), "o contador continua parado").toBe(antes);

    /** A forma CORRIGIDA: pular código já ocupado no namespace real, dentro da mesma transação. */
    const comLaco = async (): Promise<string> => {
      const c = await db.connect();
      try {
        await c.query("begin");
        let code = "";
        for (let i = 0; i < 100; i++) {
          code = String(Number((await c.query<{ n: string }>(
            "select erp.next_code($1,$2)::text n", [o.orgId, CANONICA_REBANHO])).rows[0]!.n)).padStart(5, "0");
          const ex = await c.query(
            "select 1 from erp.animal_movements where organization_id=$1 and movement_type='farm_transfer' and code=$2",
            [o.orgId, code]);
          if (!ex.rowCount) break;
        }
        await c.query(
          `insert into erp.animal_movements (organization_id, empresa_id, code, movement_type, movement_date, status)
           values ($1,$2,$3,'farm_transfer','2026-01-01','pending')`, [o.orgId, o.empresaId, code]);
        await c.query("commit");
        return code;
      } finally { c.release(); }
    };

    const nasceu = await comLaco();
    expect(Number(nasceu), "com o laço, a criação nasce — pulando o número ocupado").toBe(antes + 2);
    expect(await valorDoContador(db, o.orgId, CANONICA_REBANHO),
      "e o contador ANDOU, porque a transação comitou: travamento virou lacuna").toBe(antes + 2);
  });
});
