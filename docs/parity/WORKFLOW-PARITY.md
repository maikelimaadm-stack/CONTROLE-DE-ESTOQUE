# Paridade de Fluxos

| Fluxo (referência) | Etapas referência | Nosso fluxo | Status | Evidência |
|---|---|---|---|---|
| Solicitação de compra | Solicitação → Ciência → Cotação → Autorização → Compra → Recebimento → Finalizado (+ Rejeitado/Cancelado/Analisar) | Idêntico (11 status), com `version` otimista, eventos com tempo por etapa, SLA, pedido por WhatsApp/e-mail | TESTADO | `packages/domain/test/rules.test.ts`, `apps/api/test/integration` (fluxo completo), `apps/web/e2e/suprimentos.spec.ts` |
| Entrada de estoque → saldo | Documento → estoque | Documento → ledger imutável → saldo/custo médio; cancelamento = estorno | TESTADO (MELHORADO) | integração (ledger, idempotência, concorrência), e2e estoque |
| Documento fiscal (XML) → estoque/financeiro | Importar XML → conferir → lançar | Igual; títulos e rateio na mesma transação | TESTADO | integração invoices |
| DFe → aprovação → documento | Buscar SEFAZ → manifestar → aprovar → lançar | Fila local → aprovação → documento (sem consulta SEFAZ) | EM IMPLEMENTAÇÃO | — |
| Título → baixa → cancelamento de baixa | Criar → baixar (parcial/total) → cancelar baixa | Igual; encontro de contas e compensação de adiantamento; baixa em lote | TESTADO | integração financeiro, e2e financeiro |
| Conciliação OFX | Importar → conciliar → mês conciliado | Igual | TESTADO (parser) / IMPLEMENTADO (UI) | unit ofx |
| Orçamento → pedido → venda → confirmação | Converter em cadeia | Igual + confirmação com estoque/receber | TESTADO | integração sales |
| Compra de animais → processamento → lote | Pré-lote → processamento | Herd lot → processamento (identificação) | TESTADO | integração livestock |
| Manejo (pesagem/sanitário/nutrição) | Seleção de animais/lote → registro | Igual (picker de animais ou lote por contagem) | TESTADO | integração weighings/handlings |
| Transferências de rebanho | 5 telas | 5 telas (Lote/Módulo/Área unificada) + processamento no destino | IMPLEMENTADO | — |
| Reprodução | Estação → cobertura → diagnóstico | Igual | IMPLEMENTADO | — |
| Confinamento | Batelada → trato → cocho → mapa | Igual | IMPLEMENTADO | — |
| Folha | Adiantamento → apuração → financeiro → fechamento | Igual | TESTADO | integração payroll |
| OS | Abrir → executar → finalizar → avaliar | Igual (avaliação no detalhe) | IMPLEMENTADO (MELHORADO) | — |
| Depreciação | Calcular mês → previsão | Igual, idempotente por mês/equipamento | TESTADO | integração |
| Emissão fiscal (NF-e/MDF-e/SPED/boleto) | Emitir/transmitir | — | NÃO INICIADO | GAP-ANALYSIS |
