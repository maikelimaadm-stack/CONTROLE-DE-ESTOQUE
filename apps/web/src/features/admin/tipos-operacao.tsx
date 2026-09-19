"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTimeBR } from "@/lib/utils";
import { COPY } from "@/lib/copy";
import {
  Badge, Button, Card, CardBody, ConfirmDialog, Dialog, EmptyState, ErrorState,
  Field, Input, LoadingState, Menu, NativeSelect, PageHeader, StatusBadge, Textarea
} from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › TIPOS DE OPERAÇÃO (TOP-CONFIG-01).
 *
 * O que esta tela configura é a TOP da ORGANIZAÇÃO — "2103 — Venda de Gado a Prazo" —, que aponta para uma
 * FAMÍLIA OPERACIONAL canônica do produto (`vendas.venda`). As famílias NÃO são editáveis aqui e não têm
 * lista própria neste arquivo: elas vêm do servidor, que as deriva do registry. Uma segunda lista no cliente
 * nasceria desatualizada na primeira família nova e ninguém perceberia.
 *
 * `can()` aqui só ESCONDE botão. Quem nega é a rota — todas as ações abaixo respondem 403 no servidor para
 * quem não tem a capacidade, e o teste de integração prova isso nas quatro ações.
 */
interface Familia { codigo: string; rotulo: string; modulo: string | null }
/** O índice existe porque `DataTable` é genérica sobre `Record<string, unknown>`; os campos continuam tipados. */
interface TipoOperacao extends Record<string, unknown> {
  id: string; codigo: string; nome: string; descricao: string | null;
  familia: Familia; ativo: boolean; padrao: boolean; versao: number; revisao: number;
  criadoEm: string; atualizadoEm: string;
}
interface Versao extends Record<string, unknown> {
  versao: number; nome: string; descricao: string | null; criadoEm: string; criadoPor: string | null;
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
    mutationFn: (t: TipoOperacao) => api(`/api/admin/tipos-operacao/${t.id}`, { method: "DELETE" }),
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

