"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { NativeSelect, Field } from "@/components/ui";
import type { Row } from "@/features/docs/shared";
import type { Column } from "@/components/ui/data-table";

/**
 * O SELETOR DE TIPO DE OPERAÇÃO DO PORTAL DE VENDAS — e a descoberta de capacidade que o protege.
 *
 * ┌─ POR QUE ISTO NÃO É "SÓ UM SELECT" ────────────────────────────────────────────────────────────┐
 * │ Durante um rolling deploy, a web NOVA pode conversar com a API ANTIGA por alguns minutos. O     │
 * │ schema de criação de vendas usa `z.object`, que DESCARTA chave desconhecida em silêncio: a web   │
 * │ mandaria `tipo_operacao_id`, a API antiga o ignoraria, o documento nasceria SEM TOP e o usuário  │
 * │ leria "salvo". Perda silenciosa de dado, sem erro em lugar nenhum.                               │
 * │                                                                                                  │
 * │ A API nova não pode consertar isso sozinha (o problema está na antiga), então quem se protege é  │
 * │ o cliente: ANTES de oferecer o formulário, ele pergunta se o endpoint operacional existe. Se a   │
 * │ resposta for 404, a API ainda é antiga — e a tela BLOQUEIA a escrita em vez de arriscar.         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * As TOPs vêm da porta OPERACIONAL (`/api/sales/<variante>/operation-types`), nunca da administrativa:
 * quem pode vender não precisa poder configurar tipos de operação.
 */

export interface TopOperacional { id: string; code: string; name: string; version: number; isDefault: boolean }
export interface TopsDaVariante { contractVersion: number; family: { code: string; label: string }; defaultId: string | null; items: TopOperacional[] }

/** O que a tela precisa decidir. Três situações distintas, três mensagens distintas — nunca uma só. */
export type EstadoTop =
  /** Ainda perguntando. */
  | { situacao: "carregando" }
  /** A API não conhece o endpoint: é ANTIGA. Bloquear escrita — o problema não é do usuário. */
  | { situacao: "servidor-desatualizado" }
  /** A API é nova e não há nenhuma TOP ativa da família: é configuração que falta. */
  | { situacao: "sem-top"; familia: string }
  /** Tudo certo. */
  | { situacao: "pronto"; dados: TopsDaVariante }
  /** Qualquer outra falha (rede, 403, 500): também bloqueia, mas não mente sobre a causa. */
  | { situacao: "erro"; mensagem: string };

/**
 * Pergunta ao servidor quais TOPs esta variante pode lançar.
 *
 * `retry: false` é deliberado: um 404 aqui é RESPOSTA (a API é antiga), não falha transitória, e
 * insistir só atrasaria a decisão da tela.
 */
export function useTopsDaVariante(kind: string, habilitado = true): EstadoTop {
  const q = useQuery<TopsDaVariante, ApiError>({
    queryKey: ["sales-operation-types", kind],
    queryFn: () => api<TopsDaVariante>(`/api/sales/${kind}/operation-types`),
    enabled: habilitado,
    retry: false
  });

  if (!habilitado || q.isPending) return { situacao: "carregando" };
  if (q.error) {
    // 404 é o discriminador do version skew: a rota não existe naquele binário.
    if (q.error.status === 404) return { situacao: "servidor-desatualizado" };
    return { situacao: "erro", mensagem: q.error.message };
  }
  if (!q.data || q.data.items.length === 0) return { situacao: "sem-top", familia: q.data?.family.label ?? "" };
  return { situacao: "pronto", dados: q.data };
}

/** A escrita pode acontecer? Só quando há TOP escolhível. Fail-closed em todos os outros estados. */
export const podeLancar = (e: EstadoTop): e is Extract<EstadoTop, { situacao: "pronto" }> => e.situacao === "pronto";

