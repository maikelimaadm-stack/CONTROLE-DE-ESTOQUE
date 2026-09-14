# Segurança

Aprofunda "Arquitetura" e "Segredos" do `CLAUDE.md`. Carregada sempre.
Documentos canônicos: `docs/SECURITY.md`, `docs/AUTHORIZATION.md`,
`docs/COMPANY-RLS-MATRIX.md` (gerado — nunca editado à mão).

## Fail closed

- Autorização efetiva = TENANT (RLS) ∧ ESCOPO DE EMPRESA (RLS) ∧ CAPACIDADE (API).
  Combine com AND. Uma permissão OR outra acaba sempre valendo pela mais frouxa.
- Módulo sem configuração = NENHUMA empresa. Módulo indefinido = união das visíveis.
  Nunca "todas".
- Discriminador desconhecido NEGA; não cai em permissão vizinha nem em padrão.
- Escopo declarado ausente não produz recorte parcial: nenhum predicado é emitido.

## Nada de permissão inferida

Menu, URL, pathname, cabeçalho, query, corpo e `data-testid` não autorizam. O módulo
ativo sai da permissão exigida pela rota. `can()` no cliente é apresentação.

## Superfície de recusa

Inexistente, de outro tenant, fora de escopo, excluído (`deleted_at`) e id malformado
são indistinguíveis de fora: mesma 404, mesma mensagem, sem diferença de latência
observável. 403 só para falta de capacidade funcional e para seleção explícita de
empresa proibida. Nada da entidade sai antes da autorização completa.

## Isolamento e RLS

- A API conecta como papel sem bypass de RLS, com `SET LOCAL` de organização e usuário
  por transação. Nunca conceda a si mesma o que lhe falta.
- Política de empresa SUBSTITUI a tenant-only; nunca convive ao lado (PERMISSIVE
  combinam com OR e o vazamento permanece).
- `for all` só quando leitura e escrita são a mesma pergunta; caso contrário, política
  por comando.
- View no schema `erp` é `security_invoker = true`. `SECURITY DEFINER` só como porta
  estreita: `search_path` fixo, organização e usuário da GUC do servidor, capacidades
  reconferidas dentro, sem SQL dinâmico, `execute` revogado de `public`.
- Chave estrangeira de empresa é COMPOSTA: coluna única não prova tenant.
- Nunca monte identificador de tabela, coluna ou entidade a partir de entrada do
  usuário: whitelist declarativa estática e SQL sempre parametrizado.

## Produção

Leitura e diagnóstico são rotina. Escrita, redeploy, migration, reset e alteração de
configuração exigem autorização explícita do Maike, pedida na hora, para aquela ação.
Autorização dada uma vez não vale para a próxima.

## Segredos

Nunca ler, commitar, imprimir ou parafrasear segredo. Em erro operacional, publique o
nome do papel — nunca DSN, host, usuário ou senha. Relatório e PR jamais carregam
credencial, nem truncada, nem "de exemplo" copiada da real.
