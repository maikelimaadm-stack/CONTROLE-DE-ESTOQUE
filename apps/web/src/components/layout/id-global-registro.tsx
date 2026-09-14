"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { formatarIdGlobal } from "@erp/plataforma";
import { useIdGlobalDoRegistro } from "@/lib/id-global";
import { entidadeDaRota } from "@/lib/id-global-rota";

/**
 * IDENTIDADE DO REGISTRO ABERTO — o `#N` que o usuário lê, fala ao telefone e procura na busca.
 *
 * Regras de comportamento, todas por um motivo:
 *  - carrega pela API (o índice é do servidor; o cliente nunca lê `erp.registros_globais`);
 *  - registro sem número ainda (acervo histórico durante o backfill) ou fora da permissão → NÃO RENDERIZA.
 *    404 aqui é estado normal, não erro: a tela do registro continua inteira;
 *  - reserva o espaço enquanto carrega, para o `#N` não empurrar a trilha quando chegar;
 *  - é só leitura: não edita, não navega, não muda regra de negócio.
 *
 * PRE-BASE2-04 não desenha a moldura do Base2. Esta é a superfície mínima e central: um badge ao lado da
 * trilha, que aparece em TODA rota canônica do catálogo porque deriva do próprio catálogo.
 */
export function IdGlobalRegistro({ tipo, id }: { tipo: string; id: string }) {
  const { data, isLoading } = useIdGlobalDoRegistro(tipo, id);
  if (isLoading) return <span className="id-global id-global--carregando" aria-hidden />;
  if (!data) return null;
  return (
    <span className="id-global" data-testid="id-global-registro" data-tipo={data.tipoEntidade}
      title={`${data.rotulo} · identificador único desta organização`}>
      <span className="sr-only">Identificador global: </span>{formatarIdGlobal(data.idGlobal)}
    </span>
  );
}

/** Detecta sozinho, pela rota aberta, se há um registro elegível na tela — e exibe o `#N` dele. */
export function IdGlobalDaRotaAtual() {
  const pathname = usePathname();
  const alvo = React.useMemo(() => entidadeDaRota(pathname), [pathname]);
  if (!alvo) return null;
  return <IdGlobalRegistro tipo={alvo.tipo} id={alvo.id} />;
}
