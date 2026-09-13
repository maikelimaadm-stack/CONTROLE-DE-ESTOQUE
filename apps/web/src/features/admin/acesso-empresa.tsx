"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { NativeSelect } from "@/components/ui";
import { useTradutor } from "@/lib/i18n";

/**
 * ACESSO POR EMPRESA — a metade "ONDE" da autorização (docs/MULTI-COMPANY-CONTRACT.md §7).
 *
 * Uma linha por MÓDULO de negócio: modo (nenhuma / todas / selecionadas) e, no modo `selecionadas`, quais
 * empresas. Módulo sem linha = NENHUMA empresa — é o que o servidor faz, e é o que a tela mostra; a interface
 * não inventa "todas" para configuração ausente.
 *
 * A tela é informativa sobre a interseção: módulo em que o PERFIL não tem permissão aparece desabilitado,
 * porque escopo sem capacidade não dá acesso a nada. Isso é ajuda ao administrador, NUNCA a autorização —
 * quem decide é o servidor, e um módulo desabilitado aqui continua sendo enviado como está (trocar de perfil
 * não apaga em silêncio o acesso por empresa já configurado).
 */
export interface EscopoEmpresa { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] }
interface Modulo { chave: string; nome: string; tem_permissao: boolean | null }
type Tradutor = (chave: string, parametros?: Record<string, string | number>) => string;

/** Resumo de uma linha da lista de usuários: "3 módulos • 2 com todas as empresas". */
export function resumoEscopos(escopos: readonly EscopoEmpresa[], tr: Tradutor): string {
  if (!escopos.length) return tr("acesso_empresa.modo_nenhuma");
  const todas = escopos.filter((e) => e.modo === "todas").length;
  const selecionadas = escopos.filter((e) => e.modo === "selecionadas").length;
  const partes: string[] = [];
  if (todas) partes.push(`${todas} × ${tr("acesso_empresa.modo_todas").toLowerCase()}`);
  if (selecionadas) partes.push(`${selecionadas} × ${tr("acesso_empresa.modo_selecionadas").toLowerCase()}`);
  return partes.join(" • ");
}

export function AcessoPorEmpresa({ roleId, empresas, valor, onChange }: {
  roleId: string;
  empresas: { id: string; name: string }[];
  valor: EscopoEmpresa[];
  onChange: (v: EscopoEmpresa[]) => void;
}) {
  const tr = useTradutor();
  const modulos = useQuery({
    queryKey: ["modulos-empresa", roleId],
    queryFn: () => api<{ items: Modulo[] }>(`/api/admin/modulos-empresa${qs({ role_id: roleId || undefined })}`)
  });
  const atual = (chave: string) => valor.find((e) => e.modulo === chave);
  const definir = (chave: string, novo: EscopoEmpresa | null) => {
    const outros = valor.filter((e) => e.modulo !== chave);
    onChange(novo ? [...outros, novo].sort((a, b) => a.modulo.localeCompare(b.modulo)) : outros);
  };
  return <div className="flex flex-col gap-1">
    {(modulos.data?.items ?? []).map((m) => {
      const e = atual(m.chave);
      const modo = e?.modo ?? "";
      const semPermissao = m.tem_permissao === false;
      return <div key={m.chave} className={semPermissao ? "rounded border border-dashed px-2 py-1 opacity-60" : "rounded border px-2 py-1"}>
        <div className="flex items-center gap-2">
          <span className="w-40 shrink-0 text-xs font-medium">{m.nome}</span>
          <NativeSelect value={modo} className="w-56 text-xs" aria-label={`${tr("acesso_empresa.modo")} — ${m.nome}`}
            onChange={(ev) => {
              const v = ev.target.value;
              definir(m.chave, v === "" ? null : { modulo: m.chave, modo: v as EscopoEmpresa["modo"], empresas: v === "selecionadas" ? (e?.empresas ?? []) : [] });
            }}>
            <option value="">{tr("acesso_empresa.modo_nenhuma")}</option>
            <option value="todas">{tr("acesso_empresa.modo_todas")}</option>
            <option value="selecionadas">{tr("acesso_empresa.modo_selecionadas")}</option>
          </NativeSelect>
          {semPermissao && <span className="text-[11px] text-slate-500">{tr("acesso_empresa.sem_permissao")}</span>}
        </div>
        {modo === "selecionadas" && <div className="mt-1 flex flex-wrap gap-2 pl-40">
          {empresas.map((f) => <label key={f.id} className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs">
            <input type="checkbox" checked={(e?.empresas ?? []).includes(f.id)}
              onChange={(ev) => definir(m.chave, { modulo: m.chave, modo: "selecionadas", empresas: ev.target.checked ? [...(e?.empresas ?? []), f.id] : (e?.empresas ?? []).filter((x) => x !== f.id) })} />
            {f.name}
          </label>)}
          {!(e?.empresas ?? []).length && <span className="text-[11px] text-red-600">{tr("acesso_empresa.selecione_empresas")}</span>}
        </div>}
      </div>;
    })}
  </div>;
}
