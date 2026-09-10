# Regras de negócio do sistema de referência

Classificação: **OBSERVADO** (visto em tela/mensagem/campo), **INFERIDO** (deduzido do comportamento/estrutura), **RECOMENDADO** (boa prática adotada por nós), **NÃO CONFIRMADO** (não foi possível verificar sem executar ações de escrita, que eram proibidas).

| ID | Regra | Módulo | Classificação | Evidência / observação |
|---|---|---|---|---|
| RN-001 | Solicitação de compra passa por Solicitação → Ciência → Cotação → Autorização → Compra → Recebimento → Finalizado, com estados Rejeitado/Cancelado/Analisar | Suprimentos | OBSERVADO | Telas por etapa e catálogo de status (STATUS-CATALOG.md) |
| RN-002 | Cada status tem SLA em horas; solicitações fora do prazo são sinalizadas | Suprimentos | OBSERVADO | Tela "SLA Status" e relatório de SLA |
| RN-003 | Autorizador tem valor máximo, ativo/inativo, quantidade mínima de cotações, níveis e "ordenador de despesas" | Suprimentos | OBSERVADO | Formulário de autorizador |
| RN-004 | Justificativa obrigatória ao reprovar/cancelar | Suprimentos | INFERIDO | Campo "Justificativa" nas ações; validação não executada |
| RN-005 | Recebimento exige lançamento do documento fiscal ("Lançado") | Suprimentos | OBSERVADO | Coluna/ação "Lançar" em Recebimentos |
| RN-006 | Responsável do processo pode ser transferido (individual e em lote) | Suprimentos | OBSERVADO | Ações "Transferir Responsável (em Lote)" |
| RN-007 | Título financeiro exige rateio por categoria/centro de custo | Financeiro | OBSERVADO | Bloco de rateio no formulário |
| RN-008 | Rateio deve somar 100% | Financeiro | INFERIDO | Campo percentual; validação não executada |
| RN-009 | Parcelamento: nº parcelas, vencimento 1ª, intervalo/dia fixo, entrada | Financeiro | OBSERVADO | Modal "Parcelamento" |
| RN-010 | Status de título: Á vencer, Vencida, Baixa Parcial, Baixada, Adiantamento/Fatura Pendente/Baixado, Cancelada | Financeiro | OBSERVADO | Filtro de status |
| RN-011 | Baixa gera movimento bancário; baixa pode ser cancelada | Financeiro | OBSERVADO | Ações "Baixar"/"Cancelar baixa"; colunas de movimento |
| RN-012 | Baixa em lote com movimento único ou separado | Financeiro | OBSERVADO | Modal "Baixar Contas" |
| RN-013 | Congelamento financeiro impede lançamentos no período | Financeiro | OBSERVADO | Tela "Congelamento Financeiro" (escopo organização/fazenda: INFERIDO) |
| RN-014 | Transferência interna entre contas gera saída e entrada | Financeiro | INFERIDO | Categoria "Transferência" com conta destino |
| RN-015 | Saldo inicial de conta é lançamento único por conta | Financeiro | INFERIDO | Tela "Saldo Inicial - Contas" |
| RN-016 | Conciliação OFX: importar extrato e conciliar transações | Financeiro | OBSERVADO | Telas OFX e "Meses Conciliados" |
| RN-017 | Custo de estoque é médio ponderado por entradas | Estoque | INFERIDO | Coluna "Custo médio (calculado)" no produto; algoritmo NÃO CONFIRMADO |
| RN-018 | Produto que controla estoque exige categoria financeira de custo | Estoque | OBSERVADO | Ajuda do campo |
| RN-019 | Produto pode controlar lote/validade | Estoque | OBSERVADO | Campo "Controla Lote/Validade" |
| RN-020 | Estoque mínimo gera alerta | Estoque | OBSERVADO | Campo e notificação "Estoque mínimo atingido" |
| RN-021 | Saída sem saldo é bloqueada | Estoque | NÃO CONFIRMADO | Não foi possível testar; adotado como RECOMENDADO (INSUFFICIENT_STOCK) |
| RN-022 | Entrada/insumos pode gerar movimento bancário e títulos | Estoque | OBSERVADO | Campos "Gerar movimento bancário", "Conta" |
| RN-023 | NF-e importada por XML gera itens e títulos | Estoque | OBSERVADO | Tela Documento Fiscal / Arquivos XML |
| RN-024 | Transferência entre fazendas move saldo entre armazéns de fazendas distintas | Estoque | OBSERVADO | Tela própria |
| RN-025 | Formulação define % de ingredientes; batida consome e produz | Estoque › Fábrica | OBSERVADO | Telas Formulação/Batida |
| RN-026 | Orçamento → Pedido → Venda | Vendas | OBSERVADO | Três telas e ação de conversão (INFERIDO o encadeamento) |
| RN-027 | Venda gera contas a receber | Vendas | INFERIDO | Campos de parcelamento/forma de pagamento na venda |
| RN-028 | Venda baixa estoque | Vendas | NÃO CONFIRMADO | Adotado (RECOMENDADO) apenas para itens com armazém |
| RN-029 | Manutenção usa peças do estoque e serviço de terceiro/funcionário | Frota | OBSERVADO | Formulário de manutenção |
| RN-030 | Abastecimento por máquina com horímetro/km, origem manual/CTA Smart | Frota | OBSERVADO | Formulário e integração |
| RN-031 | Depreciação mensal linear com/sem residual, previsão futura | Ativos | OBSERVADO | Telas de depreciação e previsão; fórmula INFERIDA |
| RN-032 | Manutenção preventiva por horímetro/km/dias gera alertas | Frota | OBSERVADO | Cadastro e alertas |
| RN-033 | Adiantamento salarial vira desconto na apuração mensal | RH | INFERIDO | Tela "Apuração Mensal" e "Adiant. Salarial" |
| RN-034 | Apuração mensal = salário + eventos + bonificações − faltas | RH | INFERIDO | Cadastros de eventos/faltas/bonificações |
| RN-035 | OS: aberta → execução → finalizada → avaliada (nota) | Serviços | OBSERVADO | Telas de OS/monitoramento/avaliação |
| RN-036 | Animal tem identificações múltiplas (brinco, SISBOV, chip) e uma principal | Pecuária | OBSERVADO | Aba "Tipos de Identificação" |
| RN-037 | Compra de animais por contagem exige processamento para individualizar | Pecuária | OBSERVADO | Telas "Pré-Lotes" e "Processamentos" |
| RN-038 | Pesagem calcula GMD (kg/dia) desde a pesagem anterior | Pecuária | OBSERVADO | Colunas de GMD nos relatórios |
| RN-039 | Sanitário/nutrição baixa produto do estoque com dose por animal e carência | Pecuária | INFERIDO | Campos produto/dose/carência |
| RN-040 | Evolução de rebanho reclassifica categoria por idade | Pecuária | OBSERVADO | Tela "Evolução de Rebanho"; faixas etárias na categoria |
| RN-041 | Desmama/apartação mudam lote/categoria | Pecuária | INFERIDO | Campos "novo lote/categoria" |
| RN-042 | Transferência entre fazendas exige processamento no destino | Pecuária | INFERIDO | Tela de transferência/processamento |
| RN-043 | Reprodução: estação de monta, cobertura por matriz, diagnóstico, parto previsto | Pecuária | OBSERVADO | Telas de reprodução |
| RN-044 | Confinamento: pátio › setor › curral com capacidade; batelada de dieta; trato; leitura de cocho (escore) | Pecuária | OBSERVADO | Telas de confinamento e dashboards |
| RN-045 | Evolução de custo por lote/animal soma manejos, ração e custos retroativos | Pecuária | INFERIDO | Relatórios de custeio |
| RN-046 | Perfil de usuário = conjunto de permissões `recurso_ação` em árvore | Admin | OBSERVADO | 666 chaves (PERMISSIONS.md) |
| RN-047 | Usuário tem fazendas permitidas e chefes | Admin | OBSERVADO | Formulário de usuário |
| RN-048 | Notificações: compras pendentes, estoque mínimo, vencimentos, aniversários, documentos vencendo | Geral | OBSERVADO | Sino de notificações |
| RN-049 | Favoritos de menu por usuário | Geral | OBSERVADO | Estrela no cabeçalho |
| RN-050 | Limite de usuários/emissores por licença | Comercial | OBSERVADO | Mensagens "Você já atingiu o limite" — NÃO reproduzido (não é regra de domínio) |
