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
 * CT-2 só os 9 tipos cujo documento cita a TOP têm tela; o passo 1 oferece só eles.
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

/** O gêmeo do 4 de um 5 (as mesmas chaves e valores; as seções de extensão vão junto e não contam: a recusa olha o número). */
const comoV4 = (c: ConfiguracaoTipoOperacaoV5) => ({ ...clonar(c), versaoSchema: 4 as const });

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
      ["orcamento_compra", "compras", "Orçamento", null],
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
      ["manejo", "modulos", "Manejo", null],
      ["batelada", "modulos", "Batelada", null],
      ["producao_racao", "modulos", "Produção de ração", "estoque.producao_de_racao"],
      ["conta_pagar", "financeiro", "Conta a pagar", "financeiro.conta_a_pagar"],
      ["conta_receber", "financeiro", "Conta a receber", "financeiro.conta_a_receber"],
      ["movimento_bancario", "financeiro", "Movimento bancário", null],
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
    // 9 com tela + 3 da movimentação interna (F5a, sem tela) + 6 dos módulos e do financeiro que já existem no registry
    // (sem tela); 4 tipos ainda sem família.
    expect(familias).toHaveLength(18);
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
  it("CT-2 as famílias com tela são EXATAMENTE as da matriz das regras gerais (o documento que cita a TOP), menos as três da movimentação interna (F5a: documento sem tela ainda)", () => {
    expect(MATRIZ_REGRAS_GERAIS_TOP, "a premissa: a matriz tem as 12 famílias com documento").toHaveLength(12);
    const semTelaAinda = ["estoque.requisicao_material", "estoque.consumo", "estoque.devolucao_consumo"];
    for (const f of semTelaAinda) expect(MATRIZ_REGRAS_GERAIS_TOP.some((m) => m.familia === f), `a premissa: ${f} tem documento`).toBe(true);
    const comTela = CATALOGO_TIPOS_MOVIMENTO_TOP.filter((t) => t.temTela).map((t) => t.familia);
    expect(new Set(comTela)).toEqual(new Set(MATRIZ_REGRAS_GERAIS_TOP.map((m) => m.familia).filter((f) => !semTelaAinda.includes(f))));
    expect(comTela).toHaveLength(9);
  });

  it("CT-2 os 13 sem tela: orçamento de compra, requisição, consumo, devolução de consumo, os 6 módulos e os 3 do financeiro", () => {
    expect(CATALOGO_TIPOS_MOVIMENTO_TOP.filter((t) => !t.temTela).map((t) => t.chave)).toEqual([
      "orcamento_compra", "requisicao", "consumo", "devolucao_consumo",
      "abastecimento", "manutencao", "ordem_servico", "manejo", "batelada", "producao_racao",
      "conta_pagar", "conta_receber", "movimento_bancario",
    ]);
  });

  it("CT-2 o passo 1: Vendas (3), Compras (2), Movimentação interna (4); Módulos e Financeiro não aparecem", () => {
    const passo1 = tiposParaEscolhaTop(CATALOGO_TOP);
    expect(passo1.map((g) => [g.grupo.chave, g.tipos.map((t) => t.chave)])).toEqual([
      ["vendas", ["orcamento_venda", "pedido_venda", "venda"]],
      ["compras", ["pedido_compra", "compra"]],
      ["movimentacao_interna", ["entrada", "saida", "transferencia", "ajuste"]],
    ]);
    // A premissa: os dois grupos que somem EXISTEM no catálogo, com tipos (todos sem tela).
    for (const g of ["modulos", "financeiro"] as const) {
      const tipos = CATALOGO_TOP.tipos.filter((t) => t.grupo === g);
      expect(tipos.length, g).toBeGreaterThan(0);
      expect(tipos.every((t) => !t.temTela), g).toBe(true);
    }
  });

  it("CT-2 ligar um tipo (o que a fase dona faz) o põe no passo 1, no grupo e na ordem dele", () => {
    const ligado: CatalogoTop = {
      ...CATALOGO_TOP,
      tipos: CATALOGO_TOP.tipos.map((t) => (t.chave === "abastecimento" ? { ...t, temTela: true } : t)),
    };
    expect(tiposParaEscolhaTop(ligado).map((g) => g.grupo.chave)).toEqual(["vendas", "compras", "movimentacao_interna", "modulos"]);
    expect(tiposParaEscolhaTop(ligado)[3]?.tipos.map((t) => t.chave)).toEqual(["abastecimento"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// CT-3 — cobertura do registry
// ---------------------------------------------------------------------------------------------------

describe("CT-3 um perfil por família do registry", () => {
  it("CT-3 26 perfis, na ordem do registry", () => {
    expect(CODIGOS_TIPO_OPERACAO, "a premissa: o registry tem 26 famílias").toHaveLength(26);
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
    expect(p.abas).toEqual(["identificacao", "geral", "destinos", "estoque", "financeiro", "fiscal", "aprovacao", "execucao"]);
    expect(rotulos(p)).toEqual(VENDAS);
    expect(p.secoesNeutras).toEqual(["destino", "fluxo"]);
  });

  it("CT-4 orçamento e pedido de venda: sem Aprovação e sem Execução (o servidor já obriga o padrão)", () => {
    for (const f of ["vendas.orcamento", "vendas.pedido"]) {
      expect(predicados(f), f).toEqual({ destinos: true, estoqueDoc: false, aprovacao: false, execucao: false, comDocumento: true });
      const p = perfil(f);
      expect(p.abas, f).toEqual(["identificacao", "geral", "destinos", "estoque", "financeiro", "fiscal"]);
      expect(rotulos(p), f).toEqual(VENDAS);
      expect(p.secoesNeutras, f).toEqual(["destino", "fluxo"]);
    }
  });

  it("CT-4 pedido de compra: com Próximas operações, sem Aprovação nem Execução; exigências do fornecedor", () => {
    const f = "compras.pedido";
    expect(predicados(f)).toEqual({ destinos: true, estoqueDoc: false, aprovacao: false, execucao: false, comDocumento: true });
    expect(perfil(f).abas).toEqual(["identificacao", "geral", "destinos", "estoque", "financeiro", "fiscal"]);
    expect(rotulos(perfil(f))).toEqual(COMPRAS);
  });

  it("CT-4 compra: sem Próximas operações; com Aprovação e Execução", () => {
    const f = "compras.compra";
    expect(predicados(f)).toEqual({ destinos: false, estoqueDoc: false, aprovacao: true, execucao: true, comDocumento: true });
    expect(perfil(f).abas).toEqual(["identificacao", "geral", "estoque", "financeiro", "fiscal", "aprovacao", "execucao"]);
    expect(rotulos(perfil(f))).toEqual(COMPRAS);
    expect(perfil(f).secoesNeutras).toEqual(["destino", "fluxo"]);
  });

  it("CT-4 as 4 espécies do documento de estoque: Identificação, Geral, Estoque (+ Destino na saída, F5a) e Aprovação; só Observação; Estoque, Financeiro e Fiscal no padrão", () => {
    for (const f of ["estoque.entrada", "estoque.saida", "estoque.transferencia", "estoque.ajuste"]) {
      expect(predicados(f), f).toEqual({ destinos: false, estoqueDoc: true, aprovacao: true, execucao: false, comDocumento: true });
      const p = perfil(f);
      const saida = f === "estoque.saida";
      expect(p.abas, f).toEqual(["identificacao", "geral", "estoque", ...(saida ? ["destino"] : []), "aprovacao"]);
      expect(rotulos(p), f).toEqual(["Observação"]);
      expect(p.secoesNeutras, f).toEqual(["estoque", "financeiro", "fiscal", ...(saida ? [] : ["destino"]), "fluxo"]);
    }
  });

  it("CT-4 família sem documento (abastecimento): Estoque, Financeiro e Fiscal como hoje; as quatro exigências genéricas", () => {
    const f = "frota_ativos.abastecimento";
    expect(predicados(f)).toEqual({ destinos: false, estoqueDoc: false, aprovacao: false, execucao: false, comDocumento: false });
    expect(perfil(f).abas).toEqual(["identificacao", "geral", "estoque", "financeiro", "fiscal"]);
    expect(perfil(f).exigencias).toEqual(EXIGENCIAS_GERAIS_SEM_DOCUMENTO_TOP);
    expect(rotulos(perfil(f))).toEqual(["Parceiro", "Centro de resultado", "Observação", "Transportadora"]);
    expect(perfil(f).secoesNeutras).toEqual(["destino", "fluxo"]);
  });

  it("CT-4 as 14 famílias sem documento têm o mesmo perfil (abas de hoje, exigências genéricas)", () => {
    const semDocumento = PERFIS_TIPO_TOP.filter((p) => !MATRIZ_REGRAS_GERAIS_TOP.some((m) => m.familia === p.familia));
    expect(semDocumento).toHaveLength(14);
    for (const p of semDocumento) {
      expect(p.abas, p.familia).toEqual(["identificacao", "geral", "estoque", "financeiro", "fiscal"]);
      expect(p.exigencias, p.familia).toEqual(EXIGENCIAS_GERAIS_SEM_DOCUMENTO_TOP);
    }
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

  it("CT-5 os rótulos das seções: os seis de hoje e os das seções de extensão (F5a), um por seção comparada", () => {
    expect(ROTULOS_SECAO_CONFIGURACAO_TOP).toEqual({ geral: "Geral", estoque: "Estoque", financeiro: "Financeiro", fiscal: "Fiscal", aprovacao: "Aprovação", execucao: "Execução", destino: "Destino", fluxo: "Fluxo" });
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
    ["tipo com tela e sem família", (c) => { tipoDe(c, "manejo").temTela = true; return c; }],
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
