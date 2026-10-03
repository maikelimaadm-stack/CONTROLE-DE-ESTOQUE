"use client";
import { enumLabel } from "@/lib/copy";
import { useAuth } from "@/lib/auth";
import { brl, dateBR } from "@/lib/utils";
import { Field, NativeSelect } from "@/components/ui";
import type { EstadoDaConferencia } from "./estado";

/**
 * A ABA "PEDIDO" DA CONFERÊNCIA (OPERACOES-01 F7, decisão 284): sem pedido (o padrão quando a nota não aponta um pedido
 * deste fornecedor com saldo), ou um dos pedidos do fornecedor na empresa da compra, abertos ou finalizados e com saldo
 * — o que a nota aponta (xPed/nItemPed) vem escolhido. Com pedido, cada item da nota liga a um item do pedido (o que a
 * nota aponta, senão o único item do pedido com o mesmo produto). Receber o pedido muda o pedido: a porta pede também
 * `pedidos_compra.edit` — sem ela, nenhum pedido é oferecido. A operação de destino decide se o recebimento pode ser
 * em partes; a entrega parcial mantém o saldo do pedido.
 */
export function AbaPedido({ e }: { e: EstadoDaConferencia }) {
  const { can } = useAuth();
  const { conf, cab } = e;
  const leitura = !e.pendente;
  const podeReceber = can("pedidos_compra.edit");
  const candidatos = conf.pedidos.candidatos;
  const pedido = candidatos.find((p) => p.id === cab.pedidoId) ?? null;
  const foraDaLista = conf.pedidos.referenciados.filter((r) => !r.pedido || !candidatos.some((c) => c.id === r.pedido!.id));

  return <div data-testid="importacao-aba-pedido" className="flex flex-col gap-3">
    <p className="text-[12.5px] text-slate-600">Entrega parcial mantém o saldo do pedido; a operação de destino decide se o recebimento pode ser em partes.</p>
    {conf.pedidos.referenciados.length > 0 && <ul data-testid="importacao-pedidos-referenciados" className="text-[12px] text-slate-600">
      {conf.pedidos.referenciados.map((r) => <li key={r.xPed}>A nota cita o pedido <strong>{r.xPed}</strong>{r.pedido ? ` (${r.pedido.codigo} — ${enumLabel("situacao_documento_compra", r.pedido.situacao)})` : " — não encontrado entre os pedidos deste fornecedor nesta empresa"}.</li>)}
    </ul>}
    {foraDaLista.some((r) => r.pedido) && <p className="text-[12px] text-amber-800">Um pedido citado pela nota não tem saldo a receber (ou não está aberto nem finalizado): ele não é oferecido.</p>}
    <div className="grid grid-cols-12 gap-3">
      <Field label="Pedido de compra" span={8} error={e.erroEm("pedido_id")}>
        <NativeSelect data-testid="importacao-pedido" value={cab.pedidoId} disabled={leitura || !podeReceber} onChange={(ev) => e.mudarPedido(ev.target.value)}>
          <option value="">Sem pedido</option>
          {podeReceber && candidatos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {dateBR(p.dataDocumento)} — {brl(p.valorTotal)} ({enumLabel("situacao_documento_compra", p.situacao)})</option>)}
        </NativeSelect>
      </Field>
    </div>
    {!podeReceber && <p className="text-[12px] text-slate-500">Receber um pedido exige a permissão de editar pedidos de compra: a compra é gerada sem pedido.</p>}
    {podeReceber && candidatos.length === 0 && <p className="text-[12px] text-slate-500" data-testid="importacao-pedido-vazio">Nenhum pedido deste fornecedor com saldo nesta empresa.</p>}
    {pedido && <div className="flex flex-col gap-2">
      {conf.nota.itens.map((item) => {
        const d = e.itens.find((x) => x.nItem === item.nItem)!;
        return <div key={item.nItem} className="grid grid-cols-12 items-end gap-3">
          <span className="col-span-12 text-[12.5px] md:col-span-5">Item {item.nItem} — {item.descricao}</span>
          <Field label="Item do pedido" span={7} error={e.erroDoItem(item.nItem, "item_origem_id")}>
            <NativeSelect data-testid={`importacao-item-${item.nItem}-item-pedido`} value={d.itemOrigemId} disabled={leitura} onChange={(ev) => e.mudarItem(item.nItem, { itemOrigemId: ev.target.value })}>
              <option value="">Escolha o item do pedido</option>
              {pedido.itens.map((pi) => <option key={pi.id} value={pi.id}>{pi.posicao + 1} — {pi.produtoDescricao} — saldo {pi.saldo} a {brl(pi.valorUnitario)}</option>)}
            </NativeSelect>
          </Field>
        </div>;
      })}
    </div>}
  </div>;
}
