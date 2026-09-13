-- =====================================================================================================
-- PRE-BASE2-02 — ESCOPO EMPRESARIAL DA NOTIFICAÇÃO E LEITURA POR USUÁRIO
--
-- Até aqui `erp.notifications` tinha organização e, opcionalmente, um destinatário. Não tinha empresa,
-- módulo nem capacidade. Mas o conteúdo vinha de registros QUE TÊM empresa: o código da solicitação de
-- compra, o título do documento, a contagem de títulos a vencer. Quem não enxerga a empresa recebia o
-- aviso assim mesmo — e o link dar 404 depois não desfaz nada: o TÍTULO já revelou existência e
-- identificação.
--
-- Esta migration é ADITIVA e faz duas coisas:
--
--  1) dá à notificação um CONTRATO DE ESCOPO explícito (tipo, módulo, empresa, capacidade), com as
--     combinações inválidas impossíveis por constraint;
--  2) separa a LEITURA, que é do usuário, do AVISO, que pode ser compartilhado — hoje um usuário marcar
--     uma notificação compartilhada como lida apaga o "não lida" de todo mundo.
--
-- Nada é renomeado e nada é removido: `erp.notifications.read_at` continua existindo como LEGADO.
-- A renomeação física fazenda → empresa continua sendo PRE-BASE2-03.
-- =====================================================================================================

-- ---------- 1) contrato de escopo na própria notificação ----------
alter table erp.notifications add column if not exists escopo_tipo text;
alter table erp.notifications add column if not exists modulo text;
alter table erp.notifications add column if not exists empresa_id uuid;
alter table erp.notifications add column if not exists permission_key text;
-- origem: de qual registro o aviso nasceu. Serve para diagnóstico e para reprocessar sem reparsear texto.
alter table erp.notifications add column if not exists entidade_origem text;
alter table erp.notifications add column if not exists id_origem uuid;
-- chave de deduplicação do dia. A rota NÃO serve: todos os aniversariantes compartilham a mesma rota, então
-- deduplicar por rota criava um aviso e engolia os outros; e o agregado diário precisa de chave estável.
alter table erp.notifications add column if not exists dedupe_key text;

comment on column erp.notifications.escopo_tipo is 'organizacao = não depende de empresa; empresa = pertence a UMA empresa; modulo_todas = agregado real da organização inteira dentro de um módulo, que só quem enxerga TODAS as empresas daquele módulo pode consolidar.';
comment on column erp.notifications.permission_key is 'Capacidade exigida para ver a linha (ex.: purchase_requests.view). A caixa de notificações é porta dinâmica: a autorização da LINHA vem da fonte funcional dela, não de um módulo "notificações".';
comment on column erp.notifications.empresa_id is 'Empresa da notificação (hoje materializada por erp.farms). Só existe quando escopo_tipo = empresa.';

-- ---------- 2) classificação do legado, FAIL-CLOSED ----------
-- Nenhuma linha antiga pode virar "da organização" por omissão: isso preservaria exatamente o vazamento
-- que esta migration existe para fechar. Onde a empresa não é recuperável de forma determinística (só o
-- texto do título a insinuaria, e reconstruir autorização por parsing de texto humano é inaceitável), a
-- linha vira `modulo_todas` do módulo correspondente — visível apenas a quem enxerga todas as empresas
-- daquele módulo. Perde-se alcance, não se ganha exposição.
do $$
declare
  desconhecidos text;
