"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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
 * ┌─ E UM 200 TAMBÉM PRECISA SER CONFERIDO ─────────────────────────────────────────────────────────┐
 * │ `contractVersion` existe para o cliente distinguir "endpoint ausente" de "endpoint presente com  │
 * │ OUTRO FORMATO". Uma promessa que só o SERVIDOR cumpre não protege ninguém: `api<T>()` é uma      │
 * │ ASSERÇÃO de tipo, não uma prova — em runtime o corpo é `unknown` e o TypeScript já terminou o    │
 * │ trabalho dele.                                                                                   │
 * │                                                                                                  │
 * │ Sem conferir, um 200 de um servidor MAIS NOVO (contractVersion 2, campos com outro significado)  │
 * │ chegaria ao estado "pronto": o Salvar liberaria e o POST sairia contra um contrato que ninguém   │
 * │ leu — a MESMA perda silenciosa que esta tela existe para impedir, só que pelo outro lado da      │
 * │ janela de deploy. E um corpo truncado, sem `items`, derrubava a tela em `items.length`: tela     │
 * │ branca, sem nem a mensagem de bloqueio.                                                          │
 * │                                                                                                  │
 * │ Então o 200 passa por `ehTopsDaVariante`: versão EXATA e forma conferida campo a campo, item a   │
 * │ item. O que não se reconhece NEGA. Item inválido NÃO é filtrado da lista — esconder do vendedor  │
 * │ uma TOP que o servidor ofereceu é o mesmo descarte silencioso, só que do lado de cá.             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * As TOPs vêm da porta OPERACIONAL (`/api/sales/<variante>/operation-types`), nunca da administrativa:
 * quem pode vender não precisa poder configurar tipos de operação.
 */

export interface TopOperacional { id: string; code: string; name: string; version: number; isDefault: boolean }
export interface TopsDaVariante { contractVersion: typeof CONTRATO_TOPS; family: { code: string; label: string }; defaultId: string | null; items: TopOperacional[] }

/** A ÚNICA versão de contrato que esta tela sabe ler. O servidor a declara em `/operation-types`. */
export const CONTRATO_TOPS = 1 as const;

const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Um item só é aceito INTEIRO. `version` é a versão que vai ser CONGELADA no documento: 0, fração ou NaN não existe. */
const ehTopOperacional = (v: unknown): v is TopOperacional =>
  ehObjeto(v) && ehTexto(v.id) && ehTexto(v.code) && ehTexto(v.name)
  && typeof v.version === "number" && Number.isInteger(v.version) && v.version > 0
  && typeof v.isDefault === "boolean";

/**
 * O corpo do 200 é `unknown` até aqui. Conferir campo a campo é o que transforma a promessa do
 * `contractVersion` em garantia — e `items` PRECISA ser array antes de alguém ler `.length`.
 */
export const ehTopsDaVariante = (v: unknown): v is TopsDaVariante =>
  ehObjeto(v)
  && v.contractVersion === CONTRATO_TOPS
  && ehObjeto(v.family) && ehTexto(v.family.code) && ehTexto(v.family.label)
  && (v.defaultId === null || ehTexto(v.defaultId))
  && Array.isArray(v.items) && v.items.every(ehTopOperacional)
  // O padrão tem de ESTAR na lista. `usePadraoTop` grava `defaultId` no estado do formulário; um id fora
  // de `items` deixaria o campo mostrando "Selecione…" com o Salvar HABILITADO, e o POST sairia para
  // morrer em 422 no servidor. Este servidor não produz isso (`defaultId` sai das mesmas linhas de
  // `items`), mas é exatamente a classe de corpo contra a qual o guarda existe.
  && (v.defaultId === null || v.items.some((i) => (i as TopOperacional).id === v.defaultId));

/** O que a tela precisa decidir. Três situações distintas, três mensagens distintas — nunca uma só. */
export type EstadoTop =
  /** Ainda perguntando. */
  | { situacao: "carregando" }
  /**
   * O endpoint não confirmou a lista: ou o servidor é ANTERIOR a esta fatia (não tem a rota, e o
   * `:id` da base transforma o caminho em 500), ou está com defeito. Os dois chegam indistinguíveis;
   * nos dois a resposta certa é a mesma — bloquear a escrita. O problema não é do usuário.
   * O TERCEIRO modo é um 200 que não passa em `ehTopsDaVariante` (contrato futuro ou corpo
   * corrompido). Aí `status` fica AUSENTE: o status foi 200, e anotá-lo aqui enganaria quem lesse.
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
  // `unknown` DE PROPÓSITO: o corpo só vira `TopsDaVariante` depois de CONFERIDO, nunca por asserção.
  const q = useQuery<unknown, ApiError>({
    queryKey: ["sales-operation-types", kind],
    queryFn: () => api<unknown>(`/api/sales/${kind}/operation-types`),
    enabled: habilitado,
    retry: false
  });
  return estadoDeTops({ habilitado, carregando: q.isPending, erro: q.error, dados: q.data });
}

/**
 * A CLASSIFICAÇÃO, separada da forma de perguntar.
 *
 * O PORTAL UNIFICADO precisa das TOPs das TRÊS variantes na MESMA renderização, e a regra dos hooks não
 * permite um `useTopsDaVariante` dentro de um laço. Quem pergunta em lote (`useTopsDeVendas`, sobre
 * `useQueries`) precisa chegar EXATAMENTE ao mesmo veredito — e uma segunda cópia desta escada de `if`
 * divergiria em silêncio na primeira vez que alguém ajustasse só um lado. Por isso a decisão mora aqui,
 * numa função pura, e as duas formas de perguntar a chamam.
 */
