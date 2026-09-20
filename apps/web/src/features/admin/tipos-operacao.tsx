"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTimeBR } from "@/lib/utils";
import { COPY } from "@/lib/copy";
import {
  Badge, Button, Card, CardBody, ConfirmDialog, EmptyState, ErrorState,
  Input, LoadingState, Menu, NativeSelect, PageHeader, StatusBadge
} from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { EditorTipoOperacao, type FamiliaTop } from "./top-editor";
import { HistoricoDeVersoesTop } from "./top-historico";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO (TOP-CONFIG-01 › TOP-CONFIG-03).
 *
 * A LISTAGEM mora aqui; o EDITOR de sete seções mora em `top-editor.tsx` e o histórico em
 * `top-historico.tsx`. A separação não é estética: o editor conversa com um contrato que pode não existir
 * no servidor do momento (ver `top-contrato.tsx`), e essa conversa não tem por que atravessar a listagem,
 * que funciona em qualquer versão da API.
 *
 * O que esta tela configura é a TOP da ORGANIZAÇÃO — "2103 — Venda de Gado a Prazo" —, que aponta para uma
 * FAMÍLIA OPERACIONAL canônica do produto (`vendas.venda`). As famílias NÃO são editáveis aqui e não têm
 * lista própria neste arquivo: elas vêm do servidor, que as deriva do registry. Uma segunda lista no cliente
 * nasceria desatualizada na primeira família nova e ninguém perceberia.
 *
 * `can()` aqui só ESCONDE botão. Quem nega é a rota — todas as ações abaixo respondem 403 no servidor para
 * quem não tem a capacidade, e o teste de integração prova isso nas quatro ações.
 */
type Familia = FamiliaTop;
/** O índice existe porque `DataTable` é genérica sobre `Record<string, unknown>`; os campos continuam tipados. */
interface TipoOperacao extends Record<string, unknown> {
  id: string; codigo: string; nome: string; descricao: string | null;
  familia: Familia; ativo: boolean; padrao: boolean; versao: number; revisao: number;
  criadoEm: string; atualizadoEm: string;
}
const CHAVE = ["tipos-operacao"] as const;

/** Rótulo humano da família com o código técnico discreto ao lado — o usuário nunca vê só a chave crua. */
function RotuloFamilia({ familia }: { familia: Familia }) {
  return <span>{familia.rotulo} <span className="text-[11px] text-slate-400">{familia.codigo}</span></span>;
}

