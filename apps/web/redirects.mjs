/**
 * Compatibilidade de rotas antigas → áreas unificadas (ver docs/UX-ARCHITECTURE.md).
 * Usado por next.config.ts (redirecionamentos 307, parâmetros de consulta preservados) e pela auditoria de
 * paridade (scripts/parity.mjs) para documentar a equivalência. Rotas de detalhe/criação (`/x/[id]`, `/x/new`)
 * não mudaram e não estão aqui.
 */
const r = (source, destination, has) => ({ source, destination, permanent: false, ...(has ? { has } : {}) });
const q = (key, value) => [{ type: "query", key, value }];

export const LEGACY_REDIRECTS = [
  // Compras
  r("/suprimentos/:stage(mine|request|quotation|authorization|buy|receipts|rejected)", "/compras?tab=processos&sub=:stage"),
  r("/suprimentos/sla", "/configuracoes?tab=compras&sub=sla"),
  r("/dashboards/suprimentos", "/compras?tab=visao-geral"),
  // Estoque
  r("/estoque/documentos-fiscais", "/estoque?tab=entradas&sub=lancadas"),
  r("/estoque/entradas", "/estoque?tab=entradas&sub=manuais"),
  r("/estoque/dfe", "/estoque?tab=entradas&sub=dfe"),
  r("/estoque/aprovacao-notas", "/estoque?tab=entradas&sub=conferencia"),
  r("/estoque/requisicoes", "/estoque?tab=saidas&sub=requisicoes"),
  r("/estoque/baixas", "/estoque?tab=saidas&sub=diretas"),
  r("/estoque/devolucoes", "/estoque?tab=saidas&sub=devolucoes"),
  r("/estoque/correcoes", "/estoque?tab=movimentacoes&sub=correcoes"),
  r("/estoque/transferencias", "/estoque?tab=transferencias&sub=farm", q("kind", "farm")),
  r("/estoque/transferencias", "/estoque?tab=transferencias&sub=warehouse"),
  r("/estoque/saldo", "/estoque?tab=saldo"),
  r("/estoque/movimentos", "/estoque?tab=movimentacoes&sub=ledger"),
  r("/estoque/formulacoes", "/estoque?tab=fabrica&sub=formulas"),
  r("/estoque/batidas", "/estoque?tab=fabrica&sub=producoes"),
  r("/estoque/estoque-inicial", "/configuracoes?tab=implantacao&sub=estoque"),
  r("/dashboards/estoque-nutricao", "/confinamento?tab=visao-geral"),
  // Financeiro
  r("/financeiro/contas-a-pagar", "/financeiro?tab=contas&sub=pagar"),
  r("/financeiro/contas-a-receber", "/financeiro?tab=contas&sub=receber"),
  r("/financeiro/movimentos", "/financeiro?tab=tesouraria&sub=extrato"),
  r("/financeiro/fluxo", "/financeiro?tab=tesouraria&sub=fluxo"),
  r("/financeiro/ofx", "/financeiro?tab=conciliacao&sub=importar"),
  r("/financeiro/ofx/relatorio", "/financeiro?tab=conciliacao&sub=historico"),
  r("/financeiro/previsao-orcamentaria", "/financeiro?tab=planejamento"),
  r("/financeiro/saldo-inicial", "/configuracoes?tab=implantacao&sub=financeiro"),
  r("/dashboards/financeiro", "/financeiro?tab=visao-geral"),
  r("/dashboards/livro-caixa", "/fiscal?tab=livro-caixa"),
  // Vendas
  r("/vendas/:kind(budgets|orders|sales)", "/vendas?tab=:kind"),
  // Pecuária
  r("/pecuaria/animais", "/pecuaria?tab=rebanho&sub=animais"),
  r("/pecuaria/localizar", "/pecuaria?tab=rebanho&sub=animais"),
  r("/pecuaria/processamentos", "/pecuaria?tab=rebanho&sub=processamentos"),
  r("/pecuaria/movimentacoes/:type(sale|purchase|birth|death|loss)", "/pecuaria?tab=movimentacoes&sub=:type"),
  r("/pecuaria/manejo/:type(nutrition|sanitary|weaning|separation|pasture)", "/pecuaria?tab=manejos&sub=:type"),
  r("/pecuaria/pesagens", "/pecuaria?tab=manejos&sub=weighing"),
  r("/pecuaria/transferencias/evolucao", "/pecuaria?tab=manejos&sub=evolution"),
  r("/pecuaria/transferencias/animais-lote", "/pecuaria?tab=movimentar&sub=animais-lote"),
  r("/pecuaria/transferencias/agrupar-lotes", "/pecuaria?tab=movimentar&sub=agrupar"),
  r("/pecuaria/transferencias/lote-modulo-area", "/pecuaria?tab=movimentar&sub=lote-local"),
  r("/pecuaria/transferencias/lote-fazenda", "/pecuaria?tab=movimentar&sub=fazendas"),
  r("/pecuaria/reproducao/acasalamentos", "/pecuaria/reproducao?tab=acasalamentos"),
  r("/dashboards/pecuaria", "/pecuaria?tab=visao-geral"),
  // Confinamento
  r("/confinamento/bateladas", "/confinamento?tab=producao"),
  r("/confinamento/trato", "/confinamento?tab=trato"),
  r("/confinamento/leitura-cocho", "/confinamento?tab=cocho"),
  r("/confinamento/mapa", "/confinamento?tab=mapa"),
  r("/dashboards/confinamento", "/confinamento?tab=visao-geral"),
  r("/dashboards/confinamento-custos", "/confinamento?tab=desempenho&sub=custos"),
  r("/dashboards/confinamento-desempenho", "/confinamento?tab=desempenho&sub=ganho"),
  r("/dashboards/consumo-racao", "/confinamento?tab=desempenho&sub=consumo"),
  // Frota e Ativos
  r("/frota/manutencoes", "/frota?tab=manutencoes&sub=corretivas"),
  r("/frota/alertas", "/frota?tab=manutencoes&sub=alertas"),
  r("/frota/abastecimentos", "/frota?tab=abastecimentos"),
  r("/frota/transferencias", "/frota?tab=maquinas&sub=transferencias"),
  r("/frota/depreciacoes", "/frota?tab=depreciacao&sub=mensal"),
  r("/frota/previsao-depreciacao", "/frota?tab=depreciacao&sub=previsao"),
  r("/dashboards/ativos", "/frota?tab=visao-geral"),
  r("/dashboards/depreciacoes", "/frota?tab=depreciacao&sub=indicadores"),
  // Pessoas e RH
  r("/gestao-pessoal/adiantamentos", "/pessoas?tab=adiantamentos"),
  r("/gestao-pessoal/apuracao", "/pessoas?tab=apuracao"),
  // Ordens de serviço
  r("/os", "/os?tab=minhas", q("mine", "1")),
  r("/os/monitoramento", "/os?tab=atrasadas"),
  // Fiscal / relatórios
  r("/fiscal/partida-dobrada", "/fiscal?tab=partida-dobrada"),
  r("/relatorios/personalizados", "/relatorios?tab=personalizados"),
  // Configurações / administração
  r("/admin/usuarios", "/configuracoes?tab=usuarios&sub=usuarios"),
  r("/admin/perfis", "/configuracoes?tab=usuarios&sub=perfis"),
  r("/admin/auditoria", "/configuracoes?tab=auditoria"),
  r("/admin/parametros", "/configuracoes?tab=empresa&sub=parametros"),
  r("/integracoes/exportacoes", "/configuracoes?tab=integracoes&sub=exportacoes"),
  r("/dashboards/usuarios", "/configuracoes?tab=usuarios&sub=atividade"),
  r("/dashboards/pluviometria", "/configuracoes?tab=empresa&sub=pluviometria")
];
