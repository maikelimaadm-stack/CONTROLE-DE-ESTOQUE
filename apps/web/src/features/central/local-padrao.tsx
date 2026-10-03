"use client";
import * as React from "react";
import { RefSelect } from "@/components/ui/ref-select";
import { CampoDaCentral } from "./campo";
import type { LocalDeEstoque, LocalDoCabecalho, PropsDoLocalPadrao } from "./contrato";

export type { LocalDeEstoque, LocalDoCabecalho, PropsDoLocalPadrao } from "./contrato";

/**
 * O "LOCAL DE ESTOQUE" DO CABEÇALHO (OPERACOES-01 F3b, decisão 280) — o local das linhas NOVAS da criação.
 *
 * É estado da TELA, não do documento: nunca entra no corpo do POST/PUT, no "alterado", na cópia do Duplicar nem nas
 * pendências do Salvar (o `warehouse_id` que vai ao servidor é o de cada LINHA, como antes). Cada linha nova nasce com
 * ele (`armazemPadrao` dos itens) e troca o seu na própria célula; trocar o local do cabeçalho não mexe nas linhas que
 * já existem. A Central de Estoque (F5b) é diferente: lá o local do cabeçalho É o gravado no documento.
 */

/**
 * O local do cabeçalho: o `padrao` (o de cadastro do layout, já recortado pela espécie para a empresa do documento) até
 * o usuário escolher. A escolha vale para a empresa em que foi feita: trocar a empresa a LIMPA (vale o padrão da
 * empresa nova) e voltar à anterior não a ressuscita. Sem empresa, nenhum local. `descartar` volta ao padrão.
 */
export function useLocalDoCabecalho(padrao: LocalDeEstoque | null, empresaId: string): LocalDoCabecalho {
  const [escolha, setEscolha] = React.useState<{ empresaId: string; local: LocalDeEstoque | null } | null>(null);
  React.useEffect(() => { if (escolha && escolha.empresaId !== empresaId) setEscolha(null); }, [empresaId, escolha]);
  const local = escolha && escolha.empresaId === empresaId ? escolha.local : empresaId ? padrao : null;
  const escolher = React.useCallback((l: LocalDeEstoque | null) => setEscolha({ empresaId, local: l }), [empresaId]);
  const descartar = React.useCallback(() => setEscolha(null), []);
  return { local, escolher, descartar };
}

/**
 * O campo "Local de estoque" dos Dados principais: só os locais da empresa do documento (desabilitado sem empresa).
 * Não é campo do layout (sem `data-campo`) nem obrigatório. O rótulo da opção acompanha a escolha para a linha nova
 * mostrar o local sem nova leitura; sem rótulo, a célula o lê do cadastro.
 */
export function CampoDoLocalPadrao({ prefixoTestid, empresaId, valor, onChange }: PropsDoLocalPadrao) {
  return <CampoDaCentral rotulo="Local de estoque" icone="pesquisa" preenchido={Boolean(valor)} estado={empresaId ? "editavel" : "desabilitado"}
    testId={`${prefixoTestid}-local-padrao`} dica="Local de estoque das linhas novas. Cada item pode trocar o seu.">
    <RefSelect resource="warehouses" filter={{ empresa_id: empresaId }} value={valor?.id ?? null} labelHint={valor?.rotulo || undefined}
      disabled={!empresaId || undefined}
      onChange={(id, opcao) => onChange(id ? { id, rotulo: opcao?.label ?? (id === valor?.id ? valor.rotulo : "") } : null)} />
  </CampoDaCentral>;
}
