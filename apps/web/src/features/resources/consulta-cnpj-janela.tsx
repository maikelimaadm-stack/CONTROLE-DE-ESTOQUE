"use client";
/**
 * JANELA "CONSULTAR CNPJ" (CADASTROS AJUSTES 01, C-2, decisão 257). Uma janela só, aberta de dois lugares:
 *  · na ficha do Parceiro (barra de ações, SEMPRE habilitada, em leitura e edição): o campo vem com o CNPJ do
 *    cadastro; a aba "Divergências" compara o cadastro com a Receita; "Importar para o cadastro" preenche o
 *    formulário (vazios + divergentes marcados, Tipo de pessoa = Jurídica, documento = CNPJ consultado) — NADA é
 *    gravado sem o Salvar;
 *  · na lista de Parceiros ("Novo pelo CNPJ"): sem cadastro; Importar abre um parceiro NOVO já preenchido.
 * A consulta é a de sempre (`GET /api/consultas/cnpj/:cnpj`); o servidor valida, limita e escolhe a fonte.
 * Só com a API que declara `capacidades.consultaCnpjJanela` = 1 (sem ela, a web mostra a consulta antiga).
 */
import * as React from "react";
import { validarCnpj } from "@agro/domain";
import { api, ApiError } from "@/lib/api";
import { useAuth, type AppContext } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui";
import { EntradaMascara } from "@/components/ui/entrada-mascara";
import { PillBtn } from "@/features/base1/ui";

type Values = Record<string, unknown>;

/** Versão da capacidade `consultaCnpjJanela` que estas telas sabem usar (forma e versão EXATAS). */
export const CAPACIDADE_CONSULTA_CNPJ_JANELA = 1 as const;
export function entendeConsultaCnpjJanela(ctx: AppContext | null | undefined): boolean {
  return ctx?.capacidades?.["consultaCnpjJanela"] === CAPACIDADE_CONSULTA_CNPJ_JANELA;
}
export function useConsultaCnpjJanela(): boolean {
  return entendeConsultaCnpjJanela(useAuth().ctx);
}

/** Resposta de `GET /api/consultas/cnpj/:cnpj` (a mesma forma da API; o município já resolvido contra o IBGE). */
export interface RespostaCnpj {
  cnpj: string; razaoSocial: string | null; nomeFantasia: string | null;
  situacao: { descricao: string | null; data: string | null; motivo: string | null };
  abertura: string | null; naturezaJuridica: { codigo: string | null; descricao: string | null }; porte: string | null;
  cnaePrincipal: { codigo: string; descricao: string | null } | null; cnaesSecundarios: { codigo: string; descricao: string | null }[];
  endereco: { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cep: string | null; municipio: { codigoIbge: number; nome: string; uf: string } | null };
  telefones: string[]; email: string | null;
  simples: { optante: boolean; desde: string | null } | null; mei: { optante: boolean; desde: string | null } | null;
  matriz: boolean | null; dataDaInformacao: string | null; fonte: string; consultadoEm: string;
}

export const MSG_CPF_SEM_CONSULTA = "Não existe consulta gratuita de CPF; o sistema confere os dígitos.";
export const MSG_CNPJ_COM_LETRAS = "As fontes gratuitas ainda não consultam CNPJ com letras.";
/** A mensagem de cada recusa da consulta (C-2). */
export function mensagemDaConsulta(e: unknown, cnpj: string): string {
  const st = e instanceof ApiError ? e.status : 0;
  if (st === 503) return "Consulta de CNPJ indisponível agora; preencha manualmente.";
  if (st === 404) return "CNPJ não encontrado nas fontes gratuitas.";
  if (st === 429) return "Muitas consultas em 1 minuto; tente de novo em instantes.";
  if (st === 422 && /[A-Z]/.test(cnpj)) return MSG_CNPJ_COM_LETRAS;
  return (e as Error)?.message || "Consulta de CNPJ indisponível agora; preencha manualmente.";
}

const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const vazio = (v: unknown) => v === "" || v === null || v === undefined;
const data = (v: string | null | undefined) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—");

