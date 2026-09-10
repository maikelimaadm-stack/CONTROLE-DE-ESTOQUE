"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "./auth";
export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } }));
  return <QueryClientProvider client={qc}><AuthProvider>{children}<Toaster richColors position="top-right" closeButton /></AuthProvider></QueryClientProvider>;
}
