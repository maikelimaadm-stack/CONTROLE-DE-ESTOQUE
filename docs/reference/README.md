# Documentação de referência externa (histórico)

> **Não é fonte de verdade deste produto.** Este diretório guarda o que foi **observado** no sistema de
> referência externo durante a fase de levantamento: menus, telas, permissões, situações, relatórios e
> regras. Serve para auditoria e rastreabilidade das decisões — nada aqui descreve o comportamento atual
> do ERP.

Classificação segundo `docs/DOMAIN-NAMING-STANDARD.md` §4: **categoria C — documentação histórica**.
Por isso os nomes do sistema externo permanecem nestes arquivos, e apenas aqui: em runtime e em código de
produto eles são proibidos (gate `scripts/naming-audit.mjs`).

Para o comportamento real do sistema, use:

| Assunto | Documento |
| --- | --- |
| Arquitetura e módulos | `docs/ARCHITECTURE.md`, `docs/UX-ARCHITECTURE.md` |
| Modelo de dados | `docs/DATA-DICTIONARY.md` (gerado), `docs/DATABASE.md` |
| Organização × Empresa | `docs/MULTI-COMPANY-CONTRACT.md` |
| Identidade de registro | `docs/GLOBAL-ID-CONTRACT.md` |
| Idioma e terminologia | `docs/I18N-CONTRACT.md`, `docs/UI-STANDARD.md` |
| Nomenclatura e independência | `docs/DOMAIN-NAMING-STANDARD.md` |
| Decisões | `docs/DECISIONS.md` |

A paridade funcional entre o levantamento e o que foi implementado é auditada por
`node scripts/parity.mjs --check`.
