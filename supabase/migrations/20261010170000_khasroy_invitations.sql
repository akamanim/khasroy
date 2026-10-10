-- Invitation studio: one row per client draft/order.
-- Access is server-side only (service role via the khasroy-invitations edge function).
create table if not exists public.khasroy_invitations (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null,
  session_hash text not null,
  slug text not null unique,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'published', 'archived')),
  event_type text,
  template_id text,
  data jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  message_count integer not null default 0,
  contact jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists khasroy_invitations_session_idx
  on public.khasroy_invitations (session_hash, updated_at desc);
create index if not exists khasroy_invitations_status_idx
  on public.khasroy_invitations (status, updated_at desc);

alter table public.khasroy_invitations enable row level security;
revoke all on public.khasroy_invitations from anon, authenticated;

comment on table public.khasroy_invitations is
  'Invitation studio orders. Server/service-role access only; clients reach it through the khasroy-invitations edge function.';

-- Public bucket for invitation photos (read is public so guests can see them; writes go through the edge function).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invitations', 'invitations', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
