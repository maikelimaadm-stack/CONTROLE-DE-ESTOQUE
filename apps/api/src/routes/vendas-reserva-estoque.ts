/**
 * RESERVA DE ESTOQUE AO SALVAR O PEDIDO (TOP-CONFIG-07, decisão 266).
 *
 * A VERSÃO da TOP declara se o pedido reserva (`tipos_operacao_versoes.reserva_estoque`, 0035) e vale a versão
 * CONGELADA no documento. A conta do reservado mora no banco (`erp.reserva_estoque`) e a API a lê pelo helper
 * `services/reserva-estoque.ts`; aqui só se CONFERE, no salvamento, que o documento cabe no disponível:
 *
 *   a) PRIMEIRO, as linhas de TODOS os produtos do documento são travadas, em ordem de id — e a mesma instrução lê
 *      `control_stock`, então a decisão "controla ou não" é tomada sob a trava (abaixo);
 *   b) todo item de produto que controla estoque tem armazém;
 *   c) esse armazém é da empresa DO DOCUMENTO (no PUT, a gravada — o corpo não muda empresa);
 *   d) DEPOIS da trava (outra instrução, com a foto nova do READ COMMITTED): quantidade pedida por (armazém,
 *      produto) ≤ físico − reservado pelos OUTROS documentos. Não coube → 422 com uma linha por par. Sem reserva
 *      parcial: ou o documento inteiro cabe, ou nada é gravado.
 *
 * PRODUTO SEM CONTROLE DE ESTOQUE (`control_stock = false`: serviço, frete) FICA FORA de b, c e d. Ele não tem saldo
 * — `postStock` o recusa (PRODUCT_NOT_STOCK_CONTROLLED) —, então o disponível dele é sempre 0: exigir armazém e
 * disponível travava TODO pedido com serviço ou frete. A conta do banco (`erp.reserva_estoque_nucleo`) também não o
 * soma. Produto que a trava NÃO devolve (inexistente, de outro tenant) conta como CONTROLADO: fail closed, confere
 * tudo — e a FK do item o recusa ao gravar.
 *
 * A trava vem ANTES de b e c porque o flag tem de ser lido sob ela: `update erp.products` conflita com FOR NO KEY
 * UPDATE, então trocar o cadastro no meio do salvamento faz fila e não corre com a decisão. Validação que recusa
 * desfaz a transação inteira (trava junto) — para o cliente, nada muda.
 *
 * ┌─ A TRAVA (a) ────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ É a linha de `erp.products` que o gatilho de saldo (`trg_stock_movement_apply`, 0003) atualiza em TODA      │
 * │ entrada e saída. Com ela, salvar um pedido com reserva e movimentar o mesmo produto fazem fila: quem chega │
 * │ depois relê o estado que o primeiro deixou — o pedido vê o físico já baixado; a saída (gatilho da 0035) vê │
 * │ o pedido já reservando. Dois pedidos do mesmo produto também fazem fila, e o segundo conta o primeiro.     │
 * │                                                                                                            │
 * │ `for no key update`, e não `for update`: conflita com o `update erp.products` do gatilho (que toma NO KEY │
 * │ UPDATE — `average_cost` não é chave) e com outro pedido, mas NÃO com a FOR KEY SHARE que a chave          │
 * │ estrangeira toma quando um item de orçamento/venda/compra ou um movimento é INSERIDO citando o produto.   │
 * │ `for update` enfileiraria toda gravação de item do mesmo produto atrás do pedido — e, como os itens são   │
 * │ inseridos na ordem do documento e não na do id, abriria um ciclo de espera com qualquer documento de     │
 * │ vários produtos. A serialização que a regra precisa (pedido × saída, pedido × pedido) é a mesma.           │
 * │                                                                                                            │
 * │ Trava TODOS os produtos, inclusive os sem controle: travar a linha de um serviço não custa nada relevante  │
 * │ (o gatilho de saldo nunca a atualiza) e é o que segura o flag lido até o commit.                           │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * CUSTO: documento que não reserva paga no máximo UMA consulta (o flag da versão); o que reserva paga mais quatro
 * — trava (que já traz o nome e o `control_stock` do produto), armazéns, físico e reservado — por documento inteiro,
 * nunca por item. Documento em que NENHUM item controla estoque para na trava: uma consulta, sem armazém nem saldo.
 */
