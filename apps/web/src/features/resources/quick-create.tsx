"use client";
import { ResourceForm } from "./resource-form";
/** Cadastro rápido a partir de um seletor: o mesmo formulário declarativo do cadastro, em um diálogo; ao salvar devolve o registro. Cadastro com `camposRapidos` (ficha em abas) mostra só esses campos. */
export function ResourceQuickCreate({ resourceKey, onCreated, onCancel, preset }: { resourceKey: string; onCreated: (row: Record<string, unknown>) => void; onCancel: () => void; /** recorte do seletor que abriu (ex.: is_client=true): vira valor inicial — o tipo pré-marcado do cadastro rápido */ preset?: Record<string, string> }) {
  return <div className="flex max-h-[75vh] min-h-0 flex-col"><ResourceForm resourceKey={resourceKey} id="new" rapido presetExtra={preset ?? {}} afterSave={(row) => onCreated(row as Record<string, unknown>)} onCancel={onCancel} /></div>;
}
