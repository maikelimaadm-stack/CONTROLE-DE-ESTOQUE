import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { obterJson, LimitePorMinuto, type BuscarFn } from "../../src/lib/consultas/http.js";
import { consultarCnpjNasFontes, FONTES_CNPJ, PausaDeFontes } from "../../src/lib/consultas/cnpj.js";
import { consultarCepNasFontes } from "../../src/lib/consultas/cep.js";

/**
 * RF-4 (CEP) e RF-5 (CNPJ) sobre MOCK das fontes — nenhuma chamada de rede. Os corpos imitam o formato
 * real de cada fonte (conferido em 2026-09-24), com o quadro societário presente para provar que ele
 * nunca sai do adaptador.
 */
type Resp = { status: number; body?: unknown; location?: string } | "tempo" | "rede";
function mock(rotas: Record<string, Resp | Resp[]>) {
  const chamadas: string[] = [];
  const buscar: BuscarFn = async (url, init) => {
    chamadas.push(url);
    const host = new URL(url).host;
    const def = rotas[host] ?? rotas[url];
    const r = Array.isArray(def) ? def.shift() : def;
    if (!r) throw new Error(`rota sem mock: ${url}`);
    if (r === "rede") throw new TypeError("fetch failed");
    if (r === "tempo") return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("abort"))));
    return { status: r.status, headers: { get: (n: string) => (n === "location" ? r.location ?? null : null) }, json: async () => r.body };
  };
  return { buscar, chamadas };
}

const CNPJ = "00000000000191";
const QSA_BRASILAPI = [{ nome_socio: "SOCIO SECRETO", cnpj_cpf_do_socio: "***550179**", qualificacao_socio: "Diretor" }];
const BRASILAPI = { cnpj: CNPJ, razao_social: "BANCO DO BRASIL SA", nome_fantasia: "DIRECAO GERAL", descricao_situacao_cadastral: "ATIVA", data_situacao_cadastral: "2005-11-03", descricao_motivo_situacao_cadastral: "SEM MOTIVO", data_inicio_atividade: "1966-08-01", codigo_natureza_juridica: 2038, natureza_juridica: "Sociedade de Economia Mista", porte: "DEMAIS", cnae_fiscal: 6422100, cnae_fiscal_descricao: "Bancos múltiplos, com carteira comercial", cnaes_secundarios: [{ codigo: 6499999, descricao: "Outras" }], descricao_tipo_de_logradouro: "QUADRA", logradouro: "SAUN QUADRA 5", numero: "SN", complemento: "ANDAR T I", bairro: "ASA NORTE", cep: "70040912", codigo_municipio_ibge: 5300108, municipio: "BRASILIA", uf: "DF", ddd_telefone_1: "6134939002", ddd_telefone_2: "", email: null, opcao_pelo_simples: false, opcao_pelo_mei: false, identificador_matriz_filial: 1, qsa: QSA_BRASILAPI };
const CNPJA = { updated: "2026-09-23T19:26:29.263Z", taxId: CNPJ, alias: "Direcao Geral", founded: "1966-08-01", head: true, statusDate: "2005-11-03", status: { id: 2, text: "Ativa" }, company: { name: "BANCO DO BRASIL SA", members: [{ person: { name: "SOCIO SECRETO", taxId: "***147908**" }, role: { text: "Diretor" } }], nature: { id: 2038, text: "Sociedade de Economia Mista" }, size: { acronym: "DEMAIS" }, simples: { optant: false, since: null }, simei: { optant: false, since: null } }, address: { municipality: 5300108, street: "Quadra Saun", number: "SN", district: "Asa Norte", city: "Brasília", state: "DF", details: "Andar", zip: "70040912" }, phones: [{ area: "61", number: "34939002" }], emails: [{ address: "secex@bb.com.br" }], mainActivity: { id: 6422100, text: "Bancos múltiplos" }, sideActivities: [] };
const CNPJWS = { razao_social: "BANCO DO BRASIL SA", atualizado_em: "2026-09-12T03:00:00.000Z", porte: { descricao: "Demais" }, natureza_juridica: { id: "2038", descricao: "Sociedade de Economia Mista" }, socios: [{ nome: "SOCIO SECRETO", cpf_cnpj_socio: "***058029**" }], simples: { simples: "Sim", data_opcao_simples: "2007-07-01", mei: "Não", data_opcao_mei: null }, estabelecimento: { cnpj: CNPJ, tipo: "Matriz", nome_fantasia: "DIRECAO GERAL", situacao_cadastral: "Ativa", data_situacao_cadastral: "2005-11-03", data_inicio_atividade: "1966-08-01", tipo_logradouro: "QUADRA", logradouro: "SAUN", numero: "SN", complemento: null, bairro: "ASA NORTE", cep: "70040912", ddd1: "61", telefone1: "34939002", email: "secex@bb.com.br", atividade_principal: { id: "6422100", descricao: "Bancos" }, atividades_secundarias: [], cidade: { nome: "Brasília", ibge_id: 5300108 }, estado: { sigla: "DF" } } };
const TODAS = ["brasilapi", "cnpja", "cnpjws"] as const;
const semSocio = (v: unknown) => expect(JSON.stringify(v)).not.toMatch(/SOCIO SECRETO|qsa|members|socios|\*\*\*/i);

