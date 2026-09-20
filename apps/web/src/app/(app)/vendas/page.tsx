"use client";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import { Workspace, FilterChips, useUrlParam, tab } from "@/components/workspace";
import { DocumentosDeVendaList } from "@/features/sales/sales-list";
import { LancadorUnificadoDeVendas } from "@/features/sales/lancador-unificado";
import { variantesDeVenda } from "@/features/sales/variantes";

/**
 * PORTAL DE VENDAS — UMA LISTA DE DOCUMENTOS COMERCIAIS, O TIPO COMO FILTRO.
 *
 * O portal é a área; `kind` continua sendo documento DISTINTO — orçamento, pedido e venda mantêm regra,
 * permissão, endpoint e efeito contábil próprios (docs/PORTAIS-OPERACIONAIS-CONTRACT.md). O que deixou de
 * ser navegação é a BUSCA: as três abas viraram uma lista com filtro de tipo, porque procurar o documento
 * de um cliente em três telas era a tabela vazando para a interface.
 *
 * O TÍTULO SAI DO REGISTRY, e não da palavra "portal" (`CLAUDE.md`: "Sem segundo SSOT: navegação em
 * apps/web/nav.registry.mjs"). O literal aqui é o MESMO do registry, como nas outras telas `Workspace`.
 *
 * COMPATIBILIDADE DE URL: `/vendas/budgets` e `/vendas?tab=budgets` continuam válidos. O redirecionamento
 * (`redirects.mjs`) e a canonicalização de abas antigas (`LEGACY_TABS` em `nav.registry.mjs`) levam os dois
 * à lista única JÁ FILTRADA (`?tab=documentos&kind=budget`), com o chip do tipo aceso e removível. Nenhum
 * favorito antigo vira 404, e nenhum deles continua abrindo uma tela que não existe mais.
 */
function Documentos() {
  const { can } = useAuth(); const tr = useTradutor();
  // `kind` é parâmetro ESTÁVEL de navegação (`STABLE_PARAMS`): sobrevive ao refresh, ao Voltar/Avançar e
  // ao favorito. É o mesmo mecanismo das movimentações da pecuária — filtro na URL, não aba.
  const [kind, setKind] = useUrlParam("kind", "");
  // Só os tipos que o usuário pode LER aparecem no seletor. Quem recorta LINHA é o servidor; esconder o
  // chip apenas para de oferecer um recorte que voltaria vazio.
  const visiveis = variantesDeVenda().filter((v) => can(`${v.perm}.view`));
  // Tipo pedido que não existe ou que o usuário não pode ver NÃO vira recorte parcial nem erro: a lista
  // volta a ser "Todos". Pedido da URL é pedido, e o servidor continua sendo quem autoriza.
  const atual = visiveis.some((v) => v.variante === kind) ? kind : "";
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print">
      <FilterChips label="Tipo de documento" testId="vendas-tipo" value={atual || "all"} onChange={(v) => setKind(v === "all" ? "" : v)}
        options={[{ value: "all", label: "Todos" }, ...visiveis.map((v) => ({ value: v.variante, label: tr(v.chaveI18n) }))]} />
    </div>
    <DocumentosDeVendaList kind={atual} />
  </div>;
}

function Inner() {
  return <Workspace title="Vendas" defaultTab="documentos" actions={<LancadorUnificadoDeVendas />}
    tabs={[tab("vendas.documentos", <Documentos />)]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
