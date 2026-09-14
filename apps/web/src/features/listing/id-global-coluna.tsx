"use client";
import * as React from "react";
import { formatarIdGlobal } from "@erp/plataforma";
import type { Base1Column, Row } from "@/features/base1/types";
import type { Column } from "@/components/ui/data-table";

/**
 * ID GLOBAL NA LISTAGEM (PRE-BASE2-05B.1; apresentação revista na PRE-BASE2-05B.2) — a coluna, num lugar só.
 *
 * O número já existia: no banco, na tela de detalhe e na busca. O que faltava era o caminho de ida — ver o
 * número ANTES de precisar dele. Sem isso o ID Global só servia a quem já o conhecesse, que é o contrário de
 * um localizador.
 *
 * O QUE ESTA COLUNA É, E O QUE ELA NÃO É
 * --------------------------------------
 *  • É EXIBIÇÃO do que o servidor mandou em `id_global`. O cliente não consulta o índice, não numera nada e
 *    não deriva o número de coisa alguma — se a linha veio sem número, a coluna mostra a ausência.
 *  • NÃO é o `código` do documento. Código é sequência POR ENTIDADE (duas entradas diferentes podem ser
 *    ambas "1"); o ID Global é único na ORGANIZAÇÃO inteira. Por isso as duas colunas convivem: trocar uma
 *    pela outra perderia informação em qualquer dos sentidos.
 *  • NÃO é endereço. A linha continua abrindo pela rota canônica com o UUID; o número nunca vira URL.
 *  • NÃO é ordenável nem filtrável AQUI: `id_global` não é coluna das tabelas de negócio (mora em
 *    `erp.registros_globais`), então prometer ordenação seria prometer o que o backend não faz. Quem procura
 *    por número usa a busca global, que resolve o número na porta certa, com a autorização daquele registro.
 *
 * APRESENTAÇÃO — NÚMERO PURO, COLUNA SOLTA (PRE-BASE2-05B.2)
 * ---------------------------------------------------------
 * A célula mostra `54`, não `#54`, e a coluna NÃO é presa à esquerda por decisão desta coluna. As duas coisas
 * eram ruído sobre a mesma informação: o cabeçalho já diz "ID Global", então o `#` repetia em cada linha o
 * que a coluna inteira declara; e a pinagem tirava do usuário uma decisão que nenhuma outra coluna toma por
 * ele, ocupando largura fixa na única faixa da grade que nunca rola.
 *
 * Isso é política de INTERFACE, não contrato de identidade: o papel do número (localizador humano, por
 * organização, que não endereça e não autoriza) está intocado. A leitura antiga continua funcionando — a
 * busca global aceita `54`, `#54` e `ID 54`.
 *
 * AUSÊNCIA É INFORMAÇÃO, NÃO ERRO
 * -------------------------------
 * `null` aparece em dois casos legítimos: acervo anterior ao backfill e EFEITO INTERNO declarado (uma
 * transferência de rebanho não é lançamento com identidade própria). Inventar um número para preencher a
 * célula criaria identidade onde o contrato diz que não há — por isso a célula mostra um traço discreto.
 */
export const CHAVE_COLUNA_ID_GLOBAL = "id_global";
export const ROTULO_COLUNA_ID_GLOBAL = "ID Global";
/** Largura fixa: até 7 dígitos em fonte tabular, sem empurrar as colunas de negócio. */
const LARGURA = 96;

/** O número como TEXTO (célula de tooltip, cards, exportação CSV). Vazio quando não há número. */
export const textoIdGlobal = (valor: unknown): string => (typeof valor === "number" && Number.isFinite(valor) ? formatarIdGlobal(valor) : "");

