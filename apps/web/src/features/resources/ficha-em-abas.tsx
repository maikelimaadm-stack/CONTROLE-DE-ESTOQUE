"use client";
/**
 * FICHA EM ABAS — a tela do mecanismo genérico do registry (CADASTROS Fase 4, decisão 253). Reaproveitada por
 * qualquer cadastro que declare `abas` em `@agro/domain` (Parceiros hoje; Funcionários, Produtos e árvore nas
 * fases 5 a 7). A declaração (abas, seções, grades de detalhe, perfis, cabeçalho, campos rápidos) é a do
 * registry; aqui só se desenha:
 *  · cabeçalho FIXO com os campos de `cabecalho`, visível em todas as abas;
 *  · abas na ordem declarada, escondidas por `visivelQuando` e sem a `permissaoDeLeitura` (R1-4); contador de erros por aba;
 *  · grade de detalhe (incluir / editar / remover linha) e campos de perfil (`<perfil>.<campo>` no formulário);
 *  · `fichaDoRegistro` / `fichaParaApi`: a conversão entre o registro da API e o formulário.
 * O servidor é a autoridade (gravação atômica, regras, erro por aba e linha); a tela só mostra.
 */
import * as React from "react";
import type { UseFormReturn } from "react-hook-form";
import { AlertTriangle, Plus, Search, Trash2 } from "lucide-react";
import type { DetalheDef, FieldDef, PerfilDef, ResourceDef } from "@agro/domain";
import { campoVisivel, chavesBarradas, formatarMascara, mascaraDoDocumento, normalizarDocumento, tipoPessoaPeloDocumento, validarCnpj } from "@agro/domain";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Card, ConfirmDialog, Input, NativeSelect } from "@/components/ui";
import { CampoCidade, consultarCep, filtroDaReferencia, mensagemFalhaCep, RefSelect, ReferenciaSelect, type BuscaDeOpcoes, type Municipio, type Option } from "@/components/ui/ref-select";
import { EntradaCep, EntradaDocumento, EntradaMascara } from "@/components/ui/entrada-mascara";
import { PillBtn } from "@/features/base1/ui";
import { mensagemDaTrocaDeTipo } from "./consulta-cnpj-janela";

type Values = Record<string, unknown>;
export interface ErroDaFicha { path: string; message: string; aba?: string | null; detalhe?: string; linha?: number | null }

const TITULO = "text-[13px] font-semibold text-slate-800";
const iguala = (x: unknown, esperado: unknown) => x === esperado || String(x) === String(esperado);
const vazio = (v: unknown) => v === "" || v === null || v === undefined;
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Marca da linha que veio GRAVADA (R1-2: com as permissões do cadastro dono, a linha gravada edita com `editar` e sai com `excluir`; a nova, com `criar`). Nunca vai no corpo. */
const GRAVADA = "__gravada";
/**
 * CHAVE da linha da grade (R1, W-8): identidade estável na tela, gerada no cliente e NUNCA enviada (o corpo só leva os
 * campos declarados). O preenchimento pelo CEP grava na linha pela CHAVE, não pelo índice — excluir uma linha durante a
 * consulta não escreve na vizinha.
 */
const CHAVE = "__chave";
let sequenciaDeChaves = 0;
const novaChave = () => `n${++sequenciaDeChaves}`;
/** Linha nova de grade (com a chave da tela). */
export function linhaNovaDaGrade(valores: Values): Values { return { ...valores, [CHAVE]: novaChave() }; }
/** Chave de uma linha (a da tela; o id gravado; em último caso a posição). */
export const chaveDaLinha = (l: Values, i: number) => String(l[CHAVE] ?? l["id"] ?? `pos${i}`);

/** Registro da API → valores do formulário (grades como listas, perfis como objetos). */
export function fichaDoRegistro(def: ResourceDef, data: Values | null | undefined): Values {
  const v: Values = {};
  for (const d of def.detalhes ?? []) v[d.key] = ((data?.[d.key] as Values[] | undefined) ?? []).map((l) => ({ ...l, [GRAVADA]: true, [CHAVE]: l["id"] ? String(l["id"]) : novaChave() }));
  for (const p of def.perfis ?? []) { const o = (data?.[p.key] as Values | null | undefined) ?? {}; v[p.key] = Object.fromEntries(p.fields.map((f) => [f.name, o[f.name] ?? (f.type === "boolean" ? false : "")])); }
  return v;
}

const numerico = ["money", "quantity", "number", "percent", "integer"];
function campoParaApi(f: FieldDef, x: unknown): unknown {
  if (x === "" || x === undefined) return null;
  if (f.type === "integer" && x !== null) return Number(x);
  if (f.type === "boolean") return Boolean(x);
  return x;
}
/**
 * Valores do formulário → chaves da ficha no corpo. Só vai o que o usuário MEXEU (`alterado`): grade ausente
 * não é tocada pela API, então uma edição do telefone não regrava (nem reconfere) as grades. Grade que vai, vai
 * COMPLETA. Perfil vai com o que tem valor e com o que o usuário ESVAZIOU (R1-2): o campo que tinha valor no
 * `original` (o registro como veio da API) e ficou vazio vai `null` — é assim que se limpa a data de desligamento,
 * o salário ou a conta de pagamento. Vazio que já era vazio continua não indo (não apaga o que a tela não mostrou).
 * O mesmo vale para o número esvaziado numa linha GRAVADA da grade (na linha nova, número vazio deixa o default do
 * banco valer, como antes). Campo SIGILOSO que o usuário não vê (`pode`) nunca vai: a API o recusaria (403).
 */
export function fichaParaApi(def: ResourceDef, v: Values, alterado: (chave: string) => boolean = () => true, opcoes: { original?: Values | null; pode?: (permissao: string) => boolean } = {}): Values {
  const o: Values = {};
  const pode = opcoes.pode ?? (() => true);
  for (const d of def.detalhes ?? []) {
    if (!alterado(d.key)) continue;
    const linhas = (v[d.key] as Values[] | undefined) ?? [];
    const chave = d.chaveNatural ?? "id";
    const originais = (opcoes.original?.[d.key] as Values[] | undefined) ?? [];
    const originalDe = (l: Values) => (vazio(l[chave]) ? undefined : originais.find((x) => String(x[chave]) === String(l[chave])));
    o[d.key] = linhas.map((l) => {
      const r: Values = {}; if (!d.chaveNatural && l["id"]) r["id"] = l["id"];
      const antes = originalDe(l);
      for (const f of d.fields) { if (f.readOnly || !campoVisivel(f, pode)) continue; const x = campoParaApi(f, l[f.name]); if (x === null && numerico.includes(f.type) && (!antes || vazio(antes[f.name]))) continue; r[f.name] = x; }
      return r;
    });
  }
  for (const p of def.perfis ?? []) {
    if (!p.fields.length || !alterado(p.key)) continue;
    const src = (v[p.key] as Values | undefined) ?? {}; const antes = (opcoes.original?.[p.key] as Values | null | undefined) ?? {}; const r: Values = {};
    for (const f of p.fields) { if (f.readOnly || !campoVisivel(f, pode)) continue; const x = campoParaApi(f, src[f.name]); if (x === null && vazio(antes[f.name])) continue; r[f.name] = x; }
    if (Object.keys(r).length) o[p.key] = r;
  }
  return o;
}

