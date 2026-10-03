"use client";
import * as React from "react";
import { CAMPOS_DESTINO_ESTOQUE, type CampoDestinoEstoque, type ColunaDestinoEstoque, type DimensaoDestinoEstoque, type ExigenciaDestinoTop } from "@agro/domain";
import { api } from "@/lib/api";
import { RefSelect, type BuscaDeOpcoes, type Option } from "@/components/ui/ref-select";
import { CampoDaCentral, CampoLeitura } from "@/features/central/campo";
import { PainelColuna } from "@/features/central/painel";

/**
 * O DESTINO NA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282) — para onde vai o que sai do estoque: as seis
 * dimensões do domínio (`CAMPOS_DESTINO_ESTOQUE`, o dono da lista, da ordem e dos rótulos).
 *
 * Na CRIAÇÃO, a aba Destino tem um campo por dimensão que a seção Destino da TOP usa (opcional ou obrigatória, com "*"),
 * na ordem do domínio. As opções vêm do servidor do estoque (`GET /api/estoque/<segmento>/destino/opcoes`), montadas
 * da MESMA tabela que confere o POST: o que a lista oferece o POST aceita. No consumo que atende uma requisição, a
 * dimensão que ela tem aparece TRAVADA, com o nome lido da requisição — e não vai no corpo (o servidor herda).
 * Na CONSULTA, uma linha por dimensão com valor.
 *
 * Só desenho: o valor, a exigência, a pendência e o corpo são do estado da criação.
 */

/** `centroCusto` → `centro-custo` (o sufixo do testid `estoque-destino-<…>`). */
export const sufixoDaDimensao = (chave: DimensaoDestinoEstoque) => chave.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);

/**
 * As opções de UMA dimensão do destino, pelo servidor do estoque. A empresa vai sempre (ela é PEDIDO: o servidor recorta
 * pelo escopo). A busca é a do campo (até 100 caracteres, o limite da rota).
 */
export function opcoesDoDestino(segmento: string, dimensao: DimensaoDestinoEstoque, empresaId: string): BuscaDeOpcoes {
  return {
    chave: `estoque-destino:${segmento}:${dimensao}:${empresaId}`,
    buscar: async (search) => {
      const q = new URLSearchParams({ dimensao, empresa_id: empresaId });
      const busca = search.trim().slice(0, 100);
      if (busca) q.set("busca", busca);
      const r = await api<{ itens: { id: string; codigo: string | null; rotulo: string }[] }>(`/api/estoque/${segmento}/destino/opcoes?${q.toString()}`);
      return r.itens.map((o): Option => ({ id: o.id, label: o.rotulo, code: o.codigo }));
    }
  };
}

/** Uma dimensão como a criação a mostra. `herdada`: vem da requisição de origem, travada, fora do corpo. */
export interface DimensaoDoDestinoNaTela {
  campo: CampoDestinoEstoque;
  exigencia: ExigenciaDestinoTop | "herdada";
  /** O id escolhido (ou o herdado); vazio = nenhum. */
  valor: string;
  /** O rótulo da escolha (ou o nome lido da requisição). */
  rotuloDoValor: string;
}

/** A ABA DESTINO DA CRIAÇÃO (`estoque-central-destino`): um campo por dimensão, na ordem do domínio. */
export function AbaDoDestino({ segmento, empresaId, dimensoes, erro, onEscolher }: {
  segmento: string;
  empresaId: string;
  dimensoes: readonly DimensaoDoDestinoNaTela[];
  erro: (coluna: ColunaDestinoEstoque) => string | undefined;
  onEscolher: (coluna: ColunaDestinoEstoque, id: string, rotulo: string) => void;
}) {
  return <div data-testid="estoque-central-destino"><PainelColuna>
    {dimensoes.map((d) => <CampoDoDestino key={d.campo.chave} segmento={segmento} empresaId={empresaId} d={d} erro={erro(d.campo.coluna)} onEscolher={onEscolher} />)}
  </PainelColuna></div>;
}

function CampoDoDestino({ segmento, empresaId, d, erro, onEscolher }: {
  segmento: string; empresaId: string; d: DimensaoDoDestinoNaTela; erro?: string;
  onEscolher: (coluna: ColunaDestinoEstoque, id: string, rotulo: string) => void;
}) {
  const testId = `estoque-destino-${sufixoDaDimensao(d.campo.chave)}`;
  const busca = React.useMemo(() => opcoesDoDestino(segmento, d.campo.chave, empresaId), [segmento, d.campo.chave, empresaId]);
  if (d.exigencia === "herdada") {
    return <CampoDaCentral rotulo={d.campo.rotulo} estado="travado" testId={testId} data-exigencia="herdada" data-campo={d.campo.coluna} dica="Vem da requisição de origem.">
      {d.rotuloDoValor}
    </CampoDaCentral>;
  }
  const semEmpresa = !empresaId;
  return <CampoDaCentral rotulo={d.campo.rotulo} obrigatorio={d.exigencia === "obrigatoria"} erro={erro} icone="pesquisa" preenchido={Boolean(d.valor)}
    estado={semEmpresa ? "desabilitado" : "editavel"} testId={testId} data-exigencia={d.exigencia} data-campo={d.campo.coluna}>
    {/* o "recurso" é só a chave do cache: as opções e o rótulo vêm do servidor do estoque (nenhum `/api/resources`, nenhum cadastro rápido) */}
    <RefSelect resource="estoque-destino" value={d.valor || null} labelHint={d.valor ? d.rotuloDoValor || "…" : undefined} disabled={semEmpresa || undefined}
      buscarOpcoes={busca} onChange={(id, opcao) => onEscolher(d.campo.coluna, id ?? "", opcao?.label ?? "")} />
  </CampoDaCentral>;
}

/** O DESTINO GRAVADO, na consulta: uma linha por dimensão com valor (o nome que o GET leu); nenhuma → "Sem destino." */
export function DestinoEmLeitura({ valores }: { valores: Partial<Record<ColunaDestinoEstoque, { id: string; nome: string }>> }) {
  const comValor = CAMPOS_DESTINO_ESTOQUE.filter((c) => valores[c.coluna]);
  return <div data-testid="estoque-central-destino"><PainelColuna>
    {comValor.length === 0
      ? <p className="text-[12.5px] text-slate-500">Sem destino.</p>
      : comValor.map((c) => <div key={c.chave} data-testid={`estoque-destino-${sufixoDaDimensao(c.chave)}`} data-valor-id={valores[c.coluna]?.id}>
        <CampoLeitura rotulo={c.rotulo} adorno="pesquisa" valor={valores[c.coluna]?.nome ?? ""} />
      </div>)}
  </PainelColuna></div>;
}
