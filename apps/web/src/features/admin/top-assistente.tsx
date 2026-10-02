"use client";
import { Button } from "@/components/ui";
import { tiposParaEscolhaTop, type CatalogoTop, type TipoDeMovimentoTop } from "@agro/domain";

/**
 * O PASSO 1 DA CRIAÇÃO DA TOP — O TIPO DE MOVIMENTO (OPERACOES-01 F4, decisão 281).
 *
 * ┌─ O QUE ESTA TELA DECIDE, E O QUE ELA NÃO DECIDE ───────────────────────────────────────────────────┐
 * │ Ela só MOSTRA os tipos que o catálogo publicado pelo servidor oferece para escolha                   │
 * │ (`tiposParaEscolhaTop`: os que já têm tela, agrupados na ordem do catálogo; grupo sem nenhum some),  │
 * │ e devolve o escolhido. Nenhum grupo, tipo ou família é escrito aqui: a lista é a do domínio, lida    │
 * │ das capacidades pelo leitor estrito (`catalogoDoEditor`). Os tipos "sem tela ainda" (requisição,     │
 * │ consumo, orçamento de compra, os módulos, o financeiro…) ficam fora até a fase que cria a tela os    │
 * │ ligar — sem nenhuma mudança neste arquivo.                                                          │
 * │                                                                                                      │
 * │ O que vem depois (as abas, os rótulos do tipo, a volta ao padrão do que ele não aceita) é do editor  │
 * │ (`top-editor.tsx`), pelo perfil do mesmo catálogo. O servidor continua sendo a autoridade: ele       │
 * │ recusa (422) no formato 5 o que o tipo não aceita, para qualquer cliente.                           │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Os botões quebram linha (`flex-wrap`): cabe em 360 px sem rolagem lateral (`docs/UI-SUPPORT-MATRIX.md`).
 */

/** O texto do passo, letra por letra (o E2E o confere por extenso). */
export const TEXTO_PASSO_1_TOP = "Passo 1 de 2: escolha o tipo de movimento. Depois, as abas mostram só o que vale para ele.";

/** Um tipo que pode ser escolhido: tem família (o leitor do catálogo já recusa "tem tela" sem família). */
export type TipoEscolhivelTop = TipoDeMovimentoTop & { readonly familia: string };

const temFamilia = (t: TipoDeMovimentoTop): t is TipoEscolhivelTop => t.familia !== null;

export function AssistenteTipoDeMovimento({ catalogo, onEscolher }: {
  /** O catálogo QUE O SERVIDOR PUBLICOU (`catalogoDoEditor`), nunca o importado do domínio. */
  catalogo: CatalogoTop;
  onEscolher: (t: TipoEscolhivelTop) => void;
}) {
  // Defesa em profundidade: o leitor estrito já garante família em todo tipo com tela; um tipo sem família nunca vira
  // botão (escolhê-lo criaria uma TOP sem movimento), e o grupo que ficasse vazio por isso some.
  const grupos = tiposParaEscolhaTop(catalogo)
    .map(({ grupo, tipos }) => ({ grupo, tipos: tipos.filter(temFamilia) }))
    .filter((g) => g.tipos.length > 0);

  return <div data-testid="top-assistente" className="space-y-4">
    <p data-testid="top-assistente-passo" className="text-[12px] leading-relaxed text-slate-500">{TEXTO_PASSO_1_TOP}</p>
    {grupos.map(({ grupo, tipos }) => <section key={grupo.chave} data-testid={`top-assistente-grupo-${grupo.chave}`}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{grupo.rotulo}</h3>
      <div role="group" aria-label={grupo.rotulo} className="flex flex-wrap gap-2">
        {tipos.map((t) => <Button
          key={t.chave}
          type="button"
          variant="outline"
          size="sm"
          data-testid={`top-assistente-tipo-${t.chave}`}
          data-familia={t.familia}
          onClick={() => onEscolher(t)}
        >{t.rotulo}</Button>)}
      </div>
    </section>)}
  </div>;
}