import { D, DomainError, type Decimal } from "@agro/shared";
import type { ServiceCtx } from "../lib/context.js";
import { err } from "../lib/errors.js";
import { quantidadeLegivel } from "../services/stock-core.js";
import { chaveDoPar, saldoComReservaEmLote, MAX_PARES_POR_CHAMADA, type ParDeEstoque, type SaldoDoPar } from "../services/reserva-estoque.js";

export const MSG_RESERVA_ARMAZEM_OBRIGATORIO = "Informe o local de estoque: esta operação reserva estoque.";
export const MSG_RESERVA_ARMAZEM_DE_OUTRA_EMPRESA = "O local de estoque não é da empresa do documento.";
/** A parte gerada de pedido com reserva mantém o armazém do item de origem (ver o PUT da venda em sales.ts). */
export const MSG_PARTE_RESERVA_ARMAZEM = "O local de estoque deste item vem do pedido de origem, que reserva estoque no local de estoque de cada item: não pode ser trocado. Para mudar, cancele esta venda e gere de novo.";

/** A trava (a): exportada para a suíte provar o modo contra o gatilho de saldo e contra a FK (ver o cabeçalho). */
export const SQL_TRAVA_PRODUTOS = "select id, description, control_stock from erp.products where organization_id = $1 and id = any($2::uuid[]) order by id for no key update";

/** O item como o salvamento o conhece (depois do zod). */
export interface ItemParaReserva { product_id: string; warehouse_id?: string | null; quantity: string }

/**
 * A versão reserva estoque? UMA consulta. Versão que não se lê é corrupção (a FK composta da 0021 e a RLS do mesmo
 * tenant a tornam inalcançável enquanto o documento é visível): recusa, nunca "então não reserva" — o mesmo
 * contrato de `politicaDaVenda` e `politicaDeDestinos`.
 */
export async function versaoReservaEstoque(ctx: ServiceCtx, versaoId: string): Promise<boolean> {
  const r = await ctx.tx.query<{ reserva_estoque: boolean }>(
    "select reserva_estoque from erp.tipos_operacao_versoes where id = $1 and organization_id = $2", [versaoId, ctx.orgId]);
  const linha = r.rows[0];
  if (!linha) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este documento");
  return linha.reserva_estoque === true;
}

/**
 * A venda nasceu de pedido com reserva? UMA consulta, só quando a venda tem origem. É a mesma pergunta que a parte B
 * da conta faz no banco (`erp.reserva_estoque_nucleo`): origem de espécie pedido cuja versão congelada reserva —
 * sem olhar status nem exclusão da origem, porque a conta também não olha.
 */
export async function origemReservaEstoque(ctx: ServiceCtx, origemId: string): Promise<boolean> {
  const r = await ctx.tx.query<{ reserva_estoque: boolean }>(
    `select v.reserva_estoque
       from erp.sales_documents o
       join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
      where o.id = $1 and o.organization_id = $2 and o.kind = 'order'`, [origemId, ctx.orgId]);
  return r.rows[0]?.reserva_estoque === true;
}

/**
 * Número para a mensagem: vírgula decimal, sem zeros à direita — o MESMO formatador da pré-conferência da confirmação
 * (A2) e o mesmo formato do gatilho da 0035, para que as três recusas da reserva escrevam o número igual.
 */
const numeroLegivel = (v: Decimal | string) => quantidadeLegivel(D(v).toFixed(4));

/**
 * A CONFERÊNCIA (a → d, nesta ordem). `excluirDocumentoId` tira da conta o próprio documento: o pedido sendo
 * editado (a parte A dele) ou a venda sendo editada (a parte B dela) — salvar de novo o que já estava reservado
 * não conta contra si mesmo. `null` na criação.
 */
