# Telas — Gestão Fiscal

Detalhamento tela a tela (sistema de referência). Legenda: **R** = obrigatório observado (atributo required/asterisco), tipo = tipo do controle HTML observado; "Opções" mostra amostra (até 8) das opções de listas.

## SCR-014 · NFe

- **Rota:** `/admin/nfe`
- **Módulo:** Gestão Fiscal > NFe > NFe Emitidas
- **Tipo:** Listagem
- **Finalidade:** NFe Emitidas (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/nfe/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `numero_nfe` | Nº NFe | text |  |
| `product` | Produto | select | BANANA BC PRATA CX 12KG, Bovinos - Fêmeas 13 a 24 meses |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |
| `issue` | Emissor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `estado` | Estado | select | Todos, Novo, Aprovado, Cancelado, Rejeitado |
| `amount` | Valor | text |  |
| `harvest_id` | Safra | select | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: (seleção) | # | Emissor | Cliente | Estado | Valor | Total de itens | Data | Nº NFe | Núm. série NFe | Ação

## SCR-015 · NFSe Recebidas

- **Rota:** `/admin/nfses`
- **Módulo:** Gestão Fiscal > NFSe Recebidas
- **Tipo:** Listagem
- **Finalidade:** NFSe Recebidas (listagem)
- **Botões/Ações (cabeçalho):** Buscar DFe → `/admin/nfses/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `issue_id` | Selecione o Emissor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `search` | Pesquisar por nome, CPF/CNPJ | text |  |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `launched` | Lançada | select | Lançada, Não Lançada |
| `type` | Tipo | select | Tomada, Prestada |
| `is_personal` | Pessoal | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 20 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: (seleção) | Prestador | CPF/CNPJ | Tipo | Número | Valor | Dt. Emissão | Competência | Lançada | Ação

## SCR-148 · Arquivos XML

- **Rota:** `/admin/xml`
- **Módulo:** Gestão Fiscal > NFe > Arquivos XML
- **Tipo:** Página
- **Finalidade:** Arquivos XML (página)
- **Botões/Ações (cabeçalho):** Saiba +

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `issue` | Selecione o Emissor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `document` | Documento | select | Todos, NF-e, MDF-e, DFe, NFSe |
| `launched` | Lançada | select | Todas, Lançada, Não Lançada |
| `status` | Estado | select | Aprovado, Cancelado |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

- Mensagens/alertas: Chave copiada!

## SCR-149 · MDFe

- **Rota:** `/admin/mdfe`
- **Módulo:** Gestão Fiscal > MDFe > Lista de MDFe
- **Tipo:** Listagem
- **Finalidade:** Lista de MDFe (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Consultar não encerrados → `/admin/mdfeNao_encerrados`; Adicionar Novo → `/admin/mdfe/create`
- **Modais:** Parcelamento

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `estado` | Estado | select | Todos, Adicionar Novo, Aprovado, Rejeitado, Cancelado |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `issue` | Emissor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |

**Filtros (GET)** — botões: Confirmar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `total_amount` | Valor Total | text |  |
| `has_input` | Possui Entrada ? | select | Sim, Não |
| `input_date` | Data entrada | date |  |
| `input_value` | Valor entrada | text |  |
| `qtd_installments` | Nª Parcelas | number |  |
| `first_installment` | Venc. 1ª. PC | date |  |
| `int_installments` | Int. Parcelas (dias) | number |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: (seleção) | # | Emissor | Data de início da viagem | CNPJ Contratante | Estado | Quantidade carga | Valor da Carga | Número | Ação

## SCR-150 · MDFe

- **Rota:** `/admin/mdfe/create`
- **Módulo:** Gestão Fiscal > MDFe > Nova MDFe
- **Tipo:** Cadastro (novo)
- **Finalidade:** Nova MDFe (cadastro (novo))
- **Abas:** INFORMAÇÕES GERAIS | INFORMAÇÕES DE TRANSPORTE | INFORMAÇÕES DE DESCARREGAMENTO
- **Botões/Ações (cabeçalho):** Voltar → `/admin/mdfe`

**Tabela**

- Colunas: # | Cidade | Ação

**Tabela**

- Colunas: UF | Ação

**Tabela**

- Colunas: Código | CPF/CNPJ | Ação

**Tabela**

- Colunas: CNPJ do Fornecedor | CPF/CNPJ do Pagador | Nº da Compra | Valor | Ação

**Tabela**

- Colunas: Nome Responsável | CPF/CNPJ | Tipo | Componente | Valor | Banco | Agência | PIX | Ação

**Tabela**

- Colunas: Nº Lacre | Ação

**Tabela**

- Colunas: Nº Lacre | Ação

**Tabela**

- Colunas: Tipo Transp. | ID Unid Transp. | Quantidade Rateio | NFe Referência | CTe Referência | Cid. Descarga | Lacres de Transp. | Lacres Unidade Carga | Ação

**Formulário POST `/admin/mdfe`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `type_emission` | Tipo Emissão | select | R |  | Normal, Contingência |  |
| `uf_inicio` | UF início | select | R |  | AC, AL, AM, AP, BA, CE, DF, ES … (27) |  |
| `uf_fim` | UF fim | select | R |  | AC, AL, AM, AP, BA, CE, DF, ES … (27) |  |
| `data_inicio_viagem` | Dt. Início | text (data) | R |  |  |  |
| `carga_posterior` | Carga posterior | select |  |  | Não, Sim |  |
| `tp_emit` | Tipo do emitente | select |  |  | 1 - Prestador de serviço de transporte, 2 - Transportador de Carga Própria |  |
| `tp_transp` | T. transportador | select |  |  | 1 - ETC, 2 - TAC, 3 - CTC |  |
| `lac_rodo` | Lacre Rodoviário | text |  |  |  |  |
| `cnpj_contratante` | CPF/CNPJ do contratante | text | R |  |  |  |
| `quantidade_carga` | Quantidade (Kg) | text | R |  |  |  |
| `valor_carga` | Valor da Carga | text (moeda) | R |  |  |  |
| `veiculo_tracao` | Veiculo de tração | select | R |  |  |  |
| `veiculo_reboque_id` | Veiculo de reboque 1 (opcional) | select |  |  |  |  |
| `veiculo_reboque2_id` | Veiculo de reboque 2 (opcional) | select |  |  |  |  |
| `veiculo_reboque3_id` | Veiculo de reboque 3 (opcional) | select |  |  |  |  |
| `produto_pred_nome` | Nome | text |  |  |  |  |
| `produto_pred_ncm` | Ncm | text |  |  |  |  |
| `produto_pred_cod_barras` | Código de barras | tel |  |  |  |  |
| `cep_carrega` | CEP Carrega | text |  |  |  |  |
| `latitude_carrega` | Lat Carrega | text |  |  |  |  |
| `longitude_carrega` | Lng Carrega | text |  |  |  |  |
| `cep_descarrega` | CEP Descarrega | text |  |  |  |  |
| `latitude_descarrega` | Lat Descarrega | text |  |  |  |  |
| `longitude_descarrega` | Lng Descarrega | text |  |  |  |  |
| `tp_carga` | Tipo de carga | select |  |  | Granel sólido, Granel líquido, Frigorificada, Conteinerizada, Carga Geral, Neogranel, Perigosa (granel sólido), Perigosa (granel líquido) … (11) |  |
| `seguradora_nome` | Nome | text |  |  |  |  |
| `seguradora_cnpj` | CNPJ da seguradora | text |  |  |  |  |
| `seguradora_numero_apolice` | Nº da Apólice | tel |  |  |  |  |
| `seguradora_numero_averbacao` | Nº da Averbação | tel |  |  |  |  |
| `municipio_carregamento` | Cidade | select |  |  | Alta Floresta D'oeste, Ariquemes, Cabixi, Cacoal, Cerejeiras, Colorado do Oeste, Corumbiara, Costa Marques … (5984) |  |
| `uf` | UF | select |  |  | AC, AL, AM, AP, BA, CE, DF, ES … (27) |  |
| `ciot_codigo` | Código | text |  |  |  |  |
| `ciot_cpf_cnpj` | CPF/CNPJ | text |  |  |  |  |
| `vale_cnpj_fornecedor` | CNPJ do Fornecedor | text |  |  |  |  |
| `vale_cpf_cnpj_pagador` | CPF/CNPJ do Pagador | text |  |  |  |  |
| `vale_numero_compra` | Nº da Compra | tel |  |  |  |  |
| `vale_valor` | Valor | tel (moeda) |  |  |  |  |
| `payment_responsible_name` | Nome Responsável | text |  |  |  |  |
| `payment_responsible_cpf_cnpj` | CPF/CNPJ | text |  |  |  |  |
| `payment_type` | Tipo Pagamento | select |  |  | Pago, A Pagar |  |
| `payment_component_type` | Tipo Componente | select |  |  | Vale Pedágio, Impostos/Taxas, Despesas, Outros |  |
| `payment_amount` | Valor | text (moeda) |  |  |  |  |
| `payment_bank_code` | Código Banco | select |  |  | 001 - Banco do Brasil S.A., 003 - Banco da Amazônia S.A., 004 - Banco do Nordeste do Brasil S.A., 007 - Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010 - CREDICOAMO Crédito Rural Cooperativa, 011 - Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012 - Banco Inbursa S.A., 014 - Natixis Brasil S.A. Banco Múltiplo … (168) |  |
| `payment_agency_code` | Código Agência | text |  | 10 |  |  |
| `payment_cnpj_ipef` | CNPJ Inst. Financeira | text |  |  |  |  |
| `payment_pix_key` | Chave PIX | text |  |  |  |  |
| `payment_additional_info` | Informações Adicionais | text |  |  |  |  |
| `condutor_nome` | Nome | text | R |  |  |  |
| `condutor_cpf` | CPF | text | R |  |  |  |
| `tp_unid_transp` | Tipo Unidade de Transporte | select |  |  | Rodoviário Tração, Rodoviário Reboque, Navio, Balsa, Aeronave, Vagão, Outros |  |
| `id_unid_transp` | ID Transporte (Placa) | text |  |  |  |  |
| `qtd_rateio_transp` | Qtd. de Rateio (Transporte) | text |  |  |  |  |
| `id_unid_carga` | ID Unidade da Carga | text |  |  |  |  |
| `qtd_rateio_unid_carga` | Qtd. de Rateio (Unidade Carga) | text |  |  |  |  |
| `chave_nfe` | NFe Referência | text |  |  |  |  |
| `seg_cod_nfe` | Segundo Código de Barra NFe (Contigência) | text |  |  |  |  |
| `chave_cte` | CTe Referência | text |  |  |  |  |
| `seg_cod_cte` | Segundo Código de Barra CTe (Contigência) | text |  |  |  |  |
| `lacre_transp` | Nº Lacre | text |  |  |  |  |
| `lacre_unidade` | Nº Lacre | text |  |  |  |  |
| `cidade_descarregamento` | Cidade de Descarregamento | select |  |  | Alta Floresta D'oeste, Ariquemes, Cabixi, Cacoal, Cerejeiras, Colorado do Oeste, Corumbiara, Costa Marques … (5984) |  |
| `info_complementar` | Informação complementar | text |  |  |  |  |
| `info_adicional_fisco` | Informação do fisco | text |  |  |  |  |

## SCR-151 · LCDPR - Livro Caixa Digital do Produtor Rural

- **Rota:** `/admin/cash-book`
- **Módulo:** Gestão Fiscal > LCDPR
- **Tipo:** Listagem
- **Finalidade:** LCDPR (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/cash-book/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Ano | Proprietário | Contador | Ação

## SCR-152 · SPED Fiscal - EFD ICMS/IPI

- **Rota:** `/admin/sped-fiscal`
- **Módulo:** Gestão Fiscal > SPED Fiscal
- **Tipo:** Listagem
- **Finalidade:** SPED Fiscal (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/sped-fiscal/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Emissor | Inscrição Estadual | Período | Status | Ação

## SCR-153 · Partida Dobrada

- **Rota:** `/admin/double-entry-accountings`
- **Módulo:** Gestão Fiscal > Partida Dobrada
- **Tipo:** Listagem
- **Finalidade:** Partida Dobrada (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/double-entry-accountings/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `code` | Código | text |  |
| `origin` | Origem | select | Administrativo, Agricultura, Pecuária |
| `description` | Descrição | text |  |
| `user_id` | Responsável | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Origem | Descrição | Valor Total | Responsável | Data | Ação

## SCR-288 · NFe

- **Rota:** `/admin/nfe/create`
- **Módulo:** Gestão Fiscal > NFe > NFe Emitidas
- **Tipo:** Cadastro (novo)
- **Finalidade:** NFe Emitidas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/ofx-imports/548/edit`; Dados Fiscais (modal #collapse-1)
- **Modais:** Novo Cliente; Novo Produto; Editar Produto; Editar Cliente

**Filtros (GET)** — botões: Salvar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `description` | Descrição | text |  |
| `ncm_id` | Ncm | select |  |
| `measurement_id` | 1ª. Un.Medida | select | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |
| `group_id` | Grupo | select | Insumos Gerais |
| `category_id` | Cat. Produtos | select | Diversos |
| `kind_id` | Classe | select | Outros |
| `is_fiscal` | Emitir NFe. | select | Não, Sim |
| `cfop_saida_interno` | CFOP Saída Interno | text |  |
| `cfop_saida_externo` | CFOP Saída Externo | text |  |
| `cst_csosn` | CST/CSOSN Padrão | select | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |
| `cst_pis` | CST/COFINS Padrão | select | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |
| `cst_cofins` | CST/PIS | select | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |
| `cst_ipi` | CST/IPI | select | 00 - Entrada com Recuperação de Crédito, 01 - Entrada Tributável com Alíquota Zero, 02 - Entrada Isenta, 03 - Entrada Não Tributada, 04 - Entrada Imune, 05 - Entrada com Suspensão, 49 - Outras Operações de Entrada, 50 - Saída Tributada … (14) |
| `cenq_ipi` | Código Enquadramento IPI | select | 001 - Imunidade - Livros, jornais, periódicos e o papel destinado à sua impressão - Art. 18 Inciso I do Decreto 7.212/2010, 002 - Imunidade - Produtos industrializados destinados ao exterior - Art. 18 Inciso II do Decreto 7.212/2010, 003 - Imunidade - Ouro, definido em lei como ativo financeiro ou instrumento cambial - Art. 18 Inciso III do Decreto 7.212/2010, 004 - Imunidade - Energia elétrica, derivados de petróleo, combustíveis e minerais do País - Art. 18 Inciso IV do Decreto 7.212/2010, 005 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - atividades de pesquisa ou lavra de jazidas de petróleo e de gás natural- Art. 19 Inciso I do Decreto 7.212/2010, 006 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - incorporados a produto final exportado para o Brasil - Art. 19 Inciso II do Decreto 7.212/2010, 007 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para órgão ou entidade de governo estrangeiro ou organismo internacional de que o Brasil seja membro,para ser entregue, no País, à ordem do comprador - Art. 19 Inciso III do Decreto 7.212/2010, 101 - Suspensão - Óleo de menta em bruto, produzido por lavradores - Art. 43 Inciso I do Decreto 7.212/2010 … (132) |
| `perc_icms` | %ICMS | text |  |
| `perc_pis` | %PIS | text |  |
| `perc_cofins` | %COFINS | text |  |
| `perc_ipi` | %IPI | text |  |
| `cest` | CEST | text |  |
| `barcode` | Código de barras | text |  |
| `modality_bc` | Modalidade determinação da BC do ICMS | select | 0 - Margem Valor Agregado (%), 1 - Pauta (Valor), 2 - Preço Tabelado Máx. (valor), 3 - Valor da operação |
| `percent_reduction` | Percentual da Redução de Base de Cálculo | text |  |
| `reference` | Cod. Produto | text |  |
| `origem` | Origem | select | 0 - NACIONAL, 1 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, 2 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, 3 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO SUPERIOR A 40%, 4 - NACIONAL, CUJA PRODUÇÃO TENHA SIDO FEITA EM CONFORMIDADE COM OS PROCESSOS PRODUTIVOS BÁSICOS DE QUE TRATAM O DECRETO-LEI Nº 288/67, E AS LEIS NºS 8.248/91, 8.387/91, 10.176/01 E 11 . 4 8 4 / 0 7, 5 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO INFERIOR OU IGUAL A 40%, 6 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX, 7 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX … (9) |
| `cst_csosn_exp` | CST/CSOSN Exportação | select | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |

**Filtros (GET)** — botões: Salvar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `description` | Descrição | text |  |
| `ncm_id` | Ncm | select |  |
| `measurement_id` | 1ª. Un.Medida | select | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |
| `group_id` | Grupo | select | Insumos Gerais |
| `category_id` | Cat. Produtos | select | Diversos |
| `kind_id` | Classe | select | Outros |
| `is_fiscal` | Emitir NFe. | select | Não, Sim |
| `tax_rule_id` | Regra Fiscal | select |  |
| `cfop_saida_interno` | CFOP Saída Interno | text |  |
| `cfop_saida_externo` | CFOP Saída Externo | text |  |
| `cst_csosn` | CST/CSOSN Padrão | select | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |
| `cst_pis` | CST/COFINS Padrão | select | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |
| `cst_cofins` | CST/PIS | select | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |
| `cst_ipi` | CST/IPI | select | 00 - Entrada com Recuperação de Crédito, 01 - Entrada Tributável com Alíquota Zero, 02 - Entrada Isenta, 03 - Entrada Não Tributada, 04 - Entrada Imune, 05 - Entrada com Suspensão, 49 - Outras Operações de Entrada, 50 - Saída Tributada … (14) |
| `cenq_ipi` | Código Enquadramento IPI | select | 001 - Imunidade - Livros, jornais, periódicos e o papel destinado à sua impressão - Art. 18 Inciso I do Decreto 7.212/2010, 002 - Imunidade - Produtos industrializados destinados ao exterior - Art. 18 Inciso II do Decreto 7.212/2010, 003 - Imunidade - Ouro, definido em lei como ativo financeiro ou instrumento cambial - Art. 18 Inciso III do Decreto 7.212/2010, 004 - Imunidade - Energia elétrica, derivados de petróleo, combustíveis e minerais do País - Art. 18 Inciso IV do Decreto 7.212/2010, 005 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - atividades de pesquisa ou lavra de jazidas de petróleo e de gás natural- Art. 19 Inciso I do Decreto 7.212/2010, 006 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - incorporados a produto final exportado para o Brasil - Art. 19 Inciso II do Decreto 7.212/2010, 007 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para órgão ou entidade de governo estrangeiro ou organismo internacional de que o Brasil seja membro,para ser entregue, no País, à ordem do comprador - Art. 19 Inciso III do Decreto 7.212/2010, 101 - Suspensão - Óleo de menta em bruto, produzido por lavradores - Art. 43 Inciso I do Decreto 7.212/2010 … (132) |
| `perc_icms` | %ICMS | text |  |
| `perc_pis` | %PIS | text |  |
| `perc_cofins` | %COFINS | text |  |
| `perc_ipi` | %IPI | text |  |
| `cest` | CEST | text |  |
| `barcode` | Código de barras | text |  |
| `modality_bc` | Modalidade determinação da BC do ICMS | select | 0 - Margem Valor Agregado (%), 1 - Pauta (Valor), 2 - Preço Tabelado Máx. (valor), 3 - Valor da operação |
| `percent_reduction` | Percentual da Redução de Base de Cálculo | text |  |
| `reference` | Cod. Produto | text |  |
| `origem` | Origem | select | 0 - NACIONAL, 1 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, 2 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, 3 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO SUPERIOR A 40%, 4 - NACIONAL, CUJA PRODUÇÃO TENHA SIDO FEITA EM CONFORMIDADE COM OS PROCESSOS PRODUTIVOS BÁSICOS DE QUE TRATAM O DECRETO-LEI Nº 288/67, E AS LEIS NºS 8.248/91, 8.387/91, 10.176/01 E 11 . 4 8 4 / 0 7, 5 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO INFERIOR OU IGUAL A 40%, 6 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX, 7 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX … (9) |
| `cst_csosn_exp` | CST/CSOSN Exportação | select | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |
| `cbenef` | Cód. Benefício Fiscal | text |  |

**Tabela**

- Colunas: Parcela | Vencimento | Valor
- Totalizador: Total

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | (%) | Valor
- Totalizador: Total 0 0

**Formulário POST `/admin/nfe`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `client_id` | Cliente | select | R |  | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |  |
| `state_registration_client` | Insc. Estadual | select | R |  |  |  |
| `tipo` | Operação | select | R |  | Saída, Entrada |  |
| `natureza_id` | Natureza de Operação | select | R |  |  |  |
| `type_emission` | Tipo Emissão | select | R |  | Emissão normal, Contingência SVC-AN, Contingência SVC-RS |  |
| `finNFe` | Finalidade | select | R |  | 1 - NF-e normal, 2 - NF-e complementar, 3 - NF-e de ajuste, 4 - Devolução/Retorno, 5 - Nota de crédito, 6 - Nota de débito |  |
| `departure_date` | Dt. Entrada/Saída | text (data) |  |  |  |  |
| `delivery_date` | Dt. Previsão Entrega | text (data) |  |  |  |  |
| `has_financial` | Gerar financeiro? | select | R |  | Sim, Não |  |
| `ref_nfe` | NFe Referência (Chave) | text |  | 44 |  |  |
| `order_number` | Número do Pedido | text |  | 20 |  |  |
| `type_debt` | Tipo de Débito | select |  |  | 01 - Transferência de créditos para Cooperativas;, 02 - Anulação de Crédito por Saídas Imunes/Isentas;, 03 - Débitos de notas fiscais não processadas na apuração;, 04 - Multa e juros;, 05 - Transferência de crédito na sucessão;, 06 - Pagamento antecipado;, 07 - Perda em estoque;, 08 - Desenquadramento do SN; |  |
| `type_credit` | Tipo de Crédito | select |  |  | 01 - Multa e juros;, 02 - Apropriação de crédito presumido de IBS sobre o saldo devedor na ZFM (art. 450, § 1º, LC 214/25);, 03 - Retorno por recusa total na entrega ou por não localização do destinatário na tentativa de entrega;, 04 - Redução de valores;, 05 - Transferência de crédito na sucessão; |  |
| `harvest_id` | Safra | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `product_id[]` | Produtos | select | R |  | 00102 - BANANA BC PRATA CX 12KG, 00100 - BANANA BC PRATA CX 15KG, 00057 - BANANA BC PRATA CX 18KG, 00058 - BANANA BC PRATA CX 20KG, 01267 - BANANA MAÇÃ CX 15KG, 01142 - BANANA NANICA 2ª 15KG, 00098 - BANANA NANICA CX 12KG, 00104 - BANANA NANICA CX 15KG … (25) |  |
| `order_item[]` | Item de Pedido | text |  | 20 |  |  |
| `package_id[]` | Embalagem | select |  |  |  |  |
| `um[]` | Un. Medida | text | R |  |  |  |
| `warehouse_id[]` | Armazém | select |  |  | Sem Estoque |  |
| `quantity[]` | Qtde | text (moeda) | R |  |  |  |
| `amount[]` | Vl.Unit | text (moeda) | R |  |  |  |
| `total_amount[]` | V. Total(R$) | text (moeda) | R |  |  |  |
| `discounts[]` | Desconto | text (moeda) | R |  |  |  |
| `cfop_saida_interno[]` | CFOP Saída Interno | text | R |  |  |  |
| `cfop_saida_externo[]` | CFOP Saída Externo | text | R |  |  |  |
| `cst_csosn[]` | CST/CSOSN Padrão | select | R |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `cst_pis[]` | CST/COFINS Padrão | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_cofins[]` | CST/PIS | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_ipi[]` | CST/IPI | select | R |  | 00 - Entrada com Recuperação de Crédito, 01 - Entrada Tributável com Alíquota Zero, 02 - Entrada Isenta, 03 - Entrada Não Tributada, 04 - Entrada Imune, 05 - Entrada com Suspensão, 49 - Outras Operações de Entrada, 50 - Saída Tributada … (14) |  |
| `cenq_ipi[]` | Código Enquadramento IPI | select | R |  | 001 - Imunidade - Livros, jornais, periódicos e o papel destinado à sua impressão - Art. 18 Inciso I do Decreto 7.212/2010, 002 - Imunidade - Produtos industrializados destinados ao exterior - Art. 18 Inciso II do Decreto 7.212/2010, 003 - Imunidade - Ouro, definido em lei como ativo financeiro ou instrumento cambial - Art. 18 Inciso III do Decreto 7.212/2010, 004 - Imunidade - Energia elétrica, derivados de petróleo, combustíveis e minerais do País - Art. 18 Inciso IV do Decreto 7.212/2010, 005 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - atividades de pesquisa ou lavra de jazidas de petróleo e de gás natural- Art. 19 Inciso I do Decreto 7.212/2010, 006 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - incorporados a produto final exportado para o Brasil - Art. 19 Inciso II do Decreto 7.212/2010, 007 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para órgão ou entidade de governo estrangeiro ou organismo internacional de que o Brasil seja membro,para ser entregue, no País, à ordem do comprador - Art. 19 Inciso III do Decreto 7.212/2010, 101 - Suspensão - Óleo de menta em bruto, produzido por lavradores - Art. 43 Inciso I do Decreto 7.212/2010 … (132) |  |
| `perc_icms[]` | %ICMS | text | R |  |  |  |
| `perc_pis[]` | %PIS | text | R |  |  |  |
| `perc_cofins[]` | %COFINS | text | R |  |  |  |
| `perc_ipi[]` | %IPI | text | R |  |  |  |
| `ipi_compoe_bc_icms[]` | IPI compõe a BC do ICMS | select |  |  | Não (mercadoria para revenda/industrialização), Sim (mercadoria para uso/consumo ou ativo imobilizado) |  |
| `cest[]` | CEST | text |  | 10 |  |  |
| `barcode[]` | Código de barras | text |  | 13 |  |  |
| `percent_reduction[]` | Perc. Redução de BC | text | R |  |  |  |
| `modality_bc[]` | Modalidade da BC do ICMS | select | R |  | 0 - Margem Valor Agregado (%), 1 - Pauta (Valor), 2 - Preço Tabelado Máx. (valor), 3 - Valor da operação |  |
| `origem[]` | Origem | select | R |  | 0 - NACIONAL, 1 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, 2 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, 3 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO SUPERIOR A 40%, 4 - NACIONAL, CUJA PRODUÇÃO TENHA SIDO FEITA EM CONFORMIDADE COM OS PROCESSOS PRODUTIVOS BÁSICOS DE QUE TRATAM O DECRETO-LEI Nº 288/67, E AS LEIS NºS 8.248/91, 8.387/91, 10.176/01 E 11 . 4 8 4 / 0 7, 5 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO INFERIOR OU IGUAL A 40%, 6 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX, 7 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX … (9) |  |
| `cst_csosn_exp[]` | CST/CSOSN Exportação | select |  |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `reference[]` | Cod. Produto | text |  | 60 |  |  |
| `cbenef[]` | Cód. Benefício Fiscal | text |  | 30 |  |  |
| `c_class_trib[]` | Código Classificação Tributária | text |  | 6 |  |  |
| `cst_ibs_cbs[]` | CST IBS/CBS | select |  |  | 000 - Tributação integral, 010 - Tributação com alíquotas uniformes, 011 - Tributação com alíquotas uniformes reduzidas, 200 - Alíquota reduzida, 220 - Alíquota fixa, 221 - Alíquota fixa proporcional, 222 - Redução de Base de Cálculo, 400 - Isenção … (18) |  |
| `perc_ibs_uf[]` | % IBS UF | text |  |  |  |  |
| `perc_ibs_mun[]` | % IBS Município | text |  |  |  |  |
| `perc_reducao_aliq_ibs_uf[]` | % Redução IBS UF | text |  |  |  |  |
| `perc_reducao_aliq_ibs_mun[]` | % Redução IBS Mun | text |  |  |  |  |
| `perc_dif_ibs_uf[]` | % Diferimento IBS UF | text |  |  |  |  |
| `perc_dif_ibs_mun[]` | % Diferimento IBS Município | text |  |  |  |  |
| `perc_cbs[]` | % CBS | text |  |  |  |  |
| `perc_reducao_aliq_cbs[]` | % Redução CBS | text |  |  |  |  |
| `perc_dif_cbs[]` | % Diferimento CBS | text |  |  |  |  |
| `cst_is[]` | CST IS | text |  | 3 |  |  |
| `perc_is[]` | % Imposto Seletivo | text |  |  |  |  |
| `perc_is_espec[]` | Alíq. Específica IS (R$) | text (moeda) |  |  |  |  |
| `ad_rem_ibs[]` | Alíq. Ad Rem IBS (R$/un) | text (moeda) |  |  |  |  |
| `ad_rem_cbs[]` | Alíq. Ad Rem CBS (R$/un) | text (moeda) |  |  |  |  |
| `tp_cred_pres_ibs_zfm[]` | Crédito Presumido ZFM | select |  |  | Não se aplica, 0 - Sem Crédito Presumido, 1 - Bens de consumo final (55%), 2 - Bens de capital (75%), 3 - Bens intermediários (90,25%), 4 - Bens de informática (100%) |  |
| `ind_doacao[]` | Operação de Doação | select |  |  | Não, Sim |  |
| `total_products` | Total de produtos | text (moeda) | R |  |  |  |
| `added_value` | Acréscimo | text (moeda) |  |  |  |  |
| `discount` | Desconto | text (moeda) | R |  |  |  |
| `total` | Total da NFe | text (moeda) | R |  |  |  |
| `type_payment` | Tipo de pagamento | select | R |  | Dinheiro, Cheque, Cartão de Crédito, Cartão de Débito, Crédito Loja, Vale Alimentação, Vale Refeição, Vale Presente … (15) |  |
| `additional_info` | Info. Complementares | select |  |  |  |  |
| `note` | Observações | textarea |  | 1000 |  |  |
| `percent_icms` | Alíquota do ICMS (%) | text |  |  |  |  |
| `icms_base` | Valor da Base do ICMS | text (moeda) |  |  |  |  |
| `transp_cnpj` | CPF/CNPJ | text |  |  |  |  |
| `transp_name` | Nome | text |  |  |  |  |
| `transp_city_id` | Cidade | select |  |  |  |  |
| `transp_address` | Endereço | text |  |  |  |  |
| `provider_id` | Prestador de Serviço | select |  |  |  |  |
| `type_guide` | Tipo de Guia | select |  |  | 1 - GTA - Guia de Trânsito Animal, 2 - TTA - Termo de Trânsito Animal, 3 - DTA - Documento de Transferência Animal, 4 - ATV - Autorização de Trânsito Vegetal, 5 - PTV - Permissão de Trânsito Vegetal, 6 - GTV - Guia de Trânsito Vegetal, 7 - Guia Florestal (DOF, SisFlora - PA e MT ou SIAM - MG) |  |
| `uf_guide` | UF da Guia | select |  |  | AC, AL, AM, AP, AY, BA, BG, BI … (59) |  |
| `number_guide` | Número da Guia | text |  | 9 |  |  |
| `serie_guide` | Série da Guia | text |  | 9 |  |  |
| `shipping_type` | Tipo | select |  |  | Emitente, Destinatário, Terceiros, Sem Frete |  |
| `antt` | ANTT | text |  |  |  |  |
| `shipping_board_vehicle` | Placa Veículo | text |  |  |  |  |
| `shipping_uf_shipping` | UF Placa | select |  |  | AC, AL, AM, AP, AY, BA, BG, BI … (59) |  |
| `shipping_value` | Valor | text (moeda) |  |  |  |  |
| `specie` | Espécie | text |  |  |  |  |
| `number_volumes` | Numeração | text (moeda) |  |  |  |  |
| `quantity_volumes` | Qtd. Volumes | text (moeda) |  |  |  |  |
| `net_weight` | Peso líquido | text |  |  |  |  |
| `gross_weight` | Peso bruto | text |  |  |  |  |
| `has_input` | Possui entrada ? | select |  |  | Sim, Não |  |
| `input_date` | Data entrada | text (data) |  |  |  |  |
| `input_value` | Valor entrada | text (moeda) |  |  |  |  |
| `qtd_installments` | Nª Parcelas | number |  |  |  |  |
| `first_installment` | Venc. 1ª. PC | text (data) |  |  |  |  |
| `int_installments` | Int. Parcelas (dias) | number |  |  |  |  |
| `fiscal_document` | Dedutível | select |  |  | Não, Sim |  |
| `categories[]` |  | select |  |  |  |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `category_percent_values[]` |  | text (moeda) |  |  |  |  |
| `category_values[]` |  | text (moeda) |  |  |  |  |

**Formulário POST `/admin/clients`** (modal newClientModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Razão Social | text | R | 50 |  |  |
| `name` | Nome Fantasia | text | R | 30 |  |  |
| `email` | Email | email | R |  |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R | 60 |  |  |
| `number` | Número | text | R |  |  |  |
| `district` | Bairro | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `final_costumer` | Consumidor Final | select | R |  | Não, Sim |  |
| `taxpayer` | Contribuinte | select | R |  | Sim, Não |  |
| `id_abroad` | ID estrangeiro | text |  |  |  |  |
| `farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `state_registrations[]` |  | text |  |  |  |  |

**Formulário POST `/admin/clients`** (modal editClientModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Razão Social | text | R | 50 |  |  |
| `name` | Nome Fantasia | text | R | 30 |  |  |
| `email` | Email | email | R |  |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R | 60 |  |  |
| `number` | Número | text | R |  |  |  |
| `district` | Bairro | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `final_costumer` | Consumidor Final | select | R |  | Não, Sim |  |
| `taxpayer` | Contribuinte | select | R |  | Sim, Não |  |
| `id_abroad` | ID estrangeiro | text |  |  |  |  |
| `state_registrations[]` |  | text | R |  |  |  |

## SCR-289 · Consulte os documentos

- **Rota:** `/admin/nfses/create`
- **Módulo:** Gestão Fiscal > NFSe Recebidas
- **Tipo:** Cadastro (novo)
- **Finalidade:** NFSe Recebidas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/nfe/create`

## SCR-445 · LCDPR - Livro Caixa Digital do Produtor Rural

- **Rota:** `/admin/cash-book/create`
- **Módulo:** Gestão Fiscal > LCDPR
- **Tipo:** Cadastro (novo)
- **Finalidade:** LCDPR (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/cash-book`

**Formulário POST `/admin/cash-book`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `start_date` | Dt. Início | text | R |  |  |  |
| `end_date` | Dt. Fim | text | R |  |  |  |
| `proprietary_id` | Proprietário Gestor | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `period` | Início do Período | select | R |  | 0 - Regular (Início no primeiro dia do ano)., 1 - Abertura (Início de atividades no ano-calendário), 2 - Início de obrigatoriedade da escrituração no curso do ano calendário. |  |
| `special` | Situação Especial e Outros Eventos | select | R |  | 0 - Normal, 1 - Falecimento, 2 - Espólio, 3 - Saída definitiva do País |  |
| `dt_special` | Dt. Situação Especial | date |  |  |  |  |
| `verification` | Forma Apuração | select | R |  | 1 - Livro Caixa, 2 - Apuração do lucro pelo disposto no art. 5o da Lei no 8.023, de 1990 |  |
| `contador_id` | Contador | select | R |  |  |  |

## SCR-446 · SPED Fiscal - EFD ICMS/IPI

- **Rota:** `/admin/sped-fiscal/create`
- **Módulo:** Gestão Fiscal > SPED Fiscal
- **Tipo:** Cadastro (novo)
- **Finalidade:** SPED Fiscal (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/sped-fiscal`

**Formulário POST `/admin/sped-fiscal`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `issue_id` | Emissor | select | R |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |  |
| `state_registration_id` | Inscrição Estadual | select | R |  |  |  |
| `reference_month` | Mês de Referência | select | R |  | Janeiro, Fevereiro, Março, Abril, Maio, Junho, Julho, Agosto … (12) |  |
| `reference_year` | Ano de Referência | number | R |  |  |  |

## SCR-447 · Partida Dobrada

- **Rota:** `/admin/double-entry-accountings/create`
- **Módulo:** Gestão Fiscal > Partida Dobrada
- **Tipo:** Cadastro (novo)
- **Finalidade:** Partida Dobrada (cadastro (novo))
- **Abas:** Item de Lançamento
- **Botões/Ações (cabeçalho):** Voltar → `/admin/double-entry-accountings`

**Formulário POST `/admin/double-entry-accountings`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `origin` | Origem | select | R |  | Administrativo, Agricultura, Pecuária |  |
| `total_debit` | Total Débito | text |  |  |  |  |
| `total_credit` | Total Crédito | text |  |  |  |  |
| `total_amount` | Valor Total | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `description` | Descrição | text | R |  |  |  |
| `plan_account_id[]` | Plano de Contas | select | R |  | Caixa, Bancos, Cheques Recebidos, Contas a Receber, Estoque de Gado de Leite, Estoque de Gado Comercial Corte, Estoque de Gado P, Estoque de Gado PC … (4871) |  |
| `condition[]` | Condição | select | R |  | Débito, Crédito |  |
| `value[]` | Valor | text (moeda) | R |  |  |  |