/** Aba de um campo do principal, pela seção declarada (sem seção → primeira aba). */
export function abaDoCampo(def: ResourceDef, campo: string): string | undefined {
  const f = def.fields.find((x) => x.name === campo);
  return (f?.section ? def.abas?.find((a) => a.secoes?.includes(f.section!))?.key : undefined) ?? def.abas?.[0]?.key;
}

function CelulaDaGrade({ f, valor, onChange, dis, mascaras }: { f: FieldDef; valor: unknown; onChange: (v: unknown) => void; dis: boolean; /** ficha do Parceiro (AJUSTES 01): Cidade com CEP/IBGE e máscaras de CEP, telefone e CPF/CNPJ */ mascaras?: boolean }) {
  const cls = "h-7 w-full min-w-[90px] text-[12.5px]";
  if (mascaras && f.busca === "municipios") return <CampoCidade value={valor as number | string | null} onChange={(c) => onChange(c ?? "")} disabled={dis} className="min-w-[260px]" classeEntrada={cls} />;
  // CPF/CNPJ da grade (Filiais, R1 W-8): sem tipo de pessoa — CPF até 11 posições, CNPJ a partir da 12ª; DV ao sair
  if (mascaras && f.name === "document") return <EntradaDocumento aria-label={f.label} tipoPessoa={null} readOnly={dis} className={cn("rounded border px-1", cls, "min-w-[160px]")} value={String(valor ?? "")} onChange={(x) => onChange(x)} />;
  if (mascaras && MASCARA_DA_GRADE[f.name]) return <EntradaMascara aria-label={f.label} mascara={MASCARA_DA_GRADE[f.name]!} readOnly={dis} className={cn("rounded border px-1", cls)} value={String(valor ?? "")} onChange={(x) => onChange(x)} />;
  if (f.busca) return <ReferenciaSelect referencia={f.busca} value={valor as string | number | null} onChange={(x) => onChange(x ?? "")} disabled={dis} className={cls} />;
  if (f.type === "ref") return <RefSelect resource={f.ref!.resource} filter={filtroDaReferencia(f)} value={valor as string} onChange={(x) => onChange(x ?? "")} disabled={dis} className={cls} />;
  if (f.type === "boolean") return <input type="checkbox" aria-label={f.label} disabled={dis} className="accent-brand-500" checked={valor === true || valor === "true"} onChange={(e) => onChange(e.target.checked)} />;
  if (f.type === "select") return <NativeSelect aria-label={f.label} disabled={dis} className={cls} value={String(valor ?? "")} onChange={(e) => onChange(e.target.value)}><option value="" />{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>;
  return <Input aria-label={f.label} readOnly={dis} className={cls} type={f.type === "email" ? "email" : numerico.includes(f.type) ? "number" : "text"} value={String(valor ?? "")} onChange={(e) => onChange(e.target.value)} />;
}

/** Máscaras das grades do Parceiro (AJUSTES 01, B-3; Filiais no R1, W-8): mostra formatado, grava normalizado. */
const MASCARA_DA_GRADE: Record<string, "cep" | "telefone"> = { cep: "cep", zip_code: "cep", telefone: "telefone", celular: "telefone", phone: "telefone" };

/** Grade de um detalhe 1:N dentro da aba. Linha com erro do servidor fica marcada. */
function GradeDeDetalhe({ d, form, dis, erros, mascaras }: { d: DetalheDef; form: UseFormReturn<Values>; dis: boolean; erros: ErroDaFicha[]; mascaras?: boolean }) {
  const { can, ctx } = useAuth();
  const linhas = (form.watch(d.key) as Values[] | undefined) ?? [];
  const set = (nova: Values[]) => form.setValue(d.key, nova, { shouldDirty: true });
  const atuais = () => (form.getValues(d.key) as Values[] | undefined) ?? [];
  const campos = d.fields.filter((f) => !f.readOnly && campoVisivel(f, can) && capacidadeDoCampo(f, ctx?.capacidades));
  // grade de OUTRO cadastro (R1-2): cada operação com a permissão dele — incluir (criar), mudar a linha gravada
  // (editar), tirar a linha gravada (excluir). Só apresentação: o servidor confere cada uma.
  const ps = d.permissoes;
  const podeCriar = !ps || can(ps.criar); const podeEditar = !ps || can(ps.editar); const podeExcluir = !ps || can(ps.excluir);
  const travada = (l: Values, f: FieldDef) => dis || (l[GRAVADA] ? (f.name === d.chaveNatural ? !(podeCriar && podeExcluir) : !podeEditar) : !podeCriar);

  // "Outros endereços" (AJUSTES 01, C-4; R1, W-2/W-8): CEP com a mesma lógica do principal — preenche endereço, bairro e
  // cidade da linha (complemento só se vazio) e leva o foco ao Número. Só quando o CEP da linha MUDOU (o último CEP de
  // cada linha é o que veio gravado, o já consultado ou o posto por fora — ex.: "Copiar endereço principal"); NUNCA em
  // leitura; a lupa força. Grava pela CHAVE da linha; resposta velha (outra consulta da mesma linha depois) é
  // descartada. Falha nunca impede salvar.
  const ehEnderecos = Boolean(mascaras) && d.key === "enderecos";
  const campoCep = d.fields.find((f) => f.name === "cep");
  const ultimoCep = React.useRef(new Map<string, string>());
  const pedidosCep = React.useRef(new Map<string, number>());
  const disRef = React.useRef(dis); disRef.current = dis;
  React.useEffect(() => {
    if (!ehEnderecos) return;
    // a linha cujo CEP está sendo DIGITADO fica de fora: a referência dela é o CEP de antes da digitação
    const focada = typeof document !== "undefined" ? document.activeElement?.getAttribute("data-cep-da-linha") ?? null : null;
    const vistas = new Set<string>();
    linhas.forEach((l, i) => { const k = chaveDaLinha(l, i); vistas.add(k); if (k !== focada) ultimoCep.current.set(k, soDigitos(l["cep"])); });
    for (const k of [...ultimoCep.current.keys()]) if (!vistas.has(k)) { ultimoCep.current.delete(k); pedidosCep.current.delete(k); }
  }, [linhas, ehEnderecos]);
  const cepDaLinha = async (chave: string, forcar = false) => {
    if (!ehEnderecos || !campoCep || disRef.current) return;
    const antes = atuais(); const i = antes.findIndex((y, n) => chaveDaLinha(y, n) === chave); const l = antes[i];
    if (!l || travada(l, campoCep)) return;
    const cep = soDigitos(l["cep"]);
    if (cep.length !== 8 || (!forcar && ultimoCep.current.get(chave) === cep)) return;
    ultimoCep.current.set(chave, cep);
    const meu = (pedidosCep.current.get(chave) ?? 0) + 1; pedidosCep.current.set(chave, meu);
    try {
      const r = await consultarCep(cep);
      if (pedidosCep.current.get(chave) !== meu || disRef.current) return;
      const agora = atuais(); const k = agora.findIndex((y, n) => chaveDaLinha(y, n) === chave); const atual = agora[k];
      // linha excluída durante a consulta, ou CEP trocado nela: nada é escrito
      if (!atual || soDigitos(atual["cep"]) !== cep) return;
      const novo: Values = { ...atual, ...(r.logradouro ? { logradouro: r.logradouro } : {}), ...(r.bairro ? { bairro: r.bairro } : {}), ...(r.municipio ? { city_id: r.municipio.codigoIbge } : {}), ...(r.complemento && vazio(atual["complemento"]) ? { complemento: r.complemento } : {}) };
      const aviso = avisoDeOutraCidade(cep, atual["city_id"], r.municipio);
      if (aviso) toast.info(`Linha ${k + 1}: ${aviso}`);
      set(agora.map((y, n) => (n === k ? novo : y)));
      if (typeof document !== "undefined") {
        const tr = [...document.querySelectorAll<HTMLElement>(`[data-testid="grade-${d.key}"] tr[data-chave-da-linha]`)].find((x) => x.dataset["chaveDaLinha"] === chave);
        const foco = document.activeElement;
        if (tr && (!foco || foco === document.body || tr.contains(foco))) tr.querySelector<HTMLInputElement>('input[aria-label="Número"]')?.focus();
      }
    } catch (e) { if (pedidosCep.current.get(chave) === meu) toast.info(mensagemFalhaCep(e)); }
  };
  const erroDaLinha = (i: number) => erros.filter((e) => e.detalhe === d.key && e.linha === i + 1);
  const mudar = (chave: string, campo: string, x: unknown) => set(atuais().map((y, n) => (chaveDaLinha(y, n) === chave ? { ...y, [campo]: x } : y)));
  const celula = (l: Values, f: FieldDef, chave: string) => {
    const bloqueada = travada(l, f);
    if (ehEnderecos && f.name === "cep") return <EntradaCep aria-label={f.label} data-cep-da-linha={chave} readOnly={bloqueada} className="h-7 w-full min-w-[90px] rounded border px-1 text-[12.5px]" value={String(l[f.name] ?? "")} onChange={(x) => mudar(chave, f.name, x)}
      onKeyDown={(e) => { if (e.key === "Tab" && !e.shiftKey) void cepDaLinha(chave); }} onBuscar={bloqueada ? undefined : () => void cepDaLinha(chave, true)} testIdLupa="cep-lupa-linha" />;
    return <CelulaDaGrade f={f} valor={l[f.name]} dis={bloqueada} mascaras={mascaras} onChange={(x) => mudar(chave, f.name, x)} />;
  };
  return <Card className="col-span-12 p-3" data-testid={`grade-${d.key}`}>
    <div className="mb-2 flex items-center justify-between"><h3 className={TITULO}>{d.label}</h3>
      {!dis && podeCriar && <PillBtn tone="gray" onClick={() => set([...atuais(), linhaNovaDaGrade(Object.fromEntries(campos.map((f) => [f.name, f.default ?? (f.type === "boolean" ? false : "")])))])}><Plus className="h-3.5 w-3.5" /> Incluir linha</PillBtn>}</div>
    {linhas.length === 0 ? <p className="text-[12px] text-slate-400">Nenhuma linha.</p> :
      <div className="overflow-x-auto"><table className="w-full text-[12.5px]"><thead><tr>{campos.map((f) => <th key={f.name} className="px-1 text-left font-semibold text-slate-600">{f.label}{f.required && <span className="text-red-500"> *</span>}</th>)}<th /></tr></thead>
        <tbody>{linhas.map((l, i) => { const es = erroDaLinha(i); const chave = chaveDaLinha(l, i); return <React.Fragment key={chave}>
          <tr className={cn(es.length > 0 && "bg-red-50")} data-testid={`linha-${d.key}-${i + 1}`} data-chave-da-linha={chave}>{campos.map((f) => <td key={f.name} className="px-1 py-0.5"
            // sair da célula do CEP (clique fora, não a lupa da própria célula): consulta se o CEP da linha mudou
            onBlur={ehEnderecos && f.name === "cep" ? (e) => { if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return; void cepDaLinha(chave); } : undefined}>{celula(l, f, chave)}</td>)}
            <td>{!dis && (!l[GRAVADA] || podeExcluir) && <button type="button" aria-label={`Remover linha ${i + 1}`} className="rounded p-1 text-red-600 hover:bg-red-50" onClick={() => set(atuais().filter((y, n) => chaveDaLinha(y, n) !== chave))}><Trash2 className="h-3.5 w-3.5" /></button>}</td></tr>
          {es.length > 0 && <tr><td colSpan={campos.length + 1} className="px-1 pb-1 text-[11px] text-red-600">Linha {i + 1}: {es.map((e) => e.message).join(" · ")}</td></tr>}
        </React.Fragment>; })}</tbody></table></div>}
  </Card>;
}

function CamposDoPerfil({ p, form, dis }: { p: PerfilDef; form: UseFormReturn<Values>; dis: boolean }) {
  const { can } = useAuth();
  // campo SIGILOSO sem a permissão (R1-2, ex.: salário, meta e comissão sem employees.edit) não aparece — a API não o devolve
  const campos = p.fields.filter((f) => campoVisivel(f, can));
  const v = (form.watch(p.key) as Values | undefined) ?? {};
  if (!campos.length) return null;
  return <Card className="col-span-12 p-3"><h3 className={cn(TITULO, "mb-2")}>{p.label}</h3><div className="flex flex-wrap gap-3">
    {campos.map((f) => <label key={f.name} className="min-w-[200px] flex-1 text-[12px]"><span className="block text-[11px] text-slate-500">{f.label}</span><CelulaDaGrade f={f} valor={v[f.name]} dis={dis} onChange={(x) => form.setValue(p.key, { ...v, [f.name]: x }, { shouldDirty: true })} /></label>)}
  </div></Card>;
}

/** O campo existe na API desta sessão? (`exigeCapacidade`, AJUSTES 01 — versão EXATA; desconhecida = ausente). */
export function capacidadeDoCampo(f: Pick<FieldDef, "exigeCapacidade">, capacidades: Record<string, unknown> | undefined): boolean {
  return !f.exigeCapacidade || capacidades?.[f.exigeCapacidade.nome] === f.exigeCapacidade.versao;
}

/** CEP de OUTRA cidade (C-4): "CEP 78245-000 é de Vila Bela da Santíssima Trindade - MT"; mesma cidade ou sem cidade antes = nada. */
export function avisoDeOutraCidade(cep: string, cidadeAntes: unknown, m: Municipio | null): string | null {
  if (!m || vazio(cidadeAntes) || String(cidadeAntes) === String(m.codigoIbge)) return null;
  return `CEP ${formatarMascara("cep", cep)} é de ${m.nome} - ${m.uf}`;
}

/** Tipo de pessoa que o DOCUMENTO pede (C-3): 11 dígitos → Física; 14 posições → Jurídica; outro → nenhum. */
export function tipoDoDocumento(doc: unknown): "natural" | "legal" | null {
  const n = normalizarDocumento(String(doc ?? ""));
  if (/^\d{11}$/.test(n)) return "natural";
  if (n.length === 14) return "legal";
  return null;
}

/** Consulta de CNPJ na ficha: mostra os dados, a fonte e a data; "Usar estes dados" preenche vazio e pergunta no preenchido. */
export function ConsultaCnpj({ form, dis }: { form: UseFormReturn<Values>; dis: boolean }) {
  type Cnpj = { razaoSocial: string | null; nomeFantasia: string | null; situacao: { descricao: string | null }; abertura: string | null; endereco: { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cep: string | null; municipio: { codigoIbge: number } | null }; email: string | null; telefones: string[]; cnaePrincipal: { codigo: string } | null; fonte: string; consultadoEm: string };
  const [r, setR] = React.useState<Cnpj | null>(null); const [carregando, setCarregando] = React.useState(false);
  const [divergentes, setDivergentes] = React.useState<{ campo: string; atual: unknown; novo: unknown; usar: boolean }[] | null>(null);
  const doc = normalizarDocumento(String(form.watch("document") ?? ""));
  const consultar = async () => {
    if (!validarCnpj(doc)) { toast.warning("Informe um CNPJ válido para consultar."); return; }
    setCarregando(true);
    try { setR(await api<Cnpj>(`/api/consultas/cnpj/${doc}`)); } catch (e) { toast.warning(`Consulta indisponível: ${(e as Error).message}. Você pode salvar mesmo assim.`); } finally { setCarregando(false); }
  };
  const propostas = (x: Cnpj): [string, unknown][] => [["legal_name", x.razaoSocial], ["name", x.nomeFantasia ?? x.razaoSocial], ["nascimento_abertura", x.abertura], ["zip_code", x.endereco.cep], ["address", x.endereco.logradouro], ["address_number", x.endereco.numero], ["complemento", x.endereco.complemento], ["district", x.endereco.bairro], ["city_id", x.endereco.municipio?.codigoIbge ?? null], ["email", x.email], ["phone", x.telefones[0] ?? null], ["cnae_principal", x.cnaePrincipal?.codigo?.replace(/\D/g, "") ?? null]];
  const usar = () => {
    if (!r) return;
    const div: { campo: string; atual: unknown; novo: unknown; usar: boolean }[] = [];
    for (const [campo, novo] of propostas(r)) { if (vazio(novo)) continue; const atual = form.getValues(campo); if (vazio(atual)) form.setValue(campo, novo, { shouldDirty: true }); else if (String(atual) !== String(novo)) div.push({ campo, atual, novo, usar: false }); }
    setDivergentes(div.length ? div : null);
    if (!div.length) toast.success("Dados da consulta aplicados aos campos vazios.");
  };
  const ativa = r?.situacao.descricao?.toUpperCase() === "ATIVA";
  return <div className="col-span-12 flex flex-col gap-2" data-testid="consulta-cnpj">
    {!dis && <div className="flex items-center gap-2"><PillBtn tone="gray" disabled={carregando || doc.length !== 14} onClick={() => void consultar()}><Search className="h-3.5 w-3.5" /> {carregando ? "Consultando…" : "Consultar CNPJ"}</PillBtn></div>}
    {r && <Card className="p-3 text-[12.5px]">
      <div className="font-semibold">{r.razaoSocial ?? "—"}{r.nomeFantasia ? ` · ${r.nomeFantasia}` : ""}</div>
      <div className={cn("mt-1", !ativa && "rounded bg-amber-100 px-1 text-amber-800")}>Situação: {r.situacao.descricao ?? "—"}</div>
      <div className="text-slate-500">Fonte: {r.fonte} · consultado em {new Date(r.consultadoEm).toLocaleString("pt-BR")}</div>
      {!dis && <PillBtn className="mt-2" onClick={usar}>Usar estes dados</PillBtn>}
    </Card>}
    {divergentes && <Card className="p-3 text-[12.5px]" data-testid="consulta-divergentes"><div className="mb-1 font-semibold">Estes campos já estão preenchidos. Marque os que devem receber o valor da consulta:</div>
      {divergentes.map((d, i) => <label key={d.campo} className="flex items-center gap-2"><input type="checkbox" checked={d.usar} onChange={(e) => setDivergentes(divergentes.map((x, k) => (k === i ? { ...x, usar: e.target.checked } : x)))} /><span>{d.campo}: <s>{String(d.atual)}</s> → {String(d.novo)}</span></label>)}
      <PillBtn className="mt-2" onClick={() => { for (const d of divergentes) if (d.usar) form.setValue(d.campo, d.novo, { shouldDirty: true }); setDivergentes(null); }}>Aplicar</PillBtn></Card>}
  </div>;
}

/**
 * CEP do endereço principal (C-4): Tab ou lupa → preenche Endereço, Bairro e Cidade (com o código IBGE e a UF);
 * Complemento só se vazio; o foco vai para o Número; CEP de outra cidade troca a cidade e avisa. Falha nunca impede
 * salvar. R1 (W-2): só consulta quando o CEP MUDOU — o "último CEP" é o do registro carregado, o já consultado ou o
 * posto por fora (importação da Receita, cópia): passar com Tab por um CEP já gravado não sobrescreve o endereço
 * corrigido à mão. `ativo` falso (LEITURA) = nunca consulta. `forcar` (lupa, só em edição) consulta de novo o mesmo
 * CEP. Só a resposta do pedido mais recente vale.
 */
export function useCepDaFicha(form: UseFormReturn<Values>, ativo: boolean) {
  const cepAtual = soDigitos(form.watch("zip_code"));
  const ultimo = React.useRef<string>(cepAtual);
  const pedido = React.useRef(0);
  const ativoRef = React.useRef(ativo); ativoRef.current = ativo;
  React.useEffect(() => {
    // mudança que NÃO veio da digitação na própria caixa (registro carregado, importação, cópia) vira a referência
    const foco = typeof document !== "undefined" ? (document.activeElement as HTMLInputElement | null) : null;
    if (foco?.name !== "zip_code") ultimo.current = cepAtual;
  }, [cepAtual]);
  return React.useCallback(async (forcar = false) => {
    const cep = soDigitos(form.getValues("zip_code"));
    if (!ativo || cep.length !== 8 || (!forcar && ultimo.current === cep)) return;
    ultimo.current = cep;
    const meu = ++pedido.current;
    try {
      const r = await consultarCep(cep);
      if (meu !== pedido.current || !ativoRef.current || soDigitos(form.getValues("zip_code")) !== cep) return;
      const aviso = avisoDeOutraCidade(cep, form.getValues("city_id"), r.municipio);
      if (r.logradouro) form.setValue("address", r.logradouro, { shouldDirty: true });
      if (r.bairro) form.setValue("district", r.bairro, { shouldDirty: true });
      if (r.municipio) form.setValue("city_id", r.municipio.codigoIbge, { shouldDirty: true });
      if (r.complemento && vazio(form.getValues("complemento"))) form.setValue("complemento", r.complemento, { shouldDirty: true });
      if (aviso) toast.info(aviso);
      if (typeof document !== "undefined") document.querySelector<HTMLInputElement>('[name="address_number"]')?.focus();
    } catch (e) { if (meu === pedido.current) toast.info(mensagemFalhaCep(e)); }
  }, [ativo, form]);
}

/**
 * Campo `json` com `camposJson` (Fase 6, ex.: products.taxes): as chaves conhecidas viram entradas; o valor do
 * formulário continua o JSON inteiro (texto), então chave desconhecida volta como veio — e a API ainda funde.
 */
function JsonComoCampos({ f, form, dis }: { f: FieldDef; form: UseFormReturn<Values>; dis: boolean }) {
  const bruto = form.watch(f.name);
  let obj: Values = {};
  try { const x = typeof bruto === "string" ? (bruto.trim() ? JSON.parse(bruto) : {}) : bruto ?? {}; if (x && typeof x === "object" && !Array.isArray(x)) obj = x as Values; } catch { /* JSON inválido: a validação do envio avisa */ }
  const set = (k: string, v: unknown) => { const n: Values = { ...obj }; if (v === "" || v === null || v === undefined) delete n[k]; else n[k] = v; form.setValue(f.name, JSON.stringify(n, null, 2), { shouldDirty: true }); };
  const extras = Object.keys(obj).filter((k) => !f.camposJson!.some((c) => c.name === k));
  return <div className="w-full" data-testid={`campos-json-${f.name}`}><div className="mb-1 text-[11px] text-slate-500">{f.label}</div><div className="flex flex-wrap gap-3">
    {f.camposJson!.map((c) => <label key={c.name} className="min-w-[150px] flex-1 text-[12px]"><span className="block text-[11px] text-slate-500">{c.label}</span><CelulaDaGrade f={c} valor={obj[c.name]} dis={dis} onChange={(x) => set(c.name, x)} /></label>)}
  </div>{extras.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Outros parâmetros preservados: {extras.join(", ")}</p>}</div>;
}

/** Saldo do produto por armazém e lote — leitura, no escopo de empresa do usuário (a API recorta). */
function SaldoPorLote({ id }: { id: string | null }) {
  type Linha = { warehouse_name: string; empresa_name: string; provider_lot: string; expiration_date: string | null; quantity: string; unit: string | null };
  const [r, setR] = React.useState<{ items: Linha[] } | null>(null); const [erro, setErro] = React.useState<string | null>(null);
  React.useEffect(() => { if (!id) return; let vivo = true; api<{ items: Linha[] }>(`/api/stock/balances?product_id=${encodeURIComponent(id)}&pageSize=100&sort=warehouse_name`).then((x) => { if (vivo) setR(x); }).catch((e: Error) => { if (vivo) setErro(e.message); }); return () => { vivo = false; }; }, [id]);
  return <Card className="col-span-12 p-3 text-[12.5px]" data-testid="saldo-por-lote"><h3 className={cn(TITULO, "mb-2")}>Saldo por lote</h3>
    {!id ? "Salve o produto para ver o saldo." : erro ? `Saldo indisponível: ${erro}` : !r ? "Carregando…" : r.items.length === 0 ? "Sem saldo nas empresas que você enxerga." :
      <table className="w-full"><thead><tr className="text-left text-slate-600"><th>Empresa</th><th>Armazém</th><th>Lote</th><th>Validade</th><th className="text-right">Quantidade</th></tr></thead>
        <tbody>{r.items.map((l, i) => <tr key={i}><td>{l.empresa_name}</td><td>{l.warehouse_name}</td><td>{l.provider_lot || "—"}</td><td>{l.expiration_date ? String(l.expiration_date).slice(0, 10) : "—"}</td><td className="text-right">{l.quantity} {l.unit ?? ""}</td></tr>)}</tbody></table>}
  </Card>;
}

/** Histórico da ficha (auditoria): quem, quando, o quê. */
function HistoricoDaFicha({ def, id }: { def: ResourceDef; id: string | null }) {
  type Ev = { quando: string; quem: string | null; acao: string; onde: string; campos: string[] };
  const [r, setR] = React.useState<{ items: Ev[] } | null>(null); const [erro, setErro] = React.useState<string | null>(null);
  React.useEffect(() => { if (!id) return; let vivo = true; api<{ items: Ev[] }>(`/api/resources/${def.key}/${id}/historico?pageSize=100`).then((x) => { if (vivo) setR(x); }).catch((e: Error) => { if (vivo) setErro(e.message); }); return () => { vivo = false; }; }, [def.key, id]);
  const acao: Record<string, string> = { create: "incluiu", update: "alterou", delete: "excluiu" };
  return <Card className="col-span-12 p-3 text-[12.5px]" data-testid="historico-da-ficha"><h3 className={cn(TITULO, "mb-2")}>Histórico</h3>
    {!id ? "Salve para ver o histórico." : erro ? `Histórico indisponível: ${erro}` : !r ? "Carregando…" : r.items.length === 0 ? "Nenhum evento." :
      <ul className="flex flex-col gap-1">{r.items.map((e, i) => <li key={i}><b>{new Date(e.quando).toLocaleString("pt-BR")}</b> · {e.quem ?? "sistema"} {acao[e.acao] ?? e.acao} {e.onde}{e.campos.length ? `: ${e.campos.join(", ")}` : ""}</li>)}</ul>}
  </Card>;
}

/**
 * NOVO por OUTRA porta (`ResourceDef.criacao`, Fase 5): ex.: novo funcionário começa pelo CPF. Pergunta só
 * `criacao.campos`, chama `criacao.rota` e abre a ficha do registro devolvido (existente ou criado agora).
 */
export function CriacaoPorOutraPorta({ def, base }: { def: ResourceDef; base: string }) {
  const c = def.criacao!;
  const [v, setV] = React.useState<Values>({}); const [enviando, setEnviando] = React.useState(false);
  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await api<{ id: string; criado: boolean }>(c.rota, { method: "POST", body: Object.fromEntries(c.campos.map((k) => [k, vazio(v[k]) ? null : v[k]])) });
      toast.success(r.criado ? `${def.label} cadastrado.` : `Cadastro existente aberto e marcado como ${def.label.toLowerCase()}.`);
      window.location.assign(`${base}/${r.id}`);
    } catch (e) { toast.warning((e as Error).message); } finally { setEnviando(false); }
  };
  return <Card className="m-2 flex max-w-xl flex-col gap-3 p-4" data-testid="criacao-por-outra-porta">
    <h2 className="text-[15px] font-semibold">Novo {def.label.toLowerCase()}</h2>
    <p className="text-[12.5px] text-slate-600">{c.mensagem}</p>
    {c.campos.map((k) => { const f = def.fields.find((x) => x.name === k); return <label key={k} className="text-[12px]"><span className="block text-[11px] text-slate-500">{f?.label ?? k}</span><Input aria-label={f?.label ?? k} value={String(v[k] ?? "")} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>; })}
    <div><PillBtn disabled={enviando || vazio(v[c.campos[0]!])} onClick={() => void enviar()}>{enviando ? "Enviando…" : "Continuar"}</PillBtn></div>
  </Card>;
}

