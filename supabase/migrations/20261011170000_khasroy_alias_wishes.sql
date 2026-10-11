-- Short custom links (/i/aibek-aiperi) and guests' wishes on invitations.
alter table public.khasroy_invitations
  add column if not exists alias text check (alias ~ '^[a-z0-9][a-z0-9-]{2,39}$');
create unique index if not exists khasroy_invitations_alias_idx on public.khasroy_invitations (alias) where alias is not null;

create table if not exists public.khasroy_invitation_wishes (
  id uuid primary key default gen_random_uuid(),
  invitation_slug text not null references public.khasroy_invitations(slug) on delete cascade,
  guest_name text not null check (char_length(guest_name) between 1 and 80),
  text text not null check (char_length(text) between 1 and 500),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists khasroy_invitation_wishes_slug_idx
  on public.khasroy_invitation_wishes (invitation_slug, created_at desc);
alter table public.khasroy_invitation_wishes enable row level security;
revoke all on public.khasroy_invitation_wishes from anon, authenticated;
