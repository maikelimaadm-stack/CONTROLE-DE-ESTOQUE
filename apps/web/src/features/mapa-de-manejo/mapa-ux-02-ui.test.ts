import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORDEM_SELECAO, ROTULO_SELECAO } from "./consulta-satelite";

const mapaGeralSrc = readFileSync(resolve(__dirname, "mapa-geral.tsx"), "utf8");
const barraSrc = readFileSync(resolve(__dirname, "barra-camadas.tsx"), "utf8");
const legendaSrc = readFileSync(resolve(__dirname, "legenda-condicao.tsx"), "utf8");
const modalSrc = readFileSync(resolve(__dirname, "nova-consulta-modal.tsx"), "utf8");

describe("MAPA-UX-02 — UI estática (UX-01..UX-15) + enxuto Analisar áreas", () => {
  it("UX-01 botão principal Analisar áreas", () => {
    expect(barraSrc).toMatch(/Analisar áreas/);
    expect(barraSrc).toContain('data-testid="mapa-nova-consulta"');
    expect(barraSrc).not.toContain("Atualizar condição");
  });

  it("UX-02 não há botão local Analisar condição", () => {
    expect(legendaSrc).not.toContain("Analisar condição");
    expect(legendaSrc).not.toContain("condicao-pasto-analisar");
    expect(mapaGeralSrc).not.toContain("condicao-pasto-analisar");
  });

  it("UX-03 não há botão local Gerar mapa", () => {
    expect(legendaSrc).not.toContain("Gerar mapa");
    expect(legendaSrc).not.toContain("condicao-pasto-gerar-mapa");
    expect(mapaGeralSrc).not.toContain("onGerarMapa");
    expect(mapaGeralSrc).not.toContain("gerarMapaCondicao");
  });

  it("UX-04 modal de análise é Dialog central enxuto", () => {
    expect(modalSrc).toContain("<Dialog");
    expect(modalSrc).toContain('testId="consulta-modal"');
    expect(modalSrc).toContain("title={tituloModal}");
    expect(modalSrc).toContain('"Analisar áreas"');
    expect(modalSrc).toContain('data-testid="consulta-confirmar"');
  });

  it("UX-05 default Todas as áreas (empresa)", () => {
    expect(ORDEM_SELECAO[0]).toBe("empresa");
    expect(ROTULO_SELECAO.empresa).toBe("Todos os pastos");
    expect(modalSrc).toContain('p.selecaoInicial ?? "empresa"');
    expect(mapaGeralSrc).toContain('abrirAnalise("empresa")');
    expect(ORDEM_SELECAO).not.toContain("atual");
  });

  it("UX-06 escolha múltipla (Escolher áreas)", () => {
    expect(ORDEM_SELECAO).toContain("escolhidas");
    expect(modalSrc).toContain("consulta-escolhidas");
    expect(modalSrc).toContain("consulta-selecionar-todas");
    expect(modalSrc).toContain("consulta-limpar-escolhidas");
    expect(modalSrc).toContain("consulta-escolhidas-contador");
  });

  it("UX-07 Mais opções fechadas por padrão", () => {
    expect(modalSrc).toContain("Mais opções");
    expect(modalSrc).toContain('data-testid="consulta-opcoes-avancadas"');
    expect(modalSrc).toContain("setAvancadasAbertas(false)");
    expect(modalSrc).toContain("{avancadasAbertas &&");
  });

  it("UX-08 prévia automática amarrada + um clique confirma", () => {
    expect(modalSrc).toContain("consulta-previa-resultado");
    expect(modalSrc).toContain("previaAuto");
    expect(modalSrc).toContain("chaveDaPrevia");
    expect(modalSrc).toContain("previaCorrespondeAoPedido");
    expect(modalSrc).toContain("GestorTentativasPrevia");
    expect(modalSrc).toContain("deveAplicar");
    expect(modalSrc).toContain("snapshotPedidoRef");
    expect(modalSrc).toContain('data-testid="consulta-confirmar"');
    // deps do effect da prévia: só chave estável — não resolvido/periodoValidado por identidade
    expect(modalSrc).toMatch(/\}, \[p\.aberto, consultaId, chavePedidoAtual, motivoBloqueio\]\);/);
    expect(modalSrc).toContain("montarCorpoConsulta(resolvido.alvo, periodoValidado.periodo, true)");
    expect(modalSrc).not.toContain("setEtapa(2)");
  });

  it("UX-09 progresso após iniciar + Concluir análise em falha parcial", () => {
    expect(modalSrc).toContain("consulta-progresso");
    expect(modalSrc).toContain("Continuar em segundo plano");
    expect(modalSrc).toContain("emProgresso");
    expect(modalSrc).toContain("textoProgressoAnalises");
    expect(modalSrc).toContain("consulta-reprocessar-falhas");
    expect(modalSrc).toContain("reprocessar-falhas");
    expect(modalSrc).toContain("Concluir análise");
    expect(modalSrc).not.toMatch(/\$\{feitos\} de \{\w+\.total_itens\} áreas/);
  });

  it("UX-10 click área abre painel (não modal amontoado)", () => {
    expect(mapaGeralSrc).toContain("DialogAreaCondicao");
    expect(mapaGeralSrc).toContain('variante="painel"');
    expect(mapaGeralSrc).toContain("dialogAreaAberto");
    expect(legendaSrc).toContain("variante?: \"painel\" | \"dialog\"");
    expect(legendaSrc).toContain("Ver detalhamento");
  });

  it("UX-11 detalhe operacional em painel; técnico em Dialog", () => {
    expect(mapaGeralSrc).toContain("dialogTecnicoAberto");
    expect(mapaGeralSrc).toContain("!modoCondicao && selecionadaObj");
    expect(mapaGeralSrc).toContain('variante="painel"');
    expect(mapaGeralSrc).not.toContain("PainelClasseCondicao codigo={classeFiltro}");
  });

  it("UX-12 click classe abre popup central", () => {
    expect(mapaGeralSrc).toContain("DialogClasseCondicao");
    expect(mapaGeralSrc).toContain("dialogClasseAberto");
    expect(legendaSrc).toContain('testId="dialog-classe-condicao"');
    expect(legendaSrc).toContain("painel-classe-condicao");
  });

  it("UX-13 nunca dois popups (análise | área | classe)", () => {
    expect(mapaGeralSrc).toContain("!consulta.aberta && classeFiltro === null");
    expect(mapaGeralSrc).toContain("classeFiltro !== null && !consulta.aberta");
    expect(mapaGeralSrc).toContain("setClasseFiltro(null)");
    expect(mapaGeralSrc).toMatch(/function abrirAnalise[\s\S]*?setSelecionada\(null\)/);
    expect(mapaGeralSrc).toContain("if (c !== null) setSelecionada(null)");
  });

  it("UX-14 labels só hover/selecionada", () => {
    expect(mapaGeralSrc).toContain("hoverAreaId ?? selecionada");
    expect(mapaGeralSrc).toContain("rotulosDasAreas(m, areas.filter((a) => a.id === id), id)");
  });

  it("UX-15 lista compacta (nome, ha, badge) + busca", () => {
    expect(mapaGeralSrc).toContain('data-testid="mapa-item-badge"');
    expect(mapaGeralSrc).toContain("badge.rotulo");
    expect(mapaGeralSrc).toContain("rotuloStatusLista");
    expect(mapaGeralSrc).toContain("mapa-busca-lista");
    expect(mapaGeralSrc).not.toContain("% vegetação ativa");
    expect(mapaGeralSrc).not.toContain("% atenção");
  });

  it("toolbar: Só áreas + temas; técnico em Dados técnicos", () => {
    expect(barraSrc).toContain("Só áreas");
    expect(barraSrc).toContain("VISUALIZACOES_MAPA_PASTO");
    expect(barraSrc).toContain("mapa-dados-tecnicos");
    expect(barraSrc).toContain('modo === "tecnico"');
    expect(barraSrc).toContain("mapa-grupo-opacidade");
  });

  it("legenda compacta: Ver todas para água/sem leitura a 0%", () => {
    expect(legendaSrc).toContain("legenda-ver-todas");
    expect(legendaSrc).toContain("Ver todas");
    expect(legendaSrc).toContain("IDS_OCULTAVEIS");
  });
});
