"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { COPY } from "@/lib/copy";
import { Button, Dialog, ErrorState, Field, Input, NativeSelect } from "@/components/ui";

/**
 * NOVO LAYOUT (VENDAS-A3-1c, decisão 261). "Começar de": o layout do sistema (POST sem estrutura: o servidor copia o do
 * sistema do movimento) ou um layout ATIVO existente do mesmo movimento (POST /:id/duplicar e depois PUT do nome). A
 * caixa "Usar como padrão" chama POST /:id/padrao — o servidor troca o padrão atual. Ao criar, abre a página do layout.
 */
const BASE = "/api/admin/layouts-documento";
const SISTEMA = "sistema";

export interface MovimentoDoLayout { codigo: string; rotulo: string }
interface LayoutOrigem { id: string; nome: string; code: string }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const itens = (v: unknown): unknown[] => (Array.isArray(v) ? v : Array.isArray(obj(v).items) ? (obj(v).items as unknown[]) : []);

export function NovoLayoutDialogo({ familias, onFechar }: { familias: readonly MovimentoDoLayout[]; onFechar: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [familia, setFamilia] = React.useState(familias[0]?.codigo ?? "");
  const [nome, setNome] = React.useState("");
  const [origem, setOrigem] = React.useState(SISTEMA);
  const [padrao, setPadrao] = React.useState(false);

  const existentes = useQuery({
    queryKey: ["layouts-documento", "lista", familia],
    enabled: Boolean(familia),
    queryFn: async () => itens(await api<unknown>(`${BASE}${qs({ familia })}`))
      .map(obj)
      .filter((o) => Boolean(o.ativo ?? o.isActive ?? o.is_active))
      .map((o): LayoutOrigem => ({ id: str(o.id), nome: str(o.nome), code: str(o.code ?? o.codigo) }))
  });

  const criar = useMutation({
    mutationFn: async () => {
      const n = nome.trim();
      let id: string;
      if (origem === SISTEMA) {
        id = str(obj(await api<unknown>(BASE, { method: "POST", body: { familia, nome: n } })).id);
      } else {
        id = str(obj(await api<unknown>(`${BASE}/${origem}/duplicar`, { method: "POST", body: {} })).id);
        await api(`${BASE}/${id}`, { method: "PUT", body: { nome: n } });
      }
      if (padrao) await api(`${BASE}/${id}/padrao`, { method: "POST", body: {} });
      return id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["layouts-documento"] });
      router.push(`/configuracoes/layouts-documento/${id}`);
    }
  });

  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title="Novo layout" size="sm" testId="layout-novo"
    footer={<><Button variant="outline" onClick={onFechar}>{COPY.fechar}</Button><Button data-testid="layout-novo-criar" loading={criar.isPending} disabled={!familia || !nome.trim()} onClick={() => criar.mutate()}>Criar</Button></>}>
    <div className="grid grid-cols-12 gap-3">
      <Field label="Movimento" span={12} required>
        <NativeSelect data-testid="layout-novo-familia" value={familia} onChange={(e) => { setFamilia(e.target.value); setOrigem(SISTEMA); }}>
          {familias.map((f) => <option key={f.codigo} value={f.codigo}>{f.rotulo}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Nome" span={12} required>
        <Input data-testid="layout-novo-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      </Field>
      <Field label="Começar de" span={12}>
        <NativeSelect data-testid="layout-novo-origem" value={origem} onChange={(e) => setOrigem(e.target.value)}>
          <option value={SISTEMA}>Layout do sistema</option>
          {(existentes.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.code ? `${l.code} — ${l.nome}` : l.nome}</option>)}
        </NativeSelect>
      </Field>
      <div className="col-span-12">
        <label className="flex items-center gap-2 text-[12.5px] text-slate-700">
          <input type="checkbox" data-testid="layout-novo-padrao" checked={padrao} onChange={(e) => setPadrao(e.target.checked)} />
          Usar como padrão para este movimento?
        </label>
        {padrao && <p className="mt-1 text-[12px] text-amber-700">O padrão atual deste movimento deixa de ser o padrão.</p>}
      </div>
    </div>
    <p className="mt-2 text-[12px] text-slate-500">
      {origem === SISTEMA ? "O layout nasce como cópia do layout do sistema (a Central de hoje)." : "O layout nasce como cópia do layout escolhido."}
    </p>
    {existentes.isError && <div className="mt-2"><ErrorState error={existentes.error} /></div>}
    {criar.isError && <div className="mt-2"><ErrorState error={criar.error} /></div>}
  </Dialog>;
}
