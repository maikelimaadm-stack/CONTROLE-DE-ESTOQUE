-- =====================================================================================================
-- PRE-BASE2-04 — ATIVAÇÃO DO ID GLOBAL
--
-- A PRE-BASE2-01 criou o contrato: `erp.sequencias_id_global` (contador por organização),
-- `erp.registros_globais` (índice #N → registro) e `erp.proximo_id_global(org)`. O que faltava era ATIVAR:
-- nenhuma rota chamava a alocação e o acervo histórico não tinha número.
--
-- Esta migration entrega SÓ a infraestrutura de banco que a ativação exige. Ela não percorre o acervo: o
-- backfill de milhões de linhas não pode morar numa transação de DDL, onde ficaria horas segurando lock e,
-- se falhasse no fim, perderia tudo. Ele é um comando operacional, em lotes curtos e retomável
-- (`pnpm id-global:backfill`, docs/GLOBAL-ID-CONTRACT.md).
-- =====================================================================================================

-- ---------- 1) reserva de FAIXA: uma ida ao contador por lote, não uma por registro ----------
--
-- O backfill precisa de N números de uma vez. Chamar `proximo_id_global` N vezes custa N round-trips e N
-- atualizações da mesma linha do contador — em 1 milhão de registros isso é o desenho errado.
--
-- `reservar_ids_globais(org, n)` faz UM update atômico de `+n` e devolve a faixa contínua reservada. A
-- atomicidade é a mesma do contador de sempre: o `update` toma o lock da linha da organização, então duas
-- transações concorrentes recebem faixas DISJUNTAS, nunca sobrepostas. Organizações diferentes tocam linhas
-- diferentes e não se bloqueiam.
--
-- Não é `max(id_global)+1`: esse padrão lê o passado para adivinhar o futuro e, sob concorrência, dois
-- leitores enxergam o mesmo máximo e escolhem o mesmo número. O contador é a autoridade, e ele só sobe.
create or replace function erp.reservar_ids_globais(p_org uuid, p_quantidade integer)
returns table (primeiro bigint, ultimo bigint)
language plpgsql as $$
declare v_fim bigint;
begin
  if p_org is null then raise exception 'organização obrigatória para reservar IDs Globais'; end if;
  if p_quantidade is null or p_quantidade < 1 then
    raise exception 'quantidade de IDs Globais deve ser >= 1 (recebido: %)', p_quantidade;
  end if;
  insert into erp.sequencias_id_global (organization_id, ultimo_valor) values (p_org, p_quantidade)
  on conflict (organization_id) do update set ultimo_valor = erp.sequencias_id_global.ultimo_valor + p_quantidade
  returning ultimo_valor into v_fim;
  primeiro := v_fim - p_quantidade + 1;
  ultimo := v_fim;
  return next;
end $$;
comment on function erp.reservar_ids_globais(uuid, integer) is
  'Reserva uma FAIXA CONTÍNUA de IDs Globais da organização num único update atômico (PRE-BASE2-04). Usada pelo backfill em lote. Concorrentes recebem faixas disjuntas; o contador nunca diminui e nunca é derivado de max().';

-- `proximo_id_global` passa a ser, literalmente, uma reserva de tamanho 1: uma autoridade só, não duas
-- implementações que podem divergir num refactor futuro.
create or replace function erp.proximo_id_global(p_org uuid) returns bigint language sql as $$
  select ultimo from erp.reservar_ids_globais(p_org, 1)
$$;
comment on function erp.proximo_id_global(uuid) is
  'Aloca o próximo ID Global da organização (atômico sob concorrência). Equivale a reservar_ids_globais(org, 1): a autoridade da sequência é uma só. O ID é sempre do banco, nunca do cliente.';

-- ---------- 2) integridade do índice ----------
-- A sequência começa em 1. Um `id_global` <= 0 só pode vir de escrita fora do contrato, e é melhor que o
-- banco recuse do que descobrir depois que `#0` foi exibido a alguém.
alter table erp.registros_globais drop constraint if exists registros_globais_id_positivo;
alter table erp.registros_globais add constraint registros_globais_id_positivo check (id_global > 0);

-- ---------- 3) índice do BACKFILL ----------
-- O backfill pergunta, por entidade: "quais linhas desta tabela ainda não têm índice global?". Isso é um
-- anti-join por (organização, tipo_entidade, id_entidade) — coberto pela unique que já existe — mas ele
-- também varre por (organização, tipo) para contar o que falta. `registros_globais_tipo_idx` já cobre.
-- O que faltava era o caminho do VERIFICADOR, que percorre o índice por tipo e id_entidade juntos:
create index if not exists registros_globais_entidade_idx
  on erp.registros_globais (organization_id, tipo_entidade, id_entidade);

grant execute on function erp.reservar_ids_globais(uuid, integer) to erp_app;
