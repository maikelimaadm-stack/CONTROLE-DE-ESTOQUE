# Contrato do Tipo de Operação (TOP)

> Contrato de produto (BASE2-02). Registry: `packages/domain/src/tipo-operacao.ts`.
> Rótulos: `packages/plataforma/src/idiomas/pt-BR.ts` (`top.*`).
> Referências: `packages/domain/dicionario-dados.mjs` (campos `top` / `tops` / `discriminadorTop`).
> Gate: `packages/domain/test/tipo-operacao.test.ts` e `node scripts/data-dictionary.mjs --check`.

## 1. O que a TOP é

**Tipo de Operação é a classificação funcional de um lançamento.** Ela responde a uma pergunta só:

> *que operação é este registro?*

Uma entrada de insumos é `estoque.entrada_manual`. Um título financeiro com `direction = "payable"` é
`financeiro.conta_a_pagar`. Uma transferência com `kind = "farm"` é `estoque.transferencia_entre_empresas`.

A TOP é **declarativa e estática**: uma lista em código, versionada em Git, lida por quem precisa
apresentar ou auditar a classificação. Ela existe porque essa resposta já era dada — em prosa, dentro do
dicionário de dados, sem chave e sem ninguém que a lesse — e prosa não tem unicidade, não resolve e não
reprova quando diverge.

## 2. O que a TOP não é

**CLASSIFICAR ≠ EXECUTAR.** Esta é a regra central, e ela não tem exceção nesta fase.

| A TOP **não** decide | Quem decide, hoje e nesta fatia |
| --- | --- |
| Efeito de estoque | o serviço da rota (`apps/api/src/routes/stock.ts`, `postStock`) |
| Geração financeira | o serviço do módulo financeiro |
| Tratamento fiscal e contábil | os serviços dos módulos correspondentes |
| Endpoint / rota de API | `apps/api/src/routes/*` |
| Rota de tela | `apps/web/nav.registry.mjs` e o catálogo de ID Global |
| Permissão / capacidade | `packages/domain/src/permissions.ts` + `runService` |
| Escopo de empresa | `packages/domain/src/escopo-permissao.ts` + RLS |
| Validação de campo e obrigatoriedade | o schema zod da rota |
| Transação, idempotência, `version` | `runService` |
| Cancelamento e confirmação | a máquina de estados do módulo |
| Situação do registro | a coluna `status` e os rótulos de enum |
| Layout da tela | o Modelo Base 2 e o módulo dono |

Declarado sem rodeio, para não precisar de interpretação:

- **TOP NÃO é tabela de banco** nesta fatia. Não existe `erp.tipos_operacao`, não existe `top_id`, e
  nenhum documento persiste a sua TOP.
- **TOP NÃO é configuração editável.** Não há CRUD, não há tela administrativa, não há editor.
- **TOP NÃO é permission key.** Nenhum código de TOP termina em `.view`/`.create`/`.edit`/`.delete`, e o
  teste de contrato reprova quem tentar.
- **TOP NÃO é endpoint** nem **service**. Não existe `/api/top`, `/api/tipos-operacao`, `/api/base2`.
- **TOP NÃO é situação (status).** Situação muda com o tempo; a operação é o que o registro sempre foi.
- **TOP NÃO é ID Global.** O ID Global localiza um registro dentro da organização; a TOP diz que espécie
  de operação ele é. Um é endereço humano, o outro é classe.
- **TOP NÃO é módulo.** O módulo é o dono; a TOP é uma das operações dele.
- **TOP NÃO é movimento de ledger.** `erp.stock_movements` é a **consequência** de uma operação, não uma
  operação — e por isso nunca recebe TOP.
- **TOP NÃO é posting engine, workflow engine, layout engine nem motor de campos.**

Regra de negócio continua onde está. Nada foi movido para o registry, e mover seria a falha que este
contrato existe para impedir.

## 3. Chave canônica

Forma: `<modulo>.<operacao>` — minúsculas, `_` como separador interno, sem acento, sem espaço, sem hífen.

