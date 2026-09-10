# Análise de Gaps

_Gerada a partir de `docs/parity/summary.json` (`node scripts/parity.mjs`). Números honestos: "implementado" significa tela + API + regras funcionando no ambiente de desenvolvimento/CI; "testado" significa coberto por teste automatizado que passa._

## Números
- Telas da referência: **455** · implementadas/testadas/melhoradas: **417/455 (91.6%)** · testadas: 116 · em implementação: 7 · mapeadas: 6 · não iniciadas: 25
- Relatórios da referência: **120** · cobertos: **116/120 (96.7%)** · relatórios no nosso runner: 107
- Ações observadas (excluindo navegação/marketing): cobertas **282/344 (82.0%)**
- Páginas web nossas: 107 rotas (App Router) · cadastros declarativos: 63 · permissões: 773 chaves (referência 666)
- Testes: unit 35 · schema/RLS 6 · API 29 · e2e 8 (todos passando em 10/09/2026)

## Cobertura por módulo
| Módulo | Cobertura |
|---|---|
| Painel de Controle | 1/1 (100.0%) |
| Dashboards | 13/13 (100.0%) |
| Cadastros Base | 121/133 (91.0%) |
| Administrativo | 65/67 (97.0%) |
| Financeiro | 25/26 (96.2%) |
| Gestão Fiscal | 3/13 (23.1%) |
| Operacional | 75/80 (93.8%) |
| Gestão de Frota | 9/9 (100.0%) |
| Relatórios | 104/108 (96.3%) |
| Integrações | 1/5 (20.0%) |

## Gaps (telas de listagem/página não plenamente implementadas)
| ID | Tela | Rota referência | Status | O que falta |
|---|---|---|---|---|
| SCR-007 | DFe Recebidas | `/admin/dfe` | EM IMPLEMENTAÇÃO | Fila de DFe e manifestação registradas localmente; consulta automática à SEFAZ (certificado A1) não integrada |
| SCR-014 | NFe | `/admin/nfe` | NÃO INICIADO | Emissão de NF-e exige certificado digital e homologação SEFAZ — fora do escopo desta entrega |
| SCR-015 | NFSe Recebidas | `/admin/nfses` | NÃO INICIADO | Consulta de NFS-e recebidas depende de integração municipal |
| SCR-044 | Emissor NFe | `/admin/issue` | NÃO INICIADO | Emissor NF-e (certificado) — gap fiscal |
| SCR-045 | Sincronização DFe | `/admin/issue-dfe-sync-time` | NÃO INICIADO | Depende do emissor/SEFAZ |
| SCR-046 | Sincronização NFS-e | `/admin/issue-nfse-sync-time` | NÃO INICIADO | Depende de integração municipal |
| SCR-048 | Contadores | `/admin/contador` | MAPEADO | Contador é uma pessoa com papel; envio de arquivos ao contador não implementado |
| SCR-057 | Custo Retroativo | `/admin/animal-retroactive-costs` | NÃO INICIADO | Custo retroativo de animais: coluna existe no custeio por lote, tela de lançamento não construída |
| SCR-097 | Inventariado Animais | `/admin/inventoried-animals` | NÃO INICIADO | Inventário físico de animais (conferência) não construído |
| SCR-107 | Pré-Lotes | `/admin/purchase-lots` | MAPEADO | Pré-lotes representados pelos lotes por contagem (herd_lots) da compra; sem tela própria |
| SCR-117 | Lotes/Reprodução | `/admin/breeding-batch` | MAPEADO | Lotes de reprodução por estação: filtro por lote no picker de matrizes; sem entidade própria |
| SCR-142 | Planilha de Movimentos | `/admin/movement-sheets` | NÃO INICIADO | Planilha de movimentos (importação em massa) não construída; exportação disponível |
| SCR-149 | MDFe | `/admin/mdfe` | NÃO INICIADO | MDF-e depende de emissão fiscal |
| SCR-151 | LCDPR - Livro Caixa Digital do Produtor Rural | `/admin/cash-book` | EM IMPLEMENTAÇÃO | Dados do livro caixa capturados (contas 'livro caixa', dedutibilidade); geração do arquivo LCDPR não implementada |
| SCR-152 | SPED Fiscal - EFD ICMS/IPI | `/admin/sped-fiscal` | NÃO INICIADO | SPED EFD ICMS/IPI depende de emissão fiscal |
| SCR-262 | Integração Domínio | `/admin/integration-dominios` | NÃO INICIADO | Integração contábil Domínio não construída; exportação CSV/XLSX disponível |
| SCR-263 | Integração CTA Smart | `/admin/integration-cta-smart` | NÃO INICIADO | Campo 'origem' preparado (cta_smart); importação automática não construída |
| SCR-264 | CTA Smart - Abastecimentos Importados | `/admin/cta-smart-supplies` | NÃO INICIADO | Idem CTA Smart |

## Gaps transversais
| Tema | Status | Detalhe |
|---|---|---|
| Emissão fiscal (NF-e, NFC-e, MDF-e, CT-e, NFS-e, SPED, LCDPR arquivo, boleto) | NÃO INICIADO | Exige certificado digital A1, homologação SEFAZ/prefeituras, convênio bancário e provedor de emissão. Dados-base (natureza de operação, regras fiscais, dedutibilidade, livro caixa) estão modelados. |
| Consulta automática de DFe/NFS-e na SEFAZ | NÃO INICIADO | Fila e aprovação existem; sincronização depende do certificado. |
| Integrações Domínio (contábil) e CTA Smart (abastecimentos) | NÃO INICIADO | Campo de origem e exportações genéricas preparados. |
| Anexos (documentos, títulos, solicitações) | EM IMPLEMENTAÇÃO | Tabela `attachments` e listagem prontas; upload depende do bucket no projeto Supabase (não criado por decisão do usuário). |
| Georreferenciamento (mapa/KML de fazendas e áreas) | NÃO INICIADO | Campos de área em hectares existem; sem mapa. |
| Importação CSV de todos os cadastros / planilha de movimentos | EM IMPLEMENTAÇÃO | Import disponível para produtos e pessoas; demais pendentes. |
| Inventário físico de animais e custo retroativo | NÃO INICIADO | — |
| Screenshots do sistema de referência | BLOQUEADO | Navegador headless bloqueado pelo proxy do ambiente; inventário feito via HTTP/HTML (docs/reference). |
| Deploy real (Supabase/Railway/Vercel) | EM IMPLEMENTAÇÃO | Configurações e Dockerfile prontos; aplicação no Supabase adiada pelo usuário. Ver `docs/DEPLOYMENT.md` e o relatório final. |

## Próximos passos sugeridos (ordem de valor)
1. Criar projeto Supabase, aplicar migrations, criar `erp_app`, bucket de anexos; apontar Railway/Vercel.
2. Upload de anexos (Storage) e importação CSV genérica.
3. Consulta DFe/NFS-e com certificado (provedor) → depois emissão NF-e.
4. Mapa/KML de áreas.
5. Inventário físico de animais e custo retroativo.