/**
 * A AUSÊNCIA TAMBÉM É UMA CÉLULA DE IDENTIDADE — e por isso carrega o mesmo marcador.
 *
 * Quando só o caso com número era identificável, um teste que percorresse "as células de ID Global" de uma
 * tela cujas linhas fossem TODAS sem número percorria uma lista vazia e passava. A prova virava decoração
 * exatamente na situação que mais interessa (acervo anterior ao backfill). Com o marcador nos dois casos, dá
 * para comparar a quantidade de células com a quantidade de linhas, que é a pergunta real.
 */
export const SEM_ID_GLOBAL = "–";

export function IdGlobalCell({ valor, rotulo }: { valor: unknown; rotulo?: string }) {
  const texto = textoIdGlobal(valor);
  if (!texto) return <span className="text-slate-400" data-testid="id-global-celula" title="Registro sem ID Global">{SEM_ID_GLOBAL}</span>;
  // Sem texto auxiliar de leitor de tela aqui: o CABEÇALHO da coluna já diz "ID Global", e repeti-lo em cada
  // linha faria a tabela ser lida como "Identificador global #1, Identificador global #2…" a cada célula.
  return <span className="id-global" data-testid="id-global-celula" title={`${rotulo ?? "Registro"} · identificador único desta organização`}>{texto}</span>;
}

/**
 * Coluna do MODELO BASE1 (listagens genéricas e de lançamentos).
 *
 * As capacidades são declaradas NEGATIVAMENTE e de propósito: esta coluna é a identidade do registro e vive
 * fora de `prefs.columns`. Sem a declaração, a grade ofereceria "Ocultar", "Auto ajustar", "Congelar" e a
 * alça de arraste — controles que a listagem depois ignoraria, deixando o usuário sem saber se o sistema
 * falhou ou se ele errou. `sortable: false` segue a mesma lógica: `id_global` mora em `erp.registros_globais`,
 * e prometer ordenação seria prometer o que a consulta não faz.
 *
 * O que NÃO está mais aqui é `pinned: "left"` (PRE-BASE2-05B.2). A coluna continua sendo a primeira da grade
 * — quem a põe na frente é quem monta a lista de colunas —, mas rola junto com as demais. A distinção
 * importa: "o usuário não mexe nesta coluna" (capacidades) e "esta coluna está grudada na borda" (pinagem)
 * eram tratadas como a mesma decisão, e só a primeira é consequência de ser identidade.
 *
 * A pinagem genérica NÃO foi removida da grade: `Base1Column.pinned` e o piso de congelamento continuam de
 * pé para a coluna que precisar deles. O que mudou é que a identidade deixou de ser essa coluna.
 */
export const colunaIdGlobalBase1 = (rotulo?: string): Base1Column => ({
  key: CHAVE_COLUNA_ID_GLOBAL, label: ROTULO_COLUNA_ID_GLOBAL, width: LARGURA,
  sortable: false, hideable: false, resizable: false, freezable: false, autoFit: false, filterable: false,
  render: (r: Row) => <IdGlobalCell valor={r[CHAVE_COLUNA_ID_GLOBAL]} rotulo={rotulo} />,
  text: (r: Row) => textoIdGlobal(r[CHAVE_COLUNA_ID_GLOBAL])
});

/**
 * Mesma coluna para as listagens que montam a grade por conta própria (DataTable). As quatro que existem
 * hoje — títulos financeiros, animais, importações OFX e perfis de acesso — não passam pelo Base1List, e por
 * isso a recebem aqui explicitamente; `apps/web/e2e/id-global-listagem.spec.ts` prova cada uma delas.
 */
export const colunaIdGlobalTabela = <T extends Record<string, unknown>>(rotulo?: string): Column<T> => ({
  key: CHAVE_COLUNA_ID_GLOBAL, label: ROTULO_COLUNA_ID_GLOBAL, sortable: false, width: LARGURA,
  hideable: false, resizable: false, freezable: false, autoFit: false, filterable: false,
  render: (r: T) => <IdGlobalCell valor={r[CHAVE_COLUNA_ID_GLOBAL]} rotulo={rotulo} />
});
