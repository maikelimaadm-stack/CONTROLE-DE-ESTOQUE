"use client";
import { useQuery } from "@tanstack/react-query";
import { D } from "@agro/shared";
import { api } from "@/lib/api";
import { cn, num } from "@/lib/utils";
import { StockCell } from "@/features/docs/shared";

/**
 * A RESERVA DE ESTOQUE COMO A TELA A LÊ (TOP-CONFIG-07).
 *
 * O servidor devolve `reservado` e `disponivel` (strings decimais) no saldo por armazém e produto. A leitura aqui é
 * DEFENSIVA, pela régua do rolling deploy: a web nova conversa por alguns minutos com a API anterior, que não manda
 * esses campos. Campo ausente, ou que não é um decimal na forma da API, é "recurso desligado" — a tela fica exatamente
 * a de antes, e nenhum número é inventado a partir do que não chegou.
 *
 * Quem calcula o reservado e o disponível é o banco (uma função só para API, gatilho e telas). Nada aqui soma nem
 * subtrai: a tela só formata e destaca.
 */

/** Decimal na forma que a API serializa (`"12.5000"`, `"-3.0000"`). Qualquer outra coisa = ausente. */
export const ehDecimalDaApi = (v: unknown): v is string => typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v);

/** Disponível abaixo de zero: o físico do armazém é menor do que o reservado para pedidos (acerto de inventário). */
export const disponivelNegativo = (v: string): boolean => D(v).lt(0);

/** Explicação do destaque, para `title` e leitor de tela — a cor sozinha não diz nada a quem não a vê. */
export const EXPLICACAO_DISPONIVEL_NEGATIVO = "Disponível negativo: o estoque físico do armazém é menor do que o reservado para pedidos.";

export interface SaldoComReserva { fisico: string; reservado: string; disponivel: string }

/**
 * O saldo de `GET /stock/balances/:armazem/:produto` com a reserva, ou `null` quando a resposta não a traz (API
 * anterior). `quantity` continua sendo o FÍSICO do armazém; os três têm de ser decimais válidos para valer.
 */
export function lerSaldoComReserva(bruto: unknown): SaldoComReserva | null {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return null;
  const r = bruto as Record<string, unknown>;
  const { quantity, reservado, disponivel } = r;
  if (!ehDecimalDaApi(quantity) || !ehDecimalDaApi(reservado) || !ehDecimalDaApi(disponivel)) return null;
  return { fisico: quantity, reservado, disponivel };
}

/**
 * A CÉLULA "ESTOQUE" DA CENTRAL QUANDO A OPERAÇÃO RESERVA: o DISPONÍVEL do armazém (físico − reservado), com o físico
 * e o reservado na dica. Mesma pergunta e MESMA chave de cache de `StockCell` (`["bal", armazém, produto]`): nenhuma
 * requisição a mais. Sem a reserva na resposta (API anterior), é a `StockCell` de sempre, só de exibição.
 *
 * `StockCell` NÃO muda: ela é compartilhada por outras telas (documentos de estoque, consulta), e mudar o que ela
 * mostra mudaria todas elas.
 */
export function EstoqueDisponivelDoItem({ warehouseId, productId }: { warehouseId?: string; productId?: string }) {
  const q = useQuery({
    queryKey: ["bal", warehouseId, productId],
    queryFn: () => api<unknown>(`/api/stock/balances/${warehouseId}/${productId}`),
    enabled: Boolean(warehouseId && productId)
  });
  const saldo = lerSaldoComReserva(q.data);
  if (!saldo) return <StockCell warehouseId={warehouseId} productId={productId} onCost={() => { /* só exibe: quem preenche o custo médio é a célula oculta da Central */ }} />;
  const negativo = disponivelNegativo(saldo.disponivel);
  // A dica é SEMPRE "Físico · Reservado" (a conta que explica o número); o destaque do negativo ganha a sua frase
  // em texto para leitor de tela, fora do número.
  return <>
    <span data-testid="central-estoque-disponivel" data-negativo={negativo ? "1" : undefined}
      title={`Físico ${num(saldo.fisico, 4)} · Reservado ${num(saldo.reservado, 4)}`}
      className={cn(negativo && "font-semibold text-red-600")}>
      {num(saldo.disponivel, 4)}
    </span>
    {negativo && <span className="sr-only"> ({EXPLICACAO_DISPONIVEL_NEGATIVO})</span>}
  </>;
}
