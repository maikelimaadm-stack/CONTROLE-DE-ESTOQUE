"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Warehouse, LayoutGrid, Grid2x2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { FilterChips, useUrlParam } from "@/components/workspace";
import { ResourceList } from "@/features/resources/resource-list";
import { Dashboard } from "@/features/dashboards/dashboard";
import { FeedlotMap } from "./map";

/**
 * Currais (Compactação V2): estrutura hierárquica Pátio → Setor → Curral numa só área — árvore à esquerda, listagem
 * do nível selecionado à direita (cadastro/edição no contexto). "Mapa" e "Lotação" são modos de visualização
 * (`?view=`), não abas. Endpoints e cadastros declarativos continuam os mesmos.
 */
type Node = { id: string; name: string };
const fetchAll = (resource: string) => api<{ items: Record<string, unknown>[] }>(`/api/resources/${resource}?pageSize=500&sort=name`).then((r) => r.items);
export function CorralsPanel() {
  const { can } = useAuth();
  const [view, setView] = useUrlParam("view", "lista"); const [yard, setYard] = useUrlParam("yard", ""); const [sector, setSector] = useUrlParam("sector", "");
  const yards = useQuery({ queryKey: ["res", "feedlot_yards", "tree"], queryFn: () => fetchAll("feedlot_yards"), enabled: can("feedlot_yards.view") });
  const sectors = useQuery({ queryKey: ["res", "feedlot_sectors", "tree"], queryFn: () => fetchAll("feedlot_sectors"), enabled: can("feedlot_sectors.view") });
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const nodeName = (r: Record<string, unknown>) => String(r["name"] ?? r["description"] ?? r["code"] ?? "");
  const yardList: Node[] = (yards.data ?? []).map((r) => ({ id: String(r["id"]), name: nodeName(r) }));
  const sectorsOf = (yardId: string) => (sectors.data ?? []).filter((r) => String(r["yard_id"]) === yardId).map((r) => ({ id: String(r["id"]), name: nodeName(r) }));
  const level: "patios" | "setores" | "currais" = sector ? "currais" : yard ? "setores" : "patios";
  const modes = [{ value: "lista", label: "Lista", perm: ["feedlot_yards.view", "feedlot_sectors.view", "feedlot_corrals.view"] }, { value: "mapa", label: "Mapa", perm: "feedlot_map.view" }, { value: "lotacao", label: "Lotação", perm: "dashboard.feedlot.view" }];
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print"><FilterChips label="Visualização" testId="corrals-view" value={view} onChange={setView} options={modes} /></div>
    {view === "mapa" ? <div className="ws-scroll"><FeedlotMap /></div> : view === "lotacao" ? <Dashboard k="confinamento" title="Lotação de currais" /> :
    <div className="mg-panel-sidebar-layout min-h-0 flex-1">
      <aside className="mg-panel-sidebar-layout__tabs overflow-auto" aria-label="Estrutura do confinamento">
        <div className="mg-panel-list" role="tree">
          <button type="button" role="treeitem" aria-selected={level === "patios"} className={cn("mg-panel-list__tab", level === "patios" && "is-active")} onClick={() => { setYard(""); setSector(""); }}><Warehouse className="mr-1 inline h-3.5 w-3.5" /> Pátios</button>
          {yardList.map((y) => { const isOpen = open.has(y.id) || yard === y.id; const secs = sectorsOf(y.id); return <div key={y.id}>
            <button type="button" role="treeitem" aria-expanded={isOpen} aria-selected={yard === y.id && !sector} className={cn("mg-panel-list__tab flex items-center gap-1", yard === y.id && !sector && "is-active")} style={{ paddingLeft: 18 }} onClick={() => { setYard(y.id); setSector(""); if (!isOpen) toggle(y.id); }}>
              <span onClick={(e) => { e.stopPropagation(); toggle(y.id); }} className="inline-flex">{isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</span><LayoutGrid className="h-3.5 w-3.5" /><span className="truncate">{y.name}</span><span className="ml-auto text-[10px] text-slate-400">{secs.length}</span>
            </button>
            {isOpen && secs.map((s) => <button key={s.id} type="button" role="treeitem" aria-selected={sector === s.id} className={cn("mg-panel-list__tab flex items-center gap-1", sector === s.id && "is-active")} style={{ paddingLeft: 36 }} onClick={() => { setYard(y.id); setSector(s.id); }}><Grid2x2 className="h-3.5 w-3.5" /><span className="truncate">{s.name}</span></button>)}
          </div>; })}
        </div>
      </aside>
      <div className="mg-panel-sidebar-layout__content flex min-h-0 flex-col">
        {level === "patios" && <ResourceList resourceKey="feedlot_yards" title="Pátios" extraRowActions={(r) => [{ label: "Ver setores deste pátio", onClick: () => { setYard(String(r["id"])); setSector(""); } }]} />}
        {level === "setores" && <ResourceList key={yard} resourceKey="feedlot_sectors" title={`Setores — ${yardList.find((y) => y.id === yard)?.name ?? "pátio"}`} fixedFilters={{ yard_id: yard }} extraRowActions={(r) => [{ label: "Ver currais deste setor", onClick: () => setSector(String(r["id"])) }]} />}
        {level === "currais" && <ResourceList key={sector} resourceKey="feedlot_corrals" title={`Currais — ${sectorsOf(yard).find((s) => s.id === sector)?.name ?? "setor"}`} fixedFilters={{ sector_id: sector }} />}
      </div>
    </div>}
  </div>;
}
