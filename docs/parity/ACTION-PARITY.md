# Paridade de Ações

_Gerado por `node scripts/parity.mjs` em 2026-09-10 a partir de docs/reference/SYSTEM-INVENTORY.md (455 telas) e do código deste repositório. Legenda de status: NÃO INICIADO · MAPEADO · EM IMPLEMENTAÇÃO · IMPLEMENTADO · TESTADO (coberto por teste automatizado) · BLOQUEADO · NÃO APLICÁVEL · MELHORADO (comportamento intencionalmente diferente/superior, ver observação)._

Ações de cabeçalho/linha observadas por tela na referência (577 ocorrências em 308 telas). Cobertura: 282/344 (82.0%). Ações padrão (Adicionar/Visualizar/Editar/Excluir/Exportar/Imprimir) herdam o status da tela.

| ID | Tela | Ação (referência) | Status | Observação |
|---|---|---|---|---|
| SCR-004 | Funcionários | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-004 | Funcionários | fas fa-print | MELHORADO | Impressão do navegador |
| SCR-004 | Funcionários | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-004 | Funcionários | Exportar | MELHORADO | CSV/XLSX |
| SCR-004 | Funcionários | Adicionar Novo | MELHORADO |  |
| SCR-004 | Funcionários | Visualizar | MELHORADO |  |
| SCR-004 | Funcionários | Editar | MELHORADO |  |
| SCR-004 | Funcionários | Excluir | MELHORADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-005 | Usuários | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-005 | Usuários | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-005 | Usuários | Exportar | TESTADO | CSV/XLSX |
| SCR-005 | Usuários | Adicionar Novo | TESTADO |  |
| SCR-005 | Usuários | Visualizar | TESTADO |  |
| SCR-005 | Usuários | Editar | TESTADO |  |
| SCR-005 | Usuários | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-006 | Documento Fiscal | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-006 | Documento Fiscal | Adicionar Novo | TESTADO |  |
| SCR-007 | DFe Recebidas | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-007 | DFe Recebidas | Manifestar | EM IMPLEMENTAÇÃO | Manifestação registrada localmente; envio à SEFAZ não integrado |
| SCR-007 | DFe Recebidas | Lançar Despesa em Lote | EM IMPLEMENTAÇÃO | Lançamento a partir da DFe via aprovação de notas (individual) |
| SCR-007 | DFe Recebidas | Buscar DFe | NÃO INICIADO | Consulta SEFAZ exige certificado |
| SCR-008 | Formulação | Adicionar Novo | IMPLEMENTADO |  |
| SCR-009 | Contas a Pagar | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-009 | Contas a Pagar | Simular Crédito | NÃO APLICÁVEL | Oferta de crédito do fornecedor (marketing) |
| SCR-009 | Contas a Pagar | Baixar Contas | TESTADO | Baixa em lote (movimento único ou separado) |
| SCR-009 | Contas a Pagar | Excluir Contas | IMPLEMENTADO | Cancelamento em lote |
| SCR-009 | Contas a Pagar | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-009 | Contas a Pagar | Exportar | TESTADO | CSV/XLSX |
| SCR-009 | Contas a Pagar | Adicionar Novo | TESTADO |  |
| SCR-009 | Contas a Pagar | Visualizar | TESTADO |  |
| SCR-009 | Contas a Pagar | Documentos | EM IMPLEMENTAÇÃO | Anexos via Supabase Storage (pendente de projeto) |
| SCR-009 | Contas a Pagar | Gerar Recibo | IMPLEMENTADO | Recibo textual imprimível |
| SCR-009 | Contas a Pagar | Baixar | TESTADO |  |
| SCR-009 | Contas a Pagar | Duplicar | IMPLEMENTADO |  |
| SCR-009 | Contas a Pagar | Editar | TESTADO |  |
| SCR-009 | Contas a Pagar | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-010 | Conta a Receber | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-010 | Conta a Receber | Baixar Contas | TESTADO | Baixa em lote (movimento único ou separado) |
| SCR-010 | Conta a Receber | Excluir Contas | IMPLEMENTADO | Cancelamento em lote |
| SCR-010 | Conta a Receber | Gerar Boleto | NÃO INICIADO | Emissão de boleto exige convênio bancário |
| SCR-010 | Conta a Receber | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-010 | Conta a Receber | Exportar | TESTADO | CSV/XLSX |
| SCR-010 | Conta a Receber | Adicionar Novo | TESTADO |  |
| SCR-010 | Conta a Receber | Visualizar | TESTADO |  |
| SCR-010 | Conta a Receber | Documentos | EM IMPLEMENTAÇÃO | Anexos via Supabase Storage (pendente de projeto) |
| SCR-010 | Conta a Receber | Editar | TESTADO |  |
| SCR-010 | Conta a Receber | Duplicar | IMPLEMENTADO |  |
| SCR-010 | Conta a Receber | Baixar | TESTADO |  |
| SCR-010 | Conta a Receber | Gerar Recibo | IMPLEMENTADO | Recibo textual imprimível |
| SCR-010 | Conta a Receber | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-011 | Movimento Caixa/Bancário | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-011 | Movimento Caixa/Bancário | Simular Crédito | NÃO APLICÁVEL | Oferta de crédito do fornecedor (marketing) |
| SCR-011 | Movimento Caixa/Bancário | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-011 | Movimento Caixa/Bancário | Exportar | TESTADO | CSV/XLSX |
| SCR-011 | Movimento Caixa/Bancário | Adicionar Novo | TESTADO |  |
| SCR-011 | Movimento Caixa/Bancário | Visualizar | TESTADO |  |
| SCR-011 | Movimento Caixa/Bancário | Imprimir Comprovante | IMPLEMENTADO | Detalhe do movimento imprimível |
| SCR-011 | Movimento Caixa/Bancário | Documentos | EM IMPLEMENTAÇÃO | Anexos via Supabase Storage (pendente de projeto) |
| SCR-011 | Movimento Caixa/Bancário | Editar | TESTADO |  |
| SCR-011 | Movimento Caixa/Bancário | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-012 | Importar OFX | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-012 | Importar OFX | Adicionar Novo | TESTADO |  |
| SCR-012 | Importar OFX | Visualizar | TESTADO |  |
| SCR-012 | Importar OFX | Editar | TESTADO |  |
| SCR-012 | Importar OFX | Conciliar | IMPLEMENTADO |  |
| SCR-012 | Importar OFX | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-014 | NFe | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-014 | NFe | Adicionar Novo | NÃO INICIADO |  |
| SCR-015 | NFSe Recebidas | Buscar DFe | NÃO INICIADO | Consulta SEFAZ exige certificado |
| SCR-017 | Indicadores Suprimentos | Filtrar | IMPLEMENTADO |  |
| SCR-027 | Centro de Custo | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-027 | Centro de Custo | Visualizar | TESTADO |  |
| SCR-027 | Centro de Custo | Cria descendente | TESTADO | Árvore (centro de custo/plano de contas/categoria) |
| SCR-028 | Fazendas | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-028 | Fazendas | Adicionar Novo | IMPLEMENTADO |  |
| SCR-028 | Fazendas | Visualizar | IMPLEMENTADO |  |
| SCR-028 | Fazendas | Adicionar Área | IMPLEMENTADO | Cadastro de áreas vinculado à fazenda |
| SCR-028 | Fazendas | Adicionar Multiplas Áreas | NÃO INICIADO | Criação em lote de áreas não construída |
| SCR-028 | Fazendas | Editar | IMPLEMENTADO |  |
| SCR-028 | Fazendas | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-029 | Safras | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-029 | Safras | Adicionar Novo | IMPLEMENTADO |  |
| SCR-029 | Safras | Visualizar | IMPLEMENTADO |  |
| SCR-029 | Safras | Editar | IMPLEMENTADO |  |
| SCR-029 | Safras | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-030 | Endereçamentos | Adicionar Novo | IMPLEMENTADO |  |
| SCR-030 | Endereçamentos | Visualizar | IMPLEMENTADO |  |
| SCR-030 | Endereçamentos | Cria descendente | IMPLEMENTADO | Árvore (centro de custo/plano de contas/categoria) |
| SCR-030 | Endereçamentos | Editar | IMPLEMENTADO |  |
| SCR-030 | Endereçamentos | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-031 | Produtos | Agrupar | IMPLEMENTADO |  |
| SCR-031 | Produtos | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-031 | Produtos | fas fa-print | TESTADO | Impressão do navegador |
| SCR-031 | Produtos | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-031 | Produtos | Exportar | TESTADO | CSV/XLSX |
| SCR-031 | Produtos | Adicionar Novo | TESTADO |  |
| SCR-031 | Produtos | Visualizar | TESTADO |  |
| SCR-031 | Produtos | Editar | TESTADO |  |
| SCR-031 | Produtos | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-032 | Armazém | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-032 | Armazém | Adicionar Novo | IMPLEMENTADO |  |
| SCR-032 | Armazém | Visualizar | IMPLEMENTADO |  |
| SCR-032 | Armazém | Editar | IMPLEMENTADO |  |
| SCR-032 | Armazém | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-033 | Saldo Inicial | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-033 | Saldo Inicial | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-033 | Saldo Inicial | Exportar | TESTADO | CSV/XLSX |
| SCR-033 | Saldo Inicial | Adicionar Novo | TESTADO |  |
| SCR-033 | Saldo Inicial | Visualizar | TESTADO |  |
| SCR-033 | Saldo Inicial | Editar | TESTADO |  |
| SCR-033 | Saldo Inicial | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-034 | Rateio - Categoria Financeira | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-034 | Rateio - Categoria Financeira | Adicionar Novo | IMPLEMENTADO |  |
| SCR-035 | Perfil Usuário | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-035 | Perfil Usuário | Adicionar Novo | TESTADO |  |
| SCR-035 | Perfil Usuário | Visualizar | TESTADO |  |
| SCR-035 | Perfil Usuário | Editar | TESTADO |  |
| SCR-035 | Perfil Usuário | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-036 | Pessoas | Adicionar Novo | IMPLEMENTADO |  |
| SCR-036 | Pessoas | Visualizar | IMPLEMENTADO |  |
| SCR-036 | Pessoas | Editar | IMPLEMENTADO |  |
| SCR-037 | Proprietários | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-037 | Proprietários | fas fa-print | MELHORADO | Impressão do navegador |
| SCR-037 | Proprietários | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-037 | Proprietários | Exportar | MELHORADO | CSV/XLSX |
| SCR-037 | Proprietários | Adicionar Novo | MELHORADO |  |
| SCR-037 | Proprietários | Visualizar | MELHORADO |  |
| SCR-037 | Proprietários | Editar | MELHORADO |  |
| SCR-037 | Proprietários | Excluir | MELHORADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-038 | Fornecedores | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-038 | Fornecedores | fas fa-print | MELHORADO | Impressão do navegador |
| SCR-038 | Fornecedores | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-038 | Fornecedores | Exportar | MELHORADO | CSV/XLSX |
| SCR-038 | Fornecedores | Adicionar Novo | MELHORADO |  |
| SCR-038 | Fornecedores | Visualizar | MELHORADO |  |
| SCR-038 | Fornecedores | Editar | MELHORADO |  |
| SCR-038 | Fornecedores | Excluir | MELHORADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-039 | Clientes | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-039 | Clientes | fas fa-print | MELHORADO | Impressão do navegador |
| SCR-039 | Clientes | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-039 | Clientes | Exportar | MELHORADO | CSV/XLSX |
| SCR-039 | Clientes | Adicionar Novo | MELHORADO |  |
| SCR-039 | Clientes | Visualizar | MELHORADO |  |
| SCR-039 | Clientes | Editar | MELHORADO |  |
| SCR-039 | Clientes | Excluir | MELHORADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-040 | Autorizadores | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-040 | Autorizadores | Adicionar Novo | TESTADO |  |
| SCR-040 | Autorizadores | Visualizar | TESTADO |  |
| SCR-040 | Autorizadores | Editar | TESTADO |  |
| SCR-040 | Autorizadores | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-041 | Contas Bancárias | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-041 | Contas Bancárias | Adicionar Novo | TESTADO |  |
| SCR-041 | Contas Bancárias | Visualizar | TESTADO |  |
| SCR-041 | Contas Bancárias | Editar | TESTADO |  |
| SCR-041 | Contas Bancárias | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-042 | Saldo Inicial | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-042 | Saldo Inicial | Simular Crédito | NÃO APLICÁVEL | Oferta de crédito do fornecedor (marketing) |
| SCR-042 | Saldo Inicial | Adicionar Novo | IMPLEMENTADO |  |
| SCR-043 | Categoria Financeira | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-043 | Categoria Financeira | fas fa-print | TESTADO | Impressão do navegador |
| SCR-043 | Categoria Financeira | Visualizar | TESTADO |  |
| SCR-043 | Categoria Financeira | Cria descendente | TESTADO | Árvore (centro de custo/plano de contas/categoria) |
| SCR-044 | Emissor NFe | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-044 | Emissor NFe | Adicionar Novo | NÃO INICIADO |  |
| SCR-044 | Emissor NFe | Editar | NÃO INICIADO |  |
| SCR-044 | Emissor NFe | Certificado | NÃO INICIADO | Certificado digital |
| SCR-044 | Emissor NFe | Excluir | NÃO INICIADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-045 | Sincronização DFe | Adicionar Novo | NÃO INICIADO |  |
| SCR-046 | Sincronização NFS-e | Adicionar Novo | NÃO INICIADO |  |
| SCR-047 | Regras Fiscais | Adicionar Novo | IMPLEMENTADO |  |
| SCR-048 | Contadores | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-048 | Contadores | Adicionar Novo | MAPEADO |  |
| SCR-049 | Natureza de Operaçao | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-049 | Natureza de Operaçao | Adicionar Novo | IMPLEMENTADO |  |
| SCR-049 | Natureza de Operaçao | Editar | IMPLEMENTADO |  |
| SCR-049 | Natureza de Operaçao | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-050 | Informações Complementares | Adicionar Novo | IMPLEMENTADO |  |
| SCR-051 | Planos de Contas | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-051 | Planos de Contas | fas fa-print | IMPLEMENTADO | Impressão do navegador |
| SCR-051 | Planos de Contas | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-051 | Planos de Contas | Exportar | IMPLEMENTADO | CSV/XLSX |
| SCR-051 | Planos de Contas | Adicionar Novo | IMPLEMENTADO |  |
| SCR-051 | Planos de Contas | Visualizar | IMPLEMENTADO |  |
| SCR-051 | Planos de Contas | Editar | IMPLEMENTADO |  |
| SCR-051 | Planos de Contas | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-052 | Operação | Adicionar Novo | IMPLEMENTADO |  |
| SCR-052 | Operação | Visualizar | IMPLEMENTADO |  |
| SCR-052 | Operação | Editar | IMPLEMENTADO |  |
| SCR-052 | Operação | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-053 | Atividades | Adicionar Novo | IMPLEMENTADO |  |
| SCR-053 | Atividades | Visualizar | IMPLEMENTADO |  |
| SCR-053 | Atividades | Editar | IMPLEMENTADO |  |
| SCR-053 | Atividades | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-054 | Parâmetros de Peso | Adicionar Novo | IMPLEMENTADO |  |
| SCR-055 | Forragem | Adicionar Novo | IMPLEMENTADO |  |
| SCR-055 | Forragem | Visualizar | IMPLEMENTADO |  |
| SCR-055 | Forragem | Editar | IMPLEMENTADO |  |
| SCR-055 | Forragem | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-056 | Animais | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-056 | Animais | Exportar | TESTADO | CSV/XLSX |
| SCR-056 | Animais | Adicionar Novo | TESTADO |  |
| SCR-056 | Animais | Filtrar | TESTADO |  |
| SCR-056 | Animais | Limpar | TESTADO | Limpar filtros |
| SCR-056 | Animais | Visualizar | TESTADO |  |
| SCR-056 | Animais | Editar | TESTADO |  |
| SCR-056 | Animais | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-057 | Custo Retroativo | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-057 | Custo Retroativo | Salvar | NÃO INICIADO |  |
| SCR-058 | Módulos de Pastejo | Adicionar Novo | IMPLEMENTADO |  |
| SCR-059 | Cochos | Adicionar Novo | IMPLEMENTADO |  |
| SCR-059 | Cochos | Editar | IMPLEMENTADO |  |
| SCR-059 | Cochos | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-060 | Lotes de Animais | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-060 | Lotes de Animais | Adicionar Novo | IMPLEMENTADO |  |
| SCR-061 | Lote/Módulo | Adicionar Novo | MELHORADO |  |
| SCR-062 | Lote/Área | Adicionar Novo | MELHORADO |  |
| SCR-063 | Inventário | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-063 | Inventário | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-063 | Inventário | Exportar | TESTADO | CSV/XLSX |
| SCR-063 | Inventário | Adicionar Novo | TESTADO |  |
| SCR-064 | Depreciação Mensal | Safra | IMPLEMENTADO |  |
| SCR-064 | Depreciação Mensal | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-067 | SLA Status | Editar | IMPLEMENTADO |  |
| SCR-068 | Meus Processos | Visualizar | TESTADO |  |
| SCR-068 | Meus Processos | Relatório SLA | IMPLEMENTADO | /relatorios/supply_sla |
| SCR-068 | Meus Processos | Acusar ciência | TESTADO |  |
| SCR-068 | Meus Processos | Voltar Etapa | IMPLEMENTADO |  |
| SCR-069 | Solicitação | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-069 | Solicitação | Adicionar Novo | TESTADO |  |
| SCR-071 | Cotações | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-071 | Cotações | Visualizar | TESTADO |  |
| SCR-071 | Cotações | Relatório SLA | IMPLEMENTADO | /relatorios/supply_sla |
| SCR-071 | Cotações | Transferir Responsável | TESTADO |  |
| SCR-072 | Autorização | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-073 | Compras | Transferir Responsável em Lote | IMPLEMENTADO | POST /supply/requests/transfer-batch |
| SCR-073 | Compras | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-073 | Compras | Enviar pedido de compras. | IMPLEMENTADO | WhatsApp/e-mail via links |
| SCR-073 | Compras | Visualizar | TESTADO |  |
| SCR-073 | Compras | Relatório SLA | IMPLEMENTADO | /relatorios/supply_sla |
| SCR-073 | Compras | Transferir Responsável | TESTADO |  |
| SCR-073 | Compras | Download Arquivo | EM IMPLEMENTAÇÃO | Anexos via Storage pendentes |
| SCR-074 | Recebimentos | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-074 | Recebimentos | Visualizar | TESTADO |  |
| SCR-074 | Recebimentos | Relatório SLA | IMPLEMENTADO | /relatorios/supply_sla |
| SCR-074 | Recebimentos | Transferir Responsável | TESTADO |  |
| SCR-075 | Entrada/Insumos | Adicionar Novo | TESTADO |  |
| SCR-076 | Aprovação de Notas Fiscais | DFe Recebidas | EM IMPLEMENTAÇÃO |  |
| SCR-077 | Perfis de Lançamento por Fornecedor | Adicionar Novo | IMPLEMENTADO |  |
| SCR-078 | Baixa de Estoque | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-078 | Baixa de Estoque | Adicionar Novo | IMPLEMENTADO |  |
| SCR-079 | Requisição do Estoque | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-079 | Requisição do Estoque | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-079 | Requisição do Estoque | Adicionar Novo | TESTADO |  |
| SCR-080 | Devolução do Estoque | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-080 | Devolução do Estoque | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-080 | Devolução do Estoque | Adicionar Novo | TESTADO |  |
| SCR-081 | Correção de Estoque | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-082 | Transferência de Armazém | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-082 | Transferência de Armazém | Adicionar Novo | TESTADO |  |
| SCR-083 | Transferência de Armazém entre Fazendas | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-083 | Transferência de Armazém entre Fazendas | Adicionar Novo | TESTADO |  |
| SCR-084 | Saldo Estoque | Agrupar | IMPLEMENTADO |  |
| SCR-084 | Saldo Estoque | fas fa-print | TESTADO | Impressão do navegador |
| SCR-084 | Saldo Estoque | Exportar | TESTADO | CSV/XLSX |
| SCR-084 | Saldo Estoque | Visualizar | TESTADO |  |
| SCR-085 | Batida | Adicionar Novo | IMPLEMENTADO |  |
| SCR-086 | Eventos | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-086 | Eventos | Adicionar Novo | IMPLEMENTADO |  |
| SCR-086 | Eventos | Visualizar | IMPLEMENTADO |  |
| SCR-086 | Eventos | Editar | IMPLEMENTADO |  |
| SCR-086 | Eventos | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-087 | Funções | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-087 | Funções | Adicionar Novo | IMPLEMENTADO |  |
| SCR-087 | Funções | Visualizar | IMPLEMENTADO |  |
| SCR-087 | Funções | Editar | IMPLEMENTADO |  |
| SCR-087 | Funções | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-088 | Equipes | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-088 | Equipes | fas fa-print | IMPLEMENTADO | Impressão do navegador |
| SCR-088 | Equipes | Adicionar Novo | IMPLEMENTADO |  |
| SCR-089 | Registro/Faltas | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-089 | Registro/Faltas | Adicionar Novo | TESTADO |  |
| SCR-090 | Adiant. Salarial | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-090 | Adiant. Salarial | fas fa-print | TESTADO | Impressão do navegador |
| SCR-090 | Adiant. Salarial | Adicionar Novo | TESTADO |  |
| SCR-091 | Registro/Eventos | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-091 | Registro/Eventos | Adicionar Novo | IMPLEMENTADO |  |
| SCR-092 | Funcionário x Eventos | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-092 | Funcionário x Eventos | fas fa-print | IMPLEMENTADO | Impressão do navegador |
| SCR-092 | Funcionário x Eventos | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-092 | Funcionário x Eventos | Adicionar Novo | IMPLEMENTADO |  |
| SCR-093 | Apuração Mensal | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-093 | Apuração Mensal | Apuração Mensal (Grade) | IMPLEMENTADO |  |
| SCR-093 | Apuração Mensal | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-093 | Apuração Mensal | Gerar financeiro | TESTADO |  |
| SCR-094 | Tipos de Documento | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-094 | Tipos de Documento | Adicionar Novo | IMPLEMENTADO |  |
| SCR-094 | Tipos de Documento | Visualizar | IMPLEMENTADO |  |
| SCR-094 | Tipos de Documento | Cria descendente | IMPLEMENTADO | Árvore (centro de custo/plano de contas/categoria) |
| SCR-094 | Tipos de Documento | Editar | IMPLEMENTADO |  |
| SCR-094 | Tipos de Documento | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-095 | Gestão de Documentos | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-095 | Gestão de Documentos | Adicionar Novo | IMPLEMENTADO |  |
| SCR-096 | Gestão Animais | Transferir de Lote | IMPLEMENTADO |  |
| SCR-096 | Gestão Animais | Realizar Pesagem | TESTADO |  |
| SCR-096 | Gestão Animais | Realizar Sanitário | TESTADO |  |
| SCR-096 | Gestão Animais | Status Reprodutivo | IMPLEMENTADO | Diagnóstico de gestação |
| SCR-096 | Gestão Animais | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-096 | Gestão Animais | Exportar | TESTADO | CSV/XLSX |
| SCR-096 | Gestão Animais | Adicionar Novo | TESTADO |  |
| SCR-096 | Gestão Animais | Filtrar | TESTADO |  |
| SCR-096 | Gestão Animais | Limpar | TESTADO | Limpar filtros |
| SCR-096 | Gestão Animais | Visualizar | TESTADO |  |
| SCR-096 | Gestão Animais | Editar | TESTADO |  |
| SCR-096 | Gestão Animais | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-097 | Inventariado Animais | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-098 | Planejamento Pecuário | Adicionar Novo | IMPLEMENTADO |  |
| SCR-100 | Agrupar Lotes | Agrupar | IMPLEMENTADO |  |
| SCR-100 | Agrupar Lotes | Novo Lote | IMPLEMENTADO | Cadastro de lotes |
| SCR-101 | Venda de Animais | Adicionar Novo | TESTADO |  |
| SCR-102 | Compra de Animais | Adicionar Novo | TESTADO |  |
| SCR-103 | Nascimentos | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-103 | Nascimentos | Adicionar Novo | IMPLEMENTADO |  |
| SCR-104 | Mortes | Adicionar Novo | IMPLEMENTADO |  |
| SCR-105 | Perdas | Adicionar Novo | IMPLEMENTADO |  |
| SCR-106 | Processamentos | Processar | TESTADO |  |
| SCR-107 | Pré-Lotes | Adicionar Novo | MAPEADO |  |
| SCR-108 | Pesagens | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-108 | Pesagens | Adicionar Novo | TESTADO |  |
| SCR-108 | Pesagens | Visualizar | TESTADO |  |
| SCR-108 | Pesagens | Relatório Individual | IMPLEMENTADO | Ficha do animal |
| SCR-108 | Pesagens | Exportar Excel | TESTADO | XLSX |
| SCR-108 | Pesagens | Editar | TESTADO |  |
| SCR-108 | Pesagens | Excluir | TESTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-109 | Nutrição | Adicionar Novo | IMPLEMENTADO |  |
| SCR-110 | Sanitários | Adicionar Novo | TESTADO |  |
| SCR-111 | Desmama | Adicionar Novo | IMPLEMENTADO |  |
| SCR-112 | Apartações | Adicionar Novo | IMPLEMENTADO |  |
| SCR-114 | Pastagem | Adicionar Novo | IMPLEMENTADO |  |
| SCR-114 | Pastagem | Visualizar | IMPLEMENTADO |  |
| SCR-114 | Pastagem | Finalizar | IMPLEMENTADO |  |
| SCR-114 | Pastagem | Excluir | IMPLEMENTADO | Exclusão lógica (soft delete) com auditoria; documentos transacionais são cancelados com estorno |
| SCR-115 | Gerenciamento Reprodutivo Avançado | Adicionar Novo Acasalamento | IMPLEMENTADO |  |
| SCR-116 | Estações de Monta | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-116 | Estações de Monta | Adicionar Novo | IMPLEMENTADO |  |
| SCR-117 | Lotes/Reprodução | Adicionar Novo | MAPEADO |  |
| SCR-118 | Touros/Sêmen/Embrião | Adicionar Novo | IMPLEMENTADO |  |
| SCR-119 | Protocolos/Estação | Adicionar Novo | IMPLEMENTADO |  |
| SCR-120 | Acasalamento | Adicionar Novo | IMPLEMENTADO |  |
| SCR-121 | Pátio | Adicionar Novo | IMPLEMENTADO |  |
| SCR-122 | Setores | Adicionar Novo | IMPLEMENTADO |  |
| SCR-123 | Curral | Adicionar Novo | IMPLEMENTADO |  |
| SCR-124 | Dietas | Adicionar Novo | IMPLEMENTADO |  |
| SCR-125 | Fases/Regras de Troca | Adicionar Novo | IMPLEMENTADO |  |
| SCR-126 | Batelada | Adicionar Novo | IMPLEMENTADO |  |
| SCR-127 | Trato Diário | Adicionar Novo | IMPLEMENTADO |  |
| SCR-128 | Leitura de Cocho | Adicionar Novo | IMPLEMENTADO |  |
| SCR-130 | Pluviometria | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-130 | Pluviometria | Adicionar Novo | IMPLEMENTADO |  |
| SCR-131 | Orçamentos | Adicionar Novo | TESTADO |  |
| SCR-132 | Pedidos | Adicionar Novo | TESTADO |  |
| SCR-133 | Vendas | Adicionar Novo | TESTADO |  |
| SCR-135 | Ordem de Serviço | Adicionar novo | IMPLEMENTADO |  |
| SCR-138 | Análise do Fluxo Bancário | Simular Crédito | NÃO APLICÁVEL | Oferta de crédito do fornecedor (marketing) |
| SCR-139 | Gestão Contratos | Adicionar Novo | IMPLEMENTADO |  |
| SCR-140 | Previsão Orçamentária Anual | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-140 | Previsão Orçamentária Anual | Adicionar Novo | IMPLEMENTADO |  |
| SCR-141 | Congelamento Financeiro | Adicionar Novo | TESTADO |  |
| SCR-142 | Planilha de Movimentos | Importar | EM IMPLEMENTAÇÃO | Importação CSV disponível apenas para produtos/pessoas (registro importExport); demais cadastros pendentes |
| SCR-143 | Manutenções | Adicionar Novo | IMPLEMENTADO |  |
| SCR-144 | Abastecimentos | Adicionar Novo | TESTADO |  |
| SCR-145 | Manutenções Preventivas | Adicionar Novo | IMPLEMENTADO |  |
| SCR-147 | Transferência de Máquinas | Adicionar Novo | IMPLEMENTADO |  |
| SCR-148 | Arquivos XML | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-149 | MDFe | Saiba + | NÃO APLICÁVEL | Link de ajuda/marketing do fornecedor |
| SCR-149 | MDFe | Consultar não encerrados | IMPLEMENTADO | Filtro de status |
| SCR-149 | MDFe | Adicionar Novo | NÃO INICIADO |  |
| SCR-150 | MDFe | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-151 | LCDPR - Livro Caixa Digital do Produtor Rural | Adicionar Novo | EM IMPLEMENTAÇÃO |  |
| SCR-152 | SPED Fiscal - EFD ICMS/IPI | Adicionar Novo | NÃO INICIADO |  |
| SCR-153 | Partida Dobrada | Adicionar Novo | IMPLEMENTADO |  |
| SCR-262 | Integração Domínio | Adicionar Novo | NÃO INICIADO |  |
| SCR-263 | Integração CTA Smart | Abastecimentos Importados | NÃO INICIADO | CTA Smart |
| SCR-264 | CTA Smart - Abastecimentos Importados | Configuração | NÃO INICIADO | Emissor fiscal |
| SCR-264 | CTA Smart - Abastecimentos Importados | Sincronizar Agora | NÃO INICIADO | SEFAZ/NFS-e |
| SCR-267 | Funcionários | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-268 | Funcionários | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-269 | Funcionários | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-271 | Usuários | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-272 | Usuários | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-273 | Documento Fiscal | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-274 | Consulte os documentos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-275 | Formulação | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-276 | Contas a Pagar | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-277 | Contas a Pagar | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-278 | Contas a Pagar | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-279 | Conta a Receber | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-280 | Conta a Receber | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-281 | Conta a Receber | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-282 | Movimento Caixa/Bancário | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-283 | Movimento Caixa/Bancário | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-284 | Movimento Caixa/Bancário | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-285 | Importar OFX | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-286 | Importar OFX | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-287 | Importar OFX | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-288 | NFe | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-288 | NFe | Dados Fiscais | NÃO INICIADO | Emissor fiscal |
| SCR-289 | Consulte os documentos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-290 | Centro de custo | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-291 | Centro de Custo | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-292 | Fazenda | Importar arquivo KML | NÃO INICIADO | Georreferenciamento |
| SCR-292 | Fazenda | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-293 | Fazendas | Exportar KML | NÃO INICIADO | Georreferenciamento |
| SCR-293 | Fazendas | Imprimir mapa | NÃO INICIADO | Georreferenciamento |
| SCR-293 | Fazendas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-294 | Fazenda | Importar arquivo KML | NÃO INICIADO | Georreferenciamento |
| SCR-294 | Fazenda | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-295 | Safras | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-296 | Safras | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-297 | Safras | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-298 | Endereçamento - Setor | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-299 | Endereçamento - Setor | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-300 | Endereçamento - Setor | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-302 | Produtos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-303 | Produtos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-304 | Produtos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-305 | Armazém | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-306 | Armazém | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-307 | Armazém | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-308 | Saldo Inicial | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-309 | Saldo Inicial | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-310 | Saldo Inicial | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-311 | Saldo Inicial | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-312 | Perfil Usuário | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-313 | Perfil Usuário | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-314 | Perfil Usuário | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-315 | Inscrições Estaduais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-315 | Inscrições Estaduais | Proprietario | MELHORADO | Papel de pessoa |
| SCR-315 | Inscrições Estaduais | Funcionário | MELHORADO | Papel de pessoa |
| SCR-315 | Inscrições Estaduais | Fornecedor | MELHORADO | Papel de pessoa |
| SCR-315 | Inscrições Estaduais | Cliente | MELHORADO | Papel de pessoa |
| SCR-315 | Inscrições Estaduais | Usuário | IMPLEMENTADO |  |
| SCR-316 | Pessoas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-317 | Inscrições Estaduais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-317 | Inscrições Estaduais | Proprietario | MELHORADO | Papel de pessoa |
| SCR-317 | Inscrições Estaduais | Funcionário | MELHORADO | Papel de pessoa |
| SCR-317 | Inscrições Estaduais | Fornecedor | MELHORADO | Papel de pessoa |
| SCR-317 | Inscrições Estaduais | Cliente | MELHORADO | Papel de pessoa |
| SCR-317 | Inscrições Estaduais | Usuário | IMPLEMENTADO |  |
| SCR-319 | Inscrições Estaduais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-320 | Proprietários | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-321 | Inscrições Estaduais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-323 | Fornecedores | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-324 | Fornecedores | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-325 | Fornecedores | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-327 | Inscrições Estaduais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-328 | Clientes | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-329 | Inscrições Estaduais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-330 | Regras de Autorização | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-331 | Autorizadores | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-332 | Regras de Autorização | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-333 | Conta Bancaria | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-334 | Contas Bancárias | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-335 | Contas Bancárias | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-336 | Saldo Inicial- Contas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-337 | Categoria Financeira | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-338 | Categoria Financeira | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-340 | Inscrições Estaduais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-341 | Sincronização DFe | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-342 | Sincronização NFS-e | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-343 | Regras Fiscais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-344 | Novo Contador | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-345 | Natureza de Operaçao | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-346 | Natureza de Operação | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-347 | Informações Complementares | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-349 | Planos de Contas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-350 | Planos de Contas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-351 | Planos de Contas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-352 | Operação | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-353 | Operação | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-354 | Operação | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-355 | Atividades | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-356 | Atividades | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-357 | Atividades | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-358 | Parâmetro de Peso | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-359 | Forragem | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-360 | Forragem | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-361 | Forragem | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-362 | Informações do Animal | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-363 | Tipos de Identificação | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-364 | Informações do Animal | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-365 | Módulo Pastejo | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-366 | Cochos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-367 | Cochos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-368 | Lote de Animais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-369 | Lote/Módulo | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-370 | Lote/Área | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-371 | Inventário | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-372 | SLA Status | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-373 | Solicitação | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-374 | Nova Entrada / Insumos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-376 | Baixa de Estoque | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-377 | Requisição do Estoque | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-378 | Devolução do Estoque | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-379 | Transferência de Armazém | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-380 | Transferência de Armazém entre Fazendas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-382 | Batida | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-383 | Eventos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-384 | Eventos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-385 | Eventos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-386 | Funções | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-387 | Funções | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-388 | Funções | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-390 | Equipes | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-391 | Registro/Faltas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-392 | Rateio do Adiantamento | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-393 | Registro/Eventos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-395 | Funcionário x Eventos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-396 | Tipo de Documento | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-397 | Tipo de Documento | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-398 | Tipo de Documento | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-399 | Gestão de Documentos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-400 | Informações do Animal | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-401 | Tipos de Identificação | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-402 | Informações do Animal | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-403 | Planejamento Pecuário | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-404 | Venda de Animais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-405 | Compra de Animais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-406 | Tipos de Identificação | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-407 | Mortes | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-408 | Perdas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-409 | Pré-Lote | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-409 | Pré-Lote | Importar planilha | NÃO INICIADO | Planilha de movimentos |
| SCR-410 | Pesagem | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-411 | Pesagem | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-412 | Pesagem | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-413 | Nutrição | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-414 | Sanitário | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-415 | Desmama | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-416 | Apartação | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-417 | Pastagem | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-418 | Pastagem | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-419 | Pastagem | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-420 | Estação de Monta | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-421 | Lotes | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-422 | Animais | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-423 | Produtos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-424 | Monta Natural | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-425 | Pátio | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-426 | Setores | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-427 | Curral | Cancelar | TESTADO |  |
| SCR-428 | Dieta | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-428 | Dieta | Adicionar Ingrediente | IMPLEMENTADO | Itens da formulação/dieta |
| SCR-429 | Fases/Regras de Troca | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-430 | Novo Batelada | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-431 | Fornecimento de Trato | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-432 | Nova Leitura de Cocho | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-433 | Pluviometria | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-434 | Orçamentos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-435 | Pedidos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-436 | Vendas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-437 | Identificação da OS | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-438 | Gestão de Contrato | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-439 | Categorias | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-440 | Congelamento Financeiro | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-441 | Manutenções | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-442 | Abastecimentos | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-443 | Manutenções Preventivas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-444 | Transferência de Máquinas | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-445 | LCDPR - Livro Caixa Digital do Produtor Rural | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-446 | SPED Fiscal - EFD ICMS/IPI | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-447 | Partida Dobrada | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-448 | Integração Domínio | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-451 | Informação do Pedido | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-452 | Informação do Pedido | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-453 | Informação do Pedido | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-454 | Informação do Pedido | Voltar | NÃO APLICÁVEL | Navegação |
| SCR-455 | Movimento Caixa/Bancário | Voltar | NÃO APLICÁVEL | Navegação |
