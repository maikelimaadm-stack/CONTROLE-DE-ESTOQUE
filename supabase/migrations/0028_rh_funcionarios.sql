-- =====================================================================
-- 0028 RH: FUNCIONÁRIOS (CADASTROS Fase 5)
--
-- O funcionário é um PARCEIRO (erp.people, tipo Funcionário) com a ficha de RH em erp.employee_profiles
-- (1:1, chave person_id). A ficha de RH usa o mecanismo genérico de abas da Fase 4 (decisão 253). Esta
-- migration dá lugar ao que a ficha nova grava:
--   · erp.employee_profiles ganha organization_id (preenchido a partir do parceiro; FK COMPOSTA
--     (person_id, organization_id) → people), matrícula, empresa de lotação (FK COMPOSTA
--     (organization_id, empresa_id) → empresas), tipo de vínculo, trabalhador rural, jornada semanal,
--     documentos (PIS/NIS, CTPS, RG, CNH), conta de pagamento (conta ADICIONAL do próprio parceiro; vazio =
--     conta principal) e motivo do desligamento;
--   · matrícula ÚNICA entre funcionários VIVOS da organização (parceiro não excluído) — trigger no banco;
--   · erp.job_functions.cbo_code passa a apontar para a CBO oficial (erp.cbo_ocupacoes, 0026) — FK
--     NOT VALID: o acervo com CBO livre continua como está e só a gravação NOVA do código é conferida;
--   · AUDITORIA COM SIGILO (R1-2): a ficha de RH e a Função passam a ser auditadas (erp.audit_logs). Campo de
--     SALÁRIO (salário base, valor hora, meta, comissão; na Função, salário base e valor hora) fica registrado —
--     quem, quando, QUAL campo — SEM o valor: sai de before/after e o nome vai em metadata.sigilo.
--
-- JANELA DE DEPLOY: tudo é aditivo e anulável (ou com default). organization_id é preenchido por trigger
-- quando quem insere não o informa (a API anterior e o seed não o conhecem). A folha continua lendo
-- employee_profiles exatamente como antes.
--
-- NATUREZA: aditiva. Um único UPDATE (preencher organization_id a partir do parceiro, condição de NOT NULL);
-- nenhum DELETE, nenhuma coluna, índice ou tabela removida.
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 62) then
    raise exception 'CADASTROS-F5: outra transacao ja detem a trava desta migration (2026,62). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare orfaos bigint;
begin
  if to_regclass('erp.employee_profiles') is null or to_regclass('erp.job_functions') is null or to_regclass('erp.empresas') is null then
    raise exception 'CADASTROS-F5: erp.employee_profiles, erp.job_functions ou erp.empresas nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regclass('erp.parceiro_contas') is null or not exists (select 1 from pg_constraint where conname = 'uq_people_tenant') then
    raise exception 'CADASTROS-F5: a 0027 nao esta aplicada; aplique a 0027 antes.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'employee_profiles' and column_name = 'matricula') then
    raise exception 'CADASTROS-F5: estrutura desta migration ja existe; ela nao e reaplicavel.';
  end if;
  select count(*) into orfaos from erp.employee_profiles e where not exists (select 1 from erp.people p where p.id = e.person_id);
  if orfaos > 0 then
    raise exception 'CADASTROS-F5: % ficha(s) de RH sem parceiro. Nada foi aplicado.', orfaos;
  end if;
end $$;

create temporary table _f5_antes on commit drop as
  select (select count(*) from erp.employee_profiles) as fichas, (select count(*) from erp.job_functions) as funcoes,
         (select count(*) from erp.people) as people;

-- ---------- 3) tenant na ficha de RH ----------
alter table erp.employee_profiles add column organization_id uuid;
update erp.employee_profiles e set organization_id = p.organization_id from erp.people p where p.id = e.person_id and e.organization_id is null;
alter table erp.employee_profiles alter column organization_id set not null;
alter table erp.employee_profiles add constraint fk_employee_profiles_parceiro
  foreign key (person_id, organization_id) references erp.people (id, organization_id);
comment on column erp.employee_profiles.organization_id is 'Organização do parceiro (preenchida pelo trigger a partir de erp.people quando não informada). FK composta com o parceiro.';

create or replace function erp.employee_profiles_organizacao() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  if new.organization_id is null then
    select p.organization_id into new.organization_id from erp.people p where p.id = new.person_id;
  end if;
  return new;
end $$;
create trigger trg_employee_profiles_organizacao before insert or update of person_id, organization_id on erp.employee_profiles
  for each row execute function erp.employee_profiles_organizacao();

