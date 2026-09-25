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
import { campoVisivel, chavesBarradas, normalizarDocumento, validarCnpj } from "@agro/domain";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Card, Input, NativeSelect } from "@/components/ui";
import { filtroDaReferencia, RefSelect, ReferenciaSelect } from "@/components/ui/ref-select";
import { PillBtn } from "@/features/base1/ui";
import { AttachmentsDialog } from "@/features/base1/attachments-dialog";

type Values = Record<string, unknown>;
export interface ErroDaFicha { path: string; message: string; aba?: string | null; detalhe?: string; linha?: number | null }

const TITULO = "text-[13px] font-semibold text-slate-800";
const iguala = (x: unknown, esperado: unknown) => x === esperado || String(x) === String(esperado);
const vazio = (v: unknown) => v === "" || v === null || v === undefined;

/** Marca da linha que veio GRAVADA (R1-2: com as permissões do cadastro dono, a linha gravada edita com `editar` e sai com `excluir`; a nova, com `criar`). Nunca vai no corpo. */
const GRAVADA = "__gravada";

/** Registro da API → valores do formulário (grades como listas, perfis como objetos). */
export function fichaDoRegistro(def: ResourceDef, data: Values | null | undefined): Values {
  const v: Values = {};
  for (const d of def.detalhes ?? []) v[d.key] = ((data?.[d.key] as Values[] | undefined) ?? []).map((l) => ({ ...l, [GRAVADA]: true }));
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

function CelulaDaGrade({ f, valor, onChange, dis }: { f: FieldDef; valor: unknown; onChange: (v: unknown) => void; dis: boolean }) {
  const cls = "h-7 w-full min-w-[90px] text-[12.5px]";
  if (f.busca) return <ReferenciaSelect referencia={f.busca} value={valor as string | number | null} onChange={(x) => onChange(x ?? "")} disabled={dis} className={cls} />;
  if (f.type === "ref") return <RefSelect resource={f.ref!.resource} filter={filtroDaReferencia(f)} value={valor as string} onChange={(x) => onChange(x ?? "")} disabled={dis} className={cls} />;
  if (f.type === "boolean") return <input type="checkbox" aria-label={f.label} disabled={dis} className="accent-brand-500" checked={valor === true || valor === "true"} onChange={(e) => onChange(e.target.checked)} />;
  if (f.type === "select") return <NativeSelect aria-label={f.label} disabled={dis} className={cls} value={String(valor ?? "")} onChange={(e) => onChange(e.target.value)}><option value="" />{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>;
  return <Input aria-label={f.label} readOnly={dis} className={cls} type={f.type === "email" ? "email" : numerico.includes(f.type) ? "number" : "text"} value={String(valor ?? "")} onChange={(e) => onChange(e.target.value)} />;
}

/** Grade de um detalhe 1:N dentro da aba. Linha com erro do servidor fica marcada. */
function GradeDeDetalhe({ d, form, dis, erros }: { d: DetalheDef; form: UseFormReturn<Values>; dis: boolean; erros: ErroDaFicha[] }) {
  const { can } = useAuth();
  const linhas = (form.watch(d.key) as Values[] | undefined) ?? [];
  const set = (nova: Values[]) => form.setValue(d.key, nova, { shouldDirty: true });
  const campos = d.fields.filter((f) => !f.readOnly && campoVisivel(f, can));
  // grade de OUTRO cadastro (R1-2): cada operação com a permissão dele — incluir (criar), mudar a linha gravada
  // (editar), tirar a linha gravada (excluir). Só apresentação: o servidor confere cada uma.
  const ps = d.permissoes;
  const podeCriar = !ps || can(ps.criar); const podeEditar = !ps || can(ps.editar); const podeExcluir = !ps || can(ps.excluir);
  const travada = (l: Values, f: FieldDef) => dis || (l[GRAVADA] ? (f.name === d.chaveNatural ? !(podeCriar && podeExcluir) : !podeEditar) : !podeCriar);
  const erroDaLinha = (i: number) => erros.filter((e) => e.detalhe === d.key && e.linha === i + 1);
  return <Card className="col-span-12 p-3" data-testid={`grade-${d.key}`}>
    <div className="mb-2 flex items-center justify-between"><h3 className={TITULO}>{d.label}</h3>
      {!dis && podeCriar && <PillBtn tone="gray" onClick={() => set([...linhas, Object.fromEntries(campos.map((f) => [f.name, f.default ?? (f.type === "boolean" ? false : "")]))])}><Plus className="h-3.5 w-3.5" /> Incluir linha</PillBtn>}</div>
    {linhas.length === 0 ? <p className="text-[12px] text-slate-400">Nenhuma linha.</p> :
      <div className="overflow-x-auto"><table className="w-full text-[12.5px]"><thead><tr>{campos.map((f) => <th key={f.name} className="px-1 text-left font-semibold text-slate-600">{f.label}{f.required && <span className="text-red-500"> *</span>}</th>)}<th /></tr></thead>
        <tbody>{linhas.map((l, i) => { const es = erroDaLinha(i); return <React.Fragment key={String(l["id"] ?? `n${i}`)}>
          <tr className={cn(es.length > 0 && "bg-red-50")} data-testid={`linha-${d.key}-${i + 1}`}>{campos.map((f) => <td key={f.name} className="px-1 py-0.5"><CelulaDaGrade f={f} valor={l[f.name]} dis={travada(l, f)} onChange={(x) => set(linhas.map((y, k) => (k === i ? { ...y, [f.name]: x } : y)))} /></td>)}
            <td>{!dis && (!l[GRAVADA] || podeExcluir) && <button type="button" aria-label={`Remover linha ${i + 1}`} className="rounded p-1 text-red-600 hover:bg-red-50" onClick={() => set(linhas.filter((_, k) => k !== i))}><Trash2 className="h-3.5 w-3.5" /></button>}</td></tr>
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

/** CEP: ao sair do campo, a consulta preenche endereço, bairro e município. Falha nunca impede salvar. */
export function useCepDaFicha(form: UseFormReturn<Values>, ativo: boolean) {
  const cep = String(form.watch("zip_code") ?? "").replace(/\D/g, "");
  const ultimo = React.useRef<string>("");
  return React.useCallback(async () => {
    if (!ativo || cep.length !== 8 || ultimo.current === cep) return;
    ultimo.current = cep;
    try {
      const r = await api<{ logradouro: string | null; bairro: string | null; complemento: string | null; municipio: { codigoIbge: number } | null }>(`/api/consultas/cep/${cep}`);
      if (r.logradouro) form.setValue("address", r.logradouro, { shouldDirty: true });
      if (r.bairro) form.setValue("district", r.bairro, { shouldDirty: true });
      if (r.municipio) form.setValue("city_id", r.municipio.codigoIbge, { shouldDirty: true });
      if (r.complemento && vazio(form.getValues("complemento"))) form.setValue("complemento", r.complemento, { shouldDirty: true });
    } catch { toast.info("Não foi possível consultar o CEP agora; preencha o endereço."); }
  }, [ativo, cep, form]);
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

export function FichaEmAbas({ def, form, readOnly, isNew, record, erros, renderField, visivel }: { def: ResourceDef; form: UseFormReturn<Values>; readOnly: boolean; isNew: boolean; record: Values | null; erros: ErroDaFicha[]; renderField: (fid: string) => React.ReactNode; visivel: (f: FieldDef) => boolean }) {
  const { can } = useAuth();
  const values = form.watch();
  // aba sem a permissão de LEITURA (R1-4, ex.: Cliente sem clients.view) não aparece — a API também não manda os dados dela.
  // Grade de OUTRO cadastro sem a leitura dele (R1-2) some; a aba que só tinha essas grades (Eventos fixos sem
  // employee_events.view) não aparece.
  const barradas = chavesBarradas(def, "permissaoDeLeitura", can);
  const soGradesBarradas = (a: { secoes?: string[]; perfis?: string[]; detalhes?: string[]; painel?: string }) => !a.secoes?.length && !a.perfis?.length && !a.painel && Boolean(a.detalhes?.length) && a.detalhes!.every((k) => barradas.has(k));
  const abas = (def.abas ?? []).filter((a) => (!a.permissaoDeLeitura || can(a.permissaoDeLeitura)) && !soGradesBarradas(a) && (!a.visivelQuando || iguala(values[a.visivelQuando.field], a.visivelQuando.equals)));
  const semEdicao = (a: { permissaoDeEdicao?: string }) => Boolean(a.permissaoDeEdicao && !can(a.permissaoDeEdicao));
  const [ativa, setAtiva] = React.useState(abas[0]?.key ?? "");
  const cur = abas.some((a) => a.key === ativa) ? ativa : abas[0]?.key ?? "";
  const [anexos, setAnexos] = React.useState(false);
  const buscarCep = useCepDaFicha(form, !readOnly);
  // contador de erros por aba: erros do servidor (com aba) + campos obrigatórios pendentes do formulário
  const contagem = new Map<string, number>();
  for (const e of erros) { const k = e.aba ?? abaDoCampo(def, e.path.split(".")[0] ?? ""); if (k) contagem.set(k, (contagem.get(k) ?? 0) + 1); }
  for (const nome of Object.keys(form.formState.errors)) { if (erros.some((e) => e.path === nome)) continue; const k = abaDoCampo(def, nome); if (k) contagem.set(k, (contagem.get(k) ?? 0) + 1); }
  const situacao = String(values["situacao_receita"] ?? record?.["situacao_receita"] ?? "");
  const cab = (def.cabecalho ?? []).map((n) => def.fields.find((f) => f.name === n)).filter((f): f is FieldDef => Boolean(f));
  const tipos = cab.filter((f) => f.type === "boolean" && f.name !== "is_active" && values[f.name] === true).map((f) => f.label);
  const secao = (s: string) => { const fs = def.fields.filter((f) => f.section === s && visivel(f)); if (!fs.length) return null; return <Card key={s} className="col-span-12 p-3"><h3 className={cn(TITULO, "mb-2.5")}>{s}</h3><div className="flex flex-wrap gap-2" onBlur={s === "Endereço" ? () => void buscarCep() : undefined}>{fs.map((f) => (f.camposJson ? <JsonComoCampos key={f.name} f={f} form={form} dis={readOnly} /> : renderField(f.name)))}</div></Card>; };
  const semSecao = def.fields.filter((f) => !f.section && visivel(f)).map((f) => f.name);
  return <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="ficha-em-abas">
    {/* cabeçalho FIXO */}
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12.5px]" data-testid="ficha-cabecalho">
      {cab.filter((f) => f.type !== "boolean").map((f) => <span key={f.name}><span className="text-slate-500">{f.label}: </span><b>{vazio(values[f.name]) ? (f.name === "code" && isNew ? "novo" : "—") : String(values[f.name])}</b></span>)}
      {cab.some((f) => f.type === "boolean" && f.name !== "is_active") && <span><span className="text-slate-500">Tipos: </span><b>{tipos.length ? tipos.join(", ") : "nenhum"}</b></span>}
      {cab.some((f) => f.name === "is_active") && <span className={cn("rounded px-1", values["is_active"] === false ? "bg-slate-200 text-slate-600" : "bg-green-100 text-green-800")}>{values["is_active"] === false ? "Inativo" : "Ativo"}</span>}
      {situacao && situacao !== "ATIVA" && <span className="flex items-center gap-1 rounded bg-amber-100 px-1 text-amber-800" data-testid="aviso-situacao"><AlertTriangle className="h-3.5 w-3.5" /> Situação na Receita: {situacao}</span>}
    </Card>
    <div className="flex flex-wrap gap-1" role="tablist">{abas.map((a) => { const n = contagem.get(a.key) ?? 0; return <button key={a.key} type="button" role="tab" aria-selected={cur === a.key} onClick={() => setAtiva(a.key)} className={cn("seg-tab", cur === a.key && "active")}>{a.label}{n > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white" data-testid={`erros-aba-${a.key}`}>{n}</span>}</button>; })}</div>
    <div className="min-h-0 flex-1 overflow-auto">
      {abas.map((a, i) => <div key={a.key} className={cn("grid grid-cols-12 gap-3", cur !== a.key && "hidden")} role="tabpanel" aria-label={a.label}>
        {i === 0 && semSecao.length > 0 && <Card className="col-span-12 p-3"><div className="flex flex-wrap gap-2">{semSecao.map(renderField)}</div></Card>}
        {semEdicao(a) || (a.link && !isNew && record?.["id"]) ? <Card className="col-span-12 p-3 text-[12.5px]" data-testid={`aba-aviso-${a.key}`}>
          {semEdicao(a) && <span className="mr-2 text-slate-600">Somente leitura: o seu perfil não tem a permissão de edição desta aba.</span>}
          {a.link && !isNew && record?.["id"] ? <a className="text-brand-700 underline" href={a.link.href.replace(":id", String(record["id"]))}>{a.link.label}</a> : null}
        </Card> : null}
        {(a.secoes ?? []).map(secao)}
        {a.key === "identificacao" && def.fields.some((f) => f.name === "document") && <ConsultaCnpj form={form} dis={readOnly} />}
        {(a.perfis ?? []).map((k) => { const p = def.perfis?.find((x) => x.key === k); return p ? <CamposDoPerfil key={k} p={p} form={form} dis={readOnly || semEdicao(a)} /> : null; })}
        {(a.detalhes ?? []).filter((k) => !barradas.has(k)).map((k) => { const d = def.detalhes?.find((x) => x.key === k); return d ? <GradeDeDetalhe key={k} d={d} form={form} dis={readOnly || semEdicao(a)} erros={erros} /> : null; })}
        {a.key === "funcionario" && <Card className="col-span-12 p-3 text-[12.5px]">Funcionário: os eventos fixos, as ocorrências e a folha ficam no RH. {!isNew && record?.["id"] ? <a className="text-brand-700 underline" href={`/cadastros/funcionarios/${String(record["id"])}`}>Abrir no RH</a> : "Salve o parceiro para abrir no RH."}</Card>}
        {a.painel === "saldo_por_lote" && <SaldoPorLote id={isNew ? null : (record?.["id"] as string | undefined) ?? null} />}
        {a.painel === "historico" && <HistoricoDaFicha def={def} id={isNew ? null : (record?.["id"] as string | undefined) ?? null} />}
        {a.key === "anexos" && <Card className="col-span-12 p-3 text-[12.5px]">{isNew || !record?.["id"] ? `Salve o ${def.label.toLowerCase()} para anexar arquivos.` : <><PillBtn tone="gray" onClick={() => setAnexos(true)}>Abrir anexos</PillBtn><AttachmentsDialog open={anexos} onOpenChange={setAnexos} entity={def.key} entityId={String(record["id"])} title={`Anexos · ${String(record[def.labelField] ?? "")}`} /></>}</Card>}
      </div>)}
    </div>
  </div>;
}