describe("RF-5 CNPJ: ordem das fontes gratuitas", () => {
  it("1ª fonte ok → resposta da 1ª, sem QSA, uma chamada só", async () => {
    const m = mock({ "brasilapi.com.br": { status: 200, body: BRASILAPI } });
    const r = await consultarCnpjNasFontes(m.buscar, CNPJ, TODAS, new PausaDeFontes());
    expect(r.tipo).toBe("ok");
    if (r.tipo !== "ok") return;
    expect(r.fonte).toBe("brasilapi");
    expect(r.dados).toMatchObject({ razaoSocial: "BANCO DO BRASIL SA", situacao: { descricao: "ATIVA", data: "2005-11-03", motivo: "SEM MOTIVO" }, naturezaJuridica: { codigo: "2038" }, cnaePrincipal: { codigo: "6422100" }, endereco: { municipioIbge: 5300108, uf: "DF", logradouro: "QUADRA SAUN QUADRA 5" }, telefones: ["6134939002"], matriz: true, simples: { optante: false }, mei: { optante: false } });
    semSocio(r.dados);
    expect(m.chamadas).toEqual([`https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`]);
  });
  it("1ª fora (tempo) → 2ª, com a data da informação da fonte", async () => {
    const m = mock({ "brasilapi.com.br": "tempo", "open.cnpja.com": { status: 200, body: CNPJA } });
    const r = await consultarCnpjNasFontes(m.buscar, CNPJ, TODAS, new PausaDeFontes(), 30);
    expect(r).toMatchObject({ tipo: "ok", fonte: "cnpja", dados: { razaoSocial: "BANCO DO BRASIL SA", dataDaInformacao: "2026-09-23T19:26:29.263Z", endereco: { municipioIbge: 5300108 }, email: "secex@bb.com.br", telefones: ["6134939002"] } });
    if (r.tipo === "ok") semSocio(r.dados);
  });
  it("1ª com 5xx e 2ª com rede fora → 3ª", async () => {
    const m = mock({ "brasilapi.com.br": { status: 502, body: {} }, "open.cnpja.com": "rede", "publica.cnpj.ws": { status: 200, body: CNPJWS } });
    const r = await consultarCnpjNasFontes(m.buscar, CNPJ, TODAS, new PausaDeFontes());
    expect(r).toMatchObject({ tipo: "ok", fonte: "cnpjws", dados: { simples: { optante: true, desde: "2007-07-01" }, mei: { optante: false }, matriz: true, endereco: { municipioIbge: 5300108 } } });
    if (r.tipo === "ok") semSocio(r.dados);
  });
  it("1ª com 429 → 2ª, e a 1ª fica em pausa por 60 s (não é chamada na consulta seguinte)", async () => {
    let t = 1_000_000; const pausa = new PausaDeFontes(() => t);
    const m = mock({ "brasilapi.com.br": [{ status: 429, body: {} }, { status: 200, body: BRASILAPI }], "open.cnpja.com": [{ status: 200, body: CNPJA }, { status: 200, body: CNPJA }] });
    expect(await consultarCnpjNasFontes(m.buscar, CNPJ, TODAS, pausa)).toMatchObject({ tipo: "ok", fonte: "cnpja" });
    expect(await consultarCnpjNasFontes(m.buscar, CNPJ, TODAS, pausa)).toMatchObject({ tipo: "ok", fonte: "cnpja" });
    expect(m.chamadas.filter((u) => u.includes("brasilapi"))).toHaveLength(1);
    t += 60_001;
    expect(await consultarCnpjNasFontes(m.buscar, CNPJ, TODAS, pausa)).toMatchObject({ tipo: "ok", fonte: "brasilapi" });
  });
  it("1ª diz 'não encontrado' e a 2ª acha → resposta da 2ª", async () => {
    const m = mock({ "brasilapi.com.br": { status: 404, body: { type: "not_found" } }, "open.cnpja.com": { status: 200, body: CNPJA } });
    expect(await consultarCnpjNasFontes(m.buscar, CNPJ, TODAS, new PausaDeFontes())).toMatchObject({ tipo: "ok", fonte: "cnpja" });
  });
  it("TODAS dizem 'não encontrado' → inexistente", async () => {
    const m = mock({ "brasilapi.com.br": { status: 404 }, "open.cnpja.com": { status: 404 }, "publica.cnpj.ws": { status: 404 } });
    expect(await consultarCnpjNasFontes(m.buscar, CNPJ, TODAS, new PausaDeFontes())).toEqual({ tipo: "inexistente" });
    expect(m.chamadas).toHaveLength(3);
  });
  it("uma não encontrou e as outras estão fora → indisponível (não afirma inexistência)", async () => {
    const m = mock({ "brasilapi.com.br": { status: 404 }, "open.cnpja.com": { status: 503 }, "publica.cnpj.ws": { status: 429 } });
    expect(await consultarCnpjNasFontes(m.buscar, CNPJ, TODAS, new PausaDeFontes())).toEqual({ tipo: "indisponivel" });
  });
  it("todas fora → indisponível", async () => {
    const m = mock({ "brasilapi.com.br": "rede", "open.cnpja.com": { status: 500 }, "publica.cnpj.ws": "tempo" });
    expect(await consultarCnpjNasFontes(m.buscar, CNPJ, TODAS, new PausaDeFontes(), 30)).toEqual({ tipo: "indisponivel" });
  });
  it("alfanumérico sem fonte que aceite → sem_suporte_alfanumerico, SEM chamada", async () => {
    const m = mock({});
    expect(await consultarCnpjNasFontes(m.buscar, "12ABC34501DE35", TODAS, new PausaDeFontes())).toEqual({ tipo: "sem_suporte_alfanumerico" });
    expect(m.chamadas).toEqual([]);
  });
  it("ordem configurável: a lista manda", async () => {
    const m = mock({ "publica.cnpj.ws": { status: 200, body: CNPJWS } });
    expect(await consultarCnpjNasFontes(m.buscar, CNPJ, ["cnpjws"], new PausaDeFontes())).toMatchObject({ tipo: "ok", fonte: "cnpjws" });
    expect(m.chamadas).toEqual([`https://publica.cnpj.ws/cnpj/${CNPJ}`]);
  });
  it("nenhum mapeador devolve campo de sócio, mesmo com o corpo inteiro de sócios", () => {
    semSocio(FONTES_CNPJ.brasilapi.mapear(BRASILAPI, CNPJ));
    semSocio(FONTES_CNPJ.cnpja.mapear(CNPJA, CNPJ));
    semSocio(FONTES_CNPJ.cnpjws.mapear(CNPJWS, CNPJ));
  });
});