/** Mensagem única por estado — quem lê precisa saber se o problema é o servidor ou a configuração. */
export function MensagemTop({ estado }: { estado: EstadoTop }) {
  if (estado.situacao === "servidor-desatualizado") {
    // NÃO pedir para cadastrar TOP: o problema não é ausência de configuração, é incompatibilidade de
    // versão. Mandar o usuário à tela de Tipos de Operação aqui o faria cadastrar algo que não resolve.
    return <p data-testid="top-servidor-desatualizado" className="text-sm text-amber-700">
      Servidor sendo atualizado. Tente novamente em alguns instantes.
    </p>;
  }
  if (estado.situacao === "sem-top") {
    return <p data-testid="top-ausente" className="text-sm text-amber-700">
      Nenhum Tipo de Operação ativo está cadastrado para {estado.familia}. Cadastre um em{" "}
      <a className="underline" href="/configuracoes?tab=operacoes&sub=tipos-operacao">Configurações › Operações › Tipos de Operação</a>.
    </p>;
  }
  if (estado.situacao === "erro") return <p data-testid="top-erro" className="text-sm text-red-700">{estado.mensagem}</p>;
  return null;
}

/**
 * O campo em si. Obrigatório, com o padrão PRÉ-SELECIONADO e VISÍVEL — nunca escondido.
 *
 * Pré-selecionar não é decidir pelo usuário: o valor fica à vista e ele troca. Esconder o campo porque
 * "tem um padrão" seria gravar uma identidade que ninguém viu.
 */
export function CampoTipoOperacao({ estado, valor, onChange, span = 4 }: { estado: EstadoTop; valor: string; onChange: (v: string) => void; span?: number }) {
  const pronto = podeLancar(estado);
  return <Field label="Tipo de Operação" required span={span}>
    <NativeSelect data-testid="select-tipo-operacao" value={valor} disabled={!pronto} onChange={(e) => onChange(e.target.value)}>
      <option value="">Selecione…</option>
      {pronto && estado.dados.items.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
    </NativeSelect>
    {pronto && <span className="mt-1 block text-xs text-slate-500">Família: {estado.dados.family.label}</span>}
    <MensagemTop estado={estado} />
  </Field>;
}

/** Sincroniza o padrão da família com o estado do formulário, sem sobrescrever escolha já feita. */
export function usePadraoTop(estado: EstadoTop, valor: string, setValor: (v: string) => void) {
  React.useEffect(() => {
    if (!podeLancar(estado) || valor) return;
    const { defaultId, items } = estado.dados;
    // Com uma única TOP ativa, selecioná-la é o comportamento útil — e ela continua visível no campo.
    const escolha = defaultId ?? (items.length === 1 ? items[0]!.id : null);
    if (escolha) setValor(escolha);
  }, [estado, valor, setValor]);
}


/**
 * A COLUNA da listagem. Código + nome, ambos do SNAPSHOT — nunca o UUID, que não é endereço nem rótulo.
 *
 * Documento legado mostra traço. Não "Venda": afirmar a família canônica na coluna de TOP configurada
 * seria dizer que o registro tem configuração que ele não tem.
 */
export const colTipoOperacao = (): Column<Row> => ({
  key: "tipo_operacao_id",
  label: "Tipo de Operação",
  render: (r: Row) => {
    const t = r["tipo_operacao"] as { codigo: string; nome: string } | null | undefined;
    return t ? `${t.codigo} — ${t.nome}` : "—";
  }
});

/**
 * As opções do FILTRO por TOP.
 *
 * Só pergunta ao servidor quando o usuário TEM a capacidade que a porta operacional exige: sem isto, toda
 * abertura de listagem por alguém que só lê dispararia um 403 inútil. Sem opções, o filtro simplesmente
 * não aparece — e a listagem continua inteira, porque filtrar é conveniência, não recorte de segurança.
 *
 * As opções são as TOPs ATIVAS. Um documento cuja TOP foi desativada depois continua na listagem sem
 * filtro e continua casando o filtro por id; ele só não é mais OFERECIDO como escolha nova.
 */
export function useOpcoesDeTopParaFiltro(kind: string, habilitado: boolean): { value: string; label: string }[] {
  const estado = useTopsDaVariante(kind, habilitado);
  if (!podeLancar(estado)) return [];
  return estado.dados.items.map((x) => ({ value: x.id, label: `${x.code} — ${x.name}` }));
}