export async function conferirReservaDoDocumento(ctx: ServiceCtx, entrada: { itens: readonly ItemParaReserva[]; empresaId: string; excluirDocumentoId: string | null }): Promise<void> {
  const { empresaId, excluirDocumentoId } = entrada;
  // Ids em MINÚSCULAS antes de virarem chave: o zod aceita UUID em maiúsculas e o banco devolve minúsculas. Sem isto,
  // o serviço em maiúsculas não se acharia em `semControle` (exigiria armazém), o par não se acharia no saldo lido
  // (403) e a linha do 422 perderia os nomes. Só a CONFERÊNCIA usa a cópia; o que se grava é o corpo, como veio.
  const itens = entrada.itens.map((it) => ({ ...it, product_id: it.product_id.toLowerCase(), warehouse_id: it.warehouse_id ? it.warehouse_id.toLowerCase() : null }));

  // a) a trava, em ordem de id (dois salvamentos do mesmo conjunto fazem fila em vez de travar um ao outro), em
  //    TODOS os produtos do documento. O nome e o `control_stock` do produto vêm na mesma instrução.
  const p = await ctx.tx.query<{ id: string; description: string; control_stock: boolean }>(SQL_TRAVA_PRODUTOS, [ctx.orgId, [...new Set(itens.map((it) => it.product_id))]]);
  const nomeDoProduto = new Map(p.rows.map((x) => [x.id, x.description]));
  // Só o `false` LIDO tira o item da reserva; produto não devolvido pela trava fica dentro (fail closed).
  const semControle = new Set(p.rows.filter((x) => x.control_stock === false).map((x) => x.id));
  // O índice é o do DOCUMENTO: o `path` do 422 aponta o item certo mesmo com serviço antes dele.
  const controlados = itens.flatMap((it, i) => semControle.has(it.product_id) ? [] : [{ it, i }]);
  if (controlados.length === 0) return;

  // b) todo item controlado com armazém — todas as linhas faltando no mesmo 422, cada uma no seu campo.
  const semArmazem = controlados.flatMap(({ it, i }) => it.warehouse_id ? [] : [{ path: `items[${i}].warehouse_id`, message: MSG_RESERVA_ARMAZEM_OBRIGATORIO }]);
  if (semArmazem.length) throw err("VALIDATION_ERROR", MSG_RESERVA_ARMAZEM_OBRIGATORIO, semArmazem);
  const armazemDe = (it: ItemParaReserva) => it.warehouse_id as string;

  // c) armazém da empresa do documento — uma consulta, só com os armazéns dos itens controlados; o nome do armazém
  //    vem junto (mensagem de d).
  const w = await ctx.tx.query<{ id: string; description: string }>(
    "select id, description from erp.warehouses where organization_id = $1 and empresa_id = $2 and id = any($3::uuid[])",
    [ctx.orgId, empresaId, [...new Set(controlados.map(({ it }) => armazemDe(it)))]]);
  const nomeDoArmazem = new Map(w.rows.map((x) => [x.id, x.description]));
  const foraDaEmpresa = controlados.flatMap(({ it, i }) => nomeDoArmazem.has(armazemDe(it)) ? [] : [{ path: `items[${i}].warehouse_id`, message: MSG_RESERVA_ARMAZEM_DE_OUTRA_EMPRESA }]);
  if (foraDaEmpresa.length) throw err("VALIDATION_ERROR", MSG_RESERVA_ARMAZEM_DE_OUTRA_EMPRESA, foraDaEmpresa);

  // d) DEPOIS da trava: a quantidade pedida somada por par, contra o disponível do par sem este documento.
  const pedidoPorPar = new Map<string, { par: ParDeEstoque; quantidade: Decimal }>();
  for (const { it } of controlados) {
    const par = { warehouseId: armazemDe(it), productId: it.product_id };
    const chave = chaveDoPar(par.warehouseId, par.productId);
    const atual = pedidoPorPar.get(chave);
    pedidoPorPar.set(chave, { par, quantidade: (atual?.quantidade ?? D(0)).plus(it.quantity) });
  }
  const pares = [...pedidoPorPar.values()].map((x) => x.par);
  const saldo = new Map<string, SaldoDoPar>();
  for (let k = 0; k < pares.length; k += MAX_PARES_POR_CHAMADA) {
    for (const [chave, s] of await saldoComReservaEmLote(ctx, pares.slice(k, k + MAX_PARES_POR_CHAMADA), excluirDocumentoId)) saldo.set(chave, s);
  }
  const linhas: string[] = [];
  for (const [chave, { par, quantidade }] of pedidoPorPar) {
    // Par sem saldo lido não existe (o físico devolve uma linha por par pedido); se existisse, valeria 0 — fail closed.
    const disponivel = saldo.get(chave)?.disponivel ?? "0";
    if (quantidade.lte(disponivel)) continue;
    linhas.push(`${nomeDoProduto.get(par.productId) ?? "Produto"} no local de estoque ${nomeDoArmazem.get(par.warehouseId) ?? ""}: disponível ${numeroLegivel(disponivel)}, pedido ${numeroLegivel(quantidade)}.`);
  }
  if (linhas.length) throw err("VALIDATION_ERROR", linhas.join("\n"), linhas.map((message) => ({ path: "items", message })));
}
