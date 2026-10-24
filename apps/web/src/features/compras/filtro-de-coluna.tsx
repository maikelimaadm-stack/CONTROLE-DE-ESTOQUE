"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { Check, FilterX, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CalendarioDeData, CalendarioDePeriodo, SeletorDeOperador } from "@/components/ui";
import { ehCamadaAninhadaDoFiltro } from "@/features/base1/camada-aninhada-do-filtro";

/**
 * Filtro de cabeçalho do painel de itens — o `fpop` do HTML de referência (padrão Excel): limpar, condição
 * (operador + valor), procurar valor e a lista de valores com contagem de linhas. Recorta só as linhas já lidas.
 */
export type Tipo = "texto" | "num" | "data";
export interface FiltroAtivo { op: string; v1: string; v2: string; valores: Set<string> | null }

const OPS: Record<Tipo, [string, string][]> = {
  num: [["", "Sem condição"], ["ig", "É igual a"], ["dif", "É diferente de"], ["mai", "É maior do que"], ["maie", "É maior ou igual a"], ["men", "É menor do que"], ["mene", "É menor ou igual a"], ["entre", "Está entre"]],
  data: [["", "Sem condição"], ["ig", "É"], ["dif", "É diferente de"], ["men", "Antes de"], ["mai", "Depois de"], ["entre", "Está entre"]],
  texto: [["", "Sem condição"], ["ig", "É igual a"], ["dif", "É diferente de"], ["com", "Começa com"], ["ter", "Termina com"], ["cont", "Contém"], ["ncont", "Não contém"]]
};
const numDe = (v: string) => { if (!/[0-9]/.test(v)) return null; const n = Number(v.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".")); return v.trim() === "" || isNaN(n) ? null : n; };
const dataDe = (v: string) => {
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (!m) return null;
  let a = Number(m[3]); if (a < 100) a += 2000;
  const mes = Number(m[2]), dia = Number(m[1]), data = new Date(a, mes - 1, dia);
  return data.getFullYear() === a && data.getMonth() === mes - 1 && data.getDate() === dia ? a * 10000 + mes * 100 + dia : null;
};

/** a linha passa no filtro? (condição E valores marcados) */
export function casa(f: FiltroAtivo, tipo: Tipo, valor: string): boolean {
  if (f.valores && !f.valores.has(valor)) return false;
  if (!f.op || f.v1.trim() === "" || (f.op === "entre" && f.v2.trim() === "")) return true;
  if (tipo === "texto") {
    const a = valor.toLowerCase(), b = f.v1.toLowerCase();
    return f.op === "ig" ? a === b : f.op === "dif" ? a !== b : f.op === "com" ? a.startsWith(b) : f.op === "ter" ? a.endsWith(b) : f.op === "cont" ? a.includes(b) : !a.includes(b);
  }
  const conv = tipo === "num" ? numDe : dataDe;
  const x = conv(valor), a = conv(f.v1), b = conv(f.v2);
  if (x === null || a === null) return false;
  switch (f.op) {
    case "ig": return x === a; case "dif": return x !== a; case "mai": return x > a; case "maie": return x >= a;
    case "men": return x < a; case "mene": return x <= a; case "entre": return b === null ? x >= a : x >= Math.min(a, b) && x <= Math.max(a, b);
  }
  return true;
}

const Chk = ({ on, parte }: { on: boolean; parte?: boolean }) => <span className={cn("chk", on && "on", !on && parte && "parte")}>{(on || parte) && <Check strokeWidth={3} />}</span>;