export function estadoDeTops({ habilitado, carregando, erro, dados }: { habilitado: boolean; carregando: boolean; erro: ApiError | null; dados: unknown }): EstadoTop {
  if (!habilitado || carregando) return { situacao: "carregando" };
  if (erro) {
    // 404 (rota ausente) e 5xx (a rota caiu no `:id` da API anterior, ou o servidor quebrou) são os
    // dois modos em que a lista não foi confirmada. Ver o bloco medido no cabeçalho.
    if (erro.status === 404 || erro.status >= 500) return { situacao: "nao-confirmado", status: erro.status };
    return { situacao: "erro", mensagem: erro.message };
  }
  // 200 que não é o contrato desta tela NEGA — e a conferência vem ANTES de qualquer leitura de
  // `items`, que é o que impede tanto o "pronto" sobre contrato desconhecido quanto o crash em `.length`.
  if (!ehTopsDaVariante(dados)) return { situacao: "nao-confirmado" };
  // Daqui para baixo a forma está PROVADA: lista vazia é resposta legítima do contrato 1 e significa
  // configuração faltando, não servidor incompatível. Mensagens diferentes porque são problemas de
  // pessoas diferentes — uma o administrador resolve, a outra não.
  if (dados.items.length === 0) return { situacao: "sem-top", familia: dados.family.label };
  return { situacao: "pronto", dados };
}

/** A escrita pode acontecer? Só quando há TOP escolhível. Fail-closed em todos os outros estados. */
export const podeLancar = (e: EstadoTop): e is Extract<EstadoTop, { situacao: "pronto" }> => e.situacao === "pronto";

/** Mensagem única por estado — quem lê precisa saber se o problema é o servidor ou a configuração. */
export function MensagemTop({ estado }: { estado: EstadoTop }) {
  const { can } = useAuth();
  const podeConfigurarTop = can("tipos_operacao.view");
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
    // O CAMINHO SÓ É OFERECIDO A QUEM PODE PERCORRÊ-LO. O vendedor sem `tipos_operacao.view` não
    // enxerga a sub-área de Configurações (o guarda de navegação a esconde), então mandá-lo para lá
    // seria mandá-lo bater numa porta fechada e concluir que o sistema está quebrado. Quem não
    // configura precisa saber a quem pedir, não onde clicar.
    //
    // Isto é APRESENTAÇÃO, não segurança: o servidor continua sendo a autoridade, e `can()` no cliente
    // apenas esconde botão (`CLAUDE.md`). Esconder o link não protege nada — só para de mentir.
    return <p data-testid="top-ausente" className="text-sm text-amber-700">
      Nenhum Tipo de Operação ativo está cadastrado para {estado.familia}.{" "}
      {podeConfigurarTop
        ? <>Cadastre um em <a className="underline" href="/configuracoes?tab=operacoes&sub=tipos-operacao">Configurações › Operações › Tipos de Operação</a>.</>
        : <>Procure um administrador para cadastrar.</>}
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

/**
 * Sincroniza o padrão da família com o estado do formulário, sem sobrescrever escolha já feita.
 *
 * SÓ `defaultId` PRÉ-SELECIONA — uma família com UMA TOP não transforma essa TOP em padrão.
 *
 * Havia aqui um `?? (items.length === 1 ? items[0].id : null)`, e ele contradizia a decisão 205: o
 * padrão é decisão do CADASTRO (`padrao` no banco), não da cardinalidade da lista. Duas semânticas de
 * padrão no mesmo produto — uma no lançamento, outra na conversão — é a segunda lista que este
 * repositório evita, e a divergência apareceria calada no dia em que a família ganhasse a segunda TOP:
 * a marcação sumiria sem que nada tivesse mudado no cadastro.
 *
 * O efeito prático é na CONVERSÃO (orçamento → pedido → venda): com destino sem padrão, o campo
 * continua em "Selecione…" e o usuário escolhe. É mais um clique, e é o clique que faz a operação do
 * documento novo ser uma decisão em vez de um efeito colateral da quantidade de linhas cadastradas.
 */
export function usePadraoTop(estado: EstadoTop, valor: string, setValor: (v: string) => void) {
  React.useEffect(() => {
    if (!podeLancar(estado) || valor) return;
    const escolha = estado.dados.defaultId;
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
