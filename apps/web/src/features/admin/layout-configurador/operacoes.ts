import {
  MENSAGEM_OBRIGATORIO_NAO_SAI,
  camposAdicionaisDoCabecalho,
  catalogoDaFamilia,
  motivoZonaProibida,
  type CampoDoLayout,
  type ColunaDoLayout,
  type EstruturaLayout,
  type ZonaDoLayout
} from "@agro/domain";
import type { ResultadoOperacao } from "./contrato";
import { campoDaChave, ehChaveDeColuna } from "./contrato";

/**
 * OPERAÇÕES PURAS sobre a estrutura (VENDAS-A3-1c). Dono: agente W6. Arrastar e os botões sem mouse chamam as MESMAS.
 * Regra de zona: `motivoZonaProibida` do domínio. Obrigatório do sistema (catálogo `sistema`) nunca sai
 * (MENSAGEM_OBRIGATORIO_NAO_SAI). Campo do documento que entra vem com os valores do layout do sistema (obrigatorio do
 * sistema, editavel true); coluna idem. Sair do cabeçalho apaga `grupo`; entrar no cabeçalho define `grupo` — e, na
 * PRIMEIRA vez que algum campo ganha grupo, os demais do cabeçalho recebem o grupo que tinham pela regra antiga
 * (camposAdicionaisDoCabecalho), para a prévia não mudar sozinha. Aba que fica vazia continua existindo (a validação
 * recusa aba vazia ao salvar; a tela avisa).
 *
 * Nenhuma operação muta a estrutura recebida: toda saída é uma cópia nova.
 */
const ok = (estrutura: EstruturaLayout): ResultadoOperacao => ({ ok: true, estrutura });
const recusa = (motivo: string): ResultadoOperacao => ({ ok: false, motivo });

const MSG_SO_ITENS = "Só colunas dos itens podem ficar na grade de itens.";
const MSG_COLUNA_SO_ITENS = "Colunas dos itens só podem ficar na grade de itens.";
const MSG_FORA = "Campo não está no layout.";
const MSG_DESCONHECIDO = "Campo não existe no catálogo deste movimento.";
const MSG_ABA_INEXISTENTE = "Aba não existe.";
const MSG_ABA_NOME_VAZIO = "Informe o nome da aba.";
const MSG_ABA_NOME_REPETIDO = "Já existe uma aba com esse nome.";
const MSG_ABA_NAO_VAZIA = "Só é possível remover uma aba vazia.";

/** Cópia rasa por nível: nada do objeto recebido é compartilhado de forma mutável. */
function clonar(e: EstruturaLayout): EstruturaLayout {
  return {
    versaoSchema: e.versaoSchema,
    cabecalho: e.cabecalho.map((c) => ({ ...c })),
    rodape: e.rodape.map((a) => ({ aba: a.aba, campos: a.campos.map((c) => ({ ...c })) })),
    itens: e.itens.map((c) => ({ ...c }))
  };
}

const ehCabecalho = (z: ZonaDoLayout) => z.tipo === "principal" || z.tipo === "adicionais";

/** Onde está a chave ("itens.<c>" para coluna) na estrutura; null = fora do layout. */
export function ondeEsta(e: EstruturaLayout, chave: string): ZonaDoLayout | null {
  const campo = campoDaChave(chave);
  if (ehChaveDeColuna(chave)) return e.itens.some((c) => c.campo === campo) ? { tipo: "itens" } : null;
  if (e.cabecalho.some((c) => c.campo === campo)) {
    return camposAdicionaisDoCabecalho(e).includes(campo) ? { tipo: "adicionais" } : { tipo: "principal" };
  }
  const indice = e.rodape.findIndex((a) => a.campos.some((c) => c.campo === campo));
  return indice >= 0 ? { tipo: "aba", indice } : null;
}

/** A lista (mutável, da cópia) onde a zona guarda seus campos; cabeçalho = a lista inteira do cabeçalho. */
function listaDaZona(e: EstruturaLayout, zona: ZonaDoLayout): Array<CampoDoLayout | ColunaDoLayout> | null {
  if (zona.tipo === "itens") return e.itens;
  if (zona.tipo === "aba") return e.rodape[zona.indice]?.campos ?? null;
  return e.cabecalho;
}

/** Tira o campo (documento) de onde estiver na cópia; devolve o objeto tirado. */
function tirarDoDocumento(e: EstruturaLayout, campo: string): CampoDoLayout | null {
  const i = e.cabecalho.findIndex((c) => c.campo === campo);
  if (i >= 0) return e.cabecalho.splice(i, 1)[0] ?? null;
  for (const a of e.rodape) {
    const j = a.campos.findIndex((c) => c.campo === campo);
    if (j >= 0) return a.campos.splice(j, 1)[0] ?? null;
  }
  return null;
}

