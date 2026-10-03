import { expect, type Locator, type Page } from "@playwright/test";
import { api, empresaAtiva, uniq } from "./helpers";
import { referenciasDoSeed } from "./central-compras-fixtures";
import { saldoInicial, sqlE2e } from "./f10-comum";

/**
 * AS PEÇAS COMUNS DOS E2E DA PECUÁRIA E DA RAÇÃO DA OPERACOES-01 F10 (decisão 287) — manejo, batelada, produção de
 * ração e os dois sentidos do skew deles. Módulo de apoio (não é spec: nenhuma config o roda); aqui não há `test(...)`.
 *
 * Cada caso cria os PRÓPRIOS cadastros pela API (local de estoque, produto, lote de animais, animais, rebanho), com nome
 * único, e o saldo pela porta do estoque inicial — a conta nunca depende do que outro spec deixou no banco. Nada é
 * apagado (decisão 247): o que o teste cria fica. O banco só é LIDO (`sqlE2e`): os ids globais do seed que a API não
 * lista (espécie, categoria, tipo de identificação, a dieta do seed) e a testemunha do que o servidor gravou.
 */

/** Um local de estoque NOVO da empresa (sigla única: a sigla é única por empresa). */
export async function localNovo(page: Page, empresa: string, rotulo: string): Promise<{ id: string; nome: string }> {
  const nome = uniq(`F10 ${rotulo}`);
  const criado = await api<{ id: string }>(page, "POST", "/api/resources/warehouses", {
    empresa_id: empresa, initials: `F${Date.now().toString(36).slice(-6).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`, description: nome, type: "inputs"
  });
  expect(criado.id, `premissa: o local "${nome}" foi criado`).toBeTruthy();
  return { id: criado.id, nome };
}

