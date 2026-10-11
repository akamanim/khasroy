-- Leads collected by the sales assistant (/sales). Server/service-role access only.
create table if not exists public.khasroy_sales_leads (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null check (session_hash ~ '^[a-f0-9]{64}$'),
  name text not null default '' check (char_length(name) <= 80),
  phone text not null check (char_length(phone) between 5 and 40),
  request text not null default '' check (char_length(request) <= 300),
  conversation jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_hash, phone)
);
create index if not exists khasroy_sales_leads_created_idx on public.khasroy_sales_leads (created_at desc);
alter table public.khasroy_sales_leads enable row level security;
revoke all on public.khasroy_sales_leads from anon, authenticated;
comment on table public.khasroy_sales_leads is
  'Customer contacts left in the sales assistant chat. Access only via the khasroy-invitations edge function.';