```
estoque.entrada_manual
financeiro.conta_a_pagar
estoque.transferencia_entre_empresas
```

- A chave é **estável** e é a identidade da TOP em código, teste e dicionário.
- O `<modulo>` é uma chave de `MODULOS_ESCOPO_EMPRESA` — o mesmo vocabulário do escopo de empresa, não um
  segundo conjunto de nomes de módulo.
- **Rótulo humano nunca é chave.** "Conta a pagar" muda com revisão de texto e com idioma; a chave não.
- A chave **não aparece na tela**. O usuário vê o rótulo; a chave é da máquina.

## 4. Entidade e variante

A origem de uma TOP é o registro que ela classifica:

| Caso | Declaração | Exemplo |
| --- | --- | --- |
| A tabela inteira é uma operação | `tabela` | `erp.input_entries` → `estoque.entrada_manual` |
| A tabela tem variantes | `tabela` + `discriminador` + `valor` | `erp.financial_titles` + `direction` + `payable` |

**Variante não se colapsa.** Conta a pagar e conta a receber têm efeito financeiro oposto; orçamento,
pedido e venda são etapas distintas; transferência entre armazéns e entre empresas diferem exatamente na
fronteira que o contrato multiempresa protege. Antes desta fatia, as duas primeiras viviam numa string só
("Conta a pagar / Conta a receber") — a forma mais silenciosa de perder uma distinção real.

O **valor do discriminador é o dado como o banco o persiste**, nunca traduzido: `payable`, `budget`,
`farm`. O `farm` da transferência é nome herdado do nicho anterior e sai por governança de dados, não por
renomeação de chave nossa — trocá-lo aqui mentiria sobre o que está gravado.

**Variante de operação ≠ variante de rota.** O título financeiro tem duas rotas e duas operações; a
transferência tem **uma** rota e **duas** operações. Os dois eixos coincidem às vezes, e tratá-los como um
só apagaria justamente o caso em que não coincidem. Por isso o dicionário declara `discriminador` (rota) e
`discriminadorTop` (operação) separadamente.

## 5. Relação com o Modelo Base 2

O Modelo Base 2 **apresenta** a TOP; ele não a resolve e não a conhece.

- A resolução acontece no **módulo dono da tela** (`apps/web/src/features/docs/stock-detail.tsx`), que
  chama `tipoOperacaoDoRegistro(tabela, registro)` e entrega ao shell **texto já pronto**.
- `Base2Shell` não recebe código de TOP, não recebe enum de TOP e não tem `if (top === …)`. Ele recebe um
  campo como qualquer outro. É o mesmo molde da empresa do registro, que também chega resolvida.
- **Tela unificada ≠ regra de negócio unificada.** A moldura mostra sete documentos com a mesma estrutura;
  isso não funde as sete regras, e a TOP não é a porta por onde elas seriam fundidas.
- Registro cuja TOP não resolve **não exibe o campo**. A tela cala em vez de afirmar a operação errada.

## 6. Relação com i18n

O registry guarda a **chave** de tradução (`chaveI18n`), derivada do código: `top.<codigo>`. O texto pt-BR
mora **só** no catálogo oficial.

Guardar um `rotulo` literal no registry criaria dois textos para o mesmo conceito, e o segundo envelheceria
em silêncio. Por isso a definição de TOP **não tem campo de rótulo** — e o gate do registry reprova uma TOP
cuja chave não exista no catálogo.

Consequências, todas exigidas por `docs/I18N-CONTRACT.md`:

- a chave canônica **não muda** com o idioma;
- tradução **nunca** é persistida;
- a tela resolve pelo tradutor oficial (`useTradutor()`), sem `switch` de rótulo e sem mapa literal.

## 7. Relação com o dicionário de dados

O dicionário **referencia**; ele não define. O campo `top` (ou `tops`, quando há variantes) passou a ser a
chave canônica, e o formato do dicionário subiu para a **versão 2** por isso — quem lia esperando uma frase
em português passa a receber `estoque.entrada_manual`.

