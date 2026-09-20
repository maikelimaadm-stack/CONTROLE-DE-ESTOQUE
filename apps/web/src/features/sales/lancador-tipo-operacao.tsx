"use client";
import * as React from "react";
import { Badge, Button, Card, CardBody, CardHeader, LoadingState } from "@/components/ui";
import { MensagemTop, podeLancar, type EstadoTop, type TopOperacional } from "./tipo-operacao-select";

/**
 * O LANÇADOR DE TIPO DE OPERAÇÃO — a escolha da operação vem ANTES do formulário (TOP-CONFIG-02B).
 *
 * ┌─ POR QUE UMA ETAPA, E NÃO UM CAMPO ────────────────────────────────────────────────────────────┐
 * │ Até aqui a TOP era um `select` no meio do grid, entre Empresa, Data e Cliente. Isso a tratava   │
 * │ como mais um atributo do lançamento, e ela não é: a TOP é a IDENTIDADE OPERACIONAL que          │
 * │ CONTEXTUALIZA o lançamento inteiro — e, a partir da TOP-CONFIG-03, vai decidir efeitos de       │
 * │ estoque, financeiro e fiscal. Um dado que muda o significado de todos os outros não pode ser    │
 * │ preenchido no meio deles, nem descoberto depois de o usuário já ter digitado a venda.           │
 * │                                                                                                  │
 * │ Então o formulário nasce JÁ SABENDO a operação, e não a recebe no meio do caminho.              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A URL É PEDIDO, NUNCA AUTORIDADE ─────────────────────────────────────────────────────────────┐
 * │ A escolha é persistida em `?tipo_operacao_id=<uuid>` para que refresh, Voltar/Avançar e um link │
 * │ compartilhado continuem funcionando — estado de tela que se perde no refresh não é estado, é    │
 * │ sorte. Mas quem chega pela URL não está autorizado por ela: o UUID SÓ vale se estiver na lista  │
 * │ que o SERVIDOR devolveu para AQUELA variante, e é `topSelecionada` quem responde isso.          │
 * │                                                                                                  │
 * │ Formato de UUID não prova nada. Pertencer à lista prova as cinco coisas de uma vez: existe, é   │
 * │ desta organização, está ativa, não foi excluída e é da FAMÍLIA certa — porque a rota só devolve │
 * │ TOPs que satisfazem tudo isso. Um `regex` de uuid aqui seria teatro.                             │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O PADRÃO NÃO PULA A ETAPA ────────────────────────────────────────────────────────────────────┐
 * │ Quando existe TOP padrão, ela vem PRÉ-SELECIONADA e marcada — mas o lançador continua na tela e │
 * │ o usuário ainda precisa confirmar. Abrir o formulário direto por causa do padrão devolveria      │
 * │ exatamente o problema que esta fatia veio resolver: o documento nasceria com uma identidade      │
 * │ operacional que ninguém viu. Pré-selecionar é adiantar trabalho; auto-avançar é decidir pelo     │
 * │ usuário, e as duas coisas se parecem só até alguém errar a operação de uma venda.               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * A TOP pedida — se, e somente se, ela estiver na lista operacional desta variante.
 *
 * É a ÚNICA porta entre "o que a URL pediu" e "o que a tela aceita". Fail-closed nos três degraus:
 * estado que não é `pronto` (ainda carregando, servidor não confirmado, sem TOP, erro) devolve `null`;
 * pedido ausente devolve `null`; UUID que não está em `items` devolve `null`.
 *
 * Não filtra, não corrige e não escolhe um vizinho: ou o pedido é exatamente atendível, ou não é.
 */
export function topSelecionada(estado: EstadoTop, pedido: string | null | undefined): TopOperacional | null {
  if (!podeLancar(estado) || !pedido) return null;
  return estado.dados.items.find((t) => t.id === pedido) ?? null;
}

/**
 * O pedido da URL é impossível de atender, e o servidor JÁ respondeu?
 *
 * A distinção importa para a mensagem: enquanto a lista não chegou não se pode dizer que a TOP não
 * existe — só que ainda não se sabe. Afirmar "indisponível" durante o carregamento seria acusar o
 * usuário de um erro que talvez não exista.
 */
export const pedidoImpossivel = (estado: EstadoTop, pedido: string | null | undefined): boolean =>
  Boolean(pedido) && podeLancar(estado) && !topSelecionada(estado, pedido);

