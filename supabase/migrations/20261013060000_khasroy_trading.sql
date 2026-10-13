-- Khasroy Trading: Telegram chats, the signal journal, scanner state, and the cron token check.
create table if not exists public.khasroy_trading_chats (
  chat_id bigint primary key,
  name text,
  balance numeric not null default 200,
  risk_pct numeric not null default 0.5,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.khasroy_trading_signals (
  id uuid primary key default gen_random_uuid(),
  strategy text not null,
  symbol text not null,
  side text not null check (side in ('long','short')),
  candle_time timestamptz not null,
  entry numeric not null,
  sl numeric not null,
  tp numeric not null,
  status text not null default 'open' check (status in ('open','win','loss','expired')),
  exit_price numeric,
  r numeric,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (strategy, symbol, candle_time)
);
create index if not exists khasroy_trading_signals_open on public.khasroy_trading_signals (status) where status = 'open';
create table if not exists public.khasroy_trading_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.khasroy_trading_chats enable row level security;
alter table public.khasroy_trading_signals enable row level security;
alter table public.khasroy_trading_state enable row level security;

create or replace function public.khasroy_trading_token_ok(token text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'khasroy_trading_cron_token' and decrypted_secret = token);
$$;
revoke all on function public.khasroy_trading_token_ok(text) from public, anon, authenticated;
grant execute on function public.khasroy_trading_token_ok(text) to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'khasroy_trading_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'khasroy_trading_cron_token', 'pg_cron -> khasroy-trading edge function');
  end if;
end $$;

-- Every hour at :01 (4-hour candles close at 00/04/08/12/16/20 UTC; hourly runs follow open signals).
select cron.schedule('khasroy_trading_scan', '1 * * * *', $cron$
  select net.http_post(
    url := 'https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-trading',
    body := '{"action":"scan"}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-khasroy-trading-token', (select decrypted_secret from vault.decrypted_secrets where name = 'khasroy_trading_cron_token' limit 1)
    ),
    timeout_milliseconds := 120000
  );
$cron$);
