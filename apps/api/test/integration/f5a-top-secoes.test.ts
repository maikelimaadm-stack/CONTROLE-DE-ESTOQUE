import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  configuracaoNeutraTopV5, configuracaoTopParaEdicaoV5, familiaOperacionalDeDocumentoEstoque, lerConfiguracaoTop,
  secoesExtensaoDaVersaoTop,
  secoesExtensaoNeutrasTop,
  type ConfiguracaoTipoOperacao, type ConfiguracaoTipoOperacaoV5, type EspecieEstoque,
} from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, cfg4, criarTop, top, detalheTop, editarTop, novaVersao, versaoAtualNoBanco, versaoDireta,
  versoesNoBanco, auditoriaDe, type Resposta,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F5a (decisão 282) — AS SEÇÕES "DESTINO" E "FLUXO" DO FORMATO 5 NA API DA TOP (plano F5a §4.5).
 *
 *   · FS-1 consumo no 5 com Destino e Fluxo fora do neutro → 201; o banco, o detalhe e a trilha guardam o 5 enviado;
 *          cada PUT marca SÓ a seção que mudou (`secoesAlteradas` na trilha e no histórico); o mesmo corpo é no-op;
 *   · FS-2 a matriz das 7 espécies do documento de estoque × as duas seções: a seção fora do neutro num tipo que não
 *          a usa é UM 422 `combinacao_nao_suportada` no caminho da seção ("Esta operação não usa a seção <Rótulo>."),
 *          e nada nasce; Destino vale para requisição, consumo e saída, Fluxo só para o consumo;
 *   · FS-3 PUT numa saída vigente no 5: Fluxo → o MESMO 422, nada gravado; Destino → a N+1;
 *   · FS-4 a leitura estrita das duas seções: valor fora da lista, chave desconhecida, tipo errado, seção parcial e a
 *          seção num corpo do formato 4 → 422 com a recusa exata, nada nasce;
 *   · FS-5 consumo no formato 4 continua 4 no detalhe e é lido como 5 com as duas seções no NEUTRO; salvar a vista
 *          sem mexer é no-op; mexer só no Destino grava a N+1 no 5;
 *   · FS-6 um 5 gravado SEM as chaves (antes desta fase) é lido com as duas no neutro, e salvar a vista é no-op.
 *
 * OPERACOES-01 F11 (decisão 288): o NEUTRO do Destino passou a "opcional" nas seis dimensões (aceita o destino, nada é
 * exigido); "fora do neutro" no Destino agora é "obrigatória" ou "não usada". E a seção `implantacao` (só a entrada)
 * entra na lista publicada e na matriz (FS-2b).
 *
 * O QUE CONTA COMO PROVA (o molde de `top-formato5-top.test.ts`): versão corrente, formato, revisão e trilha LIDOS NO
 * BANCO pela testemunha (`c.admin`, superusuário sem RLS); "nada gravado" = o pai, as versões e a trilha idênticos
 * antes e depois. As FAMÍLIAS, o NEUTRO das duas seções e as MENSAGENS esperadas estão escritos AQUI, à mão — o
 * domínio não se aprova sozinho.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── o esperado, à mão ───────────────

/** A família de cada espécie do documento de estoque. A requisição de material NÃO é `estoque.requisicao` (a antiga). */
const FAMILIA: Readonly<Record<EspecieEstoque, string>> = {
  entrada: "estoque.entrada",
  saida: "estoque.saida",
  transferencia: "estoque.transferencia",
  ajuste: "estoque.ajuste",
  requisicao: "estoque.requisicao_material",
  consumo: "estoque.consumo",
  devolucao_consumo: "estoque.devolucao_consumo",
};
const ESPECIES = Object.keys(FAMILIA) as EspecieEstoque[];

/** O neutro do Destino: as seis em "opcional" (F11, decisão 288 — era "não usada" na F5a). */
const NEUTRO_DESTINO = {
  centroCusto: "opcional", equipamento: "opcional", ordemServico: "opcional", loteAnimais: "opcional", area: "opcional", safra: "opcional",
} as const;
const NEUTRO_FLUXO = { exigeRequisicao: "nao", permiteParcial: true } as const;