-- ---------- 4) colunas da ficha de RH ----------
alter table erp.employee_profiles
  add column matricula text check (matricula is null or btrim(matricula) <> ''),
  add column empresa_id uuid,
  add column tipo_vinculo text check (tipo_vinculo in ('clt_indeterminado','clt_determinado','temporario','aprendiz','estagio','autonomo')),
  add column trabalhador_rural boolean not null default false,
  add column jornada_semanal numeric(5,2) check (jornada_semanal > 0 and jornada_semanal <= 168),
  add column pis_nis text check (pis_nis ~ '^[0-9]{11}$'),
  add column ctps_numero text,
  add column ctps_serie text,
  add column rg_numero text,
  add column rg_orgao text,
  add column cnh_numero text check (cnh_numero ~ '^[0-9]{11}$'),
  add column cnh_categoria text check (cnh_categoria in ('A','B','C','D','E','AB','AC','AD','AE')),
  add column cnh_validade date,
  add column conta_pagamento_id uuid,
  add column motivo_desligamento text check (motivo_desligamento in ('pedido_demissao','sem_justa_causa','com_justa_causa','termino_contrato','acordo','outro'));

alter table erp.employee_profiles add constraint fk_employee_profiles_empresa
  foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id);
-- conta de pagamento: SÓ uma conta adicional do PRÓPRIO parceiro (FK composta com person_id)
alter table erp.parceiro_contas add constraint uq_parceiro_contas_parceiro unique (id, person_id);
alter table erp.employee_profiles add constraint fk_employee_profiles_conta
  foreign key (conta_pagamento_id, person_id) references erp.parceiro_contas (id, person_id);

comment on column erp.employee_profiles.matricula is 'Matrícula do funcionário. Única entre funcionários vivos (parceiro não excluído) da organização — trigger trg_employee_profiles_matricula.';
comment on column erp.employee_profiles.empresa_id is 'Empresa de lotação. FK composta com a organização.';
comment on column erp.employee_profiles.tipo_vinculo is 'Vínculo: CLT prazo indeterminado, CLT prazo determinado/safra, temporário, aprendiz, estágio, autônomo/diarista.';
comment on column erp.employee_profiles.trabalhador_rural is 'Trabalhador rural (eSocial: categoria/natureza da atividade rural).';
comment on column erp.employee_profiles.jornada_semanal is 'Jornada semanal contratual, em horas.';
comment on column erp.employee_profiles.pis_nis is 'PIS/PASEP/NIS (11 dígitos).';
comment on column erp.employee_profiles.cnh_numero is 'Número de registro da CNH (11 dígitos).';
comment on column erp.employee_profiles.conta_pagamento_id is 'Conta de pagamento: conta ADICIONAL do próprio parceiro (erp.parceiro_contas). Vazio = conta principal do parceiro.';
comment on column erp.employee_profiles.motivo_desligamento is 'Motivo do desligamento: pedido de demissão, sem justa causa, com justa causa, término de contrato, acordo, outro.';
comment on column erp.employee_profiles.base_salary is 'Salário base. SIGILOSO: a API só o devolve a quem tem employees.edit; a auditoria registra que mudou, sem o valor.';
comment on column erp.employee_profiles.hour_value is 'Valor da hora. SIGILOSO: a API só o devolve a quem tem employees.edit; a auditoria registra que mudou, sem o valor.';
comment on column erp.employee_profiles.goal_salary is 'Meta. SIGILOSA (dado de salário): a API só a devolve a quem tem employees.edit; a auditoria registra que mudou, sem o valor.';
comment on column erp.employee_profiles.commission_percent is 'Comissão (%). SIGILOSA (dado de salário): a API só a devolve a quem tem employees.edit; a auditoria registra que mudou, sem o valor.';
comment on column erp.job_functions.base_salary is 'Salário base da função (vale para quem não tem salário próprio). SIGILOSO: a API só o devolve a quem tem employees.edit; a auditoria registra que mudou, sem o valor.';
comment on column erp.job_functions.hour_value is 'Valor da hora da função. SIGILOSO: a API só o devolve a quem tem employees.edit; a auditoria registra que mudou, sem o valor.';

create index ix_employee_profiles_matricula on erp.employee_profiles (organization_id, matricula) where matricula is not null;

