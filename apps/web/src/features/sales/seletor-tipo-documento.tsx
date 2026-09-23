"use client";
import * as React from "react";
import * as MenuP from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import estilos from "./portal-vendas.module.css";

/**
 * O SELETOR "TIPO" DO PORTAL DE VENDAS — o contexto operacional da barra (VISUAL-UX-01 R3).
 *
 * É o MESMO filtro de antes (`?kind=` na URL, parâmetro estável), só que vestido como o design: uma
 * pílula "Tipo · <valor>" que abre um menu de escolha única. Nada mudou no que ele decide:
 *  · recorta a LISTA (quem recorta linha continua sendo o servidor, pela leitura de cada variante);
 *  · recorta o `Novo` — a janela e o menu rápido passam a oferecer só as operações daquele tipo.
 *
 * "Todos os tipos" continua existindo. O design mostra só os três tipos, mas a lista única com os três
 * juntos é contrato vigente (TOP-CONFIG-03, `docs/PORTAIS-OPERACIONAIS-CONTRACT.md`): URL e favorito
 * antigos caem nela, e é nela que se procura "o documento do cliente X" sem saber o tipo. Tirar a
 * opção seria mudar a regra do portal numa fatia de apresentação.
 *
 * As opções chegam prontas de quem monta a tela (registry + permissão de LEITURA); aqui não mora lista
 * de tipos nenhuma.
 */
export const TODOS_OS_TIPOS = "Todos os tipos";
const TODOS = "all";

export interface OpcaoDeTipo { value: string; label: string }

export function SeletorDeTipoDeDocumento({ valor, opcoes, onChange, focarAoMontar }: {
  /** A variante ativa, ou "" para todos os tipos. */
  valor: string;
  /** Os tipos que o usuário pode LER, já rotulados. "Todos os tipos" é acrescentado aqui. */
  opcoes: OpcaoDeTipo[];
  onChange: (variante: string) => void;
  /**
   * Trocar o tipo REMONTA a listagem (`DocList` usa o tipo como chave, para reaplicar o filtro), e o
   * seletor mora dentro dela. Sem isto o foco cairia no `<body>` a cada troca. Quem troca marca o
   * pedido; o seletor novo, ao montar, devolve o foco a si mesmo e limpa o pedido.
   */
  focarAoMontar?: React.MutableRefObject<boolean>;
}) {
  const gatilho = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!focarAoMontar?.current) return;
    focarAoMontar.current = false;
    gatilho.current?.focus();
  }, [focarAoMontar]);

  const todas: OpcaoDeTipo[] = [{ value: TODOS, label: TODOS_OS_TIPOS }, ...opcoes];
  const atual = todas.find((o) => o.value === (valor || TODOS))?.label ?? TODOS_OS_TIPOS;

  // O nome acessível é o TEXTO VISÍVEL ("Tipo Venda"), com o espaço escrito: um rótulo que o leitor de tela
  // lê diferente do que a tela mostra quebra quem navega por voz ("clicar em Tipo Venda").
  return <MenuP.Root modal={false}>
    <MenuP.Trigger asChild>
      <button ref={gatilho} type="button" className={estilos.tipo} title="Tipo de documento"
        data-testid="vendas-tipo" data-valor={valor || TODOS}>
        <span className={estilos.tipoPrefixo}>Tipo</span>{" "}
        <span className={estilos.tipoValor}>{atual}</span>
        <ChevronDown className={estilos.seta11} strokeWidth={2.4} aria-hidden />
      </button>
    </MenuP.Trigger>
    <MenuP.Portal>
      <MenuP.Content align="start" sideOffset={6} className={cn(estilos.menu, estilos.menuTipo)} aria-label="Tipo de documento" data-testid="vendas-tipo-opcoes">
        <MenuP.RadioGroup value={valor || TODOS} onValueChange={(v) => { if (v !== (valor || TODOS)) onChange(v === TODOS ? "" : v); }}>
          {todas.map((o, i) => <React.Fragment key={o.value}>
            {i === 1 && <MenuP.Separator className={estilos.separador} />}
            <MenuP.RadioItem value={o.value} className={estilos.opcaoTipo} data-testid="vendas-tipo-opcao" data-valor={o.value}>
              <span className={estilos.marca}><MenuP.ItemIndicator><Check strokeWidth={3} aria-hidden /></MenuP.ItemIndicator></span>
              {o.label}
            </MenuP.RadioItem>
          </React.Fragment>)}
        </MenuP.RadioGroup>
      </MenuP.Content>
    </MenuP.Portal>
  </MenuP.Root>;
}
