"use client";
import * as React from "react";
import { Search } from "lucide-react";
import { formatarMascara, normalizarMascara, mascaraDoDocumento, recusaDoDigitoDoDocumento, type TipoMascara } from "@agro/domain";
import { cn } from "@/lib/utils";

type InputBase = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "defaultValue">;

/**
 * ENTRADA COM MÁSCARA (CADASTROS AJUSTES 01, B-3). MOSTRA o formatado e entrega em `onChange` o NORMALIZADO
 * (o que se grava): CPF/CEP só dígitos; CNPJ [0-9A-Z] maiúsculo; telefone só dígitos até 11 — passando disso, como
 * digitado, sem cortar nada (R1, W-6). Colar com pontuação funciona.
 * Os formatadores são os do domínio (`formatarMascara`/`normalizarMascara`) — uma regra só.
 * `mascara = null` (ex.: Estrangeira) é entrada livre: nada é formatado nem cortado.
 * O `id` (o do `<label htmlFor>`) fica NA CAIXA (R1, W-7): o rótulo nomeia a entrada, não um invólucro.
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
 * CEP com a lupa (C-4; R1, W-7). O `id` vai para a CAIXA do CEP — `getByLabel("CEP")` acha a entrada, não o
 * invólucro com a lupa (e o nome da lupa, "Buscar endereço", não contém "CEP": o rótulo acha UMA caixa).
 * Sem `onBuscar` (leitura, célula travada) não há lupa.
 */
export const EntradaCep = React.forwardRef<HTMLInputElement, InputBase & { value: string | null | undefined; onChange: (normalizado: string) => void; onBuscar?: () => void; testIdLupa?: string }>(
  ({ onBuscar, testIdLupa = "cep-lupa", ...p }, ref) => <span className="flex w-full items-center gap-1">
    <EntradaMascara ref={ref} {...p} mascara="cep" />
    {onBuscar && <button type="button" aria-label="Buscar endereço" title="Buscar o endereço pelo CEP" data-testid={testIdLupa} className="rounded p-0.5 text-slate-500 hover:bg-slate-100" onClick={onBuscar}><Search className="h-3.5 w-3.5" /></button>}
  </span>
);
EntradaCep.displayName = "EntradaCep";

/**
 * CPF/CNPJ (B-4): a máscara parte do TIPO DE PESSOA (`natural` → CPF; `legal` → CNPJ, inclusive alfanumérico;
 * `foreign` → sem máscara), mas NUNCA corta o documento: em Física, colar ou digitar um CNPJ passa a máscara para
 * CNPJ (`mascaraDoDocumento`) e a ficha troca o tipo. ENQUANTO SE DIGITA em Jurídica a máscara é sempre a de CNPJ
 * (o 11º dígito não vira CPF — R1, W-4); fora do campo, Jurídica com 11 dígitos aparece como CPF (R1, W-8).
 * O DV é conferido AO SAIR do campo ("CPF inválido" / "CNPJ inválido") e acompanha o valor e o tipo que mudam por
 * fora (importação, "Ajustar para…"); enquanto se digita, nenhum aviso. `erro` externo (ex.: 422) tem precedência.
 */
export const EntradaDocumento = React.forwardRef<HTMLInputElement, InputBase & { tipoPessoa: string | null | undefined; value: string | null | undefined; onChange: (normalizado: string) => void; erro?: string | null; onValidade?: (recusa: string | null) => void }>(
  ({ tipoPessoa, value, onChange, erro, onValidade, onBlur, onFocus, className, ...p }, ref) => {
    const [digitando, setDigitando] = React.useState(false);
    const [conferido, setConferido] = React.useState(false);
    const mascara = mascaraDoDocumento(tipoPessoa, value, digitando);
    const recusa = conferido && !digitando && mascara ? recusaDoDigitoDoDocumento(mascara, value ?? "") : null;
    const msg = erro || recusa;
    return <span className="flex w-full flex-col">
      <EntradaMascara ref={ref} {...p} mascara={mascara} value={value} aria-invalid={Boolean(msg) || undefined} className={cn(msg && "border-red-500", className)}
        // normaliza pelo formato MAIS LARGO (CNPJ: [0-9A-Z], até 14) — a máscara efetiva sai do valor, não o corta
        onChange={onChange} normalizar={mascara ? (t) => normalizarMascara("cnpj", t) : undefined}
        onFocus={(e) => { setDigitando(true); onFocus?.(e); }}
        onBlur={(e) => { setDigitando(false); setConferido(true); const m = mascaraDoDocumento(tipoPessoa, value, false); onValidade?.(m ? recusaDoDigitoDoDocumento(m, value ?? "") : null); onBlur?.(e); }} />
      {msg && <span className="text-[11px] text-red-600" role="alert" data-testid="documento-invalido">{msg}</span>}
    </span>;
  }
);
EntradaDocumento.displayName = "EntradaDocumento";