-- ---------- 5) matrícula única entre VIVOS ----------
-- "Vivo" depende de erp.people.deleted_at (outra tabela): um índice parcial não alcança. O trigger serializa
-- por (organização, matrícula) com trava transacional e recusa a repetida com 23505, como um índice único.
create or replace function erp.employee_profiles_matricula_unica() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  if new.matricula is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('erp.employee_profiles.matricula'), hashtext(new.organization_id::text || '/' || new.matricula));
  if exists (select 1 from erp.employee_profiles e join erp.people p on p.id = e.person_id
              where e.organization_id = new.organization_id and e.matricula = new.matricula
                and e.person_id <> new.person_id and p.deleted_at is null) then
    raise exception 'matricula % ja usada por outro funcionario', new.matricula
      using errcode = '23505', constraint = 'ux_employee_profiles_matricula';
  end if;
  return new;
end $$;
create trigger trg_employee_profiles_matricula before insert or update of matricula, organization_id on erp.employee_profiles
  for each row execute function erp.employee_profiles_matricula_unica();

-- ---------- 6) CBO oficial na função ----------
alter table erp.job_functions add constraint fk_job_functions_cbo
  foreign key (cbo_code) references erp.cbo_ocupacoes (codigo) not valid;
comment on column erp.job_functions.cbo_code is 'CBO da função (erp.cbo_ocupacoes). FK NOT VALID: o acervo anterior não é reconferido; gravação nova do código é.';

-- ---------- 7) auditoria com SIGILO (R1-2) ----------
-- Gatilho de auditoria para tabela com dado de salário. Argumentos: 1º = coluna que identifica a linha
-- (entity_id: `id` na Função, `person_id` na ficha de RH, que não tem id próprio); os demais = colunas SIGILOSAS.
-- A coluna sigilosa SAI de before/after (o valor nunca chega à trilha, nem para quem tem audit_logs.view) e o
-- NOME de cada uma que mudou vai em metadata.sigilo — quem, quando e qual campo continuam registrados.
-- SECURITY INVOKER (padrão): o insert na trilha passa pela RLS de erp.audit_logs como qualquer gravação da API.
create or replace function erp.audit_row_sigilo() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
declare
  v_antes jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_linha jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  v_sigilo text[] := case when tg_nargs > 1 then tg_argv[1:tg_nargs - 1] else '{}'::text[] end;
  v_mudou text[] := '{}'::text[];
  c text;
begin
  foreach c in array v_sigilo loop
    if coalesce(v_antes -> c, 'null'::jsonb) is distinct from coalesce(v_depois -> c, 'null'::jsonb) then
      v_mudou := v_mudou || c;
    end if;
  end loop;
  insert into erp.audit_logs (organization_id, user_id, entity, entity_id, action, before, after, metadata)
  values (coalesce((v_linha ->> 'organization_id')::uuid, erp.current_org_id()), erp.current_user_id(), tg_table_name,
          v_linha ->> tg_argv[0],
          case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
          v_antes - v_sigilo, v_depois - v_sigilo,
          case when cardinality(v_mudou) > 0 then jsonb_build_object('sigilo', to_jsonb(v_mudou)) end);
  return null;
end $$;
revoke all on function erp.audit_row_sigilo() from public;
grant execute on function erp.audit_row_sigilo() to erp_app;
comment on function erp.audit_row_sigilo() is 'Auditoria de tabela com dado de salário (R1-2): colunas sigilosas (argumentos 2..n) ficam fora de before/after; o nome das que mudaram vai em metadata.sigilo. 1º argumento = coluna do entity_id.';

create trigger trg_employee_profiles_audit after insert or update or delete on erp.employee_profiles
  for each row execute function erp.audit_row_sigilo('person_id', 'base_salary', 'hour_value', 'goal_salary', 'commission_percent');
create trigger trg_job_functions_audit after insert or update or delete on erp.job_functions
  for each row execute function erp.audit_row_sigilo('id', 'base_salary', 'hour_value');

-- ---------- 8) pós-condições ----------
do $$
declare a record;
begin
  select * into a from _f5_antes;
  if (select count(*) from erp.employee_profiles) <> a.fichas or (select count(*) from erp.job_functions) <> a.funcoes
     or (select count(*) from erp.people) <> a.people then
    raise exception 'CADASTROS-F5: contagem mudou; a migration deveria ser aditiva.';
  end if;
  if exists (select 1 from erp.employee_profiles e join erp.people p on p.id = e.person_id where e.organization_id is distinct from p.organization_id) then
    raise exception 'CADASTROS-F5: organization_id da ficha de RH diverge do parceiro.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_employee_profiles_matricula') then
    raise exception 'CADASTROS-F5: trigger de matricula ausente.';
  end if;
  if (select count(*) from pg_trigger where tgname in ('trg_employee_profiles_audit', 'trg_job_functions_audit') and not tgisinternal) <> 2 then
    raise exception 'CADASTROS-F5: auditoria com sigilo (ficha de RH e Funcao) ausente.';
  end if;
end $$;
