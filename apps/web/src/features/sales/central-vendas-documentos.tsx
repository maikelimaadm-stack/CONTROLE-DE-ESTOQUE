"use client";
import * as React from "react";
import { Folder } from "lucide-react";
import { useWorkspaceTabs } from "@/lib/workspace-tabs";
import { AcaoDaBarra } from "./central-vendas-workspace";
import estilos from "./central-vendas-workspace.module.css";

/**
 * DOCUMENTOS ABERTOS — uma VISÃO da barra de abas que já existe, nunca uma segunda.
 *
 * A fonte é `useWorkspaceTabs()`: as abas de vendas (criação e registro) que a infraestrutura global já
 * mantém, com o ponto de alteração que ela já sabe (`dirty`). Escolher uma linha chama `focusTab`, a
 * mesma ação da barra de abas. Não há estado próprio além de "o menu está aberto", não há persistência,
 * e não há fechar por linha nem "fechar os já salvos": fechar tem regra (rascunho, confirmação) e essa
 * regra mora na barra de abas — duplicá-la aqui seria o segundo sistema que a fatia proíbe.
 */
export function DocumentosAbertos() {
  const ws = useWorkspaceTabs();
  const [aberto, setAberto] = React.useState(false);
  const ancora = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!ancora.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  if (!ws) return null;
  const docs = ws.tabs.filter((t) => (t.kind === "new" || t.kind === "detail") && t.href.startsWith("/vendas/"));

  return <span className={estilos.docsAncora} ref={ancora}>
    <AcaoDaBarra rotulo="Documentos abertos" dica="fim" aria-haspopup="menu" aria-expanded={aberto} aberta={aberto}
      data-testid="central-vendas-documentos" onClick={() => setAberto((a) => !a)}><Folder aria-hidden /></AcaoDaBarra>
    {docs.length > 0 && <span className={estilos.selo} aria-hidden>{docs.length}</span>}
    {aberto && <div className={estilos.docs} role="menu" aria-label="Documentos abertos" data-testid="central-vendas-documentos-lista">
      <div className={estilos.docsTitulo}>Documentos abertos</div>
      {docs.map((t) => <button key={t.key} type="button" role="menuitem" className={estilos.docsLinha}
        aria-current={t.key === ws.active ? "page" : undefined}
        onClick={() => { setAberto(false); ws.focusTab(t.key); }}>
        <span className={estilos.docsNome}>{t.label}</span>
        {ws.dirty.has(t.key) && <span className={estilos.pontoAlterado} role="img" aria-label="Alterações não salvas" />}
      </button>)}
    </div>}
  </span>;
}