/** Um produto NOVO que controla estoque, sem lote (o padrão do cadastro); `extra` acrescenta campos (ex.: a carência). */
export async function produtoNovo(page: Page, rotulo: string, extra: Record<string, unknown> = {}): Promise<{ id: string; nome: string }> {
  const seed = await referenciasDoSeed(page);
  const nome = uniq(`F10 ${rotulo}`);
  const criado = await api<{ id: string }>(page, "POST", "/api/resources/products", {
    description: nome, group_id: seed.grupo.id, measurement_id: seed.unidade.id, financial_category_id: seed.natureza.id, ...extra
  });
  const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${criado.id}`);
  expect(lido["control_stock"], `premissa: o produto "${nome}" controla estoque`).toBe(true);
  return { id: criado.id, nome };
}

/** Produto novo com saldo SÓ deste caso no local dado (o estoque inicial confirmado, ao custo pedido). */
export async function produtoComSaldo(page: Page, c: { empresa: string; local: string; rotulo: string; quantidade: string; custo: string; extra?: Record<string, unknown> }) {
  const produto = await produtoNovo(page, c.rotulo, c.extra);
  await saldoInicial(page, { empresa: c.empresa, local: c.local, produto: produto.id, quantidade: c.quantidade, custo: c.custo });
  expect(sqlE2e(`select coalesce(sum(quantity), 0) = '${c.quantidade}'::numeric from erp.stock_balances where warehouse_id = '${c.local}' and product_id = '${produto.id}'`),
    `premissa: o par (local × "${produto.nome}") tem só o saldo deste caso`).toBe("t");
  return produto;
}

/** Os ids GLOBAIS do seed de pecuária (espécie, categoria, tipo de identificação), lidos do banco: a API não os lista. */
export function referenciasDaPecuaria(): { especie: string; categoria: string; identificacao: string } {
  const especie = sqlE2e("select id from erp.animal_species where organization_id is null and name = 'Bovinos de Corte'");
  const categoria = sqlE2e(`select id from erp.animal_categories where species_id = '${especie}' and name = 'Garrote'`);
  const identificacao = sqlE2e("select id from erp.identification_types where organization_id is null and name = 'Brinco de Manejo'");
  const uuid = /^[0-9a-f-]{36}$/;
  expect([especie, categoria, identificacao], "premissa: o seed tem a espécie, a categoria Garrote e o Brinco de Manejo").toEqual([expect.stringMatching(uuid), expect.stringMatching(uuid), expect.stringMatching(uuid)]);
  return { especie, categoria, identificacao };
}

/** Um lote de animais NOVO da empresa, vazio. */
export async function loteDeAnimaisNovo(page: Page, empresa: string, rotulo: string): Promise<{ id: string; nome: string }> {
  const { especie } = referenciasDaPecuaria();
  const nome = uniq(`F10 ${rotulo}`);
  const criado = await api<{ id: string }>(page, "POST", "/api/resources/batches", { empresa_id: empresa, batch_date: "2026-09-01", description: nome, species_id: especie, batch_type: "pasture" });
  expect(criado.id, `premissa: o lote de animais "${nome}" foi criado`).toBeTruthy();
  return { id: criado.id, nome };
}

/** `n` animais identificados, ativos, no lote dado (identificação `<marca>-<i>`). Devolve os ids na ordem de criação. */
export async function animaisNovos(page: Page, c: { empresa: string; lote: string; n: number; marca: string }): Promise<string[]> {
  const ref = referenciasDaPecuaria();
  const ids: string[] = [];
  for (let i = 1; i <= c.n; i++) {
    const a = await api<{ id: string }>(page, "POST", "/api/livestock/animals", {
      empresa_id: c.empresa, species_id: ref.especie, category_id: ref.categoria, batch_id: c.lote, sex: "M", entry_date: "2026-09-01",
      identifications: [{ identification_type_id: ref.identificacao, value: `${c.marca}-${i}` }]
    });
    ids.push(a.id);
  }
  expect(sqlE2e(`select count(*) from erp.animals where batch_id = '${c.lote}' and status = 'active' and deleted_at is null`), "premissa: o lote tem só os animais deste caso").toBe(String(c.n));
  return ids;
}

/** Um rebanho POR CONTAGEM (não identificado) com `cabecas` cabeças, no lote dado. */
export async function rebanhoNovo(page: Page, c: { empresa: string; lote: string; cabecas: number }): Promise<string> {
  const ref = referenciasDaPecuaria();
  const r = await api<{ herd_lot_id: string; quantity: number }>(page, "POST", "/api/livestock/animals", {
    empresa_id: c.empresa, species_id: ref.especie, category_id: ref.categoria, batch_id: c.lote, entry_date: "2026-09-01", type: "unidentified", quantity: c.cabecas
  });
  expect(r.quantity, "premissa: o rebanho nasceu com as cabeças pedidas").toBe(c.cabecas);
  return r.herd_lot_id;
}

/** A dieta do seed ("Dieta Adaptação": 60% ração, 40% sal) — os ingredientes lidos do banco, na ordem da descrição do produto. */
export function dietaDoSeed(): { id: string; nome: string; ingredientes: { produto: string; nome: string; percentual: string }[] } {
  const id = sqlE2e("select id from erp.diets where code = 'D01' and deleted_at is null order by created_at limit 1");
  expect(id, "premissa: o seed tem a dieta D01").toMatch(/^[0-9a-f-]{36}$/);
  const nome = sqlE2e(`select name from erp.diets where id = '${id}'`);
  const linhas = sqlE2e(`select i.product_id || '|' || p.description || '|' || i.percentage::numeric(7,2)::text from erp.diet_items i join erp.products p on p.id = i.product_id where i.diet_id = '${id}' order by p.description, i.id`)
    .split("\n").filter(Boolean).map((l) => { const [produto, nomeProduto, percentual] = l.split("|"); return { produto: produto!, nome: nomeProduto!, percentual: percentual! }; });
  expect(linhas.map((l) => l.percentual), "premissa: a dieta do seed é 60/40").toEqual(["60.00", "40.00"]);
  return { id, nome, ingredientes: linhas };
}

/** A empresa da Central (a mesma regra do `useEmpresaPadrao`) e um local novo dela. */
export async function empresaELocal(page: Page, rotulo: string) {
  const empresa = await empresaAtiva(page);
  const local = await localNovo(page, empresa, rotulo);
  return { empresa, local };
}

/** Escolhe num RefSelect DENTRO de um invólucro (o painel do Radix, o último aberto) pelo nome único. */
export async function escolherNoCampo(page: Page, campo: Locator, nome: string) {
  await campo.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome);
  await painel.getByRole("option", { name: new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first().click();
  await expect(campo, "o campo mostra a escolha").toContainText(nome);
}