/** Uma linha da lista — o alvo de clique é o `label` INTEIRO, não só o círculo do rádio. */
function Opcao({ top, marcada, onEscolher }: { top: TopOperacional; marcada: boolean; onEscolher: () => void }) {
  return <label
    data-testid="top-opcao"
    data-top-id={top.id}
    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition
      ${marcada ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
  >
    {/*
      RÁDIO NATIVO, e não uma `div` com `onClick`. O elemento nativo entrega de graça o que uma
      reimplementação erra: navegação por setas dentro do grupo, `Espaço` para marcar, rótulo
      associado, anúncio correto em leitor de tela e o anel de foco do teclado. `sr-only` esconde o
      controle dos olhos, nunca da árvore de acessibilidade — `hidden` ou `display:none` o tirariam
      da navegação e quebrariam o teclado.
    */}
    <input
      type="radio"
      name="tipo_operacao"
      value={top.id}
      checked={marcada}
      onChange={onEscolher}
      className="peer sr-only"
    />
    <span aria-hidden className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600 peer-focus-visible:ring-offset-2
      ${marcada ? "border-brand-600" : "border-slate-400"}`}>
      {marcada && <span className="h-2 w-2 rounded-full bg-brand-600" />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-slate-900">{top.code}</span>
        <span className="truncate text-sm text-slate-700">{top.name}</span>
        {top.isDefault && <Badge>Padrão</Badge>}
      </span>
    </span>
  </label>;
}

/**
 * A etapa de escolha. Não conhece rota, `kind` nem formulário: recebe o estado e devolve a decisão.
 * Quem navega é a página — assim este componente serve a qualquer portal que venha a adotar TOP.
 */
export function LancadorDeTipoOperacao({ estado, titulo, indisponivel, onContinuar, onCancelar }: {
  estado: EstadoTop;
  titulo: string;
  /** O pedido que veio na URL não pôde ser atendido — mensagem única, sem revelar a causa. */
  indisponivel?: boolean;
  onContinuar: (top: TopOperacional) => void;
  onCancelar: () => void;
}) {
  const pronto = podeLancar(estado);
  const itens = pronto ? estado.dados.items : [];
  /**
   * O padrão entra como seleção inicial, e `items` é a dependência certa: enquanto a lista não chegou
   * não há o que pré-selecionar, e quando ela chega a escolha do usuário ainda não existe. Um `useState`
   * com valor inicial não veria a lista, que chega depois da primeira renderização.
   */
  const [escolhida, setEscolhida] = React.useState<string>("");
  React.useEffect(() => {
    if (!pronto || escolhida) return;
    const padrao = estado.dados.defaultId ?? (itens.length === 1 ? itens[0]!.id : null);
    if (padrao) setEscolhida(padrao);
    // `escolhida` é LIDO na guarda mas fica fora das dependências de propósito: este efeito só decide o
    // valor INICIAL. Incluí-lo faria o efeito rodar de novo a cada troca manual — sem consequência hoje
    // (a guarda corta na primeira linha), mas é trabalho por engano. O fecho é recriado sempre que
    // `estado` muda, então um refetch posterior enxerga a escolha ATUAL do usuário, não uma velha.
  }, [pronto, estado, itens.length]);

  const top = itens.find((t) => t.id === escolhida) ?? null;

  /**
   * `top-lancador` é a âncora de "esta tela é a etapa de escolha, e ela RENDERIZOU". Serve a duas
   * perguntas que nenhum outro seletor responde bem: o teste de corpo corrompido precisa de um alvo que
   * exista mesmo quando a lista não veio (provar que não houve crash), e os testes de bloqueio precisam
   * afirmar que o que está na tela é o lançador e NÃO o formulário.
   */
  return <Card data-testid="top-lancador">
    <CardHeader title={titulo} subtitle="Selecione como este lançamento será realizado." actions={
      <Button variant="outline" size="sm" onClick={onCancelar}>Voltar</Button>
    } />
    <CardBody className="space-y-4">
      {estado.situacao === "carregando" && <LoadingState label="Carregando os tipos de operação…" />}

      {/*
        A mensagem de pedido impossível fica ACIMA da lista e não substitui o lançador: quem chegou por
        um link velho precisa ver o motivo E poder escolher outra operação na mesma tela. Trocar a lista
        por um erro transformaria um contratempo em beco sem saída.

        Uma frase só para todas as causas — inexistente, de outro tenant, inativa, excluída, de outra
        família, id malformado. Distinguir viraria oráculo: quem varresse UUIDs saberia quais existem na
        organização e a que família cada um pertence (`.claude/rules/security.md`).
      */}
      {indisponivel && <p data-testid="top-indisponivel" className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
        O Tipo de Operação selecionado não está disponível para este lançamento.
      </p>}

      {/* Os estados de bloqueio (servidor não confirmado, nenhuma TOP ativa, erro explicado) reusam a
          mensagem única que já existe — sem segunda redação do mesmo diagnóstico. */}
      <MensagemTop estado={estado} />

      {pronto && <>
        <fieldset className="space-y-2">
          <legend className="sr-only">Tipos de Operação disponíveis</legend>
          {itens.map((t) => <Opcao key={t.id} top={t} marcada={t.id === escolhida} onEscolher={() => setEscolhida(t.id)} />)}
        </fieldset>
        <p className="text-xs text-slate-500">Família: {estado.dados.family.label}</p>
        <div className="flex justify-end">
          <Button data-testid="top-continuar" disabled={!top} onClick={() => top && onContinuar(top)}>Continuar</Button>
        </div>
      </>}
    </CardBody>
  </Card>;
}