/**
 * Controle próprio de um campo da ficha (máscara, CPF/CNPJ, Cidade, Tipo de pessoa, Matriz): `renderField` o põe na
 * mesma caixa de sempre. O elemento devolvido recebe o `id` do rótulo (R1, W-7) e o leva à CAIXA. `padrao` desenha o
 * controle de sempre do formulário com um ajuste (`ExtraDoCampo`) — a mesma aparência, outra regra.
 */
export type ControleDoCampo = (p: { dis: boolean; required?: boolean; onOpenChange?: (o: boolean) => void; padrao?: (extra: ExtraDoCampo) => React.ReactElement }) => React.ReactElement;
/** Ajustes do controle de sempre: interceptar a troca (seletor), ligar o rótulo à caixa, recortar a lista da referência, tirar o X de limpar. */
export interface ExtraDoCampo { aoMudar?: (v: string) => void; ligarRotulo?: boolean; excluirIds?: string[]; buscarOpcoes?: BuscaDeOpcoes; /** seletor: mostra o X de limpar (padrão: quando o campo não é obrigatório) */ permiteVazio?: boolean }

/**
 * Rótulo do valor no cabeçalho: opção do select pelo rótulo; documento com a MESMA máscara da caixa. Só a caixa do
 * Parceiro tem a máscara pelo tipo de pessoa (`mascaraDoDocumento`); nas outras fichas (ex.: Funcionários, caixa sem
 * máscara) CPF/CNPJ só com 11/14 posições e o resto como gravado — documento estrangeiro não ganha pontuação de CNPJ.
 */
