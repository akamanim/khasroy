-- Guest answers (RSVP) for invitations. Server/service-role access only.
create table if not exists public.khasroy_invitation_rsvps (
  id uuid primary key default gen_random_uuid(),
  invitation_slug text not null references public.khasroy_invitations(slug) on delete cascade,
  guest_name text not null check (char_length(guest_name) between 1 and 80),
  answer text not null check (answer in ('yes', 'family', 'no')),
  created_at timestamptz not null default now()
);
create index if not exists khasroy_invitation_rsvps_slug_idx
  on public.khasroy_invitation_rsvps (invitation_slug, created_at desc);
alter table public.khasroy_invitation_rsvps enable row level security;
revoke all on public.khasroy_invitation_rsvps from anon, authenticated;
comment on table public.khasroy_invitation_rsvps is
  'Guest answers to invitations. Server/service-role access only via the khasroy-invitations edge function.';
