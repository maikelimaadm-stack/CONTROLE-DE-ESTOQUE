"use client";
import * as React from "react";
import { Suspense, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTabTitle } from "@/lib/workspace-tabs";
import { podeLancar, useTopsDaVariante, type TopOperacional } from "@/features/sales/tipo-operacao-select";
import { LancadorDeTipoOperacao, pedidoImpossivel, topSelecionada } from "@/features/sales/lancador-tipo-operacao";
import type { PosicaoDoRotuloValor } from "@/features/sales/central-vendas-barra";
import { chaveDaCopia } from "@/features/sales/central-vendas-duplicar";
import { descartarEntrega } from "@/lib/entrega-em-memoria";
/* EDITAR-03 (decisão 315): o formulário da Central de Vendas mora em `features/sales/central-vendas-formulario.tsx` — o
   MESMO componente, movido sem reescrita, para a consulta poder abri-lo em modo edição (página do Next não exporta). */
import { FormularioDaCentralDeVendas as Formulario, TITULOS_DA_CRIACAO_DE_VENDA as T } from "@/features/sales/central-vendas-formulario";

/**
 * NOVO LANÇAMENTO DE VENDAS — TOP PRIMEIRO, FORMULÁRIO DEPOIS (TOP-CONFIG-02B).
 *
 * A rota é a MESMA de antes (`/vendas/<variante>/new`), de propósito: favoritos, links do Portal e
 * permissões continuam valendo. O que mudou é o que ela mostra quando ainda não há operação escolhida.
 *
 *   sem `?tipo_operacao_id`        → LANÇADOR. O formulário não existe na árvore.
 *   com UUID que a lista confirma  → FORMULÁRIO, já contextualizado pela operação.
 *   com UUID que a lista recusa    → LANÇADOR + "não está disponível". Nenhum POST sai daqui.
 *
 * O formulário mora num componente SEPARADO e só é montado no segundo caso. Isso não é organização de
 * código: é a garantia. Enquanto não houver TOP válida não existe estado de formulário, não existe
 * botão Salvar e não existe caminho para `create.mutate` — em vez de existirem desabilitados, que é o
 * tipo de proteção que um `disabled` removido por engano desfaz sem ninguém notar.
 */
