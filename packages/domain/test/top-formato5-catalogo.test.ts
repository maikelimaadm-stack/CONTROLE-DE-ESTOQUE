import { describe, it, expect } from "vitest";
import {
  ABAS_FIXAS_EDITOR_TOP,
  CATALOGO_TIPOS_MOVIMENTO_TOP,
  CATALOGO_TOP,
  CHAVES_EXIGENCIA_TOP,
  EXIGENCIAS_GERAIS_SEM_DOCUMENTO_TOP,
  GRUPOS_TIPO_MOVIMENTO_TOP,
  MENSAGEM_CONDICOES_FORA_DO_TIPO,
  MENSAGEM_EXIGENCIA_FORA_DO_TIPO,
  PERFIS_TIPO_TOP,
  ROTULOS_GRUPO_TIPO_MOVIMENTO_TOP,
  ROTULOS_SECAO_CONFIGURACAO_TOP,
  ROTULO_EXIGENCIA_TOP,
  TEXTO_CONDICOES_VOLTAM_TOP,
  condicoesQueVoltamPeloPerfilTop,
  lerCatalogoTop,
  mensagemSecaoForaDoTipo,
  normalizarPeloPerfilTop,
  perfilDaFamiliaTop,
  perfilDoTipoTop,
  recusaDasCondicoesDoPerfilTop,
  recusasDoPerfilTop,
  tiposParaEscolhaTop,
  type CatalogoTop,
  type PerfilDoTipoTop,
} from "../src/tipo-operacao-catalogo.js";
import {
  SECOES_CONFIGURACAO_TOP_V5,
  configuracaoNeutraTopV4,
  configuracaoNeutraTopV5,
  configuracaoTopParaEdicaoV4,
  lerConfiguracaoTop,
  type ConfiguracaoTipoOperacaoV5,
} from "../src/tipo-operacao-configuracao.js";
import { SECOES_EXTENSAO_V5, definirSecaoV5, type DefinicaoSecaoV5 } from "../src/tipo-operacao-secoes-v5.js";
import { CODIGOS_TIPO_OPERACAO } from "../src/tipo-operacao.js";
import { MATRIZ_REGRAS_GERAIS_TOP, regrasGeraisDaFamiliaTop } from "../src/tipo-operacao-regras-gerais.js";
import { familiaAceitaExecucaoConfiguradaTop } from "../src/tipo-operacao-execucao.js";
import { familiaTemProximasOperacoes } from "../src/tipo-operacao-destinos.js";
import { ehFamiliaDeDocumentoEstoque } from "../src/estoque-documento.js";

