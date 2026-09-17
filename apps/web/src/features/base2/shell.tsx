"use client";
import * as React from "react";
import { History } from "lucide-react";
import { Button, DetailShell, type Crumb } from "@/components/ui";
import type { EnumDomain } from "@/lib/copy";
import { useAuth } from "@/lib/auth";
import { HistoryDialog } from "@/features/base1/history-dialog";
import type { Base2Historico } from "./types";

/**
 * MOLDURA OFICIAL DO LANÇAMENTO — MODELO BASE 2 (docs/MODELO-BASE2-CONTRACT.md).
 *
 * Compõe o `DetailShell` oficial e acrescenta o que toda tela de lançamento vinha montando à mão:
 * identidade (título + código), situação, empresa do registro, ações e o histórico do registro.
 *
 * TELA UNIFICADA ≠ REGRA UNIFICADA. A moldura não conhece endpoint, não conhece permissão, não sabe
 * o que cancelar um documento significa e não decide o que aparece: recebe tudo por prop. Cada módulo
 * continua dono do seu serviço, da sua validação, dos seus efeitos e das suas ações.
 *
 * O QUE ELA DELIBERADAMENTE NÃO FAZ:
 *
 *  - **Não exibe o ID Global.** O número do registro já é desenhado UMA vez pelo AppShell, ao lado da
 *    trilha (`components/layout/shell.tsx` → `IdGlobalDaRotaAtual`), em toda rota canônica do catálogo —
 *    o que inclui as sete rotas de documento de estoque. Repetir o número aqui daria ao usuário duas
 *    identidades na mesma tela e, pior, duas fontes para mantê-las iguais.
 *  - **Não muda a empresa efetiva.** Ela EXIBE a empresa do registro, que veio do servidor já recortada
 *    por RLS. Trocar de empresa tem uma porta única (`agro:empresa-request`, tratada no shell) e essa
 *    porta não passa por aqui.
 *  - **Não autoriza.** `can()` no cliente esconde botão; quem nega é a rota (CLAUDE.md, "Arquitetura").
 *    Por isso a moldura nem recebe permissão: quem decide exibir uma ação é o módulo, que já tem o
 *    contexto para isso.
 *  - **Não liga ANEXOS.** O slot existe no contrato, não no código: hoje `POST /api/attachments` recusa
 *    as entidades de documento de estoque com 422, porque elas não estão em `ATTACHMENT_PARENTS`
 *    (`apps/api/src/lib/attachment-parent.ts`). Um slot sem consumidor é abstração morta; ele entra
 *    junto com o primeiro piloto que o backend aceite.
 */
export interface Base2ShellProps {
  /** Nome do tipo de lançamento ("Baixa de estoque"). Não é o código do registro. */
  titulo: string;
  /** Código do registro dentro da entidade. Compõe o título e o rótulo da aba. */
  codigo?: React.ReactNode;
  /** Valor técnico da situação (vira `StatusBadge`) ou um nó pronto. */
  situacao?: string | React.ReactNode;
  situacaoDominio?: EnumDomain;
  /** Empresa do registro, como o servidor a devolveu. Apresentação — nunca seleção. */
  empresa?: React.ReactNode;
  voltarHref?: string;
  breadcrumbs?: Crumb[];
  /** Ações do módulo (cancelar, devolver, imprimir…). A moldura não cria nenhuma. */
  acoes?: React.ReactNode;
  /** Liga o botão e o diálogo de histórico oficiais. Omitido = seção de histórico não existe. */
  historico?: Base2Historico;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

export function Base2Shell({
  titulo, codigo, situacao, situacaoDominio = "status", empresa, voltarHref, breadcrumbs,
  acoes, historico, children, className, testId = "base2-shell"
}: Base2ShellProps) {
  const { can } = useAuth();
  const [histAberto, setHistAberto] = React.useState(false);
  // mesma composição de título de antes da moldura: o rótulo da aba de trabalho não pode mudar de forma
  const tituloCompleto = codigo === null || codigo === undefined || codigo === "" ? titulo : `${titulo} ${String(codigo)}`;
  const mostrarHistorico = Boolean(historico) && can("audit_logs.view");

  return (
    <DetailShell
      className={className}
      testId={testId}
      title={tituloCompleto}
      subtitle={empresa ? <span data-testid="base2-empresa">Empresa: {empresa}</span> : undefined}
      backHref={voltarHref}
      breadcrumbs={breadcrumbs}
      status={situacao}
      statusDomain={situacaoDominio}
      actions={<>
        {acoes}
        {mostrarHistorico && <Button size="sm" variant="outline" data-testid="base2-historico" onClick={() => setHistAberto(true)}><History className="h-3.5 w-3.5" /> Histórico</Button>}
      </>}
    >
      {children}
      {historico && mostrarHistorico && <HistoryDialog open={histAberto} onOpenChange={setHistAberto} entity={historico.entidade} entityId={historico.id} title={tituloCompleto} />}
    </DetailShell>
  );
}
