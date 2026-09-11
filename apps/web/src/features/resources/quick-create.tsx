"use client";
import { ResourceForm } from "./resource-form";
/** Cadastro rápido a partir de um seletor: o mesmo formulário declarativo do cadastro, em um diálogo; ao salvar devolve o registro. */
export function ResourceQuickCreate({ resourceKey, onCreated, onCancel }: { resourceKey: string; onCreated: (row: Record<string, unknown>) => void; onCancel: () => void }) {
  return <div className="flex max-h-[75vh] min-h-0 flex-col"><ResourceForm resourceKey={resourceKey} id="new" afterSave={(row) => onCreated(row as Record<string, unknown>)} onCancel={onCancel} /></div>;
}