begin
  update erp.notifications set escopo_tipo = 'organizacao', permission_key = 'employees.view'
   where escopo_tipo is null and kind = 'birthday';

  update erp.notifications set escopo_tipo = 'modulo_todas', modulo = 'compras', permission_key = 'purchase_requests.view'
   where escopo_tipo is null and kind = 'purchase_pending';

  update erp.notifications set escopo_tipo = 'modulo_todas', modulo = 'pecuaria', permission_key = 'processings.view'
   where escopo_tipo is null and kind = 'processing_pending';

  update erp.notifications set escopo_tipo = 'modulo_todas', modulo = 'pecuaria', permission_key = 'batches.view'
   where escopo_tipo is null and kind = 'batch_transfer';

  update erp.notifications set escopo_tipo = 'modulo_todas', modulo = 'estoque', permission_key = 'stocks.view'
   where escopo_tipo is null and kind = 'stock_min';

  update erp.notifications set escopo_tipo = 'modulo_todas', modulo = 'financeiro', permission_key = 'payables.view'
   where escopo_tipo is null and kind = 'title_due';

  update erp.notifications set escopo_tipo = 'modulo_todas', modulo = 'documentos', permission_key = 'documents.view'
   where escopo_tipo is null and kind = 'document_expiring';

  -- Tipo que esta migration não conhece não é classificado no chute. Classificar errado para cima vaza;
  -- classificar errado para baixo esconde. Quem conhece o tipo decide, antes de migrar.
  select string_agg(distinct kind, ', ') into desconhecidos from erp.notifications where escopo_tipo is null;
  if desconhecidos is not null then
    raise exception 'PRE-BASE2-02: notificações de tipo desconhecido sem classificação de escopo: %. Cada tipo precisa declarar escopo_tipo, modulo e permission_key no registry (packages/domain/src/notificacoes.ts) e ser acrescentado a esta migration antes de migrar — classificar por omissão viraria vazamento ou sumiço silencioso.', desconhecidos;
  end if;
end $$;

alter table erp.notifications alter column escopo_tipo set not null;

-- chave de deduplicação do que já existe: o comportamento antigo era por rota (ou título quando não havia rota)
update erp.notifications set dedupe_key = coalesce(route, title) where dedupe_key is null;

-- ---------- 3) catálogo: quais combinações (tipo × escopo × módulo × capacidade) existem ----------
-- A coerência da TRIPLA (escopo, módulo, empresa) sozinha não basta: ela é satisfeita por
-- `escopo_tipo='organizacao', modulo=null, empresa_id=null` para QUALQUER kind — inclusive um aviso de
-- compra, cujo título carrega o código da solicitação de uma empresa. Ou seja: o estado que esta migration
-- existe para impedir continuaria representável, dependendo de a aplicação nunca errar. Como na 0011 fez-se
-- com os módulos, o catálogo desce para o banco: `kind` deixa de ser texto livre e só as combinações
-- declaradas aqui podem ser gravadas — por rota, por migration futura ou por psql.
create table if not exists erp.tipos_notificacao (
  kind text not null,
  escopo_tipo text not null,
  -- `modulo` de verdade é anulável (escopo de organização não tem módulo), mas chave estrangeira com coluna
  -- nula não é verificada (MATCH SIMPLE) — e seria justamente o caso 'organizacao', o perigoso. Por isso a
  -- referência usa a forma NÃO-NULA do módulo, com '-' representando "sem módulo".
  modulo_ref text not null,
  permission_key text not null,
  observacao text not null,
  primary key (kind, escopo_tipo, modulo_ref, permission_key)
);

comment on table erp.tipos_notificacao is 'Combinações PERMITIDAS de tipo de notificação × escopo × módulo × capacidade. Espelha packages/domain/src/notificacoes.ts (gate de consistência em apps/api/test/unit). Ausência de linha = combinação impossível de gravar.';

