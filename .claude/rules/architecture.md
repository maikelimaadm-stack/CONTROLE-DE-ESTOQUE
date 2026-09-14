# Arquitetura e SSOT

Aprofunda "Arquitetura" do `CLAUDE.md`. Carregada sempre.
Documentos canônicos: `docs/ARCHITECTURE.md`, `docs/DOMAIN-MODEL.md`,
`docs/DOMAIN-NAMING-STANDARD.md`, `docs/MULTI-COMPANY-CONTRACT.md`,
`docs/GLOBAL-ID-CONTRACT.md`, `docs/AUTHORIZATION.md`, `docs/DECISIONS.md`.

## Fonte única

Cada assunto tem um dono. Regra nova entra no dono; os outros documentos referenciam.
Uma segunda lista com a mesma informação não fica desatualizada com barulho — ela
envelhece em silêncio, e o item novo simplesmente não aparece.

| Assunto | Dono |
|---|---|
| Navegação, rotas, breadcrumbs, favoritos, redirects | `apps/web/nav.registry.mjs` |
| Cadastros (campos, validação, colunas, permissões) | `packages/domain/src/resources/registries.ts` |
| Entidades com ID Global | catálogo em `packages/domain/src/id-global.ts` |
| Rótulo de enum | `packages/domain/src/labels.ts` |
| Decisões com motivo | `docs/DECISIONS.md` |

## Camadas

- O núcleo neutro (`packages/plataforma`, pacote `@erp/plataforma`) **nunca** importa
  `packages/domain`. A dependência é sempre domínio → plataforma.
- Núcleo não conhece nicho: mecanismo no núcleo, configuração do produto no domínio.
- Nicho nomeia MÓDULO, nunca o global. Taxonomia canônica: `ERP-<MÓDULO>-<ENTIDADE>`.
- Superfície criada agora nasce com o nome final em português. Dívida é o que já existe;
  criar dívida nova é violação, e as catracas medem exatamente isso.

## Identidade

`organization_id` (tenant) · `empresa_id` (entidade operacional) · UUID (chave técnica e
URL) · código de entidade (identidade dentro da entidade) · ID Global `#N` (identidade
dentro da organização, só localizador). Cinco conceitos, cinco papéis. Nenhum substitui
outro, e nenhum dos dois últimos autoriza coisa alguma.

## Renomeação

Ordem obrigatória: contrato novo → camada de compatibilidade → migração → remoção do
antigo. Em missão própria, com migration, testes e plano de volta. O padrão de
nomenclatura define o DESTINO; ele não autoriza a execução, e muito menos
localizar-e-substituir em massa.

## Referência externa

`docs/reference/**` é evidência histórica preservada, explicitamente NÃO normativa.
Nunca é fonte de verdade do produto, e nada de lá (código, marca, sigla, numeração)
entra no produto.