/**
 * Materializa o grupo do cabeçalho: se nenhum campo declara grupo, cada um recebe o grupo que tem pela regra antiga
 * (a prévia não muda sozinha). Chamada ANTES de mexer no cabeçalho com grupo explícito.
 */
function materializarGrupos(e: EstruturaLayout): void {
  if (e.cabecalho.some((c) => c.grupo !== undefined)) return;
  const adicionais = new Set(camposAdicionaisDoCabecalho(e));
  for (const c of e.cabecalho) c.grupo = adicionais.has(c.campo) ? "adicionais" : "principal";
}

/** Posição de inserção: antes de `antesDe` (se estiver na mesma lista) ou no fim — no cabeçalho, no fim do grupo. */
function posicaoDeInsercao(lista: ReadonlyArray<{ campo: string; grupo?: string }>, zona: ZonaDoLayout, antesDe?: string): number {
  if (antesDe !== undefined) {
    const alvo = campoDaChave(antesDe);
    const i = lista.findIndex((c) => c.campo === alvo && (!ehCabecalho(zona) || (c.grupo ?? "principal") === zona.tipo));
    if (i >= 0) return i;
  }
  if (ehCabecalho(zona)) {
    let ultimo = -1;
    lista.forEach((c, i) => { if ((c.grupo ?? "principal") === zona.tipo) ultimo = i; });
    return ultimo >= 0 ? ultimo + 1 : lista.length;
  }
  return lista.length;
}

/** Põe (ou move) a chave na zona, antes de `antesDe` (chave) ou no fim. */
export function moverCampo(familia: string, e: EstruturaLayout, chave: string, zona: ZonaDoLayout, antesDe?: string): ResultadoOperacao {
  const coluna = ehChaveDeColuna(chave);
  const campo = campoDaChave(chave);
  const cat = catalogoDaFamilia(familia);
  const doCatalogo = cat.find((c) => c.chave === campo && (coluna ? c.parte === "itens" : c.parte !== "itens"));
  if (!doCatalogo) return recusa(MSG_DESCONHECIDO);
  // A mesma chave pode existir como campo do documento e como coluna (ex.: "discount"): o TIPO da chave decide antes.
  if (coluna && zona.tipo !== "itens") return recusa(MSG_COLUNA_SO_ITENS);
  if (!coluna && zona.tipo === "itens") return recusa(MSG_SO_ITENS);
  const motivo = motivoZonaProibida(familia, campo, zona);
  if (motivo !== null) return recusa(motivo);
  if (antesDe !== undefined && antesDe === chave) return ok(clonar(e));

  const n = clonar(e);
  if (zona.tipo === "aba" && !n.rodape[zona.indice]) return recusa(MSG_ABA_INEXISTENTE);

  if (coluna) {
    const i = n.itens.findIndex((c) => c.campo === campo);
    const col: ColunaDoLayout = i >= 0 ? n.itens.splice(i, 1)[0]! : { campo, obrigatorio: Boolean(doCatalogo.sistema) };
    n.itens.splice(posicaoDeInsercao(n.itens, zona, antesDe), 0, col);
    return ok(n);
  }

  if (ehCabecalho(zona)) materializarGrupos(n);
  const tirado = tirarDoDocumento(n, campo);
  const item: CampoDoLayout = tirado ?? { campo, obrigatorio: Boolean(doCatalogo.sistema), editavel: true };
  if (ehCabecalho(zona)) item.grupo = zona.tipo as "principal" | "adicionais";
  else delete item.grupo;
  const lista = listaDaZona(n, zona) as CampoDoLayout[];
  lista.splice(posicaoDeInsercao(lista, zona, antesDe), 0, item);
  return ok(n);
}

/** Tira a chave do layout (recusa obrigatório do sistema). */
export function removerCampo(familia: string, e: EstruturaLayout, chave: string): ResultadoOperacao {
  const coluna = ehChaveDeColuna(chave);
  const campo = campoDaChave(chave);
  if (ondeEsta(e, chave) === null) return recusa(MSG_FORA);
  const doCatalogo = catalogoDaFamilia(familia).find((c) => c.chave === campo && (coluna ? c.parte === "itens" : c.parte !== "itens"));
  if (doCatalogo?.sistema) return recusa(MENSAGEM_OBRIGATORIO_NAO_SAI);
  const n = clonar(e);
  if (coluna) n.itens = n.itens.filter((c) => c.campo !== campo);
  else {
    // Se o cabeçalho ainda segue a regra antiga, materializa antes: tirar um campo não pode trocar o grupo dos outros.
    if (n.cabecalho.some((c) => c.campo === campo)) materializarGrupos(n);
    tirarDoDocumento(n, campo);
  }
  return ok(n);
}

