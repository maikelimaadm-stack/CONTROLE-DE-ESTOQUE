"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * AVISO DE VERSÃO NOVA PUBLICADA (VENDAS-A3-1d).
 *
 * A aba aberta continua rodando o JavaScript que carregou; depois de um deploy ela conversa com um servidor
 * mais novo sem saber. Esta faixa só AVISA: pergunta a `GET /api/build` (a porta da prova do commit servido,
 * dona `packages/plataforma/src/identidade-build.ts`) e, se o commit publicado mudou, oferece "Atualizar
 * agora". NUNCA recarrega sozinha — recarregar por conta própria descartaria o que a pessoa está digitando.
 *
 * A VERSÃO QUE ESTÁ RODANDO é o primeiro SHA válido lido depois que este bundle carregou. Ela mora no
 * MÓDULO, e não na instância: o módulo vive exatamente enquanto o JavaScript carregado vive, e o shell
 * desmonta e remonta esta faixa sem recarregar a página (troca de sessão/organização volta a `loading`).
 * Numa ref da instância, a remontagem tomaria o SHA NOVO por "o que está rodando" e o aviso sumiria.
 *
 * FAIL-QUIET: SHA desconhecido (`unknown` — deploy sem gatilho git, ver identidade-build), fora do formato,
 * resposta não-OK ou erro de rede não são evidência de versão nova: nada muda. Se a faixa já apareceu, ela
 * fica — uma leitura ruim depois não "desmente" a mudança já vista.
 */

/**
 * Texto da faixa — mora aqui (um dono só): a casca não depende de tela de administração (VENDAS-A3-1d_R1).
 * TESTIDS: versao-nova, versao-nova-atualizar.
 */
export const TEXTO_VERSAO_NOVA = "Saiu uma versão nova do sistema. Atualize a página para usar a versão nova.";

/** SHA completo de commit (o que os provedores injetam). `unknown` e SHA curto não entram. */
const SHA_COMPLETO = /^[0-9a-f]{40}$/;
/** Intervalo da conferência periódica — além dela, `focus` e `visibilitychange` visível. */
const INTERVALO_MS = 5 * 60 * 1000;

/** Versão deste bundle: o primeiro SHA válido visto desde que o módulo carregou. */
const rodando: { sha: string | null } = { sha: null };

function shaDaResposta(corpo: unknown): string | null {
  if (typeof corpo !== "object" || corpo === null) return null;
  const build: unknown = (corpo as { build?: unknown }).build;
  if (typeof build !== "object" || build === null) return null;
  const sha: unknown = (build as { sha?: unknown }).sha;
  return typeof sha === "string" && SHA_COMPLETO.test(sha) ? sha : null;
}

async function lerShaPublicado(): Promise<string | null> {
  try {
    const r = await fetch("/api/build", { cache: "no-store" });
    if (!r.ok) return null;
    return shaDaResposta(await r.json());
  } catch {
    return null;
  }
}

export function FaixaVersaoNova() {
  const [versaoNova, setVersaoNova] = React.useState(false);

  React.useEffect(() => {
    let montado = true;
    let emAndamento = false;
    let conferirDeNovo = false;
    // Uma conferência por vez; um pedido que chega durante outra não se perde — roda UMA vez ao fim dela
    // (a resposta em voo pode ter saído antes do deploy que motivou o novo pedido).
    const conferir = async (): Promise<void> => {
      if (emAndamento) { conferirDeNovo = true; return; }
      emAndamento = true;
      try {
        const sha = await lerShaPublicado();
        if (!montado || sha === null) return;
        if (rodando.sha === null) { rodando.sha = sha; return; }
        if (sha !== rodando.sha) setVersaoNova(true);
      } finally {
        emAndamento = false;
        if (montado && conferirDeNovo) { conferirDeNovo = false; void conferir(); }
      }
    };
    const aoFocar = () => { void conferir(); };
    const aoMudarVisibilidade = () => { if (document.visibilityState === "visible") void conferir(); };

    void conferir();
    const intervalo = window.setInterval(() => { void conferir(); }, INTERVALO_MS);
    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      montado = false;
      window.clearInterval(intervalo);
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, []);

  if (!versaoNova) return null;
  return <div data-testid="versao-nova" role="status" className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-100 px-3 py-1.5 text-[12.5px] text-amber-900">
    <span>{TEXTO_VERSAO_NOVA}</span>
    <Button type="button" variant="outline" size="sm" data-testid="versao-nova-atualizar" onClick={() => window.location.reload()}>Atualizar agora</Button>
  </div>;
}
