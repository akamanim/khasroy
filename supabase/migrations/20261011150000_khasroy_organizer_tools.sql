-- Organizer tools: a secret link to each invitation's guest list, and party size on RSVPs.
alter table public.khasroy_invitations
  add column if not exists manage_token text not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists khasroy_invitations_manage_token_idx on public.khasroy_invitations (manage_token);

alter table public.khasroy_invitation_rsvps
  add column if not exists party_size integer not null default 1 check (party_size between 0 and 30);
-- "Not coming" answers count as nobody.
update public.khasroy_invitation_rsvps set party_size = 0 where answer = 'no' and party_size <> 0;