insert into erp.tipos_notificacao (kind, escopo_tipo, modulo_ref, permission_key, observacao) values
  -- forma canônica de cada tipo (a que o registry declara)
  ('purchase_pending',   'empresa',      'compras',    'purchase_requests.view', 'empresa da própria solicitação'),
  ('processing_pending', 'empresa',      'pecuaria',   'processings.view',       'empresa do processamento'),
  ('batch_transfer',     'empresa',      'pecuaria',   'batches.view',           'empresa de DESTINO, que é quem processa'),
  ('document_expiring',  'empresa',      'documentos', 'documents.view',         'empresa do documento'),
  ('birthday',           'organizacao',  '-',          'employees.view',         'cadastro de pessoas, sem dimensão de empresa'),
  ('stock_min',          'modulo_todas', 'estoque',    'stocks.view',            'mínimo é da organização e o saldo soma todos os armazéns'),
  ('title_due',          'empresa',      'financeiro', 'payables.view',          'contagem de contas a PAGAR da empresa do título'),
  -- rebaixamento DECLARADO: documento sem empresa é da organização (e só ele; nenhum outro tipo empresarial
  -- pode virar 'organizacao', que é a forma mais ampla de visibilidade)
  ('document_expiring',  'organizacao',  '-',          'documents.view',         'documento sem empresa pertence à organização'),
  -- forma FAIL-CLOSED do legado (§ classificação abaixo) e refúgio de quem não consegue recuperar a empresa:
  -- `modulo_todas` é sempre um SUBCONJUNTO de quem veria a linha por empresa (só proprietário ou modo
  -- `todas`), então permitir esta forma só encolhe alcance — nunca amplia.
  ('purchase_pending',   'modulo_todas', 'compras',    'purchase_requests.view', 'legado sem empresa recuperável'),
  ('processing_pending', 'modulo_todas', 'pecuaria',   'processings.view',       'legado sem empresa recuperável'),
  ('batch_transfer',     'modulo_todas', 'pecuaria',   'batches.view',           'legado sem empresa recuperável'),
  ('document_expiring',  'modulo_todas', 'documentos', 'documents.view',         'legado sem empresa recuperável'),
  ('title_due',          'modulo_todas', 'financeiro', 'payables.view',          'legado: agregado da organização, sem empresa recuperável')
on conflict (kind, escopo_tipo, modulo_ref, permission_key) do update set observacao = excluded.observacao;

alter table erp.tipos_notificacao enable row level security;
alter table erp.tipos_notificacao force row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='erp' and tablename='tipos_notificacao' and policyname='catalogo_leitura') then
    create policy catalogo_leitura on erp.tipos_notificacao for select to erp_app, authenticated using (true);
  end if;
end $$;
grant select on erp.tipos_notificacao to erp_app;

-- forma não-nula do módulo, só para a chave estrangeira acima conseguir enxergar o caso 'organizacao'
alter table erp.notifications add column if not exists modulo_ref text generated always as (coalesce(modulo, '-')) stored;

-- ---------- 4) constraints: estado inválido impossível ----------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_escopo_tipo_check') then
    alter table erp.notifications add constraint notifications_escopo_tipo_check
      check (escopo_tipo in ('organizacao', 'empresa', 'modulo_todas'));
  end if;
  -- a coerência entre tipo, módulo e empresa é do BANCO, não da aplicação
  if not exists (select 1 from pg_constraint where conname = 'notifications_escopo_coerente_check') then
    alter table erp.notifications add constraint notifications_escopo_coerente_check check (
      (escopo_tipo = 'organizacao'  and modulo is null     and empresa_id is null) or
      (escopo_tipo = 'empresa'      and modulo is not null and empresa_id is not null) or
      (escopo_tipo = 'modulo_todas' and modulo is not null and empresa_id is null)
    );
  end if;
  -- empresa tem de ser da MESMA organização (a unicidade composta veio da 0011)
  if not exists (select 1 from pg_constraint where conname = 'notifications_empresa_fk') then
    alter table erp.notifications add constraint notifications_empresa_fk
      foreign key (organization_id, empresa_id) references erp.farms (organization_id, id) on delete cascade;
  end if;
  -- módulo tem de ser do catálogo canônico: string livre autorizaria por acidente
  if not exists (select 1 from pg_constraint where conname = 'notifications_modulo_fk') then
    alter table erp.notifications add constraint notifications_modulo_fk
      foreign key (modulo) references erp.modulos_escopo_empresa (chave);
  end if;
  -- e o conjunto tipo × escopo × módulo × capacidade tem de ser um dos DECLARADOS: é isto que impede um
  -- aviso de compra nascer como 'organizacao' e ser visto por quem não enxerga a empresa de origem.
  if not exists (select 1 from pg_constraint where conname = 'notifications_tipo_fk') then
    alter table erp.notifications add constraint notifications_tipo_fk
      foreign key (kind, escopo_tipo, modulo_ref, permission_key) references erp.tipos_notificacao (kind, escopo_tipo, modulo_ref, permission_key);
  end if;