export function TiposOperacaoPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [pagina, setPagina] = React.useState(1);
  const [tamanho, setTamanho] = React.useState(20);
  const [busca, setBusca] = React.useState("");
  const [filtroAtivo, setFiltroAtivo] = React.useState("");
  const [filtroModulo, setFiltroModulo] = React.useState("");
  const [editando, setEditando] = React.useState<TipoOperacao | null>(null);
  const [criando, setCriando] = React.useState(false);
  const [excluindo, setExcluindo] = React.useState<TipoOperacao | null>(null);
  const [vendoVersoes, setVendoVersoes] = React.useState<TipoOperacao | null>(null);
  const [erro, setErro] = React.useState<unknown>(null);

  // Paginação, busca e filtros são SERVER-SIDE: a página pede o recorte, nunca baixa tudo e filtra na tela.
  const consulta = useQuery({
    queryKey: [...CHAVE, pagina, tamanho, busca, filtroAtivo, filtroModulo],
    queryFn: () => api<{ items: TipoOperacao[]; total: number }>(
      `/api/admin/tipos-operacao${qs({ page: pagina, pageSize: tamanho, search: busca, ativo: filtroAtivo, modulo: filtroModulo })}`)
  });
  const familias = useQuery({
    queryKey: [...CHAVE, "familias"],
    queryFn: () => api<{ items: Familia[] }>("/api/admin/tipos-operacao/familias")
  });

  const modulos = React.useMemo(() => {
    const vistos = new Map<string, string>();
    for (const f of familias.data?.items ?? []) if (f.modulo && !vistos.has(f.modulo)) vistos.set(f.modulo, f.modulo);
    return [...vistos.keys()].sort();
  }, [familias.data]);

  const recarregar = () => { void qc.invalidateQueries({ queryKey: CHAVE }); };

  const mudarEstado = useMutation({
    mutationFn: (v: { t: TipoOperacao; campos: Record<string, unknown> }) =>
      api(`/api/admin/tipos-operacao/${v.t.id}`, { method: "PUT", body: { ...v.campos, revisao: v.t.revisao } }),
    onSuccess: recarregar,
    onError: setErro
  });
  const excluir = useMutation({
    // A revisão da LINHA, como toda escrita: a exclusão tem de perder para uma edição que o servidor já
    // aceitou e esta tela ainda não viu. Vai na query porque DELETE não tem corpo por convenção.
    mutationFn: (t: TipoOperacao) =>
      api(`/api/admin/tipos-operacao/${t.id}?revisao=${t.revisao}`, { method: "DELETE" }),
    onSuccess: () => { setExcluindo(null); recarregar(); },
    onError: (e) => { setExcluindo(null); setErro(e); }
  });

  const podeEditar = can("tipos_operacao.edit");
  const linhas = consulta.data?.items ?? [];

  return <Card>
    <PageHeader
      inCard
      title="Tipos de Operação"
      subtitle="Cada tipo de operação da organização aponta para uma família operacional do produto. Vários tipos podem apontar para a mesma família."
      actions={can("tipos_operacao.create") && <Button size="sm" onClick={() => setCriando(true)}>Novo tipo de operação</Button>}
    />
    <CardBody>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Buscar tipo de operação"
          placeholder="Buscar por código ou nome…"
          className="w-64"
          value={busca}
          onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
        />
        <NativeSelect aria-label="Situação" className="w-40" value={filtroAtivo} onChange={(e) => { setFiltroAtivo(e.target.value); setPagina(1); }}>
          <option value="">Todas as situações</option>
          <option value="true">Ativos</option>
          <option value="false">Inativos</option>
        </NativeSelect>
        <NativeSelect aria-label="Módulo" className="w-48" value={filtroModulo} onChange={(e) => { setFiltroModulo(e.target.value); setPagina(1); }}>
          <option value="">Todos os módulos</option>
          {modulos.map((m) => <option key={m} value={m}>{m}</option>)}
        </NativeSelect>
      </div>

      {erro ? <div className="mb-3"><ErrorState error={erro} onRetry={() => setErro(null)} retryLabel={COPY.fechar} /></div> : null}

      {consulta.isLoading ? <LoadingState /> : consulta.isError ? <ErrorState error={consulta.error} onRetry={recarregar} />
        : linhas.length === 0 ? <EmptyState
            title="Nenhum tipo de operação cadastrado"
            description="Cadastre um tipo de operação para que os lançamentos possam escolhê-lo."
          />
        : <DataTable
            rows={linhas}
            total={consulta.data?.total}
            page={pagina}
            pageSize={tamanho}
            onPage={setPagina}
            onPageSize={(s) => { setTamanho(s); setPagina(1); }}
            actions={(r: TipoOperacao) => <Menu
              trigger={<Button variant="ghost" size="sm" aria-label={COPY.maisOpcoes}>⋯</Button>}
              items={[
                { label: "Ver versões", onClick: () => setVendoVersoes(r) },
                { label: "Editar", onClick: () => setEditando(r), disabled: !podeEditar },
                { label: r.ativo ? "Desativar" : "Ativar", disabled: !podeEditar, onClick: () => mudarEstado.mutate({ t: r, campos: { ativo: !r.ativo } }) },
                { label: "Definir como padrão", disabled: !podeEditar || r.padrao || !r.ativo, onClick: () => mudarEstado.mutate({ t: r, campos: { padrao: true } }) },
                { label: COPY.excluir, danger: true, disabled: !can("tipos_operacao.delete"), onClick: () => setExcluindo(r) }
              ]}
            />}
            columns={[
              { key: "codigo", label: "Código", width: 110 },
              { key: "nome", label: "Nome" },
              { key: "familia", label: "Família operacional", render: (r: TipoOperacao) => <RotuloFamilia familia={r.familia} /> },
              { key: "modulo", label: "Módulo", render: (r: TipoOperacao) => r.familia.modulo ?? "—" },
              { key: "ativo", label: COPY.situacao, render: (r: TipoOperacao) => <StatusBadge domain="status" value={r.ativo ? "active" : "inactive"} /> },
              { key: "padrao", label: "Padrão", render: (r: TipoOperacao) => r.padrao ? <Badge tone="blue">Padrão</Badge> : <span className="text-slate-400">—</span> },
              { key: "versao", label: "Versão", align: "right", render: (r: TipoOperacao) => r.versao },
              { key: "atualizadoEm", label: "Atualizado", render: (r: TipoOperacao) => dateTimeBR(r.atualizadoEm) }
            ]}
          />}
    </CardBody>

    {criando && <EditorTipoOperacao
      familias={familias.data?.items ?? []}
      onFechar={() => setCriando(false)}
      onPronto={() => { setCriando(false); recarregar(); }}
    />}
    {editando && <EditorTipoOperacao
      id={editando.id}
      revisaoConhecida={editando.revisao}
      familias={familias.data?.items ?? []}
      onFechar={() => setEditando(null)}
      onPronto={() => { setEditando(null); recarregar(); }}
    />}
    {vendoVersoes && <HistoricoDeVersoesTop id={vendoVersoes.id} codigo={vendoVersoes.codigo} onFechar={() => setVendoVersoes(null)} />}
    <ConfirmDialog
      open={!!excluindo}
      onOpenChange={(o) => { if (!o) setExcluindo(null); }}
      title="Excluir tipo de operação"
      description={excluindo ? `O tipo de operação ${excluindo.codigo} deixa de ser oferecido em novos lançamentos. O histórico de versões é preservado e o código não volta a ficar disponível.` : ""}
      confirmLabel={COPY.excluir}
      danger
      loading={excluir.isPending}
      onConfirm={() => excluindo && excluir.mutate(excluindo)}
    />
  </Card>;
}