    {criando && <FormularioTipoOperacao
      familias={familias.data?.items ?? []}
      onFechar={() => setCriando(false)}
      onPronto={() => { setCriando(false); recarregar(); }}
    />}
    {editando && <FormularioTipoOperacao
      registro={editando}
      familias={familias.data?.items ?? []}
      onFechar={() => setEditando(null)}
      onPronto={() => { setEditando(null); recarregar(); }}
    />}
    {vendoVersoes && <HistoricoDeVersoes registro={vendoVersoes} onFechar={() => setVendoVersoes(null)} />}
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

/**
 * Formulário de criação e edição.
 *
 * Na EDIÇÃO, código e família aparecem apenas para leitura: mudá-los reclassificaria retroativamente tudo o
 * que já citou este tipo de operação. A rota recusa a troca (409) e o banco também — a tela apenas não
 * oferece o caminho.
 */
function FormularioTipoOperacao({ registro, familias, onFechar, onPronto }: {
  registro?: TipoOperacao; familias: Familia[]; onFechar: () => void; onPronto: () => void;
}) {
  const edicao = !!registro;
  const [codigo, setCodigo] = React.useState(registro?.codigo ?? "");
  const [nome, setNome] = React.useState(registro?.nome ?? "");
  const [descricao, setDescricao] = React.useState(registro?.descricao ?? "");
  const [codigoBase, setCodigoBase] = React.useState(registro?.familia.codigo ?? "");
  const [ativo, setAtivo] = React.useState(registro?.ativo ?? true);
  const [padrao, setPadrao] = React.useState(registro?.padrao ?? false);
  const [erro, setErro] = React.useState<unknown>(null);

  const salvar = useMutation({
    mutationFn: () => edicao
      ? api(`/api/admin/tipos-operacao/${registro!.id}`, {
          method: "PUT",
          body: { nome, descricao: descricao || null, ativo, padrao, revisao: registro!.revisao }
        })
      : api("/api/admin/tipos-operacao", {
          method: "POST",
          body: { codigo, codigoBase, nome, descricao: descricao || null, ativo, padrao }
        }),
    onSuccess: onPronto,
    onError: setErro
  });

  const valido = nome.trim().length > 0 && (edicao || (codigo.trim().length > 0 && codigoBase.length > 0));

  return <Dialog
    open
    onOpenChange={(o) => { if (!o) onFechar(); }}
    title={edicao ? "Editar tipo de operação" : "Novo tipo de operação"}
    description={edicao ? "Alterar o nome ou a descrição cria uma versão nova; o histórico anterior continua legível." : undefined}
    size="lg"
    testId="form-tipo-operacao"
    footer={<>
      <Button variant="ghost" onClick={onFechar}>{COPY.cancelar}</Button>
      <Button onClick={() => salvar.mutate()} disabled={!valido || salvar.isPending}>{COPY.salvar}</Button>
    </>}
  >
    <div className="grid grid-cols-12 gap-3">
      <Field label="Código" required span={3}>
        <Input value={codigo} readOnly={edicao} disabled={edicao} onChange={(e) => setCodigo(e.target.value)} placeholder="2103" />
      </Field>
      <Field label="Nome" required span={9}>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Venda de Gado a Prazo" />
      </Field>
      <Field label="Família operacional" required span={6} help="A família define qual operação do produto este tipo representa. Não muda depois da criação.">
        {edicao
          ? <Input value={`${registro!.familia.rotulo} (${registro!.familia.codigo})`} readOnly disabled />
          : <NativeSelect value={codigoBase} onChange={(e) => setCodigoBase(e.target.value)}>
              <option value="">Selecione…</option>
              {familias.map((f) => <option key={f.codigo} value={f.codigo}>{f.rotulo} — {f.codigo}</option>)}
            </NativeSelect>}
      </Field>
      <Field label={COPY.situacao} span={3}>
        <NativeSelect value={ativo ? "true" : "false"} onChange={(e) => setAtivo(e.target.value === "true")}>
          <option value="true">Ativo</option>
          <option value="false">Inativo</option>
        </NativeSelect>
      </Field>
      <Field label="Padrão da família" span={3} help="No máximo um tipo de operação padrão por família. Ao marcar este, o anterior deixa de ser o padrão.">
        <NativeSelect value={padrao ? "true" : "false"} onChange={(e) => setPadrao(e.target.value === "true")} disabled={!ativo}>
          <option value="false">Não</option>
          <option value="true">Sim</option>
        </NativeSelect>
      </Field>
      <Field label="Descrição" span={12}>
        <Textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </Field>
    </div>
    {erro ? <div className="mt-3"><ErrorState error={erro} /></div> : null}
  </Dialog>;
}

/** Histórico imutável: nenhuma versão é editável aqui, porque nenhuma versão é editável em lugar nenhum. */
function HistoricoDeVersoes({ registro, onFechar }: { registro: TipoOperacao; onFechar: () => void }) {
  const q = useQuery({
    queryKey: [...CHAVE, registro.id, "versoes"],
    queryFn: () => api<{ items: Versao[] }>(`/api/admin/tipos-operacao/${registro.id}/versoes`)
  });
  return <Dialog
    open
    onOpenChange={(o) => { if (!o) onFechar(); }}
    title={`Versões de ${registro.codigo}`}
    description="Cada alteração de nome ou descrição criou uma versão. As versões anteriores não são editáveis."
    size="lg"
    testId="versoes-tipo-operacao"
  >
    {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState error={q.error} /> : <DataTable
      rows={q.data?.items ?? []}
      columns={[
        { key: "versao", label: "Versão", align: "right", width: 90 },
        { key: "nome", label: "Nome" },
        { key: "descricao", label: "Descrição", render: (v: Versao) => v.descricao ?? "—" },
        { key: "criadoEm", label: "Criado em", render: (v: Versao) => dateTimeBR(v.criadoEm) },
        { key: "criadoPor", label: "Criado por", render: (v: Versao) => v.criadoPor ?? "—" }
      ]}
    />}
  </Dialog>;
}
