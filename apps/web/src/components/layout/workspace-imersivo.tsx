"use client";
import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * WORKSPACE IMERSIVO — quando a trilha global cede o lugar à moldura de um workspace de documento
 * (VISUAL-UX-01 R2, docs/DECISIONS.md 226).
 *
 * ┌─ POR QUE UMA DECISÃO DO SHELL, E NÃO CSS NA TELA ──────────────────────────────────────────────┐
 * │ A trilha (`Crumbs`) é renderizada pelo shell ANTES do conteúdo, incondicionalmente. Esconder a   │
 * │ trilha "de dentro" da tela — irmão com `display: none`, `:has`, margem negativa — seria o shell  │
 * │ perdendo a trilha sem saber, e a próxima tela que reaproveitasse o seletor a perderia junto.     │
 * │ Aqui o shell DECIDE, e a decisão tem duas metades que valem juntas (AND):                         │
 * │                                                                                                  │
 * │   1. a ROTA admite workspace imersivo (`ROTAS_IMERSIVAS`, lista estática, uma entrada hoje);      │
 * │   2. o workspace REAL está MONTADO nessa rota e declarou isso (`useWorkspaceImersivo`).            │
 * │                                                                                                  │
 * │ Só a rota não basta: `/vendas/<tipo>/new` sem TOP mostra o LANÇADOR, que é uma tela normal e     │
 * │ mantém a trilha. Só a declaração não basta: um componente reaproveitado em outra rota não pode  │
 * │ apagar a trilha dela. Ao desmontar (trocar de TOP, fechar, navegar), a declaração sai e a trilha │
 * │ volta. Nada disso muda `crumbsFor` nem `nav.registry.mjs`: a trilha continua calculada igual — o │
 * │ shell só deixa de desenhá-la enquanto a moldura do documento ocupa o topo da área de trabalho.   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
const ROTAS_IMERSIVAS: readonly RegExp[] = [/^\/vendas\/[^/]+\/new$/];

export const rotaAdmiteImersao = (pathname: string) => ROTAS_IMERSIVAS.some((re) => re.test(pathname));

type Declarar = (rota: string, montado: boolean) => void;
// dois contextos: quem DECLARA (o workspace) não re-renderiza quando a rota imersiva muda
const DeclararCtx = React.createContext<Declarar | null>(null);
const RotaCtx = React.createContext<string | null>(null);

export function WorkspaceImersivoProvider({ children }: { children: React.ReactNode }) {
  const [rota, setRota] = React.useState<string | null>(null);
  const declarar = React.useCallback<Declarar>((r, montado) => setRota((atual) => (montado ? r : atual === r ? null : atual)), []);
  return <DeclararCtx.Provider value={declarar}><RotaCtx.Provider value={rota}>{children}</RotaCtx.Provider></DeclararCtx.Provider>;
}

/** Chamado pelo workspace de documento enquanto ele está montado. Fora do shell (testes unitários), não faz nada. */
export function useWorkspaceImersivo() {
  const declarar = React.useContext(DeclararCtx); const pathname = usePathname();
  // layout effect: a trilha sai ANTES da primeira pintura, sem piscar nem empurrar a moldura
  React.useLayoutEffect(() => {
    if (!declarar) return;
    declarar(pathname, true);
    return () => declarar(pathname, false);
  }, [declarar, pathname]);
}

/** Pergunta do shell: a trilha desta rota cede o lugar? Só com as DUAS metades valendo. */
export function useTrilhaCedida(pathname: string) {
  const rota = React.useContext(RotaCtx);
  return rota === pathname && rotaAdmiteImersao(pathname);
}