describe("RF-5 nenhum cliente de API paga no repositório", () => {
  it("só as três fontes gratuitas, sem credencial em lugar nenhum da consulta", () => {
    expect(Object.keys(FONTES_CNPJ).sort()).toEqual(["brasilapi", "cnpja", "cnpjws"]);
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
    const arquivos = ["lib/consultas/cnpj.ts", "lib/consultas/http.ts", "lib/consultas/cep.ts", "routes/consultas.ts", "config.ts"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
    expect(arquivos).not.toMatch(/serpro|receitaws|cnpja\.com\/(?!office)|api\.cnpja|authorization|bearer|api[_-]?key|token/i);
  });
});

describe("SSRF: host fixo, parâmetro validado, sem redirecionamento para outro host", () => {
  it("parâmetro fora de [0-9A-Z] é recusado ANTES da chamada", async () => {
    const m = mock({});
    await expect(obterJson(m.buscar, "brasilapi.com.br", (c) => `/api/cnpj/v1/${c}`, "../../x", 100)).rejects.toThrow();
    await expect(obterJson(m.buscar, "brasilapi.com.br", (c) => `/api/cnpj/v1/${c}`, "1@evil.com", 100)).rejects.toThrow();
    expect(m.chamadas).toEqual([]);
  });
  it("redirecionamento para outro host é falha da fonte; para o mesmo host é seguido", async () => {
    const fora = mock({ "brasilapi.com.br": { status: 302, location: "https://evil.example/x" } });
    expect(await obterJson(fora.buscar, "brasilapi.com.br", (c) => `/a/${c}`, "1", 100)).toEqual({ tipo: "falha", motivo: "redirecionamento", status: 302 });
    expect(fora.chamadas).toHaveLength(1);
    const dentro = mock({ "brasilapi.com.br": [{ status: 301, location: "/b/1" }, { status: 200, body: { ok: 1 } }] });
    expect(await obterJson(dentro.buscar, "brasilapi.com.br", (c) => `/a/${c}`, "1", 100)).toEqual({ tipo: "ok", status: 200, corpo: { ok: 1 } });
  });
  it("limite por minuto", () => {
    let t = 0; const l = new LimitePorMinuto(2, () => t);
    expect([l.permitir("a"), l.permitir("a"), l.permitir("a"), l.permitir("b")]).toEqual([true, true, false, true]);
    t = 60_001; expect(l.permitir("a")).toBe(true);
  });
});

describe("RF-4 CEP: ViaCEP principal, BrasilAPI reserva", () => {
  const VIACEP = { cep: "77405-070", logradouro: "Rua de 14 Novembro", complemento: "de 1500/1501 ao fim", bairro: "Setor Central", localidade: "Gurupi", uf: "TO", ibge: "1709500" };
  const BAPI = { cep: "77405070", state: "TO", city: "Gurupi", neighborhood: "Setor Central", street: "Rua de 14 novembro", ibge: { city: "1709500" } };
  it("ok pela principal", async () => {
    const m = mock({ "viacep.com.br": { status: 200, body: VIACEP } });
    expect(await consultarCepNasFontes(m.buscar, "77405070")).toEqual({ tipo: "ok", fonte: "viacep", dados: { cep: "77405070", logradouro: "Rua de 14 Novembro", complemento: "de 1500/1501 ao fim", bairro: "Setor Central", municipioIbge: 1709500, municipioNome: "Gurupi", uf: "TO" } });
  });
  it("principal fora → reserva", async () => {
    const m = mock({ "viacep.com.br": "tempo", "brasilapi.com.br": { status: 200, body: BAPI } });
    expect(await consultarCepNasFontes(m.buscar, "77405070", 30)).toMatchObject({ tipo: "ok", fonte: "brasilapi", dados: { municipioIbge: 1709500, bairro: "Setor Central" } });
  });
  it("inexistente nas duas → inexistente", async () => {
    const m = mock({ "viacep.com.br": { status: 200, body: { erro: "true" } }, "brasilapi.com.br": { status: 404, body: {} } });
    expect(await consultarCepNasFontes(m.buscar, "99999999")).toEqual({ tipo: "inexistente" });
  });
  it("as duas fora → indisponível", async () => {
    const m = mock({ "viacep.com.br": { status: 500 }, "brasilapi.com.br": "rede" });
    expect(await consultarCepNasFontes(m.buscar, "77405070")).toEqual({ tipo: "indisponivel" });
  });
});
