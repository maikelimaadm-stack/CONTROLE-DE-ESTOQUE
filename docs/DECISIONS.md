# Decisões de arquitetura (ADRs resumidos)

| # | Decisão | Motivo | Diferença em relação à referência |
|---|---|---|---|
| 1 | Ledger imutável de estoque com estorno | Rastreabilidade e custo médio consistentes; impossível "editar" um movimento e quebrar saldos | Referência permite editar/excluir movimentos (MELHORADO) |
| 2 | Invariantes no banco (triggers) + RLS sem bypass | Regras valem para qualquer caminho de escrita; isolamento multi-tenant não depende de `WHERE` | Referência confia na camada de aplicação (NÃO CONFIRMADO) |
| 3 | Idempotency-Key em todas as escritas críticas | Reenvio/duplo clique não duplica títulos, movimentos ou baixas | Não observado na referência |
| 4 | `version` otimista em solicitações de compra | Dois usuários agindo no mesmo processo recebem `CONCURRENCY_CONFLICT` em vez de sobrescrever | Não observado |
| 5 | Cadastro único de pessoas com papéis | Evita cadastros duplicados de funcionário/fornecedor/cliente/proprietário | Referência tem 5 telas separadas (MELHORADO) |
| 6 | Cadastros dirigidos por registro declarativo | 63 cadastros com formulário, listagem, filtros, validação, opções, exportação consistentes; menos código, menos bugs | — |
| 7 | Runner genérico de relatórios (107 relatórios) | Filtros server-side, totais, CSV/XLSX e impressão uniformes | Referência: 120 páginas artesanais; 4 mapeadas a telas nossas |
| 8 | Sem limite de licença de usuários | Modelo de negócio do fornecedor não é regra de domínio | Referência bloqueia "limite de usuários" |
| 9 | Ações de marketing removidas ("Saiba +", "Simular Crédito", "Acesse mais crédito") | Não são funcionalidades | NÃO APLICÁVEL |
| 10 | Emissão fiscal (NF-e/MDF-e/SPED/boleto) fora do escopo | Exige certificado digital, homologação SEFAZ, convênio bancário | Documentado em GAP-ANALYSIS (NÃO INICIADO) |
| 11 | Dinheiro como `numeric` + decimal.js, strings na API | Sem erro de ponto flutuante | Referência exibe arredondamentos (NÃO CONFIRMADO) |
| 12 | Modo de autenticação dual (local/Supabase) | CI e desenvolvimento sem dependência externa; produção com Supabase Auth | — |
| 13 | Datas pt-BR só na UI; ISO no transporte | Evita ambiguidade | — |
| 14 | Transferência Lote/Módulo/Área unificada | Um único movimento com histórico em vez de duas telas | MELHORADO |
| 15 | Avaliação de OS no detalhe | Menos telas, mesma funcionalidade | MELHORADO |
| 16 | Áreas de trabalho por módulo (abas/sub-abas por permissão) em vez de uma tela por etapa/tipo | Menu de ~150 para 47 itens; o usuário acompanha um processo sem trocar de módulo; backend, schema, permissões e ledger intocados; rotas antigas redirecionam (`apps/web/redirects.mjs`) | 98 telas da referência viram abas/filtros/ações (UNIFICADO) — `docs/UX-ARCHITECTURE.md` |
| 17 | Dashboards dentro do módulo ("Visão Geral") | Sem seção de 13 dashboards soltos; mesmas consultas | UNIFICADO |
| 18 | Cadastros técnicos em Configurações; cadastros frequentes no contexto de uso | Fim do conceito "Cadastros Base" na navegação; `/cadastros/<recurso>` permanece como rota de registro | UNIFICADO |
| 19 | Anexos por registro guardados no banco (`erp.attachment_blobs`, bytea, 20 MB por arquivo) servidos pela API com autenticação | Sem dependência de storage externo nem de URLs assinadas; RLS do tenant vale para o conteúdo; prévia (imagem/PDF/texto) e download pelo mesmo endpoint | Referência: Supabase Storage com URL assinada e sem prévia — MELHORADO |
| 20 | Seleção do modelo base como no MG: clique = um registro (Ctrl alterna, Shift intervalo); histórico e anexos só com exatamente um registro ou no modo Registro; ao sair do Registro o registro fica selecionado e visível | Regras de operação do PROJETOMG; menos cliques errados em ações por registro | Referência limpa a seleção ao voltar — MELHORADO |

