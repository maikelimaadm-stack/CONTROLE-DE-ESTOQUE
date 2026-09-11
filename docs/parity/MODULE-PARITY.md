# Paridade de Módulos

_Gerado por `node scripts/parity.mjs` em 2026-09-11 a partir de docs/reference/SYSTEM-INVENTORY.md (455 telas) e do código deste repositório. Legenda de status: NÃO INICIADO · MAPEADO · EM IMPLEMENTAÇÃO · IMPLEMENTADO · TESTADO (coberto por teste automatizado) · BLOQUEADO · NÃO APLICÁVEL · MELHORADO (comportamento intencionalmente diferente/superior, ver observação) · UNIFICADO (tela absorvida como aba/filtro/ação de uma área unificada — ver docs/UX-ARCHITECTURE.md; a rota antiga redireciona)._

Módulos do menu da referência × cobertura nossa (telas). Total geral: 417/455 (91.6%).

| Módulo | Telas ref. | Implementadas/Testadas/Melhoradas/Unificadas | Em implementação/Mapeadas | Não iniciadas | Não aplicáveis | Cobertura | Status do módulo |
|---|---|---|---|---|---|---|---|
| Painel de Controle | 1 | 1 | 0 | 0 | 0 | 1/1 (100.0%) | IMPLEMENTADO |
| Dashboards | 13 | 13 | 0 | 0 | 0 | 13/13 (100.0%) | IMPLEMENTADO |
| Cadastros Base | 133 | 121 | 2 | 10 | 0 | 121/133 (91.0%) | EM IMPLEMENTAÇÃO |
| Administrativo | 67 | 65 | 2 | 0 | 0 | 65/67 (97.0%) | EM IMPLEMENTAÇÃO |
| Financeiro | 26 | 25 | 0 | 1 | 0 | 25/26 (96.2%) | EM IMPLEMENTAÇÃO |
| Gestão Fiscal | 13 | 3 | 2 | 8 | 0 | 3/13 (23.1%) | EM IMPLEMENTAÇÃO |
| Operacional | 80 | 75 | 4 | 1 | 0 | 75/80 (93.8%) | EM IMPLEMENTAÇÃO |
| Gestão de Frota | 9 | 9 | 0 | 0 | 0 | 9/9 (100.0%) | IMPLEMENTADO |
| Relatórios | 108 | 104 | 3 | 1 | 0 | 104/108 (96.3%) | EM IMPLEMENTAÇÃO |
| Integrações | 5 | 1 | 0 | 4 | 0 | 1/5 (20.0%) | EM IMPLEMENTAÇÃO |

## Módulos nossos sem equivalente direto (MELHORADO)

- Ledger de estoque imutável com estorno (`/estoque/movimentos`) — a referência edita/exclui movimentos.
- Auditoria consultável (`/admin/auditoria`) e notificações por regra (`/admin/notificacoes`).
- Exportações genéricas de qualquer cadastro (`/integracoes/exportacoes`).
- Painel fiscal com status honesto de cada capacidade (`/fiscal`).
