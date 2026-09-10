"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, LineChart, Line, CartesianGrid, PieChart, Pie, Cell } from "recharts";
const PALETTE = ["#2b6f3a", "#a67c52", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#64748b"];
const fmt = (v: unknown) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(v));
export function Bars({ data, x, series, height = 260, stacked }: { data: Record<string, unknown>[]; x: string; series: { key: string; label: string; color?: string }[]; height?: number; stacked?: boolean }) {
  return <ResponsiveContainer width="100%" height={height}><BarChart data={data.map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, series.some((s) => s.key === k) ? Number(v) : v])))}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey={x} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={70} /><Tooltip formatter={(v) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />{series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? PALETTE[i % PALETTE.length]} stackId={stacked ? "a" : undefined} radius={[2, 2, 0, 0]} />)}</BarChart></ResponsiveContainer>;
}
export function Lines({ data, x, series, height = 260 }: { data: Record<string, unknown>[]; x: string; series: { key: string; label: string; color?: string }[]; height?: number }) {
  return <ResponsiveContainer width="100%" height={height}><LineChart data={data.map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, series.some((s) => s.key === k) ? Number(v) : v])))}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey={x} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={70} /><Tooltip formatter={(v) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />{series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />)}</LineChart></ResponsiveContainer>;
}
export function Donut({ data, nameKey, valueKey, height = 240 }: { data: Record<string, unknown>[]; nameKey: string; valueKey: string; height?: number }) {
  const d = data.map((x) => ({ name: String(x[nameKey]), value: Number(x[valueKey]) })).filter((x) => x.value > 0);
  return <ResponsiveContainer width="100%" height={height}><PieChart><Pie data={d} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>{d.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip formatter={(v) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer>;
}
