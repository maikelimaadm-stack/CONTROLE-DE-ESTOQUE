"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge, Button, Dialog, LoadingState } from "@/components/ui";
import { MensagemTop, podeLancar } from "./tipo-operacao-select";
import { useTopsDeVendas, type GrupoDeTops } from "./variantes";

/**
 * O `+ NOVO` DO PORTAL DE VENDAS — A OPERAÇÃO PRIMEIRO, O DOCUMENTO DEPOIS.
 *
 * ┌─ POR QUE NÃO PERGUNTAR "ORÇAMENTO / PEDIDO / VENDA" ───────────────────────────────────────────┐
 * │ Perguntar a VARIANTE primeiro obriga o usuário a traduzir a operação que ele quer fazer ("venda │
 * │ de gado a prazo") para o nome da TABELA em que ela cai. Quem sabe fazer essa tradução é o        │
 * │ produto, não o vendedor: a família da TOP escolhida JÁ DIZ em que documento a operação nasce.    │
 * │                                                                                                  │
 * │ Então o lançador oferece o que a organização configurou — as TOPs que o usuário pode lançar,     │
 * │ agrupadas por família — e a escolha decide sozinha a porta (`/vendas/<segmento>/new`). Nenhum    │
 * │ mapa de família mora aqui: a variante vem do registry (`variantesDeVenda`) e o rótulo do grupo,  │
 * │ do catálogo de idioma. Uma família nova aparece sem que esta tela seja tocada.                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ESCOLHER AQUI NÃO AUTORIZA NADA ──────────────────────────────────────────────────────────────┐
 * │ A escolha vira `?tipo_operacao_id=<uuid>` na rota de lançamento, e lá o `LancadorDeTipoOperacao` │
 * │ reconfere o id contra a lista que o SERVIDOR devolve para AQUELA variante. Pedido de URL é       │
 * │ pedido, nunca autoridade — inclusive quando quem montou a URL foi esta tela.                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O BLOQUEIO CONTINUA SENDO O MESMO ────────────────────────────────────────────────────────────┐
 * │ Grupo cuja lista o servidor não confirmou (API anterior a esta fatia, ou com defeito) NÃO vira   │
 * │ atalho para o formulário: ele mostra a mesma mensagem única de `MensagemTop`. Abrir o            │
 * │ lançamento assim mesmo devolveria o documento sem TOP que a capability existe para impedir.      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
function Grupo({ grupo, onEscolher }: { grupo: GrupoDeTops; onEscolher: (segmento: string, tipoOperacaoId: string) => void }) {
  const estado = grupo.estado;
  return <section data-testid="lancador-grupo" data-familia={grupo.variante.familia} className="space-y-2">
    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{grupo.rotulo}</h3>
    {estado.situacao === "carregando" && <LoadingState label="Carregando os tipos de operação…" />}
    <MensagemTop estado={estado} />
    {podeLancar(estado) && <ul className="space-y-1.5">
      {estado.dados.items.map((top) => <li key={top.id}>
        <button
          type="button"
          data-testid="lancador-top"
          data-top-id={top.id}
          className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-left transition hover:border-brand-600 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          onClick={() => onEscolher(grupo.variante.segmento, top.id)}
        >
          <span className="font-mono text-sm font-semibold text-slate-900">{top.code}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{top.name}</span>
          {top.isDefault && <Badge>Padrão</Badge>}
        </button>
      </li>)}
    </ul>}
  </section>;
}

export function LancadorUnificadoDeVendas() {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  // Só os grupos que o usuário pode LANÇAR. Sem nenhum, o botão não existe: oferecer "Novo" a quem não
  // pode criar nada é oferecer uma porta fechada.
  const grupos = useTopsDeVendas().filter((g) => g.habilitado);
  if (!grupos.length) return null;
  return <>
    <button type="button" className="tb-btn is-primary" data-testid="vendas-novo" aria-haspopup="dialog" aria-expanded={aberto} onClick={() => setAberto(true)}>
      <Plus className="h-3.5 w-3.5" /> Novo
    </button>
    <Dialog open={aberto} onOpenChange={setAberto} title="Novo lançamento" size="sm" testId="lancador-unificado"
      footer={<Button variant="outline" onClick={() => setAberto(false)}>Voltar</Button>}>
      <div className="space-y-4" data-testid="lancador-unificado-grupos">
        <p className="text-sm text-slate-600">Selecione a operação. Ela define em que documento o lançamento nasce.</p>
        {grupos.map((g) => <Grupo key={g.variante.variante} grupo={g} onEscolher={(segmento, id) => { setAberto(false); router.push(`/vendas/${segmento}/new?tipo_operacao_id=${id}`); }} />)}
      </div>
    </Dialog>
  </>;
}
