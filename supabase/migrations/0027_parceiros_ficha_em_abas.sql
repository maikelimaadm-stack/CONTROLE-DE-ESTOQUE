-- =====================================================================
-- 0027 PARCEIROS: FICHA EM ABAS (CADASTROS Fase 4, decisão 253)
--
-- O cadastro de Pessoas vira a ficha de PARCEIRO em abas. A tabela continua erp.people (tabela, colunas,
-- permissões e rotas ficam). Esta migration dá lugar aos dados que a ficha nova grava:
--   · colunas novas em erp.people: complemento, nascimento_abertura, indicador_ie, consumidor_final,
--     produtor_rural, regime_tributario, cnae_principal, situacao_receita, situacao_receita_consultada_em;
--   · erp.client_profiles.limite_credito (INFORMATIVO: nenhuma trava de venda nesta fase);
--   · tabelas 1:N novas: erp.parceiro_enderecos, erp.parceiro_contatos, erp.parceiro_contas — com
--     organization_id, FK COMPOSTA (person_id, organization_id) → people, índice por parceiro e deleted_at;
--   · índice ÚNICO do documento NORMALIZADO entre vivos da organização (expressão), com o MESMO filtro da
--     pré-condição (normalizado não vazio: documento só de pontuação fica fora). Pré-condição: nenhum
--     duplicado no acervo; havendo, a migration PARA nomeando os códigos — ninguém escolhe qual apagar.
--
-- JANELA DE DEPLOY: tudo é aditivo e anulável (ou com default). A API anterior continua gravando people sem
-- as colunas novas; a web anterior continua funcionando contra a API nova (detalhe ausente = não mexe).
--
-- NATUREZA: aditiva. Nenhum UPDATE, nenhum DELETE, nenhuma coluna ou índice antigo removido (o
-- ux_people_document continua; o índice novo é mais estrito e convive com ele).
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 61) then
    raise exception 'CADASTROS-F4: outra transacao ja detem a trava desta migration (2026,61). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare dup text;
begin
  if to_regclass('erp.people') is null or to_regclass('erp.client_profiles') is null then
    raise exception 'CADASTROS-F4: erp.people ou erp.client_profiles nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regclass('erp.cbo_ocupacoes') is null then
    raise exception 'CADASTROS-F4: a 0026 nao esta aplicada; aplique a 0026 antes.';
  end if;
  -- documento duplicado entre vivos (depois de normalizar): a migration PARA e nomeia os códigos.
  select string_agg(codigos, ' | ') into dup from (
    select string_agg(code, ',' order by code) as codigos
      from erp.people
     where document is not null and deleted_at is null
       and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) <> ''
     group by organization_id, upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g'))
    having count(*) > 1) d;
  if dup is not null then
    raise exception 'CADASTROS-F4: documento duplicado entre parceiros vivos (codigos: %). Resolva antes de aplicar; nada foi aplicado.', dup;
  end if;
end $$;

create temporary table _f4_antes on commit drop as
  select (select count(*) from erp.people) as people, (select count(*) from erp.client_profiles) as clientes;

-- ---------- 3) chave candidata de tenant ----------
-- Coluna única não prova tenant: as FKs das tabelas novas são COMPOSTAS (person_id, organization_id).
alter table erp.people add constraint uq_people_tenant unique (id, organization_id);

-- ---------- 4) colunas novas ----------
alter table erp.people
  add column complemento text,
  add column nascimento_abertura date,
  add column indicador_ie text check (indicador_ie in ('contribuinte','isento','nao_contribuinte')),
  add column consumidor_final boolean not null default false,
  add column produtor_rural boolean not null default false,
  add column regime_tributario text check (regime_tributario in ('simples','mei','normal')),
  add column cnae_principal text check (cnae_principal ~ '^[0-9]{7}$'),
  add column situacao_receita text,
  add column situacao_receita_consultada_em timestamptz;

comment on column erp.people.document is
  'CPF/CNPJ NORMALIZADO (sem pontuação, maiúsculas): CPF e CNPJ numérico só dígitos; CNPJ ALFANUMÉRICO (IN RFB 2.229/2024) tem letras nas 12 primeiras posições. Estrangeiro: livre. Único entre vivos da organização (ux_people_documento_normalizado).';
comment on column erp.people.complemento is 'Complemento do endereço principal.';
comment on column erp.people.nascimento_abertura is 'Data de nascimento (pessoa física) ou de abertura (pessoa jurídica).';
comment on column erp.people.indicador_ie is 'Indicador de IE do destinatário: contribuinte, isento ou não contribuinte.';
comment on column erp.people.consumidor_final is 'Consumidor final (operação com consumidor final).';
comment on column erp.people.produtor_rural is 'Produtor rural: UM parceiro por CPF; cada propriedade tem a sua IE no endereço adicional.';
comment on column erp.people.regime_tributario is 'Regime tributário: simples, mei ou normal.';
comment on column erp.people.cnae_principal is 'CNAE principal (7 dígitos).';
comment on column erp.people.situacao_receita is 'Situação cadastral na Receita, copiada da última consulta de CNPJ (ex.: ATIVA).';
comment on column erp.people.situacao_receita_consultada_em is 'Data e hora da consulta que trouxe a situação na Receita.';

alter table erp.client_profiles add column limite_credito numeric(18,2) check (limite_credito >= 0);
comment on column erp.client_profiles.limite_credito is 'Limite de crédito INFORMATIVO (nenhuma trava de venda o consulta nesta fase).';

