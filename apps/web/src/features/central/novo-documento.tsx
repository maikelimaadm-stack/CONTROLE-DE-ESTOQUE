"use client";
import { useRouter } from "next/navigation";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import { BotaoDaBarra, IconeNovo } from "./barra";
import type { PropsDoNovoDocumento } from "./contrato";
import estilos from "./barra.module.css";

export type { PropsDoNovoDocumento } from "./contrato";

/**
 * NOVO DOCUMENTO — o menu "Nova operação · <rotulo>" com as TOPs que a ESPÉCIE fornece (`fonte.useLinhas`), já no
 * corte do menu rápido (`doMenu`): quando o corte esconde alguma, "Escolher operação…" leva ao lançador. Escolher uma
 * leva a `fonte.rotaDaTop(linha)`, que RECONFERE a TOP — URL não autoriza. Quem só vê o botão é quem pode criar
 * (decidido pela página); quem nega é a rota. O motor não sabe de onde vêm as TOPs.
 */
export function NovoDocumento({ prefixoTestid, fonte }: PropsDoNovoDocumento) {
  const router = useRouter();
  const { carregando, todas, doMenu } = fonte.useLinhas();
  const cortou = doMenu.length < todas.length;
  return <DropdownP.Root modal={false}>
    <DropdownP.Trigger asChild>
      <BotaoDaBarra rotulo="Novo documento" solido data-testid={`${prefixoTestid}-novo`}><IconeNovo /></BotaoDaBarra>
    </DropdownP.Trigger>
    <DropdownP.Portal>
      <DropdownP.Content align="start" side="bottom" sideOffset={13} className={cn(estilos.pop, estilos.menuNovo)} aria-label="Novo documento" data-testid={`${prefixoTestid}-novo-menu`}>
        <div className={estilos.menuTitulo}>Nova operação · {fonte.rotulo}</div>
        {carregando && <div className={estilos.menuAviso}>Carregando os tipos de operação…</div>}
        {!carregando && doMenu.length === 0 && <div className={estilos.menuAviso}>
          {todas.length ? "Nenhuma operação padrão: use Escolher operação." : "Nenhuma operação disponível para lançamento."}
        </div>}
        {doMenu.map((l) => <DropdownP.Item key={l.id} className={estilos.mi} data-testid={`${prefixoTestid}-novo-top`} data-top-id={l.id} onSelect={() => router.push(fonte.rotaDaTop(l))}>
          <span className={estilos.codigo}>{l.code}</span>
          <span className={estilos.miNome}>{l.name}</span>
          {l.ehPadrao ? <span className={estilos.selo}>Padrão</span> : <span />}
        </DropdownP.Item>)}
        {cortou && <>
          <DropdownP.Separator className={estilos.separador} />
          <DropdownP.Item className={cn(estilos.mi, estilos.miSimples)} data-testid={`${prefixoTestid}-novo-escolher`} onSelect={() => router.push(fonte.rotaDoLancador)}>Escolher operação…</DropdownP.Item>
        </>}
      </DropdownP.Content>
    </DropdownP.Portal>
  </DropdownP.Root>;
}
