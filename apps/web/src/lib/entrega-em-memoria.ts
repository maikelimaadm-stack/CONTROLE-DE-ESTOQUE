"use client";
import { getSession } from "./api";

/**
 * ENTREGA EM MEMÓRIA ENTRE TELAS (CADASTROS AJUSTES 01 R1, W-5). Uma tela deixa um valor para a PRÓXIMA tela da mesma
 * aba ler UMA vez — ex.: "Novo pelo CNPJ" leva os dados da Receita para o parceiro novo. Mora SÓ na memória do
 * JavaScript desta aba: nada vai para `sessionStorage`/`localStorage` (dado de registro e resposta de API nunca ficam no
 * armazenamento do navegador — regra frontend-web), nem para a URL.
 *
 * Cada entrega tem DONO (organização + usuário da sessão em que foi feita): lida em outra organização ou por outro
 * usuário, é descartada. `esquecerEntregas()` roda em TODA troca de sessão (login, logout, troca de organização,
 * sessão expirada — o evento `agro:session` que o `AuthProvider` escuta). Recarregar a página também apaga.
 */
interface Entrega { org: string | null; usuario: string | null; valor: unknown }
const entregas = new Map<string, Entrega>();

const donoAtual = () => { const s = getSession(); return { org: s?.orgId ?? null, usuario: s?.user?.id ?? null }; };

export function entregarEmMemoria(chave: string, valor: unknown): void {
  entregas.set(chave, { ...donoAtual(), valor });
}

/** Lê SEM apagar (o efeito de quem consome pode rodar duas vezes em desenvolvimento). Dono diferente = nada. */
export function espiarEntrega<T = unknown>(chave: string): T | null {
  const e = entregas.get(chave); if (!e) return null;
  const dono = donoAtual();
  if (e.org !== dono.org || e.usuario !== dono.usuario) { entregas.delete(chave); return null; }
  return e.valor as T;
}

export function descartarEntrega(chave: string): void { entregas.delete(chave); }

/** Troca de sessão (login, logout, organização, expirada): nenhuma entrega sobrevive. */
export function esquecerEntregas(): void { entregas.clear(); }
