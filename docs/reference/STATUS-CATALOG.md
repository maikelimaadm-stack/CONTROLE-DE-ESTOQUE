# Catálogo de Status e Listas de Domínio Observadas

Valores de listas (selects) com semântica de status/tipo, por tela. Servem de base para enums do nosso domínio.

| Tela | Campo | Label | Valores |
|---|---|---|---|
| `/admin/dfe` | `status` | Manifesto | Todos · Sem Manifestação · Ciência de operação · Confirmação · Desconhecimento · Operação não realizada |
| `/admin/expenses` | `type_note` | Tipo Nota | NF-e · CT-e · NFS-e · NFC-e · DANF-e · DARF · DARE · GRU |
| `/admin/expenses` | `status` | Status | Á vencer · Vencida · Baixa Parcial · Baixada · Adiantamento/Pendente · Adiantamento/Baixado · Fatura/Pendente · Fatura/Baixado |
| `/admin/expenses` | `type_id` | Tipo de Título | Ad. Cliente · Ad.Fornecedor · Ad.Funcionario · Boleto · Cartão de Crédito · Cheque · Contrato · Cupom Fiscal … (23) |
| `/admin/expenses` | `payment_type` | Tipo de Lançamento | Parcela Única · Parcelada · Recorrente · Adiantamento · Fatura |
| `/admin/expenses` | `writeoff_type` | Tipo Movimento | Movimento Bancário Separado · Único Movimento Bancário |
| `/admin/incomes` | `status` | Status | Á vencer · Vencida · Baixa Parcial · Baixada · Adiantamento/Pendente · Adiantamento/Baixado |
| `/admin/incomes` | `writeoff_type` | Tipo Movimento | Movimento Bancário Separado · Único Movimento Bancário |
| `/admin/movements` | `type_movement` | Tipo Mov. (E/S) | Ambas · Entrada · Saída |
| `/admin/movements` | `type_category` | Filtro Tipo Cat. | Entrada · Saída · Trans. Interna · Financiamento/Empréstimo |
| `/admin/nfses` | `type` | Tipo | Tomada · Prestada |
| `/admin/assets-dashboard` | `status` | Status | Todos · Ativo · Inativo |
| `/admin/providers` | `type` | Tipo | Fornecedor · Funcionário · Terceirizado · Transportador · Comissionado · Inseminador |
| `/admin/financialcategories` | `type` | Tipo Categoria | Saidas · Entradas · Ambas |
| `/admin/financialcategories` | `classification` | Classificação | Não Classificado · CAPEX · OPEX |
| `/admin/natureoperations` | `type` | Tipo | Ambos · Saída · Entrada |
| `/admin/equipments` | `equipment_type` | Tipo | Próprio · Terceirizado |
| `/admin/request-purchase` | `status` | Status | Solicitação · Cotação em Andamento · Aguardando Aprovação · Aguardando Ciência · Pedido Não Aprovado · Aguardando a Compra · Compra Efetuada · Compra Recebida … (11) |
| `/admin/request-purchase` | `type` | Tipo | Produto · Serviço · Adiantamento · Reembolso · Diária · Empreita · Compra Efetuada · Frete … (11) |
| `/admin/rejected-requests` | `type` | Tipo | Produto · Serviço · Adiantamento · Reembolso · Diária · Empreita · Compra Efetuada · Frete … (11) |
| `/admin/request-quotation` | `status` | Status | Solicitação · Cotação em Andamento |
| `/admin/request-quotation` | `type` | Tipo | Produto · Serviço · Adiantamento · Reembolso · Diária · Empreita · Compra Efetuada · Frete … (11) |
| `/admin/request-quotation` | `priority` | Prioridade | Baixa · Média · Alta |
| `/admin/request-authorization` | `status` | Status | Aguardando Aprovação · Aguardando Ciência · Analisar Processo |
| `/admin/request-authorization` | `type` | Tipo | Produto · Serviço · Adiantamento · Reembolso · Diária · Empreita · Compra Efetuada · Frete … (11) |
| `/admin/request-buy` | `status` | Status | Solicitação · Cotação em Andamento · Aguardando Aprovação · Aguardando Ciência · Pedido Não Aprovado · Aguardando a Compra · Compra Efetuada · Compra Recebida … (11) |
| `/admin/request-buy` | `type` | Tipo | Produto · Serviço · Adiantamento · Reembolso · Diária · Empreita · Compra Efetuada · Frete … (11) |
| `/admin/request-buy` | `priority` | Prioridade | Baixa · Média · Alta |
| `/admin/request-receipts` | `status` | Status | Solicitação · Cotação em Andamento · Aguardando Aprovação · Aguardando Ciência · Pedido Não Aprovado · Aguardando a Compra · Compra Efetuada · Compra Recebida … (11) |
| `/admin/request-receipts` | `type` | Tipo | Produto · Serviço · Adiantamento · Reembolso · Diária · Empreita · Compra Efetuada · Frete … (11) |
| `/admin/earnings` | `type` | Tipo | Folha Normal · Adiantamento 13º · 13º Salário |
| `/admin/document-managements` | `document_type_id` | Tipo de Documento | FICHA DE ENTREGA DE EPI - INTS · ASOS |
| `/admin/animals-management` | `status` | Status | Ativo · Pendente · Morto · Perdido · Vendido · Excluído |
| `/admin/animals-management` | `origin` | Origem | Nascidos · Comprados · Cadastrados |
| `/admin/animals-management` | `reproductive_status` | Situação Rerodutivo | Prenha · Vazia · Parida |
| `/admin/movement-sales` | `type_sale` | Tipo de Venda | Recria · Abate |
| `/admin/processing` | `status` | Status | Todas · Pendente · Finalizado |
| `/admin/advanced-reproductive` | `reproductive_status` | Status Reprodutivo | Prenha · Vazia · Parida |
| `/admin/feedlot-corrals` | `installation_type` | Tipo de Instalação | Coberto · Descoberto |
| `/admin/feedlot-corrals` | `status` | Situação | Vazio · Vazio Sanitário · Ocupado · Manutenção · Limpeza · Enfermaria · Interditado |
| `/admin/cash-flow` | `type` | Tipo | Sintético · Analítico |
| `/admin/xml` | `status` | Estado | Aprovado · Cancelado |
| `/admin/mdfe/create` | `type_emission` | Tipo Emissão | Normal · Contingência |
| `/admin/mdfe/create` | `payment_type` | Tipo Pagamento | Pago · A Pagar |
| `/admin/mdfe/create` | `payment_component_type` | Tipo Componente | Vale Pedágio · Impostos/Taxas · Despesas · Outros |
| `/admin/double-entry-accountings` | `origin` | Origem | Administrativo · Agricultura · Pecuária |
| `/admin/equipment-report` | `equipment_type` | Tipo | Todos · Próprio · Terceirizado |
| `/admin/equipment-report` | `status` | Status | Ativo · Inativo |
| `/admin/equipment-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/accumulated-depreciation-report` | `status` | Status | Ativo · Inativo |
| `/admin/herd-composition-report` | `status` | Status | Ativo · Pendente · Morto · Perdido · Vendido · Excluído |
| `/admin/herd-composition-report` | `type_report` | Tipo de Relatório | PDF · Excel |
| `/admin/weighing-batch-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/accumulated-weighing-batch-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/feedlot-weighing-performance-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/nutrition-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/sanitaries-batch-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/category-animal-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/animal-movements-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/weaning-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/birth-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/death-animals-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/pregnant-cows-report` | `insemination_type` | Tipo de Inseminação | Natural · IATF · FIV |
| `/admin/pregnant-cows-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/animals-sales/report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/animals-purchases/report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/evolution-animals-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/costing-batch-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/costing-grazing-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/costing-animal-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/total-cost-of-reproduction-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/batch-profitability-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/reproductive-history-report` | `reproductive_status` | Situação da Matriz | (lista dinâmica de cadastro — 4 registros; valores omitidos por privacidade) |
| `/admin/reproductive-history-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/bull-reproductive-efficiency-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/animal-movement-analysis-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/receiver-cow-productivity-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/animals-per-batch-report` | `view_type` | Visualização | Individual · Geral(Quantidade) |
| `/admin/animals-per-batch-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/animal-batch-history-report` | `status` | Status | Ativo · Pendente · Morto · Perdido · Vendido · Excluído |
| `/admin/animal-batch-history-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/feedlot-batch-control-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/feedlot-planned-consumption-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/feedlot-summary-activity-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/rainfall-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/receipt-schedule-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/expenses-report` | `classification` | Classificação | Todas · Não Classificado · CAPEX · OPEX |
| `/admin/expenses-report` | `type_report` | Tipo de Relatório | PDF · Excel |
| `/admin/paid-expenses-report` | `classification` | Classificação | Todas · Não Classificado · CAPEX · OPEX |
| `/admin/paid-expenses-report` | `type_report` | Tipo de Relatório | PDF · Excel |
| `/admin/incomes-report` | `type_report` | Tipo de Relatório | PDF · Excel |
| `/admin/paid-incomes-report` | `type_report` | Tipo de Relatório | PDF · Excel |
| `/admin/received-interest-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/paid-interest-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/bank-statement-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/ledger-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/ledger-category-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/rec-prev-real-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/pag-prev-real-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/budget-planning-predicted-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/cash-flow-by-category-report` | `classification` | Classificação | Todas · Não Classificado · CAPEX · OPEX |
| `/admin/cash-flow-by-category-report` | `report_type` | Tipo de Relatório | Analítico · Sintético |
| `/admin/cash-flow-by-category-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/cash-flow-forecast-report` | `classification` | Classificação | Todas · Não Classificado · CAPEX · OPEX |
| `/admin/cash-flow-forecast-report` | `report_type` | Tipo de Relatório | Analítico · Sintético |
| `/admin/cash-flow-forecast-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/financial-movement-report` | `types[]` | Tipos de Movimento | Entrada · Saída · Trans. Interna · Financiamento/Empréstimo · Devolução de Cheque · Saldo Inicial |
| `/admin/financial-movement-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/fiscal-difference-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/income-statement` | `type` | Tipo | Sintético · Analítico |
| `/admin/income-statement` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/accumulated-income-statement` | `type` | Tipo | Sintético · Analítico |
| `/admin/accumulated-income-statement` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/dre` | `type_report` | Tipo | Sintético · Analítico |
| `/admin/dre` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/dre-annual` | `type_report` | Tipo | Sintético · Analítico |
| `/admin/dre-annual` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/receipt-cashflow-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/cashflow-product-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/cost-center-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/cost-calculation-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/financings-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/advance-titles-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/account-reconciliation-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/cost-centers-unified-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/tax-accounts` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/accounts-payable-receivable-report` | `status[]` | Status | Em aberto (não baixado) · Baixado parcialmente · Baixado (quitado) · Adiantamento |
| `/admin/accounts-payable-receivable-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/provider-balance-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/stock-movement-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/requisitions-report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/dfe-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/stocks-abc-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/receipts-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/stocks-consolidated-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/stocks-lot-provider` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/products-exit-cost-center-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/supplies-report` | `status` | Status | Solicitação · Cotação em Andamento · Aguardando Aprovação · Aguardando Ciência · Pedido Não Aprovado · Aguardando a Compra · Compra Efetuada · Compra Recebida … (11) |
| `/admin/supplies-report` | `priority` | Prioridade | Baixa · Média · Alta |
| `/admin/supplies-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/savings-report` | `status` | Status | Solicitação · Cotação em Andamento · Aguardando Aprovação · Aguardando Ciência · Pedido Não Aprovado · Aguardando a Compra · Compra Efetuada · Compra Recebida … (11) |
| `/admin/savings-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/ans-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/request-quotation-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/request-purchase-forecast-report` | `status` | Status | Solicitação · Cotação em Andamento · Aguardando Aprovação · Aguardando Ciência · Pedido Não Aprovado · Aguardando a Compra · Compra Efetuada · Compra Recebida … (11) |
| `/admin/request-purchase-forecast-report` | `priority` | Prioridade | Baixa · Média · Alta |
| `/admin/request-purchase-forecast-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/supply-status-report` | `status` | Status | Solicitação · Cotação em Andamento · Aguardando Aprovação · Aguardando Ciência · Pedido Não Aprovado · Aguardando a Compra · Compra Efetuada · Compra Recebida … (11) |
| `/admin/request-purchase-management-report` | `type_request` | Tipo da Solicitação | Produto · Serviço · Adiantamento · Reembolso · Diária · Empreita · Compra Efetuada · Frete … (11) |
| `/admin/request-purchase-management-report` | `status` | Status | Solicitação · Cotação em Andamento · Aguardando Aprovação · Aguardando Ciência · Pedido Não Aprovado · Aguardando a Compra · Compra Efetuada · Compra Recebida … (11) |
| `/admin/request-purchase-management-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/sales-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/sales-product-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/sales-client-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/sales-employee-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/sales-abc-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/monthly-calculation` | `report_type` | Tipo Relatório | Sintetico · Analitico · Remessa Folha · Remessa cheque |
| `/admin/monthly-calculation` | `type` | Tipo | Folha Normal · Adiantamento 13º · 13º Salário |
| `/admin/active-employees` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/advances/report` | `report_type` | Tipo de Relatório | PDF · Excel |
| `/admin/double-entry-accounting-report` | `report_type` | Tipo de Relatório | Diário Contábil · Razão Contábil · Balanço de Verificação · Balanço Patrimonial (Simplificado) |
| `/admin/nfe-report` | `status` | Status | Novo · Aprovado · Cancelado · Rejeitado |
| `/admin/nfe-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/nfe-product-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/cash-book-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/equipment-machines-report` | `maintenance_type` | Tipo | Funcionário · Fornecedor |
| `/admin/equipment-machines-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/equipment-machines-supply-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/equipment-machines-maintenance-report` | `type` | Tipo de Relatório | PDF · Excel |
| `/admin/cta-smart-supplies` | `status` | Status | Todos · Pendente · Importado · Bem não localizado · Falha · Ignorado |
| `/admin/employees/create` | `account_type` | Tipo | Corrente · Poupança |
| `/admin/employees/create` | `pix_type` | Tipo chave Pix | CPF/CNPJ · Telefone · Email · Aleatória |
| `/admin/employees/2658/edit` | `account_type` | Tipo | Corrente · Poupança |
| `/admin/employees/2658/edit` | `pix_type` | Tipo chave Pix | CPF/CNPJ · Telefone · Email · Aleatória |
| `/admin/invoices/create` | `type` | Tipo Nota | NF-e · CT-e · NFS-e · NFC-e · DANF-e · DARF · DARE · GRU |
| `/admin/invoices/create` | `type_id` | Tipo de Título | Boleto · Duplicata · Cheque · Nota Fiscal - NFe · Recibo · Ad.Fornecedor · Ad.Funcionario · Cupom Fiscal … (23) |
| `/admin/invoices/create` | `classification` | Classificação | Não Classificado · CAPEX · OPEX |
| `/admin/invoices/create` | `apportionment_type` | Tipo Rateio | Por Valor · Por Produto |
| `/admin/invoices/create` | `appropriation_type[]` | Tipo Apropriação | Pecuária · Manutenção · Abastecimento |
| `/admin/invoices/create` | `equipment_equipment_type[]` | Tipo | Próprio · Terceirizado |
| `/admin/invoices/create` | `equipment_depreciation_type[]` | Tipo de Depreciação | C/Vl. Residual · S/Vl. Residual |
| `/admin/invoices/create` | `equipment_status[]` | Status | Ativo · Inativo |
| `/admin/invoices/create` | `factor_type` | Tipo | Multiplica · Divide |
| `/admin/foods/create` | `type` | Tipo | Porcentagem · Unidade |
| `/admin/expenses/create` | `type_id` | Tipo de Título | Boleto · Duplicata · Cheque · Nota Fiscal - NFe · Recibo · Ad.Fornecedor · Ad.Funcionario · Cupom Fiscal … (23) |
| `/admin/expenses/create` | `payment_type` | Tipo Lançamento | Parcela Única · Parcelada · Recorrente · Adiantamento · Fatura |
| `/admin/expenses/create` | `recurrence_type` | Recorrência | Semanal · Mensal · Trimestral · Anual |
| `/admin/expenses/create` | `classification` | Classificação | Não Classificado · CAPEX · OPEX |
| `/admin/expenses/create` | `type_note` | Tipo Nota | NF-e · CT-e · NFS-e · NFC-e · DANF-e · DARF · DARE · GRU |
| `/admin/expenses/create` | `appropriation_type` | Tipo Apropriação | Indireta · Pecuária · Área · Manutenção · Abastecimento |
| `/admin/expenses/create` | `type` | Tipo | Fornecedor · Funcionário · Terceirizado · Transportador · Comissionado · Inseminador |
| `/admin/expenses/152422/edit` | `type_id` | Tipo de Título | Boleto · Duplicata · Cheque · Nota Fiscal - NFe · Recibo · Ad.Fornecedor · Ad.Funcionario · Cupom Fiscal … (23) |
| `/admin/expenses/152422/edit` | `classification` | Classificação | Não Classificado · CAPEX · OPEX |
| `/admin/expenses/152422/edit` | `type_note` | Tipo Nota | NF-e · CT-e · NFS-e · NFC-e · DANF-e · DARF · DARE · GRU |
| `/admin/expenses/152422/edit` | `appropriation_type` | Tipo Apropriação | Indireta · Pecuária · Área · Manutenção · Abastecimento |
| `/admin/expenses/152422/edit` | `type` | Tipo | Fornecedor · Funcionário · Terceirizado · Transportador · Comissionado · Inseminador |
| `/admin/incomes/create` | `type_id` | Tipo de Título | Boleto · Duplicata · Cheque · Nota Fiscal - NFe · Recibo · Ad.Fornecedor · Ad.Funcionario · Cupom Fiscal … (23) |
| `/admin/incomes/create` | `payment_type` | Tipo de pagamento | Parcela Única · Parcelada · Adiantamento |
| `/admin/incomes/21909/edit` | `type_id` | Tipo de Título | Boleto · Duplicata · Cheque · Nota Fiscal - NFe · Recibo · Ad.Fornecedor · Ad.Funcionario · Cupom Fiscal … (23) |
| `/admin/movements/create` | `type` | Tipo | Entrada · Saída |
| `/admin/movements/create` | `type_category` | Tp. Categoria | Entrada · Saída · Trans. Interna · Financiamento/Empréstimo · Devolução de Cheque |
| `/admin/movements/280312/edit` | `type` | Tipo | Entrada · Saída |
| `/admin/movements/280312/edit` | `type_category` | Tp. Categoria | Entrada · Saída · Trans. Interna · Financiamento/Empréstimo · Devolução de Cheque |
| `/admin/nfe/create` | `type_emission` | Tipo Emissão | Emissão normal · Contingência SVC-AN · Contingência SVC-RS |
| `/admin/nfe/create` | `type_debt` | Tipo de Débito | 01 - Transferência de créditos para Cooperativas; · 02 - Anulação de Crédito por Saídas Imunes/Isentas; · 03 - Débitos de notas fiscais não processadas na apuração; · 04 - Multa e juros; · 05 - Transferência de crédito na sucessão; · 06 - Pagamento antecipado; · 07 - Perda em estoque; · 08 - Desenquadramento do SN; |
| `/admin/nfe/create` | `type_credit` | Tipo de Crédito | 01 - Multa e juros; · 02 - Apropriação de crédito presumido de IBS sobre o saldo devedor na ZFM (art. 450, § 1º, LC 214/25); · 03 - Retorno por recusa total na entrega ou por não localização do destinatário na tentativa de entrega; · 04 - Redução de valores; · 05 - Transferência de crédito na sucessão; |
| `/admin/nfe/create` | `modality_bc[]` | Modalidade da BC do ICMS | 0 - Margem Valor Agregado (%) · 1 - Pauta (Valor) · 2 - Preço Tabelado Máx. (valor) · 3 - Valor da operação |
| `/admin/nfe/create` | `type_payment` | Tipo de pagamento | Dinheiro · Cheque · Cartão de Crédito · Cartão de Débito · Crédito Loja · Vale Alimentação · Vale Refeição · Vale Presente … (15) |
| `/admin/nfe/create` | `type_guide` | Tipo de Guia | 1 - GTA - Guia de Trânsito Animal · 2 - TTA - Termo de Trânsito Animal · 3 - DTA - Documento de Transferência Animal · 4 - ATV - Autorização de Trânsito Vegetal · 5 - PTV - Permissão de Trânsito Vegetal · 6 - GTV - Guia de Trânsito Vegetal · 7 - Guia Florestal (DOF, SisFlora - PA e MT ou SIAM - MG) |
| `/admin/nfe/create` | `shipping_type` | Tipo | Emitente · Destinatário · Terceiros · Sem Frete |
| `/admin/nfe/create` | `kind_id` | Classe | Outros |
| `/admin/nfe/create` | `modality_bc` | Modalidade determinação da BC do ICMS | 0 - Margem Valor Agregado (%) · 1 - Pauta (Valor) · 2 - Preço Tabelado Máx. (valor) · 3 - Valor da operação |
| `/admin/costcenters/1317/edit` | `type` | Tipo | Produtivo · Rateado |
| `/admin/farms/create` | `exploration_type` | Tipo de Exploração do Imóvel: | Exploração individual (Imóvel próprio) · Condomínio · Imóvel arrendado · Parceria · Comodato · Outros |
| `/admin/farms/80/edit` | `exploration_type` | Tipo de Exploração do Imóvel: | Exploração individual (Imóvel próprio) · Condomínio · Imóvel arrendado · Parceria · Comodato · Outros |
| `/admin/products/create` | `factor_type` | Tipo | Multiplica · Divide |
| `/admin/products/create` | `modality_bc` | Modalidade determinação da BC do ICMS | 0 - Margem Valor Agregado (%) · 1 - Pauta (Valor) · 2 - Preço Tabelado Máx. (valor) · 3 - Valor da operação |
| `/admin/products/9036/edit` | `factor_type` | Tipo | Multiplica · Divide |
| `/admin/products/9036/edit` | `kind_id` | Classe | Peças_Máq/Implementos/Veículos · Peças/Equipamentos |
| `/admin/products/9036/edit` | `modality_bc` | Modalidade determinação da BC do ICMS | 0 - Margem Valor Agregado (%) · 1 - Pauta (Valor) · 2 - Preço Tabelado Máx. (valor) · 3 - Valor da operação |
| `/admin/warehouses/create` | `type` | Tipo | Insumos · Produção · Formulação |
| `/admin/warehouses/733/edit` | `type` | Tipo | Insumos · Produção · Formulação |
| `/admin/openingbalances/create` | `factor_type` | Tipo | Multiplica · Divide |
| `/admin/people/create` | `employee_account_type` | Tipo | Corrente · Poupança |
| `/admin/people/create` | `employee_pix_type` | Tipo chave Pix | CPF/CNPJ · Telefone · Email · Aleatória |
| `/admin/people/create` | `provider_type` | Tipo | Fornecedor · Funcionário · Terceirizado · Transportador · Comissionado · Inseminador |
| `/admin/people/create` | `provider_account_type` | Tipo | Corrente · Poupança |
| `/admin/people/create` | `provider_pix_type` | Tipo chave Pix | CPF/CNPJ · Telefone · Email · Aleatória |
| `/admin/people/28907/edit` | `employee_account_type` | Tipo | Corrente · Poupança |
| `/admin/people/28907/edit` | `employee_pix_type` | Tipo chave Pix | CPF/CNPJ · Telefone · Email · Aleatória |
| `/admin/people/28907/edit` | `provider_type` | Tipo | Fornecedor · Funcionário · Terceirizado · Transportador · Comissionado · Inseminador |
| `/admin/people/28907/edit` | `provider_account_type` | Tipo | Corrente · Poupança |
| `/admin/people/28907/edit` | `provider_pix_type` | Tipo chave Pix | CPF/CNPJ · Telefone · Email · Aleatória |
| `/admin/providers/create` | `type` | Tipo | Fornecedor · Funcionário · Terceirizado · Transportador · Comissionado · Inseminador |
| `/admin/providers/create` | `account_type` | Tipo | Corrente · Poupança |
| `/admin/providers/create` | `pix_type` | Tipo chave Pix | CPF/CNPJ · Telefone · Email · Aleatória |
| `/admin/providers/22911/edit` | `type` | Tipo | Fornecedor · Funcionário · Terceirizado · Transportador · Comissionado · Inseminador |
| `/admin/providers/22911/edit` | `account_type` | Tipo | Corrente · Poupança |
| `/admin/providers/22911/edit` | `pix_type` | Tipo chave Pix | CPF/CNPJ · Telefone · Email · Aleatória |
| `/admin/authorizers/create` | `rules[0][type]` | Tipo | Tipo de Chamado |
| `/admin/authorizers/433/edit` | `rules[0][type]` | Tipo | Tipo de Chamado |
| `/admin/accounts/create` | `type` | Tipo | Conta Corrente · Conta Poupança · Aplicação Financeira · Caixa Interno (Espécie) |
| `/admin/accounts/create` | `type_cnab` | Tipo do boleto | CNAB 240 · CNAB 400 |
| `/admin/accounts/524/edit` | `type` | Tipo | Conta Corrente · Conta Poupança · Aplicação Financeira · Caixa Interno (Espécie) |
| `/admin/accounts/524/edit` | `type_cnab` | Tipo do boleto | CNAB 240 · CNAB 400 |
| `/admin/open-movements/create` | `type` | Tipo | Entrada |
| `/admin/open-movements/create` | `type_category` | Tp. Categoria | Saldo Inicial |
| `/admin/financialcategories/9664/edit` | `type_id` | Tipo Categoria | Saidas · Entradas · Ambas |
| `/admin/financialcategories/9664/edit` | `classification` | Classificação | Não Classificado · CAPEX · OPEX |
| `/admin/tax-rules/create` | `modality_bc` | Modalidade da BC do ICMS | 0 - Margem Valor Agregado (%) · 1 - Pauta (Valor) · 2 - Preço Tabelado Máx. (valor) · 3 - Valor da operação |
| `/admin/natureoperations/create` | `modality_bc` | Modalidade da BC do ICMS | 0 - Margem Valor Agregado (%) · 1 - Pauta (Valor) · 2 - Preço Tabelado Máx. (valor) · 3 - Valor da operação |
| `/admin/natureoperations/10527/edit` | `modality_bc` | Modalidade da BC do ICMS | 0 - Margem Valor Agregado (%) · 1 - Pauta (Valor) · 2 - Preço Tabelado Máx. (valor) · 3 - Valor da operação |
| `/admin/plan-accounts/create` | `type` | Tipo | CAPEX (Capital Expenditure) · OPEX (Operational Expenditure) |
| `/admin/plan-accounts/19156/edit` | `type` | Tipo | CAPEX (Capital Expenditure) · OPEX (Operational Expenditure) |
| `/admin/activities/create` | `type` | Tipo | Custeio · Investimento · Á Definir |
| `/admin/activities/716/edit` | `type` | Tipo | Custeio · Investimento · Á Definir |
| `/admin/animals/create` | `type` | Tipo de Cadastro | Individual · Sem Identificação |
| `/admin/animals/create` | `reproductive_status` | Status Reprodutivo | Prenha · Vazia · Parida |
| `/admin/animals/create` | `depreciation_type` | Tipo de Depreciação | C/Vl. Residual · S/Vl. Residual |
| `/admin/animals/108942/edit` | `type` | Tipo de Cadastro | Individual · Sem Identificação |
| `/admin/animals/108942/edit` | `reproductive_status` | Status Reprodutivo | Prenha · Vazia · Parida |
| `/admin/animals/108942/edit` | `depreciation_type` | Tipo de Depreciação | C/Vl. Residual · S/Vl. Residual |
| `/admin/troughs/create` | `type` | Tipo | Coberto · Descoberto |
| `/admin/troughs/353/edit` | `type` | Tipo | Coberto · Descoberto |
| `/admin/equipments/create` | `equipment_type` | Tipo | Próprio · Terceirizado |
| `/admin/equipments/create` | `depreciation_type` | Tipo de Depreciação | C/Vl. Residual · S/Vl. Residual |
| `/admin/equipments/create` | `status` | Status | Ativo · Inativo |
| `/admin/equipments/create` | `type` | Tipo | CICLOMOTO · MOTONETA · MOTOCICLO · TRICICLO · AUTOMÓVEL · MICRO-ÔNIBUS · ÔNIBUS · REBOQUE … (20) |
| `/admin/equipments/create` | `body_type` | Tipo de Carroceria | NAO APLICAVEL · ABERTA · FECHADA/BAU · GRANELEIRA · PORTA CONTAINER |
| `/admin/equipments/create` | `wheel_type` | Tipo de Rodado | TRUCK · TOCO · CAVALO MECANICO · VAN · UTILITARIO · OUTROS |
| `/admin/equipments/create` | `owner_type` | Pessoa | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `/admin/request-purchase/create` | `priority` | Prioridade | Baixa · Média · Alta |
| `/admin/request-purchase/create` | `type` | Tipo | Produto · Serviço · Adiantamento · Reembolso · Diária · Empreita · Compra Efetuada · Frete … (11) |
| `/admin/request-purchase/create` | `factor_type` | Tipo | Multiplica · Divide |
| `/admin/input-entries/create` | `appropriation_type[]` | Tipo Apropriação | Pecuária · Manutenção · Abastecimento |
| `/admin/input-entries/create` | `factor_type` | Tipo | Multiplica · Divide |
| `/admin/provider-launch-profiles/create` | `default_type_id` | Tipo de título padrão | Ad. Cliente · Ad.Fornecedor · Ad.Funcionario · Boleto · Cartão de Crédito · Cheque · Contrato · Cupom Fiscal … (23) |
| `/admin/stock-writeoffs/create` | `type` | Motivo da Baixa | Perda · Deterioração · Roubo · Avaria · Inventário · Contabilização · Furto · Prazo de Validade … (13) |
| `/admin/requisitions/create` | `classification` | Classificação | Não Classificado · CAPEX · OPEX |
| `/admin/warehouse-transfer/create` | `type` | Tipo Movimentação | Transferência |
| `/admin/warehouse-transfer-between-farms/create` | `type` | Tipo Movimentação | Transferência |
| `/admin/food-beats/create` | `food_beat_type` | Tipo Batida | Formulação · Estoque |
| `/admin/events/create` | `type` | Tipo | Semanal · Quinzenal · Mensal · Trimestral · Semestral · Anual |
| `/admin/events/183/edit` | `type` | Tipo | Semanal · Quinzenal · Mensal · Trimestral · Semestral · Anual |
| `/admin/teams/create` | `provider_type[]` |  | Funcionário · Terceirizado |
| `/admin/advances/create` | `financial_type_id` | Tipo | Ad. Cliente · Ad.Fornecedor · Ad.Funcionario · Boleto · Cartão de Crédito · Cheque · Contrato · Cupom Fiscal … (23) |
| `/admin/document-managements/create` | `document_type_id` | Tipo de Documento | FICHA DE ENTREGA DE EPI - INTS · ASOS |
| `/admin/animals-management/create` | `type` | Tipo de Cadastro | Individual · Sem Identificação |
| `/admin/animals-management/create` | `reproductive_status` | Status Reprodutivo | Prenha · Vazia · Parida |
| `/admin/animals-management/create` | `depreciation_type` | Tipo de Depreciação | C/Vl. Residual · S/Vl. Residual |
| `/admin/animals-management/108942/edit` | `type` | Tipo de Cadastro | Individual · Sem Identificação |
| `/admin/animals-management/108942/edit` | `reproductive_status` | Status Reprodutivo | Prenha · Vazia · Parida |
| `/admin/animals-management/108942/edit` | `depreciation_type` | Tipo de Depreciação | C/Vl. Residual · S/Vl. Residual |
| `/admin/planning-livestock/create` | `status` | Status | Pendente · Liberado · Encerrado |
| `/admin/movement-sales/create` | `type_sale` | Tipo Venda | Recria · Abate |
| `/admin/movement-sales/create` | `pricing_type` | Tipo Precificação | Por Kg/Arroba · Por Cabeça |
| `/admin/movement-sales/create` | `type_payment` | Tipo de pagamento | Dinheiro · Cheque · Cartão de Crédito · Cartão de Débito · Crédito Loja · Vale Alimentação · Vale Refeição · Vale Presente … (15) |
| `/admin/movement-purchases/create` | `type_payment` | Tipo de pagamento | Dinheiro · Cheque · Cartão de Crédito · Cartão de Débito · Crédito Loja · Vale Alimentação · Vale Refeição · Vale Presente … (15) |
| `/admin/movement-purchases/create` | `financial_type_id` | Tipo | Ad. Cliente · Ad.Fornecedor · Ad.Funcionario · Boleto · Cartão de Crédito · Cheque · Contrato · Cupom Fiscal … (23) |
| `/admin/movement-purchases/create` | `classification` | Classificação | Não Classificado · CAPEX · OPEX |
| `/admin/movement-purchases/create` | `type` | Tipo | Fornecedor · Funcionário · Terceirizado · Transportador · Comissionado · Inseminador |
| `/admin/nutritions/create` | `func_type[]` | Tipo | Funcionário · Função · Fornecedor |
| `/admin/sanitaries/create` | `func_type[]` | Tipo | Funcionário · Função · Fornecedor |
| `/admin/weanings/create` | `type` | Tipo | Recria · Venda |
| `/admin/pastures/create` | `func_type[]` | Tipo | Funcionário · Função · Fornecedor |
| `/admin/pastures/create` | `occurrences[0][priority]` | Prioridade | Baixa · Média · Alta |
| `/admin/pastures/create` | `factor_type` | Tipo | Multiplica · Divide |
| `/admin/pastures/288/edit` | `func_type[]` | Tipo | Funcionário · Função · Fornecedor |
| `/admin/pastures/288/edit` | `occurrences[0][priority]` | Prioridade | Baixa · Média · Alta |
| `/admin/breeding-matings/create` | `type` | Tipo de Reprodução | Natural · IATF · FIV |
| `/admin/breeding-matings/create` | `launch_type` | Tipo de Lançamento | Normal · Simplificado |
| `/admin/feedlot-corrals/create` | `installation_type` | Tipo de Instalação | Coberto · Descoberto |
| `/admin/feedlot-corrals/create` | `status` | Situação | Vazio · Vazio Sanitário · Ocupado · Manutenção · Limpeza · Enfermaria · Interditado |
| `/admin/feedlot-corrals/create` | `type` | Tipo | Coberto · Descoberto |
| `/admin/diets/create` | `type` | Tipo | Unidade · Porcentagem |
| `/admin/budgets/create` | `factor_type` | Tipo | Multiplica · Divide |
| `/admin/orders/create` | `factor_type` | Tipo | Multiplica · Divide |
| `/admin/service-orders/create` | `func_type[]` | Tipo | Funcionário · Função · Fornecedor |
| `/admin/maintenances/create` | `machines[__INDEX__][maintenance_type][]` | Tipo | Funcionário · Fornecedor |
| `/admin/double-entry-accountings/create` | `origin` | Origem | Administrativo · Agricultura · Pecuária |
