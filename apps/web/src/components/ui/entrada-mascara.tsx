"use client";
import * as React from "react";
import { formatarMascara, normalizarMascara, mascaraDoDocumento, recusaDoDigitoDoDocumento, type TipoMascara } from "@agro/domain";
import { cn } from "@/lib/utils";

type InputBase = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "defaultValue">;

/**
 * ENTRADA COM MÁSCARA (CADASTROS AJUSTES 01, B-3). MOSTRA o formatado e entrega em `onChange` o NORMALIZADO
 * (o que se grava): CPF/CEP/telefone só dígitos; CNPJ [0-9A-Z] maiúsculo. Colar com pontuação funciona.
 * Os formatadores são os do domínio (`formatarMascara`/`normalizarMascara`) — uma regra só.
 * `mascara = null` (ex.: Estrangeira) é entrada livre: nada é formatado nem cortado.
 */
export const EntradaMascara = React.forwardRef<HTMLInputElement, InputBase & { mascara: TipoMascara | null; value: string | null | undefined; onChange: (normalizado: string) => void; /** troca a normalização da digitação (CPF/CNPJ: a mais larga) */ normalizar?: (texto: string) => string }>(
  ({ mascara, value, onChange, normalizar, className, ...p }, ref) => {
    const bruto = value ?? "";
    const mostrado = mascara ? formatarMascara(mascara, bruto) : bruto;
    return <input ref={ref} {...p} type="text" className={cn("w-full", className)} value={mostrado}
      inputMode={mascara && mascara !== "cnpj" ? "numeric" : p.inputMode} data-mascara={mascara ?? "livre"}
      onChange={(e) => onChange(normalizar ? normalizar(e.target.value) : mascara ? normalizarMascara(mascara, e.target.value) : e.target.value)} />;
  }
);
EntradaMascara.displayName = "EntradaMascara";

/**
 * CPF/CNPJ (B-4): a máscara parte do TIPO DE PESSOA (`natural` → CPF; `legal` → CNPJ, inclusive alfanumérico;
 * `foreign` → sem máscara), mas NUNCA corta o documento: em Física, colar ou digitar um CNPJ passa a máscara para
 * CNPJ (`mascaraDoDocumento`) e a ficha troca o tipo. O DV é conferido AO SAIR do campo: "CPF inválido" / "CNPJ inválido".
 * `erro` externo (ex.: 422 do servidor) tem precedência sobre o aviso local. `onValidade` informa quem usa.
 */
export const EntradaDocumento = React.forwardRef<HTMLInputElement, InputBase & { tipoPessoa: string | null | undefined; value: string | null | undefined; onChange: (normalizado: string) => void; erro?: string | null; onValidade?: (recusa: string | null) => void }>(
  ({ tipoPessoa, value, onChange, erro, onValidade, onBlur, className, ...p }, ref) => {
    const mascara = mascaraDoDocumento(tipoPessoa, value);
    const [recusa, setRecusa] = React.useState<string | null>(null);
    // trocar o tipo de pessoa ou o valor por fora (importação, "Ajustar para Física") limpa o aviso antigo
    React.useEffect(() => { setRecusa(null); }, [tipoPessoa]);
    const msg = erro || recusa;
    return <span className="flex w-full flex-col">
      <EntradaMascara ref={ref} {...p} mascara={mascara} value={value} aria-invalid={Boolean(msg) || undefined} className={cn(msg && "border-red-500", className)}
        // normaliza pelo formato MAIS LARGO (CNPJ: [0-9A-Z], até 14) — a máscara efetiva sai do valor, não o corta
        onChange={(v) => { if (recusa) setRecusa(null); onChange(v); }} normalizar={mascara ? (t) => normalizarMascara("cnpj", t) : undefined}
        onBlur={(e) => { const r = mascara ? recusaDoDigitoDoDocumento(mascara, value ?? "") : null; setRecusa(r); onValidade?.(r); onBlur?.(e); }} />
      {msg && <span className="text-[11px] text-red-600" role="alert" data-testid="documento-invalido">{msg}</span>}
    </span>;
  }
);
EntradaDocumento.displayName = "EntradaDocumento";