-- ---------- 5) tabelas 1:N ----------
create table erp.parceiro_enderecos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  person_id uuid not null,
  tipo text not null check (tipo in ('entrega','cobranca','propriedade','outro')),
  descricao text,
  cep text check (cep ~ '^[0-9]{8}$'),
  logradouro text, numero text, complemento text, bairro text,
  city_id int references erp.cities(id),
  inscricao_estadual text check (inscricao_estadual ~ '^([0-9]{2,14}|ISENTO)$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint fk_parceiro_enderecos_parceiro foreign key (person_id, organization_id) references erp.people (id, organization_id)
);
create index ix_parceiro_enderecos_parceiro on erp.parceiro_enderecos (organization_id, person_id) where deleted_at is null;
comment on table erp.parceiro_enderecos is 'Endereços ADICIONAIS do parceiro (entrega, cobrança, propriedade, outro). O principal fica nas colunas de erp.people.';
comment on column erp.parceiro_enderecos.inscricao_estadual is 'IE própria do endereço (produtor rural: uma por propriedade). Só formato: dígitos ou ISENTO.';

create table erp.parceiro_contatos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  person_id uuid not null,
  nome text not null,
  funcao text, telefone text, celular text,
  email citext,
  recebe_nfe_email boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint fk_parceiro_contatos_parceiro foreign key (person_id, organization_id) references erp.people (id, organization_id)
);
create index ix_parceiro_contatos_parceiro on erp.parceiro_contatos (organization_id, person_id) where deleted_at is null;
comment on table erp.parceiro_contatos is 'Contatos ADICIONAIS do parceiro. O contato principal continua em erp.people (contact_name, contact_phone).';

create table erp.parceiro_contas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  person_id uuid not null,
  bank_code text references erp.banks(code),
  agencia text, conta text,
  tipo text check (tipo in ('checking','savings')),
  titular text,
  pix_tipo text check (pix_tipo in ('document','phone','email','random')),
  pix_chave text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint fk_parceiro_contas_parceiro foreign key (person_id, organization_id) references erp.people (id, organization_id)
);
create index ix_parceiro_contas_parceiro on erp.parceiro_contas (organization_id, person_id) where deleted_at is null;
comment on table erp.parceiro_contas is 'Contas bancárias ADICIONAIS do parceiro. A principal continua nas colunas de erp.people.';

create trigger trg_parceiro_enderecos_updated before update on erp.parceiro_enderecos for each row execute function erp.set_updated_at();
create trigger trg_parceiro_contatos_updated before update on erp.parceiro_contatos for each row execute function erp.set_updated_at();
create trigger trg_parceiro_contas_updated before update on erp.parceiro_contas for each row execute function erp.set_updated_at();
create trigger trg_parceiro_enderecos_audit after insert or update or delete on erp.parceiro_enderecos for each row execute function erp.audit_row();
create trigger trg_parceiro_contatos_audit after insert or update or delete on erp.parceiro_contatos for each row execute function erp.audit_row();
create trigger trg_parceiro_contas_audit after insert or update or delete on erp.parceiro_contas for each row execute function erp.audit_row();

-- ---------- 6) RLS e grants ----------
-- Tabela criada depois do bloco genérico da 0007 NÃO é alcançada por ele. Política ÚNICA por tabela.
-- O parceiro é cadastro da ORGANIZAÇÃO (sem empresa): o recorte é o tenant.
alter table erp.parceiro_enderecos enable row level security;
alter table erp.parceiro_enderecos force row level security;
create policy tenant_isolation on erp.parceiro_enderecos for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
alter table erp.parceiro_contatos enable row level security;
alter table erp.parceiro_contatos force row level security;
create policy tenant_isolation on erp.parceiro_contatos for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
alter table erp.parceiro_contas enable row level security;
alter table erp.parceiro_contas force row level security;
create policy tenant_isolation on erp.parceiro_contas for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
-- Linha removida da grade é excluída LOGICAMENTE (deleted_at): a API não precisa de DELETE.
grant select, insert, update on erp.parceiro_enderecos, erp.parceiro_contatos, erp.parceiro_contas to erp_app;
revoke delete on erp.parceiro_enderecos, erp.parceiro_contatos, erp.parceiro_contas from erp_app;

-- ---------- 7) documento único entre vivos (normalizado) ----------
-- O filtro é o MESMO da pré-condição (seção 2): documento que fica VAZIO depois de normalizar (só pontuação)
-- não entra no índice. Sem isso, dois parceiros assim no acervo passam pela pré-condição e derrubam o índice.
create unique index ux_people_documento_normalizado on erp.people
  (organization_id, upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')))
  where document is not null and deleted_at is null
    and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) <> '';

-- ---------- 8) pós-condições ----------
do $$
declare a record;
begin
  select * into a from _f4_antes;
  if (select count(*) from erp.people) <> a.people or (select count(*) from erp.client_profiles) <> a.clientes then
    raise exception 'CADASTROS-F4: contagem de people/client_profiles mudou; a migration deveria ser aditiva.';
  end if;
  if to_regclass('erp.ux_people_documento_normalizado') is null or to_regclass('erp.ux_people_document') is null then
    raise exception 'CADASTROS-F4: indice de documento ausente.';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'erp' and c.relname in ('parceiro_enderecos','parceiro_contatos','parceiro_contas')
                and not (c.relrowsecurity and c.relforcerowsecurity)) then
    raise exception 'CADASTROS-F4: tabela nova sem RLS forcada.';
  end if;
end $$;
