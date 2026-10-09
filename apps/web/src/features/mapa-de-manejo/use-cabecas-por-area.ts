"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Cabeças por área (animais identificados + rebanho por contagem nos lotes da área). */
export function useCabecasPorArea() {
  const { session, can } = useAuth();
  const habilitado = Boolean(session?.token) && can("batch_area.view");
  return useQuery({
    queryKey: ["mapa", "cabecas-por-area", session?.empresaId ?? null],
    enabled: habilitado,
    queryFn: async () => {
      const r = await api<{ items: { area_id: string; cabecas: number }[] }>("/api/mapa/areas/cabecas-por-area");
      return new Map(r.items.map((i) => [i.area_id, i.cabecas]));
    },
    staleTime: 60_000
  });
}
