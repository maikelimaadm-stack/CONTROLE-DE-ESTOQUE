"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/lib/toast";
import { campoVisivel, getResource, ehCadastroCodigoHierarquico, type FieldDef } from "@agro/domain";
import { filterKindOf } from "@agro/shared";
import { api, qs, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR } from "@/lib/utils";
import { Badge } from "@/components/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Base1List, type RecordProps } from "@/features/base1/list";
import type { Base1Column, Base1FilterDef, Row } from "@/features/base1/types";
import { ResourceForm } from "./resource-form";
import { ImportDialog } from "./import-dialog";
import { ArvoreTela } from "./arvore-tela";
import { PillBtn } from "@/features/base1/ui";
import { FolderTree, List } from "lucide-react";

export function formatCell(f: FieldDef, row: Record<string, unknown>) {
  const v = row[f.name];
  if (f.type === "ref") return (row[`${f.name}_label`] as string) ?? "";
  if (v === null || v === undefined || v === "") return "";
  switch (f.type) {
    case "money": return brl(v as string);
    case "quantity": case "number": return num(v as string, 2);
    case "percent": return num(v as string, 2) + "%";
    case "date": return dateBR(v as string);
    case "boolean": return v ? <Badge tone="green">Sim</Badge> : <Badge>Não</Badge>;
    case "select": return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
    case "tags": return (v as string[]).map((t) => f.options?.find((o) => o.value === t)?.label ?? t).join(", ");
    case "json": return <span className="text-slate-400">{"{…}"}</span>;
    default: return String(v);
  }
}
/** Texto simples da célula (tooltip, cards, CSV). */
export function cellText(f: FieldDef, row: Record<string, unknown>): string {
  const v = row[f.name];
  if (f.type === "ref") return String(row[`${f.name}_label`] ?? "");
  if (v === null || v === undefined || v === "") return "";
  switch (f.type) {
    case "money": return brl(v as string);
    case "quantity": case "number": return num(v as string, 2);
    case "percent": return num(v as string, 2) + "%";
    case "date": return dateBR(v as string);
    case "boolean": return v ? "Sim" : "Não";
    case "select": return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
    case "tags": return (v as string[]).map((t) => f.options?.find((o) => o.value === t)?.label ?? t).join(", ");
    case "json": return "{…}";
    default: return String(v);
  }
}

