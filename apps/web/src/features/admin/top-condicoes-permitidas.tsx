"use client";
/**
 * TOP-CONFIG-05 — CONDIÇÕES DE PAGAMENTO PERMITIDAS da versão (formato 3). Lista vazia = todas as condições.
 *
 * Mesma forma da lista de destinos do editor (seletor + "N de limite" + linhas com remover), com o seletor de
 * cadastro de sempre (`RefSelect` de `condicoes_pagamento`). O servidor é quem recusa condição inexistente,
 * inativa, repetida ou acima do limite; a tela só evita que o administrador monte o que seria recusado.
 *
 * DE ONDE VEM "código · nome": o `RefSelect` entrega no `onChange` a própria opção escolhida da lista
 * (`/api/resources/condicoes_pagamento/options` → `{ id, label (= nome), code }`), então nada é consultado por
 * item. Só se a opção não vier (contrato opcional do `onChange`) a condição ESCOLHIDA é lida uma vez pela mesma
 * rota e chave de cache que o `RefSelect` usa para o valor único — nunca uma consulta por item já na lista.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, Field } from "@/components/ui";
import { RefSelect, type Option } from "@/components/ui/ref-select";

/** Uma condição permitida em edição: identidade + o que a tela mostra. */
export interface CondicaoPermitidaEmEdicao { id: string; codigo: string; nome: string }

export interface PropsCondicoesPermitidasTop {
  valor: CondicaoPermitidaEmEdicao[];
  onChange: (v: CondicaoPermitidaEmEdicao[]) => void;
  desabilitado?: boolean;
  limite: number;
}

const RECURSO = "condicoes_pagamento";
const ROTULO = "Condições de pagamento permitidas";
const AJUDA = "Vazio: todas as condições são aceitas.";
const MSG_FALHA_LEITURA = "Não foi possível carregar a condição escolhida. Tente de novo.";

/** "código · nome"; sem código, só o nome. */
const textoDaCondicao = (c: CondicaoPermitidaEmEdicao) => (c.codigo ? `${c.codigo} · ${c.nome}` : c.nome);

export function CondicoesPermitidasTop({ valor, onChange, desabilitado = false, limite }: PropsCondicoesPermitidasTop): React.ReactElement | null {
  const queryClient = useQueryClient();
  const [lendo, setLendo] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  // a leitura de reserva é assíncrona: ao voltar, soma à lista ATUAL (o usuário pode ter removido algo no meio)
  const atual = React.useRef(valor);
  React.useEffect(() => { atual.current = valor; }, [valor]);

  const noLimite = valor.length >= limite;
  const adicaoTravada = desabilitado || noLimite || lendo;
  const ids = valor.map((c) => c.id);

  const incluir = (c: CondicaoPermitidaEmEdicao) => {
    const lista = atual.current;
    if (lista.some((x) => x.id.toLowerCase() === c.id.toLowerCase())) return;
    if (lista.length >= limite) return;
    onChange([...lista, c]);
  };

  const escolher = (id: string | null, opcao?: Option) => {
    setErro(null);
    if (!id || desabilitado) return;
    if (opcao) { incluir({ id, codigo: opcao.code ?? "", nome: opcao.label }); return; }
    setLendo(true);
    queryClient.fetchQuery({
      queryKey: ["option-one", RECURSO, id],
      queryFn: () => api<Record<string, unknown>>(`/api/resources/${RECURSO}/${encodeURIComponent(id)}`),
      staleTime: 60_000
    })
      .then((r) => incluir({ id, codigo: r["code"] == null ? "" : String(r["code"]), nome: String(r["nome"] ?? "") }))
      .catch(() => setErro(MSG_FALHA_LEITURA))
      .finally(() => setLendo(false));
  };

  const remover = (idAlvo: string) => {
    if (desabilitado) return;
    onChange(valor.filter((c) => c.id !== idAlvo));
  };

  return <div data-testid="top-condicoes-permitidas" className="col-span-12">
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="w-80" data-testid="top-condicoes-permitidas-adicionar" aria-disabled={adicaoTravada || undefined}>
        <Field label={ROTULO} span={12}>
          <RefSelect resource={RECURSO} value={null} onChange={escolher} allowEmpty={false} excluirIds={ids}
            disabled={adicaoTravada} placeholder={noLimite ? "Limite atingido" : "Adicionar condição…"} />
        </Field>
      </div>
      <span className="text-[11px] text-slate-500">{valor.length} de {limite}</span>
    </div>

    {noLimite && !desabilitado && <p data-testid="top-condicoes-permitidas-limite" className="mb-2 text-[12px] text-amber-700">
      Limite de {limite} condições atingido. Remova uma para adicionar outra.
    </p>}
    {erro && <p className="mb-2 text-[12px] text-red-600">{erro}</p>}

    {valor.length === 0
      ? <p data-testid="top-condicoes-permitidas-vazio" className="rounded border px-2 py-1.5 text-[12.5px] text-slate-500">Todas as condições</p>
      : <ul className="divide-y rounded border">
          {valor.map((c) => <li key={c.id} data-testid={`top-condicao-permitida-${c.id}`} className="flex items-center gap-2 px-2 py-1.5 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate font-medium">{textoDaCondicao(c)}</span>
            <Button size="sm" variant="ghost" data-testid={`top-condicao-permitida-remover-${c.id}`} aria-label={`Remover condição ${c.nome}`}
              disabled={desabilitado} onClick={() => remover(c.id)}>✕</Button>
          </li>)}
        </ul>}

    <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">{AJUDA}</p>
  </div>;
}
