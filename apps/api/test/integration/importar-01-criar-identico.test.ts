import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";
import { cenariosDoCriar, listasDoBanco, semColacao } from "./importar-01-criar-cenarios.js";

/**
 * IMPORTAR-01 (decisão 317) — O CRIAR FICOU IDÊNTICO.
 *
 * A REFERÊNCIA (`importar-01-criar-referencia.json`) é a saída de `cenariosDoCriar` gerada no commit base 33291879
 * (origin/main com a XML-02), com `apps/api/src` sem mudança nenhuma (`git diff --stat HEAD` vazio), duas vezes, byte a
 * byte iguais (md5 2af7548df2deab447c0d58eb9eb82902): os quatro modelos do CRIAR inteiros (células, notas, cores,
 * formatos, larguras, validações das listas e instruções), a prévia e a gravação nos modos tudo e parcial (com as
 * mensagens de erro e a planilha de erros pelo conteúdo), o código repetido da árvore, a coluna Código no Produto, o
 * modo fora da lista, a chave desconhecida, a falta de `.create`, e o que ficou no banco (código gerado, referências,
 * ID Global e trilha de auditoria). Esta suíte roda os MESMOS cenários sobre o fonte deste HEAD e exige a MESMA saída —
 * inclusive as CHAVES da resposta, na mesma ordem: o CRIAR não ganha campo nenhum.
 *
 * A COLAÇÃO: a referência foi gerada num banco C.UTF-8, e o CI roda en_US.utf8. Nos modelos, as listas que vêm do banco
 * (campos `ref`) são comparadas, dos dois lados, na ordem por ponto de código (`semColacao`), e o primeiro da lista dos
 * cenários é o primeiro nessa ordem. O conteúdo continua comparado inteiro; só a ordem do `order by` do banco sai da conta.
 */
let h: Harness; let admin: Db;
beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 180_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("IMPORTAR-01 · o CRIAR igual ao da base", () => {
  it("IMP01-C1: os mesmos cenários dão a MESMA saída da referência gerada no commit base (modelos, respostas, banco)", async () => {
    const referencia = JSON.parse(fs.readFileSync(path.join(__dirname, "importar-01-criar-referencia.json"), "utf8")) as Record<string, unknown>;
    // premissa anti-vacuidade: a referência tem o que se diz que ela tem
    expect(Object.keys(referencia)).toEqual([
      "modelo_products", "modelo_people", "modelo_chart_accounts", "modelo_measurement_units",
      "produtos_previa_tudo", "produtos_previa_parcial", "produtos_gravar_tudo_com_erro", "produtos_gravar_parcial", "produtos_gravar_tudo",
      "contas_codigo_existente", "produtos_coluna_codigo", "parceiros_gravar_tudo", "modo_fora_da_lista", "chave_desconhecida", "sem_permissao",
      "banco_produtos", "banco_parceiros", "banco_contas",
    ]);
    expect((referencia["produtos_gravar_parcial"] as { status: number; gravadas: number }), "premissa: a referência gravou no parcial").toMatchObject({ status: 201, gravadas: 1 });
    expect((referencia["banco_produtos"] as unknown[]).length, "premissa: a referência criou três produtos").toBe(3);
    // premissa: a normalização da colação alcança as listas do banco (os títulos são os da aba "Listas")
    expect(listasDoBanco("products"), "premissa: as listas do banco do Produto").toEqual(expect.arrayContaining(["Grupo", "1ª Un. Medida"]));
    const atual = JSON.parse(JSON.stringify(await cenariosDoCriar(h, admin))) as Record<string, unknown>;
    const comparavel = (k: string, v: unknown) => (k.startsWith("modelo_") ? semColacao(k.slice("modelo_".length), v as Parameters<typeof semColacao>[1]) : v);
    for (const k of Object.keys(referencia)) expect(comparavel(k, atual[k]), `cenário ${k}`).toEqual(comparavel(k, referencia[k]));
    expect(Object.keys(atual)).toEqual(Object.keys(referencia));
  }, 120_000);
});