export function FiltroDeColuna({ rotulo, tipo, ancora, valores, atual, onAplicar, onFechar, className }: {
  rotulo: string; tipo: Tipo; ancora: string; valores: string[]; atual: FiltroAtivo | null;
  onAplicar: (f: FiltroAtivo | null) => void; onFechar: () => void; className?: string;
}) {
  const contagem = React.useMemo(() => { const m = new Map<string, number>(); for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true })); }, [valores]);
  const [sel, setSel] = React.useState<Set<string>>(() => new Set(atual?.valores ?? contagem.map(([v]) => v)));
  const [op, setOp] = React.useState(atual?.op ?? "");
  const [v1, setV1] = React.useState(atual?.v1 ?? "");
  const [v2, setV2] = React.useState(atual?.v2 ?? "");
  const [busca, setBusca] = React.useState("");
  const [pos, setPos] = React.useState<React.CSSProperties>({ visibility: "hidden" });
  const painel = React.useRef<HTMLDivElement>(null);
  const fechar = React.useRef(onFechar); fechar.current = onFechar;
  React.useEffect(() => {
    const teclado = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); fechar.current(); } };
    // Fora do painel (e da âncora do cabeçalho) fecha — sem overlay `fixed inset-0` (ui-audit / decisão de primitives).
    // Condição/calendário/cmd-panel saem em portal: clique neles NÃO é "fora" (decisão 357).
    const fora = (e: MouseEvent) => {
      const t = e.target as Node;
      if (painel.current?.contains(t)) return;
      if (document.querySelector(ancora)?.closest("th")?.contains(t)) return;
      if (ehCamadaAninhadaDoFiltro(e.target)) return;
      fechar.current();
    };
    document.addEventListener("keydown", teclado);
    document.addEventListener("mousedown", fora);
    return () => { document.removeEventListener("keydown", teclado); document.removeEventListener("mousedown", fora); };
  }, [ancora]);
  React.useLayoutEffect(() => {
    const el = document.querySelector(ancora)?.closest("th");
    if (!el) return;
    const b = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(b.left, window.innerWidth - 262));
    const abaixo = window.innerHeight - b.bottom - 12, acima = b.top - 12;
    // abre colado ao cabeçalho: para baixo quando cabe, senão para cima (a lista rola dentro do limite)
    setPos(abaixo >= 360 || abaixo >= acima ? { top: b.bottom + 4, left, maxHeight: abaixo } : { bottom: window.innerHeight - b.top + 4, left, maxHeight: acima });
  }, [ancora]);
  const ops = OPS[tipo];
  const vistos = contagem.filter(([v]) => v.toLowerCase().includes(busca.toLowerCase()));
  const todos = vistos.length > 0 && vistos.every(([v]) => sel.has(v));
  const algum = vistos.some(([v]) => sel.has(v));
  const aplicar = () => {
    const valoresFiltrados = sel.size === contagem.length ? null : sel;
    onAplicar(!op && !valoresFiltrados ? null : { op, v1, v2, valores: valoresFiltrados });
  };
  const ph = tipo === "data" ? "dd/mm/aaaa" : tipo === "num" ? "Número" : "Valor";
  // portal no body: um ancestral com transform desloca o position:fixed para longe do cabeçalho
  return createPortal(<div className={cn("b1ref", className)} ref={painel}>
    <div className={cn("pop fpop", className)} role="menu" aria-label={`Filtrar coluna ${rotulo}`} style={pos}>
      <button type="button" className="fmi" disabled={!atual} onClick={() => onAplicar(null)}><FilterX size={14} /><span className="fval-l">Limpar filtro de “{rotulo}”</span></button>
      <span className="opt-sep" aria-hidden="true" />
      <div className="fcond">
        <SeletorDeOperador valor={op || "sem"} opcoes={ops.map(([value, label]) => ({ value: value || "sem", label }))} onChange={(v) => setOp(v === "sem" ? "" : v)} />
      </div>
      {op && <div className="fcond">
        {tipo === "data" && op !== "entre" ? <CalendarioDeData valor={v1} onChange={setV1} formato="br">
          <input className="fin" value={v1} onChange={(e) => setV1(e.target.value)} placeholder={ph} aria-label="Valor da condição" />
        </CalendarioDeData> : <input className="fin" value={v1} onChange={(e) => setV1(e.target.value)} placeholder={ph} aria-label="Valor da condição" />}
        {op === "entre" && <>{tipo === "data" ? <CalendarioDePeriodo inicio={v1} fim={v2} onInicio={setV1} onFim={setV2} formato="br" /> : <span className="fe">e</span>}<input className="fin" value={v2} onChange={(e) => setV2(e.target.value)} placeholder={ph} aria-label="Segundo valor da condição" /></>}
      </div>}
      <span className="opt-sep" aria-hidden="true" />
      <label className="cfgb" style={{ margin: "0 8px 6px", height: 28 }}><Search size={14} />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar valor…" aria-label="Procurar valor" />
      </label>
      <button type="button" className="pr fvr ftodos" role="checkbox" aria-checked={todos} onClick={() => setSel((p) => { const n = new Set(p); for (const [v] of vistos) { if (todos) n.delete(v); else n.add(v); } return n; })}>
        <span className="fck"><Chk on={todos} parte={algum} /></span><span className="pn">(Selecionar Tudo)</span><span className="r">{sel.size} de {contagem.length}</span>
      </button>
      <div className="fpop-l">
        {vistos.map(([v, n]) => <button type="button" key={v} className={cn("pr fvr", sel.has(v) && "on")} role="checkbox" aria-checked={sel.has(v)} onClick={() => setSel((p) => { const s = new Set(p); if (s.has(v)) s.delete(v); else s.add(v); return s; })}>
          <span className="fck"><Chk on={sel.has(v)} /></span><span className="pn">{v || "(Vazias)"}</span><span className="r">{n}</span>
        </button>)}
        {vistos.length === 0 && <span className="dvaz">Nenhum valor com esse texto.</span>}
      </div>
      <div className="fpop-f">
        <span style={{ flexGrow: 1 }} />
        <button type="button" className="tb-btn tb-btn-out xs" onClick={onFechar}>Cancelar</button>
        <button type="button" className="tb-btn novo xs" onClick={aplicar}>Aplicar</button>
      </div>
    </div>
  </div>, document.body);
}