/**
 * OPERACOES-01 F4 (decisão 281) — O CATÁLOGO ÚNICO "O QUE CADA TIPO MOSTRA E ACEITA".
 *
 * CT-1 os grupos e os 22 tipos, na ordem do pedido, com a família perguntada ao registry.
 * CT-2 todos os 22 tipos têm tela desde a F10 (os 9 cujo documento cita a TOP, o orçamento de compra, os 3 da
 *      movimentação interna, os 6 de Módulos e os 3 do Financeiro); o passo 1 oferece só os com tela.
 * CT-3 um perfil por família do registry; as 8 famílias antigas ficam fora do passo 1.
 * CT-4 os perfis derivados — cada um com a premissa de cada predicado de onde ele sai.
 * CT-5 a recusa do formato 5 (e só do 5).
 * CT-6 a volta ao padrão antes de gravar.
 * CT-7 o leitor estrito do catálogo publicado.
 *
 * Os códigos de família aparecem LITERAIS aqui de propósito: o teste confere a derivação (o catálogo não os
 * escreve — `familia-operacional-ssot-audit`), e se o registry mudar, este teste falha alto.
 */

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Congela em profundidade: qualquer tentativa de mutar a entrada lança (módulo ESM = modo estrito). */
function congelar<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const k of Object.keys(v)) congelar((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

const perfil = (familia: string): PerfilDoTipoTop => {
  const p = perfilDaFamiliaTop(familia);
  if (!p) throw new Error(`sem perfil: ${familia}`);
  return p;
};

/** Um 5 com um ajuste, numa cópia. */
function v5(ajuste: (c: ConfiguracaoTipoOperacaoV5) => void = () => undefined): ConfiguracaoTipoOperacaoV5 {
  const c = configuracaoNeutraTopV5();
  ajuste(c);
  return c;
}

/** O gêmeo do 4 de um 5: as mesmas chaves e valores de hoje, sem as seções de extensão (a vista do 4, da F6a em diante). */
const comoV4 = (c: ConfiguracaoTipoOperacaoV5) => configuracaoTopParaEdicaoV4(clonar(c));

const ENTRADA = "estoque.entrada";
const VENDA = "vendas.venda";

// ---------------------------------------------------------------------------------------------------
// CT-1 — grupos e tipos
// ---------------------------------------------------------------------------------------------------

describe("CT-1 o catálogo: grupos e tipos", () => {
  it("CT-1 os cinco grupos, na ordem do pedido, com os rótulos", () => {
    expect(CATALOGO_TOP.grupos).toEqual([
      { chave: "vendas", rotulo: "Vendas" },
      { chave: "compras", rotulo: "Compras" },
      { chave: "movimentacao_interna", rotulo: "Movimentação interna" },
      { chave: "modulos", rotulo: "Módulos" },
      { chave: "financeiro", rotulo: "Financeiro" },
    ]);
    expect(CATALOGO_TOP.grupos.map((g) => g.chave)).toEqual([...GRUPOS_TIPO_MOVIMENTO_TOP]);
    for (const g of GRUPOS_TIPO_MOVIMENTO_TOP) expect(ROTULOS_GRUPO_TIPO_MOVIMENTO_TOP[g].length).toBeGreaterThan(0);
  });

  it("CT-1 os 22 tipos, na ordem, com grupo, rótulo e a família perguntada ao registry (ou nula)", () => {
    expect(CATALOGO_TIPOS_MOVIMENTO_TOP.map((t) => [t.chave, t.grupo, t.rotulo, t.familia])).toEqual([
      ["orcamento_venda", "vendas", "Orçamento", "vendas.orcamento"],
      ["pedido_venda", "vendas", "Pedido", "vendas.pedido"],
      ["venda", "vendas", "Venda", "vendas.venda"],
      ["pedido_compra", "compras", "Pedido", "compras.pedido"],
      ["orcamento_compra", "compras", "Orçamento", "compras.orcamento"],
      ["compra", "compras", "Compra", "compras.compra"],
      ["requisicao", "movimentacao_interna", "Requisição", "estoque.requisicao_material"],
      ["consumo", "movimentacao_interna", "Consumo", "estoque.consumo"],
      ["devolucao_consumo", "movimentacao_interna", "Devolução de consumo", "estoque.devolucao_consumo"],
      ["entrada", "movimentacao_interna", "Entrada", "estoque.entrada"],
      ["saida", "movimentacao_interna", "Saída/baixa", "estoque.saida"],
      ["transferencia", "movimentacao_interna", "Transferência", "estoque.transferencia"],
      ["ajuste", "movimentacao_interna", "Ajuste", "estoque.ajuste"],
      ["abastecimento", "modulos", "Abastecimento", "frota_ativos.abastecimento"],
      ["manutencao", "modulos", "Manutenção", "frota_ativos.manutencao"],
      ["ordem_servico", "modulos", "Ordem de serviço", "ordens_servico.ordem_de_servico"],
      // OPERACOES-01 F10 (decisão 287): manejo e batelada ganharam a família no registry.
      ["manejo", "modulos", "Manejo", "pecuaria.manejo"],
      ["batelada", "modulos", "Batelada", "confinamento.batelada"],
      ["producao_racao", "modulos", "Produção de ração", "estoque.producao_de_racao"],
      ["conta_pagar", "financeiro", "Conta a pagar", "financeiro.conta_a_pagar"],
      ["conta_receber", "financeiro", "Conta a receber", "financeiro.conta_a_receber"],
      ["movimento_bancario", "financeiro", "Movimento bancário", "financeiro.movimento_bancario"],
    ]);
    expect(CATALOGO_TOP.tipos).toBe(CATALOGO_TIPOS_MOVIMENTO_TOP);
  });

  it("CT-1 nenhuma chave com ponto; toda família é do registry ou nula; nenhuma família em dois tipos", () => {
    const familias: string[] = [];
    for (const t of CATALOGO_TIPOS_MOVIMENTO_TOP) {
      expect(t.chave.includes("."), t.chave).toBe(false);
      if (t.familia !== null) {
        expect(CODIGOS_TIPO_OPERACAO.includes(t.familia), t.familia).toBe(true);
        familias.push(t.familia);
      }
    }
    expect(new Set(familias).size).toBe(familias.length);
    // Todos os 22 com família desde a F10 (manejo e batelada ganharam a família nova).
    expect(CATALOGO_TIPOS_MOVIMENTO_TOP.filter((t) => t.familia === null).map((t) => t.chave), "a premissa: nenhum tipo sem família").toEqual([]);
    expect(familias).toHaveLength(22);
  });

  it("CT-1 o catálogo é congelado (nenhum consumidor muda o que o outro vê)", () => {
    expect(Object.isFrozen(CATALOGO_TOP)).toBe(true);
    expect(Object.isFrozen(CATALOGO_TOP.tipos)).toBe(true);
    expect(Object.isFrozen(CATALOGO_TOP.tipos[0])).toBe(true);
    expect(Object.isFrozen(CATALOGO_TOP.perfis[0]?.abas)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// CT-2 — o que tem tela
// ---------------------------------------------------------------------------------------------------

describe("CT-2 só os tipos cujo documento cita a TOP aparecem para escolha", () => {
  it("CT-2 as famílias com tela: as 19 da matriz das regras gerais (o documento que cita a TOP, com as três da movimentação interna desde a F5b e os 6 módulos desde a F10) e as 3 do Financeiro (F9)", () => {
    expect(MATRIZ_REGRAS_GERAIS_TOP, "a premissa: a matriz tem as 13 famílias com documento e as 6 dos módulos (F10)").toHaveLength(19);
    // A premissa da F5b: as três da movimentação interna TÊM documento na matriz (e agora tela).
    const daMovimentacaoInterna = ["estoque.requisicao_material", "estoque.consumo", "estoque.devolucao_consumo"];
    for (const f of daMovimentacaoInterna) expect(MATRIZ_REGRAS_GERAIS_TOP.some((m) => m.familia === f), `a premissa: ${f} tem documento`).toBe(true);
    const financeiras = ["financeiro.conta_a_pagar", "financeiro.conta_a_receber", "financeiro.movimento_bancario"];
    // A premissa: as do Financeiro não têm linha na matriz (não são documento com produto) — a tela delas é o
    // lançamento avulso da Central Financeira e o "Novo movimento bancário", que escolhem a TOP primeiro.
    for (const f of financeiras) expect(MATRIZ_REGRAS_GERAIS_TOP.some((m) => m.familia === f), f).toBe(false);
    const comTela = CATALOGO_TIPOS_MOVIMENTO_TOP.filter((t) => t.temTela).map((t) => t.familia);
    expect(new Set(comTela)).toEqual(new Set([...MATRIZ_REGRAS_GERAIS_TOP.map((m) => m.familia), ...financeiras]));
    for (const f of daMovimentacaoInterna) expect(comTela, `${f} com tela desde a F5b`).toContain(f);
    expect(comTela).toHaveLength(22);
    expect(comTela, "o orçamento de compra tem tela desde a F6b").toContain("compras.orcamento");
  });

  it("CT-2 nenhum tipo sem tela (desde a F10)", () => {
    expect(CATALOGO_TIPOS_MOVIMENTO_TOP.filter((t) => !t.temTela).map((t) => t.chave)).toEqual([]);
    // A premissa: o catálogo tem os 22 tipos.
    expect(CATALOGO_TIPOS_MOVIMENTO_TOP).toHaveLength(22);
  });

  it("CT-2 o passo 1: Vendas (3), Compras (3), Movimentação interna (7, na ordem do catálogo), Módulos (6, F10), Financeiro (3)", () => {
    const passo1 = tiposParaEscolhaTop(CATALOGO_TOP);
    // A premissa: a ordem do grupo no catálogo (a do pedido) é a que o passo 1 repete.
    expect(CATALOGO_TIPOS_MOVIMENTO_TOP.filter((t) => t.grupo === "movimentacao_interna").map((t) => t.chave)).toEqual([
      "requisicao", "consumo", "devolucao_consumo", "entrada", "saida", "transferencia", "ajuste",
    ]);
    expect(passo1.map((g) => [g.grupo.chave, g.tipos.map((t) => t.chave)])).toEqual([
      ["vendas", ["orcamento_venda", "pedido_venda", "venda"]],
      ["compras", ["pedido_compra", "orcamento_compra", "compra"]],
      ["movimentacao_interna", ["requisicao", "consumo", "devolucao_consumo", "entrada", "saida", "transferencia", "ajuste"]],
      ["modulos", ["abastecimento", "manutencao", "ordem_servico", "manejo", "batelada", "producao_racao"]],
      ["financeiro", ["conta_pagar", "conta_receber", "movimento_bancario"]],
    ]);
  });

  it("CT-2 desligar um tipo o tira do passo 1; desligar os 6 de Módulos tira o grupo (sobre um catálogo derivado)", () => {
    const desligar = (chaves: readonly string[]): CatalogoTop => ({
      ...CATALOGO_TOP,
      tipos: CATALOGO_TOP.tipos.map((t) => (chaves.includes(t.chave) ? { ...t, temTela: false } : t)),
    });
    const modulosDo = (c: CatalogoTop) => tiposParaEscolhaTop(c).find((g) => g.grupo.chave === "modulos")?.tipos.map((t) => t.chave);
    // A premissa: no catálogo do produto, o abastecimento está no passo 1.
    expect(modulosDo(CATALOGO_TOP)).toContain("abastecimento");
    expect(modulosDo(desligar(["abastecimento"]))).toEqual(["manutencao", "ordem_servico", "manejo", "batelada", "producao_racao"]);
    const seis = ["abastecimento", "manutencao", "ordem_servico", "manejo", "batelada", "producao_racao"];
    const semModulos = tiposParaEscolhaTop(desligar(seis));
    expect(semModulos.some((g) => g.grupo.chave === "modulos")).toBe(false);
    // Os outros grupos não mudam (os que as outras fases ligam continuam como estão).
    expect(semModulos.map((g) => g.grupo.chave)).toEqual(tiposParaEscolhaTop(CATALOGO_TOP).map((g) => g.grupo.chave).filter((g) => g !== "modulos"));
  });
});

// ---------------------------------------------------------------------------------------------------
// CT-3 — cobertura do registry
// ---------------------------------------------------------------------------------------------------

describe("CT-3 um perfil por família do registry", () => {
  it("CT-3 30 perfis, na ordem do registry", () => {
    expect(CODIGOS_TIPO_OPERACAO, "a premissa: o registry tem 30 famílias (28 + manejo e batelada, F10)").toHaveLength(30);
    expect(PERFIS_TIPO_TOP.map((p) => p.familia)).toEqual([...CODIGOS_TIPO_OPERACAO]);
    expect(CATALOGO_TOP.perfis).toBe(PERFIS_TIPO_TOP);
  });

  it("CT-3 as famílias fora dos tipos do passo 1 são exatamente as 8 antigas (continuam editáveis, sem passo 1)", () => {
    const noCatalogo = new Set(CATALOGO_TIPOS_MOVIMENTO_TOP.map((t) => t.familia));
    expect(CODIGOS_TIPO_OPERACAO.filter((f) => !noCatalogo.has(f))).toEqual([
      "estoque.entrada_manual", "estoque.documento_fiscal", "estoque.requisicao", "estoque.baixa", "estoque.devolucao",
      "estoque.transferencia_entre_armazens", "estoque.transferencia_entre_empresas", "compras.solicitacao",
    ]);
  });

  it("CT-3 família fora do registry não tem perfil (quem chama nega)", () => {
    expect(perfilDaFamiliaTop("vendas.devolucao")).toBeNull();
    expect(perfilDaFamiliaTop("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// CT-4 — os perfis derivados, com a premissa de cada predicado
// ---------------------------------------------------------------------------------------------------

describe("CT-4 os perfis derivados", () => {
  /** As premissas de onde o perfil sai, conferidas ao lado da conclusão. */
  const predicados = (f: string) => ({
    destinos: familiaTemProximasOperacoes(f),
    estoqueDoc: ehFamiliaDeDocumentoEstoque(f),
    aprovacao: regrasGeraisDaFamiliaTop(f).aprovacao.aceitos.some((p) => p !== "nenhuma"),
    execucao: familiaAceitaExecucaoConfiguradaTop(f),
    comDocumento: MATRIZ_REGRAS_GERAIS_TOP.some((m) => m.familia === f),
  });
  const rotulos = (p: PerfilDoTipoTop) => p.exigencias.map((e) => e.rotulo);
  const VENDAS = ["Cliente", "Centro de resultado", "Observação", "Transportadora"];
  const COMPRAS = ["Fornecedor", "Centro de resultado", "Observação", "Transportadora"];

  it("CT-4 venda: todas as abas; exigências do documento de venda", () => {
    expect(predicados(VENDA)).toEqual({ destinos: true, estoqueDoc: false, aprovacao: true, execucao: true, comDocumento: true });
    const p = perfil(VENDA);
    expect(p.abas).toEqual(["identificacao", "geral", "destinos", "estoque", "financeiroPadrao", "financeiro", "fiscal", "aprovacao", "execucao"]);
    expect(rotulos(p)).toEqual(VENDAS);
    expect(p.secoesNeutras).toEqual(["destino", "fluxo", "fluxoCompra", "divergenciaPedido"]);
  });

  it("CT-4 orçamento e pedido de venda: sem Aprovação e sem Execução (o servidor já obriga o padrão); Padrões financeiros só no pedido (F9)", () => {
    for (const f of ["vendas.orcamento", "vendas.pedido"]) {
      expect(predicados(f), f).toEqual({ destinos: true, estoqueDoc: false, aprovacao: false, execucao: false, comDocumento: true });
      const p = perfil(f);
      const pedido = f === "vendas.pedido";
      expect(p.abas, f).toEqual(["identificacao", "geral", "destinos", "estoque", ...(pedido ? ["financeiroPadrao"] : []), "financeiro", "fiscal"]);
      expect(rotulos(p), f).toEqual(VENDAS);
      expect(p.secoesNeutras, f).toEqual(pedido ? ["destino", "fluxo", "fluxoCompra", "divergenciaPedido"] : ["destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
    }
  });

  it("CT-4 pedido de compra: com Próximas operações, Fluxo de compra, Padrões financeiros (F9b) e Aprovação (ao finalizar, F6a), sem Execução; exigências do fornecedor", () => {
    const f = "compras.pedido";
    expect(predicados(f)).toEqual({ destinos: true, estoqueDoc: false, aprovacao: true, execucao: false, comDocumento: true });
    expect(perfil(f).abas).toEqual(["identificacao", "geral", "destinos", "estoque", "fluxoCompra", "financeiroPadrao", "financeiro", "fiscal", "aprovacao"]);
    expect(rotulos(perfil(f))).toEqual(COMPRAS);
    // Os padrões financeiros e a provisão do pedido de compra finalizado (F9b).
    expect(perfil(f).secoesNeutras).toEqual(["destino", "fluxo", "divergenciaPedido"]);
  });

  it("CT-4 compra: sem Próximas operações; com Padrões financeiros (F9b), Aprovação e Execução", () => {
    const f = "compras.compra";
    expect(predicados(f)).toEqual({ destinos: false, estoqueDoc: false, aprovacao: true, execucao: true, comDocumento: true });
    expect(perfil(f).abas).toEqual(["identificacao", "geral", "estoque", "divergenciaPedido", "financeiroPadrao", "financeiro", "fiscal", "aprovacao", "execucao"]);
    expect(rotulos(perfil(f))).toEqual(COMPRAS);
    expect(perfil(f).secoesNeutras).toEqual(["destino", "fluxo", "fluxoCompra"]);
  });

  it("CT-4 as 4 espécies do documento de estoque: Identificação, Geral, Estoque (+ Destino na saída, F5a) e Aprovação; só Observação; Estoque, Financeiro e Fiscal no padrão", () => {
    for (const f of ["estoque.entrada", "estoque.saida", "estoque.transferencia", "estoque.ajuste"]) {
      expect(predicados(f), f).toEqual({ destinos: false, estoqueDoc: true, aprovacao: true, execucao: false, comDocumento: true });
      const p = perfil(f);
      const saida = f === "estoque.saida";
      expect(p.abas, f).toEqual(["identificacao", "geral", "estoque", ...(saida ? ["destino"] : []), "aprovacao"]);
      expect(rotulos(p), f).toEqual(["Observação"]);
      expect(p.secoesNeutras, f).toEqual(["estoque", "financeiro", "fiscal", ...(saida ? [] : ["destino"]), "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
    }
  });

  it("CT-4 abastecimento (F10): com documento — o registro do módulo; Estoque, Financeiro e Fiscal como hoje; exigências do registro", () => {
    const f = "frota_ativos.abastecimento";
    expect(predicados(f)).toEqual({ destinos: false, estoqueDoc: false, aprovacao: false, execucao: false, comDocumento: true });
    expect(perfil(f).abas).toEqual(["identificacao", "geral", "estoque", "financeiro", "fiscal"]);
    expect(perfil(f).exigencias).toEqual([
      { chave: "exigeCentroResultado", rotulo: "Centro de resultado" },
      { chave: "exigeObservacao", rotulo: "Observação" },
    ]);
    expect(perfil(f).secoesNeutras).toEqual(["destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
  });

  it("CT-4 os 6 módulos (F10): as abas sem Aprovação nem Execução e as exigências que o registro de cada um tem", () => {
    const esperadas: ReadonlyArray<readonly [string, string[]]> = [
      ["frota_ativos.abastecimento", ["Centro de resultado", "Observação"]],
      ["frota_ativos.manutencao", ["Observação"]],
      ["ordens_servico.ordem_de_servico", ["Centro de resultado", "Descrição"]],
      ["pecuaria.manejo", ["Observação"]],
      ["confinamento.batelada", []],
      ["estoque.producao_de_racao", []],
    ];
    for (const [f, exigencias] of esperadas) {
      expect(predicados(f), f).toEqual({ destinos: false, estoqueDoc: false, aprovacao: false, execucao: false, comDocumento: true });
      expect(perfil(f).abas, f).toEqual(["identificacao", "geral", "estoque", "financeiro", "fiscal"]);
      expect(rotulos(perfil(f)), f).toEqual(exigencias);
    }
  });

  it("CT-4 as 11 famílias sem documento têm o mesmo perfil (abas de hoje, exigências genéricas); as 4 do financeiro (F9) com Padrões financeiros", () => {
    const semDocumento = PERFIS_TIPO_TOP.filter((p) => !MATRIZ_REGRAS_GERAIS_TOP.some((m) => m.familia === p.familia));
    // As 7 antigas de estoque (a produção de ração saiu: é módulo desde a F10), a solicitação de compra e as 3 do financeiro.
    expect(semDocumento.map((p) => p.familia)).toEqual([
      "estoque.entrada_manual", "estoque.documento_fiscal", "estoque.requisicao", "estoque.baixa", "estoque.devolucao",
      "estoque.transferencia_entre_armazens", "estoque.transferencia_entre_empresas", "compras.solicitacao",
      "financeiro.conta_a_pagar", "financeiro.conta_a_receber", "financeiro.movimento_bancario",
    ]);
    expect(semDocumento).toHaveLength(11);
    const comPadroes = ["compras.solicitacao", "financeiro.conta_a_pagar", "financeiro.conta_a_receber", "financeiro.movimento_bancario"];
    for (const p of semDocumento) {
      const usa = comPadroes.includes(p.familia);
      expect(p.abas, p.familia).toEqual(["identificacao", "geral", "estoque", ...(usa ? ["financeiroPadrao"] : []), "financeiro", "fiscal"]);
      expect(p.exigencias, p.familia).toEqual(EXIGENCIAS_GERAIS_SEM_DOCUMENTO_TOP);
      expect(p.secoesNeutras, p.familia).toEqual(usa ? ["destino", "fluxo", "fluxoCompra", "divergenciaPedido"] : ["destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
    }
    // A premissa: as quatro estão mesmo entre as sem documento.
    expect(semDocumento.filter((p) => comPadroes.includes(p.familia))).toHaveLength(4);
  });

  it("CT-4 toda aba de perfil é conhecida (fixa ou seção de extensão do produto) e toda exigência é uma das quatro", () => {
    const conhecidas: readonly string[] = [...ABAS_FIXAS_EDITOR_TOP, ...SECOES_EXTENSAO_V5];
    for (const p of PERFIS_TIPO_TOP) {
      expect(p.abas.every((a) => conhecidas.includes(a)), p.familia).toBe(true);
      expect(p.exigencias.every((e) => (CHAVES_EXIGENCIA_TOP as readonly string[]).includes(e.chave)), p.familia).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// CT-4b — o perfil enxerga as seções de extensão (seção fictícia)
// ---------------------------------------------------------------------------------------------------

interface SecaoFicticia { ligada: boolean }
const SECAO_FICTICIA = definirSecaoV5({
  nome: "ficticia",
  rotulo: "Seção fictícia",
  ajuda: "Só existe neste teste.",
  chaves: ["ligada"],
  neutro(): SecaoFicticia { return { ligada: false }; },
  ler(l) { return { ligada: l.booleano("ligada") }; },
  normalizar(v): SecaoFicticia { return { ligada: v.ligada }; },
  usadaPor(familia) { return familia === VENDA; },
  linhas(v) { return [["Ligada", v.ligada ? "Sim" : "Não"]]; },
});
const DEFS: readonly DefinicaoSecaoV5[] = [SECAO_FICTICIA];

describe("CT-4b o perfil e a volta ao padrão enxergam as seções de extensão", () => {
  it("CT-4b a seção usada entra nas abas depois de Estoque; a não usada entra nas seções que ficam no padrão", () => {
    expect(perfilDoTipoTop(VENDA, DEFS).abas).toEqual(["identificacao", "geral", "destinos", "estoque", "ficticia", "financeiro", "fiscal", "aprovacao", "execucao"]);
    expect(perfilDoTipoTop(VENDA, DEFS).secoesNeutras).toEqual([]);
    expect(perfilDoTipoTop(ENTRADA, DEFS).abas).toEqual(["identificacao", "geral", "estoque", "aprovacao"]);
    expect(perfilDoTipoTop(ENTRADA, DEFS).secoesNeutras).toEqual(["estoque", "financeiro", "fiscal", "ficticia"]);
    // A premissa: sem a definição (a lista do produto), nada disso aparece.
    expect(perfilDoTipoTop(VENDA)).toEqual(perfil(VENDA));
  });

  it("CT-4b a seção que o tipo não usa volta ao padrão antes de gravar, com o rótulo da definição", () => {
    const lido = lerConfiguracaoTop({ ...clonar(configuracaoNeutraTopV5(DEFS)), ficticia: { ligada: true } }, DEFS);
    if (!lido.ok || lido.valor.versaoSchema !== 5) throw new Error("premissa: o 5 com a seção fictícia é lido");
    const r = normalizarPeloPerfilTop(perfilDoTipoTop(ENTRADA, DEFS), lido.valor, DEFS);
    expect(r.voltaram).toEqual([{ caminho: "ficticia", texto: "Seção fictícia: volta ao padrão" }]);
    expect((r.configuracao as unknown as Record<string, unknown>).ficticia).toEqual({ ligada: false });
    // Na venda (que usa a seção), nada volta.
    expect(normalizarPeloPerfilTop(perfilDoTipoTop(VENDA, DEFS), lido.valor, DEFS).voltaram).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CT-5 — a recusa do formato 5
// ---------------------------------------------------------------------------------------------------

describe("CT-5 o servidor recusa no 5 o que o tipo não aceita", () => {
  const recusa = (caminho: string, mensagem: string) => ({ motivo: "combinacao_nao_suportada", caminho, mensagem });

  it("CT-5 entrada no 5 com Financeiro \"A pagar\" → a seção Financeiro; o MESMO conteúdo no 4 → nada (o de hoje)", () => {
    const c = v5((x) => { x.financeiro.atualizacao = "pagar"; });
    expect(recusasDoPerfilTop(ENTRADA, c)).toEqual([recusa("financeiro", "Esta operação não usa a seção Financeiro.")]);
    expect(recusasDoPerfilTop(ENTRADA, comoV4(c))).toEqual([]);
  });

  it("CT-5 exigência que o documento não tem → geral.<chave>, com a mensagem exata", () => {
    expect(recusasDoPerfilTop(ENTRADA, v5((x) => { x.geral.exigeParceiro = true; })))
      .toEqual([recusa("geral.exigeParceiro", "O documento desta operação não tem este campo.")]);
    expect(MENSAGEM_EXIGENCIA_FORA_DO_TIPO).toBe("O documento desta operação não tem este campo.");
    // A premissa: a exigência que o documento de estoque TEM (a observação) é aceita.
    expect(recusasDoPerfilTop(ENTRADA, v5((x) => { x.geral.exigeObservacao = true; }))).toEqual([]);
  });

  it("CT-5 Fiscal ligado → fiscal; Estoque fora do padrão → estoque", () => {
    expect(recusasDoPerfilTop(ENTRADA, v5((x) => { x.fiscal.habilitado = true; })))
      .toEqual([recusa("fiscal", "Esta operação não usa a seção Fiscal.")]);
    expect(recusasDoPerfilTop(ENTRADA, v5((x) => { x.estoque.atualizacao = "entrada"; })))
      .toEqual([recusa("estoque", "Esta operação não usa a seção Estoque.")]);
  });

  it("CT-5 tudo junto → as recusas na ordem fixa: exigências e depois as seções", () => {
    const c = v5((x) => {
      x.geral.exigeTransportadora = true;
      x.geral.exigeParceiro = true;
      x.geral.exigeCentroResultado = true;
      x.estoque.atualizacao = "entrada";
      x.financeiro.atualizacao = "pagar";
      x.fiscal.habilitado = true;
    });
    expect(recusasDoPerfilTop(ENTRADA, c)).toEqual([
      recusa("geral.exigeParceiro", MENSAGEM_EXIGENCIA_FORA_DO_TIPO),
      recusa("geral.exigeCentroResultado", MENSAGEM_EXIGENCIA_FORA_DO_TIPO),
      recusa("geral.exigeTransportadora", MENSAGEM_EXIGENCIA_FORA_DO_TIPO),
      recusa("estoque", mensagemSecaoForaDoTipo("Estoque")),
      recusa("financeiro", mensagemSecaoForaDoTipo("Financeiro")),
      recusa("fiscal", mensagemSecaoForaDoTipo("Fiscal")),
    ]);
  });

  it("CT-5 o que a normalização zera não é recusa (Estoque em \"nenhuma\" com o resto pendurado)", () => {
    const c = v5((x) => { x.estoque.exigeArmazem = true; x.estoque.saldoNegativo = "permitir"; });
    expect(c.estoque.atualizacao, "a premissa: o estoque está desligado").toBe("nenhuma");
    expect(recusasDoPerfilTop(ENTRADA, c)).toEqual([]);
  });

  it("CT-5 venda no 5 com tudo ligado → nada (a venda usa todas as seções e exigências)", () => {
    const c = v5((x) => {
      x.geral.exigeParceiro = true;
      x.geral.exigeCentroResultado = true;
      x.geral.exigeObservacao = true;
      x.geral.exigeTransportadora = true;
      x.estoque.atualizacao = "saida";
      x.financeiro.atualizacao = "receber";
      x.fiscal.habilitado = true;
    });
    expect(recusasDoPerfilTop(VENDA, c)).toEqual([]);
  });

  it("CT-5 módulo (F10) no 5: a exigência que o registro do módulo não tem é recusada; a que ele tem passa", () => {
    // A premissa: as do perfil de cada um (o mapa do registro).
    expect(perfil("frota_ativos.manutencao").exigencias.map((e) => e.chave)).toEqual(["exigeObservacao"]);
    expect(recusasDoPerfilTop("frota_ativos.manutencao", v5((x) => { x.geral.exigeCentroResultado = true; })))
      .toEqual([recusa("geral.exigeCentroResultado", MENSAGEM_EXIGENCIA_FORA_DO_TIPO)]);
    expect(recusasDoPerfilTop("frota_ativos.manutencao", v5((x) => { x.geral.exigeObservacao = true; }))).toEqual([]);
    expect(recusasDoPerfilTop("frota_ativos.abastecimento", v5((x) => { x.geral.exigeCentroResultado = true; x.geral.exigeObservacao = true; }))).toEqual([]);
    expect(recusasDoPerfilTop("confinamento.batelada", v5((x) => { x.geral.exigeObservacao = true; x.geral.exigeParceiro = true; }))).toEqual([
      recusa("geral.exigeParceiro", MENSAGEM_EXIGENCIA_FORA_DO_TIPO),
      recusa("geral.exigeObservacao", MENSAGEM_EXIGENCIA_FORA_DO_TIPO),
    ]);
    // O mesmo conteúdo no 4: nada (a régua de hoje, valor por valor).
    expect(recusasDoPerfilTop("frota_ativos.manutencao", comoV4(v5((x) => { x.geral.exigeCentroResultado = true; })))).toEqual([]);
  });

  it("CT-5 família sem perfil, ou fora do 5 → nada", () => {
    const c = v5((x) => { x.financeiro.atualizacao = "pagar"; });
    expect(recusasDoPerfilTop("vendas.devolucao", c)).toEqual([]);
    expect(recusasDoPerfilTop(ENTRADA, configuracaoNeutraTopV4())).toEqual([]);
    // A premissa: a mesma família no 5 recusa.
    expect(recusasDoPerfilTop(ENTRADA, c)).toHaveLength(1);
  });

  it("CT-5 condições de pagamento: só no 5, só com alguma, só sem a aba Financeiro", () => {
    expect(recusaDasCondicoesDoPerfilTop(ENTRADA, v5(), 1)).toEqual({ caminho: "condicoesPermitidas", mensagem: "Esta operação não usa condições de pagamento." });
    expect(MENSAGEM_CONDICOES_FORA_DO_TIPO).toBe("Esta operação não usa condições de pagamento.");
    expect(recusaDasCondicoesDoPerfilTop(VENDA, v5(), 1)).toBeNull();
    expect(recusaDasCondicoesDoPerfilTop(ENTRADA, configuracaoNeutraTopV4(), 1)).toBeNull();
    expect(recusaDasCondicoesDoPerfilTop(ENTRADA, v5(), 0)).toBeNull();
    expect(recusaDasCondicoesDoPerfilTop("compras.compra", v5(), 3)).toBeNull();
  });

  it("CT-5 a recusa contra um catálogo DECLARADO (o publicado) usa o perfil dele", () => {
    const semFinanceiroNaVenda: CatalogoTop = {
      ...CATALOGO_TOP,
      perfis: CATALOGO_TOP.perfis.map((p) => (p.familia === VENDA ? { ...p, abas: p.abas.filter((a) => a !== "financeiro"), secoesNeutras: ["financeiro"] } : p)),
    };
    const c = v5((x) => { x.financeiro.atualizacao = "receber"; });
    expect(recusasDoPerfilTop(VENDA, c, semFinanceiroNaVenda)).toEqual([recusa("financeiro", mensagemSecaoForaDoTipo("Financeiro"))]);
    expect(recusaDasCondicoesDoPerfilTop(VENDA, c, 1, semFinanceiroNaVenda)).not.toBeNull();
  });

  it("CT-5 os rótulos das seções: os seis de hoje e os das seções de extensão (F5a, F6a e F9), um por seção comparada", () => {
    expect(ROTULOS_SECAO_CONFIGURACAO_TOP).toEqual({
      geral: "Geral", estoque: "Estoque", financeiro: "Financeiro", fiscal: "Fiscal", aprovacao: "Aprovação", execucao: "Execução",
      destino: "Destino", fluxo: "Fluxo", fluxoCompra: "Fluxo de compra", divergenciaPedido: "Divergência com o pedido",
      financeiroPadrao: "Padrões financeiros",
    });
    expect(Object.keys(ROTULOS_SECAO_CONFIGURACAO_TOP)).toEqual([...SECOES_CONFIGURACAO_TOP_V5]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CT-6 — a volta ao padrão antes de gravar
// ---------------------------------------------------------------------------------------------------

describe("CT-6 a volta ao padrão pelo perfil", () => {
  it("CT-6 a entrada no 5 suja sai sem recusa, e `voltaram` diz o quê, na ordem e com os textos exatos", () => {
    const sujo = congelar(v5((x) => {
      x.geral.exigeParceiro = true;
      x.geral.exigeObservacao = true;
      x.geral.exigeTransportadora = true;
      x.estoque.atualizacao = "entrada";
      x.financeiro.atualizacao = "pagar";
      x.fiscal.habilitado = true;
    }));
    expect(recusasDoPerfilTop(ENTRADA, sujo), "a premissa: o servidor recusaria").toHaveLength(5);
    const r = normalizarPeloPerfilTop(perfil(ENTRADA), sujo);
    expect(r.voltaram).toEqual([
      { caminho: "geral.exigeParceiro", texto: "Exigir parceiro: Sim → Não" },
      { caminho: "geral.exigeTransportadora", texto: "Exigir transportadora: Sim → Não" },
      { caminho: "estoque", texto: "Estoque: volta ao padrão" },
      { caminho: "financeiro", texto: "Financeiro: volta ao padrão" },
      { caminho: "fiscal", texto: "Fiscal: volta ao padrão" },
    ]);
    expect(recusasDoPerfilTop(ENTRADA, r.configuracao)).toEqual([]);
    expect(r.configuracao.versaoSchema).toBe(5);
    // O que o tipo aceita fica: a observação continua exigida.
    expect(r.configuracao.geral.exigeObservacao).toBe(true);
    expect(r.configuracao.estoque).toEqual(configuracaoNeutraTopV5().estoque);
    // A entrada não foi mutada (está congelada) e o resultado não aponta para ela.
    expect(sujo.geral.exigeParceiro).toBe(true);
    expect(r.configuracao.geral).not.toBe(sujo.geral);
  });

  it("CT-6 nada fora do perfil → nada volta, a configuração sai igual (normalizada)", () => {
    const limpo = v5((x) => { x.geral.exigeObservacao = true; x.aprovacao = { politica: "sempre", valorMinimo: null, momento: "antes_da_confirmacao" }; });
    const r = normalizarPeloPerfilTop(perfil(ENTRADA), limpo);
    expect(r.voltaram).toEqual([]);
    expect(r.configuracao).toEqual(limpo);
  });

  it("CT-6 as condições de pagamento permitidas: num tipo sem Financeiro, a lista lida volta à vazia (texto exato); com Financeiro, ou sem condição, nada volta", () => {
    // A premissa: o servidor recusaria no 5 a mesma lista nessa família, e não na venda.
    expect(recusaDasCondicoesDoPerfilTop(ENTRADA, v5(), 2), "premissa: a entrada no 5 recusa condições").not.toBeNull();
    expect(perfil(ENTRADA).abas, "premissa: a entrada não tem a aba Financeiro").not.toContain("financeiro");
    const volta = condicoesQueVoltamPeloPerfilTop(perfil(ENTRADA), 2);
    expect(volta).toEqual({ caminho: "condicoesPermitidas", texto: "Condições de pagamento: voltam ao padrão" });
    expect(TEXTO_CONDICOES_VOLTAM_TOP).toBe("Condições de pagamento: voltam ao padrão");
    expect(Object.isFrozen(volta)).toBe(true);
    // As outras três espécies do documento de estoque, idem (o mesmo perfil).
    for (const f of ["estoque.saida", "estoque.transferencia", "estoque.ajuste"]) {
      expect(condicoesQueVoltamPeloPerfilTop(perfil(f), 1), f).toEqual(volta);
    }
    // Sem condição nenhuma, nada volta (e o diálogo não ganha linha).
    expect(condicoesQueVoltamPeloPerfilTop(perfil(ENTRADA), 0)).toBeNull();
    // Com a aba Financeiro, nada volta: a lista é do tipo (e o servidor a aceita).
    expect(perfil(VENDA).abas, "premissa: a venda tem a aba Financeiro").toContain("financeiro");
    expect(recusaDasCondicoesDoPerfilTop(VENDA, v5(), 2), "premissa: a venda no 5 aceita condições").toBeNull();
    expect(condicoesQueVoltamPeloPerfilTop(perfil(VENDA), 2)).toBeNull();
    expect(condicoesQueVoltamPeloPerfilTop(perfil("compras.pedido"), 2)).toBeNull();
  });

  it("CT-6 os rótulos das exigências", () => {
    expect(ROTULO_EXIGENCIA_TOP).toEqual({
      exigeParceiro: "Exigir parceiro",
      exigeCentroResultado: "Exigir centro de resultado",
      exigeObservacao: "Exigir observação",
      exigeTransportadora: "Exigir transportadora",
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// CT-7 — o leitor estrito do catálogo publicado
// ---------------------------------------------------------------------------------------------------

type Saco = Record<string, unknown>;
const lista = (o: Saco, k: string): Saco[] => o[k] as Saco[];
const publicado = (): Saco => clonar(CATALOGO_TOP) as unknown as Saco;
const tipoDe = (c: Saco, chave: string): Saco => lista(c, "tipos").find((t) => t.chave === chave)!;
const perfilDe = (c: Saco, familia: string): Saco => lista(c, "perfis").find((p) => p.familia === familia)!;

describe("CT-7 lerCatalogoTop (estrito)", () => {
  it("CT-7 o catálogo publicado (JSON) é lido igual, em objetos novos", () => {
    const bruto = publicado();
    const lido = lerCatalogoTop(bruto);
    expect(lido).toEqual(CATALOGO_TOP);
    expect(lido?.tipos[0]).not.toBe(lista(bruto, "tipos")[0]);
    expect(lido?.perfis[0]?.abas).not.toBe(lista(bruto, "perfis")[0]?.abas);
  });

  const DESVIOS: ReadonlyArray<readonly [string, (c: Saco) => unknown]> = [
    ["raiz com chave a mais", (c) => ({ ...c, extra: 1 })],
    ["raiz sem perfis", (c) => ({ grupos: c.grupos, tipos: c.tipos })],
    ["raiz que é lista", (c) => [c]],
    ["raiz nula", () => null],
    ["grupos que não é lista", (c) => ({ ...c, grupos: {} })],
    ["grupo com chave a mais", (c) => { lista(c, "grupos")[0]!.cor = "azul"; return c; }],
    ["grupo fora do domínio", (c) => { lista(c, "grupos").push({ chave: "outros", rotulo: "Outros" }); return c; }],
    ["grupo repetido", (c) => { lista(c, "grupos").push({ chave: "vendas", rotulo: "Vendas de novo" }); return c; }],
    ["grupo com rótulo vazio", (c) => { lista(c, "grupos")[0]!.rotulo = "  "; return c; }],
    ["tipo com chave a mais", (c) => { tipoDe(c, "venda").icone = "x"; return c; }],
    ["tipo sem temTela", (c) => { delete tipoDe(c, "venda").temTela; return c; }],
    ["tipo com chave vazia", (c) => { tipoDe(c, "venda").chave = ""; return c; }],
    ["tipo com chave com ponto", (c) => { tipoDe(c, "venda").chave = "vendas.venda"; return c; }],
    ["tipo com chave repetida", (c) => { tipoDe(c, "venda").chave = "pedido_venda"; return c; }],
    ["tipo de grupo não declarado", (c) => ({ ...c, grupos: lista(c, "grupos").filter((g) => g.chave !== "modulos") })],
    ["tipo com rótulo vazio", (c) => { tipoDe(c, "venda").rotulo = ""; return c; }],
    ["tipo com família vazia", (c) => { tipoDe(c, "manejo").familia = ""; return c; }],
    ["tipo com família que não é texto", (c) => { tipoDe(c, "manejo").familia = 7; return c; }],
    ["tipo com família repetida", (c) => { tipoDe(c, "manejo").familia = "vendas.venda"; return c; }],
    ["tipo com temTela que não é booleano", (c) => { tipoDe(c, "venda").temTela = "sim"; return c; }],
    ["tipo com tela e sem família", (c) => { const t = tipoDe(c, "manejo"); t.familia = null; t.temTela = true; return c; }],
    ["tipo com tela e sem perfil", (c) => ({ ...c, perfis: lista(c, "perfis").filter((p) => p.familia !== "vendas.venda") })],
    ["perfil com chave a mais", (c) => { perfilDe(c, VENDA).cor = "azul"; return c; }],
    ["perfil com família repetida", (c) => { perfilDe(c, "estoque.baixa").familia = "estoque.requisicao"; return c; }],
    ["perfil com família vazia", (c) => { perfilDe(c, "estoque.baixa").familia = ""; return c; }],
    ["perfil com aba desconhecida", (c) => { perfilDe(c, VENDA).abas = ["identificacao", "secaoInexistente"]; return c; }],
    ["perfil com aba repetida", (c) => { perfilDe(c, VENDA).abas = ["identificacao", "geral", "geral"]; return c; }],
    ["perfil com abas que não é lista", (c) => { perfilDe(c, VENDA).abas = "identificacao"; return c; }],
    ["exigência com chave a mais", (c) => { lista(perfilDe(c, VENDA), "exigencias")[0]!.obrigatoria = true; return c; }],
    ["exigência fora das quatro", (c) => { lista(perfilDe(c, VENDA), "exigencias")[0]!.chave = "exigeArmazem"; return c; }],
    ["exigência repetida", (c) => { lista(perfilDe(c, VENDA), "exigencias")[1]!.chave = "exigeParceiro"; return c; }],
    ["exigência com rótulo vazio", (c) => { lista(perfilDe(c, VENDA), "exigencias")[0]!.rotulo = ""; return c; }],
    ["seção neutra desconhecida", (c) => { perfilDe(c, ENTRADA).secoesNeutras = ["geral"]; return c; }],
    ["seção neutra repetida", (c) => { perfilDe(c, ENTRADA).secoesNeutras = ["estoque", "estoque"]; return c; }],
  ];

  for (const [nome, desviar] of DESVIOS) {
    it(`CT-7 ${nome} → null`, () => {
      // A premissa: sem o desvio, a mesma cópia é lida.
      expect(lerCatalogoTop(publicado())).not.toBeNull();
      expect(lerCatalogoTop(desviar(publicado()))).toBeNull();
    });
  }
});
