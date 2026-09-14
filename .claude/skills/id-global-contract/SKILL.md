---
name: id-global-contract
description: Contrato do ID Global deste ERP — o que ele é, o que nunca decide, como é alocado e onde a apresentação é política de UX, não invariante. Use ao mexer em identidade de registro, listagem com o número, busca global ou catálogo de entidades.
when_to_use: A tarefa envolve ID Global, a coluna de identidade em listagens, a busca por número, ou a pergunta é "este registro tem número?".
---

# Contrato do ID Global

Resumo operacional. O documento canônico é `docs/GLOBAL-ID-CONTRACT.md`; o catálogo é
`packages/domain/src/id-global.ts`; o gate é `scripts/id-global-audit.mjs`.

## Três identidades, três papéis

| | O que é | Escopo | Endereça? | Autoriza? |
|---|---|---|---|---|
| **UUID** | chave técnica | global | **sim** — é a URL | não |
| **Código de entidade** | numeração do cadastro | por entidade | não | não |
| **ID Global** | localizador humano (número) | por organização | **não** | **não** |

O ID Global atravessa empresas e módulos dentro da organização. Não existe `/registro/55`:
a URL continua sendo a rota canônica com o UUID. Quem procura por número usa a busca global,
que aceita as grafias compatíveis (`54`, `#54`, `ID 54`) — compatibilidade de entrada, não
definição de como o número é exibido.

## O que o ID Global NÃO faz

- **Não autoriza.** Não inclui linha, não exclui linha, não reordena. As linhas chegam
  já filtradas por permissão, escopo de empresa, RLS e exclusão lógica; ele apenas rotula
  o que o usuário já está vendo. Se decidisse qualquer uma dessas coisas, haveria duas
  autoridades de escopo na mesma resposta — e a mais frouxa acabaria valendo.
- **Não é autoridade de existência.** O `empresa_id` do índice é dica denormalizada;
  a autoridade é o registro fonte vivo, no módulo da permissão dele.
- **Não entra na chave de cache** junto com a empresa selecionada.

## Alocação

Na **mesma transação de negócio**, inclusive para os efeitos colaterais do registro raiz.
O contador é a autoridade e só sobe. Lacuna é normal. Nunca `MAX(id)+1`, nunca renumerar
número já exposto, nunca compactar lacuna, nunca diminuir o contador.

Não recebe número: registro excluído, variante interna declarada, linha sem identidade
própria. Variante **desconhecida** ERRA — nunca é tratada como interna por conveniência.

## Em listagem

- O **servidor declara** na resposta (`idGlobal: { tipoEntidade, rotulo }`). O cliente não
  tem catálogo de entidades: uma segunda lista no front envelheceria na primeira entidade
  nova, e a tela nasceria sem a coluna sem nada quebrar.
- Enriquecimento em **lote**: uma consulta por página (`= any($n)`), nunca uma por linha.
  A porta de detalhe faz autorização completa de UM registro; chamá-la por linha é N+1.
- A coluna é **identidade**, fora das preferências de coluna do usuário, sem filtro e sem
  ordenação (o número mora em outra tabela; prometer ordenação seria prometer o que o
  backend não faz). Se ela fica fixa à esquerda, e com que grafia o número aparece, é
  decisão de UX do contrato vigente — pode mudar por fatia explícita e NÃO é invariante
  de identidade.
- `id_global: null` é resposta legítima (acervo anterior ao backfill, efeito interno
  declarado) e aparece como traço — nunca como número improvisado.

## Elegibilidade

O catálogo é central e único. Nunca espalhe `if` de elegibilidade pelas rotas, e nunca
crie uma segunda lista de "quais telas têm número" no cliente.

## Produção

O ID Global só é "ativo em produção" depois do checkpoint completo, nesta ordem:
merge → migration aplicada → API nova implantada → backfill até `faltando = 0` →
verificação verde → smoke do número na tela. Afirmar antes disso, em documento, PR ou
relatório, é declarar pronto o que ainda não está.

## Apresentação não é identidade

O que este contrato fixa é o PAPEL do número: localizador humano, por organização, que não
endereça e não autoriza. A forma de exibir — prefixo, largura, posição na grade, se a coluna
fica presa à esquerda — é política de interface e muda por fatia explícita, como qualquer
outra decisão de UX.

Confundir as duas coisas tem custo real: uma mudança de apresentação passaria a parecer
quebra de contrato, e a fatia que a fizesse teria de argumentar contra este documento em vez
de simplesmente mudar a tela. `docs/GLOBAL-ID-CONTRACT.md` é o SSOT do contrato; a decisão de
apresentação vigente mora nele e nas decisões de `docs/DECISIONS.md`, não aqui.
