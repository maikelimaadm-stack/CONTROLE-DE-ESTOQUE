"use client";
import { useSearchParams } from "next/navigation";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { TelaLayouts } from "./layout-configurador/tela";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › LAYOUTS DE DOCUMENTO (VENDAS-A3-1, decisão 259; tela única na VENDAS-A3-1d, decisão 262).
 *
 * O layout governa só a DIGITAÇÃO da Central de Vendas (o que aparece, em que ordem, com que rótulo, o que é
 * obrigatório). A regra mora no domínio (`layout-documento.ts`); o servidor refaz a validação na gravação.
 *
 * A tela é uma só (`TelaLayouts`): a grade dos layouts em cima, com a barra de ações e o filtro de movimento, e a área
 * de configuração da linha selecionada logo abaixo. A rota `/configuracoes/layouts-documento/<id>` monta este mesmo
 * painel com a linha já selecionada (`idInicial`). `can()` só ESCONDE botão; quem nega é a rota (`tipos_operacao.*`).
 */
export function LayoutsDocumentoPanel({ idInicial }: { idInicial?: string } = {}) {
  /**
   * VENDAS-A3-1d_R1 — na tela de Configurações (sem `idInicial`) a seleção MORA NO ENDEREÇO (`&layout=<id>`): voltar da
   * Central (Voltar do navegador ou a aba de trabalho, que guarda o último endereço) reabre a mesma linha. A rota de
   * detalhe `/configuracoes/layouts-documento/<id>` é uma aba por id: nela a tela não escreve no endereço.
   */
  const params = useSearchParams();
  const naLista = idInicial === undefined;
  const doEndereco = naLista ? params.get("layout") || undefined : undefined;
  return <Card>
    <PageHeader
      inCard
      title="Layouts de documento"
      subtitle="O que a Central de Vendas mostra, em que ordem, com que rótulo e o que é obrigatório ao salvar. A TOP usa o layout ligado a ela; sem ligação, o padrão do movimento; sem padrão, o layout do sistema."
    />
    <CardBody>
      <TelaLayouts idInicial={idInicial ?? doEndereco} sincronizarEndereco={naLista} />
    </CardBody>
  </Card>;
}
