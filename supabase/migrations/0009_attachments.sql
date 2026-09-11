-- Anexos por registro: conteúdo guardado no próprio banco (bytea), sem depender de storage externo.
-- erp.attachments (0001) continua sendo o índice do anexo; bucket='db' indica conteúdo em erp.attachment_blobs.
create table if not exists erp.attachment_blobs (
  attachment_id uuid primary key references erp.attachments(id) on delete cascade,
  organization_id uuid not null references erp.organizations(id),
  data bytea not null
);
create index if not exists attachment_blobs_org_idx on erp.attachment_blobs (organization_id);
alter table erp.attachment_blobs enable row level security;
alter table erp.attachment_blobs force row level security;
drop policy if exists tenant_isolation on erp.attachment_blobs;
create policy tenant_isolation on erp.attachment_blobs for all to erp_app, authenticated using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
grant select, insert, update, delete on erp.attachment_blobs to erp_app;
create index if not exists attachments_org_entity_created_idx on erp.attachments (organization_id, entity, entity_id, created_at desc);