function valorDoCabecalho(f: FieldDef, v: unknown, tipoPessoa: unknown, digitandoDocumento: boolean, parceiro: boolean): string {
  if (f.type === "select") return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
  if (f.name === "document" && parceiro) { const m = mascaraDoDocumento(String(tipoPessoa ?? ""), String(v), digitandoDocumento); return m ? formatarMascara(m, String(v)) : String(v); }
  if (f.name === "document") { const t = tipoDoDocumento(v); return t && tipoPessoa !== "foreign" ? formatarMascara(t === "natural" ? "cpf" : "cnpj", String(v)) : String(v); }
  return String(v);
}

/**
 * Campos que SOMEM — e são apagados — ao trocar o tipo de pessoa (R1, W-3): `limpaQuandoOculto` presos ao tipo, com
 * valor, aparentes no tipo atual e ocultos no novo, e que iriam no corpo (`apagavel`: nem travados pelo layout, nem
 * sigilosos, nem fora da API desta sessão — esses a tela não grava). Na ordem do registry.
 */
export function camposApagadosNaTroca(def: ResourceDef, valores: Values, novoTipo: unknown, apagavel: (f: FieldDef) => boolean): FieldDef[] {
  const atual = valores["person_type"];
  return def.fields.filter((f) => f.limpaQuandoOculto && f.visibleWhen?.field === "person_type" && apagavel(f) && !vazio(valores[f.name])
    && iguala(atual, f.visibleWhen.equals) && !iguala(novoTipo, f.visibleWhen.equals));
}
const valorVazioDe = (f: FieldDef): unknown => (f.type === "boolean" ? false : f.type === "tags" ? [] : "");

