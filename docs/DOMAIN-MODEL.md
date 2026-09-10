# Modelo de domínio

Notação: **Entidade** (tabela `erp.*`) — relacionamentos principais. Todas as entidades de tenant têm `organization_id`; as marcadas com 🏡 têm `farm_id`.

## Núcleo / tenant
- **Organization** ─ 1:N Farm 🏡, OrganizationMember (User × Role × MemberFarms), Role ─ 1:N RolePermission, AuditLog, Notification, UserFavorite, IdempotencyKey, FinancialFreeze.

## Cadastros
- **Product** → ProductGroup, ProductCategory, ProductKind, MeasurementUnit(×2), FinancialCategory (custo), Cultivation; `control_stock`, `has_lot`, `min_stock`, custo médio (calculado).
- **Person** (papéis: fornecedor/cliente/funcionário/proprietário/transportadora) → City; **EmployeeProfile** (função, salário, admissão) → JobFunction; **Contract**.
- **CostCenter** (árvore), **FinancialCategory** (árvore, natureza receita/despesa, sintética/analítica), **ChartAccount** (plano de contas), **ApportionmentCategory**.
- **BankAccount** (saldo inicial, livro caixa), **TitleType**, **PaymentMethod**.
- **Warehouse** 🏡 (tipo insumos/fábrica/produção), **Addressing**.
- **Equipment** 🏡 → EquipmentFamily; depreciação (vida útil, residual), horímetro; **PreventiveMaintenance**, **ScheduledReview**.
- Pecuária: **AnimalSpecies**, **AnimalCategory** (faixa etária, sexo, próxima categoria), **Breed**, **IdentificationType**, **GrazingModule** 🏡, **Area** 🏡, **Trough**, **Batch** 🏡 (lote; tipo pasto/confinamento; curral/módulo/área atuais), **WeightParameter**, **Fodder**.
- Confinamento: **FeedlotYard** 🏡 ─ **FeedlotSector** ─ **FeedlotCorral** (capacidade); **Diet** ─ DietItem (produto, %); **FeedingPhase**.
- Reprodução: **BreedingSeason**, **BreedingProtocol**, **BreedingSire** (touro/sêmen/embrião).
- RH: **HrEvent** (provento/desconto), **EmployeeEvent**, **Bonus**, **Absence**, **Team**.
- Outros: **Harvest**, **Operation**, **Activity**, **TaxRule**, **NatureOperation**, **AdditionalInfo**, **DocumentType**, **Document**, **Rainfall** 🏡, **LivestockPlanning**, **BudgetPlanning** ─ BudgetPlanningValue (categoria × mês), **Authorizer** (usuário, valor máximo, cotações mínimas, níveis), **SupplyStatusSla**, **ProviderLaunchProfile**, **Integration**.

## Estoque (ledger)
- **StockMovement** 🏡 (imutável: tipo, direção ±1, quantidade, custo unitário, custo total, saldo após, origem `source_type/source_id`, lote/validade) — trigger mantém **StockBalance** (armazém × produto × lote: quantidade, custo médio, valor).
- Documentos que postam no ledger: **OpeningBalance**, **InputEntry** (entrada/insumos + título opcional + movimento bancário opcional), **Invoice** (NF-e XML: itens, fornecedor, títulos, rateio), **StockWriteoff**, **Requisition** (saída por centro de custo), **Devolution**, **StockCorrection**, **StockTransfer** (armazém↔armazém; fazenda↔fazenda com dois lançamentos), **Formulation** ─ FormulationItem, **FeedBatch** (batida: consome insumos, produz ração), **DfeDocument** (fila DFe → rascunho → documento).
- Consumidores indiretos: manutenção (peças), abastecimento (combustível), manejo (nutrição/sanitário), batelada de dieta, OS (insumos/EPI), venda confirmada.

## Suprimentos
- **PurchaseRequest** 🏡 (tipo, prioridade, status ×11, `version`, responsável atual, totais estimado/aprovado, classificação, vínculo com Invoice) ─ **PurchaseRequestItem** ─ **PurchaseQuotation** (fornecedor, frete, prazo, selecionada) ─ PurchaseQuotationItem ─ **PurchaseApproval** (autorizador, nível, decisão) ─ **PurchaseRequestEvent** (histórico, tempo por etapa).

## Financeiro
- **FinancialTitle** 🏡 (direção pagar/receber, número, pessoa, emissão/vencimento, valor/desconto/líquido, `paid_amount/balance/status`, forma: única/parcelada/recorrente/adiantamento/fatura, grupo de parcelas, classificação CAPEX/OPEX, dedutível, tributo, origem) ─ **TitleApportionment** (categoria × centro de custo × conta contábil × safra × %) ─ **TitleAppropriation** ─ **TitleSettlement** (baixa: data, tipo banco/encontro/compensação, valor, desconto/juros/multa/acréscimo, líquido, movimento bancário; cancelável).
- **BankMovement** 🏡 (conta, tipo entrada/saída, categoria do movimento, valor, juros, documento, transferência interna com conta destino, conciliação OFX) ─ **BankMovementApportionment**. View `v_bank_account_balances`.
- **OfxImport** ─ **OfxTransaction** (pendente/conciliada/ignorada).

## Vendas
- **SalesDocument** 🏡 (`kind` orçamento→pedido→venda, `origin_document_id`, cliente, transportadora, frete/ICMS/outros/desconto, totais, plano de parcelas) ─ SalesDocumentItem (produto, armazém, preço, desconto). Confirmação: ledger de estoque + títulos a receber.

## Frota / Ativos
- **Maintenance** 🏡 ─ MaintenanceMachine (equipamento, horímetro/km, executor, serviço) ─ MaintenanceItem (peças do estoque).
- **FuelSupply** 🏡 (equipamento, combustível, litros, tanque, operador, horímetro).
- **Depreciation** (equipamento × mês, valor, acumulado); **EquipmentTransfer** (fazenda origem/destino).

## RH / Serviços
- **SalaryAdvance** (título a pagar vinculado), **Earning** (apuração mensal) ─ EarningLine (provento/desconto por funcionário) → títulos de folha.
- **ServiceOrder** 🏡 (atividade, operação, centro de custo, responsável, equipe, planejado/real, status aberta→execução→finalizada→avaliada, nota) ─ ServiceOrderLine (mão de obra, máquina, insumo, EPI, produção).

## Pecuária
- **Animal** 🏡 (espécie, categoria, raça, sexo, lote, datas, peso atual, valor, estágio/status reprodutivo, mãe/pai, status ativo/vendido/morto/…) ─ **AnimalIdentification** (tipo, valor, principal).
- **HerdLot** 🏡 (rebanho por contagem: lote × categoria × raça × sexo × quantidade).
- **AnimalMovement** 🏡 (compra/venda/nascimento/morte/perda/transferências/evolução; pessoa, NF, totais, título) ─ AnimalMovementItem (animal ou lote por contagem, peso, valor, nova categoria/lote).
- **Processing** (individualização de compras por contagem).
- **Weighing** ─ WeighingItem (peso anterior, GMD). **AnimalHandling** (nutrição/sanitário/desmama/apartação/pastagem; produto, dose, carência) ─ AnimalHandlingItem.
- **Mating** (estação, matriz, touro/sêmen, protocolo, tipo, resultado, parto previsto).
- Confinamento: **DietBatch** ─ DietBatchItem, **FeedDelivery** (trato), **TroughReading** (escore).
