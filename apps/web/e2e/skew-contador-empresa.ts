import { expect, type APIRequestContext } from "@playwright/test";

/**
 * O CONTADOR DE EMPRESA, MEDIDO NOS DOIS SENTIDOS DO SKEW (PRE-BASE2-05C-0).
 *
 * O que a PRE-BASE2-05C-1 arrisca não é a leitura: é a NUMERAÇÃO. O código de uma Empresa é alocado por
 * `erp.next_code(organização, entidade)`, cuja chave primária é `(organization_id, entity)`. `'farm'` e
 * `'empresa'` não são dois nomes do mesmo contador: são DUAS LINHAS, dois travamentos e dois valores
 * correntes. Copiar a linha e manter as duas — o desenho que parece conservador — faz a API antiga e a API
 * nova emitirem O MESMO PRÓXIMO NÚMERO, e `unique (organization_id, code)` de `erp.empresas` recusa o
 * segundo. Na janela de rollout as duas APIs estão no ar ao mesmo tempo, que é exatamente quando isso dói.
 *
 * Por isso o instrumento nasce AQUI, uma fatia antes: a prova de skew deixa de ser só "a tela abre" e passa
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