/** Rótulo de um tipo de pessoa pela opção declarada ("Jurídica"). */
const rotuloDoTipo = (def: ResourceDef, tipo: unknown) => def.fields.find((f) => f.name === "person_type")?.options?.find((o) => o.value === String(tipo ?? ""))?.label ?? String(tipo ?? "");

/**
 * MATRIZ (R1, W-8): a busca só oferece parceiro JURÍDICA (o recorte declarado no registry), ATIVO, que NÃO é filial
 * (sem matriz) e nunca o próprio registro. O `/options` só filtra por igualdade, então a busca vai pela listagem do
 * cadastro (`matriz_id__is_empty`, servidor) — o próprio registro sai na tela. Quem recusa é o servidor (A-1).
 */
function buscaDaMatriz(f: FieldDef): BuscaDeOpcoes {
  const recorte = filtroDaReferencia(f) ?? {};
  return {
    chave: `matriz:${JSON.stringify(recorte)}`,
    buscar: async (search: string): Promise<Option[]> => {
      const r = await api<{ items: Values[] }>(`/api/resources/people${qs({ search: search.trim() || undefined, pageSize: "30", sort: "name", ...recorte, is_active: "true", matriz_id__is_empty: "1" })}`);
      return r.items.map((x) => ({ id: String(x["id"]), label: String(x["name"] ?? ""), code: (x["code"] as string | null | undefined) ?? null }));
    }
  };
}

