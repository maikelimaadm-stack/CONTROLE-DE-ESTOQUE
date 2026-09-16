import { expect, type APIRequestContext } from "@playwright/test";

/**
 * O CONTADOR DE EMPRESA, MEDIDO NOS DOIS SENTIDOS DO SKEW (PRE-BASE2-05C-0).
 *
 * O que a troca de contador arrisca não é a leitura: é a NUMERAÇÃO. Quem troca o contador é a
 * PRE-BASE2-05C-2 — a 05C-1 remove colunas e deixa `entity='farm'` intacto. Esta prova roda desde já, como
 * rede preventiva: ela não espera a fatia que muda o contador para existir. O código de uma Empresa é alocado por
 * `erp.next_code(organização, entidade)`, cuja chave primária é `(organization_id, entity)`. `'farm'` e
 * `'empresa'` não são dois nomes do mesmo contador: são DUAS LINHAS, dois travamentos e dois valores
 * correntes. Copiar a linha e manter as duas — o desenho que parece conservador — faz a API antiga e a API
 * nova emitirem O MESMO PRÓXIMO NÚMERO, e `unique (organization_id, code)` de `erp.empresas` recusa o
 * segundo. Na janela de rollout as duas APIs estão no ar ao mesmo tempo, que é exatamente quando isso dói.
 *
 * Por isso o instrumento nasce AQUI, duas fatias antes: a prova de skew deixa de ser só "a tela abre" e passa
 * a CRIAR UMA EMPRESA DE VERDADE em cada sentido, contra o MESMO banco, sem reset entre eles. O que se cobra
 * é a propriedade que a troca de contador quebraria primeiro:
 *
 *   • o cadastro é ACEITO (não há colisão de código);
 *   • o número gravado é MAIOR que todos os que já existiam (o contador só sobe);
 *   • nenhum número se REPETE na organização.
 *
 * Nada aqui fixa um valor esperado (`N === 3`): o banco do e2e é semeado e reutilizado, e um número fixo
 * viraria falha por acumulação em vez de prova de contrato. O que é invariante é a RELAÇÃO entre o que
 * existia e o que foi alocado — e é ela que a transição de contador viola.
 *
 * Lacuna é normal e NÃO é defeito: uma transação abortada consome o número. Por isso a asserção é
 * "estritamente maior", nunca "exatamente o próximo".
 */
export interface Empresa { id: string; code: number | string | null; name: string }

const codigos = async (request: APIRequestContext, api: string, auth: Record<string, string>): Promise<number[]> => {
  const r = await request.get(`${api}/api/resources/empresas?pageSize=200&sort=code&dir=asc`, { headers: auth });
  expect(r.status(), "a listagem de empresas responde nos dois sentidos do skew").toBe(200);
  const { items } = (await r.json()) as { items: Empresa[] };
  return items.map((e) => Number(e.code)).filter((n) => Number.isFinite(n));
};

/**
 * Cria uma Empresa de verdade e devolve o código alocado, já conferido contra o acervo anterior.
 * `rotulo` só entra no nome do registro, para que o cadastro criado diga de qual sentido veio.
 */
export async function criarEmpresaEConferirContador(
  request: APIRequestContext, api: string, auth: Record<string, string>, rotulo: string
): Promise<number> {
  const antes = await codigos(request, api, auth);
  // A premissa junto com a conclusão: sem acervo, "maior que todos" é verdade por vacuidade.
  expect(antes.length, "o banco do skew tem empresas semeadas — sem isso a comparação não prova nada").toBeGreaterThan(0);
  const maiorAntes = Math.max(...antes);

  const nome = `${rotulo} ${Date.now().toString(36)}`;
  const criado = await request.post(`${api}/api/resources/empresas`, { headers: auth, data: { name: nome, is_active: true } });
  expect(criado.status(), `a Empresa foi criada de verdade (${rotulo}) — corpo: ${await criado.text()}`).toBeLessThan(300);

  const depois = await codigos(request, api, auth);
  const novos = depois.filter((n) => !antes.includes(n));
  expect(novos, `exatamente um código novo apareceu (${rotulo})`).toHaveLength(1);
  const alocado = novos[0]!;

  expect(alocado, `o contador só sobe: ${alocado} tinha de ser maior que ${maiorAntes} (${rotulo})`).toBeGreaterThan(maiorAntes);
  expect(new Set(depois).size, `nenhum código se repete na organização (${rotulo}) — repetição é o sintoma de DOIS contadores`).toBe(depois.length);
  return alocado;
}

