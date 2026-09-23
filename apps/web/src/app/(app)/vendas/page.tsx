"use client";
import * as React from "react";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import { Workspace, useUrlParam, tab } from "@/components/workspace";
import { useWorkspaceImersivo } from "@/components/layout/workspace-imersivo";
import { DocumentosDeVendaList } from "@/features/sales/sales-list";
import { NovoDocumentoDeVenda } from "@/features/sales/lancador-unificado";
import { SeletorDeTipoDeDocumento, TODOS_OS_TIPOS } from "@/features/sales/seletor-tipo-documento";
import { variantesDeVenda } from "@/features/sales/variantes";
import estilos from "@/features/sales/portal-vendas.module.css";

/**
 * PORTAL DE VENDAS — UMA LISTA DE DOCUMENTOS COMERCIAIS, O TIPO COMO CONTEXTO.
 *
 * O portal é a área; `kind` continua sendo documento DISTINTO — orçamento, pedido e venda mantêm regra,
 * permissão, endpoint e efeito contábil próprios (docs/PORTAIS-OPERACIONAIS-CONTRACT.md). O que deixou de
 * ser navegação é a BUSCA: as três abas viraram uma lista com filtro de tipo, porque procurar o documento
 * de um cliente em três telas era a tabela vazando para a interface.
 *
 * ┌─ A TELA DO DESIGN (VISUAL-UX-01 R3, docs/DECISIONS.md 228) ────────────────────────────────────┐
 * │ A PRIMEIRA barra é a ferramenta: "Tipo · <valor>" e o `Novo` dividido à esquerda; anexos, modo  │
 * │ de visão e mais opções à direita — a barra do motor da listagem, com o contexto dentro dela.    │
 * │ Sem cartão de título e sem trilha acima (o h1 continua na árvore, visualmente escondido; a       │
 * │ trilha cede o lugar pela mesma regra de dois lados do workspace imersivo). Filtros, grade,       │
 * │ rodapé e modos de visão são os do motor, intactos.                                               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * O TÍTULO SAI DO REGISTRY, e não da palavra "portal" (`CLAUDE.md`: "Sem segundo SSOT: navegação em
 * apps/web/nav.registry.mjs"). O literal aqui é o MESMO do registry, como nas outras telas `Workspace`.
 *
 * COMPATIBILIDADE DE URL: `/vendas/budgets` e `/vendas?tab=budgets` continuam válidos. O redirecionamento
 * (`redirects.mjs`) e a canonicalização de abas antigas (`LEGACY_TABS` em `nav.registry.mjs`) levam os dois
 * à lista única JÁ FILTRADA (`?tab=documentos&kind=budget`), com o Tipo daquele documento escolhido na
 * barra. Nenhum favorito antigo vira 404, e nenhum deles continua abrindo uma tela que não existe mais.
 */
function Documentos() {
  // a trilha cede o lugar SÓ enquanto o portal está montado (e a rota admite): o mesmo contrato da Central
  useWorkspaceImersivo();
  const { can } = useAuth(); const tr = useTradutor();
  // `kind` é parâmetro ESTÁVEL de navegação (`STABLE_PARAMS`): sobrevive ao refresh, ao Voltar/Avançar e
  // ao favorito. É o mesmo mecanismo das movimentações da pecuária — filtro na URL, não aba.
  const [kind, setKind] = useUrlParam("kind", "");
  // Só os tipos que o usuário pode LER aparecem no seletor. Quem recorta LINHA é o servidor; esconder a
  // opção apenas para de oferecer um recorte que voltaria vazio.
  const visiveis = variantesDeVenda().filter((v) => can(`${v.perm}.view`));
  // Tipo pedido que não existe ou que o usuário não pode ver NÃO vira recorte parcial nem erro: a lista
  // volta a ser "Todos". Pedido da URL é pedido, e o servidor continua sendo quem autoriza.
  const atual = visiveis.some((v) => v.variante === kind) ? kind : "";
  // A ORDEM DO DESIGN: do documento final para o inicial (Venda, Pedido, Orçamento). É a ordem do registry
  // invertida — nenhuma lista de tipos é escrita aqui.
  const opcoes = [...visiveis].reverse().map((v) => ({ value: v.variante, label: tr(v.chaveI18n) }));
  const rotuloDoTipo = opcoes.find((o) => o.value === atual)?.label ?? TODOS_OS_TIPOS;
  const focarTipo = React.useRef(false);
  const barra = <span className={estilos.contexto} role="group" aria-label="Contexto operacional">
    <SeletorDeTipoDeDocumento valor={atual} opcoes={opcoes} focarAoMontar={focarTipo} onChange={(v) => { focarTipo.current = true; setKind(v); }} />
    <NovoDocumentoDeVenda variante={atual} rotuloDoTipo={rotuloDoTipo} />
  </span>;
  // A âncora da LISTA ÚNICA fica no invólucro: `DocList`/`Base1List` são o motor genérico e não recebem
  // identificador de tela — marcar a tela por dentro do motor marcaria todas as outras.
  return <div data-testid="vendas-documentos" data-kind={atual} className="flex min-h-0 flex-1 flex-col">
    <DocumentosDeVendaList kind={atual} barra={barra} />
  </div>;
}

function Inner() {
  return <Workspace title="Vendas" defaultTab="documentos" cabecalho="oculto" tabs={[tab("vendas.documentos", <Documentos />)]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
