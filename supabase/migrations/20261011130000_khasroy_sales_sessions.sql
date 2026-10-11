-- Variant B of the sales assistant (Khasroy's proposal): server-side sessions and message log.
-- Server/service-role access only, through the khasroy-invitations edge function.
create table if not exists public.khasroy_sales_sessions (
  session_id uuid primary key,
  stage text not null default 'greeting'
    check (stage in ('greeting', 'qualification', 'proposal', 'closing', 'finished')),
  data jsonb not null default '{}'::jsonb,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.khasroy_sales_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.khasroy_sales_sessions(session_id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 4000),
  created_at timestamptz not null default now()
);
create index if not exists khasroy_sales_messages_session_idx
  on public.khasroy_sales_messages (session_id, created_at desc);
alter table public.khasroy_sales_sessions enable row level security;
alter table public.khasroy_sales_messages enable row level security;
revoke all on public.khasroy_sales_sessions from anon, authenticated;
revoke all on public.khasroy_sales_messages from anon, authenticated;