/**
 * O MESMO CENÁRIO, QUANDO A RESPOSTA CERTA É "NÃO FUNCIONA" (PRE-BASE2-05C-2).
 *
 * Numa PR que ATRAVESSA o cutover do contador, a combinação "API da base × banco deste HEAD" deixa de ser
 * a janela de rollout e passa a ser um estado PROIBIDO: a 0018 renomeou a chave persistida, e a API da base
 * ainda pede `next_code(org,'farm')`. Como `next_code` é `insert ... on conflict do update`, a chave que
 * não existe não produz erro — ela é CRIADA e devolve 1, dentro da transação do próprio pedido.
 *
 * NUMA ORGANIZAÇÃO COM ACERVO — que é o caso deste E2E — o `insert` colide com o
 * `unique (organization_id, code)` e a transação volta atrás inteira: o cadastro é recusado e o acervo
 * fica intacto. É exatamente essa dupla que as asserções abaixo cobram.
 *
 * O QUE ESTE ARQUIVO NÃO COBRE, de propósito: a organização SEM Empresa, em que não há colisão, o cadastro
 * COMITA a chave errada e o dano PERSISTE em silêncio. Aquilo é estado persistente, não comportamento
 * observável de uma resposta HTTP, e quem prova é `pnpm gate:05c2` (Q3b/Q4b), que inspeciona o banco
 * depois do commit. Os dois se complementam: aqui mede-se o que o BINÁRIO REAL responde; lá, o que SOBRA.
 *
 * Nesse cenário, exigir que o cadastro funcione seria exigir o impossível; e deixar o job passar assim
 * mesmo seria CERTIFICAR uma compatibilidade que não existe, que é pior do que não ter o job. Então a
 * prova se inverte: o que se cobra é que a combinação proibida FALHE, e que ela falhe do jeito previsto —
 * sem corromper a numeração de quem já existe.
 *
 * O que NÃO se cobra aqui é a mensagem exata nem o código HTTP específico: o que importa é que o cadastro
 * seja RECUSADO e que o acervo permaneça íntegro. Fixar o status amarraria a prova a um detalhe de
 * contrato que esta fatia não governa.
 */
export async function provarContadorIncompativel(
  request: APIRequestContext, api: string, auth: Record<string, string>, rotulo: string
): Promise<void> {
  const antes = await codigos(request, api, auth);
  expect(antes.length, "o banco do skew tem empresas semeadas — sem acervo não há colisão a provar").toBeGreaterThan(0);

  const criado = await request.post(`${api}/api/resources/empresas`, {
    headers: auth, data: { name: `${rotulo} ${Date.now().toString(36)}`, is_active: true },
  });
  expect(criado.status(),
    `a combinação PROIBIDA tinha de ser recusada (${rotulo}). Se ela passou, ou a 0018 não está aplicada `
    + "neste banco, ou o binário da base não é o da base — e, nos dois casos, o cenário medido não é o que "
    + `o nome do teste diz. Corpo: ${await criado.text()}`).toBeGreaterThanOrEqual(400);

  const depois = await codigos(request, api, auth);
  expect(depois, "e o acervo existente continua intacto — a recusa não pode ter renumerado ninguém").toEqual(antes);
  expect(new Set(depois).size, "nenhum código duplicado sobrou").toBe(depois.length);
}