/** Campo do cadastro × valor da Receita. Rótulo é o do padrão de tela (o que o usuário vê na ficha). */
export const CAMPOS_DA_RECEITA: { campo: string; rotulo: string; de: (r: RespostaCnpj) => unknown }[] = [
  { campo: "legal_name", rotulo: "Razão social", de: (r) => r.razaoSocial },
  { campo: "name", rotulo: "Nome (fantasia)", de: (r) => r.nomeFantasia ?? r.razaoSocial },
  { campo: "nascimento_abertura", rotulo: "Abertura", de: (r) => r.abertura?.slice(0, 10) ?? null },
  { campo: "zip_code", rotulo: "CEP", de: (r) => soDigitos(r.endereco.cep) || null },
  { campo: "address", rotulo: "Endereço", de: (r) => r.endereco.logradouro },
  { campo: "address_number", rotulo: "Número", de: (r) => r.endereco.numero },
  { campo: "complemento", rotulo: "Complemento", de: (r) => r.endereco.complemento },
  { campo: "district", rotulo: "Bairro", de: (r) => r.endereco.bairro },
  { campo: "city_id", rotulo: "Cidade (código IBGE)", de: (r) => r.endereco.municipio?.codigoIbge ?? null },
  { campo: "email", rotulo: "E-mail", de: (r) => r.email },
  { campo: "phone", rotulo: "Telefone", de: (r) => soDigitos(r.telefones[0]) || null },
  { campo: "cnae_principal", rotulo: "CNAE principal", de: (r) => soDigitos(r.cnaePrincipal?.codigo) || null },
  { campo: "regime_tributario", rotulo: "Regime tributário", de: (r) => (r.mei?.optante ? "mei" : r.simples?.optante ? "simples" : null) }
];

export interface Divergencia { campo: string; rotulo: string; cadastro: unknown; receita: unknown; usar: boolean }
/** Divergências: campo preenchido no cadastro com valor diferente do da Receita. Marcadas por padrão. */
export function divergenciasDe(r: RespostaCnpj, cadastro: Values | null): Divergencia[] {
  if (!cadastro) return [];
  return CAMPOS_DA_RECEITA.flatMap(({ campo, rotulo, de }) => {
    const receita = de(r); const atual = cadastro[campo];
    return !vazio(receita) && !vazio(atual) && String(atual) !== String(receita) ? [{ campo, rotulo, cadastro: atual, receita, usar: true }] : [];
  });
}
/**
 * O que a importação escreve no formulário: os VAZIOS do cadastro com o valor da Receita, os divergentes MARCADOS,
 * o Tipo de pessoa = Jurídica e o documento = CNPJ consultado. Divergente desmarcado fica como está.
 */
export function valoresDaImportacao(r: RespostaCnpj, cadastro: Values | null, divergencias: Divergencia[]): Values {
  const v: Values = { person_type: "legal", document: r.cnpj };
  for (const { campo, de } of CAMPOS_DA_RECEITA) {
    const receita = de(r); if (vazio(receita)) continue;
    const d = divergencias.find((x) => x.campo === campo);
    if (d ? d.usar : vazio(cadastro?.[campo])) v[campo] = receita;
  }
  return v;
}

function Linha({ rotulo, children, testId }: { rotulo: string; children: React.ReactNode; testId?: string }) {
  return <div className="flex gap-2 py-0.5" data-testid={testId}><span className="w-44 shrink-0 text-slate-500">{rotulo}</span><span className="min-w-0 flex-1 break-words">{children}</span></div>;
}

