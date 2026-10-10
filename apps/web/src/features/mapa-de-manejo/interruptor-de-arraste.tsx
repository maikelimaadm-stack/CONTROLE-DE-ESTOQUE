"use client";
import * as React from "react";
import { Move } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * MAPA-MANEJO-04 (F2) — CAMADA 4: o INTERRUPTOR do arraste de lote no mapa.
 *
 * Nasce DESLIGADO. Num celular cheio de ícones, arraste sempre ligado produz movimentação por acidente (decisão de
 * quem usou o sistema no campo): quem quer mover lote pelo mapa liga o interruptor de propósito. A escolha fica no
 * navegador (localStorage, por aparelho); sem storage (aba privada, site sem dados, prévia), nasce desligado e segue
 * funcionando só na sessão.
 *
 * Só aparece com a capacidade de criar a transferência (`PERMISSAO_DE_MOVER`): quem renderiza confere com `can()`. O
 * `can()` só esconde o botão — quem recusa é a API, no POST do formulário.
 */

/** Capacidade de criar a transferência de lote para módulo/área/curral (a mesma do "Mover lote de local" da Pecuária). */
export const PERMISSAO_DE_MOVER = "batch_module_area_transfer.create";

/** Chave estável da escolha no localStorage. */
export const CHAVE_DO_ARRASTE = "mapa-manejo.arraste-ligado";

/** Lê a escolha guardada: só "true" liga; qualquer outra coisa (ausente, corrompida, storage bloqueado) é desligado. */
export function lerArrasteLigado(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  try {
    return storage?.getItem(CHAVE_DO_ARRASTE) === "true";
  } catch {
    return false; // storage bloqueado: nasce desligado
  }
}

/** Guarda a escolha; sem storage, a escolha vale só nesta sessão da tela. */
export function gravarArrasteLigado(storage: Pick<Storage, "setItem"> | null | undefined, ligado: boolean): void {
  try {
    storage?.setItem(CHAVE_DO_ARRASTE, ligado ? "true" : "false");
  } catch {
    // sem storage: a escolha fica só no estado da tela
  }
}

function storageDaJanela(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // acessar o localStorage pode lançar (dados do site bloqueados)
  }
}

/**
 * `[ligado, setLigado]` do arraste. O estado nasce FALSO (no servidor e no primeiro desenho do cliente, sem diferença
 * de hidratação) e, depois de montar, assume o que estava guardado. `setLigado` muda o estado e guarda.
 */
export function useArrasteLigado(): [boolean, (ligado: boolean) => void] {
  const [ligado, setLigadoNoEstado] = React.useState(false);
  React.useEffect(() => {
    setLigadoNoEstado(lerArrasteLigado(storageDaJanela()));
  }, []);
  const setLigado = React.useCallback((novo: boolean) => {
    setLigadoNoEstado(novo);
    gravarArrasteLigado(storageDaJanela(), novo);
  }, []);
  return [ligado, setLigado];
}

/**
 * Alvo de toque de 44 px em tela estreita; compacto de `sm` para cima. Com `!`: a altura do botão da casa vem de uma
 * classe própria de globals.css, fora das camadas do Tailwind (o mesmo achado da barra de controles).
 */
const ALVO_DE_TOQUE = "!min-h-11 sm:!min-h-0";

export interface InterruptorDeArrasteProps {
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
}

/** O interruptor na barra do mapa: marcado (`aria-pressed`, botão cheio) quando o arraste está ligado. */
export function InterruptorDeArraste({ ligado, aoMudar }: InterruptorDeArrasteProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant={ligado ? "default" : "outline"}
      aria-pressed={ligado}
      onClick={() => aoMudar(!ligado)}
      title={ligado
        ? "Arraste ligado: arraste o marcador de um pasto até outra área e confirme no formulário. Clique para desligar."
        : "Ligue para mover um lote arrastando o marcador até outra área (nada é gravado sem confirmar no formulário)."}
      data-testid="interruptor-arraste"
      data-ligado={ligado ? "sim" : "nao"}
      className={ALVO_DE_TOQUE}
    >
      <Move aria-hidden />
      Mover lote no mapa
    </Button>
  );
}