const MSG = {
  destinoForaDoTipo: "Esta operação não usa a seção Destino.",
  fluxoForaDoTipo: "Esta operação não usa a seção Fluxo.",
  implantacaoForaDoTipo: "Esta operação não usa a seção Implantação.",
} as const;
const recusaDoPerfil = (caminho: string, mensagem: string) => ({ motivo: "combinacao_nao_suportada", caminho, mensagem });
const RECUSA_DESTINO = recusaDoPerfil("destino", MSG.destinoForaDoTipo);
const RECUSA_FLUXO = recusaDoPerfil("fluxo", MSG.fluxoForaDoTipo);
const RECUSA_IMPLANTACAO = recusaDoPerfil("implantacao", MSG.implantacaoForaDoTipo);

/** O neutro do FORMATO 5 (o do domínio), com o ajuste do caso. Cada chamada devolve um objeto novo. */
function cfg5(ajuste: (x: ConfiguracaoTipoOperacaoV5) => void = () => {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  ajuste(x);
  return x;
}
/** Destino e Fluxo fora do neutro (as regras que travam LIGADAS). No Destino, "fora do neutro" é "obrigatória" ou "não usada" (F11). */
const destinoLigado = (x: ConfiguracaoTipoOperacaoV5): void => { x.destino.centroCusto = "obrigatoria"; x.destino.safra = "nao_usada"; };
const fluxoLigado = (x: ConfiguracaoTipoOperacaoV5): void => { x.fluxo.exigeRequisicao = "todos"; x.fluxo.permiteParcial = false; };

// ─────────────── testemunhas ───────────────

async function paiNoBanco(topId: string): Promise<{ versao_atual: number; revisao: number }> {
  const r = await c.admin.query<{ versao_atual: number; revisao: number }>("select versao_atual, revisao from erp.tipos_operacao where id=$1", [topId]);
  expect(r.rows, "premissa: a TOP existe").toHaveLength(1);
  return r.rows[0]!;
}
/** A foto da TOP para "nada gravado": pai, versões e o tamanho da trilha. */
async function foto(topId: string) {
  return { pai: await paiNoBanco(topId), versoes: await versoesNoBanco(topId), trilha: (await auditoriaDe("tipos_operacao", topId)).length };
}
const contarTops = async () => Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1", [c.h.demo.orgId])).rows[0]!.n);

type ConfiguracaoNaTela = { suportada: boolean; versaoSchema: number; valor?: unknown };
async function historico(topId: string): Promise<{ versao: number; secoesAlteradas: string[] | null; configuracao: ConfiguracaoNaTela }[]> {
  const r = await c.ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${topId}/versoes`, headers: c.h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r).items as { versao: number; secoesAlteradas: string[] | null; configuracao: ConfiguracaoNaTela }[];
}
/** A configuração que o DETALHE devolve (como GRAVADA), lida pelo leitor do domínio — o que o editor faz antes da vista do 5. */
async function configuracaoDoDetalhe(topId: string): Promise<{ versaoSchema: number; valor: ConfiguracaoTipoOperacao }> {
  const d = await detalheTop(topId);
  expect(d.statusCode, d.body).toBe(200);
  const cfg = j(d).configuracao as ConfiguracaoNaTela;
  expect(cfg.suportada, "premissa: a versão vigente é legível").toBe(true);
  const lida = lerConfiguracaoTop(cfg.valor);
  if (!lida.ok) throw new Error(`a configuração do detalhe não é legível: ${JSON.stringify(lida.recusas)}`);
  return { versaoSchema: cfg.versaoSchema, valor: lida.valor };
}
/** As `secoesAlteradas` de cada `update` da trilha, na ordem em que aconteceram. */
async function secoesNaTrilha(topId: string): Promise<unknown[]> {
  return (await auditoriaDe("tipos_operacao", topId, "update")).map((a) => a.metadata?.secoesAlteradas);
}

/** A recusa da configuração: o 422, o código, a mensagem do envelope e EXATAMENTE estas recusas, nesta ordem. */
function recusadaConfiguracao(r: Resposta, recusas: unknown[]) {
  expect(r.statusCode, r.body).toBe(422);
  expect(erro(r)).toEqual({ code: "TIPO_OPERACAO_CONFIGURACAO_INVALIDA", message: "A configuração operacional enviada é inválida", details: { recusas } });
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// Premissas
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("FS-0 — premissas: as famílias do registry, o neutro do domínio e o que o servidor publica", () => {
  it("FS-0 cada espécie tem a família esperada; o neutro do 5 traz Destino e Fluxo desligados (Destino Opcional, F11) e a Implantação desligada; as capacidades publicam as seções", async () => {
    for (const e of ESPECIES) expect(familiaOperacionalDeDocumentoEstoque(e), `a família da espécie ${e}`).toBe(FAMILIA[e]);
    const neutro = configuracaoNeutraTopV5();
    expect(neutro.destino, "Destino: as seis dimensões opcionais (aceita, nada exige — F11, decisão 288)").toEqual(NEUTRO_DESTINO);
    expect(neutro.fluxo, "Fluxo: consumo direto, atende em parte").toEqual(NEUTRO_FLUXO);
    expect(neutro.implantacao, "Implantação: a entrada é comum (F11)").toEqual({ saldoInicial: false });
    const r = await c.ligada.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: c.h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect((j(r).formato5 as { secoes: unknown }).secoes, "o servidor lê e grava as duas (e as de compras da F6a, a da F9 e a da F11)").toEqual(["destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao", "implantacao"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// FS-1
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("FS-1 — consumo no 5 com Destino e Fluxo", () => {
  it("FS-1 POST → 201 com o 5 enviado no banco, no detalhe e na trilha; cada PUT marca só a seção que mudou; o mesmo corpo é no-op", async () => {
    const corpo = cfg5((x) => { destinoLigado(x); fluxoLigado(x); });
    expect([corpo.versaoSchema, corpo.destino.centroCusto, corpo.fluxo.exigeRequisicao], "premissa: o corpo é do 5, com as duas fora do neutro")
      .toEqual([5, "obrigatoria", "todos"]);
    const id = await top(FAMILIA.consumo, { configuracao: corpo });
    const v1 = await versaoAtualNoBanco(id);
    expect([v1.versao, v1.configuracao_schema_version]).toEqual([1, 5]);
    expect(v1.configuracao.destino, "o banco guarda o Destino enviado").toEqual({ ...NEUTRO_DESTINO, centroCusto: "obrigatoria", safra: "nao_usada" });
    expect(v1.configuracao.fluxo, "e o Fluxo enviado").toEqual({ exigeRequisicao: "todos", permiteParcial: false });
    expect(v1.configuracao).toEqual(corpo);
    const d = j(await detalheTop(id));
    expect(d.configuracao, "o detalhe devolve o 5 como enviado").toEqual({ suportada: true, versaoSchema: 5, valor: corpo });
    const create = await auditoriaDe("tipos_operacao", id, "create");
    expect(create).toHaveLength(1);
    expect(create[0]!.metadata).toMatchObject({ codigoBase: FAMILIA.consumo, versao: 1, configuracaoSchema: 5 });

    // SÓ O DESTINO muda → v2, `destino`.
    const soDestino = cfg5((x) => { destinoLigado(x); fluxoLigado(x); x.destino.equipamento = "obrigatoria"; });
    expect((await novaVersao(id, soDestino)).versao).toBe(2);
    // O MESMO corpo de novo → no-op: nenhuma versão, revisão nem trilha.
    const antesDoNoop = await foto(id);
    const noop = await editarTop(id, { configuracao: soDestino });
    expect(noop.statusCode, noop.body).toBe(200);
    expect(j(noop).versao, "o mesmo corpo não cria versão").toBe(2);
    expect(await foto(id), "nada gravado").toEqual(antesDoNoop);
    // SÓ O FLUXO muda → v3, `fluxo`.
    const soFluxo = cfg5((x) => { destinoLigado(x); fluxoLigado(x); x.destino.equipamento = "obrigatoria"; x.fluxo.permiteParcial = true; });
    expect((await novaVersao(id, soFluxo)).versao).toBe(3);
    // AS DUAS voltam ao neutro → v4, `destino` e `fluxo` (na ordem da lista do domínio).
    expect((await novaVersao(id, cfg5())).versao).toBe(4);

    expect(await versoesNoBanco(id)).toEqual([1, 2, 3, 4].map((versao) => ({ versao, configuracao_schema_version: 5 })));
    expect(await secoesNaTrilha(id), "a trilha marca só o que mudou em cada versão").toEqual([["destino"], ["fluxo"], ["destino", "fluxo"]]);
    const hist = await historico(id);
    expect(hist.slice(0, 3).map((x) => [x.versao, x.secoesAlteradas])).toEqual([[4, ["destino", "fluxo"]], [3, ["fluxo"]], [2, ["destino"]]]);
    expect(hist[0]!.configuracao, "a v4 no neutro do 5").toEqual({ suportada: true, versaoSchema: 5, valor: cfg5() });
    expect(hist[3]!.configuracao, "a v1 como gravada").toEqual({ suportada: true, versaoSchema: 5, valor: corpo });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// FS-2
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("FS-2 — a matriz: as 7 espécies × Destino e Fluxo", () => {
  /** O que cada espécie RECUSA com as duas seções fora do neutro (Destino: requisição, consumo e saída; Fluxo: consumo). */
  const RECUSAS: Readonly<Record<EspecieEstoque, unknown[]>> = {
    entrada: [RECUSA_DESTINO, RECUSA_FLUXO],
    saida: [RECUSA_FLUXO],
    transferencia: [RECUSA_DESTINO, RECUSA_FLUXO],
    ajuste: [RECUSA_DESTINO, RECUSA_FLUXO],
    requisicao: [RECUSA_FLUXO],
    consumo: [],
    devolucao_consumo: [RECUSA_DESTINO, RECUSA_FLUXO],
  };

  it("FS-2 POST no 5 com as duas fora do neutro → o 422 com a recusa de cada seção que o tipo não usa, nada nasce; o consumo aceita; só a seção usada → 201", async () => {
    const corpo = cfg5((x) => { destinoLigado(x); fluxoLigado(x); });
    for (const e of ESPECIES) {
      const antes = await contarTops();
      const r = await criarTop(FAMILIA[e], { configuracao: corpo });
      if (RECUSAS[e].length === 0) {
        expect(r.statusCode, `${e}: aceita as duas — ${r.body}`).toBe(201);
        expect((await versaoAtualNoBanco(j(r).id as string)).configuracao).toEqual(corpo);
        continue;
      }
      recusadaConfiguracao(r, RECUSAS[e]);
      expect(await contarTops(), `${e}: nenhuma TOP nasce`).toBe(antes);
    }
    // A SEÇÃO QUE O TIPO USA, sozinha: o Destino da saída e o da requisição gravam no 5.
    for (const e of ["saida", "requisicao"] as const) {
      const id = await top(FAMILIA[e], { configuracao: cfg5(destinoLigado) });
      const v = await versaoAtualNoBanco(id);
      expect([v.configuracao_schema_version, v.configuracao.destino], `${e}: o Destino gravado`)
        .toEqual([5, { ...NEUTRO_DESTINO, centroCusto: "obrigatoria", safra: "nao_usada" }]);
      expect(v.configuracao.fluxo, `${e}: o Fluxo no neutro`).toEqual(NEUTRO_FLUXO);
    }
    // PREMISSA (só a seção fora do neutro é recusada): as 7 no NEUTRO do 5 são aceitas.
    for (const e of ESPECIES) expect((await criarTop(FAMILIA[e], { configuracao: cfg5() })).statusCode, `${e} no neutro do 5`).toBe(201);
  });

  it("FS-2b (F11) a Implantação ligada: só a entrada aceita e grava; as outras 6 → o 422 da seção, nada nasce", async () => {
    const corpo = cfg5((x) => { x.implantacao.saldoInicial = true; });
    expect(corpo.implantacao, "premissa: o corpo liga a Implantação").toEqual({ saldoInicial: true });
    for (const e of ESPECIES) {
      const antes = await contarTops();
      const r = await criarTop(FAMILIA[e], { configuracao: corpo });
      if (e === "entrada") {
        expect(r.statusCode, `entrada: aceita — ${r.body}`).toBe(201);
        const v = await versaoAtualNoBanco(j(r).id as string);
        expect([v.configuracao_schema_version, v.configuracao.implantacao], "o banco guarda a Implantação ligada").toEqual([5, { saldoInicial: true }]);
        continue;
      }
      recusadaConfiguracao(r, [RECUSA_IMPLANTACAO]);
      expect(await contarTops(), `${e}: nenhuma TOP nasce`).toBe(antes);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// FS-3
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("FS-3 — PUT numa saída vigente no 5", () => {
  it("FS-3 Fluxo fora do neutro → o 422 da seção e nada gravado; Destino → a N+1 no 5, `destino`", async () => {
    const id = await top(FAMILIA.saida, { configuracao: cfg5() });
    const f = await foto(id);
    expect(f.versoes, "premissa: a saída nasceu no 5").toEqual([{ versao: 1, configuracao_schema_version: 5 }]);
    recusadaConfiguracao(await editarTop(id, { configuracao: cfg5(fluxoLigado) }), [RECUSA_FLUXO]);
    recusadaConfiguracao(await editarTop(id, { configuracao: cfg5((x) => { x.fluxo.permiteParcial = false; }) }), [RECUSA_FLUXO]);
    expect(await foto(id), "nenhuma das recusas grava").toEqual(f);
    expect((await novaVersao(id, cfg5(destinoLigado))).versao).toBe(2);
    expect(await secoesNaTrilha(id)).toEqual([["destino"]]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// FS-4
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("FS-4 — a leitura estrita das duas seções", () => {
  /** Um corpo do 5 com as seções trocadas por `troca` (o resto, o neutro do domínio). */
  const com = (troca: Record<string, unknown>): Record<string, unknown> => ({ ...configuracaoNeutraTopV5(), ...troca });

  it("FS-4 valor fora da lista, chave desconhecida, tipo errado, seção parcial e a seção num corpo do 4 → 422 com a recusa exata; nada nasce", async () => {
    const casos: [string, Record<string, unknown>, unknown[]][] = [
      ["exigência fora da lista", com({ destino: { ...NEUTRO_DESTINO, centroCusto: "talvez" } }),
        [{ motivo: "valor_invalido", caminho: "destino.centroCusto" }]],
      ["dimensão desconhecida", com({ destino: { ...NEUTRO_DESTINO, maquina: "opcional" } }),
        [{ motivo: "campo_desconhecido", caminho: "destino.maquina" }]],
      ["Destino que não é objeto", com({ destino: "obrigatoria" }), [{ motivo: "tipo_invalido", caminho: "destino" }]],
      ["Destino parcial: cada dimensão que falta", com({ destino: { centroCusto: "obrigatoria" } }),
        ["equipamento", "ordemServico", "loteAnimais", "area", "safra"].map((d) => ({ motivo: "tipo_invalido", caminho: `destino.${d}` }))],
      ["Exigir requisição fora da lista", com({ fluxo: { ...NEUTRO_FLUXO, exigeRequisicao: "sempre" } }),
        [{ motivo: "valor_invalido", caminho: "fluxo.exigeRequisicao" }]],
      ["Atender em parte que não é booleano", com({ fluxo: { ...NEUTRO_FLUXO, permiteParcial: "sim" } }),
        [{ motivo: "tipo_invalido", caminho: "fluxo.permiteParcial" }]],
      ["campo desconhecido no Fluxo", com({ fluxo: { ...NEUTRO_FLUXO, parcial: true } }),
        [{ motivo: "campo_desconhecido", caminho: "fluxo.parcial" }]],
      // O 4 nunca carrega seção nova (regra 2 do ponto de extensão).
      ["Destino num corpo do formato 4", { ...cfg4(), destino: { ...NEUTRO_DESTINO } }, [{ motivo: "campo_desconhecido", caminho: "destino" }]],
      ["Fluxo num corpo do formato 4", { ...cfg4(), fluxo: { ...NEUTRO_FLUXO } }, [{ motivo: "campo_desconhecido", caminho: "fluxo" }]],
    ];
    for (const [nome, configuracao, recusas] of casos) {
      const antes = await contarTops();
      const r = await criarTop(FAMILIA.consumo, { configuracao });
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      recusadaConfiguracao(r, recusas);
      expect(await contarTops(), `${nome}: nada nasce`).toBe(antes);
    }
    // PREMISSA: as duas seções inteiras e válidas no 5, e o 4 sem elas, são aceitos.
    expect((await criarTop(FAMILIA.consumo, { configuracao: com({ destino: { ...NEUTRO_DESTINO }, fluxo: { ...NEUTRO_FLUXO } }) })).statusCode).toBe(201);
    expect((await criarTop(FAMILIA.consumo, { configuracao: cfg4() })).statusCode).toBe(201);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// FS-5
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("FS-5 — consumo no formato 4, lido como 5", () => {
  it("FS-5 o detalhe devolve o 4 como gravado; a vista do 5 e a execução leem as duas no neutro; salvar a vista é no-op; só o Destino → v2 no 5", async () => {
    const id = await top(FAMILIA.consumo, { configuracao: cfg4() });
    const f = await foto(id);
    expect(f.versoes, "premissa: gravada no 4").toEqual([{ versao: 1, configuracao_schema_version: 4 }]);
    const lida = await configuracaoDoDetalhe(id);
    expect(lida.versaoSchema, "o detalhe devolve a versão COMO GRAVADA").toBe(4);
    expect(lida.valor, "o 4 não tem as seções novas").not.toHaveProperty("destino");
    expect(lida.valor).not.toHaveProperty("fluxo");
    // A EXECUÇÃO lê a versão gravada: as duas no neutro (nada trava).
    // As duas desta fase, escritas à mão; as das outras fases (F6a em diante) também no neutro do domínio.
    expect(secoesExtensaoDaVersaoTop(lida.valor)).toEqual({ ...secoesExtensaoNeutrasTop(), destino: NEUTRO_DESTINO, fluxo: NEUTRO_FLUXO });
    // O EDITOR lê a vista do 5: as duas no neutro.
    const vista = configuracaoTopParaEdicaoV5(lida.valor);
    expect([vista.versaoSchema, vista.destino, vista.fluxo]).toEqual([5, NEUTRO_DESTINO, NEUTRO_FLUXO]);

    const r = await editarTop(id, { configuracao: vista });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id, versao: 1, revisao: f.pai.revisao });
    expect(await foto(id), "nada gravado: continua a v1, no 4").toEqual(f);

    expect((await novaVersao(id, { ...vista, destino: { ...vista.destino, area: "obrigatoria" } })).versao).toBe(2);
    expect(await versoesNoBanco(id)).toEqual([{ versao: 1, configuracao_schema_version: 4 }, { versao: 2, configuracao_schema_version: 5 }]);
    expect(await secoesNaTrilha(id), "só o Destino mudou: do 4 ao 5 nada passa a valer").toEqual([["destino"]]);
    const hist = await historico(id);
    expect(hist.map((x) => [x.versao, x.configuracao.versaoSchema])).toEqual([[2, 5], [1, 4]]);
    expect(hist[0]!.secoesAlteradas).toEqual(["destino"]);
    expect(hist[1]!.configuracao, "a v1 como gravada, nunca promovida").toEqual({ suportada: true, versaoSchema: 4, valor: cfg4() });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// FS-6
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("FS-6 — um 5 gravado antes desta fase (sem as chaves)", () => {
  it("FS-6 o detalhe lê o 5 sem as chaves com as duas no neutro; salvar a vista sem mexer é no-op", async () => {
    const id = await top(FAMILIA.consumo, { configuracao: cfg4() });
    const sem: Record<string, unknown> = { ...configuracaoNeutraTopV5() };
    delete sem.destino;
    delete sem.fluxo;
    await versaoDireta(id, sem);
    const v2 = await versaoAtualNoBanco(id);
    expect([v2.versao, v2.configuracao_schema_version], "premissa: a v2 é um 5").toEqual([2, 5]);
    expect(v2.configuracao, "premissa: gravado SEM as seções desta fase").not.toHaveProperty("destino");
    expect(v2.configuracao).not.toHaveProperty("fluxo");

    const lida = await configuracaoDoDetalhe(id);
    expect(lida.versaoSchema).toBe(5);
    expect(secoesExtensaoDaVersaoTop(lida.valor), "a seção ausente num 5 vale o neutro (as das outras fases também)")
      .toEqual({ ...secoesExtensaoNeutrasTop(), destino: NEUTRO_DESTINO, fluxo: NEUTRO_FLUXO });
    const vista = configuracaoTopParaEdicaoV5(lida.valor);
    const f = await foto(id);
    const r = await editarTop(id, { configuracao: vista });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).versao, "a vista no neutro é igual ao gravado: no-op").toBe(2);
    expect(await foto(id), "nada gravado").toEqual(f);
  });
});