export function FichaEmAbas({ def, form, readOnly, isNew, record, erros, renderField, visivel, consultaJanela = false, entrarEmEdicao, abrirConsultaCnpj, travado = () => false }: {
  def: ResourceDef; form: UseFormReturn<Values>; readOnly: boolean; isNew: boolean; record: Values | null; erros: ErroDaFicha[];
  renderField: (fid: string, controle?: ControleDoCampo) => React.ReactNode; visivel: (f: FieldDef) => boolean;
  /** a API declara `consultaCnpjJanela` 1 (AJUSTES 01): consulta pela janela da barra; sem ela, a consulta antiga na Identificação */
  consultaJanela?: boolean;
  /** entra em Editar (faixa "Ajustar para Física" com a ficha em leitura) */
  entrarEmEdicao?: () => void;
  /** abre a janela Consultar CNPJ (aviso "CNPJ válido — Consultar na Receita" do parceiro novo) */
  abrirConsultaCnpj?: () => void;
  /** campo fora do corpo (travado pelo layout, sigiloso, fora da API): a tela não o muda (R1, W-8 "Tipo do parceiro") */
  travado?: (f: FieldDef) => boolean;
}) {
  const { can } = useAuth();
  const values = form.watch();
  const parceiro = def.key === "people";
  // aba sem a permissão de LEITURA (R1-4, ex.: Cliente sem clients.view) não aparece — a API também não manda os dados dela.
  // Grade de OUTRO cadastro sem a leitura dele (R1-2) some; a aba que só tinha essas grades (Eventos fixos sem
  // employee_events.view) não aparece. A aba "Anexos" (quem ainda a declara) não aparece: Anexos está na barra de ações (C-1).
  const barradas = chavesBarradas(def, "permissaoDeLeitura", can);
  const soGradesBarradas = (a: { secoes?: string[]; perfis?: string[]; detalhes?: string[]; painel?: string }) => !a.secoes?.length && !a.perfis?.length && !a.painel && Boolean(a.detalhes?.length) && a.detalhes!.every((k) => barradas.has(k));
  const abas = (def.abas ?? []).filter((a) => a.key !== "anexos" && (!a.permissaoDeLeitura || can(a.permissaoDeLeitura)) && !soGradesBarradas(a) && (!a.visivelQuando || iguala(values[a.visivelQuando.field], a.visivelQuando.equals)));
  const semEdicao = (a: { permissaoDeEdicao?: string }) => Boolean(a.permissaoDeEdicao && !can(a.permissaoDeEdicao));
  const [ativa, setAtiva] = React.useState(abas[0]?.key ?? "");
  const cur = abas.some((a) => a.key === ativa) ? ativa : abas[0]?.key ?? "";
  const buscarCep = useCepDaFicha(form, !readOnly);
  // contador de erros por aba: erros do servidor (com aba) + campos obrigatórios pendentes do formulário
  const contagem = new Map<string, number>();
  for (const e of erros) { const k = e.aba ?? abaDoCampo(def, e.path.split(".")[0] ?? ""); if (k) contagem.set(k, (contagem.get(k) ?? 0) + 1); }
  for (const nome of Object.keys(form.formState.errors)) { if (erros.some((e) => e.path === nome)) continue; const k = abaDoCampo(def, nome); if (k) contagem.set(k, (contagem.get(k) ?? 0) + 1); }
  const situacao = String(values["situacao_receita"] ?? record?.["situacao_receita"] ?? "");
  const cab = (def.cabecalho ?? []).map((n) => def.fields.find((f) => f.name === n)).filter((f): f is FieldDef => Boolean(f));
  const tipos = cab.filter((f) => f.type === "boolean" && f.name !== "is_active" && values[f.name] === true).map((f) => f.label);

  // TROCA DO TIPO DE PESSOA (R1, W-3): automática (pelo documento), "Ajustar para…" e o próprio seletor passam por
  // aqui. Campo preenchido que vai sumir → pergunta ANTES, listando-os; Cancelar mantém o tipo e os valores.
  // Confirmar apaga os campos listados (o Salvar os grava vazios) e troca o tipo.
  const apagavel = (f: FieldDef) => !travado(f);
  const [troca, setTroca] = React.useState<{ novo: string; campos: FieldDef[]; antes?: () => void } | null>(null);
  const aplicarTroca = (novo: string, campos: FieldDef[], antes?: () => void) => {
    antes?.();
    for (const f of campos) form.setValue(f.name, valorVazioDe(f), { shouldDirty: true });
    form.setValue("person_type", novo, { shouldDirty: true });
  };
  const pedirTroca = (novo: string, opcoes: { antes?: () => void } = {}) => {
    // o tipo nunca fica vazio (coluna NOT NULL): "trocar para nada" não pergunta nem apaga campo algum
    if (vazio(novo) || iguala(form.getValues("person_type"), novo)) return;
    const campos = camposApagadosNaTroca(def, form.getValues(), novo, apagavel);
    if (!campos.length) { aplicarTroca(novo, [], opcoes.antes); return; }
    setTroca({ novo, campos, antes: opcoes.antes });
  };

  // TIPO DE PESSOA SEGUE O DOCUMENTO (C-3; R1, W-4): Jurídica a partir de 12 posições (já ao digitar); Física só ao SAIR
  // do campo com 11 dígitos — o 11º dígito de um CNPJ em digitação não é CPF. Estrangeira só manual. Só na tela.
  // Troca que apagaria campo preenchido espera a SAÍDA do campo para perguntar (não interrompe a digitação); recusada,
  // não pergunta de novo para o mesmo documento (a faixa "Ajustar para…" continua lá).
  const tipoPessoa = values["person_type"];
  const doc = String(values["document"] ?? "");
  const [digitandoDocumento, setDigitandoDocumento] = React.useState(false);
  const recusada = React.useRef<string | null>(null);
  // documento e tipo ao ENTRAR no campo: só a saída de um documento MUDADO troca o tipo (passar pelo campo não mexe no
  // cadastro). Se a DIGITAÇÃO trocou o tipo (CPF → CNPJ vira Jurídica) e o documento voltou ao de entrada, a saída
  // também confere: senão ficaria Jurídica com o CPF de entrada, contra a regra "Física ao sair com 11 dígitos".
  const docAoEntrar = React.useRef<string>("");
  const tipoAoEntrar = React.useRef<unknown>(undefined);
  const trocaAutomatica = (valor: string, momento: "digitando" | "saindo") => {
    const t = tipoPessoaPeloDocumento(valor, momento);
    const atual = form.getValues("person_type");
    if (!t || atual === "foreign" || iguala(atual, t)) return;
    const marca = `${normalizarDocumento(valor)}>${t}`;
    if (recusada.current === marca) return;
    const campos = camposApagadosNaTroca(def, form.getValues(), t, apagavel);
    if (!campos.length) { aplicarTroca(t, []); return; }
    if (momento === "saindo") { recusada.current = marca; setTroca({ novo: t, campos }); }
  };
  const mudarDocumento = (v: string) => { form.setValue("document", v, { shouldDirty: true }); trocaAutomatica(v, "digitando"); };
  const pedido = (() => { const t = tipoDoDocumento(doc); return digitandoDocumento && t === "natural" ? null : t; })();
  const divergeDoDocumento = parceiro && pedido !== null && tipoPessoa !== "foreign" && !vazio(tipoPessoa) && tipoPessoa !== pedido;
  const rotuloDoPedido = pedido === "natural" ? "Física" : "Jurídica";
  // "Ajustar para…" muda o cadastro: só com a edição do cadastro (em edição/novo a tela já é editável)
  const podeAjustar = !readOnly || can(`${def.permission}.edit`);
  const cnpjValidoNovo = parceiro && consultaJanela && isNew && !readOnly && tipoPessoa !== "foreign" && doc.length === 14 && validarCnpj(normalizarDocumento(doc));

  // controles próprios da ficha do Parceiro (máscaras de B; a caixa, o rótulo e o erro continuam os do renderField)
  const controle = (f: FieldDef): ControleDoCampo | undefined => {
    if (!parceiro) return undefined;
    const reg = (n: string) => ({ name: n, value: String(values[n] ?? ""), onChange: (v: string) => form.setValue(n, v, { shouldDirty: true }) });
    const cls = "h-5 w-full border-0 bg-transparent px-0 text-[13px] font-medium shadow-none focus:outline-none";
    if (f.name === "document") return ({ dis }) => <EntradaDocumento {...reg("document")} onChange={mudarDocumento} tipoPessoa={String(tipoPessoa ?? "")} readOnly={dis} className={cls} erro={(form.formState.errors["document"]?.message as string | undefined) ?? null}
      onFocus={() => { if (dis) return; docAoEntrar.current = normalizarDocumento(String(form.getValues("document") ?? "")); tipoAoEntrar.current = form.getValues("person_type"); setDigitandoDocumento(true); }}
      onBlur={() => {
        setDigitandoDocumento(false);
        const atual = String(form.getValues("document") ?? "");
        const mudou = normalizarDocumento(atual) !== docAoEntrar.current || !iguala(form.getValues("person_type"), tipoAoEntrar.current);
        if (!dis && mudou) trocaAutomatica(atual, "saindo");
      }} />;
    // o seletor de sempre, mas a troca passa por `pedirTroca` (pergunta antes de apagar campo preenchido — R1, W-3) e SEM
    // o X de limpar: o tipo de pessoa nunca fica vazio (coluna NOT NULL, padrão Jurídica) — trocar é escolher outro tipo
    if (f.name === "person_type") return ({ padrao }) => padrao!({ aoMudar: (v) => pedirTroca(v), permiteVazio: false });
    if (f.name === "zip_code") return ({ dis }) => <EntradaCep {...reg("zip_code")} readOnly={dis} className={cls} onKeyDown={(e) => { if (e.key === "Tab" && !e.shiftKey) void buscarCep(); }} onBuscar={dis ? undefined : () => void buscarCep(true)} />;
    if (["phone", "cellphone", "contact_phone"].includes(f.name)) return ({ dis }) => <EntradaMascara {...reg(f.name)} mascara="telefone" readOnly={dis} className={cls} />;
    if (f.busca === "municipios") return ({ dis }) => <CampoCidade value={values[f.name] as number | string | null} onChange={(c) => form.setValue(f.name, c ?? "", { shouldDirty: true })} disabled={dis} classeEntrada={cls} />;
    if (f.name === "matriz_id") return ({ padrao }) => padrao!({ ligarRotulo: true, buscarOpcoes: buscaDaMatriz(f), excluirIds: !isNew && record?.["id"] ? [String(record["id"])] : [] });
    return undefined;
  };
  // booleanos do mesmo `grupo` (C-3, "Tipo do parceiro"): UM campo de marcação múltipla; cada opção continua a sua coluna.
  // Opção travada pelo layout (ou fora do corpo) não muda na tela (R1, W-8): ela nem iria no corpo.
  const grupo = (nome: string, fs: FieldDef[]) => <div key={`grupo-${nome}`} className="min-w-[280px] flex-[2]" data-testid={`grupo-${nome.toLowerCase().replace(/\s+/g, "-")}`} role="group" aria-label={nome}>
    <div className={cn("rounded-md border border-slate-200 px-2.5 py-1", readOnly || fs.every(travado) ? "bg-slate-50" : "bg-white")}><span className="block text-[11px] text-slate-500">{nome}</span>
      <div className="flex flex-wrap gap-3 pt-0.5">{fs.map((f) => <label key={f.name} className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" name={f.name} disabled={readOnly || travado(f)} className="accent-brand-500" checked={values[f.name] === true || values[f.name] === "true"} onChange={(e) => form.setValue(f.name, e.target.checked, { shouldDirty: true })} />{f.label}</label>)}</div></div>
    {erros.filter((e) => fs.some((f) => f.name === e.path)).map((e) => <p key={e.path} className="mt-0.5 text-[11px] text-red-600">{e.message}</p>)}
  </div>;
  const secao = (s: string) => {
    const fs = def.fields.filter((f) => f.section === s && visivel(f)); if (!fs.length) return null;
    const vistos = new Set<string>(); const nos: React.ReactNode[] = [];
    for (const f of fs) {
      if (f.grupo) { if (!vistos.has(f.grupo)) { vistos.add(f.grupo); nos.push(grupo(f.grupo, fs.filter((x) => x.grupo === f.grupo))); } continue; }
      nos.push(f.camposJson ? <JsonComoCampos key={f.name} f={f} form={form} dis={readOnly} /> : renderField(f.name, controle(f)));
    }
    return <Card key={s} className="col-span-12 p-3"><h3 className={cn(TITULO, "mb-2.5")}>{s}</h3><div className="flex flex-wrap gap-2" onBlur={s === "Endereço" && !parceiro ? () => void buscarCep() : undefined}>{nos}</div></Card>;
  };
  const semSecao = def.fields.filter((f) => !f.section && visivel(f)).map((f) => f.name);
  return <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="ficha-em-abas">
    {/* cabeçalho FIXO */}
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12.5px]" data-testid="ficha-cabecalho">
      {cab.filter((f) => f.type !== "boolean" && f.name !== "situacao_receita").map((f) => <span key={f.name} data-testid={`cabecalho-${f.name}`}><span className="text-slate-500">{f.label}: </span><b>{vazio(values[f.name]) ? (f.name === "code" && isNew ? "novo" : "—") : valorDoCabecalho(f, values[f.name], tipoPessoa, digitandoDocumento, parceiro)}</b></span>)}
      {cab.some((f) => f.type === "boolean" && f.name !== "is_active") && <span><span className="text-slate-500">Tipos: </span><b>{tipos.length ? tipos.join(", ") : "nenhum"}</b></span>}
      {cab.some((f) => f.name === "is_active") && <span className={cn("rounded px-1", values["is_active"] === false ? "bg-slate-200 text-slate-600" : "bg-green-100 text-green-800")}>{values["is_active"] === false ? "Inativo" : "Ativo"}</span>}
      {cab.some((f) => f.name === "situacao_receita") && situacao && <span data-testid="cabecalho-situacao_receita"><span className="text-slate-500">Receita: </span><b>{situacao}</b></span>}
      {situacao && situacao !== "ATIVA" && <span className="flex items-center gap-1 rounded bg-amber-100 px-1 text-amber-800" data-testid="aviso-situacao"><AlertTriangle className="h-3.5 w-3.5" /> Situação na Receita: {situacao}</span>}
    </Card>
    {divergeDoDocumento && <div className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12.5px] text-amber-900" data-testid="faixa-tipo-documento">
      <AlertTriangle className="h-3.5 w-3.5" /> O documento é {pedido === "natural" ? "um CPF" : "um CNPJ"}, mas o tipo de pessoa está como {tipoPessoa === "legal" ? "Jurídica" : "Física"}.
      {podeAjustar && <><PillBtn tone="gray" onClick={() => pedirTroca(pedido, { antes: readOnly ? entrarEmEdicao : undefined })}>Ajustar para {rotuloDoPedido}</PillBtn>
      <span className="text-amber-700">(grava ao Salvar)</span></>}
    </div>}
    {cnpjValidoNovo && <div className="flex items-center gap-2 rounded border border-green-300 bg-green-50 px-3 py-1.5 text-[12.5px] text-green-900" data-testid="aviso-cnpj-valido">CNPJ válido — <PillBtn tone="gray" onClick={() => abrirConsultaCnpj?.()}>Consultar na Receita</PillBtn></div>}
    <div className="flex flex-wrap gap-1" role="tablist">{abas.map((a) => { const n = contagem.get(a.key) ?? 0; return <button key={a.key} type="button" role="tab" aria-selected={cur === a.key} onClick={() => setAtiva(a.key)} className={cn("seg-tab", cur === a.key && "active")}>{a.label}{n > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white" data-testid={`erros-aba-${a.key}`}>{n}</span>}</button>; })}</div>
    <div className="min-h-0 flex-1 overflow-auto">
      {abas.map((a, i) => <div key={a.key} className={cn("grid grid-cols-12 gap-3", cur !== a.key && "hidden")} role="tabpanel" aria-label={a.label}>
        {i === 0 && semSecao.length > 0 && <Card className="col-span-12 p-3"><div className="flex flex-wrap gap-2">{semSecao.map((n) => renderField(n))}</div></Card>}
        {semEdicao(a) || (a.link && !isNew && record?.["id"]) ? <Card className="col-span-12 p-3 text-[12.5px]" data-testid={`aba-aviso-${a.key}`}>
          {semEdicao(a) && <span className="mr-2 text-slate-600">Somente leitura: o seu perfil não tem a permissão de edição desta aba.</span>}
          {a.link && !isNew && record?.["id"] ? <a className="text-brand-700 underline" href={a.link.href.replace(":id", String(record["id"]))}>{a.link.label}</a> : null}
        </Card> : null}
        {(a.secoes ?? []).map(secao)}
        {!consultaJanela && a.key === "identificacao" && def.fields.some((f) => f.name === "document") && <ConsultaCnpj form={form} dis={readOnly} />}
        {(a.perfis ?? []).map((k) => { const p = def.perfis?.find((x) => x.key === k); return p ? <CamposDoPerfil key={k} p={p} form={form} dis={readOnly || semEdicao(a)} /> : null; })}
        {(a.detalhes ?? []).filter((k) => !barradas.has(k)).map((k) => { const d = def.detalhes?.find((x) => x.key === k); return d ? <GradeDeDetalhe key={k} d={d} form={form} dis={readOnly || semEdicao(a)} erros={erros} mascaras={parceiro} /> : null; })}
        {a.key === "funcionario" && <Card className="col-span-12 p-3 text-[12.5px]">Funcionário: os eventos fixos, as ocorrências e a folha ficam no RH. {!isNew && record?.["id"] ? <a className="text-brand-700 underline" href={`/cadastros/funcionarios/${String(record["id"])}`}>Abrir no RH</a> : "Salve o parceiro para abrir no RH."}</Card>}
        {a.painel === "saldo_por_lote" && <SaldoPorLote id={isNew ? null : (record?.["id"] as string | undefined) ?? null} />}
        {a.painel === "historico" && <HistoricoDaFicha def={def} id={isNew ? null : (record?.["id"] as string | undefined) ?? null} />}
      </div>)}
    </div>
    {/* R1, W-3: a troca do tipo apagaria campos preenchidos — pergunta antes; Cancelar mantém tipo e valores */}
    <ConfirmDialog open={troca !== null} onOpenChange={(o) => { if (!o) setTroca(null); }} title="Mudar o tipo de pessoa" confirmLabel={troca ? `Mudar para ${rotuloDoTipo(def, troca.novo)}` : undefined} dismissLabel="Cancelar"
      onConfirm={() => { if (troca) { recusada.current = null; aplicarTroca(troca.novo, troca.campos, troca.antes); } setTroca(null); }}>
      {troca && <p className="text-sm text-slate-700" data-testid="confirmar-troca-de-tipo">{mensagemDaTrocaDeTipo(rotuloDoTipo(def, troca.novo), troca.campos.map((f) => f.label))}</p>}
    </ConfirmDialog>
  </div>;
}