export function JanelaConsultaCnpj({ open, onOpenChange, cnpjInicial, cadastro, onImportar, rotuloImportar = "Importar para o cadastro" }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  /** CNPJ do cadastro (normalizado) quando o documento é CNPJ; vazio no "Novo pelo CNPJ" */
  cnpjInicial?: string | null;
  /** valores atuais do cadastro (formulário) para a aba Divergências; null no "Novo pelo CNPJ" */
  cadastro: Values | null;
  /** importar: quem abriu decide (preencher o formulário ou abrir um parceiro novo) */
  onImportar: (valores: Values, r: RespostaCnpj) => void;
  rotuloImportar?: string;
}) {
  const [cnpj, setCnpj] = React.useState(cnpjInicial ?? "");
  const [r, setR] = React.useState<RespostaCnpj | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [aba, setAba] = React.useState<"dados" | "divergencias">("dados");
  const [div, setDiv] = React.useState<Divergencia[]>([]);
  // abrir de novo recomeça do CNPJ do cadastro
  React.useEffect(() => { if (open) { setCnpj(cnpjInicial ?? ""); setR(null); setErro(null); setAba("dados"); setDiv([]); } }, [open, cnpjInicial]);

  const consultar = async () => {
    setErro(null); setR(null);
    if (/^\d{11}$/.test(cnpj)) { setErro(MSG_CPF_SEM_CONSULTA); return; }
    if (cnpj.length !== 14 || !validarCnpj(cnpj)) { setErro("CNPJ inválido"); return; }
    setCarregando(true);
    try { const x = await api<RespostaCnpj>(`/api/consultas/cnpj/${cnpj}`); setR(x); setDiv(divergenciasDe(x, cadastro)); }
    catch (e) { setErro(mensagemDaConsulta(e, cnpj)); }
    finally { setCarregando(false); }
  };
  const e = r?.endereco;
  const ativa = r?.situacao.descricao?.toUpperCase() === "ATIVA";
  return <Dialog open={open} onOpenChange={onOpenChange} title="Consultar CNPJ" size="xl" testId="janela-consulta-cnpj"
    footer={r ? <PillBtn onClick={() => { onImportar(valoresDaImportacao(r, cadastro, div), r); onOpenChange(false); }} data-testid="consulta-cnpj-importar">{rotuloImportar}</PillBtn> : undefined}>
    <div className="flex flex-col gap-3 text-[12.5px]">
      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-2"><span className="text-slate-500">CNPJ</span>
          <EntradaMascara mascara="cnpj" value={cnpj} onChange={setCnpj} aria-label="CNPJ para consultar" data-testid="consulta-cnpj-campo" className="h-8 rounded border px-2"
            onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); void consultar(); } }} /></label>
        <PillBtn disabled={carregando} onClick={() => void consultar()} data-testid="consulta-cnpj-consultar">{carregando ? "Consultando…" : "Consultar"}</PillBtn>
      </div>
      {erro && <p className="rounded bg-amber-50 px-2 py-1 text-amber-800" role="alert" data-testid="consulta-cnpj-erro">{erro}</p>}
      {r && <>
        <div className="flex gap-1" role="tablist">
          <button type="button" role="tab" aria-selected={aba === "dados"} className={cn("seg-tab", aba === "dados" && "active")} onClick={() => setAba("dados")}>Dados</button>
          {cadastro && <button type="button" role="tab" aria-selected={aba === "divergencias"} className={cn("seg-tab", aba === "divergencias" && "active")} onClick={() => setAba("divergencias")}>Divergências{div.length > 0 && <span className="ml-1 rounded-full bg-amber-600 px-1.5 text-[10px] text-white">{div.length}</span>}</button>}
        </div>
        {aba === "dados" ? <div data-testid="consulta-cnpj-dados">
          <Linha rotulo="Razão social">{r.razaoSocial ?? "—"}</Linha>
          <Linha rotulo="Nome fantasia">{r.nomeFantasia ?? "—"}</Linha>
          <Linha rotulo="Situação" testId="consulta-cnpj-situacao"><span className={cn(!ativa && "rounded bg-amber-100 px-1 text-amber-800")}>{r.situacao.descricao ?? "—"}</span> desde {data(r.situacao.data)}{r.situacao.motivo ? ` · ${r.situacao.motivo}` : ""}</Linha>
          <Linha rotulo="Abertura">{data(r.abertura)}</Linha>
          <Linha rotulo="Natureza jurídica">{[r.naturezaJuridica.codigo, r.naturezaJuridica.descricao].filter(Boolean).join(" · ") || "—"}</Linha>
          <Linha rotulo="Porte">{r.porte ?? "—"}</Linha>
          <Linha rotulo="CNAE principal">{r.cnaePrincipal ? `${r.cnaePrincipal.codigo} · ${r.cnaePrincipal.descricao ?? ""}` : "—"}</Linha>
          <Linha rotulo="CNAEs secundários">{r.cnaesSecundarios.length ? <ul>{r.cnaesSecundarios.map((c) => <li key={c.codigo}>{c.codigo} · {c.descricao ?? ""}</li>)}</ul> : "—"}</Linha>
          <Linha rotulo="Endereço">{e ? [e.logradouro, e.numero, e.complemento, e.bairro].filter(Boolean).join(", ") || "—" : "—"}</Linha>
          <Linha rotulo="CEP">{e?.cep ?? "—"}</Linha>
          <Linha rotulo="Cidade" testId="consulta-cnpj-cidade">{e?.municipio ? `${e.municipio.codigoIbge} · ${e.municipio.nome} - ${e.municipio.uf}` : "—"}</Linha>
          <Linha rotulo="Telefones">{r.telefones.length ? r.telefones.join(" · ") : "—"}</Linha>
          <Linha rotulo="E-mail">{r.email ?? "—"}</Linha>
          <Linha rotulo="Simples Nacional">{r.simples ? (r.simples.optante ? `Optante desde ${data(r.simples.desde)}` : "Não optante") : "—"}</Linha>
          <Linha rotulo="MEI">{r.mei ? (r.mei.optante ? `Optante desde ${data(r.mei.desde)}` : "Não") : "—"}</Linha>
          <Linha rotulo="Matriz ou filial">{r.matriz === null ? "—" : r.matriz ? "Matriz" : "Filial"}</Linha>
          <Linha rotulo="Fonte" testId="consulta-cnpj-fonte">{r.fonte} · consultado em {new Date(r.consultadoEm).toLocaleString("pt-BR")}{r.dataDaInformacao ? ` · informação de ${data(r.dataDaInformacao)}` : ""}</Linha>
        </div> : <div data-testid="consulta-cnpj-divergencias">
          {div.length === 0 ? <p className="text-slate-500">Nenhuma divergência entre o cadastro e a Receita.</p> :
            <table className="w-full"><thead><tr className="text-left text-slate-600"><th /><th>Campo</th><th>No cadastro</th><th>Na Receita</th></tr></thead>
              <tbody>{div.map((d, i) => <tr key={d.campo} data-testid={`divergencia-${d.campo}`}><td><input type="checkbox" aria-label={`Usar o valor da Receita em ${d.rotulo}`} checked={d.usar} onChange={(ev) => setDiv(div.map((x, k) => (k === i ? { ...x, usar: ev.target.checked } : x)))} /></td><td>{d.rotulo}</td><td>{String(d.cadastro)}</td><td>{String(d.receita)}</td></tr>)}</tbody></table>}
          <p className="mt-2 text-slate-500">Importar preenche os campos vazios e aplica os divergentes marcados. Nada é gravado sem Salvar.</p>
        </div>}
      </>}
    </div>
  </Dialog>;
}

/**
 * "Novo pelo CNPJ" → parceiro NOVO preenchido: a lista guarda o que a janela importou e abre `/cadastros/people/new`;
 * o formulário novo lê UMA vez e apaga. Só nesta aba do navegador (sessionStorage), nunca na URL; nada é gravado
 * sem o Salvar. Storage indisponível = o parceiro novo abre vazio (a janela avisa).
 */
const CHAVE_IMPORTACAO = "agro.parceiro.importacaoCnpj";
export function guardarImportacaoPendente(v: Values): boolean {
  try { sessionStorage.setItem(CHAVE_IMPORTACAO, JSON.stringify(v)); return true; } catch { return false; }
}
export function esquecerImportacaoPendente() { try { sessionStorage.removeItem(CHAVE_IMPORTACAO); } catch { /* sem storage */ } }
/** Lê sem apagar (o formulário apaga depois de aplicar: o efeito pode rodar duas vezes em desenvolvimento). */
export function lerImportacaoPendente(): Values | null {
  try {
    const x = sessionStorage.getItem(CHAVE_IMPORTACAO); if (!x) return null;
    const v = JSON.parse(x) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Values) : null;
  } catch { return null; }
}