function Inner({ kind }: { kind: string }) {
  const router = useRouter();
  const pedido = useSearchParams().get("tipo_operacao_id");
  const estadoTop = useTopsDaVariante(kind);
  /**
   * O RÓTULO DA ABA DE TRABALHO SAI DAQUI, e não mais do registro de navegação.
   *
   * Até esta correção a barra de abas lia o rótulo da AÇÃO "Novo orçamento" do `nav.registry.mjs`. Essas
   * ações saíram do registro — elas ensinavam a escolher a variante antes da operação —, e sem um título
   * próprio a aba passaria a se chamar "Novo · Vendas" para as três portas. O título pertence à TELA, que
   * é quem sabe qual variante está sendo criada; o registro voltou a tratar só de navegação.
   */
  useTabTitle(T[kind] ?? "Novo lançamento");
  const topAtual = topSelecionada(estadoTop, pedido);

  /**
   * A TRAVA DA SESSÃO DE EDIÇÃO — preserva o RASCUNHO, nunca a AUTORIZAÇÃO DE ESCRITA.
   *
   * ┌─ AS DUAS PERGUNTAS, QUE NÃO SÃO A MESMA ───────────────────────────────────────────────────────┐
   * │ 1. O FORMULÁRIO DEVE CONTINUAR MONTADO?  → sim, se a sessão já entrou com uma TOP validada.     │
   * │ 2. A ESCRITA ESTÁ AUTORIZADA AGORA?      → só se a descoberta ATUAL confirmar a TOP escolhida.  │
   * │                                                                                                 │
   * │ A primeira versão desta trava respondia as duas com o mesmo valor, e foi um erro: ela mantinha  │
   * │ o `Salvar` habilitado mesmo depois de a capability cair para `nao-confirmado`. Isso reabria      │
   * │ exatamente o buraco que a TOP-CONFIG-02 fechou — num rolling deploy, o formulário abre contra a  │
   * │ API nova e o refetch seguinte pode cair na API ANTIGA, que é justamente a que IGNORA             │
   * │ `tipo_operacao_id` EM SILÊNCIO. "O servidor devolve 422" não vale como garantia quando o         │
   * │ servidor que vai responder talvez não conheça o campo.                                          │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * Então a trava vale para estado de tela, e SÓ. Quem autoriza o POST é `escritaTopConfirmada`,
   * derivado do estado ATUAL da descoberta — fail-closed, como antes desta fatia existir.
   *
   * A CHAVE É `kind:pedido`, não o pedido sozinho. Uma TOP de `vendas.venda` não pode valer para
   * `orders` só porque o UUID veio junto: se o router preservar a instância ao trocar o segmento
   * dinâmico, a chave muda e a trava é ignorada. Não se apoia em detalhe de ciclo de vida do Next —
   * segurança que depende de "o componente vai remontar, certo?" é segurança que alguém remove sem ver.
   *
   * Escrita em `useLayoutEffect`, depois do commit, e não durante a renderização. O quadro inseguro
   * que eu temia não existe: quando o usuário clica em Continuar, a lista JÁ está em cache, então o
   * primeiro render do formulário tem `topAtual` e não precisa da trava. Ela só é lida nos renders
   * SEGUINTES, quando um refetch adverso zerou `topAtual` — e aí ela já foi gravada há muito.
   */
  const chave = pedido ? `${kind}:${pedido}` : null;
  const trava = React.useRef<{ chave: string; top: TopOperacional } | null>(null);
  React.useLayoutEffect(() => {
    if (!chave) { trava.current = null; return; }
    if (topAtual) trava.current = { chave, top: topAtual };
  });

  /** A TOP desta sessão de edição: a atual, ou a que já foi validada sob ESTA MESMA chave. */
  const topDaSessao = chave && trava.current?.chave === chave ? trava.current.top : null;
  const topEfetiva = topAtual ?? topDaSessao;

  /**
   * A ESCRITA SÓ É AUTORIZADA PELO ESTADO ATUAL. `podeLancar` continua sendo a regra — a trava não a
   * afrouxa e não ganhou uma variante permissiva. `topAtual` só é não-nulo quando a descoberta está
   * `pronto` E a TOP escolhida está na lista de AGORA; as duas condições estão escritas para que
   * remover uma delas de `topSelecionada` não passe despercebido aqui.
   */
  const escritaTopConfirmada = podeLancar(estadoTop) && topAtual !== null;

  /* VISUAL-UX-02 W1 — POSIÇÃO DO RÓTULO: estado desta tela (nem storage, nem perfil); fica aqui para sobreviver ao
     Descartar. DESCARTAR volta à ABERTURA: remonta o formulário (mesma TOP, padrões do layout reaplicados, zero
     escrita). DUPLICAR: TOP do original que não abre o formulário (indisponível, inativa, servidor sem a lista) → o
     lançador de hoje, com a mensagem de hoje, e a cópia em memória é descartada. */
  const [densidade, setDensidade] = React.useState<PosicaoDoRotuloValor>("rotulo-a-frente");
  const [abertura, setAbertura] = React.useState(0);
  const copiaSemFormulario = Boolean(pedido) && !topEfetiva && estadoTop.situacao !== "carregando";
  React.useEffect(() => { if (copiaSemFormulario) descartarEntrega(chaveDaCopia(kind)); }, [copiaSemFormulario, kind]);

  if (topEfetiva) return <Formulario
    key={abertura}
    kind={kind}
    top={topEfetiva}
    familia={estadoTop.situacao === "pronto" ? estadoTop.dados.family.label : ""}
    estadoTop={estadoTop}
    escritaTopConfirmada={escritaTopConfirmada}
    densidade={densidade} onDensidade={setDensidade} onDescartar={() => setAbertura((n) => n + 1)}
  />;

  return <LancadorDeTipoOperacao
    estado={estadoTop}
    titulo={T[kind] ?? "Novo"}
    indisponivel={pedidoImpossivel(estadoTop, pedido)}
    onCancelar={() => router.push("/vendas")}
    /**
     * A escolha vai para a URL — e com `replace`, não `push`: o lançador e o formulário são duas caras
     * da MESMA etapa de criação, não dois lugares. Com `push`, o Voltar do navegador devolveria o
     * usuário ao lançador que ele acabou de usar, e "Voltar" depois de digitar meia venda tem de sair
     * da criação, não reabrir a pergunta. Quem quer trocar a operação usa "Alterar operação".
     */
    onContinuar={(t) => router.replace(`/vendas/${kind}/new?tipo_operacao_id=${encodeURIComponent(t.id)}`)}
  />;
}

export default function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params);
  return <Suspense><Inner kind={kind} /></Suspense>;
}