end $$;

-- capacidade é OBRIGATÓRIA. Enquanto era anulável, a leitura tratava NULL como "qualquer membro vê" — uma
-- sentinela permissiva de ausência, que é o mesmo erro do escopo faltando: quem esquece a coluna publica.
alter table erp.notifications alter column permission_key set not null;

-- caminho quente: a caixa do usuário e o contador de não lidas
create index if not exists notifications_caixa_idx on erp.notifications (organization_id, created_at desc);
create index if not exists notifications_empresa_idx on erp.notifications (organization_id, empresa_id) where empresa_id is not null;
create index if not exists notifications_dedupe_idx on erp.notifications (organization_id, kind, dedupe_key);

-- ---------- 5) leitura é do USUÁRIO, não do aviso ----------
-- `erp.notifications.read_at` fica como LEGADO: com user_id nulo (aviso compartilhado) ele registrava a
-- leitura de quem chegou primeiro e zerava o "não lida" de todos os outros.
-- alvo da chave composta: sem isto, o recibo referencia a notificação sem provar que ela é da mesma
-- organização, e um recibo gravado com a organização errada é aceito e depois IGNORADO pelo join — o
-- usuário marca como lida, recebe 200, e o aviso continua não lido para sempre, sem erro em lugar nenhum.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_org_id_key') then
    alter table erp.notifications add constraint notifications_org_id_key unique (organization_id, id);
  end if;
end $$;

create table if not exists erp.notificacao_leituras (
  organization_id uuid not null references erp.organizations(id),
  notificacao_id uuid not null,
  usuario_id uuid not null references erp.users(id) on delete cascade,
  lida_em timestamptz not null default now(),
  primary key (organization_id, notificacao_id, usuario_id),
  constraint notificacao_leituras_notificacao_fk
    foreign key (organization_id, notificacao_id) references erp.notifications (organization_id, id) on delete cascade
);

comment on table erp.notificacao_leituras is 'Recibo de leitura POR USUÁRIO. Autoridade do "lida"; erp.notifications.read_at é legado e não decide nada em runtime.';

-- contador de não lidas do usuário
create index if not exists notificacao_leituras_usuario_idx on erp.notificacao_leituras (organization_id, usuario_id);

-- migração do read_at legado: só quando se sabe DE QUEM era a leitura. Com user_id nulo o read_at não diz
-- qual usuário leu — e inventar um dono para a leitura seria marcar como lido para quem nunca viu.
insert into erp.notificacao_leituras (organization_id, notificacao_id, usuario_id, lida_em)
select n.organization_id, n.id, n.user_id, n.read_at
  from erp.notifications n
 where n.user_id is not null and n.read_at is not null
on conflict do nothing;

comment on column erp.notifications.read_at is 'LEGADO (PRE-BASE2-02): a autoridade da leitura passou a ser erp.notificacao_leituras, por usuário. Mantido por compatibilidade; runtime novo não lê nem grava aqui.';

-- ---------- 6) RLS e privilégios ----------
alter table erp.notificacao_leituras enable row level security;
alter table erp.notificacao_leituras force row level security;

do $$ begin
  -- Isolar só por organização deixaria o "de quem é esta leitura" por conta da aplicação — justamente o
  -- tipo de invariante que esta migration desceu para o banco em todo o resto. Um recibo gravado em nome
  -- de outro usuário apaga o "não lida" dele para sempre, sem erro e sem rastro. Mesmo padrão de
  -- `users_self` na 0007: o dono é quem a sessão diz ser.
  if not exists (select 1 from pg_policies where schemaname='erp' and tablename='notificacao_leituras' and policyname='tenant_isolation') then
    create policy tenant_isolation on erp.notificacao_leituras for all to erp_app, authenticated
      using (erp.tenant_visible(organization_id) and usuario_id = erp.effective_user_id())
      with check (erp.tenant_visible(organization_id) and usuario_id = erp.effective_user_id());
  end if;
end $$;

grant select, insert, update, delete on erp.notificacao_leituras to erp_app;