Onde cada regra é cobrada:

| Regra | Onde reprova |
| --- | --- |
| Forma da chave (nada de texto livre) | validador do dicionário (`pnpm lint`) |
| `top` × `tops` mutuamente exclusivos; `tops` exige `discriminadorTop` e ≥ 2 variantes | validador do dicionário |
| Só entidade recebe TOP (linha e infraestrutura nunca) | validador do dicionário |
| A mesma TOP não classifica duas entidades | validador do dicionário |
| `discriminadorTop` é coluna existente da tabela | validador do dicionário (contra o schema real) |
| A chave **existe** no registry | teste de contrato (`packages/domain/test/tipo-operacao.test.ts`) |
| A TOP referenciada aponta de volta para a **mesma** tabela | teste de contrato |
| Integridade do registry (código, módulo, rótulo, origem, unicidade) | `validarRegistroTipoOperacao()` |

A separação tem motivo: o dicionário é `.mjs` sem build e roda no `lint`; o registry é TypeScript e é lido
pelo teste sem depender de `dist`. As duas metades rodam no mesmo job de CI.

O documento gerado (`docs/DATA-DICTIONARY.md`) mostra **chave + rótulo resolvido**, e nunca é editado à mão.

## 8. Autoridade das regras atuais

Nenhuma regra mudou de dono nesta fatia. Endpoint, serviço, permissão, validação, transação e efeito
continuam exatamente onde estavam, e a suíte inteira do repositório continua verde sem alteração de
contrato de API.

Se um dia uma regra precisar consultar a TOP, a consulta é **do serviço para o registry**, e o serviço
continua sendo quem decide. O registry nunca chama o serviço.

## 9. Evolução futura

O que **pode** vir, em fatia própria, com contrato e migration próprios:

- contratos **declarativos** de campos visíveis/obrigatórios por operação;
- contratos declarativos de efeito (estoque, financeiro, fiscal) — declarativos, lidos por motores que já
  existem, não um motor novo que passe a decidir;
- persistência da TOP em documentos novos, se houver necessidade real de consultá-la no banco;
- cobertura das entidades ainda não classificadas.

O que **não** vem por conveniência: motor genérico criado cedo demais vira acoplamento irreversível — é a
frase que `docs/PRE-BASE2-FOUNDATION.md` §4 já registrava antes de existir uma linha de TOP.

Hoje a cobertura é **parcial e deliberada**: entram os sete documentos do piloto Base 2 e as entidades que
o dicionário já classificava. Entidade que não se sabe classificar **não entra** — TOP inventada é pior que
ausência, porque a ausência se vê.

## 10. Anti-padrões

| Anti-padrão | Por que é proibido |
| --- | --- |
| `switch (top)` decidindo efeito, imposto ou lançamento contábil | é o posting engine entrando pela porta dos fundos |
| Campo `handler`, `endpoint`, `service`, `efeitos` ou `permissao` na definição | a definição passa a executar; o teste de contrato reprova |
| Usar o rótulo como chave | rótulo muda com revisão de texto e com idioma |
| Fallback para a TOP vizinha, ou para a primeira variante | a tela afirmaria com confiança uma operação que não é a do registro |
| Derivar a TOP da rota, do título, da permissão ou do endpoint | é inferir classificação de apresentação; `.claude/rules/security.md` já proíbe o equivalente para módulo |
| Heurística por `includes`, prefixo ou nome parecido | classificação tem de ser declarada, não adivinhada |
| Segunda lista de TOPs (no web, na API, num `.mjs` paralelo) | a segunda lista não fica desatualizada com barulho: envelhece em silêncio |
| TOP em linha de item, em infraestrutura ou em movimento de ledger | não são lançamentos; movimento é consequência de um |
| Colapsar variantes numa TOP só | apaga uma distinção funcional real |
| TOP autorizando ou escondendo algo | autorização é capacidade × escopo, e não passa por aqui |
