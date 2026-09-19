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
 * │ o cliente: ANTES de oferecer o formulário, ele pergunta ao endpoint operacional. Se ele não      │
 * │ responder a lista, a tela BLOQUEIA a escrita em vez de arriscar.                                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O QUE A API ANTERIOR REALMENTE RESPONDE (medido, não suposto) ─────────────────────────────────┐
 * │ A primeira versão disto tratava 404 como "servidor antigo". Era FALSO, e o binário da base       │
 * │ provou: ele não tem rota estática `/sales/<variante>/operation-types`, mas TEM `${base}/:id`.    │
 * │ O roteador casa o nó paramétrico, "operation-types" vira `id`, o SQL recebe a string numa coluna │
 * │ `uuid`, o Postgres devolve 22P02 — que `fromPgError` não mapeia — e a resposta é 500.            │
 * │                                                                                                  │
 * │   $ curl .../api/sales/budgets/operation-types   (API do commit base)                            │
 * │   HTTP=500 {"error":{"code":"INTERNAL_ERROR","message":"Erro interno"}}                          │
 * │                                                                                                  │
 * │ Então NÃO existe status que separe "servidor antigo" de "servidor com defeito": os dois chegam   │
 * │ aqui como 500. Em vez de inventar um discriminador que não existe, este arquivo passou a         │
 * │ afirmar só o que sabe — a lista NÃO foi confirmada — e a bloquear nos dois casos, que é a        │
 * │ resposta certa para ambos. Mentir sobre a causa seria pior do que não saber.                     │
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
  /**
   * O endpoint não confirmou a lista: ou o servidor é ANTERIOR a esta fatia (não tem a rota, e o
   * `:id` da base transforma o caminho em 500), ou está com defeito. Os dois chegam indistinguíveis;
   * nos dois a resposta certa é a mesma — bloquear a escrita. O problema não é do usuário.
   */
  | { situacao: "nao-confirmado"; status?: number }
  /** A API é nova e não há nenhuma TOP ativa da família: é configuração que falta. */
  | { situacao: "sem-top"; familia: string }
  /** Tudo certo. */
  | { situacao: "pronto"; dados: TopsDaVariante }
  /** Falha que o servidor EXPLICOU (403, 422, rede): também bloqueia, e repete a causa que ele deu. */
  | { situacao: "erro"; mensagem: string };

/**
 * Pergunta ao servidor quais TOPs esta variante pode lançar.
 *
 * `retry: false` é deliberado: 404 e 500 aqui são RESPOSTA (o servidor não tem a rota), não falha
 * transitória, e insistir só atrasaria a decisão da tela.
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
    // 404 (rota ausente) e 5xx (a rota caiu no `:id` da API anterior, ou o servidor quebrou) são os
    // dois modos em que a lista não foi confirmada. Ver o bloco medido no cabeçalho.
    if (q.error.status === 404 || q.error.status >= 500) return { situacao: "nao-confirmado", status: q.error.status };
    return { situacao: "erro", mensagem: q.error.message };
  }
  if (!q.data || q.data.items.length === 0) return { situacao: "sem-top", familia: q.data?.family.label ?? "" };
  return { situacao: "pronto", dados: q.data };
}

/** A escrita pode acontecer? Só quando há TOP escolhível. Fail-closed em todos os outros estados. */
export const podeLancar = (e: EstadoTop): e is Extract<EstadoTop, { situacao: "pronto" }> => e.situacao === "pronto";

/** Mensagem única por estado — quem lê precisa saber se o problema é o servidor ou a configuração. */
export function MensagemTop({ estado }: { estado: EstadoTop }) {
  if (estado.situacao === "nao-confirmado") {
    // NÃO pedir para cadastrar TOP: o problema não é ausência de configuração. Mandar o usuário à tela
    // de Tipos de Operação aqui o faria cadastrar algo que não resolve. E não afirmar "servidor sendo
    // atualizado": isso seria adivinhar entre as duas causas que chegam idênticas até aqui.
    return <p data-testid="top-nao-confirmado" className="text-sm text-amber-700">
      Não foi possível confirmar os Tipos de Operação neste servidor. O lançamento está bloqueado para
      não gravar um documento sem tipo. Tente novamente em alguns instantes.
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
const rotuloDaTop = (r: Row) => {
  const t = r["tipo_operacao"] as { codigo: string; nome: string } | null | undefined;
  return t ? `${t.codigo} — ${t.nome}` : "";
};

export const colTipoOperacao = (): Column<Row> => ({
  key: "tipo_operacao_id",
  label: "Tipo de Operação",
  render: (r: Row) => rotuloDaTop(r) || "—",
  /**
   * A célula EXIBE o snapshot e a chave GUARDA o UUID. Sem estas duas declarações o motor usaria a chave
   * para tudo o que não é React: o CSV sairia com `9f0c…-…` na coluna que a tela mostra como
   * "2103 — Venda de Gado a Prazo", e o chip automático seria uma busca de TEXTO sobre o identificador —
   * digitar o nome devolveria zero linhas. O filtro ÚTIL por TOP é o `select` que a listagem injeta a
   * partir do endpoint operacional (`useOpcoesDeTopParaFiltro`); este aqui só atrapalharia.
   */
  text: rotuloDaTop,
  filterable: false
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