/** Sobe (-1) ou desce (+1) dentro da zona. */
export function deslocarCampo(e: EstruturaLayout, chave: string, delta: -1 | 1): ResultadoOperacao {
  const zona = ondeEsta(e, chave);
  if (zona === null) return recusa(MSG_FORA);
  const n = clonar(e);
  const campo = campoDaChave(chave);
  if (ehCabecalho(zona)) materializarGrupos(n);
  const lista = listaDaZona(n, zona)!;
  const idx = lista.findIndex((c) => c.campo === campo);
  // vizinho na MESMA zona (no cabeçalho, o do mesmo grupo)
  let alvo = idx + delta;
  while (alvo >= 0 && alvo < lista.length && ehCabecalho(zona) && ((lista[alvo] as CampoDoLayout).grupo ?? "principal") !== zona.tipo) alvo += delta;
  if (alvo < 0 || alvo >= lista.length) return ok(n);
  const [x] = lista.splice(idx, 1);
  lista.splice(alvo, 0, x!);
  return ok(n);
}

const normalizarNome = (s: string) => s.trim();
const nomeRepetido = (e: EstruturaLayout, nome: string, ignorar?: number) =>
  e.rodape.some((a, i) => i !== ignorar && a.aba.trim().toLocaleLowerCase("pt-BR") === nome.toLocaleLowerCase("pt-BR"));

/** Abas: criar (nome único), renomear (nome não vazio e único), mover (-1/+1), remover (só vazia). */
export function adicionarAba(e: EstruturaLayout, nome?: string): ResultadoOperacao {
  let final: string;
  if (nome !== undefined) {
    final = normalizarNome(nome);
    if (!final) return recusa(MSG_ABA_NOME_VAZIO);
    if (nomeRepetido(e, final)) return recusa(MSG_ABA_NOME_REPETIDO);
  } else {
    let k = e.rodape.length + 1;
    while (nomeRepetido(e, `Aba ${k}`)) k++;
    final = `Aba ${k}`;
  }
  const n = clonar(e);
  n.rodape.push({ aba: final, campos: [] });
  return ok(n);
}

export function renomearAba(e: EstruturaLayout, indice: number, nome: string): ResultadoOperacao {
  if (!e.rodape[indice]) return recusa(MSG_ABA_INEXISTENTE);
  const final = normalizarNome(nome);
  if (!final) return recusa(MSG_ABA_NOME_VAZIO);
  if (nomeRepetido(e, final, indice)) return recusa(MSG_ABA_NOME_REPETIDO);
  const n = clonar(e);
  n.rodape[indice]!.aba = final;
  return ok(n);
}

export function deslocarAba(e: EstruturaLayout, indice: number, delta: -1 | 1): ResultadoOperacao {
  if (!e.rodape[indice]) return recusa(MSG_ABA_INEXISTENTE);
  const n = clonar(e);
  const alvo = indice + delta;
  if (alvo < 0 || alvo >= n.rodape.length) return ok(n);
  const [a] = n.rodape.splice(indice, 1);
  n.rodape.splice(alvo, 0, a!);
  return ok(n);
}

export function removerAba(e: EstruturaLayout, indice: number): ResultadoOperacao {
  const aba = e.rodape[indice];
  if (!aba) return recusa(MSG_ABA_INEXISTENTE);
  if (aba.campos.length > 0) return recusa(MSG_ABA_NAO_VAZIA);
  const n = clonar(e);
  n.rodape.splice(indice, 1);
  return ok(n);
}

/**
 * Troca a configuração de um campo/coluna (Configurar campo). `campo` e `grupo` não mudam por aqui (identidade e zona
 * são das operações de mover): o que vier neles é ignorado e o do layout permanece.
 */
export function substituirCampo(e: EstruturaLayout, chave: string, novo: Record<string, unknown>): ResultadoOperacao {
  const zona = ondeEsta(e, chave);
  if (zona === null) return recusa(MSG_FORA);
  const n = clonar(e);
  const campo = campoDaChave(chave);
  const lista = listaDaZona(n, zona)!;
  const i = lista.findIndex((c) => c.campo === campo);
  const atual = lista[i]!;
  const { campo: _c, grupo: _g, ...resto } = novo;
  const substituto = { ...resto, campo, ...("grupo" in atual && atual.grupo !== undefined ? { grupo: atual.grupo } : {}) };
  lista[i] = substituto as CampoDoLayout | ColunaDoLayout;
  return ok(n);
}