/** Primeira coluna de um cadastro em árvore: recuo por nível, botão de recolher o ramo e sintético em negrito. */
function CelulaArvore({ row, recolhido, alternar, children }: { row: Row; recolhido: boolean; alternar: (id: string) => void; children: React.ReactNode }) {
  const nivel = Number(row["nivel"] ?? 0); const id = String(row["id"]);
  return <span className={row["kind"] === "synthetic" ? "inline-flex items-center gap-1 font-semibold" : "inline-flex items-center gap-1"} style={{ paddingLeft: nivel * 16 }}>
    {row["tem_filhos"] ? <button type="button" data-testid="arvore-alternar" aria-expanded={!recolhido} aria-label={recolhido ? "Expandir" : "Recolher"} className="rounded p-0.5 text-slate-500 hover:bg-slate-100" onClick={(e) => { e.stopPropagation(); alternar(id); }}>{recolhido ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button> : <span className="inline-block w-[18px]" />}
    {children}
  </span>;
}

/**
 * Aviso da importação numa lista com filtro fixo (Pessoas › Funcionários): o registro importado só aparece aqui se
 * a planilha preencher a coluna do filtro. Só entra o filtro que se diz em palavras (sim/não, opção de lista);
 * referência e outros tipos ficam de fora. Sem nenhum dizível, não há aviso.
 */
function avisoDeFiltroFixo(fields: FieldDef[], fixed: Record<string, string>): string | undefined {
  const condicoes = Object.entries(fixed).flatMap(([nome, valor]) => {
    const f = fields.find((x) => x.name === nome);
    const rotulo = f?.type === "boolean" ? (valor === "true" ? "Sim" : valor === "false" ? "Não" : undefined) : f?.type === "select" ? f.options?.find((o) => o.value === valor)?.label : undefined;
    return f && rotulo ? [`${f.label} = ${rotulo}`] : [];
  });
  if (!condicoes.length) return undefined;
  return `Esta lista mostra só registros com ${condicoes.join(" e ")}. Para o registro importado aparecer aqui, preencha ${condicoes.length > 1 ? "essas colunas" : "essa coluna"} na planilha.`;
}

/**
 * Listagem genérica de cadastros no MODELO BASE1: chips de filtro por coluna com valores distintos, grade
 * configurável (colunas, congelar, larguras), cards, modo Registro com o formulário embutido, rodapé com contadores.
 */
export function ResourceList({ resourceKey, title, fixedFilters, basePath, extraRowActions }: { resourceKey: string; title?: string; fixedFilters?: Record<string, string>; basePath?: string; /** ações contextuais por registro (ex.: "Transferir" na máquina) */ extraRowActions?: (row: Row) => { label: string; onClick: () => void; danger?: boolean }[] }) {
  const def = getResource(resourceKey); const router = useRouter(); const sp = useSearchParams(); const { can } = useAuth();
  // campo SIGILOSO sem a permissão (R1-2) não vira coluna, filtro nem busca: a API não o devolve e recusa (403) a
  // pergunta que o use. Só apresentação.
  const fields = React.useMemo(() => (def?.fields ?? []).filter((f) => campoVisivel(f, can)), [def, can]);
  // ordenação LEMBRADA (preferência da tela, inclusive a da organização) por um campo que este usuário não vê: não vai
  // — a API recusaria a listagem inteira com 403
  const sigilosos = React.useMemo(() => new Set((def?.fields ?? []).filter((f) => !campoVisivel(f, can)).map((f) => f.name)), [def, can]);
  // ÁRVORE: o servidor devolve a ordem hierárquica com `nivel`, `ancestrais` e `tem_filhos` quando não há
  // ordenação escolhida. A primeira coluna recua pelo nível e recolhe/expande o ramo; sintético em negrito.
  const [recolhidos, setRecolhidos] = React.useState<Set<string>>(new Set());
  const alternar = React.useCallback((id: string) => setRecolhidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const arvore = Boolean(def?.tree);
  const columns = React.useMemo<Base1Column[]>(() => fields.filter((f) => f.list).map((f, i) => ({ key: f.name, label: f.label, kind: filterKindOf(f.type), sortable: f.type !== "ref" && f.type !== "json", align: ["money", "quantity", "number", "percent", "integer"].includes(f.type) ? "right" : "left", render: (r) => arvore && i === 0 && typeof r["nivel"] === "number" ? <CelulaArvore row={r} recolhido={recolhidos.has(String(r["id"]))} alternar={alternar}>{formatCell(f, r)}</CelulaArvore> : arvore && r["kind"] === "synthetic" ? <span className="font-semibold">{formatCell(f, r)}</span> : formatCell(f, r), text: (r) => cellText(f, r) })), [fields, arvore, recolhidos, alternar]);
  const [importando, setImportando] = React.useState(false);
  const rowVisible = React.useCallback((r: Row) => !Array.isArray(r["ancestrais"]) || !(r["ancestrais"] as string[]).some((a) => recolhidos.has(a)), [recolhidos]);
  const filters = React.useMemo<Base1FilterDef[]>(() => fields.filter((f) => (f.filter || f.list) && f.type !== "json" && f.type !== "textarea" && !(fixedFilters && f.name in fixedFilters)).map((f) => ({ key: f.name, label: f.label, kind: filterKindOf(f.type), mode: "advanced" as const, resource: f.ref?.resource, options: f.options })), [fields, fixedFilters]);
  const urlParams = React.useMemo(() => { const o: Record<string, string> = {}; sp.forEach((v, k) => { if (k !== "view" && k !== "tab" && k !== "sub" && k !== "visao") o[k] = v; }); return o; }, [sp]);
  // TELA DE ÁRVORE (Fase 7): os cadastros com código hierárquico alternam entre a lista em árvore (padrão, a de
  // sempre) e a árvore com ficha ao lado. A visão fica no endereço (`?visao=arvore`) e não vira filtro da lista.
  const comArvore = Boolean(def?.tree) && ehCadastroCodigoHierarquico(resourceKey) && !fixedFilters;
  const visaoArvore = comArvore && sp.get("visao") === "arvore";
  const trocarVisao = (arv: boolean) => { const p = new URLSearchParams(sp.toString()); if (arv) p.set("visao", "arvore"); else p.delete("visao"); const q = p.toString(); router.replace(`${basePath ?? `/cadastros/${resourceKey}`}${q ? `?${q}` : ""}`); };
  if (!def) return <div>Recurso desconhecido</div>;
  const base = basePath ?? `/cadastros/${resourceKey}`;
  const perm = def.permission;
  const searchable = fields.filter((f) => f.search);
  const fixed = fixedFilters ?? {};
  // componente estável (não remonta o formulário a cada renderização da listagem)
  const Record = React.useMemo(() => function ResourceRecord(rp: RecordProps) { return <ResourceForm resourceKey={resourceKey} id={rp.row ? String(rp.row["id"]) : "new"} basePath={base} embedded={{ mode: rp.mode, row: rp.row, setMode: rp.setMode, onExit: rp.onExit, refresh: rp.refresh, copyFrom: rp.copyFrom, rightSlot: rp.rightSlot, nav: { index: rp.index, total: rp.total, go: rp.go } }} />; }, [resourceKey, base]);
  const podeImportar = Boolean(def.importacao) && can(`${perm}.create`);
  const importacaoMenu = podeImportar ? [
    { key: "baixar-modelo", label: "Baixar modelo de importação", onClick: () => { void download(`/api/imports/${resourceKey}/modelo`, `modelo-${resourceKey}.xlsx`).catch(() => toast.error("Falha ao baixar o modelo")); } },
    { key: "importar", label: "Importar planilha", onClick: () => setImportando(true) },
  ] : [];
  if (visaoArvore) return <ArvoreTela resourceKey={resourceKey} alternar={<PillBtn tone="outline" data-testid="visao-lista" onClick={() => trocarVisao(false)}><List className="h-3.5 w-3.5" /> Ver lista</PillBtn>} />;
  return <>{comArvore && <div className="mb-2 flex"><PillBtn tone="outline" data-testid="visao-arvore" onClick={() => trocarVisao(true)}><FolderTree className="h-3.5 w-3.5" /> Ver em árvore</PillBtn></div>}{podeImportar && <ImportDialog resourceKey={resourceKey} labelPlural={def.labelPlural} open={importando} onOpenChange={setImportando} avisoFiltro={avisoDeFiltroFixo(fields, fixed)} />}<Base1List
    moduleId={resourceKey} title={title ?? def.labelPlural} columns={columns} filters={filters} entity={def.table} csvName={resourceKey}
    fetchPage={(p) => api<{ items: Row[]; total: number }>(`/api/resources/${resourceKey}${qs({ page: p.page, pageSize: p.pageSize, sort: p.sort && sigilosos.has(p.sort) ? undefined : p.sort, dir: p.dir, search: p.search, ...p.filters, ...fixed })}`)}
    distinct={(key, search) => api<{ value: string; label: string; count: number }[]>(`/api/resources/${resourceKey}/distinct${qs({ field: key, search, limit: 100 })}`)}
    queryKeyExtra={fixed} initialParams={urlParams}
    searchable={searchable.length > 0} searchPlaceholder={`Pesquisar por ${searchable.map((f) => f.label.toLowerCase()).slice(0, 3).join("/")}`}
    canCreate={can(`${perm}.create`)} onNew={() => router.push(`${base}/new${qs(fixed)}`)}
    canDelete={can(`${perm}.delete`)} onDelete={async (r) => { await api(`/api/resources/${resourceKey}/${r["id"]}`, { method: "DELETE" }); toast.success("Registro excluído"); }} deleteText={`Excluir este registro de ${def.label.toLowerCase()}? A ação fica registrada na auditoria.`}
    Record={Record}
    rowVisible={arvore ? rowVisible : undefined} sortClearable={arvore}
    extraMenu={importacaoMenu.length ? importacaoMenu : undefined}
    rowActions={(r) => [{ label: "Visualizar", onClick: () => router.push(`${base}/${r["id"]}?view=1`) }, ...(can(`${perm}.edit`) ? [{ label: "Editar", onClick: () => router.push(`${base}/${r["id"]}`) }] : []), ...(extraRowActions?.(r) ?? [])]}
    exportXlsx={def.importExport && can(`${perm}.export`) ? (p) => download(`/api/exports/${resourceKey}${qs({ ...p.filters, ...fixed, search: p.search, format: "xlsx" })}`, `${resourceKey}.xlsx`) : undefined}
    reportHref={can("saved_reports.create") ? (p) => `/relatorios/personalizados/novo?resource=${resourceKey}&f=${encodeURIComponent(JSON.stringify({ ...p.filters, ...(p.search ? { search: p.search } : {}) }))}` : undefined}
  /></>;
}
